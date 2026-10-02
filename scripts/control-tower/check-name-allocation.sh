#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-name-allocation.sh — D940 卡号 / worktree 名 / 分支名 三元组一致性校验器
#
# 背景: `alloc-task-id.sh` 是取号唯一入口，但**已有号**是否被别处占用、以及
#   「号 / worktree 名 / 分支名」三者是否自洽，此前无任何校验面（D730 登记项；
#   D736 撞号现场复现见 .claude/task-briefs/2026-09-14-D737-*.md:21）。
#   本校验器是该缺口的**读取面**：只读，不取号、不写盘。
#
# 契约（铁律 47）:
#   @input  — [--id D###] [--worktree <名>] [--branch <名>] [--json]
#             · 至少给一个；只给 --worktree/--branch 时，从中提取 D# 作为待校验号。
#             · repo 由 **TASK_STATE_DIR 所属仓库**决定（与 alloc-task-id.sh 同口径，不按 cwd）：
#               SYNO_TASK_STATE_DIR 可覆盖（同 alloc 注入缝，夹具用）。
#   @output — 人类可读: "✅ …" / "❌ 冲突位置: <label>  <原文>"（label ∈ 5 个固定值）
#             --json: {"id","status","degraded","conflicts":["<label>:<原文>",…]}
#             status ∈ free | conflict | invalid
#   @exit   — 0 = 一致且未被占
#             1 = 冲突（号在任一位置被占 **或** 三元组 D# 不一致 **或** 名中提不出 D#）
#             2 = 校验器自身失败/输入非法（无参、--id 格式非法、选项缺值、未知选项、委派脚本缺失）
#   @degraded — ls-remote 不可达 → stderr `degraded: …` 显式可见 + 仍按可判定位置判定（绝不静默，
#             绝不因不可达而宣称"未占=通过"以外的结论——不可达时只报"可判定范围内未见占用"）
#   @error  — bash 全角标点紧贴变量一律用 ${VAR} 显式边界（D370 教训）
#
# 覆盖矩阵（由 tests/control-tower/check-name-allocation.test.sh 覆盖，D940-T2 写集）:
#   正常 — 三元组一致且号空闲 → rc=0
#   冲突 — 号被占（点名冲突位置原文）→ rc=1；命名不一致 → rc=1
#   降级 — origin 不可达 → `degraded:` 可见 且 仍能给结论
#   边界 — 无参/坏号/缺值/未知选项 → rc=2
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOC="$SCRIPT_DIR/alloc-task-id.sh"

ID=""; WT=""; BR=""; JSON=0

_usage() {
  cat <<'USAGE'
用法: check-name-allocation.sh [--id D###] [--worktree <名>] [--branch <名>] [--json]
  校验「卡号 / worktree 名 / 分支名」三元组一致性，并检查该号是否已在
   task-state / origin/main / 远端分支 / 本地分支 / worktree 名 任一处被占用。
  rc: 0=一致且未占  1=冲突（点名位置）  2=校验器自身失败/输入非法
USAGE
}

# ── 参数解析（全角标点/变量边界显式化）──
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --id)       shift; [ $# -gt 0 ] || { echo "check-name-allocation: --id 缺值" >&2; exit 2; }; ID="${1}" ;;
    --id=*)     ID="${1#--id=}" ;;
    --worktree) shift; [ $# -gt 0 ] || { echo "check-name-allocation: --worktree 缺值" >&2; exit 2; }; WT="${1}" ;;
    --worktree=*) WT="${1#--worktree=}" ;;
    --branch)   shift; [ $# -gt 0 ] || { echo "check-name-allocation: --branch 缺值" >&2; exit 2; }; BR="${1}" ;;
    --branch=*) BR="${1#--branch=}" ;;
    --json)     JSON=1 ;;
    -h|--help)  _usage; exit 0 ;;
    *)          echo "check-name-allocation: 未知选项 '$1'" >&2; _usage >&2; exit 2 ;;
  esac
  shift
done

# rc=2: 无任何有效输入
if [ -z "$ID" ] && [ -z "$WT" ] && [ -z "$BR" ]; then
  echo "check-name-allocation: 至少需要 --id / --worktree / --branch 之一" >&2
  _usage >&2
  exit 2
fi

# ── 名中提 D#: 大小写不敏感取 d<数字>；提不出 → 由调用处判 rc=1（命名约定不符）──
_extract_num() {
  printf '%s' "$1" | grep -oiE '(^|[^0-9a-z])d[0-9]+([^0-9]|$)' 2>/dev/null | grep -oiE 'd[0-9]+' 2>/dev/null | head -1 | tr '[:upper:]' '[:lower:]' | sed 's/^d//' || true
}

ID_NUM=""
if [ -n "$ID" ]; then
  ID_NUM="${ID#[Dd]}"
  case "$ID_NUM" in
    ''|*[!0-9]*) echo "check-name-allocation: 非法卡号 '${ID}'（应形如 D942 或 942）" >&2; exit 2 ;;
  esac
fi

WT_NUM=""; BR_NUM=""
[ -n "$WT" ] && WT_NUM="$(_extract_num "$WT")"
[ -n "$BR" ] && BR_NUM="$(_extract_num "$BR")"

CONFLICTS=""   # 每行: <label>:<原文>
_add() { CONFLICTS="${CONFLICTS}$1:$2
"; }

# ── 命名一致性（同一 D# 三处必须相同；名里提不出 D# = 命名约定不符）──
if [ -n "$WT" ] && [ -z "$WT_NUM" ]; then
  _add "naming" "worktree 名 '${WT}' 中提不出 D#（约定 .synova-wt-<prefix>d###）"
fi
if [ -n "$BR" ] && [ -z "$BR_NUM" ]; then
  _add "naming" "branch 名 '${BR}' 中提不出 D#（约定 <type>/d###-<slug>）"
fi
for pair in "worktree:${WT_NUM}" "branch:${BR_NUM}"; do
  kind="${pair%%:*}"; num="${pair#*:}"
  if [ -n "$num" ] && [ -n "$ID_NUM" ] && [ "$num" != "$ID_NUM" ]; then
    _add "naming" "${kind} D${num} ≠ --id D${ID_NUM}（三元组不一致）"
  fi
done
# 只给 worktree/branch（无 --id）时，二者也必须自洽
if [ -z "$ID_NUM" ] && [ -n "$WT_NUM" ] && [ -n "$BR_NUM" ] && [ "$WT_NUM" != "$BR_NUM" ]; then
  _add "naming" "worktree D${WT_NUM} ≠ branch D${BR_NUM}（三元组不一致）"
fi
[ -z "$ID_NUM" ] && ID_NUM="${WT_NUM:-${BR_NUM:-}}"

# ── 占用校验: 委派 alloc-task-id.sh --check-id（单一实现，杜绝第二副本漂移）──
STATUS="free"; DEGRADED=0
if [ -n "$ID_NUM" ]; then
  if [ ! -f "$ALLOC" ]; then
    echo "check-name-allocation: 委派脚本缺失 ${ALLOC}" >&2; exit 2
  fi
  _DELEGATE_OUT="$(bash "$ALLOC" --check-id "D${ID_NUM}" 2>/tmp/.chk-name-alloc-stderr.$$)"
  _DELEGATE_RC=$?
  _DELEGATE_ERR="$(cat /tmp/.chk-name-alloc-stderr.$$ 2>/dev/null || true)"; rm -f /tmp/.chk-name-alloc-stderr.$$
  # 委派脚本的降级信号向上传播（铁律 31），不改写、不吞掉
  [ -n "$_DELEGATE_ERR" ] && printf '%s\n' "$_DELEGATE_ERR" >&2
  case "$_DELEGATE_ERR" in *degraded:*) DEGRADED=1 ;; esac
  case "$_DELEGATE_RC" in
    0) : ;;   # 未占
    1) while IFS= read -r line; do
         [ -z "$line" ] && continue
         label="${line%% *}"; rest="${line#* }"; rest="${rest# }"
         _add "$label" "$rest"
       done <<< "$_DELEGATE_OUT" ;;
    *) echo "check-name-allocation: 占用校验自身失败（alloc --check-id rc=${_DELEGATE_RC}）" >&2; exit 2 ;;
  esac
fi

if [ -n "$CONFLICTS" ]; then STATUS="conflict"; fi

# ── 输出 ──
if [ "$JSON" = "1" ]; then
  _JSON_CONF=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    # 契约: conflicts[] 元素 = <label>:<短名> —— 去掉人类可读行附带的 " (全 ref)" 后缀
    line="${line%% (*)}"
    esc="${line//\\/\\\\}"; esc="${esc//\"/\\\"}"
    [ -n "$_JSON_CONF" ] && _JSON_CONF="${_JSON_CONF},"
    _JSON_CONF="${_JSON_CONF}\"${esc}\""
  done <<< "$CONFLICTS"
  printf '{"id":"%s","status":"%s","degraded":%s,"conflicts":[%s]}\n' \
    "${ID_NUM:+D${ID_NUM}}" "$STATUS" "$([ "$DEGRADED" = "1" ] && echo true || echo false)" "$_JSON_CONF"
else
  if [ "$STATUS" = "conflict" ]; then
    echo "❌ 冲突: D${ID_NUM} 不可用"
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      echo "   冲突位置: ${line}"
    done <<< "$CONFLICTS"
  else
    echo "✅ D${ID_NUM} 可用（可判定范围内未见占用，且命名一致）"
    [ "$DEGRADED" = "1" ] && echo "   ⚠️ 远端不可达，本结论仅覆盖可判定位置（见上 degraded 行）"
  fi
fi

[ "$STATUS" = "conflict" ] && exit 1
exit 0
