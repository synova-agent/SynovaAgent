# Task Brief — #1108 W10 · Unicode 同形字分级门禁（A/B/C 阻断 · D 仅提醒 · 只查 diff）

#CRITERIA: D

> 任务唯一编号 = Issue 号。#1108 ｜ 分支 `feat/1108-unicode-confusable` ｜ 基线 `gitea/local-main` = 3449bafdb
> 声明载体 = `.claude/claims/1108.yaml`（writeset ＋ done 两字段制）；本件是 Q1–Q3 的可读说明（同批提交）。
> 架构层: 不属五层业务（治理脚本）
> 规格来源：`docs/founder/DEVDOC-门禁治理实施规格-v1-20261028.md` §3 W10（:155-167）＋ §4 G10（:186）＋ §5 M-11/M-12（:204-205）

## Q1: 调研 — 业界最佳实践 / 决策链 / memory 历史教训

- **业界基线（Trojan Source，CVE-2021-42574 类）**：真危险不是"有非 ASCII"，而是**同形字冒充标识符**
  （`pаssword` 里是西里尔 `а`）与**双向控制符**（U+202A–202E／U+2066–2069）—— 人眼与 grep 均漏，
  只有逐字符码位比对能判。编码损坏（U+FFFD／非法 UTF-8 字节）是第三类证据。
- **本仓现状（base 树上实测）**：本仓存在**系统性全角污染**（规格实测：main 仓 899/1451 受控 `.ts`
  含歧义字符；`ct/p3m7-pr5` 的 cron/cycle 范围 1,341 处，已确认 0 在变量名/裸代码位、cron 表达式 ASCII 干净）。
  ⇒ **全仓禁非 ASCII 不可行**（会把每个 PR 判红），必须"只判本次 diff 新增行 ＋ 存量为遗留清单"。
- **历史教训（memory/notes/** ＋ 规格 §3 W10）**：D738（bash `$VAR` 全角边界常驻扫描，PR #544 未合）、
  研究规格外部审计器 finding #13（`\uFFFD` 检查）—— 两者**意图并入本项**，不另立门禁（防门禁膨胀）；
  D370/D738 自身教训：**扫描器禁 cp1252 猜编码**（Windows 下 UnicodeDecodeError 曾被误降级成"通过"）、
  **禁 `$VAR（` 全角边界**（bash 下变量名吞全角 ⇒ `unbound variable`）；扫描器自身故障必须归 **2**，绝不归 0。
- **决策参考系（Q1c）**：第一性原理（危险＝视觉冒充/编码损坏，不是"非 ASCII"）＋ 仓内既有约定
  （三态退出码 0/1/2、UTF-8 强制、`SYNO_GATE_DEGRADED_LOG` 降级日志、`--selfcheck` 判别力自检、
  改坏即红）⇒ **不发明新机制**，接入模式沿用 #915 `check-tool-args-delta.py`。

## Q2: 范围

做什么：

- scripts/control-tower/check-unicode-confusable.py
- tests/control-tower/check-unicode-confusable.test.sh
- gate-exemptions/2026-10-28-1108-unicode-confusable.md
- docs/authority/DOCS-REGISTRY.yaml
- docs/authority/WIRING-REGISTRY.yaml
- .claude/task-briefs/2026-10-28-1108-unicode-confusable.md
- .claude/claims/1108.yaml
- memory/notes/proposed/2026-10-28-1108-unicode-confusable.md

判据要点（分档只对 **diff 新增行**；`--base <ref>` ⇒ `git diff --unified=0 <ref>...HEAD`；无 base ⇒ `git diff --cached`）：

- **A 档（P0 阻断）**：标识符/裸代码位（注释与字符串字面量置空后的"骨架"）出现同形字
  （西里尔 `а` U+0430／希腊 `ο` U+03BF 等＋NFKC 归一后落 ASCII 的全角字母数字）。**中文注释不判 A**。
- **B 档（P0 阻断）**：任意位置 U+202A–U+202E、U+2066–U+2069。
- **C 档（P0 阻断）**：任意位置 U+FFFD ／ 该行含无法按 UTF-8 严格解码的字节（编码损坏证据，禁 cp1252 猜）。
- **D 档（P2 仅提醒）**：全角标点 U+FF01–U+FF5E（剔除全角字母数字）⇒ 列行号清单，**exit 0**。
- **三态**：0 通过/SKIP ｜ 1 有 A/B/C 命中 ｜ **2 判不了／自身失败**（坏 base／非 git 仓库／参数错／
  diff 有 `@@` 但解析不出 hunk／自检判别力失效）—— 绝不可归 0；`--json` 机读；`--list-legacy` 列存量不判红。

不做什么（含文件路径）：

- 不做接线：不改 `scripts/pre-commit-check.sh`、不改 `.gitea/workflows/local-gates.yml`、
  不改 `docs/authority/GATE-INVENTORY.yaml`（前置条件实测缺失，见下「接线判定」）。
- 不扫全仓（禁"每次 PR 判全部历史"）：`--list-legacy` 只是清单，永不进退出码。
- 不改 `scripts/audit/**`（K3 审计专属，红线）；不改 `scripts/control-tower/probe-*.ts`（M6 独占）。
- 不重写 D738 的既有 bash 扫描为独立门禁（意图并入本项）；不关闭/不合并 PR #544。
- 不提供 inline 忽略注释（`# swallow-ok:` 对本器无效）：A/B/C 若需豁免走 W3 双人复核 ＋ 日落。
- 不整合"已被错误解码的 mojibake 文本"判定（需语义/词典，见脚本「已知限制 5」）。
- 不合并任何 PR、不推他批分支、不动 `main`。

接线判定（本批实测，禁假装已接线）：

- 前置①：`git show gitea/local-main:docs/authority/GATE-INVENTORY.yaml | grep -c classification` ⇒ **0**（段不存在）
- 前置②：`git show gitea/local-main:scripts/pre-commit-check.sh | grep -c 治理面自检` ⇒ **0**（段不存在）
- 结论：按派单规则「有缺 ⇒ 只交付核心（脚本＋测试＋声明件）」⇒ **本批不接线**，WIRING 填 `declared-only`，
  接线待 **W1(#1090)** / **W5(#1088)** 合入后再做（届时另开批次，本器入口参数已备好 `--base/--staged/--json`）。

## Q3: 验收（入口 → 交互 → 结果）

- **入口**：`python3 scripts/control-tower/check-unicode-confusable.py --base gitea/local-main`（CI 口径）
  或 `python3 scripts/control-tower/check-unicode-confusable.py --staged`（pre-commit 口径）；
  自检：`--selfcheck`；存量清单：`--list-legacy`。
- **交互**：逐条打 `❌ [A|B|C] path:line:col 码位 '字符' —— 位置（P0 阻断）`／`⚠️ [D]` 行号清单／
  末行 `UNICODE-CONFUSABLE: PASS|VIOLATION|SKIP files=… added=… a=… b=… c=… d=…`。
- **结果**：`bash tests/control-tower/check-unicode-confusable.test.sh` ⇒ **0 失败**（59 断言，T0–T18）；
  M-11（西里尔 `а` 冒充变量名）⇒ `rc=1`；M-12（仅存量含全角、diff 干净）⇒ `rc=0` ＋ 列出遗留清单；
  把 A 档判据改恒假 ⇒ M-11 用例 **由 1 变 0**（改坏即红）。

## 架构层: 不属五层业务（治理脚本）

## Done 标准

- [x] 扫描器 python3 直接可跑、三态齐（0/1/2）、`--json` 合法、自身故障归 2 verify: python3 scripts/control-tower/check-unicode-confusable.py --selfcheck
- [x] M-11 西里尔 `а` 冒充标识符 ⇒ rc=1（A 档阻断） verify: bash tests/control-tower/check-unicode-confusable.test.sh
- [x] M-12 仅存量含全角、diff 干净 ⇒ rc=0 且列遗留清单（不阻断） verify: bash tests/control-tower/check-unicode-confusable.test.sh
- [x] 配对测试 0 失败（T0–T18，含 B/C 档、解码边界、参数互斥、改坏即红） verify: bash tests/control-tower/check-unicode-confusable.test.sh
- [x] 受保护路径豁免合规（三段式 ＋ 自覆盖行，含 DOCS-REGISTRY 自登记） verify: bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/local-main --root .
- [x] 新文件纯 LF（CR 字符数 0） verify: bash tests/control-tower/check-unicode-confusable.test.sh
