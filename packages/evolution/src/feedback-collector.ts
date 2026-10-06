/**
 * feedback-collector.ts — 反馈采集器 (L0 进化层｜第二层)
 *
 * 采集四种来源的反馈:
 *   ① ga_explicit — GA 对诊断建议/哨兵告警的确认/修改/拒绝
 *   ② user_behavior — 企业行为隐式反馈
 *   ③ external_data — 外部数据自动聚合
 *   ④ diagnosis_contradiction — 哨兵-诊断矛盾检测
 *
 * 铁律 24+31: 每路独立 try/catch，单路失败不阻断整体。
 * 铁律 46: 不引用 engine-core。
 */
import { createLogger } from '@synova/logger';
import type { AgentMemoryStoreLike } from './evolution-types';

const log = createLogger('evolution/feedback-collector');

// ═══ 已有类型 ═══
export interface FeedbackInput {
  orgId: string; actionId: string; sentinelId?: string;
  decision: 'confirm' | 'modify' | 'reject';
  modifiedSuggestion?: string; reason?: string; userId?: string;
}
export interface FeedbackRecord {
  id: string; orgId: string; actionId: string; sentinelId?: string;
  decision: string; originalSuggestion?: string; modifiedSuggestion?: string;
  reason?: string; userId?: string; timestamp: string;
}

// ═══ v3 新增类型 ═══
export interface FeedbackEvent {
  id: string;
  source: 'ga_explicit' | 'user_behavior' | 'external_data' | 'diagnosis_contradiction';
  timestamp: string; teamId: string; payload: Record<string, unknown>;
  requiresReview: boolean; autoApplicable: boolean;
}
export interface CollectResult {
  events: FeedbackEvent[]; autoApplied: number; reviewRequired: number;
  errors: string[]; degraded: boolean;
}

const store = new Map<string, FeedbackRecord>();

/**
 * K6/2-3 通道归一 sink —— 本通道（agent_memory）的反馈可选同步落通道 A（feedback_log）。
 *
 * 契约（铁律 47）:
 *   @input  — FeedbackInput（本通道原始形状，含正向值 'confirm'）
 *   @output — 无返回值（fire-and-forget）
 *   @degraded — sink 抛错 ⇒ 本函数 log.warn 后继续，`persisted` 语义不变
 *               （反馈已落本通道，仅同步通道缺失 —— 不静默，铁律 24/31）
 *
 * 生产接线: `src/routes/chat.ts` 传 `createEvolutionChannelSink()`
 * （`src/growth/feedback-collector.ts`）。
 */
export type MiddleFeedbackSink = (input: FeedbackInput) => void;

// ═══ 已有函数 ═══
export async function collectFeedback(
  input: FeedbackInput, memoryStore?: AgentMemoryStoreLike, middleSink?: MiddleFeedbackSink,
): Promise<{ ok: boolean; record: FeedbackRecord; persisted: boolean }> {
  const id = `fb_${Date.now().toString(36)}`;
  const record: FeedbackRecord = { id, orgId: input.orgId, actionId: input.actionId,
    sentinelId: input.sentinelId, decision: input.decision,
    modifiedSuggestion: input.modifiedSuggestion, reason: input.reason,
    userId: input.userId, timestamp: new Date().toISOString() };
  store.set(id, record);
  let persisted = false;
  if (memoryStore) {
    try {
      memoryStore.remember({ orgId: input.orgId, key: `correction_${id}`,
        value: JSON.stringify(record), type: 'enterprise_fact',
        confidence: input.decision === 'confirm' ? 0.9 : 0.7, source: 'user_feedback',
        tags: ['user_correction', input.decision, input.sentinelId || 'unknown'], expiresAt: null });
      persisted = true;
    } catch (err: unknown) { log.warn({ err }, 'feedback write failed'); }
  }
  // K6/2-3 通道归一: 同步落通道 A（feedback_log）。sink 失败只记警告，不影响本通道语义。
  if (middleSink) {
    try {
      middleSink(input);
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'middle feedback sink 失败 — 通道 A 缺失（degraded）');
    }
  }
  return { ok: true, record, persisted };
}
export function getFeedbackByAction(actionId: string): FeedbackRecord[] {
  return Array.from(store.values()).filter(f => f.actionId === actionId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
export function getFeedbackByOrg(orgId: string): FeedbackRecord[] {
  return Array.from(store.values()).filter(f => f.orgId === orgId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// ═══ v3 新增: collectAllFeedback ═══
export async function collectAllFeedback(
  memoryStore?: AgentMemoryStoreLike,
  behavioralFn?: () => FeedbackEvent[],
  externalFn?: () => FeedbackEvent[],
  contradictionFn?: () => FeedbackEvent[],
): Promise<CollectResult> {
  const errors: string[] = [];
  const allEvents: FeedbackEvent[] = [];
  try {
    if (memoryStore) {
      const entries = memoryStore.list({ orgId: '', type: 'enterprise_fact', tags: ['user_correction'], limit: 100 });
      for (const e of entries) allEvents.push({ id: `ga_${Date.now().toString(36)}`, source: 'ga_explicit' as const,
        timestamp: new Date().toISOString(), teamId: '', payload: { value: e.value }, requiresReview: false, autoApplicable: true });
    }
  } catch (err: unknown) { errors.push(`ga_explicit: ${err instanceof Error ? err.message : String(err)}`); }
  if (behavioralFn) { try { allEvents.push(...behavioralFn().map(e => ({ ...e, source: 'user_behavior' as const }))); } catch (err: unknown) { errors.push(`behavioral: ${err instanceof Error ? err.message : String(err)}`); } }
  if (externalFn) { try { allEvents.push(...externalFn().map(e => ({ ...e, source: 'external_data' as const }))); } catch (err: unknown) { errors.push(`external: ${err instanceof Error ? err.message : String(err)}`); } }
  if (contradictionFn) { try { allEvents.push(...contradictionFn().map(e => ({ ...e, source: 'diagnosis_contradiction' as const }))); } catch (err: unknown) { errors.push(`contradiction: ${err instanceof Error ? err.message : String(err)}`); } }
  return { events: allEvents, autoApplied: allEvents.filter(e => e.autoApplicable).length, reviewRequired: allEvents.filter(e => e.requiresReview).length, errors, degraded: errors.length > 0 };
}
