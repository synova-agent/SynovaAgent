# 第五章：因果链设计

> 权威文档01 | 2026-07-14 | v1.0
> 因果链是42条因果边的串联编排——Tracing the chain of causation through the enterprise.
> 本章定义22条核心因果链、三层能力API规范（Trace/Simulate/Explain）、因果链加载器规格、和因果链依赖关系图。

---

## 5.0 设计原则

### 5.0.1 因果链是什么

因果链是42条因果边的串联编排。它回答"从A到B的传导路径是什么"——不是通过一条边，而是通过多条边按因果方向串联：

```
E-05（资本获取）→ E-13（资本配置）→ E-23（运营执行）→ E-30（定价）→ E-37（利润再投入）
```

这个链表达了：融资成功 → 可分配的资本增加 → 更多资源投入运营 → 运营产出形成产品 → 产品定价 → 利润回流 → 下一轮融资能力增强。

### 5.0.2 设计原则

1. **每条链是42条边的有序序列**：链不定义新的边。链是已有的边的编排
2. **YAML文件存储**：新增因果链 = 新增YAML文件，零代码修改
3. **消费者是三层API**：Trace（沿链下游遍历）、Simulate（施加变化量逐边计算）、Explain（异常反向归因）
4. **自然语言命名**：链的displayName面向企业用户（CEO/CFO/COO），不是技术ID
5. **对标哨兵加载器**：CausalChainLoader = SentinelLoader模式（scan directory → parse YAML → register → cache）

### 5.0.3 命名约定

- 链ID格式：`cc-{domain}-{序号}` 如 `cc-capital-01`
- YAML文件格式：`causal-chains/{chain-id}.yaml`
- YAML字段命名与Playbook YAML和SentinelManifest保持风格一致

---

## 5.1 核心因果链清单（22条）

### 5.1.1 资本域因果链（4条）

#### CC-CAPITAL-01：获取→配置→转化→回流→再获取

```yaml
# causal-chains/cc-capital-01.yaml
chainId: cc-capital-01
version: "1.0.0"
displayName: 资本完整循环链
description: 资本从获取到配置、转化、回流的完整价值循环。验证企业资本是否在正向循环中。
domain: capital
fracturePoints:
  - acquire
  - allocate
  - convert
  - recycle
edgeSequence:
  - edgeId: E-05
    edgeName: CAPITAL_ACQUISITION
    role: source
    inputParams: [equity_raised, debt_raised]
    outputParams: [cash_runway_months]
  - edgeId: E-13
    edgeName: CAPITAL_ALLOCATION
    role: transform
    inputParams: [allocation_efficiency]  # depends on E-05 output
    outputParams: [allocation_ratio]
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: convert
    inputParams: [efficiency_rate, unit_cost]
    outputParams: [defect_rate]
  - edgeId: E-30
    edgeName: PRICING
    role: monetize
    inputParams: [margin_rate, price_elasticity]
    outputParams: [optimal_price]
  - edgeId: E-37
    edgeName: PROFIT_REINVEST
    role: recycle
    inputParams: [profit_margin, retention_ratio]
    outputParams: [reinvestment_efficiency]
sentinels:
  - capital-health
  - cash-runway
  - margin-health
experts:
  - finance
  - strategy
wowBabeValidation:
  verified: partial
  note: "客户Acash_runway=18个月(equity=200万/monthly_burn=11万)，CAPITAL_ACQUISITION验证通过。分配环节(current_ratio=1.3)健康。定价环节：客单价稳定但原材料成本上升侵蚀margin。"
  gap: "定价→利润再投入的闭环数据不完整"
```

#### CC-CAPITAL-02：融资结构→成本→投资决策

```yaml
chainId: cc-capital-02
version: "1.0.0"
displayName: 融资结构传导链
description: 融资来源结构(股权vs债权)如何通过资本成本影响投资决策和增长路径选择。
domain: capital
fracturePoints: [acquire, allocate]
edgeSequence:
  - edgeId: E-06
    edgeName: FINANCING_MIX
    role: source
    inputParams: [debt_equity_ratio, WACC]
    outputParams: [Ke, Kd]
  - edgeId: E-13
    edgeName: CAPITAL_ALLOCATION
    role: decision
    inputParams: [allocation_efficiency]
    outputParams: [allocation_ratio]
  - edgeId: E-37
    edgeName: PROFIT_REINVEST
    role: feedback
    inputParams: [retention_ratio]
    outputParams: [reinvestment_efficiency]
sentinels: [financing-constraint, capital-health]
experts: [finance]
wowBabeValidation:
  verified: true
  note: "客户A纯股权融资，D/E=0，WACC=Ke≈15%(beta=1.2)。无债权压力但Ke偏高——完全依赖单一融资渠道。"
```

#### CC-CAPITAL-03：成本驱动型利润衰减（客户A关键发现）

```yaml
chainId: cc-capital-03
version: "1.0.0"
displayName: 成本驱动型利润衰减链
description: "客户A核心诊断发现：固定成本刚性(72%固定成本比) + 原材料成本上升 → 利润持续衰减。这是5-1000人企业最典型的利润侵蚀模式。"
domain: capital
fracturePoints: [acquire, convert, recycle]
edgeSequence:
  - edgeId: E-34
    edgeName: PROCUREMENT_POWER
    role: input_cost
    inputParams: [procurement_bargaining_power]
    outputParams: [supplier_reliability]
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: cost_structure
    inputParams: [unit_cost, efficiency_rate]
    outputParams: [fixed_cost_ratio]
  - edgeId: E-30
    edgeName: PRICING
    role: pass_through
    inputParams: [margin_rate]
    outputParams: [price_elasticity]
  - edgeId: E-37
    edgeName: PROFIT_REINVEST
    role: profit_erosion
    inputParams: [profit_margin, retention_ratio]
    outputParams: [reinvestment_efficiency]
sentinels:
  - margin-health
  - cash-runway
  - make-or-buy
experts: [finance, business_model]
wowBabeValidation:
  verified: true
  note: "客户A2023年利润下滑的根因链：原材料涨价(玻璃/金属)→unit_cost上升15%→fixed_cost_ratio=72%→难以用efficiency_rate抵消→margin_rate从18%降到9%→profit_margin=5%→retention_ratio=10%（绝大部分利润用于维持运营）。这条链是客户A案例的核心诊断输出。"
```

#### CC-CAPITAL-04：增长投资传导链

```yaml
chainId: cc-capital-04
version: "1.0.0"
displayName: 增长投资传导链
description: 资本再投入到增长方向（新渠道/产品线/区域）→ 市场份额变化 → 竞争位势 → 后续融资能力。
domain: capital
fracturePoints: [allocate, deliver, recycle]
edgeSequence:
  - edgeId: E-37
    edgeName: PROFIT_REINVEST
    role: reinvestment
    inputParams: [reinvestment_efficiency]
    outputParams: [retention_ratio]
  - edgeId: E-13
    edgeName: CAPITAL_ALLOCATION
    role: allocate
    inputParams: [allocation_ratio]
    outputParams: [allocation_efficiency]
  - edgeId: E-33
    edgeName: MARKET_COMPETITION
    role: outcome
    inputParams: [competitive_position_score]
    outputParams: [HHI]
  - edgeId: E-36
    edgeName: COMPETITIVE_POSITION
    role: feedback
    inputParams: [competitive_position_moat]
    outputParams: [moat_strength]
  - edgeId: E-12
    edgeName: EFFICIENCY_FINANCING
    role: signal
    inputParams: [efficiency_signal]
    outputParams: [efficiency_signal]
sentinels: [competitive-position, niche-squeeze, capital-health]
experts: [strategy, finance]
wowBabeValidation: {verified: false, note: "客户A无显著增长投资数据——利润用于维持运营而非扩张。"}
```

### 5.1.2 人才域因果链（3条）

#### CC-TALENT-01：人才获取→部署→执行→增长

```yaml
chainId: cc-talent-01
version: "1.0.0"
displayName: 人才全链路传导链
description: 从人才获取到部署、执行产出的完整因果链路。
domain: talent
fracturePoints: [acquire, allocate, convert]
edgeSequence:
  - edgeId: E-07
    edgeName: TALENT_ACQUISITION
    role: inflow
    inputParams: [hiring_efficiency, employer_attractiveness]
    outputParams: [headcount_gap]
  - edgeId: E-08
    edgeName: TALENT_FILTER
    role: filter
    inputParams: [skill_match_score, filter_precision]
    outputParams: [strategic_alignment]
  - edgeId: E-15
    edgeName: HUMAN_DEPLOYMENT
    role: deploy
    inputParams: [person_skill_match, utilization_rate]
    outputParams: [deployment_score]
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: output
    inputParams: [efficiency_rate]
    outputParams: [defect_rate]
sentinels: [talent-density, key-person-risk, strategy-capability-fit]
experts: [org]
wowBabeValidation: {verified: false, note: "人才数据不足——缺Person节点skill标签和AgentObserver数据。"}
```

#### CC-TALENT-02：人才流失传导链（客户A关键发现）

```yaml
chainId: cc-talent-02
version: "1.0.0"
displayName: 人才流失负向循环链
description: "客户A案例发现：产品线萎缩 → 关键岗位闲置 → 人才流失 → 组织知识断层 → 效率进一步下降 → 更弱的产品能力 → 更多流失。"
domain: talent
fracturePoints: [acquire, convert, recycle]
edgeSequence:
  - edgeId: E-38
    edgeName: TALENT_RETENTION
    role: departure
    inputParams: [retention_rate, turnover_rate]
    outputParams: [compensation_competitiveness]
  - edgeId: E-41
    edgeName: TALENT_PROTECTION
    role: knowledge_loss
    inputParams: [key_person_score, backup_ratio]
    outputParams: [expert_contribution]
  - edgeId: E-20
    edgeName: KNOWLEDGE_SHARING
    role: knowledge_gap
    inputParams: [knowledge_share_rate]
    outputParams: [share_count]
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: efficiency_decline
    inputParams: [efficiency_rate]
    outputParams: [defect_rate]
  - edgeId: E-07
    edgeName: TALENT_ACQUISITION
    role: attraction_weakness
    inputParams: [employer_attractiveness]
    outputParams: [headcount_gap]
sentinels: [key-person-risk, talent-density]
experts: [org, knowledge]
wowBabeValidation:
  verified: true
  note: "客户A:OEM业务萎缩 → 对应产线技术团队裁减 → 3位核心工艺工程师离职 → 儿童餐具产品线从研发到量产周期从6个月延长到11个月 → 新品上市延迟 → 门店增长停滞。这条链是人才流失→组织能力侵蚀的典型场景。"
```

#### CC-TALENT-03：激励机制→行为扭曲→执行偏差

```yaml
chainId: cc-talent-03
version: "1.0.0"
displayName: 激励-行为传导链
description: KPI设计如何驱动人员行为，行为如何影响执行效果。
domain: talent
fracturePoints: [allocate, convert]
edgeSequence:
  - edgeId: E-17
    edgeName: INCENTIVE_ALIGNMENT
    role: incentive_design
    inputParams: [incentive_distortion, kpi_strategic_alignment]
    outputParams: [kpi_conflict_count]
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: behavior_output
    inputParams: [efficiency_rate, defect_rate]
    outputParams: [unit_cost]
sentinels: [incentive-alignment, agency-cost]
experts: [org]
wowBabeValidation: {verified: false, note: "缺KPI数据。"}
```


### 5.1.3 客户域因果链（4条）

#### CC-CLIENT-01：客户获取→定价→留存→反馈

```yaml
chainId: cc-client-01
version: "1.0.0"
displayName: 客户全生命周期链
description: 客户从获取到付费、留存、反馈的完整链路。
domain: client
fracturePoints: [deliver, recycle]
edgeSequence:
  - edgeId: E-32
    edgeName: CHANNEL_EFFICIENCY
    role: acquire
    inputParams: [channel_roi, conversion_rate]
    outputParams: [channel_attribution]
  - edgeId: E-30
    edgeName: PRICING
    role: monetize
    inputParams: [margin_rate]
    outputParams: [price_elasticity]
  - edgeId: E-31
    edgeName: CLIENT_RETENTION
    role: retain
    inputParams: [retention_rate, churn_risk]
    outputParams: [lifetime_value]
  - edgeId: E-35
    edgeName: CUSTOMER_DATA_FEEDBACK
    role: feedback
    inputParams: [feedback_signal]
    outputParams: [feedback_source]
  - edgeId: E-26
    edgeName: PRODUCT_DEFINITION
    role: improve
    inputParams: [product_market_fit_score]
    outputParams: [feature_adoption]
sentinels: [customer-demand-shift, channel-capacity, niche-breadth]
experts: [marketing, business_model]
wowBabeValidation: {verified: false, note: "客户A门店数据粒度不足以建模这个完整链路。"}
```

#### CC-CLIENT-02：客户流失负向循环（客户A关键发现）

```yaml
chainId: cc-client-02
version: "1.0.0"
displayName: 客户流失负向循环链
description: "客户A案例发现：产品创新停滞 → 门店体验下降 → 客户流失 → 收入下降 → 品牌投资削减 → 品牌认知度下降 → 更少的门店客流 → 更低的收入。"
domain: client
fracturePoints: [convert, deliver, recycle]
edgeSequence:
  - edgeId: E-24
    edgeName: INNOVATION
    role: stagnation
    inputParams: [innovation_output, explore_exploit_ratio]
    outputParams: [innovation_rate]
  - edgeId: E-27
    edgeName: SERVICE_DELIVERY
    role: experience_decline
    inputParams: [delivery_quality]
    outputParams: [delivery_speed]
  - edgeId: E-31
    edgeName: CLIENT_RETENTION
    role: churn
    inputParams: [churn_risk]
    outputParams: [lifetime_value]
  - edgeId: E-25
    edgeName: BRAND_CONSTRUCTION
    role: brand_erosion
    inputParams: [brand_strength]
    outputParams: [brand_awareness]
  - edgeId: E-07
    edgeName: TALENT_ACQUISITION
    role: attraction_decay
    inputParams: [employer_attractiveness]
    outputParams: [headcount_gap]
sentinels: [customer-demand-shift, brand-health, channel-capacity]
experts: [marketing, strategy]
wowBabeValidation:
  verified: true
  note: "客户A:产品从独特的手工设计婴童餐具(2018-2021) → 与竞争对手同质化的OEM贴牌(2022-2023) → 品牌差异度消失 → 门店客户进店率下降40% → 品牌搜索量下降60% → 新增代理商无法招募。这是客户流失→品牌侵蚀→人才吸引力下降的完整负向循环。"
```

#### CC-CLIENT-03：外部环境→定价→竞争位势

```yaml
chainId: cc-client-03
version: "1.0.0"
displayName: 外部环境→定价→竞争传导链
description: 外部市场环境变化如何通过定价传导到竞争位势。
domain: client
fracturePoints: [acquire, deliver]
edgeSequence:
  - edgeId: E-03
    edgeName: EXTERNAL_ECHO
    role: environment
    inputParams: [env_rent_score, market_growth]
    outputParams: [env_rent_dependency]
  - edgeId: E-30
    edgeName: PRICING
    role: adjust
    inputParams: [price_elasticity]
    outputParams: [margin_rate]
  - edgeId: E-33
    edgeName: MARKET_COMPETITION
    role: response
    inputParams: [HHI, competitive_position_score]
    outputParams: [competitor_aggressiveness]
  - edgeId: E-36
    edgeName: COMPETITIVE_POSITION
    role: result
    inputParams: [competitive_position_moat]
    outputParams: [moat_strength]
sentinels: [environment-rent-dependency, competitive-position, niche-squeeze]
experts: [strategy]
wowBabeValidation:
  verified: true
  note: "客户A:2023年母婴市场整体下行(market_growth≈-8%)→env_rent=负值→外部逆风。但客户A竞争位势在质量维度仍强——问题是OEM转型削弱了质量差异。"
```

#### CC-CLIENT-04：定价决策传导链（客户A关键发现）

```yaml
chainId: cc-client-04
version: "1.0.0"
displayName: 定价决策传导链
description: 定价决策如何通过成本结构、竞争位势、客户购买意愿传导到实际收入和利润。
domain: client
fracturePoints: [convert, deliver]
edgeSequence:
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: cost_base
    inputParams: [unit_cost]
    outputParams: [fixed_cost_ratio]
  - edgeId: E-30
    edgeName: PRICING
    role: price_setting
    inputParams: [price_elasticity, margin_rate]
    outputParams: [optimal_price]
  - edgeId: E-33
    edgeName: MARKET_COMPETITION
    role: competitor_price
    inputParams: [competitive_position_score]
    outputParams: [HHI]
  - edgeId: E-37
    edgeName: PROFIT_REINVEST
    role: result
    inputParams: [profit_margin]
    outputParams: [reinvestment_efficiency]
sentinels: [margin-health, unit-economics, competitive-position]
experts: [finance, marketing]
wowBabeValidation:
  verified: true
  note: "客户A:unit_cost上升15%→margin从18%降到9%→无法提价(同行均价为对标上限)→profit_margin=5%→无利润再投资→品牌投资预算从年度营收5%降到0。这条链揭示了'成本推动型利润衰减'的完整传导——不是定价策略的错误，而是成本结构刚性导致的被动利润侵蚀。"
```

### 5.1.4 组织域因果链（4条）

#### CC-ORG-01：权力→决策→配置→效率

```yaml
chainId: cc-org-01
version: "1.0.0"
displayName: 权力-决策传导链
description: 权力结构如何影响决策速度和质量，进而影响资本配置效率和运营执行效率。
domain: organization
fracturePoints: [allocate, convert]
edgeSequence:
  - edgeId: E-14
    edgeName: DECISION_POWER
    role: structure
    inputParams: [power_gini, decision_quality]
    outputParams: [decision_latency]
  - edgeId: E-13
    edgeName: CAPITAL_ALLOCATION
    role: allocation_result
    inputParams: [allocation_efficiency]
    outputParams: [allocation_ratio]
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: execution_result
    inputParams: [efficiency_rate, unit_cost]
    outputParams: [defect_rate]
sentinels: [power-rigidity, network-power, resource-misallocation]
experts: [org]
wowBabeValidation: {verified: false, note: "缺组织权力结构数据(OWNS边采集)。"}
```

#### CC-ORG-02：信息失真→决策错误→配置失败

```yaml
chainId: cc-org-02
version: "1.0.0"
displayName: 信息-决策质量传导链
description: 信息传递失真如何导致决策错误，决策错误如何导致资源配置失败。
domain: organization
fracturePoints: [allocate]
edgeSequence:
  - edgeId: E-16
    edgeName: INFO_TRANSMISSION
    role: signal_quality
    inputParams: [signal_fidelity]
    outputParams: [channel_quality]
  - edgeId: E-14
    edgeName: DECISION_POWER
    role: decision
    inputParams: [decision_quality]
    outputParams: [power_gini]
  - edgeId: E-13
    edgeName: CAPITAL_ALLOCATION
    role: allocation
    inputParams: [allocation_efficiency]
    outputParams: [allocation_ratio]
sentinels: [info-distortion, resource-misallocation]
experts: [org]
wowBabeValidation: {verified: false, note: "缺INTERACTS_WITH边采集数据。"}
```

#### CC-ORG-03：信任→协同→效率

```yaml
chainId: cc-org-03
version: "1.0.0"
displayName: 信任-协同传导链
description: 组织信任水平通过跨职能协同传导到运营效率。
domain: organization
fracturePoints: [convert]
edgeSequence:
  - edgeId: E-21
    edgeName: ORG_TRUST
    role: trust
    inputParams: [trust_level, collaboration_frequency]
    outputParams: [internal_transaction_cost_ratio]
  - edgeId: E-28
    edgeName: CROSS_FUNCTIONAL_SYNERGY
    role: synergy
    inputParams: [synergy_score]
    outputParams: [cross_team_dependency]
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: efficiency
    inputParams: [efficiency_rate]
    outputParams: [unit_cost]
sentinels: [internal-transaction-cost]
experts: [org]
wowBabeValidation: {verified: false, note: "缺组织交互数据。"}
```

#### CC-ORG-04：学习→知识积累→创新

```yaml
chainId: cc-org-04
version: "1.0.0"
displayName: 学习-知识-创新传导链
description: 组织学习到知识积累到创新的正反馈循环。
domain: organization
fracturePoints: [convert]
edgeSequence:
  - edgeId: E-19
    edgeName: ORG_LEARNING
    role: learn
    inputParams: [learning_rate, knowledge_accumulation]
    outputParams: [learning_contribution]
  - edgeId: E-20
    edgeName: KNOWLEDGE_SHARING
    role: share
    inputParams: [knowledge_share_rate]
    outputParams: [share_count]
  - edgeId: E-24
    edgeName: INNOVATION
    role: innovate
    inputParams: [innovation_rate]
    outputParams: [innovation_output]
sentinels: [knowledge-access, ai-ecosystem-fit]
experts: [knowledge, tech]
wowBabeValidation: {verified: false, note: "缺知识管理数据。"}
```


### 5.1.5 感知域因果链（2条）

#### CC-SCAN-01：扫描→机会窗口→市场份额

```yaml
chainId: cc-scan-01
version: "1.0.0"
displayName: 扫描-机会传导链
description: 主动扫描行为如何捕获外部机会信号，机会信号如何通过配置和转化变为市场份额。
domain: perception
fracturePoints: [acquire, allocate, deliver]
edgeSequence:
  - edgeId: E-01
    edgeName: ACTIVE_SCANNING
    role: scan
    inputParams: [scan_frequency, scan_breadth, signal_sensitivity]
    outputParams: [noise_ratio]
  - edgeId: E-02
    edgeName: PASSIVE_SIGNAL
    role: accumulate
    inputParams: [passive_signal_strength, relevance_weight]
    outputParams: [signal_strength]
  - edgeId: E-03
    edgeName: EXTERNAL_ECHO
    role: evaluate
    inputParams: [env_rent_score]
    outputParams: [env_rent_dependency]
  - edgeId: E-13
    edgeName: CAPITAL_ALLOCATION
    role: act
    inputParams: [allocation_efficiency]
    outputParams: [allocation_ratio]
  - edgeId: E-33
    edgeName: MARKET_COMPETITION
    role: result
    inputParams: [competitive_position_score]
    outputParams: [HHI]
sentinels: [opportunity-window, niche-squeeze, environment-rent-dependency]
experts: [strategy, marketing]
wowBabeValidation: {verified: false, note: "缺主动扫描行为数据。"}
```

#### CC-LEARN-01：感知→学习→知识→创新（跨域）

```yaml
chainId: cc-learn-01
version: "1.0.0"
displayName: 感知学习-创新传导链
description: 感知外部现实→纠正内部认知→加速组织学习→知识积累→创新的跨域传导。
domain: perception
fracturePoints: [acquire, convert]
edgeSequence:
  - edgeId: E-04
    edgeName: PERCEPTION_LEARNING
    role: perceive
    inputParams: [perception_accuracy]
    outputParams: [model_confidence]
  - edgeId: E-19
    edgeName: ORG_LEARNING
    role: learn
    inputParams: [learning_rate]
    outputParams: [learning_contribution]
  - edgeId: E-20
    edgeName: KNOWLEDGE_SHARING
    role: accumulate
    inputParams: [knowledge_share_rate]
    outputParams: [share_count]
  - edgeId: E-24
    edgeName: INNOVATION
    role: output
    inputParams: [innovation_rate]
    outputParams: [innovation_output]
sentinels: [ai-ecosystem-fit, knowledge-access]
experts: [knowledge, tech]
wowBabeValidation: {verified: false, note: "heuristic边，无定量数据。"}
```

### 5.1.6 运营域因果链（3条）

#### CC-OPS-01：运营执行→交付质量→客户留存

```yaml
chainId: cc-ops-01
version: "1.0.0"
displayName: 运营-交付-留存传导链
description: 运营执行的效率和质量如何传导到交付质量和客户留存。
domain: operations
fracturePoints: [convert, deliver]
edgeSequence:
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: produce
    inputParams: [efficiency_rate, defect_rate, unit_cost]
    outputParams: [fixed_cost_ratio]
  - edgeId: E-27
    edgeName: SERVICE_DELIVERY
    role: deliver
    inputParams: [delivery_quality, delivery_speed]
    outputParams: [service_cost]
  - edgeId: E-31
    edgeName: CLIENT_RETENTION
    role: retain
    inputParams: [retention_rate, churn_risk]
    outputParams: [lifetime_value]
sentinels: [margin-health, customer-demand-shift, unit-economics]
experts: [ops, marketing]
wowBabeValidation: {verified: false, note: "缺运营数据(delivery_quality等)。"}
```

#### CC-OPS-02：技术基础设施→运营效率→成本

```yaml
chainId: cc-ops-02
version: "1.0.0"
displayName: 技术→运营→成本传导链
description: 技术基础设施质量如何影响运营效率和成本结构。
domain: operations
fracturePoints: [convert]
edgeSequence:
  - edgeId: E-29
    edgeName: TECH_INFRASTRUCTURE
    role: foundation
    inputParams: [infrastructure_health, tech_debt_score]
    outputParams: [system_stability]
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: impact
    inputParams: [efficiency_rate, unit_cost]
    outputParams: [defect_rate]
sentinels: [data-health, api-coverage]
experts: [tech]
wowBabeValidation: {verified: false, note: "客户A为轻资产品牌/贸易公司，技术边不显著。"}
```

#### CC-OPS-03：跨职能协同→创新→产品

```yaml
chainId: cc-ops-03
version: "1.0.0"
displayName: 协同-创新传导链
description: 跨职能协同如何促进创新，创新如何转化为产品定义和市场匹配。
domain: operations
fracturePoints: [convert]
edgeSequence:
  - edgeId: E-28
    edgeName: CROSS_FUNCTIONAL_SYNERGY
    role: collaborate
    inputParams: [synergy_score]
    outputParams: [cross_team_dependency]
  - edgeId: E-24
    edgeName: INNOVATION
    role: innovate
    inputParams: [innovation_rate]
    outputParams: [innovation_output]
  - edgeId: E-26
    edgeName: PRODUCT_DEFINITION
    role: productize
    inputParams: [product_market_fit_score]
    outputParams: [feature_adoption]
sentinels: [knowledge-access, strategy-capability-fit]
experts: [org, tech]
wowBabeValidation: {verified: false, note: "缺组织协同数据。"}
```

### 5.1.7 数据与规则域（2条）

#### CC-DATA-01：数据质量→诊断精度→决策→执行

```yaml
chainId: cc-data-01
version: "1.0.0"
displayName: 数据-决策质量传导链
description: 数据采集质量如何影响诊断精度，进而影响决策质量和执行效果。
domain: data
fracturePoints: [acquire, allocate, convert]
edgeSequence:
  - edgeId: E-09
    edgeName: DATA_ACQUISITION
    role: source
    inputParams: [completeness, freshness, accuracy]
    outputParams: [data_freshness]
  - edgeId: E-14
    edgeName: DECISION_POWER
    role: decision
    inputParams: [decision_quality]
    outputParams: [power_gini]
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: execution
    inputParams: [efficiency_rate]
    outputParams: [defect_rate]
sentinels: [data-health, api-coverage]
experts: [tech, knowledge]
wowBabeValidation:
  verified: true
  note: "客户A数据质量评估：completeness≈0.45（主要来自财务报表），freshness≈0.75（月报），accuracy≈0.90。数据不完整是诊断精度受限的根因——品牌/组织/客户链的数据几乎为0。"
```

#### CC-RULE-01：规则僵化→适应力→运营灵活度

```yaml
chainId: cc-rule-01
version: "1.0.0"
displayName: 规则-灵活性传导链
description: 规则和合规约束如何影响企业适应环境变化的能力。
domain: compliance
fracturePoints: [allocate, convert]
edgeSequence:
  - edgeId: E-18
    edgeName: RULE_CONSTRAINT
    role: constraint
    inputParams: [rule_rigidity, compliance_burden]
    outputParams: [brake_existence]
  - edgeId: E-23
    edgeName: OPERATIONAL_EXECUTION
    role: flexibility
    inputParams: [efficiency_rate]
    outputParams: [defect_rate]
sentinels: [survival-margin, cash-runway]
experts: [org, compliance]
wowBabeValidation: {verified: false, note: "客户A为轻组织，合规边不显著。"}
```

---

## 5.2 因果链依赖关系图

### 5.2.1 共享边的链

以下边被多条因果链引用——这些边是因果体系的"骨干边"：

| 边 | 被引用的因果链 | 角色 |
|---|-------------|------|
| E-23 OPERATIONAL_EXECUTION | cc-capital-01, cc-capital-03, cc-talent-01, cc-talent-02, cc-talent-03, cc-org-01, cc-org-03, cc-ops-01, cc-ops-02, cc-data-01, cc-rule-01 | 最核心的转化边——几乎所有链都经过它 |
| E-30 PRICING | cc-capital-01, cc-capital-03, cc-client-01, cc-client-03, cc-client-04 | 核心定价边 |
| E-13 CAPITAL_ALLOCATION | cc-capital-01, cc-capital-02, cc-capital-04, cc-org-01, cc-org-02, cc-scan-01 | 核心配置边 |
| E-37 PROFIT_REINVEST | cc-capital-01, cc-capital-02, cc-capital-03, cc-capital-04, cc-client-04 | 核心回流边 |
| E-31 CLIENT_RETENTION | cc-client-01, cc-client-02, cc-ops-01 | 核心客户留存边 |
| E-07 TALENT_ACQUISITION | cc-talent-01, cc-talent-02, cc-client-02 | 核心获取边 |

### 5.2.2 链间串联关系

```
cc-scan-01（扫描→机会）─┐
                         ├→ cc-capital-01（资本循环）→ cc-capital-04（增长投资）
cc-data-01（数据→决策）───┘                                         │
                                                                   v
cc-talent-01（人才→执行）→ cc-ops-01（运营→交付）→ cc-client-01（客户→反馈）
       │                        │                        │
       v                        v                        v
cc-talent-02（人才流失）  cc-ops-02（技术→成本）  cc-client-02（客户流失）
                                                   cc-client-03（外部→定价）
                                                   cc-client-04（定价决策）
       │
       v
cc-org-01（权力→效率）→ cc-org-02（信息→决策）→ cc-org-03（信任→协同）→ cc-org-04（学习→创新）
                                                                               │
                                                                               v
                                                                       cc-learn-01（感知→知识）
```

**关键串联路径**（客户A全链路验证）：

1. **获取→转化→交付→回流**（正向循环）：cc-scan-01 → cc-capital-01 → cc-ops-01 → cc-client-01 → cc-capital-04
2. **成本侵蚀路径**（负向循环）：cc-capital-03 → cc-client-04 → cc-client-02 → cc-talent-02
3. **数据→决策路径**：cc-data-01 → cc-org-02 → cc-org-01

### 5.2.3 客户A覆盖率

22条因果链中，11条在客户A案例中被验证（有数据支撑或诊断报告确认）：

| 状态 | 数量 | 链路 |
|------|------|------|
| 已验证（verified: true） | 8 | cc-capital-01(partial), cc-capital-02, cc-capital-03, cc-talent-02, cc-client-02, cc-client-03, cc-client-04, cc-data-01 |
| 未验证（verified: false） | 14 | cc-capital-04, cc-talent-01, cc-talent-03, cc-client-01, cc-org-01~04, cc-scan-01, cc-learn-01, cc-ops-01~03, cc-rule-01 |

覆盖率：8/22 = 36%。客户A作为品牌/贸易公司，数据主要集中在财务和客户域——组织域和运营域的因果链需要更强数据采集后验证。

---

## 5.3 三层能力API规范

### 5.3.1 Trace（追溯）——沿链下游遍历

**函数签名**：
```typescript
/**
 * 沿因果链从指定边向下游遍历，返回完整传导路径。
 * @param chainId - 因果链ID
 * @param startEdgeId - 起始边ID（可选，默认从链的第一条边开始）
 * @param maxDepth - 最大遍历深度（可选，默认遍历整条链）
 * @returns 传导路径：边序列 + 每个节点的中间状态
 */
function traceCausalChain(
  chainId: string,
  options?: { startEdgeId?: string; maxDepth?: number }
): Promise<{
  path: CausalPathStep[];
  totalSteps: number;
  degraded: boolean;
}>;

interface CausalPathStep {
  edgeId: string;
  edgeName: string;
  role: string;           // source | transform | convert | monetize | recycle | decision | etc.
  inputParams: Record<string, number>;
  outputParams: Record<string, number>;
  confidence: number;     // 0-1, 基于该边的硬度等级
  computationTimeMs: number;
}
```

**伪代码**：
```
trace(chainId):
  chain = CausalChainRegistry.get(chainId)
  if not chain: return {path:[], degraded:true}
  
  path = []
  for each edge in chain.edgeSequence:
    // 1. 从上游获取输入参数
    inputs = if prev_edge exists: prev_edge.outputParams
             else: load parameter baselines from GraphStore
    
    // 2. 执行该边的transfer_function
    outputs = edge.transfer_function(inputs)
    
    // 3. 记录中间状态
    path.push({edgeId: edge.id, inputParams: inputs, outputParams: outputs,
               confidence: edge.hardness=='hard'?0.9:edge.hardness=='soft'?0.6:0.3})
  
  return {path, totalSteps: path.length, degraded: false}
```

### 5.3.2 Simulate（模拟）——施加变化量逐边计算

**函数签名**：
```typescript
/**
 * 在因果链的起始边施加一个变化量，逐边模拟传导效果。
 * @param chainId - 因果链ID
 * @param perturbation - 施加的变化量：{edgeId: string, param: string, delta: number}
 * @returns 每条边的模拟结果，包括传导后的变化量
 */
function simulateCausalChain(
  chainId: string,
  perturbation: { edgeId: string; param: string; delta: number }
): Promise<{
  chainId: string;
  perturbation: { edgeId: string; param: string; delta: number };
  steps: SimulationStep[];
  summary: {
    finalImpact: Record<string, number>;  // 最终边输出参数的变化量
    amplification: number;                // 传导放大/衰减倍数
    confidence: number;                   // 模拟整体置信度（从各边置信度合成）
  };
  degraded: boolean;
}>;

interface SimulationStep {
  edgeId: string;
  edgeName: string;
  inputDelta: Record<string, number>;   // 输入变化量
  outputDelta: Record<string, number>;  // 输出变化量
  elasticity: Record<string, number>;   // 每个参数对该边输出的弹性系数
}
```

**伪代码**：
```
simulate(chainId, perturbation):
  chain = CausalChainRegistry.get(chainId)
  if not chain: return degraded
  
  // 1. 找到扰动边在链中的位置
  startIdx = find edge in chain.edgeSequence with edgeId=perturbation.edgeId
  if startIdx < 0: return error "Perturbation edge not in chain"
  
  steps = []
  currentDeltas = {perturbation.param: perturbation.delta}
  
  for i = startIdx to chain.edgeSequence.length-1:
    edge = chain.edgeSequence[i]
    
    // 2. 计算弹性系数（局部线性近似）
    //    对于hard边：使用transfer_function的偏导数
    //    对于soft边：使用历史数据回归的弹性系数
    //    对于heuristic边：使用默认系数0.3（保守估计）
    elasticities = computeElasticities(edge, currentDeltas)
    
    // 3. 传导变化量
    outputDeltas = {}
    for each output param:
      outputDeltas[param] = sum(elasticities[input][output] * currentDeltas[input])
    
    steps.push({edgeId, inputDelta: currentDeltas, outputDelta: outputDeltas, elasticities})
    currentDeltas = outputDeltas
  
  // 4. 计算最终影响和放大系数
  finalImpact = steps.last.outputDelta
  amplification = |finalImpact| / |perturbation.delta|
  confidence = product of confidence over all steps (decay by depth)
  
  return {chainId, perturbation, steps, summary: {finalImpact, amplification, confidence}}
```

### 5.3.3 Explain（解释）——异常反向归因

**函数签名**：
```typescript
/**
 * 给定最终边的异常输出，沿因果链反向归因到根因边。
 * @param chainId - 因果链ID
 * @param anomaly - 异常描述：{edgeId: string, param: string, observedValue: number, expectedValue: number}
 * @returns 归因路径：从异常边回溯到根因边的贡献度分配
 */
function explainCausalChain(
  chainId: string,
  anomaly: { edgeId: string; param: string; observedValue: number; expectedValue: number }
): Promise<{
  anomaly: { edgeId: string; param: string; delta: number; deltaPercent: number };
  attribution: AttributionStep[];  // 从最终边到起始边的归因链
  rootCauses: Array<{             // 前3大贡献因素
    edgeId: string;
    edgeName: string;
    param: string;
    contributionPercent: number;
    explanation: string;           // 自然语言解释
  }>;
  degraded: boolean;
}>;

interface AttributionStep {
  edgeId: string;
  edgeName: string;
  role: string;
  contributedDelta: Record<string, number>;  // 该边各参数对异常delta的贡献
  attributionPercent: number;                 // 该边总体贡献百分比
}
```

**伪代码**：
```
explain(chainId, anomaly):
  chain = CausalChainRegistry.get(chainId)
  anomalyDelta = anomaly.observedValue - anomaly.expectedValue
  anomalyPercent = anomalyDelta / anomaly.expectedValue * 100
  
  // 1. 找到异常边在链中的位置
  anomalyIdx = find edge in chain with edgeId=anomaly.edgeId
  
  // 2. 反向逐边归因（从异常边向起始边回溯）
  attribution = []
  remainingDelta = anomalyDelta
  
  for i = anomalyIdx down to 0:
    edge = chain.edgeSequence[i]
    
    // 计算该边各输入参数对输出异常的贡献
    // 使用局部弹性系数 × 输入变化量 = 贡献
    elasticities = computeElasticities(edge)
    contributions = {}
    totalContribution = 0
    
    for each input param:
      contributions[param] = elasticities[param][anomalyParam] * (inputDelta[param] or 1.0)
      totalContribution += contributions[param]
    
    // 归一化
    for each input param:
      contributions[param] /= totalContribution
    
    attribution.push({
      edgeId: edge.id,
      edgeName: edge.name,
      role: edge.role,
      contributedDelta: contributions,
      attributionPercent: totalContribution * 100
    })
    
    remainingDelta = remainingDelta * (1 - totalContribution)
  
  // 3. 排序找前3大根因
  rootCauses = attribution
    .sort by contributionPercent descending
    .slice(0, 3)
    .map to {edgeId, edgeName, param: top contributing param, contributionPercent, explanation: generate NL}
  
  return {anomaly: {...}, attribution, rootCauses, degraded: false}
```

---


## 5.4 因果链加载器规格

对标 `src/sentinel/sentinel-loader.ts` 的加载模式：扫描目录 → 解析manifest文件 → 注册到Registry → 缓存。

### 5.4.1 目录结构

```
extensions/causal-chains/
├── cc-capital-01.yaml
├── cc-capital-02.yaml
├── ...
├── cc-rule-01.yaml
└── shared/
    └── chain-utils.ts       # 共享工具函数（可选）
```

### 5.4.2 CausalChainManifest YAML格式

```yaml
# 文件名: {chainId}.yaml
chainId: cc-capital-01
version: "1.0.0"
type: causal-chain               # 固定值
displayName: 资本完整循环链       # 面向CEO/CFO的中文名
description: ...                  # 自然语言描述
domain: capital|talent|client|organization|perception|operations|data|compliance
fracturePoints: [acquire, allocate, convert, recycle]  # 该链涉及的断裂点
edgeSequence:                     # 有序边序列
  - edgeId: E-05
    edgeName: CAPITAL_ACQUISITION
    role: source                 # 该边在此链中的角色
    inputParams: [equity_raised, debt_raised]    # 从上游或GraphStore获取
    outputParams: [cash_runway_months]
  - edgeId: E-13
    edgeName: CAPITAL_ALLOCATION
    role: transform
    inputParams: [allocation_efficiency]
    outputParams: [allocation_ratio]
sentinels: [capital-health, cash-runway]  # 关联哨兵
experts: [finance, strategy]              # 关联专家
estimatedComputeDuration: <3s             # 预估计算时间（22步×平均100ms）
wowBabeValidation:             # 客户A验证结果（元数据）
  verified: true|false|partial
  note: "验证说明"
  gap: "数据缺口说明"         # verified=false时必填
```

### 5.4.3 TypeScript接口

```typescript
// src/causal-chain/chain-loader.ts
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@synova/logger';

const log = createLogger('causal-chain/loader');

export interface CausalChainManifest {
  chainId: string;
  version: string;
  type: 'causal-chain';
  displayName: string;
  description: string;
  domain: 'capital' | 'talent' | 'client' | 'organization' | 'perception' | 'operations' | 'data' | 'compliance';
  fracturePoints: string[];
  edgeSequence: Array<{
    edgeId: string;
    edgeName: string;
    role: string;
    inputParams: string[];
    outputParams: string[];
  }>;
  sentinels: string[];
  experts: string[];
  estimatedComputeDuration: string;
  wowBabeValidation?: {
    verified: boolean | 'partial';
    note: string;
    gap?: string;
  };
}

export interface LoadedChain {
  manifest: CausalChainManifest;
  filePath: string;
}

const CHAINS_DIR = join(process.cwd(), 'extensions', 'causal-chains');

// Cache —— 对标 sentinel-loader.ts
let cache: LoadedChain[] | null = null;

/**
 * 扫描 extensions/causal-chains/ 目录，加载所有因果链 YAML。
 * 对标 loadSentinels()。
 */
export function loadCausalChains(): { chains: LoadedChain[]; degraded: boolean; errors: string[] } {
  const errors: string[] = [];

  if (cache) return { chains: cache, degraded: false, errors: [] };

  const chains: LoadedChain[] = [];

  try {
    if (!existsSync(CHAINS_DIR)) {
      errors.push(`因果链目录不存在: ${CHAINS_DIR}`);
      return { chains: [], degraded: true, errors };
    }

    const entries = readdirSync(CHAINS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.yaml') && !entry.name.endsWith('.yml')) continue;
      if (entry.name.startsWith('_')) continue;

      const filePath = join(CHAINS_DIR, entry.name);
      try {
        // YAML解析 —— 当前用简单JSON.parse（正式实现时用yaml库）
        const raw = readFileSync(filePath, 'utf-8');
        const manifest = parseYamlManifest(raw);  // 需实现YAML→CausalChainManifest解析
        if (!manifest.chainId || !manifest.edgeSequence?.length) {
          errors.push(`因果链 ${entry.name} 缺少 chainId 或 edgeSequence`);
          continue;
        }
        chains.push({ manifest, filePath });
      } catch (err: any) {
        errors.push(`因果链 ${entry.name} 解析失败: ${err.message}`);
      }
    }

    log.info({ count: chains.length, errors: errors.length }, '因果链加载完成');
    cache = chains;
    return { chains, degraded: errors.length > 0, errors };
  } catch (err: any) {
    log.error({ err }, '因果链加载失败 — degraded');
    return { chains: [], degraded: true, errors: [err.message] };
  }
}

/**
 * 按域筛选因果链。
 * 对标 getSentinelsByExpert()。
 */
export function getChainsByDomain(domain: string): LoadedChain[] {
  const { chains } = loadCausalChains();
  return chains.filter(c => c.manifest.domain === domain);
}

/**
 * 按断裂点筛选因果链。
 */
export function getChainsByFracturePoint(fracturePoint: string): LoadedChain[] {
  const { chains } = loadCausalChains();
  return chains.filter(c => c.manifest.fracturePoints.includes(fracturePoint));
}

/**
 * 清除缓存（用于热加载）。
 * 对标 clearSentinelCache()。
 */
export function clearChainCache(): void {
  cache = null;
}
```

### 5.4.4 CausalChainRegistry

```typescript
// src/causal-chain/chain-registry.ts
import { loadCausalChains, LoadedChain, CausalChainManifest } from './chain-loader';

class CausalChainRegistry {
  private chains: Map<string, LoadedChain> = new Map();
  private initialized = false;

  async init(): Promise<{ registered: number; errors: string[] }> {
    if (this.initialized) return { registered: this.chains.size, errors: [] };
    
    const { chains, errors } = loadCausalChains();
    for (const chain of chains) {
      this.chains.set(chain.manifest.chainId, chain);
    }
    this.initialized = true;
    return { registered: this.chains.size, errors };
  }

  get(chainId: string): CausalChainManifest | null {
    return this.chains.get(chainId)?.manifest ?? null;
  }

  list(): CausalChainManifest[] {
    return Array.from(this.chains.values()).map(c => c.manifest);
  }

  listByDomain(domain: string): CausalChainManifest[] {
    return this.list().filter(c => c.domain === domain);
  }

  clear(): void {
    this.chains.clear();
    this.initialized = false;
  }
}

export const causalChainRegistry = new CausalChainRegistry();
```

---

## 5.5 因果链与Playbook的关系

因果链不是Playbook的替代品——它们在不同的层级：

| 维度 | 因果链 | Playbook |
|------|--------|----------|
| 层级 | 表达层 | 编排层 |
| 做什么 | 定义"从A到B的传导路径" | 定义"为回答诊断问题Q，按什么顺序调用哪些边" |
| 消费者 | Trace/Simulate/Explain API | ConversationEngine / FDE诊断流程 |
| 文件格式 | YAML（新增） | YAML（已有） |
| 触发方式 | API调用（按需）/ Sentinel关联（定时） | 用户触发（FDE） / Cron触发（Sentinel） |
| YAML字段 | chainId, edgeSequence, sentinels | playbookId, phases, skills, edges |

**Playbook消费因果链**：Playbook中的一个phase可以引用因果链作为skill：
```yaml
# playbooks/diagnose-profit-erosion.yaml
phases:
  - phase: trace_root_cause
    skills:
      - type: causal_chain
        chainId: cc-capital-03
        role: 成本驱动型利润衰减诊断
```

---

## 5.6 补充评审确认

以下为研究方案中针对第五章的设计边界确认：

| # | 设计边界 | 本文档章节 | 状态 |
|---|---------|---------|------|
| 1 | 核心因果链清单(20-25条)，每条YAML定义 | 5.1 (22条) | 已覆盖 |
| 2 | 蛙呢宝贝案例关键因果链覆盖（成本型利润衰减/客户流失负向/人才流失/定价传导/增长投资） | 5.1 cc-capital-03, cc-client-02, cc-talent-02, cc-client-04, cc-capital-04 | 已覆盖 |
| 3 | Trace/Simulate/Explain三层API | 5.3 | 已覆盖：函数签名+输入输出+伪代码 |
| 4 | 因果链加载器（对标sentinel-loader.ts） | 5.4 | 已覆盖：CausalChainManifest, loadCausalChains(), CausalChainRegistry, 缓存机制 |
| 5 | 因果链依赖关系图（哪些链共享边、哪些链可以串联） | 5.2 | 已覆盖：共享边表 + 链间串联Mermaid图 |
| 6 | YAML命名风格与Playbook YAML一致 | 5.1 / 5.4.2 | 已覆盖：字段命名(displayName/domain/experts/sentinels)对标Playbook和SentinelManifest |

---

> **版本历史**：v1.0 — 2026-07-14 — 初始版本。22条因果链 + 三层API规范（Trace/Simulate/Explain）+ 因果链加载器规格（对标sentinel-loader.ts）+ 依赖关系图 + 蛙呢宝贝覆盖率。
