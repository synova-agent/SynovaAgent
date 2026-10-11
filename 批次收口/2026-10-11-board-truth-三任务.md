# 批次收口：board-truth 三任务（CTO 专项，2026-10-11）

> 执行者：CTO 专项会话 ｜ 判据与口径全部由 CTO 给定 ｜ 收不收的判定归 CTO
> 活账 § 号：待 CTO 归号（本件不自取 § 号）

## 本批完成度（四栏，口径 = CTO 裁定 011）

| 栏 | 内容 |
|---|---|
| **完成**（判据 exit 0 可复跑） | 第 2 件：`Closes #N` 两处模板（`.dsh`/`.claude` 镜像逐字一致）✅；第 3 件：`scripts/control-tower/check-board-metrics.ts` 已合入 local-main（PR #357），13 个模块里程碑口径已写入，改坏即红实测（#205 误关 ⇒ 35%→40% + 报警 + exit 1，已恢复）✅ |
| **部分**（卡保持 open，差额记正文） | 第 1 件三态表：①候选 3 张按新口径（卡面 Done 逐条）重判后**均不许关**（#193 请求路径未接 / #202 无应答通道 / #191 探针未入库不可复跑）；#191 与 #328 的界线已写进卡面 brief（V8–V12 属 #328，不是 #191 回退） |
| **撤销**（retired，不计入完成率） | #197 打 `执行态/retired（撤销）` 标签（打标≠关卡，可逆）；K12 真实完成率 7/20 = 35% |
| **未决 / 移交** | ① #193/#202/#191 的收卡判据补强（Done 逐条闭环）归各线负责人，收不收归 CTO 终裁；② 里程碑口径只覆盖挂 K* 里程碑的卡（无里程碑 closed 卡不进统计，头注释已声明）；③ 历史 24 张 closed 不追补（CTO 裁定：追补=事后造信号）；④ PR #224 落 main 后复跑 `probe-decision-ledger.ts` ⇒ 决定 #191 收卡 |

## 交付物指针

- PR #357（已合入 local-main，`merge-base --is-ancestor` 确认；CI 2/2 success，pending=0）
  - commit `239889e39`：metrics 门禁 + 两处模板；commit `f5c3fedd6`：独立复核回写
  - 决策 Note：`memory/notes/implemented/2026-10-11-board-metrics-and-closes-template.md`
- 三态表（依据列已按「卡面 Done 逐条」改口径）：见本轮回执；②类 27 张引用类型不变
