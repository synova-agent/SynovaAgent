/**
 * tests/control-tower/probe-content-reload.test.ts — C1（#706 · M6-1158）探针配对测试
 *
 * 覆盖矩阵（铁律 48：正常 / 降级 / 边界 —— 逐条真断言，禁空壳）:
 *   ① 纯函数：`--all` **只跑主用例**（反例不参与自动跑，规格 §4 C1 DS④）
 *   ② 纯函数：`--case <已知>` 精确解析；缺省 / 未知 ⇒ ProbeError（**不回落默认场景**）
 *   ③ 纯函数：内容项目录独立派生（readdir 路）——排除 `shared` 与 `_` 前缀，且 46 项升序
 *   ④ 纯函数：`sentinel-<manifest.name>` 派生链
 *   ⑤ 纯函数：手算常量 EXPECTED_SCORE=0.66 ＋ 有限数判别（NaN/Infinity/字符串都不得算过）
 *   ⑥ 自声明面：TARGETS 非空且**全部真存在**；KNOWN_CASES 三档逐字
 *   ⑦ 三态映射：EXIT_BY_VERDICT（PASS→0 / FAIL→1 / NOT_IMPLEMENTED→2 / ERROR→2）
 *   ⑧ 🔴 spawn 三态-0（反例 case）：`--case no-reload` ⇒ rc 0 ＋ `[EXPECTED-RED]` ⇒ 判据有牙齿
 *   ⑨ 🔴 spawn 三态-1（降级 case，期望红）：`--case bad-manifest` ⇒ rc 1 ＋ `[RETAINED]` ＋ `[EXPECTED-FAIL]`
 *   ⑩ 🔴 spawn 三态-2（边界）：未知 case ⇒ rc 2 ＋ 末行 RESULT=ERROR ＋ stderr `degraded:`（fail-closed）
 *   ⑪ 运行期不留残渣：spawn 后 `findResidualFixtures` 空 且目录数回到 46（finally 恢复 ＋ 计数核对）
 *
 * 🔴 被测对象是**真链路**（真增删 `extensions/sentinels/**`）⇒ 本测试与 T3/T4/C3 的重型探针
 *    **不得并发**（锁文件串行）；spawn 一律走独立子进程，禁 mock。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXIT_BY_VERDICT, ProbeError } from '../../scripts/control-tower/probe-ladder';
import {
  EXPECTED_SCORE,
  KNOWN_CASES,
  TARGETS,
  findResidualFixtures,
  isFiniteScore,
  readSentinelDirNames,
  resolveCases,
  sentinelIdOf,
} from '../../scripts/control-tower/probe-content-reload';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const PROBE = join(REPO_ROOT, 'scripts/control-tower/probe-content-reload.ts');
const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

/** 夹具基线（as_of b8edf9860：48 目录 − shared − _extinct） */
const BASELINE = 46;

interface ProbeRun {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 真子进程跑探针（禁 mock 被测系统） */
function runProbe(args: readonly string[]): ProbeRun {
  try {
    const stdout = execFileSync(process.execPath, [TSX_CLI, PROBE, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
    });
    return { rc: 0, stdout, stderr: '' };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { rc: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** 取末行 `RESULT=` 的判定词元（判例 M-04：只认末行） */
function lastResult(stdout: string): string {
  const hit = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('RESULT='))
    .pop();
  return hit ?? '';
}

/** 取 ProbeError.code（非 ProbeError ⇒ 返回哨兵串，便于断言失败时看得见） */
function probeCode(fn: () => unknown): string {
  try {
    fn();
    return 'NO_THROW';
  } catch (err: unknown) {
    return err instanceof ProbeError ? err.code : 'NOT_A_PROBE_ERROR';
  }
}

describe('probe-content-reload · 纯函数面（C1 / #706）', () => {
  it('① --all 只跑主用例：反例（bad-manifest / no-reload）不得进自动跑', () => {
    const all = resolveCases(['--all']);
    expect(all.all).toBe(true);
    expect(all.cases).toEqual(['main']);
    expect(all.cases).not.toContain('bad-manifest');
    expect(all.cases).not.toContain('no-reload');
  });

  it('② --case 精确解析；缺省 / 未知 ⇒ ProbeError（不回落默认场景）', () => {
    expect(resolveCases(['--case', 'main'])).toEqual({ cases: ['main'], all: false });
    expect(resolveCases(['--case', 'no-reload']).cases).toEqual(['no-reload']);
    expect(resolveCases(['--case', 'bad-manifest']).cases).toEqual(['bad-manifest']);
    expect(probeCode(() => resolveCases([]))).toBe('CASE_REQUIRED');
    expect(probeCode(() => resolveCases(['--case', 'nope']))).toBe('UNKNOWN_CASE');
    expect(probeCode(() => resolveCases(['--case']))).toBe('MISSING_CASE_VALUE');
  });

  it('③ 目录独立派生：排除 shared / _ 前缀，恰 46 项且升序（readdir 与 registry 两路同源）', () => {
    const names = readSentinelDirNames(REPO_ROOT);
    expect(names).toHaveLength(BASELINE);
    expect(names).not.toContain('shared');
    expect(names.filter((n) => n.startsWith('_'))).toEqual([]);
    expect(names).toContain('agent-deployment-maturity');
    expect([...names].sort()).toEqual(names);
    // 目录不存在 ⇒ 空数组（不抛；调用方按 0 项 ⇒ exit 2 处理）
    expect(readSentinelDirNames(join(REPO_ROOT, '__definitely-absent__'))).toEqual([]);
  });

  it('④ registry id 派生链：sentinel-<manifest.name>', () => {
    expect(sentinelIdOf('probe-c1-1-abc')).toBe('sentinel-probe-c1-1-abc');
    expect(sentinelIdOf('agent-deployment-maturity')).toBe('sentinel-agent-deployment-maturity');
  });

  it('⑤ 手算常量 0.66 ＋ 有限数判别（NaN / Infinity / 非数字都不得算「出测量值」）', () => {
    expect(EXPECTED_SCORE).toBe(0.66);
    expect(isFiniteScore(EXPECTED_SCORE)).toBe(true);
    expect(isFiniteScore(0)).toBe(true);
    expect(isFiniteScore(Number.NaN)).toBe(false);
    expect(isFiniteScore(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteScore('0.66')).toBe(false);
    expect(isFiniteScore(undefined)).toBe(false);
  });

  it('⑥ 自声明面：TARGETS 非空且全部真存在；KNOWN_CASES 三档逐字', () => {
    expect(KNOWN_CASES).toEqual(['main', 'bad-manifest', 'no-reload']);
    expect(TARGETS.length).toBeGreaterThanOrEqual(5);
    const missing = TARGETS.filter((p) => !existsSync(join(REPO_ROOT, p)));
    expect(missing).toEqual([]);
    expect(TARGETS).toContain('src/deploy/content-reload.ts');
    expect(TARGETS).toContain('extensions/sentinels/agent-deployment-maturity');
  });

  it('⑦ 三态映射：EXIT_BY_VERDICT 是 verdict→退出码的唯一真源', () => {
    expect(EXIT_BY_VERDICT.PASS).toBe(0);
    expect(EXIT_BY_VERDICT.FAIL).toBe(1);
    expect(EXIT_BY_VERDICT.NOT_IMPLEMENTED).toBe(2);
    expect(EXIT_BY_VERDICT.ERROR).toBe(2);
  });
});

describe('probe-content-reload · spawn 级（真链路，禁 mock）', () => {
  it(
    '⑧ 反例 case：--case no-reload ⇒ rc 0 ＋ [EXPECTED-RED]（判据有牙齿）',
    () => {
      const run = runProbe(['--case', 'no-reload']);
      expect(run.rc).toBe(0);
      expect(lastResult(run.stdout)).toBe('RESULT=PASS');
      expect(run.stdout).toContain('[BASELINE] sentinels=46 dirs=46');
      expect(run.stdout).toContain('[EXPECTED-RED] sentinels=46');
      expect(run.stdout).toContain('[ADD] probe-c1-');
      expect(run.stdout).toContain('[CLEANUP] sentinels=46');
      // 运行期真加过目录 ⇒ 结束后必须无残渣（finally 恢复 ＋ 计数核对）
      expect(findResidualFixtures(REPO_ROOT)).toEqual([]);
      expect(readSentinelDirNames(REPO_ROOT)).toHaveLength(BASELINE);
    },
    180_000,
  );

  it(
    '⑨ 降级 case（期望红）：--case bad-manifest ⇒ rc 1 ＋ [RETAINED] ＋ degraded=true ＋ [EXPECTED-FAIL]',
    () => {
      const run = runProbe(['--case', 'bad-manifest']);
      expect(run.rc).toBe(1); // 规格 §4 C1：坏内容必须被拒＝合法红（exit 1）
      expect(lastResult(run.stdout)).toBe('RESULT=FAIL');
      expect(run.stdout).toContain('[RETAINED] probe-bad-');
      expect(run.stdout).toContain('degraded=true');
      expect(run.stdout).toContain('[EXPECTED-FAIL]');
      expect(run.stdout).toContain('[CLEANUP] sentinels=46');
      // 坏内容不得进 registry，且运行期增删后必须回基线（finally 恢复）
      expect(findResidualFixtures(REPO_ROOT)).toEqual([]);
      expect(readSentinelDirNames(REPO_ROOT)).toHaveLength(BASELINE);
    },
    180_000,
  );

  it(
    '⑩ 边界 case：未知 case ⇒ rc 2 ＋ 末行 RESULT=ERROR ＋ stderr degraded:（fail-closed）',
    () => {
      const run = runProbe(['--case', '__no_such_case__']);
      expect(run.rc).toBe(2);
      expect(lastResult(run.stdout)).toBe('RESULT=ERROR');
      expect(run.stderr).toContain('degraded:');
      // 错误码（typed error）在 stdout 的错误行里点名；stderr 只承载 D2 约定的 `degraded: <原因>`
      expect(run.stdout).toContain('UNKNOWN_CASE');
      // 参数错误在取锁/动内容面之前就退出 ⇒ 不得留锁、不得留目录
      expect(existsSync(join(REPO_ROOT, '.synova-out/m6-1158/.lock'))).toBe(false);
      expect(findResidualFixtures(REPO_ROOT)).toEqual([]);
    },
    120_000,
  );
});
