#!/usr/bin/env bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# daily-cto-board-ratio.test.sh — D964 文档:代码 比 指标（旁路）密封测试
#
# 覆盖矩阵（铁律 48 三路径）:
#   ① 正常路径 — 沙箱 3 md / 1 ts → 比值 3.00 且打印口径
#   ② 边界路径 — .sessions/** 下 md 不计入（排除生效）
#   ③ 降级路径 — 代码计数为 0 → 输出 n/a（degraded），不静默假绿
#   ④ 旁路语义 — 比值行存在不代表红项；且脚本不得因该行新增 red
# 沙箱: mktemp git 仓库（SYNO_REPO 注入），零网络零真实仓库依赖
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO/scripts/control-tower/daily-cto-board.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D964: daily-cto-board 文档:代码 比 ==="

mk_sandbox() { # $1 = md 数, $2 = ts 数, $3 = .sessions md 数
  SB="$TMPD/sb$RANDOM"; mkdir -p "$SB"; git -C "$SB" init -q
  git -C "$SB" config user.email t@t.local; git -C "$SB" config user.name t
  mkdir -p "$SB/src" "$SB/docs" "$SB/.sessions" "$SB/task-state" "$SB/.codex/control-tower/logs"
  local i=0
  while [ $i -lt "$1" ]; do printf '# doc\n' > "$SB/docs/d$i.md"; i=$((i+1)); done
  i=0; while [ $i -lt "$2" ]; do printf 'export const a = 1;\n' > "$SB/src/c$i.ts"; i=$((i+1)); done
  i=0; while [ $i -lt "$3" ]; do printf '# sess\n' > "$SB/.sessions/s$i.md"; i=$((i+1)); done
  git -C "$SB" add -A >/dev/null 2>&1; git -C "$SB" commit -q -m "chore: base"
  echo "$SB"
}

# ── 接线: 脚本必须真的含该指标（防「机制建成未接线」M3）──
grep -q '文档:代码 比' "$SCRIPT" && ok "接线: 脚本含 文档:代码 比 输出" || no "接线: 脚本无该指标"

# ── ① 正常路径: 3 md / 1 ts → 3.00 ──
SB=$(mk_sandbox 3 1 0)
OUT=$(SYNO_REPO="$SB" bash "$SCRIPT" 2>&1)
RATIO_LINE=$(grep '文档:代码 比' "$SB/docs/synova/coordination/CTO-看板-自动.md" 2>/dev/null || true)
echo "$RATIO_LINE" | grep -q '3.00' && ok "① 正常路径: 3 md ÷ 1 ts = 3.00" || no "① 比值错: $RATIO_LINE"
echo "$RATIO_LINE" | grep -q '排除 .sessions' && ok "① 打印口径（可复核）" || no "① 未打印口径"

# ── ② 边界: .sessions/ 下 5 md 不计入 ──
SB=$(mk_sandbox 2 1 5)
SYNO_REPO="$SB" bash "$SCRIPT" >/dev/null 2>&1 || true
RATIO_LINE=$(grep '文档:代码 比' "$SB/docs/synova/coordination/CTO-看板-自动.md" 2>/dev/null || true)
echo "$RATIO_LINE" | grep -q '2.00' && ok "② 边界: .sessions/ 5 md 被排除（2.00）" || no "② 排除失效: $RATIO_LINE"

# ── ③ 降级: 0 ts → n/a ──
SB=$(mk_sandbox 1 0 0)
SYNO_REPO="$SB" bash "$SCRIPT" >/dev/null 2>&1 || true
RATIO_LINE=$(grep '文档:代码 比' "$SB/docs/synova/coordination/CTO-看板-自动.md" 2>/dev/null || true)
echo "$RATIO_LINE" | grep -q 'n/a' && ok "③ 降级: 代码为 0 → n/a（不假绿）" || no "③ 未降级: $RATIO_LINE"

# ── ④ 旁路语义: 该指标不得写 red（脚本内 red= 赋值不因比值变化）──
grep -A3 '文档:代码 比 = ' "$SCRIPT" | grep -q 'red=1' \
  && no "④ 比值行被接进红项判定（应为旁路）" || ok "④ 旁路: 比值不参与红项判定"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
