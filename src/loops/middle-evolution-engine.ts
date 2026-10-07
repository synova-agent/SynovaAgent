/**
 * src/loops/middle-evolution-engine.ts — 中层驱动进化引擎 (D92)
 *
 * Cycle 7: 消费 D93 中层反馈聚合信号, 生成 5 类进化动作:
 *   1. 阈值自动调整 (false alarm flagging ≥3)
 *   2. Goal目标公式调整 (same sub-cycle × same type ≥3)
 *   3. 路径排名降级 (same path rejected ≥3)
 *   4. 专家置信度降级 (same expert × breakpoint ≥3)
 *   5. 跨部门矛盾仲裁 (finance vs marketing 对立)
 * D556 追加第 6 类（回流层 2 闭环 — spec §6.2）:
 *   6. GA 校准审核 (diagnosis_conclusion × reject/modify/ineffective ≥3 → agent_memory 审核条目，
 *      不自动改诊断逻辑权重——层 3 descope，诚实边界)
 *
 * 铁律 24+31: collector 不可用 → log.warn + 返回空
 * 铁律 38: 零 as any
 */
import { createLogger } from '@synova/logger';
import type { AggregatedSignal } from '../growth/feedback-collector';
import { getAgentMemoryStore } from '../l4/agent-memory-store';

const log = createLogger('loops/middle-evolution-engine');

// ═══ Types ═══

export type EvolutionActionType =
  | 'threshold_adjust'
  | 'goal_formula_tweak'
  | 'path_rank_downgrade'
  | 'expert_confidence_downgrade'
  | 'cross_dept_arbitration'
  | 'diagnosis_calibration_review'; // D556: GA 校准回流审核（spec §6.2 追加，三既有信号类语义零变化）

/** 进化动作 — 由 processFeedbackSignals 生成的自动调整指令 */
export interface EvolutionAction {
  type: EvolutionActionType;
  /** 触发原因 */
  reason: string;
  /** 调整参数 */
  parameter: Record<string, unknown>;
  /** 置信度 0-1 */
  confidence: number;
  /** 触发时间 */
  triggeredAt: string;
}

/** GA缺席保护计算结果 */
export interface GAProtectionResult {
  /** 自动升级阈值（天） */
  autoUpgradeThreshold: number;
  /** 是否应触发升级 */
  shouldUpgrade: boolean;
  /** GA缺席天数 */
  gaAbsenceDays: number;
  /** 中层活动率 */
  middleActivityRate: number;
}

// ═══ Core: 5 signal processors ═══

/**
 * 处理 5 类进化信号，生成进化动作列表。
 *
 * 纯函数（D333 起）：只生成动作，不回写。回写由调用方执行
 * （src/agent/loop-handlers.ts defaultEvolutionHandler → applyEvolutionActions），
 * 保证一次信号周期只有一次回写（原内部直调 applyEvolutionActions 会造成双次回写，
 * correction 计数 2 倍加速，破坏 MIN_TRIGGER_COUNT=3 语义）。
 * D262 GA 反馈记录块随纯化移除（decision:'accept' 违反 FeedbackDecision 类型 +
 * feedback_log DDL CHECK，从未成功写入 = 死代码；语义修复为独立任务）。
 *
 * @param signals - D93 AggregatedSignal 数组
 * @returns 进化动作列表（无副作用）
 */
export function processFeedbackSignals(signals: AggregatedSignal[]): EvolutionAction[] {
  if (!signals || signals.length === 0) {
    return [];
  }

  const actions: EvolutionAction[] = [];

  try {
    // Signal 1: 阈值调整 — reject（false alarm）同哨兵×同分类≥3
    const thresholdSignals = signals.filter(s =>
      s.decision === 'reject' && s.targetType === 'sentinel_alert' && s.count >= 3,
    );
    for (const sig of thresholdSignals) {
      // K6/0-2: 阈值回写必须落到**配置实体**（thresholds.json 的 thresholdOverrides[sentinelKey]）。
      // 此前用 sig.key（类别级 decision:target_type:actor_role）当 sentinelKey ⇒ 永远查不到实体
      // ⇒ found=false ⇒ skipped++ ⇒ applied 恒 0 ⇒ loop-3 永远 degraded（总闸关死）。
      // 组内实体不唯一（entityKey=null）时**不猜实体**：显式告警 + 跳过（铁律 24/31，不静默）。
      // 三态（见 AggregatedSignal.entityKey 契约）：undefined=旧生产者 ⇒ 退回旧语义（用 key）；
      // null=显式"组内实体不唯一" ⇒ 不猜实体。
      const entityKey = sig.entityKey === undefined ? sig.key : sig.entityKey;
      // D1197/P0-3 跨租户写隔离（创始人红线「A 客户不能读 B 客户数据」）：
      // 阈值配置是**行业级文件**（extensions/industries/*/thresholds.json），没有企业维度；
      // 因此回写侧的不变量是「**只接受单一企业**的聚合信号」——
      //   · enterpriseId === null ⇒ **显式多企业混组**：不猜、不写，log.warn + 跳过
      //   · enterpriseId === undefined ⇒ 早于企业轴的信号生产者（测试替身/旧调用方）⇒ 按旧语义处理
      //   · enterpriseId 为字符串 ⇒ 该企业（聚合侧 GROUP BY enterprise_id 已保证单企业）
      // 仅此一处仍不够：**聚合侧必须按企业分组**（D1197 同时修 getAggregatedSignals 的 GROUP BY）。
      if (sig.enterpriseId === null) {
        log.warn(
          { key: sig.key, enterpriseIds: sig.enterpriseIds, count: sig.count },
          'threshold_adjust 跳过 — 聚合组来自多个企业（enterpriseId=null），拒绝跨租户回写配置',
        );
        continue;
      }
      if (entityKey === null) {
        log.warn(
          { key: sig.key, entityKeys: sig.entityKeys, count: sig.count },
          'threshold_adjust 跳过 — 聚合组非单一实体（entityKey=null），无法定位配置阈值实体',
        );
        continue;
      }
      actions.push({
        type: 'threshold_adjust',
        reason: `哨兵 ${sig.key} 被标注为 false alarm ${sig.count} 次，阈值可能过高`,
        parameter: { sentinelKey: entityKey, entityKeys: sig.entityKeys, adjustPercent: 5, direction: 'up' },
        confidence: Math.min(sig.count / 10, 0.9),
        triggeredAt: sig.latestTimestamp,
      });
    }

    // Signal 2: Goal目标调整 — modify 同sub-cycle×同type≥3
    const modifySignals = signals.filter(s =>
      s.decision === 'modify' && s.targetType === 'goal' && s.count >= 3,
    );
    for (const sig of modifySignals) {
      actions.push({
        type: 'goal_formula_tweak',
        reason: `Goal ${sig.key} 被中层修改 ${sig.count} 次，初始目标公式可能不准确`,
        parameter: { goalType: sig.key, weightAdjust: -0.1 },
        confidence: Math.min(sig.count / 10, 0.85),
        triggeredAt: sig.latestTimestamp,
      });
    }

    // Signal 3: 路径排名降级 — reject_path 同路径≥3
    const pathSignals = signals.filter(s =>
      s.decision === 'reject_path' && s.count >= 3,
    );
    for (const sig of pathSignals) {
      actions.push({
        type: 'path_rank_downgrade',
        reason: `路径 ${sig.key} 被拒绝 ${sig.count} 次，可能不适用当前场景`,
        parameter: { pathKey: sig.key, rankAdjust: -1 },
        confidence: Math.min(sig.count / 10, 0.8),
        triggeredAt: sig.latestTimestamp,
      });
    }

    // Signal 4: 专家置信度降级 — ineffective 同expert×breakpoint≥3
    const ineffectiveSignals = signals.filter(s =>
      s.decision === 'ineffective' && s.count >= 3,
    );
    for (const sig of ineffectiveSignals) {
      actions.push({
        type: 'expert_confidence_downgrade',
        reason: `专家 ${sig.key} 被标记为 ineffective ${sig.count} 次，推理链置信度需下调`,
        parameter: { expertKey: sig.key, confidenceAdjust: -0.15 },
        confidence: Math.min(sig.count / 10, 0.75),
        triggeredAt: sig.latestTimestamp,
      });
    }

    // Signal 5: 跨部门矛盾仲裁 — 同一事实两个不同决策
    const contradictionActions = detectContradictions(signals);
    actions.push(...contradictionActions);

    // Signal 6 (D556; spec §6.2 概念编号 Signal 5 — 文件内既有注释 Signal 5 = 矛盾仲裁，为保
    // DS6「只增不改」本信号顺延编号): GA 校准回流审核 — diagnosis_conclusion ×
    // reject/modify/ineffective ≥3（阈值与 MIN_TRIGGER_COUNT 同源）。getAggregatedSignals 已按
    // decision,target_type,actor_role 分组 → 三决策各自成组、每组一条动作（spec §6.1 动作映射表）。
    // 诚实边界: 动作 = agent_memory 审核队列条目，不自动改诊断逻辑权重（层 3 descope）。
    // 注: ineffective × diagnosis_conclusion 组同时命中既有 Signal 4（其 filter 无 targetType
    // 限定，语义不动——DS6 只增不改），重叠为既有白名单语义的既定行为，测试显式断言记录。
    const calibrationReviewSignals = signals.filter(s =>
      s.targetType === 'diagnosis_conclusion' &&
      (s.decision === 'reject' || s.decision === 'modify' || s.decision === 'ineffective') &&
      s.count >= MIN_TRIGGER_COUNT,
    );
    for (const sig of calibrationReviewSignals) {
      const decision = sig.decision;
      const hint = decision === 'reject'
        ? '结论块反复被标记错误 → 进人工审核队列'
        : decision === 'modify'
          ? 'GA 重写版本与 Agent 版本并列 → 审核队列'
          : '信号相关性降级建议 → 审核队列';
      actions.push({
        type: 'diagnosis_calibration_review',
        reason: `诊断结论 ${sig.key} 被 GA 以 ${decision} 标记 ${sig.count} 次，进入校准审核队列`,
        parameter: { decision, targetIds: sig.targetIds, sampleCount: sig.count, hint },
        confidence: Math.min(sig.count / 10, 0.9),
        triggeredAt: sig.latestTimestamp,
      });
    }

    if (actions.length > 0) {
      log.info({ actionCount: actions.length }, '进化信号处理完成');
    }

    return actions;
  } catch (err) {
    log.warn({ err }, 'processFeedbackSignals 异常 — 返回空');
    return [];
  }
}

// ═══ Contradiction arbitration ═══

interface ContradictionPair {
  finance: AggregatedSignal;
  marketing: AggregatedSignal;
  type: 'factual' | 'causal' | 'mixed';
}

/**
 * 检测并仲裁跨部门矛盾。
 */
function detectContradictions(signals: AggregatedSignal[]): EvolutionAction[] {
  const actions: EvolutionAction[] = [];

  // 查找 finance 和 marketing 对同一目标的对立反馈
  for (const a of signals) {
    for (const b of signals) {
      if (a === b) continue;
      const sharedTargets = a.targetIds.filter((id: string) => b.targetIds.includes(id));
      if (sharedTargets.length > 0 && a.decision !== b.decision) {
        const pair: ContradictionPair = {
          finance: a.key.includes('finance') ? a : b,
          marketing: a.key.includes('marketing') || b.key.includes('marketing') ? (a.key.includes('marketing') ? a : b) : a,
          type: classifyDispute(a, b),
        };

        const arbitration = arbitratePair(pair);
        if (arbitration) actions.push(arbitration);
      }
    }
  }

  return actions;
}

/**
 * 分类矛盾类型：
 * - factual: 数据层面的矛盾（可仲裁）
 * - causal: 因果判断层面的矛盾（不可仲裁）
 * - mixed: 两者兼有
 */
function classifyDispute(a: AggregatedSignal, b: AggregatedSignal): 'factual' | 'causal' | 'mixed' {
  // 如果双方引用同一指标但解读不同 → factual
  if (a.key.includes('metric') || b.key.includes('metric')) return 'factual';
  // 如果双方引用同一因果关系但结论相反 → causal
  if (a.key.includes('causal') || b.key.includes('causal')) return 'causal';
  // 默认 mixed
  return 'mixed';
}

/**
 * 对矛盾对进行仲裁评分。
 * 评分: dataConsistency(0.6) + historicalAccuracy(0.4)
 * Gap > 0.3 → 采纳高分
 * Gap ≤ 0.3 → pending_cross_validation
 */
function arbitratePair(pair: ContradictionPair): EvolutionAction | null {
  // 如果是 causal 类型 → 不可仲裁
  if (pair.type === 'causal') {
    return {
      type: 'cross_dept_arbitration',
      reason: `因果层面矛盾（${pair.finance.key} vs ${pair.marketing.key}），系统无法仲裁，标记为 pending_causal_validation`,
      parameter: { financeKey: pair.finance.key, marketingKey: pair.marketing.key, status: 'pending_causal_validation' },
      confidence: 0.3,
      triggeredAt: new Date().toISOString(),
    };
  }

  // 计算双方分数
  const scoreA = scoreDataConsistency(pair.finance) * 0.6 + scoreHistoricalAccuracy(pair.finance) * 0.4;
  const scoreB = scoreDataConsistency(pair.marketing) * 0.6 + scoreHistoricalAccuracy(pair.marketing) * 0.4;
  const gap = Math.abs(scoreA - scoreB);

  if (gap > 0.3) {
    const winner = scoreA > scoreB ? pair.finance : pair.marketing;
    const loser = scoreA > scoreB ? pair.marketing : pair.finance;
    return {
      type: 'cross_dept_arbitration',
      reason: `事实层面矛盾已仲裁：采纳 ${winner.key}（评分 ${winner.key}=${scoreA.toFixed(2)}, ${loser.key}=${scoreB.toFixed(2)}, 差距=${gap.toFixed(2)}>0.3）`,
      parameter: { winnerKey: winner.key, loserKey: loser.key, winnerScore: scoreA, loserScore: scoreB },
      confidence: Math.min(gap, 0.95),
      triggeredAt: new Date().toISOString(),
    };
  }

  return {
    type: 'cross_dept_arbitration',
    reason: `矛盾差距过小（gap=${gap.toFixed(2)}≤0.3），标记为 pending_cross_validation，等待3个月或GA人工判断`,
    parameter: { financeKey: pair.finance.key, marketingKey: pair.marketing.key, status: 'pending_cross_validation', gap },
    confidence: 0.5,
    triggeredAt: new Date().toISOString(),
  };
}

/**
 * 数据一致性评分（简化模型：基于反馈次数和时效性）。
 */
function scoreDataConsistency(signal: AggregatedSignal): number {
  const recency = Date.now() - new Date(signal.latestTimestamp).getTime();
  const daysSinceUpdate = recency / (1000 * 60 * 60 * 24);
  // 越新越高分，最多 0.9
  const recencyScore = Math.max(0, 1 - daysSinceUpdate / 90);
  // 次数越多越高分
  const countScore = Math.min(signal.count / 10, 0.9);
  return recencyScore * 0.4 + countScore * 0.6;
}

/**
 * 历史准确率评分（简化模型）。
 */
function scoreHistoricalAccuracy(signal: AggregatedSignal): number {
  // 简化实现：基于反馈次数估计，count越高说明越多次被验证
  return Math.min(signal.count / 15, 0.95);
}

// ═══ GA absence protection ═══

/**
 * 计算 GA 缺席自动升级阈值。
 *
 * 公式: autoUpgradeThreshold = 60 * (1 - middleActivityRate)
 * - GA absent 60d + activity 80% → threshold = 12d
 * - GA absent 60d + activity <30% → threshold = 42d
 *
 * @param gaAbsenceDays       - GA 连续缺席天数
 * @param middleActivityRate  - 中层管理活动率 (0-1)
 * @returns GA 保护结果
 */
export function computeGAProtection(
  gaAbsenceDays: number,
  middleActivityRate: number,
): GAProtectionResult {
  const clampedRate = Math.max(0, Math.min(1, middleActivityRate));
  const autoUpgradeThreshold = Math.round(60 * (1 - clampedRate));
  const shouldUpgrade = gaAbsenceDays >= autoUpgradeThreshold;

  return {
    autoUpgradeThreshold,
    shouldUpgrade,
    gaAbsenceDays,
    middleActivityRate: clampedRate,
  };
}

// ═══ D273: GA 纠错回写 ═══

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const EXTENSIONS_DIR = join(process.cwd(), "extensions", "industries");
const MAX_CORRECTION_RATIO = 0.3; // ±30% 上限
const MIN_TRIGGER_COUNT = 3; // 至少 3 次同 key 纠错才触发

export interface ApplyActionResult {
  applied: number;
  skipped: number;
  errors: string[];
}

/**
 * D273: 将 processFeedbackSignals 生成的进化动作回写到行业阈值文件。
 *
 * 安全约束:
 *   - 同 key 纠错 ≥3 次才触发
 *   - 调整幅度 ≤ ±30%
 *   - 写前备份到 _gaCorrections 数组
 *   - manifest.json 不存在 → 跳过 (degraded)
 *
 * @param actions — 进化动作列表
 * @returns 回写统计
 */
/** 专家 manifest 目录 */
const EXPERT_DIR = join(process.cwd(), "expert");

/**
 * 安全调整数值: ±30% 上限 + 防 NaN
 */
function safeAdjust(value: number, ratio: number): number {
  const clamped = Math.max(1 - MAX_CORRECTION_RATIO, Math.min(1 + MAX_CORRECTION_RATIO, ratio));
  const result = value * clamped;
  return isNaN(result) ? value : Math.round(result * 100) / 100;
}

/**
 * 读取 expert/{type}/manifest.json，返回解析结果或 null。
 */
function readExpertManifest(expertType: string): Record<string, unknown> | null {
  const path = join(EXPERT_DIR, expertType, "manifest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "JSON 解析失败");
    return null;
  }
}

/**
 * 回写 expert/{type}/manifest.json。
 */
function writeExpertManifest(expertType: string, data: Record<string, unknown>): boolean {
  try {
    const path = join(EXPERT_DIR, expertType, "manifest.json");
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "阈值文件路径拼接");
    return false;
  }
}

/**
 * 记录纠错历史到 agent_memory（降级时跳过）。
 */
function logCorrection(key: string, actionType: string, details: Record<string, unknown>): void {
  try {
    const store = getAgentMemoryStore();
    store.remember({
      orgId: "synova",
      // K6/0-2: 纠错账本键带 `_gaCorrections` 标识 —— 与 thresholds.json / expert manifest
      // 内的 `_gaCorrections` 数组同源，使**已回写的纠错**可在 agent_memory 侧对账
      // （总闸可验证：applied 不再恒 0 的证据面）。
      key: `_gaCorrections:${actionType}:${key}:${Date.now()}`,
      value: JSON.stringify({ actionType, ...details }),
      type: "fact",
      confidence: 0.7,
      source: "ga_correction",
      tags: ["ga_correction", actionType],
      expiresAt: null,
    });
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "企业记忆访问失败");
    /* 降级 — 不阻断 */
  }
}

// ═══ 各类型处理函数 ═══

function applyThresholdAdjust(action: EvolutionAction, result: ApplyActionResult): void {
  const sentinelKey = action.parameter.sentinelKey as string | undefined;
  const adjustPercent = (action.parameter.adjustPercent as number) || 5;
  const direction = action.parameter.direction === "up" ? 1 : -1;

  if (!sentinelKey) { result.skipped++; return; }
  if (!existsSync(EXTENSIONS_DIR)) { result.skipped++; return; }

  const industries = readdirSync(EXTENSIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  let found = false;

  for (const industry of industries) {
    const thresholdPath = join(EXTENSIONS_DIR, industry.name, "thresholds.json");
    if (!existsSync(thresholdPath)) continue;

    let config: Record<string, unknown>;
    try { config = JSON.parse(readFileSync(thresholdPath, "utf-8")) as Record<string, unknown>; }
    catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "阈值配置加载失败");
      continue;
    }

    const overrides = config.thresholdOverrides as Record<string, unknown> | undefined;
    if (!overrides || !overrides[sentinelKey]) {
      // K6/缺陷①(CTO 2026-10-08): 原为**静默 continue** —— 目标哨兵在 thresholdOverrides
      //   无实体时既不 warn 也不计数，只在全行业皆无时落一个笼统的 skipped++ ⇒
      //   「目标名写错 / 配置漏登记」这种可修问题会**永久静默失效**（违铁律 11/24）。
      //   ⇒ 逐行业 warn（带行业名便于定位）；**不 push errors**（"本行业无此 key"属正常，
      //     只有"全行业皆无"才是问题，由下方 !found 分支统一记错误）。
      log.warn(
        { sentinelKey, industry: industry.name },
        "GA 阈值调整跳过：本行业 thresholdOverrides 无此哨兵实体（配置漏登记或哨兵名不符）",
      );
      continue;
    }

    const entry = overrides[sentinelKey] as Record<string, number>;
    if (!entry || typeof entry.warning !== "number") continue;

    const corrections = (config._gaCorrections as Array<Record<string, unknown>>) || [];
    const sameKey = corrections.filter((c) => c.key === sentinelKey && c.direction === action.parameter.direction);

    if (sameKey.length < MIN_TRIGGER_COUNT - 1) {
      corrections.push({
        key: sentinelKey, direction: action.parameter.direction, adjustPercent,
        triggeredAt: action.triggeredAt, applied: false,
        reason: `pending — ${sameKey.length + 1}/${MIN_TRIGGER_COUNT} corrections needed`,
      });
      config._gaCorrections = corrections;
      writeFileSync(thresholdPath, JSON.stringify(config, null, 2), "utf-8");
      result.skipped++; found = true;
      logCorrection(sentinelKey, action.type, {
        direction: action.parameter.direction, adjustPercent, applied: false,
        pendingCount: sameKey.length + 1, minTriggerCount: MIN_TRIGGER_COUNT,
      });
      continue;
    }

    const count = sameKey.length + 1;
    const ratio = 1 + direction * (adjustPercent / 100) * (Math.min(count, 3) / 3);
    const oldW = entry.warning;
    const oldC = entry.critical;
    entry.warning = safeAdjust(oldW, ratio);
    entry.critical = safeAdjust(oldC, ratio);
    corrections.push({
      key: sentinelKey, direction: action.parameter.direction, adjustPercent,
      triggeredAt: action.triggeredAt, applied: true,
      previousWarning: oldW, previousCritical: oldC,
      newWarning: entry.warning, newCritical: entry.critical,
    });
    config._gaCorrections = corrections;
    writeFileSync(thresholdPath, JSON.stringify(config, null, 2), "utf-8");
    log.info({ sentinelKey, industry: industry.name, warning: `${oldW}→${entry.warning}` }, "GA 阈值调整已回写");
    result.applied++; found = true;
    logCorrection(sentinelKey, action.type, {
      direction: action.parameter.direction, adjustPercent, applied: true,
      previousWarning: oldW, newWarning: entry.warning,
      previousCritical: oldC, newCritical: entry.critical,
      industry: industry.name,
    });
    // K6/缺陷②(CTO 2026-10-08): 原此处 `break` ⇒ **只调第一个命中行业即退出**。
    //   实测 `F1_KZ` 存在于 4 个行业的 thresholdOverrides（financial-services /
    //   general-enterprise / manufacturing / saas-tech）⇒ 原实现每轮**静默漏 3 个行业**。
    //   同一个哨兵阈值必须跨行业一致 ⇒ 去掉 break，遍历全部行业。
    //   （幂等性：每个行业各自读-改-写自己的 thresholds.json，互不干扰。）
  }

  if (!found) {
    // K6/缺陷①(CTO 2026-10-08): 全行业皆无该实体 ⇒ 可见性兑现（原为静默 skipped++）。
    //   ⚠️ 契约保持：**不 push errors** —— 既有用例「降级路径: 实体不在任何 thresholds.json
    //   ⇒ skipped（applied=0）且不抛」断言 `errors === []`，该语义已冻结，不得擅自改变。
    //   ⇒ 可见性由上方逐行业 `log.warn` 承担（铁律 11 的 log 面）。
    log.warn(
      { sentinelKey, industries: industries.length },
      "GA 阈值调整未命中任何行业——哨兵名不符或配置全行业漏登记（本次 skipped，不抛错）",
    );
    result.skipped++;
  }
}

function applyGoalFormulaTweak(action: EvolutionAction, result: ApplyActionResult): void {
  const goalType = action.parameter.goalType as string | undefined;
  const weightAdjust = action.parameter.weightAdjust as number | undefined;
  if (!goalType || weightAdjust == null) { result.skipped++; return; }

  // Goal 公式调整写入 agent_memory（当前无 Goal 配置文件）
  logCorrection(goalType, action.type, { weightAdjust, reason: action.reason, triggeredAt: action.triggeredAt });
  log.info({ goalType, weightAdjust }, "GA Goal 公式调整已记录 (agent_memory)");
  result.applied++;
}

function applyPathRankDowngrade(action: EvolutionAction, result: ApplyActionResult): void {
  const pathKey = action.parameter.pathKey as string | undefined;
  const rankAdjust = action.parameter.rankAdjust as number | undefined;
  if (!pathKey || rankAdjust == null) { result.skipped++; return; }

  // 路径排名降级写入 agent_memory（当前无路径配置文件）
  logCorrection(pathKey, action.type, { rankAdjust, reason: action.reason, triggeredAt: action.triggeredAt });
  log.info({ pathKey, rankAdjust }, "GA 路径排名降级已记录 (agent_memory)");
  result.applied++;
}

function applyExpertConfidenceDowngrade(action: EvolutionAction, result: ApplyActionResult): void {
  const expertKey = action.parameter.expertKey as string | undefined;
  const confidenceAdjust = action.parameter.confidenceAdjust as number | undefined;
  if (!expertKey || confidenceAdjust == null) { result.skipped++; return; }

  // 读取 expert manifest，调整 priority 或添加 confidencePenalty
  const manifest = readExpertManifest(expertKey);
  if (!manifest) {
    // manifest 不存在 → 回退到 agent_memory
    logCorrection(expertKey, action.type, { confidenceAdjust, reason: action.reason, triggeredAt: action.triggeredAt, degraded: true });
    log.warn({ expertKey }, "专家 manifest 不存在 — 置信度降级写入 agent_memory");
    result.applied++;
    return;
  }

  // 记录 _gaCorrections + 调整 priority
  const corrections = (manifest._gaCorrections as Array<Record<string, unknown>>) || [];
  const sameKey = corrections.filter((c) => c.key === expertKey);

  if (sameKey.length < MIN_TRIGGER_COUNT - 1) {
    corrections.push({
      key: expertKey, confidenceAdjust, triggeredAt: action.triggeredAt, applied: false,
      reason: `pending — ${sameKey.length + 1}/${MIN_TRIGGER_COUNT} corrections needed`,
    });
    manifest._gaCorrections = corrections;
    writeExpertManifest(expertKey, manifest);
    result.skipped++;
    return;
  }

  const oldPriority = typeof manifest.priority === "number" ? manifest.priority : 0.5;
  const ratio = 1 + confidenceAdjust;
  // safeAdjust 内置正确 clamp: max(0.7, min(1.3, ratio))
  const newPriority = safeAdjust(oldPriority, ratio);
  manifest.priority = newPriority;

  corrections.push({
    key: expertKey, confidenceAdjust, triggeredAt: action.triggeredAt, applied: true,
    previousPriority: oldPriority, newPriority,
  });
  manifest._gaCorrections = corrections;
  writeExpertManifest(expertKey, manifest);
  log.info({ expertKey, priority: `${oldPriority}→${newPriority}` }, "GA 专家置信度已调整");
  result.applied++;
}

// ═══ D556: GA 校准审核动作落盘（回流层 2 — spec §6.1/§6.2.3） ═══

/**
 * targetIds 确定性短哈希（djb2 → 无符号 hex）——审核条目 key 去重可读，同组回流可关联。
 * 契约: @input targetIds 字符串数组; @output 8 位内 hex 字符串（确定性，同输入恒同输出）; 不抛。
 */
function hashTargetIds(targetIds: string[]): string {
  let hash = 5381;
  for (const id of targetIds) {
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
    }
  }
  return (hash >>> 0).toString(16);
}

/**
 * D556: applyDiagnosisCalibrationReview — 校准审核动作 → agent_memory 审核条目。
 *
 * sink = logCorrection 同款调用形态（getAgentMemoryStore().remember，D273 L362-379 先例、
 * applyGoalFormulaTweak L453-455 同款），但条目字段按 spec §6.1 审核 key/tags 独立组装:
 *   key   = `ga_calibration_review:${decision}:${targetIdsHash}:${Date.now()}`
 *   tags  = ['ga_calibration_review', decision]
 *   type  = 'ga_correction'（MemoryType 枚举内最邻近值——spec §6.1 的 'ga_calibration_review'
 *           不在 MemoryType 枚举/DDL CHECK（agent-memory-store.ts L27-39/L355，不在本单写集），
 *           判别值冗余携带于 key 前缀 + tags[0] + value.actionType 三处，K3 可查）
 *
 * 契约（铁律 47）:
 *   @input  — action: EvolutionAction(type='diagnosis_calibration_review',
 *             parameter={decision, targetIds, sampleCount, hint})；result: 计数累加器
 *   @output — 无返回值；成功 result.applied++；写失败/参数缺失 result.skipped++
 *             （对齐 L541-546 错误语义，诚实性不变量 loop-handlers L367-368 保持）
 *   @degraded — store 未初始化/写入异常 → log.warn + skipped++（不抛、不阻断其余动作）
 *   @诚实边界 — 审核条目 = 待办队列，不自动改诊断逻辑权重（层 3 descope，spec §6.1）
 */
function applyDiagnosisCalibrationReview(action: EvolutionAction, result: ApplyActionResult): void {
  const decision = action.parameter.decision;
  const targetIds = action.parameter.targetIds;
  if (typeof decision !== "string" || decision.length === 0 || !Array.isArray(targetIds)) {
    result.skipped++;
    return;
  }
  const cleanTargetIds = targetIds.filter((id): id is string => typeof id === "string");
  const targetIdsHash = hashTargetIds(cleanTargetIds);

  try {
    const store = getAgentMemoryStore();
    store.remember({
      orgId: "synova",
      key: `ga_calibration_review:${decision}:${targetIdsHash}:${Date.now()}`,
      value: JSON.stringify({
        actionType: action.type,
        decision,
        targetIds: cleanTargetIds,
        sampleCount: action.parameter.sampleCount,
        hint: action.parameter.hint,
        reason: action.reason,
        triggeredAt: action.triggeredAt,
      }),
      type: "ga_correction",
      confidence: action.confidence,
      source: "ga_calibration_review",
      tags: ["ga_calibration_review", decision],
      expiresAt: null,
    });
    log.info(
      { decision, targetCount: cleanTargetIds.length },
      "GA 校准审核条目已写入 agent_memory（待人工审核——不自动改诊断权重，层 3 descope）",
    );
    result.applied++;
  } catch (err: unknown) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), decision },
      "GA 校准审核条目写入失败 — skipped",
    );
    result.skipped++;
  }
}

// ═══ 主入口: 按类型分发 ═══

export function applyEvolutionActions(actions: EvolutionAction[]): ApplyActionResult {
  const result: ApplyActionResult = { applied: 0, skipped: 0, errors: [] };

  if (!actions || actions.length === 0) return result;

  for (const action of actions) {
    try {
      switch (action.type) {
        case "threshold_adjust":
          applyThresholdAdjust(action, result);
          break;
        case "goal_formula_tweak":
          applyGoalFormulaTweak(action, result);
          break;
        case "path_rank_downgrade":
          applyPathRankDowngrade(action, result);
          break;
        case "expert_confidence_downgrade":
          applyExpertConfidenceDowngrade(action, result);
          break;
        case "diagnosis_calibration_review":
          applyDiagnosisCalibrationReview(action, result);
          break;
        default:
          result.skipped++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, type: action.type }, "applyEvolutionAction 异常 — 跳过");
      result.errors.push(msg);
      result.skipped++;
    }
  }

  if (result.applied > 0) {
    log.info({ applied: result.applied, skipped: result.skipped }, "进化动作回写完成");
  }

  return result;
}
