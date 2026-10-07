# D737: tag-bypass-wiring 真红定位与修复（测试漂移）

> 派单: 创始人转 CTO「待分配号·A」（P1）—— ① 定位 2-3 条失败根因（产品缺陷 or 测试漂移，给判据）② 修复或按铁律 37 处置 ③ 确认棘轮为何没抓到
> 取号: D737（经 `alloc-task-id.sh` 实分配；分配器跨分支撞车现场复现，见 Q1c）
> 红线: 不改 scripts/audit/ ✅ 零触碰
> 数字对齐（CTO 要求先对齐）: 测试自报 **22 通过 / 2 失败**，与 CTO 实测一致。我此前报「3 失败」是数了 ❌ 行数（含 `Status: ❌` 汇总行），**CTO 的口径正确**，已更正。

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔门禁的**测试**层（非运行时）。该测试覆盖 `scripts/pre-push-check.sh` 的 D319 版本 tag 一致性 + D331 tag 锚点校验 + bypass 对账。本任务只改测试，让断言与门禁**当前语义**对齐，并补上真正该拦路径的覆盖。
### b) 文件审计
实测: `grep -c "tag-bypass-wiring" .github/workflows/ci.yml` = **0** → 该测试**不在 CI 控制塔测试 job 列表里**（列表硬编码枚举），CI 从不跑它。`ci.yml:235` 跑的是另一个测试 `tag-ancestry.test.sh`。除自身外全仓只有 `scripts/pre-push-check.sh:230` 在注释里提过它。
### c) 决策
判据在手 → 判为**测试漂移**（非产品缺陷），按「改测试到现语义 + 补新路径覆盖」处置；**不按铁律 37 删除**（测试有价值，其覆盖的门禁仍在生产运行）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
业界: 把测试钉死在实现的历史文案/历史语义上是测试漂移的典型来源；通行做法是断言**行为契约**（exit code + 语义分类），文案用稳定子串，语义变更时同步补覆盖新语义的用例。Anthropic 工程基线: ① 机器可验契约；② fail-closed 三态；③ **未被执行的门禁 = 没有门禁**（同 D515 教训：本地不跑就等于没有）。memory 历史教训: D520（孤儿 tag 拦死无关分支推送×3 → D521 有意放宽）、D331（tag 锚点断裂事故本源）、D663（CI hermetic 棘轮）。
Q1c 决策参考系: 参考 Anthropic（未执行=无门禁）+ 第一性原理（两条失败断言都在描述**已被 D521 取代**的旧语义，代码侧有日期化判据 → 修测试而非修产品）+ 开源实证（断言行为契约而非文案）。结论: 收敛 —— 修 2 条断言到现语义 + 新增 1 条覆盖真正拦截路径 + 登记「该测试不在 CI」缺口。
**取号实测（顺带命中 D730 登记项）**: `alloc-task-id.sh` 先给出已被占用的 **D736**（#536 分支已登记，main 看不到），**开远端校验后仍给 D736**；用其自带 `SYNO_TASK_STATE_DIR` 缝喂入「main ∪ #536」并集才得真空号 D737。D730 登记的「alloc 跨分支唯一性校验」缺位，现场复现，如实登记未修（不属本任务写集）。

## Q2: 范围 — 正确的最简方案
做什么：
- tests/control-tower/tag-bypass-wiring.test.sh（改：用例 1 语义 + 用例 2 文案 + 新增用例 2b）
- task-state/D737.json（取号登记）
- .claude/task-briefs/2026-09-14-D737-tag-bypass-wiring-真红定位与修复.md（本 brief）
不做什么：
- 不改 scripts/pre-push-check.sh（**门禁行为是有意的**，D521 带日期化判据；本任务判为测试漂移，不动产品代码）
- 不改 .github/workflows/ci.yml（红区；「把该测试接进 CI」是缺口登记项，由 CTO 在批 C 一并处理）
- 不改 tests/control-tower/tag-ancestry.test.sh（另一测试，在 CI 里且有独立覆盖）
- 不改 scripts/audit/audit-rules.sh（K3 审计红线，禁碰）
- 不改 scripts/control-tower/alloc-task-id.sh（取号器跨分支缺陷已登记，未获派单，不擅自扩面）

## Q3: 验收 — 入口 → 交互 → 结果
入口: `bash tests/control-tower/tag-bypass-wiring.test.sh`
处理: 沙箱建仓 → 造孤儿 tag / 非 main 祖先 tag / bypass 记录缺失等场景 → 跑 `SYNO_TAG_ONLY=1 bash scripts/pre-push-check.sh` → 断言 exit code 与输出语义
结果: **26 通过 / 0 失败**（原 22/2）；此前零覆盖的「HEAD 祖先但不在 origin/main 上」路径现有专门用例守住。

## 架构层: 基础设施
控制塔门禁测试基建（tests/control-tower/），不进运行时链路：不 import src/、不 import packages/、零跨层。

## Done 标准: 物理命令断言（每条可直接跑，exit 0 = 达标）
- [ ] DS1: `bash tests/control-tower/tag-bypass-wiring.test.sh` → 26 通过 / 0 失败（原 22/2）
- [ ] DS2: 根因判据可复核: `grep -n "D521/不变量1" scripts/pre-push-check.sh` 命中（门禁侧有日期化决策注释 = 有意行为）
- [ ] DS3: 新覆盖守住真拦截路径: 用例 2b 断言「HEAD 祖先 tag 未上 main → exit 1」且点名「不在 origin/main 上」
- [ ] DS4: ③ 棘轮答案可复核: `grep -c "tag-bypass-wiring" .github/workflows/ci.yml` = 0（CI 从不跑它 = 漂移无人可见）
- [ ] DS5: 写集外零改动（`git diff --name-only origin/main...HEAD` 仅列 Q2 include）
- [ ] DS6: `SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh` + `bash scripts/control-tower/simulate-ci.sh` 均 exit 0
