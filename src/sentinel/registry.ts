/**
 * sentinel/registry.ts — SentinelRegistry 实现 (P1-1)
 *
 * 哨兵注册中心: 管理所有 Sentinel 实例的生命周期。
 * 单例模式, 全局可访问。支持按类别/优先级过滤。
 *
 * @state: real — 生产可用, 与 CronScheduler 集成
 */

import type { Sentinel, SentinelConfig, SentinelCategory, SentinelPriority, SentinelRegistry, SentinelFinding, SentinelContext } from './types';
import { createLogger } from '@synova/logger';

import { writeRoundReadings } from './metric-readings-writer';
const log = createLogger('sentinel/registry');

// ═══ SentinelRegistryImpl ═══

export class SentinelRegistryImpl implements SentinelRegistry {
  private sentinels = new Map<string, Sentinel>();

  /** #1463 B7：重复注册被跳过的累计次数（可观测计数；修前该信号为「静默覆盖」） */
  private duplicateSkips = 0;

  /**
   * 注册哨兵（**幂等**，#1463 B7）。
   *
   * 契约（铁律 47）：
   * - 输入：`sentinel` — 满足 `Sentinel` 结构的实例
   * - 输出：`void`（接口 `SentinelRegistry.register` 签名不变）；副作用 = 首次登记 / 重复则跳过并计数
   * - 降级：不适用（无 I/O、不抛异常；非法结构不在本函数校验范围内）
   *
   * 语义（2026-10-09 由「覆盖旧实例」改为「显式跳过」）：
   *   同 id 二次注册 ⇒ **保留首登实例**、`duplicateSkips += 1`、按 warn 记一条带累计数的日志。
   *   为什么改：生产有**两个**调用点登记同一批 45 个文件驱动哨兵
   *   （src/init/file-driven-loaders.ts、src/deploy/bootstrap.ts）⇒ 实测刷 45 条「覆盖旧实例」。
   *   两个调用点 import 的是**同一模块实例**（ESM 按 URL 缓存）⇒ 跳过与覆盖在实例同一性上等价，
   *   但「跳过」不再让「谁赢了」这件事变得不可见（P-03：声称必须与事实一致）。
   */
  register(sentinel: Sentinel): void {
    const id = sentinel.config.id;
    if (this.sentinels.has(id)) {
      this.duplicateSkips += 1;
      log.warn({ sentinelId: id, skipped: this.duplicateSkips },
        '哨兵重复注册 — 跳过 (幂等)');
      return;
    }
    this.sentinels.set(id, sentinel);
    log.info({ sentinelId: id, name: sentinel.config.name, category: sentinel.config.category },
      '哨兵已注册');
  }

  /** #1463 B7：累计被跳过的重复注册次数（与修前「覆盖」日志行数可直接对照） */
  getDuplicateSkipCount(): number {
    return this.duplicateSkips;
  }

  unregister(id: string): void {
    if (this.sentinels.delete(id)) {
      log.info({ sentinelId: id }, '哨兵已注销');
    }
  }

  get(id: string): Sentinel | undefined {
    return this.sentinels.get(id);
  }

  list(): Sentinel[] {
    return [...this.sentinels.values()];
  }

  listByCategory(category: SentinelCategory): Sentinel[] {
    return this.list().filter(s => s.config.category === category);
  }

  listByPriority(priority: SentinelPriority): Sentinel[] {
    return this.list().filter(s => s.config.priority === priority);
  }

  count(): number {
    return this.sentinels.size;
  }

  /** 获取所有 cron 模式的哨兵 */
  listCronSentinels(): Array<{ sentinel: Sentinel; cron: string }> {
    return this.list()
      .filter(s => s.config.mode === 'cron' && s.config.cron)
      .map(s => ({ sentinel: s, cron: s.config.cron! }));
  }

  /** 按团队列出哨兵 — 当前所有哨兵全局适用, 团队过滤在 check() 内部通过 discoverTeams 实现 */
  listForTeam(_teamId: string): Sentinel[] {
    return this.list();
  }

  /** 运行所有哨兵 (按需诊断用), 返回 Finding[]。每哨兵独立降级。 */
  async runAll(context: SentinelContext): Promise<SentinelFinding[]> {
    const all: SentinelFinding[] = [];
    for (const s of this.sentinels.values()) {
      try {
        const result = await s.check(context);
        // #1054（2-1b）轮次级写入（覆盖面 = 其余 44 哨兵；sink 未注入 ⇒ no-op）
        writeRoundReadings(context.metricSink, s.config.id, result, context.teamId);
        if (result.findings) all.push(...result.findings);
      } catch (err: unknown) {
        log.warn({ err, id: s.config.id }, '哨兵执行失败 — degraded');
      }
    }
    if (all.length > 0) log.info({ findings: all.length }, '哨兵运行完成');
    return all;
  }
}

// ═══ LLM 格式化 ═══

/** 将 Finding[] 格式化为 LLM prompt 文本 */
export function formatFindingsForLLM(findings: SentinelFinding[]): string {
  if (findings.length === 0) return '';
  const crit = findings.filter(f => f.severity === 'critical');
  const warn = findings.filter(f => f.severity === 'warning');
  const lines: string[] = ['## 哨兵监测数据 (客观事实)\n'];
  if (crit.length > 0) {
    lines.push(`🔴 严重 (${crit.length} 条):`);
    for (const f of crit) lines.push(`- ${f.title}: ${f.description}`);
  }
  if (warn.length > 0) {
    lines.push(`\n🟡 警告 (${warn.length} 条):`);
    for (const f of warn) lines.push(`- ${f.title}: ${f.description}`);
  }
  lines.push(`\n共 ${findings.length} 条发现。请基于以上客观数据生成诊断假设。`);
  return lines.join('\n');
}

// ═══ Global Singleton ═══

let _globalRegistry: SentinelRegistryImpl | null = null;

/** 获取全局 SentinelRegistry 单例 */
export function getSentinelRegistry(): SentinelRegistryImpl {
  if (!_globalRegistry) {
    _globalRegistry = new SentinelRegistryImpl();
  }
  return _globalRegistry;
}

/** 销毁全局单例 (测试用) */
export function destroySentinelRegistry(): void {
  _globalRegistry = null;
}
