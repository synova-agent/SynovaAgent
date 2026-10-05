#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-sentinel-type-net.test.sh — D752 哨兵类型网硬门禁测试
#
# 覆盖 (铁律 48: 正常/降级/边界):
#   1. 正常路径 — 真实仓库（补登记后）→ exit 0 + 全登记计数
#   2. 红分支 — 沙箱缺登记 → exit 1 + 逐个点名（业务阻断语义）
#   3. 豁免边界 — _ 前缀归档目录（_extinct 等）+ shared + 非目录条目不点名
#   4. 降级路径 — 哨兵目录缺失 → exit 2 fail-closed（不静默当绿）
#
# 零真实仓库污染: 红分支用临时沙箱根（SYNO_TYPE_NET_ROOT 注入缝）。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# (D962-B2: 判定逻辑已合并入 scripts/check-architecture.sh §5，原独立脚本退役；
#  SYNO_TYPE_NET_ROOT 注入缝原样保留，其余架构段落不受注入影响——沙箱仅作用于 §5)
TOOL="$REPO_DIR/scripts/check-architecture.sh"
TMP_DIR="$(mktemp -d /tmp/d752-type-net-tests.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_contains() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi; }
assert_exit() { if [ "$1" = "$2" ]; then pass "$3 (exit=$2)"; else fail "$3 — 期望 exit=$1 实际=$2"; fi; }

echo "═══════════════════════════════════════════════════════════"
echo "  D752 check-sentinel-type-net 门禁测试"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "── 1. 正常路径: 真实仓库全登记 → exit 0 ──"
# pre-commit 上下文（ct-test-gate）导出 GIT_DIR/GIT_WORK_TREE 会污染脚本的
# git rev-parse --show-toplevel 解析（D521/M13 同族坑）——显式剥除，保证测真实仓库根
OUT=$(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE bash "$TOOL" 2>&1) && RC=0 || RC=$?
assert_exit "$RC" 0 "真实仓库门禁绿"
assert_contains "$OUT" "45 个活跃哨兵全部已登记" "全登记计数输出"
echo ""

echo "── 2. 红分支: 沙箱缺登记 → exit 1 + 点名 ──"
# 沙箱: 1 个已登记(alpha-ok) + 1 个未登记(beta-missing)
mkdir -p "$TMP_DIR/red/extensions/sentinels/alpha-ok" "$TMP_DIR/red/extensions/sentinels/beta-missing"
echo '{}' > "$TMP_DIR/red/extensions/sentinels/alpha-ok/manifest.json"
echo '{}' > "$TMP_DIR/red/extensions/sentinels/beta-missing/manifest.json"
mkdir -p "$TMP_DIR/red/src/sentinel"
cat > "$TMP_DIR/red/src/sentinel/types.ts" <<'EOF'
import type { alphaSentinel as _alphaCheck } from "../../extensions/sentinels/alpha-ok/aggregate";
EOF
OUT=$(SYNO_TYPE_NET_ROOT="$TMP_DIR/red" bash "$TOOL" 2>&1) && RC=0 || RC=$?
assert_exit "$RC" 1 "缺登记非零退出（业务阻断）"
assert_contains "$OUT" "beta-missing" "缺失项被点名"
if echo "$OUT" | grep -q "alpha-ok"; then fail "已登记项被误点名"; else pass "已登记项不误报"; fi
echo ""

echo "── 3. 豁免边界: _ 前缀归档 + shared + 非目录条目不参与 ──"
mkdir -p "$TMP_DIR/exempt/extensions/sentinels/alpha-ok" \
         "$TMP_DIR/exempt/extensions/sentinels/_extinct-gone" \
         "$TMP_DIR/exempt/extensions/sentinels/shared"
echo '{}' > "$TMP_DIR/exempt/extensions/sentinels/alpha-ok/manifest.json"
echo '{}' > "$TMP_DIR/exempt/extensions/sentinels/_extinct-gone/manifest.json"
echo '{}' > "$TMP_DIR/exempt/extensions/sentinels/shared/manifest.json"
echo '{}' > "$TMP_DIR/exempt/extensions/sentinels/manifest.json"  # 非目录条目
mkdir -p "$TMP_DIR/exempt/src/sentinel"
cat > "$TMP_DIR/exempt/src/sentinel/types.ts" <<'EOF'
import type { alphaSentinel as _alphaCheck } from "../../extensions/sentinels/alpha-ok/aggregate";
EOF
OUT=$(SYNO_TYPE_NET_ROOT="$TMP_DIR/exempt" bash "$TOOL" 2>&1) && RC=0 || RC=$?
assert_exit "$RC" 0 "豁免规则生效（归档/shared/非目录不要求登记）"
if echo "$OUT" | grep -qE "_extinct-gone|shared"; then fail "豁免项被误点名"; else pass "豁免项零误报"; fi
echo ""

echo "── 4. 降级路径: 哨兵目录缺失 → exit 2 fail-closed ──"
mkdir -p "$TMP_DIR/degraded/src/sentinel"
echo "import type { x } from 'y';" > "$TMP_DIR/degraded/src/sentinel/types.ts"
OUT=$(SYNO_TYPE_NET_ROOT="$TMP_DIR/degraded" bash "$TOOL" 2>&1) && RC=0 || RC=$?
assert_exit "$RC" 2 "目录缺失降级退出（不静默当绿）"
assert_contains "$OUT" "degraded" "降级原因显式输出"
echo ""

echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  全部通过: $PASS ✅ / $FAIL ❌"
  exit 0
else
  echo "  失败: $PASS ✅ / $FAIL ❌" >&2
  exit 1
fi
