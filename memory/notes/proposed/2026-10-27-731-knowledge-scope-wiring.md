# #731 生产消费链接线：`knowledge-scope.yaml` → 权限判定 → 知识过滤 真接线

- **状态**: proposed（待 L1 收件闸 ＋ K3 审计追认为 implemented）
- **日期**: 2026-10-27
- **批次**: P3-M7-前置缺口补齐（#825 重审版）· PR2／7 · 分支 `ct/p3m7-pr2`（基于 PR1 `884017800`）
- **依据**: 规格 `.handbook/派单件/2026-10-27-规格-825-M7前置缺口补齐.md` §2.1／§4.0 ｜
  dev doc `.handbook/派单件/2026-10-27-devdoc-825-M7生产消费链接线.md` §2.1／§2.5（d-kb/d-perm/d-v4/d-refresh/d-deny/d-seed）／§4.1／Known Limitations 3,4,5,7

## 一、决策（本卡改了什么）

| 层 | 件 | 决策 |
|---|---|---|
| T1 | `src/init/preset-loader.ts` | 六件装载从「只判存在且非空」升级为**解析 `knowledge-scope.yaml` 内容＋校验**；新增 `resolveRoleKnowledgeScope()`（请求路径用，**mtime/size 指纹缓存**，d-refresh）；`loadRolePacks()` 对外形状不变（`RolePack` 只**增** `knowledgeScope` 字段） |
| T2 | `packages/engine-auth/src/permission-grants.ts` | `KNOWLEDGE_SCOPES` 从「运行期唯一真源」降为**编译期基线**；新增 `getKnowledgeScopes()`（扫 `roles/*/knowledge-scope.yaml` 的 `scopes[].id` **前缀**，缓存键含 mtime+size）；`isPermissionId` 白名单 = 基线 ∪ 文件派生 ⇒ **加内容文件即可授新命名空间** |
| T2 | 同上 | **d-perm 语义修正**：命名空间收缩为 yaml 背书集 `{finance, people, market}`，`hr`/`sales` 自然消失（`knowledge.hr.read` / `knowledge.sales.read` ⇒ 未知名 ⇒ 丢弃＋点名，不提权） |
| T3 | `src/middleware/auth.ts` | 内联 provider 的 `conditions` **追加** scope 维：`{pkb_domain IN <scopes[].id 去重排序>}` ＋ 每个 `deny[].id` 一条 `{pkb_domain NOT_EQ id}`；`access.sensitivity` 恒在**第 0 位**（K12-11 不回退）；内容坏 ⇒ 拒绝型 `{pkb_domain IN []}`（fail-closed） |
| 判据 | `tests/extensions/knowledge-scope-wiring.test.ts` | 新建 16 例：结构／行为／可对账／deny 两段式／三态降级／改坏必红 |
| 迁移 | `tests/security/permission-grants.test.ts` | **写集例外（L1 裁 B）**：夹具 `knowledge.hr.read`→`knowledge.people.read`、`knowledge.sales.read`→`knowledge.market.read`；「未知项丢弃/不静默提权」断言语义**逐条保留、未放宽** |

## 二、理由（为什么必须这样接）

1. **病灶 = declared-only**：三件岗位 `knowledge-scope.yaml` 早在树、D5 探针也跑过，但
   `git grep` 实测**内容读者 = 0**（4 命中＝注释 1＋存在性字符串 1＋建档写侧 2）。数据在、探针绿、
   生产不消费 —— 只有把内容接进**真中间件 → 真 provider → 真 `matchFilter`** 才算治。
2. **为什么 scope 维是"追加"而不是"替换"**：既有 `access.sensitivity` 条件是 K12-11 项模型的产出，
   替换＝该面回退（D947 唯一漏斗语义丢失）。故 `conditions[0]` 恒为 sensitivity，
   scope 维只能追加 ⇒ 数组长度只增不减。
3. **为什么命名空间要收缩**（d-perm）：`hr`/`sales` 两个裸域**无任何 yaml 背书**（hr 岗用 `people.*`、
   sales 岗用 `market.*`）。留着它们＝第二口径（硬编码 vs 内容文件），正是 declared-only 的温床。
   收缩撞到写集外的既有判据（3 处夹具硬依赖 `knowledge.hr.read`/`knowledge.sales.read` 合法）
   ⇒ 上报 L1；**L1 裁定「裁 B」** 特批扩写集 +2 件测试、只改夹具不改产品行为 ⇒ 按原口径收缩。
4. **为什么缓存键是 mtime+size**（d-refresh）：D5 的 V3 判据是「**一个服务寿命内**改内容文件 ⇒ 结果
   变」。任何进程级常量都会让 V3 假绿。mtime 单独不够（同毫秒内可能只变大小），故 `mtimeMs:size` 双键。
5. **为什么 deny 要逐 id 展开**：`matchFilter` 只实现 `IN`/`EQ`/`NOT_EQ`，**没有 `NOT_IN`**
   ⇒ 多个 deny 只能多条 `NOT_EQ`。

## 三、判据点（先红后绿成对 ＋ 三反例；命令原文＋原始输出）

同一命令：`node node_modules/.bin/tsx scripts/control-tower/probe-knowledge-scope.ts --base-url <url> --roles finance,hr --presets-root <临时内容根>`

| 时点 | 树 | 原始输出 | REAL_EXIT |
|---|---|---|---|
| **先红** | PR1 树 `884017800`（探针改靶完成、接线未做） | `[finance] 真 provider conditions = [{"field":"access.sensitivity","operator":"IN","value":["normal"]}]`／`declared-only 判定: 条件集内无 pkb_domain 维 ⇒ 生产链未消费 knowledge-scope.yaml（接线未做）`／`RESULT=NOT_IMPLEMENTED`／`COVERAGE: NOT_IMPLEMENTED=8` | **2** |
| **后绿** | 本卡树 `ct/p3m7-pr2` | `[finance] … {"field":"pkb_domain","operator":"IN","value":["finance.capital","finance.cost","finance.statements"]} …`／`✅ 生产链已消费 scopes：条件集出现 pkb_domain 维（declared-only 已消除）`／`RESULT=PASS`／`COVERAGE: PASS=18` | **0** |

绿跑里同一次 V1–V6 全穿生产链：
`V1 派生岗位集=[finance, hr, sales]`（集合相等）｜`V2 两岗位同 query 结果集不同（finance=3 条｜hr=3 条）`｜
`V3 行为跟着内容文件走: finance 少了 1 条，且消失项 source_id 正属被去掉的 scope「finance.capital」` ＋
`V3 对照岗位 hr 结果集不变（3 条）` ＋ `git status --porcelain 改文件前后=0 条（仓库零写痕）`｜
`V4 同一事实可对账：source_id=probe-ks:shared 在两岗位结果中各出现一次且指向同一源行`｜
`V6(i) deny 派生排除条件齐备`｜`V6(ii) deny 有牙齿：「people.individual-compensation」同时被 scope IN 允许、被 deny NOT_EQ 排除 ⇒ 该条排除只能来自 deny（防恒真）`。

**三反例（改坏必红，每次改坏后还原）**

- **(a) 拔 `roles/finance/knowledge-scope.yaml`** ⇒ `原因: 实物岗位 scope 文件缺失 ⇒ 存在性闸判 exit 2`／`RESULT=NOT_IMPLEMENTED`／`COVERAGE: NOT_IMPLEMENTED=7` ⇒ **REAL_EXIT=2**（存在性闸有牙齿）
- **(b) `scopes` 改空（文件在）** ⇒ `❌ [finance] scopes[] 为空 ⇒ 该岗位知识面为空`／`RESULT=FAIL`／`COVERAGE: PASS=11 FAIL=2` ⇒ **REAL_EXIT=1**（内容级判据有牙齿）
- **(c) declared-only 回归（回滚 T3：只留文件、生产不读）** ⇒ 探针进程带 T3、服务用未接线树 ⇒
  `❌ 两岗位同 query 结果集相同（6 条）⇒ knowledge-scope 未在检索结果上生效` ＋
  `❌ V3 改 finance 的 scopes（去掉 finance.capital）后结果集**未变**（6 → 6）⇒ 生产链没读内容文件` ⇒
  **REAL_EXIT=1**。**V3 必红成立**（这一条是本批病灶的验收位）。

**回归（禁 `--changed`）**：`npx vitest run tests/extensions tests/presets tests/middleware tests/l4`
⇒ `Test Files 45 passed (45)`／`Tests 533 passed (533)`／numPending = 0；
另跑 `tests/security tests/init` ⇒ `22 files / 294 passed / 4 skipped`。

## 四、已知限制与前提失败（禁写"暂无"）

1. **🔴 生产写侧无法表达 scope（I-C8 勘误，dev doc §2.5 d-seed 前提失败）**：
   dev doc 的播种口径写的是「`insert()` 后 `update(id,{pkb_domain})`」——**实测写不进去**：
   `KnowledgeStore.update()` 的 UPDATE 列清单**不含** `pkb_domain`（`src/l4/knowledge-store.ts:279-296`），
   生产种子 `src/l3/pkb-seed.ts:266` 同被静默丢弃。⇒ 本卡播种改为「`insert()` 走生产写 API（拿真行）＋
   对**临时库同句柄**直写 `UPDATE knowledge_chunks SET pkb_domain=? WHERE id=?`（**仅此一列**）」；
   断言对象仍全在读侧生产链（真 provider → 真 `search` → 真 `matchFilter`）。
2. **🔴 接线后的预期后果：`pkb_domain` 全 NULL ⇒ finance/hr/sales 对现存语料检索为空**。
   规格 §3-E11 实测 1621/1621 全 null；`matchFilter` 的 `IN` 对 `null` 恒 false ⇒ 三个有 scope 文件的岗位
   **看不到任何现有语料**。这是 **fail-closed 的正确方向**（不是 bug），数据回填另立卡。
   **无 scope 文件的岗位**（admin/manager/employee/viewer/liaison/ga/未知角色）按 I-C4 不追加 scope 维 ⇒ **不受影响**。
   **不得**据此宣称「生产写入已按 scope 分类」或「知识已按 scope 可用」。
3. **🔴 自验抓到的真 fail-open（已修，本卡最重要的返工）**：原实现在「角色目录在、`knowledge-scope.yaml`
   被删/不可读/为空文档」时返回 `declared:false, degraded:false` ⇒ 调用点**不追加** scope 维 ⇒
   该岗位**可见全部语料**。这与 dev doc §4.2 边界值清单「文件缺失 ⇒ 装载 fail-loud」不一致，
   且与本批要杀的"因为读不到而不收"同族。**修法（窄修，不影响无目录角色）**：
   · **角色目录不存在**（admin/manager/employee/viewer/liaison/ga/未知）⇒ 保持 I-C4：不追加 ＋ `log.warn`
   · **角色目录在但文件缺失/不可读/空文档** ⇒ `degraded:true` ＋ `log.error(code=KNOWLEDGE_SCOPE_MISSING)`
     ⇒ 条件集退化为 `{pkb_domain IN []}` ⇒ **整岗一件都看不到**
   · **内容坏** ⇒ `log.error(code=KNOWLEDGE_SCOPE_INVALID)` ⇒ 同上
   判据同步改：原 `:469` 那条"删文件仍见 6/6"的用例**把 fail-open 写成了期望** ⇒ 已改为断言
   fail-closed（`IN []` ＋ 检索结果为空）；并新增两条分界用例（有目录缺文件 / 无目录）与
   一条空文档用例。
4. **deny 在现物三件里天然无操作差异**（deny id 与各自 scopes 无重叠）⇒ 只用「看不到 deny 域」断言必是**恒真式**。
   本卡按 d-deny 两段式：结构断言（NOT_EQ 逐 id 在）＋ 语义断言（临时内容根里把 deny 的 id **同时写进 scopes[]**
   ⇒ IN 允许、NOT_EQ 排除，且该 scope 下**确实播了语料却检索不到** ⇒ 排除只能来自 deny）。
5. **fail-closed 路径刻意只给最小拒绝型**（`{pkb_domain IN []}`，不附 deny 的 NOT_EQ）：`IN []` 对每一行恒 false，
   附加 NOT_EQ 是冗余；也因此该路径下探针的「V6(i) deny 条件齐备」会一并报缺失 —— 那是**已红场景**里的附加红，
   不构成越权面（没有任何行能穿过 `IN []`）。
6. **通配与"全库读"仍以编译期基线为界**（KL-T2-1）：`expandPermissionId('knowledge.*.read')` 与
   `sensitivityWhitelistFromGrants` 的「覆盖全部范围 ⇒ 视同全库读」必须同集，否则 admin 的全库读会因
   "分母含派生项"而静默失去 `restricted`。⇒ 文件新增命名空间可用**显式项**授予，但**不被通配覆盖**。
7. **`knowledge.hr.read` / `knowledge.sales.read` 迁移**：d-perm 后变未知名被丢弃（hr 仍持
   `knowledge.people.read` ⇒ 项模型对 hr 仍"发声"，不回落放宽）。外部客户包若引用这两个 id **需改**。
8. **本卡不覆盖 HTTP 层的独立判据**：真路由 `POST /api/knowledge/search` 的端到端由 D5 探针承担；
   `tests/extensions` 侧走「真中间件链 ＋ 真 `getCurrentFilterClause` ＋ 真 `KnowledgeStore.search`」。
9. **`scopes[]` 为空的 stub 文件不计**装载期**错**（KL-T1-1）：空文档/仅注释 = 「未声明」而不是「坏件」——
   否则装载面会与既有夹具（`tests/init/preset-loader.test.ts` 的 `writeRole()` 写 `# <role>/<piece>`）对撞。
   真正的「文件在但无 scope」由 D5 探针 V1（`scopes[] 为空 ⇒ 业务红 exit 1`）兜住（见反例 b）。

## 五、失效条件（这条判据何时可撤）

- `knowledge-scope-wiring.test.ts` 与 D5 探针的 V2/V3/V4/V6：**M9 出口验收**用更强判据接管后，降级为**回归锁**
  （保留 V5 判别力自检与 deny 两段式，**不得无人接管即删**）。
- `knowledge.hr.read` 迁移说明：权限宇宙归一（role-pack v2）落地后失效，届时以 v2 为准。
- KL-T2-1（通配不覆盖派生命名空间）：类型面改为运行期可达（或 `PermissionId` 允许开放命名空间）后失效。
- 本文第 2 条（现存语料检索为空）：`pkb_domain` 数据回填卡落地后失效 —— **届时须把该卡的真实回填输出补进本 note**。
