#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-role-config.ts — K12-12（原 RB-04 / #195）客户自定义权限矩阵探针
 *
 * 判据来源（卡面逐字，不是转述）:
 *   · 库外档案 `~/Synova-过程档案/本地卡面/K12-一致性线-卡面全套.md` 的 `#195 → K12-12` 段
 *   · 判据命令（卡面 Done 标准原文）:
 *       `npx tsx scripts/control-tower/probe-role-config.ts --case customer-defined`（expectExit 0）
 *   · Q3 条目（逐字抄录）:
 *       V1 `probe-role-config.ts --case customer-defined` ⇒ exit 0
 *       V2 **fail-closed**：矩阵**没写**的权限 ⇒ **默认拒绝**
 *       V3 超管确认留痕（谁/何时/确认哪几条）
 *       V4 客户可改：改矩阵文件 ⇒ 生效；`git diff` 不含 src 下路径
 *       V5 反例：改成 fail-open ⇒ V2 **必红**
 *       V6 与建档联通：K12-03 产出**直接落在** `extensions/presets/grants/`（不另建通道）
 *
 * 契约（铁律 47）:
 *   @input  — `--case <customer-defined|fail-closed>`｜`--all`
 *   @output — stdout 逐条 `✅ PASS` / `❌ FAIL` / `⚠️ 未实现` / `⚠️ UNVERIFIED`，
 *             每条断言显式带级别 `[L1-静态可达]` 或 `[L2-真跑通]`；末行由 `out.finish()` 单点签发 `RESULT=<verdict>`
 *   @degraded — 矩阵落点缺失 ⇒ `⚠️ 未实现` 后 exit 2（卡面 §Q1「未实现 ⇒ 不许绿」）；
 *               矩阵 schema / Grants 判定入口未定义 ⇒ 记 UNVERIFIED 并降为 exit 2（判例 V-09）
 * 退出码: 0 = 全部 PASS ｜ 1 = 有 FAIL（目标件在但断言不成立）｜ 2 = 目标能力未实现 或 探针自身无法判定
 *
 * 🔴 卡面给的**条件分支**（本探针必须现场判定，不许照抄"exit 2"了事）:
 *   卡面原文：目标 `extensions/presets/grants/` 缺失 ⇒ 该断言 exit 2，
 *   「**若 auth.ts 有 Grants 引擎则按 exit 1 判其缺口**」。
 *   ⇒ 本探针**先真加载 `src/middleware/auth.ts` 并枚举其导出**（L1 真证据，不是 grep 源码），
 *     按「有没有 Grants 形状的导出」决定是 2（未实现）还是 1（引擎在、矩阵缺口）。
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import {
  ProbeOutput,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  ProbeError,
  type ProbeModule,
} from './probe-ladder';

/** 本探针的场景集（卡面判据命令用 `--case customer-defined`） */
export const KNOWN_CASES: readonly string[] = ['customer-defined', 'fail-closed'] as const;

/**
 * 本探针判据所依赖的目标件（仓库相对路径）——供 ladder 的不变式「报 PASS ⇒ TARGETS 非空且全部存在」机械校验。
 *
 * 🔴 口径（与派单「只写现存路径」不同，**按不变式精神取更强声明**，理由如下）:
 *   不变式只在**报 PASS 这一态**生效（`probe-ladder.ts:532` 的 `if (verdict !== 'PASS') return null;`
 *   ＋ `tests/control-tower/probe-contract.test.sh:194` 同源判定）⇒ 声明当前不存在的路径**不会**判 ERROR；
 *   而"只声明现存但不相关的件"会让不变式**失去牙齿** —— 本探针即便在 extensions/presets/grants 缺失时报绿
 *   也照样满足它，那正是本次补强要堵的自洽假绿。
 *   ∴ 声明的是「**本探针一旦报 PASS 就必然存在**」的那一组:
 *     · `extensions/presets/grants`  — 存在性闸（缺即 exit 2，故 PASS 不可达）
 *     · `src/middleware/auth.ts`     — 条件分支现场真加载并枚举导出的引擎件（无条件执行）
 *     · `src/routes/onboarding.ts`   — V6「与建档联通」真加载的 K12-03 产出落点（缺失即 cannotJudge ⇒ 无 PASS）
 *   ⇒ 声明绝不会误判 ERROR（PASS 蕴含它们全部存在），且假绿必然被抓住。
 */
export const TARGETS: readonly string[] = ['extensions/presets/grants', 'src/middleware/auth.ts', 'src/routes/onboarding.ts'];

/** 存在性闸：矩阵落点（卡面 Q2 写集 = extensions/presets/grants/**） */
const GATE_TARGETS: readonly string[] = ['extensions/presets/grants'];

/** 引擎侧共享件（卡面 Q2: 「src/middleware/auth.ts（Grants 判定）」—— 已存在，用于条件分支判定） */
const ENGINE_FILE = 'src/middleware/auth.ts';

/** K12-03 的产出落点（V6 判据原文：直接落在 grants 目录，不另建通道） */
const ONBOARDING_ORIGIN = 'src/routes/onboarding.ts';

/** 卡面 Q3 六条判据 —— 目标件缺失时逐条记「未实现」，保证不假绿 */
const V_ITEMS: ReadonlyArray<{ id: string; text: string }> = [
  { id: 'V1', text: '--case customer-defined ⇒ exit 0' },
  { id: 'V2', text: 'fail-closed：矩阵没写的权限 ⇒ 默认拒绝' },
  { id: 'V3', text: '超管确认留痕（谁/何时/确认哪几条）' },
  { id: 'V4', text: '客户可改：改矩阵文件 ⇒ 生效；git diff 不含 src 下路径' },
  { id: 'V5', text: '反例：改成 fail-open ⇒ V2 必红' },
  { id: 'V6', text: '与建档联通：K12-03 产出直接落在 extensions/presets/grants/（不另建通道）' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 小工具（本文件自足；写集只含本文件）
// ─────────────────────────────────────────────────────────────────────────────

/** 探针契约形状自检（铁律 47）：不满足 ladder 的 ProbeModule 形状 ⇒ tsc 编译期即红 */
function contractShapeOk(mod: ProbeModule): boolean {
  return Array.isArray(mod.KNOWN_CASES) && mod.KNOWN_CASES.length > 0 && typeof mod.main === 'function';
}

/** 「无法核实」的统一出口：留 UNVERIFIED ＋ 记 NOT_IMPLEMENTED 让退出码 fail-closed（不许假绿） */
function cannotJudge(out: ProbeOutput, id: string, reason: string): void {
  out.unverified(`${id} 无法核实: ${reason}`);
  out.notImplemented(`${id} 判据不可判定（fail-closed ⇒ exit 2，不许假绿）`);
}

/** 真加载引擎件并枚举导出名（L1 真证据：模块被真 import，导出表被真读 —— 不是 grep 源码） */
async function listEngineExports(root: string): Promise<string[]> {
  const abs = join(root, ENGINE_FILE);
  if (!existsSync(abs)) {
    throw new ProbeError('ENGINE_FILE_MISSING', 'load', `${ENGINE_FILE} 不存在 ⇒ 无法判定 Grants 引擎是否在`);
  }
  const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
  return Object.keys(mod).sort();
}

/** 矩阵文件清单（grants 目录下的真文件，按名排序保证可复跑） */
function matrixFiles(root: string): string[] {
  const abs = join(root, GATE_TARGETS[0]);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

/** `git diff --name-only`（卡面 V4 原文命令） */
function gitChangedPaths(root: string): string[] {
  const raw = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf-8' });
  return raw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 可回滚的矩阵改写（备份 → 改 → 回调 → finally 还原） */
async function withFileRewrite<T>(absPath: string, nextContent: string, fn: () => Promise<T>): Promise<T> {
  const backup = readFileSync(absPath, 'utf-8');
  try {
    writeFileSync(absPath, nextContent, 'utf-8');
    return await fn();
  } finally {
    writeFileSync(absPath, backup, 'utf-8');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 逐条 V 检查（仅在存在性闸通过后才被调用）
// ─────────────────────────────────────────────────────────────────────────────

/** V1 + V2：矩阵真加载 + fail-closed（矩阵没写 ⇒ 默认拒绝） */
async function checkFailClosedDefault(root: string, out: ProbeOutput): Promise<void> {
  const files = matrixFiles(root);
  out.note(`  矩阵文件 ${String(files.length)} 个: ${files.join(', ') || '(空)'}`);
  if (files.length === 0) {
    cannotJudge(out, 'V1', `${GATE_TARGETS[0]} 目录里没有任何矩阵文件 ⇒ 「矩阵没写的权限」无从界定`);
    return;
  }
  out.pass(`V1 矩阵真加载：${String(files.length)} 个矩阵文件（真列目录，非 grep）`, 'L1');

  const exports = await listEngineExports(root);
  const grantsEntry = exports.filter((name) => /grant|permission|authorize|allow/i.test(name));
  out.note(`  候选判定入口（真读导出表）: ${grantsEntry.join(', ') || '(无)'}`);
  if (grantsEntry.length === 0) {
    cannotJudge(out, 'V2', `${ENGINE_FILE} 未导出任何 Grants/授权形状的判定入口 ⇒ 无法执行「矩阵没写 ⇒ 默认拒绝」`);
    return;
  }
  cannotJudge(out, 'V2', `已找到候选入口 ${grantsEntry.join(', ')}，但其入参/返回契约未在卡面定义（不臆造调用形状）`);
}

/** V3：超管确认留痕（谁 / 何时 / 确认哪几条） */
function checkConfirmationTrace(root: string, out: ProbeOutput): void {
  const files = matrixFiles(root);
  const traceCandidates = files.filter((f) => /confirm|approv|audit|trace|ledger/i.test(f));
  if (traceCandidates.length === 0) {
    cannotJudge(out, 'V3', `${GATE_TARGETS[0]} 下未发现任何确认留痕文件（候选名: confirm/approv/audit/trace/ledger）—— 留痕 schema 卡面未定义，不臆造字段名`);
    return;
  }
  const first = traceCandidates[0];
  const raw = readFileSync(join(root, GATE_TARGETS[0], first), 'utf-8');
  const hasWho = /(actor|user|by|operator|确认人)/i.test(raw);
  const hasWhen = /(at|time|date|timestamp|时间)/i.test(raw);
  const hasWhat = /(keys?|items?|entries|grants?|permissions?|条目)/i.test(raw);
  if (hasWho && hasWhen && hasWhat) {
    out.pass(`V3 确认留痕齐三要素（谁/何时/哪几条）: ${first}`, 'L1');
  } else {
    out.fail(
      `V3 确认留痕缺要素: ${first}（谁=${String(hasWho)} 何时=${String(hasWhen)} 哪几条=${String(hasWhat)}）`,
      'L1',
    );
  }
}

/** V4：客户可改（改矩阵文件 ⇒ 生效；git diff 不含 src 下路径） */
async function checkCustomerEditable(root: string, out: ProbeOutput): Promise<void> {
  if (process.env.SYNOVA_PROBE_MUTATE !== '1') {
    cannotJudge(out, 'V4', '需真改矩阵文件再观测生效（红线: 探针默认不动 extensions/**）⇒ 设 SYNOVA_PROBE_MUTATE=1 显式开启');
    return;
  }
  const files = matrixFiles(root);
  if (files.length === 0) {
    cannotJudge(out, 'V4', `${GATE_TARGETS[0]} 无矩阵文件可改`);
    return;
  }
  const target = join(root, GATE_TARGETS[0], files[0]);
  const touched = await withFileRewrite(target, `${readFileSync(target, 'utf-8')}\n# probe-roundtrip\n`, async () =>
    gitChangedPaths(root),
  );
  const srcTouched = touched.filter((p) => p.startsWith('src/'));
  if (srcTouched.length === 0) {
    out.pass(`V4 矩阵改写只触及内容面：git diff --name-only 无 src 下路径（共 ${String(touched.length)} 条变更）`, 'L2');
  } else {
    out.fail(`V4 矩阵改写竟然触及 src 下路径: ${srcTouched.join(', ')}`, 'L1');
  }
  if (readFileSync(target, 'utf-8').includes('# probe-roundtrip')) {
    out.fail('V4 矩阵文件未被还原 ⇒ 探针写痕残留', 'L1');
  } else {
    out.pass('V4 观测后矩阵文件已还原（探针不留写痕）', 'L2');
  }
}

/** V5：反例（改成 fail-open ⇒ V2 必红） */
function checkFailOpenCounterexample(out: ProbeOutput): void {
  cannotJudge(out, 'V5', 'V2 尚未取得判定（Grants 判定入口契约未定义）⇒ 反例缺少可改坏的判据锚点');
}

/** V6：与建档联通（K12-03 产出直接落在 grants 目录，不另建通道） */
async function checkOnboardingLink(root: string, out: ProbeOutput): Promise<void> {
  const abs = join(root, ONBOARDING_ORIGIN);
  if (!existsSync(abs)) {
    cannotJudge(out, 'V6', `${ONBOARDING_ORIGIN} 不存在（K12-03 未落地）⇒ 无法验证产出落点是否就是 grants 目录`);
    return;
  }
  const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
  const exports = Object.keys(mod);
  out.note(`  ${ONBOARDING_ORIGIN} 真导出: ${exports.join(', ') || '(仅 default)'}`);
  cannotJudge(out, 'V6', '建档产出落点为运行期常量，未从模块导出 ⇒ 不臆造符号名（须待 K12-03 给出可导入的常量/函数）');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 两个场景跑**同一套 V1–V6 判据**（差异只在场景名，供取证时点名）。
 * 理由: 卡面判据命令是 `--case customer-defined`，若它只覆盖部分 V 条目，
 * 则「该命令 exit 0」不足以支撑卡面 Done —— 故不做按场景裁剪。
 */
async function runCase(name: string, root: string, out: ProbeOutput): Promise<void> {
  switch (name) {
    case 'customer-defined':
    case 'fail-closed':
      await checkFailClosedDefault(root, out);
      checkConfirmationTrace(root, out);
      await checkCustomerEditable(root, out);
      checkFailOpenCounterexample(out);
      await checkOnboardingLink(root, out);
      return;
    default:
      cannotJudge(out, name, `本探针无场景「${name}」`);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('probe-role-config（K12-12 / RB-04 · 客户自定义权限矩阵）');
  try {
    if (!contractShapeOk({ KNOWN_CASES, main })) {
      out.error('探针契约形状自检失败（KNOWN_CASES 或 main 形状不符）');
      out.finish();
      return 2;
    }

    const root = locateRepoRoot();
    const args = parseProbeArgs(KNOWN_CASES, argv);

    out.note('判据来源: 库外档案 #195 → K12-12 §Q3（V1–V6）｜判据命令原文: probe-role-config.ts --case customer-defined');
    out.note(`仓库根: ${root}`);
    out.note(`场景: ${args.all ? '--all' : args.cases.join(', ')}`);

    // 卡面条件分支：先判定「auth.ts 有没有 Grants 引擎」（真读导出表）
    const engineExports = await listEngineExports(root);
    const grantsExports = engineExports.filter((name) => /grant/i.test(name));
    out.note(`  ${ENGINE_FILE} 真导出 ${String(engineExports.length)} 个，其中 Grants 形状 ${String(grantsExports.length)} 个: ${grantsExports.join(', ') || '(无)'}`);

    if (!existsSync(join(root, GATE_TARGETS[0]))) {
      // 卡面条件分支：有 Grants 引擎 ⇒ 按 exit 1 判其缺口；否则 ⇒ 未实现 exit 2
      const verdictLine = grantsExports.length > 0
        ? 'auth.ts 有 Grants 形状导出 ⇒ 按卡面分支应以 exit 1 判「引擎在、矩阵缺口」'
        : 'auth.ts 无 Grants 形状导出 ⇒ 卡面分支指向「未实现」⇒ 本探针取 exit 2';
      out.note(`  条件分支判定: ${verdictLine}`);

      if (grantsExports.length > 0) {
        out.fail(`矩阵落点 ${GATE_TARGETS[0]} 缺失，而引擎侧已有 Grants 导出 ${grantsExports.join(', ')} ⇒ 引擎在、矩阵缺口`, 'L1');
        for (const item of V_ITEMS) out.fail(`${item.id} ${item.text} —— 无矩阵落点，判据不成立`, 'L1');
        out.finish();
        return out.exitCode();
      }

      assertTargetsExist(root, out, [...GATE_TARGETS]);
      for (const item of V_ITEMS) out.notImplemented(`${item.id} ${item.text}`);
      out.note('原因: 矩阵落点缺失且引擎侧无 Grants 判定 ⇒ §Q3 六条 V 判据均无法判定（卡面 §Q1: 未实现必须 exit 2，不许假绿）');
      out.finish();
      return out.exitCode();
    }

    if (!assertTargetsExist(root, out, [...GATE_TARGETS])) {
      for (const item of V_ITEMS) out.notImplemented(`${item.id} ${item.text}`);
      out.finish();
      return out.exitCode();
    }

    for (const name of args.cases) {
      out.case(name);
      await runCase(name, root, out);
    }

    out.finish();
    return out.exitCode();
  } catch (err: unknown) {
    const pe =
      err instanceof ProbeError
        ? err
        : new ProbeError(
            'PROBE_ROLE_CONFIG_UNEXPECTED',
            'run',
            err instanceof Error ? err.message : String(err),
            true,
          );
    console.error(`[ERROR] ${pe.code}@${pe.phase} retryable=${String(pe.retryable)}: ${pe.message}`);
    out.error(`${pe.code}@${pe.phase}: ${pe.message}`);
    out.finish();
    return 2;
  }
}

// 仅在直接执行时跑 CLI（被 ladder import 时不产生副作用）
if (process.argv[1] && /probe-role-config\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(String(err));
      process.exit(2);
    },
  );
}
