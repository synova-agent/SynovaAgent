/**
 * tui-v2/chat.tsx — Synova 增长导航 TUI 主界面 (ink 版本)
 *
 * 使用 bootstrap 共享初始化 + commands 模块化命令处理
 *
 * 用法: npx tsx src/tui-v2/chat.tsx
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { render, Box, useApp, useStdin, useStdout, Text, useInput } from 'ink';
import { bootstrap, type BootstrapResult } from './lib/bootstrap';
import { handleCommand, tryConfigureKey, type CommandContext } from './lib/commands';
import { createLogger } from '@synova/logger';
import type Database from 'better-sqlite3';
// D603 跨层修复（簇6）: 全局调度器经 L2 scheduler-service 访问，不直触 cron/scheduler（铁律 39）
import { getGlobalScheduler } from '../agent/scheduler-service';
import { checkForUpdates, formatUpdateMessage, type UpdateCheckResult } from '../services/update-checker';
import { getCostTracker, formatCost } from '../services/llm-cost';
import { fetchDeepseekBalance, formatBalance, type BalanceResult } from '../services/deepseek-balance';
import { loadConfig } from '../config';
import { getAllExpertIds } from '../agent/expert-config-loader';

import { Header } from './components/header';
import { ChatPanel } from './components/chat-panel';
import { SidePanel } from './components/side-panel';
import { Composer } from './components/composer';
import { StatusBar } from './components/status-bar';
import { createInitialState, type TuiState } from './types';
import { useStreaming } from './hooks/use-streaming';
import { SidebarAggregator } from './lib/sidebar-aggregator';
import { installStdinProxy, setScrollHandlers } from './lib/mouse-input';

const log = createLogger('tui-v2');
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const OPENING_MESSAGE = '你好！我是 Synova 增长导航助手。\n\n我能帮助你：\n- 设定增长目标\n- 发现增长障碍\n- 协调 AI 专家分析\n- 生成诊断报告';
const STATUS_HINTS = '↑↓ 滚动 │ PgUp/PgDn 翻页 │ /setup │ /balance │ /help │ Ctrl+C 退出';

/**
 * 专家展示标签（仅供展示，非集合来源）— D567: 专家集合以 expert/expert-registry.yaml
 * 为唯一事实源（getAllExpertIds 动态读取）；新增专家未配标签时降级显示 ID 本身。
 * 标签内容与 expert/<id>/manifest.json 的 displayName 对齐（D650 问题域命名同步）。
 */
const EXPERT_DISPLAY_NAMES: Record<string, string> = {
  host: '主持人',
  'fundamental-efficiency': '资金效率专家',
  'customer-growth': '客户增长专家',
  'organizational-capability': '组织能力专家',
  'technology-foundation': '技术底座专家',
  'competitive-strategy': '竞争与战略专家',
};

// ═══ 辅助: 从 GraphStore 加载增长目标 ═══

async function loadGoalsIntoAggregator(agg: SidebarAggregator, db: unknown): Promise<void> {
  try {
    const { SqliteGraphStore } = await import('../adapters/sqlite-graph-store');
    const store = new SqliteGraphStore(db as Database.Database) as unknown as {
      queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{ id: string; props: Record<string, unknown> }>;
    };
    const goals = store.queryNodes('GOAL', { status: 'active' }, 'default');
    agg.loadGoals(
      goals.map(g => ({
        id: g.id,
        text: (g.props?.name as string) || g.id,
        progressPct: (g.props?.progress as number) || 0,
        elapsedDays: 0,
        totalDays: (g.props?.totalDays as number) || 90,
        phase: (g.props?.phase as number) || 0,
      }))
    );
  } catch (err: any) {
    // 静默降级 — GraphStore 不可用时右边栏目标区为空
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') {
      (await import('@synova/logger')).createLogger('tui-v2').warn({ err: err.message }, '加载增长目标失败');
    }
  }
}

// ═══ 主组件 ═══

function TuiApp({ bctx }: { bctx: BootstrapResult }) {
  const { provider: initialProvider, llmHealthy: initialHealthy, db, store, eventBus, hookRunner, sessionManager, stateMachine, wiring, sessionId } = bctx;
  const { exit } = useApp();
  const { setRawMode } = useStdin();
  const { stdout } = useStdout();

  const [termHeight, setTermHeight] = useState(stdout?.rows || 24);
  const [termWidth, setTermWidth] = useState(stdout?.columns || 80);
  const [state, setState] = useState<TuiState>(createInitialState);
  const { streamingText, isStreaming: streaming, startStreaming, appendToken, finishStreaming, cancelStreaming } = useStreaming();
  const [setupState, setSetupState] = useState<null | 'awaiting_key'>(null);
  const [sidebarShown, setSidebarShown] = useState(false);
  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const balanceText = balance ? formatBalance(balance) : '';
  const monthlyText = formatCost(getCostTracker().monthlyCost);
  const [llmHealthy, setLlmHealthy] = useState(initialHealthy);
  const [currentProvider, setCurrentProvider] = useState(initialProvider);
  const [thinkingDisplay, setThinkingDisplay] = useState('');
  const [scrollLineOffset, setScrollLineOffset] = useState(0); // 0 = 粘底，>0 = 从底部往上跳过的行数

  const convRef = useRef<any>(undefined);
  const expertStatusMapRef = useRef(new Map<string, { name: string; status: 'queued' | 'running' | 'done' | 'failed'; elapsed?: string }>());
  const turnTraceIdRef = useRef('');
  const sidebarAggRef = useRef(new SidebarAggregator());

  // 同步 aggregator → state.sidebar
  const syncSidebar = useCallback(() => {
    setState(prev => ({ ...prev, sidebar: sidebarAggRef.current.getSnapshot() }));
  }, []);

  // Raw mode + resize
  useEffect(() => {
    setRawMode(true);
    const handleResize = () => {
      setTermHeight(stdout?.rows || 24);
      setTermWidth(stdout?.columns || 80);
    };
    stdout?.on('resize', handleResize);
    return () => {
      setRawMode(false);
      stdout?.off('resize', handleResize);
    };
  }, []);

  // 消息辅助
  const addUserMessage = useCallback((text: string) => {
    setState(prev => ({ ...prev, messages: [...prev.messages, { role: 'user', text }] }));
    setScrollLineOffset(0);
    setUserScrolled(false);
  }, []);
  const addAgentMessage = useCallback((text: string) => {
    setState(prev => ({ ...prev, messages: [...prev.messages, { role: 'agent', text }] }));
  }, []);
  const addSystemMessage = useCallback((text: string) => {
    setState(prev => ({ ...prev, messages: [...prev.messages, { role: 'system', text }] }));
  }, []);
  const addAlertMessage = useCallback((text: string) => {
    setState(prev => ({ ...prev, messages: [...prev.messages, { role: 'alert', text }] }));
  }, []);

  // 滚动控制 — 按消息条数偏移 (每次 3 条，对标 CodeWhale page scroll)
  const [userScrolled, setUserScrolled] = useState(false);
  const onScrollUp = useCallback(() => {
    setScrollLineOffset(prev => prev + 1);
    setUserScrolled(true);
  }, []);
  const onScrollDown = useCallback(() => {
    setScrollLineOffset(prev => {
      const next = prev - 1;
      if (next <= 0) setUserScrolled(false);
      return Math.max(0, next);
    });
  }, []);

  // 全局滚动快捷键
  const scrollUpRef = useRef(onScrollUp);
  const scrollDownRef = useRef(onScrollDown);
  scrollUpRef.current = onScrollUp;
  scrollDownRef.current = onScrollDown;
  useInput((_input, key) => {
    if (key.pageUp || (key.ctrl && key.upArrow)) {
      for (let i = 0; i < 5; i++) scrollUpRef.current();  // 5 条消息 / PgUp
      return;
    }
    if (key.pageDown || (key.ctrl && key.downArrow)) {
      for (let i = 0; i < 5; i++) scrollDownRef.current();  // 5 条消息 / PgDn
      return;
    }
  }, { isActive: true });

  // 鼠标滚轮 — stdin 代理在 render() 之前已安装, 这里注入回调
  useEffect(() => {
    setScrollHandlers(
      () => { for (let i = 0; i < 3; i++) scrollUpRef.current(); },
      () => scrollDownRef.current(),
    );
    return () => setScrollHandlers(null, null);
  }, []);

  // ConversationEngine 初始化
  const initConversationEngine = useCallback(async (prov: any) => {
    try {
      const { ConversationEngine } = await import('../agent/conversation-engine');
      const conv = new ConversationEngine(prov, {});
      try {
        const { createKnowledgeAgent } = await import('../l3/knowledge-agent');
        const kAgent = createKnowledgeAgent();
        kAgent.registerTo(conv.getToolRegistry() as unknown as { register: (tool: Record<string, unknown>) => void });
      } catch (err: any) {
        log.warn({ err: err.message }, 'KnowledgeAgent 注册到 TUI 失败');
      }
      convRef.current = conv;
      setState(prev => ({ ...prev, status: `准备就绪 · ${prov.name}` }));
      // 加载已有的增长目标到右边栏
      await loadGoalsIntoAggregator(sidebarAggRef.current, db);
      syncSidebar();
      return true;
    } catch (err: any) {
      log.error({ err }, 'ConversationEngine 初始化失败');
      return false;
    }
  }, []);

  // 命令上下文
  const cmdCtx: CommandContext = useMemo(() => ({
    sessionId,
    db,
    store,
    convRef,
    currentProvider,
    addSystemMessage,
    addAgentMessage,
    addAlertMessage,
    setSetupState,
    setStreaming: startStreaming,
    setStatus: (s: string) => setState(prev => ({ ...prev, status: s })),
    setCurrentProvider,
    setLlmHealthy,
    initConversationEngine,
    exit,
    getGlobalScheduler,
  }), [sessionId, db, store, currentProvider, addSystemMessage, addAgentMessage, addAlertMessage, initConversationEngine, exit]);

  // 初始启动
  useEffect(() => {
    if (currentProvider && llmHealthy) {
      initConversationEngine(currentProvider).then(ok => {
        if (!ok) addSystemMessage('⚠️ LLM 连接异常。输入 /setup 重新配置。');
      });
    }

    // 检查更新
    checkForUpdates().then((result: UpdateCheckResult) => {
      const msg = formatUpdateMessage(result);
      if (msg) addSystemMessage(msg);
    }).catch(() => {});

    // 获取 DeepSeek 账户余额
    fetchDeepseekBalance().then(b => {
      if (b) setBalance(b);
    }).catch(() => {});

    // Cron 监测
    const scheduler = getGlobalScheduler(db);
    scheduler.schedule('ontology-monitor', '*/5 * * * *', async () => {
      try {
        const response = await fetch(`http://localhost:${loadConfig().port}/api/ontology/graph/${convRef.current?.getOrgId() || 'default'}`);
        if (response.ok) { const data = await response.json() as { nodeCount?: number }; }
      } catch (err: any) {
        log.warn({ err: err.message }, '[cron] 本体 API 未就绪');
      }
    });

    // Graceful shutdown
    const shutdown = (signal: string) => {
      log.info({ signal }, '收到信号，开始优雅关闭');
      if (convRef.current) store.saveState(sessionId, convRef.current.serialize());
      scheduler.stop();
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
      db.close();
      exit();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // 欢迎消息
    let welcome = formatWelcome({
      providerName: currentProvider?.name || '未配置',
      model: process.env.LLM_MODEL || (llmHealthy ? 'deepseek-v4-flash' : '待配置'),
      workDir: process.cwd(),
      healthy: llmHealthy,
    });
    if (!llmHealthy) {
      welcome += '\n👋 检测到你还没有配置 LLM。输入 /setup 粘贴 DeepSeek API Key 即可。';
    } else {
      welcome += '\n\n' + OPENING_MESSAGE;
    }
    addAgentMessage(welcome);

    // 全局告警桥接
    (globalThis as Record<string, unknown>).__synovaAlerts = {
      pushAlert(_level: string, title: string, _data: string, _suggestion: string) {
        sidebarAggRef.current.addLegacy({ title });
        syncSidebar();
      },
    };
  }, []);

  // 处理用户输入
  const handleSubmit = useCallback(async (input: string) => {
    if (streaming) {
      setState(prev => ({ ...prev, status: '正在生成回复，请稍候...' }));
      return;
    }

    // ── 立即显示用户消息（对标 CodeWhale: add_message + scroll_to_bottom）──
    addUserMessage(input);
    setThinkingDisplay(''); // 清除上一轮思考显示

    // LLM 配置向导
    if (setupState === 'awaiting_key') {
      startStreaming();
      await tryConfigureKey(input, cmdCtx);
      cancelStreaming();
      return;
    }

    startStreaming();

    try {
      // 命令处理
      const result = await handleCommand(input, cmdCtx);
      if (result.handled) {
        if (result.streaming !== undefined && !result.streaming) cancelStreaming();
        else finishStreaming();
        return;
      }

      // 正常消息 — 需要 LLM 已配置
      if (!convRef.current || !currentProvider) {
        if (/^sk-/i.test(input)) {
          addSystemMessage('检测到 API Key，正在验证...');
          await tryConfigureKey(input, cmdCtx);
          cancelStreaming();
          return;
        }
        addSystemMessage('LLM 尚未配置。输入 /setup 配置 DeepSeek API Key。\n\n💡 也可以直接粘贴你的 Key（以 sk- 开头），自动识别。');
        cancelStreaming();
        return;
      }

      // 首次真实对话 → 显示右边栏
      if (!sidebarShown) setSidebarShown(true);

      store.addMessage(sessionId, 'user', input);

      turnTraceIdRef.current = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      setState(prev => ({ ...prev, status: '分析进行中' }));

      // 流式对话
      const thinking = await import('./lib/thinking');
      const convResult = await convRef.current.processMessageStream(input, (token: any) => {
        const t = (token as { type?: string; text?: string; content?: string });
        if (t.type === 'reasoning') {
          if (!thinking.hasThought()) thinking.beginThought();
          thinking.appendThought(t.text || t.content || String(token));
          setThinkingDisplay(thinking.renderThought());
        } else {
          const text = typeof token === 'string' ? token : (t.content || t.text || '');
          appendToken(text);
        }
      });

      // ── 先添加完整 agent 消息，再结束流式状态 ──
      addAgentMessage(convResult.reply);
      thinking.finalizeThought();
      setThinkingDisplay(thinking.renderThought());
      finishStreaming();

      // 事件记录
      eventBus.emit({
        id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'interview.answered',
        consultationId: sessionId,
        phase: convRef.current.getPhase(),
        data: { role: convRef.current.getOrgId() },
        traceId: turnTraceIdRef.current,
        spanId: turnTraceIdRef.current.slice(0, 16),
        timestamp: new Date().toISOString(),
      });

      // 成本追踪
      const usage = (convResult as { usage?: { promptTokens?: number; completionTokens?: number } }).usage;
      if (usage) {
        const tracker = getCostTracker();
        const { exceeded, cost } = tracker.record(
          process.env.LLM_MODEL || 'deepseek-v4-flash',
          usage.promptTokens || 0,
          usage.completionTokens || 0,
        );
        setState(prev => ({ ...prev, cost: { session: cost, monthly: tracker.monthlyCost } }));
        if (exceeded) {
          addSystemMessage(`⚠️ 本次诊断费用已达预算上限。剩余预算: ${formatCost(tracker.budgetRemaining)}。可通过 /budget <金额> 调整上限。`);
        }
      }

      store.addMessage(sessionId, 'assistant', convResult.reply);
      store.updateSession(sessionId, { phase: convRef.current.getPhase() });
      store.saveState(sessionId, convRef.current.serialize());

      // 会话压缩
      sessionManager.addMessage({ role: 'user', content: input });
      sessionManager.addMessage({ role: 'assistant', content: convResult.reply });
      const compactionSummary = wiring.checkCompaction();
      if (compactionSummary) addSystemMessage('📦 会话已自动压缩 (节省上下文空间)');

      // Phase 完成处理
      if (convResult.phaseComplete) {
        handlePhaseComplete(convResult);
      }
    } catch (err: any) {
      addAlertMessage(`错误: ${err.message}`);
    } finally {
      // finishStreaming 已清除流式状态，这里仅做安全兜底
      cancelStreaming();
      setState(prev => ({ ...prev, status: '准备就绪' }));
    }
  }, [streaming, setupState, currentProvider, sidebarShown, cmdCtx, startStreaming, appendToken, finishStreaming, cancelStreaming]);

  // Phase 完成处理
  const handlePhaseComplete = useCallback(async (convResult: any) => {
    wiring.emitPhaseCompleted(sessionId, 0, turnTraceIdRef.current);
    wiring.advancePhase(sessionId, turnTraceIdRef.current);
    setState(prev => ({ ...prev, status: '目标确认完成' }));
    addSystemMessage('═══ 目标已确认，启动增长导航 ═══');

    convRef.current?.startDiagnosis('管理者', convRef.current?.getOrgId() || '用户').then(() => {}).catch(() => {});

    setState(prev => ({ ...prev, status: 'Phase 1: 数据采集中...' }));
    const expertStatusMap = expertStatusMapRef.current;
    const sidebarAgg = sidebarAggRef.current;
    expertStatusMap.clear();

    // D567: 专家集合从 expert-registry.yaml 动态读取（消灭旧 6 位硬编码枚举），
    // yaml 变更（增删专家）后侧栏自动跟随，无需改代码
    const EXPERT_NAMES: Record<string, string> = Object.fromEntries(
      getAllExpertIds().map((id) => [id, EXPERT_DISPLAY_NAMES[id] ?? id]),
    );
    for (const [id, name] of Object.entries(EXPERT_NAMES)) {
      expertStatusMap.set(id, { name, status: 'queued' });
    }
    sidebarAgg.setExperts(
      [...expertStatusMap.entries()].map(([id, s]) => ({ id, name: s.name, status: s.status, elapsed: s.elapsed }))
    );
    syncSidebar();

    convRef.current?.startDiagnosis(
      '管理者',
      convRef.current?.getOrgId() || '用户',
      (event: any) => {
        switch (event.type) {
          case 'phase_started':
            setState(prev => ({ ...prev, status: `Phase ${event.phase}: ${event.label || '进行中...'}` }));
            for (const [, s] of expertStatusMap) {
              if (s.status === 'queued') { s.status = 'running'; break; }
            }
            sidebarAgg.setPhase(event.phase ?? 0);
            sidebarAgg.setExperts(
              [...expertStatusMap.entries()].map(([id, s]) => ({ id, name: s.name, status: s.status, elapsed: s.elapsed }))
            );
            syncSidebar();
            break;
          case 'module_completed':
            if (event.findings) {
              sidebarAgg.mergeObstacles(event.findings);
              for (const f of event.findings) {
                for (const [id, s] of expertStatusMap) {
                  if (f.moduleId?.includes(id) && s.status === 'running') {
                    s.status = 'done'; s.elapsed = ''; break;
                  }
                }
              }
              sidebarAgg.setExperts(
                [...expertStatusMap.entries()].map(([id, s]) => ({ id, name: s.name, status: s.status, elapsed: s.elapsed }))
              );
              syncSidebar();
            }
            break;
          case 'phase_completed':
            addSystemMessage(`✅ Phase ${event.phase} 完成`);
            sidebarAgg.setPhase((event.phase ?? 0) + 1);
            syncSidebar();
            break;
          case 'complete':
            setState(prev => ({ ...prev, status: '导航完成' }));
            addSystemMessage('📋 增长导航已完成，查看侧边栏获取完整简报。');
            for (const [, s] of expertStatusMap) {
              if (s.status !== 'done' && s.status !== 'failed') s.status = 'done';
            }
            sidebarAgg.setExperts(
              [...expertStatusMap.entries()].map(([id, s]) => ({ id, name: s.name, status: s.status, elapsed: s.elapsed }))
            );
            syncSidebar();
            break;
          case 'error':
            addAlertMessage(`⚠️ 导航错误: ${event.message || '未知'}`);
            break;
        }
      },
    ).then(async (diagnosisResult: any) => {
      if (diagnosisResult) {
        log.info({ teamId: diagnosisResult.teamId, durationMs: diagnosisResult.totalDurationMs }, '增长导航完成');
        if (diagnosisResult.degradedModules?.length > 0) {
          addSystemMessage(`⚠️ 部分分析模块降级: ${diagnosisResult.degradedModules.join(', ')}`);
        }
        sidebarAgg.clearExperts();
        // 诊断完成后重载目标 (可能创建了新目标)
        await loadGoalsIntoAggregator(sidebarAgg, db);
        syncSidebar();
      } else {
        addAlertMessage('⚠️ 导航引擎不可用。诊断引擎未返回结果，请检查 Synova 引擎配置。');
      }
      setState(prev => ({ ...prev, status: '准备就绪' }));
    }).catch((err: any) => {
      log.error({ err }, '增长导航异常');
      addAlertMessage(`导航异常: ${err.message}`);
      setState(prev => ({ ...prev, status: '准备就绪' }));
    });
  }, [sessionId, wiring, addSystemMessage, addAlertMessage]);

  // 过滤显示消息
  const displayMessages = useMemo(() => state.messages.filter(m => !m.streaming), [state.messages]);

  // 布局计算
  const headerHeight = 1;
  const composerHeight = 3;
  const statusBarHeight = 1;
  const contentHeight = Math.max(3, termHeight - headerHeight - composerHeight - statusBarHeight);
  const chatWidth = Math.floor(termWidth * 0.7);
  const sideWidth = Math.floor(termWidth * 0.3);

  return (
    <Box flexDirection="column" height={termHeight}>
      <Header title="Synova 增长导航" status={state.status} model={currentProvider?.name || '未配置'} workDir={process.cwd()} />
      <Box flexDirection="row" height={contentHeight}>
        <ChatPanel messages={displayMessages} streamingText={streamingText} isStreaming={streaming} thinkingText={thinkingDisplay} scrollLineOffset={scrollLineOffset} width={chatWidth} height={contentHeight} />
        {sidebarShown && (
          <SidePanel snapshot={state.sidebar} width={sideWidth} height={contentHeight} />
        )}
      </Box>
      <Composer onSubmit={handleSubmit} onScrollUp={onScrollUp} onScrollDown={onScrollDown} />
      <StatusBar mode="增长导航" model={currentProvider?.name || '未配置'} balance={balanceText} monthlyCost={monthlyText} hints={STATUS_HINTS} />
    </Box>
  );
}

// ═══ Welcome 格式化 ═══

function formatWelcome(opts: { providerName: string; model: string; workDir: string; healthy: boolean }) {
  return [
    '╔══════════════════════════════════════════╗',
    '║     Synova 增长导航助手 v0.2.0            ║',
    '╚══════════════════════════════════════════╝',
    '',
    `Provider : ${opts.providerName}`,
    `Model    : ${opts.model}`,
    `WorkDir  : ${opts.workDir}`,
    `Status   : ${opts.healthy ? '✅ 已连接' : '⚠️ 未配置'}`,
    '',
    '快捷键:',
    '  Ctrl+C   退出',
    '  /setup   配置 LLM',
    '  /model   切换模型',
    '  /help    查看帮助',
  ].join('\n');
}

// ═══ Main ═══

async function main() {
  const bctx = await bootstrap();

  installStdinProxy();
  render(
    React.createElement(TuiApp, { bctx })
  );
}

main().catch((err) => {
  console.error(`${RED}Fatal: ${err.message}${RESET}`);
  process.exit(1);
});
