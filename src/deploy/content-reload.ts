/**
 * src/deploy/content-reload.ts — 内容面热重扫（运行中 reload）
 *
 * 卡面：Gitea issue **#198**（K12-15）｜判据源：施工项登记件 `1-10`
 * 规范：《extensions内容面规范-v0》§5.3「DSH 三机制」——**早激活** / **失败隔离** / **标识持久化**
 *
 * ## 为什么需要它
 * 装配此前只在 **boot** 发生（`src/init/file-driven-loaders.ts` → `content-registry`）
 * ⇒ 改 `extensions/` 必须**重启进程**。对"建档后立刻让员工用起来"是硬障碍。
 *
 * ## 三机制在本文件的落点（逐条对应）
 * | 机制 | 本文件怎么做 |
 * |---|---|
 * | **早激活** | reload 复用 boot 的同一入口 `initContentTypes()`（**全量解析，选择前暴露失败**）——不另造第二条装配路径 |
 * | **失败隔离** | 逐项结果经 `initContentTypes()` 的 `results[]` 返回：失败项**拒绝新绑定**＋进 `retained[]` 留清单＋`degraded=true`；**本函数不抛**（铁律 24/31） |
 * | **标识持久化** | 把**本次重扫后实际绑定**的内容项身份（`type@version` ＋ 逐项 `dir`/`version`）写成状态文件，供 ⑥ 进化读 |
 *
 * ## 🔴 契约（铁律 47）
 * @input  `opts.dataDir?` 状态文件落点（缺省 `SYNOVA_DATA_DIR` → `getDataDirectory()`）
 *         `opts.reload?` 注入式重扫（缺省 `initContentTypes`）——确定性测试缝
 * @output `ReloadReport`（reloaded / retained / statePath / persisted / degraded / errors / warnings）
 * @degraded **不抛**：单项失败 → `retained[]` ＋ `errors[]` ＋ `degraded=true`；
 *           状态文件写失败 → `errors[]` ＋ `degraded=true`（**不回滚**已成功的重扫）
 * @invariant ① 失败项**不静默**（必进 `errors[]`）② 状态文件内容只含**本次真绑定**的项
 *            ③ 任何分支都不抛（调用方可安全地在请求/定时路径里调用）
 *
 * ## ⚠️ 已知边界（如实登记，不掩盖）
 * 1. **本函数会先调 `loader.cleanup`**（`clearXCache` / `reloadLocale` 等）。原因：
 *    `content-registry` 的 `cleanup` 字段此前**零生产消费者**（实测 `grep -rn "\.cleanup" src/` 无调用，
 *    仅 `scripts/control-tower/probe-role-pack.ts` 核该符号存在）⇒ 不先清缓存，第二次 `init()` 会**读回旧缓存**
 *    ⇒ reload **名义上生效、实际不重扫**。故本文件是 `cleanup` 的第一个生产消费者。
 * 2. **失败项的"旧值"不保证仍在内存**：loaders 的语义是「先清缓存再重读，读失败 ⇒ 该 type 缓存为空」。
 *    本文件**不**为失败项伪造旧值 ⇒ 失败项在**下一次成功 reload 或重启前不可用**。
 *    这正是「**拒绝新绑定**」（不把坏内容绑上），但**不等于**「旧值自动回滚」——后者需 loaders 侧支持，
 *    属 loaders 写集，不在本卡范围。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@synova/logger';
import { getDataDirectory } from './data-directory';
import { describeContentRegistry, initContentTypes, type ContentInitReport } from './content-registry';

const log = createLogger('deploy/content-reload');

/** 状态文件名（落到数据目录下）。🔴 非 export：唯一生产消费者在本文件内（避免"新 export 无消费者"） */
const CONTENT_BINDING_STATE_FILE = 'content-binding-state.json';

/** 状态文件 schema 版本（⑥ 进化读时按此判兼容） */
const CONTENT_BINDING_STATE_SCHEMA = 1;

/** 单次 reload 里一个内容项的处置 */
export interface ReloadItemResult {
  /** 内容项 type（`content-registry` 的键） */
  type: string;
  /** 内容项目录名 */
  dir: string;
  /** 该内容项的标识（`<type>@<version>`；无 version 时 `type@unknown`） */
  identity: string;
  /** 该 type 的 manifest 版本（取不到则 `undefined`） */
  version?: string;
  /** 装配中真实调用并被校验过的导出函数名（来自 registry 的 `loader.init` + `verify[]`） */
  verified: string[];
}

/** 重扫报告 */
export interface ReloadReport {
  /** 本次**真绑定**（重扫成功）的项 */
  reloaded: ReloadItemResult[];
  /** **失败隔离**：本次拒绝新绑定、留清单的项（含原因） */
  retained: { type: string; dir: string; error: string }[];
  /** 状态文件绝对路径 */
  statePath: string;
  /** 状态文件是否写入成功 */
  persisted: boolean;
  /** 有任何失败即 true（铁律 31：降级信号必须外传） */
  degraded: boolean;
  errors: string[];
  warnings: string[];
}

/** 注入缝（确定性测试用） */
export interface ReloadOptions {
  /** 状态文件落点目录（缺省走 `SYNOVA_DATA_DIR` / 平台数据目录） */
  dataDir?: string;
  /** 重扫实现（缺省 `initContentTypes`）——测试可注入确定性失败/成功 */
  reload?: () => Promise<ContentInitReport>;
}

/** 状态文件内容（供 ⑥ 进化读；**只含本次真绑定项**） */
export interface ContentBindingState {
  schemaVersion: number;
  updatedAt: string;
  /** 本次 reload 真绑定的项 */
  bound: { type: string; dir: string; identity: string; version?: string; verified: string[] }[];
  /** 本次拒绝新绑定的项（留清单，便于进化侧发现"内容在坏"） */
  rejected: { type: string; dir: string; error: string }[];
  degraded: boolean;
}

/**
 * 解析状态文件落点。
 * @input  `dataDir?` 显式目录（最高优先）
 * @output 状态文件绝对路径（不保证存在）
 * @degraded 无（纯字符串解析）
 */
function resolveBindingStatePath(dataDir?: string): string {
  const dir = dataDir ?? process.env.SYNOVA_DATA_DIR ?? getDataDirectory();
  return path.join(dir, CONTENT_BINDING_STATE_FILE);
}

/**
 * 读某内容项目录下 `manifest.json` 的 `version`。
 * @input  `dir` 内容项目录名（相对 `extensions/`）
 * @output version 字符串；文件缺失 / 解析失败 ⇒ `undefined`
 * @degraded 读失败按「无版本」处理（**属正常默认**，不刷 warn；调用方以 `identity=…@unknown` 体现）
 */
function readContentVersion(dir: string): string | undefined {
  const manifestPath = path.join(process.cwd(), 'extensions', dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { version?: unknown };
    return typeof raw.version === 'string' ? raw.version : undefined;
  } catch (err: unknown) {
    log.warn({ err, manifestPath }, 'manifest version 读取失败 —— 按无版本处理（identity 落 @unknown）');
    return undefined;
  }
}

/**
 * 清 `content-registry` 声明的 loader 缓存（reload 的前置）。
 *
 * 🔴 不做这一步 ⇒ 第二次 `init()` 直接读回旧缓存 ⇒ **reload 名义生效、实际不重扫**。
 * @input  无（自取 `describeContentRegistry()` 的 `loader.cleanup` 声明）
 * @output 已清理的 type 列表
 * @degraded 单项清理失败 ⇒ log.warn ＋ 计入 `errors[]` 外传；**继续**清其余项（不因一项失败停摆）
 */
async function clearLoaderCaches(): Promise<{ cleared: string[]; errors: string[] }> {
  const modules: Record<string, () => Promise<Record<string, unknown>>> = {
    '../locale/locale-loader': () => import('../locale/locale-loader'),
    '../l3/report-template-loader': () => import('../l3/report-template-loader'),
    '../l3/framework-loader': () => import('../l3/framework-loader'),
    '../l3/rule-loader': () => import('../l3/rule-loader'),
    '../l3/business-model-loader': () => import('../l3/business-model-loader'),
    '../l4/ontology-loader': () => import('../l4/ontology-loader'),
    '../l4/adapter-loader': () => import('../l4/adapter-loader'),
    '../notifications/notification-loader': () => import('../notifications/notification-loader'),
    '../sentinel/sentinel-loader': () => import('../sentinel/sentinel-loader'),
    '../init/preset-loader': () => import('../init/preset-loader'),
  };
  const cleared: string[] = [];
  const errors: string[] = [];
  for (const entry of describeContentRegistry().entries) {
    const loader = entry.loader;
    const cleanup = loader?.cleanup;
    if (loader === undefined || cleanup === undefined) continue;
    const importer = modules[loader.module];
    if (importer === undefined) {
      errors.push(`${entry.type}: cleanup 的 module 不在可解析表内: ${loader.module}`);
      log.warn({ type: entry.type, module: loader.module }, 'cleanup 模块不可解析 —— degraded');
      continue;
    }
    try {
      const mod = await importer();
      const fn = mod[cleanup];
      if (typeof fn !== 'function') {
        errors.push(`${entry.type}: cleanup 符号不存在: ${cleanup}`);
        log.warn({ type: entry.type, cleanup }, 'cleanup 符号不存在 —— degraded（旧缓存未清）');
        continue;
      }
      (fn as () => unknown)();
      cleared.push(entry.type);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${entry.type}: cleanup(${cleanup}) 失败: ${msg}`);
      log.warn({ err, type: entry.type, cleanup }, 'cleanup 调用失败 —— degraded');
    }
  }
  return { cleared, errors };
}

/**
 * 运行时重扫内容面 —— 改 `extensions/` 后**无需重启**即可生效。
 *
 * @input  `opts`（见 `ReloadOptions`）
 * @output `ReloadReport`
 * @degraded 见文件头契约：**永不抛**；失败项进 `retained[]`，状态写失败进 `errors[]`
 */
export async function reloadContentTypes(opts: ReloadOptions = {}): Promise<ReloadReport> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ① 前置：清 loader 缓存（否则下列 init 读回旧缓存 ⇒ 假生效）
  const { errors: cleanupErrors } = await clearLoaderCaches();
  errors.push(...cleanupErrors);

  // ② 早激活：复用 boot 的同一入口（全量解析，选择前暴露失败）
  const doReload = opts.reload ?? (() => initContentTypes());
  const report: ContentInitReport = await doReload();

  // ③ 失败隔离：逐项分流
  const reloaded: ReloadItemResult[] = [];
  const retained: { type: string; dir: string; error: string }[] = [];
  for (const r of report.results) {
    if (r.ok) {
      const version = readContentVersion(r.dir);
      reloaded.push({
        type: r.type,
        dir: r.dir,
        identity: `${r.type}@${version ?? 'unknown'}`,
        version,
        verified: r.verified,
      });
    } else {
      const msg = r.error ?? '未知失败';
      retained.push({ type: r.type, dir: r.dir, error: msg });
      log.warn({ type: r.type, dir: r.dir, error: msg }, '内容项重扫失败 —— 拒绝新绑定（留清单）');
    }
  }
  warnings.push(...report.warnings);
  errors.push(...report.errors);

  // ④ 标识持久化
  const statePath = resolveBindingStatePath(opts.dataDir);
  const state: ContentBindingState = {
    schemaVersion: CONTENT_BINDING_STATE_SCHEMA,
    updatedAt: new Date().toISOString(),
    bound: reloaded.map((r) => ({
      type: r.type,
      dir: r.dir,
      identity: r.identity,
      version: r.version,
      verified: r.verified,
    })),
    rejected: retained,
    degraded: retained.length > 0 || errors.length > 0,
  };
  const persisted = persistContentBindingState(state, statePath, errors);

  const degraded = retained.length > 0 || errors.length > 0 || report.degraded;
  if (degraded) {
    log.warn(
      { reloaded: reloaded.length, retained: retained.length, errors: errors.length },
      '内容面重扫带降级信号 — degraded（失败项已留清单，不阻断调用方）',
    );
  } else {
    log.info({ reloaded: reloaded.length, statePath }, '内容面重扫完成');
  }

  return { reloaded, retained, statePath, persisted, degraded, errors, warnings };
}

/**
 * 写内容绑定状态文件（**失败不抛**，把错误推入调用方给的 `sink`）。
 *
 * @input  `state` 待写内容；`statePath` 目标文件；`sink` 错误收集数组（外传降级信号）
 * @output 写入成功 = true
 * @degraded 目录创建/写入失败 ⇒ log.warn ＋ 返回 false ＋ 错误进 `sink`（铁律 11/24/31）
 */
function persistContentBindingState(state: ContentBindingState, statePath: string, sink: string[]): boolean {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err, statePath }, '内容绑定状态写入失败 — degraded（不回滚已成功的重扫）');
    sink.push(`状态文件写入失败: ${statePath}: ${msg}`);
    return false;
  }
}
