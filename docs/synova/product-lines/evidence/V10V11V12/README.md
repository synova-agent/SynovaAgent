# V10 + V11 + V12 · 协调/决策 schema 门 —— 证据与复跑说明

> 工具：`docs/synova/coordination/tools/check-coordination-schema.ts`（单文件、零依赖、无 import）
> 任务：task-3（V10 revision CAS · V11 coordination 状态位 · V12 决策件 schema）
> 本件自身 = 证据件（`docs/**/evidence/**`），**不是** coordination 状态位文档。

## 一句话

三个门都是**机器可跑**的：违规 ⇒ exit 1 + 具名 token；合法 ⇒ exit 0；检查自身失败 ⇒ exit 2。
每条判据都有**构造得出来的反例**（`--selftest` 内置 31 个夹具，25/25 规则被覆盖）。

## 判据规格来源（CAS 声明）

本门的判据不是自创，取自文档契约的四态 / class 闭集 / 六段 / 归档即冻结。
下面这行是**真声明**（写者基于的版本），由 V10 自己在变更集里比对：

```
expectedRevision: docs/synova/DOC-CONTRACT.md@sha256:2836c0f22560bf20962876095090a60bac7dc205be59925c967eb8e55530e558
```

- 目标：`docs/synova/DOC-CONTRACT.md`（B 层决策件的格式权威，§2.2 + §3 闸 1）
- 比对口径：`--since <ref>` 基线上的该文件内容 hash（真相源 `git show <ref>:<path>`，判例 S-01②）
- 复算：`git show origin/main:docs/synova/DOC-CONTRACT.md | shasum -a 256`

---

## 一、怎么跑（三条判据各自的复跑命令）

```bash
# 前置：node v24.19.0（type stripping 原生支持）
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
cd <repo-root>

TOOL=docs/synova/coordination/tools/check-coordination-schema.ts
```

| # | 判据 | 复跑命令 | 期望 |
|---|---|---|---|
| 0 | 判别性自证（**先跑这条**） | `node --experimental-strip-types $TOOL --selftest` | 31 cases / failed=0 / covered_rules=25/25，exit **0** |
| 1 | 全树状态（合法 ⇒ 绿） | `node --experimental-strip-types $TOOL` | `SUMMARY ... fail=0`，exit **0** |
| 2 | 变更集模式（真实仓库） | `node --experimental-strip-types $TOOL --since origin/main` | `fail=0`，exit **0** |
| 3 | 严格模式（跳过=失败） | `node --experimental-strip-types $TOOL --strict` | 存量 DEBT 与未给 `--since` ⇒ exit **1** |
| 4 | 单派单件 CAS 前置门 | `node --experimental-strip-types $TOOL --cas-file <派单件.md>` | 缺声明 ⇒ `CAS_MISSING_DECLARATION` exit **1** |
| 5 | 替身检查自身失败 | `node --experimental-strip-types $TOOL --since no-such-ref` | stderr `CHECKER-ERROR [BAD_SINCE]`，exit **2** |

**V10 反例复跑**（老 revision 提交 ⇒ 具名 STALE）：`--selftest` 的 `V10-stale-old-revision` 用例；
**V11 反例复跑**（`archive/` 里写 `Status: active`）：`V11-archive-but-active` 用例；
**V12 反例复跑**（缺节 / 提议腔）：`V12-missing-section`、`V12-implemented-proposal-tone` 用例。
三类反例的**原始输出**见本目录 `raw/`。

## 二、退出码（判例 M-02）

| 码 | 含义 | 处置 |
|---|---|---|
| 0 | 全部规则 PASS（`NOT-EVALUATED` 且未加 `--strict`） | 放行 |
| 1 | 至少一条 FAIL（含 `--selftest` 判别性失败） | **阻断** |
| 2 | 检查自身失败（参数 / git / IO / 根缺失）stderr 打 `CHECKER-ERROR` | **同样阻断** |

禁 `|| true`：任何异常都走 exit 2，**不静默吞**。
`NOT-EVALUATED` 是**显式报告态**（行内含 `reason=`），不是跳过；每条规则**每次运行都必须出现在报告里**，
缺一条 ⇒ 检查器自己 exit 2（`SILENT_SKIP`）。

---

## 三、规则目录（25 条）

### V10 · revision CAS（写者声明「我基于的版本」，门禁比对现版本，不等 ⇒ 拒）

| 规则 | 判什么 | 反例 ⇒ token |
|---|---|---|
| `V10-CAS-ROOT-EXISTS` | CAS 扫描根必须存在 | 给一个不存在的 `--cas-root` ⇒ `CAS_ROOT_MISSING` |
| `V10-CAS-PARSE` | 声明行格式 `<path>@<algo>:<12..64 hex>` | `expectedRevision: not-a-valid-revision` ⇒ `CAS_MALFORMED` |
| `V10-CAS-SELF` | 不得声明自己的版本 | 目标 = 声明者自身 ⇒ `CAS_SELF_REFERENCE` |
| `V10-CAS-PRESENT` | `--cas-file` 指定的派单件**必须有**声明 | 派单件无声明 ⇒ `CAS_MISSING_DECLARATION` |
| `V10-CAS-STALE` | 变更集内声明的基线 hash = 基线上目标真 hash | 用旧 revision 提交 ⇒ **`STALE`**（含 declared / actual） |
| `V10-CAS-DANGLING` | 目标必须能在基线上解析 | 目标在基线不存在 ⇒ `STALE:DANGLING_TARGET` |

**声明形态**：整行（首个非空 token 为 `expectedRevision:`）或 JSON 字段 `expectedRevision`。
散文里提到该词**不会**触发 —— 避免把研究文档的叙述当声明。

**非法 JSON 怎么处置**（实测仓内有此类文件）：`.json` 解析失败时走**正则兜底**，仍要扫到 `expectedRevision`（`V10-declaration-inside-unparseable-json` 用例证明兜底有效）；兜底也没命中 ⇒ **显式计数** `unparseable_json_skipped=N` 并列出示例。
两条边界都不越权：**不静默跳过**（跳过必须打印），也**不把「非法 JSON」判成本门违规**（那是别的门的判据 —— 若拿它判红，仓内无关的坏 JSON 会把本门变成误报工厂）。
同理，目录读不到 ⇒ `WALK_FAILED` + exit 2（扫描空间变小必须显式失败）。

**为什么 `STALE` 只在变更集里判**（重要，别误读）：CAS 是**写时前置条件**（对标 DSH
`settings.mutate(ns, ops, expectedRevision)`：冲突在 mutate 那一刻判），不是永久不变量。
若对**已入库**的声明持续复验，目标每次合法前进一步都会把历史声明判成红的 ——
那就是「必然失败」的判据（判例 P-03）。故：**全树只判语法**（语法不随时间腐烂），
**过期只在 `--since` 变更集里判**。

### V11 · coordination 状态门

| 规则 | 判什么 | 反例 ⇒ token |
|---|---|---|
| `V11-ROOT-EXISTS` | coordination 根必须存在 | 根缺失 ⇒ `COORD_ROOT_MISSING` |
| `V11-STATUS-ENUM` | 状态值 ∈ 闭集 `{active, archived}` | `Status: wip` ⇒ `STATUS_ENUM` |
| `V11-STATUS-SINGLE` | 一个文件只许一个状态行 | 两行状态 ⇒ `STATUS_DUPLICATE` |
| `V11-STATUS-LOCATION` | **`Status:` 必与目录一致** | `archive/x.md` 里写 `Status: active` ⇒ `STATUS_LOCATION_MISMATCH`（报文件名） |
| `V11-NEW-DOC-STATUS` | 新增文档必须有合法状态行（增量禁止） | 新增 `.md` 无状态行 ⇒ `NEW_DOC_NEEDS_STATUS` |
| `V11-MOVE-REWRITE` | **移入归档必须同批改写状态行** | `git mv` 进 `archive/` 而状态行仍 `active` ⇒ `MOVE_NEEDS_REWRITE` |
| `V11-ARCHIVE-FROZEN` | 归档 append-only（M/D/R 一律拒） | 偷改 / 删 / 移出归档件 ⇒ `ARCHIVE_FROZEN` |
| `V11-STATUS-DEBT` | 存量计量（只报不拦） | 251 件存量无状态位 ⇒ `NOT-EVALUATED` + `reason=unclassified legacy documents=251` |

**文档 vs 机器类**：仅 `.md` 且路径段不含 `tools|fixtures|evidence|task-state` 的才算「文档」；
非 `.md`（json/yml/html）= 机器数据，不受状态位约束。依据 DOC-CONTRACT §2.4（卡 = 机器可读状态）
与 §3（证据走 `docs/**/evidence/**`）。**同目录不同文件可以，同目录不同类不混。**

**存量欠账（不阻断，但具名）**：`coordination/` 平铺 md 里有 **251** 件无状态位
（D8：机制件与一次性回执同层）。棘轮语义 = **存量容忍、增量禁止**：
新加的文档必须带状态行，存量按 `V11-STATUS-DEBT` 计量、逐批补（补一批少一批，不会自己长回去）。

### V12 · 决策件 schema 门

| 规则 | 判什么 | 反例 ⇒ token |
|---|---|---|
| `V12-ROOT-EXISTS` | `decisions/` 必须存在 | 根缺失 ⇒ `DECISIONS_ROOT_MISSING` |
| `V12-FILE-KIND` | 只许 `.md` 决策件 | 塞一个 `.txt` ⇒ `UNEXPECTED_FILE_KIND` |
| `V12-STATUS-LINE` | 状态行唯一且 ∈ 四态闭集 | 无状态行 ⇒ `STATUS_MISSING`；`done` ⇒ `STATUS_ENUM` |
| `V12-DATE-LINE` | 日期行唯一且与**文件名日期**一致 | 文件名 `10-06` / 正文 `01-01` ⇒ `DATE_MISMATCH` |
| `V12-SECTIONS` | **六段缺一不可**（一句话/问题/决定/考虑过的其他方案/后果/取代） | 删掉 `## 后果` ⇒ `MISSING_SECTION`（**具名缺哪节**） |
| `V12-SECTION-EMPTY` | 必填节有标题必须有内容 | `## 后果` 后直接下一个标题 ⇒ `EMPTY_SECTION` |
| `V12-LIFECYCLE-DIR` | 状态必与生命周期目录段一致 | `proposed/` 里写 `状态: implemented` ⇒ `STATUS_DIR_MISMATCH` |
| `V12-CLASS-DIR` | 类别段 ∈ 六类闭集 | `decisions/implemented/misc/` ⇒ `CLASS_NOT_IN_CLOSED_SET` |
| `V12-IMPLEMENTED-TONE` | **`implemented` 禁提议腔** | 正文出现 建议 / 可以考虑 / 拟 ⇒ `PROPOSAL_TONE` |
| `V12-PATH-DEBT` | 存量缺生命周期段（只报不拦） | `decisions/process/x.md` ⇒ `NOT-EVALUATED` + 修法 |
| `V12-PATH-RATCHET` | 新增件必须 `decisions/{state}/{class}/YYYY-MM-DD-*.md` | 新增件走 legacy 形状 ⇒ `PATH_RATCHET` |

`拟` 用负向后顾排除**非提议义**复合词：`模拟 / 虚拟 / 比拟 / 类似`。
`V12-implemented-tone-false-positive-guard` 用例证明「不误伤」（含那些词照样绿）。

---

## 四、语义决策（以及考虑过的其他方案）

| 选择 | 为什么 | 否决了什么 |
|---|---|---|
| CAS 用 **内容 hash**（`@sha256:`） | 无状态、任何件都能当基线、与仓内既有惯例同形（DOC-CONTRACT §10 证据指针 = `sha256 + 位置 + as_of`） | 否定「用 `updated_at`/`status` 当 revision」——两个字段都可能不变而内容已变 |
| 只支持**一种**声明写法 | M-04「同一事实只许一处表达」 | 否定 `.md` 一种 + `.json` 一种 + fenced 一种的三写法 |
| `--since` 才判过期 | 见 §三 V10 说明（避免 P-03「必然失败」） | 否定「全树持续复验声明」 |
| 存量走 `DEBT`（不阻断） | 251 件 + 67 件归档件存量若一刀切 = 上线即全红 = 门禁必被绕过（V3.9 教训） | 否定「存量一次到位」（那是迁移任务，不是门禁任务） |
| 状态闭集只给 `{active, archived}` | 需要更多态时**同批改门禁 + 本 README**（同 DOC-CONTRACT §2.2 class 闭集范式） | 否定「先开一堆态再说」 |
| 六段对**所有**四态统一要求 | 契约 §2.2 原文即「六段缺一不可」，未按态分叉 | 否定「按态裁减必填节」（无规格授权） |

## 五、例外清单（我没做到的，主动列）

1. **未接线**：本工具**没有被任何门禁调用** —— 我是 `docs/**` 的写者，不许改 `.github/**`、
   `scripts/**`（pre-commit / CI 均未挂）。当前它是「可跑的工具」，不是「已生效的门」。
   ⇒ **验证级别按实况 = L1-可达（工具自身 L2 真跑通，但作为门 L1）**；接线需另派（治理线/CTO）。
2. **V10 在 main 树上只判语法**：全树唯一真声明是本 README 的那一行；`STALE` 的**真跑**证据
   来自 `--since origin/main` 变更集 + `--selftest` 夹具，不是来自存量件（存量件里本来没有声明）。
3. **`decisions/` 存量欠账未修**：`decisions/process/2026-09-26-doc-contract.md` 缺生命周期段
   （契约 §2.2 要求 `decisions/{lifecycle}/{class}/`）。**本件只具名 + 给修法，没动它** ——
   移动决策件会牵动引用与取代链，属「迁移」不属「门禁」，且契约 §8 自己就写 `decisions/process/`，
   该矛盾应由契约方裁定。修法：`git mv` 到 `decisions/implemented/process/`。
   （另注：契约 §2.2 路径规格与 §8 自述**互相矛盾**，本门按「存量容忍 + 增量禁止」处置，不替契约裁。）
4. **契约 §3 闸 2（取代链）未实现**：闸 2 要求「解析 `## 取代` 段内的相对链接数 = 对账数」。
   本门只判六段齐全 + 状态一致，**不判取代链链接**（那需要先定义「对账数」的来源，属规格缺口）。
5. **提议腔闭集只有 3 条**：`建议 / 可以考虑 / 拟`。`待批准 / 暂定 / TODO` 等**未纳入**
   （卡只点名三条；扩表须同批改代码 + 本 README）。
6. **归档 append-only 不含 C/T**：`C`（复制出）与 `T`（类型变更）未判拒绝。若有需要须显式扩规则。
7. **契约 §7 张力（未替契约裁）**：DOC-CONTRACT §7 说「归档区不再继续归档（归档只是搬家）」，
   而 V11 按卡实现的是「append-only（新增允许，改/删/移出禁止）」。两者不冲突但**取向不同**：
   本门不禁止新增归档件。若要禁，须由契约方裁决后改规则。
8. **`--strict` 在 current main 上必然 exit 1**（251 存量 DEBT + 未给 `--since` 的
   `NOT-EVALUATED`）。这是**设计如此**（严格 = 零容忍），但也意味着 CI 若要挂它，
   必须先决定「挂哪种模式」（建议 `--since <base>`，非 `--strict`）。

## 六、证据（原始命令 + 原始输出）

本目录 `raw/` 内为**命令原始输出**（非手写），一键重建：

```bash
bash docs/synova/product-lines/evidence/V10V11V12/run-evidence.sh          # 重建
bash docs/synova/product-lines/evidence/V10V11V12/run-evidence.sh --check  # 对账（DOC-CONTRACT §10.1③a 要求）
```

| 文件 | 内容 |
|---|---|
| `raw/00-selftest.txt` | 31 个夹具逐条（每规则的反例，改坏即红） |
| `raw/01-state-mode.txt` | 全树状态模式（合法 ⇒ exit 0） |
| `raw/02-changemode.txt` | `--since origin/main` 变更集模式（真实仓库） |
| `raw/03-strict.txt` | `--strict`（跳过=失败 ⇒ exit 1） |
| `raw/04-checker-error.txt` | `--since` 非法 ⇒ exit 2（禁 `|| true`） |
| `raw/05-v10-stale.txt` | V10 反例原始输出（`STALE` 具名 + exit 1） |
| `raw/06-v11-archive-mismatch.txt` | V11 反例原始输出（报文件名 + exit 1） |
| `raw/07-v12-missing-section.txt` | V12 反例原始输出（具名缺节 + exit 1） |
| `raw/08-v12-proposal-tone.txt` | V12 反例原始输出（提议腔 + exit 1） |
| `raw/09-truth-source.txt` | `git ls-tree` / `git ls-files` 真相源读数（decisions 件数、CAS 目标 hash） |
| `raw/10-cas-live.txt` | 本件那行真声明被 V10 在变更集里比对通过 |

> 判例对照：S-01②（真相源用 `git show origin/main:`）· S-01③（数字前 `tr -d '\n\r'`）·
> V-02（禁 grep 型作验收）· V-08（改坏即红）· M-02（三态退出码）· P-04（不做假动作）。
