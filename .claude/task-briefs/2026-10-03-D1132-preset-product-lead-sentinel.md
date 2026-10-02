#CRITERIA: A

# D1132：建 synova-product-lead + synova-sentinel 两个预设包 + sentinel-lifecycle skill

> 源：CTO 派单 Mac-CTO 2026-10-02（Issue #968）｜分支 feat/synova-product-lead-and-sentinel

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
工程组织域（CTO 域：岗位与载体），不在 L1-L5 产品代码层。现状实证：`/Users/wane/src/dsh-preset-bundles` 16 包中无 `synova-product-lead`；`.dsh/skills` 16 个中无哨兵专属 skill。本任务为二者建载体：两个 DSH 预设包（仓库外 bundle 源 + profile link 挂载）+ 一个哨兵专属 skill（本仓库内可 PR）。

### b) 文件审计
- `grep -rn "synova-product-lead\|synova-sentinel" /Users/wane/src/dsh-preset-bundles .claude/skills .dsh/skills` → 建前零命中（无覆盖，无冲突）。
- 模板载体：`/Users/wane/src/dsh-preset-bundles/synova-gov/cordis.patch.yml`（现役线负责人包真实形状：prefix 内嵌 + agent-instructions(65536) + skill-filesystem + tool-skill + delegation）。
- 挂载现状：`~/.dsh-trial-017/profiles/desktop/package.json` 的 `dependencies`（`link:`）与 `dsh.profile.bundles[]`。
- skill 单源：`.claude/skills` → `.dsh/skills`（D370，`scripts/workflow/sync-dsh-skills.sh`）。

### c) 决策
无覆盖 → 新建。两包源在仓库外（派单指定写集），skill 在仓库内双写。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

### a) 业界最佳实践
直接复用本机 DSH 已装预设的**现役实有形状**（零发明插件名）——照 synova-gov/cordis.patch.yml 裁剪；不引 DSH 依赖（G1 零命中，只学形状）。哨兵侧判据源＝院方《04-契约演进与机器可判性》§2.5 插件四问（加/接/生效/删干净）。
### b) Anthropic 决策链
规格先行（dev-doc-spec）→ 判据脚本先写 → 再落 manifest/包；自验独立（不由编码兼任）。
### c) memory 历史教训
铁律 0-2 接线验收；铁律 37 死代码（computes/ 孤儿文件）；铁律 48 测试非空壳（判据必须"改坏即红"）；CTO 判据纪律 ③（未现场复现的 N/M 不得引用）。
参考：Anthropic（规格先行 + 探针证据）/ DeepSeek（DSH 载体形状）/ 第一性原理（载体＝bundle 声明行，非目录）+ 结论：照现役形状裁剪，不新造机制。

## Q2: 范围 — 正确的最简方案

做什么:
- .claude/skills/sentinel-lifecycle/SKILL.md
- .dsh/skills/sentinel-lifecycle/SKILL.md
- .claude/task-briefs/2026-10-03-D1132-preset-product-lead-sentinel.md
- docs/synova/coordination/交付-D1132-两预设包与哨兵skill-20261003.md
- docs/authority/DOCS-REGISTRY.yaml
- 仓库外（派单指定写集，不在本 PR 内）: /Users/wane/src/dsh-preset-bundles/synova-product-lead/package.json 与 cordis.patch.yml
- 仓库外（同上）: /Users/wane/src/dsh-preset-bundles/synova-sentinel/package.json 与 cordis.patch.yml
- 仓库外（同上）: ~/.dsh-trial-017/profiles/desktop/package.json 加两行 bundles + 两行 link 依赖

不做什么（含文件路径）:
- 不改 scripts/audit/audit-runner.sh （以及 scripts/audit/ 其余，红线归 K3）
- 不改 .github/workflows/ci.yml
- 不改 scripts/pre-commit-check.sh
- 不改 /Users/wane/src/dsh-preset-bundles/synova-gov/cordis.patch.yml
- 不改 src/index.ts
- 不改 docs/synova/presets/synova-squad-lead/cordis.patch.yml

## Q3: 验收 — 入口 → 交互 → 结果

入口: 活 Host 的 preset 选择器（新会话选 synova-product-lead / synova-sentinel）；skill 由 tool-skill 按需 load。
处理: 空会话加载新包 → 跑【包四问】C-1~C-4（院方《空对话测试清单.md:19-26》）。
结果: L1 plugin_manager list_plugins 两行 fiberPhase=active；L2 cordis_inspect_query Config/listConfigs 两行 status=schema；组合导出 --dump-config exit 0 且含两行 preset row。

## Q4 契约与测试:

- sentinel-lifecycle 的一致性检查必须给**可复跑脚本 + 归一化口径**（不归一化误报 43/45；只认一种命名误报 27/45；双侧归一后真值 12/45，三次现场实测）。
- 判据必须「改坏即红」：删 manifest.computes[] 一项 → 检查器必报红 → 恢复回绿。
- D370：.claude/skills 与 .dsh/skills 逐字节一致，sync-dsh-skills.sh --check 须 SYNC-OK。
- 零 as any；零死代码残留。

## 架构层: 基础设施（工程组织域 / 预设载体与技能；不写产品代码，非 L1-L5）

## Done 标准

- [ ] verify: bash scripts/workflow/sync-dsh-skills.sh --check 输出含 SYNC-OK
- [ ] verify: diff -q .claude/skills/sentinel-lifecycle/SKILL.md .dsh/skills/sentinel-lifecycle/SKILL.md 无差异
- [ ] verify: 哨兵一致性脚本输出 active=45 mismatch=12/45（与改动前基线一致）
- [ ] verify: grep -c "插件四问\|包四问" .claude/skills/sentinel-lifecycle/SKILL.md 大于等于 2（术语消歧在册）
- [ ] verify: 活 Host plugin_manager list_plugins 含 include:preset-synova-product-lead 与 include:preset-synova-sentinel，均 fiberPhase=active
- [ ] verify: cordis_inspect_query Config/listConfigs name=@deepseek-ai/dsh-agent-preset 两行 status=schema
