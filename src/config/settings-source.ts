/**
 * settings-source.ts — 设置两层文件源（D1053，线25 25-8/25-9）
 *
 * spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md §4.2/§4.5
 * 复用: `src/config/config-layers.ts` 的 `mergeLayers`/`resolveLayers`/`dumpLayers`（D599 落点）——
 *   **禁重写第二套叠加实现**（规格 §4.5）；本模块只负责「读文件 + 定位归属」，叠加一律交给 resolveLayers。
 *
 * 契约（铁律 47）:
 *   @input  loadSettingsSource(options?: { root?: string; home?: string }): SettingsSourceResult
 *           —— root 缺省 = env `SYNOVA_SETTINGS_ROOT` ?? `process.cwd()`
 *              home 缺省 = env `SYNOVA_SETTINGS_HOME` ?? `$HOME/.synova`
 *              文件 = `<root>/settings.yaml` 与 `<home>/settings.yaml`（**唯一**源定位缝，规格 §4.5）
 *   @output { doc, files, layerOfPath, degraded, reason?, errors }
 *           doc = 两层叠加结果（workspace > home；detached，来自 resolveLayers）
 *           layerOfPath(path) = 'workspace' | 'home' | 'none'（叶子级归属，只读 walk）
 *   @degraded 解析失败 / IO 错误（非 ENOENT）/ 层文档非 plain object / 归属交叉校验不一致
 *             ⇒ degraded:true + reason + log.warn（铁律 24/31，禁静默降级）
 *   @error 不抛业务错：结构错误一律收敛为 degraded（调用方无需 try/catch 即可读源）
 *
 * 边界（逐字，规格 §4.2）:
 *   - 两层文件均不存在 / 单层不存在 ⇒ **ENOENT = 正常默认，非降级**，log.debug
 *   - js-yaml 解析失败 ⇒ SETTINGS_SOURCE_UNPARSABLE + 文件绝对路径 + 解析器原文摘要
 *   - 读取 IO 错误（EACCES 等）⇒ SETTINGS_SOURCE_IO + errno
 *
 * settings 面（scope）判定（TOLERANT 规则，逐字）: 顶层若存在 plain object 的 `settings` 键，
 *   则该子树为设置面；否则**整篇文档**即设置面。规格 §5.1/§十三③ 两种写法（带/不带 `settings:`
 *   包裹）都必须在同一读取面下可用 ⇒ 该宽容规则是唯一同时满足两处规范夹具的读法；它不含猜测：
 *   判据仅「顶层 `settings` 键是否为 plain object」一条。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { createLogger } from '@synova/logger';
import { dumpLayers, resolveLayers, type LayerDoc, type LayerName } from './config-layers';

const log = createLogger('config/settings-source');

/** 源文件名（两层同名，规格 §4.5 逐字）。模块私有：仅本文件的源定位使用，无外部消费者。 */
const SETTINGS_FILE = 'settings.yaml';

/** 顶层设置面键：存在且为 plain object 时，该子树即设置面。 */
const SETTINGS_SCOPE_KEY = 'settings';

/** 源层解析错误码。 */
export type SettingsSourceCode =
  | 'SETTINGS_SOURCE_UNPARSABLE'
  | 'SETTINGS_SOURCE_IO'
  | 'SETTINGS_SOURCE_SHAPE'
  | 'SETTINGS_SOURCE_PROVENANCE_MISMATCH';

/** 一层源文件的读取结果。 */
export interface SettingsLayerRead {
  /** 该层文件绝对路径。 */
  path: string;
  /** 文件存在且已解析出的设置面文档；不存在 = null。 */
  doc: LayerDoc | null;
}

/** 两层源读取 + 叠加结果。 */
export interface SettingsSourceResult {
  /** 两层叠加后的设置面文档（detached；唯一来自 `resolveLayers`）。 */
  doc: LayerDoc;
  /** 已存在的源文件绝对路径（不存在 = null）。 */
  files: { workspace: string | null; home: string | null };
  /** 叶子级归属查询：`ns.key` → 定义该路径的最高层（'none' = 两层均未定义）。 */
  layerOfPath: (path: string) => 'workspace' | 'home' | 'none';
  /** 是否降级（解析失败 / IO 错误 / 形状非法 / 归属交叉校验不一致）。 */
  degraded: boolean;
  /** 降级原因（含具体文件 + 错误类别），degraded=false 时省略。 */
  reason?: string;
  /** 首个错误码（degraded=true 时提供）。 */
  code?: SettingsSourceCode;
  /** 全部错误明细（含文件路径与 errno/解析器摘要）。 */
  errors: string[];
}

/** 是否 plain data object（非数组、非 null、原型为 Object.prototype 或 null）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** ENOENT = 正常缺省（可选层文件不存在）。 */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** js-yaml 多行 code-frame 收敛为单行（日志/证据可读）。 */
function firstLine(text: string): string {
  return text.replace(/\r?\n[\s\S]*$/, '');
}

/** 取设置面：顶层 `settings` 为 plain object ⇒ 该子树；否则整篇文档。 */
function settingsScopeOf(doc: LayerDoc): LayerDoc {
  const nested = doc[SETTINGS_SCOPE_KEY];
  return isPlainObject(nested) ? nested : doc;
}

/** 路径是否被某个设置面文档定义（叶子级，按 mergeLayers 同型：中间段非 plain object ⇒ 未定义）。 */
function isDefinedAt(scope: LayerDoc | null, segments: readonly string[]): boolean {
  if (scope === null) return false;
  let node: unknown = scope;
  for (const segment of segments) {
    if (!isPlainObject(node)) return false;
    if (!Object.prototype.hasOwnProperty.call(node, segment)) return false;
    node = node[segment];
  }
  return node !== undefined;
}

/** 读一层文件：ENOENT → null；其余失败记录错误并返回 null（由调用方降级）。 */
function readLayer(path: string, errors: string[]): LayerDoc | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    if (isENOENT(error)) {
      log.debug({ path }, 'settings-source: 层文件不存在 — 正常默认（非降级）');
      return null;
    }
    const errno = (error as NodeJS.ErrnoException | null)?.code ?? 'unknown';
    errors.push(`SETTINGS_SOURCE_IO ${path}: errno=${errno}`);
    log.warn({ path, errno }, 'settings-source: 层文件读取失败 — degraded（铁律 24）');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`SETTINGS_SOURCE_UNPARSABLE ${path}: ${firstLine(detail)}`);
    log.warn({ path, detail: firstLine(detail) }, 'settings-source: 层文件解析失败 — degraded（铁律 24）');
    return null;
  }
  if (parsed === undefined || parsed === null) return {};
  if (!isPlainObject(parsed)) {
    const kind = Array.isArray(parsed) ? 'array' : typeof parsed;
    errors.push(`SETTINGS_SOURCE_SHAPE ${path}: 顶层必须是对象，收到 ${kind}`);
    log.warn({ path, kind }, 'settings-source: 层文件顶层非对象 — degraded');
    return null;
  }
  return parsed;
}

/**
 * 读取两层设置源并叠加（workspace > home）。
 *
 * 叠加**唯一**经 `resolveLayers({ default: home, workspace })`（LAYER_ORDER 内 default 先于
 * workspace，后者胜 ⇒ 等价 home < workspace）；叶子级归属由只读 walk 得出，取值一律来自
 * resolveLayers 输出（walk 结果**不得**替代叠加结果，规格 §4.5）。另用 `dumpLayers` 的顶层键
 * 归属做第二重交叉校验，不一致即降级（不静默）。
 *
 * @param options - 可选 root/home 覆盖（缺省取 env，见文件头契约）。
 * @returns 两层叠加文档 + 文件路径 + 归属查询 + 降级标记。
 * @degraded 解析失败 / IO 错误 / 层文档非对象 ⇒ `degraded:true` + `reason` + `log.warn`。
 * @error 不抛（结构错误全部收敛为 degraded，禁静默）。
 */
export function loadSettingsSource(options?: { root?: string; home?: string }): SettingsSourceResult {
  const root = options?.root ?? process.env['SYNOVA_SETTINGS_ROOT'] ?? process.cwd();
  const home = options?.home ?? process.env['SYNOVA_SETTINGS_HOME'] ?? join(process.env['HOME'] ?? '.', '.synova');
  const workspacePath = join(root, SETTINGS_FILE);
  const homePath = join(home, SETTINGS_FILE);

  const errors: string[] = [];
  const workspaceDoc = readLayer(workspacePath, errors);
  const homeDoc = readLayer(homePath, errors);
  const workspaceScope = workspaceDoc === null ? null : settingsScopeOf(workspaceDoc);
  const homeScope = homeDoc === null ? null : settingsScopeOf(homeDoc);

  let resolved: LayerDoc;
  try {
    resolved = resolveLayers({
      ...(homeScope === null ? {} : { default: homeScope }),
      ...(workspaceScope === null ? {} : { workspace: workspaceScope }),
    });
  } catch (error: unknown) {
    // 层文档形状由 readLayer 保证为 plain object；此路兜底（resolveLayers fail-closed 不静默）
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`SETTINGS_SOURCE_SHAPE resolveLayers: ${firstLine(detail)}`);
    log.warn({ detail: firstLine(detail) }, 'settings-source: 叠加失败 — degraded（铁律 24）');
    resolved = {};
  }

  const layerOfPath = (path: string): 'workspace' | 'home' | 'none' => {
    const segments = path.split('.');
    if (isDefinedAt(workspaceScope, segments)) return 'workspace';
    if (isDefinedAt(homeScope, segments)) return 'home';
    return 'none';
  };

  // 第二重校验（规格 §4.5）：dumpLayers 的顶层键归属 vs 叶子 walk 的命名空间级结论
  if (Object.keys(resolved).length > 0) {
    const dump = dumpLayers({
      ...(homeScope === null ? {} : { default: homeScope }),
      ...(workspaceScope === null ? {} : { workspace: workspaceScope }),
    });
    const owner = new Map<string, LayerName>();
    for (const line of dump.layers) {
      for (const key of line.contributedKeys) owner.set(key, line.layer);
    }
    for (const ns of Object.keys(resolved)) {
      const fromDump = owner.get(ns);
      const fromWalk = layerOfPath(ns);
      const expected = fromDump === 'workspace' ? 'workspace' : fromDump === 'default' ? 'home' : fromWalk;
      if (fromWalk !== expected) {
        errors.push(`SETTINGS_SOURCE_PROVENANCE_MISMATCH ${ns}: dump=${String(fromDump)} walk=${fromWalk}`);
        log.warn({ ns, fromDump, fromWalk }, 'settings-source: 归属交叉校验不一致 — degraded');
      }
    }
  }

  const degraded = errors.length > 0;
  const firstError = errors[0];
  return {
    doc: resolved,
    files: {
      workspace: workspaceDoc === null ? null : workspacePath,
      home: homeDoc === null ? null : homePath,
    },
    layerOfPath,
    degraded,
    ...(degraded ? { reason: errors.join(' | '), code: codeOf(firstError) } : {}),
    errors,
  };
}

/** 由错误明细首条推首个错误码（明细格式恒为 `CODE detail`）。 */
function codeOf(detail: string | undefined): SettingsSourceCode {
  if (detail !== undefined && detail.startsWith('SETTINGS_SOURCE_IO')) return 'SETTINGS_SOURCE_IO';
  if (detail !== undefined && detail.startsWith('SETTINGS_SOURCE_PROVENANCE_MISMATCH')) {
    return 'SETTINGS_SOURCE_PROVENANCE_MISMATCH';
  }
  if (detail !== undefined && detail.startsWith('SETTINGS_SOURCE_SHAPE')) return 'SETTINGS_SOURCE_SHAPE';
  return 'SETTINGS_SOURCE_UNPARSABLE';
}
