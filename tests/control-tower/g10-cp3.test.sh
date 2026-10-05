#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# g10-cp3.test.sh — D962-B2 组 10（V3 CP3 流水线健康度 D260）组级测试
# (D962 2a① V5.3 更新: CHANGED_FILES/STAGED_FILES 死分支已修活（赋值=GIT_CACHED_ALL_NAMES）
#  ——原"死分支现状快照"绊线删除，替换为真实红分支行为断言（首次可测 G10/G11 判定本体）。)
#
# 覆盖（铁律 48: 正常/降级/边界 + 改坏即红）:
#   正常 — 无 brief 变更 → G10/G11 跳过路径可观测
#   红   — 注入 brief(#CRITERIA: B) + 范围外暂存文件 → G10 条件区域不匹配 warn 实报;
#          brief 声明端到端验收 + 无测试文件 → G11 warn 实报（死分支修活后的首测）
#   边界 — criteria-code-map 缺失路径守卫存在; SYNO_CI=1 时 warn_check 转硬
#   降级 — 注入缝三态（SYNO_TEST_ARM=1 武装）
# 平台中立: UTF-8 头块 / 无 sed -i / 无 grep -P / PYBIN 三级探测（V5.3 已全局 PYBIN）。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRE_COMMIT="$REPO_DIR/scripts/pre-commit-check.sh"
PYBIN=""
for _c in python3 python "$(command -v py 2>/dev/null || true)"; do
  command -v "$_c" >/dev/null 2>&1 && PYBIN="$_c" && break
done
if ! command -v python >/dev/null 2>&1; then  # 兼容判定体 PYBIN 调用（V5.3 已全局探测，shim 兜底）
  TMP_SHIM="$(mktemp -d)"; printf '#!/bin/sh\nexec %s "$@"\n' "$PYBIN" > "$TMP_SHIM/python"; chmod +x "$TMP_SHIM/python"
else
  TMP_SHIM=""
fi
cleanup() { [ -n "$TMP_SHIM" ] && rm -rf "$TMP_SHIM"; rm -f "$REPO_DIR/.claude/task-briefs/2026-09-25-g10-probe.md"; }
trap cleanup EXIT
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

run_pc() { # $1=暂存清单(换行分隔) $2=CI(0/1)
  ( cd "$REPO_DIR" && PATH="${TMP_SHIM:+$TMP_SHIM:}${PATH:-/usr/bin:/bin}" \
    SYNO_GATEKEEPER_ACK=1 SYNO_TEST_ARM=1 SYNO_CI="$2" \
    SYNO_GIT_CACHED_NAMES="$1" SYNO_GIT_CACHED_ALL_NAMES="$1" SYNO_GIT_CACHED_ADDED_NAMES="" \
    SYNO_GIT_CACHED_DIFF="+x" SYNO_GATE_HITS_LOG=/dev/null bash "$PRE_COMMIT" 2>&1 ) || true
}

echo "═══════════════════════════════════════════════════════════"
echo "  D962 组 10 组级测试: V3 CP3（死分支修活后真判定）(PYBIN=$PYBIN)"
echo "═══════════════════════════════════════════════════════════"

echo "── 1. 正常: 无 brief 变更 → 跳过可观测 ──"
OUT=$(run_pc "src/g10-probe.ts" 0)
echo "$OUT" | grep -qE "G10.*(跳过|无 task brief)" && pass "G10 跳过路径可观测" || fail "G10 跳过不可见"
echo "$OUT" | grep -qE "G11.*(跳过|不存在)" && pass "G11 跳过路径可观测" || fail "G11 跳过不可见"
echo ""

echo "── 2. 红分支 A: brief(#CRITERIA: B) + 范围外文件 → G10 实报 ──"
mkdir -p "$REPO_DIR/.claude/task-briefs"
printf '## Q2: src/inside.ts\n#CRITERIA: B\n## Q3: 端到端验收\n' > "$REPO_DIR/.claude/task-briefs/2026-09-25-g10-probe.md"
OUT=$(run_pc "src/outside-g10.ts
.claude/task-briefs/2026-09-25-g10-probe.md" 0)
if echo "$OUT" | grep -q "G10: 条件区域不匹配"; then
  pass "G10 条件区域不匹配实报（死分支修活首证）"
  echo "$OUT" | grep -q "outside-g10.ts" && pass "越界文件被点名" || fail "越界文件未点名"
else
  fail "G10 红分支未触发（死分支回归或映射缺失）"
fi
echo ""

echo "── 3. 红分支 B: 端到端验收 + 无测试 → G11 实报 + CI 转硬 ──"
OUT=$(run_pc ".claude/task-briefs/2026-09-25-g10-probe.md
src/plain.ts" 0)
echo "$OUT" | grep -q "G11: 声明端到端验收但无测试文件" && pass "G11 warn 实报（本地警告语义）" || fail "G11 红分支未触发"
OUT=$(run_pc ".claude/task-briefs/2026-09-25-g10-probe.md
src/plain.ts" 1)
if echo "$OUT" | grep -q "G11: 声明端到端验收但无测试文件.*CI strict"; then
  pass "G11 CI strict 转硬（❌ 可见）"
elif echo "$OUT" | grep -q "提交已拒绝"; then
  pass "G11 CI strict 拦截（exit 1 兜底证据）"
else
  fail "G11 CI 转硬未见"
fi
echo ""

echo "── 4. 边界 + 改坏即红结构断言 ──"
grep -q 'CHANGED_FILES="\$GIT_CACHED_ALL_NAMES"' "$PRE_COMMIT" && pass "死分支修复赋值存在（CHANGED_FILES）" || fail "CHANGED_FILES 赋值缺失（死分支回归）"
grep -q 'STAGED_FILES="\$GIT_CACHED_ALL_NAMES"' "$PRE_COMMIT" && pass "STAGED_FILES 赋值存在" || fail "STAGED_FILES 赋值缺失"
grep -q "#CRITERIA" "$PRE_COMMIT" && pass "CRITERIA 提取判定体存在" || fail "判定体缺失"
grep -q "criteria-code-map.json" "$PRE_COMMIT" && pass "criteria-map 数据源引用存在" || fail "数据源引用缺失"
grep -qE "warn_check \"G11" "$PRE_COMMIT" && pass "G11 warn 语义存在" || fail "G11 语义缺失"
grep -q "SYNO_CI" "$PRE_COMMIT" && pass "SYNO_CI 软转硬机制存在" || fail "软转硬缺失"
# CP3 检查点三态（原 || true 吞错已改显式降级）
grep -q "CP3 检查点写入失败 — 降级登记" "$PRE_COMMIT" && pass "CP3 写失败显式降级（原 ||true 已灭）" || fail "CP3 降级路径缺失"
grep -qE "cp3-commit-check.*\|\| true" "$PRE_COMMIT" && fail "CP3 仍有 || true 吞错" || pass "CP3 零 || true"

echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
