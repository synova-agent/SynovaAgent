# Task Brief: D312: 控制塔 V4.6.0 M2 hook×git 兼容 + 官方基线工具 + U4 — hook-git-detect + hook-git-guard + baseline-check + 禁 stash 铁律

> 生成: 2026-08-03 | 分支: feat/prompt-architecture | as any: 0
> 依据: 设计文档 docs/plans/codex/strategy/SYNOVA-DESIGN-控制塔V4.6-独立化-20260802.md §2.2 M2 + §2.5 + §2.8 U4 (v1.4, 用户已确认: Bash matcher + 同步 Codex 侧, 只做 M2+U4)

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

目标: 成为组织诊断的 AWS。每个新客户、新行业、新数据源 → 加文件即可，不改代码。
能文件化的必须文件化。不能文件化的必须有明确的扩展点。

### 三层解耦体系

**纵向解耦：五层物理隔离**
代码按 L1-L5 架构分层，每层只与相邻层通信。L1 交互层不知道 L4 用什么数据库，L3 洞察层不知道 L5 数据存在哪。换底层存储，上层零改动。pre-commit 物理阻断跨层 import——L2→L4 的代码提交不进去。

**横向解耦：11 个独立 Monorepo 包**
五层内部拆为独立包：@synova/sog-core（本体图类型）、@synova/sentinel-engine（哨兵调度）、@synova/expert-platform（专家加载）、@synova/connector-registry（数据连接器）。每个包接口边界明确，拆卸一个不影响其余 19 个。核心包已落地运行；已存在的功能规划从 src/ 迁移到独立包；未来新增须遵循此结构。

**扩展解耦：文件驱动，不改代码**
新增能力靠文件，不靠改代码：
- 新 AI 专家 = 新建目录 + 10 个 Markdown 文件 → 自动注册到 ExpertDispatcher
- 新诊断哨兵 = 加 xxx-sentinel.ts → builtins 自动扫描加载
- 新行业 = 加行业目录（基准数据+阈值+案例库）→ 1-2 天上线，零 TypeScript 改动
- 新本体实体类型 = 加 JSON Schema 文件

流程约束: V4.6.0-WIP — task brief 6 字段强制 + 免疫系统 + plan.json + 12 组物理阻断 + Plan-Actual 闭合 + engine-core 清零 + 时间戳顺序检查 + M1 多会话协调(D311) + M2 hook×git 兼容(D312)。

数据流: L5 存储 → L4 本体 → L3 洞察(哨兵定时+诊断按需) → L2 编排 → L1 交互
        反馈闭环: GA评审/客户反馈 → 记忆层 → 数据层
        Sentinel Finding[] → 诊断引擎 Phase 2 → 8 位文件驱动专家解读

L1 入口: POST /api/diagnosis/consult (GA诊断) / Cron→Sentinel.check() (哨兵) / GET /chat (Web) / MCP
五层架构 (只能向下依赖相邻层):
  L1 交互: routes/ tui/ mcp/
  L2 编排: agent/ orchestrator/
  L3 洞察: l3/ sentinel/ expert-platform/ expert/ (8位文件驱动专家: strategy org finance tech marketing action business_model knowledge)
  L4 本体: l4/ evidence/ 企业事实层: AgentMemoryStore (enterprise_fact, 版本化+superseded_by链)
  L5 存储: store/ cron/
三层粒度: 专家→哨兵→计算。哨兵=可独立告警的最小子领域。compute=纯数学函数。
L0 进化: evolution/ 两路反馈→候选池→确认/执行验证→写入知识库
文件化扩展: expert/ knowledge/shared/ theory/ skills/ — 新增=加文件,不改代码
数据安全: L0公开摘要→L1聚合信号→L2脱敏证据→L3原始数据(仅客户内Agent可见,GA不可见)
引擎: packages/engine-core/ (Novis遗产,逐步迁移)。禁止src/新增engine-core引用(铁律46)。
安全: security/ (PIIScrubber, DataBoundary)
LLM: providers/ (DeepSeek, OpenAI, Gateway)

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属于三层解耦的哪一层？
- [x] 纵向（改 L1-L5 代码/架构）— 无，控制塔是基础设施（scripts/hooks/ + .claude/ + .codex/）
- [ ] 横向（迁移到独立包 / 新建包）
- [ ] 扩展（文件驱动，不改 TypeScript）

本任务属于**基础设施/控制塔**系统。控制塔 V4.6.0 独立化第二阶段（M2 hook×git 兼容 + 官方基线工具），根治 08-02 stash 事故（git stash/pop 间隙被 hook 写文件 → pop 冲突，39 tracked + 615 untracked 卷入）+ U4（pre-commit 分母不一致）。

### b) 文件审计（2026-08-03 全部实测）
grep 本任务关键词（stash / baseline / hook-git）在 scripts/ 与 .claude/ 中：

| 资产 | 实测状态 |
|------|---------|
| `.claude/settings.json` hooks 块 L82-94 | 仅 1 个 PreToolUse matcher "Write\|Edit" → hook-block-write.sh；PostToolUse/SessionStart 未挂载 |
| `scripts/workflow/hook-block-write.sh` (349 行) | L37 写 workflow-state.json / L39 rm session-locked / L240 写 /tmp 证据 / **L323 无条件写 cp1-criteria.json**；L16-26 从 stdin 解析 tool_input.file_path（不看 command） |
| `scripts/hooks/hook-check-memory.sh` (160 行) | L118 sed -i 改 memory/*.md / L136-144 追加 STATE.md；不看命令内容 |
| `scripts/workflow/hook-check-task-scope.sh` (181 行) | L23-34 stdin 解析 tool_input.file_path（统一模式先例） |
| `scripts/workflow/verify-incremental.sh` (221 行) | L2 tsc 无基线豁免；L3 手动文件映射（非 --changed） |
| `grep stash scripts/` | 仅 pre-doc-audit.sh L34-35 计数 stash list，零检测零阻断 |
| `AGENTS.md` | 零 stash 提及；L167 引用不存在的 check-baseline.sh（文档漂移） |
| tsc 存量错误 | **实测 29 条**：extensions/sentinels/_extinct/ 25 条（TS2307×20 + TS7006×5）+ src/ 4 条（ima.ts:143 / middle-evolution-engine.ts:138 / server.ts:394+395） |
| `scripts/pre-commit-check.sh` U4 | L3/L12 声称"9 组"；L208/253/339/353/413/494/591/676 显示 `组 X/8`、L682 `组 9/9`、L711 `组 10/11`、L785 `组 12/12`（唯一正确）；L936 成功消息 12 组 |
| `.codex/control-tower/baseline/` | 不存在（需新建） |
| `.codex/control-tower/` | 已有 VERSION.md / locks/ / logs/degraded-events.log / tmp/ |
| `.codex/hooks.json` | Codex 侧镜像 hook 配置（PreToolUse Edit\|Write → 同一批 hook）— 需同步挂载 |
| baseline 先例 | `scripts/checks/check-empty-modules.sh`（存量 warn / 增量 hard-block）+ CI test job 映射逻辑（ci.yml L44-65） |

**无冲突**：D313-D314（后续任务）零共享文件；本任务写集仅 scripts/hooks/ 新文件 + 2 个写 hook + settings.json + .codex/hooks.json + pre-commit 文本 + pre-push + AGENTS.md + VERSION.md。

### c) 决策
- 复用：hook-block-write.sh 的 stdin 解析模式、hook-check-task-scope.sh 同构、checkpoint-impl.sh 的 tsc 过滤范式、verify-parallel.sh 的 fail-open/log_degraded 范式、session_registry.py 的 degraded 日志
- 新建：hook-git-guard.sh + hook-git-detect.sh + baseline-check.sh + 3 个测试
- 修改：settings.json + .codex/hooks.json + hook-block-write.sh + hook-check-memory.sh + pre-commit-check.sh（U4 文本）+ pre-push-check.sh（门禁 6）+ AGENTS.md + VERSION.md
- 冲突：无

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
本任务按以下顺序执行，每一步完成后才能进入下一步：
  ① SPEC — 设计文档 §2.2 M2 + plan 已批准（cheeky-twirling-scott.md）
  ② 测试 — 阶段 0 落 3 个测试（red）：baseline-check.test.sh / hook-git-detect.test.sh / ban-stash.test.sh
  ③ 实现 — 阶段 1 guard → 阶段 2 hook-detect + 挂载 + 写 hook 包裹 → 阶段 3 baseline-check → 阶段 4 U4+文档
  ④ 接线 — settings.json + .codex/hooks.json 挂载 + pre-push 门禁 6 + grep 物理验证
  ⑤ 验证 — 模拟 stash 拦截 / 真实 stash+pop 回归 / 基线存量+新增 / U4 全量 pre-commit / vitest ≤1 次

引用依据（至少引用两项）：
  - 铁律 0-2: spec → test → impl → wire → review → merge（设计文档 §2.5 测试先行强制）
  - 铁律 7: 入口可触达（Bash matcher 触发 hook-git-detect / pre-push 触发 baseline-check）+ 链路走通 + 结果可见（提示文案）
  - 铁律 24+31: fail-open（hook 永不阻断业务 exit 0 + degraded 记录，绝不静默）
  - memory/ 历史教训: [[plan-actual-closure]] — 声明完成必须对比文档；[[stub-implementation-pattern]] — 测试非空壳（≥3 断言）
  - D300/D311 教训: brief 格式按解析器实测（架构层标题带冒号、Q2 排除项带具体文件名、写集独立行）；跨天 brief mtime 需 touch

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
  - rule: "hook-git-detect.sh 必须被 settings.json 和 .codex/hooks.json 引用（Pre+Post 各 ≥1）"
    verify: "grep -c 'hook-git-detect' .claude/settings.json .codex/hooks.json"
  - rule: "hook-git-guard.sh 必须被 hook-block-write.sh 和 hook-check-memory.sh source"
    verify: "grep -n 'git_op_window_active' scripts/workflow/hook-block-write.sh scripts/hooks/hook-check-memory.sh"
  - rule: "baseline-check.sh 必须被 pre-push-check.sh 引用"
    verify: "grep -n 'baseline-check' scripts/pre-push-check.sh"
  - rule: "U4 修复后 pre-commit 全部 12 组通过且分母统一"
    verify: "grep -c '组 [0-9]*/12' scripts/pre-commit-check.sh"

## Q2: 范围 — 正确的最简方案是什么？

做什么（严格按已批准 plan cheeky-twirling-scott.md）：
- scripts/hooks/hook-git-guard.sh：git 操作写窗口守卫库（git_op_window_active/enter/exit + TTL 300s + 标记文件）
- scripts/hooks/hook-git-detect.sh：PreToolUse(Bash)+PostToolUse(Bash) hook（classify_command → stash/gitop/none；ban-stash 提示；写/清窗口；exit 0 永不阻断）
- scripts/control-tower/baseline-check.sh：三基线工具（tsc/测试失败/审计；快照基线法存量 vs 新增；--seed/--update-baseline/--json；SYNO_ 注入缝；fail-open）
- scripts/workflow/hook-block-write.sh：source guard + SKIP_HOOK_WRITES 包裹 L37/L39/L323（L240 /tmp 不包裹）
- scripts/hooks/hook-check-memory.sh：source guard + 包裹 L118/L136-144
- .claude/settings.json：PreToolUse + PostToolUse 新增 Bash matcher → hook-git-detect.sh
- .codex/hooks.json：同步同款（Codex 侧镜像）
- scripts/pre-commit-check.sh：U4 分母修复（L3/L12/L194 9→12 + 10 处分母 → /12，纯文本零逻辑）
- scripts/pre-push-check.sh：门禁 6 baseline-check.sh --tsc（新增>0 → YELLOW 警告不阻断）
- AGENTS.md：禁止 stash 铁律 + check-baseline.sh → baseline-check.sh 修正
- .codex/control-tower/VERSION.md：追加 D312 变更记录
- .codex/control-tower/baseline/：目录 + 真实 seed（29 条 tsc 存量）
- tests/control-tower/baseline-check.test.sh
- tests/control-tower/hook-git-detect.test.sh
- tests/control-tower/ban-stash.test.sh

不做什么（含文件路径）：
- 不改 src/server.ts（预存 2 条错误归 D309/D310 清理）
- 不改 src/connectors/ima.ts（预存错误归 D310）
- 不改 src/loops/middle-evolution-engine.ts（预存错误归 D310）
- 不改 extensions/sentinels/_extinct/adaptation-velocity/aggregate.ts（预存 25 条错误归 D310）
- 不做 M3（brief 契约）、M4（基线豁免阻断）、M5（UTF-8/静默吞错）——归 D313-D314
- 不改 scripts/control-tower/write_lock.py（D209）
- 不改 scripts/control-tower/session_registry.py（D311）
- 不改 scripts/control-tower/verify-parallel.sh（D311）
- 不改 scripts/control-tower/staging_guard.py（D311）
- 不改 scripts/control-tower/wait_manager.py（D311）
- 不改 tests/control-tower/test-session-registry.py（D311）
- 不改 tests/control-tower/test-staging-guard.py（D311）
- 不改 tests/control-tower/test-wait-manager.py（D311）
- 不改 tests/control-tower/verify-parallel.test.sh（D311）
- 不引入真常驻 daemon（延后产品化阶段）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：
- Bash 命令 `git stash` / `git checkout` / `git reset` 等 → PreToolUse Bash matcher → hook-git-detect.sh（提示 + 窗口）
- `git push` → pre-push-check.sh → 门禁 6 baseline-check.sh --tsc
- 手动 `bash scripts/control-tower/baseline-check.sh --tsc/--seed/--update-baseline`

处理（中间经过哪些步骤）：
1. hook-git-detect.sh：stdin JSON 解析 tool_input.command → classify → stash（ban 提示 + 窗口）/ gitop（一行提示 + 窗口）/ none（无副作用）→ exit 0
2. 窗口激活期间 Write/Edit → hook-block-write.sh / hook-check-memory.sh 跳过仓库内写文件（workflow-state/session-locked/cp1-criteria/memory/STATE）
3. PostToolUse --post → 清窗口
4. baseline-check.sh：采集当前输出 → 解析 key → vs baseline/ 快照 → 存量/新增/已修复 → 输出 + exit
5. pre-commit U4：12 组分母统一

结果（最终展示在哪）：
- stash 提示含替代方案（baseline-check.sh / worktree / synova-commit）
- hook 写跳过时输出一行说明（不静默）
- baseline-check 输出 "存量 N 条 + 新增 M 条" + 判定
- pre-commit 显示 `组 X/12`

## 架构层: 基础设施
L1-L5 之外 — 控制塔（scripts/hooks/ + scripts/control-tower/ + .claude/ + .codex/）。不触产品架构层代码。

## Done 标准
- [ ] 入口可触达: settings.json + .codex/hooks.json 均含 hook-git-detect（grep ≥2 each）；pre-push 含 baseline-check（grep 命中）
- [ ] 链路走通: 3 个测试 red→green 全过；模拟 stash 拦截 + 写文件跳过实测 + --post 清窗；真实 stash+pop 回归零冲突
- [ ] 结果可见: stash 提示含替代方案；baseline-check 输出存量/新增；degraded-events.log 有 fail-open 记录
- [ ] U4: pre-commit 全部 12 组通过且分母统一 /12；全量 pre-commit 行为零变化（git diff 审查）
- [ ] 基线: 真实 seed 29 条 tsc 存量 → 再跑"存量 29 + 新增 0"
- [ ] 测试非空壳（≥3 断言/文件）；vitest 全量 ≤1 次
- [ ] pre-commit 12 组通过；自吃狗粮提交走 synova-commit 显式路径；推送 CI
