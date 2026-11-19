/**
 * tests/dsh-ui/dsh-wiring.test.ts — #1429 I-2 源码接线锁（入口→分派→容器→store→api）
 *
 * 摘掉任一接头必须变红（DEV DOC v1 §6／§7.6）；并含 v2 变更 5.6 的静态否定断言：
 * token 不落盘、不进日志；UI 不触 DSH 内部面。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const renderer = (path: string): string => readFileSync(resolve(root, 'electron-renderer/src', path), 'utf8');
const codeOnly = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** I-2 新增/修改的 renderer 写集（静态否定断言范围） */
const DSH_FILES = [
  'lib/auth-session.ts',
  'lib/dsh-run-api.ts',
  'stores/dsh-run-store.ts',
  'components/DshRunPanel.tsx',
  'components/DshRunContainer.tsx',
];

describe('#1429 LeftPanel→App→Container→store→api WIRE CHECK', () => {
  it('LeftPanel 新增 DSH 会话入口：直接 setActiveView(dsh)，不按角色隐藏', () => {
    const source = renderer('components/LeftPanel.tsx');
    expect(source).toMatch(/data-cap="nav-dsh"[\s\S]{0,300}setActiveView\('dsh'\)/);
    expect(source).toContain('DSH 会话');
    const button = source.match(/<button className="cap-item" data-cap="nav-dsh"[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(button).not.toBe('');
    expect(button).not.toContain('userRole');
    expect(button).not.toContain('canAccessCap');
  });

  it('ActiveView 含 dsh；App 双视图分派，scan/dsh 各自唯一挂载', () => {
    const store = renderer('stores/app-store.ts');
    const app = renderer('App.tsx');
    expect(store).toContain("export type ActiveView = 'chat' | 'dashboard' | 'settings' | 'scan' | 'dsh';");
    expect(app).toContain("import DshRunContainer from './components/DshRunContainer';");
    expect(app).toContain('const activeView = useAppStore((s) => s.activeView);');
    expect(app.match(/<ScanContainer \/>/g)).toHaveLength(1);
    expect(app.match(/<DshRunContainer \/>/g)).toHaveLength(1);
    expect(app).toContain("activeView === 'scan'");
    expect(app).toContain("activeView === 'dsh'");
  });

  it('Container 挂载同步认证态，并把 submit/cancel/close/reconnect 接到纯面板', () => {
    const source = renderer('components/DshRunContainer.tsx');
    expect(source).toContain("import { useDshRunStore } from '../stores/dsh-run-store';");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*state\.syncAuth\(\);\s*\}, \[state\.syncAuth\]\);/);
    expect(source).toContain('void submit()');
    expect(source).toContain('void cancel()');
    expect(source).toContain('void close()');
    expect(source).toContain('onReconnect={reconnect}');
    expect(source).toContain('<DshRunPanel');
  });

  it('store 真实调用四调用＋事件源；seq 去重；取消以 run.cancelled 为准（不以 POST 返回）', () => {
    const source = renderer('stores/dsh-run-store.ts');
    expect(source).toMatch(/await dependencies\.startRun\(/);
    expect(source).toMatch(/dependencies\.openRunEvents\(/);
    expect(source).toMatch(/await dependencies\.cancelRun\(/);
    expect(source).toMatch(/await dependencies\.closeSession\(/);
    expect(source).toContain('if (seen.has(event.seq)) return;');
    expect(source).toContain("case 'run.cancelled':");
    expect(source).toContain('以 SSE run.cancelled 为准');
    // 取消 POST 成功不得直接 set 成 cancelled（状态只由事件推进）
    expect(source).not.toMatch(/cancelRun\([^)]*\)[\s\S]{0,200}status: 'cancelled'/);
  });

  it('api 使用真实四个公开端点与 Bearer/last-event-id，不用 EventSource', () => {
    const source = renderer('lib/dsh-run-api.ts');
    expect(source).toMatch(/\/api\/dsh\/runs`/);
    expect(source).toContain('/api/dsh/runs/${encodeURIComponent(runId)}/events');
    expect(source).toContain('/api/dsh/runs/${encodeURIComponent(runId)}/cancel');
    expect(source).toContain('/api/dsh/sessions/${encodeURIComponent(sessionId)}/close');
    expect(source).toContain('...authHeader()');
    expect(source).toContain("headers['last-event-id'] = String(lastEventId);");
    expect(codeOnly(source)).not.toMatch(/\bnew EventSource\(/);
  });

  it('面板渲染只消费白名单事件（text/tool），未知事件不整段塞进 UI', () => {
    const panel = renderer('components/DshRunPanel.tsx');
    expect(panel).toContain("item.kind === 'tool'");
    expect(panel).toContain('{item.text}');
    expect(panel).toContain('dsh-tool-title');
    const store = renderer('stores/dsh-run-store.ts');
    expect(store).toContain('白名单投影');
  });
});

describe('#1429 面板受控与 token 不落盘（B7 静态否定断言）', () => {
  it('DshRunPanel 不含任何 hook（受控纯展示）：输入与按钮全部来自 props', () => {
    const source = codeOnly(renderer('components/DshRunPanel.tsx'));
    expect(source).not.toMatch(/\buseState\b|\buseEffect\b|\buseRef\b|\buseMemo\b|\buseCallback\b/);
    expect(source).toContain('value={input}');
    expect(source).toContain('onClick={onSubmit}');
    expect(source).toContain('onClick={onCancel}');
  });

  it('I-2 写集源码不出现 localStorage/sessionStorage/写文件 API/token 进日志/DSH 内部面', () => {
    for (const file of DSH_FILES) {
      const source = codeOnly(renderer(file));
      expect(source, `${file} 不得读写浏览器存储`).not.toMatch(/localStorage|sessionStorage|indexedDB/);
      expect(source, `${file} 不得写文件`).not.toMatch(/writeFile|appendFile|node:fs|require\(['"]fs/);
      expect(source, `${file} 不得把 token 写日志`).not.toMatch(/console\.\w+\([^)]*\btoken\b/i);
      expect(source, `${file} 不得触碰 DSH 内部面`).not.toMatch(/sidecar|\bacp\b|pinned-version|SYNOVA_DSH/i);
    }
  });
});
