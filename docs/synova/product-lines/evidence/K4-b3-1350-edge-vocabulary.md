# K4 批 3 · #1350（K4-05bis）边词表：目标层级边 ＋ 计划边 —— 交付与证据件

> **卡**：#1350（K4-05bis）｜**分支**：`k4b3/l3-65`｜**base**：`ba1b22a8b5`｜**实施**：impl-c
> **本件状态**：🟡 **阶段件（A 段已交付；B 段待队长放行）** —— 见 §三「B 段待填清单」
> **口径纪律**：一切"现状"钉 **读数时点 × diff 左端** 双要素；一切数字取自**命令原始输出**，未手写；引用用**稳定锚点**（路径 ＋ 可 grep 唯一串），行号只作辅助。

---

## 一、前提实测（A 段，原始输出）

**读数时点**：`a8edd55d279ca8d398babe4e2c5c8ae33a6ad54b`（A 段末笔）｜**diff 左端**：`ba1b22a8b5`

| # | 前提 | 命令 | 原始输出 |
|---|---|---|---|
| P-1 | `edge-types/` 真基线 = **56 件**（卡面写「55」已漂移） | `git ls-tree -r --name-only ba1b22a8b5 -- extensions/ontology/edge-types/ \| wc -l` | `56` |
| P-2 | E 号在本体目录内 **0 命中** | `git grep -c -E "E-[0-9]" -- extensions/ontology/` | `0` |
| P-3 | `$id` distinct = **56**（全以 `edge/` 前缀） | 逐件 python3 读 `$id` 去重 | `56`；`all prefixed edge/ = True` |
| P-4 | `label` distinct = **56** | `git grep -h -E '"label"' -- … \| sort -u \| (计数)` | `56` |
| P-5 | **分隔符三态**（禁按命名法推断） | 逐件 python3 比对 | **下划线 45 / 连字符 5 / 单字 6**；`$id` 尾段≠文件名主干者**恰 5 件** |
| P-6 | 键**顺序**统一（同构口径） | 逐件 `keys()` 序列去重 | **distinct key-orders = 2**：`53` 件 = 11 键 canonical 顺序；`3` 件 = 同序多插 `diagnostic_signals` |
| P-7 | `requiredProps` **无一为空**（56/56） | 逐件 `len(requiredProps)==0` 计数 | `0 / 56` |
| P-8 | 两新边名全仓现存引用 | `git grep -n -E "GOAL_DECOMPOSES_TO\|PLAN_COMMITS_TO"` | 各 **2** 处，**均在说明性文本内，零实现** |
| P-9 | 块级门禁改前基线 | `bash scripts/control-tower/check-ontology-fields.sh` | `✅ 全部 56 件边类型关键字段齐全（action_effect_lag, transfer_function）`；`GATE_EXIT=0` |
| P-10 | 行尾口径（D8 依据） | `git config --get core.autocrlf` ＋ `git check-attr -a -- <edge json>` | `true`；`check-attr` **空输出**（`.gitattributes` **存在但无规则覆盖本批路径**）⇒ 工作树字节 = **CRLF**（56/56 件含 CRLF、56/56 以 LF 结尾、0 件纯 LF） |
| P-11 | 生产者字面量（W-2 依据） | `git grep -n "'GOAL'\|'Goal'" -- src/` | `'GOAL'` 由 `src/growth/goal-store.ts` 唯一串 `store.createNode('GOAL'` 写入；`'Goal'` 由 `src/agent/conversation-engine.ts` 唯一串 `'Goal' as unknown as Parameters<typeof this.graphStore.createNode>` 写入 |
| P-12 | `PLAN` 字面量**不存在**（禁凭名字推） | `git grep -n "PLAN" -- src/` | 共 **3** 处，**全为注释**（唯一串 `PLAN-K6` / `PLAN-expireold-wiring` / `PLAN-d660-data-lifecycle`）⇒ `'PLAN'` 属 **#1316 将建** |
| 🆕 P-13 | **行尾「两层」**（D8b 依据；队长采信，精度采纳） | `git cat-file -p ba1b22a8b5:<path>` 直读 blob（不经工作树） | **blob 层：53 件存 CRLF / 第 56 件 `goal_decomposition.json` 存 LF**（样本：`augments.json` blob 1299 B，CRLF=**54**、裸 LF=**0**；`locks_in.json` blob 1031 B，CRLF=41、裸 LF=0；`signal_transmits.json` blob 1437 B，CRLF=56、裸 LF=0；**`goal_decomposition.json` blob 1653 B，CRLF=0、裸 LF=35**；blob 首 40 B = `b'{\r\n  "$id": "edge/augments",\r\n  "label":'`）<br>**工作树层**：56/56 含 CRLF（见 P-10）<br>⇒ **两层不一致**；新件落哪一组**实测后如实声明**（**不声称"与 53 件完全同层"**；**不去"顺手统一"**）；根因标注为**推断非实测**（见 W-9） |

### 🔴 P-5 明细（连字符 5 件 = `$id` 尾段≠文件名主干的那 5 件）

| 文件名 | `$id` |
|---|---|
| `decision_concentrates.json` | `edge/decision-concentrates` |
| `external_assumption.json` | `edge/external-assumption` |
| `incentive_binds.json` | `edge/incentive-binds` |
| `locks_in.json` | `edge/locks-in` |
| `signal_transmits.json` | `edge/signal-transmits` |

⇒ **本卡声明**：两种分隔符**并存**（非"前例错误"）；新边拟名走**下划线**（45 件多数态）；**不对既有 5 件做任何"顺手统一"**（触既有文件 ⇒ 越写集）。

---

## 二、功能面实测（A 段，#66 核验相关）

| # | 项 | 命令 | 原始输出 |
|---|---|---|---|
| F-1 | `src/init/engine-context.ts` 构造 store？ | `git grep -n "SqliteGraphStore" -- src/init/engine-context.ts` | **exit 1（零命中）** ⇒ 该文件只建 `db`（唯一串 `db = new Database(config.dbPath);`），**不是收口点** |
| F-2 | `src/ingest/index.ts` 自建 store 处数 | `git grep -n "new SqliteGraphStore(" -- src/ingest/index.ts` | **1 处**（唯一命中 `:35`；**非工作令所述「2 处」**） |
| F-3 | 全量非注释构造点 | `git grep -n "new SqliteGraphStore(" -- src/` | 原始命中 **14**（含 1 条注释）⇒ **非注释 13 处 / 12 文件** |
| F-4 | 守卫判别串（默认开） | `git grep -n "standardKeyGuard" -- src/adapters/sqlite-graph-store.ts` | `this.standardKeyGuardEnabled = options?.standardKeyGuard !== false;` ⇒ **不传选项 = 守卫开** |
| F-5 | 生产侧 opt-out | `git grep -n "standardKeyGuard: false" -- src/` | **exit 1（零命中）** |
| F-6 | 归档旁路可达性 | `git grep -n "@synova/graph-store" -- src/ tests/ tsconfig.json vitest.config.ts`；`git grep -n "_archived" -- tsconfig.json vitest.config.ts package.json` | 两条均 **exit 1** ⇒ `packages/_archived/graph-store/` 的裸 `INSERT INTO graph_nodes` **构建面不可达** |

（F 组完整分析见 `docs/synova/product-lines/evidence/K4-b3-1412-status-recheck.md`。）

---

## 三、🟡 B 段待填清单（**待队长「放行」信号；本件当前不含以下内容**）

| 段 | 内容 | 依据判据 |
|---|---|---|
| §四 | 两件新边文件落盘 ＋ `$id`/`label`/端点/`requiredProps`/`optionalProps` 逐字段取证 | **V1** ＋ 卡面附录 C |
| §五 | `loadOntology()` 真跑认领（`edgeTypes` 计数 `56 → 58`）＋ #1031 桥读字段 | **V2** |
| §六 | 反例：删任一新边 ⇒ 计数回落 `58 → 57` ⇒ 夹具**红**；复原 ⇒ 绿 | **V3** |
| §七 | 块级：`check-ontology-fields.sh` ⇒ `58 件 / exit 0`；删字段 ⇒ `exit 1` | D6/D7 |
| §八 | `manifest.json` `edgeTypes` 字段 = **改后实测目录计数** | D11 |
| §九 | `packages/ontology/src/edge-types.ts` 常量 ＋ `ALL_EDGE_TYPES` 成对同步 ＋ **登记段原文** | D12（含 W-8） |
| §十 | 复原哈希（**口径 W：`Get-FileHash -Algorithm SHA256` 原始字节**） | D8 |
| §十一 | 写集全列 ＋ 差异说明 | D9 |
| §十二 | 自检 5 问 | D10 |

**B 段前置（已量，见 §一 P-6 / P-7 / P-9 / P-10）**：
同构 = **11 键 ＋ 顺序**；落盘形态 = 2 空格缩进 ＋ **CRLF** ＋ 文件尾 LF；`requiredProps` 必须非空。

---

## 四、未决项与归属（截至 A 段）

| # | 未决项 | 状态 | 归属 |
|---|---|---|---|
| W-1 | 新边 `action_effect_lag`/`transfer_function` 取值：CTO W3 写 `unknown/TBD`，L2 #235 要求全域 `TBD=0` | ✅ **队长裁：两件均取 `"unknown"`**（不打红 #235；`TBD` 属铁律 8 所禁）；**口径冲突已显式登记，提请 CTO 追认** | 队长 → CTO（追认） |
| W-2 | 端点字面量单/双枚举 | ✅ **队长裁：双枚举 `["GOAL","Goal"]`**（对 [裁] §3 字面的**扩展解释**，提请 CTO 追认） | 队长 → CTO（追认） |
| W-3 | [裁] §7 下游同步是否纳入 | ✅ **已裁并实测**：`packages/ontology/src/edge-types.ts` 有生产消费方（`EdgeType` 9 文件 / `ALL_EDGE_TYPES` 3 文件）⇒ **纳入**；`edge-consumption-map.json` **零运行时读取方** ⇒ **登记不改** | 队长（已落卡面） |
| W-4 | 库外《命名权威登记册》认领 N3/N4 | ⏳ **未到**：文件名全程标注「**待 N3/N4 认领确认**」，**不声称已认领** | 队长 → CTO（库外动作） |
| W-5 | `tests/l4/*` 两件棘轮的 +2 增量归属 | ✅ **队长裁**：归 L2 先改，**本卡零写**（已列**禁入写集**）；增量落地者由队长在 L2 之上决定 | 队长 |
| W-6 | `GOAL_DECOMPOSES_TO` 与既有 `GOAL_DECOMPOSITION` 的**语义边界判据**仓内无权威 | ⏳ **未决**（R8 已裁"不复用"，本卡照办，**不自行发明边界规则**） | 队长 → CTO |
| W-7 | 卡面要求的**提案文档**（`docs/synova/coordination/提案/`）不在本仓，且该目录不存在 | ⏳ 登记备核 | 队长 → CTO |
| W-8 | `ALL_EDGE_TYPES` `52 → 54` 的向量形状变化 | ✅ **队长裁：走 (a) 成对落地 ＋ 必写登记段**；影响面 = 余弦相似度值轻微改变，**无持久化面**（`vecA/vecB` 为函数内局部） | 队长（已落卡面） |
| 🆕 W-9 | `edge-types/*.json` **blob 层**行尾存量不一致：**53 件存 CRLF / 第 56 件 `goal_decomposition.json` 存 LF**（工作树层因 autocrlf 统一 CRLF） | ✅ **队长采信并登记**（不阻塞）；本卡**不修**（触既有文件 ⇒ 越写集）；新件落哪一组**实测后如实声明**（见 §一 D8b 同源读数） | 队长 → CTO |
| 🆕 W-10 | **E-25 排除出迁移域的后续**：E-25 登记为「**无落点**」⇒ 待院方/CTO 给 `BRAND_CONSTRUCTION` 的落点裁定（crosswalk A 段报 **MISS**；现存 `brand_building.json` 的 `label` = `BRAND_BUILDING`，**与 `BRAND_CONSTRUCTION` 不同名** ⇒ 「E-25 ↔ brand_building」是**语义推断、不是名字命中**） | ✅ 队长裁 **(a)** 已定：**明确排除出本次迁移域**，理由 = **对应件不可判定 ⇒ 无落点**，与 **E-10 / E-12 同型**；本卡**不做语义推断** | 队长 → CTO |
| 🆕 W-11 | **本件跨域**：B 段写面 **≥8 件、跨 3 个路径域**（`extensions/` / `packages/` / `tests/`），而扩写集原只登记 2 件 | ✅ **队长裁：单 PR ＋ 跨域显式声明 ＋ 不拆分**（拆开会人为制造"常量与 JSON 不对称"的中间态，**比跨域更坏**）；扩写集登记为「**B 段全量件**」，任务板 `write_scopes` 同步补 | 队长 → CTO 收件闸 |

### 🆕 W-11 跨域声明（**队长要求逐字进 PR 正文与本交付件**）
```
本件跨 extensions/ontology/ 与 packages/ontology/src/ 两个路径域，属同一逻辑域 = 本体边词表；
且 EdgeType 常量与 edge-types/*.json 必须成对落地（否则 ALL_EDGE_TYPES 与 JSON 件数不对称 = 制造新缺陷）
⇒ 请 CTO 收件闸按「单域 = 本体边词表」裁。
```

---

## 五、写集全列（**读数时点钉 SHA**；B 段落地后重跑）

> 🔴 **读数时点 = `0160b220313878b27cdaf2756b5280999ab3114b`（当时 HEAD）｜ diff 左端 = `ba1b22a8b5`**

```
$ git diff --name-only ba1b22a8b5..HEAD
.claude/claims/1350.yaml
".claude/task-briefs/2026-10-11-1350-K4-05bis-\350\276\271\350\257\215\350\241\250-\347\233\256\346\240\207\345\261\202\347\272\247\350\276\271\344\270\216\350\256\241\345\210\222\350\276\271.md"
docs/synova/product-lines/evidence/K4-b3-1350-edge-vocabulary.md
docs/synova/product-lines/evidence/K4-b3-1412-status-recheck.md
```

**共 4 条**（`… | wc -l` ⇒ `4`）。

**订正记录（本件自查抓到，非 verifier 提出）**：本块前一版列 **3 条**并注「未含本件」——那是 **`afa582cd8` 时点**的读数；
本件在 `fb79936d3` 落地后本就该是 **4 条** ⇒ 现按**当前时点重跑并全列**，时点钉死。
**本笔只改内容、不新增/不删文件** ⇒ 本列之后仍为 `4` 条（集合不变）。

> ⚠️ B 段落地后本节**再重跑一次**，给出**含 B 段全部产物**的最终全列（届时条数 > 4）；与 `.claude/claims/1350.yaml` 的 `writeset` 必须逐条相等。

### 未提交项（**逐字登记，防被判"引用了不存在的件"**）

```
（未提交项）memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
  理由 = 本段 staged 集零命中 commit-msg-check.sh 的治理/规则区正则（无治理/规则区变更 ⇒ 门禁跳过）
       ＋ 沿 1134.yaml「只列本 PR 真正改动的文件，不预授权」⇒ 未提交，故不在 writeset。
  注：该 Note 已物理存在于本树（Test-Path = True，4864 字节，SHA256 `07003CB9…DD1E`），仅未提交；
      其自然归属为 L1/L2 的 PR（内容主体是 #238/#239/#234 的裁定）。
```

**判据原文（触发面，`scripts/commit-msg-check.sh` 唯一串）**：
```
CT_ORCH_TOUCHED=$(echo "$STAGED_LIST" | grep -E '^(scripts/(control-tower|workflow|hooks)/|src/orchestrator/|AGENTS\.md$|CLAUDE\.md$|memory/notes/README\.md$)' | grep -vE '\.test\.sh$' || true)
```
⇒ 触发面 = `scripts/{control-tower,workflow,hooks}/` ∪ `src/orchestrator/` ∪ `AGENTS.md` ∪ `CLAUDE.md` ∪ `memory/notes/README.md`（排除 `*.test.sh`）；
**B 段落盘件逐条试判 ⇒ 零命中** ⇒ 门禁走 `else` 分支（`无治理/规则区变更（跳过）`）。
**兜底**：B 段 commit message **引用**该 Note 路径但**不 stage** —— 若门禁被意外触发，`① 含 memory/notes/ 引用 ✅ ② 引用文件在本树存在 ✅` ⇒ 仍绿（零成本对冲）。

---

## 六、自检 5 问（A 段）

1. **接线检查**：A 段**不新增任何 export**（卡面 ＋ 证据件 ＋ claim）⇒ 无接线面。
2. **异常处理**：A 段**不含 catch**（无代码）。
3. **类型安全**：A 段**不含 TS 代码** ⇒ `as any` / `as never` / `as unknown as` 均 **0**。
4. **测试质量（🔴 2026-10-12 按队长裁定改措辞）**：A 段**无行为可验**（未实施任何代码 ⇒ **无"删掉即报红"的「行为」夹具可造**）；
   但**不等于**"无可执行判据" —— 同批 claim `.claude/claims/1350.yaml` 的 `done:` 有 **6 条可执行命令**：
   · **有判别力的 3 条**（对违规输入会变值，**这才是本段验收面**）：`… | grep -c "^src/"`（改 `src/` ⇒ 得 `1`）、
     `grep -c -E "^## Q0:|…"`（卡面缺字段 ⇒ <6）、`grep -c -E "edge-lag-unknown-degraded-1134|…"`（禁入项 ⇒ >0）；
   · **基线断言 3 条**（只断 base，**不随本段变化，不计为本段成果**）：`git ls-tree … | wc -l ⇒ 56`、
     `git merge-base --is-ancestor … ⇒ BOTH_ANCESTOR`、`grep -c "^#CRITERIA: B" ⇒ 1`。
   🔴 **措辞纪律**：**不许**写成"无可执行判据"（verifier 判前一版"过宽"，队长采信）。
   B 段的测试件按 D10 覆盖正常/同构/认领/桥可读/**删掉即报红**四路径。
5. **残留清理**：A 段**未删任何东西**；所有读数均为**只读**命令（`ls-tree` / `grep` / `diff` / `merge-base` / `config` / `check-attr` / python3 只读）。
