#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# probe-packaging.test.sh — BS-5 打包卫生判据探针 配对测试（U7/CT-40 硬门禁要求）
#
# 被测件: scripts/control-tower/probe-packaging.sh（#1464 登记件 BS-5 acceptance 载体）
#
# 为什么必须有本文件: `scripts/control-tower/**` 是最高风险变更面（D328-D335 一半 P0 在此），
#   CT-40 硬门禁要求控制塔脚本**配对测试且测试绿**（缺配对 = 提交阻断）。
#
# 覆盖矩阵（铁律 48 三路径 —— 正常/降级/边界；**真跑**，非 grep 静态判据）:
#   正常 — 真实仓库（本 worktree）⇒ probe exit 0，且 18 条断言全 PASS
#   正常 — 合成夹具（Dockerfile 完好）⇒ probe exit 0（证明夹具基线本身是可绿的）
#   回归 — 夹具注入 `COPY server/vendor/` ⇒ probe exit 1，且 A1/A2 逐条命中（改坏即红）
#   回归 — 夹具把 OCI 版本标签硬编码 ⇒ probe exit 1，B1/B4 命中
#   边界 — SYNOVA_REPO_ROOT 指向缺 Dockerfile 的空目录 ⇒ probe exit 2（探针自身异常通道）
#   判别力 — 变异体：把 A1 断言改成恒真 ⇒ 应**不再**判红（证明基线红灯来自断言，不是环境噪声）
#
# 契约（铁律 47）:
#   @input  — 无参；读本仓库 scripts/control-tower/probe-packaging.sh
#   @output — 逐条 PASS/FAIL 报告 + 末行结果
#   @degraded — 无降级分支：夹具准备失败 ⇒ FAIL（不静默跳过）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROBE="$REPO/scripts/control-tower/probe-packaging.sh"

PASS=0
FAIL=0
FAILED_NAMES=()

pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); echo "  ❌ $1"; }

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/probe-packaging-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

if [ ! -f "$PROBE" ]; then
  echo "  ❌ 被测件缺失: $PROBE"
  echo "结果: 0 通过, 1 失败"
  exit 1
fi

# ── 夹具构造：探针判定所需的最小文件集 ──────────────────────────────────────────
#   probe A1 会逐条检查 Dockerfile 的**本地** COPY 源是否存在于仓库根
#   ⇒ 夹具须为每条本地 COPY 源建占位（否则 A1 噪声掩盖真实断言）
build_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/scripts/control-tower" "$dir/scripts/desktop" "$dir/electron-renderer"
  cp "$REPO/Dockerfile" "$REPO/package.json" "$REPO/package-lock.json" \
     "$REPO/build-synova.cjs" "$REPO/tsconfig.json" "$REPO/.dockerignore" "$dir/"
  cp "$PROBE" "$dir/scripts/control-tower/"
  cp "$REPO/scripts/desktop/build-backend.sh" "$dir/scripts/desktop/"
  cp "$REPO/electron-renderer/vite.config.ts" "$dir/electron-renderer/"
  # Dockerfile 本地 COPY 源占位（与真实仓库同构的最小形态）
  #   注意: dist/backend.mjs 必须是**文件**（A3 断言 CMD 入口存在）；
  #   `mkdir -p …/dist/backend.mjs` 会误建成目录并令 A3 假红（本测试曾踩）。
  mkdir -p "$dir/packages/dummy" "$dir/vendor/mcp-servers" "$dir/src" \
           "$dir/app" "$dir/electron" "$dir/dist"
  printf '{"name":"@synova/dummy"}\n' > "$dir/packages/dummy/package.json"
  printf '// placeholder\n' > "$dir/src/index.ts"
  printf '// placeholder\n' > "$dir/dist/backend.mjs"
  printf '// placeholder\n' > "$dir/mvp-server.cjs"
}

echo "═══════════════════════════════════════════════════════════"
echo " probe-packaging.test.sh — BS-5 判据探针配对测试"
echo "═══════════════════════════════════════════════════════════"

# ═══ ① 正常路径: 真实仓库 ⇒ exit 0 且断言全 PASS ═══════════════════════════════
REAL_OUT="$(cd "$REPO" && bash "$PROBE" 2>&1)"
REAL_RC=$?
if [ "$REAL_RC" -eq 0 ]; then
  pass "① 真实仓库 probe exit 0"
else
  fail "① 真实仓库 probe exit=${REAL_RC}（期望 0）"
fi
REAL_FAILS="$(printf '%s' "$REAL_OUT" | grep -c '^  \[FAIL\]' || true)"
if [ "${REAL_FAILS:-1}" -eq 0 ]; then
  pass "①b 真实仓库 0 条 [FAIL] 断言"
else
  fail "①b 真实仓库有 ${REAL_FAILS} 条 [FAIL]"
fi
REAL_PASSES="$(printf '%s' "$REAL_OUT" | grep -c '^  \[PASS\]' || true)"
if [ "${REAL_PASSES:-0}" -ge 18 ]; then
  pass "①c 真实仓库 PASS 断言数 ${REAL_PASSES} >= 18（四段覆盖未退化）"
else
  fail "①c 真实仓库 PASS 断言数 ${REAL_PASSES} < 18（断言被删/被跳过）"
fi

# ═══ ② 夹具基线: Dockerfile 完好 ⇒ exit 0（证明夹具本身可绿） ══════════════════
BASE="$TMP_ROOT/base"
build_fixture "$BASE"
BASE_RC=0; ( cd "$BASE" && bash scripts/control-tower/probe-packaging.sh >/dev/null 2>&1 ) || BASE_RC=$?
if [ "$BASE_RC" -eq 0 ]; then
  pass "② 夹具基线（Dockerfile 完好）exit 0 —— 后续红灯归因于变异而非夹具"
else
  fail "② 夹具基线 exit=${BASE_RC}（期望 0；夹具准备有误，后续红灯不可信）"
fi

# ═══ ③ 回归: 注入 COPY server/vendor/ ⇒ 红，且 A1/A2 命中 ═════════════════════
R1="$TMP_ROOT/r1"
build_fixture "$R1"
sed -i.bak 's|^COPY vendor/ ./vendor/|COPY server/vendor/ ./vendor/|' "$R1/Dockerfile" && rm -f "$R1/Dockerfile.bak"
R1_OUT="$(cd "$R1" && bash scripts/control-tower/probe-packaging.sh 2>&1)"; R1_RC=$?
if [ "$R1_RC" -eq 1 ]; then
  pass "③ COPY server/vendor/ ⇒ exit 1（改坏即红）"
else
  fail "③ COPY server/vendor/ 未判红（exit=${R1_RC}）—— A1/A2 是纸老虎"
fi
if printf '%s' "$R1_OUT" | grep -q 'A1 COPY 源路径在仓库内不存在: server/vendor/'; then
  pass "③b A1 精确点名缺失源 server/vendor/"
else
  fail "③b A1 未点名 server/vendor/（断言未覆盖病灶）"
fi
if printf '%s' "$R1_OUT" | grep -q 'A2 Dockerfile 仍有 COPY server/'; then
  pass "③c A2 病灶回归锚命中"
else
  fail "③c A2 病灶回归锚未命中"
fi

# ═══ ④ 回归: OCI 版本标签硬编码 ⇒ B1/B4 命中 ══════════════════════════════════
R2="$TMP_ROOT/r2"
build_fixture "$R2"
sed -i.bak 's|^LABEL org.opencontainers.image.version=.*|LABEL org.opencontainers.image.version="0.2.0"|' "$R2/Dockerfile" && rm -f "$R2/Dockerfile.bak"
R2_OUT="$(cd "$R2" && bash scripts/control-tower/probe-packaging.sh 2>&1)"; R2_RC=$?
if [ "$R2_RC" -eq 1 ] && printf '%s' "$R2_OUT" | grep -q 'B1 Dockerfile 版本标签硬编码'; then
  pass "④ 版本标签硬编码 ⇒ exit 1 且 B1 命中"
else
  fail "④ 版本标签硬编码未触发 B1（exit=${R2_RC}）"
fi
if printf '%s' "$R2_OUT" | grep -q 'B4 Dockerfile 含漂移版本字面量'; then
  pass "④b B4 漂移字面量断言命中"
else
  fail "④b B4 未命中（漂移字面量检测失效）"
fi

# ═══ ⑤ 回归: 镜像不带 package.json ⇒ B6 命中（运行期版本降级防线） ════════════
R3="$TMP_ROOT/r3"
build_fixture "$R3"
sed -i.bak 's|^COPY package.json package-lock.json ./|COPY package-lock.json ./|' "$R3/Dockerfile" && rm -f "$R3/Dockerfile.bak"
R3_OUT="$(cd "$R3" && bash scripts/control-tower/probe-packaging.sh 2>&1)"; R3_RC=$?
if [ "$R3_RC" -eq 1 ] && printf '%s' "$R3_OUT" | grep -q 'B6 Dockerfile 未 COPY package.json'; then
  pass "⑤ 镜像缺 package.json ⇒ exit 1 且 B6 命中"
else
  fail "⑤ B6 未命中（/health 版本降级 0.0.0 防线失效；exit=${R3_RC}）"
fi

# ═══ ⑤-A4 阶段感知判别力（V-08 复发防线；#1464 复核实测 M5/M6 曾暴露零判别力）═══════
#   缺陷史: 原 A4 为全文件 `grep -cE '^COPY vendor/'` —— 不分阶段，却在断言文本声称
#   「进**运行阶段**」。变异体（终镜像无 vendor COPY，仅 builder 段有）⇒ 仍 PASS ⇒ 零判别力。
#   下列两组断言把「按阶段判定」钉死。

# ⑤c 真反例: 终镜像**无任何** vendor COPY（builder 段保留本地 COPY）⇒ A4 必须判红
R6="$TMP_ROOT/r6"
build_fixture "$R6"
python3 - "$R6/Dockerfile" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = 'COPY --from=builder /app/dist ./dist\nCOPY vendor/ ./vendor/'
new = 'COPY --from=builder /app/dist ./dist'
assert old in s, '⑤c 夹具未命中终阶段 vendor COPY 行'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PYEOF
R6_OUT="$(cd "$R6" && bash scripts/control-tower/probe-packaging.sh 2>&1)"; R6_RC=$?
if [ "$R6_RC" -eq 1 ] && printf '%s' "$R6_OUT" | grep -q 'A4 最终阶段无任何 vendor/ COPY'; then
  pass "⑤c 终镜像无 vendor COPY ⇒ exit 1 且 A4 命中（阶段感知真反例）"
else
  fail "⑤c A4 阶段感知失效：终镜像无 vendor COPY 却未判红（exit=${R6_RC}）—— V-08 复发"
fi

# ⑤d 判别力对照: builder 段去掉本地 COPY vendor/（终阶段保留）⇒ **A4 必须仍 PASS**
#     —— 这一组是「按阶段」与「全文件 grep」的分水岭：
#        全文件 grep 在 builder 段缺失时靠终阶段的 COPY 也能过（巧合）；
#        但旧实现真正的问题是反向（终阶段缺失时靠 builder 段误过）。⑤e 用无害变异构造
#        「A4 是唯一差异项」的更纯对照，见下。
R7="$TMP_ROOT/r7"
build_fixture "$R7"
python3 - "$R7/Dockerfile" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = 'COPY packages/ ./packages/\nCOPY vendor/ ./vendor/\n'
new = 'COPY packages/ ./packages/\n'
assert old in s, '⑤d 夹具未命中 builder 段 vendor COPY 行'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PYEOF
R7_OUT="$(cd "$R7" && bash scripts/control-tower/probe-packaging.sh 2>&1)"; R7_RC=$?
if printf '%s' "$R7_OUT" | grep -q 'A4 vendor/ 在最终阶段可见'; then
  pass "⑤d builder 段无本地 vendor COPY、终阶段有 ⇒ A4 仍 PASS（不越界误判）"
else
  fail "⑤d A4 误判：builder 段缺失却判红（阶段边界识别过宽）"
fi

# ⑤e 纯判别力对照（A4 为**唯一**差异项）：以 `--from=builder` 形态满足 A4 且不触及其它断言
#     ⚠️ A3 会断言 CMD 入口 `dist/backend.mjs` 存在 ⇒ 必须补该文件占位（本测试曾漏建致假红）
R8="$TMP_ROOT/r8"
build_fixture "$R8"
rm -rf "$R8/dist"                       # ① 清掉产物面，避免 D2 走 SKIP 之外的形态
mkdir -p "$R8/vendor" "$R8/dist"        # ② 保证 A1 对 vendor/ 源路径断言成立
printf '// placeholder\n' > "$R8/dist/backend.mjs"   # ③ A3 前置：CMD 入口占位
python3 - "$R8/Dockerfile" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
# ④ 删掉 builder 段的 `COPY vendor/`（A1 少一个源 token，仍全存在）
s = s.replace('COPY packages/ ./packages/\nCOPY vendor/ ./vendor/\n',
              'COPY packages/ ./packages/\n', 1)
# ⑤ 终阶段换成 from-stage 形态（A4 合法形态之一）
s = s.replace('COPY --from=builder /app/dist ./dist\nCOPY vendor/ ./vendor/',
              'COPY --from=builder /app/dist ./dist\nCOPY --from=builder /app/vendor ./vendor/', 1)
open(p, 'w', encoding='utf-8').write(s)
PYEOF
R8_OUT="$(cd "$R8" && bash scripts/control-tower/probe-packaging.sh 2>&1)"; R8_RC=$?
if [ "$R8_RC" -eq 0 ] && printf '%s' "$R8_OUT" | grep -q '形态: from-stage'; then
  pass "⑤e 终阶段 from-stage 形态 ⇒ A4 PASS 且整体 exit 0（唯一形态差异不放行也不误杀）"
else
  fail "⑤e from-stage 形态未被 A4 接受（exit=${R8_RC}）—— 合法形态被误杀"
fi

# ═══ ⑤-A6 构建上下文泄漏面（#1464 复核纠错后新增的断言；实测 Docker 规范语义）═══════
#   规范依据: Dockerfile 参考 COPY→Source ——「多源 COPY 只考**具名**源；末位为 dest」
#   ⇒ `COPY package.json package-lock.json ./` **不会**把同级 synova.json 考进镜像。
#   故断言拆两条: ① 无根目录级 COPY 通配 ② 宿主配置件已排除出上下文。

# ⑤f 反例: 把具名文件 COPY 泛化成 `COPY . .` ⇒ A6 必须判红（宿主配置会静默进镜像）
R9="$TMP_ROOT/r9"
build_fixture "$R9"
sed -i.bak 's|^COPY package.json package-lock.json ./|COPY . ./|' "$R9/Dockerfile" && rm -f "$R9/Dockerfile.bak"
R9_OUT="$(cd "$R9" && bash scripts/control-tower/probe-packaging.sh 2>&1)"; R9_RC=$?
if [ "$R9_RC" -eq 1 ] && printf '%s' "$R9_OUT" | grep -q 'A6 Dockerfile 含根目录级 COPY 通配'; then
  pass "⑤f COPY 泛化成 \`COPY . .\` ⇒ exit 1 且 A6 命中（宿主配置静默进镜像的防线）"
else
  fail "⑤f A6 未拦截根目录级 COPY 通配（exit=${R9_RC}）—— 宿主配置可静默进镜像"
fi

# ⑤g 反例: .dockerignore 去掉 synova.json 排除 ⇒ A6b 必须判红（上下文卫生欠账可见）
R10="$TMP_ROOT/r10"
build_fixture "$R10"
printf '{\n  "server": { "port": 18790 }\n}\n' > "$R10/synova.json"
sed -i.bak '/^synova\.json$/d' "$R10/.dockerignore" 2>/dev/null || true
rm -f "$R10/.dockerignore.bak"
R10_OUT="$(cd "$R10" && bash scripts/control-tower/probe-packaging.sh 2>&1)"; R10_RC=$?
if [ "$R10_RC" -eq 1 ] && printf '%s' "$R10_OUT" | grep -q 'A6b 宿主配置件未排除出构建上下文'; then
  pass "⑤g .dockerignore 缺 synova.json 排除 ⇒ exit 1 且 A6b 命中"
else
  fail "⑤g A6b 未命中（exit=${R10_RC}）—— 上下文卫生欠账不可见"
fi

# ═══ ⑥ 降级/边界: 探针自身异常通道 exit 2 ═════════════════════════════════════
EMPTY="$TMP_ROOT/empty"
mkdir -p "$EMPTY/scripts/control-tower" "$EMPTY/scripts/desktop"
cp "$PROBE" "$EMPTY/scripts/control-tower/"
cp "$REPO/package.json" "$REPO/package-lock.json" "$REPO/build-synova.cjs" "$EMPTY/"
cp "$REPO/scripts/desktop/build-backend.sh" "$EMPTY/scripts/desktop/"
E_RC=0; ( cd "$EMPTY" && SYNOVA_REPO_ROOT="$EMPTY" bash scripts/control-tower/probe-packaging.sh >/dev/null 2>&1 ) || E_RC=$?
if [ "$E_RC" -eq 2 ]; then
  pass "⑥ 缺 Dockerfile ⇒ exit 2（探针自身异常通道，非静默放行）"
else
  fail "⑥ 缺 Dockerfile 未走 exit 2（实得 ${E_RC}）—— fail-closed 被破"
fi

EMPTY2="$TMP_ROOT/empty2"
mkdir -p "$EMPTY2/scripts/control-tower" "$EMPTY2/scripts/desktop"
cp "$PROBE" "$EMPTY2/scripts/control-tower/"
cp "$REPO/package.json" "$REPO/package-lock.json" "$REPO/build-synova.cjs" "$EMPTY2/"
cp "$REPO/scripts/desktop/build-backend.sh" "$EMPTY2/scripts/desktop/"
: > "$EMPTY2/Dockerfile"
E2_RC=0; ( cd "$EMPTY2" && SYNOVA_REPO_ROOT="$EMPTY2" bash scripts/control-tower/probe-packaging.sh >/dev/null 2>&1 ) || E2_RC=$?
if [ "$E2_RC" -eq 2 ]; then
  pass "⑥b 空 Dockerfile（COPY 解析失效）⇒ exit 2（判定不可信时不假装通过）"
else
  fail "⑥b 空 Dockerfile 未走 exit 2（实得 ${E2_RC}）"
fi

# ═══ ⑦ 判别力（变异体）: 废掉 A1 断言 ⇒ ③ 的红灯应消失 ═══════════════════════
#   证明 ③ 的红灯来自**断言判别**，而不是夹具/环境的普遍噪声
MUT="$TMP_ROOT/mut"
build_fixture "$MUT"
sed -i.bak 's|if \[ ! -e "${src}" \]; then|if false; then|' "$MUT/scripts/control-tower/probe-packaging.sh" && rm -f "$MUT/scripts/control-tower/probe-packaging.sh.bak"
sed -i.bak 's|^COPY vendor/ ./vendor/|COPY server/vendor/ ./vendor/|' "$MUT/Dockerfile" && rm -f "$MUT/Dockerfile.bak"
MUT_OUT="$(cd "$MUT" && bash scripts/control-tower/probe-packaging.sh 2>&1)"; MUT_RC=$?
if ! printf '%s' "$MUT_OUT" | grep -q 'A1 COPY 源路径在仓库内不存在: server/vendor/'; then
  pass "⑦ 变异体（废 A1）后不再点名 server/vendor/ ⇒ 基线红灯来自断言，非噪声"
else
  fail "⑦ 变异体仍点名 server/vendor/ ⇒ ③ 的归因不成立"
fi
if [ "$MUT_RC" -eq 1 ] && printf '%s' "$MUT_OUT" | grep -q 'A2 Dockerfile 仍有 COPY server/'; then
  pass "⑦b 变异体仍被 A2 判红 ⇒ 病灶有冗余防线（单点断言失效不放过）"
else
  fail "⑦b 变异体未被 A2 判红 ⇒ 病灶仅靠 A1 单点防守"
fi

echo ""
echo "  结果: PASS=${PASS} FAIL=${FAIL}"
echo "═══════════════════════════════════════════════════════════"
# 失败摘要（**必须留在最后一行**：CI 只截 tail -8 进 ::error 注解）
if [ "$FAIL" -gt 0 ]; then
  D1464_DIGEST=""
  for _n in ${FAILED_NAMES[@]+"${FAILED_NAMES[@]}"}; do D1464_DIGEST="${D1464_DIGEST}${_n} ; "; done
  echo "❌ FAILED(${FAIL}): ${D1464_DIGEST}"
fi
[ "$FAIL" -eq 0 ] || exit 1
exit 0
