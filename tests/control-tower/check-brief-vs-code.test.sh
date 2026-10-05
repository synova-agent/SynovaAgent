#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-brief-vs-code.test.sh — D962-B2 workflow 真身测试（U7/CT-40 配对；
# 根目录死副本已退役，merge-base 修复已移植本真身——ci-ratchet-base ⑨ 同源断言）
#
# 覆盖（铁律 48）: 正常（merge-base 基准存在）/ 边界（origin/main 不可用回退可见）/
# 降级（无 brief 跳过不误杀）/ 接线（ci.yml checker-review 调用 + resolve-commit-brief 依赖）。
# 平台中立: UTF-8 头块 / 无 sed -i / 无 grep -P / PYBIN 三级探测。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
GATE="$REPO_DIR/scripts/workflow/check-brief-vs-code.sh"
PYBIN=""
for _c in python3 python "$(command -v py 2>/dev/null || true)"; do
  command -v "$_c" >/dev/null 2>&1 && PYBIN="$_c" && break
done
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

echo "═══════════════════════════════════════════════════════════"
echo "  D962 check-brief-vs-code 真身测试 (PYBIN=$PYBIN)"
echo "═══════════════════════════════════════════════════════════"

# 1. 正常: merge-base 三点差基准存在（D962-B2 自根副本移植，防合并提交误判越界）
if grep -q 'merge-base refs/remotes/origin/main HEAD' "$GATE"; then pass "merge-base 基准存在"; else fail "merge-base 基准缺失（修复回退）"; fi
if grep -q 'DIFF_ALL=$(git diff --name-only "$DIFF_BASE"\.\.HEAD' "$GATE"; then pass "主路径三点差（基准变量..HEAD）"; else fail "主路径非三点差"; fi
# 2. 边界: origin/main 不可用 → 显式回退提示（降级可见，铁律 11）
if grep -q 'origin/main 不可用' "$GATE"; then pass "回退路径显式提示"; else fail "回退静默"; fi
# 3. 降级: 运行不裸崩（无 staged 场景下 brief 解析决定 exit 0/跳过 或对既有 brief 判定 1——
#    两者均为合法判定；断言不出现语法错误/崩溃形态）
OUT=$(bash "$GATE" 2>&1) && RC=0 || RC=$?
if [ "$RC" -eq 0 ] || [ "$RC" -eq 1 ]; then pass "运行不裸崩 exit=${RC} 0=跳过或通过 1=对解析到的 brief 判定"; else fail "运行异常 rc=${RC}"; fi
if echo "$OUT" | grep -qE "syntax|unexpected|command not found"; then fail "输出含崩溃形态"; else pass "无崩溃形态输出"; fi
# 4. 接线: CI checker-review 调用真身 + 根副本已退役
if grep -q "scripts/workflow/check-brief-vs-code.sh" "$REPO_DIR/.github/workflows/ci.yml"; then pass "ci.yml 接线真身"; else fail "CI 接线断"; fi
if [ ! -f "$REPO_DIR/scripts/check-brief-vs-code.sh" ]; then pass "根目录死副本已退役"; else fail "根副本残留"; fi
# 5. CI 范围源并入 ACTUAL_FILES（D962-B2 移植块的接线）
if grep -q "ACTUAL_FILES_CI" "$GATE" && grep -q 'ACTUAL_FILES=\$(echo -e "\${ACTUAL_FILES_STAGED}' "$GATE"; then pass "CI 范围源并入判定"; else fail "CI 范围源未接线"; fi

echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
