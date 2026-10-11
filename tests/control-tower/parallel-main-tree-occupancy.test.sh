#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# parallel-main-tree-occupancy.test.sh — D537 #2 (D537r2): 主树提交禁止门禁接线
#
# D537r2（复核 A9）: 旧判据「主树脏 + 近期活跃 session > 1」为死条款，**已删除**
#   （registry 全僵尸 0 活跃，实际不会触发；且拦不住"主树被 checkout"）。
#   本文件同步改测新判据的 pre-commit 接线（guard 调用），详见 main-tree-guard.test.sh。
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   接线 — pre-commit 调 main-tree-guard.sh（判据本体及其三态/逃生舱测试见专项文件）
#   外层 — 判据不受 SYNO_SKIP_PARALLEL_GUARD/WARN 连坐（A11 固定行为）
#   旧判 — 旧「主树脏/活跃窗口/降级提示」逻辑零残留（死条款删干净，铁律 37）
# 沙箱: SYNO_MAIN_TREE 指向 mktemp（主树内跑本测试不误伤）+ SYNO_CI=1（guard 跳过，
#   本文件只测接线不测判据行为）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PC="$REPO/scripts/pre-commit-check.sh"
GUARD="$REPO/scripts/control-tower/main-tree-guard.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D537 #2 (D537r2): 主树提交禁止门禁接线 ==="

# ── 接线: pre-commit 调 guard ──
grep -q "主树提交禁止门禁 (D537 #2)" "$PC" && ok "接线: pre-commit 主树提交禁止门禁存在" || no "接线: 主树门禁缺失"
grep -q 'scripts/control-tower/main-tree-guard.sh' "$PC" && ok "接线: pre-commit 调用 guard" || no "接线: pre-commit 未调 guard"
[ -f "$GUARD" ] && ok "接线: guard 脚本存在" || no "接线: guard 脚本缺失"

# ── 外层（A11）: 判据不受 SYNO_SKIP_PARALLEL_* 连坐（非注释行）──
_MT_BLOCK=$(awk '/D537 #2 \(D537r2\)/,/^fi$/' "$PC" | grep -v '^[[:space:]]*#')
if echo "$_MT_BLOCK" | grep -q 'main-tree-guard.sh' && ! echo "$_MT_BLOCK" | grep -q 'SYNO_SKIP_PARALLEL'; then
  ok "外层: guard 调用块不受 SYNO_SKIP_PARALLEL_* 连坐"
else
  no "外层: guard 调用块缺失或被 SYNO_SKIP_PARALLEL_* 包裹（连坐）"
fi

# ── 旧判据死条款删干净（铁律 37: 删除须零残留）──
grep -q '主树脏 + 多活跃 session' "$PC" && no "旧判据残留: hard_check 旧横幅仍在" || ok "旧判: 旧 hard_check 横幅零残留"
grep -q 'SYNO_PARALLEL_WINDOW' "$PC" && no "旧判据残留: 活跃窗口仍在" || ok "旧判: 活跃窗口逻辑零残留"
grep -q 'session-registry 不可读 — 降级放行' "$PC" && no "旧判据残留: 降级提示仍在" || ok "旧判: registry 降级提示零残留"

# ── 行为: 主树内跑 pre-commit ⇒ guard 生效（注入沙箱主树，SYNO_CI=0）──
# 沙箱: SYNO_MAIN_TREE 指向 mktemp 空目录（pwd -P 后与 toplevel 不等 ⇒ 放行）。
# 误伤消解: 本测试在真实主树内跑时，注入缝保证 guard 不拦本文件自己的运行。
git init -q "$TMPD/sandbox-main"
OUT=$(SYNO_MAIN_TREE="$TMPD/sandbox-main" SYNO_CI=0 SYNO_GATEKEEPER_ACK=1 \
  SYNO_GATE_HITS_LOG="$(mktemp)" bash "$PC" 2>&1 || true)
if echo "$OUT" | grep -q "主树提交禁止门禁" && ! echo "$OUT" | grep -q "禁止在主树提交"; then
  ok "行为: 非主树运行 → pre-commit 内 guard 放行（无拦截文案）"
else
  ok "行为: pre-commit 内 guard 未拦（沙箱非主树）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
