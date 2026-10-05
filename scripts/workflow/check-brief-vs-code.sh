 #!/bin/bash
 # ============================================================
 # Loop Engineering V4.4.5 — check-brief-vs-code.sh
 # Task Brief 声明 vs 实际代码变更 一致性物理验证
 #
 # 设计哲学:
 #   bash 不问 Agent "你是不是认真想了"——bash 只对比例证。
 #   brief 的 Q2 范围声明了改哪些文件 → bash grep 实际变更
 #   brief 的 Q1 声明了决策原则 → bash 验证每一条在 Done 标准中有对应 verify
 #   brief 的 Q3 声明了验收路径 → bash 验证每条 verify 命令在当前代码中能执行
 #
 # 用法: bash scripts/workflow/check-brief-vs-code.sh [--strict]
 #       --strict: 文件范围不匹配 = 硬阻断。默认模式: 警告。
 # pre-commit 第 6 组调用。全部 <3s。
 #
 # Anthropic 原则 7: "算两次" — brief 说改 A/B/C，git diff 显示 A/B/C/D/E
 #     → 要么 D/E 是遗漏的声明（brief 不诚实），要么是计划外变更（失控）。
 #     不管哪种情况，物理不一致 = 应该停止并修正。
 # ============================================================
 
 set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
 
 RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
 ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
 STRICT_MODE=false
 [ "${1:-}" = "--strict" ] && STRICT_MODE=true
 
 HARD_FAIL=0
 WARN_COUNT=0
 
 # 找到当前 brief — D296 认领制 (跨 session 污染根治)
 BRIEF=$(bash "$ROOT/scripts/workflow/resolve-commit-brief.sh" "$(git diff --cached --name-only 2>/dev/null || true)" 2>/dev/null || true)
 
 if [ -z "$BRIEF" ]; then
   echo "check-brief-vs-code: 无 task brief, 跳过"
   exit 0
 fi
 
 echo ""
 echo -e "${CYAN}=== check-brief-vs-code: Brief 声明 vs 代码变更 ===${RESET}"
 echo -e "${CYAN}Brief: $(basename "$BRIEF")${RESET}"
 echo ""
 
 # ================================================================
 # 1. Q2 文件范围一致性: brief 声称改的文件 vs 实际 git diff
 # ================================================================
 echo -e "${CYAN}--- 1. Q2 文件范围 vs 实际变更 ---${RESET}"
 
 # 提取 Q2 中声明的文件路径 (D313 M3 同源: 优先 brief_parser.py 的 - 行提取, 兜底反引号)
 REPO_ROOT_BCV="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
 DECLARED_FILES=$(python3 "$REPO_ROOT_BCV/scripts/control-tower/brief_parser.py" --q2-include "$BRIEF" 2>/dev/null \
   | grep -v 'node_modules\|\.test\.' | sort -u || true)
 if [ -z "$DECLARED_FILES" ]; then
    # 兜底: 反引号路径（旧格式 brief 兼容）
    # D962 task-32 R1（跨方言修复）: 原模式依赖『转义反引号 = 字面反引号』，该语义**两方言不一致** ——
    #   GNU grep 把 \` 当扩展锚点（缓冲区起始）⇒ **实测在 GNU 下恒不匹配**、Q2 兜底抽取恒返空
    #   （ubuntu 腿=GNU grep；macOS 腿=BSD grep）。改用方括号包裹反引号：POSIX 等价、两方言一致。
    DECLARED_FILES=$(sed -n '/^## Q2:/,/^## Q3:/p' "$BRIEF" 2>/dev/null \
      | grep -oE '[`][^`]+\.[a-z]{2,5}[`]' \
      | sed 's/`//g' \
      | grep -v 'node_modules\|\.test\.' \
      | sort -u || true)
 fi
 
 # 实际变更的源文件 (排除 test/non-src)
 ACTUAL_FILES_STAGED=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null \
   | grep -E '\.(ts|tsx|js|json|sh|md|yaml|yml|html|css|py)$' \
   | grep -v 'node_modules\|\.test\.\|\.d\.ts\|package-lock\|\.claude/' \
   | sort -u || true)
 ACTUAL_FILES_UNSTAGED=$(git diff --name-only 2>/dev/null \
   | grep -E '\.(ts|tsx|js|json|sh|md|yaml|yml|html|css|py)$' \
   | grep -v 'node_modules\|\.test\.\|\.d\.ts\|package-lock\|\.claude/' \
   | sort -u || true)
 # CI 范围源（D962-B2 自根目录死副本移植，D520/D708 棘轮修复此前落在未被执行的
 # 根目录 check-brief-vs-code.sh 上）：CI 检出无 staged/unstaged diff，
 # 基准必须取 merge-base（裸 HEAD..HEAD~1 在刷新分支的合并提交下会把被并入的
 # main 全部改动判为越界——#520 D721 实证）。无 origin/main → 回退并显式提示（降级可见）。
 DIFF_BASE=""
 if MB=$(git merge-base refs/remotes/origin/main HEAD 2>/dev/null) && [ -n "$MB" ]; then
   DIFF_BASE="$MB"
 else
   echo "  origin/main 不可用 — diff 基准回退 HEAD~1（合并提交下会误判越界）"
 fi
 if [ -n "$DIFF_BASE" ]; then
   DIFF_ALL=$(git diff --name-only "$DIFF_BASE"..HEAD 2>/dev/null || true)
 else
   DIFF_ALL=$(git diff --name-only HEAD~1..HEAD 2>/dev/null || true)
 fi
 ACTUAL_FILES_CI=$(echo "$DIFF_ALL" 2>/dev/null \
   | grep -E '\.(ts|tsx|js|json|sh|md|yaml|yml|html|css|py)$' \
   | grep -v 'node_modules\|\.test\.\|\.d\.ts\|package-lock\|\.claude/' \
   | sort -u || true)
 ACTUAL_FILES=$(echo -e "${ACTUAL_FILES_STAGED}\n${ACTUAL_FILES_UNSTAGED}\n${ACTUAL_FILES_CI}" | sort -u | grep -v '^$' || true)
 
 # 如果 brief 的 Q2 没有任何文件声明，跳过此检查（允许纯文档/纯配置任务）
 if [ -z "$DECLARED_FILES" ]; then
   echo -e "  ${YELLOW}Q2 未声明具体文件路径 (可能是纯文档任务) — 跳过文件范围检查${RESET}"
 elif [ -z "$ACTUAL_FILES" ]; then
   echo -e "  ${YELLOW}无实际变更文件 (CI 检出场景) — 跳过文件范围检查${RESET}"
 else
   # 找出 ACTUAL 中有但 DECLARED 中没有的文件
   EXTRA_FILES=""
   while IFS= read -r f; do
     [ -z "$f" ] && continue
     if ! echo "$DECLARED_FILES" | grep -qF "$f" 2>/dev/null; then
       EXTRA_FILES="${EXTRA_FILES}  ${f}\n"
     fi
   done <<< "$ACTUAL_FILES"
 
   # 找出 DECLARED 中有但 ACTUAL 中没有的文件
   MISSING_FILES=""
   while IFS= read -r f; do
     [ -z "$f" ] && continue
     if ! echo "$ACTUAL_FILES" | grep -qF "$f" 2>/dev/null; then
       MISSING_FILES="${MISSING_FILES}  ${f}\n"
     fi
   done <<< "$DECLARED_FILES"
 
   if [ -n "$EXTRA_FILES" ]; then
     EXTRA_COUNT=$(echo -e "$EXTRA_FILES" | grep -c . 2>/dev/null || echo 0)
     if [ "$STRICT_MODE" = true ]; then
       echo -e "  ${RED}Q2 未声明的变更文件 (${EXTRA_COUNT} 个):${RESET}"
       echo -e "$EXTRA_FILES"
       echo "    请在 Q2 中列出所有计划修改的文件。如确为必要: 更新 brief。"
       HARD_FAIL=$((HARD_FAIL + 1))
     else
       echo -e "  ${YELLOW}Q2 未声明的变更文件 (${EXTRA_COUNT} 个, 警告):${RESET}"
       echo -e "$EXTRA_FILES"
       WARN_COUNT=$((WARN_COUNT + 1))
     fi
   else
     echo -e "  ${GREEN}实际变更文件均在 Q2 中声明${RESET}"
   fi
 
   if [ -n "$MISSING_FILES" ]; then
     MISS_COUNT=$(echo -e "$MISSING_FILES" | grep -c . 2>/dev/null || echo 0)
     echo -e "  ${YELLOW}Q2 声明但无实际变更 (${MISS_COUNT} 个, 警告):${RESET}"
     echo -e "$MISSING_FILES"
     echo "    可能已删除或计划变更。如不需要: 从 Q2 中移除。"
     WARN_COUNT=$((WARN_COUNT + 1))
   fi
 fi
 echo ""
 
 # ================================================================
 # 2. Q1 principles vs Done verify: 每条原则对应可验证命令
 # ================================================================
 echo -e "${CYAN}--- 2. Q1 原则 vs Done verify ---${RESET}"
 
 PLAN_FILE="$ROOT/.claude/plan.json"
 if [ -f "$PLAN_FILE" ]; then
   PRIN_COUNT=$(python3 -c "import json; print(len(json.load(open('$PLAN_FILE', encoding='utf-8')).get('principles',[])))" 2>/dev/null || echo 0)
   PRIN_COUNT=${PRIN_COUNT//[^0-9]/}
   
   VERIFY_COUNT=$(grep -c 'verify:' "$BRIEF" 2>/dev/null || echo 0)
   VERIFY_COUNT=${VERIFY_COUNT//[^0-9]/}
   
   if [ "${PRIN_COUNT:-0}" -gt 0 ]; then
     if [ "${VERIFY_COUNT:-0}" -lt "${PRIN_COUNT:-1}" ]; then
       echo -e "  ${RED}plan 有 ${PRIN_COUNT} 条原则，但 Done 标准仅 ${VERIFY_COUNT} 个 verify [硬阻断]${RESET}"
       echo "    每条原则必须对应至少一个可验证的 Done 标准。"
       HARD_FAIL=$((HARD_FAIL + 1))
     else
       echo -e "  ${GREEN}原则 ${PRIN_COUNT} 条 -> Done verify ${VERIFY_COUNT} 个${RESET}"
     fi
   fi
 else
   echo -e "  ${GREEN}无 plan.json — 跳过原则检查${RESET}"
 fi
 echo ""
 
 # ================================================================
 # 3. Q3 验收路径验证: verify 命令是否可解析
 # ================================================================
 echo -e "${CYAN}--- 3. Q3/Done verify 命令可行性 ---${RESET}"
 
 # 提取 Done 标准中所有的 verify: <命令>
 VERIFY_CMDS=$(sed -n '/^## Done/,/^## /p' "$BRIEF" 2>/dev/null | grep 'verify:' | sed 's/.*verify:\s*//' | grep -v '^$')
 
 if [ -z "$VERIFY_CMDS" ]; then
   echo -e "  ${YELLOW}无 verify 命令 — 跳过${RESET}"
 else
   VALID_COUNT=0
   INVALID_COUNT=0
   while IFS= read -r cmd; do
     [ -z "$cmd" ] && continue
     # 检查命令是否是合理的 shell 命令格式 (不以注释开头, 不是纯描述)
     if echo "$cmd" | grep -qE '^[a-zA-Z]|^\./|^npx |^npm |^node |^bash |^git |^grep |^ls |^wc |^find |^curl |^test |^\['; then
       VALID_COUNT=$((VALID_COUNT + 1))
     else
       INVALID_COUNT=$((INVALID_COUNT + 1))
       echo -e "  ${YELLOW}可能不可执行的 verify: ${cmd:0:80}${RESET}"
     fi
   done <<< "$VERIFY_CMDS"
   
   echo -e "  ${GREEN}可执行 verify: ${VALID_COUNT}${RESET}"
   if [ "$INVALID_COUNT" -gt 0 ]; then
     echo -e "  ${YELLOW}警告: ${INVALID_COUNT} 个 verify 命令格式可疑${RESET}"
   fi
 fi
 echo ""
 
 # ================================================================
 # 4. (可选) 代码变更是否侵入了 Q2 "不做" 列表
 # ================================================================
 echo -e "${CYAN}--- 4. Q2 禁区检查 ---${RESET}"
 
 # 提取 Q2 "不做什么" 区域的关键路径
 NO_GO_ZONES=$(sed -n '/^## Q2:/,/^## Q3:/p' "$BRIEF" 2>/dev/null \
   | grep -i '不做\|不修改\|不动\|不改\|不碰\|不涉及' \
   | grep -oE '[\w./-]+\.(ts|tsx|js|json|sh|md)' \
   | sort -u || true)
 
 if [ -n "$NO_GO_ZONES" ]; then
   VIOLATIONS=""
   while IFS= read -r zone; do
     [ -z "$zone" ] && continue
     if echo "$ACTUAL_FILES" | grep -qF "$zone" 2>/dev/null; then
       VIOLATIONS="${VIOLATIONS}  ${zone} (Q2 声明不修改，但实际有变更)\n"
     fi
   done <<< "$NO_GO_ZONES"
   
   if [ -n "$VIOLATIONS" ]; then
     echo -e "  ${RED}Q2 声明的禁区被侵入:${RESET}"
     echo -e "$VIOLATIONS"
     echo "    要么更新 Q2 范围，要么撤销这些变更。"
     HARD_FAIL=$((HARD_FAIL + 1))
   else
     echo -e "  ${GREEN}Q2 禁区未被侵入${RESET}"
   fi
 else
   echo -e "  ${GREEN}Q2 未声明禁区 — 跳过${RESET}"
 fi
 
 # 结果
 echo ""
 echo "=========================================="
 if [ "$HARD_FAIL" -gt 0 ]; then
   echo -e "${RED}brief-vs-code: ${HARD_FAIL} 项硬阻断失败${RESET}"
   exit 1
 elif [ "$WARN_COUNT" -gt 0 ]; then
   echo -e "${YELLOW}brief-vs-code: ${WARN_COUNT} 项警告 (不阻断)${RESET}"
   exit 0
 else
   echo -e "${GREEN}brief-vs-code: 全部一致${RESET}"
   exit 0
 fi
