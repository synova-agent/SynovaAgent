/**
 * tests/user-visible/right-panel-empty-states.test.ts — T4b（#1481 B3）A3：四类「数据不足」原因
 *
 * 判据源：`docs/synova/ui-redo/客户语言词典-v1.0.md` **v1.1** §4.2（四类原因必须分开，禁止合并成「暂无数据」）
 *        ＋ §4.3（裸「暂无数据」不得作为客户可见文案）＋ `UI重做-DEV-DOC-20261124.md` §5.4。
 * 期望值来源＝词典 §4.2 原文（**硬编码在断言里**，不是当前渲染快照）：
 *   未接入数据源 → 「还没有接入企业数据」／接入数据
 *   未做过扫描   → 「还没有做过企业扫描」／开始扫描
 *   区间内无数据 → 「本期没有数据」／换个期间
 *   取不到       → 「暂时读不到数据」／重试
 *
 * 为什么单列一件：ratchet（customer-language.test.ts）只判「是否还出现禁用词」，
 * 判不了「四类原因是否分开」。本件补的正是 R2-17 的语义面。
 *
 * 反例（改坏必红）：把四类合并回一个默认值「暂无数据」⇒ 用例 1/2 红；
 * 把任一类文案换成「暂无数据」⇒ 用例 1 红 ＋ ratchet 断言 1 红（R2-17，条目已销账）。
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';

// RightPanel 顶层 import react-markdown（root 测试上下文不装子包依赖）——同 right-panel-report-sentinel.test.ts 先例
vi.mock('react-markdown', () => ({ default: () => null }));

const RIGHT_PANEL_TSX = fileURLToPath(
  new URL('../../electron-renderer/src/components/RightPanel.tsx', import.meta.url),
);

/** window 桩（app-store 模块初始化会碰 localStorage）——同 right-panel-report-sentinel.test.ts 先例 */
function stubWindow(): void {
  const map = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value); },
      removeItem: (key: string) => { map.delete(key); },
      clear: () => { map.clear(); },
    },
    electronAPI: { getServerUrl: () => 'http://localhost:18901' },
  });
}

async function load(): Promise<typeof import('../../electron-renderer/src/components/RightPanel')> {
  stubWindow();
  return await import('../../electron-renderer/src/components/RightPanel');
}

describe('A3 / RightPanel 四类「数据不足」原因（词典 §4.2）', () => {
  it('用例 1：四类原因文案与「下一步」逐字等于词典 §4.2（不是当前渲染快照）', async () => {
    const { EMPTY_REASON_VIEW } = await load();
    expect(EMPTY_REASON_VIEW, '四类原因必须齐全（缺一类 = 又退回合并空态）').toEqual({
      no_data_source: { text: '还没有接入企业数据', nextAction: '接入数据' },
      never_run: { text: '还没有做过企业扫描', nextAction: '开始扫描' },
      no_data_in_period: { text: '本期没有数据', nextAction: '换个期间' },
      fetch_failed: { text: '暂时读不到数据', nextAction: '重试' },
    });
  });

  it('用例 2：渲染结果 = 原因 ＋ 下一步（且带可判别的 data-empty-reason）', async () => {
    const { EmptyState } = await load();
    const html = renderToStaticMarkup(EmptyState({ reason: 'never_run' }));
    expect(html).toContain('data-empty-reason="never_run"');
    expect(html).toContain('还没有做过企业扫描');
    expect(html).toContain('下一步：开始扫描');
    // 四类互斥：任一类都不得渲染成另一类的句子
    expect(html).not.toContain('本期没有数据');
    expect(html).not.toContain('暂时读不到数据');
    expect(html).not.toContain('还没有接入企业数据');
  });

  it('用例 3：RightPanel 源码不再有「暂无数据」字符串字面量（R2-17 已销账，不得回潮）', () => {
    const source = readFileSync(RIGHT_PANEL_TSX, 'utf8');
    // 只看字符串字面量形态（注释里的说明不算客户可见文案）
    expect(/['"`]暂无数据['"`]/.test(source), 'RightPanel 又出现「暂无数据」字面量').toBe(false);
    // 四类原因各自有独立分支（不是同一句话的四个别名）
    expect(source).toContain('EMPTY_REASON_VIEW');
    for (const reason of ['no_data_source', 'never_run', 'no_data_in_period', 'fetch_failed']) {
      expect(source).toContain(reason);
    }
  });
});
