/**
 * tests/extensions/layer-precedence.test.ts — L1.5 专业包层**验收**测试（卡 #1056 §⑥）
 *
 * 判据映射：
 *   V0（前置，卡面 §③ 约束 6）既有层系统的归并内核实测（config-layers）
 *   V1 一个专业包装到**两个客户都生效**（真实路径：仓库内 extensions/professions/**）
 *   V2 本文件 exit = 0（判据原文：`npx vitest run tests/extensions/layer-precedence.test.ts`）
 *   V3 覆盖顺序 custom > profession > industry > builtin —— **逐层断言"胜出者身份"**
 *   V4 叠加 = 覆盖非替换（下层独有键必须保留）
 *   V5/V6 反例由**真删真改**触发（改坏源码后本文件的 V3/V4 必红），不在此文件内模拟
 *   P1 补充判据：L1.5 包目录在 extensions/ 下**加文件即可生效**，无需改宿主 TS
 *
 * ⚠️ 判别性要求（Lead 2026-10-10 裁定 三.5）：断言必须能区分"层序正确"与"层序倒置"。
 *    反面教材：tests/playbook/playbook-loader.test.ts 只断言"总数不变/不报错"，
 *    在优先级**完全倒置**的实现下仍然通过（#1056 证据件已实测）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  CONTENT_LAYER_ORDER,
  resolveContentLayers,
  loadProfessionPackages,
} from '../../src/extensions/layer-resolver';

const FILE = 'thresholds.json';
const REPO = process.cwd();

// 仓库内真实的 L1.5 专业包（判据 V1 必须用真实路径，不许只贴 mock）
const REAL_PROFESSION = 'chain-retail-expansion';
const REAL_PROFESSION_ROOT = join(REPO, 'extensions', 'professions', REAL_PROFESSION);
const PROFESSIONS_DIR = join(REPO, 'extensions', 'professions');

let fx = '';        // 四层同名键 fixture
let orgs = '';      // 两个客户层 root fixture

function writeJson(absPath: string, value: unknown): void {
  mkdirSync(join(absPath, '..'), { recursive: true });
  writeFileSync(absPath, JSON.stringify(value), 'utf-8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 点分路径取值（避免 `as any`；路径不存在返回 undefined）。 */
function pick(doc: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (isRecord(acc) ? acc[key] : undefined), doc);
}

/** 四层 fixture 的根目录；每层 = 一个目录 + thresholds.json。 */
function fxRoots(): { builtin: string; industry: string; profession: string; custom: string } {
  return {
    builtin: join(fx, 'builtin'),
    industry: join(fx, 'industry'),
    profession: join(fx, 'profession'),
    custom: join(fx, 'custom'),
  };
}

function setLayers(present: readonly string[], doc: (layer: string) => unknown): void {
  for (const layer of CONTENT_LAYER_ORDER) {
    rmSync(join(fx, layer), { recursive: true, force: true });
    if (!present.includes(layer)) continue;
    writeJson(join(fx, layer, FILE), doc(layer));
  }
}

function resolveFx(): { resolved: Record<string, unknown>; layers: ReturnType<typeof resolveContentLayers>['layers']; degraded: boolean; errors: string[] } {
  const r = resolveContentLayers({ orgId: 'fx-org', industry: 'fx', profession: 'fx', roots: fxRoots() });
  return { resolved: r.resolved, layers: r.layers, degraded: r.degraded, errors: r.errors };
}

describe('#1056 L1.5 专业包层 — 层叠覆盖验收', () => {
  beforeAll(() => {
    fx = mkdtempSync(join(tmpdir(), 'k4-1056-fx-'));
    orgs = mkdtempSync(join(tmpdir(), 'k4-1056-orgs-'));
  });

  afterAll(() => {
    rmSync(fx, { recursive: true, force: true });
    rmSync(orgs, { recursive: true, force: true });
    // P1 探针包必须清干净（保证 git status 无残留）
    rmSync(join(PROFESSIONS_DIR, 'zz-k4-1056-probe'), { recursive: true, force: true });
  });

  // ═══ V0 前置：既有归并内核（卡面 §③ 约束 6「先把已有三层验出来」） ═══
  describe('V0 前置：既有层系统 src/config/config-layers.ts（本卡复用的归并内核）', () => {
    it('四层逐层落 + 稀疏 patch 保留下层键 + 数组整值替换', async () => {
      const { LAYER_ORDER, resolveLayers, mergeLayers } = await import('../../src/config/config-layers');
      expect([...LAYER_ORDER]).toEqual(['default', 'industry', 'customer', 'workspace']);

      const layers = {
        default: { a: 'default', dOnly: 1, nested: { x: 1, y: 1 } },
        industry: { a: 'industry', bOnly: 1, nested: { y: 2 } },
        customer: { a: 'customer', cOnly: 1 },
        workspace: { a: 'workspace' },
      };
      // 逐层移除 → 胜出者身份必须逐层回退（判别性断言，非"总数不变"）
      expect(resolveLayers(layers).a).toBe('workspace');
      expect(resolveLayers({ default: layers.default, industry: layers.industry, customer: layers.customer }).a).toBe('customer');
      expect(resolveLayers({ default: layers.default, industry: layers.industry }).a).toBe('industry');
      expect(resolveLayers({ default: layers.default }).a).toBe('default');

      // 叠加 = 覆盖非替换：下层独有键（含嵌套子键）保留
      const full = resolveLayers(layers);
      expect(full.dOnly).toBe(1);
      expect(full.bOnly).toBe(1);
      expect(full.cOnly).toBe(1);
      expect(pick(full, 'nested.x')).toBe(1);
      expect(pick(full, 'nested.y')).toBe(2);

      // 稀疏 patch / 数组整值替换
      expect(mergeLayers({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 });
      expect(mergeLayers({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
      expect(mergeLayers({ arr: [1, 2, 3] }, { arr: [9] })).toEqual({ arr: [9] });
    });
  });

  // ═══ V3 覆盖顺序：逐层断言"胜出者身份" ═══
  describe('V3 覆盖顺序 custom > profession > industry > builtin（逐层胜出者身份）', () => {
    it('四层同名键 → custom 胜；逐层移除 → 依次落到 profession → industry → builtin', () => {
      const cases: { present: string[]; winner: string }[] = [
        { present: ['builtin', 'industry', 'profession', 'custom'], winner: 'custom' },
        { present: ['builtin', 'industry', 'profession'], winner: 'profession' },
        { present: ['builtin', 'industry'], winner: 'industry' },
        { present: ['builtin'], winner: 'builtin' },
      ];
      for (const c of cases) {
        setLayers(c.present, (layer) => ({ winner: layer, shared: layer }));
        const r = resolveFx();
        expect(r.degraded, `投放 [${c.present.join(',')}] 不应降级`).toBe(false);
        expect(r.resolved.winner, `投放 [${c.present.join(',')}] 的胜出者应是 ${c.winner}`).toBe(c.winner);
        expect(r.resolved.shared, `投放 [${c.present.join(',')}] 的 shared 应是 ${c.winner}`).toBe(c.winner);
      }
    });

    it('层序常量把 profession 夹在 industry 与 custom 之间（其余顺序仍能被证伪）', () => {
      const order = [...CONTENT_LAYER_ORDER];
      expect(order).toEqual(['builtin', 'industry', 'profession', 'custom']);
      expect(order.indexOf('profession')).toBeGreaterThan(order.indexOf('industry'));
      expect(order.indexOf('custom')).toBeGreaterThan(order.indexOf('profession'));
      expect(order.indexOf('industry')).toBeGreaterThan(order.indexOf('builtin'));
    });

    it('provenance：同名键的 owner 是最高层，且每键恰一个 owner', () => {
      setLayers(['builtin', 'industry', 'profession', 'custom'], (layer) => ({
        winner: layer,
        [`only_${layer}`]: true,
      }));
      const r = resolveFx();
      const owner = new Map<string, string>();
      for (const l of r.layers) for (const k of l.contributedKeys) owner.set(k, l.layer);
      expect(owner.get('winner')).toBe('custom');
      expect(owner.get('only_builtin')).toBe('builtin');
      expect(owner.get('only_industry')).toBe('industry');
      expect(owner.get('only_profession')).toBe('profession');
      expect(owner.get('only_custom')).toBe('custom');
    });
  });

  // ═══ V4 叠加 = 覆盖非替换 ═══
  describe('V4 叠加语义 = 覆盖非替换（下层独有键必须保留）', () => {
    it('高层同名键整值胜出；低层独有键（含嵌套子键）保留', () => {
      setLayers(['builtin', 'profession'], (layer) =>
        layer === 'builtin'
          ? { shared: 'builtin', builtinOnly: 'keep', nested: { x: 'keep-x', y: 'builtin-y' } }
          : { shared: 'profession', nested: { y: 'profession-y' } });
      const r = resolveFx();
      expect(r.degraded).toBe(false);
      expect(r.resolved.shared).toBe('profession');            // 同名键 → 高层整值胜出
      expect(r.resolved.builtinOnly).toBe('keep');             // 低层独有顶层键保留
      expect(pick(r.resolved, 'nested.x')).toBe('keep-x');     // 低层独有嵌套子键保留
      expect(pick(r.resolved, 'nested.y')).toBe('profession-y');
    });

    it('数组是整值替换（不逐元素混合）', () => {
      setLayers([], () => ({}));
      writeJson(join(fx, 'builtin', FILE), { list: [1, 2, 3] });
      writeJson(join(fx, 'profession', FILE), { list: [9] });
      const r = resolveFx();
      expect(r.resolved.list).toEqual([9]);
    });
  });

  // ═══ V1 一个专业包装到两个客户都生效（真实路径） ═══
  describe('V1 同一 L1.5 专业包在两个客户（orgId）下都生效 — 真实路径', () => {
    it('真实包 extensions/professions/chain-retail-expansion 在两个 orgId 下均被命中且内容生效', () => {
      const alphaRoot = join(orgs, 'org-alpha');
      const betaRoot = join(orgs, 'org-beta');
      writeJson(join(alphaRoot, FILE), { customer: 'org-alpha', shared: 'alpha' });
      writeJson(join(betaRoot, FILE), { customer: 'org-beta', shared: 'beta' });

      const base = { industry: 'retail-ecommerce', profession: REAL_PROFESSION };
      const a = resolveContentLayers({ ...base, orgId: 'org-alpha', roots: { custom: alphaRoot } });
      const b = resolveContentLayers({ ...base, orgId: 'org-beta', roots: { custom: betaRoot } });

      // (1) 两层都用**真实仓库路径**命中 L1.5 包
      for (const [name, r] of [['org-alpha', a], ['org-beta', b]] as const) {
        const l15 = r.layers.find((l) => l.layer === 'profession');
        expect(l15?.present, `${name}: profession 层应命中`).toBe(true);
        expect(l15?.root, `${name}: profession 根应是仓库真实路径`).toBe(REAL_PROFESSION_ROOT);
        // (2) 包内内容在两个客户下都生效
        expect(pick(r.resolved, 'thresholdOverrides.F1_KZ.critical'), `${name}: 专业包阈值应生效`).toBe(1.2);
        expect(pick(r.resolved, 'thresholdOverrides.F1_KZ.warning'), `${name}: 专业包阈值应生效`).toBe(1.6);
        expect(pick(r.resolved, 'expansionGate.singleStorePaybackMonths'), `${name}: 专业包独有块应生效`).toBe(18);
      }

      // (3) 两个客户各自不同 —— 证明不是"装一次给一个客户"
      expect(a.resolved.shared).toBe('alpha');
      expect(b.resolved.shared).toBe('beta');
      expect(a.resolved.customer).toBe('org-alpha');
      expect(b.resolved.customer).toBe('org-beta');

      // (4) 真实叠加：L0/L1 的独有键在专业包介入后仍保留（覆盖非替换的实际路径证据）
      expect(a.resolved.industry).toBe('retail-ecommerce');                               // L1 覆盖 L0
      expect(pick(a.resolved, 'thresholdOverrides.inventory-turnover.warning')).toBe(4.0); // L1 独有键保留
      expect(pick(a.resolved, 'thresholdOverrides.F2_runway.warning')).toBe(12);           // L0 独有键保留
    });
  });

  // ═══ P1 补充判据：加文件即可生效 ═══
  describe('P1 文件驱动：extensions/ 下加文件即生效，无需改宿主 TS', () => {
    it('运行时新建一个专业包目录 → 被 loadProfessionPackages 发现且参与层叠', () => {
      const probeDir = join(PROFESSIONS_DIR, 'zz-k4-1056-probe');
      rmSync(probeDir, { recursive: true, force: true });
      writeJson(join(probeDir, 'manifest.json'), {
        $schema: 'https://synova.dev/schemas/extension-manifest-v1.json',
        name: 'zz-k4-1056-probe',
        version: '1.0.0',
        type: 'profession-package',
        entryPoint: FILE,
      });
      writeJson(join(probeDir, FILE), { probeOnly: 'yes', thresholdOverrides: { F1_KZ: { warning: 9, critical: 9 } } });

      const found = loadProfessionPackages();
      expect(found.degraded).toBe(false);
      expect(found.packages.map((p) => p.name)).toContain('zz-k4-1056-probe');

      const r = resolveContentLayers({
        orgId: 'probe-org',
        industry: 'general-enterprise',
        profession: 'zz-k4-1056-probe',
      });
      expect(r.layers.find((l) => l.layer === 'profession')?.present).toBe(true);
      expect(r.resolved.probeOnly).toBe('yes');
      expect(pick(r.resolved, 'thresholdOverrides.F1_KZ.critical')).toBe(9);

      rmSync(probeDir, { recursive: true, force: true });
      expect(existsSync(probeDir)).toBe(false);
    });
  });

  // ═══ V7 接线判据（CTO 2026-10-11「甲」裁定：接线 = registry 按名声明） ═══
  describe('V7 接线：L1.5 经 content-registry 声明 × boot 真执行（"接线了 ≠ 被执行了"）', () => {
    /**
     * 本组是「删掉即报红」的判别性夹具，针对裁定后的新接线形态：
     *   · 删掉 registry 的 `professions` 项（或把 loader.module/init 改名）⇒ ①② 必红；
     *   · 把 `initProfessionLayer()` 的层叠自检删掉（只发现不验证）⇒ ④ 必红；
     *   · 把 `CONTENT_LAYER_ORDER` 的 profession 删掉 ⇒ 本文件 V3/V4 与 ④ 同时红。
     * 断言点**不是** grep 静态文本：③④ 都真跑 `initContentTypes()` / `initProfessionLayer()` 并读返回值。
     */
    it('① registry 登记了 professions 项，且 loader 按名指向 layer-resolver 的 initProfessionLayer', async () => {
      const { describeContentRegistry } = await import('../../src/deploy/content-registry');
      const snap = describeContentRegistry();
      const entry = snap.entries.find((e) => e.dir === 'professions');

      expect(entry, 'registry 必须登记 professions 目录').toBeDefined();
      expect(entry?.status).toBe('reachable');
      expect(entry?.loader?.module).toBe('../extensions/layer-resolver');
      expect(entry?.loader?.init).toBe('initProfessionLayer');
      // 模块键在 MODULE_IMPORTS 内（否则 boot 装配时「缺键」硬失败）
      expect(snap.moduleKeys).toContain('../extensions/layer-resolver');
      // 注册表自身完整性零问题（项数硬钉与磁盘目录集的一致性由该检查兜底）
      expect(snap.integrityProblems).toEqual([]);
    });

    it('② boot 装配真调 layer-resolver：initProfessionLayer 被执行且该项 ok（非静态判据）', async () => {
      const { initContentTypes } = await import('../../src/deploy/content-registry');
      const report = await initContentTypes({ types: ['profession'] });

      expect(report.attempted).toBe(1);
      expect(report.loaded).toBe(1);
      const item = report.results[0];
      expect(item.type).toBe('profession');
      expect(item.ok).toBe(true);
      // 真实执行过 init 的证据（registry 只在真调用成功后记账）
      expect(item.verified).toContain('initProfessionLayer');
    });

    it('③ boot 自检覆盖真实专业包，且每个包的内容都参与层叠（unwired 为空）', async () => {
      const { initProfessionLayer } = await import('../../src/extensions/layer-resolver');
      const out = initProfessionLayer();

      // 真实包必须被发现（extensions/professions/chain-retail-expansion）
      expect(out.packages).toContain('chain-retail-expansion');
      // 发现到 ≠ 叠得进去：本数组非空即接线失败
      expect(out.unwired).toEqual([]);
      // 行业层可寻址值（boot 自检用既有 L0 基线行业包，不猜业务行业）
      expect(out.industry).toBe('general-enterprise');
    });

    it('④ 判别性：层叠自检对「发现到但叠不进去」真报警（构造 unwired 真值）', async () => {
      const probeDir = join(PROFESSIONS_DIR, 'zz-k4-1056-unwired');
      rmSync(probeDir, { recursive: true, force: true });
      // 有 manifest 会被发现；但**没有** thresholds.json ⇒ profession 层内容取不到
      writeJson(join(probeDir, 'manifest.json'), {
        $schema: 'https://synova.dev/schemas/extension-manifest-v1.json',
        name: 'zz-k4-1056-unwired',
        version: '1.0.0',
        type: 'profession-package',
      });
      try {
        const { initProfessionLayer } = await import('../../src/extensions/layer-resolver');
        const out = initProfessionLayer();

        expect(out.packages).toContain('zz-k4-1056-unwired');
        expect(out.unwired).toContain('zz-k4-1056-unwired');
        expect(out.degraded).toBe(true);
        expect(out.errors.join(' | ')).toContain('未参与层叠');
      } finally {
        rmSync(probeDir, { recursive: true, force: true });
      }
      expect(existsSync(probeDir)).toBe(false);
    });

    it('⑤ registry 装配报告把降级信号往上传（不静默吞）', async () => {
      const { initContentTypes } = await import('../../src/deploy/content-registry');
      const report = await initContentTypes({ types: ['profession'] });
      // 真实仓库状态下：包内容齐备 ⇒ 无降级；本断言锁"信号通路存在且被读"
      expect(report.errors).toEqual([]);
      expect(report.degraded).toBe(false);
    });
  });
});
