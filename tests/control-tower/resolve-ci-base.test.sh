#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# resolve-ci-base.test.sh — CT-40 配对：#598 resolve-ci-base.sh
#
# 覆盖:
#   1. 契约（@input/@output/@exit 齐；可执行）
#   2. 显式 SYNO_BASE_REF → 原样输出
#   3. GITHUB_BASE_REF 裸 local-main（#1115 legacy 名）→ 规范化 gitea/main（并物化）
#   4. canonical 不可解析 ＋ 单远端 → fetch 物化 → 0
#   5. CI ＋ 单远端 → 刷新 canonical 后与 origin/main 一致 → 0
#   6. CI ＋ fetch 失败 ＋ canonical 不可解析 → 2（fail-closed，不猜）
#   7. CI ＋ 多远端 ＋ canonical 不可解析 → 不猜 → 2
#   8. 显式 base 不可解析 → 2
#   9. #1118 legacy 别名安全阀: local-main 与 canonical 同 SHA ⇒ 0（输出 gitea/main）
#  10. 阀-祖先: local-main 陈旧（canonical 的祖先）⇒ 0 ＋ 显式「容忍」告警（非静默）
#  11. 阀-分叉: local-main 与 canonical 互不为祖先 ⇒ 2 ＋ 点名「非同干」
#  12. 阀-领先: local-main 是 canonical 的子孙 ⇒ 2（别名会算出错误 diff）
#  13. 阀只管别名: 非别名的 `main` 不受影响 ⇒ 0（不误伤）
#  14. 改坏即红①: 删 `local-main)` 臂 ⇒ 用例 9 必红（输出退化为 local-main）
#  14b. 改坏即红②: 删阀里的 die ⇒ 用例 11 必红（分叉变 0）
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
git -C "$W" push -q origin HEAD:main 2>/dev/null; git -C "$W" fetch -q origin 2>/dev/null  # swallow-ok: 推/取失败 ⇒ 后续断言自身红（不静默放行）

# 2 显式 SYNO_BASE_REF
git -C "$W" branch -f feat/x HEAD 2>/dev/null
OUT=$( cd "$W" && SYNO_BASE_REF=feat/x bash "$HELPER" 2>/dev/null ); RC=$?
[ "$RC" -eq 0 ] && [ "$OUT" = "feat/x" ] && ok "2. 显式 SYNO_BASE_REF=feat/x → '$OUT'（0）" || no "2. 显式 base 失败 rc=${RC} out=${OUT}"

# 3 GITHUB_BASE_REF 裸 local-main（#1115 legacy 名）规范化（canonical 不可解析 → fetch 物化）
git -C "$W" update-ref -d refs/remotes/gitea/main 2>/dev/null || true
OUT=$( cd "$W" && GITHUB_BASE_REF=local-main bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: stderr 只含别名/刷新日志，判定看 rc/stdout
[ "$RC" -eq 0 ] && [ "$OUT" = "gitea/main" ] && ok "3. 裸 local-main → '$OUT'（0）" || no "3. 规范化失败 rc=${RC} out=${OUT}"

# 4 canonical 不可解析 + 单远端（非 CI）→ fetch 物化
git -C "$W" update-ref -d refs/remotes/gitea/main 2>/dev/null || true
OUT=$( cd "$W" && bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: 同上
CANON=$(git -C "$W" rev-parse --short refs/remotes/gitea/main 2>/dev/null)  # swallow-ok: 取不到 ⇒ 下一行断言自身红
[ "$RC" -eq 0 ] && [ "$OUT" = "gitea/main" ] && [ -n "$CANON" ] \
  && ok "4. 不可解析＋单远端 → 物化（canonical=${CANON}，0）" || no "4. 物化失败 rc=${RC} out=${OUT} canon=$CANON"

# 5 CI ＋ 单远端：远端前进 + fetch origin（origin/main 新）→ 刷新后一致 → 0
echo b > "$W/b.txt"; git -C "$W" add b.txt; git -C "$W" commit -qm B; git -C "$W" push -q origin HEAD:main 2>/dev/null  # swallow-ok: push 失败 ⇒ 后续断言自身红
git -C "$W" fetch -q origin 2>/dev/null  # swallow-ok: fetch 失败 ⇒ 后续断言自身红
OUT=$( cd "$W" && SYNO_CI=1 bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: 同上
[ "$RC" -eq 0 ] && ok "5. CI 刷新后与远端跟踪引用一致 → 0（canonical=$(git -C "$W" rev-parse --short refs/remotes/gitea/main)）" || no "5. CI 刷新失败 rc=$RC"

# 6 CI ＋ 单远端 fetch 失败 ＋ canonical 不可解析 → 2（fail-closed，不猜）
#   注: 「origin/main 陈旧」无法在此构造——fetch canonical 会同时刷新 origin/main
#   （git 行为实测），故新鲜度断言在真实 CI 里恒等；真正的保证是"每次 CI 都 fetch"本身。
git -C "$W" update-ref -d refs/remotes/gitea/main 2>/dev/null || true
git -C "$W" remote set-url origin "file:///nonexistent-rcb-xyz" 2>/dev/null
OUT=$( cd "$W" && SYNO_CI=1 bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: stderr 只含告警，判定看 rc
[ "$RC" -eq 2 ] && ok "6. CI ＋ fetch 失败 ＋ canonical 不可解析 → 2（fail-closed）" || no "6. fetch 失败应 2，实际 rc=${RC}"
git -C "$W" remote set-url origin "file://$ORIGIN" 2>/dev/null

# 7 CI + 多远端 + canonical 不可解析 → 2（不猜）
git -C "$W" remote add alt "file://$ORIGIN" 2>/dev/null || true
git -C "$W" update-ref -d refs/remotes/gitea/main 2>/dev/null || true
OUT=$( cd "$W" && SYNO_CI=1 bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: stderr 只含告警，判定看 rc
[ "$RC" -eq 2 ] && ok "7. 多远端＋不可解析＋CI → 2（不猜）" || no "7. 多远端应 2，实际 rc=$RC"

# 8 显式 base 不可解析 → 2
OUT=$( cd "$W" && SYNO_BASE_REF=no-such-ref bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: 只看 rc
[ "$RC" -eq 2 ] && ok "8. 显式不可解析 base → 2" || no "8. 坏 base 应 2，实际 rc=$RC"

# ══ #1118 legacy 别名安全阀（local-main ⇒ gitea/main 的非同干拒绝）══
echo ""
echo "── #1118 legacy 别名安全阀 ──"
# 复位: case 7 的 alt 远端会改变拓扑 ⇒ 删掉；物化 canonical（origin/main）
git -C "$W" remote remove alt 2>/dev/null || true  # swallow-ok: alt 是 case 7 夹具，删不掉不影响本段（canonical 下面显式物化）
git -C "$W" fetch -q origin '+refs/heads/main:refs/remotes/gitea/main' 2>/dev/null || true  # swallow-ok: 物化失败 ⇒ CANON_SHA 为空 ⇒ 下列断言自身红
CANON_SHA="$(git -C "$W" rev-parse --verify -q refs/remotes/gitea/main 2>/dev/null || true)"  # swallow-ok: 取不到 ⇒ 断言因空值红
A_SHA="$(git -C "$W" rev-list --max-parents=0 HEAD)"

# 9 同 SHA ⇒ 别名放行 → gitea/main（0）
git -C "$W" update-ref refs/heads/local-main "$CANON_SHA"
OUT=$( cd "$W" && SYNO_BASE_REF=local-main bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: stderr 只含别名/刷新日志
[ "$RC" -eq 0 ] && [ "$OUT" = "gitea/main" ] && ok "9. 同 SHA ⇒ 别名放行 → '$OUT'（0）" || no "9. 同 SHA 被拦 rc=${RC} out=${OUT}"

# 10 祖先（陈旧）⇒ 容忍 ＋ 显式告警（非静默）
git -C "$W" update-ref refs/heads/local-main "$A_SHA"
OUT=$( cd "$W" && SYNO_BASE_REF=local-main bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: 同上
ERRTXT=$( cd "$W" && SYNO_BASE_REF=local-main bash "$HELPER" 2>&1 >/dev/null )
[ "$RC" -eq 0 ] && [ "$OUT" = "gitea/main" ] && ok "10. 祖先陈旧 ⇒ 容忍（0，'$OUT'）" || no "10. 祖先应 0，实际 rc=${RC} out=${OUT}"
printf '%s' "$ERRTXT" | grep -q "容忍" && ok "10b. 容忍有显式告警（非静默）" || no "10b. 容忍无告警（静默放行）"

# 11 分叉（互不为祖先）⇒ 2 ＋ 点名非同干
CTREE=$(git -C "$W" rev-parse "$A_SHA^{tree}")
CSHA=$(echo side | git -C "$W" commit-tree "$CTREE" -p "$A_SHA")
git -C "$W" update-ref refs/heads/local-main "$CSHA"
OUT=$( cd "$W" && SYNO_BASE_REF=local-main bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: 只看 rc
ERRTXT=$( cd "$W" && SYNO_BASE_REF=local-main bash "$HELPER" 2>&1 >/dev/null )
[ "$RC" -eq 2 ] && ok "11. 分叉 ⇒ 2（fail-closed）" || no "11. 分叉应 2，实际 rc=${RC}"
printf '%s' "$ERRTXT" | grep -q "非同干" && ok "11b. 失败原因点名「非同干」（可诊断）" || no "11b. 未点名非同干: ${ERRTXT}"

# 12 领先（canonical 的子孙）⇒ 2（别名会算出错误 diff）
BTREE=$(git -C "$W" rev-parse "$CANON_SHA^{tree}")
DSHA=$(echo ahead | git -C "$W" commit-tree "$BTREE" -p "$CANON_SHA")
git -C "$W" update-ref refs/heads/local-main "$DSHA"
OUT=$( cd "$W" && SYNO_BASE_REF=local-main bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: 只看 rc
[ "$RC" -eq 2 ] && ok "12. 领先 ⇒ 2（fail-closed）" || no "12. 领先应 2，实际 rc=${RC}"

# 13 阀只管别名: 非别名的 `main` 不受影响（此时 local-main 仍领先）
OUT=$( cd "$W" && SYNO_BASE_REF=main bash "$HELPER" 2>/dev/null ); RC=$?  # swallow-ok: 只看 rc
[ "$RC" -eq 0 ] && [ "$OUT" = "gitea/main" ] && ok "13. 非别名 main 不受阀影响 → 0" || no "13. 非别名被误伤 rc=${RC} out=${OUT}"

# 14 改坏即红①: 删掉 `local-main)` 臂 ⇒ 用例 9 的断言必红
MUT="$TMPD/resolver-mutant-no-legacy-arm.sh"
grep -v 'local-main) BASE="gitea/main"; LEGACY_ALIAS=1' "$HELPER" > "$MUT"
chmod +x "$MUT"
git -C "$W" update-ref refs/heads/local-main "$CANON_SHA"
if [ "$(wc -l < "$MUT")" -lt "$(wc -l < "$HELPER")" ]; then
  MOUT=$( cd "$W" && SYNO_BASE_REF=local-main bash "$MUT" 2>/dev/null ); MRC=$?  # swallow-ok: 变异体输出即判据
  if [ "$MRC" -ne 0 ] || [ "$MOUT" != "gitea/main" ]; then
    ok "14. 改坏即红: 删 local-main 臂后 ⇒ rc=${MRC} out='${MOUT}'（≠gitea/main ⇒ 用例 9 必红）"
  else
    no "14. 改坏即红失效: 删臂后仍输出 gitea/main（判别力=0）"
  fi
else
  no "14. 变异体未生成（grep -v 未删到目标行 ⇒ 用例空转）"
fi

# 14b 改坏即红②: 删掉阀里的 die ⇒ 用例 11 的 2 会变 0（阀失去阻断力）
MUT2="$TMPD/resolver-mutant-no-valve-die.sh"
grep -v 'die "legacy 别名安全阀' "$HELPER" > "$MUT2"
chmod +x "$MUT2"
git -C "$W" update-ref refs/heads/local-main "$CSHA"
if [ "$(wc -l < "$MUT2")" -lt "$(wc -l < "$HELPER")" ]; then
  MOUT=$( cd "$W" && SYNO_BASE_REF=local-main bash "$MUT2" 2>/dev/null ); MRC=$?  # swallow-ok: 变异体输出即判据
  if [ "$MRC" -ne 2 ]; then
    ok "14b. 改坏即红: 删阀 die 后分叉 ⇒ rc=${MRC}（≠2 ⇒ 用例 11 必红）"
  else
    no "14b. 改坏即红失效: 删 die 后仍 2（判别力=0）"
  fi
else
  no "14b. 变异体未生成（grep -v 未删到 die 行 ⇒ 用例空转）"
fi

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
