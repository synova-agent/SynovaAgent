#!/usr/bin/env bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-dual-repo-sync.test.sh — CT-40 强制配对测试（任务 #609）
#
# 被测: scripts/control-tower/check-dual-repo-sync.sh
# 配对规则: scripts/control-tower/<name>.sh ↔ tests/control-tower/<name>.test.sh
# 规格源: 卡 #609 ＋ K3 审计（#594 / commit 14e7177）P1-2 ＋ K3 P11（假绿陷阱已证）
#
# 覆盖（6 个判定点，全部零网络 —— 用本地 bare 仓当"远端"）:
#   T0 --help            参数完备，exit 0
#   T1 OK                lag=0、ancestor=true         ⇒ exit 0
#   T2 LAG               远端领先 2                   ⇒ exit 1、lag=2
#   T3 DEGRADED          Gitea 远端读不到             ⇒ exit 2（禁当"差=0"）
#   T4 🔴 改坏必红       本地 local-main 陈旧（naive 算得 0 假绿）⇒ 必须 exit 1、lag=2
#   T5 FORK              GitHub main 非祖先           ⇒ exit 1、verdict=FORK
#   T6 JSON 落固定路径   schema/字段齐、degraded=false
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECKER="$ROOT/scripts/control-tower/check-dual-repo-sync.sh"
[ -f "$CHECKER" ] || { echo "❌ 被测脚本不存在: $CHECKER"; exit 2; }

PASS=0; FAIL=0; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
assert_rc() { [ "$2" = "$3" ] && ok "$1（rc=$3）" || bad "$1（期望 rc=$3，实得 rc=$2）"; }
assert_has(){ grep -q -- "$2" "$3" 2>/dev/null && ok "$1" || bad "$1（JSON 缺 $2）"; }

g() { git -C "$1" "${@:2}"; }

# ── 夹具：两个 bare 仓当远端 ＋ 一个工作仓（提交都在工作仓里，供脚本本地判定）──
git init -q --bare "$TMP/gitea.git"
git init -q --bare "$TMP/mirror.git"
git init -q "$TMP/work"
g "$TMP/work" config user.email t@t; g "$TMP/work" config user.name t
echo a > "$TMP/work/a.txt"; g "$TMP/work" add -A; g "$TMP/work" commit -qm A
A="$(g "$TMP/work" rev-parse HEAD)"
g "$TMP/work" push -q "$TMP/gitea.git" "HEAD:refs/heads/local-main"
g "$TMP/work" push -q "$TMP/mirror.git" "HEAD:refs/heads/main"

echo "T0 --help"
bash "$CHECKER" --help >/dev/null 2>&1; assert_rc "--help 可用" "$?" 0

echo "T1 OK（两仓一致）"
OUT1="$TMP/out1.json"
SYNO_SYNC_REPO="$TMP/work" SYNO_SYNC_GITEA_URL="$TMP/gitea.git" \
SYNO_SYNC_GITHUB_SHA="$A" SYNO_DUAL_REPO_OUT="$OUT1" \
  bash "$CHECKER" >"$TMP/log1" 2>&1; assert_rc "lag=0 判绿" "$?" 0
assert_has "JSON has schema" '"schema": "syno-dual-repo-sync/v1"' "$OUT1"
assert_has "JSON lag=0" '"lag": 0' "$OUT1"
assert_has "JSON degraded=false" '"degraded": false' "$OUT1"

echo "T2 LAG（远端领先 2）"
echo b > "$TMP/work/b.txt"; g "$TMP/work" add -A; g "$TMP/work" commit -qm B
echo c > "$TMP/work/c.txt"; g "$TMP/work" add -A; g "$TMP/work" commit -qm C
C="$(g "$TMP/work" rev-parse HEAD)"
g "$TMP/work" push -q "$TMP/gitea.git" "HEAD:refs/heads/local-main"
OUT2="$TMP/out2.json"
SYNO_SYNC_REPO="$TMP/work" SYNO_SYNC_GITEA_URL="$TMP/gitea.git" \
SYNO_SYNC_GITHUB_SHA="$A" SYNO_DUAL_REPO_OUT="$OUT2" \
  bash "$CHECKER" >"$TMP/log2" 2>&1; assert_rc "滞后判红" "$?" 1
assert_has "JSON lag=2" '"lag": 2' "$OUT2"

echo "T3 DEGRADED（Gitea 远端读不到）"
OUT3="$TMP/out3.json"
SYNO_SYNC_REPO="$TMP/work" SYNO_SYNC_GITEA_URL="$TMP/does-not-exist.git" \
SYNO_SYNC_GITHUB_SHA="$A" SYNO_DUAL_REPO_OUT="$OUT3" \
  bash "$CHECKER" >"$TMP/log3" 2>&1; assert_rc "读不到 ⇒ degraded" "$?" 2
assert_has "JSON degraded=true" '"degraded": true' "$OUT3"
assert_has "JSON reason=gitea_unreadable" '"reason": "gitea_unreadable"' "$OUT3"

echo "T4 🔴 改坏必红：本地 local-main 陈旧 ⇒ naive 算得 0（假绿），探针必须红"
# 造"本地指针落后"现场：本地分支 local-main 停在 A，而 Gitea 远端已是 C
g "$TMP/work" branch -f local-main "$A"
NAIVE="$(g "$TMP/work" rev-list --count "$A..local-main")"
echo "     原始输出（陷阱证据）: git rev-list --count <gh_main=$A>..local-main = $NAIVE"
OUT4="$TMP/out4.json"
SYNO_SYNC_REPO="$TMP/work" SYNO_SYNC_GITEA_URL="$TMP/gitea.git" \
SYNO_SYNC_GITHUB_SHA="$A" SYNO_DUAL_REPO_OUT="$OUT4" \
  bash "$CHECKER" >"$TMP/log4" 2>&1; RC4=$?
if [ "$NAIVE" = "0" ] && [ "$RC4" = "1" ]; then
  ok "陷阱被自己拦掉（naive=0 但探针 rc=1）"
else
  bad "陷阱未被拦（naive=$NAIVE 探针 rc=$RC4）"; cat "$TMP/log4"
fi
assert_has "探针 JSON lag=2（不是 0）" '"lag": 2' "$OUT4"
echo "     探针原始输出: $(tail -1 "$TMP/log4")"

echo "T5 FORK（GitHub main 非祖先）"
g "$TMP/work" checkout -q -b fork "$A"
echo d > "$TMP/work/d.txt"; g "$TMP/work" add -A; g "$TMP/work" commit -qm D
g "$TMP/work" push -q -f "$TMP/mirror.git" "HEAD:refs/heads/main"
D_SHA="$(g "$TMP/work" rev-parse HEAD)"
OUT5="$TMP/out5.json"
SYNO_SYNC_REPO="$TMP/work" SYNO_SYNC_GITEA_URL="$TMP/gitea.git" \
SYNO_SYNC_GITHUB_SHA="$D_SHA" SYNO_DUAL_REPO_OUT="$OUT5" \
  bash "$CHECKER" >"$TMP/log5" 2>&1; assert_rc "分叉判红" "$?" 1
assert_has "JSON verdict=FORK" '"verdict": "FORK"' "$OUT5"

echo "T6 固定路径 + --json 纯 JSON"
OUT6="$TMP/out6.json"
SYNO_SYNC_REPO="$TMP/work" SYNO_SYNC_GITEA_URL="$TMP/gitea.git" \
SYNO_SYNC_GITHUB_SHA="$D_SHA" SYNO_DUAL_REPO_OUT="$OUT6" \
  bash "$CHECKER" --json >"$TMP/stdout6" 2>/dev/null   # swallow-ok: 本步只验 stdout 形态，rc 不判
head -1 "$TMP/stdout6" | grep -q '^{' && ok "--json stdout 是 JSON" || bad "--json stdout 不是 JSON"

echo "──────────────────────────────────────────────"
echo "汇总: 通过 $PASS / 失败 $FAIL"
[ "$FAIL" = "0" ] && { echo "✅ 全部通过"; exit 0; } || { echo "❌ 有失败"; exit 1; }
