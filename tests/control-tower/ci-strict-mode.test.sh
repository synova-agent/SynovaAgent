#!/usr/bin/env bash
# tests/control-tower/ci-strict-mode.test.sh — D516 P0-1: SYNO_CI strict 模式测试
# 覆盖: ①soft_check/v5_soft/warn_check 三函数在 SYNO_CI=1 时 HARD_FAIL++（转硬）
#       ②SYNO_CI=0 时维持软计数（本地减负） ③ci.yml 注入 SYNO_CI 接线断言
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PC="$HERE/../../scripts/pre-commit-check.sh"
CI="$HERE/../../.github/workflows/ci.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# 提取函数定义并在子 shell 中独立测试（不跑全脚本）
# (D962 2a① V5.3: v5_soft 已并入 soft_check 统一实现——不再单测)
FUNCS=$(awk '/^(soft_check|warn_check)\(\) \{/,/^\}/' "$PC" | head -80)

test_fn() {
  local fn="$1" mode="$2" expect="$3"  # expect: hard|soft
  local out
  out=$(
    export HARD_FAIL=0 SOFT_COUNT=0 WARN_COUNT=0 CYAN="" RED="" YELLOW="" RESET="" GATE_HITS_LOG=/dev/null
    eval "$FUNCS" 2>/dev/null
    export SYNO_CI="$mode"
    # log_gate 可能未定义（在函数组外）——定义为 no-op
    log_gate() { :; }
    "$fn" "测试项" "一行违规"
    echo "H=$HARD_FAIL S=$SOFT_COUNT W=$WARN_COUNT"
  )
  if [ "$expect" = "hard" ] && echo "$out" | grep -q "H=[1-9]"; then
    return 0
  elif [ "$expect" = "soft" ] && echo "$out" | grep -qE "S=[1-9]|W=[1-9]" && echo "$out" | grep -q "H=0"; then
    return 0
  fi
  return 1
}

for fn in soft_check; do
  test_fn "$fn" 1 hard && ok "$fn SYNO_CI=1 → HARD_FAIL++（CI 转硬）" || no "$fn CI strict 未生效"
  test_fn "$fn" 0 soft && ok "$fn SYNO_CI=0 → 软计数（本地不阻断）" || no "$fn 本地软模式异常"
done
test_fn warn_check 1 hard && ok "warn_check SYNO_CI=1 → 转硬" || no "warn_check CI strict 未生效"

# 接线断言
grep -q 'SYNO_CI: "1"' "$CI" && ok "ci.yml 注入 SYNO_CI=1（Iron Laws job）" || no "ci.yml 未注入"
grep -q "SYNO_CI" "$PC" && ok "pre-commit-check.sh 含 SYNO_CI 分支" || no "脚本无 strict 分支"

echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
