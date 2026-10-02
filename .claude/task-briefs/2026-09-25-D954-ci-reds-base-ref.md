# Task Brief — D954 C 段空转修复（--ci-reds 对账对象改指 base + 判别夹具 + infer_did 回退）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L0 控制塔门禁面。K3 批次 5 定罪：「C 段对账在 CI 上**恒空转**」——gate job 取的是**当前提交**的 check-runs（`REF: github.event.pull_request.head.sha || github.sha`），该 moment 多数 job 仍 in_progress ⇒ `CI-RED-CHECK: 失败检查 0 项` ⇒ 棘轮从未被行使。同一 SHA 终局实有 3 个 failure；gate job 只跑 19s，红 job 到 +71s/+119s/+27min 才定态。
### b) 文件审计（实测，2026-09-25 00:50 +0800，base=`origin/feat/m9-gate-integrity` @ `c4206f9b`）
- `.github/workflows/ci.yml:364` `REF: ${{ github.event.pull_request.head.sha || github.sha }}`（**取 head，不取 base**）；`:393` `--ci-reds /tmp/checkruns.json`；`:398+` 证据步
- `scripts/control-tower/check-gate-integrity.sh`：C 段 ~`:641-700`；`--ci-reds` 参数在 `:715`；现无 base/ref 参数化、无「对账对象」打印；`disposition_due` 未消费
- `scripts/control-tower/merge_writeset_gate.py:137` `infer_did()`：现两源（branch → commit-subject），**无 `--did` 覆盖**
- 夹具齐备：`tests/control-tower/check-gate-integrity.test.sh`（29KB）、`merge_writeset_gate.test.sh`（15.8KB）
### c) 决策
参数化 + 显式打印对账对象 + 判别夹具 + `--did`/`infer_did` 回退；不动 M9 既有提交（只追加）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 第一性原理：**棘轮必须对"已定态的对照面"取数**——对 in-progress 自我取数 = 恒空集（不可判）。取 base 才有终局。
- Anthropic 基线：判据可执行 + 变异体改坏即红 + 降级不得冒充通过（exit 2）。
- memory：M9 自验已实测该空转（Gate Integrity 12:26:20→12:26:44 vs 红 job 12:27:55/12:28:19/12:53:50）；#747 被判「3 日 SLA 无物理执法」（解析器只消费 `expires`）。
- 参考：Anthropic/第一性原理 + 结论=「对账对象 = base ref 且打印可核；未登记红必红；SLA 逾期必红」。

## Q2: 范围 — 正确的最简方案
做什么（逐条精确路径）：
- scripts/control-tower/check-gate-integrity.sh — 改：新增 `--base-ref <ref>`（禁硬编码）；C 段输出**必打印** `对账对象 = <ref> @ <sha>`；`--ci-reds` 同时消费 `disposition_due`（逾期判红）
- tests/control-tower/check-gate-integrity.test.sh — 改：判别夹具「base 有红且未登记 → 必须红」＋ M2（ref 不可解析/无 check-runs → exit 2）＋ M3（删「对账对象」打印行 → 夹具必红）＋ disposition_due 逾期判红
- .github/workflows/ci.yml — 改：step 3 的 REF 改取 **base**（PR 事件 `github.event.pull_request.base.sha`；push 事件 `git fetch origin main && git rev-parse origin/main`），传 `--base-ref`；证据步注解前缀纳入「对账对象」行
- scripts/control-tower/merge_writeset_gate.py — 改：`infer_did` 回退与**诊断显式化**（三源全空 → 退试 commit subject + 注诊断，**仍不放行**）＋ 新增 `--did` 显式覆盖
- tests/control-tower/merge_writeset_gate.test.sh — 改：`--did` 覆盖 + 回退路径用例
- .claude/task-briefs/2026-09-25-D954-ci-reds-base-ref.md — 本 brief
- task-state/D954.json — 卡（write_set 含本 brief 路径）
- memory/notes/proposed/2026-09-25-d954-ci-reds-base-ref.md — 决策 Note

不做什么（含文件路径）：
- 不动 `scripts/audit/**`、`docs/synova/audit-reports/**`（K3 域）
- 不动 #747/#745/#738/#744 的任何文件；不回退/覆盖 M9 既有提交（`c4206f9b` 之前历史只追加）
- 不改 `scripts/pre-commit-check.sh`（D937 域）
- 不碰 `src/**`

## Q3: 验收 — 入口 → 交互 → 结果
入口：CI `Gate Integrity` job 的 step 3 / 本地 `check-gate-integrity.sh --ci-reds <json> --base-ref <ref>`
处理：解析 base ref → 取该 ref 的 check-runs → 与 `ci-red-baseline.txt` 对账（命中/未登记/过期/disposition 逾期）
结果：打印 `对账对象 = <ref> @ <sha>`；未登记红 → 判红；ref 不可解析 → exit 2；`disposition_due` 逾期 → 判红

## 架构层: 基础设施

## Done 标准
- [ ] verify: bash tests/control-tower/check-gate-integrity.test.sh → rc=0（含判别夹具与 M1–M3）
- [ ] verify: bash tests/control-tower/merge_writeset_gate.test.sh → rc=0（`--did` 覆盖 + 回退）
- [ ] verify: `check-gate-integrity.sh --ci-reds <base JSON> --base-ref main` 输出含 `对账对象 = `（原始输出入回执）
- [ ] verify: CI 上 gate job 的 `CI-RED-CHECK` 显示**真实条数**（>0 或明确命中基线），不再恒 0
- [ ] verify: `check-pr-budget.sh` PASS（≤12 文件、单域 mac）
