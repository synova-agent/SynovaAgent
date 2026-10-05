<!--
  Synova 权威文档15 | 第四章：溢出驱动的顶层Loop Engineering
  版本: v1.0 | 日期: 2026-07-14 | 作者: Synova 研究组
  定位: 施工文档——溢出监控循环作为"6th Loop"的调度模型、优先级定义、与现有五循环的接口（函数签名级别）
  依赖: 研究方案 v2.0 第四章/第六章、权威13 五循环架构、权威14 启动序列
-->

# 第四章：溢出驱动的顶层Loop Engineering

> 核心问题：溢出监控是"周期性计算几个数字"，还是"一个持续运行的调度循环，在诊断周期结束时自动触发，优先级高于导航循环"？它怎么嵌入五循环架构，成为决定诊断和导航何时启动的顶层开关？
> 本章产出：溢出监控循环（6th Loop）的调度模型 + 与五循环的函数签名级接口定义 + 计算周期绑定到子循环业务周期的规范 + 与权威14 MVS的扩展路径

---

## 4.0 溢出监控循环：五循环之上的第6个循环

### 4.0.1 为什么需要一个新循环

五循环架构（权威13 §1.1）定义了诊断、导航、GA进化、系统自检、知识积累五个循环。这五个循环解决的是"执行对不对"——诊断发现问题、导航追踪执行、GA校准模型、自检保证健康、知识积累沉淀经验。

但有一个问题没有被任何一个循环回答：**在诊断循环启动之前，谁来判断"现在需不需要诊断"？**

诊断循环的触发条件当前是"FDE按需"或"Cron定时（14天）"。但14天是固定周期——如果企业一切正常，不必要的诊断浪费资源。如果企业突然恶化，14天的等待窗口可能太慢。

**溢出监控循环就是回答"何时启动诊断"的调度层。** 它持续监测所有子循环的溢出指标。溢出为正 → 一切正常，不触发诊断。溢出转负 → 信号聚合 → 按需触发诊断循环或导航循环。

### 4.0.2 溢出监控循环在五循环架构中的位置

```
┌─────────────────────────────────────────────────────────────────┐
│              溢出监控循环 (6th Loop — 顶层调度)                    │
│                                                                 │
│  持续监测所有注册子循环的溢出指标                                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  for each cycle in CycleRegistry.getActiveCycles():     │   │
│  │    snapshot = computeOverflow(cycle)                    │   │
│  │    if snapshot.overflowValue < 0 (连续3周期):           │   │
│  │      → 触发诊断循环 (溢出恶化 → 需要诊断根因)            │   │
│  │    if snapshot.overflowValue > 0:                       │   │
│  │      → 更新企业健康度评分 → 同步到系统自检循环           │   │
│  │    if 特定子循环溢出恶化:                                │   │
│  │      → 触发导航循环 (自动生成 Goal)                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                         │                                       │
│         ┌───────────────┼───────────────┐                       │
│         ▼               ▼               ▼                       │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐                │
│  │ 诊断循环  │   │ 导航循环  │   │ 系统自检循环  │                │
│  │(Diagnosis)│   │(Navigate)│   │(Self-Check)  │                │
│  └──────────┘   └──────────┘   └──────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

**优先级**: 溢出监控循环 > 导航循环。当两者定时任务冲突时，溢出监控优先——因为它判断"方向对不对"，导航循环判断"执行对不对"。方向错了，执行再对也没用。

---

## 4.1 溢出监控循环的调度模型

### 4.1.1 触发时机

溢出监控循环**不是独立的 Cron 作业**——它在每次诊断周期（14天）结束时自动触发，作为诊断周期的"前置检查"步骤。

但不同子循环的溢出变化节奏不同——不能统一14天计算。溢出监控循环需要一种**混合触发模型**：

```
触发源1: 诊断周期结束时（每14天）→ 汇总所有注册子循环的溢出
触发源2: 子循环自身业务周期到期时 → 仅计算该子循环的溢出快照
触发源3: 哨兵发现异常信号 → 紧急溢出检测（缩短周期为24小时）
```

**触发源1 是"完整汇总"**——诊断周期结束时的全量溢出扫描。**触发源2 是"增量更新"**——每个子循环按自身业务节奏更新溢出值（如现金流循环每周更新、客户循环月度更新）。

### 4.1.2 调度流程（伪代码）

```typescript
/**
 * OverflowMonitorLoop — 溢出监控循环的调度器。
 *
 * 运行在 L2 编排层，作为 CronScheduler 的一个作业。
 * 优先级高于导航循环（navigation-loop），调度器在冲突时优先执行本循环。
 *
 * @layer L2 (编排层)
 * @schedule 触发源1: 每次诊断周期结束时触发；触发源2: 子循环业务周期到期时触发；触发源3: 哨兵异常信号
 * @see CronScheduler (src/cron/cron-scheduler.ts)
 */
class OverflowMonitorLoop {
  /**
   * 主入口：执行一次溢出监控扫描。
   *
   * 调用时机：
   *   1. 诊断周期结束时（Cron 触发，每14天）
   *   2. 子循环业务周期到期（Cron 触发，频率由各子循环定义）
   *   3. 哨兵异常信号触发紧急扫描（事件驱动）
   *
   * @param triggerSource - 触发来源（cron_diagnosis_end | cron_cycle_period | sentinel_alert）
   * @param targetCycles - 可选，仅扫描指定子循环（触发源2时使用）
   * @returns OverflowMonitorReport
   */
  async execute(
    triggerSource: 'cron_diagnosis_end' | 'cron_cycle_period' | 'sentinel_alert',
    targetCycles?: string[]
  ): Promise<OverflowMonitorReport>;
}
```

### 4.1.3 触发源3（哨兵异常信号→紧急溢出检测）的触发条件

当以下哨兵产生 CRITICAL 级 Finding 时，溢出监控循环缩短检测周期为24小时：

| 哨兵ID | CRITICAL 条件 | 缩短理由 |
|--------|-------------|---------|
| `capital-health` | `allocation_efficiency < 0.3` 且 `revenue_growth < 0` | 资本配置异常可能快速传导到多个子循环 |
| `margin-health` | `margin_rate < 5%` | 利润率危机需要高频监测 |
| `cash-runway` | `cash_runway_months < 6` | 现金流紧张——监测频率必须提高到天级 |
| `customer-demand-shift` | `churn_rate` 单月上升 >30% | 客户流失加速——溢出可能急剧恶化 |
| `survival-margin` | `survivalMargin < 20%` | 存活边缘——所有子循环溢出都可能转为负 |

---

## 4.2 与现有五循环的函数签名级接口

### 4.2.1 接口总览

溢出监控循环与五个现有循环的接口关系：

```
溢出监控循环
  ├──→ 诊断循环:  触发诊断 (溢出连续3周期<0)
  ├──→ 导航循环:  触发Goal生成 (特定子循环溢出恶化)
  ├──→ GA进化循环: 提供溢出趋势数据 (用于阈值校准)
  ├──→ 系统自检循环: 推送企业健康度评分 (溢出为正时更新)
  └──→ 知识积累循环: 写入溢出历史数据 (用于跨企业基准)
```

### 4.2.2 接口1 —→ 诊断循环

```typescript
/**
 * 溢出监控循环 → 诊断循环 接口。
 *
 * 当任何子循环溢出连续 3 个周期 < 0 时，溢出监控循环调用此函数触发诊断。
 *
 * @signature overflowToDiagnosis
 * @caller OverflowMonitorLoop.execute()
 * @callee diagnosis-launcher.ts:launchDiagnosis() (L2 编排层)
 */

/**
 * 触发诊断循环的决策结果。
 */
interface OverflowDiagnosisTrigger {
  /** 是否应触发诊断 */
  shouldTrigger: boolean;

  /** 触发原因 */
  reason: string;

  /** 触发诊断的具体子循环 */
  triggeringCycles: Array<{
    cycleId: string;
    cycleName: string;
    /** 最近3个周期的溢出值序列 */
    overflowSequence: number[];
    /** 连续负值周期数 */
    consecutiveNegativeCount: number;
    /** 溢出恶化的根因假设（初步，供诊断循环使用） */
    preliminaryHypothesis?: string;
  }>;

  /** 建议的诊断范围 */
  suggestedDiagnosisScope: {
    /** 建议的诊断 Playbook */
    playbookId: string;
    /** 建议聚焦的断裂点 */
    focusFracturePoints: string[];
    /** 建议参与的专家 */
    suggestedExperts: string[];
  };
}

/**
 * 溢出监控循环调用此函数触发诊断。
 *
 * 调用路径：OverflowMonitorLoop → diagnosis-launcher.ts → FDE pipeline
 * 具体实现：src/agent/diagnosis-launcher.ts
 *
 * @param trigger - 溢出→诊断触发决策
 * @returns diagnosisExecutionId - 诊断执行ID，用于追踪
 */
function launchDiagnosisFromOverflow(
  trigger: OverflowDiagnosisTrigger
): Promise<{
  diagnosisExecutionId: string;
  status: 'launched' | 'queued' | 'rejected';
  reason?: string;
}>;

/**
 * 反方向接口：诊断循环完成后的回调。
 *
 * 诊断循环在完成诊断后，调用此函数通知溢出监控循环：
 * "你触发的诊断已完成，这是诊断报告ID，看看诊断结果验证了你的假设吗？"
 *
 * @param diagnosisReportId - 诊断报告ID
 * @param triggerVerification - 诊断结果是否验证了溢出监控的初步假设
 */
function onDiagnosisComplete(
  diagnosisReportId: string,
  triggerVerification: {
    /** 诊断是否验证了溢出监控的初步假设 */
    hypothesisVerified: boolean;
    /** 诊断发现的实际根因 */
    actualRootCause: string;
    /** 溢出监控可以从此诊断中学习的教训 */
    lessonsForOverflowMonitor: string;
  }
): Promise<void>;
```

### 4.2.3 接口2 —→ 导航循环

```typescript
/**
 * 溢出监控循环 → 导航循环 接口。
 *
 * 当特定子循环溢出恶化（但不满足"连续3周期<0"的诊断触发条件）时，
 * 溢出监控循环自动为恶化的子循环生成 Goal，交给导航循环追踪。
 *
 * @signature overflowToNavigation
 * @caller OverflowMonitorLoop.execute()
 * @callee 权威13 Goal 生成 + Proposal 三选一
 */

/**
 * 溢出恶化 → Goal 自动生成请求。
 */
interface OverflowGoalGenerationRequest {
  /** 溢出来源子循环 */
  sourceCycleId: string;

  /** 当前溢出快照 */
  currentSnapshot: OverflowSnapshot;

  /** 溢出恶化方向 */
  deteriorationDirection: string;

  /** 建议的 Goal 模板 */
  goalTemplate: {
    type: 'efficiency' | 'growth' | 'structural' | 'defensive';
    title: string;
    description: string;
    /** 目标指标（从溢出 formula 参数中提取） */
    targetMetric: {
      measurement: {
        type: 'compute' | 'edge_param';
        sourceId: string;
        field: string;
      };
      currentBaseline: number;
      targetValue: number;
      unit: string;
    };
  };
}

/**
 * 溢出监控循环调用此函数为恶化的子循环自动生成 Goal。
 *
 * 调用路径：OverflowMonitorLoop → goal-generation.ts → Proposal → Goal
 *
 * @param request - 溢出→Goal 生成请求
 * @returns 生成的 Goal ID 和 Proposal ID
 */
function generateGoalFromOverflow(
  request: OverflowGoalGenerationRequest
): Promise<{
  proposalId: string;
  goalId: string;
  status: 'created' | 'pending_approval';
  /** Proposal 三选一确认截止时间 */
  confirmationDeadline: string;
}>;
```

### 4.2.4 接口3 —→ GA进化循环

```typescript
/**
 * 溢出监控循环 → GA进化循环 接口。
 *
 * 溢出监控循环持续记录子循环溢出趋势，这些数据供 GA 进化循环用于：
 *   1. 阈值校准（什么算"正常"溢出范围？行业基准vs企业历史）
 *   2. Playbook 进化（什么触发条件最有效？）
 *   3. 因果边弹性系数校准（传导模拟的精度随数据积累提高）
 *
 * @signature overflowToGAEvolution
 */

/**
 * 溢出趋势数据包——定期推送给 GA 进化循环。
 */
interface OverflowTrendBundle {
  enterpriseId: string;
  period: { start: string; end: string };

  /** 各子循环在 period 内的溢出趋势 */
  cycleTrends: Array<{
    cycleId: string;
    /** 周期内的平均溢出值 */
    avgOverflow: number;
    /** 溢出的标准差（波动性） */
    overflowVolatility: number;
    /** 溢出从正转负的次数 */
    signFlipCount: number;
    /** 是否在周期内触发了诊断 */
    triggeredDiagnosis: boolean;
    /** 是否在周期内触发了 Goal 生成 */
    triggeredGoal: boolean;
  }>;

  /** 跨子循环传导验证——传导预测与实际结果的对比 */
  propagationAccuracy: Array<{
    timelineId: string;
    predictedDirection: string;
    actualDirection: string;
    predictionAccuracy: number; // 0-1
  }>;
}

/**
 * 溢出监控循环在每个诊断周期结束后调用此函数，推送趋势数据给 GA 进化循环。
 *
 * @param bundle - 溢出趋势数据包
 */
function pushOverflowTrendsToGAEvolution(
  bundle: OverflowTrendBundle
): Promise<void>;
```

### 4.2.5 接口4 —→ 系统自检循环

```typescript
/**
 * 溢出监控循环 → 系统自检循环 接口。
 *
 * 当所有子循环溢出为正时，溢出监控循环计算"企业健康度评分"并推送给系统自检循环。
 * 系统自检循环将此评分纳入 Health Check 报告。
 *
 * @signature overflowToSelfCheck
 */

/**
 * 企业健康度评分。
 */
interface EnterpriseHealthScore {
  enterpriseId: string;
  computedAt: string;

  /** 综合健康度（0-100），基于所有子循环溢出加权平均 */
  overallScore: number;

  /** 各子循环的健康度贡献 */
  cycleScores: Array<{
    cycleId: string;
    cycleName: string;
    score: number;        // 0-100
    weight: number;       // 该子循环在综合评分中的权重
    trend: 'improving' | 'declining' | 'stable';
  }>;

  /** 与上一周期的对比 */
  delta: {
    overallDelta: number;
    cycleDeltas: Array<{ cycleId: string; delta: number }>;
  };
}

/**
 * 溢出监控循环在溢出为正时调用此函数，更新系统自检循环的健康度评分。
 *
 * 调用路径：OverflowMonitorLoop → self-check-loop.ts:updateHealthScore()
 *
 * @param score - 企业健康度评分
 */
function updateEnterpriseHealthScore(
  score: EnterpriseHealthScore
): Promise<void>;
```

### 4.2.6 接口5 —→ 知识积累循环

```typescript
/**
 * 溢出监控循环 → 知识积累循环 接口。
 *
 * 每次溢出计算完成后，将溢出快照写入知识库，供跨企业基准聚合使用。
 *
 * @signature overflowToKnowledge
 */

/**
 * 溢出监控循环调用此函数将溢出快照写入知识库。
 *
 * @param snapshot - 溢出快照（含去敏处理后的数据）
 */
function writeOverflowToKnowledgeStore(
  snapshot: OverflowSnapshot & { enterpriseId: string }
): Promise<void>;
```

---

## 4.3 计算周期绑定到子循环业务周期

### 4.3.1 设计原则

研究方案 §4.2 确定了核心需求："不同子循环的溢出变化节奏不同——不能统一14天。"

溢出监控循环的 `execute()` 函数支持 `targetCycles` 参数。当 `triggerSource = 'cron_cycle_period'` 时，仅计算指定子循环的溢出。每个子循环的计算周期绑定到其业务本质：

| 子循环类型 | 计算周期 | 绑定理由 |
|-----------|---------|---------|
| 现金流循环 | 每周 | 现金流波动快（应收账款/应付账款以天计），需要及时感知 |
| 客户循环 | 月度或季度 | LTV 是季度级指标，月度 churn 有统计噪声 |
| 人才循环 | 月度 | 人均产出短期波动是噪音（受节假日/项目周期影响） |
| 产品循环 | 月度 | 新功能采纳率有统计延迟（用户行为变化以周计） |
| 门店复制循环 | 月度 | 单店盈利需要月度数据，新店开业以月计 |
| ARR 增长循环 | 月度 | SaaS MRR/ARR 是月度核心指标 |
| 品牌循环 | 季度 | 品牌认知变化以季度为单位（调研/搜索量） |
| 创新循环 | 季度 | 研发投入到上市以年计——季度是最小有意义的周期 |

### 4.3.2 计算周期配置

每个子循环的 `cycle.json` 中定义计算周期（研究方案 §2.3 中尚未包含此字段，此处定义扩展）：

```json
{
  "cycleId": "cash-flow-cycle",
  "computationSchedule": {
    "frequency": "weekly",
    "dayOfWeek": "monday",
    "hourUtc": 2,
    "dataLookbackMonths": 3
  }
}
```

### 4.3.3 Cron 作业注册

当 `CycleRegistry` 加载一个新子循环时，自动在 `CronScheduler` 中注册一个作业：

```typescript
function registerCycleComputationJob(cycle: CycleConfig): void {
  const schedule = cycle.computationSchedule;

  // 将 frequency 转换为 cron 表达式
  const cronExpression = frequencyToCron(schedule.frequency, schedule.dayOfWeek, schedule.hourUtc);

  CronScheduler.register({
    jobId: `overflow-compute-${cycle.cycleId}`,
    cronExpression,
    handler: async () => {
      await OverflowMonitorLoop.execute('cron_cycle_period', [cycle.cycleId]);
    },
    priority: 'high', // 溢出计算优先级高于导航循环
  });
}
```

---

## 4.4 与权威14 MVS 的集成

### 4.4.1 MVS 阶段的溢出监控策略

权威14 第四章定义了 MVS（最小可用系统）——一周时间、一台机器、一个客户（客户A），跑通"诊断→增长导航"的最小子集。

**MVS 阶段不实现完整的溢出监控循环。** MVS 阶段使用**静态数据模型**展示溢出概念：

- **MVS 内置 4 个子循环模板**（现金流/客户/人才/产品）作为静态配置
- **不启动动态循环注册和 Cron 调度**——溢出值是手动计算后填入的演示数据
- **溢出仪表盘展示静态热力图**（使用客户A历史数据回填的 12 个月快照）
- **投入建议引擎的模拟功能使用硬编码的弹性系数**（不依赖 42 边的实时参数）

MVS 阶段的溢出相关实现清单：

| MVS 组件 | 实现内容 | 与完整版的差距 |
|---------|---------|--------------|
| `cycles/builtin/` | 4 个 `*.cycle.json` 文件（现金流/客户/人才/产品） | 完整版需 15-20 个行业模板 + 动态注册 |
| 溢出仪表盘 | 静态渲染的仪表盘行 + 热力图（客户A历史数据） | 完整版需动态生成 + WebSocket 推送 |
| 投入建议引擎 | 硬编码弹性系数的传导模拟（客户A单一案例） | 完整版需动态从 42 边读取弹性系数 |
| 溢出监控循环 | **不实现**——使用静态快照替代 | 完整版需 Cron + 五循环接口 |

### 4.4.2 MVS → 完整版的扩展路径

MVS 之后的第一个扩展目标：**溢出监控循环上线**。

扩展步骤（按优先级排序）：

1. **动态循环注册**：`CycleRegistry` 加载器上线 → 扫描 `cycles/` 目录 → 匹配企业行业
2. **溢出计算管线**：`OverflowMonitorLoop.execute()` 上线 → 消费 `cycle.overflowFormula` → 追踪 42 边参数 → 计算溢出值
3. **Cron 调度注册**：`registerCycleComputationJob()` 上线 → 每个子循环按业务周期注册 Cron 作业
4. **五循环接口实现**：§4.2 定义的 5 个函数签名逐一实现 → 溢出监控循环接入诊断/导航/GA进化/自检/知识积累
5. **哨兵异常信号触发**：§4.1.3 的触发源3上线 → 5个 CRITICAL 哨兵触发紧急溢出检测

---


## 4.4-A 溢出趋势计算（在溢出监控循环每次执行时自动运行）

溢出监控循环不仅计算"当前溢出值"，还计算"趋势"——这是触发后续动作的关键输入。趋势恶化的告警优先级高于绝对值偏低。

### 趋势计算时机

每次溢出监控循环触发时（按子循环绑定的业务周期），同步计算：
1. 环比（vs 上一周期）
2. 同比（vs 去年同周期，数据不足12个月时跳过）
3. N周期趋势方向（N=3，Mann-Kendall检验）
4. 连续转负/转正的周期计数

### 趋势驱动的告警逻辑

趋势信号比绝对值信号更具行动价值：

| 趋势组合 | 严重度 | 触发动作 |
|---------|--------|---------|
| 溢出为正 + 环比正 + 趋势上升 | INFO | 仅记录。系统保持静默。 |
| 溢出为正 + 环比负 + 趋势下降 | WARNING | 推送趋势告警。"客户循环溢出仍为正（+5%），但已连续3月环比下降（上季+12%→+8%→+5%）。建议关注。"
| 溢出趋于零 + 趋势下降 | WARNING | 推送预警。"现金流溢出趋于零（+0.3%），且连续2月下降。如果不采取行动，预计下月转负。"
| 溢出转负 + 连续1周期 | CRITICAL | 触发全量诊断循环。"人才循环溢出转负（-3%），首次出现。触发人才留存诊断。"
| 溢出转负 + 连续3周期 | CRITICAL | 触发Goal自动生成 + GA紧急通知。"人才循环连续3月负溢出（-3%/-5%/-8%），趋势加速恶化。自动生成紧急Goal。"

### 趋势数据存储

每次溢出监控循环执行后，写入 `OverflowSnapshot` 到 GraphStore，包含完整的同比/环比/趋势字段。这些数据供溢出仪表盘（第二章节）和投入建议引擎（第三章节）消费。


## 4.5 溢出监控循环的降级策略

| 场景 | 降级行为 |
|------|---------|
| `CycleRegistry` 加载失败（无匹配的子循环） | 系统降级为"无溢出监控模式"——诊断循环按原固定14天周期运行 |
| 某个子循环的 `overflowFormula` 参数全部不可计算 | 该子循环标记 `degraded: true`，溢出仪表盘上该行显示"数据不足" |
| CronScheduler 故障（作业未触发） | 溢出监控循环在上一次已知的溢出值上做线性推断 → 标注"推定值" |
| 与诊断循环的接口调用失败 | 记录 log.error → 不阻断溢出监控循环自身 → 下次周期重试 |

---

> **版本历史**：v1.0 — 2026-07-14 — 初始版本。6th Loop 调度模型 + 与五循环的5个函数签名级接口 + 计算周期绑定 + MVS 扩展路径。