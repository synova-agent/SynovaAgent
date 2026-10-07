# Task Brief: D703 证据命令机器化 verify-doc.sh + CI 回放

> 生成: 2026-09-11 01:24:54 | 分支: main | as any: 0

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

流程约束: V4.5.0 — task brief 6 字段强制 + 免疫系统 + plan.json + 8 组物理阻断 + Plan-Actual 闭合 + engine-core 清零 + 时间戳顺序检查。

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
本任务在控制塔基础设施层（五层之外的工具链/CI 门禁域），不触 L1-L5 产品代码。
现状（spec §2 实测）：DS 证据命令是 markdown 字符串——scripts/ci/ 仅 4 文件且零回放机制，
.github/workflows/ci.yml 无「回放 dev-doc 证据命令」步骤；W2 引用不存在测试文件、
W4 声称 0 命中实测 2 命中，根因都是没人原样跑过（K3 W-1）。
新增：scripts/ci/verify-doc.sh 通用回放执行器 + verify-d703.sh 自证 + 密封测试；扩展：ci.yml 两处接线。
增长导航关联：DS 证据从「文档自述」升级为「机器可验」，直接提升「增长卡在哪里」结论的可信度——
诊断质量证据可信，增长导航建议才可信。

### b) 文件审计
grep/rg 审计（spec §2.1 S-14 实测）：
- scripts/ci/ 现有 4 文件（check-contract-gaps.sh / diagnosis-quality-check.sh / golden-case-checker.ts / golden-snapshot-runner.ts），零 verify-doc 机制
- rg "verify-d|verify-doc|evidence-command" scripts/ci/ .github/workflows/ 零命中 → 无重复造轮子
- scripts/control-tower/verify-* 是控制塔门禁（DSH 线），不回放 dev-doc 证据 → 不复用不冲突
- 关系：新建 3 文件（verify-doc.sh / verify-d703.sh / verify-doc.test.sh）+ 扩展 3 文件（ci.yml / 模板 .claude 侧 / 模板 .dsh 侧）

### c) 决策
无既有覆盖 → 新建轻量回放器（提取+白名单+逐条回放），不重写控制塔门禁。
多选项取舍走 DECISION-REFERENCE 四步框架，结论记 Q1c。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC：spec §6 DS1-DS8（机制落地/CI 接线/失败模式/red→green/零回归/类型安全/范围一致/无绕过）。
② 测试：tests/control-tower/verify-doc.test.sh 先红（脚本不存在）后绿，≥4 断言（铁律 0-2、48）。
③ 实现：verify-doc.sh 提取+白名单+回放引擎；verify-d703.sh 三 spec curation 回放。
④ 接线：ci.yml ①非 docs-only 路径 changed dev-doc → verify-dXXX.sh ②密封清单追加（铁律 7，grep 物理可证）。
⑤ 验证：自检 6 问 + DS1-DS8 逐条实测。
引用依据：spec docs/plans/codex/implementation/SYNOVA-IMPL-D703-evidence-command-mechanization-20260911.md；
AGENTS.md 铁律 35（自动化优先）；.github/workflows/ci.yml（docs-only 判定 :21-28 / 密封清单 :160-204）；
memory/2026-09-10-d658-sentinel-manifest-delivery.md（CI 红三分诊 job 级基线豁免）；
memory/2026-09-10-d662-expert-residual-sweep.md（tsc 错误集恒等判零新增）；
memory/2026-09-09-d650-expert-domain-rename-delivery.md（CI 失败归因先对 main 基线 job 级对照）。

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
- rule: "新 shell 测试必须追加进 ci.yml 密封 for 清单（不入列 = 永不执行，正是 W-1 要消灭的形态）"
  verify: "grep -n 'verify-doc.test.sh' .github/workflows/ci.yml"
- rule: "verify-doc.sh 对白名单外命令和危险元字符必须拒绝 exit 1（fail-closed，不静默）"
  verify: "bash tests/control-tower/verify-doc.test.sh"
- rule: "引用不存在测试文件的 DS 命令回放必须 exit 1（W2 真实事故形态作为 red 基准）"
  verify: "bash scripts/ci/verify-d703.sh（内含 DS3 断言：构造坏 doc → verify-doc.sh exit 1）"

### c) 决策参考系（遇到难决策/多选项/架构取舍/最佳实践/实现与文档冲突时）
决策点 1（命令白名单）：参考：Anthropic（fail-closed + 机器可验契约）+ 第一性原理（最少机制）+ 结论：
只读首 token 白名单 grep / git 只读子命令 / ls / sed -n / rg / npx vitest / npx tsc /
bash 仅限 verify 脚本与密封测试；危险元字符与重定向拒绝；尖括号占位形态显式 skip 带理由。
决策点 2（CI 触发）：参考：Anthropic（CI 权威门禁）+ 结论：changed dev-doc 按文件名提取 D 号匹配
scripts/ci/verify-dXXX.sh，存在则跑，缺省 warning skip（不跑全量历史 spec，防 CI 时长失控）。
收敛检查：两决策点两参考系均指向 fail-closed 最少机制，收敛。

### d) 相关 Note 引用
- [ ] 本任务决策沉淀：K3 W-1 证据机器化机制设计 → 收尾时写入 memory/（新建 proposed）

## Q2: 范围 — 正确的最简方案是什么？
不做什么（排除项）：
- 不改 scripts/control-tower/（铁律 0-5：开发者不改门禁判定）
- 不改 scripts/pre-commit-check.sh（既有 8 组门禁不动）
- 不改 scripts/workflow/check-dev-doc-write-set.sh（写集校验属控制塔域）
- 不建 scripts/ci/verify-d702.sh 与 verify-d704.sh（各自实现时自建）
- 不碰 src/ 全部目录（DS6 显式 descope：无 TS 变更）
- 不做 AST 级写操作吞错门禁（属 W-2/D702）

做什么（写集 3 修改 + 3 新建，另加 spec 回填）：
- scripts/ci/verify-doc.sh
- scripts/ci/verify-d703.sh
- tests/control-tower/verify-doc.test.sh
- .github/workflows/ci.yml
- .claude/skills/dev-doc-delivery/template/编码指令模板.md
- .dsh/skills/dev-doc-delivery/template/编码指令模板.md
- docs/plans/codex/implementation/SYNOVA-IMPL-D703-evidence-command-mechanization-20260911.md
## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：
① CI：PR 改动 dev-doc → quality job 新步骤（非 docs-only 路径）按文件名提取 D 号 → 匹配
scripts/ci/verify-dXXX.sh 原样回放（缺省 warning skip）；本卡另将 verify-doc.test.sh 入密封清单。
② 本地：bash scripts/ci/verify-doc.sh 加 dev-doc 路径参数 / bash tests/control-tower/verify-doc.test.sh
/ bash scripts/ci/verify-d703.sh。
处理（中间步骤）：提取 spec 完成标准与交付声明两节的反引号 DS 命令 → 只读白名单 + 危险元字符安全闸
（fail-closed）→ vitest 路径预检（引用不存在测试文件 → exit 1，W2 形态）→ 逐条原样回放。
结果（最终展示在哪）：全部通过或显式 skip → exit 0；任一失败或拒绝 → exit 1（CI job 红 + error 注解
定位到具体命令）；密封测试输出「结果: N 通过, M 失败」逐断言可见。

## 架构层: 基础设施（控制塔工具链域，五层之外，不触产品代码）
L1/L2/L3/L4/L5 均不涉及（无 TS 变更，DS6 descope）
#CRITERIA: A

## 文档引用
- docs/plans/codex/implementation/SYNOVA-IMPL-D703-evidence-command-mechanization-20260911.md（编码唯一契约：§3 写集 / §4 测试 / §6 DS1-DS8 / §7 自检）
- .github/workflows/ci.yml :21-28（docs-only 判定）、:160-204（密封测试 for 清单）
- docs/synova/coordination/DECISION-REFERENCE.md（决策参考四步框架）
- docs/synova/coordination/Win侧代码质量提升建议-20260909.md（W-1 权威来源）
- memory/2026-09-10-d658-sentinel-manifest-delivery.md、memory/2026-09-10-d662-expert-residual-sweep.md、memory/2026-09-09-d650-expert-domain-rename-delivery.md（CI 分诊与基线恒等判据）

## 接口审计
- scripts/ci/verify-doc.sh：用法 bash 加 dev-doc 路径参数；行为契约：提取两节命令 → 安全闸 → 逐条回放；exit 0 = 全过或显式 skip；exit 1 = 任一失败/拒绝（新文件，spec §3.1）
- scripts/ci/verify-d703.sh：无参自证脚本；回放 D702/D703/D704 三 spec 可机器化 DS 命令，不可机器化逐条 skip + 理由（新文件，spec §3.1）
- .github/workflows/ci.yml quality job 新步骤：消费 steps.docsonly.outputs.docs_only + git diff --name-only origin/main...HEAD 限定 docs/plans/codex/implementation/（既有 id: docsonly，:21-28 实测存在）
- .github/workflows/ci.yml 密封清单（:162-191 for 循环，现 29 条）追加 tests/control-tower/verify-doc.test.sh
- .claude/skills/dev-doc-delivery/template/编码指令模板.md 与 .dsh 侧逐字同步（组 13 md5 恒等），§四 复核清单追加机器可查项

## Done 标准
- [ ] verify: bash tests/control-tower/verify-doc.test.sh 全绿（≥4 断言，先 red 后 green 有实测输出）
- [ ] verify: grep -n "verify-doc" .github/workflows/ci.yml 命中 ≥2（执行步骤 + 密封清单）
- [ ] verify: bash scripts/ci/verify-d703.sh exit 0（D703 DS 回放全过 + D702/D704 显式 skip 带理由）且坏 doc 用例 exit 1（W2 形态）
- [ ] verify: npx tsc --noEmit 报错集与基线逐条恒等（零新增）+ pre-commit 本地干跑无新增硬阻断
- [ ] verify: git push 后 CI task-relevant jobs job 级绿
