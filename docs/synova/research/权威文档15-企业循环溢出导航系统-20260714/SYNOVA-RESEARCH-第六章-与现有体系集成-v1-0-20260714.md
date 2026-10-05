<!--
  Synova 权威文档15 | 第六章：与现有体系集成
  版本: v1.0 | 日期: 2026-07-14 | 作者: Synova 研究组
  定位: 施工文档——权威15溢出导航系统与权威01/05/13/14的精确接口定义
  依赖: 研究方案 v2.0 第六章、权威01 42边体系、权威05 交互蓝图 Module-1、权威13 增长导航、权威14 MVS与自助诊断
-->

# 第六章：与现有体系集成

> 核心问题：溢出导航系统不是孤岛——它的子循环配置映射到42边，它的告警推送到交互引擎，它的恶化信号触发 Goal 生成，它的监控循环嵌入 MVS 扩展路径。这一章定义每一个接缝的精确接口。
> 本章产出：5个跨文档集成接口 + GraphStore 数据消费协议

---

## 6.1 集成全景图

```
                     ┌──────────────────────────┐
                     │   权威01 42边因果体系     │
                     │   edges字段精确映射       │
                     │   transfer_function      │
                     │   action_effect_lag      │
                     └──────────┬───────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
            ▼                   ▼                   ▼
┌───────────────────┐ ┌───────────────┐ ┌───────────────────┐
│   权威15           │ │  权威05       │ │  权威13            │
│   溢出导航系统      │ │  交互蓝图      │ │  增长导航          │
│                   │ │               │ │                   │
│  • 子循环配置     │◄├┤• 溢出告警推送  │ │  • 溢出→Goal生成  │
│  • 溢出仪表盘     │ │  Module-1    │ │  • Proposal不变   │
│  • 投入建议引擎   │ │  安静期协议   │ │  • 方案哨兵追踪    │
│  • 6th Loop      │ │               │ │                   │
└───────────────────┘ └───────────────┘ └───────────────────┘
            │
            ▼
┌───────────────────┐
│   权威14           │
│   系统集成          │
│                   │
│  • MVS扩展路径    │
│  • 自助诊断Step3.5│
│  • 启动序列Phase  │
└───────────────────┘
```

---

## 6.2 集成1：与42边体系集成

### 6.2.1 子循环配置的 edges 字段映射

研究方案 §2.3 的循环配置 JSON 中，`edges` 字段定义了子循环的"阀"——每个阀映射到一组 42 边 ID：

```json
{
  "cycleId": "store-replication",
  "edges": {
    "acquisitionValve": ["E-05", "E-07"],
    "allocationValve": ["E-13"],
    "conversionValve": ["E-23", "E-28"],
    "deliveryValve": ["E-30", "E-31"],
    "recycleValve": ["E-37"]
  }
}
```

每个阀的语义映射到 42 边的 transfer_function：

| 阀 | 42 边 | 消费的 transfer_function 输出 |
|----|-------|---------------------------|
| `acquisitionValve` | E-05 CAPITAL_ACQUISITION | `C_available` (可用资本) |
| `acquisitionValve` | E-07 TALENT_ACQUISITION | `T_inflow` (人才流入速率) |
| `allocationValve` | E-13 CAPITAL_ALLOCATION | `allocation_efficiency` (配置效率) |
| `conversionValve` | E-23 OPERATIONAL_EXECUTION | `efficiency_rate` (运营效率) |
| `conversionValve` | E-28 CROSS_FUNCTIONAL_SYNERGY | `synergy_score` (跨职能协同) |
| `deliveryValve` | E-30 PRICING | `margin_rate` (利润率) |
| `deliveryValve` | E-31 CLIENT_RETENTION | `retention_rate` (留存率) |
| `recycleValve` | E-37 PROFIT_REINVEST | `retention_ratio` (再投资比例) |

### 6.2.2 溢出公式参数的溯源链

溢出公式的每个参数必须可追溯到 42 边或 compute contractId。溯源链在系统启动时验证（权威01 §5.4 因果链 Loader 校验逻辑），无效引用在 Phase 2d 报告：

```typescript
/**
 * 溢出公式参数溯源验证。
 *
 * 调用位置: Phase 2d CausalChainLoader → validateOverflowSourceReferences()
 * 验证规则:
 *   1. source = '42edge' → sourceId 必须在 edge-registry 中存在且 activated
 *   2. source = 'compute' → contractId 必须在 compute-registry 中存在
 *   3. source = 'manual' → 接受，但标注 isEstimated: true + 写入事件日志
 */
function validateOverflowSourceReferences(
  cycle: CycleConfig
): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const param of cycle.overflowParams) {
    switch (param.source) {
      case '42edge': {
        const edge = EdgeRegistry.get(param.sourceId);
        if (!edge) {
          issues.push({
            severity: 'error',
            message: `42边 ${param.sourceId} 在 edge-registry 中不存在`,
            cycleId: cycle.cycleId,
            paramName: param.name,
          });
        }
        break;
      }
      case 'compute': {
        const computeFn = ComputeRegistry.get(param.sourceId);
        if (!computeFn) {
          issues.push({
            severity: 'error',
            message: `compute ${param.sourceId} 在 compute-registry 中不存在`,
            cycleId: cycle.cycleId,
            paramName: param.name,
          });
        }
        break;
      }
      case 'manual': {
        // 手动参数接受但记录
        issues.push({
          severity: 'info',
          message: `参数 ${param.name} 依赖 GA 手动输入`,
          cycleId: cycle.cycleId,
          paramName: param.name,
        });
        break;
      }
    }
  }

  return {
    valid: !issues.some(i => i.severity === 'error'),
    issues,
  };
}
```

### 6.2.3 action_effect_lag 的消费

每一条 42 边的 `action_effect_lag` 字段（见第三章 §3.5.1）被以下模块消费：

| 消费模块 | 使用方式 | 文档引用 |
|---------|---------|---------|
| 传导时间线（第二章） | `PropagationStep.lagMonths` 从边的 `action_effect_lag` 读取 | 第二章 §2.2.3 |
| 投入建议引擎（第三章） | `recommendation.cumulativeLag` 累加路径上各边的 `action_effect_lag` | 第三章 §3.5 |
| 溢出监控循环（第四章） | `OverflowDiagnosisTrigger` 中的 `preliminaryHypothesis` 引用滞后时间确定干预窗口 | 第四章 §4.2.2 |

---

## 6.3 集成2：与权威05交互蓝图集成

### 6.3.1 溢出告警推送协议

权威05 Module-1（主动触达引擎）定义了三级告警推送协议。溢出导航系统的告警复用相同的三级体系：

| 溢出条件 | 告警级别 | Module-1 推送通道 | 推送内容模板 |
|---------|---------|-----------------|------------|
| 任一子循环溢出 > 0 且趋势为改善 | **INFO** | 工作台通知 + 周报摘要 | "{子循环名}溢出为正（{值}），趋势向好。无需操作。" |
| 任一子循环溢出趋于零（-0.05 到 0.05） | **WARNING** | 工作台通知 + 邮件 + 推送卡片 | "⚠ {子循环名}溢出趋于零（{值}）。建议关注，但不需立即行动。" |
| 任一子循环溢出连续2个周期 < 0 | **WARNING** | 工作台通知 + 邮件 + 推送卡片 | "⚠ {子循环名}溢出连续2周期为负（{序列}）。如第3周期仍为负，将自动触发诊断。" |
| 任一子循环溢出连续3个周期 < 0 | **CRITICAL** | 全通道（工作台+邮件+推送+短信）| "🔴 {子循环名}溢出连续3周期为负（{序列}）。已自动触发诊断循环。诊断报告预计30分钟内生成。" |
| 哨兵异常触发紧急溢出检测 | **CRITICAL** | 全通道 | "🔴 检测到{哨兵名}CRITICAL级异常。已启动24小时紧急溢出监测。" |

### 6.3.2 复用 Module-1 安静期协议

权威05 Module-1 定义了"同一告警在 t 时间内不重复推送"的安静期协议。溢出告警复用该协议：

```typescript
/**
 * 溢出告警推送 — 安静期检查。
 *
 * 调用权威05 Module-1 的 quietPeriodCheck() 函数。
 *
 * @param cycleId - 子循环 ID
 * @param alertLevel - 告警级别
 * @returns 是否应在安静期内跳过推送
 */
function shouldSkipOverflowAlert(
  cycleId: string,
  alertLevel: 'INFO' | 'WARNING' | 'CRITICAL'
): boolean {
  const lastAlert = AlertHistory.getLastAlert('overflow', cycleId, alertLevel);
  if (!lastAlert) return false;

  const quietPeriods = {
    'INFO': 7 * 24 * 60 * 60 * 1000,     // INFO 级安静期: 7天
    'WARNING': 24 * 60 * 60 * 1000,       // WARNING 级安静期: 24小时
    'CRITICAL': 0,                         // CRITICAL 级无安静期——每次推送
  };

  return (Date.now() - lastAlert.timestamp) < quietPeriods[alertLevel];
}
```

**注意**：CRITICAL 级溢出告警（连续3周期 < 0）不受安静期限制——每次恶化都立即推送。因为溢出连续负值是企业生存级风险，不能因为"2小时前推过"就不推。

### 6.3.3 推送数据包格式

溢出告警推送的数据包格式（对接权威05 的推送通道基础设施）：

```typescript
interface OverflowAlertPayload {
  /** 告警元数据 */
  alert: {
    id: string;
    level: 'INFO' | 'WARNING' | 'CRITICAL';
    source: 'overflow-monitor';
    timestamp: string;
    enterpriseId: string;
  };

  /** 溢出详情 */
  overflow: {
    cycleId: string;
    cycleName: string;
    currentValue: number;
    trend: 'improving' | 'declining' | 'stable';
    consecutiveNegativeCount: number;
    /** 最近3个周期的溢出值序列 */
    recentSequence: number[];
  };

  /** 建议行动（如果需要） */
  suggestedAction?: {
    type: 'no_action' | 'monitor' | 'trigger_diagnosis' | 'trigger_goal';
    description: string;
    autoTriggered: boolean;
    triggeredId?: string;  // 诊断执行ID或Goal ID
  };
}
```

---

## 6.4 集成3：与权威13增长导航集成

### 6.4.1 溢出恶化 → Goal 自动生成

第四章 §4.2.3 定义了溢出监控循环 → 导航循环的函数签名 `generateGoalFromOverflow()`。本节给出完整的触发→生成→追踪流程：

```
溢出监控循环检测到子循环 "customer-cycle" 溢出连续2周期 < 0
    │
    ▼
generateGoalFromOverflow() 调用
    │
    ├── 1. 构建 OverflowGoalGenerationRequest（来自溢出快照）
    │       goalTemplate.type = 'growth'（客户循环溢出恶化 → 增长型 Goal）
    │       targetMetric = { currentBaseline: -0.08, targetValue: 0.05 }
    │
    ▼
    │
    ├── 2. 生成 Proposal（权威13 第二章）
    │       paths[0]: "激进获客"（投放翻倍, risk=high）
    │       paths[1]: "优化留存"（提升复购, risk=medium）
    │       paths[2]: "最小改动"（维持现状, risk=low, isDefault=true）
    │
    ▼
    │
    ├── 3. Proposal 三选一确认 → 中层选择 "优化留存"
    │       → selectedPathIndex = 1
    │
    ▼
    │
    └── 4. Goal 生成（权威13 第一章）
            id = "goal-customer-retention-2026-07"
            type = 'growth'
            metrics.primary.targetValue = 0.05
            source = { diagnosisReportId: "auto-overflow-triggered", ... }
            │
            ▼
            5. 注册方案级哨兵（权威13 第三章）
               → 追踪 retention_rate → 检测偏离 → 主动告警
```

**关键设计决策**：溢出监控触发的 Goal 生成**不走 Proposal 的完整三选一流程**。当溢出连续3个周期 < 0 时（已触发诊断），Goal 从诊断报告的 `actionRecommendations` 正常生成——三选一流程不变。当溢出仅1-2个周期为负但尚未触发诊断时，系统自动生成一条"建议关注{子循环名}溢出"的轻量级 Goal——不需要三选一，直接进入追踪。

### 6.4.2 三选一机制不变

权威13 第二章的 Proposal 三选一确认机制**不被溢出触发链路改变**。溢出监控是 Proposal 的上游信号源，不是替代。具体的三选一逻辑（11态状态机、超时自动选择默认路径、中层异议→GA仲裁）保持完全不变。

两者的分工：
- **溢出监控**回答：哪个子循环需要执行干预？
- **Proposal 三选一**回答：干预的三条路径选哪条？

---

## 6.5 集成4：与权威14系统集成

### 6.5.1 MVS 扩展路径标注

第四章 §4.4.2 定义了 MVS → 完整版的扩展路径。本节在权威14 的体系内标注这些扩展步骤的精确位置。

在权威14 第四章 MVS 能力清单的基础上，增加一个"权威15 溢出导航"列：

| MVS 组件 | MVS 阶段实现 | MVS→完整版扩展步骤 | 溢出版本所需的额外工作 |
|---------|------------|------------------|---------------------|
| 子循环配置 | 4个静态 `*.cycle.json`（builtin） | 加载15-20个行业模板 + 动态注册 + GA覆盖表 | `CycleRegistry` + `cycle-loader.ts` |
| 溢出计算 | 手动填写的演示数据 | 自动计算管线 + `overflowFormula` 解析 + 42边参数追踪 | `OverflowMonitorLoop` + `computeOverflow()` |
| 溢出仪表盘 | 静态渲染的仪表盘行 | 动态生成 + 热力图 + 传导时间线 + WebSocket 推送 | `generateDashboard()` + `OverflowHeatmap` |
| 投入建议引擎 | 硬编码弹性系数的客户A单一模拟 | 动态读取42边弹性系数 + 多子循环排序 + 执行约束检测 | `POST /api/investment/simulate` |
| 溢出→告警推送 | 不推送（MVS阶段无持续运行） | Module-1推送集成 + 安静期协议 + CRITICAL全通道 | §6.3 的推送协议 |
| 溢出→Goal生成 | 不自动生成（手动创建演示Goal） | 自动触发 + 轻量级Goal + 方案哨兵 | §6.4 的生成链路 |
| 6th Loop调度 | 不实现（手动触发溢出计算） | CronScheduler注册 + 五循环接口 | §4.2 的5个函数签名 |

### 6.5.2 自助诊断 Step 3.5

权威14 第二章定义了 `check-self-diagnosis.sh` 的六步骤自助诊断流程。溢出监控作为**Step 3.5**插入到现有流程中——介于 Step 3（Loop Engineering 健康检查）和 Step 4（边参数健康检查）之间：

```
check-self-diagnosis.sh
├── Step 1: 数据源在线检查
├── Step 2: 哨兵健康检查
├── Step 3: Loop Engineering 健康检查
├── Step 3.5: 溢出监控健康检查 ← 新增
│   ├── CycleRegistry 加载状态（已加载子循环数 > 0）
│   ├── 最近一次溢出计算的 timestamp（< 最大子循环周期×2）
│   ├── 溢出值是否在合理范围（-1 到 1 之间，超出 → 数据异常）
│   ├── 连续负值子循环列表
│   └── 输出示例:
│       "溢出监控正常。4/4子循环最近溢出计算：2小时前。现金循环溢出=+0.15（正向），客户循环溢出=-0.08（⚠ 关注）。"
│       "WARNING: 人才循环溢出值=-2.5，超出合理范围——检查overflowFormula参数是否有误。"
├── Step 4: 边参数健康检查
├── Step 5: 专家加载检查
└── Step 6: 综合诊断报告生成
```

### 6.5.3 启动序列扩展

权威14 第一章定义了 Phase 0-5 的启动序列。溢出导航系统需要在 Phase 2 中增加一个加载步骤 `2e CycleLoader`：

```
Phase 2  核心引擎    < 10s（原 < 8s，增加2秒给 CycleLoader）
  2a SentinelLoader
  2b SkillLoader
  2c PlaybookLoader
  2d CausalChainLoader
  2e CycleLoader ← 新增 — 扫描 cycles/ 目录并注册子循环
```

**2e CycleLoader 规范**：

| 属性 | 值 |
|------|-----|
| 加载函数 | `src/cycles/cycle-loader.ts:loadCycleRegistry()` |
| 依赖 | Phase 1.1 (GraphStore 就绪), Phase 1.5.2 (Enterprise 节点存在) |
| 行为 | 1. 扫描 `cycles/builtin/` → 加载内置模板 2. 根据 `enterprise.industry` 扫描 `cycles/industry/{slug}/` 3. 扫描 `cycles/custom/{enterpriseId}/` → 覆盖同名 4. 合并企业参数覆盖表（GraphStore Enterprise 节点） 5. 验证每个加载的循环（overflowFormula 可解析、edges 引用有效） |
| 失败策略 | 单个循环加载失败 → 标记 degraded + log.warn + 不阻断系统启动。全部循环加载失败 → 系统降级为"无溢出监控模式" + log.error |
| 耗时估计 | ~2s（扫描3个目录 + JSON解析 + 参数验证 + Schema校验） |

---


### 6.6-A 同比/环比计算的体系依赖说明

同比环比计算不需要修改现有compute函数、哨兵或42条边——它是对已有能力的消费层编排。

**数据来源**：
- 同比环比计算所需的"历史溢出快照"来自 `OverflowSnapshot` 在 GraphStore 中的时序存储
- GraphStore 已有的 `valid_from/valid_to` 字段 + `getNodeAtTime()` 方法天然支持"查询12个月前的快照"——不需要新增存储能力
- compute 函数不需要增加 "time_range" 参数——compute 只计算"当前周期的溢出"（它们的职责）。环比的对比逻辑在溢出监控循环（权威15 §4.4-A）中完成——从 GraphStore 查询上期快照 → 计算差值

**不影响的子系统**：
- 42条边：transfer_function 不变——它只定义"一个时间点的因果传导关系"
- 50个哨兵：检测逻辑不变——哨兵仍然检测"当前周期的异常"
- 8位专家提示词：不需要修改——专家在诊断时引用的是"当前周期的数据"
- 61个compute函数：不需要增加历史窗口参数——compute 保持纯函数（输入=当前数据，输出=当前指标）

**新增的消费关系**：
- 溢出监控循环 → GraphStore.getNodeAtTime(timestamp) → 查询历史 OverflowSnapshot
- 溢出监控循环 → 环比/同比计算 → 写入 OverflowSnapshot 的 momChange/yoyChange/trendDirection 字段
- 溢出仪表盘 → 消费 OverflowSnapshot 的同比环比字段 → 渲染箭头和趋势线
- 投入建议引擎 → 消费 trendContext → 区分"趋势下降的预警模式"vs"连续恶化的危机模式"


## 6.6 溢出指标与 GraphStore 的数据消费接口

### 6.6.1 写入路径

溢出计算管线写入 GraphStore 的路径：

```
OverflowMonitorLoop.execute()
    │
    ▼
computeOverflow(cycle) → OverflowSnapshot
    │
    ▼
GraphBridge.writeOverflowSnapshot(enterpriseId, cycleId, snapshot)
    │
    ▼
GraphStore.updateNode(
    type: 'Enterprise',
    id: enterpriseId,
    properties: {
        overflow_snapshots: [...]  // append 新快照到数组
    }
)
```

### 6.6.2 读取路径

各消费方从 GraphStore 读取溢出数据：

```typescript
/**
 * GraphBridge 溢出数据读取接口。
 *
 * @layer L4 (本体层)
 * @source graph_nodes.properties.overflow_snapshots
 */
interface OverflowGraphBridge {
  /**
   * 获取指定企业的完整热力图数据。
   * @param enterpriseId - 企业标识
   * @param opts.months - 覆盖月数（默认12）
   * @returns OverflowHeatmap
   */
  getOverflowHeatmap(
    enterpriseId: string,
    opts?: { months?: number }
  ): Promise<OverflowHeatmap>;

  /**
   * 获取指定子循环的溢出时间序列。
   * @param enterpriseId - 企业标识
   * @param cycleId - 子循环ID
   * @param opts.months - 覆盖月数
   * @returns OverflowSnapshot[] (按 month 升序)
   */
  getCycleSnapshots(
    enterpriseId: string,
    cycleId: string,
    opts?: { months?: number }
  ): Promise<OverflowSnapshot[]>;

  /**
   * 获取最新溢出快照。
   */
  getLatestSnapshot(
    enterpriseId: string,
    cycleId: string
  ): Promise<OverflowSnapshot | null>;

  /**
   * 写入溢出快照。
   */
  writeOverflowSnapshot(
    enterpriseId: string,
    cycleId: string,
    snapshot: OverflowSnapshot
  ): Promise<void>;
}
```

### 6.6.3 溢出快照的 GraphStore schema

`graph_nodes` 表中 Enterprise 节点的 `overflow_snapshots` 属性是一个 JSON 数组：

```sql
-- overflow_snapshots 属性的结构（存储在 graph_nodes.properties JSON 列中）
-- 每个 Enterprise 节点包含:
{
  "overflow_snapshots": [
    {
      "cycleId": "customer-cycle",
      "month": "2026-07",
      "overflowValue": 0.12,
      "unit": "%",
      "trend": "improving",
      "trendDelta": 0.04,
      "maturity": "active",
      "isIndustryBaseline": false,
      "confidenceInterval": { "low": 0.08, "high": 0.16 },
      "degraded": false
    }
  ]
}
```

数据访问通过 `GraphBridge` 提供的结构化接口，不直接操作 JSON——避免 SQLite JSON 查询的性能陷阱和 schema 耦合。

---

## 6.7 跨文档引用索引

下表汇总权威15 对其他权威文档的引用关系，用于跨文档一致性检查：

| 本文档章节 | 引用的权威文档 | 引用的具体章节 | 引用类型 |
|-----------|-------------|-------------|---------|
| 第二章 §2.1 | 权威01 第二章 | 42边 transfer_function | 数据源 |
| 第二章 §2.2 | 权威01 第二章 | 42边 action_effect_lag | 参数 |
| 第二章 §2.6 | 权威01 第二章 | 42边溢出分解 | 下游钻取 |
| 第三章 §3.2 | 权威01 第二章 | 42边 elasticities | 输入参数 |
| 第三章 §3.5 | 权威01 第二章 | 42边 action_effect_lag | 滞后计算 |
| 第三章 §3.7 | 权威13 第二章 | Proposal 三选一 | 下游接口 |
| 第四章 §4.2 | 权威13 第一/二章 | Goal/Proposal 接口 | 函数签名对接 |
| 第四章 §4.4 | 权威14 第四章 | MVS 能力清单 | 扩展路径 |
| 第五章 §5.3 | 权威14 第一章 | Enterprise 节点 GraphStore | 存储位置 |
| 第六章 §6.3 | 权威05 Module-1 | 主动触达引擎 + 安静期 | 推送协议复用 |
| 第六章 §6.4 | 权威13 第一/二/三章 | Goal + Proposal + 方案哨兵 | 完整链路 |
| 第六章 §6.5 | 权威14 第一/二/四章 | Phase 2e + Step 3.5 + MVS | 系统集成 |

---

> **版本历史**：v1.0 — 2026-07-14 — 初始版本。5个跨文档集成接口 + GraphStore 数据消费协议 + 跨文档引用索引。