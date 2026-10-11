/**
 * tests/deploy/content-registry.test.ts — #1465（K10·EXT-WIRE）content-registry 判据测试
 *
 * 取数入口 = 模块的**两个公开面**（`describeContentRegistry()` / `initContentTypes()`）；
 * 其余表项为模块私有（铁律 0-2 导出面纪律）。
 *
 * 覆盖（铁律 48: 正常路径 + 降级路径 + 边界条件，均带 expect 断言）:
 *   ① 正常: 全项覆盖（K12-01 段一后 = 21）× extensions 顶层目录集双向相等 / 状态与分面落在闭合枚举 / 表完整性无问题
 *   ② 正常: initContentTypes() 真实装配 business-model（本卡「接活」项），init+verify 真被执行
 *   ③ 降级: 注入模块返回 errors[] / degraded:true ⇒ report.warnings 非空且 degraded=true
 *   ④ 降级: 注入模块抛错 ⇒ 该项 ok=false 且其余项不受影响（失败隔离）
 *   ⑤ 边界: SYNOVA_CONTENT_REGISTRY_DISABLE=1 回退开关 ⇔ 空报告且不报 degraded
 *   ⑥ 边界: 未知 type 子集 ⇒ 0 项尝试（不抛）
 *   ⑦ 结构: src/init/file-driven-loaders.ts 直连 loader import = 0（V2 唯一真源）
 *
 * 判据源: docs/synova/coordination/施工项登记.ts EXT-WIRE 条目；
 *         山河研究院《extensions内容面规范-v0》§5.2（唯一 type→loader 表）/§3.5（C3/C4）
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  describeContentRegistry,
  initContentTypes,
  type ContentInitReport,
} from '../../src/deploy/content-registry';

const REPO_ROOT = process.cwd();
const EXT_ROOT = join(REPO_ROOT, 'extensions');

/** extensions/ 顶层**目录**集（与注册表的 dir 集做双向比对 —— 不靠手写数字） */
function extensionDirsOnDisk(): string[] {
  return readdirSync(EXT_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

describe('#1465 content-registry — V1 全项有明确状态（K12-01 段一后 = 21/21）', () => {
  it('注册表项与 extensions/ 顶层目录集双向相等', () => {
    const snap = describeContentRegistry();
    expect(snap.entries.map((e) => e.dir).sort()).toEqual(extensionDirsOnDisk());
    expect(snap.counts.total).toBe(23);
  });

  it('type 唯一；status / face 落在闭合枚举内（枚举取自快照单源）', () => {
    const snap = describeContentRegistry();
    const types = snap.entries.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
    expect(snap.statusValues.length).toBe(3);
    for (const e of snap.entries) {
      expect(snap.statusValues).toContain(e.status);
      expect(snap.faceValues).toContain(e.face);
    }
  });

  it('非 reachable 项必须有显式 reason（「已废弃显式化」载体）', () => {
    const snap = describeContentRegistry();
    const nonReachable = snap.entries.filter((e) => e.status !== 'reachable');
    expect(nonReachable.length).toBeGreaterThanOrEqual(1);
    for (const e of nonReachable) {
      expect(typeof e.reason).toBe('string');
      expect((e.reason ?? '').length).toBeGreaterThan(10);
    }
  });

  it('reachable 项必须有 loader 或 readers（不得空挂）', () => {
    const snap = describeContentRegistry();
    const reachable = snap.entries.filter((e) => e.status === 'reachable');
    expect(reachable.length).toBe(18);
    for (const e of reachable) {
      expect(e.loader !== undefined || (e.readers ?? []).length > 0).toBe(true);
    }
  });

  it('表自身完整性 = 无问题；每个 loader.module 都在 moduleKeys 内', () => {
    const snap = describeContentRegistry();
    expect(snap.integrityProblems).toEqual([]);
    for (const e of snap.entries) {
      if (e.loader === undefined) continue;
      expect(snap.moduleKeys).toContain(e.loader.module);
      const rel = e.loader.module.replace('../', 'src/');
      expect(existsSync(join(REPO_ROOT, `${rel}.ts`))).toBe(true);
    }
  });

  it('快照是防御性拷贝（改快照不动真源）', () => {
    const a = describeContentRegistry();
    a.entries[0].type = '__mutated__';
    const b = describeContentRegistry();
    expect(b.entries[0].type).not.toBe('__mutated__');
  });
});

describe('#1465 content-registry — 正常路径（真实装配，非 grep）', () => {
  it('business-models 接活：init 真跑到 loadBusinessModels 且 ok', async () => {
    const report = await initContentTypes({ types: ['business-model'] });
    expect(report.attempted).toBe(1);
    expect(report.loaded).toBe(1);
    expect(report.degraded).toBe(false);
    const item = report.results[0];
    expect(item.type).toBe('business-model');
    expect(item.ok).toBe(true);
    expect(item.verified).toContain('loadBusinessModels');
  });

  it('非 reachable 项（retired / pending-cto）不入装配面', async () => {
    const snap = describeContentRegistry();
    const notWired = snap.entries.filter((e) => e.status !== 'reachable').map((e) => e.type);
    // retired×2（engine / tools）＋ pending-cto×2（llm-provider；K12-01 段一 presets）= 4
    expect(notWired.length).toBe(5);
    const report = await initContentTypes();
    for (const t of notWired) {
      expect(report.results.some((r) => r.type === t)).toBe(false);
    }
  });
});

describe('#1465 content-registry — 降级路径（铁律 31 不丢信号 / 失败隔离）', () => {
  /** 注入缝的伪模块：按 type 返回预设的 loader 返回形状 */
  const stubs = {
    '../l3/business-model-loader': () => Promise.resolve({ loadBusinessModels: () => ({ errors: ['a 解析失败', 'b 解析失败'] }) }),
    '../l3/report-template-loader': () => Promise.resolve({ loadTemplate: () => { throw new Error('模板解析崩了'); } }),
  };

  it('loader 自报 errors[] ⇒ warnings 非空 + degraded=true（信号不丢）', async () => {
    const report: ContentInitReport = await initContentTypes({
      types: ['business-model'],
      modules: stubs,
    });
    expect(report.loaded).toBe(1);
    expect(report.warnings.length).toBe(1);
    expect(report.warnings[0]).toContain('2 条错误');
    expect(report.degraded).toBe(true);
  });

  it('loader 抛错 ⇒ 该项 ok=false + error 入 errors[] + degraded=true', async () => {
    const report = await initContentTypes({ types: ['report-template'], modules: stubs });
    expect(report.loaded).toBe(0);
    const item = report.results[0];
    expect(item.ok).toBe(false);
    expect(item.error).toContain('模板解析崩了');
    expect(report.errors.length).toBe(1);
    expect(report.degraded).toBe(true);
  });

  it('失败隔离：一项抛错不影响其它项（逐项 try/catch）', async () => {
    const report = await initContentTypes({
      types: ['report-template', 'business-model'],
      modules: stubs,
    });
    expect(report.attempted).toBe(2);
    expect(report.loaded).toBe(1);
    expect(report.results.find((r) => r.type === 'business-model')?.ok).toBe(true);
    expect(report.results.find((r) => r.type === 'report-template')?.ok).toBe(false);
  });

  it('注入模块表缺键 ⇒ 该 type 判失败（不静默跳过）', async () => {
    const report = await initContentTypes({ types: ['business-model'], modules: {} });
    expect(report.loaded).toBe(0);
    expect(report.errors[0]).toContain('MODULE_IMPORTS 缺键');
  });
});

describe('#1465 content-registry — 边界条件', () => {
  it('SYNOVA_CONTENT_REGISTRY_DISABLE=1 ⇒ 空报告且 degraded=false（回退开关）', async () => {
    const prev = process.env.SYNOVA_CONTENT_REGISTRY_DISABLE;
    process.env.SYNOVA_CONTENT_REGISTRY_DISABLE = '1';
    try {
      const report = await initContentTypes();
      expect(report.attempted).toBe(0);
      expect(report.loaded).toBe(0);
      expect(report.degraded).toBe(false);
      expect(report.results).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.SYNOVA_CONTENT_REGISTRY_DISABLE;
      else process.env.SYNOVA_CONTENT_REGISTRY_DISABLE = prev;
    }
  });

  it('未知 type 子集 ⇒ 0 项尝试（不抛）', async () => {
    const report = await initContentTypes({ types: ['__no_such_type__'] });
    expect(report.attempted).toBe(0);
    expect(report.degraded).toBe(false);
  });
});

describe('#1465 content-registry — CALL 段独立观测（M4 反例固化）', () => {
  /**
   * 🔴 本组是复核员 M4 的**永久固化**：
   *   M4 = 「在 `initContentTypes` 里保留 `verified` 记账、删掉真实 init 调用」⇒ 旧探针（读自报）仍判绿。
   *   根治 = 观测点移到**模块边界**（调用方自己的包装计数），与自报无关。
   *   ⇒ 施加 M4 后本组第 1 条**必红**（计数为 0）—— 这就是「反例固化」，不再依赖一次性人工演示。
   */
  it('边界计数：注入模块的 loadBusinessModels 被真实调用恰好 1 次（M4 变异下必红）', async () => {
    const real = await import('../../src/l3/business-model-loader');
    let calls = 0;
    const spy: Record<string, unknown> = { ...real };
    spy.loadBusinessModels = (...args: unknown[]) => {
      calls += 1;
      return (real.loadBusinessModels as (...a: unknown[]) => unknown)(...args);
    };
    const report = await initContentTypes({
      types: ['business-model'],
      modules: { '../l3/business-model-loader': async () => spy },
    });
    expect(report.loaded).toBe(1);
    expect(calls).toBe(1); // ← 删掉真实调用（M4）⇒ calls = 0 ⇒ 本行红
  });

  it('边界计数覆盖 verify：声明了 verify 的类型，其 verify 函数同样被计数', async () => {
    const real = await import('../../src/l3/rule-loader');
    let initCalls = 0;
    let verifyCalls = 0;
    const spy: Record<string, unknown> = { ...real };
    spy.loadRules = (...args: unknown[]) => {
      initCalls += 1;
      return (real.loadRules as (...a: unknown[]) => unknown)(...args);
    };
    spy.getUpgradeStrategy = (...args: unknown[]) => {
      verifyCalls += 1;
      return (real.getUpgradeStrategy as (...a: unknown[]) => unknown)(...args);
    };
    const report = await initContentTypes({
      types: ['rule'],
      modules: { '../l3/rule-loader': async () => spy },
    });
    expect(report.loaded).toBe(1);
    expect(initCalls).toBe(1);
    expect(verifyCalls).toBe(1);
  });

  it('诚实性：模块未提供声明的导出 ⇒ 该项判失败（"说谎的模块"无法伪造绿灯）', async () => {
    const report = await initContentTypes({
      types: ['business-model'],
      modules: {
        // 该模块「看起来」成功返回，但根本没有声明要调用的导出
        '../l3/business-model-loader': async () => ({ loadBusinessModels: undefined }),
      },
    });
    expect(report.loaded).toBe(0);
    expect(report.results[0].ok).toBe(false);
    expect(report.errors[0]).toContain('导出缺失或非函数');
  });
});

describe('#1465 content-registry — V2 唯一 type→loader 真源', () => {
  it('src/init/file-driven-loaders.ts 直连 loader import = 0，唯一装配入口 = registry', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/init/file-driven-loaders.ts'), 'utf-8');
    const codeLines = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)) // 剥注释行（说明文字不是接线）
      .join('\n');
    expect(codeLines.match(/await import\('[^']*-loader'\)/g) ?? []).toEqual([]);
    expect(codeLines).toContain("await import('../deploy/content-registry')");
  });
});
