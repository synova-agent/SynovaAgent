#!/usr/bin/env bash
# k12-05-behavioral.test.sh — 配对测试（#1271 P0-4；U7/CT-40）
# 判据: ① 脚本语法可解析 ② 关键契约件在场（临时根/临时库/JWT_SECRET/探针参数/反例注入）
#       ③ 离开 git 仓库 ⇒ fail-closed（exit 2 + FIXTURE_RESULT=FAIL，绝不假绿）
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
S="$ROOT/scripts/control-tower/fixtures/k12-05-behavioral.sh"
PASS=0; FAIL=0; ok(){ PASS=$((PASS+1)); echo "  ✅ $1"; }; no(){ FAIL=$((FAIL+1)); echo "  ❌ $1"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "── 1. 语法 ──"
if bash -n "$S" 2>/dev/null; then ok "bash -n 通过"; else no "bash -n 失败"; fi

echo "── 2. 契约件在场（缺一即红）──"
for token in "mktemp -d" "trap cleanup EXIT" "SYNOVA_DB_PATH" "SYNOVA_PRESETS_ROOT" "JWT_SECRET" \
             "--base-url" "--presets-root" "K12_FIXTURE_BREAK" "FIXTURE_RESULT"; do
  if grep -qF -- "$token" "$S"; then ok "含 ${token}"; else no "缺 ${token}"; fi
done

echo "── 3. 非 git 仓库 ⇒ fail-closed ──"
out="$(cd "$TMP" && bash "$S" 2>&1)"; rc=$?
[ "$rc" = "2" ] && ok "非 git 仓 exit 2" || no "非 git 仓应 exit 2，实际 $rc"
case "$out" in *FIXTURE_RESULT=FAIL*) ok "打印 FIXTURE_RESULT=FAIL";; *) no "未打印 FIXTURE_RESULT=FAIL: $out";; esac

echo; echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" = "0" ] || exit 1
