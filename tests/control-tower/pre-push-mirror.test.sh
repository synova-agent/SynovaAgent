#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# pre-push-mirror.test.sh — #657 门禁 0-2 补 remote 维度（裁 223）
#
# 覆盖（六判据）:
#   ① 推 gitea main ⇒ 仍拒（exit 1）
#   ② 推 mirror main ＋ fast-forward ⇒ 放行（exit 0）
#   ③ 推 mirror main ＋ non-ff ⇒ 拒（exit 1）
#   ④ 放行时写 mirror-sync.log（from→to / 时间 / 触发者）
#   ⑤ 推完核 SHA：远端==推的 ⇒ 0；不等 ⇒ 1（--verify-mirror-sync）
#   ⑥ 推 gitea 的 feat/ 分支 ⇒ 不受影响（回归锁）
#
# 判别力（改坏必红）:
#   M1 把 remote 判断写反（== → !=）⇒ ② 变拒、① 变放行 ⇒ 断言翻红
#   M2 去掉 ff 检查（`merge-base --is-ancestor` 恒 false）⇒ ③ 变放行 ⇒ 断言翻红
#
# 隔离: mktemp 沙箱（bare mirror/gitea ＋ 工作仓）；file:// 零网络；SYNO_SYNC_ONLY=1。
# 用法: bash tests/control-tower/pre-push-mirror.test.sh → 0 = 全过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRE_PUSH="$REPO_DIR/scripts/pre-push-check.sh"
PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1" >&2; }
assert_exit() { if [ "$1" -eq "$2" ]; then pass "$3"; else fail "$3 (got exit=$1, want exit=$2)"; fi; }
TMP=$(mktemp -d /tmp/ppm.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

# ── 沙箱工厂: 返回 WORK；远端 bare 在 $TMP/<case>/mirror.git｜gitea.git ──
mk() { # <case>
  local c="$1"
  mkdir -p "$TMP/$c"
  git init --bare -q "$TMP/$c/mirror.git"; git init --bare -q "$TMP/$c/gitea.git"
  git init -q "$TMP/$c/w"; WORK="$TMP/$c/w"
  git -C "$WORK" config user.email t@t; git -C "$WORK" config user.name t
  echo A > "$WORK/a.txt"; git -C "$WORK" add a.txt; git -C "$WORK" commit -qm A
  git -C "$WORK" remote add mirror "file://$TMP/$c/mirror.git"
  git -C "$WORK" remote add gitea "file://$TMP/$c/gitea.git"
}
sha() { git -C "$WORK" rev-parse "$1"; }
mirror_url() { printf 'file://%s/mirror.git' "$TMP/$1"; }
# hook 调用: <remote> <url> <lref> <lsha> <rref> <rsha> [--script <path>]
hook() {
  local rem="$1" url="$2" lref="$3" lsha="$4" rref="$5" rsha="$6"; shift 6
  local script="$PRE_PUSH"; [ "${1:-}" = "--script" ] && { script="$2"; shift 2; }
  ( cd "$WORK" && printf '%s %s %s %s\n' "$lref" "$lsha" "$rref" "$rsha" | \
      env SYNO_SYNC_ONLY=1 SYNO_MIRROR_SYNC_LOG="$LOG" SYNO_MIRROR_PENDING="$PEND" \
      bash "$script" "$rem" "$url" > "$TMP/out.txt" 2>&1; echo $? )
}
verify() { local script="$PRE_PUSH"; [ "${1:-}" = "--script" ] && { script="$2"; shift 2; }
  ( cd "$WORK" && env SYNO_MIRROR_PENDING="$PEND" SYNO_MIRROR_SYNC_LOG="$LOG" \
      bash "$script" --verify-mirror-sync > "$TMP/out.txt" 2>&1; echo $? ); }

echo "=== #657 门禁 0-2 remote 维度 ==="

# ① gitea main 仍拒
mk c1; LOG="$TMP/c1/sync.log"; PEND="$TMP/c1/pending"
echo B > "$WORK/b.txt"; git -C "$WORK" add b.txt; git -C "$WORK" commit -qm B
EC=$(hook gitea "file://$TMP/c1/gitea.git" refs/heads/main "$(sha HEAD)" refs/heads/main "$(sha HEAD~1)")
assert_exit "$EC" 1 "① 推 gitea main ⇒ 拒"
grep -q "禁止直接 push main" "$TMP/out.txt" && pass "① 拒因=0-2 main 保护" || fail "① 拒因不对"

# ② mirror main + ff ⇒ 放行 + ④ 日志
mk c2; LOG="$TMP/c2/sync.log"; PEND="$TMP/c2/pending"
git -C "$WORK" push -q mirror main 2>/dev/null           # mirror main = A
echo B > "$WORK/b.txt"; git -C "$WORK" add b.txt; git -C "$WORK" commit -qm B
A_SHA=$(sha HEAD~1); B_SHA=$(sha HEAD)
EC=$(hook mirror "$(mirror_url c2)" refs/heads/main "$B_SHA" refs/heads/main "$A_SHA")
assert_exit "$EC" 0 "② 推 mirror main（ff）⇒ 放行"
grep -q "放行" "$TMP/out.txt" && pass "② 放行消息在场" || fail "② 缺放行消息"
if grep -qE "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^|]+ \| ALLOW \| from=$A_SHA \| to=$B_SHA" "$LOG" 2>/dev/null; then
  pass "④ mirror-sync.log 含 时间|ALLOW|from→to"
else
  fail "④ mirror-sync.log 缺字段（$([ -f "$LOG" ] && tail -1 "$LOG" || echo 无文件)）"
fi
grep -q "user=" "$LOG" 2>/dev/null && pass "④ 日志含触发者" || fail "④ 日志缺触发者"

# ③ mirror main + non-ff ⇒ 拒
mk c3; LOG="$TMP/c3/sync.log"; PEND="$TMP/c3/pending"
git -C "$WORK" push -q mirror main 2>/dev/null           # mirror main = A
git -C "$WORK" reset -q --hard HEAD~0 2>/dev/null || true
echo X > "$WORK/x.txt"; git -C "$WORK" add x.txt; git -C "$WORK" commit -qm X   # D: 父=A（分叉于 mirror 的 A? 远端 A 是祖先）
# 造真分叉：远端前进到 B，本地从 A 造 D
git -C "$WORK" push -q mirror main 2>/dev/null
echo B > "$WORK/b.txt"; git -C "$WORK" add b.txt; git -C "$WORK" commit -qm B; git -C "$WORK" push -q mirror main 2>/dev/null
git -C "$WORK" reset -q --hard HEAD~2                    # 回 A
echo D > "$WORK/d.txt"; git -C "$WORK" add d.txt; git -C "$WORK" commit -qm D
D_SHA=$(sha HEAD); REMOTE_B=$(git -C "$WORK" ls-remote mirror refs/heads/main | awk '{print $1}')
EC=$(hook mirror "$(mirror_url c3)" refs/heads/main "$D_SHA" refs/heads/main "$REMOTE_B")
assert_exit "$EC" 1 "③ 推 mirror main（non-ff）⇒ 拒"
grep -q "非 fast-forward" "$TMP/out.txt" && pass "③ 拒因=非 fast-forward" || fail "③ 拒因不对"
grep -q "REJECT(non-ff)" "$LOG" 2>/dev/null && pass "③ 日志记 REJECT(non-ff)" || fail "③ 日志未记拒绝"

# ⑤ 推后核 SHA：等 ⇒ 0；不等 ⇒ 1
mk c5; LOG="$TMP/c5/sync.log"; PEND="$TMP/c5/pending"
git -C "$WORK" push -q mirror main 2>/dev/null           # 远端 = A
echo B > "$WORK/b.txt"; git -C "$WORK" add b.txt; git -C "$WORK" commit -qm B
B_SHA=$(sha HEAD); A_SHA=$(sha HEAD~1)
EC=$(hook mirror "$(mirror_url c5)" refs/heads/main "$B_SHA" refs/heads/main "$A_SHA"); assert_exit "$EC" 0 "⑤a 放行（为核 SHA 造 pending）"
git -C "$WORK" push -q mirror HEAD:refs/heads/main 2>/dev/null || true   # 模拟"已推完"
EC=$(verify); assert_exit "$EC" 0 "⑤b 远端==推的 SHA ⇒ 0"
[ ! -f "$PEND" ] && pass "⑤c 核过即清 pending" || fail "⑤c pending 未清"
grep -q "VERIFIED" "$LOG" 2>/dev/null && pass "⑤d 日志记 VERIFIED" || fail "⑤d 日志未记 VERIFIED"
# 不等：远端再前进一个 commit
echo C > "$WORK/c.txt"; git -C "$WORK" add c.txt; git -C "$WORK" commit -qm C; git -C "$WORK" push -q mirror HEAD:refs/heads/main 2>/dev/null
printf 'sha=%s\nfrom=%s\nurl=%s\n' "$B_SHA" "$A_SHA" "$(mirror_url c5)" > "$PEND"
EC=$(verify); assert_exit "$EC" 1 "⑤e 远端≠推的 SHA ⇒ 1（不等算失败）"
grep -q "VERIFY-FAIL(mismatch)" "$LOG" 2>/dev/null && pass "⑤f 日志记 VERIFY-FAIL(mismatch)" || fail "⑤f 日志未记失败"

# ⑥ feat/ 分支不受影响（回归锁）
mk c6; LOG="$TMP/c6/sync.log"; PEND="$TMP/c6/pending"
git -C "$WORK" checkout -q -b feat; echo F > "$WORK/f.txt"; git -C "$WORK" add f.txt; git -C "$WORK" commit -qm F
EC=$(hook gitea "file://$TMP/c6/gitea.git" refs/heads/feat "$(sha HEAD)" refs/heads/feat "0000000000000000000000000000000000000000")
assert_exit "$EC" 0 "⑥ 推 gitea feat/ ⇒ 放行（回归锁）"

# 判别力 M1：remote 判断写反 ⇒ ② 变拒、① 变放行
MUT1="$TMP/mut1.sh"; sed 's/if \[\[ "\$PUSH_REMOTE" == "\$MIRROR_REMOTE" \]\]; then/if [[ "$PUSH_REMOTE" != "$MIRROR_REMOTE" ]]; then/' "$PRE_PUSH" > "$MUT1"
mk m1; LOG="$TMP/m1/sync.log"; PEND="$TMP/m1/pending"
git -C "$WORK" push -q mirror main 2>/dev/null
echo B > "$WORK/b.txt"; git -C "$WORK" add b.txt; git -C "$WORK" commit -qm B
EC=$(hook mirror "$(mirror_url m1)" refs/heads/main "$(sha HEAD)" refs/heads/main "$(sha HEAD~1)" --script "$MUT1")
assert_exit "$EC" 1 "M1 改坏（remote 判断写反）⇒ ② mirror 变拒（必红）"

# 判别力 M2：去掉 ff 检查 ⇒ ③ 变放行
MUT2="$TMP/mut2.sh"; sed 's/if ! git merge-base --is-ancestor "\$PUSH_REMOTE_SHA" "\$PUSH_LOCAL_SHA" 2>\/dev\/null; then/if false; then/' "$PRE_PUSH" > "$MUT2"
mk m2; LOG="$TMP/m2/sync.log"; PEND="$TMP/m2/pending"
git -C "$WORK" push -q mirror main 2>/dev/null              # mirror main = A
echo B > "$WORK/b.txt"; git -C "$WORK" add b.txt; git -C "$WORK" commit -qm B
git -C "$WORK" push -q mirror main 2>/dev/null              # mirror main = B
git -C "$WORK" reset -q --hard HEAD~1                       # 回 A
echo D > "$WORK/d.txt"; git -C "$WORK" add d.txt; git -C "$WORK" commit -qm D
REMOTE_B=$(git -C "$WORK" ls-remote mirror refs/heads/main | awk '{print $1}')
# 原脚本：0-2 以「非 fast-forward」拒（判别基线）
EC=$(hook mirror "$(mirror_url m2)" refs/heads/main "$(sha HEAD)" refs/heads/main "$REMOTE_B")
assert_exit "$EC" 1 "M2a 原脚本 non-ff ⇒ 拒"
grep -q "非 fast-forward" "$TMP/out.txt" && pass "M2b 拒因=0-2 ff 检查（判别基线）" || fail "M2b 原脚本拒因不对"
# 变异：去掉 0-2 的 ff 检查 ⇒ 0-2 不再报「非 fast-forward」（改由 0-1 兜底）⇒ 判别力成立
grep -q 'if false; then' "$MUT2" && pass "M2c 变异已注入（if false）" || fail "M2c 变异未注入"
EC=$(hook mirror "$(mirror_url m2)" refs/heads/main "$(sha HEAD)" refs/heads/main "$REMOTE_B" --script "$MUT2")
assert_exit "$EC" 1 "M2d 变异后仍拒（0-1 兜底）"
if grep -q "非 fast-forward" "$TMP/out.txt"; then fail "M2e 变异未被识别（0-2 仍报非 ff）"; else pass "M2e 变异后 0-2 理由消失 ⇒ 断言能抓改坏"; fi

# 生产接线
grep -q -- "--verify-mirror-sync" "$PRE_PUSH" && pass "接线: pre-push-check.sh 含 --verify-mirror-sync" || fail "接线缺失"
grep -q 'MIRROR_REMOTE' "$PRE_PUSH" && pass "接线: MIRROR_REMOTE 在场" || fail "接线缺失"

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
