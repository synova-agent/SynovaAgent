#!/usr/bin/env bash
# weekly-recon-launchd.test.sh —— #828 安装器判据测试（T1–T9；HOME 隔离＋假 launchctl，不触系统 launchd）
#
# 三态退出码：0 = ALL PASS ｜ 1 = 断言失败（逐条打印具体失败点）｜ 2 = 环境失败
#   （缺 plutil／被测安装器或本体脚本缺失／假 launchctl 未被 PATH 解析到 —— 禁把「看不见」当「没问题」）。
#
# 隔离（🔴 绝不调用真 launchctl／真 install）:
#   · TMP=$(mktemp -d) ＋ trap 清理；HOME 重定向到 $TMP/home
#   · PATH="$TMP/bin:$PATH" 注入假 launchctl（先断言 command -v launchctl == $TMP/bin/launchctl，否则 exit 2）
#   · SYNO_RECON_LOG / SYNO_GATE_DEGRADED_LOG 全部重定向到 $TMP（不碰真 /tmp 日志与仓内降级日志）
#   · 假 launchctl 把每次调用追加到 $TMP/launchd.calls，注册态落 $TMP/launchd.state（未注册时
#     list 返 1、print 返 113＋Could not find service，与真 launchctl 判别形态一致）
#
# 覆盖矩阵（规格 §4 判据 1/3/5/6 ＋ 编码指令 §4 T1–T9）:
#   T1 install：exit 0、INSTALLED、plist 存在且 plutil -lint 过、必需键/值齐、键集合恰为契约集、
#      无凭据样式、RunAtLoad=false、打印 sha256 与实测一致、bootstrap 恰 1 次
#   T2 幂等（反例 c）：二跑 NOOP already-installed、sha256 不变、假 bootstrap 调用次数不增
#   T2x 同字节未注册：只补 bootstrap，不重写 plist（inode/mtime 不变）
#   T3 verify：exit 0、PLIST_OK＋LAUNCHCTL_OK＋LOG_FRESH(none-yet)（全新安装宽限）
#   T4 反例 b（判别力）：plutil -remove StartCalendarInterval ⇒ verify exit 1＋PLIST_BAD 点名；
#      install 恢复后 verify 回 0（证明红是「内容缺键」而非环境）
#   T5 反例 a：uninstall ⇒ 0、plist 删、verify exit 1＋PLIST_MISSING；二次 uninstall ⇒ 0＋NOOP
#   T6 日志新鲜度：新鲜日志 ⇒ LOG_FRESH(<8d)；8 天前 ⇒ LOG_STALE(>8d) exit 1；
#      无日志且 plist 超 8 天 ⇒ LOG_STALE(absent) exit 1
#   T7 自身失败：launchctl 不可用 ⇒ exit 2＋stderr degraded: code=＋降级 JSONL 落盘；非 Darwin ⇒ exit 2
#   T8 WIRE CHECK：grep -rn "weekly-recon-launchd" tests/ scripts/ 非零，且命中本测试＋AGENTS.md 报备行＋安装器
#   T9 契约头：两脚本 bash -n；头注要素齐；两文件所有 2>/dev/null 行均带 swallow-ok 或同行兜底
#
# 变异注入缝（供独立自验在 /tmp 副本上做「删 StartCalendarInterval 生成段 ⇒ 本测试必红」）:
#   SYNO_RECON_LAUNCHD_INSTALLER=<副本路径> bash tests/control-tower/weekly-recon-launchd.test.sh
set -u

export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true   # swallow-ok: 无 C.UTF-8 locale 的环境保留默认（UTF-8 已由上一行兜底）

ROOT="$(cd "$(dirname "$0")/../.." && pwd)" || { echo "ENV-FAIL: 无法定位仓库根（dirname=$0）"; exit 2; }
cd "$ROOT" || { echo "ENV-FAIL: 无法 cd $ROOT"; exit 2; }

INSTALLER="${SYNO_RECON_LAUNCHD_INSTALLER:-$ROOT/scripts/control-tower/weekly-recon-launchd.sh}"
RECON_SH="$ROOT/scripts/control-tower/weekly-recon.sh"
LABEL="com.synova.weekly-recon"
PLIST_NAME="$LABEL.plist"

TMP="$(mktemp -d)" || { echo "ENV-FAIL: mktemp -d 失败"; exit 2; }
pass_n=0
fail_n=0
OUT=""
ERR=""
RC=0

cleanup() {
  if [ "$fail_n" -gt 0 ]; then
    echo "夹具保留（失败排查）: $TMP"
  else
    rm -rf "$TMP" 2>/dev/null || true   # swallow-ok: 收尾清理失败不影响断言结论
  fi
}
trap cleanup EXIT INT TERM

# ── 环境隔离（全部落 $TMP；禁碰真 launchd／真日志）──────────────────────────────
export HOME="$TMP/home"
export FAKE_CALLS="$TMP/launchd.calls"
export FAKE_STATE="$TMP/launchd.state"
export SYNO_LAUNCHAGENTS_DIR="$HOME/Library/LaunchAgents"
export SYNO_GATE_DEGRADED_LOG="$TMP/degraded.log"
export SYNO_RECON_LOG="$TMP/recon-launchd.log"
export SYNO_RECON_SH="$RECON_SH"
export PATH="$TMP/bin:$PATH"
PLIST="$SYNO_LAUNCHAGENTS_DIR/$PLIST_NAME"

mkdir -p "$SYNO_LAUNCHAGENTS_DIR" "$TMP/bin" "$TMP/bin-nonmac" || {
  echo "ENV-FAIL: 无法建 $TMP 夹具目录"
  exit 2
}
: > "$FAKE_CALLS"

# 假 launchctl：调用落 $FAKE_CALLS，注册态落 $FAKE_STATE（未注册 list rc1 无输出、print rc113）
cat > "$TMP/bin/launchctl" <<'FAKE'
#!/bin/bash
set -u
CALLS="${FAKE_CALLS:?}"
STATE="${FAKE_STATE:?}"
LABEL="com.synova.weekly-recon"
printf '%s\n' "$*" >> "$CALLS" || exit 9
is_registered() { [ -f "$STATE" ] && grep -qx "$LABEL" "$STATE"; }
cmd="${1:-}"
case "$cmd" in
  list)
    if is_registered; then echo "-	0	$LABEL"; exit 0; fi
    exit 1 ;;
  print)
    if is_registered; then echo '{"Label" = "'"$LABEL"'";}'; exit 0; fi
    echo "Could not find service \"$LABEL\" in domain for port" >&2
    exit 113 ;;
  bootstrap)
    printf '%s\n' "$LABEL" >> "$STATE"
    exit 0 ;;
  bootout)
    if is_registered; then
      grep -vx "$LABEL" "$STATE" > "$STATE.tmp" || :
      mv "$STATE.tmp" "$STATE"
      exit 0
    fi
    echo "Could not find service \"$LABEL\" in domain for port" >&2
    exit 113 ;;
  *)
    echo "fake-launchctl: 未实现子命令 $*" >&2
    exit 64 ;;
esac
FAKE
chmod +x "$TMP/bin/launchctl"

# 假 uname（只用于 T7 非 Darwin 判别；不参与其余用例）
cat > "$TMP/bin-nonmac/uname" <<'SH'
#!/bin/bash
echo Linux
SH
chmod +x "$TMP/bin-nonmac/uname"

# ── 环境前置（缺一 ⇒ exit 2，禁把「看不见」当「没问题」）────────────────────────
if ! command -v plutil >/dev/null 2>&1; then   # swallow-ok: 探测型，缺失即显式 ENV-FAIL exit 2
  echo "ENV-FAIL: 缺 plutil（无法校验/解析 plist）"
  exit 2
fi
if [ ! -f "$INSTALLER" ]; then
  echo "ENV-FAIL: 缺被测安装器 $INSTALLER"
  exit 2
fi
if [ ! -f "$RECON_SH" ]; then
  echo "ENV-FAIL: 缺 weekly-recon.sh 本体 $RECON_SH"
  exit 2
fi
RESOLVED_LAUNCHCTL="$(command -v launchctl)"
if [ "$RESOLVED_LAUNCHCTL" != "$TMP/bin/launchctl" ]; then
  echo "ENV-FAIL: 假 launchctl 未生效（command -v launchctl -> ${RESOLVED_LAUNCHCTL:-<空>}）"
  exit 2
fi

# ── 断言小工具 ────────────────────────────────────────────────────────────────
ok()  { pass_n=$((pass_n + 1)); echo "PASS $1${2:+（$2）}"; }
bad() { fail_n=$((fail_n + 1)); echo "FAIL $1 —— $2"; }
t_exit() { if [ "$2" = "$3" ]; then ok "$1" "exit=$3"; else bad "$1" "期望 exit=$2 实际=$3"; fi; }
has() {
  if printf '%s\n' "$2" | grep -qE -- "$3"; then ok "$1"; else
    bad "$1" "输出未命中 /$3/；实际前 6 行: $(printf '%s\n' "$2" | head -6 | tr '\n' '|')"
  fi
}
hasnt() {
  if printf '%s\n' "$2" | grep -qE -- "$3"; then
    bad "$1" "输出不应命中 /$3/；命中: $(printf '%s\n' "$2" | grep -E -- "$3" | head -3 | tr '\n' '|')"
  else ok "$1"; fi
}
eq() { if [ "$2" = "$3" ]; then ok "$1" "$3"; else bad "$1" "期望 '$2' 实际 '$3'"; fi; }
run() { OUT="$("$INSTALLER" "$@" 2>"$TMP/stderr.log")"; RC=$?; ERR="$(cat "$TMP/stderr.log")"; }
bootstrap_calls() { grep -c '^bootstrap' "$FAKE_CALLS" 2>/dev/null || true; }   # swallow-ok: 计数工具失败落空/0，由断言判红

# ══════════════════════════════════════════════════════════════════════════════
# T1 install（首个安装）
# ══════════════════════════════════════════════════════════════════════════════
echo "── T1 install（首个安装）──"
rm -f "$PLIST" "$FAKE_STATE"
run install
t_exit "T1a install exit" 0 "$RC"
has "T1b INSTALLED 行" "$OUT" '^INSTALLED com\.synova\.weekly-recon$'
if [ -f "$PLIST" ]; then ok "T1c plist 存在" "$PLIST"; else bad "T1c plist 存在" "缺 $PLIST"; fi
if plutil -lint "$PLIST" >/dev/null 2>&1; then ok "T1d plutil -lint"; else bad "T1d plutil -lint" "plist 未通过 lint"; fi   # swallow-ok: lint 结论走返回码
eq "T1e Label" "$LABEL" "$(plutil -extract Label raw -o - "$PLIST" 2>/dev/null)"   # swallow-ok: 缺键落空值，由 eq 判红
eq "T1f ProgramArguments.0" "/bin/bash" "$(plutil -extract 'ProgramArguments.0' raw -o - "$PLIST" 2>/dev/null)"   # swallow-ok: 同上
eq "T1g ProgramArguments.1（本体绝对路径）" "$RECON_SH" "$(plutil -extract 'ProgramArguments.1' raw -o - "$PLIST" 2>/dev/null)"   # swallow-ok: 同上
eq "T1h Weekday=1（周一）" "1" "$(plutil -extract 'StartCalendarInterval.Weekday' raw -o - "$PLIST" 2>/dev/null)"   # swallow-ok: 同上
eq "T1i Hour=8" "8" "$(plutil -extract 'StartCalendarInterval.Hour' raw -o - "$PLIST" 2>/dev/null)"   # swallow-ok: 同上
eq "T1j Minute=0" "0" "$(plutil -extract 'StartCalendarInterval.Minute' raw -o - "$PLIST" 2>/dev/null)"   # swallow-ok: 同上
eq "T1k StandardOutPath" "$SYNO_RECON_LOG" "$(plutil -extract StandardOutPath raw -o - "$PLIST" 2>/dev/null)"   # swallow-ok: 同上
eq "T1l StandardErrorPath" "$SYNO_RECON_LOG" "$(plutil -extract StandardErrorPath raw -o - "$PLIST" 2>/dev/null)"   # swallow-ok: 同上
eq "T1m RunAtLoad=false" "false" "$(plutil -extract RunAtLoad raw -o - "$PLIST" 2>/dev/null)"   # swallow-ok: 同上
ACTUAL_KEYS="$(grep -oE '<key>[A-Za-z]+</key>' "$PLIST" | sed -E 's#</?key>##g' | LC_ALL=C sort -u | tr '\n' ' ')"
EXPECT_KEYS="Hour Label Minute ProgramArguments RunAtLoad StandardErrorPath StandardOutPath StartCalendarInterval Weekday "
eq "T1n 键集合恰为契约集（无 EnvironmentVariables 等）" "$EXPECT_KEYS" "$ACTUAL_KEYS"
hasnt "T1o plist 无凭据样式" "$(cat "$PLIST")" 'EnvironmentVariables|<key>[^<]*(Token|Secret|Password|PASSWD|API_KEY)'
SHA1="$(shasum -a 256 "$PLIST" | awk '{print $1}')"
has "T1p 打印 sha256 与实测一致" "$OUT" "^sha256=${SHA1}$"
eq "T1q 首次 bootstrap 恰 1 次" "1" "$(bootstrap_calls)"
if [ -f "$FAKE_STATE" ] && grep -qx "$LABEL" "$FAKE_STATE"; then ok "T1r 假注册态=已注册"; else bad "T1r 假注册态=已注册" "未注册"; fi
hasnt "T1s install 无 degraded" "$ERR" 'degraded: code='

# ══════════════════════════════════════════════════════════════════════════════
# T2 幂等（反例 c）：二跑 NOOP、sha256 不变、bootstrap 次数不增
# ══════════════════════════════════════════════════════════════════════════════
echo "── T2 幂等（反例 c）──"
B1="$(bootstrap_calls)"
run install
t_exit "T2a 二跑 exit" 0 "$RC"
has "T2b NOOP already-installed" "$OUT" '^NOOP already-installed$'
has "T2c 二跑仍报同一 sha256" "$OUT" "^sha256=${SHA1}$"
SHA2="$(shasum -a 256 "$PLIST" | awk '{print $1}')"
eq "T2d plist sha256 不变（反例 c）" "$SHA1" "$SHA2"
eq "T2e 假 bootstrap 调用次数不增" "$B1" "$(bootstrap_calls)"

echo "── T2x 同字节但未注册：只补 bootstrap，不重写 plist ──"
INO1="$(stat -f %i "$PLIST")"
MTIME1="$(stat -f %m "$PLIST")"
rm -f "$FAKE_STATE"
B2="$(bootstrap_calls)"
run install
t_exit "T2f exit" 0 "$RC"
has "T2g BOOTSTRAPPED 行" "$OUT" '^BOOTSTRAPPED com\.synova\.weekly-recon'
eq "T2h plist 未重写（inode 不变）" "$INO1" "$(stat -f %i "$PLIST")"
eq "T2i plist 未重写（mtime 不变）" "$MTIME1" "$(stat -f %m "$PLIST")"
eq "T2j bootstrap +1" "$((B2 + 1))" "$(bootstrap_calls)"
if [ -f "$FAKE_STATE" ] && grep -qx "$LABEL" "$FAKE_STATE"; then ok "T2k 补 bootstrap 后已注册"; else bad "T2k 补 bootstrap 后已注册" "未注册"; fi

# ══════════════════════════════════════════════════════════════════════════════
# T3 verify（全新安装宽限 none-yet）
# ══════════════════════════════════════════════════════════════════════════════
echo "── T3 verify（全新安装宽限）──"
run verify
t_exit "T3a verify exit" 0 "$RC"
has "T3b PLIST_OK" "$OUT" '^PLIST_OK$'
has "T3c LAUNCHCTL_OK" "$OUT" '^LAUNCHCTL_OK$'
has "T3d LOG_FRESH(none-yet)" "$OUT" '^LOG_FRESH\(none-yet\)'
hasnt "T3e 无 degraded 行" "$ERR" 'degraded: code='

# ══════════════════════════════════════════════════════════════════════════════
# T4 反例 b（判别力）：摘 StartCalendarInterval ⇒ verify 必红；install 可恢复
# ══════════════════════════════════════════════════════════════════════════════
echo "── T4 反例 b：摘 StartCalendarInterval 必红 ──"
plutil -remove StartCalendarInterval "$PLIST" >/dev/null 2>&1   # swallow-ok: 仅造坏夹具，失败由后续 verify 断言暴露
run verify
t_exit "T4a verify exit" 1 "$RC"
has "T4b PLIST_BAD" "$OUT" '^PLIST_BAD\('
has "T4c 点名缺键" "$OUT" 'StartCalendarInterval'
run install
t_exit "T4d install 恢复 exit" 0 "$RC"
has "T4e REINSTALLED 行" "$OUT" '^REINSTALLED com\.synova\.weekly-recon$'
eq "T4f 恢复后 Weekday=1" "1" "$(plutil -extract 'StartCalendarInterval.Weekday' raw -o - "$PLIST" 2>/dev/null)"   # swallow-ok: 缺键落空值由 eq 判红
run verify
t_exit "T4g 恢复后 verify exit" 0 "$RC"

# ══════════════════════════════════════════════════════════════════════════════
# T5 反例 a：uninstall 后 verify 必红；uninstall 幂等
# ══════════════════════════════════════════════════════════════════════════════
echo "── T5 反例 a：uninstall ⇒ verify 必红 ＋ 幂等 ──"
run uninstall
t_exit "T5a uninstall exit" 0 "$RC"
if [ -f "$PLIST" ]; then bad "T5b plist 已删" "仍存在 $PLIST"; else ok "T5b plist 已删"; fi
has "T5c bootout 已调用" "$(cat "$FAKE_CALLS")" '^bootout '
run verify
t_exit "T5d verify exit" 1 "$RC"
has "T5e PLIST_MISSING" "$OUT" '^PLIST_MISSING'
run uninstall
t_exit "T5f 二次 uninstall exit" 0 "$RC"
has "T5g NOOP not-installed" "$OUT" '^NOOP not-installed$'

# ══════════════════════════════════════════════════════════════════════════════
# T6 日志新鲜度判别（<8d / >8d / absent）
# ══════════════════════════════════════════════════════════════════════════════
echo "── T6 日志新鲜度判别 ──"
run install
t_exit "T6a 重装 exit" 0 "$RC"
: > "$SYNO_RECON_LOG"
run verify
t_exit "T6b 新鲜日志 exit" 0 "$RC"
has "T6c LOG_FRESH(<8d)" "$OUT" '^LOG_FRESH\(<8d\)'
touch -t 202001010000 "$SYNO_RECON_LOG"
run verify
t_exit "T6d 旧日志 exit" 1 "$RC"
has "T6e LOG_STALE(>8d)" "$OUT" '^LOG_STALE\(>8d\)'
run install
t_exit "T6f 重装 exit" 0 "$RC"
rm -f "$SYNO_RECON_LOG"
touch -t 202001010000 "$PLIST"
run verify
t_exit "T6g 无日志且 plist 旧 exit" 1 "$RC"
has "T6h LOG_STALE(absent)" "$OUT" '^LOG_STALE\(absent\)'

# ══════════════════════════════════════════════════════════════════════════════
# T7 自身失败（launchctl 不可用 / 非 Darwin）⇒ exit 2 ＋ degraded
# ══════════════════════════════════════════════════════════════════════════════
echo "── T7 自身失败：环境不可信 ⇒ exit 2 ＋ degraded ──"
OUT="$(SYNO_LAUNCHCTL=/nonexistent/launchctl "$INSTALLER" verify 2>"$TMP/stderr.log")"
RC=$?
ERR="$(cat "$TMP/stderr.log")"
t_exit "T7a launchctl 不可用 exit" 2 "$RC"
has "T7b stderr degraded: code=" "$ERR" 'degraded: code='
has "T7c 点名 E_ENV_NO_LAUNCHCTL" "$ERR" 'E_ENV_NO_LAUNCHCTL'
has "T7d 降级 JSONL 落盘" "$(cat "$SYNO_GATE_DEGRADED_LOG" 2>/dev/null)" '"code":"E_ENV_NO_LAUNCHCTL"'   # swallow-ok: 日志缺失落空值，由 has 判红
OUT="$(PATH="$TMP/bin-nonmac:$PATH" "$INSTALLER" verify 2>"$TMP/stderr.log")"
RC=$?
ERR="$(cat "$TMP/stderr.log")"
t_exit "T7e 非 Darwin exit" 2 "$RC"
has "T7f 点名 E_ENV_NOT_MAC" "$ERR" 'E_ENV_NOT_MAC'

# ══════════════════════════════════════════════════════════════════════════════
# T8 WIRE CHECK（判据 6）
# ══════════════════════════════════════════════════════════════════════════════
echo "── T8 WIRE CHECK ──"
WIRE="$(grep -rn "weekly-recon-launchd" tests/ scripts/ || true)"
if [ -n "$WIRE" ]; then
  ok "T8a WIRE 非零" "$(printf '%s\n' "$WIRE" | grep -c .) 处命中"
else
  bad "T8a WIRE 非零" "grep 零命中（未接线）"
fi
has "T8b 命中本测试" "$WIRE" 'tests/control-tower/weekly-recon-launchd\.test\.sh'
has "T8c 命中 AGENTS.md 报备行" "$WIRE" 'tests/control-tower/AGENTS\.md'
has "T8d 命中安装器本体" "$WIRE" 'scripts/control-tower/weekly-recon-launchd\.sh'

# ══════════════════════════════════════════════════════════════════════════════
# T9 契约头要素 ＋ bash -n ＋ 吞错标注合规（两脚本）
# ══════════════════════════════════════════════════════════════════════════════
echo "── T9 契约头 ＋ bash -n ──"
if bash -n "$INSTALLER" 2>"$TMP/bashn.txt"; then ok "T9a 安装器 bash -n"; else bad "T9a 安装器 bash -n" "$(cat "$TMP/bashn.txt")"; fi
if bash -n "$0" 2>"$TMP/bashn2.txt"; then ok "T9b 本测试 bash -n"; else bad "T9b 本测试 bash -n" "$(cat "$TMP/bashn2.txt")"; fi
for token in "@input" "@output" "@exit" "@degraded" "@error" "设计哲学" "explicit authority" \
             "Known Limitations" "Source map" "Win 不适用"; do
  if grep -qF -- "$token" "$INSTALLER"; then ok "T9c 契约头要素: $token"; else bad "T9c 契约头要素: $token" "未找到 $token"; fi
done
BAD_SWALLOW="$(grep -n '2>/dev/null' "$INSTALLER" | grep -v 'swallow-ok' | grep -vE '\|\||&&' || true)"   # swallow-ok: 本行即合规扫描器自身
eq "T9d 安装器 2>/dev/null 行全带 swallow-ok/兜底" "" "$BAD_SWALLOW"
BAD_SWALLOW_TEST="$(grep -n '2>/dev/null' "$0" | grep -v 'swallow-ok' | grep -vE '\|\||&&' || true)"   # swallow-ok: 本行即合规扫描器自身
eq "T9e 测试自身 2>/dev/null 行全带 swallow-ok/兜底" "" "$BAD_SWALLOW_TEST"

# ── 汇总 ──────────────────────────────────────────────────────────────────────
echo "────────────────────────────────────────────────"
echo "PASS=$pass_n FAIL=$fail_n"
echo "结果: ${pass_n} 通过, ${fail_n} 失败"
if [ "$fail_n" -eq 0 ]; then
  echo "ALL PASS（T1–T9，$pass_n 项断言；判据测试三态：0=ALL PASS）"
  exit 0
fi
echo "❌ 断言失败 $fail_n 项（exit 1 = 真红）"
exit 1
