/**
 * src/init/role-pack-output-standard.ts — 岗位包「可机器判输出标准」编译器（#1075 P2-3）
 *
 * 架构位置: **引擎侧**（`src/init/`）读取**内容面**（`extensions/presets/roles/<roleId>/`）的
 *   `acceptance-criteria.yaml` ＋ `output-template.ref`，把其中的**机器可判子集**（`criteria[].machine`）
 *   编译成既有契约引擎认识的 `OutputContract`（内存对象；**不写盘**）。
 *   方向单向：内容面零 import；本文件**不写盘、不触网络**。校验一律走
 *   `src/output/contract-validator.ts` 的 `validateContractObject()`（**禁自建校验器**）；
 *   消费点 = `src/routes/conversations.ts` 的角色会话每轮 assistant 回复（非阻断留痕）。
 *
 * 设计哲学（一句）: **编译期只做"读包＋编译＋限额"，校验期只做"跑既有引擎"** ——
 *   审批门与指纹自校验在编译前，字段/正则限额在编译中，二者任一不过就返回 typed code；
 *   **可机器判的进 checks，判不了的进 `unverifiable`（可见，绝不静默丢弃）**。
 *
 * 契约（铁律 47）:
 *   @input  — `loadRolePackOutputStandard(roleId: string, opts?: {now?: string})`（IO 壳；**同步、不抛**）
 *             `opts.now` 只注入 `contract.meta.generatedAt`（缺省 `new Date().toISOString()`；测试可确定性断言）。
 *             `isRolePackOutputEnabled()`（纯核；唯一外部读 = 回滚开关 env）。
 *   @output — `LoadRolePackOutputStandardResult = {ok:true, standard} | {ok:false, code, reason}`
 *             （判别联合；`code` ∈ {@link RolePackOutputStandardCode} 四值，**不自造码**）。
 *             `standard` = `{roleId, contract（形状同 contracts/*.yaml 的内存对象）, template（展示用）, unverifiable[]}`。
 *   @degraded — **不抛**：包不存在／未批准／内容已变／形状与限额违规一律折成 typed code ＋ 点名 reason
 *             ＋ `log.warn`（`degraded:true`，铁律 11/24/31）；`unverifiable` 非空 ⇒ `log.info` 一条
 *             （**可见但不判** —— 静默丢弃会让"看起来全过了"）。**不新增 E_* 错误码**（规格 §4.5-C1 四值）。
 *             **回滚开关**（`SYNOVA_ROLE_PACK_OUTPUT=off`）由消费方经 `isRolePackOutputEnabled()` 判定后
 *             跳过校验并 `log.warn(degraded:true)` —— 开关**不进本函数**：本函数的结果契约只有
 *             "ok:true/ok:false" 两态，塞第三个"skipped"态会污染 §4.5-C1 的契约（口径同 P2-2 D13）。
 *   @authority — 生产唯一调用方 = `src/routes/conversations.ts`（角色会话每轮、`rolePack !== null` 时）。
 *             **其它模块不得复制本文件判定**；内容面语义（criteria 正文）归 P3 审批面展示。
 *   @not-here — 不做版式强制（`output-template.ref#sections[].must` 只透出为展示标准，**不产生 checks**）；
 *             不做语义/编造判断（`ac.no-fabrication` 等仍 `unverifiable`）；不阻断产出（非阻断）；
 *             不改 `RolePack`／审批记录（P2-1 件，红线）；不新增契约 kind（只用 `textPattern`／`noPattern`）；
 *             不缓存（规格 L8/L4：每轮重新 `loadRolePacks()` ＋ 六件单读，正确性优先）。
 *
 * 编译顺序（逐条短路；＝规格 §2.3-B，改此行须同批改 `tests/init/role-pack-output-standard.test.ts`）:
 *   ① `loadRolePacks()` 按 roleId 找包（**不二次 load**：`report.root` 就是 roleDir 的来源）；
 *      不存在 ⇒ `E_ROLE_PACK_NOT_FOUND`。
 *   ② `pack.approval.status !== 'approved'` ⇒ `E_ROLE_PACK_NOT_APPROVED`（透出 status ＋ `code`）。
 *      🔴 稳态下"批准后内容被改"在本步表现为 P2-1 的 `unverified(E_APPROVAL_CONTENT_CHANGED)`
 *      ⇒ 归 `NOT_APPROVED`（与 P2-2 的**子案映射不同**：规格 §2.3-B 步骤 2 只判 status；见 KL-3）。
 *   ③ **六件单读快照**（复用 `role-pack-persona.readPieceBytesOnce(roleDir)`，禁二读）→
 *      `computeRolePackContentHash(pieces)` 必须 `=== pack.validation.contentHash`；
 *      不等 ⇒ `E_ROLE_PACK_CONTENT_CHANGED`。`roleDir = <report.root>/roles/<roleId>`。
 *   ④ 从**同一快照**取 `acceptance-criteria.yaml`／`output-template.ref` 字节（禁二读，封 TOCTOU）；
 *      两件各 ≤64 KiB；解析 `criteria[]`（id/text/machine?）与 `template{templateId,sections[],emptyState}`；
 *      criteria ≤32、`text` ≤200、`pattern` ≤200 且须被 `safeRegExp()` 编译通过；
 *      越界/形状非法 ⇒ `E_ROLE_PACK_OUTPUT_INVALID`（**点名 criterion id**）。
 *   ⑤ 编译 `OutputContract`：`meta.id='role:<roleId>'`、`checks=[{id:'role.<criterionId>', kind, pattern, message:text}]`、
 *      `fields=[orgId,generatedAt,text]`、`sections:[]`、`pointers:[]`（本批不判版式）、
 *      `sourcePath=<roleDir>/acceptance-criteria.yaml`（错误归属用绝对路径）。
 *   ⑥ `unverifiable` = 无 `machine` 的 criteria（原样 id/text）＋ `log.info` 一条；`template` 原样透出。
 *
 * Source map（本文件内）:
 *   | 导出 | 角色 |
 *   |---|---|
 *   | `RoleOutputStandard`／`RoleOutputStandardTemplate` | 字段级契约（规格 §2.3-A） |
 *   | `RolePackOutputStandardCode`／`LoadRolePackOutputStandardResult` | typed 结果（判别联合；四码） |
 *   | `loadRolePackOutputStandard()` | IO 壳：装载 → 审批门 → 六件单读 → 指纹自校验 → 解析限额 → 编译 |
 *   | `isRolePackOutputEnabled()` | 纯核：回滚开关（`SYNOVA_ROLE_PACK_OUTPUT=off` ⇒ false） |
 *   内部：`compileOutputStandard()`（纯核：解析两件字节并编译；无 IO）／`compileCheck()`（单条 machine 编译）。
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · **KL-1 · 只做 `textPattern`／`noPattern`**（规格 §10-L1）：不判语义、不判编造；`ac.no-fabrication`
 *     等无 `machine` 的条目仍 `unverifiable`（**可见**，`log.info` ＋ 返回值都带）。
 *   · **KL-2 · 不强制版式**（规格 §10-L2）：`output-template.ref` 的 `sections/must` 只透出为展示标准，
 *     **不产生 checks**（assistant 回复是散文，强套 `###` 必假红）。
 *   · **KL-3 · `CONTENT_CHANGED` 只在 load↔snapshot 窗口可达**：稳态下"改内容"由 P2-1 审批门判出
 *     （`unverified`）⇒ 本函数步骤②返回 `NOT_APPROVED`；P2-2 对该子案做了 `E_APPROVAL_CONTENT_CHANGED`
 *     ⇒ `CONTENT_CHANGED` 的映射，本批**按规格 §2.3-B 步骤 2 不做该映射**（判据 J4 只要求 `NOT_APPROVED`）。
 *   · **KL-4 · 不缓存**（规格 §10-L8/L4）：每轮 `loadRolePacks()` 全角色扫描 ＋ 六件单读 ＋ 编译；
 *     角色多/包大时需加缓存（缓存键须含 `contentHash`）。
 *   · **KL-5 · 失败台账不去重**（规格 §10-L9）：同一 `(roleId,codes)` 连续多轮违标 ⇒ 多条记录
 *     （台账语义归既有引擎，本批不改）。
 *   · **KL-6 · 非阻断**（规格 §10-L3）：违标只留痕（`log.warn` ＋ 引擎落账）；"回复是否被拒"是 P3 的事。
 *   · **KL-7 · 形状按三包实物收紧**：`criteria[].text` 空/纯空白亦拒（§4.5-C2 表未列空串，按"不可作
 *     check message"处理）；`template` 的 `templateId`/`sections[].{id,title,must}`/`emptyState` 均要求
 *     合规形状（三包实物齐备）。P3 若出现别的模板形态需放宽（判据将换）。
 *   · **KL-8 · 不判 `criteria` 文件的 `roleId` 与目录名一致**：身份绑定由 P2-1 的
 *     `ROLE_PACK_ROLE_ID_MISMATCH`（manifest 层）负责，本函数不重复判。
 *   · **KL-9 · 内容根子目录用字面量 `'roles'`**（同 P2-2 L9）：`ROLE_SUBDIR` 未被 P2-1 导出。
 *     漂移可观测：`readPieceBytesOnce()` 必 `ENOENT` ⇒ 步骤③ 返回 `E_ROLE_PACK_OUTPUT_INVALID`
 *     （fail-loud，不静默空编译）。
 *   · **KL-10 · 未测"是否更准"**（规格 §10-L7）：只证"标准被检查了"，不证产出质量提升。
 */
import { createLogger } from '@synova/logger';
import { load as parseYaml } from 'js-yaml';
import { join } from 'path';
import { loadRolePacks } from './preset-loader';
import { computeRolePackContentHash } from './role-pack-schema';
import { readPieceBytesOnce } from './role-pack-persona';
import { safeRegExp } from '../output/contract-validator';
import type { ContractCheck, OutputContract } from '../output/contract-validator';

const log = createLogger('init/role-pack-output-standard');

// ══════════════════════════════════════════════════════════════════════════════
// 一、契约常量（与规格 §2.3／§4.5-C2 一一对应；改值须同批改测试）
// ══════════════════════════════════════════════════════════════════════════════

/** 机器可判标准件名（六件之一；本文件编译的唯一判据来源 —— 规格 D1） */
const CRITERIA_FILE = 'acceptance-criteria.yaml';

/** 输出模板件名（六件之一；本批**只透出为展示标准**，不产生 checks —— 规格 D1/L2） */
const TEMPLATE_FILE = 'output-template.ref';

/** 角色目录名（相对内容根）。🔴 P2-1 的 `ROLE_SUBDIR` 未导出 ⇒ 字面量（同 P2-2 L9；漂移 fail-loud）。 */
const ROLES_SUBDIR = 'roles';

/** `criteria[]` 条数上限（规格 §4.5-C2：32 过／33 拒） */
const CRITERIA_MAX_ITEMS = 32;

/** 单条 criterion 的 `text` 字符上限（规格 §4.5-C2：200 过／201 拒） */
const CRITERION_TEXT_MAX_CHARS = 200;

/** `machine.pattern` 字符上限（规格 §4.5-C2：200 过／201 拒） */
const PATTERN_MAX_CHARS = 200;

/** 两件（criteria／template）的**原始字节**上限（规格 §4.5-C2：64 KiB 过／+1 拒；本批自设） */
const PIECE_MAX_BYTES = 64 * 1024;

/** 契约版本（`meta.version`；宪章 P9「契约必须带版本」） */
const CONTRACT_VERSION = 1;

/** 机器可判检查种类白名单（规格 D2：**只复用既有 kind**，禁新增） */
const MACHINE_KINDS = ['textPattern', 'noPattern'] as const;

/** 回滚开关名（显式降级；关闭 ⇒ 消费方跳过校验，非默认 —— 规格 D9） */
const OUTPUT_ROLLBACK_ENV = 'SYNOVA_ROLE_PACK_OUTPUT';

/** 回滚开关关闭值 */
const OUTPUT_ROLLBACK_OFF = 'off';

// ══════════════════════════════════════════════════════════════════════════════
// 二、类型（字段级契约 ＝ 规格 §2.3-A；只读，判别联合带 typed code）
// ══════════════════════════════════════════════════════════════════════════════

/** 输出模板（`output-template.ref` 的透出面；**展示用，不参与校验** —— 规格 D1/L2） */
export interface RoleOutputStandardTemplate {
  /** 模板 id（如 `finance.standard`） */
  readonly templateId: string;
  /** 版式骨架（id/title/must[]；本批不强制） */
  readonly sections: readonly {
    readonly id: string;
    readonly title: string;
    readonly must: readonly string[];
  }[];
  /** 空态提示（演示/审批面展示） */
  readonly emptyState: string;
}

/** 一条"看得见但不判"的标准（无 `machine` 的 criterion —— 规格 D6） */
export interface RoleUnverifiableCriterion {
  readonly id: string;
  readonly text: string;
}

/** 一个岗位的「可机器判输出标准」（规格 §2.3-A） */
export interface RoleOutputStandard {
  /** 角色 id（= 内容根下 `roles/` 的目录名） */
  readonly roleId: string;
  /** 编译出的契约对象（形状同 `contracts/*.yaml`；**内存对象，不写盘**） */
  readonly contract: OutputContract;
  /** 输出模板（展示用） */
  readonly template: RoleOutputStandardTemplate;
  /** 无 `machine` 的 criteria（可见但不判；**禁静默丢弃**） */
  readonly unverifiable: readonly RoleUnverifiableCriterion[];
}

/**
 * 输出标准错误码（规格 §4.5-C1 的**四值**，逐一；**禁自造第三方码**）。
 * 无 `UNREADABLE`：缺件/符号链接先由 P2-1 loader 判 `validation.ok=false` ⇒ `unverified` ⇒ 本函数给
 * `E_ROLE_PACK_NOT_APPROVED`（规格 §4.5-C1 明示）；`E_ROLE_PACK_OUTPUT_INVALID` 只兜
 * load↔snapshot 的 TOCTOU 窗口与字段/字节限额。
 */
export type RolePackOutputStandardCode =
  | 'E_ROLE_PACK_NOT_FOUND'
  | 'E_ROLE_PACK_NOT_APPROVED'
  | 'E_ROLE_PACK_CONTENT_CHANGED'
  | 'E_ROLE_PACK_OUTPUT_INVALID';

/** `loadRolePackOutputStandard()` 结果（判别联合；**不抛**） */
export type LoadRolePackOutputStandardResult =
  | { readonly ok: true; readonly standard: RoleOutputStandard }
  | { readonly ok: false; readonly code: RolePackOutputStandardCode; readonly reason: string };

/** 编译选项（`now` 只注入 `meta.generatedAt`） */
export interface RolePackOutputStandardOptions {
  /** ISO-8601 记录时刻（缺省 `new Date().toISOString()`；测试注入缝） */
  readonly now?: string;
}

/** 内部：两件字节的编译结果（纯核；与对外结果同形，供 `compileOutputStandard()` 用） */
type CompileOutcome =
  | { readonly ok: true; readonly standard: RoleOutputStandard }
  | { readonly ok: false; readonly reason: string };

// ══════════════════════════════════════════════════════════════════════════════
// 三、小工具（纯函数；不抛 —— 形状判定一律先过 `isRecord`）
// ══════════════════════════════════════════════════════════════════════════════

/** YAML 映射判断（`load()` 返回 `unknown`，一切按键访问前必须过此关） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 值的人读展示（`reason` 里点名用；不用 `as`） */
function show(value: unknown): string {
  if (value === undefined) return '（缺省）';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `数组(${String(value.length)})`;
  return typeof value;
}

/** 异常的人读展示（`catch` 里点名原因用 —— 铁律 11/24：不吞） */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、纯核 ① — 编译单条 `machine`（= 一条契约 check；规格 §2.3-B step5）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 把一条 `criteria[].machine` 编译成 `ContractCheck`。
 *
 * @param criterionId - criterion id（`role.` 前缀由本函数加；**错误点名用原 id**）
 * @param machine - `machine` 值（已确认是映射对象）
 * @param message - check 的 message（= criterion.text；给"点名哪条标准没过"用）
 * @returns `{ok:true, check}` 或 `{ok:false, reason}`（reason 点名 criterion id）
 * @degraded 非法正则 ⇒ `{ok:false, reason}`（`safeRegExp()` 内已 `log.warn`；本函数不重复判）
 */
function compileCheck(
  criterionId: string,
  machine: Record<string, unknown>,
  message: string,
): { readonly ok: true; readonly check: ContractCheck } | { readonly ok: false; readonly reason: string } {
  const kind = machine['kind'];
  if (kind === undefined || kind === null) {
    // §4.5-C2：`machine.kind` 缺 ⇒ 该条 **unverifiable**（不是 INVALID）—— 由调用方折进 unverifiable
    return { ok: false, reason: `${criterionId}: machine.kind 缺省（应作 unverifiable）` };
  }
  if (typeof kind !== 'string' || !(MACHINE_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      reason:
        `${criterionId}: machine.kind=${show(kind)} 不在白名单 ` +
        `[${MACHINE_KINDS.join(', ')}]（规格 D2：只复用既有 kind，禁新增）`,
    };
  }
  const pattern = machine['pattern'];
  if (pattern === undefined || pattern === null) {
    return { ok: false, reason: `${criterionId}: machine.pattern 缺省（必填）` };
  }
  if (typeof pattern !== 'string') {
    return { ok: false, reason: `${criterionId}: machine.pattern 必须是 string，实为 ${show(pattern)}` };
  }
  if (pattern.length > PATTERN_MAX_CHARS) {
    return {
      ok: false,
      reason: `${criterionId}: machine.pattern ${String(pattern.length)} 字符 > 上限 ${String(PATTERN_MAX_CHARS)}（不截断）`,
    };
  }
  // 🔴 正则合法性用**引擎唯一实现**复核（禁在编译侧另写一份 `new RegExp` 语义 —— 规格 §2.3-C 末条）
  if (safeRegExp(pattern) === null) {
    return { ok: false, reason: `${criterionId}: machine.pattern 非法正则 ${JSON.stringify(pattern)}（safeRegExp 编译失败）` };
  }
  return { ok: true, check: { id: `role.${criterionId}`, kind, pattern, message } };
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、纯核 ② — 解析两件字节并编译标准（无 IO、不抛）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 解析 `acceptance-criteria.yaml` ＋ `output-template.ref` 的**同一份快照字节**并编译标准。
 *
 * 归因（逐条短路；失败一律 `{ok:false, reason}`，由调用方折成 `E_ROLE_PACK_OUTPUT_INVALID`）:
 *   ① YAML 失败（含重复键 —— js-yaml 抛）⇒ 点名文件＋原因；
 *   ② `criteria` 缺键／非数组 ⇒ INVALID（schema required 先拦，§4.5-C2 首行）；
 *   ③ `criteria` >32 ⇒ INVALID；
 *   ④ 逐条：非映射／`id` 非空串／`text` 非空串且 ≤200 ⇒ INVALID（点名 criterion id 或下标）；
 *      `machine` 缺省 ⇒ 进 `unverifiable`；`machine` 非映射／kind 非法／pattern 缺失或违规 ⇒ INVALID；
 *   ⑤ `template`：`templateId` 非空串／`sections` 数组（逐条 id/title/must[]）／`emptyState` 字符串 ⇒ INVALID；
 *   ⑥ 组 `OutputContract`（本批 `sections:[]`／`pointers:[]` —— 不判版式）。
 *
 * @param input.roleId - 角色 id（进 `meta.id`／`meta.title`）
 * @param input.roleDir - 角色包目录（绝对路径；进 `sourcePath` 与 reason）
 * @param input.criteriaBytes - `acceptance-criteria.yaml` 的原始字节（**来自六件快照，禁再读盘**）
 * @param input.templateBytes - `output-template.ref` 的原始字节（**同一快照**）
 * @param input.now - `meta.generatedAt` 的取值（调用方已归一）
 * @returns `{ok:true, standard}` 或 `{ok:false, reason}`
 */
function compileOutputStandard(input: {
  readonly roleId: string;
  readonly roleDir: string;
  readonly criteriaBytes: Buffer;
  readonly templateBytes: Buffer;
  readonly now: string;
}): CompileOutcome {
  const criteriaPath = join(input.roleDir, CRITERIA_FILE);
  const templatePath = join(input.roleDir, TEMPLATE_FILE);

  // ① YAML（重复键抛 ⇒ 折成 INVALID，不静默取最后一个）
  let criteriaDoc: unknown;
  try {
    criteriaDoc = parseYaml(input.criteriaBytes.toString('utf8'));
  } catch (err: unknown) {
    return { ok: false, reason: `${criteriaPath}: YAML 解析失败（重复键亦在此拦）— ${describeError(err)}` };
  }
  let templateDoc: unknown;
  try {
    templateDoc = parseYaml(input.templateBytes.toString('utf8'));
  } catch (err: unknown) {
    return { ok: false, reason: `${templatePath}: YAML 解析失败（重复键亦在此拦）— ${describeError(err)}` };
  }

  // ② criteria 段
  if (!isRecord(criteriaDoc)) {
    return { ok: false, reason: `${criteriaPath}: 顶层必须是映射对象，实为 ${show(criteriaDoc)}` };
  }
  const criteriaRaw = criteriaDoc['criteria'];
  if (criteriaRaw === undefined || criteriaRaw === null) {
    return { ok: false, reason: `${criteriaPath}: 缺 \`criteria\` 段（必填；规格 §4.5-C2 首行）` };
  }
  if (!Array.isArray(criteriaRaw)) {
    return { ok: false, reason: `${criteriaPath}: criteria 必须是数组，实为 ${show(criteriaRaw)}` };
  }
  // ③ 条数上限
  if (criteriaRaw.length > CRITERIA_MAX_ITEMS) {
    return {
      ok: false,
      reason: `${criteriaPath}: criteria ${String(criteriaRaw.length)} 条 > 上限 ${String(CRITERIA_MAX_ITEMS)}（不截断）`,
    };
  }

  // ④ 逐条编译
  const checks: ContractCheck[] = [];
  const unverifiable: RoleUnverifiableCriterion[] = [];
  for (const [index, raw] of criteriaRaw.entries()) {
    const at = `${criteriaPath}: criteria[${String(index)}]`;
    if (!isRecord(raw)) return { ok: false, reason: `${at}: 必须是映射对象，实为 ${show(raw)}` };

    const id = raw['id'];
    if (typeof id !== 'string' || id.trim().length === 0) {
      return { ok: false, reason: `${at}: id 必填（非空字符串），实为 ${show(id)}` };
    }
    const text = raw['text'];
    if (text === undefined || text === null) {
      return { ok: false, reason: `${criteriaPath}: ${id}: text 缺省（必填；作 check message）` };
    }
    if (typeof text !== 'string') {
      return { ok: false, reason: `${criteriaPath}: ${id}: text 必须是 string，实为 ${show(text)}` };
    }
    if (text.trim().length === 0) {
      // KL-7：空串 §4.5-C2 表未列，按"不可作 check message"拒（fail-loud，不静默放行）
      return { ok: false, reason: `${criteriaPath}: ${id}: text 空/纯空白（必填，1..${String(CRITERION_TEXT_MAX_CHARS)} 字符）` };
    }
    if (text.length > CRITERION_TEXT_MAX_CHARS) {
      return {
        ok: false,
        reason:
          `${criteriaPath}: ${id}: text ${String(text.length)} 字符 > 上限 ` +
          `${String(CRITERION_TEXT_MAX_CHARS)}（不截断）`,
      };
    }

    const machine = raw['machine'];
    if (machine === undefined || machine === null) {
      // 无 machine ⇒ **可见但不判**（规格 D6：禁静默丢弃）
      unverifiable.push({ id, text });
      continue;
    }
    if (!isRecord(machine)) {
      return { ok: false, reason: `${criteriaPath}: ${id}: machine 必须是映射对象，实为 ${show(machine)}` };
    }
    if (machine['kind'] === undefined || machine['kind'] === null) {
      // §4.5-C2：machine.kind 缺 ⇒ 该条 unverifiable（不是 INVALID）
      unverifiable.push({ id, text });
      continue;
    }
    const compiled = compileCheck(id, machine, text);
    if (!compiled.ok) return { ok: false, reason: `${criteriaPath}: ${compiled.reason}` };
    checks.push(compiled.check);
  }

  // ⑤ template 段
  if (!isRecord(templateDoc)) {
    return { ok: false, reason: `${templatePath}: 顶层必须是映射对象，实为 ${show(templateDoc)}` };
  }
  const templateId = templateDoc['templateId'];
  if (typeof templateId !== 'string' || templateId.trim().length === 0) {
    return { ok: false, reason: `${templatePath}: templateId 必填（非空字符串），实为 ${show(templateId)}` };
  }
  const sectionsRaw = templateDoc['sections'];
  if (!Array.isArray(sectionsRaw)) {
    return { ok: false, reason: `${templatePath}: sections 必须是数组，实为 ${show(sectionsRaw)}` };
  }
  const sections: { readonly id: string; readonly title: string; readonly must: readonly string[] }[] = [];
  for (const [index, raw] of sectionsRaw.entries()) {
    const at = `${templatePath}: sections[${String(index)}]`;
    if (!isRecord(raw)) return { ok: false, reason: `${at}: 必须是映射对象，实为 ${show(raw)}` };
    const sectionId = raw['id'];
    const title = raw['title'];
    if (typeof sectionId !== 'string' || sectionId.trim().length === 0) {
      return { ok: false, reason: `${at}: id 必填（非空字符串），实为 ${show(sectionId)}` };
    }
    if (typeof title !== 'string') {
      return { ok: false, reason: `${at}: title 必须是 string，实为 ${show(title)}` };
    }
    const mustRaw = raw['must'];
    if (!Array.isArray(mustRaw)) {
      return { ok: false, reason: `${at}: must 必须是字符串数组，实为 ${show(mustRaw)}` };
    }
    const must: string[] = [];
    for (const item of mustRaw) {
      if (typeof item !== 'string') {
        return { ok: false, reason: `${at}: must 元素必须是 string，实为 ${show(item)}` };
      }
      must.push(item);
    }
    sections.push({ id: sectionId, title, must });
  }
  const emptyState = templateDoc['emptyState'];
  if (typeof emptyState !== 'string') {
    return { ok: false, reason: `${templatePath}: emptyState 必须是 string，实为 ${show(emptyState)}` };
  }

  // ⑥ 组契约（形状必须过 `OutputContract` 类型；本批 sections/pointers 为空）
  const contract: OutputContract = {
    meta: {
      id: `role:${input.roleId}`,
      version: CONTRACT_VERSION,
      title: `${input.roleId} 输出标准`,
      format: 'markdown',
      generatedAt: input.now,
    },
    entries: [
      { name: 'text', type: 'string', required: true },
      { name: 'orgId', type: 'string', required: true },
      { name: 'generatedAt', type: 'string', required: true },
    ],
    checks,
    fields: [
      { path: 'orgId', required: true },
      { path: 'generatedAt', required: true },
      { path: 'text', required: true },
    ],
    sections: [],
    pointers: [],
    // 错误归属用绝对路径（引擎 `makeError` 的 `sourcePath` 取它）
    sourcePath: criteriaPath,
  };

  return {
    ok: true,
    standard: { roleId: input.roleId, contract, template: { templateId, sections, emptyState }, unverifiable },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、回滚开关（纯核；唯一外部读 = env —— 规格 D9）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 输出标准校验是否启用（回滚开关判定）。
 *
 * 🔴 开关由**消费方**（`src/routes/conversations.ts`）调用：关闭 ⇒ 跳过本批校验 ＋ `log.warn(degraded:true)`。
 *   不放 `loadRolePackOutputStandard()` 内的理由：结果契约只有两态（§4.5-C1），塞"skipped"第三态
 *   会迫使每个调用方都处理一个规格外的返回值 —— 与 P2-2 把开关放在渲染纯核（不放在 loader）同口径。
 *
 * @returns `false` 仅当 env 逐字等于 `off`；其余（未设/其它值）⇒ `true`（**默认开启**，显式降级非默认）
 */
export function isRolePackOutputEnabled(): boolean {
  return process.env[OUTPUT_ROLLBACK_ENV] !== OUTPUT_ROLLBACK_OFF;
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、IO 壳 — 装载 → 审批门 → 六件单读 → 指纹自校验 → 编译（同步、不抛）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 编译一个岗位的「可机器判输出标准」（生产入口；**同步、不抛**）。
 *
 * 契约:
 *   @input  roleId — 角色 id（目录名；形状/白名单校验归路由层，本函数只查"包在不在"）
 *           opts   — `{now?}`：只注入 `contract.meta.generatedAt`
 *   @output `{ok:true, standard}` 或 `{ok:false, code, reason}`（四码唯一表；见 §4.5-C1）
 *   @degraded 任一失败 ⇒ `log.warn({roleId, code, reason, degraded:true})`；`unverifiable` 非空 ⇒
 *             `log.info` 一条（可见不判）；**永不抛出**
 *   @authority 生产唯一调用方 = `src/routes/conversations.ts`（角色会话每轮 assistant 回复后、非阻断）
 */
export function loadRolePackOutputStandard(
  roleId: string,
  opts: RolePackOutputStandardOptions = {},
): LoadRolePackOutputStandardResult {
  /**
   * 统一失败出口（单点 `log.warn` ＋ typed 结果 —— 铁律 11/24/31：不静默、不吞）。
   * 放在函数内的唯一理由：它能捕获本次调用的 `roleId`（不额外传参）。
   */
  const reject = (code: RolePackOutputStandardCode, reason: string): LoadRolePackOutputStandardResult => {
    log.warn({ roleId, code, reason, degraded: true }, '岗位输出标准不可用 — 本轮不校验（typed code）');
    return { ok: false, code, reason };
  };

  // ① 装载清单（无缓存语义：改文件即生效 —— 规格 L8）
  const report = loadRolePacks();
  const pack = report.roles.find((candidate) => candidate.roleId === roleId);
  if (pack === undefined) {
    return reject(
      'E_ROLE_PACK_NOT_FOUND',
      `岗位包不存在: ${JSON.stringify(roleId)}（内容根 ${report.root}；已装载 ${String(report.roles.length)} 个岗位）`,
    );
  }

  // ② 审批门（approved 才编译；pending/unverified ⇒ 不校验 —— 规格 D5）
  if (pack.approval.status !== 'approved') {
    const hint = pack.approval.code ?? pack.approval.reason ?? '（无记录/无原因）';
    return reject('E_ROLE_PACK_NOT_APPROVED', `${roleId}: 审批态 ${pack.approval.status} — ${hint}`);
  }

  // ③ 六件单读快照（复用 P2-2 的唯一实现；roleDir 由 ① 的 report.root 推导 —— **不二次 load**）
  const roleDir = join(report.root, ROLES_SUBDIR, roleId);
  const snapshot = readPieceBytesOnce(roleDir);
  if (!snapshot.ok) {
    // load 说 approved、快照却读不到 ⇒ load↔snapshot 的 TOCTOU 窗口（§4.5-C1：INVALID 兜这一窗）
    return reject(
      'E_ROLE_PACK_OUTPUT_INVALID',
      `${roleDir}: 六件单读快照失败（load↔snapshot 窗口）— ${snapshot.code}: ${snapshot.reason}`,
    );
  }
  const expectedHash = pack.validation.contentHash;
  if (expectedHash === undefined) {
    return reject(
      'E_ROLE_PACK_OUTPUT_INVALID',
      `${roleId}: 审批 approved 却无校验期 contentHash（不可判内容未变；load↔snapshot 窗口）`,
    );
  }
  const computedHash = computeRolePackContentHash(snapshot.pieces);
  if (computedHash !== expectedHash) {
    return reject(
      'E_ROLE_PACK_CONTENT_CHANGED',
      `${roleId}: 六件内容已变 — 磁盘 ${computedHash} ≠ 校验期 ${expectedHash}（修改后须重新审批）`,
    );
  }

  // ④ 从**同一快照**取两件字节（禁二读，封 TOCTOU）＋ 字节限额
  const criteriaBytes = snapshot.pieces.find((piece) => piece.name === CRITERIA_FILE)?.bytes;
  const templateBytes = snapshot.pieces.find((piece) => piece.name === TEMPLATE_FILE)?.bytes;
  if (criteriaBytes === undefined || templateBytes === undefined) {
    return reject(
      'E_ROLE_PACK_OUTPUT_INVALID',
      `${roleDir}: 单读快照缺 ${criteriaBytes === undefined ? CRITERIA_FILE : TEMPLATE_FILE}` +
        '（六件集合不完整；load↔snapshot 窗口）',
    );
  }
  const criteriaPath = join(roleDir, CRITERIA_FILE);
  if (criteriaBytes.length > PIECE_MAX_BYTES) {
    return reject(
      'E_ROLE_PACK_OUTPUT_INVALID',
      `${criteriaPath}: ${String(criteriaBytes.length)} B > 上限 ${String(PIECE_MAX_BYTES)} B（64 KiB；未进入解析）`,
    );
  }
  const templatePath = join(roleDir, TEMPLATE_FILE);
  if (templateBytes.length > PIECE_MAX_BYTES) {
    return reject(
      'E_ROLE_PACK_OUTPUT_INVALID',
      `${templatePath}: ${String(templateBytes.length)} B > 上限 ${String(PIECE_MAX_BYTES)} B（64 KiB；未进入解析）`,
    );
  }

  // ⑤ 解析 ＋ 编译（纯核）
  const compiled = compileOutputStandard({
    roleId,
    roleDir,
    criteriaBytes,
    templateBytes,
    now: opts.now ?? new Date().toISOString(),
  });
  if (!compiled.ok) return reject('E_ROLE_PACK_OUTPUT_INVALID', compiled.reason);

  // ⑥ `unverifiable` 可见（规格 D6：禁静默丢弃）
  const standard = compiled.standard;
  log.info(
    {
      roleId,
      checks: standard.contract.checks.length,
      unverifiable: standard.unverifiable.length,
      unverifiableIds: standard.unverifiable.map((item) => item.id),
      contractId: standard.contract.meta.id,
    },
    standard.unverifiable.length > 0
      ? '岗位输出标准已编译 — 有 criteria 不可机器判（unverifiable，可见但不判）'
      : '岗位输出标准已编译 — 全部 criteria 机器可判',
  );

  return { ok: true, standard };
}
