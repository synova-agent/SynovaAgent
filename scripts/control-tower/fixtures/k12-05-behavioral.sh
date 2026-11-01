#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# scripts/control-tower/fixtures/k12-05-behavioral.sh — K12-05（#188）行为面夹具
#
# 用途: 为 `probe-knowledge-scope.ts` 的 V2/V3/V4 提供**可复跑环境**（探针本身不替生产起服务）：
#   ① 临时 repo 形内容根：`extensions/presets` 真拷贝 ＋ 其余 extensions 子目录与顶层目录符号链接
#      （`kind=file` refs 按 repoRoot 解析；只拷 presets 会触发 ROLE_PACK_REF_MISSING）
#   ② 临时库（`SYNOVA_DB_PATH`）：探针播种/回查用，禁写主树 data/
#   ③ `JWT_SECRET`（不设 ⇒ /api/auth/register 500）
#   ④ 起真入口 `src/index.ts` → 等 /health → 跑探针 `--base-url --presets-root`
#
# 契约（铁律 47）:
#   @input  — 无参（默认 PORT=18795）；`K12_FIXTURE_PORT` 覆盖端口；
#             `K12_FIXTURE_BREAK=1` 反例注入（不设 JWT_SECRET ⇒ 期望探针非 0）
#   @output — 透传探针 stdout；末行 `FIXTURE_RESULT=PASS|FAIL`；探针原始退出码透传
#   @degraded — 缺 node/npx/curl/服务未就绪 ⇒ exit 2（fail-closed，不当作通过）
#   边界 — 只写 `mktemp -d` 临时根；跑完清理；不改仓库、不改 content-registry、不改探针
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "FIXTURE_RESULT=FAIL (非 git 仓库)"; exit 2; }
PORT="${K12_FIXTURE_PORT:-18795}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/k12-05-fixture.XXXXXX")" || { echo "FIXTURE_RESULT=FAIL (mktemp)"; exit 2; }
TMP_REPO="$TMP/repo"
TMP_DB="$TMP/scope.db"
SERVER_LOG="$TMP/server.log"
SRV_PID=""
cleanup() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  sleep 1
  [ -n "$SRV_PID" ] && kill -9 "$SRV_PID" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

# ① repo 形临时根
mkdir -p "$TMP_REPO/extensions"
cp -R "$REPO_ROOT/extensions/presets" "$TMP_REPO/extensions/presets" || { echo "FIXTURE_RESULT=FAIL (presets copy)"; exit 2; }
for d in "$REPO_ROOT"/extensions/*; do
  b="$(basename "$d")"; [ "$b" = presets ] && continue
  ln -s "$d" "$TMP_REPO/extensions/$b"
done
for e in expert docs packages skills knowledge customer-config cycles src scripts data; do
  [ -e "$REPO_ROOT/$e" ] && ln -s "$REPO_ROOT/$e" "$TMP_REPO/$e"
done

# ② 临时库 + ③ JWT_SECRET
rm -f "$TMP_DB" "$TMP_DB-wal" "$TMP_DB-shm"
if [ "${K12_FIXTURE_BREAK:-0}" = "1" ]; then
  echo "  [反例注入] 不设 JWT_SECRET ⇒ /api/auth/register 预期 500"
  unset JWT_SECRET
else
  export JWT_SECRET="${JWT_SECRET:-k12-fixture-dev-secret-0123456789}"
fi

# ④ 起真入口
cd "$REPO_ROOT" || exit 2
export DEV_MODE=true PORT="$PORT" SYNOVA_DB_PATH="$TMP_DB" SYNOVA_PRESETS_ROOT="$TMP_REPO/extensions/presets"
npx tsx src/index.ts > "$SERVER_LOG" 2>&1 &
SRV_PID=$!
ok=0
for _ in $(seq 1 90); do
  if curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "FIXTURE_RESULT=FAIL (服务未就绪，见 $SERVER_LOG)"
  tail -10 "$SERVER_LOG"
  exit 2
fi

# ⑤ 跑探针
npx tsx scripts/control-tower/probe-knowledge-scope.ts \
  --base-url "http://127.0.0.1:$PORT" --roles finance,hr \
  --presets-root "$TMP_REPO/extensions/presets"
RC=$?
if [ "$RC" -eq 0 ]; then echo "FIXTURE_RESULT=PASS"; else echo "FIXTURE_RESULT=FAIL (exit=$RC)"; fi
exit "$RC"
