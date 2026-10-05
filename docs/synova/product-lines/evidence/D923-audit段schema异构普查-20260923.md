# D923 前置证据 ③：`task-state/*.json` 的 `audit` 段 schema 异构普查（CTO 裁定 8）

- **卡号**：D923（K3 必经合并门禁）
- **证据件**：裁定 8「枚举 audit 段 → 形态计数 + 字段名清单 + 含/缺 audit 段计数 + 缺段有报告的卡 → 统一 schema 建议 + backfill 清单」
- **测量时刻（截至）**：**2026-09-23T16:48+0800**（本地时）＝ 2026-09-23T08:48Z
- **被测仓库态（截至上述时刻）**：`main` @ `967a58e58292f4de3d49ad61ee263a357d88feac`，工作区干净
- **执行人**：d923-prep（编码成员）
- **方法**：`python3` 读 `task-state/*.json` 全集（`glob` 显式目录，未用裸 `find`），计数来自脚本原始输出；报告面用 `glob('docs/synova/audit-reports/*.md')` + 文件名派生 D#
- **性质**：**只给事实 + 实测值 + 建议**。本文件**不下「通过 / 不通过」结论**。

---

## 一、总览（原始输出）

```
$ python3 - <<'PY'   # 见附录 §九 脚本
total json files: 347
has audit: 345   no audit: 2
audit=dict: 164  audit==null: 181
PY
```

| 项 | 数量 |
|---|---|
| `task-state/*.json` 总数 | **347** |
| 含 `audit` 键 | **345** |
| — 其中 `audit` 为 **dict（有结论）** | **164** |
| — 其中 `audit` 为 **`null`（显式无结论）** | **181** |
| **不含 `audit` 键**（键缺失） | **2** |

```
$ git ls-files task-state/*.json | wc -l
347
$ git ls-files 'task-state/*.json' | wc -l   # 与 untracked 对照
347
$ git ls-files --others --exclude-standard 'task-state/*.json' | wc -l
0
```

**「无 K3 结论」的卡合计 = 181 + 2 = 183**（裁定 3 的第 ③ 态「K3 无结论 → 红 + 排队中」）。

**非 D# 卡（2 张，混在 183 内）**：`task-state/TEMPLATE.json`（`task_id: "TEMPLATE"`，`audit: null`）与 `task-state/ct-64.json`（`task_id: "CT-64"`，`audit: null`）。

> **Windows 大小写坑（顺手实测）**：磁盘上 `ls` 显示 `task-state/CT-64.json`，但 `git ls-files` 记录的是**小写** `task-state/ct-64.json`（`git ls-files | grep -c 'task-state/CT-64.json'` = **0**，`grep -c 'task-state/ct-64.json'` = **1**）。macOS 大小写不敏感掩盖了这一点，**Windows runner 上按大写路径读会 ENOENT** —— 与 windows-compat 技能同族。

**键缺失的 2 张卡（逐卡）**：

| 文件 | `task_id` | audit 键 |
|---|---|---|
| `task-state/D531.json` | D531 | **不存在** |
| `task-state/D532.json` | D532 | **不存在** |

---

## 二、形态计数：`audit` 段键签名（**33 种形态**）

```
$ python3 - <<'PY'   # signature = tuple(sorted(audit.keys()))
（原始输出）
181	__NOT_DICT__:NoneType
76	('at', 'by', 'note', 'report', 'verdict')
37	('at', 'blockers', 'by', 'findings', 'report', 'verdict')
7	('at', 'by', 'report', 'verdict')
4	('at', 'by', 'p2', 'report', 'verdict')
3	('at', 'by', 'findings', 'report', 'verdict')
3	('auditor', 'conditions', 'date', 'findings', 'report', 'slice', 'verdict')
3	('at', 'blockers', 'by', 'findings', 'reaudit', 'report', 'verdict')
2	('at', 'by', 'findings', 'note', 'report', 'verdict')
2	('auditor', 'date', 'recheck', 'report', 'verdict')
2	('auditor', 'date', 'report', 'verdict')
2	('at', 'by', 'note', 'verdict')
2	('at', 'by', 'p1', 'p2', 'report', 'verdict')
2	('at', 'baseline', 'by', 'p1', 'p2', 'report', 'rerun', 'verdict')
1	('at', 'by', 'note', 'result')
1	('at', 'by', 'p1', 'priority', 'report', 'verdict')
1	('at', 'by', 'ci_note', 'p1', 'p2', 'report', 'verdict')
1	('at', 'blockers', 'by', 'report', 'verdict')
1	('at', 'by', 'conditions', 'notes', 'report', 'verdict')
1	('at', 'by', 'p1', 'p2', 'prior_report', 'report', 'verdict')
1	('at', 'by', 'p2', 'prior_report', 'report', 'verdict')
1	('at', 'by', 'conditions', 'notes', 'prior_report', 'report', 'verdict')
1	('at', 'by', 'findings', 'fix_route', 'report', 'verdict', 'verdict_history')
1	('at', 'by', 'findings', 'north_star', 'recheck_note', 'report', 'verdict')
1	('auditor', 'date', 'evidence', 'report', 'summary', 'task_id', 'verdict')
1	('date', 'evidence', 'report', 'result', 'verdict')
1	('at', 'auditor', 'by', 'date', 'findings', 'note', 'p1', 'p2', 'report', 'scope', 'verdict')
1	('audit_base', 'audited_at', 'audited_by', 'closed_items', 'evidence', 'l4_gap', 'p0p1p2', 'summary', 'uncovered', 'verdict')
1	('audited_at', 'auditor', 'p0p1p2', 'report', 'summary', 'verdict')
1	('at', 'branch', 'by', 'p0', 'p1', 'p2', 'report', 'summary', 'verdict')
1	('auditor', 'date', 'merge_ruling', 'report', 'summary', 'verdict')
1	('audited_tips', 'auditor', 'baseline', 'boundaries_not_blocking', 'date', 'findings', 'next_action', 'report', 'scope', 'verdict', 'verified_true')
1	('at', 'auditor', 'evidence_summary', 'merge_gate', 'p0', 'p1', 'p2', 'report', 'verdict')
```

**校验**：`181×1 + 76×1 + 37×1 + 7×1 + 4×1 + 3×3 + 2×6 + 1×19 = 345`，与 §一「含 audit 键 345」一致。组数 = `1+1+1+1+1+3+6+19 = 33`，即签名形态合计 **33 种**（含 `NoneType` 一种）。

**头部（支配形态）**：`{at, by, verdict, report}` 及其超集覆盖 **164 张 dict 卡中的绝大多数**；`('at','by','note','report','verdict')` 单形态占 76 张（**46%**）。

---

## 三、字段名族计数（`audit` 为 dict 的 164 张卡）

### 3.1 审计者（身份）字段名

```
$ python3 ...   # 统计 ('by','auditor','audited_by') 的存在组合
149	by
 12	auditor
  1	by+auditor                 ← 同卡两套命名并存
  1	audited_by
  1	<none>                     ← task-state/D815.json 无任何审计者字段
```

**实测 4 种命名 + 1 张无身份字段。**

### 3.2 时间字段名

```
150	at
 11	date
  1	at+date                    ← 同卡两套命名并存
  1	audited_at+audit_base
  1	audited_at
```

**实测 5 种写法（`at` / `date` / `audited_at` / `audit_base`，及并存）。**

### 3.3 判定字段名

```
161	verdict
  1	result
  1	verdict+result             ← 同卡两套并存
  1	verdict+merge_ruling
```

**实测判定键 3 种：`verdict`(161) / `result`(1) / `merge_ruling`(1)。**

### 3.4 全字段名清单（出现 ≥1 次，去重共 **46 个**）

```
$ python3 ...   # Counter over all audit dict keys
163 verdict          52 findings          5 conditions        2 scope
160 report           41 blockers          5 summary           2 audited_at
151 at               14 p2                3 slice             2 p0p1p2
150 by               13 auditor           3 reaudit           2 p0
 82 note             12 date              3 prior_report      1 priority
                     10 p1                3 baseline          1 ci_note
                                          3 evidence          1 verdict_history
                                          2 result            1 fix_route
                                          2 recheck           1 north_star
                                          2 notes             1 recheck_note
                                          2 rerun             1 task_id
                                                              1 audited_by
                                                              1 audit_base
                                                              1 closed_items
                                                              1 uncovered
                                                              1 l4_gap
                                                              1 branch
                                                              1 merge_ruling
                                                              1 audited_tips
                                                              1 verified_true
                                                              1 boundaries_not_blocking
                                                              1 next_action
                                                              1 evidence_summary
                                                              1 merge_gate
```

> 说明：上表为**字段出现次数**（同一字段在多张卡出现即累加），不是卡数；卡数见 §3.1–3.3。

---

## 四、`verdict` 取值分布（**10 种取值形态**）

```
$ python3 ...   # verdict 值 census（audit=dict 的 164 张）
123	'PASS'
 25	'CONDITIONAL PASS'
  5	'FAIL'
  3	'CONDITIONAL_PASS'
  2	'NOT-AUDITABLE'
  2	'pass'
  1	None
  1	'无 K3（V5.1.3 tag 锚点闭环）'
  1	'CTO 验收通过（非 K3）'
  1	'DONE'
```

**非标准取值的卡（逐卡，6 张）**：

```
task-state/D397.json	"NOT-AUDITABLE"
task-state/D398.json	"NOT-AUDITABLE"
task-state/D492.json	null
task-state/D533.json	"无 K3（V5.1.3 tag 锚点闭环）"
task-state/D536.json	"CTO 验收通过（非 K3）"
task-state/D715.json	"DONE"
```

**归一对三态（裁定 3）时必须处理的形态问题**：
1. **大小写**：`PASS`(123) vs `pass`(2) —— **2 张卡会被朴素 `== "PASS"` 漏判为「非绿」**。
2. **空格 vs 下划线**：`CONDITIONAL PASS`(25) vs `CONDITIONAL_PASS`(3) —— 两者同义，**必须都归「红」**（裁定 3：「有条件通过 = 未通过」）。
3. **非 K3 语义的 3 条自由文本**（D533 / D536 / D715）：它们**不是 K3 结论**，映射到三态中的哪一档需要 CTO 口径（按裁定 3 字面，无 K3 结论 → 第 ③ 态「排队中」）。
4. `NOT-AUDITABLE`(2) 与 `null`(1)：同属「无有效结论」。

**汇总（我的归一建议，供 CTO 裁）**：

| 归一档 | 组成 | 卡数 |
|---|---|---|
| 绿（PASS） | `PASS`(123) + `pass`(2) | **125** |
| 红（有条件/失败） | `CONDITIONAL PASS`(25) + `CONDITIONAL_PASS`(3) + `FAIL`(5) | **33** |
| 红（无结论/排队中） | `NOT-AUDITABLE`(2) + `null`(1) + 3 条自由文本 + `audit:null`(181) + 无 audit 键(2) | **189** |
| 合计 | | **347** |

---

## 五、报告面 vs 台账面的一致性（两面核对）

### 5.1 报告面（`docs/synova/audit-reports/`）

```
$ ls docs/synova/audit-reports/*.md | wc -l
68
$ git ls-files 'docs/synova/audit-reports/*.json' | wc -l
3      （全部为 D602 日志夹具，非审计报告）
```

```
$ python3 ...   # 文件名派生 D#
audit-reports/*.md 总数: 68
文件名可派生 D# 的报告数: 58
唯一 D# 数: 51
```

→ **10 个 `.md` 的文件名不含 D#**（批次/专题报告，逐条）：

```
2026-08-17-product-lines-verification.md
2026-08-22-P0-control-tower-stage1.md
2026-08-22-P1-gs-deploy-u.md
2026-08-22-P2-batch-audit.md
2026-09-02-productlines-17points.md
2026-09-08-K3-seven-task-batch-closeout.md
2026-09-08-K3-win-backlog-11-closeout.md
2026-09-18-K3-line10.md
AGENT-CAPABILITY-FULL-CHAIN-AUDIT-20260813.md
AGENT-INFRASTRUCTURE-AUDIT-20260814.md
```

→ **58 份报告派生 51 个唯一 D#**：说明**批次报告一文件覆盖多卡**，文件名派生法对「一文件多卡」会**漏配**（例如 `2026-09-20-K3-D850D852.md` 只派生 D850，D852 靠内容才可知）。

### 5.2 台账面（`audit.report` 指针）

```
$ python3 ...   # audit=dict 的 164 张卡
audit=dict 卡数: 164
audit.report 指向文件存在: 152
audit.report 指向文件不存在: 8
audit.report 为空/非字符串: 4
```

**`audit.report` 指向不存在的文件（8 张，逐卡）**：

```
task-state/D416.json	docs/synova/audit-reports/2026-08-17-K3-final-control-tower-console.md
task-state/D417.json	docs/synova/audit-reports/2026-08-17-K3-final-control-tower-console.md
task-state/D510.json	docs/synova/audit-reports/2026-08-24-D510.md
task-state/D514.json	docs/synova/audit-reports/2026-08-24-D510.md
task-state/D539.json	docs/synova/audit-reports/2026-08-27-D539.md
task-state/D600.json	docs/synova/audit-reports/2026-09-09-K3-L1收工批-closeout.md
task-state/D603.json	docs/synova/audit-reports/2026-09-09-K3-L1收工批-closeout.md
task-state/D870.json	docs/synova/audit-reports/2026-09-22-D870.md ｜ 报告分支 refs/heads/audit/k3-20260922-d870（基于 feat/d870-official-baseline-study @ e1af78f0，只含报告 + 本回填）
```

> **D870 那条是「路径字段被塞了自由文本」**：`audit.report` 的值是「路径 ｜ 说明」的混合串，不是纯路径 —— 这是 schema 异构的又一实证形态。

**`audit.report` 为空 / 非字符串（4 张）**：

```
task-state/D492.json	D492	report=None	派生报告=[]
task-state/D533.json	D533	report=None	派生报告=[]
task-state/D536.json	D536	report=None	派生报告=[]
task-state/D830.json	D830	report=None	派生报告=[]
```

**两面不一致（台账路径 ≠ 文件名派生报告，2 张）**：

```
task-state/D515.json	ledger=docs/synova/audit-reports/2026-08-28-D501-D550-impl-done-batch.md
                    	derived=['docs/synova/audit-reports/2026-08-24-D515.md']
task-state/D586.json	ledger=docs/synova/audit-reports/2026-09-08-K3-win-backlog-11-closeout.md
                    	derived=['docs/synova/audit-reports/2026-09-07-K3-D586-closeout.md']
```

两张卡各自指向**不同**的报告文件：台账写的是批次报告，文件名派生指向单卡报告。**两种都是真实存在的文件**，即「一个卡有两个报告面」—— 门禁若只取其一，结论可能不同。

---

## 六、缺 `audit` 段但有 K3 报告的卡（裁定 8 点名项）

判据：卡在「无结论」集合（`audit: null` 或键缺失）**且** `docs/synova/audit-reports/*.md` 文件名可派生该 D#。

```
$ python3 ...   # （见附录 §九 脚本 B）
count = 8
D558	task-state/D559.json	audit_key_present=True	['docs/synova/audit-reports/2026-08-29-D558-D561-reaudit.md']
D651	task-state/D651.json	audit_key_present=True	['docs/synova/audit-reports/2026-09-09-D651-dual-pipeline-quality-eval.md']
D819	task-state/D819.json	audit_key_present=True	['docs/synova/audit-reports/2026-09-19-K3-D819.md']
D839	task-state/D839.json	audit_key_present=True	['docs/synova/audit-reports/2026-09-20-K3-D839.md']
D850	task-state/D850.json	audit_key_present=True	['docs/synova/audit-reports/2026-09-20-K3-D850D852.md']
D854	task-state/D854.json	audit_key_present=True	['docs/synova/audit-reports/2026-09-20-K3-D854.md']
D862	task-state/D862.json	audit_key_present=True	['docs/synova/audit-reports/2026-09-21-K3-D862.md']
D864	task-state/D864.json	audit_key_present=True	['docs/synova/audit-reports/2026-09-21-K3-D864-复审.md']
```

**实测 8 张，其中 D862 / D864 与派单件点名一致（裁定 8 的两个例子均**成立**）。** 另 6 张（D558 / D651 / D819 / D839 / D850 / D854）为本次普查**新增发现**。

**派生口径的已知旁证（一处不吻合需点出）**：上表 `D558` 一行显示源文件是 `task-state/D559.json`（该文件 `task_id` 派生 D559，但文件名派生 D558 报告命中）—— 说明 **`task_id` 字段与文件名偶有不一致**，D# 派生需以 `task_id` 为权威、文件名兜底。

**这些卡的含义**：**K3 已经出过结论、报告已在库里，但台账（`task-state`）没有登记** → 三态门禁按台账判会把这些卡读成「排队中（红）」，**与事实不符**。这是「台账 vs 报告」两面分裂的直接后果。

---

## 七、统一 schema 建议（供 CTO 裁）

> 约束：① 不改 `scripts/audit/**`（红线）；② audit 段是 K3 的产出面，**本建议不编写审计标准**，只建议**字段载体**；③ 需向后兼容 345 张存量卡。

### 7.1 建议的最小统一 schema（`task-state/<D#>.json` → `audit`）

```jsonc
"audit": {
  "verdict": "PASS" | "CONDITIONAL_PASS" | "FAIL" | "NOT_AUDITABLE" | null,  // 枚举，单一取值
  "auditor":  "k3" | "kimi-k3" | "CTO" | "codex" | null,                     // 单一取值（合并 by/audited_by）
  "at":       "YYYY-MM-DD",                                                   // ISO 日期，单一取值
  "report":   "docs/synova/audit-reports/<file>.md",                          // 纯路径，禁自由文本
  "reports":  ["<path>", ...],                                                // 可选：一卡多报告（批次 + 单卡）
  "findings": { "p0": 0, "p1": 0, "p2": 0 },                                  // 可选：结构化的发现计数
  "note":     "<自由文本>"                                                     // 可选
}
```

**须显式废弃的形态（存量清理项）**：
- 身份字段别名：`by`(149) / `audited_by`(1) → 统一 `auditor`
- 时间字段别名：`date`(11) / `audited_at`(1) / `audit_base`(1) → 统一 `at`
- 判定字段别名：`result`(1) / `merge_ruling`(1) → 统一 `verdict`
- 大小写/下划线漂移：`pass`(2) → `PASS`；`CONDITIONAL PASS`(25) / `CONDITIONAL_PASS`(3) → `CONDITIONAL_PASS`
- 自由文本 verdict（3 张）→ 若要保留非 K3 语义，建议新增显式字段（如 `"audit": null` + `"note"`），**不要**塞进 `verdict`
- `report` 内嵌自由文本（D870 案）→ 拆分到 `report` + `note`

**兼容期做法建议**：读取方（D923 门禁）先按统一 schema 读，读不到再按别名回落（`verdict→result→merge_ruling`、`auditor→by→audited_by`、`at→date→audited_at`），并对每次回落**显式打日志**（铁律 11，禁静默降级）。

### 7.2 建议的 schema 校验方式（不含审计标准）

- 建议新增一个**纯结构校验器**（只查字段名/类型/枚举，不判结论对错）挂到控制塔测试门禁（`ct-test-gate.sh` 已有的家族），对**新增/修改**的卡做硬校验、对存量卡只告警。**这一条属新建，需 CTO 裁决是否纳入 D923 范围**——本件只提出，不主张。

---

## 八、Backfill 清单（逐卡）

### 8.1 汇总

| backfill 类别 | 卡数 | 建议动作 |
|---|---|---|
| A. `audit` **键缺失**（结构缺失） | **2** | 补 `"audit": null`（结构一致化，零判断） |
| B. `audit: null` 且**有**报告文件（可据报告回填结论） | **8** | 读报告 → 回填 `verdict/auditor/at/report` |
| C. `audit: null` 且**无**报告文件 | **173** | 属第 ③ 态「排队中」；是否回填需 CTO 派工（**不在本件范围**） |
| **合计（三类互斥且穷尽）** | **183** | 2 + 8 + 173 = 183 ✔ |
| D. verdict 值形态漂移（大小写/下划线/自由文本） | **11** | 归一（见 §8.5） |
| E. `audit.report` 指针坏 | **8** | 修指针（其中 D870 需拆自由文本） |
| F. `audit.report` 非字符串且台账外无报告 | **4** | 待查（D492/D533/D536/D830） |
| G. 身份/时间/判定字段别名统一 | 身份 **14** / 时间 **14** / 判定 **3** | 归一（见 §8.7） |

> D/E/F/G 与 A/B/C **可重叠**（一张卡可同时属 A 与 D），故其计数不与 183 相加。

### 8.2 A 类：`audit` 键缺失（2 张，全量）

| 文件 | task_id |
|---|---|
| `task-state/D531.json` | D531 |
| `task-state/D532.json` | D532 |

### 8.3 B 类：`audit: null` 但**已有** K3 报告（8 张，全量；★ = 裁定 8 点名）

| # | 卡 | 文件 | 现值 | 报告文件 |
|---|---|---|---|---|
| 1 | D558 | `task-state/D559.json` | `audit: null` | `docs/synova/audit-reports/2026-08-29-D558-D561-reaudit.md` |
| 2 | D651 | `task-state/D651.json` | `audit: null` | `docs/synova/audit-reports/2026-09-09-D651-dual-pipeline-quality-eval.md` |
| 3 | D819 | `task-state/D819.json` | `audit: null` | `docs/synova/audit-reports/2026-09-19-K3-D819.md` |
| 4 | D839 | `task-state/D839.json` | `audit: null` | `docs/synova/audit-reports/2026-09-20-K3-D839.md` |
| 5 | D850 | `task-state/D850.json` | `audit: null` | `docs/synova/audit-reports/2026-09-20-K3-D850D852.md` |
| 6 | D854 | `task-state/D854.json` | `audit: null` | `docs/synova/audit-reports/2026-09-20-K3-D854.md` |
| 7 ★ | D862 | `task-state/D862.json` | `audit: null` | `docs/synova/audit-reports/2026-09-21-K3-D862.md` |
| 8 ★ | D864 | `task-state/D864.json` | `audit: null` | `docs/synova/audit-reports/2026-09-21-K3-D864-复审.md` |

（上表「文件」列沿用脚本原始输出 —— 其中 D558 一条显示源文件名 `task-state/D559.json`，即 `task_id` 与文件名不一致，见 §六 旁证。）

### 8.4 C 类：`audit: null` 且无报告（**173 张**，全量卡号；含 2 张非 D 卡）

```
D411 D485 D488 D490 D491 D507 D511 D512 D529 D530 D545 D548 D552 D553 D554 D555
D557 D562 D565 D566 D570 D571 D583 D584 D589 D594 D596 D597 D598 D599 D601 D660
D661 D663 D665 D705 D709 D710 D711 D712 D713 D714 D716 D717 D718 D719 D720 D721
D725 D737 D740 D741 D742 D743 D745 D746 D747 D748 D749 D750 D751 D752 D753 D754
D755 D756 D757 D758 D759 D760 D761 D762 D763 D764 D765 D766 D767 D768 D769 D770
D771 D772 D773 D774 D775 D776 D777 D778 D779 D780 D781 D782 D783 D784 D785 D787
D788 D789 D790 D791 D792 D793 D794 D795 D796 D797 D798 D800 D803 D806 D809 D810
D811 D812 D813 D814 D816 D817 D818 D820 D822 D823 D824 D825 D826 D827 D828 D829
D831 D832 D833 D834 D835 D837 D838 D840 D842 D843 D845 D846 D847 D848 D849 D852
D853 D855 D856 D857 D860 D861 D863 D866 D867 D868 D869 D911 D912 D913 D914 D915
D916 D917 D918 D919 D920 D921 D922 D923 D924 D925 D926 TEMPLATE CT-64
```

**计数校验**：上表 = **173 条**（171 张 D 卡 + `TEMPLATE` + `CT-64`）；其中 `TEMPLATE` 与 `CT-64` 为 §一 所述 2 张非 D# 卡。D531 / D532 **不在本表**（它们属 A 类「键缺失」，见 §8.2）。故 `2(A) + 8(B) + 173(C) = 183`。✔

> **注意**：**D923 自身的卡就在 C 类里**（`task-state/D923.json`，`audit: null`，`status: spec_done`）。即 D923 门禁上线后，其自身会被判第 ③ 态「排队中 → 红」—— 这是 D923 上线首日必然出现的读数，**本件如实登记，不做判断**。 <!-- measured: 2026-09-23T16:48+0800 -->

### 8.5 D 类：verdict 值形态漂移（逐卡）

```
$ python3 ...   # 非标准 verdict 逐卡
task-state/D397.json	"NOT-AUDITABLE"
task-state/D398.json	"NOT-AUDITABLE"
task-state/D492.json	null
task-state/D533.json	"无 K3（V5.1.3 tag 锚点闭环）"
task-state/D536.json	"CTO 验收通过（非 K3）"
task-state/D715.json	"DONE"
```

小写 `pass`（2 张）与下划线形态 `CONDITIONAL_PASS`（3 张）未在上表列出（它们能被朴素归一覆盖），**但朴素 `== "PASS"` 判据会漏判小写 2 张、朴素 `== "CONDITIONAL PASS"` 会漏判下划线 3 张** —— 归一化必须显式写全 **10 种形态**。

### 8.6 E 类：`audit.report` 指针坏（8 张，全量，见 §5.2）

| 卡 | 现值 | 问题类型 |
|---|---|---|
| D416 | `docs/synova/audit-reports/2026-08-17-K3-final-control-tower-console.md` | 文件不存在 |
| D417 | 同上 | 文件不存在 |
| D510 | `docs/synova/audit-reports/2026-08-24-D510.md` | 文件不存在 |
| D514 | `docs/synova/audit-reports/2026-08-24-D510.md` | 文件不存在（且疑似复制 D510 的路径） |
| D539 | `docs/synova/audit-reports/2026-08-27-D539.md` | 文件不存在 |
| D600 | `docs/synova/audit-reports/2026-09-09-K3-L1收工批-closeout.md` | 文件不存在 |
| D603 | 同上 | 文件不存在 |
| D870 | `docs/synova/audit-reports/2026-09-22-D870.md ｜ 报告分支 refs/heads/...` | **自由文本混入路径字段** |

### 8.7 F / G 类（见 §5.1、§3）

- **F**：D492 / D533 / D536 / D830 —— `audit.report` 非字符串，且按文件名派生亦无报告；四张均为「无报告面」。
- **G**（逐项实测计数）：
  - **身份字段需归一 14 张** = `auditor` 12 + `audited_by` 1 + `by+auditor` 并存 1；
  - **时间字段需归一 14 张** = `date` 11 + `at+date` 并存 1 + `audited_at` 1 + `audited_at+audit_base` 1；
  - **判定字段需归一 3 张** = `result` 1 + `verdict+result` 并存 1 + `verdict+merge_ruling` 并存 1。

---

## 九、附录：普查脚本（可复跑）与原始命令

```bash
# ① 总览
git ls-files task-state/*.json | wc -l
git ls-files --others --exclude-standard 'task-state/*.json' | wc -l

# ② audit 段普查（单段脚本，无外部依赖）
python3 - <<'PY'
import json, glob, collections
files = sorted(glob.glob('task-state/*.json'))
print("total json files:", len(files))
top = collections.Counter(); forms = collections.Counter(); fields = collections.Counter()
has, no = [], []
for f in files:
    d = json.load(open(f, encoding='utf-8'))
    for k in d: top[k] += 1
    if 'audit' not in d: no.append(f); continue
    has.append(f); a = d['audit']
    if isinstance(a, dict):
        forms[tuple(sorted(a.keys()))] += 1
        for k in a: fields[k] += 1
    else:
        forms[('__NOT_DICT__:'+type(a).__name__,)] += 1
print("has audit:", len(has), " no audit:", len(no))
for sig, c in forms.most_common(): print(f"{c}\t{sig}")
PY

# ③ verdict 值 census（含逐卡非标准值）
# ④ audit.report 存在性 + 台账 vs 文件名派生一致性
# ⑤ 缺 audit 段但有报告：glob('docs/synova/audit-reports/*.md') 文件名派生 D# ∩ audit==null 集合
```

**本件未跑的项（如实声明）**：
- **未**跑 vitest / tsc / 门禁全量（派单禁令）。
- **未**验证审计报告**内容**与台账结论是否一致（读取报告正文属 K3 语义层，超出本件范围；本件只做**结构/形态**普查）。
- **未**改动任何 `task-state/*.json`、脚本、卡或 CI（写集仅证据文件）。
