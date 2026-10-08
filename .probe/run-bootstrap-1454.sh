#!/bin/bash
# run-bootstrap-1454.sh — #1454 判据 V2 的可复跑测量件（真实启动入口）
#
# 口径：走**真实进程入口** `src/index.ts` → `src/init/agent-entry` → `src/server.ts`
#       → `new Bootstrap()`（6 Phase）→ Phase 2 内部 DAG 2a∥2d → 2b → 2c → **2e**。
#       Phase 2e 即 `getGlobalScheduler(db)`（CronScheduler 构造 → restoreJobs 逐行 nextCronTime）。
# 只读产物：日志（stderr，pino JSON 行）→ 从 `Phase 2 子 Phase 完成` 行取 2c/2e 的 durationMs。
#
# 用法: run-bootstrap-1454.sh <树根> <数据目录> <端口> <标签>
# 输出: ready_ms（进程起 ~ healthz 可应答）、日志路径；日志内嵌各 Phase durationMs
set -u
TREE="$1"; DATA="$2"; PORT="$3"; TAG="$4"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
mkdir -p "$DATA" /tmp/synova-1454
LOG="/tmp/synova-1454/$TAG.log"

cd "$TREE" || exit 2
PORT="$PORT" SYNOVA_DATA_DIR="$DATA" DEV_MODE=false npx tsx src/index.ts >"$LOG" 2>&1 &
PID=$!

T0=$(node -e 'console.log(Date.now())')
READY=0
for _ in $(seq 1 300); do
  BODY=$(curl -sS -m 3 "http://127.0.0.1:$PORT/api/healthz" 2>/dev/null || true)
  case "$BODY" in
    *'"status"'*) READY=1; break;;
  esac
  kill -0 "$PID" 2>/dev/null || break   # 进程已退出
  sleep 1
done
T1=$(node -e 'console.log(Date.now())')

echo "tag=$TAG tree=$TREE ready=$READY ready_ms=$((T1-T0)) pid=$PID log=$LOG"
if [ -n "${BODY:-}" ]; then echo "healthz_body=$(printf '%s' "$BODY" | head -c 400)"; fi
kill "$PID" 2>/dev/null || true
sleep 1
kill -9 "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
