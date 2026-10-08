#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# alloc-task-id-timeout.test.sh — D1091 两腿硬超时 + fail-closed
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 超时关闭（=0）时行为回到旧态（exit 0，仍能发号/预览）
#   降级 — 扫描腿超时 → exit 2 + degraded 明示（fail-closed，不静默漏号）
#   降级 — 远端腿超时 → exit 2 + degraded 明示
#   边界 — 便携实现: 不依赖 timeout 二进制（本机 macOS 无该二进制），且有 0=不限 的显式关闸
#   接线 — _run_bounded 定义 + 两条腿各调用它 + header 文档化 exit 2 语义
#
# 为什么存在: CTO 台账第七批① 记「取号器第 3 次挂死」（全参数运行 >7 min 无输出）。
#   根因两条腿都无上限（`command -v timeout || gtimeout` 在 macOS 双双落空 → 走无界分支）。
# 确定性: 用注入缝 SYNO_ALLOC_TEST_STALL_SECS（生产不设）在腿内 sleep，避免依赖真网络/真慢盘。
# ═══════════════════════════════════════════════════════════════
# D-C 切换（创始人 2026-10-08）: 本夹具验证【取号引擎/锁/超时】本身，非"新建任务取号"语义
#   ⇒ 显式置 SYNO_ALLOC_LEGACY_OK=1（测试逃生缝；生产不设 = 取号一律拒绝）
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/alloc-task-id.sh"
SB="$(mktemp -d)"; LOCK_ROOT="$(mktemp -d)"
# 夹具前提（D1091 首跑踩到）: 沙箱必须是 **git 仓 + 含 task-state/**，否则脚本在更早的
# 「task-state 不可读 → exit 1」处就退出，超时腿根本不会执行（假红）。对齐 alloc-task-id-lock.test.sh。
mkdir -p "$SB/task-state" "$SB/briefs"
git -C "$SB" init -q 2>/dev/null  # swallow-ok: 夹具仓库已存在时 init 报错，无影响
PASS=0; FAIL=0; FAILED_NAMES=()
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); }
trap 'rm -rf "$SB" "$LOCK_ROOT"; true' EXIT  # swallow-ok: 清理陷阱

echo "=== D1091 alloc-task-id 超时测试 ==="

# ── A 接线：有界执行器存在 + 两条腿都消费 ──
if grep -q "^_run_bounded() {" "$GATE"; then ok "接线: _run_bounded 定义存在"; else no "接线: _run_bounded 缺失"; fi
if [ "$(grep -c '_run_bounded "' "$GATE")" -ge 2 ]; then
  ok "接线: 两条腿均调用 _run_bounded（$(grep -c '_run_bounded "' "$GATE") 处）"
else
  no "接线: 有腿未接有界执行器（<2 处调用）"
fi
if grep -q '^#             2 = \*\*超时 fail-closed\*\*' "$GATE"; then
  ok "接线: header 文档化 exit 2（超时 fail-closed）"
else
  no "接线: header 未文档化 exit 2"
fi

# ── B 便携性：无 timeout 二进制也能有界（macOS 实测无 timeout/gtimeout）──
if grep -q '"$@" & _pid=\$!' "$GATE"; then
  ok "边界: 便携回退（后台 pid + 轮询）存在 —— 不依赖 timeout 二进制"
else
  no "边界: 便携回退缺失"
fi

# ── C 扫描腿超时 → exit 2 + degraded 明示 ──
OUT="$(SYNO_TASK_STATE_DIR="$SB/task-state" SYNO_BRIEF_DIR="$SB/briefs" SYNO_LOCK_DIR="$LOCK_ROOT/l1" \
  SYNO_ALLOC_NO_BRANCH=1 SYNO_ALLOC_SCAN_TIMEOUT=1 SYNO_ALLOC_TEST_STALL_SECS=3 \
  SYNO_ALLOC_LEGACY_OK=1 bash "$GATE" --dry-run "超时夹具" 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then ok "降级: 扫描腿超时 → exit 2"; else no "降级: 扫描腿超时应 exit 2，实得 $RC"; fi
if printf '%s' "$OUT" | grep -q 'worktree 占用扫描超时' && printf '%s' "$OUT" | grep -q 'fail-closed'; then
  ok "降级: 扫描腿超时附 degraded 明示（含 fail-closed）"
else
  no "降级: 扫描腿超时缺少 degraded 明示"
fi

# ── D 远端腿超时 → exit 2 + degraded 明示 ──
OUT="$(SYNO_TASK_STATE_DIR="$SB/task-state" SYNO_BRIEF_DIR="$SB/briefs" SYNO_LOCK_DIR="$LOCK_ROOT/l2" \
  SYNO_ALLOC_NO_WORKTREE=1 SYNO_ALLOC_LSREMOTE_TIMEOUT=1 SYNO_ALLOC_TEST_STALL_SECS=3 \
  SYNO_ALLOC_LEGACY_OK=1 bash "$GATE" --dry-run "远端超时夹具" 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then ok "降级: 远端腿超时 → exit 2"; else no "降级: 远端腿超时应 exit 2，实得 $RC"; fi
if printf '%s' "$OUT" | grep -q '远端分支快照超时'; then
  ok "降级: 远端腿超时附 degraded 明示"
else
  no "降级: 远端腿超时缺少 degraded 明示"
fi

# ── E 正常路径：显式关超时（=0）→ 行为回到旧态（exit 0）──
OUT="$(SYNO_TASK_STATE_DIR="$SB/task-state" SYNO_BRIEF_DIR="$SB/briefs" SYNO_LOCK_DIR="$LOCK_ROOT/l3" \
  SYNO_ALLOC_NO_BRANCH=1 SYNO_ALLOC_SCAN_TIMEOUT=0 SYNO_ALLOC_TEST_STALL_SECS=2 \
  SYNO_ALLOC_LEGACY_OK=1 bash "$GATE" --dry-run "关超时夹具" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "正常: SCAN_TIMEOUT=0（显式关闸）→ exit 0，回到旧行为"; else no "正常: 关闸后应 exit 0，实得 $RC"; fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then printf '  失败断言: %s\n' "${FAILED_NAMES[@]}"; fi
if [ "$FAIL" -eq 0 ]; then echo "Status: ✅ alloc-task-id 超时测试通过"; exit 0; else echo "Status: ❌ 有失败断言"; exit 1; fi
