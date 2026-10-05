<!--
  Synova 权威文档14 | 第五章：跨文档术语字典与跨层级映射
  版本: v1.0 | 日期: 2026-07-14 | 作者: Synova 研究组
  定位: 施工文档——12份文档由不同时间不同人写成，同一个概念有多少种叫法？同一物理事实在四个抽象层级之间怎么映射？
-->

# 第五章：跨文档术语字典与跨层级映射

> 核心问题：12份文档由不同时间、不同人写成，同一个概念有多少种叫法？同一物理事实在四个抽象层级的不同表述之间怎么映射？
> 本章产出：18行术语平面对齐表 + 12行跨层级映射表 + 命名规范与新增术语审批流程

---

## 5.0 为什么需要术语字典

13份权威文档是纵向切片——每份深挖一个技术层。但不同文档的作者在同一时间、用不同的术语描述同一物理事实。对新工程师来说，这是最大的认知障碍：

- 权威01说"断裂点"，权威07说"循环"，权威13说"介入节点"——三份文档在说同一个东西。
- 同一个E-23的fixed_cost_ratio，在表达层是"固定成本占比过高"，在哨兵层是"cost-health severity=P1"，在存储层是"Financial.fixed_cost_ratio > 0.6"。
- 如果不把这些等价关系显式化，新工程师需要遍历13份文档才能理解系统全景——这是30分钟理解门槛变成30天学习曲线的原因。

本章是13+1文档体系的"罗塞塔石碑"——从用户界面语言一路追溯到数据库字段路径。

---

## 5.1 平面对齐表（18个核心术语）

| # | 标准术语 | 定义 | 权威01变体 | 权威07变体 | 权威13变体 | 其他变体 | 已废弃术语 |
|---|---------|------|-----------|-----------|-----------|---------|-----------|
| 1 | 断裂点 | 企业价值循环中可能断裂的位置（获取/配置/转化/交付/回流） | 断裂点 | 循环（B1-B5） | 介入节点 | growth bottleneck, fracture point | — |
| 2 | 因果边 | 定义A->B因果传导的计算单元，含transfer_function和参数语义 | 因果边/边 | 边 | — | causal edge, transfer edge, causal link | 因果链（因果链现在指多条边的串联编排，不再与单条边混用） |
| 3 | 因果链 | 多条因果边的串联编排，表达层实体。YAML文件存储。 | 因果链（权威01 §5） | — | — | causal chain, edge sequence | — |
| 4 | 表达层实体 | 用户可理解的自然语言概念（客户/产品/团队/现金流/渠道/供应链/技术/数据/决策/事件） | 表达层实体 | — | — | 自然语言实体, NL entity | — |
| 5 | 存储层节点池 | GraphStore中的15个物理存储单元（CAPITAL_POOL/HUMAN_CAPITAL_POOL/DATA_POOL等） | 节点池/存储层/15节点池 | — | — | 概念节点池, node pool, storage pool | SOG节点（SOG-Core是底层枚举，节点池是上层聚合） |
| 6 | 哨兵 | 持续监测特定维度的异常检测器。Cron触发->check->产生Finding。 | 哨兵 | 哨兵 | 方案级哨兵/方案哨兵 | sentinel, monitor, anomaly detector | 告警器（容易与GA告警混淆） |
| 7 | 方案级哨兵 | 追踪特定Goal执行效果的哨兵，消费Goal的measurement.sourceId | — | — | 方案级哨兵/方案哨兵/plan sentinel | goal sentinel, plan tracker | — |
| 8 | 主Agent | L2编排层的核心调度器。负责ConversationEngine/fde-diagnosis/sentinel-orchestration。 | 主Agent | 主Agent | 主Agent | 编排器, Orchestrator, host agent | — |
| 9 | compute函数 | 读取边参数->执行数学计算->返回结构化输出的纯函数。contractId唯一标识。 | compute/compute函数 | — | — | computation unit, calculator | 计算器（过于通用） |
| 10 | Skill | 由Tool组合而成的可执行任务单元。manifest.json声明依赖/权限/专家归属。 | — | Skill | — | capability, agent skill | 能力（capability现在专指CAPABILITY节点） |
| 11 | Playbook | 多步骤诊断/执行流程的编排定义。YAML文件。trigger条件+steps序列+experts。 | — | — | Playbook | workflow, diagnosis pipeline | — |
| 12 | transfer_function | 因果边的数学计算函数。从输入参数到输出参数的映射。 | transfer_function | — | — | compute logic, causal function | — |
| 13 | 硬度 | 边的可计算性分级：hard(参数覆盖率>=80%)/soft(50-80%)/heuristic(<50%) | 硬度 | — | — | hardness, computability grade | — |
| 14 | Finding | 哨兵scan产生的结构化发现。含severity(P0-P3)+evidenceRefs+confidence。 | — | 哨兵Finding | 方案哨兵Finding | alert, anomaly signal | 告警（Finding比"告警"更中性——不是所有Finding都需要告警） |
| 15 | 证据链 | 从原始数据到诊断结论的完整溯源路径。EvidencePool + Corroboration。 | 证据链 | — | — | evidence trail, lineage | — |
| 16 | GA | 企业管理员。配置数据源、审核诊断报告、接受告警、触发诊断。 | GA | GA | GA | enterprise admin, operator | — |
| 17 | ME（管理经济学） | 博弈论/信息经济学/代理理论的系统化应用。注入到哨兵阈值和专家推理中。 | ME/管理经济学 | — | — | managerial economics, game theory layer | — |
| 18 | 客户A | Synova的第一个真实企业案例。母婴用品品牌/贸易公司。零基验证的数据来源。 | 客户A/客户A | — | — | Wani Baby, WNB, 基准企业 | — |

---

## 5.2 跨层级映射表（12个核心术语）

同一个物理事实，在四层架构的不同表述。对于新工程师，这张表是他们理解系统的"罗塞塔石碑"——从最熟悉的用户界面语言一路追溯到数据库字段路径。

| # | 标准术语 | 表达层（用户看到） | 因果层（权威01） | 哨兵层（权威03） | 存储层（GraphStore） |
|---|---------|------------------|----------------|----------------|-------------------|
| 1 | 成本结构硬化 | "您的固定成本占比过高，达到72%" | E-23: fixed_cost_ratio↑ -> operating_leverage↑ -> profit_volatility↑ | margin-health severity=P1; sentinel-operating-leverage DOL>3.0 | CAPITAL_POOL.fixed_cost_ratio = 0.72; PRODUCTION.efficiency_rate = 0.72; Financial节点中fixed vs variable分类 |
| 2 | 客户流失加速 | "您的客户正在流失，进店率下降了40%" | E-31: churn_rate↑ -> revenue↓ -> brand_strength↓ | customer-demand-shift severity=P1; competitive-position moat_strength↓ | CLIENT节点churn_rate = 0.15; CLIENT.entityType='external'; CLIENT.timestamp序列 |
| 3 | 利润下降 | "Q2利润下降了15%，利润率从18%降到9%" | E-30: margin_rate↓ -> E-37: profit_margin↓ -> retention_ratio↓ | margin-health severity=P0; unit-economics unit_margin↓ | Financial.amount(financialType='revenue')和('cost')时间序列差值; FINANCIAL.profit_margin = 0.05 |
| 4 | 决策集中 | "决策权过于集中于老板一人" | E-14: concentration_gini↑ -> decision_latency↑ -> allocation_efficiency↓ | power-rigidity severity=P1; network-power centrality>阈值 | PROCESS.OWNS关系边密度; PERSON.decision_maker标签 |
| 5 | 原材料涨价 | "玻璃和金属原材料成本上涨了15%" | E-34: procurement_bargaining_power↓ -> E-23: unit_cost↑ -> E-30: margin_rate↓ | make-or-buy supplier_reliability<0.7; margin-health unit_cost↑>10% | ACTIVITY_POOL/PRODUCTION.unit_cost时间序列; Risk.riskType='supplier' |
| 6 | 人才流失 | "3位核心工艺工程师离职，新品研发周期延长" | E-38: turnover_rate↑ -> E-41: key_person_score↓ -> E-20: knowledge_share_rate↓ -> E-23: efficiency_rate↓ | key-person-risk severity=critical(backup_ratio<1.0); talent-density turnover_rate>0.2 | PERSON节点joined_at/departed_at时间戳; TEAM.teamType标签 |
| 7 | 品牌价值下降 | "品牌搜索量下降了60%，新增代理商无法招募" | E-25: brand_strength↓ -> E-31: client_retention↓ -> E-07: employer_attractiveness↓ | competitive-moat severity=warning; brand-health brand_awareness↓ | BRAND_POOL.brand_strength; CLIENT节点referral_source; ExternalBaseline.brand_rank |
| 8 | 现金流健康 | "现金流跑道18个月，暂无断裂风险" | E-05: cash_runway_months=18 -> E-37: retention_ratio=0.10 | cash-runway severity=info; capital-health allocation_efficiency=0.7 | CAPITAL_POOL.cash_reserve; Financial.amount时间序列 |
| 9 | 竞争位势评估 | "您在质量维度仍有优势，但OEM转型削弱了差异化" | E-36: seven_powers_score↓ -> moat_strength↓ -> E-33: market_share↓ | competitive-position severity=P1(seven_powers_score<0.4); competitive-moat severity=warning | ExternalBaseline.competitor_market_shares; MARKET_POSITION节点 |
| 10 | 外部环境逆风 | "母婴市场整体下行了8%，这是利润下滑的部分原因" | E-03: env_rent=负值 -> market_growth=-8% | environment-rent-dependency severity=warning | ExternalBaseline.market_growth = -0.08; ExternalBaseline.baseline_growth |
| 11 | 数据不完整 | "您的品牌、组织和客户数据几乎为零，诊断精度受限" | E-09: completeness≈0.45; freshness≈0.75; accuracy≈0.90 | data-health severity=warning(completeness<0.7) | Document.timestamp序列; KnowledgeChunk节点覆盖率; Document.docType标签完整性 |
| 12 | 增长导航目标 | "目标：6个月内将利润率恢复到12%" | Goal: target=margin_rate=0.12; sourceId=E-30 | plan-profit-improvement方案哨兵; 偏离检测 | GOAL.goalType='north_star'; GOAL.measurement.sourceId='E-30'; Goal.progress时间序列 |

---

## 5.3 命名规范

### 5.3.1 强制规则

后续所有文档和代码中的术语必须引用本字典的**标准术语**列。以下规则在pre-commit hook中物理强制：

1. **新增文档的术语审计**：新文档提交时，pre-commit hook检查文档中是否出现了本字典的"已废弃术语"列中的任何词。出现 -> 阻断commit，提示使用标准术语。
2. **代码注释的术语一致性**：JSDoc/TSDoc中的术语必须使用标准术语。"因果链"不能写成"causal chain"（除非在类名/变量名中）。代码中的英文标识符（edgeId/sentinelId等）不受此限。
3. **API文档/用户界面文本**：面向用户的语言使用表达层术语（如"利润下降"），面向工程师的语言使用因果层/哨兵层术语（如"E-37.profit_margin↓"）。

### 5.3.2 新增术语审批

新增术语需要经过审批流程——确认该术语不与已有标准术语冲突：

1. **提案**：开发者在docs申请求中说明新术语的名称、定义、适用上下文、是否与其他已有术语冲突
2. **审查**：术语字典维护者（权威文档14的作者或指定GA）审核：
   - 该概念是否已被已有标准术语覆盖？（如果是 -> 拒绝新增，使用已有术语）
   - 该概念是否在"已废弃术语"中有等价表达？（如果是 -> 拒绝新增，恢复使用标准术语）
   - 该概念是否确实全新且无法用已有术语组合表达？（如果是 -> 批准新增）
3. **注册**：批准后更新本字典（新增标准术语行），更新system-registry.json的术语注册表

### 5.3.3 已废弃术语处理

已废弃术语列入"已废弃术语"列，标注为"已废弃，请使用XX"。在以下时机检查废弃术语引用：

- pre-commit hook：文档中检测到废弃术语 -> warning（不阻断，但持续提醒）
- L3语义检查（第三章）：扫描全量文档的废弃术语出现次数 -> 生成合规报告

---

## 5.4 术语字典的维护生命周期

| 阶段 | 触发 | 行动 |
|------|------|------|
| 初始发布 | 权威文档14 v1.0 | 18条标准术语+12条跨层级映射发布 |
| 增量更新 | 新权威文档发布/旧文档修订 | 新增术语 -> 审批 -> 注册。每季度review一次全量术语的"已废弃"列表 |
| 语义冲突发现 | L3检查/工程师反馈 | 两个独立文档使用同一术语表达不同概念 -> 仲裁 -> 拆分或合并 |
| 全量重审 | 42边体系版本升级(v1->v2) | 所有术语的"权威01变体"列可能变化 -> 全量重审跨层级映射表的正确性 |

---

> **版本历史**：v1.0 — 2026-07-14 — 初始版本。18行平面对齐表 + 12行跨层级映射表 + 命名规范 + 新增术语审批流程。
