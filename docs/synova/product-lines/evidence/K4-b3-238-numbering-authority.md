# K4-b3-238 证据件 —— K4-05 编号权威表 ＋ 引用对齐判据

> 卡号：**#238**（K4-05）｜ 分支：`k4b3/l1-238-239` ｜ base：`ba1b22a8b5`
> 执行：impl-a（K4 批 3 · L1 小队）｜ 生成：2026-10-12
> 读数时点 × diff 左端：**`as_of ba1b22a8b5 × git diff --name-only ba1b22a8b5..HEAD`**
> 配套交付件：`docs/synova/coordination/numbering-authority.md`、`scripts/control-tower/probe-cycle-edges.ts`、`tests/coordination/numbering-authority.test.ts`、`docs/synova/GLOSSARY.md`

---

## 〇、环境注记（不可省，影响复现）

| 项 | 实测 | 说明 |
|---|---|---|
| 工作树 | `D:\k4b3-l1-238-239` | 唯一写码处；**未在** `D:\synova-wt` 或他人 worktree 写码 |
| HEAD / 分支 | `ba1b22a8b5ff75833704bac22fcfcb47295dc970` / `k4b3/l1-238-239` | 禁 rebase、禁改 base |
| `core.autocrlf` | `true` | ⇒ **哈希必须声明口径**（见 §五） |
| `node_modules` | 本 worktree 无 → 建 **junction** 指向 `D:\synova-wt\node_modules` | 工具链，非交付物；`git check-ignore -v node_modules` → `.gitignore:1:node_modules/	node_modules`（rc=0）⇒ **不进写集** |
| 探针运行方式 | `node scripts/control-tower/probe-cycle-edges.ts` | Node 24 原生类型擦除（本 worktree 无 tsx 依赖解析） |

---

## 一、前提实测（开工前自测；与派单件冻结值逐条比对）

```
$ node -e "...读 extensions/ontology/edge-types/*.json..."
FILE_COUNT=56
DISTINCT_ID=56 DISTINCT_LABEL=56
$id 形态：PREFIX_EDGE_SLASH=56 / WITH_UNDERSCORE=45 / WITH_HYPHEN=5 / WITH_NEITHER=6
含连字符 5 件 = decision-concentrates external-assumption incentive-binds locks-in signal-transmits
无分隔符 6 件 = augments constrains couples deploys funds produces
```

```
$ node dump-e-headings.mjs <第二章>
HEADING_COUNT=42      # ### E-NN: NAME
$ node dump-e-headings.mjs <第四章>
HEADING_COUNT=42      # ### E-NN NAME（…）
$ node dump-e-headings.mjs <第一章-五断裂点穷举>
HEADING_COUNT=0       # 第一章**不用** heading 承载 E 号
```

⚠️ **上一条必须补一句，否则会误导**（我第一版就只写了 heading=0，已改）：
第一章**不用** `### E-NN` heading，但它用**正文表格**与 `- **对应的边**：` 项目符号承载 E 号 —— 全章 `E-\d\d` 出现 **168 处**，
含一张 **42 行**的完整 E 号表（稳定锚点串 `| E-08 | TALENT_FILTER | 获取 | A4 |`）。**「heading 数 = 0」≠「第一章没有 E 号」。**

```
$ node verify-ch1.mjs
CH1_E_NN_OCCURRENCES=168
第一章 4 个分歧名是否出现：
  TALENT_FILTER        => L140,L641        （出现）
  EQUIPMENT_DEPLOYMENT => L158,L643        （出现）
  REPUTATION_ATTRACTION=> L167,L644        （出现）
  EFFICIENCY_FINANCING => L175,L599,L645   （出现）
  RESOURCE_ACQUISITION => NOT FOUND
  DECISION_ALLOCATION  => NOT FOUND
  TRUST_CONSTRUCTION   => NOT FOUND
  POWER_DISTRIBUTION   => NOT FOUND
```
⇒ **第一章与第四章在这 4 条上同名；第二章是唯一的异类。**
⇒ 准确表述 = 「**第二章 vs（第一章 ∩ 第四章）**」——**不是**「第二章 vs 第四章」的 2:2 并列。

```
第二章 E-12 自相矛盾核实（同一文件内两处互斥用法）：
ch2 L335: **注意**：E-10 DECISION_ALLOCATION、E-11 TRUST_CONSTRUCTION、E-12 POWER_DISTRIBUTION …
ch2 L408: ### E-12: POWER_DISTRIBUTION
ch2 L505: **前置边**：E-12 POWER_DISTRIBUTION（权力分布→决策集中度）
ch2 L814: **后置边**：… E-12 EFFICIENCY_FINANCING（效率→外部融资信号）   ← 与 L408 heading 互斥
```

```
第二章 vs 第四章 同名比较 → CH2_VS_CH4_NAME_DIFFS=4
  DIFF E-08 ch2=RESOURCE_ACQUISITION(L257) ch4=TALENT_FILTER(L154)
  DIFF E-10 ch2=DECISION_ALLOCATION(L339)  ch4=EQUIPMENT_DEPLOYMENT(L182)
  DIFF E-11 ch2=TRUST_CONSTRUCTION(L375)   ch4=REPUTATION_ATTRACTION(L196)
  DIFF E-12 ch2=POWER_DISTRIBUTION(L408)   ch4=EFFICIENCY_FINANCING(L210)
```
⇒ **更正**：分歧是「**第二章 vs（第一章 ∩ 第四章）**」，**不是**「第一章 vs 第二章」（第一章无 heading 但有同名表，见上）。
⇒ 行号仅作本次留痕，交付件中的依据一律用**稳定锚点串**（如 `### E-08 TALENT_FILTER（`）。
⇒ 根因：第一章用**表格**承载 E 号，早期只扫 `^### E-NN` 会漏判 —— 这正是「禁把单一形态当全量」的实例。

```
第二章名 → 词表 label 逐字命中 = 13
golden edges 键 = 36 / 经 label 中介命中 = 34 / 未命中 2 = E-0.4 ASSUMPTION_LINKAGE、E-X.1 EXTERNAL_ASSUMPTION
_patch_d66.cjs: E-x.y distinct = 34 / occurrences = 119 / 56 个 code label 命中 = 0
形态归一交集（E-x.y 去点 vs E-01..E-42）= 24
```

**与冻结前提差异**：无。另**追加**三项派单件未记的事实（已入交付件）：
① 两章命名分歧 4 条；② `$id` 形态 45 下划线 / 5 连字符 / 6 无分隔符；③ `_patch_d66.cjs` 不含 label（0 命中）。

---

## 二、判据④ 正常路径（原始输出全文，不截断）

```
$ cd D:\k4b3-l1-238-239 && node scripts/control-tower/probe-cycle-edges.ts
══════ 判据① 旧编号 E-x.y 出现次数（口径 = git grep -ohE "E-[0-9]+\.[0-9]+" -- cycles/）
legacy_occurrences = 0

══════ 逐文件明细
file | legacy_occurrences | edgeRefs | mapping.edgeId | unknown | loader_visible
cycles/builtin/cash-cycle.cycle.json | 0 | 3 | 3 | 0 | yes
cycles/builtin/customer-cycle.cycle.json | 0 | 4 | 4 | 0 | yes
cycles/builtin/product-cycle.cycle.json | 0 | 4 | 4 | 0 | yes
cycles/builtin/talent-cycle.cycle.json | 0 | 4 | 4 | 0 | yes
cycles/industry/retail-ecommerce/store-replication.cycle.json | 0 | 4 | 4 | 0 | yes
cycles/industry/saas-tech/arr-growth.cycle.json | 0 | 3 | 4 | 0 | yes
TOTAL edgeRefs = 22
TOTAL mapping.edgeId = 23
TOTAL edgeRefs + mapping.edgeId = 45

══════ 判据② 取值域
code_edge_$id_count = 56
code_edge_label_count = 56
distinct_values_used = 15
  edge/capital_allocation  x7  [$id]
  edge/channel_delivery  x4  [$id]
  edge/cross_functional_synergy  x2  [$id]
  edge/cumulative_learning  x2  [$id]
  edge/customer_lockin  x4  [$id]
  edge/efficiency_attraction  x2  [$id]
  edge/equipment_acquisition  x2  [$id]
  edge/external_feedback  x2  [$id]
  edge/knowledge_reuse  x2  [$id]
  edge/operational_execution  x2  [$id]
  edge/profit_reinvestment  x2  [$id]
  edge/reputation_flywheel  x4  [$id]
  edge/talent_acquisition  x2  [$id]
  edge/talent_retention  x2  [$id]
  edge/value_pricing  x6  [$id]

══════ 判据③ unknown 计数（呈报，不判内容）
unknown_tokens = 0

══════ 判据④ 引用对齐判据（distinct 全部命中 $id ∪ label）
align_occurrences = 45
align_distinct = 15
align_hit = 15
align_miss = 0
align_unknown_distinct = 0
align_vocabulary_id = 56
align_vocabulary_label = 56

✅ 结论：判据① 旧编号 = 0；判据② 全部取值 ∈ 代码边 $id ∪ label ∪ {unknown}；判据④ 引用对齐全命中；exit 0
occurrences=45 distinct=15 hit=15 miss=0
===EXIT=0===
```

**(a) `22 ≠ 23` 的来源（verifier a-4）**：上表逐文件明细中 **唯一**不对称的一行是
`cycles/industry/saas-tech/arr-growth.cycle.json | 0 | 3 | 4 | 0 | yes`（`edgeRefs`=3，`mapping.edgeId`=4）⇒ 全仓 22 vs 23。
其余 5 件两列相等（3/3、4/4、4/4、4/4、4/4）。⇒ **45 是「两个不同口径的 occurrence 之和」，不是任一口径单独的值。**

---

## 三、反例（判别性夹具）—— 全程只在 /tmp 副本，**未写源仓 `cycles/**`**

夹具脚本：`/tmp/k4b3-238-red/`（`cp -r` 出 `cycles/` + `extensions/ontology/edge-types/` + 探针，`cd` 过去跑）。
篡改对象：副本内的 `cycles/builtin/cash-cycle.cycle.json`。

### 3.1 反例 A —— 1 条引用改成不存在的 `$id` ⇒ 判据④ 必红

```
=== [2] 反例 A：1 条引用改成不存在的 $id — 期望 miss 0->1、exit 1 ===
  edge/does_not_exist_xyz  x2  [INVALID]
align_occurrences = 45
align_distinct = 16
align_hit = 15
align_miss = 1
align_unknown_distinct = 0
align_vocabulary_id = 56
align_vocabulary_label = 56
align_miss_values = edge/does_not_exist_xyz
══════ ❌ 违规明细
❌ cycles/builtin/cash-cycle.cycle.json @ nodes[revenue].edgeRefs :: edge/does_not_exist_xyz — 判据② 违规：值 ∉ 代码边 $id ∪ label ∪ {unknown}
❌ cycles/builtin/cash-cycle.cycle.json @ mapping[revenue].edgeId :: edge/does_not_exist_xyz — 判据② 违规：值 ∉ 代码边 $id ∪ label ∪ {unknown}
❌ 结论：2 项违规 — exit 1
occurrences=45 distinct=16 hit=15 miss=1
rc=1
```

### 3.2 反例 B —— **防「45 写死」**：删掉 1 条 `edgeRefs` ⇒ `occurrences` 必须随之变化

```
=== [3] 反例 B（防硬编码 45）：删掉 1 条 edgeRefs ⇒ occurrences 必须 45->44 ===
8:    { "id": "revenue", "label": "营收", "type": "flow", "initialValue": 800, "unit": "万元/年", "edgeRefs": [] },
TOTAL edgeRefs = 21
TOTAL edgeRefs + mapping.edgeId = 44
align_occurrences = 44
align_distinct = 15
align_hit = 15
align_miss = 0
occurrences=44 distinct=15 hit=15 miss=0
rc=0
```
⇒ `occurrences` **来自计算**（硬编码 45 会输出 45）；同时末行随输入变化 ⇒ 该数字**不是拟合出来的恒真值**。

### 3.3 复原（双口径）

```
=== [0] 源仓文件双口径哈希 ===
W_sha256 : ddc634a03ad0dd0916555f93c72133a5d39d38636f2fba9de14d8ab26f90f0ae
B_blobLF : 411bcfc6bb4c75cbe2736cd55ca31062d47def04
B_verify : 411bcfc6bb4c75cbe2736cd55ca31062d47def04
difftree : []

=== [4] 复原（用源仓字节覆盖副本）并逐步复核 ===
W_sha256 副本 : ddc634a03ad0dd0916555f93c72133a5d39d38636f2fba9de14d8ab26f90f0ae
W_sha256 源仓 : ddc634a03ad0dd0916555f93c72133a5d39d38636f2fba9de14d8ab26f90f0ae
B_blobLF 副本 : d427398847231ce9d94d03364ea93b0583711eab
occurrences=45 distinct=15 hit=15 miss=0
rc=0

=== [5] 源仓零改动终检（口径 W 与 B 双证） ===
W_sha256 源仓 : ddc634a03ad0dd0916555f93c72133a5d39d38636f2fba9de14d8ab26f90f0ae
B_blobLF 源仓 : 411bcfc6bb4c75cbe2736cd55ca31062d47def04
git diff vs base: []
git status cycles: []
```
⇒ **复原后逐字节一致（口径 W）**：`ddc634a0…f0ae` == `ddc634a0…f0ae`；
且源仓 `cycles/` 相对 base **零改动**（`git diff` 与 `git status` 双空）。

---

## 四、测试件判别力（`tests/coordination/numbering-authority.test.ts`）

在 **/tmp 镜像**（`/tmp/k4b3-238-mirror/`，只复制测试所需的仓内原件 + `vitest.config.ts` + `package.json`，`node_modules` 用软链）里跑，四种输入：

| 场景 | 结果 | rc |
|---|---|---|
| (a) 基线（未篡改） | `Test Files 1 passed (1)` / `Tests 19 passed (19)` | **0** |
| (b) `cycles` 里 1 条引用改成不存在的 `$id` | 红：`× occurrences=45 / distinct=15 / hit=15 / miss=0，且 legacy E-x.y = 0` | **1** |
| (c) 改 golden `"E-4.1": { "label": "VALUE_PRICING"` | 红：`× 36 键 / 命中 34 / 未命中 2，且未命中就是 E-0.4 与 E-X.1` | **1** |
| (d) 删交付件里 B 类待裁登记中的 `E-26 PRODUCT_DEFINITION` | 红：`× 两条待裁清单（19 条）逐条在件` | **1** |

源仓内直跑：
```
$ node node_modules/vitest/vitest.mjs run tests/coordination/numbering-authority.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)
===EXIT=0===
```
⇒ 覆盖 **正常路径**（13/42/34/36/45/15）+ **降级/冲突路径**（29 条未命中不得冒充命中、4 条章间分歧、2 条 golden 未命中、`_patch_d66` 0 label、第二章 E-12 自相矛盾）+ **边界**（E-01/E-42、E-4.1/E-5.5、E-1.1≡E-11 反例、第一章表格承载面）。**非空壳**（19 例全含真 `expect()`）。

---

## 五、哈希口径声明（我方口径 + 队长更正后的执行）

本 worktree `core.autocrlf=true` ⇒ `git hash-object` 会先走 clean 过滤器（CRLF→LF），
**只证「规范化后一致」，不证「工作树原始字节一致」**。故本件**双口径并列**：

| 口径 | 命令 | 本件取值（`cycles/builtin/cash-cycle.cycle.json`） | 适用 |
|---|---|---|---|
| **W｜文件原始字节** | `sha256sum <path>` | `ddc634a03ad0dd0916555f93c72133a5d39d38636f2fba9de14d8ab26f90f0ae` | 「复原后有没有被改坏」—— 反例复原断言用这条 |
| **B｜blob(LF) 规范化字节** | `git hash-object <path>` | `411bcfc6bb4c75cbe2736cd55ca31062d47def04`（= `git rev-parse HEAD:<path>`） | 与库内存储一致，跨机可比 |
| B'｜原始字节的 git 哈希 | `git hash-object --no-filters <path>` | `d427398847231ce9d94d03364ea93b0583711eab` | 仅作对照，证明 W≠B |

**引用的仓内原件身份证明（B4）**：

| 原件 | `git ls-files` | `git cat-file -e ba1b22a8b5:<路径>` | blob @ base |
|---|---|---|---|
| 权威文档01 第二章 | 命中（mode 100644） | exit 0 | `6771008dc080082939f2bea7bfaf625a93faefb7` |
| 权威文档01 第四章 | 命中（mode 100644） | exit 0 | `0a61b40d7422dd73a8898d550189e0329aea57ba` |
| 路线A 交叉引用件 | 命中（mode 100644） | exit 0 | `afead721c4dfa3e5c201c908f63d47668fa8ce02` |
| golden | 命中 | exit 0 | `612dda6080236eafe94f96a668219469e7022f4f` |
| `_patch_d66.cjs` | 命中（仓根，非 scripts/ 下） | exit 0 | `c61b8cdded27d3e92cfc4ae3d74ffb81e970554b` |

---

## 六、写集对账

```
$ git diff --name-only ba1b22a8b5..HEAD
（见 §七 交付时刻的实测输出）
```
写集 = 卡面逐条裸路径 **＋ 1 条经队长授权的治理产物**：
`memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md`（**由队长撰写并落到本 worktree**，
用于满足 `commit-msg-check.sh` 的 D395-a/D534 Note 引用门禁 —— 本卡改动命中 `scripts/control-tower/**`）。
⇒ 该 +1 条已同步登记进 `.claude/claims/238.yaml` 与 `.claude/claims/239.yaml` 的 `writeset`；
**多出/缺失见 §七**。

---

## 七、交付时刻读数（占位，提交后回填）

> 本节在 commit 后由**同一条命令**回填，读数时点 = `as_of ba1b22a8b5 × git diff --name-only ba1b22a8b5..HEAD`。

（待回填）

---

## 八、未决项 + 归属

| # | 未决项 | 归属 |
|---|---|---|
| 1 | 章间分歧 4 条（E-08/E-10/E-11/E-12）**两章命名谁为准** | 🔴 **CTO 裁定**（已上报队长转 CTO） |
| 2 | 待裁清单 19 条（A 类 17 / B 类 2）**语义是否同义** | 🔴 **CTO 裁定**（本件不代裁） |
| 3 | `GLOSSARY.md` 旧 `E-a.b` 值**改成什么**（改权威 `E-NN`？改 `$id`？） | 🔴 **CTO 裁定**（本件只加注记，不代改） |
| 4 | 路线A 交叉引用件的 12 条 `[语义同义·附仓内交叉引用件依据]` 是否正式追认 | 🟡 队长已裁定「可采信但降级、不得作唯一依据」；**追认与否待 CTO** |
| 5 | `packages/ontology/src/**` 第二套 TS 常量词表与本表的关系 | ⚪ 另案（K4 审计 §五已登记） |

## 九、一句话自验结论

判据①/②/④ 全绿（`occurrences=45 distinct=15 hit=15 miss=0`，exit 0），2 个反例各有判别性且复原后双口径哈希一致、源仓 `cycles/` 零改动；
编号权威表已落地并**如实登记 4 条章间分歧 + 19 条待裁**（不代裁）；测试 17 例全绿且 3 类篡改均报红。
**本件可提请独立复核**——`通过` 与否归 CTO 收件闸 + K3 终审。
