# CLAUDE.md — SynovaAgent

> V5.2.7 "Main Agent" | 2026-09-02 | L2 MainAgent 决策中心 + 创始人控制塔三位一体防御 + 桌面端（品牌表层，切片 A/B/C 已闭环；本地软提示 + CI 权威门禁）

> 组织数字孪生诊断 + 持续增长导航系统。诊断是手段，目的是增长。
> 核心问题：这家企业的增长卡在哪里？现在该做什么？
> Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。
> 独立 API 进程。HTTP + MCP 对外服务。

---

## 数据流总览（每次任务必回顾）

```
原始数据 → 本体层(电子病历) → 49 哨兵（45 文件驱动 + 4 内置适配器）
                                     ↓
                    按需(GA触发)          定时(Cron触发)
                    runModules()          Sentinel.check()
                         ↓                      ↓
                    Evidence池           SentinelFinding[]
                         ↓                      ↓
                    信号聚合引擎 ←←←←←←←←←←←←←
                         ↓
                    交叉关联 + 严重度升级 + 专家路由
                         ↓
              6位专家(host/fundamental-efficiency/customer-growth/organizational-capability/technology-foundation/competitive-strategy)  — 文件驱动 @expert/，registry v3.0 共 6 个
                         ↓
                    ReAct推理 + 交叉验证
                         ↓
                    综合诊断报告
                         ↓
                    GA 收到警报 + 报告
                    GET /api/sentinel/reports
                    GET /api/sentinel/tickets
```

---

## ⚠️ 每次工作前必读 — 铁律速览

> 以下铁律来自 2026-05 至今的全部实际错误。按优先级排列。

> 🔴 **引用纪律（2026-09-26 加）**：本文件中的任何「数量」（组数 / 条数 / 个数）
> **一律以脚本实况为准，不得作为判据**。需要说明「有多少」时给**枚举命令**，不给手写数。
> 理由：历史上同一概念出现过 `26/28/29`、`12/13/8/5` 等多口径 —— **每手写一次就多一个口径**。
> 详见《口径统一通告 v1》（2026-09-26）。

### 零、协作与流程

**铁律 0. 协作对齐前置——先对齐再动手，禁止假设共识。**

**铁律 0-2. 测试先行 + 接线验收——spec → test → impl → wire → review → merge。**
Step 5 WIRE CHECK 是硬门禁：`grep -rn "新函数名" src/` — 零结果 = 未完成。
历史：4 次接线失败（组件通过单元测试但从未被生产代码调用）。

**铁律 0-3. 多机 PR 工作流（D334，2026-08-14 创始人定）。**
main 是唯一真相。一人一事一分支。合并走 PR。禁止直接 push main（pre-push 门禁 0-2 硬阻断）。
开工前必须 `git fetch --all && git pull --ff-only`；禁止在 `[behind N]` 状态开工或 push
（pre-push 门禁 0-1 + 提交端 D335 check-branch-sync 双端硬阻断）。禁止 force push 共享分支。规范全文:
`docs/synova/coordination/MULTI-MACHINE-PR-WORKFLOW.md`；skill: `git-sync-pr`。
历史：2026-08-11~13 双机同分支交替 push，Mac tracking ref 过期 4 天误报 ahead、实际落后
11 commit，险些互相覆盖。

**铁律 0-4. 数据资产备份（D335，2026-08-14 创始人定）。**
代码有三地备份（GitHub+Mac+Win），数据必须同样有异地副本。`data/synova.db` 每日
03:30 由 launchd 自动备份到 iCloud Drive（`scripts/backup/backup-db.sh`，sqlite3
.backup 一致性快照 + integrity_check + 14 份轮转）。禁止直接 cp 数据库（可能拷到
写一半的库）。新机器开工前验证备份任务存在：`launchctl list | grep synova.backup`。

**铁律 0-5. 多 Agent 协作协议（D336，2026-08-14 创始人定）。**
四角色两条线：开发线 = Codex+DeepSeek(dev doc) + DeepSeek Harness(架构/基建/PR审查/创新)
+ Claude Code(功能实现)；审计线 = Kimi K3(独立审计)。任务路由查
`docs/synova/coordination/TASK-ROUTING.md`，协议全文 `docs/synova/coordination/MULTI-AGENT-COLLAB.md`。
**审计红线（违反=事故）**：DeepSeek Harness 与 Claude Code 永不修改审计脚本
（scripts/audit/ 等）、永不编写审计标准、禁止自我审计（开发者改过的门禁同样受 K3 审）。
PR 审查 ≠ 审计：审计结论只认 K3 报告。同一模块同一时间只允许一个角色认领。

### 一、接线铁律

**铁律 1. 垂直切片交付。** 按用户可见的行为拆，不按技术层拆。
**铁律 4. 交付不完整——写了代码没接线。** 入口 → 交互 → 结果，三环节缺一不可交付。
**铁律 5. 后端能力 ≠ 用户可用的功能。** 追踪调用链：谁 import？谁调用？结果在哪呈现？
**铁律 7. 每次接受任务确认 Done 标准。** 默认：入口可触达 + 完整链路走通 + 结果可见。

### 二、代码质量

**铁律 8. Mock/TODO 不留到交付代码。** pre-commit 硬阻断。
**铁律 9. 关键变更 grep 全仓库传播。** 改完核心定义后检查所有引用。
**铁律 11. 静默降级禁止。** catch 必须 `log.warn/error` + 返回 `degraded: true`。pre-commit 警告存量。
**铁律 12. 集成测试 cover 真实路由，不 mock 管线。**

### 三、错误处理与降级

**铁律 24. 异常处理审计——写 catch 时必须确认：**
- [ ] 有 log.error/warn（不能空吞）
- [ ] 返回 degraded: true（后端）或显示错误 UI（前端）
- [ ] 区分 ENOENT（正常默认）和 JSON.parse 失败（打 log + degraded）

**铁律 31. 降级信号传播。** 每个可独立失败的模块必须返回 degraded 标记，调用方检查，前端展示。
**铁律 32. 错误分类强制。** catch 块包装为 `.code` + `.phase` + `.retryable` 的 Error 子类。

### 四、自动化优先

**铁律 35. 自动化优先。** 能变 tsc/oxlint/ESLint 规则的不靠文档，能写 check-*.sh 的不靠 review。
**铁律 33. 测试命名约定。** `*.test.ts` (单元) / `*.integration.test.ts` (集成) / `*.e2e.test.ts` (E2E)。
**铁律 34. Feature Branch 强制。** `feat/` `fix/` `chore/` 分支，禁止直接在 main 上 commit。
**铁律 36. vitest 必须全量通过。** 零失败才合并。
**铁律 37. Dead code 入仓库即违规。** 删除旧文件 + grep 零引用确认。

### 五、类型安全与架构

**铁律 38. `as any` 零容忍。** 47 次历史教训。pre-commit 硬阻断，`as any` 代码中零存在。
V5.2.7 扩展（CT-46）：`as never` / `as unknown as` 同样零容忍（曾逃逸 `getDatabase() as never`）。
替代：内联类型 `as { field?: string }` / `Record<string, unknown>` / `unknown` + 类型守卫。

**铁律 39. 五层架构边界。** 每层只与相邻层通信：
```
L1 交互 (TUI/CLI/Web) → L2
L2 编排 (ConversationEngine) → L1 + L3
L3 洞察 (ExpertAutonomy/Corroboration) → L2 + L4
L4 本体 (GraphBridge/GraphStore) → L3 + L5
L5 存储 (SQLite) → L4
```
pre-commit `check-architecture.sh` 检测 L2→L4 / L3→L5 跨层违规。

### 六、TUI V2 铁律（2026-06-07 新增 — 基于闪烁修复+流式事故）

> 以下铁律来自 2026-06-07 TUI V2 闪烁修复和流式 Pipeline 事故。
> 核心原则：**ink 补丁层已经解决了闪烁，React 层不要过度工程化。**

**铁律 40. 闪烁修复不可回退（冻结）。**

任何修改 TUI V2 时，必须确认以下冻结项完好：
```
[ ] patches/ink+5.2.1.patch 存在
[ ] package.json "postinstall": "patch-package" 存在
[ ] React.memo 在 Message/StreamingText 上
[ ] 没有引入全量重渲染（forceUpdate / 逐 token 的 setState）
[ ] 没有 fallback 到旧的 useStreaming 实现
```
执法现状（2026-09-09 D603 拉平）：本条**无 pre-commit 自动执法**——`patch 文件缺失/postinstall 缺失/React.memo 被移除`全靠人工按上方清单核查（L1 审计 §3.3 实证：scripts/ 全目录 grep 零执法逻辑）。补真实 check 属 scripts/control-tower 域，CTO 另行派工。

**铁律 41. 流式 Pipeline 简单直接 — 禁止过度工程化。**

`useStreaming` hook 只能用 `bufferRef += token` + `setTimeout(flush, 16)` 模式。
禁止引入：`LineBuffer` / `FrameRateLimiter` / `StreamChunker` 多层嵌套。
ink 补丁层已解决闪烁，React 层只需简单的 buffer + 60fps flush。

**Why**：LineBuffer 要求换行才提交→无换行文本永远不可见。三层嵌套→buffer 永远来不及 flush。
执法现状（2026-09-09 D603 拉平）：本条**无 pre-commit 自动执法**——`use-streaming.ts` 中出现 `LineBuffer`/`FrameRateLimiter`/`StreamChunker` 类名不会触发任何门禁，靠 code review 把关（同上，scripts/ 零执法逻辑）。

**铁律 42. 逐字流必须有延迟。**

非流式 API 模拟流式时，`for (const ch of content) onToken(ch)` 必须配合 `await sleep(5)`。
每字符至少 5ms 间隔，留出 UI flush 时间。

**Why**：零延迟→所有 token 几毫秒内传完→buffer 来不及显示→用户看到空白。
pre-commit 警告：`tool-loop-executor.ts` 中 `for (const ch of` 后无 `sleep`。

**铁律 43. finishStreaming 调用顺序不可反。**

必须是：
```
flushBuffer() → addAgentMessage(reply) → setState({ isStreaming: false })
```
先 `isStreaming=false` 后 `addAgentMessage` → 中间有一帧空白。

**Why**：顺序反了会在流式结束和新消息之间出现空白帧。
pre-commit 警告：检测 `setState({ ... isStreaming: false })` 在 `addAgentMessage` 之前。

**铁律 44. ChatPanel 禁止 `justifyContent="flex-end"`。**

ink 不支持真正的滚动。flex-end 会把旧消息推出可见区域。
正确做法：消息截断算法 + `⋯ 上方还有 N 条消息`。

执法现状（2026-09-09 D603 拉平）：本条**无 pre-commit 自动执法**——`chat-panel.tsx` 中出现 `justifyContent.*flex-end` 不会触发任何门禁，靠 code review 把关（同上，scripts/ 零执法逻辑）。

**铁律 45. 注释中 `*/` 必须加空格。**

JSDoc 或块注释中 `*/` 必须写为 `* /`。
否则 esbuild 把 `*/` 识别为块注释结束符→编译失败。

**Why**：message.tsx 注释写了 `-/*/+`，esbuild 解析崩溃。
pre-commit 警告：`.tsx` 文件注释中出现 `*/`（非行尾的块注释结束符）。

### 七、测试契约与质量 — 2026-07-07 新增（V4.4.4 测试契约）

> 以下铁律来自 2026-07 测试质量审计。
> 核心原则：**新增能力必须先定义契约（JSDoc 输入/输出/降级），再实现。测试必须有真实断言。**

**铁律 47. 契约优先。** 新增 compute 函数必须先定义输入/输出/降级契约（JSDoc），再实现。参见 SYNOVA-ARCH-质量与测试体系-20260707.md §二。
pre-commit 硬阻断：新增 compute 函数无 JSDoc → 第 2 组拒绝提交。

**铁律 48. 测试不可为空壳。** 测试文件必须有 expect() 断言。空壳测试 → commit 阻断。每个 compute 函数至少覆盖：正常路径 + 降级路径 + 边界条件。
pre-commit 硬阻断：新测试文件无 expect() → 第 2 组拒绝提交。

### 八、架构完整性 — 2026-06-21 新增（engine-core 拆分欺诈事故）

> 以下铁律来自 2026-05 至 2026-06 engine-core 拆分欺诈事故。
> 核心原则：**桥接文件 ≠ 迁移。声称拆完 = grep 零引用。**

**铁律 46. 禁止桥接代理文件——迁移必须是代码真搬，不准建 import 代理。**

桥接文件定义：src/ 下的文件，主体内容仅为 `import { X } from '../../packages/engine-core/...'; export const X = _X;`。

**判定标准**：
```
纯桥接 = 文件中非 import/export/注释 的有效代码行数 = 0
部分桥接 = 有原创代码但仍直接 import engine-core
```

**修复标准**：
1. 将 engine-core 中的代码真正复制/移动到 src/ 对应位置
2. 在 src/ 文件中重写实现，不 import engine-core
3. 更新所有调用方的 import 路径
4. 删除 engine-core 中已迁移的旧文件
5. `grep -r "packages/engine-core" src/` 零结果（白名单除外）

**白名单**（唯一允许引用 engine-core 的文件）：
- `src/adapters/engine-core-adapter.ts` — 官方适配器
- `src/init/engine-context.ts` — 引擎初始化
- `src/types/engine-core-types.ts` — 类型重导出
- `src/agent/orchestrator-adapter.ts` — 编排器适配
- `src/l4/graph-bridge.ts` — 图桥接
- `src/l4/entity-resolver-l2.ts` — 实体解析
- `src/l4/engine-graph-store.ts` — 图存储
- `src/l4/diagnosis-graph-query.ts` — 图查询

**Why**：2026-05~06，engine-core 拆分被反复声称完成，实际全部是桥接文件——538 文件原封不动，20 个桥接文件伪装成迁移。tsc 被骗过（import 路径合法），但运行时 17 处 CJS require() 在 ESM 下崩溃。一个月反复承诺零实质进展。

pre-commit 硬阻断：`bash scripts/pre-commit-check.sh` — 非白名单 src/ 文件引用 `packages/engine-core` → 第 5 组硬阻断，拒绝提交。

**铁律 46 的判据 · "拆完了"必须由 grep 物理证明。**（原误编为「铁律 47」，2026-09-26 更正）

声称任何模块"已拆分/已迁移/已清理"前，必须运行：
```bash
grep -r "旧路径/旧包名" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "\.test\."
```
零结果 = 拆完了。有结果 = 没拆完，继续拆。

**Why**：tsc 零错误 ≠ 拆分完成。import 路径合法可以骗过编译器，骗不过 grep。
pre-commit 警告：task brief 中声明"已完成拆分"但 grep 仍有旧路径引用。

---

## 项目身份

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

**目标**: 成为组织诊断的 AWS。每个新客户、新行业、新数据源 → 加文件即可，不改代码。
能文件化的必须文件化。不能文件化的必须有明确的扩展点。

**流程约束: V4.5.1 — task brief 6字段 + 免疫系统 + plan.json + 13组物理阻断 + Plan-Actual闭合 + engine-core清零 + 时间戳顺序检查 + Q2排除项验证 + verify执行 + 全仓库engine-core扫描 + 壳包检测 + vitest --changed 增量回归 + grep 物理门禁 + 决策参考四步框架

**决策参考框架 (D333, 2026-08-13 创始人定)**: 遇到难决策/多选项/架构取舍/最佳实践选择/实现与文档声称冲突时，按 [DECISION-REFERENCE.md](docs/synova/coordination/DECISION-REFERENCE.md) 四步执行（①第一性原理 ②Anthropic 工程基线 ③开源实证 ④收敛检查），并在 task brief Q1c 决策参考系记录: `参考：Anthropic/DeepSeek/第一性原理 + 结论`（K3 审计可核）。task-start 自动生成 Q1c 字段 + 注入器全文注入框架。

**数据流**:
```
L5 存储 → L4 本体 → L3 洞察(哨兵定时 + 诊断按需) → L2 编排 → L1 交互
   ↑                                                              ↓
   └─────── 反馈闭环 (GA评审/客户反馈 → 记忆层 → 数据层) ←────────┘
                                                              ↓
                        Sentinel Finding[] ──→ 诊断引擎 Phase 2 ──→ 专家解读
                                                              ↓
                                                       6 位文件驱动专家
                                                     解读 Finding → 产出分析
```

**L1 交互层入口**:
- `POST /api/diagnosis/consult` — GA 诊断（六阶段→报告）
- Cron → `Sentinel.check()` — 哨兵定时（发现异常→专家→工单）
- `GET /chat` — Web 对话界面
- MCP 协议 — 外部工具调用

**五层架构** (只能向下依赖相邻层):
```
L1 交互: routes/ (API), tui/ (终端), mcp/ (MCP协议)
L2 编排: agent/ (ConversationEngine, diagnosis-launcher, sentinel-service)
         orchestrator/ (SubAgentCoordinator, ModuleRunner)
L3 洞察: l3/ (ExpertDispatcher, ExpertAutonomy, QualityFirewall)
         sentinel/ (Runner, SignalAggregator, Registry, 哨兵适配器)
         expert-platform/ (ExpertStore, Validator)
         expert/ (6 位文件驱动专家: host/fundamental-efficiency/customer-growth/organizational-capability/technology-foundation/competitive-strategy — registry v3.0)
L4 本体: l4/ (GraphBridge, EntityResolver, CommunityReports)
         evidence/ (Collector, Corroboration, EvidenceStore)
         企业事实层: AgentMemoryStore (enterprise_fact, 版本化 + superseded_by 链)
L5 存储: store/ (SessionStore, SQLite)
         cron/ (CronScheduler)
```

**三层粒度** (专家→哨兵→计算):
一个专家管理 N 个哨兵。一个哨兵包含 N 个 compute 指标。
哨兵 = 可独立告警的最小子领域。compute = 纯数学函数，不碰数据库。
例: 财务专家 → 成本哨兵/收入哨兵/现金流哨兵/利润哨兵 → 每个哨兵含 N 个 compute.ts

**L0 进化** (独立于五层，自我迭代):
```
evolution/ (SessionLearningEngine, FeedbackCollector, OntologyAdapter)
两路反馈 → 候选池 → 确认/执行验证 → 写入知识库/权重模型
分歧记录 → 三个月后自动验证 → 更新/降级
```

**文件化扩展** (不改代码):
- `expert/` — 新增专家 = 新建目录 + 8 个文件 → 自动注册
- `expert/expert-registry.yaml` — 声明哪些专家启用、用什么工具
- `knowledge/shared/` — 共享知识单源。专家 KNOWLEDGE.md 只引用不复制
- `theory/` — 理论基础。每个文件对应一个学科模块

**技能扩展**:
- `skills/` — SKILL.md 定义完整方法论。按需加载。新增 skill = 新建目录 + SKILL.md → ExpertDispatcher 自动发现

**数据安全**:
- L0 公开摘要 — 所有人可见
- L1 聚合信号 — GA + 客户可见
- L2 脱敏证据 — GA + 客户可见（人名/金额已脱敏）
- L3 原始数据 — 仅客户企业内部 Agent 可见。GA 永久不可见

**引擎**: `packages/engine-core/` (Novis 遗产, 538文件, 逐步迁移到 src/l3 + src/l4)。
禁止 src/ 新增 engine-core 引用（铁律 46）。pre-commit 物理阻断。

**安全**: `security/` (PIIScrubber, DataBoundary)
**LLM**: `providers/` (DeepSeek, OpenAI, Gateway)

**架构规则**: 只能向下依赖相邻层。L1禁触L3/L4/L5。L2禁触L4/L5。pre-commit `check-architecture.sh` 检测违规。

---

## Loop Engineering V4.5.1 — grep 物理门禁 + 侧翼修复自动化

> 2026-06-17 v2.5 → v3.0 → v3.1 → v3.5 → v3.6 → v3.7 → v3.8 → v3.9 → V4.1 → V4.1.1 → V4.1.2 → V4.2.2 → V4.2.3 → V4.2.4 → V4.2.5 → V4.3.0 → V4.4.0 (2026-07-05) → V4.4.2 (2026-07-07) → V4.4.4 (2026-07-08) → V4.5.0 (2026-07-10) → **V4.5.1 (2026-08-01)**。
>
> **v3.6 的核心教训**：把需要语义理解的事交给 grep = 17 次折腾才提交成功。
> **V3.9 的核心教训**：硬阻断 100% 有效，软机制 0% 有效。信息注入型检查对 agent 不可见。
> **V4.1 的解法**：每次记录一个错误 → 植入一个免疫细胞（bash constraint）。
>
> ### V4.2.3 变更 (2026-06-24)
> - 新增免疫细胞 #9: plan-actual-closure（声明完成须对比文档）
> - q0c-cancelled-without-followup 升级 warn→block（取消不补＝不准提交）
> - 所有 9 个免疫细胞增加 remediation 字段（"怎么做才对"修复提示）
> - CHANGELOG 增加"已知缺口"章节（当前覆盖率 45%，追踪 8 项缺口）
>
> ### V4.2.4 变更 (2026-06-25)
> - engine-core 全面清零：4个白名单桥接文件删除，6个消费者重写（src/ 零 engine-core 引用）
> - 11个@deprecated旧适配器删除（Task 0.0）
> - 11个stub哨兵目录删除（Task 0.1）
> - cash-flow-sentinel.ts 空import悬挂修复：内联computeCashFlowMetrics替代已删除桥接
> - **settings.json hook配置审计修复**：PreToolUse 指向 `hook-block-no-q0.sh`（旧版，只查Q0）→ `hook-block-write.sh`（完整版，查Q0+Q2+Q3+接口审计+层级确认）。这是V4.2.4新增检查项：hook配置一致性。
> - 旧版hook边界修复：Q0存在性检查 `-lt 10` → `-le 5`
> - CLAUDE.md/STATE.md/pre-commit/hook 全部同步到 V4.2.4
>
> ### V4.2.5 变更 (2026-06-25)
> - **时间戳顺序检查（新免疫细胞 #18）：** PreToolUse hook 在 brief 未填而写代码时，记录证据到 `/tmp/.synova-before-brief`（git 外不可抹除）。pre-commit 组 6 检查此文件，存在则硬阻断。阻断后须 `rm /tmp/.synova-before-brief && git checkout -- .` 从 task-start 重新开始。5 次测试证明 exit code 在 VSCode Extension 中被忽略——这是一个环境感知修复。
> - **项目身份重构：** 新增三层解耦体系（纵向五层物理隔离 / 横向 Monorepo 包 / 扩展文件驱动）。Q0 增加三层解耦勾选项。Q1 重构为 Anthropic 决策链（5 步序：SPEC→测试→实现→接线→验证）+ 执行约束（plan.json principles）。
> - 模板 `generate-task-brief.py` 更新为 V4.2.5 新格式
> - 版本号 CLAUDE.md/STATE.md/pre-commit/hook 全部同步到 V4.2.5
>
> ### V4.2.6 变更 (2026-06-26)
> - **Q2排除项物理验证（新免疫细胞 #19）：** pre-commit 自动解析 Q2 中「不改 X」模式，提取文件路径，检查 git diff 是否包含这些文件。包含则硬阻断。
> - **verify命令自动生成与执行（新免疫细胞 #20）：** Q2排除项、Q3验收项中的可验证内容自动生成 bash verify 命令，在 pre-commit 组 6 执行。
> - **check-verifiable-done.sh 解析bug修复：** awk 范围模式 /^## Done 标准/,/^## / 中开始行也匹配结束条件，Done 内容从未被读取。修复为从匹配行之后开始。
> - **版本号统一：** scripts/ 中 10 个残留 V4.2.1 文件全部同步到 V4.2.6
>
> ### V4.2.7 变更 (2026-06-27)
> - **日期边界bug修复：** BRIEF查找改为取最新(.md)而非当天，解决跨天提交时brief找不到的问题。
> - **层字段检查修复：** "L3"过短(2字符)导致6核心字段误阻断。
> - **current-brief 绑定：** task-start.sh 将brief文件名写入.claude/current-brief。
> - **模板残留检查：** grep <!-- 在brief中 → 未认真填 → 阻断。
> - **Q2排除项必须含文件路径：** 排除项需引用具体文件名(.ts/.sh/.json)。
> - **trivial verify阻断：** echo/true等永远exit 0的命令→硬阻断。
>
> ### V4.2.9 变更 (2026-06-28)
> - **maker/checker 分离：** checker-review.sh 独立验证器，GitHub Actions PR触发。
> - **19个stub compute全部修复：** S1-S3, O1-O10, T4-T9 替换为真实算法。
> - **专家路由改为layer基：** 从 category 改为 layer 路由。
> - **SentinelConfig 补全4字段：** layer/auxiliaryExperts/computeKind/technoEconomicPhaseCalibration。
> - **全部版本号同步到 V4.2.9**
>
> ### V4.3.0 变更 (2026-07-03)
> - **L4 本体层设计哲学明确化**：本体层是企业知识图谱（22 节点类型 + 17 边类型），compute 函数必须使用图遍历思维，不能退化为 KV 读取。
> - **compute 函数签名标准化**：`(store: GraphStoreReader, teamId: string) => ComputeResult`，store 提供 queryNodes/queryEdges/traverse 三个图操作原语。
> - **已知问题与演进方向**：Financial 节点 17 个 optionalProps 需拆分为语义子节点；5 条缺失边类型需补充。
> - **全部版本号同步到 V4.3.0**
>
> ### V4.4.0 变更 (2026-07-05)
> - **check-brief-vs-code 路径匹配修复**：`sentinel/\S+` → `src/sentinel/\S+`，避免从 `src/sentinel/types.ts` 提取 `sentinel/types.ts` 导致文件不存在误报。
> - **层检查排除 scripts/**：`^scripts/workflow/` → `^scripts/`，避免修改 CI 脚本触发层不匹配误报。
> - **版本号统一**：pre-commit-check.sh、task-start.sh、loop-context.sh、loop-score.sh、loop-sync.sh、post-merge-cleanup.sh、verify-incremental.sh 全部同步到 V4.4.0。
> - **CLAUDE.md 同步到 V4.4.0**
>
> ### V4.4.2 变更 (2026-07-07) — engine-core 引用全面加固
> > 背景：2026-07-06 Codex 审计发现 `@synova/diagnosis-engine` 是 42 行纯 re-export shell，
> > 通过 packages/ 目录绕过了铁律 46 的 `src/` 扫描。三个漏洞同时修复。
>
> - **漏洞 1 修复：扫描范围扩展到 packages/**。`STAGED_ALL_FILES` 同时覆盖 `src/` 和 `packages/`，堵住"藏到包目录"的绕过模式。
> - **漏洞 2 修复：匹配任意 engine-core 引用**。从字面量 `packages/engine-core` 改为 `packages/engine-core + ../../engine-core/ + ../engine-core/` 三重匹配，堵住"用相对路径绕过"的漏洞。
> - **漏洞 3 修复：壳包检测**。`packages/*/src/` 下只有 index.ts 且全为 `export from`、行数 <50、引用 engine-core → 判定为壳包 → 硬阻断。
> - **check-bridge-files.sh 同步加固**：独立验证器同样覆盖 packages/ + 相对路径 + 壳包检测。
> - **全部版本号同步到 V4.4.2**
>
> ### V4.5.1 变更 (2026-08-01) — pre-commit 超时根治 + 门禁扩展
> > 背景：pre-commit 实测 122s（>120s 超时线）导致 git commit 反复超时 → 被迫 --no-verify，成为绕过控制塔的根因。
>
> - **性能：pre-commit 122s → ~50s**。三管齐下：① 9 个外部脚本并行化（`par_start`/`par_collect`，串行 95s → 并行 ~26s）；② `GIT_CACHED_*` 缓存 git diff（16 次 git 调用 → 4 次）；③ I/O 合并（壳包检测 13 包×4 次 I/O → 1 次 find + 1 次 awk，28.7s → 7.1s；deprecated-mapping 20 次循环 grep → 1 次 grep -L，26s → 1.8s）。
> - **正确性：12 处 `grep -c ... || echo 0` 加 `tr -d '\n\r'`**。修复 `[: integer expected`——`grep -c` 无匹配时输出 "0" 且 exit 1，`|| echo 0` 追加第二行 "0"，变量变成 "0\n0"。
> - **Gatekeeper 误判修复**：只匹配 `detected-bypass` 行，`COMMITTED | pre-commit PASS` 是正常提交标记不算绕过。
> - **新增门禁**：PreToolUse `hook-bypass-block.sh`（24h 内绕过实时阻断）+ `hook-check-task-scope.sh`（文件 vs Q2 范围）+ pre-commit 组 12 Task Scope 一致性。
>   （**D1146 标注（2026-10-05）**：CC hook 层已退役、登记点归零——`hook-bypass-block.sh` **从未入库**（历史无此文件），
>   `hook-check-task-scope.sh` 亦无任何登记点；本行仅存 v4.5.1 当期的变更记录，不代表现行执行体。）
> - **控制塔跨 session 自动化**：SessionStart/PreToolUse/PostToolUse 全部 hook 移至 `settings.json`（git 追踪），新 clone 即自带完整控制塔。
>   （**D1146 标注**：该 `settings.json` hooks 段已于 D1146 **整段移除**，11 个登记点归零。）
> - **全部版本号同步到 V4.5.1**
>
> ### V4.5.0 变更 (2026-07-10) — grep 物理门禁 + 侧翼修复自动化
> > 背景：发现时间黑洞在"侧翼修复"——删改符号前不知道哪些文件会断裂，tsc 报了才逐处修。
> 
> - **漏洞 1 修复：改前先 grep — 物理阻断**。新增 `scripts/workflow/grep-refs.sh`：改代码前 grep 全仓库引用写入 `.claude/reference-map.md`，创建 `.claude/grep-verified` 门禁。`hook-block-write.sh` 检查此文件——写代码文件时必须存在，否则 Write/Edit 被硬阻断。
> - **漏洞 2 修复：Q0 格式统一**。CLAUDE.md 示例 `Q0 定位:` 与脚本解析 `^## Q0:` 不匹配。修复：示例改为 `## Q0:` 格式 + 醒目警告；hook/pre-commit awk 同时兼容两种写法。
> - **全部版本号同步到 V4.5.0**
> - **流程改进：写代码前三步曲**：① `bash scripts/workflow/grep-refs.sh "符号"` → ② 审查 `.claude/reference-map.md` → ③ Edit 代码
> 
> > ### V4.4.4 变更 (2026-07-08) — vitest --changed 增量回归 + 版本同步
> > > 背景：2026-07-08 同步扫描发现 CLAUDE.md 停留在 V4.4.2，脚本已全部更新但文档未同步。
> >
> > - **漏洞 1 修复：文档-代码版本漂移修复**。所有 .md 文件版本号同步到 V4.4.4，与脚本一致。
> > - **漏洞 2 修复：pre-push 增加 vitest --changed**。推送前执行增量回归测试，防止只通过 vitest --related 的局部通过但全量回归失败。
> > - **漏洞 3 修复：verify-v444.sh 自身 bug**。check_version() 检查 `V4\.4\.2` 而非 `V4\.4\.4`，导致版本漂移永不被发现。
> > - **新增：verify-incremental.sh 升级到 V4.4.4**。PostToolUse 四层验证同步。
> > - **全部版本号同步到 V4.4.4**
>
> ### 设计哲学 (V3.7 核心修正)

```
V3.6 的错误: 把"这个函数是否在正确的调用链中"交给 grep 判断
             → 动态 import 检测不到 → 5 次接线误报
             → 分阶段任务未接线文件被硬阻断 → 架构步骤被打断

V3.7 的修正: grep 只回答"这个符号在文件外部出现过吗？"（物理事实）
             agent 自检回答"这个符号在正确的调用链中吗？"（语义判断）
             plan.json 声明"这个文件处于架构步骤中，接线在后续阶段"（结构化计划）
```

### L4 本体层设计哲学（V4.3.0）

本体层不是 KV 数据库，是一张**企业知识图谱**。22 种节点类型（Financial/Client/Person/Process/Tool/Goal/Market/Product...）和 17 种边类型（COST_DRIVEN_BY/REVENUE_FROM/OWNS/PROVIDES/DEPENDS_ON/INTERACTS_WITH/TRIGGERS...）共同构成对一家企业的语义建模。

设计哲学：边承载语义，节点承载状态。

- 哨兵问"融资约束如何"——不是读 Financial.operatingCashFlow，而是沿 GENERATES 边找现金流子节点、沿 OWES 边找债务结构、沿 BACKED_BY 边找权益，在图遍历结果上运行 KZ 公式
- 哨兵问"砍掉低产客户群会怎样"——不是读 revenue 数字，而是沿 REVENUE_FROM 边找客户收入贡献，沿 COST_DRIVEN_BY 边追踪成本线归属

compute 函数签名统一为 `(store: GraphStoreReader, teamId: string) => ComputeResult`。store 提供 queryNodes/queryEdges/traverse 三个图操作原语。compute 不应该自己"知道"数据在哪——它应该沿图中已定义的边走过去。

**已知问题与演进方向**：
- Financial 节点 17 个 optionalProps 需拆分为 CashFlowStatement/BalanceSheet/IncomeStatement/CapitalStructure/CostCenter 等语义子节点
- 缺失 5 条边类型：COMPENSATES/ALLOCATES_TO/BUDGETS/PARTICIPATES_IN/GENERATES

### 三权分立

| 层级 | 谁做 | 判断什么 | 不可靠时怎么办 |
|------|------|---------|--------------|
| **bash 物理验证** | pre-commit | 文件存在、符号被引用、模式可见、语法合法 | 硬阻断 — 物理事实不容争辩 |
| **plan.json 结构** | 人类审批 | 文件清单、阶段顺序、deferred checks | 锁定的 plan 覆盖 bash |
| **agent 自检** | agent | 调用链正确、退化诚实、架构边界、接线完整 | 自检结果写 commit message |

### 执法架构: 三层精简（D1146: CC 侧 hook 层已退役）

> **🔴 D1146（2026-10-05，CC 退役）**：本节下方 hook 层**已退役**（`.claude/settings.json` hooks 段 +
> `.codex/hooks.json` 共 **11 个登记点归零**；`hook-session-start.sh` / `hook-post-tool-use.sh` 已删除）。
> 下列 hook 行**仅作历史对照，不再点火**；同型处置与替代执行体见 `AGENTS.md`「执法架构: 三层精简」。

```
📋 任务启动 (人工)   →  task-start.sh — 6 核心字段 + 可选 plan.json
🧠 写前注入 (自动)    →  ~~hook-check-memory.sh~~（已退役 D1146）— 历史教训
✍️ 写后验证 (自动)    →  ~~verify-incremental.sh~~（已退役 D1146，仅可手工触发）— L1→L2→L3→L4 接线
🔴 提交阻断 (自动)    →  pre-commit 13 组 — 本地软提示，CI 权威（SYNO_CI strict）
🚀 推送阻断 (自动)    →  pre-push 1 项 — secrets 终扫
🎯 提交后检测 (自动)  →  post-commit — --no-verify 绕过检测 + 决策建议
```

| 时机 | 脚本 | 阻断 | 耗时 |
|------|------|------|------|
| ~~PreToolUse~~（已退役 D1146） | hook-check-memory.sh | 不阻断 | <1s |
| ~~PreToolUse~~（已退役 D1146） | hook-block-write.sh | 🔴 阻断 | <1s |
| ~~PreToolUse~~（已退役 D1146） | hook-enforce-loop.sh | 🔴 阻断 | <1s |
| ~~PostToolUse~~（已退役 D1146） | verify-incremental.sh (L1→L4) | 🔴 阻断 | 5-30s |
| pre-commit | pre-commit-check.sh (13 组) | 本地 ⚠️ 软提示（D515）；CI 权威硬阻断（SYNO_CI strict，D516） | <10s |
| post-commit | post-commit (bypass 检测) | 不阻断 | <1s |
| pre-push | pre-push-check.sh (secrets 终扫) | 🔴 阻断 | <3s |

### pre-commit 8 组硬阻断（V3.7 — bash 只做物理验证）

| 组 | 检查内容 | bash 判断 | agent 自检判断 |
|----|---------|----------|--------------|
| **1** | **类型安全 + 硬编码数据** | as any / as never / as unknown as 在代码行（跳过注释行）| 硬编码数据是否合理 |
| **2** | **测试质量** | 文件配对 + empty catch 有 degraded/throw/log | 测试质量 + 跨模块覆盖 |
| **3** | **Secrets** | 全工作区模式匹配 | — |
| **4** | **接线完整性** | 新 export 是否被任何 src/ 文件引用 | 引用是否在正确的调用链中 |
| **5** | **架构边界 + 桥接** | 跨层 import + engine-core 引用 | 跨层调用是否通过合法桥接 |
| **6** | **Task Brief** | 存在 + 6 核心字段 (Q0/Q1/Q2/Q3/架构层/Done) | 分阶段计划合理性 |
| **7** | **架构合规** | DiagnosticModule + 专家配置 + 数据流 | 降级是否诚实 |
| **8** | **文件驱动完整性** | manifest schema + tags + 目录结构 | 新类型是否应该文件驱动 |

### plan.json — 分阶段任务的结构化支持

当任务声明为分阶段执行时，创建 `.claude/plan.json` 声明各阶段的文件清单和 `deferred` 检查：

```json
{
  "version": "1.0",
  "current_phase": 1,
  "phases": [
    {
      "step": 1, "action": "create",
      "files": ["src/locale/locale-loader.ts", "src/l3/framework-loader.ts"],
      "checks": { "wiring": "deferred", "test_pairing": "deferred" }
    },
    {
      "step": 2, "action": "wire",
      "files": ["src/server.ts"],
      "checks": { "wiring": "enforce", "test_pairing": "enforce" }
    }
  ]
}
```

- `checks.wiring: deferred` → 接线检查对该文件降级为警告
- `checks.test_pairing: deferred` → 测试配对检查对该文件降级为警告
- agent 不能改这个文件 — 在 EnterPlanMode 时生成，人类审批后锁定
- plan.json 不存在时 → 所有检查正常硬阻断（和 V3.6 一致）

### 双日志审计 — 门禁故障 ≠ 人为绕过

| 日志 | 写入者 | 含义 | 审计行为 |
|------|-------|------|---------|
| `.claude/pre-commit-failures.log` | pre-commit hook (exit != 0) | 门禁本身拒绝了提交 | >10 次/24h → 警告（门禁太激进） |
| `.claude/bypass.log` | post-commit hook | `--no-verify` 跳过了 pre-commit | ≥3 次/24h → 硬阻断 |

**检测原理**：pre-commit hook 通过时写时间戳到 `.claude/last-precommit-success`。post-commit hook 检查：如果上次成功时间戳在 120 秒之前 → 本次 commit 可能用了 `--no-verify` → 写入 bypass.log。

### ⚡ Agent 自检 6 问（每次写完代码必答 — v3.7 新增文件驱动检查）

> 以下检查由 agent 在 CLAUDE.md 指令下自我执行，不依赖 bash 脚本。
> agent 能做语义理解——bash 只会 grep 模式匹配（误报如 `'community'` 被识别为硬编码凭证）。

写完代码后，必须在回复中逐项回答：

```
1. 接线检查: 新 export 谁调用？（grep 确认调用方存在）
2. 异常处理: 每个 catch 有 log + degraded？（铁律 24+31）
3. 类型安全: as any = 0？（铁律 38）
4. 测试覆盖: 测试有 expect() 断言？（不是空壳）
5. 残留清理: 有死代码吗？旧文件删了？旧函数还有引用？
6. 🆕 文件驱动: 新增了硬编码类型吗？新扩展有 manifest.json 吗？tags 在 tags.json 中吗？
```

**Why agent 自检比 bash 好**: agent 知道 `'community'` 是模块 ID 不是密码。
grep 脚本会产生误报，误报会产生噪音，噪音会导致整条门禁链被绕过。

### task-start.sh 6 核心字段（任务启动时填写 — v3.7 新增 Q0 项目背景+文件审计）

> ⚠️ 格式要求：**必写 `##` 标题级，`Q0:` 冒号紧跟 Q0**。hook 和 pre-commit 严格解析 `^## Q0:`。
> 模板: `bash scripts/workflow/task-start.sh` 自动生成，或按以下格式手写：

```
## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
Synova = AI 诊断 Agent。本任务在哪一层？该层现有模块？新增/替换/扩展？
### b) 文件审计
grep 关键词在 expert/ sentinel/ extensions/ 中。复用/扩展/新建/冲突？
### c) 决策
已有覆盖→复用。无覆盖→文件驱动。冲突→取消。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
引用铁律 0-2/7/24+31/33，memory/ 历史教训。

## Q2: 范围 — 正确的最简方案
做什么：
不做什么（含文件路径）：

## Q3: 验收 — 入口 → 交互 → 结果
入口（从哪触发）：
处理（中间步骤）：
结果（最终展示）：

## 架构层: L1-L5
## Done 标准: 至少一条可验证的完成标准
```

### Windows 兼容性

- pre-commit 8 组合并 grep（<8s），不含 tsc/vitest（已由 PostToolUse 跑）
- 严禁 `taskkill //IM node.exe` — 会杀死所有 Node 进程（含其他 Claude Code 实例）
- `--no-verify` 在 V4.1 下不应再需要（pre-commit <8s）
- 轻量变更（≤5 行或纯非 TS 文件）跳过 tsc/vitest，仍跑 oxlint + 接线审计

### V3.6/V3.7 新增脚本

| 脚本 | 用途 |
|------|------|
| check-file-driven.sh | 文件驱动架构完整性（manifest/tags/回归/目录/pizza-chain）— pre-commit 第 8 组 |

### 删除的脚本（v3.0 清理）

| 脚本 | 删除原因 |
|------|---------|
| check-manual-drift.sh | 文档硬编码数字 → 每次改代码都要改文档 |
| check-vertical-slice.sh | 入口→结果 三环节 → agent 自检 Q3 验收 |
| generate-state-md.sh | STATE.md 无人阅读 |
| check-reality.sh | @state 注释 ≠ 正确性 |
| hook-check-brief.sh | task brief 提醒被 task-start.sh 覆盖 |

**净效果: v2.5 38 项 → v3.0 5 项 → v3.5 20 项（漂移）→ v3.6 8 组（合并归位）。提交耗时 v2.5 90s → v3.6 <8s。**

---

## 常用命令

```bash
npm run dev              # 开发模式 (tsx src/index.ts)
npm run test             # 全量测试 (vitest run)
npm run tui              # TUI 终端界面
npm run lint             # TypeScript 检查 (tsc --noEmit)
npm run check:iron-laws   # 铁律门禁 (6 硬阻断)
npm run check:architecture # 架构边界检查
npm run check:all         # pre-push 全部门禁 (tsc + vitest + iron-laws)
npm run hooks:install     # 安装 Git hooks
npm run workflow:start    # 任务启动检查点 (开始写代码前)
npm run workflow:impl     # 实现完成检查点 (声称完成前)
npm run workflow:design   # 设计对齐检查点 (写代码前)
npm run workflow:deploy   # 部署后验证
```

---

## ⚡ Anthropic 工程工作流 (7 节点自动触发)

> 详细设计: `docs/workflow/ANTHROPIC-WORKFLOW.md`

### 触发机制 — 全部物理强制，零 AI 自律

```
① 任务开始 → pre-commit 强制 (Gate 0: task brief 不存在 + 未填写 → 拒绝提交)
② 设计完成 → pre-commit 强制 (Gate 1: SPEC.md + 设计文档不存在 → 拒绝提交)
③ 实现完成 → pre-commit 强制 (Gate 2: 13 组物理阻断 + task brief 完整)
④ 提交前   → Git Hook (.git/hooks/pre-commit) 13 组（本地软提示，CI 权威硬阻断）
⑤ 推送前   → Git Hook (.git/hooks/pre-push) 1 道门禁（secrets 终扫）
⑥ 部署后   → 人工触发 (checkpoint-deploy.sh)
⑦ 线上     → Cron
```

### 物理强制说明

> pre-commit 是唯一物理阻断点。①②③ 的产出物检查已全部集成到 pre-commit（13 组硬阻断）：
> - 无 task brief → 不准 commit
> - 无 SPEC.md / 设计文档 → 不准 commit
> - 新 export 未接线 → 不准 commit
> - 新文件无测试 → 不准 commit
> - 🆕 manifest 不完整 / tags 非法 / 硬编码类型回归 → 不准 commit
>
> SessionStart + PostToolUse hooks 在写代码时持续提醒。**（D1146 标注：该 hook 层已退役、登记点归零 ⇒ 不再提醒；会话内提醒改由 DSH 会话指令承担。）**

⚠️ 每次 git push 成功后，必须提醒:
   "部署已完成。请运行: bash scripts/workflow/checkpoint-deploy.sh [服务器URL]"
```

### 人工触发命令

```bash
# 节点 ②: 设计文档写完后
bash scripts/workflow/checkpoint-design.sh docs/research/my-feature.html

# 节点 ⑥: 部署到服务器后
bash scripts/workflow/checkpoint-deploy.sh https://your-server.com

# 节点 ⑦: 设置定时监控
crontab -e  # 添加: */30 * * * * bash /path/to/scripts/workflow/checkpoint-runtime.sh
```

---

## 门禁系统 (提交端硬阻断 + CI 权威)

### PreToolUse Hook — **已退役**（D1146，2026-10-05）
- 原写前拦截：Task brief 存在 + 6 核心字段质量检查（Q0定位/Q1调研/Q2范围/Q3验收/架构层级/Done标准）
- 原写前拦截：接口真实性反向验证（grep 确认函数签名真实存在）
- 原例外: `.claude/task-briefs/` `.claude/settings` `scripts/workflow/hook-`
- **D1146 后**：两者均随 CC 退役**登记点归零**，同一目的改由**提交端**承担（task brief 字段 = pre-commit 组 6；
  接线完整性 = 组 4；权威判定 = CI 12 必需 context）。

### PostToolUse Hook — **已退役**（D1146，2026-10-05）
- 原自动跑 `verify-incremental.sh`: L1 oxlint → L2 tsc --incremental → L3 vitest --changed → L4 接线审计
- 原 `.claude/loop-state.json`: 循环计数，最多5轮
- **D1146 后**：不再自动触发；需用时**手工**跑 `bash scripts/workflow/verify-incremental.sh`。

### Git Hooks

| Hook | 触发时机 | 内容 |
|------|---------|------|
| pre-commit | `git commit` | 13 组（本地软提示；CI SYNO_CI strict 硬阻断） |
| commit-msg | `git commit` | Conventional Commits 格式强制 |
| post-commit | `git commit` | 决策流程建议 (decide-next.sh) |
| pre-push | `git push` | 1 道门禁 (secrets 终扫) |

---

## 执行原则

- **先读再改** — 不假设代码内容。读 CLAUDE.md + task brief + 全量对齐手册相关章节
- **task brief 必须先填** — pre-commit 组 6 强制（D1146：原 PreToolUse hook 登记点已退役）。6核心字段(Q0定位/Q1调研/Q2范围/Q3验收/架构层级/Done标准) 全部非空才能写代码
- **接口审计从代码 grep，不凭记忆** — grep 反向验证（D1146：原 hook 已退役，改为提交前自检 + CI 组 4），虚假接口拒绝写代码
- **每写一个文件，自动验证** — 手工跑 `bash scripts/workflow/verify-incremental.sh`（D1146：原 PostToolUse hook 登记点已退役）：vitest --related + 接线审计。失败自动进入修正循环
- **循环最多5轮** — verify-incremental.sh 记录轮次，5轮不过停止等人工
- **接线审计是硬门禁** — 新 export 必须在生产入口有引用
- **逐项 commit** — 单模块独立提交，不批量
- **改完列清单** — 文件 + 行号 + 为什么改
- **部署后验证** — `bash scripts/workflow/checkpoint-deploy.sh` curl 外部 URL
