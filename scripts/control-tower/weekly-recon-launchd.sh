#!/bin/bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（Mac-only 件，仍守同一口径）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true   # swallow-ok: 环境无 C.UTF-8 locale 时保留默认（UTF-8 已由上一行兜底）
# ═══════════════════════════════════════════════════════════════════════════════
# weekly-recon-launchd.sh — #828 周对账 launchd 定时接线安装器（install / verify / uninstall）
#
# 设计哲学（一句）：**把「定时器装没装、跑没跑」从人的记忆搬进可复跑的判定 —— 安装器只做
#   幂等的装/查/卸三件事，判据给三态退出码，绝不替人宣布「通过」。**
#
# 授权（explicit authority）：#828 规格（.handbook/派单件/2026-10-22-规格-828-周对账定时接线.md
#   §4 契约，唯一准绳）＋ 上游 #808 规格 §7「接线另批」＋ weekly-recon.sh 头注 L19-59 调用契约。
#   · 谁能调：任意治理线会话手工作业 —— 只写 ~/Library/LaunchAgents 与 launchd 用户域；
#     不写仓库文件、不调 Gitea API、不改 weekly-recon.sh。
#   · 🔴 本体零改动：本件只「接线」，weekly-recon.sh 契约冻结（判据 4 机器验 diff）。
#   · 🔴 不判「通过」：verify 只给逐项证据与退出码，结论归 P6 收件闸 + 独立复核。
#
# 契约（铁律 47）：
#   @input  — <install|verify|uninstall>（恰好 1 个；其它/缺参/多参 ⇒ usage + exit 2 E_USAGE）
#             环境（生产有默认值；注入缝供测试）:
#               SYNO_LAUNCHAGENTS_DIR  缺省 $HOME/Library/LaunchAgents（plist 落盘目录）
#               SYNO_LAUNCHCTL         缺省裸名 launchctl（测试经 PATH 注入假二进制；
#                                      裸名 = 让 PATH 注入生效，不写死 /bin/launchctl）
#               SYNO_RECON_LOG         缺省 /tmp/synova-recon-launchd.log
#                                      （plist 日志路径 ＋ verify 日志新鲜度对象）
#               SYNO_RECON_SH          缺省 <script_dir>/weekly-recon.sh
#                                      （本体脚本绝对路径；变异测试在 /tmp 副本上作业时用它锚真本体）
#               SYNO_GATE_DEGRADED_LOG 缺省 <repo>/.codex/control-tower/logs/degraded-events.log
#   @output — install:   `INSTALLED|REINSTALLED|BOOTSTRAPPED com.synova.weekly-recon`
#                        ＋ `sha256=<hex|unavailable>`；二跑 `NOOP already-installed` ＋ `sha256=`
#             verify:   逐项 `PLIST_OK` / `LAUNCHCTL_OK` / `LOG_FRESH(<8d|none-yet)`；
#                        缺件时 `PLIST_MISSING` / `PLIST_BAD(<keys>)` /
#                        `LAUNCHCTL_UNREGISTERED(...)` / `LOG_STALE(>8d|absent)`
#             uninstall: `REMOVED com.synova.weekly-recon` / `NOOP not-installed`
#   @exit    — 三态: 0 = 成功 ｜ 1 = 真红（verify 缺件；bootstrap 被拒）
#                    2 = 自身/环境失败（非 Darwin／HOME 空／launchctl·plutil 不可用／
#                        plist 写失败或解析失败／launchctl 异常／内部异常）
#   @degraded — stderr 一行 `degraded: code=<CODE> <原因>` ＋ 追加 JSONL 到
#              $SYNO_GATE_DEGRADED_LOG（字段 time/component/code/phase/retryable；
#              铁律 11/31/32 显式降级，不静默）。
#              🔴 边界：verify 缺件与 bootstrap 被拒属**业务真红**（exit 1，stderr `error: code=`），
#              不走 degraded；degraded 只用于「检查自身/环境不可信」的 exit 2。
#   @error   — typed error code 表（stderr `degraded: code=` 或 `error: code=` 前缀）:
#                E_USAGE(2)               子命令缺失/非法/多参
#                E_ENV_NOT_MAC(2)         非 Darwin（launchd 无跨平台等价物）
#                E_ENV_NO_HOME(2)         HOME 为空，无法定位 ~/Library/LaunchAgents
#                E_ENV_NO_LAUNCHCTL(2)    launchctl 不可执行（command -v 失败）
#                E_ENV_NO_PLUTIL(2)       plutil 不可用（无法校验/解析 plist）
#                E_RECON_SH_MISSING(2)    install 时本体脚本不存在（禁装指向空路径的定时器）
#                E_DIR_UNWRITABLE(2)      LaunchAgents 目录不可创建
#                E_PLIST_WRITE(2)         plist 临时生成/落盘写失败
#                E_PLIST_PARSE(2)         plist 未通过 plutil -lint（生成后/已存在文件损坏）
#                E_PLIST_REMOVE_FAILED(2) uninstall 删 plist 失败
#                E_LAUNCHCTL_ABNORMAL(2)  launchctl 返回异常（Operation not permitted /
#                                         Could not find domain / 无可判形态）
#                E_BOOTOUT_FAILED(2)      bootout 失败（非「已不存在」）
#                E_BOOTSTRAP_REJECTED(1)  🔴 真红：bootstrap 被 launchd 拒绝（非环境不可用）
#                E_INTERNAL(2)            内部异常兜底（如脚本目录不可解析）
#   已知限制（Known Limitations）:
#     · macOS-only（launchd 无跨平台等价物；**Win 不适用** —— 本件不提供 Windows 路径）。
#     · launchd 给任务的 PATH 是最小 PATH（/usr/bin:/bin:/usr/sbin:/sbin）⇒ weekly-recon.sh 的
#       AUDIT 指标在**自动跑**时多为 `AUDIT=unavailable:0`（npm 不在 PATH）——**指标级缺失**，
#       不改变 weekly-recon 退出码；人工跑（登录 shell）不受影响。
#     · DSH shell 内 `launchctl list <label>` 可能无输出（rc 1）⇒ 本器以
#       `launchctl print gui/<uid>/<label>` 兜底判定注册态（两者皆败才判未注册）。
#     · 全新安装尚无日志 ⇒ `LOG_FRESH(none-yet)` 宽限（plist mtime 8 天内）——判据①
#       「install 后 verify exit 0」依赖此宽限；首个自动周节 2026-10-26（W44）后转 `LOG_FRESH(<8d>)`。
#     · 只判「安装态」不判「周节是否进 #811」——后者是判据②（连跑 2 周）归 #828 观察段，
#       本器 verify 不为它背书（禁把「装好了」读成「跑通了」）。
#     · `plutil -extract` 需 macOS 10.12+；更老系统会误报 PLIST_BAD（选型取舍：解析单源）。
#     · 不校验 token 是否存在（token 只在执行时由 weekly-recon.sh 读，禁落 plist/日志明文）。
#   复用（禁重复实现）:
#     · 三态退出码（scripts/control-tower/AGENTS.md）
#     · @降级 ＋ SYNO_GATE_DEGRADED_LOG JSONL（check-gate-protection.sh 同形）
#     · UTF-8 强制（D732 / D313 M5）
#     · plist 结构范式 = ~/Library/LaunchAgents/com.synova.weekly-selfcheck.plist（Weekday 0→1）
#     · 安装器三态补齐 = 修 scripts/backup/install-backup-launchd.sh 无 verify／无测试的缺口
#   Source map:
#     段                       职责
#     ───────────────────────  ────────────────────────────────────────────
#     ① 头部契约                本段（@input/@output/@exit/@degraded/@error/已知限制）
#     ② 常量与注入缝            路径／Label／日志／降级日志（纯 bash，零 python 依赖）
#     ③ 降级与工具              degraded JSONL／plutil 取值／sha256／注册态探测
#     ④ plist 生成              heredoc 确定性内容（无 token／无 EnvironmentVariables）
#     ⑤ install                 幂等三案（NOOP ／ 只补 bootstrap ／ 重装）
#     ⑥ verify                  逐项 PLIST／LAUNCHCTL／LOG 判定（三态）
#     ⑦ uninstall               幂等卸载
#     ⑧ 入口                    usage／分派／兜底
#   ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# ── ② 常量与注入缝 ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || {
  echo "error: code=E_INTERNAL 无法解析脚本自身目录（BASH_SOURCE=${BASH_SOURCE[0]}）" >&2
  exit 2
}
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)" || {
  echo "error: code=E_INTERNAL 无法解析仓库根（SCRIPT_DIR=${SCRIPT_DIR}）" >&2
  exit 2
}
RECON_SH="${SYNO_RECON_SH:-$SCRIPT_DIR/weekly-recon.sh}"
LABEL="com.synova.weekly-recon"
LAUNCHCTL_BIN="${SYNO_LAUNCHCTL:-launchctl}"
LAUNCHAGENTS_DIR="${SYNO_LAUNCHAGENTS_DIR:-${HOME:-}/Library/LaunchAgents}"
PLIST="$LAUNCHAGENTS_DIR/$LABEL.plist"
LOG="${SYNO_RECON_LOG:-/tmp/synova-recon-launchd.log}"
DEGRADED_LOG="${SYNO_GATE_DEGRADED_LOG:-$REPO_ROOT/.codex/control-tower/logs/degraded-events.log}"
COMPONENT="weekly-recon-launchd"
PHASE="start"
PROBE_DETAIL=""

# ── ③ 降级与工具 ───────────────────────────────────────────────────────────────
degraded() { # degraded <CODE> <原因> [exit_code=2] —— 显式降级（stderr ＋ JSONL），默认 exit 2
  local code="$1" msg="$2" rc="${3:-2}"
  echo "degraded: code=${code} ${msg}" >&2
  mkdir -p "$(dirname "$DEGRADED_LOG")" 2>/dev/null || true   # swallow-ok: 降级日志目录建不出不阻断（stderr 主通道已给）
  printf '{"time":"%s","component":"%s","code":"%s","phase":"%s","retryable":false}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$COMPONENT" "$code" "$PHASE" \
    >> "$DEGRADED_LOG" 2>/dev/null || true   # swallow-ok: 降级日志写失败不二次阻断（stderr 已给同信息）
  exit "$rc"
}

red_error() { # red_error <CODE> <原因> —— 业务真红（exit 1），不用 degraded 语义
  echo "error: code=$1 $2" >&2
  exit 1
}

require_launch_env() { # 公共前置：Darwin ＋ HOME ＋ launchctl 可执行
  local os
  os="$(uname -s 2>/dev/null || true)"   # swallow-ok: uname 失败落空值 → 下方显式 E_ENV_NOT_MAC degraded
  [ -n "$os" ] || os="unknown"
  if [ "$os" != "Darwin" ]; then
    degraded E_ENV_NOT_MAC "launchd 仅在 macOS 可用（实测 uname -s=${os}；Windows 不适用本件）" 2
  fi
  if [ -z "${HOME:-}" ]; then
    degraded E_ENV_NO_HOME "HOME 为空：无法定位 ~/Library/LaunchAgents（可显式设 SYNO_LAUNCHAGENTS_DIR）" 2
  fi
  if ! command -v "$LAUNCHCTL_BIN" >/dev/null 2>&1; then   # swallow-ok: 「不可用」结论由 ! 分支显式 degraded，不静默
    degraded E_ENV_NO_LAUNCHCTL "launchctl 不可用（SYNO_LAUNCHCTL=${LAUNCHCTL_BIN}）；请确认在 macOS 登录会话内执行" 2
  fi
}

require_plutil() { # install/verify 需要 plutil 校验/解析 plist
  if ! command -v plutil >/dev/null 2>&1; then   # swallow-ok: 「不可用」结论由 ! 分支显式 degraded，不静默
    degraded E_ENV_NO_PLUTIL "plutil 不可用：无法校验/解析 plist" 2
  fi
}

pl_lint() { # pl_lint <plist> → 返回码即结论（不吞错，仅静默输出）
  plutil -lint "$1" >/dev/null 2>&1   # swallow-ok: lint 结论走返回码，调用方逐案分派
}

pl_get() { # pl_get <keypath> —— 从 $PLIST 取 raw 值；缺键/失败落空值，由调用方点名 PLIST_BAD
  plutil -extract "$1" raw -o - "$PLIST" 2>/dev/null || true   # swallow-ok: 缺键即空值，逐项 PLIST_BAD 点名（禁静默）
}

sha256_of() { # sha256_of <file> —— shasum 优先、openssl 兜底；均不可用 ⇒ unavailable（不阻断幂等判定）
  local h=""
  if command -v shasum >/dev/null 2>&1; then
    h="$(shasum -a 256 "$1" 2>/dev/null | awk '{print $1}')"   # swallow-ok: 摘要工具失败落空值 → 走下方兜底/unavailable
  fi
  if [ -z "$h" ] && command -v openssl >/dev/null 2>&1; then
    h="$(openssl dgst -sha256 "$1" 2>/dev/null | awk '{print $NF}')"   # swallow-ok: 同上（openssl 兜底）
  fi
  if [ -n "$h" ]; then printf '%s' "$h"; else printf 'unavailable'; fi
}

probe_state() { # 注册态探测：0=已注册 1=未注册 2=异常（细节在 PROBE_DETAIL）
  local list_out="" print_out="" list_rc=0 print_rc=0
  list_out="$("$LAUNCHCTL_BIN" list "$LABEL" 2>&1)"
  list_rc=$?
  if [ "$list_rc" -eq 0 ]; then
    PROBE_DETAIL="list rc=0"
    return 0
  fi
  print_out="$("$LAUNCHCTL_BIN" print "gui/$(id -u)/$LABEL" 2>&1)"
  print_rc=$?
  if [ "$print_rc" -eq 0 ]; then
    PROBE_DETAIL="print rc=0"
    return 0
  fi
  PROBE_DETAIL="list rc=${list_rc} print rc=${print_rc} :: $(printf '%s %s' "$list_out" "$print_out" | tr '\n' ' ' | cut -c1-200)"
  # 未注册的两个可判形态：① 输出含 Could not find service（list rc113 / print rc113）；
  # ② list rc1 且两者均无输出（DSH shell 内 list 的已知形态）
  if printf '%s %s' "$list_out" "$print_out" | grep -q 'Could not find service'; then
    return 1
  fi
  if [ "$list_rc" -eq 1 ] && [ -z "$list_out" ] && [ -z "$print_out" ]; then
    return 1
  fi
  return 2
}

# ── ④ plist 生成（heredoc 确定性：无时间戳/无环境变量/无凭据）────────────────────
render_plist() { # render_plist <输出文件>
  cat > "$1" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${RECON_SH}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>1</integer>
    <key>Hour</key>
    <integer>8</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG}</string>
  <key>StandardErrorPath</key>
  <string>${LOG}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST_EOF
}

bootstrap_now() { # launchctl bootstrap（失败即分派：域不可用 ⇒ exit 2；被拒 ⇒ exit 1 真红）
  local out="" rc=0
  out="$("$LAUNCHCTL_BIN" bootstrap "gui/$(id -u)" "$PLIST" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    return 0
  fi
  if printf '%s' "$out" | grep -q 'Could not find domain'; then
    degraded E_LAUNCHCTL_ABNORMAL "bootstrap 无可用 GUI 域（Could not find domain）；请在已登录图形会话内执行" 2
  fi
  red_error E_BOOTSTRAP_REJECTED "bootstrap 被拒（rc=${rc}）：$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
}

# ── ⑤ install ──────────────────────────────────────────────────────────────────
cmd_install() {
  PHASE="install"
  require_launch_env
  require_plutil
  if [ ! -f "$RECON_SH" ]; then
    degraded E_RECON_SH_MISSING "本体脚本不存在：${RECON_SH}（拒绝安装指向空路径的定时器）" 2
  fi

  local existed=0 state_rc=0
  [ -f "$PLIST" ] && existed=1
  probe_state
  state_rc=$?
  if [ "$state_rc" -eq 2 ]; then
    degraded E_LAUNCHCTL_ABNORMAL "launchctl 返回异常（${PROBE_DETAIL}）；不猜注册态，先人工核" 2
  fi

  mkdir -p "$LAUNCHAGENTS_DIR" 2>/dev/null   # swallow-ok: 建目录失败由下方 -d 显式 degraded E_DIR_UNWRITABLE
  if [ ! -d "$LAUNCHAGENTS_DIR" ]; then
    degraded E_DIR_UNWRITABLE "LaunchAgents 目录不可创建：$LAUNCHAGENTS_DIR" 2
  fi

  local tmp_plist="$PLIST.tmp.$$"
  if ! render_plist "$tmp_plist"; then
    rm -f "$tmp_plist" 2>/dev/null || true   # swallow-ok: 错误态清理，失败不改变主结论
    degraded E_PLIST_WRITE "plist 生成失败：$tmp_plist" 2
  fi
  if ! pl_lint "$tmp_plist"; then
    rm -f "$tmp_plist" 2>/dev/null || true   # swallow-ok: 错误态清理，失败不改变主结论
    degraded E_PLIST_PARSE "生成的 plist 未通过 plutil -lint（拒绝落盘）：$tmp_plist" 2
  fi

  # 案 a：字节相同 ⇒ 不重写（保 mtime 供 LOG_FRESH(none-yet) 宽限）
  if [ "$existed" -eq 1 ] && cmp -s "$PLIST" "$tmp_plist"; then
    rm -f "$tmp_plist" 2>/dev/null || true   # swallow-ok: 临时件清理，失败不改变结论
    if [ "$state_rc" -eq 0 ]; then
      echo "NOOP already-installed"
      echo "sha256=$(sha256_of "$PLIST")"
      exit 0
    fi
    bootstrap_now
    echo "BOOTSTRAPPED ${LABEL}（plist 字节未变，只补 bootstrap）"
    echo "sha256=$(sha256_of "$PLIST")"
    exit 0
  fi

  # 案 b/c：plist 缺失或内容不同 ⇒ 已注册先 bootout，再落新 plist ＋ bootstrap
  if [ "$state_rc" -eq 0 ]; then
    local bout="" brc=0
    bout="$("$LAUNCHCTL_BIN" bootout "gui/$(id -u)/$LABEL" 2>&1)"
    brc=$?
    if [ "$brc" -ne 0 ]; then
      rm -f "$tmp_plist" 2>/dev/null || true   # swallow-ok: 错误态清理，失败不改变主结论
      degraded E_BOOTOUT_FAILED "bootout 失败（rc=${brc}）：$(printf '%s' "$bout" | tr '\n' ' ' | cut -c1-200)" 2
    fi
  fi
  if ! mv "$tmp_plist" "$PLIST"; then
    rm -f "$tmp_plist" 2>/dev/null || true   # swallow-ok: 错误态清理，失败不改变主结论
    degraded E_PLIST_WRITE "plist 落盘失败：$PLIST" 2
  fi
  bootstrap_now
  if [ "$existed" -eq 1 ]; then
    echo "REINSTALLED $LABEL"
  else
    echo "INSTALLED $LABEL"
  fi
  echo "sha256=$(sha256_of "$PLIST")"
  exit 0
}

# ── ⑥ verify ───────────────────────────────────────────────────────────────────
cmd_verify() {
  PHASE="verify"
  require_launch_env
  require_plutil
  local fail=0

  # ① plist 存在 + 可解析 + 必需键/值齐 + 无凭据样式
  if [ ! -f "$PLIST" ]; then
    echo "PLIST_MISSING（$PLIST 不存在；先跑 install）"
    fail=1
  else
    if ! pl_lint "$PLIST"; then
      degraded E_PLIST_PARSE "plutil 无法解析 plist（文件损坏）：$PLIST" 2
    fi
    local bad="" v=""
    v="$(pl_get Label)"
    [ "$v" = "$LABEL" ] || bad="${bad}Label(实际'${v}');"
    v="$(pl_get 'ProgramArguments.0')"
    [ "$v" = "/bin/bash" ] || bad="${bad}ProgramArguments.0(实际'${v}');"
    v="$(pl_get 'ProgramArguments.1')"
    if [ -z "$v" ]; then
      bad="${bad}ProgramArguments.1(缺失);"
    elif [ ! -f "$v" ]; then
      bad="${bad}本体脚本不存在(${v});"
    fi
    v="$(pl_get 'StartCalendarInterval.Weekday')"
    [ "$v" = "1" ] || bad="${bad}StartCalendarInterval.Weekday(实际'${v}');"
    v="$(pl_get 'StartCalendarInterval.Hour')"
    [ "$v" = "8" ] || bad="${bad}StartCalendarInterval.Hour(实际'${v}');"
    v="$(pl_get 'StartCalendarInterval.Minute')"
    [ "$v" = "0" ] || bad="${bad}StartCalendarInterval.Minute(实际'${v}');"
    v="$(pl_get StandardOutPath)"
    [ "$v" = "$LOG" ] || bad="${bad}StandardOutPath(实际'${v}');"
    v="$(pl_get StandardErrorPath)"
    [ "$v" = "$LOG" ] || bad="${bad}StandardErrorPath(实际'${v}');"
    v="$(pl_get RunAtLoad)"
    [ "$v" = "false" ] || bad="${bad}RunAtLoad(实际'${v}');"
    if grep -qE 'EnvironmentVariables|<key>[^<]*(Token|Secret|Password|PASSWD|API_KEY)' "$PLIST" 2>/dev/null; then   # swallow-ok: 命中即 PLIST_BAD，非吞错（探测型）
      bad="${bad}含凭据样式或 EnvironmentVariables;"
    fi
    if [ -n "$bad" ]; then
      echo "PLIST_BAD(${bad})"
      fail=1
    else
      echo "PLIST_OK"
    fi
  fi

  # ② launchd 注册态（list 优先，print 兜底）
  local state_rc=0
  probe_state
  state_rc=$?
  if [ "$state_rc" -eq 0 ]; then
    echo "LAUNCHCTL_OK"
  elif [ "$state_rc" -eq 1 ]; then
    echo "LAUNCHCTL_UNREGISTERED（${PROBE_DETAIL}）"
    fail=1
  else
    degraded E_LAUNCHCTL_ABNORMAL "launchctl 返回异常（${PROBE_DETAIL}）；不猜，先人工核" 2
  fi

  # ③ 日志新鲜度（<8 天有运行痕迹；全新安装宽限 none-yet）
  if [ -e "$LOG" ]; then
    if [ -n "$(find "$LOG" -mtime -8 -print -quit 2>/dev/null)" ]; then   # swallow-ok: find 失败按「旧日志」保守判 stale，不静默放行
      echo "LOG_FRESH(<8d)"
    else
      echo "LOG_STALE(>8d)（$LOG 超过 8 天无写入；核对定时器是否在跑）"
      fail=1
    fi
  else
    if [ -n "$(find "$PLIST" -mtime -8 -print -quit 2>/dev/null)" ]; then   # swallow-ok: plist 缺失时 find 落空 → LOG_STALE(absent)，不静默放行
      echo "LOG_FRESH(none-yet)（全新安装宽限：plist 8 天内，尚无首个周节日志）"
    else
      echo "LOG_STALE(absent)（无日志且 plist 超过 8 天；安装后从未跑过）"
      fail=1
    fi
  fi

  if [ "$fail" -ne 0 ]; then
    exit 1
  fi
  exit 0
}

# ── ⑦ uninstall ────────────────────────────────────────────────────────────────
cmd_uninstall() {
  PHASE="uninstall"
  require_launch_env
  local existed=0 state_rc=0
  [ -f "$PLIST" ] && existed=1
  probe_state
  state_rc=$?
  if [ "$state_rc" -eq 2 ]; then
    degraded E_LAUNCHCTL_ABNORMAL "launchctl 返回异常（${PROBE_DETAIL}）；不猜注册态，先人工核" 2
  fi
  if [ "$state_rc" -eq 1 ] && [ "$existed" -eq 0 ]; then
    echo "NOOP not-installed"
    exit 0
  fi
  if [ "$state_rc" -eq 0 ]; then
    local bout="" brc=0
    bout="$("$LAUNCHCTL_BIN" bootout "gui/$(id -u)/$LABEL" 2>&1)"
    brc=$?
    if [ "$brc" -ne 0 ]; then
      if printf '%s' "$bout" | grep -q 'Could not find service'; then
        :   # 注册态已被并发卸掉 ⇒ 幂等放行（不静默：本分支语义即「已不存在」）
      else
        degraded E_BOOTOUT_FAILED "bootout 失败（rc=${brc}）：$(printf '%s' "$bout" | tr '\n' ' ' | cut -c1-200)" 2
      fi
    fi
  fi
  if [ "$existed" -eq 1 ]; then
    if ! rm -f "$PLIST"; then
      degraded E_PLIST_REMOVE_FAILED "plist 删除失败：$PLIST" 2
    fi
  fi
  echo "REMOVED $LABEL"
  exit 0
}

# ── ⑧ 入口 ─────────────────────────────────────────────────────────────────────
usage() {
  cat <<'USAGE'
用法: bash scripts/control-tower/weekly-recon-launchd.sh <install|verify|uninstall>

  install    生成并加载 com.synova.weekly-recon.plist（周一 08:00；幂等，二跑 NOOP）
  verify     逐项核 plist / launchd 注册态 / 日志新鲜度（0 全过 ｜ 1 缺件 ｜ 2 自身失败）
  uninstall  卸载并删除 plist（幂等）

环境注入缝（生产有默认值）:
  SYNO_LAUNCHAGENTS_DIR  SYNO_LAUNCHCTL  SYNO_RECON_LOG  SYNO_RECON_SH  SYNO_GATE_DEGRADED_LOG
USAGE
}

main() {
  if [ "$#" -ne 1 ]; then
    usage
    degraded E_USAGE "需要恰好 1 个子命令（收到 $# 个参数：${*:-无}）" 2
  fi
  case "$1" in
    install) cmd_install ;;
    verify) cmd_verify ;;
    uninstall) cmd_uninstall ;;
    -h|--help|help) usage; exit 0 ;;
    *)
      usage
      degraded E_USAGE "子命令非法：$1（只接受 install｜verify｜uninstall）" 2
      ;;
  esac
}

main "$@"
