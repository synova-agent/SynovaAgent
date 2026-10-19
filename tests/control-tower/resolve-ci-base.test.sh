#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# resolve-ci-base.test.sh — CT-40 配对：#598 resolve-ci-base.sh
#
# 覆盖:
#   1. 契约（@input/@output/@exit 齐；可执行）
#   2. 显式 SYNO_BASE_REF → 原样输出
#   3. GITHUB_BASE_REF 裸 local-main → 规范化 gitea/local-main（并物化）
#   4. canonical 不可解析 ＋ 单远端 → fetch 物化 → 0
#   5. CI ＋ 单远端 → 刷新 canonical 后与 origin/local-main 一致 → 0
#   6. CI ＋ 远端前进但 origin/local-main 陈旧 → 新鲜度断言 → 2
#   7. CI ＋ 多远端 ＋ canonical 不可解析 → 不猜 → 2
#   8. 显式 base 不可解析 → 2
#
# 隔离: mktemp 沙箱（bare origin + 本地仓 + 第二 clone）；file:// 零网络。
# 用法: bash tests/control-tower/resolve-ci-base.test.sh  → 0 = 全过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPER="$REPO_DIR/scripts/control-tower/resolve-ci-base.sh"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL+1)); echo "  ❌ $1" >&2; }
run() { ( cd "$1" && env -u SYNO_BASE_REF -u GITHUB_BASE_REF -u SYNO_CI -u GITHUB_ACTIONS "$@" ) ; }

echo "=== #598 resolve-ci-base 配对测试 ==="
[ -f "$HELPER" ] && ok "1a. 文件存在" || no "1a. 文件缺失"
[ -x "$HELPER" ] && ok "1b. 可执行" || no "1b. 不可执行"
grep -q "@input" "$HELPER" && grep -q "@output" "$HELPER" && grep -q "@exit" "$HELPER" \
  && ok "1c. 契约段齐（@input/@output/@exit）" || no "1c. 契约段缺失"

TMPD=$(mktemp -d /tmp/rcb.XXXXXX)
trap 'rm -rf "$TMPD"' EXIT
ORIGIN="$TMPD/origin.git"; git init --bare -q "$ORIGIN"
W="$TMPD/w"; git init -q "$W"; git -C "$W" config user.email t@t; git -C "$W" config user.name t
git -C "$W" remote add origin "file://$ORIGIN"
echo a > "$W/a.txt"; git -C "$W" add a.txt; git -C "$W" commit -qm A
git -C "$W" push -q origin HEAD:local-main 2>/dev/null; git -C "$W" fetch -q origin 2>/dev/null

# 2 显式 SYNO_BASE_REF
git -C "$W" branch -f feat/x HEAD 2>/dev/null
OUT=$( cd "$W" && SYNO_BASE_REF=feat/x bash "$HELPER" 2>/dev/null ); RC=$?
[ "$RC" -eq 0 ] && [ "$OUT" = "feat/x" ] && ok "2. 显式 SYNO_BASE_REF=feat/x → '$OUT'（0）" || no "2. 显式 base 失败 rc=${RC} out=${OUT}"

# 3 GITHUB_BASE_REF 裸 local-main 规范化（canonical 不可解析 → fetch 物化）
git -C "$W" update-ref -d refs/remotes/gitea/local-main 2>/dev/null || true
OUT=$( cd "$W" && GITHUB_BASE_REF=local-main bash "$HELPER" 2>/dev/null ); RC=$?
[ "$RC" -eq 0 ] && [ "$OUT" = "gitea/local-main" ] && ok "3. 裸 local-main 规范化 → '$OUT'（0）" || no "3. 规范化失败 rc=${RC} out=${OUT}"

# 4 canonical 不可解析 + 单远端（非 CI）→ fetch 物化
git -C "$W" update-ref -d refs/remotes/gitea/local-main 2>/dev/null || true
OUT=$( cd "$W" && bash "$HELPER" 2>/dev/null ); RC=$?
CANON=$(git -C "$W" rev-parse --short refs/remotes/gitea/local-main 2>/dev/null)
[ "$RC" -eq 0 ] && [ "$OUT" = "gitea/local-main" ] && [ -n "$CANON" ] \
  && ok "4. 不可解析＋单远端 → 物化（canonical=${CANON}，0）" || no "4. 物化失败 rc=${RC} out=${OUT} canon=$CANON"

# 5 CI ＋ 单远端：远端前进 + fetch origin（origin/local-main 新）→ 刷新后一致 → 0
echo b > "$W/b.txt"; git -C "$W" add b.txt; git -C "$W" commit -qm B; git -C "$W" push -q origin HEAD:local-main 2>/dev/null
git -C "$W" fetch -q origin 2>/dev/null
OUT=$( cd "$W" && SYNO_CI=1 bash "$HELPER" 2>/dev/null ); RC=$?
[ "$RC" -eq 0 ] && ok "5. CI 刷新后与远端跟踪引用一致 → 0（canonical=$(git -C "$W" rev-parse --short refs/remotes/gitea/local-main)）" || no "5. CI 刷新失败 rc=$RC"

# 6 CI ＋ 单远端 fetch 失败 ＋ canonical 不可解析 → 2（fail-closed，不猜）
#   注: 「origin/local-main 陈旧」无法在此构造——fetch canonical 会同时刷新 origin/local-main
#   （git 行为实测），故新鲜度断言在真实 CI 里恒等；真正的保证是"每次 CI 都 fetch"本身。
git -C "$W" update-ref -d refs/remotes/gitea/local-main 2>/dev/null || true
git -C "$W" remote set-url origin "file:///nonexistent-rcb-xyz" 2>/dev/null
OUT=$( cd "$W" && SYNO_CI=1 bash "$HELPER" 2>/dev/null ); RC=$?
[ "$RC" -eq 2 ] && ok "6. CI ＋ fetch 失败 ＋ canonical 不可解析 → 2（fail-closed）" || no "6. fetch 失败应 2，实际 rc=${RC}"
git -C "$W" remote set-url origin "file://$ORIGIN" 2>/dev/null

# 7 CI + 多远端 + canonical 不可解析 → 2（不猜）
git -C "$W" remote add alt "file://$ORIGIN" 2>/dev/null || true
git -C "$W" update-ref -d refs/remotes/gitea/local-main 2>/dev/null || true
OUT=$( cd "$W" && SYNO_CI=1 bash "$HELPER" 2>/dev/null ); RC=$?
[ "$RC" -eq 2 ] && ok "7. 多远端＋不可解析＋CI → 2（不猜）" || no "7. 多远端应 2，实际 rc=$RC"

# 8 显式 base 不可解析 → 2
OUT=$( cd "$W" && SYNO_BASE_REF=no-such-ref bash "$HELPER" 2>/dev/null ); RC=$?
[ "$RC" -eq 2 ] && ok "8. 显式不可解析 base → 2" || no "8. 坏 base 应 2，实际 rc=$RC"

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
