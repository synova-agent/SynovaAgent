# D1170 — all-checks-passed 聚合必需检查 + checker-review 事件过滤扩展

- 状态: proposed（2026-10-07，治理线）
- 来源: CTO 派单 2026-10-07《P0-3聚合必需检查》Lane A（详细件: ~/Synova-过程档案/2026-10-07-CTO-派单-治理线-P0-3聚合必需检查.md）
- 写面: 仅 `.github/workflows/ci.yml`

## 决策内容
1. 新增 `all-checks-passed` job（蓝本 DSH 上游 ci.yml:700-723，tag dsh-v0.2.0-rc.2，逐字；唯一差异 = 去掉
   `github.event_name == 'pull_request'` 限定，理由 #905 假绿发生在 main push 语境）。
   needs = 8 job 键恰覆盖 9 条必需 context；skipped/failure/cancelled 均判红；`if: !cancelled()`。
2. checker-review job 级 `if:` 从 `pull_request || feat/*` 扩为 `pull_request || merge_group || main || feat/*`。
   理由：原过滤使 main push / merge_group 下 job 整体 skip ⇒ ① 聚合 job（判 skipped=FAIL）会让每次
   main push 恒红；② merge_group 语境必需 context 永不报告 ⇒ merge queue 卡死（D515 同族）。

## 口径解释（派单判据内部张力，按保守解释执行并留档）
派单判据第 4 条「git diff 除新增段外零改动」与第 ② 项「main push 真跑」不可兼得：不动
checker-review 事件过滤 ⇒ 聚合 job 在 main push 必恒红。按「只冻结 name:/needs:」解释执行，
代价 = diff 多 checker-review `if:` 一处（+5 行注释）。已在 PR 正文标注。

## 已知上界（CTO 明令必须写进回执）
本 job 挡不住「PR 自己改 ci.yml 把本 job 改成恒绿」——PR 事件跑 PR 头分支里的 workflow（#905 机制）。
只保证 (a) skip 掉必需 job ⇒ 必红；(b) PR 直接改本 job 实现 ⇒ 挡不住（需 pull_request_target，下一张卡）。

## 落地判据（改坏即红，三夹具 + diff 基线）
见 task brief `.claude/task-briefs/2026-10-07-P0-3聚合必需检查all-checks-passed.md` Q3/Done。

## 退出条件
若 K3/CTO 否决 checker-review `if:` 扩展 ⇒ 聚合 job 必须同步降级（needs 去 checker-review 或
main push 语境豁免），否则 main push 恒红——两者必须同进退。
