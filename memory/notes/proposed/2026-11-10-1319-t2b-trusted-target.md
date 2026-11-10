# 决策: #1319 T2b 以受信事件修复核心门来源

状态: proposed
日期: 2026-11-10

## 现状

T2 的核心恒绿反例 run 3826 证明 `pull_request` 会直接执行 PR head 的同名 workflow 并产生成功 context，不能作为必需门。main 已回滚为无必需 context。T2b 临时探针 run 3830 证明本机 Gitea 的 `pull_request_target` 从 base 取 workflow，head 伪造定义不执行，且默认 checkout 指向 base；被审 head SHA 必须从 PR payload 显式取得。

## 决定

仅将核心 workflow 触发改为 `pull_request_target`，以 `github.event.pull_request.head.sha || github.sha` 提供被审 SHA，保留原有独立克隆、HEAD/BASE 对账与全部工程判据；workflow 和 runner 的事件映射接受该事件。两个 harness 增加 target 正常预检、head 伪造 workflow 不执行、base 预检以 rc=2 拒绝受信输入变化的验证。同步限定豁免、registry、claim 与本 Note，不执行 T3。

## 依据

平台实证日志只有 `TARGET_PROBE_BASE_WORKFLOW`，没有 `FORGED_TARGET_HEAD_WORKFLOW`；`GITHUB_SHA` 与默认 checkout HEAD 都是 base，payload 单独携带 PR head SHA，context 为 `t2b-target-probe / probe (pull_request_target)`。本地 workflow harness 实测 23/23、runner harness 29/29，证明最小事件改造未改变其他判据。

## 生效时点

本 Note 随 T2b 改造 PR 记录实现决定；只有旧 local-gates 绿且 CTO 审批后才允许合并。合并后仍须正常 PR 新门绿、过渡双闸和核心恒绿反例通过，才能移旧并形成 G2 终态。
