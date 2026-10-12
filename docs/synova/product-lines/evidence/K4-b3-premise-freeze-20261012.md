# K4 批 3 · 队长前提冻结与冲突扫描

- 批次：K4 批 3（收尾六卡）
- 对象：K4 批 3 执行小队（队长 = synova-squad-lead）
- 日期：2026-10-12
- **交付仓**：`D:\synova-wt`（remote = `http://192.168.1.7:3000/synova-agent/SynovaAgent.git`，LAN Gitea）
- **base 一律**：`local-main` 远端 tip = `ba1b22a8b5ff75833704bac22fcfcb47295dc970`
- diff 左端一律 = `ba1b22a8b5`（全文所有 `git diff --name-only` 均以它为左端）

> 本件是 M1/M2 的证据件：**前提逐条实测** + **写集互斥** + **冲突扫描**。
> 纪律：数字全部来自命令原始输出，禁手写；引用用稳定锚点，不用行号。

---

## 〇、开工前必须实测的「事实性前提」逐条裁决

工作令（CTO 2026-10-12 开工令）§二 给了 5 条「前置口径更正」。逐条实测如下。

### 前提 1 — ❌ **不成立**（工作令此项为反向错误）

**工作令原文**（§二①）：
> `#238` 判据① 期望值已证伪：`occurrences=45 distinct=15 hit=15 miss=0`
> ⇒ 实测 distinct 三口径**全为 17**（edgeRefs-only / edgeId-only / 并集）
> ⇒ 开工前先把判据改成实测口径并写明"改动来源=独立复核 C8 硬伤"，再开工

**实测**：
```
$ git rev-parse origin/local-main
ba1b22a8b5ff75833704bac22fcfcb47295dc970

# 口径声明：读 ba1b22a8b5 的 git 对象（不 checkout）；
#   口径A = cycles/**/*.cycle.json 的 nodes[].edgeRefs 值集合
#   口径B = 同文件的 mapping[].edgeId 值集合
#   口径C = A ∪ B
口径A edgeRefs-only       occurrences=22 distinct=15
口径B edgeId-only         occurrences=23 distinct=15
口径C 并集                occurrences=45 distinct=15
未命中 $id∪label 的 distinct = 0
```

**⇒ 三口径全为 15，不是 17。工作令该项与实测相反。**

**反证（仓内可引原件，B4 已满足）**：`docs/synova/coordination/K4-审计定稿与卡面全套.md`
（在 `local-main` 上存在，blob = `59c9a838ce202d18bff4c1b444e3d33d7f1b2b71`）
§三 第 1 行**逐字**：

> `| 1 | 45 条引用 distinct **15** | 复核员 1 说「实测 17」—— 🔴 **该复核员错了**；第二个复核员 + CTO 自量（四口径）全为 **15** | **一律用 15**；并记教训：复核员之间会打架，只能以实测为准 |`

⇒ 工作令说的「独立复核 C8 硬伤」，指的正是**那个报 17 的被判错的复核员**。工作令把"被证伪的一方"当成了实测。

**「17」的来源解**（防止再次串号）：同件 §三 第 2 行写 `0/17`，其分母 **17 不是引用 distinct**，而是**经 golden 标签中介才能对上的 label 数**（`data/golden/wani-baby-v1.json` 的 `edges.E-x.y.label`）。两个数不同源。

**裁决（CTO 2026-10-12 当面确认）**：**用 15，撤销工作令 §二①**。交付件须写明「工作令 §二① 与仓内裁定件相反，以裁定件＋实测为准」。

---

### 前提 2 — ✅ **成立**

**工作令原文**（§二②）：
> 「E 号全部命中 edge-types 的 $id」实测 **0/17** —— `extensions/ontology/` 内**不存在 E 号**，55 个 $id 全是 `edge/<name>` 形式
> ⇒ 本卡实际是**新建**一张编号权威表（E 号 01 两位式 / x.y 私有式 → $id/label 双向映射），不是"对齐已有表"

**实测**：
```
$ git grep -nE 'E-[0-9]+(\.[0-9]+)?' -- 'extensions/ontology/**'
（0 处输出）

$ git grep -h '"$id"' -- 'extensions/ontology/edge-types/*.json' | Measure-Object -Line
56          # $id 总数
（前 3 例）
  "$id": "edge/assumption_triggered_reallocation",
  "$id": "edge/augments",
  "$id": "edge/brand_building",
```
⇒ E 号 = **0 命中**；`$id` 全为 `edge/` 前缀。**「不是对齐已有表、而是新建权威表」的结论成立。**
（唯一订正：件数实测为 **56** 而非 55 —— 见下条。）
（🔴 措辞订正，由 verifier 独立复现报 a-1 提出、队长复核确认：原文「56 个 `$id` 全是 `edge/<name>` 形式」**不精确**。
实测**名字部分的分隔符不统一**：含下划线 **45** 件、含连字符 **5** 件
（`edge/decision-concentrates` / `edge/external-assumption` / `edge/incentive-binds` / `edge/locks-in` / `edge/signal-transmits`）、单字 **6** 件。
⇒ 凡按「下划线」假设做切分/正则的实现，会**漏掉这 5 件**。）

---

### 前提 3 — ✅ **成立**，且工作令的「56 件」正确

**工作令原文**（§二③）：
> `extensions/ontology/edge-types/` **实测已 56 件**（第 56 件 goal_decomposition.json 由 local-main 18ed356f 引入；其 action_effect_lag 是**散文值**，非枚举）

**实测**：
```
$ git ls-tree -r --name-only ba1b22a8b5 -- extensions/ontology/edge-types/ | (endsWith .json)
56

$ git -C D:\synova-wt log -1 --format='%H %ci %s' 18ed356f
18ed356f877068d83fd92142f5fa095cdc42985f 2026-10-11 18:33:17 +0800 feat(k12-07): 目标一致（岗位↔公司可追溯，断开分解边必红）

action_effect_lag 取值分布（口径 = 读 edge-types/*.json 的该键，值原样）
  x50  unknown
  x2   3-6_months
  x1   immediate
  x1   1_month
  x1   1-3_months
  x1   0d — 分解关系为结构性从属（子目标一旦建立即属该上级），不承载跨期传导时滞
```
⇒ 56 件 ✅；`goal_decomposition.json` 的 `action_effect_lag` 确为非枚举**散文值** ✅。
（`1_month` 是权威文档15 §3.4 的**合法桶标签**，不计散文；散文值实测 **1** 条。）

**派单件基数漂移订正**：#65/#66 卡面写「词表 55→57」；真基线 **56 件** ⇒ 执行段须按实测基数重钉（详见 §三）。

---

### 前提 4 — ✅ **成立**

**工作令原文**（§二④）：
> `#239` CTO 裁定：**新增 `valves` 字段，不覆盖既有 `edges[]`**（同名不同物）；**`src/cycles/cycle-types.ts` 必须进写集**

**实测**（接线缺口为真）：
```
$ git grep -n 'Valve' -- 'src/**'
（0 处）

$ git grep -n 'actionEffectLag\|action_effect_lag' -- 'src/**'
（0 处）

# src/cycles 文件数 = 9，逐个读内容后 Valve/valves/actionEffectLag 命中 = 0
```
⇒ 五阀/时滞在 `src/` 内**零消费**，铁律 0-2 接线门禁为**真缺口**（不是"已接线只是没 grep 到"）。

---

### 前提 5 — ✅ **成立**（但两处点名需补正，见 §三）

**工作令原文**（§二⑤）：
> `#234`/`#235` 直接按**现有卡面 Done** 执行（不作降档、不改卡面）

**实测相关基数**：
```
transfer_function 总数 = 56
其中 TBD 条数 = 52   （distinct TBD 形态 1）
非 TBD 4 条 = brand_builds / couples / cumulative_learning（3 条真公式）
            + goal_decomposition（结构性从属说明）
```
⇒ 与卡面「52 条 TBD」一致 ✅。

**需补正处**：卡面 Done 写「§3.5.1 覆盖的 8 条中**对不上的 4 条**」，但**未点名是哪 4 条**；
且 CTO 值域裁定（仓内 `K4-审计定稿与卡面全套.md` §三bis ⑤）另写「§3.5.1 表**漏登 3 条**（E-05 / E-13 / **E-28 CROSS_FUNCTIONAL_SYNERGY**）」。
两者是**不同的集合**，卡面未说明。已按「不许猜」派给 impl-b 先判定、判不出即上报。

---

### 前提 6（工作令 §五 前车之鉴 A 类）— 本机环境实测

| 项 | 实测 | 说明 |
|---|---|---|
| 交付通道 | TCP `192.168.1.7:3000` = `TcpTestSucceeded: True`；HTTP 匿名 = `401`（私有仓，需凭据） | 通道**活着** |
| git 凭据 | `credential.helper = manager`；`git ls-remote --heads origin` 返回 **982** 行 ⇒ 已认证 | 可 fetch/push |
| `local-main` | `git ls-remote` → `ba1b22a8b5...\trefs/heads/local-main` | **钉 SHA，不钉分支名**（A5） |

---

## 一、🔴 工作令「交付仓」指向错误（本批最大前置风险，已纠正）

工作令文本指向 `D:\novis-backup-20260526\Novis\synova-agent` 的 `local-main`。**该仓不是交付仓**：

```
$ git -C D:\novis-backup-20260526\Novis\synova-agent remote -v
origin  git@github.com:tangbaobao520/SynovaAgent.git (fetch)
origin  git@github.com:tangbaobao520/SynovaAgent.git (push)

$ git -C D:\novis-backup-20260526\Novis\synova-agent ls-remote --heads origin main
ERROR: Your account is suspended. Please visit https://support.github.com for more information.
fatal: Could not read from remote repository.

$ git -C D:\novis-backup-20260526\Novis\synova-agent rev-parse local-main
fatal: ambiguous argument 'local-main': unknown revision or path not in the working tree.
（该仓 refs 内不存在 local-main —— 实测 for-each-ref 零命中）
```

⇒ 该仓指向 **GitHub**，且账号被挂起、`local-main` 分支不存在。
**真交付仓 = `D:\synova-wt`**（remote = LAN Gitea，982 refs，已认证）。
其工作树 HEAD = `ed63e2086`，经 `git merge-base` 实测为 `ba1b22a8b5` 的**祖辈**（`rev-list --left-right --count origin/main...HEAD` = `0  87`，即 0 ahead / 87 behind）⇒ 工作树**陈旧**，不是分叉。

> 该错若未纠，全队会在一个**无法推送**的仓里做完 6 卡，然后在交付时整体失败。

---

## 二、🔴 工作令未记载：一批卡片已落地（防止重做）

按「动对象前先问有没有人在搬它」（C6）与「已落地不重做」实测：

| 卡 | 状态 | 证据（实测） |
|---|---|---|
| **#66 / #1412 守卫收口** | **已实现并合入 local-main** | `git log --oneline --all --grep='#1412'` → `1ab0cbb33 Merge PR #392`；feat commit `d180632d6` / `d87b1ce3b`「守卫收口补全 —— 适配器**默认带守卫**（(C) 案）+ 显式 opt-out」 |
| #66 走的是**另一条路径** | ⚠️ 与工作令 §四⑥ 要求不同 | 已落地件写集 = `src/adapters/sqlite-graph-store.ts` + `tests/adapters/standard-key-guard.test.ts` + `tests/agent/write-side-axis-alignment.test.ts` + `.claude/task-briefs/2026-10-08-1412-adapter-default-guard.md` + `.claude/claims/1412.yaml`；工作令要的是 `src/init/engine-context.ts` 第二收口点 + `src/ingest/index.ts` 2 处自建 store |
| #66 已有自己的 brief | ⚠️ 与工作令「#66 无 brief，先补卡面」冲突 | `.claude/task-briefs/2026-10-08-1412-adapter-default-guard.md` 已在 `local-main` 上 |
| **#239 的前置 #1134** | **已合并** | `git log --grep='1134'` → `0b0601fac Merge PR #362: fix(1134): K4-01 时滞 unknown`；另 `bfea3acf1 fix(1134): 时滞棘轮上移 55→56` |
| 其余五卡 | **均未落地**（可开工） | `scripts/control-tower/probe-cycle-valves.ts` / `docs/synova/coordination/numbering-authority.md` / `tests/coordination/numbering-authority.test.ts` / `scripts/control-tower/probe-ontology-values.ts` / `tests/ontology/edge-lag-values.test.ts` / `tests/ontology/edge-transfer-functions.test.ts` / `tests/cycles/valve-mapping.test.ts` 在 `ba1b22a8b5` 上**全部 absent**（`git cat-file -e` 逐个实测） |

**裁决（CTO 2026-10-12 当面确认）**：
- #66 **不实施**（已落地，不重做）；改为出「现状核验件」，由 CTO 据以决定关卡或另立新卡。
- #65 仍按卡面执行，但**须先补卡面**并按实测基数重钉判据。

---

## 三、写集互斥与冲突扫描（M2）

### 3.1 写者是「独立目录」，不是「分支」

各成员走独立工作树（`git worktree` 共享同一 object store，但工作目录完全隔离）：

| 成员 | 工作目录 | 分支 | base |
|---|---|---|---|
| impl-a | `D:\k4b3-l1-238-239` | `k4b3/l1-238-239` | `ba1b22a8b5` |
| impl-b | `D:\k4b3-l2-234-235` | `k4b3/l2-234-235` | `ba1b22a8b5` |
| impl-c | `D:\k4b3-l3-65` | `k4b3/l3-65` | `ba1b22a8b5` |
| verifier | `D:\k4b3-verify` | `k4b3/verify` | `ba1b22a8b5` |
| 队长 | `D:\k4b3-lead` | `k4b3/lead` | `ba1b22a8b5` |

`D:\synova-wt`（主工作区）**不写码**，只作同步与协调。

### 3.2 写集两两交集检查

**✅ 零重叠**。逐条裸路径（禁 glob）见任务板 task-1 / task-2 / task-3 与队长件。
要点：
- L1 只碰 `cycles/**`、`src/cycles/**`、`docs/synova/coordination/numbering-authority.md`、`scripts/control-tower/probe-cycle-*.ts`、对应 tests、`docs/synova/GLOSSARY.md`
- L2 只碰 `extensions/ontology/edge-types/**`、`scripts/control-tower/probe-ontology-values.ts`、`tests/ontology/**`
- L3 只碰 `.claude/task-briefs/**`、`.claude/claims/1350.yaml` 与该线 evidence
- 队长只碰本批治理件（见 3.3）

**⚠️ 已登记的重叠告警（advisory，非真冲突）**：任务板对 task-3 与 task-4 报了
`write scopes overlap with task-3`，因两者都写了目录前缀 `docs/synova/product-lines/evidence`。
**文件名级实测不相交**：task-3 写 `K4-b3-1350-*` / `K4-b3-1412-status-recheck.md`；
task-4（复核员）只写 `K4-b3-VERIFY-*`。已在本件登记，不在执行层制造阻塞。

### 3.3 队列内的串行（有依赖就老实串行）

| 关系 | 依据 | 处置 |
|---|---|---|
| #239 依赖 #238 | 卡面明文；两卡同线 | 同线内串行（impl-a 先 #238） |
| #235 依赖 #234 | 两卡**共写** `scripts/control-tower/probe-ontology-values.ts` | 同线内串行（impl-b 先 #234） |
| #65 与 #234/#235 **同目录** | 都写 `extensions/ontology/edge-types/` | 🔴 **跨线串行**：impl-c 收到队长「放行」信号前**不得写入该目录** |
| #234 ↔ #239 的 edge-types 读写 | L2 写 edge-types；#239 的 `actionEffectLag` 需与本体词表对齐 | 本批**按独立卡处理**，#239 不读 edge-types 新值；若 impl-a 判断需读，报队长 |

### 3.4 关键对象冲突扫描（全量输出）

```
$ git grep -n 'probe-cycle-valves\|probe-ontology-values\|numbering-authority' -- src/ scripts/ tests/
（0 处 —— 三个新建件在本仓均为首次引入，无既有引用方，不会撞车）

$ git grep -rn 'Valve' -- src/ cycles/ extensions/
（0 处 —— 五阀为全新语义，无既有占用）

$ git grep -c '"action_effect_lag"' -- extensions/ontology/edge-types/
56 件全部命中（字段已存在，本卡只改值，不改形状）
```

---

## 四、本批治理件写集（队长）

```
docs/synova/product-lines/evidence/K4-b3-premise-freeze-20261012.md   （本件）
docs/synova/product-lines/evidence/K4-b3-correction-238-distinct.md
docs/synova/product-lines/evidence/K4-b3-lead-closeout-20261012.md
.claude/claims/238.yaml
.claude/claims/239.yaml
.claude/claims/234.yaml
.claude/claims/235.yaml
.claude/claims/1350.yaml
```
（与四个成员写集**零重叠**；`claims/*.yaml` 属每卡归属登记，按卡拆分、一卡一文件，无同文件并发写。）

---

## 五、未决项（本件落笔时）

| # | 未决项 | 归属 |
|---|---|---|
| U1 | #234 卡面 Done「4 条无同标签边」未点名是哪 4 条；与 CTO 值域裁定「§3.5.1 未覆盖 3 条」是否同一集合未定 | impl-b 先判定；判不出 → 队长 → CTO |
| U2 | ~~权威文档15 第三章正文不在本仓~~ **已由 impl-b 实测否证（队长自己的前提错了）** ⇒ 见 §六 更正 | 已更正 |
| U3 | #65 执行段需在 #234/#235 之后（同目录串行）⇒ 本批 L3 可能跨轮次完成 | 队长调度 |
| U4 | #66 剩余面（`engine-context` 第二收口点 + 2 处自建 store）是否另立新卡 | CTO |

---

*本件为队长前提冻结件；所有实测均可按上列命令复算。*

---

## 六、🔴 队长自纠：本件 U2 的原判为假（由 impl-b 实测否证）

**本件 §五 U2 曾写**「权威文档15 第三章正文不在本仓」。**该判定为假，系队长测量错误，特此更正。**

**错在哪**：队长用目录名 `权威文档15-投入建议引擎` 去找，**目录名实际是 `权威文档15-企业循环溢出导航系统-20260714`**（"投入建议引擎"只是第三章的**文件名**片段，不是目录名）。用错目录名 ⇒ `git ls-tree` 零命中 ⇒ 误判为"不在仓"。

**实测（impl-b 提出并由队长复核）**：
```
$ git cat-file -e ba1b22a8b5:docs/synova/research/权威文档15-企业循环溢出导航系统-20260714/SYNOVA-RESEARCH-第三章-投入建议引擎-v1-0-20260714.md
exit=0        # 存在

$ git cat-file -p <该路径> | Select-String '^### 3\.5\.1'
### 3.5.1 滞后时间的数据来源

# §3.5.1 表原文（逐行）
| 边 ID | 边名称 | minMonths | maxMonths | 依据 |
| E-07 | TALENT_ACQUISITION | 1 | 3 | 招聘周期：发布→入职→上手 |
| E-15 | HUMAN_DEPLOYMENT | 1 | 3 | 人岗匹配：入职→培训→独立产出 |
| E-17 | INCENTIVE_ALIGNMENT | 0.5 | 1 | 激励效果：KPI调整→行为变化 |
| E-23 | OPERATIONAL_EXECUTION | 0 | 0.5 | 运营调整：决策→执行变化（实时） |
| E-38 | TALENT_RETENTION | 3 | 6 | 人才留存→知识保护→组织能力 |
| E-25 | BRAND_CONSTRUCTION | 6 | 12 | 品牌建设：投入→市场认知变化 |
| E-24 | INNOVATION | 6 | 18 | 创新：研发投入→产品上市 |
| E-37 | PROFIT_REINVEST | 3 | 9 | 利润再投资→效果显现 |
```

**后果与处置**：
1. §3.5.1 可直接引**一手原文**（不需经 `K4-审计定稿与卡面全套.md` 转引）⇒ **U2 关闭**。
2. 8 条数值与 CTO 裁定 §三bis 的引文**逐字一致** ⇒ 两条独立路径互证，裁定依据更硬。
3. 🔴 **新发现的形态分歧（本件新登记）**：§3.5.1 同节末注原文写
   `action_effect_lag: { minMonths: number, maxMonths: number }`（**对象形态**），
   与 CTO 裁定的 `[min, max]`（**字符串区间**）**不同源**。
   落地证据：`scripts/control-tower/check-ontology-fields.sh` 与 `src/l4/ontology-loader.ts`
   均要求该字段为**非空字符串** ⇒ **对象形态会撞红两道既有门禁**。
   **队长裁定**：按 CTO 裁定的字符串区间落地（`"[min,max]"`），并在交付件显式登记
   「§3.5.1 主张对象形态，本次因既有门禁约束采字符串区间；形态统一属另案」。
4. **教训入档**（同族第二次 ⇒ 按纪律升级 CTO）：本件是队长**第三次**在"用错路径/口径去验证"上出错
   （前两次见 A1 类历史）。共同根因 = **用"我以为的名字"去取对象，零命中即当作"不存在"**，
   而未区分「零命中」与「不存在」。**对策**：凡"某物不存在"类判定，**必须同时贴出正向枚举**
   （如 `git ls-tree` 该父目录的全量清单），证明"我找的是对的目录"，否则不得写成"不存在"。
