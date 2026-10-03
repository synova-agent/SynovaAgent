/**
 * middleware/rbac.ts — 权限控制 + GA 权限边界 (D239) + 权限模板 (D242)
 *
 * D242: RoleTemplate 类型 + BUILTIN_TEMPLATES + derivePermissions()
 *       admin: 全局读写 / manager: 本部门读写 / liaison: 全局只读
 *       staff: 本部门只读 / ga: 受约束只读 (D239)
 */
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '@synova/logger';

const log = createLogger('middleware/rbac');

export type WorkspaceRole = 'admin' | 'manager' | 'liaison' | 'staff' | 'ga';

/**
 * D947: 无凭据请求的占位身份/占位角色。
 *
 * 占位角色仅用于满足 {@link RbacContext} 的类型（'staff' 本身不是放行依据）——
 * 放行与否只由 `authenticated === false` 前置短路决定，
 * 见 {@link canAccessWorkspace} / {@link canModifyWorkspace}。
 */
const ANONYMOUS_ROLE: WorkspaceRole = 'staff';
const ANONYMOUS_USER = 'unauthenticated';

// ═══ D242: 权限模板 ═══

/** 权限集合 */
export interface PermissionSet {
  /** 数据权限: read / write / admin */
  data: 'read' | 'write' | 'admin';
  /** 功能权限: use / manage / audit */
  function: 'use' | 'manage' | 'audit';
  /** 时间限制: unlimited / business_hours / custom */
  time: 'unlimited' | 'business_hours' | 'custom';
}

/** 角色模板 */
export interface RoleTemplate {
  id: string;
  name: string;
  description: string;
  basedOn?: string;
  permissions: PermissionSet;
  isBuiltin: boolean;
  createdAt?: string;
}

/** 5 个内置模板（不可删除） */
export const BUILTIN_TEMPLATES: RoleTemplate[] = [
  {
    id: 'admin', name: 'Administrator', description: '全局读写 + 所有部门只读 + 创建/分配子工作区',
    permissions: { data: 'admin', function: 'audit', time: 'unlimited' }, isBuiltin: true,
  },
  {
    id: 'manager', name: 'Manager', description: '本部门读写 + 不可见全局/其他部门',
    permissions: { data: 'write', function: 'manage', time: 'unlimited' }, isBuiltin: true,
  },
  {
    id: 'liaison', name: 'Liaison', description: '全局只读 + 所有部门只读 + 冲突检测',
    permissions: { data: 'read', function: 'use', time: 'unlimited' }, isBuiltin: true,
  },
  {
    id: 'staff', name: 'Staff', description: '本部门只读',
    permissions: { data: 'read', function: 'use', time: 'business_hours' }, isBuiltin: true,
  },
  {
    id: 'ga', name: 'Growth Advisor', description: '受约束的只读访问',
    permissions: { data: 'read', function: 'audit', time: 'business_hours' }, isBuiltin: true,
  },
];

/** 从模板派生实际权限（支持覆盖） */
export function derivePermissions(
  template: RoleTemplate,
  overrides?: Partial<PermissionSet>,
): PermissionSet {
  return {
    data: overrides?.data ?? template.permissions.data,
    function: overrides?.function ?? template.permissions.function,
    time: overrides?.time ?? template.permissions.time,
  };
}

// ═══ D239: GA 约束 ═══

export interface GAConstraints {
  isFrozen?: boolean;
  deptScope?: string[];
  sensitivityCeiling?: string;
  contractExpiry?: string;
  canDownload?: boolean;
  frozenAt?: string;
}

export interface RbacContext {
  role: WorkspaceRole;
  department?: string;
  userId: string;
  /**
   * D947: 该上下文是否来自已验签的认证注入（req.auth）。
   *
   * - `false` = 无凭据 / 自报凭据被拒 → 所有权限判定 fail-closed（直接拒绝）。
   * - `true` 或 `undefined` = 已认证（`undefined` 用于兼容既有直接构造 RbacContext 的
   *   内部调用点与夹具，其语义等价于已认证）。
   */
  authenticated?: boolean;
  /** D239: GA 约束（仅 ga role 有效） */
  gaConstraints?: GAConstraints;
}

/**
 * 从请求中提取 RBAC 上下文。
 *
 * D947（默认安全姿态）: 唯一可信来源是 `req.auth`（由 jwtAuthMiddleware 验签后注入）。
 * 本函数**不再读取** `x-synova-token` / `query.token` 等自报凭据——此类字符串
 * 不经验签即可自封 `role=admin`，属默认放行姿态，已删除。
 * 无凭据时返回 `authenticated: false` 的匿名上下文（fail-closed，绝不回退 admin）。
 */
export function extractRbacContext(req: {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  auth?: { sub: string; role: string; orgId: string; gaConstraints?: GAConstraints };
}): RbacContext {
  if (req.auth) {
    return {
      role: req.auth.role as WorkspaceRole,
      department: undefined,
      userId: req.auth.sub,
      authenticated: true,
      gaConstraints: req.auth.gaConstraints,
    };
  }
  // D947: 无认证上下文 → 明确拒绝并留痕（P5 三态之一「被拒绝」）。
  // 原实现（rbac.ts:110-119）自报 token 分支 + 兜底 { role: 'admin' } 已删除。
  log.warn(
    { code: 'RBAC_DENIED', reason: 'no_authenticated_context' },
    '安全判据: 被拒绝 — 无认证上下文（fail-closed，不回退自报凭据/不回退 admin）',
  );
  return { role: ANONYMOUS_ROLE, userId: ANONYMOUS_USER, authenticated: false };
}

// ═══ D239: GA 检查链 ═══

/**
 * 检查 GA 是否被冻结（最高优先级）。
 */
export function isGaFrozen(ctx: RbacContext): boolean {
  if (ctx.role !== 'ga') return false;
  return ctx.gaConstraints?.isFrozen === true;
}

/**
 * 检查 GA 合同是否过期。
 */
export function isGaContractExpired(ctx: RbacContext): boolean {
  if (ctx.role !== 'ga' || !ctx.gaConstraints?.contractExpiry) return false;
  return new Date(ctx.gaConstraints.contractExpiry) < new Date();
}

/**
 * 检查 GA 是否能访问指定部门的资源。
 */
export function canGaAccessDept(ctx: RbacContext, deptId: string): boolean {
  if (ctx.role !== 'ga') return true;
  const scope = ctx.gaConstraints?.deptScope;
  if (!scope || scope.length === 0) return true; // 无限制
  return scope.includes(deptId);
}

/**
 * 检查 GA 能否访问指定敏感度的数据。
 */
export function canGaAccessSensitivity(ctx: RbacContext, sensitivity: string): boolean {
  if (ctx.role !== 'ga') return true;
  const ceiling = ctx.gaConstraints?.sensitivityCeiling || 'S1';
  const levels = ['S0', 'S1', 'S2', 'S3', 'S4'];
  return levels.indexOf(sensitivity) <= levels.indexOf(ceiling);
}

/**
 * 检查 GA 是否可以下载原始数据。
 */
export function canDownloadRawData(ctx: RbacContext): boolean {
  if (ctx.role !== 'ga') return true;
  return ctx.gaConstraints?.canDownload === true;
}

/**
 * 记录 GA 敏感数据访问审计。
 */
export function auditGaAccess(
  ctx: RbacContext,
  store: { remember: (entry: Record<string, unknown>) => { id: string } },
  action: string,
  target: string,
): void {
  if (ctx.role !== 'ga') return;
  try {
    store.remember({
      orgId: 'synova',
      key: `ga_audit:${ctx.userId}:${Date.now()}`,
      value: JSON.stringify({
        userId: ctx.userId,
        action,
        target,
        timestamp: new Date().toISOString(),
      }),
      type: 'ga_audit',
      confidence: 1.0,
      source: `ga:${ctx.userId}`,
      tags: ['ga_audit', action],
      expiresAt: null,
    });
    log.info({ userId: ctx.userId, action, target }, 'GA 审计已记录');
  } catch (err) {
    log.warn({ err }, 'GA 审计写入失败 — 降级');
  }
}

/**
 * D947/L-32: 部门命中判据——**唯一事实源**，canAccessWorkspace 与 canModifyWorkspace 共用。
 *
 * 契约（铁律 47）:
 *   输入 — ctxDept（上下文部门声明）/ wsDept（工作区部门声明），二者均可能为 undefined
 *   输出 — true **仅当**双方均为**非空字符串**且相等
 *   降级 — 不适用（纯判据，无 IO）；任何缺失（undefined）/ 空串输入一律 false（fail-closed）
 *
 * 为什么必须收窄: 天真的 `wsDept === ctxDept` 在**双 undefined** 命中 `undefined === undefined`，
 * 在**双空串**命中 `'' === ''` ⇒ 无部门工作区被任意已认证非 admin 命中（fail-open 授权）。
 */
function isSameDepartment(ctxDept: string | undefined, wsDept: string | undefined): boolean {
  return (
    typeof ctxDept === 'string' && ctxDept.length > 0 &&
    typeof wsDept === 'string' && wsDept.length > 0 &&
    wsDept === ctxDept
  );
}

/** 检查用户是否可访问指定工作区 */
export function canAccessWorkspace(ctx: RbacContext, ws: {
  visibility?: 'global' | 'department' | 'private';
  department?: string;
  owner?: string;
  sensitivity?: string;
}): boolean {
  // D947: 未认证上下文一律拒绝（fail-closed，先于任何角色分支——含 admin）
  if (ctx.authenticated === false) {
    log.warn(
      { code: 'RBAC_DENIED', userId: ctx.userId, reason: 'unauthenticated_context' },
      '安全判据: 被拒绝 — 未认证上下文不得访问工作区',
    );
    return false;
  }

  // D239: GA 冻结检查（最高优先级）
  if (isGaFrozen(ctx)) {
    log.warn({ userId: ctx.userId }, 'GA 账户已冻结 — 拒绝访问');
    return false;
  }

  // D239: GA 合同过期检查
  if (isGaContractExpired(ctx)) {
    log.warn({ userId: ctx.userId, contractExpiry: ctx.gaConstraints?.contractExpiry }, 'GA 合同已过期 — 拒绝访问');
    return false;
  }

  // D239: GA 部门范围检查
  if (ws.department && !canGaAccessDept(ctx, ws.department)) {
    log.warn({ userId: ctx.userId, department: ws.department }, 'GA 无权访问该部门');
    return false;
  }

  // D239: GA 敏感度检查
  if (ws.sensitivity && !canGaAccessSensitivity(ctx, ws.sensitivity)) {
    log.warn({ userId: ctx.userId, sensitivity: ws.sensitivity }, 'GA 无权访问该敏感度级别');
    return false;
  }

  // 管理员/对接人/GA顾问 — 全部可见（通过约束检查后）
  if (ctx.role === 'admin' || ctx.role === 'liaison' || ctx.role === 'ga') return true;
  const role = ctx.role as string;
  if (ws.visibility === 'global') return role === 'admin';
  if (ws.visibility === 'private') return ws.owner === ctx.userId || role === 'admin';
  if (ws.visibility === 'department') {
    // D947/L-32: 与 canModifyWorkspace 同源收窄——双 undefined / 单侧 undefined / 空串均不得命中；
    // admin 旁路保持原样。
    return isSameDepartment(ctx.department, ws.department) || role === 'admin';
  }
  return false;
}

/** 检查用户是否可修改工作区 */
export function canModifyWorkspace(ctx: RbacContext, ws: {
  visibility?: string;
  department?: string;
  owner?: string;
}): boolean {
  // D947: 未认证上下文一律拒绝（fail-closed，先于 role==='admin' 分支）
  if (ctx.authenticated === false) {
    log.warn(
      { code: 'RBAC_DENIED', userId: ctx.userId, reason: 'unauthenticated_context' },
      '安全判据: 被拒绝 — 未认证上下文不得修改工作区',
    );
    return false;
  }

  const role = ctx.role as string;
  if (role === 'admin') return true;
  if (role === 'manager') {
    // D947/L-29 + L-32: 部门分支要求**双方均为非空字符串且相等**才可能命中——
    // 双 undefined / 单侧 undefined / 双 '' / 单侧 '' 一律不命中（fail-closed）。
    // owner 路径并行保留（不受收窄影响）。
    return isSameDepartment(ctx.department, ws.department) || ws.owner === ctx.userId;
  }
  if (role === 'ga') return false;
  return false;
}

/** Express 中间件: 注入 rbac 上下文到 req */
export function rbacMiddleware(req: Request, _res: Response, next: NextFunction): void {
  (req as Request & { rbac: RbacContext }).rbac = extractRbacContext(req);
  next();
}
