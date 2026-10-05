<!--
  Synova 权威文档15 | 第五章：行业模板管理与GA配置工作台
  版本: v1.0 | 日期: 2026-07-14 | 作者: Synova 研究组
  定位: 施工文档——系统预置15-20个行业模板 + GA三层配置流程（无代码）+ 企业参数覆盖表存储位置
  依赖: 研究方案 v2.0 第二章/第五章、权威01 42边体系、权威14 企业本体数据
-->

# 第五章：行业模板管理与GA配置工作台

> 核心问题：子循环不是固定枚举——但也不能让每个新客户从零配置。如何在"灵活性"和"易用性"之间找到平衡？GA（总经理/管理员）怎么在不写代码的情况下，把系统配成适合自己企业的样子？
> 本章产出：15-20个系统预置行业模板清单 + GA三层配置流程（选模板→调参数→保存实例）+ 拖拽式构建新循环的规范 + 企业参数覆盖表在 L4 本体层的存储位置

---

## 5.0 三层分工模型

研究方案 §2.6 定义了三层分工。本章是三层分工的具体施工文档。

```
第一层：系统预置（15-20个行业模板）
  │  覆盖最常见行业，每个模板含该行业核心循环定义
  │  覆盖80%客户需求
  │  由 Synova 研发维护，版本控制
  │
  ▼
第二层：GA配置工作台（无代码）
  │  GA从预置模板选择 → 调整参数 → 保存为企业实例
  │  预置不满足 → 组合已有循环 → 保存为新组合
  │  组合也不满足 → 拖拽式构建新循环（边+节点+溢出公式）
  │  由 GA 操作，不涉及代码
  │
  ▼
第三层：研发深度定制（需代码）
     GA工作台无法满足 → 需要新的42边或compute函数
     属系统扩展，按标准流程新增
     由 Synova 研发实现
```

**关键设计原则**：一二层之间是"配置"（改参数，不改结构）。二三之间是"扩展"（改结构，需代码）。GA 永远不会被要求"写代码"——但可以被要求"描述需求"触发研发扩展。

---

## 5.1 第一层：系统预置行业模板（15-20个）

### 5.1.1 模板清单

每个模板覆盖一个行业，包含该行业的核心子循环 + 适用的 42 边/哨兵/compute。

| # | 模板ID | 行业 | 核心子循环 | 适用的42边（主边） | 哨兵 | Compute |
|---|--------|------|----------|------------------|------|---------|
| 1 | `restaurant-chain` | 餐饮连锁 | 现金流循环、门店复制循环、客户循环、人才循环 | E-05/E-13/E-23/E-30/E-31/E-37/E-38 | capital-health/margin-health/cash-runway/customer-demand-shift/talent-density | computeCapitalEfficiency/computeBreakEven/computeUnitEconomics |
| 2 | `retail-chain` | 零售连锁 | 现金流循环、门店复制循环、库存循环、客户循环 | E-05/E-13/E-23/E-30/E-31/E-34/E-37 | capital-health/margin-health/unit-economics/customer-demand-shift | computeCapitalEfficiency/computeUnitEconomics/computeChurnRate |
| 3 | `saas-b2b` | SaaS B2B | ARR增长循环、客户循环、产品循环、人才循环 | E-05/E-13/E-23/E-24/E-30/E-31/E-38 | capital-health/margin-health/customer-demand-shift/talent-density | computeChurnRate/computeDOL/computeNPV |
| 4 | `saas-b2c` | SaaS B2C | ARR增长循环、客户循环（含病毒传播）、产品循环 | E-05/E-13/E-23/E-24/E-30/E-31/E-40 | capital-health/margin-health/customer-demand-shift/reputation-health | computeChurnRate/computeUnitEconomics/computeEnvRent |
| 5 | `manufacturing` | 制造业 | 现金流循环、运营效率循环、采购循环、创新循环 | E-05/E-13/E-23/E-24/E-30/E-34/E-37 | capital-health/margin-health/unit-economics/make-or-buy | computeCapitalEfficiency/computeDOL/computeUnitEconomics/computeMarginalCost |
| 6 | `construction` | 建筑工程 | 工程交付循环、现金流循环、人才循环、采购循环 | E-05/E-13/E-15/E-23/E-34/E-37/E-38 | capital-health/cash-runway/unit-economics/make-or-buy | computeNPV/computeCapitalTurnover/computeProcurementEfficiency |
| 7 | `logistics` | 物流运输 | 运营效率循环、资产利用循环、客户循环、人才循环 | E-05/E-13/E-23/E-30/E-31/E-34/E-38 | capital-health/margin-health/unit-economics/customer-demand-shift | computeCapitalTurnover/computeUnitEconomics/computeDOL |
| 8 | `ecommerce` | 电商平台 | 客户循环（含获客成本）、流量循环、现金流循环、产品循环 | E-05/E-13/E-23/E-24/E-30/E-31/E-32 | capital-health/margin-health/customer-demand-shift/channel-capacity | computeChurnRate/computeUnitEconomics/computeCAC |
| 9 | `healthcare` | 医疗服务 | 患者循环、人才循环（医生/护士）、现金流循环、合规循环 | E-05/E-13/E-15/E-23/E-30/E-38 | capital-health/cash-runway/talent-density/key-person-risk | computeUnitEconomics/computeTalentDensity/computeKeyPersonScore |
| 10 | `education` | 教育培训 | 客户循环（学员LTV）、人才循环（教师）、产品循环（课程）、现金流循环 | E-05/E-13/E-15/E-23/E-24/E-30/E-31/E-38 | capital-health/margin-health/customer-demand-shift/talent-density | computeChurnRate/computeUnitEconomics/computeTalentDensity |
| 11 | `real-estate` | 房地产 | 项目开发循环、现金流循环、资产循环、客户循环 | E-05/E-06/E-13/E-23/E-30/E-31/E-37 | capital-health/cash-runway/margin-health/financing-constraint | computeNPV/computeCapitalTurnover/computeDOL |
| 12 | `fintech` | 金融科技 | 风险循环、客户循环（含信任/合规）、产品循环、人才循环 | E-05/E-06/E-13/E-23/E-24/E-30/E-31/E-38 | capital-health/cash-runway/financing-constraint/talent-density | computeDebtEquityRatio/computeChurnRate/computeNPV |
| 13 | `agriculture` | 农业/养殖 | 生产循环、现金流循环、采购循环、自然环境循环 | E-05/E-08/E-13/E-23/E-30/E-34/E-37 | capital-health/cash-runway/unit-economics/make-or-buy | computeUnitEconomics/computeMarginalCost/computeEnvRent |
| 14 | `media` | 媒体/内容 | 内容循环、流量循环、广告变现循环、人才循环 | E-05/E-13/E-23/E-24/E-25/E-30/E-38 | capital-health/margin-health/reputation-health/talent-density | computeUnitEconomics/computeChurnRate/computeCompetitivePosition |
| 15 | `professional-service` | 专业服务（咨询/律所/设计） | 人才循环、客户循环、项目交付循环、现金流循环 | E-05/E-13/E-15/E-23/E-30/E-31/E-38 | capital-health/cash-runway/talent-density/key-person-risk | computeTalentDensity/computeKeyPersonScore/computeUnitEconomics |
| 16 | `energy` | 能源 | 资产利用循环、运营效率循环、合规循环、现金流循环 | E-05/E-06/E-08/E-13/E-23/E-34/E-37 | capital-health/cash-runway/unit-economics/make-or-buy | computeCapitalTurnover/computeDOL/computeNPV |
| 17 | `biotech` | 生物科技/制药 | 研发循环、人才循环、合规循环、现金流循环 | E-05/E-06/E-13/E-23/E-24/E-38 | capital-health/cash-runway/talent-density/key-person-risk | computeNPV/computeTalentDensity/computeKeyPersonScore |
| 18 | `consumer-goods` | 消费品 | 品牌循环、渠道循环、产品循环、现金流循环 | E-05/E-13/E-23/E-24/E-25/E-30/E-31/E-32 | capital-health/margin-health/customer-demand-shift/reputation-health | computeUnitEconomics/computeChurnRate/computeCompetitivePosition |

### 5.1.2 模板文件结构

每个模板是一个 JSON 文件，位于 `cycles/industry/{industry-slug}/` 目录下。例如：

```
cycles/
├── builtin/                          # 系统预置（4个核心模板——适用于所有行业）
│   ├── cash-flow.cycle.json
│   ├── customer.cycle.json
│   ├── talent.cycle.json
│   └── product.cycle.json
├── industry/                         # 行业模板（15-20个）
│   ├── restaurant-chain/
│   │   ├── store-replication.cycle.json
│   │   ├── cash-flow.cycle.json      # 可覆盖 builtin 同名文件
│   │   └── customer.cycle.json
│   ├── saas-b2b/
│   │   ├── arr-growth.cycle.json
│   │   ├── customer.cycle.json
│   │   └── product.cycle.json
│   └── manufacturing/
│       ├── operational-efficiency.cycle.json
│       ├── procurement.cycle.json
│       └── innovation.cycle.json
└── custom/{enterpriseId}/            # 企业自定义（GA工作台产出）
    └── wowbaby/
        └── store-replication.cycle.json  # 基于行业模板的参数覆盖版
```

### 5.1.3 模板加载优先级

研究方案 §2.4 定义了加载优先级。具体实现：

```
加载顺序:
  1. cycles/builtin/          → 最低优先级
  2. cycles/industry/{slug}/  → 中等优先级（按 enterprise.industry 匹配）
  3. cycles/custom/{id}/      → 最高优先级（企业自定义）

同名 cycleId 的覆盖规则:
  - custom 覆盖 industry 覆盖 builtin
  - 部分覆盖：custom 中只需写差异字段——未写的字段从 industry/builtin 继承
  - 覆盖日志写入 L4 事件流（GraphStore event 节点）
```

---

## 5.2 第二层：GA 配置工作台（无代码三层流程）

### 5.2.1 流程概览

```
┌──────────────────────────────────────────────────────┐
│              GA 配置工作台                              │
│                                                      │
│  Step 1: 选模板                                       │
│  ┌────────────────────────────────────────────┐     │
│  │ 选择你的行业: [餐饮连锁 ▼]                    │     │
│  │ 可选商业模式: [直营 ▼]                       │     │
│  │                                              │     │
│  │ 预览: 此模板包含以下子循环:                    │     │
│  │   ✓ 现金流循环                                │     │
│  │   ✓ 门店复制循环                              │     │
│  │   ✓ 客户循环                                  │     │
│  │   ✓ 人才循环                                  │     │
│  │                                              │     │
│  │ 适用42边: E-05, E-13, E-23, E-30, E-31, ...  │     │
│  │ 适用哨兵: capital-health, margin-health, ...  │     │
│  │                                              │     │
│  │ [下一步：调整参数]                             │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  Step 2: 调参数                                       │
│  ┌────────────────────────────────────────────┐     │
│  │ 门店复制循环 — 参数调整                       │     │
│  │                                              │     │
│  │ 新店投资额:  [300,000] 元                    │     │
│  │ 单店利润目标: [80,000]  元/月                 │     │
│  │ 再投资比例:   [0.60]     (0-1)               │     │
│  │ 盈亏平衡月数: [6]        月                   │     │
│  │                                              │     │
│  │ 权重设置:                                     │     │
│  │ 客户满意度权重: [0.80]                        │     │
│  │ 单店利润权重:   [0.60]                        │     │
│  │                                              │     │
│  │ [上一步] [保存为企业实例]                      │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  Step 3: 保存为企业实例                                │
│  ┌────────────────────────────────────────────┐     │
│  │ ✓ 参数已保存                                 │     │
│  │ ✓ 存储位置: cycles/custom/wowbaby/          │     │
│  │ ✓ 企业参数覆盖表已写入 L4 本体层              │     │
│  │ ✓ 下次系统启动时自动加载                      │     │
│  │                                              │     │
│  │ [查看仪表盘] [继续配置其他循环]                 │     │
│  └────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────┘
```

### 5.2.2 模板不满足 → 组合已有循环

当预置行业模板不满足企业需求时，GA 可以通过工作台**组合已有循环**：

1. GA 浏览系统所有已注册的子循环（内置 + 行业模板中的全部循环定义）
2. 勾选适用的子循环（例如：从 SaaS B2B 模板取"ARR增长循环"，从制造业模板取"采购循环"）
3. 为每个选中的子循环调整参数
4. 保存为新组合，命名如"混合模式-SaaS+硬件"

**组合保存后的行为**：
- 新建 `cycles/custom/{enterpriseId}/` 目录
- 每个选中的子循环写入一个 `*.cycle.json`（仅包含差异字段）
- `applicableIndustries` 字段设置为 `["custom"]`
- 系统下次启动时加载此组合，而非原始行业模板

### 5.2.3 组合也不满足 → 拖拽式构建新循环

当组合已有循环仍不满足需求时，GA 通过工作台的**循环构建器**从零构建新循环。这是一个图形化界面，对标 Figma 的节点编辑器概念：

**构建器能力**：
1. **选择节点池**：从 42 边体系中选择相关边作为循环的"阀"（E-05/E-07/E-13/E-23/E-30/E-31/E-34/E-37/E-38 等）
2. **连接节点**：拖拽连线定义传导路径（边 A → 边 B → 边 C）
3. **定义溢出公式**：在公式编辑器中组合参数——从选中的 42 边参数列表中拖入变量，通过运算符组合（+/-/*//），实时预览计算结果
4. **定义 compute 调用**：从系统已注册的 compute 函数列表中选择（如 `computeUnitEconomics`），拖入公式
5. **设置数据成熟度窗口**：选择 `minimumDataWindow`（下拉：3个月/6个月/12个月/24个月）
6. **测试运行**：用企业历史数据运行一次溢出计算，验证公式是否合理

**保存后的产物**：
- 一个新的 `*.cycle.json` 文件写入 `cycles/custom/{enterpriseId}/`
- 所有使用的边 ID 必须在 42 边体系中存在（前端校验——不存在的边 ID 无法被选中）
- 所有引用的 compute contractId 必须在系统中已注册
- 保存时自动验证 schema（JSON Schema 校验——同 `cycle-loader.ts` 中的校验逻辑）

### 5.2.4 拖拽构建器的约束（防止无效循环配置）

构建器前端实施以下约束，防止 GA 创建一个"看起来合理但实际无法计算"的循环配置：

1. **溢出公式必须可计算**：公式中每个参数必须能被解析为"42边参数"或"compute 输出"或"GA 手动输入"——编辑器实时标注未解析参数
2. **传导路径不能成环**：边 A → 边 B → 边 A 的循环引用检测——如果 A 同时是 B 的前置边和后置边，构建器警告"自循环传导可能导致溢出值无限放大"
3. **必须有至少一个 42 边**：仅由 GA 手动输入参数构成的循环无法被系统自动更新——构建器要求至少一个参数来自 42 边或 compute
4. **数据成熟度窗口必须合理**：最低 3 个月——如果一个循环要求 1 个月的最小数据窗口而 42 边的数据源是季度级（E-25 BRAND_CONSTRUCTION），构建器警告"数据源频率低于循环要求"

---

## 5.3 企业参数覆盖表的存储位置

### 5.3.1 对标 Skill/Tool 的本地自适应层

研究方案 §2.5 明确了企业参数覆盖表的位置："L4 本体层 Enterprise 节点"。对标 Skill/Tool 体系中的"企业本地配置文件"概念——GA 修改的不是系统代码，是存储在本体层中的企业节点属性。

### 5.3.2 存储位置：L4 本体层 Enterprise 节点属性

```
GraphStore
  │
  └── graph_nodes
        │
        └── type='Enterprise', id='wowbaby'
              │
              └── properties:
                    ├── name: "客户A母婴用品"
                    ├── industry: "retail-chain"
                    ├── subIndustry: "母婴用品"
                    ├── businessModel: "直营连锁"
                    │
                    ├── cycleOverrides: {          ← 企业参数覆盖表
                    │     "store-replication": {
                    │       "parameters": {
                    │         "newStoreInvestment": 300000,
                    │         "storeProfitTarget": 80000,
                    │         "reinvestmentRatio": 0.6,
                    │         "breakevenMonths": 6
                    │       },
                    │       "weights": {
                    │         "customerSatisfaction": 0.8,
                    │         "storeProfit": 0.6
                    │       },
                    │       "lastModifiedBy": "GA",
                    │       "lastModifiedAt": "2026-07-14T10:00:00Z"
                    │     },
                    │     "cash-flow": {
                    │       "parameters": { ... }
                    │     }
                    │   }
```

### 5.3.3 TypeScript Interface

```typescript
/**
 * EnterpriseCycleOverrides — 企业参数覆盖表。
 *
 * 存储位置: GraphStore graph_nodes.properties.cycleOverrides
 * 实体: Enterprise 节点（type='Enterprise'）
 * 读写: GA 工作台（写）/ CycleRegistry（读）/ 溢出计算管线（读）
 *
 * @layer L4 (本体层)
 * @persistence graph_nodes.properties (JSON 列)
 */
export interface EnterpriseCycleOverrides {
  /** 按 cycleId 索引的参数覆盖 */
  [cycleId: string]: {
    /** 参数覆盖（仅覆盖与行业模板不同的参数） */
    parameters: Record<string, number | string | boolean>;

    /** 权重覆盖 */
    weights?: Record<string, number>;

    /** 自定义传导路径（仅当企业需要不同于模板的传导路径时） */
    customPropagation?: {
      from: string;
      to: string;
      via: string;
      estimatedLag: string;
    };

    /** 修改元数据 */
    lastModifiedBy: string;
    lastModifiedAt: string;
    modificationNotes?: string;
  };
}
```

### 5.3.4 参数覆盖的合并逻辑

当 `CycleRegistry` 加载子循环配置时，合并优先级：

```typescript
function resolveCycleConfig(
  cycleId: string,
  enterpriseId: string
): ResolvedCycleConfig {
  // 1. 加载行业模板（或内置模板）作为基础
  const baseConfig = loadFromIndustryOrBuiltin(cycleId, enterpriseId);

  // 2. 检查企业参数覆盖表
  const overrides = getEnterpriseCycleOverrides(enterpriseId)?.[cycleId];

  if (!overrides) {
    return baseConfig; // 无覆盖 → 使用行业模板默认值
  }

  // 3. 深度合并：overrides.parameters 覆盖 baseConfig 中同名参数
  return {
    ...baseConfig,
    parameters: {
      ...baseConfig.parameters,
      ...overrides.parameters,
    },
    weights: {
      ...baseConfig.weights,
      ...overrides.weights,
    },
    // 自定义传导路径完全替换（非合并——因为路径是独立的配置单元）
    crossCyclePropagation: overrides.customPropagation
      ? [overrides.customPropagation]
      : baseConfig.crossCyclePropagation,
  };
}
```

---

## 5.4 GA 工作台 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/ga/templates` | GET | 获取所有可用行业模板列表 |
| `/api/ga/templates/{templateId}` | GET | 获取指定模板的完整配置（含子循环清单） |
| `/api/ga/cycles/available` | GET | 获取系统所有已注册子循环（供组合模式使用） |
| `/api/ga/enterprise/{id}/cycles` | GET | 获取当前企业已配置的子循环及参数 |
| `/api/ga/enterprise/{id}/cycles/{cycleId}` | PUT | 更新企业参数覆盖表 |
| `/api/ga/enterprise/{id}/cycles/{cycleId}` | POST | 新建企业自定义子循环（拖拽构建器产出） |
| `/api/ga/enterprise/{id}/cycles/{cycleId}` | DELETE | 删除企业自定义子循环（仅限 custom/ 目录下的） |
| `/api/ga/enterprise/{id}/cycles/test` | POST | 测试运行——用历史数据验证溢出公式 |

---

## 5.5 模板版本管理与迁移

行业模板由 Synova 研发团队维护。当模板更新（如新增42边、调整溢出公式），需要处理已使用旧模板的企业：

1. **非破坏性更新**：新增参数 → 企业自动继承新参数（因为企业参数覆盖表只覆盖差异字段）
2. **破坏性更新**（如溢出公式结构变化）：系统标记 `templateVersion` 不匹配 → GA 工作台显示"模板已更新"通知 → GA 可选择"采用新模板"或"保留旧版本"
3. **版本记录**：每次模板更新写入 `cycles/industry/{slug}/CHANGELOG.md`

---

> **版本历史**：v1.0 — 2026-07-14 — 初始版本。18个行业模板 + GA三层配置流程 + 企业参数覆盖表L4存储位置。