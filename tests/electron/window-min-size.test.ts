/**
 * tests/electron/window-min-size.test.ts — T2b 窗口最小尺寸契约（#1481 / #1480-B1）
 *
 * 为什么需要这个文件（不是"补覆盖率"）:
 *   scripts/ci/core-tests.sh:364 要求 PR 变更必须选出 ≥1 个**通过**的受影响测试
 *   （`[ "$AFFECTED_TOTAL" -gt 0 ] && [ "$AFFECTED_PASSED" -gt 0 ] || fail_test ... affected-no-passed-tests`）。
 *   `vitest run --changed` 按模块图（import 边）选测试，而 electron/main.cjs 没有任何测试 import 它
 *   —— 其它 electron 测试都是 fs.readFileSync 读源码（见 backend-spawn.test.ts:333）——
 *   所以"只改 main.cjs"会选出 0 个测试 ⇒ CI 恒红。
 *   本文件读同一份 main.cjs，让"改 main.cjs"第一次有一个可判的测试。
 *
 * 契约（任务卡 §3；期望值来自算式，不是"读回来是什么就写什么"）:
 *   宽度 = 左栏 240 + 中栏 400 + 右栏 320 + 分隔 40 = 1000
 *   高度 = 标题栏 48 + 内容 400 + 状态栏 28 + 边距 24 = 500
 *   判据 = minWidth ≥ 1000 且 minHeight ≥ 500（放宽方向可接受，收紧方向必红）。
 *
 * 铁律 48（正常/失败/边界都有）:
 *   正常 = 真实 electron/main.cjs 达标；失败 = 取不到参数、低于下限都会被 assertWindowMinSize 判红，
 *   且失败信息点名具体参数（A2/A3 要求"改坏必红并点名 minWidth"）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const MAIN_CJS = path.resolve(__dirname, '../../electron/main.cjs');

// 契约值＝任务卡 §3 的算式（不是从 main.cjs 读回来的观测值）
const CONTRACT_MIN_WIDTH = 240 + 400 + 320 + 40; // 左栏 + 中栏 + 右栏 + 分隔余量 = 1000
const CONTRACT_MIN_HEIGHT = 48 + 400 + 28 + 24; // 标题栏 + 内容 + 状态栏 + 边距余量 = 500

interface WindowMinSize {
  minWidth: number;
  minHeight: number;
}

/**
 * 从 main.cjs 源码里取 BrowserWindow 的 minWidth / minHeight。
 * 任一项取不到 ⇒ 返回 null（由调用方判红，不静默当成"没问题"）。
 */
function parseWindowMinSize(source: string): WindowMinSize | null {
  const width = source.match(/\bminWidth:\s*(\d+)/);
  const height = source.match(/\bminHeight:\s*(\d+)/);
  if (!width || !height) return null;
  return { minWidth: Number(width[1]), minHeight: Number(height[1]) };
}

/**
 * 主判据：窗口最小尺寸不得低于契约值。
 * 失败信息点名 minWidth / minHeight —— 让"改坏"的原始输出能直接指到具体参数。
 */
function assertWindowMinSize(size: WindowMinSize | null): void {
  if (size === null) {
    throw new Error('electron/main.cjs 取不到 minWidth/minHeight：窗口最小尺寸契约无法验证');
  }
  if (size.minWidth < CONTRACT_MIN_WIDTH) {
    throw new Error(
      `minWidth=${size.minWidth} 低于契约下限 ${CONTRACT_MIN_WIDTH}（任务卡 §3: 240+400+320+40）`,
    );
  }
  if (size.minHeight < CONTRACT_MIN_HEIGHT) {
    throw new Error(
      `minHeight=${size.minHeight} 低于契约下限 ${CONTRACT_MIN_HEIGHT}（任务卡 §3: 48+400+28+24）`,
    );
  }
}

describe('T2b 窗口最小尺寸契约（#1481 / #1480-B1）', () => {
  it('契约算式自身等于 1000×500（期望值来源可核）', () => {
    expect(CONTRACT_MIN_WIDTH).toBe(1000);
    expect(CONTRACT_MIN_HEIGHT).toBe(500);
  });

  it('electron/main.cjs 的 minWidth ≥ 1000 且 minHeight ≥ 500', () => {
    const source = fs.readFileSync(MAIN_CJS, 'utf-8');
    const size = parseWindowMinSize(source);
    expect(size, 'electron/main.cjs 里取不到 minWidth/minHeight').not.toBeNull();
    assertWindowMinSize(size);
    // 再按字段显式断言：失败时原始输出直接带实测值
    expect(size?.minWidth, 'electron/main.cjs 的 minWidth 必须 ≥ 1000').toBeGreaterThanOrEqual(
      CONTRACT_MIN_WIDTH,
    );
    expect(size?.minHeight, 'electron/main.cjs 的 minHeight 必须 ≥ 500').toBeGreaterThanOrEqual(
      CONTRACT_MIN_HEIGHT,
    );
  });

  // 反例 1（A3 的本地形态）：minWidth 整行缺失 ⇒ 解析 null，主判据必红并点名 minWidth
  it('反例: 源码没有 minWidth 时解析为 null，主判据必红（判据不为恒真）', () => {
    const withoutWidth = 'new BrowserWindow({ width: 1280, height: 800, minHeight: 500 });';
    const parsed = parseWindowMinSize(withoutWidth);
    expect(parsed).toBeNull();
    expect(() => assertWindowMinSize(parsed)).toThrow(/minWidth/);
  });

  // 反例 2（A2 的本地形态）：minWidth 被改小 ⇒ 主判据必红并点名 minWidth
  it('反例: minWidth 低于 1000 时主判据必红并点名 minWidth', () => {
    expect(() => assertWindowMinSize({ minWidth: 600, minHeight: 500 })).toThrow(/minWidth=600/);
  });

  // 反例 3：minHeight 低于 500 ⇒ 主判据必红并点名 minHeight
  it('反例: minHeight 低于 500 时主判据必红并点名 minHeight', () => {
    expect(() => assertWindowMinSize({ minWidth: 1000, minHeight: 400 })).toThrow(/minHeight=400/);
  });
});
