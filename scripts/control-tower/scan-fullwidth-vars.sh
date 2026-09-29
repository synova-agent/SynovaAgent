#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# scan-fullwidth-vars.sh — `$VAR` 紧贴全角标点 扫描器（D938）
#
# 背景: bash 在 UTF-8 locale 下把全角标点当变量名字符——`$BRIEF_FILE（填写后开工）`
#   被解析成变量名 `BRIEF_FILE<首字节>` → `set -u` 报 unbound variable；非 `set -u`
#   时变量取空 + 全角字符被吞掉首字节 → 输出乱码。D938 在 bash 3.2.57（macOS 控制塔
#   实际执行环境）逐字符实测: `（）：，。；、` 七类全角标点**全部**触发（ASCII `) : , . ;`
#   对照组全部正常）。
#
# 契约（铁律 47）:
#   @input  — CLI:
#       scan-fullwidth-vars.sh [--paths <f1,f2,…>] [--paths-file <f>] [--domain mac|win]
#                              [--json] [--help]
#     默认扫描 <repo>/scripts/**（find 枚举，含未跟踪文件——不是 git ls-files，
#       故工作树新增文件同样在网内）。`--paths` 逗号分隔（路径含逗号请改用 --paths-file，
#       一行一路径，`#` 开头与空行忽略）；目录自动展开、文件原样。
#     `--domain mac|win` 经 scripts/control-tower/check-ownership.py 过滤归属
#       → **Win 线可直接复用同一接口**（`--domain win`）。路径必须在仓库内，否则 fail-closed。
#   @output — stdout 文本（默认）或 JSON（--json，stdout 只有 JSON，告警走 stderr）:
#     三桶分类 + 计数（附「命令 / 模式 / 排除项 / 截至时刻 / locale」口径行）+ 域标签:
#       · 写集模式（给了 --paths/--paths-file）= 判红/绿那一行:
#           `本卡写集内 mac 域残留：N 处 / F 文件`
#       · 全量模式（默认 scripts/**）三段标签:
#           `mac 域：C 文件已清 / 违规 N 处 / F 文件`
#           `全 mac 域残余（scripts/ 半径内）：R 文件 / N 处违规 → 待新卡（号由 CTO 发，Mac 侧）`
#           `全 win 域残余（scripts/ 半径内）：R 文件 / N 处违规（另有 T 文件落「需专项定性」桶）→ 待 Win 侧卡`
#         **半径注记不可省**：默认半径 = scripts/**，**不含 tests/** 等其他树；
#           tests/** 另有存量（不在本卡半径内）→ 无注记会被误读成全仓口径。
#         残余文件 = **非注释命中行**的文件（纯注释命中在 shell/PowerShell 都无害，不算残余；
#         `.ps1` 命中落 triage 桶不计违规，但**计入**残余供 Win 侧专项定性）。
#         号一律**不由本工具起**（D# 只能经 alloc-task-id.sh 分配）。
#   @exit   — 0 = 扫描集内零违规；1 = 有违规（代码行）；2 = 扫描器自身失败
#             （参数非法 / 路径不存在 / 域过滤不可用 / grep rc≥2 / 扫描集为空）
#             **2 绝不与 0 混同**（fail-closed：未知一律判失败，不判绿）
#   @degraded — python 不可用: `--domain` 直接 exit 2（域过滤无法判定，不猜）；默认模式的
#             域标签显式降级（stderr ⚠ + 标签写「域统计不可用」），但**不静默**、不把未知当 0
#
# 三桶（`.ps1` 等非 POSIX shell 文件**不得直接判违规**——PowerShell 变量名语义不同，
#   误判即产出伪缺陷）:
#   【违规（代码行）】   POSIX shell 文件（.sh/.bash/.ksh/.zsh/.dash 或 sh 系 shebang）的非注释行
#   【注释行（无害）】   同上，但行首（允许前导空白）为 `#`
#   【需专项定性】       非 POSIX shell 文件（.ps1/.py/.ts/.md/.yml/…）——计数保留、不判违规
#
# 已知边界（不夸大能力 —— 工具是**文本级**判据）:
#   · 单引号字符串内的 `$VAR（` **字面量**同样会被计入「违规（代码行）」（典型: 生成该形态文本
#     的脚本、夹具/文档生成器）。scripts/** 内实测无此类；其他域出现时按「需专项定性」人工复核，
#     不要直接当缺陷（误报会喂噪声，噪声会让整条门禁被绕过）。
#   · 判断依据是「行首是否 `#`」+「文件是否 POSIX shell」，不解析引号语境（不引第三方解析器）。
#
# ⚠️ 可移植性（scripts/control-tower/PLATFORM-CHECKLIST.md）:
#   · **禁 grep -P**——BSD grep 无 `-P`，`grep -rnP … 2>/dev/null` 会静默失败成「0 命中」
#     = 假绿（D661/D664/D718 同族，D938 为第 7 次复发风险点）。本脚本用 `grep -E`，
#     且把 grep 的 rc≥2（模式非法/文件不可读）**显式判为自身失败 exit 2**，绝不 `|| true`。
#   · bash 3.2 兼容（macOS /bin/bash）：无 mapfile、无关联数组、无 ${x,,}；
#     空数组展开一律走 `${arr[@]+"${arr[@]}"}`（3.2 + `set -u` 下裸展开会报 unbound）。
#   · python 三级探测 python3→python→py（禁裸 python3）；输出经 `tr -d '\r'` 清 CRLF。
#   · 数字一律来自命令原始输出，不手写。
# ═══════════════════════════════════════════════════════════════════════════════
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SELF_REL="scripts/control-tower/scan-fullwidth-vars.sh"
OWNERSHIP_PY="$ROOT/scripts/control-tower/check-ownership.py"

# 检测形态: `$VAR` 紧贴全角标点（6 字符类，全部经 bash 3.2 实测确认触发）
FULLWIDTH_ALT='（|）|：|，|。|；|、'
PATTERN='\$[A-Za-z_][A-Za-z0-9_]*('"$FULLWIDTH_ALT"')'

EXIT_OK=0
EXIT_VIOLATION=1
EXIT_FAILED=2

_die() { echo "❌ scan-fullwidth-vars: $1" >&2; exit "$EXIT_FAILED"; }
_warn() { echo "⚠️  scan-fullwidth-vars: $1" >&2; }

_usage() {
  cat <<'USAGE'
scan-fullwidth-vars.sh — `$VAR` 紧贴全角标点 扫描器（D938）

用法:
  bash scripts/control-tower/scan-fullwidth-vars.sh [选项]

选项:
  --paths <f1,f2,…>     逗号分隔的路径集（文件或目录；目录递归展开）
  --paths-file <f>      从文件读路径集（一行一路径；忽略空行与 `#` 开头行）
  --domain mac|win      只扫该域文件（经 check-ownership.py 判定归属）
  --json                stdout 输出 JSON（告警仍走 stderr）
  -h, --help            本帮助

退出码:
  0 = 扫描集内零违规   1 = 有违规（代码行）   2 = 扫描器自身失败（不与 0 混同）

示例:
  bash scripts/control-tower/scan-fullwidth-vars.sh                 # 全 scripts/**
  bash scripts/control-tower/scan-fullwidth-vars.sh --domain mac    # Mac 域
  bash scripts/control-tower/scan-fullwidth-vars.sh --domain win --json
USAGE
}

# ── 参数解析 ──────────────────────────────────────────────────────────────────
PATHS_ARG=""
PATHS_FILE=""
DOMAIN=""
JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --paths)
      [ $# -ge 2 ] || _die "--paths 缺参数"
      PATHS_ARG="$2"; shift 2 ;;
    --paths-file)
      [ $# -ge 2 ] || _die "--paths-file 缺参数"
      PATHS_FILE="$2"; shift 2 ;;
    --domain)
      [ $# -ge 2 ] || _die "--domain 缺参数"
      DOMAIN="$2"; shift 2 ;;
    --json)
      JSON=1; shift ;;
    -h|--help)
      _usage; exit "$EXIT_OK" ;;
    *)
      _die "未知参数: $1（--help 看用法）" ;;
  esac
done
case "$DOMAIN" in
  ""|mac|win) ;;
  *) _die "--domain 只接受 mac|win，实得: $DOMAIN" ;;
esac

TMPD="$(mktemp -d)" || _die "mktemp 失败"
trap 'rm -rf "$TMPD"' EXIT

# ── python 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）────────────────────────
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c 'import sys' >/dev/null 2>&1; then
    PYBIN="$_c"; break
  fi
done

# ── 路径枚举 ──────────────────────────────────────────────────────────────────
_find_files() {
  find "$1" -type f \
    ! -name '.DS_Store' ! -name '*~' ! -name '*.swp' ! -name '*.swo' ! -name '*.orig' \
    ! -path '*/__pycache__/*' ! -path '*/.git/*' 2>/dev/null
}

_fw_open='（'  # 拼接用（避免本文件自身在「代码行」上出现被测形态）

_abs() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *)  printf '%s' "$ROOT/$1" ;;
  esac
}

CAND=()
if [ -n "$PATHS_ARG" ]; then
  _old_ifs="$IFS"; IFS=','
  for _e in $PATHS_ARG; do
    IFS="$_old_ifs"
    [ -n "$_e" ] || { IFS=','; continue; }
    _p="$(_abs "$_e")"
    if [ -d "$_p" ]; then
      while IFS= read -r _f; do [ -n "$_f" ] && CAND+=("$_f"); done < <(_find_files "$_p")
    elif [ -f "$_p" ]; then
      CAND+=("$_p")
    else
      _die "路径不存在: ${_e}（fail-closed，不静默跳过）"
    fi
    IFS=','
  done
  IFS="$_old_ifs"
fi

if [ -n "$PATHS_FILE" ]; then
  [ -f "$PATHS_FILE" ] || _die "--paths-file 不存在: $PATHS_FILE"
  while IFS= read -r _e || [ -n "$_e" ]; do
    _e="$(printf '%s' "$_e" | tr -d '\r')"
    case "$_e" in ''|'#'*) continue ;; esac
    _p="$(_abs "$_e")"
    if [ -d "$_p" ]; then
      while IFS= read -r _f; do [ -n "$_f" ] && CAND+=("$_f"); done < <(_find_files "$_p")
    elif [ -f "$_p" ]; then
      CAND+=("$_p")
    else
      _die "paths-file 内路径不存在: $_e"
    fi
  done < "$PATHS_FILE"
fi

SCOPE_DESC="默认 scripts/**"
if [ -z "$PATHS_ARG" ] && [ -z "$PATHS_FILE" ]; then
  while IFS= read -r _f; do [ -n "$_f" ] && CAND+=("$_f"); done < <(_find_files "$ROOT/scripts")
else
  SCOPE_DESC="--paths/--paths-file 指定"
fi

FILES=()
while IFS= read -r _l; do [ -n "$_l" ] && FILES+=("$_l"); done \
  < <(printf '%s\n' ${CAND[@]+"${CAND[@]}"} | LC_ALL=C sort -u)

[ "${#FILES[@]}" -gt 0 ] || _die "扫描集为空（无文件可扫 —— 判失败，不判绿）"

# ── 域过滤（check-ownership.py）───────────────────────────────────────────────
_rels() {  # stdin: 绝对路径 → stdout: 仓库相对路径；域外路径原样输出
  while IFS= read -r _p; do
    [ -n "$_p" ] || continue
    case "$_p" in
      "$ROOT"/*) printf '%s\n' "${_p#"$ROOT"/}" ;;
      *)         printf '%s\n' "$_p" ;;
    esac
  done
}

# 归属查询: stdin 仓库相对路径 → stdout "<owner>\t<path>"（3 态退出码，非 0/1 即失败）
_owners() {
  [ -n "$PYBIN" ] || return 9
  local _in=() _p
  while IFS= read -r _p; do [ -n "$_p" ] && _in+=("$_p"); done
  [ "${#_in[@]}" -gt 0 ] || return 9
  [ -f "$OWNERSHIP_PY" ] || return 9
  local _out _rc
  _out="$("$PYBIN" "$OWNERSHIP_PY" ${_in[@]+"${_in[@]}"} 2>"$TMPD/own.err")"
  _rc=$?
  case "$_rc" in
    0|1) ;;  # 1 = 跨域/越域但行照打印（本处未用 --owner，属正常）—— 不当失败
    *)   cat "$TMPD/own.err" >&2
         return 9 ;;
  esac
  printf '%s\n' "$_out" | awk '/^(mac|win|k3)[[:space:]]/{o=$1; sub(/^(mac|win|k3)[[:space:]]+/,""); print o "\t" $0}'
  return 0
}

SCOPE_DOMAIN_DESC="无（全量）"
if [ -n "$DOMAIN" ]; then
  [ -n "$PYBIN" ] || _die "--domain 需要 python（check-ownership.py）—— 不可用时判失败，不猜域"
  printf '%s\n' ${FILES[@]+"${FILES[@]}"} | _rels > "$TMPD/rel_all.txt"
  _outside="$(grep -v "^$ROOT/" "$TMPD/rel_all.txt" | grep -c '^/' || true)"
  [ "$_outside" = "0" ] || _die "--domain 下路径必须在仓库内（域外 $_outside 个 —— 无法判域，fail-closed）"
  _owners < "$TMPD/rel_all.txt" > "$TMPD/own_all.txt" || _die "域过滤失败（check-ownership.py 不可用或输出异常）"
  awk -F'\t' -v d="$DOMAIN" '$1==d{print $2}' "$TMPD/own_all.txt" > "$TMPD/rel_keep.txt"
  DOM_FILES=()
  while IFS= read -r _r; do [ -n "$_r" ] && DOM_FILES+=("$ROOT/$_r"); done < "$TMPD/rel_keep.txt"
  [ "${#DOM_FILES[@]}" -gt 0 ] || _die "--domain $DOMAIN 在扫描集内零文件（fail-closed）"
  FILES=(${DOM_FILES[@]+"${DOM_FILES[@]}"})
  SCOPE_DOMAIN_DESC="$DOMAIN"
fi

# ── 扫描（grep -E；rc≥2 显式判失败）──────────────────────────────────────────
grep -nHE -I -e "$PATTERN" ${FILES[@]+"${FILES[@]}"} > "$TMPD/hits.txt" 2>"$TMPD/grep.err"
GREP_RC=$?
case "$GREP_RC" in
  0) : ;;                      # 有命中
  1) : > "$TMPD/hits.txt" ;;   # 零命中 = 合法结果
  *) cat "$TMPD/grep.err" >&2
     _die "grep 执行失败（rc=${GREP_RC}）—— 判自身失败，绝不当作「0 命中」" ;;
esac

# ── 三桶分类 ─────────────────────────────────────────────────────────────────
_is_posix_shell() {
  local f="$1" base ext first
  base="${f##*/}"
  case "$base" in
    *.*) ext="${base##*.}" ;;
    *)   ext="" ;;
  esac
  case "$ext" in
    sh|bash|ksh|zsh|dash) return 0 ;;
    "")
      first="$(sed -n '1p' "$f" 2>/dev/null || echo "")"
      case "$first" in
        '#!'*'/sh'*|'#!'*'/bash'*|'#!'*'/ksh'*|'#!'*'/zsh'*|'#!'*'/dash'*|'#!'*'env sh'*|'#!'*'env bash'*) return 0 ;;
      esac
      return 1 ;;
    *) return 1 ;;
  esac
}

: > "$TMPD/viol.txt"; : > "$TMPD/comm.txt"; : > "$TMPD/triage.txt"
while IFS= read -r _ln; do
  [ -n "$_ln" ] || continue
  _rest="${_ln#*:}"; _text="${_rest#*:}"; _f="${_ln%%:*}"
  if ! _is_posix_shell "$_f"; then
    printf '%s\n' "$_ln" >> "$TMPD/triage.txt"
  elif printf '%s' "$_text" | grep -qE '^[[:space:]]*#'; then
    printf '%s\n' "$_ln" >> "$TMPD/comm.txt"
  else
    printf '%s\n' "$_ln" >> "$TMPD/viol.txt"
  fi
done < "$TMPD/hits.txt"

_nlines() { [ -f "$1" ] && wc -l < "$1" | tr -d ' \r' || echo 0; }
_nfiles() {
  [ -s "$1" ] || { echo 0; return; }
  sed 's/:.*$//' "$1" | LC_ALL=C sort -u | wc -l | tr -d ' \r'
}
# 「已清」= 命中但零违规的文件数（注释桶里剔除同时有违规的文件——否则 install-hooks.sh
#   这种「同行文件既有注释命中又有违规命中」会被算两次，标签虚高）
_nclean() {
  local _b="$1"
  [ -s "$_b" ] || { echo 0; return; }
  [ -s "$TMPD/viol.txt" ] || { sed 's/:.*$//' "$_b" | LC_ALL=C sort -u | wc -l | tr -d ' \r'; return; }
  comm -13 <(sed 's/:.*$//' "$TMPD/viol.txt" | LC_ALL=C sort -u) \
           <(sed 's/:.*$//' "$_b" | LC_ALL=C sort -u) | wc -l | tr -d ' \r'
}

N_VIOL="$(_nlines "$TMPD/viol.txt")";        F_VIOL="$(_nfiles "$TMPD/viol.txt")"
N_COMM="$(_nlines "$TMPD/comm.txt")";        F_COMM="$(_nfiles "$TMPD/comm.txt")"
N_TRIAGE="$(_nlines "$TMPD/triage.txt")";    F_TRIAGE="$(_nfiles "$TMPD/triage.txt")"
N_FILES="${#FILES[@]}"

# 残余口径（供 CTO 标签 `全 <域> 域残余：N 文件` 用）: **非注释命中行**的文件数。
# 为什么不用「违规文件数」: .ps1 命中落 triage 桶（不计违规）但仍需 Win 侧专项处理；
# 纯注释命中（`# …$VAR（…`）在 shell / PowerShell 里都无害 → 不算残余。
grep -v -E '^[^:]*:[0-9]+:[[:space:]]*#' "$TMPD/hits.txt" > "$TMPD/resid.txt" || true

# ── 域标签 ───────────────────────────────────────────────────────────────────
# 标签口径: 已清=命中但零违规的文件数 ｜ 违规=代码行（处 / 文件）｜ 残余文件=非注释命中文件数
DOM_STATUS="ok"      # ok | limited（--domain 限定）| unavailable（无 python/域外）
MAC_CLEAN=0; MAC_VIOL=0; MAC_VF=0; MAC_RES=0
WIN_CLEAN=0; WIN_VIOL=0; WIN_VF=0; WIN_RES=0
WIN_TRI=0; N_OUTSIDE_HITS=0
LABEL_REASON=""
WRITESET_MODE=0
[ -n "$PATHS_ARG" ] || [ -n "$PATHS_FILE" ] && WRITESET_MODE=1

# _cnt <bucketfile> <abs path> → 该文件在该桶的命中行数（CRLF 已清）
_cnt() { grep -cF "$2:" "$1" 2>/dev/null | tr -d ' \r' || true; }

if [ -n "$DOMAIN" ]; then
  # 域模式下扫描集**就是**该域 → 统计直接由三桶派生（不得留 0，否则标签是假绿）
  DOM_STATUS="limited"; LABEL_REASON="--domain $DOMAIN 限定"
  if [ "$DOMAIN" = "mac" ]; then
    MAC_CLEAN="$(_nclean "$TMPD/comm.txt")"; MAC_VIOL="$N_VIOL"
    MAC_VF="$F_VIOL"; MAC_RES="$(_nfiles "$TMPD/resid.txt")"
  else
    WIN_CLEAN="$(_nclean "$TMPD/comm.txt")"; WIN_VIOL="$N_VIOL"
    WIN_VF="$F_VIOL"; WIN_RES="$(_nfiles "$TMPD/resid.txt")"
    WIN_TRI="$F_TRIAGE"
  fi
elif [ -z "$PYBIN" ]; then
  DOM_STATUS="unavailable"; LABEL_REASON="python 不可用"
else
  cat "$TMPD/viol.txt" "$TMPD/comm.txt" "$TMPD/triage.txt" 2>/dev/null | sed 's/:.*$//' | LC_ALL=C sort -u \
    > "$TMPD/abs_hits.txt"
  # 域外命中（--paths 指到仓库外）：无域归属，不得落 `**` 兜底被判 win（假归属）
  grep "^$ROOT/" "$TMPD/abs_hits.txt" > "$TMPD/abs_inside.txt" || true
  N_OUTSIDE_HITS="$(grep -c -v "^$ROOT/" "$TMPD/abs_hits.txt" 2>/dev/null || true)"
  N_OUTSIDE_HITS="$(printf '%s' "$N_OUTSIDE_HITS" | tr -d ' \r')"
  _rels < "$TMPD/abs_inside.txt" > "$TMPD/rel_hits.txt"
  if [ ! -s "$TMPD/abs_hits.txt" ]; then
    # **零命中**：域统计无意义但不是降级（三桶计数本就全 0）→ 不打告警，标签照常报 0
    #   （此前误走 unavailable 分支 → 绿腿上打「命中文件全在仓库外」假告警，制造噪音）
    DOM_STATUS="ok"
  elif [ ! -s "$TMPD/rel_hits.txt" ]; then
    DOM_STATUS="unavailable"; LABEL_REASON="命中文件全在仓库外（无域归属）"
  elif _owners < "$TMPD/rel_hits.txt" > "$TMPD/own_hits.txt"; then
    # 逐域统计（mac / win）
    for _d in mac win; do
      _viol_files=0; _clean_files=0; _viol_lines=0; _res_files=0; _tri_files=0
      while IFS= read -r _r; do
        [ -n "$_r" ] || continue
        _af="$ROOT/$_r"
        _v="$(_cnt "$TMPD/viol.txt" "$_af")"; _v="${_v:-0}"
        _t="$(_cnt "$TMPD/triage.txt" "$_af")"; _t="${_t:-0}"
        _rs="$(_cnt "$TMPD/resid.txt" "$_af")"; _rs="${_rs:-0}"
        [ "$_rs" -gt 0 ] && _res_files=$((_res_files + 1))
        [ "$_t" -gt 0 ] && _tri_files=$((_tri_files + 1))
        if [ "$_v" -gt 0 ]; then
          _viol_files=$((_viol_files + 1)); _viol_lines=$((_viol_lines + _v))
        elif [ "$_t" -gt 0 ]; then
          :  # 需专项定性（非 POSIX shell）→ 不计入「已清」
        else
          _clean_files=$((_clean_files + 1))
        fi
      done < <(awk -F'\t' -v d="$_d" '$1==d{print $2}' "$TMPD/own_hits.txt")
      if [ "$_d" = "mac" ]; then
        MAC_CLEAN="$_clean_files"; MAC_VIOL="$_viol_lines"; MAC_VF="$_viol_files"; MAC_RES="$_res_files"
      else
        WIN_CLEAN="$_clean_files"; WIN_VIOL="$_viol_lines"; WIN_VF="$_viol_files"
        WIN_RES="$_res_files"; WIN_TRI="$_tri_files"
      fi
    done
  else
    DOM_STATUS="unavailable"; LABEL_REASON="check-ownership.py 不可用"
  fi
fi

# ── 输出 ─────────────────────────────────────────────────────────────────────
_now_iso() { date -Iseconds 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ; }
CMD_DISPLAY=""
[ -n "$PATHS_ARG" ] && CMD_DISPLAY="$CMD_DISPLAY --paths $PATHS_ARG"
[ -n "$PATHS_FILE" ] && CMD_DISPLAY="$CMD_DISPLAY --paths-file $PATHS_FILE"
[ -n "$DOMAIN" ] && CMD_DISPLAY="$CMD_DISPLAY --domain $DOMAIN"
[ "$JSON" = "1" ] && CMD_DISPLAY="$CMD_DISPLAY --json"
STAMP="$(_now_iso)"

_rel() {
  case "$1" in
    "$ROOT"/*) printf '%s' "${1#"$ROOT"/}" ;;
    *)         printf '%s' "$1" ;;
  esac
}

_dump_bucket() {  # <file> <缩进>
  local f="$1" ind="$2" abs
  [ -s "$f" ] || return 0
  while IFS= read -r _ln; do
    [ -n "$_ln" ] || continue
    abs="${_ln%%:*}"; printf '%s%s:%s\n' "$ind" "$(_rel "$abs")" "${_ln#*:}"
  done < "$f"
}

_json_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g' -e 's/\t/\\t/g'; }

if [ "$JSON" = "1" ]; then
  _jarr() {  # <file> → JSON 数组
    local f="$1" first=1 abs rest num text
    [ -s "$f" ] || { printf '[]'; return; }
    printf '['
    while IFS= read -r _ln; do
      [ -n "$_ln" ] || continue
      abs="${_ln%%:*}"; rest="${_ln#*:}"; num="${rest%%:*}"; text="${rest#*:}"
      [ "$first" = "1" ] || printf ','
      first=0
      printf '{"file":"%s","line":%s,"text":"%s"}' \
        "$(_json_esc "$(_rel "$abs")")" "$num" "$(_json_esc "$text")"
    done < "$f"
    printf ']'
  }
  printf '{\n'
  printf '  "tool": "scan-fullwidth-vars.sh",\n'
  printf '  "card": "D938",\n'
  printf '  "generated_at": "%s",\n' "$(_json_esc "$STAMP")"
  printf '  "command": "%s",\n' "$(_json_esc "bash $SELF_REL $CMD_DISPLAY")"
  printf '  "pattern": "%s",\n' "$(_json_esc "$PATTERN")"
  printf '  "exclusions": "%s",\n' "$(_json_esc "非 POSIX shell 文件归 needs_triage，不计违规")"
  printf '  "scope": {"desc":"%s","domain":"%s","files_scanned":%s},\n' \
    "$(_json_esc "$SCOPE_DESC")" "$(_json_esc "$SCOPE_DOMAIN_DESC")" "$N_FILES"
  printf '  "counts": {"violations":%s,"violation_files":%s,"comments":%s,"comment_files":%s,"needs_triage":%s,"triage_files":%s},\n' \
    "$N_VIOL" "$F_VIOL" "$N_COMM" "$F_COMM" "$N_TRIAGE" "$F_TRIAGE"
  if [ "$DOM_STATUS" = "ok" ] || [ "$DOM_STATUS" = "limited" ]; then
    printf '  "domains": {"mac":{"clean_files":%s,"violation_lines":%s,"violation_files":%s,"residual_files":%s},"win":{"clean_files":%s,"violation_lines":%s,"violation_files":%s,"residual_files":%s,"triage_files":%s},"outside_repo_hits":%s},\n' \
      "$MAC_CLEAN" "$MAC_VIOL" "$MAC_VF" "$MAC_RES" "$WIN_CLEAN" "$WIN_VIOL" "$WIN_VF" "$WIN_RES" "$WIN_TRI" "$N_OUTSIDE_HITS"
  else
    printf '  "domains": {"status":"%s","reason":"%s"},\n' "$DOM_STATUS" "$(_json_esc "$LABEL_REASON")"
  fi
  printf '  "buckets": {"violations":' ; _jarr "$TMPD/viol.txt"; printf ',\n'
  printf '              "comments":' ; _jarr "$TMPD/comm.txt"; printf ',\n'
  printf '              "needs_triage":' ; _jarr "$TMPD/triage.txt"; printf '}\n'
  printf '}\n'
else
  echo "═══ scan-fullwidth-vars（D938）— \$VAR 紧贴全角标点 扫描 ═══"
  echo "口径: 命令=bash $SELF_REL$CMD_DISPLAY"
  echo "      模式=$PATTERN"
  echo "      排除=无（非 POSIX shell 文件归「需专项定性」，不计违规）"
  echo "      截至=$STAMP ｜ locale=${LC_ALL:-<unset>}"
  echo "扫描集: $N_FILES 文件（${SCOPE_DESC}）｜ 域过滤=$SCOPE_DOMAIN_DESC"
  echo "────────────────────────────────────────────────────────────"
  echo "【违规（代码行）】$N_VIOL 处 / $F_VIOL 文件"
  _dump_bucket "$TMPD/viol.txt" "  "
  echo "【注释行（无害）】$N_COMM 处 / $F_COMM 文件"
  _dump_bucket "$TMPD/comm.txt" "  "
  echo "【需专项定性】$N_TRIAGE 处 / $F_TRIAGE 文件（非 POSIX shell，语义不同 → 不计违规）"
  _dump_bucket "$TMPD/triage.txt" "  "
  echo "────────────────────────────────────────────────────────────"
  echo "标签口径: 已清=命中但零违规的文件数 ｜ 违规=代码行（处 / 文件）｜ 残余=非注释命中文件数"
  if [ "$WRITESET_MODE" = "1" ]; then
    # 写集模式（--paths/--paths-file 给定路径集 = 本卡写集）→ 这是**判红/绿**的那一行
    if [ -n "$DOMAIN" ]; then
      echo "本卡写集内 ${DOMAIN} 域残留：$N_VIOL 处 / $F_VIOL 文件"
    else
      echo "本卡写集内残留：$N_VIOL 处 / $F_VIOL 文件"
    fi
  fi
  case "$DOM_STATUS" in
    ok)
      echo "mac 域：$MAC_CLEAN 文件已清 / 违规 $MAC_VIOL 处 / $MAC_VF 文件"
      echo "win 域：$WIN_RES 文件待 <Win 侧新卡>（违规 $WIN_VIOL 处 / $WIN_VF 文件）"
      if [ "$WRITESET_MODE" = "0" ]; then
        # CTO 要求的残余标签。**半径注记必须留**：默认半径 = scripts/**（不含 tests/**）；
        # 不加注记会被误读为全仓口径（tests/** 另有存量，不在本卡半径内）。号由 CTO 发。
        echo "全 mac 域残余（scripts/ 半径内）：$MAC_RES 文件 / $MAC_VIOL 处违规 → 待新卡（号由 CTO 发，Mac 侧）"
        echo "全 win 域残余（scripts/ 半径内）：$WIN_RES 文件 / $WIN_VIOL 处违规（另有 $WIN_TRI 文件落「需专项定性」桶：非 POSIX shell，不计违规）→ 待 Win 侧卡"
      else
        echo "（--paths 给定路径集 = 写集模式：不打印「全 X 域残余」标签 —— 防把子集数字挂上全域名义）"
      fi
      [ "${N_OUTSIDE_HITS:-0}" -gt 0 ] && echo "域外文件：$N_OUTSIDE_HITS 文件命中（不在仓库内 → 无域归属，不计入 mac/win 标签）"
      ;;
    limited)
      # 写集模式下扫描集 = 调用方给的路径集（**不是全域**）→ 只报写集标签，
      # 免得把写集数字挂上「全 mac 域残余」的名字（那是假陈述）。
      if [ "$DOMAIN" = "mac" ]; then
        echo "mac 域：$MAC_CLEAN 文件已清 / 违规 $MAC_VIOL 处 / $MAC_VF 文件"
        [ "$WRITESET_MODE" = "0" ] && echo "全 mac 域残余（scripts/ 半径内）：$MAC_RES 文件 / $MAC_VIOL 处违规（本跑已限定 --domain mac）"
        echo "win 域：未扫描（${LABEL_REASON}）"
      else
        echo "mac 域：未扫描（${LABEL_REASON}）"
        echo "win 域：$WIN_RES 文件待 <Win 侧新卡>（违规 $WIN_VIOL 处 / $WIN_VF 文件）"
        [ "$WRITESET_MODE" = "0" ] && echo "全 win 域残余（scripts/ 半径内）：$WIN_RES 文件 / $WIN_VIOL 处违规（另有 $WIN_TRI 文件落「需专项定性」桶：非 POSIX shell，不计违规）→ 待 Win 侧卡"
      fi
      ;;
    *)
      _warn "域统计不可用（${LABEL_REASON}）—— 标签降级，违规判定不受影响（不静默）"
      echo "mac 域：域统计不可用（${LABEL_REASON}）"
      echo "win 域：域统计不可用（${LABEL_REASON}）"
      ;;
  esac
  if [ "$N_VIOL" -gt 0 ]; then
    echo "退出码: 1（有违规，须修）"
  else
    echo "退出码: 0（扫描集内零违规）"
  fi
fi

[ "$N_VIOL" -gt 0 ] && exit "$EXIT_VIOLATION"
exit "$EXIT_OK"
