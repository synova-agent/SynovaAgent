/**
 * proposal-payloads.ts — K6-E9 四类 typed payload（#539 / Closes #539）
 *
 * 卡面依据：.claude/task-briefs/2026-10-15-535-K6-E9-进化回写.md §〇⑥①
 *   EvolutionProposal.changes 此前只能表达"阈值"一种 payload ⇒ 扩成按层分型：
 *     · loop-param   （① 循环参数）
 *     · ontology     （② 本体 —— 本卡只做通道，不实做本体变更，Q2 红线）
 *     · param-prior  （④ 参数先验）
 *     · nav-weight   （⑤ 导航权重）
 *   ＋ 现有 sentinel-threshold（③ 阈值，既有通道不动）。
 *
 * 借鉴（卡面 §〇⑦ dsh-invariants）：「每个包发布自己的 invariant 伴生」
 *   ⇒ 每类回写的**判据由该类自己声明**（PAYLOAD_CONTRACTS，不集中写在一处）。
 *
 * 铁律 47（契约优先）：每个 payload 的不变量在 PAYLOAD_CONTRACTS[kind].validate 里声明；
 * 铁律 38：零 as any；铁律 11：校验失败显式返回 false，不静默放行。
 */

import type { ThresholdChange } from './evolution-types';

// ═══ 层类与四类 payload 类型 ═══

/** 回写层类（缺省/存量 ⇒ sentinel-threshold） */
export type WritebackKind =
  | 'sentinel-threshold'
  | 'loop-param'
  | 'ontology'
  | 'param-prior'
  | 'nav-weight';

/** ① 循环参数回写 */
export interface LoopParamChange {
  kind: 'loop-param';
  /** 目标循环（cycles/*.cycle.json 的 cycle id） */
  cycleId: string;
  /** 参数键（如 triggerThreshold） */
  paramKey: string;
  from: number;
  to: number;
}

/** ② 本体回写（通道：只描述意图变更，不实做 —— Q2 红线：不改 src/l4/**） */
export interface OntologyChange {
  kind: 'ontology';
  /** 目标节点类型（如 Financial） */
  nodeType: string;
  /** 可选目标边类型 */
  edgeType?: string;
  op: 'add' | 'update' | 'deprecate';
  /** 变更内容（结构由本体线后续裁定，本卡只透传） */
  patch: Record<string, unknown>;
}

/** ④ 参数先验回写（Beta 先验） */
export interface ParamPriorChange {
  kind: 'param-prior';
  /** 参数 id（④ 参数层实体键） */
  paramId: string;
  priorAlpha: number;
  priorBeta: number;
  /** 证据样本数（≥1 才允许回写先验） */
  evidenceCount: number;
}

/** ⑤ 导航权重回写 */
export interface NavWeightChange {
  kind: 'nav-weight';
  /** 专家 id（expert/ 目录名） */
  expertId: string;
  weightFrom: number;
  weightTo: number;
}

/** 四类 typed payload ＋ 既有阈值形态（存量提案无 kind ⇒ 由 kindOf 判为 sentinel-threshold） */
export type TypedChange =
  | ThresholdChange
  | LoopParamChange
  | OntologyChange
  | ParamPriorChange
  | NavWeightChange;

/** 单条变更的落盘意图描述（审计面用） */
export function describeChange(change: TypedChange): string {
  const contract = PAYLOAD_CONTRACTS[kindOf(change)];
  return contract.describe(change);
}

/**
 * 判别层类。
 * 契约: @input TypedChange ｜ @output WritebackKind（ThresholdChange 无 kind 字段 ⇒ 'sentinel-threshold'）
 * 不抛异常 —— 未知 kind 字符串按 'sentinel-threshold' 处理并显式告警留给校验层。
 */
export function kindOf(change: TypedChange): WritebackKind {
  const k = (change as { kind?: unknown }).kind;
  if (typeof k === 'string' && (PAYLOAD_CONTRACTS as Record<string, unknown>)[k] !== undefined) {
    return k as WritebackKind;
  }
  return 'sentinel-threshold';
}

/** ThresholdChange 形态守卫（存量阈值提案路径，字段契约冻结） */
export function isThresholdChange(change: TypedChange): change is ThresholdChange {
  const t = change as Partial<ThresholdChange>;
  return (
    typeof t.sentinelId === 'string' &&
    t.sentinelId.length > 0 &&
    t.from !== undefined &&
    t.to !== undefined &&
    typeof t.to.warning === 'number' &&
    typeof t.to.critical === 'number'
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// ═══ 每类自声明判据（dsh-invariants 借鉴：不集中一处）═══

export interface PayloadContract {
  /** 该类 payload 的不变量（改坏即红：validate 不过 ⇒ 不得落盘） */
  validate(change: TypedChange): boolean;
  /** 审计面描述 */
  describe(change: TypedChange): string;
}

export const PAYLOAD_CONTRACTS: Record<WritebackKind, PayloadContract> = {
  'sentinel-threshold': {
    validate: (c) => isThresholdChange(c),
    describe: (c) => {
      const t = c as ThresholdChange;
      return `threshold ${t.sentinelId}: warning ${t.from?.warning}→${t.to?.warning}`;
    },
  },
  'loop-param': {
    validate: (c) => {
      const p = c as Partial<LoopParamChange>;
      return (
        p.kind === 'loop-param' &&
        typeof p.cycleId === 'string' && p.cycleId.length > 0 &&
        typeof p.paramKey === 'string' && p.paramKey.length > 0 &&
        typeof p.from === 'number' && Number.isFinite(p.from) &&
        typeof p.to === 'number' && Number.isFinite(p.to)
      );
    },
    describe: (c) => {
      const p = c as LoopParamChange;
      return `loop-param ${p.cycleId}.${p.paramKey}: ${p.from}→${p.to}`;
    },
  },
  ontology: {
    validate: (c) => {
      const o = c as Partial<OntologyChange>;
      return (
        o.kind === 'ontology' &&
        typeof o.nodeType === 'string' && o.nodeType.length > 0 &&
        (o.op === 'add' || o.op === 'update' || o.op === 'deprecate') &&
        isRecord(o.patch) &&
        (o.edgeType === undefined || typeof o.edgeType === 'string')
      );
    },
    describe: (c) => {
      const o = c as OntologyChange;
      return `ontology ${o.op} ${o.nodeType}${o.edgeType ? ` --${o.edgeType}` : ''}`;
    },
  },
  'param-prior': {
    validate: (c) => {
      const p = c as Partial<ParamPriorChange>;
      return (
        p.kind === 'param-prior' &&
        typeof p.paramId === 'string' && p.paramId.length > 0 &&
        typeof p.priorAlpha === 'number' && p.priorAlpha > 0 &&
        typeof p.priorBeta === 'number' && p.priorBeta > 0 &&
        typeof p.evidenceCount === 'number' &&
        Number.isInteger(p.evidenceCount) && p.evidenceCount >= 1
      );
    },
    describe: (c) => {
      const p = c as ParamPriorChange;
      return `param-prior ${p.paramId}: Beta(${p.priorAlpha},${p.priorBeta}) n=${p.evidenceCount}`;
    },
  },
  'nav-weight': {
    validate: (c) => {
      const n = c as Partial<NavWeightChange>;
      return (
        n.kind === 'nav-weight' &&
        typeof n.expertId === 'string' && n.expertId.length > 0 &&
        typeof n.weightFrom === 'number' && Number.isFinite(n.weightFrom) &&
        typeof n.weightTo === 'number' && Number.isFinite(n.weightTo) &&
        n.weightTo >= 0 && n.weightTo <= 1
      );
    },
    describe: (c) => {
      const n = c as NavWeightChange;
      return `nav-weight ${n.expertId}: ${n.weightFrom}→${n.weightTo}`;
    },
  },
};
