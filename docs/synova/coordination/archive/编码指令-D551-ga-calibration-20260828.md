# 编码指令 — D551 GA 校准后端（ga-module-3，实现排部署后）

> 交付: DeepSeek Harness · dev-doc | 2026-08-28 | 随 spec 交付，供编码 session 启动（实现排部署后开工）

---

## 1. 任务文档表（先读后动，顺序即优先级）

| 文档 | 路径 | 作用 |
|---|---|---|
| **实现 spec（编码唯一契约）** | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D551-ga-calibration-backend-20260828.md` | §5 复用评估 / §6 数据模型（校准 schema+版本链+信号注入）/ §7 回流机制（层 1/2/3 诚实分层）/ §8 API 契约表 / §9 接线 / §10 测试 / §13 DS1-DS8 |
| 派单 D551 | `docs/synova/coordination/派单-D551-ga-calibration-20260828.md` | 写集约束 / 防膨胀红线 |
| Module-3 蓝图（设计源头） | `docs/synova/research/权威文档05-Agent主动交互系统蓝图-20260710/SYNOVA-RESEARCH-Module-3-GA人机协同与反馈闭环-20260710.html` | §3.2.1 四操作 / §3.3.1 五要素 / §3.3.2 反应链 |
| D476（GA 范围权威） | `docs/plans/codex/implementation/SYNOVA-IMPL-D476-ga-enterprise-scope-20260823.md` | auth.orgId fail-closed 形态 |
| 北星 | `.claude/PRODUCT-BRIEF.md` §二/§三.1 | 方向锚 |
| 铁律 | `AGENTS.md` 0-2/24/31/32/38/39/47/48 | 质量底线 |

## 2. 执行要求

认真阅读任务文档，然后执行任务。做到你的最高代码水平。任务复杂 → 先用 plan mode 做好计划再执行；先想清楚再动手（禁止没想清楚就改代码）。做完复核：与 dev doc 一致 / 不违反铁律 / 无 bug / 接线完整 / 测试到位 / 其他你认为需要复核的点。Kimi K3 会盯着你的任务，也会做最后的审计。

## 3. 任务专属硬约束（违反 = 审计 FAIL）

1. **基线与行号（M7 防漂移）**: 基线 = **origin/main @ 434d7211**（spec 全部 file:line 锚定此 sha）。开工先 `git fetch origin` 核对；抽验 3 处（ga-annotations.ts L44-60 requireGa / feedback-collector.ts L118 target_type CHECK / runner.ts L713 persistRunEvents），漂移先对齐 spec 再动手。
2. **写集（目录级，spec §3.3.1）**: src/routes/（新建 ga-calibration.ts + ga-auth.ts + server.ts 挂载行）/ src/agent/（sentinel-service.ts + injectManualSignal）/ src/sentinel/（runner.ts + injectManualFinding）/ src/growth/（feedback-collector.ts 枚举+migration）/ src/loops/（**预计零改动**）/ tests/（新建 2 文件）。收工 `git diff --name-only origin/main..HEAD` ⊆ 写集。
3. **禁碰清单**: electron-renderer/（前端消费=后续切片）；ga-annotations.ts / ga-corrections.ts / ga-admin.ts（存量 audited 路由零回改——DS7 有零 diff 断言）；scripts/audit/；scripts/pre-commit-check.sh；.github/workflows/ci.yml；src/loops/middle-evolution-engine.ts（层 2 descope）。
4. **防膨胀红线（派单）**: 零第二套进化机制——回流只走 feedback_log 单源（getFeedbackCollector() 活单例 L314，**禁 import ga-collaboration 死链 GAFeedbackHandler**）；零新组件/依赖；不改 sentinel_events DDL；不做蓝图下游消费端（背景卡自动加载/权重自动更新/ManualSignal 本体节点/定向触发/GA AI 副驾——spec §7.3 层 3）。
5. **诚实声明传播（本任务最高优先级）**: spec §7.2/§7.3 的分层是交付边界——回流收口 = feedback_log 行 + getAggregatedSignals 聚合可见；**"进化动作生成/采纳率/诊断变好"不在本单**（engine 白名单 L78-108 未改 + 无采纳数据源）。PR 描述与交付声明必须携带此边界，禁假装闭环。
6. **诚实 RED（S-5）**: ①认证断言在漏 requireGa 时必红；②回流集成断言在只写 memory 不写 feedback_log 时必红；③注入投影断言在旁路写事件表时必红。禁伪造 red/绿。
7. **evidence 落盘**: 测试输出 + §9 九条 grep 输出 + CI check-runs → evidence/D551/ + PR 描述（K3 独立重跑可复现）。
8. **环境坑**: 本机 BSD grep 无 `-P`；migration 用 schema_version 机制（先例 feedback-collector.ts L128-130 'd93b_actor_role'）；SQLite 无法 ALTER CHECK → 重建表迁移（spec §6.3 步骤）；测试动态 import 路由模块（对齐 tests/routes/ga-annotations.test.ts L15 惯例）。

## 4. 复核清单（做完逐项自查）

- [ ] DS1-DS8（spec §13）逐项对照，禁重编号/跳号/静默缺项（S-10）
- [ ] DS2 四端点 + ga-auth.ts 共享认证 + server.ts 挂载；认证三态（401/400/403）测试绿
- [ ] DS3 校准 schema + supersedes 版本链（用例④绿：双校准 + includeChain 有序）
- [ ] DS4 回流: 枚举扩展 + migration 'd551_target_type' + 双写（用例⑥-⑦绿：feedback_log 行 + 聚合可见）
- [ ] DS5 注入: sentinel-service → runner → sentinel_events + 投影（用例⑧-⑩绿：findings 可见 + 降级诚实）
- [ ] DS6 stats 端点 + note 字段（诚实降级声明在响应体内）
- [ ] DS7 §9 九条接线 grep 命中 + 存量三路由零 diff + as any=0
- [ ] DS8 CI 三 job（quality / Vitest 1/2 / Vitest 2/2）全 success 贴结果 + Architecture Check 绿（本地绿不算——D540 教训）
- [ ] 铁律: as any=0 / 降级诚实 log+degraded（24/31）/ 错误分类 code+phase+retryable（32）/ 接线生产调用点（S-3）/ 无 --no-verify / 无 git stash（0-3）

## 5. 审计提示

- 提审覆盖 **D551（spec→实现）**；K3 重点: evidence/D551/ 独立重跑三测试 + §8.2 契约表与实现一致性 + §7 回流边界未被越界（禁假装闭环是 K3 首查项）。
- 验证点收口: 复用评估引用（ga-annotations file:line）/ API 契约表 / 回流 D333 结论三项派单验收从 spec 声称收口为 evidence 实测。
- task-state/D551.json impl 段回填 + slice=ga-module-3 + status=impl_done；push 成功后提醒运行 bash scripts/workflow/checkpoint-deploy.sh [服务器URL]。

---

开始吧。
