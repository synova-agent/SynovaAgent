/**
 * tests/electron/notification-center.test.ts — D602 通知链路测试
 *
 * Spec: SYNOVA-IMPL-DSH-D602-interactive-cards-preload-20260908.md §7 用例 6-11（red→green）
 *   6. pushLocalNotification 契约: 字段补全（id/createdAt/severity 缺省）+ FIFO 上限 20 + dismiss 移除
 *   7. 副作用: electronAPI.showNotification stub 被调用且 title/body 透传；缺失 → 跳过不抛（铁律 24）；
 *      系统通知抛异常 → 本地通知仍入栈（降级不静默）
 *   8. 哨兵数据源: mock GET /api/sentinel/tickets（source:'table', 2 open）→ 映射正确 + openCount=2
 *   9. 降级: memory-fallback+degraded → 数据照常 + degraded 提示；tickets 非数组 → error；
 *      畸形项跳过（形状守卫，铁律 38）
 *   10. actOnTicket: confirm→POST /api/sentinel/tickets/t1/transition body {to:'acknowledged'}；
 *       dismiss→{to:'dismissed'}；409/404→{ok:false,error} 不抛；成功后本地已读
 *   11. NotificationCenter 纯组件静态渲染: 工单动作按钮（确认收到/标记为误报）+ 本地通知项 +
 *       error banner 文案（D593 SentinelDetailSections 纯组件直调先例）
 *
 * 模式（沿 right-panel-report-sentinel.test.ts 先例）: mock 全局 fetch（URL 分流 + 请求捕获）+
 * 真实 zustand store（getState 前置 reset）+ window 桩（localStorage/electronAPI）+
 * renderToStaticMarkup（test-support 零依赖序列化桥——NotificationCenter 无 react-markdown 依赖免 mock）。
 * red→green: 实现前本文件先存在且失败（pushLocalNotification/loadTicketNotifications/actOnTicket/
 * NotifErrorBanner 等均不存在——D593 同款 red 语义）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';

const API_BASE = 'http://localhost:18790';

// ═══ 测试基建（right-panel-report-sentinel.test.ts 先例） ═══

interface MemoryStorage { map: Map<string, string> }

interface RecordedRequest { url: string; method?: string; body?: string }

/** window 桩: localStorage（内存 Map）+ electronAPI（getServerUrl + 可选 showNotification） */
function stubWindow(electronAPI?: Record<string, unknown>): MemoryStorage {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
  vi.stubGlobal('window', {
    localStorage,
    electronAPI: electronAPI ?? { getServerUrl: () => API_BASE },
  });
  return { map };
}

/** window 桩（无 electronAPI——非 Electron 降级路径） */
function stubWindowWithoutElectronAPI(): MemoryStorage {
  const map = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => map.clear(),
    },
  });
  return { map };
}

interface FetchRoute { match: (url: string, method?: string) => boolean; respond: () => { status?: number; body: unknown } }

/** mock 全局 fetch——URL+方法分流，记录全部请求（url/method/body）供接线断言 */
function stubFetch(routes: FetchRoute[]): { calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: { method?: string; body?: string }) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : undefined);
    calls.push({ url, method, body: init?.body });
    const route = routes.find((r) => r.match(url, method));
    if (!route) throw new Error(`unexpected fetch: ${method ?? 'GET'} ${url}`);
    const { status = 200, body } = route.respond();
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }));
  return { calls };
}

// ═══ 被测对象（实现后从 app-store/useNotifications/NotificationCenter 导入；red 期不存在） ═══

interface Imports {
  appStore: typeof import('../../electron-renderer/src/stores/app-store');
  useNotifications: typeof import('../../electron-renderer/src/hooks/useNotifications');
  notificationCenter: typeof import('../../electron-renderer/src/components/NotificationCenter');
}

async function importTargets(): Promise<Imports> {
  const appStore = await import('../../electron-renderer/src/stores/app-store');
  const useNotifications = await import('../../electron-renderer/src/hooks/useNotifications');
  const notificationCenter = await import('../../electron-renderer/src/components/NotificationCenter');
  return { appStore, useNotifications, notificationCenter };
}

/** sentinel tickets 端点标准载荷（D580 SentinelTicketView 形状，sentinel-service.ts:76-85） */
function ticketsPayload(tickets: unknown[], extra?: { source?: string; degraded?: boolean }): { ok: boolean; source: string; degraded?: boolean; tickets: unknown[] } {
  return {
    ok: true,
    source: extra?.source ?? 'table',
    degraded: extra?.degraded,
    tickets,
  };
}

// ═══ tests ═══

describe('D602: 通知链路（spec §7 用例 6-11）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // ── 用例 6: pushLocalNotification 契约 ──

  it('用例 6a: pushLocalNotification 字段补全（id/createdAt 生成、severity 缺省 info）+ 列表增量', async () => {
    stubWindow();
    const { appStore } = await importTargets();
    const s = appStore.useAppStore.getState();
    expect(s.localNotifications).toEqual([]);

    s.pushLocalNotification({ title: '对话流错误', body: '模型超时' });
    const st = appStore.useAppStore.getState();
    expect(st.localNotifications.length).toBe(1);
    const item = st.localNotifications[0];
    expect(item.id).toBeTruthy();
    expect(item.id).toMatch(/^local-/);
    expect(item.createdAt).toBeTruthy();
    expect(item.severity).toBe('info');
    expect(item.title).toBe('对话流错误');
    expect(item.body).toBe('模型超时');
  });

  it('用例 6b: 显式 id/severity/createdAt 透传 + newest-first 排序', async () => {
    stubWindow();
    const { appStore } = await importTargets();
    const s = appStore.useAppStore.getState();
    s.pushLocalNotification({ title: 'first', body: 'b1' });
    s.pushLocalNotification({ title: 'second', body: 'b2', severity: 'warning', id: 'fixed-id', createdAt: '2026-09-09T00:00:00Z' });
    const st = appStore.useAppStore.getState();
    expect(st.localNotifications[0].id).toBe('fixed-id');
    expect(st.localNotifications[0].severity).toBe('warning');
    expect(st.localNotifications[0].createdAt).toBe('2026-09-09T00:00:00Z');
    expect(st.localNotifications[1].title).toBe('first');
  });

  it('用例 6c: FIFO 上限 20——第 21 条推入淘汰最旧', async () => {
    stubWindow();
    const { appStore } = await importTargets();
    const s = appStore.useAppStore.getState();
    for (let i = 0; i < 25; i++) {
      s.pushLocalNotification({ title: `n${i}`, body: 'x' });
    }
    const st = appStore.useAppStore.getState();
    expect(st.localNotifications.length).toBe(20);
    // newest-first: 最新在头部，最旧（n0~n4）被 FIFO 淘汰
    expect(st.localNotifications[0].title).toBe('n24');
    expect(st.localNotifications.some((n) => n.title === 'n0')).toBe(false);
    expect(st.localNotifications.some((n) => n.title === 'n4')).toBe(false);
    expect(st.localNotifications.some((n) => n.title === 'n5')).toBe(true);
  });

  it('用例 6d: dismissLocalNotification 按 id 移除', async () => {
    stubWindow();
    const { appStore } = await importTargets();
    const s = appStore.useAppStore.getState();
    s.pushLocalNotification({ title: 'a', body: 'x' });
    s.pushLocalNotification({ title: 'b', body: 'y' });
    const st = appStore.useAppStore.getState();
    const targetId = st.localNotifications[0].id;
    appStore.useAppStore.getState().dismissLocalNotification(targetId);
    const after = appStore.useAppStore.getState();
    expect(after.localNotifications.length).toBe(1);
    expect(after.localNotifications.some((n) => n.id === targetId)).toBe(false);
  });

  // ── 用例 7: pushLocalNotification 副作用 ──

  it('用例 7a: electronAPI.showNotification 在场 → 被调用且 title/body/id 透传', async () => {
    const showNotification = vi.fn();
    stubWindow({ getServerUrl: () => API_BASE, showNotification });
    const { appStore } = await importTargets();
    appStore.useAppStore.getState().pushLocalNotification({ title: 'T', body: 'B' });
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, body, id] = showNotification.mock.calls[0] as unknown[];
    expect(title).toBe('T');
    expect(body).toBe('B');
    expect(typeof id).toBe('string');
  });

  it('用例 7b: electronAPI 缺失 → 跳过系统通知不抛（降级铁律 24）', async () => {
    stubWindowWithoutElectronAPI();
    const { appStore } = await importTargets();
    expect(() => appStore.useAppStore.getState().pushLocalNotification({ title: 'T', body: 'B' })).not.toThrow();
    expect(appStore.useAppStore.getState().localNotifications.length).toBe(1);
  });

  it('用例 7c: 系统通知抛异常 → warn 降级，本地通知仍入栈（不抛，铁律 24/31）', async () => {
    const showNotification = vi.fn(() => { throw new Error('Notification not permitted'); });
    stubWindow({ getServerUrl: () => API_BASE, showNotification });
    const { appStore } = await importTargets();
    expect(() => appStore.useAppStore.getState().pushLocalNotification({ title: 'T', body: 'B' })).not.toThrow();
    expect(appStore.useAppStore.getState().localNotifications.length).toBe(1);
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  // ── 用例 8: 哨兵数据源 ──

  it('用例 8: loadTicketNotifications——GET /api/sentinel/tickets 映射正确 + openCount=2（接线真实端点）', async () => {
    stubWindow();
    const { calls } = stubFetch([
      {
        match: (url) => url.includes('/api/sentinel/tickets'),
        respond: () => ({ status: 200, body: ticketsPayload([
          { id: 't1', title: '现金流预警工单', severity: 'critical', createdAt: '2026-09-09T01:05:00Z', status: 'open' },
          { id: 't2', title: '客户集中工单', severity: 'warning', createdAt: '2026-09-09T02:05:00Z', status: 'open' },
        ]) }),
      },
    ]);
    const { useNotifications } = await importTargets();
    const result = await useNotifications.loadTicketNotifications();
    // 真实端点 URL（接线断言）
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(`${API_BASE}/api/sentinel/tickets`);
    // 映射正确
    expect(result.error).toBeNull();
    expect(result.degraded).toBe(false);
    expect(result.notifications.length).toBe(2);
    const first = result.notifications[0];
    expect(first.id).toBe('t1');
    expect(first.title).toBe('现金流预警工单');
    expect(first.severity).toBe('critical');
    expect(first.createdAt).toBe('2026-09-09T01:05:00Z');
    expect(first.ticketStatus).toBe('open');
    expect(first.read).toBe(false);
    expect(typeof first.body).toBe('string');
    // alertCount 同源: open 工单数
    expect(result.openCount).toBe(2);
  });

  it('用例 8b: 本地已读集合——localStorage synova:read-tickets 命中 → read=true', async () => {
    const storage = stubWindow();
    storage.map.set('synova:read-tickets', JSON.stringify(['t1']));
    stubFetch([
      {
        match: (url) => url.includes('/api/sentinel/tickets'),
        respond: () => ({ status: 200, body: ticketsPayload([
          { id: 't1', title: '已读工单', severity: 'info', createdAt: '2026-09-09T01:05:00Z', status: 'open' },
          { id: 't2', title: '未读工单', severity: 'info', createdAt: '2026-09-09T02:05:00Z', status: 'open' },
        ]) }),
      },
    ]);
    const { useNotifications } = await importTargets();
    const result = await useNotifications.loadTicketNotifications();
    expect(result.notifications[0].read).toBe(true);
    expect(result.notifications[1].read).toBe(false);
  });

  // ── 用例 9: 数据源降级 ──

  it('用例 9a: memory-fallback + degraded:true → 数据照常装载 + degraded 提示（非错误）', async () => {
    stubWindow();
    stubFetch([
      {
        match: (url) => url.includes('/api/sentinel/tickets'),
        respond: () => ({ status: 200, body: ticketsPayload(
          [{ id: 'm1', title: '内存兜底工单', severity: 'warning', createdAt: '2026-09-09T03:00:00Z', status: 'open' }],
          { source: 'memory-fallback', degraded: true },
        ) }),
      },
    ]);
    const { useNotifications } = await importTargets();
    const result = await useNotifications.loadTicketNotifications();
    expect(result.degraded).toBe(true);
    expect(result.error).toBeNull();
    expect(result.notifications.length).toBe(1);
    expect(result.notifications[0].title).toBe('内存兜底工单');
  });

  it('用例 9b: tickets 非数组（形状非法）→ error + degraded + 空列表（不抛）', async () => {
    stubWindow();
    stubFetch([
      { match: (url) => url.includes('/api/sentinel/tickets'), respond: () => ({ status: 200, body: { ok: true, source: 'table', tickets: 'not-an-array' } }) },
    ]);
    const { useNotifications } = await importTargets();
    const result = await useNotifications.loadTicketNotifications();
    expect(result.degraded).toBe(true);
    expect(result.error).toBeTruthy();
    expect(result.notifications).toEqual([]);
    expect(result.openCount).toBe(0);
  });

  it('用例 9c: 畸形项跳过 + 合法项保留；HTTP 500 → error（铁律 24 不静默）', async () => {
    stubWindow();
    stubFetch([
      { match: (url) => url.includes('/api/sentinel/tickets'), respond: () => ({ status: 200, body: ticketsPayload([
        { title: '缺 id 的畸形项', severity: 'info', createdAt: '2026-09-09T00:00:00Z', status: 'open' },
        'not-an-object',
        { id: 'ok1', title: '合法工单', severity: 'info', createdAt: '2026-09-09T00:00:00Z', status: 'open' },
      ]) }) },
    ]);
    const { useNotifications } = await importTargets();
    const ok = await useNotifications.loadTicketNotifications();
    expect(ok.notifications.length).toBe(1);
    expect(ok.notifications[0].id).toBe('ok1');
    expect(ok.error).toBeNull();

    vi.resetModules();
    stubWindow();
    stubFetch([
      { match: (url) => url.includes('/api/sentinel/tickets'), respond: () => ({ status: 500, body: { ok: false } }) },
    ]);
    const mod2 = await importTargets();
    const bad = await mod2.useNotifications.loadTicketNotifications();
    expect(bad.degraded).toBe(true);
    expect(bad.error).toBeTruthy();
    expect(bad.notifications).toEqual([]);
  });

  // ── 用例 10: actOnTicket ──

  it('用例 10a: confirm → POST /api/sentinel/tickets/t1/transition body {to:"acknowledged"} + 本地已读', async () => {
    const storage = stubWindow();
    const { calls } = stubFetch([
      {
        match: (url, method) => url.includes('/api/sentinel/tickets/t1/transition'),
        respond: () => ({ status: 200, body: { ok: true, ticket: { id: 't1', status: 'acknowledged' } } }),
      },
    ]);
    const { useNotifications } = await importTargets();
    const result = await useNotifications.actOnTicket('t1', 'confirm');
    expect(result).toEqual({ ok: true });
    // 真实端点 + 真实状态机 body（spec §5.3 决策 4——tickets/:id/transition 非 alerts action）
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(`${API_BASE}/api/sentinel/tickets/t1/transition`);
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ to: 'acknowledged' });
    // 200 后本地已读（spec §5.1③）
    const readRaw = storage.map.get('synova:read-tickets');
    expect(readRaw).toBeTruthy();
    expect(JSON.parse(readRaw ?? '[]')).toContain('t1');
  });

  it('用例 10b: dismiss → body {to:"dismissed"}', async () => {
    stubWindow();
    const { calls } = stubFetch([
      { match: (url) => url.includes('/transition'), respond: () => ({ status: 200, body: { ok: true, ticket: { id: 't2', status: 'dismissed' } } }) },
    ]);
    const { useNotifications } = await importTargets();
    const result = await useNotifications.actOnTicket('t2', 'dismiss');
    expect(result).toEqual({ ok: true });
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ to: 'dismissed' });
  });

  it('用例 10c: 409/404/网络异常 → {ok:false,error} 不抛（铁律 24）', async () => {
    stubWindow();
    stubFetch([
      { match: (url) => url.includes('t-conflict'), respond: () => ({ status: 409, body: { ok: false, error: 'ILLEGAL_TRANSITION' } }) },
      { match: (url) => url.includes('t-missing'), respond: () => ({ status: 404, body: { ok: false, error: 'TICKET_NOT_FOUND' } }) },
    ]);
    const { useNotifications } = await importTargets();
    const conflict = await useNotifications.actOnTicket('t-conflict', 'confirm');
    expect(conflict.ok).toBe(false);
    expect(conflict.error).toBe('ILLEGAL_TRANSITION');
    const missing = await useNotifications.actOnTicket('t-missing', 'dismiss');
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe('TICKET_NOT_FOUND');

    vi.resetModules();
    stubWindow();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    const mod2 = await importTargets();
    const netErr = await mod2.useNotifications.actOnTicket('t-x', 'confirm');
    expect(netErr.ok).toBe(false);
    expect(netErr.error).toBe('network down');
  });

  // ── 用例 11: NotificationCenter 纯组件静态渲染 ──

  it('用例 11a: TicketActions——open 渲染"确认收到"/"标记为误报"按钮；非 open 不渲染；失败反馈可见', async () => {
    stubWindow();
    const { notificationCenter } = await importTargets();
    const noop = () => {};
    const openHtml = renderToStaticMarkup(
      notificationCenter.TicketActions({ status: 'open', onAct: noop }),
    );
    expect(openHtml).toContain('确认收到');
    expect(openHtml).toContain('标记为误报');
    expect(openHtml).toContain('data-ticket-action="confirm"');
    expect(openHtml).toContain('data-ticket-action="dismiss"');

    const doneHtml = renderToStaticMarkup(
      notificationCenter.TicketActions({ status: 'acknowledged', onAct: noop }),
    );
    expect(doneHtml).not.toContain('确认收到');

    const errHtml = renderToStaticMarkup(
      notificationCenter.TicketActions({ status: 'open', feedback: { state: 'error', message: 'ILLEGAL_TRANSITION' }, onAct: noop }),
    );
    expect(errHtml).toContain('ILLEGAL_TRANSITION');
  });

  it('用例 11b: LocalNotificationItem——错误通知标题+正文渲染 + 关闭按钮', async () => {
    stubWindow();
    const { notificationCenter } = await importTargets();
    const html = renderToStaticMarkup(
      notificationCenter.LocalNotificationItem(
        { n: { id: 'l1', title: '对话流错误', body: '诊断过程中发生错误', severity: 'warning', createdAt: '2026-09-09T00:00:00Z' }, onDismiss: () => {} },
      ),
    );
    expect(html).toContain('对话流错误');
    expect(html).toContain('诊断过程中发生错误');
    expect(html).toContain('data-local-dismiss="l1"');
    expect(html).toContain('data-local-notification="l1"');
  });

  it('用例 11c: NotifErrorBanner——客户说法「暂时读不到通知」＋原文只进技术详情（铁律 31 消灭假空态）', async () => {
    stubWindow();
    const { notificationCenter } = await importTargets();
    const html = renderToStaticMarkup(notificationCenter.NotifErrorBanner({ error: '获取通知失败 (HTTP 500)' }));
    // B3（T4b）：主文案是客户说法，传输层原文不得上默认面
    expect(html).toContain('暂时读不到通知');
    expect(html).not.toContain('通知获取失败：');
    // 原文不丢：进「技术详情」折叠层（默认收起，仍可断言在 DOM 上）
    expect(html).toContain('技术详情');
    expect(html).toContain('获取通知失败 (HTTP 500)');
  });
});
