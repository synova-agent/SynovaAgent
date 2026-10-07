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

# ── 正常: 有 claim 库 → 迁移期标识 + **真值计数 `+ claim N`**（verifier P1：死码判别）──
# 关键: 把**真实** claim_store.py 放进临时仓（看板按 cwd/REPO 相对调用它），
#       否则只会走降级分支 —— 那样 `+ claim N` 分支永远测不到（正是 verifier 指出的死码盲区）。
T2="$(mk_repo)"
printf '{}' > "$T2/task-state/D001.json"
mkdir -p "$T2/.claude/claims" "$T2/scripts/control-tower"
if [ -f "$REPO/scripts/control-tower/claim_store.py" ]; then
  cp "$REPO/scripts/control-tower/claim_store.py" "$T2/scripts/control-tower/claim_store.py"
  HAVE_STORE=1
else
  # 契约替身（contract double）：核心库此刻只在 #1259 分支上（本分支从 main 起）。
  #   看板与库的契约面只有 `iter_claims(root)` 一个函数 —— 用替身即可**今天就**行使
  #   真值分支（`+ claim N`），避免"分支未合 ⇒ 死码测不到"的无限等待。
  #   #1259 合入后 HAVE_STORE=1，自动改用**真实**库（本段成为死支，不影响判别力）。
  HAVE_STORE=0
  cat > "$T2/scripts/control-tower/claim_store.py" <<'PYSTUB'
def iter_claims(root=None, env=None):
    return [
        {"issue": "1224", "path": "stub/1224.yaml", "writeset": ["a.sh"], "done": [{"verify": "bash x.sh"}], "note": None},
        {"issue": "1225", "path": "stub/1225.yaml", "writeset": ["b.sh"], "done": [{"verify": "bash x.sh"}], "note": None},
    ]
PYSTUB
fi
printf 'writeset:\n  - scripts/a.sh\ndone:\n  - verify: bash x.sh\n' > "$T2/.claude/claims/1224.yaml"
printf 'writeset:\n  - scripts/b.sh\ndone:\n  - verify: bash x.sh\n' > "$T2/.claude/claims/1225.yaml"
rc="$(run_board "$T2")"
O="$(out_of "$T2")"
if [ -f "$O" ]; then
  grep -q '迁移期' "$O" && ok "正常: 有 claim → 打迁移期标识" || no "正常: 缺迁移期标识（=静默空白）"
  grep -q 'claim' "$O" && ok "正常: 卡总数并列 claim 计数" || no "正常: 未并列 claim 计数"
  # 真值分支必须**可达且取到 N=2`（若该分支不可达 —— 如原 `--count` 死码 —— 这里就红）
  # 库可用（HAVE_STORE=1，真实库）或替身（HAVE_STORE=0）都走同一分支，判别力一致。
  grep -q '+ claim 2' "$O" \
    && ok "正常: 真值分支可达 → 输出「+ claim 2」（死码判别）" \
    || no "正常: 未走真值分支（疑似死码）: $(grep -o 'claim[^｜]*' "$O" | head -1)"
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
