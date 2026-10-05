#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# verify-incremental.sh — PostToolUse 分层增量验证 (Loop Engineering V4.5.1)
#
# L1: oxlint 语法检查 (< 1s, 改动文件)
# L2: tsc --noEmit --incremental (利用 .tsbuildinfo 缓存, 5-15s)
# L3: vitest run --changed (仅匹配的测试文件, 5-30s)
# L4: 接线审计 + 暗默失败 + 架构边界
#
# exit 0 = 全部通过 (清除循环计数)
# exit 1 = 验证失败 (AI 在同一会话内看到输出并修正)
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# D314: PostToolUse 触发时只对 src/ 代码文件全量验证（.codex/tmp 等测试/配置写入跳过）
# 从 stdin 读 tool_input.file_path（hook JSON；无 stdin 时保持原行为）
TARGET_FILE=""
if [ -n "${FILE_PATH:-}" ]; then
  TARGET_FILE="$FILE_PATH"
elif [ -n "${1:-}" ] && ! echo "$1" | grep -q '^{'; then
  TARGET_FILE="$1"
else
  # 无 FILE_PATH/$1 → 尝试 stdin JSON（hook 环境有）；无 stdin 时用 timeout 防阻塞
  TARGET_FILE=$(timeout 1 cat 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    ti = data.get('tool_input', data)
    print(ti.get('file_path', '') if isinstance(ti, dict) else '')
except Exception:
    print('')
" 2>/dev/null || echo "")
fi
if [ -n "$TARGET_FILE" ]; then
  case "$TARGET_FILE" in
    src/*|packages/*) : ;;  # 代码文件 → 全量验证
    *) echo "[VERIFY] 非代码文件变更 — 跳过全量验证 (D314)"; exit 0 ;;
  esac
fi

# D314: 无实际 src/ 变更 → 直接跳过（测试/配置写入触发 hook 时零成本）
if ! git diff --name-only 2>/dev/null | grep -qE '^src/.*\.ts$|^packages/.*\.ts$'; then
  echo "[VERIFY] 无 src/ 代码变更 — 跳过全量验证 (D314)"
  exit 0
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'

# ═══ 1. 循环计数 ═══
STATE_FILE="$ROOT/.claude/loop-state.json"
MAX=5
if [ -f "$STATE_FILE" ]; then
  ITER=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('iteration',0))" 2>/dev/null || echo 0)
  ITER=$((ITER + 1))
else
  ITER=1
fi

if [ "$ITER" -gt "$MAX" ]; then
  echo -e "${RED}[LOOP] 已达最大循环次数 $MAX，停止自动修正。请人工介入。${RESET}"
  rm -f "$STATE_FILE"
  exit 0
fi

python3 -c "
import json
json.dump({'iteration': $ITER, 'maxIterations': $MAX, 'lastRun': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'}, open('$STATE_FILE', 'w'))
" 2>/dev/null

echo -e "${CYAN}[VERIFY $ITER/$MAX] 分层增量验证开始...${RESET}"
CHANGED_SRC=$(git diff --name-only 2>/dev/null | grep '\.ts$' | grep -v '\.test\.' | grep -v '\.d\.ts' || true)
ALL_CHANGED=$(git diff --name-only 2>/dev/null || true)
TOTAL_LINES_CHANGED=$(git diff 2>/dev/null | grep '^[+-]' | grep -v '^[+-]\{3\}' | wc -l | tr -d ' ')

# ═══ v3.3: 轻量变更通道 ═══
# 满足任一条件走轻量: (1)仅非TS文件 (2)改动≤5行
IS_LIGHT=0
if [ -z "$CHANGED_SRC" ]; then
  IS_LIGHT=1
elif [ "${TOTAL_LINES_CHANGED:-0}" -le 5 ]; then
  IS_LIGHT=1
fi

if [ "$IS_LIGHT" -eq 1 ]; then
  echo -e "${YELLOW}[LIGHT] 轻量变更通道 (仅Markdown/HTML/JSON 或 ≤5行改动)${RESET}"
  echo -e "${YELLOW}  跳过: tsc --noEmit + vitest run${RESET}"
  echo -e "${YELLOW}  保留: oxlint + secrets扫描${RESET}"
  # 只跑 L1+L4 (oxlint + 接线审计)
  [ -n "$CHANGED_SRC" ] && npx oxlint $(echo "$CHANGED_SRC" | tr '\n' ' ') --silent 2>&1 || true
  # L4 接线审计仍然执行
  # 全部通过 → 清除循环状态
  rm -f "$STATE_FILE"
  echo -e "${GREEN}[PASS] 轻量验证通过${RESET}"
  exit 0
fi

# ═══ L1: oxlint 语法检查 (< 1s) ═══
if [ -n "$CHANGED_SRC" ]; then
  echo -e "${CYAN}[L1] oxlint 语法检查...${RESET}"
  OXLINT_AVAILABLE=$(which oxlint 2>/dev/null || echo "")
  if [ -n "$OXLINT_AVAILABLE" ]; then
    OXLINT_FILES=$(echo "$CHANGED_SRC" | tr '\n' ' ')
    if npx oxlint $OXLINT_FILES --silent 2>&1; then
      echo -e "${GREEN}  L1 语法: 通过${RESET}"
    else
      echo -e "${RED}[FAIL] L1 语法检查失败 — 请修正语法错误${RESET}"
      exit 1
    fi
  else
    echo -e "${YELLOW}  L1 语法: oxlint 未安装, 跳过 (建议: npm install -D oxlint)${RESET}"
  fi
else
  echo -e "${CYAN}[L1] 无 .ts 文件改动, 跳过语法检查${RESET}"
fi

# ═══ L2: tsc --noEmit --incremental (利用 .tsbuildinfo 缓存) ═══
if [ -n "$CHANGED_SRC" ]; then
  echo -e "${CYAN}[L2] tsc 类型检查 (incremental)...${RESET}"
  # 使用 --incremental 利用 .tsbuildinfo 缓存, 只检查改动文件
  L2_OUT=$(bash "$ROOT/scripts/control-tower/baseline-check.sh" --tsc 2>&1) || true
  echo "$L2_OUT" | grep -E "存量|新增|degraded|✅|❌" | head -5
  if echo "$L2_OUT" | grep -qE "新增 [1-9]"; then
    echo -e "${RED}[FAIL] L2 类型检查: 存在新增 tsc 错误 (存量豁免, 新增阻断)${RESET}"
    exit 1
  fi
  echo -e "${GREEN}  L2 类型: 通过${RESET}"
else
  echo -e "${CYAN}[L2] 无 .ts 文件改动, 跳过类型检查${RESET}"
fi

# ═══ L3: vitest run --changed (增量测试) ═══
if [ -n "$CHANGED_SRC" ]; then
  # 映射 src/xxx.ts → tests/xxx.test.ts
  TEST_FILES=""
  while IFS= read -r src; do
    [ -z "$src" ] && continue
    test_file=$(echo "$src" | sed 's|^src/|tests/|; s|\.ts$|.test.ts|')
    if [ -f "$test_file" ]; then
      TEST_FILES="$TEST_FILES $test_file"
    fi
  done <<< "$CHANGED_SRC"

  if [ -n "$TEST_FILES" ]; then
    echo -e "${CYAN}[L3] vitest ($(echo $TEST_FILES | wc -w) test files)...${RESET}"
    if npx vitest run $TEST_FILES 2>&1; then
      echo -e "${GREEN}  L3 测试: 通过${RESET}"
    else
      echo -e "${RED}[FAIL] L3 测试失败 — 请修正后重新保存文件${RESET}"
      exit 1
    fi
  else
    echo -e "${CYAN}[L3] 无对应测试文件, 跳过${RESET}"
  fi
else
  echo -e "${CYAN}[L3] 无 .ts 文件改动, 跳过测试${RESET}"
fi

# ═══ L4: 综合门禁 (接线 + 架构 + 暗默失败 + 用户可见) ═══
echo -e "${CYAN}[L4] 综合门禁...${RESET}"

# L4a. 接线审计 (新文件 export 验证)
NEW_FILES=$(git diff --cached --name-only --diff-filter=A 2>/dev/null | grep '^src/.*\.ts$' | grep -v '\.test\.' | grep -v '\.d\.ts' || true)
if [ -n "$NEW_FILES" ]; then
  UNWIRED=""
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    EXPORTS=$(grep -oE 'export (function|class|const) [a-zA-Z0-9_]+' "$file" 2>/dev/null | awk '{print $NF}' || true)
    for name in $EXPORTS; do
      [ -z "$name" ] && continue
      if echo "$name" | grep -qi 'mock\|fake\|_internal\|_deprecated'; then continue; fi
      WIRED=$(grep -rn "\b${name}\b" src/server.ts src/index.ts src/cli.ts src/agent/ src/routes/ src/sentinel/builtins.ts --include="*.ts" 2>/dev/null | grep -v "export.*${name}" | grep -v "import.*${name}" | grep -v "$file" | head -1 || true)
      if [ -z "$WIRED" ]; then
        UNWIRED="${UNWIRED}  ${file}: export ${name} — 未在生产入口中接线\n"
      fi
    done
  done <<< "$NEW_FILES"
  if [ -n "$UNWIRED" ]; then
    echo -e "${RED}[FAIL] 接线审计失败:${RESET}"
    echo -e "$UNWIRED"
    echo "请在入口文件 (server.ts/routes/agent/) 中 import 并调用。"
    exit 1
  fi
fi

# L4b. 增量架构边界 (跨层引用)
# (D962-B2: 原 check-boundaries-incremental.sh 唯一调用方在此内联，脚本退役——搬家≠减负，
#  判定逻辑逐字迁入，行为等价)
CHANGED_SRC2=$(git diff --name-only 2>/dev/null | grep '^src/.*\.ts$' | grep -v '\.test\.' | grep -v '\.d\.ts' || true)
BOUNDARY_VIOLATIONS=0
while IFS= read -r _bfile; do
  [ -z "$_bfile" ] && continue
  [ ! -f "$_bfile" ] && continue
  _bimports=$(grep "^import\|from" "$_bfile" 2>/dev/null | grep -v "import type" || true)  # swallow-ok: 非文本/已删文件跳过
  [ -z "$_bimports" ] && continue
  case "$_bfile" in
    src/routes/*|src/tui/*|src/l1*/*)
      if echo "$_bimports" | grep -qE "from '\.\./(l3|l4|l5)/|from '\.\./store/|from '\.\./sentinel/" 2>/dev/null; then
        echo -e "${RED}[L1→L3/L4/L5] $_bfile 跨层引用:${RESET}"
        echo "  $(echo "$_bimports" | grep -E "from '\.\./(l3|l4|l5)/|from '\.\./store/|from '\.\./sentinel/")"
        BOUNDARY_VIOLATIONS=$((BOUNDARY_VIOLATIONS + 1))
      fi
      ;;
    src/agent/*|src/orchestrator/*|src/l2*/*)
      if echo "$_bfile" | grep -qE "bridge-service|knowledge-bridge|review-service|sentinel-health-service|sentinel-service"; then
        continue
      fi
      if echo "$_bimports" | grep -qE "from '\.\./(l4|l5)/|from '\.\./store/" 2>/dev/null; then
        echo -e "${RED}[L2→L4/L5] $_bfile 跨层引用:${RESET}"
        echo "  $(echo "$_bimports" | grep -E "from '\.\./(l4|l5)/|from '\.\./store/")"
        BOUNDARY_VIOLATIONS=$((BOUNDARY_VIOLATIONS + 1))
      fi
      ;;
    src/l3/*|src/sentinel/*)
      if echo "$_bimports" | grep -qE "from '\.\./routes/|from '\.\./store/" 2>/dev/null; then
        echo -e "${RED}[L3→L1/L5] $_bfile 跨层引用:${RESET}"
        echo "  $(echo "$_bimports" | grep -E "from '\.\./routes/|from '\.\./store/")"
        BOUNDARY_VIOLATIONS=$((BOUNDARY_VIOLATIONS + 1))
      fi
      ;;
  esac
done <<< "$CHANGED_SRC2"
if [ "$BOUNDARY_VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "发现 ${BOUNDARY_VIOLATIONS} 处跨层引用。请重构为 L2 桥接服务。"
  echo -e "${RED}[FAIL] 架构边界违规 — 请重构为 L2 桥接服务${RESET}"
  exit 1
fi

# L4c. 暗默失败检查 (新增 catch 无 log)
TS_DIFF=$(git diff -- '*.ts' '*.tsx' 2>/dev/null || true)
if [ -n "$TS_DIFF" ]; then
  NEW_CATCHES=$(echo "$TS_DIFF" | grep "^\+.*catch\s*(" 2>/dev/null || true)
  NEW_CATCHES=$(echo "$NEW_CATCHES" | grep -v "catch.*log\.\|catch.*logger\|catch.*//.*log\|catch.*/\*.*log\|catch.*throw\|catch.*degraded" || true)
  if [ -n "$NEW_CATCHES" ]; then
    SILENT=""
    while IFS= read -r catch_line; do
      [ -z "$catch_line" ] && continue
      AFTER=$(echo "$TS_DIFF" | grep -A3 "$catch_line" | tail -3)
      if ! echo "$AFTER" | grep -qE "log\.|logger\.|console\.|throw |return.*degraded"; then
        SILENT="${SILENT}  ${catch_line}\n"
      fi
    done <<< "$NEW_CATCHES"
    if [ -n "$SILENT" ]; then
      echo -e "${RED}[FAIL] 暗默失败: 新增 catch 无 log:${RESET}"
      echo -e "$SILENT"
      echo "请在 catch 块中添加 log.warn/log.error"
      exit 1
    fi
  fi
fi

# L4d. 用户可见缺口检查 (新增 export 无对应 API 变更)
NEW_EXPORTS_ALL=$(git diff --name-only 2>/dev/null | grep '^src/.*\.ts$' | grep -v '\.test\.' | grep -v '\.d\.ts' || true)
ROUTE_CHANGED=$(git diff --name-only 2>/dev/null | grep '^src/routes/' || true)
if [ -n "$NEW_EXPORTS_ALL" ] && [ -z "$ROUTE_CHANGED" ]; then
  # 有 src 文件改动但没有 route 文件改动 → 可能遗漏用户入口
  NEW_FUNCS=$(git diff 2>/dev/null | grep "^\+export \(function\|class\|const\)" | grep -oE 'export (function|class|const) [a-zA-Z0-9_]+' | awk '{print $NF}' || true)
  if [ -n "$NEW_FUNCS" ]; then
    echo -e "${CYAN}[VERIFY $ITER/$MAX] 用户可见缺口...${RESET}"
    # 检查这些新函数是否被现有路由引用
    GAP=""
    for func in $NEW_FUNCS; do
      if ! grep -rn "\b${func}\b" src/routes/ --include="*.ts" 2>/dev/null | grep -qv "import.*${func}"; then
        GAP="${GAP}  export ${func} — 未在 src/routes/ 中发现引用\n"
      fi
    done
    if [ -n "$GAP" ]; then
      echo -e "${YELLOW}[WARN] 可能缺少用户入口:${RESET}"
      echo -e "$GAP"
      echo -e "${YELLOW}  新增了导出但未更新 API 路由。如果这是内部函数请忽略。${RESET}"
      # 不阻断，仅警告
    fi
  fi
fi

# ═══ 全部通过 → 清除循环状态 ═══
rm -f "$STATE_FILE"
echo -e "${GREEN}[PASS] 增量验证全部通过 — 循环计数已重置${RESET}"
echo ""
echo "如果修改了接口签名，请更新 task brief 的接口审计字段。"
exit 0
