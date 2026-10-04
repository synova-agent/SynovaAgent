#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# check-naming-authority.test.sh — 命名权威门禁夹具（#990 / D1142）
#
# 覆盖（铁律 48 三路径 + 反例 + 接线）:
#   正常 — informational 模式：有违规也 exit 0（**先软后硬**红线：不许一步到位设必过）
#   改坏 — C2 判别性：删掉哨兵导出（装载器推导键）⇒ C2 违规数 +1 ⇒ blocking 模式 exit 1
#   回滚 — 恢复导出 ⇒ C2 归零 ⇒ blocking 模式 exit 0
#   边界 — 扫描源缺失 ⇒ exit 2（命名检查不允许降级放行）
#   实况 — 真实仓库基线：c1=17 / c2=4 / c5=1（卡面 Done ③ 要求的今日基线）
#   接线 — 脚本可执行 + 本夹具登记 ci.yml
#
# 隔离: 全部在 mktemp 沙箱（最小 fixture 树），真实仓库只做只读 informational 跑。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/../.." && pwd)"
CHECK="$REPO_DIR/scripts/control-tower/check-naming-authority.sh"
PASS=0; FAIL=0; FAILED_NAMES=()
ok()  { echo "  ✅ $1"; PASS=$((PASS + 1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); }
degraded() { echo "degraded: $1" >&2; exit 2; }

[ -f "$CHECK" ] || degraded "被测脚本不存在: $CHECK"
[ -x "$CHECK" ] && ok "接线: 检查器可执行位已设" || bad "接线: 缺少可执行位"

SB="$(mktemp -d)"; trap 'rm -rf "$SB"' EXIT
R="$SB/root"
mkdir -p "$R/cycles" "$R/extensions/ontology/edge-types" "$R/src/sentinel/adapters" "$R/src/l4"
cat > "$R/extensions/ontology/edge-types/alpha.json" <<'EOF'
{ "$id": "edge/alpha", "label": "ALPHA" }
EOF
cat > "$R/cycles/demo.cycle.json" <<'EOF'
{
  "cycleId": "demo",
  "nodes": [ { "id": "a", "edgeRefs": ["ALPHA"] } ]
}
EOF
cat > "$R/src/sentinel/adapters/cash-flow-sentinel.ts" <<'EOF'
export const cashFlow = { config: {} };
EOF
: > "$R/src/l4/sog-schema-validator.ts"

run() { ( bash "$CHECK" --root "$R" "$@" ) 2>&1; }
rc_of() { echo "$1" >/dev/null; }

echo "═══════════════════════════════════════════════════════════"
echo "  #990 命名权威门禁夹具（被测 = 真实检查器）"
echo "═══════════════════════════════════════════════════════════"

# ── 接线 ──
grep -q 'check-naming-authority.test.sh' "$REPO_DIR/.github/workflows/ci.yml" \
  && ok "接线: 本夹具登记在 ci.yml 密封清单" || bad "接线: 本夹具未登记 ci.yml"

# ── 1. 正常: informational ⇒ 有违规也 exit 0 ──
OUT="$(run)"; RC=$?
[ "$RC" = "0" ] && ok "1 informational: 有违规仍 exit 0（先软后硬）" || bad "1 informational: exit=${RC}（应为 0）"
case "$OUT" in *"mode=informational"*) ok "1 informational: 汇总行标注模式";; *) bad "1 informational: 汇总行缺模式标注";; esac
case "$OUT" in *"c2=0"*) ok "1 informational: fixture 的 C2 归零（derived key 'cashFlow' 已导出）";; *) bad "1 informational: C2 未归零（$(echo "$OUT" | grep -o 'c2=[0-9]*' | head -1)）";; esac

# ── 2. 改坏即红: 删掉导出 ⇒ C2=1 且 blocking ⇒ exit 1 ──
printf 'const notExported = { config: {} };\n' > "$R/src/sentinel/adapters/cash-flow-sentinel.ts"
OUT="$(run --blocking)"; RC=$?
[ "$RC" = "1" ] && ok "2 改坏: blocking 模式违规 ⇒ exit 1" || bad "2 改坏: exit=${RC}（应为 1）"
case "$OUT" in *"c2=1"*) ok "2 改坏: C2 违规数 = 1（判别性成立）";; *) bad "2 改坏: C2 未检出（$(echo "$OUT" | grep -o 'c2=[0-9]*' | head -1)）";; esac
case "$OUT" in *"推导键 'cashFlow' 未导出"*) ok "2 改坏: 点名列 + 装载器推导键";; *) bad "2 改坏: 未点名推导键";; esac

# ── 3. 回滚即绿 ──
printf 'export const cashFlow = { config: {} };\n' > "$R/src/sentinel/adapters/cash-flow-sentinel.ts"
OUT="$(run --blocking)"; RC=$?
[ "$RC" = "0" ] && ok "3 回滚: 恢复导出 ⇒ blocking exit 0（改回即绿）" || bad "3 回滚: exit=${RC}（应为 0）"

# ── 4. 边界: 扫描源缺失 ⇒ exit 2（不降级放行）──
RC=0; bash "$CHECK" --root "$SB/nonexistent" >/dev/null 2>&1 || RC=$?
[ "$RC" = "2" ] && ok "4 边界: root 不存在 ⇒ exit 2" || bad "4 边界: exit=${RC}（应为 2）"
rm -rf "$R/extensions/ontology"
RC=0; bash "$CHECK" --root "$R" >/dev/null 2>&1 || RC=$?
[ "$RC" = "2" ] && ok "4 边界: 本体目录缺失 ⇒ exit 2（fail-closed）" || bad "4 边界: 本体缺失却 exit=${RC}（应 2）"

# ── 5. 实况: 真实仓库今日基线（卡面 Done ③）──
OUT="$(bash "$CHECK" 2>&1)"; RC=$?
[ "$RC" = "0" ] && ok "5 实况: 真实仓库 informational exit 0" || bad "5 实况: exit=${RC}"
for want in "c1=17" "c1_occ=45" "c2=4" "c5=1"; do
  case "$OUT" in
    *"$want"*) ok "5 实况: 基线命中 ${want}";;
    *) bad "5 实况: 基线未命中 ${want}（实得: $(echo "$OUT" | grep -o 'NAMING_AUTHORITY_SUMMARY.*' | head -1)）";;
  esac
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then
  D=""
  for n in ${FAILED_NAMES[@]+"${FAILED_NAMES[@]}"}; do D="${D}${n} ; "; done
  echo "❌ FAILED(${FAIL}): ${D}"
  exit 1
fi
echo "NAMING_AUTHORITY_TEST_SUMMARY: pass=${PASS} fail=0"
exit 0
