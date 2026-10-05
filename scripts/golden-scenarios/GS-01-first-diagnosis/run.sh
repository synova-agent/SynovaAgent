#!/bin/bash
# GS-01 首诊旅程场景 — 问卷/诉求入口 → 首诊诊断 → 报告产物可达
# 运行契约（GSS 设计 §2.2 8 条）：fresh-db / bootstrap / inject / trigger / assert / evidence / exit / 幂等
# 说明（D446，2026-08-21）：
#   · 首诊链路 = POST /api/diagnosis/consult（SSE 六阶段诊断，D232/D233 前置已就绪）
#   · 场景验证可机器判定的物理契约：
#     ① 负向：无 JWT 调受保护端点 /api/config/dump → 401（auth 边界，fail-closed）
#     ② 正向：无 JWT 调 consult 缺 initiator.role → 400 且非 401（免 JWT 契约，D590 裁决①）
#     ③ 正常：带 JWT 但缺 teamId → 400 VALIDATION_ERROR（入口可达 + 参数契约）
#     ④ 产物：GET /api/sentinel/reports → 200 ok（报告查询端点可达）
#   · D804 切片 0 口径变更（D1，创始人 2026-09-17 批准）：负向 auth 断言靶点由 consult 迁至
#     /api/config/dump。原靶点在 D590 裁决①（consult 免 JWT 白名单，auth.ts:121）生效后成为
#     恒定红——断言必须描述"已生效契约"，否则红不指向任何真实缺陷（D804 §现状审计 C1/C2）。
#     配套：consult 免 JWT 由正向契约断言（②）接管，fail-closed 覆盖不减弱（迁靶 ≠ 删断言）。
#   · consult 真实六阶段依赖 LLM（非确定性），本场景不硬跑 LLM —— 契约级断言
#     首诊旅程的入口/校验/产物端点，诚实 RED 明确标注（见 README.md）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_DIR="$SCRIPT_DIR/../common"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DATE="$(date +%Y-%m-%d)"

# 0. 自举 JWT（真实客户端行为，复用 GS-03 D462 模式）
JWT_SECRET="gs01-$(date +%s)-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export JWT_SECRET
GS_TOKEN="$(node -e '
  const crypto = require("crypto");
  const secret = process.env.JWT_SECRET;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64({ sub: "gs01-scenario", role: "admin", orgId: "default", iat: now, exp: now + 3600, jti: "gs01-" + now });
  const sig = crypto.createHmac("sha256", secret).update(header + "." + payload).digest("base64url");
  process.stdout.write(header + "." + payload + "." + sig);
')"
AUTH_HEADER="Authorization: Bearer $GS_TOKEN"
echo "[GS-01] JWT_SECRET 已自举（长度 ${#JWT_SECRET}），token 已签发"

# 1. fresh-db（临时库，测后删除；真实库只读；禁止 cp data/synova.db——铁律 0-4）
DATA_DIR="$(cd "$REPO_ROOT" && npx tsx "$COMMON_DIR/fresh-db.ts")"
echo "[GS-01] 临时数据目录: $DATA_DIR"

# 铁律 0-4 隔离加固（D462 模式）：SYNOVA_DB_PATH 显式指向临时库
export SYNOVA_DB_PATH="$DATA_DIR/synova.db"

cleanup() {
  if [[ -f "$DATA_DIR/bootstrap-state.json" ]]; then
    pid="$(python3 -c "import json;print(json.load(open('$DATA_DIR/bootstrap-state.json'))['pid'])" 2>/dev/null || echo "")"
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  fi
  rm -rf "$DATA_DIR" 2>/dev/null || true
  rm -f "$SCRIPT_DIR/expect.runtime.json"
}
trap cleanup EXIT

# 2. bootstrap（临时端口 + healthz 就绪探测）
(cd "$REPO_ROOT" && npx tsx "$COMMON_DIR/bootstrap.ts" --data-dir "$DATA_DIR" --timeout 120 \
  > "$DATA_DIR/bootstrap.log" 2>&1 &)
BOOT_STATE="$DATA_DIR/bootstrap-state.json"
BOOT_READY=""
for _ in $(seq 1 60); do
  if [ -f "$BOOT_STATE" ]; then BOOT_READY="yes"; break; fi
  sleep 2
done
if [ -z "$BOOT_READY" ]; then
  echo "[GS-01] ❌ bootstrap 超时（120s 未就绪）— 日志尾:"
  tail -5 "$DATA_DIR/bootstrap.log" 2>/dev/null || true
  exit 2
fi
PORT="$(python3 -c "import json;print(json.load(open('$BOOT_STATE'))['port'])")"
BASE="http://127.0.0.1:$PORT"
echo "[GS-01] 服务就绪: $BASE"

# 3. 触发 1（负向·auth 边界）：无 token 调受保护端点 /api/config/dump → 401（fail-closed）
#    靶点 = src/routes/config.ts:25（server.ts:385 挂载），未进 auth.ts 白名单 → 全局 jwtAuthMiddleware 拦截
#    （D804 D1：consult 靶点已迁走，理由见文件头"口径变更"）
curl -sS -o "$DATA_DIR/noauth-response.json" -w "%{http_code}" \
  "$BASE/api/config/dump" \
  > "$DATA_DIR/noauth-status.txt" 2>&1 || true
echo "[GS-01] 无 token /api/config/dump HTTP 状态: $(cat "$DATA_DIR/noauth-status.txt")"
echo "[GS-01] 无 token 响应: $(cat "$DATA_DIR/noauth-response.json")"

# 3.5 触发 1b（正向·免 JWT 契约）：无 token 缺 initiator.role 调 consult → 400 且非 401
#     D590 裁决① 正向面：桌面端"配置完 LLM 即可对话"依赖 consult 免 JWT 直达（单机本地信任）。
#     400 证明入口可达且参数校验仍 fail-closed（diagnosis.ts:200-201）；非 401 证明白名单生效。
#     白名单回退（consult 重新要求 JWT）时本断言必红——fail-closed 覆盖由此条承接。
curl -sS -o "$DATA_DIR/consult-noauth-response.json" -w "%{http_code}" \
  -X POST "$BASE/api/diagnosis/consult" \
  -H 'Content-Type: application/json' \
  -d '{"teamId":"t1"}' \
  > "$DATA_DIR/consult-noauth-status.txt" 2>&1 || true
echo "[GS-01] 无 token consult（缺 initiator.role）HTTP 状态: $(cat "$DATA_DIR/consult-noauth-status.txt")"
echo "[GS-01] 无 token consult 响应: $(cat "$DATA_DIR/consult-noauth-response.json")"

# 4. 触发 2（正常·入口校验）：带 token 但缺 teamId → 400 VALIDATION_ERROR
curl -sS -o "$DATA_DIR/validate-response.json" -w "%{http_code}" \
  -X POST "$BASE/api/diagnosis/consult" \
  -H 'Content-Type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"initiator":{"role":"ga"}}' \
  > "$DATA_DIR/validate-status.txt" 2>&1 || true
echo "[GS-01] 缺 teamId HTTP 状态: $(cat "$DATA_DIR/validate-status.txt")"
echo "[GS-01] 缺 teamId 响应: $(cat "$DATA_DIR/validate-response.json")"

# 5. 触发 3（产物端点）：GET /api/sentinel/reports → 200 ok
curl -sS -o "$DATA_DIR/reports-response.json" -w "%{http_code}" \
  -H "$AUTH_HEADER" \
  "$BASE/api/sentinel/reports" \
  > "$DATA_DIR/reports-status.txt" 2>&1 || true
echo "[GS-01] reports HTTP 状态: $(cat "$DATA_DIR/reports-status.txt")"
echo "[GS-01] reports 响应: $(cat "$DATA_DIR/reports-response.json")"

# 5.5 D504 Electron 断言组（静态配置 + 无头契约验证——CI 无 GUI 也能验桌面端产物面）
ELECTRON_DIR="$REPO_ROOT/electron"

# ① L1-1 打包配置：backend-spawn/renderer 产物入包 + extraResources 后端资产
if grep -q "electron/backend-spawn.cjs" "$REPO_ROOT/build-synova.cjs"    && grep -q "dist/renderer" "$REPO_ROOT/build-synova.cjs"    && grep -q "extraResources" "$REPO_ROOT/build-synova.cjs"; then
  echo "PACK_CONFIG_OK" > "$DATA_DIR/electron-pack-check.txt"
else
  echo "PACK_CONFIG_MISSING" > "$DATA_DIR/electron-pack-check.txt"
fi

# ② L1-4 服务自启契约：node 无头直调 backend-spawn（reused 路径——本场景后端已在跑，探活必成功）
#    D527 对齐切片 B prod 契约: prod = process.execPath + ['dist/backend.mjs']（backend.mjs 包内执行，非旧 'node'）
node -e '
  const { ensureBackend, buildCommand } = require(process.argv[1] + "/backend-spawn.cjs");
  (async () => {
    const dev = buildCommand("dev"), prod = buildCommand("prod");
    const prodOk = prod.bin === process.execPath
      && Array.isArray(prod.args) && prod.args.length === 1 && prod.args[0] === "dist/backend.mjs";
    if (dev.bin !== "npx" || !prodOk) { console.error("buildCommand 契约失败:", JSON.stringify({ dev, prod })); process.exit(1); }
    const r = await ensureBackend({
      serverUrl: process.argv[2], cwd: process.argv[3], mode: "dev",
      command: { bin: "never-spawned", args: [] },
    });
    if (r.reused !== true) { console.error("reused 契约失败:", JSON.stringify(r)); process.exit(1); }
    console.log("SPAWN_CONTRACT_OK");
  })().catch((e) => { console.error("spawn 契约异常:", e.message); process.exit(1); });
' "$ELECTRON_DIR" "$BASE" "$REPO_ROOT" > "$DATA_DIR/electron-spawn-check.txt" 2>"$DATA_DIR/electron-spawn-check.err"   || echo "SPAWN_CONTRACT_FAIL" >> "$DATA_DIR/electron-spawn-check.txt"

# ③ L1-5 双引导收敛：main.cjs isPackaged 分支 + prod loadFile renderer
if grep -q "app.isPackaged" "$ELECTRON_DIR/main.cjs"    && grep -q "loadFile" "$ELECTRON_DIR/main.cjs"    && grep -q "renderer" "$ELECTRON_DIR/main.cjs"    && grep -q "ensureBackend" "$ELECTRON_DIR/main.cjs"; then
  echo "DUAL_BOOTSTRAP_OK" > "$DATA_DIR/electron-bootstrap-check.txt"
else
  echo "DUAL_BOOTSTRAP_MISSING" > "$DATA_DIR/electron-bootstrap-check.txt"
fi

# ④ L1-7 数据目录重定向：SYNOVA_DB_PATH 注入 + userData + src/config.ts:90 只读消费
if grep -q "SYNOVA_DB_PATH" "$ELECTRON_DIR/main.cjs"    && grep -q "getPath('userData')" "$ELECTRON_DIR/main.cjs"    && grep -q "SYNOVA_DB_PATH" "$REPO_ROOT/src/config.ts"; then
  echo "DBPATH_REDIRECT_OK" > "$DATA_DIR/electron-dbpath-check.txt"
else
  echo "DBPATH_REDIRECT_MISSING" > "$DATA_DIR/electron-dbpath-check.txt"
fi

# 5.6 D527: LLM 门控真实 consult 组（GS01_LLM=1 时跑真实六阶段；未设则诚实 RED 标注，不伪造绿）
#    产物: consult-llm-status.txt（断言输入）+ consult-llm-stream.txt（SSE 事件流原文，evidence 落盘）
LLM_STREAM="$DATA_DIR/consult-llm-stream.txt"
LLM_STATUS="$DATA_DIR/consult-llm-status.txt"
TIMING_FILE="$DATA_DIR/consult-timing.json"
if [ "${GS01_LLM:-0}" = "1" ]; then
  # macOS BSD date 不支持 %3N（输出字面 N 且 exit 0）——python3 优先跨平台（D536 实测暴露，2026-08-27）
  step_ms() { python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || date +%s%3N 2>/dev/null; }
  TIMING_CONSULT_START="$(step_ms)"
  echo "{\"timing_consult_start_ms\": $TIMING_CONSULT_START}" > "$TIMING_FILE"
  echo "[GS-01] GS01_LLM=1 — 发起真实 consult（teamId=gs01-e2e，SSE 六阶段，最长 15 分钟）"
  set +e
  curl -sS -N --max-time 900 -D "$DATA_DIR/consult-llm-headers.txt" \
    -X POST "$BASE/api/diagnosis/consult" \
    -H 'Content-Type: application/json' \
    -H "$AUTH_HEADER" \
    -d '{"teamId":"gs01-e2e","initiator":{"role":"ga","name":"gs01","concerns":["首诊旅程端到端验证：请对组织做一次全面诊断"]}}' \
    > "$LLM_STREAM" 2>"$DATA_DIR/consult-llm-curl.err"
  CURL_EXIT=$?
  set -e
  # consultId 从响应头 X-Consult-Id 提取（diagnosis.ts:112/119 契约）
  CONSULT_ID="$(grep -i '^x-consult-id:' "$DATA_DIR/consult-llm-headers.txt" | head -1 | tr -d '\r' | sed 's/^[Xx]-[Cc]onsult-[Ii]d:[[:space:]]*//')"
  PHASE_OK=1
  for i in 0 1 2 3 4 5; do
    CNT="$(grep -c "\"type\":\"phase_started\",\"phase\":$i," "$LLM_STREAM")" || CNT=0
    [ "${CNT:-0}" -ge 1 ] || PHASE_OK=0
  done
  HAS_COMPLETE="$(grep -c '"type":"complete"' "$LLM_STREAM")" || HAS_COMPLETE=0
  REPORT_ID="$(grep -o '"reportId":"[^"]*"' "$LLM_STREAM" | head -1 | sed 's/"reportId":"//;s/"//')"
  TIMING_CONSULT_END="$(step_ms)"
  python3 - "$TIMING_FILE" "$TIMING_CONSULT_START" "$TIMING_CONSULT_END" <<'PYEOF'
import json, sys
p, s, e = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = json.load(open(p)); d["timing_consult_end_ms"] = e; d["duration_sec"] = round((e - s) / 1000, 1)
json.dump(d, open(p, "w"))
PYEOF
  if [ "$CURL_EXIT" -ne 0 ]; then
    echo "CONSULT_LLM_RED (curl exit=$CURL_EXIT — SSE 连接失败/超时，见 consult-llm-curl.err)" > "$LLM_STATUS"
  elif [ "$PHASE_OK" = "1" ] && [ "${HAS_COMPLETE:-0}" -ge 1 ] && [ -n "$REPORT_ID" ]; then
    # 报告端点物理断言: GET /consult/:consultId/report → 200（onePager markdown）
    REPORT_CODE="$(curl -sS -o "$DATA_DIR/consult-report.md" -w "%{http_code}" \
      -H "$AUTH_HEADER" "$BASE/api/diagnosis/consult/$CONSULT_ID/report?format=markdown" 2>/dev/null)" || REPORT_CODE=000
    if [ "$REPORT_CODE" = "200" ]; then
      echo "CONSULT_LLM_GREEN phase_started=0-5-complete reportId=$REPORT_ID report_http=200 consultId=$CONSULT_ID" > "$LLM_STATUS"
    else
      echo "CONSULT_LLM_RED (report endpoint HTTP $REPORT_CODE, consultId=$CONSULT_ID)" > "$LLM_STATUS"
    fi
  else
    echo "CONSULT_LLM_RED (phase_started 全 6 缺失或无 complete/reportId — 见 consult-llm-stream.txt)" > "$LLM_STATUS"
  fi
  # P2-2: SSE 事件流原文 + 计时落 evidence（独立于 assert 产物，K3 可独立复核）
  EVIDENCE_DIR_GS="$REPO_ROOT/scripts/golden-scenarios/evidence"
  mkdir -p "$EVIDENCE_DIR_GS"
  cp "$LLM_STREAM" "$EVIDENCE_DIR_GS/GS-01-llm-stream-$DATE.txt"
  cp "$TIMING_FILE" "$EVIDENCE_DIR_GS/GS-01-llm-timing-$DATE.json"
  echo "[GS-01] LLM 组状态: $(cat "$LLM_STATUS")"
else
  echo "CONSULT_LLM_RED (LLM key 未提供 — GS01_LLM 未设置，诚实 RED，不伪造全链路绿)" > "$LLM_STATUS"
  echo "{\"timing_consult_start_ms\": null, \"note\": \"GS01_LLM 未设置，未发起 consult\"}" > "$TIMING_FILE"
  echo "[GS-01] GS01_LLM 未设置 — consult 六阶段断言如实 RED（README §诚实 RED）"
fi

# 6. 断言（expect.json 模板 → 注入 DATA_DIR 实际路径）
sed "s|__DATA_DIR__|$DATA_DIR|g" "$SCRIPT_DIR/expect.json" > "$SCRIPT_DIR/expect.runtime.json"

cd "$REPO_ROOT"
set +e
npx tsx "$COMMON_DIR/assert.ts" \
  --expect "$SCRIPT_DIR/expect.runtime.json" \
  --out "$REPO_ROOT/scripts/golden-scenarios/evidence/GS-01-$DATE.json"
ASSERT_EXIT=$?
set -e
echo "[GS-01] 断言 exit: $ASSERT_EXIT"
exit "$ASSERT_EXIT"
