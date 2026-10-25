/**
 * swallow-ratchet.test.ts — 吞错基线棘轮（裁 421 · D 项）
 *
 * 目的：`pre-commit-check.sh`（150 处吞错仅 7 标注）与 `check-file-driven.sh`（21 处 0 标注）
 *   存量不清白，但**不许再增加**。本测把「未标注的吞错行数」钉成基线：
 *   新增（> baseline）⇒ 红；下降 ⇒ 绿（只减不增）。
 *
 * 判定口径：一行含 `2>/dev/null` 或 `|| true`，且**同行**不含 `swallow-ok`，计 1 处。
 * 运行位置：tests/contract/ ⇒ CI ①j 每次跑（零新增 CI 步）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASELINE: Record<string, number> = {
  'scripts/pre-commit-check.sh': 144,
  'scripts/check-file-driven.sh': 21,
};

function unmarked(file: string): number {
  const src = readFileSync(resolve(process.cwd(), file), 'utf8');
  return src.split('\n').filter(l => (l.includes('2>/dev/null') || l.includes('|| true')) && !l.includes('swallow-ok')).length;
}

describe('吞错基线棘轮（只减不增）', () => {
  it('基线表本身非空且为正整数', () => {
    expect(Object.keys(BASELINE).length).toBeGreaterThan(0);
    expect(Object.values(BASELINE).every(v => v > 0)).toBe(true);
  });

  for (const [file, base] of Object.entries(BASELINE)) {
    it(`${file} 未标注吞错 ≤ ${base}`, () => {
      const now = unmarked(file);
      expect(now, `${file} 未标注吞错 ${now} > 基线 ${base}（新增吞错必须加 swallow-ok 或下游处理）`).toBeLessThanOrEqual(base);
    });
  }
});
