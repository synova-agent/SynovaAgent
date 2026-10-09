#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-content-registry.ts — #1465（K10·EXT-WIRE）判据探针
 *
 * 用途: 让「extensions 顶层内容项 → loader」这条解析链**可被独立跑红**。四段全断言，任一失败 exit 1。
 *
 * 判据来源: `docs/synova/coordination/施工项登记.ts` 的 EXT-WIRE 条目
 *   { run: 'npx tsx scripts/control-tower/probe-content-registry.ts', expectExit: 0 }
 * 规范来源: 山河研究院《extensions内容面规范-v0》§3.5（C3 可达 / C4 结构）＋ §5.2（唯一 type→loader 表）
 *
 * 四段（**禁把 L1-静态可达 报成 L2-真跑通** —— 每段标明级别）:
 *   PRESENCE  [L1] 20/20 项存在 ＋ 与 `extensions/` 顶层目录集**双向相等**（V1）
 *   INTEGRITY [L1] 状态/分面闭合 / 非可达项须有 reason / 无空挂 / 表完整性零问题（V1）
 *   RESOLVE   [L1] loader 模块文件真实存在；按名声明的 init/verify/cleanup 导出**真在模块上**
 *                  （经 file URL 直载模块取 `typeof === 'function'` —— 与宿主 loader 同型证据）
 *   CALL      [L2] **真跑** `initContentTypes()`：全部可装配项 ok ＋ init/verify **经模块边界计数
 *                  证明被真实调用**（🔴 **CTO 2026-10-09 裁定：不得以被检模块自报 `verified` 为据** ——
 *                   本段注入自建计数器表，计数发生在探针自己的包装里，故「只记账不真调用」必红）；
 *                  `business-models`「接活」项留痕 ＋ 副作用产出非空；非 reachable 项不得入装配面；
 *                  并断言 `src/init/file-driven-loaders.ts` 直连 loader import = 0（V2 唯一真源）
 *
 * 契约 (铁律 47):
 *   @input    — 无入参。仓库根 = `SYNOVA_REPO_ROOT` 或 cwd（须含 `src/deploy/content-registry.ts`；否则自 cwd 逐级上溯）
 *   @output   — stdout 四段报告 + 末行 SUMMARY
 *   @degraded — **无降级分支**：任一段失败 ⇒ `[FAIL]` 明细 + exit 1（fail-closed，禁静默放行）；
 *               探针自身异常（定位不到仓库根 / 依赖缺失）⇒ exit 2
 * 退出码: 0 = 四段全绿；1 = 断言失败；2 = 探针自身异常
 *
 * 写集说明: 本文件属 #1465 写集（登记件 paths 内「判据交付物（本卡创建）」）；
 *           `scripts/control-tower/**` 其余文件**只读不碰**。
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

const SECTIONS: string[] = [];
const FAILURES: string[] = [];

function section(title: string): void {
  SECTIONS.push(title);
  console.log(`\n── ${title} ──`);
}

function ok(msg: string): void {
  console.log(`  [ok]   ${msg}`);
}

function fail(msg: string): void {
  FAILURES.push(msg);
  console.log(`  [FAIL] ${msg}`);
}

function locateRepoRoot(): string {
  const candidates: string[] = [];
  if (process.env.SYNOVA_REPO_ROOT) candidates.push(process.env.SYNOVA_REPO_ROOT);
  let cur = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const c of candidates) {
    if (existsSync(join(c, 'src', 'deploy', 'content-registry.ts'))) return c;
  }
  throw new Error(
    `无法定位仓库根（已试 ${candidates.length} 个候选：${candidates.join(' | ')}）；` +
      '请设 SYNOVA_REPO_ROOT 或在仓库内运行',
  );
}

/** 模块说明符（相对 src/deploy）→ 磁盘上的 .ts 绝对路径 */
function modulePathOf(repoRoot: string, spec: string): string {
  return join(repoRoot, `${spec.replace('../', 'src/')}.ts`);
}

async function main(): Promise<number> {
  let repoRoot: string;
  try {
    repoRoot = locateRepoRoot();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] probe-bootstrap: ${msg}`);
    return 2;
  }
  console.log(`PROBE_REPO_ROOT: ${repoRoot}`);

  let mod: typeof import('../../src/deploy/content-registry');
  try {
    mod = await import('../../src/deploy/content-registry');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] probe-bootstrap: content-registry 导入失败: ${msg}`);
    return 2;
  }

  const { describeContentRegistry, initContentTypes } = mod;
  const snapshot = describeContentRegistry();

  // ═══ ① PRESENCE [L1] ═══
  section('① PRESENCE [L1] — 20/20 项覆盖 × extensions 顶层目录集');
  console.log(`  registry 项数: ${snapshot.counts.total}`);
  if (snapshot.counts.total !== 20) {
    fail(`注册表应为 20 项，实测 ${snapshot.counts.total}`);
  } else {
    ok('项数 = 20');
  }

  const extRoot = join(repoRoot, 'extensions');
  if (!existsSync(extRoot)) {
    console.error(`[FAIL] probe-bootstrap: extensions/ 不存在: ${extRoot}`);
    return 2;
  }
  const onDisk = readdirSync(extRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const inRegistry = snapshot.entries.map((e) => e.dir).sort();
  console.log(`  磁盘顶层目录: ${onDisk.length} (${onDisk.join(', ')})`);
  const missing = onDisk.filter((d) => !inRegistry.includes(d));
  const extra = inRegistry.filter((d) => !onDisk.includes(d));
  if (missing.length > 0) fail(`注册表漏登记顶层目录: ${missing.join(', ')}`);
  if (extra.length > 0) fail(`注册表登记了不存在的目录: ${extra.join(', ')}`);
  if (missing.length === 0 && extra.length === 0) ok('双向相等（V1 20/20 有明确状态）');

  // ═══ ② INTEGRITY [L1] ═══
  section('② INTEGRITY [L1] — 状态/分面闭合 / reason / 空挂 / 表完整性');
  console.log(`  状态分布: ${JSON.stringify(snapshot.counts)}`);
  if (snapshot.integrityProblems.length > 0) {
    for (const p of snapshot.integrityProblems) fail(`表完整性: ${p}`);
  } else {
    ok('表完整性零问题（integrityProblems = []）');
  }
  for (const e of snapshot.entries) {
    if (!snapshot.statusValues.includes(e.status)) fail(`${e.type}: status 非法 "${e.status}"`);
    if (!snapshot.faceValues.includes(e.face)) fail(`${e.type}: face 非法 "${e.face}"`);
    if (e.status !== 'reachable' && !e.reason) fail(`${e.type}: 非可达但缺 reason（显式化缺失）`);
    if (e.status === 'reachable' && e.loader === undefined && (e.readers ?? []).length === 0) {
      fail(`${e.type}: reachable 但无 loader 也无 readers（空挂）`);
    }
  }
  ok('逐项 status / face / reason / 空挂 检查完成');

  // ═══ ③ RESOLVE [L1] — 按名声明的导出真在模块上 ═══
  section('③ RESOLVE [L1] — loader 模块文件存在 × 声明的导出真实存在');
  const loadable = snapshot.entries.filter((e) => e.status === 'reachable' && e.loader !== undefined);
  console.log(`  可装配项: ${loadable.length} (${loadable.map((e) => e.type).join(', ')})`);

  for (const e of loadable) {
    const loader = e.loader;
    if (loader === undefined) continue;
    const asFile = modulePathOf(repoRoot, loader.module);
    if (!existsSync(asFile)) {
      fail(`${e.type}: 模块文件不存在 ${asFile}`);
      continue;
    }
    if (!snapshot.moduleKeys.includes(loader.module)) {
      fail(`${e.type}: ${loader.module} 不在 moduleKeys（表内自洽失败）`);
    }
    const m: Record<string, unknown> = await import(pathToFileURL(asFile).href);
    const declared: string[] = [loader.init];
    for (const s of loader.verify ?? []) {
      if ((s.module ?? loader.module) === loader.module) declared.push(s.fn);
    }
    if (loader.cleanup !== undefined) declared.push(loader.cleanup);
    const absent = declared.filter((fn) => typeof m[fn] !== 'function');
    if (absent.length > 0) fail(`${e.type} (${loader.module}): 声明但模块上不存在导出 → ${absent.join(', ')}`);
    else ok(`${e.type.padEnd(16)} ${loader.module} exports=[${declared.join(',')}]`);

    // 跨模块 verify
    for (const s of loader.verify ?? []) {
      const sm = s.module;
      if (sm === undefined || sm === loader.module) continue;
      const sFile = modulePathOf(repoRoot, sm);
      if (!existsSync(sFile)) {
        fail(`${e.type}: verify ${s.fn} 的模块文件不存在 ${sFile}`);
        continue;
      }
      const smod: Record<string, unknown> = await import(pathToFileURL(sFile).href);
      if (typeof smod[s.fn] !== 'function') fail(`${e.type}: verify ${s.fn} 在 ${sm} 上不存在`);
      else ok(`${e.type.padEnd(16)} ${sm} export=${s.fn} (跨模块 verify)`);
    }
  }

  // ═══ ④ CALL [L2] — 真跑装配 ＋ V2 唯一真源 ═══
  section('④ CALL [L2] — 真跑 + 独立观测(模块边界计数) + V2 唯一真源');
  // ── 独立观测仪器（CTO 2026-10-09 裁定：**不得以被检模块自报为据**）──
  //   自建一张与 registry 同键的模块表 —— 按**磁盘 file URL 直载**（不经 registry 的私有
  //   `MODULE_IMPORTS`），把每个导出函数包一层**调用计数器**，再经 `initContentTypes({ modules })` 注入。
  //   ⇒ 计数发生在**我们自己的包装里**（模块边界），与 `report.results[].verified`（被检模块自报）无关。
  //   ⇒ 凡「只记账、不真调用」者计数恒 0 ⇒ **必红**（M4 变异由**构造**排除，非靠断言声明）。
  const callCounts = new Map<string, number>();
  const instrumented: Record<string, () => Promise<Record<string, unknown>>> = {};
  for (const spec of snapshot.moduleKeys) {
    const file = modulePathOf(repoRoot, spec);
    if (!existsSync(file)) continue;
    instrumented[spec] = async () => {
      const real: Record<string, unknown> = await import(pathToFileURL(file).href);
      const spy: Record<string, unknown> = { ...real };
      for (const [name, fn] of Object.entries(real)) {
        if (typeof fn !== 'function') continue;
        const key = `${spec}#${name}`;
        spy[name] = (...args: unknown[]) => {
          callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
          return (fn as (...a: unknown[]) => unknown)(...args);
        };
      }
      return spy;
    };
  }

  const report = await initContentTypes({ modules: instrumented });
  console.log(
    `  attempted=${report.attempted} loaded=${report.loaded} degraded=${report.degraded} ` +
      `errors=${report.errors.length} warnings=${report.warnings.length}`,
  );
  if (report.attempted === 0) fail('CALL: 零项可装配（registry 未接任何 loader）');
  if (report.loaded !== report.attempted) {
    fail(`CALL: loaded(${report.loaded}) ≠ attempted(${report.attempted}) — ${report.errors.join(' | ')}`);
  } else {
    ok(`全部 ${report.loaded} 项装配成功`);
  }

  // 声明的 init/verify 是否**被真实调用** —— 判据口径（CTO 2026-10-09 裁定：**不得以被检模块自报为据**）：
  //   证据 = 上面 `callCounts`（我们自己包装的**模块边界计数器**），**不读** `verified`。
  //   历史：改前本段读 `verified` 记账 ⇒ 复核员 M4 证明「保留记账、删真实调用」仍 `failures=0`（判据缺陷）。
  //   改后：计数发生在我们的包装里 ⇒ 只记账不调用者计数恒 0 ⇒ 该变异**由构造即红**。
  for (const e of loadable) {
    const loader = e.loader;
    if (loader === undefined) continue;
    const item = report.results.find((r) => r.type === e.type);
    if (item === undefined) {
      fail(`CALL: 报告中缺 ${e.type}`);
      continue;
    }
    // 🔴 本段**不读** `report.results[].verified` 作为证据 —— 那是被检模块自报，可被「只记账不调用」伪造。
    //   （`report` 仅用于 attempted/loaded/degraded 与错误明细。）
    const need = [
      { spec: loader.module, fn: loader.init },
      ...(loader.verify ?? []).map((s) => ({ spec: s.module ?? loader.module, fn: s.fn })),
    ];
    const cold = need.filter((n) => (callCounts.get(`${n.spec}#${n.fn}`) ?? 0) < 1);
    if (cold.length > 0) {
      fail(
        `CALL(独立观测): ${e.type} 的 ${cold.map((n) => n.fn).join(', ')} 模块边界计数 = 0 —— 未被真实调用` +
          `（被检模块自报 verified=[${item?.verified.join(',') ?? '-'}] **不构成证据**）`,
      );
    } else {
      ok(
        `${e.type.padEnd(16)} 模块边界计数 = [${need.map((n) => `${n.fn}:${callCounts.get(`${n.spec}#${n.fn}`)}`).join(', ')}]`,
      );
    }
  }

  // business-models「接活」项 —— 本卡对 4 项不可达之一的裁决，须留**独立观测**的 L2 证据
  const bmCalls = callCounts.get('../l3/business-model-loader#loadBusinessModels') ?? 0;
  if (bmCalls < 1) {
    fail('CALL(独立观测): business-model 的 loadBusinessModels 模块边界计数 = 0（接活未真实发生）');
  } else {
    ok(`business-model 接活生效：模块边界计数 = ${bmCalls}（独立观测，非自报）`);
  }

  // 副作用**产出真实性**（独立读取，不经 registry）。
  // ⚠️ 口径诚实标注：本项**不**用于证明 init 被调用 —— loader 有内部缓存，无论 init 是否跑过，
  //    此处调用都从磁盘加载并返回同样条数 ⇒ **对 M4 变异不敏感**。它只证明「实现可用 + 产出非空」；
  //    「调用是否发生」由上面的模块边界计数负责。
  const bmMod: Record<string, unknown> = await import(
    pathToFileURL(modulePathOf(repoRoot, '../l3/business-model-loader')).href
  );
  const loadBm = bmMod.loadBusinessModels;
  if (typeof loadBm !== 'function') {
    fail('CALL: business-model-loader 缺 loadBusinessModels 导出');
  } else {
    const out = (loadBm as () => { models?: unknown[] })();
    const n = Array.isArray(out.models) ? out.models.length : 0;
    if (n < 1) fail(`CALL: business-model 副作用产出为空（models=${n}）`);
    else ok(`business-model 副作用产出真实：models=${n}（产出真实性，非调用证据）`);
  }

  // 显式化项必须在报告外（retired/pending-cto 不装配）
  const notWired = snapshot.entries.filter((e) => e.status !== 'reachable').map((e) => e.type);
  const leaked = report.results.map((r) => r.type).filter((t) => notWired.includes(t));
  if (leaked.length > 0) fail(`CALL: 非 reachable 项被装配: ${leaked.join(', ')}`);
  else ok(`非 reachable 项未入装配: ${notWired.join(', ')}`);

  // V2: 唯一真源 —— file-driven-loaders.ts 直连 loader import 必须为 0
  const fdlPath = join(repoRoot, 'src', 'init', 'file-driven-loaders.ts');
  if (!existsSync(fdlPath)) {
    fail(`V2: 缺文件 ${fdlPath}`);
  } else {
    const code = readFileSync(fdlPath, 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n');
    const hits = code.match(/await import\('[^']*-loader'\)/g) ?? [];
    if (hits.length > 0) fail(`V2: file-driven-loaders.ts 仍有直连 loader import: ${hits.join(', ')}`);
    else ok('V2: file-driven-loaders.ts 直连 loader import = 0');
    if (!code.includes("await import('../deploy/content-registry')")) {
      fail('V2: file-driven-loaders.ts 未接 content-registry');
    } else {
      ok('V2: file-driven-loaders.ts 唯一装配入口 = content-registry');
    }
  }

  // ═══ SUMMARY ═══
  console.log(`\nSUMMARY: sections=${SECTIONS.length} failures=${FAILURES.length}`);
  if (FAILURES.length > 0) {
    console.log('FAILURES:');
    for (const f of FAILURES) console.log(`  - ${f}`);
    return 1;
  }
  console.log('CONTENT-REGISTRY-OK: 四段全绿（PRESENCE/INTEGRITY/RESOLVE/CALL）');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`[FAIL] probe-bootstrap 未捕获异常: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(2);
  });
