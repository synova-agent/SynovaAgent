---
name: brief-compose
description: 撰写符合控制塔 pre-commit 门禁的 task brief（6 字段 + #CRITERIA + 格式坑清单）。创建/编辑 .claude/task-briefs/ 新 brief 时使用。历史：D313-D316 每次因 brief 格式失败 1-3 轮 pre-commit。
---

# brief-compose — task brief 撰写

## 使用时机
在 `scripts/workflow/task-start.sh` 或手动创建 `.claude/task-briefs/<name>.md` 时。写完必须自查以下全部格式要求（pre-commit 组 6/12 物理验证，失败 = 提交阻断）。

## V5.2.0 开工位置自检（先于一切格式检查）
任务开工前确认当前路径在 `.sessions/<session-id>/repo` clone 内（不在主工作区——主工作区 = Codex 专用，禁止写代码）。brief 写在 **clone 内** 的 `.claude/task-briefs/`，随 feature 分支进 PR。不在 clone 内 → 先按 git-sync-pr"开工 clone 5 步"clone，再回来写 brief。

## 硬性格式（组 6/G12b 解析）

1. **6 个 `##` 标题**，冒号紧跟 Q 编号（`## Q0:` 不是 `## Q0：`）：
   `## Q0:` / `## Q1:` / `## Q2:` / `## Q3:` / `## 架构层:` / `## Done 标准`
2. **`#CRITERIA: A` 必填**（D313 起，正则 `#CRITERIA\s*[:=]\s*([A-D])`，全文任意位置可解析）
3. **Q2 include**（做什么）：每文件一行，`- scripts/路径` 开头（brief_parser 提取路径做 G12 范围判定）
4. **Q2 exclude**（不做什么）：每行以 `- 不改 <路径>` 开头，且**第一 token（`\S+`）必须含扩展名**（.ts/.sh/.py/.json/.md）
   - ❌ `- 不改 src/ 任何文件`（第一 token = `src/`，无扩展名 → 拦）
   - ✅ `- 不改 src/server.ts（及 src/ 下其他——独立任务）`
   - ❌ `- 不改 tests/ 下 D311 已交付测试`（无具体文件名 → 拦）
   - ✅ `- 不改 tests/control-tower/test-session-registry.py`
5. **架构层标题**：`## 架构层: 基础设施`（控制塔任务）或 L1-L5；不能写 `## 本任务在哪一层`
6. **Done 标准**：至少 1 条可被 bash 物理验证（写命令本身，如 `bash scripts/workflow/check-silent-swallow.sh --utf8` 返回 exit 0）
7. **禁模板残留**：`<!--` 注释不能留在文件里
8. **Q2 行内路径避免全角括号紧贴**（`（` 直接跟路径会导致解析含全角括号 → 路径不匹配误报）

## 自相矛盾防区（D314 教训）

- **include 和 exclude 不能同时涉及同一文件**：D314 时 brief 排除项写着"不改 baseline-check.sh"却又把它暂存 → G12 拦"Q2 排除项禁止修改"
- 文件加进暂存前，先确认它在 Q2 include 里（或被其他已认领 brief 覆盖——D296 认领制：`resolve-commit-brief.sh` 会按暂存文件反推认领 brief）

## 收尾纪律（D315 教训）

- `.claude/current-brief` 必须写**完整文件名**（如 `D316-ct-v460-fix.md`），不是短名
- 无扩展名的运行时文件（current-brief/bypass.log 等）**不能写进 exclude**（排除项检查要求扩展名）——直接不声明、不暂存
- 排除项声明的文件 = 承诺不改 = 暂存里绝不能出现

## 完成后验证（写完必须全部执行——缺一步 = 自检不完整）

```bash
# ① 排除项格式（最常漏——D316/D317 都因"自检没覆盖这条"被 pre-commit 拦）
bash scripts/check-plan-integrity.sh
# ② 解析性 4 项（Q2/#CRITERIA/架构层/Done）
bash scripts/workflow/check-brief-parseable.sh .claude/task-briefs/<name>.md
echo "<完整文件名>" > .claude/current-brief
# ③ 12 组物理门禁（最终裁决）
bash scripts/pre-commit-check.sh
```

> ⚠️ 教训（D317）: check-brief-parseable.sh 通过 ≠ 门禁全过——排除项检查在
> check-plan-integrity.sh（组 6）。自检必须跑①+②+③全链，不能只跑②。

## 历史案例索引
- D313: exclude 行缺具体文件名 → 组 6 拦
- D314: include/exclude 自相矛盾（baseline-check.sh）→ G12 拦
- D315: current-brief 无扩展名进 exclude → 拦
- D316: "不改 src/ 任何文件"第一 token 无扩展名 → 拦
- D317: 同上坑第二次踩（skill 有反例但完成验证缺 ①）→ 补全验证链

---

## 交前五步自检（2026-10-01 定 · **每张 brief 交付前逐条跑**）

> 依据：三条 CI 日志实证的「唯一性与精确性」要求（#884 / #910 / #912 实测所得）。
> **五步全过再交** —— 缺任一步，CI 必红（且红因常表现为"不在 Q2 范围内"/"候选不唯一"/"brief 不可解析"）。

| # | 自检 | 命令 | 期望 |
|---|---|---|---|
| **1** | **当日 brief 唯一** | `ls .claude/task-briefs/$(date +%F)-* \| wc -l` | **1**（两个 ⇒ `merge-writeset-gate` 报"候选不唯一" exit 2） |
| **2** | **占位符清零** | `grep -c '<具体文件路径' <brief>` | **0**（`alloc-task-id.sh` 骨架残留会直接红） |
| **3** | **「做什么」是精确路径** | `sed -n '/做什么/,/不做什么/p' <brief> \| grep '^- '` 每行去 `- ` 后 `[ -e ]` | **全为真** |
| **4** | **「不做什么」每项带扩展名** | 同上段，检查含 `.sh`/`.py`/`.yml`/`.json`/`.ts` | 每项都有 |
| **5** | **与 diff 权威对齐** | `git diff --name-only origin/main...HEAD` 的每个文件都在「做什么」里 | **全覆盖** |

**第 3 步的源码依据**（读 `scripts/pre-commit-check.sh` 组 12 所得）：
```python
def matches(path, pat):
    return re.search(r'(^|/)' + re.escape(pat) + r'$', path) is not None
```
⇒ `pat` **必须正好是相对路径**；行尾带 ` —— 说明` 或 `（说明）` 都会被 `re.escape` 一起转义 ⇒ 匹配失败
⇒ **正确写法**：`- <相对路径>`（说明移到段末 `（做什么的说明：…）`）

**第 5 步要覆盖的"流程元文件"**（最易漏）：
`.claude/bypass.log`（post-commit hook 自动追加）｜自身 brief｜`task-state/<D#>.json`｜决策 Note（`memory/notes/**` 或 `decisions/**`）

⚠️ **另两条连带规则**（同批实证）：
- **commit message 必须带 D 号**，否则 `❌ D328: 提交声明(无)与暂存文件归属(D#)不一致 — 疑似并行劫持`
- **brief 正文不得追加"原 brief 全文"类附录** —— 会被 `G12b brief 可解析性` 判失败（实测 2 处 ❌ → `baseline=FAIL`）
