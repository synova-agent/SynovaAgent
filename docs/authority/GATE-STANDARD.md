# 工程质量体系最终标准（GATE-STANDARD）

> **v3.1** ｜ 2026-10-31 ｜ 基准 `gitea/main @ b11927d9b` ｜ 裁定 **D763**
> **本件是主仓唯一工程质量体系标准。handbook《门禁总台账》§十只放指针，不复制正文。**
> v1 出原则＝虚；v2 只做退役＝减负一半；v3 全盘但**经五路零上下文独立复核后有 5 处红色硬伤**；**v3.1 是复核后的可施工版**。
> **合并声明**：v1／v2／v3 的全部有效条款已并入本件，不再单独存在版本文件；演进过程见 git log。
> `docs/founder/**` 下的各版 HTML/MD（体系总蓝图、门禁体系最终方案 v1/v2、治理决策书、L0 落地方案等）**一律为过程草稿，已作废，不得作为施工或引用依据**——凡与其冲突，以本件为准。

---

## §0.5 本件取代的历史草稿（2026-10-31）

**一句话**：上表所列门禁类历史草稿**一律为过程件，已作废，不得作为施工或引用依据**；凡与它们冲突，**数字一律以本件为准**（引用它们 ＝ 引用过期口径）。

下表逐条登记本件取代的历史草稿（完整路径 ＋ 被本件哪一节取代）：

| # | 历史草稿（完整路径） | 原任务 | 被本件哪一节取代 |
|---|---|---|---|
| 1 | `docs/plans/codex/implementation/SYNOVA-IMPL-586-gate-protection-20261018.md` | #586 门禁本体保护：仓内清单 ＋ `check-gate-protection.sh` ＋ ①d | **§六「批 C｜C 类 13 件」**（该脚本体实测已接线 ⇒ 归「已接线仅复核 4」）＋ **§三** 四载体通盘账（清单/盘点口径） |
| 2 | `docs/plans/codex/implementation/SYNOVA-IMPL-595-gate-count-20261019.md` | #595 门禁组数口径纠偏（真值 12 组） | **§五「文档治理」** AGENTS.md V7.1→V7.2 条目 (b)「pre-commit 组数由字面"12 组"改为**指针引用台账**」＋ **§七「改」**「pre-commit 软腿，组数引 `GROUP_DONE`」 |

**枚举命令（可复跑，`gitea/main` 树）**：

```bash
git ls-tree -r --name-only gitea/main docs/plans | grep -iE 'gate|governance|门禁'
```

实测输出（2 条，2026-10-31 @ `gitea/main` ＝ `a025fc47e`）：

```
docs/plans/codex/implementation/SYNOVA-IMPL-586-gate-protection-20261018.md
docs/plans/codex/implementation/SYNOVA-IMPL-595-gate-count-20261019.md
```

**本节已知限制**：
- 只覆盖**文件名**命中 `gate|governance|门禁` 的草稿；内容相涉但文件名不含上述词的件不在册内 —— 下游要全量须另跑内容级检索并单独登记。
- 不做**内容级语义比对**：草稿与 v3.1 的实质冲突仍须人工逐句核；本节只切断"作为引用依据"这一条路。
- 枚举以 `gitea/main` 树为准：**未进仓的本地草稿不在册内**（如 §五-3 所列 `docs/founder/` 历史件，另按该条处置）。

---

## 〇、v3 → v3.1 自我更正（五路独立复核，先读）

**复核方式**：5 个零上下文子代理并行独立审计（内部一致性／事实核验／退役安全性／遗漏角落／可执行性），全部回仓 `git cat-file` 实测，不采信本件自述。

### 🔴 红色项（会导致施工做错或拆掉防护，已全部修订）

| # | v3 的错误 | 实测真相 | v3.1 修订 |
|---|---|---|---|
| **R1** | 退 `check-acceptance-ci.sh`（理由"caller `\|\| true`／零接线"） | **它挂在 Gitea 权威腿上**：`pre-commit-check.sh:653 par_start acceptance-ci`→`:1511 par_collect`→`:1517 if AC_RC≠0 → v5_soft`（`:1513-1516` 注释明载 **D1176 K3 整改"转回 v5_soft：本地软／CI strict 硬"**）；`v5_soft` 在 `SYNO_CI=1` 下硬阻断（`:288-294`），`local-gates.yml:86` 正是以 `SYNO_CI=1` 跑它 ⇒ **Gitea 硬阻断**。⚠️ `:1502-1503` 那条"已转旁路、不再阻断"是**被 D1176 回滚的过期注释**，我方 v3 正是引了它才判错。它是 `tests/acceptance`（8 个真测试）唯一"是否真跑过"的判定器 | **不退，改"降旁路 + 修假绿"**（现状证据文件是入库静态物 `ciRunAt 2026-06-24` ⇒ 实为假绿）。旁路后 acceptance 面仍留判据位 |
| **R2** | 退 GitHub `all-checks-passed` job 无前置 | 它是 P0 `check-gate-integrity.sh` 的**判据数据源**：`:766` 反解 `all-checks-passed` 块 → `:819 degrade "C_SCOPE_UNRESOLVED" … fail-closed 不判绿`。W1 退它、W2 才迁 C-1 ⇒ 中间整窗口该 P0 **不可解析＝不判绿** | **加硬前置**：退前须先给 `check-gate-integrity.sh` 换 ci-reds 参与集**单源**（`sealed-tests.sh` 或本机 job 列表），否则不得退 |
| **R3** | `ORPHAN 83`，分项 A53+B15+C13+误标1 ＝ **82** | 83 是全文件粗 grep 的污染值（多出 1 条是 `:640` **散文注释行** `# …orphan: true（C10b）`，不是登记块）。真实：**82 块／76 唯一文件** | **83 → 82 块／76 唯一文件**，并注明两个口径 |
| **R4** | C 类计数三处打架（§三 13／§六标题 12／清单实点 16），且混入 4 个已接线件 | `check-gate-protection.sh`／`check-block-paths.sh`／`check-secrets.sh`／`check-unicode-confusable.py` 实测 **`orphan:false` 且已接线** ⇒ 对它们"接线"无意义 | 统一 **13 件**，拆成「需接线 9」＋「已接线仅复核 4」 |
| **R5** | 四层防线用 **L0–L3**，成熟度用 **L1–L5** | **L1/L2/L3 三处双义**，直接污染"计配额＝L3"口径，且违反本件 §十-3 自己的"禁用编号撞名" | 防线改名 **D0–D3**（Defense），成熟度保留 L1–L5 |

### 🟠 橙色项（会让判据测不出 / 施工卡死）

| # | 问题 | v3.1 修订 |
|---|---|---|
| O1 | `39` 与 `37` 差 2 没写公式，且该 −2 排在 W2/W5 ⇒ **W1 出口测不出** | 显式写 **39 − 2（留 GitHub 不占配额）＝ 37**，并把重分类移入 **W0** |
| O2 | 退 `canary-drift` 的前置"扩 `sealed-tests` 发现面"**实测不可达**：`tests/legacy` 在远端**不存在**；其余四面全是 `.test.ts`，而 `sealed-tests.sh:55-56` 只 glob `*.test.sh`/`*.test.py` ⇒ 扩了也恒 0 发现 | 前置重写为「扩面 ＋ `scan_face` 支持 `.test.ts` ＋ 指定 runner」，并去掉不存在的 `tests/legacy` |
| O3 | `hook-block-write.sh` **已在 retired:8 内**（二次登记） | 从批 A 剔除 |
| O4 | `check-dev-doc-write-set.sh` 是全仓**唯一**"写集声明 vs 代码真实"机器判定器，且批 D 还要合并它的消费方 skill | **不退**，改保留 |
| O5 | **A2 双闸不是新建**：`verify-governance.sh:65-70` G11（non_doc≤30 ∧ total≤45 ∧ bypass≤8）＋ `:68 rc=2⇒DEGRADED⇒exit 2` **已存在**，只是**未接线** | A2 由"加"改为"**接线**"，并**前提到 W0**（W1 出口依赖它，不能排 W5） |
| O6 | `quota_scope` **已回填完**（`gate_meta` 122/122 全有值；39 门＝non-doc 37／doc 2／bypass 0） | §七 删除"补 quota_scope"，改为「补 **bypass** 回填 ＋ 定 semantic 判定标准」 |
| O7 | **退役数不达标**：原 退5+降2＝7 ⇒ 37→30。去掉 acceptance-ci 后只剩 6 ⇒ 31 | acceptance-ci 改为**降旁路** ⇒ 退 4 ＋ 降 3 ＝ 7 ⇒ **仍达标**。retired 目标改为 **≥26** |
| O8 | 排期死锁：W1 出口依赖 W5 的 A2；W2 依赖 W4 的 C 类接线；W3 删 `dev-doc-delivery` 依赖 W4 才接线的 `verify-d703.sh` | 新增 **W0**；C 类接线提前；`verify-d703.sh` 引用修改并入 W3 同批 |
| O9 | W1 前置"文档方案入主干"需**新建 3 件**，与"新增仅 A1–A3／W1 加 0"互斥 ⇒ 按 §九 C-2"清单外不派"**第一步就卡死** | 前置 3 件单列为「**不计入 A1–A3 的前置交付物**」 |
| O10 | `AGENTS.md:342-350/:360` 硬引用**归因错误**：实测引的是 `devdoc-gate-a`/`dev-doc-spec`/`claim-verifier`（342-350）与 `cto-bookkeeping`（:360），**不是** `dev-doc-delivery` | 更正归因，并把 AGENTS.md 同步列入 W3 出口 |

### 🟡 复核查出的"角落"（v3 完全没覆盖，v3.1 补）

| 角落 | 实测 | v3.1 补的条款 |
|---|---|---|
| **8/10 workflow 是账外** | 两仓共 **10** 个 workflow（GitHub 6／Gitea 4），v3 只点名 2 个。`dual-repo-sync.yml` 自行判"门禁放行"后推送 ⇒ **真阻断腿却不在账** | §二 补 **workflow 全量登记＋逐一定态** |
| **ci.yml 12 个 job 只处置 1 个** | 含 3 个 advisory job（`windows-leg-trigger` 等）无归类 | §二 补**第四态 advisory**（只参考、不阻断、不占配额但须登记） |
| **pre-push 1 件 ＋ npm 7 件 零处置** | `check-bypass-log.sh` 只在 pre-push 跑，却标 `required_ci:true`（CI 从不执行＝名义在跑），且自承 `auditable=no` | §二 补**本地腿三选一**处置 ＋ 机检禁 local-only 标 `required_ci=true` |
| **commit-msg 是未挂号的硬阻门** | `scripts/commit-msg-check.sh` **278 行**，`:25`/`:53/202/208/220/226`／`:238-274`（Note 引用门禁）均 **exit 1 真阻断** | 列入门禁账并定归属 |
| **AGENTS.md 是第二真源** | `AGENTS.md:3` 认**产品宪章 v8.3**（本体在仓外路径）为判据中枢；`:5` 写死"**12 组** pre-commit"（与 23 冲突）；另有一套 65,536 B 字节预算 | §五-3 与 §十一 补 **AGENTS.md V7.1→V7.2 同批改清单** |
| **观察期到期无电** | 8 件 `observation_until: 2026-11-28` ＋ 41 件 `review_after: 2026-11-27`；唯一读该字段的 `check-gate-inventory.sh:213-214` **只校格式不校过期** | §十 补**到期回收机检**（须有 `review_owner`，过期未复核 ⇒ 自动回滚为在用） |
| **bypass 面 K3 结构性失明** | `gate-exemptions/` **118 份**，`known_issue` 命中 **0**；bypass 账本落被 `.gitignore` 忽略的 `.claude/bypass.log`/`.sessions/` ⇒ K3 按 §八-K3-3 永远取不到证据 | §八 补 **K3-7 bypass 例外举证口径** |
| **`.gitignore` 掩盖证据** | 忽略 `*.log`／`docs/research/*.md`／`.synova-out/`／根 `evidence/`／`.claude/bypass.log` —— 正是交付证据与审计产物的默认落点 | §八 补 **K3-8 证据可见性**：凡引用为判据的产物不得被 gitignore 掩盖 |
| **skill 封顶只钉了 26 份中的一群** | 全树 `SKILL.md` 共 **100 份**：`.dsh/skills` 26／`.synova/skills` 26／**`extensions/skills` 41**／`skills/` 6／`vendor` 1 | §三 skill 封顶扩到**全树**，目标总数 ≤40（`.dsh` 根 ≤12） |
| **本件自身未入 main** | `git cat-file -e b11927d9b:docs/authority/GATE-STANDARD.md` **失败**（在 PR #1199 分支） | §十四 诚实边界写明：**合入前不生效** |
| **`docs/founder/` 19 份历史件无处置指令** | 远端 count＝0（未入仓），本地含 v1/v2.html／蓝图 v3／DEVDOC | §五-3 补**就地加 FROZEN 头标或迁移**的指令与期限 |

---

## 一、目标与四层防线

**唯一目标**：**agent 一开始就作对** —— 而不是写完被门禁追着打。

| 层 | 载体 | 作用时机 | 成本 | 现状 | 上限 |
|---|---|---|---|---|---|
| **D0** | **预设 Preset** | Agent 启动即带身份/边界/工具 | 零 | 3（cto／audit／devdoc）；全仓 `preset.yml` 共 7 | ≤6 |
| **D1** | **模板／脚手架** | 建文件即自带契约，构造即满足 | 零 | 3 模板 ＋ `new-file.sh`（`package.json:14 "new"`） | ≤8 |
| **D2** | **skill** | 语义／评审／决策方法 | 低（读） | **自研 12**（`.dsh` 12／`.synova` 12＝同一套双轨副本；**产品自带 48＝`extensions/skills` 41＋`skills/` 6＋`vendor/` 1 不计入**） | **自研 ≤40**（`.dsh` 根 ≤12；产品自带不计入） |
| **D3** | **门禁 Gate** | 对照事实才能判 | 高（每次提交都付） | **39** | 总 **≤45** |

**立门禁的唯一判据（三问）**：① 能构造即满足 ⇒ D0/D1；② 只能对照事实判 ⇒ **D3（占 45）**；③ 只能靠人/评审判 ⇒ D2 skill（**禁止机检**，必假绿）。
补充第四种：①＋需事实复核 ⇒ **D1 模板 ＋ D3 兜底**（如 Q-6 时间注入）。

**成本观**：减数量 ≠ 减负担。应付感主因是**耗时与阅读量**，故有耗时预算与非门禁载体封顶。

---

## 二、两仓分工与"账外腿"清零

| 腿 | 职责 | 阻断权 |
|---|---|---|
| **Gitea** | **权威腿**：工程纪律／质量／代码品味／判定 —— 日常 | **唯一阻断** |
| **GitHub** | **集成测试腿**：集成／跨平台／构建类 | **不阻断，只报**，回传 Gitea |

**四态登记**（每个 workflow/job 必选其一）：`阻断`（仅 Gitea）／`只报`（GitHub，回传）／**`advisory`**（只参考，不阻断不占配额，但**必须登记并说明理由**）／`账外`（须整改）。

**判据归属铁律**：凡"纪律／质量／品味判定"必须落 Gitea。现只在 GitHub 跑的 ⇒ **迁 Gitea** 或 **证明 Gitea 已覆盖后退**。**不允许"退了不管"。**

**W0 必做 · workflow 全量登记**：两仓 **10 个** workflow 逐一定态（GitHub：ci.yml／dashboard-auto／desktop-build／product-progress／progress-freshness-watchdog／project-coordinates；Gitea：asset-sync／dual-repo-sync／local-gates／trunk-freeze-watch）。⚠️ **`dual-repo-sync.yml` 自行判"门禁放行"后推送 ⇒ 实为真阻断腿，却不在账**，优先定态。ci.yml 内 **12 个 job**（含 3 个 advisory）亦须逐个定态。

**本地腿（pre-push／npm）三选一**：`check-bypass-log.sh` 只在 pre-push 跑却标 `required_ci:true`（CI 从不执行）⇒ ①迁 Gitea（占配额）／②证明覆盖后退／③**都不做则强制 `required_ci:false` 并标 `local-only`**，且机检禁止 local-only 件标 `required_ci=true`。npm 腿 7 件（`check:*`）同理。

**未挂号硬阻门**：`scripts/commit-msg-check.sh`（278 行，exit 1 真阻断，含 Note 引用门禁）须列入门禁账并定归属与是否占配额。

---

## 三、四载体通盘账（实测 @ b11927d9b，v3.1 修正值）

| 载体 | 实测 | 目标 | 占 45？ |
|---|---|---|---|
| 门禁 `quota:true` | **39**（pre-commit 23 ／ gitea-ci 6 ／ github-ci 10） | — | 是 |
| ├ 非文档 | **37** ＝ 39 − 2（留 GitHub 不占配额：`check-fixture-requires.sh`、`check-integration.sh`） | **≤30** | 是 |
| ├ 文档 | **2** | **≤15** | 是 |
| └ bypass | **0**（待回填 3 件） | ≤8（独立机检） | 否，但单独封顶 |
| **skill** | **自研 12**（`.dsh` 12 ／产品自带 48 不计入） | 自研 ≤40（`.dsh` ≤12） | 否 |
| **模板** | 3 | ≤8 | 否 |
| **预设** | 3（全仓 `preset.yml` 7） | ≤6 | 否 |
| ORPHAN | **82 块／76 唯一文件**（A53 漏接／B15 可退／C13 安全禁退／误标 1） | B 退、A/C 接线 | 否 |
| 已退役 | **8**（PR #1153） | W1 末 **≥26** | — |
| 台账体积 | 2691 行 | ≤800 | — |

**总数公式**：**总 = 非文档(≤30) + 文档(≤15) ≤ 45**。bypass／skill／模板／预设**都不并入 45**，但各自封顶机检。

⚠️ **计数口径**：台账多段重复登记，粗 grep 会双计（得 78）。**一律以 `run_by` 段块解析去重为准（39）**；ORPHAN 以**块数 82／唯一文件 76** 记，不得用粗 grep 的 83。

---

## 四、DSH 工程纪律 15 条 ＋ 代码品味 8 项

**机制吸收、条文不继承**。旧 15×8 整体退役，从 D0/D1 重建。

**吸收 6 条机制**：① 三态 `0/1/2`，`2＝判不了，同样阻断`；② "不适用"须**负证据 cmd**（可复跑，期望 0 命中）；③ 豁免挂 `known_issue`；④ 证据 `git cat-file -e <anchor40>:<path>` 成功**且是 blob**；⑤ **封顶用于枚举**；⑥ **机械／语义分离**（判语义却机械给 pass ＝ 假绿）。

**23 项路由**：T-1/T-5/T-8/Q-4/Q-8/Q-9/Q-10 → **D1 模板脚手架**；Q-6 → **D1 ＋ D3 兜底**（建 `clocked-module.ts.tmpl` ＋ `--kind`，**不要建 `.dsh/presets/clock/`**）；Q-2/Q-13（secret，永不退役）／Q-11（旁路）／T-7 → **D3 门禁（仅 3 项）**；语义项 Q-1/3/5/7/12/14/15、T-2/3/4/6 → **D2 skill，不机检**。

`check-acceptance-matrix.py`：不接成门禁，只移植三态机制到总闸，脚本随 15×8 退役，台账标 `absorbed_by`，**须计入退役批次与 retired 数**。

---

## 五、文档治理

**硬缺口（W0 前置）**：`DOC-STANDARD.md`、`verify-doc-budgets.sh`、`verify-doc-gate-effectiveness.sh` **三件均不在主干**（只在未推设计分支）；主干只有 `DOC-CONTRACT.md` ＋ `check-doc-contract.sh`。⇒ **这三件不计入 A1–A3 名额**，是前置交付物。

**主树准入三问**：描述"现在是什么／有用／定稿"全中才进主树；**文件名带日期戳＝默认不进主树**。

**一事实一归属**：本件是唯一真源。配套动作：
- `AGENTS.md` **V7.1→V7.2 同批改**：(a) 判据中枢由"产品宪章 v8.3"（本体在仓外）改为**指向本件**；(b) pre-commit 组数由字面"12 组"改为**指针引用台账**；(c) 字节预算与道数预算择一。
- **`docs/founder/` 19 份历史件**：就地加 `[历史方案·数字作废·判据见 GATE-STANDARD@<anchor>]` 头标，或迁 `docs/research/`／`批次收口/`；**不得原样留存也不得删除**，W1 出口收口。

**文档桶 6 组（≤15）**：G-DOC-1 预算／2 生效性／3 日期戳／4 一事实一归属／5 裸文件名引用／6 变更史词（先软后硬）。

---

## 六、退役表（v3.1 修正版）

### 批 A｜清退 **14 件**（原 16，剔 2）

ORPHAN B 类 **13** 件（原 15：剔除已在 retired:8 内的 `workflow/hook-block-write.sh`；剔除全仓唯一写集判定器 `workflow/check-dev-doc-write-set.sh` → 改保留）：
`check-lessons-learned.sh`／`check-tech-debt.sh`／`ci/check-contract-gaps.sh`／`check-boundaries-incremental.sh`／`check-dataflow-alignment.sh`／`check-golden-regression.sh`／`check-self-diagnosis.sh`／`workflow/checkpoint-runtime.sh`（**标"转运维资产"，不记退役**）／`workflow/hook-check-task-scope.sh`／`workflow/log-no-verify.sh`／`workflow/scope-check.sh`／`workflow/sop-gate.sh`／`workflow/verify-incremental.sh`
＋ **14. GitHub `all-checks-passed` job**（**硬前置**：先给 P0 `check-gate-integrity.sh` 换 ci-reds 参与集单源，否则不得退）。

⚠️ **同 PR 必须拆的测试对**（否则密封面转红）：`tests/control-tower/check-notes-lifecycle.test.sh`、`grep-oP-regression.test.sh`、`check-dataflow-alignment.test.sh`，以及 hook 相关 4 个测试对。
⚠️ `hook-block-write.sh`／`hook-check-task-scope.sh`：仓内证据（`.claude/settings.json` 无 hooks 键）支持"从未生效"，但 `settings.local.json` 被 `.gitignore:57` 忽略 ⇒ **标 `?`**，须核查开发者本机后方可退。

### 批 B｜退 4 ＋ **降旁路 3** ⇒ **non-doc 37 → 30 达标**

| 处置 | entrypoint | 判据 |
|---|---|---|
| 退 | `scripts/check-deprecated-mapping.sh` | 17 行末行 `exit 0` 恒定；caller `:775` 带 `\|\| true` |
| 退 | **`scripts/check-brief-vs-code.sh`（根级，全路径）** | 真正被调用的是 `scripts/workflow/check-brief-vs-code.sh`（`ci.yml:944`）；**两个同名文件，勿误删 workflow 版** |
| 退 | `scripts/control-tower/check-canary-drift.sh` | 头契约 `@exit 恒 0`；`ci.yml:808/:1514` 均带 `\|\| true` |
| 退 | `scripts/workflow/check-silent-swallow.sh` | caller `:812 \|\| true` 丢 rc（但须确认"新增行 `2>/dev/null` 双静默"由谁承接） |
| **降旁路** | `scripts/control-tower/check-pr-budget.sh` | `local-gates.yml:71` 已 `SYNO_SKIP_PR_BUDGET=1`；**只降不删**（删则 `self_fail_missing_script` 触发 HARD_FAIL） |
| **降旁路** | `scripts/check-hardcoded.sh` | 末段自陈"不阻断"＋`exit 0` |
| **降旁路** | `scripts/check-acceptance-ci.sh` | **R1 修正**：实挂 Gitea 权威腿，非"零接线"。现状为假绿（静态证据物 `ciRunAt 2026-06-24`）⇒ 降旁路并修，不退 |

⚠️ **退 `canary-drift` 的前置（W0 独立 PR）**：`sealed-tests.sh:54` 现仍 `SEALED_FACES="tests/control-tower tests/doc-system"`。须**扩面 ＋ `scan_face` 支持 `.test.ts`（`:55-56` 现只 glob `.sh/.py`，否则恒 0 发现）＋ 指定 runner**；`tests/legacy` **在远端不存在**，须改用实际存在的面。出口＝`--face-total` 出具各面**非零**发现数。

### 批 C｜github-ci 6 道**迁** Gitea
`check-gate-integrity.sh`(P0)／`check-required-contexts.py`(P0)／`verify-parallel.sh`／`workflow/check-brief-vs-code.sh`／`ci/diagnosis-quality-check.sh`／`ci/golden-case-checker.ts`。
**留 GitHub 不占配额**：`check-fixture-requires.sh`（工装）／`check-integration.sh`（集成）。
**去 `\|\| true`** 须给逐条 `file:line` 清单（ci.yml 实测 **35 处**）+ `grep -c` 阈值作为出口。

### 批 D｜skill 收敛（口径已改：**自研** ≤40，产品自带不计入 —— 2026-11-01 裁定）
> 🔴 **口径更正（2026-11-01 · CTO 裁定，创始人当日口令「减少我们自己写的 skill，产品自带的那些不要清理」）**：
> 本节及 §十二 ④ 的「全树」**一律改判「自研」**（`.dsh`/`.synova` 双轨同一套，按**去重后的一套**计）；
> **产品自带 48（`extensions/skills` 41＋`skills/` 6＋`vendor/` 1）不计入上限、不得清理**。
> 依据：原「全树 ≤40」把产品内容面算进研发上限 ⇒ 无论怎么砍自研都判红（现测 72 > 40），判据失去指向。
> 现状：**自研 12 → 11**（本轮退役 `line-audit-and-cards`：活面引用 0，卡片格式半部描述的是**已退役**的 legacy brief 规范）。
退 `brief-compose`；合并 13 组（见 v3 表）。**四个硬引用归因更正**：`pr-review`←`check-merge-conditions.sh:836-840`／`cto-handover`←`weekly-selfcheck.sh:119-123`／`dev-doc-delivery`←`verify-d703.sh:88-96`／**`AGENTS.md:342-350`（`devdoc-gate-a`／`dev-doc-spec`／`claim-verifier`）与 `:360`（`cto-bookkeeping`）**。
**先改 `.synova/skills`（真源）再 `sync-dsh-skills.sh` 同步**；`verify-d703.sh` 的引用修改**并入 W3 同批**（不随 W4）。

### 批 E｜probe-* **32 件**（非"约 30"）归测试面
**`safety=yes` 永不退役共 8 件**（v3 漏标 2 件）：`probe-rbac-multitenant.ts`(RB-01)／**`probe-department-axis.ts`(RB-02)**／`probe-permission-grants.ts`(RB-03)／`probe-role-config.ts`(RB-04)／`probe-approval-seam.ts`(RB-05)／**`probe-content-layering.ts`(RB-06，明文"上线闸：本探针 exit 0 之前该闸未解除")**／`probe-onboarding.ts`／`probe-knowledge-scope.ts`。

### C 类 13 件
**需接线 9**：`check-customer-deps.ts`(P0)／`check-block-paths.ts`(P0)／`check-merge-conditions.sh`(P0)／`verify-doc.sh`／`verify-claims-table.sh`／`verify-d703.sh`／`check-gate-integrity.sh`／`check-required-contexts.py`／`dev-doc-write-set.sh`（改为保留接线）
**已接线仅复核 4**：`check-gate-protection.sh`／`check-block-paths.sh`／`check-secrets.sh`（名字 P2、语义是唯一 secret 门）／`check-unicode-confusable.py`

---

## 七、加／改

**加（仍只有三项）**：A1 DOC-GATE 剩余 4 组 ｜ **A2 配额双闸＝"接线"不是新建**（`verify-governance.sh:65-70` G11 三桶＋`:68` exit 2 **已存在**，只是零接线）｜ A3 bypass 封顶 ≤8。
**W0 前置交付物（不计入 A1–A3）**：DOC-STANDARD ＋ 两个 verify-doc 校验器 ＋ `check-gate-budget.sh`（耗时机检，须**新建**）。

**改**：`quota_scope` **已回填完（122/122）**，改为「补 **bypass** 回填（0→3）＋ 定 semantic 判定标准（现状 nature 全 mechanical、semantic=0）」；成熟度 L1–L5（计配额＝L3，称生效＝L4）；pre-commit 软腿，组数引 `GROUP_DONE`；台账去重（**含跨段**：`run_by` ↔ `gate_meta`）；`measured_at` 刷新（`gen-gate-meta --check` 现排除该行，须补判据）。

**耗时预算**（**须新建 `check-gate-budget.sh`**，现有 `gate-stats.sh`/`gate-telemetry.sh` 只出中位耗时、无墙钟、无阈值、无数据也 exit 0）：pre-commit ≤90 s ｜ Gitea ≤15 min ｜ 举证 ≤5 min／次。**超则先减耗时再加门禁。**

---

## 八、K3 审计（v3.1 补 2 条）

K3 预设：`docs/synova/coordination/dsh-audit-draft/preset.yml`（另有 `docs/synova/presets/synova-k3-audit/preset.yml`，须按 C-6 验证真加载）。

K3-1 判据只以本件为准 ｜ K3-2 三态（判不了＝红）｜ K3-3 结论带 `path:line@<anchor40>`，证据 `git cat-file -e` 且是 blob ｜ K3-4 "不适用"须负证据 cmd ｜ K3-5 不出第二真源 ｜ K3-6 材料送对路径。
**K3-7（新增）bypass 面例外举证**：`gate-exemptions/` 118 份、`known_issue` 命中 0、bypass 账本落被忽略的 `.claude/bypass.log`/`.sessions/` ⇒ 该面**不得按 K3-3 判绿**，须用外部账本口径举证并明示。
**K3-8（新增）证据可见性**：凡被引用为完成判据/审计证据的产物路径，**不得被 `.gitignore` 掩盖**（现忽略 `*.log`／`.synova-out/`／根 `evidence/`／`docs/research/*.md`）；新增 `check-evidence-tracked` 机检扫"治理引用 ∩ gitignore"交集。

---

## 九、CTO 预设与派单验收

C-1 frontmatter ＋ 结论／证据指针／状态／归属四列 ｜ C-2 清单外不派（**清单须自足**，见 §十一 W0–W9）｜ C-3 新增必配退役对象 ｜ C-4 只放指针 ｜ C-5 验收按 §十二 ｜ C-6 预设须验证真加载（单独 `preset.yml` 不生效）。

---

## 十、历史问题规避（8 条）＋ 到期回收

原 8 条（文档推主树／第二真源／编号撞名／基线漂移／假绿／豁免无主／写文件≠交付／耗时膨胀）保留。
**新增第 9 条 · 到期回收**：8 件 `observation_until: 2026-11-28` ＋ 41 件 `review_after: 2026-11-27` 即将到期，而 `check-gate-inventory.sh:213-214` **只校格式不校过期**。⇒ 每条须有 `review_owner`；过期未复核或未附负证据 ⇒ **机检转红并自动回滚为在用**。
**D331**：保留不退役，P0 降 P1；退役触发＝**W9 分支保护落地**。

---

## 十一、排期（**W0–W9**，v3.1 重排）

| 周 | 动作 | 出口判据 |
|---|---|---|
| **W0（前置，独立 PR）** | ① 文档方案 3 件入主干 ② **A2 双闸接线**（已存在，只需接）③ 39−2 重分类 ④ 扩 `sealed-tests` 面＋支持 `.test.ts` ⑤ **10 个 workflow 全量定态** ⑥ 建 `check-gate-budget.sh` | 双闸可跑并含 exit 2；`--face-total` 各面非零；workflow 无"账外"；bypass 回填 ≥2 |
| **W1** | 批 A 清退 14 ＋ 批 B 退 4 降 3 | non-doc **37→30**；retired **≥26** |
| **W2** | 批 C 迁 6 道（C 类 9 件接线须**先于或同批**完成，否则 `check-gate-inventory` ③⑥必红） | GitHub 腿 0 个纪律/质量阻断（baseline 每行须标 `category`） |
| **W3** | 批 D skill 收敛 ＋ **AGENTS.md V7.2 同批改** ＋ `verify-d703.sh` 引用同批 | `.synova`→同步绿；`git grep -c cto-bookkeeping AGENTS.md`＝0 |
| **W4** | 批 E probe-32 归面；C 类接线收尾；**AGENTS.md 同批改复核** | `safety:yes ∧ orphan:true` ＝ 0 |
| **W5** | A1/A3 接入 ＋ 台账 ≤800（须补 `MAX_LINES`/跨段 dup/`measured_at` 三条判据） | 双闸绿；bypass 封顶机检出数 |
| **W6** | 耗时机检上线 | 墙钟 ≤90s 有数，破则告警 |
| **W7** | **观察期到期复核**（8 件 11-28 ＋ 41 件 11-27） | `observation_until`/`review_after` 全部已处置 |
| **W8** | ruleset `main-protect`(id 24259959) 9 条 context 按 `category` 清理 | `category≠integration` 行数＝0 |
| **W9** | 分支保护落地 ⇒ **D331 退役触发** | 分支保护生效，D331 退 |

**顺序铁律**：W1–W4 任一窗口**退役数 ≥ 新增数**；**W0 是前置交付物，不受此限**（须显式声明，否则 C-2 卡死）。

---

## 十二、完成判据（v3.1 全部改为可判定）

1. non-doc `quota_scope=non-doc ∧ quota:true` **≤30**；总 ≤45；**`bypass ≥2`**（防恒 0 假绿）
2. retired **≥26**（口径：**只计退、不计降旁路**；已去重 `hook-block-write`）
3. ORPHAN：**B 类 13 清零**、**`grep -c 'safety: yes' ∧ orphan: true` ＝ 0**、A 类接线率＝**P0 件 100%（n/N）**并附 awk 命令
4. **自研** skill **≤40**（`.dsh` ≤12；**产品自带 `extensions/skills`／`skills/`／`vendor/` 不计入**）；四条硬引用 `path:line@anchor` 无断链
   > 🔴 **本条判定方式 = 人工 ＋ 命令（无机检）** —— 2026-11-02 独立复核指出：全仓没有脚本数 skill、更没人守 40，
   > 本条从"错但可量"变成"对但无人量"。**补机检前按下列命令人工判，数字写进台账（禁口述）**：
   > ```bash
   > ls .dsh/skills | wc -l ; ls .synova/skills | wc -l          # 自研（双轨同一套）应 ≤40，.dsh 根 ≤12
   > bash scripts/workflow/sync-dsh-skills.sh --check             # 组 13 双轨一致
   > find extensions -name SKILL.md | wc -l ; find skills -maxdepth 2 -name SKILL.md | wc -l ; find vendor -name SKILL.md | wc -l   # 产品自带：不计入、不得清理
   > ```
   > 补机检另卡（新增判定件要走五道登记税并动 D3 预算），**不算在本条通过门槛里**。
5. `required-checks-baseline.txt` 每行标 `category`，**`category≠integration` 行数＝0**
6. 台账 **≤800 行** ＋ 跨段无重复 ＋ `measured_at` ＝ 当前基准
7. 新增仅 A1–A3（W0 前置 3 件单列）
8. 每条退役/不适用附 **`na_cmd:` 字段**，机检逐条执行并断言 rc/命中数
9. 墙钟 ≤90s 由 `check-gate-budget.sh` 出数（三态）
10. K3 报告 PR 号 ＋ CTO 派单件 YAML 存在且 `status` 齐全；**bypass 面按 K3-7 口径**
11. **10 个 workflow 全部定态，无"账外"**；pre-push/npm 腿已处置
12. **`AGENTS.md` 已升 V7.2** 且判据中枢指向本件

---

## 十三、引用纪律与责任矩阵

引用格式 `path:line@b11927d9b`；**退役/迁移清单一律写全路径**（防 `check-brief-vs-code.sh` 同名误删）。禁用 `M<n>`；变异体 `V1–V5`；存量 `legacy-naming`。防线 **D0–D3**／成熟度 **L1–L5**（不得混用）。

**需 admin／外部权限的事项（v3 缺失，v3.1 补责任人列）**：

| 事项 | 责任人 | 阻塞 |
|---|---|---|
| ruleset `main-protect` id 24259959（9 条 context，`owner=UNASSIGNED`） | 创始人/CTO（admin） | W8 |
| W9 分支保护 5 项 | 创始人/CTO（admin） | W9／D331 |
| handbook《门禁总台账》§十指针（`agents/P4-门禁/AGENTS.md:38` 指向外仓） | handbook 维护方（DSH 提 PR） | 一事实一归属 |
| `docs/doc-governance-standard` 设计分支推送（DOC-STANDARD 三件） | 治理侧 | W0 |

---

## 十四、诚实边界

- **本件在 PR #1199 分支，尚未合入 `main`**（`git cat-file -e b11927d9b:docs/authority/GATE-STANDARD.md` 失败）⇒ **合入前不生效**。
- `hook-block-write.sh`／`hook-check-task-scope.sh` 的"从未生效"缺开发者本机证据（`settings.local.json` 被忽略），标 `?`。
- `check-dev-doc-write-set.sh` 的保留理由（唯一写集判定器）与批 D 合并其消费方 skill 的耦合，需 DSH 复核确认。
- 复核仍以 `b11927d9b` 为基准；**换基准必须重跑全部计数**。
