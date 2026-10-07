# T7b：9条零消费边接入生产消费路径

> V2修正: ASSET_LOCKS→LOCKS_IN, 已接线6→7条(AUGMENTS补记), 零消费10→9条, 增加约束6(不创建新哨兵)

## Q0:
a) 项目拼图: L4本体层→L3洞察层。16条边中7条已被哨兵消费(PRODUCES/DEPLOYS/FUNDS/DEPENDS_ON/SIGNAL_TRANSMITS/INFORMS/AUGMENTS)，9条有JSON Schema但零消费。本任务为9条零消费边接入至少1个生产消费者。新建 edge-consumption-map.json 追踪消费状态。新建2个L3诊断模块(assumption-monitor、platform-dependency-check)。在已有哨兵中扩展消费。

b) 文件审计: grep 发现9条边在 src/extensions/sentinels/ 零引用。EdgeType枚举已定义(packages/ontology/src/edge-types.ts)。JSON Schema已存在(extensions/ontology/edge-types/)。已有哨兵模板可用: competitive-moat-structural(护城河)、profit-health(利润)、cost-health(成本)、key-person-risk(关键人)、cash-runway(现金流)。

c) 决策: 无覆盖 — 新建edge-consumption-map.json + 集成测试 + 在已有哨兵中扩展消费。EXTERNAL_ASSUMPTION_BINDS和DEPENDS_ON_PLATFORM走L3诊断模块。不创建新哨兵目录（约束6）。

## Q1:
a) 业界最佳实践: 遵循现有 traversal.traverse([teamId], ['EDGE']) 模式（已在42个哨兵中使用）。先try traversal降级到store.queryNodes。
b) 消费边均使用代码真实16条边名（非JTBD边名）。
c) 约束检查: 验证EdgeType枚举名与JSON Schema文件名一致（external_assumption.json→EXTERNAL_ASSUMPTION_BINDS）; validateEdgeEndpoints在 ontology-loader.ts。

## Q2:
新增: edge-consumption-map.json + 9条边×3个集成测试(tests/l4/edges/) + 7条边接入已有哨兵 + 2个L3诊断模块。9条JSON Schema不动。不创建新哨兵目录。不修改edge-types枚举。不修改aggressive现有7条已接线边的消费。

## Q3:
入口: traversal.traverse() 在哨兵aggregate/compute函数中调用。测试: tests/l4/edges/<边名>.test.ts 验证正常/降级/端点。结果: 16条边grep各≥1引用 + vitest通过 + tsc零错误。

## Q4 契约与测试:
- 每条边≥3个测试（正常路径/降级路径/端点验证）
- 每个新消费者≥2个测试（正常路径+降级路径）
- 使用GraphTraversal，禁止store.queryEdges直接调用
- 零as any
- 零新哨兵目录

## 本任务在哪一层
L4 本体层 (边接线) + L3 洞察层 (哨兵消费)

## Done 标准
- [ ] verify: grep -c "SUBSTITUTES\|METRIC_BINDS\|INCENTIVE_BINDS\|DECISION_CONCENTRATES\|EXTERNAL_ASSUMPTION_BINDS\|LOCKS_IN\|CONSTRAINS\|DEPENDS_ON_PLATFORM\|REPLENISHES" extensions/sentinels/ src/l3/ --include="*.ts" | grep -v "0$" | wc -l >= 9
- [ ] verify: npx vitest run tests/l4/edges/ 2>&1 | tail -5 | grep -q "passed"
- [ ] verify: npx tsc --noEmit 2>&1 | head -5 | grep -q "EXIT=0" && echo "OK"
- [ ] verify: git diff --stat extensions/ontology/edge-types/ | wc -l = 0
- [ ] verify: grep -rn "store.queryEdges" extensions/sentinels/ --include="*.ts" | grep -v "aggregate.ts:.*queryEdges" | wc -l = 0
