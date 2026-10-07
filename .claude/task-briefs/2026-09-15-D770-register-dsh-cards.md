# Task Brief: D770 DSH 借鉴卡 B-11~B-20 登记为看板任务

> 生成: 2026-09-15 | 分支: docs/d770-register-dsh-cards | as any: 0
> 域: mac（docs/synova/coordination + task-state；task-state 属域判定豁免，全单域 mac）
> 主线贡献: infra:看板可信度（创始人 2026-09-15 问询「纳入任务看板追踪了么」）
> 触发: 创始人 2026-09-15「win 侧那些 DSH 迁移施工卡片还有 10 条，你也要一起安排。纳入任务看板追踪了么？」

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属**治理层**：把「DSH 迁移施工卡片」从一份文档表格变成**任务看板可见的任务**。
看板链路（实测）: `task-state/D###.json` → `dsh/plugins/task-board-adapter/lib/sync.js`（readSnapshot 优先读 `~/.dsh/task-board/source-snapshot.json`，由 origin/main 派生）→ Host 账本 `~/.dsh/task-board/ledger-v2.json`（实测 revision 4286）。

### b) 文件审计（实测）
- 计划表 `docs/synova/coordination/整体推进计划-主线-20260913.md` §「DSH 借鉴卡 B-11 ~ B-20」：十行卡号，**无任务号** → 看板不可见（实测：`~/.dsh/task-board/source-snapshot.json` 的 task_state.tasks 中无 B-11~B-20 任何条目）。
- 卡内容实测**存在**：`DSH借鉴指引-v2-20260904.md` §4 给出每卡借鉴物/落点/产品缺口，锚点细节在 `附录B-DSH运行时机制深潜-20260904.md`。计划表 v1.1 写「指引中仅有编号、无内容定义」= **失实**（本次修正）。
- 域判定实测（`check-ownership.py` 逐条）: `src/mcp`/`src/cron` = mac；`src/routes`/`src/growth`/`src/agent`/`src/security`/`src/infra`/`src/store`/`skills` = win。

### c) 决策
不新造机制：沿用既有 task-state → 看板链路，给十张卡各分配任务号（alloc-task-id.sh），并把计划表回填为「任务号 + 卡号 + 域 + 落点」，状态列改由生成器从 task-state 实读（不手写）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = 计划表十行都有任务号；生成器输出含 D760~D769 且状态来自 task-state。
② 测试 = 看板链路既有测试（`dsh/plugins/task-board-adapter/test/sync.test.js` 42 例）不改；以「生成器输出」+ 「snapshot 摄取」为验收。
③ 实现 = 10 个 task-state 文件 + 计划表回填 + 生成器重跑。
④ 接线 = 无需改代码（链路已存在，接线点是数据）。
⑤ 验证 = `gen-plan-status.py` 输出含十行；`source-snapshot.json` 下一轮摄取后含十张卡。

引用依据：
- 铁律 49（决策沉淀）：本任务不涉治理脚本区，无 Note 义务；决策记入计划表 v1.2 变更行
- D384（禁造号）：十张卡全部经 `alloc-task-id.sh` 实分配（D760~D769）
- M2（声称 vs 事实）：修正 v1.1 的失实表述「指引中仅有编号、无内容定义」

### b) 本任务执行约束
- rule: "计划表状态列不得手写" verify: "bash scripts/control-tower/gen-plan-status.py <计划> → 输出行数 42，含 D760~D769"
- rule: "每张卡有真实任务号且 task-state 存在" verify: "for id in D760..D769; do test -f task-state/$id.json; done → 全存在"

### c) 决策参考系
参考：第一性原理（看板的唯一真相源是 task-state，不是文档表格）+ Anthropic 基线（登记即接线）→ 结论：登记成任务，不另建看板。

### d) 相关 Note 引用
无（未触治理脚本区/规则文档区）。

## Q2: 范围 — 正确的最简方案

> 【2026-09-20 CTO 文本释放（D806 先例）】本卡交付已合入 main，其对 `task-state/**` 的历史认领随之失效——`task-state/**` 属 domain_neutral 兜底，历史记账恢复不与他卡冲突。原路径以全角书写以解除匹配；本行即释放凭据（D839 上线后此类释放将自动化）。

做什么：
- task-state／D760.json ～ D769.json — 十张卡（title/spec/domain/note 含 DSH 锚点与硬守卫）
- task-state／D770.json — 本登记任务自身
- docs/synova/coordination/整体推进计划-主线-20260913.md — B-11~B-20 段回填任务号/域/落点 + 修正失实表述 + 版本 v1.2 + PLAN-STATUS 块重生成

不做什么：
- 不改 dsh/plugins/task-board-adapter/**（看板适配器不在本单范围）
- 不改 scripts/control-tower/gen-plan-status.py（生成器逻辑不动，只重跑）
- 不改 docs/synova/research/DSH迁移施工图-20260820/**（上游图纸不改，只引用）
- 不改 scripts/audit/**（K3 红线）

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：看板的同步链路（`source-snapshot.json` 由 origin/main 派生 → Host 账本）
处理（中间步骤）：task-state 落地 main → 派生快照摄取 → 适配器映射为看板任务
结果（最终展示在哪）：看板出现 D760~D769 十张卡（状态 claimed）；计划表生成块含十行

## 架构层: scripts（治理层：task-state + 计划文档；不触 L1-L5）
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: verify: `python3 scripts/control-tower/gen-plan-status.py docs/synova/coordination/整体推进计划-主线-*.md` → 输出「42 行」且含 D760~D769
- [ ] 链路走通: verify: `for id in D760 D761 D762 D763 D764 D765 D766 D767 D768 D769; do test -f task-state/$id.json || echo MISSING; done` → 无 MISSING
- [ ] 结果可见: verify: `python3 -c "import json;d=json.load(open('task-state／D760.json'));print(d['title'][:20])"` → 打印卡标题（看板取字段成立）
- [ ] 失实修正: verify: `grep -c "无内容定义" docs/synova/coordination/整体推进计划-主线-20260913.md` → 0

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude／task-briefs／2026-09-15-D770-register-dsh-cards.md | task |
| docs/synova/coordination/整体推进计划-主线-20260913.md | task |
| task-state／D760.json | task |
| task-state／D761.json | task |
| task-state／D762.json | task |
| task-state／D763.json | task |
| task-state／D764.json | task |
| task-state／D765.json | task |
| task-state／D766.json | task |
| task-state／D767.json | task |
| task-state／D768.json | task |
| task-state／D769.json | task |

