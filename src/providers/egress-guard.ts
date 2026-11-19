/**
 * providers/egress-guard.ts — 旧 Provider 链「发送前」硬禁止拦截（I-3 第一刀）
 *
 * @input  — `{ body: Record<string, unknown>; baseUrl: string; allowedBaseUrl: string }`
 *           body 为即将 JSON 序列化发出的请求体；两个 URL 为「将要使用」与「构造时授权」的端点。
 * @output — `{ ok: true }` | `{ ok: false; code: EgressCode; field?: string }`
 *           code 三态：EGRESS_SECRET / EGRESS_HIGH_SENSITIVE / EGRESS_ENDPOINT；
 *           field 为命中的字段路径（如 `meta.password`、`messages[0].content`），不含值。
 * @degraded — 无：扫描不降级、不半脱敏放行；扫描过程异常一律向上抛（fail-closed）。
 * @authority — DEV DOC v3 §1/§4（Gitea #1441 评论 13694）＋ 创始人裁定《受控模型外发与数据边界 v1》
 * @not-here — Ernie 独立请求链、DSH Sidecar 模型链、企业禁外发标记、跨企业/任务相关性判定、
 *             企业级授权配置持久化、外发审计（均为另票，见 DEV DOC v3 §6）
 * @error  — 本函数用返回值表达拦截决策，不抛业务错误；调用方（base.ts）把 `ok:false`
 *           转成 `EgressGuardError` 并在 fetch 之前终止请求（零请求）。扫描遇到不可遍历
 *           结构时异常原样上抛，调用方不得吞掉。
 *
 * 规则（DEV DOC v3 §1，不得自行放宽或加码）:
 *  - 无条件拒绝键（出现即拒，不看值）：
 *      password / passwd / api_key / apikey / apiKey / secret / private_key ⇒ EGRESS_SECRET；
 *      card_number / bank_card / id_number / idCard ⇒ EGRESS_HIGH_SENSITIVE。
 *  - 歧义键 token：值为字符串 ⇒ EGRESS_SECRET；数字/布尔/null ⇒ 放行；
 *      对象/数组 ⇒ 作为容器继续递归（不额外加规则）。
 *  - 其它键名按完整名比较（如 token_count 不匹配），不做子串猜测。
 *  - 值形态拒（仅四种，字符串全量扫描）：`sk-…`、`AKIA…`、`-----BEGIN … PRIVATE KEY-----`、
 *      18 位身份证形态（`\d{17}[\dXx]`，**整串锚定**：19 位订单号不误伤）。
 *  - `baseUrl !== allowedBaseUrl` ⇒ EGRESS_ENDPOINT。
 *  - 不修改 body；日志只记 code 与字段路径，不记值。
 */
import { createLogger } from '@synova/logger';

const log = createLogger('providers/egress-guard');

export type EgressCode = 'EGRESS_SECRET' | 'EGRESS_HIGH_SENSITIVE' | 'EGRESS_ENDPOINT';

export type EgressGuardResult =
  | { ok: true }
  | { ok: false; code: EgressCode; field?: string };

export interface EgressGuardInput {
  body: Record<string, unknown>;
  baseUrl: string;
  allowedBaseUrl: string;
}

/** 无条件拒绝键 → EGRESS_SECRET（完整键名比较，大小写敏感） */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  'password', 'passwd',
  'api_key', 'apikey', 'apiKey',
  'secret', 'private_key',
]);

/** 无条件拒绝键 → EGRESS_HIGH_SENSITIVE */
const HIGH_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'card_number', 'bank_card', 'id_number', 'idCard',
]);

/** 值形态拒 — Secret（字符串内任意位置命中） */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** 值形态拒 — 高敏：18 位身份证形态（整串锚定；19 位订单号不命中） */
const ID_CARD_PATTERN = /^\d{17}[\dXx]$/;

interface GuardHit {
  code: EgressCode;
  field: string;
}

/** 字符串值的四种形态判定（不含键名判定） */
function matchValueShape(value: string, field: string): GuardHit | null {
  if (ID_CARD_PATTERN.test(value)) {
    return { code: 'EGRESS_HIGH_SENSITIVE', field };
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      return { code: 'EGRESS_SECRET', field };
    }
  }
  return null;
}

/**
 * 递归扫描任意 JSON 值。`field` 是字段路径（顶层为键名，嵌套用 `.`，数组用 `[i]`）。
 * 只读扫描：不修改、不重建 body。
 */
function scanValue(value: unknown, field: string, seen: WeakSet<object>): GuardHit | null {
  if (typeof value === 'string') {
    return matchValueShape(value, field);
  }
  if (typeof value === 'number') {
    // JSON number 也可承载 18 位身份证形态（如 {"id":110101199003070011}）；整串锚定。
    return ID_CARD_PATTERN.test(String(value))
      ? { code: 'EGRESS_HIGH_SENSITIVE', field }
      : null;
  }
  if (value === null || typeof value === 'boolean') {
    return null;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const hit = scanValue(value[i], `${field}[${i}]`, seen);
        if (hit) return hit;
      }
      return null;
    }
    return scanObject(value as Record<string, unknown>, field, seen);
  }
  // undefined / function / symbol：JSON.stringify 会丢弃，不构成外发内容
  return null;
}

/** 递归扫描对象键 + 值形态 */
function scanObject(
  obj: Record<string, unknown>,
  baseField: string,
  seen: WeakSet<object>,
): GuardHit | null {
  for (const [key, value] of Object.entries(obj)) {
    const field = baseField.length > 0 ? `${baseField}.${key}` : key;

    if (SECRET_KEYS.has(key)) {
      return { code: 'EGRESS_SECRET', field };
    }
    if (HIGH_SENSITIVE_KEYS.has(key)) {
      return { code: 'EGRESS_HIGH_SENSITIVE', field };
    }
    if (key === 'token') {
      if (typeof value === 'string') {
        return { code: 'EGRESS_SECRET', field };
      }
      if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        // 配额/计数字段（如 {token:128000}）放行
        continue;
      }
      // 对象/数组：作为容器继续递归，不因键名 token 额外拒绝
    }

    const hit = scanValue(value, field, seen);
    if (hit) return hit;
  }
  return null;
}

/**
 * 发送前硬禁止拦截（纯函数，只读输入）。
 *
 * 命中即返回 `ok:false` 并各留一条 `log.warn`（仅 code + 字段路径，不含值）；
 * 未命中返回 `ok:true`。不修改 body。
 */
export function guardEgress(input: EgressGuardInput): EgressGuardResult {
  if (input.baseUrl !== input.allowedBaseUrl) {
    log.warn({ code: 'EGRESS_ENDPOINT' }, 'LLM 出站请求被硬禁止拦截');
    return { ok: false, code: 'EGRESS_ENDPOINT' };
  }

  const hit = scanValue(input.body, '', new WeakSet<object>());
  if (hit !== null) {
    log.warn({ code: hit.code, field: hit.field }, 'LLM 出站请求被硬禁止拦截');
    return { ok: false, code: hit.code, field: hit.field };
  }
  return { ok: true };
}

/**
 * 拦截错误 — 由 base.ts 在 fetch 之前抛出，携带稳定 code 与字段路径；
 * message 只含 code/字段名，不含任何被拦值（避免错误回显泄漏）。
 */
export class EgressGuardError extends Error {
  readonly code: EgressCode;
  readonly field?: string;

  constructor(code: EgressCode, field?: string) {
    super(`LLM 出站请求被硬禁止拦截：${code}${field === undefined ? '' : `（字段：${field}）`}`);
    this.name = 'EgressGuardError';
    this.code = code;
    if (field !== undefined) this.field = field;
  }
}
