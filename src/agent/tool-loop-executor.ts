/**
 * agent/tool-loop-executor.ts — LLM + Tool 执行循环 (ConversationEngine 子组件)
 *
 * 从 ConversationEngine (915 行) 中提取的第 1 个子组件。
 * 职责: callLLMWithTools() + streamWithToolLoop() (~200 行)
 *
 * Iron law #32: 错误统一通过 try/catch + log 处理。
 * Iron law #31: degraded 信号传播——工具失败不阻断对话。
 */
import type { LLMMessage, ChatOptions, ToolCall } from '../providers/types';
import type { EngineContext } from './engine-context';
import { createLogger } from '@synova/logger';
import { ToolGuard } from '../l3/tool-guard';
import { pruneToolResult, ToolResultPruneError } from '../llm/tool-result-pruner';
// D810 接线: LLM 调用韧性层（B-02 重试 / B-06 协作式超时）——本文件是生产 LLM 调用链
// （ConversationEngine → ToolLoopExecutor → provider.chat）。outcome 化：失败返回 code，不抛。
// 重试事件落 D500 事件流（投影计数单元见 store/retry-projection，由 deploy/bootstrap 注册）：
// 落盘缝在 src/llm（共享基础设施层）——铁律 39 禁本层静态 import src/store。
import { callWithResilience, appendRetryEvent, type LlmRetryEvent, type ResilienceOutcome } from '../llm/retry-middleware';

/** Tool execution result — may contain error property on failure */
interface ToolExecResult {
  error?: string;
  [key: string]: unknown;
}

/** D819: 出站 assistant.tool_calls 的 OpenAI 形状（id/type/function）—— 配对 id 的唯一来源 */
type OutboundToolCall = ToolCall & { id: string; type: 'function' };

/** 错误消息提取（catch err: unknown → string；铁律 38 零 as any） */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ToolLoopExecutor {
  private ctx: EngineContext;
  private log = createLogger('agent/tool-loop');
  private toolGuard = new ToolGuard();
  /** D819: 缺失 tool_call id 时的确定性兜底序号（executor 实例内单调；禁 crypto.randomUUID） */
  private toolCallSeq = 0;

  constructor(ctx: EngineContext) {
    this.ctx = ctx;
  }

  /**
   * normalizeToolCalls — 工具调用归一化：assistant.tool_calls 与其后 role='tool' 消息必须共用同一 id。
   *
   * 契约（铁律 47）:
   *   @input  — calls: ToolCall[]（模型/provider 返回的 toolCalls；测试替身可能不带 id）
   *   @output — OutboundToolCall[]：id 恒非空（模型给了 → 原样透传；缺失 → 确定性哨兵 id
   *             `call_loop_<n>`），type 恒 'function'，function 原样保留
   *   @degraded — 缺 id → 合成确定性 id + log.warn({degraded:true})：配对仍合法，模型不会收到
   *               结构非法的工具对话（旧实现用随机 UUID → tool_call_id 与 assistant.tool_calls 失配）
   *   @error  — 不抛（纯数据面，无 I/O）
   */
  private normalizeToolCalls(calls: ToolCall[]): OutboundToolCall[] {
    return calls.map((tc) => {
      const modelId = typeof tc.id === 'string' && tc.id.length > 0 ? tc.id : '';
      if (modelId.length > 0) {
        return { id: modelId, type: 'function' as const, function: tc.function };
      }
      this.toolCallSeq += 1;
      const id = `call_loop_${this.toolCallSeq}`;
      this.log.warn(
        { tool: tc.function.name, synthesizedId: id, degraded: true },
        'tool_call 缺 id — 合成确定性 id 保持配对合法（非随机 UUID）',
      );
      return { id, type: 'function' as const, function: tc.function };
    });
  }

  /**
   * D587: 工具结果进提示词前的确定性修剪（head+marker+tail、码点计数、replay-safe）。
   * 降级契约（铁律 24/31）: 修剪层抛错 → log.warn + 降级为原文——不阻断对话、不丢数据。
   * ToolResultPruneError 携带稳定错误码（D586 taxonomy 风格），进结构化日志可检索。
   */
  private pruneForPrompt(text: string): string {
    try {
      return pruneToolResult(text);
    } catch (err) {
      if (err instanceof ToolResultPruneError) {
        this.log.warn({ code: err.code, phase: err.phase, degraded: true }, `工具结果修剪失败 — 降级为原文: ${err.message}`);
      } else {
        this.log.warn({ err, degraded: true }, '工具结果修剪失败 — 降级为原文');
      }
      return text;
    }
  }

  /**
   * D810: 协作式 LLM 调用（D593 韧性层 B-02/B-06 的生产接入口）。
   * @input  — messages + ChatOptions（tools 等原样透传给 provider）
   * @output — { ok:true, result, attempts } | ResilienceFailure{ code, kind, degraded, retryable }
   * @degraded — 本方法**永不抛**：可重试失败按策略退避重试；截止超时归类 TOOL_TIMEOUT
   *             立即结果化（重试不能违背调用方 deadline 意图）；调用方按 outcome.code 降级。
   */
  private callLlm(messages: LLMMessage[], options?: ChatOptions): Promise<ResilienceOutcome> {
    return callWithResilience(this.ctx.provider, messages, {
      ...options,
      onRetry: (event) => { this.onLlmRetry(event); },
    });
  }

  /**
   * D810: 重试事件落盘（onRetry → D500 事件流，store/retry-projection 投影计数）。
   * @degraded — 无 store/无 sessionId 时静默跳过（重试本身不受影响）；落盘失败 log.warn + degraded，
   *             不阻断重试链（铁律 24/31）。
   */
  private onLlmRetry(event: LlmRetryEvent): void {
    const store = this.ctx.sessionStore;
    const sessionId = this.ctx.sessionId;
    if (!store?.appendEvent || !sessionId) return;
    // 必须 bind(store)：解构出的方法丢 this，直接包成对象会让 appendEvent 读到 undefined 的 db
    // （本用例在 D810 测试 ④ 首跑即复现——落盘静默 degraded、事件流为空）
    const result = appendRetryEvent({ appendEvent: store.appendEvent.bind(store) }, sessionId, {
      provider: event.provider,
      code: event.code,
      attempt: event.attempt,
      delayMs: Math.round(event.delayMs),
      mode: event.mode,
    });
    if (!result.ok) {
      this.log.warn(
        { code: event.code, degraded: true, error: result.error },
        '重试事件落盘失败 — degraded（不阻断重试链）',
      );
    }
  }

  /**
   * Call LLM with tool execution loop (non-streaming).
   * Max 3 rounds of tool calls to prevent infinite loops.
   */
  async callLLMWithTools(): Promise<string> {
    // 裁 219 / M10-3：轮数配置化（默认 3 不变），上界 10 —— 防客户配 1000 轮致费用失控
    const MAX_TOOL_ROUNDS = Math.min(10, Math.max(1, Number.parseInt(process.env.SYNO_MAX_TOOL_ROUNDS ?? '', 10) || 3));
    const tools = this.ctx.toolRegistry.listTools();
    const { messages, hookRunner, eventBus, sessionId, toolRegistry } = this.ctx;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      try {
        const outcome = await this.callLlm(messages, {
          tools: tools.length > 0 ? toolRegistry.toOpenAITools() : undefined,
        });
        if (!outcome.ok) {
          this.log.warn(
            { code: outcome.code, kind: outcome.kind, attempts: outcome.attempts, degraded: true, round },
            'LLM 调用降级（韧性层分类）',
          );
          return `抱歉，调用失败：${outcome.message}`;
        }
        const result = outcome.result;

        // 无工具调用 → 直接返回
        if (!result.toolCalls || result.toolCalls.length === 0) {
          return result.content || '(empty response)';
        }

        // 有工具调用 → 执行并注入结果
        this.log.info({ count: result.toolCalls.length, round }, 'LLM 请求工具调用');

        // D819: assistant 必须带 tool_calls（此前只推 role+content → 模型收到的工具对话结构非法）；
        // id 与下方 tool 消息同源（模型给的 id，缺 id 走确定性兜底）
        const toolCalls = this.normalizeToolCalls(result.toolCalls);
        messages.push({
          role: 'assistant',
          content: result.content || '',
          tool_calls: toolCalls,
        });

        for (const tc of toolCalls) {
          let params: Record<string, unknown> = {};
          try {
            params = JSON.parse(tc.function.arguments);
          } catch (err) {
            this.log.warn({ err, name: tc.function.name }, '工具参数解析失败 — degraded');
            params = {};
          }

          // 编排层 Hook: pre-tool-use (权限/脱敏)
          let effectiveParams = params;
          if (hookRunner) {
            const preResult = await hookRunner.runPreToolUse({
              name: tc.function.name, input: JSON.stringify(params),
            });
            if (preResult.action === 'deny') {
              messages.push({
                role: 'tool', tool_call_id: tc.id,
                content: JSON.stringify({ error: `工具被拒绝: ${preResult.reason}` }),
              });
              eventBus?.emit({
                id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                type: 'tool.denied', consultationId: sessionId,
                data: { toolName: tc.function.name, reason: preResult.reason },
                traceId: sessionId, spanId: sessionId.slice(0, 16),
                timestamp: new Date().toISOString(),
              });
              continue; // Skip this tool, continue next
            }
            if (preResult.action === 'modify' && preResult.modifiedInput) {
              try { effectiveParams = JSON.parse(preResult.modifiedInput); } catch { this.log.debug('工具参数 JSON 解析失败 — 使用原始参数'); }
            }
          }

          // L3 ToolGuard: 工具调用前检查（循环检测 + 重复失败阻断 + 参数校验）
          const guardDecision = this.toolGuard.beforeCall(tc.function.name, effectiveParams);
          if (!guardDecision.allow) {
            this.log.warn({ tool: tc.function.name, reason: guardDecision.reason }, '工具被 ToolGuard 阻止');
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: `工具被阻止: ${guardDecision.reason}` }) });
            continue;
          }
          // D473: reminder 注入模型可见上下文（不阻断执行，决策留给模型 — DSH advisory 范式）
          if (guardDecision.level === 'reminder' && guardDecision.reminderMessage) {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify({ reminder: guardDecision.reminderMessage }),
            });
          }

          const execResult = await toolRegistry.execute(tc.function.name, effectiveParams);

          // L3 ToolGuard: 工具调用后记录（失败计数）
          this.toolGuard.afterCall(tc.function.name, execResult, 0);

          // 编排层 Hook: post-tool-use (审计/证据)
          if (hookRunner) {
            await hookRunner.runPostToolUse(
              { name: tc.function.name, input: JSON.stringify(effectiveParams) },
              { content: JSON.stringify(execResult), isError: !!(execResult as ToolExecResult).error },
            );
            eventBus?.emit({
              id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              type: 'tool.executed', consultationId: sessionId,
              data: { toolName: tc.function.name, success: !(execResult as ToolExecResult).error },
              traceId: sessionId, spanId: sessionId.slice(0, 16),
              timestamp: new Date().toISOString(),
            });
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: this.pruneForPrompt(JSON.stringify(execResult)),
          });
        }

        continue; // 下一轮 LLM 调用
      } catch (err: unknown) {
        this.log.error({ err, round }, 'LLM 调用失败');
        return `抱歉，调用失败：${errorMessage(err)}`;
      }
    }

    // 达到最大轮次 → 最后一次无工具调用
    try {
      const outcome = await this.callLlm(messages);
      if (!outcome.ok) {
        this.log.warn(
          { code: outcome.code, kind: outcome.kind, attempts: outcome.attempts, degraded: true },
          'callLLMWithTools: 最终轮 LLM 调用降级（韧性层分类）',
        );
        return `工具调用超过最大轮次: ${outcome.message}`;
      }
      return outcome.result.content || '(no response)';
    } catch (err: unknown) {
      this.log.error({ err }, 'callLLMWithTools: 最终轮 LLM 调用失败');
      return `工具调用超过最大轮次: ${errorMessage(err)}`;
    }
  }

  /**
   * Call LLM with streaming token output + tool execution loop.
   *
   * Slice 0.1 fix: single provider.chat() call per round —
   * no more separate stream()+chat() double calls.
   */
  async streamWithToolLoop(onToken: (token: string) => void): Promise<string> {
    const MAX_ROUNDS = 3;
    const tools = this.ctx.toolRegistry.listTools();
    const { messages, toolRegistry, hookRunner, eventBus, sessionId } = this.ctx;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      try {
        const outcome = await this.callLlm(messages, {
          tools: tools.length > 0 ? toolRegistry.toOpenAITools() : undefined,
        });
        if (!outcome.ok) {
          this.log.warn(
            { code: outcome.code, kind: outcome.kind, attempts: outcome.attempts, degraded: true, round },
            'streamWithToolLoop: LLM 调用降级（韧性层分类）',
          );
          return `抱歉，调用失败：${outcome.message}`;
        }
        const result = outcome.result;

        const content = result.content || '';

        // 无工具调用 → 流式输出文本 + 返回
        // D819: 最终态 assistant 由 ConversationEngine 统一入上下文（conversation-engine.ts:785/790）——
        // 此处不再 push（旧实现与本方法出口双推 → 出站角色序出现 assistant,assistant，D817-F2）。
        if (!result.toolCalls || result.toolCalls.length === 0) {
          for (const ch of content) {
            onToken(ch);
            await sleep(5); // P3-06: 5ms/char 流式动画
          }
          return content || '(empty response)';
        }

        // 有工具调用
        this.log.debug({ count: result.toolCalls.length, round }, 'streamWithToolLoop: 工具调用');

        for (const ch of content) {
          onToken(ch);
          await sleep(5);
        }

        // D819: assistant.tool_calls 归一化（id 与下方 tool 消息同源；assistant/调用 id 配对合法）
        const toolCalls = this.normalizeToolCalls(result.toolCalls);
        messages.push({
          role: 'assistant',
          content,
          tool_calls: toolCalls,
        });

        onToken('\n[工具调用: ');
        for (const tc of toolCalls) {
          onToken(tc.function.name + ' ');
          let params: Record<string, unknown> = {};
          try {
            params = JSON.parse(tc.function.arguments);
          } catch (err) {
            this.log.warn({ err, name: tc.function.name }, '工具参数解析失败 — degraded');
            params = {};
          }

          // T1.3: stream 路径也执行 hook (权限检查)
          let effectiveParams = params;
          if (hookRunner) {
            const preResult = await hookRunner.runPreToolUse({ name: tc.function.name, input: JSON.stringify(params) });
            if (preResult.action === 'deny') {
              messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: `工具被拒绝: ${preResult.reason}` }) });
              eventBus?.emit({ id: `evt_${Date.now().toString(36)}`, type: 'tool.denied', consultationId: sessionId, data: { toolName: tc.function.name, reason: preResult.reason }, traceId: sessionId, spanId: sessionId.slice(0, 16), timestamp: new Date().toISOString() });
              continue;
            }
            if (preResult.action === 'modify' && preResult.modifiedInput) {
              try { effectiveParams = JSON.parse(preResult.modifiedInput); } catch { this.log.debug('工具参数 JSON 解析失败 — 使用原始参数'); }
            }
          }

          // L3 ToolGuard: 工具调用前检查（streaming 路径）
          const guardDecision = this.toolGuard.beforeCall(tc.function.name, effectiveParams);
          if (!guardDecision.allow) {
            this.log.warn({ tool: tc.function.name, reason: guardDecision.reason }, '工具被 ToolGuard 阻止');
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: `工具被阻止: ${guardDecision.reason}` }) });
            continue;
          }
          // D473: reminder 注入模型可见上下文（streaming 路径同样消费，不阻断执行）
          if (guardDecision.level === 'reminder' && guardDecision.reminderMessage) {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify({ reminder: guardDecision.reminderMessage }),
            });
          }

          let execResult: unknown;
          try {
            execResult = await toolRegistry.execute(tc.function.name, effectiveParams);
          } catch (err: any) {
            this.log.warn({ err, tool: tc.function.name }, '工具执行失败');
            execResult = { error: `工具执行失败: ${err.message}` };
            if (hookRunner) {
              hookRunner.runPostToolUseFailure?.({ name: tc.function.name, input: JSON.stringify(effectiveParams) }, new Error(err.message)).catch((hookErr) => {
                this.log.warn({ hookErr, tool: tc.function.name }, 'PostToolUseFailure hook 执行失败 — 非阻断');
              });
            }
          }

          // L3 ToolGuard: 工具调用后记录
          this.toolGuard.afterCall(tc.function.name, execResult, 0);

          if (hookRunner && !(execResult as ToolExecResult)?.error) {
            hookRunner.runPostToolUse({ name: tc.function.name, input: JSON.stringify(effectiveParams) }, { content: JSON.stringify(execResult), isError: false }).catch((hookErr) => {
              this.log.warn({ hookErr, tool: tc.function.name }, 'PostToolUse hook 执行失败 — 非阻断');
            });
            eventBus?.emit({ id: `evt_${Date.now().toString(36)}`, type: 'tool.executed', consultationId: sessionId, data: { toolName: tc.function.name, success: true }, traceId: sessionId, spanId: sessionId.slice(0, 16), timestamp: new Date().toISOString() });
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: this.pruneForPrompt(JSON.stringify(execResult)),
          });
        }
        onToken(']\n');

        continue;
      } catch (err: unknown) {
        this.log.error({ err, round }, 'streamWithToolLoop: LLM 调用失败');
        return `抱歉，调用失败：${errorMessage(err)}`;
      }
    }

    // 达到最大轮次
    try {
      const outcome = await this.callLlm(messages);
      if (!outcome.ok) {
        this.log.warn(
          { code: outcome.code, kind: outcome.kind, attempts: outcome.attempts, degraded: true },
          'streamWithToolLoop: 最终轮 LLM 调用降级（韧性层分类）',
        );
        return '工具调用超过最大轮次，请稍后重试。';
      }
      const final = outcome.result;
      for (const ch of (final.content || '')) {
        onToken(ch);
        await sleep(5);
      }
      // D819: 同上——最终态 assistant 由 ConversationEngine 统一入上下文（此处勿再 push，防双推）
      return final.content || '(no response)';
    } catch (err: unknown) {
      this.log.error({ err }, 'streamWithToolLoop: 最终轮 LLM 调用失败');
      return '工具调用超过最大轮次，请稍后重试。';
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
