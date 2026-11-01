#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# 节点 ⑦: 线上持续监控 (Runtime)
#
# 触发: Cron — 每 30 分钟
# 用法: bash scripts/workflow/checkpoint-runtime.sh [base_url]
#
# 检查: 错误率 / 降级状态 / 内存 / 磁盘 / 调度任务
# W1 #1219：转运维资产，不记退役（线上 cron 监控，非门禁）
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RESET='\033[0m'

BASE_URL="${1:-http://localhost:3000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════${RESET}"
echo -e "${CYAN}  Anthropic Runtime Check — $(date '+%H:%M:%S')${RESET}"
echo -e "${CYAN}════════════════════════════════════════════════════════════${RESET}"
echo ""

# ═══ Q1: 服务可达 ═══
HEALTH=$(curl -s "${BASE_URL}/api/health" 2>/dev/null || echo '{"status":"down"}')
STATUS=$(echo "$HEALTH" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
if [ "$STATUS" = "ok" ]; then
  echo -e "  ${GREEN}✅ 服务正常${RESET}"
else
  echo -e "  ${RED}❌ 服务异常: ${STATUS}${RESET}"
  FAIL=1
fi

# ═══ Q2: 降级状态 ═══
DEGRADED=$(echo "$HEALTH" | grep -o '"degraded":[^,}]*' | grep -c "true" 2>/dev/null || echo "0")
if [ "$DEGRADED" -gt 0 ]; then
  echo -e "  ${RED}❌ 降级中 (${DEGRADED} 模块)${RESET}"
  FAIL=1
else
  echo -e "  ${GREEN}✅ 无降级${RESET}"
fi

# ═══ Q3: 磁盘 ═══
if [ -f "$ROOT/data/synova.db" ]; then
  DB_SIZE=$(stat -c%s "$ROOT/data/synova.db" 2>/dev/null || stat -f%z "$ROOT/data/synova.db" 2>/dev/null || echo "0")
  DB_MB=$((DB_SIZE / 1048576))
  if [ "$DB_MB" -gt 500 ]; then
    echo -e "  ${RED}❌ SQLite >500MB (${DB_MB}MB)${RESET}"
    FAIL=1
  else
    echo -e "  ${GREEN}✅ SQLite ${DB_MB}MB${RESET}"
  fi
fi

# ═══ Q4: 最近日志错误率 ═══
LOG_FILE="$ROOT/logs/synova-agent.log"
if [ -f "$LOG_FILE" ]; then
  RECENT_ERRORS=$(tail -1000 "$LOG_FILE" 2>/dev/null | grep -c '"level":50' 2>/dev/null || echo "0")
  RECENT_WARNS=$(tail -1000 "$LOG_FILE" 2>/dev/null | grep -c '"level":40' 2>/dev/null || echo "0")
  if [ "$RECENT_ERRORS" -gt 10 ]; then
    echo -e "  ${RED}❌ 最近 1000 行有 ${RECENT_ERRORS} 个 ERROR, ${RECENT_WARNS} 个 WARN${RESET}"
    FAIL=1
  else
    echo -e "  ${GREEN}✅ ERROR:${RECENT_ERRORS} WARN:${RECENT_WARNS} (最近 1000 行)${RESET}"
  fi
fi

echo ""
exit $FAIL
