#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# iron-laws-selfdiff.test.sh — FIX-015: 「代码字面量」判定面的**自伤**排除 判别性夹具
#
# 契约（铁律 47）:
#   @input  无参数。被测 = scripts/pre-commit-check.sh（D390 注入缝 SYNO_TEST_ARM=1 +
#           SYNO_GIT_CACHED_*，仅在测试内武装；不写源工作树任何文件）。
#   @output 成对反例结果：源面注入 → 红；自伤面（$0/tests/docs）注入 → 绿；
#           12 处注入 → 12 行全打印（禁 head -8 截断）+ ::error 注解可见。
#   @exit   0 = 三组期望全部成立；1 = 任一不成立（业务失败）；2 = 夹具执行失败
#   @degraded exit 2 + stderr "degraded: <原因>"
#
# 根因（#803 CI 实测）: 判定面扫 $GIT_CACHED_DIFF（本 PR 全 diff），检查自身的正则/标签、
#   测试夹具的故意注入、文档引用**本身就含这些字面量** ⇒ 12 处 100% 自伤、B 类生产真红 0 处。
# 修法: 按文件路径排除（hunk 级 `+++ b/<path>`），禁行内字面量白名单。
# 判别性: 若把排除写成「行内白名单」或干脆去掉排除，Arm-B 转红（本用例失败）；
#   若把判定面整体关掉（`|| true` 式），Arm-A 转绿（本用例失败）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/pre-commit-check.sh"
[ -f "$GATE" ] || { echo "degraded: 被测脚本缺失: $GATE" >&2; exit 2; }
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "=== FIX-015 源面/自伤面 判定面 判别性夹具 ==="

run_gate() {  # $1=注入 diff → stdout=脚输出（CI 口径；注入缝只在本进程内武装）
  SYNO_TEST_ARM=1 SYNO_CI=1 GITHUB_ACTIONS=true \
  SYNO_GIT_CACHED_NAMES="$1_names" SYNO_GIT_CACHED_ALL_NAMES="$1_names" \
  SYNO_GIT_CACHED_ADDED_NAMES="" SYNO_GIT_CACHED_DIFF="$1" \
    bash "$GATE" 2>&1
}
mkdiff() {  # $1=path $2=line → 单文件单行 added 的 diff
  printf 'diff --git a/%s b/%s\n--- a/%s\n+++ b/%s\n@@ -1 +1,2 @@\n const x = 1;\n+%s\n' "$1" "$1" "$1" "$1" "$2"
}

# ── Arm-A: 源面代码注入 `as any` → 必须红（判定面未被削弱）──
A_OUT="$(run_gate "$(mkdiff src/probe.ts 'const y = JSON.parse(s) as any;')")"
if printf '%s' "$A_OUT" | grep -qE '❌ as any / as never / as unknown as 零容忍（铁律38）: 1 处'; then
  ok "Arm-A 源面注入 as any → ❌ 1 处（真注入仍被拦）"
else
  no "Arm-A 源面注入未报红（判定面被削弱 / 白名单把真注入放过）"
fi
printf '%s' "$A_OUT" | grep -q '::error title=IronLaws:' \
  && ok "Arm-A 失败经 ::error 注解可见（含失败断言原文）" \
  || no "Arm-A 无 ::error 注解（CI 不可定位）"

# ── Arm-A2: 源面注入 DiagnosticModule → 必须红 ──
A2_OUT="$(run_gate "$(mkdiff src/probe2.ts 'export class X implements DiagnosticModule {}')")"
printf '%s' "$A2_OUT" | grep -qE '❌ 禁止 DiagnosticModule: 新模块须实现 Sentinel 接口: 1 处' \
  && ok "Arm-A2 源面注入 DiagnosticModule → ❌ 1 处" \
  || no "Arm-A2 源面注入 DiagnosticModule 未报红"

# ── Arm-B: 仅自伤面（$0 自身 + tests/** + docs/** + *.md）注入同字面量 → 必须绿 ──
D_B=''
for p in scripts/pre-commit-check.sh tests/control-tower/probe.test.sh docs/probe.md; do
  case "$p" in
    scripts/*) line='echo "as any 探针（CI strict）" && : DiagnosticModule' ;;
    tests/*)   line='[ "$rcA" -eq 1 ] && ok "as any 探针 CI strict" || : DiagnosticModule' ;;
    *)         line='- 规则引用: as any / DiagnosticModule 判定面' ;;
  esac
  D_B="${D_B}$(mkdiff "$p" "$line")"$'\n'
done
B_OUT="$(run_gate "$D_B")"
printf '%s' "$B_OUT" | grep -qE '✅ as any / as never / as unknown as 零容忍（铁律38）' \
  && ok "Arm-B 自伤面（\$0/tests/docs）注入 as any → ✅（不再自伤）" \
  || no "Arm-B 仍报 as any 自伤"
printf '%s' "$B_OUT" | grep -qE '✅ 禁止 DiagnosticModule: 新模块须实现 Sentinel 接口' \
  && ok "Arm-B 自伤面注入 DiagnosticModule → ✅（不再自伤）" \
  || no "Arm-B 仍报 DiagnosticModule 自伤"

# ── Arm-C: 12 处源面注入 → 12 行全打印（head -8 截断修复的判别）──
D_C="$D_B"
for i in $(seq 1 12); do D_C="${D_C}$(mkdiff "src/probe_${i}.ts" "const z${i} = a${i} as any;")"$'\n'; done
C_OUT="$(run_gate "$D_C")"
if printf '%s' "$C_OUT" | grep -qE ': 12 处'; then
  ok "Arm-C 12 处注入 → 计数 12 处"
else
  no "Arm-C 计数不为 12（判定面漏行）"
fi
N_LINES=$(printf '%s' "$C_OUT" | grep -cE '^     \+const z[0-9]+ = ')
[ "$N_LINES" -eq 12 ] && ok "Arm-C 12 行明细全部打印（原 head -8 会吞掉第 9-12 行）" \
                      || no "Arm-C 明细只打印 $N_LINES 行（截断未修）"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
