#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# push-sync-guard.test.sh — D334 门禁 0 多机同步检查测试
#
# 覆盖（铁律 48: 正常/降级/边界; 铁律 0-2: red→green）:
#   1. main 直接 push → exit 1（red: 无检查 → exit 0）
#   2. main + SYNO_ALLOW_MAIN_PUSH=1 逃生舱 → exit 0
#   3. 本地落后远端（远端有新 commit）→ exit 1 + 提示 pull
#   4. 本地与远端分叉（双向新 commit）→ exit 1 + 提示 rebase
#   5. 本地领先/与远端同步 → exit 0
#   6. fetch 失败（remote 不存在）→ fail-open exit 0 + 显式提示（铁律 11 不静默）
#   7. 无 refs 输入（非 hook 环境调用）→ fail-open exit 0 + 显式提示
#   8. 生产接线: install-hooks.sh 的 pre-push entry 含 "$1"（D334 传 remote 参数，
#      旧格式零参数会让门禁 0 拿不到 remote → 退化）(red: 无 → 断言失败)
#   9. 生产接线: pre-push-check.sh 主流程调用 check_push_sync（red: 零调用 → 失败）
#   10. 删除操作 (git push --delete, local_sha 全零) → 跳过同步检查 exit 0（D457）
#   11. #617: HEAD 过期 + 被推 ref 是远端后代 → 放行（old: HEAD..FETCH_HEAD 会误拦）
#   12. #617: 显式 sha 造"假分叉" → 拦；恢复（被推 ref=远端 tip）→ 放行（改坏必红）
#
# 隔离: mktemp 临时 bare 远端 + 本地仓库, file:// 协议零网络。
#       SYNO_SYNC_ONLY=1 → 只跑门禁 0, 不触及其他门禁。
# 用法: bash tests/control-tower/push-sync-guard.test.sh
# 退出码: 0 = 全部通过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRE_PUSH="$REPO_DIR/scripts/pre-push-check.sh"
INSTALL_HOOKS="$REPO_DIR/scripts/install-hooks.sh"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_exit() { # <got> <want> <msg>
  if [ "$1" -eq "$2" ]; then pass "$3"; else fail "$3 (got exit=$1, want exit=$2)"; fi
}

# ── 测试沙箱: 本地仓库 + bare 远端 ──
REMOTE_DIR=$(mktemp -d /tmp/pss-remote.XXXXXX)
LOCAL_DIR=$(mktemp -d /tmp/pss-local.XXXXXX)
git init --bare -q "$REMOTE_DIR"
git init -q "$LOCAL_DIR"
git -C "$LOCAL_DIR" remote add origin "file://$REMOTE_DIR"
git -C "$LOCAL_DIR" config user.email t@t
git -C "$LOCAL_DIR" config user.name t

# 用第二个 clone 模拟"另一台机器"向远端推提交
OTHER_DIR=$(mktemp -d /tmp/pss-other.XXXXXX)
git clone -q "file://$REMOTE_DIR" "$OTHER_DIR" 2>/dev/null # swallow-ok: 测试沙箱克隆, 失败由后续断言暴露
git -C "$OTHER_DIR" config user.email w@w
git -C "$OTHER_DIR" config user.name w

# helper: 在指定仓库做一个空提交
commit_empty() { # <repo> <file> <msg>
  local r="$1" f="$2" m="$3"
  echo "$m" > "$r/$f"
  git -C "$r" add "$f" 2>/dev/null # swallow-ok: 测试辅助暂存, 失败由后续断言暴露
  git -C "$r" commit -q -m "$m"
}

# helper: 以 hook 方式调用门禁 0
# run_sync <local_dir> <remote_name> <remote_url> <branch_ref> <extra_env>
# helper: remote ref 的真实 sha（#617：stdin 第 4 字段必须是远端真身，不能拿本地 sha 冒充）
remote_sha_of() { # <dir> <remote> <ref>
  local s
  s=$(git -C "$1" ls-remote "$2" "$3" 2>/dev/null | awk '{print $1; exit}')
  [ -z "$s" ] && s="0000000000000000000000000000000000000000"
  printf '%s\n' "$s"
}
run_sync() {
  local dir="$1" rname="$2" rurl="$3" bref="$4" envs="$5"
  local sha rsha
  sha=$(git -C "$dir" rev-parse HEAD)
  rsha=$(remote_sha_of "$dir" "$rname" "$bref")
  ( cd "$dir" && \
    printf '%s %s %s %s\n' "$bref" "$sha" "$bref" "$rsha" | \
    env $envs SYNO_SYNC_ONLY=1 bash "$PRE_PUSH" "$rname" "$rurl" > /tmp/pss-out.txt 2>&1 )
  echo $?
}
# helper: 显式给定 local/remote sha（#617 用）
run_sync_sha() { # <dir> <rname> <rurl> <local_ref> <local_sha> <remote_ref> <remote_sha> <envs>
  local dir="$1" rname="$2" rurl="$3" lref="$4" lsha="$5" rref="$6" rsha="$7" envs="$8"
  ( cd "$dir" && \
    printf '%s %s %s %s\n' "$lref" "$lsha" "$rref" "$rsha" | \
    env $envs SYNO_SYNC_ONLY=1 bash "$PRE_PUSH" "$rname" "$rurl" > /tmp/pss-out.txt 2>&1 )
  echo $?
}

echo "=== D334 门禁 0: push-sync-guard 测试 ==="

# 1. main 直接 push → 阻断
commit_empty "$LOCAL_DIR" a.txt "A"
EC=$(run_sync "$LOCAL_DIR" origin "file://$REMOTE_DIR" "refs/heads/main" "")
assert_exit "$EC" 1 "1. main 直推 → 硬阻断"
grep -q "0-2" /tmp/pss-out.txt && pass "   阻断消息含门禁 0-2" || fail "   阻断消息缺门禁 0-2 标识"

# 2. main + 逃生舱 → 放行 + 真实写 bypass.log（D571: 断言审计链，此前只 echo 未写入）
ESCAPE_LOG=$(mktemp /tmp/pss-bypass.XXXXXX)
EC=$( ( cd "$LOCAL_DIR" && \
  printf '%s %s %s %s\n' "refs/heads/main" "$(git rev-parse HEAD)" "refs/heads/main" "$(git rev-parse HEAD)" | \
  env SYNO_ALLOW_MAIN_PUSH=1 SYNO_BYPASS_LOG="$ESCAPE_LOG" SYNO_SYNC_ONLY=1 bash "$PRE_PUSH" origin "file://$REMOTE_DIR" > /tmp/pss-out.txt 2>&1; echo $? ) )
assert_exit "$EC" 0 "2. main + SYNO_ALLOW_MAIN_PUSH=1 逃生舱 → 放行"
if grep -q "ALLOW_MAIN_PUSH" "$ESCAPE_LOG" 2>/dev/null; then
  pass "2b. 逃生舱真实写 bypass.log（ALLOW_MAIN_PUSH 条目存在，D571 审计链闭环）"
else
  fail "2b. 逃生舱未写 bypass.log（审计链断裂——echo 声称已记但无落盘）"
fi
rm -f "$ESCAPE_LOG"

# 准备基线: 本地推送 A 到远端 feat/test 分支
git -C "$LOCAL_DIR" push -q origin HEAD:feat/test 2>/dev/null # swallow-ok: 基线推送, 失败由后续断言暴露

# 3. 落后: 另一台机器推 B, 本地只有 A
git -C "$OTHER_DIR" pull -q origin feat/test 2>/dev/null || git -C "$OTHER_DIR" fetch -q origin feat/test 2>/dev/null || true
git -C "$OTHER_DIR" checkout -q feat/test 2>/dev/null || git -C "$OTHER_DIR" checkout -q -b feat/test origin/feat/test 2>/dev/null || true
commit_empty "$OTHER_DIR" b.txt "B"
git -C "$OTHER_DIR" push -q origin HEAD:feat/test 2>/dev/null # swallow-ok: 模拟另一台机器推送, 失败由后续断言暴露
EC=$(run_sync "$LOCAL_DIR" origin "file://$REMOTE_DIR" "refs/heads/feat/test" "")
assert_exit "$EC" 1 "3. 本地落后远端 → 硬阻断"
grep -q "0-1" /tmp/pss-out.txt && pass "   阻断消息含门禁 0-1" || fail "   阻断消息缺门禁 0-1 标识"

# 4. 分叉: 本地基于 A 提交 C, 远端已有 B (基于 A)
commit_empty "$LOCAL_DIR" c.txt "C"
EC=$(run_sync "$LOCAL_DIR" origin "file://$REMOTE_DIR" "refs/heads/feat/test" "")
assert_exit "$EC" 1 "4. 本地与远端分叉 → 硬阻断"
grep -q "分叉" /tmp/pss-out.txt && pass "   阻断消息含分叉提示" || fail "   阻断消息缺分叉提示"

# 5. 同步: 本地领先（远端=本地历史的前缀）— force push 到测试 bare 远端
#    （模拟真实场景: 本地 push 成功后远端=本地）
git -C "$LOCAL_DIR" push -q --force origin HEAD:feat/test 2>/dev/null # swallow-ok: 测试 bare 远端强制同步, 失败由后续断言暴露
EC=$(run_sync "$LOCAL_DIR" origin "file://$REMOTE_DIR" "refs/heads/feat/test" "")
assert_exit "$EC" 0 "5. 本地与远端同步 → 放行"
BASE_C=$(git -C "$LOCAL_DIR" rev-parse HEAD)  # case 5 同步点（远端=本地）

# 6. fetch 失败（remote 不存在）→ fail-open 显式提示
commit_empty "$LOCAL_DIR" d.txt "D"
EC=$(run_sync "$LOCAL_DIR" ghost "file:///nonexistent-xyz" "refs/heads/feat/test" "")
assert_exit "$EC" 0 "6. fetch 失败 → fail-open 放行"
grep -q "fail-open" /tmp/pss-out.txt && pass "   fail-open 有显式提示（不静默）" || fail "   fail-open 缺显式提示（静默降级）"

# 7. 无 refs 输入（非 hook 调用）→ fail-open
EC=$( ( cd "$LOCAL_DIR" && SYNO_SYNC_ONLY=1 bash "$PRE_PUSH" origin "file://$REMOTE_DIR" < /dev/null > /tmp/pss-out7.txt 2>&1; echo $? ) )
assert_exit "$EC" 0 "7. 无 refs 输入 → fail-open 放行"

# 8. 生产接线: install-hooks.sh pre-push entry 传 "$1"（remote 参数）
if grep -q 'pre-push-check.sh" "\$1" "\$2"' "$INSTALL_HOOKS"; then
  pass "8. install-hooks.sh pre-push entry 传 remote 参数 (\$1 \$2)"
else
  fail "8. install-hooks.sh pre-push entry 未传 remote 参数（门禁 0 拿不到 remote → 退化）"
fi

# 9. 生产接线: pre-push-check.sh 主流程调用 check_push_sync
SYNC_CALLS=$(grep -c "check_push_sync \"\$PUSH_REMOTE\"" "$PRE_PUSH" | tr -d ' \n' || echo 0)
if [ "${SYNC_CALLS:-0}" -ge 1 ]; then
  pass "9. pre-push-check.sh 主流程调用 check_push_sync ($SYNC_CALLS 处)"
else
  fail "9. pre-push-check.sh 主流程零调用 check_push_sync（未接线）"
fi

# 10. 删除操作 (local_sha 全零) → 跳过同步检查 exit 0（D457）
ZERO_SHA="0000000000000000000000000000000000000000"
EC=$( ( cd "$LOCAL_DIR" && \
  printf '%s %s %s %s\n' "refs/heads/feat/test" "$ZERO_SHA" "refs/heads/feat/test" "$(git rev-parse HEAD)" | \
  SYNO_SYNC_ONLY=1 bash "$PRE_PUSH" origin "file://$REMOTE_DIR" > /tmp/pss-out10.txt 2>&1; echo $? ) )
assert_exit "$EC" 0 "10. 删除操作 (local_sha 全零) → 跳过同步检查 exit 0"
grep -q "删除操作" /tmp/pss-out10.txt && pass "   删除操作有跳过提示（不静默）" || fail "   删除操作缺跳过提示"

# 11. #617: HEAD 过期 + 被推 ref 是远端后代 → 放行
#     远端: C（case 5 同步点）→ OTHER 从 C 推 E（E 是 C 的后代）；本地 HEAD 停在 C，只 fetch 不前进
git -C "$OTHER_DIR" fetch -q origin feat/test 2>/dev/null # swallow-ok: 取远端 tip, 失败由后续断言暴露
git -C "$OTHER_DIR" checkout -q -B feat/test FETCH_HEAD 2>/dev/null # swallow-ok: 对齐远端 tip C
commit_empty "$OTHER_DIR" e.txt "E"
git -C "$OTHER_DIR" push -q origin HEAD:feat/test 2>/dev/null # swallow-ok: 模拟另一台机器推 E, 失败由后续断言暴露
git -C "$LOCAL_DIR" reset -q --hard "$BASE_C" # HEAD 回到 C（过期），模拟"主树 HEAD 落后"
git -C "$LOCAL_DIR" fetch -q origin feat/test 2>/dev/null # swallow-ok: 拉远端 E 到本地, 失败由后续断言暴露
STALE_HEAD=$(git -C "$LOCAL_DIR" rev-parse HEAD)
git -C "$LOCAL_DIR" branch -f feat/push FETCH_HEAD 2>/dev/null # swallow-ok: 本地分支指向远端 tip E
PUSH_SHA=$(git -C "$LOCAL_DIR" rev-parse feat/push)
REMOTE_SHA=$(git -C "$LOCAL_DIR" rev-parse FETCH_HEAD)
EC=$(run_sync_sha "$LOCAL_DIR" origin "file://$REMOTE_DIR" "refs/heads/feat/push" "$PUSH_SHA" "refs/heads/feat/test" "$REMOTE_SHA" "")
assert_exit "$EC" 0 "11. HEAD 过期（$(echo "$STALE_HEAD" | cut -c1-7)）+ 被推 ref 是远端后代 → 放行（#617）"
grep -q "被推 ref 与远端同步" /tmp/pss-out.txt && pass "   放行消息按「被推 ref」口径" || fail "   放行消息未按被推 ref 口径"

# 12. 假分叉 → 拦；恢复 → 放行（改坏必红）
git -C "$LOCAL_DIR" checkout -q -B feat/div "$BASE_C" 2>/dev/null # swallow-ok: 从 C 造分叉提交（与远端 E 互为兄弟）
commit_empty "$LOCAL_DIR" f.txt "F"
DIV_SHA=$(git -C "$LOCAL_DIR" rev-parse feat/div)
EC=$(run_sync_sha "$LOCAL_DIR" origin "file://$REMOTE_DIR" "refs/heads/feat/div" "$DIV_SHA" "refs/heads/feat/test" "$REMOTE_SHA" "")
assert_exit "$EC" 1 "12a. 被推 ref 与远端分叉 → 硬阻断"
grep -q "分叉" /tmp/pss-out.txt && pass "   阻断消息含分叉提示" || fail "   阻断消息缺分叉提示"
EC=$(run_sync_sha "$LOCAL_DIR" origin "file://$REMOTE_DIR" "refs/heads/feat/push" "$REMOTE_SHA" "refs/heads/feat/test" "$REMOTE_SHA" "")
assert_exit "$EC" 0 "12b. 恢复（被推 ref=远端 tip）→ 放行（改坏必红）"

# 清理
rm -rf "$REMOTE_DIR" "$LOCAL_DIR" "$OTHER_DIR" /tmp/pss-out*.txt

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
