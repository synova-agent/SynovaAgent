#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# notes-four-state.test.sh — D395-a Agent Notes 四态 + Note 引用门禁测试
#
# 覆盖矩阵（铁律 48: 正常 + 降级 + 边界，非空壳）:
#   组 1 结构: 四态目录存在 / memory/ 零 .md 残留 / archived 归档 20 文件
#   组 2 契约: README 四字段头（状态/日期/决策/理由）+ git mv 迁移规则
#   组 3 门禁: 触发(无 Note→阻断) / 放行(含 Note→放行) / Note 不存在→阻断 /
#              不触发(改 src/l3/→跳过)
#   组 4 模板: generate-task-brief.py 含「### d) 相关 Note 引用」
#   组 5 回归: #1436 首行格式降噪 —— 非法 Conventional Commits 只提示不阻断
#
# 用法: bash tests/control-tower/notes-four-state.test.sh
# 退出码: 0 = 全部通过, 1 = 有失败
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMMIT_MSG_CHECK="$REPO_DIR/scripts/commit-msg-check.sh"
GENERATE_BRIEF="$REPO_DIR/scripts/workflow/generate-task-brief.py"
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

echo "═══════════════════════════════════════════════════════════"
echo "  D395-a: Agent Notes 四态 + Note 引用门禁测试"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ═══ 组 1: 四态目录 + 旧文件归档 ═══
echo "── 组 1: 四态目录 + 旧文件归档 ──"
for d in proposed implemented archived rejected; do
  if [ -d "$REPO_DIR/memory/notes/$d" ]; then
    pass "目录存在 memory/notes/$d"
  else
    fail "目录缺失 memory/notes/$d"
  fi
done
LEFTOVER=$(find "$REPO_DIR/memory" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
if [ "$LEFTOVER" = "0" ]; then
  pass "memory/ 下零 .md 残留（全部 git mv 归档）"
else
  fail "memory/ 下仍有 $LEFTOVER 个 .md 残留（应全归档）"
fi
ARCH_COUNT=$(find "$REPO_DIR/memory/notes/archived" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
if [ "$ARCH_COUNT" = "20" ]; then
  pass "archived/ 归档 20 个旧文件"
else
  fail "archived/ 计数=${ARCH_COUNT}（期望 20）"
fi
echo ""

# ═══ 组 2: README 四字段头契约 + git mv 迁移规则 ═══
echo "── 组 2: README 四字段头契约 + git mv 迁移规则 ──"
README="$REPO_DIR/memory/notes/README.md"
if [ ! -f "$README" ]; then
  fail "README.md 缺失"
else
  for f in 状态 日期 决策 理由; do
    if grep -q "$f" "$README"; then
      pass "README 含四字段头「${f}」"
    else
      fail "README 缺四字段头「${f}」"
    fi
  done
  if grep -q "git mv" "$README"; then
    pass "README 含 git mv 状态迁移规则"
  else
    fail "README 缺 git mv 状态迁移规则"
  fi
fi
echo ""

# ═══ 组 3: Note 引用门禁（temp git repo + SYNO_STAGED_FILES 注入）═══
echo "── 组 3: Note 引用门禁（commit-msg）──"
TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
cd "$TMP"
git init -q .
git config user.email test@test.local
git config user.name test
mkdir -p memory/notes/implemented
# 一个真实 Note 文件（供"文件存在"检查）
printf -- '---\n状态: implemented\n日期: 2026-08-17\n决策: 测试决策\n理由: 测试理由\n---\n' \
  > memory/notes/implemented/2026-08-17-test-note.md

run_gate() { # <staged> <msgfile>
  SYNO_STAGED_FILES="$1" bash "$COMMIT_MSG_CHECK" "$2" >/dev/null 2>&1
}

# 门禁触发: 改 control-tower + 无 Note → 阻断 (exit 1)
printf 'feat(D395): 改控制塔脚本\n' > msg_no_note.txt
if run_gate "scripts/control-tower/synova-commit" msg_no_note.txt; then
  fail "门禁触发: 改 control-tower 无 Note → 应阻断 exit 1"
else
  pass "门禁触发: 改 control-tower 无 Note → 阻断 exit 1"
fi

# 门禁触发: 改 orchestrator + 无 Note → 阻断 (exit 1)
printf 'feat(D395): 改编排器\n' > msg_orch_no_note.txt
if run_gate "src/orchestrator/event-bus.ts" msg_orch_no_note.txt; then
  fail "门禁触发: 改 orchestrator 无 Note → 应阻断 exit 1"
else
  pass "门禁触发: 改 orchestrator 无 Note → 阻断 exit 1"
fi

# 门禁放行: 改 control-tower + 含 Note 引用（Note 存在）→ 放行 (exit 0)
printf 'feat(D395): 改控制塔脚本，决策见 memory/notes/implemented/2026-08-17-test-note.md\n' > msg_with_note.txt
if run_gate "scripts/control-tower/synova-commit" msg_with_note.txt; then
  pass "门禁放行: 含 Note 引用（Note 存在）→ 放行 exit 0"
else
  fail "门禁放行: 含 Note 引用（Note 存在）→ 应放行 exit 0"
fi

# Note 文件存在检查: 引用不存在的 Note → 阻断 (exit 1)
printf 'feat(D395): 引用不存在的 Note memory/notes/implemented/2026-08-17-ghost.md\n' > msg_ghost.txt
if run_gate "scripts/control-tower/synova-commit" msg_ghost.txt; then
  fail "Note 存在检查: 引用不存在 Note → 应阻断 exit 1"
else
  pass "Note 存在检查: 引用不存在 Note → 阻断 exit 1"
fi

# 门禁不触发: 改 src/l3/（非 control-tower/orchestrator）→ 跳过 (exit 0)
printf 'feat(D395): 改 l3 文件，无需 Note\n' > msg_l3.txt
if run_gate "src/l3/some-module.ts" msg_l3.txt; then
  pass "门禁不触发: 改 src/l3/（非决策密集区）→ 跳过 exit 0"
else
  fail "门禁不触发: 改 src/l3/ → 应跳过 exit 0"
fi

cd "$REPO_DIR"
echo ""

# ═══ 组 4: generate-task-brief.py 模板字段 ═══
echo "── 组 4: generate-task-brief.py Q1 模板字段 ──"
if grep -q "相关 Note 引用" "$GENERATE_BRIEF"; then
  pass "generate-task-brief.py 含「### d) 相关 Note 引用」字段"
else
  fail "generate-task-brief.py 缺「### d) 相关 Note 引用」字段"
fi
echo ""

# ═══ 组 5: #1436 降噪 — 首行格式仅提示不阻断（后续检查仍执行）═══
echo "── 组 5: #1436 降噪 — 非法 Conventional Commits 首行仅提示不阻断 ──"
printf 'not-a-valid-commit-message\n' > "$TMP/msg_bad.txt"
OUT_BAD="$(SYNO_STAGED_FILES="src/l3/foo.ts" bash "$COMMIT_MSG_CHECK" "$TMP/msg_bad.txt" 2>&1)"; RC_BAD=$?
if [ "$RC_BAD" -eq 0 ] && printf '%s' "$OUT_BAD" | grep -q '仅提示，不阻断'; then
  pass "降噪: 非法 Conventional Commits 首行 → 仅提示不阻断 exit 0（#1436）"
else
  fail "降噪: 非法首行应 exit 0 且有提示（实际 rc=$RC_BAD）"
fi
echo ""

# ═══ 汇总 ═══
echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ 有失败用例"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
echo "  Status: ✅ 全部通过"
echo "═══════════════════════════════════════════════════════════"
exit 0
