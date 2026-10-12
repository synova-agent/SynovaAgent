/**
 * src/cycles/cycle-types.ts — 循环配置类型定义
 *
 * 第15份权威文档（企业循环溢出导航系统）第一章 §2.3 + §4.3。
 * 对标 sentinel-loader 的文件驱动模式。
 *
 * @wire-target — D89 (溢出计算) 消费 CycleConfig
 * @wire-target — D83 (Bootstrap) 消费 loadCycles/registerLoadedCycles
 */
import type { GraphBridgeLike, AuditStoreLike } from '../growth/goal-types';

// ═══ 循环节点 ═══

/** 循环中的一个节点（变量/状态） */
export interface CycleNode {
  /** 节点 ID（循环内唯一） */
  id: string;
  /** 节点名称 */
  label: string;
  /** 节点类型 */
  type: 'stock' | 'flow' | 'parameter' | 'goal';
  /** 初始值 */
  initialValue?: number;
  /** 当前值 */
  currentValue?: number;
  /** 单位 */
  unit?: string;
  /** 关联的 42 边 ID */
  edgeRefs?: string[];
  /** 关联的 compute 契约 ID */
  computeRef?: string;
  /** 扩展属性 */
  props?: Record<string, unknown>;
}

// ═══ 循环边 ═══

/** 循环中节点间的关系 */
export interface CycleEdge {
  /** 起点节点 ID */
  from: string;
  /** 终点节点 ID */
  to: string;
  /** 影响方向 */
  polarity: '+' | '-';
  /** 延迟（时间步数） */
  delay?: number;
  /** 权重 */
  weight?: number;
}

// ═══ 溢出规则 ═══

/** 溢出计算公式 */
export interface OverflowFormula {
  /** 触发条件表达式 */
  condition: string;
  /** 溢出目标节点 */
  targetNode: string;
  /** 溢出量计算函数 */
  formula: string;
  /** 最低数据成熟度要求 */
  minDataMaturity: 'low' | 'medium' | 'high';
}

// ═══ 跨循环传播 ═══

export interface CrossCyclePropagation {
  /** 关联到的目标循环 ID */
  targetCycleId: string;
  /** 传播边描述 */
  viaEdge: string;
  /** 传播强度 */
  strength: number;
}

// ═══ 五阀映射（#239 / K4-06）═══

/**
 * `actionEffectLag` 的合法桶标签。
 *
 * 权威源 = `docs/synova/research/权威文档15-企业循环溢出导航系统-20260714/`
 * `SYNOVA-RESEARCH-第一章-循环配置规范与动态加载机制-v1-0-20260714.md` **§3.4**（标题串
 * ``### 3.4 `edges` -- 五阀映射（含action_effect_lag）``）。
 * ⚠️ 是 **doc15 第一章 §3.4**，**不是**第三章 §3.4（第三章同名节是「执行约束因子模型」，同名不同物）。
 *
 * 🔴 桶标签共 **6 个**（含 `>12_months`）；CTO 派单件 §四曾只列 5 个，漏 `>12_months`，已登记（#239 证据件）。
 * ⚠️ 与边类型 JSON 里的 `action_effect_lag`（数值区间口径，走 doc15 §3.5.1）**不同物**，禁混用。
 */
export type ActionEffectLag =
  | 'immediate'
  | '1_month'
  | '1-3_months'
  | '3-6_months'
  | '6-12_months'
  | '>12_months';

/** 桶标签 → 月数区间（区间用于「时滞是否已过」的判定；`maxMonths=null` 表示开区间「超过」）。 */
export const ACTION_EFFECT_LAG_RANGE_MONTHS: Record<ActionEffectLag, { minMonths: number; maxMonths: number | null }> = {
  immediate: { minMonths: 0, maxMonths: 0.5 },
  '1_month': { minMonths: 0.5, maxMonths: 1 },
  '1-3_months': { minMonths: 1, maxMonths: 3 },
  '3-6_months': { minMonths: 3, maxMonths: 6 },
  '6-12_months': { minMonths: 6, maxMonths: 12 },
  '>12_months': { minMonths: 12, maxMonths: null },
};

/** 五阀的键名（逐字对齐 doc15 第一章 §3.4）。 */
export const VALVE_KEYS = [
  'acquisitionValve',
  'allocationValve',
  'conversionValve',
  'deliveryValve',
  'recycleValve',
] as const;

export type ValveKey = (typeof VALVE_KEYS)[number];

/**
 * 五阀映射里的单条边。
 *
 * ⚠️ `edgeId` 的取值形态 = **权威文档15 第一章 §3.4 的原样形态（`E-NN` 两位式）**。
 * 本字段**不是** `edgeRefs`/`mapping.edgeId` 那套代码侧 `$id`（`edge/<snake>`）；
 * 两者的对应关系与「哪些 E 号换算不出 `$id`」见
 * `docs/synova/coordination/numbering-authority.md`（#238 交付件）。
 */
export interface ValveEdge {
  /** 权威文档15 §3.4 原样形态的边号（`E-NN`） */
  edgeId: string;
  /** 预期生效延迟（6 桶标签之一） */
  actionEffectLag: ActionEffectLag;
}

/** 五阀映射：`获取 → 分配 → 转化 → 交付 → 回收`。 */
export type CycleValves = Record<ValveKey, ValveEdge[]>;

// ═══ 循环配置完整结构 ═══

export interface CycleConfig {
  /** 循环唯一标识 */
  cycleId: string;
  /** 循环显示名称 */
  name: string;
  /** 描述 */
  description: string;
  /** Schema 版本 */
  version: string;
  /** 适用行业列表（空=通用） */
  applicableIndustries: string[];
  /** 循环中的节点 */
  nodes: CycleNode[];
  /** 节点间关系（图结构：from/to/polarity/delay/weight） */
  edges: CycleEdge[];
  /**
   * 五阀映射（#239 / K4-06）—— **新键，不覆盖 `edges[]`**。
   *
   * 🔴 CTO 裁定（2026-10-11）：doc15 §3.4 的 `edges{*Valve}` 与仓内 `edges[]` **同名不同物**
   * （前者是「阀映射」，后者是「图结构」）⇒ 用新 key `valves` 避免歧义。
   *
   * 缺省可选：缺失 ⇒ loader 计入 errors 并返回 `degraded: true`（不静默通过）。
   */
  valves?: CycleValves;
  /** 溢出条件与公式 */
  overflowFormula: OverflowFormula;
  /** 数据成熟度等级 */
  dataMaturity: 'low' | 'medium' | 'high';
  /** 节点→42边映射 */
  mapping: Array<{ nodeId: string; edgeId: string; weight: number }>;
  /** 跨循环传播 */
  crossCyclePropagation: CrossCyclePropagation[];
}

// ═══ ContextLoader 接口（D79） ═══

export interface ContextLoaderLike {
  getContext(key: string): unknown;
  getCycleOverrides?(cycleId: string): Record<string, unknown> | undefined;
}
