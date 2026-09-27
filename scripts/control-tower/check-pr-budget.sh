#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# check-pr-budget.sh — D734 PR 预算门禁（冲突概率 ∝ 改动大小 × 分支存活时间）
#
# 背景（派单 §二）: D721 一个 PR 背三类门禁问题挂半天；K3 审计分支落后 main
#   差点回退他人成果。大 PR + 长存活分支 = 冲突源，也是 D734 自己要禁止的形态。
#
# 契约（铁律 47）:
#   @input  — 选项:
#               --base <ref>        对比基线（默认 origin/main）
#               --max-files <N>     变更文件数上限（默认 12）
#               --max-behind <N>    落后基线提交数告警阈值（默认 20）
#               --files "<f1> <f2>" 显式变更集（测试注入；缺省用 git 算 base...HEAD）
#               --quiet             只输出结论行
#   @output — stdout 逐项 ✅/⚠️/❌ 点名: ① 文件数 ② 域（调 check-ownership.py）
#             ③ 落后基线提交数；❌ 行点名具体超标项
#   @exit   — 0 = 在预算内（可含 ⚠️ 落后告警，不阻断）
#             1 = 超预算（文件数超上限 或 变更跨域）
#             2 = 检查执行失败（git 不可用 / 域校验器不可用 / 变更集算不出）—— fail-closed
#   @degraded — 基线 ref 全链不可解析（origin/main→main→origin/HEAD 均无）→ **显式 ⚠️ 留痕 +
#               跳过（exit 0）**，不 exit 2：沿用 pre-push 门禁 0-1 对「fetch 失败」的既有语义
#               （显式提示不静默跳过），避免环境性缺 ref 把所有 PR 误打成红；
#               域校验器缺失/python 不可用 → exit 2（这两类是检查本身坏了，不与通过混同）
#   @error  — 不抛；全部经退出码表达（ctrl-tower 模式 1）
#
# 决策（派单要求「接线取舍理由写进 PR 描述」）:
#   接线选 pre-commit 组而非 CI quality job —— 派单红区已列 .github/workflows/ci.yml
#   （#520 刚改过，避免撞车），故 CI 侧不可用；本组按 V5.0.0「本地软提示 + CI 权威」
#   用 soft_check（本地不阻断、CI strict 转硬），条件跳过保持 <1s。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OWNERSHIP="$SCRIPT_DIR/check-ownership.py"

# PLATFORM-CHECKLIST #1: PYBIN 三级探测（禁裸 python3 —— Win 部分机器无 python3.exe）
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

BASE="origin/main"
MAX_FILES=12
MAX_BEHIND=20
FILES_OVERRIDE=""
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base)       BASE="${2:-}"; shift 2 ;;
    --max-files)  MAX_FILES="${2:-}"; shift 2 ;;
    --max-behind) MAX_BEHIND="${2:-}"; shift 2 ;;
    --files)      FILES_OVERRIDE="${2:-}"; shift 2 ;;
    --quiet)      QUIET=1; shift ;;
    *) echo "❌ check-pr-budget: 未知参数 $1" >&2; exit 2 ;;
  esac
done

# PLATFORM-CHECKLIST #2: 数字入算术前二次清洗（CRLF + 非数字）
_clean_num() { local n="${1:-}"; n="$(printf '%s' "$n" | tr -d '\r\n')"; printf '%s' "${n//[^0-9]/}"; }
MAX_FILES="$(_clean_num "$MAX_FILES")"; MAX_FILES="${MAX_FILES:-12}"
MAX_BEHIND="$(_clean_num "$MAX_BEHIND")"; MAX_BEHIND="${MAX_BEHIND:-20}"

echo "── PR 预算门禁（D734）: 基线=$BASE 上限=${MAX_FILES} 文件 / 落后阈值=${MAX_BEHIND} ──"

# ── 取变更集（缺省 git 算；--files 为测试注入缝）──
BEHIND=""
if [ -n "$FILES_OVERRIDE" ]; then
  FILES="$(printf '%s\n' "$FILES_OVERRIDE" | tr ' ' '\n' | sed '/^$/d')"
else
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "❌ 检查执行失败: 非 git 仓库且未提供 --files（fail-closed）" >&2
    exit 2
  fi
  # 基线解析链（origin/main 首选；独立 clone / 浅克隆下回退）。全不可解析 → **显式降级跳过**，
  # 不 exit 2 —— 沿用 pre-push 门禁 0-1 对「fetch 失败」的既有语义（显式提示 + 不静默跳过），
  # 避免环境性缺 ref 把所有 PR 误打成红（fail-open 但留痕；铁律 11 不静默）。
  BASE_RESOLVED=""
  for _cand in "$BASE" origin/main main origin/HEAD; do
    if git rev-parse --verify --quiet "$_cand" >/dev/null 2>&1; then BASE_RESOLVED="$_cand"; break; fi
  done
  if [ -z "$BASE_RESOLVED" ]; then
    echo "  ⚠️  degraded: 基线不可解析（尝试过 $BASE / origin/main / main / origin/HEAD）"
    echo "      → 跳过 PR 预算检查（先 git fetch origin；此处显式留痕，不静默放过）"
    exit 0
  fi
  [ "$BASE_RESOLVED" != "$BASE" ] && echo "  ⚠️  基线 $BASE 不可解析 → 回退用 $BASE_RESOLVED"
  BASE="$BASE_RESOLVED"
  FILES="$(git -c core.quotepath=false diff --name-only --diff-filter=ACMR "$BASE...HEAD" 2>/dev/null)" || {
    echo "❌ 检查执行失败: 无法计算 $BASE...HEAD 变更集（fail-closed）" >&2; exit 2; }
  # ③ 落后基线提交数（只有真 git 模式才算得出来）
  BEHIND="$(git rev-list --count "HEAD..$BASE" 2>/dev/null)" || BEHIND=""
  BEHIND="$(_clean_num "$BEHIND")"
fi
FILES="$(printf '%s' "$FILES" | sed '/^$/d')"

# ── D860 治理产物豁免口径（F9/F12 治本）──
# 规则: 治理前缀（brief/卡/Note/规格/自验证据）且扩展名属治理产物（md/json/yaml/yml/txt）
#        → 不计入 ≤12 文件预算（交付文件才计数）。
# 反例防线: 同前缀下的**代码文件**（.ts/.sh/.py 等）不豁免——伪装成治理产物的代码仍被计数。
#
# ── CT-D（2026-09-27）豁免**粒度**评估结论 ──
# 评估对象: 本表第 5 项 `docs/synova/product-lines/evidence/` 是**目录级**豁免
#   （`merge_writeset_gate.py` 侧只有 `.claude/bypass.log` 一条路径级内置豁免 → 口径不一致）。
# 结论 = **保留目录级豁免，但补两条粒度约束**（不改成路径级白名单）:
#   · 为什么不用路径级白名单: evidence 文件名是任务定制的（`CT1-*`/`D940-*`/`D716-win-*/...`），
#     白名单必然漏 → 每次新任务都得改门禁脚本（把"运行期产物"变成"改门禁"），违背 D860 本意。
#   · 为什么必须补粒度: 目录级豁免若不设界 = **无界通道**（evidence/ 下随便塞，预算恒绿）；
#     且原实现只打印一个**计数**，豁免了哪些文件**不可核**（与 `merge_writeset_gate.py`
#     自己写的"豁免必须显式、且逐条打印理由"同款原则冲突）。
#   粒度① **逐条列举**: 每个豁免路径逐行打印（内容可核，不静默）。
#   粒度② **数量阈值**: evidence 目录的豁免件数上限 = `--max-files`（复用同一个旋钮，**不引入新魔数**）。
#     超出部分**计入预算**并逐条点名。阈值本身不单独判红（判红仍只由 ① 文件数预算决定）
#     ⇒ 不会凭一个魔数误拦正常 PR。
#     为何上限 = MAX_FILES: 本豁免是给 M5 必备证据开的**窄口子**（每任务 1~3 件），
#     其规模不应超过整个 PR 允许的文件数；超过即视为"证据顺带夹带"，回到预算视野。
#   ⚠️ 与 `merge_writeset_gate.py` 的分工: 那边是**授权口径**（该文件是否属本 PR 写集），
#     故**不加**目录级豁免（否则任何 PR 可静默改写他人证据）；这边是**计数口径**，
#     故保留目录级豁免 + 上述两条约束。两者不是"口径不一致"，是不同语义。
GOV_PREFIX_RE='^(\.claude/task-briefs/|task-state/|memory/notes/|docs/plans/|docs/synova/product-lines/evidence/)'
GOV_EXT_RE='\.(md|json|ya?ml|txt)$'
EVIDENCE_PREFIX='docs/synova/product-lines/evidence/'
COUNTED=""
GOV_OTHER=""
EVID_CAND=""
while IFS= read -r _f; do
  [ -z "$_f" ] && continue
  if printf '%s' "$_f" | grep -qE "$GOV_PREFIX_RE" && printf '%s' "$_f" | grep -qE "$GOV_EXT_RE"; then
    case "$_f" in
      "$EVIDENCE_PREFIX"*) EVID_CAND="${EVID_CAND}${_f}
" ;;
      *) GOV_OTHER="${GOV_OTHER}${_f}
" ;;
    esac
  else
    COUNTED="${COUNTED}${_f}
"
  fi
done <<EOF
$FILES
EOF

# CT-D 粒度②: evidence 目录豁免有界化 —— 取**字典序前 MAX_FILES 件**豁免（与输入顺序无关 ⇒ 结果确定），
#   其余计入预算。EVID_ALL_N 是"共 N 件"的全量口径（逐条点名，不截断输出）。
_EV_ALL="$(printf '%s' "$EVID_CAND" | sed '/^$/d' | sort)"
EVID_ALL_N="$(printf '%s\n' "$_EV_ALL" | grep -c . | tr -d '\r\n')"; EVID_ALL_N="$(_clean_num "$EVID_ALL_N")"
EVID_KEEP="$(printf '%s\n' "$_EV_ALL" | head -n "$MAX_FILES")"
EVID_OVER="$(printf '%s\n' "$_EV_ALL" | tail -n "+$((MAX_FILES + 1))")"
GOV_OTHER_N="$(printf '%s\n' "$GOV_OTHER" | grep -c . | tr -d '\r\n')"; GOV_OTHER_N="$(_clean_num "$GOV_OTHER_N")"
EVID_KEEP_N="$(printf '%s\n' "$EVID_KEEP" | grep -c . | tr -d '\r\n')"; EVID_KEEP_N="$(_clean_num "$EVID_KEEP_N")"
EVID_OVER_N="$(printf '%s\n' "$EVID_OVER" | grep -c . | tr -d '\r\n')"; EVID_OVER_N="$(_clean_num "$EVID_OVER_N")"
EXEMPT_N=$((GOV_OTHER_N + EVID_KEEP_N))
COUNTED="$(printf '%s%s\n' "$COUNTED" "$EVID_OVER" | sed '/^$/d')"
if [ "$EXEMPT_N" -gt 0 ]; then
  echo "  ℹ️  D860 治理产物豁免: ${EXEMPT_N} 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计数）"
  # CT-D 粒度①: 逐条列举（豁免内容可核，不静默）
  [ "$GOV_OTHER_N" -gt 0 ] && printf '%s\n' "$GOV_OTHER" | sed '/^$/d' | sed 's/^/       · /'
  if [ "$EVID_KEEP_N" -gt 0 ]; then
    echo "       · [目录级豁免 ${EVIDENCE_PREFIX}] ${EVID_KEEP_N}/${MAX_FILES} 件:"
    printf '%s\n' "$EVID_KEEP" | sed '/^$/d' | sed 's/^/         - /'
  fi
fi
if [ "$EVID_OVER_N" -gt 0 ]; then
  echo "  ⚠️  CT-D evidence 目录级豁免超阈值: 目录内共 ${EVID_ALL_N} 件 > 上限 ${MAX_FILES} 件"
  echo "      ⇒ 超出 ${EVID_OVER_N} 件**计入预算**（阈值不单独判红；判红仍由 ① 文件数决定）:"
  printf '%s\n' "$EVID_OVER" | sed '/^$/d' | sed 's/^/         - /'
fi
N_FILES=0
[ -n "$COUNTED" ] && N_FILES="$(printf '%s\n' "$COUNTED" | grep -c . | tr -d '\r\n')"
N_FILES="$(_clean_num "$N_FILES")"; N_FILES="${N_FILES:-0}"

FAILED=0

# ── ① 变更文件数 ≤ 上限 ──
if [ "$N_FILES" -le "$MAX_FILES" ]; then
  echo "  ✅ ① 变更文件数 $N_FILES ≤ 上限 $MAX_FILES"
else
  echo "  ❌ ① 变更文件数 $N_FILES > 上限 $MAX_FILES —— 拆 PR（禁调高上限）"
  FAILED=1
fi

# ── ② 变更只落在一个域（D733 check-ownership.py 的单域模式）──
if [ ! -f "$OWNERSHIP" ]; then
  echo "❌ 检查执行失败: 域校验器缺失 ${OWNERSHIP}（D734 依赖 D733；fail-closed）" >&2
  exit 2
fi
if [ -z "$PYBIN" ]; then
  echo "❌ 检查执行失败: python 不可用，无法做域校验（fail-closed，不静默放过）" >&2
  exit 2
fi
if [ "$N_FILES" -eq 0 ]; then
  echo "  ✅ ② 无变更文件 → 域校验跳过"
else
  DOMAIN_OUT="$("$PYBIN" "$OWNERSHIP" $COUNTED 2>&1)"; DOMAIN_EXIT=$?
  if [ "$DOMAIN_EXIT" -eq 0 ]; then
    echo "  ✅ ② 变更单域: $(printf '%s\n' "$DOMAIN_OUT" | grep -E '^✅ PASS' | head -1)"
  elif [ "$DOMAIN_EXIT" -eq 1 ]; then
    echo "  ❌ ② 变更跨域 —— 一个 PR 只许一个域（D733 ownership.yaml）"
    printf '%s\n' "$DOMAIN_OUT" | grep -E '^(mac|win|k3|⚠️)' | head -12 | sed 's/^/       /'
    FAILED=1
  else
    echo "❌ 检查执行失败: 域校验器 exit=${DOMAIN_EXIT}（fail-closed）" >&2
    printf '%s\n' "$DOMAIN_OUT" | head -5 | sed 's/^/     /' >&2
    exit 2
  fi
fi

# ── ③ 落后基线提交数（告警，不阻断——防「落后分支直接合」）──
if [ -n "${BEHIND:-}" ]; then
  if [ "$BEHIND" -gt "$MAX_BEHIND" ]; then
    echo "  ⚠️  ③ 分支落后 $BASE 共 $BEHIND 个提交（> ${MAX_BEHIND}）—— 先 rebase/merge 再开 PR"
  else
    echo "  ✅ ③ 落后 $BASE $BEHIND 个提交 ≤ $MAX_BEHIND"
  fi
else
  echo "  ✅ ③ 落后检查跳过（--files 注入模式无 git 上下文）"
fi

if [ "$FAILED" -eq 0 ]; then
  [ "$QUIET" -eq 0 ] && echo "✅ PASS PR 预算内（$N_FILES 文件）"
  exit 0
fi
echo "❌ FAIL PR 超预算 —— 拆 PR，不要调高上限"
exit 1
