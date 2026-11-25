/**
 * tests/electron/sidebar-collapse.test.ts — T5a / B2「边栏可收起／恢复」(#1481 / #1480-B2)
 *
 * 判据源：`docs/synova/coordination/编码指令-UI重做-T5a-B2-20261125.md` §5
 *   A1 结构断言：TitleBar 内存在带 `aria-expanded` 的按钮，收起后仍可见（不是 display:none）；
 *                `app-store` 有 `leftPanelCollapsed` 且持久化
 *   A3 死项清零：`electron-renderer/src/components/` 下 `onClick={() => {}}` = 0；
 *                TitleBar 假按钮 ＋ ExpertAttribution 死项删除（铁律 37）
 *   A4 ratchet：`tests/user-visible/customer-language.test.ts`（独立文件，本件不重复跑）
 *   A2 真实入口（起 Electron 点按钮→量宽度→刷新→仍收起→展开）**不在本件**：
 *      `electron-renderer/AGENTS.md`「渲染桥不执行 hook ⇒ 容器/面板只做源码断言，不证像素/交互」
 *      ⇒ 本件只做源码/纯逻辑断言；真机证据在 PR 回执的 A2（截图＋宽度数字）。
 *
 * 防假绿三问（卡 §5）：
 *   ① 零对象：每条断言先证明读到了对象（源码非空 / 扫描文件数 > 0 / 找不到按钮即算违规），
 *      "组件没渲染"或"文件没读到"都不会被当成通过；
 *   ② 跳过：本件无 skip、无条件跳过——起不了 Electron 只让 A2 标「未验证」，不影响本件结论；
 *   ③ 同源派生：期望值来自任务卡 §3（两态文案／≤200ms／reduced-motion 不动画）与
 *      `global.css` 既有令牌（44/240），**不取自当前实现输出的快照**。
 *
 * 改坏必红（卡 §5 A1）的判别力自检在本件内以合成源码证明；实际把按钮改成 display:none 的
 * 变异运行原始输出附在 PR 回执。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RENDERER = 'electron-renderer/src';

/** 读 renderer 源码（路径相对 `electron-renderer/src`） */
const read = (relativePath: string): string => readFileSync(resolve(ROOT, RENDERER, relativePath), 'utf8');

/** 去掉注释——判据只看代码，不让注释里的示例文字影响判定 */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * checkToggleAlwaysMounted — B2 病灶判据（**收起 ≠ 恢复入口消失**）
 *
 * 只认任务卡 §5「改坏必红」的两种形态：
 *   ① 按钮带 `display` / `visibility` / `hidden` 控制 ⇒ 收起态可被隐藏；
 *   ② 按钮前出现收起态条件守卫（`{!leftPanelCollapsed && <button`）⇒ 收起后被卸载。
 * @input  source `TitleBar.tsx` 源码（内部去注释）
 * @output string[] 违规说明；空数组＝通过。**找不到按钮也算违规**（零对象 ≠ 通过）
 */
function checkToggleAlwaysMounted(source: string): string[] {
  const code = codeOnly(source);
  const button = code.match(/<button[^>]*data-sidebar-toggle="left"[\s\S]*?<\/button>/)?.[0];
  if (button === undefined) {
    return ['未找到 data-sidebar-toggle="left" 的收起/恢复按钮（零对象 ⇒ 不是通过）'];
  }
  const problems: string[] = [];
  if (/\b(display|visibility)\s*[:=]/.test(button) || /\bhidden\b/i.test(button)) {
    problems.push('按钮带 display/visibility/hidden 控制 ⇒ 收起态可被隐藏');
  }
  const start = code.indexOf(button);
  const before = code.slice(Math.max(0, start - 160), start);
  if (/[Cc]ollapsed\s*(&&|\?)/.test(before)) {
    problems.push('按钮前有收起态条件守卫 ⇒ 收起后被卸载');
  }
  return problems;
}

/** 死项判据：`onClick={() => {}}`（任务卡 §5 A3 的同一条命令） */
const DEAD_ON_CLICK = /onClick=\{\(\)\s*=>\s*\{\s*\}\}/;

/** components/ 下全部 .tsx 源码（平面目录；空目录 ⇒ 判据无对象，测试会红） */
function listComponentSources(): Array<{ path: string; source: string }> {
  const dir = resolve(ROOT, RENDERER, 'components');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => ({
      path: `components/${entry.name}`,
      source: readFileSync(resolve(dir, entry.name), 'utf8'),
    }));
}

interface MemoryStorage { map: Map<string, string> }

/** window 桩：内存 localStorage（app-store 的 safeLocalStorage 只认 window.localStorage） */
function stubWindowWithStorage(): MemoryStorage {
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

type StoreModule = typeof import('../../electron-renderer/src/stores/app-store');

/** 重新装载 app-store（配合 vi.resetModules 模拟"刷新/重启"后的新实例） */
async function importStore(): Promise<StoreModule> {
  return import('../../electron-renderer/src/stores/app-store');
}

describe('B2/A1: 恢复入口常驻窗口栏（TitleBar）', () => {
  it('A1-b: 收起/恢复按钮带 aria-expanded，且不随收起态隐藏或卸载', () => {
    const titleBar = read('components/TitleBar.tsx');
    expect(titleBar.length, 'TitleBar.tsx 读不到（零对象 ⇒ 不是通过）').toBeGreaterThan(0);

    expect(checkToggleAlwaysMounted(titleBar)).toEqual([]);

    const button = codeOnly(titleBar).match(/<button[^>]*data-sidebar-toggle="left"[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(button).not.toBe('');
    // aria-expanded 必须随状态变化（两态断言）
    expect(button).toContain('aria-expanded={!leftPanelCollapsed}');
    // 与 Ctrl+B 同一个 action（App 透传 store 的 toggleLeftPanel）
    expect(button).toContain('onClick={onToggleLeftPanel}');
    // 两态 tooltip/aria-label 文案都在（收起态说「打开」，展开态说「收起」）
    expect(titleBar).toContain("'打开侧边栏'");
    expect(titleBar).toContain("'收起侧边栏'");
  });

  it('A1-b 判别力自检：改成收起时 display:none / 收起态条件渲染 ⇒ 同一判据必红', () => {
    const titleBar = read('components/TitleBar.tsx');
    expect(checkToggleAlwaysMounted(titleBar)).toEqual([]);

    // 变体 ①：收起态 display:none（B2 的原始病灶形态）
    const hiddenInCollapsed = titleBar.replace(
      'data-sidebar-toggle="left"',
      "data-sidebar-toggle=\"left\" style={{ display: leftPanelCollapsed ? 'none' : undefined }}",
    );
    expect(hiddenInCollapsed, '变异未注入 ⇒ 判别力自检无效').not.toBe(titleBar);
    expect(checkToggleAlwaysMounted(hiddenInCollapsed).length).toBeGreaterThan(0);

    // 变体 ②：收起态条件渲染（直接卸载按钮）
    const button = codeOnly(titleBar).match(/<button[^>]*data-sidebar-toggle="left"[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(button).not.toBe('');
    const unmountedInCollapsed = codeOnly(titleBar).replace(button, `{!leftPanelCollapsed && (\n${button}\n)}`);
    expect(checkToggleAlwaysMounted(unmountedInCollapsed).length).toBeGreaterThan(0);
  });

  it('A1-a: 宽度走既有令牌（组件不写死 44px）、差值 ≥100px、过渡 ≤200ms、reduced-motion 不动画', () => {
    const css = read('styles/global.css');
    const expanded = Number(/--left-panel-expanded:\s*(\d+)px/.exec(css)?.[1]);
    const collapsed = Number(/--left-panel-collapsed:\s*(\d+)px/.exec(css)?.[1]);
    expect(expanded).toBeGreaterThan(collapsed);
    // 期望值来源＝global.css 令牌（不是当前实现输出的快照）
    expect(expanded - collapsed).toBeGreaterThanOrEqual(100);
    // 收起态宽度由 .panel-left.closed 消费令牌（组件不重复写死数值）
    expect(css).toMatch(/\.panel-left\.closed\s*\{[^}]*var\(--left-panel-collapsed\)/);

    const app = read('App.tsx');
    expect(app.length, 'App.tsx 读不到（零对象 ⇒ 不是通过）').toBeGreaterThan(0);
    expect(app).toContain("leftPanelCollapsed ? 'closed' : 'open'");
    expect(app).not.toMatch(/:\s*44\b/);
    expect(app).toContain('width 200ms ease');
    expect(app).toContain("'(prefers-reduced-motion: reduce)'");
    expect(app).toMatch(/'none' : 'width 200ms ease'/);
  });

  it('A1-c: 可见控件与 Ctrl+B 共用同一 action（不许两套逻辑）', () => {
    const app = read('App.tsx');
    const titleBar = read('components/TitleBar.tsx');
    const keyboard = read('hooks/useKeyboard.ts');
    const store = read('stores/app-store.ts');
    for (const [name, source] of Object.entries({ app, titleBar, keyboard, store })) {
      expect(source.length, `${name} 读不到（零对象 ⇒ 不是通过）`).toBeGreaterThan(0);
    }

    // App：同一引用既进键盘 handlers，又透传给 TitleBar
    expect(app).toContain('const toggleLeftPanel = useAppStore((s) => s.toggleLeftPanel);');
    expect(app).toMatch(/const handlers = useMemo\(\(\) => \(\{\s*toggleLeftPanel,/);
    expect(app).toContain('useKeyboard(handlers);');
    expect(app).toMatch(/<TitleBar[\s\S]{0,400}?onToggleLeftPanel=\{toggleLeftPanel\}/);

    // TitleBar 只调 prop，不另存开合态（没有第二套逻辑的落脚点）
    expect(titleBar).toContain('onClick={onToggleLeftPanel}');
    expect(titleBar).not.toMatch(/useState/);

    // Ctrl+B 仍打到同一个 handler 名
    expect(keyboard).toContain('handlers.toggleLeftPanel();');

    // store 只有一个开合真值，没有反相副本 / 第二个 action（判据只看代码，不看注释）
    const storeCode = codeOnly(store);
    expect(storeCode).toContain('leftPanelCollapsed: boolean;');
    expect(storeCode).not.toMatch(/leftPanelOpen\b/);
    expect(storeCode).not.toMatch(/toggleLeftPanelOpen|setLeftPanelCollapsed/);
  });

  it('A1: LeftPanel 只消费 store 的单一真值（不自存本地开合态）', () => {
    const leftPanel = read('components/LeftPanel.tsx');
    expect(leftPanel.length, 'LeftPanel.tsx 读不到（零对象 ⇒ 不是通过）').toBeGreaterThan(0);
    expect(leftPanel).toContain('s.leftPanelCollapsed');
    expect(leftPanel).not.toMatch(/leftPanelOpen\b/);
  });
});

describe('B2/A1: app-store 收起态持久化（只 UI 状态，R11）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('A1-d: leftPanelCollapsed 是唯一真值且落盘——刷新后仍收起，再展开落盘 false', async () => {
    const storage = stubWindowWithStorage();
    const store = await importStore();
    expect(store.useAppStore.getState().leftPanelCollapsed, '默认应为展开态').toBe(false);

    store.useAppStore.getState().toggleLeftPanel();
    expect(store.useAppStore.getState().leftPanelCollapsed).toBe(true);
    expect(storage.map.get(store.LEFT_PANEL_COLLAPSED_STORAGE_KEY)).toBe('true');

    // 刷新/重启 ＝ 同一 localStorage 上重新装载模块（不继承内存态）
    vi.resetModules();
    const reloaded = await importStore();
    expect(reloaded.useAppStore.getState().leftPanelCollapsed, '刷新后应仍为收起态').toBe(true);

    reloaded.useAppStore.getState().toggleLeftPanel();
    expect(reloaded.useAppStore.getState().leftPanelCollapsed).toBe(false);
    expect(storage.map.get(store.LEFT_PANEL_COLLAPSED_STORAGE_KEY)).toBe('false');
  });

  it('A1-d 降级: localStorage 读写抛异常 ⇒ 开合仍生效（内存态）+ warn，不抛（铁律 24）', async () => {
    const deny = (): never => { throw new Error('storage denied'); };
    vi.stubGlobal('window', { localStorage: { getItem: deny, setItem: deny, removeItem: deny } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const store = await importStore();
      expect(store.useAppStore.getState().leftPanelCollapsed, '读失败 ⇒ 降级为展开态').toBe(false);
      expect(() => store.useAppStore.getState().toggleLeftPanel()).not.toThrow();
      expect(store.useAppStore.getState().leftPanelCollapsed, '写失败也得翻转内存态').toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('A1-d 降级: 无 localStorage（非浏览器环境）⇒ 内存态开合 + warn，不抛', async () => {
    vi.stubGlobal('window', {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const store = await importStore();
      expect(store.useAppStore.getState().leftPanelCollapsed).toBe(false);
      expect(() => store.useAppStore.getState().toggleLeftPanel()).not.toThrow();
      expect(store.useAppStore.getState().leftPanelCollapsed).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('B2/A3: 死项清零（铁律 37）', () => {
  it('A3: components/ 下 onClick={() => {}} 归零；TitleBar 假按钮与 ExpertAttribution 死项已删除', () => {
    const sources = listComponentSources();
    expect(sources.length, 'components/ 扫不到文件（零对象 ⇒ 不是通过）').toBeGreaterThan(0);

    const deadButtons = sources.filter((file) => DEAD_ON_CLICK.test(file.source)).map((file) => file.path);
    expect(deadButtons, '仍有假按钮（onClick={() => {}}）：死项入仓库即违规').toEqual([]);

    const titleBar = read('components/TitleBar.tsx');
    expect(titleBar).not.toContain('⌨️');
    expect(titleBar).not.toContain('title="快捷键"');

    const attribution = read('components/ExpertAttribution.tsx');
    expect(attribution.length, 'ExpertAttribution.tsx 读不到（零对象 ⇒ 不是通过）').toBeGreaterThan(0);
    const attributionCode = codeOnly(attribution);
    expect(attributionCode).not.toContain('expert-attribution-chain-btn');
    expect(attributionCode).not.toContain('展开完整推理链');
  });

  it('A3 判别力自检：合成一个 onClick={() => {}} 的源码 ⇒ 同一判据必红', () => {
    expect(DEAD_ON_CLICK.test('<button className="x" onClick={() => {}}>⌨️</button>')).toBe(true);
    expect(DEAD_ON_CLICK.test('<button className="x" onClick={onToggleLeftPanel}>收起</button>')).toBe(false);
  });
});
