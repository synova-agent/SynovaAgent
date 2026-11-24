/**
 * tests/sentinel/sentinel-determinism.test.ts — 哨兵确定性契约
 * （迁移自 scripts/control-tower/probe-m6-determinism.ts 的**有效产品行为判据**）
 *
 * 迁移口径（#1478）：
 *   · 本文件**不 import 探针、不复用探针夹具、不复制其实现**；被迁移的只是那条判据：
 *     「同一份内容两次走真实产品管线 ⇒ 稳定投影逐字相同；改坏一处语义常量 ⇒ 稳定投影必变；
 *      还原后 ⇒ 回到原投影」。
 *   · 稳定投影（白名单）与两套期望投影（基线 / 变异）**都由本文件定义**，不取自任何实现输出快照；
 *     期望值由夹具的固定图与 compute 公式手算得出。
 *   · 被测面是**产品真实管线**：`SENTINELS_FIXTURE_DIR`（src/sentinel/sentinel-loader.ts 的注入缝）
 *     → `loadSentinels()` 扫描 → `registerLoadedSentinels()` 注册 → `registry.check()` 执行。
 *     夹具哨兵（manifest.json / aggregate.ts / computes/score.ts）只是**夹具输入**，不是产品代码。
 *
 * 契约（四条）：
 *   ① 确定性：同一份夹具内容跑两次完整管线 ⇒ 稳定投影逐字相同，且等于本文件定义的基线期望。
 *   ② 剔除可证：结果里的逐跑易变字段（checkedAt / detectedAt / durationMs / runId 等）不进投影；
 *      finding/metric 的投影键集必须恰为白名单（多一个「易变字段」都会红）。
 *   ③ 改坏必红：把夹具 compute 的语义常量 `AUTONOMY_WEIGHT` 从 0.5 改成 0.6（**夹具输入改动，
 *      不动 src/**、extensions/**），重新跑 ⇒ 稳定投影必须变为本文件定义的变异期望
 *      （不是只断言「变了」——那样任何噪音都能冒充判据）。
 *   ④ 还原回基线：切回未改动的基线夹具 ⇒ 下一次跑必须回到基线投影；测试结束不留变异、不留副本。
 *
 * 取证路径（沿用既有注入缝，不新建机制）：
 *   · 夹具模板入库于 `tests/fixtures/sentinel-determinism/`，每个测试文件运行前复制到
 *     `os.tmpdir()/synova-sentinel-determinism-<随机后缀>/sentinels/`（不写仓库、不与其他文件共享状态）；
 *   · `clearSentinelCache()`（loader 公开 API）在每次跑前清模块级缓存；
 *   · `destroySentinelRegistry()`（registry 公开 API，测试用）保证每次都是「注册 → check」完整链路；
 *   · `vi.resetModules()`：模块按 URL 缓存，每次跑都从同一份新模块图取 loader + registry，
 *     避免上一个用例的模块实例/模块级状态跨用例串味。
 *   · 🔴 **变异相位在「基线夹具的同内容派生副本」上做原地文件编辑**：`vitest run` 下 Vite 按 URL 缓存
 *     转换结果，对**已求值过的同一路径**原地改源文本不会重新读盘（实测：改完仍得到基线投影）。
 *     派生副本 = 新 URL ⇒ 真正重新读盘。对被测管线而言输入仍是「同一份夹具 + 一处常量变化」；
 *     基线根全程只读，④ 的「还原」= 切回基线根并断言原投影回归。
 *
 * 已知限制：
 *   1. 只覆盖**一个**最小夹具哨兵；46 个真实哨兵的全量确定性复现不在本契约（判的是机制，不是全量）。
 *   2. 两次跑在**同一进程**内（同一份文件内容、两次完整管线），不是两个 OS 进程；
 *      跨进程/跨机器的确定性另行验证，本文件不冒充。
 *   3. 只比较 findings（7 个语义字段）/ metrics（4 个语义字段）/ degraded；
 *      哨兵新增语义字段时须同步改投影与期望（判据变更，不是自动快照）。
 *   4. metric sink 写入（loader 内 `metricSink` 落库）不在本契约：这里断言的是 check 返回的
 *      `SentinelCheckResult.metrics`（sink 之前的语义值）；loader 无 sink 时显式告警而非静默。
 *   5. `vi.resetModules()` 是 Vitest 的测试隔离能力，不是对被测管线打桩；被测代码/夹具/注入缝全是生产实现。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SentinelCheckResult } from '../../src/sentinel/types';

/**
 * 管线模块类型（type-only：运行时统一走下面的 `freshPipelineModules()`）。
 * 为什么必须动态 import：loader 在 `registerLoadedSentinels()` 内部 `await import('./registry')`
 * 拿全局单例；`vi.resetModules()` 后若测试侧仍用**静态 import** 的 registry，
 * 两边就是两个不同模块实例（单例分裂）⇒ registry 查不到刚注册的哨兵。
 * 每次跑都从**同一个新模块图**取 loader + registry，才能保证「注册 → check」是同一条链路。
 */
type LoaderModule = typeof import('../../src/sentinel/sentinel-loader');
type RegistryModule = typeof import('../../src/sentinel/registry');

// ═══ 判据身份（写死；夹具模板与临时根的关系） ═══

const HERE = dirname(fileURLToPath(import.meta.url));
/** 夹具模板（仓库内只读来源；每跑复制到 tmp，绝不在仓库内改夹具）。 */
const FIXTURE_TEMPLATE = join(HERE, '..', 'fixtures', 'sentinel-determinism');
const SENTINEL_NAME = 'determinism-demo';
const SENTINEL_ID = `sentinel-${SENTINEL_NAME}`;
const COMPUTE_REL = join(SENTINEL_NAME, 'computes', 'score.ts');
const TEAM_ID = 'team-determinism-contract';

/** 变异锚点：夹具 compute 的唯一语义常量（出现次数必须恰好 1，漂移 ⇒ fail loud）。 */
const MUTATION_FROM = 'const AUTONOMY_WEIGHT = 0.5;';
const MUTATION_TO = 'const AUTONOMY_WEIGHT = 0.6;';

/** ISO-8601 UTC 毫秒形态（证明原始结果确实带逐跑时间戳）。 */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ═══ 稳定投影（白名单；本文件定义，不是实现快照） ═══

interface StableFinding {
  id: string;
  severity: string;
  polarity: 'positive' | 'negative';
  title: string;
  description: string;
  evidence: string[];
  suggestion: string;
}

interface StableMetric {
  metricId: string;
  value: number | null;
  unit: string | null;
  sourceId: string | null;
}

interface StableProjection {
  findings: StableFinding[];
  metrics: StableMetric[];
  degraded: boolean;
}

/** finding 投影键集（恰好这些；多一个易变字段就说明投影失效）。 */
const STABLE_FINDING_KEYS = ['id', 'severity', 'polarity', 'title', 'description', 'evidence', 'suggestion'] as const;
/** metric 投影键集。 */
const STABLE_METRIC_KEYS = ['metricId', 'value', 'unit', 'sourceId'] as const;

/** 基线期望（手算：autonomy=1/2、monitored=1/1 ⇒ 0.5*0.5 + 0.5*1 = 0.75）。 */
const BASELINE_PROJECTION: StableProjection = {
  findings: [
    {
      id: 'f-determinism-demo-score',
      severity: 'warning',
      polarity: 'negative',
      title: '确定性契约夹具: 评分样本',
      description: '确定性演示评分 0.75（自主度权重 0.5）',
      evidence: ['score=0.75', 'autonomy=0.5', 'monitored=1'],
      suggestion: 'n/a（确定性契约夹具，不是业务告警）',
    },
  ],
  metrics: [{ metricId: 'DETERMINISM-DEMO-SCORE', value: 0.75, unit: 'ratio', sourceId: 'determinism-demo' }],
  degraded: false,
};

/** 变异期望（权重 0.6 ⇒ 0.6*0.5 + 0.4*1 = 0.7；描述里的权重也变）。 */
const MUTATED_PROJECTION: StableProjection = {
  findings: [
    {
      id: 'f-determinism-demo-score',
      severity: 'warning',
      polarity: 'negative',
      title: '确定性契约夹具: 评分样本',
      description: '确定性演示评分 0.70（自主度权重 0.6）',
      evidence: ['score=0.7', 'autonomy=0.5', 'monitored=1'],
      suggestion: 'n/a（确定性契约夹具，不是业务告警）',
    },
  ],
  metrics: [{ metricId: 'DETERMINISM-DEMO-SCORE', value: 0.7, unit: 'ratio', sourceId: 'determinism-demo' }],
  degraded: false,
};

/**
 * 把一次真实 check 结果的语义面投影成稳定结构。
 * 逐跑易变字段（detectedAt/checkedAt/durationMs/runId/inputDigest/evidenceRef…）一律**按白名单不取**，
 * 而不是「取到后再删」——少一个字段就少一条比较口径，所以键集另有断言钉住。
 */
function stableProjection(result: SentinelCheckResult): StableProjection {
  return {
    findings: result.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      polarity: f.polarity === 'positive' ? 'positive' : 'negative',
      title: f.title,
      description: f.description,
      evidence: [...f.evidence],
      suggestion: f.suggestion,
    })),
    metrics: (result.metrics ?? []).map((m) => ({
      metricId: m.metricId,
      value: Number.isFinite(m.value) ? m.value : null,
      unit: typeof m.unit === 'string' ? m.unit : null,
      sourceId: typeof m.sourceId === 'string' ? m.sourceId : null,
    })),
    degraded: result.degraded === true,
  };
}

// ═══ 夹具图（写死；读空会走降级分支 ⇒ compute 不跑 ⇒ 改坏假绿） ═══

interface FixtureNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

/** Agent ×2（monitored=true / false）＋ Tool ×1（error=false）⇒ autonomy=0.5、monitored=1。 */
function createDeterministicGraphStore(): {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): FixtureNode[];
} {
  const nodes: FixtureNode[] = [
    { id: 'agent-a', type: 'Agent', props: { monitored: true } },
    { id: 'agent-b', type: 'Agent', props: { monitored: false } },
    { id: 'tool-a', type: 'Tool', props: { error: false } },
  ];
  return { queryNodes: (type) => nodes.filter((n) => n.type === type) };
}

// ═══ 真实管线（每次 = 扫描 → 注册 → check） ═══

let tempRoot = '';
let sentinelsRoot = '';
let previousFixtureDir: string | undefined;

/**
 * 取**同一份新模块图**里的 loader + registry（每次跑都新求值）。
 * 不同用例之间不共享模块级状态（loader 的 cache、registry 单例）；
 * 而重置后分别静态 import 两侧会得到不同实例 ⇒ 单例分裂，必须一起取。
 */
async function freshPipelineModules(): Promise<{ loader: LoaderModule; registry: RegistryModule }> {
  vi.resetModules();
  const loader = await import('../../src/sentinel/sentinel-loader');
  const registry = await import('../../src/sentinel/registry');
  return { loader, registry };
}

/**
 * 跑一次完整产品管线并返回真实 check 结果。
 * 每次跑都是「清缓存 → 扫描 → 注册 → registry.check」，不是进程内复用同一个哨兵实例。
 */
async function runPipelineOnce(): Promise<SentinelCheckResult> {
  const { loader, registry } = await freshPipelineModules();
  registry.destroySentinelRegistry();
  loader.clearSentinelCache();

  const loaded = loader.loadSentinels();
  expect(loaded.errors, `夹具扫描不应报错：${loaded.errors.join(' | ') || '无'}`).toEqual([]);
  expect(
    loaded.sentinels.map((s) => s.manifest.name),
    '夹具根应恰好扫描到 1 个哨兵（多/少都说明注入缝或夹具布局变了）',
  ).toEqual([SENTINEL_NAME]);

  const registration = await loader.registerLoadedSentinels();
  expect(registration.errors, `夹具注册不应报错：${registration.errors.join(' | ') || '无'}`).toEqual([]);
  expect(registration.registered, '应注册 1 个夹具哨兵').toBe(1);

  const sentinel = registry.getSentinelRegistry().get(SENTINEL_ID);
  expect(sentinel, `registry 应含 ${SENTINEL_ID}`).toBeTruthy();

  return sentinel!.check({ db: createDeterministicGraphStore(), now: new Date(), teamId: TEAM_ID });
}

/**
 * 把入库模板复制成一份**同内容的临时夹具根**（变异相位用派生副本：新 URL ⇒ Vite 真正重新读盘）。
 * @param label 派生副本的目录名（位于本测试的 tempRoot 下，afterAll 统一清理）
 * @param mutateCompute true ⇒ 复制后把 compute 的唯一语义常量改坏（锚点必须恰好 1 处，漂移 fail loud）
 * @returns 该副本的哨兵扫描根（可直接赋给 SENTINELS_FIXTURE_DIR）
 */
function materializeFixtureCopy(label: string, mutateCompute: boolean): string {
  const root = join(tempRoot, label, 'sentinels');
  cpSync(FIXTURE_TEMPLATE, root, { recursive: true });
  if (!mutateCompute) return root;

  const computePath = join(root, COMPUTE_REL);
  const source = readFileSync(computePath, 'utf8');
  const occurrences = source.split(MUTATION_FROM).length - 1;
  expect(
    occurrences,
    `变异锚点 ${JSON.stringify(MUTATION_FROM)} 应恰好出现 1 次（实得 ${occurrences} 次）—— 锚点漂移必须 fail loud，不许静默跳过`,
  ).toBe(1);
  writeFileSync(computePath, source.replace(MUTATION_FROM, MUTATION_TO), 'utf8');
  return root;
}

// ═══ 生命周期 ═══

beforeAll(async () => {
  previousFixtureDir = process.env.SENTINELS_FIXTURE_DIR;
  tempRoot = mkdtempSync(join(tmpdir(), 'synova-sentinel-determinism-'));
  sentinelsRoot = join(tempRoot, 'sentinels');
  cpSync(FIXTURE_TEMPLATE, sentinelsRoot, { recursive: true });
  process.env.SENTINELS_FIXTURE_DIR = sentinelsRoot;
  const { loader, registry } = await freshPipelineModules();
  registry.destroySentinelRegistry();
  loader.clearSentinelCache();
});

afterAll(async () => {
  if (previousFixtureDir === undefined) delete process.env.SENTINELS_FIXTURE_DIR;
  else process.env.SENTINELS_FIXTURE_DIR = previousFixtureDir;
  const { loader, registry } = await freshPipelineModules();
  registry.destroySentinelRegistry();
  loader.clearSentinelCache();
  // 清理临时夹具根（含所有派生副本）；失败不静默 —— 抛出让测试红。
  if (tempRoot !== '') rmSync(tempRoot, { recursive: true, force: true });
});

// ═══ ① 确定性：同内容两次 ⇒ 稳定投影相同，且等于测试定义的期望 ═══

describe('哨兵确定性契约 — 同内容两次一致（真实 loader/check 管线）', () => {
  it('两次完整管线的稳定投影逐字相同，且等于基线期望投影（期望由本文件定义）', async () => {
    const first = stableProjection(await runPipelineOnce());
    const second = stableProjection(await runPipelineOnce());

    expect(second, '同一份夹具内容两次跑出的稳定投影必须逐字相同').toEqual(first);
    expect(first, '稳定投影必须等于测试定义的基线期望（不是实现输出快照）').toEqual(BASELINE_PROJECTION);
  });
});

// ═══ ② 剔除可证：易变字段不进比较口径 ═══

describe('哨兵确定性契约 — 稳定投影剔除逐跑易变字段', () => {
  it('原始结果带 checkedAt/detectedAt/durationMs，但投影键集只含白名单语义字段', async () => {
    const raw = await runPipelineOnce();

    // 反过来先证明"原始结果确实带易变字段"——否则剔除断言只是空转。
    expect(raw.checkedAt, '真实 loader wrapper 的 checkedAt 应是 ISO 时间戳').toMatch(ISO_UTC_RE);
    expect(typeof raw.durationMs, '真实 loader wrapper 的 durationMs 应是数值（逐跑测量字段）').toBe('number');
    expect(raw.findings[0]?.detectedAt, '夹具 finding 的 detectedAt 应是 ISO 时间戳').toMatch(ISO_UTC_RE);
    expect(raw.sentinelId, 'loader wrapper 产出的 sentinelId 应与 registry id 一致').toBe(SENTINEL_ID);
    expect(raw.ok, '真实 loader wrapper 应返回 ok=true').toBe(true);

    const projection = stableProjection(raw);
    expect(projection.findings, '夹具应产出 1 条 finding').toHaveLength(1);
    expect(projection.metrics, '夹具应产出 1 条 metric').toHaveLength(1);

    expect(Object.keys(projection.findings[0]).sort(), 'finding 投影键集必须恰为白名单').toEqual(
      [...STABLE_FINDING_KEYS].sort(),
    );
    expect(Object.keys(projection.metrics[0]).sort(), 'metric 投影键集必须恰为白名单').toEqual(
      [...STABLE_METRIC_KEYS].sort(),
    );

    // 稳定投影的序列化里不得出现任何逐跑字段（值也可能含时间戳 ⇒ 连值一起禁）。
    const text = JSON.stringify(projection);
    for (const banned of ['detectedAt', 'checkedAt', 'durationMs', 'runId', raw.checkedAt, raw.findings[0]!.detectedAt]) {
      expect(text, `稳定投影不得包含逐跑字段/值：${banned}`).not.toContain(banned);
    }
  });
});

// ═══ ③ 改坏必红：改夹具 compute 常量 ⇒ 投影必变；④ 还原 ⇒ 回基线 ═══

describe('哨兵确定性契约 — 改坏必红 + 还原回基线（夹具输入改动，不动产品代码）', () => {
  it('改 compute 的 AUTONOMY_WEIGHT ⇒ 稳定投影变为变异期望；切回基线夹具 ⇒ 回到基线期望', async () => {
    let derivedRoot = '';
    try {
      // ── 改坏（夹具输入）：派生副本里只替换 1 处语义常量 ──
      derivedRoot = materializeFixtureCopy('mutated', true);
      const mutatedSource = readFileSync(join(derivedRoot, COMPUTE_REL), 'utf8');
      expect(mutatedSource, '改坏后派生夹具的 compute 必须包含变异后的常量').toContain(MUTATION_TO);
      expect(mutatedSource, '改坏后派生夹具的 compute 不得再包含原常量').not.toContain(MUTATION_FROM);

      // 对照：派生副本与模板的差异**只有这一处常量**（其余文件逐字相同）
      // —— 否则「投影变了」可能来自别的夹具漂移，而不是被判据驱动。
      const templateCompute = readFileSync(join(FIXTURE_TEMPLATE, COMPUTE_REL), 'utf8');
      expect(mutatedSource, '派生副本 compute 必须恰是「模板 - 原常量 + 变异常量」').toBe(
        templateCompute.replace(MUTATION_FROM, MUTATION_TO),
      );
      for (const rel of ['manifest.json', 'aggregate.ts']) {
        expect(
          readFileSync(join(derivedRoot, SENTINEL_NAME, rel), 'utf8'),
          `除 compute 常量外，派生副本的 ${rel} 必须与模板逐字相同`,
        ).toBe(readFileSync(join(FIXTURE_TEMPLATE, SENTINEL_NAME, rel), 'utf8'));
      }

      process.env.SENTINELS_FIXTURE_DIR = derivedRoot;
      const mutated = stableProjection(await runPipelineOnce());
      expect(mutated, '改坏后稳定投影必须不同于基线（否则「改坏必红」没有牙齿）').not.toEqual(BASELINE_PROJECTION);
      expect(mutated, '改坏后的投影必须等于测试定义的变异期望（不是「随便变了」）').toEqual(MUTATED_PROJECTION);
    } finally {
      // ── 还原：切回未改动的基线夹具根，并删掉派生副本（不留变异、不留临时目录） ──
      process.env.SENTINELS_FIXTURE_DIR = sentinelsRoot;
      rmSync(join(tempRoot, 'mutated'), { recursive: true, force: true });
    }

    expect(readFileSync(join(sentinelsRoot, COMPUTE_REL), 'utf8'), '基线夹具 compute 全程不得被改').toBe(
      readFileSync(join(FIXTURE_TEMPLATE, COMPUTE_REL), 'utf8'),
    );

    const restored = stableProjection(await runPipelineOnce());
    expect(restored, '还原后的稳定投影必须回到基线期望').toEqual(BASELINE_PROJECTION);
  });

  it('运行结束不留变异/副本：基线夹具 compute 与入库模板逐字相同，临时根只剩基线夹具', () => {
    expect(
      readFileSync(join(sentinelsRoot, COMPUTE_REL), 'utf8'),
      '临时夹具不得留有变异（测试结束树应回到模板状态）',
    ).toBe(readFileSync(join(FIXTURE_TEMPLATE, COMPUTE_REL), 'utf8'));
    expect(readdirSync(tempRoot).sort(), '派生副本必须已清理，临时根只应有基线夹具').toEqual(['sentinels']);
  });
});
