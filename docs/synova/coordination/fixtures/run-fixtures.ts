#!/usr/bin/env node
/**
 * run-fixtures.ts — V6「改坏即红」夹具 runner（判据 D）
 *
 * @why  一条判据只有被证明"实现改坏 ⇒ 判据转红"才算真判据。否则它是装饰：
 *       永远绿、零分辨力（判例 V-08：坏不掉 / 坏了也不红的夹具 = 无效夹具）。
 *       本 runner 把这件事变成可复跑的命令。
 *
 * @contract（铁律 47）
 *   @input  — `manifest.json`（同目录，逐条夹具登记）+ 一个**可写的工作树**。
 *             必须能 `bash -c <expectRedCommand>`；命令由夹具自带。
 *   @output — 三态退出码：
 *              0 = 全部夹具通过（每条：破坏态 exit≠0 **且** 复原态 exit=0）
 *              1 = 有夹具没红（无效夹具 —— 破坏态仍 exit=0）
 *              2 = **检查自身失败**（manifest 不可解析 / 文件缺失 / 定位串非唯一 /
 *                  命令超时 / 复原后哈希不一致 —— 即"拿不到结论"，判例 M-02 禁吞）
 *             副作用：写 `docs/synova/product-lines/evidence/V6/<itemId>.out`（命令 + 原始 stdout/stderr 两段）。
 *             ⚠️ 落点选 `product-lines/evidence/` 而非 `coordination/evidence/` —— 后者被
 *                `.gitignore:81 evidence/` 忽略（`git check-ignore -v <路径>` 可复核）⇒ 证据入不了库。
 *   @degraded — 不适用。本工具**没有**降级路径：拿不到结论一律 exit 2，绝不静默通过。
 *
 * ⚠️ 安全不变式（缺一不可）
 *   · 破坏**只在工作树内**发生，且逐文件记录内容哈希；结束时逐一比对，
 *     不一致 ⇒ exit 2。绝不修改 `docs/synova/coordination/施工项登记.ts`（另一路唯一写者）。
 *   · 每个夹具的破坏/复原包在 `try/finally` 里 —— 命令崩了也必须复原。
 *   · 复原**用内存里保存的原文**回写（不依赖 git 状态），再断言 `git diff --exit-code` 为空。
 *
 * 用法:
 *   node --experimental-strip-types docs/synova/coordination/fixtures/run-fixtures.ts
 *   node --experimental-strip-types docs/synova/coordination/fixtures/run-fixtures.ts --only 0-5
 *   node --experimental-strip-types docs/synova/coordination/fixtures/run-fixtures.ts --list
 *   node --experimental-strip-types docs/synova/coordination/fixtures/run-fixtures.ts \
 *        --manifest docs/synova/coordination/fixtures/selftest/noop-break.json   # ⇒ 必须 exit 1
 *   node --experimental-strip-types docs/synova/coordination/fixtures/run-fixtures.ts \
 *        --manifest docs/synova/coordination/fixtures/selftest/unique-miss.json  # ⇒ 必须 exit 2
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ════════════════════════════════════════════════════════════════
// 类型
// ════════════════════════════════════════════════════════════════

/** 破坏方式：把 `file` 中**唯一**出现的 `find` 字面量替换为 `replace`。 */
interface FixtureBreak {
  /** 只支持一种：字面量精确替换（可复核、无正则歧义）。 */
  kind: 'literal-replace';
  /** 相对仓库根的路径。 */
  file: string;
  /** 出处行号区间（供人核；不参与执行）。 */
  lines?: string;
  /** 必须**恰好出现 1 次**，否则 runner exit 2（拒绝猜测）。 */
  find: string;
  replace: string;
  /** 这条破坏代表哪个真实回归 —— 不是"随便改坏"。 */
  rationale: string;
}

interface Fixture {
  itemId: string;
  /** 判据出处：`施工项登记.ts#<itemId>/acceptance[<i>]`。 */
  criterionRef: string;
  breakHow: FixtureBreak;
  /** 夹具在此命令下必须**红**（exit≠0）。 */
  expectRedCommand: string;
  /** 复原手段（人读；runner 实际用内存原文回写）。 */
  restoreHow: string;
  /** 证据落点（相对仓库根）。 */
  expectRedEvidence: string;
}

interface NotFixtureable {
  itemId: string;
  reason: string;
}

interface Manifest {
  version: string;
  description: string;
  fixtures: Fixture[];
  notFixtureable: NotFixtureable[];
}

interface RunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
  elapsedMs: number;
}

/** 夹具判定结果。`harnessFailure` 优先于 `valid`。 */
interface FixtureOutcome {
  itemId: string;
  valid: boolean;
  brokenExit: number | null;
  restoredExit: number | null;
  /** 判据自身在跑动中改动的**已跟踪文件**（非密闭性观测）—— 由 runner 复原并如实登记。 */
  sideEffects: string[];
  harnessFailure?: string;
}

// ════════════════════════════════════════════════════════════════
// 常量
// ════════════════════════════════════════════════════════════════

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const DEFAULT_MANIFEST_PATH = join(HERE, 'manifest.json');
/** 单条命令上限。超时 = 拿不到结论 = exit 2（不认定为"红"）。 */
const COMMAND_TIMEOUT_MS = 900_000;

const EXIT_ALL_PASS = 0;
const EXIT_NOT_RED = 1;
const EXIT_HARNESS_FAILURE = 2;

// ════════════════════════════════════════════════════════════════
// 工具
// ════════════════════════════════════════════════════════════════

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function runShell(command: string): RunResult {  const started = Date.now();
  const res = spawnSync('bash', ['-c', command], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, SYNO_FIXTURE_RUN: '1' },
  });
  const elapsedMs = Date.now() - started;
  const timedOut = res.error instanceof Error && res.error.message.includes('ETIMEDOUT');
  return {
    status: typeof res.status === 'number' ? res.status : null,
    signal: res.signal ?? null,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    timedOut,
    spawnError: res.error && !timedOut ? res.error.message : undefined,
    elapsedMs,
  };
}

/** 记录失败并返回 harness 失败原因（exit 2）。 */
function harnessFail(reason: string): never {
  log(`\n🔴 HARNESS-FAILURE (exit 2): ${reason}`);
  log('   ⇒ 未取得结论。**不**把这种情况当成"判据正确"或"判据错误"。');
  process.exit(EXIT_HARNESS_FAILURE);
}

/**
 * 已跟踪文件的改动快照（忽略 untracked）。
 * 用途有二：① 开工前拒绝在脏树上跑（否则"复原态"没有意义）；
 *          ② 捕捉**判据自身的非密闭性**（例：3-12 的判据件写 extensions/industries/*.json）。
 */
function trackedDirty(): string[] {
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  if (r.status !== 0) harnessFail(`git status 失败: ${r.stderr ?? ''}`);
  return (r.stdout ?? '').split('\n').map((s) => s.trimEnd()).filter(Boolean);
}

// ════════════════════════════════════════════════════════════════
// manifest 装载 + 前置校验（任一不满足 ⇒ exit 2）
// ════════════════════════════════════════════════════════════════

function loadManifest(manifestPath: string): Manifest {
  if (!existsSync(manifestPath)) harnessFail(`manifest 不存在: ${manifestPath}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    harnessFail(`manifest 不可解析为 JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const m = parsed as Manifest;
  if (!m || !Array.isArray(m.fixtures)) harnessFail('manifest.fixtures 不是数组');
  if (!Array.isArray(m.notFixtureable)) harnessFail('manifest.notFixtureable 不是数组');
  if (m.fixtures.length === 0) harnessFail('manifest.fixtures 为空 —— 零夹具不构成通过');
  return m;
}

/** 逐条静态校验。任何一条不成立 ⇒ exit 2（拒绝带病开工）。 */
function preflight(fixtures: Fixture[]): void {
  // 全局：拒绝在脏树上跑 —— 否则"复原态 exit=0"无法区分是判据还是残留改动。
  const dirtyTree = trackedDirty();
  if (dirtyTree.length > 0) {
    harnessFail(`工作树有未提交的已跟踪改动，拒绝在其上做夹具:\n${dirtyTree.join('\n')}`);
  }

  const seenItems = new Set<string>();
  for (const f of fixtures) {
    const where = `[${f.itemId}]`;
    if (!f.itemId) harnessFail(`${where} itemId 缺失`);
    if (seenItems.has(f.itemId)) harnessFail(`${where} itemId 重复`);
    seenItems.add(f.itemId);

    if (!f.criterionRef) harnessFail(`${where} criterionRef 缺失`);
    if (!f.expectRedCommand) harnessFail(`${where} expectRedCommand 缺失`);
    if (!f.restoreHow) harnessFail(`${where} restoreHow 缺失`);
    if (!f.expectRedEvidence) harnessFail(`${where} expectRedEvidence 缺失`);
    if (!f.breakHow || f.breakHow.kind !== 'literal-replace') {
      harnessFail(`${where} breakHow.kind 不是 literal-replace`);
    }
    if (!f.breakHow.rationale) harnessFail(`${where} breakHow.rationale 缺失 —— 破坏必须代表真实回归`);

    const abs = join(REPO_ROOT, f.breakHow.file);
    if (!existsSync(abs)) harnessFail(`${where} breakHow.file 不存在: ${f.breakHow.file}`);

    // 被破坏的文件必须在 git 里且当前无本地改动 —— 否则"复原后 exit=0"没有意义。
    const dirty = spawnSync('git', ['diff', '--quiet', '--', f.breakHow.file], { cwd: REPO_ROOT });
    if (dirty.status !== 0) {
      harnessFail(`${where} 目标文件有未提交改动，拒绝在其上做夹具: ${f.breakHow.file}`);
    }
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', f.breakHow.file], {
      cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (tracked.status !== 0) {
      harnessFail(`${where} 目标文件未被 git 跟踪（无法保证复原）: ${f.breakHow.file}`);
    }

    const content = readFileSync(abs, 'utf8');
    const occurrences = content.split(f.breakHow.find).length - 1;
    if (occurrences !== 1) {
      harnessFail(
        `${where} breakHow.find 在 ${f.breakHow.file} 中出现 ${occurrences} 次（必须恰好 1 次）—— 拒绝猜测定位`,
      );
    }
    if (f.breakHow.find === f.breakHow.replace) {
      harnessFail(`${where} find 与 replace 相同 ⇒ 破坏无效果`);
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 证据
// ════════════════════════════════════════════════════════════════

function section(title: string, command: string, r: RunResult): string {
  const lines = [
    '',
    '════════════════════════════════════════════════════════════',
    `[${title}]`,
    `$ ${command}`,
    `--- exit: ${r.status === null ? `null (signal=${r.signal ?? 'none'})` : r.status}` +
      ` | elapsed ${(r.elapsedMs / 1000).toFixed(1)}s` +
      (r.timedOut ? ' | TIMED-OUT' : '') +
      (r.spawnError ? ` | spawn-error: ${r.spawnError}` : '') + ' ---',
    '--- stdout ---',
    r.stdout.trimEnd(),
    '--- stderr ---',
    r.stderr.trimEnd(),
  ];
  return `${lines.join('\n')}\n`;
}

function writeEvidence(
  f: Fixture,
  broken: RunResult,
  restored: RunResult | null,
  outcome: FixtureOutcome,
): void {
  const outPath = isAbsolute(f.expectRedEvidence)
    ? f.expectRedEvidence
    : join(REPO_ROOT, f.expectRedEvidence);
  mkdirSync(dirname(outPath), { recursive: true });

  const verdict = outcome.harnessFailure
    ? `HARNESS-FAILURE — ${outcome.harnessFailure}`
    : outcome.valid
      ? 'VALID (破坏态红 + 复原态绿)'
      : 'INVALID (破坏态**没有**转红 —— 无效夹具，判例 V-08)';

  const head = [
    `# V6「改坏即红」夹具证据 — item ${f.itemId}`,
    `# criterionRef   : ${f.criterionRef}`,
    `# breakHow.file  : ${f.breakHow.file}${f.breakHow.lines ? ` (lines ${f.breakHow.lines})` : ''}`,
    `# breakHow       : literal-replace —— ${f.breakHow.rationale}`,
    `# restoreHow     : ${f.restoreHow}`,
    `# generatedAt    : ${new Date().toISOString()}`,
    `# runner         : docs/synova/coordination/fixtures/run-fixtures.ts`,
    `# 原始输出（命令 + stdout/stderr 原样，无手写数字）`,
    ...(outcome.sideEffects.length > 0
      ? [
          `# ⚠️ 判据非密闭（side effects）: 跑动中改动了以下**已跟踪文件**，已由 runner 复原：`,
          ...outcome.sideEffects.map((p) => `#     ${p}`),
        ]
      : []),
  ].join('\n');

  let body = `${head}\n`;
  body += section(`SECTION 1] 破坏态 (BROKEN) — 期望 exit ≠ 0`, f.expectRedCommand, broken);
  if (restored) {
    body += section(`SECTION 2] 复原态 (RESTORED) — 期望 exit = 0`, f.expectRedCommand, restored);
  } else {
    body += '\n[SECTION 2] 复原态 — **未执行**（破坏态已使本夹具无效，或 harness 失败）\n';
  }
  body += `\n════════════════════════════════════════════════════════════\nVERDICT: ${verdict}\n`;

  writeFileSync(outPath, body, 'utf8');
}

// ════════════════════════════════════════════════════════════════
// 单条夹具
// ════════════════════════════════════════════════════════════════

/**
 * 捕捉并复原**判据自身**造成的已跟踪文件改动（非密闭性观测）。
 * 这是登记事实，不是吞掉：路径进 `outcome.sideEffects` ⇒ 进证据文件 + 汇总行 + manifest。
 * 复原是为守住 runner 的契约：离开时与进入时一致。
 */
function collectSideEffects(dirtyBefore: Set<string>, outcome: FixtureOutcome): void {
  const leaked = trackedDirty().filter((line) => !dirtyBefore.has(line));
  if (leaked.length === 0) return;
  for (const line of leaked) {
    const m = /^\s*M\s+(.+)$/.exec(line);
    const rel = m ? m[1] : null;
    if (rel) {
      // ⚠️ 复原**每次**都要执行（不能挂在"首次登记"的 if 里 —— 否则第二次调用只跳过复原，
      //    判据每跑一轮就留一次脏，收尾不变式才拦得住，但那已经是"事后发现"）。
      const r = spawnSync('git', ['checkout', '--', rel], { cwd: REPO_ROOT, encoding: 'utf8' });
      if (r.status !== 0) harnessFail(`side effect 复原失败: ${rel} — ${r.stderr ?? ''}`);
      if (!outcome.sideEffects.includes(rel)) outcome.sideEffects.push(rel);
    } else if (!outcome.sideEffects.includes(line)) {
      // 非"内容被改"形态（新增/删除/重命名）—— 只登记，不动手（可能含未提交资产）
      outcome.sideEffects.push(line);
    }
  }
  log(`    ⚠️ 判据非密闭：跑动中改动了 ${outcome.sideEffects.length} 个已跟踪路径（已复原）`);
  for (const p of outcome.sideEffects) log(`        · ${p}`);
}

function runOne(f: Fixture, index: number, total: number): FixtureOutcome {
  const abs = join(REPO_ROOT, f.breakHow.file);
  const original = readFileSync(abs, 'utf8');
  const originalHash = sha256(original);
  const outcome: FixtureOutcome = {
    itemId: f.itemId, valid: false, brokenExit: null, restoredExit: null, sideEffects: [],
  };
  const dirtyBefore = new Set(trackedDirty());

  log(`\n─── [${index}/${total}] ${f.itemId} ───────────────────────────────`);
  log(`    criterion : ${f.criterionRef}`);
  log(`    break     : ${f.breakHow.file} — ${f.breakHow.rationale}`);

  let broken: RunResult;
  try {
    // ① 破坏
    const brokenText = original.replace(f.breakHow.find, f.breakHow.replace);
    if (brokenText === original) harnessFail(`[${f.itemId}] 破坏未改变内容`);
    writeFileSync(abs, brokenText, 'utf8');
    log(`    → 已置破坏态，运行判据…`);

    // ② 破坏态必须红
    broken = runShell(f.expectRedCommand);
    outcome.brokenExit = broken.status;
    log(`    broken  exit=${broken.status}  (${(broken.elapsedMs / 1000).toFixed(1)}s)`);
  } finally {
    // ③ 无论上面发生什么，必须复原
    writeFileSync(abs, original, 'utf8');
  }

  collectSideEffects(dirtyBefore, outcome);

  if (sha256(readFileSync(abs, 'utf8')) !== originalHash) {
    outcome.harnessFailure = `复原后哈希不一致: ${f.breakHow.file}`;
    writeEvidence(f, broken, null, outcome);
    harnessFail(`[${f.itemId}] ${outcome.harnessFailure}`);
  }

  if (broken.timedOut) {
    outcome.harnessFailure = `破坏态命令超时（>${COMMAND_TIMEOUT_MS}ms）⇒ 拿不到结论`;
    writeEvidence(f, broken, null, outcome);
    harnessFail(`[${f.itemId}] ${outcome.harnessFailure}`);
  }
  if (broken.spawnError) {
    outcome.harnessFailure = `破坏态命令 spawn 失败: ${broken.spawnError}`;
    writeEvidence(f, broken, null, outcome);
    harnessFail(`[${f.itemId}] ${outcome.harnessFailure}`);
  }

  if (broken.status === 0) {
    // 无效夹具：坏了也不红（判例 V-08）—— 不写"通过"，如实登记
    outcome.valid = false;
    log(`    ❌ 无效夹具：破坏态 exit=0 ⇒ 该判据**没有**分辨力`);
    writeEvidence(f, broken, null, outcome);
    return outcome;
  }

  // ④ 复原态必须绿
  const restored = runShell(f.expectRedCommand);
  outcome.restoredExit = restored.status;
  log(`    restored exit=${restored.status}  (${(restored.elapsedMs / 1000).toFixed(1)}s)`);
  collectSideEffects(dirtyBefore, outcome);

  if (restored.timedOut || restored.spawnError) {
    outcome.harnessFailure = `复原态命令未能取得结论: ${restored.timedOut ? 'timeout' : restored.spawnError}`;
    writeEvidence(f, broken, restored, outcome);
    harnessFail(`[${f.itemId}] ${outcome.harnessFailure}`);
  }

  if (restored.status !== 0) {
    // 判据在未改动的 main 上本来就是红的 ⇒ 无基线，夹具无意义
    outcome.valid = false;
    log(`    ⚠️ 复原态 exit=${restored.status}（≠0）⇒ 判据在基线上本就红，夹具无分辨力`);
    writeEvidence(f, broken, restored, outcome);
    return outcome;
  }

  outcome.valid = true;
  log(`    ✅ VALID：破坏态红 (exit=${broken.status}) + 复原态绿 (exit=0)`);
  writeEvidence(f, broken, restored, outcome);
  return outcome;
}

// ════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════

function main(): void {
  const argv = process.argv.slice(2);

  // `--manifest <path>` —— runner 自身可判性的唯一钩子：指向一份**故意做坏**的 manifest，
  // 用以证明本 runner 的 exit 1 / exit 2 两态真的可达（见 fixtures/selftest/README.md）。
  const manifestIdx = argv.indexOf('--manifest');
  const manifestPath = manifestIdx >= 0
    ? resolve(manifestIdx + 1 < argv.length ? argv[manifestIdx + 1] : harnessFail('--manifest 需要路径参数'))
    : DEFAULT_MANIFEST_PATH;

  const manifest = loadManifest(manifestPath);

  if (argv.includes('--list')) {
    log(`manifest: ${manifestPath}`);
    log(`夹具 ${manifest.fixtures.length} 条 | 无法夹具项 ${manifest.notFixtureable.length} 条`);
    for (const f of manifest.fixtures) log(`  · ${f.itemId}  ${f.criterionRef}`);
    log('\n无法夹具（判例 V-08 显式登记）:');
    for (const n of manifest.notFixtureable) log(`  · ${n.itemId} — ${n.reason}`);
    process.exit(EXIT_ALL_PASS);
  }

  const onlyIdx = argv.indexOf('--only');
  let fixtures = manifest.fixtures;
  if (onlyIdx >= 0) {
    const wanted = argv[onlyIdx + 1];
    if (!wanted) harnessFail('--only 需要 itemId 参数');
    fixtures = fixtures.filter((f) => f.itemId === wanted);
    if (fixtures.length === 0) harnessFail(`--only ${wanted} 未匹配任何夹具`);
  }

  log('════════════════════════════════════════════════════════════');
  log('V6「改坏即红」夹具 runner — 三态退出码 0=全过 / 1=有夹具没红 / 2=检查自身失败');
  log(`repo   : ${REPO_ROOT}`);
  log(`manifest: ${manifestPath}`);
  log(`夹具    : ${fixtures.length} 条 | 无法夹具登记: ${manifest.notFixtureable.length} 条`);
  log('════════════════════════════════════════════════════════════');

  preflight(fixtures);

  // 破坏前的文件哈希（结束时比对 —— 有未复原的破坏 ⇒ exit 2）
  const guardedFiles = [...new Set(fixtures.map((f) => f.breakHow.file))];
  const before = new Map<string, string>();
  for (const rel of guardedFiles) before.set(rel, sha256(readFileSync(join(REPO_ROOT, rel), 'utf8')));

  const outcomes: FixtureOutcome[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    outcomes.push(runOne(fixtures[i], i + 1, fixtures.length));
  }

  // ── 收尾不变式：所有被碰过的文件必须回到原样 ──
  for (const rel of guardedFiles) {
    const now = sha256(readFileSync(join(REPO_ROOT, rel), 'utf8'));
    if (now !== before.get(rel)) harnessFail(`工作树未复原: ${rel}`);
  }
  const diff = spawnSync('git', ['diff', '--stat', '--', ...guardedFiles], { cwd: REPO_ROOT, encoding: 'utf8' });
  if ((diff.stdout ?? '').trim() !== '') {
    harnessFail(`git diff 对被碰文件非空（未复原）:\n${diff.stdout}`);
  }
  // 全树契约：runner 离开时，已跟踪文件必须与进入时一致（含判据自身造成的外溢改动）。
  const dirtyAtEnd = trackedDirty();
  if (dirtyAtEnd.length > 0) {
    harnessFail(`收尾时工作树仍有已跟踪改动 —— runner 未守住"离开时与进入时一致"契约:\n${dirtyAtEnd.join('\n')}`);
  }

  // ── 汇总 ──
  const valid = outcomes.filter((o) => o.valid);
  const invalid = outcomes.filter((o) => !o.valid);

  log('\n════════════════════════════════════════════════════════════');
  log(`夹具通过率: ${valid.length}/${outcomes.length}`);
  for (const o of outcomes) {
    const mark = o.valid ? '✅ VALID  ' : '❌ INVALID';
    log(`  ${mark} ${o.itemId}  broken=${o.brokenExit}  restored=${o.restoredExit}`);
  }
  const withSideEffects = outcomes.filter((o) => o.sideEffects.length > 0);
  if (withSideEffects.length > 0) {
    log('\n⚠️ 判据非密闭观测（已复原；判据件自身的缺陷，不影响夹具判定，但不可当"干净"报）:');
    for (const o of withSideEffects) log(`  · ${o.itemId} → ${o.sideEffects.join(', ')}`);
  }
  log(`无法夹具（V-08 显式登记，不计入分母）: ${manifest.notFixtureable.length} 项`);
  log('════════════════════════════════════════════════════════════');

  if (invalid.length > 0) {
    log(`\n⇒ exit ${EXIT_NOT_RED}: ${invalid.length} 条夹具没有转红，判据无分辨力。`);
    process.exit(EXIT_NOT_RED);
  }
  log(`\n⇒ exit ${EXIT_ALL_PASS}: 全部 ${valid.length} 条夹具通过（破坏态红 + 复原态绿）。`);
  process.exit(EXIT_ALL_PASS);
}

main();
