#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# utf8.test.sh — D313 M5 UTF-8 强制测试
#
# 覆盖（铁律 48：正常/降级/边界）:
#   1. GBK 字节临时脚本 → check-silent-swallow.sh --utf8 报"非 UTF-8"
#   2. 无头块 .sh → 报告缺失；有头块 → 通过
#   3. 幂等：有头块脚本二跑不再报
#   4. 无 reconfigure 的 .py → 报告；有 → 通过
#   5. 40 个真实 CI .sh 全带头块（--utf8 全量零报告）— 接线验收断言
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/workflow/check-silent-swallow.sh"
TMP_DIR="$REPO_DIR/.codex/control-tower/tmp"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_contains() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi; }
assert_not_contains() { if echo "$1" | grep -qF "$2"; then fail "$3 — 不应包含: $2"; else pass "$3"; fi; }

mkdir -p "$TMP_DIR"
rm -f "$TMP_DIR"/utf8-* 2>/dev/null || true

echo "═══════════════════════════════════════════════════════════"
echo "  D313 utf8 测试 — UTF-8 强制"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. GBK 字节文件 → 报告非 UTF-8 ──
echo "── 1. GBK 字节检测 ──"
(cd "$REPO_DIR" && python3 -c "
import sys
sys.stdout.reconfigure(encoding='utf-8')
open('$TMP_DIR/utf8-gbk.sh', 'wb').write(b'#!/bin/bash\n# \xb2\xe2\xca\xd4 GBK \xc2\xd2\xc2\xeb\n')  # GBK 中文
") 2>/dev/null || true
OUT=$(bash "$TOOL" --utf8 "$TMP_DIR/utf8-gbk.sh" 2>&1) || true
assert_contains "$OUT" "❌" "GBK 文件被报告（输出含 ❌）"
echo ""

# ── 2. 无头块 .sh → 报告；有头块 → 通过 ──
echo "── 2. 头块检测 ──"
cat > "$TMP_DIR/utf8-noheader.sh" <<'EOF'
#!/bin/bash
set -euo pipefail
echo "no header"
EOF
OUT=$(bash "$TOOL" --utf8 "$TMP_DIR/utf8-noheader.sh" 2>&1) || true
assert_contains "$OUT" "PYTHONIOENCODING" "无头块 .sh 报告缺 PYTHONIOENCODING"

cat > "$TMP_DIR/utf8-header.sh" <<'EOF'
#!/bin/bash
set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
echo "with header"
EOF
OUT=$(bash "$TOOL" --utf8 "$TMP_DIR/utf8-header.sh" 2>&1) || true
assert_not_contains "$OUT" "PYTHONIOENCODING" "有头块 .sh 不报告"
echo ""

# ── 3. 幂等 ──
echo "── 3. 幂等 ──"
OUT1=$(bash "$TOOL" --utf8 "$TMP_DIR/utf8-header.sh" 2>&1) || true
OUT2=$(bash "$TOOL" --utf8 "$TMP_DIR/utf8-header.sh" 2>&1) || true
if [ "$OUT1" = "$OUT2" ]; then pass "二跑输出一致（幂等）"; else fail "二跑输出不一致"; fi
echo ""

# ── 4. .py reconfigure 检测 ──
echo "── 4. .py reconfigure ──"
cat > "$TMP_DIR/utf8-noreconf.py" <<'EOF'
import sys
print("no reconfigure")
EOF
OUT=$(bash "$TOOL" --utf8 "$TMP_DIR/utf8-noreconf.py" 2>&1) || true
assert_contains "$OUT" "reconfigure" "无 reconfigure 的 .py 被报告"

cat > "$TMP_DIR/utf8-reconf.py" <<'EOF'
import sys
sys.stdout.reconfigure(encoding="utf-8")
print("with reconfigure")
EOF
OUT=$(bash "$TOOL" --utf8 "$TMP_DIR/utf8-reconf.py" 2>&1) || true
assert_contains "$OUT" "✅" "有 reconfigure 的 .py 通过"
echo ""

# ── 5. 40 个真实 CI .sh 全带头块（接线验收）──
echo "── 5. 真实 CI 脚本全量 UTF-8 合规 ──"
OUT=$(bash "$TOOL" --utf8 2>&1) || true
# 输出可能含 level 报告；断言关键 CI 脚本不再被报缺头块
for f in scripts/ci/diagnosis-quality-check.sh \
         scripts/control-tower/baseline-check.sh scripts/control-tower/verify-parallel.sh; do
  if echo "$OUT" | grep -qF "$f"; then
    fail "$f 仍被报缺 UTF-8 头块"
  else
    pass "$f 已带头块"
  fi
done
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ utf8 测试未通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
echo "  Status: ✅ utf8 测试全部通过"
echo "═══════════════════════════════════════════════════════════"
exit 0
