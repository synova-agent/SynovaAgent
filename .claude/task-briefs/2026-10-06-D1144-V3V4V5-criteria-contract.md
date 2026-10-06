#CRITERIA: D

# Task Brief: V3+V4+V5 · 46 项判据契约修复（施工项登记件唯一写者）

> 认领: 🛠 registry-owner（产品线执行 session）
> 坐标系：总闸=不适用｜承重件=不适用｜批次=第2批-V组｜命名空间=不适用｜执行态=开工｜验证级别=L2-真跑通｜阻塞源=等 V1 落 main（栈式 PR）
> 共享任务：task-1 ｜ Issue: Refs #1032 / Refs #1035
> 依据：#CRITERIA=D 取自 `.codex/criteria-code-map.json`（D = 兜底；本次改动落 `docs/**`，不属 A/B/C 的 src 代码区）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图

`docs/synova/coordination/施工项登记.ts` 是**基座施工的单一事实源**（D1144 / CTO 2026-10-04，48 项 / 46 活跃 / 12 块）。
它不在 L1-L5 代码层，处在**协调/契约层**：为 46 个施工项声明 `paths`（写集）/ `acceptance`（判据）/ `dependsOn`（依赖）。
S5 尽调（`/tmp/dsh-study-s5-test.md`）实测其判据体系四项全不成立：A 38/46、B 0/46、C 6/46、D 0/46
⇒ 本卡是**契约修复卡**：把"判据是否可跑、是否真能判"从文档声明变成**实测可核字段**。

### b) 文件审计

- 登记件 blob `95d97801f`（48 项 / 46 活跃 / 12 块）——`git rev-parse HEAD:docs/synova/coordination/施工项登记.ts` 实测一致
- 其执法体 `tools/check-construction-registry.ts` **不在 base ref**，且未接线 ⇒ "0 违规"是本机结论，非门禁结论
- 证据落点实测：`docs/synova/coordination/evidence/**` **被 `.gitignore:81 evidence/` 忽略**（`git check-ignore -v` 有输出）
  ⇒ 改落 `docs/synova/product-lines/evidence/V3V4V5/`（`git check-ignore -v` 无输出 = 可跟踪）
- 判据件实况：49 条 acceptance 引用中 **42 条**在 base ref 不存在（`git cat-file -e` FAIL，原始输出见证据包）

### c) 决策

- 已有覆盖 → 复用（`ItemVerification` 复用登记件既有 `expectExit/expectRowsGt` 口径，不新造体系）
- V5 新增字段（schema 变更）→ 本卡内做（属登记件域）
- V4 **不补判据件**：36 步的判据件落 `scripts/control-tower/**` 与 `tests/**` ⇒ **越出本卡槽界**（派单纪律明文禁改 `scripts/**`；D 夹具归 fixtures 路），按判例 P-01 报回而非照做
- V3 B 不成立 → **不造假**：保留原判据 + 降级 L1 + 逐项显式写「未验」（判例 V-09）；禁改成"存在即可"的永远真断言（判例 P-03）

## Q1: 调研 — 业界最佳实践 / memory 历史教训

- a) 判据可核性：业界做法是"判据 = 可执行命令 + 退出码"，不接受人工阅读结论。本卡据此把每项的判据状态落成**机器可查字段**（`level` / `baseline` / `unverified`），而不是散文描述。
- b) 独立复核（判例 V-03）：交付者与核验者必须不同轴 ⇒ 新增 `verifier` 字段并把"≠ 实现者"做成可测比值（抽 10 项 ≥80%）。
- c) 决策参考系：参考 Anthropic 工程基线（"断言必须先于实现、可机器判"）+ 第一性原理（**不能被证伪的判据不是判据**）⇒ 结论：**宁可标"未验"，不标"已核"**。

## Q2: 范围 — 最简方案

做什么:

- docs/synova/coordination/施工项登记.ts
- docs/synova/product-lines/evidence/V3V4V5/

不做什么:

- 不改 scripts/control-tower/ 下任何文件（V4(a) 补判据件需写此处 ⇒ 槽界外，已报回）
- 不改 tests/ 下任何文件（D 判据夹具归 fixtures 路；B 的区分性断言同样越界）
- 不改 docs/synova/coordination/fixtures/（他人写集）
- 不改 .github/ 与 scripts/audit/（K3 专属红线）
- 不改 package.json（main 的 npm ci ERESOLVE 属治理线 W1，本卡不碰）

## Q3: 验收 — 入口 → 交互 → 结果

- 入口: `node --experimental-strip-types docs/synova/product-lines/evidence/V3V4V5/analyze.ts --ref origin/docs/D1144-registry-unbundle`
- 处理: 载入登记件真实数据对象（**非 grep**）→ 对 46 项逐条判 A/B/C/D + 汇总计数
- 结果: 46 行 TSV + 汇总（B(green)=6 / B(unrunnable)=40 / B(red)=0；C(Y)=7；V5 46/46）+ `per-item.md` 逐项表

## Q4: 契约与测试

- `analyze.ts` 契约（JSDoc 内声明）：`@input` 登记件路径 + git ref；`@output` stdout TSV + stderr 汇总；`@degraded` ref 不可解析 ⇒ `DEGRADED:` + exit 2（**不静默降级**，铁律 24）
- `v5-verifier-sample10.ts` 契约：`@output` 抽样表 + 比例；exit 0 = ≥80%，exit 1 = 不达标，exit 2 = 项数 <10（degraded）
- 硬约束做成机器可查：`status==='todo'` 且 `level==='L1'` ⇒ `unverified` **必须**非空且含「未验」字样
- 证据一律原始命令 + 原始输出，**禁手写数字**（判例 S-01③）

## 架构层: docs（协调/证据层 —— 非 L1-L5 代码层）

## Done 标准

- [ ] verify: `node --experimental-strip-types -e "const m=await import('./docs/synova/coordination/施工项登记.ts');const t=m.constructionItems.filter(i=>i.status==='todo');console.log(t.filter(i=>i.verifier&&i.verification).length)"` 输出 `46`
- [ ] verify: `node --experimental-strip-types docs/synova/product-lines/evidence/V3V4V5/v5-verifier-sample10.ts` exit 0 且末行含 `PASS`
- [ ] verify: `node --experimental-strip-types docs/synova/product-lines/evidence/V3V4V5/analyze.ts --ref origin/docs/D1144-registry-unbundle 2>&1 >/dev/null | grep -q 'A(严格'` exit 0（体检器可跑）
- [ ] verify: `git ls-remote --heads origin docs/V3V4V5-criteria-contract` 非空 **且** `git cat-file -e origin/docs/V3V4V5-criteria-contract:docs/synova/product-lines/evidence/V3V4V5/per-item.md` exit 0（证据件落**本分支**；落 main 需栈式 base #1163 先合）
- [ ] verify: `bash scripts/workflow/check-brief-parseable.sh .claude/task-briefs/2026-10-06-D1144-V3V4V5-criteria-contract.md` 输出含 `✅`
- [ ] verify: 逐项「未验」声明覆盖 46/46（`grep -c '未验' docs/synova/product-lines/evidence/V3V4V5/per-item.md` ≥ 46）

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-06-D1144-V3V4V5-criteria-contract.md | task |
| docs/synova/coordination/施工项登记.ts | task |
| docs/synova/product-lines/evidence/V3V4V5/README.md | task |
| docs/synova/product-lines/evidence/V3V4V5/analyze.ts | task |
| docs/synova/product-lines/evidence/V3V4V5/assign-verifier.codemod.mjs | task |
| docs/synova/product-lines/evidence/V3V4V5/per-item.md | task |
| docs/synova/product-lines/evidence/V3V4V5/v3-baseline-run.md | task |
| docs/synova/product-lines/evidence/V3V4V5/v4-criteria-existence.md | task |
| docs/synova/product-lines/evidence/V3V4V5/v5-verifier-sample10.ts | task |
| docs/synova/product-lines/evidence/V3V4V5/v5-verifier.md | task |
