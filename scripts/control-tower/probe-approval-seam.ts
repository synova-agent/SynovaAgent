#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-approval-seam.ts — K12-19 (#202 / RB-05) 人在环审批缝**判据测量件**
 *
 * 判据来源（登记件 `RB-05`）:
 *   `npx tsx scripts/control-tower/probe-approval-seam.ts --case no-answer` ⇒ **expectExit 0**
 *
 * 卡面 §Q3 逐条 → 本探针的场景映射:
 *   V1 `--case no-answer` ⇒ exit 0
 *   V2 **无人应答 ⇒ 拒**（**不许超时放行**）＋ 留痕（谁 / 何时 / 什么动作 / 为什么拒）
 *   V3 有答 ⇒ 按答执行（批准 / 拒绝两态各跑一次）→ `--case approved` / `--case rejected`
 *   V4 **声明缺失即报错**（不静默放行）→ `--case no-declaration`
 *   V5 反例（改坏必红）：把「无人应答」改成「默认放行」⇒ V2 必红（判别力断言在 `no-answer` 内）
 *   创业者本轮升格要求: **反例四变体**（无应答 / 超时 / 应答缺失 / 应答非法）逐个实测
 *                      ＋ **生产路径有入口会触发** → `--case production`（真 express app ＋ 真 router ＋ 真 HTTP）
 *
 * 🟢 判据级别（判例 V-01 / V-02）：**判定不吃 grep**。
 *   除 `no-declaration` 里那条**显式标注**的 `[L1-辅证，不参与判定]` 引用计数外，
 *   全部断言都是 **[L2-真跑通]**：真 `import` 目标模块、真调用审批入口、真观测返回值与留痕字段、
 *   真起 HTTP 服务打生产路由。**grep 不进入任何 verdict**。
 *
 * 契约（铁律 47）:
 *   @input    — `--case no-answer|approved|rejected|no-declaration|production` ｜ `--all`
 *               未知场景 ⇒ **不回落默认场景**，直接 exit 2（回落会把判据报成绿色的假事实）
 *   @output   — stdout 逐条 `✅ PASS / ❌ FAIL / ⚠️ 未实现 / ❌ ERROR`，每条标 [L1]/[L2]；
 *               末行恒为 `RESULT=PASS|FAIL|NOT_IMPLEMENTED|ERROR`
 *   @degraded — 目标件不存在 ⇒ `⚠️ 未实现` ＋ `RESULT=NOT_IMPLEMENTED` ＋ exit 2（**不把"未实现"报成 PASS**）；
 *               目标模块 import 失败 / 调用抛异常 / 返回形态读不出裁决 ⇒ `❌ ERROR` ＋ exit 2
 *               （**fail-closed**：不把"判不了"报成"通过"，铁律 31）
 * 退出码: 0 = 全部断言成立 ｜ 1 = 目标件在但断言不成立（**真红**，非假绿）｜ 2 = 目标未实现或探针无法判定
 *
 * 🔴 边界与披露（如实标注，不隐藏）:
 *   ① **契约原语本件自带**（`ProbeOutput` / `ProbeError` / `locateRepoRoot` / 参数解析）。
 *      理由: 契约单一实现的 `probe-ladder.ts` 属 #205（K12-21）写集、**当前不在本分支**
 *      （实测 as_of `gitea/local-main@8cbe3fc1d` 不存在）。为避免**越写集取件**，本件自带一份
 *      **契约兼容**实现: 词元 `PASS/FAIL/NOT_IMPLEMENTED/ERROR` ＋ 末行 `RESULT=` ＋ 三态退出码 0/1/2
 *      —— 与 #205 探针**逐项同构**。待 #205 落 main 后，本件可按需改 `import` 其原语（判例 M-04 单一事实源）。
 *   ② 探针**不修改**任何目标代码、不写文件、不引随机数 ⇒ 同一状态连跑两次同结果（可复跑）。
 *   ③ 探针声明的导出名候选面与 #205 同名片**一致**（`requestApproval` 等四个入口名 /
 *      `resolveApprovalPolicy` 等四个策略名 / `HIGH_RISK_ACTIONS` 等三个清单名），
 *      入参形态 `{ action, actor, ask, policy }` 与返回形态 `decision`/`allowed`/`audit` 亦一致
 *      ⇒ 两份探针对同一实现给同一结论（已实测，见交付回执）。
 */
import { existsSync, readdirSync, readFileSync, type Dirent } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import { createServer, type Server } from 'http';
import express from 'express';
import type { RequestHandler } from 'express';

// ══════════════════════════════════════════════════════════════════════════════
// 一、契约原语（自带一份，见头部边界 ①）
// ══════════════════════════════════════════════════════════════════════════════

const PROBE_VERDICTS = ['PASS', 'FAIL', 'NOT_IMPLEMENTED', 'ERROR'] as const;
type ProbeVerdict = (typeof PROBE_VERDICTS)[number];

/** verdict → 退出码（三态；与 #205 契约一致） */
const EXIT_BY_VERDICT: Readonly<Record<ProbeVerdict, 0 | 1 | 2>> = {
  PASS: 0,
  FAIL: 1,
  NOT_IMPLEMENTED: 2,
  ERROR: 2,
};

/** 运行期异常（铁律 32: .code ＋ .phase ＋ .retryable） */
class ProbeError extends Error {
  readonly code: string;
  readonly phase: string;
  readonly retryable: boolean;

  constructor(code: string, phase: string, message: string, retryable = false) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
    this.phase = phase;
    this.retryable = retryable;
  }
}

/** 逐条报告器 —— 探针唯一输出通道；末行 `RESULT=` 由它统一签发 */
class ProbeOutput {
  readonly verdicts: ProbeVerdict[] = [];

  constructor(label: string) {
    console.log(`PROBE ${label}`);
  }

  note(line: string): void {
    console.log(line);
  }

  case(name: string): void {
    console.log(`\n── case: ${name} ──`);
  }

  pass(text: string, level: 'L1' | 'L2' = 'L2'): void {
    this.verdicts.push('PASS');
    console.log(`  ✅ PASS [${level}] ${text}`);
  }

  fail(text: string, level: 'L1' | 'L2' = 'L2'): void {
    this.verdicts.push('FAIL');
    console.log(`  ❌ FAIL [${level}] ${text}`);
  }

  notImplemented(text: string): void {
    this.verdicts.push('NOT_IMPLEMENTED');
    console.log(`  ⚠️ 未实现 ${text}`);
  }

  error(text: string): void {
    this.verdicts.push('ERROR');
    console.log(`  ❌ ERROR ${text}`);
  }

  verdict(): ProbeVerdict {
    if (this.verdicts.includes('ERROR')) return 'ERROR';
    if (this.verdicts.includes('FAIL')) return 'FAIL';
    if (this.verdicts.includes('NOT_IMPLEMENTED')) return 'NOT_IMPLEMENTED';
    return 'PASS';
  }

  count(verdict: ProbeVerdict): number {
    return this.verdicts.filter((v) => v === verdict).length;
  }

  finish(): ProbeVerdict {
    const v = this.verdict();
    const parts = PROBE_VERDICTS.map((x) => `${x}=${this.count(x)}`).filter((s) => !s.endsWith('=0'));
    console.log(`\nCOVERAGE: ${parts.length > 0 ? parts.join(' ') : '无断言被执行（不得视为 PASS）'}`);
    console.log(`RESULT=${v}`);
    return v;
  }

  exitCode(): 0 | 1 | 2 {
    return EXIT_BY_VERDICT[this.verdict()];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 二、判据常量
// ══════════════════════════════════════════════════════════════════════════════

/** 场景清单 */
export const KNOWN_CASES: readonly string[] = [
  'no-answer',
  'approved',
  'rejected',
  'no-declaration',
  'production',
];

/** 卡面 §Q2 写集声明的目标件（缺失 ⇒ exit 2，**不**报 PASS） */
const DECLARED_TARGET = 'src/runtime/approval-seam.ts';

/**
 * 本探针判据所依赖的目标件（相对仓库根）。
 * 🔴 牙齿来源: 本表含**真交付面**（审批缝）与**生产接线面**（route）——
 *    任何一件缺失，探针都不得报 PASS。
 */
export const TARGETS: readonly string[] = [DECLARED_TARGET, 'src/routes/self-ops.ts'];

/** 审批入口候选导出名（与 #205 同名片一致） */
const ENTRY_NAMES: readonly string[] = ['requestApproval', 'awaitApproval', 'requestHumanApproval', 'requireApproval'];
/** 策略声明校验入口候选导出名（V4 的载体） */
const POLICY_NAMES: readonly string[] = ['resolveApprovalPolicy', 'loadApprovalPolicy', 'assertApprovalPolicyDeclared', 'validateApprovalPolicy'];
/** 高风险动作清单候选导出名 */
const ACTIONS_NAMES: readonly string[] = ['HIGH_RISK_ACTIONS', 'HIGH_RISK_ACTION_LIST', 'highRiskActions'];

/** 探针代理的请求者标识 */
const PROBE_ACTOR = 'probe-approval-seam';

/** 留痕四要素（卡面 V2: 谁 / 何时 / 什么动作 / 为什么拒） */
const TRAIL_ASPECTS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: '谁', pattern: /actor|who|user|operator|requester|principal|subject|initiator|approver|by$/i },
  { label: '何时', pattern: /timestamp|when|time|date|at$|ts$/i },
  { label: '什么动作', pattern: /action|operation|target|resource|what/i },
  { label: '为什么拒', pattern: /reason|why|justification|cause|explanation|basis/i },
];

/** 裁决词归一（含否定前缀/后缀: `not_approved` ⇒ 拒） */
const NEGATION = /^(?:not|no|non)[_\-\s]?/i;
const NEGATION_SUFFIX = /[_\-\s](?:false|off|denied|rejected)$/i;
const DENY_WORDS = /reject|deny|refus|block|forbid|declin/i;
const ALLOW_WORDS = /approv|allow|grant|permit|accept/i;

// ══════════════════════════════════════════════════════════════════════════════
// 三、通用工具（类型守卫优先 —— 铁律 38: 禁 any 型断言 / 双重断言）
// ══════════════════════════════════════════════════════════════════════════════

type ProbeCallable = (...args: readonly unknown[]) => unknown;

function isCallable(value: unknown): value is ProbeCallable {
  return typeof value === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestHandler(value: unknown): value is RequestHandler {
  return typeof value === 'function';
}

/** 把任意异常归一为 ProbeError（铁律 32） */
function toProbeError(err: unknown, phase: string): ProbeError {
  if (err instanceof ProbeError) return err;
  return new ProbeError('UNEXPECTED', phase, err instanceof Error ? err.message : String(err), false);
}

/** 值的短预览（截断；不可序列化时给出原因而不是抛） */
function preview(value: unknown, cap = 160): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (err: unknown) {
    return `<不可序列化: ${err instanceof Error ? err.message : String(err)}>`;
  }
  if (text === undefined) return String(value);
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/** 定位仓库根（从本文件向上找 package.json ＋ src/） */
function locateRepoRoot(): string {
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new ProbeError('REPO_ROOT_NOT_FOUND', 'bootstrap', '无法从脚本位置向上定位仓库根（需含 package.json ＋ src/）');
}

/** 目标件存在性闸（缺失 ⇒ NOT_IMPLEMENTED，**不**报 PASS） */
function assertTargetsExist(root: string, out: ProbeOutput, relPaths: readonly string[]): boolean {
  const missing = relPaths.filter((p) => !existsSync(join(root, p)));
  for (const m of missing) out.notImplemented(`目标件不存在: ${m}`);
  return missing.length === 0;
}

/** 参数解析（未知场景 ⇒ 抛错，**不回落**） */
function parseProbeArgs(knownCases: readonly string[], argv: readonly string[]): readonly string[] {
  if (argv.includes('--all')) return [...knownCases];
  const idx = argv.indexOf('--case');
  if (idx < 0) {
    throw new ProbeError('CASE_REQUIRED', 'args', `须显式指定 --case <${knownCases.join('|')}> 或 --all`);
  }
  const raw = argv[idx + 1];
  if (raw === undefined || raw.startsWith('--')) {
    throw new ProbeError('MISSING_CASE_VALUE', 'args', '`--case` 后缺场景名');
  }
  if (!knownCases.includes(raw)) {
    throw new ProbeError('UNKNOWN_CASE', 'args', `未知场景 "${raw}"；已知: ${knownCases.join(', ')}（不回落默认场景）`);
  }
  return [raw];
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、目标发现（真 import —— [L2]）
// ══════════════════════════════════════════════════════════════════════════════

interface LoadedModule {
  readonly path: string;
  readonly mod: Record<string, unknown>;
}

async function importIfPresent(root: string, rel: string, out: ProbeOutput): Promise<LoadedModule | undefined> {
  const abs = join(root, rel);
  if (!existsSync(abs)) return undefined;
  try {
    const mod: Record<string, unknown> = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    return { path: rel, mod };
  } catch (err: unknown) {
    out.note(`  ↳ ${rel} import 失败（**不算通过**）: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    return undefined;
  }
}

function pickCallable(mod: Record<string, unknown>, names: readonly string[]): ProbeCallable | undefined {
  for (const name of names) {
    const value = mod[name];
    if (isCallable(value)) return value;
  }
  return undefined;
}

function pickStringList(mod: Record<string, unknown>, names: readonly string[]): readonly string[] | undefined {
  for (const name of names) {
    const value = mod[name];
    if (Array.isArray(value) && value.length > 0 && value.every((x: unknown) => typeof x === 'string')) {
      return value as readonly string[];
    }
  }
  return undefined;
}

interface ApprovalSeam {
  readonly modulePath: string;
  readonly request: ProbeCallable;
  readonly policy: ProbeCallable | undefined;
  readonly actionName: string;
  readonly actionDiscovered: boolean;
}

async function discoverSeam(root: string, out: ProbeOutput): Promise<ApprovalSeam | undefined> {
  const loaded = await importIfPresent(root, DECLARED_TARGET, out);
  if (!loaded) return undefined;
  const request = pickCallable(loaded.mod, ENTRY_NAMES);
  if (!request) {
    out.notImplemented(`目标模块未导出审批入口（候选名 ${ENTRY_NAMES.join(' / ')}）`);
    return undefined;
  }
  const actions = pickStringList(loaded.mod, ACTIONS_NAMES);
  return {
    modulePath: loaded.path,
    request,
    policy: pickCallable(loaded.mod, POLICY_NAMES),
    actionName: actions?.[0] ?? 'probe.approval_seam.high_risk_action',
    actionDiscovered: actions !== undefined,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、返回值归一与判定（形态不可识别 ⇒ ERROR/exit 2，**不**冒认知无法判定为通过）
// ══════════════════════════════════════════════════════════════════════════════

interface NormalizedOutcome {
  readonly decision: string | undefined;
  readonly allowed: boolean | undefined;
  readonly audit: Record<string, unknown> | undefined;
  readonly raw: unknown;
}

const DECISION_KEYS: readonly string[] = ['decision', 'status', 'outcome', 'verdict', 'result'];
const ALLOWED_KEYS: readonly string[] = ['allowed', 'approved', 'granted', 'permitted'];
const AUDIT_KEYS: readonly string[] = ['audit', 'trail', 'record', 'log', 'evidence', 'trace'];

function normalizeOutcome(raw: unknown): NormalizedOutcome | undefined {
  if (typeof raw === 'string') return { decision: raw, allowed: undefined, audit: undefined, raw };
  if (!isRecord(raw)) return undefined;

  let decision: string | undefined;
  for (const key of DECISION_KEYS) {
    const value = raw[key];
    if (typeof value === 'string') {
      decision = value;
      break;
    }
  }
  let allowed: boolean | undefined;
  for (const key of ALLOWED_KEYS) {
    const value = raw[key];
    if (typeof value === 'boolean') {
      allowed = value;
      break;
    }
  }
  if (decision === undefined && allowed === undefined) return undefined;

  let audit: Record<string, unknown> | undefined;
  for (const key of AUDIT_KEYS) {
    const value = raw[key];
    if (isRecord(value)) {
      audit = value;
      break;
    }
    if (Array.isArray(value)) {
      const last: unknown = value[value.length - 1];
      if (isRecord(last)) {
        audit = last;
        break;
      }
    }
  }
  return { decision, allowed, audit, raw };
}

function classifyDecisionWord(word: string): 'deny' | 'allow' | 'unknown' {
  const negated = NEGATION.test(word) || NEGATION_SUFFIX.test(word);
  const denyHit = DENY_WORDS.test(word);
  const allowHit = ALLOW_WORDS.test(word);
  if (negated) {
    if (allowHit && !denyHit) return 'deny';
    if (denyHit && !allowHit) return 'allow';
    return 'unknown';
  }
  if (denyHit && !allowHit) return 'deny';
  if (allowHit && !denyHit) return 'allow';
  return 'unknown';
}

function classify(outcome: NormalizedOutcome): 'deny' | 'allow' | 'unknown' {
  const byWord = outcome.decision === undefined ? 'unknown' : classifyDecisionWord(outcome.decision);
  const byFlag: 'deny' | 'allow' | 'unknown' =
    outcome.allowed === undefined ? 'unknown' : outcome.allowed ? 'allow' : 'deny';
  if (byWord !== 'unknown' && byFlag !== 'unknown') return byWord === byFlag ? byWord : 'unknown';
  return byWord !== 'unknown' ? byWord : byFlag;
}

function describeOutcome(outcome: NormalizedOutcome): string {
  return `decision=${String(outcome.decision)} allowed=${String(outcome.allowed)}`;
}

/** 真调用审批入口（[L2]）；抛异常 / 形态不可识别 ⇒ ProbeError ⇒ exit 2 */
async function callSeam(seam: ApprovalSeam, input: unknown, phase: string): Promise<NormalizedOutcome> {
  let raw: unknown;
  try {
    raw = await seam.request(input);
  } catch (err: unknown) {
    throw new ProbeError(
      'SEAM_CALL_THREW',
      phase,
      `调用 ${seam.modulePath} 审批入口抛异常: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
    );
  }
  const normalized = normalizeOutcome(raw);
  if (!normalized) {
    throw new ProbeError('OUTCOME_SHAPE_UNRECOGNIZED', phase, `审批入口返回形态读不出 决策/允许 字段（实际: ${preview(raw)}）⇒ 无法判定`);
  }
  return normalized;
}

/** 构造一次审批请求（`ask` 端口由场景给定） */
function approvalRequest(seam: ApprovalSeam, ask: () => unknown, timeoutMs?: number): Record<string, unknown> {
  const req: Record<string, unknown> = { action: seam.actionName, actor: PROBE_ACTOR, ask, policy: undefined };
  if (timeoutMs !== undefined) req['timeoutMs'] = timeoutMs;
  return req;
}

/** V2 留痕断言: 谁 / 何时 / 什么动作 / 为什么拒（[L2] —— 断言真返回对象） */
function assertTrail(out: ProbeOutput, outcome: NormalizedOutcome, tag: string): void {
  if (!outcome.audit) {
    out.fail(`V2 留痕缺失（${tag}）：返回值未见结构化留痕记录（谁/何时/什么动作/为什么拒）`, 'L2');
    return;
  }
  const keys = Object.keys(outcome.audit);
  out.pass(`留痕记录在场（${tag}），字段: ${keys.join(', ') || '(空)'}`, 'L2');
  for (const aspect of TRAIL_ASPECTS) {
    const hit = keys.find((key) => aspect.pattern.test(key));
    const value = hit === undefined ? undefined : outcome.audit[hit];
    const usable = value !== undefined && value !== null && String(value).length > 0;
    if (hit !== undefined && usable) {
      out.pass(`留痕含「${aspect.label}」: ${hit}=${preview(value, 60)}`, 'L2');
    } else {
      out.fail(`留痕缺「${aspect.label}」（需字段名可识别且值非空）`, 'L2');
    }
  }
}

/** 断言一条「非放行」结论（本探针里的主判据收敛点: 防"判不了"被写成 PASS） */
function assertRejected(out: ProbeOutput, outcome: NormalizedOutcome, label: string): void {
  const verdict = classify(outcome);
  if (verdict === 'deny') {
    out.pass(`${label} ⇒ 拒（${describeOutcome(outcome)}）`, 'L2');
  } else if (verdict === 'allow') {
    out.fail(`${label} 破：竟然**放行**（${describeOutcome(outcome)}）—— 卡面明令「无人应答 ⇒ 拒 / 不许超时放行」`, 'L2');
  } else {
    out.error(`[L2] ${label} 无法判定：返回值可读但决策词不在可判集内（${describeOutcome(outcome)}）⇒ 探针不猜`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、场景
// ══════════════════════════════════════════════════════════════════════════════

/** V1/V2/V5 ＋ **反例四变体**（无应答 / 超时 / 应答缺失 / 应答非法） */
async function caseNoAnswer(seam: ApprovalSeam, out: ProbeOutput): Promise<void> {
  // ── 变体 1: 无应答（ask 返回 undefined）──
  const noAnswer = await callSeam(seam, approvalRequest(seam, () => undefined), 'no-answer');
  assertRejected(out, noAnswer, 'V2 变体①无应答（ask 返回 undefined）');
  assertTrail(out, noAnswer, 'no-answer');

  // ── 变体 2: 超时（ask 永不落地，等待上限 25ms）──
  const timedOut = await callSeam(
    seam,
    approvalRequest(seam, () => new Promise<never>(() => {}), 25),
    'timeout',
  );
  assertRejected(out, timedOut, 'V2 变体②超时（25ms 内无答复）');
  assertTrail(out, timedOut, 'timeout');

  // ── 变体 3: 应答缺失（不注入 ask 端口）──
  const missingPort = await callSeam(
    seam,
    { action: seam.actionName, actor: PROBE_ACTOR, policy: undefined },
    'answer-missing',
  );
  assertRejected(out, missingPort, 'V2 变体③应答缺失（未注入 ask 端口）');
  assertTrail(out, missingPort, 'answer-missing');

  // ── 变体 4: 应答非法（无法解释的字面量）──
  const illegal = await callSeam(seam, approvalRequest(seam, () => 'maybe'), 'answer-illegal');
  assertRejected(out, illegal, 'V2 变体④应答非法（ask 返回 "maybe"）');
  assertTrail(out, illegal, 'answer-illegal');

  // ── V5 判别力: 无人应答(拒) 与 有答批准(准) 必须可区分（改成"默认放行" ⇒ 本条必红）──
  const approved = await callSeam(seam, approvalRequest(seam, () => 'approved'), 'no-answer#control');
  const noAnswerVerdict = classify(noAnswer);
  const approvedVerdict = classify(approved);
  if (noAnswerVerdict === 'deny' && approvedVerdict === 'allow') {
    out.pass('V5 判别力：无人应答(拒) 与 有答批准(准) 两态可区分 ⇒ 「默认放行」型改动必被判红', 'L2');
  } else if (noAnswerVerdict === 'allow' || approvedVerdict === 'deny') {
    out.fail(`V5 破：无人应答与有答批准的决策不可区分（no-answer=${describeOutcome(noAnswer)} / approved=${describeOutcome(approved)}）`, 'L2');
  } else {
    out.error(`[L2] V5 无法判定：构造不出可区分的两态（no-answer=${describeOutcome(noAnswer)} / approved=${describeOutcome(approved)}）`);
  }
}

/** V3: 有答 ⇒ 按答执行（批准 / 拒绝各跑一次）＋ 留痕 */
async function caseAnswered(seam: ApprovalSeam, out: ProbeOutput, answer: 'approved' | 'rejected'): Promise<void> {
  const outcome = await callSeam(seam, approvalRequest(seam, () => answer), answer);
  const verdict = classify(outcome);
  const want: 'allow' | 'deny' = answer === 'approved' ? 'allow' : 'deny';
  if (verdict === want) {
    out.pass(`V3 有答「${answer}」⇒ 按答执行（${describeOutcome(outcome)}）`, 'L2');
  } else if (verdict === 'unknown') {
    out.error(`[L2] V3 无法判定：决策词不在可判集内（${describeOutcome(outcome)}）`);
  } else if (!seam.actionDiscovered) {
    out.error(`[L2] V3 无法判定：动作名 ${seam.actionName} 系探针回退值（实现未导出高风险动作清单）⇒ 无法排除"动作未获认"这一解释`);
  } else {
    out.fail(`V3 破：有答「${answer}」却得到「${describeOutcome(outcome)}」（应 ${want}）`, 'L2');
  }
  assertTrail(out, outcome, answer);
}

/** V4: 策略声明缺失 ⇒ 报错（不静默放行）＋ [L1] 接线辅证（**不参与判定**） */
async function caseNoDeclaration(seam: ApprovalSeam, out: ProbeOutput, root: string): Promise<void> {
  if (!seam.policy) {
    out.notImplemented(`V4 无载体：策略声明校验入口（候选名 ${POLICY_NAMES.join(' / ')}）未导出 ⇒ 「声明缺失即报错」未实现`);
    return;
  }

  let threwMessage: string | undefined;
  let returned: unknown;
  try {
    returned = await seam.policy(undefined);
  } catch (err: unknown) {
    threwMessage = err instanceof Error ? err.message.split('\n')[0] : String(err);
  }

  if (threwMessage !== undefined) {
    out.pass(`V4 声明缺失 ⇒ 报错（未静默放行）: ${threwMessage}`, 'L2');
  } else if (isRecord(returned) && (returned['ok'] === false || returned['declared'] === false || returned['error'] !== undefined)) {
    out.pass(`V4 声明缺失 ⇒ 以失败结果报错（${preview(returned, 100)}）`, 'L2');
  } else {
    out.fail(`V4 破：声明缺失时未报错（返回 ${preview(returned, 100)}）⇒ 静默放行`, 'L2');
  }

  // [L1] 接线辅证: 证据是"生产代码里有没有人调它"这一物理事实，**不是**断言
  const refs = countReferences(join(root, 'src'), ENTRY_NAMES);
  out.note(
    `  [L1-辅证，不参与判定] 生产代码（src/**）引用审批入口名 ${refs.files} 个文件 / ${refs.hits} 处` +
      `${refs.files === 0 ? '（0 处 ⇒ 审批缝可能是死代码，"生产入口"未接线）' : ''}` +
      `${refs.unreadable.length > 0 ? `；另有 ${refs.unreadable.length} 处不可读（辅证不完整，非 0 命中）` : ''}`,
  );
}

interface ReferenceCount {
  readonly files: number;
  readonly hits: number;
  readonly unreadable: readonly string[];
}

/** [L1] 引用计数（只作辅证；判例 V-02: 不得作验收依据） */
function countReferences(dir: string, needles: readonly string[]): ReferenceCount {
  let files = 0;
  let hits = 0;
  const unreadable: string[] = [];
  const walk = (current: string, depth: number): void => {
    if (depth > 8) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (err: unknown) {
      unreadable.push(`${current}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const entry of entries) {
      const next = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(next, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      let text: string;
      try {
        text = readFileSync(next, 'utf8');
      } catch (err: unknown) {
        unreadable.push(`${next}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      let local = 0;
      for (const needle of needles) {
        let from = 0;
        for (;;) {
          const at = text.indexOf(needle, from);
          if (at < 0) break;
          local += 1;
          from = at + needle.length;
        }
      }
      if (local > 0) {
        files += 1;
        hits += local;
      }
    }
  };
  walk(dir, 0);
  return { files, hits, unreadable };
}

/** 生产接线实测（[L2]）: 真 express app ＋ 真 self-ops router ＋ 真 HTTP 请求 */
async function caseProduction(out: ProbeOutput, root: string, riskAction: string): Promise<void> {
  const loaded = await importIfPresent(root, 'src/routes/self-ops.ts', out);
  if (!loaded) {
    out.notImplemented('生产入口件 src/routes/self-ops.ts 未就位 ⇒ 无法验证"生产路径有入口会触发"');
    return;
  }
  const router = loaded.mod['default'];
  if (!isRequestHandler(router)) {
    out.error('src/routes/self-ops.ts 未导出默认可挂载的 express router ⇒ 生产接线面形态不可识别');
    return;
  }

  const app = express();
  app.use(express.json());
  app.use(router);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const addr = server.address();
    if (addr === null || typeof addr === 'string') {
      out.error('无法读取探针自起服务的回环端口');
      return;
    }
    const url = `http://127.0.0.1:${addr.port}/api/self-ops/execute`;

    const post = async (body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const parsed: unknown = await res.json();
      return { status: res.status, body: isRecord(parsed) ? parsed : {} };
    };

    // ① 高风险动作 + 生产态（无人类应答通道）⇒ 必须 403 拒
    const denied = await post({ op: riskAction, params: {}, requestedBy: PROBE_ACTOR });
    if (denied.status === 403 && denied.body['code'] === 'APPROVAL_DENIED') {
      out.pass(`生产入口 POST /api/self-ops/execute（op=${riskAction}）⇒ 403 APPROVAL_DENIED（**拒**，非 200/202）`, 'L2');
    } else {
      out.fail(`生产入口未拦下高风险动作：status=${denied.status} body=${preview(denied.body, 140)}`, 'L2');
    }

    // ② 拒绝必须带四要素留痕（证明是"审批缝的结论"，不是一段装饰性 403）
    const approval = denied.body['approval'];
    if (isRecord(approval)) {
      const audited = normalizeOutcome({ decision: 'rejected', allowed: false, audit: approval });
      assertTrail(out, audited ?? { decision: 'rejected', allowed: false, audit: approval, raw: approval }, 'production-403');
    } else {
      out.fail('生产入口的 403 未带结构化留痕（approval 字段缺失）⇒ 拒绝不可审计', 'L2');
    }

    // ③ 危险动作**没有**被执行（拒绝是执行前拦截，不是执行后道歉）
    if (denied.body['success'] === undefined && denied.body['approvalTicketId'] === undefined) {
      out.pass('高风险动作被**执行前**拦截（回包无 success / approvalTicketId ⇒ 未进入 executeSelfOp 结果态）', 'L2');
    } else {
      out.fail(`高风险动作疑似已执行：回包含 success/approvalTicketId（${preview(denied.body, 140)}）`, 'L2');
    }

    // ④ 安全动作不得误伤（反例对照: 判据不能靠"全都拒"换来绿）
    const safe = await post({ op: 'clear-cache', requestedBy: PROBE_ACTOR });
    if (safe.status === 200 && safe.body['ok'] === true) {
      out.pass('对照：安全动作（clear-cache）仍 200 放行 ⇒ 拦截不是"一律拒"的假绿', 'L2');
    } else {
      out.fail(`安全动作被误伤：status=${safe.status} body=${preview(safe.body, 140)}`, 'L2');
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、CLI
// ══════════════════════════════════════════════════════════════════════════════

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('K12-19 approval-seam（#202 / RB-05）');

  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    const pe = toProbeError(err, 'bootstrap');
    out.error(`仓库根定位失败 [${pe.code}/${pe.phase}/retryable=${String(pe.retryable)}]: ${pe.message}`);
    out.finish();
    return 2;
  }

  out.note(`PROBE=probe-approval-seam card=K12-19(#202/RB-05) repoRoot=${root}`);

  // ① 目标件存在性闸 —— 缺失 ⇒ 立刻 NOT_IMPLEMENTED / exit 2
  if (!assertTargetsExist(root, out, TARGETS)) {
    out.note('说明: 目标件未建 ⇒ 本探针按契约报 NOT_IMPLEMENTED（exit 2），**不是** PASS（未实现不许绿）');
    out.finish();
    return 2;
  }

  // ② 场景解析（未知场景 ⇒ 不回落，直接 exit 2）
  let cases: readonly string[];
  try {
    cases = parseProbeArgs(KNOWN_CASES, argv);
  } catch (err: unknown) {
    const pe = toProbeError(err, 'args');
    out.error(`参数无法识别 [${pe.code}/${pe.phase}]: ${pe.message}`);
    out.finish();
    return 2;
  }

  // ③ 契约面发现（真 import）—— 符号缺失 ⇒ NOT_IMPLEMENTED / exit 2
  const seam = await discoverSeam(root, out);
  if (!seam) {
    out.note('说明: 审批缝契约面未命中 ⇒ NOT_IMPLEMENTED（exit 2）—— 不拿"命名不匹配"当"卡没做好"，也不报绿');
    out.finish();
    return 2;
  }
  out.note(
    `命中目标模块 ${seam.modulePath}（真 import 成功）；动作名=${seam.actionName}` +
      `${seam.actionDiscovered ? '（取自实现导出清单）' : '（探针回退值）'}`,
  );

  // ④ 逐场景真跑
  for (const name of cases) {
    out.case(name);
    try {
      if (name === 'no-answer') await caseNoAnswer(seam, out);
      else if (name === 'approved') await caseAnswered(seam, out, 'approved');
      else if (name === 'rejected') await caseAnswered(seam, out, 'rejected');
      else if (name === 'no-declaration') await caseNoDeclaration(seam, out, root);
      else if (name === 'production') await caseProduction(out, root, seam.actionName);
      else out.error(`场景分派未覆盖: ${name}`);
    } catch (err: unknown) {
      const pe = toProbeError(err, name);
      out.error(`[${pe.code}/${pe.phase}/retryable=${String(pe.retryable)}] ${pe.message} ⇒ 该场景无法判定`);
    }
  }

  out.finish();
  return out.exitCode();
}

// 仅在直接执行时跑 CLI（被 import 时不产生副作用）
if (process.argv[1] && /probe-approval-seam\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(String(err));
      process.exit(2);
    },
  );
}
