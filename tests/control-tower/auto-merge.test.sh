#!/usr/bin/env bash
# auto-merge.test.sh — 配对测试（#953；U7/CT-40）
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$ROOT/scripts/control-tower/auto-merge.sh"
PASS=0; FAIL=0; ok(){ PASS=$((PASS+1)); echo "  ✅ $1"; }; no(){ FAIL=$((FAIL+1)); echo "  ❌ $1"; }
chk(){ [ "$1" = "$2" ] && ok "$3" || no "$3（期望 $1 实际 $2）"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "── 1. 无 token ⇒ exit 2 + E_TOKEN ──"
out="$(cd "$ROOT" && env -u GITEA_TOKEN HOME="$TMP" bash "$S" 2>&1)"; chk 2 "$?" "无 token exit 2"
case "$out" in *E_TOKEN*) ok "打印 E_TOKEN";; *) no "缺 E_TOKEN";; esac
echo "── 2. 非法参数 ⇒ exit 2 ──"
out="$(GITEA_TOKEN=fake bash "$S" --bogus 2>&1)"; chk 2 "$?" "非法参数 exit 2"
echo "── 3. 受保护路径判定（源码级：受保护清单含 scripts/control-tower/**）──"
grep -q "scripts/control-tower/\*\*" "$ROOT/.gitea/protected-files.txt" && ok "清单含 scripts/control-tower/**" || no "清单缺该模式"
echo "── 4. API 不可用 ⇒ exit 2（B2 回归，不假绿）──"
GITEA_TOKEN=invalid bash "$S" >/dev/null 2>&1; chk 2 "$?" "invalid token ⇒ exit 2"
echo "── 5. --help ⇒ exit 0 ──"
GITEA_TOKEN=fake bash "$S" --help >/dev/null 2>&1; chk 0 "$?" "--help exit 0"
echo; echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"; [ "$FAIL" = "0" ] || exit 1
