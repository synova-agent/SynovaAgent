#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# ct-health.test.sh — D962-B2 控制塔健康域宿主测试（U7/CT-40 配对）
#
# ct-health.sh 吸收原 check-ci-stale-red.sh / check-orphan-worktrees.sh（逐字迁移，
# exit→return + 分发层透传）。本测试验证: 分发三态透传 / 子命令行为等价 / canary 过渡转发。
# 覆盖（铁律 48）: 正常（orphan-worktrees --json 输出结构）/ 边界（未知子命令用法提示）/
# 降级（ci-stale-red API 不可达路径结构存在）/ 接线（gen-cto-health.py 调用点）。
# 平台中立: UTF-8 头块 / 无 sed -i / 无 grep -P / PYBIN 三级探测。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOST="$REPO_DIR/scripts/control-tower/ct-health.sh"
PYBIN=""
for _c in python3 python "$(command -v py 2>/dev/null || true)"; do
  command -v "$_c" >/dev/null 2>&1 && PYBIN="$_c" && break
done
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_contains() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi; }

echo "═══════════════════════════════════════════════════════════"
echo "  D962 ct-health 宿主测试 (PYBIN=$PYBIN)"
echo "═══════════════════════════════════════════════════════════"

# 1. 正常: orphan-worktrees --json 输出 JSON 结构
OUT=$(bash "$HOST" orphan-worktrees --json 2>/dev/null)  # swallow-ok: JSON 通道stderr非判定面
assert_contains "$OUT" '"orphan_count"' "orphan-worktrees --json 含 orphan_count"
# 2. 边界: 未知子命令 → 用法提示 + exit 2（不裸崩）
OUT=$(bash "$HOST" no-such-sub 2>&1) && RC=0 || RC=$?
if [ "$RC" -eq 2 ] && echo "$OUT" | grep -q "用法"; then pass "未知子命令用法提示 + exit 2"; else fail "未知子命令行为异常 rc=$RC"; fi
# 3. 三态透传结构: return 0/1/2 + 分发 exit $?
if grep -q "return 0" "$HOST" && grep -q "return 1" "$HOST" && grep -qE "return 2|exit 2" "$HOST" && grep -q 'exit $?' "$HOST"; then
  pass "子命令三态 return + 分发层透传存在"
else
  fail "三态透传结构缺失"
fi
# 4. 降级路径结构: degraded 显式输出（铁律 11）
if grep -q "degraded" "$HOST"; then pass "降级显式输出存在"; else fail "降级输出缺失"; fi
# 5. 接线: gen-cto-health.py 两调用点改指宿主
if grep -q 'ct-health.sh"), "ci-stale-red"' "$REPO_DIR/scripts/control-tower/gen-cto-health.py" && grep -q 'ct-health.sh"), "orphan-worktrees"' "$REPO_DIR/scripts/control-tower/gen-cto-health.py"; then
  pass "gen-cto-health.py 两调用点接线宿主"
else
  fail "宿主接线断"
fi
# 6. canary 过渡转发（2b 改线后本断言随转发体一起更新）
if grep -q "canary-drift" "$HOST"; then pass "canary-drift 过渡转发存在"; else fail "canary 转发缺失"; fi
# 7. 逐字迁移守卫: CT-39 阈值与 TODO_FILE 语义仍在
if grep -q "THRESHOLD_HOURS=24" "$HOST" && grep -q "CI-STALE-RED.md" "$HOST"; then pass "CT-39 判定常量与待办落点保留"; else fail "迁移丢件"; fi

echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
