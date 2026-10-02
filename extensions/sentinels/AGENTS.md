# extensions/sentinels/ · 施工守则

> 文件驱动哨兵库：45 个活跃哨兵目录（+`shared/` 工具库 + `_extinct/` 归档 12 个）。加目录即注册，不改 `src/` 一行。

## 一、这块是什么

每个 `<哨兵名>/` = `manifest.json` + `aggregate.ts`（导出 `check(store, teamId, traversal?, thresholds?)` → `SentinelFinding[]`）+ `computes/*.ts`（纯算，不碰库）。
哨兵 = 可独立告警的最小子领域；`manifest.expert` 定归属专家，`schedule` 定 cron。
`src/sentinel/sentinel-loader.ts` 扫目录（跳过 `shared` 与 `_` 前缀）→ 注册进 registry → runner 按 cron 跑。

## 二、谁可以改

- **归属线：产品线**（`docs/synova/CTO-ROLE.md:91`）。
- 🔴 **机器裁决不一致**：`check-ownership.py extensions/sentinels/cash-runway/aggregate.ts --owner mac` → `❌ 越域 … 实际 owner=win`（实测 exit 1）；`--owner win` → ✅ exit 0。声明归属前先跑它，冲突交**治理线**。
- **必须同时改**：
  1. `src/sentinel/types.ts` 类型网区（`:200-298`）补 `import type` 登记；漏了 → `check-sentinel-type-net.sh` 点名 exit 1。
  2. 配对测试：`<名>/aggregate.ts` → `tests/sentinels/<名>.test.ts`；`<名>/computes/<f>.ts` → `tests/sentinels/<名>/<f>.test.ts`（`scripts/pre-commit-check.sh:566-567`，同 commit 缺即阻断）。
  3. `manifest.json` 必填 `$schema/name/version/type/entryPoint`（`scripts/check-file-driven.sh:63`）。
- **越界判定**：碰 `scripts/control-tower/**`、`src/init/**`、`.github/**` 即越界；`scripts/audit/**` = K3 红线，永不可碰。**越界找**：门禁/CI → 治理线；跨线裁决 → CTO。

## 三、改完怎么算完成

- **生产入口**（不是 grep 命中）：注册 `registerLoadedSentinels()` ← `src/init/file-driven-loaders.ts:73`、`src/deploy/bootstrap.ts:387`；执行 `src/agent/synova-agent.ts:92` 起 Runner → cron → `executeSentinel()` `src/sentinel/runner.ts:1405` 调 `check(ctx)`（`ctx.db`=SqliteGraphStore）；结果 `GET /api/sentinel/tickets`（`src/routes/sentinel.ts:94`）。
- **本域独有红线**：
  1. 归档只能改 `_` 前缀名（如 `_extinct/`）；不改名 → D752 门禁点名。
  2. `manifest.computes[]` 须与 `computes/` 落盘逐个对上 —— 实测 **12/45 不一致**（`competitive-moat` 8→0、`competitive-position` 3→0、`key-person-risk` 1→0）。**无自动门禁**，靠本件。
  3. 不许硬编码输入冒充哨兵：`sentinel-forecast-accuracy/aggregate.ts:22`、`sentinel-pricing-strategy/aggregate.ts:25` 真值写死，`check(context)` 非 loader 契约，不读 store。
  4. `path-dependency` 是唯一非 `./aggregate.ts` 的 `entryPoint`（`./computes/detect.ts`）；`computeKind:"graph"`/`layer:"capability"` 越出 `src/sentinel/sentinel-loader.ts:36,38` 值域。
  5. 🔴 别引用「20/45 哨兵不查 store」：`docs/synova/coordination/已作废口径表.md:19` 标**口径待核**（引用即 K3 判 FAIL）；三种口径（真调用点／字面／落盘 computes）实测 4/7/42，复现不出。
- **「改坏即红」最小用例**：
  ```bash
  bash scripts/control-tower/check-sentinel-type-net.sh   # 绿=45/45；删 types.ts 任一登记 → ❌ exit 1 点名
  ./node_modules/.bin/vitest run tests/sentinel/d751-new-sentinel-e2e.test.ts  # 5 passed：真管线三环
  ```

## 四、不在这里的事

- `src/sentinel/*.ts`（loader / registry / runner / self-check）不在本库，改它去 `src/sentinel/`。
- 专家定义归 `expert/`；`shared/` 不被 loader 扫描，其 `computes/**` 现零生产引用（71 测试引用 / 0 `src/` 引用）。
- 新哨兵目录缺 `manifest.json`：组 8 拦不住（`check-file-driven.sh:102` 只看顶级），loader 记 degraded，需自查。

## 五、不确定时找谁

| 问题类型 | 找谁 |
|---|---|
| 归属 / 派单 / 跨线裁决 | CTO |
| 门禁、CI、控制塔脚本 | 治理线 |
| 加载器与 runner 行为（`src/sentinel/**`） | 产品线 |
| 审计结论 | K3（只认 K3 报告） |
