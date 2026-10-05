
### E-01: ACTIVE_SCANNING

**所属断裂点**：获取
**所属语义分组**：获取边
**因果方向**：企业主动扫描行为 → 外部机会/威胁信号的捕获量（扫描越主动，信号捕获越充分）

**transfer_function**：
```
S_capture = scan_frequency * scan_breadth * signal_sensitivity
signal_sensitivity = 1 / (1 + noise_ratio)
noise_ratio = false_positives / total_signals
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| scan_frequency | 主动扫描行为的频率 | 次/周期 | 1-3 | Capability.Person/Team.activityCount（代理） |
| scan_breadth | 扫描覆盖的市场/技术/政策维度数 | 维度数 | 3-7 | Capability.Team（capability数量代理） |
| signal_sensitivity | 信号敏感度，噪声比越低越敏感 | 0-1 | >0.6 | 计算得出 |
| noise_ratio | 噪声比 = 误报/总信号 | ratio | <0.4 | Event.Event节点数量比（需GA标记误报） |

**消费的SOG-Core边**：DEPENDS_ON（Team → Capability），TRIGGERS（Event → external scan trigger）
**消费的节点属性**：Capability.category='domain' + proficiencyLevel, Event.timestamp序列
**产出的哨兵信号**：customer-demand-shift, opportunity-window, niche-squeeze, csf-profile
**消费的专家**：战略专家（权限内E-01），营销专家（间接消费扫描中的客户需求信号）
**ME概念映射**：AdversarialFrame（竞品对抗框架通过E-01 ACTIVE_SCANNING激活——ME第一章1.4表）
**关联的因果链**：CC-SCAN-01（扫描→机会窗口→市场份额增长）
**硬度**：soft
  **参数覆盖率**：2/4 (50%) — scan_frequency和scan_breadth有代理指标；signal_sensitivity和noise_ratio依赖GA标记
  **客户A验证**：未验证（数据不足——客户A无主动扫描行为记录）
  **缺失数据**：需GA配置扫描行为追踪（团队周报/战略会议记录）。无时间序列扫描数据时，scan_frequency=1, scan_breadth=3作为默认值
**前置边**：无（输入边——从外部环境直接获取）
**后置边**：E-02 PASSIVE_SIGNAL（扫描覆盖广度影响被动信号收集效率），E-03 EXTERNAL_ECHO（扫描信号进入外部回响过滤），E-04 PERCEPTION_LEARNING（扫描→感知→学习）

---

### E-02: PASSIVE_SIGNAL

**所属断裂点**：获取
**所属语义分组**：获取边
**因果方向**：企业被动接收外部信号 → 信号累积形成信息池（被动信号越多，信息池越丰富，但噪声也越大）

**transfer_function**：
```
I_pool = sum(passive_signal_i * relevance_weight_i) / (1 + alpha * T)
relevance_weight_i = 1 - decay_rate ^ age_i
```
其中alpha为衰减系数，T为自上次主动处理以来的时间间隔。

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| passive_signal_i | 第i个被动接收的信号强度 | 0-1 | 0-1 | Event.Event节点（外部事件） |
| relevance_weight_i | 第i个信号的相关性权重（时间衰减） | 0-1 | 0-1 | 计算得出 |
| decay_rate | 衰减速率 | /周期 | 0.05-0.20 | KnowledgeChunk知识片段老化标记 |
| alpha | 信息池总体衰减系数 | /周期 | 0.01-0.10 | 从E-01 signal_sensitivity导出 |
| T | 自上次主动处理以来的周数 | 周 | 0-4 | Event.timestamp差值 |

**消费的SOG-Core边**：TRIGGERS（外部Event → 企业内部感知），CORRESPONDS_TO（信号 → KnowledgeChunk）
**消费的节点属性**：Event.timestamp, Event.eventType, KnowledgeChunk.content
**产出的哨兵信号**：customer-demand-shift（被动信号中客户需求变化），survival-margin（被动信号中的合规/风险信号）
**消费的专家**：战略专家（外部信号→竞争判断），商业模式专家（客户需求变化信号）
**关联的因果链**：CC-PASSIVE-01（被动信号积累→需求变化检测→产品调整）
**硬度**：soft
  **参数覆盖率**：3/5 (60%) — passive_signal_i、relevance_weight_i、T可计算；decay_rate和alpha需行业校准
  **客户A验证**：未验证（需外部事件标注数据）
  **缺失数据**：需GA配置外部事件源（行业新闻/政策变更/竞品动态RSS）。decay_rate默认0.10
**前置边**：E-01 ACTIVE_SCANNING（扫描广度影响信号收集覆盖面）
**后置边**：E-35 DATA_FEEDBACK（被动信号进入数据反馈循环），E-03 EXTERNAL_ECHO（信号积累→外部回响评估）

---


### E-03: EXTERNAL_ECHO

**所属断裂点**：获取（跨环节，横切获取-转化-回流）
**所属语义分组**：获取边
**因果方向**：外部环境变化 → 企业业绩受外部因素影响的程度（环境红利/逆风影响收入）

**transfer_function**：
```
env_rent = sum(w_j * external_factor_j) / internal_effort
external_factor_j = (market_growth_j - baseline_growth_j) / baseline_growth_j
```
其中w_j为第j个外部因素的影响权重，internal_effort为企业自身努力水平。

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| market_growth_j | 第j个相关市场的增长率 | % | 随行业 | ExternalBaseline节点（需GA配置） |
| baseline_growth_j | 第j个市场的基准增长率 | % | 随行业 | 同上 |
| w_j | 第j个外部因素的权重 | 0-1 | 总和=1 | Risk.riskType + severity（代理） |
| internal_effort | 企业内部努力水平代理 | 0-1 | 0.3-0.9 | E-23 efficiency_rate |
| competitor_aggressiveness | 竞品激进程度 | 0-1 | 0-1 | E-33 MARKET_COMPETITION.competitor_aggressiveness |

**消费的SOG-Core边**：AFFECTS（外部Event → 内部Financial），DEPENDS_ON（Financial → ExternalBaseline）
**消费的节点属性**：Event.timestamp, Financial.amount, Risk.severity
**产出的哨兵信号**：environment-rent-dependency, opportunity-window
**消费的专家**：战略专家（环境红利判断→竞争位势），财务专家（外部因素对收入的归因分析）
**ME概念映射**：通过E-33 MARKET_COMPETITION的HHI间接映射市场结构对外部回响的影响
**关联的因果链**：CC-ECHO-01（外部增长→env_rent→收入增长是否可归因于企业自身）
**硬度**：soft
  **参数覆盖率**：3/5 (60%) — market_growth、baseline_growth、competitor_aggressiveness可获取；w_j和internal_effort需估计
  **客户A验证**：部分验证 — 客户A2023年利润下滑，env_rent检测到母婴市场整体下行（market_growth≈-8%），env_rent=负值，说明外部环境逆风是利润下滑的部分原因
  **缺失数据**：w_j权重需GA基于行业知识设定；internal_effort使用E-23 efficiency_rate代理
**前置边**：E-01 ACTIVE_SCANNING（扫描提供外部因素列表），E-33 MARKET_COMPETITION（市场竞争数据）
**后置边**：E-40 REPUTATION_AMPLIFICATION（外部回响通过声誉放大或缓冲），E-42 CROSS_DOMAIN_SPILLOVER（跨域溢出）

---

### E-04: PERCEPTION_LEARNING

**所属断裂点**：获取
**所属语义分组**：获取边
**因果方向**：企业感知外部信息 → 感知精度 → 学习效率（感知越精准，学习越快）

**transfer_function**：
```
PL = perception_accuracy * learning_rate
perception_accuracy = 1 - |internal_model - external_reality| / max(|internal_model|, |external_reality|)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| perception_accuracy | 内部认知模型与外部现实的差距 | 0-1 | >0.7 | 计算得出（对比E-01 signal与E-03 actual） |
| learning_rate | 从感知到知识更新的速率 | 0-1 | 0.05-0.30 | E-19 ORG_LEARNING.learning_rate |
| internal_model | 企业内部对市场的认知模型参数 | 向量 | — | KnowledgeChunk知识片段集合 |
| external_reality | 外部真实数据 | 向量 | — | E-01 + E-02 + E-03 输出组合 |

**消费的SOG-Core边**：CORRESPONDS_TO（KnowledgeChunk → ExternalBaseline），CONSUMES（学习过程消耗知识片段）
**消费的节点属性**：KnowledgeChunk.content, Capability.proficiencyLevel
**产出的哨兵信号**：niche-breadth（感知精度影响利基宽度判断），ai-ecosystem-fit（AI生态适配中的感知学习）
**消费的专家**：技术专家（感知学习→知识积累→技术能力），知识专家（知识片段与外部现实的对应关系）
**关联的因果链**：CC-LEARN-01（感知→学习→知识积累→创新）
**硬度**：heuristic
  **参数覆盖率**：1/4 (25%) — learning_rate可从E-19消费；perception_accuracy/internal_model/external_reality均为向量计算，无客户A数据
  **客户A验证**：未验证（缺少企业认知模型与外部现实的对比数据）
  **缺失数据**：需GA定义internal_model的维度（如市场规模预估、竞品能力评估、客户需求假设），并周期性收集外部数据形成external_reality对照。当前无法定量计算
**前置边**：E-01 ACTIVE_SCANNING, E-02 PASSIVE_SIGNAL, E-03 EXTERNAL_ECHO
**后置边**：E-19 ORG_LEARNING（感知精度直接输入组织学习）

---


### E-05: CAPITAL_ACQUISITION

**所属断裂点**：获取
**所属语义分组**：获取边
**因果方向**：企业获取外部资本的能力 → 可用于配置和转化的资本总量

**transfer_function**：
```
C_available = equity_raised + debt_raised + retained_earnings
cash_runway_months = C_available / monthly_burn
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| equity_raised | 已募股权资本 | 万元 | >0 | Financial.amount（financialType='revenue'，外部投资） |
| debt_raised | 已借债权资本 | 万元 | >0 | Financial.amount（financialType='cost'，外部借贷） |
| retained_earnings | 留存收益 | 万元 | 可正可负 | E-37 PROFIT_REINVEST.retention_ratio * 利润 |
| monthly_burn | 月烧钱率 | 万元/月 | >0 | Financial.amount时间序列差值 |
| cash_runway_months | 现金流跑道（月） | 月 | >12 | 计算得出 |

**消费的SOG-Core边**：PROVIDES（融资方 → 企业内部Financial），DEPENDS_ON（Financial → 外部资本来源）
**消费的节点属性**：Financial.amount（financialType='revenue'/'cost'），Financial节点时间序列
**产出的哨兵信号**：financing-constraint, cash-runway, capital-health（合并哨兵）
**消费的专家**：财务专家（核心42边权限——E-05为财务专家核心输入）
**ME概念映射**：capital-health哨兵消费E-05的debt_equity_ratio和cash_runway_months
**关联的因果链**：CC-CAPITAL-01（资本获取→配置→转化→回流→再获取）
**硬度**：hard
  **参数覆盖率**：4/5 (80%) — equity_raised、debt_raised、retained_earnings、monthly_burn均可从Financial节点获取
  **客户A验证**：已验证 — 客户Acash_runway=18个月（equity_raised=200万, monthly_burn=11万），预测与GA陈述一致
**前置边**：E-37 PROFIT_REINVEST（留存收益来自利润再投资）
**后置边**：E-13 CAPITAL_ALLOCATION（获取的资本进入配置阶段），E-06 FINANCING_MIX（资本结构分析）

---

### E-06: FINANCING_MIX

**所属断裂点**：获取
**所属语义分组**：获取边
**因果方向**：资本来源结构（股权vs债权比例） → 资本成本和财务灵活性

**transfer_function**：
```
D_E_ratio = debt_raised / equity_raised          （当equity=0时 → 无限大，触发degraded）
WACC = (E/V)*Ke + (D/V)*Kd*(1-t)
其中 Ke = Rf + beta*(Rm - Rf), Kd = 借贷利率, t = 税率, V = E + D
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| debt_raised | 债权资本 | 万元 | — | E-05 CAPITAL_ACQUISITION.debt_raised |
| equity_raised | 股权资本 | 万元 | — | E-05 CAPITAL_ACQUISITION.equity_raised |
| debt_equity_ratio | 债权股权比 | ratio | 0.5-2.0 | 计算得出 |
| WACC | 加权平均资本成本 | % | 8-15% | 计算得出（需GA设定Rf/beta/Rm/t） |
| Ke | 股权成本 | % | 10-25% | 计算得出（需GA设定beta） |
| Kd | 债权成本（借贷利率） | % | 3-8% | Financial节点（需GA标注借贷利率） |
| tax_rate | 企业所得税率 | % | 随地区 | Compliance节点（需GA配置） |

**消费的SOG-Core边**：CONSUMES（债权 → Financial成本），DEPENDS_ON（Financial融资结构 → 外部市场条件）
**消费的节点属性**：Financial.amount, Compliance节点
**产出的哨兵信号**：financing-constraint（债权比过高→融资受限），capital-health（合并哨兵消费WACC）
**消费的专家**：财务专家（权限内E-06——核心财务分析输入）
**关联的因果链**：CC-FINMIX-01（融资结构→资本成本→投资决策→增长路径选择）
**硬度**：hard
  **参数覆盖率**：6/7 (86%) — debt_raised/equity_raised/debt_equity_ratio/WACC/Ke/Kd均可计算（需GA设定Rf/beta/Rm/t）
  **客户A验证**：已验证 — 客户A纯股权融资，D/E=0，WACC=Ke≈15%（beta=1.2估计），无债权压力
  **缺失数据**：Rf（无风险利率）、beta（行业beta）、Rm（市场收益率）需GA在ExternalBaseline节点中配置。默认Rf=3%, beta=1.0, Rm=10%
**前置边**：E-05 CAPITAL_ACQUISITION（提供debt_raised和equity_raised）
**后置边**：E-13 CAPITAL_ALLOCATION（WACC影响投资决策和资本配置效率）

---

### E-07: TALENT_ACQUISITION

**所属断裂点**：获取
**所属语义分组**：获取边
**因果方向**：企业吸引人才的能力 → 人才进入组织的速率和质量

**transfer_function**：
```
T_inflow = hiring_efficiency * employer_attractiveness * market_talent_supply
hiring_efficiency = hires_completed / open_positions_per_period
employer_attractiveness = f(brand_strength, compensation_competitiveness, culture_health)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| hiring_efficiency | 招聘效率 | 0-1 | >0.7 | Person节点创建速率（代理——需AgentObserver数据） |
| employer_attractiveness | 雇主吸引力 | 0-1 | >0.5 | E-25 BRAND_CONSTRUCTION.brand_strength（代理），E-38 compensation_competitiveness |
| market_talent_supply | 外部人才市场供给量 | 0-1 | 0.3-0.8 | ExternalBaseline节点（需GA配置行业人才供给指数） |
| hires_completed | 已完成招聘人数 | 人数 | — | Person节点计数（按创建时间窗口） |
| open_positions | 开放岗位数 | 人数 | — | Team.teamType='permanent'节点（需GA标注编制数） |

**消费的SOG-Core边**：BELONGS_TO（Person → Team），DEPENDS_ON（Team → Capability需求）
**消费的节点属性**：Person.name, Team.teamType, Capability.category
**产出的哨兵信号**：talent-density（人才流入→人才密度变化），key-person-risk（关键岗位招聘成功率）
**消费的专家**：组织专家（权限内E-07——人才获取是组织诊断输入）
**关联的因果链**：CC-TALENT-01（人才获取→人力配置→执行效率→增长）
**硬度**：soft
  **参数覆盖率**：3/5 (60%) — hires_completed和open_positions可从Person/Team节点计数；market_talent_supply需ExternalBaseline
  **客户A验证**：未验证（客户A人才数据不足）
  **缺失数据**：需GA配置Team节点编制数（open_positions）、ExternalBaseline行业人才供给指数、Person节点入职日期属性。当前使用Person节点创建时间作为入职代理
**前置边**：E-25 BRAND_CONSTRUCTION（品牌影响雇主吸引力），E-38 TALENT_RETENTION（人才留存影响吸引力口碑）
**后置边**：E-15 HUMAN_DEPLOYMENT（获取的人才进入人力配置）

---


### E-08: RESOURCE_ACQUISITION

**所属断裂点**：获取
**所属语义分组**：获取边
**因果方向**：企业获取非人力非资本资源（供应商关系、技术许可、物理资产）的能力 → 可用资源总量

**transfer_function**：
```
R_available = sum(source_i * reliability_i)
resource_gap = R_required - R_available
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| source_i | 第i个资源来源的供给量 | 资源单位 | — | Tool节点（需GA标注工具/资源类型） |
| reliability_i | 第i个来源的可靠性 | 0-1 | >0.8 | E-34 PROCUREMENT_POWER.supplier_reliability |
| R_required | 业务运转所需资源量 | 资源单位 | — | E-23 OPERATIONAL_EXECUTION推导（从产出反推） |
| resource_gap | 资源缺口 | 资源单位 | 越小越好 | 计算得出 |

**消费的SOG-Core边**：PROVIDES（供应商 → Tool/资源），DEPENDS_ON（企业内部Tool → 外部供应商）
**消费的节点属性**：Tool.name, Tool.category, Risk.riskType='supplier'
**产出的哨兵信号**：make-or-buy（资源缺口→自制vs外购决策），resource-misallocation（资源获取vs配置效率对比）
**消费的专家**：商业模式专家（间接——资源获取影响运营模式选择），技术专家（技术资源获取→技术基础设施）
**关联的因果链**：CC-RESOURCE-01（资源获取→资源缺口→运营瓶颈→交付延迟）
**硬度**：soft
  **参数覆盖率**：2/4 (50%) — R_required可从E-23推导；reliability_i从E-34获取；source_i需GA标注资源清单
  **客户A验证**：未验证（缺资源清单数据）
  **缺失数据**：需GA配置Tool节点分类（供应商/自有/租赁）和可靠性评分。当前使用Risk.riskType='supplier'的节点作为可靠性代理
**前置边**：E-34 PROCUREMENT_POWER（采购议价能力影响资源获取成本）
**后置边**：E-13 CAPITAL_ALLOCATION（资源进入配置——分配预算到不同资源来源）

---

### E-09: DATA_ACQUISITION

**所属断裂点**：获取
**所属语义分组**：获取边
**因果方向**：企业数据采集能力 → 可用于诊断和决策的数据完整度和新鲜度

**transfer_function**：
```
D_quality = completeness * freshness * accuracy
completeness = data_points_available / data_points_required
freshness = 1 / (1 + avg_data_age_days / 30)
accuracy = 1 - error_rate
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| completeness | 数据完整度 | 0-1 | >0.7 | KnowledgeChunk和Document节点数量/预期数量 |
| freshness | 数据新鲜度 | 0-1 | >0.6 | Document节点（需docType='report'含timestamp） |
| accuracy | 数据准确度 | 0-1 | >0.9 | 计算得出（需GA标记数据错误率） |
| avg_data_age_days | 数据平均年龄 | 天 | <90 | Document.timestamp与当前时间差值 |
| error_rate | 数据错误率 | 0-1 | <0.1 | 需GA手动标记 |

**消费的SOG-Core边**：CORRESPONDS_TO（Document → KnowledgeChunk），CONSUMES（Process → Document数据读取）
**消费的节点属性**：Document.timestamp, Document.docType, KnowledgeChunk.content
**产出的哨兵信号**：data-health, api-coverage
**消费的专家**：技术专家（数据健康度→技术基础设施质量），知识专家（数据→知识片段提取）
**ME概念映射**：数据质量是所有ME compute函数的公理输入——无数据则无定量分析
**关联的因果链**：CC-DATA-01（数据质量→诊断精度→决策质量→执行效果）
**硬度**：hard
  **参数覆盖率**：4/5 (80%) — completeness可统计；freshness可计算avg_data_age_days；accuracy需GA标记（默认0.95）
  **客户A验证**：已验证 — 客户A数据质量评估：completeness≈0.45（财务报表为主，无组织/品牌结构化数据），freshness≈0.75（月报），accuracy≈0.90
  **缺失数据**：error_rate需GA在数据导入时标记已知数据问题。默认0.05
**前置边**：无（直接消费Document节点和外部数据源）
**后置边**：E-35 DATA_FEEDBACK（数据→反馈→学习闭环）

---


---
## 二、配置边（E-10~E-23）—— 资源如何被分配和决策

断裂点：配置（Allocate）。逻辑：进入循环的资源被分配到不同活动，决策权、人力、信息、激励、规则、学习、知识、信任、惯例共同决定分配效率。

**注意**：E-10 DECISION_ALLOCATION、E-11 TRUST_CONSTRUCTION、E-12 POWER_DISTRIBUTION 三条边在原研究方案中定义为配置边的组织基础设施，但在哨兵和ME文档中未作为独立消费源出现——它们的参数通过E-14 DECISION_POWER、E-16 INFO_TRANSMISSION、E-17 INCENTIVE_ALIGNMENT等下游边间接被消费。保留完整定义以保证因果链完整性。

---

### E-10: DECISION_ALLOCATION

**所属断裂点**：配置
**所属语义分组**：配置边
**因果方向**：决策机制设计 → 决策质量 → 资源配置效率（决策越分散但仍有协调，配置效率越高）

**transfer_function**：
```
DA = decision_quality * allocation_efficiency
decision_quality = 1 / (1 + decision_delay_days / 7)
allocation_efficiency = productive_allocation / total_allocation
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| decision_quality | 决策质量代理（决策延迟越短越好） | 0-1 | >0.7 | Process节点（processType='approval'）的时间戳差值 |
| allocation_efficiency | 配置效率 = 生产性配置/总配置 | 0-1 | >0.6 | E-13 CAPITAL_ALLOCATION.allocation_ratio（代理） |
| decision_delay_days | 决策延迟天数 | 天 | <7 | Process.approval类型的timestamp差值 |
| productive_allocation | 生产性（价值创造）资源配置 | 万元 | — | Financial节点（需GA标注是否生产性） |
| total_allocation | 总资源配置 | 万元 | — | E-13 CAPITAL_ALLOCATION总分配额 |

**消费的SOG-Core边**：OWNS（Team → Process决策权），TRIGGERS（Process.approval → Financial成本）
**消费的节点属性**：Process.processType='approval', Process.name, Financial.amount
**产出的哨兵信号**：无直接哨兵消费——决策质量通过E-13 CAPITAL_ALLOCATION、E-14 DECISION_POWER间接进入哨兵
**消费的专家**：组织专家（间接——通过E-14 DECISION_POWER进入组织诊断）
**关联的因果链**：CC-DEC-01（决策机制→决策质量→配置效率→转化效率→增长）
**硬度**：soft
  **参数覆盖率**：3/5 (60%) — decision_delay_days可从Process节点计算；allocation_efficiency从E-13消费；productive_allocation需GA标注
  **客户A验证**：未验证
  **缺失数据**：需GA在Financial节点上标注cost分类（生产性/非生产性/行政管理）。Process.approval节点需含发起时间和批准时间两个timestamp
**前置边**：E-14 DECISION_POWER（集中度影响决策延迟）
**后置边**：E-13 CAPITAL_ALLOCATION（决策→资本配置）

---

### E-11: TRUST_CONSTRUCTION

**所属断裂点**：配置
**所属语义分组**：配置边
**因果方向**：组织内部信任建设 → 协作效率 → 交易成本降低

**transfer_function**：
```
trust_level = (1 - internal_transaction_cost_ratio) * collaboration_frequency
internal_transaction_cost_ratio = internal_coordination_cost / total_operating_cost
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| internal_transaction_cost_ratio | 内部交易成本占总运营成本的比例 | 0-1 | <0.3 | E-28 CROSS_FUNCTIONAL_SYNERGY.internal_coordination_cost |
| collaboration_frequency | 跨部门/跨团队协作频率 | 次/周期 | — | INTERACTS_WITH边计数（Team→Team, Person→Person） |
| trust_level | 信任水平 | 0-1 | >0.5 | 计算得出 |

**消费的SOG-Core边**：INTERACTS_WITH（Person/Team间交互），BELONGS_TO（Person → Team归属）
**消费的节点属性**：INTERACTS_WITH.channel + weight, Team.name
**产出的哨兵信号**：internal-transaction-cost（内部交易成本哨兵直接消费E-28，E-11作为上游）
**消费的专家**：组织专家（间接——信任水平通过E-16 INFO_TRANSMISSION影响信息质量）
**关联的因果链**：CC-TRUST-01（信任→协作→协同→运营效率）
**硬度**：heuristic
  **参数覆盖率**：2/3 (67%) — collaboration_frequency可从INTERACTS_WITH边计数；internal_transaction_cost_ratio从E-28获取
  **客户A验证**：未验证（缺组织交互数据）
  **缺失数据**：需AgentObserver采集INTERACTS_WITH边（Person间消息/会议/邮件交互）。当前交互数据几乎为零——无法计算有效trust_level
**前置边**：E-14 DECISION_POWER（权力集中度影响信任水平）
**后置边**：E-16 INFO_TRANSMISSION（信任→信息传递真实性），E-28 CROSS_FUNCTIONAL_SYNERGY（信任→跨职能协同）

---

### E-12: POWER_DISTRIBUTION

**所属断裂点**：配置
**所属语义分组**：配置边
**因果方向**：权力在组织内的分布模式 → 权力离散度 → 决策参与度

**transfer_function**：
```
power_gini = Gini(power_distribution_vector)
power_distribution_vector = [person_i_decision_count / total_decisions]
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源节点属性路径 |
|------|------|------|---------|----------------|
| power_gini | 权力基尼系数 | 0-1 | <0.6 | 计算得出（从E-14 DECISION_POWER派生） |
| person_i_decision_count | 第i个人的决策次数 | 次数 | — | Process.approval的OWNS边计数（按Person分组） |
| total_decisions | 组织总决策次数 | 次数 | — | Process.approval总计数 |

**消费的SOG-Core边**：OWNS（Person → Process决策权），BELONGS_TO（Person → Team）
**消费的节点属性**：Process.processType='approval', Person.name
**产出的哨兵信号**：无直接哨兵——通过E-14 DECISION_POWER进入power-rigidity和network-power哨兵
**消费的专家**：组织专家（间接——通过E-14进入权力分析）
**关联的因果链**：CC-POWER-01（权力分布→决策集中度→信息失真→错配风险）
**硬度**：soft
  **参数覆盖率**：2/3 (67%) — person_i_decision_count和total_decisions可从Process/OWNS统计
  **客户A验证**：未验证（缺Process.approval数据）
  **缺失数据**：需AgentObserver采集Process.approval节点的OWNS边，标注ownershipType以区分决策权归属
**前置边**：无（组织基本结构——权力分布从组织结构导出）
**后置边**：E-14 DECISION_POWER, E-17 INCENTIVE_ALIGNMENT（权力分布→激励设计）

---


### E-13: CAPITAL_ALLOCATION

**中文名称**：资本配置效率
**所属断裂点**：配置
**所属语义分组**：配置边
**因果方向**：资本进入企业 → 预算决策 → 活动ROI → 整体资本效率（分配越精准，资本效率越高）

**transfer_function**：
```
allocation_efficiency = Sum(budget_i * roi_i) / total_budget
reallocation_frequency = 再分配次数 / 周期
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| allocation_efficiency | 资本配置效率 | 0-1 | >0.6 | 计算得出：∑(预算 × ROI) / 总预算 |
| budget_i | 第i个活动的预算分配额 | 万元 | — | FINANCIAL.amount(financialType='cost') |
| roi_i | 第i个活动的ROI | ratio | >1.0 | FINANCIAL.amount(financialType='revenue') / FINANCIAL.amount(financialType='cost') |
| total_budget | 总预算额 | 万元 | — | FINANCIAL.amount(financialType='cost')求和 |
| reallocation_frequency | 再分配频率 | 次/周期 | 1-4 | PROCESS.processType='approval'频次 |

**消费的SOG-Core边**：DEPENDS_ON（FINANCIAL → 预算分配），TRIGGERS（PROCESS.approval → FINANCIAL成本）
**消费的节点属性**：FINANCIAL.amount(financialType='cost'/'revenue')，CAPABILITY.proficiencyLevel
**产出的哨兵信号**：capital-health（allocation_efficiency < 0.5 → warning），resource-misallocation（项目ROI方差过大）
**关联因果链**：CC-ALLOC-01（资本获取→资本配置→转化效率→增长）
**硬度**：hard
**参数覆盖率**：4/5 (80%) — budget_i、roi_i、total_budget、reallocation_frequency均可从FINANCIAL和PROCESS节点获取；需GA标注成本的生产性/非生产性分类
**客户A验证**：未验证（缺活动级ROI标注数据）
**缺失数据**：需GA在FINANCIAL节点上标注cost分类（生产性/非生产性/行政管理），并关联到对应的PROCESS活动。当前无活动级成本→ROI映射
**前置边**：E-05 CAPITAL_ACQUISITION（提供可分配资本），E-06 FINANCING_MIX（WACC影响投资决策），E-10 DECISION_ALLOCATION（决策机制→资本配置）
**后置边**：E-23 OPERATIONAL_EXECUTION（资本配置→运营执行），E-24 INNOVATION（资本配置→创新投入），E-37 PROFIT_REINVEST（配置效率影响再投资能力）

---
### E-14: DECISION_POWER

**中文名称**：决策权力集中度
**所属断裂点**：配置
**所属语义分组**：配置边
**因果方向**：权力结构 → 决策速度和质量 → 资源配置准确性（权力集中度存在最优区间，非单调）

**transfer_function**：
```
power_gini = Gini(power_distribution_vector)
decision_quality = 1 / (1 + decision_latency_days / 7) * decision_maker_expertise
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| power_gini | 权力基尼系数（决策权分布的集中/分散程度） | 0-1 | 0.3-0.6 | 计算得出：从OWNS边统计（Person→Process.approval） |
| decision_quality | 决策质量代理 | 0-1 | >0.7 | 计算得出：1/(1+延迟天数/7) × 决策者专业度 |
| decision_latency_days | 决策延迟天数 | 天 | <7 | PROCESS.approval节点timestamp差值 |
| decision_maker_expertise | 决策者专业度代理 | 0-1 | >0.6 | CAPABILITY.proficiencyLevel（决策者对应能力） |

**消费的SOG-Core边**：OWNS（Person → Process决策权），BELONGS_TO（Person → Team）
**消费的节点属性**：PERSON.OWNS边计数，PROCESS.processType='approval'，TEAM.teamType
**产出的哨兵信号**：power-rigidity（Gini > 0.7 且决策延迟 > 阈值 → critical），network-power（网络权力位置分析）
**关联因果链**：CC-POWER-01（权力分布→决策集中度→信息失真→错配风险）
**硬度**：soft
**参数覆盖率**：3/4 (75%) — power_gini、decision_quality、decision_latency_days可计算；decision_maker_expertise需从Capability代理
**客户A验证**：未验证（缺PROCESS.approval和OWNS边数据）
**缺失数据**：需AgentObserver采集PROCESS.approval节点的OWNS边，标注ownershipType区分决策权归属。当前Process数据几乎为零
**前置边**：E-12 POWER_DISTRIBUTION（权力分布→决策集中度）
**后置边**：E-10 DECISION_ALLOCATION（决策权力→决策分配），E-17 INCENTIVE_ALIGNMENT（集中度影响激励设计）

---

### E-15: HUMAN_DEPLOYMENT

**中文名称**：人力配置效率
**所属断裂点**：配置
**所属语义分组**：配置边
**因果方向**：人才进入企业 → 分配到具体岗位 → 人岗匹配度 → 产出效率（匹配越精准，产出效率越高）

**transfer_function**：
```
deployment_score = skill_match * capacity_utilization
skill_match = cosine_similarity(person_skill_vector, task_requirement_vector)
capacity_utilization = assigned_tasks / person_capacity_max
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| deployment_score | 人力部署综合得分 | 0-1 | >0.7 | 计算得出：技能匹配 × 产能利用率 |
| skill_match | 人岗技能匹配度 | 0-1 | >0.7 | 计算得出：技能向量与需求向量的余弦相似度 |
| capacity_utilization | 人员产能利用率 | 0-1 | 0.6-0.9 | PERSON节点任务计数 / CAPABILITY.proficiencyLevel |
| person_skill_vector | 个人技能向量 | 向量 | — | PERSON节点skill标签（需GA配置） |
| task_requirement_vector | 任务需求向量 | 向量 | — | CAPABILITY.category + proficiencyLevel |

**消费的SOG-Core边**：BELONGS_TO（Person → Team），DEPENDS_ON（Capability需求 → Person技能）
**消费的节点属性**：PERSON.name + skill标签，CAPABILITY.category + proficiencyLevel，TEAM.teamType
**产出的哨兵信号**：talent-density（技能匹配 < 阈值），key-person-risk（backup_ratio < 1.0）
**关联因果链**：CC-DEPLOY-01（人才获取→人力配置→执行效率→增长）
**硬度**：soft
**参数覆盖率**：3/5 (60%) — capacity_utilization可从PERSON/CAPABILITY节点计算；skill_match需GA配置技能标签；task_requirement_vector需从PROCESS推导
**客户A验证**：未验证（缺PERSON技能标签数据）
**缺失数据**：需GA在PERSON节点上添加skill标签（JSON数组），CAPABILITY节点标注task_requirement向量。当前使用proficiencyLevel作为capacity_utilization代理
**前置边**：E-07 TALENT_ACQUISITION（获取的人才进入人力配置）
**后置边**：E-23 OPERATIONAL_EXECUTION（人力配置→运营执行效率），E-38 TALENT_RETENTION（匹配度影响留存率）

---
### E-16: INFO_TRANSMISSION

**中文名称**：信息传递保真度
**所属断裂点**：配置
**所属语义分组**：配置边
**因果方向**：信息源头 → 传递层级 → 信号保真度 → 决策质量（层级越多，失真越严重）

**transfer_function**：
```
signal_fidelity = (1 - filtering_loss) ^ org_layers * channel_quality
channel_quality = f(communication_channel_density, trust_level)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| signal_fidelity | 信号保真度（信息从源头到决策者的保真程度） | 0-1 | >0.7 | 计算得出：(1-过滤损耗)^层级数 × 渠道质量 |
| filtering_loss | 每层信息过滤损耗率 | 0-1 | 0.05-0.20 | 需GA基于组织层级设定 |
| org_layers | 组织层级数 | 层 | 2-5 | TEAM节点层级深度（需GA配置） |
| channel_quality | 通信渠道质量 | 0-1 | >0.6 | INTERACTS_WITH边聚合（channel + weight） |

**消费的SOG-Core边**：INTERACTS_WITH（AGENT/Person间信息传递），COMMUNICATES（信息流建模）
**消费的节点属性**：AGENT.agentType，EVENT.eventType + timestamp，INTERACTS_WITH.channel + weight
**产出的哨兵信号**：info-distortion（signal_fidelity < 阈值）
**关联因果链**：CC-INFO-01（信息传递→信号保真→决策质量→所有依赖信息的边）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — channel_quality可从INTERACTS_WITH聚合；filtering_loss和org_layers需GA配置；signal_fidelity计算得出
**客户A验证**：未验证（缺AGENT和INTERACTS_WITH数据）
**缺失数据**：需AgentObserver采集INTERACTS_WITH边（AGENT/Person间消息传递），GA标注组织层级深度。默认filtering_loss=0.10, org_layers=3
**前置边**：E-09 DATA_ACQUISITION（数据获取→信息源头），E-11 TRUST_CONSTRUCTION（信任→渠道质量）
**后置边**：E-14 DECISION_POWER（信息失真→决策质量），E-17 INCENTIVE_ALIGNMENT（信息失真→KPI扭曲）

---

### E-17: INCENTIVE_ALIGNMENT

**中文名称**：激励对齐度
**所属断裂点**：配置
**所属语义分组**：配置边
**因果方向**：KPI/OKR/薪酬体系 → 驱动人员行为 → 实际行为与战略目标的偏差（激励越对齐，行为越一致）

**transfer_function**：
```
incentive_distortion = (1 - kpi_strategic_alignment) * (1 + kpi_conflict_count/10) * short_term_bias
kpi_strategic_alignment = semantic_similarity(kpi_vector, strategy_vector)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| incentive_distortion | 激励扭曲度（0=完美对齐，1=严重扭曲） | 0-1 | <0.3 | 计算得出：战略不对齐 × KPI冲突 × 短期偏差 |
| kpi_strategic_alignment | KPI与战略方向的语义对齐度 | 0-1 | >0.7 | 计算得出：GOAL.description语义向量与战略GOAL的cosine_similarity |
| kpi_conflict_count | KPI之间存在冲突的计数 | 计数 | 0 | GOAL节点间ALIGNS_WITH冲突计数 |
| short_term_bias | 短期KPI压制长期KPI的偏差系数 | 0-1 | <0.3 | GOAL.goalType='okr'中短期/长期目标比例 |

**消费的SOG-Core边**：ALIGNS_WITH（GOAL间对齐关系），DEPENDS_ON（GOAL → Capability需求）
**消费的节点属性**：GOAL.goalType + description + progress，CAPABILITY.proficiencyLevel
**产出的哨兵信号**：incentive-alignment（distortion > 0.7 → warning），agency-cost（多信号同时 > 0.7 → critical）
**关联因果链**：CC-INCENT-01（激励→行为→组织产出→与战略目标的偏差）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — kpi_conflict_count可直接从GOAL统计；kpi_strategic_alignment和short_term_bias需语义分析计算
**客户A验证**：未验证（缺GOAL节点OKR数据）
**缺失数据**：需GA在GOAL节点上标注goalType='okr'、时间维度（短期/长期），并配置GOAL间的ALIGNS_WITH边。默认kpi_strategic_alignment=0.6, short_term_bias=0.3
**前置边**：E-14 DECISION_POWER（权力集中度影响KPI定义），E-16 INFO_TRANSMISSION（信息失真→KPI扭曲）
**后置边**：E-23 OPERATIONAL_EXECUTION（激励扭曲→执行方向偏离），E-38 TALENT_RETENTION（激励→人才留存意愿）

---

### E-18: RULE_CONSTRAINT

**中文名称**：规则约束刚性
**所属断裂点**：配置
**所属语义分组**：配置边
**因果方向**：制度和流程约束 → 资源使用灵活性 → 适应环境变化的能力（规则越僵化，适应越慢）

**transfer_function**：
```
rule_rigidity = compliance_burden * (1 - adaptation_speed) * (1 + brake_existence)
brake_existence = (has_emergency_override ? 0.3 : 1.0)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| rule_rigidity | 规则刚性（0=灵活，1=僵硬） | 0-1 | <0.5 | 计算得出：合规负担 × 适应慢度 × 无刹车惩罚 |
| compliance_burden | 合规负担（合规节点密度代理） | 0-1 | <0.4 | COMPLIANCE节点数 + status='compliant'占比 |
| adaptation_speed | 规则适应环境变化的速度 | 0-1 | >0.4 | PROCESS修改频次（modification_count/时间） |
| brake_existence | 是否存在"紧急制动"条款 | 0-1 | 0.3-1.0 | GA配置（has_emergency_override标记） |

**消费的SOG-Core边**：CONSTRAINS（COMPLIANCE → PROCESS），DEPENDS_ON（PROCESS → COMPLIANCE审批）
**消费的节点属性**：COMPLIANCE.complianceType + status + effectiveDate，PROCESS.processType='approval'，RISK.riskType
**产出的哨兵信号**：cash-runway（规则约束导致资源冻结——隐性消耗）
**关联因果链**：CC-RULE-01（规则约束→资源冻结→适应速度→竞争位势）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — compliance_burden可从COMPLIANCE节点统计；adaptation_speed可从PROCESS修改频次计算；brake_existence需GA配置
**客户A验证**：未验证（缺COMPLIANCE和PROCESS.modification数据）
**缺失数据**：需GA配置COMPLIANCE节点（complianceType + status），并在PROCESS节点上追踪修改历史。默认compliance_burden=0.3, adaptation_speed=0.3
**前置边**：E-14 DECISION_POWER（权力集中度影响规则制定）
**后置边**：E-22 ROUTINE_RIGIDITY（规则约束→惯例僵化），E-24 INNOVATION（规则刚性→创新抑制）

---
### E-19: ORG_LEARNING

**中文名称**：组织学习效率
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：企业通过重复执行积累经验 → 知识提取 → 效率提升（学习曲线）（累积经验越多，学习越快）

**transfer_function**：
```
learning_rate = ΔCapability.proficiencyLevel / Δt
knowledge_accumulation = new_KC_nodes / period
AC_n = AC_1 * n^(-b)  （经典学习曲线，b为学习率指数）
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| learning_rate | 组织学习速率（能力提升速率） | 0-1 | 0.05-0.30 | 计算得出：ΔCapability.proficiencyLevel / Δt |
| knowledge_accumulation | 知识积累速率 | 片/周期 | >0 | KNOWLEDGE_CHUNK节点创建速率 |
| perception_accuracy | 感知精度（从E-04消费） | 0-1 | >0.7 | E-04 PERCEPTION_LEARNING.perception_accuracy |
| b | 学习率指数 | 0-1 | 取决于行业 | 计算得出：log(AC_1/AC_n) / log(n) |

**消费的SOG-Core边**：CORRESPONDS_TO（KnowledgeChunk → Event经验），CONSUMES（KC被学习过程消费）
**消费的节点属性**：KNOWLEDGE_CHUNK.content，CAPABILITY.proficiencyLevel，EVENT.eventType='failure'/'success'
**产出的哨兵信号**：learning-curve（b < 行业基准×0.5 → warning），time-penetration（学习速度跟踪）
**关联因果链**：CC-LEARN-01（感知→学习→知识积累→创新→竞争力）
**硬度**：heuristic
**参数覆盖率**：1/4 (25%) — knowledge_accumulation可从KC节点计数统计；learning_rate需CAPABILITY时间序列（数据不足）；b需长期累积数据
**客户A验证**：未验证（缺CAPABILITY时间序列数据）
**缺失数据**：需AgentObserver采集CAPABILITY.proficiencyLevel的时间序列（周期性快照），并标注EVENT的failure/success分类。KC创建速率可从GraphStore直接统计，但学习曲线指数b需至少6个月数据
**前置边**：E-04 PERCEPTION_LEARNING（感知精度→学习起点）
**后置边**：E-20 KNOWLEDGE_SHARING（学习积累→知识共享），E-24 INNOVATION（学习→创新转化），E-39 KNOWLEDGE_REUSE（学习→知识复用）

---

### E-20: KNOWLEDGE_SHARING

**中文名称**：知识共享效率
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：知识存在于个人/团队中 → 通过共享机制流通 → 组织级知识可访问性（共享渠道越通畅，知识利用率越高）

**transfer_function**：
```
knowledge_accessibility = sharing_channel_density * (1 - knowledge_silo_ratio)
knowledge_silo_ratio = isolated_KC_count / total_KC_count
cross_team_diffusion = KC_accessed_by_other_teams / total_KC_accesses
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| knowledge_accessibility | 知识可访问性 | 0-1 | >0.5 | 计算得出：渠道密度 × (1-孤岛比例) |
| sharing_channel_density | 共享渠道密度 | 0-1 | >0.4 | INTERACTS_WITH边密度（TEAM→TEAM） |
| knowledge_silo_ratio | 知识孤岛比例（仅被一个团队访问的KC占比） | 0-1 | <0.3 | KC引用/访问的团队归属统计 |
| cross_team_diffusion | 跨团队知识扩散率 | 0-1 | >0.3 | KC被非创建团队访问的比率 |

**消费的SOG-Core边**：INTERACTS_WITH（Person/Team间知识传递），CORRESPONDS_TO（KC → 学习主体）
**消费的节点属性**：KNOWLEDGE_CHUNK.content + share_count，PERSON.name，INTERACTS_WITH.channel
**产出的哨兵信号**：knowledge-accessibility（知识孤岛密度 > 阈值）
**关联因果链**：CC-SHARE-01（知识共享→知识可访问→组织学习加速→创新）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — KC访问计数可从GraphStore查询；knowledge_silo_ratio可统计；sharing_channel_density需INTERACTS_WITH数据
**客户A验证**：未验证（缺INTERACTS_WITH和KC访问日志数据）
**缺失数据**：需AgentObserver采集INTERACTS_WITH边（Person/Team间知识传递），并在KC节点上追踪访问日志（who accessed when）。当前KC无访问日志
**前置边**：E-19 ORG_LEARNING（学习积累→知识共享），E-21 ORG_TRUST（信任→共享意愿）
**后置边**：E-24 INNOVATION（知识扩散→创新基础），E-39 KNOWLEDGE_REUSE（共享→复用率）

---

### E-21: ORG_TRUST

**中文名称**：组织信任水平
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：团队历史行为 → 信任水平 → 团队协同效率和交易成本（信任越高，协作摩擦越小）

**transfer_function**：
```
trust_level = collaboration_frequency * (1 - internal_transaction_cost_ratio)
internal_transaction_cost_ratio = internal_coordination_cost / total_operating_cost
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| trust_level | 信任水平 | 0-1 | >0.5 | 计算得出：交互频率 × (1-内部交易成本比) |
| collaboration_frequency | 跨部门/跨团队协作频率 | 次/周期 | — | INTERACTS_WITH边计数（TEAM→TEAM, PERSON→PERSON） |
| internal_transaction_cost_ratio | 内部交易成本比 | 0-1 | <0.3 | E-28 CROSS_FUNCTIONAL_SYNERGY.internal_coordination_cost |

**消费的SOG-Core边**：INTERACTS_WITH（Person/Team间交互），BELONGS_TO（Person → Team归属）
**消费的节点属性**：INTERACTS_WITH.weight + channel，PERSON.name，TEAM.name + teamType，PROCESS.processType
**产出的哨兵信号**：internal-transaction-cost（内部交易成本上升——信任下降的代理指标）
**关联因果链**：CC-TRUST-01（信任→协作→协同→跨职能效率→运营效率）
**硬度**：heuristic
**参数覆盖率**：2/3 (67%) — collaboration_frequency可从INTERACTS_WITH边计数；internal_transaction_cost_ratio从E-28获取
**客户A验证**：未验证（缺INTERACTS_WITH组织交互数据）
**缺失数据**：需AgentObserver采集INTERACTS_WITH边（Person间消息/会议/邮件交互记录）。当前交互数据几乎为零
**前置边**：E-11 TRUST_CONSTRUCTION（信任构建→信任水平），E-16 INFO_TRANSMISSION（信息传递→信任信号）
**后置边**：E-20 KNOWLEDGE_SHARING（信任→共享意愿），E-28 CROSS_FUNCTIONAL_SYNERGY（信任→跨职能协同）

---

### E-22: ROUTINE_RIGIDITY

**中文名称**：惯例僵化度
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：环境变化速度 vs 惯例变异速度 → 适应性差距 → 产出与环境的匹配度（负向：僵化度越高，适应性越差）

**transfer_function**：
```
rigidity_gap = environmental_change_rate - routine_mutation_rate
lock_in_strength = routine_age * (1 - adaptation_frequency)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| rigidity_gap | 惯例僵化差距（正值=僵化，负值=适应良好） | -1~1 | <0.2 | 计算得出：环境变化速率 - 惯例变异速率 |
| routine_age | 惯例年龄（最老PROCESS自创建以来的时间） | 周期 | <52 | PROCESS节点创建时间差（需AgentObserver） |
| adaptation_frequency | 惯例适应频率（PROCESS修改频次） | 次/周期 | >1 | PROCESS节点修改次数 / 时间 |
| lock_in_strength | 路径依赖锁入强度 | 0-1 | <0.5 | 计算得出：routine_age × (1-adaptation_frequency) |

**消费的SOG-Core边**：REPEATS（PROCESS重复执行→惯例固化），DEPENDS_ON（PROCESS → 环境EVENT触发变化）
**消费的节点属性**：PROCESS.processType + created_at + modification_count，KNOWLEDGE_CHUNK.content（惯例编码），EVENT.eventType
**产出的哨兵信号**：routine-mutation（惯例变异 < 环境变化 → warning），org-repairability（犯错后修复速度）
**关联因果链**：CC-RIGID-01（惯例僵化→适应性下降→竞争力减弱→增长停滞）
**硬度**：heuristic
**参数覆盖率**：1/3 (33%) — routine_age可从PROCESS节点创建时间计算（需AgentObserver扩展）；adaptation_frequency和environmental_change_rate需长期数据
**客户A验证**：未验证（缺PROCESS时间序列和修改记录）
**缺失数据**：需AgentObserver在PROCESS节点上追踪created_at和modification_count属性。environmental_change_rate需从E-03 EXTERNAL_ECHO的market_growth波动代理。默认adaptation_frequency=0.5
**前置边**：E-18 RULE_CONSTRAINT（规则约束→惯例固化），E-19 ORG_LEARNING（学习不足→惯例不更新）
**后置边**：E-24 INNOVATION（惯例僵化→创新抑制），E-28 CROSS_FUNCTIONAL_SYNERGY（惯例→跨职能流程固化）

---
### E-23: OPERATIONAL_EXECUTION

**中文名称**：运营执行效率
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：资源投入活动 → 流程效率 × 质量 → 产出价值（乘性逻辑——任一因子归零→总产出归零）

**transfer_function**：
```
operational_output = efficiency_rate * (1 - defect_rate) * capacity_utilization
efficiency_rate = output_units / input_time
unit_cost = total_cost / output_units
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| efficiency_rate | 执行效率 | 0-1 | >0.6 | 计算得出：产出量 / 投入时间 |
| defect_rate | 缺陷率 | 0-1 | <0.1 | PROCESS缺陷计数 / 总产出量 |
| capacity_utilization | 产能利用率 | 0-1 | >0.7 | 实际产出 / 理论产能量 |
| unit_cost | 单位成本 | 万元/单位 | 越低越好 | FINANCIAL.amount(financialType='cost') / 产出量 |
| throughput | 产出吞吐量 | 单位/周期 | — | PROCESS完成速率 |

**消费的SOG-Core边**：EXECUTES（Person → Process），CONSUMES（Process → Tool/资源），PRODUCES（Process → Capability产出）
**消费的节点属性**：PROCESS.processType + timestamp，CAPABILITY.proficiencyLevel，TOOL.category，FINANCIAL.amount(financialType='cost')
**产出的哨兵信号**：unit-economics（单位成本异常），margin-health（毛利率连续下降），growth-quality（收入增长 vs 成本增长比值）
**关联因果链**：CC-EXEC-01（资源投入→执行效率→产出价值→交付能力）
**硬度**：hard
**参数覆盖率**：4/5 (80%) — efficiency_rate、defect_rate、capacity_utilization、throughput可从PROCESS和FINANCIAL计算；unit_cost可直接计算
**客户A验证**：未验证（缺PROCESS级产出量和缺陷数据）
**缺失数据**：需GA在PROCESS节点上标注产出量（output_units）、缺陷数（defect_count）和理论产能（capacity_max）。当前使用FINANCIAL.amount作为产出代理
**前置边**：E-13 CAPITAL_ALLOCATION（资本配置→运营预算），E-15 HUMAN_DEPLOYMENT（人力配置→执行人员）
**后置边**：E-30 PRICING（成本结构→定价基础），E-37 PROFIT_REINVEST（执行效率→利润率→再投资能力），E-12 EFFICIENCY_FINANCING（效率→外部融资信号）

---

### E-24: INNOVATION

**中文名称**：创新转化效率
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：创新投入 → 创新产出 → 新产品/流程/模式 → 竞争力（创新投入越有效，产出越多）

**transfer_function**：
```
innovation_yield = rd_intensity * idea_to_launch_conversion * explore_exploit_ratio
explore_exploit_ratio = exploration_activities / (exploration_activities + exploitation_activities)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| innovation_yield | 创新转化率 | 0-1 | >0.2 | 计算得出：R&D强度 × 转化成功率 × 探索/利用比 |
| rd_intensity | R&D投入强度 | 0-1 | 0.05-0.20 | FINANCIAL.cost中创新类支出/总成本 |
| idea_to_launch_conversion | 创意到上线的转化率 | 0-1 | >0.3 | 新CAPABILITY创建数 / 创新项目总数 |
| explore_exploit_ratio | 探索/利用比 | 0-1 | 0.2-0.4 | 探索性活动 / (探索+利用活动)计数的比值 |

**消费的SOG-Core边**：PRODUCES（创新PROCESS → 新CAPABILITY），DEPENDS_ON（创新 → 知识基础）
**消费的节点属性**：CAPABILITY.category='technical' + proficiencyLevel，KNOWLEDGE_CHUNK.content，PROCESS.processType='deployment'，GOAL.goalType='north_star'
**产出的哨兵信号**：explore-exploit-balance（探索/利用比异常），innovation-output（新能力创建速率）
**关联因果链**：CC-INNOV-01（学习→知识积累→创新→新产品→竞争力）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — rd_intensity可从FINANCIAL分类统计；新CAPABILITY创建速率可从GraphStore统计；idea_to_launch_conversion和explore_exploit_ratio需GA标注
**客户A验证**：未验证（缺创新活动标注数据）
**缺失数据**：需GA在FINANCIAL节点上标注创新类成本，PROCESS节点标注processType包含'innovation'，CAPABILITY节点标注是否为创新产物。默认rd_intensity=0.08, explore_exploit_ratio=0.3
**前置边**：E-19 ORG_LEARNING（学习→创新基础），E-20 KNOWLEDGE_SHARING（知识扩散→创新输入）
**后置边**：E-26 PRODUCT_DEFINITION（创新产出→产品定义），E-36 COMPETITIVE_POSITION（创新→竞争位势）

---

### E-25: BRAND_CONSTRUCTION

**中文名称**：品牌建设强度
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：品牌投入 + 客户认知 → 品牌强度 → 雇主吸引力和客户获取成本（品牌越强，获客成本越低）

**transfer_function**：
```
brand_strength = GOAL.progress_north_star * brand_awareness * brand_loyalty
brand_awareness = CLIENT_count / target_market_size（代理）
brand_loyalty = repeat_purchase_rate
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| brand_strength | 品牌综合强度 | 0-1 | >0.4 | 计算得出：北极星进度 × 品牌认知度 × 品牌忠诚度 |
| brand_awareness | 品牌认知度 | 0-1 | >0.3 | CLIENT计数 / ExternalBaseline.target_market_size（代理） |
| brand_loyalty | 品牌忠诚度 | 0-1 | >0.5 | 重复购买客户数 / 总客户数 |
| repeat_purchase_rate | 重复购买率 | 0-1 | >0.5 | CLIENT实体中标记为repeat的占比 |
| target_market_size | 目标市场规模 | 人数 | — | ExternalBaseline节点（需GA配置） |

**消费的SOG-Core边**：AFFECTS（Goal → 外部CLIENT感知），DEPENDS_ON（品牌 → CAPABILITY质素）
**消费的节点属性**：GOAL.goalType='north_star' + progress，CLIENT.entityType='external'，EVENT.eventType，FINANCIAL.amount(financialType='cost'品牌投入)
**产出的哨兵信号**：brand-health（品牌强度下降趋势），reputation-index（综合声誉指数）
**关联因果链**：CC-BRAND-01（品牌投入→品牌强度→客户获取成本→市场规模）
**硬度**：soft
**参数覆盖率**：2/5 (40%) — brand_awareness可从CLIENT计数代理；brand_loyalty依赖重复购买数据；target_market_size需ExternalBaseline；品牌投入分类需GA标注
**客户A验证**：未验证（缺品牌投入和CLIENT行为数据）
**缺失数据**：需GA在ExternalBaseline中配置target_market_size，在CLIENT节点上标注repeat标记，在FINANCIAL节点上分类品牌支出。默认brand_awareness=0.3, brand_loyalty=0.5
**前置边**：E-27 SERVICE_DELIVERY（交付质量→品牌认知），E-40 REPUTATION_FLYWHEEL（声誉→品牌强化）
**后置边**：E-07 TALENT_ACQUISITION（品牌→雇主吸引力），E-31 CLIENT_RETENTION（品牌忠诚→客户留存）

---
### E-26: PRODUCT_DEFINITION

**中文名称**：产品定义精准度
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：客户需求 → 产品设计 → 产品-市场匹配度 → 客户满意度（产品越精准匹配需求，市场表现越好）

**transfer_function**：
```
product_market_fit_score = feature_adoption_rate * iteration_speed * customer_need_alignment
customer_need_alignment = cosine_similarity(product_feature_vector, customer_need_vector)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| product_market_fit_score | 产品-市场匹配得分 | 0-1 | >0.6 | 计算得出：功能采用率 × 迭代速度 × 需求对齐度 |
| feature_adoption_rate | 功能采用率 | 0-1 | >0.4 | 需GA配置：功能使用用户/总用户 |
| iteration_speed | 产品迭代速度 | 版本/周期 | >2 | 产品版本发布频率（需GA配置） |
| customer_need_alignment | 客户需求对齐度 | 0-1 | >0.7 | 产品功能向量与客户需求向量的余弦相似度 |

**消费的SOG-Core边**：PRODUCES（产品PROCESS → CAPABILITY定义），AFFECTS（产品 → CLIENT满意度）
**消费的节点属性**：CAPABILITY.category + proficiencyLevel，GOAL.goalType='north_star'，CLIENT.entityType='external'，KNOWLEDGE_CHUNK.content
**产出的哨兵信号**：product-market-fit（匹配度下降趋势），feature-gap（需求→功能差距）
**关联因果链**：CC-PROD-01（市场信号→产品定义→产品-市场匹配→市场占有率）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — feature_adoption_rate和iteration_speed需GA配置跟踪数据；customer_need_alignment从E-35客户反馈向量推导
**客户A验证**：未验证（缺产品功能和客户需求向量数据）
**缺失数据**：需GA在CAPABILITY节点上标注产品功能向量，在CLIENT或ExternalBaseline中采集客户需求数据。默认feature_adoption_rate=0.3, iteration_speed=2/周期
**前置边**：E-24 INNOVATION（创新产出→产品定义），E-35 CUSTOMER_DATA_FEEDBACK（客户数据→需求对齐）
**后置边**：E-27 SERVICE_DELIVERY（产品定义→服务交付），E-30 PRICING（产品价值→定价基础）

---

### E-27: SERVICE_DELIVERY

**中文名称**：服务交付质量
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：服务流程 → 交付质量 → 客户满意度和复购意愿（交付越优质，客户满意度越高）

**transfer_function**：
```
delivery_quality = customer_satisfaction_proxy * delivery_timeliness * service_completeness
delivery_speed = 1 / (1 + avg_delivery_delay_days / 3)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| delivery_quality | 交付综合质量 | 0-1 | >0.7 | 计算得出：客户满意度 × 及时性 × 完整性 |
| delivery_speed | 交付速度 | 0-1 | >0.8 | 计算得出：1/(1+平均延迟天数/3) |
| customer_satisfaction_proxy | 客户满意度代理 | 0-1 | >0.7 | CLIENT反馈评分（需GA配置） |
| service_cost | 单位服务成本 | 万元/次 | — | FINANCIAL.amount(financialType='cost') / 服务次数 |
| avg_delivery_delay_days | 平均交付延迟天数 | 天 | <3 | PROCESS.deployment时戳差 |

**消费的SOG-Core边**：PROVIDES（交付PROCESS → CLIENT），DEPENDS_ON（交付 → PERSON/Tool资源）
**消费的节点属性**：PROCESS.processType='deployment'，CLIENT.entityType='external'，PERSON.name，TOOL.category
**产出的哨兵信号**：delivery-quality（交付满意度下降），service-cost-health（服务成本异常）
**关联因果链**：CC-DELIVER-01（产品定义→服务交付→客户满意度→客户留存）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — delivery_speed可从PROCESS时戳差计算；service_cost可从FINANCIAL计算；customer_satisfaction_proxy和service_completeness需GA配置
**客户A验证**：未验证（缺客户满意度数据）
**缺失数据**：需GA在CLIENT节点上采集满意度评分和反馈，在PROCESS.deployment节点上标注delivery_completeness。默认customer_satisfaction_proxy=0.6
**前置边**：E-26 PRODUCT_DEFINITION（产品定义→服务交付内容），E-23 OPERATIONAL_EXECUTION（执行效率→交付速度）
**后置边**：E-25 BRAND_CONSTRUCTION（交付质量→品牌认知），E-31 CLIENT_RETENTION（交付满意→客户留存）

---

### E-28: CROSS_FUNCTIONAL_SYNERGY

**中文名称**：跨职能协同效率
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：跨团队协作 → 协同效应 → 整体产出大于各部门之和（协同越好，组织效率越高）

**transfer_function**：
```
synergy_score = cross_team_output / (sum(team_individual_output) + coordination_cost)
internal_coordination_cost = coordination_cost / total_operating_cost
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| synergy_score | 协同效应得分（>1=正向协同，<1=负向摩擦） | 0-2 | >1.0 | 计算得出：跨团队产出 / (各部门产出和 + 协调成本) |
| cross_team_dependency | 跨团队依赖度 | 0-1 | 0.3-0.7 | INTERACTS_WITH边计数（TEAM→TEAM） |
| internal_coordination_cost | 内部协调成本 | 万元 | — | PROCESS协调成本汇总 |
| coordination_cost_ratio | 协调成本占运营成本比 | 0-1 | <0.3 | internal_coordination_cost / total_operating_cost |

**消费的SOG-Core边**：INTERACTS_WITH（TEAM→TEAM交互），DEPENDS_ON（TEAM → PROCESS协作）
**消费的节点属性**：TEAM.teamType + name，PROCESS.processType（跨职能流程），INTERACTS_WITH.channel + weight，CAPABILITY.category（互补能力识别）
**产出的哨兵信号**：cross-functional-health（协同得分 < 0.8 → warning），internal-transaction-cost（协调成本上升）
**关联因果链**：CC-SYNERGY-01（跨团队协作→协同效应→运营效率→组织产出）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — cross_team_dependency可从INTERACTS_WITH统计；内部协调成本需GA从PROCESS和FINANCIAL联合计算
**客户A验证**：未验证（缺跨团队协作数据和成本核算）
**缺失数据**：需AgentObserver采集INTERACTS_WITH边（TEAM→TEAM），GA在PROCESS节点上标注coordination_cost。默认synergy_score=1.0
**前置边**：E-21 ORG_TRUST（信任→跨职能协同），E-16 INFO_TRANSMISSION（信息传递→跨团队通信）
**后置边**：E-23 OPERATIONAL_EXECUTION（协同→整体执行效率），E-24 INNOVATION（跨职能知识碰撞→创新）

---

### E-29: TECH_INFRASTRUCTURE

**中文名称**：技术基础设施健康度
**所属断裂点**：转化
**所属语义分组**：转化边
**因果方向**：技术投入和架构 → 技术债务积累 → 系统稳定性和扩展性（技术债务越高，变革越困难）

**transfer_function**：
```
infrastructure_health = 1 - (tech_debt_score * system_instability_ratio) / 2
tech_debt_score = avg(TOOL.version_age / current_version_age)
system_stability = 1 / (1 + tech_incident_count_per_period)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| infrastructure_health | 技术基础设施综合健康度 | 0-1 | >0.7 | 计算得出：1 - (技术债务 × 不稳定度)/2 |
| tech_debt_score | 技术债务得分 | 0-1 | <0.3 | TOOL节点version_age代理（工具版本老化程度） |
| system_stability | 系统稳定性 | 0-1 | >0.9 | 计算得出：1/(1+技术事故次数/周期) |
| tech_incident_count | 技术事故频次 | 次/周期 | <2 | RISK.riskType='tech'的事件计数 |

**消费的SOG-Core边**：DEPENDS_ON（PROCESS → TOOL技术工具），AFFECTS（RISK.riskType='tech' ← 基础设施状态）
**消费的节点属性**：TOOL.category + name + version_age，CAPABILITY.category='technical' + proficiencyLevel，PROCESS.processType='deployment'，RISK.riskType='tech'，FINANCIAL.amount(技术投入cost)
**产出的哨兵信号**：tech-debt（技术债务得分 > 0.5 → warning），api-coverage（API集成覆盖）
**关联因果链**：CC-TECH-01（技术投入→基础设施→技术债务→创新速度）
**硬度**：soft
**参数覆盖率**：2/5 (40%) — tech_debt_score可从TOOL.version_age代理；system_stability可从RISK事件统计；tech_incident_count直接计数
**客户A验证**：未验证（缺TOOL版本和事故数据）
**缺失数据**：需GA在TOOL节点上标注version_age（与最新版本的时间差），在RISK节点上分类riskType='tech'事故。默认tech_debt_score=0.2, system_stability=0.95
**前置边**：E-08 RESOURCE_ACQUISITION（技术资源→基础设施），E-24 INNOVATION（创新→技术能力提升）
**后置边**：E-23 OPERATIONAL_EXECUTION（基础设施→运营效率），E-32 CHANNEL_EFFICIENCY（技术→渠道效率）

---
### E-30: PRICING

**中文名称**：定价有效性
**所属断裂点**：交付
**所属语义分组**：交付边
**因果方向**：成本结构 + 客户支付意愿 + 竞争压力 → 价格设定 → 利润率和市场份额（定价越精准，利润最大化）

**transfer_function**：
```
optimal_price = argmax(price * quantity_demanded(price) - cost * quantity_demanded(price))
margin_rate = (price - unit_cost) / price
price_elasticity = ΔQ% / ΔP%
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| optimal_price | 理论最优价格 | 万元 | — | 计算得出：最大化利润的价格点 |
| price_elasticity | 需求价格弹性 | ratio | -2~0 | 计算得出：需求量变化%/价格变化% |
| margin_rate | 毛利率 | % | >30% | 计算得出：(价格-单位成本)/价格 |
| unit_cost | 单位成本 | 万元/单位 | — | E-23 OPERATIONAL_EXECUTION.unit_cost |
| competitor_price | 竞品价格 | 万元 | — | ExternalBaseline（需GA配置） |
| willingness_to_pay | 客户支付意愿 | 万元 | — | CLIENT节点支付数据（需GA配置） |

**消费的SOG-Core边**：AFFECTS（定价 → CLIENT购买行为），DEPENDS_ON（定价 → 成本结构），COMPARES_TO（价格 → 竞品价格）
**消费的节点属性**：FINANCIAL.amount(financialType='revenue'/'cost')，CLIENT.entityType='external'，COMPLIANCE.complianceType='regulation'
**产出的哨兵信号**：margin-health（毛利率连续下降），pricing-power（价格弹性变化——企业是否有定价权）
**关联因果链**：CC-PRICE-01（成本→定价→利润→再投资能力）
**硬度**：hard
**参数覆盖率**：4/5 (80%) — price_elasticity和margin_rate可从FINANCIAL计算；unit_cost从E-23消费；competitor_price需ExternalBaseline；willingness_to_pay需GA配置
**客户A验证**：部分验证 — 客户A定价弹性中等（母婴市场价格敏感，但细分品质市场有一定溢价空间）
**缺失数据**：需GA在ExternalBaseline中配置竞品价格（competitor_price_list），在CLIENT节点上采集支付意愿数据。默认price_elasticity=-1.0, margin_rate=0.25
**前置边**：E-23 OPERATIONAL_EXECUTION（成本结构→定价基础），E-26 PRODUCT_DEFINITION（产品价值→溢价能力），E-33 MARKET_COMPETITION（竞争→价格压力）
**后置边**：E-31 CLIENT_RETENTION（价格→客户留存），E-37 PROFIT_REINVEST（利润率→再投资能力）

---

### E-31: CLIENT_RETENTION

**中文名称**：客户留存率
**所属断裂点**：交付
**所属语义分组**：交付边
**因果方向**：客户体验 + 产品价值 + 转换成本 → 客户留存率 → 客户终身价值和收入稳定性（留存越高，增长越可持续）

**transfer_function**：
```
retention_rate = 1 - churn_rate
churn_risk = f(usage_frequency, support_tickets, renewal_signal)
lifetime_value = avg_revenue_per_client * (1 / (1 - retention_rate))
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| retention_rate | 客户留存率 | 0-1 | >0.8 | 计算得出：期末留存客户/期初客户总数 |
| churn_risk | 流失风险概率 | 0-1 | <0.2 | 计算得出：f(使用频率, 支持工单, 续约信号) |
| lifetime_value | 客户终身价值（CLV） | 万元 | — | 计算得出：ARPU / (1-留存率) |
| avg_revenue_per_client | 客户平均收入（ARPU） | 万元/周期 | — | FINANCIAL.revenue / CLIENT数量 |
| switching_cost | 客户转换成本 | 0-1 | 取决于行业 | E-33 MARKET_COMPETITION.switching_cost |

**消费的SOG-Core边**：CONTRACTS（CLIENT → FINANCIAL收入），INTERACTS_WITH（CLIENT → 企业服务触达）
**消费的节点属性**：CLIENT.entityType='external' + name，FINANCIAL.amount(financialType='revenue')，EVENT.eventType + timestamp（客户行为事件）
**产出的哨兵信号**：churn-risk（流失概率 > 0.3 → warning），client-health（LTV/CAC比值 < 3 → warning）
**关联因果链**：CC-RETAIN-01（客户体验→客户留存→终身价值→收入稳定性→利润率）
**硬度**：hard
**参数覆盖率**：3/4 (75%) — retention_rate、lifetime_value、avg_revenue_per_client可从CLIENT和FINANCIAL计算；churn_risk需客户行为数据
**客户A验证**：未验证（缺客户留存时间序列数据）
**缺失数据**：需GA在CLIENT节点上追踪first_seen和last_active时间戳，标注churn事件。默认retention_rate=0.85
**前置边**：E-27 SERVICE_DELIVERY（交付质量→客户留存），E-30 PRICING（价格→留存意愿），E-25 BRAND_CONSTRUCTION（品牌忠诚→留存）
**后置边**：E-32 CHANNEL_EFFICIENCY（留存→渠道ROI），E-40 REPUTATION_FLYWHEEL（留存→口碑推荐）

---

### E-32: CHANNEL_EFFICIENCY

**中文名称**：渠道效率
**所属断裂点**：交付
**所属语义分组**：交付边
**因果方向**：获客渠道投入 → 渠道转化率 → 客户获取成本和渠道ROI（渠道效率越高，增长越健康）

**transfer_function**：
```
channel_roi = channel_revenue / channel_cost
conversion_rate = new_clients / channel_reach
channel_attribution = weighted_sum(channel_i * attribution_weight_i)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| channel_roi | 渠道投资回报率 | ratio | >2.0 | 计算得出：渠道收入/渠道成本 |
| conversion_rate | 渠道转化率 | 0-1 | >0.05 | CLIENT创建数 / 渠道触达量 |
| channel_reach | 渠道触达量 | 人数 | — | 需GA配置（各渠道reach数据） |
| channel_cost | 渠道成本 | 万元 | — | FINANCIAL.amount(financialType='cost')渠道费用 |
| channel_attribution | 渠道归因权重 | 分布 | — | 多触点归因模型 |

**消费的SOG-Core边**：REACHES（渠道 → CLIENT触达），CONSUMES（渠道 → 预算），CONVERTS（渠道 → CLIENT转化）
**消费的节点属性**：CLIENT.entityType='external'，FINANCIAL.amount(financialType='cost')，PROCESS.processType（渠道流程），TOOL.category（渠道工具）
**产出的哨兵信号**：channel-health（渠道ROI < 1.5 → warning），cac-trend（获客成本上升趋势）
**关联因果链**：CC-CHANNEL-01（渠道投入→转化率→获客成本→增长可扩展性）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — channel_roi可从FINANCIAL计算；conversion_rate可从CLIENT/PROCESS统计；channel_reach和channel_attribution需GA配置
**客户A验证**：未验证（缺多渠道归因数据）
**缺失数据**：需GA配置渠道分类（在FINANCIAL.cost和CLIENT上标注channel_source），渠道触达量数据。默认channel_roi=2.5, conversion_rate=0.05
**前置边**：E-25 BRAND_CONSTRUCTION（品牌→渠道效率），E-31 CLIENT_RETENTION（留存→渠道ROI）
**后置边**：E-33 MARKET_COMPETITION（渠道效率→市场渗透），E-36 COMPETITIVE_POSITION（渠道→竞争位势）

---
### E-33: MARKET_COMPETITION

**中文名称**：市场竞争强度
**所属断裂点**：交付
**所属语义分组**：交付边
**因果方向**：市场结构 + 竞品行为 → 竞争压力 → 企业定价空间和市场份额（竞争越激烈，利润空间越小）

**transfer_function**：
```
HHI = Sum(market_share_i ^ 2)  * 10000   （赫芬达尔指数，0-10000）
competitive_position_score = relative_market_share * quality_premium
competitor_aggressiveness = competitor_event_frequency / period
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| HHI | 赫芬达尔-赫希曼指数（市场集中度） | 0-10000 | 1500-2500（中等集中） | 计算得出：∑(市场份额²)×10000 |
| competitive_position_score | 竞争位势得分 | 0-1 | >0.5 | 计算得出：相对市场份额 × 品质溢价 |
| competitor_aggressiveness | 竞品激进程度 | 0-1 | 0.3-0.7 | EVENT事件中竞品事件频次/周期 |
| market_share | 企业市场份额 | % | — | FINANCIAL.revenue / ExternalBaseline.market_size |
| switching_cost | 客户转换成本（从E-31反推） | 0-1 | >0.3 | 从E-31 CLIENT_RETENTION消费 |

**消费的SOG-Core边**：COMPETES_WITH（企业 → 竞品），AFFECTS（市场变化 → FINANCIAL市场份额）
**消费的节点属性**：FINANCIAL.amount（市场份额代理），EVENT.eventType，CLIENT.entityType='external'，ExternalBaseline.market_size + competitor_count
**产出的哨兵信号**：competitive-position（竞争位势连续下降），market-concentration（HHI剧烈变化 → 市场结构改变）
**关联因果链**：CC-COMPET-01（市场结构→竞争强度→定价空间→利润可持续性）
**硬度**：hard
**参数覆盖率**：3/5 (60%) — HHI和competitive_position可从FINANCIAL计算；competitor_aggressiveness可从EVENT统计；market_size和competitor_shares需ExternalBaseline
**客户A验证**：部分验证 — 客户A所在母婴市场HHI偏低（碎片化市场），但细分品质市场有差异化空间
**缺失数据**：需GA在ExternalBaseline中配置market_size和competitor_market_shares。默认HHI=1500, competitor_aggressiveness=0.5
**前置边**：E-36 COMPETITIVE_POSITION（竞争位势→竞争压力），E-30 PRICING（定价→市场份额）
**后置边**：E-03 EXTERNAL_ECHO（市场竞争→外部回响），E-31 CLIENT_RETENTION（竞争→客户流失压力）

---

### E-34: PROCUREMENT_POWER

**中文名称**：采购议价能力
**所属断裂点**：交付
**所属语义分组**：交付边
**因果方向**：企业对供应商的依赖度 → 议价能力 → 采购成本和供应稳定性（议价能力越强，成本越低且越稳定）

**transfer_function**：
```
bargaining_power = purchase_volume_ratio / supplier_dependency
supplier_reliability = 1 / (1 + supplier_incident_count)
procurement_efficiency = procurement_output / procurement_cost
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| bargaining_power | 议价能力指数 | 0-1 | >0.5 | 计算得出：采购量比例 / 供应商依赖度 |
| supplier_reliability | 供应商可靠性 | 0-1 | >0.8 | 计算得出：1/(1+供应事故次数) |
| purchase_volume_ratio | 采购量占供应商业务比例 | 0-1 | >0.1 | 需ExternalBaseline（企业采购/供应商总订单） |
| supplier_dependency | 企业对供应商的依赖度 | 0-1 | <0.5 | TOOL节点供应商集中度 |
| procurement_cost | 采购总成本 | 万元 | — | FINANCIAL.amount(financialType='cost')采购类 |

**消费的SOG-Core边**：PROVIDES（供应商 → TOOL物料），DEPENDS_ON（企业 → 供应商关系）
**消费的节点属性**：TOOL.category + name，FINANCIAL.amount(financialType='cost')，RISK.riskType='supplier'
**产出的哨兵信号**：make-or-buy（自制vs外购评估），supply-chain-risk（供应事故频次 → warning）
**关联因果链**：CC-PROCURE-01（采购→供应稳定性→运营成本→利润空间）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — supplier_reliability可从RISK事件统计；procurement_cost可从FINANCIAL获取；purchase_volume_ratio和supplier_dependency需ExternalBaseline配置
**客户A验证**：未验证（缺供应商关系数据）
**缺失数据**：需GA在ExternalBaseline中配置供应商订单占比，在TOOL节点上标注supplier_name和dependency_level。默认bargaining_power=0.5, supplier_reliability=0.9
**前置边**：E-08 RESOURCE_ACQUISITION（资源获取→供应商基础）
**后置边**：E-23 OPERATIONAL_EXECUTION（采购→物料供应→执行效率），E-30 PRICING（采购成本→定价成本基础）

---

### E-35: CUSTOMER_DATA_FEEDBACK

**中文名称**：客户数据反馈闭环
**所属断裂点**：交付（跨点传导至转化）
**所属语义分组**：交付边
**因果方向**：客户使用产品产生行为数据 → 分析提取信号 → 反馈到产品定义和运营优化 → 闭环速度决定迭代效率

**transfer_function**：
```
feedback_loop_speed = 1 / (1 + analysis_to_action_latency_days / 7)
feedback_signal = customer_behavior_vector * product_impact_matrix
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| feedback_loop_speed | 反馈闭环速度 | 0-1 | >0.6 | 计算得出：1/(1+分析到行动的延迟天数/7) |
| feedback_signal | 客户反馈信号强度 | 向量 | — | 客户行为向量 × 产品影响矩阵 |
| analysis_to_action_latency_days | 从数据分析到产品行动的天数 | 天 | <14 | EVENT.client_event → PROCESS.deployment时戳差 |
| feedback_quality | 反馈数据质量 | 0-1 | >0.7 | 需GA标记（数据完整性+准确性） |
| customer_behavior_vector | 客户行为向量 | 向量 | — | CLIENT节点行为序列（需GA采集） |

**消费的SOG-Core边**：GENERATES（CLIENT使用行为 → EVENT数据），FEEDS_INTO（数据 → PRODUCT产品定义PROCESS）
**消费的节点属性**：CLIENT.entityType='external'，EVENT.eventType + timestamp，KNOWLEDGE_CHUNK.content，DOCUMENT.docType='report'
**产出的哨兵信号**：feedback-loop-health（闭环速度 < 阈值），data-driven-score（数据驱动决策程度）
**关联因果链**：CC-FEED-01（客户行为→数据采集→分析→产品优化→客户满意度→留存）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — analysis_to_action_latency可从EVENT和PROCESS时戳差计算；feedback_quality需GA标记；customer_behavior_vector需全面客户数据采集
**客户A验证**：未验证（缺客户行为数据→产品行动的闭环追踪）
**缺失数据**：需AgentObserver采集CLIENT行为事件→PROCESS.deployment的完整时序链路，GA在DOCUMENT节点上标注分析报告类型。默认feedback_loop_speed=0.5, feedback_quality=0.6
**前置边**：E-02 PASSIVE_SIGNAL（被动信号→客户反馈数据源），E-09 DATA_ACQUISITION（数据获取→反馈数据基础）
**后置边**：E-26 PRODUCT_DEFINITION（客户反馈→产品定义），E-19 ORG_LEARNING（反馈→组织学习）

---

### E-36: COMPETITIVE_POSITION

**中文名称**：竞争位势综合评估
**所属断裂点**：交付
**所属语义分组**：交付边
**因果方向**：Hamilton Helmer七种力量 → 综合竞争位势 → 长期利润可持续性（位势越强，利润越持久）

**transfer_function**：
```
seven_powers_score = weighted_avg(scale_economy, network_effect, switching_cost, brand, cornered_resource, process_power, counter_positioning)
competitive_position_moat = moat_strength * market_share * quality_premium
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| seven_powers_score | 七力综合评分 | 0-1 | >0.5 | 计算得出：七种力量的加权平均 |
| competitive_position_moat | 竞争护城河强度 | 0-1 | >0.4 | 计算得出：差异化程度 × 市场份额 × 品质溢价 |
| moat_strength | 护城河综合强度 | 0-1 | >0.4 | 差异化程度 × 客户转换成本 |
| quality_premium | 品质溢价（价格高于竞品的比例） | % | >5% | price_avg / competitor_price_avg - 1 |
| market_share | 市场份额 | % | — | FINANCIAL.revenue / ExternalBaseline.market_size |

**消费的SOG-Core边**：POSITIONS（企业 → 市场位势），COMPARES_TO（企业能力 → 竞品能力）
**消费的节点属性**：FINANCIAL.amount，CLIENT.entityType='external'，CAPABILITY.category='domain' + proficiencyLevel，GOAL.goalType='north_star'，ExternalBaseline.competitor_market_shares
**产出的哨兵信号**：competitive-position（seven_powers_score变化趋势），moat-health（护城河强度下降）
**关联因果链**：CC-POSITION-01（七力→竞争位势→市场份额→利润可持续性→再投资能力）
**硬度**：soft
**参数覆盖率**：2/5 (40%) — market_share和quality_premium可从FINANCIAL计算；seven_powers_score的七个子项中品牌、切换成本可从E-25/E-31消费，其余需GA评估
**客户A验证**：部分验证 — 客户A在细分母婴品质市场有一定品牌和客户关系（switching_cost中等），但规模经济和网络效应弱
**缺失数据**：需GA配置competitor_market_shares（ExternalBaseline），评估scale_economy、network_effect、cornered_resource、process_power、counter_positioning五项（主观评分）。默认seven_powers_score=0.4
**前置边**：E-33 MARKET_COMPETITION（竞争数据→位势评估），E-25 BRAND_CONSTRUCTION（品牌→位势子项），E-31 CLIENT_RETENTION（留存→切换成本）
**后置边**：E-40 REPUTATION_FLYWHEEL（位势→声誉飞轮），E-37 PROFIT_REINVEST（位势→利润可投资性）

---
### E-37: PROFIT_REINVEST

**中文名称**：利润再投资效率
**所属断裂点**：回流
**所属语义分组**：回流边
**因果方向**：企业产生利润 → 留存比率 → 再投资方向和效率 → 下一轮循环的资本基础（留存越多且方向越精准，增长越自主）

**transfer_function**：
```
retention_ratio = retained_earnings / total_profit
reinvestment_efficiency = new_revenue_from_reinvestment / reinvested_amount
profit_margin = (revenue - cost) / revenue
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| retention_ratio | 利润留存比率 | 0-1 | 0.3-0.7 | 计算得出：留存利润/总利润 |
| reinvestment_efficiency | 再投资效率（ROI of reinvestment） | ratio | >1.0 | 计算得出：再投资带来的新收入/再投资额 |
| profit_margin | 利润率 | % | >10% | 计算得出：(收入-成本)/收入 |
| total_profit | 总利润 | 万元 | >0 | FINANCIAL.amount(revenue) - FINANCIAL.amount(cost) |
| reinvested_amount | 再投资金额 | 万元 | — | FINANCIAL.amount(cost)中投资类 |

**消费的SOG-Core边**：PRODUCES（运营 → FINANCIAL利润），REDIRECTS（利润 → 再投资PROCESS）
**消费的节点属性**：FINANCIAL.amount(financialType='revenue'/'cost')，PROCESS.processType（再投资决策），GOAL.description（投资方向）
**产出的哨兵信号**：business-model-coherence（利润流向与战略一致性），cash-runway（现金流跑道）
**关联因果链**：CC-REINVEST-01（利润→留存→再投资→资本池→下一轮获取→配置→增长）
**硬度**：hard
**参数覆盖率**：4/5 (80%) — retention_ratio、profit_margin、total_profit可从FINANCIAL计算；reinvestment_efficiency需区分再投资带来的增量收入（归因挑战）
**客户A验证**：已验证 — 客户A2023年利润留存比≈0.6，再投资于品类扩展和服务提升，利润率约12%
**缺失数据**：需GA在FINANCIAL节点上区分再投资vs常规运营成本，在PROCESS节点上关联再投资→新收入增量。retention_ratio默认0.5
**前置边**：E-23 OPERATIONAL_EXECUTION（运营效率→利润率），E-30 PRICING（定价→利润率），E-13 CAPITAL_ALLOCATION（配置效率→再投资方向）
**后置边**：E-05 CAPITAL_ACQUISITION（留存利润→减少对外融资依赖），E-24 INNOVATION（再投资→创新投入）

---

### E-38: TALENT_RETENTION

**中文名称**：人才留存率
**所属断裂点**：回流
**所属语义分组**：回流边
**因果方向**：员工满意度 + 外部机会 + 薪酬竞争力 → 离职率 → 人才池大小和能力连续性（留存越高，人才积累越深厚）

**transfer_function**：
```
talent_retention_rate = stayed_count / total_count_start
turnover_cost = avg_replacement_cost * departed_count
compensation_competitiveness = avg_salary_enterprise / avg_salary_market
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| talent_retention_rate | 人才留存率 | 0-1 | >0.8 | 计算得出：留存人数/期初总人数 |
| turnover_rate | 离职率 | 0-1 | <0.2 | 计算得出：离职人数/期初总人数 |
| turnover_cost | 人才流失成本 | 万元 | — | 平均替换成本 × 离职人数 |
| compensation_competitiveness | 薪酬竞争力 | ratio | >0.9 | PERSON薪酬平均 / ExternalBaseline.industry_avg_salary |
| avg_replacement_cost | 平均替换成本 | 万元/人 | — | 需GA配置（招聘+培训+生产力损失） |

**消费的SOG-Core边**：BELONGS_TO（Person → Team留存），AFFECTS（人才流失 → TEAM能力缺口）
**消费的节点属性**：PERSON.name，TEAM.teamType，FINANCIAL.amount(薪酬成本)，CAPABILITY.proficiencyLevel
**产出的哨兵信号**：key-person-risk（关键人备份率 < 1.0），talent-density（人才流失速度 > inflow速度）
**关联因果链**：CC-TALENT-01（人才留存→人才密度→组织能力→执行效率→增长）
**硬度**：hard
**参数覆盖率**：3/5 (60%) — retention_rate和turnover_rate可从PERSON节点统计；compensation_competitiveness需ExternalBaseline；avg_replacement_cost和turnover_cost需GA配置
**客户A验证**：未验证（缺PERSON离职/入职时间序列数据）
**缺失数据**：需AgentObserver在PERSON节点上追踪joined_at和departed_at时间戳，GA在ExternalBaseline中配置行业薪酬基准。默认retention_rate=0.85, compensation_competitiveness=0.95
**前置边**：E-07 TALENT_ACQUISITION（人才获取→人才池），E-15 HUMAN_DEPLOYMENT（人岗匹配→满意度→留存）
**后置边**：E-41 TALENT_PROTECTION（人才留存→知识保护），E-07 TALENT_ACQUISITION（留存口碑→未来雇主吸引力）

---

### E-39: KNOWLEDGE_REUSE

**中文名称**：知识复用率
**所属断裂点**：回流
**所属语义分组**：回流边
**因果方向**：知识产生 → 编码存储 → 检索可复用 → 下一轮循环的学习起点高度（复用率越高，组织记忆越强）

**transfer_function**：
```
knowledge_reuse_rate = KC_reaccess_count / total_KC_count
codification_rate = DOCUMENT_count / KC_count
knowledge_decay = avg_days_since_last_access / 365
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| knowledge_reuse_rate | 知识复用率 | 0-1 | >0.3 | 计算得出：KC被重复访问次数/KC总数 |
| codification_rate | 知识编码率（显性化程度） | 0-1 | >0.5 | DOCUMENT节点数量 / KC节点数量 |
| knowledge_decay | 知识衰减度 | 0-1 | <0.5 | KC自上次访问以来的平均天数/365 |
| KC_reaccess_count | KC被重复访问次数 | 次数 | — | GraphStore查询：KC节点访问日志 |
| knowledge_loss_on_turnover | 人才离职导致的知识损失 | 0-1 | — | E-41 TALENT_PROTECTION.knowledge_codification |

**消费的SOG-Core边**：REFERENCES（Person → KC复用），CORRESPONDS_TO（KC → CAPABILITY能力转化）
**消费的节点属性**：KNOWLEDGE_CHUNK.content + access_count，CAPABILITY.proficiencyLevel，DOCUMENT.docType，PERSON.name
**产出的哨兵信号**：knowledge-accessibility（复用率 < 0.2 → warning），knowledge-decay（衰减度 > 0.7 → warning）
**关联因果链**：CC-REUSE-01（知识编码→检索→复用→学习加速→创新→竞争力）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — KC访问统计可从GraphStore查询；codification_rate可从DOCUMENT/KC比例统计；knowledge_decay需访问时间序列
**客户A验证**：未验证（缺KC访问日志和DOCUMENT/KC统计）
**缺失数据**：需AgentObserver在KC节点上追踪access_count和last_accessed_at。DOCUMENT节点需与KC关联映射。当前KC无访问日志
**前置边**：E-19 ORG_LEARNING（学习→知识产生），E-20 KNOWLEDGE_SHARING（共享→知识可访问→复用）
**后置边**：E-04 PERCEPTION_LEARNING（复用→感知精度提升），E-24 INNOVATION（知识基础→创新输入）

---
### E-40: REPUTATION_FLYWHEEL

**中文名称**：声誉飞轮动量
**所属断裂点**：回流（跨点传导至获取）
**所属语义分组**：回流边
**因果方向**：成功的交付 → 客户口碑扩散 → 声誉提升 → 新客户获取和新人才获取成本降低 → 飞轮加速或减速

**transfer_function**：
```
flywheel_momentum = word_of_mouth_amplification * brand_damage_recovery_rate * growth_trajectory
referral_prob = referred_clients / new_clients_total
nps_proxy = (promoters - detractors) / total_responses
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| flywheel_momentum | 飞轮动量（>1=加速，<1=减速） | 0-2 | >1.0 | 计算得出：口碑放大 × 品牌修复率 × 增长轨迹 |
| referral_prob | 客户推荐概率 | 0-1 | >0.2 | CLIENT中推荐来源/新客户总数 |
| nps_proxy | NPS代理（净推荐值代理） | -1~1 | >0 | 需GA配置客户满意度调查 |
| word_of_mouth_amplification | 口碑放大系数 | 0-2 | >1.0 | referral_clients带来的二级传播 |
| brand_damage_recovery_rate | 品牌损害修复率 | 0-1 | — | EVENT负面事件后品牌恢复速度 |
| acquisition_cost_trajectory | 获客成本变化趋势 | ratio | <1.0（下降） | CAC_t / CAC_{t-1} |

**消费的SOG-Core边**：AMPLIFIES（CLIENT口碑 → GOAL.north_star），REDUCES（声誉 → CLIENT获取成本）
**消费的节点属性**：GOAL.goalType='north_star' + progress，EVENT.eventType，CLIENT.entityType='external'，CAPABILITY.proficiencyLevel，FINANCIAL.amount
**产出的哨兵信号**：reputation-flywheel（飞轮动量 < 0.8 → warning），referral-health（推荐率下降）
**关联因果链**：CC-FLYWHEEL-01（交付→口碑→声誉→获客成本→增长→更多交付）
**硬度**：soft
**参数覆盖率**：2/5 (40%) — referral_prob可从CLIENT统计；acquisition_cost_trajectory可从FINANCIAL计算；nps_proxy和word_of_mouth需GA配置客户调查；brand_damage_recovery_rate需长期跟踪
**客户A验证**：未验证（缺NPS和推荐数据）
**缺失数据**：需GA在CLIENT节点上标注referral_source，配置NPS或客户满意度调查数据采集。默认flywheel_momentum=1.0, referral_prob=0.15
**前置边**：E-25 BRAND_CONSTRUCTION（品牌→声誉基础），E-31 CLIENT_RETENTION（留存→口碑来源），E-36 COMPETITIVE_POSITION（位势→声誉支撑）
**后置边**：E-07 TALENT_ACQUISITION（声誉→雇主吸引力），E-05 CAPITAL_ACQUISITION（声誉→融资吸引力）

---

### E-41: TALENT_PROTECTION

**中文名称**：人才→知识保护转化
**所属断裂点**：回流（跨点传导至转化）
**所属语义分组**：回流边
**因果方向**：人才留存 → 知识被编码为组织记忆 → 人才离职不等于知识流失 → 组织记忆深度

**transfer_function**：
```
knowledge_codification = KC_nodes_created_by_person / PERSON_node_count
backup_ratio = backup_persons / key_persons
key_person_score = knowledge_uniqueness * (1 - replaceability)
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| knowledge_codification | 知识显性化比率（每人的KC产出） | ratio | >1.0 | 计算得出：KC创建数/PERSON节点数 |
| backup_ratio | 关键岗位备份率 | ratio | >=1.0 | backup人员/关键人员数 |
| key_person_score | 关键人依赖度得分 | 0-1 | <0.7 | 计算得出：知识独特性 × (1-可替代性) |
| knowledge_uniqueness | 个人知识的独特程度 | 0-1 | — | PERSON持有的独有KC占比 |
| replaceability | 人才可替代性 | 0-1 | >0.3 | 相似技能PERSON数 / TEAM规模 |

**消费的SOG-Core边**：CODIFIES（Person → KC知识输出），BACKS_UP（backup Person → 关键Person）
**消费的节点属性**：PERSON.name，KNOWLEDGE_CHUNK.content，CAPABILITY.proficiencyLevel，TEAM.teamType，PROCESS.processType
**产出的哨兵信号**：key-person-risk（backup_ratio < 1.0 → critical），knowledge-loss-risk（人才流失预期知识损失）
**关联因果链**：CC-PROTECT-01（人才留存→知识编码→组织记忆→学习连续性→效率稳定）
**硬度**：soft
**参数覆盖率**：2/5 (40%) — knowledge_codification可从KC/PERSON比例统计；backup_ratio需GA标注关键岗位和备份关系；key_person_score需知识独特性评估
**客户A验证**：未验证（缺KC创建者和备份关系数据）
**缺失数据**：需GA在PERSON节点上标注is_key_person和backup_person_ids，在KC节点上追踪created_by属性。默认knowledge_codification=0.5, backup_ratio=0.5
**前置边**：E-38 TALENT_RETENTION（人才留存→知识保护对象），E-39 KNOWLEDGE_REUSE（复用率→编码价值）
**后置边**：E-19 ORG_LEARNING（知识保护→学习连续性），E-07 TALENT_ACQUISITION（关键人风险→招聘优先级）

---

### E-42: ASSUMPTION_LINKAGE

**中文名称**：假设→资本重分配链接
**所属断裂点**：回流（跨点传导至配置）
**所属语义分组**：传导边
**因果方向**：企业隐性假设成立 → 资本按计划配置 → 假设破裂时 → 触发资本重分配信号 → 防止资源在错误方向持续燃烧（SwissAir式的断裂防御）

**transfer_function**：
```
assumption_validity = 1 - |assumption_value - reality_value| / max(|assumption_value|, |reality_value|)
reallocation_trigger = (assumption_validity < threshold ? 1 : 0) * reallocation_sensitivity
assumption_review_frequency = assumption_review_count / period
```

**参数语义**：
| 参数 | 含义 | 单位 | 正常范围 | 来源 |
|------|------|------|---------|------|
| assumption_validity | 假设有效性（0=假设已死，1=假设完全正确） | 0-1 | >0.7 | 计算得出：1 - |假设值-现实值|/max(|假设值|,|现实值|) |
| reallocation_trigger | 重分配触发信号 | 0-1 | — | 假设有效性 < 阈值 → 触发 |
| assumption_review_frequency | 假设审查频率 | 次/周期 | >2 | PROCESS.approval（假设审查流程）频次 |
| reallocation_sensitivity | 重分配灵敏度 | 0-1 | 0.3-0.7 | GA配置：假设破裂后多长时间触发资本重分配 |
| assumption_value | 假设的预期值 | 数值 | — | GOAL.description中的假设声明（需GA标注） |
| reality_value | 实际观测值 | 数值 | — | ExternalBaseline + EVENT实际数据 |

**消费的SOG-Core边**：VALIDATES（GOAL假设 → ExternalBaseline现实），TRIGGERS（假设破裂 → PROCESS.approval重分配），REDIRECTS（资本 → 新方向）
**消费的节点属性**：GOAL.goalType='north_star' + description，EVENT.eventType + timestamp，PROCESS.processType='approval'，COMPLIANCE.complianceType='policy'
**产出的哨兵信号**：survival-margin（存活因素聚合——假设断裂的最后防线），assumption-break（假设有效性 < 阈值 → critical）
**关联因果链**：CC-ASSUME-01（假设制定→假设监控→假设破裂→资本重分配→资源重新配置→新方向）
**硬度**：soft
**参数覆盖率**：2/4 (50%) — assumption_review_frequency可从PROCESS统计；assumption_validity需GOAL假设声明+ExternalBaseline对照；reallocation_sensitivity需GA配置
**客户A验证**：未验证（缺假设声明和系统性审查流程）
**缺失数据**：需GA在GOAL节点上标注假设声明（assumption_description + assumption_value），在ExternalBaseline中配置实际观测值对照。reallocation_sensitivity默认0.5
**前置边**：E-03 EXTERNAL_ECHO（外部环境变化→假设破裂），E-14 DECISION_POWER（权力结构→假设审查机制）
**后置边**：E-13 CAPITAL_ALLOCATION（假设破裂→资本重分配），E-18 RULE_CONSTRAINT（假设审查→规则触发紧急制动）

---

