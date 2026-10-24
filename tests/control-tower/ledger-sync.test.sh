#!/usr/bin/env bash
# ledger-sync.test.sh — 配对测试（#953；U7/CT-40）
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$ROOT/scripts/control-tower/ledger-sync.sh"
PASS=0; FAIL=0; ok(){ PASS=$((PASS+1)); echo "  ✅ $1"; }; no(){ FAIL=$((FAIL+1)); echo "  ❌ $1"; }
chk(){ [ "$1" = "$2" ] && ok "$3" || no "$3（期望 $1 实际 $2）"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "── 1. 无 token ⇒ exit 2 + E_TOKEN ──"
out="$(cd "$ROOT" && env -u GITEA_TOKEN HOME="$TMP" bash "$S" 2>&1)"; chk 2 "$?" "无 token exit 2"
case "$out" in *E_TOKEN*) ok "打印 E_TOKEN";; *) no "缺 E_TOKEN";; esac
echo "── 2. 非法参数 ⇒ exit 2 ──"
out="$(GITEA_TOKEN=fake bash "$S" --bogus 2>&1)"; chk 2 "$?" "非法参数 exit 2"
echo "── 3. dry-run 生成 §G 行（临时仓）──"
R="$TMP/repo"; mkdir -p "$R"; cd "$R"; git init -q -b main .; git config user.email t@t; git config user.name t
echo a>a; git add a; git commit -qm init; git checkout -qb feat; echo c>c; git add c; git commit -qm side
git checkout -q main; echo d>d; git add d; git commit -qm mainside
git merge -q --no-ff feat -m "Merge pull request 'feat(#999): demo' from feat into main"
chk 1 "$(git rev-list --merges --count HEAD)" "临时仓有 1 个 merge"
out="$(GITEA_TOKEN=fake SYNO_LEDGER_SYNC_STATE="$TMP/state" bash "$S" 2>&1)"; chk 0 "$?" "dry-run exit 0"
case "$out" in *自动同步*) ok "生成 §G 行";; *) no "未生成: $out";; esac
case "$out" in *dry-run*) ok "标注 dry-run";; *) no "缺 dry-run";; esac
echo "── 4. --apply 无网 ⇒ exit 2 ──"
GITEA_TOKEN=invalid SYNO_LEDGER_SYNC_STATE="$TMP/state2" bash "$S" --apply >/dev/null 2>&1; chk 2 "$?" "--apply 无网 exit 2"
echo; echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"; [ "$FAIL" = "0" ] || exit 1
