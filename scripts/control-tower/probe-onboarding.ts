#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-onboarding.ts — K12-03（#186）建档通道「文档进 → 配置出」探针
 *
 * 判据来源（卡面逐字，不是转述）:
 *   · 库外档案 `~/Synova-过程档案/本地卡面/K12-一致性线-卡面全套.md` 的 `#186 → K12-03` 段
 *   · 判据命令（卡面 Done 标准原文）: `npx tsx scripts/control-tower/probe-onboarding.ts --dry-run`（expectExit 0）
 *   · Q3 条目（逐字抄录）:
 *       V1 `probe-onboarding.ts --dry-run` ⇒ exit 0
 *       V2 穿生产入口：喂真实花名册 + 组织架构图夹具 ⇒ 文件系统真出现 extensions/presets/roles/{id}/ ≥2 个角色目录
 *       V3 零表单：路由清单里无 onboarding 的表单 GET 页
 *       V4 fail-closed：文档没写的权限 ⇒ 默认不给；超管确认有物理留痕
 *       V5 反例：短路「超管确认」（自动确认）⇒ V4 必红
 *       V6 与首次诊断同窗：公司层信息复用诊断结果（不重复问 BP/公司简介）
 *
 * 契约（铁律 47）:
 *   @input  — 无参 或 `--dry-run`（卡面判据命令原文，经 aliases 归一为场景 `dry-run`）
 *             ｜`--case <场景>`｜`--all`；场景集 = KNOWN_CASES（见下）
 *   @output — stdout 逐条 `✅ PASS` / `❌ FAIL` / `⚠️ 未实现` / `⚠️ UNVERIFIED`，
 *             每条断言显式带级别 `[L1-静态可达]` 或 `[L2-真跑通]`；
 *             末行由 `out.finish()` 单点签发 `RESULT=<verdict>`（探针自己不打 RESULT）
 *   @degraded — 目标件缺失 ⇒ 逐条记 `⚠️ 未实现` 后 exit 2（fail-closed；卡面 §Q1「未实现 ⇒ 不许绿」）；
 *               生产入口请求体契约未定义、夹具缺失等「无法核实」情形 ⇒ 记 UNVERIFIED 并降为 exit 2
 *               （判例 V-09：不计 PASS，也不谎报 FAIL）
 * 退出码: 0 = 全部 PASS ｜ 1 = 有 FAIL（目标件在但断言不成立）｜ 2 = 目标能力未实现 或 探针自身无法判定
 *
 * 🔴 存在性闸口径（与派单摘要不一致，如实标注，勿按摘要改回）:
 *   本卡 Q2 写集 = `src/onboarding/` 与 `src/routes/onboarding.ts`；
 *   `extensions/onboarding/` 是 **K12-02 的写集**，本卡 Q2 明写「不改 extensions/onboarding/**」。
 *   ⇒ 若把 `extensions/onboarding/` 当本卡存在性闸，K12-03 完成后探针仍会恒红（永不通过 = 另一种假信号）。
 *   故闸门只取本卡**自己的可交付件**；他卡载体仅作参考行打印（存在与否都不影响判定）。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 依赖（全部走生产真件：路由模块、认证中间件、仓库真文件系统）
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import express, { type Router } from 'express';
import { jwtAuthMiddleware } from '../../src/middleware/auth';
import {
  ProbeOutput,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  ProbeError,
  type ProbeModule,
} from './probe-ladder';

/** 本探针的全部场景（ladder 会读常量做取证；`--all` 即按本表逐条跑） */
export const KNOWN_CASES: readonly string[] = [
  'dry-run',
  'apply',
  'zero-form',
  'fail-closed',
  'diagnosis-window',
] as const;

/** 判据命令是裸 `--dry-run` 形态 —— 归一为场景名（parseProbeArgs 的 aliases 通道） */
const CASE_ALIASES: Readonly<Record<string, string>> = { '--dry-run': 'dry-run' };

/**
 * 本探针判据所依赖的目标件（仓库相对路径）——供 ladder 的不变式「报 PASS ⇒ TARGETS 非空且全部存在」机械校验。
 *
 * 🔴 口径（与派单「只写现存路径」不同，**按不变式精神取更强声明**，理由如下）:
 *   不变式只在**报 PASS 这一态**生效（`probe-ladder.ts:532` 的 `if (verdict !== 'PASS') return null;`
 *   ＋ `tests/control-tower/probe-contract.test.sh:194` 同源判定）⇒ 声明当前不存在的路径**不会**判 ERROR；
 *   而"只声明现存但不相关的件"（如 src/middleware/auth.ts）会让不变式**失去牙齿**：
 *   本探针即便在 src/onboarding/** 全缺的情况下报绿，也照样满足它 —— 那正是本次补强要堵的自洽假绿。
 *   ∴ 这里声明的是「**本探针一旦报 PASS 就必然存在**」的那一组：存在性闸 GATE_TARGETS（任一缺失即 exit 2，
 *   故 PASS 不可达）＋ 每个场景都真加载的生产中间件。
 *   ⇒ 声明绝不会误判 ERROR（PASS 蕴含它们全部存在），且假绿必然被抓住。
 */
export const TARGETS: readonly string[] = ['src/routes/onboarding.ts', 'src/onboarding/onboarding-flow.ts', 'src/onboarding/config-pack-generator.ts', 'src/middleware/auth.ts'];

/**
 * 存在性闸 —— **只放本卡自己的可交付件**（见文件头「存在性闸口径」）。
 * 逐条对应卡面 Q2 写集，缺任一即判本卡未实现。
 */
const GATE_TARGETS: readonly string[] = [
  'src/routes/onboarding.ts',
  'src/onboarding/onboarding-flow.ts',
  'src/onboarding/config-pack-generator.ts',
];

/** 他卡载体 —— 只打印、不作闸（缺失不代表本卡未实现） */
const INFORMATIONAL: readonly string[] = [
  'extensions/onboarding',
  'extensions/presets/roles',
  'extensions/presets/grants',
];

/** V2 的落盘观测点（卡面原文：extensions/presets/roles/{id}/ ≥2 个角色目录） */
const ROLES_DIR = 'extensions/presets/roles';

/** V2 夹具（卡面原文：真实花名册 + 组织架构图） */
const FIXTURE_DIR = '.claude/fixtures/onboarding';
const FIXTURE_FILES: readonly string[] = ['roster.md', 'orgchart.md'];

/** 卡面 Q3 六条判据 —— 目标件缺失时逐条记为「未实现」，保证不假绿 */
const V_ITEMS: ReadonlyArray<{ id: string; text: string }> = [
  { id: 'V1', text: '--dry-run ⇒ exit 0（卡面判据命令原文）' },
  { id: 'V2', text: '穿生产入口喂夹具 ⇒ 文件系统真出现 extensions/presets/roles/{id}/ ≥2 个角色目录' },
  { id: 'V3', text: '零表单：路由清单里无 onboarding 的表单 GET 页' },
  { id: 'V4', text: 'fail-closed：文档没写的权限 ⇒ 默认不给；超管确认有物理留痕' },
  { id: 'V5', text: '反例：短路「超管确认」（自动确认）⇒ V4 必红' },
  { id: 'V6', text: '与首次诊断同窗：公司层信息复用诊断结果（不重复问 BP/公司简介）' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 小工具（本文件自足；不新起共享文件——写集只含本文件）
// ─────────────────────────────────────────────────────────────────────────────

/** 探针契约形状自检（铁律 47）：不满足 ladder 的 ProbeModule 形状 ⇒ tsc 编译期即红 */
function contractShapeOk(mod: ProbeModule): boolean {
  return Array.isArray(mod.KNOWN_CASES) && mod.KNOWN_CASES.length > 0 && typeof mod.main === 'function';
}

/** Express 路由层的最小结构（只读注册表，不依赖 express 内部类型） */
interface RouteLayer {
  route?: { path?: string; methods?: Record<string, boolean> };
}
interface RouterWithStack {
  stack?: RouteLayer[];
}

/**
 * 运行时收窄成带注册表的 Router —— 用内联结构类型 + 显式校验（铁律 38 允许的形态，不用任何被禁的类型断言）。
 * 🔴 必须同时接受 `object` 与 `function`：express 的 Router **本体是函数**
 *    （`function router(req,res,next)`），只判 `typeof === 'object'` 会把真 Router 挡在门外。
 */
function asRouter(value: unknown, relPath: string): Router {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new ProbeError('ROUTE_MODULE_SHAPE', 'load', `${relPath} 的 default 导出既非对象也非函数（不是 express Router）`);
  }
  const candidate = value as RouterWithStack;
  if (!Array.isArray(candidate.stack)) {
    throw new ProbeError(
      'ROUTE_MODULE_SHAPE',
      'load',
      `${relPath} 的 default 导出读不到路由注册表（stack 非数组）⇒ 无法枚举真实路由`,
    );
  }
  return value as Router;
}

/** 真加载生产路由模块（L1 证据：模块真被 import，注册表真被读到 —— 不是 grep） */
async function loadRouter(root: string, relPath: string): Promise<Router> {
  const mod = (await import(pathToFileURL(join(root, relPath)).href)) as { default?: unknown };
  return asRouter(mod.default, relPath);
}

/** 路由注册表 → { method, path } 清单（顺序稳定，保证 V5「可复跑」） */
function listRoutes(router: Router): Array<{ method: string; path: string }> {
  const candidate = router as RouterWithStack;
  const out: Array<{ method: string; path: string }> = [];
  for (const layer of candidate.stack ?? []) {
    const route = layer.route;
    if (!route?.path) continue;
    for (const method of Object.keys(route.methods ?? {})) {
      out.push({ method: method.toUpperCase(), path: route.path });
    }
  }
  return out;
}

/** 目录下的子目录名（目录不存在 ⇒ 空数组，不抛） */
function subdirs(root: string, relPath: string): string[] {
  const abs = join(root, relPath);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * 「无法核实」的统一出口：既留 UNVERIFIED（判例 V-09 的显式披露），
 * 又记 NOT_IMPLEMENTED 让退出码保持 fail-closed（不许出现「无从判定却 exit 0」的假绿）。
 */
function cannotJudge(out: ProbeOutput, id: string, reason: string): void {
  out.unverified(`${id} 无法核实: ${reason}`);
  out.notImplemented(`${id} 判据不可判定（fail-closed ⇒ exit 2，不许假绿）`);
}

/**
 * 起真 HTTP 服务（穿生产入口；铁律 12：集成测试走真实路由，不替管线打桩）。
 * @input  — 真 Router（生产模块导出）+ 真认证中间件
 * @output — 回调收到 `http://127.0.0.1:<临时端口>`
 * @degrade— 端口占用/启动失败 ⇒ 抛 ProbeError（由 main 统一转 exit 2）
 */
async function withServer(router: Router, fn: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(router);
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', (err: Error) =>
        reject(new ProbeError('SERVER_LISTEN_FAILED', 'http', err.message, true)),
      );
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    if (port === 0) throw new ProbeError('SERVER_PORT_UNKNOWN', 'http', 'listen(0) 未返回端口', true);
    await fn(`http://127.0.0.1:${String(port)}`);
  } finally {
    server.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 逐场景检查
// ─────────────────────────────────────────────────────────────────────────────

/** V1：dry-run 能跑通且**不落盘**（卡面判据命令原文） */
async function checkDryRun(root: string, out: ProbeOutput): Promise<void> {
  const router = await loadRouter(root, 'src/routes/onboarding.ts');
  const routes = listRoutes(router);
  out.note(`  真实注册路由 ${String(routes.length)} 条: ${routes.map((r) => `${r.method} ${r.path}`).join(' | ') || '(空)'}`);

  const posts = routes.filter((r) => r.method === 'POST');
  if (posts.length === 0) {
    out.fail('路由模块未注册任何 POST 路由 ⇒ 建档入口不可达（卡面入口: POST /api/onboarding/*）', 'L1');
    return;
  }
  out.pass(`路由模块真加载并注册 POST 路由 ${String(posts.length)} 条（入口可达）`, 'L1');

  const before = subdirs(root, ROLES_DIR).length;
  let status: number | null = null;
  await withServer(router, async (base) => {
    const res = await fetch(`${base}${posts[0].path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: true, documents: [] }),
    });
    out.note(`  POST ${posts[0].path} (dry-run) ⇒ HTTP ${String(res.status)}`);
    status = res.status;
  });

  if (status === null || status >= 400) {
    cannotJudge(out, 'V1', `dry-run 请求被 HTTP ${String(status)} 拒（请求体契约未在卡面定义，无法区分「形状不符」与「能力缺失」）`);
    return;
  }
  out.pass(`dry-run 请求 HTTP ${String(status)}（2xx/3xx，未拒）`, 'L2');

  const after = subdirs(root, ROLES_DIR).length;
  if (after === before) {
    out.pass(`dry-run 未落盘: ${ROLES_DIR} 目录数 ${String(before)} → ${String(after)}（卡面: dry-run 不应写文件）`, 'L2');
  } else {
    out.fail(`dry-run 竟然落盘: ${ROLES_DIR} 目录数 ${String(before)} → ${String(after)}`, 'L2');
  }
}

/** V2：穿生产入口喂夹具 ⇒ 文件系统真出现 ≥2 个角色目录 */
async function checkApply(root: string, out: ProbeOutput): Promise<void> {
  const missingFixtures = FIXTURE_FILES.filter((f) => !existsSync(join(root, FIXTURE_DIR, f)));
  if (missingFixtures.length > 0) {
    cannotJudge(out, 'V2', `夹具缺失: ${missingFixtures.map((f) => `${FIXTURE_DIR}/${f}`).join(', ')}（卡面要求喂真实花名册 + 组织架构图）`);
    return;
  }
  const router = await loadRouter(root, 'src/routes/onboarding.ts');
  const posts = listRoutes(router).filter((r) => r.method === 'POST');
  if (posts.length === 0) {
    out.fail('路由模块未注册任何 POST 路由 ⇒ 无法穿生产入口喂夹具', 'L1');
    return;
  }
  await withServer(router, async (base) => {
    const res = await fetch(`${base}${posts[0].path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: false, documents: FIXTURE_FILES.map((f) => `${FIXTURE_DIR}/${f}`) }),
    });
    out.note(`  POST ${posts[0].path} (apply) ⇒ HTTP ${String(res.status)}`);
    if (res.status >= 400) {
      cannotJudge(out, 'V2', `apply 请求被 ${String(res.status)} 拒（请求体契约未在卡面定义）`);
    }
  });
  const roles = subdirs(root, ROLES_DIR);
  if (roles.length >= 2) {
    out.pass(`文件系统真出现 ${String(roles.length)} 个角色目录（≥2）: ${roles.join(', ')}`, 'L2');
  } else {
    out.fail(`文件系统只出现 ${String(roles.length)} 个角色目录（<2，卡面要求 ≥2）: ${roles.join(', ') || '(空)'}`, 'L2');
  }
}

/** V3：零表单 —— 真实注册的 GET 路由里没有返回 HTML 表单的页 */
async function checkZeroForm(root: string, out: ProbeOutput): Promise<void> {
  const router = await loadRouter(root, 'src/routes/onboarding.ts');
  const routes = listRoutes(router);
  if (routes.filter((r) => r.method === 'POST').length === 0) {
    out.fail('路由模块未注册任何 POST 路由 ⇒ 「零表单」判据失去意义（入口本身不存在）', 'L1');
    return;
  }
  const gets = routes.filter((r) => r.method === 'GET');
  out.note(`  真实注册 GET 路由: ${gets.map((g) => g.path).join(', ') || '(0 条)'}`);

  let htmlPages = 0;
  await withServer(router, async (base) => {
    for (const g of gets) {
      const res = await fetch(`${base}${g.path}`);
      const ctype = res.headers.get('content-type') ?? '';
      out.note(`  GET ${g.path} ⇒ HTTP ${String(res.status)} content-type=${ctype || '(无)'}`);
      if (ctype.includes('text/html')) htmlPages += 1;
    }
  });
  if (htmlPages === 0) {
    out.pass(`零表单: ${String(gets.length)} 条 GET 路由中返回 text/html 的页 = 0（卡面: 不做配置后台）`, 'L2');
  } else {
    out.fail(`发现 ${String(htmlPages)} 个返回 text/html 的 GET 页 ⇒ 违反「零表单」红线`, 'L2');
  }
}

/** V4：fail-closed（文档没写的不给）+ 超管确认有物理留痕 */
async function checkFailClosed(root: string, out: ProbeOutput): Promise<void> {
  const roles = subdirs(root, ROLES_DIR);
  if (roles.length === 0) {
    cannotJudge(out, 'V4', `${ROLES_DIR} 无任何角色目录 ⇒ 无矩阵可比对「文档没写的不给」`);
    return;
  }
  const rosterPath = join(root, FIXTURE_DIR, FIXTURE_FILES[0]);
  if (!existsSync(rosterPath)) {
    cannotJudge(out, 'V4', `花名册夹具缺失（${FIXTURE_DIR}/${FIXTURE_FILES[0]}）⇒ 无法推导「文档里写了哪些岗位」`);
    return;
  }
  // 仅做「已产出角色 ⊆ 花名册岗位」这一条可机器判的边；确认留痕的格式由本卡自定义，卡面未给 schema
  out.note(`  已产出角色目录 ${String(roles.length)} 个: ${roles.join(', ')}`);
  cannotJudge(out, 'V4', '超管确认留痕的载体与 schema 未在卡面定义（谁/何时/确认哪几条只有 K12-12 侧给了口径）⇒ 本探针不臆造字段名');
}

/** V5：反例（短路超管确认）——需 V4 可判才成立 */
async function checkCounterexample(out: ProbeOutput): Promise<void> {
  cannotJudge(out, 'V5', 'V4 尚无判定（超管确认留痕不可核实）⇒ 反例缺少可改坏的判据锚点');
}

/** V6：与首次诊断同窗（公司层信息复用诊断结果） */
async function checkDiagnosisWindow(out: ProbeOutput): Promise<void> {
  cannotJudge(out, 'V6', '依赖 K12-04 `gap-questioner`（未落地）与诊断结果复用契约；卡面未给函数签名 ⇒ 不臆造接口');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

/** 场景名 → 检查函数（未知场景不回落默认，见 parseProbeArgs 的 UNKNOWN_CASE） */
async function runCase(name: string, root: string, out: ProbeOutput): Promise<void> {
  switch (name) {
    case 'dry-run':
      return checkDryRun(root, out);
    case 'apply':
      return checkApply(root, out);
    case 'zero-form':
      return checkZeroForm(root, out);
    case 'fail-closed':
      // V4 与 V5 是同一条判据的两面（V5 = V4 的反例），**必须同场景连跑**，
      // 否则「短路超管确认 ⇒ V4 必红」这半条永远没人执行（= 判据形同不存在）。
      await checkFailClosed(root, out);
      await checkCounterexample(out);
      return;
    case 'diagnosis-window':
      return checkDiagnosisWindow(out);
    default:
      cannotJudge(out, name, `本探针无场景「${name}」`);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('probe-onboarding（K12-03 / #186 · 建档通道）');
  try {
    if (!contractShapeOk({ KNOWN_CASES, main })) {
      out.error('探针契约形状自检失败（KNOWN_CASES 或 main 形状不符）');
      out.finish();
      return 2;
    }

    const root = locateRepoRoot();
    const args = parseProbeArgs(KNOWN_CASES, argv, CASE_ALIASES);

    out.note('判据来源: 库外档案 #186 → K12-03 §Q3（V1–V6）｜判据命令原文: probe-onboarding.ts --dry-run');
    out.note(`仓库根: ${root}`);
    out.note(`场景: ${args.all ? `--all（${String(args.cases.length)} 个）` : args.cases.join(', ')}`);

    for (const p of INFORMATIONAL) {
      out.note(`  · 参考件 ${p} ⇒ ${existsSync(join(root, p)) ? '存在' : '不存在'}（他卡载体，不作本卡闸门）`);
    }

    if (!assertTargetsExist(root, out, [...GATE_TARGETS])) {
      for (const item of V_ITEMS) out.notImplemented(`${item.id} ${item.text}`);
      out.note('原因: 本卡目标件缺失 ⇒ §Q3 六条 V 判据均无法判定（卡面 §Q1: 未实现必须 exit 2，不许假绿）');
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
    // 铁律 24/32: 探针自身异常不得静默 —— 显式输出 + 独立退出码
    const pe =
      err instanceof ProbeError
        ? err
        : new ProbeError(
            'PROBE_ONBOARDING_UNEXPECTED',
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
if (process.argv[1] && /probe-onboarding\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(String(err));
      process.exit(2);
    },
  );
}
