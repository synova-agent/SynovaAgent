/**
 * 企业扫描可见性判据 + 验签身份收窄（#1408 角色真源统一为 `WorkspaceRole`）。
 *
 * @input  `canViewSource`：已收窄的 viewer（`toScanViewer` 产物）与 store 读出的来源授权；
 *         `toScanViewer`：`req.auth` 这类**外部**载荷（字段可能缺失/非枚举）。
 * @output `canViewSource`：是否可见（纯判据，不抛）；`toScanViewer`：合法 `ScanViewer`。
 * @degraded 无；非法身份一律 `SCOPE_DENIED`（fail-closed），不做角色映射兜底。
 * @authority 创始人裁定 Gitea #1408 评论 12607；DEV DOC v7 §3.1/§3.2/§5.1/§5.3。
 * @not-here 不读库、不读文件、不写日志（非法角色过滤的 warn 在 store 读路径）。
 */
import { fingerprint } from './canonical';
import { EnterpriseScanError } from './errors';
import { WORKSPACE_ROLES } from './types';
import type { ScanAuthorization, ScanRole, ScanViewer } from './types';

/** 运行时角色收窄：唯一真源 = `WORKSPACE_ROLES`（非法/缺失 ⇒ false，调用方 fail-closed）。 */
export function isWorkspaceRole(value: unknown): value is ScanRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

/**
 * `toScanViewer` 的输入形状 —— 只取扫描需要的字段，避免本模块反向依赖 `middleware/auth.ts`
 * （`D-w2` 明确本票不改 `auth.ts`）。
 */
export interface ScanViewerIdentity {
  sub?: string;
  role?: string;
  orgId?: string;
  departmentIds?: readonly string[];
}

/**
 * 把验签身份收窄成 `ScanViewer`，**唯一**允许失败的三个原因（v7 §5.1 穷举）：
 * 1. 缺 `sub`/`orgId` ⇒ `SCOPE_DENIED`，message 含「缺少验签企业身份」；
 * 2. `role` 缺失或非枚举 ⇒ `SCOPE_DENIED`，message 含「未知角色」；
 * 3. `role === 'ga'` ⇒ `SCOPE_DENIED`，message 固定含「GA 本切片未接入来源级授权约束」。
 *
 * @error `EnterpriseScanError`（`SCOPE_DENIED` / phase `request` / 403）。
 */
export function toScanViewer(identity: ScanViewerIdentity | undefined): ScanViewer {
  if (!identity?.sub || !identity.orgId) {
    throw new EnterpriseScanError('SCOPE_DENIED', 'request', '缺少验签企业身份（sub/orgId），扫描来源一律不可见');
  }
  const rawRole = identity.role;
  if (!isWorkspaceRole(rawRole)) {
    throw new EnterpriseScanError('SCOPE_DENIED', 'request', `未知角色 ${String(rawRole)}：扫描可见性只接受 WorkspaceRole 枚举`);
  }
  if (rawRole === 'ga') {
    throw new EnterpriseScanError(
      'SCOPE_DENIED',
      'request',
      'GA 本切片未接入来源级授权约束：一律拒绝扫描来源访问（NOT DONE，另立票接入冻结/合同/部门/敏感度）',
    );
  }
  return { sub: identity.sub, role: rawRole, orgId: identity.orgId, departmentIds: identity.departmentIds };
}

/**
 * 单条来源可见性（v7 §3.1/§3.2）。
 *
 * 契约：
 * - 跨企业（`viewer.orgId !== source.graph`）一律不可见；
 * - `admin`：同企业全域可见，**不受**任何来源级字段约束；
 * - `enterprise`：`admin/manager/liaison/staff` 可见（`ga`/未知见下）；
 * - `restricted`：
 *   - `liaison` 只认**个人级**显式授权（`allowedUsers`）；
 *   - `manager/staff`：`allowedUsers` 命中 ⇒ **个人短路**（不要求部门、不被角色闸否决）；
 *     否则部门交集非空才进入角色闸：`allowedRolesDeclared` 且清单不含本角色 ⇒ 不可见；
 * - `ga` / 未知角色：`false`（纵深防御 —— 真实入口已在 `toScanViewer` 拒绝）。
 *
 * @degraded 无降级：任何不确定输入都走 false（fail-closed）。
 */
export function canViewSource(viewer: ScanViewer, source: ScanAuthorization): boolean {
  if (!viewer.sub || !viewer.orgId || viewer.orgId !== source.graph) return false;
  // 纵深防御：类型已收窄，但运行时仍可能被直接构造进来（未知/缺失角色 = deny-all）。
  if (!isWorkspaceRole(viewer.role)) return false;
  if (viewer.role === 'ga') return false; // §5.3 纵深防御；真实链在 toScanViewer 已抛 403
  if (viewer.role === 'admin') return true; // 同企业全域，不受来源级字段约束
  if (source.visibility === 'enterprise') return true;
  if (source.visibility !== 'restricted') return false;
  if (viewer.role === 'liaison') return source.allowedUsers.includes(viewer.sub);
  // manager / staff（§3.2 restrictedVisible）
  if (source.allowedUsers.includes(viewer.sub)) return true; // 个人短路在前
  const departments = viewer.departmentIds ?? [];
  const departmentHit = departments.some(department => source.allowedDepartments.includes(department));
  if (!departmentHit) return false;
  if (source.allowedRolesDeclared && !source.allowedRoles.includes(viewer.role)) return false;
  return true;
}

export function visibilityFingerprint(sources: Array<{ authorization: ScanAuthorization; sha256: string }>): string {
  return fingerprint(sources.map(source => ({
    sourceId: source.authorization.sourceId,
    sha256: source.sha256,
    revision: source.authorization.revision,
  })).sort((a, b) => a.sourceId.localeCompare(b.sourceId)));
}
