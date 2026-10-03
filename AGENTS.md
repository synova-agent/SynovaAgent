# AGENTS.md — SynovaAgent
> V5.2.7 | 2026-09-02 | 本地软提示 + CI 权威门禁 + 契约门禁 + 认领制 + 跨 session 隔离 + 桌面端（同步自代码，CTO 每周自检对齐）

> 组织数字孪生诊断 + 持续增长导航系统。诊断是手段，目的是增长。
> 核心问题：这家企业的增长卡在哪里？现在该做什么？
> Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。
> 独立 API 进程。HTTP + MCP 对外服务。

---

## 数据流总览（每次任务必回顾）

```
原始数据 → 本体层(电子病历) → 7维度×25测量器(compute)
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
6位专家(host/fundamental-efficiency/customer-growth/organizational-capability/technology-foundation/competitive-strategy — registry v3.0 问题域口径)
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

### 【元规则】铁律生命周期（2026-10-02 立）

> 依据创始人：「**关于铁律，有些可能过时，你需要仔细斟酌，不能写着铁律就必须这样了**」

```
① 每条铁律必须登记三样：【载体】+【执行门禁】+【最近复核日】
② 复核周期：季度（并入文档治理的 G′3 复审面）
③ 退役判据（任一命中即退役）：
   a. 载体已不存在（例：铁律 46 的 5 个白名单文件已删）
   b. 使命已完成（例：engine-core 真 import = 0 ⇒ 迁移封闭）
   c. 连续两季"零违反且无执行门禁"（软约束＝无约束）
④ 修订判据：表述与实测覆盖率不符（例：铁律 39 覆盖 src/ 49 目录中的 18 个）
⑤ 🔴 退役不是删除 ⇒ 移入 `LOOP-ENGINEERING-CHANGELOG.md`（可追溯）
⑥ 🔴 凡"写着铁律所以必须这样"的论证方式 = 无效；须回到【载体 + 门禁 + 阶段重要性】三判据
```

**已退役（2026-10-02）**：铁律 **40–45**（TUI，零消费方）｜铁律 **46**（engine-core，使命完成）
**待修订**：铁律 **39**（五层，覆盖率 37% —— 见下）

### 零、协作与流程

**铁律 0. 协作对齐前置——先对齐再动手，禁止假设共识。**

**铁律 0-2. 测试先行 + 接线验收——spec → test → impl → wire → review → merge。**
Step 5 WIRE CHECK 是硬门禁：`grep -rn "新函数名" src/` — 零结果 = 未完成。
历史：4 次接线失败（组件通过单元测试但从未被生产代码调用）。

**铁律 0-3. 禁止 git stash（D312，2026-08-02 事故）。** stash/pop 间隙被 hook 写文件导致 pop 冲突（39 tracked + 615 untracked 卷入）。替代方案：
- 查看基线: `bash scripts/control-tower/baseline-check.sh`
- 隔离工作区: `git worktree add ../synova-wt-<任务名> <branch>`
- 保存进度: 先 `git commit`（走 synova-commit），不要 stash
hook 已检测 `git stash` 并提示（hook-git-detect.sh）。

**铁律 0-3b. 多机 PR 工作流（D334，2026-08-14 创始人定）。**
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



**铁律 47. 契约优先。** 新增 compute 函数必须先定义输入/输出/降级契约（JSDoc），再实现。参见 SYNOVA-ARCH-质量与测试体系-20260707.md §二。
**铁律 48. 测试不可为空壳。** 测试文件必须有 expect() 断言。空壳测试 → commit 阻断。每个 compute 函数至少覆盖：正常路径 + 降级路径 + 边界条件。

**铁律 49（D534 新增）. 决策必须沉淀。** 非平凡变更（治理脚本/铁律/规则文档）的 commit 必须引用 memory/notes/ 四态 Note（commit-msg 物理门禁）；新决策写 proposed/，落地 git mv 到 implemented/，否决 rejected/，过时 archived/。规范见 `memory/notes/README.md`。

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

**（原铁律 45 · TUI 退役后保留的通用约定）注释中 `*/` 必须写为 `* /`。**
否则 esbuild 把 `*/` 识别为块注释结束符 → 编译失败。（历史：`message.tsx` 写 `-/*/+` 导致 esbuild 解析崩溃）

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

**铁律 39. 五层架构边界。**〔⚠️ **2026-10-02 复核：范围有限，勿当全局架构**〕

> 🔴 **实测范围**：五层只映射 `src/` **49 个顶层目录中的 18 个**（**63% 未覆盖**：
> `providers`/`services`/`security`/`ingest`/`growth`/`init`/`extensions`/`cycles`/`llm`/`loops`/`middleware`/`adapters`/`contract`/`tools`/`config`…）
> 🔴 **门禁只查 3 类**：`L2→L4` ／ `L1→L*` ／ `L3→L5` ⇒ 其余跨目录边不受约束
> 🔴 **它没授权 `L4→L3`，门禁也不查** ⇒ 实际已存在（`src/l3/period-utils.ts`，且该文件自证"无跨层违规"）
> **⇒ 处置**：31 个未归属目录的归层 + 是否改用"下层不可 import 上层"的可机器判规则 ⇒ **归架构专项研究（Q1）**；
> 研究结论出来前，**本条的适用范围＝"已声明的 18 个目录"，不得引它证明全局架构合规。**

每层只与相邻层通信：
```
L1 交互 (TUI/CLI/Web) → L2
L2 编排 (ConversationEngine) → L1 + L3
L3 洞察 (ExpertAutonomy/Corroboration) → L2 + L4
L4 本体 (GraphBridge/GraphStore) → L3 + L5
L5 存储 (SQLite) → L4
```
pre-commit `check-architecture.sh` 检测 L2→L4 / L3→L5 跨层违规。



### 六、【已退役】TUI V2 铁律 40–45（2026-10-02 退役）

> 🔴 **本节于 2026-10-02 退役**（依据创始人：「**TUI 闪烁修复冻结更加过时，TUI 我们不用了**」
> ＋ 判据「**不能写着铁律就必须这样**」）。
>
> **退役判据（实测，四条全中）**：
> ```
> ① 载体虽在（patches/ink+5.2.1.patch / src/tui-v2/）⇒ 但【零消费方】：
>    src/ 里 import tui-v2 的文件数 = 0；package.json 只有两个独立入口（"tui"/"synova"）
> ② 原铁律自认「无 pre-commit 自动执法」（3 处明写）⇒ 软约束＝无约束
> ③ PRODUCT-BRIEF 零提桌面端/TUI ⇒ 不在当前交付面
> ④ 交互面实际是 HTTP routes（服务入口）+ MCP；桌面端是独立 Electron（electron/main.cjs）
> ```
> **退役去向**：原 40–45 全文见 `LOOP-ENGINEERING-CHANGELOG.md`（可追溯，不删除）
> **保留的通用结论一条**：
> **「注释中的 `*/` 必须写为 `* /`」**（原铁律 45）—— 这是**通用编译陷阱**（esbuild 会把 `*/` 当块注释结束符），与 TUI 无关 ⇒ 已并入 §二 代码质量。
> **遗留项（另卡）**：`src/tui-v2/**` 与 `deps: ink/ink-text-input` 是否按铁律 37 删除 ⇒ 归产品线出卡（**这是删代码，不是删规则**）。

### 七、架构完整性 — 2026-06-21 新增（engine-core 拆分欺诈事故）

> 以下铁律来自 2026-05 至 2026-06 engine-core 拆分欺诈事故。
> 核心原则：**桥接文件 ≠ 迁移。声称拆完 = grep 零引用。**

**【已退役】铁律 46（原：禁桥接代理文件 / engine-core 迁移）** —— 2026-10-02 退役

> **退役判据（实测）**：`engine-core` 真 import = **0**（`grep -rnE "from '[^']*engine-core"` 零命中）
> ⇒ **使命已完成**；且原白名单 8 个文件里 **5 个已不存在**
> （`engine-core-adapter.ts`/`engine-core-types.ts`/`orchestrator-adapter.ts`/`entity-resolver-l2.ts`/`engine-graph-store.ts`）
> ⇒ 规则指向的载体消失，**读者会去找不存在的文件**。
>
> **保留的通用戒律（去 engine-core 专属）**：
> **禁止桥接代理文件 —— 迁移必须是代码真搬，不准建 import 代理。**
> ```
> 判定：纯桥接 = 文件中非 import/export/注释 的有效代码行数 = 0
> 声称"已迁移"前必须：grep -r "<旧路径>" src/ --include="*.ts" | grep -v "\.test\."   ⇒ 零结果才算完
> ```
> **Why 仍保留**：2026-05~06 曾有 20 个桥接文件伪装成迁移（538 文件原封不动），
> `tsc` 被骗过（import 路径合法），运行时 17 处 CJS `require()` 在 ESM 下崩溃。**这是通用教训，不限于 engine-core。**

**铁律 47. "拆完了"必须由 grep 物理证明。**

声称任何模块"已拆分/已迁移/已清理"前，必须运行：
```bash
grep -r "旧路径/旧包名" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "\.test\."
```
零结果 = 拆完了。有结果 = 没拆完，继续拆。

**Why**：tsc 零错误 ≠ 拆分完成。import 路径合法可以骗过编译器，骗不过 grep。
pre-commit 警告：task brief 中声明"已完成拆分"但 grep 仍有旧路径引用。


---

## 项目身份

**产品**: SynovaAgent — 组织数字孪生诊断 + 持续增长导航系统。
**定位**: 独立 Agent 进程，通过 HTTP API + MCP 对外服务；**桌面端**（Electron，品牌表层，施工图 🟢）：能装/能开/能用 8 验证点已闭环（切片 A/B/C，2026-08-25）。
**市场**: 5-1000人团队的组织诊断与增长导航。

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


**两大核心系统**:
1. **GA 按需诊断** — 用户触发，6阶段管道，全部测量器+专家 → 综合诊断报告
2. **Sentinel 定时哨兵** — Cron 自动，基线对比+异常检测 → 信号聚合 → 专家 → 工单

**五层架构**:
```
L1 交互    → routes/ (API), tui/ (终端), mcp/ (MCP协议)
L2 编排    → agent/ (ConversationEngine, diagnosis-launcher, sentinel-service)
              orchestrator/ (SubAgentCoordinator, ModuleRunner)
L3 洞察    → l3/ (ExpertDispatcher, ExpertAutonomy, QualityFirewall)
              sentinel/ (Runner, SignalAggregator, Registry, 加载器; 45文件驱动哨兵@extensions/sentinels + 4内置适配器)
              expert-platform/ (ExpertStore, Validator)
L4 本体    → l4/ (GraphBridge, EntityResolver, CommunityReports)
              evidence/ (Collector, Corroboration, EvidenceStore)
L5 存储    → store/ (SessionStore, SQLite)
              cron/ (CronScheduler, 持久化作业)
引擎       → packages/engine-core/ (543文件, 25测量器+本体层, 专家体系已迁出至 expert/ 6位)
安全       → security/ (PIIScrubber, DataBoundary)
LLM       → providers/ (DeepSeek, OpenAI, Gateway)
```

**架构规则**: 只能向下依赖相邻层。L1禁触L3/L4/L5。L2禁触L4/L5。pre-commit `check-architecture.sh` 检测违规。

---

## Loop Engineering v3.1 — 精简物理执法 + Agent 自检 + 产品对齐

> 2026-06-17 v2.5 → v3.0 重构 → 2026-06-19 v3.1。核心变化：
> **从"每犯一错加一脚本"→"找到根源，用一个机制防一类错"。**
> **从"bash 替 agent 思考"→"agent 自问 + bash 查硬伤"。**
> **v3.1: +产品对齐检查——task-start 后强制回答 Q1-Q4 才能写代码。**

### 设计哲学

v2.5 的 38 项 pre-commit + 12 脚本 + 3 次 tsc/vitest 重跑，
导致 `--no-verify` 泛滥——一个被绕过的门禁 = 没有门禁。

v3.0 只设 5 项物理阻断 → V4.4.2 扩展到 7 项 → V5.1.1 扩展到 13 组（D515 起本地软提示 + CI 权威，D516 SYNO_CI strict）。新增：契约优先（铁律47）、测试非空壳（铁律48）。
**从代码规范执法 → 行为契约执法。测试不是写完代码后的验证——在代码被写出来之前，对和错的标准已经被定义。**

### 执法架构: 五层精简

```
📋 任务启动 (人工)   →  task-start.sh — 3 问翻译意图→规格
🧠 写前注入 (自动)    →  hook-check-memory.sh — 历史教训
✍️ 写后验证 (自动)    →  verify-incremental.sh — L1 oxlint → L2 tsc → L3 vitest → L4 接线
🔴 提交阻断 (自动)    →  pre-commit 13 组 — 本地软提示，CI 权威（SYNO_CI strict）
🚀 推送阻断 (自动)    →  pre-push 门禁 0-5 — 多机同步 + secrets + golden-case + vitest + tag 校验
```

| 时机 | 脚本 | 阻断 | 耗时 |
|------|------|------|------|
| PreToolUse | hook-check-memory.sh (教训注入) | 不阻断 | <1s |
| PreToolUse | hook-block-write.sh (task brief 字段) | 🔴 阻断 | <1s |
| PreToolUse | hook-enforce-v25.sh (loop-state) | 🔴 阻断 | <1s |
| PostToolUse | verify-incremental.sh (L1→L4) + baseline-check.sh (L5) | 🔴 阻断 | 5-30s |
| pre-commit | pre-commit-check.sh (13 组) | 本地 ⚠️ 软提示（D515）；CI 权威硬阻断（SYNO_CI strict，D516） | <10s |
| pre-push | pre-push-check.sh (门禁 0-5) | 🔴 阻断 | <3s |

### pre-commit 13 组 (V5.1.1, 组号沿用脚本 echo) — 本地软提示，CI 权威（SYNO_CI=1 时转硬阻断）

| # | 检查 | 历史事故 | 耗时 |
|---|------|---------|------|
| 1 | 类型安全 + 硬编码数据 (`as any`/`as never`/`as unknown as`=0) | 47 次 | <1s |
| 2 | 测试质量 (新文件配对测试 + expect) | 4 次接线失败 | <1s |
| 3 | Secrets 扫描 | API key 暴露 | <1s |
| 4 | 接线完整性 (新 export 有调用方) | 4 次接线失败 | <1s |
| 5 | 架构边界 + 桥接文件 (铁律 39/46) | 跨层违规 | <1s |
| 6 | Task Brief 6 核心字段 | 流程 | <1s |
| 7 | 架构合规 | 跨层 | <1s |
| 8 | 文件驱动架构完整性 | 扩展解耦 | <1s |
| 9 | 契约门禁 (D257) | 契约优先 | <1s |
| 10 | V3 CP3 流水线健康度 (D260) | 条件区域+测试覆盖 | <1s |
| 12 | Task Scope 一致性 (D296 认领制) | 跨 session 污染 | <1s |
| 13 | 技能同步一致性 (D370) | .claude/skills ↔ .dsh/skills 漂移 | <1s |

### ⚡ Agent 自检 5 问（每次写完代码必答）

> 铁律 47/48（契约优先+测试非空壳）的内容已在 task-start Q4 中前置——写代码前定义，不等到写完再补。

写完代码后，必须在回复中逐项回答：

```
1. 接线检查: 新 export 谁调用？（grep 确认调用方存在）
2. 异常处理: 每个 catch 有 log + degraded？（铁律 24+31）
3. 类型安全: as any = 0？（铁律 38）
4. 测试质量: 有 expect() 断言？覆盖正常/降级/边界？（铁律 48。不是空壳）
5. 残留清理: 有死代码吗？旧文件删了？旧函数还有引用？
```

**Why agent 自检比 bash 好**: agent 知道 `'community'` 是模块 ID 不是密码。
grep 脚本会产生误报，误报会产生噪音，噪音会导致整条门禁链被绕过。

### task-start.sh 4 问（任务启动时回答）

```
Q1 调研: a) 业界最佳实践 b) 顶级团队怎么做 c) memory/ 里我们犯过的错
Q2 范围: 最简实现是什么？什么可以不做？
Q3 验收: 入口→交互→结果，三环节各是什么？
Q4 契约与测试: 新模块的输入/输出/降级契约是什么？测试怎么验证？（铁律 47+48，写代码前定义）
```





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
③ 实现完成 → pre-commit 强制 (Gate 2: 13 组 + task brief 完整；本地软提示，CI 权威)
④ 提交前   → Git Hook (.git/hooks/pre-commit) 13 组（本地软提示，CI 权威硬阻断）
⑤ 推送前   → Git Hook (.git/hooks/pre-push) 门禁 0-5（D334 多机同步/防覆盖 + secrets + golden-case F1 + vitest --changed + D331 tag 校验/对账）
⑥ 部署后   → 人工触发 (checkpoint-deploy.sh)
⑦ 线上     → Cron
```

### 物理强制说明

> pre-commit 是唯一物理阻断点。①②③ 的产出物检查已全部集成到 pre-commit（13 组硬阻断）：
> - 无 task brief → 不准 commit
> - 无 SPEC.md / 设计文档 → 不准 commit
> - 新 export 未接线 → 不准 commit
> - 新文件无测试 → 不准 commit
>
> SessionStart + PostToolUse hooks 在写代码时持续提醒。

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

## 门禁系统 (全部物理强制，零 AI 自律)

### PreToolUse Hook (写代码前)
- Task brief 存在 + 7 字段质量检查（项目身份/Q1调研/Q2范围/Q3验收/架构层级/文档引用/接口审计）
- 接口真实性反向验证（grep 确认函数签名真实存在）
- 例外: `.Codex/task-briefs/` `.Codex/settings` `scripts/workflow/hook-`

### PostToolUse Hook (写代码后)
- `verify-incremental.sh`: L1 oxlint → L2 tsc --incremental → L3 vitest --changed → L4 接线审计
- `.Codex/loop-state.json`: 循环计数，最多5轮

> PostToolUse 是 tsc + vitest + baseline 唯一一次执行的位置。pre-commit 和 pre-push 不重复跑。
> baseline-check.sh：跑基准测试，输出和上次提交对比。有偏差→告警（不阻断，需 agent 说明原因）。

### Git Hooks

| Hook | 触发时机 | 内容 |
|------|---------|------|
| pre-commit | `git commit` | 13 组（本地软提示；CI SYNO_CI strict 硬阻断） |
| commit-msg | `git commit` | Conventional Commits 格式强制（D328 merge 提交 MERGE_HEAD 豁免） |
| post-commit | `git commit` | bypass 检测（D366 三判 + CT-45 merge 提交豁免）+ 外部审计器（D210/D256）+ 决策流程建议 |
| pre-push | `git push` | 门禁 0-5：D334 多机同步/防覆盖 + secrets 终扫 + golden-case F1 + vitest --changed + D331 tag 校验/对账 |

---

## 执行原则

- **先读再改** — 不假设代码内容。读 AGENTS.md + task brief + 全量对齐手册相关章节
- **task brief 必须先填** — PreToolUse hook 强制。7字段(项目身份/Q1调研/Q2范围/Q3验收/架构层级/文档引用/接口审计) 全部非空才能写代码
- **接口审计从代码 grep，不凭记忆** — hook 反向验证，虚假接口拒绝写代码
- **每写一个文件，自动验证** — PostToolUse hook 跑 vitest --related + 接线审计。失败自动进入修正循环
- **循环最多5轮** — verify-incremental.sh 记录轮次，5轮不过停止等人工
- **接线审计是硬门禁** — 新 export 必须在生产入口有引用
- **逐项 commit** — 单模块独立提交，不批量
- **改完列清单** — 文件 + 行号 + 为什么改
- **部署后验证** — `bash scripts/workflow/checkpoint-deploy.sh` curl 外部 URL




