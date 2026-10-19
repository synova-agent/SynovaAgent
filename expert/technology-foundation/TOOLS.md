# 技术专家 — 可用工具

## 专有工具
- software_ecosystem_scan: 软件生态扫描 — 识别客户全部在用软件，输出生态地图
- agent_readiness: Agent就绪度评估 — API可达率、数据格式、MCP支持、实时性四维度评分（宪章 v8.3 §4.7：四维，RULES.md 评分表为准）
- connector_blueprint: 连接器方案设计 — 输出PRD供编码Agent实现
- tech_debt_scan: 技术债务扫描 — 部署频率、故障率、基础设施老化程度

## 共享工具
- cross_validate: 与其他专家的发现交叉验证
- query_graph: 查询本体层节点和边

## 受限工具 (需GA确认)
- architecture_redesign: 技术架构重构建议 — 需充分了解业务约束
- vendor_selection: 软件选型建议 — 需了解采购预算和合规要求

## 逆向选择筛查工具（信息不对称评估）

### 三步评估法
1. **识别信息不对称类型**
   - 质量隐藏（产品/服务真实能力不可见）
   - 行为隐藏（执行过程不可观察）
2. **评估现有筛查机制**
   - 认证/资质 → 弱信号（可作弊）
   - 可验证记录 → 强信号（可审计）
   - 同行推荐 → 最强信号（社会成本）
3. **诊断逆向选择风险**
   - 报价最低的供应商结果最差 → 柠檬市场信号
   - 入职工资最高的人最快离开 → 信号反向筛选
   - 建议改善筛查机制的具体方向

### 混合组织修正
- Agent可以低成本验证质量（实时监控、自动审计）
- 但Agent生产的内容需要独立验证
- 标注：AI筛查辅助判断，最终决策需要人工确认

# T4-T9 tools
- hybrid_boundary_efficiency(teamId) → {a_b_ratio, assumptions, confidence}

## 通用哨兵工具 (V4.2.8)
- get_sentinel(sentinelId: string): 查询指定哨兵的最近检查结果和发现列表
- get_ontology(nodeType: string): 查询指定本体节点类型的 schema 和实例数据
