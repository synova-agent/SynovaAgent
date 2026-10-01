#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# loop-context.test.sh — FIX-007 熔断判据对齐（只数真绕过 detected-bypass）
#
# 背景: `scripts/workflow/loop-context.sh` 第 4 段判据原为 `grep -c "$TODAY"`（数今日**全部行**），
#   而 `scripts/pre-commit-check.sh:242`（V4.5.1）已修为 `grep -c "${TODAY}.*detected-bypass"`。
#   判据漂移 ⇒ 3 条当日 `COMMITTED`（合法提交登记）即误熔断全队 = **纯假红**。
#
# 覆盖（成对反例 + 改坏即红）:
#   ⒜ 3×COMMITTED（今日）                → 不熔断（exit 0）
#   ⒝ 3×detected-bypass（今日）           → 仍熔断（exit 1 + 输出「熔断」）—— 滥用场景必须仍红
#   ⒞ 5×COMMITTED + 2×detected-bypass     → 仅计 2 → 警告（不熔断）
#   ⒟ 3×昨日 detected-bypass（陈旧）       → 不计 → 不熔断
#   判别性反例: 把 pattern 还原成旧的 `grep -c "$TODAY"` → ⒜ 立即误熔断（红）
#
# 沙箱: mktemp 树内放脚本副本 + .claude/bypass.log；零真实仓库依赖、零副作用。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO/scripts/workflow/loop-context.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
TODAY="$(date +%Y-%m-%d)"
YDAY="$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d 'yesterday' +%Y-%m-%d)"

echo "=== FIX-007: loop-context 熔断判据（只数 detected-bypass）==="

[ -f "$SCRIPT" ] && ok "接线: loop-context.sh 存在" || { no "接线: 脚本缺失"; exit 1; }

sandbox() { # $1 = 场景名；stdin = bypass.log 内容；输出沙箱路径
  local sb="$TMPD/$1"
  mkdir -p "$sb/scripts/workflow" "$sb/.claude"
  cp "$SCRIPT" "$sb/scripts/workflow/loop-context.sh"
  cat > "$sb/.claude/bypass.log"
  echo "$sb"
}
run_sb() { (bash "$1/scripts/workflow/loop-context.sh" --check 2>&1); }
committed() { printf '%s | COMMITTED | pre-commit PASS (hook 层登记) | HASH=deadbeef\n' "$1"; }
bypass() { printf '%sT10:00:00Z detected-bypass no-precommit-marker\n' "$1"; }

# ── ⒜ 3×COMMITTED（今日）→ 不熔断 ──
SB=$(sandbox a < <( { committed "$TODAY"; committed "$TODAY"; committed "$TODAY"; } ))
OUT=$(run_sb "$SB"); rc=$?
echo "  [⒜] rc=$rc  :: $(echo "$OUT" | grep -a '绕过检查' | tr -d '\n')"
[ "$rc" -eq 0 ] && ok "⒜ 3×COMMITTED（合法登记）→ 不熔断（exit 0）" || no "⒜ 假红未修: rc=$rc"
echo "$OUT" | grep -aq '绕过检查: 0 次' && ok "⒜ 计数为 0（COMMITTED 不计入）" || no "⒜ 计数非 0"
echo "$OUT" | grep -aq '熔断: 今日\|熔断触发' && no "⒜ 仍输出熔断" || ok "⒜ 无熔断输出"

# ── ⒝ 3×detected-bypass（今日）→ 仍熔断 ──
SB=$(sandbox b < <( { bypass "$TODAY"; bypass "$TODAY"; bypass "$TODAY"; } ))
OUT=$(run_sb "$SB"); rc=$?
echo "  [⒝] rc=$rc  :: $(echo "$OUT" | grep -a '绕过检查\|熔断:' | tr '\n' ' ')"
[ "$rc" -eq 1 ] && ok "⒝ 3×detected-bypass → 仍熔断（exit 1）" || no "⒝ 真绕过未熔断: rc=$rc"
echo "$OUT" | grep -aq '熔断: 今日 --no-verify 3 次' && ok "⒝ 输出点名 3 次" || no "⒝ 未点名次数"

# ── ⒞ 5×COMMITTED + 2×detected-bypass → 仅计 2 → 警告（不熔断）──
SB=$(sandbox c < <( { committed "$TODAY"; committed "$TODAY"; committed "$TODAY"; committed "$TODAY"; committed "$TODAY"; bypass "$TODAY"; bypass "$TODAY"; } ))
OUT=$(run_sb "$SB"); rc=$?
echo "  [⒞] rc=$rc  :: $(echo "$OUT" | grep -a '绕过检查\|警告\|熔断' | tr '\n' ' ')"
[ "$rc" -eq 0 ] && ok "⒞ 5×COMMITTED+2×真绕过 → 仅计 2 → 不熔断（exit 0）" || no "⒞ 误熔断: rc=$rc"
echo "$OUT" | grep -aq '警告: 今日 --no-verify 2 次' && ok "⒞ 输出为「警告 2 次」（计数正确）" || no "⒞ 未按真绕过计数"

# ── ⒟ 3×昨日 detected-bypass（陈旧 marker）→ 不计 ──
SB=$(sandbox d < <( { bypass "$YDAY"; bypass "$YDAY"; bypass "$YDAY"; } ))
OUT=$(run_sb "$SB"); rc=$?
echo "  [⒟] rc=$rc  :: $(echo "$OUT" | grep -a '绕过检查' | tr -d '\n')"
[ "$rc" -eq 0 ] && ok "⒟ 陈旧（非本日）marker 不参与熔断（exit 0）" || no "⒟ 陈旧 marker 触发熔断: rc=$rc"

# ── 判别性反例（改坏即红）: 把判据还原为旧的 `grep -c "$TODAY"` → ⒜ 场景立即误熔断 ──
SB=$(sandbox mutant < <( { committed "$TODAY"; committed "$TODAY"; committed "$TODAY"; } ))
sed 's/grep -c "${TODAY}.*detected-bypass"/grep -c "$TODAY"/' "$SB/scripts/workflow/loop-context.sh" > "$SB/scripts/workflow/loop-context-mutant.sh"
grep -q 'grep -c "$TODAY"' "$SB/scripts/workflow/loop-context-mutant.sh" \
  && ok "判别性反例: 变异体已生成（还原旧判据）" || no "判别性反例: 变异体生成失败（sed 未命中）"
OUT=$(run_sb "$SB/scripts/workflow" 2>/dev/null || true)
OUT=$(bash "$SB/scripts/workflow/loop-context-mutant.sh" --check 2>&1); rc=$?
echo "  [mutant] rc=$rc  :: $(echo "$OUT" | grep -a '绕过检查\|熔断:' | tr '\n' ' ')"
{ [ "$rc" -eq 1 ] && echo "$OUT" | grep -aq '熔断'; } \
  && ok "判别性反例成立: 旧判据下 ⒜ 场景立即误熔断（断言未变成恒真）" \
  || no "判别性反例失败: 旧判据下仍不熔断（夹具失去判别力）"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
