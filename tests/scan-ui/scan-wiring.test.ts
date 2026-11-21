import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const renderer = (path: string): string => readFileSync(resolve(root, 'electron-renderer/src', path), 'utf8');
const codeOnly = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('#1413 真实导航与主栏分派 WIRE CHECK', () => {
  it('LeftPanel 企业扫描入口直接 setActiveView(scan)，对话可恢复 chat，且不按角色隐藏', () => {
    const source = renderer('components/LeftPanel.tsx');
    expect(source).toContain("const setActiveView = useAppStore((s) => s.setActiveView);");
    expect(source).toMatch(/data-cap="nav-scan"[\s\S]{0,500}onClick=\{\(\) => setActiveView\('scan'\)\}/);
    expect(source).toMatch(/<span className="cap-label">企业扫描<\/span>/);
    expect(source).toMatch(/data-cap="nav-conv"[\s\S]{0,500}setActiveView\('chat'\)/);
    const scanButton = source.match(/<button className="cap-item" data-cap="nav-scan"[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(scanButton).not.toContain('userRole');
    expect(scanButton).not.toContain('canAccessCap');
  });

  it('ActiveView 包含 scan，App 双视图分派且 scan 视图挂载唯一 ScanContainer', () => {
    const store = renderer('stores/app-store.ts');
    const app = renderer('App.tsx');
    expect(store).toContain("export type ActiveView = 'chat' | 'dashboard' | 'settings' | 'scan' | 'dsh';");
    expect(app).toContain("import ScanContainer from './components/ScanContainer';");
    expect(app).toContain('const activeView = useAppStore((s) => s.activeView);');
    expect(app).toContain("activeView === 'scan'");
    // #1429 I-2：App 新增 dsh 视图分派后，scan 分支必须保持唯一挂载（双视图互不吞并）
    expect(app.match(/<ScanContainer \/>/g)).toHaveLength(1);
    expect(app.match(/<DshRunContainer \/>/g)).toHaveLength(1);
    expect(app).toContain("activeView === 'dsh'");
  });
});

describe('#1413 Container→store→loader WIRE CHECK', () => {
  it('Container 挂载 open，并把 start/retry/newScan 接到纯面板', () => {
    const source = renderer('components/ScanContainer.tsx');
    expect(source).toContain("import { useScanStore } from '../stores/scan-store';");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*void open\(\);?\s*\}, \[open\]\);/);
    expect(source).toContain('onStart={() => { void start(); }}');
    expect(source).toContain('onRetryList={() => { void retryList(); }}');
    expect(source).toContain('onRetryScan={() => { void retryScan(); }}');
    expect(source).toContain('onNewScan={newScan}');
    expect(source).toContain('<ScanPanel');
  });

  it('store 实际调用清单、POST 与 GET 恢复 loader', () => {
    const source = renderer('stores/scan-store.ts');
    expect(source).toMatch(/await dependencies\.loadManifests\(\)/);
    expect(source).toMatch(/await dependencies\.startScan\(selected, clientRequestId\)/);
    expect(source).toMatch(/await dependencies\.getScan\(runId\)/);
    expect(source).toContain('if (current.requestPromise) return current.requestPromise;');
    expect(source).toContain('if (current.runId && current.report === null) return current.refreshReport();');
  });

  it('loader 使用真实三个端点且不读取 GA seed／自报身份头', () => {
    const source = renderer('lib/enterprise-scan-api.ts');
    expect(source).toContain("import { getApiBase } from './api';");
    expect(source).toContain('/api/enterprise-scan/manifests');
    expect(source).toContain('/api/enterprise-scan/runs`');
    expect(source).toContain('/api/enterprise-scan/runs/${encodeURIComponent(runId)}');
    expect(codeOnly(source)).not.toContain('getSeedIdentity');
    expect(codeOnly(source)).not.toContain('x-synova-token');
  });

  it('扫描写集无 DSH／SSE／假进度／取消依赖，UI 不按角色过滤', () => {
    const sources = [
      renderer('lib/enterprise-scan-api.ts'),
      renderer('stores/scan-store.ts'),
      renderer('components/ScanContainer.tsx'),
      renderer('components/ScanPanel.tsx'),
    ];
    for (const source of sources) {
      expect(codeOnly(source)).not.toMatch(/EventSource|\/api\/dsh|from ['"][^'"]*dsh|getSeedIdentity|userRole|progress|进度条/);
    }
  });
});
