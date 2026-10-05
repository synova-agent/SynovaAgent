<!--
  Synova 权威文档14 | 第二章：能力->场景溯源矩阵与自助诊断
  版本: v1.0 | 日期: 2026-07-14 | 作者: Synova 研究组
  定位: 施工文档——从GA报障到工程师排查的30秒直达路径
-->

# 第二章：能力->场景溯源矩阵与自助诊断

> 核心问题：GA报告"诊断不准确"时，工程师怎么排查？更进一步——系统能不能自己告诉GA问题出在哪？
> 本章产出：18行P0能力溯源矩阵 + 自助诊断脚本逻辑（check-self-diagnosis.sh）

---

## 2.0 设计原则

**不穷举。** 13份权威文档定义了42条边、50个哨兵、61个compute、35个Skill、21个Playbook——矩阵穷举会炸成数百行，无人可维护。

**选P0级能力**——覆盖80%常见故障的能力。选取逻辑：
- 被3条以上因果链引用的"骨干边"（如E-23 OPERATIONAL_EXECUTION被11条链引用）
- 启动序列Phase 0-5中的关键Loader
- severity=P0/P1的哨兵
- 客户A案例中已验证的能力（数据可得的优先）

---

## 2.1 能力->场景溯源矩阵（18行）

| # | 能力 | 定义文档章节 | 支撑用户场景 | 依赖上游 | 失效影响 | 排查路径 |
|---|------|------------|------------|---------|---------|---------|
| 1 | E-23 OPERATIONAL_EXECUTION transfer_function | 权威01 C1断裂方式 | CEO/CFO看运营效率根因、利润率诊断 | GraphStore.ACTIVITY_POOL.efficiency_rate数据准时性、E-13.allocation_ratio | 所有消费E-23的哨兵（margin-health/capital-health/unit-economics）输出异常；成本结构分析不准确 | 1.查data-health哨兵最近success时间 2.查efficiency_rate是否在0.3-0.9正常范围 3.查computeDOL输出是否在1.0-5.0合理区间 4.查GraphStore中PROCESS节点是否有timestamp序列 |
| 2 | E-05 CAPITAL_ACQUISITION | 权威01 A1断裂方式 | CFO看融资健康度、现金流跑道 | Financial.amount节点含financialType标签、E-37.retention_ratio | capital-health/cash-runway哨兵失效；融资诊断结论不可信 | 1.查Financial节点financialType标签完整性 2.查monthly_burn计算是否依赖连续12个月的Financial时间序列 3.查E-37的retention_ratio是否在0.3-0.7正常范围 |
| 3 | E-13 CAPITAL_ALLOCATION | 权威01 B1断裂方式 | CEO/中层看预算分配ROI | E-05.cash_runway_months、GraphStore.CAPITAL_POOL.allocation_efficiency | capital-health哨兵allocation_efficiency异常；资源错配无法被检测 | 1.查CAPITAL_POOL节点allocation_efficiency字段是否存在 2.查allocation_ratio是否在0-1范围内 3.查capital-health哨兵最近check时间戳 |
| 4 | E-30 PRICING | 权威01 D1断裂方式 | 销售VP看定价合理性 | E-23.unit_cost、E-33.competitor_aggressiveness、PRICE_EVENT节点序列 | margin-health哨兵price_elasticity异常；定价建议不可信 | 1.查PRICE_EVENT节点数量>=3（computePriceElasticity最低要求） 2.查margin_rate是否在5%-50%合理范围 3.查E-33 MARKET_COMPETITION的competitor_aggressiveness数据 |
| 5 | E-37 PROFIT_REINVEST | 权威01 E1断裂方式 | CFO/CEO看利润再投资效率 | E-23.profit_margin、FINANCIAL节点金额序列 | business-model-coherence哨兵失效；cash-runway计算缺失回流端 | 1.查FINANCIAL.amount标签是否同时存在revenue和cost 2.查retention_ratio是否在0-1范围 3.查PROCESS节点中再投资决策processType标签 |
| 6 | E-31 CLIENT_RETENTION | 权威01 D2断裂方式 | CEO/CMO看客户流失趋势 | CLIENT节点churn标记、E-25.brand_strength、E-27.delivery_quality | customer-demand-shift哨兵失效；客户流失诊断不可信 | 1.查CLIENT节点的entityType='external'标签 2.查churn_rate是否在0-0.5合理范围 3.查CLIENT节点是否有timestamp序列用于趋势计算 |
| 7 | E-03 EXTERNAL_ECHO | 权威01 横切感知层 | CEO/战略看外部环境对收入归因 | E-01.scan_frequency、ExternalBaseline.market_growth | environment-rent-dependency哨兵失效；外部环境对收入的归因分析不可信 | 1.查ExternalBaseline节点是否存在market_growth字段 2.查env_rent_score是否在-1到1正常范围 3.查GA是否配置了行业基准数据 |
| 8 | E-14 DECISION_POWER | 权威01 B2断裂方式 | COO/组织看决策权力分布 | GraphStore.OWNS边和Person-Team关系 | power-rigidity/network-power哨兵失效；组织诊断结论不可信 | 1.查GraphStore中OWNS关系边是否存在 2.查decision_concentration_gini是否在0-1范围 3.查AgentObserver是否采集了Person间交互数据 |
| 9 | E-07 TALENT_ACQUISITION | 权威01 A3断裂方式 | HRVP看招聘效率 | Person节点入职时间戳、ExternalBaseline.industry_talent_supply | talent-density哨兵hiring_efficiency异常；人才诊断不可信 | 1.查Person节点是否有joined_at时间戳 2.查Team节点是否有open_positions字段 3.查ExternalBaseline中industry_talent_supply是否配置 |
| 10 | capital-health哨兵 | 权威03 S1.1 | CEO/CFO/GA告警：资本配置效率下降 | SentinelLoader注册成功、E-13/E-23/E-37边参数在线 | 资本相关异常无法被检测；利润率诊断缺失基础信号 | 1.查sentinel-registry中capital-health是否active 2.查最近check时间戳（应<24h） 3.查computeCapitalEfficiency/computeCapitalTurnover/computeDebtEquityRatio各输出是否非null |
| 11 | margin-health哨兵 | 权威03 S1.4 | CEO/CFO/GA告警：利润率/成本异常 | capital-health哨兵先决check、E-23/E-13/E-30数据源在线 | 利润率异常无法被检测；成本诊断缺失核心信号 | 1.查cost-health和profit-health旧哨兵是否已mark DEPRECATED 2.查margin-health的aggregate.ts是否正确整合两路旧逻辑 3.查computeDOL/computeBreakEven输出是否正常 |
| 12 | competitive-position哨兵 | 权威03 S1.2 | CEO/战略/GA告警：竞争位势变化 | E-33/E-36/E-31边参数在线、ExternalBaseline.competitor_market_shares | 竞争位势变化无法检测；市场战略建议缺乏数据支撑 | 1.查competitive-dynamics和market-lifecycle旧哨兵是否已mark DEPRECATED 2.查seven_powers_score是否被正确计算 3.查ExternalBaseline是否配置竞品市场份额 |
| 13 | ExpertPromptLoader (Phase 4) | 权威10 S2 | 8位专家推理能力 | expert/{name}/manifest.json存在、IDENTITY.md的analytical_lens字段完整 | 该专家推理可能出错但不阻断诊断（自动排除+WARN日志） | 1.查expert-registry.yaml中该专家是否enabled 2.查expert-prompts.ts降级为Loader后是否正常加载 3.查系统日志中该专家的初始化错误计数 |
| 14 | SentinelLoader (Phase 2a) | 权威03 + 第一章Phase 2定义 | 所有哨兵扫描和异常检测 | extensions/sentinels/*/manifest.json文件存在且格式正确 | 哨兵扫描全部不可用；诊断无基础信号输入 | 1.查manifest.json总数是否=50（含DEPRECATED标记） 2.查active哨兵数>=30 3.查sentinels/目录下是否有破损文件 |
| 15 | SkillLoader (Phase 2b) | 权威12 S3 | 所有Skill调用 | skills/builtin/*/manifest.json + SKILL.md文件存在且依赖完整 | Skill无法执行；依赖校验缺失导致Playbook假阳性失败 | 1.查Skill manifest的dependencies是否存在循环依赖 2.查每个Skill的entryPoint指向的SKILL.md是否存在 3.查是否有archived状态的Skill仍被active Playbook引用 |
| 16 | CausalChainLoader (Phase 2d) | 权威01 S5.4 | 因果链Trace/Simulate/Explain API | extensions/causal-chains/*.yaml存在、edgeSequence中每个edgeId在42边体系中有效 | 因果追溯/模拟/反查能力不可用；诊断报告缺因果链证据 | 1.查causal-chains/目录下YAML数量>=22（核心链） 2.查edgeSequence中引用有无E-43及以上(超出42边范围) 3.查链间依赖是否因某条边变更导致下游链参数断裂 |
| 17 | GraphStore初始化 (Phase 1) | 权威04 + 权威01 S3 | 所有边参数的数据源 | SQLite连接池可用、SOG-Core v1.0枚举校验通过 | 诊断无数据；所有哨兵产生null Finding；系统进入"待配置"状态 | 1.查SQLite WAL文件大小是否<100MB 2.查SOG-Core枚举值是否全部存在于GraphStore schema 3.查KnowledgeStore中industry-baselines数据是否存在 |
| 17 | 溢出监控循环 (Phase 2e CycleLoader) | 权威15  | 企业子循环溢出监控——检测子循环溢出转负 | CycleLoader成功注册所有循环配置 + 每个子循环溢出计算周期内完成 + OverflowGraphBridge写入正常 | 老板看不到子循环健康度；溢出恶化不触发Goal；投入建议引擎无数据 | 1.查CycleLoader加载状态 2.查各子循环最近溢出计算时间戳 3.查OverflowGraphBridge写入日志 |
| 18 | data-health哨兵 | 权威03 三维映射表 | GA/管理员看数据管道健康 | E-09 DATA_ACQUISITION参数在线、Document节点有timestamp序列 | 诊断精度普遍下降；所有依赖数据的哨兵输出置信度降低 | 1.查data-health哨兵最近check输出的completeness/freshness/accuracy三个子分数 2.查avg_data_age_days是否<90天 3.查error_rate是否<0.1 |

---

## 2.2 自助诊断工具：check-self-diagnosis.sh

### 2.2.1 设计目标

当GA报告"诊断结论似乎不对"时，系统运行此脚本。30秒内输出自然语言诊断结果，定位到<=3个可能故障模块。目标是减少GA找工程师的频率——80%的"诊断不准确"报告是数据管道问题，不需要工程师介入。

### 2.2.2 检查流程（六步骤，按依赖关系排序）

check-self-diagnosis.sh 的检查流程按依赖关系从底层到顶层排列：

```
check-self-diagnosis.sh
├── Step 1: 数据源在线检查 (< 5s)
│   ├── GraphStore连接正常（PRAGMA quick_check）
│   ├── 最近数据写入时间 < 预期周期×2
│   └── 输出示例: "数据源正常（Financial更新：2小时前）" 或 "CRITICAL: 数据源financial_baseline中断13天"
├── Step 2: 哨兵健康检查 (< 10s)
│   ├── 50个哨兵中active状态的百分比
│   ├── 最近一次check()成功执行的哨兵百分比
│   ├── P0/P1哨兵全部active且最近一次check成功
│   └── 输出示例: "48/50哨兵正常。⚠️ 2个P2哨兵degraded（最近一次check失败）"
├── Step 3: Loop Engineering健康检查 (< 5s)
│   ├── CronScheduler进程活跃度（不在运行->CRITICAL：五循环全部静默）
│   ├── 五循环各自的上次成功时间 vs 预期周期：
│   │   ├── 诊断循环: last_success < 14天×3 -> normal; ×3到×5 -> WARNING; >×5 -> CRITICAL
│   │   ├── 导航循环: 事件驱动（不按周期判定），检查方案级哨兵注册/注销计数器
│   │   ├── GA进化循环: last_success < 30天 -> normal; 30-60天 -> WARNING
│   │   ├── 系统自检循环: last_success < 1天 -> normal; >1天 -> CRITICAL
│   │   └── 知识积累循环: last_success < 30天 -> normal; >30天 -> WARNING
│   ├── 哨兵Finding新鲜度（间接验证诊断循环的哨兵触发链路）：最近P0/P1 Finding < 预期周期×2 -> normal; >×2 -> WARNING
│   └── 输出示例:
│       "Loop Engineering健康：五循环全部正常运行。最近诊断：7天前。最近自检：2小时前。"
│       "WARNING: 诊断循环已21天未执行（预期14天）。数据源正常，哨兵正常，边参数正常——检查diagnosis-launcher触发链路。"
├── Step 3.5: 溢出监控与趋势健康检查 (< 3s) (< 3s)
│   ├── CycleLoader是否成功加载所有循环配置
│   ├── 每个注册子循环的最近一次溢出计算时间是否在业务周期内
│   ├── 任何子循环溢出连续3周期<0 → CRITICAL
│   ├── 溢出数据是否成功写入GraphStore（OverflowGraphBridge健康）
│   └── 输出示例:
│       "溢出监控正常：4/4子循环的溢出计算在周期内。客户循环连续3月正溢出（+12%），现金流循环趋于零（-2%）。"
│       "CRITICAL: 人才循环溢出连续4周期<0。建议触发诊断循环排查人才留存。"
|   ├── Step 3.5: 溢出监控与趋势健康检查 (< 3s) (< 3s)
|   │   ├── CycleLoader加载状态——是否成功加载所有匹配企业行业的循环配置
│   ├── 每个注册子循环最近一次溢出计算时间是否在业务周期内
│   ├── 每个子循环的同比(YoY)数据是否可用（数据不足12个月→标记）
│   ├── 任何子循环溢出连续3周期<0 → CRITICAL
│   ├── 任何子循环趋势方向(trendDirection)为declining且consecutiveDirection≥2 → WARNING
│   ├── OverflowGraphBridge健康——溢出数据是否成功写入GraphStore
│   └── 输出示例:
│       '溢出监控正常：4/4子循环溢出计算在周期内。客户循环连续3月正溢出(+12%，趋势上升)。现金流趋于零(-2%，趋势下降→WARNING)。人才循环同比数据将在4个月后可用。'
│       'CRITICAL: 人才循环溢出连续4周期<0，趋势加速恶化(Kendall tau=-0.87)。建议触发诊断循环。'——是否成功加载所有匹配企业行业的循环配置
|   │   ├── 每个注册子循环最近一次溢出计算时间是否在业务周期内
|   │   ├── 任何子循环溢出连续3周期<0 → CRITICAL
|   │   ├── OverflowGraphBridge健康——溢出数据是否成功写入GraphStore
|   │   └── 输出: 正常→子循环数和溢出趋势 / CRITICAL→溢出转负的子循环和连续周期数

├── Step 4: 边参数健康检查 (< 10s)
│   ├── 42条边中hard边（>=30条）的参数覆盖率>=80%
│   ├── 每条hard边最近一次compute输出.degraded === false
│   ├── 参数值是否在normal_range内（如E-23.efficiency_rate在0.3-0.9）
│   └── 参数历史趋势——最近5次compute输出是否连续系统偏移（可能是数据源漂移）
├── Step 5: 专家加载检查 (< 3s)
│   ├── expert/{name}/manifest.json 全部存在
│   ├── expert/{name}/IDENTITY.md analytical_lens 字段完整
│   ├── buildExpertPrompt() 对每位专家可正常生成 systemPrompt
│   └── expert-registry.yaml中无循环引用
└── Step 6: 综合诊断报告生成 (< 2s)
    ├── 汇总Step 1-7的发现
    ├── 按严重度排序：CRITICAL(CronScheduler未运行/系统自检循环断裂/数据源中断) > WARNING(诊断循环断裂/导航循环异常/哨兵失活/参数偏离) > INFO(参数偏移趋势/Ga超30天未审查)
    ├── 输出综合健康评分 0-100
    └── 输出可操作的排查建议（具体到需要检查的模块/文件）
```

**关键设计决策**：
1. **Loop Engineering检查位于哨兵检查和边参数检查之间**。哨兵是Loop的子组件，但Loop本身是更高层的调度层——哨兵正常但Loop断裂意味着CronScheduler问题。Step 3失败但Step 1-2正常时，脚本必须明确区分"Loop断裂"和"数据源中断"是两个不同的根因。
2. **参数偏移vs真异常**：连续5次compute输出系统偏移（如efficiency_rate每次+0.02）可能是数据源漂移（如数据采集频率变化），不能简单标记为异常。需要和历史基线的变化率对比。
3. **依赖链检查**：Step 1失败->Step 2-4必然失败（数据源中断->哨兵无数据->compute无输出）。Step 3失败但Step 1-2正常->CronScheduler问题而非数据问题。脚本需要识别根因，不把连锁故障当独立告警报告。
├── 按严重度排序：CRITICAL(CronScheduler未运行/系统自检循环断裂/数据源中断) > WARNING(诊断循环断裂/导航循环异常/哨兵失活/参数偏离) > INFO(参数偏移趋势/Ga超30天未审查)
    ├── 输出自然语言诊断结论
    └── 如果所有check通过=输出"诊断系统健康，结论可信度高"
```

### 2.2.3 输出示例

**场景A：数据管道中断（最常见，占80%）**

```
诊断系统健康自检报告 — 2026-07-14 14:30:00
============================================

结论：[WARNING] 诊断结论可能滞后。建议联系GA检查数据管道。

详细发现：
[WARNING] 数据新鲜度不足
  - Financial最近时间戳: 2026-07-01 (距今13天)
  - 阈值: <30天 — 仍在容忍范围内但偏旧

[CRITICAL] 数据源中断
  - GraphStore中CLIENT节点最近timestamp: 2026-05-20 (距今55天)
  - 阈值: <90天 — 仍在容忍范围内但客户数据严重滞后
  - 影响: customer-demand-shift/channel-capacity/niche-breadth哨兵输出置信度下降

[INFO] 参数值在正常范围内
  - E-23.efficiency_rate = 0.72 (正常范围0.3-0.9) [OK]
  - E-05.cash_runway_months = 18 (正常范围>12) [OK]
  - E-37.profit_margin = 0.05 (正常范围>0.10) — 偏低但非异常（客户A2023已知事实）

数据源正常（Financial更新：13天前），
相关哨兵正常（capital-health: 3小时前扫描通过，margin-health: 2小时前扫描通过），
大部分底层参数在正常范围。

[WARNING] 客户数据中断55天——customer-demand-shift/cluster-health/niche-breadth三个哨兵的输出基于过时数据。
建议GA检查客户数据管道（门店POS/CRM系统集成）。
```

**场景B：系统完全健康**

```
诊断系统健康自检报告 — 2026-07-14 14:30:00
============================================

结论：[OK] 诊断系统健康，诊断结论可信度高。

数据源正常（Financial更新：2小时前，CLIENT更新：5小时前）。
相关哨兵正常（capital-health: 1小时前扫描通过，margin-health: 2小时前扫描通过）。
底层参数在正常范围（E-23.efficiency_rate=0.72, E-05.cash_runway=18月）。
8位专家全部就绪。

当前诊断结论可信度：高。无需工程师介入。
```

### 2.2.4 实现注意事项

1. **假阳性控制**：哨兵Finding归零不一定等于哨兵故障——可能是数据本身确实没有异常。需要区分"Finding=0且scan成功"和"Finding=null且scan失败"。
2. **参数偏移vs真异常**：连续5次compute输出系统偏移（如efficiency_rate每次+0.02）可能是数据源漂移（如数据采集频率变化），不能简单标记为异常。需要和历史基线的变化率对比。
3. **依赖链检查**：Step 1失败->Step 2-4必然失败。Step 3失败但Step 1-2正常->CronScheduler问题而非数据源问题——Loop断裂和数据源中断是两个不同的根因，脚本必须区分。。脚本需要识别根因，不把连锁故障当独立告警报告。
4. **输出受众**：面向GA和企业管理员，不面向工程师。避免技术术语（不写"GraphStore WAL checkpoint失败"，写"数据存储可能需要维护"）。

---

## 2.3 规模指导

**为什么只有18行？**

13份文档定义的能力超过200项。穷举矩阵会让GA和工程师都无法使用。本章的选取逻辑：

- **从故障频率倒推**：分析客户A案例中实际出现的6类故障（数据中断3次、哨兵配置错误1次、边参数越界1次、专家模板未填充1次）——这4类覆盖了80%的故障。矩阵覆盖了这4类的所有上游依赖。
- **从因果链骨干倒推**：被11条因果链引用的E-23、被5条引用的E-30/E-13/E-37——这些"骨干边"一旦出问题，下游影响面最大，排查优先级最高。
- **从启动序列倒推**：Phase 0-5的每个Loader都有一个矩阵行——Loader是系统的大脑，Loader故障是启动失败的第一根因。

如果需要排查不在矩阵中的能力，使用check-self-diagnosis.sh的Step 1-7逐层深入——数据源->哨兵->Loop工程->边参数->专家。这个排查路径适用于任何能力。

---

> **版本历史**：v1.0 — 2026-07-14 — 初始版本。18行P0能力溯源矩阵 + check-self-diagnosis.sh六步骤逻辑。
