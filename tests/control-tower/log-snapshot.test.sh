#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# log-snapshot.test.sh — 门禁日志有界归档脚本测试（铁律 48：正常/边界/降级三路径）
# 用例: A 正常快照+索引 | B 超上限截尾 | C 缺失日志降级不失败 | D 保留份数轮转
#       E dry-run 不写盘 | F 死文件位被显式标出
# 运行: bash tests/control-tower/log-snapshot.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/control-tower/log-snapshot.sh"
PASS=0; FAIL=0

t() { # $1=用例名 $2=期望 $3=实际
  if [ "$2" = "$3" ]; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1 (期望 $2 实际 $3)"; FAIL=$((FAIL+1)); fi
}

FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
mkdir -p "$FIX/logs"
LOG_G="$FIX/logs/gate-hits.log"
LOG_P="$FIX/logs/pre-commit-failures.log"
LOG_D="$FIX/logs/degraded-events.log"
LOG_DEAD="$FIX/logs/degraded-events-dead.log"
SNAP="$FIX/snapshots"

export SYNO_LOG_GATE_HITS="$LOG_G"
export SYNO_LOG_PRECOMMIT_FAILURES="$LOG_P"
export SYNO_LOG_DEGRADED="$LOG_D"
export SYNO_LOG_DEAD_DEGRADED="$LOG_DEAD"
export SYNO_LOG_SNAPSHOT_DIR="$SNAP"

# ── A: 正常路径 ────────────────────────────────────────────────────────────────
printf '{"gate":"g1"}\n{"gate":"g2"}\n' > "$LOG_G"
printf 'fail-1\n' > "$LOG_P"
printf '{"component":"x"}\n' > "$LOG_D"
printf 'dead\n' > "$LOG_DEAD"
OUT=$(bash "$SCRIPT" 2>/dev/null); RC=$?
t "A 正常路径 exit=0" 0 "$RC"
t "A gate-hits state=ok" ok "$(echo "$OUT" | awk -F'\t' '$1=="gate-hits"{print $2}')"
t "A degraded 活账本被取到" ok "$(echo "$OUT" | awk -F'\t' '$1=="degraded-events"{print $2}')"
t "A 快照路径不夹带死文件行" 0 "$(echo "$OUT" | grep -c '死文件')"
t "A 索引已写" 1 "$([ -f "$SNAP/index.json" ] && echo 1 || echo 0)"
t "A 快照数=3" 3 "$(ls -1 "$SNAP"/*.log 2>/dev/null | wc -l | tr -d ' ')"

# ── B: 边界——超上限截尾 ───────────────────────────────────────────────────────
rm -rf "$SNAP"; head -c 4096 /dev/zero | tr '\0' 'a' > "$LOG_D"
OUT=$(bash "$SCRIPT" --max-bytes 1024 2>/dev/null)
t "B 超上限 state=truncated" truncated "$(echo "$OUT" | awk -F'\t' '$1=="degraded-events"{print $2}')"
t "B 快照被截到上限" 1024 "$(wc -c < "$(ls -1 "$SNAP"/degraded-events-*.log)" | tr -d ' ')"
t "B 恰好等于上限不截尾" ok "$(bash "$SCRIPT" --max-bytes 1024 2>/dev/null </dev/null >/dev/null; head -c 1024 /dev/zero | tr '\0' 'b' > "$LOG_D"; bash "$SCRIPT" --max-bytes 1024 2>/dev/null | awk -F'\t' '$1=="degraded-events"{print $2}')"

# ── C: 降级——日志缺失不判失败 ─────────────────────────────────────────────────
rm -rf "$SNAP"; rm -f "$LOG_G" "$LOG_P" "$LOG_D" "$LOG_DEAD"
OUT=$(bash "$SCRIPT" 2>/dev/null); RC=$?
t "C 全缺失 exit=0（降级不硬失败）" 0 "$RC"
t "C 缺失 state=missing" 3 "$(echo "$OUT" | awk -F'\t' '$2=="missing"' | wc -l | tr -d ' ')"
ERR=$(bash "$SCRIPT" 2>&1 >/dev/null)
t "C 缺失有显式告警（不静默）" 1 "$([ "$(echo "$ERR" | grep -c 'degraded')" -ge 1 ] && echo 1 || echo 0)"

# ── D: 保留份数轮转 ────────────────────────────────────────────────────────────
rm -rf "$SNAP"; printf 'x\n' > "$LOG_G"; printf 'y\n' > "$LOG_P"; printf 'z\n' > "$LOG_D"
for i in 1 2 3; do bash "$SCRIPT" --keep 2 >/dev/null 2>&1; sleep 1.05; done
t "D --keep 2 每类留 2 份" 6 "$(ls -1 "$SNAP"/*.log | wc -l | tr -d ' ')"

# ── E: dry-run 不写盘 ──────────────────────────────────────────────────────────
rm -rf "$SNAP"; printf 'dead\n' > "$LOG_DEAD"   # 死文件位需存在才可被标出（C 用例已删）
OUT=$(bash "$SCRIPT" --dry-run 2>/dev/null); RC=$?
t "E dry-run exit=0" 0 "$RC"
t "E dry-run 不建快照目录" 0 "$([ -d "$SNAP" ] && echo 1 || echo 0)"
t "E dry-run 报状态" dry-run "$(echo "$OUT" | awk -F'\t' '$1=="gate-hits"{print $2}')"
t "E dry-run 标出死文件位（令点名路径）" dead "$(echo "$OUT" | awk -F'\t' '$1 ~ /死文件/{print $2}')"

# ── F: 参数校验（用法错误 exit=1）─────────────────────────────────────────────
bash "$SCRIPT" --max-bytes abc >/dev/null 2>&1; t "F 非法 --max-bytes exit=1" 1 $?
bash "$SCRIPT" --keep abc >/dev/null 2>&1;    t "F 非法 --keep exit=1" 1 $?
bash "$SCRIPT" --root /nonexistent-dir-xyz >/dev/null 2>&1; t "F 非法 --root exit=1" 1 $?

echo
echo "══ 结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
