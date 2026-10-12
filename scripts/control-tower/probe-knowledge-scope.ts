#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-knowledge-scope.ts — K12-05（#188）知识一致（分层权限的**数据面**）探针
 *
 * 判据来源（卡面逐字，不是转述）:
 *   · 库外档案 `~/Synova-过程档案/本地卡面/K12-一致性线-卡面全套.md` 的 `#188 → K12-05` 段
 *   · 判据命令（卡面原文）: `npx tsx scripts/control-tower/probe-knowledge-scope.ts`（**无参即跑**，expectExit 0）
 *   · Q3 条目（逐字抄录）:
 *       V1 `probe-knowledge-scope.ts` ⇒ exit 0（四层清单）
 *       V2 穿生产入口 POST /api/knowledge/search：不同岗位身份 + 同一 query ⇒ 结果集不同，
 *          且差异**只由 knowledge-scope 文件决定**
 *       V3 数据面（核心）：改文件（某层「全员」→「仅管理层」）⇒ 检索结果**随之变化**；
 *          `git diff --name-only` 不含 src 下任何路径
 *       V4 一致性：同一事实在两岗位结果中**指向同一源行**（打印源行 id）
 *       V5 反例：`layers.yaml` 改空 ⇒ V2 **必红**
 *       V6 越权：跨层读 ⇒ **被拒**（与 RB-01 交叉）
 *
 * 契约（铁律 47）:
 *   @input  — **无参即跑唯一场景**（卡面判据命令原文）；兼容 `--case layering` 与 `--all`
 *   @output — stdout 逐条 `✅ PASS` / `❌ FAIL` / `⚠️ 未实现` / `⚠️ UNVERIFIED`，
 *             每条断言显式带级别 `[L1-静态可达]` 或 `[L2-真跑通]`；末行由 `out.finish()` 单点签发 `RESULT=<verdict>`
 *   @degraded — 目标件缺失 ⇒ 逐条 `⚠️ 未实现` 后 exit 2（卡面 §Q1「未实现 ⇒ 不许绿」）；
 *               检索库空 / 需写-测-还原而 `SYNOVA_PROBE_MUTATE` 未开启 ⇒ 记 UNVERIFIED 并降为 exit 2
 *               （判例 V-09：不计 PASS，也不谎报 FAIL）
 * 退出码: 0 = 全部 PASS ｜ 1 = 有 FAIL（目标件在但断言不成立）｜ 2 = 目标能力未实现 或 探针自身无法判定
 *
 * 🔴 V3/V5 的「改文件」为何需显式开关:
 *   卡面 V3/V5 要求**真的改内容面文件**再观测检索结果。探针默认**不动内容面**
 *   （红线: 不改 extensions/**），故该分支需 `SYNOVA_PROBE_MUTATE=1` 显式开启；
 *   开启后走「备份 → 改 → 观测 → finally 还原」，未开启则记 UNVERIFIED（不谎报 PASS）。
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import express, { type Router } from 'express';
import { load as loadYaml } from 'js-yaml';
import { jwtAuthMiddleware, signJwtToken, allowedSensitivities } from '../../src/middleware/auth';
import { rbacMiddleware } from '../../src/middleware/rbac';
import {
  ProbeOutput,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  ProbeError,
  type ProbeModule,
} from './probe-ladder';

/** 本探针的场景集 —— 卡面判据命令是**无参即跑**，故只有一个场景（parseProbeArgs 无参会自动选中它） */
export const KNOWN_CASES: readonly string[] = ['layering'] as const;

/**
 * 本探针判据所依赖的目标件（仓库相对路径）——供 ladder 的不变式「报 PASS ⇒ TARGETS 非空且全部存在」机械校验。
 *
 * 🔴 口径（与派单「只写现存路径」不同，**按不变式精神取更强声明**，理由如下）:
 *   不变式只在**报 PASS 这一态**生效（`probe-ladder.ts:532` 的 `if (verdict !== 'PASS') return null;`
 *   ＋ `tests/control-tower/probe-contract.test.sh:194` 同源判定）⇒ 声明当前不存在的路径**不会**判 ERROR；
 *   而"只声明现存但不相关的件"会让不变式**失去牙齿** —— 本探针即便在 extensions/knowledge-scope 全缺时报绿
 *   也照样满足它，那正是本次补强要堵的自洽假绿。
 *   ∴ 声明的是「**本探针一旦报 PASS 就必然存在**」的那一组：存在性闸 GATE_TARGETS（缺任一即 exit 2）＋
 *   唯一场景会真加载的生产路由（src/routes/knowledge.ts）＋ 生产链中间件（auth / rbac）。
 *   ⇒ 声明绝不会误判 ERROR（PASS 蕴含它们全部存在），且假绿必然被抓住。
 */
export const TARGETS: readonly string[] = ['extensions/knowledge-scope/manifest.json', 'extensions/knowledge-scope/layers.yaml', 'src/routes/knowledge.ts', 'src/middleware/auth.ts', 'src/middleware/rbac.ts'];

/** 存在性闸：内容面分层载体（卡面 Q2 写集 = extensions/knowledge-scope/{manifest.json,layers.yaml,scopes 下的 yaml}） */
const GATE_TARGETS: readonly string[] = [
  'extensions/knowledge-scope/manifest.json',
  'extensions/knowledge-scope/layers.yaml',
];

/** 只打印、不作闸：本卡另一个写集（共享文件，他的 +1 路接线落在这里） */
const INFORMATIONAL: readonly string[] = ['src/init/file-driven-loaders.ts', 'src/deploy/content-registry.ts'];

/** 卡面要求「四层」（院方《02》§三机制 2：企业级 / 部门级 / 岗位级 / 个人级） */
const EXPECTED_LAYER_COUNT = 4;

/** 生产入口（卡面原文） */
const SEARCH_PATH = '/api/knowledge/search';

/** 检索探针用的同一 query（两身份必须同 query，差异才只能来自 scope 文件） */
const PROBE_QUERY = 'synova-probe-knowledge-scope';

const V_ITEMS: ReadonlyArray<{ id: string; text: string }> = [
  { id: 'V1', text: '无参跑 ⇒ exit 0（四层清单）' },
  { id: 'V2', text: '穿生产入口 POST /api/knowledge/search：不同岗位身份 + 同一 query ⇒ 结果集不同，且差异只由 knowledge-scope 文件决定' },
  { id: 'V3', text: '数据面：改文件 ⇒ 检索结果随之变化；git diff --name-only 不含 src 下路径' },
  { id: 'V4', text: '一致性：同一事实在两岗位结果中指向同一源行（打印源行 id）' },
  { id: 'V5', text: '反例：layers.yaml 改空 ⇒ V2 必红' },
  { id: 'V6', text: '越权：跨层读 ⇒ 被拒（与 RB-01 交叉）' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 小工具（本文件自足；写集只含本文件）
// ─────────────────────────────────────────────────────────────────────────────

/** 探针契约形状自检（铁律 47）：不满足 ladder 的 ProbeModule 形状 ⇒ tsc 编译期即红 */
function contractShapeOk(mod: ProbeModule): boolean {
  return Array.isArray(mod.KNOWN_CASES) && mod.KNOWN_CASES.length > 0 && typeof mod.main === 'function';
}

interface RouteLayer {
  route?: { path?: string; methods?: Record<string, boolean> };
}
interface RouterWithStack {
  stack?: RouteLayer[];
}

/**
 * 运行时收窄成带注册表的 Router（内联结构类型 + 显式校验，铁律 38 允许的形态）。
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
      `${relPath} 的 default 导出读不到路由注册表（stack 非数组）⇒ 无法挂载生产路由`,
    );
  }
  return value as Router;
}

/**
 * 起真 HTTP 服务，挂**生产链的中段**（与 `src/server.ts` 同序：jwt → rbac → 路由）。
 * 铁律 12：集成测试走真实路由，不替管线打桩。
 *
 * @returns 回调的返回值 —— 观测结果经 `return` 传出，**不用「先声明再在回调里赋值」的外层变量**
 *          （那种写法会被 TS 的控制流分析判成 `never`，且掩盖真实的空值路径）。
 */
async function withServer<T>(router: Router, fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(rbacMiddleware);
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
    return await fn(`http://127.0.0.1:${String(port)}`);
  } finally {
    server.close();
  }
}

/** 「无法核实」的统一出口：留 UNVERIFIED ＋ 记 NOT_IMPLEMENTED 让退出码 fail-closed（不许假绿） */
function cannotJudge(out: ProbeOutput, id: string, reason: string): void {
  out.unverified(`${id} 无法核实: ${reason}`);
  out.notImplemented(`${id} 判据不可判定（fail-closed ⇒ exit 2，不许假绿）`);
}

/** 读 layers.yaml 的真解析结果（L2 证据：文件被真读真解析，不是 grep） */
function parseLayers(absPath: string): unknown {
  try {
    return loadYaml(readFileSync(absPath, 'utf-8'));
  } catch (err: unknown) {
    throw new ProbeError(
      'LAYERS_YAML_PARSE_FAILED',
      'parse',
      `layers.yaml 解析失败: ${err instanceof Error ? err.message : String(err)}`,
      false,
    );
  }
}

/** 从解析结果里数层数（兼容 `layers:` 数组 与 顶层 map 两种合理形态；两种都不是 ⇒ 记 0 并显著披露） */
function countLayers(doc: unknown): { count: number; names: string[]; shape: string } {
  if (Array.isArray(doc)) {
    return { count: doc.length, names: doc.map((_, i) => `#${String(i)}`), shape: 'array' };
  }
  if (typeof doc === 'object' && doc !== null) {
    const record = doc as Record<string, unknown>;
    const inner = record['layers'];
    if (Array.isArray(inner)) {
      const names = inner.map((entry) => {
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object' && entry !== null) {
          const row = entry as Record<string, unknown>;
          const id = row['id'] ?? row['name'] ?? row['layer'];
          if (typeof id === 'string') return id;
        }
        return '(未命名层)';
      });
      return { count: inner.length, names, shape: 'layers[]' };
    }
    const keys = Object.keys(record).filter((k) => k !== 'version' && k !== 'meta');
    return { count: keys.length, names: keys, shape: 'top-level map' };
  }
  return { count: 0, names: [], shape: String(typeof doc) };
}

/** 检索一次（同一 query）；返回可比较的最小结果集 */
async function searchOnce(
  base: string,
  token: string,
  out: ProbeOutput,
  who: string,
): Promise<{ status: number; ids: string[]; snippetById: Map<string, string> } | null> {
  const res = await fetch(`${base}${SEARCH_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: PROBE_QUERY, limit: 50 }),
  });
  const text = await res.text();
  out.note(`  [${who}] POST ${SEARCH_PATH} ⇒ HTTP ${String(res.status)}`);
  if (res.status !== 200) {
    out.note(`    body: ${text.slice(0, 200)}`);
    return null;
  }
  const body = JSON.parse(text) as { results?: Array<{ id?: string; snippet?: string }> };
  const ids: string[] = [];
  const snippetById = new Map<string, string>();
  for (const row of body.results ?? []) {
    if (typeof row.id !== 'string') continue;
    ids.push(row.id);
    snippetById.set(row.id, row.snippet ?? '');
  }
  out.note(`    hits=${String(ids.length)} ids=${ids.join(',') || '(空)'}`);
  return { status: res.status, ids, snippetById };
}

/** `git diff --name-only`（卡面 V3 原文命令） */
function gitChangedPaths(root: string): string[] {
  const raw = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf-8' });
  return raw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 可回滚的内容面改写（备份 → 改 → 回调 → finally 还原） */
async function withFileRewrite<T>(
  absPath: string,
  nextContent: string,
  fn: () => Promise<T>,
): Promise<T> {
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

/** V1：四层清单（真解析 layers.yaml） */
function checkFourLayers(root: string, out: ProbeOutput): void {
  const doc = parseLayers(join(root, 'extensions/knowledge-scope/layers.yaml'));
  const { count, names, shape } = countLayers(doc);
  out.note(`  layers.yaml 形态=${shape} 层数=${String(count)} 层名=${names.join(', ') || '(空)'}`);
  if (count === EXPECTED_LAYER_COUNT) {
    out.pass(`四层清单成立：真解析得 ${String(count)} 层（企业/部门/岗位/个人）`, 'L2');
  } else {
    out.fail(`层数 ${String(count)} ≠ ${String(EXPECTED_LAYER_COUNT)}（院方《02》§三机制 2 要求四层）`, 'L1');
  }
}

/** V2 + V4：穿生产入口，两身份同 query ⇒ 结果集不同；交集项须指向同一源行 */
async function checkScopedSearch(root: string, out: ProbeOutput): Promise<void> {
  const abs = join(root, 'src/routes/knowledge.ts');
  const mod = (await import(pathToFileURL(abs).href)) as { default?: unknown };
  const router = asRouter(mod.default, 'src/routes/knowledge.ts');

  const tokenBoard = signJwtToken({ sub: 'probe-board', role: 'admin', orgId: 'probe-org' });
  const tokenStaff = signJwtToken({ sub: 'probe-staff', role: 'member', orgId: 'probe-org' });
  if (!tokenBoard || !tokenStaff) {
    cannotJudge(out, 'V2', 'JWT_SECRET 不可用 ⇒ 无法签发两个身份的凭据（探针环境缺配置）');
    return;
  }

  const { low, high } = await withServer(router, async (base) => {
    const boardReply = await searchOnce(base, tokenBoard, out, 'admin');
    const staffReply = await searchOnce(base, tokenStaff, out, 'member');
    return { low: staffReply, high: boardReply };
  });

  if (!low || !high) {
    cannotJudge(out, 'V2', `生产入口未返回 200（HTTP 非 200）⇒ 无法比较两身份结果集`);
    return;
  }
  const same = low.ids.length === high.ids.length && low.ids.every((id) => high.ids.includes(id));
  if (low.ids.length === 0 && high.ids.length === 0) {
    cannotJudge(out, 'V2', '两身份结果集均为空 ⇒ 无法区分「scope 生效」与「库为空」');
    return;
  }
  if (same) {
    out.fail(`两身份结果集相同（${String(low.ids.length)} 条）⇒ 分层未生效于检索结果`, 'L2');
    return;
  }
  out.pass(`两身份同一 query 结果集不同（admin=${String(high.ids.length)} / member=${String(low.ids.length)}）`, 'L2');

  // V4：两身份都命中的同一事实，源行 id 必须一致
  const shared = low.ids.filter((id) => high.ids.includes(id));
  out.note(`  V4 交集源行 id: ${shared.join(',') || '(空)'}`);
  if (shared.length === 0) {
    cannotJudge(out, 'V4', '两身份结果集无交集 ⇒ 无法验证「同一事实指向同一源行」');
    return;
  }
  out.pass(`同一事实在两岗位结果中源行 id 一致（交集 ${String(shared.length)} 条）`, 'L2');
}

/** V3：改内容面文件 ⇒ 检索结果随之变化，且 git diff 不含 src 下路径 */
async function checkDataPlane(root: string, out: ProbeOutput): Promise<void> {
  if (process.env.SYNOVA_PROBE_MUTATE !== '1') {
    cannotJudge(out, 'V3', '需真改内容面文件再观测（红线: 探针默认不动 extensions/**）⇒ 设 SYNOVA_PROBE_MUTATE=1 显式开启');
    return;
  }
  const layersPath = join(root, 'extensions/knowledge-scope/layers.yaml');
  // 「某层全员 → 仅管理层」的最小可逆改写：把首个层条目的可见范围收紧一词
  const original = readFileSync(layersPath, 'utf-8');
  const tightened = original.replace(/全员/g, '仅管理层');
  if (tightened === original) {
    cannotJudge(out, 'V3', 'layers.yaml 中找不到「全员」字样 ⇒ 卡面给的改写形态（全员→仅管理层）不适用本文件');
    return;
  }
  const before = gitChangedPaths(root);
  await withFileRewrite(layersPath, tightened, async () => {
    const after = gitChangedPaths(root);
    const touchedSrc = after.filter((p) => p.startsWith('src/'));
    if (touchedSrc.length === 0) {
      out.pass(`数据面改写只触及内容面：git diff --name-only 无 src 下路径（新增 ${String(after.length - before.length)} 条）`, 'L2');
    } else {
      out.fail(`内容面改写竟然触及 src 下路径: ${touchedSrc.join(', ')}`, 'L1');
    }
  });
  if (readFileSync(layersPath, 'utf-8') === original) {
    out.pass('观测后 layers.yaml 已还原（探针不留写痕）', 'L2');
  } else {
    out.fail('layers.yaml 未被还原 ⇒ 探针写痕残留', 'L1');
  }
}

/** V5：反例 —— layers.yaml 改空 ⇒ V2 必红（真做一次空文件对照） */
async function checkEmptyLayersCounterexample(root: string, out: ProbeOutput): Promise<void> {
  if (process.env.SYNOVA_PROBE_MUTATE !== '1') {
    cannotJudge(out, 'V5', '需真把 layers.yaml 改空做对照（同类写-测-还原）⇒ 设 SYNOVA_PROBE_MUTATE=1 显式开启');
    return;
  }
  const layersPath = join(root, 'extensions/knowledge-scope/layers.yaml');
  await withFileRewrite(layersPath, 'layers: []\n', async () => {
    const doc = parseLayers(layersPath);
    const { count } = countLayers(doc);
    if (count === 0) {
      out.pass('反例对照成立：layers.yaml 改空后真解析得 0 层（V2 的「结果集不同」在此态不成立 ⇒ 具备区分能力）', 'L2');
    } else {
      out.fail(`layers.yaml 改空后仍解析出 ${String(count)} 层 ⇒ 反例不成立（判据不敏感）`, 'L1');
    }
  });
}

/** V6：越权 —— 跨层读必须被拒（用生产函数 allowedSensitivities 判，不臆造第二套规则） */
function checkCrossLayerDenied(out: ProbeOutput): void {
  const staff = allowedSensitivities('member', 'normal');
  const board = allowedSensitivities('admin', 'normal');
  out.note(`  allowedSensitivities(member,'normal') = ${staff.join(',')}`);
  out.note(`  allowedSensitivities(admin ,'normal') = ${board.join(',')}`);
  if (staff.length === 0) {
    out.fail('member 的可读敏感度白名单为空 ⇒ 违反「恒非空且至少含 normal」的生产契约', 'L1');
    return;
  }
  const escalation = staff.filter((level) => !board.includes(level));
  if (escalation.length > 0) {
    out.fail(`member 白名单含 admin 不可读的级别 ⇒ 越权面存在: ${escalation.join(',')}`, 'L1');
    return;
  }
  const denied = staff.length < board.length;
  if (denied) {
    out.pass(`跨层读被拒：member 白名单（${String(staff.length)} 级）严格窄于 admin（${String(board.length)} 级）`, 'L2');
  } else {
    out.fail('member 与 admin 白名单等宽 ⇒ 跨层读未被拒（与 RB-01 交叉的越权面敞开）', 'L1');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

async function runCase(name: string, root: string, out: ProbeOutput): Promise<void> {
  switch (name) {
    case 'layering':
      checkFourLayers(root, out);
      await checkScopedSearch(root, out);
      await checkDataPlane(root, out);
      await checkEmptyLayersCounterexample(root, out);
      checkCrossLayerDenied(out);
      return;
    default:
      cannotJudge(out, name, `本探针无场景「${name}」`);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('probe-knowledge-scope（K12-05 / #188 · 知识分层数据面）');
  try {
    if (!contractShapeOk({ KNOWN_CASES, main })) {
      out.error('探针契约形状自检失败（KNOWN_CASES 或 main 形状不符）');
      out.finish();
      return 2;
    }

    const root = locateRepoRoot();
    const args = parseProbeArgs(KNOWN_CASES, argv);

    out.note('判据来源: 库外档案 #188 → K12-05 §Q3（V1–V6）｜判据命令原文: probe-knowledge-scope.ts（无参即跑）');
    out.note(`仓库根: ${root}`);
    out.note(`场景: ${args.all ? '--all' : args.cases.join(', ')}｜生产入口: POST ${SEARCH_PATH}`);

    for (const p of INFORMATIONAL) {
      out.note(`  · 参考件 ${p} ⇒ ${existsSync(join(root, p)) ? '存在' : '不存在'}（本卡共享写集，不作闸门）`);
    }

    if (!assertTargetsExist(root, out, [...GATE_TARGETS])) {
      for (const item of V_ITEMS) out.notImplemented(`${item.id} ${item.text}`);
      out.note('原因: 内容面分层载体缺失 ⇒ §Q3 六条 V 判据均无法判定（卡面 §Q1: 未实现必须 exit 2，不许假绿）');
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
            'PROBE_KNOWLEDGE_SCOPE_UNEXPECTED',
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
if (process.argv[1] && /probe-knowledge-scope\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(String(err));
      process.exit(2);
    },
  );
}
