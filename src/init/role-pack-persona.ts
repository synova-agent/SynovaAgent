/**
 * src/init/role-pack-persona.ts — 岗位包人设＋上下文清单解析（#1075 P2-2）
 *
 * 架构位置: **引擎侧**（`src/init/`）读取**内容面**（`extensions/presets/roles/<roleId>/`）。
 *   方向单向：内容面零 import；本文件**不写盘、不触网络、不读 `contexts[].source` 指向的文件内容**
 *   （只注入清单指针 —— 规格 §2.2-D2）。提示词拼装点在 `src/agent/conversation-engine.ts`
 *   （`buildSystemPrompt()` 的 L1 之后），HTTP 流前判定点在 `src/routes/conversations.ts`。
 *
 * 设计哲学（一句）: **自校验而非信任二读，超限即拒而不是截断** ——
 *   六件原始字节自己读一次、自己算指纹、与 P2-1 校验期指纹逐字比对；审批态作最后一道门；
 *   任何越界一律报 typed code（**禁 slice／trim 后继续**）⇒「静默缩水的人设」不可能存在。
 *
 * 契约（铁律 47）:
 *   @input  — `loadRolePackPersona(roleId: string)`（IO 壳；**同步、不抛**）
 *             `buildRoleLayer(persona: RolePackPersona)`（纯核；唯一外部读 = 回滚开关 env）。
 *   @output — `LoadRolePackPersonaResult = {ok:true, persona} | {ok:false, code, reason}`
 *             （判别联合；`code` ∈ {@link RolePackPersonaCode} 五值，**不自造码**）。
 *             `persona` = `{roleId, systemAddendum（0..4000，缺省/纯空白归一为 ''）, contexts[]（≤32）}`；
 *             每条形如 `{id(1..64), label(1..80), source(1..200), why(1..200), required:boolean}`。
 *             `buildRoleLayer()` 返回「岗位设定段 ＋ 上下文清单段」，两段皆空 ⇒ `''`（**不是分隔符**）。
 *   @degraded — **不抛**：读失败／YAML 坏（含重复键）／形状非法／超限一律折成 typed code ＋ 点名 reason
 *             ＋ `log.warn`（`degraded:true`，铁律 11/24/31）。**回滚开关**（`SYNOVA_ROLE_PACK_PERSONA=off`）
 *             在 `buildRoleLayer()` 内生效：返回 `''` ＋ 一条 `log.warn`（`degraded:true`）——放这里而非 loader，
 *             因为开关**不得改变 HTTP 码语义**（路由侧判定照旧跑）。**不新增 E_* 错误码**（规格 D13）。
 *   @authority — `loadRolePackPersona()` 生产唯一调用方 = `src/routes/conversations.ts` 的**流前** rolePack
 *             判定（新绑定的审批门／已绑定会话的每轮复核）。`buildRoleLayer()` 生产唯一调用方 =
 *             `src/agent/conversation-engine.ts` 的 `buildSystemPrompt()`（`setRolePack()` 重建
 *             `messages[0]` 亦经此）。**其它模块不得复制本文件判定**；上下文内容解析归 P4。
 *   @not-here — 不做 rolePackId **形状**校验（`400 E_ROLE_PACK_ID_INVALID` 归路由层）；不做身份/角色白名单
 *             （`403 E_ROLE_PACK_FORBIDDEN` 归路由层）；不做换岗禁（`409 E_ROLE_PACK_IMMUTABLE` 归路由层）；
 *             不改 `RolePack`／审批记录（P2-1 件，红线）；不解析 `source` 指向的内容；不缓存（规格 L4）。
 *
 * 判定顺序（逐条短路；＝规格 §2.3-B，改此行须同批改 `tests/init/role-pack-persona.test.ts`）:
 *   ① `loadRolePacks()` 按 roleId 找包（无缓存语义，每轮重扫）；不存在 ⇒ `E_ROLE_PACK_NOT_FOUND`。
 *   ② `pack.validation.ok !== true` ⇒ **`E_ROLE_PACK_PERSONA_UNREADABLE`**（reason 带首个 problem.code）；
 *      此步**先于** hash 比较（N3：第 7 件／符号链接导致 pieces 集合不等时，这里就是第一道拦截）。
 *   ③ `lstatSync(<root>/roles/<id>/context-manifest.yaml)`：非普通文件（符号链接/FIFO/目录）⇒
 *      `E_ROLE_PACK_PERSONA_UNREADABLE`；`size > 64 KiB` ⇒ `E_ROLE_PACK_PERSONA_INVALID`（点名文件＋字节数）。
 *      **先于**六件读取与解析（J12 的"未进入解析"由此保证）。
 *   ④ **一次读六件原始字节**（`ROLE_PACK_PIECES`，逐件 `lstat` 判普通文件）→ `computeRolePackContentHash()`
 *      → 必须 `=== pack.validation.contentHash`；不等 ⇒ `E_ROLE_PACK_CONTENT_CHANGED`（D11 自校验）。
 *      🔴 同一份快照的 `context-manifest.yaml` 字节**再判一次上限**（封 lstat 与读之间的 TOCTOU）。
 *   ⑤ `pack.approval.status !== 'approved'` ⇒ **细分**：`approval.code === 'E_APPROVAL_CONTENT_CHANGED'`
 *      （记录指纹 ≠ 实测指纹 —— 稳态"批准后内容被改"的**主触发面**）⇒ `E_ROLE_PACK_CONTENT_CHANGED`；
 *      其余 `pending`／`unverified`（身份/租户/自绑定不符等）⇒ `E_ROLE_PACK_NOT_APPROVED`
 *      （透出 status ＋ `code`，reason 可区分）。两码在 HTTP 侧同为 409（§2.3-D）。
 *      🔴 **该映射的可核理由（L1 2026-10-29 裁定保留）**：`pack.validation.contentHash` 与本次
 *      `loadRolePacks()` **同源** ⇒ 第④步的自读比对只在 TOCTOU 窗口内会不等；**若不做本子案映射，
 *      §2.3-D 的 `409 E_ROLE_PACK_CONTENT_CHANGED` 永不可达（死码）**；两码同 409 ⇒ 不影响路由的
 *      穷尽映射表。故只映射这一个 code，**不放宽**其余 `pending`／`unverified`（仍走 NOT_APPROVED）。
 *   ⑥ 解析**第 ④ 步同一份快照**的 `context-manifest.yaml` 字节（`js-yaml` 的 `load`，不复制 P2-1 内部函数）：
 *      YAML 失败（含重复键 —— js-yaml 会抛）⇒ `E_ROLE_PACK_PERSONA_UNREADABLE`；`roleId` 不符 ⇒
 *      `E_ROLE_PACK_PERSONA_INVALID`；`prompt.systemAddendum` 缺省/纯空白 ⇒ `''`、非 string 或 >4000 ⇒
 *      `E_ROLE_PACK_PERSONA_INVALID`（点名 `prompt.systemAddendum`）；`contexts` 缺省 ⇒ `[]`、
 *      非数组或 >32 ⇒ `E_ROLE_PACK_PERSONA_INVALID`；逐条字段限额（id/label/source/why）与 `required` 类型同上。
 *      **一律不截断**（超限即报错）。
 *
 * Source map（本文件内）:
 *   | 导出 | 角色 |
 *   |---|---|
 *   | `RolePackPersona`／`RolePackPersonaContext` | 字段级契约（规格 §2.3-A） |
 *   | `RolePackPersonaCode`／`LoadRolePackPersonaResult` | typed 结果（判别联合；五码） |
 *   | `loadRolePackPersona()` | IO 壳：六件自读 → 指纹自校验 → lstat/64 KiB → 审批门 → 解析限额 |
 *   | `buildRoleLayer()` | 纯核：系统提示词的「岗位设定＋上下文清单」层（回滚开关在此） |
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · **L1 · 授权只到角色白名单**（规格 L1）：本文件只判"包是否 approved ＋ 内容是否被改"；
 *     `role` 由注册 body 决定（`src/routes/auth.ts`）⇒ 白名单不构成越权控制，岗位级授权归 P4。
 *   · **L2 · 上下文只注入清单**（规格 L2）：`contexts[].source` **原样作为指针**进提示词，本文件既不解析
 *     也不校验其目标是否存在（存在性归 P2-1 的 refs 对账）；内容注入／摘要归 P4（判据将换）。
 *   · **L9 · `ROLES_SUBDIR` 未导出**（规格 L9）：P2-1 的 `ROLES_SUBDIR` 未导出 ⇒ 本文件用字面量 `'roles'`。
 *     漂移**可观测**：`loadRolePacks()` 只在 `join(root,'roles')` 下发现角色，若本文件字面量与之不一致，
 *     第③步 `lstatSync` 必 `ENOENT` ⇒ 返回 `E_ROLE_PACK_PERSONA_UNREADABLE`（fail-loud，不静默空）。
 *     P2-1 后续若导出该常量，应改用（另批）。
 *   · **L4 · 每轮重扫内容根**（规格 L4）：`loadRolePacks()` 无缓存 ＋ 本文件自读六件 ⇒ 每轮约 10 次小文件读；
 *     规模变大需另卡加缓存（本批**故意不**加，保"改文件即生效"的宪章语义）。
 *   · **L10 · YAML 语义**（规格 L10）：只做形状与限额，不做 schema 级校验（`js-yaml` `load`；重复键抛错 ⇒
 *     `E_ROLE_PACK_PERSONA_UNREADABLE`）。`context-manifest.yaml` 其余字段（`version` 等）不判。
 *   · **L-persona-1 · 六件指纹与内容判据之间的 TOCTOU 残窗**：第①步 `loadRolePacks()` 的快照与第④步
 *     自读之间若内容被替换成"另一份六件"，本文件会用**自己的**快照重算指纹并与①的 `contentHash` 比对 ⇒
 *     不一致即拒；但"恰好读回同一份字节"的符号链接替换在本文件侧只能对 `context-manifest.yaml` 用
 *     `lstat` 拒（其余五件的 `lstat` 拒非普通文件已覆盖；同字节软链在 P2-1 `listRoleDirFiles` 侧已拒）。
 *     彻底消除需 P2-1 导出"单读快照"（规格 §4.5-C3）。
 *     🔴 **口径澄清（供复核者）**：因 `pack.validation.contentHash` 与本次 `loadRolePacks()` **同源**，
 *     第④步的比对**只在 TOCTOU 窗口内**会不等；**稳态下"改内容 ⇒ `E_ROLE_PACK_CONTENT_CHANGED`"
 *     由第⑤步的审批门子案映射产出**（`approval.code === 'E_APPROVAL_CONTENT_CHANGED'`）。
 *     两者合起来才是"自校验而非信任二读"的完整面（D11 ＋ §2.3-D 的 409 码）。
 *   · **L-persona-2 · 回滚开关是进程级**：`SYNOVA_ROLE_PACK_PERSONA=off` 对**所有**会话生效（不是单岗灰度）；
 *     正式灰度/分岗开关归 P3。开了开关仍会走第①–⑥步（只影响注入），故 HTTP 码语义不变。
 *   · **L-persona-3 · 限额按 UTF-16 码元计**：`length` 语义（与 JS 字符串一致）；emoji 等星平面字符按 2 计。
 *     超限一律拒绝，**绝不截断**（规格 D9）。
 *   · **L-persona-4 · 人设文本未做内容安全**（规格 L6）：`systemAddendum` 可含指令注入；本批只保证
 *     "原文可查／不可绕过审批"。内容安全与净化归 P3/P4。
 */
import { createLogger } from '@synova/logger';
import { lstatSync, readFileSync, type Stats } from 'fs';
import { load as parseYaml } from 'js-yaml';
import { join } from 'path';
import { loadRolePacks } from './preset-loader';
import { ROLE_PACK_PIECES, computeRolePackContentHash } from './role-pack-schema';

const log = createLogger('init/role-pack-persona');

// ══════════════════════════════════════════════════════════════════════════════
// 一、契约常量（与规格 §2.3-A／§4.5-C2 一一对应；改值须同批改测试）
// ══════════════════════════════════════════════════════════════════════════════

/** 上下文清单件名（六件之一；本文件唯一的解析对象） */
const CONTEXT_MANIFEST_FILE = 'context-manifest.yaml';

/**
 * 角色目录名（相对内容根）。🔴 规格 §10-L9：P2-1 的 `ROLES_SUBDIR` **未导出** ⇒ 本文件用字面量。
 * 漂移可观测：`loadRolePacks()` 只在 `join(root,'roles')` 下发现角色 ⇒ 若本字面量不同，
 * 第③步 `lstatSync` 必 `ENOENT` ⇒ `E_ROLE_PACK_PERSONA_UNREADABLE`（fail-loud）。
 */
const ROLES_SUBDIR = 'roles';

/** `context-manifest.yaml` 读入上限（规格 D10／J12；**先于解析**判，绝不"读进来再截"） */
const CONTEXT_MANIFEST_MAX_BYTES = 64 * 1024;

/** `prompt.systemAddendum` 字符上限（缺省/纯空白 ⇒ `''` 合法；超限 ⇒ INVALID） */
const SYSTEM_ADDENDUM_MAX_CHARS = 4000;
/** `contexts[]` 条数上限 */
const CONTEXTS_MAX_ITEMS = 32;
/** `contexts[].id` 字符上限 */
const CONTEXT_ID_MAX_CHARS = 64;
/** `contexts[].label` 字符上限 */
const CONTEXT_LABEL_MAX_CHARS = 80;
/** `contexts[].source` / `contexts[].why` 字符上限 */
const CONTEXT_TEXT_MAX_CHARS = 200;

/** D13 回滚开关名（显式降级；关掉**只影响注入**，不影响 HTTP 码语义） */
const PERSONA_ROLLBACK_ENV = 'SYNOVA_ROLE_PACK_PERSONA';
/** D13 关闭值 */
const PERSONA_ROLLBACK_OFF = 'off';

/**
 * P2-1 审批门的「记录指纹 ≠ 实测指纹」拒绝码（`src/init/role-pack-approval.ts:613` 的
 * `ApprovalRejectCode` 成员；该类型**未导出** ⇒ 此处用字面量，并以此注释指明唯一出处）。
 * 用途：把它映射成本模块更具体的 `E_ROLE_PACK_CONTENT_CHANGED`（见判定序第⑤步）。
 */
const APPROVAL_CODE_CONTENT_CHANGED = 'E_APPROVAL_CONTENT_CHANGED';

// ══════════════════════════════════════════════════════════════════════════════
// 二、类型（字段级契约 ＝ 规格 §2.3-A；只读，判别联合带 typed code）
// ══════════════════════════════════════════════════════════════════════════════

/** 一条"该岗位应带的上下文"（**指针**，不是内容 —— 规格 D2） */
export interface RolePackPersonaContext {
  /** 稳定 id（1..64 字符；`context-manifest.yaml` 里作者自定） */
  readonly id: string;
  /** 人读标签（1..80 字符；进提示词） */
  readonly label: string;
  /** 来源指针（1..200 字符；**原样注入，本文件不解析**） */
  readonly source: string;
  /** 为什么需要它（1..200 字符；进提示词） */
  readonly why: string;
  /** 必带／选带（进提示词的 `[必带]`／`[选带]` 标记） */
  readonly required: boolean;
}

/** 一个岗位包的人设面（规格 §2.3-A） */
export interface RolePackPersona {
  /** 角色 id（= 内容根下 `roles/` 的目录名） */
  readonly roleId: string;
  /** 岗位设定正文（0..4000 字符；缺省/纯空白已归一为 `''`，`buildRoleLayer` 据此省段） */
  readonly systemAddendum: string;
  /** 上下文清单（≤32 条；缺省为 `[]`） */
  readonly contexts: readonly RolePackPersonaContext[];
}

/**
 * 人设面错误码（规格 §4.5-C1 的**五值**，逐一；**禁自造第三方码**）。
 * 路由层据此映射 HTTP（404／409／400／409／400），故码值本身是契约的一部分。
 */
export type RolePackPersonaCode =
  | 'E_ROLE_PACK_NOT_FOUND'
  | 'E_ROLE_PACK_NOT_APPROVED'
  | 'E_ROLE_PACK_CONTENT_CHANGED'
  | 'E_ROLE_PACK_PERSONA_UNREADABLE'
  | 'E_ROLE_PACK_PERSONA_INVALID';

/** `loadRolePackPersona()` 结果（判别联合；**不抛**） */
export type LoadRolePackPersonaResult =
  | { readonly ok: true; readonly persona: RolePackPersona }
  | { readonly ok: false; readonly code: RolePackPersonaCode; readonly reason: string };

/** 内部：解析结果（与对外结果同形，供 `parsePersonaDoc()` 用） */
type ParseOutcome =
  | { readonly ok: true; readonly persona: RolePackPersona }
  | { readonly ok: false; readonly code: RolePackPersonaCode; readonly reason: string };

/** 内部：六件单读快照（`name` 按 `ROLE_PACK_PIECES` 顺序；`bytes` 是磁盘原始字节） */
type PieceSnapshot =
  | { readonly ok: true; readonly pieces: readonly { readonly name: string; readonly bytes: Buffer }[] }
  | { readonly ok: false; readonly code: RolePackPersonaCode; readonly reason: string };

// ══════════════════════════════════════════════════════════════════════════════
// 三、小工具（纯函数；不抛）
// ══════════════════════════════════════════════════════════════════════════════

/** 失败结果的**唯一**构造点（保证 `code`／`reason` 恒在，禁零散字面量） */
function fail(code: RolePackPersonaCode, reason: string): ParseOutcome {
  return { ok: false, code, reason };
}

/** 值的人读展示（`reason` 里点名用；**不用** `as`，也不假定可 JSON 化） */
function show(value: unknown): string {
  if (value === undefined) return '（缺省）';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `数组(${String(value.length)})`;
  return typeof value;
}

/** YAML 映射判断（`load()` 返回 `unknown`，一切按键访问前必须过此关） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 异常的人读展示（`catch` 里点名原因用 —— 铁律 11/24：不吞） */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 必填字符串 ＋ 限额（contexts 的四个文本字段共用；**超限报错、绝不截断** —— 规格 D9）。
 *
 * @param value - 待判值（YAML 出身，`unknown`，绝不信任）
 * @param maxChars - 字符上限（UTF-16 码元）
 * @param at - 点名用的字段路径（如 `contexts[0].label`）
 * @returns `{ok:true, value}` 或 `{ok:false, reason}`（reason 点名 `at` ＋ 实际长度/类型）
 */
function readLimitedString(
  value: unknown,
  maxChars: number,
  at: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string } {
  if (value === undefined || value === null) {
    return { ok: false, reason: `${at}: 缺省（必填，1..${String(maxChars)} 字符）` };
  }
  if (typeof value !== 'string') {
    return { ok: false, reason: `${at}: 必须是 string，实为 ${show(value)}` };
  }
  if (value.trim().length === 0) {
    return { ok: false, reason: `${at}: 空/纯空白（必填，1..${String(maxChars)} 字符）` };
  }
  if (value.length > maxChars) {
    return {
      ok: false,
      reason: `${at}: ${String(value.length)} 字符 > 上限 ${String(maxChars)}（不截断 —— 规格 D9）`,
    };
  }
  return { ok: true, value };
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、IO 壳 ①：六件单读快照（一次读；逐件 lstat 拒非普通文件）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 读六件原始字节（**唯一一次读**；hash 与解析共用这份快照 —— 规格 D11）。
 *
 * 逐件先 `lstatSync` 再 `readFileSync`：非普通文件（符号链接／FIFO／子目录）一律拒
 * （规格 D12／P2-L10 的"P2-2 接入前必须封"；不跟随符号链接 ⇒ 指纹对象与解析对象同一）。
 *
 * 🔴 **本批对「六件」都做 lstat 普通文件校验**，**严于**规格 §2.3-B step3（那里只点名
 *   `context-manifest.yaml`）：六件**都要参与** `contentHash`，读到符号链接会导致
 *   「读到的字节 ≠ 指纹的源」——这正是 P2-1 的 P2-L10 要求"P2-2 接入前必须封"的残口。
 *   该加严是**超集**，不改变任何判据的期望码（J11 只要求 `context-manifest.yaml` 的符号链接被拒）。
 *   同理，第③步只对 `context-manifest.yaml` 判 `> 64 KiB`（读入上限是"要解析的件"的属性），
 *   两处各司其职、不互相代替。
 *
 * @param roleDir - 角色包目录（绝对路径）
 * @returns 快照 或 typed 失败（`E_ROLE_PACK_PERSONA_UNREADABLE`，reason 点名文件＋原因）
 */
function readPieceBytesOnce(roleDir: string): PieceSnapshot {
  const pieces: { readonly name: string; readonly bytes: Buffer }[] = [];
  for (const name of ROLE_PACK_PIECES) {
    const abs = join(roleDir, name);
    try {
      const stat = lstatSync(abs);
      if (!stat.isFile()) {
        return {
          ok: false,
          code: 'E_ROLE_PACK_PERSONA_UNREADABLE',
          reason: `${abs}: 非普通文件（符号链接/目录/FIFO 一律拒 —— 不跟随，规格 D12）`,
        };
      }
      pieces.push({ name, bytes: readFileSync(abs) });
    } catch (err: unknown) {
      return {
        ok: false,
        code: 'E_ROLE_PACK_PERSONA_UNREADABLE',
        reason: `${abs}: 读取失败 — ${describeError(err)}`,
      };
    }
  }
  return { ok: true, pieces };
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、纯核：解析 context-manifest.yaml 的人设面（形状 ＋ 限额；不读盘、不抛）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 解析人设面（**入参是第④步同一份快照的字节**，不再读盘 —— 规格 D11）。
 *
 * 归因顺序: YAML 失败（含重复键）⇒ `PERSONA_UNREADABLE`；顶层非映射／`roleId` 不符／字段形状与限额
 * 违规 ⇒ `PERSONA_INVALID`（reason 逐条点名到字段）。`prompt.systemAddendum` 缺省或纯空白 ⇒ `''`（合法）。
 *
 * @param bytes - `context-manifest.yaml` 的原始字节（UTF-8 解码后交 `js-yaml` 的 `load`）
 * @param roleId - 期望的岗位 id（与顶层 `roleId` 逐字比对；身份绑定）
 * @param manifestPath - 点名用的绝对路径（只进 reason，不做 IO）
 * @returns `{ok:true, persona}` 或 typed 失败
 */
function parsePersonaDoc(bytes: Buffer, roleId: string, manifestPath: string): ParseOutcome {
  let doc: unknown;
  try {
    doc = parseYaml(bytes.toString('utf8'));
  } catch (err: unknown) {
    // 重复键（js-yaml 抛 "duplicated mapping key"）也走这里 —— 规格 §10-L10
    return fail(
      'E_ROLE_PACK_PERSONA_UNREADABLE',
      `${manifestPath}: YAML 解析失败（重复键亦在此拦）— ${describeError(err)}`,
    );
  }
  if (!isRecord(doc)) {
    return fail(
      'E_ROLE_PACK_PERSONA_INVALID',
      `${manifestPath}: 顶层必须是映射对象，实为 ${show(doc)}`,
    );
  }

  // ⓪ 身份绑定：context-manifest 的 roleId 必须与目录名一致（防串岗/沿包改名）
  const declaredRoleId = doc['roleId'];
  if (typeof declaredRoleId !== 'string' || declaredRoleId !== roleId) {
    return fail(
      'E_ROLE_PACK_PERSONA_INVALID',
      `${manifestPath}: roleId=${show(declaredRoleId)} ≠ 入参 ${show(roleId)}（身份绑定）`,
    );
  }

  // ① prompt.systemAddendum（0..4000；缺省/纯空白 ⇒ ''）
  const promptDoc = doc['prompt'];
  if (promptDoc !== undefined && !isRecord(promptDoc)) {
    return fail(
      'E_ROLE_PACK_PERSONA_INVALID',
      `${manifestPath}: prompt 必须是映射对象，实为 ${show(promptDoc)}`,
    );
  }
  const addendumRaw = isRecord(promptDoc) ? promptDoc['systemAddendum'] : undefined;
  let systemAddendum = '';
  if (addendumRaw !== undefined) {
    if (typeof addendumRaw !== 'string') {
      return fail(
        'E_ROLE_PACK_PERSONA_INVALID',
        `${manifestPath}: prompt.systemAddendum 必须是 string，实为 ${show(addendumRaw)}`,
      );
    }
    if (addendumRaw.trim().length > 0) {
      if (addendumRaw.length > SYSTEM_ADDENDUM_MAX_CHARS) {
        return fail(
          'E_ROLE_PACK_PERSONA_INVALID',
          `${manifestPath}: prompt.systemAddendum ${String(addendumRaw.length)} 字符 > 上限 ` +
            `${String(SYSTEM_ADDENDUM_MAX_CHARS)}（不截断 —— 规格 D9）`,
        );
      }
      systemAddendum = addendumRaw;
    }
  }

  // ② contexts（缺省 ⇒ []；≤32）
  const contextsRaw = doc['contexts'];
  const contexts: RolePackPersonaContext[] = [];
  if (contextsRaw !== undefined) {
    if (!Array.isArray(contextsRaw)) {
      return fail(
        'E_ROLE_PACK_PERSONA_INVALID',
        `${manifestPath}: contexts 必须是数组，实为 ${show(contextsRaw)}`,
      );
    }
    if (contextsRaw.length > CONTEXTS_MAX_ITEMS) {
      return fail(
        'E_ROLE_PACK_PERSONA_INVALID',
        `${manifestPath}: contexts ${String(contextsRaw.length)} 条 > 上限 ` +
          `${String(CONTEXTS_MAX_ITEMS)}（不截断 —— 规格 D9）`,
      );
    }
    for (let index = 0; index < contextsRaw.length; index += 1) {
      const item: unknown = contextsRaw[index];
      const at = `contexts[${String(index)}]`;
      if (!isRecord(item)) {
        return fail(
          'E_ROLE_PACK_PERSONA_INVALID',
          `${manifestPath}: ${at} 必须是映射对象，实为 ${show(item)}`,
        );
      }
      const id = readLimitedString(item['id'], CONTEXT_ID_MAX_CHARS, `${at}.id`);
      if (!id.ok) return fail('E_ROLE_PACK_PERSONA_INVALID', `${manifestPath}: ${id.reason}`);
      const label = readLimitedString(item['label'], CONTEXT_LABEL_MAX_CHARS, `${at}.label`);
      if (!label.ok) return fail('E_ROLE_PACK_PERSONA_INVALID', `${manifestPath}: ${label.reason}`);
      const source = readLimitedString(item['source'], CONTEXT_TEXT_MAX_CHARS, `${at}.source`);
      if (!source.ok) return fail('E_ROLE_PACK_PERSONA_INVALID', `${manifestPath}: ${source.reason}`);
      const why = readLimitedString(item['why'], CONTEXT_TEXT_MAX_CHARS, `${at}.why`);
      if (!why.ok) return fail('E_ROLE_PACK_PERSONA_INVALID', `${manifestPath}: ${why.reason}`);
      const required = item['required'];
      if (typeof required !== 'boolean') {
        return fail(
          'E_ROLE_PACK_PERSONA_INVALID',
          `${manifestPath}: ${at}.required 必须是 boolean，实为 ${show(required)}`,
        );
      }
      contexts.push({
        id: id.value,
        label: label.value,
        source: source.value,
        why: why.value,
        required,
      });
    }
  }

  return { ok: true, persona: { roleId, systemAddendum, contexts } };
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、IO 壳 ②：对外入口（判定顺序逐条短路 —— 规格 §2.3-B）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 取某岗位的人设面（**同步、不抛**；判定顺序见文件头）。
 *
 * @param roleId - 岗位 id（**形状校验归路由层**；本文件只按装载清单精确匹配，故无路径穿越面）
 * @returns `{ok:true, persona}` 或 `{ok:false, code, reason}`（码表：NOT_FOUND／PERSONA_UNREADABLE／
 *          PERSONA_INVALID／CONTENT_CHANGED／NOT_APPROVED）
 *
 * @degraded 任一步失败 ⇒ 一条 `log.warn`（带 `code`／`roleId`／`degraded:true`）＋ typed 结果；
 *           调用方（路由）据此决定 404/409/400 或"已绑定会话 200＋degraded 头"。
 */
export function loadRolePackPersona(roleId: string): LoadRolePackPersonaResult {
  /**
   * 统一的失败出口（单点 log.warn ＋ typed 结果 —— 铁律 11/24/31：不静默、不吞）。
   * 放在函数内的唯一理由是它能捕获本次调用的 `roleId`（不额外传参）。
   */
  const reject = (code: RolePackPersonaCode, reason: string): LoadRolePackPersonaResult => {
    log.warn({ roleId, code, reason, degraded: true }, '岗位人设不可用 — 该岗位本轮不注入（typed code）');
    return { ok: false, code, reason };
  };

  // ① 装载清单（无缓存语义：改文件即生效 —— 规格 L4）
  const report = loadRolePacks();
  const pack = report.roles.find((candidate) => candidate.roleId === roleId);
  if (pack === undefined) {
    return reject(
      'E_ROLE_PACK_NOT_FOUND',
      `岗位包不存在: ${JSON.stringify(roleId)}（内容根 ${report.root}；已装载 ${String(report.roles.length)} 个岗位）`,
    );
  }

  // ② P2-1 结构/refs 校验**先于** hash（N3）：第 7 件／符号链接在此第一道拦下
  if (pack.validation.ok !== true) {
    const firstProblem = pack.validation.problems[0];
    const firstCode = firstProblem === undefined ? '（无 problem 明细）' : firstProblem.code;
    const detail =
      firstProblem === undefined ? '' : `；首个问题 ${firstProblem.code}: ${firstProblem.message}`;
    return reject(
      'E_ROLE_PACK_PERSONA_UNREADABLE',
      `${roleId}: 岗位包结构/refs 校验未通过（${String(pack.validation.problems.length)} 条问题；` +
        `首个 code=${firstCode}）${detail}`,
    );
  }

  // ③ context-manifest.yaml 的 lstat 门（**先于六件读取与解析**：非普通文件／超上限都在此拦）
  const roleDir = join(report.root, ROLES_SUBDIR, roleId);
  const manifestPath = join(roleDir, CONTEXT_MANIFEST_FILE);
  let manifestStat: Stats;
  try {
    manifestStat = lstatSync(manifestPath);
  } catch (err: unknown) {
    return reject(
      'E_ROLE_PACK_PERSONA_UNREADABLE',
      `${manifestPath}: lstat 失败 — ${describeError(err)}（若内容根/角色目录名漂移，见规格 L9）`,
    );
  }
  if (!manifestStat.isFile()) {
    return reject(
      'E_ROLE_PACK_PERSONA_UNREADABLE',
      `${manifestPath}: 非普通文件（符号链接/目录/FIFO 一律拒 —— 不跟随，规格 D12）`,
    );
  }
  if (manifestStat.size > CONTEXT_MANIFEST_MAX_BYTES) {
    return reject(
      'E_ROLE_PACK_PERSONA_INVALID',
      `${manifestPath}: ${String(manifestStat.size)} B > 上限 ${String(CONTEXT_MANIFEST_MAX_BYTES)} B` +
        '（64 KiB；未进入解析 —— 规格 D10）',
    );
  }

  // ④ 一次读六件 → 自算指纹 → 必须等于校验期指纹（D11：自校验，不信任"二读"）
  const snapshot = readPieceBytesOnce(roleDir);
  if (!snapshot.ok) return reject(snapshot.code, snapshot.reason);

  const manifestBytes = snapshot.pieces.find((piece) => piece.name === CONTEXT_MANIFEST_FILE)?.bytes;
  if (manifestBytes === undefined) {
    return reject(
      'E_ROLE_PACK_PERSONA_UNREADABLE',
      `${manifestPath}: 单读快照缺该件（六件集合不完整）`,
    );
  }
  // ④b 同一份字节再判上限：封 ③ 的 lstat 与 ④ 的读取之间的 TOCTOU（读到更大 ⇒ 仍拒，不解析）
  if (manifestBytes.length > CONTEXT_MANIFEST_MAX_BYTES) {
    return reject(
      'E_ROLE_PACK_PERSONA_INVALID',
      `${manifestPath}: 读到 ${String(manifestBytes.length)} B > 上限 ` +
        `${String(CONTEXT_MANIFEST_MAX_BYTES)} B（64 KiB；未进入解析 —— 规格 D10）`,
    );
  }

  const expectedHash = pack.validation.contentHash;
  if (expectedHash === undefined) {
    // validation.ok 却无 fingerprint（P2-1 §2.3-E：ok:true 时必有）；缺 ⇒ 不能判"内容未变"
    return reject(
      'E_ROLE_PACK_PERSONA_UNREADABLE',
      `${roleId}: 校验期无 contentHash（validation.ok 但缺指纹 ⇒ 不可判内容是否被改）`,
    );
  }
  const computedHash = computeRolePackContentHash(snapshot.pieces);
  if (computedHash !== expectedHash) {
    return reject(
      'E_ROLE_PACK_CONTENT_CHANGED',
      `${roleId}: 六件内容已变 — 磁盘 ${computedHash} ≠ 校验期 ${expectedHash}（修改后须重新审批）`,
    );
  }

  // ⑤ 审批门（最后一道；pending/unverified 同走本步，但"内容指纹不符"给**更具体**的码）
  if (pack.approval.status !== 'approved') {
    /**
     * 子案映射（**E_ROLE_PACK_CONTENT_CHANGED 的生产主触发面**）：
     * 第④步的自读比对只在"`loadRolePacks()` 与本次自读之间"的 TOCTOU 窗口内会不等
     * （`pack.validation.contentHash` 与本次 load 同源）；**稳态下的"改内容"**由 P2-1 的审批门判出
     * ——`approval.code === 'E_APPROVAL_CONTENT_CHANGED'`（记录指纹 ≠ 实测指纹）。
     * 该子案映射为本模块的 `E_ROLE_PACK_CONTENT_CHANGED`（而不是泛化 `NOT_APPROVED`）：
     * 语义即"批准之后内容被改"，也是 §2.3-D 把 `409 E_ROLE_PACK_CONTENT_CHANGED` 列为用户可见码的唯一来源。
     * 其余 `pending`／`unverified`（身份/租户/自绑定不符等）仍统一 `E_ROLE_PACK_NOT_APPROVED`。
     */
    if (pack.approval.code === APPROVAL_CODE_CONTENT_CHANGED) {
      return reject(
        'E_ROLE_PACK_CONTENT_CHANGED',
        `${roleId}: 六件内容与审批记录不符 — 审批门 code=${APPROVAL_CODE_CONTENT_CHANGED}；` +
          `${pack.approval.reason ?? '（无原因）'}（修改后须重新审批；不注入）`,
      );
    }
    const hint = pack.approval.code ?? pack.approval.reason ?? '（无记录/无原因）';
    return reject(
      'E_ROLE_PACK_NOT_APPROVED',
      `${roleId}: 审批态 ${pack.approval.status} — ${hint}`,
    );
  }

  // ⑥ 解析**同一份快照**的 context-manifest.yaml（不再读盘）
  const parsed = parsePersonaDoc(manifestBytes, roleId, manifestPath);
  if (!parsed.ok) return reject(parsed.code, parsed.reason);

  return { ok: true, persona: parsed.persona };
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、纯核：系统提示词的「岗位设定＋上下文清单」层（规格 §2.3-C 逐字格式）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 把 persona 渲染成系统提示词里的一段（**纯核**；唯一外部读 = D13 回滚开关 env）。
 *
 * 逐字格式（规格 §2.3-C）:
 * ```
 * ## 岗位设定：<roleId>
 * <systemAddendum>
 *
 * ## 该岗位应带的上下文（按需读取，不要凭空假设）
 * - [必带|选带] <label> —— <why>（source: <source>）
 * ```
 * `systemAddendum` 为空 ⇒ 第一段整段省略；`contexts` 为空 ⇒ 第二段整段省略；
 * 两段皆空 ⇒ 返回 `''`（**不是分隔符** —— 否则无包会话的提示词会多出空段，J3 逐字基线即红）。
 *
 * 🔴 **只注入清单指针，绝不读 `source` 指向的文件内容**（规格 D2／红线）。
 * 🔴 尾部换行归一：YAML 块标量（`systemAddendum: |`）的尾换行是格式产物，拼装前剥掉，
 *    以免段间出现三连换行；**不 trim 正文内部与行尾空格**（不静默改写内容）。
 *
 * @param persona - 已通过限额校验的人设面（本函数不重复判限额）
 * @returns 提示词层字符串；被回滚开关关闭或两段皆空 ⇒ `''`
 *
 * @degraded `SYNOVA_ROLE_PACK_PERSONA=off` ⇒ 返回 `''` ＋ 一条 `log.warn`（`degraded:true`）。
 *           开关**只**影响注入（HTTP 码语义不变 —— 放此处而非 loader 的理由，规格 D13）。
 * @authority 生产唯一调用方 = `src/agent/conversation-engine.ts` 的 `buildSystemPrompt()`
 *           （构造期、`setRolePack()` 重建 `messages[0]`、相位重建三处都经它）。
 */
export function buildRoleLayer(persona: RolePackPersona): string {
  const rollback = process.env[PERSONA_ROLLBACK_ENV] === PERSONA_ROLLBACK_OFF;

  const sections: string[] = [];
  const addendum = persona.systemAddendum.replace(/[\r\n]+$/, '');
  if (addendum.trim().length > 0) {
    sections.push(`## 岗位设定：${persona.roleId}\n${addendum}`);
  }
  if (persona.contexts.length > 0) {
    const lines = persona.contexts.map(
      (context) =>
        `- [${context.required ? '必带' : '选带'}] ${context.label} —— ${context.why}` +
        `（source: ${context.source}）`,
    );
    sections.push(`## 该岗位应带的上下文（按需读取，不要凭空假设）\n${lines.join('\n')}`);
  }

  const layer = sections.join('\n\n');
  if (rollback) {
    if (layer !== '') {
      log.warn(
        { roleId: persona.roleId, env: PERSONA_ROLLBACK_ENV, degraded: true },
        '岗位人设层被回滚开关关闭 — 本轮不注入（显式降级，非默认）',
      );
    }
    return '';
  }
  return layer;
}
