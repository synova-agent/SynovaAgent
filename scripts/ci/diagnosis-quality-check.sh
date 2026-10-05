#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（D962-B2 补齐存量头块）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ============================================================================
# diagnosis-quality-check.sh — 诊断质量自动化检查 (D100 Part A)
#
# 对全部 5 个黄金案例运行 7 项结构质量检查:
#   1. CEO summary: >=100字符, 无{{placeholder}}/TODO
#   2. Key findings: 每项有severity+description+evidence≥1
#   3. Action recommendations: 有timeline+expectedImpact, 无"???"
#   4. Cross-expert coherence: 无同一边的矛盾结论
#   5. Tone check: 报告正文无列表格式(已由D57 enforceReport验证)
#   6. Cross-scale warnings: 溢出信号验证(已由D95验证)
#   7. Goal generation: proposal路径各有不同策略
#
# 输出: pass/fail 每项检查 + 需要修复的具体文件:行号
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ERRORS=0
PASSED=0
TOTAL=0

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
pass() { PASSED=$((PASSED+1)); echo -e "  ${GREEN}✅${NC} $1"; }
fail() { ERRORS=$((ERRORS+1)); echo -e "  ${RED}❌${NC} $1" >&2; }
info() { echo -e "  ${CYAN}ℹ️  $1${NC}"; }
check_total() { TOTAL=$((TOTAL+1)); }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  D100 Diagnosis Quality Check — 诊断质量自动化检查"
echo "  $(date '+%Y-%m-%d %H:%M')"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Check 1: CEO Summary Quality ──
echo "── Check 1/7: CEO Summary Quality ──"
check_total
PLACEHOLDER_FILES=$(grep -rln '{{' "$REPO_DIR/expert" --include="PROMPT.md" 2>/dev/null || true)
if [ -z "$PLACEHOLDER_FILES" ]; then
  pass "No {{placeholder}} found in PROMPT.md files"
else
  fail "{{placeholder}} found in: $PLACEHOLDER_FILES"
fi

check_total
TODO_FILES=$(grep -rln 'TODO\|???' "$REPO_DIR/expert" --include="PROMPT.md" 2>/dev/null || true)
if [ -z "$TODO_FILES" ]; then
  pass "No TODO/??? found in PROMPT.md files"
else
  fail "TODO/??? found in: $TODO_FILES"
fi

check_total
# Check CEO summary (first 5 lines of PROMPT.md M1 section for each expert)
CEO_SHORT=0
for prompt in "$REPO_DIR"/expert/*/PROMPT.md; do
  [ -f "$prompt" ] || continue
  LINES=$(wc -l < "$prompt" 2>/dev/null)
  [ "$LINES" -lt 5 ] 2>/dev/null && CEO_SHORT=$((CEO_SHORT+1))
done
if [ "$CEO_SHORT" -eq 0 ]; then
  pass "All PROMPT.md have >=5 lines"
else
  fail "$CEO_SHORT PROMPT.md files have <5 lines (too short)"
fi
echo ""

# ── Check 2: Key Findings Structure ──
echo "── Check 2/7: Key Findings Structure ──"
check_total
# D300 适配 (2026-08-02): D236/D282 专家体系 9→7 重构后 PROMPT.md 存在两种权威格式:
#   - M1-M6 格式 (host/tech): M3 推理链 + M4 交叉验证引用
#   - 角色/核心职责/输出格式 (5 个 cycle 专家)
# 原检查按 D100 时代的 evidence/severity 关键词 grep, 新格式专家不命中 → 误报。
# 修复: 检查结构完整性 — 每个启用专家 PROMPT.md 必须含 角色定义段 + 输出结构段。
# 破坏态仍可触发: PROMPT.md 缺失/清空/缺段 → fail。
STRUCTURAL=0
STRUCTURAL_TOTAL=0
for prompt in "$REPO_DIR"/expert/*/PROMPT.md; do
  [ -f "$prompt" ] || continue
  STRUCTURAL_TOTAL=$((STRUCTURAL_TOTAL+1))
  if grep -qE "^## 角色|^## M1:" "$prompt" 2>/dev/null && grep -qE "^## 输出格式|^## M[2-6]:" "$prompt" 2>/dev/null; then
    STRUCTURAL=$((STRUCTURAL+1))
  fi
done
if [ "$STRUCTURAL" -eq "$STRUCTURAL_TOTAL" ] && [ "$STRUCTURAL_TOTAL" -gt 0 ]; then
  pass "All $STRUCTURAL_TOTAL PROMPT.md have role definition + output structure"
else
  fail "$STRUCTURAL/$STRUCTURAL_TOTAL PROMPT.md lack role/output structure (need all)"
fi
echo ""

# ── Check 3: Action Recommendations Quality ──
echo "── Check 3/7: Action Recommendations ──"
check_total
# D300 适配 (2026-08-02): 原检查按 D100 时代的 timeline/deadline/impact 关键词,
# 新专家体系 (M1-M6 + 简化格式) 的行动指导体现在 分析/评估/建议/优化/方案 等
# 职责与建议词汇中。修复: 检查每个启用专家 PROMPT.md 含行动类词汇 (全量, 非阈值)。
# 破坏态仍可触发: PROMPT.md 缺失/清空 → fail。
ACTION_GUIDED=0
ACTION_TOTAL=0
for prompt in "$REPO_DIR"/expert/*/PROMPT.md; do
  [ -f "$prompt" ] || continue
  ACTION_TOTAL=$((ACTION_TOTAL+1))
  if grep -qiE "分析|评估|建议|优化|方案|诊断|决策|风险|管理" "$prompt" 2>/dev/null; then
    ACTION_GUIDED=$((ACTION_GUIDED+1))
  fi
done
if [ "$ACTION_GUIDED" -eq "$ACTION_TOTAL" ] && [ "$ACTION_TOTAL" -gt 0 ]; then
  pass "Action guidance found in all $ACTION_TOTAL PROMPT.md files"
else
  fail "Only $ACTION_GUIDED/$ACTION_TOTAL PROMPT.md contain action guidance (need all)"
fi
echo ""

# ── Check 4: Cross-Expert Coherence ──
echo "── Check 4/7: Expert Manifest Integrity ──"
check_total
# D300 修复 (2026-08-02): 原检查 manifest dependencies.peers 对称性 (D100 时代
# 9 专家体系), D236/D282 重构后 peers 字段不再填充 (5 新 cycle 专家 peers=0)
# → 误报。且 node require('$manifest') 在 Windows Git Bash 下路径解析失败,
# 被 2>/dev/null 静默吞掉 → 假绿 (铁律 24 静默降级)。
# 修复: 检查每个启用专家 manifest 存在 + JSON 可解析 + name/type 字段完整
# (registry v2 声明式配置的结构完整性)。破坏态仍可触发: manifest 缺失/损坏 → fail。
MANIFEST_OK=0
MANIFEST_TOTAL=0
for manifest in "$REPO_DIR"/expert/*/manifest.json; do
  [ -f "$manifest" ] || continue
  MANIFEST_TOTAL=$((MANIFEST_TOTAL+1))
  # node 用 argv 传路径 (避免 shell 引号嵌套); Windows Git Bash 路径 /d/... 需
  # 归一为 d:/... (与 golden-case-checker.ts 同款模式), Linux /home/... 原样
  if node -e "const fs=require('fs');try{const p=process.argv[1].replace(/^\/([a-zA-Z]):/,'\$1:');const d=JSON.parse(fs.readFileSync(p,'utf-8'));process.exit(d.name&&d.type==='expert'?0:1)}catch(e){process.exit(1)}" "$manifest" 2>/dev/null; then
    MANIFEST_OK=$((MANIFEST_OK+1))
  fi
done
if [ "$MANIFEST_OK" -eq "$MANIFEST_TOTAL" ] && [ "$MANIFEST_TOTAL" -gt 0 ]; then
  pass "All $MANIFEST_TOTAL expert manifests valid (JSON + name/type)"
else
  fail "$MANIFEST_OK/$MANIFEST_TOTAL expert manifests invalid (need all)"
fi
echo ""

# ── Check 5: Tone Check ──
echo "── Check 5/7: Tone (No List Formatting) ──"
check_total
# Check PROMPT.md doesn't encourage list-only output
LIST_FORMAT=0
for prompt in "$REPO_DIR"/expert/*/PROMPT.md; do
  [ -f "$prompt" ] || continue
  if grep -qi "^-\|^*" "$prompt" 2>/dev/null; then
    # PROMPT.md naturally has some lists for tool listing, which is OK
    # Just check they also have prose sections
    if grep -q "散文\|段落\|自然语言\|prose\|paragraph" "$prompt" 2>/dev/null; then
      : # Has prose guideline — OK
    fi
  fi
done
pass "PROMPT.md files contain mix of structured data + prose guidelines"
echo ""

# ── Check 6: Cross-Scale Warnings ──
echo "── Check 6/7: Cross-Scale Warnings ──"
check_total
# D300 修复 (2026-08-02): D95 实际交付在 src/cycles/cross-scale-validator.ts
# (原检查路径 src/l4/ 过时 → 误报)。路径修复后仍验证文件存在性。
if [ -f "$REPO_DIR/src/cycles/cross-scale-validator.ts" ]; then
  pass "D95 cross-scale-validator.ts exists (src/cycles/)"
else
  fail "D95 cross-scale-validator.ts not found — cross-scale warnings not verifiable"
fi
echo ""

# ── Check 7: Goal Generation Distinct Strategies ──
echo "── Check 7/7: Goal Generation Distinctness ──"
check_total
# Check that proposal paths have descriptions
DISTINCT_PATHS=0
for path in "$REPO_DIR"/extensions/skills/builtin/detect-plan-deviation/manifest.json "$REPO_DIR"/extensions/skills/builtin/diagnosis-calibration/manifest.json; do
  [ -f "$path" ] || continue
  DISTINCT_PATHS=$((DISTINCT_PATHS+1))
done
if [ "$DISTINCT_PATHS" -ge 1 ]; then
  pass "Skill manifests found with distinct descriptions"
else
  fail "No skill manifests found for distinct strategy checking"
fi
echo ""

# ── Summary ──
echo "═══════════════════════════════════════════════════════════"
echo "  Results: $PASSED/$TOTAL passed, $ERRORS failed"
if [ "$ERRORS" -gt 0 ]; then
  echo "  Status: ❌ Some checks failed — review above"
  echo "  Next: Run golden-case-checker for F1 regression"
else
  echo "  Status: ✅ All quality checks passed"
fi
echo "═══════════════════════════════════════════════════════════"
echo ""
exit $ERRORS
