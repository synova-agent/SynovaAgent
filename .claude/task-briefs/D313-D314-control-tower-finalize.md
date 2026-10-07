# Task Brief: D313+D314: 控制塔 V4.6.0 收尾 — M3 brief 契约 + M5 编码 + M4 基线豁免 + 独立化底座 + 日志五件套 + 学习闭环

> 生成: 2026-08-03 | 分支: feat/prompt-architecture | as any: 0
> 依据: 设计文档 docs/plans/codex/strategy/SYNOVA-DESIGN-控制塔V4.6-独立化-20260802.md §2.2 M3/M4/M5 + §2.5 + §2.7 + §四 (v1.4, 用户确认: 合并 plan / 只豁免 tsc / Claude 侧挂载 verify-incremental)

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

流程约束: V4.6.0-WIP — task brief 6 字段强制 + 免疫系统 + plan.json + 12 组物理阻断 + Plan-Actual 闭合 + engine-core 清零 + 时间戳顺序检查 + M1-M5 全机制。

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
- [x] 纵向（改 L1-L5 代码/架构）— 无，控制塔是基础设施（scripts/ + .claude/ + .codex/）
- [ ] 横向（迁移到独立包 / 新建包）
- [ ] 扩展（文件驱动，不改 TypeScript）

本任务属于**基础设施/控制塔**系统。控制塔 V4.6.0 独立化**收尾**（M3 brief 契约 + M5 编码 + M4 基线豁免 + 独立化底座 + 日志五件套 + 学习闭环），全面修复 D313/D314 审计发现的漂移点，最终 V4.6.0 首发。

### b) 文件审计（2026-08-03 3 个 Explore 实测）
grep 本任务关键词（#CRITERIA / brief_parser / silent-swallow / attach / self-health / incident-loop / UTF-8）在 scripts/ 与 .codex/ 中：

| 资产 | 实测状态 |
|------|---------|
| `generate-task-brief.py` | 版本 V4.5.0 落后；`## 本任务在哪一层` 无冒号（实际 brief 全用 `## 架构层:`）；**无 #CRITERIA 字段** |
| Q2 解析器双副本 | pre-commit-check.sh L822-856 awk vs resolve-commit-brief.sh L53-74 python——**必须同源** |
| 解析器测试 | 无（tests/ 无 brief 解析器测试） |
| `check-brief-parseable.sh` | 不存在（M3 交付物） |
| `check-dev-doc-write-set.sh` | 不存在（M3b 交付物） |
| UTF-8 | 40 个 CI .sh 零设置；27/32 个 .py 无 stdout reconfigure |
| `2>/dev/null` | 622 处（79 文件），双重静默 194 处；diagnosis-quality-check.sh L124 注释自证假绿 |
| `check-silent-swallow.sh` | 不存在（M5b 交付物） |
| `verify-incremental.sh` | L2 tsc 全量阻断无豁免（L87-101）；L3 无次数限制；头部 V4.5.1 |
| Claude 侧挂载 | settings.json 无 SessionStart、无 PostToolUse verify-incremental（仅 Codex 侧 .codex/hooks.json 有） |
| `hook-session-start.sh` | 存在（42 行流程锁）但未挂载 |
| `baseline/tsc-errors.json` | 已存在（D312 seed 28 条） |
| `product-health.py` | 五维框架可复用（check_*/classify_trust/emit_signal） |
| 日志五件套 | 仅 degraded-events.log 有 1 条；runtime/gate/incident/version 全空白 |
| `VERSION.md` | V4.6.0-WIP 两段（D311/D312），标注"正式首发在 D314" |
| `completion-engine.py` | 六条件引擎 + known-error-patterns.json 可复用（学习闭环） |

**无冲突**：本任务写集仅 scripts/control-tower/ + scripts/workflow/ + scripts/hooks/ + .claude/settings.json + .codex/ 状态文件。

### c) 决策
- 复用：baseline-check.sh（存量算法）、product-health.py（五维框架）、verify-parallel.sh（写集解析）、emit-signal.py（信号）、completion-engine.py（known-error-patterns）
- 新建：brief_parser.py / devdoc_writeset.py / check-brief-parseable.sh / check-dev-doc-write-set.sh / check-silent-swallow.sh / control_tower_log.py / attach.py / self-health.py / incident-loop.py + 6 个测试
- 修改：generate-task-brief.py / pre-commit-check.sh / resolve-commit-brief.sh / check-brief-vs-code.sh / hook-block-write.sh / verify-parallel.sh / verify-incremental.sh / hook-session-start.sh / settings.json
- 冲突：无

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
本任务按以下顺序执行，每一步完成后才能进入下一步：
  ① SPEC — 设计文档 §2.2 M3/M4/M5 + plan 已批准（cheeky-twirling-scott.md）
  ② 测试 — 阶段 0 落 6 个测试（red）：brief-parseable / write-set-check / utf8 / baseline-exemption / daemon-smoke / incident-loop
  ③ 实现 — 阶段 A brief 契约 → B 写集验证 → C M5 编码 → D M4 豁免 → E 独立化 → F 学习闭环
  ④ 接线 — 物理验证 grep 矩阵（plan 第 9 节）
  ⑤ 验证 — 17 条验收 + 6 测试 green + 全回归 + vitest ≤1 次

引用依据（至少引用两项）：
  - 铁律 0-2: spec → test → impl → wire → review → merge（设计文档 §2.5 测试先行强制）
  - 铁律 7: 入口可触达（SessionStart 触发 attach / pre-commit 组 12 触发 parseable）+ 链路走通 + 结果可见
  - 铁律 24+31: fail-open（所有新组件自身异常 → degraded + 不阻断，绝不静默）
  - 铁律 35: 自动化优先（check-silent-swallow 扫描器 → 守门，不靠 review）
  - memory/ 历史教训: [[plan-actual-closure]] + [[stub-implementation-pattern]] + D300/D311/D312 的 brief 格式教训（架构层带冒号、排除项带文件名、写集独立行）

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
  - rule: "brief_parser.py 必须被 ≥4 处引用（同源消灭双副本）"
    verify: "grep -c 'brief_parser' scripts/pre-commit-check.sh scripts/workflow/resolve-commit-brief.sh scripts/workflow/check-brief-vs-code.sh scripts/workflow/check-brief-parseable.sh"
  - rule: "check-brief-parseable.sh 必须被 pre-commit 组 12 和 hook-session-start 引用"
    verify: "grep -c 'check-brief-parseable' scripts/pre-commit-check.sh scripts/hooks/hook-session-start.sh"
  - rule: "verify-incremental.sh L2 必须接 baseline-check.sh（tsc 豁免）"
    verify: "grep -n 'baseline-check' scripts/workflow/verify-incremental.sh"
  - rule: "attach.py 必须被 hook-session-start.sh 引用（SessionStart 挂载）"
    verify: "grep -n 'attach.py' scripts/hooks/hook-session-start.sh"
  - rule: "UTF-8 批量后 40 个 .sh 全带头块"
    verify: "bash scripts/workflow/check-silent-swallow.sh --utf8"

## Q2: 范围 — 正确的最简方案是什么？

做什么（严格按已批准 plan cheeky-twirling-scott.md）：
- scripts/control-tower/brief_parser.py：同源解析器库（Q2 include/exclude + #CRITERIA + 架构层 + Done + match_path；CLI + import 双模式；fail-open）
- scripts/control-tower/devdoc_writeset.py：dev doc 写集解析共享库（从 verify-parallel.sh 提取，4 形态清洗）
- scripts/workflow/check-brief-parseable.sh：M3 交付物（Q2 可解析/#CRITERIA 必填/架构层/Done ≥1/模板自检）
- scripts/workflow/check-dev-doc-write-set.sh：M3b 交付物（写集声明 vs 代码 grep，漂移 exit 1）
- scripts/workflow/check-silent-swallow.sh：M5b 扫描器（level-0/1/2 + --strict/--utf8/--diff；报告器非修复器）
- scripts/control-tower/control_tower_log.py：日志五件套写入器（JSON Lines 原子追加）
- scripts/control-tower/attach.py：SessionStart 轻量 attach（register + 日志 + self-health 轻跑 + parseable；<2s fail-open）
- scripts/control-tower/self-health.py：自身健康五维（组件/信号/版本一致性/日志/资源），复用 product-health 框架
- scripts/control-tower/incident-loop.py：学习闭环（record/suggest/verify）
- scripts/workflow/generate-task-brief.py：版本 V4.6.0-WIP + `## 架构层:` + #CRITERIA: A + 半角冒号
- scripts/pre-commit-check.sh：L822-856 awk → brief_parser.py + 组 12 附挂 2 新检查 + 组 2 附挂 silent-swallow --diff + G10 CRITERIA warn
- scripts/workflow/resolve-commit-brief.sh：inline q2_scope → brief_parser.py
- scripts/workflow/check-brief-vs-code.sh：sed 提取 → brief_parser.py
- scripts/workflow/hook-block-write.sh：L298 架构层标题修复
- scripts/control-tower/verify-parallel.sh：inline 写集解析 → devdoc_writeset.py（行为零变化）
- scripts/workflow/verify-incremental.sh：L2 → baseline-check.sh --tsc + L3 verification-state + 头部 V4.6.0
- scripts/hooks/hook-session-start.sh：末尾 attach.py 调用（timeout 10）
- scripts/control-tower/synova-commit：D314 接线 — 提交前 self-health 快照（fail-open 不阻断）
- scripts/hooks/hook-check-memory.sh：D313 M5 UTF-8 头块（批量收尾）
- scripts/hooks/hook-git-detect.sh：D313 M5 UTF-8 头块（批量收尾）
- .claude/settings.json：SessionStart + PostToolUse Write|Edit → verify-incremental + env 块
- .codex/control-tower/verification-state.json（只登记不接线）
- .codex/control-tower/baseline/ci-failures.json（只登记不接线）
- tests/control-tower/brief-parseable.test.sh
- tests/control-tower/write-set-check.test.sh
- tests/control-tower/utf8.test.sh
- tests/control-tower/baseline-exemption.test.sh
- tests/control-tower/daemon-smoke.test.sh
- tests/control-tower/incident-loop.test.sh
- .codex/control-tower/VERSION.md：V4.6.0 正式首发 + version.log

不做什么（含文件路径）：
- 不改 src/server.ts（预存错误归 D309/D310）
- 不改 src/connectors/ima.ts（预存错误归 D310）
- 不改 src/loops/middle-evolution-engine.ts（预存错误归 D310）
- 不改 extensions/sentinels/_extinct/adaptation-velocity/aggregate.ts（预存 25 条错误归 D310）
- 不改 scripts/control-tower/write_lock.py（D209）
- 不改 scripts/control-tower/session_registry.py（D311）
- 不改 scripts/control-tower/staging_guard.py（D311）
- 不改 scripts/control-tower/wait_manager.py（D311）
- 不改 scripts/control-tower/hook-git-guard.sh（D312）
- 不改 scripts/control-tower/hook-git-detect.sh（D312）
- 不改 scripts/control-tower/baseline-check.sh（D312 本体 — 只被 verify-incremental 调用）
- 不改 tests/control-tower/test-session-registry.py（D311）
- 不改 tests/control-tower/test-staging-guard.py（D311）
- 不改 tests/control-tower/test-wait-manager.py（D311）
- 不改 tests/control-tower/verify-parallel.test.sh（D311）
- 不改 tests/control-tower/hook-git-detect.test.sh（D312）
- 不改 tests/control-tower/ban-stash.test.sh（D312）
- 不改 tests/control-tower/baseline-check.test.sh（D312）
- 不修全部 622 处 2>/dev/null（check-silent-swallow 是扫描器非修复器；只修 D313 自身交付物 level-2 点）
- 不做 CI 基线判定接线（ci-failures.json 只登记，判定归后续）
- 不引入真常驻 daemon（延后产品化阶段）
- 不删 verify-dev-doc.sh（低影响，保留旧脚本）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：
- 新 session 启动 → SessionStart hook → hook-session-start.sh → attach.py（register + 日志 + self-health + parseable）
- `git commit`（synova-commit）→ pre-commit 组 12（brief 解析同源 + parseable + 写集验证）+ 组 2（silent-swallow --diff）
- Write/Edit 后 → PostToolUse verify-incremental.sh（L2 tsc 豁免）
- 手动 `bash scripts/workflow/check-brief-parseable.sh [brief]` / `check-dev-doc-write-set.sh [doc]` / `check-silent-swallow.sh [--strict|--utf8|--diff]`

处理（中间经过哪些步骤）：
1. attach.py：register session → runtime.log/gate.log → self-health 五维 → health.json → incident 未闭环提示 → <2s
2. pre-commit 组 12：brief_parser.py 解析 Q2 → 认领判定（同源）+ check-brief-parseable + check-dev-doc-write-set
3. verify-incremental L2：baseline-check.sh --tsc → 存量豁免 + 新增阻断 → verification-state.json
4. check-silent-swallow：扫描 2>/dev/null 分类 level-0/1/2 + --utf8 校验头块 + --diff 新行扫描

结果（最终展示在哪）：
- attach 输出 registry 条目 + 日志行 + health.json 五维状态
- pre-commit 显示 brief 解析通过/漂移清单/静默吞错报告
- verify-incremental L2 显示"存量 28 + 新增 0"通过 或 "新增 N 条"阻断
- VERSION.md V4.6.0 首发 + version.log 追加流

## 架构层: 基础设施
L1-L5 之外 — 控制塔（scripts/control-tower/ + scripts/workflow/ + scripts/hooks/ + .claude/ + .codex/）。不触产品架构层代码。

## Done 标准
- [ ] 入口可触达: settings.json SessionStart → hook-session-start → attach（grep 命中）；pre-commit 组 12 → brief_parser + 2 新检查（grep 命中）；Claude 侧 PostToolUse → verify-incremental
- [ ] 链路走通: 6 测试 red→green 全过；同源回归（resolve-commit-brief 认领 D312 一致）；verify-parallel 13/13 零变化；UTF-8 40.sh bash -n + 27.py py_compile
- [ ] 结果可见: attach 日志行 + health.json 五维；pre-commit 漂移/吞错报告；verify-incremental L2 存量豁免
- [ ] 验收 17 条逐条核对（fail-open 实测 / 版本一致性实测 / vitest ≤1 / 日志五件套 / VERSION.md 首发）
- [ ] 测试非空壳（≥3 断言/文件）；vitest 全量 ≤1 次
- [ ] pre-commit 12 组通过；自吃狗粮提交走 synova-commit 显式路径；推送 CI
