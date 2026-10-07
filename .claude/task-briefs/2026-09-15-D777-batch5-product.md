# Task Brief: D777 第五批派单 · 产品推进（统筹规划）

> 生成: 2026-09-15 | 分支: docs/d777-batch5-product | as any: 0
> 域: mac（docs/synova/coordination + task-state；单域）
> 主线贡献: infra:主线统筹（把「产品完成度」从 1% 的结构性原因找出来并排成可执行批次）
> 触发: 创始人「现在作为CTO，像DSH产品负责人一样，规划我们的下一批任务。一定要仔细，一定要了解全景，统筹产品的推进。」

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务 = **产品级统筹**（不是某个模块的实现）：把 26 条线 / 164 个验收点的真实状态看清，
判断「完成度上不去」的根因，排出下一批（批五）任务并落到看板与执行方。

### b) 文件审计（全部实测）
- `docs/synova/product-lines/product-progress.json`（2026-09-12 生成）：164 点 = uncommitted 96 / pending_k3 34 / stale 29 / verified 1 / failed 2 / rejected 2；加权 1%；唯一非零线 19（20%）
- `scripts/product-lines/calc-progress.py:67`：`EVIDENCE_TTL_DAYS = 14`；`:33` 证据日期后该线 modules 有 git 变更亦作废（A1）
- 线 1 八点：7 stale + 1 pending_k3（`product-progress.json` 逐点实读）
- 线 3/7/8/16/17 逐点状态：报告 7 uncommitted + 1 pending；持续监测 3 stale + 3 uncommitted + 2 pending；告警 4 stale + 1 uncommitted + 1 pending；目标闭环 4 uncommitted + 1 pending；进化闭环 1 rejected + 1 failed + 2 uncommitted + 1 pending
- `docs/synova/product-lines/todos.yaml`：49 条待办（P0 16 / P1 29 / P2 4）
- 证据底座实测：`src/evidence/evidence-store.ts:22`（CREATE TABLE evidence）、`src/l3/evidence-retention.ts:183`（new EvidenceStore(db) 生产实例化）
- task-state 实测：**29 个任务 impl 有 / audit 空**（K3 积压）

### c) 决策
不新开方向、不加机制堆叠：本批 = ①线 1 收口 ②证据保鲜（机制，一次建长期用）③审计吞吐 ④支柱 ②/③ 的产品缺口 ⑤DSH 卡按序 ⑥队列/管道。
判据：价值 ÷ 成本 + 依赖；**B 组（重跑机制）是本批前置**，否则 A/D 组成果 14 天后再次 stale。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = 每一组都写成「任务 / 内容 / 执行方 / 可证伪验收」四列（派单文档 §三）。
② 测试等价物 = 派单文档必须过 `pre-dispatch-check.sh`（十项机械复核）+ 内部一致性自检段。
③ 实现 = 一份派单 + 4 个新任务登记（D774/D775/D776/D777）。
④ 接线 = 任务进 task-state ⇒ 看板可见（链路已存在）。
⑤ 验证 = 复核脚本全绿；新任务在计划表生成块可见。

引用依据：
- 计划 §五 原则 8（声称必有物理证据）：本批所有验收都要求原始输出入 git
- 计划 §五 原则 9（测量有效性）：1% 的成因用 calc-progress 源码 + 逐点状态实证，不靠印象
- 铁律 0（协作对齐前置）：把「为什么这样排」写进文档，执行方可核
- M2（声称 vs 事实）：修正「产品只做了 1%」的误读——真实是 96 点无证据 / 34 点待审 / 29 点过期

### b) 本任务执行约束
- rule: "派单必须锚定计划 hash" verify: "bash scripts/control-tower/pre-dispatch-check.sh docs/synova/coordination/派单-第五批-产品推进-20260915.md → ⑩ ✅"
- rule: "新任务都登记" verify: "for id in D774 D775 D776 D777; do test -f task-state/$id.json; done → 全存在"

### c) 决策参考系
参考：第一性原理（完成度是证据的函数，不是代码的函数）+ Anthropic（把验收做成可重复流水线）→ 结论：先建重跑，再谈推进。

### d) 相关 Note 引用
无（coordination 文档，未触治理脚本区）。

## Q2: 范围 — 正确的最简方案

做什么：
- docs/synova/coordination/派单-第五批-产品推进-20260915.md — 批五派单（全景 + 判断 + 六组任务 + 资源 + 风险 + 自检）
- task-state/D774.json（证据保鲜流水线）· D775.json（N13 进化闭环）· D776.json（线 4 数据接入）· D777.json（本单）

不做什么：
- 不改 scripts/product-lines/calc-progress.py（TTL 与失效规则保留，不为凑数字放宽）
- 不改 docs/synova/product-lines/product-progress.json（数据由脚本生成，不手改）
- 不改 dsh/plugins/task-board-adapter/**（看板适配器不动）
- 不改 scripts/audit/**（K3 红线）

## Q3: 验收 — 入口 → 交互 → 结果

入口：CTO 派单前复核脚本 + 看板
处理：派单文档过十项机械复核；四个新任务落 task-state → 派生快照 → 看板
结果：看板可查 D774~D777；执行方能按文档 §三 直接认领

## 架构层: scripts（治理层：派单文档 + task-state）；不触 L1-L5
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: verify: `bash scripts/control-tower/pre-dispatch-check.sh docs/synova/coordination/派单-第五批-产品推进-20260915.md` → 含「✅ 派单已锚定计划」
- [ ] 链路走通: verify: `for id in D774 D775 D776 D777; do test -f task-state/$id.json || echo MISSING $id; done` → 无 MISSING
- [ ] 结果可见: verify: `grep -c "D774\|D775\|D776" docs/synova/coordination/派单-第五批-产品推进-20260915.md` → ≥3
- [ ] 全景可核: verify: `grep -c "164 个验收点" docs/synova/coordination/派单-第五批-产品推进-20260915.md` → ≥1

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |
| .claude/task-briefs/2026-09-15-D777-batch5-product.md | task |
| docs/synova/coordination/派单-第五批-产品推进-20260915.md | task |
| docs/synova/coordination/编码指令-D747-line1-repackage-evidence-20260915.md | task |
| docs/synova/coordination/编码指令-D774-evidence-pipeline-20260915.md | task |
| task-state/D774.json | task |
| task-state/D775.json | task |
| task-state/D776.json | task |
| task-state/D777.json | task |

