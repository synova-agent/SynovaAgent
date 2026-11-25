/**
 * tests/electron/right-panel-report-sentinel.test.ts — D593 桌面右栏呈现测试
 *
 * Spec: SYNOVA-IMPL-DSH-D593-report-persistence-20260908.md §7 用例表（11-12）
 *   11. 报告 tab 恢复——fetchLatestReportId（GET /api/diagnosis/reports?limit=1 → reports[0].reportId）
 *       + app-store boot localStorage['synova:last-report-id'] 优先（D591 last-session-id 同款）
 *       + ensureReportTabId（currentReportId 在场零 fetch；缺席 → 列表兜底 → setCurrentReportId 可落定）
 *   12. 哨兵 tab——loadSentinelData（并行 GET /api/sentinel/reports + /tickets → 视图数据/降级标记）
 *       + SentinelDetailSections 渲染（正常两段列表 / 降级提示条 / 空 Empty 文案）
 *
 * 模式（沿 use-streaming-conversation.test.ts + ga-collab-ui.test.ts 先例）:
 *   mock 全局 fetch（URL 分流）+ 真实 zustand store（getState 前置 reset）+ window 桩（localStorage +
 *   electronAPI.getServerUrl）+ 组件函数直调经 test-support/render 序列化（react-dom 不在 lockfile）。
 * 文件名 .test.ts（vitest include 仅 *.test.ts；组件直调无需 JSX 语法）。
 * red→green: 实现前本文件先存在且失败（fetchLatestReportId/loadSentinelData/SentinelDetailSections/
 * readLastReportId 均不存在 + localStorage 键未接）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';

// react-markdown 仅声明在 electron-renderer/package.json（root lockfile 未装，CI vitest 仅 root npm ci）——
// 本文件经 RightPanel.tsx 导入纯函数/纯展示组件，不渲染 markdown，mock 掉该依赖即可整链可导入
// （同 tests/ga-collab-ui.test.ts 头注 WHY：root 测试上下文不装子包依赖）。
vi.mock('react-markdown', () => ({ default: () => null }));

const API_BASE = 'http://localhost:18901';

// ═══ 视图类型（与 RightPanel.tsx 导出一致；spec §5.2-E 哨兵两段形状） ═══

interface SentinelReportView {
  sentinelId: string;
  expert: string;
  summary: string;
  confidence: number;
  checkedAt: string;
}
interface SentinelTicketView {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  createdAt: string;
  status: string;
  resolvedAt?: string;
}
interface SentinelViewData {
  reports: SentinelReportView[];
  tickets: SentinelTicketView[];
  degraded: boolean;
}

// ═══ 测试基建（use-streaming-conversation.test.ts 先例） ═══

interface MemoryStorage { map: Map<string, string> }

/** window 桩：localStorage（内存 Map）+ electronAPI.getServerUrl（生产 getApiBase 路径） */
function stubWindow(): MemoryStorage {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
  vi.stubGlobal('window', {
    localStorage,
    electronAPI: { getServerUrl: () => API_BASE },
  });
  return { map };
}

/** mock 全局 fetch——URL 分流（reports/tickets/reports 列表端点各返回预设载荷） */
function stubFetch(routes: Array<{ match: (url: string) => boolean; respond: () => { status?: number; body: unknown } }>): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const route = routes.find(r => r.match(url));
    if (!route) throw new Error(`unexpected fetch: ${url}`);
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

function jsonResponse(body: unknown): { status?: number; body: unknown } {
  return { status: 200, body };
}

// ═══ 被测对象（实现后从 RightPanel/app-store 导入；red 期不存在） ═══

async function importTargets() {
  const rightPanel = await import('../../electron-renderer/src/components/RightPanel');
  const appStore = await import('../../electron-renderer/src/stores/app-store');
  return { rightPanel, appStore };
}

// ═══ tests ═══

describe('D593: 桌面右栏——报告 tab 恢复 + 哨兵 tab 真数据（spec §7 用例 11-12）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('用例 11a: fetchLatestReportId——列表 API 返回最近 reportId（正常路径）', async () => {
    const storage = stubWindow();
    storage.map.set('synova.dev-identity', JSON.stringify({ role: 'ga', orgId: 'org-x', userId: 'u1' }));
    stubFetch([
      {
        match: url => url.includes('/api/diagnosis/reports'),
        respond: () => jsonResponse({
          ok: true, total: 1,
          reports: [{ reportId: 'rpt_d593_latest', teamId: 'org-x', completedAt: '2026-09-08T00:00:00Z', summary: 's', onePagerAvailable: false }],
        }),
      },
    ]);
    const { rightPanel } = await importTargets();
    const id = await rightPanel.fetchLatestReportId();
    expect(id).toBe('rpt_d593_latest');
  });

  it('用例 11b: fetchLatestReportId 降级——!ok / 空列表 / 网络异常 → null（不抛）', async () => {
    stubWindow();
    stubFetch([
      { match: url => url.includes('/api/diagnosis/reports'), respond: () => ({ status: 503, body: { ok: false } }) },
    ]);
    const { rightPanel } = await importTargets();
    expect(await rightPanel.fetchLatestReportId()).toBeNull();

    vi.resetModules();
    stubWindow();
    stubFetch([
      { match: url => url.includes('/api/diagnosis/reports'), respond: () => jsonResponse({ ok: true, total: 0, reports: [] }) },
    ]);
    const mod2 = await importTargets();
    expect(await mod2.rightPanel.fetchLatestReportId()).toBeNull();

    vi.resetModules();
    stubWindow();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    const mod3 = await importTargets();
    expect(await mod3.rightPanel.fetchLatestReportId()).toBeNull();
  });

  it('用例 11c: localStorage 优先——boot 读 synova:last-report-id 落定 currentReportId；setCurrentReportId 回写', async () => {
    stubWindow().map.set('synova:last-report-id', 'rpt_saved_boot');
    const { appStore } = await importTargets();
    // boot：模块装载时读回（D591 last-session-id 同款）
    expect(appStore.useAppStore.getState().currentReportId).toBe('rpt_saved_boot');
    // 写路径：setCurrentReportId 同时落 localStorage
    appStore.useAppStore.getState().setCurrentReportId('rpt_new_write');
    expect(appStore.useAppStore.getState().currentReportId).toBe('rpt_new_write');
    expect(window.localStorage.getItem('synova:last-report-id')).toBe('rpt_new_write');
  });

  it('用例 11d: ensureReportTabId——currentReportId 在场零 fetch；缺席 → 列表兜底返回最近 id', async () => {
    stubWindow();
    const { calls } = stubFetch([
      {
        match: url => url.includes('/api/diagnosis/reports'),
        respond: () => jsonResponse({
          ok: true, total: 1,
          reports: [{ reportId: 'rpt_from_list', teamId: 'org-x', completedAt: '2026-09-08T00:00:00Z', summary: 's', onePagerAvailable: false }],
        }),
      },
    ]);
    const { rightPanel } = await importTargets();

    // 在场：直接复用，零 fetch
    const kept = await rightPanel.ensureReportTabId('rpt_existing');
    expect(kept).toBe('rpt_existing');
    expect(calls.length).toBe(0);

    // 缺席：列表兜底（组件 effect 据此 setCurrentReportId）
    const restored = await rightPanel.ensureReportTabId(null);
    expect(restored).toBe('rpt_from_list');
    expect(calls.length).toBe(1);
  });

  it('用例 12a: loadSentinelData——并行 GET reports+tickets → 视图数据（正常路径 degraded=false）', async () => {
    stubWindow();
    const { calls } = stubFetch([
      {
        match: url => url.includes('/api/sentinel/reports'),
        respond: () => jsonResponse({
          ok: true,
          reports: [
            { sentinelId: 'cash-flow', expert: 'fundamental-efficiency', summary: '现金流承压', confidence: 0.8, checkedAt: '2026-09-08T01:00:00Z' },
            { sentinelId: 'revenue', expert: 'customer-growth', summary: '收入集中度上升', confidence: 0.7, checkedAt: '2026-09-08T02:00:00Z' },
          ],
        }),
      },
      {
        match: url => url.includes('/api/sentinel/tickets'),
        respond: () => jsonResponse({
          ok: true, source: 'table',
          tickets: [
            { id: 't1', title: '现金流预警工单', severity: 'critical', createdAt: '2026-09-08T01:05:00Z', status: 'open' },
            { id: 't2', title: '客户集中工单', severity: 'warning', createdAt: '2026-09-08T02:05:00Z', status: 'acknowledged' },
          ],
        }),
      },
    ]);
    const { rightPanel } = await importTargets();
    const data = await rightPanel.loadSentinelData();
    expect(data.degraded).toBe(false);
    expect(data.reports.length).toBe(2);
    expect(data.tickets.length).toBe(2);
    expect(data.reports[0].sentinelId).toBe('cash-flow');
    expect(data.tickets[0].title).toBe('现金流预警工单');
    // 两端点都真实请求
    expect(calls.some(u => u.includes('/api/sentinel/reports'))).toBe(true);
    expect(calls.some(u => u.includes('/api/sentinel/tickets'))).toBe(true);
  });

  it('用例 12b: loadSentinelData 降级——请求失败/!ok → degraded=true + 空数组（不抛，铁律 24/31）', async () => {
    stubWindow();
    stubFetch([
      { match: url => url.includes('/api/sentinel/reports'), respond: () => ({ status: 500, body: { ok: false } }) },
      { match: url => url.includes('/api/sentinel/tickets'), respond: () => jsonResponse({ ok: true, source: 'table', tickets: [] }) },
    ]);
    const { rightPanel } = await importTargets();
    const data = await rightPanel.loadSentinelData();
    expect(data.degraded).toBe(true);
    expect(data.reports).toEqual([]);
    expect(data.tickets).toEqual([]);
  });

  it('用例 12c: SentinelDetailSections 渲染（正常）——两段列表：专家报告 + 工单（条数/标题断言）', async () => {
    stubWindow();
    const { rightPanel } = await importTargets();
    const reports: SentinelReportView[] = [
      { sentinelId: 'cash-flow', expert: 'fundamental-efficiency', summary: '现金流承压', confidence: 0.8, checkedAt: '2026-09-08T01:00:00Z' },
      { sentinelId: 'revenue', expert: 'customer-growth', summary: '收入集中度上升', confidence: 0.7, checkedAt: '2026-09-08T02:00:00Z' },
    ];
    const tickets: SentinelTicketView[] = [
      { id: 't1', title: '现金流预警工单', severity: 'critical', createdAt: '2026-09-08T01:05:00Z', status: 'open' },
      { id: 't2', title: '客户集中工单', severity: 'warning', createdAt: '2026-09-08T02:05:00Z', status: 'acknowledged' },
      { id: 't3', title: '人才流失工单', severity: 'info', createdAt: '2026-09-08T03:05:00Z', status: 'resolved' },
    ];
    const html = renderToStaticMarkup(
      rightPanel.SentinelDetailSections({ reports, tickets, degraded: false }),
    );
    // 段标题
    expect(html).toContain('专家报告');
    expect(html).toContain('工单');
    // 报告条目内容透传
    expect(html).toContain('cash-flow');
    expect(html).toContain('fundamental-efficiency');
    expect(html).toContain('现金流承压');
    expect(html).toContain('收入集中度上升');
    // 工单条目内容透传 + severity 色点
    expect(html).toContain('现金流预警工单');
    expect(html).toContain('客户集中工单');
    expect(html).toContain('人才流失工单');
    expect(html).toContain('critical');
    // 条数：报告 2 条、工单 3 条（渲染计数标记）
    expect((html.match(/data-sentinel-report-item/g) ?? []).length).toBe(2);
    expect((html.match(/data-sentinel-ticket-item/g) ?? []).length).toBe(3);
  });

  it('用例 12d: SentinelDetailSections 降级——degraded=true → 降级提示条（诚实，铁律 24/31）', async () => {
    stubWindow();
    const { rightPanel } = await importTargets();
    const html = renderToStaticMarkup(
      rightPanel.SentinelDetailSections({ reports: [], tickets: [], degraded: true }),
    );
    expect(html).toContain('预警数据暂时读不到');
  });

  it('用例 12e: SentinelDetailSections 空——Empty 文案（暂无预警报告/暂无预警工单）', async () => {
    stubWindow();
    const { rightPanel } = await importTargets();
    const html = renderToStaticMarkup(
      rightPanel.SentinelDetailSections({ reports: [], tickets: [], degraded: false }),
    );
    expect(html).toContain('暂无预警报告');
    expect(html).toContain('暂无预警工单');
    expect(html).not.toContain('data-sentinel-report-item');
    expect(html).not.toContain('data-sentinel-ticket-item');
  });
});
