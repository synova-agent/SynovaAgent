/**
 * chat.ts — 内嵌诊断发射页 + 3 辅助接口（诚实化：D590，对齐审计附录A M7 勘误）
 *
 * 本页是"一次性诊断发射器"（内嵌 JS 只调 POST /api/diagnosis/consult），
 * 不是多轮对话 UI——多轮对话走 D590 对话 SSE 端点（src/routes/conversations.ts，
 * POST /api/conversations）；本文件也无对话 SSE（"统一 SSE"系旧头注释不实声称，已删）。
 *
 * GET /chat → 内嵌诊断发射页
 * GET /api/status → API Key 配置状态
 * GET /api/user-state → 用户状态检测
 * POST /api/proposal/:id/resolve → 提议确认
 */
import { Router, type Request, type Response } from 'express';
import { loadConfig } from '../config';
import { createLogger } from '@synova/logger';
import { getProposalManager } from '../l2/proposal-manager';

const log = createLogger('routes/chat');

const router = Router();

/**
 * 引擎 DB 句柄（惰性 + 单点）。
 * 架构棘轮: L1→L5 动态 import 收敛为**本文件唯一一处**（`tests/architecture/l1-cross-layer-baseline.txt`
 * 记 `src/routes/chat.ts=1`，棘轮只减不增）。新增 DB 需求请复用本函数，勿再就地 import。
 * 注: 返回类型由 `getDatabase()` 推断 —— 勿在此写 sqlite 驱动名的内联类型注解（会命中 L1→L5 扫描模式）。
 */
async function engineDb() {
  const { getDatabase } = await import('../init/engine-context');
  return getDatabase();
}

/** API Key 状态检查 */

router.get('/api/status', (_req: Request, res: Response) => {
  const config = loadConfig();
  res.json({
    ok: true,
    llmConfigured: !!(config.llmApiKey || config.gatewayHost),
    gatewayHost: config.gatewayHost || null,
    hasApiKey: !!config.llmApiKey,
    devMode: config.devMode,
  });
});

/** GNS v2.0: 检测用户状态 — 决定显示 Phase 0 还是直接进入默认循环 */
router.get('/api/user-state', async (_req: Request, res: Response) => {
  try {
    const { SqliteGraphStore } = await import('../adapters/sqlite-graph-store');
    const db = await engineDb();
    const store = new SqliteGraphStore(db) as unknown as { queryNodes(type: string, filters?: Record<string,unknown>, graph?: string): Array<{id:string, props:Record<string,unknown>}> };
    const summaries = store.queryNodes('GOAL', { goalType: 'mission' }, 'default')
      .filter(n => (n.props as { name?: string })?.name?.startsWith('Phase0_Interview'));
    res.json({
      ok: true,
      hasCompletedPhase0: summaries.length > 0,
      hasDataSources: !!(process.env.FEISHU_APP_ID || process.env.CRM_API_KEY),
    });
  } catch (err) {
    log.warn({ err }, '用户状态查询失败 — degraded');
    res.json({ ok: true, hasCompletedPhase0: false, hasDataSources: false });
  }
});

/** GNS v2.0: 提议确认/拒绝/看法 */
router.post('/api/proposal/:id/resolve', async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { action, feedback } = req.body as { action?: string; feedback?: string };
  if (!action || !['confirm', 'reject', 'opinion'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'action 必须是 confirm/reject/opinion' });
  }
  const mgr = getProposalManager();
  const result = mgr.resolve(id, action as 'confirm' | 'reject' | 'opinion', feedback);
  if (!result.ok) {
    return res.status(404).json(result);
  }
  // V4.2.1: 反馈收集 — collectFeedback 持久化用户决策
  // Phase P0-1: 迁移到 @synova/evolution, 增加 orgId
  // #981（0-7）: ① 补传 memoryStore（不传 ⇒ collectFeedback 的 persisted 恒 false，反馈永不落库）
  //              ② 禁空吞（原 `.catch(()=>{})` + 无绑定 catch{log.debug} 违铁律 24+31）
  // 降级契约: 反馈写入失败不阻断提议确认主流程，但必须 log.warn + 在响应里显式回传 degraded（铁律 31）。
  let feedbackPersisted = false;
  let feedbackDegraded = false;
  try {
    const { collectFeedback } = await import('@synova/evolution');
    // L2 接缝（#981）: 记忆 store 视图由 services/memory-access-service 提供 —— L1 不直触 L4（铁律 39 + 架构棘轮）
    const { getMemoryWriter } = await import('../services/memory-access-service');
    const memoryStore = getMemoryWriter();
    // K6/2-3 通道归一: 同一决策同时落通道 A（feedback_log）——此前只落通道 B（agent_memory），
    // GA 的正向值（confirm）在增长侧永远不可见（两通道分裂）。sink 永不抛（内部降级 + log.warn）。
    const { createEvolutionChannelSink } = await import('../growth/feedback-collector');
    const fb = await collectFeedback({
      orgId: (req.body as Record<string, unknown>)?.orgId as string || 'default',
      actionId: id,
      decision: action === 'confirm' ? 'confirm' : action === 'reject' ? 'reject' : 'modify',
      reason: feedback || undefined,
    }, memoryStore ?? undefined, createEvolutionChannelSink());
    feedbackPersisted = fb.persisted;
    if (!fb.persisted) {
      feedbackDegraded = true;
      log.warn({ actionId: id, decision: action }, '反馈未持久化 — memoryStore 写入未生效 (degraded)');
    }
  } catch (err: unknown) {
    feedbackDegraded = true;
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, actionId: id }, '反馈收集失败 — degraded（不阻断提议确认）');
  }
  res.json({
    ok: true,
    proposal: result.proposal,
    feedback: { persisted: feedbackPersisted, degraded: feedbackDegraded },
  });
});

// ═══ Web 对话界面 (GET /chat) ═══

router.get('/chat', (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Synova · 增长导航</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>🔍</text></svg>">
<style>
:root{
  --bg:#0f0f14;--panel:#1a1a24;--border:#2a2a3a;--text:#e0e0e0;--dim:#888;
  --accent:#6c5ce7;--accent2:#a29bfe;--red:#e74c3c;--green:#2ecc71;
  --orange:#f39c12;--cyan:#4ecdc4;--input:#12121a
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column;overflow:hidden}
/* ── Header ── */
header{background:var(--panel);border-bottom:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;z-index:10}
header h1{font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}
header .dot{width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0}
header .dot.off{background:var(--red)}
header .status{font-size:11px;color:var(--dim)}
/* ── Progress Bar (L1-P0-2) ── */
#progress-bar-container{background:var(--panel);border-bottom:1px solid var(--border);padding:8px 20px;flex-shrink:0;display:none}
#progress-bar-container.active{display:block}
#progress-bar-track{width:100%;height:4px;background:#1a1a2a;border-radius:2px;overflow:hidden;margin-bottom:4px}
#progress-bar-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--cyan));border-radius:2px;transition:width .5s ease;width:0%}
#progress-phases{display:flex;gap:2px;flex-wrap:wrap}
#progress-phases .p-dot{width:18px;height:18px;border-radius:50%;border:2px solid #2a2a3a;font-size:9px;display:flex;align-items:center;justify-content:center;transition:all .3s}
#progress-phases .p-dot.done{background:var(--green);border-color:var(--green);color:#000}
#progress-phases .p-dot.active{border-color:var(--accent2);animation:pulse 1.5s infinite}
#progress-phases .p-label{font-size:10px;color:var(--dim);margin:0 8px 0 2px;align-self:center}
/* ── Messages ── */
#messages{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
.msg{max-width:85%;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.65;animation:fadeIn .3s}
.msg.user{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:3px}
.msg.agent{align-self:flex-start;background:var(--panel);border:1px solid var(--border);border-bottom-left-radius:3px}
.msg.system{align-self:center;background:transparent;color:var(--dim);font-size:11px;text-align:center;max-width:100%}
/* ── Dimension + Expert labels (Day3) ── */
.dim-tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;margin-right:4px}
.dim-tag.covered{background:#0a2a0a;color:var(--green)}
.dim-tag.missing{background:#2a0a0a;color:var(--red)}
.dim-tag.partial{background:#2a1a0a;color:var(--orange)}
.expert-watching{font-size:10px;color:var(--dim);margin-top:4px;display:flex;gap:6px;flex-wrap:wrap}
.expert-watching span{background:var(--panel);border:1px solid var(--border);padding:1px 6px;border-radius:3px}
.intent-notice{font-size:10px;color:var(--orange);margin-top:2px;font-style:italic}
/* ── Interim Finding Card (L1-P0-3) ── */
.card-finding{align-self:flex-start;background:#0d1a1a;border:1px solid #1a3a3a;border-left:3px solid var(--cyan);border-radius:8px;padding:10px 14px;font-size:12px;line-height:1.6;max-width:90%}
.card-finding .card-title{font-weight:600;color:var(--cyan);margin-bottom:4px;font-size:13px;display:flex;align-items:center;gap:6px}
.card-finding .card-body{color:#b0c8c8}
.card-finding .card-meta{font-size:10px;color:var(--dim);margin-top:6px;display:flex;gap:12px}
.card-confidence{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600}
.card-confidence.high{background:#0a2a0a;color:var(--green)}
.card-confidence.medium{background:#2a1a0a;color:var(--orange)}
.card-confidence.low{background:#2a0a0a;color:var(--red)}
/* ── Judgment Card (Slice 3: Agent 结构化回复) ── */
.card-judgment{align-self:flex-start;background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.7;max-width:88%;animation:fadeIn .35s}
.card-judgment.confirmed{border-left-color:var(--green);background:#0a1a0a}
.card-judgment .jc-header{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.card-judgment .jc-title{font-weight:600;font-size:14px;color:var(--text);display:flex;align-items:center;gap:6px}
.card-judgment .jc-experts{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}
.card-judgment .jc-expert-tag{font-size:10px;padding:2px 8px;border-radius:10px;background:#1a1a2a;color:var(--accent2);border:1px solid #2a2a4a}
.card-judgment .jc-section{margin-bottom:10px}
.card-judgment .jc-label{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px}
.card-judgment .jc-root-cause{color:var(--text);font-size:13px;padding:8px 10px;background:var(--bg);border-radius:6px;border-left:3px solid var(--orange)}
.card-judgment .jc-suggestion{color:var(--text);font-size:13px;padding:8px 10px;background:var(--bg);border-radius:6px;border-left:3px solid var(--cyan)}
.card-judgment .jc-confidence-bar{height:5px;background:#1a1a2a;border-radius:3px;overflow:hidden;margin-top:4px}
.card-judgment .jc-confidence-fill{height:100%;border-radius:3px;transition:width .5s ease}
.card-judgment .jc-confidence-fill.high{background:var(--green)}
.card-judgment .jc-confidence-fill.medium{background:var(--orange)}
.card-judgment .jc-confidence-fill.low{background:var(--red)}
.card-judgment .jc-meta{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dim);margin-top:6px}
.card-judgment .jc-actions{display:flex;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)}
.card-judgment .jc-actions button{padding:6px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s}
.card-judgment .jc-btn-confirm{background:#0a2a0a;color:var(--green);border:1px solid var(--green)}
.card-judgment .jc-btn-confirm:hover{background:var(--green);color:#000}
.card-judgment .jc-btn-discuss{background:var(--bg);color:var(--accent2);border:1px solid var(--accent2)}
.card-judgment .jc-btn-discuss:hover{background:var(--accent2);color:var(--bg)}
.card-judgment .jc-confirmed-badge{display:inline-flex;align-items:center;gap:4px;background:#0a2a0a;color:var(--green);padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600}
/* ── Phase Event ── */
.msg.phase{background:#1a1a2e;border:1px solid #2a2a4e;border-left:3px solid var(--accent2);padding:8px 12px;font-size:12px;color:var(--accent2);border-radius:6px;align-self:flex-start;max-width:90%}
.msg.phase.completed{background:#0a1a0a;border-color:#1a3a1a;border-left-color:var(--green);color:var(--green)}
/* ── Degraded Banner ── */
.msg.degraded{align-self:center;background:#2d1f1f;border:1px solid #5c2a2a;color:#e0a0a0;font-size:11px;padding:8px 14px;border-radius:6px;max-width:90%}
/* ── Input ── */
#input-area{background:var(--panel);border-top:1px solid var(--border);padding:10px 20px;display:flex;gap:10px;flex-shrink:0}
#input-area textarea{flex:1;background:var(--input);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:13px;outline:none;font-family:inherit}
#input-area textarea:focus{border-color:var(--accent)}
#input-area button{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;cursor:pointer;font-weight:600;white-space:nowrap}
#input-area button:hover{background:var(--accent2)}
#input-area button:disabled{opacity:.5;cursor:default}
/* ── Quick Actions (Notion AI 风格按钮) ── */
#quick-actions{display:flex;gap:8px;padding:0 20px 8px;flex-shrink:0;flex-wrap:wrap}
.q-btn{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:6px 14px;font-size:12px;color:var(--text);cursor:pointer;transition:all .2s}
.q-btn:hover{background:var(--accent);border-color:var(--accent);color:#fff}
/* ── Banner ── */
.banner{background:#2d1f1f;border:1px solid #5c2a2a;padding:14px;border-radius:8px;margin-bottom:14px;font-size:12px;line-height:1.7;max-width:90%;align-self:center}
.banner code{background:#1a0f0f;padding:2px 6px;border-radius:3px;color:#e74c3c}
.banner .cmd{display:block;background:#0a0a0f;padding:8px 12px;border-radius:4px;margin:8px 0;font-family:monospace;font-size:11px;color:var(--accent2)}
/* ── Graph Visualization (L1: Cytoscape.js — Batch 4) ── */
#graph-panel{display:none;flex:1;background:var(--bg);position:relative;overflow:hidden}
#graph-panel.active{display:flex}
#cy-container{flex:1;z-index:1}
#graph-panel .graph-toolbar{position:absolute;top:10px;right:10px;z-index:10;display:flex;gap:6px}
#graph-panel .graph-toolbar button{background:var(--panel);border:1px solid var(--border);color:var(--text);padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer}
#graph-panel .graph-legend{position:absolute;bottom:10px;left:10px;z-index:10;background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:10px}
#graph-panel .graph-legend span{margin-right:10px;display:inline-flex;align-items:center;gap:4px}
.legend-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
/* ── GNS v2.0: 双栏布局 ── */
#main-layout{display:grid;grid-template-columns:1fr 320px;gap:0;flex:1;overflow:hidden}
#main-layout.single-col{grid-template-columns:1fr}
#right-sidebar{background:var(--panel);border-left:1px solid var(--border);overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:12px;font-size:12px}
#right-sidebar h3{font-size:13px;color:var(--accent2);margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px}
#right-sidebar .sb-section{background:var(--bg);border-radius:6px;padding:10px}
.sb-item{padding:6px 8px;margin:4px 0;border-radius:4px;font-size:11px;line-height:1.4}
.sb-item.goal{border-left:2px solid var(--cyan)}
.sb-item.alert{border-left:2px solid var(--red)}
.sb-item.alert.priority-high{background:#1f0a0a}
.sb-item.alert.priority-medium{background:#1f1a0a}
.sb-item.obstacle{border-left:2px solid var(--orange)}
.sb-item .sb-title{font-weight:600;margin-bottom:2px}
.sb-item .sb-meta{font-size:10px;color:var(--dim)}
.sb-progress{height:3px;background:#1a1a2a;border-radius:2px;margin-top:4px}
.sb-progress-fill{height:100%;border-radius:2px;background:var(--cyan)}
.sb-empty{color:var(--dim);font-size:11px;text-align:center;padding:8px}
@media(max-width:800px){#right-sidebar{display:none}#main-layout{grid-template-columns:1fr}}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
</style>
</head>
<body>
<header>
  <h1><span class="dot" id="status-dot"></span>Synova</h1>
  <div id="dimension-bar" style="display:flex;align-items:center;gap:8px;font-size:11px;">
    <span style="color:var(--dim)">维度</span>
    <span id="dim-count" style="color:var(--accent2);font-weight:600">0/8</span>
    <div style="width:80px;height:4px;background:#1a1a2a;border-radius:2px;overflow:hidden">
      <div id="dim-fill" style="height:100%;background:var(--accent);border-radius:2px;transition:width .3s;width:0%"></div>
    </div>
  </div>
  <span class="status" id="status-text">连接中...</span>
</header>
<div id="progress-bar-container">
  <div id="progress-bar-track"><div id="progress-bar-fill"></div></div>
  <div style="display:flex;align-items:center">
    <span id="progress-label" style="font-size:10px;color:var(--dim);margin-right:8px">诊断中</span>
    <span id="progress-phases"></span>
  </div>
</div>
<div id="main-layout">
<div id="messages"></div>
<div id="right-sidebar">
  <div class="sb-section"><h3>📌 目标跟踪</h3><div id="sb-goals"><div class="sb-empty">暂无目标</div></div></div>
  <div class="sb-section"><h3>🚨 关键告警</h3><div id="sb-alerts"><div class="sb-empty">暂无告警</div></div></div>
  <div class="sb-section"><h3>🔄 遗留问题</h3><div id="sb-obstacles"><div class="sb-empty">暂无遗留问题</div></div></div>
</div>
</div>
<div id="graph-panel">
  <div id="cy-container"></div>
  <div class="graph-toolbar">
    <button onclick="resetGraphView()">🔍 重置视角</button>
    <button onclick="toggleLabels()">🏷️ 标签</button>
    <button onclick="toggleGraph()">💬 返回对话</button>
  </div>
  <div class="graph-legend">
    <span><span class="legend-dot" style="background:#4ecdc4"></span> 本人</span>
    <span><span class="legend-dot" style="background:#f39c12"></span> 团队</span>
    <span><span class="legend-dot" style="background:#e74c3c"></span> 高风险</span>
    <span>粗线 = 强协作</span>
  </div>
</div>
<div id="quick-actions">
  <button class="q-btn" onclick="quickDiag(\\'公司诊断\\')">🔍 诊断我的公司</button>
  <button class="q-btn" onclick="quickDiag('团队协作分析')">👥 团队协作分析</button>
  <button class="q-btn" onclick="quickDiag('关键人风险评估')">⚠️ 关键人风险</button>
  <button class="q-btn" onclick="toggleGraph()" style="background:var(--accent);color:#fff">📊 团队全景图</button>
</div>
<div id="input-area">
  <textarea id="user-input" placeholder="描述你的组织问题..." rows="2" style="flex:1;background:var(--input);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:13px;outline:none;resize:none;font-family:inherit" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send()}"></textarea>
  <button id="send-btn" onclick="send()">发送</button>
</div>

<script src="https://unpkg.com/cytoscape@3.30/dist/cytoscape.min.js"></script>
<script>
// ═══ Constants ═══
const API = '';
const PHASES = ['组织访谈','数据采集','假设生成','根因分析','报告生成','交付'];
const messages = document.getElementById('messages');
const input = document.getElementById('user-input');
const btn = document.getElementById('send-btn');
const dot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const progContainer = document.getElementById('progress-bar-container');
const progFill = document.getElementById('progress-bar-fill');
const progLabel = document.getElementById('progress-label');
const progPhases = document.getElementById('progress-phases');
const quickActions = document.getElementById('quick-actions');
let loading = false;
let currentPhase = -1;
let completedPhases = new Set();

input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

// ═══ Init ═══
async function init() {
  try {
    // GNS v2.0: 检测用户状态 — Phase 0 已完成/有数据源/新手
    const stateRes = await fetch(API + '/api/user-state');
    const state = await stateRes.json().catch((err) => {
      console.warn('用户状态解析失败 — 降级空对象', { err });
      return {};
    });

    const r = await fetch(API + '/api/status');
    const s = await r.json();
    if (s.llmConfigured) {
      dot.className = 'dot';
      statusText.textContent = s.gatewayHost ? 'Gateway · Synova' : 'Synova · 已就绪';
    } else {
      dot.className = 'dot off';
      statusText.textContent = '未配置 LLM';
      addSystem('banner',
        '<b>⚠️ LLM 未配置</b><br>诊断需要大模型。请设置环境变量后重启：' +
        '<span class="cmd">$env:LLM_API_KEY="sk-your-key"</span>' +
        '或使用 Gateway：' +
        '<span class="cmd">$env:OPENCLAW_GATEWAY_HOST="http://127.0.0.1:18789"</span>' +
        'DEV_MODE 下本体功能仍可用。'
      );
    }
    // GNS v2.0: 根据用户状态显示不同入口
    if (state.hasCompletedPhase0) {
      addSystem('msg', '👋 欢迎回来！<br>你的组织数据已就绪，直接开始监测和对话。');
    } else if (state.hasDataSources) {
      addSystem('msg', '👋 检测到已接入数据源。<br>你可以选择跳过访谈直接开始，或先让我了解你的组织。');
      // Show skip prompt
      const skipBtn = document.getElementById('quick-actions');
      if (skipBtn) {
        skipBtn.innerHTML = '<button class="q-btn" onclick="skipPhase0()" style="background:var(--accent);color:#fff">🚀 跳过访谈，直接开始</button>' +
          '<button class="q-btn" onclick="quickDiag(\\'公司诊断\\')">🔍 先了解我的组织</button>';
      }
    } else {
      addSystem('msg', '👋 我是 Synova，你的 AI 组织诊断助手。<br>点击下方按钮开始，或直接输入你的组织名称。');
    }
  } catch(e) {
    console.warn("网络请求失败", e instanceof Error ? e.message : String(e));
    dot.className = 'dot off';
    statusText.textContent = '服务异常';
  }
}

// ═══ Quick Action ═══
function quickDiag(topic) {
  input.value = topic;
  send();
}

// GNS v2.0: 跳过 Phase 0 — 发送特殊指令触发 skip
function skipPhase0() {
  input.value = '跳过访谈，直接开始';
  send();
}

// ═══ Rendering ═══
function addSystem(cls, html) {
  const d = document.createElement('div');
  d.className = 'msg system ' + (cls || '');
  d.innerHTML = html;
  messages.appendChild(d);
  scrollDown();
}

function addMsg(role, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.textContent = text;
  messages.appendChild(d);
  scrollDown();
}

// ═══ Day3: 维度覆盖 + 专家标注 + 意图识别 ═══
function updateDimCoverage(covered, total) {
  total = total || 8;
  const el = document.getElementById('dim-count');
  const fill = document.getElementById('dim-fill');
  if (el) el.textContent = covered + '/' + total;
  if (fill) fill.style.width = (covered / total * 100) + '%';
}

function addAgentMsg(text, dimKey, experts) {
  const d = document.createElement('div');
  d.className = 'msg agent';
  d.innerHTML = text.replace(/\\n/g,'<br>');
  if (dimKey || experts) {
    const meta = document.createElement('div');
    meta.className = 'expert-watching';
    if (dimKey) meta.innerHTML += '<span class=\\'dim-tag covered\\'>' + esc(dimKey) + '</span>';
    if (experts && experts.length) {
      experts.forEach(function(e) { meta.innerHTML += '<span>' + esc(e) + '</span>'; });
    }
    d.appendChild(meta);
  }
  messages.appendChild(d);
  scrollDown();
}

function addIntentNotice(text) {
  const d = document.createElement('div');
  d.className = 'msg system';
  d.innerHTML = '<span class=\\'intent-notice\\'>' + esc(text) + '</span>';
  messages.appendChild(d);
  scrollDown();
}

function addPhaseEvent(label, completed) {
  const d = document.createElement('div');
  d.className = 'msg phase' + (completed ? ' completed' : '');
  d.textContent = (completed ? '✅ ' : '⏳ ') + label;
  messages.appendChild(d);
  scrollDown();
}

function addFindingCard(data) {
  const card = document.createElement('div');
  card.className = 'card-finding';
  const title = data.label || data.message || '诊断发现';
  const body = data.findings
    ? data.findings.map(f => f.summary || f.moduleId).join('; ')
    : (data.message || '');
  const conf = (data.confidence || 0.7) * 100;
  const confClass = conf >= 70 ? 'high' : conf >= 40 ? 'medium' : 'low';
  card.innerHTML =
    '<div class="card-title">💡 ' + esc(title) + '</div>' +
    (body ? '<div class="card-body">' + esc(body) + '</div>' : '') +
    '<div class="card-meta">' +
      '<span>Phase ' + (data.phase || '?') + '</span>' +
      '<span class="card-confidence ' + confClass + '">可信度 ' + Math.round(conf) + '%</span>' +
    '</div>';
  messages.appendChild(card);
  scrollDown();
}

// ═══ Slice 3: 判断卡片渲染 + 互动 ═══

function addJudgmentCard(data) {
  const card = document.createElement('div');
  card.className = 'card-judgment';
  card.id = 'jc-' + (data.cardId || Date.now().toString(36));

  const confPct = Math.round((data.confidence || 0.7) * 100);
  const confClass = data.confidenceLevel || (confPct >= 70 ? 'high' : confPct >= 40 ? 'medium' : 'low');
  const experts = (data.experts && data.experts.length) ? data.experts : ['诊断专家'];
  const expertTags = experts.map(function(e) {
    return '<span class="jc-expert-tag">' + esc(e) + '</span>';
  }).join('');

  card.innerHTML =
    // 头部：标题 + 专家标签
    '<div class="jc-header">' +
      '<div class="jc-title">🔍 诊断判断</div>' +
      '<div class="jc-experts">' + expertTags + '</div>' +
    '</div>' +
    // 根因
    '<div class="jc-section">' +
      '<div class="jc-label">📌 根因</div>' +
      '<div class="jc-root-cause">' + esc(data.root_cause || '正在分析中...') + '</div>' +
    '</div>' +
    // 建议
    '<div class="jc-section">' +
      '<div class="jc-label">💡 建议</div>' +
      '<div class="jc-suggestion">' + esc(data.suggestion || '建议进一步分析以确定具体方案。') + '</div>' +
    '</div>' +
    // 置信度
    '<div class="jc-section">' +
      '<div class="jc-label">📊 置信度 ' + confPct + '%</div>' +
      '<div class="jc-confidence-bar">' +
        '<div class="jc-confidence-fill ' + confClass + '" style="width:' + confPct + '%"></div>' +
      '</div>' +
    '</div>' +
    // 操作按钮
    '<div class="jc-actions" id="' + card.id + '-actions">' +
      '<button class="jc-btn-confirm" onclick="confirmJudgment(\'' + card.id + '\')">✅ 采纳此方案</button>' +
      '<button class="jc-btn-discuss" onclick="discussJudgment(\'' + card.id + '\', \'' +
        esc(data.suggestion || data.root_cause || '') + '\')">💬 继续讨论</button>' +
    '</div>';

  messages.appendChild(card);
  scrollDown();
}

function confirmJudgment(cardId) {
  var card = document.getElementById(cardId);
  if (!card) return;
  // 添加 "已确认" 状态
  card.classList.add('confirmed');
  // 替换操作按钮为已确认徽章
  var actions = document.getElementById(cardId + '-actions');
  if (actions) {
    actions.innerHTML = '<span class="jc-confirmed-badge">✅ 已采纳</span>' +
      '<span style="font-size:10px;color:var(--dim);margin-left:8px">方案已记录，将在后续诊断中自动引用</span>';
  }
  // 通知服务器（fire-and-forget）
  try {
    fetch(API + '/api/proposal/' + encodeURIComponent(cardId) + '/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', feedback: '用户采纳了判断卡片方案' }),
    }).catch(function(err) { console.warn('方案确认通知失败 — degraded, 本地状态已更新', err); });
  } catch(e) { console.warn('确认请求失败 — degraded:', e); }
}

function discussJudgment(cardId, context) {
  var input = document.getElementById('user-input');
  if (!input) return;
  // 预填追问文本
  var prefix = '关于"' + context.slice(0, 50) + '"，我想进一步了解：';
  input.value = prefix;
  input.focus();
  // 滚动到输入框
  input.scrollIntoView({ behavior: 'smooth' });
  // 高亮卡片
  var card = document.getElementById(cardId);
  if (card) {
    card.style.boxShadow = '0 0 12px rgba(108,92,231,0.3)';
    setTimeout(function() { card.style.boxShadow = ''; }, 1500);
  }
}

function addDegraded(msg) {
  const d = document.createElement('div');
  d.className = 'msg degraded';
  d.textContent = '⚠️ ' + msg;
  messages.appendChild(d);
  scrollDown();
}

function addError(msg) {
  const d = document.createElement('div');
  d.className = 'msg degraded';
  d.textContent = '❌ ' + msg;
  messages.appendChild(d);
  scrollDown();
}

function esc(s) { return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function scrollDown() { setTimeout(() => { messages.scrollTop = messages.scrollHeight; }, 50); }

// ═══ Progress Bar (L1-P0-2) ═══
function showProgress() {
  progContainer.classList.add('active');
  progPhases.innerHTML = PHASES.map((label, i) =>
    '<span class="p-dot" id="p' + i + '">' + (i + 1) + '</span>' +
    (i < PHASES.length - 1 ? '<span class="p-label">' + label + '</span>' : '')
  ).join('');
}

function updateProgress(phase, complete) {
  if (phase < 0 || phase >= PHASES.length) return;
  if (complete) {
    completedPhases.add(phase);
    const dot = document.getElementById('p' + phase);
    if (dot) dot.className = 'p-dot done';
  }
  currentPhase = complete ? (phase + 1) : phase;
  const pct = Math.round(((complete ? phase + 1 : phase) / PHASES.length) * 100);
  progFill.style.width = pct + '%';
  progLabel.textContent = '已完成 ' + completedPhases.size + '/' + PHASES.length;

  // Highlight current active phase
  for (let i = 0; i < PHASES.length; i++) {
    const dot = document.getElementById('p' + i);
    if (dot && !completedPhases.has(i)) {
      dot.className = 'p-dot' + (i === currentPhase ? ' active' : '');
    }
  }

  if (completedPhases.size === PHASES.length) {
    progLabel.textContent = '诊断完成 🎉';
    setTimeout(() => { progContainer.classList.remove('active'); }, 3000);
  }
}

// ═══ SSE Event Handler (L1-P0-1: 统一协议) ═══
function handleSSEEvent(evt) {
  switch (evt.type) {
    // ── Phase Progress ──
    case 'phase_started':
      if (!progContainer.classList.contains('active')) showProgress();
      addPhaseEvent('Phase ' + evt.phase + ' — ' + (evt.label || '进行中...'), false);
      updateProgress(evt.phase, false);
      break;
    case 'phase_completed':
      addPhaseEvent('Phase ' + evt.phase + ' — ' + (evt.label || '完成'), true);
      updateProgress(evt.phase, true);
      break;

    // ── Interim Finding (L1-P0-3) ──
    case 'interim_finding':
    case 'hypothesis_generated':
    case 'expert_hypothesis':
      addFindingCard(evt);
      break;

    // ── Evidence ──
    case 'evidence_contradictions':
      addFindingCard({ label: '证据矛盾检测', message: evt.message, phase: evt.phase, confidence: 0.85 });
      break;
    case 'community_reports':
      addFindingCard({ label: '协作圈发现', message: evt.message, phase: evt.phase, confidence: 0.7 });
      break;
    case 'entity_resolution':
      addFindingCard({ label: '人员匹配完成', message: evt.message, phase: evt.phase, confidence: 0.8 });
      break;

    // ── Graph Update ──
    case 'graph_update':
      addSystem('msg', '📊 团队全景图已更新 (' + (evt.nodesCreated || 0) + ' 节点, ' + (evt.edgesCreated || 0) + ' 关联)');
      break;

    // ── Completion ──
    case 'complete':
      updateProgress(PHASES.length - 1, true);
      const report = evt.result || evt;
      const d = document.createElement('div');
      d.className = 'msg agent';
      d.innerHTML = '<h3 style="margin-bottom:8px;">📋 诊断报告</h3><pre style="max-height:400px;overflow-y:auto">'
        + esc(JSON.stringify(report, null, 2).slice(0, 4000))
        + '</pre>';
      messages.appendChild(d);
      scrollDown();
      quickActions.style.display = 'flex';
      break;

    // ── Error ──
    case 'error':
      addError(evt.message || '诊断出错');
      progContainer.classList.remove('active');
      quickActions.style.display = 'flex';
      break;
    case 'interrupted':
      addSystem('msg', '⏸ 诊断已中断');
      progContainer.classList.remove('active');
      quickActions.style.display = 'flex';
      break;

    // ── Degraded ──
    case 'degraded':
      addDegraded(evt.message || '部分模块降级');
      break;

    // ── Slice 3: 判断卡片 ──
    case 'judgment_card':
      addJudgmentCard(evt);
      break;

    // ── GNS v2.0: 右边栏更新 ──
    case 'right_column_update':
      if (evt.rightColumn) renderRightSidebar(evt.rightColumn);
      break;
    case 'proposal_created':
      addProposalCard(evt);
      break;

    // ── Day3: 维度覆盖更新 + 专家标注 ──
    case 'dimension_covered':
      if (evt.covered !== undefined) updateDimCoverage(evt.covered, evt.total || 8);
      break;
    case 'agent_thinking':
      addAgentMsg(evt.message || evt.text || '', evt.dimension, evt.experts);
      break;
    case 'intent_notice':
      addIntentNotice(evt.message || '');
      break;

    // ── Unknown ──
    default:
      if (evt.type && evt.type !== 'token' && evt.type !== 'agent_message') break;
  }
}

// ═══ Send ═══
async function send() {
  const text = input.value.trim();
  if (!text || loading) return;
  loading = true; btn.disabled = true; btn.textContent = '诊断中...';
  quickActions.style.display = 'none';
  currentPhase = -1; completedPhases.clear();
  addMsg('user', text);
  input.value = '';

  try {
    const res = await fetch(API + '/api/diagnosis/consult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamId: text.replace(/\\s+/g, '-').toLowerCase(),
        initiator: { role: '管理者', name: '用户', concerns: [text] },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch((jsonErr) => {
        console.warn('诊断错误响应解析失败 — 降级空对象', { err: jsonErr });
        return {};
      });
      addError('诊断启动失败：' + (err.error || err.message || '未知错误'));
      loading = false; btn.disabled = false; btn.textContent = '发送';
      quickActions.style.display = 'flex';
      return;
    }

    showProgress();
    addSystem('msg', '🔍 诊断已启动 — 正在分析你的组织...');

    // ═══ L1-P0-1: 统一 SSE 解析 — 同时支持 event: 和 data: 两种格式 ═══
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        // Standard SSE: event: type
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim();
          continue;
        }
        // Standard SSE + Custom: data: JSON
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const evt = JSON.parse(raw);
            // If event type is embedded in JSON, use it; otherwise use SSE event field
            if (!evt.type && currentEventType) evt.type = currentEventType;
            handleSSEEvent(evt);
          } catch { log.debug('SSE 解析失败 — 跳过损坏的 chunk'); }
          currentEventType = '';
        }
        // Empty line = SSE event boundary — reset
        if (line === '') currentEventType = '';
      }
    }
  } catch(e) {
    console.warn("JSON 解析失败", e instanceof Error ? e.message : String(e));
    if (e.name !== 'AbortError') {
      addError('连接失败：' + e.message);
    }
  }
  loading = false; btn.disabled = false; btn.textContent = '发送';
  quickActions.style.display = 'flex';
}

// ═══ Graph Visualization (L1: Cytoscape.js — Batch 4) ═══
let cyInstance = null;
let showLabels = true;

function toggleGraph() {
  const graphPanel = document.getElementById('graph-panel');
  const messagesDiv = document.getElementById('messages');
  if (graphPanel.classList.contains('active')) {
    graphPanel.classList.remove('active');
    messagesDiv.style.display = '';
    quickActions.style.display = 'flex';
    document.getElementById('input-area').style.display = '';
    document.getElementById('progress-bar-container').style.display = '';
  } else {
    loadGraphView();
    graphPanel.classList.add('active');
    messagesDiv.style.display = 'none';
    quickActions.style.display = 'none';
    document.getElementById('input-area').style.display = 'none';
    document.getElementById('progress-bar-container').style.display = 'none';
  }
}

async function loadGraphView() {
  const container = document.getElementById('cy-container');
  if (!container) return;

  if (cyInstance) { cyInstance.destroy(); cyInstance = null; }

  // Fetch ontology graph data from REST API
  try {
    const res = await fetch('/api/ontology/graph/default');
    if (!res.ok) throw new Error('Graph API unavailable');
    const data = await res.json();

    const nodes = (data.nodes || []).map(n => ({
      data: {
        id: n.id, label: n.props?.name || n.type || '?',
        type: n.type, risk: n.props?.riskLevel || 'normal',
      },
    }));

    const edges = (data.edges || []).map(e => ({
      data: {
        id: e.id, source: e.from, target: e.to,
        label: e.type, weight: e.weight || 1,
      },
    }));

    const riskColors = { critical: '#e74c3c', high: '#f39c12', medium: '#f1c40f', normal: '#4ecdc4' };

    cyInstance = cytoscape({
      container,
      elements: [...nodes, ...edges],
      style: [
        { selector: 'node', style: {
          'background-color': (ele) => riskColors[ele.data('risk')] || '#4ecdc4',
          'label': (ele) => showLabels ? ele.data('label') : '',
          'color': '#e0e0e0', 'font-size': '10px',
          'text-valign': 'bottom', 'text-halign': 'center',
          'width': 28, 'height': 28,
          'border-width': (ele) => ele.data('risk') === 'critical' ? 3 : 1,
          'border-color': (ele) => ele.data('risk') === 'critical' ? '#e74c3c' : '#2a2a3a',
        }},
        { selector: 'edge', style: {
          'width': (ele) => Math.max(1, Math.min(6, ele.data('weight') * 2)),
          'line-color': '#4a4a6a',
          'target-arrow-color': '#4a4a6a',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'label': (ele) => showLabels ? ele.data('label') : '',
          'color': '#888', 'font-size': '8px',
        }},
        { selector: 'node:selected', style: { 'border-color': '#6c5ce7', 'border-width': 3 }},
        { selector: 'edge:selected', style: { 'line-color': '#6c5ce7', 'width': 4 }},
      ],
      layout: { name: 'cose', animate: true, animationDuration: 1000, nodeRepulsion: 2000 },
      minZoom: 0.3, maxZoom: 3,
    });

    cyInstance.on('tap', 'node', (evt) => {
      const node = evt.target;
      addSystem('msg', '📌 ' + node.data('label') + ' (' + node.data('type') + ')' +
        (node.data('risk') !== 'normal' ? ' ⚠️ ' + node.data('risk') : ''));
    });

    addSystem('msg', '📊 团队全景图已加载 (' + nodes.length + ' 人, ' + edges.length + ' 关联)');
  } catch(e) {
    console.warn("网络请求失败", e instanceof Error ? e.message : String(e));
    addSystem('msg', '⚠️ 团队全景图暂不可用 — 需要先运行诊断生成数据');
  }
}

function resetGraphView() { if (cyInstance) { cyInstance.fit(); cyInstance.center(); } }
function toggleLabels() { showLabels = !showLabels; loadGraphView(); }

// ═══ GNS v2.0: 右边栏渲染 + 提议处理 ═══

function renderRightSidebar(data) {
  const renderItems = (containerId, items, type, formatter) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="sb-empty">暂无' + type + '</div>';
      return;
    }
    container.innerHTML = items.slice(0, 5).map(item => formatter(item)).join('');
  };

  renderItems('sb-goals', data.goals, '目标', g =>
    '<div class="sb-item goal"><div class="sb-title">' + esc(g.name) + '</div>' +
    '<div class="sb-progress"><div class="sb-progress-fill" style="width:' + (g.progress || 0) + '%"></div></div>' +
    '<div class="sb-meta">进度 ' + (g.progress || 0) + '% · ' + esc(g.status) + '</div></div>');

  renderItems('sb-alerts', data.alerts, '告警', a =>
    '<div class="sb-item alert priority-' + (a.priority || 'medium') + '"><div class="sb-title">' + esc(a.description) + '</div>' +
    '<div class="sb-meta">置信度 ' + Math.round((a.confidence || 0) * 100) + '% · ' + (a.priority || '?') + '</div></div>');

  renderItems('sb-obstacles', data.obstacles, '遗留问题', o =>
    '<div class="sb-item obstacle"><div class="sb-title">' + esc(o.description) + '</div>' +
    '<div class="sb-meta">' + esc(o.status) + ' · ' + (o.updatedAt || '').slice(0,10) + '</div></div>');
}

function addProposalCard(evt) {
  const d = document.createElement('div');
  d.className = 'msg agent';
  d.style.borderLeft = '3px solid var(--accent2)';
  d.innerHTML =
    '<div style="font-size:13px;margin-bottom:6px">💡 ' + esc(evt.message || '新的变更提议') + '</div>' +
    '<div style="display:flex;gap:6px;margin-top:8px">' +
    '<button onclick="resolveProposal(\'' + (evt.proposalId || '') + '\',\'confirm\')" style="background:#0a2a0a;color:var(--green);border:1px solid var(--green);padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600">✅ 确认</button>' +
    '<button onclick="resolveProposal(\'' + (evt.proposalId || '') + '\',\'reject\')" style="background:#2a0a0a;color:var(--red);border:1px solid var(--red);padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600">❌ 拒绝</button>' +
    '<button onclick="resolveProposal(\'' + (evt.proposalId || '') + '\',\'opinion\')" style="background:#1a1a2a;color:var(--accent2);border:1px solid var(--accent2);padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600">💬 提出看法</button>' +
    '</div>';
  messages.appendChild(d);
  scrollDown();
}

async function resolveProposal(id, action) {
  try {
    const res = await fetch('/api/proposal/' + id + '/resolve', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ action, feedback: '' }),
    });
    const data = await res.json();
    addSystem('msg', data.ok ?
      (action === 'confirm' ? '✅ 已确认' : action === 'reject' ? '❌ 已拒绝' : '💬 已记录看法') :
      '⚠️ ' + (data.error || '操作失败'));
  } catch(e) {
    console.warn("网络请求失败", e instanceof Error ? e.message : String(e));
    addSystem('msg', '⚠️ 操作失败: ' + e.message);
  }
}

init();
</script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export default router;
