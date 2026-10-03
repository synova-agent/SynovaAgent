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
