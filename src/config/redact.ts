/**
 * redact.ts — 配置面秘密结构性脱敏（跨 wire 无值；#914 Q-2／裁 366）
 *
 * spec: handbook 派单件/2026-10-24-规格-914-Q2-秘密结构脱敏.md §4.1（C1 唯一契约源）、
 *       §4.4（C3 fail-closed）、C2 边界值清单
 * 范式来源: DSH packages/settings/settings/src/redact.ts:1-7,:106（结构移除 + 侧车；
 *           读源码自研，零 DSH 代码依赖，G1/G4）
 *
 * 契约（铁律 47）:
 *   - redactSecrets(value: LayerDoc): RedactedValue
 *     @param value - 一层/合并后的配置文档（plain object）。
 *     @returns { value, secrets }：value＝脱敏副本（秘密槽＝{configured}）；
 *              secrets＝全部秘密槽 [{path, configured}]（遍历顺序，含 configured=false）。
 *     递归 plain object / array，叶子保持原值；对象键名**整段**命中 SECRET_SEGMENTS 时整槽替换。
 *     深路径记法 `$.a.b[0].token`（数组下标 `[i]`）。**不修改入参**（返回 detached 副本）。
 *     入参非 plain object，或遇到 Map/Date/function 等未知容器 ⇒ 抛 ConfigRedactError（fail-closed）。
 *   - resolveSecretSource(path, layers): string | null
 *     @param path - redactSecrets 产出的完整路径（如 `$.llm.apiKey`）。
 *     @param layers - 逐层来源数组，**末尾为最高层**（workspace）；doc=null 表示该层未提供。
 *     @returns 第一个「完整路径存在」（own 属性／数组下标命中）的层名；都不存在 ⇒ null。
 *     路径文法仅支持 `.key` 与 `[i]`；非法路径 ⇒ 抛 ConfigRedactError（fail loud，不静默 null）。
 *   - ConfigRedactError: { code: 'REDACT_UNSUPPORTED'; phase: 'redactSecrets'; retryable: false }
 *     message 只含**容器类型与路径**，**绝不含值**（值本身可能就是秘密）。
 *
 * 降级（@degraded）: 本模块为纯函数层，无 I/O、无 catch；未知容器 fail-closed 抛
 * ConfigRedactError，调用方（src/routes/config.ts）负责 log.warn ＋ degraded 传播
 * （铁律 24/31；C3：宁可不给，不泄漏）。
 *
 * 设计哲学一句：一个分离 —— 结构移除（值槽 → {configured}）与来源侧车（secrets[]）分离，
 * 「有没有值」可渲染、「值是什么」永不出模块边界；三条承诺：不改入参／未知容器必抛／错误不含值。
 *
 * Known Limitations（做不到什么；dev doc C2 末段 3 条）:
 * ① 值型秘密（非秘密名下藏的值，如 `foo: sk-...`）不在本机制覆盖面（Q-13/Q-14 面）。
 * ② 段名匹配是「名字启发式」，可能过度脱敏（如业务字段 `token`）。
 * ③ source 是「完整路径最高持有层」，与「逐层嵌套覆盖」的最细来源可能有差
 *    （数组整值替换后不会出现）。
 */
import type { LayerDoc } from './config-layers';

/**
 * 秘密段名（首版，dev doc C2 末段 18 项）：**整段相等**匹配 ——
 * `token`／`apiKey` 命中；`tokenBudget`／`apiKeyHint`／`mytoken` 不命中。
 * 失效条件（C3）：`src/config/settings-seam.ts` 落地后本表必须撤，改由 schema 的 secret 声明驱动。
 */
export const SECRET_SEGMENTS: readonly string[] = [
  'apiKey', 'api_key', 'accessKey', 'access_key', 'secretKey', 'secret_key',
  'clientSecret', 'client_secret', 'privateKey', 'private_key', 'password', 'passwd',
  'token', 'accessToken', 'refreshToken', 'credential', 'credentials', 'secret',
];

const SECRET_SET: ReadonlySet<string> = new Set(SECRET_SEGMENTS);

/** 合法路径文法：`$` 起头，后接 `.key` 或 `[i]`（与 redactSecrets 产出同式）。 */
const PATH_SHAPE = /^\$(?:\.[A-Za-z0-9_$-]+|\[\d+\])+$/;

/** 侧车单条：一条秘密的完整路径与「是否持有值」。 */
export interface SecretSlot {
  /** 完整路径，如 `$.llm.apiKey`／`$.a.b[0].token`。 */
  path: string;
  /** 是否持有值（非 null/undefined/''；0/false/{}/[] 均算有值）。 */
  configured: boolean;
}

/** 脱敏结果：脱敏副本 + 秘密侧车。 */
export interface RedactedValue {
  /** 脱敏后的配置副本（detached，与入参零共享引用）。 */
  value: LayerDoc;
  /** 全部秘密槽，遍历顺序（含 configured=false）。 */
  secrets: SecretSlot[];
}

/**
 * 脱敏错误（铁律 32: .code ＋ .phase ＋ .retryable）。
 * 未知容器／非法路径等 fail-closed 场景抛出；输入形态不可判定 ⇒ 不重试。
 * message 只含容器类型与路径，**绝不含值**。
 */
export class ConfigRedactError extends Error {
  /** 稳定机器码，供上层映射自身错误分类。 */
  readonly code = 'REDACT_UNSUPPORTED';
  /** 出错机制阶段。 */
  readonly phase = 'redactSecrets';
  /** 输入形态不可判定 ⇒ 重试无意义。 */
  readonly retryable = false;

  constructor(message: string) {
    super(`config-redact: ${message}`);
    this.name = 'ConfigRedactError';
  }
}

/** 是否 plain data object（非数组、非 null、原型为 Object.prototype 或 null）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** JSON 标量叶子（null/undefined 视为缺值叶子；symbol/bigint 不属 JSON，走 fail-closed）。 */
function isJsonLeaf(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value);
}

/** 只在错误 message 里描述的容器类型（**不含任何值**；Date/Set/类实例统一记 non-JSON value）。 */
function describeContainer(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value instanceof Map) return 'Map';
  if (typeof value === 'function') return 'function';
  return 'non-JSON value';
}

/** 秘密槽收口：值槽只留 {configured}，完整路径＋有无值进侧车（null/''/undefined 也记）。 */
function markSecret(slotPath: string, raw: unknown, slots: SecretSlot[]): { configured: boolean } {
  const configured = raw !== null && raw !== undefined && raw !== '';
  slots.push({ path: slotPath, configured });
  return { configured };
}

/** 单键分派：整段命中秘密段名 ⇒ 收口；否则继续递归。 */
function redactChild(childPath: string, key: string, raw: unknown, slots: SecretSlot[]): unknown {
  return SECRET_SET.has(key) ? markSecret(childPath, raw, slots) : redactNode(raw, childPath, slots);
}

/** 递归 plain object：new 对象由 Object.fromEntries 建（own 数据属性，防 `__proto__` 污染）。 */
function redactObject(node: Record<string, unknown>, path: string, slots: SecretSlot[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(node).map((key): [string, unknown] => [key, redactChild(`${path}.${key}`, key, node[key], slots)]),
  );
}

/** 递归分派：plain object／array／JSON 叶子；其余一律 fail-closed。 */
function redactNode(node: unknown, path: string, slots: SecretSlot[]): unknown {
  if (isPlainObject(node)) return redactObject(node, path, slots);
  if (Array.isArray(node)) return node.map((item, index) => redactNode(item, `${path}[${index}]`, slots));
  if (isJsonLeaf(node)) return node;
  throw new ConfigRedactError(`不支持的容器 ${describeContainer(node)}（路径 ${path}）`);
}

/** 路径文法解析：`$.a.b[0].token` → ['a', 'b', 0, 'token']；非法路径 fail-closed。 */
function parsePath(path: string): Array<string | number> {
  if (!PATH_SHAPE.test(path)) throw new ConfigRedactError(`路径格式不受支持："${path}"`);
  return path.slice(1).split(/[.[]/).filter((part) => part !== '')
    .map((part) => (/^\d+\]$/.test(part) ? Number(part.slice(0, -1)) : part));
}

/** 完整路径是否存在（own 属性／数组下标；不遍历原型链）。 */
function hasPath(doc: LayerDoc, segments: Array<string | number>): boolean {
  let cursor: unknown = doc;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(cursor) || segment >= cursor.length) return false;
      cursor = cursor[segment];
    } else {
      if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) return false;
      cursor = cursor[segment];
    }
  }
  return true;
}

/**
 * 秘密完整路径的来源层解析：从数组末尾（最高层 workspace）向 default 扫，
 * 第一个「完整路径存在」的层名；都不存在 ⇒ null。
 * @param path - redactSecrets 产出的完整路径（如 `$.llm.apiKey`）。
 * @param layers - 逐层来源（末尾＝最高层）；doc=null 表示该层未提供。
 * @returns 层名或 null；非法路径抛 ConfigRedactError。
 */
export function resolveSecretSource(
  path: string,
  layers: Array<{ layer: string; doc: LayerDoc | null }>,
): string | null {
  const segments = parsePath(path);
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const entry = layers[index];
    if (entry.doc !== null && hasPath(entry.doc, segments)) return entry.layer;
  }
  return null;
}

/**
 * 结构性脱敏：递归 plain object／array，秘密段名整槽替换为 {configured}，
 * 侧车记录全部秘密的完整路径与有无值。返回 detached 副本，不改入参。
 * @param value - 配置文档（plain object）。
 * @returns 脱敏副本 + 秘密侧车。
 * @throws ConfigRedactError 入参非 plain object 或含未知容器（fail-closed）。
 */
export function redactSecrets(value: LayerDoc): RedactedValue {
  if (!isPlainObject(value)) {
    throw new ConfigRedactError(`配置文档必须是 plain object，收到 ${describeContainer(value)}`);
  }
  const secrets: SecretSlot[] = [];
  return { value: redactObject(value, '$', secrets), secrets };
}
