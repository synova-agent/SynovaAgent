#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# 铁律 39: 五层架构边界检查 (CT-64 修补: 四类漏网形态根除)
# 检测跨层 import 违规 + 多租户安全
#
# 契约(铁律 47):
#   @input  扫描源 SYNO_ARCH_SRC (默认 src/)；存量基线 SYNO_ARCH_BASELINE
#           (默认 tests/architecture/l1-cross-layer-baseline.txt)；SYNO_CI=1 进入 CI strict。
#   @output 按方向(L1→L3/L1→L4/L1→L5)逐行打印违规 file:line:内容；
#           基线内存量只提示不阻断(棘轮)；基线外新增: 本地 ⚠ exit 0 / SYNO_CI=1 ❌ exit 1。
#   @exit   0 = 通过(含棘轮内存量)；1 = 基线外新增违规且 CI strict；
#           2 = 检查自身失败(fail-closed——扫描源缺失，绝不与通过混同)。
#   @degraded 无——门禁不允许降级放行(根除 M1 fail-open: 目录缺失显式可见)。
#
# CT-64 四类漏网修补 (2026-09-08, docs/synova/research/L1跨层违规扫描-20260908.md):
#   ① 动态 import 逃逸 → 匹配锚定 import 语法结构: from '...' / import('...') / require('...')，
#      不再依赖 from 关键词(修补前 42 处动态 runtime 全部不可见)
#   ② 名字豁免恰中违规 → 删除 agent-observer|ga-annotations 整行 grep -v(两文件恰是违规
#      重灾区)；真豁免改为行内标注 // arch-allow(层): 理由，豁免行仍列出(K3 可审计)
#   ③ 路径形态不匹配 → 精确层模式补全 expert-platform / store / cron / l5 /
#      init/engine-context / adapters/sqlite-graph-store / graph-bridge；
#      扫描范围扩到 L1 全文件集(routes/tui-v2/tui-v3/mcp/cli/l1/l1-interaction + 根文件，附录 A)
#   ④ soft 不转硬 + fail-open → SYNO_CI=1 转硬(D515/D516 先例) + 扫描源缺失 exit 2
#
# 治理语义(台账 CT-64): 先修脚本可见性 → 分批修 src/ 六簇(扫描报告 §三)——
# 存量 68 处登记于基线文件(只减不增)，避免一次性全红压垮编码线。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
FAIL=0
SYNO_CI="${SYNO_CI:-0}"
SYNO_ARCH_SRC="${SYNO_ARCH_SRC:-src}"
SYNO_ARCH_BASELINE="${SYNO_ARCH_BASELINE:-tests/architecture/l1-cross-layer-baseline.txt}"

echo ""
echo "═══ 架构边界检查 (铁律 39) ═══"
echo ""

# ═══ 1. L2→L4 跨层引用 ═══
# L2 (agent/, orchestrator/) 不得直接 import L4 (l4/)
# 例外: ConversationEngine + engine-context 是设计的 L2↔L4 桥接层
#       diagnosis-launcher 通过 engine-context 访问 L4 (DI 注入, 非直接依赖)
L2_L4=$(grep -rn "from.*l4/" src/agent/ src/orchestrator/ --include="*.ts" 2>/dev/null \
  | grep -v "node_modules" | grep -v "\.test\." \
  | grep -v "conversation-engine.ts\|engine-context.ts\|diagnosis-launcher.ts\|knowledge-bridge-service.ts\|review-service.ts\|sentinel-health-service.ts\|workspace-context-bridge.ts\|data-ingest-service.ts" \
  || true)
L2_L4_COUNT=$(echo "$L2_L4" | grep -c . 2>/dev/null | tr -d '\n\r') || L2_L4_COUNT=0
[ -z "$L2_L4_COUNT" ] && L2_L4_COUNT=0

if [ "$L2_L4_COUNT" -gt 0 ]; then
  echo -e "  ${RED}❌ L2→L4 跨层引用: ${L2_L4_COUNT} 处${RESET}"
  echo "$L2_L4" | while read -r line; do echo "     ${line}"; done
  echo "     铁律 39: L2 只能通过 L3 访问 L4。当前例外需标注原因。"
  FAIL=$((FAIL + 1))
else
  echo -e "  ${GREEN}✅ L2→L4 边界: 无直接引用${RESET}"
fi

# ═══ 1b/1c/1d. L1 跨层引用 (CT-64 重写: L1 全文件集 × 全 import 形态 × 精确层模式) ═══
# fail-closed: 扫描源缺失 = 检查自身失败 = exit 2 (绝不假绿)
if [ ! -d "$SYNO_ARCH_SRC" ]; then
  echo -e "  ${RED}❌ 检查自身失败: 扫描源 ${SYNO_ARCH_SRC} 不存在 (fail-closed, exit 2)${RESET}"
  echo ""
  exit 2
fi

# L1 文件集 (扫描报告附录 A: 99 文件) —— 目录/文件缺失显式警告(可见性)，不静默缩小扫描面
L1_DIRS=""; L1_FILES=""
for d in routes tui-v2 tui-v3 mcp cli l1 l1-interaction; do
  if [ -d "$SYNO_ARCH_SRC/$d" ]; then L1_DIRS="$L1_DIRS $SYNO_ARCH_SRC/$d"; else
    echo -e "  ${YELLOW}⚠ L1 扫描目标缺失(跳过): ${SYNO_ARCH_SRC}/$d${RESET}"
  fi
done
for f in server.ts index.ts mvp-server.ts cli.ts cli-manager.ts setup.ts; do
  if [ -f "$SYNO_ARCH_SRC/$f" ]; then L1_FILES="$L1_FILES $SYNO_ARCH_SRC/$f"; else
    echo -e "  ${YELLOW}⚠ L1 扫描目标缺失(跳过): ${SYNO_ARCH_SRC}/$f${RESET}"
  fi
done
if [ -z "$L1_DIRS" ] && [ -z "$L1_FILES" ]; then
  echo -e "  ${RED}❌ 检查自身失败: L1 扫描目标为空 (fail-closed, exit 2)${RESET}"
  echo ""
  exit 2
fi

# 跨层路径模式(精确锚定)——裸 expert/sentinel 会误中 L2 的 agent/expert-file-loader、
# agent/sentinel-service(修补②同源教训: 形态必须锚定，宁可精确不可贪宽)
PAT_L3='(/l3/|/sentinel/|/expert-platform/|/expert/)'
PAT_L4='(/l4/|/evidence/|/adapters/sqlite-graph-store|graph-bridge)'
PAT_L5='(/store/|/cron/|/l5/|init/engine-context|better-sqlite3)'

# 修补①: import 语法结构锚定——静态 from '...' / 动态 import('...') / require('...') 三形态统一
# 类型位置四形态排除(扫描报告 §2.4 编译期耦合单列治理，不阻断): import type / : import( / as import( / type X = import(
strip_type_position() {
  grep -v "import type" | grep -v ": import(" | grep -v "as import(" | grep -vE "type [A-Za-z0-9_]+ = import\(" || true
}

# 基线棘轮对比: 命中按 file 聚合(file=count, 行号漂移免疫)，与基线同方向段逐一比对
# 输出: NEW<tab>file<tab>actual<tab>baseline / FIXED<tab>file<tab>a<tab>b / SUMMARY total=N new=M
compare_baseline() { # $1=方向段  $2=actual 流 (file=count)
  awk -v SEC="$1" -v BL="$SYNO_ARCH_BASELINE" '
    BEGIN {
      sec = ""
      while ((getline line < BL) > 0) {
        if (line ~ /^\[L1→L3\]/) sec = "L1→L3"
        else if (line ~ /^\[L1→L4\]/) sec = "L1→L4"
        else if (line ~ /^\[L1→L5\]/) sec = "L1→L5"
        else if (sec == SEC && line !~ /^#/ && index(line, "=") > 1) {
          eq = index(line, "=")
          base[substr(line, 1, eq - 1)] = substr(line, eq + 1) + 0
        }
      }
    }
    {
      eq = index($0, "=")
      f = substr($0, 1, eq - 1); a = substr($0, eq + 1) + 0
      b = (f in base) ? base[f] : 0
      if (a > b) { printf "NEW\t%s\t%d\t%d\n", f, a, b; new += a - b }
      else if (a < b) { printf "FIXED\t%s\t%d\t%d\n", f, a, b }
      total += a
    }
    END { printf "SUMMARY\ttotal=%d\tnew=%d\n", total + 0, new + 0 }
 ' <<< "$2" || true
}

NEW_TOTAL=0
check_l1_boundary() { # $1=方向段  $2=层模式  $3=标题  $4=修复提示
  local sec="$1" pat="$2" label="$3" hint="$4"
  local raw viol allowed actual cmp_out summary total new stock
  raw=$(grep -rnE "(from[[:space:]]*['\"]|import\(['\"]|require\(['\"])[^'\"]*${pat}" $L1_DIRS $L1_FILES --include="*.ts" --include="*.tsx" 2>/dev/null \
    | grep -v "node_modules" | grep -v "\.test\." || true)
  allowed=$(echo "$raw" | grep "// arch-allow(" || true)
  viol=$(echo "$raw" | grep -v "// arch-allow(" | strip_type_position || true)
  actual=$(echo "$viol" | awk -F: 'NF >= 2 && $2 ~ /^[0-9]+$/ { c[$1]++ } END { for (f in c) print f "=" c[f] }' || true)
  cmp_out=$(compare_baseline "$sec" "$actual")
  summary=$(echo "$cmp_out" | grep "^SUMMARY" | head -1 || true)
  total=$(echo "$summary" | sed -E 's/.*total=([0-9]+).*/\1/'); total="${total:-0}"
  new=$(echo "$summary" | sed -E 's/.*new=([0-9]+).*/\1/'); new="${new:-0}"
  stock=$((total - new))

  echo "─── ${label} ───"
  if [ "$total" -gt 0 ]; then
    echo -e "  ${YELLOW}⚠ 存量违规 ${stock} 处 (基线棘轮内, 不阻断——修复后请收紧 ${SYNO_ARCH_BASELINE}):${RESET}"
    echo "$viol" | sed 's/^/     /'
  else
    echo -e "  ${GREEN}✅ ${label}: 无违规${RESET}"
  fi
  if [ "$new" -gt 0 ]; then
    NEW_TOTAL=$((NEW_TOTAL + new))
    echo "$cmp_out" | grep "^NEW" | while IFS=$'\t' read -r _ nf na nb; do
      echo -e "     ${RED}↳ ${nf}: 实际 ${na} > 基线 ${nb} (新增 $((na - nb)))${RESET}"
      # D662/B8: 逐条列出该文件违规 file:line（基线只记 file=count 无行号,
      # 超基线文件须人工核对全部命中行——不列明细则 CTO 排障被迫手挖）
      echo "$viol" | grep -F "$nf:" | sed 's/^/         /'
    done || true
    if [ "$SYNO_CI" = "1" ]; then
      echo -e "  ${RED}❌ ${label}: 基线外新增 ${new} 处 [CI strict——软提示在 CI 上为硬阻断]${RESET}"
      FAIL=$((FAIL + 1))
    else
      echo -e "  ${YELLOW}⚠️ ${label}: 基线外新增 ${new} 处 [V5 软提示——CI 为权威(SYNO_CI), 本地不阻断]${RESET}"
    fi
  fi
  if echo "$cmp_out" | grep -q "^FIXED"; then
    echo -e "  ${CYAN}ℹ 检测到已修复项——棘轮只减不增, 请同步收紧基线文件对应计数${RESET}"
  fi
  if [ -n "$allowed" ]; then
    echo -e "  ${CYAN}ℹ 豁免 $(echo "$allowed" | grep -c . | tr -d '\n\r') 处 (// arch-allow 行内标注, 透明可见, K3 可审计):${RESET}"
    echo "$allowed" | sed 's/^/     /'
  fi
  echo "     ${hint}"
  echo ""
}

check_l1_boundary "L1→L3" "$PAT_L3" "1b. L1→L3 跨层引用" \
  "铁律 39: L1 只能依赖 L2。l3/ sentinel/ expert-platform/ expert/ 是 L3 层。正确做法: L1 → L2 (agent/ orchestrator/) → L3。"
check_l1_boundary "L1→L4" "$PAT_L4" "1c. L1→L4 跨层引用" \
  "铁律 39: L1 不得直接访问 L4 (l4/ evidence/ sqlite-graph-store 图桥接)。必须通过 L2 编排层。"
check_l1_boundary "L1→L5" "$PAT_L5" "1d. L1→L5 跨层引用" \
  "铁律 39: L1 不得直触 L5 (store/ cron/ l5/ better-sqlite3 / init/engine-context 句柄直取)。存储实例由 L2 bootstrap 组装后 DI 注入。"

# ═══ 2. L3→L5 跨层引用 ═══
# L3 (l3/) 不得直接操作数据库 (.prepare / db.run / db.exec / better-sqlite3)
# 例外: import { getDatabase } 是 DI 注入, 用于构造 L4 实例 (new KnowledgeStore(getDatabase()))
L3_DB=$(grep -rn "better-sqlite3\|\.prepare(\|db\.run\|\.exec(" src/l3/ --include="*.ts" 2>/dev/null \
  | grep -v "import type" \
  | grep -v "import { KnowledgeStore }" \
  | grep -v "node_modules" | grep -v "\.test\." \
  | grep -v "executeQuery\|//.*bridge\|//.*query" \
  || true)
L3_DB_COUNT=$(echo "$L3_DB" | grep -c . 2>/dev/null | tr -d '\n\r') || L3_DB_COUNT=0
[ -z "$L3_DB_COUNT" ] && L3_DB_COUNT=0

if [ "$L3_DB_COUNT" -gt 0 ]; then
  echo -e "  ${RED}❌ L3→L5 跨层引用: ${L3_DB_COUNT} 处${RESET}"
  echo "$L3_DB" | while read -r line; do echo "     ${line}"; done
  echo "     铁律 39: L3 不得直接操作数据库，必须通过 L4 接口。"
  FAIL=$((FAIL + 1))
else
  echo -e "  ${GREEN}✅ L3→L5 边界: 无直接数据库操作${RESET}"
fi

# ═══ 3. GraphStore 接口声明唯一性 ═══
# 只允许 graph-bridge.ts 声明 GraphStore。禁止在其他文件新增声明。
GS_DECLARATIONS=$(grep -rn "export interface GraphStore " src/ --include="*.ts" 2>/dev/null \
  | grep -v "node_modules" | grep -v "\.test\." || true)
GS_COUNT=$(echo "$GS_DECLARATIONS" | grep -c . 2>/dev/null | tr -d '\n\r') || GS_COUNT=0
[ -z "$GS_COUNT" ] && GS_COUNT=0
if [ "$GS_COUNT" -gt 1 ]; then
  echo -e "  ${RED}❌ GraphStore 接口多处声明: ${GS_COUNT} 处${RESET}"
  echo "$GS_DECLARATIONS" | while read -r line; do echo "     ${line}"; done
  echo "     铁律 39: GraphStore 只允许在一处声明 (graph-bridge.ts)"
  FAIL=$((FAIL + 1))
elif [ "$GS_COUNT" -eq 1 ]; then
  echo -e "  ${YELLOW}⚠  GraphStore 在 graph-bridge.ts 声明 (1处, 类型镜像自退役的 engine-core)${RESET}"
  echo "     运行: npx vitest run tests/architecture/graphstore-compatibility.test.ts"
else
  echo -e "  ${GREEN}✅ GraphStore 接口: 未声明 (D10 后由 Synova 自研引擎内联)${RESET}"
fi

# ═══ 4. 多租户安全: graph 参数传递 ═══
# 检测 L4 查询方法调用是否存在省略 graph 参数的模式
# 这是一个 heuristic 检查，精确验证靠 code review
MISSING_GRAPH=$(grep -rn "queryNodes\|queryEdges" src/l4/ --include="*.ts" 2>/dev/null \
  | grep -v "graph" \
  | grep -v "node_modules" | grep -v "\.test\." \
  || true)
MISSING_GRAPH_COUNT=$(echo "$MISSING_GRAPH" | grep -c . 2>/dev/null | tr -d '\n\r') || MISSING_GRAPH_COUNT=0
[ -z "$MISSING_GRAPH_COUNT" ] && MISSING_GRAPH_COUNT=0

if [ "$MISSING_GRAPH_COUNT" -gt 0 ]; then
  echo -e "  ${YELLOW}⚠  多租户安全: ${MISSING_GRAPH_COUNT} 处 queryNodes/queryEdges 调用待审查 graph 参数${RESET}"
else
  echo -e "  ${GREEN}✅ 多租户安全: query 调用均传递 graph${RESET}"
fi

# ═══ 5. D752 哨兵类型网登记硬门禁（D962-B2 自 check-sentinel-type-net.sh 合并迁入）═══
# 背景（D752, P1）: types.ts 静态 import type 登记是软约束，实测 8/45 未登记长期无人发现。
# 判定: manifest 存在的活跃哨兵必须在 src/sentinel/types.ts 有 `extensions/sentinels/<name>/`
#       路径引用（带尾斜杠防前缀碰撞）。豁免与 sentinel-loader.ts L71-73 同源:
#       shared/ 工具库、_ 前缀归档、非目录条目。归档不改 _ 前缀名 = 点名（倒逼显式化）。
# 三态: 0 全登记 / 1 缺失（FAIL+1，与架构违规同收口）/ 2 环境降级（fail-closed exit 2）。
# 注入缝: SYNO_TYPE_NET_ROOT 覆盖仓库根（沙箱夹具用，生产忽略）。
# LC_ALL=C（原脚本同款防御）: macOS bash 3.2 在 UTF-8 locale 下对本段中文字符串
# 产生字节级解析错乱（实测变量名尾黏连坏字节 → unbound variable → 假红）。本段数据
# 全 ASCII（目录名/路径），C locale 字节透传最稳。
export LC_ALL=C
export LANG=C
_ARCH_ROOT="${SYNO_TYPE_NET_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SENTINELS_DIR="$_ARCH_ROOT/extensions/sentinels"
TYPE_NET_TYPES_FILE="$_ARCH_ROOT/src/sentinel/types.ts"
TYPE_NET_RC=0
if [ ! -d "$SENTINELS_DIR" ] || [ ! -f "$TYPE_NET_TYPES_FILE" ]; then
  echo -e "  ${YELLOW}⚠ D752 类型网: 哨兵目录或 types.ts 不存在（fail-closed）${RESET}"
  echo "degraded: D752 类型网输入缺失（$SENTINELS_DIR / $TYPE_NET_TYPES_FILE）" >&2
  TYPE_NET_RC=2
else
  TYPE_NET_MISSING=""
  TYPE_NET_COUNT=0
  while IFS= read -r _entry; do
    [ -z "$_entry" ] && continue
    TYPE_NET_COUNT=$((TYPE_NET_COUNT + 1))
    if ! grep -qF "extensions/sentinels/${_entry}/" "$TYPE_NET_TYPES_FILE"; then
      TYPE_NET_MISSING="${TYPE_NET_MISSING}  ${_entry}\n"
    fi
  done < <(cd "$SENTINELS_DIR" && ls -1 | while IFS= read -r e; do
    [ -d "$e" ] || continue
    [ "$e" = "shared" ] && continue
    case "$e" in (_*) continue ;; esac
    echo "$e"
  done | sort -u)
  if [ -n "$TYPE_NET_MISSING" ]; then
    echo -e "  ${RED}❌ D752 类型网: 以下活跃哨兵未在 src/sentinel/types.ts 登记:${RESET}"
    echo -e "$TYPE_NET_MISSING"
    echo -e "     修法: types.ts 类型网区补 import type，或归档为 _ 前缀目录。禁止静默跳过。"
    FAIL=$((FAIL + 1))
  else
    echo -e "  ${GREEN}✅ D752 类型网: ${TYPE_NET_COUNT} 个活跃哨兵全部已登记${RESET}"
  fi
fi

echo ""

if [ "$TYPE_NET_RC" -eq 2 ]; then
  echo -e "  ${RED}架构检查: D752 类型网环境降级（fail-closed，不判绿）— exit 2${RESET}"
  echo ""
  exit 2
fi

if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}架构检查: ${FAIL} 项违规 — 修复后重试 commit${RESET}"
  echo ""
  exit 1
else
  if [ "$NEW_TOTAL" -gt 0 ]; then
    echo -e "  ${YELLOW}架构检查: 存量 ${NEW_TOTAL} 处基线外新增 (本地软提示不阻断; SYNO_CI=1 时转硬)${RESET}"
  else
    echo -e "  ${GREEN}架构检查: 全部通过 ✅${RESET}"
  fi
  echo ""
  exit 0
fi
