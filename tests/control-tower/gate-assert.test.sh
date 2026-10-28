#!/bin/bash
# @requires bash
# ═══════════════════════════════════════════════════════════════════════════════
# gate-assert.test.sh — #1096 判据自检库配对测试（CT-40；只读被测件 ＋ mktemp 沙箱）
#
# 覆盖矩阵（铁律 48: 正常/降级/边界 ＋ 改坏必红；ctrl-tower-change 模式 1: 三态 0/1/2）:
#   正常 — ① exit 0 ⇒ 0 ｜ ② exit 1 ⇒ 1 ｜ ③ exit 2 ⇒ 2（且**不得**出现「判据故障」行）
#   降级 — ④ exit 128 ⇒ 2 ＋ stderr `判据故障: 128`（🔴 关键判据：128 绝不当 0）
#          ⑤ exit 137 ⇒ 2 ＋ `判据故障: 137` ｜ ⑥ exit 126 ⇒ 2 ＋ `判据故障: 126`
#          ⑦ 命令不存在 ⇒ 2 ＋ `判据故障: 127` ｜ ⑧ 其它非白名单码 42 ⇒ 2 ＋ `判据故障: 42`
#   边界 — ⑨ 用法错（缺判据名／缺命令）⇒ 2（fail-closed，不是 0 也不是 1）
#          ⑩ 输出透传：判据的 stdout/stderr 原样透传，不被本库重排或吞
#          ⑪ `|| true` 吞错场景：库**看不见**被吞掉的错（如实记 0，不冒充「已检出」）＋
#             自证执行行无 `|| true`（库自己绝不清洗退出码）
#   自检 — ⑫ 入口自检：`--selfcheck`（真 spawn）与 `SYNO_GA_DRY=1`（零 spawn）均 exit 0
#   改坏必红 — ⑬ 变异体：sed 把归一函数 128 分支替成 0 ⇒ 同一 128 断言翻成 0（证明该断言承重）
#
# 注入缝: SYNO_GA_SUT=<path> 指定被测件（**变异证据**用；默认生产件）。判据 = 改坏即红：
#         `SYNO_GA_SUT=<变异体> bash tests/control-tower/gate-assert.test.sh` **必须** exit 1。
# 隔离: mktemp -d ＋ trap 清理；零网络、零宿主仓库写入、不触真实仓库。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="${SYNO_GA_SUT:-$REPO/scripts/control-tower/gate-assert.sh}"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
ERRF="$TMPD/stderr.log"

[ -f "$S" ] || { echo "❌ 缺被测件: $S（检查自身失败）"; exit 2; }

OUT_RC=0; OUT_STDOUT=""; OUT_STDERR=""
run_ga_sut() { # <被测件> <判据名> -- <命令...> → OUT_RC / OUT_STDOUT / OUT_STDERR
  local _s="$1" _n="$2"; shift 2
  OUT_STDOUT="$(bash -c 'source "$1"; shift; ga_run "$@"' _ "$_s" "$_n" "$@" 2>"$ERRF")"
  OUT_RC=$?
  OUT_STDERR="$(cat "$ERRF")"
}
run_ga() { local _n="$1"; shift; run_ga_sut "$S" "$_n" "$@"; }

echo "═══════════════════════════════════════════════════════════"
echo "  #1096 判据自检库 · ga_run 三态归一（128 不当 0）"
echo "═══════════════════════════════════════════════════════════"

# ── ① 正常透传 ──
run_ga "判据0" -- bash -c 'exit 0'
[ "$OUT_RC" -eq 0 ] && ok "① exit 0 ⇒ 0（通过透传）" || no "① exit 0 ⇒ 期望 0 实得 ${OUT_RC}"
case "$OUT_STDERR" in
  *"判据故障"*) no "① 通过路径不应有「判据故障」行" ;;
  *) ok "① 通过路径无「判据故障」行" ;;
esac

# ── ② 真红透传（不得被当 0）──
run_ga "判据1" -- bash -c 'exit 1'
[ "$OUT_RC" -eq 1 ] && ok "② exit 1 ⇒ 1（真红透传，不被当 0）" || no "② exit 1 ⇒ 期望 1 实得 ${OUT_RC}"

# ── ③ 判据自身失败透传（2 是合法结论，不打「判据故障」）──
run_ga "判据2" -- bash -c 'exit 2'
[ "$OUT_RC" -eq 2 ] && ok "③ exit 2 ⇒ 2（判据自身失败透传）" || no "③ exit 2 ⇒ 期望 2 实得 ${OUT_RC}"
case "$OUT_STDERR" in
  *"判据故障"*) no "③ exit 2 不应被标成「判据故障」（2 是合法三态）" ;;
  *) ok "③ exit 2 不标「判据故障」（三态语义不被混淆）" ;;
esac

# ── ④ 🔴 关键：128 ⇒ 2（判据故障），绝不当 0 ──
run_ga "判据128" -- bash -c 'exit 128'
[ "$OUT_RC" -eq 2 ] && ok "④ exit 128 ⇒ 2（判据故障）" || no "④ exit 128 ⇒ 期望 2 实得 ${OUT_RC}"
[ "$OUT_RC" -ne 0 ] && ok "④ exit 128 不是 0（绝不当通过）" || no "④ exit 128 被当成 0 —— 关键判据失效"
case "$OUT_STDERR" in
  *"判据故障: 128"*) ok "④ stderr 点名「判据故障: 128」" ;;
  *) no "④ stderr 缺「判据故障: 128」；实际: ${OUT_STDERR}" ;;
esac

# ── ⑤ 137（SIGKILL 语义码）⇒ 2 ──
run_ga "判据137" -- bash -c 'exit 137'
[ "$OUT_RC" -eq 2 ] && ok "⑤ exit 137 ⇒ 2（判据故障）" || no "⑤ exit 137 ⇒ 期望 2 实得 ${OUT_RC}"
case "$OUT_STDERR" in
  *"判据故障: 137"*) ok "⑤ stderr 点名「判据故障: 137」" ;;
  *) no "⑤ stderr 缺「判据故障: 137」" ;;
esac

# ── ⑥ 126（不可执行/权限）⇒ 2 ──
run_ga "判据126" -- bash -c 'exit 126'
[ "$OUT_RC" -eq 2 ] && ok "⑥ exit 126 ⇒ 2（判据故障）" || no "⑥ exit 126 ⇒ 期望 2 实得 ${OUT_RC}"
case "$OUT_STDERR" in
  *"判据故障: 126"*) ok "⑥ stderr 点名「判据故障: 126」" ;;
  *) no "⑥ stderr 缺「判据故障: 126」" ;;
esac

# ── ⑦ 命令不存在 ⇒ 2（前置探测，不把 127 当 0）──
run_ga "判据缺命令" -- __synova_ga_no_such_command__
[ "$OUT_RC" -eq 2 ] && ok "⑦ 命令不存在 ⇒ 2（判据故障）" || no "⑦ 命令不存在 ⇒ 期望 2 实得 ${OUT_RC}"
case "$OUT_STDERR" in
  *"判据故障: 127"*) ok "⑦ stderr 点名「判据故障: 127」" ;;
  *) no "⑦ stderr 缺「判据故障: 127」" ;;
esac

# ── ⑧ 其它非白名单码（42）⇒ 2 ──
run_ga "判据42" -- bash -c 'exit 42'
[ "$OUT_RC" -eq 2 ] && ok "⑧ exit 42（白名单外）⇒ 2" || no "⑧ exit 42 ⇒ 期望 2 实得 ${OUT_RC}"
case "$OUT_STDERR" in
  *"判据故障: 42"*) ok "⑧ stderr 点名「判据故障: 42」" ;;
  *) no "⑧ stderr 缺「判据故障: 42」" ;;
esac

# ── ⑨ 用法错 ⇒ 2（fail-closed；既不 0 也不 1）──
bash -c 'source "$1"; ga_run' _ "$S" >"$TMPD/u1" 2>"$ERRF"; RC_U1=$?
[ "$RC_U1" -eq 2 ] && ok "⑨a 缺判据名 ⇒ 2（用法错 fail-closed）" || no "⑨a 缺判据名 ⇒ 期望 2 实得 ${RC_U1}"
bash -c 'source "$1"; ga_run "判据X" --' _ "$S" >"$TMPD/u2" 2>"$ERRF"; RC_U2=$?
[ "$RC_U2" -eq 2 ] && ok "⑨b 缺命令 ⇒ 2（用法错 fail-closed）" || no "⑨b 缺命令 ⇒ 期望 2 实得 ${RC_U2}"
bash "$S" --bogus >"$TMPD/u3" 2>&1; RC_U3=$?
[ "$RC_U3" -eq 2 ] && ok "⑨c 未知参数 ⇒ 2（不静默忽略）" || no "⑨c 未知参数 ⇒ 期望 2 实得 ${RC_U3}"

# ── ⑩ 输出透传（stdout/stderr 原样）──
run_ga "判据透传" -- bash -c 'echo STDOUT_MARK_1096; echo STDERR_MARK_1096 >&2'
case "$OUT_STDOUT" in
  *"STDOUT_MARK_1096"*) ok "⑩ 判据 stdout 原样透传" ;;
  *) no "⑩ 判据 stdout 被吞: ${OUT_STDOUT}" ;;
esac
case "$OUT_STDERR" in
  *"STDERR_MARK_1096"*) ok "⑩ 判据 stderr 原样透传" ;;
  *) no "⑩ 判据 stderr 被吞" ;;
esac

# ── ⑪ `|| true` 吞错场景：库看不见被吞的错（如实记 0，不冒充检出）──
run_ga "判据吞错" -- bash -c 'false || true'
[ "$OUT_RC" -eq 0 ] && ok "⑪ 判据内部 \`|| true\` 吞错后返回 0 —— 库如实记 0（已知限制，非「已检出」）" \
                     || no "⑪ 期望 0（库无法看见被吞的错）实得 ${OUT_RC}"
if [ "$(grep -c 'if "$@"; then' "$S")" -eq 1 ]; then
  ok "⑪ 执行行唯一（单点执行，无旁路）"
else
  no "⑪ 执行行不唯一（$(grep -c 'if "$@"; then' "$S") 处）"
fi
EXEC_LINE="$(grep -n 'if "$@"; then' "$S" | head -1)"
case "$EXEC_LINE" in
  *'|| true'*) no "⑪ 库执行行含 \`|| true\`（把自己变成吞错点）" ;;
  *) ok "⑪ 库执行行无 \`|| true\`（不自造吞错）" ;;
esac

# ── ⑫ 入口自检（DRY 零 spawn ／ selfcheck 真 spawn）──
bash "$S" --selfcheck >"$TMPD/sc1" 2>&1; RC_SC1=$?
[ "$RC_SC1" -eq 0 ] && ok "⑫a --selfcheck ⇒ 0（真 spawn 自检）" || no "⑫a --selfcheck ⇒ 期望 0 实得 ${RC_SC1}"
grep -q 'SELFCHECK: OK' "$TMPD/sc1" && ok "⑫a 输出含 SELFCHECK: OK" || no "⑫a 缺 SELFCHECK: OK 末行"
SYNO_GA_DRY=1 bash "$S" >"$TMPD/sc2" 2>&1; RC_SC2=$?
[ "$RC_SC2" -eq 0 ] && ok "⑫b SYNO_GA_DRY=1 ⇒ 0（归一表自检，零 spawn）" || no "⑫b SYNO_GA_DRY=1 ⇒ 期望 0 实得 ${RC_SC2}"
grep -q 'SELFCHECK(DRY): OK' "$TMPD/sc2" && ok "⑫b 输出含 SELFCHECK(DRY): OK" || no "⑫b 缺 SELFCHECK(DRY): OK 末行"

# ── ⑬ 改坏即红：sed 把归一函数 128 分支替成 0 ⇒ 同一断言必翻红 ──
MUT="$TMPD/gate-assert-mut.sh"
sed 's/^    128).*/    128) printf 0 ;;/' "$S" > "$MUT"
if grep -q '128) printf 0' "$MUT"; then
  ok "⑬ 变异体已注入（128 分支 ⇒ 0）"
else
  no "⑬ 变异体注入失败（sed 未命中 128 分支）"
fi
run_ga_sut "$MUT" "判据128" -- bash -c 'exit 128'
if [ "$OUT_RC" -eq 0 ]; then
  ok "⑬ 变异体把 128 归成 0（⇒ 用例④ 必红；证明该断言承重）"
else
  no "⑬ 变异体未改变结论（实得 ${OUT_RC}）—— 用例④ 对该变异无判别力"
fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
