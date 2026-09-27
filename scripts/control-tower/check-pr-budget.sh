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
# D1028（纯归档/出库路径级豁免，CTO 2026-09-27 方案A 授权）:
#   旧口径 `--diff-filter=ACMR` 把 D 全滤掉 ⇒ **对纯删除 PR 完全失明**（实测：合成仓库纯删 5 件
#   → ACMR 空 → N_FILES=0 → 今天恒 exit 0）。本卡把变更集口径改为
#   `--name-status --find-renames`（**取全量含 D**），并新增**路径级出库豁免**：
#     ⓐ 无增/改件（AM_SET 为空，即纯删除/纯重命名） ∧
#     ⓑ 全部变更路径落 ✅ 出库白名单 **且零条命中** ❌ 拒绝名单
#   两条同时成立 → COUNT_PATHS 全不计入 → N_FILES=0（豁免生效）；
#   否则 **不豁免**且 D/R 计入预算（收紧），并逐条打印不满足的原因与命中的 ❌ 路径。
#   旁路封堵（DS3）：**纯删除/重命名**（AM_SET 空）命中 ❌ 拒绝名单 → 直接 FAIL（exit 1）——
#   ❌ = 绝不豁免，单人一次改名/删件即可改门禁，故不随「纯出库」放行。
#
# 契约（铁律 47）:
#   @input  — 选项:
#               --base <ref>        对比基线（默认 origin/main）
#               --max-files <N>     变更文件数上限（默认 12）
#               --max-behind <N>    落后基线提交数告警阈值（默认 20）
#               --files "<f1> <f2>" 显式变更集（测试注入；**语义不变**：视为 A/M，
#                                   故 ⓐ 恒不满足 → 按原口径计数，既有 32 项不回归）
#               --diff-status "<txt>" D1028 新增注入缝: 原样喂 `git diff --name-status`
#                                   文本，每行 `X<TAB>path`（R/C 为 `R100<TAB>old<TAB>new`），
#                                   取全量含 D → 可测纯删除/重命名豁免分支
#               --quiet             只输出结论行
#             （--diff-status 优先于 --files）
#   @output — stdout 逐项 ✅/⚠️/❌ 点名: ① 文件数（豁免生效时为出库豁免行） ② 域（调
#             check-ownership.py） ③ 落后基线提交数；❌ 行点名具体超标项。
#             豁免不生效时必须打印「出库豁免不适用」+ ⓐ/ⓑ 哪条不满足 + 逐条点名命中的 ❌ 路径
#             （超 30 件时截断显示，行内恒给「共 N 件」）。
#   @exit   — 0 = 在预算内（可含 ⚠️ 落后告警，不阻断）
#             1 = 超预算（文件数超上限 / 变更跨域 / 纯 D/R 命中 ❌ 拒绝名单）
#             2 = 检查执行失败（git 不可用 / 域校验器不可用 / 变更集算不出）—— fail-closed
#   @degraded — 基线 ref 全链不可解析（origin/main→main→origin/HEAD 均无）→ **显式 ⚠️ 留痕 +
#               跳过（exit 0）**，不 exit 2：沿用 pre-push 门禁 0-1 对「fetch 失败」的既有语义
#               （显式提示不静默跳过），避免环境性缺 ref 把所有 PR 误打成红；
#               域校验器缺失/python 不可用 → exit 2（这两类是检查本身坏了，不与通过混同）
#   @error  — 不抛；全部经退出码表达（ctrl-tower 模式 1）
#
# D1028 出库白/黑名单（§Q2.S2 冻结规格，逐字）:
#   ✅ OUTBOUND_ALLOW_RE   — 出库白名单前缀（纯归档/出库批次允许）
#   ❌ OUTBOUND_DENY_RE    — 拒绝名单前缀（代码/门禁/测试/扩展域，绝不豁免）
#   ❌ OUTBOUND_DENY_EXACT — CTO 2026-09-27 追加的精确路径（ownership.yaml /
#                            AUDIT-PROTOCOL.md：单人改名即可改门禁，绝不随出库豁免放行）
#
# 决策（派单要求「接线取舍理由写进 PR 描述」）:
#   接线选 pre-commit 组而非 CI quality job —— 派单红区已列 .github/workflows/ci.yml
#   （#520 刚改过，避免撞车），故 CI 侧不可用；本组按 V5.0.0「本地软提示 + CI 权威」
#   用 soft_check（本地不阻断、CI strict 转硬），条件跳过保持 <1s。
#   `## 出库声明` **不作硬条件**（§Q2.S4）：本脚本跑在 git pre-commit，读不到 PR 正文；
#   设为硬条件 = 本地永久报红/永久放行 = **假接线**（违铁律 0-2）。故豁免生效时只打 ⚠️
#   提示补声明；硬条件落在能读到 PR 正文的 merge_writeset_gate.py / ci.yml（A4 的活，本卡红线外）。
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
DIFF_STATUS=""
DIFF_STATUS_SET=0
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base)        BASE="${2:-}"; shift 2 ;;
    --max-files)   MAX_FILES="${2:-}"; shift 2 ;;
    --max-behind)  MAX_BEHIND="${2:-}"; shift 2 ;;
    --files)       FILES_OVERRIDE="${2:-}"; shift 2 ;;
    --diff-status) DIFF_STATUS="${2:-}"; DIFF_STATUS_SET=1; shift 2 ;;
    --quiet)       QUIET=1; shift ;;
    *) echo "❌ check-pr-budget: 未知参数 $1" >&2; exit 2 ;;
  esac
done

# PLATFORM-CHECKLIST #2: 数字入算术前二次清洗（CRLF + 非数字）
_clean_num() { local n="${1:-}"; n="$(printf '%s' "$n" | tr -d '\r\n')"; printf '%s' "${n//[^0-9]/}"; }
# 行数计数（grep -c 无匹配时输出 "0" 且 exit 1 —— 只取 stdout，再剥 CRLF，避免 "0\n0"）
_count_lines() { printf '%s\n' "${1:-}" | sed '/^$/d' | grep -c . | tr -d '\r\n'; }
MAX_FILES="$(_clean_num "$MAX_FILES")"; MAX_FILES="${MAX_FILES:-12}"
MAX_BEHIND="$(_clean_num "$MAX_BEHIND")"; MAX_BEHIND="${MAX_BEHIND:-20}"

echo "── PR 预算门禁（D734）: 基线=$BASE 上限=${MAX_FILES} 文件 / 落后阈值=${MAX_BEHIND} ──"

# ── S1 取变更集（D1028：全量含 D；--files/--diff-status 为测试注入缝）──
STATUS_TEXT=""
INJECT_MODE=0
BEHIND=""
if [ "$DIFF_STATUS_SET" -eq 1 ]; then
  INJECT_MODE=1
  STATUS_TEXT="$DIFF_STATUS"
elif [ -n "$FILES_OVERRIDE" ]; then
  INJECT_MODE=1
  # --files 语义不变（视为 A/M）。用 awk 加状态列而非 sed —— BSD sed 的替换侧不认 \t
  STATUS_TEXT="$(printf '%s\n' "$FILES_OVERRIDE" | tr ' ' '\n' | sed '/^$/d' | awk '{printf "M\t%s\n", $0}')"
else
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "❌ 检查执行失败: 非 git 仓库且未提供 --files/--diff-status（fail-closed）" >&2
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
  # S1: --name-status --find-renames 取全量（含 D）——旧口径 --diff-filter=ACMR 对纯删除 PR 失明
  STATUS_TEXT="$(git -c core.quotepath=false diff --name-status --find-renames "$BASE...HEAD" 2>/dev/null)" || {
    echo "❌ 检查执行失败: 无法计算 $BASE...HEAD 变更集（fail-closed）" >&2; exit 2; }
  # ③ 落后基线提交数（只有真 git 模式才算得出来）
  BEHIND="$(git rev-list --count "HEAD..$BASE" 2>/dev/null)" || BEHIND=""
  BEHIND="$(_clean_num "$BEHIND")"
fi

# ── S1 派生三集合（R 记双侧 old+new；D 记 1、R 记 1 用新路径、A/M/C 各记 1）──
ALL_PATHS=""
AM_PATHS=""
COUNT_PATHS=""
N_DEL=0
N_REN=0
while IFS=$'\t' read -r _st _p1 _p2; do
  _st="${_st%$'\r'}"; _p1="${_p1%$'\r'}"; _p2="${_p2%$'\r'}"
  [ -z "$_st" ] && continue
  if [ -z "$_p1" ]; then _p1="$_st"; _st="M"; fi   # 容错: 无 TAB 的行按 A/M 记（注入缝健壮性）
  [ -z "$_p1" ] && continue
  case "$_st" in
    D*)
      ALL_PATHS="${ALL_PATHS}${_p1}
"
      COUNT_PATHS="${COUNT_PATHS}${_p1}
"
      N_DEL=$((N_DEL + 1)) ;;
    R*)
      ALL_PATHS="${ALL_PATHS}${_p1}
${_p2}
"
      COUNT_PATHS="${COUNT_PATHS}${_p2}
"
      N_REN=$((N_REN + 1)) ;;
    C*)
      ALL_PATHS="${ALL_PATHS}${_p1}
${_p2}
"
      COUNT_PATHS="${COUNT_PATHS}${_p2}
"
      AM_PATHS="${AM_PATHS}${_p2}
" ;;
    *)
      ALL_PATHS="${ALL_PATHS}${_p1}
"
      COUNT_PATHS="${COUNT_PATHS}${_p1}
"
      AM_PATHS="${AM_PATHS}${_p1}
" ;;
  esac
done < <(printf '%s\n' "$STATUS_TEXT")
ALL_N="$(_count_lines "$ALL_PATHS")"; ALL_N="${ALL_N:-0}"
AM_N="$(_count_lines "$AM_PATHS")"; AM_N="${AM_N:-0}"

# ── S2 路径级出库豁免: ⓐ（AM_SET 空）∧ ⓑ（ALL_PATHS 全落 ✅ 且零命中 ❌）──
OUTBOUND_ALLOW_RE='^(\.claude/task-briefs/|docs/plans/|docs/synova/coordination/|memory/notes/|docs/synova/archive/|docs/archive/)'
OUTBOUND_DENY_RE='^(src/|scripts/|\.github/|tests/|extensions/|expert/)'
OUTBOUND_DENY_EXACT_RE='^docs/synova/coordination/(ownership\.yaml|AUDIT-PROTOCOL\.md)$'
OUTBOUND_EXEMPT=0
OUTBOUND_DENY_HARD=0
OUTSIDE_N=0
OUTSIDE_LIST=""
DENY_N=0
DENY_LIST=""
while IFS= read -r _p; do
  [ -z "$_p" ] && continue
  _in_allow=0
  _in_deny=0
  printf '%s' "$_p" | grep -qE "$OUTBOUND_ALLOW_RE" && _in_allow=1
  if printf '%s' "$_p" | grep -qE "$OUTBOUND_DENY_RE" || printf '%s' "$_p" | grep -qE "$OUTBOUND_DENY_EXACT_RE"; then _in_deny=1; fi
  if [ "$_in_allow" -eq 0 ]; then
    OUTSIDE_N=$((OUTSIDE_N + 1))
    OUTSIDE_LIST="${OUTSIDE_LIST}${_p}
"
  fi
  if [ "$_in_deny" -eq 1 ]; then
    DENY_N=$((DENY_N + 1))
    DENY_LIST="${DENY_LIST}${_p}
"
  fi
done < <(printf '%s\n' "$ALL_PATHS")

if [ "$ALL_N" -gt 0 ]; then
  if [ "$AM_N" -eq 0 ] && [ "$OUTSIDE_N" -eq 0 ] && [ "$DENY_N" -eq 0 ]; then
    OUTBOUND_EXEMPT=1
  else
    echo "  ℹ️  出库豁免不适用（D1028 路径级豁免未生效）:"
    if [ "$AM_N" -eq 0 ]; then
      echo "       ⓐ 满足: 无增/改件（纯删除 ${N_DEL} 件 + 重命名 ${N_REN} 件）"
    else
      echo "       ⓐ 不满足: 变更含 ${AM_N} 件增/改（非纯删除/重命名）→ D/R 计入预算"
    fi
    if [ "$OUTSIDE_N" -gt 0 ]; then
      echo "       ⓑ 不满足: 白名单外路径 ${OUTSIDE_N} 件（未落出库白名单）:"
      printf '%s\n' "$OUTSIDE_LIST" | awk -v ind="         " -v cap=30 'NF { if (++i <= cap) print ind $0 } END { if (i > cap) print ind "… 其余 " (i - cap) " 件省略（共 " i " 件）" }'
    fi
    if [ "$DENY_N" -gt 0 ]; then
      echo "       ⓑ 不满足: 命中 ❌ 拒绝名单 ${DENY_N} 件（绝不豁免）:"
      printf '%s\n' "$DENY_LIST" | awk -v ind="         " -v cap=30 'NF { if (++i <= cap) print ind $0 } END { if (i > cap) print ind "… 其余 " (i - cap) " 件省略（共 " i " 件）" }'
      # 旁路封堵: 纯删除/重命名命中 ❌ → 直接 FAIL（不靠文件数上限兜底）
      if [ "$AM_N" -eq 0 ]; then OUTBOUND_DENY_HARD=1; fi
    fi
  fi
fi

# ── S3 收紧: D/R 路径默认计入预算 + 既有 D860 治理产物豁免口径（原样保留）──
# 规则: 治理前缀（brief/卡/Note/规格/自验证据）且扩展名属治理产物（md/json/yaml/yml/txt）
#        → 不计入 ≤12 文件预算（交付文件才计数）。
# 反例防线: 同前缀下的**代码文件**（.ts/.sh/.py 等）不豁免——伪装成治理产物的代码仍被计数。
GOV_PREFIX_RE='^(\.claude/task-briefs/|task-state/|memory/notes/|docs/plans/|docs/synova/product-lines/evidence/)'
GOV_EXT_RE='\.(md|json|ya?ml|txt)$'
COUNTED=""
EXEMPT_N=0
while IFS= read -r _f; do
  [ -z "$_f" ] && continue
  if printf '%s' "$_f" | grep -qE "$GOV_PREFIX_RE" && printf '%s' "$_f" | grep -qE "$GOV_EXT_RE"; then
    EXEMPT_N=$((EXEMPT_N + 1))
  else
    COUNTED="${COUNTED}${_f}
"
  fi
done < <(printf '%s\n' "$COUNT_PATHS")
COUNTED="$(printf '%s' "$COUNTED" | sed '/^$/d')"
if [ "$OUTBOUND_EXEMPT" -eq 0 ] && [ "$EXEMPT_N" -gt 0 ]; then
  echo "  ℹ️  D860 治理产物豁免: ${EXEMPT_N} 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计入）"
fi
N_FILES="$(_count_lines "$COUNTED")"; N_FILES="${N_FILES:-0}"
if [ "$OUTBOUND_EXEMPT" -eq 1 ]; then
  # 豁免生效 → COUNT_PATHS 全不计入（含 D860 治理产物口径不再适用）
  N_FILES=0
  COUNTED=""
fi

FAILED=0

# ── ① 变更文件数 ≤ 上限（或 D1028 出库豁免生效 / 旁路封堵 FAIL）──
if [ "$OUTBOUND_EXEMPT" -eq 1 ]; then
  echo "  ✅ ① D734 出库豁免生效（$((N_DEL + N_REN)) 件纯删除/重命名，全部落出库白名单）"
  # §Q2.S4 裁定: 无 `## 出库声明` 时豁免仍生效，只给 ⚠️（本脚本读不到 PR 正文，禁做硬条件）
  echo "  ⚠️  未读到「## 出库声明」（pre-commit 读不到 PR 正文）—— 请在 PR 描述补「## 出库声明」批次段，合并级对账见 D708"
elif [ "$N_FILES" -le "$MAX_FILES" ]; then
  echo "  ✅ ① 变更文件数 $N_FILES ≤ 上限 $MAX_FILES"
else
  echo "  ❌ ① 变更文件数 $N_FILES > 上限 $MAX_FILES —— 拆 PR（禁调高上限）"
  FAILED=1
fi
if [ "$OUTBOUND_DENY_HARD" -eq 1 ]; then
  echo "  ❌ ① D1028 旁路封堵: 纯删除/重命名命中 ❌ 拒绝名单 ${DENY_N} 件 —— 绝不豁免（exit 1）"
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
  if [ "$INJECT_MODE" -eq 1 ]; then
    echo "  ✅ ③ 落后检查跳过（注入模式 --files/--diff-status 无 git 上下文）"
  else
    echo "  ✅ ③ 落后检查跳过（无 git 上下文）"
  fi
fi

if [ "$FAILED" -eq 0 ]; then
  [ "$QUIET" -eq 0 ] && echo "✅ PASS PR 预算内（$N_FILES 文件）"
  exit 0
fi
echo "❌ FAIL PR 超预算 —— 拆 PR，不要调高上限"
exit 1
