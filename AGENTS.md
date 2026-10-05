# AGENTS.md — SynovaAgent
> V5.2.7 | 2026-09-02 | 本地软提示 + CI 权威门禁 + 契约门禁 + 认领制 + 跨 session 隔离 + 桌面端（同步自代码，CTO 每周自检对齐）

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

> 🔴 **引用纪律（2026-09-26 加）**：本文件中的任何「数量」（组数 / 条数 / 个数）
> **一律以脚本实况为准，不得作为判据**。需要说明「有多少」时给**枚举命令**，不给手写数。
> 理由：历史上同一概念出现过 `26/28/29`、`12/13/8/5` 等多口径 —— **每手写一次就多一个口径**。
> 详见《口径统一通告 v1》（2026-09-26）。

### 零、协作与流程

**铁律 0. 协作对齐前置——先对齐再动手，禁止假设共识。**

**铁律 0-2. 测试先行 + 接线验收——spec → test → impl → wire → review → merge。**
Step 5 WIRE CHECK 是硬门禁：`grep -rn "新函数名" src/` — 零结果 = 未完成。
历史：4 次接线失败（组件通过单元测试但从未被生产代码调用）。

**铁律 0-3. 禁止 git stash（D312，2026-08-02 事故）。** stash/pop 间隙被 hook 写文件导致 pop 冲突（39 tracked + 615 untracked 卷入）。替代方案：
- 查看基线: `bash scripts/control-tower/baseline-check.sh`
- 隔离工作区: `git worktree add ../synova-wt-<任务名> <branch>`
- 保存进度: 先 `git commit`（走 synova-commit），不要 stash
`git stash` 拦截能力仍在（`scripts/hooks/hook-git-detect.sh`，D1146 后不再由 PreToolUse 登记点触发，
改由 `scripts/control-tower/incident-loop.py` 的 R2 机制消费/复现）。


**铁律 47. 契约优先。** 新增 compute 函数必须先定义输入/输出/降级契约（JSDoc），再实现。参见 SYNOVA-ARCH-质量与测试体系-20260707.md §二。
**铁律 48. 测试不可为空壳。** 测试文件必须有 expect() 断言。空壳测试 → commit 阻断。每个 compute 函数至少覆盖：正常路径 + 降级路径 + 边界条件。

**铁律 49（D534 新增）. 决策必须沉淀。** 非平凡变更（治理脚本/铁律/规则文档）的 commit 必须引用 memory/notes/ 四态 Note（commit-msg 物理门禁）；新决策写 proposed/，落地 git mv 到 implemented/，否决 rejected/，过时 archived/。规范见 `memory/notes/README.md`。

### 一、接线铁律

**铁律 1. 垂直切片交付。** 按用户可见的行为拆，不按技术层拆。

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


---

## 项目身份

**产品**: SynovaAgent — 组织数字孪生诊断 + 持续增长导航系统。
**定位**: 独立 Agent 进程，通过 HTTP API + MCP 对外服务；**桌面端**（Electron，品牌表层，施工图 🟢）：能装/能开/能用 8 验证点已闭环（切片 A/B/C，2026-08-25）。
**市场**: 5-1000人团队的组织诊断与增长导航。

**两大核心系统**:
1. **GA 按需诊断** — 用户触发，6阶段管道，全部测量器+专家 → 综合诊断报告
2. **Sentinel 定时哨兵** — Cron 自动，基线对比+异常检测 → 信号聚合 → 专家 → 工单

**五层架构**:
```
L1 交互    → routes/ (API), tui/ (终端), mcp/ (MCP协议)
L2 编排    → agent/ (ConversationEngine, diagnosis-launcher, sentinel-service)
              orchestrator/ (SubAgentCoordinator, ModuleRunner)
L3 洞察    → l3/ (ExpertDispatcher, ExpertAutonomy, QualityFirewall)
              sentinel/ (Runner, SignalAggregator, Registry, 加载器; 45 文件驱动哨兵@extensions/sentinels + 4 内置适配器 = 49)
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

### 执法架构: 三层精简（D1146: CC 侧 hook 层已退役）

```
📋 任务启动 (人工)   →  task-start.sh — 3 问翻译意图→规格
🔴 提交阻断 (自动)    →  pre-commit 13 组 — 本地软提示，CI 权威（SYNO_CI strict）
🚀 推送阻断 (自动)    →  pre-push 门禁 0-5 — 多机同步 + secrets + golden-case + vitest + tag 校验
```

| 时机 | 脚本 | 阻断 | 耗时 |
|------|------|------|------|
| pre-commit | pre-commit-check.sh (13 组) | 本地 ⚠️ 软提示（D515）；CI 权威硬阻断（SYNO_CI strict，D516） | <10s |
| pre-push | pre-push-check.sh (门禁 0-5) | 🔴 阻断 | <3s |

> **D1146（2026-10-05，CC 退役）**：`.claude/settings.json` 的 `hooks` 段与 `.codex/hooks.json` 共 **11 个登记点已归零**
> （写前拦截不另起机制），`scripts/hooks/hook-session-start.sh`、`scripts/workflow/hook-post-tool-use.sh`
> 两个零执行方脚本已删除。原 PreToolUse/PostToolUse 承载的目的改由**提交端**承担：
> task brief 字段 = pre-commit 组 6 ／ 接线完整性 = 组 4 ／ 权威判定 = CI 12 必需 context。
> `verify-incremental.sh`、`baseline-check.sh` 仍在仓库内，只能**手工**触发。

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
> **D1146**: SessionStart/PreToolUse/PostToolUse 登记点已归零（见上文"执法架构"），
> 会话内提醒职责改由 DSH 会话指令承担。

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

### PreToolUse / PostToolUse Hook — **已退役**（D1146，2026-10-05）
- 原 CC 侧写前拦截（task brief 字段检查 + 接口真实性反向验证）与写后验证（`verify-incremental.sh`
  自动跑 + `.Codex/loop-state.json` 循环计数）随 CC 退役**登记点归零**（11 → 0）——
  `.claude/settings.json` hooks 段清空、`.codex/hooks.json` 删除。
- 同一目的改由**提交端**承担：task brief 6 核心字段 = pre-commit 组 6；接线完整性 = 组 4；
  权威判定 = CI 12 必需 context；会话内提醒 = DSH 会话指令。
- 手工触发（不再是自动 hook）：`bash scripts/workflow/verify-incremental.sh`（L1 oxlint → L2 tsc
  → L3 vitest --changed → L4 接线审计）、`bash scripts/control-tower/baseline-check.sh`（基准对比，
  有偏差仅告警不阻断）。

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
- **task brief 必须先填** — pre-commit 组 6 强制（D1146 后：原 PreToolUse hook 登记点已退役）。7字段(项目身份/Q1调研/Q2范围/Q3验收/架构层级/文档引用/接口审计) 全部非空才能写代码
- **接口审计从代码 grep，不凭记忆** — grep 反向验证（原 hook 已退役，改为提交前自检 + CI 组 4），虚假接口拒绝写代码
- **每写一个文件，自动验证** — 手工跑 `bash scripts/workflow/verify-incremental.sh`（原 PostToolUse hook 登记点已退役）：vitest --related + 接线审计。失败自动进入修正循环
- **循环最多5轮** — verify-incremental.sh 记录轮次，5轮不过停止等人工
- **接线审计是硬门禁** — 新 export 必须在生产入口有引用
- **逐项 commit** — 单模块独立提交，不批量
- **改完列清单** — 文件 + 行号 + 为什么改
- **部署后验证** — `bash scripts/workflow/checkpoint-deploy.sh` curl 外部 URL




