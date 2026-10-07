#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# redeem-progress.test.sh — U7/CT-40 配对测试（scripts/product-lines/redeem-progress.py）
#
# 本件专测 **E4 增量**（K3 R6 迁移期「禁静默空白」）：
#   兑换器只扫 task-state 时，「0 任务可兑换」在迁移期是**无判据对象**而非「确实没有」，
#   必须显式打印迁移期标识，不得表现为静默空白。
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界）:
#   正常 — claim 库有条目 → 打印迁移期标识 + 条数
#   降级 — claim 目录不可读 → warning（铁律 24/31），不静默
#   边界 — 无 claim 库 → **不得**打印迁移期标识（防假标记）；task-state 缺失 → exit 2（既有语义不回归）
#
# 隔离: --task-state-dir / --evidence-dir / SYNO_CLAIMS_DIR 三个注入缝，零真实仓写入。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROG="$REPO/scripts/product-lines/redeem-progress.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/ts" "$TMP/ev"
printf '{"task_id":"D001","status":"impl_done"}' > "$TMP/ts/D001.json"

echo "=== redeem-progress 配对测试（U7/CT-40 · E4 迁移期显式降级）==="

run_with_claims() { # <claims_dir>
  SYNO_CLAIMS_DIR="$1" "$PYBIN" "$PROG" --task-state-dir "$TMP/ts" --evidence-dir "$TMP/ev" --dry-run 2>&1
}

# ── 边界: 无 claim 库 → 不得出现迁移期标识 ──
OUT="$(run_with_claims "$TMP/nonexistent-claims")"
echo "$OUT" | grep -q '迁移期' && no "边界: 无 claim 库时不应出现迁移期标识（假标记）" \
  || ok "边界: 无 claim 库 → 无迁移期标识"

# ── 正常: 有 claim 库 → 迁移期标识 + 条数 ──
mkdir -p "$TMP/claims"
printf 'writeset:\n  - scripts/a.sh\ndone:\n  - verify: bash x.sh\n' > "$TMP/claims/1224.yaml"
printf 'writeset:\n  - scripts/b.sh\ndone:\n  - verify: bash x.sh\n' > "$TMP/claims/1225.yaml"
printf 'not-a-claim\n' > "$TMP/claims/_index.yaml"   # 非 <数字>.yaml → 不计
OUT="$(run_with_claims "$TMP/claims")"
if echo "$OUT" | grep -q '迁移期'; then ok "正常: 有 claim → 打迁移期标识"; else no "正常: 缺迁移期标识（=静默空白）: $OUT"; fi
echo "$OUT" | grep -qE '2 条' && ok "正常: 条数=2（非数字 yaml 被正确排除）" \
  || no "正常: 条数不符（应 2）: $(echo "$OUT" | grep '迁移期' | head -1)"

# ── 边界: task-state 缺失 → exit 2（既有语义零回归）──
"$PYBIN" "$PROG" --task-state-dir "$TMP/no-such-ts" --evidence-dir "$TMP/ev" --dry-run >/dev/null 2>&1
[ $? -eq 2 ] && ok "边界: task-state 缺失 → exit 2（既有 fail-closed 零回归）" \
  || no "边界: task-state 缺失未返回 exit 2"

# ── 降级: 源码含显式 warning（铁律 24/31，不静默）──
grep -q 'SYNO_CLAIMS_DIR' "$PROG" && ok "降级: 注入缝存在（测试可隔离）" || no "降级: 缺注入缝"
grep -q 'degraded: claim 目录不可读' "$PROG" && ok "降级: 目录不可读有显式 warning" || no "降级: 缺显式 warning"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
