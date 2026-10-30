/**
 * init/role-pack-knowledge-filter.ts — #1075 P2-4b-B 角色会话知识过滤编译器
 *
 * 一句话: 把「该岗位包的 `knowledge-scope.yaml`（scope/deny）」＋「认证面同源敏感度」编译成
 *   L4 可直接执行的 `FilterClause`（**只编译条件，不执行检索、不感知数据库**）。
 *
 * 设计哲学（一句）: **只编译、不判定** —— 一个分离（过滤器在这里编译，检索在 L4 执行，身份/审批在各自上游）
 *   ＋ 三条承诺（fail-closed 拒绝型优先、敏感度与认证面同源、不复制任何 YAML/scope 解析）。
 *
 * 归属与依据（#1075 / K12-11 / #731）:
 *   · 敏感度**唯一漏斗** = `allowedSensitivitiesByGrants`（`src/middleware/auth.ts:373`；档位∩grants）
 *     —— 与认证主路径（`auth.ts:964`）同源，**不用** `sensitivityWhitelistFromGrants`（比认证面宽一档）。
 *   · scope/deny 解析 = `resolveRoleKnowledgeScope`（`src/init/preset-loader.ts:598`；审批门＋内容校验的
 *     唯一真源）—— 本模块**不复制** YAML 解析、不复制审批判定。
 *
 * 契约（铁律 47）:
 *   @input    — `roleId`（岗位包角色 id，来自验签身份/绑定的岗位包）；`orgId`（客户槽；缺省由
 *               `resolveRoleKnowledgeScope` 按 `SYNOVA_ORG_ID`/config 解析）
 *   @output   — `{ok:true, filter}`：`conditions` 顺序固定（**是判据，不得重排**）——
 *               第 0「access.sensitivity IN 敏感度白名单」、第 1「access.level IN ['public','team']」、
 *               第 2「pkb_domain IN scopes」、随后每个 deny 一条「pkb_domain NOT_EQ id」；
 *               `{ok:false, code:'E_KNOWLEDGE_SCOPE_UNAVAILABLE', reason}` 仅用于**未预期异常**
 *               （调用方按拒绝型处理，绝不回落全库）
 *   @degraded — **本函数从不抛**。三条降级路径全部收敛为**拒绝型**（`pkb_domain IN []` ⇒ 0 行，不放宽）:
 *               ① 审批未通过/内容坏/scope 缺失（`resolveRoleKnowledgeScope().degraded`）；
 *               ② `declared=false`（角色目录不存在 —— 对**角色会话**不可达，见 §10-L7；异常出现时保守拒绝）；
 *               ③ 未预期异常 ⇒ `ok:false`（调用方同样渲染拒绝型）。
 *               三者均 `log.warn`（铁律 11/31：不静默降级）。
 *   @authority — 只读：不写内容面、不改审批记录、不签发身份、不做 scope write。
 *   @not-here  — YAML/scope/审批解析（`src/init/preset-loader.ts`）、敏感度规则（`src/middleware/auth.ts`）、
 *               检索执行与过滤（`src/l4/knowledge-store.ts`）、工具注册（`src/agent/tools.ts`）。
 *   @error     — 无自定义错误类型：异常经 `ok:false` ＋ `code` 表达（永不抛，见上）。
 *
 * 已知限制（Known Limitations）:
 *   · 只覆盖 sensitivity ＋ `access_level` ＋ pkb_domain 三维；`access_level` **恒只放行
 *     `public`/`team` 两档**（#1167 补丁A，与 HTTP 面 `src/routes/knowledge-ask.ts:124-126` 同口径），
 *     `private`/`owner` 条目**恒不返回** —— 本过滤器**不**给 owner 归属做例外（规格 §4 最严口径）；
 *     同租户内"本人 private 可见"要另卡（需 ownerId 进条件，属判据变更，不在本条内）。
 *   · 「未打标的 chunk」（`pkb_domain = NULL`）**恒不返回** —— 这是 fail-closed 的应有行为，
 *     历史数据需回填（规格 §10-L1）。
 *   · `declared=false` 分支与 auth 的 I-C4（不追加 scope 维）**不是同一分支**：这里恒拒绝（§10-L7）。
 */
import { createLogger } from '@synova/logger';
import { allowedSensitivitiesByGrants } from '../middleware/auth';
import { resolveRoleKnowledgeScope } from './preset-loader';

const log = createLogger('init/role-pack-knowledge-filter');

/** 编译结果的条件项（与 `src/l4/knowledge-store.ts` 的 `FilterClause.conditions` 元素同形，可直传） */
export interface RoleKnowledgeCondition {
  field: string;
  operator: 'IN' | 'EQ' | 'NOT_EQ';
  value: unknown;
}

/**
 * 角色会话知识过滤面（**编译产物**；只读快照）。
 *
 * `conditions` 是**可变** `Array` —— `FilterClause.conditions` 是 mutable Array，
 * `readonly`/`ReadonlyArray` 不可赋 ⇒ `tsc --noEmit` 必红。
 */
export interface RoleKnowledgeFilter {
  readonly conditions: Array<RoleKnowledgeCondition>;
  /** 认证面同源敏感度白名单（档位∩grants；观察/留痕用，已内联在 conditions[0]） */
  readonly sensitivity: readonly string[];
  /** 本角色包的 pkb_domain 白名单（declared scopes；观察/留痕用） */
  readonly scopes: readonly string[];
  /** 任一降级（审批未过/内容坏/未声明/异常）⇒ `true`；此时 conditions 恒为拒绝型 */
  readonly degraded: boolean;
}

/** 已知限制：拒绝型是**唯一**降级出口 —— 任何不确定都收敛到"一件都不给看"。 */
const REJECT_CONDITIONS: Array<RoleKnowledgeCondition> = [{ field: 'pkb_domain', operator: 'IN', value: [] }];

/**
 * 角色会话检索面放行的 `access_level`（#1167 补丁A；与 HTTP 面
 * `src/routes/knowledge-ask.ts:124-126` 的 `['public','team']` **逐字同集合**）。
 *
 * 🔴 最严口径：**只** `public`/`team`，**不得**加 `private`/`owner` 例外（规格 §4）。
 * 单值 `access_level` 列 ＋ `matchFilter` 严格 AND 语义下，缺这条会让角色会话把
 * `private` 条目一并返回（`src/l4/knowledge-store.ts:725-748`）。
 */
const ROLE_KNOWLEDGE_ACCESS_LEVELS: readonly string[] = ['public', 'team'];

/**
 * 构造**拒绝型**过滤面（`pkb_domain IN []` ⇒ L4 严格 AND 下恒 0 行）。
 *
 * @input  `reason` — 拒绝原因（只进日志，不进 SQL）
 * @output `RoleKnowledgeFilter`（`degraded:true`；`sensitivity`/`scopes` 为空）
 * @degraded 本身就是降级产物；`log.warn` 由调用方按上下文补
 * @error  永不抛
 */
export function buildRejectedKnowledgeFilter(reason: string): RoleKnowledgeFilter {
  log.warn({ reason, degraded: true, code: 'KNOWLEDGE_FILTER_REJECTED' }, '角色会话知识过滤为拒绝型（fail-closed，0 行）');
  return {
    conditions: REJECT_CONDITIONS.map((condition) => ({ ...condition })),
    sensitivity: [],
    scopes: [],
    degraded: true,
  };
}

/**
 * 编译某岗位（客户槽）的角色会话知识过滤面。
 *
 * 条件顺序（**是判据的一部分，不得重排**）:
 *   `[0] access.sensitivity IN 敏感度白名单` → `[1] access.level IN ['public','team']`
 *   → `[2] pkb_domain IN scopes` → 每个 deny 一条 `pkb_domain NOT_EQ id`
 *
 * @input  `roleId` — 岗位包角色 id；`orgId` — 客户槽（可选，缺省交给 loader 解析）
 * @output `{ok:true, filter}` 或 `{ok:false, code:'E_KNOWLEDGE_SCOPE_UNAVAILABLE', reason}`
 * @degraded 见文件头；**不抛**，降级恒为拒绝型（`pkb_domain IN []`）
 */
export function buildRoleKnowledgeFilter(
  roleId: string,
  orgId?: string,
): { ok: true; filter: RoleKnowledgeFilter } | { ok: false; code: 'E_KNOWLEDGE_SCOPE_UNAVAILABLE'; reason: string } {
  try {
    // ① 敏感度：认证面唯一漏斗（档位 ∩ 项模型 grants）。非 admin 档位上限 = normal ⇒ 通常 ['normal']。
    const sensitivity = allowedSensitivitiesByGrants(roleId, 'normal', orgId);

    // ② scope/deny：复用 loader 的请求路径解析（审批门＋内容校验的唯一真源，本模块不复制）
    const scope = resolveRoleKnowledgeScope(roleId, { orgId });

    if (scope.degraded) {
      // 审批未过／内容坏／scope 缺失/空 ⇒ 整岗一件都不给看（与 loader 注释的第②③④分支同向）
      log.warn(
        { roleId, orgId, problems: scope.problems, degraded: true, code: 'KNOWLEDGE_SCOPE_UNAVAILABLE' },
        '角色会话知识过滤 fail-closed — scope 不可用 ⇒ pkb_domain IN []（0 行）',
      );
      return {
        ok: true,
        filter: {
          conditions: REJECT_CONDITIONS.map((condition) => ({ ...condition })),
          sensitivity,
          scopes: [],
          degraded: true,
        },
      };
    }

    if (!scope.declared) {
      // §10-L7：角色会话恒有包目录 ⇒ 本分支**不可达**；若异常出现（缓存/竞态）按 degraded 保守拒绝。
      log.warn(
        { roleId, orgId, degraded: true, code: 'KNOWLEDGE_SCOPE_NOT_DECLARED' },
        '角色会话命中「未声明 scope」异常分支 — 按拒绝型处理（不追加 scope 维的宽松路径在这里禁用，§10-L7）',
      );
      return {
        ok: true,
        filter: {
          conditions: REJECT_CONDITIONS.map((condition) => ({ ...condition })),
          sensitivity,
          scopes: [],
          degraded: true,
        },
      };
    }

    const scopes = [...scope.scopeIds];
    const denied = [...scope.denyIds];
    // ⚠️ 形态约束（不是风格偏好）: 条件对象**先具名再组装**，且 `value:` 不得出现在行首
    //   （`scripts/control-tower/check-quality-delta.py:421` 的 R4.4 启发式对行首
    //   `value|secret|token:` 判「凭据读面返回明文」；实证见 `src/routes/knowledge-ask.ts:118-124`）。
    const sensitivityCondition: RoleKnowledgeCondition = {
      field: 'access.sensitivity', operator: 'IN', value: sensitivity,
    };
    // #1167 补丁A: access_level 维（只 public/team）—— 位置固定第 1，插在 scope 之前。
    const accessLevelCondition: RoleKnowledgeCondition = {
      field: 'access.level', operator: 'IN', value: [...ROLE_KNOWLEDGE_ACCESS_LEVELS],
    };
    const scopeCondition: RoleKnowledgeCondition = {
      field: 'pkb_domain', operator: 'IN', value: scopes,
    };
    const conditions: Array<RoleKnowledgeCondition> = [
      sensitivityCondition,
      accessLevelCondition,
      scopeCondition,
    ];
    // D5: deny 逐条 NOT_EQ 追加在 access.level/scope 之后（AND 语义 ⇒ 只减不增）
    for (const deniedId of denied) {
      conditions.push({ field: 'pkb_domain', operator: 'NOT_EQ', value: deniedId });
    }

    return {
      ok: true,
      filter: { conditions, sensitivity, scopes, degraded: false },
    };
  } catch (err: unknown) {
    // 未预期异常（loader/grants 内部保险）：收敛为 ok:false，调用方渲染拒绝型；绝不回落全库
    const reason = err instanceof Error ? err.message : String(err);
    log.warn(
      { roleId, orgId, err: reason, degraded: true, code: 'E_KNOWLEDGE_SCOPE_UNAVAILABLE' },
      '角色会话知识过滤编译未预期异常 — 收敛为拒绝型（不放宽，不抛）',
    );
    return { ok: false, code: 'E_KNOWLEDGE_SCOPE_UNAVAILABLE', reason };
  }
}
