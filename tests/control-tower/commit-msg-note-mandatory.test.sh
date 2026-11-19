#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# commit-msg-note-mandatory.test.sh — D534 Note 引用门禁触发面扩展测试
#
# SUT: scripts/commit-msg-check.sh（D395-a Note 引用门禁 + D534 触发面扩展）
#
# 背景: D395-a 门禁只对 scripts/control-tower/ + src/orchestrator/ 触发；
#       D534 扩展触发面到治理脚本区（scripts/workflow/ + scripts/hooks/）+
#       规则文档区（AGENTS.md / CLAUDE.md / memory/notes/README.md）。
#       测试产物（*.test.sh）与纯文档（docs/）不属非平凡变更，不强制。
#
# 覆盖（铁律 48：正常/降级/边界/回归/排除，≥10 用例）:
#   1. 触发面: 暂存 scripts/workflow/task-start.sh + 无 Note → exit 1（阻断）
#   2. 触发面: 暂存 scripts/hooks/hook-block-write.sh + 无 Note → exit 1
#   3. 触发面: 暂存 AGENTS.md + 无 Note → exit 1
#   4. 触发面: 暂存 memory/notes/README.md + 无 Note → exit 1
#   5. 回归: 暂存 scripts/control-tower/staging_guard.py + 无 Note → exit 1（D395-a 行为不变）
#   6. 排除: 暂存 scripts/workflow/test-helper.test.sh（.test.sh）+ 无 Note → exit 0
#   7. 排除: 暂存 docs/synova/coordination/xxx.md（纯文档）+ 无 Note → exit 0
#   8. 通过: 暂存 scripts/workflow/task-start.sh + message 含 Note 且文件存在 → exit 0
#   9. 降级: message 含 memory/notes/ 但引用 Note 文件不存在 → exit 1（回归）
#  10. 边界: 无暂存文件 → exit 0（跳过）
#  11. 边界: 非常规首行 + 治理区暂存 + 无 Note → exit 1（#1436: 格式提示后仍执行 Note 检查）
#  12. 正常: 非常规首行 + 治理区暂存 + Note 存在 → exit 0（#1436: 后续检查继续且可通过）
#
# 隔离: 每个用例独立临时 repo（mktemp -d + git init）+ SYNO_STAGED_FILES 注入
#       暂存文件集（D395-a 注入缝，测试免跑真实 git diff）+ 空 .claude/task-briefs
#       （无今日 brief → D328 一致性检查 fail-open 跳过，只测 D395-a 门禁）。
#
# 用法: bash tests/control-tower/commit-msg-note-mandatory.test.sh
# 注意: LF 换行（tests/control-tower/ 与 D533 renormalize 共享目录 — S-7/S-8）
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECKER="$REPO_DIR/scripts/commit-msg-check.sh"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

# ─── 辅助: 临时 repo 构造（无 brief → D328 fail-open）───
make_repo() {
  local r; r=$(mktemp -d /tmp/gtb-note-XXXXXX)
  git -C "$r" init -q -b main
  git -C "$r" config user.email test@synova.local
  git -C "$r" config user.name "Test Runner"
  mkdir -p "$r/.claude/task-briefs"
  echo "$r"
}

# 运行 SUT: 注入暂存文件集 + 消息文件 → 返回 exit code
#   $1 = repo, $2 = staged_files（空串 = 无注入 → 走真实空暂存）, $3 = message
run_check() {
  local repo="$1" staged="$2" msg="$3"
  local mf; mf=$(mktemp /tmp/gtb-note-msg-XXXXXX)
  printf '%s\n' "$msg" > "$mf"
  local co; co=$(mktemp /tmp/gtb-note-out-XXXXXX)
  local exit_code=0
  if [ -n "$staged" ]; then
    (cd "$repo" && SYNO_STAGED_FILES="$staged" bash "$CHECKER" "$mf") >"$co" 2>&1 || exit_code=$?
  else
    (cd "$repo" && bash "$CHECKER" "$mf") >"$co" 2>&1 || exit_code=$?
  fi
  rm -f "$mf" "$co"
  echo "$exit_code"
}

echo "═══════════════════════════════════════════════════════════"
echo "  D534 Note 引用门禁触发面扩展 — 测试"
echo "  SUT: $CHECKER"
echo "═══════════════════════════════════════════════════════════"

# ─── 1. 触发面: scripts/workflow/ 无 Note → 阻断 ───
R=$(make_repo)
RC=$(run_check "$R" "scripts/workflow/task-start.sh" "feat(D534): test workflow trigger")
if [ "$RC" -eq 1 ]; then pass "workflow 触发: 暂存 scripts/workflow/task-start.sh 无 Note → exit 1"; else fail "workflow 触发 — 期望 exit=1 实际=$RC"; fi

# ─── 2. 触发面: scripts/hooks/ 无 Note → 阻断 ───
R=$(make_repo)
RC=$(run_check "$R" "scripts/hooks/hook-block-write.sh" "feat(D534): test hooks trigger")
if [ "$RC" -eq 1 ]; then pass "hooks 触发: 暂存 scripts/hooks/hook-block-write.sh 无 Note → exit 1"; else fail "hooks 触发 — 期望 exit=1 实际=$RC"; fi

# ─── 3. 触发面: AGENTS.md 无 Note → 阻断 ───
R=$(make_repo)
RC=$(run_check "$R" "AGENTS.md" "feat(D534): test AGENTS trigger")
if [ "$RC" -eq 1 ]; then pass "AGENTS.md 触发: 暂存 AGENTS.md 无 Note → exit 1"; else fail "AGENTS.md 触发 — 期望 exit=1 实际=$RC"; fi

# ─── 4. 触发面: memory/notes/README.md 无 Note → 阻断 ───
R=$(make_repo)
RC=$(run_check "$R" "memory/notes/README.md" "feat(D534): test README trigger")
if [ "$RC" -eq 1 ]; then pass "README 触发: 暂存 memory/notes/README.md 无 Note → exit 1"; else fail "README 触发 — 期望 exit=1 实际=$RC"; fi

# ─── 5. 回归: control-tower 无 Note → 仍阻断（D395-a 行为不变）───
R=$(make_repo)
RC=$(run_check "$R" "scripts/control-tower/staging_guard.py" "feat(D534): test ct regression")
if [ "$RC" -eq 1 ]; then pass "回归: 暂存 scripts/control-tower/ 无 Note → exit 1（D395-a 不变）"; else fail "回归 — 期望 exit=1 实际=$RC"; fi

# ─── 6. 排除: .test.sh 测试产物不强制 → 放行 ───
R=$(make_repo)
RC=$(run_check "$R" "scripts/workflow/test-helper.test.sh" "feat(D534): test test-file exempt")
if [ "$RC" -eq 0 ]; then pass "排除: 暂存 .test.sh 无 Note → exit 0（测试产物不强制）"; else fail "排除 .test.sh — 期望 exit=0 实际=$RC"; fi

# ─── 7. 排除: docs/ 纯文档不强制 → 放行 ───
R=$(make_repo)
RC=$(run_check "$R" "docs/synova/coordination/xxx.md" "feat(D534): test docs exempt")
if [ "$RC" -eq 0 ]; then pass "排除: 暂存 docs/ 纯文档无 Note → exit 0"; else fail "排除 docs/ — 期望 exit=0 实际=$RC"; fi

# ─── 8. 通过: workflow 触发 + Note 引用且文件存在 → 放行 ───
R=$(make_repo)
mkdir -p "$R/memory/notes/implemented"
touch "$R/memory/notes/implemented/2026-08-17-d406-lessons-channel.md"
RC=$(run_check "$R" "scripts/workflow/task-start.sh" "feat(D534): test note present

memory/notes/implemented/2026-08-17-d406-lessons-channel.md")
if [ "$RC" -eq 0 ]; then pass "通过: workflow 触发 + 引用 Note 文件存在 → exit 0"; else fail "通过用例 — 期望 exit=0 实际=$RC"; fi

# ─── 9. 降级: message 含 memory/notes/ 但文件不存在 → 阻断（回归）───
R=$(make_repo)
RC=$(run_check "$R" "scripts/workflow/task-start.sh" "feat(D534): test missing note

memory/notes/implemented/2026-08-99-nonexistent-note.md")
if [ "$RC" -eq 1 ]; then pass "降级: 引用 Note 文件不存在 → exit 1（回归）"; else fail "降级用例 — 期望 exit=1 实际=$RC"; fi

# ─── 10. 边界: 无暂存文件 → 跳过 exit 0 ───
R=$(make_repo)
RC=$(run_check "$R" "" "feat(D534): test empty staging")
if [ "$RC" -eq 0 ]; then pass "边界: 无暂存文件 → exit 0（跳过）"; else fail "边界用例 — 期望 exit=0 实际=$RC"; fi

# ─── 11. 边界: 非常规首行 + 治理区暂存 + 无 Note → exit 1 ───
# #1436: 首行格式只提示不退出；后续 Note 引用门禁必须照常拦截（不得整份跳过）。
R=$(make_repo)
RC=$(run_check "$R" "scripts/workflow/task-start.sh" "plain unconventional commit")
if [ "$RC" -eq 1 ]; then pass "#1436: 非常规首行 + 无 Note → 仍 exit 1（后续 Note 检查执行）"; else fail "#1436 非常规首行 + 无 Note — 期望 exit=1 实际=$RC"; fi

# ─── 12. 正常: 非常规首行 + 治理区暂存 + Note 存在 → exit 0 ───
R=$(make_repo)
mkdir -p "$R/memory/notes/implemented"
touch "$R/memory/notes/implemented/2026-08-17-d406-lessons-channel.md"
RC=$(run_check "$R" "scripts/workflow/task-start.sh" "plain unconventional commit

memory/notes/implemented/2026-08-17-d406-lessons-channel.md")
if [ "$RC" -eq 0 ]; then pass "#1436: 非常规首行 + Note 存在 → exit 0（后续检查继续且通过）"; else fail "#1436 非常规首行 + Note 存在 — 期望 exit=0 实际=$RC"; fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0
