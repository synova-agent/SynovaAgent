# Task Brief: D1177 govl-registry-selfcheck

> 生成: 2026-10-06 | 任务: D1177 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=已交付 ｜ 施工批次=第4批-文档 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=等创始人裁
> 派单源: CTO《开发计划 v2》第四批 **D2**（登记门禁只做 substring，从不校验 path 存在）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
文档契约层（`scripts/doc-system/` + `docs/authority/`），非产品五层。
治的是「**台账自己不自洽，而门禁只查别人登记没登记**」。
### b) 文件审计（**先复核前提，不靠上轮记忆**）
- `scripts/doc-system/doc-registry-gate.sh` 91 行；grep `unique|唯一|duplicate|exists|存在|test -e` ⇒ **零命中**（只有 `-f "$REGISTRY"`）⇒ 前提成立
- 台账实测：59 条目 / **57 唯一 ID** ⇒ **2 个重复**（`DOC-0124`/`DOC-0125`，在 `:285/:291` 与 `:320/:326` **各出现一次**）
- 仓内相对 path 52 条 ⇒ **3 条不存在**：`WORKLOG-*.md`（**glob**，实际有文件）+ 2 条 `status: draft` 的规划文档
### c) 决策
给门禁补 **ID 唯一（硬）** + **path 存在（只查仓内相对路径；glob 先展开；draft 悬空显式 SKIP）**；
并**在本卡内把存量修掉**（2 个重复 ID 改号 0188/0189）⇒ 从第 1 天起就是绿的，**不新开豁免表**（棘轮只减不增）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 35（自动化优先）；判例 **V-08**（改坏即红）、**M-02**（三态）、**M-03**（棘轮只减不增）、**V-02**（真跑）。
- **D734 的教训刻意避开**：若 path 存在性检查把存量债一次性转红，就与"清理存量"目标相反。
  ⇒ 先**实测存量规模**（52 条里只有 3 条，其中 2 条是 draft、1 条是 glob）⇒ 规模可控 ⇒ **直接修掉，而不是开豁免表**。
- 决策参考：**第一性原理**（契约件先得自洽，再谈"别人登记没登记"）+ **开源实证**（schema 校验器总先校自身完整性）⇒ 结论 = 补自洽检查 + 同卡修存量。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/doc-system/doc-registry-gate.sh
- docs/authority/DOCS-REGISTRY.yaml
- tests/doc-system/doc-registry-selfcheck.test.sh
- .claude/task-briefs/2026-10-06-D1177-govl-registry-selfcheck.md
- memory/notes/proposed/2026-10-06-d1177-registry-selfcheck.md
- task-state/D1177.json
不做什么：
- 不改 .github/workflows/ci.yml（接线/必需 context 属"改哪条检查阻断合并" ⇒ 提案→K3→CTO）
- 不改 .github/workflows/product-progress.yml
- 不改 scripts/control-tower/check-pr-budget.sh
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/audit/check-audit-consistency.sh
- 不改 scripts/ci/verify-doc.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/doc-system/doc-registry-gate.sh`（pre-commit / CI 内已调用）
处理：登记判定（原有）+ **台账自洽**：ID 唯一 → path 存在（绝对/~ /盘符跳过；glob 展开；draft 悬空显式 SKIP）
结果：逐条 `✅/⏭️/❌` + 汇总；exit 0/1
- `bash tests/doc-system/doc-registry-selfcheck.test.sh` ⇒ `RESULT: 10 PASS / 0 FAIL`
- `bash tests/doc-system/doc-registry-gate.test.sh` ⇒ `18 通过 / 0 失败`（**无回归**）

## 架构层:
文档契约层 + scripts/doc-system（非产品五层）

## Done 标准
- [ ] verify: `bash tests/doc-system/doc-registry-selfcheck.test.sh` ⇒ 含 `RESULT: 10 PASS / 0 FAIL`
- [ ] verify: `bash scripts/doc-system/doc-registry-gate.sh; echo $?` ⇒ 0
- [ ] verify: `bash tests/doc-system/doc-registry-gate.test.sh` ⇒ 含 `18 通过 / 0 失败`
- [ ] verify: `grep -c 'DOC-0124' docs/authority/DOCS-REGISTRY.yaml` ⇒ 1（改号后唯一一处）
