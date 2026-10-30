/**
 * app/js/approval-card.js — 审批卡渲染库（M1/M2/M3 共享；#1182 · #1075 P3 前端消费者）
 *
 * 架构位置: **浏览器端静态库**（`app/js/`，无构建、无框架、无 import/export）。
 *   被三个页面消费：`app/role-packs.html`（说明书页，M2）、`app/approval-session.html`（审批会话卡，M3）、
 *   以及后续任何需要渲染 `approval_card` 帧的页面。**服务端零改动**（本批 UI 为 additive 消费者）。
 *
 * 设计哲学（一句）: **一处转义、一处请求、一处卡形** —— 后端字符串只能经 `escapeHtml` 进 DOM，
 *   Bearer 只能由本文件的 `buildApprovalRequest` 拼（且永不进 URL/日志），卡形状只由 `cardHtml` 出具；
 *   页面只负责"何时调"。
 *
 * 契约（铁律 47）:
 *   @input  — 纯函数入参：
 *             · `frame` = `src/agent/approval-card.ts` 的 `ApprovalCardFrame`
 *               （`{type:'approval_card', roleId, status, scope, contentHash, permissionsPending,
 *               buttons:[{id,label}]×3, detailPath}`）；
 *             · `options` = `{token, scope?, expectedContentHash?}`；
 *             · `handlers` = `{onAction(action, frame), onDetail(detailPath)}`。
 *   @output — `escapeHtml`／`readToken`／`describeError`／`cardHtml` 返回 string；
 *             `buildApprovalRequest` 返回 `{url, init}`（可直喂 fetch）或 `{error, code}`（**不发请求**）；
 *             `renderApprovalCard` 返回 void（成功即写入 `container.innerHTML` 并按 `data-action` 绑事件）。
 *   @degraded — **前端无 stderr、无 `SYNO_GATE_DEGRADED_LOG`**（那是控制塔门禁脚本的降级契约，浏览器环境
 *             没有这套基础设施 —— 不伪造），故降级一律**页面可见**：
 *             · HTTP 失败 ⇒ `describeError()` 出可读纯文本（code ＋ message ＋ 码表兜底）；
 *             · `frame.detailPath` 未过白名单 ⇒ 回落 `/role-packs/<encodeURIComponent(roleId)>`
 *               **并在卡上标 `data-detail-path-fallback="E_APPROVAL_DETAIL_PATH_INVALID"`**（不静默回退）；
 *             · `frame.buttons` 出现未知 `id` ⇒ 渲染 disabled 按钮并标注「未知动作，已禁用」（不静默丢弃）；
 *             · `readToken()` 的 sessionStorage 异常**不上抛**（返回 `''`）—— 缺 token 的后果由调用方
 *               显示「未登录」，那就是它的呈现方式。
 *   @authority — 谁能调：任何**同源**页面脚本（`app/js/role-packs.js`、`app/approval-session.html` 内联脚本）。
 *             本文件**不校验调用者身份**（浏览器侧无身份可言）；**权限唯一真源是服务端** —— 本文件只负责
 *             带出 Bearer，4xx/403 由 API 返回并由 `describeError` 呈现。**绝不本地放行、绝不本地判审批**。
 *   @not-here — 不发请求（本文件**零 fetch 调用**，只**构造** init）｜不读六件正文／不判审批态｜
 *             不建登录 UI｜不读 cookie/URL/localStorage｜token 永不进 query｜不 console.log 任何凭据｜
 *             不改 `app/js/chat-sse.js`（SSE 先例只读参照）｜不做 i18n｜不做动作裁剪（见已知限制 L3）。
 *
 * typed error 码表（🔴 本文件自有码 —— **与后端码区分**：后端业务码由 API 出，本文件**不复制后端判定**，
 *   只出"调用未成"的前端码；构造 init 成功路径不产码）:
 *   | code | 触发 | 返回形态 |
 *   |---|---|---|
 *   | `E_APPROVAL_ROLE_ID_MISSING` | `roleId` 非字符串／空串（拼不出合法 URL） | `{error, code}`（不发请求） |
 *   | `E_APPROVAL_ACTION_UNKNOWN` | `action` 不属 `approve`／`revoke`（`detail` 无写端点） | `{error, code}`（不发请求） |
 *   | `E_APPROVAL_TOKEN_MISSING` | token 缺失／非字符串／空串 | `{error, code}`（**不得发请求**） |
 *   | `E_APPROVAL_DETAIL_PATH_INVALID` | `frame.detailPath` 未过 `/^\/role-packs\/[A-Za-z0-9._-]+$/` | 卡上 `data-detail-path-fallback` ＋ 安全回落 |
 *   | `E_APPROVAL_CONTAINER_INVALID` | `renderApprovalCard` 的 container 不是 DOM 节点 | **throw**（`err.code`，`err.name='SynovaApprovalCardError'`） |
 *   | `E_APPROVAL_DOM_UNAVAILABLE` | 运行环境无 `document`（纯 JS 环境误调渲染） | **throw**（`err.code`） |
 *   后端码（`E_APPROVAL_CONTENT_CHANGED` 等）**只出现在 `describeError` 的 `CODE_HINTS` 兜底文案里**，
 *   本文件不产生、不改写它们（同一语义两处实现 ⇒ 必然漂移）。
 *
 * 复用既有约定（DSH 代码标准 §D；逐条说"复用/不适用"，不重复造）:
 *   · **D3 · UTF-8 强制（D732）**：本文件 UTF-8 无 BOM，中文文案直出（同 `app/` 既有件）。
 *   · **D2 · `@降级` 契约**：见 `@degraded` —— 前端降级出口＝页面可见文案／卡上标记；
 *     `SYNO_GATE_DEGRADED_LOG` 属控制塔门禁域，浏览器无该设施，**不伪造**。
 *   · **R4.2 · 凭据缺省禁止**：`readToken()` 用 `typeof raw === 'string' ? raw : ''`，
 *     **不写 `|| ''` / `?? ''`**（对齐 `src/routes/role-packs-page.ts:150` 的明示口径）。
 *   · **R4.3 · 出站请求可取消**：`init.signal = AbortSignal.timeout(15000)`（同
 *     `src/routes/role-packs-page.ts:186` 的 15s 口径）；无 `AbortSignal.timeout` 时退 `AbortController`。
 *   · **D1 · 三态退出码 / D4 · 判别力自检**：浏览器库无进程退出码；判别力由验收侧 vm 用例证明
 *     （U-J4 转义夹具 ＋ U-J6 改坏必红），本文件不自带测试运行器（无构建链，见已知限制 L1）。
 *
 * Source map:
 *   | 符号 | 角色 |
 *   |---|---|
 *   | `escapeHtml` | 唯一转义出口（null/undefined ⇒ `''`；转义 `& < > " '`） |
 *   | `readToken` | Bearer 唯一来源（`sessionStorage['synova.token']`，显式判型） |
 *   | `describeError` | HTTP 失败 → 可读**纯文本**（code ＋ message ＋ 码表兜底） |
 *   | `buildApprovalRequest` | 唯一请求构造（`POST /api/role-packs/:roleId/approval`，含 15s signal） |
 *   | `cardHtml` | 唯一卡形（纯函数、全字段经 `escapeHtml`、无 document） |
 *   | `renderApprovalCard` | 唯一 DOM 写入（innerHTML 后按 `data-action` 绑事件） |
 *   | `sanitizeDetailPath` | `detailPath` 白名单校验＋安全回落 |
 *   | `statusText`/`scopeText`/`contentHashText`/`permissionsPendingText` | 字段呈现（**双写**：中文标签＋原始枚举值，机器可断言、人工可判） |
 *   | `buttonsHtml`/`buttonHtml`/`defaultLabel` | 按钮三件渲染（未知动作 disabled＋标注） |
 *   | `makeTimeoutSignal` | 15s 超时/可取消（R4.3；**在函数体内取 AbortSignal**，不在加载期求值） |
 *   | `approvalError` | 带 `code` 的 typed Error（禁裸 throw 字符串） |
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · **L1 · 无配对测试运行器**：本批无 jsdom、无构建链（规格 §4）。验收靠 /tmp 用 node `vm` 载入
 *     （stub `window`/`document`/`sessionStorage`/`AbortSignal`）＋ U-J6 改坏必红；**不入 CI 测试集**。
 *   · **L2 · 文案硬编码中文**：与 `src/agent/approval-card.ts` L3 同口径（无 i18n 层，多语言属后续批次）。
 *   · **L3 · 不做动作裁剪**：三按钮恒渲染（与后端 `approval-card.ts` L5 一致 —— 服务端对非法动作返回
 *     typed 4xx，前端**不假装守卫**）；`status` 不决定按钮可用性。
 *   · **L4 · 无 signal 时无超时**：既无 `AbortSignal.timeout` 又无 `AbortController` 的极旧环境退化为
 *     不可取消请求（不影响鉴权与转义）；该退化不在页面上噪音化。
 *   · **L5 · `escapeHtml` 只保证 HTML 文本／属性上下文安全**：**不得**用于 `<script>`／`style`／URL
 *     （`javascript:` 之类需另行白名单）上下文 —— 本文件自身不产生这类上下文（属性只放白名单值）。
 *   · **L6 · `describeError` 返回纯文本**：调用方必须用 `textContent`（或再经 `escapeHtml`）落地；
 *     本文件不返回 HTML 片段，以免"先转义再拼 HTML"的两道工序被误用。
 *   · **L7 · 不校验 token 形态/JWT exp**：过期 token 由 API 401 呈现（不在前端猜）。
 *   · **L8 · `renderApprovalCard` 整体覆盖 container**：旧卡的按钮监听随节点废弃（无泄漏，但也**不保留**
 *     旧卡状态）；container 若无 `querySelectorAll`（极简 stub/自定义容器）⇒ 只写入 HTML、跳过绑事件
 *     （真 DOM 恒有该 API；此退化为 vm 断言留路，不影响主路径）。
 *   · **L9 · 无 CSP／SRI**：页面内联脚本需要 `script-src 'unsafe-inline'`；本批不引入 CSP（§1.3 非目标）。
 */

(function () {
  'use strict';

  /** 请求超时（毫秒）：对齐 `src/routes/role-packs-page.ts` 的 15s 口径（R4.3 可取消）。 */
  var REQUEST_TIMEOUT_MS = 15000;

  /** detailPath 白名单 —— 唯一合法形状（其余回落；回落必须可见，见 @degraded）。 */
  var DETAIL_PATH_PATTERN = /^\/role-packs\/[A-Za-z0-9._-]+$/;

  /** 允许参与点击绑定的动作 id（＝后端 §2.3-E 协议三件；顺序即协议）。 */
  var ACTION_IDS = ['approve', 'revoke', 'detail'];

  /** 动作默认文案（`frame.buttons` 缺字段时兜底 —— 不静默丢按钮）。 */
  var DEFAULT_BUTTONS = [
    { id: 'approve', label: '批准' },
    { id: 'revoke', label: '撤销' },
    { id: 'detail', label: '查看说明书' }
  ];

  /** 审批态文案（**双写**：中文 ＋ 原始枚举值）。 */
  var STATUS_LABELS = { approved: '已批准', pending: '待批准', unverified: '未验证' };

  /** 批准粒度文案（双写）。 */
  var SCOPE_LABELS = { 'content': '仅内容', 'content+permissions': '内容＋权限' };

  /** 「未定」文案（`null`/`undefined` 专用 —— 🔴 不得显示成 `false`，后端 contract L1）。 */
  var NOT_SET = '未定';

  /** 后端码 → 人话（仅在 `body.message` 缺失时兜底；不替代后端 message）。 */
  var CODE_HINTS = {
    UNAUTHORIZED: '未认证 —— 需要有效 Bearer token',
    E_ROLE_PACK_FORBIDDEN: '当前角色不允许使用审批会话（仅 admin/manager/ga）',
    E_ROLE_PACK_NOT_FOUND: '岗位包不存在',
    E_APPROVAL_SESSION_CONFLICT: 'approvalRoleId 与 rolePackId 互斥，不得同给',
    E_APPROVAL_ROLE_ID_INVALID: '岗位 id 形状非法',
    E_APPROVAL_ROLE_FORBIDDEN: '当前角色不允许审批该岗位',
    E_APPROVAL_ORG_MISMATCH: '组织不匹配 —— 不是本组织的岗位包',
    E_APPROVAL_FACTORY_LOCKED: '出厂锚优先 —— 该岗位不可本地改写',
    E_APPROVAL_CONTENT_CHANGED: '内容已变更（指纹不符）—— 请重新查看说明书后重批',
    E_APPROVAL_ACTION_INVALID: '审批动作非法（仅 approve/revoke）',
    E_APPROVAL_ROLE_NOT_FOUND: '岗位包不存在',
    E_APPROVAL_NOT_FOUND: '没有可撤销的审批记录',
    E_APPROVAL_BODY_TOO_LARGE: '请求体过大（上限 16 KiB）',
    E_APPROVAL_SCOPE_INVALID: '批准粒度非法（仅 content / content+permissions）',
    E_APPROVAL_WRITE_DISABLED: '审批写入未启用（服务端 SYNOVA_APPROVAL_WRITE=off）',
    E_APPROVAL_IO: '审批写入 IO 失败 —— 未写入'
  };

  /** HTTP 状态码人话（码表兜底的最外层；无 body 时用）。 */
  var HTTP_HINTS = {
    400: '请求参数不合法',
    401: '未认证 —— 需要有效 Bearer token',
    403: '无权限',
    404: '目标不存在',
    409: '内容已变更',
    413: '请求体过大',
    422: '参数语义不合法',
    500: '服务端内部错误',
    503: '服务未启用'
  };

  // ── 转义（唯一出口）────────────────────────────────────────────────────────

  /**
   * HTML 转义（**唯一出口**；null/undefined ⇒ `''`，与冻结接口一致）。
   *
   * @param {*} value - 任意后端值（string/number/boolean/null/undefined）
   * @returns {string} 可安全放进 HTML 文本或**双引号属性**的字符串（转义 `& < > " '`）
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── token（唯一来源）───────────────────────────────────────────────────────

  /**
   * 读取访问 token（**Bearer 唯一来源**：`sessionStorage['synova.token']`）。
   *
   * 🔴 禁读 cookie／URL／localStorage（规格 §10-L9）；🔴 禁 `|| ''` 补缺省（R4.2）——
   *   用显式判型，把"取不到"折成空串而不是"看起来有值"。
   * @returns {string} token；缺失或 sessionStorage 抛异常 ⇒ `''`（降级由调用方显示「未登录」）
   */
  function readToken() {
    try {
      if (typeof sessionStorage === 'undefined' || sessionStorage === null) {
        return '';
      }
      var raw = sessionStorage.getItem('synova.token');
      return typeof raw === 'string' ? raw : '';
    } catch (err) {
      return '';
    }
  }

  // ── 错误呈现（纯文本）───────────────────────────────────────────────────────

  /**
   * 把 HTTP 失败折成可读**纯文本**（优先 `body.code` ＋ `body.message`）。
   *
   * @param {number} status - HTTP 状态码（网络失败传 0 亦可）
   * @param {Object|string|null} body - 响应体（对象或 JSON 文本；非 JSON 文本按无 body 处理）
   * @returns {string} 可读文案（**纯文本**，调用方用 `textContent` 落地；不含 HTML）
   */
  function describeError(status, body) {
    var parsed = body;
    if (typeof parsed === 'string') {
      parsed = parseJson(parsed);
    }
    var hasBody = parsed !== null && typeof parsed === 'object';
    var code = hasBody && typeof parsed.code === 'string' ? parsed.code : '';
    var message = hasBody && typeof parsed.message === 'string' ? parsed.message : '';
    var statusText = describeStatus(status);

    if (code !== '' && message !== '') {
      return code + '：' + message + '（' + statusText + '）';
    }
    if (code !== '') {
      var hint = Object.prototype.hasOwnProperty.call(CODE_HINTS, code) ? CODE_HINTS[code] : '';
      return (hint !== '' ? code + '：' + hint : code) + '（' + statusText + '）';
    }
    if (message !== '') {
      return message + '（' + statusText + '）';
    }
    return statusText;
  }

  /**
   * 状态码 → 可读片段（内部）。
   *
   * @param {number} status - HTTP 状态码
   * @returns {string} 如 `HTTP 409 — 内容已变更`
   */
  function describeStatus(status) {
    var numeric = typeof status === 'number' ? status : -1;
    if (numeric < 100) {
      return 'HTTP 状态未知（网络失败或流中断）';
    }
    var hint = Object.prototype.hasOwnProperty.call(HTTP_HINTS, numeric) ? HTTP_HINTS[numeric] : '';
    return hint !== '' ? 'HTTP ' + numeric + ' — ' + hint : 'HTTP ' + numeric;
  }

  /**
   * 宽松 JSON 解析（内部；非 JSON 文本 ⇒ null，不抛）。
   *
   * @param {string} raw - 原始响应文本
   * @returns {Object|null} 解析结果
   */
  function parseJson(raw) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  // ── 请求构造（唯一出口）────────────────────────────────────────────────────

  /**
   * 构造审批写请求（**只构造、不发送**：本文件零 fetch）。
   *
   * @param {string} roleId - 岗位 id（＝角色包目录名）
   * @param {'approve'|'revoke'} action - 审批动作（`detail` 无写端点）
   * @param {{token: string, scope?: string, expectedContentHash?: string}} options - Bearer ＋ 可选字段
   * @returns {{url: string, init: Object}|{error: string, code: string}} 可直喂 fetch；非法入参返回
   *          `{error, code}` 且**不发请求**（token 缺失恒 `E_APPROVAL_TOKEN_MISSING`）
   */
  function buildApprovalRequest(roleId, action, options) {
    var id = typeof roleId === 'string' ? roleId : '';
    if (id === '') {
      return {
        error: '缺少岗位 id（roleId 非字符串或为空），已阻止请求',
        code: 'E_APPROVAL_ROLE_ID_MISSING'
      };
    }
    if (action !== 'approve' && action !== 'revoke') {
      return {
        error: '未知审批动作：' + String(action) + '（仅 approve／revoke 有写端点）',
        code: 'E_APPROVAL_ACTION_UNKNOWN'
      };
    }

    var opts = options !== null && typeof options === 'object' ? options : {};
    var token = typeof opts.token === 'string' ? opts.token : '';
    if (token === '') {
      return {
        error: '缺少访问 token（未提供 Bearer），已阻止请求',
        code: 'E_APPROVAL_TOKEN_MISSING'
      };
    }

    // body 形状（规格 §2.3-B）：{action, scope?, expectedContentHash?}；可选字段为空时不写键。
    var payload = { action: action };
    if (typeof opts.scope === 'string' && opts.scope !== '') {
      payload.scope = opts.scope;
    }
    if (typeof opts.expectedContentHash === 'string' && opts.expectedContentHash !== '') {
      payload.expectedContentHash = opts.expectedContentHash;
    }

    var init = {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: makeTimeoutSignal()
    };

    return { url: '/api/role-packs/' + encodeURIComponent(id) + '/approval', init: init };
  }

  /**
   * 15s 超时/可取消信号（R4.3）。
   *
   * 🔴 `AbortSignal` 只在**函数体内**取（不在加载期求值）：node `vm` 夹具可 stub，
   *   加载期求值会让纯 JS 环境在 require 时就 ReferenceError。
   * @returns {AbortSignal|undefined} 可用则返回 signal；极旧环境返回 undefined（见已知限制 L4）
   */
  function makeTimeoutSignal() {
    if (typeof AbortSignal !== 'undefined' && AbortSignal !== null &&
        typeof AbortSignal.timeout === 'function') {
      try {
        return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      } catch (err) {
        // 落到 AbortController 分支
      }
    }
    if (typeof AbortController !== 'undefined' && AbortController !== null) {
      try {
        var controller = new AbortController();
        if (typeof setTimeout === 'function') {
          setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
        }
        return controller.signal;
      } catch (err2) {
        return undefined;
      }
    }
    return undefined;
  }

  // ── 卡形（纯函数、无 DOM）─────────────────────────────────────────────────

  /**
   * 生成审批卡 HTML（**纯函数**：无 DOM、无 IO、同一入参恒等产出）。
   *
   * @param {Object} frame - `ApprovalCardFrame`（缺字段按「未定」呈现，不造假值）
   * @returns {string} 卡 HTML（**全部后端串经 `escapeHtml`**；属性只放白名单值）
   */
  function cardHtml(frame) {
    var src = frame !== null && typeof frame === 'object' ? frame : {};
    var roleId = typeof src.roleId === 'string' ? src.roleId : '';
    var detail = sanitizeDetailPath(src);

    var html = '';
    html += '<section class="approval-card" data-card="approval"';
    if (detail.code !== '') {
      // 回落可见（不静默）：机器可断言，人工可追
      html += ' data-detail-path-fallback="' + escapeHtml(detail.code) + '"';
    }
    html += '>';
    html += '<header class="approval-card-header"><h2>岗位审批卡</h2></header>';
    html += '<dl class="approval-card-fields">';
    html += fieldHtml('岗位', 'roleId', roleId === '' ? NOT_SET : roleId);
    html += fieldHtml('状态', 'status', statusText(src.status));
    html += fieldHtml('内容指纹', 'contentHash', contentHashText(src.contentHash));
    html += fieldHtml('批准粒度', 'scope', scopeText(src.scope));
    html += fieldHtml('待批权限', 'permissionsPending', permissionsPendingText(src.permissionsPending));
    html += fieldHtml('说明书路径', 'detailPath', detail.path);
    html += '</dl>';
    html += buttonsHtml(src.buttons, detail.path);
    html += '</section>';
    return html;
  }

  /**
   * 一组 `<dt>/<dd>`（内部；label/字段名是代码常量，值一律转义）。
   *
   * @param {string} label - 中文字段名
   * @param {string} name - `data-field` 机器可读名
   * @param {string} value - 呈现文案（后端原值已折成文本）
   * @returns {string} HTML 片段
   */
  function fieldHtml(label, name, value) {
    return '<dt>' + escapeHtml(label) + '</dt>' +
      '<dd data-field="' + escapeHtml(name) + '">' + escapeHtml(value) + '</dd>';
  }

  /**
   * 审批态文案（双写：中文 ＋ 原始枚举值；未知值显式标「未定（原值：…）」，不静默吞）。
   *
   * @param {*} value - `approved|pending|unverified|null`
   * @returns {string} 呈现文案
   */
  function statusText(value) {
    if (value === null || value === undefined || value === '') {
      return NOT_SET;
    }
    var raw = String(value);
    if (Object.prototype.hasOwnProperty.call(STATUS_LABELS, raw)) {
      return STATUS_LABELS[raw] + '（' + raw + '）';
    }
    return NOT_SET + '（原值：' + raw + '）';
  }

  /**
   * 批准粒度文案（`null` ⇒ 「未定」—— **不得**显示成 `false`）。
   *
   * @param {*} value - `content|content+permissions|null`
   * @returns {string} 呈现文案
   */
  function scopeText(value) {
    if (value === null || value === undefined || value === '') {
      return NOT_SET;
    }
    var raw = String(value);
    if (Object.prototype.hasOwnProperty.call(SCOPE_LABELS, raw)) {
      return SCOPE_LABELS[raw] + '（' + raw + '）';
    }
    return NOT_SET + '（原值：' + raw + '）';
  }

  /**
   * 内容指纹文案（`null`/空 ⇒ 「未定」—— 无指纹即不可批，后端 contract L2）。
   *
   * @param {*} value - 64 位小写 hex 或 null
   * @returns {string} 呈现文案
   */
  function contentHashText(value) {
    if (value === null || value === undefined) {
      return NOT_SET;
    }
    var raw = String(value);
    return raw === '' ? NOT_SET : raw;
  }

  /**
   * 待批权限文案（`null` ⇒ 「未定」；`false` ⇒ 「否」—— 两者**不得混同**）。
   *
   * @param {*} value - `true|false|null`
   * @returns {string} 呈现文案
   */
  function permissionsPendingText(value) {
    if (value === null || value === undefined) {
      return NOT_SET;
    }
    if (value === true) {
      return '是（存在待批权限）';
    }
    if (value === false) {
      return '否（无待批权限）';
    }
    return NOT_SET + '（原值：' + String(value) + '）';
  }

  /**
   * 按钮区渲染（`frame.buttons` 缺失/空 ⇒ 兜底三件；未知 id ⇒ disabled ＋ 标注）。
   *
   * @param {Array<{id: string, label: string}>|undefined} buttons - 后端按钮三件
   * @param {string} detailPath - 已白名单校验（或安全回落）的说明书路径
   * @returns {string} HTML 片段
   */
  function buttonsHtml(buttons, detailPath) {
    var list = Array.isArray(buttons) ? buttons : [];
    var usable = list.length > 0 ? list : DEFAULT_BUTTONS;
    var html = '<div class="approval-card-actions">';
    for (var i = 0; i < usable.length; i += 1) {
      html += buttonHtml(usable[i], detailPath);
    }
    html += '</div>';
    return html;
  }

  /**
   * 单个按钮渲染（内部）。`data-action` 只放白名单 id，其余转义＋disabled。
   *
   * @param {Object} button - `{id, label}`
   * @param {string} detailPath - 说明书路径（仅 `detail` 按钮带 `data-detail-path`）
   * @returns {string} HTML 片段
   */
  function buttonHtml(button, detailPath) {
    var src = button !== null && typeof button === 'object' ? button : {};
    var id = typeof src.id === 'string' ? src.id : '';
    var label = typeof src.label === 'string' && src.label !== '' ? src.label : defaultLabel(id);

    if (ACTION_IDS.indexOf(id) < 0) {
      return '<button type="button" class="btn" data-action="' + escapeHtml(id) + '"' +
        ' data-unsupported="true" disabled>' + escapeHtml(label) + '（未知动作，已禁用）</button>';
    }

    var attrs = ' type="button" class="btn" data-action="' + escapeHtml(id) + '"';
    if (id === 'detail') {
      attrs += ' data-detail-path="' + escapeHtml(detailPath) + '"';
    }
    return '<button' + attrs + '>' + escapeHtml(label) + '</button>';
  }

  /**
   * 动作默认文案（内部；未知 id 兜底「未知动作」）。
   *
   * @param {string} id - 动作 id
   * @returns {string} 文案
   */
  function defaultLabel(id) {
    for (var i = 0; i < DEFAULT_BUTTONS.length; i += 1) {
      if (DEFAULT_BUTTONS[i].id === id) {
        return DEFAULT_BUTTONS[i].label;
      }
    }
    return '未知动作';
  }

  /**
   * `detailPath` 白名单校验＋安全回落（内部）。
   *
   * @param {Object} frame - 卡帧（取 `detailPath`/`roleId`）
   * @returns {{path: string, code: string}} 合法 ⇒ `code=''`；非法 ⇒ 回落路径 ＋ `E_APPROVAL_DETAIL_PATH_INVALID`
   */
  function sanitizeDetailPath(frame) {
    var src = frame !== null && typeof frame === 'object' ? frame : {};
    var raw = typeof src.detailPath === 'string' ? src.detailPath : '';
    if (DETAIL_PATH_PATTERN.test(raw)) {
      return { path: raw, code: '' };
    }
    var roleId = typeof src.roleId === 'string' ? src.roleId : '';
    return { path: '/role-packs/' + encodeURIComponent(roleId), code: 'E_APPROVAL_DETAIL_PATH_INVALID' };
  }

  // ── 渲染（唯一写 DOM 的地方）───────────────────────────────────────────────

  /**
   * 渲染审批卡到容器（**唯一 DOM 写入点**）：先 `innerHTML = cardHtml(frame)`，再按 `data-action` 绑事件。
   *
   * @param {HTMLElement} container - 卡容器（真 DOM 节点）
   * @param {Object} frame - `ApprovalCardFrame`
   * @param {{onAction?: function(string, Object): void, onDetail?: function(string): void}} handlers - 回调
   * @returns {void} 成功无返回；非法容器/无 document ⇒ throw（带 `code`，见 typed error 码表）
   */
  function renderApprovalCard(container, frame, handlers) {
    if (typeof document === 'undefined' || document === null) {
      throw approvalError('运行环境无 document —— 无法渲染审批卡（本函数只能在浏览器里调）',
        'E_APPROVAL_DOM_UNAVAILABLE');
    }
    if (container === null || container === undefined || typeof container !== 'object') {
      throw approvalError('审批卡容器非法 —— 需要 DOM 节点（收到：' + typeof container + '）',
        'E_APPROVAL_CONTAINER_INVALID');
    }

    container.innerHTML = cardHtml(frame);

    // 绑事件：容器无 querySelectorAll 时只写入不绑定（见已知限制 L8；真 DOM 恒有）。
    var nodes = [];
    if (typeof container.querySelectorAll === 'function') {
      nodes = container.querySelectorAll('[data-action]');
    }
    for (var i = 0; i < nodes.length; i += 1) {
      bindActionNode(nodes[i], frame, handlers);
    }
  }

  /**
   * 单按钮绑事件（内部；每次调用自有作用域 ⇒ 闭包捕获当前 action/path，无 var 串值）。
   *
   * @param {HTMLElement} node - 带 `data-action` 的按钮
   * @param {Object} frame - 卡帧（回传给 `onAction`）
   * @param {Object} handlers - `{onAction, onDetail}`
   * @returns {void}
   */
  function bindActionNode(node, frame, handlers) {
    if (node === null || node === undefined || typeof node !== 'object') {
      return;
    }
    if (typeof node.addEventListener !== 'function' || typeof node.getAttribute !== 'function') {
      return;
    }
    var action = node.getAttribute('data-action');
    if (ACTION_IDS.indexOf(action) < 0) {
      return;
    }
    if (action === 'detail') {
      var rawPath = node.getAttribute('data-detail-path');
      var detailPath = typeof rawPath === 'string' && rawPath !== '' ? rawPath : '/role-packs/';
      node.addEventListener('click', function () {
        callHandler(handlers, 'onDetail', detailPath);
      });
      return;
    }
    node.addEventListener('click', function () {
      callHandler(handlers, 'onAction', action, frame);
    });
  }

  /**
   * 安全调用回调（内部；handlers 缺失/非函数 ⇒ 静默不抛 —— 但按钮已可见，缺失由调用方负责）。
   *
   * @param {Object} handlers - `{onAction, onDetail}`
   * @param {string} name - 回调名
   * @param {*} arg1 - 第一个实参
   * @param {*} arg2 - 第二个实参（可选）
   * @returns {void}
   */
  function callHandler(handlers, name, arg1, arg2) {
    if (handlers === null || typeof handlers !== 'object') {
      return;
    }
    if (typeof handlers[name] !== 'function') {
      return;
    }
    handlers[name](arg1, arg2);
  }

  /**
   * 带 `code` 的 typed Error（**禁裸 throw 字符串**）。
   *
   * @param {string} message - 人读信息
   * @param {string} code - 前端码（见文件头码表）
   * @returns {Error} `err.name='SynovaApprovalCardError'`，`err.code=code`
   */
  function approvalError(message, code) {
    var err = new Error(message);
    err.name = 'SynovaApprovalCardError';
    err.code = code;
    return err;
  }

  // ── 导出（加载期只赋值，不触 DOM）─────────────────────────────────────────

  var SynovaApprovalCard = {
    escapeHtml: escapeHtml,
    readToken: readToken,
    describeError: describeError,
    buildApprovalRequest: buildApprovalRequest,
    cardHtml: cardHtml,
    renderApprovalCard: renderApprovalCard
  };

  // 浏览器 = window；node vm 夹具可只 stub window ⇒ 两者都覆盖。
  var root = null;
  if (typeof window !== 'undefined' && window !== null) {
    root = window;
  } else if (typeof globalThis !== 'undefined' && globalThis !== null) {
    root = globalThis;
  }
  if (root !== null) {
    root.SynovaApprovalCard = SynovaApprovalCard;
  }
}());
