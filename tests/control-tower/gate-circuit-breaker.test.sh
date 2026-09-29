#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# gate-circuit-breaker.test.sh — D1061 任务 3: 门禁熔断 + 元监控
#
# 覆盖矩阵（铁律 48 三路径 + 健康行契约 + 到期棘轮 + 熔断口径）:
#   正常 — 无登记 → should-skip rc=0（照跑）；health-line status=OK
#   正常 — 生效登记 → should-skip rc=3（跳过）+ degraded 留痕 + 可见告警；health-line KNOWN-FAULT
#   降级 — 登记表**损坏** → rc=2（fail-closed，绝不当"通过"）；登记表**缺失** → 视为空表（照跑）
#   边界 — expires 已过期 → **不跳**（rc=0）+ 告警 + health-line DEGRADED
#   边界 — 熔断口径: 连续 1 次同因失败 → OK；连续 2 次 → DEGRADED（CTO 裁定阈值 = 2）
#   边界 — 缺 owner/evidence → selfcheck rc=1（无责任人/无证据 = 不可审计）
#   契约 — 健康行格式逐字段冻结（键序固定 + ASCII 前缀 + ISO8601）
#   变异体 — 删掉 expires 校验 → 过期项仍跳过 → 本文件「过期必须不跳」断言必红
#
# 沙箱: SYNO_* 注入，零真实目录、零网络
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CB="$REPO/scripts/control-tower/gate-circuit-breaker.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

reg() { # $1=文件名 $2=gates JSON 数组
  printf '{"schema":"gate-incident-registry/1.0","gates":%s}\n' "$2" > "$TMPD/$1"
  echo "$TMPD/$1"
}
R_ACTIVE="$(reg active.json '[{"gate_id":"g-broken","owner":"D9999","expires":"2999-12-31","evidence":"docs/x.md"}]')"
R_EXPIRED="$(reg expired.json '[{"gate_id":"g-broken","owner":"D9999","expires":"2000-01-01","evidence":"docs/x.md"}]')"
R_NOFIELDS="$(reg nofields.json '[{"gate_id":"g-x","owner":"","expires":"2999-12-31","evidence":""}]')"
printf '{"broken":\n' > "$TMPD/corrupt.json"
printf '%s\n' \
  '{"time":"2026-09-29T01:00:00Z","gate":"g-flaky","result":"hit","branch":"b"}' \
  '{"time":"2026-09-29T02:00:00Z","gate":"g-flaky","result":"hit","branch":"b"}' > "$TMPD/hits2.jsonl"
head -1 "$TMPD/hits2.jsonl" > "$TMPD/hits1.jsonl"

run() { SYNO_CT_DIR="$TMPD/ct" SYNO_GATE_DEGRADED_LOG="$TMPD/ct/logs/degraded-events.log" "$@"; }

echo "=== D1061 任务 3: 门禁熔断 + 元监控 ==="

# ── 正常: 无登记（登记表缺失）→ 照跑；health-line OK ──
OUT="$(SYNO_GATE_INCIDENT_REGISTRY="$TMPD/nonexistent.json" bash "$CB" --should-skip g-x 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "正常: 无登记 → should-skip rc=0（照跑）" || no "正常: rc=${RC}（期望 0）"
LINE="$(SYNO_GATE_INCIDENT_REGISTRY="$TMPD/nonexistent.json" SYNO_GATE_HITS_LOG="$TMPD/none.jsonl" bash "$CB" --health-line 2>&1)"; RC=$?
printf '%s' "$LINE" | grep -q '^GATE-HEALTH: status=OK ' && ok "正常: 无故障 → health-line status=OK" || no "正常: health-line 异常 → $LINE"

# ── 正常: 生效登记 → 跳过(3) + degraded 留痕 + 可见告警 ──
OUT="$(run env SYNO_GATE_INCIDENT_REGISTRY="$R_ACTIVE" bash "$CB" --should-skip g-broken 2>&1)"; RC=$?
[ "$RC" -eq 3 ] && ok "正常: 生效登记 → should-skip rc=3（跳过）" || no "正常: rc=${RC}（期望 3）"
printf '%s' "$OUT" | grep -q "熔断" && ok "正常: 跳过有**可见**告警（stderr）" || no "正常: 跳过无可见告警"
if [ -f "$TMPD/ct/logs/degraded-events.log" ] && grep -q "gate-circuit-breaker" "$TMPD/ct/logs/degraded-events.log"; then
  ok "正常: 跳过已写 degraded-events.log（铁律 11 留痕）"
else
  no "正常: degraded-events.log 未留痕（跳过=静默，违反铁律 11）"
fi
LINE="$(SYNO_GATE_INCIDENT_REGISTRY="$R_ACTIVE" SYNO_GATE_HITS_LOG="$TMPD/none.jsonl" bash "$CB" --health-line 2>&1)"
printf '%s' "$LINE" | grep -q 'status=KNOWN-FAULT known=1 ' && ok "正常: 生效登记 → status=KNOWN-FAULT known=1" || no "正常: → $LINE"

# ── 边界: expires 过期 → 不跳 + 告警 + DEGRADED ──
OUT="$(SYNO_GATE_INCIDENT_REGISTRY="$R_EXPIRED" bash "$CB" --should-skip g-broken 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "边界: 登记已过期 → **不跳** rc=0（棘轮语义）" || no "边界: rc=${RC}（过期必须不跳 = 0）"
printf '%s' "$OUT" | grep -q "过期" && ok "边界: 过期有可见告警" || no "边界: 过期无告警"
LINE="$(SYNO_GATE_INCIDENT_REGISTRY="$R_EXPIRED" SYNO_GATE_HITS_LOG="$TMPD/none.jsonl" bash "$CB" --health-line 2>&1)"; RC=$?
printf '%s' "$LINE" | grep -q 'status=DEGRADED .*expired=1' && ok "边界: 过期 → status=DEGRADED expired=1" || no "边界: → $LINE"
[ "$RC" -eq 1 ] && ok "边界: DEGRADED 的 health-line rc=1（需人介入）" || no "边界: DEGRADED rc=${RC}（期望 1）"

# ── 降级: 登记表损坏 → fail-closed exit 2 ──
OUT="$(SYNO_GATE_INCIDENT_REGISTRY="$TMPD/corrupt.json" bash "$CB" --should-skip g-broken 2>&1)"; RC=$?
[ "$RC" -eq 2 ] && ok "降级: 登记表损坏 → rc=2（fail-closed，绝不当通过）" || no "降级: rc=${RC}（期望 2）"
printf '%s' "$OUT" | grep -q "不跳过" && ok "降级: 损坏时明确声明**不给熔断通道**" || no "降级: 损坏时未声明 fail-closed 语义"

# ── 边界: 熔断口径（连续 2 次同因才告警）──
LINE1="$(SYNO_GATE_INCIDENT_REGISTRY="$TMPD/nonexistent.json" SYNO_GATE_HITS_LOG="$TMPD/hits1.jsonl" bash "$CB" --health-line 2>&1)"; RC1=$?
LINE2="$(SYNO_GATE_INCIDENT_REGISTRY="$TMPD/nonexistent.json" SYNO_GATE_HITS_LOG="$TMPD/hits2.jsonl" bash "$CB" --health-line 2>&1)"; RC2=$?
printf '%s' "$LINE1" | grep -q 'status=OK' && [ "$RC1" -eq 0 ] \
  && ok "边界: 连续 1 次同因失败 → OK（单次是间歇，不告警）" || no "边界: 单次 → $LINE1 rc=$RC1"
printf '%s' "$LINE2" | grep -q 'status=DEGRADED' && [ "$RC2" -eq 1 ] \
  && ok "边界: 连续 2 次同因失败 → DEGRADED（阈值 = 2）" || no "边界: 两次 → $LINE2 rc=$RC2"

# ── 边界: 缺 owner/evidence → selfcheck rc=1 ──
OUT="$(SYNO_GATE_INCIDENT_REGISTRY="$R_NOFIELDS" bash "$CB" --selfcheck 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "边界: 缺 owner/evidence → selfcheck rc=1" || no "边界: selfcheck rc=${RC}（期望 1）"
printf '%s' "$OUT" | grep -q "缺 owner 或 evidence" && ok "边界: selfcheck 点名缺失字段" || no "边界: selfcheck 未点名缺失字段"

# ── 契约: 健康行格式冻结 ──
LINE="$(SYNO_GATE_INCIDENT_REGISTRY="$TMPD/nonexistent.json" SYNO_GATE_HITS_LOG="$TMPD/none.jsonl" bash "$CB" --health-line 2>&1)"
if printf '%s' "$LINE" | grep -qE '^GATE-HEALTH: status=(OK|DEGRADED|KNOWN-FAULT) known=[0-9]+ expired=[0-9]+ sources=[0-9]+ checked_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; then
  ok "契约: 健康行逐字段匹配冻结格式（键序固定 + ISO8601）"
else
  no "契约: 健康行不符冻结格式 → $LINE"
fi
N_KEYS="$(printf '%s' "$LINE" | grep -oE '[a-z_]+=' | tr '\n' ' ')"
[ "$N_KEYS" = "status= known= expired= sources= checked_at= " ] \
  && ok "契约: 键序固定 status→known→expired→sources→checked_at" || no "契约: 键序异常 → $N_KEYS"

# ── 接线: 健康行可被面板按 ASCII 前缀检索（D963 读法）──
printf '%s' "$LINE" | grep -q '^GATE-HEALTH: ' && ok "接线: ASCII 前缀 'GATE-HEALTH: ' 可检索" || no "接线: 前缀不可检索"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
# 变异体（改坏即红，本卡实测贴于 B 证据）:
#   把 should-skip 的 ACTIVE/EXPIRED 分支合并（删掉 expires 判定，permanent skip）
#   → 上方「边界: 登记已过期 → 不跳 rc=0」与「过期 → DEGRADED」必红。
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
