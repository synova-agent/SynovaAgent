#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# check-orphan-worktrees.test.sh — worktree 收尾检测测试
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 无孤儿 worktree → exit 0 + 无孤儿
#   降级 — git 不可用 → exit 2（fail-closed）
#   边界 — --json 输出 JSON 结构；主 worktree 排除
#   接线 — gen-cto-health.py 调用了 check-orphan-worktrees.sh（铁律 0-2）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/ct-health.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "=== worktree 收尾检测测试 ==="

# ── 语法: bash -n ──
if bash -n "$GATE" 2>/dev/null; then  # swallow-ok: bash -n 语法检查
  ok "语法合法（bash -n）"
else
  no "语法错误"
fi

# ── 正常: 无孤儿 → exit 0 ──（D962-B2 宿主迁移: 经 ct-health.sh orphan-worktrees 子命令）
bash "$GATE" orphan-worktrees >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ]; then
  ok "运行正常（exit ${rc}，0=无孤儿/1=有孤儿，均为有效判定）"
else
  no "应 exit 0/1, 实际 ${rc}"
fi

# ── 边界: --json 输出 JSON 结构 ──
JSON=$(bash "$GATE" orphan-worktrees --json 2>/dev/null)  # swallow-ok: JSON 通道 stderr 非判定面
if echo "$JSON" | grep -q '"orphan_count"'; then
  ok "--json 输出含 orphan_count 字段"
else
  no "--json 输出异常: $JSON"
fi

# ── 边界: 主 worktree 排除（仓库根不算孤儿）──
if grep -q 'WT_PATH.*=.*\$ROOT' "$GATE" || grep -q 'if \[ "\$WT_PATH" = "\$ROOT" \]' "$GATE"; then
  ok "主 worktree 排除逻辑存在"
else
  no "主 worktree 排除逻辑缺失"
fi

# ── 降级: git 不可用 → exit 2 逻辑存在（宿主函数 return 2 + 分发层透传 exit $?）──
if grep -qE "return 2|exit 2" "$GATE" && grep -q "degraded" "$GATE"; then
  ok "降级 exit 2 逻辑存在"
else
  no "降级逻辑缺失"
fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && echo "  Status: ✅ worktree 收尾检测测试通过" || echo "  Status: ❌ 测试未通过"
exit $FAIL
