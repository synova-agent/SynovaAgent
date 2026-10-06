#!/usr/bin/env bash
#
# run-selftest.sh — V6 runner 自检 + 负夹具（证明"判据没有分辨力"也是可判的）
#
# @why  ① 一个只会在"全过"时 exit 0 的 runner 不是判据 —— 必须证明它的
#          exit 1（无效夹具）与 exit 2（检查自身失败）**真的可达**。
#       ② 反向同样重要：某条判据的某个断言可能**永远红不了**（V-08 的近亲）。
#          这种"判据自身的盲区"必须能被指出来，否则 D 项只是换了种方式的装饰。
#
# @contract（铁律 47）
#   @input  — 干净工作树（已跟踪文件无改动）+ node v24（`--experimental-strip-types`）
#   @output — 三份原始输出到 ../evidence/v6/ ：
#               _selftest-noop-break.out    （A 段：invalid 夹具 ⇒ runner exit 1）
#               _selftest-unique-miss.out   （B 段：harness 失败 ⇒ runner exit 2）
#               _negative-fixture-3-12.out  （C 段：判据断言坏不掉 ⇒ 该断言无分辨力）
#             本脚本自身 exit：0 = A/B/C 三段行为**都**与预期一致；1 = 任一段不符预期
#   @degraded — 不适用。拿不到结论即 exit 1，不静默。
#
# 用法（仓库根）:
#   bash docs/synova/coordination/fixtures/selftest/run-selftest.sh
#
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
cd "$REPO_ROOT" || exit 1

FIX_DIR="docs/synova/coordination/fixtures"
SELFTEST_DIR="$FIX_DIR/selftest"
EV_DIR="docs/synova/product-lines/evidence/V6"
RUNNER="$FIX_DIR/run-fixtures.ts"
TARGET="packages/evolution/src/global-analyzer.ts"
NEUTERED_SENTINEL="NEGATIVE-FIXTURE"

mkdir -p "$EV_DIR"

# 开工快照：契约 = "离开时与进入时一致"，**不是**"进入时必须是净土"。
# （本人正在编辑 fixtures/** 时跑自检是常见场景；要求净土会让自检无法自举。）
SNAP_BEFORE="$(mktemp)"
git status --porcelain --untracked-files=no -- . ':(exclude)'"$EV_DIR" | sort > "$SNAP_BEFORE"

# 任何退出路径都必须把被判据改动过的文件放回去
cleanup() {
  git checkout -- "$TARGET" 2>/dev/null || true
  git checkout -- extensions/industries/ 2>/dev/null || true
}
trap cleanup EXIT

fail=0

# ── 段 A：语义空操作的"破坏" ⇒ 判据不红 ⇒ runner 必须 exit 1 ──────────────
echo "── 段 A：无效夹具（语义空操作破坏）应使 runner exit 1 ──"
{
  echo "# V6 runner 自检 · 段 A —— 无效夹具必须被识别（判例 V-08）"
  echo "# 命令: node --experimental-strip-types $RUNNER --manifest $SELFTEST_DIR/noop-break.json"
  echo "# 语义: find→replace 只增注释、行为零变化 ⇒ 判据不得转红 ⇒ 期望 runner exit 1"
  echo "# 若 runner 报 VALID / exit 0，则 runner 把'跑了命令'当'判据有效'，无分辨力。"
  echo "# generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  node --experimental-strip-types "$RUNNER" --manifest "$SELFTEST_DIR/noop-break.json" 2>&1
  rc=$?
  echo
  echo "════════════════════════════════════════"
  echo "RUNNER EXIT = $rc   （期望 1）"
} > /tmp/v6-selftest-a.txt 2>&1
rcA=$(grep -o 'RUNNER EXIT = [0-9]*' /tmp/v6-selftest-a.txt | tail -1 | grep -o '[0-9]*$')
cp /tmp/v6-selftest-a.txt "$EV_DIR/_selftest-noop-break.out"
# ⚠️ 假绿防线：exit 1 也可能是"runner 根本没跑起来"（如 MODULE_NOT_FOUND）。
#    必须先确认 runner 真的执行了（banner 出现），再谈退出码。
if ! grep -q 'V6「改坏即红」夹具 runner' /tmp/v6-selftest-a.txt; then
  echo "  ❌ 段 A: runner 未真正执行（输出中无 runner banner）⇒ 退出码不足信"
  fail=1
elif [[ "${rcA}" == "1" ]]; then
  echo "  ✅ 段 A: runner exit=1（无效夹具被识别）"
else
  echo "  ❌ 段 A: runner exit=${rcA}（期望 1）"
  fail=1
fi

# ── 段 B：定位串在目标文件里不存在 ⇒ 拿不到结论 ⇒ runner 必须 exit 2 ────────
echo "── 段 B：定位串缺失应使 runner exit 2（判例 M-02：禁吞） ──"
{
  echo "# V6 runner 自检 · 段 B —— 拿不到结论必须 exit 2，绝不静默跳过（判例 M-02）"
  echo "# 命令: node --experimental-strip-types $RUNNER --manifest $SELFTEST_DIR/unique-miss.json"
  echo "# 语义: breakHow.find 在目标文件中出现 0 次 ⇒ runner 拒绝猜测定位 ⇒ 期望 runner exit 2"
  echo "# generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  node --experimental-strip-types "$RUNNER" --manifest "$SELFTEST_DIR/unique-miss.json" 2>&1
  rc=$?
  echo
  echo "════════════════════════════════════════"
  echo "RUNNER EXIT = $rc   （期望 2）"
} > /tmp/v6-selftest-b.txt 2>&1
rcB=$(grep -o 'RUNNER EXIT = [0-9]*' /tmp/v6-selftest-b.txt | tail -1 | grep -o '[0-9]*$')
cp /tmp/v6-selftest-b.txt "$EV_DIR/_selftest-unique-miss.out"
if ! grep -q 'HARNESS-FAILURE' /tmp/v6-selftest-b.txt; then
  echo "  ❌ 段 B: 输出中无 HARNESS-FAILURE 标记 ⇒ 未验证到预期路径（退出码不足信）"
  fail=1
elif [[ "${rcB}" == "2" ]]; then
  echo "  ✅ 段 B: runner exit=2（拒绝猜测定位）"
else
  echo "  ❌ 段 B: runner exit=${rcB}（期望 2）"
  fail=1
fi

# ── 段 C：负夹具 —— 把 writeIndustryThresholds 整体空转，判据仍应**绿** ────
#    绿 ⇒ 该判据的"写入临时目录 → JSON 文件可读"一例**无分辨力**（坏不掉）。
echo "── 段 C：负夹具 —— 证明 3-12 判据第 4 例无分辨力 ──"
{
  echo "# V6 负夹具 · 段 C —— 判据自身的盲区：某断言**永远红不了**（V-08 近亲）"
  echo "# 对象: item 3-12 判据 `npx vitest run tests/evolution/global-analyzer.test.ts`"
  echo "# 破坏: $TARGET 的 writeIndustryThresholds 后半段整体空转（不写文件、不记日志）"
  echo "# 期望: 判据**仍然 exit 0** ⇒ 第 4 例 `写入临时目录 → JSON 文件可读` 保护不了任何东西"
  echo "#       （其断言为 expect(baseline.industry).toBe('test-write') —— 断的是本文件第 68 行"
  echo "#         写死的字面量，与被测函数无关；同例中算出的 filePath 从未被使用）"
  echo "# generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  node -e '
    const fs=require("fs");
    const p=process.argv[1];
    const s=fs.readFileSync(p,"utf8");
    const old="  writeFileSync(filePath, JSON.stringify(output, null, 2), \x27utf-8\x27);\n  log.info({ industry, path: filePath, thresholdCount: Object.keys(thresholds).length }, \x27行业阈值已写入\x27);";
    if(!s.includes(old)){ console.error("ANCHOR-NOT-FOUND"); process.exit(9); }
    fs.writeFileSync(p, s.replace(old, "  // NEGATIVE-FIXTURE: 函数体后半段整体空转（不写文件、不记日志）\n  void filePath; void output;"));
    console.log("已置空转态");
  ' "$TARGET"
  echo
  echo "\$ npx vitest run tests/evolution/global-analyzer.test.ts"
  npx vitest run tests/evolution/global-analyzer.test.ts 2>&1 | tail -20
  rc=${PIPESTATUS[0]}
  echo
  echo "════════════════════════════════════════"
  echo "CRITERION EXIT = $rc   （期望 0 = 判据在实现空转下仍然绿 ⇒ 该例无分辨力）"
} > /tmp/v6-selftest-c.txt 2>&1
rcC=$(grep -o 'CRITERION EXIT = [0-9]*' /tmp/v6-selftest-c.txt | tail -1 | grep -o '[0-9]*$')
cp /tmp/v6-selftest-c.txt "$EV_DIR/_negative-fixture-3-12.out"
cleanup
if ! grep -q 'Test Files' /tmp/v6-selftest-c.txt; then
  echo "  ❌ 段 C: 输出中无 vitest 汇总行 ⇒ 判据未真正执行（退出码不足信）"
  fail=1
elif [[ "${rcC}" == "0" ]]; then
  echo "  ✅ 段 C: 实现空转但判据 exit=0 ⇒ 已证明第 4 例无分辨力（判据盲区）"
else
  echo "  ⚠️ 段 C: 判据 exit=${rcC}（≠0）⇒ 第 4 例**有**分辨力，manifest 的 observedDefects 需更正"
  fail=1
fi

# ── 收尾：相对开工快照**不得新增**非证据类改动 ──────────────────────────────
# 证据 `.out` 是 git 跟踪的，每跑一次自检就会刷新一次 —— 那是**预期行为**，不是残留。
# 开工前已有的改动也不算残留（那是别人/本人正在进行的工作）。
dirty=$(git status --porcelain --untracked-files=no -- . ':(exclude)'"$EV_DIR" | sort \
        | comm -13 "$SNAP_BEFORE" -)
rm -f "$SNAP_BEFORE"
if [[ -n "$dirty" ]]; then
  echo "❌ 收尾：自检**新增**了（非证据类）已跟踪改动，未复原:"
  echo "$dirty"
  fail=1
else
  echo "✅ 收尾：相对开工快照未新增非证据类改动（自检未留残留）"
fi
refreshed=$(git status --porcelain --untracked-files=no -- "$EV_DIR" | wc -l | tr -d ' ')
if [[ "$refreshed" != "0" ]]; then
  echo "ℹ️ 本次刷新了 ${refreshed} 个证据产物（预期行为；提交前 git add ${EV_DIR}）"
fi

if [[ "$fail" == "0" ]]; then
  echo
  echo "⇒ exit 0：A/B/C 三段行为均与预期一致。"
  exit 0
fi
echo
echo "⇒ exit 1：有段落与预期不符（见上）。"
exit 1
