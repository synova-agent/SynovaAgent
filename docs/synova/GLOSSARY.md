---
title: "Synova 术语字典（罗塞塔石碑）"
version: "1.0.0"
updated: "2026-07-15"
category: "基础设施"
aliases: "术语表 / 跨层级映射 / 命名规范"
---

# Synova 术语字典 — 罗塞塔石碑

> 第14份权威文档第五章 §5.1-§5.3。
> 定位：从用户界面语言追溯到数据库字段路径。新工程师 30 分钟理解系统全景。
> **所有后续文档和代码必须引用本标准术语。** 新增术语须经审批流程注册。

---

## 一、18 个核心术语（平面对齐）

| # | 标准术语 | 定义 | 别名/变体 | 已废弃术语 |
|---|---------|------|-----------|-----------|
| 1 | **断裂点** | 企业增长系统中最关键的瓶颈——干预后产生最大系统改善的单一节点。**断裂点=循环=介入节点**，三者同义。 | 循环(权威13)、介入节点、Breakpoint | — |
| 2 | **因果边** | 两节点之间的因果方向连线，带 transfer_function 参数。**因果边≠因果链**——边是基元，链是序列。 | Causal Edge、E-XX(编码)、42边 | 因果弧(已废弃，使用"因果边") |
| 3 | **因果链** | 多条因果边的有序序列，描述"因→果"的完整传导路径。**因果链≠因果边**。 | Causal Chain、传导路径 | 因果路径(已废弃，使用"因果链") |
| 4 | **表达层实体** | 用户/GA 在界面上看到的业务概念实体（如"成本结构""客户流失"）。 | 用户层实体、Expression Entity | — |
| 5 | **存储层节点池** | GraphStore 中存储图节点的物理空间，按语义域分池（growth/diagnosis/enterprise）。 | 节点池、Node Pool、存储域 | — |
| 6 | **哨兵** | 定时执行的独立检查单元，监控特定维度（系统健康/数据质量/风险等）。**哨兵≠告警器**——哨兵是诊断单元，告警是其下游产物。 | Sentinel、Sentinel/全局哨兵 | 告警器、监控器(已废弃，使用"哨兵") |
| 7 | **方案级哨兵** | 为特定 Goal 注册的专用哨兵，三因子偏离检测（阈值/趋势/基线）。命名空间 `goal-{goalId}-`。 | 方案哨兵、GoalSentinel、Goal-level Sentinel | — |
| 8 | **主Agent** | 用户对话的前端入口，负责意图识别、专家调度、结果转述。系统唯一的对话接口。 | 主持人(host)、ConversationEngine、Router Agent | ChatBot(已废弃，使用"主Agent") |
| 9 | **compute函数** | 纯数学变换函数，以 GraphStoreReader 为输入，输出量化指标。不碰数据库，纯图遍历+公式。 | Compute Function、计算模块、COMPUTE-v1 | 测量器、Metric Calculator(已废弃) |
| 10 | **Skill** | 可复用的能力封装单元，含 manifest.json + 执行逻辑。MCP 协议/提示词注入/工具调用三选一接口。 | Skill、技能 | 插件(Plugin)、能力包(已废弃) |
| 11 | **Playbook** | 按步骤编排的执行剧本，绑定哨兵触发条件。支持条件分支和失败处理。 | 剧本、Playbook Definition | — |
| 12 | **transfer_function** | 因果边的参数化定量函数，描述"因"如何映射为"果"。硬度是该函数的二阶参数。 | transfer function、传递函数 | — |
| 13 | **硬度** | edge.transfer_function.params.hardness——衡量因果关系的刚性程度。高硬度=强约束（几乎不可改变）。 | Hardness、因果刚性 | — |
| 14 | **Finding** | 哨兵/专家诊断的最小输出单元。含 severity/title/description/evidence。多个 Finding 聚合为信号。 | 发现、SentinelFinding | 告警信号(已废弃，使用"Finding") |
| 15 | **证据链** | 一条 Finding 从"原始数据→compute→证据→发现"的完整追溯路径。 | 证据线、Evidence Chain | — |
| 16 | **GA** | Growth Advisor（增长顾问）的缩写（创始人裁决 2026-09-04）。系统的主要操作者——配置诊断、审批 Goal、查看仪表盘。 | 前身术语 FDE（前线部署工程师，已退役并入 GA） | — |
| 17 | **ME（管理经济学）** | 管理经济学——系统的理论基础。每一条因果边的 transfer_function 均源于管理经济学实证研究。 | 管理经济学、Managerial Economics | — |
| 18 | **客户A** | 系统 MVS 阶段的示例企业客户。用于演示/golden 数据集/回归测试。企业 ID: `wowbaby`。 | client-a、Wani Baby、MVS Client | — |

---

## 二、12 个跨层级映射表

同一物理事实在系统四个抽象层级中的对应表述。

### 映射 1：成本结构硬化
| 层级 | 表述 |
|------|------|
| **表达层**（用户看到） | "固定成本占比太高，降不下来" |
| **因果层**（权威01） | `E-3.5 fixed_cost_ratio > 0.6, hardness > 0.7` |
| **哨兵层**（权威03） | `F5_fixed_cost_rigidity` 哨兵, `cost_structure` 维度 |
| **存储层**（GraphStore） | `node(FINANCIAL).costCenter[].fixedCostRatio`, `edge(COST_DRIVEN_BY).transfer_function.params.hardness` |

### 映射 2：客户流失加速
| 层级 | 表述 |
|------|------|
| **表达层** | "老客户走得越来越快" |
| **因果层** | `E-2.6 churn_rate 连续 3 期上升, E-2.5 satisfaction → churn 因果链激活` |
| **哨兵层** | `T4_customer_dynamics` 哨兵, `customer_churn` 维度 |
| **存储层** | `node(CUSTOMER).churnRateTrend`, `edge(DRIVEN_BY).with direction=negative` |

### 映射 3：利润下降
| 层级 | 表述 |
|------|------|
| **表达层** | "赚的钱越来越少了" |
| **因果层** | `E-1.2 profit_margin 下降, E-1.5 cost → margin 因果链` |
| **哨兵层** | `F1_profit_health` 哨兵, `margin_trend` 维度 |
| **存储层** | `node(FINANCIAL).profitMargin`, `edge(COST_DRIVEN_BY).transfer_function.slope` |

### 映射 4：决策集中
| 层级 | 表述 |
|------|------|
| **表达层** | "所有决策都在老板那，下面的人等指示" |
| **因果层** | `E-4.1 decision_centralization, E-4.2 info_flow` |
| **哨兵层** | `O1_info_distortion` 哨兵, `decision_making` 维度 |
| **存储层** | `node(ORG).governanceModel.decisionCentralization`, `edge(INTERACTS_WITH).direction=top_down` |

### 映射 5：信号感知
| 层级 | 表述 |
|------|------|
| **表达层** | "市场变了但我们没感觉到" |
| **因果层** | `E-0.1 signal_perception, E-0.2 signal_to_action 延迟` |
| **哨兵层** | `O2_signal_perception` 哨兵, `information_flow` 维度 |
| **存储层** | `node(CAPABILITY).signalPerception`, `edge(PROVIDES).with latency` |

### 映射 6：资本效率
| 层级 | 表述 |
|------|------|
| **表达层** | "投进去的钱没产生足够回报" |
| **因果层** | `E-2.1 capital_efficiency, E-2.2 roi_trend` |
| **哨兵层** | `F2_capital_efficiency` 哨兵, `capital` 维度 |
| **存储层** | `node(FINANCIAL).capitalEfficiency`, `edge(GENERATES).transfer_function.roi` |

### 映射 7：人才密度
| 层级 | 表述 |
|------|------|
| **表达层** | "关键岗位上的人能力不够" |
| **因果层** | `E-4.3 talent_density, E-4.4 key_person_risk` |
| **哨兵层** | `O5_talent_density` 哨兵, `talent` 维度 |
| **存储层** | `node(ORG).talentDensityScore`, `edge(OWNS).with busFactor` |

### 映射 8：技术债务
| 层级 | 表述 |
|------|------|
| **表达层** | "系统越来越难改，加个功能要改三个月" |
| **因果层** | `E-1.6 tech_debt, E-5.1 maintenance_burden` |
| **哨兵层** | `T1_software_health` 哨兵, `tech_debt` 维度 |
| **存储层** | `node(TECH).techDebtRatio`, `edge(DEPENDS_ON).with complexityScore` |

### 映射 9：品牌力衰减
| 层级 | 表述 |
|------|------|
| **表达层** | "客户不再认我们的品牌了" |
| **因果层** | `E-2.7 brand_power, E-2.8 customer_perception` |
| **哨兵层** | `T7_brand_health` 哨兵, `brand` 维度 |
| **存储层** | `node(MARKET).brandEquityScore`, `edge(INFORMS).with perceptionLag` |

### 映射 10：渠道效率
| 层级 | 表述 |
|------|------|
| **表达层** | "花了那么多渠道费用，没什么效果" |
| **因果层** | `E-2.9 channel_efficiency, E-2.10 cac_trend` |
| **哨兵层** | `T5_channel_efficiency` 哨兵, `channel` 维度 |
| **存储层** | `node(MARKET).channelROI`, `edge(REVENUE_FROM).with cacPaybackPeriod` |

### 映射 11：供应链
| 层级 | 表述 |
|------|------|
| **表达层** | "供应链经常断，备货周期越来越长" |
| **因果层** | `E-3.1 supply_chain, E-3.6 inventory_turnover` |
| **哨兵层** | `S1_supply_chain` 哨兵, `supply_chain` 维度 |
| **存储层** | `node(PROCESS).supplyChain`, `edge(DEPENDS_ON).with leadTime` |

### 映射 12：组织惯性
| 层级 | 表述 |
|------|------|
| **表达层** | "推不动改革，怎么提建议都没用" |
| **因果层** | `E-4.5 org_inertia, E-4.6 change_resistance` |
| **哨兵层** | `O6_org_inertia` 哨兵, `organizational` 维度 |
| **存储层** | `node(ORG).inertiaScore`, `edge(RESISTS).with frictionCoefficient` |

---

## 三、命名规范

### 3.1 通用规则

1. **标准术语优先**：所有文档、代码注释、API 文档、用户界面必须使用本字典定义的标准术语。
2. **别名映射**：已废弃术语不得在新文档中使用。已有文档中的别名建议在下次修订时替换。
3. **中英文对照**：中文术语后括号标注英文标准名（如"哨兵(Sentinel)"）。代码中使用英文，文档使用中文。

### 3.2 编码规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 因果边 | `E-{大版本}.{小版本}` | E-3.5, E-2.6 |
| compute函数 | `COMPUTE-{名称}-v{版本}` | COMPUTE-DOL-v1 |
| 哨兵 | `{域}_{维度}` | F1_KZ, O1_info_distortion |
| Skill | `{领域}-{动词}-{名词}` | diagnose-cashflow-health |
| Playbook | `PB-{领域}-{场景}` | PB-finance-cashflow-crisis |
| Goal | `goal-{UUID}` | goal-a1b2c3d4 |
| 节点类型 | `{语义域大写}` | FINANCIAL, CUSTOMER, ORG |
| 边类型 | `{动作}_{方向}` | COST_DRIVEN_BY, REVENUE_FROM |

### 3.3 新增术语审批流程

所有新增术语必须经过以下 4 步审批：

```
Step 1: 确认不冲突
  └─ 在 GLOSSARY.md 中搜索拟用术语是否已存在
  └─ 在代码库中 grep 拟用术语是否已被使用不同含义
  └─ 在 docs/ 中搜索拟用术语是否在权威文档中已有定义

Step 2: 注册到 GLOSSARY
  └─ 填写标准术语定义（中英文）
  └─ 标注别名/变体（如有）
  └─ 标注废弃的旧术语（如适用）

Step 3: 更新仪表盘（如适用）
  └─ 新术语需要出现在仪表盘时，更新 INDEX.md
  └─ 新术语涉及跨层级映射时，追加到§二映射表

Step 4: 发布通知
  └─ 在 CHANGELOG 中标注新术语
  └─ 通知团队更新相关文档
```

### 3.4 已废弃术语清单

| 已废弃术语 | 替换为 | 废弃原因 | 废弃版本 |
|-----------|--------|---------|---------|
| 告警器/监控器 | 哨兵(Sentinel) | 哨兵是诊断单元，告警是下游产物 | v4.3 |
| 测量器/Metric Calculator | compute函数 | 文件化统一 | v4.4 |
| 插件(Plugin) | Skill | Skill-Tool 体系规范 | v4.4 |
| 因果弧 | 因果边(Causal Edge) | 与 42 边体系对齐 | v4.4 |
| 因果路径 | 因果链(Causal Chain) | 精确描述"链"的序列语义 | v4.4 |
| ChatBot | 主Agent(ConversationEngine) | Agent 定位明确 | v4.2 |
| 告警信号 | Finding | 语义精确化 | v4.3 |
| 能力包 | Skill | Skill-Tool 体系规范 | v4.4 |

---

## 四、版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-07-15 | 初始创建 — 18个核心术语 + 12个跨层级映射 + 命名规范 |
