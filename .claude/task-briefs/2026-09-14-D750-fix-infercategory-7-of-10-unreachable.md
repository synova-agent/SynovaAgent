# Task Brief: D750 fix-infercategory-7-of-10-unreachable

> 生成: 2026-09-14 | 任务: D750 | 认领: 主 CTO（synova-cto）
> 参考: 院长质询 §3.4（`~/山河研究院/99-综合/质询-可插件化是否物理事实.md`）+ 创始人「同意先修 P0」

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L3 洞察层缺陷修复（哨兵→信号聚合→专家路由）。**活缺陷**：信号被路由给错误专家。
### b) 文件审计（实测）
- `src/sentinel/signal-aggregator.ts:191` `inferCategory()` 只产 capability/health/risk；`:53` `SIGNAL_TO_EXPERT` 定义 10 类 → **7 类不可达**
- 实测 45 个哨兵 manifest **45/45 声明 expert**：{technology-foundation:8, competitive-strategy:16, organizational-capability:13, fundamental-efficiency:6, customer-growth:2}
- 例：`sentinel-cash-runway` manifest expert=`fundamental-efficiency`，但 inferCategory 判 `health` → `['technology-foundation']` → **现金/营收信号派给"技术底座"专家**，经 `runner.ts:734` 合并进最终派发
### c) 决策
路由改以 **manifest.expert 为权威**（数据驱动，45/45 已声明）；未命中才回落旧猜测并 **log.warn 记账**（不静默）；类目标签与路由解耦（反查表对多类目专家有歧义）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11（静默降级禁止）：回落路径必须 log.warn + 点名
- 铁律 5（后端能力≠可用功能）：路由表定义了 10 类但 7 类永远走不到 = 宣称≠事实
- 质询 §六 不该做 1：**在 D750 未修前不得调整本体规模**（本单不动任何数字/本体）
### 参考：铁律 5/11 + 质询 §3.4 → 以已声明的权威数据（manifest.expert）驱动路由，禁止猜测式分类

## Q2: 范围 — 正确的最简方案
做什么：
- src/sentinel/signal-aggregator.ts — 新增 `expertOf()`（manifest 权威）+ 聚合循环改为 manifest 优先、回落记账；类目标签与路由解耦
- tests/sentinel/d750-expert-routing.test.ts — 4 断言（cash-runway 不再只落技术底座 / 多哨兵并集 / 未命中回落非空且 warn）
- docs/synova/coordination/ownership.yaml — 补 tests/sentinel/** → mac（域规则粒度缺口，D733 表）
- .github/CODEOWNERS — 由 ownership.yaml 重生成（防漂移）
不做什么：
- 不改 `SIGNAL_TO_EXPERT` 表本身（保留业务语义表；本单只改"谁来决定用哪一类"）
- 不改 `runner.ts`（`findSignalRoute` 已是权威路由，本单不改它）
- 不改任何计数/本体规模（质询 §六 不该做 1）
- 不改 scripts/audit/

## Q3: 验收 — 入口 → 交互 → 结果
入口：哨兵发现 → `aggregateSignals(results)`
处理：每条 finding 的哨兵 → manifest.expert → experts 集合
结果：信号路由到其权威专家；营收/现金信号不再落技术底座

## 架构层: L3（洞察层：哨兵→信号→专家路由）
## 主线贡献: infra:修活缺陷（产品正确性；非扩展性）
## 域: mac

## Done 标准:
- [ ] 新增测试 4/4 通过：npx vitest run tests/sentinel/d750-expert-routing.test.ts
- [ ] 反向验证（强制 expertOf 返回 undefined）→ 至少 3 项红（实测 3 failed）
- [ ] 回落不静默：未命中哨兵时日志出现 `D750: 部分哨兵未在 manifest 命中 expert`
- [ ] 相关既有测试无回归：npx vitest run tests/sentinel

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |
| .claude/task-briefs/2026-09-14-D750-fix-infercategory-7-of-10-unreachable.md | task |
| .github/CODEOWNERS | task |
| docs/synova/coordination/ownership.yaml | task |
| src/sentinel/signal-aggregator.ts | task |
| tests/sentinel/d750-expert-routing.test.ts | task |
| tests/sentinel/signal-aggregator.test.ts | task |

