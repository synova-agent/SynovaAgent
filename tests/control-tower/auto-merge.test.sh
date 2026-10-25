#!/usr/bin/env bash
# @requires python3
# auto-merge.test.sh — 配对测试（#953/#954；U7/CT-40）
# 覆盖：无 token／非法参数／API 不可达／--help／受保护清单存在 ＋ 调用 mock 行为测试（分页/改名）
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$ROOT/scripts/control-tower/auto-merge.sh"
PASS=0; FAIL=0; ok(){ PASS=$((PASS+1)); echo "  ✅ $1"; }; no(){ FAIL=$((FAIL+1)); echo "  ❌ $1"; }
chk(){ [ "$1" = "$2" ] && ok "$3" || no "$3（期望 $1 实际 $2）"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "── 1. 无 token ⇒ exit 2 + E_TOKEN ──"
out="$(cd "$ROOT" && env -u GITEA_TOKEN HOME="$TMP" bash "$S" 2>&1)"; chk 2 "$?" "无 token exit 2"
case "$out" in *E_TOKEN*) ok "打印 E_TOKEN";; *) no "缺 E_TOKEN";; esac

echo "── 2. 非法参数 ⇒ exit 2 ──"
GITEA_TOKEN=fake bash "$S" --bogus >/dev/null 2>&1; chk 2 "$?" "非法参数 exit 2"

echo "── 3. API 不可达（SYNO_GITEA_BASE 接缝）⇒ exit 2 ──"
GITEA_TOKEN=fake SYNO_GITEA_BASE=http://127.0.0.1:9/nope bash "$S" >/dev/null 2>&1; chk 2 "$?" "不可达 API exit 2"

echo "── 4. 受保护清单存在且含 scripts/control-tower/** ──"
grep -q "scripts/control-tower/\*\*" "$ROOT/.gitea/protected-files.txt" && ok "清单含该模式" || no "清单缺该模式"

echo "── 5. --help ⇒ exit 0 ──"
GITEA_TOKEN=fake bash "$S" --help >/dev/null 2>&1; chk 0 "$?" "--help exit 0"

echo "── 6. mock 行为测试（分页第 2 页受保护 / previous_filename 改名绕过）──"
PYBIN2=""
for _c in python3 python py; do command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN2="$_c" && break; done
if [ -n "$PYBIN2" ]; then
  if "$PYBIN2" "$ROOT/tests/control-tower/auto_merge_mock_test.py"; then ok "mock 行为测试通过"; else no "mock 行为测试失败"; fi
else no "无 python，跳过 mock 行为测试"; fi

echo; echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"; [ "$FAIL" = "0" ] || exit 1
