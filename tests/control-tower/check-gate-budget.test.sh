#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-gate-budget.test.sh — 耗时机检判别性夹具（W0 附 · 卡 #1210 · 标准 v3.1 §七/§十二判据 9）
#
# 覆盖矩阵（铁律 48 三路径 ＋ 判别性 ＋ 变异体）:
#   正常 — `--cmd true` ⇒ wall_ms ≥ 0 ＋ BUDGET: PASS ＋ exit 0（**真实测量**，非估算）
#   失败 — `--threshold-ms 100 --cmd "sleep 0.3"` ⇒ BUDGET: FAIL ＋ exit 1（超限）
#   边界 — 日志模式: wall_ms=88000 ⇒ PASS(0) / wall_ms=91000 ⇒ FAIL(1)（确定性夹具，不等真实 90s）
#   降级 — 日志不存在 / 空日志 / 无 wall_ms 记录 ⇒ exit 2 ＋ degraded（无数据 ≠ 达标）
#   降级 — 被测命令自身 rc≠0 ⇒ exit 2 ＋ E_CMD_FAILED（门禁红 ≠ 耗时达标）
#   降级 — 阈值非数字 / 未知参数 ⇒ exit 2（参数错，判不了）
#   正常 — --json 输出单行合法 JSON 且 verdict 与退出码一致
#   判别 — 变异体: 阈值比较改成恒假 ⇒ 超限夹具由 FAIL(1) 变 PASS(0) ⇒ 本夹具必须能抓到
# 沙箱: mktemp -d（只写 /tmp 与 $TMPD）；不写仓库工作树；降级日志经 SYNO_GATE_DEGRADED_LOG 注入。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$REPO/scripts/control-tower/check-gate-budget.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
export SYNO_GATE_DEGRADED_LOG="$TMPD/degraded.log"

echo "=== W0 附: check-gate-budget.sh 耗时机检夹具 ==="
[ -f "$SUT" ] && ok "被测脚本存在" || { no "被测脚本缺失: $SUT"; echo "结果: $PASS 通过, $FAIL 失败"; exit 1; }

# ── 正常: 真实墙钟测量（--cmd true）──
OUT="$(bash "$SUT" --cmd "true" 2>"$TMPD/true.err")"; rc=$?
W_MS="$(printf '%s\n' "$OUT" | sed -n 's/^wall_ms=//p' | tail -1)"
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q '^BUDGET: PASS$' \
   && printf '%s' "$W_MS" | grep -qE '^[0-9]+$'; then
  ok "正常: --cmd true ⇒ wall_ms=${W_MS} ＋ BUDGET: PASS ＋ exit 0（真实测量）"
else
  no "正常: --cmd true 异常（rc=${rc} out=$(printf '%s' "$OUT" | tr '\n' '|')）"
fi

# ── 失败: 超限（threshold 100ms ＋ sleep 0.3s）──
OUT="$(bash "$SUT" --threshold-ms 100 --cmd "bash -c 'sleep 0.3'")"; rc=$?
W_MS_SLOW="$(printf '%s\n' "$OUT" | sed -n 's/^wall_ms=//p' | tail -1)"
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q '^BUDGET: FAIL'; then
  ok "失败: wall_ms=${W_MS_SLOW} > 100ms ⇒ BUDGET: FAIL ＋ exit 1"
else
  no "失败: 超限未判红（rc=${rc} out=$(printf '%s' "$OUT" | tr '\n' '|')）"
fi

# ── 边界: 日志模式（确定性夹具；不依赖真实 90s）──
printf '# fixture\ngate=pre-commit wall_ms=88000\n' > "$TMPD/pass.log"
OUT="$(bash "$SUT" --log "$TMPD/pass.log")"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q '^wall_ms=88000$' && printf '%s\n' "$OUT" | grep -q '^BUDGET: PASS$'; then
  ok "边界: 日志 wall_ms=88000 ≤ 90000 ⇒ PASS ＋ exit 0"
else
  no "边界: 达标日志判错（rc=${rc}）"
fi
printf 'gate=pre-commit wall_ms=91000\n' > "$TMPD/fail.log"
OUT="$(bash "$SUT" --log "$TMPD/fail.log")"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q '^BUDGET: FAIL'; then
  ok "边界: 日志 wall_ms=91000 > 90000 ⇒ FAIL ＋ exit 1"
else
  no "边界: 超限日志判错（rc=${rc}）"
fi

# ── 降级: 无数据源 / 空日志 / 无 wall_ms 记录 ⇒ exit 2 ＋ degraded（禁 exit 0）──
OUT="$(bash "$SUT" --log "$TMPD/does-not-exist.log" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'degraded: E_NO_DATA'; then
  ok "降级: 日志不存在 ⇒ exit 2 ＋ degraded: E_NO_DATA"
else
  no "降级: 日志不存在未 fail-closed（rc=${rc}）"
fi
: > "$TMPD/empty.log"
OUT="$(bash "$SUT" --log "$TMPD/empty.log" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'degraded: E_NO_DATA'; then
  ok "降级: 空日志 ⇒ exit 2 ＋ degraded（无数据 ≠ 达标）"
else
  no "降级: 空日志未 fail-closed（rc=${rc}）"
fi
printf 'gate=pre-commit result=miss\n' > "$TMPD/nowall.log"
OUT="$(bash "$SUT" --log "$TMPD/nowall.log" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'degraded: E_NO_DATA'; then
  ok "降级: 日志无 wall_ms 记录 ⇒ exit 2 ＋ degraded"
else
  no "降级: 无 wall_ms 记录未 fail-closed（rc=${rc}）"
fi

# ── 降级: 被测命令自身失败 ⇒ 判不了（不把「门禁红」洗成「预算绿」）──
OUT="$(bash "$SUT" --cmd "false" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'degraded: E_CMD_FAILED'; then
  ok "降级: 被测命令 rc=1 ⇒ exit 2 ＋ E_CMD_FAILED（判不了 ≠ 通过）"
else
  no "降级: 被测命令失败未 fail-closed（rc=${rc}）"
fi

# ── 降级: 参数错 ⇒ exit 2 ──
OUT="$(bash "$SUT" --threshold-ms abc 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && ok "降级: --threshold-ms 非数字 ⇒ exit 2" || no "降级: 非法阈值未 fail-closed（rc=${rc}）"
OUT="$(bash "$SUT" --bogus 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && ok "降级: 未知参数 ⇒ exit 2" || no "降级: 未知参数未 fail-closed（rc=${rc}）"

# ── 正常: --json 单行合法 JSON（结构检查，不依赖 jq）──
OUT="$(bash "$SUT" --json --cmd "true")"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$OUT" | grep -c .)" -eq 1 ] \
   && printf '%s\n' "$OUT" | grep -qE '^\{"wall_ms":[0-9]+,"threshold_ms":90000,"verdict":"PASS","source":"cmd"\}$'; then
  ok "正常: --json 输出单行合法 JSON（verdict=PASS 与退出码一致）"
else
  no "正常: --json 结构异常（rc=${rc} out=${OUT}）"
fi

# ── 判别性（改坏即红）: 阈值比较改恒假 ⇒ 超限夹具必须由 FAIL(1) 变 PASS(0) ──
MUT="$TMPD/budget-mutant.sh"
sed 's/\[ "\$WALL_MS" -gt "\$THRESHOLD" \]/false/' "$SUT" > "$MUT"
if ! bash -n "$MUT" >/dev/null 2>&1; then
  no "变异体生成失败（sed 替换阈值比较出错）"
elif ! grep -q 'VERDICT="PASS"; false && VERDICT="FAIL"' "$MUT"; then
  no "变异体未命中判定行（实现改动后请同步本夹具）"
else
  OUT_M="$(bash "$MUT" --threshold-ms 100 --cmd "bash -c 'sleep 0.3'")"; rc_m=$?
  if [ "$rc_m" -eq 0 ] && printf '%s\n' "$OUT_M" | grep -q '^BUDGET: PASS$'; then
    ok "判别性: 恒假阈值 ⇒ 超限夹具变 PASS(0)（原态 FAIL(1)），证明 FAIL 是判据而非恒红"
  else
    no "判别性: 变异体未变绿（rc=${rc_m}）—— 超限用例可能不具判别力"
  fi
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
