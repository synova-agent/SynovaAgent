/**
 * tests/sentinel/content-exile.test.ts — 内容面「拔得掉」产品行为回归（迁自 probe-content-exile C2）
 *
 * 迁移口径: 把 scripts/control-tower/probe-content-exile.ts 的**有效产品判定**搬成标准产品测试 ——
 *   「真把一个哨兵内容目录移出扫描根 ⇒ 装载计数 −1 且 0 错误；搬回 ⇒ 回到原计数且 0 错误」，
 *   之后旧探针可删除。本文件**不 import 探针、不复制探针实现**（迁移 = 判据搬家，不是把探针搬进 tests）：
 *   探针必须真移动 extensions/sentinels/cash-runway 并起子进程；产品回归只需在**受控临时夹具根**上
 *   走真实 loader（loadSentinels）即可判定同一行为，且无并发/隔离区残留/改真内容面的风险。
 *
 * 判据来源（产品契约，不是当前实现快照）:
 *   · sentinel-loader.loadSentinels 契约: 扫描 SENTINELS_FIXTURE_DIR（缺省 extensions/sentinels）下每个目录的
 *     manifest.json；合法目录数 = 装载数且 0 errors；manifest 损坏 ⇒ errors 非空 + degraded（fail-loud）。
 *   · 产品方案（根 AGENTS.md §5.1 内容面可装卸）: 「加目录 ＋ 重扫」「移走目录 ＋ 重扫」⇒ 装载计数随之增减。
 *
 * 覆盖矩阵（铁律 48：正常 / 反例 / 失败路径 / 边界，逐条真断言）:
 *   ① 基线: 临时夹具根被真实 loader 扫描 ⇒ N 项、0 错误、未降级（且目录都落在夹具根内 = 没扫真内容面）
 *   ② 拔掉: 真移走一个目录（rename 到扫描根之外）＋ clearSentinelCache ＋ 重扫 ⇒ N−1、0 错误、消失的只有 victim
 *   ③ 搬回: 真搬回 ＋ 清缓存 ＋ 重扫 ⇒ N、0 错误、id 集合复原、manifest 逐字节复原
 *   ④ 反例（判别力）: 不真移走 ⇒ 重扫计数不变（−1 只由真实移走驱动，不是 clearSentinelCache 的副作用）
 *   ⑤ 失败路径: manifest 损坏 ⇒ 计数也掉 1，但 errors 非空 ⇒ 与「真移走且 0 错误」可区分
 *   ⑥ 夹具有效性: 两个目录经真实注册管线装配（manifest ＋ aggregate.ts 满足 loader 契约）
 *
 * 期望值来源: 夹具清单 FIXTURE_SENTINEL_NAMES（本文件常量，独立于 loader 输出）＋ 上述产品契约。
 *
 * 隔离与清理:
 *   · 每个用例 mkdtemp 独立夹具根（复制 tests/fixtures/sentinel-exile/**），afterEach 删临时根；
 *   · 隔离区 `<tmp>/exile` **在扫描根之外**（放扫描根里会被 loader 当第 N 项扫到，−1 就不成立）；
 *   · afterEach 恢复 SENTINELS_FIXTURE_DIR 原值并清 loader cache / registry（防跨用例串味）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearSentinelCache,
  loadSentinels,
  registerLoadedSentinels,
} from '../../src/sentinel/sentinel-loader';
import { destroySentinelRegistry, getSentinelRegistry } from '../../src/sentinel/registry';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓库内的夹具源（测试时复制到临时扫描根；夹具目录本身不参与扫描） */
const FIXTURE_ROOT = join(HERE, '..', 'fixtures', 'sentinel-exile');

/**
 * 夹具清单 —— 期望值的**独立来源**（不取自 loader 输出）:
 * 基线 = 全部夹具目录数；移走 victim 后 = 其余目录；搬回后 = 全部。
 */
const FIXTURE_SENTINEL_NAMES = ['exile-fixture-alpha', 'exile-fixture-beta'] as const;
/** 被真移走的 victim（沿用探针口径：一次只拔一个内容项） */
const VICTIM_NAME = FIXTURE_SENTINEL_NAMES[0];

interface ExileWorkspace {
  /** mkdtemp 根：承载扫描根与隔离区，afterEach 整体删除 */
  readonly root: string;
  /** 扫描根 = SENTINELS_FIXTURE_DIR（目录结构同 extensions/sentinels） */
  readonly sentinelRoot: string;
  /** 隔离区：**必须在扫描根之外**（放里面会被 loader 当第 N 项扫到） */
  readonly exileRoot: string;
}

let workspace: ExileWorkspace;
let prevFixtureDir: string | undefined;

function makeWorkspace(): ExileWorkspace {
  const root = mkdtempSync(join(tmpdir(), 'synova-content-exile-'));
  const sentinelRoot = join(root, 'sentinels');
  cpSync(FIXTURE_ROOT, sentinelRoot, { recursive: true });
  return { root, sentinelRoot, exileRoot: join(root, 'exile') };
}

/** 装载结果的 manifest.name（排序后比较；不依赖目录读取顺序） */
function namesOf(sentinels: ReadonlyArray<{ manifest: { name: string } }>): string[] {
  return sentinels.map((s) => s.manifest.name).sort();
}

beforeEach(() => {
  prevFixtureDir = process.env.SENTINELS_FIXTURE_DIR;
  workspace = makeWorkspace();
  // 注入缝惰性求值（sentinel-loader.ts sentinelsDir()）⇒ 设 env 后必须清 cache 才生效
  process.env.SENTINELS_FIXTURE_DIR = workspace.sentinelRoot;
  clearSentinelCache();
});

afterEach(() => {
  if (prevFixtureDir === undefined) delete process.env.SENTINELS_FIXTURE_DIR;
  else process.env.SENTINELS_FIXTURE_DIR = prevFixtureDir;
  clearSentinelCache();
  destroySentinelRegistry();
  rmSync(workspace.root, { recursive: true, force: true });
});

describe('内容面「拔得掉」（真实 loadSentinels，迁自 probe-content-exile C2）', () => {
  it('① 基线: 临时夹具根被真实 loader 扫描到 N 项、0 错误、未降级（证明没扫真 extensions/sentinels）', () => {
    const loaded = loadSentinels();
    expect(loaded.errors).toEqual([]);
    expect(loaded.degraded).toBe(false);
    expect(loaded.sentinels).toHaveLength(FIXTURE_SENTINEL_NAMES.length);
    expect(namesOf(loaded.sentinels)).toEqual([...FIXTURE_SENTINEL_NAMES].sort());
    // 每个目录都落在临时扫描根内 ⇒ 真内容面（extensions/sentinels，46 项）未被扫到
    for (const sentinel of loaded.sentinels) {
      expect(dirname(sentinel.dir), `夹具目录必须落在临时扫描根内: ${sentinel.dir}`).toBe(workspace.sentinelRoot);
    }
  });

  it('② 拔掉: 真移走一个目录＋清缓存重扫 ⇒ N−1、0 错误，消失的只有 victim', () => {
    const baseline = loadSentinels();
    expect(baseline.errors).toEqual([]);
    expect(baseline.sentinels).toHaveLength(FIXTURE_SENTINEL_NAMES.length);
    const baselineNames = namesOf(baseline.sentinels);

    const victimSrc = join(workspace.sentinelRoot, VICTIM_NAME);
    const victimExiled = join(workspace.exileRoot, VICTIM_NAME);
    mkdirSync(workspace.exileRoot, { recursive: true });
    renameSync(victimSrc, victimExiled); // 真移走（rename），不是 mock
    try {
      expect(existsSync(victimSrc), '移走后扫描根不得再有该目录').toBe(false);
      expect(existsSync(victimExiled), '目录应真在扫描根之外的隔离区').toBe(true);

      clearSentinelCache();
      const loaded = loadSentinels();
      expect(loaded.errors).toEqual([]);
      expect(loaded.degraded).toBe(false);
      expect(loaded.sentinels).toHaveLength(FIXTURE_SENTINEL_NAMES.length - 1);
      expect(namesOf(loaded.sentinels)).toEqual(baselineNames.filter((name) => name !== VICTIM_NAME));
      // 差集: 消失的只有 victim（其余项逐 id 不变，同探针 [OTHERS] 判据）
      const disappeared = baselineNames.filter((name) => !loaded.sentinels.some((s) => s.manifest.name === name));
      expect(disappeared).toEqual([VICTIM_NAME]);
    } finally {
      // 即使断言失败也搬回，防临时根里留下半拔状态影响后续用例
      renameSync(victimExiled, victimSrc);
      clearSentinelCache();
    }
  });

  it('③ 搬回: 真搬回＋清缓存重扫 ⇒ 回到 N、0 错误、id 集合与 manifest 逐字节复原', () => {
    const baseline = loadSentinels();
    expect(baseline.errors).toEqual([]);
    const baselineNames = namesOf(baseline.sentinels);

    const victimSrc = join(workspace.sentinelRoot, VICTIM_NAME);
    const victimExiled = join(workspace.exileRoot, VICTIM_NAME);
    const victimManifest = join(victimSrc, 'manifest.json');
    const manifestBefore = readFileSync(victimManifest, 'utf-8');

    mkdirSync(workspace.exileRoot, { recursive: true });
    renameSync(victimSrc, victimExiled);
    clearSentinelCache();
    expect(loadSentinels().sentinels).toHaveLength(FIXTURE_SENTINEL_NAMES.length - 1);

    renameSync(victimExiled, victimSrc); // 搬回（恢复）
    clearSentinelCache();
    const restored = loadSentinels();
    expect(restored.errors).toEqual([]);
    expect(restored.degraded).toBe(false);
    expect(restored.sentinels).toHaveLength(FIXTURE_SENTINEL_NAMES.length);
    expect(namesOf(restored.sentinels)).toEqual(baselineNames);
    expect(existsSync(victimSrc)).toBe(true);
    expect(existsSync(victimExiled)).toBe(false);
    // 恢复完整性: 搬回前后 manifest 逐字节一致（不依赖 mtime）
    expect(readFileSync(victimManifest, 'utf-8')).toBe(manifestBefore);
  });

  it('④ 反例（判别力）: 不真移走 ⇒ 重扫计数不变（−1 只由真实移走驱动，不是清缓存的副作用）', () => {
    const first = loadSentinels();
    expect(first.sentinels).toHaveLength(FIXTURE_SENTINEL_NAMES.length);
    const second = loadSentinels(); // 命中模块级 cache
    expect(second.sentinels).toHaveLength(first.sentinels.length);
    expect(second.errors).toEqual([]);

    clearSentinelCache(); // 强制重扫，但目录未动
    const rescanned = loadSentinels();
    expect(rescanned.sentinels).toHaveLength(FIXTURE_SENTINEL_NAMES.length);
    expect(rescanned.errors).toEqual([]);
  });

  it('⑤ 失败路径: manifest 损坏 ⇒ 计数也掉 1，但 errors 非空 + degraded（与「真移走且 0 错误」可区分）', () => {
    const victimManifest = join(workspace.sentinelRoot, VICTIM_NAME, 'manifest.json');
    writeFileSync(victimManifest, '{ "name": "broken",', 'utf-8'); // 非法 JSON（临时夹具副本，afterEach 清理）
    clearSentinelCache();
    const loaded = loadSentinels();
    expect(loaded.sentinels).toHaveLength(FIXTURE_SENTINEL_NAMES.length - 1);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]).toContain(VICTIM_NAME);
    expect(loaded.degraded).toBe(true);
  });

  it('⑥ 夹具有效性: 两个目录经真实注册管线装配（manifest ＋ aggregate.ts 满足 loader 契约）', async () => {
    // 用仓库内夹具源（vite 可解析 aggregate.ts）；计数用例仍走临时副本，互不影响
    process.env.SENTINELS_FIXTURE_DIR = FIXTURE_ROOT;
    clearSentinelCache();
    destroySentinelRegistry();
    try {
      const { registered, errors } = await registerLoadedSentinels();
      expect(errors).toEqual([]);
      expect(registered).toBe(FIXTURE_SENTINEL_NAMES.length);
      const registry = getSentinelRegistry();
      for (const name of FIXTURE_SENTINEL_NAMES) {
        expect(registry.get(`sentinel-${name}`), `${name} 应已完成装配注册`).toBeDefined();
      }
    } finally {
      destroySentinelRegistry();
      process.env.SENTINELS_FIXTURE_DIR = workspace.sentinelRoot;
      clearSentinelCache();
    }
  });
});
