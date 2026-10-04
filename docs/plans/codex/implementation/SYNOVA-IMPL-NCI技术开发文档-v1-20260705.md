# SYNOVA-IMPL-NCI技术开发文档-v1-20260705

> 版本: v1.0 | 日期: 2026-07-05 | 状态: 实施中
> 关联方案: ../strategy/SYNOVA-WHITEPAPER-NCI非共识检测白皮书-20260705.html
> 关联方案: ../strategy/SYNOVA-DESIGN-本体层最终规范-v2.4-20260704.html
> 前置依赖: 本体层Task A+B完成（graph-traversal.ts, temporal-baseline.ts, 新本体JSON Schema全部就位）

## 0. 执行前必读

### 0.1 Anthropic工程原则（贯穿全文）
1. 一次性切换，零兼容层，零过渡期。
2. 用自动化验证器确保切换后输出不变，切换后立即删除旧代码。
3. 并行化一切可并行的工作。
4. 只新增文件，不修改存量代码（最小侵入原则）。

### 0.2 铁律速查
- 铁律24: 每个catch必须有log.warn/error + 返回degraded:true
- 铁律31: 降级标记传播
- 铁律38: as any 零容忍
- B模式禁止: 跨哨兵目录import
- 新增告警禁止静默: 新export有调用方

### 0.3 前置依赖确认
开始前必须确认以下文件已由Task A产出：
```bash
ls src/l4/graph-traversal.ts                  # 必须存在
ls src/l4/temporal-baseline.ts                # 必须存在
ls extensions/ontology/resource/money.json    # 必须存在
ls extensions/ontology/edge-types/deploys.json # 必须存在
```
（全部16条新边JSON和29个实体JSON必须在位）

### 0.4 本任务不做什么
- 不新增边类型JSON（16条边不变）
- 不新增核心实体JSON（10个实体不变）
- 不修改任何现有compute函数
- 不修改现有哨兵的aggregate.ts
- 不修改sentinel-loader.ts

### 0.5 本任务新增什么
- 1个Signal实体定义（辅助观察层，轻量级）
- 1个NCI哨兵目录（标准哨兵结构）
- 8个compute函数
- 1个aggregate.ts
- 1个manifest.json
- IM路由扩展逻辑（在已有im.ts上追加代码块）
- 单元测试文件
- 客户A验证用例

---

## 1. Phase 0：Signal实体与IM管道扩展（2天）

### 1.1 任务清单

| # | 任务 | 文件 | 验收 |
|---|------|------|------|
| 0.1 | 创建Signal实体JSON Schema | `extensions/ontology/signal/signal.json` | `$id:"signal/nonconsensus"`, 字段含source/content/key_themes/contradicts_consensus/lifecycle_stage/author_id/reference_count |
| 0.2 | 扩展IM路由 | `src/routes/im.ts` | 在已有消息处理逻辑后追加LLM轻量分类代码块。不删不改已有逻辑 |
| 0.3 | 创建Signal写入器 | `src/l4/signal-writer.ts` | createSignal(store, signalData) → Signal节点写入图数据库 |
| 0.4 | 单元测试 | `src/l4/signal-writer.test.ts` |
| 0.5 | 生命周期追踪器 | `src/l4/signal-lifecycle-tracker.ts` |
| 0.6 | 生命周期测试 | `src/l4/signal-lifecycle-tracker.test.ts` | | 创建Signal→读回→验证字段完整性 |

### 1.2 Signal实体JSON Schema

```json
{
  "$id": "signal/nonconsensus",
  "label": "Signal",
  "tags": ["signal", "observation", "auxiliary"],
  "description": "非共识信号——辅助观察层实体，与ANOMALY_EVENT同级。不是核心实体。",
  "requiredProps": ["source", "content", "timestamp"],
  "optionalProps": {
    "source": { "type": "string", "enum": ["im_message", "meeting_note", "ga_conversation", "sales_feedback", "founder_remark"] },
    "content": { "type": "string" },
    "key_themes": { "type": "array", "items": { "type": "string" } },
    "involves_cost_structure": { "type": "boolean" },
    "involves_new_business_model": { "type": "boolean" },
    "contradicts_consensus": { "type": "boolean" },
    "author_id": { "type": "string" },
    "related_activity_ids": { "type": "array", "items": { "type": "string" } },
    "lifecycle_stage": { "type": "string", "enum": ["raw","first_mentioned","discussed","budgeted","adopted","abandoned","silenced","zombie"] },
    "last_referenced_at": { "type": "string" },
    "reference_count": { "type": "number" },
    "resource_allocation_delta": { "type": "number" },
    "importance_level": { "type": "number", "min": 1, "max": 5 },
    "ga_dismissed": { "type": "boolean" },
    "ga_dismiss_reason": { "type": "string" }
  }
}
```

### 1.3 IM路由扩展逻辑（在已有im.ts末尾追加，不删不改已有代码）

```typescript
// === NCI Signal Pipeline (Phase 0 — appended to existing im.ts) ===

async function processNciSignal(message: IMessage): Promise<void> {
  const classification = await llmLightClassify(message.text);
  if (!classification.involves_cost_structure && !classification.involves_new_business_model) return;
  if (!classification.contradicts_consensus) return;
  
  await signalWriter.createSignal(store, {
    source: 'im_message',
    content: message.text.substring(0, 500),
    key_themes: classification.themes,
    involves_cost_structure: classification.involves_cost_structure,
    involves_new_business_model: classification.involves_new_business_model,
    contradicts_consensus: classification.contradicts_consensus,
    author_id: message.senderId,
    timestamp: new Date().toISOString(),
    lifecycle_stage: 'raw'
  });
}

// LLM轻量分类prompt（每次调用<500 tokens）
async function llmLightClassify(text: string): Promise<SignalClassification> {
  // Prompt: "这条消息是否涉及成本结构或新商业模式的讨论？是否与当前企业OKR方向不一致？提取1-3个关键主题标签。"
  // 返回结构化JSON
}
```

### 1.4 Phase 0验收

```bash
# 文件存在性
ls extensions/ontology/signal/signal.json
ls src/l4/signal-writer.ts
ls src/l4/signal-writer.test.ts

# 编译
npx tsc --noEmit

# 单元测试
npx vitest run src/l4/signal-writer.test.ts
```

---


## 1A. Phase 0.5：Signal生命周期追踪器（1天）

### 1A.1 任务

| # | 任务 | 文件 | 验收 |
|---|------|------|------|
| 0.5.1 | 创建生命周期追踪器 | `src/l4/signal-lifecycle-tracker.ts` | 每周扫描Signal节点，更新lifecycle_stage/reference_count/last_referenced_at |
| 0.5.2 | 沉默触发器 | 同上 | 90天未被任何正式流程引用→lifecycle='silenced' |
| 0.5.3 | 僵尸信号检测器 | 同上 | reference_count>5且resource_allocation_delta=0→lifecycle='zombie'。触发"决策瘫痪"警报而非"沉默"警报 |
| 0.5.4 | 单元测试 | `src/l4/signal-lifecycle-tracker.test.ts` | 模拟Signal→90天未引用→silenced。模拟Signal→引用5次+零预算→zombie |

### 1A.2 核心逻辑

```typescript
// src/l4/signal-lifecycle-tracker.ts

export function trackSignalLifecycle(store: GraphStoreReader, teamId: string): void {
  const signals = store.queryNodes('signal/nonconsensus', { 
    teamId,
    lifecycle_stage: { $nin: ['adopted', 'abandoned'] }
  });
  
  const now = Date.now();
  
  for (const signal of signals) {
    const daysSinceCreation = (now - new Date(signal.props.timestamp).getTime()) / 86400000;
    const daysSinceLastRef = (now - new Date(signal.props.last_referenced_at || signal.props.timestamp).getTime()) / 86400000;
    
    // 沉默检测: 90天未被任何正式流程引用
    if (daysSinceCreation > 90 && daysSinceLastRef > 90 && signal.props.reference_count === 0) {
      signal.props.lifecycle_stage = 'silenced';
      // 检查contradicts_consensus——区分"被压制的非共识"和"自然淘汰"
      if (signal.props.contradicts_consensus) {
        createSilenceAlert(signal, 'nonconsensus_silenced');
      }
    }
    
    // 僵尸信号检测: 被频繁讨论但从未有预算/人员变动
    if (signal.props.reference_count > 5 && (signal.props.resource_allocation_delta || 0) === 0) {
      signal.props.lifecycle_stage = 'zombie';
      createSilenceAlert(signal, 'decision_paralysis');
    }
    
    // 重复沉默检测: 同类型信号12个月内>=3次被沉默→系统性认知盲区
    const similarSilenced = store.queryNodes('signal/nonconsensus', {
      key_themes: { $in: signal.props.key_themes },
      lifecycle_stage: 'silenced',
      timestamp: { $gte: new Date(now - 365*86400000).toISOString() }
    });
    if (similarSilenced.length >= 3) {
      createSilenceAlert(signal, 'systematic_blind_spot');
    }
  }
}
```

### 1A.3 规模-风险弹性系数

```typescript
/**
 * NCI四层防御的第三层——生存底线检查。引入规模-风险弹性系数。
 * 
 * - 员工<20人: 取消硬性投入上限。改为"可行性实验设计"输出
 * - 员工20-100人: 动态上限 = max(10%, 现金跑道/24个月)
 * - 员工>100人: 维持10-15%投入上限
 */
export function getRiskElasticityLimit(
  store: GraphStoreReader,
  teamId: string
): { maxInvestmentPercent: number; mode: 'experiment' | 'dynamic' | 'standard' } {
  const headcount = store.queryNodes('resource/person', { teamId }).length;
  
  if (headcount < 20) {
    return { maxInvestmentPercent: -1, mode: 'experiment' };
    // mode='experiment': "我们没有足够数据判断这是否可行。这是成本最低的验证实验方案(建议1个月,0元成本),做完了我们再谈。"
  }
  if (headcount <= 100) {
    const runway = getCashRunway(store, teamId);
    return { maxInvestmentPercent: Math.max(10, 100 * (runway / 24)), mode: 'dynamic' };
  }
  return { maxInvestmentPercent: 15, mode: 'standard' };
}
```

### 1A.4 验收

```bash
ls src/l4/signal-lifecycle-tracker.ts
ls src/l4/signal-lifecycle-tracker.test.ts
npx tsc --noEmit
npx vitest run src/l4/signal-lifecycle-tracker.test.ts
```


## 2. Phase 1：NCI哨兵创建（4天）

### 2.1 目录结构

```
extensions/sentinels/nci/
  manifest.json
  aggregate.ts
  computes/
    cognitive-divergence.ts
    cost-fracture.ts
    value-network-mismatch.ts
    stm-index.ts
    odc.ts
    nci-aggregate.ts
    last-stand-trigger.ts
    signal-quality.ts
  computes/
    cognitive-divergence.test.ts
    cost-fracture.test.ts
    value-network-mismatch.test.ts
    nci-aggregate.test.ts
```

### 2.2 manifest.json

```json
{
  "$schema": "https://synova.dev/schemas/sentinel-manifest-v1.json",
  "name": "nci",
  "version": "1.0.0",
  "type": "sentinel",
  "displayName": "非共识检测指数（NCI）",
  "description": "Non-Consensus Index: 捕捉企业内部被组织免疫系统过滤掉的非共识信号。三因子模型（认知偏离+成本断裂+价值网络错配）×时机成熟度×消化能力。",
  "schedule": "0 0 1 * *",
  "expert": "strategy",
  "auxiliaryExperts": ["business_model", "org"],
  "priority": "P1",
  "layer": "interface",
  "computeKind": "aggregate",
  "computes": [
    "cognitive-divergence",
    "cost-fracture",
    "value-network-mismatch",
    "stm-index",
    "odc",
    "nci-aggregate",
    "last-stand-trigger",
    "signal-quality"
  ],
  "thresholds": {
    "nci_score": { "warning": 40, "critical": 70 }
  },
  "aggregation": "weighted_average",
  "context": {
    "requiredDataSources": ["sog_graph", "signal_nodes", "external_baseline"],
    "dataAccess": { "allowedDimensions": ["strategic", "financial", "organizational"], "sensitiveAccess": "read" }
  },
  "entryPoint": "./aggregate.ts",
  "exportKey": "nciSentinel"
}
```

### 2.3 8个compute函数的签名与核心逻辑

#### compute-cognitive-divergence.ts

```typescript
/**
 * 认知偏离度 = 内部共识强度 × 外部共识逆强度
 * 
 * 内部共识强度: 1 - SIGNAL_TRANSMITS.filter_bias (内部越一致，强度越高)
 * 外部共识逆强度: 1 - (AdversarialFrame中看好此方向的玩家比例)
 * 
 * 对抗性关键: 特斯拉2010——内部极度一致(0.9)×外部极度看空(0.95)=0.855
 *              GoogleGlass 2013——内部一致(0.8)×外部看好(0.4)=0.32（低）
 */
export function computeCognitiveDivergence(
  store: GraphStoreReader,
  traversal: GraphTraversal,
  teamId: string
): { divergence: number; internalConsensus: number; externalInverse: number; degraded: boolean } {
  // 1. 沿SIGNAL_TRANSMITS边读取filter_bias → 内部共识强度 = 1 - filter_bias
  // 2. 从AdversarialFrame读取竞争对手在类似方向上的资源配置比例 → 外部看好度
  // 3. 外部共识逆强度 = 1 - 外部看好度
  // 4. 认知偏离度 = 内部共识强度 × 外部共识逆强度
}
```

#### compute-cost-fracture.ts

```typescript
/**
 * 成本断裂度: 新旧路线成本比值。数据缺失时触发第一性原理断层扫描。
 * 
 * 正常模式: CUMULATIVE_LEARNING.learning_rate的新旧对比 + Pettitt突变检测
 * 断层模式: 理论最小成本(ExternalBaseline物理极限) / 行业当前成本
 * 
 * 对抗性关键: 拼多多2015——无历史数据→触发第一性原理→电商获客下限=微信DAU/裂变率→当前成本×0.1→赋值70
 */
export function computeCostFracture(
  store: GraphStoreReader,
  traversal: GraphTraversal,
  teamId: string
): { fracture: number; mode: 'empirical' | 'first_principles'; degraded: boolean } {
  // 1. 尝试从CUMULATIVE_LEARNING读learning_rate序列
  // 2. 有数据→Pettitt检测→正常计算
  // 3. 无数据→ExternalBaseline读物理极限→理论最小成本/当前成本→第一性原理模式
}
```

#### compute-value-network-mismatch.ts

```typescript
/**
 * 价值网络错配度: 资产新旧估值差异。
 * 
 * 来源: ASSET_LOCKS.asset_second_life_ratio的突变 + AdversarialFrame配置权重差异
 * 
 * 对抗性关键: 追觅2018——高速电机在旧系统(戴森垄断)=无价值,新系统(中国供应链)=核心资产→错配度85
 */
export function computeValueNetworkMismatch(
  store: GraphStoreReader,
  traversal: GraphTraversal,
  teamId: string
): { mismatch: number; contestedAsset: string; degraded: boolean } {
  // 1. 扫描ASSET_LOCKS边找second_life_ratio突变的资产
  // 2. 对比AdversarialFrame中竞争对手的配置权重
  // 3. 差异>50%→错配
}
```

#### compute-stm-index.ts

```typescript
/**
 * STM_Index = Σ(weight_i × readiness_i) × urgency_factor
 * 
 * 10项基础设施阈值从ExternalBaseline读取。
 * AUC=0.87（100案例回溯验证）。
 */
export function computeStmIndex(
  store: GraphStoreReader,
  teamId: string
): { stm: number; readiness: Record<string,number>; urgencyFactor: number; degraded: boolean } {
  // 1. ExternalBaseline读当前10项基础设施渗透率
  // 2. 读方向依赖的权重矩阵（extensions/physical_limits/{industry}.json）
  // 3. readiness_i = min(渗透率/临界值, 1.0)
  // 4. urgency_factor: 刚跨越临界→1.30, 早已成熟→1.00, 远未就绪→0.50
}
```

#### compute-odc.ts

```typescript
/**
 * ODC = 0.35×E_m + 0.30×S_r + 0.20×talent_density + 0.15×data_readiness
 */
export function computeOdc(
  store: GraphStoreReader,
  traversal: GraphTraversal,
  teamId: string
): { odc: number; components: Record<string,number>; degraded: boolean } {
  // E_m: DEPLOYS边的deployment_period倒数均值
  // S_r: ASSET_LOCKS边的asset_second_life_ratio均值
  // talent_density: PERSON.competency_vector中skill_level>0.7的比例
  // data_readiness: DATA.completeness×(1-silo_status)
}
```

#### compute-nci-aggregate.ts

```typescript
/**
 * NCI = 0.40×认知偏离 + 0.35×成本断裂 + 0.25×价值网络错配
 * 扣减: ODC不足(×0.8 if ODC<0.4) + STM时机惩罚(×0.5 if STM<0.3)
 * 
 * 分类: >=70高非共识 | 40-69中非共识 | <40低非共识 | 数据不足→待验证
 */
export function computeNciAggregate(
  cognitiveDivergence: number,
  costFracture: number,
  valueMismatch: number,
  stmIndex: number,
  odc: number
): { nci: number; classification: string; adjustments: string[] } {
  let nci = 0.40*cognitiveDivergence + 0.35*costFracture + 0.25*valueMismatch;
  const adjustments: string[] = [];
  if (odc < 0.4) { nci *= 0.8; adjustments.push('ODC不足扣减'); }
  if (stmIndex < 0.3) { nci *= 0.5; adjustments.push('STM时机惩罚'); }
  const classification = nci >= 70 ? 'high' : nci >= 40 ? 'medium' : 'low';
  return { nci, classification, adjustments };
}
```

#### compute-last-stand-trigger.ts

```typescript
/**
 * 背水一战触发条件（三者同时满足）:
 *   现金跑道 < 6个月
 *   AND NCI >= 70
 *   AND 三阶推理引擎推荐战略原型ROI < 1
 * 
 * ⚠️ 输出必须经过GA人工审核才能进入最终报告。
 * ⚠️ 系统不能自动向企业主呈现死亡概率预测。
 */
export function computeLastStandTrigger(
  store: GraphStoreReader,
  nci: number,
  t3eROI: number,
  teamId: string
): { triggered: boolean; deathProb: number; months: number; requiresGAReview: true } {
  const cash = MONEY.context['CashPosition'].cash_balance;
  const burn = MONEY.context['CostCenter'].total_cost / 12;
  const runway = cash / (burn || 1);
  const triggered = runway < 6 && nci >= 70 && t3eROI < 1;
  return { triggered, deathProb: triggered ? estimateDeathProb(runway) : 0, months: Math.floor(runway), requiresGAReview: true };
}
```

#### compute-signal-quality.ts

```typescript
/**
 * 信号质量评估: 基于提出者历史验证率 + GA驳回标记 + 数据支撑度
 * 低分信号的NCI自动降权（权重×0.3）
 * 
 * GA驳回机制: 同一提出者的后续信号NCI降权，防止系统被低质量信号淹没
 */
export function computeSignalQuality(
  store: GraphStoreReader,
  teamId: string
): { quality: number; downgraded: boolean; dismissedByGA: boolean } {
  // 1. 扫描Signal节点，按author_id分组
  // 2. 计算每个提出者的历史信号验证率
  // 3. ga_dismissed=true→质量=0，同一提出者全部降权
}
```

### 2.4 Phase 1验收

```bash
# 文件计数
ls extensions/sentinels/nci/computes/*.ts | wc -l  # 应为8

# 编译
npx tsc --noEmit

# 单元测试
npx vitest run extensions/sentinels/nci/computes/*.test.ts

# 铁律检查
grep -rn "as any" extensions/sentinels/nci/  # 必须零结果
```

---

## 3. Phase 2：aggregate.ts + 端到端验证（2天）

### 3.1 aggregate.ts

```typescript
// extensions/sentinels/nci/aggregate.ts
import type { SentinelFinding } from '../../../src/sentinel/types';
import { computeCognitiveDivergence } from './computes/cognitive-divergence';
import { computeCostFracture } from './computes/cost-fracture';
import { computeValueNetworkMismatch } from './computes/value-network-mismatch';
import { computeStmIndex } from './computes/stm-index';
import { computeOdc } from './computes/odc';
import { computeNciAggregate } from './computes/nci-aggregate';
import { computeLastStandTrigger } from './computes/last-stand-trigger';
import { computeSignalQuality } from './computes/signal-quality';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/nci');

export const nciSentinel = {
  async check(store: GraphStoreReader, traversal: GraphTraversal, teamId: string): Promise<SentinelFinding[]> {
    const now = new Date(); const checkedAt = now.toISOString();
    try {
      const signals = store.queryNodes('signal/nonconsensus', { teamId });
      if (signals.length === 0) return []; // 无信号→不产生Finding

      const sigQuality = computeSignalQuality(store, teamId);
      const divergence = computeCognitiveDivergence(store, traversal, teamId);
      const fracture = computeCostFracture(store, traversal, teamId);
      const mismatch = computeValueNetworkMismatch(store, traversal, teamId);
      const stm = computeStmIndex(store, teamId);
      const odc = computeOdc(store, traversal, teamId);
      
      const { nci, classification, adjustments } = computeNciAggregate(
        divergence.divergence, fracture.fracture, mismatch.mismatch, stm.stm, odc.odc
      );
      
      // 信号质量降权
      const finalNci = sigQuality.quality < 30 ? nci * 0.3 : nci;
      
      const findings: SentinelFinding[] = [];
      
      if (finalNci >= 70 || classification === 'high') {
        findings.push({
          id: `nci-high-${now.getTime()}`,
          severity: 'warning',
          title: `高非共识机会 (NCI=${finalNci.toFixed(0)}/100)`,
          description: `认知偏离${divergence.divergence.toFixed(0)}/成本断裂${fracture.fracture.toFixed(0)}/价值错配${mismatch.mismatch.toFixed(0)}`,
          evidence: [`NCI: ${finalNci.toFixed(0)}`, `STM: ${stm.stm.toFixed(2)}`, `ODC: ${odc.odc.toFixed(2)}`, ...adjustments],
          suggestion: '建立专门探索团队，评估资源投入。详细信息见NCI诊断报告章节。',
          detectedAt: checkedAt
        });
      }
      
      // 背水一战检查
      const lastStand = computeLastStandTrigger(store, finalNci, 0.5, teamId);
      if (lastStand.triggered) {
        findings.push({
          id: `nci-laststand-${now.getTime()}`,
          severity: 'critical',
          title: '背水一战模式触发',
          description: `现金跑道${lastStand.months}个月。此警报需GA人工审核后才能进入报告。`,
          evidence: [`NCI: ${finalNci.toFixed(0)}`, `Runway: ${lastStand.months}mo`],
          suggestion: '请GA评估后决定是否向企业主呈现。',
          detectedAt: checkedAt
        });
      }
      
      return findings;
    } catch (err: unknown) {
      log.error({ err }, '[nci] check failed');
      return [{ id: `nci-error-${now.getTime()}`, severity: 'warning', title: 'NCI检测异常', description: `${(err as Error)?.message}`, evidence: [], suggestion: '检查数据源', detectedAt: checkedAt }];
    }
  }
};
```

### 3.2 客户A验证用例

```typescript
// tests/e2e/nci-client-a.test.ts
import { describe, it, expect } from 'vitest';

describe('NCI — 客户A年卡方案', () => {
  it('年卡方案检测为中等非共识', async () => {
    // 模拟哇呢数据：年卡方案在会议中被多次提及(>5次), 但零预算分配
    // → 僵尸信号检测触发
    // → NCI得分应在40-69区间
    const result = await nciSentinel.check(mockWaneStore, mockTraversal, 'wane-team');
    expect(result.length).toBeGreaterThan(0);
    // 预期: 中等NCI + 决策瘫痪警报(非沉默警报)
  });

  it('OFO 2016应被判为低NCI', async () => {
    // 模拟OFO数据：高认知偏离，无成本断裂，无价值网络错配
    // → NCI<40 (低非共识)
    const result = await nciSentinel.check(mockOFOStore, mockTraversal, 'ofo-team');
    // 预期: NCI低 + 成本断裂度为0
  });
});
```

### 3.3 Phase 2验收

```bash
npx tsc --noEmit
npx vitest run extensions/sentinels/nci/computes/*.test.ts
npx vitest run tests/e2e/nci-client-a.test.ts
npm run check:iron-laws
```

---

## 4. 提交与合并

```bash
git checkout -b feat/nci-phase0-2
git add extensions/ontology/signal/ src/l4/signal-writer.ts src/l4/signal-writer.test.ts
git add src/routes/im.ts
git add extensions/sentinels/nci/
git add tests/e2e/nci-client-a.test.ts
git commit -m "feat(nci): Phase 0-2 — Signal entity, IM pipeline, NCI sentinel (8 computes), e2e tests"
git checkout main && git merge feat/nci-phase0-2
```

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| IM管道LLM分类误判率高 | Phase 0先用人工审核校准20条，建立baseline后再自动化 |
| Signal噪音过多 | contradicts_consensus过滤器严格——只有与当前OKR明显不一致的信号才入库 |
| STM_Index需要ExternalBaseline数据 | 默认使用L1行业模板或L3 LLM推理。标注数据源层级和置信度 |
| 背水一战模式社会工程风险 | 必须GA人工审核。措辞需AB测试。诚实声明中明确标注限制 |
| 企业不开放非结构化数据管道 | 诚实声明中明确标注此为NCI的根本性前提条件 |

