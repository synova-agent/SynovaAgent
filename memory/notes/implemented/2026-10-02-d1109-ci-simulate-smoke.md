---
状态: implemented
日期: 2026-10-02
决策: `simulate-ci.sh` 新增 `SYNO_SIM_SCOPE` 注入缝——默认 `full`（逐字节保持历史行为），`smoke` 时 ② 段只真跑 `SYNO_SIM_SMOKE_TESTS` 两条代表样本；清单仍从 `ci.yml` **单源提取**且**逐条**校验文件存在性，且缩量必须配「清单未被改小」的保值断言。
理由: ① 嵌套场景下 ② 的全量真跑是纯重复——`tests/control-tower/simulate-ci.test.sh` 自身就在 CT job 的密封清单里，它三次调用 `simulate-ci.sh`，每次再全跑 45 条 ⇒ 清单×清单。② CI 实测（run 36520361276）该单条独占 windows CT step 墙钟 3474s/3607s = **96%**，撞 step 60min 上限被砍 ⇒ CT(windows) 恒红 ⇒ 全仓 120 个 open PR 被同一条必需检查堵死（是**超时**，不是测试红）。③ 缩量本身等于拆门禁，故以「清单单源 + 逐条存在性 + 条数保值断言」三项作对价，把被拆掉的验证力换成可断言的不变量。④ 默认路径不变 ⇒ 调用方（`synova-submit.sh` ④ 步、开发者手跑）语义零变化，避免"为了快而悄悄改行为"。
---

# 决策 Note — D1109 CI 关键路径瘦身（simulate-ci smoke 缩量）

> 任务: D1109 ｜ 分支 `fix/D1109-ci-critical-path-slim`
> 规格源: `.claude/task-briefs/2026-10-02-D1109-ci-critical-path-slim.md`
> 状态: implemented（随本卡落地；终审归 K3）

## 1. 触发场景

全仓 120 个 open PR 同时卡在**同一条**必需检查 `Control Tower Gate Tests (windows-latest)`。
拉失败日志（run 36520361276）得：

```
04:10:10 -> 04:12:23   前面 13 条密封测试合计 133s
04:12:23 -> 05:10:17   tests/control-tower/simulate-ci.test.sh 独占 3474s
##[error]The action 'Run hermetic control-tower gate tests' has timed out after 60 minutes.
```

即：**不是测试红，是 step 超时**。`ci.yml:428-430` 给该 step 的 Windows 上限正是 60min。

## 2. 根因（源码级，可核）

| # | 事实 | 证据 |
|---|---|---|
| F1 | ② 段逐条真跑 ci.yml 密封清单（45 条） | `scripts/control-tower/simulate-ci.sh:49,53-64` |
| F2 | 夹具三次调用 simulate-ci.sh | `tests/control-tower/simulate-ci.test.sh:37,47,52` |
| F3 | 夹具**自身**就在 CT job 密封清单内 | `.github/workflows/ci.yml:476` |
| F4 | step Windows 上限 60min | `.github/workflows/ci.yml:428-430` |

⇒ 嵌套乘法：CT job 跑夹具 → 夹具三次调 simulate-ci → 每次再全跑 45 条。第 ③ 项验证（条目可执行）在嵌套场景下**已被 CT job 本体做过一遍**，重复执行边际信息量为零。

## 3. 决策与对价（本 Note 的核心）

**只缩「真跑条数」，不缩「清单单源」与「条目存在性」**：

- 清单仍从 `ci.yml` 单源提取（不硬编码、不散列）
- 清单**每一条**仍逐条做存在性校验（缺文件照旧 `FAIL=1`，不因 smoke 豁免）
- 打印 `SIM_MANIFEST_TOTAL / SIM_RUN / SIM_SCOPE`，夹具据此断言 `SIM_MANIFEST_TOTAL == 独立重算条数`（防脚本内加 `head` 之类把清单悄悄改小）
- smoke 代表样本必须是**清单成员**，否则 `fail-closed` 判红（防指向未登记测试）
- 默认（不设 scope）走 `full`，与改动前逐字节等价

## 4. 实测（本机，Windows）

```
夹具 tests/control-tower/simulate-ci.test.sh : 10 通过 / 0 失败 · EXIT 0 · 36s
  （先例 D1039-A4v 同机同夹具 = 1524s）
单次 simulate-ci.sh（smoke，绿桩）           : 17s
SIM_MANIFEST_TOTAL=45 SIM_RUN=2 SIM_SCOPE=smoke
```

⚠️ 诚实边界：本机墙钟 ≠ Windows runner 墙钟（D1039-A4v 同款告诫）。CI 侧收益以 push 后新 run 的 job 级耗时为准。

## 5. 相关

- D521（单源清单 + 自排除防递归）：`memory/notes/implemented/2026-08-24-d521-submit-chain.md:21`
- D1039-A4v 独立复核（先例墙钟）：`docs/synova/product-lines/evidence/D1039-A4v-独立复核-墙钟比对.md:667-670`
- 未清项：`ci.yml` 的 timeout 基线重取（n=12 success）须在新 run 出现后另卡完成
