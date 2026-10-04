/**
 * 模块父 Issue 骨架生成器的守卫测试
 *
 * @why  10 个模块父 Issue 的正文由本生成器产出 ⇒ 它坏了会产出错骨架并流进 GitHub。
 *       断言：① 可跑 ② 产出 10 个文件 ③ 每个都含块级完成标准与登记件出处。
 *
 * @contract（铁律 47）
 *   @input  — 无（读工位内登记件）
 *   @output — vitest 断言
 *   @degraded — 依赖缺失即失败（不静默跳过）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN = resolve(ROOT, 'docs/synova/coordination/tools/gen-module-issues.ts');
const BLOCKS = ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9', 'K10'];

describe('模块父 Issue 骨架生成器', () => {
  it('生成器存在', () => {
    expect(existsSync(GEN)).toBe(true);
  });

  it('产出 10 个模块骨架文件', () => {
    const out = execFileSync('./node_modules/.bin/tsx', [GEN], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(out).toContain('已生成 10 个模块骨架');
    for (const k of BLOCKS) expect(existsSync(`/tmp/kmod/${k}.md`)).toBe(true);
  }, 120_000);

  it('每份骨架含：块级完成标准 + 登记件出处 + 未接线提示', () => {
    for (const k of BLOCKS) {
      const s = readFileSync(`/tmp/kmod/${k}.md`, 'utf-8');
      expect(s).toContain('## 块级完成标准');
      expect(s).toContain('施工项登记.ts');
      expect(s).toContain('未接线');
      expect(s).toMatch(/^命名空间: K\d+$/m);
    }
  });
});
