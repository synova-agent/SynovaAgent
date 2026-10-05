#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# system-registry.test.sh — 寄存器生成器测试（铁律 48：正常/降级/边界）
#
# D1149（2026-10-05）裁剪记录:
#   原夹具同时覆盖 gen-system-registry.sh（生成器）与 verify-system-registry.sh（I1/I2/I3 校验器）。
#   校验器经「零可执行调用方」逐条证明（无 ci.yml 登记 / 无 pre-commit 接线 / 无脚本调用）判定为
#   D3 零执行体并退役 ⇒ 本夹具内**全部针对校验器的用例**（B / B1a-e / B2 / B3 / C / C1-C3 /
#   D / D0 / D1 / D1a / E）同步摘除；生成器用例 A / A0 / A1 原样保留（未改断言）。
#   摘除理由（非判据放宽）: 断言对象已不存在 = 断裂引用（D317 同款），留则夹具必红。
# 用例:
#   A 生成器: 真实 AD01 第四章 → 42 边 + generatedBy/generatedAtCommit 非空 → exit 0
#   A1 断言含 E-01..E-42 完整骨架 + counters 五键
# 运行: bash tests/doc-system/system-registry.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
GEN="$REPO/scripts/doc-system/gen-system-registry.sh"
PASS=0; FAIL=0

t() { if [ "$2" = "$3" ]; then echo "  ✅ $1 (exit $3)"; PASS=$((PASS+1)); else echo "  ❌ $1 (期望 $2 实际 $3)"; FAIL=$((FAIL+1)); fi; }
tg() { case "$3" in *"$2"*) echo "  ✅ $1 (含「$2」)"; PASS=$((PASS+1));; *) echo "  ❌ $1 (输出不含「$2」)"; FAIL=$((FAIL+1));; esac; }

# ── A: 生成器（真实仓库，写真实产物——与 CI canary 同语义）──
OUT=$(bash "$GEN" 2>&1); RC=$?
t  "A 生成器 exit0" 0 "$RC"
tg "A0 GEN-OK" "GEN-OK" "$OUT"
REG="$REPO/docs/authority/system-registry.json"
python3 -c "
import json,sys
d=json.load(open('$REG'))
assert d['generatedBy'], 'generatedBy 空'
assert d['generatedAtCommit'], 'generatedAtCommit 空'
ids={e['id'] for e in d['edges']}
expect={f'E-{i:02d}' for i in range(1,43)}
assert expect <= ids, f'缺边: {sorted(expect-ids)[:5]}'
assert all(e['name'] and e['hardness'] in ('hard','soft','heuristic') for e in d['edges'])
assert set(d['counters']) == {'sentinelDirs','computeFiles','skillDirs','playbookYaml','experts'}
print('A-ASSERT-OK')" 2>&1 | tail -1
t  "A1 42 边骨架 + 五 counter + 防手编字段" 0 $?

echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
