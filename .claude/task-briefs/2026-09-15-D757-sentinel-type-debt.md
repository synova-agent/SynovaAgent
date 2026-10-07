# Task Brief: D757 哨兵类型欠账修复（3 个未登记哨兵的类型错 — D752 门禁暴露）

> 生成: 2026-09-15 | 分支: fix/d757-sentinel-type-debt | as any: 0
> 触发: D752 类型网硬门禁把 8 个未登记哨兵纳入编译图 → 其中 3 个目录暴露 31 处类型错 → PR #560（D752）TS 门禁红
> 域: **win**（`extensions/sentinels/**` 按 ownership.yaml 兜底归 win；创始人 2026-09-15 授权 CTO 进入 Win 侧任务范围，Win 机不在线）
> 主线贡献: line-1（1-4/1-5 报告可溯源）——4 处 finding 缺 `evidence`/`suggestion` 直接削弱证据链
> 前置: D752 门禁脚本已在分支 feat/d752-type-net-gate（PR #560，未合）；本单先合，再更新 #560 使其转绿

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。
目标: 成为组织诊断的 AWS。文件驱动扩展——新增哨兵 = 加目录（loader 扫描发现）。
数据流: L5 存储 → L4 本体 → L3 洞察(哨兵定时+诊断按需) → L2 编排 → L1 交互
五层架构: L1 交互 routes/tui/mcp/ · L2 编排 agent/orchestrator/ · L3 洞察 l3/sentinel/ · L4 本体 l4/evidence/ · L5 存储 store/cron/

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属「纵向」L3 洞察层哨兵体系（- [x] 纵向），对象是**哨兵定义目录**（`extensions/sentinels/<name>/`，loader 扫描即生效）。
D752 的编译期类型网（`src/sentinel/types.ts` 静态 import type 登记）此前只登记 38/45，
未登记的 8 个哨兵**不在编译图内 ⇒ 类型错长期不可见**。D752 补登记后，编译器第一次看见这 8 个目录，
其中 3 个（cash-runway / revenue-health / key-person-risk）暴露 31 处类型错。
本任务 = 修这 3 个目录到类型干净（不改机制、不加防线）。

### b) 文件审计（实测，非转述）
`npx tsc --noEmit --pretty false`（在 PR #560 分支 = main + D752 登记）实测 31 处 CI 可见错误：

| 根因 | 错误码 | 处数 | 位置 |
|---|---|---|---|
| `GraphStoreReader` 从 sentinel-loader 导入（该模块不导出此类型） | TS2305 | 2 | `extensions/sentinels/cash-runway/aggregate.ts:2`、`extensions/sentinels/revenue-health/aggregate.ts:2` |
| 相对深度少一层（`../../../src/l4/graph-traversal` 实解析到 `extensions/src/...`） | TS2307 | 6 | `cash-runway/computes/compute-cash-runway-months.ts:17,18`、`cash-runway/computes/compute-receivable-overdue-rate.ts:17,18`、`revenue-health/computes/compute-revenue-growth.ts:16,17` |
| 上一条的级联（类型解析失败 → 回调参数隐式 any） | TS7006 | 19 | 同 3 个 computes 文件 |
| finding 字面量缺 `SentinelFinding` 必填的 `evidence`/`suggestion` | TS2345 | 4 | `cash-runway/aggregate.ts:51`(cash_warning)、`key-person-risk/aggregate.ts:58`(kpr-dc-warn)、`revenue-health/aggregate.ts:56`(rev_conc_warning)、`revenue-health/aggregate.ts:66`(rev_growth_warning) |

运行时实测（`npx tsx` 加载 4 个入口）：全部 LOADED —— 因这 3 类错全在 `import type`（编译期擦除）与类型标注上，
**故不是线上活缺陷，是编译期/证据质量缺陷**。证据链缺陷部分是真缺陷：这 4 条 finding 发给专家/工单时没有证据与建议。
关系：**修复**（既有文件就地改），不新建文件、不改机制。

### c) 决策
复用既有导入口径（`src/l4/graph-traversal` 是 `GraphStoreReader`/`GraphTraversal` 的真实出处，
同目录 aggregate.ts 本来就从这里取 `GraphTraversal`）→ 不发明第二套；finding 的 `evidence` 复用同哨兵内已算出的真实数值
（`runwayResult.evidence` / `concentration_index` / `clientCount` / `growthResult` 当期上期），不写占位串（铁律 8）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = 31 处错误全清 + 3 目录在带 D752 登记的编译图下 0 错 + 运行时仍可加载。
② 测试先行的等价物：**先跑红再跑绿**——先在 PR #560 分支复现 31 处红（已取证），改完在同一编译图下复跑为零（本单核心验证）。
③ 实现 = 6 个文件就地改（导入来源/相对深度/补必填字段），零新增文件、零新增抽象。
④ 接线 = 无需接线（既有哨兵仍由 loader 扫描发现，签名不变）。
⑤ 验证 = tsc 复跑 + tsx 运行时加载 + 反向验证（把修好的导入改回旧路径 → 必再红）。

引用依据：
- 铁律 9（改完 grep 全仓传播）：`grep -rn "'\.\./\.\./\.\./src/l4/graph-traversal'" extensions/` 改后归零
- 铁律 38（类型安全）：本次不引入 `as any`，隐式 any 全部靠真实类型消失
- 铁律 24/31（不静默降级）：finding 缺 evidence = 降级不可见，补齐即可溯源
- M7（文档-实现漂移）/ M1（fail-open 静默失效）：未登记哨兵不受编译检查 = 同族静默风险
- 不改 `scripts/control-tower/check-sentinel-type-net.sh`：D752 的门禁本体独立认领，不在本单

### b) 本任务执行约束
- rule: "同一编译图下 3 个目录 0 错"
  verify: "注入 D752 登记后 npx tsc --noEmit → grep -c 'extensions/sentinels/(cash-runway|revenue-health|key-person-risk)/' = 0"
- rule: "相对深度修复后无残留旧路径"
  verify: "grep -rn \"'\\.\\./\\.\\./\\.\\./src/l4/graph-traversal'\" extensions/sentinels/*/computes/ → 0 命中"
- rule: "运行时加载不回归"
  verify: "npx tsx 加载 4 个入口 → 4/4 LOADED"

### c) 决策参考系
参考：第一性原理 + Anthropic 工程基线 + 结论——「类型网的价值在于把不可见的目录拉进编译图」，
暴露的错误应按真实语义修（正确导入源/正确相对路径/补必填证据），而非把目录加进 CI 过滤名单（那是绿洗）。
收敛 → 直接修，不新建机制。

### d) 相关 Note 引用
无 Note（本单不触治理脚本区/规则文档区，D534 门禁跳过；4 处 finding 缺证据的模式记入
`docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md` 由 D757 回报一并登记）。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- `extensions/sentinels/cash-runway/aggregate.ts` — `GraphStoreReader` 改从 `src/l4/graph-traversal` 导入；`cash_warning` finding 补 `evidence`+`suggestion`
- `extensions/sentinels/cash-runway/computes/compute-cash-runway-months.ts` — 两处 `import type` 相对深度补一层（`../../../../src/...`）
- `extensions/sentinels/cash-runway/computes/compute-receivable-overdue-rate.ts` — 同上
- `extensions/sentinels/revenue-health/aggregate.ts` — `GraphStoreReader` 导入来源修正；`rev_conc_warning` / `rev_growth_warning` 补 `evidence`+`suggestion`
- `extensions/sentinels/revenue-health/computes/compute-revenue-growth.ts` — 两处 `import type` 相对深度补一层
- `extensions/sentinels/key-person-risk/aggregate.ts` — `kpr-dc-warn` finding 补 `evidence`+`suggestion`

不做什么：
- 不改 `src/sentinel/types.ts`（D752 认领中，本单不碰）
- 不改 `scripts/control-tower/check-sentinel-type-net.sh`（D752 门禁本体）
- 不改 `scripts/pre-commit-check.sh`（本地门禁脚本，非本单范围）
- 不改 `.github/workflows/ci.yml`（CI 属控制塔红区）
- 不改 `tests/sentinel/d751-new-sentinel-e2e.test.ts`（D751 已交付，独立认领）
- 不把任何目录加入 CI tsc 过滤名单（绿洗；要修不要藏）

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：`npx tsc --noEmit`（CI `TypeScript + Lint + Iron Laws` 同一入口）+ `npx tsx` 加载哨兵入口
处理（中间步骤）：type net 登记把 3 个哨兵目录拉进编译图 → 编译器解析 `import type` 链 → 校验 finding 字面量对 `SentinelFinding` 的赋值
结果（最终展示在哪）：3 个目录 0 类型错（CI TS 门禁绿）；4 条 finding 在报告/工单里带得出证据与建议

## 架构层: L3（洞察层哨兵体系；产物在 extensions/sentinels/，Mac 侧测试与哨兵核心同域）
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: verify: 在含 D752 登记的编译图下 `npx tsc --noEmit --pretty false` → 点名 3 个目录的错误数 = 0
- [ ] 链路走通: verify: `npx tsx` 加载 cash-runway/revenue-health/key-person-risk/path-dependency 四个入口 → 4/4 LOADED（运行时未回归）
- [ ] 反向验证: verify: 把 `cash-runway/computes/compute-cash-runway-months.ts` 的导入改回 `../../../src/l4/graph-traversal` → 同一编译图下必再红（TS2307 命中该文件）；恢复后绿
- [ ] 结果可见: verify: `grep -c "evidence:" extensions/sentinels/revenue-health/aggregate.ts` → ≥4（两条 warning finding 已带证据）

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-09-15-D757-sentinel-type-debt.md | task |
| extensions/sentinels/cash-runway/aggregate.ts | task |
| extensions/sentinels/cash-runway/computes/compute-cash-runway-months.ts | task |
| extensions/sentinels/cash-runway/computes/compute-receivable-overdue-rate.ts | task |
| extensions/sentinels/key-person-risk/aggregate.ts | task |
| extensions/sentinels/revenue-health/aggregate.ts | task |
| extensions/sentinels/revenue-health/computes/compute-revenue-growth.ts | task |
| task-state/D757.json | task |

