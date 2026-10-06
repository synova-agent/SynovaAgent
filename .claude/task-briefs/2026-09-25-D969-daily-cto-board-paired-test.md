# Task Brief: D969 — daily-cto-board 配对测试 + 对账探针 runner + 默认 REPO 去硬编码
> 认领: 🧭 coder-a（并行 CTO 小队 A）｜ 分支: feat/d969-daily-cto-board-paired-test ｜ 基线: origin/main 25e081ce
#CRITERIA: A

## Q0: 定位
### a) 拼图
D948 起的「CTO 每日自动看板」runner（scripts/control-tower/daily-cto-board.sh）。本卡补 U7/CT-40 要求的**配对测试**，并把它变成三条对账机制（D971/D973/D974 探针）的**接入点**。
### b) 文件审计
- `scripts/control-tower/daily-cto-board.sh`（95 行）已存在、**无配对测试** → `ct-test-gate.sh:34,45` 判 `缺配对测试` exit=1（实测复现）。
- `tests/control-tower/daily-cto-board-ratio.test.sh` 存在，但**文件名不匹配配对规则**（须 `<name>.test.sh`）→ 不构成配对。
- 无生产调用方（schedule 驱动）；全仓 `SYNO_REPO` 仅本脚本 + 两个测试使用（实测 9 处）。
### c) 决策
复用既有脚本（加探针 runner + 默认值去硬编码），新建配对测试；**不新建门禁**（铁律 35：接入点优于再加一道关）。

## Q1: 调研
铁律 35（能写 check-*.sh 的不靠 review）、铁律 48（正常/降级/边界三路径 + 真断言）、铁律 11/31（降级显式不静默）、
ctrl-tower-change 模式 1（三态退出码 0 过/1 业务阻断/2 执行失败）、模式 3（条件跳过保持轻量）。
历史教训：D393（控制塔脚本改了没测试 → 交付态红灯无物理拦截）、D796（目标工作区不存在却静默）、
D370（`$VAR` 紧贴全角标点 → `unbound variable`；本卡**真踩中**，由「改坏即红」夹具暴露并修复）。
参考：第一性原理（默认值不得指向他人工作区；失败必须可观测）+ Anthropic 基线（tri-state 门禁）+ 项目既有 ct-test-gate 配对范式 + 结论：用「配对测试 + 探针 runner」把三条对账机制接进既有看板。

## Q2: 范围 — 最简方案
做什么：
- scripts/control-tower/daily-cto-board.sh
- tests/control-tower/daily-cto-board.test.sh
不做什么（含文件路径）：
- 不改 scripts/audit/k3-batch-gate.sh （K3 专属域，禁碰）
- 不改 docs/synova/audit-reports/INDEX.md （K3 审计报告域）
- 不写 scripts/control-tower/probes/required-checks-probe.sh （D971 写集）
- 不写 scripts/control-tower/probes/docs-registry-probe.sh （D973 写集）
- 不写 scripts/control-tower/probes/task-id-watermark-probe.sh （D974 写集）

## Q3: 验收
入口: `bash tests/control-tower/daily-cto-board.test.sh`（U7/CT-40 门禁同源调用同一路径）。
处理: mktemp 沙箱造 3 类仓库形态 → 以 `SYNO_REPO` 注入运行看板 → 断言 rc / 结论 / 各段 / 探针三态。
结果: 25 断言全绿；`ct-test-gate.sh` 由改前「缺配对测试 exit=1」→ 改后「SYNC-OK exit=0」。

## 架构层: scripts（控制塔）
## Done 标准
- [ ] verify: `SYNO_TEST_ARM=1 SYNO_CT_STAGED="scripts/control-tower/daily-cto-board.sh" bash scripts/control-tower/ct-test-gate.sh`（退出 0，输出 SYNC-OK）
- [ ] verify: `bash tests/control-tower/daily-cto-board.test.sh`（25 通过 / exit 0；含探针三态的**行为**断言，非 grep 静态判据）
- [ ] verify: `bash scripts/workflow/check-silent-swallow.sh --diff`（exit 0，无新增静默吞错）
