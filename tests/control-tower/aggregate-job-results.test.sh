#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# aggregate-job-results.test.sh — W3/D1165 判别夹具（含**反例**）
#
# 被测物: scripts/control-tower/aggregate-job-results.py（聚合 job `all-checks-passed` 的判定体）
# 治的病: GitHub 把 `skipped` 当 success-ish ⇒ 「跳过=成功」通道（实测 success run 里 hermetic
#         step 被 skip 10/11 = 90.9%）。本器把 skipped 重判为 FAIL。
#
# 契约（铁律 47）
#   @input  env GATE   被测脚本路径（默认 scripts/control-tower/aggregate-job-results.py）
#           env PY     解释器（默认 python3）
#   @output 逐条 `PASS/FAIL` + 末行 `RESULT: <n> PASS / <m> FAIL`
#   @exit   0 = 全 PASS；1 = 有 FAIL；2 = 调用错误（被测脚本缺失）
#
# 判别性（V-08「改坏即红」）:
#   每条判红用例都有**绿对照**（同形状但 result=success ⇒ 必须 exit 0），
#   另有**反例**用例 ⑦（把白名单项从命令里去掉 ⇒ 同输入必须转红）——
#   证明"放行"确由白名单产生，而不是判定体根本不看 skipped。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

GATE="${GATE:-scripts/control-tower/aggregate-job-results.py}"
PY="${PY:-python3}"
[ -f "$GATE" ] || { echo "ERROR: 被测脚本不存在: $GATE" >&2; exit 2; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
PASS_N=0; FAIL_N=0
report() { # <name> <expect_rc> <got_rc> <expect_pat> <outfile>
  _ok=1
  [ "$2" = "$3" ] || _ok=0
  if [ -n "$4" ]; then grep -qF "$4" "$5" 2>/dev/null || _ok=0; fi
  if [ "$_ok" = "1" ]; then echo "PASS $1 (rc=$3)"; PASS_N=$((PASS_N+1));
  else echo "FAIL $1 expect_rc=$2 got_rc=$3 expect_pat='$4'"; FAIL_N=$((FAIL_N+1)); fi
}
run() { # run <json> <extra args...> → rc 存 RC，输出 /tmp/agg.out
  printf '%s' "$1" > "$TMPD/n.json"; shift
  "$PY" "$GATE" --needs-json "$TMPD/n.json" "$@" > "$TMPD/out.txt" 2>&1; RC=$?
}

J() { printf '{"quality":{"result":"%s"},"architecture":{"result":"%s"},"control-tower-tests":{"result":"%s"},"checker-review":{"result":"%s"}}' "$1" "$2" "$3" "$4"; }

echo "=== W3/D1165 aggregate-job-results 判别夹具 ==="
echo "gate: $GATE"; echo

# ① 绿基线: 全 success + pull_request ⇒ 0
run "$(J success success success success)" --event pull_request
report "green-baseline-all-success" 0 "$RC" "ALL-CHECKS-PASSED: OK" "$TMPD/out.txt"

# ② 改坏即红: 一个 job skipped（非白名单）+ pull_request ⇒ 1
run "$(J success skipped success success)" --event pull_request
report "red-skipped-job-on-pr" 1 "$RC" "architecture = skipped" "$TMPD/out.txt"

# ③ 白名单生效: checker-review skipped + push ⇒ 0（结构上不适用）
run "$(J success success success skipped)" --event push
report "allow-skip-checker-review-on-push" 0 "$RC" "ALLOW-SKIP checker-review" "$TMPD/out.txt"

# ④ 白名单按事件成对: checker-review skipped + pull_request ⇒ 1（PR 上它必须跑）
run "$(J success success success skipped)" --event pull_request
report "red-checker-review-skipped-on-pr" 1 "$RC" "checker-review = skipped" "$TMPD/out.txt"

# ⑤ failure / cancelled 一律红
run "$(J success failure success success)" --event pull_request
report "red-job-failure" 1 "$RC" "architecture = failure" "$TMPD/out.txt"
run "$(J cancelled success success success)" --event pull_request
report "red-job-cancelled" 1 "$RC" "quality = cancelled" "$TMPD/out.txt"

# ⑥ 降级三态: 缺 needs / 非法 JSON / 缺事件名 ⇒ 2（fail-closed，2 ≠ 通过）
"$PY" "$GATE" --needs-json "$TMPD/nope.json" --event push > "$TMPD/out.txt" 2>&1; RC=$?
report "degraded-missing-needs-file" 2 "$RC" "DEGRADED" "$TMPD/out.txt"
printf '{not json' > "$TMPD/n.json"; "$PY" "$GATE" --needs-json "$TMPD/n.json" --event push > "$TMPD/out.txt" 2>&1; RC=$?
report "degraded-bad-json" 2 "$RC" "DEGRADED" "$TMPD/out.txt"
printf '%s' "$(J success success success success)" > "$TMPD/n.json"
env -u EVENT_NAME "$PY" "$GATE" --needs-json "$TMPD/n.json" > "$TMPD/out.txt" 2>&1; RC=$?
report "degraded-missing-event" 2 "$RC" "DEGRADED" "$TMPD/out.txt"

# ⑦ 反例: 用 --allow-skip 取代内置白名单（不含 checker-review）⇒ 同输入必须转红
run "$(J success success success skipped)" --event push --allow-skip quality
report "negative-control-allowlist-removed-turns-red" 1 "$RC" "checker-review = skipped" "$TMPD/out.txt"

echo
echo "RESULT: $PASS_N PASS / $FAIL_N FAIL"
[ "$FAIL_N" -gt 0 ] && exit 1
exit 0
