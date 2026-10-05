<!--
  SYNOVA-RESEARCH-控制塔完整升级方案-v3-FINAL-20260729
  状态: 开发执行文档——Claude Code 唯一依据
  依赖: 控制塔Ch1-7, 控制塔Graph升级v2, 权威文档17自诊断系统, 权威文档15循环, AGENTS.md V4.5.0
  目标: 控制塔从"6组件健康检查"升级为"五视图项目操作系统"——一次构建, 不再分散
  优先级: P0=流水线健康度, P1=PM仪表盘+系统完成度, P2=工作流图+Agent链路
-->

# 控制塔完整升级方案：五视图项目操作系统

> 2026-07-29 | 合并 Graph升级v2 + 自诊断v3 + 流水线健康度 → 单一执行文档
> 开发 session 的唯一执行依据——不再需要参考多份分散文档

---

## 零、目标状态

### 0.1 控制塔应该是什么

控制塔不是"监控工具"——是**创始人的项目操作系统**。你打开它看到的第一个画面应该回答一个问题："现在项目在正轨上吗？"

升级后的控制塔有**五个视图**，按优先级排列：

| # | 视图 | 回答的问题 | 目标用户 | 数据来源 |
|:---:|------|----------|---------|---------|
| 1 | **流水线健康度** | Agent 之间的交接有没有出问题？有没有偏离在扩散？ | 创始人——每次打开控制塔的第一个画面 | 四个检查点自动对齐结果 |
| 2 | **PM 仪表盘** | 离客户A部署还有多远？四个条件各完成了多少？ | 创始人+GA——项目进度评估 | 门禁+任务完成度+条件归属 |
| 3 | **系统完成度** | 每一个模块/函数/任务的六条件得分是多少？和上周比变好了还是变差了？ | 创始人——版本化趋势追踪 | .codex/snapshots/ 快照目录 |
| 4 | **工作流图** | 开发流程的哪个环节在卡？哪个组件的队列最长？ | Dev Doc Agent——流程优化 | 依赖图+信号文件 |
| 5 | **Agent 链路健康** | 三个 Agent 之间的协作效率如何？信息在哪一步衰减最快？ | Dev Doc Agent——Agent 质量改进 | git log+task briefs |

原来的 6 组件信号卡片不消失——信息合并到视图 4（工作流图）的节点悬停详情中。门禁面板合并到视图 2（PM 仪表盘）的条件分组中。

### 0.2 五个视图的数据流

五个视图共享同一份底层数据——不需要五种数据源：

```
.codex/snapshots/{timestamp}/     ← 快照目录 (每次check-gates-v2.py运行产出一个)
  gate-status.json                ← 17门禁实时状态
  completion-scores.json          ← 六条件完成度矩阵
  dependency-graph.json           ← 全量依赖图
  deviation-report.json           ← 偏差清单

.codex/signals/                   ← 信号文件 (10个组件实时状态)
  gatekeeper.json, external-auditor.json, ...

git log + task briefs             ← 任务流转数据
权威文档 + AGENTS.md              ← 预期状态模型 (基准构建后产出的JSON)
```

三个视图从快照目录消费数据，一个视图从信号文件消费数据，一个视图从 git log 消费数据。

---

## 一、视图一：流水线健康度 [P0——最先构建]

### 1.1 它解决什么问题

你的流水线有四个 Agent：Research → Dev Doc → Claude Code → 审计。每个交接点都可能发生信息衰减。你作为创始人没有技术背景来发现每一次衰减。流水线健康度自动检查四个交接点，告诉你"现在哪个交接点需要你的决策"。

### 1.2 四个检查点

| 检查点 | 嵌入位置 | 复用 | 检查内容 |
|:---:|------|------|---------|
| CP1 | 研究产出后——hook-block-write.sh 新增条件归属验证 | PreToolUse hook (已有) | 研究文档是否声明了条件归属(A/B/C/D)？该条件下可自动验证的结论占比？ |
| CP2 | Dev Doc 产出后——pre-doc-audit.sh 扩展 | 已有脚本 | task brief 条件归属是否缺失？验收标准是否覆盖该条件的端到端路径？引用的权威文档章节是否存在？ |
| CP3 | Claude Code 提交后——pre-commit-check.sh 新增第10组(条件区域检查)+第11组(测试覆盖检查) | 已有脚本 | 提交文件是否在声明的条件代码区域内？测试是否覆盖端到端路径？ |
| CP4 | 审计完成后——check-gates-v2.py 扩展 | 已有脚本 | 审计前后门禁状态是否有变动？变动影响了哪个条件？ |

### 1.3 你看到什么——三行摘要

```
Research Agent: ✅  16/17 文档已声明条件归属。D16 缺失——已标记。

Dev Doc Agent:  ⚠️  3 个 task brief 条件未声明——系统推断归属已标注。
                    2 个验收标准缺端到端路径——Claude Code 仍可启动但风险提示。

Claude Code:    ❌  D225 提交了跨条件代码(条件A任务修改了expert-autonomy.ts)——需确认意图。
                    [确认这是意图] [退回修改]
```

### 1.4 构建内容

| 步骤 | 文件 | 改动 |
|:---:|------|------|
| 0.0 | task brief 模板 + `.codex/criteria-code-map.json` | **P0 前置**——(a) task brief 模板增加 `#CRITERIA` 必填字段；(b) 创建条件代码区域映射表JSON；(c) CP1 hook 逻辑降级——无 `#CRITERIA` 字段时标记 pending 而非阻断 |
| 1.2 | `scripts/pre-doc-audit.sh` | 扩展：验证 task brief 条件归属 + 验收标准的端到端覆盖 + 文档引用有效性 |
| 1.3 | `scripts/pre-commit-check.sh` | 新增第10组(条件区域检查)：提交文件 vs 条件代码区域映射表；新增第11组(测试覆盖检查)：测试文件 vs 验收标准的端到端路径 |
| 1.4 | `scripts/audit/check-gates-v2.py` | 扩展：门禁状态变动→条件完成度联动 |
| 1.5 | `scripts/control-tower/generate-dashboard.py` | 新增三行摘要视图——读取四个检查点的输出JSON, 渲染摘要 |

### 1.5 条件代码区域映射表

CP3 需要的映射表——定义每个条件的代码区域：

```
条件 A (部署独立): src/routes/enterprise.ts, src/middleware/auth.ts, src/middleware/rbac.ts,
                  app/admin.html, app/js/admin.js, app/css/admin.css,
                  src/growth/user-store.ts, electron-main.ts, scripts/install.*, scripts/setup.*

条件 B (诊断自主): src/sentinel/**, src/l3/**, src/l2/**, src/agent/diagnosis-launcher.ts,
                  src/loops/loop-scheduler.ts, src/routes/chat.ts, src/agent/conversation-engine.ts,
                  expert/**, src/agent/expert-file-loader.ts

条件 D (持续运行): src/loops/**, src/cron/**, src/store/session-store.ts,
                  src/services/restart-recovery.ts, src/services/graceful-shutdown.ts,
                  src/sentinel/runner.ts, src/agent/synova-agent.ts,
                  scripts/control-tower/synova-commit, scripts/pre-commit-check.sh

条件 C (结论有用): expert/** 的 PROMPT.md/RULES.md/THEORY.md,
                  extensions/ontology/edge-types/**, src/l4/knowledge-store.ts,
                  src/growth/knowledge-feedback.ts, src/growth/goal-lifecycle.ts
                  注: 条件C的完成度在GA验证之前是手动标记的——代码区域仅用于代码层面的覆盖检测
```

---

## 二、视图二：PM 仪表盘 [P1]

### 2.1 它解决什么问题

17 门禁是"功能有没有"——但不是"产品能不能用"。PM 仪表盘把 17 门禁按四个条件（A/B/C/D）重新分组，每个条件显示完成百分比。

### 2.2 你看到什么

```
条件 A (部署独立)    ████████░░  78%  Gate 1/2/16 通过 | 剩余: 启动配置页, 首次引导
条件 B (诊断自主)    ██████░░░░  62%  Gate 3/5/7/8 通过 | 剩余: 专家体系旧→新迁移
条件 C (结论有用)    ⚪ 待GA验证  上次验证: 7天前 | 当前诊断报告待GA审查
条件 D (持续运行)    ███████░░░  71%  Gate 12/13 通过 | 剩余: 长期运行验证
```

### 2.3 构建内容

| 步骤 | 文件 | 改动 |
|:---:|------|------|
| 2.1 | `check-gates-v2.py` | 扩展：门禁按条件分组——在 gate-status.json 中增加 `criteria_group` 字段 |
| 2.2 | `generate-dashboard.py` | 新增 PM 仪表盘视图——按条件分组的完成度百分比 + 每个条件的剩余任务列表 |
| 2.3 | task brief 模板 | 新增 `#CRITERIA` 必填字段（取值 A/B/C/D）——PreToolUse hook 验证 |

---

## 三、视图三：系统完成度 [P1]

### 3.1 它解决什么问题

几百个 D# 任务完成了——但哪些是"真正完成"的（六条件全部满足）？哪些是"表面完成"的（代码存在但接线断裂）？系统完成度用六条件自动判定每个任务的实际状态，产出趋势数据。

### 3.2 六条件判定引擎

每个任务的六个条件自动判定——代码存在、接线完整、测试存在、路径可达、依赖可用、无已知缺陷。判定引擎在每次 `check-gates-v2.py` 运行时执行，结果写入 `completion-scores.json`。

### 3.3 版本化快照

每次运行不覆盖历史数据——创建新的 `.codex/snapshots/{timestamp}/` 目录。趋势 = 两个快照的 diff。30 天每日 + 90 天每周 + 归档。本地设备离线时启动补跑。

### 3.4 构建内容

| 步骤 | 文件 | 改动 |
|:---:|------|------|
| 3.1 | `scripts/audit/completion-engine.py` | **新建**——六条件判定引擎 |
| 3.2 | `check-gates-v2.py` | 扩展：write_report 改为写入 `snapshots/{timestamp}/` 而非覆盖 `.codex/signals/` |
| 3.3 | `scripts/cron/snapshot-cleanup.sh` | **新建**——快照生命周期管理 |
| 3.4 | `generate-dashboard.py` | 新增系统完成度视图——时间轴滑块+差异模式+30天趋势线(基线内实线+含扩展虚线)+偏差生命周期面板 |
| 3.5 | `emit-signal.py` | 扩展：信号Schema增加 `completion_score` + `deviation_list` 字段 |

---

## 四、视图四：工作流图 [P2]

### 4.1 它解决什么问题

开发流程是一张图——Task Brief → Context Injector → Agent Work → Gatekeeper → Auditor。每个 task 是游走的 token。节点颜色 = 实时信号状态，节点大小 = 当前队列长度，边粗细 = 24h 流量，边样式 = HealthState 得分。

### 4.2 构建内容（从 Graph 升级 v2 方案移植）

| 步骤 | 文件 | 改动 |
|:---:|------|------|
| 4.1 | `scripts/control-tower/graph-builder.py` | **新建**——从 git log+task briefs+signal files 构建工作流图 |
| 4.2 | `generate-dashboard.py` | 新增工作流图视图——交互式节点图+HealthState判定(实线/点线/虚线)+悬停信息 |

---

## 五、视图五：Agent 链路健康 [P2]

### 5.1 它解决什么问题

三个 Agent 之间的协作效率——Research→Dev Doc→Claude Code 每一步的信息衰减、流转延迟、转化率。

### 5.2 构建内容（从 Graph 升级 v2 方案移植）

| 步骤 | 文件 | 改动 |
|:---:|------|------|
| 5.1 | 数据源：复用 graph-builder.py 的依赖图+git log | — |
| 5.2 | `generate-dashboard.py` | 新增 Agent 链路健康视图——每条 Agent→Agent 边的衰减检测 |

---

## 六、基础设施改造

### 6.1 视图架构：独立 Python 模块，避免合并冲突

P0/P1/P2 三个阶段都涉及仪表盘变更。如果五个视图全写在 `generate-dashboard.py` 一个文件里——三个 session 并行时必然冲突。

**每个视图作为独立 Python 模块，generate-dashboard.py 只做导入和路由：**

```
scripts/control-tower/
  generate-dashboard.py          # 只做: import views.* + 路由分发
  views/
    pipeline_health.py           # 视图1: 流水线健康度(三行摘要) [P0]
    pm_dashboard.py              # 视图2: PM仪表盘(条件进度) [P1]
    completion.py                # 视图3: 系统完成度(时间轴+趋势) [P1]
    workflow_graph.py            # 视图4: 工作流图(节点图) [P2]
    agent_health.py              # 视图5: Agent链路健康(衰减) [P2]
```

`generate-dashboard.py` 的 `render_html()` 函数改为调用各视图模块的 `render()` 函数。每个 session 只写自己的 `views/*.py` 文件——不会有合并冲突。

### 6.2 需要改造的现有文件

| 文件 | 改动 | 视图 |
|------|------|:---:|
| `pre-commit-check.sh` (39.2KB) | 新增第10组(条件区域检查)+第11组(测试覆盖检查) | 1 |
| `hook-block-write.sh` (15.3KB) | 新增条件归属验证(第8字段) | 1 |
| `pre-doc-audit.sh` (5.7KB) | 扩展：条件归属+验收覆盖+引用有效性 | 1 |
| `check-gates-v2.py` (82.7KB) | 扩展：快照写入+门禁按条件分组+门禁→条件联动+快照目录+completion数据 | 1,2,3 |
| `generate-dashboard.py` (27KB) | 改为导入 views/* 模块路由——本身不渲染具体视图 | 1-5 |
| `emit-signal.py` (2.6KB) | 扩展：completion_score+deviation_list字段 | 3 |
| task brief 模板 | 新增 `#CRITERIA` 必填字段 | 2 |

### 6.3 需要新建的文件

| 文件 | 用途 | 视图 |
|------|------|:---:|
| `scripts/audit/completion-engine.py` | 六条件判定引擎 | 3 |
| `scripts/cron/snapshot-cleanup.sh` | 快照生命周期管理 | 3 |
| `scripts/control-tower/graph-builder.py` | 工作流图构建 | 4,5 |
| `scripts/control-tower/views/pipeline_health.py` | 视图1: 流水线健康度 [P0] | 1 |
| `scripts/control-tower/views/pm_dashboard.py` | 视图2: PM仪表盘 [P1] | 2 |
| `scripts/control-tower/views/completion.py` | 视图3: 系统完成度 [P1] | 3 |
| `scripts/control-tower/views/workflow_graph.py` | 视图4: 工作流图 [P2] | 4 |
| `scripts/control-tower/views/agent_health.py` | 视图5: Agent链路健康 [P2] | 5 |
| `.codex/snapshots/` 目录结构 | 版本化快照存储 | 3 |
| `.codex/criteria-code-map.json` | 条件→代码区域映射表 | 1 |

### 6.4 不需要改动的

- `synova-commit` —— 网守不变
- `context-injector.sh` —— 注射器不变
- `contract-archiver.py` —— 契约存档不变
- `write_lock.py` —— 写入锁不变
- `external-auditor.sh` —— 审计器不变（但 Phase 1 中需要补3/5子模块）
- `env_validator.py` —— 环境验证不变
- 10 个信号文件 —— 格式不变（仅 emit-signal 的 Schema 扩展新增可选字段）

---

## 七、实施优先级和顺序

### Phase 0: 缺口修复 [前置——D256/D257/D258 已就绪, 可立即并行执行]

P0 视图需要审计器产出 `audit-result.json`(CP4)和网守的条件区域检查(CP3)。如果审计器没有 `--dispatch` 模式、契约门禁未接入网守——P0 视图拿不到数据。

| 任务 | 文件 | 内容 | 状态 |
|------|------|------|:---:|
| D256 | `scripts/control-tower/external-auditor.sh` | 审计器统一入口——`--dispatch` 模式, known-error-patterns.json 驱动, 输出 audit-result.json | dev doc 已就绪 |
| D257 | `scripts/pre-commit-check.sh` | 契约门禁接入网守——新增第9组(契约门禁) | dev doc 已就绪 |
| D258 | 多个文件 | 脚本清理归并——29个删除+8组件归属表 | dev doc 已就绪 |

D256/D257/D258 三个任务互不重叠, 可以并行执行。完成后 P0 的数据源就绪。

### Phase 1: P0——流水线健康度(视图1)


| 优先级 | 内容 | 为什么先做 | 预计改动量 |
|:---:|------|----------|:---:|
| **P0** | 流水线健康度（视图 1） | 创始人最紧急的痛点——不知道 Agent 交接有没有出问题 | 5 个文件改造 |
| **P1** | PM 仪表盘（视图 2）+ 系统完成度（视图 3） | 量化项目进度——回答"离部署还有多远" | 4 个文件改造 + 2 个新文件 |
| **P2** | 工作流图（视图 4）+ Agent 链路健康（视图 5） | Dev Doc Agent 用的流程优化工具——可以等 | 1 个新文件 + 仪表盘扩展 |

**Phase 0 三个任务(D256/D257/D258)可以立即并行执行——dev doc 已就绪, 写范围不重叠。** Phase 1(P0)需要一个 session, Phase 2(P1)需要一个 session, Phase 3(P2)需要一个 session。三个阶段可依次执行——generate-dashboard.py 改为 views/* 模块架构后各阶段写不同的文件, 无合并冲突。
