# Task Brief: FIX-002 — #796 撤销账本删除（主路径 A）+ 被删证据链修复
> 认领: 🧭 fix-coder-a（synova-squad-lead 小队）｜ 分支: feat/d969-daily-cto-board-paired-test ｜ 基线: origin/main
#CRITERIA: A

## Q0: 定位
### a) 拼图
控制塔提交链路（scripts/control-tower/）的 D331 执行证据账本 `.claude/bypass.log`。台账 FIX-002 的根因已在 CTO 裁决中纠正：**#796 自带的 `3ce59bbb`「移除 .claude/bypass.log」是为躲 union 冲突的本地绕道，不是 D331 迁移** —— 账本被删掉本身就是「新 clone 全员拒推」的成因。本卡执行主路径 A：撤销该删除。
### b) 文件审计
- `git log --oneline origin/main..41b97740` = 9 提交；`3ce59bbb` 只改 `.claude/bypass.log`（删除），`41b97740` 只改 `task-state/D969.json`。
- 生产口径 `check-bypass-log.sh origin/main` 在删除态不可执行（账本不存在）；恢复 `origin/main` 版本后仍 rc=1，缺 4 条记录（实测原始输出见回执 §1）。
- 唯一生产调用方 `scripts/pre-push-check.sh:425`（门禁 7，base=`origin/main`）；裸跑默认 base=`origin/feat/prompt-architecture` 的 range=2226 提交（CTO 实测）⇒ 判据必须显式给 base。
### c) 决策
撤销删除（恢复 tracked），**不改对账器语义**（与 D970/#799 零分叉）；被删除破坏的证据链按 D331/D451 既有机制修复：真实 hook 记录逐字还原 + 1 条显式一次性补记。D331 迁移（出库 + 归档 + 落点切换）留 D970，顺序 PR-2（归档）→ #799 → #796。

## Q1: 调研
铁律 35（最小改动优先于新增机制）、铁律 11（降级/补记必须显式可见）、D331（执行证据链对账）、D451（一次性补记豁免）、D457/D509（union driver 与账本冲突史）、D521（COMMITTED 登记成对提交）、D970（账本出库的选甲与跨机缺口显式登记）。
历史教训：D329（amend 绕过登记 ⇒ 证据链断裂）、D508（merge-base 与防御 fetch）、D513（tracking ref 陈旧 => 补记循环）。
参考：第一性原理（要修的是「账本被删」，不是「判据太严」）+ Anthropic 基线（最小必要变更、不改既有裁决语义）+ 开源实证（tracked 证据文件在并发分支下冲突是已知反模式 ⇒ 由 D970 归档方案解决，不在本卡）+ 收敛检查（本卡判据 = 生产口径 rc=0 且 tracked 恢复）。

## Q2: 范围 — 最简方案
做什么：
- .claude/bypass.log
- docs/synova/product-lines/evidence/FIX-002-20260926-回执.md
- memory/notes/rejected/2026-09-26-fix002-ledger-absent-vacuous-pass.md
- scripts/control-tower/check-bypass-log.sh
- tests/control-tower/check-bypass-log.test.sh
不做什么（含文件路径）：
- 不改 .github/workflows/ci.yml（本批 ci.yml 单写者 = FIX-013 任务）
- 不改 scripts/pre-push-check.sh（调用方无需改）

说明（写集语义，非新增改动）：上面两个控制塔文件的**唯一改动是回退**（`git diff 41b97740 -- <两文件>` = 0 行），即撤销本分支先前引入的读面分叉，恢复与 #799 同源；语义变更本身归 D970，不在本卡。

## Q3: 验收
入口: `bash scripts/control-tower/check-bypass-log.sh origin/main`（pre-push 门禁 7 的实际调用形态）。
处理: 恢复 tracked 账本 → 以 union 来源对账 merge-base(origin/main,HEAD)..HEAD 全部提交 → 逐条核对登记。
结果: rc=0（全部提交有记录）；`git ls-files .claude/bypass.log` 命中（tracked 恢复）；配对测试原状全绿。

## 架构层: 基础设施（scripts/control-tower 控制塔）
## Done 标准
- [ ] verify: `bash scripts/control-tower/check-bypass-log.sh origin/main`（exit 0，输出「✅ bypass.log 对账通过」）
- [ ] verify: `git ls-files .claude/bypass.log`（非空 = tracked 已恢复）
- [ ] verify: `bash tests/control-tower/check-bypass-log.test.sh`（exit 0，原状 5 用例）
