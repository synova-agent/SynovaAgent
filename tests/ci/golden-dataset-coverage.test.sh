#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# tests/ci/golden-dataset-coverage.test.sh — D1056 CT10-win 黄金门禁覆盖度夹具
#
# 覆盖矩阵（正常路径 / 降级路径 / 边界条件 / 改坏即红）:
#   L1 ① 覆盖行可见        — 绿态 checker 必须打印数据集 compute 覆盖行（正常路径）
#      L1-red 改坏即红      — 删掉那行 ⇒ grep 计数 0 ⇒ L1 断言必须变红（判别性证明）
#   L2   篡改 GOLDEN_COMPUTE_INPUTS ⇒ 门禁必须红（正常路径 + 真实执行证明）
#      （D1046 §188 L2 腿: 证明 ruler 真的在跑 compute，不是恒绿空壳）
#   L3   trap 还原 ⇒ 门禁必须回绿（还原生效）
#   L4 ③ 空集恒真修复      — decideSnapshotVerdict({}) 必须 passed=null（边界条件）
#      L4-red 改坏即红      — 把该分支还原成 `Object.values({}).every(...)` ⇒ 空集回 true ⇒ 断言红
#   另: 生产接线检查 — checker 主流程必须真的调用 decideSnapshotVerdict（铁律 0-2 WIRE CHECK）
#
# 契约:
#   @input  — 真实仓 scripts/ci/{golden-case-checker,golden-snapshot-runner}.ts + 真实 fixtures
#   @output — exit 0 = 全部通过；exit 1 = 有腿未过（逐腿点名）
#   @degraded — npx/tsx 不可用 ⇒ 显式 fail（绝不静默 skip，铁律 11/24）
#
# 沙箱: 所有 mutation 都带备份 + trap EXIT 还原；测试不改变仓库最终状态。
# 用法: bash tests/ci/golden-dataset-coverage.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECKER="$REPO_DIR/scripts/ci/golden-case-checker.ts"
RUNNER="$REPO_DIR/scripts/ci/golden-snapshot-runner.ts"
RUNNER_BAK="$RUNNER.ct10win.bak"
CHECKER_BAK="$CHECKER.ct10win.bak"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ct10win-coverage.XXXXXX")"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

# ── trap: 任何退出路径都必须还原被 mutation 的源文件 ──
restore_sources() {
  if [ -f "$RUNNER_BAK" ]; then cp "$RUNNER_BAK" "$RUNNER"; fi
  if [ -f "$CHECKER_BAK" ]; then cp "$CHECKER_BAK" "$CHECKER"; fi
  rm -f "$RUNNER_BAK" "$CHECKER_BAK" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  return 0
}
trap restore_sources EXIT

# ── 前置: 被门禁的真实文件必须存在（防误删 — 缺即中止，不静默 skip） ──
for f in "$CHECKER" "$RUNNER"; do
  if [ ! -f "$f" ]; then
    echo "❌ 前置失败 — 门禁源文件缺失: $f" >&2
    exit 1
  fi
done
if ! command -v npx >/dev/null 2>&1; then
  echo "❌ 前置失败 — npx 不可用（黄金门禁无法运行，显式失败不静默 skip）" >&2
  exit 1
fi

# run_checker <outfile> ; 返回 checker 退出码（set -e 下用 `|| rc=$?` 捕获）
run_checker() {
  local out="$1"
  local rc=0
  local t0 t1 elapsed
  t0=$(date +%s)
  ( cd "$REPO_DIR" && npx tsx scripts/ci/golden-case-checker.ts ) > "$out" 2>&1 || rc=$?
  t1=$(date +%s)
  elapsed=$((t1 - t0))
  echo "     [耗时 ${elapsed}s] rc=$rc 输出=$out" >&2
  return $rc
}

# count <pattern> <file> — grep -c 无匹配时 exit 1；统一剥 CR/LF 防 "0\n0"
count() {
  grep -c "$1" "$2" 2>/dev/null | tr -d '\n\r' || true
}

echo "═══════════════════════════════════════════════════════════"
echo "  D1056 黄金门禁覆盖度夹具 — CT10-win"
echo "  checker: scripts/ci/golden-case-checker.ts"
echo "  runner : scripts/ci/golden-snapshot-runner.ts"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ═══ L1: ① 覆盖行可见（绿态） ═══
echo "── L1: ① 覆盖行可见（绿态基线） ──"
L1_RC=0
run_checker "$WORK/l1.out" || L1_RC=$?
if [ "$L1_RC" -eq 0 ]; then
  pass "L1-a 绿态 checker exit 0（基线可复现）"
else
  fail "L1-a 绿态 checker 期望 exit 0 实际 $L1_RC — 基线不成立，后续腿不可判"
fi

COV_DATASET=$(count "黄金数据集 compute 覆盖" "$WORK/l1.out")
if [ "$COV_DATASET" -ge 1 ]; then
  pass "L1-b 数据集覆盖行可见（命中 $COV_DATASET 处）"
else
  fail "L1-b 数据集覆盖行不可见（命中 0 处）— 覆盖度仍然不可见"
fi

COV_SUMMARY=$(count "快照覆盖: " "$WORK/l1.out")
if [ "$COV_SUMMARY" -ge 1 ]; then
  pass "L1-c 案例快照覆盖汇总行可见（命中 $COV_SUMMARY 处）"
else
  fail "L1-c 案例快照覆盖汇总行不可见（命中 0 处）"
fi

# ── L1-red: 改坏即红 — 删掉覆盖行 ⇒ L1-b 断言必须变红 ──
echo ""
echo "── L1-red: 改坏即红（删掉覆盖行 ⇒ L1-b 必须变红） ──"
cp "$RUNNER" "$RUNNER_BAK"
perl -i -ne 'print unless /黄金数据集 compute 覆盖/' "$RUNNER"
MUT_LINE=$(count "黄金数据集 compute 覆盖" "$RUNNER")
if [ "$MUT_LINE" -eq 0 ]; then
  run_checker "$WORK/l1red.out" || true
  COV_MUT=$(count "黄金数据集 compute 覆盖" "$WORK/l1red.out")
  if [ "$COV_MUT" -eq 0 ]; then
    pass "L1-red 删掉覆盖行后输出命中 0 处 ⇒ L1-b 断言确会变红（夹具具判别性）"
  else
    fail "L1-red 删掉源码行后输出仍有 $COV_MUT 处覆盖行 — 夹具不判别"
  fi
  cp "$RUNNER_BAK" "$RUNNER"
  rm -f "$RUNNER_BAK"
  run_checker "$WORK/l1green.out" || true
  if [ "$(count "黄金数据集 compute 覆盖" "$WORK/l1green.out")" -ge 1 ]; then
    pass "L1-red 还原后覆盖行恢复可见（红→绿闭环）"
  else
    fail "L1-red 还原后覆盖行仍不可见 — 还原失败"
  fi
else
  fail "L1-red mutation 未生效（源码仍含覆盖行）"
fi

# ═══ L2: 篡改 GOLDEN_COMPUTE_INPUTS ⇒ 门禁必红 ═══
echo ""
echo "── L2: 篡改 GOLDEN_COMPUTE_INPUTS (cash 100000 → 100000000) ⇒ 必须 exit 1 ──"
cp "$CHECKER" "$CHECKER_BAK"
perl -0pi -e "s/\Q'cash-runway': [{ cash: 100000, operatingExpense: 30000 }],\E/'cash-runway': [{ cash: 100000000, operatingExpense: 30000 }],/" "$CHECKER"
if grep -q "cash: 100000000" "$CHECKER"; then
  pass "L2-a 篡改已注入（cash: 100000000）"
else
  fail "L2-a 篡改未生效 — 夹具形状可能与源码不符，本腿不可判"
fi

L2_RC=0
run_checker "$WORK/l2.out" || L2_RC=$?
if [ "$L2_RC" -ne 0 ]; then
  pass "L2-b 篡改后 checker exit ${L2_RC}（非 0）— 门禁真跑 compute 而非恒绿空壳"
else
  fail "L2-b 篡改后 checker 仍 exit 0 — 门禁未拦截，恒绿空壳"
fi
if [ "$(count "cash-runway" "$WORK/l2.out")" -ge 1 ]; then
  pass "L2-c 失败输出点名 cash-runway（可定位）"
else
  fail "L2-c 失败输出未点名 cash-runway"
fi
cp "$CHECKER_BAK" "$CHECKER"
rm -f "$CHECKER_BAK"

# ═══ L3: 还原 ⇒ 必须回绿 ═══
echo ""
echo "── L3: trap 还原 ⇒ 必须回绿 ──"
if grep -q "cash: 100000000" "$CHECKER"; then
  fail "L3-a 还原失败 — 源文件仍含篡改标记"
else
  pass "L3-a 源文件已还原（篡改标记清零）"
fi
L3_RC=0
run_checker "$WORK/l3.out" || L3_RC=$?
if [ "$L3_RC" -eq 0 ]; then
  pass "L3-b 还原后 checker exit 0 — 红→绿闭环成立"
else
  fail "L3-b 还原后 checker 仍 exit $L3_RC — 还原未生效"
fi

# ═══ L4: ③ 空集恒真修复 ═══
echo ""
echo "── L4: ③ 空集恒真修复（decideSnapshotVerdict 边界） ──"

# 生产接线检查（铁律 0-2 WIRE CHECK）: 主流程必须真的调用该纯函数
WIRED=$(count "decideSnapshotVerdict(snapshotResults)" "$CHECKER")
if [ "$WIRED" -ge 1 ]; then
  pass "L4-a 生产接线存在（主流程调用 decideSnapshotVerdict，$WIRED 处）"
else
  fail "L4-a 生产接线缺失 — 纯函数未接线（写了不调用）"
fi

verdict_probe() {
  ( cd "$REPO_DIR" && npx tsx -e "
import { decideSnapshotVerdict } from './scripts/ci/golden-case-checker.ts';
const empty = decideSnapshotVerdict({});
console.log('PROBE ' + JSON.stringify(empty));
" ) 2>&1
}

PROBE_OUT=$(verdict_probe || true)
if echo "$PROBE_OUT" | grep -q 'PROBE {"covered":false,"passed":null}'; then
  pass "L4-b 空集 ⇒ covered=false 且 passed=null（不再恒真为通过）"
else
  fail "L4-b 空集未返回 passed=null — 实际: $(echo "$PROBE_OUT" | tr '\n' ' ')"
fi

# ── L4-red: 改坏即红 — 还原成 `Object.values({}).every(...)` ⇒ 空集回 true ⇒ L4-b 必须变红 ──
echo ""
echo "── L4-red: 改坏即红（还原空集恒真 ⇒ L4-b 必须变红） ──"
cp "$CHECKER" "$CHECKER_BAK"
perl -0pi -e "s/\Q  if (!covered) return { covered: false, passed: null };\E/  if (!covered) return { covered: false, passed: Object.values(results).every((r) => r.passed) };/" "$CHECKER"
if grep -q "passed: Object.values(results).every((r) => r.passed) }" "$CHECKER"; then
  pass "L4-red-a mutation 已注入（空集恒真回归）"
else
  fail "L4-red-a mutation 未生效 — 夹具形状可能与源码不符"
fi
PROBE_MUT=$(verdict_probe || true)
if echo "$PROBE_MUT" | grep -q 'PROBE {"covered":false,"passed":true}'; then
  pass "L4-red-b 空集恒真回归后 passed=true ⇒ L4-b 断言确会变红（夹具具判别性）"
else
  fail "L4-red-b 期望空集回 true，实际: $(echo "$PROBE_MUT" | tr '\n' ' ')"
fi
cp "$CHECKER_BAK" "$CHECKER"
rm -f "$CHECKER_BAK"
PROBE_RESET=$(verdict_probe || true)
if echo "$PROBE_RESET" | grep -q 'PROBE {"covered":false,"passed":null}'; then
  pass "L4-red-c 还原后空集回到 passed=null（红→绿闭环）"
else
  fail "L4-red-c 还原后空集未回 null — 实际: $(echo "$PROBE_RESET" | tr '\n' ' ')"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ 黄金门禁覆盖度夹具未通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
echo "  Status: ✅ 黄金门禁覆盖度夹具全部通过"
echo "═══════════════════════════════════════════════════════════"
exit 0
