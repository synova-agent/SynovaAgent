# 证据 · #984 飞书入站装配 authProvider（可用性修复，安全不回归）

> 卡：#984（0-10，第 0 批-止血）｜写者：exec-batch0b｜日期：2026-10-04
> 分支：`fix/batch0b-984-im-provider`（基线 `origin/main` = `16a4bdaba`）
> 写集：`src/middleware/auth.ts` · `src/routes/im.ts`
> 裁决：synova-product-lead 2026-10-04 —— ① #984 原卡面前提被证伪（D947 已落 fail-closed）；
> ② 改口径为「可用性 vs 安全设计，由 **L2 实测**判定」；③ 实测后裁定 **(甲) 案**：`auth.ts` 加 `export`、`im.ts` 复用同一真源建 provider。

---

## 0. 口径：L1 / L2 分开报

| 级别 | 本卡对应 |
|---|---|
| **L2-真跑通** | 三态行数实测：走**生产代码路径** `runWithContext → getCurrentFilterClause → KnowledgeStore.search → matchFilter`，打**真实 SQLite 快照** |
| **L1-静态可达** | `src/routes/im.ts` 确实把 `authProvider` 传进 `runWithContext` —— 由 diff 审阅确认，**不由本夹具证明** |

⚠️ **不宣称「端到端跑了 HTTP 路由」**：仓内无 supertest，且 `handleInboundMessage` 会拉起完整入站管线（需 DB/LLM）。
本卡以「**真实规则 + 真实过滤器 + 真实语料**」的三态实测替代，**该差别如实登记**（见 §7）。

---

## 1. 卡面前提被证伪（D947 遗留）→ 改口径

| 原卡面主张 | 实测 | 判 |
|---|---|---|
| 「`src/services/request-context.ts:41`」是问题点 | `:41` 是取值器 `getCurrentAuthProvider()`；**fail-closed 已在 `:75-85` 落地**（无 user 或 无 authProvider ⇒ `RBAC_DENIED` + `log.warn` + DENY_ALL 非空条件集） | ❌ 证伪 |
| 「无 user/无 authProvider → 返回不匹配任何行的条件」**待实现** | **已实现**，且 `getCurrentFilterClause` 有 **6 个调用点**（`l3/knowledge-agent.ts:69,113,204` / `l1/qa-router.ts:84` / `routes/knowledge.ts:35` / `routes/documents.ts:91,120`） | ❌ 证伪 |
| 剩余面 | `src/routes/im.ts:53` 的 `runWithContext` **确未传 `authProvider`** ⇒ 已认证飞书用户也走 deny-all ⇒ **过度拒绝（可用性缺陷）** | ✅ 成立 |

溯源：上述 fail-closed 属 **D947**（commit `2ea4df105`，经 **PR #896** 合入）⇒ **`16a4bdaba` 就是我们的基线**。

---

## 2. L2 实测（三态，原始输出）

> 🔴 **§2 口径更正（D1154，2026-10-05 —— 必读，否则本节会被误读为「用户可见修复」）**
>
> 本节三态（0 / 10 / 0）是**进程内语义实测**（真实规则 + 真实过滤器 + 真实语料），
> **不等于用户可见修复**。本路径
> `POST /api/im/feishu/webhook` → `handleInboundMessage` → `generateAIReply`
> **当前不消费知识漏斗**，两条独立实测：
> - **静态可达性**（本轮复核）: `src/l1/im-inbound.ts` 与其链上模块
>   （`agent/conversation-engine.ts` · `orchestrator/session-manager.ts` ·
>   `agent/builtin-tools.ts` · `providers/index.ts`）对
>   `knowledge-agent` / `KnowledgeStore` / `getCurrentFilterClause` 合计 **0 命中**。
> - **运行时计数**（复核员实测）: 该链路 **0 次** `KnowledgeStore.search`。
>
> ⇒ 本次接线是**为将来消费方就绪的接线**，**不是用户可见修复**。
> **用户可见修复在 `POST /api/qa/ask`**（本 PR 同批交付），其实测三态另列于 **§9**。

- 语料：`data/synova.db` 的 **一致性快照**（`sqlite3 … ".backup /tmp/b0b/measure984.db"`，**非 cp**）；`knowledge_chunks` **1443 行**，`access_sensitivity` 全为 `normal`
- 会话身份：复刻 `im.ts:53` 的飞书 sender（`roles:['employee']`, `sensitivity:'normal'`）
- 查询：`增长`（CJK ⇒ LIKE 分支），`totalHits=20`

```
A 未装配（改造前 im.ts 写法）: conditions=1 results=0  filteredOut=20
    filter=[{"field":"__d947_no_authenticated_context","operator":"EQ","value":"__d947_deny_all__"}]
B 已装配（改造后 im.ts 写法）: conditions=1 results=10 filteredOut=0
    filter=[{"field":"access.sensitivity","operator":"IN","value":["normal"]}]
C 未认证（无 context）      : conditions=1 results=0  filteredOut=20
    （stderr 同时出现 code:"RBAC_DENIED" / reason:"no_request_context" / level=40）

allowedSensitivities('employee','normal') = ["normal"]
MEASURE_VERDICT=USABILITY_DEFECT_CONFIRMED   ← 改造前实测
```

**逐条对上产品线的对称判据**：装配前 **0 行** ✓ ／ 装配后 **>0 行（10）** ✓ ／ 未认证 **仍 0 行（安全不回归）** ✓
⇒ 按判据走**分支 1**：**装配 provider（可用性修复）**。

**排除「过滤器恒过」的可能**（否则「装配后 >0」毫无意义）：
`knowledge-store.ts:701-712` 的 `matchFilter` 用 `colMap` 把 `access.sensitivity` **正确映射**到列 `access_sensitivity`；
而 deny-all 的字段名 `__d947_no_authenticated_context` **不在 `colMap`** ⇒ `row[col]=undefined` ⇒ `IN […]` 恒 false ⇒ **恒 0 行**。两者都符合设计。

---

## 3. 改法（甲案：单一真源，不复制第二份规则）

| 文件 | 改动 | 行数 |
|---|---|---|
| `src/middleware/auth.ts` | `function allowedSensitivities` → **`export function allowedSensitivities`** + 契约注释补「本卡导出的理由」 | +5 / -1（**零逻辑改动**） |
| `src/routes/im.ts` | import 真源 + `runWithContext` 增传 `authProvider`（由认证身份派生 `access.sensitivity IN allowedSensitivities(role, clearance)`） | +18 / -1 |

**为何不复制（乙/丙案）**：会让**同一安全规则出现第二份副本** ⇒ 漂移风险。本仓「唯一漏斗」注释反复警告的正是这类病根；
本轮在治的 #978/N3「四个体系互不相认」是同一病。**安全规则尤其不能有第二份。**

**为何不用 `packages/engine-auth/rbac.ts:108 createRBACProvider`**：它要 `resolveUser(token)`，而**飞书入站没有 token**（身份由 `senderId` 现建）；
且其规则方言是 `level IN(…) + teamId`，与 `auth.ts` 的 `access.sensitivity IN(…)` **不同族** ⇒ 硬用 = **再造一套不相认的体系**。

---

## 4. 判据：改坏即红（夹具**自证有效**，不红即 FATAL）

夹具 = `/tmp/b0b/measure_984b.ts`（不入仓）：三态断言 `A==0 ∧ B>0 ∧ C==0`。
三组夹具全部 **①改坏 → ②必红 → ③字节还原 → ④回绿**：

```
══════ 基线（应绿） ══════
$ 正常模式
MODE=(正常)
A 未装配          : conditions=1 results=0 filteredOut=20
B 已装配          : conditions=1 results=10 filteredOut=0
C 未认证          : conditions=1 results=0 filteredOut=20
allowedSensitivities('employee','normal') = ["normal"]
VERDICT=PASS
== 基线: 退出码 0 ✓

══════ 夹具 A：不传 authProvider（= 改造前形态） ══════
── ① 改坏（harness 走 --no-provider，等价于 im.ts 未装配） ──
── ② 必红 ──
MODE=--no-provider
A 未装配          : conditions=1 results=0 filteredOut=20
B 已装配          : conditions=1 results=0 filteredOut=20
C 未认证          : conditions=1 results=0 filteredOut=20
allowedSensitivities('employee','normal') = ["normal"]
VERDICT=FAIL
== 夹具A 必红（装配前应 0 行）: 退出码 1 ✓
── ③ 恢复（回正常模式） ──
── ④ 回绿 ──
MODE=(正常)
A 未装配          : conditions=1 results=0 filteredOut=20
B 已装配          : conditions=1 results=10 filteredOut=0
C 未认证          : conditions=1 results=0 filteredOut=20
allowedSensitivities('employee','normal') = ["normal"]
VERDICT=PASS
== 夹具A 回绿: 退出码 0 ✓

══════ 夹具 B：provider 用错字段名（证明断言盯的是真过滤器，不是恒过） ══════
── ① 改坏（access.sensitivity → access.nonexistent） ──
── ② 必红 ──
MODE=--wrong-field
A 未装配          : conditions=1 results=0 filteredOut=20
B 已装配          : conditions=1 results=0 filteredOut=20
C 未认证          : conditions=1 results=0 filteredOut=20
allowedSensitivities('employee','normal') = ["normal"]
VERDICT=FAIL
== 夹具B 必红（字段错应 0 行）: 退出码 1 ✓
── ③ 恢复 ──
── ④ 回绿 ──
MODE=(正常)
A 未装配          : conditions=1 results=0 filteredOut=20
B 已装配          : conditions=1 results=10 filteredOut=0
C 未认证          : conditions=1 results=0 filteredOut=20
allowedSensitivities('employee','normal') = ["normal"]
VERDICT=PASS
== 夹具B 回绿: 退出码 0 ✓

══════ 夹具 C：撤掉 auth.ts 的 export（单一真源断链 ⇒ 编译期即红） ══════
── ① 改坏：export function allowedSensitivities → function allowedSensitivities ──
  已撤掉 export
── ② 必红（import 失败） ──

== 夹具C 必红（import allowedSensitivities 应失败）: 退出码 1 ✓
── ③ 恢复 ──
BYTE_IDENTICAL=yes
── ④ 回绿 ──
MODE=(正常)
A 未装配          : conditions=1 results=0 filteredOut=20
B 已装配          : conditions=1 results=10 filteredOut=0
C 未认证          : conditions=1 results=0 filteredOut=20
allowedSensitivities('employee','normal') = ["normal"]
VERDICT=PASS
== 夹具C 回绿: 退出码 0 ✓

══════ 终态洁净度 ══════
改动文件数=2（应 2）
im.ts 未被夹具污染 ✓
```

| 夹具 | ① 改坏动作 | ② 必红 | ③ 恢复 | ④ 回绿 |
|---|---|---|---|---|
| A | 不传 `authProvider`（= 改造前形态） | `B results=0` ⇒ `VERDICT=FAIL` exit 1 | 回正常模式 | `VERDICT=PASS` exit 0 |
| B | provider 用错字段名 `access.nonexistent`（**证明断言盯的是真过滤器，不是恒过**） | `B results=0` ⇒ exit 1 | 回正常模式 | exit 0 |
| C | 撤掉 `auth.ts` 的 `export`（**单一真源断链**） | import 失败 ⇒ exit 1 | 字节还原 `BYTE_IDENTICAL=yes` | exit 0 |

---

## 5. 类型安全：`tsc --noEmit` A/B

```
origin/main（纯净基线）: 31 条错误
本分支（含改动）        : 31 条错误
grep -nE "src/routes/im\.ts|src/middleware/auth\.ts" tsc 输出 ⇒ 零命中
```
⇒ **零新增错误**，本次改动不牵连任何消费者。（31 条存量错误分布在 `extensions/sentinels/_extinct/**`、`src/server.ts`、`src/connectors/ima.ts`，**不在本卡写集**。）

---

## 6. 📌 登记：`pre-commit-check.sh` 架构层字段 ≥3 字符门禁（产品线要求写入本证据件）

**事实**：`scripts/pre-commit-check.sh:870-877` 用 `brief_parser.py --layer` 取值后执行 `tr -d "[:space:]"`，
再判 `[ ${#LAYER_FILLED} -lt 3 ]` ⇒ **长度 <3 即判「架构层: 未填写」并硬阻断**。
**⇒ 写 `## 架构层:` / `L4`（2 字符）必被误判未填写。** 本卡实测：2026-10-04 我以 `L4` 提交被组 6/13 阻断，
改为 `L4（本体层 — …）` 后通过。CLAUDE.md/AGENTS.md 的 V4.2.7 changelog **自称已修**（「层字段检查修复：L3 过短(2字符)导致 6 核心字段误阻断」），**实测未修**。
**本文写在此处的原因**：否则后来者不知道 `## 架构层: L4` 为什么不能写。**门禁本体属 `scripts/**`（治理线域），本卡不动** —— 已按产品线裁决立卡报治理线。

---

## 7. #984 未完成 / 不宣称

- ⚠️ **未端到端跑 HTTP 路由**（无 supertest；`handleInboundMessage` 会拉起完整入站管线）。三态实测替代，差别见 §0。
- ⚠️ **`im.ts` 的接线属 L1（diff 审阅），非 L2** —— 夹具不证明「路由真的传了 provider」，只证明「传了 provider 的语义产出 10 行、不传产出 0 行」。
- ⚠️ **`auth.ts` 的 `export` 使该函数成为包外可见** ⇒ 潜在消费者面变大。本卡只加关键字，**未改任何逻辑**（产品线护栏）。
- ⚠️ 存量 31 条 `tsc` 错误**未修**（不在写集）。

---

## 8. 交付指针

| 项 | 值 |
|---|---|
| 分支 | `fix/batch0b-984-im-provider` |
| 写集 | `src/middleware/auth.ts` ｜ `src/routes/im.ts` ｜ 本证据件 |
| 判据脚本（不入仓） | `/tmp/b0b/measure_984b.ts` · `/tmp/b0b/fixtures_984.sh` · `/tmp/b0b/measure_984.ts`（改造前基线） |
| 数据快照 | `/tmp/b0b/measure984.db`（`sqlite3 .backup`；**未动仓库 DB**） |
| 定位 | **自验结论 / 可提请独立审计**；**【通过】归 K3 终审** |

---

## 2b. 🔴 接线面 L2（补测，产品线判例 10：「判据必须同时钉死【入口】」）

**为什么必须补**：本卡**全部目的就是接线**（让 `im.ts` 把 `authProvider` 传进 `runWithContext`）。
§2 的 0/10/0 证的是**语义**（"传了 provider 会怎样"），**不证明"路由真的传了"**。⇒ 原稿把接线面标为 L1 是**自我降级**，产品线据此裁定补测。

**做法（用仓内既有范式，不引 supertest）**：`tests/routes/im-authprovider.test.ts`
—— 真 `express()` + `app.listen(0)` + `http.request` POST `/api/im/feishu/webhook`（参 `tests/middleware/auth.integration.test.ts` 范式），
用 **`vi.mock` + `importOriginal` 的透明包装**记录路由**实际**传给 `runWithContext` 的 ctx（保留真实现、不改语义、不 mock 业务管线 —— 铁律 12）。
DB 隔离：`SYNOVA_DB_PATH` 指向 `mkdtemp` 临时库，**不触碰仓库 `data/synova.db`**。

**三条断言**（真 HTTP 入口）：
1. 已认证飞书入站 ⇒ HTTP 200 且路由实际传入的 ctx **含 `authProvider`**，且该 provider **可用**：
   `getPermissionFilter(user,'KnowledgeChunk','read')` ⇒ `conditions[0].field='access.sensitivity'` / `operator='IN'` / `value=['normal']`（= 真源 `allowedSensitivities` 的产出）
2. 把路由用过的 **同一 ctx** 重进真漏斗 `getCurrentFilterClause` ⇒ 得到 `access.sensitivity` 条件，**不是 deny-all**
3. 未认证（无 context）⇒ 真漏斗返回 **deny-all 非空条件集**（`__d947_no_authenticated_context` / `__d947_deny_all__`）⇒ **安全不回归**

**改坏即红（自证有效，不红即 FATAL）**：

```
══════ 基线（应绿） ══════
 ✓ tests/routes/im-authprovider.test.ts (3 tests) 33ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
  退出码=0

══════ 夹具 A：撤掉 im.ts 的 authProvider（= 改造前形态 ⇒ 接线判据必红） ══════
  已移除 authProvider 块
── ② 必红 ──
     × 已认证飞书入站：路由实际传入的 ctx 带**可用的** authProvider 27ms
     × 把路由用过的 ctx 重进真漏斗：得到 sensitivity 条件，而非 deny-all 2ms
 FAIL  tests/routes/im-authprovider.test.ts > #984 接线面（真 HTTP 入口 → 真 runWithContext） > 已认证飞书入站：路由实际传入的 ctx 带**可用的** authProvider
 FAIL  tests/routes/im-authprovider.test.ts > #984 接线面（真 HTTP 入口 → 真 runWithContext） > 把路由用过的 ctx 重进真漏斗：得到 sensitivity 条件，而非 deny-all
 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
  退出码=1
── ③ 恢复 ──
  BYTE_IDENTICAL=yes
── ④ 回绿 ──
 ✓ tests/routes/im-authprovider.test.ts (3 tests) 33ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
  退出码=0 ✓

══════ 夹具 B：provider 返回空条件集（有 provider 但不可用必红） ══════
  已改为空条件集
── ② 必红 ──
     × 已认证飞书入站：路由实际传入的 ctx 带**可用的** authProvider 26ms
     × 把路由用过的 ctx 重进真漏斗：得到 sensitivity 条件，而非 deny-all 0ms
 FAIL  tests/routes/im-authprovider.test.ts > #984 接线面（真 HTTP 入口 → 真 runWithContext） > 已认证飞书入站：路由实际传入的 ctx 带**可用的** authProvider
 FAIL  tests/routes/im-authprovider.test.ts > #984 接线面（真 HTTP 入口 → 真 runWithContext） > 把路由用过的 ctx 重进真漏斗：得到 sensitivity 条件，而非 deny-all
 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
  退出码=1
── ③ 恢复 ──
  BYTE_IDENTICAL=yes
── ④ 回绿 ──
 ✓ tests/routes/im-authprovider.test.ts (3 tests) 33ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
  退出码=0 ✓

── 终态 ──
改动文件数=1
```

| 夹具 | ① 改坏动作 | ② 必红 | ③ 恢复 | ④ 回绿 |
|---|---|---|---|---|
| A | 撤掉 `im.ts` 的 `authProvider` 块（= 改造前形态） | `2 failed \| 1 passed` exit 1 | 字节还原 `BYTE_IDENTICAL=yes` | `3 passed` exit 0 |
| B | provider 改为返回**空条件集**（"有 provider 但不可用"） | `2 failed \| 1 passed` exit 1 | 字节还原 `BYTE_IDENTICAL=yes` | `3 passed` exit 0 |

**口径（不合并成一句「L2」）**：
- **语义面 = L2**（§2：真实语料 1443 行，装配前 0 / 装配后 10 / 未认证 0）
- **接线面 = L2**（本节：真 express + 真 HTTP + 真路由，3 条断言 + 2 组改坏即红）

---

## 9. D1154 — `POST /api/qa/ask` 接线（#984 的**用户可见面**）

> 卡：D1154｜执行：k1-exec｜日期：2026-10-05｜分支：`fix/batch0b-984-im-provider`
> 写集：`src/routes/im.ts` · `tests/routes/im-authprovider.test.ts` · 本证据件
> 工位：`.synova-wt-batch0b-t6`（基线 `11d2e4531`，开工前已 `git merge origin/main`）

### 9.1 卡面前提的**部分更正**（我实测，逐条带证据）

| 卡面主张 | 实测 | 判 |
|---|---|---|
| `qa-router.ts:84` 调 `getCurrentFilterClause` 但路由无 `runWithContext` 包裹 ⇒ **已认证调用方拿到 0 条** | **合法 JWT + 非白名单路径下不成立**：`jwtAuthMiddleware` **自己**会调 `runWithContext`（`auth.ts:424`，以验签身份建上下文，且 `next()` 在该 ALS 上下文内执行）⇒ 下游**已有**可用 authProvider。<br>实测：**撤掉本路由的包裹**后，带真 JWT 请求 `/api/qa/ask` 仍得 **4 条 / degraded=false**（改坏实验第 1 轮：10 用例**全绿**）。 | ❌ 该路径不成立 |
| 同上 | **DevMode 自动 admin 分支下成立**：`auth.ts:350-365` 注入 `req.auth = dev-admin` 后**直接 `return next()` —— 不建上下文** ⇒ 下游无上下文 ⇒ 漏斗落 deny-all ⇒ **已认证却 0 条**。<br>实测：该形态下撤掉包裹 ⇒ `knowledgeSources=0` + `degraded=true`；装上 ⇒ `5 条` + `degraded=false`。 | ✅ 成立 |

**结论**：收益成立，但**成因不是「路由完全没包装」**，而是
**「注入 `req.auth` 的三条路径里只有一条建了上下文」**（验签成功 ✓ / 白名单带 Bearer ✓ /
DevMode 自动 admin ✗ —— 见 `auth.ts:323-346` · `:350-365` · `:419-465`）。
路由自建上下文的价值 = **不依赖中间件走哪条分支**，凡有验签身份即保证漏斗可用。

### 9.2 改法（最小、同型）

`src/routes/im.ts` 的 `/api/qa/ask` handler：`answerQuestion(...)` 用 `runWithContext` 包裹。
- `user` 取自**验签**结果（`extractAuthFromRequest(req)`，唯一可信来源 `req.auth`）；
  **不读 body 的 `userId` 作身份**（无验签身份时保留原 body 回退，行为不变式）。
- `authProvider.getPermissionFilter` 复用**同一真源** `allowedSensitivities`（#1011 已导出）。
- 🔴 `req.auth` 不存在 ⇒ **不建立**请求级上下文（等价「不传 `authProvider`」）
  ⇒ 保持 deny-all，**不新增 401/403 门槛**（`tests/l1/qa-router.test.ts` 的行为不变式）。

### 9.3 判据（原始输出）

- 语料夹具：**单条 `db.exec()` 批量 INSERT** 5 行（4 `normal` + 1 `restricted`），
  查询词 `现金流`（CJK ⇒ LIKE 分支）。
  ⚠️ **不用** `KnowledgeStore.insert()` —— node v24 + better-sqlite3 下会留 `Statement` 垃圾，
  GC 撞上动态 import 链会 **abort（exit 134）**（复核员实测，我独立复现于 §9.5）。
- DB 隔离：`SYNOVA_DB_PATH` → `mkdtemp` 临时库（**不触碰仓库 `data/synova.db`**）。
- 身份：真 `signJwtToken()` + 真 `jwtAuthMiddleware`（`/api/qa/ask` 不在白名单 ⇒ 必须带真 JWT）。

```
$ node_modules/.bin/vitest run tests/routes/im-authprovider.test.ts
 ✓ tests/routes/im-authprovider.test.ts (10 tests) 56ms
 Test Files  1 passed (1)
      Tests  10 passed (10)          退出码=0
```

5 条新增用例（D1154 段）覆盖：① 合法 JWT ⇒ 路由**自建** ctx（计数恰 2：中间件 1 + 路由 1）
② 同一 ctx 重进真漏斗 ⇒ `access.sensitivity IN ['normal']`（非 deny-all）
③ 用户可见产出：`knowledgeSources=4` / `degraded=false` / restricted 被过滤 / 无「未找到」话术
④ **DevMode 形态**（`req.auth` 在、中间件不建上下文）⇒ 路由自建 ⇒ 5 条（admin 含 restricted）
⑤ 未认证 ⇒ **200**（非 401/403）+ 0 条 + `degraded=true` + **未建立**上下文
＋ 补偿判据：已认证 + 语料无匹配 ⇒ 仍 0 条 + `degraded=true`（= `qa-router.test.ts:96-106` 的语义，见 §9.5）

### 9.4 🔴 判据失效教训（**必须登记**：第一版判据是假绿）

**事实**：第一版新增用例只断言「`H.seen` 里最后一个 ctx 带可用 `authProvider`」。
**改坏实验（撤掉 `runWithContext` 包裹）⇒ 10 用例全绿** —— 判据**完全没有分辨力**。
**成因**：合法 JWT 路径下 `jwtAuthMiddleware` 已把 ctx 放进 `H.seen`（`auth.ts:424`），
该 ctx 的 provider 与路由自建的在结构上等价 ⇒ 断言无法区分「谁建的」。

**修法（两条，均已落地）**：
1. **计数判据**：`expect(H.seen.length).toBe(2)`（中间件 1 + 路由 1；撤包裹即降为 1）。
2. **形态判据（不可替代）**：DevMode 分支形态下断言 `H.seen.length === 1`
   —— 该形态里中间件**不**建上下文，故这 1 次**只能**来自路由。

**修后改坏即红（原始输出）**：

```
$ # 撤掉 /api/qa/ask 的 runWithContext 包裹
⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯
 FAIL  D1154 · #984 可观测面 > 已认证：路由实际传入的 ctx 带**可用的** authProvider（非 deny-all）
AssertionError: expected 1 to be 2 // Object.is equality
 FAIL  D1154 · #984 可观测面 > 🔴 判别性本体 · req.auth 存在但**中间件未建上下文**时，路由必须自建
AssertionError: expected +0 to be 1 // Object.is equality
      Tests  2 failed | 8 passed (10)     退出码=1

$ # 按 /tmp 备份字节还原
shasum -a 256 src/routes/im.ts → 6ab145ef87aba4c83ee2b56ce9220ff4abdb1c6561bca76fd03cef3b35110e52（前后一致）
$ node_modules/.bin/vitest run tests/routes/im-authprovider.test.ts
      Tests  10 passed (10)               退出码=0
```

**诚实边界**：改坏态仍有 **8/10 绿** —— 除上述 2 条外，其余用例（含 ③ 用户可见产出）
**在撤掉本路由包裹时依然通过**（被中间件那次 ctx 满足）。
⇒ 本 PR 的 D1154 判据中，**只有 2 条具备改前/改后分辨力**，已在用例命名与注释中标出，**不宣称 10 条都具分辨力**。

### 9.5 ⚠️ `tests/l1/qa-router.test.ts` 在本环境**预存崩溃**（与本卡无关，登记）

```
$ node_modules/.bin/vitest run tests/l1/qa-router.test.ts
/Users/wane/.nvm/versions/node/v24.19.0/bin/node[…]: void node::RemoveEnvironmentCleanupHook(Isolate *, CleanupHook, void *) at ../src/api/hooks.cc:142
  #  Assertion failed: (env) != nullptr
 4: 0x… Statement::~Statement() [better_sqlite3.node]
…
Error: [vitest-pool]: Worker forks emitted error.   →  Worker exited unexpectedly
退出码=1（换 --pool=threads 同样 exit 134）
```

**定位为本卡无关（受控实验）**：把 `src/routes/im.ts` **还原为 HEAD**（撤掉本卡全部改动）后
复跑 **2 次，2/2 同样 abort**（同一断言行、同一 native 栈）。
**成因（与复核员实测一致）**：该文件 `beforeAll` 用 `KnowledgeStore.insert()`
（`qa-router.test.ts:26,28`）造夹具 ⇒ 留 `Statement` 垃圾 ⇒ GC 终结器撞上 node 24 的
`RemoveEnvironmentCleanupHook` 断言。崩溃发生在 `createServer()` 引导期（**早于任何断言**），
故该文件在本环境**跑不到断言**。
**登记**：修复属该测试夹具 + `scripts/**` 之外的环境问题，**不在本卡写集**（未改该文件）。
**补偿**：其锁定的行为不变式（无匹配知识 ⇒ `degraded=true` / 0 条；未认证 ⇒ 不新增 401/403）
已由 §9.3 用例 ⑤ 与补偿判据在**真 HTTP + 可跑环境**中复现。

### 9.6 类型安全与终态

```
npx tsc --noEmit：本卡改动前 28 个 error site / 改动后 28 个 —— 逐条 diff 为空（零新增，EXIT=2 为既有红）
写集终态（工作树 vs 开工前 merge 提交 8c034ef95）：仅 src/routes/im.ts · tests/routes/im-authprovider.test.ts · 本证据件
```

**未做 / 不宣称**：
- ⚠️ **不改** `src/l1/qa-router.ts` · `src/middleware/auth.ts` · `src/services/request-context.ts`（卡内硬约束）。
- ⚠️ **不改** `tests/l1/qa-router.test.ts` 的预存崩溃（§9.5，不在写集）。
- ⚠️ `git diff --stat origin/main` 会同时列出 **#1011 分支既有差异**（16 份 `docs/**` + `.claude/**` + `src/middleware/auth.ts`），
  非本卡引入 —— 我的改动以 `git diff 8c034ef95` 为准（仅 3 文件）。
- ⚠️ 未跑全量 vitest（由产品线跑）。


