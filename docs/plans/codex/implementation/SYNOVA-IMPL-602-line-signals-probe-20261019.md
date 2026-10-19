---
status: proposed
日期: 2026-10-19
任务: #602 三信号探针（回执三信号口径 A；2026-10-19 创始人裁）
撰写: P7（交付自证与真值包负责人）· **独立于实现者**（本件不含实现，实现交 `synova-squad-lead`）
版本: **v2（2026-10-19 重写：线口径由「包 P1–P10」更正为「报告线」；F7 数字现场重取；按 fresh 复核 13 findings 收口）**
依据: `agents/P7-交付自证与真值/AGENTS.md` §三/§四/§八/§八之三；`pre-plan-thinking` 9 问；`dev-doc-spec` v2；创始人裁「回执 A」；handbook `常设授权条例.md` §四（回执三信号）＋ **§五（域清单＝报告线按路径切）**
批次规模: **新建 3 文件 ＋ 改 0**（W1 探针 ≈ 520 行｜W2 配对测试 ≈ 260 行｜W3 四态 Note ≈ 30 行）；卡面由 L1 派单前落
---

# SYNOVA-IMPL-602 · `probe-line-signals.ts`：把「回执三信号」变成机器可算

> 🔴 **口径 A 已裁**（创始人 2026-10-19）：① 判据通过率 ② 例外清单 ③ 在飞/卡数；**B 健康三信号不做**（`gen-cto-health.py` 已在算）。
> 🔴 **v2 的关键更正**：**「线」＝ handbook §五 定义的报告线（产品线／治理线／基座线／CTO／K3）**，**不是 包 P1–P10** —— 包写集**天然重叠**（实测 `docs/**`∈P6/P7/P9/P10），按包归线会把 17 个 open PR 里 13–16 个打成 ambiguous（v1 的致命错）。
> 🔴 **仍待 CTO 批两条**：**B-7-a**（线口径＝报告线＋路径映射）、**B-7-c**（① 的机器代理＝四条件通过率）。**未批不开工**（判据归 CTO；这是正确行为，不是拖延）。**B-7-b 已缩为 1 行**（W2 测试；`docs/authority/DOCS-REGISTRY.yaml` 被 P7 §四 `docs/**` 覆盖，**无需扩**）。

---

## 封面 · 四行开场包

```
① 批次名：#602 P7-2 三信号探针（probe-line-signals.ts · 回执 A · 报告线口径）
② 写集（逐文件；**L1 划定，L2 不得扩**）：
   - scripts/control-tower/probe-line-signals.ts                （<新建> 主件：按报告线算三信号 ＋ --selfcheck）
   - tests/control-tower/probe-line-signals.test.sh             （<新建> 配对测试；**需 CTO 批 1 行写集扩 B-7-b**）
   - memory/notes/implemented/2026-10-19-p7-probe-line-signals.md（<新建> 四态 Note，铁律 49）
   - .claude/task-briefs/2026-10-19-p7-probe-line-signals.md    （**已落**：L1 派单前产出；L2 只读）
③ 判据（含"改坏必红"）：
   - 命令：source ~/.nvm/nvm.sh && npx tsx scripts/control-tower/probe-line-signals.ts --all
     期望：exit ∈ {0,1}（真实数据含 exceptions ⇒ 1；全绿夹具 ⇒ 0）；每条线一行三信号（**5 条线都出行**，基座线 `n/a(未映射)`）；末行 `LINE-SIGNALS: lines=5 exceptions=<n> gaps=<n>`
   - 反例（§4.3 夹具 **7 子例**，逐条给命令）：gaps 明细被丢／末行计数与明细不一致／无在飞 PR 当 100%／
     根级 API 失败当 0 在飞／混入 B 口径／跨线 PR 被硬归某线／**跨线漏计（G）** ⇒ 各自必红或 exit 2
④ 域守则指针（**必须显式 read**，DSH 无法额外注入）：
   - scripts/control-tower/AGENTS.md ｜ tests/control-tower/AGENTS.md ｜ docs/AGENTS.md
   - memory/notes/AGENTS.md ｜（👁只读）`.gitea/AGENTS.md`
```

---

## §〇 归属与依据（派单七问）

| # | 问 | 答 |
|---|---|---|
| 1 | 谁派 / 依据 | 创始人 2026-10-19「**回执 A**」；P7 守则 §三「三信号可跑」；Issue **#602** |
| 2 | 归属包 / 产品线 | **P7 交付自证与真值**（治理线·自证）｜域：`scripts/control-tower/`、`tests/control-tower/` |
| 3 | 写集 | 见 §2（W1–W3 逐文件）；🔴 **W2 需批 1 行**（B-7-b） |
| 4 | 判据 | 见 §4（正常／降级／反例 7 子例）＋ DS-1…DS-10 |
| 5 | 依赖 | **B-7-a／B-7-c 未批 ⇒ 停**；其余无阻塞（复用件见 §6） |
| 6 | 不做什么 | 见 §1.2（逐条路径）＋ §7 红线 |
| 7 | 回执 | 见 §8（三信号 ＋ R2 ≤10 行） |

## 权威件回执（派单前实读）

| 件 | 位置 | as_of | 读了什么 |
|---|---|---|---|
| P7 包守则 | `agents/P7-交付自证与真值/AGENTS.md` | `7a17677da` | §三 三信号可跑／§四 写集（`probe-line-signals.ts` 在枚举内）／§八之三 四约定 |
| 控制塔域守则 | `scripts/control-tower/AGENTS.md` | `7a17677da` | 三态／信号量==0 ⇒ exit 2／改坏必红留档／audit 禁碰 |
| 控制塔测试域守则 | `tests/control-tower/AGENTS.md` | `7a17677da` | 新增探针 ⇒ 测试同步；测试非空壳 |
| 文档体系守则 | `docs/AGENTS.md` | `7a17677da` | 新文件登记（`docs/**` 已覆盖，无需另扩）；数量给枚举命令 |
| 过程留痕守则 | `memory/notes/AGENTS.md` | `7a17677da` | 铁律 49 四态 Note |
| handbook 常设授权条例 §四 | `/Users/wane/SynovaAgent/.handbook-mirror/常设授权条例.md`（主树镜像） | 2026-10-19 读 | **① Done 判据逐条 通过/未通过 + 可复跑命令；② 我【没做到】的（主动列，不许藏）；③ 本线在飞 PR 数 + 未收口卡数** |
| handbook 常设授权条例 §五 | 同上 | 2026-10-19 读 | **域清单＝报告线按路径切**：产品线 `src/**·extensions/**·tests/**`｜治理线 `scripts/**·.github/**·docs/synova/**·.claude/**`｜基座线"具体面由 CTO 在开线时给"｜CTO `docs/synova/coordination/tools/**`｜K3 `scripts/audit/**` |
| 四条件检查器 | `scripts/control-tower/check-merge-conditions.sh`（#597＋#604） | `7a17677da` | `--json` 契约：`{conditions{ci,overlap,review,serial},verdict,exit}` |

---

## §〇pre · `pre-plan-thinking` 9 问

| # | 问 | 证据 | 落到 |
|---|---|---|---|
| **①** | 问题 | CTO 问"某线进度/在飞/例外"只能人报（handbook §四 自述"我只看这三项"，但产出靠人算） | §1 |
| **②** | 现状 | **无按线三信号件**：`git grep -l "回执三信号" 7a17677da -- scripts/` ⇒ 0；`gen-cto-health.py` 是 **B 口径**（绕过/拒绝/M 复发） | §3／§6 |
| **③** | 有没有现成 | §6 表：复用 8 项，确需新建 1 件（按线聚合编排层） | §6 |
| **④** | 最小改动 | 必须：1 TS 探针 ＋ 1 测试 ＋ Note。划掉：改 `check-merge-conditions.sh`／`gen-cto-health.py`／`probe-ladder.ts`／`.gitea/**` | §2 |
| **⑤** | 最危险假设（**实测**） | 「按包归线可行」⇒ **假**：包写集重叠实测 `docs/**`∈{P6,P7,P9,P10}、`memory/notes/**`∈{P6,P7}、`.gitea/**`∈{P4,P10}、`scripts/control-tower/**`∈{P4,P9} ⇒ 17 个 open PR 中 13–16 个 ambiguous。⇒ **线改为报告线（路径法）**，见 §4bis | §4bis |
| **⑥** | 失败路径 | 反例 7 条（§4.3，含 G 跨线漏计）：gaps 被丢／无 PR 当 100%／根级失败当 0／混 B 口径／跨线硬归／计数与明细不一致 | §4.3 |
| **⑦** | 边界 | 逐条路径见 §1.2 | §1 |
| **⑧** | 可观测 | `--all` 一条命令：每线一行 ＋ 末行 `LINE-SIGNALS: lines=… exceptions=… gaps=…` | §4 |
| **⑨** | 拆步 | S1 路径→线映射 → S2 三信号聚合 → S3 `--selfcheck`（夹具 7 子例）；单文件新建可整体 revert | 封面／§8 |

---

## §1 做什么

**目标**：一条命令按**报告线**输出**回执三信号**：① 判据通过率（**机器代理＝四条件通过率**，标签 `①(merge-conditions)`）② 例外清单 ③ 在飞 PR 数；全部取自机器真值。

**可观测**：`--all` ⇒ 5 行（例 `治理线 ①(merge-conditions)=5/17 ②=1 ③=17(跨线 12)`、`基座线 ①=n/a(未映射) ②=0 ③=0(跨线 0)`）；末行 `LINE-SIGNALS: lines=5 exceptions=1 gaps=6`；三态 `0`（无例外无缺口）／`1`（有例外或映射缺口）／`2`（根级取不到真值）。

### 1.2 非目标（逐条路径）
- ❌ `scripts/control-tower/check-merge-conditions.sh`（只读调用）
- ❌ `scripts/control-tower/gen-cto-health.py`（B 口径已在算）｜`probe-ladder.ts`（只读契约）｜`emit-signal.py`（只读复用其格式）
- ❌ `.gitea/**`（不接 CI）｜`scripts/audit/**`（K3）｜`src/**`｜`extensions/**`
- ❌ 不写人读进度文档；不判"该不该开工/优先级"（CTO）
- ❌ **v1 不出"未收口卡数"**（Issue→线 无可靠机器判据，实测 **139 个 open issue 仅 9 个带 `^P<N>`**）——**显式写进 Known Limitations 与 gaps**，并**并入 B-7-c 请批**（③ 与 ① 同属 handbook §四口径，不得只批其一）

---

## §2 在哪做（写集 ＋ 结构）

| 文件 | 操作 | 归属 |
|---|---|---|
| `scripts/control-tower/probe-line-signals.ts` | **新建** | W1 |
| `tests/control-tower/probe-line-signals.test.sh` | **新建** | W2（写集扩 1 行待批 B-7-b） |
| `memory/notes/implemented/2026-10-19-p7-probe-line-signals.md` | **新建** | W3 |
| `.claude/task-briefs/2026-10-19-p7-probe-line-signals.md` | **已落（L1）** | — |

**W1 五段**：① 头部契约 `@input/@output/@exit/@degraded/@authority` ＋ **typed error 清单（带 code）** ＋ **Known Limitations 节**（P7 §八之三②）② 常量与环境（`SYNO_GITEA_API`、token 三级、UTF-8、`SYNO_GATE_DEGRADED_LOG`，字段 time/component/code/phase/retryable）③ 映射层（§4bis）④ 三信号聚合 ⑤ `--selfcheck` ＋ 输出编排。

---

## §3 凭什么做（现状证据，**每条现场可复跑 @`7a17677da`**）

| # | 事实 | 命令 ⇒ 输出 |
|---|---|---|
| F1 | 无按线三信号件 | `git grep -l "回执三信号" 7a17677da -- scripts/` ⇒ 0 |
| F2 | 探针契约有单一实现 | `sed -n 1,40p scripts/control-tower/probe-ladder.ts` ⇒ 13 探针／`RESULT=`／三态 |
| F3 | 信号发射已有 | `sed -n 1,20p scripts/control-tower/emit-signal.py` ⇒ `.codex/signals/{component}.json` |
| F4 | 四条件机器判定（① 代理源） | `bash scripts/control-tower/check-merge-conditions.sh --pr <**open**> --json` ⇒ `conditions{ci,overlap,review,serial}`（⚠️ 对已关 PR 会 `E_PR_NOT_OPEN` 降级，示例须选 open PR）；open PR 实测 **17**（as_of 2026-10-19；枚举：`curl -s -H "Authorization: token $TOK" "$API/repos/synova-agent/SynovaAgent/pulls?state=open&limit=50" \| python3 -c 'import json,sys;print(len(json.load(sys.stdin)))'`） |
| F5 | **包写集重叠（v1 失败根因）** | 解析 10 包 §四：`docs/**`∈{P6,P7,P9,P10}；`memory/notes/**`∈{P6,P7}；`.gitea/**`∈{P4,P10}；`scripts/control-tower/**`∈{P4,**P7**,P9}（P7 §四明列本件两脚本） |
| F6 | 报告线按路径切（**v2 依据**） | handbook §五 原文逐字（见「权威件回执」末两行） |
| F7 | 既有约定计数（**重取；v1 三个数字全错**） | `git grep -l "exit 2" 7a17677da -- 'scripts/control-tower/*.sh' \| wc -l` ⇒ **40**；`git grep -l "degraded" …` ⇒ **41**（其中 `SYNO_GATE_DEGRADED_LOG` ⇒ **3**）；`git grep -li "utf-8" … \| wc -l` ⇒ **40** / 分母 `git ls-tree -r --name-only 7a17677da -- scripts/control-tower \| grep -c '\.sh$'` ⇒ **47** |
| F8 | 无现成"卡"映射 | **139** 个 open issue（分页拉全）中 `^P\d+` 标题 **9** 个 ⇒ v1 不出卡数 |
| F9 | 运行环境 | 默认 shell `command -v npx` ⇒ 空（需 `source ~/.nvm/nvm.sh`；node v24.19.0 / tsx v4.23.13）⇒ §5 写死 nvm 前置 |

**若 F1–F9 任一不成立 ⇒ 停，退回 L1。**

---

## §4bis 🔴 线映射口径（**v2：报告线 ＝ 路径法**；待 CTO 批 B-7-a）

**线集（5 条，枚举读，禁写死"4 条"）**：`产品线`／`治理线`／`CTO`／`K3`／`基座线`。
🔴 **匹配用「最长前缀优先」＋「显式排除」，不是"并集/顺序"两读法**（v1 的死因）：

```
规则（按优先级，先命中先返回；同一文件只归一条线）：
 R1 K3      ：scripts/audit/**
 R2 CTO     ：docs/synova/coordination/tools/**
 R3 产品线  ：src/** · extensions/** · tests/**
 R4 治理线  ：scripts/** · .github/** · docs/synova/**（除 coordination/tools/）· .claude/** · .gitattributes · .gitignore
 R5 基座线  ：**v1 不映射**（handbook §五 写"具体面由 CTO 在开线时给" ⇒ 无路径定义）⇒ 显式 unknown
 其余路径    ：**unknown**（例：docs/plans/**、memory/notes/**、task-state/**、.codex/** —— 不属任何报告线）
```

**PR → 线**：对该 PR 的 `git diff --name-only <mb>..<head>` **逐文件**跑上述规则；
- **全部文件同线** ⇒ 该线（`single`）；
- **跨 ≥2 条线** ⇒ 该 PR **同时计入所涉每一条线的 ③**，并标 `(跨线 <c>)`（`cross`）；**不再把 cross 排除在计数外**（v2 之误：17 个 open PR 中 12 个 cross；旧法排除后各线 ③ 打 `n/a(0)` = 假事实「无在飞 PR」）；
- **全部 unknown** ⇒ `unknown`（进 gaps）；
- **混合（有线 + unknown）** ⇒ 归命中的线，同时在 **gaps 里点名未归属文件数**。

🔴 **实测（as_of 2026-10-19，16 个 open PR，逐 PR 拉 API `/pulls/<n>/files` 手算）**：
```
single = 5（#515/#519/#522/#543/#607）｜ cross = 12 ｜ unknown = 0（open PR 共 17）
按"cross 计入各涉线"：治理线 ③=17(跨线 12) ｜ 产品线 ③=12(跨线 12) ｜ CTO/K3/基座线 ③=0
⚠️ **③ 的 `n/a(0)` 只在全局 open PR = 0 时打印**；某线 0 必须打 `0(跨线 0)` 并附"该线本批无独立 PR"，不得说"无在飞 PR"。（**① 的 `n/a` 是另一回事**：该线 0 在飞 PR 时 ① 显示 `n/a(0)`，见子例 C）
```
🔴 **结构性冲突（升为 B-7-a 待裁项，不在本件自裁决）**：handbook §五 把 `tests/**` 归产品线，而 **CT-40 强制** `scripts/{control-tower,workflow,hooks}/<name>.<sh|py> ↔ tests/control-tower/<name>.test.sh` 配对 ⇒ **合规治理 PR 天然 cross-line**（本件自己的 W1+W2+W3 亦然）。实测对照：若 `tests/control-tower/**`·`tests/architecture/**` 随被测面归**治理线** ⇒ **single 10 / cross 7**（治理线 ③=17、产品线 ③=7）。两读法都写进 B-7-a 请裁。
🔴 **`.gitea/**` 归属待裁**：本仓 CI 真源是 `.gitea/workflows/local-gates.yml`（根件 §8），而 handbook §五 只写 `.github/**` ⇒ v2 把 `.gitea/**` 落 unknown（#606/#416 的 CI 改动受影响）。B-7-a 一并裁：`.gitea/**` 是否视同 `.github/**` 归治理线。

**Issue → 线**：**v1 不映射**（50 open issues 仅 9 个带 `^P<N>`）⇒ ③ 不出卡数，写进 Known Limitations 与 gaps。
**task-state → 线**：**v1 不映射**（468 份无 line 字段）⇒ 同上。

**三条硬约束**：
1. `exceptions`（② 真例外）**按线**输出；`gaps`（映射缺口）**全局**输出 —— **两者分栏**（handbook ② 是"我没做到的"；映射缺口不属"没做到"，属"看不见"）；
2. `cross-line`/`unknown`/混合未归属**全部进 gaps**，**逐项点名**，**不许丢**；
3. 计数自洽：末行 `exceptions=`/`gaps=` **必须等于**明细条数（输出级断言，子例 B）。

---

## §4 怎么算做完

### 4.1 正常路径

```bash
source ~/.nvm/nvm.sh
npx tsx scripts/control-tower/probe-line-signals.ts --all
# 真实数据：exit 1（有 exceptions 或 gaps）；每线一行；末行 LINE-SIGNALS: lines=5 exceptions=<n> gaps=<n>
npx tsx scripts/control-tower/probe-line-signals.ts --line 治理线
npx tsx scripts/control-tower/probe-line-signals.ts --all --json | python3 -m json.tool >/dev/null && echo JSON-OK
bash tests/control-tower/probe-line-signals.test.sh    # 末行 `结果: N 通过, 0 失败`
SYNO_LINE_SIGNALS_FIXTURE=<夹具> npx tsx … --all; echo $?   # 全绿夹具 ⇒ 0（仅夹具可构造；真实仓恒有 gaps）
```

### 4.2 降级（**粒度已定义**）
```
逐项降级：某 PR 的 check-merge-conditions 降级（E_MERGE_BASE／E_PR_NOT_OPEN 等）⇒ 该 PR 进 exceptions（点名 code），整体 exit 1
根级降级：Gitea API／git／JSON 解析失败 ⇒ exit 2（fail-closed）
文件清单：走 API `GET /pulls/<n>/files`（**零 git 写**，保 `@authority 只读`/DS-7 成立）；该 API 失败 ⇒ 该 PR 逐项降级。
⚠️ **不做** `git fetch refs/pull/*`（会写 `.git`，与只读契约冲突；v2 的错）
```
```bash
source ~/.nvm/nvm.sh && SYNO_GITEA_API=http://127.0.0.1:1/api/v1 npx tsx scripts/control-tower/probe-line-signals.ts --all; echo $?   # 期望 2 + degraded:
```

### 4.3 🔴 反例（夹具 7 子例，**含命令与期望**）

夹具 = `SYNO_LINE_SIGNALS_FIXTURE=<json>`（零网络），schema：
```json
{"open_prs":[{"number":1,"branch":"ct/p1-x","files":["src/a.ts"],
              "conditions":{"ci":"ok","overlap":"ok","review":"ok","serial":"ok"}}],
 "drop_gaps_detail":false,"force_s1":"","force_root_fail":false,"inject_b_metric":false,
 "cross_pr":{"number":2,"files":["src/a.ts","scripts/b.sh"],"conditions":{"ci":"ok","overlap":"ok","review":"ok","serial":"ok"}}}
（旋钮：`drop_gaps_detail` 子例 B；`force_s1="1/1"` 子例 C；`force_root_fail` 子例 D；`inject_b_metric` 子例 E；`cross_pr` 子例 G）
```
| 子例 | 命令（改坏后） | 期望 |
|---|---|---|
| **A** 基线 | `SYNO_LINE_SIGNALS_FIXTURE=fx/green.json npx tsx … --all` | exit 0；末行 `exceptions=0 gaps=0`；无 B 键 |
| **B** 计数与明细不一致 | 把 gaps 明细删掉但末行计数不改 | **必红**（DS-2） |
| **C** 无 PR 当 100% | 夹具该线 0 PR，实现输出 `1/1` | **必红**：① 必须 `n/a(0)`；③ 必须 `0(跨线 0)`（**不得**用 n/a） |
| **D** 根级失败当 0 | `SYNO_GITEA_API=http://127.0.0.1:1/api/v1` | exit **2** + `degraded:` |
| **E** 混入 B 口径 | `inject_b_metric=true` | **必红**：出现非 A 键 ⇒ 口径守卫失败 |
| **F** 跨线硬归 | `cross_pr` 存在但实现只归一线 | **必红**：必须两线各计 1 且标 `(跨线)` |
| **G** 跨线漏计 | `cross_pr` 存在而某涉线 ③ 未 +1 | **必红**：两线 ③ 均须含该 PR |

`--selfcheck` 自跑这 7 子例，末行 `SELFCHECK-OK: 7/7` 或 `SELFCHECK-FAIL: <子例>`（exit 2）。

### 4.4 DS

| # | 声明 | 核验 |
|---|---|---|
| DS-1 | 三信号按线可读 | §4.1 首条 |
| DS-2 | **gaps 计数 = gaps 明细条数**（只约束 gaps 栏） | 子例 B |
| DS-3 | 无在飞 PR ⇒ **①** 显示 `n/a(0)`（非 100%） | 子例 C（期望 `①=n/a(0) 且 ③=0(跨线 0)`） |
| DS-4 | 根级 fail-closed（exit 2）；逐项降级 exit 1 | 子例 D ＋ 逐项降级命令 |
| DS-5 | 口径守卫（只 A 三信号，禁 B 键） | 子例 E |
| DS-6 | 跨线点名、不硬归 | 子例 F |
| DS-7 | 只读 | 运行前后 `git status --porcelain` 不变 |
| DS-8 | `--json` 键：`{tool, lines[{line,s1,s2,s3}], exceptions[], gaps[], mapping{rule_hits}, summary{}, exit}`（**含 mapping**） | `python3 -m json.tool` + 键集比对 |
| DS-9 | 三态 0/1/2 各一例 | A／真实数据／D |
| DS-10 | 测试零失败 | W2 `结果: N 通过, 0 失败` |

---

## §5 怎么跑

```bash
git -C /Users/wane/SynovaAgent fetch gitea
git -C /Users/wane/SynovaAgent worktree add .synova-wt-p7probe-$(date +%m%d) -B ct/p7-probe-$(date +%m%d) gitea/local-main
source ~/.nvm/nvm.sh                 # 🔴 必须：默认 shell 无 node/npx；node v24.19.0 / tsx v4.23.13
node -v && npx tsx --version
# token：$HOME/gitea/.win-push-token（或 GITEA_TOKEN / SYNO_GITEA_TOKEN）
# 端口：无；Gitea 占 3000
# 落盘：证据放 docs/evidence/p7-probe/（.gitignore 覆盖 ⇒ 不入库）
# 环境自检：npx tsx scripts/control-tower/probe-ladder.ts --all    # 期望全部探针 PASS（退出码 0）
```

---

## §6 有什么基础（既有基础盘点 · 禁止重复建设）

| 能力 | 盘点命令 | 命中 | 结论 |
|---|---|---|---|
| 探针契约 | `head -40 scripts/control-tower/probe-ladder.ts` | 13 探针／`RESULT=` | 复用口径（不改它） |
| 信号发射 | `head -20 scripts/control-tower/emit-signal.py` | `.codex/signals/` | 复用 |
| 四条件机器判定 | `bash scripts/control-tower/check-merge-conditions.sh --pr <open> --json` | `conditions{…}` | 复用（只读调用） |
| 健康三信号（B） | `grep -n 三信号 scripts/control-tower/gen-cto-health.py` | 绕过/拒绝/M | 不复用/不重复（已裁不做） |
| 看板真值 | `ls scripts/control-tower \| grep check-board` | 2 件 | 不复用（看板≠回执） |
| 任务状态 | `ls task-state/*.json \| wc -l` | 468；无 line 字段 | v1 不用于映射（Known Limitations） |
| 写集声明 | `ls .claude/claims/*.yaml \| wc -l` | 30 | 不复用（PR 级写集） |
| 施工项登记 | `head -30 docs/synova/coordination/施工项登记.ts` | 48 项/12 块 | v1 不复用（块≠报告线；留 v2） |
| **doc-system／workflow／integration／skills 盘点**（P7 §八之三① 必查三类） | `ls scripts/doc-system \| wc -l`；`ls scripts/workflow \| wc -l`；`ls scripts/integration \| wc -l`；`ls .dsh/skills \| wc -l` | **10／37／3／21**（实测） | **均无"按线三信号"实现** ⇒ 确需新建 |
| 三态/降级/UTF-8 | 见 F7 三条命令 | 40／41／40-47 | 复用（四约定） |

**结论**：复用 8 项，**新建 1 件**；不重复 B 口径。

---

## §7 前置与红线

| 前置 | 判据 | 未满足 |
|---|---|---|
| **B-7-a 线口径（报告线＋路径映射）** | 附录 B-7-a 有 CTO 批准记录（日期+裁决号/SHA） | **停**（判据归 CTO） |
| **B-7-c ① 机器代理** | 附录 B-7-c 有批准记录 | **停**（口径归 CTO） |
| **B-7-b 写集扩 1 行（W2 测试）** | 附录 B-7-b 有批准记录 | 不批 ⇒ **不做 W2**（交付面缩小，**不停**） |
| 分支从 `gitea/local-main` 取 | `merge-base --is-ancestor` ⇒ 0 | 停 |

**红线**：❌ `scripts/audit/**`｜❌ `.gitea/**`｜❌ `check-merge-conditions.sh`／`gen-cto-health.py`／`probe-ladder.ts` 一行不改｜❌ 主树写码｜❌ `git stash`｜❌ 丢 gaps｜❌ 跨线硬归｜❌ 输出 B 口径键。

---

## §8 交什么

```
R2 ≤10 行：批次名｜写集｜自验结论｜证据｜未决项
证据：原始输出（禁截断）；含真实数据的 exceptions/gaps 各 ≥1 条样例
回执三信号：① 判据通过率 ② 例外清单 ③ 在飞数
🔴 不判"通过"
```

---

## C1 契约

```
@input  --all | --line <产品线|治理线|CTO|K3|基座线> | --json | --selfcheck | --repo-root <path>
        环境：SYNO_GITEA_API、token 三级、SYNO_LINE_SIGNALS_FIXTURE（夹具）、SYNO_GATE_DEGRADED_LOG
@output 每线一行 `<线> ①(merge-conditions)=<p>/<n>|n/a(0) ②=<n> ③=<n>(跨线 <c>)`
        末行 `LINE-SIGNALS: lines=<n> exceptions=<n> gaps=<n>`；--json 见 DS-8
@exit   0=无例外无缺口／1=有例外或缺口／2=根级失败（API/git/JSON）或信号量==0（open PR=0 且夹具未声明合法零）
@degraded stderr 一行 `degraded: <原因>` + code；逐项降级不 exit 2（见 §4.2）
@authority 任何会话可调（只读）；不合并/不派单/不改状态
```

**Known Limitations（必写进 W1 头部）**：① v1 不出"未收口卡数"（Issue/task-state 无线字段）；② 基座线无路径定义 ⇒ 恒 unknown；③ `docs/plans/**`、`memory/notes/**` 等不属任何报告线 ⇒ 进 gaps；④ ① 是**机器代理**（四条件通过率），非 handbook 原文的"Done 判据逐条"。

## C2 边界值

| 边界 | 期望 |
|---|---|
| open PR = 0（API 200 + []） | exit 2（信号量==0），除非夹具显式声明合法零 |
| 某线 0 在飞（全局有 PR） | ③ 显示 `0(跨线 0)` ＋「该线本批无独立 PR」；**不得**说"无在飞 PR" |
| PR 跨 2 线 | **计入所涉每条线 ③ 并标 `(跨线 n)`**，全局 gaps 明细点名两线 |
| 全 unknown 文件 | 进 gaps |
| 某 PR 逐项降级（E_MERGE_BASE／E_PR_NOT_OPEN） | 进 exceptions，整体 exit 1 |
| Issue 标题无 `^P<N>` | v1 不参与（无卡数） |

## C3 失效条件

- **何时可撤**：task-state 增加 `line` 字段（或 Issue 标签承载线）⇒ ③ 卡数可用，gaps 下降。
- **前提变更**：报告线定义变化（handbook §五 改）⇒ 路径表同步改，**禁写死"4 条线"**（枚举读）。
- **口径变更**：① 若 CTO 改回 handbook 字面口径 ⇒ 本件 fail（标签守卫），另出规格。

---

## 附录 A · 证据（as_of `7a17677da`）

```
A.1 回执三信号原文（handbook 常设授权条例 §四）与 §五 域清单（见「权威件回执」末两行）
A.2 无按线三信号件：git grep -l "回执三信号" 7a17677da -- scripts/ ⇒ 0
A.3 探针契约：13 探针 / RESULT= / 三态（`scripts/control-tower/probe-ladder.ts:1-40`）
A.4 四条件 --json：{tool,pr,base,tip,head,fp,conditions{…},verdict,exit}（对已关 PR ⇒ E_PR_NOT_OPEN 降级）
A.5 包写集重叠：docs/**∈{P6,P7,P9,P10}；memory/notes/**∈{P6,P7}；.gitea/**∈{P4,P10}；scripts/control-tower/**∈{P4,**P7**,P9}
A.6 报告线路径：handbook §五（产品/治理/基座/CTO/K3）
A.7 既有约定计数：exit 2=40；degraded=41（SYNO_GATE_DEGRADED_LOG=3）；utf-8=40/47
A.8 Issue 覆盖：**139** 个 open issue 中 ^P\d+ 标题 9 个 ⇒ v1 不出卡数
A.9 环境：默认无 npx；source ~/.nvm/nvm.sh 后 node v24.19.0 / tsx v4.23.13
```

## 附录 B · 需 CTO 一句话（3 条）

| # | 事项 | 证据 | 建议 |
|---|---|---|---|
| **B-7-a** | **线口径＝报告线 ＋ §4bis 路径映射**；其中两条子项请一并裁：**(i) `tests/**` 归属** —— handbook 字面=产品线，但 CT-40 强制配对 ⇒ 治理 PR 天然 cross（实测 single 5/cross **12**；若 `tests/control-tower/**`·`tests/architecture/**` 随被测面归治理线 ⇒ single 10/cross **7**）；**(ii) `.gitea/**` 归属** —— 本仓 CI 真源是 `.gitea/workflows/local-gates.yml`，handbook 只写 `.github/**`，是否视同归治理线 | A.5／A.6 ＋ 两读法实测 | **批**（本件按「字面＋cross 计入各涉线」实现，两子项批复后再收敛） |
| **B-7-c** | **§四口径的两处机器代理/缺口**：(i) **① 代理**＝四条件通过率，标签 `①(merge-conditions)`；(ii) **③ 的「未收口卡数」v1 不出**（Issue→线 无可靠判据：139 open issue 仅 9 带 `^P`） | handbook §四原文 vs A.4／A.8 | **批**；不批 ⇒ 本件只出 ②，① 与卡数均不出现 |
| **B-7-b** | **写集扩 1 行**：`tests/control-tower/probe-line-signals.test.sh`（CT-40 只强制 sh/py；本件主动加固） | P7 §四枚举未含 | **批**；不批 ⇒ 不做 W2（交付面缩小） |

**已消**：`docs/authority/DOCS-REGISTRY.yaml` 无需扩（P7 §四 `docs/**` 已覆盖）。

## 引用豁免

- scripts/control-tower/probe-line-signals.ts — 本交付新建件（W1），交付前不存在
- tests/control-tower/probe-line-signals.test.sh — 本交付新建件（W2），交付前不存在
- memory/notes/implemented/2026-10-19-p7-probe-line-signals.md — 本交付新建件（W3），交付前不存在

## 附录 D · 派单内部一致性自检

| 检查 | 结论 |
|---|---|
| 写集 vs 非目标 | W1–W3 与 §1.2 零交集 |
| 口径 A vs B | 只 A 三信号；B 键出现即红（子例 E） |
| ② vs gaps | 真例外按线、映射缺口全局，**分栏**；DS-2 只约束 gaps |
| 跨线 vs 单线 | 逐文件跑 R1–R5；跨线=cross-line（子例 F） |
| 逐项降级 vs 根级 | 前者 exit 1（进 exceptions），后者 exit 2（§4.2） |
| 封面 / C1 判据 | 封面已改「真实数据 0 或 1；2=降级；0 仅夹具」，与 C1 一致 |
| W 编号 | 全文 W1–W3 一致；卡面为已落件（无 W 号） |
