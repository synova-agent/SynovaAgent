---
状态: implemented
日期: 2026-10-21
决策: 技能源目录从 `.claude/skills` 迁到 `.synova/skills`（25 技能整体 git mv）；同步脚本/组 13/活引用同步改；`.dsh/skills` 由脚本重新生成；不建软链、不保留旧目录。
理由: 裁 290/291——`.claude/` 是 Claude Code 遗留域，技能源迁入 Synova 自有目录，避免"工具域"与"产品域"混淆；双源软链会留回退路径，故不建。
---

# 决策 Note — #819 技能目录迁移

## 现状（迁移前）
- 25 个技能在 `.claude/skills/`；`scripts/workflow/sync-dsh-skills.sh` 以它为源同步到 `.dsh/skills/`；组 13 以 `--check` 阻断漂移；65 个活文件引用旧路径。

## 决定
- `git mv .claude/skills .synova/skills`（25 技能；旧目录不保留、不建软链）。
- `sync-dsh-skills.sh`：SRC 默认 `.synova/skills`；源缺失时报「已迁移到 .synova/skills」。
- 组 13/活引用：`.claude/skills` → `.synova/skills`（**不动** `.claude/task-briefs/**` 历史件）。
- `.dsh/skills` 由同步脚本重新生成（25）；受保护路径走豁免（裁 290）＋DOC 登记。

## 依据
- 裁 290/291；判据 ①–⑤（git grep 0／`--check` 25 一致／两技能 front-matter 可读／12 组＋CI 双绿／旧路径不存在）。

## 影响面
- 技能内容零改动；产品代码/`scripts/audit/**` 未碰；历史 task-briefs 未重写。
