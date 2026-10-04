<!--
  Synova 企业多用户部署 | 第五章：与现有代码对齐
  版本: v1.0 | 日期: 2026-07-21 | 作者: Synova 研究组
  定位: 施工文档——精确到函数级的代码改动清单。定义每一项变更的文件、函数、改动类型与验收标准。
  前置输入: auth.ts, knowledge-agent.ts, knowledge-curator.ts, ga-admin.ts, ga-annotations.ts, ga-corrections.ts, graph-store.ts, ontology-adapter.ts, 权威14 MVS
-->

# 第五章：与现有代码对齐

> 核心问题：二/三/四章定义的新能力，落到现有代码上具体怎么改？
> 本章产出：精确到函数级的代码改动清单 + 新增文件设计 + 权威14 MVS 扩展路径标注

---

## 5.0 改动范围总览

| 类别 | 文件 | 改动类型 | 描述 |
|------|------|---------|------|
| 认证升级 | `src/routes/auth.ts` | **修改** | login 增加 bcrypt 校验 + 新增 register 端点 |
| 企业路由 | `src/routes/enterprise.ts` | **新增** | 企业注册/邀请/成员管理/ima 绑定/GA 临时访问 |
| ima 连接器 | `src/connectors/ima.ts` | **新增** | ima API 客户端（认证/扫描/提取/校验） |
| 知识代理增强 | `src/l3/knowledge-agent.ts` | **修改** | 新增 `imaDataSource` 工具 + `runGear6` 扩展到 ima |
| GraphStore | `packages/engine-core/src/pipeline/diagnosis/graph-store.ts` | **修改** | 新增 `User` 节点类型 |
| 本体适配器 | `packages/engine-core/src/pipeline/diagnosis/ontology-adapter.ts` | **修改** | 新增 `RESOURCE_USER` 实体映射 |
| GA 路由适配 | `src/routes/ga-admin.ts` | **修改** | Mock → 联邦聚合数据源切换 |
| GA 标注适配 | `src/routes/ga-annotations.ts` | **修改** | 增加数据源上下文标记 |
| GA 纠错适配 | `src/routes/ga-corrections.ts` | **修改** | 增加数据源上下文标记 |
| Cron 扩展 | `src/cron/` | **修改** | 新增 `imaSyncCronJob` |
| 服务注册 | `src/index.ts` (或 server.ts) | **修改** | 注册新路由 + Cron 作业 |

---

## 5.1 `src/routes/auth.ts` — 认证路由升级

### 5.1.1 现状

当前 `POST /api/auth/login`（第 32-95 行）是演示版实现：接收 `userId` + `role`，不校验密码，直接签发 JWT。

```typescript
// 第 32 行: router.post('/api/auth/login', (req, res) => ...)
// 第 50-54 行: 只校验 userId 和 role 字段，无密码校验
// 第 74 行: signJwtToken({ sub: userId, role, orgId })
```

### 5.1.2 改动：`POST /api/auth/login` 函数体

**文件**: `D:\novis-backup-20260526\Novis\synova-agent\src\routes\auth.ts`
**行号**: 约第 32-95 行
**改动类型**: 修改函数体

**改动内容**:

1. **请求体字段变更**: `userId` + `role` → `email` + `password`
2. **新增 bcrypt 密码校验**: 从 GraphStore 查询用户 → 比对 `passwordHash`
3. **JWT payload 保持兼容**: `sub` (userId), `role`, `orgId` 格式不变 → `extractRbacContext` 无需修改

```typescript
// 改造后的 login 处理函数（伪代码示意）
router.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    // 1. 参数校验
    if (!email || !password) {
      return res.status(400).json({
        ok: false, code: 'VALIDATION_ERROR',
        message: 'email 和 password 必填',
      });
    }

    // 2. 查询用户（通过 GraphStore User 节点）
    const userNode = graphStore.queryNodeByEmail(email);
    if (!userNode) {
      return res.status(401).json({
        ok: false, code: 'AUTH_FAILED',
        message: '邮箱或密码错误',
      });
    }

    // 3. bcrypt 密码校验
    const passwordValid = await bcryptCompare(
      password,
      userNode.props.passwordHash
    );
    if (!passwordValid) {
      return res.status(401).json({
        ok: false, code: 'AUTH_FAILED',
        message: '邮箱或密码错误',
      });
    }

    // 4. 检查用户状态
    if (userNode.props.status !== 'active') {
      return res.status(403).json({
        ok: false, code: 'ACCOUNT_DISABLED',
        message: '账号已被禁用，请联系管理员',
      });
    }

    // 5. 签发 JWT（格式不变，兼容 extractRbacContext）
    const token = signJwtToken({
      sub: userNode.props.userId,
      role: userNode.props.role,
      orgId: userNode.props.orgId,
    });

    return res.json({ ok: true, token, payload: { ... } });
  } catch (err: unknown) {
    // 铁律 24: catch 必须有 log + degraded
    log.error({ err }, 'login 异常');
    return res.status(500).json({
      ok: false, code: 'INTERNAL_ERROR',
      message: (err as Error).message, degraded: true,
    });
  }
});
```

### 5.1.3 新增：`POST /api/auth/register` 端点

**文件**: `D:\novis-backup-20260526\Novis\synova-agent\src\routes\auth.ts`
**位置**: 在 `POST /api/auth/login` 之后，约第 96 行后新增
**改动类型**: 新增函数

```
POST /api/auth/register
Body: { email, password, invitationToken }

→ 只能通过邀请链接注册（invitationToken 校验）
→ bcrypt 哈希密码后写入 GraphStore User 节点
→ 返回 JWT token（自动登录）
```

### 5.1.4 不改动的函数

| 函数 | 行号 | 原因 |
|------|------|------|
| `signJwtToken` | 第 96-116 行 (auth.ts) | JwtPayload 格式不变：`{ sub, role, orgId, iat, exp, jti }` |
| `verifyJwtToken` | 第 122-172 行 (auth.ts) | 验证逻辑不变 |
| `extractAuthFromRequest` | 第 288-310 行 (auth.ts) | 提取逻辑不变：`{ role, userId, orgId }` |
| `jwtAuthMiddleware` | 第 236-280 行 (auth.ts) | 中间件逻辑不变 |
| `revokeToken` / `isTokenRevoked` | 第 186-207 行 (auth.ts) | 撤销逻辑不变 |

---

## 5.2 `src/routes/enterprise.ts` — 企业路由（新增文件）

### 5.2.1 新增端点清单

| 端点 | 方法 | 鉴权 | 功能 |
|------|------|------|------|
| `/api/enterprise/register` | POST | 无 | 注册新企业（创建 admin 用户 + 企业本体节点） |
| `/api/enterprise/invite` | POST | admin | 邀请成员 |
| `/api/enterprise/invitations` | GET | admin | 查看所有邀请 |
| `/api/enterprise/invitations/:id` | DELETE | admin | 撤销邀请 |
| `/api/enterprise/invitation/accept` | POST | 无（token） | 成员接受邀请 + 设置密码 |
| `/api/enterprise/invitation/:token` | GET | 无（token） | 查看邀请详情 |
| `/api/enterprise/members` | GET | admin | 成员列表 |
| `/api/enterprise/members/:userId` | GET | admin | 成员详情 |
| `/api/enterprise/members/:userId` | PUT | admin | 修改成员角色/部门 |
| `/api/enterprise/members/:userId` | DELETE | admin | 软删除成员 |
| `/api/enterprise/ima/bind` | POST | admin | 绑定 ima API Key |
| `/api/enterprise/ima/status` | GET | admin | 查看 ima 绑定状态 |
| `/api/enterprise/ima/sync/trigger` | POST | admin | 手动触发 ima 同步 |
| `/api/enterprise/ima/sync/status` | GET | admin | 查看 ima 同步状态 |
| `/api/enterprise/ga-access/generate` | POST | admin | 生成 GA 临时访问链接 |
| `/api/enterprise/ga-access/validate` | GET | 无（token） | 验证访问链接 |
| `/api/enterprise/ga-access/data/:type` | GET | 无（token） | 临时只读数据 |
| `/api/enterprise/ga-access/:token` | DELETE | admin | 撤销访问链接 |

### 5.2.2 关键函数签名

```typescript
// src/routes/enterprise.ts — 核心函数

// ── 企业注册 ──
async function handleRegisterEnterprise(req: Request, res: Response): Promise<void>;
// 调用: graphStore.createNode(SOGNodeType.ORGANIZATION, ...) + 创建 admin User 节点

// ── 成员邀请 ──
async function handleInviteMember(req: Request, res: Response): Promise<void>;
// 调用: generateInvitationToken() → 存储到 invitationStore

// ── 成员接受邀请 ──
async function handleAcceptInvitation(req: Request, res: Response): Promise<void>;
// 调用: bcryptHash(password) → graphStore.createNode(SOGNodeType.USER, { passwordHash })

// ── 成员管理 ──
async function handleListMembers(req: Request, res: Response): Promise<void>;
async function handleGetMember(req: Request, res: Response): Promise<void>;
async function handleUpdateMember(req: Request, res: Response): Promise<void>;
async function handleRemoveMember(req: Request, res: Response): Promise<void>;

// ── ima 绑定 ──
async function handleBindIma(req: Request, res: Response): Promise<void>;
// 调用: imaClient.checkTokenValidity(apiKey) → encryptApiKey(apiKey) → 存储

// ── GA 临时访问 ──
async function handleGenerateGaAccess(req: Request, res: Response): Promise<void>;
// 生成: crypto.randomBytes(32) → token → 存储到 tempAccessStore
async function handleValidateGaAccess(req: Request, res: Response): Promise<void>;
// 校验: token 有效性 + 过期 + 使用次数
async function handleGaAccessData(req: Request, res: Response): Promise<void>;
// 返回临时只读数据（需 token 验证）
```

### 5.2.3 依赖关系

```
enterprise.ts
  ├── middleware/auth.ts          → extractAuthFromRequest (鉴权)
  ├── middleware/rbac.ts           → canAccessWorkspace, canModifyWorkspace
  ├── connectors/ima.ts           → imaClient (新增)
  ├── l4/graph-store.ts           → createNode, queryNodeByEmail (新增函数)
  ├── crypto (Node built-in)      → randomBytes (token 生成)
  └── bcrypt (需安装)             → hash, compare
```

---

## 5.3 `src/connectors/ima.ts` — ima 连接器（新增文件）

### 5.3.1 文件结构

```
src/connectors/ima.ts
  ├── Types & Interfaces
  │   ├── ImaConfig              — API Key 加密配置
  │   ├── ImaDocument            — ima 文档模型
  │   ├── ImaDocumentPermission  — ima 权限模型
  │   ├── ExtractedPkbEntry      — 提取后的 PKB 条目格式
  │   └── SyncResult             — 同步结果报告
  │
  ├── Encryption Layer
  │   ├── deriveEncryptionKey()  — 从 JWT_SECRET 派生 AES 密钥
  │   ├── encryptApiKey()        — AES-256-GCM 加密
  │   └── decryptApiKey()        — AES-256-GCM 解密
  │
  ├── Core API Client
  │   ├── authenticate()         — 验证 API Key → 获取 accessToken
  │   ├── scanNewDocs()          — 获取某用户的文档列表（增量）
  │   ├── extractDoc()           — 获取单文档全文
  │   ├── getDocPermissions()    — 查询文档权限设置
  │   └── checkTokenValidity()   — 验证 API Key 是否仍有效
  │
  ├── Permission Layer
  │   ├── mapImaPermissionToSynova() — ima 权限 → Synova accessLevel
  │   └── extractDocWithPermission() — 完整的权限感知提取流程
  │
  ├── Content Filtering
  │   ├── filterDiagnosticContent()  — 只留诊断相关内容
  │   └── detectDocumentCategory()   — 自动识别文档类别
  │
  ├── Sync Engine
  │   ├── runIncrementalSync()   — 增量同步（扫描 → 提取 → 写入 PKB）
  │   ├── getSyncStatus()        — 获取当前同步状态
  │   └── triggerManualSync()    — 手动触发同步
  │
  └── Degradation Layer
      ├── handleApiUnavailable() — ima API 不可用时的降级处理
      └── retryWithBackoff()     — 指数退避重试（1h→2h→4h→6h）
```

### 5.3.2 核心函数签名

```typescript
// ── 加密层 ──
function deriveEncryptionKey(): Buffer;
function encryptApiKey(plaintext: string, key: Buffer): string;
function decryptApiKey(ciphertext: string, key: Buffer): string;

// ── API 客户端 ──
async function authenticate(apiKey: string): Promise<{
  ok: boolean;
  accessToken?: string;
  expiresIn?: number;
  scope?: string;
  error?: string;
  code: string;
  phase: 'ima_auth';
  retryable: boolean;
}>;

async function scanNewDocs(
  viewerImaToken: string,
  viewerUserId: string,
  cursor?: string  // 增量游标
): Promise<{
  ok: boolean;
  documents: ImaDocument[];
  nextCursor?: string;
  error?: string;
  degraded?: boolean;
}>;

async function extractDoc(
  docId: string,
  viewerImaToken: string
): Promise<{
  ok: boolean;
  document?: { id: string; title: string; content: string; type: string; };
  error?: string;
  degraded?: boolean;
}>;

async function getDocPermissions(
  docId: string,
  viewerImaToken: string
): Promise<{
  ok: boolean;
  permissions?: ImaDocumentPermission;
  error?: string;
  degraded?: boolean;
}>;

async function checkTokenValidity(apiKey: string): Promise<{
  ok: boolean;
  valid: boolean;
  expiresAt?: string;
  scope?: string;
  error?: string;
  code: string;
  phase: 'ima_validate';
  retryable: boolean;
}>;

// ── 权限映射 ──
function mapImaPermissionToSynova(
  permissions: ImaDocumentPermission,
  viewerUserId: string
): {
  level: 'public' | 'team' | 'private';
  teamId?: string;
  sensitivity: 'normal' | 'sensitive' | 'restricted';
};

async function extractDocWithPermission(
  doc: ImaDocument,
  viewerUserId: string,
  viewerImaToken: string
): Promise<ExtractedPkbEntry | null>;  // null = 非诊断文档，跳过

// ── 内容过滤 ──
function filterDiagnosticContent(
  fullText: string,
  docType: string
): string | null;  // null = 非诊断内容

function detectDocumentCategory(
  title: string,
  content: string
): 'strategy' | 'operations' | 'meeting' | 'other';

// ── 同步引擎 ──
async function runIncrementalSync(orgId: string): Promise<SyncResult>;

interface SyncResult {
  ok: boolean;
  syncId: string;
  documentsScanned: number;
  newlyExtracted: number;
  reExtracted: number;
  skipped: number;
  errors: string[];
  cursor?: string;
  durationMs: number;
  degraded?: boolean;      // 铁律 31: 降级信号传播
}

function getSyncStatus(orgId: string): SyncStatus;
function triggerManualSync(orgId: string): Promise<{ syncId: string; estimatedDuration: string }>;

// ── 降级层 ──
function handleApiUnavailable(error: unknown, orgId: string): {
  degraded: true;
  reason: string;
  recoveryAction: 'retry_next_cron' | 'notify_admin' | 'skip';
};

function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 4,
  baseDelayMs: number = 3600000  // 1 小时
): Promise<T>;
```

### 5.3.3 依赖项

```
npm install bcrypt          # 密码哈希（auth + enterprise 共用）
# ima 连接器无额外 npm 依赖——使用 Node built-in crypto + fetch
```

---

## 5.4 GraphStore User 节点

### 5.4.1 现状

当前 `ontology-adapter.ts` 使用 `SOGNodeType.PERSON` 表示人员，无专门的 User 节点类型。

```typescript
// ontology-adapter.ts 第 73 行：
{ type: SOGNodeType.PERSON, props: { name: '示例用户A', source: 'feishu', externalId: 'ou_xxx' } }
```

### 5.4.2 改动：新增 `RESOURCE_USER` 节点类型

**文件**: `packages/engine-core/src/pipeline/diagnosis/ontology-adapter.ts`
**改动类型**: 新增枚举值 + 新增创建函数

```typescript
// SOGNodeType 枚举扩展（如果支持扩展）
// 或在 ontology-adapter.ts 中定义 User 节点的 props 规范：

// 新增: createUserNode 函数
function createUserNode(graphStore: GraphStore, params: {
  username: string;        // 显示名称
  email: string;           // 登录邮箱（唯一）
  passwordHash: string;    // bcrypt(12 rounds) 哈希
  role: 'admin' | 'manager' | 'staff' | 'ga' | 'ga_guest';
  orgId: string;           // 所属企业
  department?: string;     // 部门
  status: 'pending' | 'active' | 'disabled';
  invitedBy?: string;      // 邀请人 userId
  invitedAt?: string;      // ISO 时间戳
}): string;  // 返回 userId

// 新增: queryNodeByEmail 函数
function queryNodeByEmail(graphStore: GraphStore, email: string): UserNodeProps | null;

// 新增: updateUserNode 函数
function updateUserNode(graphStore: GraphStore, userId: string, patch: Partial<UserNodeProps>): boolean;

// UserNodeProps 类型
interface UserNodeProps {
  userId: string;
  username: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'manager' | 'staff' | 'ga' | 'ga_guest';
  orgId: string;
  department: string;
  status: 'pending' | 'active' | 'disabled';
  invitedBy?: string;
  invitedAt?: string;
  joinedAt?: string;
  lastLoginAt?: string;
}
```

### 5.4.3 依赖关系

```
graph-store.ts
  ├── SQLite 建表: CREATE TABLE users (userId TEXT PRIMARY KEY, ...)
  └── 索引: CREATE UNIQUE INDEX idx_users_email ON users(email)

ontology-adapter.ts
  └── 新增 SOGNodeType.USER（或使用 SOGNodeType.PERSON + type='user' 标签区分）
```

---

## 5.5 `src/l3/knowledge-agent.ts` — KnowledgeAgent 增强

### 5.5.1 现状

当前 `knowledge-agent.ts` 注册了 5 个工具：
1. `search_documents` — 本地知识库搜索
2. `query_knowledge` — PKB 检索
3. `add_pkb_entry` — 手动添加知识
4. `fetch_source` — 获取原文片段
5. `query_graph` — SOG 图查询
6. `manage_permissions` — 权限管理

`runGear6()`（第 252-290 行）从会话和文档中提取知识片段。

### 5.5.2 改动

**文件**: `D:\novis-backup-20260526\Novis\synova-agent\src\l3\knowledge-agent.ts`

**改动 1**: 新增 `imaDataSource` 工具注册

```typescript
// 在 registerTo() 中新增（约第 250 行，search_external 之后）

// ── ima_data_source (M2 — ima 知识库检索) ──
registry.register({
  name: 'ima_data_source',
  description: `从企业 ima 知识库检索战略规划、运营数据、会议纪要等诊断相关文档。自动根据你的权限过滤。结果按相关性排序。`,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      category: { type: 'string', description: '文档类别: strategy/operations/meeting (可选)' },
      limit: { type: 'number', description: '返回条数 (默认 5)' },
    },
    required: ['query'],
  },
  operationType: 'read',
  sideEffects: 'none',
  handler: async (params: Record<string, unknown>) => {
    const query = String(params.query || '');
    const category = params.category as string | undefined;
    const limit = Number(params.limit || 5);

    // 调用 ima 连接器 → 权限感知搜索
    const { imaClient } = await import('../connectors/ima');
    const user = (await import('../services/request-context')).getCurrentUser();
    const results = await imaClient.searchDiagnosticDocs({
      query,
      category,
      limit,
      viewerUserId: user?.userId,
    });

    // 写入 PKB（权限继承）
    // ... (参见 §2.2.4 extractDocWithPermission)

    return {
      results: results.map(r => ({
        title: r.title,
        snippet: r.snippet,
        documentId: r.documentId,
        category: r.category,
        source: 'ima',
      })),
      total: results.length,
    };
  },
});
```

**改动 2**: `runGear6()` 扩展 ima 扫描

```typescript
// runGear6() 函数体（约第 252 行）扩展

async runGear6() {
  const errors: string[] = [];
  let extracted = 0;

  try {
    // === 现有逻辑（不变）===
    // 1. 扫描 Phase 0 诊断数据
    // 2. 扫描长文档

    // === 新增：扫描 ima 文档 ===
    const { runIncrementalSync } = await import('../connectors/ima');
    const orgId = (await import('../services/request-context')).getCurrentOrgId();
    const syncResult = await runIncrementalSync(orgId);

    if (syncResult.degraded) {
      errors.push(`ima 同步降级: ${syncResult.errors.join(', ')}`);
    }

    extracted += syncResult.newlyExtracted + syncResult.reExtracted;

    log.info({
      imaScanned: syncResult.documentsScanned,
      imaExtracted: syncResult.newlyExtracted,
      imaReExtracted: syncResult.reExtracted,
    }, '齿轮6 — ima 知识提取完成');

  } catch (err: unknown) {
    errors.push(`Gear6 ima 扫描失败: ${err instanceof Error ? err.message : String(err)}`);
    log.warn({ err }, '齿轮6 — ima 知识提取失败');
  }

  // === 现有返回逻辑（不变）===
  log.info({ extracted, errors: errors.length }, '齿轮6 知识提取完成');
  return { extracted, errors };
}
```

---

## 5.6 `src/routes/ga-admin.ts` — GA 管理路由适配

### 5.6.1 改动

**文件**: `D:\novis-backup-20260526\Novis\synova-agent\src\routes\ga-admin.ts`

| 行号范围 | 函数 / 代码块 | 改动类型 | 说明 |
|---------|-------------|---------|------|
| 第 14-62 行 | `MOCK_CLIENTS` 常量 | **删除 / 替换** | 切换到联邦聚合数据源（匿名化客户列表） |
| 第 65-85 行 | `GET /api/ga/clients` | **修改函数体** | 数据来源从 `Object.values(MOCK_CLIENTS)` 改为 `getGAClients(authCtx.userId)` |
| 第 90-124 行 | `POST /api/ga/clients` | **修改函数体** | 新增客户不再是写 Mock 对象，而是创建联邦聚合记录 |
| 第 129-155 行 | `POST /api/ga/switch/:orgId` | **修改函数体** | 增加数据源上下文记录（数据源 ②/③/④） |

### 5.6.2 新增辅助函数

```typescript
// 新增函数: getGAClients（第 62 行后）
async function getGAClients(gaUserId: string): Promise<GAClient[]>;

// 新增函数: mergeClients（数据源去重合并）
function mergeClients(sources: GAClient[][]): GAClient[];
```

---

## 5.7 `src/routes/ga-annotations.ts` / `src/routes/ga-corrections.ts` — 上下文适配

### 5.7.1 改动

两个文件的改动相同且最小——仅增加 `dataSource` 字段记录标注/纠错的上下文。

**ga-annotations.ts 修改点**:
- `POST /api/ga/annotations`（第 68-110 行）：在 `store.remember()` 的 `tags` 中增加 `datasource:${annotationSource}`
- `GET /api/ga/annotations`（第 116-160 行）：在 annotations 列表返回中增加 `dataSource` 字段
- 不新增端点、不修改函数签名、不改变 `requireGa` 中间件

**ga-corrections.ts 修改点**:
- `POST /api/ga/corrections`（第 22-40 行）：在 `store.remember()` 的 `tags` 中增加 `datasource:${correctionSource}`
- 不新增端点、不修改函数签名、不改变 `requireGa` 中间件

---

## 5.8 `src/cron/` — Cron 调度扩展

### 5.8.1 新增：`imaSyncCronJob`

**文件**: `src/cron/ima-sync-cron.ts`（新增）

```typescript
import { CronJob } from 'cron';
import { createLogger } from '@synova/logger';
import { runIncrementalSync } from '../connectors/ima';

const log = createLogger('cron/ima-sync');

export function createImaSyncJob(orgId: string, intervalHours: number = 6): CronJob {
  return new CronJob(
    `0 */${intervalHours} * * *`,  // 每 N 小时
    async () => {
      log.info({ orgId }, 'ima 定时同步开始');
      try {
        const result = await runIncrementalSync(orgId);
        if (result.degraded) {
          log.warn({ orgId, errors: result.errors }, 'ima 同步降级');
        } else {
          log.info({ orgId, ...result }, 'ima 定时同步完成');
        }
      } catch (err: unknown) {
        log.error({ err, orgId }, 'ima 同步异常');
      }
    },
    null,    // onComplete
    false,   // start now
    'Asia/Shanghai'
  );
}
```

### 5.8.2 `src/index.ts` 注册

在现有的 CronScheduler 注册点（约在 `Phase 5` 初始化的 CronScheduler 部分）新增：

```typescript
// 注册 ima 同步定时任务（如果企业已绑定 ima）
if (enterpriseConfig.imaBound) {
  const imaJob = createImaSyncJob(orgId, enterpriseConfig.imaSyncIntervalHours);
  cronScheduler.register('ima-sync', imaJob);
}
```

---

## 5.9 权威14 MVS 扩展路径标注

### 5.9.1 权威14 第四章 MVS 回顾

权威14 的 MVS 定义了一周时间、一台机器、一个客户（客户A）上跑通的最小子集：
- 17 条 P0 因果边
- 16 个 P0 哨兵
- 3 位核心专家 (finance / strategy / action)
- 20 个核心 compute 函数
- 10 个核心 Skill
- 3 个核心 Playbook
- 5 条已验证因果链

### 5.9.2 企业多用户 Phase 0 最小实现

在企业多用户部署场景下，Phase 0 是在 MVS 基础上**新增**的最小功能集，非替代：

```
权威14 MVS（已有）
    │
    ├── 17 P0 边 + 16 P0 哨兵 + 3 专家 + 20 compute
    │   ↓
    │   在客户A这一家企业上跑通"诊断 → 增长导航"
    │
    ▼
企业多用户 Phase 0（新增）
    │
    ├── 企业注册（POST /api/enterprise/register）
    │   → 创建 orgId + admin User 节点 + 企业本体节点
    │
    ├── bcrypt 密码认证（routes/auth.ts login 升级）
    │   → Demo 的任意 userId → 邮箱 + 密码 + bcrypt 校验
    │
    ├── 局域网 HTTP 连接
    │   → 单机 localhost:3000 → Electron 局域网 serverUrl 配置
    │
    └── 单机模式（不变）
        → SQLite 本地存储，不引入分布式数据库
```

### 5.9.3 Phase 0 验收标准

| # | 验收项 | 验证方式 |
|---|--------|---------|
| 1 | 企业注册成功，admin 可登录 | `POST /api/enterprise/register` → `POST /api/auth/login` → JWT 返回 |
| 2 | admin 可邀请成员 | `POST /api/enterprise/invite` → 生成邀请链接 |
| 3 | 成员可通过邀请链接设置密码 | `POST /api/enterprise/invitation/accept` → 密码哈希写入 |
| 4 | 成员可登录并进入工作台 | `POST /api/auth/login` (成员) → JWT → 进入部门工作台 |
| 5 | admin 可查看/修改/移除成员 | `GET/PUT/DELETE /api/enterprise/members/:userId` |
| 6 | 现有诊断功能不受影响 | `GET /api/diagnosis/start` 正常返回（with multi-user JWT） |
| 7 | Demo 旧 API 仍然可用 | `POST /api/auth/login` (旧格式 userId+role) 保留兼容 |

---

## 5.10 代码改动完整清单（函数级）

### 5.10.1 现有文件修改

| 文件 | 行号 | 函数名 / 代码块 | 改动类型 | 改造内容 |
|------|------|---------------|---------|---------|
| `src/routes/auth.ts` | 32 | `POST /api/auth/login` handler | **修改函数体** | email + bcrypt 校验替代 userId + role 自由指定 |
| `src/routes/auth.ts` | ~97 | `POST /api/auth/register` | **新增函数** | 通过邀请 token 注册 + 设置密码 |
| `src/routes/ga-admin.ts` | 16-62 | `MOCK_CLIENTS` | **删除常量** | 替换为联邦聚合数据源 |
| `src/routes/ga-admin.ts` | 65 | `GET /api/ga/clients` handler | **修改函数体** | `Object.values(MOCK_CLIENTS)` → `await getGAClients()` |
| `src/routes/ga-admin.ts` | ~63 | `getGAClients()` | **新增函数** | 合并三个数据源的客户列表 |
| `src/routes/ga-admin.ts` | 91 | `POST /api/ga/clients` handler | **修改函数体** | Mock 写入 → 联邦聚合记录创建 |
| `src/routes/ga-admin.ts` | 130 | `POST /api/ga/switch` handler | **修改函数体** | 增加数据源上下文记录 |
| `src/routes/ga-annotations.ts` | 68 | `POST /api/ga/annotations` handler | **修改函数体** | `store.remember()` tags 增加 `datasource:xxx` |
| `src/routes/ga-annotations.ts` | 116 | `GET /api/ga/annotations` handler | **修改函数体** | 返回 annotations 增加 `dataSource` 字段 |
| `src/routes/ga-corrections.ts` | 22 | `POST /api/ga/corrections` handler | **修改函数体** | `store.remember()` tags 增加 `datasource:xxx` |
| `src/l3/knowledge-agent.ts` | ~50 | `createKnowledgeAgent().registerTo()` | **新增注册** | 注册 `ima_data_source` 工具 |
| `src/l3/knowledge-agent.ts` | ~252 | `runGear6()` | **修改函数体** | 扩展 ima 文档扫描 + 提取 + 写入 PKB |
| `packages/engine-core/src/pipeline/diagnosis/ontology-adapter.ts` | — | `NodeType` 枚举 | **新增枚举值** | `RESOURCE_USER` 或 `User` |
| `packages/engine-core/src/pipeline/diagnosis/ontology-adapter.ts` | — | `createUserNode()` | **新增函数** | 创建 User 节点 |
| `packages/engine-core/src/pipeline/diagnosis/ontology-adapter.ts` | — | `queryNodeByEmail()` | **新增函数** | 按邮箱查询 User 节点 |
| `packages/engine-core/src/pipeline/diagnosis/ontology-adapter.ts` | — | `updateUserNode()` | **新增函数** | 更新 User 节点属性 |
| `packages/engine-core/src/pipeline/diagnosis/graph-store.ts` | — | `createNode()` | **扩展支持** | 支持 `RESOURCE_USER` 类型创建 |
| `packages/engine-core/src/pipeline/diagnosis/graph-store.ts` | — | `queryNodeByEmail()` | **新增函数** | SQLite SELECT 按 email 查询 |
| `packages/engine-core/src/pipeline/diagnosis/graph-store.ts` | — | `users` 表创建 | **新增 DDL** | `CREATE TABLE users (...)` |
| `src/index.ts` (或 server.ts) | — | 路由注册 | **新增行** | `app.use(enterpriseRouter)` + `app.use('/api/enterprise', ...)` |
| `src/index.ts` (或 server.ts) | — | Cron 注册 | **新增行** | `cronScheduler.register('ima-sync', createImaSyncJob(...))` |

### 5.10.2 新增文件

| 文件 | 大小估算 | 核心函数 |
|------|---------|---------|
| `src/routes/enterprise.ts` | ~400 行 | `handleRegisterEnterprise`, `handleInviteMember`, `handleAcceptInvitation`, `handleListMembers`, `handleUpdateMember`, `handleRemoveMember`, `handleBindIma`, `handleGenerateGaAccess`, `handleValidateGaAccess` |
| `src/connectors/ima.ts` | ~500 行 | `deriveEncryptionKey`, `encryptApiKey`, `decryptApiKey`, `authenticate`, `scanNewDocs`, `extractDoc`, `getDocPermissions`, `checkTokenValidity`, `mapImaPermissionToSynova`, `extractDocWithPermission`, `filterDiagnosticContent`, `runIncrementalSync`, `triggerManualSync`, `retryWithBackoff` |
| `src/cron/ima-sync-cron.ts` | ~50 行 | `createImaSyncJob` |

### 5.10.3 不改动的现有函数（兼容保证）

| 文件 | 函数名 | 理由 |
|------|--------|------|
| `src/middleware/auth.ts` | `signJwtToken` | JwtPayload `{ sub, role, orgId }` 格式不变 |
| `src/middleware/auth.ts` | `verifyJwtToken` | 验证逻辑不变 |
| `src/middleware/auth.ts` | `extractAuthFromRequest` | 提取格式不变：`{ role, userId, orgId }` |
| `src/middleware/auth.ts` | `jwtAuthMiddleware` | 中间件逻辑不变 |
| `src/middleware/auth.ts` | `revokeToken` / `isTokenRevoked` | 撤销逻辑不变 |
| `src/middleware/rbac.ts` | `canAccessWorkspace` | RBAC 逻辑不变 |
| `src/middleware/rbac.ts` | `canModifyWorkspace` | RBAC 逻辑不变 |
| `packages/engine-core/src/pipeline/diagnosis/knowledge-curator.ts` | 全部 15 个导出函数 | 知识生命周期管理不变——直接适用于 ima 来源的 PKB 条目 |
| `src/l3/knowledge-agent.ts` | `search_documents`, `query_knowledge`, `add_pkb_entry`, `fetch_source`, `query_graph`, `manage_permissions` handlers | 工具定义不变，仅新增工具 |
| `src/routes/ga-annotations.ts` | `requireGa`, `getStore`, `computeSentinelAccuracy` | 工具函数不变 |
| `src/routes/ga-corrections.ts` | `requireGa`, `getStore` | 工具函数不变 |

---

## 5.11 npm 依赖变化

```
新增:
  npm install bcrypt            # 密码哈希 (纯 JS, 无原生编译)

无其他新增依赖。ima 连接器使用 Node built-in crypto + fetch + setTimeout。
```

---

## 5.12 实施建议步骤

| # | 步骤 | 文件 | 预估工时 | 依赖 |
|---|------|------|---------|------|
| 1 | GraphStore User 节点 + queryNodeByEmail | graph-store.ts, ontology-adapter.ts | 2h | 无 |
| 2 | auth.ts login 升级 (bcrypt) + register | auth.ts | 3h | 步骤 1 |
| 3 | enterprise.ts 企业注册 + 邀请 + 成员管理 | enterprise.ts | 6h | 步骤 1, 2 |
| 4 | ima.ts 连接器（认证 + 扫描 + 提取） | connectors/ima.ts | 8h | 步骤 1 |
| 5 | knowledge-agent.ts 增强 (imaDataSource) | l3/knowledge-agent.ts | 3h | 步骤 4 |
| 6 | enterprise.ts ima 绑定端点 + GA 临时访问 | enterprise.ts | 4h | 步骤 4, 3 |
| 7 | ga-admin.ts 数据源切换 + 标注/纠错适配 | ga-admin.ts, ga-annotations.ts, ga-corrections.ts | 2h | 步骤 3 |
| 8 | ima-sync-cron.ts + index.ts 注册 | cron/ima-sync-cron.ts, index.ts | 1h | 步骤 4 |
| 9 | Electron 客户端（配置页 + 管理员工作台） | Electron 主进程 + 渲染进程 | 12h | 步骤 1-8 |

**总计**: 约 41 工时（后端 29h + 前端 12h）
