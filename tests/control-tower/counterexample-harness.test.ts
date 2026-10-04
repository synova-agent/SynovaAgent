/**
 * 执法体验证台的守卫测试
 *
 * @why  验证台（counterexample-harness.ts）是"证明执法体不是纸老虎"的工具。
 *       若它自己坏了，"执法体能红"就成了空话 ⇒ 它必须有守卫测试。
 *       本测试断言：① 验证台可跑 ② 8 条反例全过 ③ 不动原文件。
 *
 * @contract（铁律 47）
 *   @input  — 无（读工位内的两个交付件路径）
 *   @output — vitest 断言结果
 *   @degraded — 路径不存在 ⇒ 测试失败（不静默跳过；空壳测试会被铁律 48 阻断）
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const HARNESS = resolve(ROOT, 'docs/synova/coordination/tools/counterexample-harness.ts');
const REG = resolve(ROOT, 'docs/synova/coordination/施工项登记.ts');
const BODY = resolve(ROOT, 'docs/synova/coordination/tools/check-construction-registry.ts');

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);

describe('执法体反例验证台', () => {
  it('三个交付件都存在', () => {
    expect(existsSync(HARNESS)).toBe(true);
    expect(existsSync(REG)).toBe(true);
    expect(existsSync(BODY)).toBe(true);
  });

  it('8 条反例 a–h 全部符合预期（exit 0）', () => {
    const out = execFileSync('./node_modules/.bin/tsx', [HARNESS], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out).toContain('8/8 条符合预期');
    // 每条必须单列（防止"只报总数不报逐条"）
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      expect(out).toMatch(new RegExp(`✅ ${id}\\s`));
    }
  }, 120_000);

  it('验证台不改动原文件（注入全在 /tmp 副本）', () => {
    const before = [sha(REG), sha(BODY)];
    execFileSync('./node_modules/.bin/tsx', [HARNESS], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const after = [sha(REG), sha(BODY)];
    expect(after).toEqual(before);
  }, 120_000);
});
