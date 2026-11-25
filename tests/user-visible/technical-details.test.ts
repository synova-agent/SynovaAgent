/**
 * tests/user-visible/technical-details.test.ts — B3「技术详情」默认收起（A3）
 *
 * 判据源：`docs/synova/ui-redo/客户语言词典-v1.0.md` v1.1 §0.3（默认收起、标题固定「技术详情」、
 * 展开后内容不加修饰）＋ `docs/synova/product-lines/ui/UI-CONTRACT.md` v1.1 §4.2。
 *
 * 覆盖：
 *   A3-1 技术详情层渲染为原生 `<details>`，无 `open` ⇒ 默认收起；标题固定；条目原值在折叠区内部；
 *   A3-2 DshRunPanel 的编号/原始错误只在折叠区内出现，默认可见区不出现；
 *   A3-3 「默认收起」的源码级回归：`<details>` 开标签不得带 `open`（改坏 ⇒ 本用例必红）。
 *
 * 已知边界：本件用仓内零依赖渲染桥（`test-support/render.ts`）做结构断言——
 *   它不执行点击；原生 `<details>` 的展开/收起由浏览器负责，真实点击证据见 PR 回执的 A4（Electron 真机）。
 *   本件不证明像素可见性，也不替代 A4。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';
import { TechnicalDetails } from '../../electron-renderer/src/components/TechnicalDetails';
import { DshRunPanel, type DshRunPanelProps } from '../../electron-renderer/src/components/DshRunPanel';

const root = resolve(__dirname, '../..');

function panel(overrides: Partial<DshRunPanelProps> = {}): string {
  const props: DshRunPanelProps = {
    input: '',
    inputError: null,
    status: 'idle',
    auth: 'authenticated',
    runId: null,
    sessionId: null,
    events: [],
    error: null,
    empty: false,
    cancelPending: false,
    sessionClosed: false,
    onInputChange: () => undefined,
    onSubmit: () => undefined,
    onCancel: () => undefined,
    onClose: () => undefined,
    onReconnect: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(DshRunPanel, props));
}

describe('B3 技术详情：默认收起（A3）', () => {
  it('A3-1 渲染为 <details> 且不带 open；标题固定「技术详情」；原值在折叠区内', () => {
    const html = renderToStaticMarkup(React.createElement(TechnicalDetails, {
      items: [{ label: '运行标识', value: 'run_abc12345' }, { label: '空值', value: '' }],
    }));
    expect(html).toContain('<details');
    expect(html).toContain('技术详情');
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    // 原值在折叠区内（默认不可见）；空值条目被略去
    expect(html.indexOf('run_abc12345')).toBeGreaterThan(html.indexOf('<details'));
    expect(html).not.toContain('空值');
    // 空数组 ⇒ 不渲染空壳
    expect(renderToStaticMarkup(React.createElement(TechnicalDetails, { items: [] }))).toBe('');
  });

  it('A3-2 DshRunPanel：编号与原始错误只在折叠区，默认可见区不出现', () => {
    const html = panel({
      status: 'failed',
      runId: 'run_abc12345',
      sessionId: 'sess_abc12345',
      error: { httpStatus: 403, code: 'FORBIDDEN', phase: 'run', retryable: false, message: '服务端原文-敏感', canReconnect: false },
    });
    const firstDetails = html.indexOf('<details');
    expect(firstDetails).toBeGreaterThan(-1);
    // 去掉所有「技术详情」折叠块后，只比默认可见文本（data-* 属性按词典 §0.2 不计入客户可见面）
    const visible = html.replace(/<details[\s\S]*?<\/details>/g, '').replace(/<[^>]*>/g, '');
    // 默认可见区：客户说法，无编号/错误码/服务端原文
    expect(visible).toContain('当前账号无权查看这项内容');
    expect(visible).not.toContain('run_abc12345');
    expect(visible).not.toContain('sess_abc12345');
    expect(visible).not.toContain('FORBIDDEN');
    expect(visible).not.toContain('服务端原文-敏感');
    // 折叠区：原值不丢
    expect(html).toContain('run_abc12345');
    expect(html).toContain('sess_abc12345');
    expect(html).toContain('FORBIDDEN');
    expect(html).toContain('服务端原文-敏感');
  });

  it('A3-3 默认收起的源码级回归：<details> 开标签不得带 open（改坏必红）', () => {
    const raw = readFileSync(resolve(root, 'electron-renderer/src/components/TechnicalDetails.tsx'), 'utf8');
    // 去掉注释（JSDoc 里可以讨论 `<details>`），只看真实 JSX 开标签
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const openTags = source.match(/<details[^>]*>/g) ?? [];
    expect(openTags.length).toBeGreaterThan(0);
    for (const tag of openTags) expect(tag).not.toMatch(/\bopen\b/);
  });
});
