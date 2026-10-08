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

  register(sentinel: Sentinel): void {
    const id = sentinel.config.id;
    if (this.sentinels.has(id)) {
      log.warn({ sentinelId: id }, '哨兵已注册 — 覆盖旧实例');
    }
    this.sentinels.set(id, sentinel);
    log.info({ sentinelId: id, name: sentinel.config.name, category: sentinel.config.category },
      '哨兵已注册');
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
