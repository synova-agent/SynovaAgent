/**
 * tests/control-tower/probe-exile-compile.test.ts — 第一档探针的**纯函数**判据（CTO 裁定 086）
 *
 * 🔴 最要紧的两条（都是**实测踩坑**换来的，禁删）：
 *   ① `pathMatcher` 必须与登记件的字面量口径一致（目录尾斜杠 / 双星 / 单星 / 精确）
 *      —— 口径漂了会让"摘除面"忽大忽小（静默的假红/假绿）。
 *   ② `hasEntanglement` 是**停止条件③ 的机器化**：块级 paths 互含 ⇒ 该行判"判不了"。
 */
import { describe, expect, it } from 'vitest';
import {
  REASON_ENTANGLED,
  VERDICT_DEPENDENT,
  VERDICT_INDEPENDENT,
  VERDICT_UNJUDGEABLE,
  diagKey,
  globToRegExp,
  hasEntanglement,
  pathCovers,
  pathMatcher,
  toRepoRel,
  type DiagRow,
} from '../../scripts/control-tower/probe-exile-compile.ts';

describe('globToRegExp — 双星 vs 单星', () => {
  it('单星不跨段', () => {
    expect(globToRegExp('a/*.ts').test('a/x.ts')).toBe(true);
    expect(globToRegExp('a/*.ts').test('a/b/x.ts')).toBe(false);
  });
  it('双星跨段（含零段）', () => {
    expect(globToRegExp('a/**').test('a/b/c.ts')).toBe(true);
    expect(globToRegExp('a/**/m.json').test('a/m.json')).toBe(true);
    expect(globToRegExp('a/**/m.json').test('a/b/c/m.json')).toBe(true);
  });
  it('正则元字符被转义（. 不当通配）', () => {
    expect(globToRegExp('a/x.ts').test('a/xXts')).toBe(false);
  });
});

describe('pathMatcher — 四种字面量形态', () => {
  it('目录尾斜杠 ⇒ 该目录及其下', () => {
    const m = pathMatcher('extensions/');
    expect(m('extensions/a/b.ts')).toBe(true);
    expect(m('extensions')).toBe(true);
    expect(m('extensionsX')).toBe(false);
  });
  it('双星 ⇒ 前缀下全部', () => {
    const m = pathMatcher('src/l4/**');
    expect(m('src/l4/graph-bridge.ts')).toBe(true);
    expect(m('src/l5/x.ts')).toBe(false);
  });
  it('单星 ⇒ 段内', () => {
    const m = pathMatcher('cycles/builtin/*.cycle.json');
    expect(m('cycles/builtin/a.cycle.json')).toBe(true);
    expect(m('cycles/builtin/sub/a.cycle.json')).toBe(false);
  });
  it('精确 ⇒ 自身或其子（不误伤同前缀兄弟）', () => {
    const m = pathMatcher('src/store');
    expect(m('src/store/db.ts')).toBe(true);
    expect(m('src/storefront/x.ts')).toBe(false);
  });
});

describe('pathCovers / hasEntanglement — 停止条件③ 的机器化', () => {
  it('目录覆盖其下', () => {
    expect(pathCovers('extensions/', 'extensions/sentinels/')).toBe(true);
  });
  it('双星覆盖其下', () => {
    expect(pathCovers('src/l4/**', 'src/l4/graph-bridge.ts')).toBe(true);
  });
  it('互不覆盖 ⇒ 无纠缠', () => {
    expect(hasEntanglement(['src/store/'], ['extensions/'])).toBe(false);
  });
  it('K4 的 extensions/ 覆盖 K3 的 extensions/sentinels/ ⇒ 判纠缠', () => {
    expect(hasEntanglement(['extensions/'], ['extensions/sentinels/'])).toBe(true);
  });
});

describe('toRepoRel', () => {
  it('仓内 ⇒ 相对 POSIX；仓外 ⇒ null', () => {
    expect(toRepoRel('/r', '/r/a/b.ts')).toBe('a/b.ts');
    expect(toRepoRel('/r', '/other/x.ts')).toBeNull();
  });
});

describe('diagKey — 差集键必须含位置与码', () => {
  it('同文件不同行 ⇒ 不同键', () => {
    const a: DiagRow = { file: 'a.ts', line: 1, col: 2, code: 2307, message: 'm' };
    const b: DiagRow = { file: 'a.ts', line: 2, col: 2, code: 2307, message: 'm' };
    expect(diagKey(a)).not.toBe(diagKey(b));
  });
});

describe('判定三态常量（防有人把"判不了"并进"绿"）', () => {
  it('三态互不相同且判不了带原因常量', () => {
    const s = new Set([VERDICT_DEPENDENT, VERDICT_INDEPENDENT, VERDICT_UNJUDGEABLE]);
    expect(s.size).toBe(3);
    expect(REASON_ENTANGLED).toContain('字面包含');
  });
});
