/**
 * hooks/sse-contract.ts — SSE 事件契约（D527，前后端事件类型单源）
 *
 * engine（src/l3/synova-diagnosis-engine-impl.ts）+ routes（src/routes/diagnosis.ts）
 * 发射的事件全集在此对齐——前端必须处理全部类型，未知类型不得静默丢弃（console.warn 留痕）。
 * 纯函数、零依赖（无 react/zustand import），可被根 vitest 直接编译测试。
 *
 * 契约（铁律 47，D527 spec §7/§12）:
 *   @input  prev: SSEContractState（当前对话状态）
 *           evt:  SSEEventLike（SSE data JSON，类型未知名义化为 unknown 守卫）
 *   @output { state, reportId?, systemMessage? }
 *           phase_started   → phaseIndex=evt.phase, phaseLabel=evt.label + 系统消息（type:'phase'）
 *           phase_completed → 进度保持（phaseIndex 不回落，乱序到达安全）
 *           report_ready    → reportId=evt.reportId（缺失 → warn 不落）
 *           complete        → reportId=evt.report.reportId（缺失 → warn 不落）+ phase='done'
 *           error           → errorMessage=evt.message + phase='error'
 *           degraded        → degraded=true + 系统消息（type:'degraded'）
 *           其余既有类型     → 状态不变（useStreaming 侧已有 case 消费）
 *           未知类型         → console.warn（不抛、不静默）
 *   @degraded 事件缺字段（无 report/reportId/label）→ 不抛，console.warn + 跳过该字段更新
 *
 * D590 追加（对话帧，producer: src/routes/conversations.ts + l1-interaction/web-adapter.ts）:
 *   open            → sessionId=evt.sessionId（回声语义，result.sessionId 供调用方对账）
 *   token / agent_message / end → known-passthrough（状态机无变化；消息渲染消费归 D591 useStreaming）
 */
import { CUSTOMER_TEXT } from '../lib/words';

/** 事件类型全集 = engine 10 种 + diagnosis.ts 补发 5 种（'phase' 为兼容旧事件保留）
 *  + D590 对话帧 4 种（open/token/agent_message/end，producer 为对话 SSE 端点） */
export type SSEEventType =
  | 'phase' | 'phase_started' | 'phase_completed'
  | 'report_ready'
  | 'right_column_update' | 'degraded' | 'root_cause_identified'
  | 'expert_hypothesis' | 'hypothesis_generated' | 'interim_finding'
  | 'community_reports' | 'entity_resolution' | 'judgment_card'
  | 'complete' | 'error'
  | 'open' | 'token' | 'agent_message' | 'end';

/** SSE data JSON 的宽松形状（字段全部 optional，运行时守卫提取） */
export interface SSEEventLike {
  type: string;
  phase?: number;
  label?: string;
  message?: string;
  moduleId?: string;
  reportId?: string;
  report?: { reportId?: string; summary?: string } | null;
  /** D590 对话帧: open.sessionId 回声 / token.text / agent_message.content / phaseComplete */
  sessionId?: string;
  text?: string;
  content?: string;
  phaseComplete?: boolean;
  [key: string]: unknown;
}

export interface SSEContractState {
  /** 当前六阶段下标（0-5；-1 = 尚未开始） */
  phaseIndex: number;
  /** 当前阶段标签（engine phase_started.label） */
  phaseLabel: string;
  /** 对话阶段（idle/thinking/streaming/done/error，对齐 conversation-store ConversationPhase） */
  phase: string;
  errorMessage: string | null;
  degraded: boolean;
}

export interface SSEContractResult {
  state: SSEContractState;
  /** complete/report_ready 时返回（供调用方 setCurrentReportId）；D590: open 帧回声 sessionId */
  reportId?: string;
  sessionId?: string;
  /** 供调用方落 conversation-store 的系统消息（phase 进度 / degraded 提示） */
  systemMessage?: { type: 'phase' | 'degraded' | 'info'; content: string };
}

function readReportId(evt: SSEEventLike): string | undefined {
  if (typeof evt.reportId === 'string' && evt.reportId.length > 0) return evt.reportId;
  const rid = evt.report?.reportId;
  if (typeof rid === 'string' && rid.length > 0) return rid;
  return undefined;
}

export function applySSEEvent(prev: SSEContractState, evt: SSEEventLike): SSEContractResult {
  switch (evt.type) {
    case 'phase_started': {
      const idx = typeof evt.phase === 'number' ? evt.phase : prev.phaseIndex;
      const label = typeof evt.label === 'string' ? evt.label : prev.phaseLabel;
      return {
        state: { ...prev, phaseIndex: idx, phaseLabel: label },
        systemMessage: { type: 'phase', content: `🔄 ${label}` },
      };
    }

    case 'phase_completed': {
      // 进度保持：不回落 phaseIndex（乱序/重复到达安全）
      return { state: { ...prev } };
    }

    case 'report_ready': {
      const rid = readReportId(evt);
      if (!rid) {
        console.warn('[sse-contract] report_ready 缺 reportId，跳过', JSON.stringify(evt));
        return { state: { ...prev } };
      }
      return { state: { ...prev }, reportId: rid };
    }

    case 'complete': {
      const rid = readReportId(evt);
      if (!rid) {
        console.warn('[sse-contract] complete 缺 report.reportId，跳过落库', JSON.stringify(evt));
      }
      return {
        state: { ...prev, phase: 'done' },
        reportId: rid,
        systemMessage: { type: 'info', content: '✅ 诊断完成' },
      };
    }

    case 'error': {
      const msg = typeof evt.message === 'string' && evt.message.length > 0
        ? evt.message
        : '诊断过程中发生错误';
      return { state: { ...prev, errorMessage: msg, phase: 'error' } };
    }

    case 'degraded': {
      const moduleId = typeof evt.moduleId === 'string' ? evt.moduleId : 'unknown';
      // 原始 moduleId 只留在开发日志（客户面不出现内部模块名；原文可追溯，见 B3）
      console.warn(`[sse-contract] 模块降级：${moduleId}`);
      return {
        state: { ...prev, degraded: true },
        systemMessage: { type: 'degraded', content: `⚠ ${CUSTOMER_TEXT.partialFeatureUnavailable}` },
      };
    }

    // 既有类型：useStreaming 侧已有 case 消费（消息渲染），状态机无变化
    case 'phase':
    case 'expert_hypothesis':
    case 'hypothesis_generated':
    case 'interim_finding':
    case 'community_reports':
    case 'entity_resolution':
    case 'judgment_card':
      return { state: { ...prev } };

    // ── D590 对话帧：known-passthrough（状态机无变化，不走未知告警分支）──
    case 'open': {
      // 提交回声语义：sessionId 供客户端与请求对账（缺失不落、不告警）
      const sessionId = typeof evt.sessionId === 'string' && evt.sessionId.length > 0 ? evt.sessionId : undefined;
      return { state: { ...prev }, sessionId };
    }
    case 'token':
    case 'agent_message':
    case 'end':
      return { state: { ...prev } };

    default:
      // 不消费但不得静默丢弃（D527 缺口 1：engine 新事件类型到达时留痕）
      console.warn('[sse-contract] 未处理的 SSE 事件类型:', evt.type);
      return { state: { ...prev } };
  }
}
