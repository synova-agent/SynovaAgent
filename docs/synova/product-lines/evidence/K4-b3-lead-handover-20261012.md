# K4 批 3 · 队长交接件（暂停收口版）

- 批次：K4 批 3 · 收尾六卡（+1 治理段）
- 队长：synova-squad-lead｜日期：2026-10-12
- **base（全程钉死）**：`ba1b22a8b5ff75833704bac22fcfcb47295dc970`（= `origin/local-main`）
- **交付仓**：`D:\synova-wt`｜remote = `http://192.168.1.7:3000/synova-agent/SynovaAgent.git`
- **本件性质**：**暂停收口**。合并权在 CTO ⇒ 本件不主张任何卡"通过"。

---

## 〇、收口时的实物状态（`git ls-remote` 实测）

```
3b2c51d090f2b8ba65bd7855a6bc558a3d679822  refs/heads/k4b3/234         L2 · #234 + #235
eb5ab88a90e71cb2c1206e1291d2cd2404020e25  refs/heads/k4b3/238-239     L1 · #238 + #239
a7437498c70235a7ef5eaef13b7de960b464dd20  refs/heads/k4b3/l3-65       L3 · #65 A＋B 段（B 段已落，队长实测 58 件）
00684e3973d08ccd97d850c7f91f18c5bdbcd47f  refs/heads/k4b3/lead        队长治理件（7 笔）
94b064965b0abf4057c57662c2af9db9eb39c237  refs/heads/k4b3/verify      独立复核（15 笔 / 8 件出件）
```
> PR **未开**（开 PR 需 CTO；`synova-commit` 只 auto-push 分支）。
> **收口时点更新（2026-10-12T15:09+08:00）**：impl-c 在队长收口令**之前已完成 B 段并推送
> ⇒ **六卡全部交付**。#65 由「未达」改为「**已交付、待独立复核**」（详见下表与 §七bis）。

---

## 一、六卡状态（**关卡只认卡面 Done 判据**）

| 卡 | 分支 | commit（实测） | 交付 | 独立复核 | 卡面 Done |
|---|---|---|---|---|---|
| **#238** 编号权威表 | `k4b3/238-239` | `a6e927a9a`→`971c33db2`→`0ff23b28c`→`932c9db50`→`aa04c9377` | ✅ | ✅ 判据面 8 项（V-1…V-6） | **达**（末行 `occurrences=45 distinct=15 hit=15 miss=0`、反例 45→44、双口径复原） |
| **#239** 循环五阀 | 同上 | `559fb6b0e`→`eb5ab88a9` | ✅ | 🟡 **下一轮开验**（已 recon） | **达**（43 条逐字取 §5 模板、24 处非注释真消费、消费改硬编码⇒测试红、13/13） |
| **#234** 值域迁移 | `k4b3/234` | `a96cd2b50` | ✅ | ✅ **8/8 逐条**（含"改输入即红"） | **达**（`interval=5` 即裁定自证、反例②双报、口径 W 5/5）**附 U8 口径缺口提请终裁** |
| **#235** TBD 落值 | 同上 | `4653cba2a`→`3b2c51d09` | ✅ | ✅ `K4-b3-VERIFY-235.md` | **达**（`TBD=0` 末行、13 公式运行时真读、39 unknown、最小 diff 52×1 行） |
| **#65** 边词表 | `k4b3/l3-65` | `97d659785`→…→`6f53b727c`→`5f4f8648a`→`a7437498c` | ✅ **A＋B 段全交**（B 段收口前落盘） | 🟡 **待**（verifier 下一轮） | **达**（V1 58 件/同构 `canon11=55 canon12=3 bad=0`；V2 20/20 + `edgeTypes.length===58`；V3 删边 57/57/56 回落 + B5 自足造红） |
| **#66** 守卫收口 | — | — | ✅ **裁定不实施** | ✅ `K4-b3-VERIFY-1412.md` | **已由 PR #392 落地**（走适配器路径） |

**#238 判据面独立复核（verifier 原样）**：`V-1` 末行逐字命中且非硬编码｜`V-2` 删引用即红 + 口径 W 复原逐字节一致｜`V-3` 表 A 42 行、计数 `13+6+2+2+17+2=42` 自洽、章间分歧三章并列｜`V-4` GLOSSARY 冲突显式标注且旧编号保留｜`V-5` 结构 ✅（**未跑 vitest，记 b**）｜`V-6` ⚠️ **probe 无自动执行链**（另案）。

---

## 二、🔴 最高优先：交付仓纠错（否则全批交付失败）

工作令文本指向 `D:\novis-backup-20260526\Novis\synova-agent`。**该仓不是交付仓**：
```
remote = git@github.com:.../SynovaAgent.git
$ git ls-remote --heads origin main  → ERROR: Your account is suspended.
$ git rev-parse local-main           → fatal: unknown revision（refs 内不存在）
```
**真仓 = `D:\synova-wt`**（LAN Gitea，982 refs，已认证）⇒ 本批全部工作在真仓完成。

---

## 三、工作令 §二 五条前提的裁决（逐条实测）

| # | 工作令 | 实测 | 处置 |
|---|---|---|---|
| ① | 判据改 `distinct=17` | **三口径全为 15**（22/23/45） | 🔴 **撤销**（CTO 当面确认）。`17` 出自**被仓内裁定件判错的那个复核员**；`0/17` 的分母是 **golden 标签中介数**，非同源 |
| ② | E 号 0/17 ⇒ 新建权威表 | `git grep -E 'E-[0-9]+(\.[0-9]+)?'` = **0** ✅ | 成立 |
| ③ | `edge-types/` 已 56 件 | **56** ✅（第 56 件 `goal_decomposition.json`，散文值） | 成立（派单基数 55→**56**） |
| ④ | 新增 `valves` 不覆盖 `edges[]` | `src/` 内 `Valve`/`actionEffectLag` = **0** ✅ | 成立 |
| ⑤ | #234/#235 按卡面执行 | TBD **52**/56 ✅ | 成立（卡面「4 条」已判定） |

**工作令未载、须补记的两件**：
1. **#66 已实现**：`1ab0cbb33`（PR #392）+ `d180632d6`/`d87b1ce3b`，走**适配器默认带守卫**路径，**非** §四⑥ 的 `engine-context` 路径 ⇒ 剩余面 = **0**（`engine-context` 不构造 store：grep exit 1 = 对象不存在；`src/ingest/index.ts` 实测 **1 处**非 2 处）。
2. **#65 卡面是"提案 carrier"**（明文「不实现代码」），与 CTO 受理裁定的 V1/V2/V3 实现判据冲突 ⇒ 判据以**受理裁定**为准。

---

## 四、队长自纠（**6 条，全部留痕未抹旧事实**）

1. **判「doc15 第三章不在本仓」为假** —— 错因 = **用文件名当目录名**（真目录名 = `权威文档15-企业循环溢出导航系统-20260714`）。已自纠（§六）。
2. **写「56 个 `$id` 全为 `edge/<snake>`」不精确** —— 实测 **45 下划线 / 5 连字符 / 6 单字**（verifier a-1）。
3. **`git hash-object` 被写成"逐字节"证据** —— `core.autocrlf=true` ⇒ 只证规范化一致（verifier a-3）⇒ 全军改双口径（W/B）。
4. **Note 漏落第三棵树**（`k4b3-l3-65`）—— impl-c 实测打掉。
5. **底稿把 E-25 判 `MISS`** —— 与 L1 件两个值 ⇒ **F1 第 4 例，归属 = 队长底稿 / impl-a**。
6. **改 `201.yaml`/`345.yaml`** —— **越界"先做后报"**（不在队长声明写集、不属任何 K4 批 3 卡）⇒ **须 CTO 追认**（R11）。verifier 独立复现 `invalid → ok` 为真、机器读字段逐条不变；**但 note 文本非逐字**（去引号 10 处 / 4 处 + 去尾空格）⇒ 正确自陈 =「**机器读字段零变化；note 去引号**」，**禁用"零语义"**。

---

## 五、升级 CTO（按纪律「同类第二次立即升级」）

### F1 —— 同一事实两处取值不同（**已达 4 例**）
| 例 | 两个值 |
|---|---|
| 1 | 表格 vs 正文（3 条分辨率盲区 vs 4 条） |
| 2 | 旧时点值 vs 当前实测（写集计数 3 vs 4，`afa582cd8` 时点） |
| 3 | D10 已立（桶数必须带口径）vs Note §一.2 未同步 |
| 4 | **队长底稿 `K4-b3-crosswalk-238.txt` L50（`MISS`）vs L1 件 `numbering-authority.md` L191（可落）** |

**对策（已采纳 verifier 建议并本批执行）**：凡落盘数值必须同时给 **「值 + 口径 + 时点 + 探针版本」四元组**（R20）。

### F2 —— 判据自身缺陷（**已达 2 例**，反向失效：假阳诱导你改**对的**数据）
| 例 | 假阳 |
|---|---|
| 1 | impl-c 核对脚本正则 `53` 命中字节数 `1653` 的**子串** |
| 2 | verifier `git grep "MISS"` 命中 **`TRANSMISSION`** 的子串（`/MISS/.test('TRANSMISSION') === true`） |

**对策**：判据带**边界** ＋ **grep 命中必须打印命中行全文**再定性 ＋ **判据上线前反向造红自证**。

### 其他方法论规则（本批实证）
- **R19 跨文档比对必须先钉配对键，禁按位置**（verifier 首轮按位置配对得"产品/人才阀不一致"**假差异**）。
- **R22 造红必须脚本化 + 核「替换确实发生」**（verifier 首次 `node -e` 被 PowerShell 吞掉 ⇒ **没替换却报 exit 0**）。
- **「给数须标抽样/全量」**（impl-c 的 4 样本外推成 56 全量，被 verifier 全量普查推翻：真值 **10 CRLF / 46 LF**）。

---

## 六、须 CTO 追认 / 终裁（全部已登记，未代裁）

| # | 项 | 归属 |
|---|---|---|
| R1 | 权威文档01 **3 源 2 值**分歧 4 条（E-08/E-10/E-11/E-12）：**第二章 vs（第一章 §1.9 ∩ 第四章）**；第二章对 E-12 **自身也不自洽**。其中 **E-10/E-12 两版候选均 ∉ 词表** | CTO |
| R2 | `§3.5.1` 主张 `{minMonths,maxMonths}` **对象形态** vs 既有门禁要求非空字符串 | CTO |
| R3 | `1_month ⇒ [0.5,1]` 为**推导值**（CTO 明文只给 `immediate ⇒ [0,0.5]`）；理由 = 保「区间→桶」换算唯一性 | CTO 追认 |
| R9 | doc15 内 `actionEffectLag` **三源互斥 3 条**（E-23/E-25/E-37） | CTO |
| R10 | 第一章附录A 中文名与权威表英文 label ≥2 处不可对应（E-20/E-22） | CTO |
| **R11** | **队长越界改 `201.yaml`/`345.yaml`** ⇒ 追认 + **转规则**（`claim_store.py --repair`，带 dry-run，**转义 `\"` 而非删引号**） | CTO 追认 |
| R12 | `memory/notes/README.md` 契约与 262 件实践形态不一致（21 件列表形 / 109 件行首 `状态:` / 23 件英文 `status:`） | CTO |
| R16 | **F1 达 4 例** ⇒ 规则化四元组 | CTO |
| R18 | **F2 达 2 例** ⇒ 判据带边界 + 命中打全文 + 反向造红 | CTO |
| R23 | **#65 B 段的 N3/N4 命名认领**未到 ⇒ 两件新边名按 `goal_decomposes_to` / `plan_commits_to` 拟名并全程标「待 N3/N4 确认」 | CTO |
| **U8** | **#234 卡面 Done ②「8 条能对上的逐条对齐」 vs 裁定 (a)（E-17/E-38 回退 `unknown`）** ⇒ 口径缺口，impl-b 已登记反方依据未埋 | **CTO 终裁** |
| **U13** | **门禁依赖的声明载体（brief）不在执行者写集内** —— #234/#235 **两次**撞此墙 ⇒ 同类第二次 ⇒ 提请立规则：(a) 当日 brief 创建权显式归属执行者；(b) claim 已含 writeset 时免 brief Q2 逐条 | **CTO 立规则** |
| U9 | `extensions/ontology/tags.json` 缺 `first_order`/`second_order`（存量缺陷；本地软提示、**CI strict 转红风险**） | CTO |
| U10 | loader 的 `prose_formula` **测不出**"已标定 vs 未标定"（13 公式与 39 `unknown` 同分类，`injectable:false`） | CTO（已写入 #235 件 B2） |
| V-6 | `probe-cycle-edges` **无任何自动执行链**（pre-commit/CI 零命中；登记件消费方只校验不执行 `run:`）⇒ 恒绿隐患 | 另案 / CTO |
| — | 权威表 **7 个 E 号无 `$id` 落点**（E-01/04/06/30/34/35/37）= **19 条待裁的运行时后果**（已卡住 6 件循环的 7 个阀位） | CTO |
| — | **两套本体词表并存**（`extensions/ontology/` 56 JSON vs `packages/ontology/src/` 常量 52） | CTO |

---

## 七、未完成项

**无。** 六卡全部交付。

### 七bis、#65 B 段落地实测（队长独立验证，`a7437498c`）

```
$ git ls-tree -r --name-only a7437498c -- extensions/ontology/edge-types/ | wc -l   → 58（56 + 2）✅
$ git diff --name-only ba1b22a8b5..a7437498c                                        → 9 条（= 锁定写集，零多出零缺失）✅
两件新边 $id/label/lag/tf：edge/goal_decomposes_to[GOAL_DECOMPOSES_TO] unknown/unknown
                          edge/plan_commits_to[PLAN_COMMITS_TO]       unknown/unknown
```
**description 已含**（逐字）：方向声明（父→子 / 计划→目标）｜**不复用 GOAL_DECOMPOSITION 的理由**（R8，避免污染 `consumed_by`）｜端点字面量声明（本体词表无 goal/plan ⇒ 运行时字面量，将来建须迁移）｜**双枚举 `["GOAL","Goal"]` 依据**（SQLite type 大小写敏感 + 两个生产写入方 + `GOAL_NODE_TYPE_LOCALS` fail-closed）｜`unknown` 而非 `TBD` 的理由（#235 全域 `TBD=0` + 铁律 8）｜**⚠️ 命名待 N3/N4 认领确认**。
**`PLAN_COMMITS_TO` 的 subject 侧**已**如实声明**「`src/` 内不存在 `'PLAN'` 节点字面量（3 处命中全为注释）⇒ 该端点属 #1316 将建；本边只声明端点、不主张已有写入方」—— **禁凭名字推** 已落实。

**三条判据各自有反向造红**：V1 由 **H2**（2 件 × 3 型注入 = 6/6 变红 + 阴性对照）｜V3 由 **B5**（把 A1 断言施加到缺件沙箱 ⇒ **必抛**；期望改 57 ⇒ 不抛 = **自足证明**）｜块级由**删字段造红 → 口径 W SHA256 逐字节一致**（`1d145c49…`）。

**🔴 落盘撞到的 3 道门禁（根因全在 impl-c，已修并留痕）**：
`## 写集` 必须是 **Markdown 表格**（写成代码块+bullet ⇒ 反引号包裹 ⇒ 恒不中）｜`Done` 必须是 **`- [x] verify:` 行**｜`<!--` 行**必须含 `#CRITERIA`**。
> **A 段 8 笔为何没撞**：A 段 staged 全为 `.claude/`+`docs/` ⇒ 组 12 的 `skip_re` 跳过、且走纯 docs 快速通道**跳过 plan-integrity** ⇒ **"没被检查"不等于"没错"**。

**🔴 NEW-1（跨件增量，归 L2/R-2，impl-c 零写、已如实登记）**：新件 `transfer_function="unknown"` **不被** #1031 桥的 placeholder/declaration 正则命中 ⇒ 判 **`prose_formula`** ⇒ `tests/l4/ontology-loader-param-bridge-1031.test.ts` 的 `BASELINE_TALLY` 将 **`tf_prose: 3 → 5`**（`tf_placeholder` 保持 53、`tf_edges` 56→58）。
**NEW-2**：`manifest.json` 的 `description` 散文「(17)/(14)」为存量表述，**本卡不动**（CTO §5 只裁定 `edgeTypes` 字段）。

**口径 5 条逐条落地**：桶 **6/5 带口径**（#65 零桶数、不入判据）｜新边 lag/tf = **`unknown`**｜`manifest.edgeTypes` = **实测 58**｜**落组实测确认**（本卡 2 件 **blob 纯 LF ⇒ 落 LF 组，现 48/58**；"与 53 件 CRLF 同形态"的旧方向**已订正留痕**）｜**跨域单 PR 显式声明**（已进交付件）。
**tsc 增量零**：BASE 与 HEAD 均 **29** 条，`Compare-Object` 差异为**空**（基线段用临时 worktree + junction，**已 `rmdir` 摘除后 `remove`**，原 `node_modules` 完好）。

---

## 七ter、遗留的跨线增量（**唯一**待补动作）

`#65` 的 +2 件会让两件 L2 域的测试常量漂移 ⇒ **归 L2（impl-b），非缺陷**：
1. `tests/l4/edge-lag-unknown-degraded-1134.test.ts` 的 **`BASELINE_TOTAL 56 → 58`**（`BASELINE_DEGRADED` 不变：新件 lag = `unknown`）
2. `tests/l4/ontology-loader-param-bridge-1031.test.ts` 的 **`BASELINE_EDGE_TYPES 56 → 58`** ＋ **`BASELINE_TALLY.tf_prose 3 → 5`**（NEW-1）
> 队长裁定：该两件归 L2 先改（同文件同一时间只有一个写者）。**合并顺序建议：L2 补这笔 → 再合 #65**。

---

## 八、治理件索引（`k4b3/lead`，6 笔）

| 件 | 内容 |
|---|---|
| `K4-b3-premise-freeze-20261012.md` | 前提逐条实测 + 写集互斥 + 冲突扫描 + 自纠 2 条 + 读数口径自纠（c-8） |
| `K4-b3-correction-238-distinct.md` | **#238 判据①口径更正**（工作令 §二① 反向错误，以仓内裁定件 blob `59c9a838c` §三第 1 行为准） |
| `K4-b3-crosswalk-238.mjs` / `.txt` / `.record.mjs` | 四套编号可映射性底稿（**可复算**：verifier 在干净副本重跑，产物 SHA-256 与提交件**完全相同**） |
| `K4-b3-lead-closeout-20261012.md` | 收尾件 ①②③ + §七bis 自陈订正 + R1–R22 升级/规则台账 |
| `memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md` | 治理脚本区变更的决策 Note（blob `b7fd9e1a0…`，**lead / 238-239 / 234 三支同 blob**） |
| `.claude/claims/201.yaml` / `345.yaml` | **越界修复件**（仅结构；见 R11） |

---

## 九、结论用语（**队内只说「自验结论」**）

- `#238`：**可提请独立审计**（判据面 8 项已独立复核；V-5 vitest 记 b、V-6 另案）
- `#239`：**可提请独立审计**（待 verifier 出件；自验已过）
- `#234`：**可提请独立审计**（8/8 逐条；附 2 处改字级 + U8 提请终裁）
- `#235`：**可提请独立审计**（`K4-b3-VERIFY-235.md` 已出；附 2 处改字级）
- `#65`：**A＋B 段已交付**（V1/V2/V3 各有实测 + 各自反向造红）⇒ **卡面 Done 达**；独立复核待出（verifier 下一轮）
- `#66`：**已落地（PR #392），按现状重判关卡**

**⇒ 六卡全部交付，全部标 `可提请独立审计`（#65 的独立复核件待出）。**

⇒ **通过与否归 CTO 收件闸 + K3 终审。合并权在 CTO，本队不合并。**

---

*本件为暂停收口版。所有数字来自命令原始输出，可按文中命令复算。*
