#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# incident-loop-hygiene.test.sh — D535 guard 循环卫生测试（重复提醒 + 接线 + 文档）
#
# SUT: scripts/control-tower/incident-loop.py（record 重复提醒）+ synova-commit
#      （block 分支接线 incident-loop）+ docs/synova/coordination/控制塔循环卫生标准-*.md
#
# 背景: D314 学习闭环 record 同 id 重复时静默返回 duplicate（无提醒）——"该问题
#       反复出现"的信号丢失（对照 DSH repeat-tool-reminder 阶梯提醒范式，D535 补全）。
#       且 incident-loop 零生产调用方（staging-guard block 不沉淀拦截事件）。
#
# 覆盖（铁律 48：正常/降级/边界/接线，≥8 用例）:
#   L1. 重复提醒: 同 id 连续 record 2 次 → 第二次返回 repeat_count>=2 + reminder 非空
#   L1. 边界: 首 record → status: recorded（无 reminder，回归）
#   L1. 幂等保持: 同 id 重复 record → incident.log 行数不变（回归）
#   L1. 降级: INCIDENT_LOG 不可写 → status: degraded（回归，铁律 24/31）
#   L2a. 接线: synova-commit block 分支含 incident-loop record 调用（grep 断言）
#   L2a. 降级接线: block 分支 record 失败不阻断主流程（fail-open，grep 断言 set +e + rc 捕获）
#   L2b. 频发提醒: 2 天前同 id 记录 + 今日再 record → reminder 含重复语义
#   L2c. 文档: 循环卫生标准文档存在且含 subprocess 超时契约（grep 断言）
#
# 隔离: SYNO_CT_DIR 注入缝隔离 incident.log（incident-loop.test.sh 同款）；
#       接线用 grep 物理断言（生产调用点，测试调用不计 — S-3）。
#
# 用法: bash tests/control-tower/incident-loop-hygiene.test.sh
# 注意: LF 换行（tests/control-tower/ 与 D533 renormalize 共享目录 — S-7/S-8）
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/control-tower/incident-loop.py"
COMMIT="$REPO_DIR/scripts/control-tower/synova-commit"
DOC_GLOB="$REPO_DIR/docs/synova/coordination/控制塔循环卫生标准-*.md"
CT_DIR="$REPO_DIR/.codex/control-tower/tmp/il-hygiene"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_contains() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi; }

rm -rf "$CT_DIR"; mkdir -p "$CT_DIR"

echo "═══════════════════════════════════════════════════════════"
echo "  D535 guard 循环卫生 — 重复提醒 + 接线 + 文档"
echo "  SUT: $TOOL / $COMMIT"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── L1-1. 重复提醒: 同 id 二次 record → repeat_count + reminder ───
OUT1=$(SYNO_CT_DIR="$CT_DIR" python3 "$TOOL" record --id "INC-HYG-001" --symptom "测试事故" --root-cause "R1" --sessions "TEST" --fix "修复" --version "4.6.0" 2>&1) || true
OUT2=$(SYNO_CT_DIR="$CT_DIR" python3 "$TOOL" record --id "INC-HYG-001" --symptom "测试事故" --root-cause "R1" --sessions "TEST" --fix "修复" --version "4.6.0" 2>&1) || true
assert_contains "$OUT2" '"status": "duplicate"' "L1 二次 record → status: duplicate（幂等保持）"
assert_contains "$OUT2" '"reminder"' "L1 二次 record → 含 reminder 字段（非静默 duplicate）"
RC2=$(echo "$OUT2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('repeat_count', 0))" 2>/dev/null || echo 0)
if [ "$RC2" -ge 2 ]; then pass "L1 二次 record → repeat_count=$RC2（>=2）"; else fail "L1 repeat_count — 期望 >=2 实际=$RC2"; fi
echo ""

# ─── L1-2. 边界: 首 record → recorded 无 reminder ───
OUT3=$(SYNO_CT_DIR="$CT_DIR" python3 "$TOOL" record --id "INC-HYG-002" --symptom "测试事故2" --root-cause "R2" --sessions "TEST" --fix "修复" --version "4.6.0" 2>&1) || true
assert_contains "$OUT3" '"status": "recorded"' "L1 首 record → status: recorded（回归）"
if echo "$OUT3" | grep -q '"reminder"'; then fail "L1 首 record 不应含 reminder"; else pass "L1 首 record 无 reminder（边界）"; fi
echo ""

# ─── L1-3. 幂等保持: 同 id 重复 → log 行数不变 ───
N1=$(wc -l < "$CT_DIR/logs/incident.log" 2>/dev/null | tr -d ' \n' || echo 0)
SYNO_CT_DIR="$CT_DIR" python3 "$TOOL" record --id "INC-HYG-002" --symptom "测试事故2" --root-cause "R2" --sessions "TEST" --fix "修复" --version "4.6.0" >/dev/null 2>&1 || true
N2=$(wc -l < "$CT_DIR/logs/incident.log" 2>/dev/null | tr -d ' \n' || echo 0)
if [ "$N1" = "$N2" ]; then pass "L1 幂等: 重复 record 不追加行（$N1 → $N2）"; else fail "L1 幂等 — 行数变化 $N1 → $N2"; fi
echo ""

# ─── L1-4. 降级: INCIDENT_LOG 不可写 → degraded ───
# 注: control_tower_log.py 的 _append 静默吞 OSError（fail-open）→ 常规只读日志
#     不触发 degraded。真实触发 = import control_tower_log 失败（复制 SUT 到隔离
#     目录，REPO_ROOT 无 control_tower_log.py）+ 直接写分支遇只读文件 → OSError
RO_DIR="$CT_DIR/ro-ct"; ISOLATE_DIR="$CT_DIR/isolate"
mkdir -p "$RO_DIR/logs" "$ISOLATE_DIR"
cp "$TOOL" "$ISOLATE_DIR/incident-loop.py"
printf '' > "$RO_DIR/logs/incident.log"
chmod 444 "$RO_DIR/logs/incident.log"
OUT4=$(SYNO_CT_DIR="$RO_DIR" python3 "$ISOLATE_DIR/incident-loop.py" record --id "INC-HYG-003" --symptom "降级测试" --root-cause "R3" --sessions "TEST" --fix "修复" --version "4.6.0" 2>&1) || true
chmod 644 "$RO_DIR/logs/incident.log"
if echo "$OUT4" | grep -qE '"status": "degraded"'; then pass "L1 降级: log 不可写 → status: degraded（铁律 24/31）"; else fail "L1 降级 — 未返回 degraded: $OUT4"; fi
echo ""

# ─── L2a. 接线: synova-commit block 分支调用 incident-loop record ───
if grep -n 'incident-loop.py" record' "$COMMIT" >/dev/null 2>&1; then
  pass "L2a 接线: synova-commit 含 incident-loop record 调用（生产调用点）"
else
  fail "L2a 接线: synova-commit 无 incident-loop record 调用"
fi
echo ""

# ─── L2a-降级. fail-open: block 分支 record 失败不阻断主流程 ───
if grep -n 'INC_RC' "$COMMIT" >/dev/null 2>&1 && grep -n 'set +e' "$COMMIT" >/dev/null 2>&1; then
  pass "L2a 降级: block 分支含 rc 捕获 + set +e（fail-open 不阻断）"
else
  fail "L2a 降级: block 分支缺 fail-open 结构（INC_RC/set +e）"
fi
echo ""

# ─── L2b. 频发提醒: 2 天前同 id + 今日再 record → reminder 含重复语义 ───
OLD_TS=$(python3 -c "import time; print(time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime(time.time()-172800)))")
FREQ_DIR="$CT_DIR/freq-ct"; mkdir -p "$FREQ_DIR/logs"
printf '{"id": "INC-HYG-004", "time": "%s", "symptom": "并行冲突", "rootCause": "R1", "sessions": "OLD", "fix": "f", "version": "4.6.0"}\n' "$OLD_TS" > "$FREQ_DIR/logs/incident.log"
OUT5=$(SYNO_CT_DIR="$FREQ_DIR" python3 "$TOOL" record --id "INC-HYG-004" --symptom "并行冲突" --root-cause "R1" --sessions "NEW" --fix "修复" --version "4.6.0" 2>&1) || true
assert_contains "$OUT5" '"reminder"' "L2b 频发提醒: 2 天前同 id → reminder 存在"
assert_contains "$OUT5" '重复' "L2b 频发提醒: reminder 含重复语义"
echo ""

# ─── L2c. 文档: 循环卫生标准存在且含超时契约 ───
DOC=$(ls $DOC_GLOB 2>/dev/null | head -1 || true)
if [ -n "$DOC" ] && [ -f "$DOC" ]; then
  if grep -nE 'subprocess.*timeout|重复事故提醒|防跑偏信号' "$DOC" >/dev/null 2>&1; then
    pass "L2c 文档: 循环卫生标准存在且含超时契约/提醒/接线（$(basename "$DOC")）"
  else
    fail "L2c 文档: 存在但缺超时契约关键词"
  fi
else
  fail "L2c 文档: 循环卫生标准文档不存在"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0
