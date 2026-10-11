#!/usr/bin/env bash
# tests/tui-v2/harness/run-v3-faketty.sh — #1348 V3 取证驱动（假 TTY；本沙箱禁 openpty）
#
# 用法: bash run-v3-faketty.sh <natural|reject|null> <输出前缀>
#   · natural : TUI_1348_FAULT=none —— 真实生产入口原样跑（无注入）
#   · reject  : 受控注入：「:418」调用点 reject
#   · null    : 受控注入：「:418」调用点 resolve(null)
# 产物: <前缀>.frames.txt（ink 帧原始流）｜<前缀>.console.txt（fd1/fd2：console.log + pino warn/error + harness 标记）
#       <前缀>.stub-requests.log（假 LLM 请求流水，证 TUI 真走完 N 轮真实 LLM 调用）
set -u

MODE="${1:?用法: run-v3-faketty.sh <natural|reject|null> <输出前缀>}"
OUTPFX="${2:?缺少输出前缀}"

WT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$WT" || exit 1

export NVM_DIR="$HOME/.nvm"
# nvm.sh 未做 set -u 兼容 ⇒ 关掉 nounset 再 source（脚本自身其余部分仍走 -u 语义）
set +u
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1
set -u
command -v node >/dev/null 2>&1 || { echo "FATAL: node 不在 PATH（nvm 未加载）"; exit 127; }

export TERM=xterm-256color
# ── 留档防覆盖（根因修复，2026-10-09）──
# 与 #1466 同型：写死共享路径的产物可被覆盖 ⇒ 证据静默消失。以下四种留档任一存在即拒绝运行。
if [ "${TUI_ALLOW_OVERWRITE:-0}" != "1" ]; then
  _existing=""
  for _f in "${OUTPFX}.frames.txt" "${OUTPFX}.console.txt" "${OUTPFX}.stub-requests.log" "${OUTPFX}.stub-server.log"; do
    [ -e "$_f" ] && _existing="$_existing $_f"
  done
  if [ -n "$_existing" ]; then
    echo "REFUSE-OVERWRITE: 既有留档存在:${_existing}" >&2
    echo "（如需覆盖请显式 TUI_ALLOW_OVERWRITE=1；推荐改用带时间戳的新前缀）" >&2
    exit 3
  fi
fi

export STUB_PORT="${STUB_PORT:-18123}"
export STUB_LOG="${OUTPFX}.stub-requests.log"
export LLM_API_KEY="sk-stub-1348"
export LLM_BASE_URL="http://127.0.0.1:${STUB_PORT}/v1"
export LLM_MODEL="stub-model"

: > "$STUB_LOG"
"${TUI_NODE_BIN:-node}" "$WT/tests/tui-v2/harness/llm-stub-server.mjs" > "${OUTPFX}.stub-server.log" 2>&1 &
STUB_PID=$!
sleep 1

# 可选：切到干净 cwd（避免污染工作树 data/；bootstrap 用 process.cwd() 建 DB）
if [ -n "${TUI_CWD:-}" ]; then
  mkdir -p "$TUI_CWD"
  cd "$TUI_CWD" || exit 1
fi

TUI_1348_OUT="${OUTPFX}.frames.txt" \
TUI_1348_FAULT="$MODE" \
TUI_1348_LOG_VISIBLE="${TUI_1348_LOG_VISIBLE:-1}" \
"${TUI_NODE_BIN:-node}" ${TUI_NODE_FLAGS:-} "$WT/node_modules/tsx/dist/cli.mjs" "$WT/tests/tui-v2/harness/run-prod-faketty.ts" \
  > "${OUTPFX}.console.txt" 2>&1
RC=$?

kill "$STUB_PID" 2>/dev/null  # swallow-ok: 清理路径，stub 可能已自行退出（非降级逻辑）

echo "mode=$MODE rc=$RC frames=$(wc -c < "${OUTPFX}.frames.txt" | tr -d ' ') bytes console=$(wc -c < "${OUTPFX}.console.txt" | tr -d ' ') bytes"
echo "--- 残留进程检查 ---"
pgrep -fl "run-prod-faketty|llm-stub-server" || echo "(无残留)"

echo "--- 留档指纹（sha256 前 16；防后改/后覆盖）---"
for _f in "${OUTPFX}.frames.txt" "${OUTPFX}.console.txt" "${OUTPFX}.stub-requests.log"; do
  [ -e "$_f" ] && printf "%-52s %s\n" "$_f" "$(shasum -a 256 "$_f" | cut -c1-16)"
done
