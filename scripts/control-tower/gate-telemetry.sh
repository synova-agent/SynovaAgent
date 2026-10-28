#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gate-telemetry.sh — D1094（W2 运行遥测）: gate-hits JSONL 单写入器（续写小工具）
#
# 背景（#1094）: `.claude/gate-hits.log` 原为 {time,gate,result,branch} —— 不能区分
#   「零命中」与「没跑」，也没有耗时数据，月度清理/退役复审无据。本工具是**唯一追加入口**
#   （pre-commit 的 log_gate 消费它）。不新建遥测目录、不入库（.gitignore 继续忽略该日志，
#   运行期产物刻意不进货——见 gate-stats.sh 头注与 memory Note）。
#
# 契约（铁律 47）:
#   @input  — argv: --emit <gate> <result> <duration_ms> <hits> [--log <path>] [--branch <name>]
#               gate        : 检查点名（非空；空格/中文/括号均可，写入前做 JSON 转义）
#               result      : hit | miss | warn | degraded（枚举外 ⇒ exit 1，拒绝写入）
#               duration_ms : 0..N 整数；0 = 未测得（gate-stats 的中位耗时不计 0）
#               hits        : 0..N 整数（本次检查命中条数；调用方无计数时按 hit=1/miss=0）
#             env: SYNO_GATE_HITS_LOG（默认 <root>/.claude/gate-hits.log）
#                  SYNO_GATE_BRANCH（--branch 缺省时的分支名；仍缺省 ⇒ git 探测，失败记 unknown）
#                  SYNO_GATE_DEGRADED_LOG（默认 <root>/.codex/control-tower/logs/degraded-events.log）
#   @output — 追加一行 JSONL {time,gate,result,branch,duration_ms,hits}；成功时 stdout 静默
#   @exit   — 0 = 已写入
#             1 = 输入不合规（可判定的坏记录：result 不在枚举）——拒绝写入、不重试
#             2 = 判不了（必填缺失/信号量 0 ｜ duration_ms·hits 非非负整数 ｜ 父目录不可建 ｜
#                 写入失败）——fail-closed：宁可报 2 也不假装写入成功
#   @degraded — 写失败/父目录不可建 ⇒ stderr 一行 `degraded: …` ＋ degraded-events.log 一行 JSON，
#              并 exit 2。调用方（pre-commit 的 log_gate）**不得**把该 2 当门禁结论
#              （遥测非门禁：门禁判定只由 hard_check/soft_check 的 hit/miss 决定）。
#
# 设计要点:
#   · 纯 bash + printf：单次写入 <1ms 级，避免每次门禁命中 spawn python
#     （Windows spawn ≈ 数十 ms × 每提交数十个检查点）。
#   · JSON 转义只处理 gate/branch 的 `\` 与 `"`，并剥 CR/LF —— 本仓检查点名不含控制字符。
#   · 不读其它遥测文件、不改 .gitignore、除日志父目录外不创建任何目录。
#
# 已知限制（做不到什么 —— 禁读成"已保证"）:
#   1. 手写序列化（非 json.dumps）：控制字符类点名会产出损坏行，由 gate-stats 计为「损坏行」。
#   2. 无并发锁：多 session 并发追加依赖 O_APPEND 的单行原子写（POSIX: 单次 write < PIPE_BUF）。
#   3. 不校验/不迁移历史 4 字段行（旧行由 gate-stats 兼容读取）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"  # swallow-ok: 非 git 目录回退 pwd（--log/--branch 显式给出时不依赖 ROOT）

# ── JSON 字符串转义（输出不含两侧引号）──
_json_str() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\r'/}"
  s="${s//$'\n'/}"
  printf '%s' "$s"
}

# ── 降级出口：stderr + degraded 日志 + exit 2（三态之"判不了"）──
_DEG_LOG="${SYNO_GATE_DEGRADED_LOG:-$ROOT/.codex/control-tower/logs/degraded-events.log}"
_degrade() { # $1=原因
  printf 'degraded: %s\n' "$1" >&2
  mkdir -p "$(dirname "$_DEG_LOG")" 2>/dev/null || true  # swallow-ok: 降级日志目录建不了时 stderr + exit 2 已先行给出（铁律 11 不静默放行）
  printf '{"time":"%s","component":"gate-telemetry","code":"E_TELEMETRY_DEGRADED","phase":"emit","retryable":false,"reason":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(_json_str "$1")" >> "$_DEG_LOG" 2>/dev/null || true  # swallow-ok: 同上——退出码已是 2，stderr 已给 degraded 行
  exit 2
}

_usage() {
  printf '%s\n' \
    "用法: bash scripts/control-tower/gate-telemetry.sh --emit <gate> <result> <duration_ms> <hits> [--log <path>] [--branch <name>]" \
    "      result ∈ hit|miss|warn|degraded；duration_ms/hits 为非负整数（duration_ms=0 表示未测得）" \
    "      env: SYNO_GATE_HITS_LOG / SYNO_GATE_BRANCH / SYNO_GATE_DEGRADED_LOG" \
    "退出码: 0=已写入 1=输入不合规（拒绝写入） 2=判不了（fail-closed）"
}

# ── 参数解析（三态：缺值 ⇒ 2；未知参数 ⇒ 2）──
MODE=""; GATE=""; RESULT=""; DUR=""; HITS=""; LOG_ARG=""; BRANCH_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --emit)
      shift
      [ $# -ge 4 ] || _degrade "--emit 需要 4 个参数（gate result duration_ms hits）——信号量 0 ⇒ exit 2"
      MODE="emit"; GATE="$1"; RESULT="$2"; DUR="$3"; HITS="$4"; shift 4 ;;
    --log)
      shift
      [ $# -ge 1 ] || _degrade "--log 需要 1 个参数（日志路径）"
      LOG_ARG="$1"; shift ;;
    --branch)
      shift
      [ $# -ge 1 ] || _degrade "--branch 需要 1 个参数（分支名）"
      BRANCH_ARG="$1"; shift ;;
    -h|--help)
      _usage; exit 0 ;;
    *)
      _degrade "未知参数: $1（见 --help）" ;;
  esac
done

[ "$MODE" = "emit" ] || _degrade "未给 --emit（本工具是写入器，不产出报告）——信号量 0 ⇒ exit 2"

# ── 输入校验（1=可判定的坏记录；2=判不了）──
[ -n "$GATE" ] || _degrade "gate 为空（信号量 0 ⇒ exit 2）"
case "$RESULT" in
  hit|miss|warn|degraded) : ;;
  *)
    echo "❌ 输入不合规: result=${RESULT}（允许 hit|miss|warn|degraded；拒绝写入，exit 1）" >&2
    exit 1 ;;
esac
case "$DUR" in
  ''|*[!0-9]*) _degrade "duration_ms 非非负整数: '${DUR}'（判不了 ⇒ exit 2）" ;;
esac
case "$HITS" in
  ''|*[!0-9]*) _degrade "hits 非非负整数: '${HITS}'（判不了 ⇒ exit 2）" ;;
esac

# ── 落点与分支解析 ──
LOG="${LOG_ARG:-${SYNO_GATE_HITS_LOG:-}}"
[ -n "$LOG" ] || LOG="$ROOT/.claude/gate-hits.log"
BRANCH="${BRANCH_ARG:-${SYNO_GATE_BRANCH:-}}"
if [ -z "$BRANCH" ]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"  # swallow-ok: 非 git/无 HEAD ⇒ 分支名置 unknown（记录里显式可见，不静默空值）
  [ -n "$BRANCH" ] || BRANCH="unknown"
fi

_LINE="{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"gate\": \"$(_json_str "$GATE")\", \"result\": \"${RESULT}\", \"branch\": \"$(_json_str "$BRANCH")\", \"duration_ms\": ${DUR}, \"hits\": ${HITS}}"

_LOG_DIR="$(dirname "$LOG")"
if [ ! -d "$_LOG_DIR" ]; then
  mkdir -p "$_LOG_DIR" 2>/dev/null || _degrade "日志父目录不可建: ${_LOG_DIR}（判不了 ⇒ exit 2）"  # swallow-ok: mkdir 失败已由 _degrade 输出 stderr + degraded 日志 + exit 2
fi
if ! printf '%s\n' "$_LINE" >> "$LOG" 2>/dev/null; then  # swallow-ok: 写失败已由 _degrade 输出 stderr + degraded 日志 + exit 2（调用方不得当作门禁结论）
  _degrade "日志写入失败: ${LOG}（判不了 ⇒ exit 2；调用方不得把该码当门禁结论）"
fi
exit 0
