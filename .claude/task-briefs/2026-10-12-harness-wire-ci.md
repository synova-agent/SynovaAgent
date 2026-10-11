# Task Brief: 把两个门禁复现器（harness）接进 CI（CTO 立卡）

> 来源：CTO 立卡（K12 第 6 批）—— 由独立复核发现「`ci-emptygreen-sim` 在 `local-gates.yml` 命中 **0**」升级而来
> 批次：第 6 批 ｜ 坐标系：总闸 不适用｜承重件 不适用｜命名空间 不适用

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：把两个**复现器**（harness）接进 CI，让「CI 自己的语义」也有人守。

**② 解决什么问题（实测）**：
```
$ git show <trunk>:.gitea/workflows/local-gates.yml | grep -c <各件>
    ci-emptygreen-sim.sh           命中=0     ci-emptygreen-sim.test.sh   命中=0
    ci-deps-step-sim.sh            命中=0     ci-deps-step-sim.test.sh    命中=0
⇒ 两个复现器与它们的配对测试**只活在人工手里**；而它们保护的恰是 CI 自己的语义：
   ci-emptygreen-sim  → ③ 步「空绿分类」判据（本批 #345/#371 的产物）
   ci-deps-step-sim   → ② 步「lock 哈希指纹」判据（#344 的产物）
```

**③ 做完对项目的推动**：**这条链开始自己抓自己** ——
`ci-emptygreen-sim.sh` 会把 ③ 步正文**逐字抽出**并以 `bash -e`（与 Gitea 同构）执行
⇒ 若有人把 ③ 步的 `set +e` 拿掉（复现 #338 那个「`set -e` 下子命令失败即退 ⇒ 整步零输出」的缺陷），
该 harness 判 **HARNESS-BROKEN** 并 **exit 2** ⇒ **CI 上红**。**卡面判据即此**。

**④ 🔴 约束（CTO 立卡明写）**：**条件跳过必须 <1s**
（历史病根：门禁太重 ⇒ 超时 ⇒ 被迫 `--no-verify` ⇒ 门禁链全线失效）。
⇒ 仅当变更集触碰 `local-gates.yml` / 两个 harness / 两个夹具之一时才真跑；否则立即退出。

**⑤ 判据（可复跑 · 原始输出）**：
```
条件跳过（变更集不含相关文件）  ⇒ rc=0，real=**0.03s**   ← <1s 约束满足
命中（变更集含 local-gates.yml）⇒ rc=0，real=76.36s；内部：
     CI-EMPTYGREEN-SIM: OK（8 场景全 PASS）       ← 5.5s
     结果: 11 通过, 0 失败                        ← 配对测试
     ci-deps-step-sim.sh 全 PASS                  ← 该件真跑 npm ci，故重（~70s）⇒ 正因如此必须条件化
改坏即红（卡面判据 · 需在**真 CI** 上验）：拿掉 ③ 步 `set +e` ⇒ 期望 CI 红且 rc=2 HARNESS-BROKEN
```

**⑥ 涉及文件**：`.gitea/workflows/local-gates.yml`（仅**新增** step ④）

## Q0: 定位 — 项目拼图 + 文件审计
属 **CI 工作流**，不属产品代码分层 L1–L5。
文件审计（实测 @ trunk）：两个 harness + 两个配对测试**均存在且本地可跑通过**（见上）；workflow 对它们命中 **0**。

## Q1: 调研
a) 业界：CI 自身的判据变更，必须有**独立于人工**的回归护栏（否则改坏了没人知道）。
b) 顶级团队：慢门禁**条件化**（只在相关面变更时跑），并把"跳过"**显式打印**（禁静默）。
c) memory 教训：**纪律 8**（判据自证"跑的是自己"）；**纪律 9**；#338 的 `set -e` 吞输出缺陷；
   D1148/旁路教训「无阻断执行方 = 门禁虚设」。

## Q2: 范围
做什么：
- .gitea/workflows/local-gates.yml
- .claude/task-briefs/2026-10-12-harness-wire-ci.md

不做什么：
- 不改 scripts/control-tower/ci-emptygreen-sim.sh
- 不改 scripts/control-tower/ci-deps-step-sim.sh
- 不改 tests/control-tower/ci-emptygreen-sim.test.sh
- 不改 tests/control-tower/ci-deps-step-sim.test.sh
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/check-content-coupling.sh
- 不改 .gitea/workflows/local-gates.yml 的步骤 ① ② ①b ①c ③（只**新增** ④）

## Q3: 验收 — 入口 → 交互 → 结果
入口：Gitea Actions 跑 `local-gates` 的第 ④ 步
处理：算变更集 → 不含相关文件则 <1s 跳过；含则跑两个 harness + 一个配对测试
结果：相关面被改坏时该步红（判据链自证）；平时 <1s 跳过

## 架构层: ⓪ 连接器（人侧 ⓪-b：谁/能看什么）
#CRITERIA: C

## 写集
- .gitea/workflows/local-gates.yml
- .claude/task-briefs/2026-10-12-harness-wire-ci.md

## Done 标准
- [ ] verify: `grep -c 'ci-emptygreen-sim.sh' .gitea/workflows/local-gates.yml`（输出 ≥1）
- [ ] verify: `bash scripts/control-tower/ci-emptygreen-sim.sh`（expectExit 0）
### 附加模板项
- [ ] 条件跳过 <1s（实测 real=0.03s）
- [ ] **改坏即红（卡面判据）**：拿掉 ③ 步 `set +e` ⇒ **在真 CI 上红**（rc=2 HARNESS-BROKEN）——留 CI 日志为证
- [ ] 仅新增 step ④；①②①b①c③ 未改
---
## 状态（事实台账 · 2026-10-12）

| # | 判据命令 | expect | 实跑 | 判定 |
|---|---|---|---|---|
| 1 | `grep -c 'ci-emptygreen-sim.sh' .gitea/workflows/local-gates.yml` | ≥1 | 待填（提交后核） | — |
| 2 | 条件跳过路径（变更集不含相关文件） | rc=0 且 <1s | rc=0，real=**0.03s** | PASS |
| 3 | 命中路径（变更集含 local-gates.yml） | rc=0 | rc=0，8 场景 + 11 通过，real=76.36s | PASS |
| 4 | 改坏即红（真 CI）：拿掉 ③ 的 `set +e` | CI 红 + HARNESS-BROKEN | 待 CI 实测 | — |
