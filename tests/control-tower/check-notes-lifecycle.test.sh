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
#   L1 字段契约: check-lessons-learned 新写 Note 头含 状态: 且与目录一致
#   L1 字段契约: 旧英文头 Note 仍可被 grep 解析（status: 兼容回归）
#   L1 回归: commit-msg Note 引用门禁不受影响（D395-a 交付不动）
#   L2a 接线: pre-commit 组 6 区域真实调用 check-notes-lifecycle.sh
#   （hook 注入过滤见 hook-check-memory.test.sh — U7/CT-40 配对）
#
# 零真实仓库污染: 临时沙箱构造 memory/notes/ + task-state/（注入缝）。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LESSONS="$REPO_DIR/scripts/check-lessons-learned.sh"
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

# ── 6. 字段契约: check-lessons-learned 新写 Note 头含 状态: ──
echo "── 6. 字段契约: lessons 新写 Note 头含 状态: + 扩展字段 ──"
rm -rf "$TMP_DIR/memory/notes/proposed" "$TMP_DIR/memory/notes/implemented" "$TMP_DIR/memory/notes/archived" "$TMP_DIR/memory/notes/rejected"
mkdir -p "$TMP_DIR/memory/notes/proposed" "$TMP_DIR/memory/notes/implemented" "$TMP_DIR/memory/notes/archived" "$TMP_DIR/memory/notes/rejected"
set +e
# lessons 用 git rev-parse 定位 ROOT → 必须 cd 进沙箱 git 仓库（ROOT= 环境变量会被脚本内赋值覆盖）
OUT=$(cd "$TMP_DIR" && bash "$LESSONS" "测试教训" "TEST_CLASS" "true" "true" "描述" 2>&1)
CODE=$?
set -e
NEW_NOTE=$(ls "$TMP_DIR/memory/notes/proposed/"*.md 2>/dev/null | head -1 || true)
if [ -n "$NEW_NOTE" ]; then
  assert_contains "$(cat "$NEW_NOTE")" "状态: proposed" "新 Note 头含 状态: proposed"
  assert_contains "$(cat "$NEW_NOTE")" "class: TEST_CLASS" "扩展字段 class 保留"
  assert_contains "$(cat "$NEW_NOTE")" "日期:" "新 Note 头含 日期:"
  assert_contains "$(cat "$NEW_NOTE")" "决策:" "新 Note 头含 决策:"
  assert_contains "$(cat "$NEW_NOTE")" "理由:" "新 Note 头含 理由:"
else
  fail "lessons 未创建新 Note"
fi
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
# lessons 去重逻辑应识别同 class 条目（旧英文头可被 grep class 匹配）
set +e
OUT=$(cd "$TMP_DIR" && bash "$LESSONS" "旧格式重复" "OLD_FORMAT" "true" "true" "重复测试" 2>&1)
CODE=$?
set -e
assert_contains "$OUT" "更新已有条目" "旧英文头被 class 去重识别（兼容）"
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

# ── 11. #1253 性能回归: 禁「逐文件 spawn」——用进程启动次数断言（跨平台确定）──
echo "── 11. #1253 性能回归: 200 条 note 不得逐文件 spawn ──"
PERF_DIR="$TMP_DIR/perf-200"
rm -rf "$PERF_DIR" 2>/dev/null || true
mkdir -p "$PERF_DIR/memory/notes/proposed" "$PERF_DIR/task-state"
i=0
while [ "$i" -lt 200 ]; do
  printf -- '---\n状态: proposed\n---\n任务: D900%d\n' "$i" > "$PERF_DIR/memory/notes/proposed/2026-01-01-perf-$i.md"
  i=$((i + 1))
done
# 记录 grep 启动次数：旧实现 = 每文件 3 次（≥600）；新实现 = 0 次（python 单进程解析）
REAL_GREP="$(command -v grep)"
FAKE_GREP_DIR="$TMP_DIR/fakegrep"
rm -rf "$FAKE_GREP_DIR" 2>/dev/null || true
mkdir -p "$FAKE_GREP_DIR"
cat > "$FAKE_GREP_DIR/grep" <<EOF
#!/bin/bash
echo x >> "\${SPAWN_LOG:-/dev/null}"
exec "$REAL_GREP" "\$@"
EOF
chmod +x "$FAKE_GREP_DIR/grep"
SPAWN_LOG="$TMP_DIR/grep-spawns.log"
: > "$SPAWN_LOG"
set +e
_T0=$(date +%s%N)
OUT=$(SPAWN_LOG="$SPAWN_LOG" PATH="$FAKE_GREP_DIR:$PATH" ROOT="$PERF_DIR" bash "$GATE" 2>&1)
CODE=$?
_T1=$(date +%s%N)
set -e
_MS=$(( (_T1 - _T0) / 1000000 ))
_SPAWNS=$(wc -l < "$SPAWN_LOG" 2>/dev/null | tr -d ' \r\n')
[ -n "$_SPAWNS" ] || _SPAWNS=0
assert_exit 0 "$CODE" "200 条无卡 note → exit 0（迁移期放行）"
if [ "$_SPAWNS" -le 5 ]; then
  pass "grep 启动 ${_SPAWNS} 次 ≤ 5（#1253：一次进程解析；耗时 ${_MS}ms）"
else
  fail "grep 启动 ${_SPAWNS} 次 > 5 — 退化为逐文件 spawn（#1253 回归；旧实现 ≥600 次）"
fi
echo ""

# ── 12. #1253 超时降级: timeout 返回 124 ⇒ exit 2 + degraded E_TIMEOUT ──
echo "── 12. #1253 超时降级: timeout=124 ⇒ exit 2 + E_TIMEOUT ──"
FAKE_BIN="$TMP_DIR/fakebin"
rm -rf "$FAKE_BIN" 2>/dev/null || true
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/timeout" <<'EOF'
#!/bin/bash
exit 124
EOF
chmod +x "$FAKE_BIN/timeout"
set +e
OUT=$(PATH="$FAKE_BIN:$PATH" ROOT="$PERF_DIR" bash "$GATE" 2>&1)
CODE=$?
set -e
assert_exit 2 "$CODE" "timeout=124 → exit 2（判不了≠通过）"
assert_contains "$OUT" "degraded" "超时显式降级输出"
assert_contains "$OUT" "E_TIMEOUT" "降级 code = E_TIMEOUT"
echo ""

# ═══ 结果 ═══
echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
echo "═══════════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
