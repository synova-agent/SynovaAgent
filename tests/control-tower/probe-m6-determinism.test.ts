/**
 * tests/control-tower/probe-m6-determinism.test.ts — C3 确定性判据件的**配对测试**（CT-40 / B8）
 *
 * 三层（缺一不可）:
 *   ① **纯函数**：canonical 投影（白名单剔除）／稳定序列化／sha256／变异锚点／夹具图
 *      —— 不进子进程，失败点直接定位到函数。
 *   ② **spawn 级 smoke**：跑探针**真身**：
 *      · `--case main` 四相位一次跑完（RUN-1/RUN-2/MUTATE/RESTORE ⇒ `RESULT=PASS`）
 *      · 三态边界（无 `--case` / 未知 case / 子协议缺环境）⇒ exit 2 ＋ stderr `degraded:`／`child-failed:`
 *   ③ **三态映射**：`EXIT_BY_VERDICT`（PASS=0 / FAIL=1 / ERROR=2）与探针出口同源。
 *
 * 🔴 最要紧的三条（都是判据语义，禁删）:
 *   ① **剔除必须可证**：喂一份"带 detectedAt/checkedAt/durationMs/runId 的两份不同输入"，
 *      canonical 摘要必须相同 —— 否则"两次一致"只是把时间戳一起比，永远是假红。
 *   ② **mutate 与 golden 比**：这里钉住"变异锚点恰好 1 处"的 fail-loud 语义
 *      （0 处/2 处都必须原样返回 occurrences 而非偷偷替换）。
 *   ③ **`--case main` 真跑**：不做 mock；`[MUTATE]` 行必须出现 `[EXPECTED-RED]`。
 *
 * 运行代价：`--case main` 会起 4 个 tsx 子进程（~10–20s），故该用例显式给 300s 超时。
 * ⚠️ 本测试与 C1/C2 的探针**不得并发**（那两件运行期增删/移走 extensions/sentinels）。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_BY_VERDICT } from '../../scripts/control-tower/probe-ladder';
import {
  CHILD_TIMEOUT_MS,
  KNOWN_CASES,
  METRIC_ID,
  MUTATION_FROM,
  MUTATION_TO,
  SENTINEL_ID,
  SENTINEL_NAME,
  canonicalDigest,
  createFixtureGraphStore,
  mutateComputeSource,
  projectCanonical,
  sha256Hex,
  stableStringify,
  usageText,
} from '../../scripts/control-tower/probe-m6-determinism';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const PROBE = join(REPO_ROOT, 'scripts', 'control-tower', 'probe-m6-determinism.ts');
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const RESULT_PASS = 'RESULT=PASS';

interface ProbeRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** 跑探针真身（绝不用 `npx`：探针 P14 实测 `spawnSync npx ENOENT`）。 */
function runProbe(
  argv: readonly string[],
  opts?: { readonly env?: Readonly<Record<string, string | undefined>>; readonly timeoutMs?: number },
): ProbeRun {
  const env: NodeJS.ProcessEnv = { ...process.env, SYNOVA_REPO_ROOT: REPO_ROOT };
  for (const [key, value] of Object.entries(opts?.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const res = spawnSync(process.execPath, [TSX_CLI, PROBE, ...argv], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: opts?.timeoutMs ?? 300_000,
    env,
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** 末行断言（探针契约：末行必须 `RESULT=<verdict>`）。 */
function lastLine(stdout: string): string {
  const lines = stdout.replace(/\r\n/g, '\n').trimEnd().split('\n');
  return lines[lines.length - 1] ?? '';
}

/**
 * 从输出里取某个相位的 **canonical** sha256。
 * 🔴 必须逐行定位再取 `sha256=`：`[MUTATE]`/`[RESTORE]` 行里 `sha256=` 前有说明文字，
 *    且同一行还可能出现 `fileSha256=`（大写 S）—— 用"行内首个 `[^A-Za-z]sha256=`"最稳。
 */
function phaseSha(stdout: string, phase: string): string | null {
  const line = stdout
    .replace(/\r\n/g, '\n')
    .split('\n')
    .find((l) => l.trimStart().startsWith(`[${phase}]`));
  if (line === undefined) return null;
  const m = /[^A-Za-z]sha256=([0-9a-f]{64})/.exec(line);
  return m ? m[1] : null;
}

// ─── ① 纯函数：canonical 投影（白名单剔除） ──────────────────────────────────

describe('projectCanonical — 白名单投影（剔除逐次变化字段）', () => {
  const noisy = {
    sentinelId: SENTINEL_ID,
    ok: true,
    findings: [
      {
        id: 't-age',
        severity: 'warning',
        title: 'Agent部署成熟度偏低',
        description: '成熟度66%',
        evidence: ['成熟度: 66%'],
        suggestion: '增加Agent监控和自治等级',
        detectedAt: '2026-10-30T00:00:00Z',
        relatedNodeId: 'a1',
        status: 'open',
      },
    ],
    metrics: [
      { metricId: METRIC_ID, value: 0.66, unit: 'ratio', sourceId: SENTINEL_ID, inputDigest: 'digest-x', evidenceRef: 'sentinel:x' },
    ],
    degraded: false,
    durationMs: 12,
    checkedAt: '2026-10-30T00:00:01Z',
    runId: 'run-abcdef',
  };

  it('finding 只留 7 字段（detectedAt/relatedNodeId/status 全剔除）', () => {
    const p = projectCanonical(noisy);
    expect(p.findings).toHaveLength(1);
    expect(p.findings[0]).toEqual({
      id: 't-age',
      severity: 'warning',
      polarity: 'negative',
      title: 'Agent部署成熟度偏低',
      description: '成熟度66%',
      evidence: ['成熟度: 66%'],
      suggestion: '增加Agent监控和自治等级',
    });
  });

  it('metric 只留 4 字段（inputDigest/evidenceRef 剔除）', () => {
    const p = projectCanonical(noisy);
    expect(p.metrics).toHaveLength(1);
    expect(p.metrics[0]).toEqual({ metricId: METRIC_ID, value: 0.66, unit: 'ratio', sourceId: SENTINEL_ID });
  });

  it('序列化结果里**不出现** detectedAt/checkedAt/durationMs/runId/computedAt', () => {
    const text = stableStringify(projectCanonical(noisy));
    for (const banned of ['detectedAt', 'checkedAt', 'durationMs', 'runId', 'computedAt', '2026-10-30', 'run-abcdef']) {
      expect(text).not.toContain(banned);
    }
  });

  it('polarity 缺省归一为 negative；positive 保留', () => {
    const neg = projectCanonical({ findings: [{ id: 'a', severity: 'info', title: 't', description: 'd', evidence: [], suggestion: '' }] });
    expect(neg.findings[0].polarity).toBe('negative');
    const pos = projectCanonical({ findings: [{ id: 'b', severity: 'info', polarity: 'positive' }] });
    expect(pos.findings[0].polarity).toBe('positive');
  });

  it('非有限 metric 值 ⇒ null（不编假值）；unit/sourceId 缺席 ⇒ null', () => {
    const p = projectCanonical({ metrics: [{ metricId: 'M', value: Number.NaN }] });
    expect(p.metrics[0].value).toBeNull();
    expect(p.metrics[0].unit).toBeNull();
    expect(p.metrics[0].sourceId).toBeNull();
  });

  it('degraded 缺省 false；显式 true 透传；findings/metrics 非法形态 ⇒ 空数组', () => {
    expect(projectCanonical({}).degraded).toBe(false);
    expect(projectCanonical({ degraded: true }).degraded).toBe(true);
    const junk = projectCanonical({ findings: 'nope', metrics: { a: 1 } });
    expect(junk.findings).toHaveLength(0);
    expect(junk.metrics).toHaveLength(0);
  });
});

describe('stableStringify / sha256Hex / canonicalDigest', () => {
  it('键排序：插入顺序无关', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify({ a: 2, b: 1 })).toBe(stableStringify({ b: 1, a: 2 }));
  });

  it('嵌套对象也排序；数组保序（顺序是语义的一部分）', () => {
    expect(stableStringify({ x: [{ b: 1, a: 2 }] })).toBe('{"x":[{"a":2,"b":1}]}');
    expect(stableStringify({ list: ['b', 'a'] })).toBe('{"list":["b","a"]}');
    expect(stableStringify({ list: ['a', 'b'] })).not.toBe(stableStringify({ list: ['b', 'a'] }));
  });

  it('sha256Hex 已知向量：sha256("abc")', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('canonicalDigest：只有时间戳不同 ⇒ 摘要相同（剔除生效）', () => {
    const base = { id: 't', severity: 'warning', title: 'T', description: 'D', evidence: ['e'], suggestion: 'S' };
    const a = canonicalDigest({ findings: [{ ...base, detectedAt: '2026-10-30T00:00:00Z' }], metrics: [], degraded: false });
    const b = canonicalDigest({ findings: [{ ...base, detectedAt: '2026-10-30T09:09:09Z' }], metrics: [], degraded: false });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonicalDigest：语义值改 1 处 ⇒ 摘要必变（改坏必红的机器基础）', () => {
    const base = { metricId: METRIC_ID, value: 0.66, unit: 'ratio', sourceId: SENTINEL_ID };
    const a = canonicalDigest({ findings: [], metrics: [base], degraded: false });
    const b = canonicalDigest({ findings: [], metrics: [{ ...base, value: 0.69 }], degraded: false });
    expect(a).not.toBe(b);
  });
});

// ─── ② 变异锚点 / 夹具图（纯函数） ──────────────────────────────────────────

describe('mutateComputeSource — 恰好 1 处，锚点漂移必须 fail loud', () => {
  const original = 'score: Math.round((0.3 * autonomy + 0.3 * monitoredRatio) * 100) / 100,';

  it('恰好 1 处 ⇒ 替换成 0.35，且 0.3 不再出现于该处', () => {
    const r = mutateComputeSource(original);
    expect(r.occurrences).toBe(1);
    expect(r.source).toContain(MUTATION_TO);
    expect(r.source).not.toContain(MUTATION_FROM);
    // 另一处 0.3 * monitoredRatio 不受影响（只改 1 处语义常量）
    expect(r.source).toContain('0.3 * monitoredRatio');
  });

  it('0 处 ⇒ occurrences=0 且源码原样返回（不许静默不改变绿）', () => {
    const r = mutateComputeSource('const x = 1;');
    expect(r.occurrences).toBe(0);
    expect(r.source).toBe('const x = 1;');
  });

  it('2 处 ⇒ occurrences=2 且源码原样返回（歧义锚点不许猜）', () => {
    const twice = `${MUTATION_FROM} + ${MUTATION_FROM}`;
    const r = mutateComputeSource(twice);
    expect(r.occurrences).toBe(2);
    expect(r.source).toBe(twice);
  });
});

describe('createFixtureGraphStore — 夹具图写死（防 empty-read ⇒ mutate 假红）', () => {
  it('Agent×1（monitored=true）＋ Tool×1（error=false）＋ 其它类型空', () => {
    const store = createFixtureGraphStore();
    const agents = store.queryNodes('Agent', { tid: 'x' });
    const tools = store.queryNodes('Tool');
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('a1');
    expect(agents[0].props.monitored).toBe(true);
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe('t1');
    expect(tools[0].props.error).toBe(false);
    expect(store.queryNodes('Financial')).toHaveLength(0);
  });
});

// ─── ③ 三态映射 / 常量 ──────────────────────────────────────────────────────

describe('三态映射与探针契约常量', () => {
  it('EXIT_BY_VERDICT：PASS=0 / FAIL=1 / ERROR=2 / NOT_IMPLEMENTED=2', () => {
    expect(EXIT_BY_VERDICT.PASS).toBe(0);
    expect(EXIT_BY_VERDICT.FAIL).toBe(1);
    expect(EXIT_BY_VERDICT.ERROR).toBe(2);
    expect(EXIT_BY_VERDICT.NOT_IMPLEMENTED).toBe(2);
  });

  it('场景／被测对象／超时常量（写死的判据身份）', () => {
    expect([...KNOWN_CASES]).toEqual(['main']);
    expect(SENTINEL_NAME).toBe('agent-deployment-maturity');
    expect(SENTINEL_ID).toBe('sentinel-agent-deployment-maturity');
    expect(METRIC_ID).toBe('AGENT-DEPLOYMENT-MATURITY-SCORE');
    expect(CHILD_TIMEOUT_MS).toBe(120_000);
  });

  it('--help 文本含四相位与剔除说明（规则与文件头同源）', () => {
    const help = usageText();
    expect(help).toContain('--case main');
    expect(help).toContain('detectedAt');
    expect(help).toContain('EQUAL');
    expect(help).toContain('120s');
  });
});

// ─── ④ spawn 级 smoke（三态边界，不碰 extensions） ───────────────────────────

describe('spawn smoke — 参数三态（不读 extensions）', () => {
  it('无参数 ⇒ exit 2 ＋ stderr degraded（ARG_CASE_REQUIRED）', () => {
    const run = runProbe([], { timeoutMs: 120_000 });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('degraded:');
    expect(run.stderr).toContain('code=ARG_CASE_REQUIRED');
    expect(lastLine(run.stdout)).toBe('RESULT=ERROR');
  });

  it('--case 未知 ⇒ exit 2（UNKNOWN_CASE，不回落默认场景）', () => {
    const run = runProbe(['--case', 'no-such-case'], { timeoutMs: 120_000 });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('degraded:');
    expect(run.stderr).toContain('code=UNKNOWN_CASE');
  });

  it('--child-run 缺 SENTINELS_FIXTURE_DIR ⇒ exit 2 ＋ stderr child-failed:CHILD_ENV_MISSING，且 stdout 无 JSON', () => {
    const run = runProbe(['--child-run'], { timeoutMs: 120_000, env: { SENTINELS_FIXTURE_DIR: undefined } });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('child-failed: CHILD_ENV_MISSING');
    expect(run.stdout).not.toContain('sha256');
    expect(run.stdout.trim()).toBe('');
  });

  it('--help ⇒ exit 0 且打印用法', () => {
    const run = runProbe(['--help'], { timeoutMs: 120_000 });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('probe-m6-determinism.ts');
    expect(run.stdout).toContain('退出码（三态）');
  });
});

// ─── ④ spawn 级 smoke（主用例四相位；真跑，不 mock） ─────────────────────────

describe('spawn smoke — --case main 四相位（真跑 4 个子进程）', () => {
  it(
    '--case main ⇒ exit 0；RUN-1==RUN-2、MUTATE≠golden、RESTORE 回 golden、末行 RESULT=PASS',
    () => {
      const run = runProbe(['--case', 'main'], { timeoutMs: 300_000 });
      expect(run.status).toBe(0);
      expect(run.stderr).not.toContain('degraded:');

      const h1 = phaseSha(run.stdout, 'RUN-1');
      const h2 = phaseSha(run.stdout, 'RUN-2');
      const hMut = phaseSha(run.stdout, 'MUTATE');
      const hRest = phaseSha(run.stdout, 'RESTORE');
      expect(h1).not.toBeNull();
      expect(h2).toBe(h1);
      expect(hMut).not.toBeNull();
      expect(hMut).not.toBe(h1);
      expect(hRest).toBe(h1);

      expect(run.stdout).toContain('[COMPARE] twice=EQUAL mutate=DIFF restore=EQUAL');
      expect(run.stdout).toContain('[EXPECTED-RED]');
      expect(run.stdout).toMatch(/\[CLEANUP\] fixture 已删/);
      expect(lastLine(run.stdout)).toBe(RESULT_PASS);
    },
    300_000,
  );
});
