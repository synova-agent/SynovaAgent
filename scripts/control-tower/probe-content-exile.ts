#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-content-exile.ts — C2（#707 · M6-1158）
 * 「拔得掉」：**真移走**一个哨兵内容项 ⇒ **新进程**装配照跑（其余 45 项逐 id 不变、0 错误）
 *   ⇒ 计数 **45（−1）必现** ⇒ 恢复后回到 46。
 *
 * 设计哲学: 拔掉一个内容项不是改一行代码，而是把目录从扫描根**真拿走**再看系统还活不活 ——
 *   本件只认「新进程的装配结果」，不认任何自己造的假对象；拿不出 −1 或恢复不回去，一律 exit 2/1，绝不冒充绿。
 *
 * 判据来源（唯一）: `.handbook/派单件/2026-10-30-规格-1158-M6-三条不可妥协.md` §4 C2（v2.3 @ b68fb8d）
 *   正常   `--case main`     : [BASELINE]46 → [EXILE] → [CHILD]45 → [OTHERS]{cash-runway} → [IN-PROCESS-RELOAD]46 → [RESTORE] → RESULT=PASS
 *   反例   `--case no-exile` : 不真移走 ⇒ [CHILD] sentinels=46 ⇒ 期望红未出现 ⇒ **RESULT=FAIL / exit 1**（判据无牙齿，规格指定）
 *
 * 契约（铁律 47；统一探针契约的唯一实现在 ./probe-ladder.ts，本件**不另造**）:
 *   @input    — `--case <main|no-exile>`｜`--all`（**仅主用例**）｜`--child-count`（**子协议**，父进程内部调用）
 *               缺省/未知 ⇒ exit 2
 *   @output   — 父进程 stdout 逐行 `[TAG] …` ＋ 末行由 `out.finish()` 签发 `RESULT=<verdict>`；
 *               子进程（`--child-count`）stdout **只一行 JSON**：
 *               `{"sentinels":N,"ids":[…],"typeCounts":{…},"errors":K,"degraded":bool}`
 *   @exit     — 0=PASS｜1=FAIL｜2=无法判定/降级（fail-closed：2 绝不等于通过）
 *   @degraded — stderr 一行 `degraded: <原因>` ＋ 追加 JSON 到 `SYNO_GATE_DEGRADED_LOG`
 *               （字段 time/component/code/phase/retryable；D2 约定）＋ exit 2
 *   @authority — 谁能跑：控制塔维护者 / 独立复核者。运行期**真实移走** `extensions/sentinels/cash-runway`
 *               ⇒ 必须持 `.synova-out/m6-1158/.lock`（拿不到 ⇒ LOCK_BUSY ＋ exit 2；**并发不安全**）。
 *   @encoding  — 全文件 UTF-8（D732）；落盘/输出一律显式 `utf8`。
 *   @判别力    — 自检（D4）：反例 `no-exile` 证明「−1」只在**真移走**时出现（不移走 ⇒ 无 −1 ⇒ exit 1）。
 *
 * 结构（File → Role）:
 *   ├ 常量 TARGETS / KNOWN_CASES / BASELINE_SENTINEL_COUNT / CONTENT_TYPE_COUNT / VICTIM_* — 自声明面
 *   ├ setDifference / exileRootFor / dirDigest / fileSha256 / typeCountsFromResults / parseChildPayload — 纯函数
 *   ├ isPidAlive / acquireLock / emitDegraded                                                — 互斥与降级出口
 *   ├ runChildCount / runChildCountProcess                                                   — 子协议（新进程）
 *   ├ runMainCase / runNoExileCase                                                           — 两个 case
 *   └ main                                                                                   — CLI 分派 ＋ 三态退出
 *
 * 子进程口径（规格 §4 C2「子系统照跑」的最小可判形态）:
 *   · 父：`node --import tsx <本文件> --child-count` 起**独立 node 进程**（cwd=仓库根）；
 *     子进程内 **不设** `SENTINELS_FIXTURE_DIR`（走真 `extensions/sentinels`）⇒ boot 装配全真。
 *   · 子：`await initContentTypes()` → `listSentinels()` → 一行 JSON。
 *   · `typeCounts` ＝ **已装配内容类型 → 项数**（当前每类 1 项，共 12 类）；`types` ＝ 键数。
 *     🔴 不用 `sentinel` manifest 的 `type` 字段：46 个 manifest 全写 `"type":"sentinel"`（唯一值，区分度为 0），
 *        用它当 types 口径会把「12 类内容面」谎报成「1 类」。
 *
 * 已知限制（Known Limitations，如实标注）:
 *   ① **进程内「重扫不卸」**（裁 167-U2）：`content-reload` 不调用 `registry.unregister` ⇒ 同一进程里 reload
 *      之后 registry 计数**不随目录消失而下降**（本件把它作为断言输出 `[IN-PROCESS-RELOAD] registry=46`，
 *      **不判红**）。因此「拔了照跑」只在**新进程**成立 —— 这也正是本件为什么必须起子进程。
 *   ② 反例 `no-exile` **不复现**「−1」，故按规格 §4 C2 判 `RESULT=FAIL / exit 1`（= 判据在本路径无牙齿），
 *      它是**负控**，不是能力回归。
 *   ③ 运行期真实移动 `extensions/sentinels/cash-runway` ⇒ **并发不安全**；锁 stale 回收靠同机 pid 存活探测。
 *      若进程被强杀且目录停在隔离区，下一次运行会 `degraded: 隔离区残留` ＋ exit 2 点名（**不自动搬回**，
 *      因为无法区分「本批残留」与「别人正在用」）。人确认后手工移回即可。
 *   ④ 46 / 45 / 12 是 **as_of b8edf9860** 的硬基线；内容面增删后须同步
 *      `BASELINE_SENTINEL_COUNT` / `CONTENT_TYPE_COUNT`，否则报基线漂移红（刻意如此，不静默放宽）。
 *   ⑤ 本机 node v24.16.0；node22 未复跑（#1158 U1）。
 *   ⑥ 本件只判「内容项级」可拔性（内容项 loader 即端口），**不是**题 8 的「包级 customerDeps」口径（禁混用）。
 *   ⑦ 恢复的完整性用 **全目录 sha256（6 文件）** 核对，不依赖 mtime；`git status --short extensions/`
 *      由父进程调只读 `git status --porcelain` 复核（git 不可用 ⇒ 显式 UNVERIFIED，不冒充空）。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSentinels } from '../../src/agent/sentinel-service';
import { initContentTypes } from '../../src/deploy/content-registry';
import { reloadContentTypes } from '../../src/deploy/content-reload';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { clearSentinelCache } from '../../src/sentinel/sentinel-loader';
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

const SENTINELS_DIR_REL = 'extensions/sentinels';
/** 被拔对象（规格 §4 C2：victim = cash-runway） */
const VICTIM_DIR_NAME = 'cash-runway';
const VICTIM_DIR_REL = `${SENTINELS_DIR_REL}/${VICTIM_DIR_NAME}`;
const VICTIM_ID = 'sentinel-cash-runway';
/** 内容面基线（as_of b8edf9860） */
const BASELINE_SENTINEL_COUNT = 46;
const EXILED_SENTINEL_COUNT = BASELINE_SENTINEL_COUNT - 1;
/** 已装配内容类型数（as_of b8edf9860；`initContentTypes()` 的 12 个 reachable 项） */
const CONTENT_TYPE_COUNT = 12;
/** 隔离区（**必须在 `extensions/sentinels/` 之外**：放里面会被 loader 当第 46 项扫到） */
const EXILE_ROOT_REL = '.synova-out/m6-1158/exile';
const EVIDENCE_DIR_REL = '.synova-out/m6-1158';
const DATA_DIR_REL = `${EVIDENCE_DIR_REL}/data`;
const LOCK_REL = `${EVIDENCE_DIR_REL}/.lock`;
const DEGRADED_LOG_REL = `${EVIDENCE_DIR_REL}/degraded-events.log`;
const COMPONENT = 'probe-content-exile';
/** 子协议旗标（父→子；不是 case） */
const CHILD_COUNT_FLAG = '--child-count';
const CASE_MAIN = 'main';
const CASE_NO_EXILE = 'no-exile';

/**
 * 本探针判据所依赖的目标件 —— 供 ladder 的「报 PASS ⇒ TARGETS 非空且全部存在」不变式机械校验。
 * 🔴 必须是**字面量引号数组**（ladder 以源文本正则解析）。
 */
export const TARGETS: readonly string[] = [
  'src/deploy/content-registry.ts',
  'src/deploy/content-reload.ts',
  'src/agent/sentinel-service.ts',
  'src/sentinel/registry.ts',
  'src/sentinel/sentinel-loader.ts',
  'extensions/sentinels/cash-runway',
];

export const KNOWN_CASES: readonly string[] = [CASE_MAIN, CASE_NO_EXILE];

/** 判别力自检用的「被拔 id」——测试可直取，禁第二处字面量 */
export const EXILE_VICTIM_ID = VICTIM_ID;

// ══════════════════════════════════════════════════════════════════════════════
// 二、纯函数（测试直取）
// ══════════════════════════════════════════════════════════════════════════════

/** 集合差（有序去重）—— [OTHERS] 的 baselineIds − childIds 唯一实现 */
export function setDifference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((id) => !rightSet.has(id)).sort();
}

/** 隔离区路径（绝对路径）：`.synova-out/m6-1158/exile/<pid>/` */
export function exileRootFor(root: string, pid: number = process.pid): string {
  return join(root, EXILE_ROOT_REL, String(pid));
}

/** 单文件 sha256（小写 hex） */
export function fileSha256(abs: string): string {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

/**
 * 目录内容摘要：按**相对路径排序**逐个吸收「路径 ＋ 文件字节」。
 *
 * @input  dirAbs 目录绝对路径
 * @output { files, sha256 }；目录不存在 ⇒ 抛 ProbeError(EXILE_DIR_MISSING)
 * @degrade 读失败 ⇒ 抛（调用方按 RESTORE_FAILED / EXILE_* 处理）
 */
export function dirDigest(dirAbs: string): { files: number; sha256: string } {
  if (!existsSync(dirAbs)) {
    throw new ProbeError('EXILE_DIR_MISSING', 'digest', `目录不存在: ${dirAbs}`);
  }
  const entries = readdirSync(dirAbs, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .map((abs) => ({ abs, rel: relative(dirAbs, abs).split('\\').join('/') }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = createHash('sha256');
  for (const e of entries) {
    h.update(e.rel).update('\0');
    h.update(readFileSync(e.abs));
    h.update('\0');
  }
  return { files: entries.length, sha256: h.digest('hex') };
}

/**
 * 内容装配结果 → 「内容类型 → 项数」。
 *
 * @input  initContentTypes().results
 * @output `Record<string, number>`（键数 = 已装配内容类型数）
 * @degrade 纯函数，无异常路径
 */
export function typeCountsFromResults(results: readonly { type: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.type] = (counts[r.type] ?? 0) + 1;
  return counts;
}

export interface ChildPayload {
  readonly sentinels: number;
  readonly ids: string[];
  readonly typeCounts: Record<string, number>;
  readonly errors: number;
  readonly degraded: boolean;
}

/**
 * 解析子进程 stdout —— **只认最后一行 JSON**，并对形状逐字段做类型守卫（禁宽泛断言 / any）。
 *
 * @input  stdout 原文
 * @output ChildPayload
 * @error  CHILD_PROTOCOL_INVALID（无 JSON 行 / 解析失败）/ CHILD_PROTOCOL_SHAPE（字段类型不符）
 */
export function parseChildPayload(stdout: string): ChildPayload {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const candidate = [...lines].reverse().find((l) => l.startsWith('{'));
  if (candidate === undefined) {
    throw new ProbeError('CHILD_PROTOCOL_INVALID', 'child', `子进程 stdout 无 JSON 行（共 ${lines.length} 行）`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch (err: unknown) {
    throw new ProbeError(
      'CHILD_PROTOCOL_INVALID',
      'child',
      `子进程 JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (raw === null || typeof raw !== 'object') {
    throw new ProbeError('CHILD_PROTOCOL_SHAPE', 'child', '子进程 JSON 不是对象');
  }
  const rec = raw as Record<string, unknown>;
  const { sentinels, ids, typeCounts, errors, degraded } = rec;
  if (typeof sentinels !== 'number' || !Number.isFinite(sentinels)) {
    throw new ProbeError('CHILD_PROTOCOL_SHAPE', 'child', `sentinels 非有限数: ${String(sentinels)}`);
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new ProbeError('CHILD_PROTOCOL_SHAPE', 'child', 'ids 不是字符串数组');
  }
  if (typeCounts === null || typeof typeCounts !== 'object' || Array.isArray(typeCounts)) {
    throw new ProbeError('CHILD_PROTOCOL_SHAPE', 'child', 'typeCounts 不是对象');
  }
  const countRec = typeCounts as Record<string, unknown>;
  for (const [k, v] of Object.entries(countRec)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new ProbeError('CHILD_PROTOCOL_SHAPE', 'child', `typeCounts.${k} 非有限数`);
    }
  }
  if (typeof errors !== 'number' || !Number.isFinite(errors)) {
    throw new ProbeError('CHILD_PROTOCOL_SHAPE', 'child', `errors 非有限数: ${String(errors)}`);
  }
  if (typeof degraded !== 'boolean') {
    throw new ProbeError('CHILD_PROTOCOL_SHAPE', 'child', `degraded 非布尔: ${String(degraded)}`);
  }
  return {
    sentinels,
    ids: ids as string[],
    typeCounts: countRec as Record<string, number>,
    errors,
    degraded,
  };
}

/** 子进程 stdout 的非空行数（判「只一行 JSON」用） */
export function countNonEmptyLines(stdout: string): number {
  return stdout.split('\n').filter((l) => l.trim() !== '').length;
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、互斥与降级出口
// ══════════════════════════════════════════════════════════════════════════════

export interface ProbeLock {
  readonly path: string;
  release(): void;
}

/** 同机 pid 存活探测（锁 stale 回收用；EPERM＝存在但无权 signal ⇒ 视为存活） */
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

/** 取锁（`wx` 原子创建；活持有 ⇒ LOCK_BUSY；死进程残留 ⇒ 回收一次） */
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
      holder = '';
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
      throw new ProbeError('LOCK_BUSY', 'lock', `锁不可回收: ${msgOf(err)}; unlink: ${msgOf(e2)}`);
    }
    try {
      open();
    } catch (e3: unknown) {
      throw new ProbeError('LOCK_BUSY', 'lock', `锁回收后仍取不到: ${msgOf(e3)}`);
    }
  }
  return {
    path,
    release(): void {
      try {
        unlinkSync(path);
      } catch (err: unknown) {
        if ((err as { code?: string }).code !== 'ENOENT') {
          console.error(`[warn] 锁释放失败（${LOCK_REL}）: ${msgOf(err)}`);
        }
      }
    },
  };
}

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toProbeError(err: unknown, code: string, phase: string, retryable = false): ProbeError {
  if (err instanceof ProbeError) return err;
  return new ProbeError(code, phase, msgOf(err), retryable);
}

/**
 * 降级出口：stderr 一行 `degraded: <原因>` ＋ 追加降级事件 JSON（D2 字段口径）。
 * 落点：显式 `SYNO_GATE_DEGRADED_LOG` 优先；缺省 `.synova-out/m6-1158/degraded-events.log`（gitignored）。
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
    console.error(`[warn] 降级日志写入失败（${logPath}）: ${msgOf(err)}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、子协议（独立 node 进程）
// ══════════════════════════════════════════════════════════════════════════════

/** 子进程入口（`--child-count`）：装配真内容面 → 一行 JSON。**不取锁**（父进程已持锁；子只读）。 */
async function runChildCount(): Promise<0 | 2> {
  try {
    const init = await initContentTypes();
    const listed = await listSentinels();
    const payload: ChildPayload = {
      sentinels: listed.total,
      ids: listed.sentinels.map((s) => s.id),
      typeCounts: typeCountsFromResults(init.results),
      errors: init.errors.length + (listed.ok ? 0 : 1),
      degraded: init.degraded || !listed.ok,
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return 0;
  } catch (err: unknown) {
    process.stderr.write(`degraded: 子进程装配失败: ${msgOf(err)}\n`);
    return 2;
  }
}

interface ChildRun {
  readonly payload: ChildPayload;
  readonly stdoutLines: number;
  readonly stderrTail: string;
}

/**
 * 父进程侧：起**独立 node 进程** `node --import tsx <self> --child-count`。
 * 🔴 子进程 **不设** `SENTINELS_FIXTURE_DIR`（走真 `extensions/sentinels`）。
 */
function runChildCountProcess(root: string): ChildRun {
  const self = fileURLToPath(import.meta.url);
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['SENTINELS_FIXTURE_DIR'];
  const res = spawnSync(process.execPath, ['--import', 'tsx', self, CHILD_COUNT_FLAG], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error !== undefined && res.error !== null) {
    throw toProbeError(res.error, 'CHILD_SPAWN_FAILED', 'child', true);
  }
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  if (res.status !== 0) {
    throw new ProbeError(
      'CHILD_EXIT_NONZERO',
      'child',
      `子进程退出码 ${String(res.status)}（stderr 末 300 字: ${stderr.slice(-300)}）`,
    );
  }
  return { payload: parseChildPayload(stdout), stdoutLines: countNonEmptyLines(stdout), stderrTail: stderr.slice(-300) };
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、引导 / 复核小件
// ══════════════════════════════════════════════════════════════════════════════

/** `initContentTypes()` → `listSentinels()` 的计数出口（registry 路由，禁 `loadSentinels()` 目录数） */
async function bootstrapSentinels(): Promise<{ total: number; ids: string[] }> {
  try {
    await initContentTypes();
  } catch (err: unknown) {
    throw toProbeError(err, 'CONTENT_INIT_FAILED', 'bootstrap', true);
  }
  const listed = await listSentinels();
  if (!listed.ok) {
    throw new ProbeError('LIST_SENTINELS_FAILED', 'count', 'listSentinels 返回 ok=false（registry 访问失败）', true);
  }
  return { total: listed.total, ids: listed.sentinels.map((s) => s.id) };
}

/** 只读 `git status --porcelain -- extensions/` 的行数；git 不可用 ⇒ undefined（显式 UNVERIFIED，不冒充空） */
function gitExtensionsChanges(root: string): number | undefined {
  const res = spawnSync('git', ['status', '--porcelain', '--', 'extensions/'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.error !== undefined && res.error !== null) return undefined;
  if (res.status !== 0) return undefined;
  return (res.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '').length;
}

/** 恢复后一致性断言（sha ＋ 计数 ＋ git）；失败抛 RESTORE_FAILED（⇒ degraded ＋ exit 2） */
async function verifyRestored(root: string, before: { files: number; sha256: string }, out: ProbeOutput): Promise<void> {
  const after = dirDigest(join(root, VICTIM_DIR_REL));
  const listed = await listSentinels();
  const problems: string[] = [];
  if (after.files !== before.files) problems.push(`文件数 ${after.files} ≠ 移走前 ${before.files}`);
  if (after.sha256 !== before.sha256) problems.push(`目录 sha256 ${after.sha256.slice(0, 12)}… ≠ ${before.sha256.slice(0, 12)}…`);
  if (listed.total !== BASELINE_SENTINEL_COUNT) problems.push(`sentinels=${listed.total} ≠ ${BASELINE_SENTINEL_COUNT}`);
  if (!listed.sentinels.some((s) => s.id === VICTIM_ID)) problems.push(`registry 缺 ${VICTIM_ID}`);

  const changes = gitExtensionsChanges(root);
  if (changes === undefined) {
    out.unverified('git status 不可用 ⇒ extensions/ 是否干净 UNVERIFIED（外部验收命令为准）');
  } else if (changes !== 0) {
    problems.push(`git status extensions/ 变更 ${changes} 行（应 0）`);
  }
  if (problems.length > 0) {
    throw new ProbeError('RESTORE_FAILED', 'restore', problems.join('; '));
  }
  const gitText = changes === undefined ? 'git status UNVERIFIED' : `git status extensions/ 变更=${changes}`;
  out.note(
    `[RESTORE] sha 核对 ${after.files}/${before.files} 文件一致（${after.sha256.slice(0, 12)}…）` +
      ` ＋ sentinels=${listed.total} ＋ ${gitText}`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、场景 main（真移走 ⇒ 新进程 45 ⇒ 差集=1 ⇒ 恢复 46）
// ══════════════════════════════════════════════════════════════════════════════

async function runMainCase(root: string, out: ProbeOutput): Promise<void> {
  out.case(CASE_MAIN);
  const victimAbs = join(root, VICTIM_DIR_REL);
  if (!existsSync(victimAbs)) {
    throw new ProbeError('EXILE_VICTIM_MISSING', 'baseline', `被拔对象不存在: ${VICTIM_DIR_REL}（目录不存在 ⇒ 无法判定）`);
  }
  const baseline = await bootstrapSentinels();
  out.note(`[BASELINE] sentinels=${baseline.total} ids=${baseline.ids.length}`);
  if (baseline.total !== BASELINE_SENTINEL_COUNT) {
    out.fail(
      `基线漂移：[BASELINE] sentinels=${baseline.total}，判据基线=${BASELINE_SENTINEL_COUNT}（as_of b8edf9860）` +
        ' —— 内容面增删后须同步 BASELINE_SENTINEL_COUNT',
      'L2',
    );
    return;
  }
  if (!baseline.ids.includes(VICTIM_ID)) {
    out.fail(`[BASELINE] ids 里没有 ${VICTIM_ID} ⇒ victim 未装配，无法拔`, 'L2');
    return;
  }
  out.pass(`基线 ${BASELINE_SENTINEL_COUNT} 项且含 ${VICTIM_ID}`, 'L2');

  // ① 移走前摘要（文件数 ＋ 全目录 sha ＋ manifest sha）
  const before = dirDigest(victimAbs);
  const manifestBefore = fileSha256(join(victimAbs, 'manifest.json'));
  const exileRoot = exileRootFor(root);
  const exiledAbs = join(exileRoot, VICTIM_DIR_NAME);

  let exiled = false;
  let childRun: ChildRun | undefined;
  let inProcessTotal: number | undefined;
  let bodyError: ProbeError | undefined;
  let restoreError: ProbeError | undefined;

  try {
    // ② 真移走（rename，非模拟）；隔离区在 extensions/sentinels 之外
    try {
      mkdirSync(exileRoot, { recursive: true });
    } catch (err: unknown) {
      throw toProbeError(err, 'EXILE_MKDIR_FAILED', 'exile', true);
    }
    if (existsSync(exiledAbs)) {
      throw new ProbeError('EXILE_RESIDUE_FOUND', 'exile', `隔离区已有同名残留（不自动删，防删错）: ${exiledAbs}`);
    }
    try {
      renameSync(victimAbs, exiledAbs);
    } catch (err: unknown) {
      throw toProbeError(err, 'EXILE_MOVE_FAILED', 'exile', true);
    }
    exiled = true;
    if (existsSync(victimAbs)) {
      throw new ProbeError('EXILE_MOVE_FAILED', 'exile', `移走后仓库路径仍存在: ${VICTIM_DIR_REL}`);
    }
    const manifestAfterMove = fileSha256(join(exiledAbs, 'manifest.json'));
    if (manifestAfterMove !== manifestBefore) {
      throw new ProbeError(
        'EXILE_HASH_MISMATCH',
        'exile',
        `移动后 manifest sha256 变了: ${manifestBefore.slice(0, 12)}… → ${manifestAfterMove.slice(0, 12)}…`,
      );
    }
    out.note(
      `[EXILE] ${VICTIM_DIR_NAME} → ${EXILE_ROOT_REL}/${process.pid}/` +
        `（manifest sha256=${manifestAfterMove.slice(0, 12)}… 移走前后一致；${before.files} 文件）`,
    );
    out.pass(`真移走完成（非模拟）：仓库路径已不存在，隔离区摘要一致`, 'L2');

    // ③ 新进程照跑
    childRun = runChildCountProcess(root);
    const p = childRun.payload;
    const types = Object.keys(p.typeCounts).length;
    out.note(`[CHILD] sentinels=${p.sentinels} types=${types} errors=${p.errors} degraded=${String(p.degraded)}`);
    if (childRun.stdoutLines !== 1) {
      out.fail(`子协议违反：stdout 应只 1 行 JSON，实测 ${childRun.stdoutLines} 行`, 'L2');
    }
    if (p.sentinels === EXILED_SENTINEL_COUNT) {
      out.pass(`[CHILD] 新进程计数 −1：${BASELINE_SENTINEL_COUNT} → ${p.sentinels}`, 'L2');
    } else {
      out.fail(`[CHILD] 新进程计数 ${p.sentinels} ≠ ${EXILED_SENTINEL_COUNT} ⇒ 「−1 必现」不成立`, 'L2');
    }
    if (p.errors === 0 && !p.degraded) {
      out.pass('新进程装配 0 错误、未降级（系统照跑）', 'L2');
    } else {
      out.fail(`新进程装配 errors=${p.errors} degraded=${String(p.degraded)} ⇒ 拔一个内容项把系统带崩`, 'L2');
    }
    if (types === CONTENT_TYPE_COUNT) {
      out.pass(`内容面 ${CONTENT_TYPE_COUNT} 类全部装配（types=${types}）`, 'L2');
    } else {
      out.fail(`内容类型数 types=${types} ≠ 基线 ${CONTENT_TYPE_COUNT}（内容面装配不全）`, 'L2');
    }

    // ④ 逐 id 差集
    const disappeared = setDifference(baseline.ids, p.ids);
    const appeared = setDifference(p.ids, baseline.ids);
    out.note(
      `[OTHERS] baselineIds − childIds = {${disappeared.join(', ')}}（appeared={${appeared.join(', ')}}）`,
    );
    if (disappeared.length === 1 && disappeared[0] === VICTIM_ID) {
      out.pass(`关掉/拔掉后消失的只有 ${VICTIM_ID}（其余 ${p.sentinels} 项逐 id 不变）`, 'L2');
    } else {
      out.fail(`差集异常：disappeared={${disappeared.join(', ')}}（应仅 ${VICTIM_ID}）`, 'L2');
    }
    if (appeared.length === 0) {
      out.pass('无新增 id（新进程没有凭空多出哨兵）', 'L2');
    } else {
      out.fail(`新进程多出 id={${appeared.join(', ')}} ⇒ 装配结果不稳定`, 'L2');
    }

    // ⑤ 进程内 reload —— 已知限制：重扫不卸（裁 167-U2），**不判红**
    try {
      await reloadContentTypes({ dataDir: join(root, DATA_DIR_REL) });
    } catch (err: unknown) {
      throw toProbeError(err, 'IN_PROCESS_RELOAD_FAILED', 'reload', true);
    }
    const afterReload = await listSentinels();
    inProcessTotal = afterReload.total;
    out.note(
      `[IN-PROCESS-RELOAD] registry=${inProcessTotal}（重扫不卸；裁 167-U2，已知限制，不判红）`,
    );
    if (inProcessTotal === BASELINE_SENTINEL_COUNT) {
      out.pass('进程内 reload 后 registry 仍 46 —— 已知限制「重扫不卸」实测成立（不判红）', 'L2');
    } else {
      out.fail(
        `进程内 reload 后 registry=${inProcessTotal} ≠ ${BASELINE_SENTINEL_COUNT}（与已知限制不符：预期「目录消失但注册不卸」）`,
        'L2',
      );
    }
  } catch (err: unknown) {
    bodyError = toProbeError(err, 'CASE_FAILED', `case:${CASE_MAIN}`, true);
  }

  // ⑥ 恢复（finally 语义）：**无论上面发生什么都必须搬回 ＋ 哈希核对**（不清缓存则不恢复 registry 口径）
  try {
    if (exiled) {
      if (existsSync(victimAbs)) {
        throw new ProbeError('RESTORE_FAILED', 'restore', `恢复前仓库路径已存在（拒绝覆盖）: ${VICTIM_DIR_REL}`);
      }
      try {
        renameSync(exiledAbs, victimAbs);
      } catch (err: unknown) {
        throw toProbeError(err, 'RESTORE_FAILED', 'restore', true);
      }
      exiled = false;
    }
    clearSentinelCache();
    await reloadContentTypes({ dataDir: join(root, DATA_DIR_REL) });
    await verifyRestored(root, before, out);
    // 恢复已核对通过 ⇒ 隔离区应已空；空目录顺手清掉（不空 = 异常，交由 verify 之外的下一轮 preflight 点名）
    if (existsSync(exileRoot) && readdirSync(exileRoot).length === 0) {
      try {
        rmSync(exileRoot, { recursive: true, force: true });
      } catch (err: unknown) {
        console.error(`[warn] 空隔离区清理失败（${EXILE_ROOT_REL}/${process.pid}）: ${msgOf(err)}`);
      }
    }
  } catch (err: unknown) {
    restoreError = toProbeError(err, 'RESTORE_FAILED', 'restore');
  }
  if (restoreError !== undefined) throw restoreError;
  if (bodyError !== undefined) throw bodyError;
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、场景 no-exile（反例：不真移走 ⇒ 无 −1 ⇒ 规格指定 exit 1）
// ══════════════════════════════════════════════════════════════════════════════

async function runNoExileCase(root: string, out: ProbeOutput): Promise<void> {
  out.case(CASE_NO_EXILE);
  if (!existsSync(join(root, VICTIM_DIR_REL))) {
    throw new ProbeError('EXILE_VICTIM_MISSING', 'baseline', `被拔对象不存在: ${VICTIM_DIR_REL}`);
  }
  const baseline = await bootstrapSentinels();
  out.note(`[BASELINE] sentinels=${baseline.total} ids=${baseline.ids.length}`);

  let bodyError: ProbeError | undefined;
  try {
    const child = runChildCountProcess(root);
    const types = Object.keys(child.payload.typeCounts).length;
    out.note(
      `[CHILD] sentinels=${child.payload.sentinels} types=${types} ` +
        `errors=${child.payload.errors} degraded=${String(child.payload.degraded)}`,
    );
    out.note(
      `[EXPECTED-RED] sentinels=${child.payload.sentinels}（未真移走 ⇒ −1 未出现）` +
        ' —— 规格 §4 C2 指定本反例 RESULT=FAIL / exit 1（判据无牙齿）',
    );
    out.fail(
      `[EXPECTED-RED] 未移走时 child=${child.payload.sentinels}（无 −1）⇒ 本 case 不能证明「拔得掉」` +
        ' ⇒ 规格 §4 C2 判 FAIL/exit 1（负控：非能力回归）',
      'L2',
    );
  } catch (err: unknown) {
    bodyError = toProbeError(err, 'CASE_FAILED', `case:${CASE_NO_EXILE}`, true);
  }
  if (bodyError !== undefined) throw bodyError;

  const changes = gitExtensionsChanges(root);
  if (changes === undefined) {
    out.unverified('git status 不可用 ⇒ extensions/ 是否干净 UNVERIFIED');
  } else if (changes !== 0) {
    throw new ProbeError('RESTORE_FAILED', 'restore', `git status extensions/ 变更 ${changes} 行（应 0）`);
  } else {
    out.note(`[RESTORE] 未移走 ⇒ 无需恢复 ＋ git status extensions/ 变更=${changes}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 八、CLI
// ══════════════════════════════════════════════════════════════════════════════

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    const e = toProbeError(err, 'REPO_ROOT_NOT_FOUND', 'bootstrap');
    emitDegraded(process.cwd(), e.code, e.phase, e.message);
    console.error(`probe-content-exile 无法定位仓库根: ${e.message}`);
    return 2;
  }
  process.chdir(root);

  // 子协议入口：**先于**锁/参数解析（子进程只读，父进程已持锁，子进程再取锁会误判 LOCK_BUSY）
  if (argv.includes(CHILD_COUNT_FLAG)) {
    return runChildCount();
  }

  const out = new ProbeOutput('probe-content-exile（C2 / #707 · 拔得掉）');
  out.note(
    `PROBE=probe-content-exile card=C2(#707) repoRoot=${root} node=${process.version} ` +
      `spec=.handbook/派单件/2026-10-30-规格-1158-M6-三条不可妥协.md §4 C2`,
  );

  let cases: string[];
  let all = false;
  try {
    const parsed = parseProbeArgs(KNOWN_CASES, argv);
    all = parsed.all;
    cases = parsed.all ? [CASE_MAIN] : parsed.cases;
  } catch (err: unknown) {
    const e = toProbeError(err, 'ARGS_INVALID', 'args');
    emitDegraded(root, e.code, e.phase, e.message);
    out.error(`参数不可识别 [${e.code}/${e.phase}]: ${e.message}`);
    out.finish();
    return 2;
  }
  if (all) out.note('[ALL] --all ⇒ 仅主用例（反例 no-exile 不参与自动跑）');

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
    const strayVictim = join(exileRootFor(root), VICTIM_DIR_NAME);
    if (existsSync(strayVictim)) {
      throw new ProbeError(
        'EXILE_RESIDUE_FOUND',
        'exile',
        `隔离区检测到上次运行残留: ${EXILE_ROOT_REL}/${process.pid}/${VICTIM_DIR_NAME}` +
          '（不自动搬回，防搬错）—— 确认后手工移回再重跑',
      );
    }
    for (const name of cases) {
      if (name === CASE_MAIN) await runMainCase(root, out);
      else if (name === CASE_NO_EXILE) await runNoExileCase(root, out);
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
if (process.argv[1] && /probe-content-exile\.ts$/.test(process.argv[1])) {
  const self: ProbeModule = { KNOWN_CASES, main };
  self.main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`probe-content-exile 未捕获异常: ${msgOf(err)}`);
      process.exit(2);
    },
  );
}
