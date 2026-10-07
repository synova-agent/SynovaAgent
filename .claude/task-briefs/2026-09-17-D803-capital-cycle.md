# D803: 线10 资本循环 V1 6/6（第一条 100% 线）——证据落点 + 读侧契约守卫 + 跑道语义修复

> spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D803-capital-cycle-20260917.md（八节齐备，CTO 复核冻结）
> 派单: docs/synova/coordination/派单-D804-D803-DSH标准-20260917.md §三（commit 5be30b43，分支 docs/dispatch-dsh-standard-20260917）
> 北星: .claude/PRODUCT-BRIEF.md §一/§三（哨兵 7×24 主动巡检 → 发现异常 → 主动告警，不是 ChatBot）
> 前置实测: origin/main @0f59e514 上 5 处关键锚点行号重核通过（loader:210-212 / ingest:164 / aggregate:34-41 / GS-03 expect.json / yaml L458-510）
> 前车之鉴: docs/synova/audit-reports/AGENT-CAPABILITY-FULL-CHAIN-AUDIT-20260813.md §2.2（K3 三重缺陷定罪——本卡给这三条收尾）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L3 洞察层（哨兵体系）+ L4 本体契约 + 证据链基建。线10「资本循环」是 26 线里第一条冲 100% 的线：代码链路（POST /api/data/upload → erp-standard 映射 → Financial 节点 → cash-runway manifest 阈值 → critical finding）经 D355/D356/D577/D462 已通、GS-03 三断言 2026-09-16 全绿，但 ledger 只认 1/6。缺口四类：①GS-03 证据映射错位（verdicts 落在 4-5/5-2/4-7，线10 点位零证据）②读侧属性契约无回归守卫（cashBalance↔cash 可无声复发）③跑道/逾期计算两处字段语义缺陷（现金属性缺失→误判为 0→误报/漏报）④10-8 K3 复核未做（本卡只备料）。本任务**不新增业务能力**，是「链已通、补证据 + 补守卫 + 修残留语义缺陷」类收尾。

### b) 文件审计
- 写侧单一事实源: extensions/ontology/field-mappings/erp-standard.json（14 字段）→ 本体 schema extensions/ontology/outcome/financial.json optionalProps（snake_case）。D355 定方向：写侧锚 schema，读侧向 schema 对齐。
- 消费方实测: cash-runway（aggregate + 4 computes）、revenue-health、margin-health、capital-health。实测断裂：revenue-health/aggregate.ts:37 `financialType === 'revenue'`（值域只可能是 'erp-standard'）；compute-cash-runway-months.ts:50 / compute-receivable-overdue-rate.ts:36 `|| total_revenue` 当现金用。
- 复用/扩展/新建: 全部**复用既有**（10 修改 + 0 新建）——测试挂既有 tests/contract/l4-contract.test.ts 与 tests/sentinels/cash-runway/；证据挂既有 GS-03 场景；判分脚本零触碰。
- 冲突排查: 在途 D795（gen-project-board/ledger 生成器）与本卡零文件交集；GS-03 被 D774 rerun 流水线消费，expect.json 变更须过 gss-common schema 校验（已列回归）。
### c) 决策
已有覆盖 → 复用（不新建哨兵、不新增 finding.id：复用 cr_runway_degraded）；无覆盖 → 文件驱动（本卡无新文件）；冲突 → 取消（多租户 teamId 债 / 币种检测 / 10-5 / 10-7 显式不做）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
### Q1a 业界最佳实践
- 「契约当代码」：consumer-driven contract（Pact 模式）——把消费方读名与生产方写名做成**可执行断言**而非文档，是本卡切片②的设计依据（源码读名闭包 + 运行时行为断言双轨）。
- 「失败路径与正常路径同等对待」（Anthropic engineering baseline）：负向相位必须与正相位同场景、同证据格式（本卡切片④在 GS-03 内前插空库相位，而不是另造 GS-XX）。
- 「属性存在性 ≠ 值」（数据工程常识）：`undefined`（属性缺失）与 `0`（真实零值）必须分开处置，否则「没钱」与「没数据」不可区分——正是 S4 行2 误报根因。
### Q1b Anthropic 决策链（5 步序）
SPEC（dev doc 八节）→ 测试（切片②先红：契约 describe 覆盖断裂非 happy path）→ 实现（切片③转绿）→ 接线（生产链复跑：上传→节点→哨兵→阈值告警，非新增符号）→ 验证（切片⑤证据绑定 + 反向必红四条实测）。
### Q1c 决策参考系
参考：Anthropic（机器可验契约 + 失败路径一等公民）/ DeepSeek 第一性原理（单一事实源 = 本体 schema，consumer 对 producer 对齐；无可检测信号时不造假守卫）/ 开源实证（Pact consumer-driven contract；本仓先例 GS-05-alert-closure 已有「空库先跑再注入」相位，直接克隆其形态而非新造）→ 收敛：四决策点（D-1 读侧对齐 / D-2 同场景双相位 / D-3 teamId 登记不修 / D-4 单币种契约声明）双参考系一致，无分歧，直接执行。
### Q1d memory 历史教训
- 铁律 0-2/7：测试先行 + 接线验收；本卡 WIRE CHECK 口径 = 五条生产链复跑（dev doc §八）。
- 铁律 24/31：降级必须 log + degraded + 调用方可见；新增 degraded 路径必有 finding 或 warning 可观测。
- 铁律 33/34/36/38/47/48：命名/分支/全量绿/as any=0/契约优先/测试非空壳。
- 铁律 0-4：GS-03 临时库经 SYNOVA_DB_PATH 显式隔离，禁碰真实 data/synova.db。
- D524：spec 行号必须重核（本次已重核 5 锚点，全部命中）。
- D355 教训反转：l4-contract.test.ts 头注记录了 D355 初版 camelCase 方向被推翻——本卡沿 snake_case 方向收尾，不重蹈。
- D462/D773：GS-03 依赖 better-sqlite3 ABI（Node 24 + sqlite v12）；python 环节 PYTHONIOENCODING=utf-8。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/golden-scenarios/GS-03-capital-cycle/run.sh（切片④：bootstrap 后先空库跑哨兵 → run-response-empty.json，再上传；正相位不变）
- scripts/golden-scenarios/GS-03-capital-cycle/expect.json（切片①④：+threshold-provenance / +financial-node-created / +no-data-degraded-warning / +no-data-no-critical；evidence_map +10-1/+10-3/+10-6）
- extensions/sentinels/cash-runway/computes/compute-cash-runway-months.ts（切片③：现金链删 total_revenue 挪用；现金属性存在性守卫→degraded；消耗链补 operating_expense）
- extensions/sentinels/cash-runway/computes/compute-receivable-overdue-rate.ts（切片③：应收链遍历分支对齐 accounts_receivable||receivables；现金属性缺失而应收>0→degraded）
- extensions/sentinels/revenue-health/aggregate.ts（切片②：回退分支断裂条件 financialType==='revenue' 对齐其自有遍历分支）
- tests/sentinels/cash-runway/compute-cash-runway-months.test.ts（切片③：部分缺失/显式0/字段链 ≥4 新用例）
- tests/sentinels/cash-runway/compute-receivable-overdue-rate.test.ts（切片③：cash 缺失 degraded + 别名对齐用例）
- tests/sentinels/revenue-health.test.ts（切片②：回退分支 total_revenue 命中用例；顺带清 as any）
- tests/contract/l4-contract.test.ts（切片②：追加读侧消费契约 describe，不改既有断言）
- docs/synova/product-lines/product-lines.yaml（切片⑤：仅 10-2 evidence 数组追加 test:l4-contract）
- scripts/golden-scenarios/evidence/GS-03-2026-09-17.json（切片④产物：场景证据原始 JSON 入 git）
- task-state/D803.json（卡状态回填 impl 段）
- .claude/task-briefs/2026-09-17-D803-capital-cycle.md（本任务 task brief 自身，D708 声明源 S3）
- docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D803-capital-cycle-20260917.md（dev doc 契约，CTO 指令④ 要求随 PR 落库）
- docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md（CT 台账登记两项控制塔发现，CTO 指令⑤ 要求）
- docs/synova/product-lines/evidence/test-2026-09-17.json（A2 机器证据，CTO 指令② 要求在含 win 改动的树上重跑产出）
- docs/synova/product-lines/k3-task-line-10-2026-W37.md（10-8 K3 定向复核备料清单，DS7 要求落盘）
不做什么：
- 不改 scripts/product-lines/calc-progress.py（派单红线：只喂证据不改判分）
- 不改 scripts/audit/run-auditor.py（K3 专属红线）
- 不改 src/agent/data-ingest-service.ts（多租户 teamId 写侧契约属线4 V2 域；spec S4 行9 显式登记债，修=越权）
- 不改 src/routes/sentinel.ts（10-5 工单推送是 V1 外 backlog）
- 不改 extensions/ontology/field-mappings/erp-standard.json（反向验证第 2 条只做破坏→还原，不留改动；币种检测 V2）
- 不改 src/sentinel/adapters/cash-flow-sentinel.ts（铁律 37 债但非线10 V1 断言域，独立任务处置）
- 不改 extensions/sentinels/margin-health/aggregate.ts（本卡读名闭包只审不改）
- 不改 docs/synova/product-lines/product-progress.json（G12d 硬门禁：CI 单点生成物，session 禁提交）
- 不做 10-5 告警→工单→推送 / 10-7 报告资本结论（V1 验收标准原文列为 V1 外 backlog）
- 不做 10-8 K3 复核本身（独立审计环节，禁自我审计；本卡只备料）

## Q3: 验收 — 入口 → 交互 → 结果
入口: `POST /api/data/upload`（mapping=erp-standard，erp-standard 契约 14 字段）+ `POST /api/sentinel/run/cash-runway`（手动/场景；生产另有 manifest cron `0 9 * * *`）。
处理: ①GS-03 run.sh bootstrap 真实服务（JWT 自举 + 临时端口 + SYNOVA_DB_PATH 隔离）→ 空库相位先跑哨兵（降级 warning、零 critical）→ 上传注入 → 哨兵巡检。②erp-standard 映射 → ingestBatch → Financial 节点落 sqlite graph_nodes。③sentinel-loader 挂 manifest → aggregate.check → compute 四路并行 → 阈值门（critical 6 / warning 12）。④assert.ts 按 evidence_map 写 scenario 证据；vitest 契约 + compute 套件经 A2 run-machine-evidence 写 test 证据。
结果: `scripts/golden-scenarios/evidence/GS-03-<date>.json` verdicts 同日含 10-1/10-3/10-6（record_type=scenario）；`docs/synova/product-lines/evidence/test-<date>*.json` 含 10-2/10-4（record_type=test）；refresh-all 后 calc-progress 线10 五个点位绿 + 10-8 待 K3；10-8 由 K3 复核后转 verified → 第一条 100% 线。

## 架构层: L3-洞察（哨兵体系；契约锚点 L4 本体）
L3 洞察层（哨兵体系：extensions/sentinels/ 文件驱动哨兵 + compute 纯数学函数）为主；契约锚点属 L4 本体层（extensions/ontology/ 的 schema 与 field-mappings，通过既有 l4-contract 测试间接校验）。L3→L4 是相邻层合法依赖。证据/断言基建在 scripts/（控制塔域，非五层运行时）。零跨层新增依赖：本卡不新增 import 边，只修既有文件内部字段选择与断言。

## Done 标准: 物理命令断言（每条带 verify）
- [ ] DS1 切片①: `bash scripts/golden-scenarios/GS-03-capital-cycle/run.sh` exit 0 且证据含 10-3 pass；反向（注释 sentinel-loader.ts:211）该断言必红留痕 —— verify: `grep -c threshold-provenance scripts/golden-scenarios/GS-03-capital-cycle/expect.json`
- [ ] DS2 切片②: 修复前新 describe 红（原始输出留档）/ 修复后绿 —— verify: `node_modules/.bin/vitest run tests/contract/l4-contract.test.ts tests/sentinels/revenue-health.test.ts`
- [ ] DS3 切片③: cash-runway compute 新增 ≥6 用例绿 + GS-05 回归绿 —— verify: `node_modules/.bin/vitest run tests/sentinels/cash-runway/`
- [ ] DS4 切片④: GS-03 ≥6 断言 exit 0 + 证据 verdicts 同日含 10-1/10-3/10-6 —— verify: `python3 -c "import json,glob;d=json.load(open(sorted(glob.glob('scripts/golden-scenarios/evidence/GS-03-*.json'))[-1]));print(sorted({v['acceptance_point'] for v in d['verdicts']}))"`
- [ ] DS5 切片⑤: list-test-points 含 10-2 + A2 证据含 10-2 与 10-4 —— verify: `python3 scripts/product-lines/list-test-points.py 2>/dev/null | tr ',' '\n' | grep -c '^10-2$'`
- [ ] DS6 反向: 删证据 verdict → refresh 后该点回退 false（对照输出入报告） —— verify: `python3 scripts/product-lines/calc-progress.py >/dev/null && python3 -c "import json;d=json.load(open('docs/synova/product-lines/product-progress.json'));print([p['status'] for l in d['lines'] if l['id']==10 for p in l['points'] if p['id']=='10-1'])"`
- [ ] DS7 refresh-all 后 ledger 线10 v1_passed=5/v1_total=6（10-8 待 K3）+ K3 备料清单落盘 —— verify: `bash scripts/product-lines/refresh-all.sh`
- [ ] DS9 全量 vitest 零新增失败 + tsc 零新增错误 + as any=0 —— verify: `node_modules/.bin/vitest run && npx tsc --noEmit`
- [ ] DS10 写集精确 + 红线自证: `git diff --name-only origin/main...HEAD` 实现类 = spec §10.1 十文件；零 scripts/audit/**、零 calc-progress.py、零 src/** —— verify: `git diff --name-only origin/main...HEAD | grep -cE '^(src/|scripts/audit/|scripts/product-lines/calc-progress\.py)'`
- [ ] DS11 跨天重跑一次证据日期滚动（非同日 stale） —— verify: `bash scripts/golden-scenarios/GS-03-capital-cycle/run.sh`
- [ ] DS12 完成报告含决策记录（§十一 四决策点参考系与结论）+ 未做/未能验显式清单 —— verify: 报告文件落盘并 review
- [ ] 红线（违反=FAIL）: 零 --no-verify；零新增 finding.id（复用 cr_runway_degraded）；不动 10-5/10-7；teamId 债只登记不修
