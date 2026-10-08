/**
 * l1/im-webhook-signature.ts — 飞书 (Lark) 事件回调**签名校验**（纯函数，零 express / 零 I/O）
 *
 * ## 规格来源（唯一权威，不再引第二处）
 * open.feishu.cn「Step 3: Receive events」签名校验样例代码（六语言）：
 * ```
 * 签名 = sha256(X-Lark-Request-Timestamp + X-Lark-Request-Nonce + encrypt_key + rawBody) 的 hex
 * ```
 * - ⚠️ 是 **SHA-256**，**不是** HMAC（不掺密钥派生，encrypt_key 直接作为拼接串的一段）。
 * - ⚠️ `rawBody` 必须是**未反序列化的原始字节**。官方 Go 样例逐字警告：
 *   `bodystring refers to the entire request body, do not calculate it after deserialization`
 *   ⇒ 一旦对 body 做 `JSON.parse` 再 `JSON.stringify`，键序/空白/转义都会变 ⇒ 摘要必不相等。
 * - 时间窗 **±1 小时**（本模块 `isWithinTimeWindow` 默认值）。
 *
 * ## 契约（铁律 47 — 输入 / 输出 / 降级）
 * - **输入**：`timestamp` / `nonce` / `signature` 取自小写请求头
 *   `x-lark-request-timestamp` / `x-lark-request-nonce` / `x-lark-signature`；
 *   `encryptKey` 取自部署配置；`rawBody` 为原始字节 `Buffer`。
 * - **输出**：`computeFeishuSignature` 返回 64 字符小写 hex；`verifyFeishuSignature` 返回
 *   `{ ok: boolean; reason?: SignatureFailureReason }`；`isWithinTimeWindow` 返回 `boolean`。
 * - **降级**：**本模块无降级放行分支** —— 任何不确定输入（缺参、长度不符、非 hex、
 *   时间戳非十进制整数）一律判**不等/不在窗内**（fail-closed）。
 *   「密钥未配置时如何处置」是**配置态**问题，属调用方（`src/routes/im.ts`）的判决，
 *   **不在本模块**，以免纯函数混入配置分支（同一函数可被未来的段2 早挂载复用）。
 * - **不抛异常**：输入再脏（空串、超长、非法 UTF-8 字节）也只返回值，不 throw。
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** 签名校验失败原因（供调用方落日志/回执；不含密钥、不含 body 内容） */
export type SignatureFailureReason =
  /** 任一入参不可用：timestamp / nonce / encryptKey / expectedSignature 为空串，或 rawBody 非 Buffer */
  | 'missing_params'
  /** 期望签名与计算签名的**字节长度不等**（先行返回，不进入常数时间比较） */
  | 'length_mismatch'
  /** 长度相等但内容不等（常数时间比较判定） */
  | 'mismatch'
  /** 签名正确但时间戳落在 ±windowMs 之外（**超出重放视界** / 时钟漂移；本模块不做 nonce 去重） */
  | 'timestamp_out_of_window';

/** `verifyFeishuSignature` 的返回值（判别式：`ok === true` 时无 `reason`） */
export interface SignatureVerificationResult {
  ok: boolean;
  reason?: SignatureFailureReason;
}

/** 默认时间窗：±1 小时（毫秒） */
export const DEFAULT_SIGNATURE_WINDOW_MS = 3_600_000;

/**
 * 计算飞书回调签名：`sha256(timestamp + nonce + encryptKey + rawBody)` 的 hex。
 *
 * 契约:
 * - 输入: `timestamp`/`nonce`/`encryptKey` 为字符串（按 **UTF-8** 编码为字节），
 *   `rawBody` 为**未反序列化**的原始请求体字节。
 * - 输出: 64 字符小写 hex 摘要。
 * - 降级: 无 —— 入参为空串时**仍按字节拼接计算**（空串在拼接里等于不存在，
 *   与官方「encrypt_key 未配置时该段为空」的形态一致）；只有 `rawBody` 非 Buffer 时返回空串，
 *   交由 `verifyFeishuSignature` 判不等（保持本函数「永不 throw」）。
 */
export function computeFeishuSignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  rawBody: Buffer,
): string {
  if (!Buffer.isBuffer(rawBody)) return '';
  const prefix = Buffer.from(`${timestamp}${nonce}${encryptKey}`, 'utf8');
  const digest = createHash('sha256').update(Buffer.concat([prefix, rawBody])).digest('hex');
  return digest;
}

/**
 * 校验飞书回调签名**并**时间窗 —— 单一判决点（常数时间比较，禁 `===`）。
 *
 * ## 为什么时间窗与 rawBody 形态也在这里（而不是散在调用方）
 * 本函数是路由层唯一判决点：`true/false` 之外不再有第二个「要不要放行」的判断，
 * ⇒ **单行改坏即可让全部拒绝路径一起失效**（可做「改坏即红」判别，见
 * `tests/routes/im-webhook-signature.test.ts` 改坏即红四步，卡 F4-⑧）。
 * `isWithinTimeWindow` 仍**独立导出**（可单独测、可被未来的段2 早挂载复用），
 * 此处只是**组合**调用它。
 *
 * 契约:
 * - 输入: `timestamp`/`nonce`/`signature` 取自小写请求头；
 *   `rawBody` 为**未反序列化**的原始字节（**运行时传非 Buffer，如 `undefined`（早挂载缺席）
 *   ⇒ 判 `missing_params`** —— fail-closed，禁「拿不到就放行」）；
 *   `nowMs` 由调用方注入（可测、无隐藏时钟）；`windowMs` 默认 ±1h。
 * - 输出: `{ ok: true }` 或 `{ ok: false, reason }`；`reason` 取值见 `SignatureFailureReason`。
 *   判定顺序（先易后难，泄给调用方的信息都与密钥无关）：缺参 → 长度 → 常数时间比较 → 时间窗。
 * - 降级: **无放行分支**。任何不确定输入一律判 `ok: false`。比较发生在**解码后的字节**上
 *   ⇒ hex 的**大小写表示等价**（`Buffer.from(x,'hex')` 不区分大小写，同一摘要的两种写法同判通过），
 *   但**任何数值改动**（含 1 个 hex 字符）都改变字节 ⇒ 判不等。
 * - 不抛: 非 hex 字符会被 `Buffer.from(x,'hex')` 截断 ⇒ 长度不等 ⇒ 返回不等；`nowMs` 非法
 *   ⇒ `isWithinTimeWindow` 内部 fail-closed 为 `false` ⇒ 判窗外。
 */
export function verifyFeishuSignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  rawBody: Buffer,
  expectedSignature: string,
  nowMs: number,
  windowMs: number = DEFAULT_SIGNATURE_WINDOW_MS,
): SignatureVerificationResult {
  if (
    typeof timestamp !== 'string' || timestamp.length === 0
    || typeof nonce !== 'string' || nonce.length === 0
    || typeof encryptKey !== 'string' || encryptKey.length === 0
    || typeof expectedSignature !== 'string' || expectedSignature.length === 0
    || !Buffer.isBuffer(rawBody)
  ) {
    return { ok: false, reason: 'missing_params' };
  }

  const computedHex = computeFeishuSignature(timestamp, nonce, encryptKey, rawBody);
  const computed = Buffer.from(computedHex, 'hex');
  const expected = Buffer.from(expectedSignature, 'hex');

  // 长度不等先行返回不等 —— timingSafeEqual 对长度不等会 throw，且长度本身不是秘密
  if (computed.length !== expected.length) {
    return { ok: false, reason: 'length_mismatch' };
  }
  if (!timingSafeEqual(computed, expected)) {
    return { ok: false, reason: 'mismatch' };
  }
  if (!isWithinTimeWindow(timestamp, nowMs, windowMs)) {
    return { ok: false, reason: 'timestamp_out_of_window' };
  }
  return { ok: true };
}

/**
 * 判断回调时间戳是否落在 `nowMs` 的 ±windowMs 窗内（默认 ±1 小时）。
 *
 * 契约:
 * - 输入: `timestampSec` 为飞书头 `x-lark-request-timestamp` 的**原始字符串**（十进制秒）；
 *   `nowMs` 为当前时刻毫秒（调用方注入 ⇒ 本函数可测、无隐式时钟）；
 *   `windowMs` 为半窗宽毫秒（默认 `DEFAULT_SIGNATURE_WINDOW_MS` = 1h）。
 * - 输出: `true` = 窗内（含边界）；`false` = 窗外。
 * - 降级: **fail-closed** —— 空串 / 非十进制整数 / 负数 / 非安全整数 / `nowMs` 非有限数
 *   ⇒ 一律 `false`（禁「解析不出就放行」）。**不 throw**。
 * - 边界（如实声明，勿读成「防重放」）: 本函数**只限定重放视界** —— 窗内同一份请求可被
 *   重复投递且每次都判 `true`（**不做 nonce 去重**，不落已见 nonce 表）。要防窗口内重放
 *   须新增去重存储（新能力，不在 K1-WH 段1a 范围）。
 */
export function isWithinTimeWindow(
  timestampSec: string,
  nowMs: number,
  windowMs: number = DEFAULT_SIGNATURE_WINDOW_MS,
): boolean {
  if (typeof timestampSec !== 'string') return false;
  if (!/^\d{1,15}$/.test(timestampSec)) return false;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return false;
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs < 0) return false;

  const tsSec = Number(timestampSec);
  if (!Number.isSafeInteger(tsSec)) return false;

  const deltaMs = Math.abs(nowMs - tsSec * 1000);
  return deltaMs <= windowMs;
}
