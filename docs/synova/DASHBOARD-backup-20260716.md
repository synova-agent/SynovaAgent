---
title: "Synova Project Dashboard"
version: "v3.3"
date: "2026-07-15"
status: "Live. Based on 15 authoritative documents. D77 recovered and pushed."
purpose: "Global task tracking. Unified view of product, architecture, implementation, and research."
---

# Synova Project Dashboard

> Dev Docs: [implementation/](../plans/codex/implementation/) | Auth Docs: [research/](research/)
> Last updated: 2026-07-15 | 15 authoritative documents | D88-D90 dev docs ready
---

## Task Scheduling Three Principles (read before every dev doc)

| # | Principle | Meaning | Decision Rule |
|---|-----------|---------|---------------|
| 1 | **Infrastructure First** | Sentinels/Deployment/Prompt-engineering delivered before upper-layer UX | Dependency chain complete before starting upper tasks |
| 2 | **High-Frequency First** | Prioritize features users use daily (Navigation > Diagnosis > Operations) | Within same layer, sort by usage frequency |
| 3 | **Finish Module Before New** | Clear all D-series for one authoritative doc before starting next | Avoid 12+ modules in-progress simultaneously |

> Violating any principle requires explicit justification in Q0 decision of the dev doc.

> Chinese backup: [DASHBOARD-CN.md](DASHBOARD-CN.md)

---

## Zero: Completion Standard

> **Task "done" != code pushed. Done = 5 gates all pass + no regressions + wiring confirmed.**

| Gate | Standard | Verification |
|------|----------|-------------|
| G1 Compile | tsc --noEmit zero new errors | CI auto |
| G2 Test | vitest run zero new failures (known exemptions excluded) | CI auto |
| G3 Wiring | New export has caller in src/ or extensions/sentinels/ | grep auto |
| G4 Behavior | At least 1 integration/e2e test covers core path | Test file exists + has expect |
| G5 Gates | pre-commit 8 groups all pass | CI auto |

---

## Authoritative Document Inventory

| # | Document | Core Conclusion | Gaps |
|---|----------|----------------|------|
| 1 | [42 Edge Pool-Valve Causal System](research/Body-Layer-First-Principles-Reconstruction-20260709/SYNOVA-RESEARCH-Research-Results-Report-20260709.md) | 7KEEP/6MODIFY/7DELETE/29NEW, 24 scenarios 100% | I2(全Phase) + D1(EdgeType) |
| 2 | [15 Concept Node Pool System](research/权威文档01-本体层因果体系权威规范-20260714/) | 15 node pools+10 expression entities, SOGNodeType mapping | D14 delivered, expression aggregation formulas pending |
| 3 | [Sentinel-Compute-Ontology 3D Spec](research/权威文档03-哨兵-计算-本体-权威规范-20260710/) | 50 sentinels + 44 compute | T7+T7b+D7(架构修复)+D15(哨兵合并)+I2-P4(边引用迁移) |
| 4 | [Agent Engineering Capability Benchmark](research/权威文档07-Agent工程能力对标-20260710/) | 16 gaps: L2升级主Agent+5出厂内置循环+专家路由+冲突仲裁+推理预算+... | D5+D6(已完成)+D8-D23(16项,含L2主Agent升级) |
| 5 | [Agent Proactive Interaction Blueprint](research/权威文档05-Agent主动交互系统蓝图-20260710/) | 6 modules, 15 new components | D8(Module5-Action)+D17-D21(Module1-4,6) |
| 6 | [Test System Authoritative Spec](research/权威文档06-测试体系权威规范-20260710/) | @contract/contract testing/5 golden cases | D24(@contract补全)+D25-D28(契约测试/traversal YAML/黄金案例/38铁律) |
| 7 | [Data Layer Authoritative Spec](research/权威文档04-数据层权威规范-20260710/) | 6 chapters: ingestion/storage/quality/security/observability/extension | D29(冲突)+D30(质量)+D31(适配器)+D32(JSON)+D33(时间)+D34(PII)+D35(观测)+D36(扩展)+D37(冲突感知) |
| 8 | [Security Privacy Permissions Spec](research/权威文档08-安全隐私权限权威规范-20260712/) | 7 chapters: STRIDE/SOI/audit hash/data poisoning | D38(PolicyEngine)+D39(TraversalFilter)+D40(DataEx/Purger)+D41(HashChain)+D42(PreUpload)+D43(Injection)+D44(rbac)+D45(auth)+D46(Docs) |
| 9 | [Deployment Operations Spec](research/权威文档09-部署运维权威规范-20260713/) | 6 chapters | D47(双进程)+D48(升级)+D49(看门狗)+D50(恢复)+D51(CI)+D52(规模化) |
| 10 | [Expert Prompt Engineering Spec](research/权威文档10-专家提示词工程规范-20260713/) | 6 chapters | D53(AgentSpec)+D54(组装)+D55(推理链)+D56(冲突感知)+D57(Tone)+D58(manifest) |
| 11 | [Managerial Economics Engineering Spec](research/权威文档11-管理经济学权威规范-20260714/) | 6 chapters | D59-D61(ME compute)+D62(哨兵)+D63(SKILL)+D64(知识注入) |
| 12 | [Skill-Tool System Research](research/权威文档12-Skill-Tool体系研究-20260714/) | 9 outputs, 33 core Skills, 21 Playbooks, 3 Tool types | D65+D66+D67+D68(done)+D69(expert downgrade)+D70(manifest)+D79(ContextLoader)+D80(PlaybookExecutionRecord) |
| 13 | [Growth Navigation System Engineering Spec](research/权威文档13-增长导航系统工程规范-20260714/) | 6 intervention nodes, 5 chapters, 14 changes (7 mod+7 new) | D71-D77 (7 tasks) |
| 14 | [System Integration & Implementation Roadmap](research/权威文档14-Synova系统集成与实施路线图-20260714/) | Construction doc,5 chapters+appendix, startup/MVS/integration/terms | D83-D87 (5 tasks) |
| 15 | [Enterprise Cycle Overflow Navigation](research/权威文档15-企业循环溢出导航系统-20260714/) | 6 chapters, dynamic cycle registry/overflow dashboard/investment engine/6th Loop/industry templates | D88-D90 (3 tasks, first post-MVS extension) |

---

## I. Overall Progress

\I1  Ontology Rebuild          [####################] 100% (G1-G5)
T1-T6 Sentinel+Compute Fixes  [####################] 100% (G1-G5)
T9  Accuracy Baseline         [####################] 100% (G1-G5, 15 tests)
T11 No-Data Diagnosis         [####################] 100% (G1-G5, 27/27 tests)
T7a BRAND_BUILDS             [####################] 100% (G1-G5, I2 KEEP)
I2-P1 42 Edge JSON+DELETE    [####################] 100% (55 JSON, 7 deleted)  [#1 42边体系]
I2-P2 Enum Sync+graph-bridge [####################] 100% (71b0919, 51 edges)  [#1 42边体系]
I2-3a Reference Migration    [####################] 100%  [#1 42边体系]
I2-3b Stage 0-1 Compute(12)  [####################] 100% (12+12 files)  [#1 42边体系]
I2-3c Stage 2-3 Compute(17)  [####################] 100% (17+17 files, 51 tests)  [#1 42边体系]
I2-3d Stage 4-5+X Compute(13)[####################] 100% (13+13 files, 39 tests)  [#1 42边体系]
I2-3d-FIX @contract Complete [####################] 100% (13 @contract + 52 it)  [#1 42边体系]
======================================================================
I2  42 Edge System           [####################] 100% (COMPLETE)  [#1 42边体系]
======================================================================
T7  Ontology Edge Completion [####################] 100% (I2 Stage4: DELETE edges zero residue)  [#3 哨兵规范]
T7b 10 Edge Wiring           [####################] 100% (I2 Stage4 complete)  [#3 哨兵规范]

=== D-series Existing Defects ===
D10 engine-core Retirement   [[###################-]]  95% (e783c07, observe until 07-22)
D1  EdgeType Enum            [####################] 100% (71b0919+I2-P4)  [#1 42边体系]
D2  Compute Dead Refs        [####################] 100% (deleted)
D3  org/THEORY Fix           [####################] 100% (ca3ad92)
D4  Financial Unification    [####################] 100% (7d0f1de)
D5  Circuit Breaker Wiring   [####################] 100% (G1-G5)  [#4 Agent对标]  [#4 Agent对标]
D6  Push Notifications       [####################] 100% (679f57b+D6a)  [#4 Agent对标]
D7  Architecture Docs Fix    [####################] 100% (9 files deprecated, 7 remain active)  [#3 哨兵规范]
D14 NodeType Registration    [####################] 100% (52b7d2a, 16 new constants, ALL=45)  [#2 15节点池]
D8-D23 Agent Engineering 16  [####----------------]  20% (in progress) (after I2)
D15a Sentinel Merge+Deprecate [####################] 100% (4 merge+13 extinct, 75 tests)  [#3 哨兵规范]
D24 @contract Completion     [####################] 100% (29/29, 29x4=116 it)  [#6 测试规范]

=== D-series Data Layer (7th) ===
D29 Data Conflict            [####################] 100% (1e0dab3, 3 modules)  [#7 数据层]
D30 Data Quality Gates       [####################] 100% (a4ed24e, 5 gates+3-phase, 14 tests)  [#7 数据层]
D31 6 New Adapters           [####################] 100% (dbf0d43, 7 covers 8 outcomes)  [#7 数据层]
D32 Outcome JSON Fields      [####################] 100% (c865314, 7 fields)  [#7 数据层]
D33 Storage Time Semantics   [####################] 100% (65efcf2+594e8a9, L3 period-utils)  [#7 数据层]
D34 PII Scrubbing            [####################] 100% (3f34fd0)  [#7 数据层]
D35 Pipeline Observability   [####################] 100% (PipelineMonitor+FreshnessTracker)  [#7 数据层]
D36 Pluggable Extension      [####################] 100% (fe8ac17, scan+register+API)  [#7 数据层]
D37 Conflict Upper Perception[####################] 100% (625cf98, graph-bridge+evidence+runner, 10 tests)  [#7 数据层]

=== D-series Security (8th) ===
D38 PolicyEngine             [####################] 100% (0a9bf45, 9 rules+10 SOI, 17 tests)  [#8 安全]
D39 TraversalPermissionFilter[####################] 100% (7319e8b, 177 lines+8 tests, zero as any)  [#8 安全]
D40 DataExporter+DataPurger   [####################] 100% (1f785ab, 23 tests, 4-stage state machine)  [#8 安全]
D41 Audit Hash+RootHash       [####################] 100% (ff32285, crypto-hash+audit-store+external-store+publisher, 16 tests)  [#8 安全]
D42 PreUploadValidator        [####################] 100% (169行+13测试, PIIScrubber+keywords+路由接入)  [#8 安全]
D43 PromptInjectionDetector   [####################] 100% (124行+16测试, 3层16规则, 零LLM)  [#8 安全]
D44 rbac.ts tenantId+Roles    [####################] 100% (rbac+auth强化, 54测试, PolicyEngine集成)  [#8 安全]
D45 auth.ts tenant_id         [####################] 100% (含D44-D45合并)  [#8 安全]
D46 Deprecated Docs Mark      [####################] 100%  [#8 安全]

=== D-series Deployment (9th) ===
D47 Dual-Process+First Boot   [####################] 100% (data-dir+startup-check+electron, 12 tests)  [#9 部署运维]
D48 Silent Upgrade+Rollback   [####################] 100% (f88a2de, 3 modules+electron wiring, 39 tests)  [#9 部署运维]
D49 Watchdog+Monitor          [####################] 100% (watchdog+healthz+system-health,15 tests)  [#9 ????]
D50 Recovery+Verify           [####################] 100% (recovery-pack+backup-scheduler+verify,24 tests)  [#9 ????]
D51 CI/CD Golden Case F1      [####################] 100% (0f7cd8f, golden-case-checker+11 tests+CI update)  [#9 ????]
D52 Scaled Ops+Skill Pkg      [####################] 100% (Docker+industry pack+self-ops+batch-upgrade,10 tests)  [#9 ????]

=== D-series Expert Prompt (10th) ===
D53 8 Expert AgentSpec Files  [####################] 100% (9 manifests, 66 edges, 52 computes, 16 tests)  [#10 专家提示词]
D54 6 Module Assembly         [####################] 100% (prompt-assembler, 6模块+Token预算, 20 tests)  [#10 专家提示词]
D55 Reasoning+2 Defenses   [####################] 100% (4-layer trace, 26 tests)  [#10 专家提示词]
D56 Data Conflict+Interaction [####################] 100% (1613acb, interaction-protocol, 38 tests)  [#10 专家提示词]
D57 Tone Fusion+Role          [####################] 100% (8e0a6c6, tone-enforcer+M1/M2+resolvePromptMode,48 tests)  [#10 ?????]
D58 manifest.json+Loader      [####################] 100% (f7ee3e8, 9 PROMPT.md+loadPromptTemplate,35 tests)  [#10 ?????]

=== D-series Managerial Economics (11th) ===
D59 7 ME Compute Enhance      [####################] 100% (dc4d6a0, 7?compute??economic_interpretation,14 tests)  [#11 ME???]
D60 17 ME Compute New         [--------------------]   0%  [#11 ME工程化]
D61 3 ME Compute Fix          [--------------------]   0%  [#11 ME工程化]
D62 9 ME Sentinels            [--------------------]   0%  [#11 ME工程化]
D63 4 SKILL Pull Mode         [--------------------]   0%  [#11 ME工程化]
D64 4 Expert Knowledge Files  [--------------------]   0%  [#11 ME工程化]

=== D-series Skill-Tool System (12th) ===
D65 Skill/Tool Registry+Loader[####################] 100% (skill-loader+registry, 12 tests)  [#12 Skill-Tool]
D66 Built-in Skills(41)       [####################] 100% (41 manifests+deps+boundaries, 127 edges)  [#12 Skill-Tool]
D67 Playbook Loader+Trigger  [####################] 100% (loader+21 YAMLs, 24 tests)  [#12 Skill-Tool]
D68 Tool Atomic Validation    [####################] 100% (validateAtomicity+PolicyEngine, 15 tests)  [#12 Skill-Tool]
=== D-series Skill-Tool Supplement (12th Research) ===
D81 Sentinel Edge ID Migration (old E-11→E-21, E-12→E-14)   [####################] 100% (zero old IDs in code, no migration needed)  [#1 42-Edge System]
D82 7 Missing Compute (E-11/E-12/E-21/E-22/E-40/E-41/E-42) [####################] 100% (4 new+3 existing,12 tests)  [#1 42-Edge System]
=== D-series System Integration (14th) ===
D83 Startup Sequence Phase0-5+Rollback  [####################] 100% (Bootstrap+6Phase+13 tests)  [#14 Integration]
D84 Integration Contract check-integration [####################] 100% (system-registry+L1+L2+CI job)  [#14 Integration]
D85 MVS Golden Dataset+Regression Test    [####################] 100% (client-a-v1 snapshot+5 checksums+regression script)  [#14 Integration]
D86 Self-Diagnosis check-self-diagnosis   [####################] 100% (6+1 steps+natural language+json output)  [#14 Integration]
D87 Terminology Dictionary+Cross-Layer Map [####################] 100% (208-line GLOSSARY+18 terms+12 mappings)  [#14 Integration]
=== D-series Overflow Monitor (14th §4.1.6 refs auth-15) ===
D88 CycleLoader (Phase 2e)               [####################] 100% (7be2ccf, CycleLoader+4 builtin+2 industry+11 tests)  [#15 Overflow Nav]
D89 Sub-cycle Overflow+OverflowGraphBridge  [####################] 100% (ae61dc5, overflow-compute+bridge+10 tests)  [#15 Overflow Nav]
D90 Overflow Dashboard+Input Recommendation [--------------------]   0% (dev doc ready, awaiting session)  [#15 Overflow Nav]
D79 ContextLoader Enterprise Merger  [####################] 100% (3-layer merge+5 degrade+11 tests)  [#12 Skill-Tool]
D80 PlaybookExecutionRecord+Persistence [####################] 100% (15 fields+DDL+3 indexes+11 tests)  [#12 Skill-Tool]
=== D-series Growth Navigation (13th) ===
D71 Goal Store+Lifecycle Engine  [####################] 100% (968e830, goal-types+store+conflict+lifecycle,31 tests)  [#13 ????]
D72 Proposal Engine+3-Choice     [####################] 100% (662d118, proposal-types+store+engine,21 tests)  [#13 ????]
D73 Plan-Level Sentinel System   [####################] 100% (607a3df, goal-sentinel+lifecycle integration,15 tests)  [#13 ????]
D74 Workspace Data Aggregation    [####################] 100% (8429c4d, workspace-types+builder+next-action+dnd,19 tests)  [#13 ????]
D75 Lightweight Re-Diagnosis      [####################] 100% (d29c30b, lightweight-diagnosis+sentinel+proposal hooks,13 tests)  [#13 ????]
D76 Execution Knowledge+PKB Write[####################] 100% (5774a06, knowledge-feedback+goal-lifecycle integration,12 tests)  [#13 ????]
D77 Growth Types+Integration      [####################] 100% (329178f, ActionRecommendation+GOAL SOI+@deprecated+e2e,146 tests)  [#13 ????]
D78 ?Agent???????     [####################] 100% (????,4?+8?+5?,?????)  [#4 Agent??]
=== D-series 文档修正（审计工单） ===
\
---

## II. Completed Tasks

| # | Task | Output | Date |
|---|------|--------|------|
| I1 | Ontology Rebuild | G1-G5, 10/10 verified | 07-08 |
| T1-T6 | Sentinel+Compute Core Fixes | G1-G5 | 07-08~09 |
| T9 | Accuracy Baseline+ME Injection | G1-G5, 15 tests | 07-09 |
| T11 | No-Data Diagnosis | G1-G5, 27/27 tests | 07-10 |
| T7a | BRAND_BUILDS | G1-G5, I2 KEEP | 07-10 |
| D1-D6 | D-series Batch 1 | G1-G5 | 07-10 |
| CI Fix | 10 failures+arch check | 9dc07d9+24719d6 | 07-10 |
| I2-P1 | 42 Edge JSON+DELETE | 55 JSON, 7 deleted | 07-10 |
| I2-P2 | Enum Sync+graph-bridge | 71b0919, 51 edges | 07-10 |
| I2-3a | Compute Edge Ref Migration | G1-G5 | 07-10 |
| I2-3b | Stage 0-1 Compute(12) | G1-G5 | 07-10 |
| I2-3c | Stage 2-3 Compute(17) | G1-G5, 51 tests | 07-10 |
| I2-3d | Stage 4-5+X Compute(13) | G1-G5, 39 tests | 07-11 |
| I2-3d-FIX | @contract+Time Declarations | G1-G5, 13 contract+52 it | 07-11 |
| I2-P4 | 50 Sentinel Edge Ref Migration | G1-G5, 7 DELETE zero residue | 07-13 |
| D46 | Deprecated Docs Marking | 3 deprecations | 07-14 |
| D14 | NodeType Registration (52b7d2a) | 16 constants, ALL=45 | 07-14 |
| D31 | 6 New Data Adapters (dbf0d43) | 7/7 JSON validated | 07-14 |
| DL7 | routes/data.ts log fix | Fixed | 07-13 |
| D32 | Outcome JSON Fields (c865314) | 3 files, 7 fields | 07-15 |
| D34 | PII Scrubbing (3f34fd0) | 2 files, ingestRow+S4 | 07-15 |
| D24 | I2-3b/3c @contract (3f34fd0) | 29 compute+29 test, 116 it | 07-15 |
| D10 | engine-core Retirement (e783c07) | diagnosis.ts switched | 07-15 |
| D29 | Data Conflict (1e0dab3) | graph-bridge+data-ingest+Memory, 25 tests | 07-15 |
| D35 | Pipeline Observability | PipelineMonitor+Tracker, 15 tests | 07-15 |
| D33 | Storage Time Semantics (65efcf2+594e8a9) | L3 period-utils | 07-16 |
| D36 | Pluggable Extension (fe8ac17) | AdapterScanner+Registry+API, 18 tests | 07-15 |
| D30 | Data Quality Gates (a4ed24e) | Freshness+Completeness+Smell, 14 tests | 07-15 |
| D38 | PolicyEngine (0a9bf45) | 9 rules+10 SOI+17 tests | 07-15 |
| D39 | TraversalPermissionFilter (7319e8b) | 177 lines+8 tests, zero as any | 07-16 |
| R10-supp | Expert Prompt - Supplement Fix | Doc produced | 07-14 |
| R11 | Managerial Economics Spec (11th) | 7 docs produced | 07-15 |
| R12 | Skill-Tool System Research (12th) | 41 Skill+21 Playbook+34 Tool, 8 docs | 07-16 |
| R13 | Growth Navigation System Engineering Spec (13th) | 6 intervention nodes + 5 chapters, 6 docs | 07-17 |

---

## III. Pending Tasks

| # | Task | Depends | Est. | Pri | Auth Doc |
|---|------|---------|------|-----|---------|
| D49 | Watchdog+3-Layer Monitor | D48 | 3d | P0 | #9 Deployment | ? Done |
| D50 | One-Click Recovery+Verify | D49 | 3d | P0 | #9 Deployment | ? Done |
| D51 | CI/CD Golden Case F1 Gate | -- | 4d | P0 | #9 Deployment | ? Done |
| D52 | Scaled Ops+Industry Skill Pkg | D51 | 5d | P0 | #9 Deployment | ? Done |
| D57 | Tone Fusion+Role Consistency | D56 | 3d | P0 | #10 Expert Prompt | ? Done |
| D58 | manifest.json+Loader File-Driven | D53 | 3d | P0 | #10 Expert Prompt | ? Done |
| D59 | 7 ME Compute Enhance | -- | 5d | P0 | #11 ME Engineering | ? Done |
| D60 | 17 ME Compute New | -- | 7d | P0 | #11 ME Engineering | ?? Pending audit |
| D61 | 3 ME Compute Fix | -- | 3d | P0 | #11 ME Engineering |
| D62 | 9 ME Sentinels | -- | 3d | P0 | #11 ME Engineering |
| D63 | 4 SKILL Pull Mode Inject | D62 | 3d | P0 | #11 ME Engineering |
| D64 | 4 Expert Knowledge File Inject | -- | 3d | P0 | #11 ME Engineering |
| D69 | expert-prompts.ts Downgrade | D70 | 2d | P0 | #12 Skill-Tool |
| D70 | 9 Expert manifest.json | -- | 3d | P0 | #12 Skill-Tool |
| D71 | Goal Store+Lifecycle Engine | -- | 5d | P0 | #13 Growth Nav | ? Done |
| D72 | Proposal Engine+3-Choice | D71 | 5d | P0 | #13 Growth Nav | ? Done |
| D73 | Plan-Level Sentinel System | D71 | 5d | P0 | #13 Growth Nav | ? Done |
| D74 | Workspace Data Aggregation | D71 | 4d | P0 | #13 Growth Nav | ? Done |
| D75 | Lightweight Re-Diagnosis | D74 | 3d | P0 | #13 Growth Nav | ? Done |
| D76 | Execution Knowledge+PKB Write | D75 | 3d | P0 | #13 Growth Nav | ? Done |
| D77 | Growth Types+Integration | D76 | 3d | P0 | #13 Growth Nav | ? Done |
| D8a | L2 Upgrade to Main Agent | -- | 5d | P0 | #4 Agent Benchmark |
| D8b | Task Decomposition Protocol | D8a | 3d | P0 | #4 Agent Benchmark |
| D8c | Expert Routing Algorithm | D8a | 3d | P0 | #4 Agent Benchmark |
| D8d | Cross-Validation Trigger | D8a | 2d | P0 | #4 Agent Benchmark |
| D8e | Conflict Arbitration | D8a | 3d | P0 | #4 Agent Benchmark |
| D8f | Convergence Mechanism | D8a | 2d | P0 | #4 Agent Benchmark |
| D8g | Reasoning Cost Budget | D8a | 3d | P0 | #4 Agent Benchmark |
| D9 | 5 Built-in Loops | D8a | 10d | P0 | #4 Agent Benchmark |
| D17-D21 | Agent Proactive Interaction | -- | 15d | P1 | #5 Proactive |
| D25-D28 | Contract Tests/Golden Cases | -- | 10d | P0 | #6 Test Spec |

## IV. Latest: 主Agent一致性审计 -- 18处修正 (4P0+8P1+5P2)

| Dimension | Content |
|-----------|---------|
| 41 Skills | L1(5)+L2(8)+L3(6)+L4(4)+L5(3)+L6(3)+L7(4)+Collab(3)+Workbench(3)+Cross(2) |
| 21 Playbooks | Trigger->Route->Steps->onFailure->Output |
| 34 Tools | Data(6)+Compute(16)+Format(3)+Shared(3)+ME(3)+Causal(3) |
| 3-Phase | Parallel->Switch->Cleanup |
| Local Adaptive | Enterprise override table (exclusive innovation) |

### Benchmark

| Project | Borrowed | Synova Innovation |
|---------|----------|-------------------|
| Hermes | 5-piece dir+file-driven+AST | Enterprise override table |
| Claude Code | Procedure Checklist->Playbook | YAML branching+onFailure+cross-expert |
| Claw Code | Permission triple | Tool+field-level PolicyEngine |
| Codex | Priority override | Field-level override |

### Deprecated Docs

| Doc | Status |
|-----|--------|
| SYNOVA-ARCH-Security-20260707.md | Deprecated (8th) |
| SYNOVA-ARCH-Runtime-20260707.md | Deprecated (9th) |
| SYNOVA-ARCH-Expert-20260707.md | Deprecated (10th) |

---

## V. Key Metrics

| Metric | Value | Target |
|--------|-------|--------|
| Sentinels | 50 | 50 |
| Compute total | 61 | >=1 per edge |
| @contract coverage | 42/42 (100%) | 100% |
| CI failures | 0 | 0 |
| as any | 0 | 0 |
| Auth docs | 13 | Growing |
| Deprecated arch docs | 3 | As needed |

---

## VI. Research Output

| Direction | Path | Reports |
|-----------|------|---------|
| Ontology Causal System Auth Spec (#1+#2 merged) | research/权威文档01-本体层因果体系权威规范-20260714/ | 9 |
| Node Pool System | (merged into #1 Auth Doc 01) | — |
| Agent Engineering Benchmark | research/权威文档07-Agent工程能力对标-20260710/ | 8 |
| Sentinel-Compute-Ontology Spec | research/权威文档03-哨兵-计算-本体-权威规范-20260710/ | 6 |
| Agent Proactive Interaction | research/权威文档05-Agent主动交互系统蓝图-20260710/ | 7 |
| Test System Spec | research/权威文档06-测试体系权威规范-20260710/ | 12+ |
| Data Layer Spec | research/权威文档04-数据层权威规范-20260710/ | 8 |
| Permissions Research | research/权威文档08-安全隐私权限权威规范-20260712/ | 7 |
| Security Spec (8th) | research/权威文档08-安全隐私权限权威规范-20260712/ | 8 |
| Deployment Spec (9th) | research/权威文档09-部署运维权威规范-20260713/ | 7 |
| Expert Prompt Spec (10th) | research/权威文档10-专家提示词工程规范-20260713/ | 8 |
| Managerial Economics (11th) | research/权威文档11-管理经济学权威规范-20260714/ | 7 |
| Skill-Tool System (12th) | research/权威文档12-Skill-Tool体系研究-20260714/ | 9 |

---

## VII. Risks

| Risk | Level | Status |
|------|-------|--------|
| D49-D52 Deployment P0 (4 items) | LOW | All 4 completed (D49-D52 done) |
| D57-D58 Expert Prompt gaps (2) | LOW | All completed (D57-D58 done) |
| D59-D64 ME Engineering (27+9+4) | MED | Tracking |
| D69-D70 Skill-Tool File-Driven (2) | LOW | All completed (D69-D70 done) |
| D8a-D8g Agent L2 Upgrade (7 items) | HIGH | Requires orchestration refactor, 63d est |
| D71-D77 Growth Navigation (7 items) | MED | D71-D76 complete; D77 recovered and pushed (commit missing) |
| D10 engine-core Retirement Residual | LOW | Adapter @deprecated, remove after 07-22 |
| D79-D80 Skill-Tool Supplement (2 items) | LOW | Research delivered, ContextLoader+PlaybookExecutionRecord |

> Links: [INDEX.md](INDEX.md) | [DOCUMENT-CONVENTIONS.md](DOCUMENT-CONVENTIONS.md) | [TASK-TEMPLATE.md](TASK-TEMPLATE.md)
> Chinese: [DASHBOARD-CN.md](DASHBOARD-CN.md)
