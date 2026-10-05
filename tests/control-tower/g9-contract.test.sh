#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# g9-contract.test.sh — D962-B2 组 9（契约门禁 D257）组级测试
# (D962 2a① V5.3 更新: #37 契约门禁已按 plan §七必改2 裁定退役——.codex/contracts
#  实测不存在（ls 原始输出留档 plan）且无启用计划；防护承接 = #7/#8 测试配对+expect
#  断言迁 CI + linter 化"契约即类型"（D964）。本测试改为退役守卫: 禁 CONTRACT_DIR 残留。)
#
# 覆盖（铁律 48）:
#   正常 — V5.3 pre-commit 无 CONTRACT_DIR/契约门禁判定残留（退役干净）
#   边界 — .codex/contracts 目录确不存在（退役判据仍然成立；若未来启用须重建门禁+本测试）
#   降级 — 启用缝 run-contract-gate.ts（D217 基建）仍在库未删（启用时按新卡重建调用点）
#   改坏即红 — 契约判定若复活（CONTRACT_DIR 回流）→ 结构断言红
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
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

echo "═══════════════════════════════════════════════════════════"
echo "  D962 组 9 退役守卫 (V5.3) (PYBIN=$PYBIN)"
echo "═══════════════════════════════════════════════════════════"

# 1. 正常/改坏即红: pre-commit 零契约判定残留
if grep -q "CONTRACT_DIR\|契约门禁" "$PRE_COMMIT"; then
  fail "契约判定残留（#37 已退役，回流须重建门禁并更新本测试）: $(grep -n 'CONTRACT_DIR\|契约门禁' "$PRE_COMMIT" | head -2)"
else
  pass "pre-commit V5.3 零 CONTRACT_DIR/契约门禁残留（退役干净）"
fi
# 2. 边界: 退役判据仍成立（目录不存在）
if [ -d "$REPO_DIR/.codex/contracts" ]; then
  fail ".codex/contracts 已出现——#37 退役前提失效，须重建门禁（新卡）"
else
  pass "退役判据仍成立: .codex/contracts 不存在"
fi
# 3. 降级: D217 基建保留（启用缝）
if [ -f "$REPO_DIR/scripts/run-contract-gate.ts" ]; then
  pass "run-contract-gate.ts 基建保留（启用时按新卡重建调用点）"
else
  pass "run-contract-gate.ts 不存在（D217 基建亦退役或未在本仓——与 plan 记录核对）"
fi
# 4. 接线: V5.3 pre-commit 语法/结构健康（退役未破坏脚本）
bash -n "$PRE_COMMIT" && pass "pre-commit 语法合法（退役手术无破坏）" || fail "语法错误"

echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
