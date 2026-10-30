/**
 * app/js/role-packs.js — 岗位说明书页消费者（列表／详情／审批动作；#1182 · #1075 P3 收口）
 *
 * 架构位置: 纯静态前端（`app/**`，由 `express.static('/app')` 直出；无框架、无构建、无模块系统）。
 *   与 `src/routes/role-packs-page.ts` 的 `/role-packs` 壳**并存而非替代** —— 那件是服务端零插值只读壳；
 *   本件是 **additive 消费者**，差异只在「六件／状态／审计历史语义渲染」＋「审批动作」（P3 未覆盖）。
 *
 * 设计哲学（一句）: **页面对数据零知识、对身份零特权** —— 壳里不出现一个岗位字段，数据全用浏览器
 *   自己的 Bearer 直取 API；于是「壳可公开载入」与「数据必须鉴权」不再冲突。
 *
 * 契约（铁律 47）:
 *   @input  — token 唯一来源 `sessionStorage['synova.token']`，且**只经** `SynovaApprovalCard.readToken()`
 *             读取（本文件不读 cookie／URL／localStorage）；HTTP：GET `/api/role-packs`、
 *             GET `/api/role-packs/:roleId`、POST `/api/role-packs/:roleId/approval`
 *             （Bearer 头与 POST 体构造**全部**经 `SynovaApprovalCard.buildApprovalRequest()`）。
 *   @output — DOM：`#role-packs-app`（列表）／`#role-packs-detail`（详情）／`#notice-slot`（可见提示）；
 *             `window.SynovaRolePacks = {bootstrap, loadList, loadDetail, submitAction, renderList,
 *             renderDetail, renderNotLoggedIn, state}`（/tmp vm 自测入口；**非生产 API**，见 L8）。
 *   @degraded — **不静默**：无 token ⇒ 渲染「未登录」且 **零数据 API 请求**；依赖缺失／storage 抛异常／
 *             HTTP 非 2xx／非 JSON／超时一律成**可见**提示（带 typed code）；后端的 `degraded`／`truncated`／
 *             `errors[]`／`pieceError`／`recordError`／`chain:null` 原样显式展示，不吞（铁律 11/24/31）。
 *   @authority — 只读＋审批写。**审批权限判定不在前端**：角色白名单（admin/manager/ga）与 org 单源
 *             全在 `src/routes/role-approvals.ts`；前端只是 Bearer 载体，401/403 照实显示、不猜测。
 *   @not-here — 不做登录 UI（token 手工粘贴，规格 §10-L9）｜不做审批判定/校验/重试/缓存｜不碰 `src/**`｜
 *             不改 `app/chat.html`／`app/js/chat-sse.js`｜**不复制**第二套转义或请求构造
 *             （唯一实现＝`app/js/approval-card.js`；本文件对后端数据一律 `textContent`，零 innerHTML 拼数据）。
 *
 * typed error（**前端自有码**，命名空间 `E_ROLE_PACKS_UI_*`；与后端 `E_APPROVAL_*`／`UNAUTHORIZED` 严格区分）:
 *   | code | 含义 | 是否已发请求 |
 *   |---|---|---|
 *   | `E_ROLE_PACKS_UI_DEP_MISSING` | `/app/js/approval-card.js` 未就绪或缺所需方法 | 否 |
 *   | `E_ROLE_PACKS_UI_NOT_LOGGED_IN` | 无 token（信息态；页面零数据请求） | 否 |
 *   | `E_ROLE_PACKS_UI_STORAGE` | `sessionStorage` 不可用／`readToken()` 抛异常 | 否 |
 *   | `E_ROLE_PACKS_UI_NO_ROLE_ID` | 未选岗位却要加载详情 | 否 |
 *   | `E_ROLE_PACKS_UI_ACTION_INVALID` | action ∉ {approve,revoke} 或 scope 非法 | 否 |
 *   | `E_ROLE_PACKS_UI_HASH_MISSING` | approve 缺 `expectedContentHash`（空值后端必 409，故先拦） | 否 |
 *   | `E_ROLE_PACKS_UI_REQUEST_INVALID` | `buildApprovalRequest` 未返回 `{url, init}` | 否 |
 *   | `E_ROLE_PACKS_UI_BUSY` | 上一个审批请求未结束（防双击并发） | 否 |
 *   | `E_ROLE_PACKS_UI_NETWORK` | 网络失败／超时（`AbortSignal.timeout` 15s） | 已发 |
 *   | `E_ROLE_PACKS_UI_HTTP` | 非 2xx 且响应体无 `code`（`describeError` 文案兜底面） | 已发 |
 *   | `E_ROLE_PACKS_UI_BAD_JSON` | 响应体不是 JSON 对象 | 已发 |
 *   后端 12 个码（`src/routes/role-approvals.ts:28-37`）**原样透传**；文案一律走
 *   `SynovaApprovalCard.describeError(status, body)` —— 本文件**不另写码表**（禁重复建设）。
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · L1 · 无登录 UI：token 手工粘贴进 `sessionStorage['synova.token']` ⇒ 换/关标签页即丢；生产接入需另做登录。
 *   · L2 · 无框架/无实时刷新：「重新加载」或刷新页面才重取；不轮询（规格 §10-L4）。
 *   · L3 · 无 CSP/SRI：内联样式需 `'unsafe-inline'`（本批不引入 CSP，§1.3 非目标）。
 *   · L4 · approve 必须先有内容指纹：`expectedContentHash` 是**后端必填**（空/形状非法 ⇒ 写模块必然 409
 *     `E_APPROVAL_CONTENT_CHANGED`），故详情页把它预填为本次读取的 `contentHash`，空则**本地先拦**
 *     （`E_ROLE_PACKS_UI_HASH_MISSING`）；`contentHash: null`（六件不可读，见 `pieceError`）时同样拒绝
 *     —— 此时"批准"没有可绑定的内容基线。这是**前端刻意收紧**，不是放宽。
 *   · L5 · 六件文本按 API 返回原样展示（单件 ≤64 KiB，超限由 API 标 `truncated`）；**前端不做按码点截断**
 *     ⇒ 末字符可能落在多字节 UTF-8 中间显示为替换符（与 `role-approvals.ts` L-page-1 同一条限制）。
 *   · L6 · 无分页：列表最多 200 条，超出由 API 标 `truncated:true`，本页只显式提示、不提供翻页。
 *   · L7 · 老浏览器无 `AbortSignal.timeout`（Chrome <103）⇒ 该请求退化为**无超时**（仍可刷新重试）。
 *   · L8 · `window.SynovaRolePacks`／`state` 是**为 /tmp vm 自测暴露的诊断面**（**不存 token**），非稳定 API。
 *   · L9 · 撤销不可逆：仅 `window.confirm` 一道确认（宿主无 confirm 时直接执行）；后端「再撤 404 非幂等」（§10-L5）。
 *   · L10 · `expectedContentHash` 输入框可手改（供"批准已知指纹"）：改错不会造成越权，只会得到 409。
 *
 * Source map（本文件内）:
 *   | 分区 | 职责 |
 *   |---|---|
 *   | 一、依赖与状态 | `dep()` 依赖校验（缺 ⇒ fail loud、零请求）＋ 诊断 `state` |
 *   | 二、DOM 与提示 | `el()`／`clearNode()`／`notice()`（**数据只走 textContent**） |
 *   | 三、读面 | `apiGet()`（Bearer ＋ 15s 超时）／ `loadList()`／`loadDetail()` |
 *   | 四、写面 | `submitAction()`（**唯一**经 `buildApprovalRequest`；`describeError` 译错误） |
 *   | 五、渲染 | `renderList()`（列表＋降级旗标）／`renderDetail()`（状态／六件／记录／审计／链） |
 *   | 六、入口 | `wireTokenGate()` ＋ `bootstrap()`（token 门 ⇒ 零请求 or 恰好一次请求）＋ 自启守卫 |
 *   | 依赖（只读，勿改） | `app/js/approval-card.js`：`readToken/describeError/buildApprovalRequest` |
 *   | 真源（只读） | `src/routes/role-approvals.ts`（API／码表）｜`src/init/role-pack-approval.ts`（记录九键） |
 */
(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════════
  // 一、依赖与状态
  // ════════════════════════════════════════════════════════════════════════════

  /** 诊断状态（不含 token；L8）。`list/detail` ＝ 最近一次成功响应的 body。 */
  var state = {
    list: null,
    detail: null,
    roleId: '',
    lastCode: '',
    lastNotice: '',
    busy: false,
    started: false
  };

  /**
   * 取共享依赖（唯一实现 = `/app/js/approval-card.js`）。
   * @returns 可用则返回该对象；缺任一项返回 `null`（调用方 fail loud，且**零请求**）。
   */
  function dep() {
    if (typeof window === 'undefined' || !window) return null;
    var api = window.SynovaApprovalCard;
    if (!api || typeof api !== 'object') return null;
    if (typeof api.readToken !== 'function') return null;
    if (typeof api.describeError !== 'function') return null;
    if (typeof api.buildApprovalRequest !== 'function') return null;
    return api;
  }

  /** 依赖缺失：显式失败（不静默降级成"空白页"），且不发起任何请求。 */
  function failDependency() {
    setVisible(byTestId('token-gate'), true);
    notice('err', 'E_ROLE_PACKS_UI_DEP_MISSING',
      '依赖未加载：/app/js/approval-card.js 未就绪或缺少所需方法（readToken／describeError／buildApprovalRequest）。'
      + '本页不发起任何数据 API 请求；请确认该脚本先于 role-packs.js 加载。');
    return Promise.resolve({ ok: false, code: 'E_ROLE_PACKS_UI_DEP_MISSING' });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 二、DOM 与提示（数据只经 textContent；零 innerHTML 拼数据）
  // ════════════════════════════════════════════════════════════════════════════

  /** 取 document（vm 无 DOM 时返回 null，所有 DOM 调用前都判空）。 */
  function doc() {
    return typeof document === 'undefined' || !document ? null : document;
  }

  /** 按 id 取节点（缺失 ⇒ null）。 */
  function byId(id) {
    var d = doc();
    if (!d || typeof d.getElementById !== 'function') return null;
    return d.getElementById(id);
  }

  /** 按 data-testid 取节点（缺失 ⇒ null）。 */
  function byTestId(name) {
    var d = doc();
    if (!d || typeof d.querySelector !== 'function') return null;
    try {
      return d.querySelector('[data-testid="' + name + '"]');
    } catch (err) {
      return null;
    }
  }

  /**
   * 建节点。`text` 一律写 `textContent`（**唯一**数据入 DOM 的通道）。
   * @param {string} tag - 标签名
   * @param {string} className - class（空串则跳过）
   * @param {string} [text] - 文本内容
   */
  function el(tag, className, text) {
    var d = doc();
    if (!d || typeof d.createElement !== 'function') return null;
    var node = d.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** 清空子节点。 */
  function clearNode(node) {
    if (!node || !node.firstChild) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** 挂载（任一侧为 null 即跳过，便于无 DOM 自测）。 */
  function append(parent, child) {
    if (!parent || !child) return;
    parent.appendChild(child);
  }

  /** 显隐（优先 style.display；无 style 的宿主退化为 hidden 属性）。 */
  function setVisible(node, visible) {
    if (!node) return;
    if (node.style && typeof node.style === 'object') {
      node.style.display = visible ? '' : 'none';
      return;
    }
    node.hidden = !visible;
  }

  /**
   * 渲染一条可见提示（错误/降级/成功；同时记入 `state` 供 /tmp 自测读回）。
   * @param {'ok'|'warn'|'err'} kind - 提示级别
   * @param {string} code - typed code（前端自有码或后端透传码；空串则不加前缀）
   * @param {string} message - 可读文案
   */
  function notice(kind, code, message) {
    var codeText = typeof code === 'string' ? code : '';
    var text = typeof message === 'string' ? message : String(message);
    /* describeError 的文案常已以 code 开头 ⇒ 不重复加前缀（避免「CODE：CODE：…」）。 */
    var composed = codeText === '' || text.indexOf(codeText) === 0 ? text : codeText + '：' + text;
    state.lastCode = codeText;
    state.lastNotice = composed;
    var slot = byId('notice-slot');
    if (!slot) return;
    clearNode(slot);
    append(slot, el('div', 'notice ' + kind, composed));
  }

  /** 清空提示区与诊断面。 */
  function clearNotice() {
    state.lastCode = '';
    state.lastNotice = '';
    clearNode(byId('notice-slot'));
  }

  /** 显式判型取字符串（缺省走"或空串"判型，**不给凭据做「或空串」兜底** —— CI R4.2）。 */
  function asText(value) {
    return typeof value === 'string' ? value : '';
  }

  /** 去首尾空白（宿主缺 String#trim 时安全）。 */
  function trimText(value) {
    return typeof value === 'string' ? value.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '') : '';
  }

  /** 空值统一显示「未定」类文案（禁把 null 显示成 false）。 */
  function orUnset(value) {
    return typeof value === 'string' && value !== '' ? value : '未定';
  }

  /** 三态显示（`null`/缺字段 ⇒ 未定，不是"否"）。 */
  function yesNo(value) {
    if (value === true) return '是';
    if (value === false) return '否';
    return '未定';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 三、读面（token 只经依赖读取；出站必带 15s 超时，R4.3）
  // ════════════════════════════════════════════════════════════════════════════

  /** R4.3：出站调用必须可取消/有超时 —— 15s。老环境无 `AbortSignal.timeout` ⇒ `undefined`（见 L7）。 */
  function timeoutSignal() {
    try {
      if (typeof AbortSignal !== 'undefined' && AbortSignal && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(15000);
      }
    } catch (err) {
      return undefined;
    }
    return undefined;
  }

  /** 解析 JSON（非对象一律 null ⇒ 调用方显式报 `E_ROLE_PACKS_UI_BAD_JSON`）。 */
  function parseJson(raw) {
    if (typeof raw !== 'string' || raw === '') return null;
    try {
      var parsed = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  /** 错误名（判超时用）。 */
  function errName(err) {
    return err && typeof err.name === 'string' ? err.name : '';
  }

  /**
   * 读 token 状态（**唯一**来源＝依赖的 `readToken()` ⇒ `sessionStorage['synova.token']`）。
   * @returns `{ok:true, token}` 或 `{ok:false, code, message}`（**不发请求**）
   */
  function readTokenState(api) {
    var raw;
    try {
      raw = api.readToken();
    } catch (err) {
      return {
        ok: false,
        code: 'E_ROLE_PACKS_UI_STORAGE',
        message: '读取 token 失败（sessionStorage 不可用：' + String(err) + '）。'
      };
    }
    var token = asText(raw);
    if (token === '') {
      return { ok: false, code: 'E_ROLE_PACKS_UI_NOT_LOGGED_IN', message: '未检测到访问 token。' };
    }
    return { ok: true, token: token };
  }

  /** 后端码透传；无码时给前端兜底码。 */
  function backendCode(body) {
    if (body && typeof body === 'object' && typeof body.code === 'string' && body.code !== '') return body.code;
    return 'E_ROLE_PACKS_UI_HTTP';
  }

  /** 错误文案（唯一来源＝依赖的 `describeError(status, body)`；它抛异常时给兜底文案）。 */
  function describe(api, status, body) {
    var fallback = 'HTTP ' + String(status) + '（响应体无可用文案）';
    try {
      var text = api.describeError(status, body);
      if (typeof text === 'string' && text !== '') return text;
    } catch (err) {
      return fallback + '；describeError 自身抛错：' + String(err);
    }
    return fallback;
  }

  /** GET（Bearer ＋ 15s 超时）。**token 不进 URL**。 */
  function apiGet(path, token) {
    var init = {
      method: 'GET',
      credentials: 'omit',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
      signal: timeoutSignal()
    };
    return fetch(path, init).then(function (res) {
      return res.text().then(function (raw) {
        return { ok: res.ok === true, status: res.status, body: parseJson(raw) };
      });
    });
  }

  /** 无 token / storage 不可用 ⇒ 显式「未登录」态：**零数据 API 请求**（U-J1 硬判据）。 */
  function notLoggedIn(reason) {
    var why = typeof reason === 'string' && reason !== '' ? reason : '未检测到访问 token。';
    /* 本函数刻意不调用 apiGet／submitAction —— 未登录即零请求。 */
    setVisible(byTestId('token-gate'), true);
    setVisible(byId('not-logged-in'), true);
    clearNode(byId('role-packs-app'));
    clearNode(byId('role-packs-detail'));
    notice('warn', 'E_ROLE_PACKS_UI_NOT_LOGGED_IN',
      '未登录：' + why + ' 本页在未登录状态下不发起任何数据 API 请求（零请求）；'
      + '请在下方粘贴 token 后点「保存并加载」。');
    return Promise.resolve({ ok: false, code: 'E_ROLE_PACKS_UI_NOT_LOGGED_IN' });
  }

  /** 网络/超时失败的统一文案（含 typed code，不静默）。 */
  function networkFailure(what, err) {
    var name = errName(err);
    var timedOut = name === 'TimeoutError' || name === 'AbortError';
    var reason = timedOut ? '请求超时（15s）或被中止' : '网络请求出错';
    notice('err', 'E_ROLE_PACKS_UI_NETWORK', what + '失败：' + reason + '（' + String(err) + '）。');
    return { ok: false, code: 'E_ROLE_PACKS_UI_NETWORK' };
  }

  /**
   * 加载列表（`GET /api/role-packs`；**恰好一次** fetch）。
   * @returns Promise<{ok:boolean, status?:number, code?:string}>
   */
  function loadList() {
    var api = dep();
    if (api === null) return failDependency();

    var tokenState = readTokenState(api);
    if (tokenState.ok !== true) return notLoggedIn(tokenState.message);

    setVisible(byTestId('token-gate'), false);
    setVisible(byId('not-logged-in'), false);
    clearNotice();

    var listNode = byId('role-packs-app');
    clearNode(listNode);
    clearNode(byId('role-packs-detail'));
    append(listNode, el('p', 'dim', '加载中…'));

    return apiGet('/api/role-packs', tokenState.token).then(function (result) {
      clearNode(listNode);
      if (result.ok !== true || result.body === null) {
        var code = result.ok !== true ? backendCode(result.body) : 'E_ROLE_PACKS_UI_BAD_JSON';
        var text = result.ok !== true
          ? describe(api, result.status, result.body)
          : '加载岗位列表失败：响应体不是 JSON 对象。';
        notice('err', code, text);
        return { ok: false, status: result.status, code: code };
      }
      state.list = result.body;
      renderList(result.body);
      return { ok: true, status: result.status };
    }).catch(function (err) {
      clearNode(listNode);
      return networkFailure('加载岗位列表', err);
    });
  }

  /**
   * 加载详情（`GET /api/role-packs/:roleId`；**恰好一次** fetch）。
   * @param {string} roleId - 岗位 id（进 URL 前 `encodeURIComponent`；token 永不进 URL）
   * @returns Promise<{ok:boolean, status?:number, code?:string}>
   */
  function loadDetail(roleId) {
    var api = dep();
    if (api === null) return failDependency();

    var id = asText(roleId);
    if (id === '') {
      notice('warn', 'E_ROLE_PACKS_UI_NO_ROLE_ID', '请先从列表选择一个岗位包（缺少 roleId）。');
      return Promise.resolve({ ok: false, code: 'E_ROLE_PACKS_UI_NO_ROLE_ID' });
    }

    var tokenState = readTokenState(api);
    if (tokenState.ok !== true) return notLoggedIn(tokenState.message);

    setVisible(byTestId('token-gate'), false);
    setVisible(byId('not-logged-in'), false);
    clearNotice();

    state.roleId = id;
    var detailNode = byId('role-packs-detail');
    clearNode(detailNode);
    append(detailNode, el('p', 'dim', '加载中…'));

    return apiGet('/api/role-packs/' + encodeURIComponent(id), tokenState.token).then(function (result) {
      clearNode(detailNode);
      if (result.ok !== true || result.body === null) {
        var code = result.ok !== true ? backendCode(result.body) : 'E_ROLE_PACKS_UI_BAD_JSON';
        var text = result.ok !== true
          ? describe(api, result.status, result.body)
          : '加载岗位 ' + id + ' 失败：响应体不是 JSON 对象。';
        notice('err', code, text);
        return { ok: false, status: result.status, code: code };
      }
      state.detail = result.body;
      renderDetail(result.body);
      return { ok: true, status: result.status };
    }).catch(function (err) {
      clearNode(detailNode);
      return networkFailure('加载岗位 ' + id, err);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 四、写面（审批动作；**唯一**请求构造点 = buildApprovalRequest）
  // ════════════════════════════════════════════════════════════════════════════

  /** 审批结果 → 可读语义（含审计动作名，便于对照 §2.3-D）。 */
  function resultText(body) {
    var result = body && typeof body.result === 'string' ? body.result : '';
    var unchanged = body && body.unchanged === true;
    if (result === 'revoked') return '已撤销（记录已删除，审计保留 role_pack.revoked）';
    if (result === 'scope_changed') return '审批粒度已变更（同指纹变粒度 ⇒ 审计 role_pack.scope_changed）';
    if (unchanged === true) return '同指纹同粒度的重复批准：记录未重写、审计未新增';
    if (result === 'approved') return '已批准（审计 role_pack.approved）';
    return '已提交';
  }

  /**
   * 审批动作（approve／revoke）。**没有 action='scope'** —— 改 scope ＝ `action:'approve' + scope`
   * （同 hash 变 scope ⇒ 审计 `role_pack.scope_changed`）。Bearer 头由 `buildApprovalRequest` 统一加。
   * @param {string} roleId - 岗位 id
   * @param {'approve'|'revoke'} action - 动作
   * @param {{scope?:string, expectedContentHash?:string}} [options] - approve 的粒度与内容指纹
   * @returns Promise<{ok:boolean, status?:number, code?:string, body?:object}>
   */
  function submitAction(roleId, action, options) {
    var api = dep();
    if (api === null) return failDependency();

    var id = asText(roleId);
    if (id === '') {
      notice('warn', 'E_ROLE_PACKS_UI_NO_ROLE_ID', '缺少 roleId：无法提交审批动作。');
      return Promise.resolve({ ok: false, code: 'E_ROLE_PACKS_UI_NO_ROLE_ID' });
    }

    var act = action === 'approve' ? 'approve' : (action === 'revoke' ? 'revoke' : '');
    if (act === '') {
      notice('err', 'E_ROLE_PACKS_UI_ACTION_INVALID',
        '审批动作非法：' + String(action) + '（只接受 approve／revoke；没有 scope 动作，改粒度请用 approve + scope）。');
      return Promise.resolve({ ok: false, code: 'E_ROLE_PACKS_UI_ACTION_INVALID' });
    }

    if (state.busy === true) {
      notice('warn', 'E_ROLE_PACKS_UI_BUSY', '上一个审批请求仍在进行中，请稍候（防双击并发）。');
      return Promise.resolve({ ok: false, code: 'E_ROLE_PACKS_UI_BUSY' });
    }

    var opts = options !== null && typeof options === 'object' ? options : {};
    var scope = asText(opts.scope);
    var hash = trimText(opts.expectedContentHash);

    if (act === 'approve') {
      if (scope !== 'content' && scope !== 'content+permissions') {
        notice('err', 'E_ROLE_PACKS_UI_ACTION_INVALID',
          '批准被拒绝（本地前置）：scope 只能是 content 或 content+permissions（收到「' + orUnset(scope) + '」）。');
        return Promise.resolve({ ok: false, code: 'E_ROLE_PACKS_UI_ACTION_INVALID' });
      }
      if (hash === '') {
        notice('err', 'E_ROLE_PACKS_UI_HASH_MISSING',
          '批准被拒绝（本地前置）：缺少内容指纹 expectedContentHash —— 后端对空/形状非法指纹一律 409 '
          + 'E_APPROVAL_CONTENT_CHANGED，故先拦。请先加载详情（六件不可读时无法批准）。');
        return Promise.resolve({ ok: false, code: 'E_ROLE_PACKS_UI_HASH_MISSING' });
      }
    }

    var tokenState = readTokenState(api);
    if (tokenState.ok !== true) return notLoggedIn(tokenState.message);

    var requestInput = { token: tokenState.token };
    if (act === 'approve') {
      requestInput.scope = scope;
      requestInput.expectedContentHash = hash;
    }

    var request = api.buildApprovalRequest(id, act, requestInput);
    if (!request || typeof request !== 'object' || typeof request.url !== 'string'
      || !request.init || typeof request.init !== 'object') {
      var localCode = request && typeof request.code === 'string' && request.code !== ''
        ? request.code : 'E_ROLE_PACKS_UI_REQUEST_INVALID';
      var localText = request && typeof request.error === 'string' && request.error !== ''
        ? request.error : '审批请求构造失败（buildApprovalRequest 未返回 {url, init}）。未发起任何请求。';
      notice('err', localCode, localText);
      return Promise.resolve({ ok: false, code: localCode });
    }

    var init = request.init;
    /* R4.3 兜底：buildApprovalRequest 若未注入超时，这里补 15s（不覆盖已有 signal，见 L7）。 */
    if (!init.signal) init.signal = timeoutSignal();

    state.busy = true;
    return fetch(request.url, init).then(function (res) {
      return res.text().then(function (raw) {
        var body = parseJson(raw);
        if (res.ok !== true) {
          var code = backendCode(body);
          notice('err', code, describe(api, res.status, body));
          return { ok: false, status: res.status, code: code };
        }
        if (body === null) {
          notice('err', 'E_ROLE_PACKS_UI_BAD_JSON',
            '审批请求已发出，但响应体不是 JSON 对象：无法确认落盘结果。请点「刷新详情」核对后再决定是否重试。');
          return { ok: false, status: res.status, code: 'E_ROLE_PACKS_UI_BAD_JSON' };
        }
        /* 刷新成功才把成功提示写回：loadDetail 会清空提示区，刷新失败时保留它的错误提示。 */
        return loadDetail(id).then(function (refreshed) {
          if (refreshed && refreshed.ok === true) {
            notice('ok', '', '审批已生效：' + resultText(body) + '；详情已刷新。');
          }
          return { ok: true, status: res.status, body: body };
        });
      });
    }).catch(function (err) {
      return networkFailure('提交审批（' + act + '）', err);
    }).then(function (outcome) {
      state.busy = false;
      return outcome;
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 五、渲染（所有后端字符串只经 textContent／el() ⇒ 零 innerHTML 拼数据）
  // ════════════════════════════════════════════════════════════════════════════

  /** 键值块（值一律字符串 ⇒ 只走 textContent）。 */
  function renderKv(pairs) {
    var dl = el('dl', 'kv');
    for (var i = 0; i < pairs.length; i += 1) {
      append(dl, el('dt', '', pairs[i][0]));
      append(dl, el('dd', '', pairs[i][1]));
    }
    return dl;
  }

  /** 带标题的分块。 */
  function renderBlock(title, child) {
    var section = el('section', 'rp-block');
    append(section, el('h3', '', title));
    append(section, child);
    return section;
  }

  /** 缺件显示。 */
  function missingText(missing) {
    if (!Array.isArray(missing)) return '未定';
    if (missing.length === 0) return '无';
    var parts = [];
    for (var i = 0; i < missing.length; i += 1) parts.push(String(missing[i]));
    return parts.join('、');
  }

  /** 列表信封（org/root/total/truncated/degraded/errors 全部显式，不吞）。 */
  function renderEnvelope(body) {
    var box = el('section', 'rp-envelope');
    var packs = Array.isArray(body.rolePacks) ? body.rolePacks : [];
    var total = typeof body.total === 'number' ? String(body.total) : '未定';
    append(box, el('p', 'dim',
      '组织 ' + orUnset(body.orgId) + ' · 内容根 ' + orUnset(body.root)
      + ' · 共 ' + total + ' 个（本页显示 ' + String(packs.length) + ' 个）'));
    if (body.truncated === true) {
      append(box, el('p', 'badge warn',
        '列表已截断：只返回前 ' + String(packs.length) + ' 条（total ' + total + '）；本页不提供分页'));
    }
    if (body.degraded === true) {
      append(box, el('p', 'badge warn',
        '加载降级（degraded: true）：存在不可用或校验失败的岗位包，逐条错误见下'));
    }
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      var ul = el('ul', 'rp-errors');
      for (var i = 0; i < body.errors.length; i += 1) {
        append(ul, el('li', '', typeof body.errors[i] === 'string' ? body.errors[i] : String(body.errors[i])));
      }
      append(box, ul);
    }
    return box;
  }

  /** 列表行（roleId/status/scope/contentHash/permissionsPending/usable 全部可见）。 */
  function renderListRow(rawPack) {
    var pack = rawPack && typeof rawPack === 'object' ? rawPack : {};
    var roleId = asText(pack.roleId);
    var card = el('article', 'rp-card');

    var head = el('div', 'rp-card-head');
    var openBtn = el('button', 'rp-role-id', roleId === '' ? '(无法识别的岗位条目)' : roleId);
    if (openBtn) {
      openBtn.type = 'button';
      if (roleId !== '') {
        openBtn.addEventListener('click', function () { loadDetail(roleId); });
      } else {
        openBtn.disabled = true;
      }
    }
    append(head, openBtn);
    append(head, el('span', 'badge', '状态 ' + orUnset(pack.status)));
    if (pack.usable === false) append(head, el('span', 'badge warn', '不可用'));
    append(card, head);

    append(card, renderKv([
      ['粒度 scope', orUnset(pack.scope)],
      ['内容指纹 contentHash', orUnset(pack.contentHash)],
      ['权限待批 permissionsPending', yesNo(pack.permissionsPending)],
      ['可用 usable', yesNo(pack.usable)],
      ['结构合法 schemaValid', yesNo(pack.schemaValid)],
      ['缺件 missing', missingText(pack.missing)],
      ['审批码 approvalCode', orUnset(pack.approvalCode)]
    ]));
    return card;
  }

  /** 列表渲染。 */
  function renderList(body) {
    var listNode = byId('role-packs-app');
    clearNode(listNode);
    if (!listNode) return;
    append(listNode, renderEnvelope(body));
    var packs = Array.isArray(body.rolePacks) ? body.rolePacks : [];
    if (packs.length === 0) {
      append(listNode, el('p', 'dim', '当前没有任何岗位包（列表为空）。'));
      return;
    }
    for (var i = 0; i < packs.length; i += 1) append(listNode, renderListRow(packs[i]));
  }

  /** 六件单件（原文只走 textContent；截断由 API 标记，前端不再截）。 */
  function renderPiece(rawPiece) {
    var piece = rawPiece && typeof rawPiece === 'object' ? rawPiece : {};
    var details = el('details', 'rp-piece');
    var bytes = typeof piece.bytes === 'number' ? String(piece.bytes) + ' B' : '字节数未定';
    var flags = piece.truncated === true ? '，已截断：只显示前 64 KiB' : '';
    append(details, el('summary', '', orUnset(piece.name) + '（' + bytes + flags + '）'));
    append(details, el('pre', 'rp-piece-text', asText(piece.text)));
    return details;
  }

  /** 六件分块。 */
  function renderPieces(body) {
    var section = el('section', 'rp-block');
    append(section, el('h3', '', '六件原文（只读）'));
    var pieces = Array.isArray(body.pieces) ? body.pieces : [];
    if (pieces.length === 0) {
      append(section, el('p', 'dim', '本次未返回六件文本（见下方 pieceError）。'));
    }
    for (var i = 0; i < pieces.length; i += 1) append(section, renderPiece(pieces[i]));
    return section;
  }

  /** 审批记录分块（九键；记录不可读显式点名）。 */
  function renderRecord(body) {
    var section = el('section', 'rp-block');
    append(section, el('h3', '', '审批记录（.synova/approvals/<roleId>.json）'));
    var record = body.record && typeof body.record === 'object' ? body.record : null;
    if (record === null) {
      var recordError = body.recordError && typeof body.recordError === 'object' ? body.recordError : null;
      append(section, el('p', 'dim', recordError === null
        ? '无审批记录（该岗位尚未批准）。'
        : '记录不可读：' + orUnset(recordError.code) + ' — ' + orUnset(recordError.reason)));
      return section;
    }
    append(section, renderKv([
      ['approvalId', orUnset(record.approvalId)],
      ['contentHash', orUnset(record.contentHash)],
      ['scope', orUnset(record.scope)],
      ['orgId', orUnset(record.orgId)],
      ['approverId', orUnset(record.approverId)],
      ['approverRole', orUnset(record.approverRole)],
      ['approvedAt', orUnset(record.approvedAt)],
      ['schemaVersion', typeof record.schemaVersion === 'number' ? String(record.schemaVersion) : '未定']
    ]));
    return section;
  }

  /** 审计历史分块（最近 50 条；只含 hash/scope/approvalId，无六件正文）。 */
  function renderAudit(body) {
    var section = el('section', 'rp-block');
    append(section, el('h3', '', '审批历史（审计，最近 50 条）'));
    var rows = Array.isArray(body.audit) ? body.audit : [];
    if (rows.length === 0) {
      append(section, el('p', 'dim', '暂无审批审计记录。'));
      return section;
    }
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i] && typeof rows[i] === 'object' ? rows[i] : {};
      var card = el('article', 'rp-audit');
      append(card, el('p', '', orUnset(row.action) + ' · ' + orUnset(row.actorId)
        + '（' + orUnset(row.actorRole) + '）· ' + orUnset(row.createdAt)));
      append(card, renderKv([
        ['旧值 oldValue', typeof row.oldValue === 'string' ? row.oldValue : '未定'],
        ['新值 newValue', typeof row.newValue === 'string' ? row.newValue : '未定']
      ]));
      append(section, card);
    }
    return section;
  }

  /** 审计链分块（`chain: null` ⇒ 显式「未校验」，不伪造 valid）。 */
  function renderChain(body) {
    var section = el('section', 'rp-block');
    append(section, el('h3', '', '审计链校验'));
    var chain = body.chain && typeof body.chain === 'object' ? body.chain : null;
    if (chain === null) {
      append(section, el('p', 'badge warn',
        '链未校验（chain: null）—— 审计服务未初始化；本页不伪造 valid:true。'));
      return section;
    }
    var verdict = chain.valid === true
      ? '链完整'
      : '链不完整（brokenAt: ' + (typeof chain.brokenAt === 'number' ? String(chain.brokenAt) : '未定') + '）';
    append(section, el('p', '', verdict
      + ' · 记录数 ' + (typeof chain.totalRecords === 'number' ? String(chain.totalRecords) : '未定')));
    return section;
  }

  /** 审批动作区（approve 带 scope ＋ expectedContentHash；revoke；改粒度＝approve+scope）。 */
  function renderActions(body) {
    var roleId = asText(body.roleId) !== '' ? asText(body.roleId) : state.roleId;
    var hash = asText(body.contentHash);
    var scopeNow = body.scope === 'content+permissions' ? 'content+permissions' : 'content';

    var section = el('section', 'rp-block');
    append(section, el('h3', '', '审批动作（改粒度 ＝ approve ＋ scope，无 scope 动作）'));
    if (hash === '') {
      append(section, el('p', 'badge warn',
        '内容指纹不可读（contentHash: null）⇒ 无法批准：批准必须绑定一个内容基线。请看下方 pieceError。'));
    }

    var form = el('div', 'rp-form');

    append(form, el('label', '', '粒度 scope'));
    var select = el('select', '');
    if (select) {
      var optionA = el('option', '', 'content（只批内容）');
      var optionB = el('option', '', 'content+permissions（内容＋权限）');
      if (optionA) optionA.value = 'content';
      if (optionB) optionB.value = 'content+permissions';
      append(select, optionA);
      append(select, optionB);
      select.value = scopeNow;
    }
    append(form, select);

    append(form, el('label', '', '内容指纹 expectedContentHash（预填本次读取的 contentHash，可改）'));
    var hashInput = el('input', '');
    if (hashInput) {
      hashInput.type = 'text';
      hashInput.value = hash;
      if (typeof hashInput.setAttribute === 'function') {
        hashInput.setAttribute('spellcheck', 'false');
        hashInput.setAttribute('autocomplete', 'off');
      }
    }
    append(form, hashInput);

    var row = el('div', 'rp-actions');
    var approveBtn = el('button', 'rp-btn primary', '批准 approve');
    if (approveBtn) {
      approveBtn.type = 'button';
      approveBtn.disabled = hash === '';
      approveBtn.addEventListener('click', function () {
        approveBtn.disabled = true;
        var value = select ? asText(select.value) : 'content';
        var expected = hashInput ? trimText(hashInput.value) : hash;
        submitAction(roleId, 'approve', { scope: value, expectedContentHash: expected })
          .then(function () { approveBtn.disabled = false; });
      });
    }
    append(row, approveBtn);

    var revokeBtn = el('button', 'rp-btn', '撤销 revoke');
    if (revokeBtn) {
      revokeBtn.type = 'button';
      revokeBtn.addEventListener('click', function () {
        var run = function () { submitAction(roleId, 'revoke', {}); };
        if (typeof window !== 'undefined' && window && typeof window.confirm === 'function') {
          if (window.confirm('撤销岗位 ' + roleId + ' 的审批记录？撤销后该岗位立即不可用（审计保留，不可回滚）。') === true) run();
        } else {
          run();
        }
      });
    }
    append(row, revokeBtn);

    var refreshBtn = el('button', 'rp-btn', '刷新详情');
    if (refreshBtn) {
      refreshBtn.type = 'button';
      refreshBtn.addEventListener('click', function () { loadDetail(roleId); });
    }
    append(row, refreshBtn);

    append(form, row);
    append(section, form);
    return section;
  }

  /** 详情渲染（状态 → 审批动作 → 六件 → 记录 → 审计 → 链；降级旗标显式）。 */
  function renderDetail(body) {
    var detailNode = byId('role-packs-detail');
    clearNode(detailNode);
    if (!detailNode) return;

    var wrap = el('div', 'rp-detail');
    append(detailNode, wrap);
    append(wrap, el('h2', '', '岗位 ' + orUnset(body.roleId)));

    if (body.degraded === true) {
      append(wrap, el('p', 'badge warn', '本条详情处于降级态（degraded: true）—— 见下方 pieceError／recordError／chain。'));
    }
    if (body.pieceError && typeof body.pieceError === 'object') {
      append(wrap, el('p', 'badge warn',
        '六件快照不可读：' + orUnset(body.pieceError.code) + ' — ' + orUnset(body.pieceError.reason)));
    }

    append(wrap, renderBlock('状态与判据', renderKv([
      ['roleId', orUnset(body.roleId)],
      ['状态 status', orUnset(body.status)],
      ['粒度 scope', orUnset(body.scope)],
      ['权限待批 permissionsPending', yesNo(body.permissionsPending)],
      ['可用 usable', yesNo(body.usable)],
      ['结构合法 schemaValid', yesNo(body.schemaValid)],
      ['内容指纹 contentHash（本次读取）', orUnset(body.contentHash)],
      ['校验指纹 validationHash', orUnset(body.validationHash)],
      ['审批 id approvalId', orUnset(body.approvalId)],
      ['缺件 missing', missingText(body.missing)],
      ['降级 degraded', yesNo(body.degraded)],
      ['组织 orgId', orUnset(body.orgId)]
    ])));

    append(wrap, renderActions(body));
    append(wrap, renderPieces(body));
    append(wrap, renderRecord(body));
    append(wrap, renderAudit(body));
    append(wrap, renderChain(body));
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 六、入口（token 门：无 token ⇒ 零请求；有 token ⇒ 恰好一次请求）
  // ════════════════════════════════════════════════════════════════════════════

  /** `?roleId=` 深链（**只读 roleId**；token 永不进 URL，见 §7 红线）。非浏览器 DOM 返回 ''。 */
  function queryRoleId() {
    try {
      if (typeof window === 'undefined' || !window || !window.location) return '';
      var search = asText(window.location.search);
      if (search === '') return '';
      var matched = /[?&]roleId=([^&]*)/.exec(search);
      if (!matched) return '';
      var raw = matched[1];
      try {
        return decodeURIComponent(raw);
      } catch (err) {
        return raw;
      }
    } catch (err) {
      return '';
    }
  }

  /** 取 sessionStorage（不可用 ⇒ null；**不读 cookie／URL／localStorage**）。 */
  function storage() {
    try {
      if (typeof sessionStorage === 'undefined' || !sessionStorage) return null;
      return sessionStorage;
    } catch (err) {
      return null;
    }
  }

  /** 粘贴的 token 写入唯一键 `synova.token`（不打印、不进 URL）。 */
  function saveTokenAndLoad() {
    var input = byId('token-input');
    var value = input ? trimText(input.value) : '';
    if (value === '') {
      notice('warn', 'E_ROLE_PACKS_UI_NOT_LOGGED_IN', '请先粘贴 token。');
      return;
    }
    var store = storage();
    if (store === null) {
      notice('err', 'E_ROLE_PACKS_UI_STORAGE',
        'sessionStorage 不可用（隐私模式？）：本页只认 sessionStorage 里的 token，不提供其它来源，故无法登录。');
      return;
    }
    try {
      store.setItem('synova.token', value);
    } catch (err) {
      notice('err', 'E_ROLE_PACKS_UI_STORAGE', 'token 未能写入 sessionStorage：' + String(err));
      return;
    }
    if (input) input.value = '';
    bootstrap();
  }

  /** 清除 token（回到未登录态，零请求）。 */
  function clearToken() {
    var store = storage();
    if (store !== null) {
      try {
        store.removeItem('synova.token');
      } catch (err) {
        notice('warn', 'E_ROLE_PACKS_UI_STORAGE', '清除 token 失败（sessionStorage 不可用）：' + String(err));
        return;
      }
    }
    notLoggedIn('已清除本标签页的 token。');
  }

  /** 绑定 token 门与页头按钮（无 DOM 环境全部跳过）。 */
  function wireTokenGate() {
    var input = byId('token-input');
    var saveBtn = byId('token-save');
    if (saveBtn) saveBtn.addEventListener('click', function () { saveTokenAndLoad(); });
    if (input) {
      input.addEventListener('keydown', function (event) {
        if (event && event.key === 'Enter') saveTokenAndLoad();
      });
    }
    var reloadBtn = byId('reload-btn');
    if (reloadBtn) reloadBtn.addEventListener('click', function () { bootstrap(); });
    var switchBtn = byId('switch-token-btn');
    if (switchBtn) switchBtn.addEventListener('click', function () { clearToken(); });
  }

  /**
   * 页面入口。**token 门在最前**：无 token ⇒ 未登录态 ＋ 零数据 API 请求（U-J1）。
   * @returns Promise<{ok:boolean, code?:string, status?:number}>
   */
  function bootstrap() {
    var api = dep();
    if (api === null) return failDependency();

    var tokenState = readTokenState(api);
    if (tokenState.ok !== true) return notLoggedIn(tokenState.message);

    setVisible(byTestId('token-gate'), false);
    setVisible(byId('not-logged-in'), false);

    var deepLink = queryRoleId();
    if (deepLink !== '') {
      state.roleId = deepLink;
      return loadDetail(deepLink);   // 恰好一次 GET /api/role-packs/:id
    }
    return loadList();               // 恰好一次 GET /api/role-packs
  }

  /**
   * 自启守卫：**只在真浏览器 DOM 下自启** —— 要求 `document.readyState` 是字符串（vm stub 不定义）
   * 且 `#role-packs-app` 存在。这样 /tmp 用 vm 载入时不会自启，显式调用 bootstrap() 的 fetch 计数才准确。
   */
  function autoStart() {
    var d = doc();
    if (!d) return;
    if (typeof d.readyState !== 'string') return;
    if (byId('role-packs-app') === null) return;
    if (typeof fetch !== 'function') {
      notice('err', 'E_ROLE_PACKS_UI_NETWORK', '宿主没有 fetch：无法访问数据 API（本页不发任何请求）。');
      return;
    }
    var start = function () {
      state.started = true;
      wireTokenGate();
      bootstrap();
    };
    if (d.readyState === 'loading' && typeof d.addEventListener === 'function') {
      d.addEventListener('DOMContentLoaded', start);
      return;
    }
    start();
  }

  /** 公开面（生产消费者＝本页自身；/tmp 自测入口见 L8）。 */
  var publicApi = {
    bootstrap: bootstrap,
    loadList: loadList,
    loadDetail: loadDetail,
    submitAction: submitAction,
    renderList: renderList,
    renderDetail: renderDetail,
    renderNotLoggedIn: notLoggedIn,
    state: state
  };

  if (typeof window !== 'undefined' && window) window.SynovaRolePacks = publicApi;

  autoStart();
})();
