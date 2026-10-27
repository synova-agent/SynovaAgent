/**
 * @synova/engine-auth — Synova 权限管理
 *
 * 横切关注点，不归属 L1-L5 任何单层。
 *
 * 用法:
 *   import { createRBACProvider, type AuthProvider, type UserContext } from '@synova/engine-auth';
 *
 *   const auth = createRBACProvider({ resolveUser: async (token) => ({...}) });
 *   const ctx = await auth.getUserContext('token-xxx');
 *   const filter = await auth.getPermissionFilter(ctx, 'KnowledgeChunk', 'read');
 */

// Types
export type {
  UserIdentity,
  UserAuth,
  UserContext,
  FilterClause,
  FilterCondition,
  ResourceRef,
  AccessTags,
  AuditEntry,
  PermissionAction,
  IdentitySource,
  AuthRole,
  UserSensitivity,
  AccessLevel,
  DataSensitivity,
  AuthorityLevel,
  AuditEventType,
  PermissionMeta,
} from './types';

// AuthProvider interface
export type { AuthProvider } from './auth-provider';

// RBAC implementation
export { createRBACProvider, type RBACConfig } from './rbac';

// K12-11 (#194 / RB-03): 权限**项**模型（PermissionId[] ＋ 角色为可配包）——
//   五档仅出厂默认（L0），客户可配包（L2）；**覆盖不是替换**（宪章 5.2）。
// #731 / T2: `getKnowledgeScopes()` 是本包新增的**文件派生**知识命名空间源
//   （`KNOWLEDGE_SCOPES` 降为兼容基线）；`isPermissionId` 的白名单因此能吃到
//   "新增 roles/<id>/knowledge-scope.yaml 里的命名空间"（文件驱动，不改代码）。
export type {
  PermissionId,
  PermissionItem,
  ResolvedGrants,
  KnowledgeScope,
} from './permission-grants';
export {
  PERMISSION_CATALOG,
  PERMISSION_BUCKETS,
  KNOWLEDGE_SCOPES,
  FACTORY_ROLE_GRANTS,
  FACTORY_TIER_BY_LEGACY_ROLE,
  getKnowledgeScopes,
  isPermissionId,
  expandPermissionId,
  sensitivityWhitelistFromGrants,
  itemModelSpeaksForRole,
  resolveGrants,
  permissionsForRole,
  factoryPermissionsForRole,
  hasPermission,
} from './permission-grants';

// User cache
export { createUserCache, type UserCache } from './cache';
