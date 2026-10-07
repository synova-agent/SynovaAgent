#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# daily-cto-board.test.sh — U7/CT-40 配对测试（scripts/control-tower/daily-cto-board.sh）
#
# 本件专测 **E4 增量**（K3 R6 迁移期「禁静默空白」）：卡总数在迁移期的显式呈现。
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界）:
#   正常 — 仓库有 claim 库 → 看板「卡总数」并列 claim 计数 + 打出迁移期标识
#   降级 — claim_store 不可用（本分支未含）→ 打「计数降级 … 非 0」，**不静默当 0**
#   边界 — 无 claim 目录 → **不得**出现迁移期标识（防假标记）
#
# 隔离: SYN O_REPO 指向 mktemp 临时仓（脚本自身支持该注入缝），零真实仓写入。
# 注意: 本测试**不**断言看板其余区块（那些由 schedule/CI 侧负责），只测 E4 增量面。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOARD="$REPO/scripts/control-tower/daily-cto-board.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

echo "=== daily-cto-board 配对测试（U7/CT-40 · E4 迁移期显式降级）==="

mk_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q 2>/dev/null || true
  mkdir -p "$d/task-state" "$d/docs/synova/coordination" "$d/.codex/control-tower/logs"
  echo "$d"
}
run_board() { # <repo>
  SYNO_REPO="$1" bash "$BOARD" >/dev/null 2>&1
  echo $?
}
out_of() { echo "$1/docs/synova/coordination/CTO-看板-自动.md"; }

# ── 边界: 无 claim 目录 → 不得出现迁移期标识 ──
T1="$(mk_repo)"
printf '{}' > "$T1/task-state/D001.json"
rc="$(run_board "$T1")"
O="$(out_of "$T1")"
if [ -f "$O" ]; then
  grep -q '卡总数' "$O" && ok "边界: 看板含「卡总数」行" || no "边界: 无卡总数行"
  grep -q '迁移期' "$O" && no "边界: 无 claim 时不应出现迁移期标识（假标记）" || ok "边界: 无 claim 无迁移期标识"
else
  no "边界: 看板未生成（$O）"
fi
rm -rf "$T1"

# ── 正常: 有 claim 库 → 迁移期标识 + 计数 ──
T2="$(mk_repo)"
printf '{}' > "$T2/task-state/D001.json"
mkdir -p "$T2/.claude/claims"
printf 'writeset:\n  - scripts/a.sh\ndone:\n  - verify: bash x.sh\n' > "$T2/.claude/claims/1224.yaml"
printf 'writeset:\n  - scripts/b.sh\ndone:\n  - verify: bash x.sh\n' > "$T2/.claude/claims/1225.yaml"
rc="$(run_board "$T2")"
O="$(out_of "$T2")"
if [ -f "$O" ]; then
  grep -q '迁移期' "$O" && ok "正常: 有 claim → 打迁移期标识" || no "正常: 缺迁移期标识（=静默空白）"
  grep -q 'claim' "$O" && ok "正常: 卡总数并列 claim 计数" || no "正常: 未并列 claim 计数"
  # 本分支（PR-C）未含 claim_store.py ⇒ 走降级分支；若已含则走计数分支。
  # 两条都必须**显式**（禁静默当 0）—— 断言二者必居其一且可辨。
  grep -qE 'claim (2|\[0-9\])' "$O" || grep -q '计数降级' "$O" \
    && ok "正常: claim 计数为真值或显式降级（非静默 0）" || no "正常: claim 计数不可辨: $(grep 'claim' "$O" | head -1)"
  [ "$rc" = "1" ] || [ "$rc" = "0" ] && ok "正常: 退出码为业务态 0/1（非 2 degraded）" || no "正常: 退出码异常 rc=$rc"
else
  no "正常: 看板未生成（$O）"
fi
rm -rf "$T2"

# ── 降级: 无 python / claim_store 缺失 → 显式降级文案（不静默）──
# 以「去掉 claim_store.py 可见性」模拟（本分支从 main 起，本就不含该文件）：
# 断言降级分支的文案存在性由上一组覆盖；此处断言**源码含降级文案**（防有人把 ? 改成静默 0）
SRC="$REPO/scripts/control-tower/daily-cto-board.sh"
grep -q '计数降级' "$SRC" && ok "降级: 源码含「计数降级」显式文案" || no "降级: 源码缺显式降级文案"
grep -q 'swallow-ok' "$SRC" && ok "降级: 吞错处带 swallow-ok 注记（可直接审查）" || no "降级: 吞错无注记"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
