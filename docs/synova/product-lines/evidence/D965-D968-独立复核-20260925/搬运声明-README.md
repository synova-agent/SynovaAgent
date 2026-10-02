# 搬运声明 — D965–D968 独立复核 evidence（task-4 阶段一）

## 归属

| 项 | 值 |
|---|---|
| **内容作者** | `sentinel-verifier`（独立复核员，非编码；只读仓库，产物落 `/tmp/verify-d965/**`） |
| **搬运人** | `synova-squad-lead`（队长）——**原样搬运，未改一字**（CTO 2026-09-25 批准） |
| **共享任务** | `task-4`（哨兵批独立复核） |
| **批次** | D965–D968（哨兵体系整改，Mac 段） |
| **基线** | `origin/main` = `25e081ce3f55aa383e2f8c4c0f75a236a74e82a8` |

## 效力声明（防误读）

- 本件只出 **`自验结论`**，**不含"审计通过"**。通过性判定归 **CTO 收件闸 + K3 终审**。
- 本件是**独立复核**产物（复核员未参与任何编码），**不是自我审计**。
- 判据纪律：**不使用 grep 型静态判据当验收**；全部结论由**运行时断言**给出，并带**红/绿对照**（canary 夹具 / 改坏即红）。

## 原样性证据（sha256 前 16 位，搬运前后对照）

搬运路径：`/tmp/verify-d965/**` → 本目录。**15/15 文件 + 2 棵夹具树 `IDENTICAL`**。

```
FILE                                SRC                DST                VERDICT
D965-D968-独立复核-evidence.md      c1d8cde27bb51fa7   c1d8cde27bb51fa7   IDENTICAL
probe-sentinels.mts                 7a1f5364251dc8ad   7a1f5364251dc8ad   IDENTICAL
probe-loader-path.mts               4e71117cbfb10507   4e71117cbfb10507   IDENTICAL
claims-check.mts                    9812428efe9584c5   9812428efe9584c5   IDENTICAL
p7-check.mts                        b96f7972b611b1ab   b96f7972b611b1ab   IDENTICAL
probe-A.json                        c3e9d51b3b9b476c   c3e9d51b3b9b476c   IDENTICAL
probe-A2.json                       d542d53e38477c64   d542d53e38477c64   IDENTICAL
probe-B.json                        f3cff49e69ce2ab3   f3cff49e69ce2ab3   IDENTICAL
probe-C.json                        770aa48c1f6a4fdf   770aa48c1f6a4fdf   IDENTICAL
probe-D.json                        1a1748bef0024023   1a1748bef0024023   IDENTICAL
probe-E.json                        c5ca9633bff0c782   c5ca9633bff0c782   IDENTICAL
probe-DRY.json                      369ded86a8643bf5   369ded86a8643bf5   IDENTICAL
probe-loader-path.json              4e555aedcdc86838   4e555aedcdc86838   IDENTICAL
probe-CANARY-GREEN.json             b0d25d8473fe5849   b0d25d8473fe5849   IDENTICAL
probe-CANARY-RED.json               baf60be820c132d4   baf60be820c132d4   IDENTICAL
fixture-green/                      —                  —                  IDENTICAL（diff -r 空）
fixture-red/                        —                  —                  IDENTICAL（diff -r 空）
```

## 目录结构

```
D965-D968-独立复核-evidence.md   主证据（409 行：45 哨兵逐条全表 + 全部原始输出 + canary 红绿 + 6 口径对照）
probes/                          复核员自研探针（未复用队长/CTO 任何脚本）
  probe-sentinels.mts            插桩 store + loader 口径解包两列
  probe-loader-path.mts          loader 原生 registerLoadedSentinels + registry.check
  claims-check.mts               4 条结论 + 场景对照
  p7-check.mts                   graph_triples props 列因果性
results/                         机器读结果（probe-A/A2/B/C/D/E + loader-path + CANARY-GREEN/RED + DRY）
fixtures/                        canary 夹具（green/red 双态）
```

## 未随之搬运之物（诚实登记）

- `/tmp/verify-d965/db-*.db` 等 6 份 SQLite 副本（各 ≈2.4MB）：体积原因未入库；复现方式见主证据 §0（`sqlite3 .backup` 快照 + 补列脚本）。
- 探针依赖 `node_modules` 软链（指向仓库根 `node_modules`）：随仓库天然满足。
- 本件**不含**对 `data/synova.db` 的任何写入；复核员已登记 `data/synova.db` 内容文件 sha256 与 mtime 未变。

## 未清项（复核员登记，队长照录）

1. 未跑全量 `vitest` / `tsc --noEmit`（阶段一无代码改动；逐卡验收时再按需申请）。
2. 生产 `memStore` 阈值覆写路径未复现（探针用 stub `memoryStore`，避免写生产库）。
3. **生产库图数据为空的"原因"未查**（设计如此 or 写路径长期失败所致）——CTO 已裁定：并入 D966 报告 + 登记为后续卡。
4. 证据与脚本入库由队长搬运；复核员按纪律不写仓库。
