#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# g5-architecture.test.sh — D962-B2 组 5（架构边界 + 桥接文件）组级测试
#
# 覆盖矩阵（铁律 48: 正常/降级/边界 + 改坏即红正样本）:
#   正常 — 真实仓库 check-architecture.sh → exit 0（含 D752 §5 合并段全登记）
#   红   — 沙箱 L1→L3 跨层引用（SYNO_ARCH_SRC 注入缝）: SYNO_CI=1 → exit 1 且点名;
#          SYNO_CI=0 → 本地软提示 exit 0 但输出含 ❌（D515 分工）
#   降级 — SYNO_ARCH_SRC 指向不存在目录 → exit 2 fail-closed（不静默当绿）
#   边界 — 基线棘轮机制存在（存量只减不增）; LC_ALL=C 防御存在（D962-B2 教训）;
#          pre-commit V5.3 CI 区桥接判定（铁律 46 三重匹配；壳包启发式随 2a① 迁移收窄——
#          packages/ 下 engine-core 引用仍被三重匹配覆盖，纯 re-export 形态判定归 2b iron-laws）
#
# 平台中立: 无 sed -i / 无 grep -P / UTF-8 头块; PYBIN 三级探测（组 5 判定为纯
# bash+grep，PYBIN 仅备扩展位）。零真实仓库污染: 沙箱经 SYNO_ARCH_SRC 注入。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ARCH="$REPO_DIR/scripts/check-architecture.sh"
PRE_COMMIT="$REPO_DIR/scripts/pre-commit-check.sh"
TMP_DIR="$(mktemp -d /tmp/g5-arch-tests.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

# PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）
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
echo "  D962 组 5 组级测试: 架构边界 + 桥接文件"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "── 1. 正常路径: 真实仓库 → exit 0 ──"
OUT=$("$PYBIN" -c "print('py-ok')" >/dev/null 2>&1 && echo "PYBIN=$PYBIN 可用" || echo "PYBIN 降级（纯 bash 判定不受影响）")
pass "$OUT"
(cd "$REPO_DIR" && bash "$ARCH" >/dev/null 2>&1)
_rc=$?
if [ "$_rc" -eq 0 ]; then pass "真实仓库架构检查绿 (exit=0)"; else fail "真实仓库应 exit 0，实际 $_rc（先修存量再跑本测试）"; fi
echo ""

echo "── 2. 红分支: 沙箱 L1→L3 跨层引用（改坏即红正样本）──"
mkdir -p "$TMP_DIR/src/routes" "$TMP_DIR/src/l3"
cat > "$TMP_DIR/src/routes/bad-l1.ts" <<'EOF'
import { dispatch } from '../l3/expert-dispatcher';
export const x = dispatch;
EOF
# 本地模式（SYNO_CI=0）: 软提示不阻断
OUT=$(cd "$REPO_DIR" && SYNO_ARCH_SRC="$TMP_DIR/src" SYNO_ARCH_BASELINE=/dev/null bash "$ARCH" 2>&1) && RC=0 || RC=$?
assert_exit "$RC" 0 "本地模式软提示不阻断（exit 0，D515 分工）"
assert_contains "$OUT" "L1→L3" "违规被点名（L1→L3）"
# CI strict（SYNO_CI=1）: 转硬
OUT=$(cd "$REPO_DIR" && SYNO_CI=1 SYNO_ARCH_SRC="$TMP_DIR/src" SYNO_ARCH_BASELINE=/dev/null bash "$ARCH" 2>&1) && RC=0 || RC=$?
assert_exit "$RC" 1 "CI strict 转硬阻断（exit 1）"
assert_contains "$OUT" "bad-l1.ts" "违规文件被点名"
echo ""

echo "── 3. 降级路径: 扫描源缺失 → exit 2 fail-closed ──"
OUT=$(cd "$REPO_DIR" && SYNO_ARCH_SRC="$TMP_DIR/nonexistent-src" bash "$ARCH" 2>&1) && RC=0 || RC=$?
assert_exit "$RC" 2 "扫描源缺失降级退出（不静默当绿）"
assert_contains "$OUT" "fail-closed" "降级原因显式输出"
echo ""

echo "── 4. 边界 + 改坏即红结构断言 ──"
# 4a. 基线棘轮机制（存量只减不增）
if grep -q "SYNO_ARCH_BASELINE" "$ARCH" && grep -qE "NEW|compare_baseline|基线" "$ARCH"; then
  pass "基线棘轮机制存在（存量豁免/新增拦截）"
else
  fail "基线棘轮机制缺失"
fi
# 4b. import 三形态锚定（动态 import 逃逸修补，CT-64 ①）
if grep -qE "import\\(|require\\(" "$ARCH"; then pass "动态 import/require 锚定存在（CT-64 ①）"; else fail "动态 import 锚定缺失（修补①回退）"; fi
# 4c. D752 合并段（D962-B2: 自 check-sentinel-type-net.sh 迁入）
if grep -q "SYNO_TYPE_NET_ROOT" "$ARCH" && grep -q "D752" "$ARCH"; then pass "D752 哨兵类型网段已合并（注入缝+判定体）"; else fail "D752 合并段缺失"; fi
# 4d. LC_ALL=C 防御（D962-B2 教训: macOS bash 3.2 多字节解析假红）
if grep -q "export LC_ALL=C" "$ARCH"; then pass "LC_ALL=C 防御存在（BSD bash 3.2 假红防线）"; else fail "LC_ALL=C 防御缺失（unbound variable 假红风险）"; fi
# 4e. pre-commit V5.3 CI 区桥接判定（铁律 46 三重匹配，改坏即红；V5.3 语义同步）
if grep -qF 'packages/engine-core' "$PRE_COMMIT" && grep -qF '\.\./engine-core' "$PRE_COMMIT"; then  # -F: 判定体中为带反斜杠转义的字面模式
  pass "pre-commit CI 区铁律 46 三重匹配存在（V5.3）"
else
  fail "铁律 46 三重匹配缺失（V5.3 CI 区）"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then echo "  全部通过: $PASS ✅ / $FAIL ❌"; exit 0; else echo "  失败: $PASS ✅ / $FAIL ❌" >&2; exit 1; fi
