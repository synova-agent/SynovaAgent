#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true  # swallow-ok: 语言环境设不上不改判定（输出为 UTF-8 字面量，非本地化文本）
# ═══════════════════════════════════════════════════════════════════════════════
# check-ci-empty-green.sh — CI **step 级**空绿判据（#1095 · W4）
#
# 设计哲学（一句）: **「这一步没跑」与「这一步跑了但一个测试都没跑」必须可判，且都不许冒充通过** ——
#   本器只判 step 的**结果记录**，不重跑测试（跑测试是 CI 步自己的事）。既有
#   `ci-emptygreen-sim.sh` 判的是「③ 步正文的**逻辑**」（变更集分类对不对），本器判的是
#   「本 job 的**真实 step 结果**」（test_count / skipped）—— 两层互补，**不重造**。
#   历史病根（创始人裁决②）：`No test files found, exiting with code 0` 让 ③ 步恒绿、连续 33 个
#   job 该步不提供任何信息；③ 步已会分类，但**没有任何判据去核「本次 job 到底跑了几个测试」**。
#
# 契约（铁律 47）:
#   @usage   bash scripts/control-tower/check-ci-empty-green.sh [--results <file> | --summary <file>]
#              [--env] [--selfcheck] [--help]
#   @input   --results / --summary <file>（同义；`--summary` 为卡面口径名）
#            记录格式：每行一组 `key=value`（空格或 TAB 分隔；`reason=` 起至行尾，可含空格）。
#              必需键 `test_count=<非负整数>`；可选 `step=<id>`（缺省 `step#<n>`）、
#              `status=ran|skipped`（缺省 ran；`skipped=1` 等价于 `status=skipped`）、
#              `reason=<未运行原因>`（skipped 时必填，≥6 字）。空行与 `#` 开头行忽略。
#            缺省路径 = $SYNO_CI_EG_RESULTS，或
#              ${RUNNER_TEMP:-/tmp}/synova-ci-emptygreen-${GITHUB_RUN_ID:-local}.env
#              （与 `.gitea/workflows/local-gates.yml` ③ 步的写入路径**同一表达式**，禁两处漂移）
#            --env  从环境读**单条**记录：CI_TEST_COUNT / CI_STEP_ID / CI_STEP_SKIPPED / CI_SKIP_REASON
#   @output  stdout 逐条 ✅/ℹ️/❌ ＋ 末行 `结果: N 通过, M 失败`；另打一行可 grep 留证的汇总口径
#            `CI-EMPTY-GREEN: PASS|SKIP-ONLY|VIOLATION|UNJUDGED tests=<n> skipped=<n>`
#   @exit    **三态**（scripts/control-tower/AGENTS.md「probe 三态退出码」）:
#            0 = 通过（含「全部为正当跳过」：跳过**不计入通过**，见 SKIP-ONLY 行）
#            1 = 真红（test_count=0 且未声明跳过 ／ 跳过但无未运行原因 ／ 原因过短 ／ 未知 status）
#            2 = **判不了**（记录文件缺失·不可读 ／ 0 条记录 ／ 记录缺 test_count ／ 非整数 ／ 参数错）
#                🔴 信号量==0 ⇒ 2（禁把「看不见」当「没问题」）
#   @degraded exit 2 时 stderr 一行 `degraded: <原因>`（铁律 11：不静默降级）
#   @error   code ∈ {E_USAGE, E_NO_INPUT, E_EMPTY, E_BAD_RECORD}（均 ⇒ exit 2；见 degraded 行）
#
# 判据（①②③④⑤ 即全部逻辑，无隐含分支）:
#   ① 关键 step 真跑过测试（`test_count>0` 且 `status=ran`）⇒ 计入**通过**
#   ② `test_count==0` 且**未**声明 `status=skipped` ⇒ 🔴 异常空绿 ⇒ exit 1
#   ③ 声明 `status=skipped` 但**没写未运行原因**（或 <6 字）⇒ 🔴 exit 1（禁静默跳过）
#   ④ 声明 `status=skipped` 且有原因 ⇒ ℹ️ **正当跳过：不计入通过**（既不是"通过"，也不判红）
#   ⑤ 一条记录都读不到 ⇒ exit 2（判不了，绝不冒充通过）
#
# 已知限制（做不到什么 —— 禁读成「已检测」）:
#   1. **只判记录，不判记录真假**：本器信任 CI 步写进来的 test_count；写入侧的正确性由
#      `ci-emptygreen-sim.sh`（③ 步正文逻辑）与 `tests/control-tower/check-ci-empty-green.test.sh`
#      （本器判据）两侧承担 —— 本器自己**不重跑测试**，故不能证明"测试真跑了"。
#   2. **只覆盖「已登记的关键 step」**：未写记录的 step 不在视野内 ⇒ 新增关键 step 必须同时改
#      workflow 写入点（否则本器看不见它，这是**有意的覆盖面收缩**，不是遗漏）。
#   3. 「正当跳过」的正当性由写记录一侧以 reason 文本声明；本器只判"有没有原因、够不够长"，
#      不判"原因是否为真"（文本真假不可机器判；误用属复核/审计面）。
#   4. 记录文件按 UTF-8 读（同仓惯例）；非 UTF-8 不影响 key=value 判定（test_count 是 ASCII），
#      但 reason 回显可能乱码。
#   5. 缺 `$GITHUB_RUN_ID`（本机复现）时记录文件名退化为 `…-local.env` ⇒ 同机**并行**两个 job
#      会混写；本 job 的 workspace 是固定路径（既有设计即假定串行），故不额外加锁。
#
# 用法: bash scripts/control-tower/check-ci-empty-green.sh --summary /tmp/ci-step-results.env
#       bash scripts/control-tower/check-ci-empty-green.sh --selfcheck
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

MIN_REASON_CHARS=6
MODE="file"
INPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --results|--summary)
      if [ $# -lt 2 ]; then
        printf 'degraded: E_USAGE — %s 需要 <file>（见 --help）\n' "$1" >&2
        exit 2
      fi
      INPUT="$2"; MODE="file"; shift 2 ;;
    --env)
      MODE="env"; shift ;;
    --selfcheck)
      MODE="selfcheck"; shift ;;
    -h|--help)
      # 头注释即用法文档（单源：改契约只改头部，不留第二份会漂移的用法文本）
      sed -n '8,60p' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      printf 'degraded: E_USAGE — 未知参数: %s（见 --help）\n' "$1" >&2
      exit 2 ;;
  esac
done

if [ -z "$INPUT" ]; then
  INPUT="${SYNO_CI_EG_RESULTS:-${RUNNER_TEMP:-/tmp}/synova-ci-emptygreen-${GITHUB_RUN_ID:-local}.env}"
fi

# ── 计数器（judge_file 写；判定出口按 UNJUDGED > FAIL > 其余 的优先级）──
PASS=0; FAIL=0; SKIP=0; UNJUDGED=0; RECORDS=0; TESTS=0

judge_file() {  # $1 = 记录文件路径；返回 0/1/2（三态见头部 @exit）
  local file="$1" line lineno=0 label status tc reason saw=0 head tok
  if [ ! -f "$file" ]; then
    printf 'degraded: E_NO_INPUT — 结果记录不存在（判不了，禁当通过）: %s\n' "$file" >&2
    echo "CI-EMPTY-GREEN: UNJUDGED reason=no-input"
    echo "结果: 0 通过, 1 失败"
    return 2
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *test_count=*|*step=*) ;; *) continue ;; esac
    RECORDS=$((RECORDS + 1)); saw=1
    label=""; status=""; tc=""; reason=""
    head="$line"
    case "$head" in
      *reason=*) reason="${head#*reason=}"; head="${head%%reason=*}" ;;
    esac
    for tok in $head; do
      case "$tok" in
        step=*) label="${tok#step=}" ;;
        status=*) status="${tok#status=}" ;;
        test_count=*) tc="${tok#test_count=}" ;;
        skipped=*) if [ "${tok#skipped=}" = "1" ]; then status="skipped"; fi ;;
      esac
    done
    if [ -z "$label" ]; then label="step#${RECORDS}"; fi
    if [ -z "$tc" ]; then
      echo "  ❌ ${label}: 记录缺 test_count=（信号量==0 ⇒ 判不了，第 ${lineno} 行）"
      UNJUDGED=$((UNJUDGED + 1)); continue
    fi
    case "$tc" in
      *[!0-9]*)
        echo "  ❌ ${label}: test_count 非非负整数（实测 '${tc}'）⇒ 判不了"
        UNJUDGED=$((UNJUDGED + 1)); continue ;;
    esac
    if [ -z "$status" ]; then status="ran"; fi
    case "$status" in
      ran|skipped) ;;
      *)
        echo "  ❌ ${label}: status='${status}' 不在 {ran,skipped} ⇒ 判不了"
        UNJUDGED=$((UNJUDGED + 1)); continue ;;
    esac
    if [ "$status" = "skipped" ]; then
      if [ -z "$reason" ]; then
        echo "  ❌ ${label}: 关键 step 被 skipped 且**未写未运行原因** ⇒ 判红"
        FAIL=$((FAIL + 1))
      elif [ "${#reason}" -lt "$MIN_REASON_CHARS" ]; then
        echo "  ❌ ${label}: skipped 的未运行原因过短（${#reason} 字 < ${MIN_REASON_CHARS}）⇒ 判红"
        FAIL=$((FAIL + 1))
      else
        echo "  ℹ️  正当跳过（**不计入通过**）：${label} — 未运行原因: ${reason}"
        SKIP=$((SKIP + 1))
      fi
    else
      if [ "$tc" -gt 0 ]; then
        echo "  ✅ ${label}: test_count=${tc}（真跑过测试）"
        PASS=$((PASS + 1)); TESTS=$((TESTS + tc))
      else
        echo "  ❌ ${label}: test_count=0 且未声明为正当跳过 ⇒ 🔴 异常空绿（判红）"
        FAIL=$((FAIL + 1))
      fi
    fi
  done < "$file"
  if [ "$saw" -eq 0 ]; then
    echo "  ❌ 信号量==0：记录文件中 0 条 step 记录 ⇒ 判不了（禁把「看不见」当「没问题」）"
    echo "CI-EMPTY-GREEN: UNJUDGED reason=zero-records"
    echo "结果: 0 通过, 1 失败"
    return 2
  fi
  if [ "$UNJUDGED" -gt 0 ]; then
    echo "  ❌ ${UNJUDGED} 条记录判不了 ⇒ fail-closed（不冒充通过）"
    echo "CI-EMPTY-GREEN: UNJUDGED tests=${TESTS} skipped=${SKIP}"
    echo "结果: ${PASS} 通过, $((FAIL + UNJUDGED)) 失败"
    return 2
  fi
  if [ "$FAIL" -gt 0 ]; then
    echo "CI-EMPTY-GREEN: VIOLATION tests=${TESTS} skipped=${SKIP}"
    echo "结果: ${PASS} 通过, ${FAIL} 失败"
    return 1
  fi
  if [ "$PASS" -eq 0 ]; then
    echo "CI-EMPTY-GREEN: SKIP-ONLY tests=0 skipped=${SKIP}（全部正当跳过 ⇒ 不计入通过）"
    echo "结果: 0 通过, 0 失败（${SKIP} 步正当跳过·不计入通过）"
    return 0
  fi
  echo "CI-EMPTY-GREEN: PASS tests=${TESTS} steps=${PASS} skipped=${SKIP}"
  echo "结果: ${PASS} 通过, 0 失败"
  return 0
}

judge_env() {  # 单条记录模式（环境变量注入；CI 表达式不可用时的人工复现路径）
  local label="${CI_STEP_ID:-step#1}" status="ran" tc="${CI_TEST_COUNT:-}" reason="${CI_SKIP_REASON:-}"
  local tmp rc
  case "${CI_STEP_SKIPPED:-0}" in
    1|true|yes|on) status="skipped" ;;
  esac
  tmp="$(mktemp)" || { printf 'degraded: E_ENV — mktemp 不可用（判不了）\n' >&2; return 2; }
  printf 'step=%s status=%s test_count=%s reason=%s\n' "$label" "$status" "$tc" "$reason" > "$tmp"
  judge_file "$tmp"; rc=$?
  rm -f "$tmp"
  return "$rc"
}

selfcheck() {  # 内置夹具（判别力自检）：0=全部符合预期 ／ 2=自检本身不可判
  local d fails=0 f rc n=0
  d="$(mktemp -d)" || { printf 'degraded: E_ENV — selfcheck 沙箱不可建（判不了）\n' >&2; return 2; }
  _sc() {  # $1=夹具名 $2=期望 rc $3=夹具内容
    local _f="$d/$1.env" _rc
    printf '%s\n' "$3" > "$_f"
    ( judge_file "$_f" >/dev/null 2>&1 ); _rc=$?
    n=$((n + 1))
    if [ "$_rc" = "$2" ]; then
      echo "  ✅ selfcheck [${1}] rc=${_rc}"
    else
      echo "  ❌ selfcheck [${1}] rc=${_rc}（期望 ${2}）"
      fails=$((fails + 1))
    fi
  }
  _sc 正常_有测试 0 'step=③ status=ran test_count=12 reason='
  _sc 异常空绿 1 'step=③ status=ran test_count=0 reason='
  _sc 跳过无原因 1 'step=③ status=skipped test_count=0 reason='
  _sc 跳过原因过短 1 'step=③ status=skipped test_count=0 reason=跳过'
  _sc 正当跳过 0 'step=③ status=skipped test_count=0 reason=变更集未触及可测面'
  _sc 缺test_count 2 'step=③ status=ran reason='
  _sc 零记录 2 '# 只有注释，没有记录'
  printf '%s\n' 'step=③ status=ran test_count=4 reason=' > "$d/多记录.env"
  printf '%s\n' 'step=①j status=skipped test_count=0 reason=回滚态 SYNO_CONTRACT_TESTS=0' >> "$d/多记录.env"
  ( judge_file "$d/多记录.env" >/dev/null 2>&1 ); rc=$?; n=$((n + 1))
  if [ "$rc" -eq 0 ]; then echo "  ✅ selfcheck [多记录_混合] rc=0"; else echo "  ❌ selfcheck [多记录_混合] rc=${rc}（期望 0）"; fails=$((fails + 1)); fi
  ( judge_file "$d/不存在.env" >/dev/null 2>&1 ); rc=$?; n=$((n + 1))
  if [ "$rc" -eq 2 ]; then echo "  ✅ selfcheck [缺文件] rc=2"; else echo "  ❌ selfcheck [缺文件] rc=${rc}（期望 2）"; fails=$((fails + 1)); fi
  rm -rf "$d"
  if [ "$fails" -ne 0 ]; then
    echo "selfcheck: FAIL ${fails}/${n}（判据判别力失效 —— 禁把「看不见」当「没问题」）"
    return 2
  fi
  echo "selfcheck: PASS ${n}/${n}"
  return 0
}

if [ "$MODE" = "selfcheck" ]; then selfcheck; exit $?; fi
if [ "$MODE" = "env" ]; then judge_env; exit $?; fi
judge_file "$INPUT"; exit $?
