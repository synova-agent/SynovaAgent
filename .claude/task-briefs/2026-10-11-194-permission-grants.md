# Task Brief: #194 → K12-11（原 RB-03）— 权限项模型：PermissionId[] ＋ 角色为**可配包**

> 本件为**本卡实施 brief**（`.claude/task-briefs/` 内）。卡面（CTO 亲撰）见
> `.claude/task-briefs/2026-10-11-194-K12-11-权限项模型-PermissionId-角色为-可配包-五.md`。
> 判据源: 登记件 `RB-03` → `npx tsx scripts/control-tower/probe-permission-grants.ts --case custom-role`

## 〇、为什么要做这个（通俗版）

**① 一句话**：权限是「**一项一项勾**」（能看到什么 / 能做什么），**不是"五档套餐"**；五档只是**出厂默认**。

**② 解决什么问题**：创始人原话「**权限不是 5 档，是一堆权限选择的模式**」。档位制（admin/manager/
employee/viewer/external）太粗：「财务能看全公司数据」这种要求档位表达不了 ⇒ 客户只好"给高一级"
⇒ **权限只会越来越松**。

**③ 做完对项目的推动**：权限可精细配（像调组织架构一样）；角色＝**可配包**成为可能。

**④ 不做行不行**：不行。创始人 2026-10-05 已定方向；不做 ⇒ 客户组织形态一复杂就配不出来。

**⑤ 现在有什么基础**（开工实测）：
· ✅ 档位定义 `packages/engine-auth/src/types.ts:27`（`AuthRole`）＋ `src/middleware/rbac.ts:13`（`WorkspaceRole`）
· ✅ 档位比较 `packages/engine-auth/src/rbac.ts:32` `getMaxRole`
· 🔴 `PermissionId` 在本卡实现前 **src/packages/extensions/tests/scripts 全树 0 命中**
· 🔴 两套五档并行（`AuthRole` vs `WorkspaceRole`）—— 本卡建**显式映射表**消解（**不删**）

**⑥ 还需要做什么**：`PermissionId[]` 项模型 ＋ 角色＝可配包（引用项）＋ 两套五档映射表 ＋ 测试 ＋ 探针

**⑦ DSH 借鉴方式**：**参考自研**
· ✅ 借：**按名声明能力，宿主满足**（`packages/settings/settings/src/index.ts:224` `static inject=[...]`）
· ✅ 借：**出厂默认与客户配置分层、覆盖非替换**（宪章 5.2）
· ⚠️ **自研**：**DSH 没有权限模型** —— 项/授权/分层合成是我们自己的设计，不得假借

## Q0: 定位
院方《02》§三机制1① 角色预设包第①件＝知识范围「能看哪些库」⇒ 权限要能**按项**授予。
### b) 文件审计（实测）
`probe-permission-grants.ts` 开工时**不存在**（`test -f` rc=1）；项模型全树 0 命中；现状为 RBAC 五档（粗粒度）。
### c) 决策
五档**保留为出厂默认（L0）**；新增**按项**模型与客户可配包（L2）；**覆盖不是替换**（宪章 5.2）。

## Q1: 调研
- **院方《内容面规范》§四 约束 1**：权限矩阵（值）✅ 客户可改 ⇒ 角色应是**可配包**。
- **DSH 依据**：`packages/settings/settings/src/index.ts:224`（按名声明能力）＋ 宪章 5.2（分层覆盖非替换）。
- **memory 教训**：内容面规范 §1.1「能注册但没接线」⇒ 判据必须先证**接线**再证**生效**（本卡 V5/V6）。

## Q2: 范围
做什么：
- packages/engine-auth/src/permission-grants.ts
- packages/engine-auth/src/index.ts
- packages/engine-auth/src/rbac.ts
- src/middleware/auth.ts
- extensions/presets/roles/finance/capabilities.yaml
- extensions/presets/roles/hr/capabilities.yaml
- extensions/presets/roles/sales/capabilities.yaml
- tests/security/permission-grants.test.ts
- scripts/control-tower/probe-permission-grants.ts
- .claude/task-briefs/2026-10-11-194-permission-grants.md
不做什么：
- 不改 extensions/presets/roles/finance/knowledge-scope.yaml
- 不改 extensions/presets/roles/finance/context-manifest.yaml
- 不改 extensions/presets/roles/finance/manifest.json
- 不改 extensions/presets/roles/hr/knowledge-scope.yaml
- 不改 extensions/presets/roles/sales/knowledge-scope.yaml
- 不改 scripts/control-tower/probe-ladder.ts
- 不改 scripts/control-tower/probe-rbac-multitenant.ts
- 不改 scripts/control-tower/probe-department-axis.ts
- 不改 src/middleware/rbac.ts
- 不改 extensions/presets/roles/finance/acceptance-criteria.yaml

> 🔴 **共写声明**：`src/middleware/auth.ts` 与 K12-09 / K12-12 共写 ⇒ **串行**（K12-09 先，已合）。
> 本批只有本卡碰它 ⇒ 本批无冲突；**窄改**：只加项模型相关（import 一行 ＋ 判定点一行 ＋ 新增一个导出函数），
> **不动** `getPermissionFilter` 的既有敏感度语义（`allowedSensitivities` 逐字保留为 L0 出厂值）。

## Q3: 验收
入口：授权判定点（`src/middleware/auth.ts` 的 `getPermissionFilter`，生产请求路径真触发）
处理：按项判定（`PermissionId[]`）→ 无项模型发声则**回落五档出厂默认**
结果：FilterClause 的 `access.sensitivity` 白名单随项集**只收窄、永不放宽**
- V1 `probe-permission-grants.ts --case custom-role` ⇒ exit 0（探针三态自证见回执）
- V2 `npx vitest run tests/security` ⇒ exit 0
- V3 `npx tsc --noEmit` ⇒ **error TS 计数 == 29** 且 `^src/` 行集与锚逐字相同（RC 不作判据；锚上本就 RC=2）
- V4 反例（改坏必红）：判定点退回纯档位 ⇒ 判别性用例必红（原始输出 ＋ 还原后 sha256 相同）
- V5 接线实测：`PermissionId` 属新面 ⇒ 判定点**去注释行后**真调用 `allowedSensitivitiesByGrants(...)`
- V6 按项授予：授**单项** ⇒ 仅该能力生效（别库读项不自动获得）
- V7 五档＝出厂默认：无包角色/客户槽 ⇒ `fallback=true` 且 `degraded=false`，**不报错**
- V8 客户可配：角色包＝**加文件即生效**；差异化判据由夹具根驱动（不写死仓内内容）

## 架构层: −1 运行时（权限内核）＋ ⓪-b（角色包＝内容）
#CRITERIA: C

## 写集
| 文件 | 类别 |
|---|---|
| `packages/engine-auth/src/permission-grants.ts` | task（项模型本体） |
| `packages/engine-auth/src/index.ts` | task（导出面） |
| `packages/engine-auth/src/rbac.ts` | task（**仅类型级收窄**，见回执 R2） |
| `src/middleware/auth.ts` | task（判定点接线 · 共享文件） |
| `extensions/presets/roles/finance/capabilities.yaml` | task（内容面 `permissionGrants` 段） |
| `extensions/presets/roles/hr/capabilities.yaml` | task（内容面 `permissionGrants` 段） |
| `extensions/presets/roles/sales/capabilities.yaml` | task（内容面 `permissionGrants` 段） |
| `tests/security/permission-grants.test.ts` | task |
| `scripts/control-tower/probe-permission-grants.ts` | task（判据测量件） |
| `.claude/task-briefs/2026-10-11-194-permission-grants.md` | task（本件） |

## Done 标准
- [ ] verify: `npx tsx scripts/control-tower/probe-permission-grants.ts --case custom-role`（expectExit 0）
- [ ] verify: `npx vitest run tests/security`（回归面，expectExit 0）
- [ ] verify: `npx tsc --noEmit` ⇒ **error TS 计数 == 29**（RC 不作判据；锚上 RC=2，CI 不跑 tsc）
- [ ] 反例（改坏必红）：判定点退回纯档位 ⇒ 判别性用例必红 ＋ 原始输出 ＋ 还原核 sha256
- [ ] 卡上【读卡确认】+【交付】
