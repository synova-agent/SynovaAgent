<!--
  Synova 企业多用户部署 | 第三章：管理员工作台与客户端改造
  版本: v1.0 | 日期: 2026-07-21 | 作者: Synova 研究组
  定位: 产品设计文档——定义 Electron 客户端的管理员工作台、启动配置页、首次引导流程与成员邀请链路
  前置输入: 研究方案 v2.0, 权威05 Module 3 (GA人机协同), auth.ts, rbac.ts
-->

# 第三章：管理员工作台与客户端改造

> 核心问题：从"单机 Demo"到"企业多用户部署"，客户端需要哪些改造？管理员如何创建企业、邀请成员、管理权限？
> 本章产出：Electron 管理员工作台设计、客户端启动配置页、首次引导流程、成员邀请完整链路

---

## 3.0 现状与目标

| 维度 | Demo 现状 | 企业版目标 |
|------|----------|----------|
| 登录方式 | 任意 userId + role 即可签发 JWT | 邮箱 + bcrypt 密码认证 |
| 多用户 | 不支持 | 企业 admin 邀请成员，RBAC 权限隔离 |
| 客户端 | 单一 serverUrl（localhost:3000） | 可配置 serverUrl + 自动连接 + 局域网发现 |
| 部署模式 | 单机 | 单机 → 局域网 → 迁移向导 |
| 管理界面 | 无 | Electron 内置管理员工作台 |

---

## 3.1 Electron 内置管理员工作台

### 3.1.1 访问入口

管理员工作台是 Electron 应用内嵌的一个 Web 页面，通过主进程的 `BrowserWindow` 渲染。只有 `role === 'admin'` 的用户可以访问。

```
Electron 主进程菜单:
  ┌──────────────────────────────────────┐
  │ SynovaAgent                          │
  │ ─────────────────────────────────── │
  │ 诊断面板                               │
  │ 增长导航                               │
  │ ─────────────────────────────────── │
  │ 管理员工作台  ← admin 可见            │
  │ ─────────────────────────────────── │
  │ 设置...                               │
  └──────────────────────────────────────┘
```

### 3.1.2 工作台页面结构

管理员工作台包含 5 个标签页：

| 标签页 | 路由 | 功能 |
|--------|------|------|
| **企业信息** | `/admin/enterprise` | 企业名称、行业、规模、创建时间、许可证信息 |
| **成员管理** | `/admin/members` | 邀请成员、查看列表、修改角色、移除成员 |
| **权限管理** | `/admin/permissions` | 按角色查看权限矩阵、修改默认权限 |
| **ima 绑定** | `/admin/ima` | 输入 ima API Key → 测试连接 → 保存 |
| **部署模式** | `/admin/deployment` | 单机 ↔ 局域网切换、迁移向导 |

### 3.1.3 企业信息管理 (标签页 1)

```
┌─────────────────────────────────────────────────────────────────────┐
│  企业信息                                          SynovaAgent Admin │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  企业名称:    [客户A母婴有限公司_______________]                    │
│  行业:        [母婴零售 / 制造______________▾]                      │
│  团队规模:    [50-100人____________________▾]                       │
│  年营收:      [3000万____________________▾]                         │
│                                                                     │
│  创建时间:    2026-07-01                                            │
│  成员数量:    12 / 50（许可证上限）                                  │
│  许可证类型:  Pro (年付)                                            │
│  许可证到期:  2027-07-01                                            │
│                                                                     │
│  [保存修改]                                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.1.4 成员管理 (标签页 2)

**邀请成员流程**：

```
┌─────────────────────────────────────────────────────────────────────┐
│  成员管理                                          SynovaAgent Admin │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [+ 邀请成员]                                                       │
│                                                                     │
│  ┌─────────────────────────────────────────────┐                    │
│  │ 邀请新成员                                   │                    │
│  │                                             │                    │
│  │ 邮箱:  [zhangsan@wannibaby.com_____________] │                    │
│  │ 角色:  [经理 ▾]  （admin / manager / staff）  │                    │
│  │ 部门:  [财务部 ▾]                            │                    │
│  │                                             │                    │
│  │ [取消]  [发送邀请]                           │                    │
│  └─────────────────────────────────────────────┘                    │
│                                                                     │
│  成员列表:                                                          │
│  ┌──────┬────────────┬────────┬────────┬─────────────────┐         │
│  │ 姓名  │ 邮箱        │ 角色    │ 状态    │ 操作             │         │
│  ├──────┼────────────┼────────┼────────┼─────────────────┤         │
│  │ 王总  │ wang@...   │ admin  │ 活跃    │ [编辑] [移除...] │         │
│  │ 李经理│ li@...     │ manager│ 活跃    │ [编辑] [移除...] │         │
│  │ 张会计│ zhang@...  │ staff  │ 待加入  │ [重发邀请] [移除] │         │
│  └──────┴────────────┴────────┴────────┴─────────────────┘         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**邀请 API**:

```
POST /api/enterprise/invite
Authorization: Bearer <admin_jwt>
Body: {
  email: "zhangsan@wannibaby.com",
  role: "manager",
  department: "财务部"
}

Response (201):
{
  ok: true,
  invitation: {
    id: "inv_abc123",
    email: "zhangsan@wannibaby.com",
    role: "manager",
    department: "财务部",
    invitedBy: "admin_user_id",
    invitedAt: "2026-07-21T10:00:00Z",
    status: "pending",
    expiresAt: "2026-07-28T10:00:00Z",  // 7 天有效
    inviteLink: "https://synova.local/join?token=inv_abc123"
  }
}
```

**权限管理 API**:

```
GET /api/enterprise/members
Authorization: Bearer <admin_jwt>

Response:
{
  ok: true,
  members: [
    { userId, email, name, role, department, status, joinedAt },
    ...
  ],
  total: 12
}

PUT /api/enterprise/members/:userId
Authorization: Bearer <admin_jwt>
Body: { role: "staff", department: "市场部" }

DELETE /api/enterprise/members/:userId
Authorization: Bearer <admin_jwt>
→ 软删除：设置 status = "disabled"，保留审计记录
```

### 3.1.5 ima 知识库绑定 (标签页 3)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ima 知识库绑定                                    SynovaAgent Admin │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  状态: ● 已连接                                                     │
│                                                                     │
│  API Key:  [●●●●●●●●●●●●●●●●sk_xxxx________] [显示]                │
│  过期时间:  2026-12-31                                              │
│  上次校验:  2026-07-21 08:00（正常）                                 │
│  提取文档:  245 篇（最近更新: 3 篇）                                 │
│                                                                     │
│  [测试连接]  [保存]  [解绑]                                         │
│                                                                     │
│  ─────────────────────────────────────────────────────────          │
│                                                                     │
│  同步设置:                                                          │
│  扫描频率:  [每 6 小时 ▾]                                           │
│  上次同步:  2026-07-21 14:30（成功，3 篇新文档）                    │
│  下次同步:  2026-07-21 20:30                                        │
│                                                                     │
│  [手动同步]                                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.1.6 部署模式切换 (标签页 4)

```
┌─────────────────────────────────────────────────────────────────────┐
│  部署模式                                          SynovaAgent Admin │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  当前模式: ● 单机模式（本机 localhost:3000）                         │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐                │
│  │ ● 单机模式            │  │ ○ 局域网模式          │                │
│  │                      │  │                      │                │
│  │ 数据库: 本地 SQLite    │  │ 数据库: 共享服务器     │                │
│  │ 服务: localhost:3000  │  │ 服务: 192.168.x:3000  │                │
│  │ 适用: 1人使用          │  │ 适用: 团队共用         │                │
│  │                      │  │                      │                │
│  │      [当前模式]       │  │    [切换到此模式]     │                │
│  └──────────────────────┘  └──────────────────────┘                │
│                                                                     │
│  ─────────────────────────────────────────────────────────          │
│                                                                     │
│  迁移向导:                                                          │
│  当从单机切换到局域网时，启动迁移向导：                               │
│  1. 备份当前 SQLite 数据库                                          │
│  2. 指定目标服务器地址                                               │
│  3. 传输数据库文件                                                   │
│  4. 验证连接                                                         │
│  5. 切换客户端连接地址                                               │
│                                                                     │
│  [启动迁移向导]                                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3.2 Electron 客户端启动配置页

### 3.2.1 首次启动 — 配置页

用户首次打开 Electron 应用时，显示此配置页面：

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│                        SynovaAgent                                  │
│                    企业增长诊断与导航系统                              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │  服务器地址:  [localhost:3000_______________________]        │   │
│  │  邮箱:       [zhangsan@wannibaby.com________________]        │   │
│  │  密码:       [●●●●●●●●____________________________]          │   │
│  │                                                             │   │
│  │  [记住密码]  ☑                                               │   │
│  │                                                             │   │
│  │  [登录]                                                      │   │
│  │                                                             │   │
│  │  ─────────────────────────────────────────────              │   │
│  │  没有账号？联系管理员获取邀请链接。                           │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2.2 登录流程

```
用户输入 email + password + serverUrl
        │
        ▼
POST /api/auth/login
Body: { email: "zhangsan@wannibaby.com", password: "***" }
        │
        ├─→ 成功: { ok: true, token: "eyJ...", payload: { userId, role, orgId } }
        │        │
        │        ▼
        │   Electron 主进程存储:
        │     - token → electron-store (encrypted)
        │     - serverUrl → electron-store
        │     - userId / role / orgId → electron-store
        │        │
        │        ▼
        │   关闭配置页，打开诊断面板
        │
        └─→ 失败: { ok: false, code: "AUTH_FAILED", message: "邮箱或密码错误" }
                 │
                 ▼
            显示错误提示，用户重新输入
```

### 3.2.3 后续启动 — 自动连接

```
应用启动
    │
    ├─→ electron-store 中有 token？
    │   ├─→ 是 → 验证 token (GET /api/auth/validate)
    │   │        ├─→ 有效 → 直接进入诊断面板
    │   │        └─→ 过期 → 尝试 refresh (POST /api/auth/refresh)
    │   │                    ├─→ 成功 → 更新 token，进入面板
    │   │                    └─→ 失败 → 跳转到登录页
    │   └─→ 否 → 显示配置页
    │
    └─→ electron-store 中无 serverUrl？
        └─→ 默认使用 localhost:3000
```

### 3.2.4 本地存储结构 (electron-store)

```typescript
// Electron 主进程中的持久化存储（与渲染进程共享）
interface ElectronStoreSchema {
  // 认证
  token: string;              // JWT token
  refreshToken: string;       // 预留
  userId: string;
  role: string;
  orgId: string;

  // 连接
  serverUrl: string;          // 默认 "http://localhost:3000"
  autoConnect: boolean;       // 默认 true

  // UI 偏好
  rememberEmail: string;      // 记住上次登录的邮箱
  theme: 'light' | 'dark';    // 默认 'light'
  language: 'zh-CN' | 'en';

  // 安全
  encryptedFields: string[];  // 哪些字段是加密存储的
}
```

---

## 3.3 首次启动完整引导流程

### 3.3.1 场景 A：企业注册（仅 admin）

```
用户首次打开 SynovaAgent
    │
    ├─→ 尚未有企业账号？
    │       │
    │       ▼
    │   ┌──────────────────────────────┐
    │   │  没有企业账号？注册新企业     │
    │   │                              │
    │   │  企业名称: [_____________]    │
    │   │  管理员邮箱: [_____________]  │
    │   │  管理员密码: [_____________]  │
    │   │  行业: [_____________▾]      │
    │   │  团队规模: [_____________▾]  │
    │   │                              │
    │   │  [注册企业]                  │
    │   └──────────────────────────────┘
    │       │
    │       ▼
    │   POST /api/enterprise/register
    │   Body: { name, adminEmail, password, industry, teamSize }
    │       │
    │       ▼
    │   成功 → 自动登录 → 进入管理员工作台
    │       │
    │       ▼
    │   管理员邀请成员（§3.3.2）
    │
    └──→ 已有企业账号？输入 serverUrl + email + password → 登录
```

### 3.3.2 场景 B：邀请成员（仅 admin）

```
管理员在成员管理页面 → 点击 [+ 邀请成员]
    │
    ▼
输入成员邮箱 + 选择角色 + 选择部门
    │
    ▼
POST /api/enterprise/invite
    │
    ▼
系统生成邀请链接: https://synova.local/join?token=inv_abc123
    │
    ▼
系统发送邮件（或管理员手动复制邀请链接发送给成员）
    │
    ▼
成员收到邮件 → 点击邀请链接 → 进入设置密码页面
```

### 3.3.3 场景 C：成员首次登录（设置密码）

```
成员点击邀请链接
    │
    ▼
打开浏览器页面:
┌──────────────────────────────────────┐
│  欢迎加入「客户A母婴有限公司」      │
│                                      │
│  您的邮箱: zhangsan@wannibaby.com    │
│  您的角色: 经理 (财务部)              │
│                                      │
│  设置密码: [●●●●●●●●______]          │
│  确认密码: [●●●●●●●●______]          │
│                                      │
│  [设置密码并继续]                     │
└──────────────────────────────────────┘
    │
    ▼
POST /api/enterprise/invitation/accept
Body: { token: "inv_abc123", password: "***" }
    │
    ▼
成功 → 引导下载 Electron:
┌──────────────────────────────────────┐
│  密码已设置！                        │
│                                      │
│  下一步: 下载 SynovaAgent 客户端      │
│                                      │
│  [下载 Windows 版]  [下载 macOS 版]   │
│                                      │
│  安装后输入以下信息登录:              │
│  服务器地址: 192.168.1.100:3000       │
│  邮箱: zhangsan@wannibaby.com        │
│  密码: 您刚刚设置的密码               │
└──────────────────────────────────────┘
    │
    ▼
成员下载 → 安装 → 打开 Electron → 输入配置信息 → 登录 → 进入部门工作台
```

---

## 3.4 成员被邀请后的完整链路

```
时间线:  ───────────────────────────────────────────────────────────→

T0: admin 发送邀请
    POST /api/enterprise/invite
    { email: "zhangsan@wannibaby.com", role: "manager", department: "财务部" }
    → 系统记录邀请（状态: pending, 7 天有效）
    → 生成邀请链接: https://synova.local/join?token=inv_abc123
    → admin 复制链接发送给成员（或系统自动发邮件）

T1: 成员收到邀请链接
    打开链接 → 浏览器显示设置密码页面

T2: 成员设置密码
    POST /api/enterprise/invitation/accept
    { token: "inv_abc123", password: "***" }
    → bcrypt(password) → 写入 GraphStore User 节点 passwordHash
    → 用户状态变为 "active"
    → 邀请状态变为 "accepted"

T3: 成员下载 Electron
    从引导页面下载对应平台安装包
    → 安装 SynovaAgent

T4: 成员首次启动 Electron
    出现配置页面 (§3.2.1)
    → 输入 serverUrl + email + password
    → POST /api/auth/login → 获取 JWT
    → 进入部门工作台（诊断面板首页）

T5: 正常运行
    后续启动自动连接（§3.2.3）
    → 每日诊断、哨兵告警、增长导航
```

### 3.4.1 邀请状态机

```
  [admin 发送邀请]
         │
         ▼
      pending ──────────────────────────→ expired (超过 7 天)
         │
         │ (成员点击链接)
         ▼
      accepted ──→ active (成员首次登录)
         │
         │ (admin 手动撤销)
         ▼
      revoked
```

### 3.4.2 邀请相关 API

| 端点 | 方法 | 鉴权 | 功能 |
|------|------|------|------|
| `/api/enterprise/invite` | POST | admin | 创建邀请 |
| `/api/enterprise/invitations` | GET | admin | 查看所有邀请 |
| `/api/enterprise/invitations/:id` | DELETE | admin | 撤销邀请 |
| `/api/enterprise/invitation/accept` | POST | 无（通过 token） | 成员接受邀请 + 设置密码 |
| `/api/enterprise/invitation/:token` | GET | 无（通过 token） | 查看邀请详情（企业名/角色） |

---

## 3.5 与现有代码的关系

| 现有模块 | 变更类型 | 说明 |
|---------|---------|------|
| `src/routes/auth.ts` | **增强** | `POST /api/auth/login` 增加 email + bcrypt 密码校验；新增 `POST /api/auth/register` 密码设置流程 |
| `src/routes/enterprise.ts` | **新增** | 管理企业注册、邀请成员、成员列表 CRUD |
| `src/middleware/auth.ts` | **无变更** | `signJwtToken` / `verifyJwtToken` / `extractAuthFromRequest` 保持不变，JwtPayload 格式不变 |
| `src/middleware/rbac.ts` | **无变更** | 现有 `canAccessWorkspace` / `canModifyWorkspace` 控制 admin 权限 |
| Electron 主进程 | **新增** | 管理员工作台 `BrowserWindow` + electron-store 持久化 |
| Electron 渲染进程 | **新增** | 启动配置页、工作台 5 个标签页 |
| `packages/engine-core/src/pipeline/diagnosis/graph-store.ts` | **增强** | 新增 `User` 节点类型（见第五章 §5.4） |

---

## 3.6 安全考虑

| 场景 | 安全控制 |
|------|---------|
| 管理员工作台访问 | 仅 `role === 'admin'` 可访问。后端 API 双重校验（JWT role + RBAC）。 |
| 密码传输 | 通过 HTTPS（局域网模式）或 localhost 本地传输（单机模式）。 |
| 密码存储 | bcrypt(12 rounds) 哈希存储，永不明文。 |
| 邀请链接 | 一次性 token，7 天过期。仅可用于设置密码，不可用于登录。 |
| Token 存储 | electron-store 使用 `encryptionKey` 加密敏感字段（token / password）。 |
| 成员移除 | 软删除（status = "disabled"），保留审计记录。JWT 通过撤销列表即时失效。 |
