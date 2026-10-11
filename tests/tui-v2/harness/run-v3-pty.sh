#!/usr/bin/env bash
# tests/tui-v2/harness/run-v3-pty.sh — #1348 V3 生产入口 PTY 取证驱动
#
# 用法: bash run-v3-pty.sh <natural|reject|null> <输出文件>
#
# · natural : 直接跑真实生产入口 `tsx src/tui-v2/chat.tsx`（= npm run tui），无注入
# · reject  : 跑 tests/tui-v2/harness/entry-with-fault.ts（先注入再 import 同一生产入口）
# · null    : 同上，注入形态为 resolve(null)
# 终端：`script -q <file>` 提供真实 PTY（ink 需要 TTY）；输入经 FIFO 喂入。
set -u

MODE="${1:?用法: run-v3-pty.sh <natural|reject|null> <输出文件>}"
OUT="${2:?缺少输出文件路径}"
STEP="${STEP:-6}"

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
export STUB_PORT="${STUB_PORT:-18123}"
export STUB_LOG="${OUT}.stub-requests.log"
export LLM_API_KEY="sk-stub-1348"
export LLM_BASE_URL="http://127.0.0.1:${STUB_PORT}/v1"
export LLM_MODEL="stub-model"

: > "$STUB_LOG"
node "$WT/tests/tui-v2/harness/llm-stub-server.mjs" > "${OUT}.stub-server.log" 2>&1 &
STUB_PID=$!
sleep 1

FIFO="$(mktemp -u "${TMPDIR:-/tmp}/tui1348-XXXXXX").fifo"
mkfifo "$FIFO"

ENTRY="src/tui-v2/chat.tsx"
if [ "$MODE" != "natural" ]; then
  ENTRY="tests/tui-v2/harness/entry-with-fault.ts"
fi

# 喂键：boot → 三轮访谈（第 3 轮 '好的' 命中 detectPhaseComplete ⇒ phaseComplete）→ /help（降级不阻断）→ /quit 收口
(
  sleep 10
  printf '你好\r';                     sleep "$STEP"
  printf '我们是一家 20 人的公司\r';    sleep "$STEP"
  printf '好的\r';                     sleep "$((STEP * 2 + 2))"
  printf '/help\r';                    sleep "$STEP"
  printf '/quit\r';                    sleep 3
  printf '\003'
  sleep 2
) > "$FIFO" &
FEED_PID=$!

TUI_1348_FAULT="$MODE" \
TUI_1348_LOG_VISIBLE="${TUI_1348_LOG_VISIBLE:-1}" \
script -q "$OUT" "$WT/node_modules/.bin/tsx" "$ENTRY" < "$FIFO" > /dev/null 2>&1
SCRIPT_RC=$?

wait "$FEED_PID" 2>/dev/null  # swallow-ok: 清理路径，喂键子进程可能已结束（非降级逻辑）
kill "$STUB_PID" 2>/dev/null  # swallow-ok: 清理路径，stub 可能已自行退出（非降级逻辑）
rm -f "$FIFO"

echo "mode=$MODE script_rc=$SCRIPT_RC out=$OUT bytes=$(wc -c < "$OUT" | tr -d ' ')"
echo "--- 残留进程检查 ---"
pgrep -fl "tui-v2/chat.tsx|entry-with-fault.ts" || echo "(无残留)"
