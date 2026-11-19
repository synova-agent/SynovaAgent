/**
 * lib/auth-session.ts — I-2 renderer 认证会话（双模式，token 仅内存）
 *
 * 两种模式（DEV DOC v2 变更 4）：
 *   · devmode（默认）：不发送 Authorization 头，沿用服务端 DevMode 自动管理员身份；
 *   · token：`Authorization: Bearer <jwt>`，token 来自 `POST /api/auth/login`，只存在本模块内存。
 *
 * 契约（铁律 47）:
 *   @input   login(email, password, options?)｜logout()｜expireSession()（401 时由 dsh-run-api 调用）
 *   @output  authSnapshot() → {mode, token, state}；authHeader() → 可展开进 fetch init.headers 的增量头
 *   @degraded 网络异常／响应非 JSON／缺少 token ⇒ LoginResult 的 degraded，console.warn 留痕（不抛）
 *   @error   登录被服务端拒绝 ⇒ LoginResult 的 error（保留 httpStatus/code/message）；永不抛
 *   @not-here 不落盘 token（无 localStorage/sessionStorage/indexedDB/文件写入）、不把 token 写进日志
 */
import { getApiBase } from './api';

export type AuthMode = 'devmode' | 'token';

/** UI 可见认证态：devmode＝开发模式；unauthenticated＝未登录；expired＝登录过期；authenticated＝已登录 */
export type DshAuthState = 'devmode' | 'authenticated' | 'unauthenticated' | 'expired';

export interface AuthSnapshot {
  mode: AuthMode;
  token: string | null;
  state: DshAuthState;
}

export interface LoginError {
  kind: 'error' | 'degraded';
  httpStatus: number | null;
  code: string;
  phase: string;
  retryable: boolean;
  message: string;
}

export type LoginResult = { kind: 'ok'; token: string } | LoginError;

/** 本模块只依赖 fetch 响应的最小形状（登录不需要 body 流） */
export interface AuthResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type AuthFetch = (url: string, init: RequestInit) => Promise<AuthResponse>;

export interface AuthCallOptions {
  base?: string;
  fetchImpl?: AuthFetch;
}

// ── 内存态（模块级）：token 只在这里，不进入浏览器存储／磁盘／日志 ──────────
let mode: AuthMode = 'devmode';
let token: string | null = null;
let expired = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveBase(base: string | undefined): string {
  const raw = base === undefined ? getApiBase() : base;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * 当前认证快照（store／Panel 的可见态来源）。
 * @output {mode, token, state}——state 优先级：已登录 > 过期 > DevMode > 未登录
 */
export function authSnapshot(): AuthSnapshot {
  const state: DshAuthState = token !== null
    ? 'authenticated'
    : expired
      ? 'expired'
      : mode === 'devmode' ? 'devmode' : 'unauthenticated';
  return { mode, token, state };
}

/**
 * 请求头增量：token 模式且已登录 ⇒ `Authorization: Bearer <jwt>`；DevMode／未登录／过期 ⇒ 空对象。
 * @output 可直接 `...authHeader()` 展开进 fetch init.headers
 */
export function authHeader(): Record<string, string> {
  if (mode === 'token' && token !== null) return { Authorization: `Bearer ${token}` };
  return {};
}

/**
 * 登录：`POST /api/auth/login`，body `{email, password}`；成功后 token 仅存内存。
 * @input  email/password；可选 base 与 fetchImpl（测试注入）
 * @output ok(token) ｜ error（服务端拒绝：401/403/400 等）｜ degraded（网络/非 JSON/缺 token）
 * @degraded 网络与响应形状问题不抛，console.warn 留痕
 * @error   永不抛出异常
 */
export async function login(email: string, password: string, options: AuthCallOptions = {}): Promise<LoginResult> {
  // 一旦尝试真实账登录，客户端即进入 token 模式；登录失败也保持未登录（不回退 DevMode，
  // 避免「登录失败后静默发未认证请求」）。
  mode = 'token';
  token = null;
  expired = false;
  const fetchImpl: AuthFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  let response: AuthResponse;
  try {
    response = await fetchImpl(`${resolveBase(options.base)}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    const message = `网络异常：${messageOf(error)}`;
    console.warn(`[auth-session] 登录失败：${message}`);
    return { kind: 'degraded', httpStatus: null, code: 'NETWORK_ERROR', phase: 'auth', retryable: true, message };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    const message = `响应非 JSON：${messageOf(error)}`;
    console.warn(`[auth-session] 登录失败：${message}`);
    return { kind: 'degraded', httpStatus: response.status, code: 'INVALID_RESPONSE', phase: 'auth', retryable: true, message };
  }
  if (!response.ok) {
    const body = isRecord(payload) ? payload : {};
    const message = typeof body.message === 'string' ? body.message : `HTTP ${response.status}`;
    const code = typeof body.code === 'string' ? body.code : response.status === 401 ? 'AUTH_FAILED' : 'AUTH_ERROR';
    console.warn(`[auth-session] 登录被拒绝（HTTP ${response.status}）：${message}`);
    return { kind: 'error', httpStatus: response.status, code, phase: 'auth', retryable: false, message };
  }
  const value = isRecord(payload) && typeof payload.token === 'string' && payload.token.length > 0 ? payload.token : null;
  if (value === null) {
    const message = '登录响应缺少 token';
    console.warn(`[auth-session] 登录失败：${message}`);
    return { kind: 'degraded', httpStatus: response.status, code: 'INVALID_RESPONSE', phase: 'auth', retryable: true, message };
  }
  token = value;
  return { kind: 'ok', token: value };
}

/** 登出：清内存 token 并回到默认 DevMode（未配置真实账登录时的既有行为）。 */
export function logout(): void {
  mode = 'devmode';
  token = null;
  expired = false;
}

/** 401 统一失效处理：清 token 并标记过期（保持 token 模式，UI 提示重新登录）。 */
export function expireSession(): void {
  token = null;
  expired = true;
}
