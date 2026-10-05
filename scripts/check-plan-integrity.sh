#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Loop Engineering V4.5.1 — check-plan-integrity.sh
# 统一验证 plan.json 的 Q1/Q2 产出格式。不执行 verify 命令（V4.5.1 移除执行）。
# pre-commit 组 6 调用。全部 <1s。
#
# Anthropic 原则 5: 物理强制，零 AI 自律。
# Anthropic 原则 1: 一个机制防一类错 — 这个脚本验证整个 Q1/Q2 承诺链。
# ═══════════════════════════════════════════════════════════════════════════════
set +e

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
HARD_FAIL=0

# ═══ --brief <path> 模式（D962-B 第二批: check-brief-parseable.sh 加严并入退役——非逐字）═══
# D313 M3 brief 契约检查: ①Q2 可解析 ②#CRITERIA A-D ③架构层 ④Done≥1 ⑤模板同源自检。
# 与旧宿主差异（V 自验 轻2 勘误）: 本版加严——#CRITERIA 必填判据、Q2 路径条目 ≥1 为
# 硬失败项（旧版为模板自检附带的软口径差异）；架构层判据同源（有值即过）。
# 三态: 0 过 / 1 失败（点名缺失项）/ brief 不存在或 python 不可用 → 0 + degraded 登记（fail-open 可见）。
if [ "${1:-}" = "--brief" ]; then
  PARSER="$ROOT/scripts/control-tower/brief_parser.py"
  DEGRADED_LOG="$ROOT/.codex/control-tower/logs/degraded-events.log"
  PYBIN=""
  for _c in python3 python py; do
    if command -v "$_c" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
  done
  if [ -z "$PYBIN" ]; then
    mkdir -p "$(dirname "$DEGRADED_LOG")"
    echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"brief-parseable\", \"reason\": \"python 不可用 — 跳过 (fail-open)\"}" >> "$DEGRADED_LOG" 2>/dev/null || true
    echo "[brief-parseable] ⚠️  python 不可用 — 跳过 (fail-open)"; exit 0
  fi
  BRIEF="${2:-}"
  if [ -z "$BRIEF" ]; then
    BRIEF=$(bash "$ROOT/scripts/workflow/resolve-commit-brief.sh" "" 2>/dev/null | head -1 || true)
  fi
  if [ -z "$BRIEF" ] || [ ! -f "$BRIEF" ]; then
    mkdir -p "$(dirname "$DEGRADED_LOG")"
    echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"brief-parseable\", \"reason\": \"brief 不存在: ${BRIEF:-none}\"}" >> "$DEGRADED_LOG" 2>/dev/null || true
    echo "[brief-parseable] ⚠️  brief 不存在 — 跳过 (fail-open)"; exit 0
  fi
  FAILURES=""
  Q2_OUT=$("$PYBIN" "$PARSER" --all "$BRIEF" 2>/dev/null || echo '{"parseable": false}')
  if echo "$Q2_OUT" | grep -q '"parseable": false'; then
    FAILURES="  Q2 不可解析（brief_parser 失败）\n"
  else
    _INC=$(echo "$Q2_OUT" | "$PYBIN" -c "import json,sys; print(len(json.load(sys.stdin).get('q2_include', [])))" 2>/dev/null || echo 0)
    [ "${_INC:-0}" -eq 0 ] && FAILURES="${FAILURES}  Q2 做什么 无路径条目（至少 1 条）\n"
  fi
  CRITERIA=$(echo "$Q2_OUT" | "$PYBIN" -c "import json,sys; print(json.load(sys.stdin).get('criteria') or '')" 2>/dev/null || echo "")
  [ -z "$CRITERIA" ] && FAILURES="${FAILURES}  #CRITERIA 缺失（必填 A-D）\n"
  LAYER=$(echo "$Q2_OUT" | "$PYBIN" -c "import json,sys; print(json.load(sys.stdin).get('layer') or '')" 2>/dev/null || echo "")
  [ -z "$LAYER" ] && FAILURES="${FAILURES}  架构层未标注（当前: 空）\n"
  DONE_N=$(echo "$Q2_OUT" | "$PYBIN" -c "import json,sys; print(json.load(sys.stdin).get('done_count', 0))" 2>/dev/null || echo 0)
  [ "${DONE_N:-0}" -eq 0 ] && FAILURES="${FAILURES}  Done 标准无条目（至少 1 条）\n"
  TMP_BRIEF="$ROOT/.codex/control-tower/tmp/bp-template-check.md"
  if BRIEF_FILE="$TMP_BRIEF" TASK_DESC="self-check" "$PYBIN" "$ROOT/scripts/workflow/generate-task-brief.py" > /dev/null 2>&1; then
    TMP_OUT=$("$PYBIN" "$PARSER" --all "$TMP_BRIEF" 2>/dev/null || echo '{"parseable": false}')
    echo "$TMP_OUT" | grep -q '"parseable": false' && FAILURES="${FAILURES}  模板输出不可被同源解析器解析（模板-解析器漂移）\n"
    rm -f "$TMP_BRIEF"
  fi
  if [ -n "$FAILURES" ]; then
    echo "[brief-parseable] ❌ brief 不可解析: $BRIEF"; echo -e "$FAILURES"; exit 1
  fi
  echo "[brief-parseable] ✅ brief 可解析: $BRIEF (Q2 ✓ #CRITERIA=$CRITERIA 架构层=$LAYER Done=$DONE_N)"; exit 0
fi

PLAN_FILE="$ROOT/.claude/plan.json"
TODAY=$(date +%Y-%m-%d)
# D296 认领制: 多 session 并发时用认领本提交文件的 brief (跨 session 污染根治)
BRIEF=$(bash "$ROOT/scripts/workflow/resolve-commit-brief.sh" "$(git diff --cached --name-only 2>/dev/null || true)" 2>/dev/null || true)

if [ ! -f "$PLAN_FILE" ]; then
  echo -e "  ${GREEN}✅ plan-integrity (无 plan.json)${RESET}"
  exit 0
fi

# ═══ 1. principles 非空 — Q1b 是否回答了 ═══
PRINCIPLES=$(python3 -c "
import json
p = json.load(open('$PLAN_FILE', encoding='utf-8'))
principles = p.get('principles', [])
print(len(principles))
for pp in principles: print(pp)
" 2>/dev/null)
PRIN_COUNT=$(echo "$PRINCIPLES" | head -1 | tr -d '[:space:]' | grep -o '[0-9]\+' | tr -d '\n\r' || echo 0)
if [ "${PRIN_COUNT:-0}" -eq 0 ]; then
  echo -e "  ${RED}❌ plan.principles 为空 — Q1b 未回答 Anthropic 决策链路  [硬阻断]${RESET}"
  HARD_FAIL=$((HARD_FAIL + 1))
else
  # 检查每条原则是否对应至少一个 Done verify 命令
  if [ -n "$BRIEF" ]; then
    DONE_CMDS=$(grep -c 'verify:' "$BRIEF" 2>/dev/null | tr -d '\n\r' || echo 0)
    if [ "${DONE_CMDS:-0}" -lt "${PRIN_COUNT:-1}" ]; then
      echo -e "  ${YELLOW}⚠️  plan.principles 有 ${PRIN_COUNT} 条，但 Done 仅有 ${DONE_CMDS} 个 verify  [警告]${RESET}"
      echo "     每条原则应对应至少一个可验证的 Done 标准。"
    else
      echo -e "  ${GREEN}✅ plan.principles (${PRIN_COUNT} 条, Done verify: ${DONE_CMDS})${RESET}"
    fi
  else
    echo -e "  ${GREEN}✅ plan.principles (${PRIN_COUNT} 条)${RESET}"
  fi
fi

# ═══ 2. approach = rewrite/reuse — Q2 是否回答了 ═══
APPROACH=$(python3 -c "import json; print(json.load(open('$PLAN_FILE', encoding='utf-8')).get('approach',''))" 2>/dev/null) # swallow-ok: plan.json 解析失败降级为空，调用方判断 approach
if [ -z "$APPROACH" ] || [ "$APPROACH" = "None" ]; then
  echo -e "  ${RED}❌ plan.approach 为空 — Q2 未回答重写还是复用  [硬阻断]${RESET}"
  HARD_FAIL=$((HARD_FAIL + 1))
elif [ "$APPROACH" = "rewrite" ]; then
  # 选了 rewrite → 检查是否仍有新 engine-core import
  NEW_ENGINE_CORE=$(git diff --cached 2>/dev/null | grep "^+.*import.*engine-core" | grep -E "^src/.*\.ts:|^src/.*\.js:" | grep -v "\.test\." | head -3 || true)
  if [ -n "$NEW_ENGINE_CORE" ]; then
    echo -e "  ${RED}❌ approach=rewrite 但代码中有新 engine-core import — 铁律 46  [硬阻断]${RESET}"
    echo "$NEW_ENGINE_CORE"
    HARD_FAIL=$((HARD_FAIL + 1))
  else
    echo -e "  ${GREEN}✅ plan.approach = rewrite (无新 engine-core import)${RESET}"
  fi
else
  echo -e "  ${GREEN}✅ plan.approach = ${APPROACH}${RESET}"
fi

# ═══ 3. memory_refs 的每个文件存在 — Q1a 是否真实 ═══
MEMORY_REFS=$(python3 -c "
import json, os
p = json.load(open('$PLAN_FILE', encoding='utf-8'))
refs = p.get('memory_refs', [])
for r in refs:
  path = os.path.join('$ROOT', r)
  print(f'{r}:{\"OK\" if os.path.exists(path) else \"MISSING\"}')
" 2>/dev/null)
MISSING_REFS=$(echo "$MEMORY_REFS" | grep "MISSING" || true)
if [ -n "$MISSING_REFS" ]; then
  echo -e "  ${RED}❌ plan.memory_refs 引用不存在的文件  [硬阻断]${RESET}"
  echo "$MISSING_REFS"
  HARD_FAIL=$((HARD_FAIL + 1))
elif [ -n "$MEMORY_REFS" ]; then
  COUNT=$(echo "$MEMORY_REFS" | grep -c .)
  echo -e "  ${GREEN}✅ plan.memory_refs (${COUNT} 文件, 全部存在)${RESET}"
else
  echo -e "  ${YELLOW}⚠️  plan.memory_refs 为空 — Q1a 未引用 memory/ 文件  [警告]${RESET}"
fi

# ═══ 4. 模板残留检查 — brief 是否认真填了 ═══
if [ -n "$BRIEF" ] && [ -f "$BRIEF" ]; then
  # #CRITERIA 注释行是必填产物（pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费），非模板残留 — 排除后再计数
  TEMPLATE_RESIDUE=$(grep '<!--' "$BRIEF" 2>/dev/null | grep -vc '#CRITERIA' | tr -d '\r\n' || echo 0)
  TEMPLATE_RESIDUE=${TEMPLATE_RESIDUE//[!0-9]/}
  if [ "${TEMPLATE_RESIDUE:-0}" -gt 0 ]; then
    echo -e "  ${RED}❌ brief 模板残留: 发现 ${TEMPLATE_RESIDUE} 处未填注释 (<!--)  [硬阻断]${RESET}"
    HARD_FAIL=$((HARD_FAIL + 1))
  else
    echo -e "  ${GREEN}✅ brief 模板已清理 (无 <!-- 残留)${RESET}"
  fi
fi

# ═══ 5. Q2 排除项必须含文件路径 ═══
if [ -n "$BRIEF" ] && [ -f "$BRIEF" ]; then
  # D515 项5: 带行号提取 — 报错附违规排除项原文 + brief 内行号 + 修复示例（Codex P6）
  Q2_SEC=$(awk '/^## Q2:/{found=1; next} /^## /{if(found) exit} found {print NR "|" $0}' "$BRIEF" 2>/dev/null)  # swallow-ok: brief 缺失/读失败 → Q2_SEC 空 → 跳过本节
  if [ -n "$Q2_SEC" ]; then
    EXCLUDED=$(echo "$Q2_SEC" | grep -E '(不改|不修改|不动)' || true)
    if [ -n "$EXCLUDED" ]; then
      BAD=""
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        QLN="${line%%|*}"   # 注意不可命名 LINENO——bash 保留变量会自动覆写
        TEXT="${line#*|}"
        # 排除项必须包含文件扩展名（.ts/.sh/.json/.py/.md/.yaml）或完整路径（/ 兼容目录路径）
        TOKEN=$(echo "$TEXT" | grep -oiE '(不改|不修改|不动)[[:space:]]+[^ ，,;；、]+' | sed -E 's/^[^[:space:]]+[[:space:]]+//' | head -1 || true)
        if [ -n "$TOKEN" ] && ! echo "$TOKEN" | grep -qiE '(\.ts|\.sh|\.json|\.py|\.md|\.yaml|/)' 2>/dev/null; then
          BAD="${BAD}  brief 第 ${QLN} 行: ${TEXT}\n     修复示例: - 不改 src/xxx/yyy.ts — 原因\n"
        fi
      done <<< "$EXCLUDED"
      if [ -n "$BAD" ]; then
        echo -e "  ${RED}❌ Q2 排除项缺少文件路径: 必须引用具体文件名 (如 sentinel-loader.ts)  [硬阻断]${RESET}"
        echo -e "$BAD"
        HARD_FAIL=$((HARD_FAIL + 1))
      else
        echo -e "  ${GREEN}✅ Q2 排除项均含文件路径${RESET}"
      fi
    fi
  fi
fi

# ═══ 6. Q2 排除项 —「不改 X」git diff 验证 ═══
if [ -n "$BRIEF" ] && [ -f "$BRIEF" ]; then
  Q2_SEC=$(awk '/^## Q2:/{found=1; next} /^## /{if(found) exit} found' "$BRIEF" 2>/dev/null)
  if [ -n "$Q2_SEC" ]; then
    EXCLUDED_FILES=$(echo "$Q2_SEC" | grep -oiE '(不改|不修改|不动)\s+\S+' | sed 's/^[^ ]* //' | tr -d '[:space:]' | grep -v "^$" || true)
    if [ -n "$EXCLUDED_FILES" ]; then
      STAGED=$(git diff --cached --name-only 2>/dev/null || true)
      VIOLATIONS=""
      while IFS= read -r excl; do
        [ -z "$excl" ] && continue
        if echo "$STAGED" | grep -qiE "(^|/)${excl}(/|$)" 2>/dev/null; then
          VIOLATIONS="${VIOLATIONS}  Q2 排除项 '${excl}' 在本次提交中被修改\n"
        fi
      done <<< "$EXCLUDED_FILES"
      if [ -n "$VIOLATIONS" ]; then
        echo -e "  ${RED}❌ Q2 排除项验证: 声明不改的文件被修改了  [硬阻断]${RESET}"
        echo -e "$VIOLATIONS"
        HARD_FAIL=$((HARD_FAIL + 1))
      else
        echo -e "  ${GREEN}✅ Q2 排除项: 声明不改的文件未在本次提交中出现${RESET}"
      fi
    fi
  fi
fi

# ═══ 7. Done verify 格式检查（V4.5.1: 仅检查存在性，不执行命令）═══
if [ -n "$BRIEF" ] && [ -f "$BRIEF" ]; then
  DONE_SEC=$(awk '/^## Done 标准/{found=1; next} found && /^## /{exit} found' "$BRIEF" 2>/dev/null)
  VERIFY_COUNT=$(echo "$DONE_SEC" | grep -cE '^\s*- \[x\].*verify:|^\s+verify:' 2>/dev/null | tr -d '\n\r' || echo 0)
  if [ "${VERIFY_COUNT:-0}" -gt 0 ]; then
    echo -e "  ${GREEN}✅ Done verify 格式: ${VERIFY_COUNT} 条已列出${RESET}"
  fi
fi

if [ "$HARD_FAIL" -gt 0 ]; then
  echo ""
  echo -e "  ${RED}plan-integrity: ${HARD_FAIL} items failed - commit rejected${RESET}"
  exit 1
fi
exit 0
