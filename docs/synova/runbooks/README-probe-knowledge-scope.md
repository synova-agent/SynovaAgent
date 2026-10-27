# README · `probe-knowledge-scope.ts`（知识一致 D5 判据件）

> **本件是什么**：`scripts/control-tower/probe-knowledge-scope.ts` 的**使用说明 ＋ 实现地图**（README 骨架对齐
> DSH 代码标准：`Summary → Use → Understand the implementation → Known Limitations`）。
> **判据来源**：#713（D5 反例卡）／#731（知识一致生产链）／规格 §4.0／dev doc §2.1·§2.5·§4.0。
> **口径**：本件**只描述现状**，不重定义判据 —— 判据字面在 `probe-knowledge-scope.ts`（含 V1–V6 的期望文案、
> 目标件常量、三态退出码），**本件与代码冲突时以代码为准**；改判据须引 `#713`／`#731` 卡号并另走提案。

---

## Summary

一条话：**用真中间件链 ＋ 真 provider（结构面）与真路由 ＋ 真库对账（行为面）观测"生产链有没有真的消费岗位
知识范围"**，把结论落成机器可读的三态退出码。

- **被测对象**（靶）：`extensions/presets/roles/{finance,hr,sales}/knowledge-scope.yaml`（三个岗位的
  `scopes[]` / `deny[]` 声明）。
- **判据**（V1–V6）：V1 文件派生岗位集与每岗位 scopes 内容 ｜ V2 两岗位同一 query 结果集不同 ｜ V3 改临时内容根
  ⇒ 结果跟着变且仓库零写痕 ｜ V4 两岗位结果可回库按 `source_id` 对账 ｜ V5 判别力自检（探针自己把靶改坏 ⇒
  **自身必须转红**）｜ V6 `deny[]` 派生的排除条件有牙齿（防恒真式）。
- **当前状态**（#731 接线未做）：生产链**尚未**消费 scopes（真 provider 条件集里无 `pkb_domain` 维）⇒ 裸跑
  **恒 `exit 2`**（末行 `RESULT=NOT_IMPLEMENTED`）。这是**诚实的先红态**，不是故障：
  先红后绿要求"改靶完成而接线未动时仍红"，不许跳过红态直接绿。

---

## Use

### When to choose it

**选它**：

- 你要证明的是「**岗位知识范围真的改变了检索结果**」，而不是「配置文件存在／语法对」——本件断言的是**生产链行为**
  （真 `JwtAuth`＋`rbac`＋内联 provider 的条件集、真 `POST /api/knowledge/search`、真 `loadRolePacks()`）。
- 你要一条**能红**的判据：未接线时它 `exit 2`（而非造绿），接线做坏时它 `exit 1`（业务红），并且它**自己**被改坏时
  会通过 V5 自检转红。
- 你要改 `probe-knowledge-scope.ts`：先读本件的行为契约与边界，再动代码（改判据语义＝A 类）。

**不选它**：

- 只想校验 `knowledge-scope.yaml` 的**语法/字段** ⇒ 用 YAML 校验或别的静态检查（本件不做 schema 校验器）。
- 想跑**全部**探针 ⇒ 用 `probe-ladder` 的梯子入口（本件只是其中一个 `ProbeModule`；`--all` 由 ladder 编排）。
- 想验证**别的块**（哨兵/本体/工具治理…）⇒ 用对应 `probe-*`（本件只判知识一致数据面）。

### 最小可用命令

**裸跑（卡面判据命令；无参即跑唯一场景 `layering`）**：

```bash
node node_modules/.bin/tsx scripts/control-tower/probe-knowledge-scope.ts
```

- Node **22**（本仓实测 v22.23.2）；`tsx` 来自本仓 `node_modules`（V5 自检还要按 cwd 解析到它，见 Known Limitations）。
- 裸跑**只读**仓库实物内容根：不写库、不写仓库；输出在本进程 stdout。
- 现状预期：**`exit 2`** ＋ 末行 `RESULT=NOT_IMPLEMENTED`（先红态）。

**行为面（端到端，需你自备服务 ＋ 临时库）**：

```bash
# 前置（由调用方提供，探针不替生产起服务）：
#   ① 服务已起且 DEV_MODE=true（供真路由 /api/auth/register|login 签发凭据）
#   ② 临时库路径经 env 传入（播种与回库对账都落它；禁写 data/）
export SYNOVA_DB_PATH=/tmp/probe-ks-$$.db
export SYNOVA_PRESETS_ROOT=/tmp/probe-presets-$$        # 临时内容根（V3 在这里改文件；仓库零写痕）

node node_modules/.bin/tsx scripts/control-tower/probe-knowledge-scope.ts \
  --base-url http://127.0.0.1:18790 \
  --roles finance,hr \
  --presets-root "$SYNOVA_PRESETS_ROOT"
```

- `--base-url` 示例端口按你的服务实际端口填；`--roles` **至少两个岗位**（V2 需要对照），且只接受实物岗位集
  `finance`/`hr`/`sales`（越界即 `ARGS_INVALID` ⇒ `exit 2`，**不做隐式回落**）。
- `--case layering` 与 `--all` 兼容（场景解析仍走 `probe-ladder.parseProbeArgs` 唯一实现）。

### What success and failure look like

末行契约（机器只认这一行；`RESULT=` 之前一行是 `COVERAGE: ...` 覆盖说明，**含 UNVERIFIED 计数**）：

| 退出码 | 末行 | 含义 | 现状是否出现过 |
|---|---|---|---|
| `0` | `RESULT=PASS` | 全部 V 判据 PASS（**真绿**） | **从未**（绿态要等 #731 接线） |
| `1` | `RESULT=FAIL` | **业务红**：目标件在，但断言不成立（例如某岗位 `scopes[]` 为空、两岗位结果集相同、V5 自检转红） | V5-B 子进程内出现过（证明判据有牙齿） |
| `2` | `RESULT=NOT_IMPLEMENTED` | 未实现／未接线（declared-only）／**信号量==0**（岗位集派生为空）⇒ fail-closed | ✅ 当前裸跑就是这个 |
| `2` | `RESULT=ERROR` | **检查自身失败**（参数非法／环境不足／条件集观测不到／未预期异常）—— 同样不是绿 | 参数错时会 |

**成功长什么样**（#731 接线后首次可能出现的形态）：`COVERAGE: PASS=<n>` 且 `RESULT=PASS`、`exit 0`；
其中 V2/V3/V4/V6 是**第一次**真正被执行（现在它们只以 `⚠️ 未实现` 出现）。

**失败长什么样**（现状：裸跑 stdout 末两行原文如下，进程退出码 `2`）：

```
COVERAGE: PASS=7 NOT_IMPLEMENTED=4 UNVERIFIED=4
RESULT=NOT_IMPLEMENTED
```

⚠️ **`exit 2` 不是"失败"也不是"通过"**，它是「判不了／检查自身失败」—— CI 或调用方**不得把 2 当绿**
（详见 Known Limitations 第 3 条）。

---

## Understand the implementation

### Design philosophy

**一个分离 ＋ 三条承诺**：把"生产链是否消费了岗位知识范围"的**判定**从探针里分离出来（探针**只观测、不接线**），
并承诺三件事 —— ① **未实现必 `exit 2`**（fail-closed，"看不见"绝不当"没问题"）；② **绿必须来自真链**（真中间件＋
真 provider＋真路由＋真 loader，全程无替身/无读源码猜）；③ **自己也得能被改坏**（V5 用子进程真实退出码证明
"把靶改坏 ⇒ 自身转红"）。

### Source map

`File → Role`（本件依赖的真实件；判据不复制它们的逻辑，只观测它们已经做过的事）：

| File | Role |
|---|---|
| `scripts/control-tower/probe-knowledge-scope.ts` | **判据本体**：V1–V6 断言、`TARGETS`/`GATE_TARGETS`/`INFORMATIONAL` 常量、播种与回库对账、V5 自检、`main()` 三态退出码签发 |
| `scripts/control-tower/probe-ladder.ts` | **探针骨架（复用，不重写）**：`ProbeOutput`（`RESULT=` 末行唯一签发点 ＋ verdict→退出码唯一映射）、`parseProbeArgs`、`assertTargetsExist`、`locateRepoRoot`、`ProbeError`（`code`/`phase`/`retryable`） |
| `extensions/presets/roles/{finance,hr,sales}/knowledge-scope.yaml` | **判据靶**：岗位知识范围声明（`scopes[]`／`deny[]`）—— 存在性闸与 V1/V6 的真源 |
| `src/init/preset-loader.ts` | **真 loader**：`loadRolePacks()` —— V1「文件派生岗位集」的唯一来源（探针不自带第二套派生） |
| `src/routes/knowledge.ts` | **真路由**：`POST /api/knowledge/search` —— 行为面断言入口（探针不复制其逻辑） |
| `src/middleware/auth.ts` | **真中间件链第 1 段**：`jwtAuthMiddleware` ／结构面凭据 `signJwtToken` |
| `src/middleware/rbac.ts` | **真中间件链第 2 段**：`rbacMiddleware` |
| `src/services/request-context.ts` | **真 provider**：`getCurrentFilterClause('KnowledgeChunk')` —— 结构面观测「生产链是否消费 scopes」的唯一接口（不是读源码猜） |
| `src/l4/knowledge-store.ts` | **生产 store**：读侧 `search`／写侧 `insert`；`pkb_domain` 写侧缺口见 KL-1（播种时由探针在同一库句柄上补写该列，且已显式打印） |
| `packages/engine-auth/src/permission-grants.ts` | **权限命名空间真源**：`KNOWLEDGE_SCOPES`（d-perm 判据；探针不另抄名单） |
| `tests/control-tower/probe-contract.test.sh` | **配对元测试**：断探针 stdout 末行 `RESULT=` 与三态退出码契约（该文件头注自述"不被任何门禁自动执行"，属**可手动复跑**的验收件） |
| `docs/authority/DOCS-REGISTRY.yaml` | 台账登记（本 README ＝ `DOC-0307`；D2 登记门禁的机械要求） |

### 两段式观测（怎么做到的）

1. **结构面**（进程内，裸跑即跑）：起一个只挂**真中间件链**的 express app（`jwtAuthMiddleware` → `rbacMiddleware`
   → 内联 provider），发一次真请求，用生产函数 `getCurrentFilterClause('KnowledgeChunk')` 取**真 provider 返回的
   条件集**。条件集里没有 `pkb_domain` 维 ⇒ 判定「生产链未消费 scopes（declared-only）」⇒ V2/V3/V4/V6 一律 `exit 2`。
   同时守卫 K12-11 不回退：既有 `access.sensitivity` 条件必须仍在条件集**第 0 位**（scope 维只能追加）。
2. **行为面**（须 `--base-url` ＋ 临时库）：播种（生产 `KnowledgeStore.insert`；`pkb_domain` 的直写见 KL-1）→ 经
   **真路由**注册/登录取凭据（禁自造 JWT）→ 两岗位同 query 检索 → 回临时库按 `id` 反查 `source_id` 对账。
   改文件那一步只动 `--presets-root` 指向的**临时内容根**，随后用 `git status --porcelain` 证明仓库零写痕。

---

## Known Limitations

> 探针头注里有完整清单 **KL-1…KL-6**（写侧 `pkb_domain` 缺口／dev 自签 secret／dev 最小语料／`--roles` 不隐式回落／
> V5 子进程依赖 tsx／FTS 触发器使 `DELETE` 不可用）。本节只列**使用与判读**上最容易误读的三条（必读）：

1. **declared-only 先红态 = 当前唯一状态。** 生产链尚未消费 `scopes`（真 provider 条件集无 `pkb_domain` 维），
   故裸跑**恒 `exit 2`**；V2/V3/V4/V6 的**绿态分支从未被执行过**（探针自己会在输出里声明"本探针在此不做任何
   '该分支能绿'的声称"）。⇒ **别把"现在恒红"读成"判据坏了"**，也别把这条红当成"接线已验证"。
2. **V5 判别力自检依赖 `tsx` 可按 cwd 解析。** V5 以**子进程**重跑本文件（`node --import tsx <本文件>`）取**真实退出码**；
   若 cwd 下解析不到 `tsx`，自检跑不起来（不得报绿）。子进程内以 `SYNOVA_PROBE_KS_SELFCHECK=1` 防递归；
   本进程若是**被 ladder import**（非直接执行）则 V5 跳过并**不计 PASS/FAIL**（如实打印，不假装验过）。
3. **三态 `exit 2` 的语义**：`2` ＝「目标能力未实现／未接线／**信号量==0**／环境或检查自身失败」——
   **既不是失败（1）也不是通过（0）**。CI 与调用方**不得把 `2` 当绿**（这正是"禁把看不见当没问题"的落点）；
   反之，看到 `1` 才是"目标件在但断言不成立"的业务红。

补充（如实标注，不夸大成"已解决"）：

- **语料是 dev 形态最小样本**（每 scope 一条 ＋ 一条跨两岗位的同 `source_id`），**不度量真实检索质量**；
  "生产 corpus 分化"是后续数据面活。
- **不能删探针语料行**：`knowledge_chunks` 的 FTS 同步触发器 `kc_fts_delete` 把字符串 `id` 当 FTS5 rowid ⇒ 任何
  `DELETE` 都抛 `SQLITE_ERROR`（KL-6，属 `src/l4/knowledge-store.ts`，本卡写集外）⇒ 播种改"同形复用"，
  域不一致时**报环境原因让你换临时库**，绝不拿脏语料出绿。
- **本件不替代 #731 的接线工作**，也不改任何门禁语义（三态退出码／存在性闸 `GATE_TARGETS` 判定／V5 骨架三者
  逐字保留；改＝A 类）。
