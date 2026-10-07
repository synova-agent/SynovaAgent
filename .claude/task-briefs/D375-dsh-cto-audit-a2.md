# Task Brief: D375: DSH 审计+CTO 预设 + A2 机器验证接线

> 生成: 2026-08-16 | 分支: feat/d374-dsh-devdoc-preset | as any: 0

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属基础设施（DSH 控制体系，D336/D370/D374 延伸），不触产品业务代码 L1-L5。
在 D374（dev-doc 预设 + north-star-guard + install-dsh-preset 多预设）基础上：
① 新建 synova-k3-audit 预设（零上下文独立审计，脑=Kimi K3，极简工具）
② 新建 synova-cto 预设（CTO 运营岗位，标准基座 + tool-cordis）+ cto-handover 交接技能
③ 接线 A2（机器验证入库）：CI vitest 全绿 → evidence-writer 写证据

### b) 文件审计
- .claude/skills + .dsh/skills 已有 9 技能（D374），本任务新增第 10 个 cto-handover
- scripts/product-lines/ 已有 8 脚本（D371），本任务新增 list-test-points.py（A2 的 --points 源）
- .github/workflows/product-progress.yml 已存在（D371-D373），本任务加 A2 步骤
- 关系: 扩展（复用已有预设/技能/脚本体系，不新建硬编码）

### c) 决策
复用 D374 预设模式 + D371 脚本体系；审计预设极简（砍编排联网，DeepSeek 最少机制）+ CTO 预设标准基座+tool-cordis（cordis 基座加载失败已绕开）。参考：DeepSeek/第一性原理（最少机制）+ Anthropic（fail-closed 不写假绿证据）——收敛。

## Q1: 调研 — 决策链 + 执行约束

### a) 决策链
① SPEC（Done 标准）→ ② 测试（install-dsh-preset 已有 25 用例；本任务新增脚本需配测试）→ ③ 实现（预设 persona 已起草 + DSH 方言 YAML 验证）→ ④ 接线（A2 接入 product-progress.yml CI）→ ⑤ 验证（自检 5 问）。
引用铁律 0-2/47/48 + 台账 M3（机制建成未接线——A2 evidence-writer 本是 D371 建好未接线，本任务补）。

### b) 执行约束
- rule: "新增预设必须在 install-dsh-preset.sh 注册表登记 + 测试覆盖"
  verify: "bash tests/control-tower/install-dsh-preset.test.sh"
- rule: "新增技能必须 .claude/skills（单源）→ sync-dsh-skills.sh → --check 一致"
  verify: "bash scripts/workflow/sync-dsh-skills.sh --check"

### c) 决策参考系
参考：DeepSeek/第一性原理（预设=角色容器，审计极简）+ Anthropic（fail-closed 三态、A2 不写假绿证据）——收敛。

## Q2: 范围 — 正确的最简方案

做什么：
- .github/workflows/product-progress.yml
- scripts/product-lines/list-test-points.py
- .claude/skills/cto-handover/SKILL.md
- .dsh/skills/cto-handover/SKILL.md
- docs/synova/coordination/dsh-audit-draft/persona.md
- docs/synova/coordination/dsh-audit-draft/preset.yml
- docs/synova/coordination/dsh-audit-draft/agent.cordis.yml
- docs/synova/coordination/dsh-audit-draft/README.md
- docs/synova/coordination/dsh-cto-draft/persona.md
- docs/synova/coordination/dsh-cto-draft/preset.yml
- docs/synova/coordination/dsh-cto-draft/agent.cordis.yml
- docs/synova/coordination/dsh-cto-draft/cto-handover-SKILL.md
- docs/synova/product-lines/product-progress.html
- docs/synova/product-lines/todos.yaml

不做什么：
- 不改 src/server.ts（及 src/ 下其他业务代码——独立任务）
- 不改 scripts/audit/（K3 专属红线）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：DSH 新会话选预设 / CI push main 或周五 cron
处理（中间经过哪些步骤）：预设 persona 加载生效；CI vitest 绿 → 证据入库 → 进度重算
结果（最终展示在哪）：GUI 预设选择器出现 🔍 审计 + 🧭 CTO；26 线进度页由 CI 自动更新

## 架构层: 基础设施

#CRITERIA: A

## Done 标准
- [ ] bash scripts/workflow/sync-dsh-skills.sh --check 返回 exit 0
- [ ] python3 -c "import ast; ast.parse(open('scripts/product-lines/list-test-points.py').read())" 语法通过
- [ ] bash -n scripts/product-lines/refresh-all.sh 语法通过
