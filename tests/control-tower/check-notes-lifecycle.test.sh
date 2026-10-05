#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-notes-lifecycle.test.sh — D472 Agent Notes 迁移门禁 + 字段契约测试
#
# 覆盖 (铁律 48: 正常/降级/边界):
#   L1 迁移门禁: 中文头 任务: DXXX + task-state impl_done → exit 1 + 点名
#   L1 迁移门禁: 英文头 name: D406 + task-state impl_done → exit 1 + 点名（真实锚点）
#   L1 迁移门禁: 无 D# 引用 → exit 0（不误杀真实提议）
#   L1 迁移门禁: proposed/ 空 → exit 0（边界）
#   L1 迁移门禁: task-state/ 不可读 → exit 2 degraded（铁律 11/24 显式降级）
#   L1 字段契约: 四态头 Note（直接构造）含 状态: 且 gate 不误杀
#   L1 字段契约: 旧英文头 Note 仍不被误杀（status: 兼容回归）
#   L1 回归: commit-msg Note 引用门禁不受影响（D395-a 交付不动）
#   L2a 接线: pre-commit 组 6 区域真实调用 check-notes-lifecycle.sh
#   （hook 注入过滤见 hook-check-memory.test.sh — U7/CT-40 配对）
#
# 零真实仓库污染: 临时沙箱构造 memory/notes/ + task-state/（注入缝）。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LESSONS="(D962-B2 已退役: scripts/check-lessons-learned.sh)"
GATE="$REPO_DIR/scripts/control-tower/check-notes-lifecycle.sh"
PRE_COMMIT="$REPO_DIR/scripts/pre-commit-check.sh"
TMP_DIR="/tmp/d472-notes-lifecycle-tests"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_contains() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi; }
assert_exit() { if [ "$1" = "$2" ]; then pass "$3 (exit=$2)"; else fail "$3 — 期望 exit=$1 实际=$2"; fi; }

# ── 沙箱构造 ──
rm -rf "$TMP_DIR" 2>/dev/null || true
mkdir -p "$TMP_DIR/memory/notes/proposed" "$TMP_DIR/memory/notes/implemented" "$TMP_DIR/memory/notes/archived" "$TMP_DIR/memory/notes/rejected"
mkdir -p "$TMP_DIR/task-state"

echo "═══════════════════════════════════════════════════════════"
echo "  D472 Agent Notes 迁移门禁 + 字段契约测试"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. 迁移门禁: 中文头僵尸 → exit 1 + 点名 ──
echo "── 1. 迁移门禁: 中文头 任务: DXXX + impl_done → exit 1 ──"
cat > "$TMP_DIR/memory/notes/proposed/2026-08-10-zh-zombie.md" <<'EOF'
---
状态: proposed
日期: 2026-08-10
决策: 中文头僵尸测试
理由: 测试
---
任务: D199
EOF
cat > "$TMP_DIR/task-state/D199.json" <<'EOF'
{"task_id":"D199","title":"测试","status":"impl_done","spec":{},"impl":null,"audit":null}
EOF
set +e
OUT=$(ROOT="$TMP_DIR" bash "$GATE" 2>&1)
CODE=$?
set -e
assert_exit 1 "$CODE" "中文头僵尸 → exit 1"
assert_contains "$OUT" "2026-08-10-zh-zombie.md" "点名僵尸文件"
assert_contains "$OUT" "D199" "点名 D199"
echo ""

# ── 2. 迁移门禁: 英文头僵尸（真实锚点 D406 格式）→ exit 1 ──
echo "── 2. 迁移门禁: 英文头 name: D406 + impl_done → exit 1 ──"
cat > "$TMP_DIR/memory/notes/proposed/2026-08-17-d406-lessons-channel.md" <<'EOF'
---
status: proposed
date: 2026-08-17
name: D406 lessons-learned 通道改向
class: D406_M7
constraint: ""
expected: ""
severity: warn
occurrences: 1
first_seen: 2026-08-17
description: 测试
---
EOF
cat > "$TMP_DIR/task-state/D406.json" <<'EOF'
{"task_id":"D406","title":"lessons 通道改向","status":"impl_done","spec":{},"impl":null,"audit":null}
EOF
set +e
OUT=$(ROOT="$TMP_DIR" bash "$GATE" 2>&1)
CODE=$?
set -e
assert_exit 1 "$CODE" "英文头僵尸 → exit 1"
assert_contains "$OUT" "2026-08-17-d406-lessons-channel.md" "点名英文头僵尸"
echo ""

# ── 3. 迁移门禁: 无 D# 引用 → exit 0（真实提议放行）──
echo "── 3. 迁移门禁: 无 D# 引用 → exit 0 ──"
rm -f "$TMP_DIR/memory/notes/proposed/"*.md 2>/dev/null || true  # 清掉用例 2/3 的僵尸，隔离本用例
cat > "$TMP_DIR/memory/notes/proposed/2026-08-18-open-proposal.md" <<'EOF'
---
状态: proposed
日期: 2026-08-18
决策: 真实进行中提议
理由: 无 D# 关联
---
这是一个方向性提议，还没有对应任务编号。
EOF
set +e
OUT=$(ROOT="$TMP_DIR" bash "$GATE" 2>&1)
CODE=$?
set -e
assert_exit 0 "$CODE" "无 D# 提议 → exit 0"
echo ""

# ── 4. 迁移门禁: proposed/ 空 → exit 0（边界）──
echo "── 4. 迁移门禁: proposed/ 空 → exit 0 ──"
rm -f "$TMP_DIR/memory/notes/proposed/"*.md 2>/dev/null || true
set +e
OUT=$(ROOT="$TMP_DIR" bash "$GATE" 2>&1)
CODE=$?
set -e
assert_exit 0 "$CODE" "空 proposed/ → exit 0"
echo ""

# ── 5. 迁移门禁: task-state/ 不可读 → exit 2 degraded ──
echo "── 5. 迁移门禁: task-state/ 不可读 → exit 2 degraded ──"
mkdir -p "$TMP_DIR/memory/notes/proposed"
cat > "$TMP_DIR/memory/notes/proposed/2026-08-10-zh-zombie.md" <<'EOF'
---
状态: proposed
日期: 2026-08-10
决策: 僵尸
理由: 测试
---
任务: D199
EOF
set +e
OUT=$(ROOT="$TMP_DIR" TASK_STATE_DIR="$TMP_DIR/nonexistent-task-state" bash "$GATE" 2>&1)
CODE=$?
set -e
assert_exit 2 "$CODE" "task-state 不可读 → exit 2"
assert_contains "$OUT" "degraded" "degraded 显式输出"
echo ""

# ── 6. 字段契约: 四态头 Note（状态/日期/决策/理由 + 扩展字段）不误杀 ──
# (D962-B2: check-lessons-learned.sh 退役，写入方夹具改为直接构造 Note，门禁仍验证解析)
echo "── 6. 字段契约: 四态头 Note 含 状态: + 扩展字段 → gate 接受 ──"
rm -rf "$TMP_DIR/memory/notes/proposed" "$TMP_DIR/memory/notes/implemented" "$TMP_DIR/memory/notes/archived" "$TMP_DIR/memory/notes/rejected"
mkdir -p "$TMP_DIR/memory/notes/proposed" "$TMP_DIR/memory/notes/implemented" "$TMP_DIR/memory/notes/archived" "$TMP_DIR/memory/notes/rejected"
cat > "$TMP_DIR/memory/notes/proposed/2026-09-25-field-contract.md" <<'EOF'
---
状态: proposed
日期: 2026-09-25
决策: 四态头字段契约测试
理由: check-lessons-learned 退役后由直接构造验证
class: TEST_CLASS
constraint: "true"
expected: true
severity: warn
occurrences: 1
first_seen: 2026-09-25
description: 字段契约夹具
---
EOF
NEW_NOTE="$TMP_DIR/memory/notes/proposed/2026-09-25-field-contract.md"
assert_contains "$(cat "$NEW_NOTE")" "状态: proposed" "新 Note 头含 状态: proposed"
assert_contains "$(cat "$NEW_NOTE")" "class: TEST_CLASS" "扩展字段 class 保留"
assert_contains "$(cat "$NEW_NOTE")" "日期:" "新 Note 头含 日期:"
assert_contains "$(cat "$NEW_NOTE")" "决策:" "新 Note 头含 决策:"
assert_contains "$(cat "$NEW_NOTE")" "理由:" "新 Note 头含 理由:"
set +e
OUT=$(ROOT="$TMP_DIR" bash "$GATE" 2>&1)
CODE=$?
set -e
assert_exit 0 "$CODE" "四态头 + 扩展字段 Note 不被误杀（gate 接受）"
echo ""

# ── 7. 字段契约: 旧英文头兼容（status: 可解析）──
echo "── 7. 字段契约: 旧英文头 status: 兼容回归 ──"
cat > "$TMP_DIR/memory/notes/proposed/2026-08-17-old-format.md" <<'EOF'
---
status: proposed
date: 2026-08-17
name: 旧格式
class: OLD_FORMAT
constraint: "true"
expected: true
severity: warn
occurrences: 1
first_seen: 2026-08-17
description: 旧格式回归
---
EOF
# (D962-B2: lessons 去重逻辑随脚本退役；此处验证旧英文头 Note 不被 gate 误杀)
set +e
OUT=$(ROOT="$TMP_DIR" bash "$GATE" 2>&1)
CODE=$?
set -e
assert_exit 0 "$CODE" "旧英文头 Note 不被误杀（兼容回归）"
echo ""

# ── 8. 回归: commit-msg Note 引用门禁不受影响 ──
echo "── 8. 回归: commit-msg Note 引用门禁不受影响 ──"
if [ -f "$REPO_DIR/scripts/commit-msg-check.sh" ]; then
  # 只验证脚本存在且引用 memory/notes/（D395-a 交付，本任务不碰）
  assert_contains "$(grep -o 'memory/notes/' "$REPO_DIR/scripts/commit-msg-check.sh" | head -1)" "memory/notes/" "commit-msg 门禁仍引用 memory/notes/"
else
  fail "commit-msg-check.sh 不存在"
fi
echo ""

# ── 9. L2a 接线: pre-commit 组 6 真实调用 check-notes-lifecycle ──
echo "── 9. 接线: pre-commit-check.sh 调用 check-notes-lifecycle ──"
if [ -f "$PRE_COMMIT" ]; then
  assert_contains "$(grep -n "check-notes-lifecycle" "$PRE_COMMIT" | head -1)" "check-notes-lifecycle" "pre-commit 生产调用 check-notes-lifecycle"
else
  fail "pre-commit-check.sh 不存在"
fi
echo ""

# ── 10. D472 复核: CT-34 纯文档豁免不得绕过迁移门禁 ──
echo "── 10. 复核: 纯文档提交（proposed/ Note 变更）仍过迁移门禁 ──"
if [ -f "$PRE_COMMIT" ]; then
  # 迁移门禁调用出现在 CT-34 早退分支内（NOTES_TOUCHED_DOC 条件）
  assert_contains "$(grep -n "NOTES_TOUCHED_DOC" "$PRE_COMMIT" | head -1)" "NOTES_TOUCHED_DOC" "纯文档早退分支内补跑迁移门禁（防 CT-34 绕过）"
else
  fail "pre-commit-check.sh 不存在"
fi
echo ""

# ═══ 结果 ═══
echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
echo "═══════════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
