#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-notification-registry.ts — 通知渠道装配探针（#200 / K12-17 · 件3）
 *
 * 用法: npx tsx scripts/control-tower/probe-notification-registry.ts --all
 *       npx tsx scripts/control-tower/probe-notification-registry.ts --case <场景>
 *
 * 为什么存在（#200 卡面 §Q3）: 既有 `tests/notifications/notification-loader.test.ts` 原文是
 *   `expect(registered).toBeGreaterThanOrEqual(0)` —— **0 也绿**（空壳，铁律 48）。
 *   ⇒ "把引擎码搬回 extensions/、让 loader 指空"这条路**当时能全绿通过**。
 *   本探针是它的**有牙齿**替代/补充：真跑生产 loader，逐条对比注册数与"实现缺失"错误。
 *
 * 三态退出码（判例 M-02，禁恒绿）:
 *   0 = 全部场景 PASS（末行 `RESULT=PASS`）
 *   1 = 有断言 FAIL（末行 `RESULT=FAIL`，fail-closed）
 *   2 = NOT_IMPLEMENTED（被测通路不存在 ⇒ 末行 `RESULT=NOT_IMPLEMENTED`）
 *       或 探针自身异常/参数错误（末行 `RESULT=ERROR`）
 *       —— 沿用 probe-sentinel.ts 头注释的既有口径：「2 = 未实现 / 探针自身异常」。
 *
 * 🔴 cwd 陷阱（本探针必须自己挡，否则判据自身恒 0 假绿）:
 *   `src/notifications/notification-loader.ts:18/31` 两个扫描根都是
 *   `join(process.cwd(), 'extensions'|'src', 'notifications')` ⇒ **cwd 必须是仓根**。
 *   实测: cwd=/private/tmp ⇒ registered=0 ＋ error「通知目录不存在」；cwd=仓根 ⇒ registered=4。
 *   ⇒ 本探针先 locateRepoRoot() 再 `process.chdir(root)`（与 probe-sentinel.ts:87 同惯例），
 *     并把"是否发生过 chdir"打印出来（不隐瞒）。
 *
 * 场景取值表:
 *   content-side-clean   extensions/notifications 下 **.ts 归零**（引擎码不得留在客户面）
 *   host-impl-present    TARGETS 声明的宿主实现件**全部存在**（src/notifications/*-adapter.ts）
 *   registry-count       真跑生产 loader ⇒ registered == 渠道目录数（非 `_` 开头且含 manifest.json），且 > 0
 *   no-impl-missing      该次装配的 errors[] **不含** "实现缺失"类条目（禁静默降级）
 */
import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

// ══════════════════════════════════════════════════════════════════════════════
// 一、判据常量
// ══════════════════════════════════════════════════════════════════════════════

/** 场景清单（`--all` 跑全部；`--case` 跑单个） */
export const KNOWN_CASES: readonly string[] = [
  'content-side-clean',
  'host-impl-present',
  'registry-count',
  'no-impl-missing',
];

/**
 * 本探针判"存在"的目标件（仓库相对路径）——供 ladder 的不变式
 * 「报 PASS ⇒ TARGETS 非空且全部存在」机械校验（同 probe-department-axis.ts:277-286 惯例）。
 * = K12-17 把引擎码归位后，**宿主侧必须存在的 4 个内置渠道实现**。
 */
export const TARGETS: readonly string[] = [
  'src/notifications/email-adapter.ts',
  'src/notifications/feishu-approval-adapter.ts',
  'src/notifications/jira-adapter.ts',
  'src/notifications/linear-adapter.ts',
];

const LOADER_REL = 'src/notifications/notification-loader.ts';
const NOTIF_DIR_REL = 'extensions/notifications';
/** 内容侧实现的历史形态（归位后**不该**再出现；出现即引擎码回流客户面） */
const CONTENT_IMPL_BASENAME = 'adapter.ts';
/** 实现缺失类错误（新旧两种措辞都算 —— 旧措辞见 #200 前的 loader 实现） */
const IMPL_MISSING_MARKERS: readonly string[] = ['无可用实现', 'entryPoint 不存在'];

// ══════════════════════════════════════════════════════════════════════════════
// 二、错误分类（铁律 32：code + phase + retryable）
// ══════════════════════════════════════════════════════════════════════════════

interface ProbeError extends Error {
  code: string;
  phase: string;
  retryable: boolean;
}

function toProbeError(err: unknown, phase: string): ProbeError {
  const base = err instanceof Error ? err : new Error(String(err));
  const pe = base as ProbeError;
  if (typeof pe.code !== 'string') pe.code = 'PROBE_INTERNAL';
  if (typeof pe.phase !== 'string') pe.phase = phase;
  if (typeof pe.retryable !== 'boolean') pe.retryable = false;
  return pe;
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、输出（逐条 ✅/❌/⚠️ + 末行 RESULT=）
// ══════════════════════════════════════════════════════════════════════════════

type Verdict = 'PASS' | 'FAIL' | 'NOT_IMPLEMENTED' | 'ERROR';

class Out {
  private failures = 0;
  private notImplemented = false;
  private errored = false;

  note(msg: string): void { console.log(`ℹ️  ${msg}`); }
  ok(msg: string): void { console.log(`✅ ${msg}`); }

  fail(msg: string): void {
    this.failures++;
    console.log(`❌ ${msg}`);
  }

  notImplemented(msg: string): void {
    this.notImplemented = true;
    console.log(`⚠️ 未实现: ${msg}`);
  }

  error(msg: string): void {
    this.errored = true;
    console.log(`❌ ${msg}`);
  }

  finish(): Verdict {
    let verdict: Verdict;
    if (this.errored) verdict = 'ERROR';
    else if (this.notImplemented) verdict = 'NOT_IMPLEMENTED';
    else if (this.failures > 0) verdict = 'FAIL';
    else verdict = 'PASS';
    console.log(`RESULT=${verdict}`);
    return verdict;
  }

  exitCode(verdict: Verdict): 0 | 1 | 2 {
    if (verdict === 'PASS') return 0;
    if (verdict === 'FAIL') return 1;
    return 2;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、仓根定位（cwd 陷阱的唯一解）
// ══════════════════════════════════════════════════════════════════════════════

function locateRepoRoot(): string {
  let cur = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cur, LOADER_REL))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw Object.assign(new Error(`无法定位仓根（未找到 ${LOADER_REL}；cwd=${process.cwd()}）`), {
    code: 'REPO_ROOT_NOT_FOUND', phase: 'locate-root', retryable: false,
  });
}

/** 渠道目录数（口径 = loader 的扫描循环逐字对齐：非 `_` 开头、且含 manifest.json 的**子目录**） */
function declaredChannelCount(root: string): number {
  const dir = join(root, NOTIF_DIR_REL);
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .filter((e) => existsSync(join(dir, e.name, 'manifest.json')))
    .length;
}

interface LoadResult { registered: number; errors: string[] }

async function loadRegistry(root: string): Promise<LoadResult> {
  const mod = (await import(pathToFileURL(join(root, LOADER_REL)).href)) as {
    loadAndRegisterNotificationAdapters: () => Promise<LoadResult>;
  };
  return mod.loadAndRegisterNotificationAdapters();
}

/** 递归找内容面残留的 .ts（引擎码不得留在客户面） */
function findContentSideTs(root: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) hits.push(p);
    }
  };
  walk(join(root, NOTIF_DIR_REL));
  return hits.sort();
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、场景
// ══════════════════════════════════════════════════════════════════════════════

async function caseContentSideClean(root: string, out: Out): Promise<void> {
  const hits = findContentSideTs(root);
  if (hits.length === 0) {
    out.ok(`content-side-clean: ${NOTIF_DIR_REL} 下 .ts = 0（引擎码不在客户面）`);
  } else {
    out.fail(
      `content-side-clean: ${NOTIF_DIR_REL} 下仍有 ${hits.length} 个 .ts ⇒ 引擎码回流客户面: ` +
        hits.slice(0, 5).join(', '),
    );
  }
}

async function caseHostImplPresent(root: string, out: Out): Promise<void> {
  const missing = TARGETS.filter((rel) => !existsSync(join(root, rel)));
  if (missing.length === 0) {
    out.ok(`host-impl-present: ${TARGETS.length}/${TARGETS.length} 宿主实现件在盘上`);
  } else {
    out.fail(`host-impl-present: 宿主实现件缺失 ${missing.length}/${TARGETS.length}: ${missing.join(', ')}`);
  }
}

async function caseRegistryCount(root: string, out: Out): Promise<void> {
  const expected = declaredChannelCount(root);
  if (expected <= 0) {
    out.notImplemented(`registry-count: 渠道目录数 = ${expected} ⇒ 无声明面，判据退化，拒绝报绿`);
    return;
  }
  const { registered, errors } = await loadRegistry(root);
  if (registered === expected) {
    out.ok(`registry-count: registered=${registered} == 渠道目录数=${expected}（errors=${errors.length}）`);
  } else {
    out.fail(
      `registry-count: registered=${registered} ≠ 渠道目录数=${expected} ⇒ 有渠道未装配` +
        `（errors=${JSON.stringify(errors)}）`,
    );
  }
}

async function caseNoImplMissing(root: string, out: Out): Promise<void> {
  const { errors } = await loadRegistry(root);
  const bad = errors.filter((e) => IMPL_MISSING_MARKERS.some((m) => e.includes(m)));
  if (bad.length === 0) {
    out.ok(`no-impl-missing: errors[] 无"实现缺失"条目（errors=${errors.length}）`);
  } else {
    out.fail(`no-impl-missing: ${bad.length} 条实现缺失 ⇒ 静默降级风险: ${JSON.stringify(bad)}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、入口
// ══════════════════════════════════════════════════════════════════════════════

interface ProbeModule {
  readonly KNOWN_CASES: readonly string[];
  main(argv?: readonly string[]): Promise<0 | 1 | 2>;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new Out();
  const wantsAll = argv.includes('--all');
  const caseIdx = argv.indexOf('--case');
  const oneCase = caseIdx >= 0 ? argv[caseIdx + 1] : undefined;

  // 🔴 未知参数必须**点名**（打错字不许伪装成"跑过了"）——注意 `--case` 的**取值**不是参数：
  //   仅在 caseIdx >= 0 时才排除它的取值位（否则 i=0 会被误排除 ⇒ `--bogus` 被吞成"缺参数"）。
  const unknownFlag = argv.find(
    (a, i) => a.startsWith('-') && a !== '--all' && a !== '--case' && !(caseIdx >= 0 && i === caseIdx + 1),
  );
  if (unknownFlag) {
    out.error(`未知参数: ${unknownFlag}（fail-closed；用法 --all ｜ --case <场景>）`);
    return out.exitCode(out.finish());
  }
  if (!wantsAll && !oneCase) {
    out.error('必须给 --all 或 --case <场景>（禁"什么都不带就跑过"）');
    return out.exitCode(out.finish());
  }

  let cases: readonly string[];
  if (wantsAll) cases = KNOWN_CASES;
  else if (oneCase && KNOWN_CASES.includes(oneCase)) cases = [oneCase];
  else {
    out.error(`未知场景: ${oneCase}（合法取值 ${KNOWN_CASES.join(' / ')}）`);
    return out.exitCode(out.finish());
  }

  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    const pe = toProbeError(err, 'locate-root');
    out.error(`[${pe.code}/${pe.phase}/retryable=${String(pe.retryable)}] ${pe.message}`);
    return out.exitCode(out.finish());
  }

  const cwdBefore = process.cwd();
  if (cwdBefore !== root) {
    process.chdir(root);
    out.note(`cwd ${cwdBefore} ≠ 仓根 ⇒ 已 chdir 到 ${root}（loader 两个扫描根均为 cwd 相对，见头注释）`);
  }
  out.note(`仓根=${root} ｜ 场景=${cases.join(',')} ｜ TARGETS=${TARGETS.length} 件`);

  if (!existsSync(join(root, LOADER_REL))) {
    out.notImplemented(`${LOADER_REL} 不存在 ⇒ 被测通路未实现，拒绝报绿`);
    return out.exitCode(out.finish());
  }

  for (const name of cases) {
    try {
      if (name === 'content-side-clean') await caseContentSideClean(root, out);
      else if (name === 'host-impl-present') await caseHostImplPresent(root, out);
      else if (name === 'registry-count') await caseRegistryCount(root, out);
      else if (name === 'no-impl-missing') await caseNoImplMissing(root, out);
      else out.error(`场景分派未覆盖: ${name}`);
    } catch (err: unknown) {
      const pe = toProbeError(err, name);
      out.error(`[${pe.code}/${pe.phase}/retryable=${String(pe.retryable)}] ${pe.message} ⇒ 该场景无法判定`);
    }
  }

  return out.exitCode(out.finish());
}

/** 契约自证（编译期）：形状必须满足 `ProbeModule` */
const PROBE_CONTRACT: ProbeModule = { KNOWN_CASES, main };
void PROBE_CONTRACT;

// 仅在直接执行时跑 CLI（被 import 时不产生副作用）
if (process.argv[1] && /probe-notification-registry\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(String(err));
      process.exit(2);
    },
  );
}
