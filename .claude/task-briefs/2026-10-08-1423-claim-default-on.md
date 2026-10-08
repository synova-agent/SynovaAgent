# Task Brief — 1423-claim-default-on: `SYNO_CLAIM_V2` 默认翻「开」（D-C 最后一刀）+ 存量 D# 反例守护

## Q0: 定位
- 治理面（门禁/控制塔域）：单一开关 `SYNO_CLAIM_V2` 的**默认值**与其四处 bash 解析点 +
  `scripts/pre-commit-check.sh` 组 12 的 legacy 载体判定。
- 卡 **#1423**（D-C「标识与声明归一」最后一刀）。创始人 2026-10-08 原话：
  「**一步到位**，但是**现在还带 D 的任务也不要影响他们合并**」⇒ 两句同时满足是本件全部要害。

## Q1: 调研
- 现状：`claim_v2_enabled` 默认关 ⇒ 新任务走 issue 号身份只停在合并级（提交端仍按 legacy 走）。
- **先测后改（本件的关键实测）**：直接把默认翻开会踩到 D1220 的「claim 模式 ∧ 无 legacy 载体 ⇒ 硬红」
  分支 —— D# 在飞任务的 brief 落在 ±1 天窗口外（跨日常态）时 `ALL_TODAY_BRIEFS` 为空
  ⇒ 被误判"本提交无 legacy brief 载体" ⇒ **拦死在飞合并**（创始人明令禁止的后果）。
  实测（沙箱，窗口外 D# brief + 开关开）：`未被任何 claim 声明覆盖；且本提交无 legacy brief 载体`。
- 决策参考：第一性原理（翻默认必须同时守住"存量只读兼容"这条边界）+ Anthropic 工程基线
  （回滚点必须显式且逐字节）+ 本仓棘轮纪律（新增测试须显式上调 FACE-TOTAL）。

## Q2: 范围
做什么：
- scripts/control-tower/claim_store.py
- scripts/pre-commit-check.sh
- scripts/workflow/resolve-commit-brief.sh
- scripts/check-verifiable-done.sh
- scripts/check-brief-vs-code.sh
- tests/control-tower/claim_store.test.sh
- tests/control-tower/claim-identity-v2.test.py
- tests/control-tower/precommit-claim-wiring.test.sh
- tests/control-tower/precommit-groups-injection.test.sh
- memory/notes/implemented/2026-10-08-1423-claim-default-on.md
- .claude/task-briefs/2026-10-08-1423-claim-default-on.md
- .claude/claims/1423.yaml
不做什么（含文件路径）：
- 不删 scripts/control-tower/merge_writeset_gate.py 的 infer_did（创始人明令：存量 D# 链**只读保留**；
  删它 ⇒ 在飞 D# 任务合并级立刻 fail-closed = 被禁止的后果；存量清零后另卡再删）
- 不改 scripts/control-tower/alloc-task-id.sh（Lead 负责：新取号断流；本件只动开关与提交端）
- 不改 .github/workflows/ci.yml、scripts/audit/**、scripts/control-tower/check-gate-integrity.sh
- 不改 scripts/control-tower/merge_writeset_gate.py（本件零改动；其 claim 通道与开关无关）

## Q3: 验收
入口：`bash tests/control-tower/precommit-claim-wiring.test.sh`（#1423 判据并入既有夹具，守 D734 12 文件预算）
处理：单一事实源三态 / 四处口径一致 / 判据③反例（窗口外 D# 不被拦）+ 其变异体 /
      判据④新格式端到端 + 其变异体（回滚态不可提交）/ 回滚逐字节 legacy
结果：16 断言全绿；存量 D# 与新建 issue 号身份**同时**成立；回滚点 `SYNO_CLAIM_V2=0` 仍有效

## 架构层: 基础设施

#CRITERIA: D

## Done 标准:
- [x] verify: bash tests/control-tower/precommit-claim-wiring.test.sh ⇒ 0 失败（含 #1423 全段 + CI 面判据）
- [x] verify: bash tests/control-tower/precommit-groups-injection.test.sh ⇒ 期望红组全部 RED_CONFIRMED、decl_gates=0、baseline=ok
- [x] verify: bash tests/control-tower/claim_store.test.sh ⇒ 0 失败（默认开 + 显式 0 回滚）
- [x] verify: python3 tests/control-tower/claim-identity-v2.test.py ⇒ Ran 21 tests OK
- [x] verify: bash scripts/control-tower/sealed-tests.sh --list ⇒ rc=0（本件不新增测试文件 ⇒ 棘轮零改动）
- [x] verify: GITHUB_ACTIONS=true SYNO_CI=1 bash scripts/pre-commit-check.sh ⇒ 全部 13 组通过

## 写集
| 文件 | 类型 |
|---|---|
| scripts/control-tower/claim_store.py | task（单一事实源默认翻面） |
| scripts/pre-commit-check.sh | task（口径翻面 + 组 12 存量 D# 守护段） |
| scripts/workflow/resolve-commit-brief.sh | task（口径翻面） |
| scripts/check-verifiable-done.sh | task（口径翻面） |
| scripts/check-brief-vs-code.sh | task（口径翻面） |
| tests/control-tower/claim_store.test.sh | task（默认断言翻面 + 回滚断言） |
| tests/control-tower/claim-identity-v2.test.py | task（默认断言翻面 + 3 处回滚态显式关） |
| tests/control-tower/precommit-claim-wiring.test.sh | task（默认断言翻面 + 回滚断言） |
| tests/control-tower/precommit-groups-injection.test.sh | task（D1148 两处注入钉显式回滚态：claim-first 默认生效会遮住 legacy 三闸） |
| memory/notes/implemented/2026-10-08-1423-claim-default-on.md | task（决策沉淀，铁律 49） |
| .claude/task-briefs/2026-10-08-1423-claim-default-on.md | task（自身） |
| .claude/claims/1423.yaml | task（新格式声明载体） |
