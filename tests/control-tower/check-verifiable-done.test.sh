#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-verifiable-done.test.sh — Done 可证伪性判定的**取数**回归
#   （2026-10-13 治理线随卡 CTO-裁定-074-1b 的实测发现同批交付）
#
# 病根（实测，见本卡 brief Q2 说明）:
#   原实现 `done <<< "$(echo "$DONE_SECTION" | grep -E '^\s*- \[x\]')"` **只把 `- [x]` 那一行**
#   喂进判定循环 ⇒ 写在**续行**（缩进更深的说明行）里的 `verify:` **永远看不到** ⇒ 双向失效：
#     · ① 合法写法**假红** —— 本卡 brief 首版实测报「7 项 Done 中 3 项缺 verify:」，
#          而那 3 项的**下一行都写着 `verify:`**
#     · ② 只要把 verify 挤在同一行就"过"，续行内容完全不参与判定（判据形同只看一行）
#
# 覆盖矩阵（铁律 48）:
#   正常 — 同一行 verify: ⇒ exit 0 ／ 续行 verify: ⇒ exit 0（**本次修的核心**）
#   违规 — 条目（含续行）通篇无 verify: ⇒ exit 1，且点名该条目
#   边界 — 无 `## Done 标准` 段 / 无 `- [x]` 项 ⇒ 走既有"legacy 软通过"分支（不误红）
#   不放松 — 续行有内容但**没有** verify: ⇒ 仍判红（防"加了续行就当过"）
#
# 沙箱: 全部夹具在 mktemp -d 内；不碰真源、不写仓。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
C="$REPO/scripts/check-verifiable-done.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

[ -f "$C" ] || { echo "  ❌ 被测脚本缺失: $C"; exit 1; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
mkdir -p "$TMPD/.claude/task-briefs"

# 夹具载体必须是**真 git 仓**（脚本用 `git rev-parse --show-toplevel` 定 ROOT、且归属判据读暂存集）
FAKE="$TMPD/repo"
mkdir -p "$FAKE/scripts" "$FAKE/scripts/workflow" "$FAKE/scripts/control-tower" "$FAKE/.claude/task-briefs"
cp "$C" "$FAKE/scripts/check-verifiable-done.sh"
cp "$REPO/scripts/workflow/resolve-commit-brief.sh" "$FAKE/scripts/workflow/" 2>/dev/null || true
cp "$REPO/scripts/control-tower/brief_parser.py" "$FAKE/scripts/control-tower/" 2>/dev/null || true
[ -f "$FAKE/scripts/control-tower/brief_parser.py" ] || { echo "  ❌ 沙箱缺 brief_parser.py（resolver 会静默 exit 1 ⇒ 假绿）"; exit 2; }
git -C "$FAKE" init -q 2>/dev/null || true
git -C "$FAKE" config user.email t@t.local; git -C "$FAKE" config user.name t
# 🔴 resolver 定位解析器用 `dirname($0)/../control-tower/brief_parser.py`（D317：不用 $ROOT）
#   ⇒ 沙箱必须**同构复制**该相对布局，否则解析器缺失 ⇒ resolver 静默 exit 1 ⇒ "无 brief 跳过"假绿
mkdir -p "$FAKE/scripts/control-tower"
# 🔴 每个用例必须**清掉上一例的 brief**：resolver 的"日期最新"回退链会串到别的夹具 ⇒ 假绿/假红
# 🔴 夹具必须"可解析"（brief_parser.parse_criteria 取真）——否则 resolver 的最终回退
#    会挑不到任何 brief 并 exit 1，消费方就走"无 brief 跳过"⇒ **假绿**（我第一版实测踩到）。
#    字段构成照 `docs/synova/coordination/AGENTS-md-模板-20261002.md` 的最小可解析集：
#    `## 架构层:` ＋ `#CRITERIA: A` ＋ `## Done 标准`。文件名须带今日日期前缀（resolver 按日期窗口筛）。
mk_case() {  # $1=文件名 $2=Done 段正文
  rm -f "$FAKE"/.claude/task-briefs/*.md
  _D="$(date +%Y-%m-%d)"
  {
    echo "# Task Brief: 夹具"
    echo
    echo "## 架构层: -1 运行时"
    echo
    echo "#CRITERIA: A"
    echo
    echo "## Done 标准"
    printf '%s\n' "$2"
    echo
    echo "---"
  } > "$FAKE/.claude/task-briefs/${_D}-$1"
  git -C "$FAKE" add -A >/dev/null 2>&1 || true
  # 归属声明（② brief 在本次变更集内）—— 显式注入，不依赖真实 commit
  export SYNO_STAGED_FILES=".claude/task-briefs/${_D}-$1"
}

echo "=== Done 可证伪性 · 取数回归（续行 verify 可见性）==="

# ── A. 正常：同一行 verify ⇒ exit 0 ──
mk_case same-line.md '- [x] verify: bash scripts/x.sh'
OUT="$(cd "$FAKE" && SYNO_CI=1 bash scripts/check-verifiable-done.sh 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "A 同一行 verify ⇒ exit 0"; else no "A ⇒ exit ${RC}（应 0）"; echo "$OUT" | head -4 | sed 's/^/      /'; fi

# ── B. 🔴 正常：**续行** verify ⇒ exit 0（本次修的核心；修前此例假红）──
mk_case cont-line.md '- [x] 反例（改坏即红）：N1 改 item.paths ⇒ exit 1
      （判据点＝配对测试 D 组）
      verify: bash tests/control-tower/check-block-paths.test.sh'
OUT="$(cd "$FAKE" && SYNO_CI=1 bash scripts/check-verifiable-done.sh 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "B 续行 verify ⇒ exit 0（修前假红）"
else no "B ⇒ exit ${RC}（应 0 —— 续行 verify 必须可见）"; echo "$OUT" | head -6 | sed 's/^/      /'; fi

# ── C. 🔴 不放松：续行有内容但**无** verify ⇒ exit 1 ──
mk_case cont-noverify.md '- [x] 反例（改坏即红）：N1 改 item.paths ⇒ exit 1
      （判据点＝配对测试 D 组，此处**故意**不写判据命令）'
OUT="$(cd "$FAKE" && SYNO_CI=1 bash scripts/check-verifiable-done.sh 2>&1)"; RC=$?
if [ "$RC" -eq 1 ]; then ok "C 续行无 verify ⇒ exit 1（判据未放松）"
else no "C ⇒ exit ${RC}（应 1 —— 不许"加了续行就当过"）"; echo "$OUT" | head -5 | sed 's/^/      /'; fi
if echo "$OUT" | grep -q "缺 verify"; then ok "C 输出点名'缺 verify'"; else no "C 未点名"; fi

# ── D. 违规：多条目中一条缺 ⇒ exit 1 且**只点那一条** ──
mk_case mixed.md '- [x] verify: bash scripts/a.sh
- [x] 未写判据的那条'
OUT="$(cd "$FAKE" && SYNO_CI=1 bash scripts/check-verifiable-done.sh 2>&1)"; RC=$?
if [ "$RC" -eq 1 ]; then ok "D 混合 ⇒ exit 1"; else no "D ⇒ exit ${RC}（应 1）"; fi
if echo "$OUT" | grep -q "未写判据的那条" && ! echo "$OUT" | grep -q "bash scripts/a.sh"; then
  ok "D 只点缺 verify 的那条（不误伤有判据的条目）"
else no "D 点名不精确"; echo "$OUT" | head -6 | sed 's/^/      /'; fi

# ── E. 边界：无 `- [x]` 项 ⇒ legacy 软通过（既有行为不回归）──
mk_case empty-done.md '（本夹具刻意不写任何 - [x] 项）'
OUT="$(cd "$FAKE" && SYNO_CI=1 bash scripts/check-verifiable-done.sh 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "E 无 checked 项 ⇒ exit 0（legacy 软通过，既有行为不变）"
else no "E ⇒ exit ${RC}（应 0 —— legacy brief 无 checked 项是软通过）"; fi

# ── F. 反证：判据本身不许"恒绿"（造一条真缺 ⇒ 必须红）──
mk_case always-missing.md '- [x] 这条无论如何都应判红'
OUT="$(cd "$FAKE" && SYNO_CI=1 bash scripts/check-verifiable-done.sh 2>&1)"; RC=$?
if [ "$RC" -eq 1 ]; then ok "F 真缺 verify ⇒ exit 1（判据非恒绿）"
else no "F ⇒ exit ${RC}（应 1 —— 判据恒绿 = 判别力 0）"; fi

echo "  ── 合计: ${PASS} 通过 / ${FAIL} 失败 ──"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
