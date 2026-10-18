---
status: proposed
日期: 2026-10-18
任务: Issue #566
撰写: P4（门禁包负责人）· 独立于实现者
依据: handbook《包自足性审查-协议v2》（v1 十项 ＋ v2 第 11 项）｜`agents/P4-门禁/AGENTS.md` §十二｜CTO 裁定 188
---

# SYNOVA-IMPL-566 · P4 交付 0：包自足性审查脚本（十项机器判 ＋ 判别力自检）

> 🔴 **本件是执行小队的唯一规格源（dev doc）**。口径已由 **CTO 裁定 188** 裁死（见 §4bis）；实现方**不得自行改口径**。
> 🔴 **范围**：协议 v2 的**第 1–10 项**。**第 11 项「预设可加载性」不属本脚本范围**（CTO 裁定 188 §A；协议 v2 §六 亦自标"另设/后接"）。
> 🔴 **冻结**：本文件以 commit blob SHA 冻结（派单时给 blob SHA）；实现方引用 blob，不引用可变工作树。

---

## §〇 归属与依据（派单七问）

| # | 问 | 答 |
|---|---|---|
| 1 | 谁派 / 依据 | CTO 裁定 188（plan 通过 ＋ Q1–Q4 口径定稿 ＋ 工作流改判）；创始人 2026-10-18 明令"用 dev doc ＋ 执行小队" |
| 2 | 归属包 / 产品线 | **P4 门禁**（治理线）｜域：`scripts/control-tower/`、`tests/control-tower/` |
| 3 | 写集 | 见 §4（W1–W5，文件级、两两不重叠） |
| 4 | 判据 | 见 §7（正常/降级/反例）＋ §11 DS-1…DS-11 |
| 5 | 依赖 | 见 §9（全部已完成，无阻塞） |
| 6 | 不做什么 | 见 §3.2（逐条列路径） |
| 7 | 回执 | 成员报队长：三信号 ＋ R2 指针 ≤10 行；证据 = 原始输出，禁截断 |

## 权威件回执（派单前实读，读过才写）

| 件 | 位置 | as_of | 读了什么（不是"提过"） |
|---|---|---|---|
| 包自足性审查协议 v2 | handbook `包自足性审查-协议v1.md`（文内含 §六 v2 第 11 项） | handbook `fe2ac0d` | 十项判据原文＋五步流程＋迭代规则；确认第 11 项不属本脚本 |
| P4 包守则 | `agents/P4-门禁/AGENTS.md` §十／§十一／§十二 | `52cf86163` | 事实落点 5 条、自足性初审、交付 0 规格、合并例外 |
| skill 流程 | `.dsh/skills/package-selfsufficiency-audit/SKILL.md` | `52cf86163` | 五步流程、缺口分派（事实性→CTO／过程性→包负责人） |
| 域守则 4 份 | `scripts/control-tower/AGENTS.md`｜`tests/control-tower/AGENTS.md`｜`.gitea/AGENTS.md`｜`memory/notes/AGENTS.md` | `52cf86163` | 三态退出码+信号量==0⇒exit 2／零失败才合并／门禁须独立送审／非平凡须引四态 Note |
| CTO 裁定 188 | handbook `CTO-裁定台账.md` | handbook `fe2ac0d` | plan 验收、Q1–Q4 口径定稿、工作流改判（dev doc＋小队＋独立复核） |

## 1. 北星锚定

- **服务产品线的哪个验收点**：P4 目的「**门禁能真阻断、且 CTO 能看见**」；本件把《包自足性审查协议 v2》的十项判据从"人能记得做"变成"**机器每包必跑**"。
- **终态**：任何包开工前，一条命令给出 **10 包 × 10 项** 的红绿矩阵 ＋ 可贴派单的缺口清单；脚本对"故意改坏的守则"必须报红（判别力自检）。
- **对齐**：`agents/P4-门禁/AGENTS.md` §十二（交付 0）＋ §三（11 条逐条闭环，每条"改坏即红"）。
- **锚定不清即停**：本件不涉及产品方向；技术争议按 §10 升级 P4 → CTO。

## 2. 背景与现状证据

### 2.1 为什么需要（协议 v2 出生史，可核）

```
2026-10-18 创始人两问「信息是否完全」「流程是否符合任务性质」
⇒ 机器检查：判据无命令 9/10 ｜不做无路径 10/10 ｜域守则不在包守则 10/10 ｜事实落点 9/10 缺
⇒ P4 的 2.5 最典型：`protected_file_patterns` 等 4 个候选名全 0 命中（机制根本不存在，却被写成"改配置"）
```
依据：`.dsh/skills/package-selfsufficiency-audit/SKILL.md` §历史事故（本仓可读）。

### 2.2 三个真发现（CTO 裁定 188 §A 逐条核真）

| # | 发现 | 证据（可复跑） |
|---|---|---|
| F1 | **P7 的 ③ 引用未建件** `check-merge-conditions.sh` ⇒ 判据今天跑不了 | `git grep -F -l check-merge-conditions.sh HEAD -- .` ⇒ **0 命中** |
| F2 | **P3/P9/P10 写集是目录级**（无文件级扩展名） | 三者 §四 原文：`extensions/{presets,roles,grants}/**`／`extensions/**`／`.gitea/**` |
| F3 | **P3/P8/P10 依赖无状态词** | ③ 原文：`M1、M2｜K12-03 建档通道`／`P1/P2 起来后再开`／`P7（三信号探针）` |

### 2.3 现状机器事实（建在真 worktree，非 `git archive`）

```
repo worktree = .synova-wt-p4 @ 52cf86163（= gitea/local-main tip）
10 份包守则： agents/P*/AGENTS.md　（git ls-tree HEAD -- agents 实测 10 份）
门禁配对要求： scripts/control-tower/*.py ↔ tests/control-tower/*.test.sh（ct-test-gate.sh CT-40 硬拦）
python： 3.9.6（macOS 系统）；CI 侧同源 python3；禁第三方依赖
```

## 3. 目标与非目标

### 3.1 目标（本 PR 交付）

1. `scripts/control-tower/check-package-selfsufficiency.py`（新建）：十项机器判 ＋ `--selfcheck` ＋ 三态退出码。
2. `tests/control-tower/check-package-selfsufficiency.test.sh`（新建）：配对测试（CT-40 强制），覆盖正常/降级/反例。
3. 交付配套件：task brief（组 6）＋ 四态 Note（commit-msg 门禁/铁律 49）。
4. 验收对账：对 `52cf86163` 跑一次，矩阵与 CTO 手工矩阵一致（§附录 B）。

### 3.2 非目标（逐条列路径，禁碰）

```
❌ 不改 .gitea/**（pre-commit/CI 接线 = 四件套④，属交付 0b，另排期）
❌ 不改任何包守则 agents/P*/AGENTS.md（本脚本只读；判据语义归 CTO）
❌ 不碰 scripts/audit/**（K3 专属）
❌ 不改 scripts/control-tower/probe-*.ts（M6 独占）
❌ 不改 scripts/control-tower/install-deps.sh（M1 域）
❌ 不实现协议第 11 项「预设可加载性」（CTO 裁定 188）
❌ 不改 scripts/pre-commit-check.sh（接线另批）
```

## 4. 写集（逐文件；两两不重叠；文件级）

### 4.1 写集 (5 新建)

| 文件 | 操作 | 说明 |
|---|---|---|
| scripts/control-tower/check-package-selfsufficiency.py | 新建 | W1 · 编码 A |
| tests/control-tower/check-package-selfsufficiency.test.sh | 新建 | W2 · 编码 B（CT-40 强制配对） |
| .claude/task-briefs/2026-10-18-p4-package-selfsufficiency-checker.md | 新建 | W3 · P4（派单件，随 dev doc 先行提交；组 6 六字段） |
| memory/notes/implemented/2026-10-18-p4-package-selfsufficiency-checker.md | 新建 | W4 · 编码 B（commit-msg/铁律 49） |
| docs/plans/codex/implementation/SYNOVA-IMPL-566-p4-package-selfsufficiency-checker-20261018.md | 新建 | W5 · P4 已写并冻结，任何人不得改 |

> W2 与 W1 **不重叠**（脚本 vs 测试）；W3/W4 为交付配套件（CTO 裁定 168-C：默认可写，不需逐次报批）。
> 工作树：**全部在 `.synova-wt-p4`（真 worktree）**；主树 `/Users/wane/SynovaAgent` 禁写。

## 4bis. 🔴 口径裁决（CTO 裁定 188 §B，**原样照录，实现不得改**）

```
Q1 写集：显式"不改代码／不写生产码" = 精确的无写集声明 ⇒ ✅（P5/P8 由此转绿）
Q2 依赖：状态词集合 = 无 / 无（…）/ 不依赖 / 已完成 / 已合(入) / 已落地 / 已交付 /
         过审 / 进行中 / 未开始 / 未开工 / 不存在 / 阻塞
Q3 域守则：≥1 份 AGENTS.md ＋ 节标题声明"必须显式 read" = 已给用途；
          无逐条用途 ⇒ 记信息级备注，不阻断
Q4 落点：②③ = 引用（必须存在）｜④ = 目标（父目录在即可；"除…"为排除项）
追加：🟡 仍 exit 1（半自动项未确认不当作通过，fail-closed），但矩阵必须显式区分「🔴 缺口」与「🟡 待人工」；
     人工结论的机器可读落点 = 包守则 §十一
```

## 5. 契约（铁律 47：输入/输出/降级/错误码）

```
@input   --packages P1,P4     可选，逗号分隔（默认 = 发现到的全部包）
         --json               可选，输出结构化 JSON（stdout 仅 JSON）
         --ref <git-ref>      可选，默认 HEAD
         --selfcheck          可选，判别力自检（fixture 跑三子例）
         --help               用法
         运行环境：git 可用；cwd 任意（repo root 由脚本自身位置解析）
@output  ① 10×10 矩阵（✅/🔴/🟡 + 图例）② 缺口清单 ③ 信息级备注 ④ 待人工确认清单
         ⑤ 汇总行 `SELFSUFFICIENCY: PASS|GAP(n)|DEGRADED  signal=<N> red=<n> pending=<n> exit=<0|1|2>`
         --json：{tool, protocol, scope_items, repo, ref, as_of, signal_count, matrix, evidence,
                  gaps[], notes[], manual_pending[], summary{green,red,pending}, exit}
@exit    0 = 全部 ✅
         1 = 有 🔴 缺口 或 🟡 待人工（🟡 **不视为通过**）
         2 = 检查自身失败/降级（git 不可用、ref 无效、**信号量==0**、请求的包不存在、解析/内部异常）
@degraded 一律 stderr 一行 `degraded: <原因>` + exit 2（铁律 11；绝无 `except: pass`）
只读：不写任何仓库文件；selfcheck 只在系统临时目录建一次性 fixture
```

### 5.1 十项判法（逐项算法；Q1–Q4 已内嵌）

**解析基座**：`git -C <script_dir> rev-parse --show-toplevel` 得 repo；`git show <ref>:<path>` 读内容（**不读工作树**）；标题正则 `^##\s+([一二三四五六七八九十]+)、\s*(.*)$`；节体 = 标题行之后至下一 `##`；`_section(n)` 缺节返回 **None**（不得返回空串）。

| # | 判据 | 判法（实现级） | 红/绿特征 |
|---|---|---|---|
| 1 | 落点存在性 | **引用**（②③）：反引号 token → 路径化（去尾部标点；接受"含 `/` 且无空格/`=`/`<`/`>`/`∧`/`{`/`,`"或"裸文件名带已知扩展名"；拒 `..` 开头/`@`/`#`）→ `{a,b}` 展开 → `git cat-file -e <ref>:<p>` 或 `git ls-tree <ref> -- <p>` 非空；裸文件名按 `ls-tree -r` basename 索引（≥1 命中）。**目标**（④）：按 `｜`/换行切段 → `（除…）` 为排除项跳过、其它括号内提取路径 → token 抽取（`*.ts` 等扩展名 或 `/**`）→ 存在即过；**不存在则父目录存在即过并记"新建"**；父目录也不存在 ⇒ 🔴。④ 含"不改代码/不写生产码/无写集"⇒ ✅（Q1） | 引用缺 ⇒ 🔴；目标无父 ⇒ 🔴 |
| 2 | 判据可执行 | ③ 同时命中**命令 token**（`bash\|git\|npm\|npx\|python3\|node\|curl` 词边界 或 `--flag`）**且**命中**反例 token**（`改坏\|必红\|反例`） | 缺任一 ⇒ 🔴，点名缺哪半 |
| 3 | 写集精确 | ④ 命中文件级扩展名（`.ts/.tsx/.sh/.md/.json/.yml/.yaml/.mjs/.cjs`）**或** Q1 的无写集声明 | 否则 🔴 |
| 4 | 依赖明确 | ⑤ 非空 且 命中 Q2 状态词集合（"无"单独成词算命中） | 否则 🔴 |
| 5 | 不做含路径 | ⑥ 存在任一反引号 token 含 `/` 或以 `/**` 结尾 | 否则 🔴 |
| 6 | 域守则清单 | ⑦ 命中 ≥1 个 `` `…AGENTS.md` ``，且（节标题含"必须显式"**或** ≥1 条项带 `（…）` 用途）；**逐条无用途 ⇒ 信息级备注，不阻断**（Q3） | 无 AGENTS.md 或两者皆无 ⇒ 🔴 |
| 7 | 事实落点 | 存在标题含「事实落点」的节 | 缺节 ⇒ 🔴（不是跳过） |
| 8 | 编号可查（半自动） | 全文抽 `B\d+`／`\d+\.\d+`／`K\d+-\d+`（词边界）→ `git grep -F -l <token> <ref>`：命中 ⇒ ✅（记命中文件数）；**0 命中 ⇒ 🟡**；无编号 ⇒ ✅ 且证据"0 个编号（N/A）"；§十一 有该格人工结论 ⇒ 采用并注明依据 | 🟡 待人工 |
| 9 | 跨仓摘要（半自动） | 扫含 `handbook`/`过程档案` 的行：**位置指针排除**（同时含 `→` 与 README/入口/过程件/在飞）；其余按**同前缀连续块**计非路径正文（去反引号/标记/空白）≥30 字 ⇒ ✅；否则 🟡；无此类引用 ⇒ ✅ 且证据"0 行（N/A）"；§十一 人工结论优先 | 🟡 待人工 |
| 10 | 合并规则 | 全文命中 `四条件\|自合并\|合并例外` | 否则 🔴 |

**防御断言**：1–7/10 只允许 `✅/🔴`；8/9 只允许 `✅/🟡`；任何其它值 ⇒ exit 2（不许静默放行）。

### 5.2 退出码落点（三态，硬要求）

| 情形 | exit | 落点 |
|---|---|---|
| 全 ✅ | 0 | `red==0 and pending==0` |
| 任一 🔴 或 🟡 | 1 | 🟡 计入（fail-closed） |
| git 不可用 / `rev-parse --verify <ref>^{commit}` 失败 | 2 | `degraded: git 不可用` / `degraded: ref 无效: <ref>` |
| **信号量==0**（`git ls-tree -r --name-only <ref> -- agents` 过滤 `^agents/P\d+-[^/]+/AGENTS\.md$` 得 0 份） | 2 | `degraded: 发现 0 份包守则（信号量==0）`，必打印 `signal=0` |
| `--packages` 请求的包不存在 | 2 | `degraded: 请求的包守则不存在：PXX` |
| 解析/内部异常 | 2 | `degraded: <原因>`（含单文件读失败、非法 verdict） |

### 5.3 `--selfcheck`（判别力自检）

```
fixture = tempfile.mkdtemp() + `git init -q` + 写 agents/P0-自测/AGENTS.md（十项全绿基线）
          + README.md + src/example.ts + scripts/selftest.sh
          + `git add -A` + `git -c user.email=… -c user.name=… commit -qm fixture`
子例 A 基线        ⇒ 期望 10 项全 ✅ · inner exit 0     （证明正向路径不是写死红）
子例 B 改坏        ⇒ 仅删 §三 的 `bash …` 命令 · 其余原样 ⇒ 期望 ② 🔴 · inner exit 1（**判别力**）
子例 C 空仓        ⇒ 无 agents/ ⇒ 期望 inner exit 2（**信号量==0**）
输出：每个子例打印 `[selfcheck] A/B/C … inner_exit=<n> verdict=<...>`
成功（三子例全符合） ⇒ 外层 **exit 1** ＋ `SELFCHECK-OK: 改坏必红（B inner=1）；空仓信号量==0（C inner=2）`
失败（任一条不符合，尤其 B 被判绿） ⇒ 外层 exit 2 ＋ `SELFCHECK-FAIL: <哪条>`（fail-closed；绝不 exit 0）
fixture 只在系统临时目录；结束 `shutil.rmtree`；**绝不写产品仓**
```

## 6. 边界值清单

| 参数/情形 | 空 | 单元素 | 恰临界 | 超限/异常 | 零/负 |
|---|---|---|---|---|---|
| `--packages` | 空串 ⇒ 按默认全集 | `P4` ⇒ 单行 | 全部 10 ⇒ 10 行 | 不存在的包 ⇒ exit 2 | — |
| 包守则文件数（信号量） | **0 ⇒ exit 2** | 1 ⇒ 正常 | 10 ⇒ 正常 | — | 0 = 临界，必须 exit 2 |
| 节缺失 | §三/§四/§五/§六/§七 缺 ⇒ 对应格 🔴 | — | — | 全文解析不出任何节 ⇒ 10 格全 🔴（不是 exit 2；文件读到了） | — |
| 反引号 token | 0 个 ⇒ ① 视为 N/A（若 ④ 也无目标且无声明 ⇒ 🔴） | 1 个 ⇒ 正常 | — | 超长/含空格 ⇒ 非路径，忽略 | — |
| 编号 | 0 个 ⇒ ⑧ ✅ N/A | 1 个 ⇒ 正常 | 全部命中 ⇒ ✅ | 0 命中 ⇒ 🟡 | — |
| handbook 引用 | 0 行 ⇒ ⑨ ✅ N/A | 1 行 ⇒ 按块判 | 正文恰 30 字 ⇒ ≥30 全 ✅ | <30 ⇒ 🟡 | — |
| `--ref` | 空 ⇒ 视为未给（默认 HEAD） | `HEAD` | SHA | 不存在/非 commit ⇒ exit 2 | — |
| 写集目标 | ④ 只有"不改代码" ⇒ ✅ | 1 目标 | 多目标 | 目标无父目录 ⇒ 🔴 | — |
| 退出码 | — | — | — | `--selfcheck` 成功 = 1（非常规语义，已在 §5.3 固化） | — |

## 7. 验收标准（三路径 ＋ 命令 ＋ 原始输出要求）

> **在 `.synova-wt-p4`（`52cf86163`）上执行**；原始输出整段贴回执，禁 `head` 截断。

### 7.1 正常路径

```bash
python3 scripts/control-tower/check-package-selfsufficiency.py
# 期望：exit 1；打印 10×10 矩阵；② 10 红／⑤⑥⑩ 全绿／⑦ 除 P4 外全红（= §附录 B）；
#       末行 SELFSUFFICIENCY: GAP(26) signal=10 red=26 pending=0 exit=1
python3 scripts/control-tower/check-package-selfsufficiency.py --packages P4
# 期望：exit 1；只 1 行（P4）；仅 ② 红
```

### 7.2 降级路径

```bash
python3 scripts/control-tower/check-package-selfsufficiency.py --ref nosuchref
# 期望：exit 2；stderr 含 degraded:
# 空仓（沙箱内无 agents/）：期望 exit 2 + "信号量==0"
python3 scripts/control-tower/check-package-selfsufficiency.py --json | python3 -m json.tool
# 期望：合法 JSON；含 matrix/gaps/manual_pending/summary/exit
```

### 7.3 反例（改坏必红，本件核心判别性）

```bash
python3 scripts/control-tower/check-package-selfsufficiency.py --selfcheck
# 期望：exit 1；输出含 SELFCHECK-OK；B 子例显示 ② 🔴 / inner_exit=1；C 子例 inner_exit=2
# 若 B 被判绿 ⇒ 输出 SELFCHECK-FAIL + exit 2（视为交付不合格）
```

### 7.4 门禁与只读证明

```bash
bash tests/control-tower/check-package-selfsufficiency.test.sh   # 期望 exit 0
bash scripts/pre-commit-check.sh                                  # 期望 13 组全过（含 CT-40）
git -C /Users/wane/SynovaAgent/.synova-wt-p4 status --porcelain   # 运行脚本前后一致（只读）
```

## 8. 失效条件（无失效条件的规则不许进仓库）

- **退役判据**：协议升 **v3** 且 §一 判据编号/语义变更，或包守则改为机器可读结构化格式（本脚本的文本解析器被结构解析器取代）。
- **撤除动作**：删本脚本 ＋ 配对测试 ＋ pre-commit 接线（若有），并在 §十一 记一次审查记录。
- **不失效的前提**：十项判据仍以"文本节"承载。若该前提变了，本脚本必须同步改或退役（不得带病续跑）。

## 9. 依赖与前置

| 前置 | 状态 | 判据（何时算不阻塞） |
|---|---|---|
| Issue #566 | **已完成** | Gitea Issue 创建并可访问 |
| CTO 裁定 188（Q1–Q4 口径） | **已完成** | 口述已定稿，本文件 §4bis 原样照录 |
| 协议 v2 已在 handbook | **已完成** | `包自足性审查-协议v1.md`（含 v2 §六）可读 |
| 真 worktree `.synova-wt-p4` @52cf86163 | **已完成** | `git rev-parse HEAD` = `52cf86163` |
| git / python3 ≥3.9 | **环境已具备** | `git --version` / `python3 --version` |

> 前置未满足 ⇒ **停**，不抢跑（例如 git 不可用 ⇒ 脚本必须 exit 2，不得降级成"通过"）。

## 10. 风险与上限

| 风险 | 缓解 |
|---|---|
| 文本解析器脆弱（标题格式变） | 缺节一律 🔴；`--selfcheck` 固定结构做回归；本节 §8 给退役判据 |
| 半自动项（8/9）误判 | 第三态 🟡 ＋ §十一 人工落点；🟡 不阻断"看见"但阻断"通过" |
| 真实矩阵随包守则修复而变 | **配对测试不硬编码真实矩阵**；真实矩阵只在 §附录 B 作交付时点对账 |
| 单文件深改、口径漂移 | 口径已由 CTO 裁死（§4bis）；实现不符 ⇒ P4 退回重做，不得自行改口径 |
| 写集越界 | 逐文件写集（§4）；W1/W2 分写者；PR ≤12 文件（本件 5 文件）、单域 |
| 重型验证并发 | 自验/全量门禁**串行**，同时 ≤1（机器 8GB） |

## 11. DS 清单（delivery statements，供 K3 复审）

```
DS-1  默认跑 ⇒ exit 1；打印 10×10；② 10 红／⑤⑥⑩ 全绿／⑦ 仅 P4 绿（= 附录 B）
DS-2  --selfcheck ⇒ exit 1 ＋ SELFCHECK-OK；B 子例 ② 🔴/inner=1；C 子例 inner=2
DS-3  --packages P4 ⇒ 仅 P4 行；仅 ② 红
DS-4  --ref 无效 ⇒ exit 2 ＋ degraded；空仓 ⇒ exit 2 ＋ 信号量==0
DS-5  --json ⇒ 合法 JSON，含 matrix/gaps/manual_pending/notes/summary/exit
DS-6  配对测试 tests/control-tower/check-package-selfsufficiency.test.sh ⇒ exit 0（含 0/1/2 三态）
DS-7  bash scripts/pre-commit-check.sh ⇒ 13 组全过（含 CT-40 配对）
DS-8  脚本运行前后 git status --porcelain 不变（只读证明）
DS-9  纯 stdlib、python3.9 兼容；无 except:pass / || true；降级必 stderr degraded: + exit 2
DS-10 矩阵与 JSON 均显式区分 🔴 与 🟡；🟡 ⇒ exit 1
DS-11 task brief（组 6 六字段）与四态 Note（状态/日期/决策/理由）随 PR 提交
```

## 附录 A · 输出样例（形状，不是逐字）

```
P4 包自足性审查（协议 v2 · 第 1–10 项；第 11 项不属本脚本）
repo=<root>  ref=HEAD  as_of=52cf86163  signal=10  python=3.9.6

                  1  2  3  4  5  6  7  8  9 10
P1-能跑通         ✅ 🔴 ✅ ✅ ✅ ✅ 🔴 ✅ ✅ ✅
...
图例：✅ 通过 ｜ 🔴 缺口 ｜ 🟡 待人工确认（不视为通过）

## 缺口清单（26 条；可直接贴派单）
| 包 | 项 | 具体缺什么 | 建议补法 |
| P4-门禁 | ② 判据可执行 | ③ 无命令 token | §三 给 `bash <脚本> <参数>`＋期望输出；补"反例：改坏 <X> ⇒ 必红" |
...

## 信息级备注（不阻断）
| P7-交付自证与真值 | ⑥ 域守则 | 逐条无用例，仅节标题声明"必须显式 read" |

## 待人工确认（0 条）
SELFSUFFICIENCY: GAP(26)  signal=10 red=26 pending=0 exit=1
```

## 附录 B · 当前 10 包预期矩阵（@`52cf86163`，交付时点对账用）

```
包                  1  2  3  4  5  6  7  8  9 10
P1-能跑通           ✅ 🔴 ✅ ✅ ✅ ✅ 🔴 ✅ ✅ ✅
P2-能部署           ✅ 🔴 ✅ ✅ ✅ ✅ 🔴 ✅ ✅ ✅
P3-一致性           ✅ 🔴 🔴 🔴 ✅ ✅ 🔴 ✅ ✅ ✅
P4-门禁             ✅ 🔴 ✅ ✅ ✅ ✅ ✅ ✅ ✅ ✅
P5-清账             ✅ 🔴 ✅ ✅ ✅ ✅ 🔴 ✅ ✅ ✅
P6-事实与入口件      ✅ 🔴 ✅ ✅ ✅ ✅ 🔴 ✅ ✅ ✅
P7-交付自证与真值    🔴 🔴 ✅ ✅ ✅ ✅ 🔴 ✅ ✅ ✅
P8-内置FDE          ✅ 🔴 ✅ 🔴 ✅ ✅ 🔴 ✅ ✅ ✅
P9-包独立交付        ✅ 🔴 🔴 ✅ ✅ ✅ 🔴 ✅ ✅ ✅
P10-双仓与生态面     ✅ 🔴 🔴 🔴 ✅ ✅ 🔴 ✅ ✅ ✅
```

**口径**：`✅`=通过；`🔴`=缺口；`🟡`=待人工确认。红格合计 26（①1＋②10＋③3＋④3＋⑦9）。
**对账规则**：与 CTO 手工矩阵**已记录的格**（P4 行 §十一、裁定 185 §B 的 ⑤⑥⑩全绿／②全红／⑦除 P4 外红）逐格一致即通过；**新增格的解释必须逐条列出**（见 §2.2 F1–F3）；**不一致 ⇒ 停下报 CTO**，不许"修到一致"。

## 附录 C · 四行开场包（派单用）

```
① 批次名：P4 交付 0 · 包自足性审查脚本（Issue #566）
② 写集：见 §4 表（W1 归编码 A；W2/W3/W4 归编码 B；W5 已由 P4 冻结，任何人不得改）
③ 判据：§7 三路径（正常/降级/反例）＋ §11 DS-1…DS-11；反例 = --selfcheck 必红
④ 域守则指针：scripts/control-tower/AGENTS.md｜tests/control-tower/AGENTS.md｜.gitea/AGENTS.md｜memory/notes/AGENTS.md
```

## 引用豁免

- scripts/control-tower/check-package-selfsufficiency.py — 本交付新建件（W1），交付前不存在
- tests/control-tower/check-package-selfsufficiency.test.sh — 本交付新建件（W2），交付前不存在

## 附录 D · 派单内部一致性自检

- **同一路径是否被两条要求互斥？** ✅ 无：W1（脚本）只增不改其它文件；W2（测试）只读调用 W1；W3/W4 为独立配套件；W5 冻结只读。
- **同一判据是否既要求"必红"又要求"exit 0"？** ✅ 无：`--selfcheck` 的"必红"指**其 inner 子例**（B 子例 ② 红、inner exit 1），外层 `--selfcheck` 的成功语义是 **exit 1**；「exit 0」只用于①全 ✅ 与②配对测试本身。两者作用于不同进程/不同对象，不互斥（见 §5.3 与 §7.4）。
- **写集是否与「非目标」互斥？** ✅ 无：§3.2 的全部禁碰路径与 §4 的 W1–W5 零交集。
