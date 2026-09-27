---
状态: proposed
日期: 2026-09-27
决策: 「纯归档/出库」的路径级豁免必须"以收紧为对价"——`D`/`R`（删除/重命名）路径**默认计入** PR 预算，仅 **ⓐ**（变更集中无 `A`/`M`/`C`）∧ **ⓑ**（全部路径落出库白名单且无一条命中禁区）同时成立才豁免；`## 出库声明` 定位为**批次流程强制项 + 人读段落**（机器承接走 D708 合并级对账），**不作** `check-pr-budget.sh` 的硬条件；doc-registry 同步按**真源** `docs/authority/DOCS-REGISTRY.yaml` 做，**需同步 7 条**
理由: ① 门禁跑在 git pre-commit hook，**读不到 PR 正文**（实测 0 处 PR 正文来源）——把"有声明"设成硬条件 = 本地永久报红或永久放行 = 假接线（违铁律 0-2 / M3）；② 既有门禁的 `--diff-filter=ACMR` **从不计入 `D`（删除）**，即在"纯删除 PR"上完全失明，任何豁免若不换成"收紧"就是"把闸门关死"；③ 契约 §9 表的登记源写成 `scripts/control-tower/doc-registry.json`，而门禁实读的是 `docs/authority/DOCS-REGISTRY.yaml`——属**契约缺陷**，本卡只登记不代改。
---

# 决策 Note — D1028「纯归档/出库」路径级豁免

> 任务: D1028 ｜ 小队 A2（队长 `synova-squad-lead`）｜ 分支 `chore/d1028-outbound-path-exemption`
> 规格源：`.claude/task-briefs/2026-09-27-D1028-A2-纯归档出库路径级豁免.md`（下称 brief）
> 状态：proposed（待 K3 复审 + CTO 收件闸后 `git mv` 到 `implemented/`）
> 本 Note 由成员B `docs-mech` 撰写（决策归 CTO 2026-09-27 本轮会话裁定，见 brief §Q0.b「CTO 裁定」）

---

## 1. 触发场景

`docs/synova/DOC-CONTRACT.md` §7 定义了存量「出库」（`docs/synova/DOC-CONTRACT.md:256-268`），§9 要求「移出必与接手同批」（`:307`）。但出库动作 = 大量 `git mv` / `git rm`，会被 D734 的 PR 预算门禁（`scripts/control-tower/check-pr-budget.sh`，**本卡开工时基线 179 行**）按文件数拦下。本卡给该门禁加一条**路径级豁免分支**，使批次化出库可执行。

## 2. 实测依据（可核，`file:line`）

| # | 事实 | 证据 |
|---|---|---|
| F1 | 变更集取法 = `--diff-filter=ACMR`，**`D` 从不进入计数** | `scripts/control-tower/check-pr-budget.sh:92` |
| F2 | 门禁跑在 pre-commit，只收到 `--quiet` | `scripts/pre-commit-check.sh:1515-1516` |
| F3 | 该脚本**零** PR 正文来源（`PR_BODY` / `GITHUB_EVENT` / `pull_request` / `pr-body` 各 0 处） | `git grep` 实测 → exit 1，**0 处** |
| F4 | 唯一声明源解析器只认 `## 写集豁免` | `scripts/control-tower/merge_writeset_gate.py:291`（`^#{2,4}\s*写集豁免`）+ `:302-304`（逐行 `- <路径> — <理由>`，**无理由不生效**） |
| F5 | 读得到 PR 正文的是 D708 的 CI 侧 gate；但 `ci.yml:119-120` **未传** `--pr-body` → 落 warn「仅文件声明源生效」 | `.github/workflows/ci.yml:116-120` + `merge_writeset_gate.py:325-326, 428-432` |
| F6 | 「出库声明」全仓库**零机器消费者**（既无标题正则，也无任何引用） | `git grep -n '出库声明'` → exit 1，**0 处**；被解析的豁免标题仅 2 个：`写集豁免`（`merge_writeset_gate.py:291`）、`引用豁免`（`check-citations.py:69`） |
| F7 | 登记门禁**实读** `docs/authority/DOCS-REGISTRY.yaml`（**39 条**，`status ∈ [active, superseded, draft, archived]`） | `scripts/doc-system/doc-registry-gate.sh:18`；`docs/authority/DOCS-REGISTRY.yaml:7`、`grep -cE '^  - id: '` = `39` |
| F8 | 该门禁**只拦「新增未登记」**（输入 = untracked + `--diff-filter=A`），**不校验**已登记路径是否仍存在 | `scripts/doc-system/doc-registry-gate.sh:32,35,43`；接线 `scripts/pre-commit-check.sh:1485-1499`（`soft_check`） |
| F9 | `scripts/control-tower/doc-registry.json`（18 docs + 16 aliases）**零门禁消费者** | 门禁域扫描（`scripts/doc-system/**` + `merge_writeset_gate.py` + `.github/workflows/ci.yml`）命中 `doc-registry` **仅 2 处**，无一处是该 JSON；唯一生产读者 = `scripts/control-tower/inject-context.py:34` |
| F10 | 需 doc-registry 同步条目 = **7 条** | `DOC-0102 / 0105 / 0107 / 0108 / 0109 / DOC-0031 / DOC-0114`（复算命令与原始输出见 `docs/synova/coordination/出库声明与批次模板-D1028-20260927.md` §2.4） |
| F11 | 契约 §9 表把登记源写成 `scripts/control-tower/doc-registry.json` | `docs/synova/DOC-CONTRACT.md:303`（与 F7 **矛盾** ⇒ 契约缺陷） |
| F12 | 该门禁**只查 untracked + staged-新增** ⇒ 本地 `pre-commit` 工作点有效（staged 时能拦，`docs/authority/GOVERNANCE.md:12` 记载 2026-08-20 首次实战拦截），但**CI 复跑时新文件已 tracked ⇒ 零输入 ⇒ D2 在 `SYNO_CI=1` 下无输入可判**（"CI 转硬"承诺落空）；且 `core.quotepath=true`（git 默认）时**非 ASCII 新文档被静默丢弃**（行尾锚定 `grep -E '\.(md\|yaml)$'` 不匹配带引号路径）⇒ **fail-open** | `scripts/doc-system/doc-registry-gate.sh:43`；`/tmp` 隔离探针 A/B/C/D（ASCII 红 / 中文名默认绿 / 中文名 quotepath=false 红 / commit 后 0 文档），原始输出见 `docs/synova/coordination/出库声明与批次模板-D1028-20260927.md` §2.7 与附录 A.8 |

**F1 的承重含义**：`D` 路径被 `--diff-filter=ACMR` 过滤掉 ⇒ **纯删除 PR 今天本来就通过（`N_FILES=0`）**。真正被拦的是 `R`（`git mv` 记为 1 件）。故「豁免」若不改口径，只是给一个**本来不拦的情况**再开口子——**必须换成收紧**：`D`/`R` 默认计入，只对同时满足 ⓐ∧ⓑ 的批次豁免。

## 3. 决策内容（冻结，brief §Q2.S1–S4）

1. **变更集口径**：`git -c core.quotepath=false diff --name-status --find-renames "$BASE...HEAD"` 取全量（含 `D`）；派生 `ALL_PATHS`（`R` 记双侧 old+new）/ `AM_SET`（状态 ∈ {A,M,C}）/ `COUNT_PATHS`（`D` 记 1、`R` 记 1 用新路径、`A/M/C` 各记 1）。既有 `--files` 注入缝语义不变；**新增** `--diff-status` 注入缝供反例夹具。
2. **收紧（CTO 授权，方案A）**：`D`/`R` **默认计入** `N_FILES`；既有 D860 治理产物豁免（`check-pr-budget.sh:104-105`）原样保留；`MAX_FILES=12` 与「禁调高上限」不变。
   - 纯删 `src/**` 13 件 → 不豁免 → `13 > 12` → **exit 1**
   - 删白名单内 13 件 + 改 1 件 → ⓐ 不满足 → `14 > 12` → **exit 1**
3. **豁免分支（ⓐ ∧ ⓑ，两条同时满足）**：
   - ⓐ 只删/只移不增改：`AM_SET` 为空
   - ⓑ 路径白名单：`ALL_PATHS` 全部落 ✅ 且无一条命中 ❌
   - ✅ `^(\.claude/task-briefs/|docs/plans/|docs/synova/coordination/|memory/notes/|docs/synova/archive/|docs/archive/)`
   - ❌ `^(src/|scripts/|\.github/|tests/|extensions/|expert/)` + 两条 `DENY_EXACT`：`docs/synova/coordination/ownership.yaml`、`docs/synova/coordination/AUDIT-PROTOCOL.md`
   - 不成立时**必须显式打印**不豁免原因（ⓐ/ⓑ 哪条不满足 + 命中的 ❌ 路径逐条）
4. **`## 出库声明`（判据④）**：无该段时**豁免仍生效**，仅打 ⚠️ 提示要求在 PR 描述补声明。理由见第 2 节 F2/F3/F5/F6。格式复刻 D708 `写集豁免` 的逐行 `- <路径> — <理由>`，**无理由不生效**（`merge_writeset_gate.py:302-304`）。
5. **doc-registry 同步**：按**真源** `docs/authority/DOCS-REGISTRY.yaml` 的 7 条做；已登记者改 `status: archived` + 改 `path`，**不删条目**（保追溯，`DOC-CONTRACT.md:268`）；同步与出库**同批**（`:303`）。

## 4. 考虑过的其他方案（为什么不是它们）

| 方案 | 否决理由 |
|---|---|
| **把「有 `## 出库声明`」设为 `check-pr-budget.sh` 的硬条件** | 违 F2/F3：该门禁读不到 PR 正文 ⇒ 本地永久报红或永久放行，**假接线**（违铁律 0-2 / M3）。硬条件只能落在能读到 PR 正文处（D708 / `ci.yml` = A4 的活，本卡红线外） |
| **保持 `--diff-filter=ACMR` 不变，只加"白名单内删除不计入"** | 违 F1：`D` 本来就不计入 ⇒ 该"豁免"对纯删除 PR **零作用**，只对 `R` 有效 ⇒ 等于**只放宽不收紧**，把闸门关死 |
| **给 `## 出库声明` 新增第三个标题解析器（改 `merge_writeset_gate.py`）** | 不在本卡写集；且会撞 D708 既有 **11 处**声明段的解析面（`git grep -n '^## 写集豁免' -- docs .claude \| wc -l` → `11`）。→ 遗留项，另立卡 |
| **把 `scripts/control-tower/doc-registry.json` 接进门禁（"修"契约 §9 的描述）** | 会产生**双真源**（+ `DOCS-REGISTRY.yaml`）= 新增缺陷，不是修复。正确处置 = 勘误契约 §9 表 + 决定 JSON 去留 |
| **直接删出库文档（不走豁免）** | 违 `DOC-CONTRACT.md:268`「出库 ≠ 删除历史」；且失去批次前后计数的可核对账 |

## 5. 后果

- **正面**：批次化出库在 `R` 口径下可执行（≤12 件的批次）；`D`/`R` 由"看不见"变为"默认计入"，门禁覆盖面**变大**；纯删 `src/**` 反例从"今天 exit 0 通过"变为 **exit 1**。
- **代价**：任何"删/移 13 件以上"的批次必须拆批（预算 ≤12）——这是**有意的**对价。
- **未解决（遗留，交后续卡）**：① 契约 §9 表勘误（F11）；② `## 出库声明` 零机器消费者（F6）——今日只能靠批次流程 + 人读 + D708 `写集豁免` 承接；③ `ci.yml` 未传 `--pr-body`（F5）；④ `DOC-0107` 登记 `path` 为宽域 `memory/`，与白名单 `memory/notes/` 粒度不同（F10 复算差异根因）；⑤ D2 登记门禁对非 ASCII 新文档 **fail-open**（F12，与 CT-69 同源：`docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md:107`）；⑥ D2 门禁只查 untracked/staged-新增 ⇒ CI 恒 no-op（F12）。
- **本卡自证未阻断**：`bash scripts/control-tower/check-notes-lifecycle.sh` → `✅ proposed/ 无僵尸条目`（exit 0）；`bash scripts/doc-system/doc-registry-gate.sh` 在新文件 untracked 阶段点名本文件（软提示），commit 后输入归零 ⇒ exit 0。

## 6. 文件名修订（2026-09-27，本卡返工项）

- **旧名（逐字，事实记录）**：`memory/notes/proposed/2026-09-27-D1028-出库豁免.md`
- **新名**：`memory/notes/proposed/2026-09-27-D1028-outbound-exemption.md`
- **动作**：普通 `mv`（该文件当时未被 git 跟踪；亦未 commit，故 git 历史无旧名记录，此处逐字留存）
- **触发（实测根因）**：`scripts/commit-msg-check.sh:153` 的 Note 路径提取正则是 **ASCII-only** —— `grep -oE '(memory/notes|decisions)/[A-Za-z0-9_./-]+\.md'` ⇒ CJK 文件名匹配 **0 条** ⇒ 判「无有效 Note 文件路径」⇒ `git commit` 被拒（铁律 49 的 D395-a 物理门禁）。
- **旁证（impl-gate 实测）**：`git ls-files memory/notes/ | LC_ALL=C grep -c '[^ -~]'` → **0**（152 个 tracked Note **全部 ASCII 命名**）⇒ 旧命名**偏离仓内既有口径**，非门禁只针对本卡。
- **未做（界外，另立卡 + K3）**：不改 `scripts/commit-msg-check.sh` 的正则（`scripts/**` 不在本卡写集）；不改「消息里不引用 Note」（会触发 D395-a 第一层，同样红，且违铁律 49）。
- **同族**：**CT-69**（`check-pr-budget.sh --files` 对非 ASCII 路径误判跨域，`docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md:107`）—— 均为「门禁字符类/路径解析不含 CJK」的盲区（CT-48 core.quotepath 盲区同族）。

## 7. 取代

无。本 Note 为新增决策，不取代既有 Note。（`docs/synova/DOC-CONTRACT.md` §9 的契约缺陷勘误落地后，相关条目应在本节登记取代关系。）

## 8. 参考系（D333 四步，brief §Q1）

- **第一性原理**：门禁的价值 = 能被独立复算且**不能靠"看不见"绕过**。F1 暴露的正是"看不见"（`D` 路径被过滤）⇒ 豁免必须以**收紧**为对价。
- **Anthropic 工程基线**：门禁改动必须配**判别性夹具**（改坏即红）；豁免类改动必须证明「反例仍被拦」→ brief §DS1 四条反例 + §DS3 旁路封堵。
- **开源实证 / 本仓既有范式**：path-based exemption 一律要求**显式清单 + 双侧匹配（rename old+new）**；本仓 D708（`merge_writeset_gate.py:291-304`）已确立「声明段落 + 无理由不生效」范式 ⇒ `出库声明` 复用其形式，不发明新机制。
- **收敛检查**：复用三态退出码（ctrl-tower 模式）、`soft_check` 接线、D860 治理产物豁免口径、`check-ownership.py` 域校验器（不动）；不新增独立脚本。
