---
状态: implemented
日期: 2026-09-29
决策: resolve-commit-brief.sh 三处语义修正——① 新增 P0 强锚点优先级（暂存 task-state/D<id>.json > 分支名 D# 的 brief 存在且 parse_criteria 通过 ⇒ 直接定案，不再进入认领计数）② 认领计数从「(暂存文件 × Q2 路径条目) 出现次数」改为「去重文件数」③ D#→brief 定位从 glob `*-D<id>-*` 改为「文件名首个 D# token 的边界匹配」，并按队长裁决分两级（一级身份集供 P0 / 二级提及集供候选池与同数 tie-break）
理由: 修复前证据分级倒置——①自证级（本提交自身载荷 task-state/D#.json、分支名）恒被 ③启发级（日期窗口 + 路径认领计数）压制：锚点只在「同数」时 tie-break、只在认领全空时末位回退。实测 D1061 自己的提交（暂存 task-state/D1061.json）被 D1039 的陈旧 brief 劫持，直接后果是 staging_guard.py:86 `claim_did != sess_did` → status=block，阻塞四条链（#868→#894 / #883 / #892）。计数按出现次数还使「同一路径在 Q2 写 4 次」成为可刷的票数（D1039 brief 的 ci.yml 实测 4 次）。glob 定位则让「文件名首 D# 后无分隔符」的 brief 对自身 D# 物理不可达（实测 19 例：D471/D791/D922/D311/D312/D313/D320/D362/D371-D378/D380/D808/D852），而次位交叉引用 D# 反被误锚（实测 2 例）。
---

## 任务

D1069（门禁线小队）— 源派单：alloc「D328 修复：resolve-commit-brief.sh 强锚点失配」。
被修文件 `scripts/workflow/resolve-commit-brief.sh` 是 pre-commit G12 / check-plan-integrity.sh /
check-brief-vs-code.sh / check-verifiable-done.sh / commit-msg-check.sh / staging_guard.py 的共同上游。

## 决策 1：P0 强锚点优先级（自证级 > 启发级）

证据分三级：①**自证级** = 暂存 `task-state/D<id>.json`（本提交自身的 D# 载荷）+ 分支名（本 session 任务声明）；
②**声明级** = current-brief；③**启发级** = 日期窗口 + 路径认领计数。修复前 ③ 恒压 ①。
**P0**：强锚点 brief（**一级身份集**）存在且 `parse_criteria` 通过 ⇒ 直接输出，不再进入认领计数。
D# 来源优先级：暂存 task-state > 分支名。
降级：无锚点 ⇒ 整块零 spawn；锚点 brief 缺失或不可解析 ⇒ 下探 P1..P4，行为与修复前一致，绝不静默返回坏 brief。

参考系：`参考：Anthropic 显式优先级 + 本项目 alloc-task-id.sh:191 边界正则先例 + 第一性原理（自证级 > 启发级）`

## 决策 2：认领计数 = 去重文件数

`scope = sorted({p.strip() for p in parse_q2(text)['include'] if p.strip()})`；
`n = sum(1 for sf in sorted({s.strip() for s in staged if s.strip()}) if any(match_path(sf, p) for p in scope))`。
不变式：同一路径在 Q2 写 N 次 ⇒ 对任一暂存文件贡献恒为 1。

## 决策 3：D#→brief 定位两级（队长裁决，2026-09-29）

- **一级「身份集」** = 文件名 basename 首个 D<digits> token == 锚点 D#，边界对齐 `alloc-task-id.sh:191`
  的 `(^|[^0-9a-z])d<num>([^0-9]|$)`（该处 `grep -i` ⇒ 大小写无关）。纯 bash 逐字符扫描，零子进程。
  **只有一级可被 P0 定案。**
- **二级「提及集」** = 旧 glob `*-D<id>-*` 语义（锚点 D# 出现在非首位）。**仅当一级为空时兜底**，
  只入候选池 / 参与同数 tie-break，**P0 不认**。
- 为什么保留二级：`D313-D314-control-tower-finalize.md` 是合卡 brief，D314 无独立身份件 —— 纯一级会让
  `task-state/D314.json` 彻底失去锚点（覆盖回归）；而 `2026-09-29-D1064-FIX-D1032-*.md` 因 D1032 有真身份件，
  一级即命中，正好消除旧 glob 的双命中歧义。
- 覆盖统计（工作树 160 brief）：旧 glob 命中「身份」→ 新规则仍命中 **0 例失配**；旧 glob 漏「身份」→ 新命中 **19 例**；
  旧 glob 误命中「次位」→ 新不命中 **2 例**（修复目标，非回归）。

## 规范 4 注入缝（测试方契约）

P0 实现包裹在 `# <<<ANCHOR-PRIORITY-START>>>` … `# <<<ANCHOR-PRIORITY-END>>>` 之间（独立成行、全大写）。
测试方按标记区间 `sed` 删除构造变异副本 ⇒ 对复现输入必须回落到 D1039（改坏即红）。
缝外零引用缝内变量（实测变异副本：残留标记 0、残留 `_p0_` 0、`bash -n` exit 0）。

## 遗留（登记，不在本卡）

1. `check-silent-swallow.sh --utf8` 全仓存量红：17 个 .sh 缺 `PYTHONIOENCODING` 头块（本卡被测文件**不在其中**；
   pre-commit 实际调用 `--diff` 模式，本卡零新增）。名单含本卡明令禁改件（如 `alloc-task-id.sh`），另立卡。
2. `tests/control-tower/today-by-name.test.sh` exit=1（`DAY_WINDOW_RE: unbound variable`）与
   `tests/control-tower/staging-guard-session.test.py` exit=1（5 failures）为**既有红**：已用 HEAD 基线工作树
   （f51aaf9b）机械比对，失败集合逐条一致（`diff -q` 全等），且 `DAY_WINDOW_RE` 在本卡被测文件零出现。
3. `scripts/control-tower/brief_parser.py` 两处缺口（bullet 不剥反引号 / 排除臂对目录 glob 失效）已由 D1039
   brief 登记，本卡不改（最高风险门禁脚本类）。
