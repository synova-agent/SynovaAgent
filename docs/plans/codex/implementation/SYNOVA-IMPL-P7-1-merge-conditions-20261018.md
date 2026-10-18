---
status: proposed
日期: 2026-10-18
任务: P7-1 四条件自证检查器（Issue #582，2026-10-18 立卡）
撰写: P7（交付自证与真值包负责人）· **独立于实现者**（本件不含实现，实现交 `synova-squad-lead`）
依据: `agents/P7-交付自证与真值/AGENTS.md` §三/§四/§八/§八之三；`pre-plan-thinking` 9 问；`dev-doc-spec` v2（8 节＋3 条件）；创始人 2026-10-18 开工令（本包第一个交付＝dev doc，不写产品码）
批次规模: **新建 5 文件**（W1 检查器 ≈ 520 行｜W2 配对测试 ≈ 220 行｜W3 回执格式说明 ≈ 40 行｜W4 四态 Note ≈ 30 行｜W5 卡面 ≈ 40 行）；**改 0 个既有文件**
前置口径: 创始人 2026-10-18 —— ① 判「四条件」绿/红一条命令 ② **③ 凭据形态由本件设计**（不预设，但必须机器可判）③ 全绿 ⇒ exit 0；**改坏任一条 ⇒ 必红并给原始输出**
---

# SYNOVA-IMPL-P7-1 · `check-merge-conditions.sh`：四条件一条命令判绿/红

> 🔴 **本件是执行小队的唯一规格源（dev doc）**。口径已由创始人开工令 ＋ 本件 §4bis 裁死；**实现方不得自行改口径**。
> 🔴 **本件是文档，不是实现**：无产品代码、无 `.gitea/**`、无既有门禁脚本改动 ⇒ 可四条件自合（创始人令「dev doc 单独 PR」）。
> 🔴 **冻结**：派单时给 **blob SHA**，实现方引用 blob，不引用可变工作树。
> 🔴 **CTO 本轮三条排期令已逐条落到 §7**（不动 P4 三件／不自行接 CI／顺带修 P7 自身 ②⑦ 口径待批）。

---

## 封面 · 四行开场包

```
① 批次名：P7-1 · 四条件自证检查器（check-merge-conditions.sh）
② 写集（逐文件；**L1 划定，L2 不得扩**）：
   - scripts/control-tower/check-merge-conditions.sh                  （<新建> 主件：四条件编排 ＋ --selfcheck）
   - tests/control-tower/check-merge-conditions.test.sh               （<新建> CT-40 强制配对；6 条改坏用例）
   - docs/synova/reviews/README.md                                    （<新建> ③ 复核回执格式与生成流程，非空目录载体）
   - memory/notes/implemented/2026-10-18-p7-merge-conditions.md       （<新建> 四态 Note，铁律 49）
   - .claude/task-briefs/2026-10-18-p7-merge-conditions.md            （<新建> 卡面，pre-commit 组 6 六字段）
③ 判据（含"改坏必红"）：
   - 命令：bash scripts/control-tower/check-merge-conditions.sh --selfcheck
     期望：exit 0；末行 `SELFCHECK-OK: 6/6`；子例 A `inner_exit=0 CAN-自合并`
   - 命令：bash tests/control-tower/check-merge-conditions.test.sh
     期望：末行 `结果: N 通过, 0 失败`（N≥12，以实跑为准）、exit 0
   - 反例：把子例 A 的唯一绿输入各改坏一处 ⇒ 对应条件必红（①pending／②撞文件／③删回执／④tip 不祖先）；
     把 CI 状态改成 `total_count=0` ⇒ 必 `inner_exit=2 degraded`。每例的**原始输出**由测试逐条打印，禁截断
④ 域守则指针（**必须显式 read**，DSH 无法额外注入）：
   - scripts/control-tower/AGENTS.md ｜ tests/control-tower/AGENTS.md ｜ docs/AGENTS.md
   - memory/notes/AGENTS.md ｜（👁只读）`.gitea/AGENTS.md`
```

---

## §〇 归属与依据（派单七问）

| # | 问 | 答 |
|---|---|---|
| 1 | 谁派 / 依据 | 创始人 2026-10-18 开工令（本包第一个交付＝dev doc）＋ CTO 本轮排期令三条；`agents/P7-交付自证与真值/AGENTS.md` §三；Issue **#582**（2026-10-18 立卡） |
| 2 | 归属包 / 产品线 | **P7 交付自证与真值**（治理线·自证）｜域：`scripts/control-tower/`、`tests/control-tower/`、`docs/synova/reviews/` |
| 3 | 写集 | 见 §2（W1–W5，**文件级、两两不重叠**）；🔴 其中 **W2 需 CTO 批一行写集扩**（见附录 B-1） |
| 4 | 判据 | 见 §4（正常／降级／反例三条）＋ DS-1…DS-12 |
| 5 | 依赖 | 无（本包 §五「无」）；实现侧前置见 §7 |
| 6 | 不做什么 | 见 §1.2（**逐条路径**）＋ §7 红线 |
| 7 | 回执 | 见 §8（三信号 ＋ R2 ≤10 行；证据＝原始输出，**禁截断**） |

## 权威件回执（派单前实读，读过才写）

| 件 | 位置 | as_of | 读了什么（不是"提过"） |
|---|---|---|---|
| P7 包守则（九维全量） | `agents/P7-交付自证与真值/AGENTS.md` | `616162548` | ③ 判据＝`check-merge-conditions.sh` 输出 `CAN-自合并 / NO: <哪条>`；④ 写集；⑥ 不接 CI 硬阻断；⑦ 5 份域守则；⑧ 多任务不自己执行；⑧之三 ④ 个必复用既有约定 |
| 控制塔域守则 | `scripts/control-tower/AGENTS.md` | `616162548` | 三态退出码（信号量==0 ⇒ exit 2）／失败给具体失败点／"改坏确实红"留档／🔴 `scripts/audit/**` 禁碰 |
| 控制塔测试域守则 | `tests/control-tower/AGENTS.md` | `616162548` | 新增 `check-*` ⇒ 断言同步（WIRE CHECK：`grep` 零结果＝未完成）／零失败才合并／测试必有 `expect` 等价断言 |
| 文档体系守则 | `docs/AGENTS.md` | `616162548` | A/B/C 分层；过程件走 handbook；"数量"给枚举命令不给手写数 |
| 过程留痕守则 | `memory/notes/AGENTS.md` | `616162548` | 铁律 49 四态 Note；🔴 168-C：`memory/notes/**` 与 `.claude/task-briefs/**` 属配套件**默认可写** |
| CI 权威域守则（👁只读） | `.gitea/AGENTS.md` | `616162548` | CI 权威在 Gitea（`local-gates.yml`）；改门禁须独立送审且**禁与业务改动同 PR**；信号量==0 ⇒ exit 2 ⇒ **本件不碰 `.gitea/**`** |
| 创始人开工令 | 本会话直接指令（原文已录 §〇pre ①） | 2026-10-18 | 四条件机器化；③ 凭据形态我设计；dev doc 单独 PR；实现交 squad-lead |
| CTO 本轮排期令 | 本会话直接指令（三条） | 2026-10-18 | ① 不动 P4 三件 ② 不自行接 CI ③ 顺带修 P7 自身 ②⑦（口径我拟 CTO 批） |

---

## §〇pre · `pre-plan-thinking` 9 问（**逐问留证据；答不出不许动笔**）

> 证据全量在 `docs/evidence/p7-merge-conditions/`（**被 `.gitignore:81 evidence/` 覆盖 ⇒ 不入库、不脏树**；命令原样可复跑）。
> 🔴 **禁 `head` 截断**：本件摘录均标「摘录」，全量见对应 `.out`。

| # | 问 | 证据（命令 ⇒ 原始输出，摘录） | 落到 |
|---|---|---|---|
| **①** | 问题：谁在什么场景遇到什么？不做会怎样？ | 创始人原话：「**一条命令对任意 diff/PR 判「四条件」绿/红**」。不做 ⇒ 每条线合并前都要问 CTO（枢纽复现），且**没人能自证能不能合**。现状物证：`check-merge-conditions.sh` 在 HEAD **不存在**（`git ls-tree -r --name-only HEAD -- scripts/control-tower/check-merge-conditions.sh \| wc -l` ⇒ **0**）⇒ P7 §三 判据**今天跑不了**（P4 独立复核 F1 同结论） | §1 |
| **②** | 现状：这块现在怎么跑的？谁调用？改它波及谁？ | 四条件**今天靠人**：Gitea `reviews` 通道**从未被使用**（`curl /pulls/580/reviews` ⇒ `[]`）；PR 合并记录在 handbook 由人转述。机器可读面实测可用：`/commits/<sha>/status` 返回 `{state:"success", total_count:2, statuses:[...]}`（ci-work）。调用方现状：**无**（本件是首建，不被任何既有脚本调用 ⇒ 零回归面，除 CT-40 配对要求） | §3 / §6 |
| **③** | 有没有现成的？ | 逐类 grep 见 **§6 表**（`scripts/control-tower/` 131 件／`check-*` 26／`probe-*` 28；`sync`：`devdoc_writeset.py`、`verify-parallel.sh`、`check-dev-doc-write-set.sh`、`merge_writeset_gate.py`、`check-board-truth.ts`、`ct-test-gate.sh`）。结论：**② 已有强基础（复用其内核，不重写解析器）**；**①③④ 三个查询各有半件，无编排件** ⇒ **确需新建 1 个编排件**（理由见 §6 末行） | §6 |
| **④** | 最小改动：最少改哪里？ | **必须**：1 个新脚本 ＋1 个配对测试 ＋1 个回执格式说明 ＋配套 Note/卡面。**想改但不必要（全部划掉）**：改 `verify-parallel.sh` 加 `--open-prs`（它在 CI 的 `--ci-pr` 路径上，P4 主域，回归风险）；改 `merge_writeset_gate.py`（intra-PR 夹带，与②正交）；改 `.gitea/**` 接 CI（CTO 令②禁）；给 `check-package-selfsufficiency.py` 加格（P4 域） | §2 |
| **⑤** | 最危险的假设：错了最可能是哪条？**先实测** | 假设「CI 状态可机器读，且 `state=="success"` 就等于绿」⇒ **半假**：实测**无任何 CI 的提交**返回 `{"state":"pending","total_count":0,"statuses":null}`（`0c8179665`）—— 即「看不见」被 Gitea 报成 `pending` ⇒ 若只判 `state!="failure"` 会**永远黄/误绿**。⇒ 必须显式 `total_count==0 ⇒ exit 2`（信号量==0，既有约定）。第二个危险假设「PR 的 `base.sha` ＝ 分支点」⇒ **假**：实测 14 个 open PR 的 `base.sha` **全部**等于当前 tip，但 `git merge-base --is-ancestor` **14/14 不成立**（落后 57–115 commits） | §3 / §4bis |
| **⑥** | 失败路径：失败会静默还是报错？**先写反例** | 反例 6 条（子例 A 全绿被逐一改坏）＋「看不见」子例 F：见 §4.3；判别力自检 `--selfcheck` 与配对测试**两处**都必须红。降级一律 `stderr degraded: <原因>` ＋ exit 2，绝不当绿 | §4 |
| **⑦** | 边界：明确不做什么？谁负责那些？ | 逐条路径见 §1.2：`.gitea/**`（CTO 令②）／P4 三件（CTO 令①）／`scripts/audit/**`（K3）／`src/**`／既有 `check-*` 与 `verify-parallel.sh`（不改，回归风险）／`scripts/control-tower/probe-line-signals.ts`（**下一批**，本件不做三信号） | §1 / §7 |
| **⑧** | 可观测：哪个命令/数字能证明它对？ | 主判据一条命令：`bash scripts/control-tower/check-merge-conditions.sh --pr <N>` ⇒ 末行 ∈ {`CAN-自合并`｜`NO: <条件名>`｜`degraded: <原因>`}，**三态退出码**见 §4bis 与 §4.4 DS-4；判别力：`--selfcheck` 末行 `SELFCHECK-OK: 6/6` | §4 |
| **⑨** | 拆步：能拆成可独立验证的步吗？能回滚吗？ | 3 步：**S1** 骨架＋①②④（有真数据可验）→ **S2** ③ 回执（schema＋指纹＋时序）→ **S3** `--selfcheck`＋配对测试（判别力）。每步独立判据；单文件 revert 即可回滚（新建文件，零波及） | 封面／§8 |

---

## §1 做什么

### 1.1 目标（一句话 ＋ 可观测结果）

**目标**：一条命令对**任意 PR/diff** 判「四条件」（① CI 全绿 pending=0 ② 零写集重叠 ③ 已过独立复核 ④ 串行）绿/红，输出 `CAN-自合并` / `NO: <哪条>` / `degraded:`，退出码三态。

**可观测结果**（三条，逐条可跑）：
1. `--pr <N>` 在真仓上给出四行条件结论 ＋ 一行机器行 `MERGE-COND: can|no|degraded ①=… ②=… ③=… ④=…`；
2. `--selfcheck` 在零网络的临时仓上跑 6 子例，全绿输入 ⇒ `inner_exit=0 CAN-自合并`，逐条改坏 ⇒ 逐条必红；
3. 任一条件失败时，输出**具体失败点**（哪个 context pending／哪个文件撞哪个 PR／哪条 R 规则不满足／落后多少 commits）。

### 1.2 非目标（逐条列路径；L2 不许碰）

- ❌ `.gitea/**`（**接 CI 硬阻断**＝CTO 令②「先停下报我」；本件退出码只给本地/人判，不进 CI）
- ❌ `scripts/control-tower/founder-truth.py`｜`tests/control-tower/founder-truth.test.sh`｜`scripts/control-tower/gate-integrity-baseline.txt`（**CTO 令①：P4 正跑，文件级互斥**）
- ❌ `scripts/audit/**`（K3 专属，任何人禁碰）
- ❌ `src/**`、`extensions/**`、`.github/**`（非本包域）
- ❌ 既有门禁件：`verify-parallel.sh`、`check-dev-doc-write-set.sh`、`merge_writeset_gate.py`、`devdoc_writeset.py`、`check-board-truth.ts`、`ct-test-gate.sh`——**只读复用，一行不改**
- ❌ `scripts/control-tower/probe-line-signals.ts`（三信号探针＝**下一批**，本件不建）
- ❌ 不改 `agents/P7-交付自证与真值/AGENTS.md`（②⑦ 修复口径见**附录 C 待批**，未批不落）
- ❌ 不实现「自动合并」：本件只**判**，不 `merge`、不 `push`（合并仍由人/会话执行）
- ❌ 不做「已合 PR 之间的写集重叠」（＝既有 `verify-parallel.sh --ci-pr`）、不做「单 PR 夹带」（＝既有 `merge_writeset_gate.py`）

---

## §2 在哪做（**file:line ＋ 写集；两两不重叠**）

> 本批 **5 个文件全部为新建** ⇒ "file:line" 以**函数级行锚（预估，实现以实测行号为准）**给出；实现方**不得改变函数边界之外的职责**。

### 2.1 写集表

| 文件 | 操作 | 归属 | 说明 |
|---|---|---|---|
| `scripts/control-tower/check-merge-conditions.sh` | **新建** | W1 | 四条件编排 ＋ `--selfcheck`（单文件，内联 python3 解析，**不新增 .py 内核**，理由见 §6 末行） |
| `tests/control-tower/check-merge-conditions.test.sh` | **新建** | W2 | CT-40 强制配对；6 条改坏用例 ＋ 三态断言 |
| `docs/synova/reviews/README.md` | **新建** | W3 | ③ 回执格式 ＋ 生成流程 ＋ 已知限制（目录非空载体） |
| `memory/notes/implemented/2026-10-18-p7-merge-conditions.md` | **新建** | W4 | 四态 Note（铁律 49；168-C 配套件默认可写） |
| `.claude/task-briefs/2026-10-18-p7-merge-conditions.md` | **新建** | W5 | 卡面六字段（pre-commit 组 6；168-C 配套件默认可写） |

**两两不重叠**：W1（产品脚本）／W2（测试）／W3（回执说明）／W4（Note）／W5（卡面）互不交叠；**W5 与 W4 由实现方写，W1–W3 归实现方**（本件撰写者不实现）。

### 2.2 W1 结构（行锚为预估，**七段**）

| 段 | 行锚（预估） | 职责 |
|---|---|---|
| 头部契约注释 | `:1-40` | `@input / @output / @exit / @degraded / @authority / @cross_platform`（铁律 47 ＋ P7 守则 §八之三②） |
| 常量与环境 | `:41-70` | UTF-8 强制（`PYTHONIOENCODING`/`LC_ALL`）｜`SYNO_GITEA_API`/`SYNO_GITEA_REPO`/`GITEA_TOKEN` 三级取 token（**照抄** `scripts/control-tower/check-board-truth.ts:27-28` 口径）｜`SYNO_MERGE_BASE` 缺省 `local-main`｜degraded log 路径 |
| 参数与用法 | `:71-110` | `--pr/--base/--repo-root/--json/--offline/--diff-fingerprint/--print-receipt-template/--selfcheck/--help`；非法参数 ⇒ exit 2 |
| 基础函数 | `:111-190` | `die_degraded()`／`fail()`｜`api_get()`（curl ＋ token ＋ 分页，**禁 `--limit` 饱和**：照抄 `scripts/control-tower/check-board-truth.ts:41-52` 的分页注释口径）｜`ensure_ref()`（`git fetch gitea refs/pull/<n>/head` → `git update-ref refs/p7cmp/pr/<n>`）｜`diff_files()`｜`patch_fingerprint()` |
| 四条件 | `:191-330` | `cond1_ci()`／`cond2_overlap()`／`cond3_review()`／`cond4_serial()`（算法见 §4bis） |
| 编排与输出 | `:331-430` | `main()`：解析 PR → 顺序跑四条件 → 打印逐条证据 → `MERGE-COND:` 机器行 → 末行 `CAN-自合并`/`NO: …` → 三态 exit |
| `--selfcheck` | `:431-520` | 临时 git 仓 ＋ 夹具 JSON（零网络）跑 6 子例，末行 `SELFCHECK-OK: 6/6` 或 `SELFCHECK-FAIL: <子例>` |

### 2.3 不许动的既有件（**只读复用**）

`verify-parallel.sh`｜`check-dev-doc-write-set.sh`｜`devdoc_writeset.py`｜`merge_writeset_gate.py`｜`check-board-truth.ts`｜`ct-test-gate.sh`｜`pre-commit-check.sh`｜`.gitea/workflows/local-gates.yml`（**一个字节都不改**）

---

## §3 凭什么做（**现状证据，逐条可复跑**）

| # | 事实性前提 | 命令 ⇒ 原始输出（摘录；全量见 `docs/evidence/p7-merge-conditions/`） |
|---|---|---|
| F1 | 判据件不存在 ⇒ 判据今天跑不了 | `git ls-tree -r --name-only HEAD -- scripts/control-tower/check-merge-conditions.sh \| wc -l` ⇒ **0**；`ls tests/control-tower/check-merge-conditions.test.sh` ⇒ `No such file` |
| F2 | Gitea 原生 review 通道**从未被使用** ⇒ ③ 不能靠它 | `curl /repos/synova-agent/SynovaAgent/pulls/580/reviews` ⇒ `[]`；`/collaborators` ⇒ `["win-push"]`（**全仓仅 1 个协作者账号**） |
| F3 | CI 状态**可机器读** | `curl /commits/75abe203a/status` ⇒ `{"state":"success","total_count":2,"statuses":[{"context":"local-gates / gates (push)","status":"success"},{"context":"local-gates / gates (pull_request)","status":"success"}]}` |
| F4 | 🔴 **「看不见」被报成 pending**（最危险假设实测） | `curl /commits/0c8179665/status` ⇒ `{"state":"pending","total_count":0,"statuses":null}` ⇒ 必须 `total_count==0 ⇒ exit 2` |
| F5 | 🔴 PR 的 `base.sha` **不是**分支点 | 14 个 open PR 的 `base.sha` **全部** = `616162548`（当前 tip）；但 `git merge-base --is-ancestor <tip> <head>` ⇒ **14/14 不成立**（落后 **57–115** commits）；`git merge-base` 实测分支点 = `44a30a572`(558)…`38d77034b`(416) ⇒ ④ 必须用 `merge-base` 判，**禁用 API 的 base.sha** |
| F6 | ② 在真仓上**很少红但真会红**（不吵） | 14 个 open PR 两两比对 **91 对 ⇒ 重叠 2 对**：`PR416 ∩ PR517 = .gitignore`；`PR #547 ∩ PR #553 = scripts/check-architecture.sh` |
| F7 | 既有写集机器可复用（不重写解析器） | `verify-parallel.sh` **405 行**/4 模式（`--doc-a/--doc-b/--scan-today/--ci-pr`）；`devdoc_writeset.py`（提取＋`--overlap-a/--overlap-b`，**三态内核**）；`check-dev-doc-write-set.sh` **172 行**（声明 vs 实际，正反双向）；`merge_writeset_gate.py` **1134 行**（intra-PR 夹带） |
| F8 | 既有约定可照抄（三态／降级／UTF-8／token） | `grep -l "exit 2" scripts/control-tower/*.sh \| wc -l` ⇒ **38**；`grep -rln "SYNO_GATE_DEGRADED_LOG\|degraded-events.log" scripts/control-tower/*.sh \| wc -l` ⇒ **8**；token 三级口径见 `scripts/control-tower/check-board-truth.ts:27-28` |
| F9 | CT-40 配对是**硬拦**（本件必须带测试） | `scripts/control-tower/ct-test-gate.sh:18` 配对规则 `scripts/{control-tower,workflow,hooks}/<name>.<sh\|py> ↔ tests/control-tower/<name>.test.sh`；接线 `scripts/pre-commit-check.sh:793-802` 组 2d |
| F10 | 鉴权失败可判（degraded 有据） | 无 token：`curl -o /dev/null -w %{http_code}` ⇒ **403**；有 token ⇒ **200** ⇒ `HTTP≠200` 一律 exit 2 |
| F11 | 指纹**可复算且稳定**（③ 防重放的物理基础） | `git diff --no-color -M --full-index --binary <mb> <head> \| shasum -a 256` 连跑两次 ⇒ 同值 `22c39c01…91afa`；`-- . ':(exclude)docs/synova/reviews/**'` 后 ⇒ **同值**（回执自身不改变指纹，见 §4bis ③-0） |
| F12 | 14 个 open PR 的 head **都取得到**（离线亦可行） | `git fetch gitea refs/pull/<n>/head` ⇒ **14/14 成功**（`refs/p7/pr/*` 已物化） |
| F13 | P7 自身现状 **①②⑦ 三红**（本件顺带修 ②⑦ 的输入） | `python3 scripts/control-tower/check-package-selfsufficiency.py --packages P7` ⇒ `P7-交付自证与真值  🔴 🔴 ✅ ✅ ✅ ✅ 🔴 ✅ ✅ ✅`；证据行：`缺引用: check-merge-conditions.sh`／`§三 缺 命令 token、反例 token`／`缺「事实落点」节` |

**若 F1–F13 任一不成立 ⇒ 停，退回 L1**（说明现场已变，规格需重核）。

---

## §4 怎么算做完（**三路径 ＋ DS；反例必红**）

### 4.1 正常路径

```bash
# N1 判别力自检（零网络，最重要的可用性证明）
bash scripts/control-tower/check-merge-conditions.sh --selfcheck
# 期望：exit 0；末行 `SELFCHECK-OK: 6/6`；子例 A 打印 `[selfcheck] A 全绿 ⇒ inner_exit=0 CAN-自合并`

# N2 真仓四条件（四行证据 ＋ 机器行 ＋ 末行；今日全仓 ④ 必红，见 §4bis ④）
bash scripts/control-tower/check-merge-conditions.sh --pr 558
# 期望：exit 1（今日）；逐条：① ✅ ② ✅ ③ 🔴（缺回执）④ 🔴（S1 落后 57 commits）；
#       机器行 `MERGE-COND: no ①=ok ②=ok ③=no ④=no`；末行 `NO: ③ 已过独立复核, ④ 串行`

# N3 配对测试
bash tests/control-tower/check-merge-conditions.test.sh
# 期望：末行 `结果: N 通过, 0 失败`（N≥12）、exit 0

# N4 门禁未新增违规（本批只看不改的既有件无回归）
SYNO_BASE_REF=origin/local-main bash scripts/pre-commit-check.sh   # 期望 13 组全过（含 CT-40 组 2d）
```

### 4.2 降级路径（**必须仍可触发**）

```bash
# D1 API 不可达 ⇒ exit 2（不当作"没红"）
SYNO_GITEA_API=http://127.0.0.1:1/api/v1 bash scripts/control-tower/check-merge-conditions.sh --pr 558
# 期望：exit 2；stderr `degraded: Gitea API 不可达`

# D2 无 token ⇒ exit 2
GITEA_TOKEN= SYNO_GITEA_TOKEN= HOME=/nonexistent bash scripts/control-tower/check-merge-conditions.sh --pr 558
# 期望：exit 2；`degraded: HTTP 403`

# D3 信号量==0 ⇒ exit 2（F4 陷阱）
#    夹具把 status 置 total_count=0 ⇒ 期望 exit 2；`degraded: CI 信号量==0（state=pending total_count=0）`

# D4 --json 合法
bash scripts/control-tower/check-merge-conditions.sh --pr 558 --json | python3 -m json.tool >/dev/null && echo JSON-OK
```

### 4.3 🔴 反例（**改坏必红，六条，缺一不可**）

> 载体：`--selfcheck` 子例（零网络夹具）＋ `tests/control-tower/check-merge-conditions.test.sh` 同名 6 条。
> **每条必须打印原始输出**（`[selfcheck] <子例> … inner_exit=<n> verdict=<…>`），禁 `head` 截断。

| 子例 | 改坏什么 | 期望（inner） |
|---|---|---|
| **A**（基线） | 不改（唯一全绿输入：1 个 open PR ＋ 回执齐 ＋ 基于 tip ＋ CI success×2） | `inner_exit=0`；末行 `CAN-自合并` |
| **B** | ① 把某 context 置 `pending`（total_count=2） | `inner_exit=1`；末行 `NO: ① CI 全绿 pending=0`；逐条点名该 context |
| **C** | ② 加一个 open PR 改**同一文件** | `inner_exit=1`；末行 `NO: ② 零写集重叠`；点名 `文件 → PR#` |
| **D** | ③ 三个变体：**D1** 删回执｜**D2** 回执指纹改 1 位｜**D3** 回执 commit 之后再改一行码 | 三变体都 `inner_exit=1`；末行 `NO: ③ 已过独立复核`（D1 `R1 缺回执`／D2 `R3 指纹不匹配`／D3 `R7 回执之后仍有代码改动`） |
| **E** | ④ 让 tip 前进 1 commit（head 不含它） | `inner_exit=1`；末行 `NO: ④ 串行`；`S1 tip <sha> 不是 head 祖先（落后 1 commits）` |
| **F** | CI **看不见**（`total_count=0`） | `inner_exit=2`；`degraded: CI 信号量==0`（**禁把"看不见"判绿或判红**） |

**判别力判据（硬）**：A 必须绿、B–E 必须红、F 必须 exit 2；**任一不符 ⇒ `SELFCHECK-FAIL: <子例>`＋ exit 2**（检查器自身不可信，不得 exit 0）。

### 4.4 DS（交付声明，逐条可核验）

| # | 声明 | 核验命令 | 期望 |
|---|---|---|---|
| DS-1 | 四条件全绿输入 ⇒ exit 0 | `--selfcheck` 子例 A | `inner_exit=0 CAN-自合并` |
| DS-2 | 改坏任一条件 ⇒ 必红且给原始输出 | `--selfcheck` 子例 B–E | `inner_exit=1` ＋ 末行点名该条件 |
| DS-3 | 「看不见」不当绿/红 | 子例 F | `inner_exit=2` ＋ `degraded:` |
| DS-4 | 三态退出码 | `bash tests/.../check-merge-conditions.test.sh` | 覆盖 0/1/2 三种 exit |
| DS-5 | 输出末行契约 | `--pr <N>` 末行 | ∈{`CAN-自合并`,`NO: …`}；恒有 `MERGE-COND:` 机器行 |
| DS-6 | ③ 凭据机器可判、非人转述 | 回执 schema 校验 ＋ `R1..R8` | 逐条可复跑（§4bis ③） |
| DS-7 | ③ 防重放（改一个字节即红） | 子例 D 变体 2 | `R3 指纹不匹配`、退出码 1 |
| DS-8 | ③ 时序（复核后不得再改码） | 子例 D 变体 3 | `R7 回执之后仍有代码改动`、退出码 1 |
| DS-9 | ④ 基线新/队首两条都判 | 子例 E ＋ 队首用例 | 各自红并点名 `S1`／`S2` |
| DS-10 | 只读 | 脚本运行前后 `git status --porcelain` 不变 | 前后 diff 为空（`--selfcheck` 只写系统临时目录） |
| DS-11 | 不改既有件 | `git diff --stat <base>..HEAD` | 只含 W1–W5 五文件 |
| DS-12 | 配套件齐 | `ls memory/notes/implemented/2026-10-18-p7-merge-conditions.md .claude/task-briefs/2026-10-18-p7-merge-conditions.md` | 两件存在且六字段/四态齐 |

---

## §4bis 🔴 四条件口径（**本件裁死，实现不得改**）

### ① CI 全绿 pending=0

```
数据源：GET {SYNO_GITEA_API:-http://127.0.0.1:3000/api/v1}/repos/{R}/commits/{head}/status
        token 三级：GITEA_TOKEN → SYNO_GITEA_TOKEN → $HOME/gitea/.win-push-token（照抄 scripts/control-tower/check-board-truth.ts:27-28）
绿 ⇔ HTTP 200 ∧ state=="success" ∧ total_count≥1 ∧ 无 statuses[].status ∈ {pending,failure,error}
红 ⇔ total_count≥1 ∧ 存在 pending/failure/error ⇒ 逐条点名 `context=status`
exit 2（degraded）⇔ HTTP≠200 ∨ total_count==0（**F4：看不见≠没问题**）∨ JSON 解析失败
注：**不认 `base.sha`、不认 PR 的 mergeable 字段**（F5 实测不可作分支点；mergeable 是缓存）
```

### ② 零写集重叠

```
本 PR 文件集  F0 = git diff --name-only <mb>...<head>（ASCII 排序；mb = merge-base(tip, head)）
其他在飞    P  = GET /pulls?state=open（分页拉全；排除本 PR）
对每个 p∈P：ensure_ref(p) → Fp = git diff --name-only <mb_p>...<head_p>
绿 ⇔ ∀p: F0 ∩ Fp = ∅
红 ⇔ ∃p: 交集非空 ⇒ 逐文件点名 `<文件> → PR#a,PR#b`
exit 2 ⇔ open PR 列表取不到 ∨ 任一 ref fetch 失败（fail-closed，禁"取不到就当无重叠"）
信息级（**不入判定**）：声明写集交集 —— `devdoc_writeset.py --overlap-a/--overlap-b`（复用，不重写）
边界：**本件不做**「声明 vs 实际」（`check-dev-doc-write-set.sh`）与「单 PR 夹带」（`merge_writeset_gate.py`）
```

### ③ 已过独立复核（**凭据形态＝复核回执；本件设计**）

> 为什么不用 Gitea 原生 review：**F2 实测** `reviews=[]`（历史从未使用）∧ 全仓仅 1 个协作者账号 ⇒ 原生 review **无法表达"独立"**，且它只是"人点了按钮"，不可核内容。

**③-0 指纹定义**（唯一，必须与实现一致）：

```
mb  = git merge-base <tip> <head>
fp  = sha256( git diff --no-color -M --full-index --binary <mb> <head> -- . ':(exclude)docs/synova/reviews/**' )
      · 用 --full-index：blob SHA 是内容寻址 ⇒ **rebase 后同内容同指纹**（⑨ 拆步：rebase 不必重做复核）
      · 排除 reviews/**：回执自身不改变指纹 ⇒ **无循环依赖**（F11 实测：排除前后同值）
      · 注意：`<tip>` 只用于求 merge-base，故 rebase 到新 tip 后 fp 仍稳定（内容未变）
路径 = docs/synova/reviews/<pr>.<fp 前 12 位 hex>.json
```

**③-1 回执 schema（`syno-review-receipt/v1`，逐字段必填）**：

```json
{
  "schema": "syno-review-receipt/v1",
  "pr": 558,
  "patch_fingerprint": "sha256:<64 hex>",
  "author": "<被复核会话标识，与 reviewer 不同>",
  "reviewer": "<复核会话标识（fresh，未参与实现）>",
  "independence": "fresh-session",
  "verdict": "PASS",
  "checks": [ {"id":"铁律38","cmd":"grep -rn 'as any' <变更文件>","result":"pass","evidence":"<原始输出摘要或 docs/evidence 路径>"} ],
  "findings": [ {"severity":"warn","where":"path:line","what":"…"} ],
  "issued_at": "2026-10-18T22:00:00+08:00",
  "tool": "pr-review@v1（.dsh/skills/pr-review/SKILL.md 五步）"
}
```

**③-2 机器判法（R1–R9，**全绿才绿**）**：

| # | 规则 | 判法 | 不过时输出 |
|---|---|---|---|
| R1 | 回执在 head 树 | `git cat-file -e <head>:docs/synova/reviews/<pr>.<fp12>.json` | `R1 缺回执 <path>` |
| R2 | schema/pr 合法 | JSON 可解析 ∧ `schema=="syno-review-receipt/v1"` ∧ `pr==N` | `R2 回执非法/PR 不符` |
| R3 | **防重放** | `patch_fingerprint == "sha256:"+fp` | `R3 指纹不匹配（回执已被改码作废）` |
| R4 | 复核结论 | `verdict=="PASS"` ∧ `len(checks)>=5` ∧ 全部 `result=="pass"` | `R4 checks 未全 pass（<id> 失败）` |
| R5 | 无阻断发现 | `findings[]` 无 `severity=="block"` | `R5 存在 block 级发现` |
| R6 | 非自我复核 | `reviewer` 与 `author` 均非空 ∧ `reviewer != author` | `R6 reviewer 与 author 相同` |
| R7 | **时序** | 回执引入提交 `C`（`git log --diff-filter=A --format=%H -1 <head> -- <path>`）：`git diff --name-only C <head>` 只允许 `docs/synova/reviews/**` | `R7 回执之后仍有代码改动: <文件>` |
| R8 | 证据非空 | 每条 `checks[]` 的 `cmd` 与 `evidence` 非空 | `R8 checks[i] 缺 cmd/evidence` |
| R9 | **告警级**（不改判定） | 回执引入提交的 `%ae` ∈ PR 代码提交 `%ae` 集合 ⇒ 打 `warn: 身份未分离（本机 git 身份不可信）` | 仅打印 |

**③-3 生成流程（复核会话执行，**本件不实现自动合并**）**：

```bash
bash scripts/control-tower/check-merge-conditions.sh --pr <N> --diff-fingerprint      # 取 fp
bash scripts/control-tower/check-merge-conditions.sh --pr <N> --print-receipt-template > /tmp/r.json
# 复核者按 .dsh/skills/pr-review/SKILL.md 五步跑物理检查，填 checks/verdict/findings
# 写入 docs/synova/reviews/<N>.<fp12>.json 并 commit（🔴 必须是本分支**最后一个**提交；之后不得再改代码）
```

### ④ 串行

```
S1 基线新：tip = git ls-remote gitea refs/heads/<base> —— 取远端真值（**禁用本地 stale ref**）
          绿 ⇔ git merge-base --is-ancestor <tip> <head>
          红 ⇒ `S1 tip <sha> 不是 head 祖先（落后 N commits）⇒ 需 rebase`
S2 队首  ：在 open PR 中，凡「①∧②∧③∧S1 全绿」者取编号最小者 Q
          绿 ⇔ 本 PR == Q（或该集合为空）
          红 ⇒ `S2 前置就绪 PR #<Q> 编号更小 ⇒ 先合它`
绿 ⇔ S1 ∧ S2；exit 2 ⇔ `git ls-remote` 失败（degraded）
注：S2 排除 S1 不绿者 —— 否则「陈旧 PR」会死锁队列（陈旧者必须先 rebase，那是它自己的 ④ 红）
```

**今日存量实况（必须写进回执的例外清单，不得当"修到绿"）**：14/14 open PR 的 **S1 全红**（落后 57–115 commits）⇒ **今天不会有任何 `CAN-自合并`**；这是**正确行为**，不是 bug。故本件**不接 CI 硬阻断**（CTO 令②＋P7 守则 §六）。

---

## §5 怎么跑（**L2 fresh 必问的四件：取树／依赖／运行／落盘**）

```bash
# 取树（不在主树干活；主树落后 240 commits 且脏 ⇒ 禁写）
git -C /Users/wane/SynovaAgent fetch gitea
git -C /Users/wane/SynovaAgent worktree add .synova-wt-p7impl-$(date +%m%d) -B ct/p7-impl-$(date +%m%d) gitea/local-main
cd /Users/wane/SynovaAgent/.synova-wt-p7impl-$(date +%m%d)

# 依赖：无（bash 3.2 ＋ git 2.50 ＋ python3 3.9.6 标准库 ＋ curl；✅ 禁第三方包）
python3 --version && git --version && curl --version | head -1

# 运行（不经服务、无 daemon、无端口；Gitea 占 3000，本件不监听任何端口）
bash scripts/control-tower/check-merge-conditions.sh --selfcheck
bash scripts/control-tower/check-merge-conditions.sh --pr 558
bash tests/control-tower/check-merge-conditions.test.sh

# token：$HOME/gitea/.win-push-token（已存在；无它则 exit 2 —— 这是**正确**降级，禁绕过）
ls -l "$HOME/gitea/.win-push-token"

# 离线模式（无网/CI 沙箱）：用已 fetch 的 refs/p7cmp/pr/<n>；CI 状态缺 ⇒ exit 2
bash scripts/control-tower/check-merge-conditions.sh --pr 558 --offline

# 落盘：证据放 docs/evidence/p7-merge-conditions/（.gitignore:81 `evidence/` ⇒ 不入库、不脏树）
# 原始输出全量，禁 head 截断

# 自检（证明环境对）
python3 -c "import sys;print(sys.version.split()[0])" && git rev-parse --short=9 HEAD
```

---

## §6 有什么基础（**既有基础盘点 · 禁止重复建设**）

> 盘点命令与命中数（`616162548` 实测）；结论列只允许 **复用 / 扩展现有 / 确需新建（说明为何不能复用）**。

| 能力 | 盘点命令 | 命中 | 结论 |
|---|---|---|---|
| 控制塔脚本总量 | `ls -1 scripts/control-tower \| wc -l`；`ls -1 scripts/control-tower/check-* \| wc -l`；`ls -1 scripts/control-tower/probe-* \| wc -l` | **131**／**26**／**28** | 本件**新建 1 件**（编排层无现成件，见下行逐条） |
| 写集**声明 vs 实际**（单 doc 正反双向） | `wc -l scripts/workflow/check-dev-doc-write-set.sh` | **172** 行 | **复用**：② 的"真相源"口径沿用它的"实际 diff ＝ 事实"精神；**不调用**（它判单 doc 漂移，不判 PR 间重叠） |
| 写集**两两比对内核** | `wc -l scripts/control-tower/verify-parallel.sh`；`grep -c "overlap-a" scripts/control-tower/devdoc_writeset.py` | **405** 行；`devdoc_writeset.py` 提 `--extract/--overlap-a/--overlap-b` | **复用（仅内核＋信息级行）**：② 的判定用**实际 diff**（比声明更硬）；声明交集作为**信息级**输出，复用其解析，不重写 markdown 表解析 |
| 写集**PR 间重叠**（在飞） | `grep -n "MODE=\|--ci-pr\|--scan-today" scripts/control-tower/verify-parallel.sh` | 4 模式：pair／declared／today／**ci-pr（PR × 已合 doc）** | 🔴 **确需新建这一格**：现无"**open PR × open PR 的实际变更集**"模式。**不扩 verify-parallel.sh 的两条理由**：① 它在 CI 的 `--ci-pr` 路径上（改共享守卫＝回归风险，且 `scripts/control-tower/AGENTS.md` 记"脚本骨架＝治理线"，P4 主域）；② 本件的 ② 要的是"实际 diff 对实际 diff"，与 dev-doc 写集表语义不同，塞进同一脚本会让两种口径混居 |
| 单 PR **夹带**（声明 vs 进入 main） | `wc -l scripts/control-tower/merge_writeset_gate.py` | **1134** 行 | **不复用／不重复**：那是 intra-PR 自洽，与 ② 的正交（本件只判 inter-PR）；**一行不改** |
| CI 状态查询件 | `grep -rn "commits/.*status" scripts/` | **0** 命中 | 🔴 **确需新建**：现仓**无任何** commit-status 查询件（`check-ci-stale-red.sh` 查的是 run 结论且旧口径 GitHub API） |
| Gitea API 客户端（token/分页） | `grep -rln "SYNO_GITEA_API" scripts/` | **2**（`check-board-metrics.ts`／`check-board-truth.ts`） | **复用口径（照抄，不抽库）**：token 三级、分页禁饱和、`--warn` 存量宽限——抽公共库会动 2 个既有件（超写集），故**复制 20 行口径并注明出处** |
| 复核（③）载体 | `grep -rln "receipt\|attest\|回执" scripts/control-tower/*` | **2**（`pre-dispatch-check.sh`／`check-package-selfsufficiency.py`，均非复核回执） | 🔴 **确需新建**：仓内**无**机器可读复核凭据；Gitea 原生 review **实测恒空**（F2） |
| 复核流程（人工侧） | `.dsh/skills/pr-review/SKILL.md` | 五步（范围/铁律/声称vs事实/门禁自洽/结构化结论） | **复用**：③ 的 `checks[]` **就按这五步建 5 条**（`len(checks)>=5` 的判据来源） |
| 串行／合并队列 | `wc -l scripts/control-tower/merge-pr-queue.py`；`grep -n "fixture-classify" …` | **348** 行（GitHub 口径，D920 起） | **复用范式（不调用）**：`--fixture-classify` **密封测试注入缝**是 ⑨ 自检的现成范式；但它走 GitHub API、且做的是"合并动作"，与本件"只判不动"不同 |
| 三态退出码 | `grep -l "exit 2" scripts/control-tower/*.sh \| wc -l` | **38** 件 | **复用**（约定①） |
| `@降级` ＋ degraded 日志 | `grep -rln "SYNO_GATE_DEGRADED_LOG\|degraded-events.log" scripts/control-tower/*.sh \| wc -l` | **8** 件 | **复用**（约定②）：`.codex/control-tower/logs/degraded-events.log`（字段 time/component/reason） |
| UTF-8 强制 | `grep -l "PYTHONIOENCODING=utf-8" scripts/control-tower/*.sh \| wc -l`（分母 `ls scripts/control-tower/*.sh \| wc -l`） | **33 / 45**（实测） | **复用**（约定③，见 `scripts/control-tower/pre-dispatch-check.sh:2`「UTF-8 强制」） |
| 判别力自检范式 | `grep -rln "selfcheck\|判别力\|改坏" scripts/control-tower/*.sh scripts/control-tower/*.py \| wc -l` | **10** 件 | **复用**（约定④）：`--selfcheck` ＋"改坏确实红"原始输出留档 |
| CT-40 配对硬拦 | `sed -n 18p scripts/control-tower/ct-test-gate.sh`；`sed -n 793,802p scripts/pre-commit-check.sh` | 规则 1 行；接线组 2d | **强制**：W2 不可省 |
| 回执落地目录 | `git ls-tree -r --name-only HEAD -- docs/synova/reviews \| wc -l` | **0**（不存在） | **新建目录**（W3 的 `README.md` 作非空载体，git 不跟踪空目录） |
| 相关 skill | `ls .dsh/skills/ \| grep -E "pr-review\|claim-verifier\|ctrl-tower-change\|dsh-code-standards"` | **4** 件 | **复用**：`pr-review`（③ 五步来源）／`ctrl-tower-change`（门禁脚本变更模式库——**实现小队必读**）／`dsh-code-standards`（12 项）／`claim-verifier`（"声称 vs 物理证据"） |

**§6 结论（一句话）**：**复用 7 项既有内核与约定 ＋ 确需新建 1 个编排件**（`check-merge-conditions.sh`）＋ 1 个凭据载体（`docs/synova/reviews/`）。**不重复建设**：markdown 写集表解析（`devdoc_writeset.py`）、单 doc 漂移（`check-dev-doc-write-set.sh`）、intra-PR 夹带（`merge_writeset_gate.py`）、已合 PR 重叠（`verify-parallel.sh --ci-pr`）、合并动作（`merge-pr-queue.py`）——**五格一律不碰**。

---

## §7 前置与红线

**前置（未满足则停）**：

| 前置 | 判据 | 未满足 |
|---|---|---|
| 分支从 `gitea/local-main` 取（非主树） | `git merge-base --is-ancestor gitea/local-main HEAD; echo $?` ⇒ `0` | 停，重取树 |
| Gitea 可达且有 token | `curl -s -o /dev/null -w %{http_code} -H "Authorization: token $(cat $HOME/gitea/.win-push-token)" $SYNO_GITEA_API/repos/synova-agent/SynovaAgent/pulls?state=open` ⇒ `200` | 停，报 L1（本件**不许**把 API 不可达降级成"没红"） |
| python3 ≥3.9 ∧ bash ≥3.2 ∧ git ≥2.20 | `python3 --version`／`bash --version \| head -1`／`git --version` | 停（`git diff --full-index --binary`、`:(exclude)` pathspec 需 ≥2.20） |
| **CTO 批 W2 写集扩 1 行** | 附录 B-1 已批（回执一句即可） | **停**：不批则不写测试 ⇒ CT-40 硬拦 ⇒ 本件不可合 |
| Issue 立卡 | Gitea Issue #582 存在且 open（`curl $SYNO_GITEA_API/repos/synova-agent/SynovaAgent/issues/582`） | 停，报 L1 |

**🔴 CTO 本轮三条排期令（逐条落到路径）**：

```
 ① 不动 P4 三件 —— scripts/control-tower/founder-truth.py ｜ tests/control-tower/founder-truth.test.sh ｜
    scripts/control-tower/gate-integrity-baseline.txt     ⇒ 本件 0 处提及改动，W1-W5 与三者零交集
 ② 不自行接 CI —— .gitea/workflows/local-gates.yml ｜ .gitea/** 一律不改；本件只产本地判据；
    若将来要接 CI ⇒ **先停下报 CTO**（本件不预先设计 CI 接线）
 ③ 顺手修 P7 自身 ②⑦ —— 口径见**附录 C**，**待 CTO 批**；未批不落盘（改的是判据真源，属 CTO 裁）
```

**全局红线（逐条路径）**：

```
 ❌ scripts/audit/**（K3 专属）｜❌ P4 三件（CTO 令①）｜❌ .gitea/**（CTO 令②）｜❌ src/**、extensions/**、.github/**
 ❌ 既有门禁件一行不改（verify-parallel.sh／check-dev-doc-write-set.sh／devdoc_writeset.py／
    merge_writeset_gate.py／check-board-truth.ts／ct-test-gate.sh／pre-commit-check.sh）
 ❌ agents/P7-交付自证与真值/AGENTS.md（附录 C 未批前不动）
 ❌ 主树写码｜❌ git stash｜❌ 把 API 不可达当"无红"
 ❌ 交付件缺 typed error（bash：`fail "code: msg"` 统一出口）／缺"已知限制"节／缺判别力自检 ⇒ L1 不收
```

**合并条件**（本 PR ＝ dev doc 单独 PR，只有文档）：

```
 ① CI 全绿 pending=0：GitHub/Gitea 两侧 doc-only PR 均应绿（若红 ⇒ 先看是存量红还是本 PR）
 ② 零写集重叠：本 PR 只改 docs/plans/codex/implementation/ 一份文件
 ③ 已过独立复核：**本 PR 自身不适用**（本件正是定义 ③ 的规格）；由创始人/CTO 批口径代替
 ④ 串行：基于当时 tip 的最新 local-main 建 PR；合并前重跑一次 `git ls-remote` 比对
```

---

## §8 交什么（给 L1）

```
 R2 指针 ≤10 行：批次名 ｜ 写集（逐文件）｜ 自验结论 ｜ 证据路径 ｜ 未决项
 证据留存：<repo>/docs/evidence/p7-merge-conditions/（原始输出全量，禁截断；不入库）
 回执三信号：① 判据通过率（绿/红）② 例外清单 ③ 在飞数
 🔴 不判"通过"：只能给 自验结论 / 可提请独立复核 / 退回（附理由与失败点原文）
 🔴 交付件必须含「已知限制（Known Limitations）」节：③ 的身份不可加密证明（见 C1 末）
```

**自证脚本必须进 PR**：W2 就是它（`tests/control-tower/check-merge-conditions.test.sh`），**不进 PR ⇒ 视为"未自证" ⇒ 独立复核不受理**。

---

## C1 契约（有脚本 ⇒ 必填；铁律 47）

```
@input   --pr <N>            （可选；缺省＝按当前分支名反查 open PR，查不到 ⇒ exit 2）
         --base <ref>        （缺省 SYNO_MERGE_BASE | local-main）
         --repo-root <path>  （缺省＝脚本自身位置推导）
         --json              机器可读（stdout 仅 JSON）
         --offline           不访问网络（用本地 refs/p7cmp/pr/<n>；CI 状态缺 ⇒ exit 2）
         --diff-fingerprint  只打印 ③-0 的 fp（供回执填写）
         --print-receipt-template  打印回执骨架 JSON（不写文件）
         --selfcheck         判别力自检（临时仓＋夹具，零网络）
         --help
@output  ① 逐条条件证据（4 行）② 信息级补充行 ③ 机器行 `MERGE-COND: can|no|degraded ①=ok|no ②=… ③=… ④=…`
         ④ 末行 `CAN-自合并` / `NO: <条件名[, 条件名]>` / `degraded: <原因>`
         --json: {tool, pr, base, tip, head, fp, conditions:{ci,overlap,review,serial}, verdict, exit}
@exit    0 = 四条件全绿（CAN-自合并）
         1 = 至少一条红（NO: …，逐条给失败点）
         2 = 检查自身失败/降级（API 不可达、HTTP≠200、refs 取不到、CI 信号量==0、git 不可用、参数非法）
@degraded  一律 stderr 一行 `degraded: <原因>` + exit 2（铁律 11；禁 `except: pass`、禁 `|| true` 吞错）
只读：不写任何仓库文件；--selfcheck 只写系统临时目录（结束清理）
@authority 谁能调：任何会话/任何人（只读判定器）；**它不执行合并**，合并权限仍归四条件自合的人/会话
```

**已知限制（Known Limitations，必写进 W1 头注释与 W3 README）**：

1. **③ 的"独立"只能证到形式层**：本机**单一 Gitea 账号**（`collaborators=["win-push"]`，F2）⇒ 身份不可加密证明；本件能保证的是「**回执与当前补丁指纹绑定 ∧ 回执之后无代码改动 ∧ reviewer≠author 的声明**」——**改码不重做复核必红**（这是主要失效模式），但「作者自己冒用 reviewer 名」**抓不到**（R9 只告警）。想根治 ⇒ 需第二账号或签名基础设施，**不在本件**。
2. **② 只比"文件路径"**，不比内容：两个 PR 改同一文件的**不同行**仍判重叠（有意 fail-closed；减少误放行）。
3. **① 只认 CI 的最终态**：不判"红是不是存量红"（那属 `check-ci-stale-red.sh`）。
4. **④ 的 S2（队首）依赖各 PR 的 ①②③ 可判**：若某 PR 的 ③ 回执缺失（现状 14/14），它不进就绪集 ⇒ 不阻塞他人（这是有意的，避免死锁）。

## C2 边界值（有集合/数量参数 ⇒ 必填）

| 边界 | 期望 |
|---|---|
| open PR 数 = 0 | ② 绿（无对手）、④ S2 绿；①③ 照判 |
| open PR 数 = 1（只有本 PR） | 同上；② 打印"0 对" |
| 14 个 open PR（现状） | 91 对；2 对重叠 ⇒ 若本 PR 在其中 ⇒ ② 红 |
| CI `total_count=0` | **exit 2**（不是绿、不是红） |
| CI `statuses` 里同时有 success 与 pending | 红，点名 pending 的 context |
| 回执文件存在但 fp 只差 1 hex | 红（R3），**禁模糊匹配/前缀匹配** |
| 回执 `checks` 长度 = 4 | 红（R4 要求 ≥5） |
| 回执 commit 之后有 1 个 doc 改动（非 reviews/**） | 红（R7）——**复核后不得再动任何文件**（含文档），避免"复核的是旧文" |
| 本 PR 的 `head` 取不到 | exit 2 |
| `--pr` 指向已合/已关 PR | exit 2（`degraded: PR #N 非 open`） |
| `--json` 与 `--selfcheck` 同时给 | exit 2（互斥，fail-loud） |
| 路径含中文/空格 | 全程 `-z`/引号安全；`LC_ALL=C` 下按字节排序保证 fp 可复算 |

## C3 失效条件（**新增规则/门禁 ⇒ 必填**）

- **何时可撤（规则级）**：当仓库改用**原生合并队列**（Gitea merge queue/第二账号 review 强制）时，③ 的回执机制与 ④ 的 S2 队首逻辑**同时退役**，只保留 ①。
- **撤除动作**：删 W1／W2／W3，并在 `agents/P7-交付自证与真值/AGENTS.md` 记一次口径变更（**改判据真源归 CTO**）。
- **前提变更不得带病续跑**：若 CI 从 `local-gates` 换成多 workflow（status context 名变化）⇒ ① 的"全 context success"判据仍成立，但**必须重跑 `--selfcheck`**；若 Gitea 升级后 `/commits/<sha>/status` 语义变化（例如"无 status 返回 `state:unknown`"）⇒ 必须同步 F4 的 exit 2 判据，否则"看不见"会被判绿。
- **③ 的失效条件（更严）**：一旦出现**第二个人类/Agent 账号**能做原生 review ⇒ 必须先切原生 review（更硬的凭据），**不得两套并存**（双真源）。

---

## 附录 A · 证据（全量在 `docs/evidence/p7-merge-conditions/`；以下为**摘录**）

```
A.1 F1 判据件缺失：git ls-tree … check-merge-conditions.sh ⇒ 0 行；tests/… ⇒ No such file
A.2 F2 Gitea 原生 review：/pulls/580/reviews ⇒ []；/collaborators ⇒ ["win-push"]
A.3 F3 CI 可读：/commits/75abe203a/status ⇒ state=success total_count=2（push + pull_request 各 success）
A.4 F4 「看不见」陷阱：/commits/0c8179665/status ⇒ {"state":"pending","total_count":0,"statuses":null}
A.5 F5 base.sha 不可作分支点：14/14 base.sha=616162548，但 merge-base 实测 44a30a572…38d77034b（落后 57–115）
A.6 F6 重叠实况：91 对 ⇒ 2 对重叠（.gitignore：416∩517；scripts/check-architecture.sh（PR #547 × PR #553））
A.7 F11 指纹稳定：两次 sha256 同值 22c39c01…91afa；加 :(exclude)docs/synova/reviews/** 同值
A.8 F13 P7 自身矩阵：①🔴（缺引用）②🔴（缺命令/反例 token）⑦🔴（缺「事实落点」节）＝ 3 红
```

## 附录 B · 例外清单（**不自行处理，报 CTO**）

1. **W2 写集扩 1 行**：`tests/control-tower/check-merge-conditions.test.sh` 不在 `agents/P7-交付自证与真值/AGENTS.md` §四写集枚举内，但 **CT-40 硬拦要求它存在**（F9）。⇒ 请 CTO 一句话：**批**（写集改为 `scripts/control-tower/{check-merge-conditions.sh,…}｜tests/control-tower/{check-merge-conditions.test.sh}｜docs/**｜memory/notes/**`）／**不批**（则本件退回重出）。
2. **④ 口径（S1∧S2）需 CTO 确认**：本件裁 S1（tip 是 head 祖先）∧ S2（①②③S1 全绿集合中编号最小）。今日 **14/14 S1 红** ⇒ 近期无 `CAN-自合并`。若 CTO 只要 S1 或只要 S2，请一句话，本件改口径后重派（**口径属 CTO，不属 L1**）。
3. **③ 的身份局限**：单一 Gitea 账号 ⇒ 只能做"形式层独立＋防重放＋时序"，**不能证明签名者非作者**（C1 已知限制 1）。请 CTO 确认**接受该局限**（否则需先立"第二账号/签名"前置，本件无法落地）。
4. ~~未立卡~~ **已消**：Issue **#582** 已于 2026-10-18 立卡（P7 自建，任务号 P7-1；若 CTO 认为应由 CTO 立卡，请在回执点名，后续批次改口径）。
5. **`--offline` 的 CI 数据源**：离线时无 API ⇒ ① 只能 exit 2。若期望离线也能判 ①，需引入本地 CI 状态缓存（**新增写集**），本件不做，请 CTO 裁是否需要。

## 附录 C · P7 自身 ②⑦ 修复口径（**待 CTO 批；未批不落盘**）

> 背景：`check-package-selfsufficiency.py --packages P7`（F13）实测 P7 行 `🔴 🔴 ✅ ✅ ✅ ✅ 🔴 ✅ ✅ ✅`；CTO 令③ 要求"顺手补自己的 ②⑦，口径你拟我批"。① 缺引用（`check-merge-conditions.sh` 尚未落地）**本批不修**——它要等实现件合并后才自然转绿。

**C-a ② 判据可执行 —— §三「完成判据」改法（原文 → 新文）**：

```diff
-## 三、完成判据
-
-`check-merge-conditions.sh` 输出 `CAN-自合并 / NO: <哪条>`；三信号可跑；问"进度"不用问人
+## 三、完成判据
+
+- **正常**：`bash scripts/control-tower/check-merge-conditions.sh --pr <N>` ⇒
+  四条件全满足时末行 `CAN-自合并`、**exit 0**；任一不满足 ⇒ 末行 `NO: <条件名>`、**exit 1**；
+  检查自身失败（API 不可达／refs 取不到／**CI 信号量==0**）⇒ `degraded: <原因>`、**exit 2**。
+- **反例（改坏必红）**：`bash scripts/control-tower/check-merge-conditions.sh --selfcheck` ⇒
+  子例 B 改 ① 必 `inner_exit=1`；C 改 ② 必红并点名文件；D 改坏 ③ 必红（删回执／指纹改 1 位）；
+  E 改坏 ④ 必红；**F 信号量==0 必 `inner_exit=2`**。任一不符 ⇒ `SELFCHECK-FAIL`。
+- **三信号**：`probe-line-signals.ts` 可跑（下一批）；问"进度"不用问人。
```

**C-b ⑦ 事实落点 —— 新增一节（放在 §七 之后、§八 之前）**：

```diff
+## 七之三、🔴 事实落点（条目 → 可复跑落点 → 现状）
+
+| # | 事实 | 落点（可复跑） | 现状 |
+|---|---|---|---|
+| 1 | 判据件 `check-merge-conditions.sh` | `git ls-tree -r --name-only HEAD -- scripts/control-tower/check-merge-conditions.sh \| wc -l` | 0（P7-1 交付前） |
+| 2 | ④ 串行存量红 | `git ls-remote gitea refs/heads/local-main` × `git merge-base --is-ancestor <tip> <head>` | open PR 14/14 红（落后 57–115） |
+| 3 | Gitea 原生 review 恒空 | `curl -H "Authorization: token …" $SYNO_GITEA_API/repos/synova-agent/SynovaAgent/pulls/<N>/reviews` | `[]` |
+| 4 | ③ 凭据载体目录 | `git ls-tree -r --name-only HEAD -- docs/synova/reviews \| wc -l` | 0（P7-1 交付前） |
```

**批准方式**：CTO 回一句「**C 批**」即可；批准后由**实现小队**在同一 PR 内落这一处（属 P7 判据真源，**L2 只按本附录字面落，不得改写**）。

## 附录 D · 派单内部一致性自检（教训：同一单两条要求对同一路径互斥）

| 检查 | 结论 |
|---|---|
| 写集 vs 非目标 | W1–W5 与 §1.2 的禁碰路径**零交集**（`.gitea/**`、P4 三件、`audit`、`src/**`、既有门禁件、`scripts/control-tower/probe-line-signals.ts`、P7 守则） |
| 判据 vs 红线 | 「改坏必红」全部在**临时仓夹具**里制造（子例 B–F），不写仓库 ⇒ 与 DS-10「只读」不冲突 |
| 「全绿 ⇒ exit 0」 vs 今日实况 | 真仓今日**不可能绿**（③ 无回执、④ 存量红）⇒ 判据绑定**夹具子例 A**（全绿输入），真仓只要求"红得有据"；两者对象不同、不互斥 |
| ③ 指纹 vs 回执文件 | 指纹排除 `docs/synova/reviews/**` ⇒ 回执自身的加入不改变指纹，**无循环依赖**（F11 实测） |
| ④ S1 vs S2 | S2 的就绪集**要求 S1 绿** ⇒ 陈旧 PR 不阻塞他人，**不死锁** |
| CT-40 配对 vs 写集 | W2 不可省（F9 硬拦）⇒ 已在封面/§2.1 列明，并单列附录 B-1 请批 |
| CTO 令① vs 本件 | P4 三件在 §1.2、§7 两处**逐条点名禁碰**；W1–W5 与它们零交集 |
| CTO 令② vs 本件 | 本件**不产**任何 `.gitea/**` 改动、不设计 CI 接线（§7 明写"要接 CI 先停下报 CTO"） |

## 引用豁免

> 依据：`scripts/control-tower/check-citations.py:36-37`（`## 引用豁免` 段，每行 `- <引用原文> — <理由>`，无理由不生效）。

- scripts/control-tower/check-merge-conditions.sh — 本交付新建件（W1），交付前不存在
- tests/control-tower/check-merge-conditions.test.sh — 本交付新建件（W2），交付前不存在
- docs/synova/reviews/README.md — 本交付新建件（W3），交付前不存在（目录亦新建）
- docs/synova/reviews/ — 本交付新建目录（③ 回执落地）
- memory/notes/implemented/2026-10-18-p7-merge-conditions.md — 本交付新建件（W4），交付前不存在
- .claude/task-briefs/2026-10-18-p7-merge-conditions.md — 本交付新建件（W5），交付前不存在
- scripts/control-tower/probe-line-signals.ts — 下一批交付件（本件不建，仅作边界声明）
