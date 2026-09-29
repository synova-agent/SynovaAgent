# Task Brief — D945 预设机制迁移（legacy 目录 → bundle 声明行）· 仓库侧收口

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L0 控制塔/D SH 运行态治理面，不动 src/**。目标：把「预设载体」从已作废的 `$DSH_HOME/.agent-presets/<id>/`（legacy 目录）迁到 **bundle 声明行**形态；运行时侧已由 2026-09-23 的迁移落地（实测 16 条 bundles、12 个 @local 预设已装），本卡做**仓库侧收口 + legacy 退役清单 + B3 夹具适配 + 一致性对账**。
### b) 文件审计（实测，2026-09-25 00:27 +0800）
- 上游判据：`packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md:70`「Nothing reads that directory any more」；`grep -rln "agent-presets" packages/*/src` = **0**
- 运行时：`profiles/desktop/package.json` `dsh.profile.bundles` 16 条（含 `@local/dsh-preset-synova-{cto,devdoc,dsh,k3-audit,squad-lead}`）；`node_modules/@local/*` 12 个已装
- **陈旧点（本卡必须点名）**：`dsh-preset-synova-squad-lead/cordis.patch.yml`（21526 B, Sep 23 02:07）含 `delegation`、`agent-team` 命中 **False**；而 legacy 源 `~/.dsh-trial-017/.agent-presets/synova-squad-lead/agent.cordis.yml`（ce80a3da…）**含 `- id: agent-team`、无 `- id: delegation`**（delegation 仅出现在注释 :193/:198）
- 仓库侧 legacy 载体：`scripts/control-tower/install-dsh-preset.sh`、`docs/synova/presets/install-squad-lead.sh`、`docs/synova/coordination/dsh-preset-draft/**`、`docs/synova/presets/synova-squad-lead/{SYSTEM-PROMPT.md,preset.yml}`
- B3 夹具依赖点：`:23-24`（INSTALL/DRAFT 路径）、`:66-68`（T1 installed agent.cordis.yml）、`:89-94`（T3/T3b）、`:129-133`（T9/T10 探测 `config/agent-presets/standard/**` = legacy 布局）、`:150-151`（T8 锚 `dsh-preset-draft/persona-block.yml`）
### c) 决策
不删 legacy（bundle 陈旧，legacy 为正确源）；仓库侧补 bundle 源 + 校验/生成脚本 + 安装器改道 + 夹具适配 + 对账。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 第一性原理：**载体退役必须"新载体先验证、旧载体后移除"**（否则回退无路）——本卡据此只出清单+备份+退役时点条件。
- Anthropic 工程基线：判据必须可执行且三分（正常/降级/边界），变异体"改坏即红"；V5 平台敏感命令须用 PYBIN 探针。
- memory 历史：D313 M5（Windows UTF-8/编码）、D516「登记后必须等 CI 真跑通」、D931（预设副本漂移 = 迁移落地≠内容最新）、D937 组 7a（方言相关 fail-open）、M9 棘轮（跨平台判定陷阱）。
- 参考：Anthropic/第一性原理 + 结论=「仓库为源 + bundle 为投递面 + 一致性对账兜住漂移」。

## Q2: 范围 — 正确的最简方案
做什么（逐条精确路径）：
- docs/synova/presets/synova-squad-lead/package.json — 新：bundle 声明（`dsh.bundle.patch`）
- docs/synova/presets/synova-squad-lead/cordis.patch.yml — 新：由 legacy 源生成的声明行（含 agent-team，无 `- id: delegation`）
- scripts/control-tower/check-preset-bundles.sh — 新：仓库侧校验 + 运行时一致性对账 + `--emit` 生成（V5 合规）
- tests/control-tower/check-preset-bundles.test.sh — 新夹具（含 M1–M4 变异）
- scripts/control-tower/install-dsh-preset.sh — 改：安装器改走 bundle 层，legacy 仅打印废弃提示（不再默认写 `.agent-presets/`）
- docs/synova/presets/install-squad-lead.sh — 改：同上
- tests/control-tower/install-dsh-preset.test.sh — 改：T8/T9/T10/T11 载体假设随迁移重写（T3/T3c 承重、T3b 负控标注保持）
- .github/workflows/ci.yml — 改：canary 密封清单登记新夹具（+1 行）
- docs/synova/product-lines/evidence/D945-preset-bundle/legacy-inventory.md — 新：两处 home × synova-* 清单+哈希+tar 备份+退役时点
- docs/synova/product-lines/evidence/D945-preset-bundle/consistency-report.md — 新：bundle↔仓库源一致/陈旧清单（点 name agent-team 缺失）
- .claude/task-briefs/2026-09-25-D945-preset-bundle-migration.md — 本 brief
- task-state/D945.json — 卡（write_set 含本 brief 路径）
- memory/notes/proposed/2026-09-25-d945-preset-bundle-migration.md — 决策 Note
- tests/control-tower/precommit-groups-injection.test.sh — 改：M9 注入夹具 b 面残留基线 7→8（登记本卡新增的 cordis.patch.yml 命中）+ 脆弱性升级为 P2-2 待办（本卡 CI 红修复所需）

不做什么（含文件路径）：
- 不删 legacy 目录（`~/.dsh/.agent-presets/synova-*`、`~/.dsh-trial-017/.agent-presets/synova-*`）
- 不改 docs/synova/coordination/ownership.yaml（热点，CTO 单写者）
- 不改 profiles/desktop/cordis.patch.yml（运行中桌面端会改写）
- 不碰 scripts/audit/**、docs/synova/audit-reports/**、src/**

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/control-tower/check-preset-bundles.sh [--repo|--consistency|--emit]`
处理：读仓库 bundle 源 + 读运行时 `profiles/desktop/{package.json,node_modules/@local/*}` + 读 legacy 源
结果：三态输出（0 正常 / 1 违规 / 2 降级）；一致性报告点名陈旧项；legacy 在场或复活 → 判红

## 架构层: 基础设施

## Done 标准
- [ ] verify: bash scripts/control-tower/check-preset-bundles.sh --repo → 0
- [ ] verify: bash tests/control-tower/check-preset-bundles.test.sh → 0（含 M1–M4 变异必红）
- [ ] verify: bash tests/control-tower/install-dsh-preset.test.sh → rc=0（T3/T3c 承重、T3b 负控标注在）
- [ ] verify: bash scripts/control-tower/check-pr-budget.sh → PASS（≤12 文件、单域 mac）
- [ ] verify: grep -c "agent-team" docs/synova/presets/synova-squad-lead/cordis.patch.yml ≥1 且 grep -c "id: delegation" = 0
