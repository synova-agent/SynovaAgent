#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-content-reload.ts — C1（#706 · M6-1158）
 * 「加得进」：加文件 ⇒ 生产 reload ⇒ **计数 +1** ⇒ 生产 check wrapper 写**指标级**测量值。
 *
 * 设计哲学: 一条命令只认一条真链路 —— 加内容走生产 reload，出测量值走生产 check wrapper 与
 *   `metricSink`；探针自己既不 INSERT 也不猜扫描根，任何"没测到"一律 exit 2，绝不冒充绿。
 *
 * 判据来源（唯一）: `.handbook/派单件/2026-10-30-规格-1158-M6-三条不可妥协.md` §4 C1（v2.3 @ b68fb8d）
 *   正常   `--case main`        : [BASELINE]46 → [ADD] → [AFTER-RELOAD]47 → [MEASUREMENT] → [CLEANUP]46 → RESULT=PASS
 *   降级   `--case bad-manifest`: [RETAINED] → degraded=true → [EXPECTED-FAIL] → RESULT=FAIL（exit 1，合法红）
 *   反例   `--case no-reload`   : [EXPECTED-RED] sentinels=46（未 +1）⇒ exit 0；若仍 +1 ⇒ exit 1（判据无牙齿）
 *
 * 契约（铁律 47；统一探针契约的唯一实现在 ./probe-ladder.ts，本件**不另造**）:
 *   @input    — `--case <main|bad-manifest|no-reload>`｜`--all`（**仅主用例**，DS④）｜缺省/未知 ⇒ exit 2
 *   @output   — stdout 逐行 `[TAG] …` ＋ 末行由 `out.finish()` 签发 `RESULT=<verdict>`
 *   @exit     — 0=PASS｜1=FAIL（含 bad-manifest 的**期望红**）｜2=无法判定/降级（fail-closed：2 绝不等于通过）
 *   @degraded — stderr 一行 `degraded: <原因>` ＋ 追加 JSON 到 `SYNO_GATE_DEGRADED_LOG`
 *               （字段 time/component/code/phase/retryable；D2 约定）＋ exit 2
 *   @authority — 谁能跑：控制塔维护者 / 独立复核者。运行期**真实增删** `extensions/sentinels/**`
 *               ⇒ 必须持 `.synova-out/m6-1158/.lock`（拿不到 ⇒ LOCK_BUSY ＋ exit 2；**并发不安全**）。
 *   @encoding  — 全文件 UTF-8（D732）；落盘一律显式 `utf8`，不依赖终端代码页。
 *   @判别力    — 自检（D4）：反例 `no-reload` 证明「+1」是 reload 的信号，不是目录存在性的假信号。
 *
 * 结构（File → Role）:
 *   ├ 常量 TARGETS / KNOWN_CASES / BASELINE_SENTINEL_COUNT / EXPECTED_SCORE — ladder 自声明面
 *   ├ readSentinelDirNames / sentinelIdOf / isFiniteScore / resolveCases       — 纯函数（测试直取）
 *   ├ isPidAlive / acquireLock                                                — 并发互斥（stale 回收）
 *   ├ copyFixture / restoreFixture / fixtureSourceDigest                      — 增删 ＋ 恢复 ＋ 哈希核对
 *   ├ runMainCase / runBadManifestCase / runNoReloadCase                       — 三个 case
 *   └ main                                                                    — CLI 分派 ＋ 三态退出
 *
 * 测量值口径（**禁从被测函数反推**，EXPECTED_SCORE 由 compute 公式独立手算）:
 *   夹具 = Agent×1 `{monitored:true}` ＋ Tool×1 `{error:false}`；aggregate 传入
 *   agentCount=1, autonomyLevel=2, monitoredAgents=1, totalAgents=1, recentErrors=0, totalOperations=1
 *   ⇒ autonomy = 2/4 = 0.5                    （0.3 × 0.5  = 0.15）
 *     monitoredRatio = 1/1 = 1                （0.3 × 1    = 0.30）
 *     errorRate = 0/1 ⇒ reliability = 1       （0.2 × 1    = 0.20）
 *     scale = min(1/20, 1) = 0.05             （0.2 × 0.05 = 0.01）
 *   ⇒ score = round((0.15+0.30+0.20+0.01) × 100) / 100 = **0.66**
 *
 * 已知限制（Known Limitations，如实标注）:
 *   ① 46/47 是 **as_of b8edf9860** 的内容面硬基线（48 目录 − `shared` − `_extinct`）；内容面增删后
 *      必须同步 `BASELINE_SENTINEL_COUNT`，否则本探针报「基线漂移」红（刻意如此：不静默放宽判据）。
 *   ② `content-reload` **不调 unregister**（裁 167-U2）⇒ 清理必须 `unregister` ＋ `clearSentinelCache`
 *      ＋ 再 `reload` 三步；漏任一步计数恒 47（规格 §4 C1 步骤 7）。
 *   ③ 运行期真实增删 `extensions/sentinels/**` ⇒ **并发不安全**。锁 stale 回收靠同机 pid 存活探测
 *      （跨机/容器不可靠）。进程被强杀留下的 `probe-c1-*` / `probe-bad-*` 目录**不自动删**（防删错），
 *      下一次运行会 `degraded: 夹具残留` ＋ exit 2 **点名**，由人确认后清理。
 *   ④ 测量值只在 `:memory:` 库内断言，**不写生产库**；轮次级（`SENTINEL-FINDINGS-*`）不在本件判据内。
 *   ⑤ 本机 node v24.16.0；node22 未复跑（#1158 U1）。
 *   ⑥ `bad-manifest` 的 `RESULT=FAIL` 是**规格指定的期望红**（坏内容必须被拒），不代表能力回归。
 *   ⑦ 全量 `initContentTypes()` 装配 12 个内容项（含 presets/ontology 等）；本件不判定它们的业务正确性，
 *      只判「哨兵计数 ＋ 指标级测量值」这一条切片。
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { listSentinels } from '../../src/agent/sentinel-service';
import { initContentTypes } from '../../src/deploy/content-registry';
import { reloadContentTypes } from '../../src/deploy/content-reload';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { clearSentinelCache } from '../../src/sentinel/sentinel-loader';
import type { SentinelCheckResult, SentinelContext } from '../../src/sentinel/types';
import { reconcileSchema } from '../../src/store/schema-migration';
import {
  ProbeError,
  ProbeOutput,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  type ProbeModule,
} from './probe-ladder';

// ══════════════════════════════════════════════════════════════════════════════
// 一、常量与自声明面
// ══════════════════════════════════════════════════════════════════════════════

/** 被测的内容面根（运行期真实增删 ⇒ 见 @authority / 已知限制③） */
const SENTINELS_DIR_REL = 'extensions/sentinels';
/** 夹具源（只读；3 文件，见 FIXTURE_FILES） */
const FIXTURE_SOURCE_REL = 'extensions/sentinels/agent-deployment-maturity';
/** 夹具源的 3 个文件（消费『复制 3 文件』的判据口径） */
const FIXTURE_FILES: readonly string[] = [
  'manifest.json',
  'aggregate.ts',
  'computes/compute-agent-deployment-maturity.ts',
];
/** 指标级测量值（loader wrapper 写入，非本探针 INSERT） */
const METRIC_ID = 'AGENT-DEPLOYMENT-MATURITY-SCORE';
const METRIC_UNIT = 'ratio';
/** 内容面基线（as_of b8edf9860：48 目录 − shared − _extinct = 46） */
const BASELINE_SENTINEL_COUNT = 46;
/** 手算常量（推导见文件头「测量值口径」） */
export const EXPECTED_SCORE = 0.66;
/** 隔离/证据落点（`.synova-out/` 已 gitignore） */
const EVIDENCE_DIR_REL = '.synova-out/m6-1158';
const DATA_DIR_REL = `${EVIDENCE_DIR_REL}/data`;
const LOCK_REL = `${EVIDENCE_DIR_REL}/.lock`;
const DEGRADED_LOG_REL = `${EVIDENCE_DIR_REL}/degraded-events.log`;
/** 残留哨兵目录前缀（强杀后由人确认清理；本件不自动删未知目录） */
const FIXTURE_PREFIXES: readonly string[] = ['probe-c1-', 'probe-bad-'];
const COMPONENT = 'probe-content-reload';

/** 场景常量（与 KNOWN_CASES 同源，禁散落字面量） */
const CASE_MAIN = 'main';
const CASE_BAD_MANIFEST = 'bad-manifest';
const CASE_NO_RELOAD = 'no-reload';

/**
 * 本探针判据所依赖的目标件（仓库相对路径）—— 供 ladder 的
 * 「报 PASS ⇒ TARGETS 非空且全部存在」不变式机械校验。
 * 🔴 必须写成**字面量引号数组**：ladder 以源文本正则解析（`/'([^']+)'|"([^"]+)"/g`），
 *    写模板串 / `.map()` / 变量拼接会被解析成空表 ⇒ 一旦报绿即判「TARGETS 空表」。
 */
export const TARGETS: readonly string[] = [
  'src/deploy/content-reload.ts',
  'src/deploy/content-registry.ts',
  'src/sentinel/sentinel-loader.ts',
  'src/sentinel/registry.ts',
  'src/agent/sentinel-service.ts',
  'src/sentinel/metric-readings-writer.ts',
  'src/store/schema-migration.ts',
  'extensions/sentinels/agent-deployment-maturity',
];

export const KNOWN_CASES: readonly string[] = [CASE_MAIN, CASE_BAD_MANIFEST, CASE_NO_RELOAD];

// ══════════════════════════════════════════════════════════════════════════════
// 二、纯函数（测试直取；不跑真实链路）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 独立派生内容项目录名 —— [BASELINE] 的 `dirs=` 由 **readdir** 得来，不单靠 registry
 * （规格 §4 C1：`[BASELINE] sentinels=46 dirs=46`，两数不同源才算独立证据）。
 *
 * @input  root 仓库根
 * @output 目录名（升序）；目录不存在 ⇒ 空数组
 * @degrade 不抛（读失败由调用方按 0 项 ⇒ exit 2 处理）
 */
export function readSentinelDirNames(root: string): string[] {
  const dir = join(root, SENTINELS_DIR_REL);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'shared' && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
}

/** 目录名 → registry id（生产派生链：`sentinel-${manifest.name}`，见 sentinel-loader.ts:250） */
export function sentinelIdOf(dirName: string): string {
  return `sentinel-${dirName}`;
}

/** 测量值有效性：有限数才算"出测量值"（NaN / Infinity / 非数字都不得算过） */
export function isFiniteScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 解析 CLI 场景 —— `--all` **只跑主用例**（规格 §4 C1 DS④：反例不参与自动跑）。
 *
 * @input  argv
 * @output { cases, all }；`--all` ⇒ cases=['main'] 且 all=true
 * @error  未知/缺省场景 ⇒ 抛 ProbeError（不回落默认场景）
 */
export function resolveCases(argv: readonly string[]): { cases: string[]; all: boolean } {
  const parsed = parseProbeArgs(KNOWN_CASES, argv);
  if (parsed.all) return { cases: [CASE_MAIN], all: true };
  return { cases: parsed.cases, all: false };
}

/** 依次拼接 3 个夹具源文件的 sha256 —— 用于证明「恢复后源文件一字未动」 */
export function fixtureSourceDigest(root: string): string {
  const h = createHash('sha256');
  for (const rel of FIXTURE_FILES) {
    h.update(rel).update('\0');
    h.update(readFileSync(join(root, FIXTURE_SOURCE_REL, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}

/** 残留夹具目录（强杀遗留）—— 只点名，不自动删 */
export function findResidualFixtures(root: string): string[] {
  return readSentinelDirNames(root).filter((name) => FIXTURE_PREFIXES.some((p) => name.startsWith(p)));
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、并发互斥（锁文件）
// ══════════════════════════════════════════════════════════════════════════════

export interface ProbeLock {
  readonly path: string;
  release(): void;
}

/**
 * 同机 pid 存活探测（锁 stale 回收用）。
 * @degrade EPERM（进程存在但无权 signal）⇒ 视为存活（保守：宁可不回收）
 */
export function isPidAlive(pidText: string): boolean {
  const pid = Number.parseInt(pidText.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string }).code === 'EPERM';
  }
}

/**
 * 取锁（`wx` 原子创建）；已被活进程持有 ⇒ LOCK_BUSY；死进程残留 ⇒ 回收一次。
 *
 * @input  root 仓库根
 * @output ProbeLock（release 幂等）
 * @error  LOCK_BUSY（活持有 / 回收失败）⇒ 调用方 degraded ＋ exit 2
 */
export function acquireLock(root: string): ProbeLock {
  const path = join(root, LOCK_REL);
  mkdirSync(dirname(path), { recursive: true });
  const open = (): void => {
    const fd = openSync(path, 'wx');
    try {
      writeSync(fd, String(process.pid));
    } finally {
      closeSync(fd);
    }
  };
  try {
    open();
  } catch (err: unknown) {
    let holder = '';
    try {
      holder = readFileSync(path, 'utf8');
    } catch {
      holder = ''; // 读不到持有者 ⇒ 按死锁处理（下面回收一次）
    }
    if (isPidAlive(holder)) {
      throw new ProbeError(
        'LOCK_BUSY',
        'lock',
        `锁被占用（pid=${holder.trim()}，锁=${LOCK_REL}）—— 并发探针禁止同跑（规格 §7 红线）`,
      );
    }
    try {
      unlinkSync(path);
    } catch (e2: unknown) {
      throw new ProbeError(
        'LOCK_BUSY',
        'lock',
        `锁不可回收: ${lockIoMessage(err)}; unlink: ${lockIoMessage(e2)}`,
      );
    }
    try {
      open();
    } catch (e3: unknown) {
      throw new ProbeError('LOCK_BUSY', 'lock', `锁回收后仍取不到: ${lockIoMessage(e3)}`);
    }
  }
  return {
    path,
    release(): void {
      try {
        unlinkSync(path);
      } catch (err: unknown) {
        if ((err as { code?: string }).code !== 'ENOENT') {
          // 释放失败必须可见（铁律 24 不空吞），但不改判定：残留锁会被下次 pid 存活探测回收
          console.error(`[warn] 锁释放失败（${LOCK_REL}）: ${lockIoMessage(err)}`);
        }
      }
    },
  };
}

function lockIoMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、降级出口（@degraded：stderr ＋ SYNO_GATE_DEGRADED_LOG，字段口径同 D2）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 打印 `degraded: <原因>` 并追加一条降级事件 JSON。
 *
 * @input  root / code / phase / message / retryable
 * @output 无返回值（副作用：stderr ＋ 日志一行）
 * @degrade 日志写失败 ⇒ 再打一条 `[warn]`（可见），**不改退出码**（调用方仍 exit 2）
 *
 * 落点口径：显式 `SYNO_GATE_DEGRADED_LOG` 优先（与 `check-gate-integrity.sh` 同env缝）；
 *   缺省落 `.synova-out/m6-1158/degraded-events.log`（gitignored）而不是门禁默认的
 *   `.codex/control-tower/logs/`——后者**未 gitignore**，探针写它会弄脏工作树。
 */
function emitDegraded(root: string, code: string, phase: string, message: string, retryable = false): void {
  process.stderr.write(`degraded: ${message}\n`);
  const logPath = process.env['SYNO_GATE_DEGRADED_LOG'] ?? join(root, DEGRADED_LOG_REL);
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(
      logPath,
      `${JSON.stringify({ time: new Date().toISOString(), component: COMPONENT, code, phase, retryable })}\n`,
      'utf8',
    );
  } catch (err: unknown) {
    console.error(`[warn] 降级日志写入失败（${logPath}）: ${lockIoMessage(err)}`);
  }
}

function toProbeError(err: unknown, code: string, phase: string, retryable = false): ProbeError {
  if (err instanceof ProbeError) return err;
  return new ProbeError(code, phase, err instanceof Error ? err.message : String(err), retryable);
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、夹具增删（真实目录；finally 恢复 ＋ 哈希核对）
// ══════════════════════════════════════════════════════════════════════════════

interface Fixture {
  readonly dirName: string;
  readonly targetDir: string;
}

/**
 * 复制 `agent-deployment-maturity` 3 文件 → `extensions/sentinels/<dirName>/`。
 * manifest 的 `name` / `id` 改写为目录名同名值（registry id 由此派生）。
 *
 * @input  root / dirName
 * @output Fixture（targetDir 绝对路径）
 * @error  FIXTURE_SOURCE_MISSING / FIXTURE_TARGET_EXISTS / FIXTURE_COPY_FAILED
 */
function copyFixture(root: string, dirName: string): Fixture {
  const srcDir = join(root, FIXTURE_SOURCE_REL);
  const targetDir = join(root, SENTINELS_DIR_REL, dirName);
  if (!existsSync(srcDir)) {
    throw new ProbeError('FIXTURE_SOURCE_MISSING', 'fixture', `夹具源不存在: ${FIXTURE_SOURCE_REL}`);
  }
  if (existsSync(targetDir)) {
    throw new ProbeError('FIXTURE_TARGET_EXISTS', 'fixture', `目标目录已存在（拒绝覆盖）: ${dirName}`);
  }
  try {
    mkdirSync(join(targetDir, 'computes'), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    manifest['name'] = dirName;
    manifest['id'] = sentinelIdOf(dirName);
    writeFileSync(join(targetDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    copyFileSync(join(srcDir, 'aggregate.ts'), join(targetDir, 'aggregate.ts'));
    copyFileSync(
      join(srcDir, 'computes', 'compute-agent-deployment-maturity.ts'),
      join(targetDir, 'computes', 'compute-agent-deployment-maturity.ts'),
    );
  } catch (err: unknown) {
    // 半成品目录必须被清掉，否则会污染下一次 baseline（不静默）
    try {
      rmSync(targetDir, { recursive: true, force: true });
    } catch (cleanupErr: unknown) {
      console.error(`[warn] 半成品夹具清理失败（${dirName}）: ${lockIoMessage(cleanupErr)}`);
    }
    throw toProbeError(err, 'FIXTURE_COPY_FAILED', `fixture:${dirName}`, true);
  }
  return { dirName, targetDir };
}

interface RestoreResult {
  readonly sentinels: number;
  readonly dirs: number;
}

/**
 * 恢复：删目录 → `unregister` → `clearSentinelCache` → 再 `reload`（缺一即计数不归位）。
 *
 * @input  root / fixture / expectDirs
 * @output 恢复后 registry 计数 ＋ readdir 目录数
 * @error  RESTORE_FAILED（任一不符 ⇒ 调用方 degraded ＋ exit 2，**不静默**）
 */
async function restoreFixture(root: string, fixture: Fixture, expectDirs: number): Promise<RestoreResult> {
  const problems: string[] = [];
  try {
    rmSync(fixture.targetDir, { recursive: true, force: true });
  } catch (err: unknown) {
    problems.push(`删目录失败: ${lockIoMessage(err)}`);
  }
  if (existsSync(fixture.targetDir)) problems.push(`目录仍存在: ${fixture.targetDir}`);
  getSentinelRegistry().unregister(sentinelIdOf(fixture.dirName));
  clearSentinelCache();
  try {
    await reloadContentTypes({ dataDir: join(root, DATA_DIR_REL) });
  } catch (err: unknown) {
    problems.push(`恢复 reload 失败: ${lockIoMessage(err)}`);
  }
  const sentinels = await registryTotal();
  const dirs = readSentinelDirNames(root).length;
  if (sentinels !== expectDirs) problems.push(`registry 计数未恢复: ${sentinels} ≠ ${expectDirs}`);
  if (dirs !== expectDirs) problems.push(`目录计数未恢复: ${dirs} ≠ ${expectDirs}`);
  if (problems.length > 0) {
    throw new ProbeError('RESTORE_FAILED', 'cleanup', problems.join('; '));
  }
  return { sentinels, dirs };
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、引导（DB / registry / 夹具 store）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 唯一计数出口 —— `listSentinels().total`（registry 路由，**不是** `loadSentinels()` 的目录数）。
 * 规格 §4 C1 步骤 4/7 明确要求取这个出口（清缓存后 `loadSentinels()` 会返回 45，是假信号）。
 *
 * @input  无
 * @output registry 里的哨兵总数
 * @degrade `listSentinels()` 报 ok=false（registry 访问失败）⇒ 抛 ProbeError（不把 0 当结论）
 */
async function registryTotal(): Promise<number> {
  const listed = await listSentinels();
  if (!listed.ok) {
    throw new ProbeError('LIST_SENTINELS_FAILED', 'count', 'listSentinels 返回 ok=false（registry 访问失败）', true);
  }
  return listed.total;
}

/** `await initContentTypes()` → 返回 registry 计数（规格 §4 C1 步骤 1） */
async function bootstrapSentinelRegistry(): Promise<number> {
  try {
    await initContentTypes();
  } catch (err: unknown) {
    throw toProbeError(err, 'CONTENT_INIT_FAILED', 'bootstrap', true);
  }
  return registryTotal();
}

/** `:memory:` ＋ `reconcileSchema`（范式见 tests/sentinel/metric-readings-writer.test.ts:31-61） */
function openMemoryDb(): Database.Database {
  try {
    const db = new Database(':memory:');
    reconcileSchema(db);
    return db;
  } catch (err: unknown) {
    throw toProbeError(err, 'DB_INIT_FAILED', 'db', true);
  }
}

interface FixtureStore {
  queryNodes(
    type: string,
    filters?: Record<string, unknown>,
    graph?: string,
  ): Array<{ id: string; type: string; props: Record<string, unknown> }>;
}

/**
 * 夹具图（写死 ≥1 Agent ＋ ≥1 Tool —— 不写 ⇒ aggregate 走 empty-read 分支 ⇒ compute 根本不跑）。
 * 🔴 生产 wrapper 会加 `orgId` 过滤，本夹具按类型返回即可（租户过滤不在本件判据面）。
 */
function createFixtureStore(): FixtureStore {
  const agent = { id: 'a1', type: 'Agent', props: { monitored: true } };
  const tool = { id: 't1', type: 'Tool', props: { error: false } };
  return {
    queryNodes(type: string): Array<{ id: string; type: string; props: Record<string, unknown> }> {
      if (type === 'Agent') return [agent];
      if (type === 'Tool') return [tool];
      return [];
    },
  };
}

interface MetricRowView {
  metric_id: string;
  value: number;
  unit: string | null;
  org_id: string;
  degraded: number;
}

/** 读 `metric_readings`（探针只读，**从不 INSERT**） */
function readMetricRows(db: Database.Database, orgId: string): MetricRowView[] {
  const rows = db
    .prepare(
      'SELECT metric_id, value, unit, org_id, degraded FROM metric_readings WHERE org_id = ? AND metric_id = ? ORDER BY observed_at',
    )
    .all(orgId, METRIC_ID);
  return rows as MetricRowView[];
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、场景 main（正常：加 ⇒ reload ⇒ +1 ⇒ 测量值 ⇒ 清理回基线）
// ══════════════════════════════════════════════════════════════════════════════

/** 正常场景主体（失败一律 out.fail＝真红；基础设施异常才抛） */
async function mainCaseBody(root: string, out: ProbeOutput, fixture: Fixture): Promise<void> {
  out.note(`[ADD] ${fixture.dirName}`);
  out.pass(
    `夹具已物理新增：dirs=${readSentinelDirNames(root).length}（manifest.name=${fixture.dirName}，与目录同名）`,
    'L2',
  );

  const report = await reloadContentTypes({ dataDir: join(root, DATA_DIR_REL) });
  out.note(
    `[RELOAD] reloaded=${report.reloaded.length} retained=${report.retained.length} ` +
      `degraded=${report.degraded} persisted=${report.persisted} errors=${report.errors.length} warnings=${report.warnings.length}`,
  );
  if (report.degraded) {
    out.fail(
      `生产 reload 报 degraded（retained=${report.retained.length} errors=${report.errors.length}）` +
        ' ⇒ 干净内容面不应降级',
      'L2',
    );
  } else {
    out.pass('生产 reload 未降级（retained=0 errors=0 persisted=true）', 'L2');
  }

  const afterReload = await registryTotal();
  out.note(`[AFTER-RELOAD] sentinels=${afterReload}`);
  if (afterReload === BASELINE_SENTINEL_COUNT + 1) {
    out.pass(`[AFTER-RELOAD] 计数 +1：${BASELINE_SENTINEL_COUNT} → ${afterReload}`, 'L2');
  } else {
    out.fail(
      `[AFTER-RELOAD] 计数未 +1：${afterReload}（期望 ${BASELINE_SENTINEL_COUNT + 1}）⇒ 加进去的内容未被装配`,
      'L2',
    );
  }

  const id = sentinelIdOf(fixture.dirName);
  const sentinel = getSentinelRegistry().get(id);
  if (sentinel === undefined) {
    out.fail(`registry 取不到新哨兵 id=${id} ⇒ 目录已加但 manifest→id 派生链没接上`, 'L2');
    return;
  }
  out.pass(`registry 取到新哨兵 ${id}（sentinel-<manifest.name> 派生链成立）`, 'L2');

  const db = openMemoryDb();
  try {
    const sink = createMetricSink(db);
    const orgId = `probe-c1-${process.pid}`;
    const store = createFixtureStore();
    const ctx: SentinelContext = {
      db: store,
      graphStore: store,
      metricSink: sink,
      teamId: orgId,
      now: new Date(),
    };
    const result: SentinelCheckResult = await sentinel.check(ctx);
    out.pass(
      `check 走生产 wrapper 完成：ok=${result.ok} findings=${result.findings.length} ` +
        `metrics=${(result.metrics ?? []).length} degraded=${String(result.degraded)}`,
      'L2',
    );

    const rows = readMetricRows(db, orgId);
    if (rows.length !== 1) {
      out.fail(
        `metric_readings 期望 1 行，实测 ${rows.length} 行（org=${orgId} metric=${METRIC_ID}）` +
          ' ⇒ 测量值没经 loader wrapper 落库',
        'L2',
      );
      return;
    }
    const row = rows[0];
    if (row === undefined) {
      out.fail(`metric_readings 行读取异常（rows.length=1 但取不到首行）`, 'L2');
      return;
    }
    if (!isFiniteScore(row.value)) {
      out.fail(`测量值非有限数：${String(row.value)} ⇒ 不得算「出测量值」`, 'L2');
    } else {
      out.note(`[MEASUREMENT] metricId=${row.metric_id} value=${row.value} org=${row.org_id}`);
    }
    if (row.value === EXPECTED_SCORE) {
      out.pass(`测量值 = 手算常量 ${EXPECTED_SCORE}（禁从被测函数反推）`, 'L2');
    } else {
      out.fail(`测量值 ${String(row.value)} ≠ 手算常量 ${EXPECTED_SCORE} ⇒ 计算口径漂移`, 'L2');
    }
    if (row.unit === METRIC_UNIT) {
      out.pass(`unit=${METRIC_UNIT}（与 metricId 语义一致）`, 'L2');
    } else {
      out.fail(`unit=${String(row.unit)} ≠ ${METRIC_UNIT}`, 'L2');
    }
  } finally {
    db.close();
  }
}

async function runMainCase(root: string, out: ProbeOutput): Promise<void> {
  out.case(CASE_MAIN);
  const baselineDirs = readSentinelDirNames(root);
  if (baselineDirs.length === 0) {
    throw new ProbeError('BASELINE_EMPTY', 'baseline', `${SENTINELS_DIR_REL} 不存在或 0 项 ⇒ 无法判定`);
  }
  const baselineCount = await bootstrapSentinelRegistry();
  out.note(`[BASELINE] sentinels=${baselineCount} dirs=${baselineDirs.length}`);
  if (baselineCount !== BASELINE_SENTINEL_COUNT || baselineDirs.length !== BASELINE_SENTINEL_COUNT) {
    out.fail(
      `基线漂移：[BASELINE] sentinels=${baselineCount} dirs=${baselineDirs.length}，` +
        `判据基线=${BASELINE_SENTINEL_COUNT}（as_of b8edf9860）—— 内容面增删后须同步 BASELINE_SENTINEL_COUNT`,
      'L2',
    );
    return;
  }
  out.pass(`基线 ${BASELINE_SENTINEL_COUNT} 内容项：registry 与 readdir 两路独立同源一致`, 'L2');

  const dirName = `probe-c1-${process.pid}-${Date.now().toString(36)}`;
  const fixture = copyFixture(root, dirName);
  const sourceDigestBefore = fixtureSourceDigest(root);

  let bodyError: ProbeError | undefined;
  let restoreError: ProbeError | undefined;
  try {
    await mainCaseBody(root, out, fixture);
  } catch (err: unknown) {
    bodyError = toProbeError(err, 'CASE_FAILED', `case:${CASE_MAIN}`, true);
  }
  try {
    const restored = await restoreFixture(root, fixture, baselineDirs.length);
    out.note(`[CLEANUP] sentinels=${restored.sentinels} dirs=${restored.dirs}`);
    const sourceDigestAfter = fixtureSourceDigest(root);
    if (sourceDigestAfter !== sourceDigestBefore) {
      throw new ProbeError(
        'RESTORE_FAILED',
        'cleanup',
        `夹具源 3 文件 sha256 变了：${sourceDigestBefore.slice(0, 12)}… → ${sourceDigestAfter.slice(0, 12)}…`,
      );
    }
    out.pass(
      `[CLEANUP] 计数回基线 ${baselineDirs.length}（删目录 ＋ unregister ＋ clearSentinelCache ＋ reload）；` +
        `夹具源 sha256 未变（${sourceDigestAfter.slice(0, 12)}…）`,
      'L2',
    );
  } catch (err: unknown) {
    restoreError = toProbeError(err, 'RESTORE_FAILED', 'cleanup');
  }
  if (restoreError !== undefined) throw restoreError;
  if (bodyError !== undefined) throw bodyError;
}

// ══════════════════════════════════════════════════════════════════════════════
// 八、场景 bad-manifest（降级：坏内容被拒 ＋ 其余仍 reload ＋ degraded）
// ══════════════════════════════════════════════════════════════════════════════

/** 故意坏的 manifest（JSON 语法错 —— 规格 §4 C1「坏内容必须被拒」） */
const BAD_MANIFEST_BODY = '{ "name": "probe-bad", "type": "sentinel",  <-- 故意坏的 JSON';

async function runBadManifestCase(root: string, out: ProbeOutput): Promise<void> {
  out.case(CASE_BAD_MANIFEST);
  const baselineDirs = readSentinelDirNames(root);
  if (baselineDirs.length === 0) {
    throw new ProbeError('BASELINE_EMPTY', 'baseline', `${SENTINELS_DIR_REL} 不存在或 0 项 ⇒ 无法判定`);
  }
  const baselineCount = await bootstrapSentinelRegistry();
  out.note(`[BASELINE] sentinels=${baselineCount} dirs=${baselineDirs.length}`);

  const dirName = `probe-bad-${process.pid}-${Date.now().toString(36)}`;
  const targetDir = join(root, SENTINELS_DIR_REL, dirName);
  try {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'manifest.json'), BAD_MANIFEST_BODY, 'utf8');
  } catch (err: unknown) {
    throw toProbeError(err, 'FIXTURE_WRITE_FAILED', `fixture:${dirName}`, true);
  }
  const fixture: Fixture = { dirName, targetDir };

  let bodyError: ProbeError | undefined;
  let restoreError: ProbeError | undefined;
  try {
    out.note(`[ADD] ${dirName}（坏 manifest，故意；dirs=${readSentinelDirNames(root).length}）`);
    const report = await reloadContentTypes({ dataDir: join(root, DATA_DIR_REL) });
    out.note(
      `[RELOAD] reloaded=${report.reloaded.length} retained=${report.retained.length} ` +
        `degraded=${report.degraded} persisted=${report.persisted} errors=${report.errors.length} warnings=${report.warnings.length}`,
    );

    const listed =
      report.warnings.some((w) => w.includes(dirName)) ||
      report.errors.some((e) => e.includes(dirName)) ||
      report.retained.some((r) => r.dir.includes(dirName) || r.error.includes(dirName));
    if (listed) {
      out.note(`[RETAINED] ${dirName}（loader 拒绝并留清单）degraded=${report.degraded}`);
      out.pass('坏内容项被拒并留清单（失败隔离生效，不静默丢失）', 'L2');
    } else {
      out.fail(`[RETAINED] 清单里看不到坏内容项 ${dirName} ⇒ 静默丢失（铁律 24/31 违反）`, 'L2');
    }
    if (report.degraded) {
      out.pass('degraded=true（坏内容使内容面降级，信号外传）', 'L2');
    } else {
      out.fail('degraded=false ⇒ 坏内容未被报出（降级信号丢失）', 'L2');
    }

    const afterCount = await registryTotal();
    const afterDirs = readSentinelDirNames(root).length;
    if (afterCount === baselineCount) {
      out.pass(
        `其余项仍 reloaded：registry=${afterCount}（坏目录在盘：dirs=${afterDirs}，但**未被装配**）`,
        'L2',
      );
    } else {
      out.fail(`坏内容带崩了其余项：registry=${afterCount} ≠ 基线 ${baselineCount}`, 'L2');
    }
    if (getSentinelRegistry().get(sentinelIdOf(dirName)) === undefined) {
      out.pass('坏内容未进 registry（拒新绑定）', 'L2');
    } else {
      out.fail('坏内容进了 registry ⇒ 失败隔离失效', 'L2');
    }
  } catch (err: unknown) {
    bodyError = toProbeError(err, 'CASE_FAILED', `case:${CASE_BAD_MANIFEST}`, true);
  }
  try {
    const restored = await restoreFixture(root, fixture, baselineDirs.length);
    out.note(`[CLEANUP] sentinels=${restored.sentinels} dirs=${restored.dirs}`);
  } catch (err: unknown) {
    restoreError = toProbeError(err, 'RESTORE_FAILED', 'cleanup');
  }
  if (restoreError !== undefined) throw restoreError;
  if (bodyError !== undefined) throw bodyError;

  // 规格 §4 C1：坏内容必须被拒＝**合法的红**；RESULT=FAIL/exit 1 是本 case 的**指定期望**
  out.note(
    '[EXPECTED-FAIL] 规格 §4 C1：--case bad-manifest 的 RESULT=FAIL / exit 1 是**期望红**' +
      '（坏内容必须被拒）；上面 ✅ 项证明失败隔离生效，本条 fail 不代表能力回归',
  );
  out.fail(
    '[EXPECTED-FAIL] 内容面因坏内容降级 ⇒ 本 case 判定 FAIL（规格指定；非回归）',
    'L2',
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 九、场景 no-reload（反例：不调 reload ⇒ 计数不 +1 ⇒ 证明「+1」是 reload 的信号）
// ══════════════════════════════════════════════════════════════════════════════

async function runNoReloadCase(root: string, out: ProbeOutput): Promise<void> {
  out.case(CASE_NO_RELOAD);
  const baselineDirs = readSentinelDirNames(root);
  if (baselineDirs.length === 0) {
    throw new ProbeError('BASELINE_EMPTY', 'baseline', `${SENTINELS_DIR_REL} 不存在或 0 项 ⇒ 无法判定`);
  }
  const baselineCount = await bootstrapSentinelRegistry();
  out.note(`[BASELINE] sentinels=${baselineCount} dirs=${baselineDirs.length}`);

  const dirName = `probe-c1-${process.pid}-${Date.now().toString(36)}`;
  const fixture = copyFixture(root, dirName);

  let bodyError: ProbeError | undefined;
  let restoreError: ProbeError | undefined;
  try {
    out.note(`[ADD] ${dirName}`);
    out.pass(
      `夹具已物理新增：dirs ${baselineDirs.length} → ${readSentinelDirNames(root).length}（**未调 reload**）`,
      'L2',
    );
    const count = await registryTotal();
    out.note(`[EXPECTED-RED] sentinels=${count}（未 +1；未调 reload ⇒ 新目录未被装配）`);
    if (count === baselineCount) {
      out.pass(
        '[EXPECTED-RED] 反例成立：不调 reload ⇒ 计数未 +1 ⇒ 「+1」确由 reload 驱动（判据有牙齿）',
        'L2',
      );
    } else {
      out.fail(
        `[EXPECTED-RED] 反例不成立：未调 reload 但计数已变为 ${count} ⇒ 「+1」不是 reload 的信号（判据无牙齿）`,
        'L2',
      );
    }
  } catch (err: unknown) {
    bodyError = toProbeError(err, 'CASE_FAILED', `case:${CASE_NO_RELOAD}`, true);
  }
  try {
    const restored = await restoreFixture(root, fixture, baselineDirs.length);
    out.note(`[CLEANUP] sentinels=${restored.sentinels} dirs=${restored.dirs}`);
  } catch (err: unknown) {
    restoreError = toProbeError(err, 'RESTORE_FAILED', 'cleanup');
  }
  if (restoreError !== undefined) throw restoreError;
  if (bodyError !== undefined) throw bodyError;
}

// ══════════════════════════════════════════════════════════════════════════════
// 十、CLI
// ══════════════════════════════════════════════════════════════════════════════

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('probe-content-reload（C1 / #706 · 加得进）');

  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    const e = toProbeError(err, 'REPO_ROOT_NOT_FOUND', 'bootstrap');
    emitDegraded(process.cwd(), e.code, e.phase, e.message);
    out.error(`无法定位仓库根: ${e.message}`);
    out.finish();
    return 2;
  }
  // loader / readContentVersion 用 process.cwd() 定位 extensions/** ⇒ 把 cwd 钉死到唯一仓库根
  process.chdir(root);
  out.note(
    `PROBE=probe-content-reload card=C1(#706) repoRoot=${root} node=${process.version} ` +
      `spec=.handbook/派单件/2026-10-30-规格-1158-M6-三条不可妥协.md §4 C1`,
  );

  let cases: string[];
  let all = false;
  try {
    const resolved = resolveCases(argv);
    cases = resolved.cases;
    all = resolved.all;
  } catch (err: unknown) {
    const e = toProbeError(err, 'ARGS_INVALID', 'args');
    emitDegraded(root, e.code, e.phase, e.message);
    out.error(`参数不可识别 [${e.code}/${e.phase}]: ${e.message}`);
    out.finish();
    return 2;
  }
  if (all) {
    out.note('[ALL] --all ⇒ 仅主用例（反例 bad-manifest / no-reload 不参与自动跑；规格 §4 C1 DS④）');
  }

  if (!assertTargetsExist(root, out, [...TARGETS])) {
    emitDegraded(root, 'TARGET_MISSING', 'bootstrap', '目标件缺失 ⇒ 无法判定（fail-closed）');
    out.finish();
    return 2;
  }

  let lock: ProbeLock;
  try {
    lock = acquireLock(root);
  } catch (err: unknown) {
    const e = toProbeError(err, 'LOCK_BUSY', 'lock');
    emitDegraded(root, e.code, e.phase, e.message);
    out.error(`并发互斥失败 [${e.code}/${e.phase}]: ${e.message}`);
    out.finish();
    return 2;
  }

  let failure: ProbeError | undefined;
  try {
    const stray = findResidualFixtures(root);
    if (stray.length > 0) {
      throw new ProbeError(
        'FIXTURE_RESIDUE_FOUND',
        'fixture',
        `检测到上次运行残留目录（不自动删，防删错）：${stray.join(', ')} —— 确认清理后重跑`,
      );
    }
    for (const name of cases) {
      if (name === CASE_MAIN) await runMainCase(root, out);
      else if (name === CASE_BAD_MANIFEST) await runBadManifestCase(root, out);
      else if (name === CASE_NO_RELOAD) await runNoReloadCase(root, out);
      else out.error(`场景未实现: ${name}`);
    }
  } catch (err: unknown) {
    failure = toProbeError(err, 'CASE_FAILED', `case:${cases.join(',')}`);
  } finally {
    lock.release();
  }
  if (failure !== undefined) {
    emitDegraded(root, failure.code, failure.phase, failure.message, failure.retryable);
    out.error(
      `场景失败 [${failure.code}/${failure.phase}/retryable=${String(failure.retryable)}]: ${failure.message}`,
    );
  }

  out.finish();
  return out.exitCode();
}

// 仅在直接执行时跑 CLI（被 import 时不产生副作用）。
// `ProbeModule` 标注 = 编译期契约自检：签名漂移会当场报错。
if (process.argv[1] && /probe-content-reload\.ts$/.test(process.argv[1])) {
  const self: ProbeModule = { KNOWN_CASES, main };
  self.main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`probe-content-reload 未捕获异常: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    },
  );
}
