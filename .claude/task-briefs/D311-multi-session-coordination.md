# Task Brief: D311: 控制塔 V4.6.0 M1 多会话协调 — session-registry + verify-parallel + staging-guard + wait-manager + synova-commit 暂存区隔离 + pre-push 改基

> 生成: 2026-08-02 | 分支: feat/prompt-architecture | as any: 0
> 依据: 设计文档 docs/plans/codex/strategy/SYNOVA-DESIGN-控制塔V4.6-独立化-20260802.md §2.2 M1 (v1.4, 用户已确认: 只做 D311, Python 技术栈, hook 轻量触发)

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

流程约束: V4.6.0-WIP — task brief 6 字段强制 + 免疫系统 + plan.json + 12 组物理阻断 + Plan-Actual 闭合 + engine-core 清零 + 时间戳顺序检查 + M1 多会话协调（本任务交付）。

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
- [x] 纵向（改 L1-L5 代码/架构）— 无，控制塔是基础设施（scripts/ + .codex/），不触 src/ 产品代码
- [ ] 横向（迁移到独立包 / 新建包）
- [ ] 扩展（文件驱动，不改 TypeScript）

本任务属于**基础设施/控制塔**系统（研发门禁，非 GA诊断/哨兵产品代码）。控制塔 V4.6.0 独立化第一阶段（M1 多会话协调），直接消除 D300/D292 复盘确认的 70% 效率损失根因 R1（多会话共享工作区无协调）：D292 覆盖 D300 brief、D286 commit 卷走 D300 暂存、并行 src/ 中间态污染 push 验证、并行空等 7h。

### b) 文件审计（2026-08-02 全部实测）
grep 本任务关键词（session-registry / staging-guard / wait-manager / verify-parallel / --changed）在 scripts/ 与 .codex/ 中：

| 资产 | 实测状态 |
|------|---------|
| `scripts/control-tower/write_lock.py` (D209) | ✅ 存在 — WriteLock acquire/wait/release/超时/孤儿清理/降级，**复用不新写** |
| `scripts/control-tower/synova-commit` (D201) | ✅ 存在 — git commit 唯一入口；L268 git add / L345 git commit（无显式路径） |
| `scripts/workflow/resolve-commit-brief.sh` (D296) | ✅ 存在 — 认领制 brief 解析（session_id 身份来源） |
| `scripts/pre-push-check.sh` | ✅ 存在 — 3 门禁；L62 vitest --changed 无 diff 基准（改基目标） |
| `.codex/control-tower/` 状态目录 | ❌ 不存在 — 本任务新建 |
| `verify-parallel.sh` / `staging-guard` / `wait-manager` / `session-registry` | ❌ 均不存在 — 本任务新建 |
| `.claude/settings.json` hooks | 仅 1 个 PreToolUse hook — **本任务不改**（SessionStart 归 D314） |
| dev doc 写集表格式 | ✅ 实测确认：`### 3.1 写集 (N 修改 + M 新建)` + markdown 表；第一列 4 形态（纯路径/链接/行号/计数/目录） |
| `tests/control-tower/` | ✅ 9 个测试（unittest + vitest 双框架）— test-write-lock.py 是结构先例 |

**无冲突**：D312-D314（后续任务）零共享文件；本任务写集仅 scripts/control-tower/ 新文件 + synova-commit + pre-push-check.sh + tests/control-tower/。

### c) 决策
- 复用：write_lock.py（锁）、resolve-commit-brief.sh（身份）、emit-signal.py（信号，如需）
- 新建：4 个组件 + 4 个测试 + .codex/control-tower/ 状态目录
- 修改：synova-commit（M1b 集成点）、pre-push-check.sh（改基+门禁 4/5）
- 冲突：无

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
本任务按以下顺序执行，每一步完成后才能进入下一步：
  ① SPEC — 设计文档 §2.2 M1 + plan 已批准（cheeky-twirling-scott.md）
  ② 测试 — 阶段 0 落 4 个测试（red）：test-session-registry / verify-parallel.test.sh / test-staging-guard / test-wait-manager
  ③ 实现 — 阶段 1-4 组件（green）→ 阶段 5 synova-commit 集成 → 阶段 6 pre-push 改造
  ④ 接线 — 真实调用方矩阵（synova-commit + pre-push-check.sh，grep 物理验证）
  ⑤ 验证 — 场景 A-E 端到端 + 测试全绿 + vitest 全量 ≤1 次（M4b 教训）

引用依据（至少引用两项）：
  - 铁律 0-2: spec → test → impl → wire → review → merge（设计文档 §2.5 测试先行强制）
  - 铁律 7: 入口可触达（synova-commit 提交触发 staging-guard / pre-push 触发 verify-parallel）+ 链路走通 + 结果可见（阻断信息）
  - 铁律 24+31: fail-open 哲学（组件自身异常 → 不阻断 + degraded-events.log + 明确输出，绝不静默）
  - memory/ 历史教训: [[cross-session-brief-pollution]] — 认领制与暂存区隔离正是本任务交付；[[stub-implementation-pattern]] — 测试非空壳（≥3 断言）
  - D300 教训: 全量 vitest 跑 5 次浪费 85 分钟 → 本任务全量 ≤1 次；brief 格式按解析器实测（架构层标题带冒号）

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
  - rule: "session_registry.py 必须被 staging-guard/wait-manager/synova-commit/pre-push 至少 3 处引用"
    verify: "grep -rn 'session_registry' scripts/control-tower/synova-commit scripts/pre-push-check.sh scripts/control-tower/staging_guard.py | wc -l"
  - rule: "verify-parallel.sh 必须被 pre-push-check.sh 引用"
    verify: "grep -n 'verify-parallel' scripts/pre-push-check.sh"
  - rule: "staging_guard.py 必须被 synova-commit 引用"
    verify: "grep -n 'staging_guard' scripts/control-tower/synova-commit"
  - rule: "pre-push vitest 必须基于 origin 分支 diff（改基完成）"
    verify: "grep -n 'changed.*origin' scripts/pre-push-check.sh"

## Q2: 范围 — 正确的最简方案是什么？

做什么（严格按已批准 plan cheeky-twirling-scott.md；组件文件用下划线命名 — Python import 要求）：
- scripts/control-tower/session_registry.py：底座（register/write-set/claimants/attribution/gc/phase/list + fail-open + 损坏自愈 + 原子写）
- scripts/control-tower/verify-parallel.sh：并行声明物理验证（--doc-a/--doc-b/--check-declared/--scan-today/--json；4 形态写集清洗；fail-open）
- scripts/control-tower/staging_guard.py：暂存区隔离（他人写集文件 → block；自己 → pass；杂散 → warn；committed 忽略；fail-open）
- scripts/control-tower/wait_manager.py：并行等待管理（phase CP1-CP4 + status 错峰/依赖提示 + 等待显式化）
- .codex/control-tower/VERSION.md：V4.6.0-WIP 变更点占位（正式首发 D314）
- scripts/control-tower/synova-commit：新增 --session-id + staging-guard 硬阻断 + 显式路径 commit + 写集 committed + phase CP4
- scripts/pre-push-check.sh：门禁 3 改基（origin/feat/prompt-architecture..HEAD）+ 门禁 4 中间态警告 + 门禁 5 verify-parallel --scan-today
- tests/control-tower/test-session-registry.py
- tests/control-tower/verify-parallel.test.sh
- tests/control-tower/test-staging-guard.py
- tests/control-tower/test-wait-manager.py

不做什么（含文件路径）：
- 不改 .claude/settings.json（SessionStart hook 归 D314）
- 不改 scripts/pre-commit-check.sh（12 组物理阻断不动）
- 不改 scripts/control-tower/write_lock.py（D209 复用，不新写锁）
- 不改 src/cycles/cross-scale-validator.ts（D95 本体 — 只做并行协调，不触产品代码）
- 不做 M2（baseline-check/禁 stash）、M3（brief 契约）、M4（基线豁免）、M5（UTF-8/静默吞错）——归 D312-D314
- 不引入真常驻 daemon（延后产品化阶段，设计稿 v1.4 已修正）
- 不重写 scripts/ci/golden-case-checker.ts（D300 交付物）
- 不重写 scripts/ci/diagnosis-quality-check.sh（D300 交付物）
- 不改 tests/ci/golden-case-gate.test.ts（D300 交付物）
- 不改 tests/ci/golden-case-break-test.sh（D300 交付物）
- 不改 tests/ci/golden-case-checker.test.ts（D300 交付物）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：
- `scripts/control-tower/synova-commit`（git commit 唯一入口）→ staging-guard 暂存区隔离
- `scripts/pre-push-check.sh`（git push 触发）→ 改基 + 中间态警告 + 并行声明验证
- `verify-parallel.sh --doc-a/--doc-b/--scan-today`（手动/门禁触发）→ 并行声明物理验证

处理（中间经过哪些步骤）：
1. synova-commit：git add → staging-guard.py 校验（他人写集 → 阻断 + owner 归属；fail-open）→ pre-commit 12 组 → 显式路径 commit → 写集 committed + phase CP4
2. pre-push：secrets → golden-case F1 → vitest --changed origin/..HEAD（改基，只测本次推送）→ 门禁 4 中间态警告 → 门禁 5 并行声明验证
3. verify-parallel：解析 dev doc 写集表 → 清洗（链接/行号/计数/目录）→ 两两比对 → 交集 → block + 重叠文件

结果（最终展示在哪）：
- commit 被阻断时显示 "❌ 暂存区含他人文件: src/x.ts (属于 session DXXX)"
- pre-push 显示 "vitest 基于 origin..HEAD" + 并行声明重叠警告/阻断
- verify-parallel exit 1 + 重叠文件清单；fail-open 时 degraded-events.log 有记录

## 架构层: 基础设施
L1-L5 之外 — 控制塔（scripts/control-tower/ + .codex/control-tower/）。不触产品架构层代码。

## Done 标准
- [ ] 入口可触达: synova-commit 触发 staging-guard（grep -n staging-guard scripts/control-tower/synova-commit 命中且 exit 1 阻断）；pre-push 触发 verify-parallel + 改基（grep 命中）
- [ ] 链路走通: 4 个测试 red→green 全过；场景 A-E 端到端验证通过（共享文件被拦/双 session 隔离/改基/ fail-open/自吃狗粮）
- [ ] 结果可见: 阻断信息含 owner 归属；degraded-events.log 有 fail-open 记录；VERSION.md 变更点已记录
- [ ] vitest 全量 ≤1 次（M4b 教训）；新测试均有 ≥3 断言（铁律 48）
- [ ] 接线验证: grep session-registry/staging-guard/wait-manager/verify-parallel 在 synova-commit + pre-push-check.sh 每项 ≥1
- [ ] tsc 零新增错误（预存 server.ts 2 处豁免）；vitest 定向 tests/control-tower/ 零失败
- [ ] pre-commit 12 组通过；自吃狗粮提交走 synova-commit 显式路径
