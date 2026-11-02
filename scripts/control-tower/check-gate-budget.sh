#!/usr/bin/env bash
# D313/D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-gate-budget.sh — pre-commit 墙钟耗时预算机检（W0 附 · 卡 #1210 · 标准 v3.1 §七）
#
# 设计哲学（一句）: **耗时预算只有「真实墙钟 ＋ 阈值 ＋ 无数据即判不了」三件同时成立才算机检；
#                    只出中位耗时（gate-stats.sh / gate-telemetry.sh）等于看得见数字、判不出红绿。**
#
# 契约（铁律 47 / C1）:
#   @usage  bash scripts/control-tower/check-gate-budget.sh [--cmd "<命令>"] [--log <path>]
#             [--threshold-ms <n>] [--json] [--help]
#   @input  ① `--cmd "<命令>"`：用 python time.monotonic() 实测该命令端到端墙钟（毫秒）
#           ② 无 --cmd：读日志 `wall_ms=<n>` 记录，取**最后一条**
#              路径优先级 --log > 环境 SYNO_GATE_BUDGET_LOG > <root>/.claude/gate-budget.log
#           `--threshold-ms` 默认 90000（标准 §七：pre-commit ≤90 s）
#           <root> = git toplevel（退化 pwd）
#   @output stdout: `wall_ms=<n>` ＋ `BUDGET: PASS` | `BUDGET: FAIL（><n>ms）`
#           --json: 单行合法 JSON：{"wall_ms":N,"threshold_ms":N,"verdict":"PASS|FAIL","source":"cmd|log"}
#           人读说明与降级一律走 stderr（--json 时 stdout 只有 JSON，保证可解析）
#   @exit   0 = 达标 ｜ 1 = 超限 ｜ 2 = 判不了
#           （无数据源 / 日志无 wall_ms / 无 python3 / 计时失败 / 被测命令自身失败 / 参数错）
#           🔴 三态铁律：2 绝不等于通过（信号量==0 ⇒ exit 2，fail-closed）
#   @degraded stderr `degraded: <CODE> — <原因>` ＋ 追加 JSON 到 SYNO_GATE_DEGRADED_LOG
#           （time/component/code/phase/retryable；铁律 11/32）＋ exit 2
#           code ∈ {E_USAGE, E_NO_PYTHON, E_NO_DATA, E_CMD_FAILED, E_TIMER, E_INTERNAL}
#   @authority 授权（explicit authority）: 任何本地会话 / CI job / 人工复核均可调用；
#           只读仓内事实（唯一落盘 = 降级日志，位于 ignored 的 .codex/ 下）；
#           **已接 pre-commit 主路径**（#1255-T3 / W6 接线，2026-11-01）：pre-commit-check.sh 在
#           结果段落盘 `wall_ms=<n>` 后调用本件 `--log`，**只告警不阻断**（超标不改变提交结果；
#           数值与判定唯一来源仍是本件 0/1/2 三态）。接线前状态见卡 #1210 判据 7 历史。
#
# 已复用的既有约定（禁重复实现）:
#   D1 三态退出码 0/1/2（scripts/control-tower/AGENTS.md）
#   D2 `@降级` ＋ SYNO_GATE_DEGRADED_LOG JSON（check-gate-integrity.sh 同形）
#   D3 UTF-8 强制（D732 / D313 M5；本文件首两行）
#   D4 判别力自检 = 配对测试 tests/control-tower/check-gate-budget.test.sh（CT-40）
#      的「恒真变异体」用例：把阈值比较换成 false 后，超限夹具必须由 FAIL(1) 变 PASS(0)
#      ⇒ 证明 FAIL 是判据而不是恒红。
#
# 结构（Source map）:
#   段                 职责
#   ────────────────   ───────────────────────────────────────────────────────────
#   ① 头部契约         本段（@usage/@input/@output/@exit/@degraded/@error/已知限制）
#   ② 解释器探测       PYBIN 三级探测（探**可用性**，不只看存在性，D328 P1-1）
#   ③ 参数与数据源     --cmd/--log/--threshold-ms/--json；日志默认路径解析
#   ④ 测量             --cmd=python monotonic 子进程实测；否则读日志最后一条 wall_ms
#   ⑤ 判定与输出       阈值比较（唯一判定点）→ wall_ms 行 ＋ BUDGET 行 / JSON
#   ⑥ 降级             stderr `degraded:` ＋ degraded log JSON ＋ exit 2
#
# 已知限制（做不到什么 —— 禁读成"已检测"）:
#   1. **不接 pre-commit 主路径**：只有被显式调用时才测量；不调用 = 无数据（exit 2），
#      本器不会自己定时跑。卡面判据 7 明示「默认不纳入主路径」。
#   2. **wall_ms 是端到端墙钟，不是各门禁耗时之和**：含 shell/解释器启动、I/O 等待与调度；
#      与 gate-stats.sh 的 duration_ms（逐检查点间隔）**不同口径**，不得相加或互证。
#      实测本机 Git Bash 启动约 0.9 s，短命令的 wall_ms 以该量级为底噪。
#   3. **日志模式只认 `wall_ms=<n>`**：不解析 gate-hits.log（无该字段）⇒ 旧日志 = 无数据 = exit 2。
#      日志为空 / 只有其它字段 ⇒ 同样 exit 2（**无数据绝不读成达标**）。
#   4. **被测命令的输出重定向到 stderr**：stdout 只留本器报告（保证 --json 可解析）；
#      命令自身 rc≠0 ⇒ E_CMD_FAILED（exit 2）——「门禁自己红了」与「耗时达标」是两件事，禁混判。
#   5. **只判上限，无分级**：PASS/FAIL 二值；≤90s 目标线之外的告警分级（如 75s 预警）留 W6。
#   6. **毫秒取整**：round 到毫秒，<0.5ms 显示 0；0 是合法测量值，不是"无数据"。
#   7. **只覆盖 pre-commit 一条腿**：Gitea ≤15 min / 举证 ≤5 min 两个预算不在本器。
#   8. **阈值变更无棘轮**：`--threshold-ms` 由调用方给，本器不记录历史阈值（防"调阈值过关"的
#      证据链仍靠评审批次，不在本器）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"  # swallow-ok: 非 git 目录回退 pwd（只影响日志默认路径）
DEG_LOG="${SYNO_GATE_DEGRADED_LOG:-$ROOT/.codex/control-tower/logs/degraded-events.log}"

# ── ⑥ 降级出口（D2：stderr 一行 ＋ JSON 追加 ＋ exit 2；禁返回 0）──
deg() { # $1=code $2=phase $3=原因
  printf 'degraded: %s — %s\n' "$1" "$3" >&2
  mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null || true
  printf '{"time":"%s","component":"check-gate-budget","code":"%s","phase":"%s","retryable":false}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$DEG_LOG" 2>/dev/null || true
  exit 2
}

# ── ③ 参数 ──
CMD=""
LOG=""
THRESHOLD=90000
JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cmd)
      [ $# -ge 2 ] || deg E_USAGE argv "--cmd 缺参数"
      CMD="$2"; shift 2 ;;
    --log)
      [ $# -ge 2 ] || deg E_USAGE argv "--log 缺参数"
      LOG="$2"; shift 2 ;;
    --threshold-ms)
      [ $# -ge 2 ] || deg E_USAGE argv "--threshold-ms 缺参数"
      THRESHOLD="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    -h|--help)
      awk 'NR > 5 { if ($0 ~ /^# ═/) exit; print }' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
      exit 0 ;;
    *) deg E_USAGE argv "未知参数: $1" ;;
  esac
done

case "$THRESHOLD" in
  ''|*[!0-9]*) deg E_USAGE argv "--threshold-ms 须为非负整数: '$THRESHOLD'" ;;
esac

LOG="${LOG:-${SYNO_GATE_BUDGET_LOG:-$ROOT/.claude/gate-budget.log}}"

# ── ② 解释器探测（D520/D328：禁裸 python3；探可用性）──
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

# ── ④ 测量 ──
SOURCE=""
if [ -n "$CMD" ]; then
  [ -n "$PYBIN" ] || deg E_NO_PYTHON measure "python3 不可用 —— 无法计时（fail-closed，禁当达标）"
  # 被测命令必须由**本脚本所在的 bash**执行：Windows 下裸 `bash` 会命中 system32 的 WSL 存根
  # （无发行版 ⇒ 必失败）；有 cygpath 时换成 Windows 绝对路径交给原生 python。
  BASH_BIN="${BASH:-/bin/bash}"
  if command -v cygpath >/dev/null 2>&1; then
    BASH_ARG="$(cygpath -w "$BASH_BIN" 2>/dev/null || printf '%s' "$BASH_BIN")"  # swallow-ok: 非 Windows 无 cygpath 时走 else
  else
    BASH_ARG="$BASH_BIN"
  fi
  MEASURE_OUT="$("$PYBIN" - "$BASH_ARG" "$CMD" <<'PYEOF'
import subprocess
import sys
import time

bash_bin, cmd = sys.argv[1], sys.argv[2]
t0 = time.monotonic()
try:
    rc = subprocess.call([bash_bin, "-c", cmd], stdout=sys.stderr, stderr=sys.stderr)
except OSError as exc:
    sys.stderr.write("timer_error: %s\n" % exc)
    sys.exit(3)
t1 = time.monotonic()
print("wall_ms=%d" % int(round((t1 - t0) * 1000)))
print("cmd_rc=%d" % rc)
PYEOF
)"; _mrc=$?
  [ "$_mrc" -eq 0 ] || deg E_TIMER measure "计时子进程失败 rc=${_mrc}（判不了）"
  WALL_MS="$(printf '%s\n' "$MEASURE_OUT" | sed -n 's/^wall_ms=//p' | tail -1)"
  CMD_RC="$(printf '%s\n' "$MEASURE_OUT" | sed -n 's/^cmd_rc=//p' | tail -1)"
  case "$WALL_MS" in ''|*[!0-9]*) deg E_TIMER measure "计时结果不可解析: '${WALL_MS}'" ;; esac
  case "$CMD_RC" in ''|*[!0-9]*) deg E_TIMER measure "命令退出码不可解析: '${CMD_RC}'" ;; esac
  # 被测命令自身失败 ⇒ 拿它的墙钟判预算没有意义（且会把「门禁红」洗成「预算绿」）
  [ "$CMD_RC" -eq 0 ] || deg E_CMD_FAILED measure "被测命令 rc=${CMD_RC}（门禁自身红 ≠ 耗时达标；判不了）"
  SOURCE="cmd"
else
  [ -f "$LOG" ] || deg E_NO_DATA log "数据源不存在: $LOG（无数据 ≠ 达标）"
  WALL_MS="$(grep -oE 'wall_ms=[0-9]+' "$LOG" 2>/dev/null | tail -1 | cut -d= -f2)"  # swallow-ok: 无记录由下方显式 exit 2
  case "$WALL_MS" in ''|*[!0-9]*) deg E_NO_DATA log "日志无可用 wall_ms 记录: $LOG（无数据 ≠ 达标）" ;; esac
  SOURCE="log"
fi

# ── ⑤ 判定与输出（唯一判定点；测试的「恒真变异体」就改这一行的比较）──
VERDICT="PASS"; [ "$WALL_MS" -gt "$THRESHOLD" ] && VERDICT="FAIL"

if [ "$JSON" -eq 1 ]; then
  printf '{"wall_ms":%s,"threshold_ms":%s,"verdict":"%s","source":"%s"}\n' \
    "$WALL_MS" "$THRESHOLD" "$VERDICT" "$SOURCE"
else
  printf 'wall_ms=%s\n' "$WALL_MS"
  if [ "$VERDICT" = "FAIL" ]; then
    printf 'BUDGET: FAIL（>%sms）\n' "$THRESHOLD"
  else
    printf 'BUDGET: PASS\n'
  fi
fi

[ "$VERDICT" = "PASS" ] && exit 0 || exit 1
