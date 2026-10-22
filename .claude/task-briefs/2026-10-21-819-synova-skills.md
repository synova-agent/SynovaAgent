# Task Brief: P4 · #819 技能目录迁移

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- 技能源在 `.claude/skills`（25 个）；`scripts/workflow/sync-dsh-skills.sh` 同步到 `.dsh/skills`；组 13 以 --check 阻断漂移；65 个活文件引用旧路径。
- 相关件：`.synova/skills`（新源）｜`.dsh/skills`（生成物）｜`scripts/pre-commit-check.sh`（组 13）｜`AGENTS.md` 等活引用。

## Q1: 调研（决策链 / 既有基础）
- 裁 290/291；机械迁移（免 dev doc，卡面清单即规格）；不建软链（避免双源）。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- .synova/skills
- .dsh/skills
- scripts/ci/verify-d703.sh
- scripts/control-tower/install-dsh-preset.sh
- scripts/control-tower/synova-commit
- scripts/control-tower/weekly-selfcheck.sh
- scripts/pre-commit-check.sh
- scripts/workflow/sync-dsh-skills.sh
- .github/ci-criteria.txt
- docs/authority/DOCS-REGISTRY.yaml
- docs/synova/DOC-CONTRACT.md
- docs/synova/STATE.md
- AGENTS.md
- tests/control-tower/install-dsh-preset.test.sh
- tests/control-tower/pre-dispatch-check.test.sh
- tests/control-tower/precommit-groups-injection.test.sh
- tests/control-tower/sync-dsh-skills.test.sh
- tests/control-tower/fastlane-extended.test.sh
- tests/control-tower/doc-commit-exempt.test.sh
不做什么：
- .claude/task-briefs/**
- scripts/audit/**

## Q3: 验收（入口 → 交互 → 结果）
- 入口：`git grep -l '\\.claude/skills' -- ':!.claude/task-briefs/**'`；`bash scripts/workflow/sync-dsh-skills.sh --check`
- 交互：① 0 行｜② 25 一致｜③ 两技能 front-matter｜④ 12 组＋CI 双绿｜⑤ 旧路径不存在
- 结果：全过 + PR 独立复核。

## Q4: 契约与测试
- 组 13 源与检查同步改；sync 脚本 SRC 默认改；源缺失报迁移提示。

## 本任务在哪一层
- 治理线 / 技能源目录迁移；不涉产品运行时。

## Done 标准（至少一条可验证）
- [ ] git grep 0 → `verify: git grep -l '\\.claude/skills' -- ':!.claude/task-briefs/**'`
- [ ] --check 25 一致 → `verify: bash scripts/workflow/sync-dsh-skills.sh --check`
- [ ] 12 组绿 → `verify: bash scripts/pre-commit-check.sh`
