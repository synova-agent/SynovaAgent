#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# bypass-ledger-worktree.test.sh — D1164（CTO 派单 2026-10-06：D331 账本对账 worktree 路径根修）
#
# 覆盖（铁律 48: 正常 / 降级 / 边界；CTO 派单 §四完成标准，全部改坏即红）:
#   1. worktree 态 sources 输出主仓 .sessions/<sid>/bypass.log 绝对路径（派单 §三.①判据）
#   2. 主仓态与 worktree 态一致: 同一 sid 下 P1 == P2（派单 §三.②判据）
#   3. 回退必红: 把修法改回 --show-toplevel 语义 ⇒ 判据必红（判据有分辨力，§四.2）
#   4. fail-closed: 非 git 环境 sources ⇒ exit 2 + stderr 具名原因（§三.③，禁 exit 0 空输出）
#   5. 主仓态回归: 主仓里 path/append/sources/read 行为不变（§四.4）
#   6. 端到端: 临时 worktree 一次提交 → check-bypass-log 走通（修后绿 / 回退变体必红，§四.1）
#
# 零真实仓库污染: 全部在 mktemp 沙箱（本地 bare origin，零网络）。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/control-tower/bypass-ledger.sh"
CHECKER="$REPO_DIR/scripts/control-tower/check-bypass-log.sh"

TMPD="$(mktemp -d)"
TMPD="$(cd "$TMPD" && pwd -P)"   # macOS mktemp 返回 /var/...（符号链接），pwd -P 规范到 /private/var/...（断言用绝对路径比较）
trap 'rm -rf "$TMPD"' EXIT
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

# ── 沙箱: 本地 bare origin + 主仓 clone + 链接 worktree ──
git init --bare -q "$TMPD/origin.git"
git clone -q "$TMPD/origin.git" "$TMPD/main" 2>/dev/null
cd "$TMPD/main"
git config user.email t@t; git config user.name t
mkdir -p scripts/control-tower
cp "$TOOL" scripts/control-tower/bypass-ledger.sh
cp "$CHECKER" scripts/control-tower/check-bypass-log.sh
git add -A && git commit -qm "init: scaffold"
git push -q origin HEAD:refs/heads/main 2>/dev/null
git branch -q main && git push -q origin main 2>/dev/null
git worktree add -q "$TMPD/wt" -b feat/x 2>/dev/null
WT="$TMPD/wt"

echo "═══════════════════════════════════════════════════════════"
echo "  D1164 — bypass 账本 worktree 路径根修"
echo "═══════════════════════════════════════════════════════════"

echo ""
echo "── 1+2. worktree 态 sources 指向主仓权威账本；P1 == P2 ──"
# 前置: 在 worktree 里 append 一条（本身即验证「worktree 写入落主仓」）
(cd "$WT" && env SYNO_SESSION_ID=sessW bash scripts/control-tower/bypass-ledger.sh append "pre-seed-sessW")
[ -f "$TMPD/main/.sessions/sessW/bypass.log" ] && pass "worktree append 落主仓 .sessions" || fail "worktree append 未落主仓"
WT_OUT="$(cd "$WT" && env SYNO_SESSION_ID=sessW bash scripts/control-tower/bypass-ledger.sh sources)"
MAIN_OUT="$(cd "$TMPD/main" && env SYNO_SESSION_ID=sessW bash scripts/control-tower/bypass-ledger.sh sources)"
# 过滤出 per-session 权威账本行（派单判据针对 .sessions/<sid>/bypass.log；旧镜像行是可选并集）
WT_SESS="$(printf '%s\n' "$WT_OUT" | grep '/\.sessions/' || true)"
MAIN_SESS="$(printf '%s\n' "$MAIN_OUT" | grep '/\.sessions/' || true)"
if [ -n "$WT_SESS" ] && printf '%s\n' "$WT_SESS" | grep -q "^$TMPD/main/\.sessions/"; then
  pass "worktree sources 输出主仓 .sessions 绝对路径（非空）"
else
  fail "worktree sources 未指向主仓 .sessions: $WT_SESS"
fi
if [ "$WT_SESS" = "$MAIN_SESS" ]; then pass "P1 == P2（主仓态与 worktree 态一致）"; else fail "P1≠P2: [$WT_SESS] vs [$MAIN_SESS]"; fi
# 修前病灶自证: 主仓 .sessions 当时根本不在输出里（全新 worktree 空输出）
if ! printf '%s\n' "$WT_SESS" | grep -q "^$WT/\.sessions/"; then pass "不再输出 worktree 自身 .sessions（病灶根除）"; else fail "仍输出 worktree 自身 .sessions"; fi

echo ""
echo "── 3. 回退必红: 改回 --show-toplevel 语义 ⇒ 判据必红 ──"
sed 's|SESSIONS_ROOT="${SYNO_BYPASS_SESSIONS_ROOT:-$MAIN_ROOT/\.sessions}"|SESSIONS_ROOT="${SYNO_BYPASS_SESSIONS_ROOT:-$WT_ROOT/.sessions}"|' \
  "$WT/scripts/control-tower/bypass-ledger.sh" > "$TMPD/ledger-regressed.sh"
if grep -q 'WT_ROOT/.sessions"' "$TMPD/ledger-regressed.sh"; then :; else
  sed 's|:-$MAIN_ROOT/\.sessions}|:-$WT_ROOT/.sessions}|' "$WT/scripts/control-tower/bypass-ledger.sh" > "$TMPD/ledger-regressed.sh"
fi
REG_OUT="$(cd "$WT" && env SYNO_SESSION_ID=sessW bash "$TMPD/ledger-regressed.sh" sources | grep '/\.sessions/' || true)"
if [ -z "$REG_OUT" ] || printf '%s\n' "$REG_OUT" | grep -qv "^$TMPD/main/\.sessions/"; then
  pass "回退变体不再满足判据（判据有分辨力）"
else
  fail "回退变体仍过判据 ⇒ 判据无分辨力"
fi

echo ""
echo "── 4. fail-closed: 非 git 环境 ⇒ exit 2 + 具名 ──"
mkdir -p "$TMPD/nogit"
cp "$TOOL" "$TMPD/nogit/bypass-ledger.sh"
NG_OUT="$(cd "$TMPD/nogit" && bash ./bypass-ledger.sh sources 2>"$TMPD/nogit.err")"; NG_RC=$?
NG_ERR="$(cat "$TMPD/nogit.err")"
if [ "$NG_RC" = 2 ]; then pass "exit 2（非 0 空输出）"; else fail "exit=$NG_RC（应为 2）"; fi
if echo "$NG_ERR" | grep -q "账本根不可解析"; then pass "stderr 具名原因"; else fail "stderr 未具名: $NG_ERR"; fi
# 调用方透传: check-bypass-log 在账本根不可解析时 exit 2 且报「不可解析」非「无记录」
CB_ERR_FILE="$TMPD/cb.err"
mkdir -p "$TMPD/nogit/scripts/control-tower"
cp "$TOOL" "$TMPD/nogit/scripts/control-tower/bypass-ledger.sh"   # 调用方按 $ROOT/scripts/... 解析 ledger
mkdir -p "$TMPD/nogit/.claude"   # 调用方 exit 2 路径要写 degraded-events.log
cp "$CHECKER" "$TMPD/nogit/scripts/control-tower/check-bypass-log.sh"
(cd "$TMPD/nogit" && bash scripts/control-tower/check-bypass-log.sh origin/main > /dev/null 2>"$CB_ERR_FILE"); CB_RC=$?
if [ "$CB_RC" = 2 ] && grep -q "不可解析" "$CB_ERR_FILE"; then pass "调用方 exit 2 具名（不静默降级为拒推）"; else fail "调用方 rc=$CB_RC: $(cat "$CB_ERR_FILE")"; fi

echo ""
echo "── 5. 主仓态回归: path/append/sources/read 不变 ──"
P1="$(cd "$TMPD/main" && env SYNO_SESSION_ID=sessM bash scripts/control-tower/bypass-ledger.sh path)"
if echo "$P1" | grep -q "^$TMPD/main/\.sessions/sessM/bypass\.log$"; then pass "path 落主仓 .sessions（主仓态行为不变）"; else fail "path 异常: $P1"; fi
(cd "$TMPD/main" && env SYNO_SESSION_ID=sessM bash scripts/control-tower/bypass-ledger.sh append "line-main" ) && pass "append exit 0" || fail "append 失败"
RD="$(cd "$TMPD/main" && env SYNO_SESSION_ID=sessM bash scripts/control-tower/bypass-ledger.sh read)"
echo "$RD" | grep -q "line-main" && pass "read 回读正确" || fail "read 缺内容: $RD"

echo ""
echo "── 6. 端到端: 临时 worktree 提交 → check-bypass-log 走通 ──"
cd "$WT"
git config user.email t@t; git config user.name t
echo x > f.txt && git add f.txt && git commit -qm "feat: wt commit"
SHA="$(git rev-parse HEAD)"
env SYNO_SESSION_ID=sessW bash scripts/control-tower/bypass-ledger.sh append "$(date -u +%Y-%m-%dT%H:%M:%SZ) | COMMITTED | test | HASH=$SHA"
CB_OUT="$(env SYNO_SESSION_ID=sessW bash scripts/control-tower/check-bypass-log.sh origin/main 2>&1)"; CB_RC=$?
echo "$CB_OUT" | sed 's/^/    /'
if [ "$CB_RC" = 0 ]; then pass "修后绿: worktree 提交对账 exit 0"; else fail "修后仍红 rc=$CB_RC"; fi
# 修前红复现（同环境换回退变体账本）: 记录写在主仓 .sessions，回退变体读不到 ⇒ 假红
cp "$TMPD/ledger-regressed.sh" scripts/control-tower/bypass-ledger.sh
RB_OUT="$(env SYNO_SESSION_ID=sessW bash scripts/control-tower/check-bypass-log.sh origin/main 2>&1)"; RB_RC=$?
echo "$RB_OUT" | sed 's/^/    /'
if [ "$RB_RC" = 1 ] && echo "$RB_OUT" | grep -q "账本不存在"; then pass "修前红复现: 回退变体下假红（❌ 账本不存在）"; else fail "回退变体 rc=$RB_RC（应 1 假红）"; fi
cp "$TMPD/main/scripts/control-tower/bypass-ledger.sh" scripts/control-tower/bypass-ledger.sh

echo ""
echo "═══════ 结果: PASS=$PASS FAIL=$FAIL ═══════"
[ "$FAIL" = 0 ]
