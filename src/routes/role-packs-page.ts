/**
 * src/routes/role-packs-page.ts — 岗位说明书页（HTML 壳；#1075 P3）
 *
 * 架构位置: **L1 交互面**（`src/routes/`）。**只导出 Router，不挂载** ——
 *   挂载归 `src/server.ts`（T4），且**必须先于 `jwtAuthMiddleware`**（规格 §2.2-D7 / gate-A A2），
 *   否则无 token 客户端拿 401 ⇒ 页面不可达（J8 反例①）。
 *
 * 设计哲学（一句）: **壳与数据分离** —— 服务端只发一个**零数据的静态壳**，
 *   一切岗位数据由浏览器**用用户自己的 Bearer** 去 fetch 数据 API；
 *   于是"页面公开可载入"与"数据必须鉴权"不再冲突。
 *
 * 契约（铁律 47）:
 *   @input  — HTTP `GET /role-packs`、`GET /role-packs/:roleId`（**无认证**；不读 query/body/header）。
 *   @output — `200 text/html; charset=utf-8`，**静态常量模板**：服务端零插值、零岗位数据。
 *             必备锚点：`id="role-packs-app"`（数据挂载点）＋ `data-testid="token-gate"`（token 粘贴位）。
 *             客户端路径：换行页 = 列表；`/role-packs/<id>` = 详情；数据来源
 *             `GET /api/role-packs`、`GET /api/role-packs/<id>`（`Authorization: Bearer <token>`）。
 *   @degraded — 本文件**无 IO、无外部调用、无分支** ⇒ 无服务端降级路径（不是吞错：根本没有错误源）。
 *             客户端降级**显式可见**（铁律 11/31）：`sessionStorage` 不可用／HTTP 非 2xx／网络失败
 *             一律渲染成页面可见的提示文案，不静默。
 *   @authority — 只读页。**不写盘、不读盘、不触 DB、不调 audit**；写面全在 `/api/role-packs/:id/approval`。
 *   @not-here — 不做登录 UI（§10-L9：token 手工粘贴）｜不做审批动作（审批走写 API ＋ 审批会话卡）｜
 *             不做 SPA/前端框架（§1.3）｜**不内联任何岗位数据**（J8：HTML 里不得出现 roleId/六件/hash/状态）｜
 *             不做服务端 HTML 转义（**零插值 ⇒ 无转义面**；客户端一律 `textContent`，禁 innerHTML 拼数据）。
 *
 * typed error（HTTP 结果只有一种；本文件不产生业务码）:
 *   · 200 — 恒为 HTML 壳（两个路由都无前置校验，`:roleId` 不在此判存在性 ⇒ 数据层再判 404）。
 *   · 无 4xx/5xx — 本文件无会被触发到抛错的处理分支（发送失败由 express 默认错误处理接手）。
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · L4 · 无框架/无实时刷新：内联 HTML ＋ 原生 DOM；刷新才重取（规格 §10-L4）。
 *   · L9 · token 手工粘贴：无登录 UI、**不读 cookie/URL/localStorage**；
 *     Bearer 唯一来源 = `sessionStorage.getItem('synova.token')`（规格 §10-L9）。
 *     ⇒ 换标签页/关标签页即丢 token；生产接入需另做登录（本批非目标）。
 *   · L-page-1 · 详情渲染按 API 返回键**通用渲染**（不硬编码字段顺序）：六件文本/记录/审计历史
 *     以 `GET /api/role-packs/<id>` 的 JSON 为准；超限件由 API 标 `truncated`，页面原样展示标记。
 *   · L-page-2 · 无 CSP/无 SRI：内联脚本要求 `script-src 'unsafe-inline'`；本批不引入 CSP（§1.3 非目标）。
 *   · L-page-3 · 无访问日志：页面不记审计（页面本身无数据；数据访问由 API 侧审计）。
 */

import { Router, type Request, type Response } from 'express';

const router = Router();

/**
 * 静态壳（**服务端零插值**）。改此常量须同批复核 J8 三条：
 * ① 含 `role-packs-app`／`token-gate`；② 不含任何岗位数据；③ token 只从 sessionStorage 取。
 */
const ROLE_PACKS_SHELL = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Synova · 岗位说明书</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>📘</text></svg>">
<style>
:root{
  --bg:#0f0f14;--panel:#1a1a24;--border:#2a2a3a;--text:#e0e0e0;--dim:#888;
  --accent:#6c5ce7;--accent2:#a29bfe;--red:#e74c3c;--green:#2ecc71;--orange:#f39c12;--input:#12121a
}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:var(--bg);color:var(--text);margin:0;padding:24px}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}
header h1{font-size:17px;font-weight:600;margin:0}
header .sub{font-size:11px;color:var(--dim)}
.spacer{flex:1}
.btn{background:var(--accent);color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500}
.btn:hover{opacity:.85}
.btn-outline{background:transparent;border:1px solid var(--border);color:var(--text)}
.gate{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:20px;max-width:560px}
.gate h2{font-size:14px;margin:0 0 10px}
.gate p{font-size:12px;color:var(--dim);line-height:1.6;margin:0 0 12px}
.gate label{display:block;font-size:12px;margin-bottom:6px}
.gate input{width:100%;background:var(--input);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:8px 10px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.gate .row{display:flex;gap:8px;margin-top:10px}
a{color:var(--accent2);text-decoration:none}
.block{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px}
.block h2{font-size:13px;margin:0 0 8px;color:var(--accent2)}
.card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px}
.card h3{font-size:13px;margin:0 0 6px}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0;font-size:12px}
.kv dt{color:var(--dim)}
.kv dd{margin:0;word-break:break-word}
pre.text{white-space:pre-wrap;word-break:break-word;background:var(--input);border:1px solid var(--border);border-radius:4px;padding:10px;font-size:12px;margin:0;max-height:420px;overflow:auto}
.list{margin:0;padding-left:18px;font-size:12px}
.list li{margin:2px 0}
.dim{color:var(--dim);font-size:12px}
.notice{border-radius:4px;padding:8px 12px;font-size:12px;margin-bottom:12px;border:1px solid var(--border)}
.notice.warn{color:var(--orange);border-color:var(--orange)}
.notice.err{color:var(--red);border-color:var(--red)}
.badge{display:inline-block;font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--border);color:var(--dim)}
</style>
</head>
<body>
<header>
  <h1>岗位说明书</h1>
  <span class="sub">只读 · 数据由页面用你的 token 直接向 API 取</span>
  <span class="spacer"></span>
  <button id="reload-btn" class="btn btn-outline" type="button">重新加载</button>
  <button id="switch-token-btn" class="btn btn-outline" type="button">更换 token</button>
</header>

<div id="notice-slot"></div>

<section class="gate" data-testid="token-gate">
  <h2>需要访问 token</h2>
  <p>本页只提供界面，不内嵌任何岗位数据。粘贴访问 token 后，页面用它调用数据 API；token 只保存在本标签页的 sessionStorage（键 <code>synova.token</code>），不写入 URL、cookie 或 localStorage。</p>
  <label for="token-input">访问 token</label>
  <input id="token-input" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴 token 后回车">
  <div class="row">
    <button id="token-save" class="btn" type="button">保存并加载</button>
  </div>
</section>

<div id="role-packs-app"></div>

<script>
(function () {
  'use strict';

  var app = document.getElementById('role-packs-app');
  var gate = document.querySelector('[data-testid="token-gate"]');
  var input = document.getElementById('token-input');
  var saveBtn = document.getElementById('token-save');
  var reloadBtn = document.getElementById('reload-btn');
  var switchBtn = document.getElementById('switch-token-btn');
  var noticeSlot = document.getElementById('notice-slot');

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  function notice(kind, message) {
    clear(noticeSlot);
    noticeSlot.appendChild(el('div', 'notice ' + kind, message));
  }

  function readToken() {
    try {
      // 🔴 token 唯一来源（规格 J8／§10-L9）：sessionStorage 的 'synova.token'，不读 cookie/URL/localStorage
      return sessionStorage.getItem('synova.token') || '';
    } catch (err) {
      notice('warn', '浏览器禁用了 sessionStorage，无法读取 token（' + String(err) + '）。请在本页直接粘贴 token 后重试，或检查隐私模式设置。');
      return '';
    }
  }

  function writeToken(value) {
    try {
      if (value) { sessionStorage.setItem('synova.token', value); } else { sessionStorage.removeItem('synova.token'); }
      return true;
    } catch (err) {
      notice('warn', '浏览器禁用了 sessionStorage，token 未能保存（' + String(err) + '）。本次可用，刷新后需重新粘贴。');
      return false;
    }
  }

  function currentRoleId() {
    var path = window.location.pathname.replace(/\\/+$/, '');
    var matched = /^\\/role-packs\\/([^/]+)$/.exec(path);
    if (!matched) { return ''; }
    try {
      return decodeURIComponent(matched[1]);
    } catch (err) {
      notice('warn', 'URL 中的岗位 id 不是合法编码，按原样使用（' + String(err) + '）。');
      return matched[1];
    }
  }

  function apiGet(path, token) {
    return fetch(path, {
      method: 'GET',
      credentials: 'omit',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    }).then(function (res) {
      return res.text().then(function (raw) {
        var body = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch (err) {
          body = null;
        }
        return { status: res.status, ok: res.ok, body: body, raw: raw };
      });
    });
  }

  function renderValue(value) {
    if (value === null || value === undefined) { return el('p', 'dim', '—'); }
    var type = typeof value;
    if (type === 'string') {
      var pre = el('pre', 'text');
      pre.textContent = value;
      return pre;
    }
    if (type === 'number' || type === 'boolean') { return el('p', 'dim', String(value)); }
    if (Array.isArray(value)) {
      var list = el('ul', 'list');
      for (var i = 0; i < value.length; i += 1) {
        var li = el('li');
        li.appendChild(renderValue(value[i]));
        list.appendChild(li);
      }
      return list;
    }
    var kv = el('dl', 'kv');
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k += 1) {
      kv.appendChild(el('dt', '', keys[k]));
      var dd = el('dd');
      dd.appendChild(renderValue(value[keys[k]]));
      kv.appendChild(dd);
    }
    return kv;
  }

  function renderBlock(title, value) {
    var block = el('section', 'block');
    block.appendChild(el('h2', '', title));
    block.appendChild(renderValue(value));
    return block;
  }

  function findList(payload) {
    if (Array.isArray(payload)) { return payload; }
    if (payload && typeof payload === 'object') {
      var candidates = ['rolePacks', 'packs', 'roles', 'items', 'list', 'data'];
      for (var i = 0; i < candidates.length; i += 1) {
        if (Array.isArray(payload[candidates[i]])) { return payload[candidates[i]]; }
      }
    }
    return null;
  }

  function renderPackCard(pack) {
    var card = el('article', 'card');
    var heading = el('h3');
    if (pack && typeof pack === 'object' && typeof pack.roleId === 'string') {
      var link = el('a', '', pack.roleId);
      link.href = '/role-packs/' + encodeURIComponent(pack.roleId);
      heading.appendChild(link);
    } else {
      heading.textContent = '(无法识别的岗位条目)';
    }
    card.appendChild(heading);
    card.appendChild(renderValue(pack));
    return card;
  }

  function renderList(payload) {
    clear(app);
    var packs = findList(payload);
    if (!packs) {
      app.appendChild(renderBlock('返回内容', payload));
      return;
    }
    if (packs.length === 0) {
      app.appendChild(el('p', 'dim', '当前没有任何岗位包。'));
      return;
    }
    for (var i = 0; i < packs.length; i += 1) {
      app.appendChild(renderPackCard(packs[i]));
    }
  }

  function renderDetail(payload, roleId) {
    clear(app);
    app.appendChild(renderBlock('岗位 ' + roleId, payload));
  }

  function handleFailure(result, what) {
    if (result.status === 401 || result.status === 403) {
      notice('err', what + '失败：token 缺失或无权访问（HTTP ' + result.status + '）。请更换 token 后重试。');
      gate.style.display = '';
      return;
    }
    if (!result.ok) {
      notice('err', what + '失败：HTTP ' + result.status + (result.body && result.body.message ? '（' + String(result.body.message) + '）' : ''));
      return;
    }
    notice('err', what + '失败：返回内容不是合法 JSON。');
  }

  function load() {
    var token = readToken();
    var roleId = currentRoleId();
    clear(app);
    clear(noticeSlot);
    if (!token) {
      gate.style.display = '';
      app.appendChild(el('p', 'dim', '请粘贴 token 后加载。'));
      return;
    }
    gate.style.display = 'none';
    app.appendChild(el('p', 'dim', '加载中…'));
    var path = roleId ? '/api/role-packs/' + encodeURIComponent(roleId) : '/api/role-packs';
    var what = roleId ? '加载岗位 ' + roleId : '加载岗位列表';
    apiGet(path, token).then(function (result) {
      if (!result.ok || result.body === null) {
        clear(app);
        handleFailure(result, what);
        return;
      }
      if (roleId) {
        renderDetail(result.body, roleId);
      } else {
        renderList(result.body);
      }
    }).catch(function (err) {
      clear(app);
      notice('err', what + '失败：网络请求出错（' + String(err) + '）。');
    });
  }

  function saveAndLoad() {
    var value = input.value.trim();
    if (!value) {
      notice('warn', '请先粘贴 token。');
      return;
    }
    writeToken(value);
    input.value = '';
    load();
  }

  saveBtn.addEventListener('click', saveAndLoad);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { saveAndLoad(); }
  });
  reloadBtn.addEventListener('click', load);
  switchBtn.addEventListener('click', function () {
    writeToken('');
    input.value = '';
    clear(app);
    clear(noticeSlot);
    gate.style.display = '';
    app.appendChild(el('p', 'dim', '请粘贴 token 后加载。'));
  });

  load();
})();
</script>
</body>
</html>
`;

/**
 * 两个路由共用的发送壳（无分支、无插值）。
 * 注意：**不要**把 `:roleId` 折进 HTML —— J8 判据「页面 HTML 不含任何岗位数据」，
 * 详情页由客户端从 `window.location.pathname` 自取 id，服务端不发数据。
 */
function sendShell(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(ROLE_PACKS_SHELL);
}

// 🔴 挂载顺序由 `src/server.ts` 保证先于 `jwtAuthMiddleware`（规格 §2.2-D7）；
// 本文件只保证形状：`GET /role-packs` 与 `GET /role-packs/:roleId` ⇒ 200 HTML 壳。
router.get('/role-packs', sendShell);
router.get('/role-packs/:roleId', sendShell);

export default router;
