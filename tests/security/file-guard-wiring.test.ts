/**
 * tests/security/file-guard-wiring.test.ts — #1052 写入门禁**接线**（穿生产函数 `applyEvolutionActions`）
 *
 * 为什么要单开一件（与 tests/security/file-guard.test.ts 的分工）:
 *   · 既有件测的是 FileGuard **纯判定逻辑**（canWrite/canRead 的允许/拒绝表）；
 *   · 本件测的是**接线**：进化产物写点（`middle-evolution-engine.ts` 3 处 writeFileSync 之前）
 *     是否真的过门、拒绝是否**不写**且**落审计**（铁律 4/5：入口 → 交互 → 结果）。
 *
 * 覆盖面声明（CTO 2026-10-08 裁定，固定形态）：
 *   **写入门禁已接（覆盖面 = 本文件 `src/loops/middle-evolution-engine.ts` 3 处；
 *   `src/` 内写原语 24 文件，其余 23 未拦）**
 *
 * 契约（铁律 47）
 *   @input   — 夹具 `extensions/industries/_test_1052_file_guard/thresholds.json`
 *              （`thresholdOverrides[ZZ_TEST_1052_FILE_GUARD]` + 2 条 pending ⇒ 本次为第 3 次 =
 *              MIN_TRIGGER_COUNT）；动作 = 手构 `threshold_adjust`（sentinelKey/direction/adjustPercent）
 *   @output  — 允许路径：`applied ≥ 1` 且阈值文件真变化；拒绝路径：文件**逐字未变** +
 *              `errors` 含「写入被门禁拒绝」+ `audit_log` 出现 `file_write_denied` 行
 *   @degraded— 审计通道未初始化 ⇒ `AuditService.log` 内部 `log.warn` 后跳过，
 *              **门禁判定不变**（铁律 24/31：审计失败不改判、也不放行）；本件不单独断言该路径
 *              （由 `tests/services` 侧既有件与单元件 `onDecision 抛错` 用例覆盖）
 *
 * 隔离与安全:
 *   · 夹具目录 `extensions/industries/_test_1052_file_guard/`（引擎 EXTENSIONS_DIR 无 env 接缝）
 *   · 哨兵键 `ZZ_TEST_1052_FILE_GUARD`（真行业配置零命中）⇒ 清理失败也不会改写真配置
 *   · 库形态 = 真实文件库（mkdtemp 临时目录，非 `:memory:`）；**禁 `data/synova.db`**
 *     （`data/` 被 .gitignore 排除，干净检出下不存在）
 *   · afterAll: 还原 FileGuard 单例 → 删夹具目录 → 删临时目录
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { applyEvolutionActions, type EvolutionAction } from '../../src/loops/middle-evolution-engine';
import { FileGuard, getFileGuard } from '../../src/security/file-guard';
import { AuditService } from '../../src/services/audit-service';
import { getAgentMemoryStore } from '../../src/l4/agent-memory-store';

const PROJECT_ROOT = process.cwd();
const TEST_INDUSTRY = '_test_1052_file_guard';
const TEST_DIR = join(PROJECT_ROOT, 'extensions', 'industries', TEST_INDUSTRY);
const TEST_PATH = join(TEST_DIR, 'thresholds.json');
const TEST_KEY = 'ZZ_TEST_1052_FILE_GUARD';
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fg-1052-'));
const DENY_WORKDIR = join(TMP_DIR, 'not-the-root');

/** 写夹具：2 条 pending ⇒ 本次为第 3 次（MIN_TRIGGER_COUNT=3）⇒ 走 applied 分支（`:517` 门） */
function writeFixture(): void {
  mkdirSync(TEST_DIR, { recursive: true });
  const pending = Array.from({ length: 2 }, () => ({
    key: TEST_KEY, direction: 'up', applied: false, reason: 'pending fixture（#1052）',
  }));
  writeFileSync(TEST_PATH, JSON.stringify({
    industry: TEST_INDUSTRY,
    thresholdOverrides: { [TEST_KEY]: { warning: 1.5, critical: 1.2 } },
    _gaCorrections: pending,
  }, null, 2), 'utf-8');
}

function readThresholdRaw(): string {
  return readFileSync(TEST_PATH, 'utf-8');
}

function thresholdAction(): EvolutionAction {
  return {
    type: 'threshold_adjust',
    reason: 'fixture（#1052 接线取证）',
    parameter: { sentinelKey: TEST_KEY, direction: 'up', adjustPercent: 5 },
    confidence: 1,
    triggeredAt: new Date().toISOString(),
  };
}

let auditDb: Database.Database;

beforeAll(() => {
  auditDb = new Database(join(TMP_DIR, 'audit.db'));
  // 生产审计通道（唯一）：其构造会建 audit_log 表
  AuditService.init(auditDb);
  // 阈值回写路径会调 logCorrection → agent_memory（未初始化时降级跳过）
  getAgentMemoryStore(new Database(join(TMP_DIR, 'agent-memory.db')));
});

afterAll(() => {
  // 还原单例（避免污染同进程其它测试）
  getFileGuard(undefined, new FileGuard(process.cwd()));
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('#1052 写入门禁接线（穿生产函数 applyEvolutionActions）', () => {
  it('允许路径：workDir = 进程工作根 ⇒ 阈值真写入（applied ≥ 1）', () => {
    getFileGuard(undefined, new FileGuard(process.cwd()));
    writeFixture();
    const before = readThresholdRaw();

    const result = applyEvolutionActions([thresholdAction()]);

    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(readThresholdRaw()).not.toBe(before); // 文件**真变化**（不是"看起来写了"）
  });

  it('拒绝路径：workDir 不含该路径 ⇒ 文件逐字未变 + errors 显式（不静默）', () => {
    getFileGuard(undefined, new FileGuard(DENY_WORKDIR));
    writeFixture();
    const before = readThresholdRaw();

    const result = applyEvolutionActions([thresholdAction()]);

    expect(readThresholdRaw()).toBe(before); // 🔴 关键断言：拒绝 ⇒ **不写**
    expect(result.errors.some((e) => e.includes('写入被门禁拒绝'))).toBe(true);
  });

  it('审计留痕：拒绝产生 audit_log 行（action = file_write_denied）', () => {
    getFileGuard(undefined, new FileGuard(DENY_WORKDIR));
    writeFixture();

    applyEvolutionActions([thresholdAction()]);

    const rows = AuditService.query('system', { action: 'file_write_denied' });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.targetId === TEST_PATH)).toBe(true);
  });
});
