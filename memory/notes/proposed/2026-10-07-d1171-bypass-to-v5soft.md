# D1171 — pre-commit 三处 bypass_run 撤旁路复执法 + 旁路家族逐条处置

- 状态: proposed（2026-10-07，治理线）
- 来源: CTO 派单 2026-10-07 Lane B《pre-commit-check.sh 二合一：让闸真生效》（P0）
- 写面: `scripts/pre-commit-check.sh`（+判据配套夹具 `tests/control-tower/hard-gate-convergence.test.sh`，判据变更同 PR 送 K3）

## 决策内容
1. **P0-5**: 三处 `bypass_run`（D782 D1 文档真相 / D782 D2 登记门禁 / D734 PR 预算）撤旁路复执法
   ——显式执行 + `v5_soft`（输出保留、本地软提示、CI strict 硬阻断）。
   依据（铁规⑧ "Enforce a decision in the operation that makes it"）: 旁路不判红、CI 不转硬
   = listener 型非执法；D1148 撤回留痕自认 D734「该门禁当前无阻断执行方」。
2. **旁路家族处置表**（11 处 grep 命中 = 3 调用点 + 定义块 + 留痕注释；旁路观测点家族全量判定）:

| # | 位置 | 项 | 处置 | 理由 |
|---|------|----|------|------|
| 1 | :1673 | D782 D1 文档真相 | **转 v5_soft** | P0-5 明令；D1148 代价自认（CI 不再拦导航漂移）；K3 收割项 |
| 2 | :1680 | D782 D2 登记门禁 | **转 v5_soft** | 同上；W1/W2 接线断言依赖字面量（保留） |
| 3 | :1715 | D734 PR 预算 | **转 v5_soft** | P0-5 明令；撤回留痕自认「无阻断执行方」=门禁虚设；阈值不动（归 #1017） |
| 4 | :1081 | plan-integrity non-Q2 项 | 留（note_check） | plan.json 契约明文 deferred——后续阶段执行是**设计行为**非违规 |
| 5 | :1316 | 验收 CI (V3.9) | 留（note_check） | 验收以 CI Iron Laws 为权威；本地跑全量验收破 pre-commit <10s 预算 |
| 6 | :1617 | G12c dev doc 写集 | 留（note_check） | 同判据已有更强执行点（CI merge_writeset_gate D708），避免双计数 |
| 7 | :1629 | G12d 声称↔证据表 | 留（note_check） | 对照表产出供 K3 审计消费，无机器可判阈值 |
| 8 | :1675 | D1 脚本缺失 fallback | 留（note_check） | CI 完整 checkout 不可能命中；存在性另由接线断言（W1/W2）保证 |
| 9 | :1682 | D2 脚本缺失 fallback | 留（note_check） | 同上 |
| 10 | :1717 | D734 脚本缺失 fallback | 留（note_check） | 同上（check-pr-budget.test.sh 保证存在） |
| 11 | :182-189 | bypass_run 函数定义 | 留（定义块） | 回滚路径（D1171 注释明示一行回滚法）；调用点清零后为休眠函数，复活须过 K3 |

3. **配套夹具**（判据变更 ⇒ 先红后绿 + 反例，送 K3）:
   - 结构: KEEP_V5SOFT 三断言 + 反向断言 `bypass_run "D782`/`bypass_run "D734`（回退即红）。
   - 行为: C1（未登记 .yaml 探针 + SYNO_CI=1 ⇒ exit 1 且点名 D2）/ C2（本地 ⇒ exit 0 仍点名，报告不静默）。
   - 反例实测: D2 改回 bypass_run 的副本 ⇒ 结构断言红 + CI-strict 探针 rc=0（门禁失效形态被夹具分辨）。
   - 探针用根级 .yaml 而非 docs/*.md: CT-34 纯文档早退会把纯文档提交挡在 D782 块之前（首轮实测踩到）。

## 已知上界
- CT-34 纯文档早退豁免 12 组: **纯文档提交仍不经过 D782/D734 块**（创始人 2026-08-16 决策，本卡不改）。
  即未登记的 docs/*.md 在提交端不被 D2 拦（.yaml/.html 等白名单外路径会被拦）。此为有意豁免面，留 K3/CTO 复核。
- 本地（非 CI）三处仍软提示不阻断——CI strict（SYNO_CI=1，ci.yml Iron Laws 注入）为权威。

## 退出条件
若 K3/CTO 否决某处转硬 ⇒ 对应 v5_soft 块回滚 bypass_run 一行 + KEEP_V5SOFT 断言同步移除。
