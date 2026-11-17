#!/bin/bash
# Loop Engineering V4.5.1 — check-hardcoded.sh
# 检测阻碍无限扩展的硬编码模式。pre-commit 第10项。全 <1s。
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FAIL=0
# #1417: 单次 git diff 复用（原实现同一 diff 取 4 次，本机每次 ~1s）
DIFF="$(git diff --cached 2>/dev/null || true)"

# ═══ 模式1: 联合类型中硬编码了专家/哨兵/工具名 ═══
# 检测: type X = 'strategy' | 'org' | ...  ← 应该是 string
PATTERN1=$(printf '%s\n' "$DIFF" | grep "^+.*type.*=.*'[a-z_]*'.*|.*'[a-z_]*'" | grep -v "severity\|critical\|warning\|info\|high\|medium\|low\|improving\|stable\|declining\|dense\|sparse\|fragmented\|moderate\|healthy\|tight\|critical.*'" | grep -v "node_modules\|\.test\." | head -5 || true)
if [ -n "$PATTERN1" ]; then
  echo ""
  echo "⚠️  检测到可能的硬编码联合类型:"
  echo "$PATTERN1"
  echo "  → 如果这些值是专家/哨兵/工具名，应改为 string + 运行时校验"
  echo "  → 参考: ExpertType 已从联合类型改为 string (F1)"
  FAIL=1
fi

# ═══ 模式2: 数组硬编码了应可扩展的实体 ═══
# 检测: const arr = ['strategy', 'org', 'finance', ...]  ← 应从Registry/文件读取
PATTERN2=$(printf '%s\n' "$DIFF" | grep "^+.*= \['[a-z_]*'.*,.*'[a-z_]*'.*,.*'[a-z_]*'" | grep -v "severity\|node_modules\|\.test\." | head -5 || true)
if [ -n "$PATTERN2" ]; then
  echo ""
  echo "⚠️  检测到可能的硬编码数组:"
  echo "$PATTERN2"
  echo "  → 如果这些值代表可扩展的实体(专家/哨兵/工具)，应从配置或目录扫描获取"
  FAIL=1
fi

# ═══ 模式3: Set硬编码了后台/排除列表 ═══
# 检测: new Set(['knowledge', ...])  ← 应从 expert-registry.yaml 的 background:true 读取
PATTERN3=$(printf '%s\n' "$DIFF" | grep "^+.*new Set(\[.*'.*'.*\])" | grep -v "node_modules\|\.test\." | head -5 || true)
if [ -n "$PATTERN3" ]; then
  echo ""
  echo "⚠️  检测到可能的硬编码 Set:"
  echo "$PATTERN3"
  echo "  → 排除/后台列表应从配置文件读取，不硬编码"
  FAIL=1
fi

# ═══ 模式4: 大型硬编码 fallback 对象 ═══
# 检测: export const DEFAULT_XXX = { ... }  ← 应删除，文件优先
PATTERN4=$(printf '%s\n' "$DIFF" | grep "^+.*export const DEFAULT_[A-Z_]*.*=.*{" | head -5 || true)
if [ -n "$PATTERN4" ]; then
  echo ""
  echo "⚠️  检测到可能的硬编码 fallback 对象:"
  echo "$PATTERN4"
  echo "  → DEFAULT_* 硬编码违反文件优先原则。文件加载失败应拒绝启动，不静默降级"
  FAIL=1
fi

if [ "$FAIL" -eq 1 ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  以上为警告——不阻断 commit，但请人工审核是否合理。"
  echo "  如果是合法的有限枚举(如severity/category)，请忽略。"
  echo "  如果是应可扩展的实体列表(如expert类型)，请修复。"
  echo "═══════════════════════════════════════════════════════════"
fi

exit 0
