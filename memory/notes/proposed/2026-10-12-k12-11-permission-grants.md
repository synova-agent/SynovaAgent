# K12-11（#194 / RB-03）权限项模型 PermissionId[] ＋ 角色为可配包 —— 决策 Note

- **状态**: proposed（待 K3 终审 / 独立复核）
- **日期**: 2026-10-12
- **决策**:
  1. 权限模型＝**项**（`PermissionId` 联合字面量 + 白名单目录），**不是档位**；五档
     （admin/manager/employee/viewer/external）**保留为出厂默认（L0）**，**不作为类型的一部分**。
  2. 分层合成＝**覆盖不是替换**（宪章 5.2）：`生效 = (出厂 ∪ 包 grants) − 包 denies`；
     包只做「加项 / 显式减项」，**不整包重写**（否则客户包落后于出厂版本时会静默丢新默认项 ⇒ fail-open 方向）。
  3. 授权判定点（`src/middleware/auth.ts` 的 `getPermissionFilter`）的白名单**由项模型派生**，
     与既有档位默认取**交集** ⇒ 项模型**只能收窄、永不放宽**（防"配一个文件就自动提权"）。
  4. 客户槽＝`payload.orgId`；载体＝`extensions/presets/roles/<roleId>/{tenant/<tenantId>/}capabilities.yaml`
     的 `permissionGrants` 段 ⇒ **加文件即生效，不改代码**（不做进程级缓存）。
  5. 回落 ≠ 降级：包不存在/无该段 ⇒ `fallback=true` 且 **`degraded=false`**（正常路径，删角色不报错）；
     解析失败/字段非法/未知项 ⇒ `degraded=true` + 逐条 reason（铁律 11/24/31），且**从不抛**。
  6. `packages/engine-auth/src/rbac.ts` 两处**类型级**收窄（零行为变更）纳入本卡：见下方「附带发现」。

- **理由**:
  · 创始人 2026-10-05：「权限不是 5 档，是一堆权限选择的模式」；档位制太粗 ⇒ 客户只好"给高一级"
    ⇒ **权限只会越来越松**。项模型答的是「财务能看全公司数据」这类档位表达不了的诉求。
  · DSH 没有权限模型 ⇒ 本设计**自研**；仅两处借鉴：`static inject=[...]`（按名声明能力）
    与 profile 分层（出厂默认 vs 客户配置）。**不得声称照 DSH 抄。**
  · 判据必须「改坏即红」：把判定点退回纯档位 ⇒ 客户包的 denies 不再生效 ⇒ 判别性用例必红（已实测）。

- **附带发现（系统性，已上报 CTO/lead）**:
  `tsconfig.json` 的 `include: ["src/**/*.ts","src/**/*.tsx"]` **不含 `packages/**`**，
  且锚上 `src/**` 无任何文件 import `@synova/engine-auth` ⇒ **`packages/engine-auth/src/` 长期不在 `tsc` 程序内**
  （该包类型错从不被检查）。本卡把项模型接进 `src/middleware/auth.ts` 后该包**首次进入 tsc**
  ⇒ 暴露两处既有类型错（`rbac.ts:142,165`）。若不在本卡一并做类型级收窄，`tsc` 计数会**永久漂离锚 29**
  ⇒ 全批"相对基线零新增"口径失效。故按 B 档扩张写集（+1 文件）并在此登记。
  另：`npx tsc --noEmit` 仍报 `extensions/sentinels/_extinct/**` 25 条 ⇒ 存在**另一个** tsconfig 包住 `extensions/`（非本卡写集）。

- **判据（可复跑）**:
  ```
  npx tsx scripts/control-tower/probe-permission-grants.ts --case custom-role   # exit 0
  npx vitest run tests/security                                                 # RC=0（18 文件 / 269 passed）
  npx tsc --noEmit                                                              # error TS 计数 == 29（RC 不作判据；CI 不跑 tsc）
  ```
  反例（改坏即红）：`src/middleware/auth.ts:754` 的 `allowedSensitivitiesByGrants(...)` 退回
  `allowedSensitivities(...)` ⇒ `tests/security/permission-grants.test.ts` 3 条判别性用例红（实测），
  还原后 sha256 逐字相同。

- **代价（如实列）**:
  · 卡面 Done 的 `npx tsc --noEmit`（expectExit 0）**逐字不可达**（锚上 RC=2、29 错、CI 不跑 tsc）
    ⇒ 按 B 档替换为「计数 == 29 ∧ `^src/` 行集与锚逐字相同」，判据变更已由 lead 上报 CTO。
  · 写集扩张 1 文件（`packages/engine-auth/src/rbac.ts` 类型级收窄）＋ 本 Note。
  · 项模型目前只在**一个**生产调用点生效（授权判定点）；"按项判定知识块"尚未接入 L4 过滤条件
    （见交付回执 R4 承接项）。
