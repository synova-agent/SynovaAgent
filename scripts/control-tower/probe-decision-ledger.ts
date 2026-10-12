#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-decision-ledger.ts — K12-08（#191）决策台账探针
 *
 * 用途: 把院方《02》§四飞轮铁律「**闭环内每一次人工修正，必须以结构化反馈落账，禁止静默修改**」
 *   变成一条能跑的命令 —— 台账到底**有没有落账**、落账**有没有五要素**、写台账**是不是只有一条路**。
 *
 * 判据来源（卡面 = 唯一判据源，逐字取）:
 *   `.claude/task-briefs/2026-10-11-191-K12-08-反馈一致-偏差回流到-同一个地方.md`
 *   · §Q3 V1 `probe-decision-ledger.ts` ⇒ exit 0
 *   · §Q3 V2 **单一入口**: 全仓写台账路径**只有一条**（卡面原文要求"grep 反证其它写入点 = 0"；
 *                判例 V-02 要求**行为断言**为主、grep 仅辅证 ⇒ 本探针以[L2]行为面为主、[L1]扫描为辅证）
 *   · §Q3 V3 落账: 一次产出＋复核 ⇒ 台账一行，含**五要素**（谁/岗位/什么上下文/产出什么/哪版预设）
 *   · §Q3 V4 **禁静默修改**: 人工修正必须结构化落账（反例: 静默改正 ⇒ 必红）
 *   · §Q3 V5 回流: 不合格记录 ⇒ 成为预设包再生成输入（跑一轮后预设包**版本 +1**）
 *   · §Q3 V6 反例: 摘掉 conversation-engine 的调用 ⇒ V3 **必红**
 *   · §Done `npx tsx scripts/control-tower/probe-decision-ledger.ts`（无参即跑，expectExit 0）
 *
 * 契约（铁律 47；统一探针契约的单一实现在 ./probe-ladder.ts）:
 *   @input    — **无参即跑**（卡面 Done 判据命令原文）；也接受 `--case decision-ledger` / `--all`
 *   @output   — stdout 逐条 `✅/❌/⚠️` ＋ 末行由 `out.finish()` 签发 `RESULT=<verdict>`
 *   @degraded — 目标件缺失 ⇒ **exit 2**；目标件在但断言不成立 ⇒ **exit 1**（现场判定，不假绿）
 * 退出码: 0 = 断言全部成立｜1 = 目标件在但断言不成立｜2 = 目标件不存在 / 探针无法判定
 *
 * 断言级别（禁把静态命中当唯一断言，判例 V-02）:
 *   [L1-静态可达] 文件存在 / 生产调用点扫描（**仅作辅证**，卡面 §Q3 V2 明写"grep 反证"）
 *   [L2-真跑通]   动态 import `src/l4/decision-capture.ts` 并**真调用**其导出的写入入口，
 *                 用记录式观测 sink 收真实写入事件（含 props），据此判五要素 / 单一入口 / 禁静默修改
 *
 * 边界（如实标注，不夸大）:
 *   ① 观测 sink（`LedgerObservationSink`）**只记录**生产件真实发出的写入事件；
 *      它对 `queryNodes` 的答复固定为"节点存在" —— 那是**图存储**（L4/SQLite）的角色，
 *      探针不联库。**被驱动的生产件是真代码、未改动**。仓库既有测试
 *      （`tests/l3/decision-capture-wiring.test.ts` / `tests/l4/entity-resolver.test.ts`）
 *      用的是同一最小 store 形状（`createGraphBridge(store, graph)` 本身就是注入式）。
 *   ② 调用形状是**声明的驱动约定**（见下），非判据本身；全部形状都驱动不动 ⇒ 报「无法判定」exit 2。
 *   ③ V6 的"摘掉调用 ⇒ V3 必红"**未被完全复现**: 本探针在**模块入口**驱动（不穿 conversation-engine），
 *      故 V3 对调用点不敏感；调用点存在性单独按 [L1] 断言（这是本探针与卡面 V6 措辞的已知出入）。
 *   ④ 五要素按**值**断言（不猜字段名）: 传入五个哨兵值，看真实写入行里**值**在不在。
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import {
  ProbeOutput,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  ProbeError,
  type ProbeModule,
} from './probe-ladder';

// ══════════════════════════════════════════════════════════════════════════════
// 一、常量
// ══════════════════════════════════════════════════════════════════════════════

/** 目标件（卡面 §Q2 写集: 收口单一入口） */
const LEDGER_MODULE_REL = 'src/l4/decision-capture.ts';
/** 卡面 §Q3 V6 点名的生产调用点 */
const WIRING_CALLER_REL = 'src/agent/conversation-engine.ts';
/** 写入口名（卡面 §Q2 现状: `captureDecision`；发现规则见文件头边界②） */
const WRITE_ENTRY_HINT_RE = /^(capture|record|append|write|log|add)/i;

/**
 * 本探针判据所依赖的目标件（仓库相对路径）——供 ladder 的不变式「报 PASS ⇒ TARGETS 非空且全部存在」机械校验。
 *
 * 现状取值（**当前确存在**，非占位）:
 *   · `src/l4/decision-capture.ts` —— 本探针真 import 并**驱动**它的写入口 `captureDecision`：
 *     §Q3 V3（五要素落账）/ V2（模块内单一写入口）/ V4（禁静默修改）三条 [L2] 判据的**唯一来源**。
 *     该件消失 ⇒ 本探针的全部 [L2] 断言无效 ⇒ 不许报绿。
 */
export const TARGETS: readonly string[] = ['src/l4/decision-capture.ts'];

/**
 * 五要素哨兵值（**按值断言**，不猜字段名 —— 卡面 §Q3 V3 原文: 谁/岗位/什么上下文/产出什么/哪版预设）
 */
const SENTINELS: readonly { readonly element: string; readonly value: string; readonly aliases: readonly string[] }[] = [
  { element: '谁', value: 'PROBE-WHO-9001', aliases: ['who', 'userId', 'actor', 'actorId', 'operator'] },
  { element: '岗位', value: 'PROBE-ROLE-9002', aliases: ['role', 'roleId', 'position', 'post', 'jobRole'] },
  { element: '什么上下文', value: 'PROBE-CTX-9003', aliases: ['context', 'contextRef', 'contextId', 'contextSnapshot'] },
  { element: '产出什么', value: 'PROBE-OUT-9004', aliases: ['output', 'outputRef', 'artifact', 'artifactId', 'produced'] },
  { element: '哪版预设', value: 'PROBE-PRESET-V9005', aliases: ['presetVersion', 'presetPackVersion', 'preset', 'presetId', 'presetPack'] },
];
/** V4 结构化修正的哨兵值 */
const MODIFIED_SENTINEL = 'PROBE-MODIFIED-9006';
/** V5 回流的哨兵值（不合格记录） */
const REJECT_REASON = 'PROBE-不合格-9007';

export const KNOWN_CASES: readonly string[] = ['decision-ledger'];

// ══════════════════════════════════════════════════════════════════════════════
// 二、小工具
// ══════════════════════════════════════════════════════════════════════════════

/** `unknown` 收窄为记录（铁律 38 替代式：内联类型 ＋ 类型守卫） */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

function toProbeError(err: unknown, code: string, phase: string, retryable = false): ProbeError {
  if (err instanceof ProbeError) return err;
  return new ProbeError(code, phase, err instanceof Error ? err.message : String(err), retryable);
}

function observe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (err: unknown) {
    return `[unserializable: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

async function importModule(abs: string, phase: string): Promise<Record<string, unknown>> {
  let mod: unknown;
  try {
    mod = await import(abs);
  } catch (err: unknown) {
    throw toProbeError(err, 'IMPORT_FAILED', phase, true);
  }
  const rec = asRecord(mod);
  if (rec === undefined) {
    throw new ProbeError('IMPORT_SHAPE_DRIFT', phase, `动态 import 未返回模块对象: ${abs}`);
  }
  return rec;
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、观测 sink（记录式；边界见文件头①）
// ══════════════════════════════════════════════════════════════════════════════

interface LedgerWriteEvent {
  readonly edgeType: string;
  readonly from: string;
  readonly to: string;
  readonly weight: number | undefined;
  readonly props: Record<string, unknown> | undefined;
  /** 该事件的完整可读形态（五要素按值断言的观测面） */
  readonly text: string;
}

/**
 * 记录式观测 sink —— **只记录**生产件真实发出的写入事件，不替被测件做任何决定。
 * `queryNodes` 的答复固定为「节点存在」（图存储的角色；真实图存储在 L4/SQLite，探针不联库）。
 */
class LedgerObservationSink {
  readonly writes: LedgerWriteEvent[] = [];
  readonly queries: string[] = [];

  constructor(private readonly nodeExists: boolean = true) {}

  queryNodes(type: string, filters?: Record<string, unknown>): Array<{ id: string }> {
    const requested =
      typeof filters?.['id'] === 'string' ? String(filters['id']) : `probe-${this.queries.length}`;
    this.queries.push(`${type}:${requested}`);
    return this.nodeExists ? [{ id: requested }] : [];
  }

  createEdge(
    type: string,
    from: string,
    to: string,
    weight?: number,
    props?: Record<string, unknown>,
  ): string {
    this.writes.push({
      edgeType: type,
      from,
      to,
      weight,
      props,
      text: observe({ type, from, to, weight, props }),
    });
    return `probe-edge-${this.writes.length}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、输入构造（五要素按**值**断言 ⇒ 输入用别名超集，不猜单一字段名）
// ══════════════════════════════════════════════════════════════════════════════

function buildDecisionInput(action: 'confirmed' | 'rejected' | 'modified'): Record<string, unknown> {
  const input: Record<string, unknown> = {
    nodeId: 'probe-node-1',
    action,
    reason: action === 'rejected' ? REJECT_REASON : 'probe-decision',
  };
  for (const s of SENTINELS) {
    for (const alias of s.aliases) input[alias] = s.value;
  }
  if (action === 'modified') {
    input['modifiedProps'] = { severity: MODIFIED_SENTINEL };
    input['correction'] = { field: 'severity', to: MODIFIED_SENTINEL };
  }
  return input;
}

type Callable = { readonly name: string; readonly fn: (...args: unknown[]) => unknown };

/** 写入口发现（声明的驱动约定；优先命中 WRITE_ENTRY_HINT_RE，否则退化为全部具参导出） */
function pickWriteEntries(mod: Record<string, unknown>): Callable[] {
  const all: Callable[] = Object.entries(mod)
    .filter(([, value]) => typeof value === 'function')
    .map(([name, value]) => ({ name, fn: value as (...a: unknown[]) => unknown }))
    .filter((e) => e.fn.length >= 1);
  const hinted = all.filter((e) => WRITE_ENTRY_HINT_RE.test(e.name));
  return hinted.length > 0 ? hinted : all;
}

interface DriveResult {
  readonly entry: string;
  readonly shape: string;
  readonly calls: number;
  readonly writes: number;
  readonly returned: string;
}

/**
 * 真调用写入口 —— L2 断言的唯一来源。
 *
 * @input  sink ＋ input（决策输入）＋ 额外参数表
 * @output 真调用结果（含 sink 上真实的写入事件，读 `sink.writes`）
 * @degrade 入口不可调用 / 全部形状均抛 ⇒ 抛 ProbeError（⇒ 「无法判定」exit 2）
 */
function driveWriteEntry(
  sink: LedgerObservationSink,
  graph: string,
  input: Record<string, unknown>,
  entries: readonly Callable[],
): DriveResult[] {
  const shapes: readonly { readonly label: string; readonly build: () => unknown[] }[] = [
    { label: '(sink, graph, input)', build: () => [sink, graph, input] },
    { label: '(input, sink, graph)', build: () => [input, sink, graph] },
    { label: '({sink, graph, input})', build: () => [{ sink, graph, input }] },
    { label: '(input)', build: () => [input] },
  ];
  const results: DriveResult[] = [];
  for (const entry of entries) {
    for (const shape of shapes) {
      const before = sink.writes.length;
      let returned = '';
      try {
        returned = observe(entry.fn(...shape.build()));
      } catch (err: unknown) {
        // 铁律 24/32: 驱动失败必须可见且带 code/phase（不算"被拒"，因此不进语义判定）
        const e = toProbeError(err, 'ENTRY_THREW', `drive:${entry.name}${shape.label}`);
        returned = `[threw ${e.code}/${e.phase}] ${e.message}`;
      }
      results.push({
        entry: entry.name,
        shape: shape.label,
        calls: 1,
        writes: sink.writes.length - before,
        returned,
      });
    }
  }
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、辅证扫描（[L1]；卡面 §Q3 V2 的 grep 反证 —— **不进唯一断言**）
// ══════════════════════════════════════════════════════════════════════════════

/** 目录项的最小结构面（避开 `Dirent` 的重载泛型；只用到 name ＋ isDirectory） */
interface ScanEntry {
  readonly name: string;
  isDirectory(): boolean;
}

function readDirOrThrow(dirAbs: string): ScanEntry[] {
  try {
    return readdirSync(dirAbs, { withFileTypes: true });
  } catch (err: unknown) {
    throw toProbeError(err, 'SCAN_DIR_FAILED', 'aux-scan', true);
  }
}

/** 生产代码里对写入口的**调用**点（排除定义文件与测试；`import type` / re-export 不算调用） */
function scanProductionCallSites(root: string, entryNames: readonly string[]): string[] {
  const hits: string[] = [];
  const callRe = new RegExp(`\\b(${entryNames.join('|')})\\s*\\(`, 'g');
  const walk = (dirAbs: string): void => {
    for (const entry of readDirOrThrow(dirAbs)) {
      const abs = join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(abs);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (abs.endsWith(LEDGER_MODULE_REL)) continue; // 定义处不算调用点
      let body: string;
      try {
        body = readFileSync(abs, 'utf8');
      } catch (err: unknown) {
        throw toProbeError(err, 'SCAN_READ_FAILED', `aux-scan:${entry.name}`, true);
      }
      if (callRe.test(body)) hits.push(relative(root, abs));
      callRe.lastIndex = 0;
    }
  };
  walk(join(root, 'src'));
  return hits.sort();
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、断言
// ══════════════════════════════════════════════════════════════════════════════

function assertFiveElements(out: ProbeOutput, rowText: string, label: string): void {
  for (const s of SENTINELS) {
    if (rowText.includes(s.value)) {
      out.pass(`${label} 五要素之一已落账: 【${s.element}】值 ${s.value}`, 'L2');
    } else {
      out.fail(`${label} 五要素缺失: 【${s.element}】值 ${s.value} **未**出现在台账写入行里`, 'L2');
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、主流程
// ══════════════════════════════════════════════════════════════════════════════

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('probe-decision-ledger（K12-08 / #191）');

  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    const e = toProbeError(err, 'REPO_ROOT_NOT_FOUND', 'bootstrap');
    out.error(`无法定位仓库根: ${e.message}`);
    out.finish();
    return 2;
  }
  out.note(`PROBE=probe-decision-ledger card=K12-08(#191) repoRoot=${root}`);

  try {
    parseProbeArgs(KNOWN_CASES, argv);
  } catch (err: unknown) {
    const e = toProbeError(err, 'ARGS_INVALID', 'args');
    out.error(`参数不可识别: ${e.message}`);
    out.finish();
    return 2;
  }

  // 目标件闸: 缺失 ⇒ exit 2（本卡目标件**已存在** ⇒ 走现场判定，不许 2）
  if (!assertTargetsExist(root, out, [LEDGER_MODULE_REL])) {
    out.finish();
    return 2;
  }

  const mod = await importModule(join(root, LEDGER_MODULE_REL), 'ledger-drive');
  const entries = pickWriteEntries(mod);
  if (entries.length === 0) {
    out.notImplemented('无法判定: 决策台账模块未导出任何可调用的写入口');
    out.finish();
    return 2;
  }
  out.note(`导出的可调用面 = ${Object.entries(mod).filter(([, v]) => typeof v === 'function').map(([k]) => k).join(', ')}`);

  // ── V3 落账: 一次产出＋复核 ⇒ 一行含五要素 ──────────────────────────────────
  out.case('V3 落账（产出＋复核 ⇒ 台账一行，五要素）');
  const sink3 = new LedgerObservationSink(true);
  const drive3 = driveWriteEntry(sink3, 'org-probe', buildDecisionInput('confirmed'), entries);
  const produced = drive3.filter((d) => d.writes > 0);
  out.note(
    `驱动 ${drive3.length} 次（入口 × 形状）；产出写入的驱动 = ${
      produced.length === 0 ? '(无)' : produced.map((p) => `${p.entry}${p.shape}×${p.writes}`).join(', ')
    }`,
  );
  if (sink3.writes.length === 0) {
    out.fail('V3 一次产出＋复核**未产生任何台账写入**（全部驱动形状都不写入）', 'L2');
  } else {
    out.pass(`V3 决策被写入台账: ${sink3.writes.length} 个写入事件`, 'L2');
    assertFiveElements(out, sink3.writes.map((w) => w.text).join(' | '), 'V3');
  }

  // ── V2 单一入口: 行为面为主（其它导出不得写台账）＋ grep 为辅证 ──────────────
  out.case('V2 单一入口（全仓写台账路径只有一条）');
  const sink2 = new LedgerObservationSink(true);
  const canonical = entries[0];
  driveWriteEntry(sink2, 'org-probe', buildDecisionInput('confirmed'), [canonical]);
  const canonicalWrites = sink2.writes.length;
  if (canonicalWrites > 0) {
    out.pass(`V2 规范入口 "${canonical.name}" 真写入 ${canonicalWrites} 个事件（行为面）`, 'L2');
  } else {
    out.fail(`V2 规范入口 "${canonical.name}" 未写入任何事件 ⇒ 入口不成立`, 'L2');
  }

  const others = Object.entries(mod)
    .filter(([, v]) => typeof v === 'function')
    .map(([name, v]) => ({ name, fn: v as (...a: unknown[]) => unknown }))
    .filter((e) => e.name !== canonical.name);
  if (others.length === 0) {
    out.pass('V2 模块只导出一个可调用面 ⇒ 模块内不存在第二条写台账的路（行为面）', 'L2');
  } else {
    const sinkOther = new LedgerObservationSink(true);
    driveWriteEntry(sinkOther, 'org-probe', buildDecisionInput('confirmed'), others);
    if (sinkOther.writes.length === 0) {
      out.pass(`V2 其余 ${others.length} 个导出均未写台账（无第二条写路径）`, 'L2');
    } else {
      out.fail(
        `V2 存在**第二条写台账路径**: ${others.map((o) => o.name).join(', ')} 产生了 ${sinkOther.writes.length} 个写入`,
        'L2',
      );
    }
  }

  const callSites = scanProductionCallSites(root, entries.map((e) => e.name));
  out.note(
    `[L1 辅证] 生产代码里对写入口的调用点 = ${callSites.length} 处` +
      `${callSites.length === 0 ? '（无）' : `: ${callSites.join(', ')}`}`,
  );

  // ── V4 禁静默修改 ─────────────────────────────────────────────────────────
  out.case('V4 禁静默修改（人工修正必须结构化落账）');
  const sink4 = new LedgerObservationSink(true);
  driveWriteEntry(sink4, 'org-probe', buildDecisionInput('modified'), [canonical]);
  const modifiedRow = sink4.writes.map((w) => w.text).join(' | ');
  if (sink4.writes.length === 0) {
    out.fail('V4 人工修正**未落账**（静默修改）—— 卡面 §Q3 V4 反例', 'L2');
  } else if (modifiedRow.includes(MODIFIED_SENTINEL)) {
    out.pass(`V4 人工修正结构化落账: 修正常量 ${MODIFIED_SENTINEL} 出现在台账行里`, 'L2');
  } else {
    out.fail(`V4 修正落账但**未带结构化修正内容**（值 ${MODIFIED_SENTINEL} 不在行里）`, 'L2');
  }
  // 失败路径不得静默改: 节点不存在 ⇒ 零写入 ＋ 失败由**返回值**显式表达（铁律 24/31 不静默降级）
  const sink4b = new LedgerObservationSink(false);
  const drive4b = driveWriteEntry(sink4b, 'org-probe', buildDecisionInput('modified'), [canonical]);
  const canonicalFailRow = drive4b.find((d) => d.shape === '(sink, graph, input)');
  const explicitFailure =
    canonicalFailRow !== undefined && /recorded["']?\s*:\s*false|false|error|失败|拒绝/i.test(canonicalFailRow.returned);
  if (sink4b.writes.length === 0) {
    out.pass('V4 目标节点不存在时：零写入（不静默改）', 'L2');
  } else {
    out.fail(`V4 目标节点不存在时仍产生 ${sink4b.writes.length} 个写入 ⇒ 静默改正`, 'L2');
  }
  if (explicitFailure) {
    out.pass(`V4 失败路径由返回值显式表达（非静默吞）: ${canonicalFailRow.returned.slice(0, 160)}`, 'L2');
  } else {
    out.fail(
      `V4 失败路径**未**由返回值显式表达（拿不到 recorded=false 类信号）` +
        `${canonicalFailRow === undefined ? '：规范形状未被驱动' : `: ${canonicalFailRow.returned.slice(0, 160)}`}`,
      'L2',
    );
  }

  // ── V5 回流: 不合格记录 ⇒ 预设包再生成输入（版本 +1） ──────────────────────
  out.case('V5 回流（不合格 ⇒ 预设包再生成输入，版本 +1）');
  const sink5 = new LedgerObservationSink(true);
  driveWriteEntry(sink5, 'org-probe', buildDecisionInput('rejected'), [canonical]);
  const reflowRow = sink5.writes.map((w) => w.text).join(' | ');
  if (sink5.writes.length === 0) {
    out.fail('V5 不合格记录**未落账** ⇒ 回流无输入', 'L2');
  } else {
    if (sink5.writes.map((w) => w.text).join(' ').includes(SENTINELS[4].value)) {
      out.pass(`V5 不合格行带预设版本（值 ${SENTINELS[4].value}）⇒ 具备"版本 +1"的基线`, 'L2');
    } else {
      out.fail('V5 不合格行**未带预设版本** ⇒ 无法据此把预设包版本 +1（卡面 §Q3 V5）', 'L2');
    }
    if (/reflow|回流|regenerat|再生成|regen/i.test(reflowRow)) {
      out.pass('V5 不合格行被标记为"预设包再生成输入"', 'L2');
    } else {
      out.fail('V5 不合格行**未**标记为"预设包再生成输入"（卡面 §Q3 V5）', 'L2');
    }
  }

  // ── V6 生产调用点（[L1]；措辞出入见文件头边界③） ───────────────────────────
  out.case('V6 生产调用点（摘掉调用 ⇒ V3 必红）');
  if (callSites.length > 0) {
    out.pass(`生产代码存在写台账调用点（${callSites.join(', ')}）`, 'L1');
  } else {
    out.fail(
      `生产代码**无**写台账调用点 ⇒ 台账在生产路径上根本不会被写（卡面 §Q3 V6: ` +
        `摘掉 \`${WIRING_CALLER_REL}\` 的调用即在此处变红；现状=从未接上）`,
      'L1',
    );
  }

  out.finish();
  return out.exitCode();
}

// 仅在直接执行时跑 CLI（被 import 时不产生副作用）。
// `ProbeModule` 标注 = 编译期契约自检: 签名漂移会当场 tsc 报错。
if (process.argv[1] && /probe-decision-ledger\.ts$/.test(process.argv[1])) {
  const self: ProbeModule = { KNOWN_CASES, main };
  self.main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(
        `probe-decision-ledger 未捕获异常: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(2);
    },
  );
}
