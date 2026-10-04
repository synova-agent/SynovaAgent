/**
 * department-workspace.ts — 部门独立工作区 (PRD v1.6 Slice 7)
 * GET /dept → 部门总监视角的独立工作区列表 + 对话
 *
 * @deprecated — D74 工作台数据 API (routes/workspace-data.ts) 已替代此路由。
 *   旧代码保留不动，D77b 时统一删除。不修改此文件。
 *
 * D947（默认安全姿态）— 本文件唯一的例外改动（CTO 裁定 R6「只删自报头 + 行内注明」）:
 *   删除从 `x-synova-token` 头 / `query.token` 派生部门名的自报身份读取。
 *   理由: 未验签的自报串不经验签即可自封部门身份（默认放行姿态）。
 *   注: 本文件头「不修改此文件」的自述与 D947 写集的冲突，已由 CTO R6 裁定覆盖（L-10）。
 *   功能下线（含本页身份通道整体退役）**另立卡**，不在本卡处理。
 */
import { Router, type Request, type Response } from 'express';

const router = Router();

router.get('/dept', (_req: Request, res: Response) => {
  // D947 R6: 原自报身份读取已删除（不得从 x-synova-token / query.token 派生部门）。
  //   删除前: const token = String(_req.headers['x-synova-token'] || _req.query.token || '');
  //           const d = token.includes(':') ? token.split(':')[1] : '';
  //           const dept = d || 'dept';
  //   删除后: 仅保留常量兜底（JWT 载荷无部门字段，见 R5 / REV-8 已登记功能回退）。
  const dept = 'dept';

  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Synova · ${dept}部工作台</title>
<style>
:root{--bg:#0f0f14;--panel:#1a1a24;--border:#2a2a3a;--text:#e0e0e0;--dim:#888;--accent:#6c5ce7;--accent2:#a29bfe;--red:#e74c3c;--green:#2ecc71;--orange:#f39c12}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;overflow:hidden}
.sidebar{width:200px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0}
.sidebar-header{padding:16px;border-bottom:1px solid var(--border);font-size:13px;font-weight:600;color:var(--accent2)}
.sidebar-header .dept{font-size:11px;color:var(--dim)}
.workspace-list{flex:1;overflow-y:auto;padding:8px}
.ws-item{padding:12px;border-radius:8px;cursor:pointer;margin-bottom:4px;font-size:13px;display:flex;align-items:center;gap:8px}
.ws-item:hover{background:rgba(255,255,255,.04)}
.ws-item.active{background:rgba(108,92,231,.15);border:1px solid var(--accent)}
.ws-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.ws-dot.critical{background:var(--red)}.ws-dot.warning{background:var(--orange)}.ws-dot.ok{background:var(--green)}
.source-tag{font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px}
.source-tag.assigned{background:rgba(108,92,231,.2);color:var(--accent2)}
.source-tag.own{background:rgba(255,255,255,.06);color:var(--dim)}
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.main-header{padding:12px 20px;border-bottom:1px solid var(--border);font-size:14px;font-weight:600}
.chat-area{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:85%;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.6}
.msg.agent{align-self:flex-start;background:var(--panel);border:1px solid var(--border)}
.msg.user{align-self:flex-end;background:var(--accent);color:#fff}
.msg.context{align-self:flex-start;background:#0d1a1a;border:1px solid #1a3a3a;border-left:3px solid var(--accent2);font-size:12px}
.input-area{padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:10px}
.input-area textarea{flex:1;background:#12121a;border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:13px;resize:none;font-family:inherit;outline:none}
.input-area button{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:10px 20px;cursor:pointer;font-size:13px;font-weight:600}
.right-panel{width:240px;background:var(--panel);border-left:1px solid var(--border);padding:16px;overflow-y:auto;flex-shrink:0}
.right-panel h3{font-size:13px;color:var(--dim);margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em}
.goal-card{background:#0d0d18;border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px;font-size:12px}
.btn-new{width:100%;background:rgba(108,92,231,.2);color:var(--accent2);border:1px solid var(--accent);border-radius:8px;padding:8px;font-size:12px;cursor:pointer;margin-bottom:12px}
</style>
</head>
<body>
<div class="sidebar">
  <div class="sidebar-header">${dept}部 <span class="dept">工作台</span></div>
  <div style="padding:8px"><button class="btn-new" onclick="newWorkspace()">+ 新建工作区</button></div>
  <div class="workspace-list" id="ws-list"><div style="padding:20px;color:var(--dim);font-size:12px;text-align:center">加载中...</div></div>
</div>
<div class="main">
  <div class="main-header" id="main-title">选择或创建一个工作区</div>
  <div class="chat-area" id="messages"></div>
  <div class="input-area">
    <textarea id="user-input" placeholder="讨论..." rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMsg()}"></textarea>
    <button onclick="sendMsg()">发送</button>
  </div>
</div>
<div class="right-panel" id="right-panel">
  <h3>部门数据</h3>
  <div style="color:var(--dim);font-size:12px">选择工作区后显示</div>
</div>
<script>
const API='';const DEPT='${dept}';let current=null;
async function loadWs(){
  // D947 R6: 原页内 fetch 自带的自报头（自封 manager 身份 + 拼接本页部门常量）已删除
  //   （删除前该 fetch 自报 manager 身份打自己后端的 API = 生产代码自欺）。
  //   删除后果：本页无身份通道 ⇒ /api/workspaces/mine 走 fail-closed；
  //   该行为变化**无测试守护**，属已登记未清项（L-11），功能下线另立卡。
  //   （注释措辞按 L-15 改写：不逐字复制 P7 判据的正则字面量，原文见 git 历史。）
  try{const r=await fetch(API+'/api/workspaces/mine');const d=await r.json();
    const el=document.getElementById('ws-list');
    if(!d.workspaces.length){el.innerHTML='<div style=padding:20px;color:var(--dim);font-size:12px;text-align:center>暂无工作区</div>';return}
    el.innerHTML=d.workspaces.map(w=>\`<div class="ws-item\${current===w.id?' active':''}" onclick="selectWs('\${w.id}','\${w.inheritedContext||''}')">
      <div class="ws-dot \${w.status==='pending'?'warning':w.status==='resolved'?'ok':'critical'}"></div>
      <div style="flex:1"><div>\${w.title} \${w.source==='boss_assigned'?'<span class=\\"source-tag assigned\\">老板分配</span>':w.source==='agent_suggested'?'<span class=\\"source-tag assigned\\">Agent建议</span>':'<span class=\\"source-tag own\\">自己创建</span>'}</div>
      <div style="font-size:10px;color:var(--dim)">\${w.status||'pending'}</div></div></div>\`).join('');
  }catch(e){
    console.warn("部门工作区 DOM 渲染", { err: e instanceof Error ? e.message : String(e) });
  }
}
async function selectWs(id,ctx){
  current=id;loadWs();
  document.getElementById('main-title').textContent='工作区 · '+id.slice(-6);
  const msgs=document.getElementById('messages');
  if(ctx){msgs.innerHTML='<div class="msg context">'+ctx+'</div>'}
  // v3.5 PRD §17: 动态加载工作区上下文数据
  try{const r=await fetch(API+'/api/workspaces/'+id+'/context');const d=await r.json();
    const sources=d.sources||['本部门数据', '竞品数据库', '客户调研报告'];
    document.getElementById('right-panel').innerHTML='<h3>可访问数据</h3>'+sources.map(s=>'<div class=goal-card>'+s+'</div>').join('');
  }catch(e){
    console.warn("工作区上下文加载失败", { err: e instanceof Error ? e.message : String(e) });
    document.getElementById('right-panel').innerHTML='<h3>可访问数据</h3><div class=goal-card>数据加载中...</div>';
  }
  msgs.scrollTop=msgs.scrollHeight;
}
async function newWorkspace(){
  const title=prompt('工作区名称')||'新工作区';
  try {
    const r=await fetch(API+'/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,type:'manual'})});await r.json();loadWs();
  } catch(e){
    console.warn('创建工作区失败 — degraded', { err: e instanceof Error ? e.message : String(e) });
  }
}
async function sendMsg(){
  const input=document.getElementById('user-input');const text=input.value.trim();if(!text||!current)return;
  document.getElementById('messages').innerHTML+='<div class="msg user">'+text+'</div>';
  input.value='';
  setTimeout(()=>{document.getElementById('messages').innerHTML+='<div class="msg agent">收到: '+text.slice(0,100)+'。分析中...</div>';document.getElementById('messages').scrollTop=document.getElementById('messages').scrollHeight},500);
}
loadWs();
</script>
</body>
</html>`);
});

export default router;
