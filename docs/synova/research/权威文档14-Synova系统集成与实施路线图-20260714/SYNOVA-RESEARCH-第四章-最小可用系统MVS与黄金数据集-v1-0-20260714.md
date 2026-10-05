<!--
  Synova 权威文档14 | 第四章：最小可用系统（MVS）与黄金数据集
  版本: v1.0 | 日期: 2026-07-14 | 作者: Synova 研究组
  定位: 施工文档——一周时间、一台机器、一个客户（客户A），跑通"诊断->增长导航"的最小子集
-->

# 第四章：最小可用系统（MVS）与黄金数据集

> 核心问题：如果只剩一周时间、一台机器、一个客户（客户A），跑通"诊断->增长导航"的最小子集是什么？如何保证每次系统升级后，同一个案例的诊断结果不会无声退化？
> 本章产出：精确到边ID/哨兵ID/compute contractId的MVS清单 + 6项功能验收 + 黄金数据集版本锁定

---

## 4.0 MVS的设计哲学

**MVS不是"删减版系统"。** MVS是"所有核心因果链路都走通的最小子集"——它要求从数据加载到哨兵扫描到因果追溯到增长导航的完整闭环，但只在客户A这一家企业的数据上验证。

**选取原则**：
- **客户A数据可得性优先**：客户A有完整财务数据（Financial节点）和部分客户数据（CLIENT节点），但缺人才/组织/知识数据。MVS的边和哨兵以财务域和客户域为主。
- **因果链闭环优先**：选取的边必须能组成完整因果链（获取->配置->转化->交付->回流），不能是孤立的能力点。
- **验证过的优先**：在22条因果链中标记为"verified: true"的8条链涉及的边和哨兵优先入选。

---

## 4.1 MVS能力清单

### 4.1.1 P0因果边（17条）

选取覆盖五断裂点+横切感知层的最小子集，确保"获取->配置->转化->交付->回流"完整闭环。

| # | 边ID | 边名称 | 所属断裂点 | 硬度 | 客户A验证 | 入选理由 |
|---|------|--------|----------|------|------------|---------|
| 1 | E-01 | ACTIVE_SCANNING | 横切感知 | soft | 未验证 | 感知层的输入源——虽未验证但MVS需要它作为E-03的输入 |
| 2 | E-02 | PASSIVE_SIGNAL | 横切感知 | soft | 未验证 | 感知层——被动信号积累是E-35客户反馈的数据源 |
| 3 | E-03 | EXTERNAL_ECHO | 横切感知 | soft | 部分验证 | 客户A验证：母婴市场下行market_growth=-8%——env_rent为负值。关键已知事实 |
| 4 | E-05 | CAPITAL_ACQUISITION | 获取 | hard | 已验证 | cash_runway=18个月(equity=200万/monthly_burn=11万)——核心财务基线 |
| 5 | E-06 | FINANCING_MIX | 获取 | hard | 已验证 | D/E=0纯股权融资,WACC=15%——融资结构基线 |
| 6 | E-13 | CAPITAL_ALLOCATION | 配置 | hard | 部分验证 | 多条因果链的骨干边(cc-capital-01/02/03/04,cc-org-01/02,cc-scan-01) |
| 7 | E-23 | OPERATIONAL_EXECUTION | 转化 | hard | 已验证 | 被11条因果链引用的最核心边。fixed_cost_ratio=72%——客户A最关键诊断发现 |
| 8 | E-30 | PRICING | 交付 | hard | 已验证 | 5条链引用。margin_rate从18%降到9%——客户A核心诊断输出 |
| 9 | E-31 | CLIENT_RETENTION | 交付 | hard | 部分验证 | 3条链引用。门店客户进店率下降40%——客户A已知事实 |
| 10 | E-33 | MARKET_COMPETITION | 交付 | soft | 已验证 | 竞争位势评估的核心输入 |
| 11 | E-34 | PROCUREMENT_POWER | 交付 | soft | 已验证 | cc-capital-03的起始边：原材料涨价(玻璃/金属)->unit_cost上升15% |
| 12 | E-36 | COMPETITIVE_POSITION | 交付 | soft | 部分验证 | 竞争位势综合评估——客户A在质量维度仍有优势 |
| 13 | E-37 | PROFIT_REINVEST | 回流 | hard | 已验证 | 5条链引用。profit_margin=5%,retention_ratio=10%——客户A回流端基线 |
| 14 | E-25 | BRAND_CONSTRUCTION | 转化 | soft | 部分验证 | cc-client-02的传导边：品牌搜索量下降60%——客户A已知事实 |
| 15 | E-24 | INNOVATION | 转化 | soft | 部分验证 | cc-client-02起始边：产品从独特手工设计->OEM同质化贴牌 |
| 16 | E-07 | TALENT_ACQUISITION | 获取 | soft | 未验证 | cc-talent-01/02的输入端——虽未验证但人才->执行的因果链需要起点 |
| 17 | E-38 | TALENT_RETENTION | 回流 | hard | 未验证 | cc-talent-02的起始边：3位核心工艺工程师离职——客户A已知事实 |

### 4.1.2 P0哨兵（16个）

| # | 哨兵ID | 消费的边 | 关联compute | 严重度阈值 | 入选理由 |
|---|--------|---------|------------|----------|---------|
| 1 | capital-health | E-13,E-23,E-37 | computeCapitalEfficiency,computeCapitalTurnover,computeDebtEquityRatio | warning:allocation_efficiency<0.5; critical:allocation_efficiency<0.3且revenue_growth<0 | 资本域核心哨兵——合并自capital-efficiency/capital-structure/capital-turnover |
| 2 | margin-health | E-23,E-13,E-30 | computeDOL,computeBreakEven | warning:margin_rate下降>20%; critical:margin_rate<5% | 利润率核心哨兵——客户Amargin从18%降到9%触发此哨兵 |
| 3 | competitive-position | E-33,E-36,E-31 | computeHHI,computeCompetitivePosition | warning:seven_powers_score<0.4; critical:<0.2且competitor_aggressiveness>0.7 | 竞争位势核心哨兵 |
| 4 | sentinel-breakeven | E-13,E-23 | COMPUTE-BREAK-EVEN-v1 | warning:safetyMargin<10%; critical:safetyMargin<0% | 盈亏平衡点——P<AVC时BEP不存在 |
| 5 | sentinel-operating-leverage | E-13,E-23 | COMPUTE-DOL-v1 | warning:DOL>3.0; critical:DOL>5.0 | 经营杠杆——客户Afixed_cost_ratio=72%高杠杆 |
| 6 | sentinel-survival-margin | E-13,E-02,E-31,E-18 | COMPUTE-SURVIVAL-MARGIN-v1 | critical:survivalMargin<20% | 存活边际——横跨资本/信号/客户/规则四维 |
| 7 | cash-runway | E-05,E-37 | computeCashRunway | critical:cash_runway<6月 | 现金流跑道——客户Arunway=18月，核心生存基线 |
| 8 | data-health | E-09 | computeDataQuality | warning:completeness<0.7; critical:freshness<0.5 | 数据管道健康——MVS依赖Fin/CLIENT数据新鲜度 |
| 9 | customer-demand-shift | E-31,E-33 | computeChurnRate | warning:churn_rate上升>20% | 客户需求变化——客户A进店率下降40% |
| 10 | unit-economics | E-23,E-30 | computeUnitEconomics | warning:unit_cost上升>10% | 单位经济学——客户Aunit_cost上升15% |
| 11 | financing-constraint | E-05,E-06 | computeDebtEquityRatio | warning:D/E>2.0; critical:D/E>3.0 | 融资约束——客户AD/E=0健康 |
| 12 | make-or-buy | E-34 | computeProcurementEfficiency | warning:supplier_reliability<0.7 | 自制vs外购——客户A供应商原材料涨价评估 |
| 13 | environment-rent-dependency | E-03 | computeEnvRent | warning:env_rent<0; critical:env_rent<-0.3 | 环境红利依赖——客户Amarket_growth=-8%负值 |
| 14 | incentive-alignment | E-17 | computeIncentiveDistortion | warning:distortion>0.7; critical:agency-cost多信号>0.7 | 激励对齐——组织诊断的基础哨兵 |
| 15 | talent-density | E-07,E-38 | computeTalentDensity | warning:turnover_rate>0.2; critical:key_position_vacancy | 人才密度——客户A3位核心工程师离职 |
| 16 | key-person-risk | E-38,E-41 | computeKeyPersonScore | critical:backup_ratio<1.0 | 关键人风险——客户A工艺工程师离职->新品周期延长 |

### 4.1.3 核心专家（3位）

| # | 专家 | manifest路径 | 核心能力 | MVS中角色 |
|---|------|------------|---------|---------|
| 1 | finance | expert/finance/manifest.json | 消费E-05/E-06/E-13/E-23/E-30/E-37——资本/成本/利润全链路 | 主导cc-capital-01/02/03和cc-client-04——MVS核心诊断 |
| 2 | strategy | expert/strategy/manifest.json | 消费E-03/E-33/E-36——竞争位势/外部环境/战略方向 | 主导cc-client-03和competitive-position哨兵 |
| 3 | action | expert/action/manifest.json | 消费诊断报告->处方建议->工单 | Growth Goal注册和方案哨兵创建的消费方 |

### 4.1.4 核心compute（20个）

| # | contractId | 输入边 | 输出 | 数据源等级 | 客户A可用 |
|---|-----------|--------|------|----------|------------|
| 1 | COMPUTE-BREAK-EVEN-v1 | E-13,E-23 | {bep,safetyMargin,degraded} | A | 是 |
| 2 | COMPUTE-DOL-v1 | E-13,E-23 | {dol,warning_threshold_exceeded} | A | 是 |
| 3 | COMPUTE-PRICE-ELASTICITY-v1 | E-30 | {elasticity,ci95_low,ci95_high} | B | 否(<3次PriceEvent) |
| 4 | COMPUTE-NPV-v1 | E-13,E-37 | {npv,irr,payback_period} | A | 是 |
| 5 | COMPUTE-MARGINAL-COST-v1 | E-23 | {marginalCost,economiesOfScale} | A | 是 |
| 6 | COMPUTE-HHI-v1 | E-33 | {hhi,marketConcentration} | B | 部分 |
| 7 | COMPUTE-SURVIVAL-MARGIN-v1 | E-13,E-02,E-31,E-18 | {survivalMargin,warningFlags} | B | 部分 |
| 8 | COMPUTE-CSF-PROFILE-v1 | E-36,E-01 | {csfWeights,profileMatch} | B | 否 |
| 9 | computeCapitalEfficiency | E-13 | {allocation_efficiency,roi_per_project} | A | 是 |
| 10 | computeCapitalTurnover | E-13,E-23 | {capital_turnover_days,trend} | A | 是 |
| 11 | computeDebtEquityRatio | E-05,E-06 | {debt_equity_ratio,WACC} | A | 是 |
| 12 | computeCashRunway | E-05,E-37 | {cash_runway_months,burn_rate} | A | 是 |
| 13 | computeDOL | E-23 | {dol,fixed_cost_ratio,operating_leverage} | A | 是 |
| 14 | computeBreakEven | E-13,E-23 | {bep_units,bep_revenue} | A | 是 |
| 15 | computeChurnRate | E-31 | {churn_rate,retention_rate,ltv} | B | 部分 |
| 16 | computeHHI | E-33 | {hhi,market_concentration_level} | B | 部分 |
| 17 | computeCompetitivePosition | E-36,E-33,E-31 | {seven_powers_score,moat_strength} | B | 部分 |
| 18 | computeEnvRent | E-03 | {env_rent_score,dependency_level} | B | 是 |
| 19 | computeUnitEconomics | E-23,E-30 | {unit_cost,unit_revenue,unit_margin} | A | 是 |
| 20 | computeMarginTrend | E-23,E-30,E-37 | {margin_trend,cost_trend,revenue_trend} | A | 是 |

### 4.1.5 核心Skill（10个）

从35个出厂内置Skill中选取覆盖L1感知->L3诊断的最小可行深度。

| # | skill_id | tier | expert | 依赖子Skill | MVS角色 |
|---|----------|------|--------|------------|---------|
| 1 | acquire-financial-data | L1 | finance | — | 财务数据获取——MVS数据源基础 |
| 2 | acquire-customer-data | L1 | marketing | — | 客户数据获取——CLIENT节点填充 |
| 3 | analyze-break-even | L2 | finance | — | 盈亏平衡分析->margin-health哨兵 |
| 4 | analyze-operating-leverage | L2 | finance | — | 经营杠杆分析->sentinel-operating-leverage |
| 5 | analyze-capital-allocation | L2 | finance | — | 资本配置分析->capital-health哨兵 |
| 6 | analyze-cost-structure | L2 | finance | — | 成本结构分析->margin-health哨兵 |
| 7 | analyze-competitive-position | L2 | strategy | — | 竞争位势分析->competitive-position哨兵 |
| 8 | diagnose-cashflow-health | L3 | finance | analyze-break-even,analyze-operating-leverage,analyze-capital-allocation | 现金流健康诊断——MVS核心L3 Skill |
| 9 | diagnose-margin-erosion | L3 | finance | analyze-cost-structure,analyze-price-elasticity | 利润率侵蚀诊断——客户A核心诊断Skill |
| 10 | enterprise-growth-diagnosis | L3 | multi | 19个下级L1-L3 Skill | 全企业诊断——MVS闭环的入口Skill |


### 4.1.6 溢出监控（MVS阶段 — 权威15集成，MVS之后首个扩展目标）

MVS阶段溢出监控不完整启用：
- CycleLoader加载出厂商内置4个基础子循环（cash-flow/customer/talent/product）
- 溢出仪表盘使用静态数据模型展示（不实时计算——MVS数据量不足以支撑数据成熟度窗口）
- 投入建议引擎降级为基于已有诊断报告的actionRecommendations直接映射
- 不属于MVS的6项功能验收——是MVS之后的扩展目标

MVS之后四步扩展路径：
1. **第一步（MVS之后首个迭代）**：CycleLoader热加载启用→溢出指标开始实时计算→仪表盘切换到动态生成
2. **第二步**：行业模板加载（GA从预置15-20个模板中选择匹配企业行业的模板）→溢出仪表盘显示行业专用子循环
3. **第三步**：投入建议引擎启用→传导方向模拟可用→执行约束因子检查可用
4. **第四步**：溢出监控循环作为6th Loop全功能启用→溢出转负自动触发Goal生成→纳入系统自检Health Check

### 4.1.6 核心Playbook（3个）

| # | playbook_id | 触发条件 | steps数 | MVS角色 |
|---|------------|---------|---------|---------|
| 1 | finance-profitability-root-cause | profit-health哨兵severity>=P1 | 6 | 利润率下降根因分析——客户A核心Playbook |
| 2 | enterprise-full-diagnosis | GA手动触发或Cron每月 | 全量Phase | 全企业诊断——MVS能力验证的完整链路 |
| 3 | cashflow-crisis | cash-runway哨兵critical | 全量 | 现金流危机诊断——客户A备用Playbook |

### 4.1.7 核心因果链（5条）

从22条因果链中选取在客户A案例中已验证的5条核心链。

| # | chainId | displayName | 客户A验证 | MVS角色 |
|---|---------|------------|------------|---------|
| 1 | cc-capital-03 | 成本驱动型利润衰减链 | verified:true | **核心链**——客户A2023利润下滑的根因链：E-34(PROCUREMENT_POWER)->E-23(OPERATIONAL_EXECUTION)->E-30(PRICING)->E-37(PROFIT_REINVEST) |
| 2 | cc-capital-01 | 资本完整循环链 | verified:partial | 验证"获取->配置->转化->回流->再获取"完整闭环 |
| 3 | cc-client-02 | 客户流失负向循环链 | verified:true | 验证"创新停滞->体验下降->客户流失->品牌侵蚀->人才吸引力下降" |
| 4 | cc-client-04 | 定价决策传导链 | verified:true | 验证"成本上升->margin压缩->无利润再投资" |
| 5 | cc-talent-02 | 人才流失负向循环链 | verified:true | 验证"人才流失->知识断层->效率下降->吸引力下降" |

---

## 4.2 MVS验收标准

### 4.2.1 功能验收（6项，不受硬件影响）

**验收1：数据加载完成**
- 条件：用客户A数据快照启动Synova MVS
- 预期：Phase 0-5全部通过，HTTP服务启动，`/api/health`返回200
- 验证命令：`curl http://localhost:3000/api/health`
- 预期输出：`{"status":"ok","version":"1.0.0-mvs","enterprise":"client-a","phases":{"P0":"ok","P1":"ok","P2":"ok","P3":"ok","P4":"ok","P5":"ok"}}`

**验收2：哨兵扫描完成**
- 条件：所有16个P0哨兵产生Finding
- 预期：每个哨兵最近一次check.success === true
- 验证命令：`curl http://localhost:3000/api/sentinel/reports`
- 预期输出：16个哨兵各至少1条Finding记录（null Finding=数据不足->FAIL）

**验收3：因果链追溯**
- 条件：运行cc-capital-03（成本驱动型利润衰减）的Trace API
- 预期：4步传导路径完整输出——E-34.supplier_reliability -> E-23.fixed_cost_ratio -> E-30.margin_rate -> E-37.profit_margin。每个step有confidence值。
- 验证命令：`curl http://localhost:3000/api/causal-chain/trace?chainId=cc-capital-03`
- 预期输出：`{"path":[{edgeId:"E-34",...},{edgeId:"E-23",...},{edgeId:"E-30",...},{edgeId:"E-37",...}],"totalSteps":4,"degraded":false}`

**验收4：因果链模拟**
- 条件：对E-23施加"fixed_cost_ratio从0.72降到0.58"的变化量，计算传导
- 预期：Simulate API输出各step的outputDelta，最终profit_margin的正向变化（>0）
- 验证命令：`curl -X POST http://localhost:3000/api/causal-chain/simulate -d '{"chainId":"cc-capital-03","perturbation":{"edgeId":"E-23","param":"fixed_cost_ratio","delta":-0.14}}'`
- 预期输出：`{"summary":{"finalImpact":{"profit_margin":delta>0},"amplification":>1.0,"confidence":>0.5}}`

**验收5：因果链反查**
- 条件："利润下降"异常在E-37.profit_margin上，从observedValue=0.05反查到expectedValue=0.18
- 预期：Explain API输出前3大贡献因素，第一名应为E-34或E-23
- 验证命令：`curl -X POST http://localhost:3000/api/causal-chain/explain -d '{"chainId":"cc-capital-03","anomaly":{"edgeId":"E-37","param":"profit_margin","observedValue":0.05,"expectedValue":0.18}}'`
- 预期输出：`{"rootCauses":[{"edgeId":"E-23","contributionPercent":>30,...},{"edgeId":"E-34","contributionPercent":>20,...}],"degraded":false}`

**验收6：增长导航**
- 条件：从诊断报告生成一个Goal -> 注册方案哨兵 -> 检测偏离
- 预期：Goal在CronScheduler中注册成功；方案哨兵check.success=true；检测到profit_margin偏离时会触发finding
- 验证命令：
  1. `curl -X POST http://localhost:3000/api/goals -d '{"type":"profit_improvement","target":"margin_rate=0.12","sourceId":"E-30"}'`
  2. `curl http://localhost:3000/api/goals/plan-sentinels`
  3. 等待Cron触发 -> `curl http://localhost:3000/api/sentinel/reports?sentinel=plan-profit-improvement`
- 预期输出：Goal状态=active，方案哨兵已注册，偏离检测逻辑正常

### 4.2.2 性能基准（4核8GB参考环境）

性能基准用于优化参考，非硬性验收。每次系统升级后重新跑MVS，对比性能基线的变化。

| 指标 | 预期值 | 测量方式 |
|------|--------|---------|
| 启动时间（Phase 0-5总耗时） | <25s | 从`npm run dev`到`/api/health`返回200 |
| 哨兵全量扫描 | <30s | 16个P0哨兵check完成 |
| 因果链Trace（4步链） | <3s | cc-capital-03的Trace API响应时间 |
| 因果链Simulate（4步链） | <5s | 含4次compute调用 |
| 因果链Explain（4步反向归因） | <5s | 含4次弹性系数计算 |
| 全企业诊断Playbook | <180s | enterprise-full-diagnosis Playbook端到端 |
| 内存占用（稳态） | <1.5GB | process.memoryUsage().heapUsed |

---

## 4.3 黄金数据集版本锁定

### 4.3.1 数据快照

```
data/golden/client-a-v1.json  (SHA-256: 记录于首次MVS运行后)
```

**内容**：客户A2023年度完整数据快照，包含：
- Financial节点：revenue/cost时间序列（12个月）
- CLIENT节点：门店客户进店率、客户来源标签
- ExternalBaseline：母婴市场增长率和竞品数据
- PROCESS节点：产品线变更记录、OEM转型时间点
- PERSON节点：3位离职核心工程师信息（如有）
- KnowledgeStore行业基准数据

### 4.3.2 诊断输出checksum

每次MVS运行后，对以下输出计算SHA-256：

1. 16个P0哨兵的Finding集合（JSON规范化排序后）
2. 5条核心因果链的Trace输出
3. enterprise-full-diagnosis Playbook的最终报告文本
4. capital-health/margin-health/competitive-position三个核心哨兵的aggregate结果

**checksum存储位置**：`data/golden/checksums/client-a-v1-checksums.json`

```json
{
  "datasetVersion": "client-a-v1",
  "synovaVersion": "1.0.0-mvs",
  "timestamp": "2026-07-14T00:00:00Z",
  "checksums": {
    "sentinelFindings": "sha256:abc123...",
    "causalChainTraces": "sha256:def456...",
    "enterpriseDiagnosisReport": "sha256:ghi789...",
    "coreAggregates": "sha256:jkl012..."
  }
}
```

### 4.3.3 变更溯源机制

任何系统变更后，用同一份黄金数据重新跑MVS完整闭环。checksum变化时按以下流程处理：

| checksum变化 | 可能原因 | 处理方式 |
|-------------|---------|---------|
| sentinelFindings变化 | 哨兵aggregate逻辑修改、阈值调整 | 预期内 -> 在变更记录中说明"因capital-health阈值从0.3调整到0.25" |
| causalChainTraces变化 | compute函数的transfer_function升级 | 预期内 -> 在变更记录中记录compute版本号变更 |
| enterpriseDiagnosisReport变化 | 专家提示词模板更新 | 需判断：措辞变化但结论一致 -> 预期内；结论反转 -> 非预期退化 -> 回滚+排查 |
| coreAggregates变化 | compute输出公式修正（如E-23效率从2.1修正到2.8） | 预期内 -> 记录"修复了E-23参数覆盖率bug" |
| 全部checksum变化但找不到任何变更记录 | 未知因素 | 非预期退化 -> 回滚到上一版本 + 逐模块排查 |

**黄金数据集锁定的本质**：每次升级都有"回归测试"——确保同一个问题不会因为系统升级而得到不同的答案（除非答案本身在升级中变正确了）。

### 4.3.4 回归测试脚本

```bash
# scripts/workflow/check-golden-regression.sh
# MVS回归测试：用黄金数据集跑完整闭环+checksum验证

GOLDEN_DATA="data/golden/client-a-v1.json"
GOLDEN_CHECKSUMS="data/golden/checksums/client-a-v1-checksums.json"

# Step 1: 加载黄金数据
echo "[1/5] 加载黄金数据集..."
curl -X POST http://localhost:3000/api/data/load -d "@$GOLDEN_DATA"

# Step 2: 哨兵扫描
echo "[2/5] 运行哨兵全量扫描..."
curl -X POST http://localhost:3000/api/sentinel/scan-all
sleep 30  # 等待scan完成

# Step 3: 采集输出并计算checksum
echo "[3/5] 采集输出..."
curl http://localhost:3000/api/sentinel/reports > /tmp/mvs-sentinel-findings.json
curl http://localhost:3000/api/causal-chain/trace-all > /tmp/mvs-chain-traces.json
curl -X POST http://localhost:3000/api/playbook/run -d '{"playbookId":"enterprise-full-diagnosis"}' > /tmp/mvs-diagnosis.json

NEW_SENTINEL_CHECKSUM=$(sha256sum /tmp/mvs-sentinel-findings.json | cut -d' ' -f1)
NEW_CHAIN_CHECKSUM=$(sha256sum /tmp/mvs-chain-traces.json | cut -d' ' -f1)
NEW_DIAGNOSIS_CHECKSUM=$(sha256sum /tmp/mvs-diagnosis.json | cut -d' ' -f1)

# Step 4: 对比
echo "[4/5] 对比checksum..."
OLD_SENTINEL=$(jq -r '.checksums.sentinelFindings' $GOLDEN_CHECKSUMS)
if [ "$NEW_SENTINEL_CHECKSUM" != "$OLD_SENTINEL" ]; then
    echo "[REG] sentinelFindings checksum变化: $OLD_SENTINEL -> $NEW_SENTINEL_CHECKSUM"
    echo "     请确认此变化是否由已知代码变更导致"
fi

# Step 5: 生成回归报告
echo "[5/5] 生成回归报告..."
```

---

## 4.4 MVS的边界与不在MVS中的能力

**MVS明确不包含**（这些能力在正式版中需要，但一周时间+一台机器+MVS目标下可以不做）：

- 组织域的全部哨兵（power-rigidity/network-power/info-distortion/internal-transaction-cost）——客户A缺组织数据，MVS无法验证
- 知识域的全部因果链（cc-org-04/cc-learn-01）——缺KNOWLEDGE_CHUNK数据
- 7层Skill中L4处方层及以上（prescribe-*）——MVS只需要L1-L3诊断，不需要方案生成
- 多企业支持——MVS只加载客户A一家企业数据
- 多语言支持——仅中文
- 热重载协议——MVS是单次启动，不测试运行中模块升级
- 安全/PII脱敏——MVS用脱敏后的黄金数据，不需要运行时PIIScrubber
- 本地自适应层——MVS只有一家企业，不需要企业特异性覆盖

---

> **版本历史**：v1.0 — 2026-07-14 — 初始版本。17条P0边+16个P0哨兵+3位专家+20个compute+10个Skill+3个Playbook+5条因果链。6项功能验收+性能基准+黄金数据集锁定。
