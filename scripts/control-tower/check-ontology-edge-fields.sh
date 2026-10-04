#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-ontology-edge-fields.sh — 本体边类型「时滞/因果强度」字段回归防线（#1015 G-1 / D1142）
#
# 病根（CTO 复核）:
#   #987/#988 给 extensions/ontology/edge-types/** 补了 action_effect_lag 与 transfer_function
#   （合计 110 个字段值），但**仓库内没有任何门禁守住它**——
#   `git grep -ln 'action_effect_lag\|transfer_function' origin/main -- 'scripts/**' 'tests/**'`
#   仅命中 scripts/audit/check-gates-v2.py（K3 审计域，非门禁）⇒ 防线尚未进仓库。
#   风险：这 110 个字段值可被后续任何 PR 静默改坏（删字段 / 清空值 / 删整个文件），无人拦。
#
# 机制（棘轮 + 基线对比，**零台账维护**）:
#   以 `origin/main`（可注入）为基线，逐个 edge-type JSON 比对：
#     ① 基线有该字段、本树没有            ⇒ **violation（字段被删）** exit 1
#     ② 基线有该文件、本树整个文件没了    ⇒ **violation（文件被删）** exit 1
#     ③ 字段在但值为空串 / 非字符串形态    ⇒ **violation（值被改坏）** exit 1
#     ④ 基线与本树都没有该字段            ⇒ 计「待交付」（信息性，不阻断）——交付 PR 落地后
#                                            基线自动抬升，防线**自动**生效，无需人工改台账
#   为什么不用"豁免台账"：台账会僵尸化（交付后忘记删条目 ⇒ 后续删字段被豁免掩盖），
#   而基线对比把"已交付"这件事交给 git 自己记录 —— 一条机制覆盖整个字段族（一类一机制）。
#
# 契约（铁律 47）:
#   @input  — --dir <path>   被测目录（默认 $ROOT/extensions/ontology/edge-types；测试注入缝）
#             --base <ref>   基线 ref（默认 $SYNO_ONTOLOGY_BASE_REF，再兜底 origin/main → main）
#             --quiet        只输出汇总行
#   @output — stdout 逐条 ❌ 点名（文件 + 字段 + 原因）+ 计数行 + 末行机器可读汇总:
#               ONTOLOGY_EDGE_FIELDS_SUMMARY: files=<n> present=<n> pending=<n> violations=<n> base=<ref>
#   @exit   — 0 = 无违规（可含「待交付」信息）｜ 1 = 检测到违规（业务阻断）
#             2 = **检查自身失败**（目录不存在 / 基线 ref 不可解析 / git 不可用）—— fail-closed，
#                 绝不静默当通过（铁律 11 / D328 三态惯例）
#   @degraded — exit 2 时 stderr 以 `degraded:` 起（环境不可判 ⇒ 阻断而非放行）
#   @seam   — SYNO_ONTOLOGY_BASE_REF（基线 ref）/ SYNO_ONTOLOGY_DIR（等价 --dir，测试用）
#
# 平台（PLATFORM-CHECKLIST 9 条）:
#   仅用 git + grep -E + 纯 bash —— 无 python 依赖、无 `grep -P`、无 `date -d`、无 `sed -i`；
#   JSON 语法校验为**可选增强**（PYBIN 三级探测；不可用则显式降级提示，不阻断字段判据）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

DIR_OVERRIDE=""
BASE_OVERRIDE=""
QUIET=0
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --dir)   shift; DIR_OVERRIDE="${1:-}" ;;
    --dir=*) DIR_OVERRIDE="${1#--dir=}" ;;
    --base)  shift; BASE_OVERRIDE="${1:-}" ;;
    --base=*) BASE_OVERRIDE="${1#--base=}" ;;
    --quiet|-q) QUIET=1 ;;
    -h|--help)
      cat <<'USAGE'
用法: bash check-ontology-edge-fields.sh [--dir <edge-types 目录>] [--base <ref>] [--quiet]
退出码: 0=通过 / 1=有违规（字段被删·值被改坏·文件被删） / 2=检查自身失败（不可判 ⇒ 阻断）
USAGE
      exit 0 ;;
    *) echo "未知参数: ${1:-}" >&2; exit 2 ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
EDGE_DIR="${DIR_OVERRIDE:-${SYNO_ONTOLOGY_DIR:-$ROOT/extensions/ontology/edge-types}}"
FIELDS="action_effect_lag transfer_function"

log() { [ "$QUIET" = "1" ] || echo "$1"; }

command -v git >/dev/null 2>&1 || { echo "degraded: git 不可用，无法与基线比对 (code=ONT_GIT, phase=locate)" >&2; exit 2; }
[ -d "$EDGE_DIR" ] || { echo "degraded: 目录不存在: $EDGE_DIR (code=ONT_DIR, phase=locate)" >&2; exit 2; }

# ── 基线 ref 解析（显式注入 > origin/main > main）；全部不可解析 ⇒ exit 2（不可判即阻断）──
# 注入缝必须**决定性**：显式给出 --base/环境变量却不可解析 ⇒ 立即 exit 2，**不回退** origin/main
#   （否则"注入缝失效"会被静默掩盖 —— 与 check-pr-budget.sh 的注入缝语义一致）。
BASE_REF=""
_EXPLICIT_BASE="${BASE_OVERRIDE:-${SYNO_ONTOLOGY_BASE_REF:-}}"
if [ -n "$_EXPLICIT_BASE" ]; then
  if git -C "$ROOT" rev-parse --verify -q "${_EXPLICIT_BASE}^{commit}" >/dev/null 2>&1; then
    BASE_REF="$_EXPLICIT_BASE"
  else
    echo "degraded: 显式基线 ref 不可解析: '${_EXPLICIT_BASE}'（注入缝决定性——不回退 origin/main） (code=ONT_BASE, phase=baseline)" >&2
    exit 2
  fi
else
  for _r in origin/main main; do
    if git -C "$ROOT" rev-parse --verify -q "${_r}^{commit}" >/dev/null 2>&1; then BASE_REF="$_r"; break; fi
  done
fi
if [ -z "$BASE_REF" ]; then
  echo "degraded: 基线 ref 不可解析（试过 origin/main / main）——无法判定字段是否被删 (code=ONT_BASE, phase=baseline)" >&2
  exit 2
fi

# 相对仓库根的路径前缀（git show <ref>:<relpath> 需要相对路径）
REL_DIR="$(cd "$EDGE_DIR" && pwd)"
case "$REL_DIR" in
  "$ROOT"/*) REL_DIR="${REL_DIR#"$ROOT"/}" ;;
  *) REL_DIR="" ;;
esac

# ── 可选 JSON 语法校验（PYBIN 三级探测；不可用 ⇒ 显式降级，不影响字段判据）──
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -z "$PYBIN" ] && log "⚠  PYBIN 不可用 — 跳过 JSON 语法校验（显式降级，不静默；字段判据仍执行）"

# 字段是否出现（文本级，容忍任意空白）；值是否非空字符串
has_field()   { grep -qE "\"$2\"[[:space:]]*:" "$1" 2>/dev/null; }
has_value()   { grep -qE "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" "$1" 2>/dev/null; }
base_has_field() { git -C "$ROOT" show "$1:$2" 2>/dev/null | grep -qE "\"$3\"[[:space:]]*:"; }

VIOLATIONS=0
VIOL_TEXT=""
viol() { VIOLATIONS=$((VIOLATIONS + 1)); VIOL_TEXT="${VIOL_TEXT}  ❌ $1
"; }

FILES=0; PRESENT=0; PENDING=0; DELETED_FILES=0

# ── ① 文件集对比: 基线有、本树没有 → 文件被删 ──
if [ -n "$REL_DIR" ]; then
  BASE_FILES="$(git -C "$ROOT" ls-tree -r --name-only "$BASE_REF" -- "$REL_DIR" 2>/dev/null | grep -E '\.json$' || true)"
  for bf in $BASE_FILES; do
    [ -n "$bf" ] || continue
    local_abs="$ROOT/$bf"
    if [ ! -f "$local_abs" ]; then
      DELETED_FILES=$((DELETED_FILES + 1))
      viol "文件被删: $bf — 基线 $BASE_REF 存在、本树缺失（本体边类型是数据资产，删除须独立卡 + CTO 批复）"
    fi
  done
fi

# ── ② 逐文件比对 ──
for f in "$EDGE_DIR"/*.json; do
  [ -e "$f" ] || continue
  FILES=$((FILES + 1))
  rel=""
  if [ -n "$REL_DIR" ]; then rel="$REL_DIR/${f##*/}"; fi
  for fld in $FIELDS; do
    if has_field "$f" "$fld"; then
      PRESENT=$((PRESENT + 1))
      if ! has_value "$f" "$fld"; then
        viol "值被改坏: ${f##*/} — $fld 存在但值为空或非字符串（判据: \"$fld\": \"<非空>\"）"
      fi
    else
      PENDING=$((PENDING + 1))
      if [ -n "$rel" ] && base_has_field "$BASE_REF" "$rel" "$fld"; then
        viol "字段被删: ${f##*/} — $fld 在 $BASE_REF 存在、本树缺失"
      fi
    fi
  done
  if [ -n "$PYBIN" ]; then
    "$PYBIN" -c "import json,sys; json.load(open(sys.argv[1], encoding='utf-8'))" "$f" >/dev/null 2>&1 \
      || viol "JSON 语法错误: ${f##*/}（无法解析为 JSON 对象）"
  fi
done

log "ontology-edge-fields: 基线=$BASE_REF ｜ 文件=$FILES ｜ 已交付字段=$PRESENT ｜ 待交付=$PENDING ｜ 删文件=$DELETED_FILES"
if [ "$VIOLATIONS" -gt 0 ]; then
  printf '%s' "$VIOL_TEXT"
  [ "$QUIET" = "1" ] || echo "  处置: 恢复被删字段/文件，或（确需删除）立独立卡经 CTO 批复后同步更新基线"
fi
echo "ONTOLOGY_EDGE_FIELDS_SUMMARY: files=$FILES present=$PRESENT pending=$PENDING violations=$VIOLATIONS base=$BASE_REF"

[ "$VIOLATIONS" -eq 0 ] || exit 1
exit 0
