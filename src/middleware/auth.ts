/**
 * middleware/auth.ts — JWT 认证中间件 (Phase 0.1, Desktop 实施方案)
 *
 * 使用 Node.js built-in crypto 实现 HMAC-SHA256 JWT。
 * 零外部依赖。v2 可换 jsonwebtoken 库支持 RS256/OIDC。
 *
 * 设计原则:
 * - JWT_SECRET 缺失时降级到 devMode（不自爆），但 log.warn 警告
 * - 撤销 token 通过 in-memory Set 追踪（v2 迁移到 SQLite 持久化）
 * - whitelist 路径跳过认证（本文件 isWhitelisted() 是唯一白名单源——server.ts 无第二份，
 *   D595 修正此注释：原文"同 server.ts 白名单"已过期失真）
 * - 所有错误路径返回统一 JSON 格式 { ok: false, code, message }
 */
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '@synova/logger';
import type { WorkspaceRole } from './rbac';
import { runWithContext } from '../services/request-context';

const log = createLogger('auth');

// ════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════

export interface JwtPayload {
  sub: string;   // userId
  role: string;  // WorkspaceRole | 'ga'
  orgId: string; // tenant/org ID
  iat: number;   // issued at (Unix seconds)
  exp: number;   // expires at (Unix seconds)
  jti: string;   // JWT ID (唯一，用于撤销)
}

export interface AuthRequestContext {
  role: WorkspaceRole | 'ga';
  userId: string;
  orgId: string;
}

// ════════════════════════════════════════════════════════════════
// Configuration
// ════════════════════════════════════════════════════════════════

/**
 * 获取 JWT 签名密钥。
 * JWT_SECRET 缺失时返回 null——此时中间件降级到 devMode。
 * 生产环境必须设置 JWT_SECRET。
 */
function getSecret(): string | null {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  // 允许 devMode 无 JWT_SECRET（自动降级）
  if (process.env.DEV_MODE === 'true') return null;
  // 非 devMode 且无 JWT_SECRET → 仍然降级但严重警告
  if (!secret) {
    log.error('JWT_SECRET not set! Authentication will be disabled. Set JWT_SECRET for production.');
    return null;
  }
  if (secret.length < 16) {
    log.warn('JWT_SECRET is too short (<16 chars). For demo only. Use a strong secret in production.');
    return secret;
  }
  return secret;
}

/**
 * 获取 Token 有效期（秒）。
 * 默认 7 天。可通过 JWT_EXPIRY 环境变量覆盖。
 */
function getExpiresIn(): number {
  const env = process.env.JWT_EXPIRY;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 7 * 24 * 3600; // 7 天
}

/**
 * 白名单路径——跳过认证。
 * 唯一源 = 本文件 isWhitelisted()（server.ts 无第二份白名单，jwtAuthMiddleware 全局挂载于 server.ts:315）。
 * 白名单含 login/register（D483: 匿名注册可达，多租户 onboarding 底座）。
 * D484: enterprise 匿名端点——企业注册 + 邀请查询/接受（邀请链接直达语义，token 即凭证；
 * 复数 /api/enterprise/invitations 管理端点不匹配 invitation/ 前缀，保持认证 + requireAdmin）。
 *
 * D590（创始人裁决① 鉴权过桥）: 新增三前缀——/api/diagnosis/consult（consult 五端点族）、
 * /api/conversations（对话 SSE）、/api/sessions（会话读回）。
 * 安全模型 = 单机本地信任（对齐 /api/sentinel/* 先例）：本进程面向单 GA 的本地桌面/内网部署，
 * 信任边界是机器本身而非 HTTP 凭证——"配置完 LLM 即可对话"（D575 承诺）依赖免 JWT 直达。
 * 多用户/公网阶段按施工图 §5.5 重构为会话级鉴权（README「安全模型」节有显式声明）。
 *
 * D593（审计 §7 行②④ 对齐）: 新增五前缀——/api/diagnosis/reports（报告列表，桌面刷新恢复）、
 * /api/notifications（通知）、/api/solutions（方案）、/api/ga/clients + /api/ga/switch（GA 客户
 * 与切换）。同 D590 裁决①单机本地信任模型；精确前缀（/api/diagnosis/reports 不放宽
 * /api/diagnosis/ 全前缀——避免误豁免 D590 已下线的 upload/status 410 路径族）。
 *
 * D595（MCP HTTP 桥）: 新增三前缀——/api/ontology/graph/（query_ontology）、/api/ontology/ingest
 * （ingest_document）、/api/knowledge/ask（knowledge_ask）。MCP server 的 HTTP 桥接工具以
 * localhost fetch 调用这些端点，缺白名单时生产态（DEV_MODE=false）必 401。信任模型同 D590
 * 裁决①（单机本地信任；MCP stdio 侧另有显式信任声明 + 读写两级权限，见 README「安全模型」节）。
 */
function isWhitelisted(path: string): boolean {
  return (
    path === '/health' ||
    path === '/' ||
    path === '/api/auth/login' ||
    path === '/api/auth/register' ||
    path === '/api/enterprise/register' ||
    path.startsWith('/api/enterprise/invitation/') ||
    path.startsWith('/api/status') ||
    path.startsWith('/assets/') ||
    path.endsWith('.html') ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.ico') ||
    path === '/cockpit' ||
    path === '/api/healthz' ||
    path.startsWith('/api/sentinel/') ||
    path.startsWith('/api/cockpit/') ||
    path.startsWith('/api/diagnosis/consult') || // D590 裁决① — 桌面端诊断链路（consult 五端点族）
    path.startsWith('/api/diagnosis/reports') || // D593 — 报告列表（桌面刷新恢复，P0-1 收尾）
    path.startsWith('/api/conversations') ||     // D590 裁决① — 对话 SSE 端点
    path.startsWith('/api/sessions') ||          // D590 裁决① — 会话读回（对话验收闭环）
    path.startsWith('/api/notifications') ||     // D593 — 通知（审计 §7 行④）
    path.startsWith('/api/solutions') ||         // D593 — 方案（审计 §7 行②）
    path.startsWith('/api/ga/clients') ||        // D593 — GA 客户（审计 §7 行②）
    path.startsWith('/api/ga/switch') ||         // D593 — GA 客户切换
    path.startsWith('/api/ontology/graph/') ||   // D595 — MCP query_ontology HTTP 桥（单机信任模型）
    path === '/api/ontology/ingest' ||           // D595 — MCP ingest_document HTTP 桥（单机信任模型）
    path.startsWith('/api/knowledge/ask')        // D595 — MCP knowledge_ask HTTP 桥（单机信任模型）
  );
}

// ════════════════════════════════════════════════════════════════
// JWT 核心操作（Base64URL + HMAC-SHA256）
// ════════════════════════════════════════════════════════════════

const JWT_HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

/**
 * 签发 JWT。
 * @param payload - 载荷（不含 iat/jti/exp，自动填充）
 * @returns JWT 字符串，或 null（密钥不可用时）
 */
export function signJwtToken(
  payload: Omit<JwtPayload, 'iat' | 'jti' | 'exp'>,
): string | null {
  const secret = getSecret();
  if (!secret) return null;

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = getExpiresIn();

  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
    jti: randomUUID(),
  };

  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signingInput = `${JWT_HEADER}.${payloadB64}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * 验证 JWT。
 * @param token - JWT 字符串
 * @returns 解析结果：成功返回 payload，失败返回 error 信息
 */
export function verifyJwtToken(token: string): { payload: JwtPayload | null; error?: string } {
  if (!token) {
    return { payload: null, error: 'Token is empty' };
  }

  const secret = getSecret();
  if (!secret) {
    return { payload: null, error: 'JWT_SECRET not configured' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { payload: null, error: 'Invalid token format' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 验证签名（timing-safe 比较，防时序攻击）
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', secret).update(signingInput).digest('base64url');

  try {
    const sigBuffer = Buffer.from(signatureB64, 'base64url');
    const expectedBuffer = Buffer.from(expectedSig, 'base64url');
    if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { payload: null, error: 'Invalid signature' };
    }
  } catch (sigErr) {
    log.debug({ err: sigErr }, 'Signature verification error');
    return { payload: null, error: 'Signature verification error' };
  }

  // 解码 payload
  let payload: JwtPayload;
  try {
    const decoded = Buffer.from(payloadB64, 'base64url').toString('utf8');
    payload = JSON.parse(decoded) as JwtPayload;
  } catch (decodeErr) {
    log.debug({ err: decodeErr }, 'Invalid payload encoding');
    return { payload: null, error: 'Invalid payload encoding' };
  }

  // 必须字段检查
  if (!payload.sub || !payload.role || !payload.jti) {
    return { payload: null, error: 'Missing required fields in token' };
  }

  // 过期检查
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    return { payload: null, error: 'Token expired' };
  }

  // 撤销检查
  if (isTokenRevoked(payload.jti)) {
    return { payload: null, error: 'Token revoked' };
  }

  return { payload };
}

// ════════════════════════════════════════════════════════════════
// Token 撤销管理（in-memory，v2 迁移到 SQLite）
// ════════════════════════════════════════════════════════════════

const revokedTokens = new Set<string>();

/**
 * 撤销 JWT。
 * @param token - 完整 JWT 字符串
 * @returns true=撤销成功，false=token 无效
 */
export function revokeToken(token: string): boolean {
  const result = verifyJwtToken(token);
  if (!result.payload) return false;

  revokedTokens.add(result.payload.jti);
  log.warn({ jti: result.payload.jti, sub: result.payload.sub }, 'Token revoked');
  return true;
}

/**
 * 检查 JWT ID 是否已被撤销。
 * @param jti - JWT ID
 */
export function isTokenRevoked(jti: string): boolean {
  return revokedTokens.has(jti);
}

/**
 * 清空撤销列表（用于测试或重置）。
 */
export function clearRevokedTokens(): void {
  revokedTokens.clear();
}

// ════════════════════════════════════════════════════════════════
// D947: 权限过滤条件派生（唯一漏斗）
// ════════════════════════════════════════════════════════════════

/**
 * 知识块敏感度级别——与 l4/knowledge-store.ts 的
 * `KnowledgeChunk.accessSensitivity` 同源（'normal' | 'sensitive' | 'restricted'）。
 * 数组顺序即级别高低，索引越大越敏感。
 */
const CHUNK_SENSITIVITY_LEVELS = ['normal', 'sensitive', 'restricted'];

/**
 * 由认证身份派生「可读知识块敏感度」白名单。
 *
 * 契约:
 *   输入 — role（JWT 验签后的角色）、clearance（请求上下文声明的敏感度上限）
 *   输出 — 级别白名单数组，恒非空且至少含 'normal'；用于 FilterClause 的
 *          `access.sensitivity` IN 条件（l4/knowledge-store.ts:701 matchFilter 为 AND 语义）
 *   降级 — role/clearance 无法识别时回落最窄白名单 ['normal']（fail-closed，绝不放宽）
 *
 * @param role - 验签后的角色；'admin' 不受 clearance 限制
 * @param clearance - 上下文声明的敏感度上限
 */
function allowedSensitivities(role: string, clearance: string): string[] {
  const levels: string[] = [...CHUNK_SENSITIVITY_LEVELS];
  const ceilingIndex = role === 'admin'
    ? levels.length - 1
    : Math.max(0, levels.indexOf(clearance));
  return levels.slice(0, ceilingIndex + 1);
}

// ════════════════════════════════════════════════════════════════
// Express Middleware
// ════════════════════════════════════════════════════════════════

/**
 * JWT 认证中间件。
 *
 * 替换 server.ts 中的内联 auth 中间件。
 * 与 request-context.ts 的 runWithContext 配合使用。
 */
export function jwtAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    // 白名单路径——跳过认证。
    //
    // D947/L-20: 白名单语义 = 「**不要求**认证」，不等于「**忽略**认证」。
    // 原实现直接 next()，使白名单路径**永不注入 req.auth**（注入只在下方非白名单分支），
    // 后果：白名单路径上的路由内 requireAuth（extractAuthFromRequest，如 solutions.ts:36/93
    // 的 GET /api/solutions）**无法被任何合法凭据满足** —— 删除自报通道后该端点对全部客户端恒 401。
    // 修法：白名单分支内**尝试**解析 Bearer，**仅在验签通过时**注入 req.auth；
    // 无凭据 / 无效凭据 / 验签失败 → 一律照旧放行（不得因凭据问题改变可达性）。
    // P0 不变量：注入的只能是**验签身份**；任何自报值（header/query 里的 role/userId）永不进入
    // req.auth / req.rbac。
    if (isWhitelisted(req.path)) {
      const whitelistAuthHeader = req.headers['authorization'] as string | undefined;
      if (whitelistAuthHeader && whitelistAuthHeader.startsWith('Bearer ')) {
        const whitelistToken = whitelistAuthHeader.slice(7).trim();
        const whitelistResult = whitelistToken
          ? verifyJwtToken(whitelistToken)
          : { payload: null, error: 'Token is empty' };
        if (whitelistResult.payload) {
          (req as Request & { auth?: JwtPayload }).auth = whitelistResult.payload;
        } else {
          // 留痕但**不拦截**：白名单属「不要求认证」，P5 的 fail-closed 只适用于安全判据，
          // 凭据无效不构成拦截理由（可达性必须保持不变）。沿用三态口径以便区分：
          // 判据不可用（配置缺失） vs 被拒绝（凭据无效）；whitelist:true 区分于真正的 401。
          const ignoredCode = whitelistResult.error === 'JWT_SECRET not configured'
            ? 'AUTH_UNAVAILABLE'
            : 'AUTH_REJECTED';
          log.warn(
            { code: ignoredCode, whitelist: true, reason: whitelistResult.error, path: req.path },
            '白名单路径携带 Bearer 但未被采纳 — 照旧放行（白名单=不要求认证，不拦截）',
          );
        }
      }
      return next();
    }

    // DevMode 无 JWT_SECRET：自动 admin
    const secret = process.env.JWT_SECRET;
    if (!secret && process.env.DEV_MODE === 'true') {
      log.warn(
        { code: 'AUTH_DEV_MODE_GRANT', reason: 'jwt_secret_not_configured' },
        '安全判据: 开发姿态放行（DEV_MODE=true 且无 JWT_SECRET）——非生产路径；生产须 DEV_MODE=false 并配置 JWT_SECRET',
      );
      (req as Request & { auth?: JwtPayload }).auth = {
        sub: 'dev-admin',
        role: 'admin',
        // D479: 实例 org 唯一权威是 SYNOVA_ORG_ID（与 config.ts orgId 同源），'default' 仅作 env 缺失兜底
        orgId: process.env.SYNOVA_ORG_ID || 'default',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
        jti: 'dev-mode-no-jwt',
      };
      return next();
    }

    // 提取 Authorization header
    const authHeader = req.headers['authorization'] as string | undefined;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      log.warn(
        { code: 'AUTH_REJECTED', reason: 'missing_or_invalid_authorization_header', path: req.path },
        '安全判据: 被拒绝 — 缺 Authorization/Bearer 头（HTTP 401，fail-closed）',
      );
      res.status(401).json({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header. Use: Authorization: Bearer <token>',
      });
      return;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      log.warn(
        { code: 'AUTH_REJECTED', reason: 'empty_token', path: req.path },
        '安全判据: 被拒绝 — Authorization 头中 token 为空（HTTP 401，fail-closed）',
      );
      res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Token is empty' });
      return;
    }

    // 验证 token
    const result = verifyJwtToken(token);
    if (!result.payload) {
      // D947/P5: 三态可区分——「不可用（系统异常）」是判据配置缺失，「被拒绝」是凭据无效。
      const unavailable = result.error === 'JWT_SECRET not configured';
      const meta = {
        code: unavailable ? 'AUTH_UNAVAILABLE' : 'AUTH_REJECTED',
        reason: result.error,
        path: req.path,
      };
      const message = unavailable
        ? '安全判据: 不可用（系统异常）— JWT_SECRET 不可用，fail-closed 拒绝（HTTP 401）'
        : '安全判据: 被拒绝 — token 校验失败（HTTP 401，fail-closed）';
      if (unavailable) log.error(meta, message);
      else log.warn(meta, message);
      res.status(401).json({
        ok: false,
        code: 'UNAUTHORIZED',
        message: result.error || 'Token validation failed',
      });
      return;
    }

    // D947: 先落常量——`result.payload` 的类型收窄不会穿进下方闭包（TS18047）
    const payload = result.payload;

    // 注入 auth 到请求对象（下游 RBAC 使用）
    (req as Request & { auth?: JwtPayload }).auth = result.payload;

    // 同步注入 request-context（兼容 runWithContext 模式）
    // request-context 不可用时至少有 req.auth
    try {
      runWithContext({
        user: {
          userId: result.payload.sub,
          identity: {
            openId: result.payload.sub,
            email: `${result.payload.sub}@${result.payload.orgId}`,
            name: result.payload.sub,
            source: 'jwt' as const,
          },
          auth: {
            roles: [result.payload.role],
            teamId: result.payload.orgId,
            tenantId: result.payload.orgId,
            sensitivity: 'normal' as const,
          },
          permissions: { version: 1, expiresAt: result.payload.exp * 1000 },
        },
        authProvider: {
          /**
           * D947: 权限过滤唯一漏斗——返回的条件由**认证身份**派生，绝不返回空条件集。
           *
           * 为何非空是关键（实证）: l4/knowledge-store.ts:335 在条件集长度为 0 时
           * **完全跳过过滤**（filteredOut 恒 0，注释自述 "admin: 无过滤"，但该短路
           * 无条件生效）——空条件不等于"无限制"，而等于"不过滤"（fail-open）。
           * 原实现恒返空条件集 ⇒ 所有知识检索绕过权限判定。
           */
          getPermissionFilter: async (ctx) => ({
            conditions: [
              {
                field: 'access.sensitivity',
                operator: 'IN',
                value: allowedSensitivities(payload.role, ctx.auth.sensitivity),
              },
            ],
          }),
        },
      }, async () => {
        next();
      }).catch((ctxErr: unknown) => {
        log.warn({ err: ctxErr }, 'request-context runWithContext error, continuing with req.auth');
        next();
      });
    } catch (ctxErr: unknown) {
      log.warn({ err: ctxErr }, 'request-context not available, using req.auth only');
      next();
    }
  } catch (err: unknown) {
    log.error({ code: 'AUTH_ERROR', err }, '安全判据: 出错 — jwtAuthMiddleware 异常（HTTP 500，degraded:true）');
    res.status(500).json({ ok: false, code: 'AUTH_ERROR', message: 'Authentication error', degraded: true });
  }
}

/**
 * 从请求对象提取认证上下文（供 RBAC 和路由使用）。
 *
 * D947（默认安全姿态）: **唯一**可信来源是 `req.auth`（jwtAuthMiddleware 验签后注入）。
 * 已删除 `x-synova-token` 自报分支——该 header 不经验签即可自封 `role`
 * （如 `admin:org:user`），属默认放行姿态。无认证上下文时返回 `null`，
 * 由调用方 fail-closed 处理（例：routes/ga-auth.ts requireGa → 401）。
 *
 * 优先级:
 *   1. req.auth（JWT 中间件验签注入）
 *   2. null（未认证 → 调用方拒绝）
 */
export function extractAuthFromRequest(req: {
  auth?: JwtPayload;
  headers?: Record<string, unknown>;
}): AuthRequestContext | null {
  // 唯一可信来源：JWT 中间件注入的 auth
  if (req.auth) {
    return {
      role: req.auth.role as WorkspaceRole | 'ga',
      userId: req.auth.sub,
      orgId: req.auth.orgId,
    };
  }

  // D947: 原 x-synova-token 自报分支已删除——无验签的 `role:orgId:userId`
  // 字符串可自封任意角色（含 admin）。此处仅留痕，不据其放行。
  if (req.headers?.['x-synova-token'] !== undefined) {
    log.warn(
      { code: 'AUTH_REJECTED', reason: 'self_reported_token_header_ignored' },
      '安全判据: 被拒绝 — 忽略未验签的 x-synova-token 自报凭据（fail-closed）',
    );
  }

  return null;
}
