---
status: proposed
日期: 2026-10-19
任务: #602 三信号探针（回执三信号口径 A；2026-10-19 创始人裁）
撰写: P7（交付自证与真值包负责人）· **独立于实现者**（本件不含实现，实现交 `synova-squad-lead`）
依据: `agents/P7-交付自证与真值/AGENTS.md` §三/§四/§八/§八之三；`pre-plan-thinking` 9 问；`dev-doc-spec` v2（8 节＋3 条件）；创始人 2026-10-19 裁「回执 A」
批次规模: **新建 4 文件 ＋ 改 1 文件**（W1 探针 ≈ 520 行｜W2 配对测试 ≈ 260 行｜W3 四态 Note ≈ 30 行｜W4 卡面已由 L1 落｜W5 `docs/authority/DOCS-REGISTRY.yaml` ＋1 条，待 B7-b）
前置口径: 口径 **A 回执三信号** = ① 判据通过率 ② 例外清单（主动列没做到的）③ 在飞/卡数（出处 handbook `常设授权条例.md` §四）；**B（健康三信号）不做**（`gen-cto-health.py` 已在算）
---

# SYNOVA-IMPL-602 · `probe-line-signals.ts`：把「回执三信号」变成机器可算

> 🔴 **本件是执行小队的唯一规格源**。口径 A 已由创始人裁定；**线映射口径（§4bis）由本件拟定，待 CTO 一句确认（附录 B-7-a）**，实现方不得自行改。
> 🔴 **本件是文档，不是实现**：0 行产品代码 ⇒ 可四条件自合。
> 🔴 **冻结**：派单时给 **blob SHA**，实现方引用 blob，不引用可变工作树。

---

## 封面 · 四行开场包

```
① 批次名：#602 P7-2 三信号探针（probe-line-signals.ts · 回执三信号口径 A）
② 写集（逐文件；**L1 划定，L2 不得扩**）：
   - scripts/control-tower/probe-line-signals.ts                （<新建> 主件：按线算三信号 ＋ --selfcheck）
   - tests/control-tower/probe-line-signals.test.sh             （<新建> 配对测试；**需 CTO 批 1 行写集扩**，见附录 B-7-b）
   - memory/notes/implemented/2026-10-19-p7-probe-line-signals.md（<新建> 四态 Note，铁律 49）
   - docs/authority/DOCS-REGISTRY.yaml                          （改 1 条登记；待 B7-b 同批）
   - .claude/task-briefs/2026-10-19-p7-probe-line-signals.md    （<新建> 卡面由 L1 于派单前落，L2 只读）
③ 判据（含"改坏必红"）：
   - 命令：bash scripts/control-tower/probe-line-signals.sh? 不对 —— 入口见 §2（`npx tsx scripts/control-tower/probe-line-signals.ts --all`）
     期望：exit 0；每线一行三信号；末行 `LINE-SIGNALS: lines=<n> unknown=<n> ambiguous=<n>`
   - 反例（改坏必红，见 §4.3）：把 `unknown` 桶静默丢弃／无在飞 PR 当 100%／API 不可达当"0 在飞"／
     把 B 口径（健康三信号）混入输出 ⇒ 各自必红或 exit 2
④ 域守则指针（**必须显式 read**，DSH 无法额外注入）：
   - scripts/control-tower/AGENTS.md ｜ tests/control-tower/AGENTS.md ｜ docs/AGENTS.md
   - memory/notes/AGENTS.md ｜（👁只读）`.gitea/AGENTS.md`
```

---

## §〇 归属与依据（派单七问）

| # | 问 | 答 |
|---|---|---|
| 1 | 谁派 / 依据 | 创始人 2026-10-19 口径裁定「**回执 A**」＋ P7 守则 §三「三信号可跑」；Issue **#602** |
| 2 | 归属包 / 产品线 | **P7 交付自证与真值**（治理线·自证）｜域：`scripts/control-tower/`、`tests/control-tower/`、`docs/` |
| 3 | 写集 | 见 §2（W1–W4，文件级两两不重叠）；🔴 **W2 需 CTO 批 1 行写集扩**（附录 B-7-b） |
| 4 | 判据 | 见 §4（正常／降级／反例）＋ DS-1…DS-10 |
| 5 | 依赖 | 无阻塞。复用件见 §6（`probe-ladder` 契约／`emit-signal`／`check-merge-conditions`／task-state） |
| 6 | 不做什么 | 见 §1.2（逐条路径）＋ §7 红线 |
| 7 | 回执 | 见 §8（三信号 ＋ R2 ≤10 行；证据＝原始输出，禁截断） |

## 权威件回执（派单前实读）

| 件 | 位置 | as_of | 读了什么（不是"提过"） |
|---|---|---|---|
| P7 包守则 | `agents/P7-交付自证与真值/AGENTS.md` | `7a17677da` | §三「`check-merge-conditions.sh` 输出 CAN/NO；**三信号可跑**；问进度不用问人」／§四 写集（`probe-line-signals.ts` 已在枚举内）／§八之三 四约定 |
| 控制塔域守则 | `scripts/control-tower/AGENTS.md` | `7a17677da` | 三态退出码／信号量==0 ⇒ exit 2／"改坏确实红"留档／`scripts/audit/**` 禁碰 |
| 控制塔测试域守则 | `tests/control-tower/AGENTS.md` | `7a17677da` | 新增探针 ⇒ 对应 `tests/control-tower/` 断言同步（WIRE CHECK）／测试非空壳 |
| 文档体系守则 | `docs/AGENTS.md` | `7a17677da` | 新文件须登记 `DOCS-REGISTRY.yaml`；数量给枚举命令不给手写数 |
| 过程留痕守则 | `memory/notes/AGENTS.md` | `7a17677da` | 铁律 49 四态 Note（状态/日期/决定/理由）；168-C 配套件默认可写 |
| handbook 常设授权条例 §四 | handbook 工作副本（`.handbook-mirror/常设授权条例.md`） | 镜像 | **口径 A 原文**：① 判据通过率 ② 例外清单 ③ 在飞/卡数 —— "我只看这三项 + 每周抽 1–2 件深入核" |
| 已交付的四条件检查器 | `scripts/control-tower/check-merge-conditions.sh`（#597＋#604） | `7a17677da` | 四条件 `--json` 契约（`conditions.{ci,overlap,review,serial}`、`verdict`、`exit`）⇒ 本件 ① 的真相源 |

---

## §〇pre · `pre-plan-thinking` 9 问（逐问留证据）

| # | 问 | 证据（命令 ⇒ 输出摘要） | 落到 |
|---|---|---|---|
| **①** | 问题：谁在什么场景遇到什么？不做会怎样？ | CTO 问"某线进度/在飞/例外"时只能**人报或人转述**（handbook §四 明写"我只看这三项"，但产出靠人）。不做 ⇒ 每条线每次汇报都要人算一遍，且"例外"最容易被藏（§四 称其"最重要的信号"） | §1 |
| **②** | 现状：这块现在怎么跑的？谁调用？ | **没有任何件按线算三信号**。相关但不同：`gen-cto-health.py`（**B 健康三信号**：绕过/拒绝/M 复发，**非本卡**）；`gen-task-board.py`／`check-board-metrics.ts`（看板，非回执）；`probe-ladder.ts`（13 探针契约，**本件应照其契约**）；`emit-signal.py`（`.codex/signals/` 发射） | §3／§6 |
| **③** | 有没有现成的？ | 见 §6 表：**复用 8 项**（探针契约／信号发射／四条件检查器／task-state／claims／施工项登记／product-lines 进度器／三态与降级约定）；**确需新建 1 件**（按线聚合三信号的编排层，无现成件） | §6 |
| **④** | 最小改动 | **必须**：1 个 TS 探针 ＋ 1 个配对测试 ＋ Note ＋ registry 1 条。**划掉**：改 `check-merge-conditions.sh`（#604 刚合，不动）／改 `gen-cto-health.py`（B 口径不在本卡）／改 `probe-ladder.ts`（只读契约）／改 `.gitea/**`（不接 CI） | §2 |
| **⑤** | 最危险的假设：**先实测** | 假设「PR/任务能自动映射到"线"」⇒ **实测为假**：`@7a17677da` 17 个 open PR 里**仅 3 个分支带包前缀**（`ct/p10-*`×2、`ct/p4-*`×1）；`task-state/*.json` 468 份**无 line/package 字段**；`.claude/task-briefs` 472 份**仅 5 份**文件名带 `p<N>`；claims 30 份。⇒ **必须设计多判据映射 ＋ `unknown`/`ambiguous` 显式兜底**（§4bis） | §3／§4bis |
| **⑥** | 失败路径：先写反例 | ① `unknown` 桶被静默丢弃 ⇒ ② 例外清单是假的；② 无在飞 PR 当 100% ⇒ 判据通过率造假；③ API 不可达当"0 在飞" ⇒ 假绿。三条都必须红（§4.3） | §4 |
| **⑦** | 边界：不做什么？ | 逐条路径见 §1.2：`scripts/audit/**`（K3）／`check-merge-conditions.sh`／`gen-cto-health.py`／`probe-ladder.ts`／`.gitea/**`／`src/**` | §1 |
| **⑧** | 可观测 | 一条命令：`npx tsx scripts/control-tower/probe-line-signals.ts --all` ⇒ 每线一行三信号 ＋ 末行 `LINE-SIGNALS: …`；`--line P7` 单线；`--json` 结构化 | §4 |
| **⑨** | 拆步 | 3 步：**S1** 映射层（三判据＋unknown/ambiguous）→ **S2** 三信号聚合（①②③）→ **S3** `--selfcheck`（改坏必红）。每步可独立验；单文件新建 ⇒ 可整体 revert | 封面／§8 |

---

## §1 做什么

### 1.1 目标（一句话 ＋ 可观测结果）

**目标**：一条命令按**线（包 P1–P10）**输出**回执三信号** —— ① 判据通过率 ② 例外清单 ③ 在飞/卡数 —— 全部取自机器真值，**不读人写的进度表**。

**可观测结果**：
1. `--all`：每线一行（`P7 ①=2/3 ②=1 条 ③=2 在飞/1 卡`），＋ 末行机器行；
2. 无法归线的 PR/Issue **不被丢弃**：进 `unknown` 桶并在 ② 例外里点名（`--all` 末行显示 `unknown=<n>`）；
3. 三态：`0` 全部可读且无未知／`1` 有例外或存在 unknown/ambiguous／`2` 取不到真值（API/git 失败）或**信号量==0**。

### 1.2 非目标（逐条路径；L2 不许碰）

- ❌ `scripts/control-tower/check-merge-conditions.sh`（#604 刚合，**只读调用**，一行不改）
- ❌ `scripts/control-tower/gen-cto-health.py`（B 口径健康三信号已在算，**不重复建设**）
- ❌ `scripts/control-tower/probe-ladder.ts`（**只读契约**：本件照其 `RESULT=`/三态口径，不改它）
- ❌ `.gitea/**`（不接 CI 硬阻断；CTO 令②）
- ❌ `scripts/audit/**`（K3 专属）｜`src/**`｜`extensions/**`
- ❌ 不写人读进度文档（`docs/synova/CTO-HEALTH.md` 属 `gen-cto-health.py`；本件只发信号与打印）
- ❌ 不判"某线该不该开工/优先级"（那是 CTO）

---

## §2 在哪做（写集 ＋ 结构）

| 文件 | 操作 | 归属 | 说明 |
|---|---|---|---|
| `scripts/control-tower/probe-line-signals.ts` | **新建** | W1 | 主件（`npx tsx`；照 `probe-ladder` 的 `RESULT=`／三态口径） |
| `tests/control-tower/probe-line-signals.test.sh` | **新建** | W2 | 配对测试（**CT-40 只强制 sh/py 配对；本件属主动加固**；写集扩 1 行待批 B7-b） |
| `memory/notes/implemented/2026-10-19-p7-probe-line-signals.md` | **新建** | W3 | 四态 Note（铁律 49） |
| `docs/authority/DOCS-REGISTRY.yaml` | **改 1 条** | W4 | 登记（`docs/AGENTS.md` 强制；与 B7-b 同批） |
| `.claude/task-briefs/2026-10-19-p7-probe-line-signals.md` | **已落（L1）** | — | 派单件先于实现；L2 只读 |

**结构（W1 五段，行锚为预估）**：① 头部契约 `@input/@output/@exit/@degraded/@authority`（铁律 47）｜② 常量与环境（`SYNO_GITEA_API`、token 三级、UTF-8、degraded log）｜③ **映射层**（§4bis）｜④ **三信号聚合**（①②③）｜⑤ `--selfcheck` ＋ 输出编排。

---

## §3 凭什么做（现状证据，逐条可复跑）

| # | 事实 | 命令 ⇒ 输出（`as_of 7a17677da`） |
|---|---|---|
| F1 | **无按线三信号的件** | `grep -rln "回执三信号\|判据通过率" scripts/` ⇒ 仅 0 处编排实现（`gen-cto-health.py` 是 B 口径：`grep -n "三信号" scripts/control-tower/gen-cto-health.py` ⇒ 指绕过/拒绝/M 复发） |
| F2 | 探针契约已有单一实现 | `scripts/control-tower/probe-ladder.ts` 头部：13 探针、`RESULT=<PASS\|DEGRADED\|ERROR>`、三态退出码、`--targets` 单点解析 |
| F3 | 信号发射已有 | `scripts/control-tower/emit-signal.py`（`@output .codex/signals/{component}.json`；`@degraded` 目录不可写 ⇒ 显式） |
| F4 | 四条件已有机器判定（① 的真相源） | `scripts/control-tower/check-merge-conditions.sh --pr <N> --json` ⇒ `{conditions:{ci,overlap,review,serial}, verdict, exit}` |
| F5 | 🔴 **线映射没有现成字段** | open PR 17 个中仅 3 个分支带包前缀（`ct/p10-1018`、`ct/p10-doc-contract-600`、`ct/p4-gate-count-1019`）；`task-state/*.json` keys 无 `line/package`（实测 `list(d.keys())`）；`ls .claude/task-briefs/*.md \| wc -l`=472 中 `grep -cE "p[0-9]+"`=5；`ls .claude/claims/*.yaml`=30 |
| F6 | 包写集**可解析但半结构化** | `agents/P*/AGENTS.md` §四：`｜` 分隔、`（…）` 注解、`{a,b}` 展开、`（👁）` 只读（例：P4 `scripts/control-tower/**（除 probe-*.ts 与 install-deps.sh）｜tests/control-tower/**｜.gitea/**`） |
| F7 | 既有三态/降级约定可照抄 | `grep -l "exit 2" scripts/control-tower/*.sh \| wc -l` ⇒ 38；degraded 日志 8 件；UTF-8 强制 33/45 |
| F8 | 卡数有机器真值 | open PR 数（API）；Issue 状态（API）；`task-state` 状态分布实测：`impl_done 212／audited 126／claimed 68／spec_done 24／closed 15／in_progress 13／registered 4／…` |

**若 F1–F8 任一不成立 ⇒ 停，退回 L1。**

---

## §4bis 🔴 线映射口径（**本件拟定，待 CTO 确认 B-7-a**）

> 事实基础：F5（无现成字段）。**原则：宁可显式 unknown，不许猜。**

**线集**：`agents/P*/AGENTS.md` 的 10 个包（`P1`…`P10`），按目录名解析（`P<N>-<名>`）。

**PR → 线（按序取首个唯一命中；冲突即 ambiguous）**：
```
M1 分支前缀：head.ref 匹配 ^(ct|feat|fix|docs|chore)/(p[0-9]+)[-_]   ⇒ 该包
M2 变更文件 ∩ 包写集：把 PR 的 `git diff --name-only <mb>..<head>` 与每包 §四 写集做**前缀/通配**匹配
                      （支持：字面路径、`dir/**`、`{a,b}` 展开；**不支持**任意 glob；`（除 …）` 为排除项）
M3 标题前缀：PR title 匹配 ^[a-z]+\((p[0-9]+|k[0-9]+)\)  或含 `P<N>` 词边界   ⇒ 该包
冲突：M1/M2/M3 命中 ≥2 个不同包 ⇒ ambiguous（点名列全部候选）
全不中：unknown（点名 PR 号）
```

**Issue → 线**：标题 `^P<N>` 词边界（实测：`P4 · 2.5 S1…`、`P7-2 · …`、`P10 · docs…`）⇒ 该包；否则 unknown。
**task-state → 线**：**v1 不做**（无字段，F5）—— 在 README/输出里**显式声明**该口径缺席（Known Limitations），**禁**用文件名猜。

---

## §4 怎么算做完（三路径 ＋ DS）

### 4.1 正常路径

```bash
npx tsx scripts/control-tower/probe-line-signals.ts --all
# 期望：每线一行（例 `P7 ①=2/3 ②=1 条 ③=2 在飞/1 卡`）；末行 `LINE-SIGNALS: lines=<n> unknown=<n> ambiguous=<n>`
npx tsx scripts/control-tower/probe-line-signals.ts --line P7
# 期望：只 1 行 + 该线例外清单逐条
npx tsx scripts/control-tower/probe-line-signals.ts --all --json | python3 -m json.tool >/dev/null && echo JSON-OK
bash tests/control-tower/probe-line-signals.test.sh   # 期望：末行 `结果: N 通过, 0 失败`
```

### 4.2 降级（必须仍可触发）

```bash
SYNO_GITEA_API=http://127.0.0.1:1/api/v1 npx tsx … --all; echo $?    # 期望 exit 2 + degraded:
# 信号量==0：造一个"0 open PR"的夹具 ⇒ 期望 exit 2（看不见≠没问题），不得输出 0/0 当通过
```

### 4.3 🔴 反例（**改坏必红**）

| 子例 | 改坏什么 | 期望 |
|---|---|---|
| **A** 基线 | 夹具 3 线：一线全绿、一线有例外、一线有 unknown | exit 1；`unknown=1` 出现在末行与 ② 明细 |
| **B** 静默丢弃 unknown | 把 unknown 桶从 ② 里删掉 | 必红（末行 `unknown=` 与明细不一致） |
| **C** 无 PR 当 100% | 把 `n/a` 改写成 `1/1` | 必红（该线①必须显示 `n/a`） |
| **D** API 不可达当 0 在飞 | 让 API 500 后返回"0 在飞" | **exit 2**（fail-closed），不得 exit 0/1 |
| **E** 混入 B 口径 | 在输出里加"绕过次数" | 必红（口径守卫：只允许三信号键） |
| **F** 映射歧义吞掉 | 让某 PR 同时命中两个包 ⇒ 归到其中一个 | 必红（必须 ambiguous 并点名候选） |

**判别力判据**：A 必须 exit 1 且 B–F 全红/降级；任一不符 ⇒ `SELFCHECK-FAIL`（exit 2）。

### 4.4 DS（交付声明）

| # | 声明 | 核验 |
|---|---|---|
| DS-1 | 三信号按线可读 | §4.1 首条命令输出逐线一行 |
| DS-2 | unknown/ambiguous **不丢** | `--all` 末行计数 = ② 明细条数 |
| DS-3 | 无在飞 PR ⇒ `n/a`（非 100%） | 子例 C |
| DS-4 | fail-closed | 子例 D／`--all` 无 API ⇒ exit 2 |
| DS-5 | 口径守卫（只 A 三信号） | 子例 E |
| DS-6 | 映射三判据 ＋ 冲突点名 | 子例 F；`--json` 含 `mapping: {by: M1\|M2\|M3\|ambiguous\|unknown}` |
| DS-7 | 只读 | 运行前后 `git status --porcelain` 不变 |
| DS-8 | `--json` 合法且键固定 | `{tool, lines[], unknown[], ambiguous[], summary{lines,unknown,ambiguous}, exit}` |
| DS-9 | 三态退出码 | 0/1/2 三路径各一例 |
| DS-10 | 配对测试零失败 | W2 `结果: N 通过, 0 失败` |

---

## §5 怎么跑

```bash
git -C /Users/wane/SynovaAgent fetch gitea
git -C /Users/wane/SynovaAgent worktree add .synova-wt-p7probe-$(date +%m%d) -B ct/p7-probe-$(date +%m%d) gitea/local-main
# 依赖：node ≥ v22（npx tsx）；无新增第三方包（tsx 已在仓内 devDeps，实测 `npx tsx --version` 可用）
# token：$HOME/gitea/.win-push-token（或 GITEA_TOKEN / SYNO_GITEA_TOKEN）
# 端口：无（纯 CLI）；Gitea 占 3000
# 落盘：证据放 docs/evidence/p7-probe/（.gitignore 覆盖 ⇒ 不入库）
# 自检：npx tsx scripts/control-tower/probe-ladder.ts --all（应 exit 0；证明脚本运行环境对）
```

---

## §6 有什么基础（既有基础盘点 · 禁止重复建设）

| 能力 | 盘点命令 | 命中 | 结论 |
|---|---|---|---|
| 探针契约（`RESULT=`／三态／`--targets` 单点解析） | `head -40 scripts/control-tower/probe-ladder.ts` | 13 探针契约 | **复用口径**（照抄契约，不改它） |
| 信号发射 | `head -20 scripts/control-tower/emit-signal.py` | `.codex/signals/{component}.json` | **复用**（三信号结果发一份 signal） |
| 四条件机器判定（① 的真相源） | `bash scripts/control-tower/check-merge-conditions.sh --pr 604 --json` | `conditions{ci,overlap,review,serial}` | **复用（只读调用）** |
| 健康三信号（B 口径） | `grep -n "三信号" scripts/control-tower/gen-cto-health.py` | 绕过/拒绝/M 复发 | **不复用/不重复**（口径 B 已裁不做） |
| 看板真值/指标 | `ls scripts/control-tower \| grep -E "check-board"` | `check-board-metrics.ts`／`check-board-truth.ts` | **不复用**（看板 ≠ 回执三信号） |
| 任务状态 | `ls task-state/*.json \| wc -l`；`list(keys)` | 468 份；**无 line/package 字段** | **v1 不用于映射**（Known Limitations） |
| 写集声明（S0） | `ls .claude/claims/*.yaml \| wc -l` | 30 份 | **不复用**（claims 是 PR 级写集，非线映射） |
| 施工项登记（48 项/12 块，含 paths） | `head -30 docs/synova/coordination/施工项登记.ts` | 48/12 | **不复用 v1**（块 ≠ 包；留作 v2 映射源，记 Known Limitations） |
| 包写集（线映射 M2 的数据源） | `for d in agents/P*/; do awk '/^## 四、/' "$d/AGENTS.md"; done` | 10 包全有 §四 | **复用**（解析，见 §4bis M2） |
| 三态/降级/UTF-8 | `grep -l "exit 2" scripts/control-tower/*.sh \| wc -l` | 38 件 | **复用**（四约定） |

**结论**：**复用 8 项，新建 1 件**（按线聚合的编排层）；**不重复** B 口径健康三信号。

---

## §7 前置与红线

| 前置 | 判据 | 未满足 |
|---|---|---|
| 口径 A 已裁 | 本件 §〇 前置口径 | 停 |
| 线映射口径 CTO 确认 | 附录 B-7-a 已批 | 停（映射口径是判据，归 CTO） |
| W2 写集扩 1 行 | 附录 B-7-b 已批 | 停（不批则不带测试，CT-40 不强制但交付面塌） |
| 分支从 `gitea/local-main` 取 | `git merge-base --is-ancestor` ⇒ 0 | 停 |

**红线**：❌ `scripts/audit/**`｜❌ `.gitea/**`｜❌ `check-merge-conditions.sh`／`gen-cto-health.py`／`probe-ladder.ts` 一行不改｜❌ 主树写码｜❌ `git stash`｜❌ 把 unknown 静默丢弃｜❌ 用 task-state 文件名猜线。

---

## §8 交什么

```
R2 指针 ≤10 行：批次名 ｜ 写集（逐文件）｜ 自验结论 ｜ 证据 ｜ 未决项
证据：原始输出（禁截断）；三信号实跑样例含 unknown/ambiguous 各 1 条
回执三信号：① 判据通过率（绿/红）② 例外清单 ③ 在飞数
🔴 不判"通过"：只能给自验结论／可提请独立复核／退回
```

---

## C1 契约

```
@input  --all | --line <P1..P10> | --json | --selfcheck | --repo-root <path>
        环境：SYNO_GITEA_API（缺省 http://127.0.0.1:3000/api/v1）、GITEA_TOKEN/SYNO_GITEA_TOKEN/$HOME/gitea/.win-push-token
        夹具注入缝：SYNO_LINE_SIGNALS_FIXTURE=<json>（零网络；测试/自检用）
@output 每线一行：`<P#> ①=<pass>/<total>|n/a ②=<n> 条 ③=<n> 在飞/<n> 卡`
        末行：`LINE-SIGNALS: lines=<n> unknown=<n> ambiguous=<n>`；`--json` 见 DS-8
@exit   0 = 全部可读且 unknown=ambiguous=0 且无例外；1 = 有例外/unknown/ambiguous；2 = 取不到真值（API/git/JSON）或信号量==0
@degraded 一律 stderr `degraded: <原因>` + (可选 .codex signals) + exit 2；禁静默
@authority 任何会话可调（只读）；不执行合并/派单/改状态
```

## C2 边界值

| 边界 | 期望 |
|---|---|
| open PR = 0（API 200 + []） | **exit 2**（信号量==0，看不见≠没问题） |
| 某线 0 在飞 PR | 该线 ① 显示 `n/a`，不计 100% |
| 某线只有 unknown 项 | 该线 ①`n/a`，② 点名 unknown，总 exit 1 |
| PR 命中 2 包 | ambiguous，点名候选，不计入任一线 |
| 标题/分支/路径全不中 | unknown 桶 |
| Issue 标题无 `P<N>` | unknown（不计卡数） |

## C3 失效条件

- **何时可撤**：`task-state` 增加 `line/package` 字段 且 `施工项登记` 块→包映射落库 ⇒ 映射改单一判据，本件的 M2 路径匹配退役。
- **前提变更**：包集变化（P1–P10 增删）⇒ 映射自动跟随 `agents/P*/` 目录，**不得硬编码 10**（禁写死）。
- **口径变更**：若创始人改回 B 或混合口径 ⇒ 本件显式 fail（口径守卫），另出规格。

---

## 附录 A · 证据（as_of `7a17677da`）

```
A.1 无按线三信号件：grep -rln "回执三信号|判据通过率" scripts/ ⇒ 0 处编排实现
A.2 probe-ladder 契约：13 探针 / RESULT= / 三态（scripts/control-tower/probe-ladder.ts:1-40）
A.3 emit-signal：.codex/signals/{component}.json（scripts/control-tower/emit-signal.py:1-20）
A.4 四条件 --json：{tool,pr,base,tip,head,fp,conditions{ci,overlap,review,serial},verdict,exit}
A.5 映射实测：open PR 17；带包前缀分支 3（ct/p10-1018、ct/p10-doc-contract-600、ct/p4-gate-count-1019）；
    task-state 468 份无 line 字段；task-briefs 472 份仅 5 份含 p<N>；claims 30
A.6 包写集：10 包 §四 全在（格式半结构化：｜ 分隔、（）注解、{a,b}、👁）
A.7 三态/降级约定：38 件带 exit 2；8 件带 degraded 日志；UTF-8 33/45
A.8 task-state 分布：impl_done 212／audited 126／claimed 68／spec_done 24／closed 15／in_progress 13／registered 4／rejected 2／audit_done 1／pending 1／delivered 1
```

## 附录 B · 需 CTO 一句话（2 条）

| # | 事项 | 证据 | 建议 |
|---|---|---|---|
| **B7-a** | **线映射口径**（§4bis：M1 分支前缀／M2 写集交集／M3 标题；冲突=ambiguous，全不中=unknown；task-state v1 不映射） | F5 实测：无现成字段 | **批**（本件已按此写死，实现不得改）；若你要改口径，请一句话，本件重出 |
| **B7-b** | **写集扩 2 行**：`tests/control-tower/probe-line-signals.test.sh`（CT-40 只管 sh/py，**本件主动加固**）＋ `docs/authority/DOCS-REGISTRY.yaml`（docs/AGENTS.md 强制登记） | P7 §四 枚举未含 | **批**（同 B1 先例）；不批 ⇒ 交付面少测试与登记 |

## 引用豁免

- scripts/control-tower/probe-line-signals.ts — 本交付新建件（W1），交付前不存在
- tests/control-tower/probe-line-signals.test.sh — 本交付新建件（W2），交付前不存在
- memory/notes/implemented/2026-10-19-p7-probe-line-signals.md — 本交付新建件（W3），交付前不存在
- .claude/task-briefs/2026-10-19-p7-probe-line-signals.md — 本交付新建件（卡面，L1 派单前落）

## 附录 D · 派单内部一致性自检

| 检查 | 结论 |
|---|---|
| 写集 vs 非目标 | W1–W4 与 §1.2 禁碰路径零交集 |
| 口径 A vs B | 只输出 A 三信号；B 由 `gen-cto-health.py` 承担，本件不碰（子例 E 守卫） |
| unknown vs 100% | unknown 必须进 ②；无 PR ⇒ `n/a`（子例 B/C） |
| 「0 open PR」 vs 「API 失败」 | 前者 exit 2（信号量==0），后者 exit 2（fail-closed）—— **两者都 exit 2 但 reason 不同**（点名可区分） |
| 映射冲突 | ambiguous 不进任一线，计入末行计数（子例 F） |
