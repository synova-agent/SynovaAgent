/**
 * tests/extensions/profession-layer.test.ts — L1.5 专业包层单元测试（#1056）
 *
 * ⚠️ 文件名保留 `profession-layer`（本次改名只动**模块路径**：`src/extensions/profession-layer.ts`
 *    ⇒ `src/extensions/layer-resolver.ts`）。本文件测的是「L1.5 专业包层」这一能力面，
 *    与模块文件名不必同名；重命名测试文件会额外扩大写集与证据面，不在卡面裁定范围内。
 *
 * 覆盖：文件驱动发现（正常 / 缺目录 / 坏 manifest）、四层解析降级路径
 * （缺目录 / JSON 坏 / 非 plain object）、反碎片化检测（命中 / 不命中 / 缺目录）。
 * 全部用**临时真实目录**（真的读盘，不 mock）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  CONTENT_LAYER_ORDER,
  resolveContentLayers,
  loadProfessionPackages,
  detectCustomerFragmentation,
} from '../../src/extensions/layer-resolver';

const FILE = 'thresholds.json';
let base = '';

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf-8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把四个临时目录直接当四层根（绕开 baseDir 派生，用于精确投喂某层）。 */
function layerRoots(dir: string): { builtin: string; industry: string; profession: string; custom: string } {
  return {
    builtin: join(dir, 'builtin'),
    industry: join(dir, 'industry'),
    profession: join(dir, 'profession'),
    custom: join(dir, 'custom'),
  };
}

describe('layer-resolver 单元（L1.5 专业包层）', () => {
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'k4-1056-unit-'));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe('层序常量', () => {
    it('CONTENT_LAYER_ORDER = builtin < industry < profession < custom（升序优先）', () => {
      expect([...CONTENT_LAYER_ORDER]).toEqual(['builtin', 'industry', 'profession', 'custom']);
      expect(CONTENT_LAYER_ORDER.indexOf('profession')).toBeGreaterThan(CONTENT_LAYER_ORDER.indexOf('industry'));
      expect(CONTENT_LAYER_ORDER.indexOf('custom')).toBeGreaterThan(CONTENT_LAYER_ORDER.indexOf('profession'));
    });
  });

  describe('resolveContentLayers 降级路径', () => {
    it('四层目录全不存在 → 全 present=false、degraded=false、resolved 为空对象（ENOENT 是正常默认）', () => {
      const r = resolveContentLayers({ orgId: 'nobody', industry: 'nope', profession: 'nope', baseDir: base });
      expect(r.layers).toHaveLength(4);
      expect(r.layers.every((l) => l.present === false)).toBe(true);
      expect(r.degraded).toBe(false);
      expect(r.errors).toEqual([]);
      expect(r.resolved).toEqual({});
    });

    it('某层 JSON 坏 → 该层跳过 + degraded=true + 记 error，其余层照常生效', () => {
      const bad = join(base, 'bad-json');
      writeJson(join(bad, 'builtin', FILE), { ok: 'builtin' });
      writeJson(join(bad, 'industry', FILE), { ok: 'industry' });
      mkdirSync(join(bad, 'profession'), { recursive: true });
      writeFileSync(join(bad, 'profession', FILE), '{ this is not json', 'utf-8');

      const r = resolveContentLayers({
        orgId: 'o', industry: 'o', profession: 'o', roots: layerRoots(bad),
      });
      const byLayer = new Map(r.layers.map((l) => [l.layer, l]));
      expect(byLayer.get('builtin')?.present).toBe(true);
      expect(byLayer.get('industry')?.present).toBe(true);
      expect(byLayer.get('profession')?.present).toBe(false);
      expect(r.degraded).toBe(true);
      expect(r.errors).toHaveLength(1);
      expect(r.resolved.ok).toBe('industry');
    });

    it('层文档是数组（非 plain object）→ 该层跳过 + degraded=true', () => {
      const arr = join(base, 'array-doc');
      writeJson(join(arr, 'builtin', FILE), [1, 2, 3]);
      const r = resolveContentLayers({ orgId: 'o', industry: 'o', profession: 'o', roots: layerRoots(arr) });
      expect(r.layers.find((l) => l.layer === 'builtin')?.present).toBe(false);
      expect(r.degraded).toBe(true);
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
    });

    it('返回 detached clone —— 改动输出不污染入参/缓存语义', () => {
      const t = join(base, 'detach');
      writeJson(join(t, 'builtin', FILE), { nested: { x: 1 } });
      const r = resolveContentLayers({ orgId: 'o', industry: 'o', profession: 'o', roots: layerRoots(t) });
      const before = JSON.stringify(r.resolved);
      const nested = r.resolved.nested;
      expect(isRecord(nested)).toBe(true);
      if (isRecord(nested)) nested.x = 999;
      const second = resolveContentLayers({ orgId: 'o', industry: 'o', profession: 'o', roots: layerRoots(t) });
      expect(JSON.stringify(second.resolved)).toBe(before);
    });
  });

  describe('loadProfessionPackages 文件驱动发现', () => {
    it('根目录不存在 → 空清单 + degraded=false', () => {
      const r = loadProfessionPackages({ baseDir: join(base, 'no-such-base') });
      expect(r.packages).toEqual([]);
      expect(r.degraded).toBe(false);
      expect(r.errors).toEqual([]);
    });

    it('发现合法包；缺 manifest 的目录跳过；坏 manifest 记 error + degraded', () => {
      const b = join(base, 'discover');
      writeJson(join(b, 'extensions', 'professions', 'good-pkg', 'manifest.json'), { name: 'good-pkg', version: '1.0.0' });
      mkdirSync(join(b, 'extensions', 'professions', 'no-manifest'), { recursive: true });
      writeJson(join(b, 'extensions', 'professions', 'broken-pkg', 'manifest.json'), { version: '1.0.0' });
      mkdirSync(join(b, 'extensions', 'professions', '_draft'), { recursive: true });
      writeJson(join(b, 'extensions', 'professions', '_draft', 'manifest.json'), { name: '_draft' });
      // 域级 manifest.json 是文件不是目录 → 必须被跳过而不是当包
      writeJson(join(b, 'extensions', 'professions', 'manifest.json'), { name: 'professions-domain' });

      const r = loadProfessionPackages({ baseDir: b });
      expect(r.packages.map((p) => p.name)).toEqual(['good-pkg']);
      expect(r.degraded).toBe(true);
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
      expect(r.packages[0]?.dir).toBe(join(b, 'extensions', 'professions', 'good-pkg'));
    });
  });

  describe('detectCustomerFragmentation 反碎片化（宪章 5.2）', () => {
    it('两个客户同键同值 → 告警并列出全部 orgId；同键不同值 → 不告警', () => {
      const cust = join(base, 'cust');
      writeJson(join(cust, 'org-a', FILE), { thresholdOverrides: { K: { warning: 1 } } });
      writeJson(join(cust, 'org-b', FILE), { thresholdOverrides: { K: { warning: 1 } } });
      writeJson(join(cust, 'org-c', FILE), { thresholdOverrides: { K: { warning: 2 } } });

      const r = detectCustomerFragmentation({ customerRoot: cust });
      expect(r.scannedOrgs).toEqual(['org-a', 'org-b', 'org-c']);
      expect(r.degraded).toBe(false);
      expect(r.findings.map((f) => f.key)).toEqual(['thresholdOverrides.K.warning']);
      expect(r.findings[0]?.orgIds).toEqual(['org-a', 'org-b']);
      expect(r.findings[0]?.value).toBe(1);
    });

    it('客户根不存在 → 空报告 + degraded=false', () => {
      const r = detectCustomerFragmentation({ customerRoot: join(base, 'no-customers') });
      expect(r.findings).toEqual([]);
      expect(r.scannedOrgs).toEqual([]);
      expect(r.degraded).toBe(false);
    });

    it('坏客户层文档 → 该 org 跳过 + degraded=true，其余 org 照常参与检测', () => {
      const cust = join(base, 'cust-broken');
      writeJson(join(cust, 'org-a', FILE), { k: 'same' });
      writeJson(join(cust, 'org-b', FILE), { k: 'same' });
      mkdirSync(join(cust, 'org-c'), { recursive: true });
      writeFileSync(join(cust, 'org-c', FILE), 'not json at all', 'utf-8');

      const r = detectCustomerFragmentation({ customerRoot: cust });
      expect(r.scannedOrgs).toEqual(['org-a', 'org-b']);
      expect(r.degraded).toBe(true);
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0]?.orgIds).toEqual(['org-a', 'org-b']);
    });
  });
});
