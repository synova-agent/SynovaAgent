# docs/synova/acceptance/ — 验收矩阵载体 `acceptance-matrix/v1`（**格式权威**）

> 归属：治理线 · **P4 门禁包**（B6＝CTO 的眼睛）｜批次 **#1054 / P0**｜写入方：实施小队 `member-schema`
> 规格源（唯一，冻结）：handbook `派单件/2026-10-27-规格-1054-验收矩阵机制-P0.md` @ `b086a0a` §5／§6／§7
> 🔴 **权威关系**：本件是 `acceptance-matrix/v1` 的**格式权威**。校验器 `scripts/control-tower/check-acceptance-matrix.py`（T2）与样例 `1053.matrix.yaml`（T4）**按本件实现／填写**；三者口径冲突时**以本件为准**。改本件＝改口径（须回 L1／CTO，不许下游自行发明字段）。
> 本件同时是**目录非空载体**（git 不跟踪空目录）：目录里只放本 README 与 `<issue>.matrix.yaml` 矩阵文件。

## Summary

把「15 条工程纪律 × 8 项 DSH 品味」的验收结论，从**散文口径**变成**机器可判的载体**：一个 PR／批次一份 `acceptance-matrix/v1` YAML（**23 行固定**）＋ 一个三态校验器（`0/1/2`）。

- **为什么**：M4-T1 的验收实证是「声明核实 9/9 属实，但**没有**逐条给 15×8 结论；漏品味 4；品味 7 未闭环；Q-11 因 ①e 未武装而'未判'」——是**载体缺失**，不是态度问题（规格 §2.2）。
- **本件不做的**：不改任何产品行为；不判质量好坏；不替代 K3；**P0 不接 CI／pre-commit**（规格 §3 非目标）。
- **一条命令看结论**：`python3 scripts/control-tower/check-acceptance-matrix.py <matrix.yaml> --repo . --anchor <sha>`；末行 ∈ `MATRIX: PASS …`｜`MATRIX: FAIL <n> issue(s)`｜`MATRIX: UNJUDGED <code>`，退出码 `0/1/2`。

## Use this package

### When to choose it

**该用**：

- 一个 PR／批次要把「15×8」验收结论**留成可复跑的证据**（而不是"复核者说没问题"）。
- 你要机器回答「T-1 能不能声明 partial」「Q-11 到底判没判」「n/a 有没有负证据」，而不是靠人回忆。
- 你要把"验收时漏项"变成**一次跑出全部缺口**（每个 issue 点名错误码 ＋ 具体文件／命中数）。

**不该用**：

- 想判**语义好坏／代码质量**——本件只判**齐全性与可核性**（机械 11 项判存在性，语义 12 项只占位待复核位填）。
- 想**替代 K3 审计**（K3 是独立审计，本件连"自验"都不是）。
- 想在 CI 里**自动阻断**——P0 明确不接（P2 才提 report-only，属 A 类提案）。

### Minimal example

完整 23 行见同目录 `1053.matrix.yaml`（M4-T1 回溯样例）。**形状**（只示 3 行，其余 20 行同形）：

```yaml
schema: acceptance-matrix/v1
issue: 1053
batch: M4-T1
anchor: 5553bb95c
changed_files: [src/routes/sentinel.ts, .claude/claims/1053.yaml]
coverage_judged: false
known_issues: [943]
items:
  Q-2: {status: n/a, reason: 无 UI/渲染产物（变更集仅 src 与 claim）, evidence: {cmd: "git grep -c -e 'token=' 5553bb95c -- src/routes/sentinel.ts"}}
  Q-11: {status: partial, reason: "①e 覆盖率未武装（issue 943）", known_issue: 943, evidence: {cmd: "Gitea job log ①e", out: docs/synova/reviews/README.md}}
  T-1: {status: partial, variance: true, reason: "文件头缺 @exit（既有 handler 边界修复，≤15 行例外）", evidence: {cmd: "git show 5553bb95c:src/routes/sentinel.ts", out: src/routes/sentinel.ts}}
```

🔴 **`n/a` 项不要写 `out`**（详见 F3）：`n/a` 的负证据只写 `evidence.cmd`；`out` 一旦出现就按"可核证据"强校验，写 `out: "0"` 这类字面量会直接红 `E_EVIDENCE_UNRESOLVED`（规格 §5.1 的示例在这一点上会被 F3 判红——**以本件 F3 为准**）。

### 怎么跑（How to run）

```bash
# 0) 起点：不要用本地滞后的 main，从 gitea/local-main 起（squad-discipline #14）
git -C <repo> fetch -q gitea
git -C <repo> worktree add -q --detach <wt> gitea/local-main
cd <wt>

# A1 默认：主线锚样例（anchor 已并入 local-main；--repo 缺省 .；--anchor 缺省取矩阵 anchor）
python3 scripts/control-tower/check-acceptance-matrix.py docs/synova/acceptance/1048.matrix.yaml --repo . --anchor 1ca0d4dfc

# A2 复跑机械 11 项：矩阵声明 vs 机械事实（与 plain 同一判据，不做第二套实现）
python3 scripts/control-tower/check-acceptance-matrix.py docs/synova/acceptance/1048.matrix.yaml --repo . --anchor 1ca0d4dfc --verify

# A3 机器可读（stdout 仅一份 JSON；人读行全部抑制）
python3 scripts/control-tower/check-acceptance-matrix.py docs/synova/acceptance/1048.matrix.yaml --repo . --anchor 1ca0d4dfc --json \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(sorted(d));print(d['summary'])"

# A1b 回溯演练（M4-T1 @ 5553bb95c）——**回溯演练，不得作默认**：
#   该 anchor 未并入 local-main（见 Known Limitations 12），只用于验证校验器点名历史缺口的能力
python3 scripts/control-tower/check-acceptance-matrix.py docs/synova/acceptance/1053.matrix.yaml --repo . --anchor 5553bb95c

# D1 降级自证：anchor 不可解析 ⇒ **exit 2**（判不了 ≠ 红；末行 `MATRIX: UNJUDGED E_ANCHOR_MISMATCH`）
python3 scripts/control-tower/check-acceptance-matrix.py docs/synova/acceptance/1048.matrix.yaml --repo . --anchor deadbeef0; echo "exit=$?"

# D2 降级自证：`--repo` 指向不存在的路径 ⇒ **exit 2**
python3 scripts/control-tower/check-acceptance-matrix.py docs/synova/acceptance/1048.matrix.yaml --repo /nonexistent/synova-1054 --anchor 1ca0d4dfc; echo "exit=$?"
```

环境：Windows／macOS／Linux 同一实现（纯标准库，见 F1）。Windows 上 `python3` 在 PATH（实测 3.13.x）；跑 `.sh` 用 Git 自带 bash（`.dsh/skills/windows-compat/SKILL.md`）。UTF-8 强制（D732）：脚本内 `sys.stdout.reconfigure(encoding="utf-8")`，shell 侧可用 `PYTHONIOENCODING=utf-8`。

**P0 不接 pre-commit／CI**：本件**不新增**任何调用点（规格 §3 非目标）。"这条命令在不在门禁里"的正确回答是**不在**——这是规格决定，不是漏项。

### 成功 / 失败长什么样

| 形态 | 退出码 | 末行 | 说明 |
|---|---|---|---|
| 全绿 | **0** | `MATRIX: PASS 23/23 (mach 11/11, sem 12 attested)` | 23 行齐；机械 11 项与声明一致；语义 12 项字段齐全（**不等于语义判对**） |
| 机械复跑一致 | **0** | `VERIFY: mach 11/11 consistent` | 仅 `--verify` 模式 |
| 真红 | **1** | `MATRIX: FAIL <n> issue(s)` | 前面有 `ISSUE <code> <item|-> <detail>` 行点名每个缺口；`n` = issue 数 |
| 判不了 | **2** | `MATRIX: UNJUDGED <code>` | stderr 必有 `degraded: <code> phase=<phase> — <原因>` ＋ stdout `UNJUDGED <code> phase=<phase> — <原因>`；`2` **不是通过，也不是红** |

### What can go wrong（先讲失败）

按"最常踩到的顺序"列，每条都对应一个错误码（F7）：

1. **`n/a` 写了 `out: "0"`** ⇒ `E_EVIDENCE_UNRESOLVED`（exit 1）。`n/a` 的 `out` 必须省略（F3 对 `out` 无 status 例外；规格 §5.1 示例与本条冲突，取舍见 Known Limitations 14）。
2. **少写／多写一行** ⇒ `E_MATRIX_ITEM_MISSING`／`E_MATRIX_ITEM_UNKNOWN`（exit 1）。23 行是**固定集合**，不是"至少"。
3. **`changed_files` 含 `src/**.ts` 但没判覆盖率**（`coverage_judged` 未 true ∧ 无 `known_issues` ∧ 该项无 `known_issue`）⇒ `E_COV_UNJUDGED`（exit 1）。
4. **`--anchor` 指向不存在的 commit**（或矩阵 anchor 解析不了）⇒ `E_ANCHOR_MISMATCH`（**exit 2**：判不了 ≠ 红）。
5. **矩阵 anchor 与 `--anchor` 不一致**（两者各自都能解析）⇒ `E_ANCHOR_MISMATCH`（**exit 1**：这是"声明与事实不符"，是真红）。⚠️ 与第 4 条**同码不同态**，靠 `phase` 与退出码区分。
6. **`T-1` 明明缺 `@exit` 却写 `pass`** ⇒ 声明与机械事实矛盾 ⇒ `E_MATRIX_SCHEMA`（exit 1）。正确写法是 `partial` ＋ `variance: true` ＋ `reason`。
7. **`evidence.out` 写成"我以为存在的路径"** ⇒ `E_EVIDENCE_UNRESOLVED`（exit 1）。锚点下必须真的可解析（F3）。
8. **把"我改的文件"当 `changed_files` 但漏了文件** ⇒ **本件抓不到**（不自报对账，见 Known Limitations 1）——这是有意留的信任边界，不是 bug。
9. **期望它顺手判语义** ⇒ 不会。语义 12 项只输出 `attested`（字段齐全），质量好坏归复核位／K3。

## Understand the implementation

### Design philosophy

**一个分离 ＋ 四条承诺**：

- **分离**：**"声明"（矩阵里写的 status）** 与 **"事实"（anchor 上的机械证据）** 分开存、由校验器对账——矩阵只**携带**声明，不携带 diff。
- **承诺 1**：**判不了就 exit 2**，绝不当通过（裁 422-R2 同源；`2` 与 `0` 永不同义）。
- **承诺 2**：**机械项只判存在性／负证据**，不判语义（判不了的就降级为"语义槽位"，不假装判过）。
- **承诺 3**：**声明与事实矛盾必红**，且逐项点名错误码 ＋ 具体文件／命中数（禁笼统 `exit 1`）。
- **承诺 4**：**`--verify` 与 plain 共用同一实现**（同一函数算事实），不新开第二套判据。

### 0. 契约（与校验器头部 `@input/@output/@exit/@degraded/@authority/@not-here` 同文）

```
@input  <matrix.yaml> [--repo R] [--anchor SHA] [--verify] [--json]
        --repo 缺省 "."；--anchor 缺省 = 矩阵的 anchor 字段
@output 逐项一行 `<id> <status> <verdict> <detail>`（23 行，顺序固定）；
        失败追加 `ISSUE <code> <item|-> <detail>` 行；
        末行 ∈ { MATRIX: PASS 23/23 (mach 11/11, sem 12 attested)
               | MATRIX: FAIL <n> issue(s)
               | MATRIX: UNJUDGED <code>
               | VERIFY: mach <ok>/11 consistent }          （--verify 全一致时的末行）
        （stderr 可含 T-8 作用域提示行：`T-8 scope: skip record-only dir <dir>`／
         `T-8 scope: skip out-of-scope dir <dir>`；**stdout 的 23 行逐项契约与末行契约不变**）
@exit   0 通过 ｜ 1 真红 ｜ 2 判不了（用法错／矩阵文件不可读／仓不可读／anchor 不可解析／git 不可用）
@degraded exit 2 时 stderr 一行 `degraded: <code> phase=<phase> — <原因>`，stdout 一行
          `UNJUDGED <code> phase=<phase> — <原因>`（**phase 与真实原因不许省**，L1 2026-10-27 批）；
          若设 SYNO_GATE_DEGRADED_LOG，追加一行 JSON（字段 time/component/code/phase/retryable）
@authority 只读；任何人可跑（不要求写权限、不要求网络）；不写产品文件（唯一可能写盘＝环境变量指定的降级日志）
@not-here 不判质量语义 ｜ 不替代 K3 审计 ｜ 不接 CI／pre-commit（P0）｜ 不执行矩阵里的 evidence.cmd
```

`component` 固定 `check-acceptance-matrix`；`time` 取运行时刻（ISO-8601 带时区）；`phase` 见 F6；`retryable` 见 F6 表。

### 1. F1 文件格式（`acceptance-matrix/v1` · 子集 YAML）

#### 1.1 顶层键（required 6 ＋ optional 2）

| 键 | 类型 | required | 约束 | 违规码 |
|---|---|---|---|---|
| `schema` | str | ✅ | **必须等于** `acceptance-matrix/v1` | `E_MATRIX_SCHEMA` |
| `issue` | int | ✅ | 批次／PR／卡号 | `E_MATRIX_SCHEMA` |
| `batch` | str | ✅ | 非空 | `E_MATRIX_SCHEMA` |
| `anchor` | str | ✅ | 匹配 `^[0-9a-fA-F]{7,40}$`（缺 ⇒ `E_MATRIX_SCHEMA`；**格式非法/不可解析 ⇒ exit 2 `E_ANCHOR_MISMATCH`**，见 F5/F6） | — |
| `changed_files` | inline list[str] | ✅ | 仓相对路径；可为空列表（纯文档批次）；元素禁绝对路径／盘符／`..` | `E_MATRIX_SCHEMA` |
| `coverage_judged` | bool | 可缺 | 缺 ≠ `true`（Q-11 只认 `true`） | `E_MATRIX_SCHEMA` |
| `known_issues` | inline list[int] | 可缺 | 元素必须**正整数** | `E_MATRIX_SCHEMA` |
| `items` | 块映射 | ✅ | 固定 23 行（1.2）；键缺 ⇒ `E_MATRIX_ITEM_MISSING`；非映射／inline 形式（即使语法合法）⇒ `E_MATRIX_SCHEMA` | — |

未知顶层键 ⇒ `E_MATRIX_SCHEMA`（防 typo 静默丢字段；同 `claim_store.py` 的 `ClaimError` 口径）。

#### 1.2 `items`：固定 23 行 ＋ 固定顺序

```
Q-1 Q-2 Q-3 Q-4 Q-5 Q-6 Q-7 Q-8 Q-9 Q-10 Q-11 Q-12 Q-13 Q-14 Q-15 T-1 T-2 T-3 T-4 T-5 T-6 T-7 T-8
```

- **缺行** ⇒ `E_MATRIX_ITEM_MISSING`（detail 列出缺的 id）；**多行／未知 id** ⇒ `E_MATRIX_ITEM_UNKNOWN`；**顺序不符** ⇒ `E_MATRIX_SCHEMA`（"固定顺序"是契约，不是风格）。
- `Q-13` 也必须占一行，且必须写 `alias_of: "Q-2"`（它是 Q-2 的别名行，机械判定同 Q-2）。
- 语义项（`Q-1 Q-3 Q-5 Q-7 Q-9 Q-12 Q-14 Q-15 T-2 T-3 T-4 T-6`）的含义／判据定义**不在本件复制**：`Q-n` = handbook `CTO-交接-2026-10-26-M4出口面.md` §5bis-C 表的第 n 行；`T-n` = handbook `CTO-交接-2026-10-26-M4出口面.md` **§5 的「DSH 代码品味 8 项」**，按该节列举序（`T-1` 头部契约 ｜ `T-2` typed error 带 code ｜ `T-3` fail loud ｜ `T-4` explicit authority ｜ `T-5` 已知限制节 ｜ `T-6` 设计哲学一句 ｜ `T-7` 测试配对 ｜ `T-8` 长期件 README）。本件**只冻结槽位与格式**（防第二真源）。

#### 1.3 item 与 evidence 的字段

`item` = **inline map**（一行写完）：

| 字段 | 类型 | 约束 | 违规码 |
|---|---|---|---|
| `status` | str | **必填**，∈ {`pass`,`n/a`,`deferred`,`partial`} | `E_STATUS_INVALID` |
| `reason` | str | 可选；空串视为缺 | `E_MATRIX_SCHEMA`（该 status 要求时见 F2） |
| `variance` | bool | 可选（仅 `T-1` 有契约用途） | `E_MATRIX_SCHEMA` |
| `known_issue` | int | 可选，**正整数**（0/负 ⇒ 视为缺） | `E_MATRIX_SCHEMA` |
| `alias_of` | str | **仅 `Q-13`**，且值必须为 `"Q-2"`；其余项出现 ⇒ 红 | `E_MATRIX_SCHEMA` |
| `evidence` | inline map | 可选；`{cmd, out}` 两键，值均 str | 见 F2／F3 |

未知 item 字段 ⇒ `E_MATRIX_SCHEMA`（同顶层：防 typo）。

#### 1.4 子集 YAML 语法（**纯标准库解析器只认这些**；超出即 `E_MATRIX_SCHEMA`）

- 编码 **UTF-8**（D732）；行尾 LF 或 CRLF 均可（读入剥 `\r`）；允许并剥除开头 BOM。
- 空行忽略。**整行注释**：行首首个非空白字符为 `#`（**没有行内注释**）。
- 顶层键：**行首无缩进**的 `key: value`（键名 `[A-Za-z0-9_.-]+`）；同一映射内重复键 ⇒ 红。
- `items:` 的每一行：**恰好 2 个空格**缩进 ＋ `<ID>: <inline map>`（**一行一项**）。
- **标量**：内联列表 `[a, b]`（元素为标量）、内联映射 `{k: v, ...}`（**最多两层**：item 一层、item.evidence 第二层）、整数 `[+-]?\d+`、布尔 `true|false`、其余为字符串。
- **字符串**：不加引号时**不得含** `,` `"` `{` `}` `[` `]`，且不得以 `|` 或 `>` 开头；否则**必须**双引号包裹；双引号内**只支持** `\"` 与 `\\` 两个转义，其余 `\x` ⇒ 红（**fail loud，不猜**）。去引号后 strip 首尾空白；不加引号时同样 strip。
- **不支持**（⇒ 红）：制表符缩进、块序列（`- ` 行）、块标量（`|`／`>`）、锚点／别名／合并键（`&`/`*`/`<<`）、跨行流式、嵌套超两层的 inline map。
- **为什么不用 PyYAML**：CI runner 无 PyYAML，`import` 失败会退化成「读不到声明」的**静默路径**（同 `check-quality-delta.py:93` 与 `claim_store.py` 的先例）⇒ 纯标准库解析，行为可复现。（负证据：本批"不引第三方依赖"是规格 §10 的上限。）

### 2. F2 状态合法性（`status` × 必填字段）

| `status` | 必填 | 说明 |
|---|---|---|
| `pass` | `evidence.cmd` ＋ `evidence.out` 均非空 | 缺 ⇒ `E_MATRIX_SCHEMA`（10 码闭包内无专属码，归结构错） |
| `partial` | `evidence.cmd` ＋ `evidence.out` 均非空 ＋ `reason` 非空 | 缺 reason ⇒ `E_MATRIX_SCHEMA` |
| `n/a` | `reason` 非空 ＋ `evidence.cmd` 非空（**负证据**，期望 0 命中）；**`out` 不得出现** | 缺 `cmd` ⇒ `E_N/A_NO_EVIDENCE`；缺 reason ⇒ `E_MATRIX_SCHEMA`；写了 `out` ⇒ 按 F3 校验 |
| `deferred` | `reason` 非空 ＋ `known_issue` **正整数**（0/负 = 缺） | 缺 ⇒ `E_DEFERRED_NO_ISSUE`；缺 reason ⇒ `E_MATRIX_SCHEMA` |

### 3. F3 `evidence.out` 可核性

`evidence.out` 一旦**出现且非空**，无论 `status` 是什么，都必须可核：

- **以 `http://`／`https://` 开头** ⇒ 必须含**该 anchor 前 7 位 hex**（大小写不敏感匹配；例 `5553bb9`）。不含 ⇒ `E_EVIDENCE_UNRESOLVED`（"URL 不含 anchor sha ⇒ 视为不可核"）。**不联网**：只做字符串判定，不 fetch（Known Limitations 8）。
- **否则视为仓内路径** ⇒ 归一化（剥空白、反斜杠→`/`、去前导 `./`），拒绝绝对路径／盘符／含 `..` 的路径 ⇒ `E_EVIDENCE_UNRESOLVED`；然后 `git -C <repo> cat-file -e <anchor40>:<path>` 必须成功，且 `git -C <repo> cat-file -t <anchor40>:<path>` 必须是 `blob`（指向目录不算证据；🔴 L1 2026-10-27 批：此条**比冻结文本更严**——只认 blob）⇒ 任一不满足 ⇒ `E_EVIDENCE_UNRESOLVED`。
- `anchor40` = anchor 解析后的 **40 位 commit sha**（解析一次后固定，不再用短 sha 取内容）。

🔴 **本条的取舍（规格两处互相冲突，L1 2026-10-27 裁决）**：规格 §5.1 的示例给 `n/a` 项写了 `evidence: {..., out: "0"}`，而 §6 边界表把 `evidence.out` 定义为「仓内文件存在于 anchor ⇒ 通过／不存在 ⇒ `E_EVIDENCE_UNRESOLVED`／URL 不含 anchor sha ⇒ 视为不可核」。**§6 是判据表，取 §6** ⇒ `out` 一律强校验（无 status 例外），`n/a` 项**只写 `cmd`**，写 `out: "0"` 必红。详见 Known Limitations 14。

### 4. F4 机械 11 项 vs 语义 12 项

- **机械 11 项**（申诉不了的机器事实）：`Q-2`、`Q-4`、`Q-6`、`Q-8`、`Q-10`、`Q-11`、`Q-13`、`T-1`、`T-5`、`T-7`、`T-8`。
- **语义 12 项**（只判**齐全性与可核性**，不判语义好坏）：`Q-1`、`Q-3`、`Q-5`、`Q-7`、`Q-9`、`Q-12`、`Q-14`、`Q-15`、`T-2`、`T-3`、`T-4`、`T-6`。
- 语义项的机械判定：只要 F2／F3 过关 ⇒ **一律 `attested`**（"字段齐全且证据可核"，**不是**"语义判对了"）。语义项的 pass/fail 由复核位在回执里给（规格 §5.1 末条）。

### 5. F5 判定顺序（**顺序即语义**：先到先判，防 D1／M4 冲突）

```
① 用法解析            用法错 ⇒ exit 2
② 仓可读              不可读 ⇒ exit 2
③ 矩阵可读＋解析       不可读 ⇒ exit 2（phase=matrix）；结构错 ⇒ exit 1（E_MATRIX_SCHEMA / ITEM_MISSING / ITEM_UNKNOWN / STATUS_INVALID / 字段）
④ 解析 --anchor        不可解析 ⇒ exit 2
⑤ 矩阵 anchor vs --anchor（各自解析成 40 位后比较）  不一致 ⇒ exit 1（E_ANCHOR_MISMATCH）
⑥ 23 行齐全＋顺序      缺/多/顺序错 ⇒ exit 1
⑦ 状态与字段（F2）     违规 ⇒ exit 1
⑧ evidence 解析（F3）  不可核 ⇒ exit 1
⑨ Q-11 武装           未武装 ⇒ exit 1（E_COV_UNJUDGED）
⑩ 机械 11 项（F12）    声明与事实矛盾／硬违反 ⇒ exit 1
⑪ 汇总                全绿 ⇒ exit 0
```

**每个阶段先收集该阶段的全部 issue，再决定是否进入下一阶段**：`③⑥⑦⑧` 任一阶段出现 issue ⇒ **不进入 ⑨⑩**（不许在坏输入上产结论）；`⑨⑩` 出现 issue ⇒ 不早退，**一次跑出全部**（`ISSUE` 行逐条点名）。`②④` 是 exit 2 类，**立即停**（此时不出逐项行，只出 stderr `degraded` ＋ stdout `UNJUDGED` 行 ＋ 末行 `MATRIX: UNJUDGED`）。`③⑥⑦⑧` 失败时**只打 `ISSUE` 行 ＋ 末行 `MATRIX: FAIL <n> issue(s)`**，不逐项打（尚无 verdict，不伪造）；`--json` 时 `items` 为空数组，缺口全在 `errors`。

### 6. F6／F7 三态退出码、降级与错误码

**三态**（ctrl-tower-change 模式 1，**不许 `|| true` 吞崩溃**）：

- `0` 通过（含 `--verify` 全一致）
- `1` 真红（矩阵结构／声明与事实矛盾／机械硬违反）
- `2` 判不了（**同样阻断**，绝不当通过）：用法错｜矩阵文件不可读｜仓不可读｜anchor 不可解析｜git 不可用

**exit 2 的降级动作**（D2 既有约定，不另造）：

1. stderr 一行：`degraded: <code> phase=<phase> — <原因>`（分隔符是 em dash `—`；**phase 与真实原因不许省**）；
1b. stdout 一行：`UNJUDGED <code> phase=<phase> — <原因>`，随后末行 `MATRIX: UNJUDGED <code>`（末行形状仍按 F8 冻结）；
2. 若环境变量 `SYNO_GATE_DEGRADED_LOG` 已设且非空 ⇒ **追加**一行 JSON：`{"time": "<ISO-8601>", "component": "check-acceptance-matrix", "code": "<code>", "phase": "<phase>", "retryable": <bool>}`；
3. 日志写失败**不静默**：stderr 追加 `degraded: 写降级日志失败 — <原因>`，退出码仍是 `2`。

**phase 与 retryable**（exit 2 一律用 `E_ANCHOR_MISMATCH` ＋ phase 区分，**不新增码**）：

| phase | 场景 | retryable |
|---|---|---|
| `usage` | 参数非法／未知选项／多余位置参数／缺 `<matrix.yaml>` | `false` |
| `matrix` | 矩阵文件不存在或不可读（IO） | `true` |
| `repo` | `--repo` 不可读／不是 git 仓 | `true` |
| `anchor` | anchor 格式非法或在本仓不可解析 | `true` |
| `git` | git 二进制不可用／子进程异常 | `true` |

**错误码只有这 10 个**（闭包；**不许自增第 11 个**）：

`E_MATRIX_SCHEMA`｜`E_MATRIX_ITEM_MISSING`｜`E_MATRIX_ITEM_UNKNOWN`｜`E_STATUS_INVALID`｜`E_N/A_NO_EVIDENCE`｜`E_DEFERRED_NO_ISSUE`｜`E_EVIDENCE_UNRESOLVED`｜`E_ANCHOR_MISMATCH`｜`E_COV_UNJUDGED`｜`E_VERIFY_FAILED`

归口规则：**专属码优先，其余结构／字段／硬违反一律 `E_MATRIX_SCHEMA`**（Q-11 用 `E_COV_UNJUDGED`；`--verify` 模式下的不一致用 `E_VERIFY_FAILED`）。`E_ANCHOR_MISMATCH` 同时承担 exit 2 的环境类归口（靠 phase 区分）——这是 10 码闭包的有意取舍，见 Known Limitations 6。

### 7. F8／F9／F10 输出契约

#### 7.1 逐项行（F8）

`<id> <status> <verdict> <detail>`，单空格分隔、无前导空格、一行一项，**顺序固定**（1.2 的 23 行序）。

- `status` = 矩阵声明值原样。
- `verdict`：机械项 ∈ {`ok`,`na_ok`,`fail`}；语义项固定 `attested`。
- `detail`：机械项给**判定依据**（不允许空，不允许只写"ok"）；语义项 = 该项 `reason`（有则原样、换行压成空格），无则字面 `slot`。
- 机械 detail 的**推荐形状**（便于机器读）：`Q-2`/`Q-13` → `ui_files=<n> hits=<n>`；`Q-4` → `src_files=<n> hits=<n>`；`Q-6` → `files=<n> hits=<n>`；`Q-8` → `vc_files=<n> hits=<n>`；`Q-10` → `files=<n> hits=<n>`；`Q-11` → `src_files=<n> armed=<yes|no>`；`T-1` → `src_files=<n> miss=<n>`；`T-5` → `files=<n> miss=<n>`；`T-7` → `test_files=<n> passed=<yes|no>`；`T-8` → `dirs=<n> bad=<n> skipped=<n>`（`dirs` **只计作用域内**候选目录、`skipped` 计域外被跳过目录）。🔴 `absent=<n>` **只在 `Q-2`／`Q-13`（两者共用同一实现）／`Q-4`／`Q-6`／`Q-8`／`T-1`／`T-5` 这六条规则实现**（anchor 下不可读／不存在文件），其余机械项**不落** —— 未实现的项不在此承诺。

**`verdict` 的语义（机械项）＝"该项是否可判为通过"**：`ok` = 机械事实满足该项硬要求**且**声明与事实一致；`na_ok` = 该项无判定对象（事实=无对象/无命中）**且**声明 `n/a`（或 F12 明示的例外）；`fail` = 事实违反硬要求**或**声明与事实矛盾。因此「`T-1` 缺标签但已正确声明 `partial + variance: true + reason`」在机械项上是 **`ok`**（"正确声明的部分通过"）——`fail` 不是对语义质量的判决（语义质量归复核位／K3）。

#### 7.2 ISSUE 行（失败时的点名，F8 的补充）

每个 issue 一行：`ISSUE <code> <item|-> <detail>`（非 item 级用 `-`；detail 必须含具体文件／命中数／字段名）。随后末行 `MATRIX: FAIL <n> issue(s)`（`n` = ISSUE 行数）。

#### 7.3 末行（三态）

| 情形 | 末行 |
|---|---|
| 全绿 | `MATRIX: PASS 23/23 (mach 11/11, sem 12 attested)` |
| 真红 | `MATRIX: FAIL <n> issue(s)` |
| 判不了 | `MATRIX: UNJUDGED <code>` |
| `--verify` 且全一致 | `VERIFY: mach 11/11 consistent` |

`--verify` 且**有**不一致 ⇒ 逐项 `VERIFY` 行照打，末行按真红口径 `MATRIX: FAIL <n> issue(s)`，`code` 用 `E_VERIFY_FAILED`，退出码 `1`。

#### 7.4 `--verify`（F9）

重跑机械 11 项（**与 plain 同一判据、同一实现**），逐项一行：

```
VERIFY <id> declared=<status> mech=<verdict> consistent=<yes|no>
```

`consistent` = "声明的 status 与该机械 verdict 允许的组合"（F12 每项的"允许声明"列）；全部 `yes` ⇒ 末行 `VERIFY: mach 11/11 consistent` ＋ exit 0。不一致时**只重码不重判**：除 `E_COV_UNJUDGED`（武装门自身，两模式同码）外，其余矛盾一律改记 `E_VERIFY_FAILED`（同一实现算出的同一事实，不新开第二套判据）。

#### 7.5 `--json`（F10）

`--json` 时 **stdout 仅一份 JSON**（人读行、`ISSUE` 行、`VERIFY` 行**全部抑制**；stderr 的 `degraded` 行保留）：

```json
{
  "schema": "acceptance-matrix/v1",
  "issue": 1053,
  "anchor": "5553bb95c",
  "items": [
    {"id": "Q-1", "status": "n/a", "verdict": "attested", "mech": null},
    {"id": "Q-2", "status": "n/a", "verdict": "na_ok", "mech": "na_ok", "reason": "...", "evidence": {"cmd": "..."}}
  ],
  "summary": {"total": 23, "mach_total": 11, "mach_ok": 11, "sem_total": 12, "sem_attested": 12, "pass": true},
  "errors": [{"code": "E_MATRIX_SCHEMA", "item": "T-1", "detail": "..."}]
}
```

- `anchor` = 矩阵 `anchor` 字段原样；`schema`/`issue` 同理。
- 🔴 **stdout 的实际字节是纯 ASCII**（`json.dumps(..., ensure_ascii=True)`）：这是 Windows 控制台/管道编码差异下的稳健性选择——任意 locale 的 `json.load` 都能解析，解析后中文原样还原（本规范不要求"人读 JSON"，人读窗口是逐项行）。
- 机械项 `mech` = 该 verdict；语义项 `mech` = `null`。
- `summary.mach_ok` = 机械项中 `ok`＋`na_ok` 的数量；`summary.pass` = `errors` 为空 ∧ `mach_ok == mach_total` ∧ `sem_attested == sem_total`。
- exit 2 时同样出这份 JSON（`errors` 里带 degraded 的 code，`pass: false`），stderr 仍有 `degraded` 行。

### 8. F11 谓词（机械判定域 = `changed_files`；纯路径字符串判定，不看工作树）

- `is_src_ts`：`^src/.*\.ts$`
- `is_ui`：`^(electron-renderer/|src/tui/|apps/web/)` ∪ 扩展名 ∈ {`.tsx`,`.jsx`,`.vue`,`.html`,`.css`}
- `is_test`：`^tests/` ∪ 文件名含 `.test.`／`.spec.`
- `is_version_contract`：路径含 `version`／`package.json`／`contract`／`schema`（**大小写不敏感**）
- `is_longlived_doc`：`^(docs|memory)/.*\.md$` ∪ basename ∈ {`AGENTS.md`,`README.md`}

同一路径可同时命中多类（例 `tests/x.test.tsx` 既 `is_test` 又 `is_ui`）——各规则按自己的集合取并集，不互斥。

### 9. F12 机械规则（11 项，逐项冻结）

**通用**：判定前统一把 anchor 内容的读取结果做缓存（`git -C <repo> cat-file -p <anchor40>:<path>`）；`hits` 一律指**子串出现次数**（不是行数）。`na_ok` 的含义是"机械事实=无对象/无命中 ⇒ **要求**声明 `n/a` ＋ `reason` ＋ 负证据 `cmd`"；该声明缺失或与事实矛盾 ⇒ 红。

**Q-2 / Q-13（配置脱敏跨 wire；Q-13＝Q-2 别名）**

- 判定域：`is_ui` 文件在 anchor 的内容。
- 敏感模式集合（4 个字面量，任一命中即算）：`token=`、`secret`、`apiKey`、`Bearer `（末尾含空格）。
- `ok` ＝ 有 `is_ui` 文件 ∧ 命中 0（此时声明必须 `pass`）；`fail` ＝ 命中 >0（**无论声明什么** ⇒ exit 1）；`na_ok` ＝ 无 `is_ui` 文件（声明必须 `n/a`）。`Q-13` 的 verdict **与 Q-2 完全相同**（同一事实、同一结果；`alias_of: "Q-2"` 必须存在）。

**Q-4（assertNever 穷尽兜底）**

- 判定域：`is_src_ts` 文件在 anchor 的内容。
- `ok` ＝ **任一** source 文件含 `assertNever`（声明必须 `pass`）；`na_ok` ＝ 有 source 文件但全不含（声明必须 `n/a`）／无 source 文件（声明必须 `n/a`）。
- ⚠️ **有意与 T-1 不同口径**：Q-4 是"穷尽性检查**出现即可**"⇒ 任一口径；T-1 是"**每个**源文件都要有文件头契约"⇒ 全称口径。

**Q-6（时间注入：禁直取 `Date.now()`）**

- 判定域：`is_test` ∪ `is_ui` 文件在 anchor 的内容。
- `ok` ＝ 有该域文件 ∧ `Date.now()` 合计命中 **0**（声明必须 `pass`）；`fail` ＝ 合计 >0（无论声明什么 ⇒ exit 1）；`na_ok` ＝ 无该域文件（声明必须 `n/a`）。

**Q-8（schema_version 高即拒：版本/契约常量）**

- 判定域：`is_version_contract` 文件在 anchor 的内容。
- `ok` ＝ 有该域文件 ∧ 内容含 `VERSION`（**任一文件含即算**，口径理由同 Q-4）（声明必须 `pass`）；`fail` ＝ 有该域文件但全不含 `VERSION`（**硬违反** ⇒ exit 1）；`na_ok` ＝ 无该域文件（声明必须 `n/a`）。

**Q-10（expected／snapshot 配对）**

- 判定域：`changed_files` 的路径本身。
- `ok` ＝ 存在匹配 `*.expected.*` 或 `*.snapshot.*` 的路径（声明必须 `pass`）；`na_ok` ＝ 无匹配（声明 `n/a`，**例外**：允许 `partial` ＋ `reason`）。
- ⚠️ 例外只放宽"必须 n/a"，**不豁免** F2：`partial` 仍需 `evidence.cmd` ＋ `evidence.out`。

**Q-11（覆盖率／重复率已判）**

- 判定域：`changed_files` 是否含 `is_src_ts`。
- 含 `is_src_ts` ⇒ **武装条件**：`coverage_judged: true` ∨ `known_issues` 非空 ∨ 该项 `known_issue` 为正整数。武装成功 ⇒ `ok`（声明 `pass`；**例外**允许 `partial` ＋ `reason` ＋ `known_issue`）；未武装 ⇒ **`E_COV_UNJUDGED`（exit 1）**。
- 不含 `is_src_ts` ⇒ `na_ok`（声明 `n/a`）；此时声明 `pass` ⇒ 矛盾 ⇒ 红。

**T-1（源文件头部六段契约）**

- 判定域：`is_src_ts` 文件在 anchor 的内容。契约标签集合：`@input`、`@output`、`@exit`、`@degraded`。
- `ok` ＝ **每个** source 文件都同时含这 4 个标签（声明必须 `pass`）**或** 有文件缺标签但声明 `partial` ＋ `variance: true` ＋ `reason`；
- `fail` ＝ 有文件缺标签且声明 `pass`（声明与事实矛盾）／齐全却声明 `partial`／无 source 文件却声明 `pass`；
- `na_ok` ＝ 无 `is_src_ts` 文件（声明必须 `n/a`）。

**T-5（长期件／UI 的"已知限制"节）**

- 判定域：`is_ui` ∪ `is_longlived_doc` 文件在 anchor 的内容。模式：`已知限制` 或 `Known Limitations`。
- `ok` ＝ **每个**该域文件都命中（声明必须 `pass`）**或** 有文件不命中但声明 `partial` ＋ `reason`（**T-5 不要求 `variance`**）；
- `fail` ＝ 有文件不命中且声明 `pass`；`na_ok` ＝ 无该域文件（声明必须 `n/a`）。

**T-7（committed 测试入变更集）**

- 判定域：`changed_files` ＋ 该项的 `evidence.out`。
- `ok` ＝ ① 存在 `is_test` 路径（声明必须 `pass`）**或** ② `evidence.out` 字符串含 `passed` **或** `evidence.out`（仓内路径）在 anchor 的内容含 `passed`（此两形态也要求声明 `pass`）；
- 二者皆不成立 ⇒ 声明必须 `partial`（＋`reason`＋evidence）或 `deferred`（＋`reason`＋`known_issue`）；声明 `pass`／`n/a` ⇒ 矛盾 ⇒ 红。

**T-8（新目录的域守则）**

- 判定域：`changed_files` 的父目录，但**只对代码目录**生效——代码目录判定域 = 父目录匹配 `^(src|electron-renderer|extensions|scripts|expert|knowledge|theory|tests)(/|$)`。🔴 尾部 `(/|$)` **不可省**：**顶层目录本层直挂的变更件同样受判**（父目录恰为 `src`／`scripts`／`tests` … 时同样要求该目录有合规 `AGENTS.md`）；旧写法（尾部只有 `/`）会把这类父目录当域外跳过 ⇒ **假绿**。
- 先收集所有"同一父目录下 `≥2` 个变更文件"的目录作为候选，再把候选分两类：**作用域内**（代码目录）／**域外**（其余，一律跳过）。
  - 作用域内：`<dir>/AGENTS.md` 在 anchor 存在 ∧ 内容 `^## ` 小节数 `≥5`（判据本身不变）。
  - 域外：**不要求** `AGENTS.md`，并计入 detail 的 `skipped=`。其中**记录面**（父目录匹配 `^(\.claude|memory|docs)/`）向 stderr 打印 `T-8 scope: skip record-only dir <dir>`；其它域外打印 `T-8 scope: skip out-of-scope dir <dir>`（每个被跳过的目录恰一行，**stdout 行数与末行契约不变**）。
- `ok` ＝ 作用域内存在该目录且**全部**满足（声明必须 `pass`）；`fail` ＝ 有作用域内目录不满足（**无论声明什么** ⇒ exit 1）；`na_ok` ＝ 作用域内无此目录（声明必须 `n/a`）。🔴 **被跳过 ≠ 已验证**（见 Known Limitations 9）。

**矛盾归口**：声明与机械事实矛盾 ⇒ exit 1（`Q-11` 用 `E_COV_UNJUDGED`，其余用 `E_MATRIX_SCHEMA`）；`--verify` 模式下的不一致 ⇒ `E_VERIFY_FAILED`。

### 10. 边界值表（规格 §6 的落地口径）

| 参数 | 空 | 单元素 | 恰临界 | 超限 | 零／负 | 形态非法 |
|---|---|---|---|---|---|---|
| `items` | 键缺 ⇒ `E_MATRIX_ITEM_MISSING` | 1 行 ⇒ 仍缺 22 行 ⇒ exit 1 | 23 行且顺序对 ⇒ 通过 | 24 行（多未知 id）⇒ `E_MATRIX_ITEM_UNKNOWN` | — | 非映射 ⇒ `E_MATRIX_SCHEMA` |
| `anchor` | 键缺 ⇒ `E_MATRIX_SCHEMA` | 7 位短 sha 可解析 ⇒ 通过 | 40 位 ⇒ 通过 | 不可解析 ⇒ exit 2 | — | 非 hex／长度不在 7–40 ⇒ exit 2 `E_ANCHOR_MISMATCH` |
| `status` | 缺 ⇒ `E_STATUS_INVALID` | — | — | — | — | 枚举外 ⇒ `E_STATUS_INVALID` |
| `evidence.out` | 缺 ⇒ 该 status 不允许（F2） | — | anchor 下存在且是 blob ⇒ 通过 | 不存在／非 blob ⇒ `E_EVIDENCE_UNRESOLVED` | — | URL 不含 anchor 前 7 位 ⇒ `E_EVIDENCE_UNRESOLVED`（exit 1） |
| `known_issue` | `deferred` 缺 ⇒ `E_DEFERRED_NO_ISSUE` | — | 正整数 ⇒ 通过 | — | 0／负 ⇒ 视为缺 | 非整数 ⇒ `E_MATRIX_SCHEMA` |
| `changed_files` | 空列表 ⇒ 各机械项按 F12 的 `na_ok` 走 | 1 个路径 ⇒ 正常判 | — | — | — | 非列表／元素非 str／绝对路径／`..` ⇒ `E_MATRIX_SCHEMA` |
| `items[].variance` | 缺 ⇒ 非 true | `true` ⇒ 仅 `T-1` 有契约用途 | — | — | — | 非 bool ⇒ `E_MATRIX_SCHEMA` |

### 11. Source map

| File | Role |
|---|---|
| `docs/synova/acceptance/README.md` | **本件**：`acceptance-matrix/v1` 格式权威（F1–F12 ＋ 边界值 ＋ 已知限制） |
| `docs/synova/acceptance/1048.matrix.yaml` | 主线锚样例（#1048/#1049 门禁健壮性批 @ `1ca0d4dfc`，已并入 `local-main`），填满 23 行；**A1 默认被测对象** |
| `docs/synova/acceptance/1053.matrix.yaml` | 回溯样例（M4-T1 @ `5553bb95c`），填满 23 行；**A1b 回溯演练对象（不得作默认）** |
| `scripts/control-tower/check-acceptance-matrix.py` | 三态校验器（T2）：子集解析 ＋ F2/F3 校验 ＋ 机械 11 项 ＋ `--verify`／`--json` ＋ 降级日志 |
| `tests/control-tower/check-acceptance-matrix.test.sh` | 配对测试（T3）：绿基线 ＋ M1–M5 改坏必红 ＋ D1–D2 降级 exit 2（mktemp 沙箱，零网络） |

## Further Exploration

- **回执载体**（"已过独立复核"的物理凭据，与本目录平行）：`docs/synova/reviews/README.md`（`syno-review-receipt/v1`；规格 §5.5 拟在回执里增 `matrix` 字段，P0 不动）。
- **三态与降级两态的实现样板**：`scripts/control-tower/check-quality-delta.py` 头部（`@input/@output/@exit/@degraded` ＋ `degraded()` ＋ 带 `code` 的 `DeltaError`）。
- **认领声明载体**（写集声明与 `verify` 命令）：`scripts/control-tower/claim_store.py` ＋ `.claude/claims/<issue>.yaml`。
- **纪律定义源**（本件只做指针，不复制）：handbook `CTO-交接-2026-10-26-M4出口面.md` §5bis-C（15 条）｜`.dsh/skills/dsh-code-standards/SKILL.md`（8 项品味 ＋ 四约定）。
- **规格源**：handbook `派单件/2026-10-27-规格-1054-验收矩阵机制-P0.md` @ `b086a0a`。
- **后续分期**：P2 = CI report-only（A 类提案，未获准）；P3 = 合并语义接入（A 类）。**P0 只到"可跑、可核、可改坏必红"为止**。

## Known Limitations

🔴 **做不到什么**（禁把本件读成"已检测／已完成"）：

1. **`changed_files` 是自报的，不与 git 对账**：本器不跑 `git diff --name-only` 校验变更集真伪 ⇒ "漏报文件"检测不到（信任边界；与 `check-quality-delta.py` 的"只判变更集"同型）。
2. **机械项只判存在性／负证据，不判语义**：`assertNever` 出现 ≠ 穷尽性正确；`passed` 子串 ≠ 测试真通过；`已知限制` 出现 ≠ 内容切题；`^## ` 小节数 ≥5 ≠ 小节内容合格。
3. **`n/a` 的负证据命令只记录、不执行**：本器**不跑** `evidence.cmd`（安全边界：矩阵来自 PR，执行其中的任意命令＝任意代码执行）⇒ "期望 0 命中"是**声明**，不是本器验证的结果。
4. **P0 不接 CI／pre-commit**（规格 §3 非目标）：本批**不新增任何调用点**；"绿"只代表你手动跑了它。
5. **`--verify` 抓不到实现 bug**：它与 plain 共用同一实现（承诺 4）⇒ 实现错则两者同错。它抓的是"矩阵声明与机械事实不一致"，不是"校验器算错了"。
6. **错误码粒度不足**：机械硬违反与声明矛盾同码 `E_MATRIX_SCHEMA`；exit 2 的用法／矩阵 IO／仓／anchor／git 五类统一 `E_ANCHOR_MISMATCH` 靠 `phase` 区分——这是 10 码闭包的有意取舍，归因靠 `detail`／`phase`，不靠码。
7. **不判质量好坏、不替代 K3**：本件只保证"验收结论**齐全**且**证据可核**"；语义项只输出 `attested`（字段齐全），**pass/fail 归复核位**。
8. **URL 类 evidence 不联网**：只检查"含 anchor 前 7 位 hex"这一字符串条件 ⇒ 不验可达性／状态码；7 位前缀可被伪造或碰撞（**有意**：P0 不允许校验器发网络请求）。
9. **T-8 只对代码目录数小节数，域外目录被跳过**：`^## ` ≥5 是结构计数，`AGENTS.md` 存在但内容空洞照样绿；`.claude/**`、`memory/**`、`docs/**` 等记录面与其它域外目录**不进判定域**（**顶层目录本层直挂件仍入作用域**，见 §9 T-8 的 `(/|$)`），只向 stderr 打印 `T-8 scope: skip …` 提示并计入 `skipped=` ⇒ **跳过 ≠ 已验证**。
10. **子集 YAML 不支持真实 YAML 的多行字符串／块序列／锚点别名**：超出子集一律 `E_MATRIX_SCHEMA`（有意 fail-closed，不猜）；复杂值请改成单行或加双引号。
11. **本目录的台账登记在本批补齐**：`docs/AGENTS.md` 要求新文件登记 `docs/authority/DOCS-REGISTRY.yaml`；本批经 **L1 批准（Gitea #1054 评论 · 2026-10-27）**的扩写集共 **2 件**（`docs/authority/DOCS-REGISTRY.yaml` ＋ `docs/authority/WIRING-REGISTRY.yaml`），由登记件落 **4 条** `status: active` 登记：`docs/synova/acceptance/README.md` = **DOC-0309**、`docs/synova/acceptance/1053.matrix.yaml` = **DOC-0310**、`docs/synova/acceptance/1048.matrix.yaml` = **DOC-0311**、`gate-exemptions/2026-10-27-1054-gate-exempt.md` = **DOC-0312**。🔴 **本批 DOC-0309–0312 与 M4 线 DOC-0306–0308 不重号**（0306／0307／0308 归 M4 线：`gate-exemptions/2026-10-27-825-m7-probe.md`／`docs/synova/runbooks/README-probe-knowledge-scope.md`／`gate-exemptions/2026-10-27-t8-1051-pointer.md`）；本批 4 条为合基线（`gitea/local-main` @ `0fda487e2`）后顺延重登。登记条目不改变本件任何判据；若两者口径冲突，**以本件为准**。
12. **回溯样例 anchor `5553bb95c` 不在 `local-main` 祖先上**：含该提交的分支是 `feat/m4-1051-closeout`（及 `cto/t1-c4`），**不是** `feat/1053-metric-readings-schema`（其 tip `b6ce2d44e` 不含该提交）——本器只要求"anchor 在本仓可解析且内容可读"，不判"anchor 是否已并入主线"；该事实由样例／复核位如实记录，不是本件的缺陷。因此 **A1 默认样例改用主线锚 `1048.matrix.yaml`@`1ca0d4dfc`**；`1053.matrix.yaml` 定位为 **A1b 回溯演练（不得作默认）**。
13. **anchor 内容读取依赖本仓对象库**：若 anchor 指向未 fetch 的远端对象 ⇒ exit 2（判不了），此时**不是**矩阵写错。
14. **规格内部冲突已在 F3 处裁决，本件按裁决执行**：规格 §5.1 示例写 `n/a` 的 `evidence.out: "0"`，与 §6 边界表（`out` = 仓内路径／含 anchor sha 的 URL，不存在即 `E_EVIDENCE_UNRESOLVED`）**互相冲突**；L1 2026-10-27 裁决取 **§6（判据表）** ⇒ `out` 一旦出现即强校验、`n/a` 只写 `cmd`。**这不是 F1–F12 的改动**（F2 本就写"`out` 不要求"，F3 本就无 status 例外），只是把两处规格的冲突显式记录下来，供 K3 复核时判定该取舍是否成立。
15. **`T-1..T-8` 的序号 ≠ `.dsh/skills/dsh-code-standards` 的 `B1–B8` 表序号**：B 表是**实现标准分类**（B1 typed error／B2 config schema／B3 invariant／B4 bounds fail-loud／B5 explicit authority／B6 JSDoc／B7 design philosophy／B8 测试配对），本件 `T-n` 是**验收品味序**（按 handbook §5 列举序：`T-1` 头部契约／`T-2` typed error 带 code／`T-3` fail loud／`T-4` explicit authority／`T-5` 已知限制节／`T-6` 设计哲学一句／`T-7` 测试配对／`T-8` 长期件 README）。**引用时按本表序，勿按 B 表序套号**（例：B5 explicit authority 对应本文 `T-4`）。
16. **`1048.matrix.yaml` 的 `changed_files` 取真实 15 件（= `git diff --name-status 9b0b1f935 1ca0d4dfc` 全量，零过滤）**：`T-8` 的作用域已收窄为**仅代码目录**（见 §9 F12），`.claude/**`、`memory/**`、`docs/**` 属记录面 ⇒ **跳过**并向 stderr 显式打印 `T-8 scope: skip record-only dir <dir>`、计入 detail 的 `skipped=`；因此 `.claude/claims/1048.yaml` 与 `.claude/claims/1049.yaml` 两件认领台账**如实入集也不再触发 `T-8`**。变更集与 git diff 逐条一致，不做任何过滤。
