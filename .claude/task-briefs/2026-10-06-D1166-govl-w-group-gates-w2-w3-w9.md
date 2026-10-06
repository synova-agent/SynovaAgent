# Task Brief: D1166 govl-w-group-gates-w2-w3-w9

> 生成: 2026-10-06 | 任务: D1166 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=进行中 ｜ 施工批次=第0批-止血 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=等K3
> 派单源: CTO 2026-10-06《开发计划 v2》A 槽 **W2 / W3 / W9**（门禁语义变更 ⇒ 提案→K3→CTO 裁）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/门禁层（`.github/workflows/ci.yml` + `scripts/control-tower/**`），非产品五层。
治的是同一条病：**「跳过 = 成功」**——GitHub 把 `skipped` 当 success-ish，不阻断必需 context。
### b) 文件审计
- `ci.yml` 10 处 `Detect docs-only change (D515)`：push 到 main 时 `git diff origin/main...HEAD` 恒空 ⇒ 恒判 `docs_only=true`（旧注自认"避免空跑"）
- `tests/control-tower/ci-signal-classify.test.sh:266` `DOWNSTREAM_NEEDS_JOBS="test golden-case"` — 新增 `needs:` 下游 job **必须显式登记**，否则红
- `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh:99-144` — docs-only 的 6 条结构不变量（count-10 / unique-1 / failsafe-count-10）
- `scripts/control-tower/required-checks-baseline.txt:48-56` — 必需 context **真值源 = 9 条**
- 现行文件仍写"12 个必需"的断言句：`ci.yml:955/958`、`product-progress.yml:10/76`、`check-required-contexts.py:6`、`ci-signal-classify.sh:13`
### c) 决策
- W2 插**守卫**而非改正则（保 D1023 三条硬不变量）⇒ 复用现有 10 处结构，不新建 detect。
- W3 判定体落**独立脚本**（可测 + 三态 + 逐条点名），job 只做接线。
- W9 只改**描述性注释**，判定逻辑零改动（`check-required-contexts.py` 本就无硬编码名单）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11（静默降级禁止）/ 铁律 47+48（契约 / 测试非空壳）/ 铁律 0-2（接线验收）。
- 判例 **V-08**（改坏即红 ⇒ 每条新判据必须给反例夹具）；**V-02**（禁 grep 作验收 ⇒ 全部判据走真跑）；
  **M-02**（三态 0/1/2，禁 `|| true`）；**M-03**（棘轮只减不增）；**V-05**（CI 快照必须终态）。
- 判例 **P-03**（断言不变性）⇒ 本件对 W2 给出**等价可测判据**（合并前不可测 main push ⇒ 不假装已验）。
- 决策参考：**第一性原理**（"跳过=成功"是通道问题，不是检查内容问题）+ **Anthropic 工程基线**
  （判据必须机器可跑、跳过=失败、红必须来自断言 ⇒ 与 CTO 三条地基规则逐条对齐）⇒ 结论 = 只改"何时跑"与"跳过算不算红"。

## Q2: 范围 — 正确的最简方案
做什么：
- .github/workflows/ci.yml — 10 处 detect step 加 push 守卫（4 行/处，逐字一致）
- .github/workflows/ci.yml — 新增 job `all-checks-passed`（`if: ${{ !cancelled() }}` + `needs:` 10 个 job）
- .github/workflows/ci.yml — W9 口径注释（两处断言句 + 两处史实引文加"现值 9"标注）
- .github/workflows/ci.yml — 登记两个新夹具进**两处**密封清单（必需腿 + windows 顾问腿）
- .github/workflows/product-progress.yml — W9 两处"12 个必需检查"改现值
- scripts/control-tower/aggregate-job-results.py — 新建（W3 判定体，三态 + fail-closed）
- scripts/control-tower/check-required-contexts.py — W9 注释口径（判定零改动）
- scripts/control-tower/ci-signal-classify.sh — W9 注释口径（代码零差异，已 diff 核）
- tests/control-tower/ci-docsonly-push-guard.test.sh — 新建（W2 判别夹具，含反例）
- tests/control-tower/aggregate-job-results.test.sh — 新建（W3 判别夹具，含反例）
- tests/control-tower/ci-signal-classify.test.sh — 登记 all-checks-passed 进 DOWNSTREAM_NEEDS_JOBS
- .claude/task-briefs/2026-10-06-D1166-govl-w-group-gates-w2-w3-w9.md
- memory/notes/proposed/2026-10-06-d1166-w2-w3-w9.md
- task-state/D1166.json
不做什么：
- 不改 .github/workflows/ci.yml 里任何既有 job 的 `name:`（12 必需 context 名的唯一产出者）
- 不改 docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh 的白名单正则（会破坏 struct-unique-1）
- 不改 scripts/pre-commit-check.sh（W6/W11 另笔）
- 不改 scripts/control-tower/required-checks-baseline.txt（"进必需名单" = 门禁语义变更，K3+CTO 后由有权者执行）
- 不碰 scripts/audit/**（K3 红线）；不加 `|| true` / `continue-on-error` / 不删密封清单项

## Q3: 验收 — 入口 → 交互 → 结果
入口：push 到 main（W2）/ 任何 CI run（W3）/ 一致性门禁调用（W9）
处理：detect step 先判事件名 ⇒ push 直接全量；聚合 job 汇总 needs 终态 ⇒ skipped 判 FAIL；口径注释对齐 live
结果：
- `SYNO_CI=1 bash docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` ⇒ 20 PASS / 0 FAIL
- `SYNO_CI=1 bash tests/control-tower/ci-docsonly-push-guard.test.sh` ⇒ 4 PASS / 0 FAIL
- `bash tests/control-tower/aggregate-job-results.test.sh` ⇒ 10 PASS / 0 FAIL
- `bash tests/control-tower/ci-signal-classify.test.sh` ⇒ 79 通过 / 0 失败
- `python3 scripts/control-tower/check-required-contexts.py --root .` ⇒ `REQUIRED-CONTEXTS: OK`
例外：W2 的"main push 真跑 npm ci"只有**合并后**可测 ⇒ 本件只给等价判据；W3 进必需名单不在本件。

## 架构层:
scripts（控制塔/门禁治理线）+ `.github/workflows/`（非产品五层）

## Done 标准
- [ ] verify: `SYNO_CI=1 bash docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` ⇒ 含 `RESULT: 20 PASS / 0 FAIL`
- [ ] verify: `SYNO_CI=1 bash tests/control-tower/ci-docsonly-push-guard.test.sh` ⇒ 含 `RESULT: 4 PASS / 0 FAIL`
- [ ] verify: `bash tests/control-tower/aggregate-job-results.test.sh` ⇒ 含 `RESULT: 10 PASS / 0 FAIL`
- [ ] verify: `python3 scripts/control-tower/check-required-contexts.py --root .` ⇒ 含 `REQUIRED-CONTEXTS: OK`
- [ ] verify: `grep -c 'all-checks-passed' .github/workflows/ci.yml` ⇒ 2
