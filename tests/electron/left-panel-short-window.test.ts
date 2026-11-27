/**
 * tests/electron/left-panel-short-window.test.ts — T5b / B2「矮窗下左栏可滚动」(#1481 / #1480-B2)
 *
 * 判据源：`docs/synova/coordination/编码指令-UI重做-T5b-B2矮窗滚动-20261125.md` §5 A1
 *   左栏存在可滚动容器（`.left-panel-content` ＋ global.css `overflow-y:auto|scroll`），
 *   且组件给自己渲染的内层 `.panel-left` 加了高度约束——否则 global.css 的 `.panel-left{flex-shrink:0}`
 *   让内层按内容（矮窗 500 DIP 下约 503）撑高，外层 `overflow:hidden` 只裁不滚（T2b 实测
 *   scrollHeight = clientHeight = 503，「本次分析」入口被裁）。
 *
 * 为什么 A1 只做源码/结构断言：`electron-renderer/AGENTS.md`「渲染桥不执行 hook ⇒ 容器/面板只做源码断言，
 * 不证像素/交互」；本仓 vitest environment=node（无布局引擎），scrollHeight/clientHeight 恒为 0，
 * 无法在单测里证明「scrollHeight > clientHeight」。真实布局数字（scrollHeight/clientHeight、
 * 入口 bottom、真实点击、明暗截图）由 **A2 真机（Electron ＋ CDP，MoveWindow 1251×625 physical）** 证明，
 * 原始输出见 PR 回执。
 *
 * 防假绿三问（卡 §5）：
 *   ① 零对象：每条断言先证明读到了对象（源码非空、规则命中、nav 命中）；找不到即判违规（不是通过）。
 *   ② 跳过：本件无 skip、无条件跳过；起不了 Electron 只让 A2 标「未验证」，不影响本件结论。
 *   ③ 同源派生：期望值来自任务卡 §3 与 global.css 现役规则，不取当前实现输出的快照。
 *
 * 改坏必红：判别力自检在本件内用合成源码/样式变体证明；真实「去掉高度约束」「去掉 overflow-y」
 * 的变异运行原始输出附在 PR 回执。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LEFT_PANEL = 'electron-renderer/src/components/LeftPanel.tsx';
const APP = 'electron-renderer/src/App.tsx';
const CSS = 'electron-renderer/src/styles/global.css';

/** 读 renderer 源码/样式（路径相对仓根） */
const read = (relativePath: string): string => readFileSync(resolve(ROOT, relativePath), 'utf8');

/** 去掉注释——判据只看代码，不让注释里的示例文字影响判定 */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 取某个类选择器规则体；规则不存在 ⇒ null（零对象不得当作通过） */
function cssRuleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match === null ? null : match[1];
}

/**
 * 判据 A1-scroll：左栏内容区是纵向滚动容器。
 * @input  source `LeftPanel.tsx` 源码（内部去注释）｜css `global.css` 原文
 * @output string[] 违规说明；空数组＝通过。**找不到对象也算违规**（零对象 ≠ 通过）
 */
function checkScrollableContent(source: string, css: string): string[] {
  const problems: string[] = [];
  const code = codeOnly(source);
  if (!/className="left-panel-content\b/.test(code)) {
    problems.push('LeftPanel 未渲染 .left-panel-content 内容区（零对象 ⇒ 不是通过）');
  }
  const body = cssRuleBody(css, '.left-panel-content');
  if (body === null) {
    problems.push('global.css 找不到 .left-panel-content 规则（零对象 ⇒ 不是通过）');
  } else if (!/overflow-y:\s*(auto|scroll)\b/.test(body)) {
    problems.push('.left-panel-content 缺 overflow-y:auto|scroll ⇒ 不滚动（任务卡 §5 A1 改坏形态）');
  } else if (!/(^|[\s;])flex:\s*1\b/.test(body) && !/flex-grow:\s*1/.test(body)) {
    problems.push('.left-panel-content 不再以 flex:1 取得内容区高度 ⇒ 滚动视口高度来源消失');
  }
  return problems;
}

/**
 * 判据 A1-height：内层 nav 被限制在外层 .panel-left 的高度内（本批修复的唯一开关）。
 * @input  source `LeftPanel.tsx` 源码（内部去注释）
 * @output string[] 违规说明；空数组＝通过。找不到 nav/常量即违规
 */
function checkInnerNavHeightBound(source: string): string[] {
  const problems: string[] = [];
  const code = codeOnly(source);
  const nav = code.match(/<nav\b[^>]*className=\{`[^`]*panel-left[^`]*`\}[^>]*>/)?.[0];
  if (nav === undefined) {
    return ['未找到 LeftPanel 渲染的内层 <nav className={`panel-left …`}>（零对象 ⇒ 不是通过）'];
  }
  if (!/style=\{INNER_NAV_FITS_OUTER\}/.test(nav)) {
    problems.push('内层 nav 未应用 INNER_NAV_FITS_OUTER 高度约束 ⇒ 会按内容撑高、外层只裁不滚');
  }
  const decl = code.match(/const INNER_NAV_FITS_OUTER[^=]*=\s*\{([^}]*)\}/)?.[1];
  if (decl === undefined) {
    problems.push('未找到 INNER_NAV_FITS_OUTER 声明（零对象 ⇒ 不是通过）');
  } else {
    if (!/flex:\s*1\b/.test(decl)) {
      problems.push('INNER_NAV_FITS_OUTER 缺 flex:1（内层不再占满外层高度）');
    }
    if (!/minHeight:\s*0/.test(decl)) {
      problems.push('INNER_NAV_FITS_OUTER 缺 minHeight:0（内容高于外层时仍有撑破风险）');
    }
  }
  return problems;
}

/** 取按钮整块（data-cap 定位；找不到 ⇒ ''）。不按 `>` 切标签：JSX 的 `=>` 里也有 `>`。 */
function buttonBlockOf(code: string, dataCap: string): string {
  const blocks = code.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
  return blocks.find((block) => block.includes(`data-cap="${dataCap}"`)) ?? '';
}

describe('T5b/B2 A1：左栏可滚动容器（结构断言）', () => {
  it('A1-scroll: 左栏内容区是纵向滚动容器（.left-panel-content + overflow-y:auto|scroll）', () => {
    const source = read(LEFT_PANEL);
    const css = read(CSS);
    expect(source.length, 'LeftPanel.tsx 读不到（零对象 ⇒ 不是通过）').toBeGreaterThan(0);
    expect(css.length, 'global.css 读不到（零对象 ⇒ 不是通过）').toBeGreaterThan(0);
    expect(checkScrollableContent(source, css)).toEqual([]);
  });

  it('A1-height: 内层 nav 被限制在外层高度内（flex:1 + minHeight:0）', () => {
    const source = read(LEFT_PANEL);
    expect(source.length, 'LeftPanel.tsx 读不到（零对象 ⇒ 不是通过）').toBeGreaterThan(0);
    expect(checkInnerNavHeightBound(source)).toEqual([]);
  });

  it('A1-前提: 外层 .panel-left（App）+ 内层 .panel-left（LeftPanel）嵌套与 global.css 病灶仍在', () => {
    const app = read(APP);
    const css = read(CSS);
    expect(app.length, 'App.tsx 读不到（零对象 ⇒ 不是通过）').toBeGreaterThan(0);
    const appShell = app.match(/<nav\b[^>]*className=\{`[^`]*panel-left[^`]*`\}[^>]*>[\s\S]{0,200}?<LeftPanel\s*\/>/)?.[0] ?? '';
    expect(appShell, 'App.tsx 未在外层 nav.panel-left 内渲染 <LeftPanel />（嵌套前提不成立，须重核本卡病灶）').not.toBe('');
    const panelRule = cssRuleBody(css, '.panel-left');
    expect(panelRule, 'global.css 找不到 .panel-left 规则（零对象 ⇒ 不是通过）').not.toBeNull();
    expect(panelRule).toMatch(/overflow:\s*hidden/);
    expect(panelRule).toMatch(/flex-shrink:\s*0/);
  });

  it('A1-入口: 「数据核对／本次分析」入口存在且各自接线（A2 真实点击的判据目标）', () => {
    const code = codeOnly(read(LEFT_PANEL));
    const scan = buttonBlockOf(code, 'nav-scan');
    const dsh = buttonBlockOf(code, 'nav-dsh');
    expect(scan, '未找到 data-cap="nav-scan" 入口（零对象 ⇒ 不是通过）').not.toBe('');
    expect(dsh, '未找到 data-cap="nav-dsh" 入口（零对象 ⇒ 不是通过）').not.toBe('');
    expect(scan).toContain("setActiveView('scan')");
    expect(dsh).toContain("setActiveView('dsh')");
  });

  it('A1 判别力自检：去掉高度约束 / 去掉 overflow-y / 去掉内容区 ⇒ 同一判据必红', () => {
    const source = read(LEFT_PANEL);
    const css = read(CSS);
    expect(checkScrollableContent(source, css)).toEqual([]);
    expect(checkInnerNavHeightBound(source)).toEqual([]);

    // 变体 ①：内层 nav 不再应用高度约束（本批原始病灶形态）
    const withoutFit = source.replace('style={INNER_NAV_FITS_OUTER}', '');
    expect(withoutFit, '变异未注入 ⇒ 判别力自检无效').not.toBe(source);
    expect(checkInnerNavHeightBound(withoutFit).length).toBeGreaterThan(0);

    // 变体 ②：高度约束常量被删
    const withoutConst = source.replace(/const INNER_NAV_FITS_OUTER[^;]*;/, '');
    expect(withoutConst, '变异未注入 ⇒ 判别力自检无效').not.toBe(source);
    expect(checkInnerNavHeightBound(withoutConst).length).toBeGreaterThan(0);

    // 变体 ③：.left-panel-content 去掉 overflow-y（卡 §5 A1 指定改坏形态）
    const withoutOverflow = css.replace(
      /\.left-panel-content\s*\{[^}]*\}/,
      '.left-panel-content { flex: 1; padding: 4px 8px; }',
    );
    expect(withoutOverflow, '变异未注入 ⇒ 判别力自检无效').not.toBe(css);
    expect(checkScrollableContent(source, withoutOverflow).length).toBeGreaterThan(0);

    // 变体 ④：内容区类名被摘掉（滚动容器消失）
    const withoutContent = source.replace('className="left-panel-content fade-in"', 'className="fade-in"');
    expect(withoutContent, '变异未注入 ⇒ 判别力自检无效').not.toBe(source);
    expect(checkScrollableContent(withoutContent, css).length).toBeGreaterThan(0);
  });
});
