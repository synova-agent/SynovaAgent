#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# brief-parseable.test.sh — D313 M3 brief 契约测试
#
# 覆盖（铁律 48：正常/降级/边界）:
#   1. 模板输出 → plan-integrity --brief exit 0（模板同源，D962 第二批并入）
#   2. brief_parser.py --q2-include 从模板输出提取非空路径
#   3. 模板输出含 #CRITERIA: [A-D]
#   4. 手造坏 brief（无做什么段/无 #CRITERIA）→ exit 1 指明缺失项
#   5. brief 不存在 → exit 0 + degraded（fail-open）
#   6. 真实 D312 brief 回归：--q2-include 提取命中其路径
#
# 用法: bash tests/control-tower/brief-parseable.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PARSER="$REPO_DIR/scripts/control-tower/brief_parser.py"
CHECKER=("$REPO_DIR/scripts/check-plan-integrity.sh" --brief)  # D962 第二批: 判定并入 plan-integrity
TMP_DIR="$REPO_DIR/.codex/control-tower/tmp"
DEGRADED_LOG="$REPO_DIR/.codex/control-tower/logs/degraded-events.log"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_contains() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi; }
assert_exit() { if [ "$1" = "$2" ]; then pass "$3 (exit=$2)"; else fail "$3 — 期望 exit=$1 实际=$2"; fi; }
assert_not_contains() { if echo "$1" | grep -qF "$2"; then fail "$3 — 不应包含: $2"; else pass "$3"; fi; }

mkdir -p "$TMP_DIR"
rm -f "$TMP_DIR"/bp-*.md 2>/dev/null || true

echo "═══════════════════════════════════════════════════════════"
echo "  D313 brief-parseable 测试 — brief 契约"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. 模板输出 → 解析通过 ──
echo "── 1. 模板同源 ──"
BRIEF_FILE="$TMP_DIR/bp-template.md" TASK_DESC="D313 test" \
  python3 "$REPO_DIR/scripts/workflow/generate-task-brief.py" 2>/dev/null || true
if [ -f "$TMP_DIR/bp-template.md" ]; then
  OUT=$(bash "${CHECKER[@]}" "$TMP_DIR/bp-template.md" 2>&1) || true
  EXIT=$?
  assert_exit 0 "$EXIT" "模板输出通过 plan-integrity --brief"
else
  fail "模板未生成 ($TMP_DIR/bp-template.md)"
fi
echo ""

# ── 2. 同源解析提取 ──
echo "── 2. brief_parser 解析模板（parseable + 空态 OK）──"
OUT=$(python3 "$PARSER" --all "$TMP_DIR/bp-template.md" 2>&1) || true
if echo "$OUT" | grep -q '"parseable": true'; then
  pass "brief_parser 解析模板 parseable=true（模板初始 Q2 空态 OK）"
else
  fail "brief_parser 解析失败: $OUT"
fi
echo ""

# ── 3. #CRITERIA 存在 ──
echo "── 3. #CRITERIA 字段 ──"
OUT=$(python3 "$PARSER" --criteria "$TMP_DIR/bp-template.md" 2>&1) || true
if echo "$OUT" | grep -qE '^[A-D]$'; then pass "模板含 #CRITERIA: $OUT"; else fail "模板缺 #CRITERIA (输出: $OUT)"; fi
echo ""

# ── 4. 坏 brief → exit 1 ──
echo "── 4. 坏 brief 被拒 ──"
cat > "$TMP_DIR/bp-bad.md" <<'EOF'
# Bad Brief
## Q0: 定位
### a) 项目拼图
xxx
## Q2: 范围
不做什么：
- 不改 src/anything.ts
## 架构层: 基础设施
## Done 标准
- [ ] 无意义
EOF
EXIT=0
OUT=$(bash "${CHECKER[@]}" "$TMP_DIR/bp-bad.md" 2>&1) || EXIT=$?
assert_exit 1 "$EXIT" "坏 brief → exit 1"
assert_contains "$OUT" "#CRITERIA" "输出指明 #CRITERIA 缺失"
echo ""

# ── 5. brief 不存在 → fail-open ──
echo "── 5. brief 不存在 fail-open ──"
EXIT=0
OUT=$(bash "${CHECKER[@]}" "$TMP_DIR/bp-nonexist.md" 2>&1) || EXIT=$?
assert_exit 0 "$EXIT" "brief 不存在 → exit 0（fail-open）"
echo ""

# ── 6. 真实 D312 brief 回归 ──
echo "── 6. D312 真实 brief 回归 ──"
if [ -f "$REPO_DIR/.claude/task-briefs/D312-baseline-tools.md" ]; then
  OUT=$(python3 "$PARSER" --q2-include "$REPO_DIR/.claude/task-briefs/D312-baseline-tools.md" 2>&1) || true
  assert_contains "$OUT" "hook-git-guard.sh" "D312 brief 提取到 hook-git-guard.sh"
  assert_contains "$OUT" "baseline-check.sh" "D312 brief 提取到 baseline-check.sh"
else
  fail "D312 brief 不存在"
fi
echo ""

# ── 7. D317: legacy brief 仅报真实缺失（非 4 项假失败）+ PYBIN 断言 ──
echo "── 7. D317 legacy brief 回归 + PYBIN ──"
if [ -f "$REPO_DIR/.claude/task-briefs/2026-08-02-D286-GraphStore-unify.md" ]; then
  OUT=$(bash "${CHECKER[@]}" "$REPO_DIR/.claude/task-briefs/2026-08-02-D286-GraphStore-unify.md" 2>&1) || true
  assert_contains "$OUT" "#CRITERIA 缺失" "legacy brief 报 #CRITERIA 缺失（真实缺失项）"
  assert_not_contains "$OUT" "Q2 不可解析" "legacy brief 不报 Q2 假失败（python 可用时）"
  assert_not_contains "$OUT" "架构层未标注" "legacy brief 不报架构层假失败（D286 有 L4）"
else
  fail "D286 brief 不存在"
fi
assert_contains "$(grep -m1 'PYBIN=' "${CHECKER[0]}" || echo '')" "PYBIN=" "checker（plan-integrity --brief）有 PYBIN 解析（D317 跨平台回退）"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ brief-parseable 测试未通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
echo "  Status: ✅ brief-parseable 测试全部通过"
echo "═══════════════════════════════════════════════════════════"
exit 0
