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
#   @output — 人类可读: "✅ …" / "❌ 冲突位置: <label>  <原文>"（label ∈ 6 个固定值）
#             · 委派占用面 5 值: task-state / origin-main / remote-branch / local-branch / worktree-name
#             · 本脚本自有面 2 值: naming（三元组命名不一致）/ brief-dup（CT-B: 同 D# ≥2 份 brief）
#             --json: {"id","status","degraded","conflicts":["<label>:<原文>",…]}
#             status ∈ free | conflict | invalid
#   @exit   — 0 = 一致且未被占
#             1 = 冲突（号在任一位置被占 **或** 三元组 D# 不一致 **或** 名中提不出 D#
#                 **或** 同 D# 被 ≥2 份 brief 用作任务身份）
#             2 = 校验器自身失败/输入非法（无参、--id 格式非法、选项缺值、未知选项、委派脚本缺失）
#   @degraded — ls-remote 不可达 → stderr `degraded: …` 显式可见 + 仍按可判定位置判定（绝不静默，
#             绝不因不可达而宣称"未占=通过"以外的结论——不可达时只报"可判定范围内未见占用"）
#   @error  — bash 全角标点紧贴变量一律用 ${VAR} 显式边界（D370 教训）
#
# 覆盖矩阵（由 tests/control-tower/check-name-allocation.test.sh 覆盖，D940-T2 写集）:
#   正常 — 三元组一致且号空闲 → rc=0
#   冲突 — 号被占（点名冲突位置原文）→ rc=1；命名不一致 → rc=1
#   冲突 — CT-B 同号: 同 D# 两份 brief → rc=1 + 点名两条路径（单份 → rc=0，判别性）
#   降级 — origin 不可达 → `degraded:` 可见 且 仍能给结论
#   边界 — 无参/坏号/缺值/未知选项 → rc=2
#
# @input 缝（CT-B）: SYNO_BRIEF_DIR 覆盖 brief 扫描目录；未设时取 TASK_STATE_DIR 所属仓库的
#   .claude/task-briefs（与 SYNO_TASK_STATE_DIR 同口径）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOC="$SCRIPT_DIR/alloc-task-id.sh"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"   # CT-B: brief 目录回退根（与 alloc 同口径: 脚本所属仓库）

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

# ── CT-B (D1023): 同号检测 — 同一 D# 被 ≥2 份 brief 用作任务身份 ⇒ 冲突（fail-closed，点名全部路径）──
# 缺口（改前实测）: 占用判定只认 5 类标签（alloc --check-id: task-state / origin-main /
#   remote-branch / local-branch / worktree-name），brief **明确不参与发号**
#   （alloc-task-id.sh:252「唯一占用表 = task-state/D*.json；brief 不参与发号」）
#   ⇒ 建 brief 复用已占号**无任何检测面**。实证: D1023 两份 brief 并存
#   （main 的 -D1023-commit-msg-decisions.md + 分支 #861 的 -D1023-ci-docsonly-whitelist.md），
#   #861 合并即撞车；改前 `--id D1023` 只报 worktree-name（缺口坐实）。
# 判据（任务身份 ≠ 文件名里的任意 D#）: 身份 = 日期前缀后的**第一个** D# ——
#   `YYYY-MM-DD[-_ ]D###…`。slug 里的交叉引用（如 -FIX-D572-）不算身份（后者只报 D578）。
# 已知取舍: 同一任务拆多份 brief（本仓既有实践，D593 等 30 个 D#）会被一并点名——文件名
#   无法区分「同任务子 brief」与「两任务撞号」，故 fail-closed 交人工消歧：漏判代价 = #861
#   型合并撞车（不可逆，占用表/审计全污染），误判代价 = 一次人工确认。实测存量见证据件 CT2-。
# 注入缝: SYNO_BRIEF_DIR（同 alloc 命名）；未设时取 TASK_STATE_DIR 所属仓库的 .claude/task-briefs。
_TS_DIR_FOR_BRIEF="${SYNO_TASK_STATE_DIR:-$ROOT/task-state}"
_TS_PARENT_FOR_BRIEF="$(cd "$_TS_DIR_FOR_BRIEF/.." 2>/dev/null && pwd || echo "$ROOT")"
BRIEF_DIR="${SYNO_BRIEF_DIR:-$_TS_PARENT_FOR_BRIEF/.claude/task-briefs}"
if [ -n "$ID_NUM" ] && [ -d "$BRIEF_DIR" ]; then
  _DUP_PATHS=""
  for _bf in "$BRIEF_DIR"/*.md; do
    [ -e "$_bf" ] || continue
    _bn="${_bf##*/}"
    _bf_date="${_bn:0:10}"
    case "$_bf_date" in
      [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
      *) continue ;;
    esac
    _bf_rest="${_bn:10}"
    _bf_rest="${_bf_rest#[-_ ]}"            # 剥日期与 D# 之间的一个分隔符
    case "${_bf_rest:0:1}" in
      D|d) ;;
      *) continue ;;
    esac
    _bf_rest="${_bf_rest:1}"
    _bf_num="${_bf_rest%%[!0-9]*}"          # 前导数字 = 卡号（非数字即边界）
    [ "$_bf_num" = "$ID_NUM" ] || continue
    _DUP_PATHS="${_DUP_PATHS}${_bf}
"
  done
  _DUP_N="$(printf '%s' "$_DUP_PATHS" | grep -c . || true)"
  if [ "${_DUP_N:-0}" -ge 2 ]; then
    while IFS= read -r _p; do
      [ -z "$_p" ] && continue
      _add "brief-dup" "$_p"
    done <<< "$_DUP_PATHS"
  fi
fi

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
