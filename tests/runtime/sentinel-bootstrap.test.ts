/**
 * tests/runtime/sentinel-bootstrap.test.ts — M5 卡1（#704）自举契约（单测级）
 *
 * 铁律 12: 不 mock 装载链——本文件跑**真实** registry／loader／content-registry／内置适配器，
 *          断言「MCP 启动期自举」真的把 46 目录 ＋ 4 内置装进全局注册表（禁 `vi.mock` 进本文件）。
 *
 * 契约:
 *   @input  — src/agent/sentinel-service.ts `ensureSentinelRegistryLoaded()`（无参）
 *   @output — 3 条用例：
 *             ① 自举契约：ok===true ∧ dirCount===46 ∧ builtinCount===4 ∧ total===E
 *                ＋ SPEC §9.3 ⑥⑦⑧⑨ 内容断言（D⊆listIds／extras 集合===4 内置／layer 与 manifest 一致／
 *                无重复／provenance 引用相等）
 *             ② 幂等：除 alreadyLoaded 外同形；第二次 alreadyLoaded===true；count()／实例引用不变
 *             ③ 损坏 fixture 负例（单测级，非全链路）：非法 manifest ⇒ ok:false ∧ errors 含解析失败
 *   @degraded — 用例 ③ 主动制造降级并断言降级信号（ok:false ∧ degraded:true ∧ errors 非空）
 *   @error  — 无（`ensureSentinelRegistryLoaded()` 契约**从不抛**；抛即测试红）
 *
 * E 口径（SPEC §9.3）: **独立 FS 派生**，不调 `loadSentinels()`、不用 `manifest.id`、**不写死 50**；
 *   D = `sentinel-${manifest.name}`（与 src/sentinel/sentinel-loader.ts:250 的实际派生规则逐字一致），
 *   E = |D| ＋ `src/sentinel/adapters/*-sentinel.{ts,js}` 文件数（46 ＋ 4 = 50，as_of 2a021e0e0）。
 *   隔离：`destroySentinelRegistry()`（src/sentinel/registry.ts:146）＋ `clearSentinelCache()`。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SENTINELS_ROOT = path.join(REPO_ROOT, 'extensions', 'sentinels');
const ADAPTERS_DIR = path.join(REPO_ROOT, 'src', 'sentinel', 'adapters');

/** 4 内置哨兵的注册 id（SPEC §9.3 ⑥：extras 集合**相等**断言，非仅计数） */
const BUILTIN_IDS = [
  'sentinel-cash-flow',
  'sentinel-cpc',
  'sentinel-goal-alignment',
  'sentinel-integration-health',
];

interface DerivedDirSentinel {
  /** 目录名（报错时指名道姓） */
  dir: string;
  /** 派生注册 id：`sentinel-${manifest.name}`（loader 的实际规则，**不用 manifest.id**） */
  id: string;
  /** manifest 声明的 8 层模型字段（缺失时按 listSentinels 口径回退 'growth'） */
  layer: string | undefined;
  /** 注册名：`manifest.displayName || manifest.name`（loader 同规则） */
  name: string;
}

/**
 * 独立 FS 派生期望集合（不复用被测装载链 —— 否则是"自证绿"）。
 *
 * 目录口径与 loader 一致：跳过 `shared`（工具库）与 `_` 开头（模板/归档）。
 * 每个目录必须有 `manifest.json`（缺 ⇒ 断言红并列出目录名，SPEC §9.3 ②）。
 */
function deriveExpected(): { dirSentinels: DerivedDirSentinel[]; dirCount: number; builtinCount: number; E: number } {
  const dirSentinels: DerivedDirSentinel[] = [];
  const missingManifest: string[] = [];
  for (const entry of readdirSync(SENTINELS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'shared' || entry.name.startsWith('_')) continue;
    const manifestPath = path.join(SENTINELS_ROOT, entry.name, 'manifest.json');
    if (!existsSync(manifestPath)) {
      missingManifest.push(entry.name);
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string;
      layer?: string;
      displayName?: string;
    };
    dirSentinels.push({
      dir: entry.name,
      id: `sentinel-${manifest.name}`,
      layer: manifest.layer,
      name: manifest.displayName || manifest.name,
    });
  }
  // ② 每个目录都有 manifest.json（缺 ⇒ 报目录名）
  expect(missingManifest, `缺 manifest.json 的哨兵目录: ${missingManifest.join(', ')}`).toEqual([]);
  const builtinCount = readdirSync(ADAPTERS_DIR).filter((f) => /-sentinel\.(ts|js)$/.test(f)).length;
  return {
    dirSentinels,
    dirCount: dirSentinels.length,
    builtinCount,
    E: dirSentinels.length + builtinCount,
  };
}

/** 清注册表 ＋ 装载缓存（两次自举之间不得复用旧 cache/registry） */
async function clearRegistryState(): Promise<void> {
  const { destroySentinelRegistry } = await import('../../src/sentinel/registry');
  const { clearSentinelCache } = await import('../../src/sentinel/sentinel-loader');
  destroySentinelRegistry();
  clearSentinelCache();
}

/** 清环境注入缝（D751 fixture 缝 ＋ content-registry 回退开关） */
function clearEnv(): void {
  delete process.env.SENTINELS_FIXTURE_DIR;
  delete process.env.SYNOVA_CONTENT_REGISTRY_DISABLE;
}

beforeEach(async () => {
  clearEnv();
  await clearRegistryState();
});

afterEach(async () => {
  clearEnv();
  await clearRegistryState();
});

describe('M5 卡1 自举契约（真实 registry，单测级）', () => {
  it('① 自举契约：ok===true ∧ dirCount===46 ∧ builtinCount===4 ∧ total===E（E 独立派生，as_of 50）', async () => {
    const { dirSentinels, dirCount, builtinCount, E } = deriveExpected();
    // ① 口径锚（独立 FS 派生；不写死 total，E 由 46＋4 派生）
    expect(dirCount).toBe(46);
    expect(builtinCount).toBe(4);

    const { ensureSentinelRegistryLoaded, listSentinels } = await import('../../src/agent/sentinel-service');
    const result = await ensureSentinelRegistryLoaded();

    // 契约字段：ok 规则（!degraded ∧ errors 空 ∧ dirCount>0 ∧ total===dir+builtin）
    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.alreadyLoaded).toBe(false); // 本用例前 registry 已被 destroy
    expect(result.dirCount).toBe(dirCount);
    expect(result.builtinCount).toBe(builtinCount);
    expect(result.total).toBe(E);
    expect(result.code).toBeUndefined();

    // ⑤ L2 出口：listSentinels 与自举计数一致
    const list = await listSentinels();
    expect(list.ok).toBe(true);
    expect(list.total).toBe(E);
    expect(list.sentinels).toHaveLength(E);

    const ids = list.sentinels.map((s) => s.id);
    const listIdSet = new Set(ids);
    const byId = new Map(list.sentinels.map((s) => [s.id, s]));

    // ⑥ D ⊆ listIds（missing===0）；extras 集合**相等**于 4 内置
    const missing = dirSentinels.filter((d) => !listIdSet.has(d.id)).map((d) => d.dir);
    expect(missing).toEqual([]);
    const extras = ids.filter((id) => !dirSentinels.some((d) => d.id === id));
    expect(new Set(extras)).toEqual(new Set(BUILTIN_IDS));

    // ⑦ 每个 d∈D：listSentinels 的 layer === manifest.layer（缺失回退 'growth'，同 listSentinels 口径）
    const layerMismatch = dirSentinels
      .filter((d) => byId.get(d.id)?.layer !== (d.layer ?? 'growth'))
      .map((d) => d.dir);
    expect(layerMismatch).toEqual([]);

    // ⑧ 无重复：Set.size === E
    expect(listIdSet.size).toBe(E);

    // ⑨ provenance（防"按 manifest 造 E 条"）：
    //   内置 = registry 里就是 adapters 模块导出的**同一个实例**（引用相等）；
    //   目录 = 实例由 loader 派生规则注册（id/name 与 manifest 一致），且不含内置实例。
    const { getSentinelRegistry } = await import('../../src/sentinel/registry');
    const registry = getSentinelRegistry();
    expect(registry.count()).toBe(E);

    const cashFlowModule = (await import(
      pathToFileURL(path.join(ADAPTERS_DIR, 'cash-flow-sentinel.ts')).href
    )) as Record<string, unknown>;
    const builtinInstance = Object.values(cashFlowModule).find(
      (v) => !!v && typeof v === 'object' && typeof (v as { check?: unknown }).check === 'function',
    );
    expect(builtinInstance).toBeDefined();
    expect(registry.get('sentinel-cash-flow')).toBe(builtinInstance);

    const sampleDir = dirSentinels[0];
    expect(sampleDir).toBeDefined();
    const dirInstance = registry.get(sampleDir.id);
    expect(dirInstance).toBeDefined();
    expect(dirInstance?.config.id).toBe(sampleDir.id);
    expect(dirInstance?.config.name).toBe(sampleDir.name);
    // 目录实例不是任何内置实例（防把内置名单混进目录集合）
    for (const builtinId of BUILTIN_IDS) {
      expect(dirInstance).not.toBe(registry.get(builtinId));
    }
  });

  it('② 幂等：除 alreadyLoaded 外同形结果；第二次 alreadyLoaded===true；registry.count() 不变', async () => {
    const { dirSentinels } = deriveExpected();
    const { ensureSentinelRegistryLoaded } = await import('../../src/agent/sentinel-service');
    const { getSentinelRegistry } = await import('../../src/sentinel/registry');

    const first = await ensureSentinelRegistryLoaded();
    expect(first.ok).toBe(true);
    expect(first.alreadyLoaded).toBe(false);

    const registry = getSentinelRegistry();
    const countAfterFirst = registry.count();
    const sampleDirId = dirSentinels[0].id;
    const instanceAfterFirst = registry.get(sampleDirId);
    expect(instanceAfterFirst).toBeDefined();

    const second = await ensureSentinelRegistryLoaded();

    // 「除 alreadyLoaded 外同形」
    expect(second.ok).toBe(first.ok);
    expect(second.total).toBe(first.total);
    expect(second.dirCount).toBe(first.dirCount);
    expect(second.builtinCount).toBe(first.builtinCount);
    expect(second.errors).toEqual(first.errors);
    expect(second.degraded).toBe(first.degraded);
    expect(second.code).toBe(first.code);
    // 第二次已装载
    expect(second.alreadyLoaded).toBe(true);
    // count 不变 ＝ 幂等（register 重复跳过，不重复登记）
    expect(registry.count()).toBe(countAfterFirst);
    // 实例引用不变 ＝ 第二次没有重建/替换（provenance 的幂等面）
    expect(registry.get(sampleDirId)).toBe(instanceAfterFirst);
  });

  it('③ 单测级，非全链路：损坏 fixture（非法 manifest）⇒ ok:false ∧ errors 含解析失败', async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'synova-m5-broken-'));
    try {
      mkdirSync(path.join(fixtureRoot, 'broken-sentinel'));
      writeFileSync(path.join(fixtureRoot, 'broken-sentinel', 'manifest.json'), '{ 这不是合法 JSON ');
      process.env.SENTINELS_FIXTURE_DIR = fixtureRoot;
      // fixture 缝惰性求值（sentinel-loader.ts:55-57）⇒ 设 env 后必须清 cache/registry 才生效
      await clearRegistryState();

      const { ensureSentinelRegistryLoaded } = await import('../../src/agent/sentinel-service');
      const result = await ensureSentinelRegistryLoaded();

      expect(result.ok).toBe(false);
      expect(result.degraded).toBe(true);
      expect(result.code).toBe('SENTINEL_BOOTSTRAP_FAILED');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(' | ')).toContain('解析失败');
      // 不得把「损坏」读成「0 哨兵成功」
      expect(result.dirCount).toBe(0);
      expect(result.ok).not.toBe(true);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
      delete process.env.SENTINELS_FIXTURE_DIR;
    }
  });
});
