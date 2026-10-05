#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# loop-score.test.sh — D962-B2 loop-score 测试（U7/CT-40 配对）
#
# 背景: D962-B2 移除 check-deprecated-mapping / check-boundaries-incremental 两个
#       存在性打分项（脚本已退役/内联）。本测试验证: 可运行 / 打分项与现存脚本一致 /
#       退役项不再打分（改坏即红: 若退役脚本复活或打分指向幽灵文件则红）。
# 覆盖（铁律 48）: 正常（运行输出分数）/ 边界（退役项零引用）/ 接线（现存项文件真实存在）。
# 平台中立: UTF-8 头块 / 无 sed -i / 无 grep -P / PYBIN 三级探测。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCORE="$REPO_DIR/scripts/workflow/loop-score.sh"
PYBIN=""
for _c in python3 python "$(command -v py 2>/dev/null || true)"; do
  command -v "$_c" >/dev/null 2>&1 && PYBIN="$_c" && break
done
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

echo "═══════════════════════════════════════════════════════════"
echo "  D962 loop-score 测试 (PYBIN=$PYBIN)"
echo "═══════════════════════════════════════════════════════════"

# 1. 正常: 脚本可运行且输出分数形态
OUT=$(bash "$SCORE" 2>&1) && RC=0 || RC=$?
if [ "$RC" -eq 0 ] || [ "$RC" -eq 1 ]; then pass "可运行 exit=${RC} 1=有缺项亦为合法判定"; else fail "运行异常 rc=${RC}"; fi
if echo "$OUT" | grep -qE "分|score|Safety"; then pass "输出含打分段落"; else fail "输出形态异常"; fi
# 2. 边界: 退役脚本不再被打分引用（幽灵打分项 = 改坏即红）
if grep -q "check-deprecated-mapping.sh 存在" "$SCORE"; then fail "退役脚本 deprecated-mapping 仍被打分"; else pass "deprecated-mapping 打分项已移除"; fi
if grep -q "check-boundaries-incremental.sh 存在" "$SCORE"; then fail "退役脚本 boundaries-incremental 仍被打分"; else pass "boundaries-incremental 打分项已移除"; fi
# 3. 接线: 现存打分项指向的文件真实存在（防幽灵打分满分假绿）
_ghost=0
for f in $(grep -oE "\\$ROOT/scripts/[a-zA-Z0-9_/.-]+\\.sh" "$SCORE" | sed 's|\$ROOT/||' | sort -u); do
  if [ ! -f "$REPO_DIR/$f" ]; then echo "     幽灵打分项: $f" >&2; _ghost=$((_ghost + 1)); fi
done
if [ "$_ghost" -eq 0 ]; then pass "全部打分项目标文件真实存在"; else fail "$_ghost 个幽灵打分项"; fi

echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
