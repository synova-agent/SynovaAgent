<!-- status: 研究完成 | chapter: 1/5 | date: 2026-07-21 | author: Synova 研究组 -->
# 第一章：企业多用户架构

> 服务端集中部署 + 瘦客户端连接 | 企业注册 & 成员邀请 | JWT 认证升级 | 部署模式 & 离线缓存
> 2026-07-21 | 基于研究方案 v2.0 §2.1-2.4

---

## 1. 服务端+瘦客户端架构

### 1.1 架构决策：集中式 Server，非 P2P

**核心矛盾**：如果"每个人单独下载"意味着每台机器独立 Agent + 独立 SQLite → 数据不互通。同一个公司的成员看到的数据不一样，组织诊断没有意义。

**唯一正确方案**：企业局域网内集中部署一个 Synova Server 为唯一真相源，所有团队成员的 Electron 客户端作为瘦客户端通过 HTTP API 远程连接。哨兵、诊断、溢出计算全部在 Server 端执行。

```
                    ┌─────────────────────────────┐
                    │   Synova Server (企业局域网)   │
                    │   synova-agent 进程           │
                    │   + SQLite (WAL模式)           │
                    │   + CronScheduler             │
                    │   + 哨兵/诊断/溢出计算          │
                    │   + 管理员工作台(Web界面)       │
                    └─────────────┬───────────────┘
                                  │ HTTP API (JWT认证)
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
    ┌───────────┐           ┌───────────┐           ┌───────────┐
    │ Electron  │           │ Electron  │           │ Electron  │
    │ 老板/admin │           │ 财务/manager│          │ 营销/liaison│
    │ (可作为    │           │ (局域网连接)│          │ (局域网连接)│
    │  Server宿  │           │           │           │           │
    │  主+客户端) │           │           │           │           │
    └───────────┘           └───────────┘           └───────────┘
```

**Server 职责**（唯一真相源）：
- 诊断管线（6阶段 FDE 管道：全部 25 测量器 + 8 位专家）
- Sentinel 定时哨兵扫描（Cron → 基线对比 → 信号聚合 → 工单）
- 溢出计算（GPI、第二曲线、风险评分）
- 数据接入与 GraphStore 本体层维护
- LLM 推理调用
- HTTP API 对外服务（认证、诊断、哨兵、报告）
- Cron 持久化作业管理

**Electron 客户端职责**（纯交互层）：
- 内置浏览器加载 Web 界面（诊断报告、仪表盘、GA 工作台）
- 系统托盘驻留 + 桌面通知推送
- 开机自启管理
- 本地聚合数据缓存（离线降级）
- 不运行任何诊断逻辑、不启动哨兵、不调用 LLM

**TUI 保留为开发者调试工具**，不面向终端用户。

### 1.2 进程架构对比

| 维度 | Server 进程 | Electron 客户端 |
|------|------------|----------------|
| 运行时 | Node.js 22+ 独立进程 | Electron 渲染进程 + Node.js 主进程 |
| 数据库 | SQLite WAL 模式（读写） | SQLite 本地缓存（只写聚合数据） |
| 计算 | 诊断管线 + 哨兵 + 溢出计算 | 无计算逻辑 |
| LLM 调用 | 执行（DeepSeek/OpenAI Gateway） | 不调用 |
| Cron | CronScheduler 持久化作业 | 无 |
| API 端口 | 对外暴露 HTTP API | 仅消费 API |
| 升级 | 蓝绿热替换 | 冷替换（下载→通知→退出→替换→重启） |
| 通信 | 提供 HTTP API | 消费 HTTP API + IPC（托盘/通知） |

### 1.3 API 通信规范

所有客户端→Server 通信通过 HTTP REST API，Bearer JWT 认证。Server 默认监听 `0.0.0.0`（局域网可访问），端口通过 `PORT` 环境变量配置（默认 3100）。

```
客户端请求格式：
  Authorization: Bearer <jwt_token>
  Content-Type: application/json

Server 响应格式（统一）：
  { ok: true, ...data }
  { ok: false, code: "ERROR_CODE", message: "描述", degraded?: true }
```

### 1.4 数据隔离：GraphStore 已有 orgId 隔离

当前 GraphStore（`packages/engine-core/src/pipeline/diagnosis/graph-store.ts`）所有方法均强制 `graph` 参数（即 `orgId` / `enterpriseId`）。运行时若省略则抛出 `GraphStoreError('SOG-002')`：

```typescript
// 已有隔离模式 — 无需修改
graphStore.createNode(SOGNodeType.PERSON, { name, email }, enterpriseId);
graphStore.queryNodes(SOGNodeType.PERSON, { department: 'finance' }, enterpriseId);
graphStore.queryEdges(SOGEdgeType.REPORTS_TO, undefined, undefined, enterpriseId);
```

多用户场景下，所有 Server 端 GraphStore 操作均以 `enterpriseId` 作为 `graph` 参数，天然隔离不同企业数据。SQLite 单文件内通过 `graph` 列 + 索引（`idx_gn_type`, `idx_gt_subject`, `idx_gt_object`）保证查询性能。

---

## 2. 企业注册完整数据流

### 2.1 触发场景

admin 首次启动 Electron 客户端 → 未检测到本地存储的 `serverUrl` → 显示"首次使用"向导 → 选择"创建新企业"。

### 2.2 完整数据流

```
admin 首次启动 Electron
        │
        ▼
  [客户端] 检测本地无 serverUrl / token
        │
        ▼
  [客户端] 显示"首次使用"页面
        │  - 选项A: "创建新企业"（admin）
        │  - 选项B: "加入已有企业"（成员）
        │
        ▼ (选择A)
  [客户端] 显示企业注册表单
        │  必填：企业名称
        │  选填：行业、规模、管理员姓名、管理员邮箱、管理员密码
        │
        ▼
  POST /api/enterprise/register
        │
        ▼
  [Server] 参数校验
        │  - name 必填，非空，2-100 字符
        │  - industry 选填，枚举值校验
        │  - scale 选填，枚举值校验
        │  - adminEmail 必填，格式校验
        │  - adminPassword 必填，≥8 字符
        │
        ▼
  [Server] 检查企业名 + 邮箱唯一性
        │  - GraphStore queryNodes(ENTERPRISE, {name}, enterpriseId) 查重
        │  - 邮箱查重：检查是否已被注册
        │
        ▼
  [Server] 生成 enterpriseId
        │  格式: ent_{8位随机hex}_{timestamp36}
        │  示例: ent_a3f2c1b9_m7k2x9p4
        │
        ▼
  [Server] bcrypt 哈希 admin 密码 (cost=12)
        │
        ▼
  [Server] SQLite 事务写入
        │  1. INSERT INTO users (userId, email, passwordHash, role, enterpriseId, createdAt)
        │     → userId: user_{8位随机hex}_{timestamp36}
        │  2. GraphStore createNode(ENTERPRISE, {name, industry, scale, createdAt}, enterpriseId)
        │  3. GraphStore createNode(PERSON, {name, email, userId}, enterpriseId)
        │  4. GraphStore createEdge(HAS_MEMBER, enterpriseNodeId, personNodeId, 1.0, {role:'admin'}, enterpriseId)
        │
        ▼
  [Server] 签发 JWT (payload: sub=userId, role=admin, orgId=enterpriseId)
        │
        ▼
  Response 201:
        │  { ok: true,
        │    enterprise: { enterpriseId, name, industry, scale },
        │    user: { userId, email, role: 'admin' },
        │    token: "<jwt>",
        │    serverUrl: "http://<hostname>:3100" }
        │
        ▼
  [客户端] 存储到本地：
        │  - serverUrl → electron-store
        │  - token → electron-store (加密存储)
        │  - userId, enterpriseId → electron-store
        │
        ▼
  [客户端] 跳转到管理员工作台
```

### 2.3 API 定义

**POST /api/enterprise/register**

认证：无需（开放端点）

请求体：
```json
{
  "name": "string (必填, 2-100字符)",
  "industry": "string (选填, 枚举: tech|manufacturing|retail|service|finance|education|healthcare|other)",
  "scale": "string (选填, 枚举: 1-10|11-50|51-200|201-500|500+)",
  "adminName": "string (必填, 1-50字符)",
  "adminEmail": "string (必填, 合法邮箱格式)",
  "adminPassword": "string (必填, ≥8字符)"
}
```

响应 201:
```json
{
  "ok": true,
  "enterprise": {
    "enterpriseId": "ent_a3f2c1b9_m7k2x9p4",
    "name": "客户A科技有限公司",
    "industry": "retail",
    "scale": "11-50",
    "createdAt": "2026-07-21T10:30:00.000Z"
  },
  "user": {
    "userId": "user_x8k3m2p1_n5v7q2r9",
    "email": "boss@example.com",
    "role": "admin"
  },
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "payload": {
    "userId": "user_x8k3m2p1_n5v7q2r9",
    "role": "admin",
    "orgId": "ent_a3f2c1b9_m7k2x9p4",
    "expiresAt": 1751423400,
    "jti": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

错误响应 409:
```json
{ "ok": false, "code": "ENTERPRISE_EXISTS", "message": "企业名称已被注册" }
```

错误响应 409:
```json
{ "ok": false, "code": "EMAIL_EXISTS", "message": "该邮箱已被注册" }
```

错误响应 400:
```json
{ "ok": false, "code": "VALIDATION_ERROR", "message": "密码长度不足8位" }
```

### 2.4 GraphStore 企业节点初始化

企业注册时在 GraphStore 中创建以下本体结构：

```
ENTERPRISE 节点 (enterpriseId):
  props: { name, industry, scale, createdAt, memberCount: 1, status: 'active' }

PERSON 节点 (userNodeId):
  props: { name: adminName, email: adminEmail, userId, createdAt }

HAS_MEMBER 边:
  type: HAS_MEMBER
  from: enterpriseNodeId
  to: userNodeId
  weight: 1.0
  props: { role: 'admin', joinedAt: ISO timestamp }
```

### 2.5 新增 users 表

当前系统无用户表。多用户部署需要新增 SQLite `users` 表，与 GraphStore User 节点保持同步：

```sql
CREATE TABLE IF NOT EXISTS users (
  userId      TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff',  -- admin|manager|liaison|staff|ga
  enterpriseId TEXT NOT NULL,
  displayName TEXT NOT NULL DEFAULT '',
  createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt   TEXT NOT NULL DEFAULT (datetime('now')),
  lastLoginAt TEXT,
  status      TEXT NOT NULL DEFAULT 'active'  -- active|invited|disabled
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_enterprise ON users(enterpriseId);
```

---

## 3. 成员邀请完整数据流

### 3.1 触发场景

admin 在管理员工作台 → "成员管理" → 点击"邀请成员" → 填写邮箱 + 选择角色 → 发送邀请。

### 3.2 邀请阶段

```
admin 点击"邀请成员"
        │
        ▼
  [客户端] 显示邀请表单
        │  - 邮箱 (必填)
        │  - 角色选择: admin | manager | liaison | staff | ga
        │    (admin 角色限制：每个企业最多3个 admin)
        │  - 可选：留言
        │
        ▼
  POST /api/enterprise/invite
        │  Authorization: Bearer <admin_jwt>
        │
        ▼
  [Server] 验证调用者 admin 权限
        │  - extractRbacContext(req) → 确认 role === 'admin'
        │  - canAccessWorkspace(ctx, ws) → 确认 orgId 匹配
        │
        ▼
  [Server] 检查：
        │  1. 邮箱是否已注册 → 409 EMAIL_EXISTS
        │  2. 邮箱是否已有待处理邀请 → 409 INVITE_PENDING
        │  3. admin 角色数量是否已达上限 → 403 ADMIN_LIMIT_REACHED
        │
        ▼
  [Server] 生成邀请记录
        │  inviteId: inv_{12位随机hex}
        │  inviteToken: jwt_{64位随机hex}  (一次性，48小时过期)
        │  写入 invites 表
        │
        ▼
  [Server] 生成邀请链接
        │  格式: http://<serverUrl>/join?token=<inviteToken>
        │
        ▼
  Response 201:
        │  { ok: true, invite: { inviteId, email, role, inviteToken, expiresAt } }
        │
        ▼
  [Server] admin 将邀请链接通过外部渠道（邮件/微信/飞书等）
        发送给被邀请者。此步骤由 admin 手动完成或通过系统邮件服务。
```

### 3.3 接受邀请阶段

```
成员收到邀请链接
        │
        ▼
  [客户端] 打开链接 → 显示"接受邀请"页面
        │  - 显示：企业名称、被邀请角色
        │  - 设置密码表单 (≥8字符)
        │  - 显示名称 (选填)
        │
        ▼
  POST /api/enterprise/accept-invite
        │  无需认证（开放端点）
        │
        ▼
  [Server] 验证 inviteToken
        │  - 存在且未过期（48小时内）
        │  - 未被使用（accepted = false）
        │
        ▼
  [Server] 创建用户
        │  1. bcrypt 哈希密码 (cost=12)
        │  2. INSERT INTO users (userId, email, passwordHash, role, enterpriseId, displayName)
        │  3. GraphStore createNode(PERSON, {name, email, userId}, enterpriseId)
        │  4. GraphStore createEdge(HAS_MEMBER, enterpriseNodeId, personNodeId, 1.0, {role}, enterpriseId)
        │  5. UPDATE invites SET accepted=true, acceptedAt=now WHERE inviteId
        │  6. UPDATE enterprises SET memberCount=memberCount+1
        │
        ▼
  Response 201:
        │  { ok: true,
        │    user: { userId, email, role },
        │    enterprise: { enterpriseId, name },
        │    message: "账号已创建。请启动 Synova 客户端，使用以下信息连接：",
        │    connectionInfo: {
        │        serverUrl: "http://<hostname>:3100",
        │        email: "member@example.com"
        │    }
        │  }
```

### 3.4 成员首次连接

```
成员启动 Electron 客户端
        │
        ▼
  [客户端] 检测本地无 token
        │
        ▼
  [客户端] 显示登录页面
        │  - serverUrl 输入框 (默认填 http://<hostname>:3100)
        │  - 邮箱输入框
        │  - 密码输入框
        │  - "连接"按钮
        │
        ▼
  POST /api/auth/login
        │
        ▼
  [Server] bcrypt 密码校验
        │  - 查询 users 表 → 获取 passwordHash
        │  - bcrypt.compare(password, passwordHash)
        │  - 失败 → 401
        │
        ▼
  [Server] 签发 JWT
        │  与现有 signJwtToken 相同
        │  payload: { sub: userId, role, orgId: enterpriseId }
        │
        ▼
  Response 200:
        │  { ok: true, token, payload: { userId, role, orgId, expiresAt, jti } }
        │
        ▼
  [客户端] 存储 token + serverUrl → electron-store
        │  更新 lastLoginAt
        │
        ▼
  [客户端] 加载主界面（根据 role 展示不同视图）
```

### 3.5 邀请 API 定义

**POST /api/enterprise/invite**

认证：Bearer JWT（admin/manager 角色）

请求体：
```json
{
  "email": "string (必填)",
  "role": "string (必填, admin|manager|liaison|staff|ga)",
  "message": "string (选填, 个人留言)"
}
```

响应 201:
```json
{
  "ok": true,
  "invite": {
    "inviteId": "inv_a3f2c1b9e5d8",
    "email": "member@example.com",
    "role": "staff",
    "inviteToken": "jwt_x8k3m2p1n5v7q2r9w4a6b8c0d2e4f6g8h0j2k4m6n8p0q2r4s6t8u0v2w4",
    "expiresAt": "2026-07-23T10:30:00.000Z",
    "inviteLink": "http://192.168.1.100:3100/join?token=jwt_x8k3m2..."
  }
}
```

错误响应 409:
```json
{ "ok": false, "code": "EMAIL_EXISTS", "message": "该邮箱已被注册" }
```

错误响应 409:
```json
{ "ok": false, "code": "INVITE_PENDING", "message": "该邮箱已有待处理邀请" }
```

错误响应 403:
```json
{ "ok": false, "code": "ADMIN_LIMIT_REACHED", "message": "admin 角色已达上限(3人)" }
```

**POST /api/enterprise/accept-invite**

认证：无需

请求体：
```json
{
  "inviteToken": "string (必填)",
  "password": "string (必填, ≥8字符)",
  "displayName": "string (选填)"
}
```

响应 201:
```json
{
  "ok": true,
  "user": { "userId": "user_...", "email": "...", "role": "staff" },
  "enterprise": { "enterpriseId": "ent_...", "name": "..." },
  "connectionInfo": { "serverUrl": "http://...", "email": "..." }
}
```

错误响应 400:
```json
{ "ok": false, "code": "INVALID_TOKEN", "message": "邀请链接无效或已过期" }
```

**GET /api/enterprise/members**

认证：Bearer JWT

响应 200:
```json
{
  "ok": true,
  "members": [
    { "userId": "...", "email": "...", "role": "admin", "displayName": "...", "joinedAt": "...", "lastLoginAt": "..." }
  ],
  "pendingInvites": [
    { "inviteId": "...", "email": "...", "role": "staff", "createdAt": "...", "expiresAt": "..." }
  ]
}
```

**DELETE /api/enterprise/invite/:inviteId**

认证：Bearer JWT（admin）

响应 200:
```json
{ "ok": true, "message": "邀请已撤回" }
```

### 3.6 新增 invites 表

```sql
CREATE TABLE IF NOT EXISTS invites (
  inviteId     TEXT PRIMARY KEY,
  enterpriseId TEXT NOT NULL,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL,
  inviteToken   TEXT NOT NULL UNIQUE,
  invitedBy    TEXT NOT NULL,  -- admin userId
  message      TEXT DEFAULT '',
  accepted     INTEGER NOT NULL DEFAULT 0,
  createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
  expiresAt    TEXT NOT NULL,  -- 48 hours after createdAt
  acceptedAt   TEXT
);
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(inviteToken);
CREATE INDEX IF NOT EXISTS idx_invites_email_enterprise ON invites(email, enterpriseId);
```

---

## 4. 认证升级方案：JWT Demo → 生产级

### 4.1 当前状态

当前 `src/routes/auth.ts` 是 JWT Demo：login 端点不校验密码，接收任意 `userId` + `role` + `orgId` 即签发 JWT。适用于单机开发环境，不适合多用户生产。

现有 JWT 核心组件（`src/middleware/auth.ts`）已实现完整的 HMAC-SHA256 JWT 签发/验证/撤销（`signJwtToken` / `verifyJwtToken` / `revokeToken`），无需替换。升级集中在路由层。

### 4.2 升级目标

| 维度 | 当前（Demo） | 目标（生产级） |
|------|------------|--------------|
| 密码校验 | 无。接受任意 userId | bcrypt.hash(password, 12) 存储 + bcrypt.compare() 验证 |
| 用户注册 | 无。POST /api/auth/login 手动填参 | POST /api/auth/register 独立注册端点 |
| JWT payload | sub=userId, role, orgId | sub=userId, role, orgId（兼容现有 extractRbacContext） |
| 撤销机制 | in-memory Set（已有） | in-memory Set（不变。v2 迁移至 SQLite 持久化） |
| 密码策略 | 无 | ≥8字符。v2 增加复杂度要求 |
| 登录限流 | 无 | v2 增加 rate-limit（5次失败/15分钟/IP） |

### 4.3 routes/auth.ts 具体修改

#### 4.3.1 新增 POST /api/auth/register

```typescript
/**
 * POST /api/auth/register — 用户自主注册（仅 MVS 阶段用于 admin 首次创建）
 *
 * Body: { email, password, displayName? }
 * 生产阶段：普通用户通过邀请链接注册（/api/enterprise/accept-invite），
 * 此端点仅在 MVS 阶段开放。
 */
router.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, password, displayName } = req.body as {
      email?: string; password?: string; displayName?: string;
    };

    // 参数校验
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        ok: false, code: 'VALIDATION_ERROR', message: '请提供有效的邮箱地址'
      });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({
        ok: false, code: 'VALIDATION_ERROR', message: '密码长度至少8位'
      });
    }

    // 检查邮箱唯一性
    const existing = db.prepare('SELECT userId FROM users WHERE email=?').get(email);
    if (existing) {
      return res.status(409).json({
        ok: false, code: 'EMAIL_EXISTS', message: '该邮箱已被注册'
      });
    }

    // bcrypt 哈希 (cost=12)
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash(password, 12);
    const { randomBytes } = require('crypto');
    const userId =
      'user_' + randomBytes(6).toString('hex') + '_' + Date.now().toString(36);
    const role = 'admin'; // MVS 阶段首个用户为 admin
    const orgId =
      'ent_' + randomBytes(6).toString('hex') + '_' + Date.now().toString(36);

    // 事务写入 users 表 + GraphStore（略，见 Section 2.4）

    // 签发 JWT
    const token = signJwtToken({ sub: userId, role, orgId });
    if (!token) {
      return res.status(500).json({
        ok: false, code: 'AUTH_CONFIG_ERROR',
        message: 'JWT_SECRET 未配置', degraded: true
      });
    }

    log.info({ userId, email, role, orgId }, '用户注册成功');
    return res.status(201).json({
      ok: true, token,
      payload: { userId, role, orgId,
        expiresAt: Math.floor(Date.now() / 1000) + getExpiresIn()
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'register 异常');
    return res.status(500).json({
      ok: false, code: 'INTERNAL_ERROR', message: msg, degraded: true
    });
  }
});
```

#### 4.3.2 修改 POST /api/auth/login — 增加密码校验

当前（Demo）：直接接收 `userId` + `role` + `orgId`，不验密码。
修改后：接收 `email` + `password` → 查库校验 bcrypt → 签发 JWT。

```typescript
/**
 * POST /api/auth/login — 生产级登录
 *
 * Body: { email, password }
 * 与现有 extractRbacContext 完全兼容：JWT payload 的
 * sub → ctx.userId, role → ctx.role, orgId → ctx.orgId
 */
router.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as {
      email?: string; password?: string;
    };

    // 参数校验
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        ok: false, code: 'VALIDATION_ERROR', message: '请提供有效的邮箱地址'
      });
    }
    if (!password) {
      return res.status(400).json({
        ok: false, code: 'VALIDATION_ERROR', message: '密码必填'
      });
    }

    // 查库
    const userRow = db.prepare(
      'SELECT * FROM users WHERE email=? AND status=?'
    ).get(email, 'active') as any;
    if (!userRow) {
      // 统一延时防用户枚举（timing attack mitigation）
      await new Promise(r => setTimeout(r, 200 + Math.random() * 200));
      return res.status(401).json({
        ok: false, code: 'UNAUTHORIZED', message: '邮箱或密码错误'
      });
    }

    // bcrypt 验证
    const bcrypt = require('bcrypt');
    const valid = await bcrypt.compare(password, userRow.passwordHash);
    if (!valid) {
      return res.status(401).json({
        ok: false, code: 'UNAUTHORIZED', message: '邮箱或密码错误'
      });
    }

    // 签发 JWT（payload 与 extractRbacContext 兼容）
    const token = signJwtToken({
      sub: userRow.userId,
      role: userRow.role,
      orgId: userRow.enterpriseId,
    });
    if (!token) {
      return res.status(500).json({
        ok: false, code: 'AUTH_CONFIG_ERROR',
        message: 'JWT_SECRET 未配置', degraded: true
      });
    }

    // 更新最后登录时间
    db.prepare('UPDATE users SET lastLoginAt=? WHERE userId=?')
      .run(new Date().toISOString(), userRow.userId);

    const result = verifyJwtToken(token);
    log.info({
      userId: userRow.userId, role: userRow.role,
      orgId: userRow.enterpriseId
    }, '登录成功');

    return res.json({
      ok: true, token,
      payload: {
        userId: result.payload?.sub,
        role: result.payload?.role,
        orgId: result.payload?.orgId,
        expiresAt: result.payload?.exp,
        jti: result.payload?.jti,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'login 异常');
    return res.status(500).json({
      ok: false, code: 'INTERNAL_ERROR', message: msg, degraded: true
    });
  }
});
```

### 4.4 与现有 RBAC 的兼容性

现有 `extractRbacContext`（`src/middleware/rbac.ts`）优先读取 `req.auth`：

```typescript
export function extractRbacContext(req: {
  auth?: { sub: string; role: string; orgId: string }
}): RbacContext {
  if (req.auth) {
    return {
      role: req.auth.role as WorkspaceRole,  // ← 直接映射
      department: undefined,
      userId: req.auth.sub,                   // ← 直接映射
    };
  }
  // 向下兼容 x-synova-token ...
}
```

新 JWT payload 的 `sub` / `role` / `orgId` 字段与现有代码完全兼容：

| JWT payload 字段 | extractRbacContext 映射 | 兼容性 |
|------------------|------------------------|--------|
| `sub` (userId) | `ctx.userId` | 完全兼容 |
| `role` | `ctx.role` | 完全兼容（五角色枚举不变） |
| `orgId` | 暂未映射到 RbacContext（预留） | 未来可用于 `canAccessWorkspace` 跨企业隔离 |

`canAccessWorkspace` 和 `canModifyWorkspace` 无需修改。`orgId` 隔离已在 GraphStore 层完成（§1.4），RBAC 层暂不需要 orgId 感知。

### 4.5 bcrypt 依赖

```bash
npm install bcrypt
npm install -D @types/bcrypt
```

---

## 5. 部署模式定义

### 5.1 三种部署模式

| 维度 | 单机模式 | 局域网模式 | 云端模式（未来） |
|------|---------|-----------|----------------|
| **适用场景** | 5-20人团队起步，无专职IT | 20-100人，有内部网络 | 分布式团队/多办公室 |
| **Server 位置** | 老板的电脑（Server+客户端合一） | 专用机器/NAS/Linux 服务器 | 云服务器（阿里云/腾讯云/AWS） |
| **可用性** | 老板开机在线，关机其他人不可用 | 7x24在线 | 7x24在线，SLA 99.9% |
| **硬件要求** | 8GB+ RAM, 4核+, 10GB 空闲磁盘 | 16GB+ RAM, 8核+, 50GB SSD, Linux (Ubuntu 22.04+) | 云主机 4C8G, 50GB SSD |
| **安装方式** | 标准 MSI/DMG/AppImage 安装包 | Server: npm 全局安装或 Docker。客户端: 标准安装包 | Server: Docker Compose 一键部署 |
| **网络要求** | 无（localhost） | 局域网内 TCP 可达 | 公网 HTTPS + WAF |
| **备份策略** | 客户端本地备份 + 手动导出 | 定时自动备份 + 异地存储 | 自动备份 + 快照 + 多AZ |
| **升级方式** | 客户端自升级 | Server 蓝绿热替换 + 客户端冷替换 | 滚动升级 |

### 5.2 单机模式迁移到局域网模式

当团队从 5 人增长到 20+ 人时，老板的电脑不再是合适的 Server 宿主机。迁移路径：

```
Step 1: 准备新服务器
  - 安装 Node.js 22+ 和 npm
  - 安装 synova-agent: npm install -g synova-agent
  - 确保局域网内 TCP 可达（建议固定 IP 或主机名）

Step 2: 复制数据
  - 在老板电脑上停止 Synova（退出 Electron）
  - 复制整个数据目录到新服务器：
    data/
    ├── database.sqlite    (GraphStore + Sessions + Sentinel + Audit)
    ├── config.yaml        (哨兵阈值/LLM配置/企业GA信息)
    ├── baselines/         (哨兵基线文件)
    └── logs/              (可选)
  - 放置到新服务器的 /var/lib/synova-agent/data/

Step 3: 配置新 Server
  - 设置环境变量：
    PORT=3100
    JWT_SECRET=<原有密钥>  (必须与老板机器一致，否则已有 token 全部失效)
    DATA_DIR=/var/lib/synova-agent/data
    DEV_MODE=false
  - 启动: synova-agent start
  - 验证: curl http://<new-server-ip>:3100/health → { ok: true }

Step 4: 客户端切换
  - 所有用户（包括老板）更新 Electron 客户端的 serverUrl：
    旧: http://localhost:3100
    新: http://<new-server-ip>:3100
  - 客户端会自动检测 serverUrl 变更 → 触发重新登录
  - 已有 JWT token 在密钥一致时仍然有效（无需重新登录）

Step 5: 验证
  - 老板在新客户端登录 → 确认数据完整（诊断历史、哨兵配置、成员列表）
  - 至少2个其他成员登录验证
  - 运行一次手动诊断确认管线正常
  - 观察哨兵基线 24 小时确认正常

Step 6: 清理
  - 老板电脑可保留 data/ 作为冷备份
  - 或删除 data/ 释放磁盘空间（客户端不再需要完整数据库）
```

### 5.3 升级提示机制

系统内置升级提示逻辑，在管理员工作台首页展示：

```
触发条件                      提示内容
────────────────────────────────────────────────────────────
首次启动                        "这台机器将成为 Synova Server。
                                其他团队成员需要通过局域网连接。
                                如需 7x24 可用，建议后续迁移到
                                独立服务器模式。"

活跃用户 ≥3 且仍为单机模式       "检测到 3 名活跃用户。建议将
                                Synova Server 迁移到独立服务器，
                                以保证 7x24 可用性和性能。
                                [查看迁移指南] [暂时忽略]"

活跃用户 ≥10 且仍为单机模式      "⚠ 活跃用户已达 10 人。单机模式
                                性能可能不足。强烈建议迁移到
                                局域网模式。[立即迁移]"

Server 连续运行超过 7 天未重启    "Server 已连续运行 7 天。建议配置
且为单机模式                     自动重启策略或迁移到独立服务器。"
```

实现方式：Server 端维护 `enterprise.memberCount` 和 `enterprise.lastActiveUserCount`，在每次诊断/哨兵生成时更新。管理员工作台 GET `/api/enterprise/status` 返回升级建议。

**GET /api/enterprise/status**

认证：Bearer JWT（admin）

响应 200:
```json
{
  "ok": true,
  "enterprise": { "name": "...", "memberCount": 5, "activeUsers": 4 },
  "deploymentMode": "standalone",
  "serverUptime": "7d 12h",
  "upgradeSuggestion": {
    "level": "info",
    "message": "检测到 3 名活跃用户...",
    "recommendedMode": "lan",
    "migrationGuide": "/docs/deployment/migrate-to-lan"
  }
}
```

---

## 6. Electron 离线缓存策略

### 6.1 缓存原则

Electron 客户端是瘦客户端，不运行诊断逻辑。但当 Server 不可达时（老板关机、网络中断），客户端应展示缓存的聚合数据而非白屏。

**缓存什么**：

| 数据类型 | 缓存 | 说明 |
|---------|------|------|
| 仪表盘聚合数据 | 是 | GPI 趋势、哨兵概览、健康评分、最近 N 条告警摘要 |
| 诊断报告摘要 | 是 | 最近 5 次诊断报告的核心结论和分数 |
| 工单列表 | 是 | 最近 50 条工单的状态和标题 |
| 成员列表 | 是 | 企业成员姓名/角色（低频变更） |
| 哨兵原始 Finding | 否 | 42 边参数原始数据，体积大且离线无分析价值 |
| GraphStore 本体数据 | 否 | 属于原始数据，客户端不缓存 |
| 企业文档/ima 文档 | 否 | 文档可能包含敏感信息，不在客户端本地存储 |
| LLM 对话历史 | 否 | 对话状态由 Server 管理 |

**缓存存储**：Electron `electron-store` 加密存储（`encryptionKey` 由 OS keychain 派生）。

**缓存位置**：
- Windows: `%APPDATA%/Synova/cache/`
- macOS: `~/Library/Application Support/Synova/cache/`

**缓存格式**：JSON 文件，按数据类型分文件存储。

**最大缓存大小**：50MB。超过后按 LRU 清理最早的文件。

**缓存 TTL**：每次成功从 Server 拉取时更新。超过 7 天未更新的缓存数据标记为过期（非删除）。

**敏感字段脱敏**：缓存前过滤 `password`、`token`、`apiKey` 等字段。

**缓存写入时机**：每次成功 GET 请求后异步写入，不阻塞 UI。

**缓存读取时机**：网络请求失败时作为 fallback。

### 6.2 离线界面

```
┌─────────────────────────────────────────────────┐
│  Synova                                          │
│  ⚠ 无法连接到 Synova Server                      │
│  最后更新：2026-07-21 14:30                       │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐              │
│  │ GPI: 72.5     │  │ 健康: 良好   │              │
│  │ ↑ 3.1 vs 上月 │  │ 3 项注意     │              │
│  └──────────────┘  └──────────────┘              │
│                                                  │
│  最近告警 (缓存)                                  │
│  ⚠ 客户流失率上升至 6.1%        2026-07-20        │
│  ⚠ 库存周转天数延长至 45 天     2026-07-18        │
│                                                  │
│  ⚡ 连接恢复后将自动刷新                          │
│  [手动重试]                                      │
└─────────────────────────────────────────────────┘
```

数据过期标注：超过 7 天的缓存数据在界面右侧标注 `⚠ 数据可能已过期 (7天前)` 标识。

### 6.3 连接恢复检测

客户端每 30 秒对 Server `/health` 端点发起一次轻量 GET（无认证），成功即触发全量数据刷新。刷新策略：

1. 连接恢复 → 立即拉取仪表盘聚合数据
2. 拉取成功后 → 逐项拉取工单、诊断摘要
3. 全部成功后 → 移除离线状态标识，更新"最后更新时间"
4. 如部分接口失败 → 保留对应模块的缓存数据，仅更新成功的模块

### 6.4 缓存数据结构

```
cache/
├── dashboard.json       # { updatedAt, gpi, health, alertSummary, ... }
├── reports.json         # { updatedAt, reports: [{id, title, score, createdAt}] }
├── tickets.json         # { updatedAt, tickets: [{id, status, title, createdAt}] }
├── members.json         # { updatedAt, members: [{userId, email, role, displayName}] }
└── cache-meta.json      # { version: 1, totalSize: 2.3MB, lastFullSync: ISO }
```

每个文件独立更新。任一文件超过 7 天未更新 → 标记 `stale: true` → 界面显示过期提示。

---

## 附录 A：API 端点汇总

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/enterprise/register` | 无 | 注册企业 + 创建 admin |
| POST | `/api/enterprise/invite` | admin/manager | 邀请成员 |
| POST | `/api/enterprise/accept-invite` | 无 | 接受邀请 + 设置密码 |
| GET | `/api/enterprise/members` | JWT | 获取成员列表 + 待处理邀请 |
| DELETE | `/api/enterprise/invite/:inviteId` | admin | 撤回邀请 |
| GET | `/api/enterprise/status` | JWT | 企业状态 + 升级建议 |
| POST | `/api/auth/register` | 无 | 用户注册（MVS） |
| POST | `/api/auth/login` | 无 | 登录（bcrypt 密码校验 → JWT 签发） |
| POST | `/api/auth/refresh` | 无（需旧 token） | 刷新 JWT |
| POST | `/api/auth/revoke` | admin/manager | 撤销 JWT |
| GET | `/api/auth/validate` | JWT | 验证 token 有效性 |
| GET | `/health` | 无 | 健康检查（客户端连接检测） |

## 附录 B：新增文件清单

| 文件 | 说明 |
|------|------|
| `src/routes/enterprise.ts` | 企业注册 + 成员管理路由 |
| `src/store/user-store.ts` | users + invites 表 CRUD |
| `src/routes/auth.ts`（修改） | login 增加 bcrypt 校验 + 新增 register |
| `src/middleware/auth.ts`（修改） | 白名单增加 `/api/enterprise/register`, `/api/enterprise/accept-invite` |
| Electron 客户端修改 | 登录页面、serverUrl 配置、离线缓存、系统托盘 |

## 附录 C：新增 SQL 表汇总

| 表 | 说明 |
|------|------|
| `users` | 用户账号（userId, email, passwordHash, role, enterpriseId, status） |
| `invites` | 邀请记录（inviteId, email, role, inviteToken, accepted, expiresAt） |

`users` 表与 GraphStore PERSON 节点双写。GraphStore 负责本体关系查询（HAS_MEMBER 边），`users` 表负责快速登录鉴权（email → passwordHash）。两者通过 `userId` 关联。
