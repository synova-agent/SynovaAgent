<!--
  SYNOVA-RESEARCH: Skill-Tool体系研究 — 研究方案 v2.0
  Date: 2026-07-16
  Status: 研究方案 (待执行)
  Predecessors: 12份权威文档 (哨兵/计算/本体/专家提示词/Agent工程对标/安全隐私/数据层/测试体系/部署运维/管理经济学等)
-->

# SYNOVA-RESEARCH: Skill-Tool体系研究 — 研究方案 v2.0

> **核心命题**: 诊断是手段，目的是增长。前12份权威文档定义了诊断基础设施（哨兵/计算/本体/专家/数据流），但Agent的实际能力需要通过Skill/Tool体系来承载 — 将"基础设施能力"转化为"可执行、可组合、可进化的诊断行为"。

---

## §0 研究背景

### 0.1 Synova当前状态

Synova是一个驻扎企业的AI诊断Agent，核心问题始终是：**这家企业的增长卡在哪里？现在该做什么？**

前12份权威文档已建立完整的诊断基础设施：

- **哨兵层** (extensions/sentinels/*/): 44个活跃哨兵 + 13个_extinct，42维边缘类型本体 (extensions/ontology/edge-types/*/)
- **计算层** (extensions/sentinels/*/computes/): 25+测量器（如compute-break-even.ts、compute-power-rigidity.ts），每个有独立测试文件
- **本体层** (extensions/ontology/): 11种资源类型 + 8种成果类型 + 9种活动类型，edge-consumption-map.json维护边-哨兵映射
- **专家层**: 8位专家 (strategy/org/finance/tech/marketing/action/business_model/knowledge)，通过src/expert-platform/store.ts注册，src/tools/*-expert-tools.ts定义专家专属工具
- **数据流**: 原始数据 → 本体层(电子病历) → 7维度×25测量器(compute) → 按需(FDE触发)/定时(Cron触发) → Evidence池 → 信号聚合引擎 → 交叉关联+严重度升级+专家路由 → 8位专家ReAct推理+交叉验证 → 综合诊断报告

**已具备但未体系化的能力组件**:

- extensions/skills/builtin/*/: 41个Skill目录，每个含manifest.json + SKILL.md — 文件驱动加载 (src/skill/skill-loader.ts)，优先级覆盖 (custom > industry > builtin)，全局单例 skillRegistry (src/skill/skill-registry.ts)
- extensions/playbooks/builtin/*.yaml: 21个Playbook YAML，含PB-cross-margin-erosion.yaml(跨专家)、PB-finance-cashflow-crisis.yaml等 — src/playbook/playbook-loader.ts YAML解析+缓存，playbookRegistry全局单例
- src/tools/tool-registry.ts: ToolRegistry类 — egister/get/unregister/list/invoke基础操作 + D68扩展(alidateAtomicity原子性3条件、PolicyEngine权限门禁、审计日志)
- src/expert-platform/store.ts + 	ypes.ts: 专家注册、模板演化(TemplateStatus 5态)、交叉验证(ExpertValidation)

**当前缺口**: Skill/Tool/Playbook虽有代码骨架，但缺乏体系化研究文档阐明其设计原理、分类体系、加载机制、协同模式。这正是本研究的目标。

### 0.2 产品核心命题

> Skill/Tool体系是基础设施与用户价值之间的"最后一公里"。

| 层级 | 当前状态 | 本研究的角色 |
|------|---------|-------------|
| 基础设施 (哨兵/计算/本体) | 12份权威文档已定义 | 引用，不重复研究 |
| 能力体系 (Skill/Tool/Playbook) | 代码骨架存在，缺体系化文档 | **本研究核心** |
| 用户价值 (诊断报告/工单/行动建议) | 业务产出 | 本研究保障可组合性 |

### 0.3 对标关键发现

**对标1: Hermes Agent** (D:\Git项目研究\hermes-agent-main\)

- **五件套Skill结构**: 部分Skill目录含SKILL.md + eferences/ + scripts/ + 	emplates/ + 	ests/五个子目录。如skills/devops/kanban-orchestrator/SKILL.md包含完整playbook（分解模式、防诱惑规则、5步工作流、常见模式、陷阱列表）
- **AST扫描自动注册**: 	ools/registry.py的discover_builtin_tools()函数通过AST解析Python模块文件，检测顶层egistry.register(...)调用，自动发现Tool，零手动注册
- **生成计数器**: _generation单调递增，每次注册/注销/别名变更自增，外部缓存可基于此值判断是否需要刷新
- **check_fn TTL缓存**: 30秒TTL缓存的可用性检查函数结果，避免重复探测外部状态（Docker、浏览器等）
- **关键局限**: Hermes的500+ Skill是独立实例，**没有企业/用户级别的参数覆盖机制**。Skill定义是硬编码的，无法根据企业特异性（行业阈值、本地组织架构、自定义指标体系）进行调整

**对标2: Claude Code bundled-skills** (system_prompts_leaks-main\Anthropic\Claude Code\bundled-skills\)

- **Procedure checklist模式**: dataviz/SKILL.md定义了严格的7步流程（选形式 → 配颜色 → 验证调色板 → 应用标记规范 → 添加悬停层 → 无障碍终检 → 渲染验证），每步强制引用eferences/下的具体文件
- **参数化设计**: "The method is design-system-agnostic." 通过可替换参数表（ramps/categorical theme/sequential hue/diverging pair/status palette/texture fill/surfaces/filter controls）实现品牌无关的可视化
- **code-review skill**: 不采用单一SKILL.md，而是按严重性分文件 (high.md, medium.md, low.md, xhigh.md)，实现关注点聚焦
- **非协商项**: 明确列出不依赖设计系统的硬性规则（禁止双轴图、颜色跟随实体不跟随排名等）

**对标3: 工具注册模式对比**

| 维度 | Hermes registry.py | Synova tool-registry.ts |
|------|-------------------|------------------------|
| 发现机制 | AST扫描egistry.register()调用 | 手动egister() + manifest文件驱动 |
| 原子性验证 | 无（依赖代码审查） | alidateAtomicity() 3条件（contract+test+reuse>=2） |
| 权限门禁 | 无独立层 | PolicyEngine三元评估 (role/dataLevel/soi) |
| 审计日志 | 无 | 异步fire-and-forget日志写入 |
| TTL缓存 | check_fn 30秒缓存 | 无（skill-loader有简单内存缓存） |

### 0.4 Skill vs Tool — 核心区分

从当前代码库提炼的区分标准：

**Tool (原子能力)**

- 定义: 单一函数，明确的输入/输出契约，可独立测试，至少被2个Skill复用
- 代码载体: src/tools/*.ts中注册到	oolRegistry的ToolDef实例，或extensions/tools/中的manifest定义
- 原子性标准（代码已有）: alidateAtomicity() — contractId非空 + hasTests为true + skills引用数>=2
- 示例: cquire-edge-data（边数据采集）、compute-break-even（盈亏平衡计算）、cross-validate（交叉验证）

**Skill (组合能力)**

- 定义: 多Tool + 推理链 + 领域知识，组合成可执行的诊断行为单元
- 代码载体: extensions/skills/builtin/*/manifest.json + SKILL.md，由src/skill/skill-loader.ts加载
- 复杂度分级（代码已有）: tomic / composite / expert
- 示例: diagnose-cashflow-health（四层追溯现金健康诊断，依赖6个Tool + 3个compute函数 + 5个哨兵）

**Playbook (任务剧本)**

- 定义: YAML定义的任务执行序列，触发条件 → 步骤序列 → 条件分支 → onFailure策略
- 代码载体: extensions/playbooks/builtin/*.yaml，由src/playbook/playbook-loader.ts加载
- 类型（代码已有）: PlaybookDefinition — id/name/version/expert/type/trigger/steps/onFailure/output/dependencies/crossExpert
- 示例: PB-finance-cashflow-crisis（5步应急响应：确认 → 安全边际 → 经营杠杆 → 资本结构 → 方案输出）


---

## §1 研究目标与交付物

### 1.1 研究目标

为Synova的Skill/Tool体系产出完整的体系化研究文档，阐明：七层分类体系、三类复杂度模型、九大Skill类别、跨专家协同机制、文件驱动加载架构、本地自适应层（Synova创新点）。

### 1.2 交付物清单（7份文件）

| # | 文件名 | 内容 | 预计字数 |
|---|--------|------|----------|
| 1 | SYNOVA-RESEARCH-第一章-Skill体系架构与七层分类-20260716.html | L1-L7层级定义、atomic/composite/expert复杂度、九大类别枚举、跨专家Skill设计 | ~8,000 |
| 2 | SYNOVA-RESEARCH-第二章-专家认知任务分析与Tool原子性-20260716.html | 前置研究：以客户A案例观察财务专家认知过程 → 提炼Tool原子性标准 → Skill组合规则 | ~6,000 |
| 3 | SYNOVA-RESEARCH-第三章-Skill文件结构与加载机制-20260716.html | manifest.json schema、SKILL.md结构、SkillLoader加载流程、优先级覆盖机制 | ~7,000 |
| 4 | SYNOVA-RESEARCH-第四章-Playbook任务剧本体系-20260716.html | Playbook YAML schema、触发条件、步骤定义、条件分支、onFailure(5选项)、PlaybookExecutionRecord | ~7,000 |
| 5 | SYNOVA-RESEARCH-第五章-本地自适应层设计-20260716.html | 企业参数覆盖表、ContextLoader、双层进化（联邦/本地）、Sentinel阈值本地化、行业模板差异 | ~6,000 |
| 6 | SYNOVA-RESEARCH-第六章-挂载架构与集成规范-20260716.html | 五层架构中Skill/Tool/Playbook的位置、管线集成点、startup/bootstrap流程、扩展点设计 | ~5,000 |
| 7 | SYNOVA-RESEARCH-第七章-验收标准与质量门禁-20260716.html | 每章验收条件、铁律对齐（47/48/1/4/5/11/24/31/38）、pre-commit集成 | ~4,000 |

---

## §2 前置研究 — 专家认知任务分析

### 2.1 研究目的

在系统设计Skill分类体系之前，必须观测一个真实的诊断案例：**财务专家从收到Sentinel Finding到输出诊断结论的完整认知过程**。通过拆解这个过程的每一步，提炼出原子Tool的边界和Skill的组合逻辑。

### 2.2 案例选择：客户A现金流危机

**背景设定**: 客户A是一家母婴电商（营收800万/年，25人团队），哨兵capital-health发出critical级警报 — 现金跑道不足60天。

**观测对象**: 财务专家接收到SentinelFinding后的认知全过程

### 2.3 认知过程拆解（7步）

| 认知步骤 | 专家行为 | 涉及的Tool/Skill |
|----------|---------|-----------------|
| 1. 信息获取 | 读取哨兵原始信号、获取现金流边数据（E-1.1、E-1.2）、获取损益相关边（E-2.1） | cquire-edge-data, query-graph |
| 2. 模式识别 | 将现金流拆分为经营/投资/融资三类，检查是否有某类异常 | compute-cash-runway-months (哨兵cash-runway), 模式匹配框架 |
| 3. 因果追溯 | 从表层症状（现金流紧张）沿图追溯至中层传导（应收账款周转天数恶化） | compute-receivable-overdue-rate (哨兵cash-runway), 图遍历 |
| 4. 深层验证 | 计算盈亏平衡点，验证毛利率变化对现金流的影响 | compute-break-even (哨兵unit-economics), 敏感性分析 |
| 5. 结构定位 | 分析固定成本占比（经营杠杆效应），评估资本配置效率 | compute-dol, compute-capital-allocation |
| 6. 综合诊断 | 整合链证据，形成结论：根因为客户集中度60% → 大客户拖款 → 应收账款恶化 → 现金枯竭 | cross-validate |
| 7. 报告输出 | 生成诊断报告：严重度P0、根因链、置信度85%、3个建议行动 | 报告模板 + 置信度校准 |

### 2.4 从认知过程提炼的设计原则

| 原则 | 来源 | 对Skill体系的影响 |
|------|------|-------------------|
| 信息获取必须先于推理 | 步骤1在步骤2-5之前 | L1感知层必须独立于L3推理层 |
| 验证链必须可追溯 | 步骤4验证步骤3的假设 | 每个Skill的输出必须包含evidenceChain字段 |
| 降级不阻断 | 部分数据不可用时仍能输出部分诊断 | onFailure: degrade策略（已在Playbook中实现） |
| 同因多证 | 步骤3-5从三个角度独立验证同一根因 | cross-validate是强制性步骤 |


---

## §3 第一章规划 — Skill体系架构与七层分类

### 3.1 文档定位

**文件名**: SYNOVA-RESEARCH-第一章-Skill体系架构与七层分类-20260716.html

**核心问题**: Synova的Skill如何按能力层级、复杂度、领域类别进行体系化组织？

### 3.2 七层分层体系 (L1-L7)

当前代码中SkillManifest.tier已定义七层枚举：'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7'（定义于 src/skill/skill-loader.ts）。本章需阐明每层的语义、上下调用规则、典型Skill示例。

| 层级 | 名称 | 核心能力 | 调用规则 | 典型Skill (代码中已有) |
|------|------|---------|---------|----------------------|
| L1 | 感知层 | 数据采集+哨兵触发 | 只被L2+调用，不调用上层 | cquire-financial-data, cquire-competitive-intel, cquire-customer-data, cquire-operational-data, cquire-org-health-data, check-data-source-health |
| L2 | 计算层 | 量化测量+基线对比 | 调用L1，被L3+调用 | (哨兵compute函数：compute-break-even.ts等25+测量器，位于 extensions/sentinels/*/computes/) |
| L3 | 诊断层 | 因果追溯+根因定位 | 调用L1-L2，被L4-L5调用 | diagnose-cashflow-health, diagnose-churn-root-cause, diagnose-margin-erosion, diagnose-org-health, diagnose-agency-cost, diagnose-competitive-decay, detect-plan-deviation, survival-crisis-diagnosis |
| L4 | 处方层 | 行动建议+预算分配 | 调用L1-L3，被L5-L6调用 | prescribe-budget-allocation, prescribe-market-entry, prescribe-pricing-strategy, prescribe-synergy-value, match-best-practice |
| L5 | 执行层 | 跟踪执行+反馈收集 | 调用L1-L4，可逆向通知L3-L4 | 	rack-execution-progress, knowledge-base-maintenance, manage-sentinel-config |
| L6 | 自省层 | 自我诊断+校准+演化 | 调用L1-L5，可逆向修正L3-L5 | gent-self-health, self-diagnose-agent, diagnosis-calibration |
| L7 | 自保层 | 安全边界+降级+熔断 | 全局约束，所有层受其限制 | ackup-restore, conflict-resolution, erify-hypothesis |

**上下调用规则**:
- 上层可调用下层任意层（L3 → L2 → L1）
- L5/L6允许反向通知下层（反馈循环：执行结果修正处方、诊断质量反馈修正推理链）
- L7横切所有层，作为全局约束

### 3.3 三类Skill复杂度

代码中SkillManifest.complexity已枚举：'atomic' | 'composite' | 'expert'（定义于 src/skill/skill-loader.ts）。

| 复杂度 | 定义 | Tool数量 | 推理链 | 代码示例 |
|--------|------|----------|--------|---------|
| atomic | 单一功能，直接调用2-5个Tool，无嵌套Skill | 2-5 | 单步 | cquire-financial-data (3个Tool) |
| composite | 组合多个atomic Skill，含条件分支 | 间接5-15 | 2-3步 | nalyze-cost-structure (依赖2个atomic Skill) |
| expert | 完整诊断链：信息获取 → 计算 → 诊断 → 处方，含交叉验证 | 间接15+ | 4-7步 | diagnose-cashflow-health (依赖3个子Skill + 6个Tool + 5个哨兵，见 extensions/skills/builtin/diagnose-cashflow-health/manifest.json) |

### 3.4 九大Skill类别

基于现有38个Skill的领域归属分析（extensions/skills/builtin/*/manifest.json），分为九大类：

| 类别 | 数量 | Skill列表（代码中已有） |
|------|------|----------------------|
| 数据采集 | 5 | cquire-financial-data, cquire-competitive-intel, cquire-customer-data, cquire-operational-data, cquire-org-health-data |
| 计算分析 | 6 | nalyze-break-even, nalyze-cost-structure, nalyze-customer-value, nalyze-learning-curve, nalyze-operating-leverage, nalyze-price-elasticity |
| 竞争分析 | 2 | nalyze-competitive-position, nalyze-capital-allocation |
| 诊断 | 8 | diagnose-cashflow-health, diagnose-churn-root-cause, diagnose-margin-erosion, diagnose-org-health, diagnose-agency-cost, diagnose-competitive-decay, survival-crisis-diagnosis, enterprise-growth-diagnosis |
| 处方 | 4 | prescribe-budget-allocation, prescribe-market-entry, prescribe-pricing-strategy, prescribe-synergy-value |
| 知识管理 | 4 | distill-expert-knowledge, knowledge-base-maintenance, match-best-practice, etrieve-industry-benchmark |
| 执行跟踪 | 3 | 	rack-execution-progress, detect-plan-deviation, manage-sentinel-config |
| 验证审查 | 3 | erify-hypothesis, cross-expert-review, conflict-resolution |
| 自维护 | 6 | gent-self-health, self-diagnose-agent, diagnosis-calibration, ackup-restore, check-data-source-health, synthesizer-invoke |

（41个Skill全覆盖，部分Skill出现在多个类别边界）

### 3.5 跨专家Skill设计

代码中已存在跨专家模式：

- **expert: "multi"**: extensions/playbooks/builtin/PB-cross-margin-erosion.yaml的expert字段为"multi"，步骤2-5分发到不同领域的Skill（成本结构/竞争定位/价格弹性/结构分析），步骤8由综合Skill聚合
- **crossExpert: true**: Playbook的布尔标记，声明该剧本需要多专家协同
- **permissions.crossExpert**: Skill manifest中声明允许跨领域访问的专家列表。如 diagnose-cashflow-health/manifest.json 中 permissions.crossExpert: ["strategy"]，允许财务专家访问战略领域数据
- **nalytical_lens**: 不同专家对同一哨兵信号的差异化分析视角 — 同一哨兵margin-health，财务专家关注成本结构，战略专家关注竞争位势，商业模式专家关注价值捕获效率

本章需阐明多专家协同的四模式：
1. **序列模式**: 专家A输出 → 专家B输入（如PB-finance-cashflow-crisis，步骤串联）
2. **并行模式**: 多专家同时分析，synthesizer聚合（如PB-cross-margin-erosion的步骤2-5并行，步骤8聚合）
3. **辩论模式**: 两专家对立分析，仲裁者裁决（conflict-resolution Skill）
4. **审查模式**: 主专家输出被审查专家验证（cross-expert-review Skill）

### 3.6 挂载架构

Skill/Tool/Playbook在三层文件结构中的挂载点：

`
extensions/
  +-- skills/
  |   +-- builtin/        (41个Skill，builtin优先级最低)
  |   +-- industry/       (行业特定Skill，覆盖builtin)
  |   +-- custom/         (企业自定义Skill，覆盖industry+builtin)
  |   +-- manifest.json   (skills-manifest，定义加载顺序: custom>industry>builtin)
  +-- playbooks/
  |   +-- builtin/        (21个YAML剧本)
  |   +-- industry/
  |   +-- custom/
  |   +-- manifest.json
  +-- tools/
  |   +-- manifest.json
  +-- sentinels/
      +-- */aggregate.ts + computes/*.ts  (44个哨兵)
`

优先级覆盖链: custom > industry > builtin，由 src/skill/skill-loader.ts + src/playbook/playbook-loader.ts 统一管理。extensions/skills/manifest.json 中明确定义 loadOrder: ["custom", "industry", "builtin", "candidates"]。

启动管线集成点（src/skill/index.ts导出 loadSkills/clearSkillCache/registerLoadedSkills）：
1. Bootstrap阶段: egisterLoadedSkills() 调用 → 文件扫描 → manifest解析 → 注入 skillRegistry
2. 同上: egisterLoadedPlaybooks() → YAML解析 → 注入 playbookRegistry
3. Tool注册在 src/tools/tool-registry.ts 中独立于文件系统，通过代码显式 egister()


---

## §4 第三章规划 — Skill文件结构与加载机制

### 4.1 文档定位

**文件名**: SYNOVA-RESEARCH-第三章-Skill文件结构与加载机制-20260716.html

**核心问题**: Skill的manifest.json和SKILL.md的完整schema是什么？SkillLoader的加载流程和优先级覆盖机制如何运作？

### 4.2 Skill文件结构 (manifest.json + SKILL.md)

**manifest.json schema** — 基于 src/skill/skill-loader.ts 中 SkillManifest 接口（实际定义于第31-70行）:

`	ypescript
// 文件路径: src/skill/skill-loader.ts
interface SkillManifest {
  name: string;             // 唯一标识，如 "diagnose-cashflow-health"
  version: string;          // 语义化版本，如 "1.0.0"
  type: 'skill';            // 固定值
  displayName: string;      // 人类可读名称
  description: string;      // 功能描述
  tier: 'L1'|'L2'|'L3'|'L4'|'L5'|'L6'|'L7';  // 七层分类
  complexity: 'atomic'|'composite'|'expert';    // 复杂度
  expert: string;           // 所属专家，如 "finance"
  tools: string[];          // 依赖的Tool名称列表
  entryPoint: string;       // 入口文件，如 "./SKILL.md"
  exportKey: string;        // 导出键，如 "default"
  permissions: {
    dataAccess: { dimensions: string[]; sensitiveAccess: string };
    crossExpert: string[];  // 允许跨领域访问的专家
  };
  dependencies?: {
    skills?: string[];      // 依赖的子Skill
    tools?: Record<string, string>;  // 工具及版本约束
    edges?: string[];       // 消费的L2边ID
    computes?: string[];    // 消费的compute函数ID
    sentinels?: string[];   // 消费的哨兵名称
  };
  boundaries?: {
    prohibitedDimensions?: string[];   // 不可触碰的数据维度
    degradedBehavior?: string;         // 降级行为描述
    preconditions?: string[];          // 运行前置条件
  };
  lifecycle?: string;       // 生命周期状态
  loading?: string;         // 加载策略 ("on-demand" / "eager")
}
`

**实际manifest.json示例** — 来自 extensions/skills/builtin/diagnose-cashflow-health/manifest.json:

`json
{
  "name": "diagnose-cashflow-health",
  "version": "1.0.0",
  "type": "skill",
  "displayName": "现金流健康诊断",
  "description": "四层追溯协议的现金流健康诊断：表层症状→中层传导→底层结构→根因定位。",
  "tier": "L3",
  "complexity": "expert",
  "expert": "finance",
  "tools": ["acquire-edge-data", "compute-break-even", "compute-dol",
            "compute-capital-allocation", "cross-validate", "query-graph"],
  "entryPoint": "./SKILL.md",
  "exportKey": "default",
  "permissions": {
    "dataAccess": { "dimensions": ["financial"], "sensitiveAccess": "read" },
    "crossExpert": ["strategy"]
  },
  "dependencies": {
    "skills": ["analyze-break-even", "analyze-operating-leverage", "analyze-capital-allocation"],
    "edges": ["E-1.1", "E-1.2", "E-2.1", "E-5.1", "E-4.1", "E-X.1"],
    "computes": ["COMPUTE-BREAK-EVEN-v1", "COMPUTE-DOL-v2", "COMPUTE-CAPITAL-ALLOCATION-v1"],
    "sentinels": ["capital-health", "margin-health", "sentinel-breakeven",
                  "sentinel-operating-leverage", "sentinel-survival-margin"]
  },
  "boundaries": {
    "prohibitedDimensions": ["organizational", "technology", "customer-segment"],
    "degradedBehavior": "财务数据源不可用或部分边缘缺失时返回部分指标并标记 degraded:true",
    "preconditions": ["下级L1-L2数据已就绪", "相关compute函数可用", "GraphStore连接正常"]
  },
  "loading": "on-demand",
  "lifecycle": "active"
}
`

**SKILL.md结构** — 基于 extensions/skills/builtin/diagnose-cashflow-health/SKILL.md:

`yaml
---
name: diagnose-cashflow-health
version: 1.0.0
description: "现金健康诊断"
category: diagnosis
tier: L3
expert: finance
complexity: expert
---
# 技能名称
## 概述          (一段话描述Skill做什么)
## 何时使用      (触发条件：哨兵ID/场景描述)
## 步骤流程      (编号步骤，每步标注调用的Tool)
### Step 1: 步骤名
### Step 2: 步骤名
## 输出格式      (结构化输出字段说明)
`

### 4.3 SkillLoader加载流程

基于 src/skill/skill-loader.ts 的实际实现（对标 src/sentinel/sentinel-loader.ts 的文件驱动模式）:

`
loadSkills() 调用
  +-- 检查缓存 (cache !== null -> 直接返回缓存)
  +-- 按优先级遍历 SKILL_ROOTS 数组:
  |   1. extensions/skills/custom/     (最高优先级)
  |   2. extensions/skills/industry/
  |   3. extensions/skills/builtin/    (最低优先级)
  +-- 每个目录:
  |    +-- 检查 existsSync(root) -> 不存在则继续下一目录
  |    +-- readdirSync 遍历子目录
  |    |    +-- 跳过 _ 开头的模板目录
  |    |    +-- 检查 manifest.json 存在
  |    |    |    +-- readFileSync + JSON.parse 解析
  |    |    |    |    +-- 校验 name 非空
  |    |    |    |    +-- 优先级覆盖: 同名Skill后扫描覆盖先扫描
  |    |    |    |    +-- 错误仅记录 errors[], 不中断其他Skill
  |    |    +-- 缺失 manifest.json -> errors[] 记录
  +-- 缓存结果到模块级变量 cache
  +-- 返回 { skills: LoadedSkill[], degraded: boolean, errors: string[] }
`

**优先级覆盖机制**: 使用 seen: Set<string> 追踪已见Skill名称，后扫描的（高优先级）覆盖先扫描的（低优先级）。数据流: builtin先被扫描入Map -> industry覆盖同名 -> custom最终覆盖。实现代码位于 skill-loader.ts 第86-93行。

**registerLoadedSkills()**: 加载后自动 import('./skill-registry') 动态导入，再调用 skillRegistry.register(skill) 注入全局单例。实现代码位于 skill-loader.ts 第101-114行。

**缓存管理**: clearSkillCache() 清空模块级缓存（skill-loader.ts 第119-121行），用于热加载场景。

### 4.4 Playbook YAML Schema

基于 src/playbook/playbook-types.ts 中 PlaybookDefinition 接口和 extensions/playbooks/builtin/PB-finance-cashflow-crisis.yaml 实际示例:

`	ypescript
// 文件路径: src/playbook/playbook-types.ts
interface PlaybookDefinition {
  id: string;              // 唯一ID，如 "PB-finance-cashflow-crisis"
  name: string;            // 人类可读名称
  description: string;     // 描述
  version: string;         // 语义化版本
  expert: string;          // 所属专家或 "multi"
  type: 'playbook';        // 固定值
  trigger: {
    sentinels?: string[];  // 触发哨兵列表
    manual?: boolean;      // 是否支持手动触发
    schedule?: string;     // Cron表达式
    condition?: string;    // 触发条件描述
  };
  steps: Array<{
    id: string;            // 步骤唯一ID
    name: string;          // 步骤名称
    description?: string;  // 详细描述
    skill?: string;        // 调用的Skill名称
    tools?: string[];      // 直接调用的Tool列表
    timeout?: number;      // 超时时间(秒)
    onFailure?: 'halt'|'skip'|'degrade'|'retry'|'notify';
  }>;
  onFailure: 'halt'|'continue'|'degrade'|'notify';  // 全局失败策略
  output: string;          // 输出格式/报告类型
  dependencies?: {
    edges?: string[];      // 依赖的边ID
    skills?: string[];     // 依赖的Skill名称
    sentinels?: string[];  // 依赖的哨兵名称
  };
  crossExpert?: boolean;   // 是否跨专家协同
}
`

**onFailure选项语义**:

| 选项 | 行为 | 使用场景 |
|------|------|---------|
| halt | 停止整个Playbook，返回错误 | 前置条件缺失，后续步骤无意义 |
| skip | 跳过当前步骤，继续执行后续步骤 | 可选分析步骤 |
| degrade | 标记步骤为降级，继续执行但降低最终置信度 | 部分数据不可用但可输出部分结论 |
| etry | 重试当前步骤(最多3次) | 临时性错误（网络超时、LLM限流） |
| 
otify | 继续执行但发送通知给人工运维 | 需要人工判断的边界情况 |

**实际Playbook示例** — extensions/playbooks/builtin/PB-finance-cashflow-crisis.yaml:
- 5步骤: 警报确认(halt) -> 安全边际计算(halt) -> 经营杠杆评估(degrade) -> 资本结构审查(degrade) -> 应急方案输出(notify)
- 触发哨兵: cashflow-critical, sentinel-survival-margin
- 依赖Skill: diagnose-cashflow-health, nalyze-break-even, nalyze-operating-leverage, nalyze-capital-allocation

**跨专家Playbook示例** — extensions/playbooks/builtin/PB-cross-margin-erosion.yaml:
- 8步骤，expert: "multi", crossExpert: true
- 步骤2-5并行执行四个不同领域Skill (cost/competitive/price/structure)
- 步骤6交叉验证，步骤8综合诊断

### 4.5 PlaybookExecutionRecord

本章还需定义 PlaybookExecutionRecord 类型，记录每次Playbook执行的完整审计轨迹（当前代码中尚未实现，作为本研究产出物之一）:

`	ypescript
interface PlaybookExecutionRecord {
  executionId: string;           // 执行唯一ID
  playbookId: string;            // 关联的Playbook ID
  triggerSource: 'sentinel'|'manual'|'cron';  // 触发来源
  startedAt: string;             // 开始时间(ISO 8601)
  completedAt?: string;          // 完成时间
  status: 'running'|'completed'|'failed'|'degraded';
  steps: Array<{
    stepId: string;
    status: 'success'|'degraded'|'skipped'|'failed'|'retrying';
    skillUsed?: string;          // 实际调用的Skill名称
    evidenceCount?: number;      // 产生的证据数量
    error?: string;              // 错误详情
    durationMs: number;          // 耗时(毫秒)
  }>;
  outputReportId?: string;       // 输出的诊断报告ID
  degradationFlags?: string[];   // 降级标记列表
}
`

### 4.6 PlaybookLoader加载流程

基于 src/playbook/playbook-loader.ts 的实际实现:

`
loadPlaybooks() 调用
  +-- 检查缓存 (cache !== null)
  +-- 按优先级遍历 PLAYBOOK_ROOTS:
  |   1. extensions/playbooks/custom/
  |   2. extensions/playbooks/industry/
  |   3. extensions/playbooks/builtin/
  +-- 每个目录:
  |    +-- readdirSync 遍历 .yaml/.yml 文件
  |    +-- 跳过 _ 开头模板文件
  |    +-- readFileSync + js-yaml load() 解析
  |    |    +-- 校验 id 非空
  |    |    +-- 优先级覆盖同ID
  |    |    +-- 错误仅记录不中断
  +-- 缓存 + 返回 { playbooks, degraded, errors }
`


---

## §5 第五章规划 — 本地自适应层 (Synova核心创新)

### 5.1 创新定位

这是Synova相对于Hermes的核心差异化创新。Hermes的500+ Skill是独立的硬编码实例，没有企业/用户级别的参数覆盖机制（参见 D:\Git项目研究\hermes-agent-main\ 中Skill即目录即实例的架构）。Synova在此基础上创新**本地自适应层**。

**设计目标**: 全局联邦进化的Skill + 企业特异性参数 -> 本地自适应诊断行为。

### 5.2 三层参数覆盖

`
全局基准 (builtin Skill manifest + compute默认阈值)
   +-- 行业覆盖 (industry Skill目录，如 extensions/industries/financial-services/thresholds.json)
   +-- 企业覆盖 (custom Skill目录 + 企业参数覆盖表)
`

行业阈值已存在于 extensions/industries/*/thresholds.json，企业覆盖表为本文档定义的新增机制。

### 5.3 关键组件

**1. 企业参数覆盖表** (extensions/skills/custom/{enterprise-id}/overrides.json  — 本研究的产出物设计):

`json
{
  "enterpriseId": "wanibaby-2026",
  "thresholdOverrides": {
    "cash-runway-months": { "critical": 45, "warning": 90 },
    "customer-concentration": { "critical": 0.40, "warning": 0.25 }
  },
  "skillOverrides": {
    "diagnose-cashflow-health": {
      "timeout": 45,
      "enabledSentinels": ["cashflow-critical", "sentinel-survival-margin"],
      "disabledSteps": []
    }
  },
  "industryRules": {
    "sector": "retail-ecommerce",
    "seasonalityFactor": 1.3,
    "benchmarkSource": "CN-ecommerce-2026Q2"
  }
}
`

**2. ContextLoader**: 在Skill执行前注入企业上下文（本研究需设计的模块）:
- 加载企业参数覆盖表 -> 合并行业基准 -> 产出最终执行参数
- 支持热更新：修改覆盖表后 clearSkillCache() 即可生效（已有API位于 src/skill/skill-loader.ts）
- 执行顺序: loadSkills() -> ContextLoader.merge(enterpriseId) -> 注入执行上下文 -> 专家执行

**3. 双层进化**:
- **联邦进化（全局）**: 所有企业贡献诊断模板到 src/expert-platform/store.ts，通过 ExpertContribution -> ExpertTemplate -> TemplateStatus生命周期（active/partial/needs_review/outdated/experimental）进行全局演化
- **本地自适应（企业特异性）**: 企业维护自己的覆盖参数，系统定期基于诊断准确率自动推荐阈值调整（如"基于过去6个月3次诊断验证，建议将cash-runway critical阈值从60天调整为45天"）

**4. Sentinel阈值本地化**:
- 已存在的行业阈值文件: extensions/industries/financial-services/thresholds.json, extensions/industries/manufacturing/thresholds.json 等
- 与哨兵 extensions/sentinels/*/manifest.json 中定义的 	hresholds 字段对接
- 企业级覆盖在运行时以覆盖表优先级生效

---

## §6 第六章规划 — 挂载架构与集成规范

### 6.1 五层架构中的位置

`yaml
L1 交互 (routes/API): 接收诊断请求，调用Trigger系统
L2 编排 (agent/, orchestrator/):
  - ConversationEngine: 负责将用户意图翻译为Playbook调用
  - SentinelService: Cron触发Playbook执行
  - ModuleRunner: 负责执行单个Skill
L3 洞察 (l3/, sentinel/):
  - ExpertDispatcher: 将Playbook步骤路由到对应专家
  - SignalAggregator: 哨兵信号聚合后触发Playbook
L4 本体 (evidence/):
  - Skill输出存储在EvidenceStore
  - 与compute函数、edge数据交互
L5 存储 (store/):
  - PlaybookExecutionRecord持久化
  - SkillRegistry + PlaybookRegistry状态持久化
`

### 6.2 启动/Bootstrap流程

基于现有代码 (src/skill/index.ts, src/playbook/index.ts):

`
1. 加载 Skills:  loadSkills() -> registerLoadedSkills()
2. 加载 Playbooks: loadPlaybooks() -> registerLoadedPlaybooks()
3. 加载 Tools:    toolRegistry (已通过各 tools/*.ts 文件自动注册)
4. 加载 Experts:   expert-platform/store.ts 读取专家注册
5. 注入 Context:  ContextLoader.merge(enterpriseId) 合并企业参数
6. 服务就绪:      HTTP API / MCP 监听
`

### 6.3 扩展点设计

| 扩展点 | 位置 | 机制 |
|--------|------|------|
| 新增Skill | extensions/skills/custom/{name}/ | 创建目录 + manifest.json + SKILL.md，自动发现（无需修改代码） |
| 新增Playbook | extensions/playbooks/custom/{id}.yaml | 创建YAML文件，自动发现 |
| 新增Tool | src/tools/ 或 extensions/tools/ | 	oolRegistry.register(toolDef) |
| 行业阈值覆盖 | extensions/industries/{sector}/thresholds.json | 文件覆盖 |
| 企业参数覆盖 | extensions/skills/custom/{enterprise-id}/overrides.json | 文件覆盖（本研究新增） |
| 专家定制 | src/expert-platform/store.ts | ExpertStore API |


---

## §7 执行计划

### 7.1 并行路线

基于6位专家并行执行研究写作任务（对标 PB-cross-margin-erosion 的并行模式，来源于 extensions/playbooks/builtin/PB-cross-margin-erosion.yaml）：

`
路线A (tech/knowledge专家):  第一章 §3.2-3.5 (层级+复杂度+类别+跨专家)
路线B (finance专家):         第二章 §2 (前置研究 — 客户A案例分析)
路线C (tech专家):            第三章 §4.1-4.3 (Skill文件结构+加载)
路线D (action专家):          第三章 §4.4-4.6 (Playbook+执行记录)
路线E (strategy专家):        第五章 §5 (本地自适应层详细设计)
路线F (org专家):             第六章 §6 (挂载架构+集成规范)

综合审查 (business_model专家): 第七章 §8 (验收标准+质量门禁)
`

### 7.2 时间估算

| 阶段 | 工作 | 预计耗时 |
|------|------|---------|
| 前置研究 | §2 案例学习+认知过程拆解 | 1.5h |
| 第一章 | Skill体系架构+七层分类+九大类+跨专家 | 1.5h |
| 第三章 | Skill文件结构+加载机制+Playbook YAML Schema | 2.0h |
| 第五章 | 本地自适应层设计 | 1.0h |
| 第六章 | 挂载架构+集成规范 | 0.5h |
| 第七章 | 验收标准+质量门禁+综合审查 | 1.0h |
| 交叉审查 | 6位专家交叉验证+修改 | 0.5h |
| **总计** | | **~8.0h** |

---

## §8 约束与验收标准

### 8.1 全局约束（~14条）

| # | 约束 | 来源/对齐 |
|---|------|----------|
| 1 | 所有代码引用必须使用实际文件路径 | 铁律0 (协作对齐) |
| 2 | 所有接口定义必须基于实际代码，不得编造 | 铁律47 (契约优先) |
| 3 | Manifest schema必须与 src/skill/skill-loader.ts 中 SkillManifest 一致 | 类型安全 |
| 4 | Playbook schema必须与 src/playbook/playbook-types.ts 中 PlaybookDefinition 一致 | 类型安全 |
| 5 | Tool原子性标准必须引用 src/tools/tool-registry.ts 的 alidateAtomicity() | D68扩展 |
| 6 | 九大类别必须覆盖全部41个builtin Skill | 完整性 |
| 7 | 七层分层必须与已有Skill的 	ier 字段一致 | 一致性 |
| 8 | 跨专家Skill必须引用 PB-cross-margin-erosion.yaml 和 crossExpert: true | 代码对齐 |
| 9 | 本地自适应层必须说明与Hermes的差异 | 创新定位 |
| 10 | 文件路径全部使用相对于项目根目录的路径 | 可追溯性 |
| 11 | 文档间交叉引用使用精确文件名 | 可导航性 |
| 12 | 每条设计决策附证明（代码引用或案例推理） | 可验证性 |
| 13 | s any 零容忍 | 铁律38 |
| 14 | 所有Schema定义需标注对应的源文件行号 | 可审查性 |

### 8.2 各章验收标准

**第一章 (Skill体系架构与七层分类)**:
- [ ] L1-L7每层有精确定义+至少1个代码示例
- [ ] atomic/composite/expert每类有精确定义+代码示例
- [ ] 九大类别覆盖 extensions/skills/builtin/*/ 下全部38个Skill
- [ ] 跨专家四模式（序列/并行/辩论/审查）有代码引用支撑
- [ ] 挂载架构图与 extensions/ 目录结构一致

**第二章 (专家认知任务分析)**:
- [ ] 客户A案例7步认知过程拆解完整
- [ ] 每步标注涉及的Tool/Skill（代码中真实存在）
- [ ] 4条设计原则有具体来源（步骤编号）+ 对Skill体系的影响
- [ ] Tool原子性标准引用 alidateAtomicity() 3条件

**第三章 (Skill文件结构与加载机制)**:
- [ ] manifest.json完整schema（与 SkillManifest 接口对齐）
- [ ] SKILL.md结构（与 diagnose-cashflow-health/SKILL.md 实际内容对齐）
- [ ] SkillLoader流程图（与 skill-loader.ts 源码对齐）
- [ ] Playbook YAML 完整schema（与 PlaybookDefinition 接口对齐）
- [ ] onFailure 5选项各自有语义+场景
- [ ] PlaybookExecutionRecord类型定义完整

**第五章 (本地自适应层)**:
- [ ] 与Hermes对比（引用Hermes的Skill结构局限）
- [ ] 企业参数覆盖表schema定义
- [ ] ContextLoader加载流程
- [ ] 双层进化（联邦/本地）机制阐述
- [ ] 与现有 extensions/industries/*/thresholds.json 集成

**第六章 (挂载架构与集成规范)**:
- [ ] 五层架构映射（L1-L5各层中Skill/Tool/Playbook的位置）
- [ ] Bootstrap流程（与 src/skill/index.ts 导出对齐）
- [ ] 5个扩展点有精确的文件路径
- [ ] 优先级覆盖链 custom > industry > builtin 说明

**第七章 (验收标准与质量门禁)**:
- [ ] 14条全局约束逐项检查通过
- [ ] 铁律对齐矩阵（47/48/1/4/5/11/24/31/38）
- [ ] pre-commit集成点说明（新增Skill/Tool/Playbook的自动化检查）

### 8.3 铁律对齐矩阵

| 铁律 | 编号 | 在本研究中的体现 |
|------|------|-----------------|
| 契约优先 | 47 | §4.2 manifest.json schema, §4.4 Playbook YAML schema — 输入/输出契约明确定义 |
| 测试非空壳 | 48 | §2.2 案例驱动设计 — 每个Tool必须经过实际案例验证；alidateAtomicity() 的 hasTests 条件 |
| 接线检查 | 1/4/5 | §3.6 挂载架构, §6.2 Bootstrap流程 — 确保Skill/Tool/Playbook从定义到执行链路完整 |
| 静默降级禁止 | 11 | §2.4 degradedBehavior 字段, §4.4 onFailure: degrade策略 — 降级必须显式标记 |
| 异常处理审计 | 24 | §4.5 PlaybookExecutionRecord — 所有执行异常有完整审计轨迹 |
| 降级信号传播 | 31 | §4.4 onFailure五选项 — degrade信号在整个Playbook执行链中传播 |
| s any 零容忍 | 38 | §8.1 约束#13 — 所有TypeScript定义使用精确接口类型 |

---

## §9 最终裁决

**研究方案状态**: 已完成，等待执行。

**核心交付物**: 7份HTML研究文档 + 1份研究方案（本文档）。

**关键创新**: 
1. **Skill vs Tool vs Playbook** 三层模型 — 原子能力/组合能力/任务剧本，三层协作完成从诊断到行动的完整链路
2. **七层分层体系** — L1感知 到 L7自保，上层调用下层，L5/L6反馈循环，L7全局约束
3. **本地自适应层** — 对标Hermes局限（无企业参数覆盖），实现联邦进化 + 企业自适应双轨
4. **跨专家Skill** — expert: "multi" + crossExpert: true，四模式协同（序列/并行/辩论/审查）
5. **文件驱动零代码注册** — extensions/ 目录即配置，custom > industry > builtin 优先级自动覆盖

**前置依赖**:
- 12份权威文档（已有，位于 docs/synova/research/ 各子目录）
- Synova代码库（src/, extensions/, packages/engine-core/）
- 对标项目（Hermes D:\Git项目研究\hermes-agent-main\, Claude Code bundled-skills）

**下一步**: 执行并行路线，产出7章研究文档。

---

*文档版本: v2.0 | 创建日期: 2026-07-16 | 作者: Synova Research Team*
