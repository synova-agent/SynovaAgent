/**
 * tests/contract/time-injection.test.ts — Q-6 冻结清单双向棘轮（B 类 · 不新增门禁规则、不改阻断语义）
 *
 * 判据来源：#915 Q-6 规格 v2 §4.2／§5.2（R1–R6）＋ CTO 2026-10-25 开工令（否决给 #912 闸加第 5 条规则）
 * 行为面（S1–S4）在 `tests/contract/clock-injection.test.ts`；本文件只做**计数棘轮**。
 *
 * 判据：
 *   R0  判别力对照（绿）：文件计数与清单一致 ⇒ 无违规（证明 R2–R4 不是恒红）
 *   R0b 计数语义：同一行多次也计；`new Date(x)`／`Date.parse(...)` 不计（与基线同口径）
 *   R1  真树逐文件 == 内嵌冻结清单；TOTAL now=306 new=270（178 文件）
 *   R1b 本批两条注入链已清零（不直取）；时钟实现本体被豁免（不在扫描结果内）
 *   R2  夹具：新文件含直取 ⇒ 红（点名"新文件直取"）
 *   R3  夹具：既有文件计数 +1 ⇒ 红（点名"新增直取"）
 *   R4  夹具：既有文件计数 −1 且清单未变 ⇒ 红（点名"修好未删登记"）
 *   R5  夹具：`src/services/clock.ts` 含直取 ⇒ 绿（唯一路径豁免）；同内容换路径 ⇒ 红
 *   R6  夹具：src 不可读（目录缺失／文件不可读）⇒ 扫描失败（fail-closed，不静默跳过）
 *
 * 契约（铁律 47）:
 *   @input    仓库工作树 `src/`（递归全部 `.ts`）；内嵌冻结清单（178 文件 → [now,newDate]）
 *   @output   相符 ⇒ 绿；任一不符 ⇒ 红，消息逐条点名 `<file>: 期望 [n,m] 实得 [n',m']`
 *   @degraded 无（纯测试，不降级：src 不可读 ⇒ 直接失败，不静默跳过 —— 见 R6）
 *   @error    ClockRatchetScanError（code=CLOCK_RATCHET_SCAN_FAILED）：src 缺失／非目录／
 *             文件不可读 ⇒ 抛错（fail-closed）
 *
 * 设计哲学：一个冻结 ＋ 三条承诺 ——
 *   冻结：`src/` 的直取计数是**存量债基线**，本批一行不动（两条链清零 ⇒ 清单同 PR 收紧）；
 *   承诺 ① 双向：增 ⇒ 红（新代码必须注入 clock）、减 ⇒ 红（修好须删登记，防"假修好"）；
 *   承诺 ② 点名：失败必打印文件名与期望/实得计数，不笼统报"总数不符"；
 *   承诺 ③ 确定性：只读工作树、不读 git/env（`REPO_ROOT` 由本文件位置推导 ⇒ 复制树即改判据对象）。
 *
 * 扫描口径（实测校准，禁抄规格）:
 *   - 范围 = 递归 `src/` 下全部 `.ts`（**含** `src/server.ts`、`src/mvp-server.ts` 等顶层文件）。
 *     ⚠️ 规格 v2 §6 用 `git ls-files` 的递归 glob 枚举，会**漏掉 `src/` 顶层 .ts**（如 `src/server.ts`、
 *     `src/mvp-server.ts`；实测 304/262/176），本扫描器按目录递归，与基线口径（314/287/178）一致；
 *     两条链清零后 = **306/270/178**（锚 3f1098a0a）。
 *   - 计数 = 字面子串出现次数（同一行多次也计；已核对与 `grep -o` 正则口径在真树逐项相等）。
 *   - 唯一豁免路径 = `src/services/clock.ts`（时钟实现本体）；豁免 = **不纳入扫描结果**，非"计 0"。
 *
 * @known-limitations
 *   - 按**正则/字面计数**：注释、字符串里的同形文本也计入（与基线同口径）；`Date.now` 别名、
 *     `performance.now()`、带参 `new Date(x)`（解析既有时间戳）不在视野。
 *   - 文件级计数：同文件内"删 1 加 1"总数不变 ⇒ 不红（已知盲区，靠 L1 复核与两态用例补）。
 *   - 只覆盖 `src/**`：`packages/`、`scripts/`、`tests/` 的直取不在本棘轮内（CTO 口径）。
 *   - 不跟随**目录**符号链接（避免递归环）；文件级符号链接会跟随，读失败即 fail-closed（R6b）。
 *   - 不读 `SYNO_*` 环境变量（防"外层 CI 变量泄漏 ⇒ 扫错树 ⇒ 假绿"）；两态复核靠**复制树**跑本文件。
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根：由本文件位置推导 ⇒ 复制整树后自动扫副本（两态复核不需要环境变量） */
const REPO_ROOT = path.resolve(HERE, '..', '..');

/** 唯一路径豁免：时钟实现本体（规格 §4.2「@豁免」） */
const EXEMPT_FILE = 'src/services/clock.ts';

/** 扫描失败码（铁律 32：错误可分类） */
const CLOCK_RATCHET_SCAN_FAILED = 'CLOCK_RATCHET_SCAN_FAILED';

/** 冻结总数（现算：锚 3f1098a0a ＋ 两条链清零后的工作树实测） */
const FROZEN_TOTAL_NOW = 306;
const FROZEN_TOTAL_NEW_DATE = 270;
const FROZEN_TOTAL_FILES = 178;

/** 单文件直取计数（两个口径分列，便于点名差异） */
interface DirectUseCount {
  readonly now: number;
  readonly newDate: number;
}

/** 冻结清单：仓库相对路径 → [Date.now() 次数, new Date() 次数] */
type FrozenManifest = Readonly<Record<string, readonly [number, number]>>;

/** 扫描失败（src 缺失／非目录／文件不可读）—— fail-closed，不静默跳过 */
class ClockRatchetScanError extends Error {
  readonly code = CLOCK_RATCHET_SCAN_FAILED;
  readonly phase = 1;
  readonly retryable = false;

  /**
   * @param message — 人读可定位的失败说明（含路径与底层错误）
   */
  constructor(message: string) {
    super(message);
    this.name = 'ClockRatchetScanError';
  }
}

// ═══ 冻结清单（178 文件；现算命令见文件头「扫描口径」；禁手改：改动须同 PR 说明） ═══

const FROZEN_MANIFEST: FrozenManifest = {
  'src/adapters/federal-adapter.ts': [0, 1],
  'src/adapters/standard-key-guard.ts': [0, 1],
  'src/agent/adapter-registry.ts': [0, 2],
  'src/agent/atomic-write.ts': [0, 1],
  'src/agent/boss-mailbox.ts': [0, 1],
  'src/agent/conflict-arbitrator.ts': [0, 4],
  'src/agent/context-compaction.ts': [0, 4],
  'src/agent/convergence-engine.ts': [1, 1],
  'src/agent/conversation-engine.ts': [2, 4],
  'src/agent/cost-budget.ts': [0, 1],
  'src/agent/diagnosis-launcher.ts': [1, 1],
  'src/agent/expert-router.ts': [4, 0],
  'src/agent/file-scanner.ts': [0, 1],
  'src/agent/interactive-card.ts': [0, 1],
  'src/agent/knowledge-conflict-handler.ts': [1, 1],
  'src/agent/loop-handlers.ts': [2, 0],
  'src/agent/proactive-push.ts': [1, 2],
  'src/agent/report-assembler.ts': [0, 1],
  'src/agent/sentinel-service.ts': [0, 2],
  'src/agent/synova-agent.ts': [2, 0],
  'src/agent/task-decomposer.ts': [4, 0],
  'src/agent/tool-loop-executor.ts': [4, 4],
  'src/connectors/csv-import.ts': [0, 1],
  'src/connectors/ima.ts': [0, 1],
  'src/connectors/unified-connector.ts': [1, 2],
  'src/contract/contract-gate.ts': [0, 1],
  'src/contract/contract-store.ts': [1, 1],
  'src/control-tower/signal-emitter.ts': [0, 1],
  'src/cron/scheduler.ts': [6, 4],
  'src/cycles/investment-advisor.ts': [0, 1],
  'src/cycles/overflow-compute.ts': [0, 1],
  'src/cycles/overflow-dashboard.ts': [0, 1],
  'src/deploy/backup-scheduler.ts': [3, 1],
  'src/deploy/backup-verify.ts': [1, 0],
  'src/deploy/bootstrap.ts': [21, 0],
  'src/deploy/content-reload.ts': [0, 1],
  'src/deploy/data-directory.ts': [0, 1],
  'src/deploy/recovery-pack.ts': [0, 2],
  'src/deploy/rollback.ts': [2, 1],
  'src/deploy/startup-check.ts': [1, 0],
  'src/deploy/system-self-ops.ts': [3, 1],
  'src/deploy/watchdog-entry.ts': [3, 0],
  'src/evidence/evidence-store.ts': [1, 1],
  'src/evidence/index.ts': [2, 1],
  'src/expert-platform/extractor.ts': [2, 2],
  'src/expert-platform/outcome-tracker.ts': [1, 0],
  'src/expert-platform/validator.ts': [0, 4],
  'src/growth/action-store.ts': [0, 2],
  'src/growth/decision-record.ts': [0, 1],
  'src/growth/dnd-engine.ts': [1, 1],
  'src/growth/feedback-collector.ts': [0, 1],
  'src/growth/goal-conflict-detector.ts': [0, 1],
  'src/growth/goal-lifecycle.ts': [2, 1],
  'src/growth/goal-sentinel.ts': [7, 8],
  'src/growth/goal-store.ts': [0, 4],
  'src/growth/knowledge-feedback.ts': [2, 1],
  'src/growth/next-action-engine.ts': [1, 0],
  'src/growth/proposal-engine.ts': [2, 3],
  'src/growth/proposal-store.ts': [2, 6],
  'src/growth/user-store.ts': [0, 1],
  'src/growth/workspace-builder.ts': [0, 1],
  'src/ingest/index.ts': [1, 0],
  'src/l1/im-inbound.ts': [4, 0],
  'src/l2/proposal-manager.ts': [4, 4],
  'src/l3/briefing-generator.ts': [0, 2],
  'src/l3/business-model-canvas.ts': [0, 1],
  'src/l3/expert-dispatcher.ts': [7, 1],
  'src/l3/ga-collaboration.ts': [0, 1],
  'src/l3/key-person-risk.ts': [0, 1],
  'src/l3/quality-firewall.ts': [2, 0],
  'src/l3/synova-diagnosis-engine-impl.ts': [10, 2],
  'src/l3/tool-guard.ts': [0, 2],
  'src/l4/agent-memory-store.ts': [1, 2],
  'src/l4/audit-store.ts': [0, 1],
  'src/l4/community-reports.ts': [2, 0],
  'src/l4/data-exporter.ts': [1, 1],
  'src/l4/data-purger.ts': [2, 15],
  'src/l4/decision-capture.ts': [0, 1],
  'src/l4/delivery-queue-store.ts': [2, 1],
  'src/l4/delivery-queue.ts': [2, 0],
  'src/l4/department-memory-store.ts': [1, 1],
  'src/l4/diagnosis-graph-query.ts': [1, 0],
  'src/l4/graph-bridge.ts': [0, 1],
  'src/l4/knowledge-store.ts': [6, 9],
  'src/l4/review-store.ts': [1, 1],
  'src/l5/alert-rules.ts': [1, 1],
  'src/l5/connector-pipeline.ts': [2, 0],
  'src/l5/ontology-event-bus.ts': [0, 1],
  'src/llm/circuit-breaker.ts': [3, 0],
  'src/llm/retry-middleware.ts': [0, 1],
  'src/loops/direction-monitor.ts': [0, 1],
  'src/loops/loop-scheduler.ts': [3, 4],
  'src/loops/middle-evolution-engine.ts': [5, 4],
  'src/mcp/skill-installer.ts': [0, 1],
  'src/middleware/auth.ts': [4, 0],
  'src/middleware/rate-limit.ts': [6, 0],
  'src/middleware/rate-limiter.ts': [1, 0],
  'src/middleware/rbac.ts': [1, 2],
  'src/monitoring/data-quality-gate.ts': [1, 2],
  'src/monitoring/freshness-tracker.ts': [5, 1],
  'src/monitoring/metrics.ts': [3, 0],
  'src/monitoring/pipeline-monitor.ts': [2, 1],
  'src/monitoring/system-health.ts': [1, 1],
  'src/mvp-server.ts': [1, 4],
  'src/onboarding/onboarding-flow.ts': [0, 1],
  'src/orchestrator/context-compressor.ts': [1, 0],
  'src/orchestrator/diagnosis-orchestrator.ts': [2, 2],
  'src/orchestrator/intent-router.ts': [2, 0],
  'src/orchestrator/module-runner.ts': [8, 0],
  'src/orchestrator/phase-state-machine.ts': [3, 1],
  'src/orchestrator/wiring.ts': [3, 3],
  'src/output/contract-validator.ts': [0, 1],
  'src/pipeline/judgment-card.ts': [1, 0],
  'src/providers/base.ts': [4, 0],
  'src/providers/ernie.ts': [2, 0],
  'src/providers/registry.ts': [2, 0],
  'src/routes/actions-api.ts': [1, 2],
  'src/routes/adapters.ts': [3, 0],
  'src/routes/auth.ts': [0, 1],
  'src/routes/chat.ts': [1, 0],
  'src/routes/conversations.ts': [0, 1],
  'src/routes/data.ts': [2, 0],
  'src/routes/diagnosis.ts': [1, 1],
  'src/routes/documents.ts': [1, 0],
  'src/routes/enterprise.ts': [2, 9],
  'src/routes/expert.ts': [1, 1],
  'src/routes/ga-admin.ts': [0, 1],
  'src/routes/ga-annotations.ts': [1, 1],
  'src/routes/ga-calibration.ts': [3, 2],
  'src/routes/ga-corrections.ts': [1, 0],
  'src/routes/ga-diagnosis.ts': [1, 1],
  'src/routes/health.ts': [2, 1],
  'src/routes/healthz.ts': [10, 0],
  'src/routes/im.ts': [2, 1],
  'src/routes/llm-config.ts': [3, 0],
  'src/routes/loops.ts': [1, 0],
  'src/routes/ontology.ts': [0, 1],
  'src/routes/reload.ts': [3, 0],
  'src/routes/workspace-data.ts': [1, 1],
  'src/routes/workspaces-api.ts': [3, 5],
  'src/runtime/approval-seam.ts': [0, 1],
  'src/security/connector-audit.ts': [1, 1],
  'src/security/external-hash-store.ts': [0, 1],
  'src/security/index.ts': [1, 1],
  'src/security/root-hash-publisher.ts': [0, 6],
  'src/sentinel/adapters/cash-flow-sentinel.ts': [6, 0],
  'src/sentinel/adapters/cpc-sentinel.ts': [1, 0],
  'src/sentinel/adapters/goal-alignment-sentinel.ts': [4, 0],
  'src/sentinel/adapters/integration-health-sentinel.ts': [5, 0],
  'src/sentinel/baseline-store.ts': [0, 2],
  'src/sentinel/metric-readings-writer.ts': [0, 1],
  'src/sentinel/runner.ts': [13, 15],
  'src/sentinel/self-check.ts': [0, 1],
  'src/sentinel/sentinel-loader.ts': [1, 2],
  'src/sentinel/sentinel-runner.ts': [0, 1],
  'src/sentinel/signal-aggregator.ts': [0, 1],
  'src/server.ts': [1, 4],
  'src/services/anomaly-detector.ts': [0, 1],
  'src/services/behavior-monitor.ts': [3, 4],
  'src/services/context-budget-tracker.ts': [3, 0],
  'src/services/db-encryption.ts': [0, 1],
  'src/services/deepseek-balance.ts': [2, 0],
  'src/services/escalation-engine.ts': [2, 2],
  'src/services/graceful-shutdown.ts': [0, 1],
  'src/services/llm-cache.ts': [2, 0],
  'src/services/llm-cost.ts': [2, 0],
  'src/services/llm-credential-store.ts': [1, 1],
  'src/services/memory-monitor.ts': [0, 1],
  'src/services/resource-monitor.ts': [0, 1],
  'src/services/restart-recovery.ts': [0, 1],
  'src/services/solution-generator.ts': [3, 4],
  'src/services/stuck-session-detector.ts': [0, 1],
  'src/services/update-checker.ts': [1, 2],
  'src/store/session-store.ts': [1, 5],
  'src/store/storage-backend.ts': [0, 1],
  'src/tools/accuracy-tools.ts': [2, 1],
  'src/tui-v2/lib/sidebar-aggregator.ts': [2, 4],
  'src/tui-v2/lib/thinking.ts': [5, 1],
};

// ═══ 扫描器 ═══

/**
 * 递归列出目录下全部 `.ts` 文件（跳过 `node_modules`/`dist`；不跟随目录符号链接）。
 * @param dir - 起始目录（绝对路径）
 * @param acc - 累积结果
 * @returns 绝对路径列表
 * @throws ClockRatchetScanError 目录不可读
 */
function listTsFiles(dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ClockRatchetScanError(`目录不可读：${dir}（${detail}）`);
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      listTsFiles(full, acc);
      continue;
    }
    if (entry.name.endsWith('.ts') === false) continue;
    acc.push(full);
  }
  return acc;
}

/**
 * 统计一段文本里的系统时钟直取次数（字面口径，与基线 `grep -o` 真树逐项相等）。
 * @param text - 文件全文
 * @returns `Date.now()` 与 `new Date()` 的出现次数（同一行多次也计）
 */
function countDirectUse(text: string): DirectUseCount {
  return {
    now: text.split('Date.now()').length - 1,
    newDate: text.split('new Date()').length - 1,
  };
}

/**
 * 扫描 `<root>/src` 下全部 `.ts`（排除豁免路径），返回有直取的文件计数。
 * @param root - 仓库根（真实树或夹具根）
 * @returns 仓库相对路径 → 计数（只含计数 > 0 的文件；豁免文件不出现）
 * @throws ClockRatchetScanError src 缺失／非目录／文件不可读（fail-closed）
 */
function scanDirectUse(root: string): Map<string, DirectUseCount> {
  const srcRoot = path.join(root, 'src');
  let srcStat;
  try {
    srcStat = statSync(srcRoot);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ClockRatchetScanError(`src 不可读：${srcRoot}（${detail}）`);
  }
  if (srcStat.isDirectory() === false) {
    throw new ClockRatchetScanError(`src 不是目录：${srcRoot}`);
  }

  const counts = new Map<string, DirectUseCount>();
  for (const abs of listTsFiles(srcRoot)) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (rel === EXEMPT_FILE) continue; // 唯一路径豁免：不纳入扫描结果
    let text: string;
    try {
      text = readFileSync(abs, 'utf-8');
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new ClockRatchetScanError(`文件不可读：${rel}（${detail}）`);
    }
    const count = countDirectUse(text);
    if (count.now + count.newDate > 0) counts.set(rel, count);
  }
  return counts;
}

/**
 * 把扫描结果转成可与冻结清单 `toEqual` 的普通对象（按路径排序，便于 diff）。
 * @param counts - `scanDirectUse` 结果
 * @returns 路径 → [now, newDate]
 */
function toManifest(counts: ReadonlyMap<string, DirectUseCount>): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const file of [...counts.keys()].sort()) {
    const count = counts.get(file);
    if (count === undefined) continue;
    out[file] = [count.now, count.newDate];
  }
  return out;
}

/**
 * 双向棘轮违规（空数组 = 未破坏）。
 * @param root - 仓库根（真实树或夹具根）
 * @param baseline - 冻结清单（真树用 FROZEN_MANIFEST；夹具用最小清单）
 * @returns 逐条违规消息（含 `<file>: 期望 [n,m] 实得 [n',m']`）
 * @throws ClockRatchetScanError 扫描失败（fail-closed）
 */
function ratchetViolations(root: string, baseline: FrozenManifest): string[] {
  const scanned = scanDirectUse(root);
  const violations: string[] = [];

  // ① 新文件有直取（清单无登记）⇒ 红：新代码一律注入 clock
  for (const file of [...scanned.keys()].sort()) {
    const got = scanned.get(file);
    if (got === undefined) continue;
    if (baseline[file] === undefined) {
      violations.push(
        `新文件直取：${file}: 期望 [0,0] 实得 [${got.now},${got.newDate}]（新代码禁直取系统时钟，请注入 clock；若确为时钟实现本体须显式加豁免）`,
      );
    }
  }

  // ② 既有文件计数变化 ⇒ 红（增／减都算：双向棘轮）
  for (const file of Object.keys(baseline).sort()) {
    const expected: readonly [number, number] | undefined = baseline[file];
    if (expected === undefined) continue;
    const got = scanned.get(file) ?? { now: 0, newDate: 0 };
    if (got.now > expected[0] || got.newDate > expected[1]) {
      violations.push(
        `新增直取：${file}: 期望 [${expected[0]},${expected[1]}] 实得 [${got.now},${got.newDate}]（本 PR 新增系统时钟直取 ⇒ 改用注入 clock）`,
      );
    } else if (got.now < expected[0] || got.newDate < expected[1]) {
      violations.push(
        `修好未删登记：${file}: 期望 [${expected[0]},${expected[1]}] 实得 [${got.now},${got.newDate}]（计数已降 ⇒ 须同 PR 收紧冻结清单）`,
      );
    }
  }

  return violations;
}

/**
 * 汇总行（规格 §4.2 的 TOTAL 口径）。
 * @param counts - `scanDirectUse` 结果
 * @returns 形如 `TOTAL now=306 new=270`
 */
function totalLine(counts: ReadonlyMap<string, DirectUseCount>): string {
  let now = 0;
  let newDate = 0;
  for (const count of counts.values()) {
    now += count.now;
    newDate += count.newDate;
  }
  return `TOTAL now=${now} new=${newDate}`;
}

// ═══ R0 判别力对照（绿 + 计数语义） ═══

describe('R0 判别力对照：清单相符 ⇒ 无违规；计数语义与基线同口径', () => {
  it('R0 夹具（绿）：文件计数与清单一致 ⇒ violations 为空（证明 R2–R4 不是恒红）', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'synova-q6-r0-'));
    try {
      mkdirSync(path.join(root, 'src'), { recursive: true });
      writeFileSync(path.join(root, 'src/known.ts'), 'export const a = Date.now();\nexport const b = new Date();\n', 'utf-8');
      const baseline: FrozenManifest = { 'src/known.ts': [1, 1] };
      const violations = ratchetViolations(root, baseline);
      expect(violations).toEqual([]);
      expect(totalLine(scanDirectUse(root))).toBe('TOTAL now=1 new=1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('R0b 计数语义：同一行多次也计；`new Date(x)`／`Date.parse` 不计（与基线同口径）', () => {
    expect(countDirectUse('const a = Date.now() + Date.now();')).toEqual({ now: 2, newDate: 0 });
    expect(countDirectUse('new Date(), new Date()')).toEqual({ now: 0, newDate: 2 });
    // 已知限制（规格 §8）：带参 new Date(x) 是"解析既有时间戳"，不在视野
    expect(countDirectUse('new Date(1767225600000)')).toEqual({ now: 0, newDate: 0 });
    expect(countDirectUse('Date.parse("2026-01-01T00:00:00Z")')).toEqual({ now: 0, newDate: 0 });
    expect(countDirectUse('')).toEqual({ now: 0, newDate: 0 });
  });
});

// ═══ R1 真树 == 冻结清单 ═══

describe('R1 真树逐文件 == 内嵌冻结清单（TOTAL now=306 new=270）', () => {
  it('R1 扫描结果与 FROZEN_MANIFEST 严格相等，TOTAL now=306 new=270（178 文件）', () => {
    const scanned = scanDirectUse(REPO_ROOT);
    const violations = ratchetViolations(REPO_ROOT, FROZEN_MANIFEST);

    // 先给点名差异（失败时可直接定位是哪个文件增/减），再兜底逐文件相等
    expect(violations.join(' | ')).toBe('');
    expect(toManifest(scanned)).toEqual({ ...FROZEN_MANIFEST });
    expect(scanned.size).toBe(FROZEN_TOTAL_FILES);
    expect(totalLine(scanned)).toBe(`TOTAL now=${FROZEN_TOTAL_NOW} new=${FROZEN_TOTAL_NEW_DATE}`);
    expect(totalLine(scanned)).toBe('TOTAL now=306 new=270');
  });

  it('R1b 本批两条注入链已清零（不在扫描结果内）；时钟实现本体按路径豁免', () => {
    const scanned = scanDirectUse(REPO_ROOT);
    expect(scanned.has('src/services/federated-pipeline.ts')).toBe(false);
    expect(scanned.has('src/agent/main-agent.ts')).toBe(false);
    // 豁免 = 不纳入扫描结果（不是"扫了算 0"）
    expect(scanned.has(EXEMPT_FILE)).toBe(false);
    expect(FROZEN_MANIFEST[EXEMPT_FILE]).toBeUndefined();
    // 顶层 src/*.ts 必须在扫描范围内（规格 §6 的 git pathspec 会漏，本扫描器不漏）
    expect(scanned.has('src/server.ts')).toBe(true);
    expect(scanned.has('src/mvp-server.ts')).toBe(true);
  });
});

// ═══ R2 新文件直取 ⇒ 红 ═══

describe('R2 夹具：新文件直取 ⇒ 红（点名文件与计数）', () => {
  it('R2 src/probe-new.ts 含 Date.now() ⇒ 红"新文件直取"，期望 [0,0] 实得 [1,0]', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'synova-q6-r2-'));
    try {
      mkdirSync(path.join(root, 'src'), { recursive: true });
      writeFileSync(path.join(root, 'src/probe-new.ts'), 'export function probe(): number {\n  return Date.now();\n}\n', 'utf-8');

      const violations = ratchetViolations(root, {});
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('新文件直取');
      expect(violations[0]).toContain('src/probe-new.ts: 期望 [0,0] 实得 [1,0]');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ═══ R3 既有文件 +1 ⇒ 红 ═══

describe('R3 夹具：既有文件计数 +1 ⇒ 红（新增直取）', () => {
  it('R3 src/known.ts 由 [1,1] 变 [2,1] ⇒ 红"新增直取"', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'synova-q6-r3-'));
    try {
      mkdirSync(path.join(root, 'src'), { recursive: true });
      writeFileSync(
        path.join(root, 'src/known.ts'),
        'export const a = Date.now();\nexport const b = Date.now();\nexport const c = new Date();\n',
        'utf-8',
      );
      const baseline: FrozenManifest = { 'src/known.ts': [1, 1] };

      const violations = ratchetViolations(root, baseline);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('新增直取');
      expect(violations[0]).toContain('src/known.ts: 期望 [1,1] 实得 [2,1]');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ═══ R4 既有文件 −1 且清单未变 ⇒ 红 ═══

describe('R4 夹具：既有文件计数 −1 且清单未变 ⇒ 红（修好未删登记）', () => {
  it('R4 src/known.ts 由 [1,1] 变 [0,1] ⇒ 红"修好未删登记"', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'synova-q6-r4-'));
    try {
      mkdirSync(path.join(root, 'src'), { recursive: true });
      writeFileSync(path.join(root, 'src/known.ts'), 'export const c = new Date();\n', 'utf-8');
      const baseline: FrozenManifest = { 'src/known.ts': [1, 1] };

      const violations = ratchetViolations(root, baseline);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('修好未删登记');
      expect(violations[0]).toContain('src/known.ts: 期望 [1,1] 实得 [0,1]');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ═══ R5 时钟实现本体豁免 ⇒ 绿 ═══

describe('R5 夹具：src/services/clock.ts 含直取 ⇒ 绿（唯一路径豁免）', () => {
  it('R5 clock.ts 直取 ⇒ 无违规；同内容换路径 ⇒ 红（豁免按路径，不按内容）', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'synova-q6-r5-'));
    try {
      mkdirSync(path.join(root, 'src/services'), { recursive: true });
      const clockBody = 'export const systemClock = {\n  now: () => Date.now(),\n  nowIso: () => new Date().toISOString(),\n};\n';
      writeFileSync(path.join(root, 'src/services/clock.ts'), clockBody, 'utf-8');

      // 豁免路径：绿，且不纳入扫描结果
      expect(ratchetViolations(root, {})).toEqual([]);
      expect(scanDirectUse(root).size).toBe(0);

      // 反向对照：同一内容放在非豁免路径 ⇒ 必红（证明不是按内容放行）
      writeFileSync(path.join(root, 'src/services/not-clock.ts'), clockBody, 'utf-8');
      const violations = ratchetViolations(root, {});
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('src/services/not-clock.ts: 期望 [0,0] 实得 [1,1]');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ═══ R6 src 不可读 ⇒ 失败（fail-closed） ═══

describe('R6 夹具：src 不可读 ⇒ 扫描失败（fail-closed，不静默跳过）', () => {
  it('R6a src 目录缺失 ⇒ 抛 ClockRatchetScanError（code 可分类）', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'synova-q6-r6a-'));
    try {
      let caught: unknown;
      try {
        scanDirectUse(root);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ClockRatchetScanError);
      if (!(caught instanceof ClockRatchetScanError)) {
        throw new Error('R6a 收窄失败：未抛出 ClockRatchetScanError');
      }
      expect(caught.code).toBe(CLOCK_RATCHET_SCAN_FAILED);
      expect(caught.message).toContain('src 不可读');
      // 抛错而非"返回空表"（若返回空表 ⇒ 棘轮会假绿）
      expect(() => scanDirectUse(root)).toThrow(ClockRatchetScanError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('R6b src 下文件不可读（悬空符号链接）⇒ 抛错并点名文件（不静默计 0）', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'synova-q6-r6b-'));
    try {
      mkdirSync(path.join(root, 'src'), { recursive: true });
      // 悬空符号链接：任何权限下读取都失败（不依赖 chmod 000 —— root 下不可靠）
      symlinkSync(path.join(root, 'missing-target.ts'), path.join(root, 'src/gone.ts'));

      let caught: unknown;
      try {
        scanDirectUse(root);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ClockRatchetScanError);
      if (!(caught instanceof ClockRatchetScanError)) {
        throw new Error('R6b 收窄失败：未抛出 ClockRatchetScanError');
      }
      expect(caught.code).toBe(CLOCK_RATCHET_SCAN_FAILED);
      expect(caught.message).toContain('文件不可读');
      expect(caught.message).toContain('src/gone.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
