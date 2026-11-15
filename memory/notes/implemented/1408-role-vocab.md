# #1408 角色真源统一为 `WorkspaceRole`（扫描授权契约修正）
- **状态**: implemented（待 PR 独立复核 / 合并后转 archived；本 PR 停在 review）
- **任务**: Gitea #1408（权限票）｜方向真源：评论 12607｜固定 DEV DOC：评论 12664（`v7-2026-11-16`，SHA-256 `612da322…c68e0`）｜施工 Mandate：评论 12678｜T-2 #9 口径裁定：评论 12680
- **决策**:
  1. 扫描可见性**只消费**产品 `WorkspaceRole`（`admin|manager|liaison|staff|ga`）：`types.ts` 用
     `WORKSPACE_ROLES as const satisfies readonly WorkspaceRole[]` 单向绑定，废弃扫描自建
     `owner/operator/responsible` 词表；**不做**反向定义（避免 `rbac.ts` 运行时环）。
  2. 授权矩阵按 DEV DOC §3.1/§3.2：`admin` 同企业全域；`liaison` restricted 只认 `allowedUsers`；
     `manager/staff` **个人短路在前**、角色闸只作用部门路径，判定用 `allowedRolesDeclared`
     （= **成功解析的原始数组长度 > 0**，不是过滤后长度）；`ga`/未知 = deny-all。
  3. GA 本切片 **deny-all**：在 `toScanViewer` 抛固定 message（`GA 本切片未接入来源级授权约束`），
     `canViewSource` 对 `ga` 仍 false（纵深防御）；完整 GA 约束接入另立票（`NOT DONE`）。
  4. 运行时校验落在两个边界：`routes/enterprise-scan.ts` 的 `viewerOf` 改用 `toScanViewer`；
     `middleware/rbac.ts` 的 `extractRbacContext` 加枚举校验，非法角色记 `reason:'invalid_role'`
     （不复用 `no_authenticated_context`），经 `server.ts:511` 全局收紧 = **有意**客户可见变化（`D-v`）。
  5. store 读路径守卫变量改名 `rawRoles`（防「过滤后数组永不为 null ⇒ 守卫恒真」）；
     解析失败沿用现行「整份来源清单不可见」，**禁 `?? []`**。
- **理由**: 真实登录用户带产品角色访问扫描 API 时被旧词表判未知 ⇒ 全 deny-all（#1408 现象）；
  词表统一不得顺手放宽 GA，也不得用 `owner→admin` 映射旁路。
- **证据**（详见 PR 回执）:
  - `tests/routes/enterprise-scan.roles.integration.test.ts`：T-1 6×2 真身份链（`signJwtToken` +
    `createServer` + 真实 HTTP）、T-2 矩阵 21 行（manager 镜像展开 27 格）、T-3/T-4/T-6/T-7；
  - `tests/enterprise-scan/visibility.test.ts`：`isWorkspaceRole`/`toScanViewer` 契约、T-2 #12b
    ga 纵深防御、未知角色/跨企业补充断言；`tests/enterprise-scan/store-role-read.test.ts`：raw-vs-filtered
    与「解析失败整清单 fail-closed」+ 每请求每源一条 warn；
  - `tests/middleware/rbac-role-validation.test.ts`：T-9 合法角色网格与 `main` 基线逐格一致 +
    `invalid_role` 审计 reason；
  - T-10 11 处改坏必红（本地临时改动、还原后 `git diff` 为空）；T-11 四条回归命令。
- **回滚**: revert 本 PR 单个 commit 即回到「扫描侧旧词表」状态；无数据迁移（已核无生产写入方），
  无 Schema 变更（`allowedRolesDeclared` 为派生字段）。
- **边界**: 未改 `src/middleware/auth.ts`（`D-w2`）、未改共享 Schema、未接真实客户数据/模型外发/部署；
  GA 完整约束、`owner` 业务语义、全局 RBAC 重构、阶段 I 可见 UI 均不在本票。
