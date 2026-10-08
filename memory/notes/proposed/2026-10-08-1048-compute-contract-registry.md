# 决策 Note — compute 契约注册表最小件（#1048 / 卡 K5 · W4）

- 状态: proposed（待 CTO 收件闸 + K3 终审后 `git mv` 到 implemented/）
- 日期: 2026-10-08
- 责任方: synova-squad-lead（队长）｜执行位: sra-smoke
- 触发: CTO 2026-10-08 v3 派单「资产积累的第一口饭」派单 C（#1048）；本 Note 亦为**门禁要求**产出（D395-a：暂存含 `scripts/control-tower/**` ⇒ commit 必须引用真实 Note，条件见 `scripts/commit-msg-check.sh:140`）。

## 决策

1. **注册表形态 = 契约 ID → {实现文件, 导出符号, fixture} 的解析器，fail-closed。**
   - 缺失即抛 `ComputeContractError`（带 `.code/.phase/.retryable`，铁律 32）；
   - **不提供** `degraded: true` 的静默通过路径（铁律 24/31）；
   - 与既有 D215 `contract-store.ts`（符号契约存档）**刻意并存不合并**——两者管的契约家族不同：D215 管「符号存在性契约」，本件管「compute 实现可 resolve + 可调用」。
2. **`compute` 面不参与 `ValidationReport.pass` 判定。** 只新增 `computeContracts` 上报字段（`blocking: false` 恒定）。理由：本卡是**接线 + 可观测**，不是新门禁；若让它参与 pass，就把「诊断运行时契约门禁」的失败面**扩大**成行为变更，属另一张卡的范围（也触碰「不改『哪条检查阻断合并』」的红线边界）。
3. **判据取强形态三段断言**（PRESENCE / RESOLVE / CALL），**不用**登记件 `:1071` 自陈的弱形态（`expectStdoutContains` 只验 stdout 子串，可被无关输出满足）。
4. **首期只覆盖 3 条契约**：`COMPUTE-HHI-v1`（卡面指名）/ `COMPUTE-DOL-v1` / `COMPUTE-NPV-v1`——后两条由 `extensions/sentinels/capital-health/manifest.json:68/:73` 声明。全量口径（U-4：129/202/116）**已由 CTO 裁定非阻塞**，另立卡。

## 依据（参考系，K3 可核）

- **第一性原理**：注册表的价值 = **让"登记了但没接线"变成机器可见**。本卡实测出 `computeHHI/DOL/NPV` 的**生产调用点 = 0**（各 5 处命中 = 1 定义 + 4 测试）——即契约登记与真实调用之间**本来就有断口**，这正是 W4 的存在理由。
- **Anthropic 工程基线**：可扩展物**自带生效判据**；宿主只保证「注册表在 + 不生效就报错」。对齐 `@deepseek-ai/dsh-invariants`（package-owned runtime invariants）范式，**仅借范式、不引代码**（G1 守卫：`grep -rn "@deepseek-ai" src/ packages/` 零命中）。
- **开源实证 / 本仓判例**：登记件 `:1071` 已自陈弱形态判据的历史问题 ⇒ 本卡以反例（改坏即红 / 漏改即红）替代静态断言，符合「禁 grep 型静态判据当验收」的既有纪律。
- **收敛检查**：不动 `src/sentinel/**`、`src/store/**`（卡面绝不能碰）；不碰 `scripts/audit/**`；不改 pass 判定；`failures.length === 0 && !degraded` 逐字未改。

## 实测口径与证据锚（本 Note 所据）

```
口径① 全局注册表声明数  scripts/workflow/system-registry.json  "COMPUTE- 声明 = 41
口径② compute 实现文件数  extensions/sentinels/shared/computes/**/*.ts = 89（不含 index.ts = 88）
口径③ sentinel manifest 契约声明 = 7 条 / 6 文件
口径④ ★ 3 条契约生产调用点 = 0
        computeHHI : 全部 5 | 排除定义行后 4 | 生产(非 tests) 0
        computeDOL : 全部 5 | 排除定义行后 4 | 生产(非 tests) 0
        computeNPV : 全部 5 | 排除定义行后 4 | 生产(非 tests) 0
        （命中 tests/sentinels/shared/d59-me-enhance.test.ts:99/:106、d62-me-sentinels.test.ts:57/:62）
探针基线 SUMMARY: PASS — presence 1/1 | resolve 3/3 | call 3/3  EXIT=0
反例 CE1 删 ID           ⇒ [FAIL] phase=resolve 必需契约未注册            EXIT=1
反例 CE2 指向不存在实现   ⇒ [FAIL] phase=file code=COMPUTE_CONTRACT_FILE_FAILED EXIT=1
既有 D215 测试 tests/contract/contract-gate.test.ts 4 tests 仍全绿（pass 判定未变证据）
```

## 待裁项（上报 CTO）

- **U-4 全量计数口径**（129/202/116）：本卡只落 3 条契约；全量口径待注册表建成后用注册表本身数，另立卡。
- **「生产调用点 = 0」的处置**：本卡只**披露**不修。是否要为 3 条契约补真实调用（或退役其登记），属新工作，需 CTO 立卡。
- **`施工项登记.ts:1071` 弱形态判据**：该条自陈「`expectStdoutContains` 可被无关输出满足」⇒ 登记侧判据是否统一升级为强形态，属登记件（CTO 域）改动，本卡不动。

## 失效条件

本 Note 决策 2（`compute` 面不参与 pass）在 CTO 决定把 compute 契约纳入**合并阻断**时失效并需重裁；决策 4（只覆盖 3 条）在 CTO 下令铺开全量口径时失效。
