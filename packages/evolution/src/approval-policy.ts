/**
 * approval-policy.ts — K6-E9 审批分级 L0/L1 ＋ 每周期上限（#539 / Closes #539）
 *
 * 卡面依据：task-brief 2026-10-15-535 §〇⑥②④ ＋ §〇⑦ DSH 借鉴两原则：
 *   🔴 「一次授权只对一次动作」 ⇒ L1 的人工批只对**这一条提案**生效（approvedRef 逐条绑定），
 *       不是"批一次管一类" —— 由调用方逐提案传 proposalApproved，本模块不缓存"类级放行"。
 *   🔴 「审批者缺失即 fail-closed」 ⇒ L1 类回写没人批 ⇒ decision='await-approval'（不落盘），
 *       永不默认放行。
 *
 * 审批级别有**显式写路径**（借 dsh setApprovalPolicy 形态）：
 *   setApprovalLevelOverride() / clearApprovalLevelOverrides() —— 不是散落各调用点。
 *
 * 每周期上限：自动回写 ≤ N（首版 10）；超限 ⇒ decision='halt'（**停下来等人看**，
 *   不是静默写进去 —— 卡面 Done ④"第 11 条必停"）。
 *
 * 铁律 47（契约优先）：每个导出的输入/输出/降级语义见各 JSDoc；铁律 38：零 as any。
 */

import type { WritebackKind } from './proposal-payloads';

// ═══ 分级 ═══

export type ApprovalLevel = 'L0' | 'L1';

/** L0 = 自动（无需人工批）：③ 阈值 / ④ 参数先验 / ⑤ 导航权重 */
export const L0_AUTO_KINDS: readonly WritebackKind[] = [
  'sentinel-threshold',
  'param-prior',
  'nav-weight',
] as const;

/** L1 = 人工批（一次授权只对一次动作）：① 循环 / ② 本体 */
export const L1_MANUAL_KINDS: readonly WritebackKind[] = [
  'loop-param',
  'ontology',
] as const;

/** 每周期自动回写上限（卡面 Done ④：第 11 条必停） */
export const MAX_AUTO_WRITEBACK_PER_CYCLE = 10;

// ═══ 显式写路径（分级覆盖表）═══

const levelOverrides = new Map<WritebackKind, ApprovalLevel>();

/**
 * 显式写路径：覆盖某层类的审批级别（如运维把 nav-weight 升为 L1）。
 *
 * 契约: @input kind 层类 ｜ level 目标级别
 * @output 无返回；重复写以后写为准
 * @degraded 不抛；未知 kind 字符串静默忽略由 resolveApprovalLevel 兜底为 L1（fail-closed 方向）
 */
export function setApprovalLevelOverride(kind: WritebackKind, level: ApprovalLevel): void {
  levelOverrides.set(kind, level);
}

/** 清空全部覆盖（回到默认分级）—— 测试与运行时复位用 */
export function clearApprovalLevelOverrides(): void {
  levelOverrides.clear();
}

/**
 * 解析层类 ⇒ 审批级别。
 *
 * 契约: @input kind ｜ @output 'L0'（自动）或 'L1'（人工批）
 * fail-closed：未知 kind（既不在 L0 也不在 L1 清单，且无覆盖）⇒ 'L1' —— 宁可等人批，不放行。
 */
export function resolveApprovalLevel(kind: WritebackKind): ApprovalLevel {
  const override = levelOverrides.get(kind);
  if (override === 'L0' || override === 'L1') return override;
  if (L0_AUTO_KINDS.includes(kind)) return 'L0';
  if (L1_MANUAL_KINDS.includes(kind)) return 'L1';
  return 'L1';
}

// ═══ 每周期预算（上限 N）═══

/**
 * 每周期自动回写预算。
 *
 * 契约: @input max（默认 MAX_AUTO_WRITEBACK_PER_CYCLE=10）
 * @output consume() ⇒ 还有额度 true ＋ 扣一；额度耗尽 false（**不抛、不静默继续**）
 */
export class WritebackBudget {
  private used = 0;
  readonly max: number;

  constructor(max: number = MAX_AUTO_WRITEBACK_PER_CYCLE) {
    this.max = max;
  }

  get consumed(): number {
    return this.used;
  }

  get remaining(): number {
    return Math.max(0, this.max - this.used);
  }

  consume(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
}

// ═══ 裁决 ═══

export type WritebackDecisionKind = 'apply' | 'await-approval' | 'halt';

export interface WritebackDecision {
  decision: WritebackDecisionKind;
  kind: WritebackKind;
  level: ApprovalLevel;
  /** 裁决理由（审计面） */
  reason: string;
}

export interface DecideWritebackInput {
  kind: WritebackKind;
  /** 这一条提案是否已被人工批准（L1 必需；一次授权只对一次动作） */
  proposalApproved: boolean;
  /** 人工批准的引用（approve 记录 id；L0 自动 ⇒ undefined） */
  approvedRef?: string;
  budget: WritebackBudget;
}

/**
 * 单一裁决入口：一条提案能否落盘。
 *
 * 契约:
 *   @input 见 DecideWritebackInput
 *   @output decision:
 *     · 'apply'          —— 可落盘（L0 有额度，或 L1 已逐条批准）
 *     · 'await-approval' —— L1 无人批 ⇒ **不落盘**（fail-closed）
 *     · 'halt'           —— 自动预算耗尽 ⇒ **停下来等人看**（第 11 条必停）
 *   @degraded 不抛异常；非法输入（budget 缺失）⇒ 'halt'（fail-closed 方向）
 */
export function decideWriteback(input: DecideWritebackInput): WritebackDecision {
  const kind = input.kind;
  const level = resolveApprovalLevel(kind);

  if (level === 'L1') {
    if (!input.proposalApproved) {
      return {
        decision: 'await-approval',
        kind,
        level,
        reason: `L1 层类 ${kind} 未获人工批准 — fail-closed，不落盘（一次授权只对一次动作）`,
      };
    }
    if (!input.approvedRef || input.approvedRef.length === 0) {
      return {
        decision: 'await-approval',
        kind,
        level,
        reason: `L1 层类 ${kind} 已批但缺 approvedRef — 无法对账，不落盘（fail-closed）`,
      };
    }
    // L1 人工批 ⇒ 不占自动预算（上限只约束"自动回写"，卡面 §〇⑥④）
    return { decision: 'apply', kind, level, reason: `L1 已批（ref=${input.approvedRef}）` };
  }

  // L0 自动：受每周期上限约束
  if (!input.budget || typeof input.budget.consume !== 'function') {
    return { decision: 'halt', kind, level, reason: '预算对象缺失 — halt（fail-closed）' };
  }
  if (!input.budget.consume()) {
    return {
      decision: 'halt',
      kind,
      level,
      reason: `自动回写已达每周期上限 ${input.budget.max}（第 ${input.budget.max + 1} 条）— 停下来等人看，不静默写进去`,
    };
  }
  return { decision: 'apply', kind, level, reason: `L0 自动（额度剩 ${input.budget.remaining}）` };
}
