 #!/bin/bash
 # Loop Engineering V4.5.1 — 长运行熔断器 + 状态记忆检查
 #
 # 检测需要熔断的信号:
 #   1. verify-incremental 在单个任务中打到 5 轮上限
 #   2. STATE.md 同一免疫警告 24h 内累积超过阈值
 #   3. pre-commit 同一组在 24h 内连续失败超过 10 次
 #   4. --no-verify 在 24h 内使用超过 2 次
 #
 # 退出 0 = 正常, 退出 1 = 熔断触发 (需要人工介入)
 #
 # 用法: bash scripts/workflow/loop-context.sh [--check]
 #        --check: 仅检查, 不写入状态
 
 set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
 
 RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
 SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
 ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
 
 BREAKER_TRIPPED=0
 ONLY_CHECK=false
 [ "${1:-}" = "--check" ] && ONLY_CHECK=true
 
 echo ""
 echo -e "${CYAN}Loop Engineering V4.5.1 — 熔断器检查${RESET}"
 echo ""
 
 # 1. 循环轮次检查
 LOOP_STATE="$ROOT/.claude/loop-state.json"
 if [ -f "$LOOP_STATE" ]; then
   ITER=$(python3 -c "import json; print(json.load(open('$LOOP_STATE')).get('iteration',0))" 2>/dev/null || echo 0)
   ITER=${ITER//[^0-9]/}
   if [ "${ITER:-0}" -ge 5 ]; then
     echo -e "  ${RED}熔断: verify-incremental 已达 ${ITER} 轮上限${RESET}"
     echo "    当前任务已消耗全部自动修正轮次。请人工检查并修复根因。"
     BREAKER_TRIPPED=1
   elif [ "${ITER:-0}" -ge 3 ]; then
     echo -e "  ${YELLOW}警告: verify-incremental 已 ${ITER} 轮 (上限 5)${RESET}"
   else
     echo -e "  ${GREEN}循环轮次: ${ITER}/5${RESET}"
   fi
 else
   echo -e "  ${GREEN}循环轮次: 无活跃任务${RESET}"
 fi
 
 # 2. 免疫警告累积检查
 if [ -f "$ROOT/STATE.md" ]; then
   TODAY=$(date +%Y-%m-%d)
   CRITICAL_COUNT=$(grep "$TODAY" "$ROOT/STATE.md" 2>/dev/null | grep -c "ERROR" || echo 0)
   CRITICAL_COUNT=${CRITICAL_COUNT//[^0-9]/}
   if [ "${CRITICAL_COUNT:-0}" -gt 50 ]; then
     echo -e "  ${RED}熔断: 今日免疫警告 ERROR 级别 ${CRITICAL_COUNT} 条 (阈值 50)${RESET}"
     echo "    系统在重复触发同样的错误。请检查免疫警告模式并修复根因。"
     BREAKER_TRIPPED=1
   elif [ "${CRITICAL_COUNT:-0}" -gt 20 ]; then
     echo -e "  ${YELLOW}警告: 今日免疫警告 ERROR ${CRITICAL_COUNT} 条${RESET}"
   else
     echo -e "  ${GREEN}免疫警告: 今日 ${CRITICAL_COUNT} ERROR${RESET}"
   fi
 fi
 
 # 3. pre-commit 故障率检查
 FAILURE_LOG="$ROOT/.claude/pre-commit-failures.log"
 if [ -f "$FAILURE_LOG" ]; then
   TODAY=$(date +%Y-%m-%d)
   FAIL_COUNT=$(grep -c "$TODAY" "$FAILURE_LOG" 2>/dev/null | tr -d '\r' || echo 0)
   FAIL_COUNT=${FAIL_COUNT//[^0-9]/}
   [ -z "$FAIL_COUNT" ] && FAIL_COUNT=0
   if [ "${FAIL_COUNT:-0}" -gt 20 ]; then
     echo -e "  ${RED}熔断: 今日 pre-commit 失败 ${FAIL_COUNT} 次 (阈值 20)${RESET}"
     echo "    门禁本身可能存在误报或过于敏感。请检查 check-secrets / as any / empty catch 的误报率。"
     BREAKER_TRIPPED=1
   elif [ "${FAIL_COUNT:-0}" -gt 10 ]; then
     echo -e "  ${YELLOW}警告: 今日 pre-commit 失败 ${FAIL_COUNT} 次${RESET}"
   else
     echo -e "  ${GREEN}pre-commit 失效率: ${FAIL_COUNT} 次 (正常)${RESET}"
   fi
 fi
 
 # 4. --no-verify 绕过检查
 BYPASS_LOG="$ROOT/.claude/bypass.log"
 if [ -f "$BYPASS_LOG" ]; then
   TODAY=$(date +%Y-%m-%d)
   # FIX-007: 只数**真绕过**行（`detected-bypass`），与 `scripts/pre-commit-check.sh:242`（V4.5.1 修正）
   #   同口径。旧判据 `grep -c "$TODAY"` 把当日 `COMMITTED`/`BLOCKED` 登记行一并计入
   #   ⇒ 3 条**合法提交登记**即误熔断全队（纯假红；陈旧/非绕过 marker 不参与熔断）。
   #   实测行形态：`… detected-bypass no-precommit-marker`（真绕过）vs
   #   `… | COMMITTED | pre-commit PASS (hook 层登记) | HASH=…`（合法登记，不计数）。
   BYPASS_COUNT=$(grep -c "${TODAY}.*detected-bypass" "$BYPASS_LOG" 2>/dev/null || true)
   BYPASS_COUNT=${BYPASS_COUNT//[^0-9]/}
   [ -z "$BYPASS_COUNT" ] && BYPASS_COUNT=0
   if [ "${BYPASS_COUNT:-0}" -ge 3 ]; then
     echo -e "  ${RED}熔断: 今日 --no-verify ${BYPASS_COUNT} 次 (阈值 3)${RESET}"
     echo "    见 pre-commit 第 7 组检查。请修复根因而非绕过。"
     BREAKER_TRIPPED=1
   elif [ "${BYPASS_COUNT:-0}" -ge 2 ]; then
     echo -e "  ${YELLOW}警告: 今日 --no-verify ${BYPASS_COUNT} 次${RESET}"
   else
     echo -e "  ${GREEN}绕过检查: ${BYPASS_COUNT} 次 (正常)${RESET}"
   fi
 fi
 
 # 结果
 echo ""
 if [ "$ONLY_CHECK" = true ]; then
   if [ "$BREAKER_TRIPPED" -gt 0 ]; then
     echo -e "${RED}熔断触发 — 需要人工介入${RESET}"
     exit 1
   else
     echo -e "${GREEN}系统正常 — 无需熔断${RESET}"
     exit 0
   fi
 fi
 
 # 写入状态
 BREAKER_FILE="$ROOT/.claude/breaker-state.json"
 if [ "$BREAKER_TRIPPED" -gt 0 ]; then
   python3 -c "
 import json
 json.dump({'tripped': True, 'ts': '$(date -u +%Y-%m-%dT%H:%M:%SZ)', 'reasons': ['loop-limit','immune-surge','gate-failure','bypass-abuse']}, open('$BREAKER_FILE', 'w'))
 " 2>/dev/null
   echo -e "${RED}熔断已写入 .claude/breaker-state.json${RESET}"
   exit 1
 else
   rm -f "$BREAKER_FILE"
   exit 0
 fi
