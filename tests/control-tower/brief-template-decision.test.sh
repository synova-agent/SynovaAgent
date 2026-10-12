#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# brief-template-decision.test.sh — D333 决策参考框架落地测试
#
# 覆盖（铁律 48：正常/降级/边界）:
#   1. brief 模板含 ### c) 决策参考系（四步框架字段）
#   2. 模板 Q0 c) 决策 含 DECISION-REFERENCE 提示（冲突 → 走四步）
#   3. 模板生成的 brief 实测含 ### c) 决策参考系（DS6 接线）
#   4. doc-registry.json 注册 DECISION-REFERENCE.md
#   5. inject-context.py 注入器含 DECISION-REFERENCE 引用
#   6. AGENTS.md 引用 DECISION-REFERENCE（新 session 必读）
#   7. VERSION.md 含 V4.7.5（版本落地声明）
#   8. 决策参考系字段含四步（①第一性原理 ②Anthropic ③开源实证 ④收敛）
#
# 用法: bash tests/control-tower/brief-template-decision.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP_DIR="$REPO_DIR/.codex/control-tower/tmp"
TEMPLATE="$REPO_DIR/scripts/workflow/generate-task-brief.py"
REGISTRY="$REPO_DIR/scripts/control-tower/doc-registry.json"
INJECTOR="$REPO_DIR/scripts/control-tower/inject-context.py"
DECISION_DOC="$REPO_DIR/docs/synova/coordination/DECISION-REFERENCE.md"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_contains() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi; }

mkdir -p "$TMP_DIR"
rm -f "$TMP_DIR"/d333-*.md 2>/dev/null || true

echo "═══════════════════════════════════════════════════════════"
echo "  D333 决策参考框架落地测试"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 前置：DECISION-REFERENCE.md 必须存在（创始人定稿）──
if [ ! -f "$DECISION_DOC" ]; then
  fail "DECISION-REFERENCE.md 不存在 — 框架源头缺失"
fi

# ── 1. 模板含 ### c) 决策参考系 ──
echo "── 1. 模板含决策参考系字段 ──"
assert_contains "$(cat "$TEMPLATE" 2>/dev/null)" "决策参考系" "模板含 ### c) 决策参考系" # swallow-ok: 文件缺失时测试读取（缺失=测试失败）

# ── 2. 模板 Q0 c) 决策 含 DECISION-REFERENCE 提示 ──
echo "── 2. Q0 c) 决策 冲突走四步提示 ──"
assert_contains "$(cat "$TEMPLATE" 2>/dev/null)" "DECISION-REFERENCE" "Q0 c) 决策 含 DECISION-REFERENCE 提示" # swallow-ok: 文件缺失时测试读取（缺失=测试失败）

# ── 3. 模板生成 brief 实测含决策参考系（DS6 接线）──
echo "── 3. 模板生成接线 ──"
BRIEF_FILE="$TMP_DIR/d333-template.md" TASK_DESC="D333 test" \
  python3 "$TEMPLATE" 2>/dev/null || true
if [ -f "$TMP_DIR/d333-template.md" ]; then
  assert_contains "$(cat "$TMP_DIR/d333-template.md")" "决策参考系" "模板生成 brief 含 ### c) 决策参考系"
else
  fail "模板未生成 ($TMP_DIR/d333-template.md)"
fi

# ── 4. doc-registry 注册 ──
echo "── 4. doc-registry 注册 ──"
assert_contains "$(cat "$REGISTRY" 2>/dev/null)" "DECISION-REFERENCE" "doc-registry.json 注册 DECISION-REFERENCE" # swallow-ok: 文件缺失时测试读取（缺失=测试失败）

# ── 5. inject-context.py 引用 ──
echo "── 5. 注入器引用 ──"
assert_contains "$(cat "$INJECTOR" 2>/dev/null)" "DECISION-REFERENCE" "inject-context.py 含 DECISION-REFERENCE 引用" # swallow-ok: 文件缺失时测试读取（缺失=测试失败）

# ── 6. AGENTS.md 引用（新 session 必读；CLAUDE.md 已于 2026-10-12 退役）──
echo "── 6. AGENTS.md 引用 ──"
assert_contains "$(cat "$REPO_DIR/AGENTS.md" 2>/dev/null)" "DECISION-REFERENCE" "AGENTS.md 引用 DECISION-REFERENCE（新 session 必读）" # swallow-ok: 文件缺失时测试读取（缺失=测试失败）

# ── 7. VERSION.md 含 V4.7.5 ──
echo "── 7. VERSION.md V4.7.5 ──"
assert_contains "$(cat "$REPO_DIR/.codex/control-tower/VERSION.md" 2>/dev/null)" "V4.7.5" "VERSION.md 含 V4.7.5 条目" # swallow-ok: 文件缺失时测试读取（缺失=测试失败）

# ── 8. 四步完整性 ──
echo "── 8. 四步框架完整性 ──"
GEN_BRIEF=""
if [ -f "$TMP_DIR/d333-template.md" ]; then GEN_BRIEF="$(cat "$TMP_DIR/d333-template.md")"; fi
assert_contains "$GEN_BRIEF" "第一性原理" "决策参考系含 ①第一性原理"
assert_contains "$GEN_BRIEF" "Anthropic 工程基线" "决策参考系含 ②Anthropic 工程基线"
assert_contains "$GEN_BRIEF" "开源实证" "决策参考系含 ③开源实证"
assert_contains "$GEN_BRIEF" "收敛检查" "决策参考系含 ④收敛检查"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ brief-template-decision 测试未通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
echo "  Status: ✅ brief-template-decision 测试全部通过"
echo "═══════════════════════════════════════════════════════════"
exit 0
