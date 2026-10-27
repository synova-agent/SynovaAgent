#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-brief-parseable.test.sh — D313 M3 brief 契约测试
#   （#1072 rename：原名 brief-parseable.test.sh —— CT-40 配对规则要求
#     scripts/workflow/<name>.sh ↔ tests/control-tower/<name>.test.sh，见 ct-test-gate.sh:18/:45）
#
# 覆盖（铁律 48：正常/降级/边界）:
#   1. 模板输出 → check-brief-parseable exit 0（模板同源）
#   2. brief_parser.py --q2-include 从模板输出提取非空路径
#   3. 模板输出含 #CRITERIA: [A-D]
#   4. 手造坏 brief（无做什么段/无 #CRITERIA）→ exit 1 指明缺失项
#   5. brief 不存在 → exit 0 + degraded（fail-open）
#   6. 真实 D312 brief 回归：--q2-include 提取命中其路径
#   7. D317 legacy brief 回归 + PYBIN
#   8. #1072 显式空参 → exit 2 ＋ code BRIEF_ARG_EMPTY ＋ degraded(code/phase/retryable)
#   9. #1072 未传参 → 保留回退（rc≠2、不含 BRIEF_ARG_EMPTY、解析结论/跳过原因可见）
#  10. #1072 坏路径 → 现行为不变（exit 0 ＋「跳过 (fail-open)」＋ reason 口径 degraded）
#  11. #1072 调用点守卫接线（pre-commit-check.sh 不再恒传空参 ＋ BRIEF_UNCLAIMED 跳过分支）
#
# 断言形态纪律（#1072）: 必须 `EXIT=0; OUT=$(…) || EXIT=$?`，禁 `|| true` 后读 `$?`
#   （`|| true` 会把 `$?` 冲成 0 —— 既有用例 1 就踩过这个坑，新用例不得复制）。
#
# 用法: bash tests/control-tower/check-brief-parseable.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PARSER="$REPO_DIR/scripts/control-tower/brief_parser.py"
CHECKER="$REPO_DIR/scripts/workflow/check-brief-parseable.sh"
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
  OUT=$(bash "$CHECKER" "$TMP_DIR/bp-template.md" 2>&1) || true
  EXIT=$?
  assert_exit 0 "$EXIT" "模板输出通过 check-brief-parseable"
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
OUT=$(bash "$CHECKER" "$TMP_DIR/bp-bad.md" 2>&1) || EXIT=$?
assert_exit 1 "$EXIT" "坏 brief → exit 1"
assert_contains "$OUT" "#CRITERIA" "输出指明 #CRITERIA 缺失"
echo ""

# ── 5. brief 不存在 → fail-open ──
echo "── 5. brief 不存在 fail-open ──"
EXIT=0
OUT=$(bash "$CHECKER" "$TMP_DIR/bp-nonexist.md" 2>&1) || EXIT=$?
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

# ── 7. D317: legacy brief 现状回归 + 判别力（真缺 #CRITERIA 仍必须点名）+ PYBIN ──
echo "── 7. D317 legacy brief 回归 + 判别力 + PYBIN ──"
if [ -f "$REPO_DIR/.claude/task-briefs/2026-08-02-D286-GraphStore-unify.md" ]; then
  EXIT=0
  OUT=$(bash "$CHECKER" "$REPO_DIR/.claude/task-briefs/2026-08-02-D286-GraphStore-unify.md" 2>&1) || EXIT=$?
  # 存量漂移（非被测脚本回归）: 提交 841618108（#645 存量 brief 合规清理）已给该文件 :182
  # 补 `#CRITERIA: D`（补记注释见 :183）⇒ 原断言「必须报 #CRITERIA 缺失」的前提被推翻。
  # 判据改为「按现状不误报」＋下面自造「真缺 criteria」的 brief 继续守住判别力（禁删断言了事）。
  assert_exit 0 "$EXIT" "legacy brief 现状契约齐全 → exit 0"
  assert_not_contains "$OUT" "#CRITERIA 缺失" "legacy brief 不误报 #CRITERIA 缺失（841618108 已补记 D）"
  assert_not_contains "$OUT" "Q2 不可解析" "legacy brief 不报 Q2 假失败（python 可用时）"
  assert_not_contains "$OUT" "架构层未标注" "legacy brief 不报架构层假失败（D286 有 L4）"
  # 判别力保持（自造 brief：其余字段齐，仅缺 #CRITERIA ⇒ 必须点名该缺失项且 rc=1）
  cat > "$TMP_DIR/bp-no-criteria.md" <<'EOF'
# No-Criteria Brief（判别力用例：其余字段齐，仅缺 #CRITERIA）
## Q2: 范围
做什么：
- 改 scripts/workflow/check-brief-parseable.sh
## 架构层: 基础设施
## Done 标准
- [ ] 占位
EOF
  EXIT=0
  OUT_NO_CRIT=$(bash "$CHECKER" "$TMP_DIR/bp-no-criteria.md" 2>&1) || EXIT=$?
  assert_exit 1 "$EXIT" "仅缺 #CRITERIA 的 brief → exit 1（判别力保持）"
  assert_contains "$OUT_NO_CRIT" "#CRITERIA 缺失" "仅缺 #CRITERIA 时点名该缺失项"
else
  fail "D286 brief 不存在"
fi
assert_contains "$(grep -m1 '^PYBIN=' "$CHECKER" || echo '')" "PYBIN=" "checker 有 PYBIN 解析（D317 跨平台回退）"
echo ""

# ── 8. #1072 显式空参 → fail-closed（rc=2 ＋ BRIEF_ARG_EMPTY ＋ degraded 码字段）──
echo "── 8. #1072 显式空参 fail-closed ──"
mkdir -p "$(dirname "$DEGRADED_LOG")"
DEG_BEFORE=$(wc -l < "$DEGRADED_LOG" 2>/dev/null || echo 0)
EXIT=0
OUT=$(bash "$CHECKER" "" 2>&1) || EXIT=$?
DEG_AFTER=$(wc -l < "$DEGRADED_LOG" 2>/dev/null || echo 0)
assert_exit 2 "$EXIT" "显式空参 → exit 2（调用方 bug，非业务红）"
assert_contains "$OUT" "BRIEF_ARG_EMPTY" "输出点名 code BRIEF_ARG_EMPTY"
if [ "${DEG_AFTER:-0}" -gt "${DEG_BEFORE:-0}" ]; then
  DEG_LAST=$(tail -n 1 "$DEGRADED_LOG")
  assert_contains "$DEG_LAST" '"code": "BRIEF_ARG_EMPTY"' "degraded 记录含 code（铁律 32）"
  assert_contains "$DEG_LAST" '"phase": "arg-parse"' "degraded 记录含 phase（铁律 32）"
  assert_contains "$DEG_LAST" '"retryable": false' "degraded 记录含 retryable（铁律 32）"
else
  fail "空参未写 degraded 记录（行数 ${DEG_BEFORE}→${DEG_AFTER}，静默降级，铁律 11）"
fi
echo ""

# ── 9. #1072 未传参 → 保留既有回退（与「显式传空参」严格区分）──
echo "── 9. #1072 未传参 保留回退 ──"
EXIT=0
OUT=$(bash "$CHECKER" 2>&1) || EXIT=$?
if [ "$EXIT" = "2" ]; then
  fail "未传参被误判空参（exit=2）—— CLI 裸调回退语义丢失"
else
  pass "未传参不是 exit 2（实际 exit=${EXIT}；回退解析或 fail-open 均合法）"
fi
assert_not_contains "$OUT" "BRIEF_ARG_EMPTY" "未传参不报 BRIEF_ARG_EMPTY"
if printf '%s' "$OUT" | grep -q 'brief 可解析: '; then
  RLINE=$(printf '%s\n' "$OUT" | grep -m1 'brief 可解析: ')
  pass "未传参打印了解析目标: ${RLINE#*可解析: }"
  RPATH=$(printf '%s' "$RLINE" | sed -E 's/.*brief 可解析: ([^ ]+).*/\1/')
  if [ -f "$RPATH" ]; then pass "回退目标可打开: $RPATH"; else fail "回退目标不存在: $RPATH"; fi
else
  # 本树无可回退目标（无 .claude/current-brief、无当日 brief）⇒ fail-open 必须可见（禁静默）
  assert_contains "$OUT" "跳过 (fail-open)" "未传参：无可回退目标 → 显式 fail-open（非静默）"
  DEG_LAST=$(tail -n 1 "$DEGRADED_LOG")
  assert_contains "$DEG_LAST" "brief 不存在" "fail-open 在 degraded 记录里点名尝试目标（含 none）"
fi
echo ""

# ── 10. #1072 坏路径 → 现行为不变（fail-open；有参非空 ⇒ 不走 rc=2）──
echo "── 10. #1072 坏路径 现行为不变 ──"
DEG_BEFORE=$(wc -l < "$DEGRADED_LOG" 2>/dev/null || echo 0)
EXIT=0
OUT=$(bash "$CHECKER" "$TMP_DIR/bp-no-such-brief.md" 2>&1) || EXIT=$?
DEG_AFTER=$(wc -l < "$DEGRADED_LOG" 2>/dev/null || echo 0)
assert_exit 0 "$EXIT" "坏路径 → exit 0（fail-open，现行为不变）"
assert_contains "$OUT" "跳过 (fail-open)" "坏路径输出含「跳过 (fail-open)」"
assert_not_contains "$OUT" "BRIEF_ARG_EMPTY" "坏路径不报 BRIEF_ARG_EMPTY（有参且非空）"
if [ "${DEG_AFTER:-0}" -gt "${DEG_BEFORE:-0}" ]; then
  DEG_LAST=$(tail -n 1 "$DEGRADED_LOG")
  assert_contains "$DEG_LAST" '"reason": "brief 不存在' "坏路径 degraded 保留既有 reason 口径"
  assert_not_contains "$DEG_LAST" '"code": "BRIEF_ARG_EMPTY"' "坏路径 degraded 不混入空参 code"
else
  fail "坏路径未写 degraded 记录（静默降级，铁律 11）"
fi
echo ""

# ── 11. #1072 调用点守卫接线（WIRE CHECK：grep 零结果＝未完成）──
echo "── 11. #1072 调用点守卫接线 ──"
PCC="$REPO_DIR/scripts/pre-commit-check.sh"
CALL_LINE=$(grep -n 'check-brief-parseable\.sh"' "$PCC" | head -1 || true)
if [ -n "$CALL_LINE" ]; then
  pass "pre-commit-check.sh 有调用行: $CALL_LINE"
  if printf '%s' "$CALL_LINE" | grep -qF ':-}'; then
    fail "调用行仍是恒传参形态（\${…:-}）: $CALL_LINE"
  else
    pass "调用行不再恒传空参（无 :-} 形态）"
  fi
else
  fail "未在 pre-commit-check.sh 找到 check-brief-parseable.sh 调用行（未接线）"
fi
if grep -q 'BRIEF_UNCLAIMED' "$PCC"; then
  pass "存在 code BRIEF_UNCLAIMED 的显式跳过分支"
else
  fail "缺 BRIEF_UNCLAIMED 显式跳过分支（无认领 brief 会被空参 rc=2 误拦）"
fi
if grep -q 'if \[ -n "${BRIEF_RESOLVED:-}" \]' "$PCC"; then
  pass "空值守卫在调用点之前（BRIEF_RESOLVED 非空才传参）"
else
  fail "缺 BRIEF_RESOLVED 空值守卫（守卫即 M5 反例所针对的缝）"
fi
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
