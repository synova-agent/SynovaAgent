#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# generate-chronicle-monthly.sh — 月度史记草稿生成（治理机制 #4，GOVERNANCE.md）
#
# 契约（铁律 47 契约优先）:
#   输入:  $1 = YYYY-MM（缺省 = 当月）；环境 DOC_TRUTH_ROOT 可覆盖仓库根（测试用）
#   输出:  stdout = 月度史记草稿（markdown 片段，人工审阅后追加至 CHRONICLE.md）
#          exit 0 = 成功；1 = 月份格式非法
#   降级:  git 不可用/无提交 → ⚠️ 提示并跳过 git 部分（禁止静默，铁律 24/31）；
#          无 WORKLOG/审计/记忆文件 → 输出"本月无"提示（正常情况，不判失败）
# ═══════════════════════════════════════════════════════════════════════════════
set +e

MONTH="${1:-$(date +%Y-%m)}"
if ! [[ "$MONTH" =~ ^[0-9]{4}-[0-9]{2}$ ]]; then
  echo "❌ 月份格式必须为 YYYY-MM，收到: $MONTH" >&2
  exit 1
fi
ROOT="${DOC_TRUTH_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" # swallow-ok:
YEAR="${MONTH%-*}"; MM="${MONTH#*-}"
if [ "$MM" -lt 1 ] || [ "$MM" -gt 12 ]; then
  echo "❌ 月份非法（须为 01-12）: $MONTH" >&2
  exit 1
fi

echo "## 月度史记草稿 — $MONTH"
echo ""
echo "> 由 scripts/doc-system/generate-chronicle-monthly.sh 自动生成，人工审阅后追加至 CHRONICLE.md"
echo ""

# ── 1. git 提交统计 ──
echo "### 一、本月提交"
if git -c safe.directory="$ROOT" -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  LOG=$(git -c safe.directory="$ROOT" -C "$ROOT" log --all --format='%ad|%an|%s' --date=short 2>/dev/null | grep "^${MONTH}-") # swallow-ok:
  COUNT=$(echo "$LOG" | sed '/^$/d' | wc -l | tr -d ' ')
  echo "（共 ${COUNT:-0} 条提交，前 40 条）"
  echo ""
  echo "$LOG" | head -40 | sed 's/^/  - /'
  echo ""
  echo "#### 按作者"
  echo "$LOG" | awk -F'|' '{c[$2]++} END {for (a in c) print "  - " a ": " c[a] " 条"}' | sort
  echo ""
  DIDS=$(echo "$LOG" | grep -oE '\bD[0-9]{2,4}\b' | sort -u | tr '\n' ' ')
  [ -n "$DIDS" ] && echo "#### 涉及任务编号: $DIDS" && echo ""
else
  echo "  ⚠️ 降级: 当前目录不是 git 仓库（DOC_TRUTH_ROOT=${ROOT}），跳过提交统计"
  echo ""
fi

# ── 2. WORKLOG（日记）──
echo "### 二、本月工作日志（WORKLOG）"
WL=$(ls "$ROOT"/WORKLOG-${YEAR}${MM}*.md 2>/dev/null) # swallow-ok:
if [ -n "$WL" ]; then
  echo "$WL" | while read -r f; do echo "  - $(basename "$f")"; done
else
  echo "  （本月无 WORKLOG 文件——日记断更或未写）"
fi
echo ""

# ── 3. 审计报告 ──
echo "### 三、本月审计报告"
AR=$(ls "$ROOT"/docs/synova/audit-reports/${MONTH}-*.md 2>/dev/null) # swallow-ok:
if [ -n "$AR" ]; then
  echo "$AR" | while read -r f; do echo "  - $(basename "$f")"; done
else
  echo "  （本月无审计报告）"
fi
echo ""

# ── 4. 会话记忆 ──
echo "### 四、本月会话记忆（memory/session-*）"
MEM=$(ls "$ROOT"/memory/session-${MONTH}-*.md 2>/dev/null) # swallow-ok:
if [ -n "$MEM" ]; then
  echo "$MEM" | while read -r f; do echo "  - $(basename "$f")"; done
else
  echo "  （本月无 session 记忆文件）"
fi
echo ""

echo "---"
echo "> 人工审阅清单：本月关键决策 / 踩坑 / 里程碑 → 补写后追加至 CHRONICLE.md"
exit 0
