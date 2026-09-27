#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-pr-budget.test.sh — D734 PR 预算门禁测试
#
# 覆盖（铁律 48: 正常 / 降级 / 边界）:
#   1. 正常路径 — 小写集单域 → exit 0
#   2. 超预算  — 文件数 > 上限 → exit 1（且点明「拆 PR」）
#   3. 跨域    — 变更落两个域 → exit 1（调 D733 check-ownership 单域模式）
#   4. 边界    — 0 文件 / 恰好等于上限 / --max-files 注入
#   5. 降级    — 基线全链不可解析 → 显式 ⚠️ 留痕 + exit 0（不静默、不误红）
#   6. 检查失败 — 域校验器缺失 → exit 2（fail-closed）
#   7. 落后基线 — 沙箱 git 仓库落后 → ⚠️ 告警但 exit 0（不阻断）
#   8. 接线    — pre-commit 真调用本脚本（铁律 0-2 WIRE CHECK）+ 组数横幅未被改动
#
# 零真实仓库污染: 沙箱 mktemp + 沙箱 git 仓库（PLATFORM-CHECKLIST #6，git 身份用 -c 内联，禁 git config 持久写入）。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# 被检实现注入点（ctrl-tower-change 模式 5）: 默认 = 仓内实现；
#   SYNO_BUDGET_SRC=<path> 指向基线/变异副本 ⇒ "改坏即红"取证，零真实文件改动。
TOOL="${SYNO_BUDGET_SRC:-$REPO_DIR/scripts/control-tower/check-pr-budget.sh}"
PC="$REPO_DIR/scripts/pre-commit-check.sh"

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

OUT=""
run_expect() {
  local want="$1"; shift
  local desc="$1"; shift
  OUT="$(bash "$TOOL" "$@" 2>&1)"
  local got=$?
  if [ "$got" = "$want" ]; then pass "$desc (exit=$want)"
  else fail "$desc — 期望 exit=$want 实际 exit=$got"; echo "$OUT" | sed 's/^/      | /' >&2; fi
}

echo "═══════════════════════════════════════════════════════════"
echo "  D734 PR 预算门禁测试"
echo "═══════════════════════════════════════════════════════════"

echo ""
echo "── 1. 正常路径: 小写集单域 → exit 0 ──"
run_expect 0 "2 个 Mac 文件" --files "scripts/control-tower/check-pr-budget.sh tests/control-tower/check-pr-budget.test.sh"
if echo "$OUT" | grep -q "✅ ② 变更单域"; then pass "单域判定输出点名"; else fail "单域判定未点名"; fi

echo ""
echo "── 2. 超预算: 文件数 > 上限 → exit 1 ──"
run_expect 1 "13 文件 > 默认 12" --files "a1.ts a2.ts a3.ts a4.ts a5.ts a6.ts a7.ts a8.ts a9.ts a10.ts a11.ts a12.ts a13.ts"
if echo "$OUT" | grep -q "拆 PR"; then pass "超限输出点名「拆 PR」"; else fail "超限未点名拆 PR"; fi
if echo "$OUT" | grep -q "禁调高上限"; then pass "输出禁调高上限"; else fail "未出现禁调高上限"; fi
run_expect 0 "--max-files 20 时同写集放行" --max-files 20 --files "a1.ts a2.ts a3.ts a4.ts a5.ts a6.ts a7.ts a8.ts a9.ts a10.ts a11.ts a12.ts a13.ts"

echo ""
echo "── 3. 跨域: 变更落两个域 → exit 1 ──"
run_expect 1 "Mac 脚本 + Win src 混合" --files "scripts/control-tower/check-pr-budget.sh src/server.ts"
if echo "$OUT" | grep -q "变更跨域"; then pass "跨域输出点名"; else fail "跨域未点名"; fi
# 域判定豁免: bypass.log（各线都写的簿记）不应把单域 PR 误判成跨域
run_expect 0 "bypass.log 豁免后仍单域" --files ".claude/bypass.log scripts/control-tower/check-pr-budget.sh"
# D758: PR #538 实测形态——Win 的 1-5 双引导 + 它自己的验收证据，曾被判跨域卡死
run_expect 0 "D758 证据目录豁免: Win 代码 + 自己的验收证据 → 单域" --files "docs/synova/product-lines/evidence/D716-win-20260913/1-5-dual-guide-win-evidence.txt src/server.ts tests/routes/setup-guide-retired.test.ts"
run_expect 1 "D758 豁免不掩盖真跨域（证据 + Win 代码 + Mac 脚本）" --files "docs/synova/product-lines/evidence/D716-win-20260913/x.txt src/server.ts scripts/control-tower/check-pr-budget.sh"

echo ""
echo "── 4. 边界 ──"
run_expect 0 "0 文件（空写集）" --files ""
run_expect 0 "恰好等于上限" --max-files 2 --files "scripts/control-tower/check-pr-budget.sh tests/control-tower/check-pr-budget.test.sh"
run_expect 1 "上限 1、写集 2" --max-files 1 --files "scripts/control-tower/check-pr-budget.sh tests/control-tower/check-pr-budget.test.sh"

echo ""
echo "── 5. 降级: 基线全链不可解析 → 显式留痕 + exit 0（不误红）──"
# 沙箱用 trunk 而非 main：确保 origin/main / main / origin/HEAD 全链均不存在，才走降级分支
SB="$TMPD/sandbox-repo"
mkdir -p "$SB"
git -C "$SB" init -q -b trunk
git -C "$SB" -c user.name=t -c user.email=t@t commit -q --allow-empty -m c1
OUT="$(cd "$SB" && bash "$TOOL" 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "无任何基线的仓库 → exit 0" || fail "无基线仓库 — 期望 0 实际 $_e"
if echo "$OUT" | grep -q "degraded: 基线不可解析"; then pass "降级明示「基线不可解析」（不静默）"; else fail "降级未明示"; fi
if echo "$OUT" | grep -q "不静默放过"; then pass "降级说明不静默放过"; else fail "降级说明缺失"; fi

echo ""
echo "── 6. 检查失败: 域校验器缺失 → exit 2（fail-closed）──"
mkdir -p "$TMPD/nochecker"
cp "$TOOL" "$TMPD/nochecker/check-pr-budget.sh"
OUT="$(bash "$TMPD/nochecker/check-pr-budget.sh" --files "scripts/control-tower/check-pr-budget.sh" 2>&1)"; _e=$?
[ "$_e" = 2 ] && pass "缺 check-ownership.py → exit 2" || fail "缺域校验器 — 期望 2 实际 $_e"
if echo "$OUT" | grep -q "域校验器缺失"; then pass "缺口点名「域校验器缺失」"; else fail "缺口未点名"; fi

echo ""
echo "── 7. 落后基线: 沙箱仓库真落后 → ⚠️ 告警但 exit 0 ──"
SB2="$TMPD/behind-repo"
mkdir -p "$SB2"
git -C "$SB2" init -q -b main
git -C "$SB2" -c user.name=t -c user.email=t@t commit -q --allow-empty -m c1
git -C "$SB2" checkout -q -b feat
git -C "$SB2" checkout -q main
git -C "$SB2" -c user.name=t -c user.email=t@t commit -q --allow-empty -m c2
git -C "$SB2" checkout -q feat
OUT="$(cd "$SB2" && bash "$TOOL" --base main --max-behind 0 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "落后但未超文件/域预算 → exit 0（落后不阻断）" || fail "落后分支 — 期望 0 实际 $_e"
if echo "$OUT" | grep -q "③ 分支落后"; then pass "落后告警输出点名"; else fail "落后告警未点名"; fi

echo ""
echo "── 9. D860 治理产物豁免: 不计入 ≤12 预算 ──"
# #657/#693 实测形态: 12 交付文件 + 治理产物上枝 → 13/14 件被拦（F9/F12）
run_expect 0 "12 交付文件 + brief/卡/Note/规格 各 1 → 豁免 4 件后 12 计数放行" --files "task-state/D999.json .claude/task-briefs/brief.md memory/notes/implemented/note.md docs/plans/spec.md scripts/control-tower/check-pr-budget.sh tests/control-tower/check-pr-budget.test.sh scripts/control-tower/a3.sh scripts/control-tower/a4.sh scripts/control-tower/a5.sh scripts/control-tower/a6.sh scripts/control-tower/a7.sh scripts/control-tower/a8.sh scripts/control-tower/a9.sh scripts/control-tower/a10.sh"
if echo "$OUT" | grep -q "D860 治理产物豁免: 4 件"; then pass "豁免件数点名（可见，不静默）"; else fail "豁免行未输出"; fi
run_expect 0 "memory/notes yaml 也豁免" --files "memory/notes/proposed/d.yaml scripts/control-tower/check-pr-budget.sh"
run_expect 0 "自验证据目录豁免（docs/synova/product-lines/evidence/）" --files "docs/synova/product-lines/evidence/D860-20260921/a.txt scripts/control-tower/check-pr-budget.sh"

echo ""
echo "── 10. D860 反例: 伪装成治理产物的代码必须仍被计数 ──"
run_expect 1 "13 件纯代码仍被拦（豁免不放宽真代码）" --files "a1.ts a2.ts a3.ts a4.ts a5.ts a6.ts a7.ts a8.ts a9.ts a10.ts a11.ts a12.ts a13.ts"
run_expect 1 "反例: task-state/evil.ts（代码伪装进治理前缀）→ 仍计数 13 > 12" --files "task-state/evil.ts a1.ts a2.ts a3.ts a4.ts a5.ts a6.ts a7.ts a8.ts a9.ts a10.ts a11.ts a12.ts"
if echo "$OUT" | grep -q "13 > 上限 12"; then pass "反例计数点名 13"; else fail "反例计数未点名"; fi
run_expect 1 "反例: .claude/task-briefs/evil.sh 仍计数" --files ".claude/task-briefs/evil.sh a1.ts a2.ts a3.ts a4.ts a5.ts a6.ts a7.ts a8.ts a9.ts a10.ts a11.ts a12.ts"

echo ""
echo "── 11. CT-D 豁免粒度: 目录级豁免逐条可核 + 数量阈值 ──"
# 粒度①: 每个豁免路径逐行打印（原实现只给一个计数 ⇒ 豁免了哪些文件不可核）
run_expect 0 "CT-D① 治理豁免 + evidence 豁免混排" --files "task-state/D999.json docs/synova/product-lines/evidence/CT9-a.md scripts/control-tower/check-pr-budget.sh"
echo "$OUT" | grep -q "· task-state/D999.json" && pass "CT-D① 逐条打印治理豁免路径" || fail "CT-D① 未逐条打印豁免路径"
echo "$OUT" | grep -q "CT9-a.md" && pass "CT-D① 逐条打印 evidence 豁免路径" || fail "CT-D① 未打印 evidence 豁免路径"
echo "$OUT" | grep -q "目录级豁免 docs/synova/product-lines/evidence/" && pass "CT-D① 明示「目录级豁免」来源" || fail "CT-D① 未明示目录级豁免来源"

# 粒度②: evidence 目录豁免件数上限 = --max-files（不引入新魔数）
EV12=""; for _i in $(seq 1 12); do EV12="$EV12 docs/synova/product-lines/evidence/x$_i.txt"; done
EV13="$EV12 docs/synova/product-lines/evidence/x13.txt"
run_expect 0 "CT-D② 12 件 evidence（恰在上限）→ 不报超阈值" --files "$EV12 scripts/control-tower/check-pr-budget.sh"
echo "$OUT" | grep -q "CT-D evidence 目录级豁免超阈值" && fail "CT-D② 恰在上限内误报超阈值" || pass "CT-D② 恰在上限内不告警"
run_expect 0 "CT-D② 13 件 evidence + 1 脚本 → 超出 1 件计入预算（仍 ≤12）" --files "$EV13 scripts/control-tower/check-pr-budget.sh"
echo "$OUT" | grep -q "共 13 件 > 上限 12 件" && pass "CT-D② 超阈值口径点名（共 N 件 / 上限）" || fail "CT-D② 超阈值未点名"
echo "$OUT" | grep -q "x13.txt" && pass "CT-D② 逐条点名被计入预算的文件" || fail "CT-D② 未点名被计入的文件"
echo "$OUT" | grep -q "✅ ① 变更文件数 2 " && pass "CT-D② 计数正确（13 豁免 12 + 超阈值 1 + 脚本 1 = 2 计入）" || fail "CT-D② 计数不符: $(echo "$OUT" | grep -a '① 变更文件数' )"

# 粒度② 判别性: 13 件 evidence + 12 件代码 —— 超出的 1 件真进预算 ⇒ 13 > 12 判红。
#   去掉阈值（= 原实现的无界目录级豁免）时这里是 12 ≤ 12 **假绿**（见证据文件改前/改后对照）。
C12=""; for _i in $(seq 1 12); do C12="$C12 scripts/control-tower/z$_i.sh"; done
run_expect 1 "CT-D② 13 evidence + 12 代码 → 超出件计入后 13 > 上限 12 判红" --files "$EV13 $C12"
echo "$OUT" | grep -q "13 > 上限 12" && pass "CT-D② 判红口径点名 13 > 12" || fail "CT-D② 判红口径未点名"
run_expect 0 "CT-D② 反例: 12 evidence + 12 代码 → 仍在预算（阈值不误拦）" --files "$EV12 $C12"

echo ""
echo "── 8. 接线（铁律 0-2 WIRE CHECK）──"
if grep -q "check-pr-budget.sh" "$PC"; then pass "接线: pre-commit-check.sh 真调用本脚本"; else fail "接线: pre-commit 未调用本脚本（死代码）"; fi
# 本任务不并组数：横幅语义必须保持原样（改则打破 fastlane-bypass-only.test.sh 断言）
if grep -q "跳过 12 组" "$PC"; then pass "组数横幅未改（快速通道仍为「跳过 12 组」）"; else fail "快速通道横幅被改动 → 会打破白名单外的 fastlane 测试"; fi
if grep -q "全部 13 组通过" "$PC"; then pass "总结横幅仍为 13 组（未并组）"; else fail "总结横幅组数被改"; fi

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ 全部通过: $PASS 项"
  echo "═══════════════════════════════════════════════════════════"
  exit 0
else
  echo "  ❌ $FAIL 项失败 / $PASS 项通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
