# Task Brief: D374: DSH dev-doc 预设 + north-star-guard 技能 + install-dsh-preset 多预设扩展

> 生成: 2026-08-15 | 分支: feat/d374-dsh-devdoc-preset | as any: 0

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属于基础设施（控制塔 + DSH 协作体系，D336/D370 延伸），不触业务代码 L1-L5。
DSH 协作体系 = 预设（persona）+ 技能（.claude/.dsh skills）+ 落位脚本（install-dsh-preset）。
在已有 D370（并行会话已建 install/sync 脚本 + 8 技能 + 组 13 门禁）基础上：
① 升级 synova-dsh persona（补北星锚定 SOP⓪ + 证据链汇报 SOP⑧ + 🛠 前缀）
② 新建 synova-devdoc 预设（dev doc 撰写线程，📋 前缀）
③ 新建 north-star-guard 技能（北星对齐裁决，第 9 个流程技能）
④ 扩展 install-dsh-preset.sh 从单预设 → 注册表多预设（新增预设只加一行）

### b) 文件审计
- skills/（产品专家技能）与本任务无冲突；.claude/skills + .dsh/skills 已有 8 流程技能（D370），本任务新增第 9 个 north-star-guard。
- install-dsh-preset.sh 已存在（D370，单预设 synova-dsh），本任务扩展为注册表，不改其单预设语义与三态退出。
- 关系: 扩展（复用 D370 脚本，注册表加一行；不新建硬编码）。

### c) 决策
复用 D370 的 install/sync 脚本 + 组 13 门禁，扩展而非重写。参考：DeepSeek/第一性原理（最少机制：注册表加一行而非另写脚本）+ Anthropic（fail-closed 三态，绝不产出坏预设）——收敛。

## Q1: 调研 — 决策链 + 执行约束

### a) 决策链
① SPEC（Done 标准）→ ② 测试（install-dsh-preset.test.sh 25 用例，含新增 T11 devdoc）→ ③ 实现（persona 已起草 + DSH 方言 YAML 验证）→ ④ 接线（install-dsh-preset --check 已接线生产）→ ⑤ 验证（自检 5 问）。
引用铁律 0-2（spec→test→impl→wire→review→merge）、47/48（契约优先 + 测试非空壳）、46（迁移 grep 物理证明）。

### b) 执行约束
- rule: "新增预设必须在 install-dsh-preset.sh 注册表登记 + 测试覆盖"
  verify: "bash tests/control-tower/install-dsh-preset.test.sh"
- rule: "新增技能必须 .claude/skills（单源）→ sync-dsh-skills.sh 同步 → --check 一致"
  verify: "bash scripts/workflow/sync-dsh-skills.sh --check"

### c) 决策参考系
参考：DeepSeek/第一性原理（预设=角色线程容器，注册表加一行）+ Anthropic（fail-closed 三态）——收敛。

## Q2: 范围 — 正确的最简方案

做什么：
- scripts/control-tower/install-dsh-preset.sh
- tests/control-tower/install-dsh-preset.test.sh
- docs/synova/coordination/dsh-preset-draft/persona.md
- docs/synova/coordination/dsh-preset-draft/persona-block.yml
- docs/synova/coordination/dsh-preset-draft/preset.yml
- .claude/skills/north-star-guard/SKILL.md
- .dsh/skills/north-star-guard/SKILL.md
- docs/synova/coordination/dsh-devdoc-draft/persona.md
- docs/synova/coordination/dsh-devdoc-draft/persona-block.yml
- docs/synova/coordination/dsh-devdoc-draft/preset.yml
- docs/synova/coordination/dsh-devdoc-draft/north-star-guard-SKILL.md

不做什么：
- 不改 src/server.ts（及 src/ 下其他业务代码——独立任务）
- 不改 scripts/pre-commit-check.sh（组 13 已由 D370 落地）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：DSH 新会话选预设 / 运行 install-dsh-preset.sh
处理（中间经过哪些步骤）：预设 persona 加载 → 纪律生效；技能按需加载；落位脚本按注册表落位两预设
结果（最终展示在哪）：GUI 预设选择器出现 🛠 SynovaAgent 纪律模式 + 📋 dev-doc 撰写；install-dsh-preset --check 两预设均 SYNC-OK

## 架构层: 基础设施

#CRITERIA: A

## Done 标准
- [ ] bash tests/control-tower/install-dsh-preset.test.sh 全过（25 PASS 0 FAIL）
- [ ] bash scripts/workflow/sync-dsh-skills.sh --check 返回 exit 0
- [ ] bash -n scripts/control-tower/install-dsh-preset.sh 语法通过
