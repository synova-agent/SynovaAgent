 #!/bin/bash
 # Loop Engineering V4.5.1 �?Loop Ready Score (0-100)
 #
 # 基于实际基础设施的量化自评。每个维度有明确的检查项和分值�?
 # 评分维度:
 #   State & Memory (20) �?STATE.md + MEMORY.md + LOOP.md + loop-run-log
 #   Gates & Hooks (25)   �?pre-commit + pre-push + commit-msg + post-commit
 #   Verification (23)    �?verify-incremental 四层 + 接线审计 + 铁律门禁
 #   Task Discipline (15) �?task-start.sh + task brief + plan.json
 #   Safety (10)          �?secrets 扫描 + 架构边界 + 熔断�?
 #   Operability (10)     �?loop-sync + loop-context + post-merge-cleanup + deploy verify
 #
 # 用法: bash scripts/workflow/loop-score.sh [--badge]
 #       --badge: 仅输�?markdown badge 代码
 
 set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
 
 RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
 SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
 ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
 
 SCORE=0
 MAX_SCORE=103
 
 check() {
   local label="$1" points="$2" condition="$3"
   if eval "$condition" 2>/dev/null; then
     SCORE=$((SCORE + points))
     echo -e "  ${GREEN}+${points}  ${label}${RESET}"
   else
     echo -e "  ${RED}  0  ${label}${RESET}"
   fi
 }
 
 # ===== State & Memory (20) =====
 echo -e "${CYAN}--- State & Memory (max 20) ---${RESET}"
 check "STATE.md 存在" 5 "[ -f '$ROOT/STATE.md' ]"
 check "STATE.md > 500 字节 (有实质内�?" 5 "[ -f '$ROOT/STATE.md' ] && [ \$(wc -c < '$ROOT/STATE.md') -gt 500 ]"
 check "LOOP.md 存在" 5 "[ -f '$ROOT/LOOP.md' ]"
 check "loop-run-log.md 存在" 5 "[ -f '$ROOT/loop-run-log.md' ]"
 echo ""
 
 # ===== Gates & Hooks (25) =====
 echo -e "${CYAN}--- Gates & Hooks (max 25) ---${RESET}"
 check "pre-commit hook 已安�? 8 "[ -f '$ROOT/.git/hooks/pre-commit' ]"
 check "pre-push hook 已安�? 5 "[ -f '$ROOT/.git/hooks/pre-push' ]"
 check "commit-msg hook (Conventional Commits)" 4 "[ -f '$ROOT/.git/hooks/commit-msg' ]"
 check "post-commit hook" 4 "[ -f '$ROOT/.git/hooks/post-commit' ]"
 check "pre-commit-check.sh 存在" 4 "[ -f '$ROOT/scripts/pre-commit-check.sh' ]"
 echo ""
 
 # ===== Verification (20) =====
 echo -e "${CYAN}--- Verification (max 23) ---${RESET}"
 check "verify-incremental.sh 存在" 6 "[ -f '$ROOT/scripts/workflow/verify-incremental.sh' ]"
 check "wire-check.sh 存在" 5 "[ -f '$ROOT/scripts/workflow/wire-check.sh' ]"
 # D962-B2: check-boundaries-incremental.sh 内联进 verify-incremental.sh L4b 后退役，移除存在性打分项
 check "check-secrets.sh 存在" 3 "[ -f '$ROOT/scripts/check-secrets.sh' ]"
 check "check-brief-vs-code.sh 存在 (Brief vs Code 一致性)" 4 "[ -f '$ROOT/scripts/workflow/check-brief-vs-code.sh' ]"
 echo ""
 
 # ===== Task Discipline (15) =====
 echo -e "${CYAN}--- Task Discipline (max 15) ---${RESET}"
 check "task-start.sh 存在" 5 "[ -f '$ROOT/scripts/workflow/task-start.sh' ]"
 check ".claude/task-briefs/ 目录存在" 3 "[ -d '$ROOT/.claude/task-briefs' ]"
 check "plan.json schema 存在" 3 "[ -f '$ROOT/.claude/plan-schema.json' ]"
 check "generate-task-brief.py 存在" 4 "[ -f '$ROOT/scripts/workflow/generate-task-brief.py' ]"
 echo ""
 
# ===== Safety (10) =====
 echo -e "${CYAN}--- Safety (max 10) ---${RESET}"
 check "check-architecture.sh 存在" 3 "[ -f '$ROOT/scripts/check-architecture.sh' ]"
 check "loop-context.sh (熔断器) 存在" 4 "[ -f '$ROOT/scripts/workflow/loop-context.sh' ]"
 # D962-B2: check-deprecated-mapping.sh 退役（防护由 gate-hits/gate-stats 聚合观测承接），移除存在性打分项
 echo ""
 
 # ===== Operability (10) =====
 echo -e "${CYAN}--- Operability (max 10) ---${RESET}"
 check "loop-sync.sh 存在" 3 "[ -f '$ROOT/scripts/workflow/loop-sync.sh' ]"
 check "post-merge-cleanup.sh 存在" 3 "[ -f '$ROOT/scripts/workflow/post-merge-cleanup.sh' ]"
 check "checkpoint-deploy.sh 存在" 2 "[ -f '$ROOT/scripts/workflow/checkpoint-deploy.sh' ]"
 check "checkpoint-runtime.sh 存在" 2 "[ -f '$ROOT/scripts/workflow/checkpoint-runtime.sh' ]"
 echo ""
 
 # 结果
 echo "=========================================="
 echo -e "${CYAN}Loop Ready Score: ${SCORE}/${MAX_SCORE}${RESET}"
 
 if [ "$SCORE" -ge 90 ]; then
   COLOR=brightgreen
   LEVEL="L3 �?生产�?
 elif [ "$SCORE" -ge 70 ]; then
  COLOR=yellow
   LEVEL="L2 �?辅助模式"
 elif [ "$SCORE" -ge 40 ]; then
   COLOR=orange
   LEVEL="L1 �?仅报�?
 else
   COLOR=red
   LEVEL="初始 �?基础设施缺失"
 fi
 
 echo -e "Level: ${LEVEL}"
 echo ""
 
 # 改进建议
 if [ "$SCORE" -lt 100 ]; then
   echo -e "${YELLOW}改进建议:${RESET}"
   [ ! -f "$ROOT/LOOP.md" ] && echo "  - 创建 LOOP.md 描述活跃循环"
   [ ! -f "$ROOT/loop-run-log.md" ] && echo "  - 创建 loop-run-log.md 记录运行日志"
   [ ! -f "$ROOT/.git/hooks/pre-commit" ] && echo "  - 安装 pre-commit hook: npm run hooks:install"
   [ ! -f "$ROOT/scripts/workflow/loop-sync.sh" ] && echo "  - 安装 loop-sync 漂移检�?
   [ ! -f "$ROOT/scripts/workflow/loop-context.sh" ] && echo "  - 安装 loop-context 熔断�?
   [ ! -f "$ROOT/scripts/workflow/post-merge-cleanup.sh" ] && echo "  - 安装 post-merge-cleanup"
 fi
 
 echo "=========================================="
 
# --badge 模式: 仅输�?markdown badge
 if [ "${1:-}" = "--badge" ]; then
   echo ""
   echo "[![Loop Ready](https://img.shields.io/badge/Loop_Ready-${SCORE}%2F100-${COLOR})](https://github.com/cobusgreyling/loop-engineering)"
 fi
 
 exit 0
