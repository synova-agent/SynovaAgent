#!/usr/bin/env bash
# post-merge-gate.test.sh — 配对测试（CT-40）
# 判据：三态 0/1/2；--selfcheck 两态（红夹具⇒1，绿夹具⇒0）；坏 sha⇒2；非 git 根⇒2；真跑 main⇒0
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
S="$ROOT/scripts/control-tower/post-merge-gate.sh"
PASS=0; FAIL=0
chk() { if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  ✅ $3"; else FAIL=$((FAIL+1)); echo "  ❌ $3（期望 $2 实得 $1）"; fi; }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

echo "── 1. --selfcheck：红夹具⇒FAIL/1，绿夹具⇒PASS/0（两态）──"
out="$(bash "$S" --selfcheck 2>&1)"; rc=$?
chk "$rc" "0" "--selfcheck exit 0"
has "$out" "SELFCHECK-OK: 2/2" && chk "y" "y" "打印 SELFCHECK-OK 2/2" || chk "n" "y" "缺 SELFCHECK-OK"

echo "── 2. 坏 sha ⇒ exit 2（三态之 2，不谎报绿）──"
out="$(bash "$S" deadbeefdeadbeef 2>&1)"; rc=$?
chk "$rc" "2" "坏 sha exit 2"
has "$out" "E_PMG_SHA" && chk "y" "y" "打印 E_PMG_SHA" || chk "n" "y" "缺 E_PMG_SHA"

echo "── 3. 非 git 根 ⇒ exit 2 ──"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
out="$(SYNO_PMG_ROOT="$TMP" bash "$S" 2>&1)"; rc=$?
chk "$rc" "2" "非 git 根 exit 2"
has "$out" "E_PMG_ROOT" && chk "y" "y" "打印 E_PMG_ROOT" || chk "n" "y" "缺 E_PMG_ROOT"

echo "── 4. 真跑（当前仓 HEAD）⇒ exit 0 或 1（不许 2）；且汇总行存在 ──"
out="$(bash "$S" 2>&1)"; rc=$?
case "$rc" in 0|1) chk "ok" "ok" "真跑三态合法（rc=${rc}）";; *) chk "$rc" "0|1" "真跑落降级态";; esac
has "$out" "── 汇总:" && chk "y" "y" "有汇总行" || chk "n" "y" "缺汇总行"
has "$out" "POST-MERGE-GATE:" && chk "y" "y" "有结论行" || chk "n" "y" "缺结论行"

echo
echo "结果: ${PASS} 通过, ${FAIL} 失败"
[ "$FAIL" = "0" ] || exit 1
