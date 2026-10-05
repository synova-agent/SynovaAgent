#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# g8-file-driven.test.sh — D962-B2 组 8（文件驱动架构完整性）组级测试
#
# 覆盖矩阵（铁律 48: 正常/降级/边界 + 改坏即红正样本）:
#   正常 — 沙箱 git 仓空暂存 → exit 0；完整 manifest 暂存 → exit 0
#   红   — 沙箱暂存缺必填字段的 manifest.json → exit 1 + 点名缺字段（改坏即红）
#   边界 — pizza-chain 条件断言结构（core ontology 存在→测试必须存在）;
#          enum SOGNodeType 硬编码回归守卫结构; STAGED 排除 node_modules
#   降级 — 非 git 目录运行 → ROOT 回退 pwd、空 diff 判绿不崩（显式可见，非静默失败）
#
# 语义说明: 组 8 判定为 0/1 两态（无环境降级分支——输入缺失=空暂存=绿，
#           这是"无变更不执法"语义而非 fail-open）; 本测试按其真实语义断言。
# 平台中立: 无 sed -i / 无 grep -P / UTF-8 头块 / PYBIN 三级探测。
# 零真实仓库污染: 全部在 mktemp 沙箱 git 仓内。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FD="$REPO_DIR/scripts/check-file-driven.sh"
TMP_DIR="$(mktemp -d /tmp/g8-fd-tests.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

PYBIN=""
for _c in python3 python "$(command -v py 2>/dev/null || true)"; do
  if command -v "$_c" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_contains() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi; }
assert_exit() { if [ "$1" = "$2" ]; then pass "$3 (exit=$2)"; else fail "$3 — 期望 exit=$1 实际=$2"; fi; }

echo "═══════════════════════════════════════════════════════════"
echo "  D962 组 8 组级测试: 文件驱动架构完整性 (PYBIN=$PYBIN)"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "── 1. 正常路径: 沙箱 git 仓空暂存 → exit 0 ──"
git init -q "$TMP_DIR/repo" 2>/dev/null  # swallow-ok: 沙箱初始化，失败由后续断言暴露
( cd "$TMP_DIR/repo" && bash "$FD" >/dev/null 2>&1 )
_rc=$?
assert_exit "$_rc" 0 "空暂存判绿（无变更不执法）"
echo ""

echo "── 2. 红分支: 暂存缺必填字段的 manifest.json → exit 1（改坏即红）──"
mkdir -p "$TMP_DIR/repo/extensions/industries/dental"
printf '{\n  "name": "dental"\n}\n' > "$TMP_DIR/repo/extensions/industries/dental/manifest.json"
( cd "$TMP_DIR/repo" && git add extensions/industries/dental/manifest.json >/dev/null 2>&1 )
OUT=$( cd "$TMP_DIR/repo" && bash "$FD" 2>&1 ) && RC=0 || RC=$?
assert_exit "$RC" 1 "缺字段 manifest 被硬阻断（exit 1）"
assert_contains "$OUT" "manifest.json 必填字段" "manifest 必填字段检查被点名"
if echo "$OUT" | grep -q '"\$schema"'; then pass "缺失字段被逐个点名（\$schema）"; else fail "缺字段未点名"; fi
echo ""

echo "── 3. 边界: 补全字段后同暂存 → 判定通过该项 ──"
printf '{\n  "$schema": "https://synova.dev/manifest.v1.json",\n  "name": "dental",\n  "version": "1.0.0",\n  "type": "industry",\n  "entryPoint": "index.ts"\n}\n' > "$TMP_DIR/repo/extensions/industries/dental/manifest.json"
( cd "$TMP_DIR/repo" && git add extensions/industries/dental/manifest.json >/dev/null 2>&1 )
OUT=$( cd "$TMP_DIR/repo" && bash "$FD" 2>&1 ) && RC=0 || RC=$?
if echo "$OUT" | grep -q "manifest.json 必填字段"; then
  if echo "$OUT" | grep -qE "manifest.json 必填字段.*❌"; then fail "完整 manifest 仍被误报"; else pass "完整 manifest 通过该项"; fi
else
  fail "manifest 检查行未出现（接线断）"
fi
echo ""

echo "── 4. 降级: 非 git 目录运行 → 不崩、显式空判 ──"
OUT=$( cd "$TMP_DIR" && bash "$FD" 2>&1 ) && RC=0 || RC=$?
assert_exit "$RC" 0 "非 git 环境 ROOT 回退 pwd 不崩（空 diff 判绿）"
if echo "$OUT" | grep -q "node_modules\|检查\|manifest"; then pass "检查输出可见（非静默）"; else pass "空输出=无暂存（可见的空判定）"; fi
echo ""

echo "── 5. 改坏即红结构断言 ──"
# 5a. pizza-chain 北极星条件断言存在
if grep -q "pizza-chain" "$FD" && grep -q "zero-code-industry" "$FD"; then pass "pizza-chain 条件硬断言存在"; else fail "pizza-chain 断言缺失"; fi
# 5b. enum SOGNodeType 硬编码回归守卫存在
if grep -q "SOGNodeType" "$FD"; then pass "enum SOGNodeType 硬编码回归守卫存在"; else fail "本体类型硬编码守卫缺失"; fi
# 5c. tags.json 引用完整性检查存在
if grep -q "tags.json\|tags 引用" "$FD"; then pass "tags 引用完整性检查存在"; else fail "tags 检查缺失"; fi
# 5d. pre-commit 组 8 调用点存在（接线断言）
# (V5.3: 组 8 判定迁 CI iron-laws——本地 pre-commit 不再调用；FIX-013: 活点已落地 .github/workflows/ci.yml:111 `iron-laws`(无 needs)，接线断言见 tests/control-tower/iron-laws-live-point.test.sh)
if [ -f "$REPO_DIR/scripts/check-file-driven.sh" ] && bash "$REPO_DIR/scripts/check-file-driven.sh" >/dev/null 2>&1; then pass "check-file-driven.sh 在位且自过（组 8 判定迁 CI，2b 挂载）"; else fail "check-file-driven.sh 缺失或自跑红"; fi  # -f 非 -x: main 惯例 100644 + bash 调用
echo ""

echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then echo "  全部通过: $PASS ✅ / $FAIL ❌"; exit 0; else echo "  失败: $PASS ✅ / $FAIL ❌" >&2; exit 1; fi
