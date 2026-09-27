# CT5 证据 — CT-D2：doc-registry-gate CI fail-open 根治 + evidence 登记口径 + L-Q2 归一化

> 成员: gate-fix ｜ 任务: task-5（CT-D2）｜ 任务号: D1030 ｜ 分支: `fix/ct-gate-inference-20260927`
> 工作树: `/Users/wane/SynovaAgent/.synova-wt-ct-gate`（唯一写入点；主树零写入）
> 被改文件（3）:
> - `scripts/doc-system/doc-registry-gate.sh`（改前 md5 见 §一.3 → 改后见下）
> - `tests/doc-system/doc-registry-gate.test.sh`（新增 H 段落 + 注入点 `SYNO_DOC_GATE_SRC`）
> - `.claude/task-briefs/2026-09-26-D1023-commit-msg-decisions.md`（L-Q2：1 行归一化）
> **未改**：`docs/authority/DOCS-REGISTRY.yaml`（md5 `ba6e297f3b450a745c15a2b375c70e2d`，`git diff` 为空 —— 见 §二「二者择一」）
> 所有数字/输出均为命令原始输出，未手写。

---

## 一、交付 1：修 fail-open（核心）

### 1.1 根因（读全文确认）

`scripts/doc-system/doc-registry-gate.sh:40-43` 在 git 仓库里只取两个集合：

```
① git ls-files --others --exclude-standard        （untracked）
② git diff --cached --name-only --diff-filter=A    （staged-new）
```

CI `actions/checkout`（`fetch-depth: 0`）后**所有文件都已 tracked + committed** ⇒ ①② **皆空**
⇒ `:48` 打印「检查 0 个文档」⇒ `FAIL=0` ⇒ **放行**。
即：该门禁只在**本地未提交态**有效，**在提交态从未真正行使**（fail-open）。
（`:44-45` 的**非 git** 分支走全量 `find` —— 旧测试的 A~D/D 用例走的正是这条，
**所以"测试全绿"掩盖了提交态的 fail-open**。）

### 1.2 改前 / 改后原始输出（纯 tracked 仓库 = CI checkout 形态）

夹具：`main` 上提交「老文档 + 台账」→ 切 `feat/D999-add-doc` → **新增 `docs/newdoc.md` 并提交**
（不 add、不暂存 → untracked=0 / staged-new=0）。

```
───────── 改前（HEAD 版 doc-registry-gate.sh） ─────────
[仓库形态] untracked=0  staged-new=0  (两者皆 0 = 纯 tracked = CI checkout 形态)
── 汇总: 检查 0 个文档，0 个未登记 ──
  ✅ 登记门禁通过
exit=0                          ← ⚠️ fail-open：本分支新增的未登记文档被整口放行

───────── 改后（CT-D2 修复版） ─────────
[仓库形态] untracked=0  staged-new=0  (两者皆 0 = 纯 tracked = CI checkout 形态)
  ℹ️ 扫描源: ① untracked ② staged-new ③ base..HEAD 新增（base=main merge-base=d15f7840）
  ❌ 未登记: docs/newdoc.md （请加入 docs/authority/DOCS-REGISTRY.yaml）
── 汇总: 检查 1 个文档，1 个未登记 ──
  ❌ 登记门禁阻断
exit=1                          ← 判据：`检查 N 个文档` N>0 且拦下新增未登记文档 ✅
```

### 1.3 修法（并把"为什么不改成全量"实测写死）

```bash
③ ADDED_VS_BASE = git diff --name-only --diff-filter=A <merge-base(base,HEAD)>..HEAD
   base 解析链: origin/main → main → origin/HEAD（与 scripts/control-tower/check-pr-budget.sh 同口径）
   全链不可解析 / merge-base 为空 → ⚠️ **显式降级**（打印留痕、源③跳过、不误红）
```

**为什么不改成"全仓 tracked 全量登记"**（实测，防止后来者"顺手改成全量"）：

```
$ （全仓候选实测脚本）
tracked .md/.yaml=2214  加 evidence 豁免后候选=872  其中未登记=751  registry 条目=39
```

⇒ 台账只有 39 条、面向**权威文档**；全量口径会一次性产生 **751 条未登记**、把每个 PR 都判红。
故范围严格限定为"**本分支新增**"（与门禁本来的语义"新增文档必须登记"一致）。

### 1.4 三条稳健性用例（测试 H 段落，逐条原始输出）

```
── H. CT-D2: CI 形态（提交态）新增文档必须被拦 ──
  ✅ H 前提: 纯 tracked 仓库（untracked=0 / staged-new=0）= CI checkout 形态
  ✅ H1 CI 形态新增未登记文档 → exit 1 (exit 1)
  ✅ H1 检查数 N=1 > 0（提交态真扫到文件）
  ✅ H1 逐文件点名未登记文档
  ✅ H2 补登记后通过 (exit 0)
  ✅ H3 evidence/ 新增豁免（运行期产物） (exit 0)
  ✅ H3 evidence 文档未进检查面（只豁免不登记）
  ✅ H4 base 不可解析 → 显式降级（不 exit 2、不误红） (exit 0)
  ✅ H4 降级留痕（不静默）
── 汇总: 18 通过 / 0 失败 ──
```

> ⚠️ H 段落带**前提守卫**（先断言 untracked=0 且 staged-new=0）：若夹具意外落进非 git 全量分支，
> 前提断言会先红 —— 防止"新测试也掉进非 git 分支而假绿"（卡面点名的陷阱）。

### 1.5 "改坏即红"（换回改前实现，跑同一套测试）

```
$ SYNO_DOC_GATE_SRC=/tmp/ct5-gate-before.sh bash tests/doc-system/doc-registry-gate.test.sh
  ✅ H 前提: 纯 tracked 仓库（untracked=0 / staged-new=0）= CI checkout 形态
  ❌ H1 CI 形态新增未登记文档 → exit 1 (期望 1 实际 0)
  ❌ H1 检查数 N=0（必须 >0；改前这里是 0 = fail-open）
  ❌ H1 未点名未登记文档
  ✅ H2 补登记后通过 (exit 0)
  ✅ H3 evidence/ 新增豁免（运行期产物） (exit 0)
  ✅ H3 evidence 文档未进检查面（只豁免不登记）
  ✅ H4 base 不可解析 → 显式降级（不 exit 2、不误红） (exit 0)
  ❌ H4 降级未留痕
── 汇总: 14 通过 / 4 失败 ──
```

⇒ 4 条新断言回红，**既有 A~G/W1/W2 全绿** ⇒ 判别性干净（注入点 `SYNO_DOC_GATE_SRC`，零改真实文件）。

---

## 二、交付 2：`docs/authority/DOCS-REGISTRY.yaml` —— 结论 = **只豁免、不登记**（二者择一）

### 2.1 结论

evidence 目录**进 EXCLUDE（运行期产物口径）**，**不往台账补登记**：

```bash
EXCLUDE='…|docs/synova/product-lines/evidence/'
```

### 2.2 依据（三条，均可核）

1. **性质**：`docs/synova/product-lines/evidence/**` 是**任务级 M5 自验证据**（"任务证明"），
   不是"权威文档"。台账 `DOCS-REGISTRY.yaml` 的 39 条全是 navigation/architecture/governance/decision/
   research/knowledge 类**权威件** + skills —— evidence 不属其类。
2. **与既有排除同口径**：`DASHBOARD*.md`（自动生成）与 `/archive/`（历史归档只读）已按"非权威文档"排除；
   `merge_writeset_gate.py` 亦把 `.claude/bypass.log` 列为"运行期产物"。evidence 与它们同类。
3. **不登记的成本论证（实测）**：evidence tracked 件数 = **30**（本分支口径；全仓口径 113 件，19 目录），
   逐条登记意味着**每个任务都要改共享的 `DOCS-REGISTRY.yaml`**（=并行 PR 写冲突机器），
   且登记不产生真相价值。**双真相源禁令**：既然选 EXCLUDE，就**不**补登记。

### 2.3 未改证明

```
$ md5 -q docs/authority/DOCS-REGISTRY.yaml
ba6e297f3b450a745c15a2b375c70e2d
$ git diff --stat -- docs/authority/DOCS-REGISTRY.yaml
（空）
$ git status --porcelain docs/authority/DOCS-REGISTRY.yaml
（空）
```

> 该文件虽在本卡写集内，但结论是"EXCLUDE"，故**一个字都不动**（"既豁免又登记"= 双真相源）。

---

## 三、交付 3：L-Q2 归一化 —— 并**实测推翻卡面的一半判据**（前提冲突，已回报队长）

### 3.1 改动

```diff
- 不改任何 src/** 产品代码
+ 不改 src/**
```

### 3.2 改前 / 改后 `parse_q2` 原始输出

```
改前:
$ python3 scripts/control-tower/brief_parser.py --q2-exclude .claude/task-briefs/2026-09-26-D1023-commit-msg-decisions.md
scripts/pre-commit-check.sh
scripts/control-tower/merge_writeset_gate.py
任何 src/** 产品代码            ← 夹杂散文，两端口径皆永不匹配（排除意图失效）

改后:
$ python3 scripts/control-tower/brief_parser.py --q2-exclude .claude/task-briefs/2026-09-26-D1023-commit-msg-decisions.md
scripts/pre-commit-check.sh
scripts/control-tower/merge_writeset_gate.py
src/**                          ← 裸路径（卡面要求的一半：成立 ✅）
```

### 3.3 ⚠️ 实测冲突：**"能被 `match_path` 匹配"这半条判据不成立**（不掩盖）

`brief_parser.match_path()` 的实现是**字面后缀匹配**（`:203-205`）：

```python
def match_path(path: str, pattern: str) -> bool:
    """路径匹配（语义 = resolve-commit-brief.sh matches(): (^|/)pat$)"""
    return re.search(r"(^|/)" + re.escape(pattern) + r"$", path) is not None
```

`re.escape` ⇒ **通配符不展开**。实测（两消费端 × 两 pattern）：

```
pattern = '任何 src/** 产品代码'
   match_path (brief_parser / G12, 字面)   src/foo.ts -> False
   matches    (merge_writeset_gate, glob)  src/foo.ts -> False

pattern = 'src/**'
   match_path (brief_parser / G12, 字面)   src/foo.ts -> False     ← 仍 False（卡面该半条不成立）
   matches    (merge_writeset_gate, glob)  src/foo.ts -> True      ← 归一化真正生效的一端 ✅
```

G12 的**消费端**用的是同一个字面匹配器（`scripts/pre-commit-check.sh:1351`：
`re.search(r'(^|/)' + re.escape(pat) + r'\$', path)`）⇒ 换任何 `src/**` 形态的写法都无法被 G12 匹配。

**结论**：归一化的真实收益 = ① 去掉散文污染（条目变成合法路径形态）② 对**glob 感知消费端**
（`merge_writeset_gate.matches`，含 `*?[` 时走 `fnmatch`）真正生效。
**要让 G12 也生效，必须改 `brief_parser.match_path` + `pre-commit-check.sh:1351` 两处收敛到 fnmatch**
—— 那属 `scripts/pre-commit-check.sh`（**不在本卡写集**）与 `docs/synova/coordination/board-backlog.json`
里已登记的独立条目（D718："G12 的 matches 收敛到 fnmatch（或两端口径统一为显式 glob 语法）"）。
本卡**不越界**，见 §五 遗留 1。**不声称**"L-Q2 已使排除对 G12 生效"。

---

## 四、自验结论

- 交付 1（fail-open）：**成立**。CI 形态（纯 tracked，untracked=0/staged-new=0）下
  改前 `检查 0 个文档` → exit 0（放行）；改后 `检查 1 个文档` → exit 1 且逐文件点名。
  "改坏即红"：换回改前实现 → 4 条新断言回红、既有 9 条全绿。
- 交付 2（登记口径）：**成立**。结论 = 只豁免不登记 + 台账零改动（md5/diff/status 三证）。
- 交付 3（L-Q2）：**部分成立**。裸路径形态 ✅；"能被 `match_path` 匹配" ❌（实测证明该半条不可达，
  需改本卡写集外的两处，已如实上报队长）。
- 回归：`tests/doc-system/doc-registry-gate.test.sh` 18/18 绿；
  `tests/control-tower/merge_writeset_gate.test.sh` 59/0 绿；
  `tests/control-tower/check-pr-budget.test.sh` 45/45 绿；`bash -n` 通过。

**自验结论: 可提请独立审计（附一条前提冲突，判据 3 的第二半不可达）**（不构成审计通过；审计权归 K3）。

---

## 五、遗留清单

1. **G12 侧 glob 语义未收敛**（卡面 L-Q2 第二半不可达的根因）：要让 `src/**` 对 G12 生效，须改
   `scripts/control-tower/brief_parser.py:203-205` 与 `scripts/pre-commit-check.sh:1351` 两处字面匹配器
   → fnmatch。**两者都不在本卡写集**；`board-backlog.json` 已有同型条目（D718）。
2. **`tests/doc-system/doc-registry-gate.test.sh` 首行带 BOM**（`b'\xef\xbb\xbf'`）⇒
   `bash tests/...` 可用但 `./tests/...` 会被 shebang 顶掉报 `No such file or directory`（本卡实测输出）。
   **未修**：D718 台账已把该文件按"文档系统域"派工给别的卡，修它可能与那张卡冲突 ⇒ 只登记，不动。
3. **fail-open 修复的暴露面（blast radius）**：源③启用后，**新增**（`--diff-filter=A`）且未被 EXCLUDE 的
   `.md/.yaml` 会开始被要求登记。当前仓库该门禁只在本地 pre-commit 以 `soft_check` 运行
   （`scripts/pre-commit-check.sh:1486-1498`），CI 仅跑其**测试**（`ci.yml:367`）⇒ 今日不会硬拦任何 PR；
   若将来把它接进 CI，则新增协调类文档（如 `docs/synova/coordination/**.md`）需登记或加 EXCLUDE。
   —— 属**有意的行为变更**（这就是"修 fail-open"的定义），在此显式登记暴露面。
4. `docs/authority/DOCS-REGISTRY.yaml` 内**未加**任何 evidence 说明性注释（避免"既豁免又提及"的
   双口径观感）；决策记录落在本证据 + `scripts/doc-system/doc-registry-gate.sh` 头注释 + D1030 决策 Note。
