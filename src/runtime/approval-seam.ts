/**
 * src/runtime/approval-seam.ts — 人在环审批缝（K12-19 / Issue #202 / 原 RB-05）
 *
 * 产品架构位置: 宪章 §0.4 的「−1 运行时」；四层结构的**第四层（人在环）**。
 *   预设层（选）→ 解析层（算）→ 执行层（拦）→ **人在环（兜底）**
 *
 * 一句话语义: **高风险动作要人点头；无人应答 ⇒ 拒**（fail-closed —— **不是**「没人管就放行」）。
 *
 * 为什么这一层必须单列（本文件的存在理由）:
 *   任何自动化系统都有一个诱惑 —— **超时放行**（省事）。但那等于「只要没人看，什么都能干」。
 *   本缝把这条诱惑从**纪律问题**变成**结构问题**: 不改本文件，就没有任何路径能在
 *   「没人应答」时返回 `allowed === true`。
 *
 * 不变量（本文件唯一的判定律 ——「改坏即红」的对象，见 probe-approval-seam.ts 的 V2/V5）:
 *   `allowed === true` **当且仅当**宿主应答端口显式答复「批准」。
 *   其余一切路径（应答端口缺失 / 空应答 / 超时 / 非法应答 / 端口抛异常 /
 *   动作未被声明为高风险 / 策略非法 / 请求形态非法）⇒ `decision === 'rejected'`。
 *
 * 契约（铁律 47）:
 *   @input    — `requestApproval(req)`: req 是**外部输入**，字段一律按 unknown 收口逐个守卫；
 *               `resolveApprovalPolicy(declaration)`: 宿主声明（外部输入，同上）。
 *   @output   — ApprovalOutcome { decision, allowed, action, actor, audit, errors, degraded }
 *   @degraded — 三种结束语严格二分（**不把「确定的拒」伪装成降级** —— 卡面语义）:
 *       · **确定结论** ⇒ `degraded = false`: 人类批准的 approved ／ 人类拒绝的 rejected ／
 *         无应答 ／ 超时 ／ 应答端口缺失（后三条由**策略**定义成确定结论: 卡面明令「不许超时放行」）
 *       · **判不了** ⇒ `degraded = true`: 应答非法（无法解释）／ 端口抛异常 ／
 *         策略非法 ／ 请求形态非法
 *       · **每一个 catch 都写 log + 把错误文本进 `errors[]`**（铁律 24/31: 禁空吞、禁静默）
 *
 * 边界（如实标注，不隐藏）:
 *   ① 本缝**只服务高风险动作**。非高风险动作不得到此「顺手放行」—— 那会让「非高风险」
 *      变成绕过审批的后门 ⇒ 本缝对未声明为高风险的动作**一律拒**（留痕写明原因）。
 *   ② 本缝**不自带人类通道**（不 import 具体实现）。通道由宿主**按名注入** `ask` 端口
 *      （DSH 借鉴: 「按名声明 + 宿主满足」，`packages/compaction/compaction-basic/src/index.ts:114`）。
 *   ③ 本缝不落库、不写文件、不引随机数 ⇒ 同一输入同一结论（探针可复跑，判例可复核）。
 */
import { createLogger } from '@synova/logger';

const log = createLogger('runtime/approval-seam');

// ══════════════════════════════════════════════════════════════════════════════
// 一、常量
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 高风险动作清单 —— **本卡的产品判断**（不是从 DSH 借的: DSH 没有「企业高风险动作」语义）。
 *
 * 三项取自 `src/deploy/system-self-ops.ts` 的 `DANGEROUS_OPS`（该模块自称「危险操作 —
 * 需 GA 审批」，却从不真的问人）—— 本缝把这段「自称」接上真实执行体。
 * 逐项相等由 `tests/security/approval-seam.test.ts` 对 `listAvailableOps()` 断言守住，防两处口径漂移。
 */
export const HIGH_RISK_ACTIONS: readonly string[] = Object.freeze([
  'version-rollback',
  'db-repair',
  'schema-migrate',
]);

/** 应答端口缺省等待上限（宿主可在策略里覆盖；探针用短值以免拖慢判据） */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 请求者身份不可读时的留痕占位（留痕四要素之「谁」必须非空 —— 卡面 V2） */
const ACTOR_FALLBACK = '(unspecified)';

// ══════════════════════════════════════════════════════════════════════════════
// 二、类型
// ══════════════════════════════════════════════════════════════════════════════

/** 审批裁决（终态只有两态 —— 没有「等一等」「不确定」这种会被读成放行的中间态） */
export type ApprovalDecision = 'approved' | 'rejected';

/** 递给宿主应答端口的请求（端口是**宿主**的实现，本缝不知道它怎么问人） */
export interface ApprovalAskRequest {
  readonly action: string;
  readonly actor: string;
  readonly timeoutMs: number;
}

/**
 * 宿主应答端口 —— **按名注入**的「请人点头」通道。
 * 返回 `'approved'` / `'rejected'`（或 `{ approved: boolean }` / `{ decision: string }`）
 * 表示有答；返回 `undefined` / `null` / 其它无法解释的值 = **无人应答或应答非法 ⇒ 拒**。
 */
export type ApprovalAskPort = (request: ApprovalAskRequest) => unknown;

/** 审批策略 —— **已解析**的形态（未解析的声明走 `resolveApprovalPolicy`） */
export interface ApprovalPolicy {
  readonly version: number;
  readonly highRiskActions: readonly string[];
  /** 缺省裁决: **只能是 reject**（声明成其它值 ⇒ `resolveApprovalPolicy` 报错，见 fail-closed 判据） */
  readonly defaultDecision: 'reject';
  /** 等人类应答的上限，超时 ⇒ 拒（卡面: 不许超时放行） */
  readonly timeoutMs: number;
}

/**
 * 审批留痕（卡面 V2 四要素: 谁 ／ 何时 ／ 什么动作 ／ 为什么拒）。
 *
 * ⚠️ 字段名是**机器可判面**（判据按 /actor/ /timestamp/ /action/ /reason/ 逐个识别，
 * 见 `scripts/control-tower/probe-approval-seam.ts` 的 TRAIL_ASPECTS）—— 改名即改判据。
 */
export interface ApprovalAuditRecord {
  /** 谁 */
  readonly actor: string;
  /** 何时 */
  readonly timestamp: string;
  /** 什么动作 */
  readonly action: string;
  /** 为什么拒（或为什么放行） */
  readonly reason: string;
  /** 稳定机器码（拒绝/放行各自的 code，便于告警聚合） */
  readonly code: string;
  /** 是否真的收到过应答（false = 无人应答路径） */
  readonly answered: boolean;
  /** 原始应答的归一结果（无应答时为空串） */
  readonly answer: string;
}

/** 审批结论（本缝唯一的返回形态） */
export interface ApprovalOutcome {
  readonly decision: ApprovalDecision;
  /** 🔴 不变量: 仅当人类显式批准时为 true；其余一切路径为 false */
  readonly allowed: boolean;
  readonly action: string;
  readonly actor: string;
  readonly audit: ApprovalAuditRecord;
  /** 错误文本（铁律 24/31: 禁空吞 —— 判不了的原因必须能被调用方看见） */
  readonly errors: readonly string[];
  /** true = 本缝**判不了**（非确定的拒）；false = 确定结论（含确定的拒） */
  readonly degraded: boolean;
}

/** 审批请求（**外部输入** ⇒ 字段按 unknown 收口，逐个守卫） */
export interface ApprovalRequest {
  readonly action?: unknown;
  readonly actor?: unknown;
  /** 宿主注入的应答端口；缺省 = 无人应答 ⇒ 拒 */
  readonly ask?: unknown;
  /** 宿主策略（已解析形态或未解析声明均可）；缺省 = 本缝内置基线声明 */
  readonly policy?: unknown;
  /** 覆盖等待上限（探针用短值） */
  readonly timeoutMs?: unknown;
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、错误（铁律 32: .code ＋ .phase ＋ .retryable）
// ══════════════════════════════════════════════════════════════════════════════

/** 审批策略错误 —— **不导出**（导出即成为新的对外符号，而它只服务于 `resolveApprovalPolicy` 的报错语义） */
class ApprovalPolicyError extends Error {
  readonly code: string;
  readonly phase: string;
  readonly retryable: boolean;

  constructor(code: string, phase: string, message: string) {
    super(message);
    this.name = 'ApprovalPolicyError';
    this.code = code;
    this.phase = phase;
    this.retryable = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、类型守卫（铁律 38: 用守卫收口 unknown，不做 any 型断言）
// ══════════════════════════════════════════════════════════════════════════════

/** 普通对象判定（排除数组与 null） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 非空字符串清单判定 */
function isStringList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item: unknown) => typeof item === 'string' && item.length > 0);
}

/** 已解析策略判定（宿主可能直接把解析结果递进来，避免二次解析） */
function isResolvedPolicy(value: unknown): value is ApprovalPolicy {
  if (!isRecord(value)) return false;
  return (
    typeof value['version'] === 'number' &&
    isStringList(value['highRiskActions']) &&
    value['defaultDecision'] === 'reject' &&
    typeof value['timeoutMs'] === 'number'
  );
}

/** thenable 判定（应答端口可返回 Promise —— 人类应答天然异步） */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as { then?: unknown }).then === 'function';
}

/** 去掉空白后的非空字符串，否则 undefined（外部输入收口） */
function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、策略解析（V4 的载体: 声明缺失即报错，不静默放行）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 解析审批策略声明。
 *
 * 契约（铁律 47）:
 *   @input  — declaration: 宿主提供的声明（外部输入 ⇒ unknown 收口）。
 *             期望形态 `{ version:number, highRiskActions:string[], defaultDecision:'reject', timeoutMs?:number }`。
 *   @output — ApprovalPolicy（已冻结）。
 *   @error  — 声明**缺失** ⇒ 抛 `APPROVAL_POLICY_UNDECLARED`（卡面 V4: 不许静默放行）；
 *             形态非法 ⇒ `APPROVAL_POLICY_MALFORMED`；
 *             缺省裁决不是 reject ⇒ `APPROVAL_POLICY_NOT_FAIL_CLOSED`。
 *             **返回类型里没有「失败」这一态** —— 宁可炸在启动期，也不给调用方一个
 *             看起来正常的缺省策略（铁律 31）。
 *   @degrade — 无降级路径: 本函数**不做**兜底放行。
 */
export function resolveApprovalPolicy(declaration?: unknown): ApprovalPolicy {
  if (declaration === undefined) {
    throw new ApprovalPolicyError(
      'APPROVAL_POLICY_UNDECLARED',
      'policy',
      '审批策略声明缺失 ⇒ 报错（不静默放行；卡面 V4 ／ 铁律 31）',
    );
  }
  if (!isRecord(declaration)) {
    throw new ApprovalPolicyError(
      'APPROVAL_POLICY_MALFORMED',
      'policy',
      `审批策略声明必须是对象，实际 ${typeof declaration}`,
    );
  }
  const version = declaration['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ApprovalPolicyError(
      'APPROVAL_POLICY_MALFORMED',
      'policy',
      `审批策略 version 必须是正整数，实际 ${String(version)}`,
    );
  }
  const actions = declaration['highRiskActions'];
  if (!isStringList(actions)) {
    throw new ApprovalPolicyError(
      'APPROVAL_POLICY_MALFORMED',
      'policy',
      '审批策略 highRiskActions 必须是非空的字符串清单',
    );
  }
  const defaultDecision = declaration['defaultDecision'];
  if (defaultDecision !== 'reject') {
    throw new ApprovalPolicyError(
      'APPROVAL_POLICY_NOT_FAIL_CLOSED',
      'policy',
      `审批策略 defaultDecision 必须是 'reject'（fail-closed），实际 ${String(defaultDecision)}`,
    );
  }
  const rawTimeout = declaration['timeoutMs'];
  const timeoutMs =
    typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout > 0
      ? rawTimeout
      : DEFAULT_TIMEOUT_MS;
  return Object.freeze({
    version,
    highRiskActions: Object.freeze([...actions]),
    defaultDecision: 'reject',
    timeoutMs,
  });
}

/**
 * 内置基线声明 —— **本仓自带的声明**（宿主可用自己的声明覆盖）。
 *
 * 🔴 它同时是「启动期报错」的牙齿: 下面这一次 `resolveApprovalPolicy(...)` 在**模块加载期**执行
 * ——若基线声明被改坏（缺字段 / defaultDecision 改成正向），**import 本模块即失败**，
 * 不是等到某次审批才悄悄放行。
 */
const DEFAULT_POLICY: ApprovalPolicy = resolveApprovalPolicy({
  version: 1,
  highRiskActions: HIGH_RISK_ACTIONS,
  defaultDecision: 'reject',
});

// ══════════════════════════════════════════════════════════════════════════════
// 六、应答归一（**拒的每一条路径都在这里显式成形**）
// ══════════════════════════════════════════════════════════════════════════════

/** 应答解析结果: 要么「有答」（answer 只可能是两态之一），要么「没答」（带拒绝理由） */
type AnswerResolution =
  | { readonly kind: 'answered'; readonly answer: ApprovalDecision }
  | {
      readonly kind: 'no-answer';
      readonly code: string;
      readonly reason: string;
      /** 判不了 ⇒ true（确定的拒 ⇒ false） */
      readonly degraded: boolean;
    };

/** 构造「没答」结论（统一出口，避免散落的 return 各写各的 code） */
function noAnswer(code: string, reason: string, degraded: boolean): AnswerResolution {
  return { kind: 'no-answer', code, reason, degraded };
}

/**
 * 归一化「请人点头」的原始应答。
 *
 * 契约（铁律 47）:
 *   @input  — value: 应答端口返回的任意值（外部输入）
 *   @output — AnswerResolution: 只有 `'approved'` / `'rejected'` 算「有答」；**其余一律算没答**
 *   @degrade — 无法解释 ⇒ `degraded=true` + `APPROVAL_ANSWER_ILLEGAL`（判不了 ⇒ 拒，铁律 31）
 */
function classifyAnswer(value: unknown): AnswerResolution {
  if (value === undefined || value === null) {
    return noAnswer('APPROVAL_NO_ANSWER', '无人应答（应答端口未给出任何答复）⇒ 拒', false);
  }
  if (isRecord(value)) {
    const approved = value['approved'];
    if (typeof approved === 'boolean') {
      return { kind: 'answered', answer: approved ? 'approved' : 'rejected' };
    }
    const nested = value['decision'] ?? value['answer'] ?? value['status'];
    if (nested !== undefined) return classifyAnswer(nested);
    return noAnswer(
      'APPROVAL_ANSWER_ILLEGAL',
      `应答非法（对象里读不出裁决: ${Object.keys(value).join(',') || '(空对象)'}）⇒ 判不了 ⇒ 拒`,
      true,
    );
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'approved' || normalized === 'approve') {
      return { kind: 'answered', answer: 'approved' };
    }
    if (normalized === 'rejected' || normalized === 'reject') {
      return { kind: 'answered', answer: 'rejected' };
    }
    return noAnswer(
      'APPROVAL_ANSWER_ILLEGAL',
      `应答非法（无法解释的裁决字面量 "${value}"）⇒ 判不了 ⇒ 拒`,
      true,
    );
  }
  return noAnswer(
    'APPROVAL_ANSWER_ILLEGAL',
    `应答非法（类型 ${typeof value} 不是可识别的裁决）⇒ 判不了 ⇒ 拒`,
    true,
  );
}

/** 等待结果: 值 ／ 抛异常 ／ 超时（三态显式，不靠 `undefined` 兼任多义） */
type Settled =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'timeout' };

/**
 * 等待应答，并**强制施加超时**（卡面: 不许超时放行 ⇒ 超时是一种确定的拒，不是挂死）。
 *
 * 契约（铁律 47）:
 *   @input  — pending: 应答端口的返回值（可能是同步值，也可能是 Promise）／ timeoutMs
 *   @output — Settled 三态；同步值直接返回 `{kind:'value'}`，Promise 走竞速
 *   @degrade — 超时 ⇒ `{kind:'timeout'}`（调用方据此判拒；**绝不**把超时当成"再等等"）
 */
async function settleWithTimeout(pending: unknown, timeoutMs: number): Promise<Settled> {
  if (!isThenable(pending)) return { kind: 'value', value: pending };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Settled>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });
  const settled = new Promise<Settled>((resolve) => {
    pending.then(
      (value: unknown) => resolve({ kind: 'value', value }),
      (err: unknown) => resolve({ kind: 'rejected', message: err instanceof Error ? err.message : String(err) }),
    );
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 走完「请人点头」全流程 —— **本缝判定的核心**。
 *
 * 契约（铁律 47）:
 *   @input  — port: 宿主应答端口（unknown，因为它是外部注入）；req: 递给人看的动作与请求者
 *   @output — AnswerResolution（有答两态 ／ 没答四因）
 *   @degrade — 端口缺失 ➜ 确定的拒（`degraded=false`）；
 *             端口抛异常 ➜ 判不了 ⇒ 拒（`degraded=true`，且 log.error + 文本上抛给 errors[]）；
 *             超时 ➜ 端口缺失同款的**确定的拒**（策略已定义: 等不到人 = 没人应答）
 */
async function resolveAnswerRaw(port: unknown, req: ApprovalAskRequest): Promise<{ readonly resolution: AnswerResolution; readonly errors: readonly string[] }> {
  if (typeof port !== 'function') {
    return {
      resolution: noAnswer(
        'APPROVAL_ANSWER_PORT_MISSING',
        '应答端口缺失（宿主未按名注入 ask）⇒ 视为无人应答 ⇒ 拒',
        false,
      ),
      errors: [],
    };
  }

  let raw: unknown;
  try {
    raw = (port as (request: ApprovalAskRequest) => unknown)(req);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { code: 'APPROVAL_ANSWER_PORT_THREW', action: req.action, actor: req.actor, err: message },
      '审批应答端口抛异常 ⇒ 判不了 ⇒ 按 fail-closed 判拒（铁律 24: 不空吞）',
    );
    return {
      resolution: noAnswer(
        'APPROVAL_ANSWER_PORT_THREW',
        `应答端口抛异常（${message}）⇒ 判不了 ⇒ 拒`,
        true,
      ),
      errors: [`APPROVAL_ANSWER_PORT_THREW: ${message}`],
    };
  }

  const settled = await settleWithTimeout(raw, req.timeoutMs);
  if (settled.kind === 'timeout') {
    return {
      resolution: noAnswer(
        'APPROVAL_ANSWER_TIMEOUT',
        `等待应答超过 ${req.timeoutMs}ms ⇒ 视为无人应答 ⇒ 拒（卡面: 不许超时放行）`,
        false,
      ),
      errors: [],
    };
  }
  if (settled.kind === 'rejected') {
    log.error(
      { code: 'APPROVAL_ANSWER_PORT_REJECTED', action: req.action, err: settled.message },
      '审批应答端口返回的 Promise 被拒绝 ⇒ 判不了 ⇒ 按 fail-closed 判拒',
    );
    return {
      resolution: noAnswer(
        'APPROVAL_ANSWER_PORT_THREW',
        `应答端口的 Promise 被拒绝（${settled.message}）⇒ 判不了 ⇒ 拒`,
        true,
      ),
      errors: [`APPROVAL_ANSWER_PORT_THREW: ${settled.message}`],
    };
  }
  return { resolution: classifyAnswer(settled.value), errors: [] };
}

/**
 * 「请人点头」的唯一出口 —— 在 raw 实现之外**强制**一条不变量:
 *   **判不了（degraded=true）必须留下错误文本**（铁律 24/31: 禁空吞；判不了的原因必须能被调用方看见）。
 *
 * 为什么放在这里而不是每个分支各写一遍: 「应答非法」等分支**不抛异常**（它们不是 catch），
 * 最容易漏写 errors[] —— 由唯一出口兜住，新增分支不可能再漏（结构性，不靠自觉）。
 *
 * 契约（铁律 47）:
 *   @input  — 同 resolveAnswerRaw
 *   @output — 同 resolveAnswerRaw；但 degraded=true 时 errors 保证非空
 *   @degrade — 本函数不产生新的降级，只保证降级信号**不失真**
 */
async function resolveAnswer(port: unknown, req: ApprovalAskRequest): Promise<{ readonly resolution: AnswerResolution; readonly errors: readonly string[] }> {
  const { resolution, errors } = await resolveAnswerRaw(port, req);
  if (resolution.kind === 'no-answer' && resolution.degraded && errors.length === 0) {
    return { resolution, errors: [`${resolution.code}: ${resolution.reason}`] };
  }
  return { resolution, errors };
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、结论构造与主入口
// ══════════════════════════════════════════════════════════════════════════════

/** 构造结论的入参（内部形态；不导出，避免对外多一个符号） */
interface OutcomeInput {
  readonly decision: ApprovalDecision;
  readonly action: string;
  readonly actor: string;
  readonly code: string;
  readonly reason: string;
  readonly answered: boolean;
  readonly answer: string;
  readonly errors: readonly string[];
  readonly degraded: boolean;
  readonly timestamp: string;
}

/** 构造结论 —— `allowed` 由 `decision` **唯一派生**，杜绝二者漂移（不变量: allowed ⇔ approved） */
function buildOutcome(input: OutcomeInput): ApprovalOutcome {
  return {
    decision: input.decision,
    allowed: input.decision === 'approved',
    action: input.action,
    actor: input.actor,
    audit: {
      actor: input.actor,
      timestamp: input.timestamp,
      action: input.action,
      reason: input.reason,
      code: input.code,
      answered: input.answered,
      answer: input.answer,
    },
    errors: input.errors,
    degraded: input.degraded,
  };
}

/**
 * 请求一次人在环审批 —— **本缝唯一的对外入口**。
 *
 * 契约（铁律 47）:
 *   @input  — req: ApprovalRequest（外部输入；缺字段一律走 fail-closed 分支，**不抛异常**）
 *   @output — ApprovalOutcome；`allowed` 遵循不变量「仅人类显式批准才为 true」
 *   @degrade — 见文件头 @degraded 段（确定结论 vs 判不了 的二分）；判不了时 errors[] 非空 + log
 *
 * 为什么**不抛异常**: 调用方是生产入口。若本函数抛异常，调用方的 catch 会把它变成 500 ——
 *   500 虽然也拦住了动作，但（a）留痕丢失、（b）拒绝理由不可判读。
 *   本函数把「拒绝」做成**一等返回值**，让每一次拒绝都带 code + 四要素留痕。
 */
export async function requestApproval(req: ApprovalRequest | undefined): Promise<ApprovalOutcome> {
  const timestamp = new Date().toISOString();

  // ① 请求形态守卫（外部输入）
  if (!isRecord(req)) {
    const outcome = buildOutcome({
      decision: 'rejected',
      action: '(invalid)',
      actor: ACTOR_FALLBACK,
      code: 'APPROVAL_REQUEST_INVALID',
      reason: '审批请求不是对象 ⇒ 判不了 ⇒ 拒',
      answered: false,
      answer: '',
      errors: ['APPROVAL_REQUEST_INVALID: 审批请求不是对象'],
      degraded: true,
      timestamp,
    });
    log.warn({ code: outcome.audit.code }, outcome.audit.reason);
    return outcome;
  }

  const actor = asNonEmptyString(req['actor']) ?? ACTOR_FALLBACK;
  const action = asNonEmptyString(req['action']);
  if (action === undefined) {
    const outcome = buildOutcome({
      decision: 'rejected',
      action: '(missing)',
      actor,
      code: 'APPROVAL_ACTION_MISSING',
      reason: '审批请求未给出动作名 ⇒ 判不了"要不要人点头" ⇒ 拒',
      answered: false,
      answer: '',
      errors: ['APPROVAL_ACTION_MISSING: 请求缺 action'],
      degraded: true,
      timestamp,
    });
    log.warn({ code: outcome.audit.code }, outcome.audit.reason);
    return outcome;
  }

  // ② 策略解析（缺省 = 本缝内置基线声明；宿主给了非法声明 ⇒ 拒，不静默用缺省）
  let policy: ApprovalPolicy;
  const rawPolicy = req['policy'];
  if (rawPolicy === undefined) {
    policy = DEFAULT_POLICY;
  } else if (isResolvedPolicy(rawPolicy)) {
    policy = rawPolicy;
  } else {
    try {
      policy = resolveApprovalPolicy(rawPolicy);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = buildOutcome({
        decision: 'rejected',
        action,
        actor,
        code: 'APPROVAL_POLICY_INVALID',
        reason: `宿主审批策略非法（${message}）⇒ 判不了 ⇒ 拒（不回落到缺省策略）`,
        answered: false,
        answer: '',
        errors: [`APPROVAL_POLICY_INVALID: ${message}`],
        degraded: true,
        timestamp,
      });
      log.error({ code: outcome.audit.code, action, err: message }, outcome.audit.reason);
      return outcome;
    }
  }

  const timeoutOverride = req['timeoutMs'];
  const timeoutMs =
    typeof timeoutOverride === 'number' && Number.isFinite(timeoutOverride) && timeoutOverride > 0
      ? timeoutOverride
      : policy.timeoutMs;

  // ③ 高风险动作判定 —— 非高风险**不自动放行**（否则"非高风险"就是绕过审批的后门）
  if (!policy.highRiskActions.includes(action)) {
    const outcome = buildOutcome({
      decision: 'rejected',
      action,
      actor,
      code: 'APPROVAL_ACTION_NOT_HIGH_RISK',
      reason: `动作 "${action}" 未在声明的「高风险动作」清单内 ⇒ 本缝不得代为放行（非高风险不是绕过审批的后门）`,
      answered: false,
      answer: '',
      errors: [],
      degraded: false,
      timestamp,
    });
    log.warn({ code: outcome.audit.code, action, actor }, outcome.audit.reason);
    return outcome;
  }

  // ④ 请人点头
  const askRequest: ApprovalAskRequest = { action, actor, timeoutMs };
  const { resolution, errors } = await resolveAnswer(req['ask'], askRequest);

  if (resolution.kind === 'answered') {
    const approved = resolution.answer === 'approved';
    const outcome = buildOutcome({
      decision: resolution.answer,
      action,
      actor,
      code: approved ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED_BY_HUMAN',
      reason: approved ? `人在环: ${actor} 批准了高风险动作 "${action}"` : `人在环: ${actor} 拒绝了高风险动作 "${action}"`,
      answered: true,
      answer: resolution.answer,
      errors,
      degraded: false,
      timestamp,
    });
    log.info(
      { code: outcome.audit.code, action, actor, decision: outcome.decision },
      approved ? '审批缝: 人类批准，放行高风险动作' : '审批缝: 人类拒绝，拦下高风险动作',
    );
    return outcome;
  }

  const outcome = buildOutcome({
    decision: 'rejected',
    action,
    actor,
    code: resolution.code,
    reason: resolution.reason,
    answered: false,
    answer: '',
    errors,
    degraded: resolution.degraded,
    timestamp,
  });
  // 每一条「拒」都留痕（卡面 V2）——确定的拒用 warn，判不了的拒用 error（可被告警聚合区分）
  if (outcome.degraded) {
    log.error({ code: outcome.audit.code, action, actor }, outcome.audit.reason);
  } else {
    log.warn({ code: outcome.audit.code, action, actor }, outcome.audit.reason);
  }
  return outcome;
}
