---
状态: proposed
日期: 2026-09-26
决策: task-26 并入 2b 后，#803 候选分支的 4 个「已发布但坏」文件（提交进 80ce4ec6 的**未解冲突标记**）一律取 2b 已解内容修复；Q2/写集声明按实测变更集重算为 **85 = 24A+26D+35M**，双向差须为 0（禁单侧配平）。
理由: (1) 冲突标记使文件在 bash 层不可解析（`syntax error near unexpected token '<<<'`），CI `control-tower-tests` 必红 —— 这是「不可运行的合并残留」，不是断言取舍，故修复不属于「改/删断言」红线；(2) 4 件全部只在 80ce4ec6 出现（main=0 / 2b=0），根因是发布路径把未解冲突一并提交，属发布动作缺陷；(3) 写集声明只压「变更集 − 声明集」单侧会留下声明虚条（D708 实测 7 件夹带 + 2 件多余），故必须双向对账。
---

# D962 task-26：未解冲突标记修复 + 写集双向对账

## 触发场景（实测，非推测）

在合并 `origin/main@ee721b0a` 到 2b、再把 2b 并入 `feat/d962-2a-merge`（#803）后，对合并结果做全树扫描：

```bash
git grep -n -E '^(<<<<<<< |>>>>>>> )' HEAD -- .
```

命中 4 件（跨修订计数：main / 80ce4ec6（发布态）/ 2b / 合并态）：

| 文件 | main | 80ce4ec6 | 2b | 合并态 |
|---|---|---|---|---|
| `scripts/workflow/loop-score.sh` | 0 | 2 | 0 | 2 |
| `tests/control-tower/g10-cp3.test.sh` | 0 | 4 | 0 | 4 |
| `tests/control-tower/g9-contract.test.sh` | 0 | 4 | 0 | 4 |
| `tests/control-tower/grep-oP-regression.test.sh` | 0 | 4 | 0 | 4 |

⇒ **标记是 80ce4ec6 独有**：发布动作把未解冲突提交进了候选分支（main 与 2b 均为 0）。

## 决策内容

1. **四件取 2b 已解内容**（逐文件 sha256 与 `176d2e06:<path>` 逐字节一致）：
   - `tests/control-tower/grep-oP-regression.test.sh`（2b 侧同时移除 4 条指向**已退役文件/已消失模式**的条目 —— 用 `eq()` 自带接线守卫实测：`[0-9]{4}-[0-9]{2}-[0-9]{2} ∉ pre-commit`、`^[^:]+ ∉ pre-commit`、`scripts/check-tech-debt.sh` 不存在、`scripts/checks/check-test-quality.sh` 不存在；保留的 3 条真身条目守卫全 PASS）
   - `tests/control-tower/g9-contract.test.sh` / `g10-cp3.test.sh`（2b 侧 = 冲突的 V5.3 侧内容，语句集合与 2b 逐条相同：0 多 0 少）
   - `scripts/workflow/loop-score.sh`（ours 侧仅「两版注释 + 标记」，2b 侧保留 1 行）
2. **写集双向对账**：声明源 = `.claude/task-briefs/2026-09-25-D962-2a1-precommit.md` Q2（D708 的 S3）+ `task-state/D962.json#write_set`（S1），重算为 `git diff --name-status origin/main..HEAD` 的实测集合，两个方向都必须为 0：
   - 方向 A（变更 − 声明，夹带）= 0
   - 方向 B（声明 − 变更，虚声明）= 0
   - 移除的 2 条虚声明：`.claude/task-briefs/2026-09-25-D956-ci-failmsg.md`、`task-state/D956.json`（已随 PR #804 入 main ⇒ 本 PR 不再变更它们）
3. **本 Note 亦入声明集**（自指）：新增文件必须同时出现在声明里，否则下一轮 D708 立刻判夹带。

## 未清项（转 CTO）

- **D708 的 S1 形同虚设**：`merge_writeset_gate.py:249` 要求 `write_set` 为 **list**，而本仓 `task-state/*.json` 惯例是 `{added,deleted,modified}` **对象** ⇒ S1 恒空，声明实际只靠 S3 brief（本机实测输出 84 条声明**全部**标 `S3:brief.Q2-include`，0 条 S1）。闸门「最高优先级源」未生效。
- **流程建议（本次事故教训）**：发布/推送前应做**全树冲突标记扫描**（`git grep -E '^(<<<<<<< |>>>>>>> )'`）作为推送前置必跑项 —— 现有门禁（pre-commit 13 组 / CI）无一抓得到「标记已提交」这一形态，只能等测试在 bash 层语法失败。
- 2b 分支真 CI 运行（`36163888180` @7fe06f33 / `36163463614` @0d22dbab）：`Iron Laws (gate semantics)` = **success**；`TypeScript + Lint + Iron Laws` 失败步骤 = `Merge write-set reconciliation (D708)`（本 Note 第 2 条即其修复）。
