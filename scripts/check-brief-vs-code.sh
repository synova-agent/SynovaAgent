#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-brief-vs-code.sh — Task Brief vs 代码一致性验证 (V4.5.1)
#
# CI checker-review job 中运行。验证 task brief 中 Q0/Q1/Q2/Q3 的声明
# 与实际代码改动物理匹配。可物理验证的就不要交给 agent 自律。
#
# exit 0 = 全部通过
# exit 1 = 发现不一致
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'

HARD_FAIL=0

hard_check() { local name="$1" msg="$2"; if [ -n "$msg" ]; then echo -e "  ${RED}❌ ${name}: ${msg}${RESET}"; HARD_FAIL=$((HARD_FAIL + 1)); else echo -e "  ${GREEN}✅ ${name}${RESET}"; fi; }
warn_check() { local name="$1" msg="$2"; if [ -n "$msg" ]; then echo -e "  ${YELLOW}⚠️  ${name}: ${msg}${RESET}"; fi; }

# ═══ 找到当前分支的今日 brief ═══
TODAY=$(date +%Y-%m-%d)
echo -e "${CYAN}[check-brief-vs-code] 查找今日 brief (${TODAY})${RESET}"
BRIEF=$(find "$ROOT/.claude/task-briefs/" -type f -name "${TODAY}*" 2>/dev/null | xargs ls -t 2>/dev/null | head -1)

# 也检查 CLAUDE.md 中是否引用 V4.5.1
FLOW_CONSTRAINT=$(grep "流程约束" "$ROOT/CLAUDE.md" 2>/dev/null | grep -oE 'V[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
echo -e "  流程约束: ${FLOW_CONSTRAINT:-unknown}"

if [ -z "$BRIEF" ]; then
  echo -e "  ${YELLOW}无今日 brief — 跳过验证 (可能是 CI 触发推送)${RESET}"
  exit 0
fi
echo -e "  Brief: $(basename "$BRIEF")"

# ═══ Git diff 数据 ═══
# D721: 基准必须相对**与 main 的合并基点**（三点差）。旧基准 HEAD~1..HEAD 在合并提交
#   （刷新分支时 git merge origin/main）上 = 「被并入的 main 全部改动」→ G12 把这些文件
#   与当前 brief 的 Q2 写集比对 → 全部判为越界（CI strict 下硬阻断）。
#   实证: #520（D721）刷新后 G12 报「Q2 范围一致性: 1 处」，而该 PR 自身只改了 ci.yml/测试/登记。
#   无 origin/main（本地/首次 clone）→ 回退旧基准并显式提示（降级可见）。
DIFF_BASE=""
if MB=$(git merge-base refs/remotes/origin/main HEAD 2>/dev/null) && [ -n "$MB" ]; then
  DIFF_BASE="$MB"
else
  echo -e "  ${YELLOW}origin/main 不可用 — diff 基准回退 HEAD~1（合并提交下会误判越界）${RESET}"
fi
if [ -n "$DIFF_BASE" ]; then
  DIFF_ALL=$(git diff --name-only "$DIFF_BASE"..HEAD 2>/dev/null || true)
  NEW_FILES=$(git diff --name-only --diff-filter=A "$DIFF_BASE"..HEAD 2>/dev/null || true)
  MOD_FILES=$(git diff --name-only --diff-filter=M "$DIFF_BASE"..HEAD 2>/dev/null || true)
  DEL_FILES=$(git diff --name-only --diff-filter=D "$DIFF_BASE"..HEAD 2>/dev/null || true)
else
  DIFF_ALL=$(git diff --name-only HEAD~1..HEAD 2>/dev/null || git diff --name-only 2>/dev/null || true)
  NEW_FILES=$(git diff --name-only --diff-filter=A HEAD~1..HEAD 2>/dev/null || true)
  MOD_FILES=$(git diff --name-only --diff-filter=M HEAD~1..HEAD 2>/dev/null || true)
  DEL_FILES=$(git diff --name-only --diff-filter=D HEAD~1..HEAD 2>/dev/null || true)
fi
NEW_TS=$(echo "$NEW_FILES" | grep '\.ts$' | grep -v '\.test\.' | grep -v '\.d\.ts' || true)
NEW_JSON=$(echo "$NEW_FILES" | grep '\.json$' || true)
NEW_MANIFEST=$(echo "$NEW_FILES" | grep 'manifest\.json$' || true)

echo -e "  变更: ${CYAN}$(echo "$DIFF_ALL" | wc -l) 文件${RESET}"
echo -e "  新增: ${CYAN}$(echo "$NEW_FILES" | wc -l)${RESET}  修改: ${CYAN}$(echo "$MOD_FILES" | wc -l)${RESET}  删除: ${CYAN}$(echo "$DEL_FILES" | wc -l)${RESET}"

if [ -z "$DIFF_ALL" ] && [ -z "$NEW_FILES" ]; then
  echo -e "  ${YELLOW}无代码变更 — 跳过验证${RESET}"
  exit 0
fi

# ═══ 辅助: 从 brief 提取节内容 ═══
extract_section() {
  local section="$1"
  awk "/^## $section/{found=1; next} /^## /{if(found) exit} found" "$BRIEF" 2>/dev/null
}

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════${RESET}"
echo -e "${CYAN}  Brief vs 代码一致性验证${RESET}"
echo -e "${CYAN}════════════════════════════════════════════════════════════${RESET}"
echo ""

# ═══════════════════════════════════════════════════════════════════
# Q0a: 项目拼图
# ═══════════════════════════════════════════════════════════════════
echo -e "${CYAN}── Q0a: 项目拼图 ──${RESET}"

Q0A=$(extract_section "Q0")
LAYER=$(echo "$Q0A" | grep -oE 'L[1-5]' | sort -u | tr '\n' '+' | sed 's/+$//' || true)
DECISION=$(echo "$Q0A" | grep -iE '新增|替换|扩展|复用' | head -1 || true)

# 检查声明的层和实际改动文件是否匹配（支持多层: L1+L2+L3）
declare -A LAYER_PATTERNS
LAYER_PATTERNS[L1]='^src/routes/|^src/tui/|^src/mcp/|^scripts/|^packages/|^electron-renderer/'
LAYER_PATTERNS[L2]='^src/agent/|^src/orchestrator/|^src/services/'
LAYER_PATTERNS[L3]='^src/l3/|^src/sentinel/|^src/expert-platform/'
LAYER_PATTERNS[L4]='^src/l4/|^extensions/ontology/|^extensions/sentinels/'
LAYER_PATTERNS[L5]='^src/store/|^src/cron/|^src/init/|^src/security/|^src/config/|^src/server\.ts|^src/providers/'

if [ -n "$LAYER" ]; then
  # 合并所有声明的层模式
  QRY=""
  for l in L1 L2 L3 L4 L5; do
    if echo "$LAYER" | grep -q "$l"; then
      QRY="${QRY}${LAYER_PATTERNS[$l]}|"
    fi
  done
  QRY="${QRY%|}"  # 去掉末尾的 |
  OUTSIDE=$(echo "$DIFF_ALL" | grep -vE "$QRY" | grep -vE '^\.claude/|^scripts/|^docs/|^tests/|\.md$|^tsconfig\.json|^\.github/|^package\.json|^package-lock\.json|^synova\.json|^vitest\.config' || true)
  if [ -n "$OUTSIDE" ]; then
    hard_check "声明 ${LAYER} 但改动了其他层" "$(echo "$OUTSIDE" | head -5)"
  else
    hard_check "层声明 ${LAYER} 与实际改动一致" ""
  fi
else
  warn_check "Q0a" "未声明架构层 (L1-L5)"
fi

# 检查新增/替换/扩展/复用声明
if echo "$DECISION" | grep -qi "复用"; then
  if [ -n "$NEW_TS" ]; then
    hard_check "声明复用但新增 .ts 文件" "$(echo "$NEW_TS" | head -3)"
  else
    hard_check "复用声明与代码一致" ""
  fi
elif echo "$DECISION" | grep -qi "新建"; then
  if [ -n "$NEW_JSON" ] || [ -n "$NEW_TS" ]; then
    hard_check "新建声明与代码一致" ""
  else
    warn_check "Q0a" "声明新建但无新增文件"
  fi
elif echo "$DECISION" | grep -qi "扩展"; then
  if [ -n "$MOD_FILES" ]; then
    hard_check "扩展声明与代码一致" ""
  else
    warn_check "Q0a" "声明扩展但无修改文件"
  fi
fi

# ═══════════════════════════════════════════════════════════════════
# Q0b: 文件审计
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}── Q0b: 文件审计 ──${RESET}"

Q0B=$(extract_section "Q0")
RELATION=$(echo "$Q0B" | grep -oiE '复用|扩展|新建|冲突' | head -1 || true)

if echo "$RELATION" | grep -qi "复用"; then
  if [ -n "$NEW_TS" ]; then
    hard_check "文件审计: 声明复用但新增 .ts" "$(echo "$NEW_TS" | head -3)"
  else
    hard_check "文件审计: 复用声明与代码一致" ""
  fi
elif echo "$RELATION" | grep -qi "冲突"; then
  if [ -n "$NEW_FILES" ]; then
    hard_check "文件审计: 声明冲突但新增文件" "$(echo "$NEW_FILES" | head -3)"
  else
    hard_check "文件审计: 冲突声明, 零新增文件, 正确" ""
  fi
elif echo "$RELATION" | grep -qi "扩展"; then
  hard_check "文件审计: 扩展声明" ""
fi

# 检查 brief 中列出的已有模块是否真实存在
LISTED_MODULES=$(echo "$Q0B" | grep -oE 'src/(expert|sentinel|knowledge|theory|skills)/[^[:space:]]+|extensions/[^[:space:]]+' | tr -d '`' | head -5 || true)
if [ -n "$LISTED_MODULES" ]; then
  MISSING=""
  while IFS= read -r mod; do
    [ -z "$mod" ] && continue
    # 只检查文件是否存在，不模糊匹配
    if [ -f "$ROOT/$mod" ] || [ -d "$ROOT/$mod" ] 2>/dev/null; then
      :  # exists
    else
      # 部分路径可能是目录模式，如 expert/*/SOUL.md
      LS_RESULT=$(ls "$ROOT/$mod" 2>/dev/null || true)
      if [ -z "$LS_RESULT" ]; then
        MISSING="${MISSING}  ${mod}\n"
      fi
    fi
  done <<< "$LISTED_MODULES"
  if [ -n "$MISSING" ]; then
    hard_check "文件审计: brief 声明的模块不存在" "$MISSING"
  else
    hard_check "文件审计: brief 声明的模块全部存在" ""
  fi
fi

# ═══════════════════════════════════════════════════════════════════
# Q1: 调研
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}── Q1: 调研 ──${RESET}"

Q1=$(extract_section "Q1")

# 检查是否引用 memory/ 文件
MEMORY_REFS=$(echo "$Q1" | grep -oE 'memory/[a-zA-Z0-9_-]+\.md' | sed 's|^memory/||' | sort -u || true)
if [ -n "$MEMORY_REFS" ]; then
  MISSING_MEM=""
  while IFS= read -r mem; do
    [ -z "$mem" ] && continue
    [ ! -f "$ROOT/memory/$mem" ] && MISSING_MEM="${MISSING_MEM}  memory/${mem}\n"
  done <<< "$MEMORY_REFS"
  if [ -n "$MISSING_MEM" ]; then
    hard_check "Q1: memory/ 引用不存在" "$MISSING_MEM"
  else
    hard_check "Q1: memory/ 引用的教训文件存在 ($(echo "$MEMORY_REFS" | wc -l) 个)" ""
  fi
else
  warn_check "Q1" "未引用任何 memory/ 教训文件"
fi

# 检查是否引用 Anthropic
if echo "$Q1" | grep -qi "Anthropic"; then
  hard_check "Q1b: Anthropic 决策引用" ""
else
  warn_check "Q1b" "未提及 Anthropic 决策链路"
fi

# ═══════════════════════════════════════════════════════════════════
# Q2: 范围
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}── Q2: 范围 ──${RESET}"

Q2=$(extract_section "Q2")

# 检查排除项 — 声明的"不做什么"中的路径是否被改动
EXCLUDED=$(echo "$Q2" | grep -oiE '(不做|排除|不涉及|不修改)[^。]*' | grep -oE 'src/[a-zA-Z0-9_/.]+' || true)
if [ -n "$EXCLUDED" ]; then
  VIOLATIONS=""
  while IFS= read -r excl; do
    [ -z "$excl" ] && continue
    if echo "$DIFF_ALL" | grep -qF "$excl" 2>/dev/null; then
      VIOLATIONS="${VIOLATIONS}  声明不修改但实际改动: ${excl}\n"
    fi
  done <<< "$EXCLUDED"
  hard_check "Q2: 排除项验证" "$VIOLATIONS"
else
  # 检查 brief 应该声明排除项
  if echo "$Q2" | grep -qiE '(不做|排除|不包括|不涉及)'; then
    hard_check "Q2: 有排除项声明" ""
  else
    warn_check "Q2" "未列出排除项（推荐明确本任务不做什么）"
  fi
fi

# ═══════════════════════════════════════════════════════════════════
# Q3: 验收
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}── Q3: 验收 ──${RESET}"

Q3=$(extract_section "Q3" 2>/dev/null || true)
DONE=$(extract_section "Done 标准" 2>/dev/null || true)

# 检查入口可触达 — 声明的入口文件/路由存在
ENTRIES=$(echo "$Q3" | grep -oE 'GET|POST|PUT|DELETE' | head -1 || true)
ENTRY_FILES=$(echo "$Q3" | grep -oE 'src/[a-zA-Z0-9_/.]+\.(ts|html)' | tr -d '`' || true)
if [ -n "$ENTRY_FILES" ]; then
  MISSING_ENTRY=""
  while IFS= read -r ef; do
    [ -z "$ef" ] && continue
    [ ! -f "$ROOT/$ef" ] && MISSING_ENTRY="${MISSING_ENTRY}  入口文件不存在: ${ef}\n"
  done <<< "$ENTRY_FILES"
  hard_check "Q3: 入口文件存在" "$MISSING_ENTRY"
else
  warn_check "Q3" "未声明入口文件路径"
fi

# 检查 Done 标准中的 verify 命令
VERIFY_CMDS=$(echo "$DONE" | grep -oE 'grep[[:space:]]+.*[^[:space:]]+|bash[[:space:]]+.*[^[:space:]]+|npx[[:space:]]+.*[^[:space:]]+' || true)
if [ -n "$VERIFY_CMDS" ]; then
  hard_check "Q3/Done: 有可验证的验收命令" ""
else
  warn_check "Q3/Done" "未列出可执行的 verify 命令"
fi

# 检查 Done 标准为 - [x] 的项数
DONE_CHECKED=$(echo "$DONE" | grep -cE '^\s*- \[x\]' || true)
if [ "$DONE_CHECKED" -ge 1 ]; then
  hard_check "Q3/Done: ${DONE_CHECKED} 项完成标准" ""
else
  warn_check "Q3/Done" "无已标记完成的标准"
fi

# ═══════════════════════════════════════════════════════════════════
# 结果
# ═══════════════════════════════════════════════════════════════════
echo ""
if [ "$HARD_FAIL" -gt 0 ]; then
  echo -e "  ${RED}❌ ${HARD_FAIL} 项不一致 — Brief 与代码不匹配${RESET}"
  echo "  请修正 brief 或代码后重新提交。"
  exit 1
else
  echo -e "  ${GREEN}✅ Brief 与代码一致${RESET}"
  exit 0
fi
