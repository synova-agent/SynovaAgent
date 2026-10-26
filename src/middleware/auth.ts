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
import { permissionsForRole, sensitivityWhitelistFromGrants, itemModelSpeaksForRole, type PermissionId } from '@synova/engine-auth';
import { resolveRoleKnowledgeScope } from '../init/preset-loader';
import { runWithContext, resolveContext } from '../services/request-context';

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
  /**
   * K12-10-WIRE: 部门身份（**复数** —— 一人可属多部门），随**受签名保护**的载荷下发。
   *
   * 🔴 为什么必须是载荷而不是请求头：本模块 P0 不变量是「注入 `req.auth` / 请求上下文的
   *   **只能是验签身份**，任何自报值（header/query）永不进入」（见下方白名单分支注释）。
   *   部门身份与 `role` / `orgId` 同信任级 ⇒ 若走未验签的头，等于给任意客户端一个
   *   **自助授予部门**的通道（越权面）。`x-org-id` 族头只表达"我要访问哪个组织"，
   *   **不参与身份判定** —— 同纪律。
   *
   * 可选字段：旧 token 无此声明 ⇒ `undefined` ⇒ 部门集为**空**（**不是**"全部门"，fail-closed）。
   * 逐字透传：`signJwtToken` 形参为 `Omit<JwtPayload, 'iat' | 'jti' | 'exp'>` 且实现是
   *   `{...payload}` ⇒ **签发端零改动**即可携带本字段。
   *
   * ⚠️ 运行时类型**不在此处**校验 —— 载荷来自 `JSON.parse`（外部输入）。收窄发生在
   *   `resolveContext` 内（`requestedDepartmentIds` 逐元素 `optionalString`）；
   *   调用点以 `readonly unknown[]` 结构传入（见下方 `runWithContext` 处）。
   */
  departmentIds?: readonly string[];
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
    // 🔴 K12-03 (#186) 2026-10-11 创始人裁定 2：`POST /api/onboarding/start` = **pre-auth 建档入口**。
    //   理由：建档发生在「客户企业还没有任何凭据」的阶段 —— 与上一行 `/api/enterprise/register`
    //   （建企业 + 建管理员）同一时序族；`/api/auth/login`、`/api/auth/register`、
    //   `/api/enterprise/invitation/*` 同理。
    //   判据事实：探针 `probe-onboarding.ts:196` 无条件 `app.use(jwtAuthMiddleware)` 而 fetch
    //   **不发 Authorization** ⇒ 非白名单时生产态（DEV_MODE=false）必 401 ⇒ 判据恒红，
    //   且无法区分"形状不符"与"能力缺失"（探针 `cannotJudge`）。
    //   🔴 **窄口径，只此一条**：**不** whitelist `/api/onboarding/` 前缀 ——
    //   同族其余端点（apply / 超管确认 / 配置包读取）**仍须带凭据**，卡面 V4
    //   「超管确认**权限必须过人**」才成立。
    //   ⚠️ 反例已固化为测试：`tests/middleware/onboarding-whitelist.test.ts`
    //   （未带 token 打其它 POST ⇒ 仍 401；带无效 Bearer 打白名单路径 ⇒ 照旧放行但不注入身份）。
    //   ⚠️ #194（RB 系列）开工须 rebase：本行改的是 RB 系列写集文件。
    path === '/api/onboarding/start' ||
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
 *
 * #984: 导出为**单一真源** —— `routes/im.ts`（飞书/企微入站，无 token 路径）必须
 * 复用同一份规则建 authProvider；若在此处复制第二份，安全规则就会出现两个副本
 * （本仓"唯一漏斗"注释反复警告的漂移病根）。
 */
export function allowedSensitivities(role: string, clearance: string): string[] {
  const levels: string[] = [...CHUNK_SENSITIVITY_LEVELS];
  const ceilingIndex = role === 'admin'
    ? levels.length - 1
    : Math.max(0, levels.indexOf(clearance));
  return levels.slice(0, ceilingIndex + 1);
}
/**
 * K12-11 (#194 / RB-03): **项模型**在授权判定点上的生效面（PermissionId[] → 敏感度白名单）。
 *
 * 语义: 先取**档位出厂默认**（{@link allowedSensitivities}，既有行为，逐字不动），
 *   再取该角色在**该客户槽**下**实际勾中的项**（`permissionsForRole`，真读
 *   `extensions/presets/roles/<roleId>/{tenant/<tenantId>/}capabilities.yaml`），
 *   最后取**交集**。
 *
 * 🔴 为什么是交集（只收窄、永不放宽）: 项模型是**新**面，档位默认是**既有**面。
 *   项模型若能把面放得比档位默认更宽，等于"配一个文件就自动提权"
 *   （且违背 D947 唯一漏斗的默认安全姿态）。交集保证：配包只能**减**权。
 *
 * 回落（**正常路径，不是错误**）: 角色无出厂项 / 包未命中 / 无任何「读知识」项
 *   且项模型不为此角色发声（liaison / ga / 未知角色）⇒ **逐字返回档位默认**。
 *   ⇒ 五档＝出厂默认；删掉自定义角色包 = 回落，且**不报错**（V7）。
 * 降级（**真降级**）: 包解析失败/字段非法/未知项 ⇒ `resolveGrants` 置 `degraded: true`
 *   且按出厂默认参与交集；本函数**不抛**、不静默放行，交调用方决定是否拦。
 *
 * @param role - 验签后的角色（`JwtPayload.role`）
 * @param clearance - 请求上下文声明的敏感度上限
 * @param tenantId - 客户槽（**可选**；缺省 ⇒ 只读岗位默认层）。
 *   🔴 生产调用点传 `payload.orgId` —— org 即租户（同一岗位名、不同客户 ⇒ 权限集合不同，
 *   正是创始人 2026-10-05 举的场景）。
 */
export function allowedSensitivitiesByGrants(
  role: string,
  clearance: string,
  tenantId?: string | null,
): string[] {
  const defaultLevels = allowedSensitivities(role, clearance);
  // 🔴 显式标注 `PermissionId[]`（而非仅推断）：让项模型的**类型面**在生产代码里**真被消费**（注释里出现不算接线）。
  const items: readonly PermissionId[] = permissionsForRole(role, { tenantId: tenantId ?? null });
  const grantedLevels = sensitivityWhitelistFromGrants(items);
  if (grantedLevels === null) {
    // 项集里没有「读知识」项 —— 两种语义**必须分开**（否则"客户收干净读权"被当成"没配置"）:
    //   · 项模型**为这个角色发声**（有出厂清单 / 有客户包）⇒ 它说了"不许读" ⇒ 最窄白名单
    //   · 项模型**没发声**（liaison/ga/未知角色）⇒ 逐字回落档位默认（五档＝出厂默认）
    if (itemModelSpeaksForRole(role, { tenantId: tenantId ?? null })) {
      return [CHUNK_SENSITIVITY_LEVELS[0] as string];
    }
    return defaultLevels;
  }
  const narrowed = defaultLevels.filter((l) => grantedLevels.includes(l));
  // 交集为空 = 项集与档位默认不兼容 ⇒ fail-closed 到最窄，绝不放宽
  return narrowed.length > 0 ? narrowed : [CHUNK_SENSITIVITY_LEVELS[0] as string];
}

// ════════════════════════════════════════════════════════════════
// #731 / T3: 知识 **scope 维** —— 内容文件 → 权限判定 → 知识过滤的真接线
// ════════════════════════════════════════════════════════════════

/**
 * scope 维条件用的列名 —— **I-C1/I-C2 接口契约**（与 D5 探针 `probe-knowledge-scope.ts`
 * 的 `SCOPE_FIELD` 同口径；PR1/PR2 两端必须一字不差）。
 *
 * 取名依据（不加新列、不改 store）: `knowledge_chunks.pkb_domain` 列已存在
 * （`src/l4/knowledge-store.ts:72`），且 `matchFilter` 对字段名**直通**
 * （`:701` `colMap[field] || field`）⇒ 加这一维**无需**改 `knowledge-store.ts`（本卡写集外）。
 * 值口径 = **完整 scope id**（如 `finance.statements`），不是裸域前缀（同 d-kb）。
 */
const SCOPE_FIELD = 'pkb_domain';

/** 与 `src/services/request-context.ts:39` 结构等价的条件下标（禁 `as any` 族，靠结构兼容互喂） */
interface FilterCondition {
  readonly field: string;
  readonly operator: 'IN' | 'EQ' | 'NOT_EQ' | 'CONTAINS';
  readonly value: unknown;
}

/**
 * #731 / T3 —— 由**内容文件**派生的知识 scope 过滤条件（**追加**在 sensitivity 条件之后）。
 *
 * 接口契约（队长定，见卡 `task-4`；与 D5 探针侧同口径）:
 *   - **I-C1** scope ⇒ `{ field:'pkb_domain', operator:'IN', value:<scopes[].id 去重排序> }`
 *   - **I-C2** deny  ⇒ 每个 `deny[].id` 一条 `{ field:'pkb_domain', operator:'NOT_EQ', value:id }`
 *     （`matchFilter` 只实现 IN/EQ/NOT_EQ，没有 NOT_IN ⇒ deny 只能逐 id 展开）
 *   - **I-C3** 本函数**只追加**；`access.sensitivity` 条件由调用点保持在第 0 位（K12-11 不回退）
 *   - **I-C4** **角色目录不存在**（admin / manager / employee / viewer / liaison / ga / 未知角色 ——
 *     它们不属岗位包管辖）⇒ **不追加**任何 scope/deny 条件，但 `resolveRoleKnowledgeScope` 已
 *     `log.warn`（**可观测**，不是静默跳过）⇒ 已知限制 KL-3 声明"这些岗位不受 scope 维约束"
 *   - **I-C6** 内容不可用 ⇒ **拒绝型条件集** `{ field:'pkb_domain', operator:'IN', value: [] }` ——
 *     `IN` 对空数组恒 false ⇒ 每一行都被过滤（与 `src/services/request-context.ts:388` 的 DENY_ALL
 *     同一机制），**绝不回落"不过滤"**（那是 fail-open，正是本批要杀的病）。
 *     🔴 覆盖**三态**：① 内容坏（非法 YAML / 缺 `scopes[]` / 空 `scopes[]` / 重复 id）；
 *     ② **角色目录存在但 `knowledge-scope.yaml` 缺失/不可读/为空文档**（自验抓到的真 fail-open：
 *     曾把它当 I-C4 处理 ⇒ 删掉文件即看全库）；③ 解析过程未预期异常。
 *     ⚠️ 只有 **I-C4（目录不存在）** 才有"不追加"这条路 —— "读不到"永远不许等于"不收"。
 *
 * @input  `role` — 验签身份里的角色（`JwtPayload.role`，**唯一可信来源**；不读任何请求头）
 * @output 条件数组：`[]`（仅 I-C4：角色目录不存在）｜`1`（fail-closed 的 `IN []`）｜`1 + N`（IN ＋ N 条 NOT_EQ）
 * @degraded 内容坏/缺件 ⇒ 拒绝型 ＋ `log.error`（日志在 `resolveRoleKnowledgeScope` 内，带
 *           `KNOWLEDGE_SCOPE_INVALID` ／ `KNOWLEDGE_SCOPE_MISSING` ／ `KNOWLEDGE_SCOPE_RESOLVE_FAILED` typed code）。
 *           **本函数从不抛** —— 它在每个请求的判定路径上跑。
 *
 * 设计哲学（一句）: **权限条件只从「验签身份 ＋ 内容文件」派生，且只能收窄** —— 文件在就按它收，
 *   文件坏就收到底；唯一不允许的是"因为读不到而不收"。
 */
function knowledgeScopeConditions(role: string): FilterCondition[] {
  const decl = resolveRoleKnowledgeScope(role);
  if (decl.degraded) {
    // I-C6: fail-closed 到"看不到任何知识"，而不是"看不到限制"。
    // 🔴 刻意**只**给这一条最小拒绝型：`IN []` 对每一行恒 false，已使 deny 的 NOT_EQ 冗余；
    //   （内容坏时 deny 列表本身可能就是不可信的，少派生一条条件 = 少一个"看起来生效"的假象。）
    return [{ field: SCOPE_FIELD, operator: 'IN', value: [] }];
  }
  if (!decl.declared || decl.scopeIds.length === 0) {
    // I-C4（**仅此一路**）: 角色目录不存在 ⇒ 该岗位不属岗位包管辖 ⇒ 不追加 scope 维。
    // 🔴 可观测性由 resolveRoleKnowledgeScope 的 log.warn 承担；"读不到"的其它形态已在上方
    //   被折成 degraded ⇒ 走 fail-closed，**不会**落到这里（否则就是 fail-open）。
    return [];
  }
  const allowed = [...new Set(decl.scopeIds)].slice().sort();
  const conditions: FilterCondition[] = [{ field: SCOPE_FIELD, operator: 'IN', value: allowed }];
  for (const denied of new Set(decl.denyIds)) {
    conditions.push({ field: SCOPE_FIELD, operator: 'NOT_EQ', value: denied });
  }
  return conditions;
}

// ════════════════════════════════════════════════════════════════
// D… K12-09 (#192 原 RB-01): 多租户隔离 — 跨 orgId 读必须被拒
// ════════════════════════════════════════════════════════════════

/**
 * 请求声明「目标组织」的**唯一**属性族：本卡**可执行**的跨租户判据面。
 *
 * 命名空间实测干净（as_of `be57f90fb`，命令:
 * `grep -rn "x-org-id|X-Org-Id|x-tenant-id" src/ tests/ docs/ app/` ⇒ 零命中）
 * ⇒ 无既有客户端在用，可安全引入；且**不与** `extractAuthFromRequest` 已明确拒绝的
 * 自报凭据族（`x-synova-token`）混淆——本族**不**参与身份判定，只表达"我要访问哪个组织"。
 */
const ORG_DECLARATION_HEADERS = ['x-org-id', 'x-tenant-id'] as const;

/**
 * 请求声明的目标组织。
 *
 * @input  headers — express 的 `req.headers`（HTTP 头名已被 Node 规范化为小写）
 * @output 声明值（已 `trim`）或 `undefined`（未声明 / 空串 / 非字符串的重复头数组）
 * @degraded 无。读取失败不产生放行路径——`undefined` 的含义是「未声明目标组织」，
 *           此时隔离判定按"不适用"处理（无声明即无跨租户诉求），**不是**放行豁免。
 */
function declaredOrgIdOf(headers: Record<string, unknown>): string | undefined {
  for (const name of ORG_DECLARATION_HEADERS) {
    const raw = headers[name];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    // 头名大小写不敏感、重复头被 Node 折成 `a, b` ⇒ 折值不构成组织标识，按未声明处理
    if (!value || value.includes(',')) continue;
    return value;
  }
  return undefined;
}

/** 跨组织访问判定结果（判别联合：`denied` 为 `true` 时另两个字段必非空） */
type CrossOrgDecision =
  | { denied: false; declaredOrgId?: string }
  | { denied: true; declaredOrgId: string; authOrgId: string; reason: 'org_mismatch' | 'auth_org_missing' };

/**
 * 多租户隔离判定 —— 「请求声明的目标组织」vs「验签身份的组织」。
 *
 * 契约（铁律 47）:
 *   @input  — headers: `req.headers`；authOrgId: **验签身份**的组织声明（`req.auth.orgId`
 *             或 DevMode 下的实例组织 `SYNOVA_ORG_ID`）。**缺失 / 空串** ⇒ 判据不可用。
 *   @output — `{ denied:false, declaredOrgId? }` 放行（未声明目标组织，或声明与身份一致）；
 *             `{ denied:true, declaredOrgId, authOrgId, reason }` 拒绝：`reason` 二态
 *             `org_mismatch`（声明 ≠ 身份）/ `auth_org_missing`（有声明但身份无组织 → 判据不可用）。
 *   @degraded — **无**。本函数**没有**降级放行路径：判据不可用时的处置是**收窄为拒绝**
 *             （fail-closed），与"放行"是两件事（铁律 11/24 的降级语义在此**反向**适用——
 *             安全判据的不可用态必须比可用态更严，否则"配置缺失"就成了越权通道）。
 *
 * 为何两条姿态路径共用（K12-09 卡面 §②「姿态漏洞」）:
 *   `DEV_MODE=true` 且无 `JWT_SECRET` 时中间件自动授予 admin。若隔离判定只挂在认证路径，
 *   **开发姿态下那道墙就会消失**。本函数由两侧**共用** ⇒ 「DevMode 只提升**单租户内**权限、
 *   不跨租户」是**结构事实**，不是两处分别约定的行为。
 *
 * 不变量: 本函数**只**依据「验签身份 + 显式声明」两个输入判定，
 *   不读 `body` / `query` 的 `orgId` —— 卡面禁止改动非隔离逻辑，而 `body.orgId` 是
 *   **路由级**租户派生源（`routes/conversations.ts:167`、`routes/admin-knowledge.ts:117`），
 *   在此拦截属判据变更（须先改卡）。边界已写入交付回执。
 *
 * @param headers - 请求头（express `req.headers`）
 * @param authOrgId - 验签身份的组织；`undefined` / `null` / 空串 = 判据不可用
 */
function evaluateCrossOrgAccess(
  headers: Record<string, unknown>,
  authOrgId: string | null | undefined,
): CrossOrgDecision {
  const declaredOrgId = declaredOrgIdOf(headers);
  if (!declaredOrgId) return { denied: false };
  const identityOrgId = typeof authOrgId === 'string' ? authOrgId.trim() : '';
  if (!identityOrgId) {
    // 有声明、却没有任何身份可与之比对 ⇒ **不得**因"无法比对"而放行（那是把配置缺失
    // 变成越权通道）。收窄为拒绝，并如实标注 reason 以便区分"身份不一致"与"身份缺失"。
    return { denied: true, declaredOrgId, authOrgId: '', reason: 'auth_org_missing' };
  }
  if (declaredOrgId !== identityOrgId) {
    return { denied: true, declaredOrgId, authOrgId: identityOrgId, reason: 'org_mismatch' };
  }
  return { denied: false, declaredOrgId };
}

/**
 * 跨组织拒绝的**唯一**应答点（认证路径 / DevMode 路径 / 白名单路径共用）。
 *
 * 契约（铁律 47）:
 *   @input  — res: express Response；decision: **必定** `denied:true` 的判定结果；
 *             path: 请求路径（留痕用）
 *   @output — 已写出 HTTP **403** + `{ ok:false, code:'CROSS_ORG_FORBIDDEN',
 *             declaredOrgId, authOrgId }`；无返回值（调用方 `return`，`next()` 不执行）。
 *   @degraded — 无。拒绝是**确定结论**，不是降级 ⇒ 响应体**不带** `degraded` 标记
 *             （带标记会被下游误读为"服务不可用可重试"，而本条是"凭据越权，重试无用"）。
 *
 * 为何 403 而**非** 404: 对齐本仓既有路由级跨租户判据（`routes/overflow.ts:52-57` 用
 *   `FORBIDDEN`）与 DSH `InvariantError{code,packageName}` 的"机器可读拒绝码 + 归属"取向。
 *   静默 404 会让调用方把"越权"与"资源不存在"混为一谈（不可观测 = 不可审计）。
 */
function denyCrossOrgAccess(
  res: Response,
  decision: CrossOrgDecision & { denied: true },
  path: string,
): void {
  log.warn(
    {
      code: 'CROSS_ORG_FORBIDDEN',
      reason: decision.reason,
      declaredOrgId: decision.declaredOrgId,
      authOrgId: decision.authOrgId,
      path,
    },
    '安全判据: 被拒绝 — 请求声明的目标组织与验签身份不一致（跨 orgId 读，HTTP 403 fail-closed；DevMode 亦不放行）',
  );
  res.status(403).json({
    ok: false,
    code: 'CROSS_ORG_FORBIDDEN',
    message: '请求声明的目标组织与认证身份不一致',
    declaredOrgId: decision.declaredOrgId,
    authOrgId: decision.authOrgId,
  });
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
export async function jwtAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      const whitelistHasBearer = Boolean(whitelistAuthHeader?.startsWith('Bearer '));
      const whitelistToken = whitelistHasBearer ? (whitelistAuthHeader ?? '').slice(7).trim() : '';
      const whitelistResult = whitelistToken
        ? verifyJwtToken(whitelistToken)
        : { payload: null, error: 'Token is empty' };
      // K12-09 (#192): 白名单语义 = 「**不要求**认证」，**不等于**「跨租户可读」。
      // 身份解析三态（与下方认证路径同一判定函数、同一 DevMode 身份源）:
      //   ① 验签通过     ⇒ 身份 = 凭据载荷（权威；DevMode 的实例身份**不**覆盖它）
      //   ② DevMode 姿态 ⇒ 身份 = 实例组织（`SYNOVA_ORG_ID`，与认证路径同源）
      //      ⚠️ ② **不要求凭据有效** —— 否则"带无效 Bearer + 声明异组织"会落进
      //      「凭据无效照旧放行」的旧分支，成为绕过墙的通道（本卡 V3 实测到的洞）。
      //   ③ 其余（非 DevMode 且无有效凭据）⇒ 无身份可建立
      // 判定在**有身份时**一律执行；无身份**且**请求声明了目标组织 ⇒ 收窄为拒绝
      // （fail-closed：显式声明却无法验证 ⇒ 拒绝，绝不放行）。
      const whitelistDevMode = !process.env.JWT_SECRET && process.env.DEV_MODE === 'true';
      const whitelistIdentity = whitelistResult.payload?.orgId
        ?? (whitelistDevMode ? (process.env.SYNOVA_ORG_ID || 'default') : null);
      const whitelistDecision = evaluateCrossOrgAccess(req.headers, whitelistIdentity);
      if (whitelistDecision.denied) {
        denyCrossOrgAccess(res, whitelistDecision, req.path);
        return;
      }
      if (whitelistResult.payload) {
        (req as Request & { auth?: JwtPayload }).auth = whitelistResult.payload;
      } else if (whitelistHasBearer) {
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
      return next();
    }

    // DevMode 无 JWT_SECRET：自动 admin
    const secret = process.env.JWT_SECRET;
    if (!secret && process.env.DEV_MODE === 'true') {
      // D479: 实例 org 唯一权威是 SYNOVA_ORG_ID（与 config.ts orgId 同源），'default' 仅作 env 缺失兜底
      const devModeOrgId = process.env.SYNOVA_ORG_ID || 'default';
      // K12-09 (#192) V3: DevMode **只提升单租户内权限，不跨租户** —— 隔离判定与认证路径
      // **共用同一函数**（此处刻意放在 AUTH_DEV_MODE_GRANT 留痕之前：拒绝请求不产生"授权"记录，
      // 避免审计面上把一次拒绝读成一次放行）。
      const devModeDecision = evaluateCrossOrgAccess(req.headers, devModeOrgId);
      if (devModeDecision.denied) {
        denyCrossOrgAccess(res, devModeDecision, req.path);
        return;
      }
      log.warn(
        { code: 'AUTH_DEV_MODE_GRANT', reason: 'jwt_secret_not_configured' },
        '安全判据: 开发姿态放行（DEV_MODE=true 且无 JWT_SECRET）——非生产路径；生产须 DEV_MODE=false 并配置 JWT_SECRET',
      );
      (req as Request & { auth?: JwtPayload }).auth = {
        sub: 'dev-admin',
        role: 'admin',
        orgId: devModeOrgId,
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

    // K12-09 (#192) V2: 验收后的**跨 orgId 隔离判定** —— 请求声明的目标组织必须与
    // 验签身份一致，否则拒绝（含下方 DevMode 分支，两侧共用同一判定函数）。
    // 位置是判据的一部分: 必须在**验签之后**（身份已可信）、**注入 req.auth 之前**
    // （被拒请求不得把身份留在请求对象上，避免下游误用）。
    const crossOrgDecision = evaluateCrossOrgAccess(req.headers, payload.orgId);
    if (crossOrgDecision.denied) {
      denyCrossOrgAccess(res, crossOrgDecision, req.path);
      return;
    }

    // 注入 auth 到请求对象（下游 RBAC 使用）
    (req as Request & { auth?: JwtPayload }).auth = result.payload;

    // 同步注入 request-context（兼容 runWithContext 模式）
    // request-context 不可用时至少有 req.auth
    try {
      /**
       * K12-10-WIRE: **请求路径接入部门身份**（收口上一卡的缺口）。
       *
       * 缺口实测（本卡开工基线，真 express ＋ 真中间件 ＋ 真 HTTP）：
       *   `BASELINE-RESULT: {"userSeen":"u-baseline","depts":[]}`
       *   ⇒ 上下文本身是通的（`userSeen` 非空），但 `getCurrentDepartmentIds()` 恒 `[]` ——
       *   因为 `resolved` 从未被塞进上下文：`resolveContext` 的真触发点只有 boot
       *   （`server.ts` → `bootstrap.ts` → `initContentTypes()`），**不在请求路径**。
       *
       * 🔴 顺序是判据的一部分（不是风格）：`runWithContext(ctx, fn)` 即
       *   `storage.run(ctx, fn)`，AsyncLocalStorage 的存储沿 **`fn()` 同步帧内新建的续延链**
       *   传播。`resolveContext` 是 **async** ⇒ 若把 `await resolveContext(...)` 写在
       *   `runWithContext` 的**入参对象字面量里**，该 Promise 的续延是在 `storage.run`
       *   **之外**创建并已存在的 ⇒ await 之后那一帧已脱离存储。
       *   ⇒ **必须先 await 解析、再进 `storage.run`**（本卡实测：`next()` 在 `fn` 同步帧内
       *   调用 ⇒ 续延在存储内 ⇒ 下游可见）。
       *
       * 边界：**只读验签载荷**（`payload.departmentIds`），不读任何请求头 —— 见
       *   `JwtPayload.departmentIds` 的说明（自报值永不进身份面，D947 P0 不变量）。
       *   载荷是外部输入（`JSON.parse`）⇒ 以 `readonly unknown[]` 结构类型传入，
       *   运行时收窄在 `resolveContext` 内（`requestedDepartmentIds` 逐元素校验）。
       *   此处**不写断言**：断言会掩盖"载荷类型不可信"这个事实。
       */
      const identity = {
        userId: payload.sub,
        departmentIds: payload.departmentIds as readonly unknown[] | undefined,
      };

      /**
       * 解析失败 ⇒ **降级不静默**（铁律 11/24/31）但**不阻断认证**：
       * `resolveContext` 的契约是"不抛"，此处 try/catch 是防御其**将来**变更
       * （远端部门源）——降级为空部门集，`req.auth` 仍在，请求照常下行。
       */
      let departmentSource: Awaited<ReturnType<typeof resolveContext>> | undefined;
      try {
        departmentSource = await resolveContext(identity);
      } catch (resolveErr: unknown) {
        log.warn(
          { err: resolveErr, code: 'K12_10_DEPT_RESOLVE_FAILED', degraded: true, userId: payload.sub },
          'request-context 部门解析失败 — 部门集降级为空（degraded:true，未静默），认证不受影响',
        );
      }

      if (departmentSource?.degraded) {
        log.warn(
          {
            code: 'K12_10_DEPT_DEGRADED',
            degraded: true,
            degradedReasons: departmentSource.degradedReasons,
            userId: payload.sub,
          },
          'request-context 部门解析降级（真源未就位/定义不可用）— 部门集按已解析部分生效，请求照常下行',
        );
      }

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
                // 🔴 K12-11 (#194 / RB-03): 敏感度白名单由**项模型**派生
                //   （`PermissionId[]` → 交集），**不是**纯档位派生。
                //   改动面严格窄: 档位默认（allowedSensitivities）逐字保留为 L0 出厂值，
                //   项模型只能收窄。反例（改回纯档位）⇒ 客户包内的 denies 不再生效 ⇒ 判据红。
                //   `payload.orgId` = 客户槽（同一岗位名、不同客户 ⇒ 权限集合不同）。
                value: allowedSensitivitiesByGrants(payload.role, ctx.auth.sensitivity, payload.orgId),
              },
              // 🔴 #731 / T3（I-C1/I-C2/I-C3/I-C4/I-C6）: **追加**知识 scope 维（不替换）。
              //   ⚠️ 位置是判据的一部分 —— I-C3 要求第 0 位恒为 `access.sensitivity` 条件
              //   （K12-11 不回退），scope 维只能在它**之后**追加（数组长度只增不减）。
              ...knowledgeScopeConditions(payload.role),
            ],
          }),
        },
        // 🔴 K12-10-WIRE: 本行是"请求路径真带部门身份"的唯一接线点。
        //   摘掉它 ⇒ `getCurrentDepartmentIds()` 回到空集 ⇒ 判据必红（已实测，见交付回执 B②）。
        ...(departmentSource === undefined ? {} : { resolved: departmentSource }),
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
