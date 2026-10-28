#!/bin/bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gate-assert.sh — 判据自检共享件：`ga_run` 三态归一 ＋ 判据故障识别（#1096 · W6）
#
# 设计哲学（一句）: **判据的退出码只有三种结论；看不懂的码一律算「判据故障」，绝不算「通过」。**
#
# 契约（铁律 47 / C1）:
#   @usage   source scripts/control-tower/gate-assert.sh
#            ga_run "<判据名>" -- <命令...>                     # 包装一次判据执行（自有进程，不 eval）
#            bash scripts/control-tower/gate-assert.sh --selfcheck    # 判别力自检（真 spawn 夹具，9 判定点）
#            SYNO_GA_DRY=1 bash scripts/control-tower/gate-assert.sh  # 归一表自检（零 spawn，<1s）
#            bash scripts/control-tower/gate-assert.sh --table        # 打印归一真值表
#            bash scripts/control-tower/gate-assert.sh --help
#   @input   <判据名> 任意非空字符串（用于 stderr 点名；禁含换行）｜ <命令...> 任意可执行命令
#            SYNO_GA_DRY=1    入口自检开关：只验「原始码 → 三态」纯映射，不执行任何判据
#            （若被**导出**后仍在 ga_run 里存在 ⇒ ga_run fail-closed 返回 2：干跑不是通过）
#   @output  stdout = 被测判据自身的 stdout **原样透传**（本库不重排、不捕获、不吞）
#            stderr = 每判据一行归一点名 `[ga] <判据名>: <通过|真红|判据自身失败|判据故障>（原码=<code>）`
#                     ＋ 判据故障时**必打** `判据故障: <code> — <判据名>（<原因>）`
#   @exit    0 = 判据通过 ｜ 1 = 判据真红 ｜ 2 = 判据故障/判据自身失败/用法错（fail-closed）
#            🔴 三态铁律：**2 绝不等于通过**；`0/1/2` 之外的一切退出码（含 126/127/128/137）
#            一律归 2，**绝不当 0**（128 被当通过的后果 = 被 SIGILL/信号杀死的判据变成绿灯）。
#   @degraded 无静默降级——任何「看不懂」的退出码都升级为判据故障(2)并打 `判据故障: <code>`；
#            `SYNO_GA_DRY=1` 下 `ga_run` 不执行判据 ⇒ 打 `判据故障: DRY` 并返回 2
#   @error   code ∈ {E_USAGE（缺判据名/缺命令/未知参数）, E_CMD_NOT_FOUND(127),
#                   E_NONWHITELIST(其余码：126 不可执行／128 非法退出参数／137 SIGKILL／任意其它)}
#            首 token 不存在 ⇒ `判据故障: 127 — <判据名>（命令不存在: <cmd>）`
#
# 归一真值表（唯一真源 = `ga_normalize_code`；`--table` 打印的就是它，禁在别处写第二份 case）:
#   原始码   归一二态   语义
#   ───────  ────────  ──────────────────────────────────────────────────────────
#   0        0         通过
#   1        1         真红（判据发现了真问题）
#   2        2         判据自身失败（既有语义，原样透传；不打「判据故障」）
#   126      2         判据故障（不可执行／权限）
#   127      2         判据故障（命令不存在；本库另有前置探测，同一结论）
#   128      2         判据故障（非法退出参数 —— 🔴 本行是变异点，改 0 即「128 当通过」）
#   137      2         判据故障（被 SIGKILL；信号量语义 == 0 ⇒ 判据没跑完）
#   其它     2         判据故障（白名单外码一律不猜；拒绝「看着像失败 ⇒ 当通过」）
#
# 已知限制（做不到什么 —— 禁读成「已检测」）:
#   1. **看不见被 `|| true` / `2>/dev/null` 吞掉的错**：判据内部自行吞错后返回 0，本库无从分辨
#      （见 docs/authority/gate-pitfalls.md 坑 5）。本库自身**执行行**禁用 `|| true`（配对测试断言）。
#   2. **`set -e` 调用方必须自己接住非零返回**：本库不替你吞错 ⇒ 在 `set -e` 下写
#      `ga_run ... || rc=$?`；否则 shell 按 `set -e` 退出（那是调用方语法问题，不是本库降级）。
#   3. **不判判据语义**：只归一退出码；「判据是否真有判别力」由配对测试的改坏必红证明（CT-40）。
#   4. **`SYNO_GA_DRY=1` 只证归一表**：它验不到真实进程的 spawn 路径（那由 `--selfcheck` 验）。
#   5. **信号语义不可恢复**：bash 报 137 时无法区分「判据自己 exit 137」与「被判 OOM/被杀」，
#      两者都归 2 —— 方向是 fail-closed，不冒充红/绿。
#   6. **不支持 `VAR=x cmd` 形式的环境变量前缀**：首 token 就是命令名（要传环境用 `env VAR=x cmd`）。
#   7. **不做命令存在性的「可用性」探测**（D328 P1-1 的反面）：`command -v` 只证存在；损坏 shim
#      要到执行时才暴露（退出码走本库归一 ⇒ 仍是 2，不会假绿）。
#
# 结构（Source map）:
#   段                职责
#   ───────────────  ────────────────────────────────────────────────────────────
#   ① 头部契约       本段（@usage/@input/@output/@exit/@degraded/@error/已知限制）
#   ② 归一引擎       ga_normalize_code：原始码 → 0|1|2（**唯一真源**，禁旁路）
#   ③ 判据执行       ga_run：前置探测 ＋ 执行 ＋ 归一点名 ＋ stderr `判据故障: <code>`
#   ④ 自检入口       --selfcheck（真 spawn 夹具）／SYNO_GA_DRY=1（纯归一表）／--table
# ═══════════════════════════════════════════════════════════════════════════════

GA_LIB_VERSION="1.0.0"
GA_LAST_NAME=""
GA_LAST_CODE=""

# ── ② 归一引擎（唯一真源；任何调用方要三态都调本函数，禁抄第二份 case）──────────────
# 输入: $1 = 原始退出码（缺省/空 ⇒ 判据故障语义）
# 输出: stdout 单个数字 0|1|2
ga_normalize_code() {
  case "${1:-}" in
    0) printf '0\n' ;;
    1) printf '1\n' ;;
    2) printf '2\n' ;;
    126) printf '2\n' ;;
    127) printf '2\n' ;;
    128) printf '2\n' ;;   # 🔴 变异点（改坏即红）：本行改成 0 ⇒ 128 被当成「通过」（配对测试④必红）
    137) printf '2\n' ;;
    *) printf '2\n' ;;
  esac
}

# ── ③ 判据执行 ─────────────────────────────────────────────────────────────────
# 命令是否可调用：含路径分隔符 ⇒ 探文件可执行位；否则 command -v（含函数/builtin/别名）
# 注意: 只探「存在」不探「可用」——可用性由真实执行 + 归一承担（已知限制 7）
ga_cmd_available() {
  local _ga_c="${1:-}"
  [ -n "$_ga_c" ] || return 1
  case "$_ga_c" in
    */*|*\\*) [ -x "$_ga_c" ] ;;
    *) command -v "$_ga_c" >/dev/null 2>&1 ;;
  esac
}

# ga_run <判据名> -- <命令...>
# 返回: 0 通过 ｜ 1 真红 ｜ 2 判据故障/自身失败/用法错
ga_run() {
  local _ga_name="${1:-}"
  if [ "$#" -gt 0 ]; then shift; fi
  if [ "${1:-}" = "--" ]; then shift; fi

  if [ -z "$_ga_name" ]; then
    printf '用法错误: 缺判据名（用法: ga_run "<判据名>" -- <命令...>）\n' >&2
    return 2
  fi
  if [ "$#" -eq 0 ]; then
    printf '用法错误: 判据 %s 未给命令（用法: ga_run "<判据名>" -- <命令...>）\n' "$_ga_name" >&2
    return 2
  fi
  if [ "${SYNO_GA_DRY:-0}" = "1" ]; then
    printf '判据故障: DRY — %s（SYNO_GA_DRY=1 只跑归一表自检，不执行判据；干跑不是通过）\n' "$_ga_name" >&2
    return 2
  fi

  local _ga_cmd="$1" _ga_rc=0 _ga_verdict=""
  if ! ga_cmd_available "$_ga_cmd"; then
    GA_LAST_NAME="$_ga_name"
    GA_LAST_CODE="127"
    printf '判据故障: 127 — %s（命令不存在: %s）\n' "$_ga_name" "$_ga_cmd" >&2
    return 2
  fi

  # 🔴 执行行：**禁用 `|| true`**（吞掉故障 = 把「判据故障」洗成「通过」；配对测试断言本行无 ||）
  if "$@"; then
    _ga_rc=0
  else
    _ga_rc=$?
  fi

  GA_LAST_NAME="$_ga_name"
  GA_LAST_CODE="$_ga_rc"
  _ga_verdict="$(ga_normalize_code "$_ga_rc")"
  case "$_ga_verdict" in
    0|1|2) : ;;
    *) _ga_verdict=2 ;;   # 归一函数被改坏/外来实现时兜底：绝不放行
  esac

  if [ "$_ga_verdict" = "2" ] && [ "$_ga_rc" != "2" ]; then
    printf '判据故障: %s — %s（非白名单退出码，按 fail-closed 归 2；绝不归 0）\n' "$_ga_rc" "$_ga_name" >&2
  fi
  case "$_ga_verdict" in
    0) printf '[ga] %s: 通过（原码=0）\n' "$_ga_name" >&2 ;;
    1) printf '[ga] %s: 真红（原码=1）\n' "$_ga_name" >&2 ;;
    *)
      if [ "$_ga_rc" = "2" ]; then
        printf '[ga] %s: 判据自身失败（原码=2）\n' "$_ga_name" >&2
      else
        printf '[ga] %s: 判据故障（原码=%s）\n' "$_ga_name" "$_ga_rc" >&2
      fi
      ;;
  esac
  return "$_ga_verdict"
}

# ── ④ 自检入口 ─────────────────────────────────────────────────────────────────
ga_print_table() {
  printf '原始码\t三态\t语义\n'
  printf '0\t0\t通过\n'
  printf '1\t1\t真红\n'
  printf '2\t2\t判据自身失败\n'
  printf '126\t2\t判据故障（不可执行/权限）\n'
  printf '127\t2\t判据故障（命令不存在）\n'
  printf '128\t2\t判据故障（非法退出参数；改 0 = 128 当通过）\n'
  printf '137\t2\t判据故障（SIGKILL）\n'
  printf '其它\t2\t判据故障（白名单外码一律不猜）\n'
}

ga_usage() {
  cat <<'USAGE'
用法:
  source scripts/control-tower/gate-assert.sh
  ga_run "<判据名>" -- <命令...>      # 0 通过 ｜ 1 真红 ｜ 2 判据故障/自身失败/用法错

  bash scripts/control-tower/gate-assert.sh --selfcheck   # 判别力自检（真 spawn 夹具）
  SYNO_GA_DRY=1 bash scripts/control-tower/gate-assert.sh # 归一表自检（零 spawn）
  bash scripts/control-tower/gate-assert.sh --table       # 打印归一真值表
  bash scripts/control-tower/gate-assert.sh --help

🔴 0/1/2 之外的退出码（126/127/128/137/…）一律归 2（判据故障），绝不当 0。
USAGE
}

# 纯归一表自检（零 spawn；SYNO_GA_DRY=1 / --selfcheck 且 DRY=1 时使用）
ga_dry_selfcheck() {
  local _pass=0 _fail=0 _c="" _want="" _got="" _pair=""
  for _pair in "0:0" "1:1" "2:2" "126:2" "127:2" "128:2" "137:2" "42:2" "255:2"; do
    _c="${_pair%%:*}"
    _want="${_pair##*:}"
    _got="$(ga_normalize_code "$_c")"
    if [ "$_got" = "$_want" ]; then
      printf '  ✅ 归一 %s ⇒ %s\n' "$_c" "$_got"
      _pass=$((_pass + 1))
    else
      printf '  ❌ 归一 %s ⇒ %s（期望 %s）\n' "$_c" "$_got" "$_want"
      _fail=$((_fail + 1))
    fi
  done
  # 🔴 关键判据单独再断言一次（防「其它分支兜底」把 128 一起洗白）
  if [ "$(ga_normalize_code 128)" = "0" ]; then
    printf '  ❌ 关键判据: 128 被归成 0（判据故障被当成通过）\n'
    _fail=$((_fail + 1))
  else
    printf '  ✅ 关键判据: 128 ≠ 0（判据故障不被洗成通过）\n'
    _pass=$((_pass + 1))
  fi
  if [ "$_fail" -eq 0 ]; then
    printf 'SELFCHECK(DRY): OK %s/%s\n' "$_pass" "$_pass"
    return 0
  fi
  printf 'SELFCHECK(DRY): FAIL %s 失败（%s 通过）\n' "$_fail" "$_pass"
  return 1
}

# 真 spawn 自检（--selfcheck）：夹具命令覆盖 0/1/2/126/127/128/137/其它/命令不存在
ga_selfcheck() {
  local _pass=0 _fail=0
  _ga_case() { # <label> <期望三态> <期望 stderr 点名码|-表示断言无判据故障> <命令...>
    local _label="$1" _wantv="$2" _fault="$3" _rc=0 _err=""
    shift 3
    _err="$( ga_run "$_label" -- "$@" 2>&1 >/dev/null )"
    _rc=$?
    if [ "$_rc" -eq "$_wantv" ]; then
      printf '  ✅ %s ⇒ %s\n' "$_label" "$_rc"
      _pass=$((_pass + 1))
    else
      printf '  ❌ %s ⇒ %s（期望 %s）\n' "$_label" "$_rc" "$_wantv"
      _fail=$((_fail + 1))
    fi
    # 判据故障语义：非 0/1/2 的码**必须**带 `判据故障: <原始码>` 行；0/1/2 上**不得**出现
    if [ "$_fault" = "-" ]; then
      case "$_err" in
        *"判据故障"*) printf '  ❌ %s 不应有「判据故障」行（0/1/2 是合法结论）\n' "$_label"
                     _fail=$((_fail + 1)) ;;
        *) _pass=$((_pass + 1)) ;;
      esac
    else
      case "$_err" in
        *"判据故障: ${_fault}"*) _pass=$((_pass + 1)) ;;
        *) printf '  ❌ %s 缺 stderr 点名「判据故障: %s」\n' "$_label" "$_fault"
           _fail=$((_fail + 1)) ;;
      esac
    fi
  }
  _ga_case fixture_exit0 0 - bash -c 'exit 0'
  _ga_case fixture_exit1 1 - bash -c 'exit 1'
  _ga_case fixture_exit2 2 - bash -c 'exit 2'
  _ga_case fixture_exit126 2 126 bash -c 'exit 126'
  _ga_case fixture_exit128 2 128 bash -c 'exit 128'
  _ga_case fixture_exit137 2 137 bash -c 'exit 137'
  _ga_case fixture_exit42 2 42 bash -c 'exit 42'
  _ga_case fixture_notfound 2 127 __synova_ga_no_such_command__
  if [ "$_fail" -eq 0 ]; then
    printf 'SELFCHECK: OK %s/%s\n' "$_pass" "$_pass"
    return 0
  fi
  printf 'SELFCHECK: FAIL %s 失败（%s 通过）\n' "$_fail" "$_pass"
  return 1
}

_ga_entry() {
  case "${1:-}" in
    --selfcheck)
      if [ "${SYNO_GA_DRY:-0}" = "1" ]; then ga_dry_selfcheck; else ga_selfcheck; fi
      ;;
    --table) ga_print_table ;;
    --help|-h) ga_usage ;;
    "")
      if [ "${SYNO_GA_DRY:-0}" = "1" ]; then
        ga_dry_selfcheck
      else
        ga_usage >&2
        return 2
      fi
      ;;
    *)
      printf '用法错误: 未知参数 %s\n' "$1" >&2
      ga_usage >&2
      return 2
      ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  _ga_entry "$@"
  exit $?
fi
