/**
 * l4/decision-capture.ts — 决策台账**单一入口** (K12-08 / #191 · 收口)
 *
 * 用户确认/驳回/修正根因节点时，把这一次决策**结构化落账**到决策台账
 * （Palantir 对标: Action as First-Class Citizen）。
 *
 * 病根（卡面 §〇 ②）：只做到了前四层 ⇒ 第一天一致，三个月后各自漂移。
 * 漂移的机制特别朴素：**员工产出不达预期 → 老板默默改掉 → agent 永远不知道"为什么不达标"**。
 * ⇒ 本文件的职责 = 把**所有**偏差/人工修正**收口到同一条写入路径**，
 *   并让"静默修改"物理上存不下来（拒落账 ≠ 悄悄改掉）。
 *
 * 本卡在架构中的位置（宪章 §2.7 第⑤层「反馈一致」＋ ⑥ 进化回环）：
 *   产出/复核 → 本文件（唯一入口）→ 台账行（五要素）→ 不合格 ⇒ 预设包再生成输入
 *
 * 三条结构性约束（卡面 §Q3 V2/V4/V5）：
 *   ① **单一入口**：全仓写决策台账只许经过 `captureDecision` 一处
 *      （反证锚点 = `DECISION_LEDGER_SCHEMA`，他处命中即 V2 红）。
 *   ② **禁静默修改**：改写同一产出（内容指纹变了）或 "修正" 而无结构化声明 ⇒ 拒落账
 *      （不写、返回 recorded:false ＋ code=SILENT_MODIFICATION）。
 *   ③ **回流**：不合格记录（review.verdict='fail' 或 action='rejected'）本身就是
 *      预设包再生成的输入；宿主注入 `presetPack` 端口 ⇒ 当场跑一轮、版本 +1。
 *
 * 依赖注入（卡面 §Q1 借 DSH「值依赖按名声明、宿主注入」）：
 *   本文件**不 import** 预设包内容面（K12-01 写集），也不 import 输出契约校验器
 *   （K12-06 写集）；两者都以**端口**形式由宿主注入（`DecisionLedgerOptions`）。
 *   端口缺失 ⇒ 能力降级但**显式可见**（result.priorSource / row.gaps），禁静默放行（铁律 24/31）。
 */
import { NodeType } from '@synova/ontology';
import { createLogger } from '@synova/logger';

const log = createLogger('l4/decision-capture');

/**
 * 台账行 schema 标识 —— **V2「单一入口」的反证锚点**。
 *
 * 判据（可复跑，见卡面 §Q3 V2）:
 *   `grep -rn "decision-ledger/v1" --include="*.ts" src scripts extensions`
 *   ⇒ 除本文件外**零命中**（其它写入点 = 0）。任何"第二条写台账的路"都绕不开这个锚点：
 *     行不带 schema 即非台账行。
 */
export const DECISION_LEDGER_SCHEMA = 'decision-ledger/v1';

/** 台账行 schema 字面量类型（供宿主编排与契约自检） */
export type DecisionLedgerSchema = typeof DECISION_LEDGER_SCHEMA;

/** 未声明预设包版本时的出厂基线（预设层出厂默认不进类型，仅取值） */
const DEFAULT_PRESET_VERSION = 1;

/**
 * 决策上下文（五要素 ③「什么上下文」的结构形态）。
 * 允许字符串简化写法（宿主只关心"哪一次断面的决策"时）。
 */
export interface DecisionContext {
  /** 组织/租户 id（缺省回落到 graph 名） */
  orgId?: string;
  /** 经营循环 id（哪一次循环产出的） */
  cycleId?: string;
  /** 目标 id（该决策服务于哪个目标） */
  goalId?: string;
  /** 任务/断面引用（取证断面的任务号） */
  taskRef?: string;
  /** 一句话上下文（人可读；字符串写法即落此字段） */
  summary: string;
}

/**
 * 产出描述（五要素 ④「产出什么」的结构形态）。
 *
 * `digest` = 产出**内容**的指纹。**禁静默修改判据就看它**：同一 `ref` 换 `digest`
 * 而未声明结构化修正 ⇒ 静默改正 ⇒ 拒。
 */
export interface DecisionOutput {
  /** 产出类别（report / decision / artifact …） */
  kind?: string;
  /** 产出引用（稳定标识：节点 id / 报告号 / 文件引用） */
  ref: string;
  /** 内容指纹（缺省 ⇒ 取 ref 本身，兼容"产出即字符串"的简化写法） */
  digest?: string;
}

/** 复核结果（与产出**同批**落账 ⇒ 一次产出＋复核 = 台账一行，卡面 §Q3 V3） */
export interface DecisionReview {
  /** 合格判定：fail ⇒ 该行即成为预设包再生成输入（卡面 §Q3 V5） */
  verdict: 'pass' | 'fail';
  /** 复核人（谁复核的；缺省 = 与产出同人，等价"自检"） */
  by?: string;
  /** 复核意见 */
  reason?: string;
}

/** 结构化修正声明（**禁静默修改**的唯一合法出路，卡面 §Q3 V4） */
export interface DecisionCorrection {
  /** 被修正的字段名 */
  field?: string;
  /** 修正前取值 */
  from?: unknown;
  /** 修正后取值 */
  to?: unknown;
  /** 修正理由（人工修正必须给） */
  reason?: string;
}

/** 决策输入（向后兼容：既有调用只给 nodeId/userId/action/reason 仍然成立） */
export interface DecisionInput {
  nodeId: string;
  userId: string;
  action: 'confirmed' | 'rejected' | 'modified';
  reason?: string;
  modifiedProps?: Record<string, unknown>;
  /** 五要素 ②「岗位」—— 做出该决策的人所在岗位 / 角色包 id */
  role?: string;
  /** 五要素 ③「什么上下文」—— 字符串简化写法或结构形态 */
  context?: string | DecisionContext;
  /** 五要素 ④「产出什么」—— 字符串简化写法或结构形态 */
  output?: string | DecisionOutput;
  /** 五要素 ⑤「哪版预设」—— 产出该结果时所用的预设包版本 */
  presetVersion?: number | string;
  /** 复核结果（与产出同批落账） */
  review?: DecisionReview;
  /** 结构化修正声明（action='modified' 时必须给，否则判静默改正） */
  correction?: DecisionCorrection;
}

/**
 * 决策台账的一行（append-only；五要素 ＋ 复核 ＋ 回流留痕）。
 *
 * 只追加、可追溯：修正**不覆盖**旧行 —— 新行用 `correctsRowId` 指回被修正行，历史可回放。
 */
export interface DecisionLedgerRow {
  /** 行 schema（= DECISION_LEDGER_SCHEMA，V2 反证锚点） */
  schema: DecisionLedgerSchema;
  /** 行 id（本次落账内唯一，用于 correctsRowId 指回） */
  rowId: string;
  /** ① 谁 —— 作出该决策的人 / agent */
  who: string;
  /** ② 岗位 —— 该人当时的岗位 / 角色包 id（缺省 'unknown' 并进 gaps） */
  role: string;
  /** ③ 什么上下文 */
  context: DecisionContext;
  /** ④ 产出什么 */
  output: Required<DecisionOutput>;
  /** ⑤ 哪版预设 —— 产出该结果时所用的预设包版本 */
  presetVersion: number | string;
  /** 复核结果 */
  review: DecisionReview & { at: string };
  /** 行类别：产出行 / 结构化修正行 */
  kind: 'production' | 'correction';
  /** 结构化修正留痕（kind='correction' 时在场） */
  correction?: DecisionCorrection;
  /** 被修正的既有行 id（修正不覆盖，只指回） */
  correctsRowId?: string;
  /** 产出内容指纹（禁静默修改的比较面） */
  fingerprint: string;
  /** 不合格 ⇒ 回流留痕：本行是预设包再生成输入；跑完一轮后版本 = nextPresetVersion */
  reflow?: { input: true; nextPresetVersion?: number | string };
  /** 五要素里被缺省填充的项（**显式可见**，不静默补齐 —— 铁律 24/31） */
  gaps?: string[];
  /** 落账时间（ISO） */
  at: string;
}

/**
 * 预设包再生成端口 —— **宿主注入**（预设包内容面文件不属本卡写集，见卡面 §Q2 边界）。
 *
 * 契约：`regenerateRound` 消费不合格行（回流输入）⇒ 跑一轮 ⇒ 返回**新一轮版本**。
 * 版本 +1 是本卡 §Q3 V5 的判据面；预设包文件长什么样、写在哪，由内容面（K12-01）决定。
 */
export interface PresetPackPort {
  /** 当前预设包版本（未显式给 `presetVersion` 时作落账基线） */
  version?(): number | string;
  /**
   * 跑一轮再生成。
   * @input  inputs — 不合格台账行（本次回流输入）
   * @output 新一轮版本 ＋ 被消费的行 id
   */
  regenerateRound(inputs: readonly DecisionLedgerRow[]): {
    version: number | string;
    consumed: readonly string[];
  };
}

/** 台账单一入口的可注入端口（宿主注入 ⇒ 本文件不 import 别人写集） */
export interface DecisionLedgerOptions {
  /**
   * 台账回读面（跨进程可见的既有行）。
   * 缺失 ⇒ 回落到**进程内索引**（单一入口 ⇒ 本进程每一次落账它都看得见），
   * 并在返回值标注 `priorSource='process'`（禁把"看不见"当"没发生"）。
   */
  readPriorRows?: (outputRef: string) => readonly DecisionLedgerRow[];
  /** 预设包再生成端口；缺失 ⇒ 只标记"回流输入"，不跑轮（result.reflowed 不置位） */
  presetPack?: PresetPackPort;
}

/** 决策落账结果 */
export interface DecisionResult {
  /** 是否落账成功（false ⇒ error 必在场，禁静默） */
  recorded: boolean;
  /** 写入的决策边类型（recorded=true 时在场） */
  edgeType?: string;
  /** 失败原因（recorded=false 时在场；静默修改时带 code=SILENT_MODIFICATION） */
  error?: string;
  /** 落账行（recorded=true 时在场）—— 五要素 ＋ 复核 ＋ 回流留痕 */
  row?: DecisionLedgerRow;
  /** 本次是否跑了一轮预设包再生成（不合格 ⇒ 回流） */
  reflowed?: boolean;
  /** 再生成后的预设包版本（reflowed=true 时在场）—— 卡面 §Q3 V5「跑一轮后版本 +1」 */
  presetVersion?: number | string;
  /** 静默修改检测的既有行来源（宿主注入 / 进程内索引 / 无既有行） */
  priorSource?: 'store' | 'process' | 'none';
  /** 判为静默修改而被拒（recorded=false） */
  silentModification?: boolean;
  /** 铁律 24/31：任何降级都不静默 —— true 时 errors 必非空 */
  degraded?: boolean;
  /** 降级 / 失败信息数组（铁律 24/31：错误进数组，不吞） */
  errors?: string[];
}

// Minimal store interface（真实件 = GraphStore/SQLite；测试与探针注入最小形状）
interface DecisionStore {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{ id: string }>;
  createEdge(
    type: string, from: string, to: string, weight?: number,
    props?: Record<string, unknown>, graph?: string,
  ): string;
}

// ══════════════════════════════════════════════════════════════════════════════
// 进程内台账索引 —— 单一入口的"第二只眼"（跨进程视图由 options.readPriorRows 补）
// ══════════════════════════════════════════════════════════════════════════════
//
// 为什么不是"第二处事实": 索引里存的就是**本入口写出去的行**（同一来源、同一语义），
// 用途单一 —— 回答"同一产出上一次落账的指纹是什么"。

const priorByOutputRef = new Map<string, DecisionLedgerRow>();

/** `unknown` 收窄为记录（铁律 38 替代式：内联类型 ＋ 类型守卫，不用 any 型断言） */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 输入形状守卫 —— 非法形状必须**显式失败**，不许抛给调用方（探针会以多种形状驱动） */
function isDecisionInput(value: unknown): value is DecisionInput {
  const rec = asRecord(value);
  if (rec === undefined) return false;
  if (!isNonEmptyString(rec['nodeId'])) return false;
  if (!isNonEmptyString(rec['userId'])) return false;
  return rec['action'] === 'confirmed' || rec['action'] === 'rejected' || rec['action'] === 'modified';
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 上下文归一：字符串简化写法 → 结构形态（原文**逐字保留**在 summary，禁改写） */
function normalizeContext(
  raw: string | DecisionContext | undefined, graph: string, fallback: string,
): DecisionContext {
  if (typeof raw === 'string') return { orgId: graph, summary: raw };
  if (raw !== undefined) return { ...raw, orgId: raw.orgId ?? graph };
  return { orgId: graph, summary: fallback };
}

/** 产出归一：字符串简化写法 → 结构形态（字符串同时充当 ref 与 digest） */
function normalizeOutput(
  raw: string | DecisionOutput | undefined, fallbackRef: string,
): Required<DecisionOutput> {
  if (typeof raw === 'string') return { kind: 'artifact', ref: raw, digest: raw };
  if (raw !== undefined) {
    return { kind: raw.kind ?? 'artifact', ref: raw.ref, digest: raw.digest ?? raw.ref };
  }
  return { kind: 'decision', ref: fallbackRef, digest: fallbackRef };
}

/**
 * 产出内容指纹 —— **禁静默修改的比较面**。
 *
 * 只由产出的内容面（kind/ref/digest）决定，**不含 action 与 modifiedProps**：
 *   · 同一产出的"确认 / 驳回"是**两种判断**，不是两次改写 ⇒ 指纹不变 ⇒ 不误判静默修改
 *   · 同一 ref 换 digest（产出内容真变了）却没声明结构化修正 ⇒ 指纹变 ⇒ 判静默修改
 */
function fingerprintOf(output: Required<DecisionOutput>): string {
  return `${output.kind}::${output.ref}::${output.digest}`;
}

/**
 * 结构化修正声明是否成立（**禁静默修改**的唯一出路）。
 *
 * 成立 = action='modified' 且（给了 correction 声明 **或** 给了 modifiedProps ＋ reason）。
 * 只有"声明 ＋ 理由"齐备，才允许改写同一产出，也才允许以"修正"名义落账。
 */
function isStructuredCorrection(decision: DecisionInput): boolean {
  if (decision.action !== 'modified') return false;
  if (decision.correction !== undefined) {
    return isNonEmptyString(decision.reason) || isNonEmptyString(decision.correction.reason);
  }
  return decision.modifiedProps !== undefined && isNonEmptyString(decision.reason);
}

/** 行 id（本次落账内唯一；seq 单调 ⇒ 同毫秒多次落账不撞） */
let rowSeq = 0;
function nextRowId(prefix: string, at: string): string {
  rowSeq += 1;
  return `${prefix}-${at.replace(/[-:.TZ]/g, '').slice(0, 17)}-${rowSeq}`;
}

/**
 * 决策捕获 —— **决策台账的唯一写入入口**（卡面 §Q3 V2）。
 *
 * 契约（铁律 47）:
 *   @input  store    — 图存储（只需 queryNodes ＋ createEdge 两个原语）
 *           graph    — 图名（组织 / 租户）
 *           decision — 决策输入；五要素（谁/岗位/上下文/产出/预设版本）可选，
 *                      缺省项**显式**记进 row.gaps（不静默补齐）
 *           options  — 宿主注入端口（台账回读面 / 预设包再生成端口）
 *   @output DecisionResult — recorded=true 时带 row（台账一行）＋ edgeType；
 *           不合格行触发回流时带 reflowed=true ＋ presetVersion（新一轮版本）
 *   @degraded 端口缺失 ⇒ 能力降级但**显式可见**（priorSource / reflowed / row.gaps）；
 *           任何 catch ⇒ log.warn ＋ degraded:true ＋ 错误进 errors[]（铁律 24/31，禁静默吞）
 *   @sideEffect 落账 = 图存储 `createEdge`（append-only：只追加，不覆盖既有行）
 */
export function captureDecision(
  store: DecisionStore,
  graph: string,
  decision: DecisionInput,
  options: DecisionLedgerOptions = {},
): DecisionResult {
  if (!isDecisionInput(decision)) {
    const message = 'INVALID_INPUT: 决策输入形状不合法（需 nodeId ＋ userId ＋ action）';
    log.warn({ graph }, message);
    return { recorded: false, error: message, degraded: true, errors: [message] };
  }

  const errors: string[] = [];
  try {
    // ── 1. 节点存在性（既有语义不变；节点不在 ⇒ 不落账，失败由返回值显式表达） ──
    const node = store.queryNodes(NodeType.OUTCOME_RISK, { id: decision.nodeId }, graph)
      .concat(store.queryNodes(NodeType.ACTIVITY_GOVERNANCE /* ONTOLOGY-MIGRATION: NodeType.ACTIVITY_GOVERNANCE has no direct match. Using activity/governance (strategic alignment). */, { id: decision.nodeId }, graph))
      .concat(store.queryNodes(NodeType.OUTCOME_FINANCIAL /* ONTOLOGY-MIGRATION: NodeType.OUTCOME_FINANCIAL -> outcome/financial or resource/money? Context-dependent. */, { id: decision.nodeId }, graph));

    if (node.length === 0) {
      return { recorded: false, error: `节点 ${decision.nodeId} 不存在` };
    }

    // ── 2. 组装台账行（五要素 ＋ 复核，卡面 §Q3 V3） ──
    const at = new Date().toISOString();
    const gaps: string[] = [];
    if (!isNonEmptyString(decision.role)) gaps.push('role');
    if (decision.context === undefined) gaps.push('context');
    if (decision.output === undefined) gaps.push('output');
    if (decision.presetVersion === undefined) gaps.push('presetVersion');
    if (decision.review === undefined) gaps.push('review');

    const output = normalizeOutput(decision.output, decision.nodeId);
    const fingerprint = fingerprintOf(output);
    const presetVersion = decision.presetVersion
      ?? options.presetPack?.version?.()
      ?? DEFAULT_PRESET_VERSION;

    // ── 3. 禁静默修改（卡面 §Q3 V4）—— 两条路各堵一半 ──
    const prior = findPriorRow(decision.output, options);
    const priorSource: DecisionResult['priorSource'] = options.readPriorRows !== undefined
      ? 'store'
      : prior !== undefined ? 'process' : 'none';

    // 3a. 以"修正"名义落账，却没有任何结构化声明 ⇒ 静默改正 ⇒ 拒
    if (decision.action === 'modified' && !isStructuredCorrection(decision)) {
      const message = 'SILENT_MODIFICATION: action=modified 但未给结构化修正声明'
        + '（需 correction 声明 或 modifiedProps ＋ reason）⇒ 拒落账（禁静默改正）';
      log.error({ nodeId: decision.nodeId, outputRef: output.ref }, message);
      return {
        recorded: false, error: message, silentModification: true, priorSource, errors: [message],
      };
    }

    // 3b. 同一产出的**内容指纹**变了却没声明是修正 ⇒ 静默改写 ⇒ 拒
    if (prior !== undefined && prior.fingerprint !== fingerprint && !isStructuredCorrection(decision)) {
      const message = `SILENT_MODIFICATION: 产出 ${output.ref} 的内容指纹已变`
        + `（${prior.fingerprint} → ${fingerprint}）但未声明结构化修正`
        + " ⇒ 拒落账（禁静默修改；请给 correction ＋ reason，action='modified'）";
      log.error({ nodeId: decision.nodeId, outputRef: output.ref }, message);
      return {
        recorded: false, error: message, silentModification: true, priorSource, errors: [message],
      };
    }

    const row: DecisionLedgerRow = {
      schema: DECISION_LEDGER_SCHEMA,
      rowId: nextRowId(decision.action, at),
      who: decision.userId,
      role: isNonEmptyString(decision.role) ? decision.role : 'unknown',
      context: normalizeContext(decision.context, graph, decision.reason ?? ''),
      output,
      presetVersion,
      review: {
        verdict: decision.review?.verdict ?? (decision.action === 'rejected' ? 'fail' : 'pass'),
        by: decision.review?.by ?? decision.userId,
        reason: decision.review?.reason ?? decision.reason ?? '',
        at,
      },
      kind: decision.action === 'modified' ? 'correction' : 'production',
      correctsRowId: decision.action === 'modified' ? prior?.rowId : undefined,
      fingerprint,
      at,
      ...(gaps.length > 0 ? { gaps } : {}),
      ...(decision.correction !== undefined ? { correction: decision.correction } : {}),
    };

    // ── 4. 回流（卡面 §Q3 V5）—— 不合格即预设包再生成输入；跑一轮 ⇒ 版本 +1 ──
    const failing = row.review.verdict === 'fail';
    let reflowed = false;
    let nextPresetVersion: number | string | undefined;
    if (failing && options.presetPack !== undefined) {
      const round = options.presetPack.regenerateRound([row]);
      reflowed = true;
      nextPresetVersion = round.version;
    }
    if (failing) {
      row.reflow = {
        input: true,
        ...(nextPresetVersion !== undefined ? { nextPresetVersion } : {}),
      };
    }

    // ── 5. 落账（**全仓唯一写入点**：台账行随决策边一起落，五要素在 props.ledger 里） ──
    const edgeType = edgeTypeOf(decision.action, reflowed);
    store.createEdge(edgeType, row.who, decision.nodeId, 1, {
      reason: decision.reason ?? '',
      modifiedProps: decision.modifiedProps !== undefined ? JSON.stringify(decision.modifiedProps) : '',
      timestamp: at,
      // 台账行 = JSON 串（SQLite 友好 ＋ 单一事实源，不散成并列字段 —— 判例 M-04）
      ledger: JSON.stringify(row),
    }, graph);

    priorByOutputRef.set(output.ref, row);
    log.info({ nodeId: decision.nodeId, action: decision.action, userId: row.who }, '决策已落账');

    return {
      recorded: true,
      edgeType,
      row,
      priorSource,
      ...(reflowed ? { reflowed: true, presetVersion: nextPresetVersion } : {}),
    };
  } catch (err) {
    const message = describeError(err);
    errors.push(message);
    log.warn({ err, nodeId: decision.nodeId }, '决策记录失败');
    return { recorded: false, error: message, degraded: true, errors };
  }
}

/**
 * 决策边类型。
 *
 * 预设包再生成跑过一轮的行用 `DECISION_MODIFIED`（同一决策被"修正"到了新一版预设），
 * **不新造边类型** —— 避免与本体层（K12-07 写集）的边类型集冲突。
 */
function edgeTypeOf(action: DecisionInput['action'], reflowed: boolean): string {
  if (reflowed) return 'DECISION_MODIFIED';
  if (action === 'confirmed') return 'DECISION_CONFIRMED';
  if (action === 'rejected') return 'DECISION_REJECTED';
  return 'DECISION_MODIFIED';
}

/**
 * 决策边类型全集（= edgeTypeOf 的值域）。导出给读侧模块 `decision-ledger-readback`
 * 作单一事实源（J5 / #405）；导出的是常量数组——不新增可调用导出，
 * 不破 `decision-capture-single-entry.test.ts` 的单一写入口守卫。
 */
export const DECISION_EDGE_TYPES: readonly string[] = ['DECISION_CONFIRMED', 'DECISION_REJECTED', 'DECISION_MODIFIED'];

/**
 * 取同一产出的**既有行**（禁静默修改的比较面）。
 *
 * 来源优先级：宿主注入的 `readPriorRows`（跨进程）⇒ 进程内索引（本入口写过的行）。
 * 两处都取不到 ⇒ undefined（调用方据此标 priorSource='none'，不把"看不见"当"没发生"）。
 */
function findPriorRow(
  raw: string | DecisionOutput | undefined,
  options: DecisionLedgerOptions,
): DecisionLedgerRow | undefined {
  const ref = typeof raw === 'string' ? raw : raw?.ref;
  if (!isNonEmptyString(ref)) return undefined;
  if (options.readPriorRows !== undefined) {
    const rows = options.readPriorRows(ref);
    if (rows.length > 0) return rows[rows.length - 1];
  }
  return priorByOutputRef.get(ref);
}

