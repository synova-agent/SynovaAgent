/**
 * tests/control-tower/probe-content-exile.test.ts — C2（#707 · M6-1158）探针配对测试
 *
 * 覆盖矩阵（铁律 48：正常 / 降级 / 边界 —— 逐条真断言，禁空壳）:
 *   ① 纯函数：集合差 `setDifference`（[OTHERS] 的唯一实现；去重 / 空 / 全差）
 *   ② 纯函数：隔离区路径 `exileRootFor` —— **必须在 `extensions/sentinels/` 之外**（放里面会被当第 46 项扫到）
 *   ③ 纯函数：`typeCountsFromResults`（内容类型 → 项数；`types` ＝ 键数口径）
 *   ④ 纯函数：子协议解析 `parseChildPayload`（正常 / 混入日志行 / 无 JSON / 形状不符）
 *   ⑤ 纯函数：`dirDigest` 对真 victim 目录（6 文件）可算且稳定；`fileSha256` 64 hex
 *   ⑥ 自声明面：TARGETS 非空且全部真存在；KNOWN_CASES 两档；EXILE_VICTIM_ID 派生
 *   ⑦ 三态映射：EXIT_BY_VERDICT（PASS→0 / FAIL→1 / NOT_IMPLEMENTED→2 / ERROR→2）
 *   ⑧ 🔴 spawn 三态-0：`--case main` ⇒ rc 0 ＋ 7 条关键行 ＋ victim 六文件摘要复原 ＋ extensions/ 干净
 *   ⑨ 🔴 spawn 三态-0：`--case no-exile` ⇒ **rc 0** ＋ `[CHILD] sentinels=46` ＋ `[EXPECTED-RED]` ＋ `RESULT=PASS`（反例成立，spec v2.5 §4 C2）
 *   ⑩ 🔴 spawn 三态-2：未知 case ⇒ rc 2 ＋ `RESULT=ERROR` ＋ stderr `degraded:`（fail-closed）
 *   ⑪ 🔴 子协议 E2 回归：直接跑 `--child-count` ⇒ stdout **非空行数=1**、可 JSON 解析、stderr 静音（合并=1 行）
 *   ⑫ 🔴 纯函数 `classifyNoExile`：child=46 ⇒ EXPECTED-RED / ≠46 ⇒ ENV-ANOMALY（判别分支覆盖，不靠 spawn 造异常态）
 *
 * 🔴 安全网（本测试会**真实移动** `extensions/sentinels/cash-runway`）：`afterAll` 扫隔离区，
 *    若发现 victim 停在隔离区而仓库路径缺失 ⇒ 移回并点名（防测试进程被强杀把树留在半拔状态）。
 *    被测对象是真链路，**禁 mock**；重型探针须串行（锁文件负责），本文件不得与 T4/C3 并发。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT_BY_VERDICT, ProbeError } from '../../scripts/control-tower/probe-ladder';
import {
  DEFAULT_LOCK_WAIT_MS,
  EXILE_VICTIM_ID,
  KNOWN_CASES,
  LOCK_REL,
  TARGETS,
  acquireLock,
  classifyNoExile,
  countNonEmptyLines,
  dirDigest,
  exileRootFor,
  fileSha256,
  parseChildPayload,
  parseLockWaitMs,
  setDifference,
  typeCountsFromResults,
} from '../../scripts/control-tower/probe-content-exile';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const PROBE = join(REPO_ROOT, 'scripts/control-tower/probe-content-exile.ts');
const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const VICTIM_DIR = join(REPO_ROOT, 'extensions/sentinels/cash-runway');
const EXILE_ROOT = join(REPO_ROOT, '.synova-out/m6-1158/exile');

/** 安全网：把任何「停在隔离区」的 victim 移回仓库路径（测试被强杀时的兜底） */
function restoreVictimIfExiled(): void {
  if (!existsSync(EXILE_ROOT)) return;
  if (existsSync(VICTIM_DIR)) return;
  for (const ent of readdirSync(EXILE_ROOT, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const candidate = join(EXILE_ROOT, ent.name, 'cash-runway');
    if (existsSync(candidate)) {
      renameSync(candidate, VICTIM_DIR);
      console.warn(`[test-safety-net] 已把 victim 从隔离区移回：${candidate}`);
      return;
    }
  }
}

afterAll(() => {
  restoreVictimIfExiled();
});

/** 隔离区里仍停着的 victim（应为空；探针 pid ≠ 本测试进程 pid ⇒ 全扫每个 <pid>/ 子目录） */
function exiledVictims(): string[] {
  if (!existsSync(EXILE_ROOT)) return [];
  const hits: string[] = [];
  for (const ent of readdirSync(EXILE_ROOT, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const candidate = join(EXILE_ROOT, ent.name, 'cash-runway');
    if (existsSync(candidate)) hits.push(candidate);
  }
  return hits;
}

interface ProbeRun {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runProbe(args: readonly string[], extraEnv: Readonly<Record<string, string>> = {}): ProbeRun {
  try {
    const stdout = execFileSync(process.execPath, [TSX_CLI, PROBE, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: 240_000,
      env: { ...process.env, ...extraEnv },
    });
    return { rc: 0, stdout, stderr: '' };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { rc: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function lastResult(stdout: string): string {
  const hit = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('RESULT='))
    .pop();
  return hit ?? '';
}

/** 直接跑**子协议**（不经父进程）—— 用于断言「stdout 只一行 JSON」（E2 回归） */
function runChildDirect(): { rc: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [TSX_CLI, PROBE, '--child-count'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { rc: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function gitExtensionsChanges(): number {
  const out = execFileSync('git', ['status', '--porcelain', '--', 'extensions/'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '').length;
}

/**
 * 在**持锁**状态下断言全局状态（`extensions/` 计数 / git 状态 / 隔离区残留等）。
 * 为什么：默认并行时另一文件的探针可能正在移走/新增内容面 ⇒ 不持锁的全局断言会把**中间态**判成假红。
 */
async function withRepoLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const lock = await acquireLock(REPO_ROOT);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

function probeCode(fn: () => unknown): string {  try {
    fn();
    return 'NO_THROW';
  } catch (err: unknown) {
    return err instanceof ProbeError ? err.code : 'NOT_A_PROBE_ERROR';
  }
}

describe('probe-content-exile · 纯函数面（C2 / #707）', () => {
  it('① 集合差：[OTHERS] 的唯一实现（去重 / 空 / 全差）', () => {
    expect(setDifference(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(setDifference([], ['b'])).toEqual([]);
    expect(setDifference(['a'], ['a'])).toEqual([]);
    expect(setDifference(['a', 'a', 'b'], [])).toEqual(['a', 'b']);
    expect(setDifference([EXILE_VICTIM_ID, 'x'], [EXILE_VICTIM_ID])).toEqual(['x']);
  });

  it('② 隔离区路径：落在 .synova-out/m6-1158/exile/<pid>，且**不在** extensions/sentinels 里', () => {
    const p = exileRootFor('/repo', 1234);
    expect(p.includes(join('.synova-out', 'm6-1158', 'exile'))).toBe(true);
    expect(p.endsWith(join('exile', '1234'))).toBe(true);
    expect(p.includes(join('extensions', 'sentinels'))).toBe(false);
    // 缺省 pid = process.pid
    expect(exileRootFor('/repo').endsWith(join('exile', String(process.pid)))).toBe(true);
  });

  it('③ typeCounts：内容类型 → 项数；types ＝ 键数（12 类各 1 项）', () => {
    const counts = typeCountsFromResults([{ type: 'sentinel' }, { type: 'ontology' }, { type: 'sentinel' }]);
    expect(counts).toEqual({ sentinel: 2, ontology: 1 });
    expect(Object.keys(counts)).toHaveLength(2);
    expect(typeCountsFromResults([])).toEqual({});
  });

  it('④ 子协议解析：只认最后一行 JSON；无 JSON / 形状不符 ⇒ typed error 带 code', () => {
    const ok = parseChildPayload(
      'log line 1\n{"sentinels":45,"ids":["sentinel-a"],"typeCounts":{"sentinel":1},"errors":0,"degraded":false}\n',
    );
    expect(ok.sentinels).toBe(45);
    expect(ok.ids).toEqual(['sentinel-a']);
    expect(ok.degraded).toBe(false);
    expect(countNonEmptyLines('a\n\nb\n')).toBe(2);

    expect(probeCode(() => parseChildPayload('no json here\n'))).toBe('CHILD_PROTOCOL_INVALID');
    expect(probeCode(() => parseChildPayload('{"sentinels":"45"}'))).toBe('CHILD_PROTOCOL_SHAPE');
    expect(probeCode(() => parseChildPayload('{"sentinels":45,"ids":[1],"typeCounts":{},"errors":0,"degraded":false}'))).toBe(
      'CHILD_PROTOCOL_SHAPE',
    );
  });

  it('⑤ dirDigest：真 victim 目录 6 文件可算且稳定；manifest sha 64 hex', () => {
    const d1 = dirDigest(VICTIM_DIR);
    const d2 = dirDigest(VICTIM_DIR);
    expect(d1.files).toBe(6);
    expect(d1.sha256).toHaveLength(64);
    expect(d1.sha256).toBe(d2.sha256);
    expect(fileSha256(join(VICTIM_DIR, 'manifest.json'))).toMatch(/^[0-9a-f]{64}$/);
    expect(probeCode(() => dirDigest(join(REPO_ROOT, '__definitely-absent__')))).toBe('EXILE_DIR_MISSING');
  });

  it('⑥ 自声明面：TARGETS 全存在；KNOWN_CASES 两档；victim 派生一致', () => {
    expect(KNOWN_CASES).toEqual(['main', 'no-exile']);
    expect(EXILE_VICTIM_ID).toBe('sentinel-cash-runway');
    expect(TARGETS.length).toBeGreaterThanOrEqual(5);
    expect(TARGETS.filter((p) => !existsSync(join(REPO_ROOT, p)))).toEqual([]);
    expect(TARGETS.some((p) => p.endsWith('extensions/sentinels/cash-runway'))).toBe(true);
  });

  it('⑦ 三态映射：EXIT_BY_VERDICT 是 verdict→退出码的唯一真源', () => {
    expect(EXIT_BY_VERDICT.PASS).toBe(0);
    expect(EXIT_BY_VERDICT.FAIL).toBe(1);
    expect(EXIT_BY_VERDICT.NOT_IMPLEMENTED).toBe(2);
    expect(EXIT_BY_VERDICT.ERROR).toBe(2);
  });

  it('⑫ 判别分支（spec v2.5 §4 C2）：classifyNoExile —— 46 ⇒ EXPECTED-RED；≠46 ⇒ ENV-ANOMALY', () => {
    // 反例成立分支（=基线）
    expect(classifyNoExile(46)).toBe('EXPECTED-RED');
    expect(classifyNoExile(46, 46)).toBe('EXPECTED-RED');
    // 环境态异常分支（残留/并发）：45（被移走）/ 47（多出内容项）/ 0（装配失败）
    expect(classifyNoExile(45)).toBe('ENV-ANOMALY');
    expect(classifyNoExile(47)).toBe('ENV-ANOMALY');
    expect(classifyNoExile(0)).toBe('ENV-ANOMALY');
    // 基线可注入（非默认基线时以传入值为准）
    expect(classifyNoExile(46, 45)).toBe('ENV-ANOMALY');
    expect(classifyNoExile(45, 45)).toBe('EXPECTED-RED');
  });
});

describe('probe-content-exile · spawn 级（真链路，禁 mock）', () => {
  it(
    '⑧ 主用例：--case main ⇒ rc 0 ＋ 7 条关键行 ＋ victim 六文件摘要复原 ＋ extensions/ 干净',
    async () => {
      const before = dirDigest(VICTIM_DIR);
      const run = runProbe(['--case', 'main']);
      expect(run.rc).toBe(0);
      expect(lastResult(run.stdout)).toBe('RESULT=PASS');
      expect(run.stdout).toContain('[BASELINE] sentinels=46 ids=46');
      expect(run.stdout).toContain('[EXILE] cash-runway →');
      expect(run.stdout).toContain('[CHILD] sentinels=45 types=12 errors=0 degraded=false');
      expect(run.stdout).toContain('[OTHERS] baselineIds − childIds = {sentinel-cash-runway}');
      expect(run.stdout).toContain('[IN-PROCESS-RELOAD] registry=46');
      expect(run.stdout).toContain('[RESTORE]');
      // 恢复必须逐字节一致（6 文件全目录摘要），且 extensions/ 干净（持锁断言，防并行中间态假红）
      await withRepoLock(() => {
        const after = dirDigest(VICTIM_DIR);
        expect(after.files).toBe(before.files);
        expect(after.sha256).toBe(before.sha256);
        expect(gitExtensionsChanges()).toBe(0);
        // 隔离区不得残留 victim（探针 pid ≠ 本测试进程 pid ⇒ 扫描全部 <pid>/ 子目录）
        expect(exiledVictims()).toEqual([]);
      });
    },
    300_000,
  );

  it(
    '⑨ 反例 case（spec v2.5 §4 C2）：--case no-exile ⇒ rc 0 ＋ [CHILD] 46 ＋ [EXPECTED-RED] ＋ RESULT=PASS',
    async () => {
      const before = dirDigest(VICTIM_DIR);
      const run = runProbe(['--case', 'no-exile']);
      expect(run.rc).toBe(0);
      expect(lastResult(run.stdout)).toBe('RESULT=PASS');
      expect(run.stdout).toContain('[BASELINE] sentinels=46 ids=46');
      expect(run.stdout).toContain('[CHILD] sentinels=46');
      expect(run.stdout).toContain('[EXPECTED-RED] sentinels=46');
      expect(run.stdout).not.toContain('RESULT=FAIL'); // 反例成立 ≠ 判红（T10 口径）
      // 反例不得动内容面（持锁断言）
      await withRepoLock(() => {
        expect(dirDigest(VICTIM_DIR).sha256).toBe(before.sha256);
        expect(gitExtensionsChanges()).toBe(0);
      });
    },
    240_000,
  );

  it(
    '⑩ 边界 case：未知 case ⇒ rc 2（fail-closed）／锁有界等待：活持有超时 LOCK_BUSY exit 2 ＋ 死残留回收一次',
    async () => {
      // ── 边界 A：未知 case（参数错误在取锁之前 ⇒ 不动内容面）──
      const run = runProbe(['--case', '__no_such_case__']);
      expect(run.rc).toBe(2);
      expect(lastResult(run.stdout)).toBe('RESULT=ERROR');
      expect(run.stderr).toContain('degraded:');
      expect(run.stdout).toContain('UNKNOWN_CASE');
      await withRepoLock(() => {
        expect(gitExtensionsChanges()).toBe(0);
        expect(existsSync(join(VICTIM_DIR, 'manifest.json'))).toBe(true);
      });

      // ── 边界 B：v2.4 有界等待 —— env 口径（默认 180s / 可调 / 非法 fail loud）──
      expect(DEFAULT_LOCK_WAIT_MS).toBe(180_000);
      expect(parseLockWaitMs(undefined)).toBe(180_000);
      expect(parseLockWaitMs('')).toBe(180_000);
      expect(parseLockWaitMs('0')).toBe(0);
      expect(parseLockWaitMs('2500')).toBe(2500);
      expect(probeCode(() => parseLockWaitMs('abc'))).toBe('LOCK_WAIT_MS_INVALID');
      expect(probeCode(() => parseLockWaitMs('-1'))).toBe('LOCK_WAIT_MS_INVALID');

      // ── 边界 C：spawn 级「活持有 ＋ 等待上限 0」⇒ 立即超时 LOCK_BUSY ＋ exit 2（degraded）──
      //    本进程用有界等待取真锁（会等并发探针释放），拿到后让子探针立刻撞锁 ⇒ 断言**超时**语义。
      const prevEnv = process.env['SYNO_M6_LOCK_WAIT_MS'];
      process.env['SYNO_M6_LOCK_WAIT_MS'] = '60000';
      let held: { release(): void } | undefined;
      try {
        held = await acquireLock(REPO_ROOT);
        const blocked = runProbe(['--case', 'no-exile'], { SYNO_M6_LOCK_WAIT_MS: '0' });
        expect(blocked.rc).toBe(2);
        expect(lastResult(blocked.stdout)).toBe('RESULT=ERROR');
        expect(blocked.stderr).toContain('degraded:');
        expect(blocked.stderr).toContain('超时'); // 有界等待超时（不是 fail-fast 崩溃）
      } finally {
        held?.release();
        if (prevEnv === undefined) delete process.env['SYNO_M6_LOCK_WAIT_MS'];
        else process.env['SYNO_M6_LOCK_WAIT_MS'] = prevEnv;
      }

      // ── 边界 D：隔离 temp root —— 死进程残留 ⇒ 回收一次（不无限等）──
      const tmpRoot = mkdtempSync(join(tmpdir(), 'm6-c2-lock-'));
      const tmpLock = join(tmpRoot, LOCK_REL);
      try {
        mkdirSync(dirname(tmpLock), { recursive: true });
        writeFileSync(tmpLock, '99999999', 'utf8'); // 不存在的 pid ⇒ 死残留
        const reclaimed = await acquireLock(tmpRoot);
        reclaimed.release();
        expect(existsSync(tmpLock)).toBe(false);
      } finally {
        rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it(
    '⑪ 子协议 stdout 契约（E2）：--child-count ⇒ stdout 非空行数=1 ＋ JSON 可解析 ＋ stderr 静音',
    async () => {
      const child = runChildDirect();
      expect(child.rc).toBe(0);
      // ① stdout 恰好一行（非空行计数；"只一行 JSON" 的字面契约）
      expect(countNonEmptyLines(child.stdout)).toBe(1);
      // ② 该行可被子协议解析器解析，且键/值与装配一致
      const payload = parseChildPayload(child.stdout);
      expect(payload.sentinels).toBe(46);
      expect(payload.ids).toHaveLength(46);
      expect(Object.keys(payload.typeCounts)).toHaveLength(12);
      expect(payload.errors).toBe(0);
      expect(payload.degraded).toBe(false);
      // ③ 子进程日志静音（LOG_LEVEL=silent，与 C3 同口径）⇒ 合并采集（stdout+stderr）也只有 1 行
      expect(countNonEmptyLines(child.stderr)).toBe(0);
      expect(countNonEmptyLines(child.stdout) + countNonEmptyLines(child.stderr)).toBe(1);
      // ④ 子协议只读：不得动内容面（持锁断言，防并行中间态假红）
      await withRepoLock(() => {
        expect(gitExtensionsChanges()).toBe(0);
      });
    },
    240_000,
  );
});
