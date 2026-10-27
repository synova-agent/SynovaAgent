# #1061 / 裁 425-C1：建档确认门**前移**（未确认 ⇒ 磁盘零写入是事实）

- **状态**: proposed（待 L1 收件闸 ＋ K3 审计追认为 implemented）
- **日期**: 2026-10-27
- **批次**: P3-M7-裁425返工批（#825）· 活2／3 · 分支 `ct/p3m7-c1-gate`（base `gitea/local-main` = `1ca0d4dfc`）
- **依据**: CTO 裁定 425-C1 ｜ 卡 `task-2` 正文（写集＝1 件、判据①–④、停点）｜ 同批 Note `2026-10-27-731-knowledge-scope-rollback-switch.md`（不同线，仅同批）
- **生效时点**: 合入 `local-main` 后生效（本卡只改 `src/routes/onboarding.ts`）

## 一、缺陷（锚上实测，不是转述）

`POST /api/onboarding/apply` 的旧实现顺序是「先跑流程、再判确认」：

```
routes/onboarding.ts:105  runOnboardingFlow(input)          ← input.dryRun = false（apply 恒非 dry-run）
  → onboarding-flow.ts:130  generateConfigPack({..., dryRun:false})   ← 🔴 **真落盘点**（写 extensions/presets/roles/<id>/ 实物 3 件）
  → onboarding-flow.ts:151  confirmed = input.superAdminConfirmed === true
  → onboarding-flow.ts:170  deploy 步（**只写状态行**，不写文件）
routes/onboarding.ts:106  if (!superAdminConfirmed) → :108 409
```

⇒ 未确认时**文件已经落盘**，409 是"事后声明"。第二条入口 `POST /api/onboarding/start`
（**pre-auth 白名单**，`dryRun` 由请求体控制）走同一 flow ⇒ 传 `dryRun:false` 同样落盘，且**连 409 都没有**。
旧注释「流程内部已 skip deploy ⇒ 未确认不落盘」是**失实**的：`deploy` 步只写状态行，
拦不住 ④ 已写出的文件。

锚上红态原始取证（真 router ＋ 真 `jwtAuthMiddleware` ＋ 真 `POST /api/auth/register` 签发凭据，临时 cwd）：

```
APPLY_NO_CONFIRM_STATUS=409 CODE=SUPER_ADMIN_CONFIRMATION_REQUIRED DEGRADED=(none)
START_DRYRUN_FALSE_NO_CONFIRM_STATUS=200 CODE=(none) DEGRADED=(none)
find <临时根> -type f  ⇒ 3 件（knowloedge-scope.yaml / capabilities.yaml / acceptance-criteria.yaml）
```

## 二、决定

| 面 | 决定 |
|---|---|
| 门控位置 | **前移到调用 `runOnboardingFlow` 之前**（`superAdminGateBlocks()`，**一处**判定，两条入口共用 —— 裁 425-C1「一处门控即可」） |
| 判定口径 | `dryRun !== true`（有落盘意图）∧ `superAdminConfirmed !== true` ⇒ 拒绝。`dryRun` 缺省即"要写"，与 flow 的判定口径**逐字一致** |
| 拒绝方式 | 把落盘意图**降级为 dry-run** 再跑流程 ⇒ flow ④ 只算 `planned`、不写盘（**磁盘零写入是事实**，不是承诺），响应仍带完整 `report`；随后回 **409** `SUPER_ADMIN_CONFIRMATION_REQUIRED` ＋ `degraded:true` |
| 留痕 | 拒绝路径 `log.warn`（`code:SUPER_ADMIN_CONFIRMATION_REQUIRED` ＋ `phase:onboarding:super-admin-confirmation-gate` ＋ `retryable:true` ＋ `degraded:true` ＋ `entry`）—— 禁静默 |
| 注释修正 | 只改 `src/routes/onboarding.ts` 内注释：把"只有确认过才部署 / 流程内部已 skip deploy"改成事实（真落盘点＝`generateConfigPack`）；`onboarding-flow.ts` 内两处同源失实注释**在写集外**⇒ 不改，已作为未决项报 L1/CTO（属 #1063） |

## 三、判据（磁盘事实；命令＋原始输出进 PR 正文）

- ① `POST /api/onboarding/apply` 不带 `superAdminConfirmed` ⇒ **409** ＋ 临时根**零文件** (`find -type f` = 0)
- ② 带 `superAdminConfirmed:true` ⇒ 落盘**实物 3 件**（`knowledge-scope.yaml` / `capabilities.yaml` / `acceptance-criteria.yaml`）＋ `.synova/onboarding-audit.log`（确认留痕）
- ③ `/api/onboarding/start`：`dryRun:true` 行为不变（200）；`dryRun:false` ∧ 未确认 ⇒ **409** ＋ 零文件
- ④ 主树 `data/` 零写入；本树 `git status` 不含产物（取证根一律 `mktemp -d`）
- 反例：把门控挪回 `runOnboardingFlow` **之后**（= 锚上实现）⇒ ①的"零文件"必红（原始输出见上「锚上红态」）

## 四、已知限制（禁写"暂无"）

- KL-A **生产可达性不属本卡**：`src/server.ts` 目前**未挂载** `routes/onboarding`（`grep -n onboarding src/server.ts` ⇒ 0 命中，挂载属 #712/PR5，未合）⇒ 本卡判据穿**真 router ＋ 真中间件**，
  **不得**据此宣称"生产入口可达"；未挂载 ⇒ 生产入口 404 属预期。
- KL-B 拒绝时仍**跑一遍 flow（dry-run）**以保住响应里的 `report` 形状；它纯计算、零写入，但**不是**"零成本"（大文档集会多一次解析）。
- KL-C 门控只管"落盘意图"；`/start` 是 **pre-auth**，本卡**不**给它加鉴权（那属 K1/权限面）——本卡只保证"未确认不落盘"。
- KL-D `superAdminConfirmed` 仍是**请求体声明**（沿用既有契约）；它的可信度取决于上游鉴权/确认流（另卡）。
