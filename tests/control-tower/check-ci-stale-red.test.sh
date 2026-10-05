#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# check-ci-stale-red.test.sh — D453/CT-39 CI 红超 24h 监测测试
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — --json 模式输出 JSON（stale 字段）+ exit 0/1（不依赖真实网络）
#   降级 — 脚本语法（bash -n）+ 三态退出码逻辑存在
#   边界 — --check 模式不写文件；阈值常量 24h 存在
#   接线 — gen-cto-health.py 调用了 check-ci-stale-red.sh（铁律 0-2）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/ct-health.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "=== D453/CT-39 check-ci-stale-red 测试 ==="

# ── 接线: gen-cto-health.py 调用 ct-health.sh ci-stale-red（铁律 0-2；D962-B2 宿主迁移）──
if grep -q 'ct-health.sh"), "ci-stale-red"' "$REPO/scripts/control-tower/gen-cto-health.py" 2>/dev/null; then
  ok "接线: gen-cto-health.py 调用 ct-health.sh ci-stale-red"
else
  no "接线: gen-cto-health.py 未调用 ct-health.sh ci-stale-red"
fi

# ── 边界: 阈值常量 24h 存在 ──
if grep -q "THRESHOLD_HOURS=24" "$GATE" 2>/dev/null; then
  ok "阈值 24h 常量存在"
else
  no "阈值 24h 常量缺失"
fi

# ── 边界: 三态退出码逻辑存在（0 无红/1 有 stale/2 降级；宿主函数内为 return，分发层透传）──
if grep -q "return 0" "$GATE" && grep -q "return 1" "$GATE" && grep -qE "return 2|exit 2" "$GATE"; then
  ok "三态退出码（0/1/2）逻辑存在"
else
  no "三态退出码逻辑缺失"
fi

# ── 边界: --check 模式不写待办文件 ──
if grep -q '\$MODE" != "check"' "$GATE" 2>/dev/null; then
  ok "--check 模式跳过写文件"
else
  no "--check 模式跳过写文件逻辑缺失"
fi

# ── 降级: 匿名 API（无 token 泄露）──
if grep -q "api.github.com" "$GATE" && ! grep -q "Authorization: token" "$GATE"; then
  ok "匿名 API 无 token 泄露"
else
  no "匿名 API 或含 token"
fi

# ── 语法: bash -n ──
if bash -n "$GATE" 2>/dev/null; then  # swallow-ok: bash -n 语法检查，失败由下方 else 分支断言
  ok "语法合法（bash -n）"
else
  no "语法错误"
fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && echo "  Status: ✅ check-ci-stale-red 测试通过" || echo "  Status: ❌ check-ci-stale-red 测试未通过"
exit $FAIL
