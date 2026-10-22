---
状态: proposed
日期: 2026-10-20
决策: 存量 48 份 task brief 按「只补兜底、不推断具体类」口径清理：缺 #CRITERIA 的统一补 D（criteria-code-map 的兜底类）＋逐份注记；Done 缺项补 `- [ ] … verify:`（有原文命令用原文，无则挂全量门禁）；Q2 缺路径的从该 brief 自身已引用路径补裸路径。
理由: #598 合入后 CI 的组 6 第一次真跑；存量 48 份不满足 check-brief-parseable（#CRITERIA 38／Done 27／Q2 9）。而"按路径推断具体 A/B/C"实测不可靠（266 份样本仅 41.7% 与作者声明一致）⇒ 只做有证据的补记，不造假。
---

# 决策 Note — #645 存量 brief 合规清理

## 现状（2026-10-20 实测）
- 480 份 brief：432 可解析／48 失败（#CRITERIA 38、Done 27、Q2 9，可叠加）。
- 在飞 open PR 的 8 份 brief 全 PASS；48 份含 3 份近件（617/620/609）与 4 份非日期 legacy。

## 决定
1. `#CRITERIA`：统一补 `D`（`.codex/criteria-code-map.json` 明写的兜底）＋注记 `历史件无单一归属证据`。**不**按路径推断 A/B/C（测量：41.7% 一致）。
2. Done：新增 42 项 `- [ ] … verify:`；有原文命令用原文（16 份），其余挂 `bash scripts/pre-commit-check.sh`（真实可跑）＋注记。
3. Q2：9 份全部从自身 Q2 段落提取路径，改 `做什么：` ＋裸路径逐行；0 例外。
4. 零删除行：只新增，# 与 Q1/Q3 语义零改动。

## 依据
- 规格：`.handbook/派单件/2026-10-20-规格-645-brief-cleanup.md`（sha256/16 `86e1e4b4b15ca0d0`）＋附件清单。
- 判据：`bash scripts/workflow/check-brief-parseable.sh` 全量 480/480；`git diff --numstat` 零删除；42/42 verify 可执行。

## 影响面
- 只动 `.claude/task-briefs/**`（48 份）＋本 Note；不动 gate/脚本/模板/契约。
- 后续新 brief 按 `.synova/skills/brief-compose/SKILL.md` 格式写即可过闸。
