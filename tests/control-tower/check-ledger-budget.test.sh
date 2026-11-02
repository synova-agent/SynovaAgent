#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-ledger-budget.test.sh — #1254（T4）台账三条判据的配对测试
#
# 覆盖（铁律 48: 正常/降级/边界）:
#   1 通过态：行数够小、无跨段重复、measured_at == base ⇒ exit 0
#   2 超行数 ⇒ exit 1 + L_LINES 点名（含实际/上限/超出）
#   3 跨段重复 ⇒ exit 1 + L_DUP 点名键（同键出现在两段）
#   4 measured_at 落后 ⇒ exit 1 + L_MEASURED_AT 点名两值
#   5 台账缺失 ⇒ exit 2 + degraded E_INV_MISSING（判不了≠通过）
#   6 --advisory：违规仍 exit 0（W5 收口前的软提示过渡态）
#   7 --json：机读摘要行可解析
#
# 零真实仓库污染：全部用 /tmp 沙箱台账；`--root` 指向真仓只为解析 base（不改任何文件）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
GATE="$REPO/scripts/control-tower/check-ledger-budget.sh"
TMPD="${TMPDIR:-/tmp}/ledger-budget-tests.$$"
rm -rf "$TMPD"; mkdir -p "$TMPD"

PASS=0; FAIL=0; FIRST_FAIL=""
ok()  { PASS=$((PASS+1)); echo "  ✅ $1"; }
no()  { FAIL=$((FAIL+1)); [ -n "$FIRST_FAIL" ] || FIRST_FAIL="$1"; echo "  ❌ $1" >&2; }

BASE_SHA="$(git -C "$REPO" rev-parse --short=9 HEAD 2>/dev/null || echo 000000000)"

mk_inv() { # <path> <measured_at> <dup:yes|no>
  local p="$1" m="$2" dup="$3"
  {
    echo "meta:"
    echo "  as_of: test"
    echo "gates:"
    echo "  - id: G-A"
    echo "  - id: G-B"
    echo "classification:"
    echo "  - id: CT-x"
    echo "    class: P2"
    echo "    owner: P4"
    echo "    review_after: 2026-11-27"
    echo "    entrypoint: scripts/control-tower/x.sh"
    echo "    required_ci: false"
    echo "run_by:"
    echo "  - entrypoint: scripts/control-tower/x.sh"
    echo "    run_by: gitea-ci"
    echo "    quota: false"
    echo "gate_meta:"
    echo "  measured_at: $m"
    if [ "$dup" = yes ]; then
      echo "candidates:"
      echo "  - id: CT-x"
    fi
  } > "$p"
}

echo "═══════════════════════════════════════════════════════════"
echo "  #1254 台账三条判据（MAX_LINES / 跨段重复 / measured_at）"
echo "═══════════════════════════════════════════════════════════"

# ── 1 通过态 ──
echo "── 1 通过态（无重复、measured_at 对齐）──"
mk_inv "$TMPD/pass.yaml" "$BASE_SHA" no
OUT="$(bash "$GATE" --root "$REPO" --inv "$TMPD/pass.yaml" --base HEAD 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "通过态 → exit 0" || no "通过态应 exit 0，实际 $RC: $OUT"
printf '%s' "$OUT" | grep -q '^LEDGER: lines=' && ok "首行恒为 LEDGER: 摘要" || no "缺 LEDGER: 摘要行"

# ── 2 超行数 ──
echo "── 2 超行数 ⇒ L_LINES ──"
OUT="$(bash "$GATE" --root "$REPO" --inv "$TMPD/pass.yaml" --base HEAD --max-lines 3 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "超行数 → exit 1" || no "超行数应 exit 1，实际 $RC"
printf '%s' "$OUT" | grep -q 'LEDGER-VIOLATION: L_LINES' && ok "点名 L_LINES" || no "未点名 L_LINES"

# ── 3 跨段重复 ──
echo "── 3 跨段重复 ⇒ L_DUP ──"
mk_inv "$TMPD/dup.yaml" "$BASE_SHA" yes
OUT="$(bash "$GATE" --root "$REPO" --inv "$TMPD/dup.yaml" --base HEAD 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "跨段重复 → exit 1" || no "跨段重复应 exit 1，实际 $RC"
printf '%s' "$OUT" | grep -q 'LEDGER-VIOLATION: L_DUP' && ok "点名 L_DUP" || no "未点名 L_DUP"
printf '%s' "$OUT" | grep -q 'CT-x' && ok "点名重复键 CT-x" || no "未点名重复键"

# ── 4 measured_at 落后 ──
echo "── 4 measured_at ≠ base ⇒ L_MEASURED_AT ──"
mk_inv "$TMPD/stale.yaml" "000000000" no
OUT="$(bash "$GATE" --root "$REPO" --inv "$TMPD/stale.yaml" --base HEAD 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "measured_at 落后 → exit 1" || no "measured_at 落后应 exit 1，实际 $RC"
printf '%s' "$OUT" | grep -q 'LEDGER-VIOLATION: L_MEASURED_AT' && ok "点名 L_MEASURED_AT" || no "未点名 L_MEASURED_AT"

# ── 5 台账缺失（判不了≠通过）──
echo "── 5 台账缺失 ⇒ exit 2 + degraded ──"
OUT="$(bash "$GATE" --root "$REPO" --inv "$TMPD/nope.yaml" --base HEAD 2>&1)"; RC=$?
[ "$RC" -eq 2 ] && ok "台账缺失 → exit 2" || no "台账缺失应 exit 2，实际 $RC"
printf '%s' "$OUT" | grep -q 'degraded: E_INV_MISSING' && ok "degraded E_INV_MISSING" || no "缺 degraded 码"
printf '%s' "$OUT" | grep -q '^LEDGER: ' && no "判不了时不应打印 LEDGER 摘要（防当通过）" || ok "判不了时不冒充摘要"

# ── 6 --advisory 软提示 ──
echo "── 6 --advisory 违规仍 exit 0（W5 过渡态）──"
OUT="$(bash "$GATE" --root "$REPO" --inv "$TMPD/stale.yaml" --base HEAD --advisory 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "--advisory → 违规仍 exit 0" || no "--advisory 应 exit 0，实际 $RC"
printf '%s' "$OUT" | grep -q 'LEDGER-VIOLATION: L_MEASURED_AT' && ok "软提示仍点名违规" || no "软提示必须仍可见"

# ── 7 --json ──
echo "── 7 --json 机读摘要 ──"
OUT="$(bash "$GATE" --root "$REPO" --inv "$TMPD/pass.yaml" --base HEAD --json 2>&1)"; RC=$?
printf '%s' "$OUT" | grep -q '^{\"lines\":' && ok "--json 输出机读摘要" || no "--json 摘要缺失: $OUT"

echo ""
echo "── 8 L_FIELDS（#1296）：分类条缺字段 ⇒ exit 1 且点名 ──"
cp "$TMPD/pass.yaml" "$TMPD/fields.yaml"
sed -i 's/^    class: P2$/    /' "$TMPD/fields.yaml"
OUT="$(bash "$GATE" --root "$REPO" --inv "$TMPD/fields.yaml" --base HEAD 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "8 字段不齐 exit 1" || no "8 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "L_FIELDS" && ok "8 点名 L_FIELDS" || no "8 未点名 L_FIELDS（$OUT）"

echo ""
echo "── 9 measured_at 漂移（#1296）：非祖先 ⇒ exit 1 且给修复命令 ──"
cp "$TMPD/pass.yaml" "$TMPD/drift.yaml"
sed -i 's/^  measured_at: .*/  measured_at: deadbeef/' "$TMPD/drift.yaml"
OUT="$(bash "$GATE" --root "$REPO" --inv "$TMPD/drift.yaml" --base HEAD 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "9 非祖先 exit 1" || no "9 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "L_MEASURED_AT" && ok "9 点名 L_MEASURED_AT" || no "9 未点名（$OUT）"
printf '%s' "$OUT" | grep -q "stamp" && ok "9 给出 --regen --stamp 修复命令" || no "9 未给修复命令（$OUT）"

echo "═══════════════════════════════════════════════════════════"
echo "=== 结果: PASS=${PASS} FAIL=${FAIL}${FIRST_FAIL:+ FIRST_FAIL=${FIRST_FAIL}} ==="
rm -rf "$TMPD"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
