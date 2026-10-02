# WB2 · Issue/PR 状态自动流转（D1124）交付件

> **性质**：治理线 B 段 W-B2 卡。交付 1 个**非门禁** workflow + 1 个单文件执行器 + 本产出件。
> **基线 pin**：`origin/main = 4225fe884bdccbed4ae2df7dc23160fa9273fdf4`（分支 `feat/d1131-issue-lifecycle`）
> **取证 as_of**：2026-10-02T09:4x–10:3xZ（含队长裁决 W-B2-①–⑤ 后的收窄改动）
> **性质声明（🔴 全程）**：本 workflow **不进 main 的 12 条必需状态检查**、不改 branch protection、
> 不改任何既有 job 的 `name:`、不改 `ci.yml`。它红了**不阻断**任何 PR 合并。
> **🔴 触发面现状（队长裁决 W-B2-③）**：`on:` **当前只启用 `workflow_dispatch`（手动）**；
> PR/Review 事件为注释态（`RESTORE-BEGIN/END`），待 secret `ISSUE_LIFECYCLE_TOKEN` 就位 + U1 端到端
> 通过后**一行恢复**（恢复路径已机器验证，见 §5 保证 1）。**本卡完成条件 = token 就位 + U1 真改一次**，
> 不是"代码写完"。

---

## §1 交付物

| # | 文件 | 类型 |
|---|---|---|
| 1 | `.github/workflows/issue-lifecycle.yml` | 新 workflow（主件） |
| 2 | `.github/issue-management/lifecycle.mjs` | 新单文件执行器（纯函数可测 + 离线注入缝） |
| 3 | `docs/synova/coordination/2026-10-02-WB2-issue-lifecycle.md` | 本产出件 |

**并发纪律遵守**：`.github/issue-management/` 目录与 W-B1（task-10）共享，但**文件零重叠** ——
本卡只新增 `lifecycle.mjs`；**未触碰** `policy.mjs` / `rules.mjs` / `config.json` / `.github/workflows/issue-policy.yml`
（W-B1 写集）。开工时 `.github/issue-management/` **尚不存在**（实测 `ls` 报 No such file），本卡为纯新增。

---

## §2 Project 事实（`gh api graphql` 只读取值，**非猜测**）

取数命令（可整段重放）：

```bash
gh api graphql -f query='
query { node(id: "PVT_kwDOFAmDns4Blb57") { ... on ProjectV2 {
  id title number
  fields(first: 50) { nodes {
    __typename
    ... on ProjectV2FieldCommon { id name dataType }
    ... on ProjectV2SingleSelectField { id name options { id name } }
  } } } } }'
```

实测原始输出（节选，status/priority/startDate 相关全量）：

```
project id  : PVT_kwDOFAmDns4Blb57
title       : Synova 作业面
number      : 1
FIELD Status           id=PVTSSF_lADOFAmDns4Blb57zhkIzLE opts=7
   opt Inbox          7136be82
   opt Backlog        8754811d
   opt Ready          af6c98f6
   opt In progress    a3530961
   opt In review      1b0f439f
   opt Done           e8289d05
   opt No action      e1b14374
FIELD Priority         id=PVTSSF_lADOFAmDns4Blb57zhkIzfM opts=4
   opt p0 3360e627 / p1 0daa8607 / p2 696f029c / p3 9bacf304
FIELD Start Date       id=PVTF_lADOFAmDns4Blb57zhkIzfQ dataType=DATE
```

✅ 队长给的 `number = 1` 与 node id `PVT_kwDOFAmDns4Blb57` **实测复现一致**；
状态档 7 档名称与派单所列**逐字一致**（Inbox / Backlog / Ready / In progress / In review / Done / No action）。
**未采信任何 DSH 编号** —— 上表每个 id 都来自上面这条命令的原始输出。

---

## §3 事件 → 状态 决策表（`decide()` 是唯一真相源）

> ⚠️ **触发面现状（队长裁决 W-B2-③）**：下表**全部事件语义均已实现并实测**，但 workflow 的
> **`on:` 当前只启用 `workflow_dispatch`** —— PR/Review 事件处于注释态（`RESTORE-BEGIN/END`），
> 待 `ISSUE_LIFECYCLE_TOKEN` 就位后一行恢复。详见 §5 保证 1 与 1′。
> 表内 T1–T12 用 `--event` 直接喂脚本，**不依赖 `on:`** ⇒ 收窄不影响其有效性。

| 事件 / action | 目标状态 | 附带 | 实测退出码 | mutation 数 |
|---|---|---|---|---|
| `pull_request` / `opened` | `In progress` | **Start Date 初始化**（仅当该字段当前为空） | 0 | 2（T1） |
| `pull_request` / `reopened` | `In progress` | 不覆盖已有 Start Date | 0 | 依现状 |
| `pull_request` / `review_requested` | `In review` | — | 0 | 1（T4） |
| `pull_request_review` / `submitted` + `changes_requested` | `In progress` | — | 0 | 1（T5） |
| `pull_request_review` / `submitted` + 其他 state | **NOOP** | — | 0 | 0（T6） |
| `pull_request` / `edited`（标题 only） | **NOOP** | 显式理由 | 0 | **0（T2）** |
| `pull_request` / `edited`（标题+正文） | **NOOP** | 未订阅该事件 | 0 | **0（T3）** |
| `pull_request` / 其他 action | **NOOP** | — | 0 | 0 |
| `workflow_dispatch` + 合法 `status` | 指定档 | **人工纠偏通道** | 0 | 1（T10） |
| `workflow_dispatch` + 非法 `status` | **NOOP** | 不误改 | 0 | 0（T11） |

**设计取舍（写明，防被当遗漏）**：
- **不订阅 `edited`**（触发面保证）＋ `decide()` 对 `edited` 一律 NOOP（代码面保证）—— 双保险，见 §5。
- **PR 未引用任何 issue ⇒ NOOP**（不猜、不滥用）。引用解析含：关键词式（Closes/Fixes/Resolves/Refs/References/Related to/Part of）
  ＋ 裸 `#N`；**排除**代码块/行内代码里的 `#N`、以及 `owner/repo#N`。
- **issue 不在 Project #1 ⇒ 跳过并打印原因，不擅自 `addProjectV2ItemById`** —— 往 Project 加条目是副作用，
  自动化不该静默扩面。如需纳管，在 Project 面板加入即可（本条请 CTO 裁决是否要改）。
- **`workflow_dispatch` 保留人工纠偏** —— 状态机必须有可用的手动修复路径（吸取 D1123/A2 教训：
  没有可释放出口的机制 = 卡死）。合法档校验防手滑写错档名。
- **不做** PR merged⇒Done / closed⇒No action（派单未列，不扩范围）。

---

## §4 验收 ①：`git diff --name-only origin/main...HEAD` ⊆ 写集

```
$ git status --porcelain
?? .claude/task-briefs/2026-10-02-D1124-治理线B段Issue状态流转.md
?? .github/issue-management/
?? .github/workflows/issue-lifecycle.yml
?? task-state/D1124.json
```

| 文件 | 在派单写集内？ | 说明 |
|---|---|---|
| `.github/workflows/issue-lifecycle.yml` | ✅ 是 | 主件 |
| `.github/issue-management/lifecycle.mjs` | ✅ 是 | 写集明列 |
| `docs/synova/coordination/2026-10-02-WB2-issue-lifecycle.md` | ✅ 是 | 写集 `2026-10-02-WB2-*` |
| `.claude/task-briefs/2026-10-02-D1124-治理线B段Issue状态流转.md` | ⚠ **写集未列** | **分配器强制产物** —— 队长派单明令「先跑 `alloc-task-id.sh`」；该脚本按 squad-discipline §15 自动建 brief（brief 骨架由脚本生成、我仅填字段） |
| `task-state/D1124.json` | ⚠ **写集未列** | 同上，`alloc-task-id.sh` 自动登记 |

> 🔎 **队长裁决 W-B2-①（2026-10-02）：批准**。理由：二者是 `alloc-task-id.sh` 的**必然产物**，而"取号必走分配器"是
> `squad-discipline §15` 硬约束 —— 要号就得有这两件。**且队长认定这是派单写集漏项**（未预置
> `task-state/D1124.json` 与 `.claude/task-briefs/2026-10-02-D1124-` 两个前缀）⇒ **不构成夹带**。
> **零其他夹带**（无 `.github/issue-management/policy.mjs`、`rules.mjs`、`config.json`、`issue-policy.yml`、`ci.yml` 改动）。
>
> 🔎 **队长裁决 W-B2-②（2026-10-02）：保留分支名现名，规范定为 `<type>/<分配器D#>-<slug>`**（号**只能**来自分配器）。
> `feat/d1131-...` 里的 `d1131` 系队长**手写笔误**；我"按命令保留分支名、按分配器用 D1124"的处理被认定**正确**，不需再动。

---

## §5 验收 ③（🔴 CTO 明写判据）：**只改标题不触发** —— 两道保证 + 实测

### 保证 1（主）· 触发面：**当前只启用 `workflow_dispatch`**，PR 事件整体不订阅

> ⚠️ 依队长裁决 **W-B2-③**，触发面已**收窄**（原 PR 事件改为注释态，token 就位后一行恢复）。
> 收窄期内"标题编辑不触发"这一保证**更强**：连 `opened` 都不订阅，`edited` 更无从触发。

```
$ node -e "<现状断言 + RESTORE 段恢复测试>"
A) 现状 on 顶层事件 = [ 'workflow_dispatch' ]
   ✅ 现状 = 仅 workflow_dispatch（PR 事件整体不订阅 ⇒ 零红噪音）
B) RESTORE 段 = 第 51 → 56 行（段内 4 行）
   取消注释后逐行:
     |  pull_request:
     |    types: [opened, reopened, review_requested]
     |  pull_request_review:
     |    types: [submitted]
   解析结果 on = {"pull_request":{"types":["opened","reopened","review_requested"]},"pull_request_review":{"types":["submitted"]}}
   恢复后 on.pull_request.types = [ 'opened', 'reopened', 'review_requested' ]  / pull_request_review.types = [ 'submitted' ]
   ✅ 恢复后 = pull_request[opened,reopened,review_requested] + pull_request_review[submitted]，**不含 edited**
✅ 全部断言通过：活跃态已收窄 + 恢复路径本身可机器验证
>>> exit=0
```

> 🔎 **恢复路径本身现在就可机器验证（不等 token）**：测试把 RESTORE 段取消注释后交给 YAML 解析器，
> 断言"展开后恰为 3 个 PR 事件且**不含 `edited`**"。⇒ 未来那次"一行恢复"不会引入回归，
> 也**堵住了"恢复时手滑把 edited 加回来"**这条路径。判据是**解析产物**（`restored.on`），不是文本 grep。

### 保证 1′ · 收窄决策与恢复条件（队长裁决 W-B2-③）

| 项 | 内容 |
|---|---|
| **现状** | `on:` 下只有 `workflow_dispatch`；PR 事件在 `RESTORE-BEGIN/END` 段内为注释态 |
| **为什么收窄** | secret `ISSUE_LIFECYCLE_TOKEN` 未配置（§8-P1）。此时开 PR 事件 ⇒ 在飞的 **124 个 PR** 各产生一处"因配置缺失而红"的 check-run ⇒ 噪音会训练人绕开机制（V3.9「软机制 0% 有效」同族），且这是**配置未就位、非代码缺陷** |
| **恢复条件（两条都要满足）** | ① secret 就位（fine-grained PAT，org `synova-agent`，组织权限 `Projects: Read and write`）；② 补 **U1 端到端**：用 `workflow_dispatch` **真改一次** Project 状态成功 |
| **恢复操作** | 把 `RESTORE-BEGIN/END` 之间 **4 行**的 `# ` 去掉即可（不加行、不改行） |
| **恢复正确性** | 已机器验证（上方 B 段）；断言"3 个 PR 事件 + 不含 edited"由解析产物强制 |
| **本卡完成条件（队长口径）** | **不是"代码写完"**，而是"token 就位 + U1 端到端真改一次"；在此之前只走手动通道 |
| **我是否同意收窄** | **同意，无异议**。124 处配置性红噪音会让人绕道；且与"非门禁"定位一致 —— 非门禁的东西不该在 PR 上制造视觉阻断感。**不需要队长改回。** |

> ⚠️ **措辞修正（自捉错 #9）**：本件初版此处写"`on:` 不订阅 `edited`" —— 收窄后该字面**仍成立但不完整**。
> 准确表述是「**PR 事件整体未订阅**；**恢复后亦不含 `edited`（已机器验证）**」。已按实测改写。

### 保证 2 · 代码面：即便被误订阅，title-only 也判 NOOP

请求审查（夹具 `edited-title.json`：`action=edited`，`changes = {"title":{"from":"old"}}`，body 里**确实**有 `Closes #101`）：

```
$ SYNO_LIFECYCLE_MUTATION_LOG=$FIX/m2.log \
  node .github/issue-management/lifecycle.mjs --event pull_request --payload $FIX/edited-title.json
事件: pull_request / action=edited
决策: NOOP — 只改标题（changes 仅 title）→ 不改状态（且本 workflow 不订阅 edited）
引用 issue: (无)
计划: (空) — 零 mutation
LIFECYCLE: NOOP
>>> exit=0  mutations=0
```

**对照②（同 payload 只是多了 body 变更）—— 仍 NOOP、仍 0 mutation**：

```
───── T3 改标题+正文（同样不订阅）─────
决策: NOOP — edited 事件不在订阅集合 → 不改状态
LIFECYCLE: NOOP
>>> exit=0  mutations=0
```

**正面对照（证明"0 mutation"不是夹具失效导致的假绿）** —— 同一夹具体系下 `opened` 产出 **2 处** mutation：

```
───── T1 opened（正例：In progress + Start Date 初始化）─────
事件: pull_request / action=opened
决策: FLOW — PR opened → In progress（并初始化 Start Date）
引用 issue: #101, #102
#101: Status: Ready → In progress
#101: Start Date: (空) → 今日（PR opened 初始化）
#102: 已是 In progress / Start Date=2026-09-01 — 无需变更
结果: 应用 2 处 / 跳过 0 处
LIFECYCLE: APPLIED(2)
>>> exit=0  mutations=2
      MUT issue=101 field=status value=a3530961
      MUT issue=101 field=startDate value=2026-10-02
```

> 🔎 **"零 mutation"是机械证明，不是文字声明**：`SYNO_LIFECYCLE_MUTATION_LOG` 是**离线注入缝** ——
> 给定时 `lifecycle.mjs` 跳 token、跳网络，把"本来会发出去的 mutation"逐行追加该文件。
> T2 的文件**根本不存在**（0 行），T1 的文件 2 行。**同一夹具、同一注入缝，红绿成对**。

### 全文触发器对照（夹具 T7–T12）

```
───── T7 fork PR → DEGRADED(2) 不阻断 ─────
DEGRADED: fork PR — GitHub 不向 pull_request(fork) 传递 secrets，无法写 Project；跳过（非错误）
>>> exit=2 (期望 2)

───── T8 PR 无 issue 引用 → NOOP ─────
计划: (空) — PR 未引用任何 issue（零 mutation）
>>> exit=0 (期望 0)

───── T9 缺 token（非 offline 真跑路径）→ ERROR(1) 不静默 ─────
ERROR: 写 Project 需要 token；环境变量 ISSUE_LIFECYCLE_TOKEN 未设置。
提示: GITHUB_TOKEN 为 repo-scoped，**无法**写 Projects (V2)；需配 fine-grained PAT（组织权限 Projects: Read and write）。
>>> exit=1 (期望 1)

───── T10 workflow_dispatch 手动纠偏（offline 注入 body）→ 可纠偏 ─────
手动纠偏引用 issue（取自 PR body）: #101
#101: Status: Ready → In review
>>> exit=0   MUT issue=101 field=status value=1b0f439f

───── T11 workflow_dispatch 非法状态档 → NOOP（不误改）─────
决策: NOOP — workflow_dispatch status="Bogus" 不是合法状态档 → 不改状态
>>> exit=0

───── T12 --dry-run 零网络零凭据 ─────
计划(dry-run): issue #101 → Status=In progress + Start Date 初始化 (需联网核对当前值)
>>> exit=0
```

**引用解析边界（T1 原始输出已证）**：夹具 body 的原文（用四反引号包裹，内部三反引号是夹具内容）：

````text
本卡 Closes #101，并 refs #102。
示例代码行不应计入：
```
fixes #999
```
行内 `#998` 也不算。
跨仓 owner/other#997 不算。
````

→ 解析结果 **`#101, #102`**：代码块内 `#999`、行内 `#998`、跨仓 `#997` **全部正确排除**。

---

## §6 验收 ④：`permissions:` 逐项说明（为何必需 + 能否再收窄）

```yaml
permissions:
  contents: read
```

| 权限项 | 值 | 为何必需 | 能否再收窄 |
|---|---|---|---|
| `contents` | `read` | **唯一必需**：`actions/checkout@v4` 要读仓库才能取到 `.github/issue-management/lifecycle.mjs`（脚本本身随仓分发）。 | **不能收窄为 `none`** —— checkout 会失败（脚本取不到）。**不能也不需 `write`** —— 本 workflow **不写仓库**（只写 Project）。 |
| （未声明，故为 `none`）`issues` / `pull-requests` | `none` | **刻意不申请**。引用关系由**事件 payload 的 PR body 本地正则解析**得到，不经 API 读 issue/PR ⇒ 无此项需求。 | 已是 `none`（最小）。 |
| （未声明）`repository-projects` | `none` | 该键只覆盖 **Projects (classic)**；本项目是 **Projects (V2)**，本键对它无效 ⇒ 申请了也不解决问题。 | 保持 `none`。 |
| （未声明）其余全部 | `none` | GitHub 语义：`permissions:` 一旦声明，**未列出的一律置 `none`**。 | 逐一核对过，无遗漏需求。 |

🔴 **Projects (V2) 权限不经 `permissions:` 授予 —— 这是平台硬事实，须走 secret：**

- GitHub 官方 `permissions:` 可取值表中**没有**任何可授予 Projects (V2) 的键
  （`repository-projects` 只覆盖 classic）——
  [官方 docs 源](https://raw.githubusercontent.com/github/docs/4154a54894452b376b79221173e3f9225e6d384c/data/reusables/actions/github-token-available-permissions.md)。
- `GITHUB_TOKEN` 是 repo-scoped，**读写 Projects GraphQL API 都不行**；
  组织拥有的项目需 fine-grained PAT（组织权限 `Projects: Read and write`）或 GitHub App
  —— [Authentication (Projects)](https://github.github.com/gh-aw/reference/auth-projects/)。
- 因此本 workflow 依赖 `secrets.ISSUE_LIFECYCLE_TOKEN`。**实测该 secret 目前不存在**（见 §8 前置）。

---

## §7 验收 ⑤⑥：G1 零命中 + job name 零重名

### G1：不引任何 DSH 依赖

```
$ printf 'workflow  : %s 处\n' "$(grep -ci 'dsh\|deepseek harness' .github/workflows/issue-lifecycle.yml)"
workflow  : 0 处
$ printf 'lifecycle : %s 处\n' "$(grep -ci 'dsh\|deepseek harness' .github/issue-management/lifecycle.mjs)"
lifecycle : 0 处
$ grep -in 'dsh\|deepseek harness' .github/workflows/issue-lifecycle.yml .github/issue-management/lifecycle.mjs
(无输出=零命中)
```

### job name 与 12 条必需集**零重名**

**本卡 job（原文）**：
```yaml
jobs:
  lifecycle:
    name: Issue Lifecycle (非必需)
```

**12 条必需集（`scripts/control-tower/required-checks-baseline.txt:42-53` 逐字）**：

| # | CONTEXT_NAME |
|---|---|
| 1 | `Architecture Check` |
| 2 | `Checker Review (maker/checker)` |
| 3 | `Control Tower Gate Tests (ubuntu-latest)` |
| 4 | `Control Tower Gate Tests (windows-latest)` |
| 5 | `Golden Case F1 Gate` |
| 6 | `Integration Contract Check` |
| 7 | `Test-Kit Architecture Tests (ubuntu-latest)` |
| 8 | `Test-Kit Architecture Tests (windows-latest)` |
| 9 | `TypeScript + Lint + Iron Laws` |
| 10 | `Vitest (1/2)` |
| 11 | `Vitest (2/2)` |
| 12 | `npm audit` |

**机器比对（原始输出）**：

```
$ node -e "<解析 workflow job name × 读 baseline 12 条 → 求交集>"
本卡 job:
   id=lifecycle  name=Issue Lifecycle (非必需)
12 条必需集 (count=12): ...（上表 12 条）...
✅ 重名交集 = ∅（零重名）
>>> exit=0
```

**仓库自带的权威消费者 `check-required-contexts.py`（改完必跑）**：

```
$ python3 scripts/control-tower/check-required-contexts.py
REQUIRED-CONTEXTS-CHECK: root=... workflows=.../.github/workflows(6 文件) baseline=...(12 条) api_check=0 reverse=0
基线: source=branch-protection API；as_of=2026-10-01T18:41:11Z
本仓可产出 check-run 名: 19 个唯一名（展开自 19 个 job）
── 必需集 ⊆ 本仓可产出集: 12/12 命中 ──
REQUIRED-CONTEXTS: OK
>>> exit=0

$ python3 scripts/control-tower/check-required-contexts.py --reverse | grep -i 'issue lifecycle'
  Issue Lifecycle (非必需)  ← issue-lifecycle.yml[job=lifecycle]
```

> 双证：① 加本文件后必需集**仍 12/12 命中**（`OK`，未破坏既有链）；
> ② `--reverse` 把 `Issue Lifecycle (非必需)` 明列为**"会产出但不在必需集"** ⇒ **它不是门禁**（本卡红/绿不阻断合并）。

### YAML 可解析（双解析器）

```
$ node -e "const YAML=require('yaml'),fs=require('fs');const d=YAML.parse(fs.readFileSync('.github/workflows/issue-lifecycle.yml','utf8'));console.log('node yaml OK; keys =', Object.keys(d));"
node yaml OK; keys = [ 'name', 'on', 'permissions', 'concurrency', 'jobs' ]
>>> node exit=0

$ ruby -ryaml -e 'd=YAML.load_file(".github/workflows/issue-lifecycle.yml"); puts "ruby YAML OK; keys = #{d.keys.inspect}"'
ruby YAML OK; keys = ["name", true, "permissions", "concurrency", "jobs"]
>>> ruby exit=0
```

---

## §8 🔴 前置（阻断真实生效，请队长/CTO 处置）

| # | 前置 | 现状（实测） | 不做会怎样 |
|---|---|---|---|
| **P1** | 配 secret **`ISSUE_LIFECYCLE_TOKEN`** = fine-grained PAT（资源所有者 `synova-agent`，组织权限 `Projects: Read and write`） | **不存在**。实测：`grep -rn 'secrets\.' .github/workflows/` → **共 0 处**；`gh api repos/synova-agent/SynovaAgent/actions/secrets` → 空 | **（收窄后）当前无任何 PR 事件订阅 ⇒ 不会产生红噪音**。只有手动跑 `workflow_dispatch` 时会显式红（`LIFECYCLE: ERROR` + `::error::` + 可操作提示），**保持显式红不降级**（队长裁决 W-B2-③）。本卡完成条件 = P1 就位 + U1 端到端 |
| **P2** | 确认 issue 已在 Project #1 中 | 未知（未逐条核对全仓 issue 与 Project 的纳管范围） | issue 不在 Project 时**跳过并打印原因**（不擅自添加）⇒ 流转不生效但不报错。若期望"自动纳管"，需 CTO 裁是否放开 `addProjectV2ItemById` |

**我为什么让它在缺 token 时"红"而不是"静默绿"**：铁律 11/31（禁静默降级）＋ 队长本批明令
「静默失败 / 不看 exit code」是要抓的点。一个每次都静默成功的 workflow 会让人误以为状态在流转。
让它红、且红得可读（`::error::` + 明确提示），是诚实的。**它不阻断合并**（§7 已双证非必需）。
若 CTO 认为"持续红"噪音不可接受，备选是把 exit 1 降为 `::warning::` + exit 0 —— **请裁**，我不自判。

---

## §9 自捉错表

| # | 错误 / 差点犯的错 | 怎么发现 | 纠正 |
|---|---|---|---|
| 1 | **离线注入缝设计不完备**：初版 `SYNO_LIFECYCLE_MUTATION_LOG` 只跳过"发请求"，**仍要联网 `resolveTarget`** ⇒ 所谓"零网络证明"名不副实 | 自读代码时发现 mutation 循环首行就是 `await resolveTarget` | 加 `SYNO_LIFECYCLE_TARGETS` 注入 item 现值，使 offline 模式**真正零网络零凭据**，T1/T2 红绿成对才成立（§5） |
| 2 | **`manual` 分支顺序错**：offline 块声明在 `manual` 分支**之后**，而 `manual` 分支要 token ⇒ offline+manual 必炸 | 逐段核 `grep -n 'offline\|manual\|const token'` 的行序 | 把 offline/injectedTargets 声明**上移**到 `manual` 之前；`manual` 分支支持 `SYNO_LIFECYCLE_PR_BODY` 注入（T10 实测通过） |
| 3 | **`dry-run` 分支需 token**：初版 dry-run 之前先查 token，导致"零凭据 dry-run"做不到 | 写 T12 时想到 | 把 `dryRun` 判定提到 token 之前（T12 用 `env -u` 剥掉两个 token 变量实测 exit 0） |
| 4 | **验收命令依赖不存在的 python 模块**：`python3 -c "import yaml"` 在系统 python3 下 **ModuleNotFoundError**（无 pyyaml）⇒ 该验收命令原样会假失败 | 首次跑 T13 三连 traceback | 改用**两个真的可用**的解析器（`node_modules/yaml` + `ruby` stdlib），并额外跑**仓库权威消费者** `check-required-contexts.py`（它自带零依赖 YAML 子集解析器）。原命令仍在 §10 保留并注明需 pyyaml |
| 5 | **测试 harness 自身返回非 0**：`run()` 末行 `[ -f "$4" ] && sed ...`，T6 无 log 文件 ⇒ 函数返回 1、脚本整体 exit 1（≠ 产品失败） | 看到末行 `[exit code: 1]` 与前面全部 T 的输出矛盾 | 已在报告中标明"该 exit code 来自 harness 而非产品"；后续 T7+ 补 `|| true` |
| 6 | 险些把 `on:` 当普通字符串键读：**YAML 1.1 把裸 `on` 解析成布尔 `true`**（ruby 输出 `["name", true, ...]`） | ruby 与 node 的 keys 输出不一致（node `yaml` 按 1.2 给 `'on'`） | 断言脚本同时兼容两种：`d.get('on') \|\| d.get(True)`；并在产出件里**如实展示两个解析器的差异**（不藏） |
| 7 | **写集外产物**：`alloc-task-id.sh` 自动建了 `task-state/D1124.json` + task brief，二者**不在派单写集字面清单** | 跑分配器后 `git status` 立刻可见 | **不藏**：§4 逐条披露为"分配器强制产物"并请队长裁。全窗零夹带其他文件 |
| 8 | **分支名与任务号不同源**：队长建枝命令写 `d1131`，分配器返回 `D1124` | 对比派单与分配器输出 | 按队长命令保留分支名、按分配器用 D1124；§4 标注请裁。**队长已裁**：保留现名，规范定为 `<type>/<分配器D#>-<slug>`；`d1131` 系队长手写笔误，我的处理被认定正确 |
| 9 | **收窄后措辞失真（本件自身）**：队长裁 W-B2-③ 收窄触发面后，本件 §5 原写"`on:` 不订阅 `edited`" —— 该字面在收窄后**仍成立但不完整**（真实状态是"PR 事件整体未订阅"），继续照旧会让人误以为 PR 事件在跑 | 改 YAML 后回读 §5 保证 1，发现描述与产物不一致 | 已改写为「**PR 事件整体未订阅**；**恢复后亦不含 `edited`（已机器验证）**」，并补 §5 保证 1′ 收窄/恢复表。**教训**：改产物必须回扫产出件里的每一句"现状描述" —— 它们在改动那一刻就可能从"对"变成"不完整" |

---

## §10 未验证 / 未完成（直说，不猜）

| # | 项 | 为什么没验 | 需要什么 |
|---|---|---|---|
| U1 | **端到端真跑**（真 token → 真改 Project 状态） | 无 `ISSUE_LIFECYCLE_TOKEN`（§8-P1 实测不存在）；本卡禁止写 GitHub 凭据/secret | **本卡的完成条件**：CTO 配 P1 后，用 `workflow_dispatch` 手动纠偏通道对一个测试 PR 跑一次并确认 Project 状态真的变了；成功后按 §5 保证 1′ 恢复 PR 事件 |
| U2 | `on:`/`permissions:` 在 **GitHub Actions 运行器**上的最终解释（如 `concurrency` 组表达式在 `pull_request_review` 下的取值） | 需真实 run；本地只能用解析器验语法与结构 | 首次触发后看 run 摘要 |
| U3 | issue 与 Project #1 的**纳管覆盖度**（多少 issue 已在板内） | 未逐条遍历全仓 issue（超本卡范围） | `gh project item-list 1` 对账（只读） |
| U4 | 该 workflow 的 check-run **名字**在 Actions 面板的实际展示（是否为 job `name:` 逐字） | 需一次真实 run | 首次触发后核对（这也是我把它命名得与 12 条明显不同的原因） |
| U5 | CI 的 `docs-only` 快速通道对本卡是否生效 | 本卡含 `.mjs`+`.yml`，**非**纯文档 ⇒ 预期**不走** docs-only；未实跑 | 首个 PR run |

> **accepted 说明**：`python3 -c "import yaml; ..."` 作为验收命令在本机**不可用**（无 pyyaml）；
> §7 的 YAML 可解析证据改用 `node_modules/yaml` + `ruby` stdlib + 仓库自带解析器三路互证（比单一路更强）。

---

## §11 复现命令总表

```bash
# 环境
cd /Users/wane/SynovaAgent
git fetch origin main --quiet                 # 勿 fetch --all（并发抢 ref 锁）
git worktree add .synova-wt-wb2 -b feat/d1131-issue-lifecycle origin/main
cd .synova-wt-wb2
ln -sfn /Users/wane/SynovaAgent/node_modules node_modules
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
bash scripts/control-tower/alloc-task-id.sh "治理线B段Issue状态流转"   # → D1124

# YAML / 结构
node --check .github/issue-management/lifecycle.mjs
node -e "const Y=require('yaml'),f=require('fs');const d=Y.parse(f.readFileSync('.github/workflows/issue-lifecycle.yml','utf8'));console.log(Object.keys(d))"  # keys
ruby -ryaml -e 'p YAML.load_file(".github/workflows/issue-lifecycle.yml").keys'
python3 scripts/control-tower/check-required-contexts.py                 # → REQUIRED-CONTEXTS: OK
python3 scripts/control-tower/check-required-contexts.py --reverse        # → 明列本卡"非必需"

# 触发面收窄 + 恢复路径验证（§5 保证 1/1′）
#   A 现状：on 顶层事件必须恰为 ['workflow_dispatch']
#   B 恢复：取 RESTORE-BEGIN/END 之间 4 行 → 去掉 "# " → 前置 "on:" → YAML 解析
#           → 断言 = pull_request[opened,reopened,review_requested] + pull_request_review[submitted] 且不含 edited
#   完整脚本见 §5 保证 1 的原始输出（node -e，退出 0 = 全部断言通过）

# 只改标题不触发（离线，零网络零凭据；与触发面收窄无关，代码面保证**现在就可测**）
FIX=/tmp/d1124-fx
export SYNO_LIFECYCLE_TARGETS='{"101":{"itemId":"PVTI_item101","statusName":"Ready","startDate":null}}'
SYNO_LIFECYCLE_MUTATION_LOG=$FIX/m2.log node .github/issue-management/lifecycle.mjs \
  --event pull_request --payload $FIX/edited-title.json                   # → NOOP；m2.log 不存在（0 mutation）
SYNO_LIFECYCLE_MUTATION_LOG=$FIX/m1.log node .github/issue-management/lifecycle.mjs \
  --event pull_request --payload $FIX/opened.json                          # → APPLIED(2)；m1.log 2 行（正面对照）

# G1
grep -ci 'dsh\|deepseek harness' .github/workflows/issue-lifecycle.yml .github/issue-management/lifecycle.mjs

# 夹具 JSON 生成见 §5；完整 12 例（T1–T12）均在 §5 贴出原始输出
# ⚠ 注意：T1–T12 用 `--event` 直接喂脚本，**不依赖 workflow 的 on:** ——
#   故触发面收窄不影响这些夹具的有效性（它们验的是 decide()/planMutations() 的语义）
```
