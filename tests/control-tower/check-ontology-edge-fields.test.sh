#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-ontology-edge-fields.test.sh — 本体边类型字段回归防线夹具（#1015 G-1 / D1142）
#
# 被测对象 = scripts/control-tower/check-ontology-edge-fields.sh（真实脚本，非副本逻辑）
# 覆盖矩阵（铁律 48 三路径 + 反例 + 接线）:
#   正常 — 树 == 基线（含已交付字段）                    → exit 0
#   改坏 — 删任一已交付字段（action_effect_lag）          → exit 1 且点名文件+字段
#   回滚 — 改回该字段                                    → exit 0（"改坏即红 / 改回即绿"闭环）
#   改坏 — 字段值被清空（`"f": ""`）                      → exit 1
#   改坏 — 整个 edge-type 文件被删                        → exit 1
#   边界 — 新增文件不带字段（交付未完成形态）              → exit 0（计「待交付」，不误拦）
#   边界 — 基线之外的字段值被改写（合法演进）              → exit 0（不当权威源）
#   降级 — 基线 ref 不可解析                              → exit 2 + `degraded:`（不静默通过）
#   降级 — 目录不存在                                     → exit 2
#   降级 — JSON 语法错误（PYBIN 可用时）                   → exit 1
#   接线 — 检查器与夹具均登记在 ci.yml（删掉登记行即红）
#   实况 — 对**真实仓库**跑一次（main 现态应 exit 0；无 origin/main 时显式跳过，不假绿）
#
# 隔离（PLATFORM-CHECKLIST §6）: 全部在 `mktemp -d` 夹具仓内；源工作树只读。
#
# 契约（铁律 47）:
#   @input  — 无参数
#   @output — 逐用例 ✅/❌ + 汇总 + 末行机器可读摘要
#   @exit   — 0 = 全通过 ｜ 1 = 有用例不符 ｜ 2 = 夹具自身失效（沙箱/git 不可用）
#   @degraded — exit 2 且 stderr 以 `degraded:` 起
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/../.." && pwd)"
CHECK="$REPO_DIR/scripts/control-tower/check-ontology-edge-fields.sh"

PASS=0; FAIL=0; FAILED_NAMES=()
ok()  { echo "  ✅ $1"; PASS=$((PASS + 1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); }
degraded() { echo "degraded: $1" >&2; exit 2; }

[ -f "$CHECK" ] || degraded "被测检查器不存在: $CHECK"
command -v git >/dev/null 2>&1 || degraded "git 不可用"

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
W="$SB/repo"
E="$W/extensions/ontology/edge-types"

fixture_init() {
  rm -rf "$W"
  mkdir -p "$E"
  cat > "$E/alpha.json" <<'EOF'
{
  "$id": "edge/alpha",
  "label": "ALPHA",
  "action_effect_lag": "3 months",
  "transfer_function": "outcome = input * f(lag_months)"
}
EOF
  cat > "$E/beta.json" <<'EOF'
{
  "$id": "edge/beta",
  "label": "BETA",
  "transfer_function": "TBD — to be defined in compute phase"
}
EOF
  ( cd "$W" && git init -q . && git add -A && git -c user.name=t -c user.email=t@t commit -q -m "fixture base" ) \
    || degraded "夹具仓初始化失败"
  ( cd "$W" && git update-ref refs/remotes/origin/main HEAD ) || degraded "夹具 origin/main 建立失败"
}

# run <额外参数...> → stdout/stderr 落 $SB/out，退出码落 $SB/rc（全部在夹具仓内跑：ROOT=夹具）
run_check() {
  ( cd "$W" && bash "$CHECK" "$@" ) > "$SB/out" 2>"$SB/err"
  echo "$?" > "$SB/rc"
}
rc_of() { tr -d ' \r\n' < "$SB/rc"; }

echo "═══════════════════════════════════════════════════════════"
echo "  #1015-G1 ontology 边字段回归防线夹具（被测 = 真实检查器）"
echo "═══════════════════════════════════════════════════════════"

# ── 接线断言 ──
grep -q 'check-ontology-edge-fields.sh' "$REPO_DIR/.github/workflows/ci.yml" \
  && ok "接线: 检查器登记在 ci.yml" \
  || bad "接线: 检查器未登记 ci.yml（CI 不跑 = 纸防线）"
grep -q 'check-ontology-edge-fields.test.sh' "$REPO_DIR/.github/workflows/ci.yml" \
  && ok "接线: 本夹具登记在 ci.yml 密封清单" \
  || bad "接线: 本夹具未登记 ci.yml 密封清单"

# ── 1. 正常: 树 == 基线 → 0 ──
fixture_init
run_check
[ "$(rc_of)" = "0" ] && ok "1 正常: 树==基线 → exit 0" || bad "1 正常: 应 exit 0，实得 $(rc_of)"
grep -q 'files=2 present=3 pending=1' "$SB/out" \
  && ok "1 计数正确（2 文件 / 3 已交付字段 / 1 待交付）" \
  || bad "1 计数不符: $(grep ONTOLOGY_EDGE_FIELDS_SUMMARY "$SB/out" || echo '<无汇总行>')"

# ── 2. 改坏: 删任一已交付字段 → 1 且点名 ──
python_or_sed_del_field() {  # $1=文件 $2=字段名（跨平台改写: 用 grep -v 重写，避免 sed -i 方言）
  grep -v "\"$2\"" "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}
python_or_sed_del_field "$E/alpha.json" "action_effect_lag"
run_check
if [ "$(rc_of)" = "1" ]; then ok "2 改坏: 删 action_effect_lag → exit 1"; else bad "2 改坏: 应 exit 1，实得 $(rc_of)"; fi
grep -q '字段被删: alpha.json — action_effect_lag' "$SB/out" \
  && ok "2 点名字段被删（文件+字段+基线）" \
  || bad "2 未点名被删字段: $(head -3 "$SB/out" | tr '\n' '|')"

# ── 3. 回滚: 改回 → 0（闭环）──
fixture_init
run_check
[ "$(rc_of)" = "0" ] && ok "3 回滚: 恢复字段 → exit 0" || bad "3 回滚: 应 exit 0，实得 $(rc_of)"

# ── 4. 改坏: 值被清空 → 1 ──
grep -v '"action_effect_lag"' "$E/alpha.json" > "$E/alpha.tmp"
python3_or_awk_insert() {  # 用 awk 在 $1 的末行 `}` 前插入字段行（跨平台，不用 sed -i）
    awk -v f="$2" 'BEGIN{done=0} /^}/ && !done {print "  \"" f "\": \"\","; done=1} {print}' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}
python3_or_awk_insert "$E/alpha.tmp" "action_effect_lag"
mv "$E/alpha.tmp" "$E/alpha.json"
run_check
if [ "$(rc_of)" = "1" ]; then ok "4 改坏: 字段值为空串 → exit 1"; else bad "4 改坏: 空值应 exit 1，实得 $(rc_of)"; fi
grep -q '值被改坏: alpha.json' "$SB/out" && ok "4 点名空值" || bad "4 未点名空值"

# ── 5. 改坏: 整个文件被删 → 1 ──
fixture_init
rm -f "$E/beta.json"
run_check
if [ "$(rc_of)" = "1" ]; then ok "5 改坏: 删整个 edge-type 文件 → exit 1"; else bad "5 改坏: 应 exit 1，实得 $(rc_of)"; fi
grep -q '文件被删: extensions/ontology/edge-types/beta.json' "$SB/out" \
  && ok "5 点名被删文件（仓库相对路径）" \
  || bad "5 未点名被删文件"

# ── 6. 边界: 新增文件不带字段 → 0（待交付不误拦）──
fixture_init
cat > "$E/gamma.json" <<'EOF'
{
  "$id": "edge/gamma",
  "label": "GAMMA"
}
EOF
run_check
[ "$(rc_of)" = "0" ] && ok "6 边界: 新增无字段文件 → exit 0（待交付，不误拦）" || bad "6 边界: 应 exit 0，实得 $(rc_of)"

# ── 7. 边界: 合法演进（改值/加文件）→ 0 ──
fixture_init
cat > "$E/beta.json" <<'EOF'
{
  "$id": "edge/beta",
  "action_effect_lag": "6 months",
  "transfer_function": "TBD - v2 (值演进，合法)"
}
EOF
run_check
[ "$(rc_of)" = "0" ] && ok "7 边界: 值合法演进（TBD → 新值 / 补字段）→ exit 0（不当权威源）" || bad "7 边界: 应 exit 0，实得 $(rc_of)（$(tail -2 "$SB/out" | tr '\n' '|')）"

# ── 8. 降级: 显式基线 ref 不可解析 → 2（注入缝必须决定性，不静默回退）──
run_check --base "no-such-ref"
if [ "$(rc_of)" = "2" ]; then ok "8 降级: 显式基线不可解析 → exit 2"; else bad "8 降级: 应 exit 2，实得 $(rc_of)"; fi
grep -q '^degraded:' "$SB/err" && ok "8 降级信息落 stderr（degraded: 前缀）" || bad "8 降级信息缺失"

# ── 9. 降级: 目录不存在 → 2 ──
run_check --dir "$SB/not-there"
if [ "$(rc_of)" = "2" ]; then ok "9 降级: 目录不存在 → exit 2"; else bad "9 降级: 应 exit 2，实得 $(rc_of)"; fi

# ── 10. 降级: JSON 语法错误 → 1（PYBIN 可用时；不可用则显式 SKIP）──
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c 'import sys' >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -n "$PYBIN" ]; then
  fixture_init
  printf '{ "broken": \n' > "$E/alpha.json"
  run_check
  if [ "$(rc_of)" = "1" ]; then ok "10 改坏: JSON 语法错误 → exit 1"; else bad "10 改坏: 应 exit 1，实得 $(rc_of)"; fi
else
  echo "  ⏭ SKIP 10: PYBIN 不可用（显式跳过，非静默）"
fi

# ── 11. 实况: 对真实仓库跑一次（main 现态应 0；无 origin/main ⇒ 显式跳过）──
if git -C "$REPO_DIR" rev-parse --verify -q origin/main >/dev/null 2>&1; then
  ( cd "$REPO_DIR" && bash "$CHECK" --quiet ) > "$SB/real.out" 2>"$SB/real.err"; REAL_RC=$?
  if [ "$REAL_RC" = "0" ]; then
    ok "11 实况: 真实仓库现态 exit 0（$(grep ONTOLOGY_EDGE_FIELDS_SUMMARY "$SB/real.out" || echo '无汇总行')）"
  else
    bad "11 实况: 真实仓库现态 exit ${REAL_RC}（检查器红 → 要么现态真有违规，要么判据过严）: $(tail -2 "$SB/real.out" | tr '\n' '|')"
  fi
else
  echo "  ⏭ SKIP 11: 真实仓库无 origin/main ref（显式跳过，非静默）"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then
  D=""
  for n in ${FAILED_NAMES[@]+"${FAILED_NAMES[@]}"}; do D="${D}${n} ; "; done
  echo "❌ FAILED(${FAIL}): ${D}"
  exit 1
fi
echo "ONT_EDGE_FIELDS_TEST_SUMMARY: pass=${PASS} fail=0"
exit 0
