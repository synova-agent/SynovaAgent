---
状态: proposed
日期: 2026-10-28
决策: gate-hits.log 扩 duration_ms/hits 并由 gate-telemetry.sh 单点写入；gate-stats.sh 区分「未运行」与「零命中」，空日志禁产出退役候选。
理由: 无耗时与运行状态时，空日志会把「没跑」误读成「零命中」→ 可能退役仍在用的门禁（M-8）；遥测必须可判，且写失败不得改门禁结论。
---

# #1094 W2 运行遥测：duration_ms/hits ＋「未运行」与「零命中」区分

## 现状（改前实测）

- `.claude/gate-hits.log` 的 JSONL 只有 4 字段 `{time,gate,result,branch}`：
  **无法区分「没跑」与「跑了但 0 命中」**，也没有耗时；旧 `gate-stats.sh` 在非空日志下把
  `hit==0` 的检查点直接列「删除候选」，空日志则只打一张 0 次触发的空表（无「未运行」概念）。
- `gate-retirement-report.sh` 已按「无数据 ≠ 零命中」处理（可复用其声明检查点扫描口径），
  但 `gate-stats.sh` 没有同口径 —— 两件读者对同一日志的语义不一致。
- 本 worktree 改前实测：`SYNO_GATE_HITS_LOG=/tmp/nonexistent bash scripts/control-tower/gate-stats.sh`
  只输出空表头（无任何「未运行」标记）；`log_gate` 自拼 JSON，写失败 `2>/dev/null || true` 全程静默。

## 决定

1. 新增 `scripts/control-tower/gate-telemetry.sh` 作为 gate-hits **唯一追加入口**：
   `--emit <gate> <result> <duration_ms> <hits>`；三态 `0=写入｜1=输入不合规（拒绝写入）｜2=判不了`
   （信号量 0 ⇒ 2；写失败 ⇒ stderr + degraded-events.log，**不改调用方门禁结论**）。
2. `gate-stats.sh` 增列「中位耗时(ms)」「命中」（Σhits；旧 4 字段行按 hit=1 / miss=0 回退）；
   按 pre-commit 的**声明检查点全集**区分「未运行」（无记录）与「零命中」（已运行但 0 命中）；
   无数据时只报「未运行」并明示「不得据此退役」，**不产出候选清单**（M-8）。
3. `pre-commit-check.sh` **只改 `log_gate` 这一处埋点**：改为经 gate-telemetry 写入；
   `duration_ms` 口径 = 距上一检查点间隔（首个检查点 = 0 未测得），`hits` = 本次是否命中（1/0）。

## 依据

- Issue #1094（创始人规格 v2.0 §3 W2 / §4 G2 / §5 M-8）：空日志必须报「未运行」而非「零命中可退役」。
- 观测缺失 ⇒ 判定失真（第一性原理）：没有运行状态时，任何「零命中 ⇒ 退役」结论都不可证伪。
- 既有单源约定：D515 项4 的 `log_gate` 单点写入；D782 D2 登记门禁；#623 受保护路径同 diff 自覆盖豁免。
- 三态与降级口径：`scripts/control-tower/AGENTS.md`（0 通过｜1 真红｜2 检查自身失败；信号量 0 ⇒ 2）＋ 铁律 11/24/31。

## 生效时点

- 合入本 PR 后：下一次 pre-commit 起的记录自动带 `duration_ms`/`hits`（**旧行无需迁移**，读取端兼容）。
- `gate-stats.sh` 立即按新口径出表；`gate-retirement-report.sh` 的 90 天零命中口径**本次未改**
  （避免判据变更；退役裁决仍归创始人/CTO）。
- 已知限制（如实记录）：
  1. `duration_ms` 为「检查点间隔」而非单组精确计时 —— 检查计算发生在 `hard_check/soft_check`
     被调用之前，本批写集限定只改 `log_gate`，函数内取不到该检查起点；`gate-stats` 只把 >0 样本计入中位。
  2. `hits` 记 1/0 而非命中条数 —— 条数在 `hard_check` 的局部变量 `count` 内，本批不外传；
     `gate-telemetry` 已接受任意非负整数，留给后续批次传真实条数。
  3. 日志仍被 `.gitignore` 忽略、不入库、不新建遥测目录（刻意设计：运行态产物不进货）。
