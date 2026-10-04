/**
 * 溯源冻结（登记件 ↔ 板 双向可追溯）的守卫测试
 *
 * @why  K3 全仓审计实测缺口：登记件正文零卡号、板自动化零脚本 ⇒ 两份事实源会静默分叉。
 *       本测试守住：① 工具可跑 ② 双向一致（未投放 0）③ 生成物存在且可解析
 *
 * @contract（铁律 47）
 *   @input  — 无（读工位内登记件 + 板）
 *   @output — vitest 断言
 *   @degraded — 依赖缺失即失败（不静默跳过）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = resolve(ROOT, 'docs/synova/coordination/tools/check-cardmap.ts');
const MAP = resolve(ROOT, 'docs/synova/coordination/cardmap.json');

describe('溯源冻结 · cardmap', () => {
  it('工具与生成物都存在', () => {
    expect(existsSync(TOOL)).toBe(true);
    expect(existsSync(MAP)).toBe(true);
  });

  it('生成物可解析，且 total 与 map 条数一致', () => {
    const d = JSON.parse(readFileSync(MAP, 'utf-8')) as { total: number; map: Record<string, unknown> };
    expect(d.total).toBeGreaterThan(0);
    expect(Object.keys(d.map).length).toBe(d.total);
  });

  it('正向：登记件每项都能在 cardmap 找到卡号（未投放 = 0）', () => {
    const out = execFileSync('./node_modules/.bin/tsx', [TOOL], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(out).toContain('未投放 0');
    expect(out).toContain('已投放');
  }, 180_000);
});
