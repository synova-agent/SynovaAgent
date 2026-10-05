#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# iron-laws-live-point.test.sh — FIX-013: 「移出 pre-commit 的判定面」的真实活点接线断言
#
# 契约（铁律 47）:
#   @input  无参数。读 $REPO/.github/workflows/ci.yml（可用 SYNO_CI_YML 覆盖，供夹具注入）。
#   @output 活点三件套之 ⒜：job 名 + 行号（file:line 原文）；逐条断言结果行。
#   @exit   0 = 活点存在且接线正确，且**删除夹具**证伪得红（判别力成立）；
#           1 = 活点缺失/接线退化（无它则红）；
#           2 = 夹具自身执行失败（ci.yml 不可读等）
#   @degraded exit 2 + stderr "degraded: <原因>"（铁律 11/24，不静默）
#
# 为何是「活点」而不是「有配置」: quality job 红 → `needs: quality` 的下游整块 skip →
#   必需检查永不回报（#802/#803/#804/#805 实测 mergeState=blocked）。所以活点判据必须包含
#  「**不被 needs 牵连**」——否则 job 写在文件里也等于不存在。
#
# 判别性（⒝ 无它则红，实测可证）: 本测试把 ci.yml 复制到 mktemp 沙箱、**删掉 iron-laws 块**，
#   用同一提取器再判一次 → 必须报缺失；若提取器恒绿（例如写成 grep 源码的静态判据），
#   该用例会失败。→ 删掉真 job，本测试红。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI="${SYNO_CI_YML:-$REPO/.github/workflows/ci.yml}"
JOB="iron-laws"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

[ -f "$CI" ] || { echo "degraded: ci.yml 不可读: $CI" >&2; exit 2; }

echo "=== FIX-013 iron-laws 活点接线断言 ==="

# ── 提取器: 返回 job 块原文（缩进 2 的 `  <job>:` 起到下一个同级 job 键止），并打印起始行号 ──
job_block() {  # $1=ci.yml 路径 $2=job 名 → stdout=块原文
  awk -v job="$2" '
    $0 ~ "^  " job ":[[:space:]]*$" { inb=1; print; next }
    inb && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { exit }
    inb { print }
  ' "$1"
}
job_line() {  # $1=ci.yml 路径 $2=job 名 → stdout=行号
  grep -nE "^  $2:[[:space:]]*$" "$1" | head -1 | cut -d: -f1
}

LINE="$(job_line "$CI" "$JOB")"
BLOCK="$(job_block "$CI" "$JOB")"

if [ -n "$BLOCK" ]; then
  ok "⒜ 活点存在: .github/workflows/ci.yml:${LINE} → job '${JOB}'"
else
  no "⒜ 活点缺失: ci.yml 无 job '${JOB}'（移出 pre-commit 的判定面无接手方 = 保护真空）"
fi

# ── 活点必须真跑被移出的判定面（脚本 + CI 权威区口径）──
printf '%s\n' "$BLOCK" | grep -qE 'run: *bash +scripts/pre-commit-check\.sh' \
  && ok "活点执行 scripts/pre-commit-check.sh（移出判定面的单一实现）" \
  || no "活点未执行 scripts/pre-commit-check.sh"
printf '%s\n' "$BLOCK" | grep -qE 'SYNO_CI: *"?1"?' \
  && ok "活点注入 SYNO_CI=1（软提示在 CI 转硬 = 权威口径）" \
  || no "活点未注入 SYNO_CI=1 → 判定面在 CI 仍是软提示（等于未接手）"
printf '%s\n' "$BLOCK" | grep -qE 'SYNO_DIFF_BASE: *"?origin/main"?' \
  && ok "活点注入 SYNO_DIFF_BASE=origin/main（判定面扫描范围 = 本 PR 变更集）" \
  || no "活点未注入 SYNO_DIFF_BASE"

# ── 活点必须**不被 needs 牵连**（否则上游红 → 活点 skip → 该面永不回报）──
if printf '%s\n' "$BLOCK" | grep -qE '^    needs:'; then
  no "活点带 needs: → 上游红时被 skip，不是活点（实测: quality 红 ⇒ test 矩阵整块 skip ⇒ 必需检查永不回报）"
else
  ok "活点无 needs（上游红不牵连，可独立绿/红）"
fi

# ── 被移出的判定面确实在脚本的 CI 权威区（活点跑得到，而不是空 job）──
SCRIPT="$REPO/scripts/pre-commit-check.sh"
grep -q 'CI 权威区' "$SCRIPT" && ok "脚本含 CI 权威区（被移出判定面的落点）" || no "脚本无 CI 权威区"
grep -q 'code_added_lines' "$SCRIPT" && ok "FIX-015 源面代码判定面（按路径排除自伤面）已接线" || no "FIX-015 code_added_lines 未接线"

# ═══ ⒝ 判别性夹具: 删掉 job → 同一提取器必须报缺失（删掉即红）═══
SB="$(mktemp -d /tmp/iron-laws-lp.XXXXXX)"
trap 'rm -rf "$SB"' EXIT
MUT="$SB/ci-mutant.yml"
python3 - "$CI" "$MUT" "$JOB" <<'PY'
import sys, re
src, dst, job = sys.argv[1], sys.argv[2], sys.argv[3]
out, skip = [], False
for ln in open(src, encoding='utf-8'):
    if re.match(r'^  %s:\s*$' % re.escape(job), ln):
        skip = True
        continue
    if skip and re.match(r'^  [A-Za-z0-9_-]+:\s*$', ln):
        skip = False
    if skip:
        continue
    out.append(ln)
open(dst, 'w', encoding='utf-8').writelines(out)
PY
if [ -n "$(job_block "$MUT" "$JOB")" ]; then
  no "⒝ 判别性夹具失败: 变异体（已删除 job）仍被判存在 —— 断言无判别力"
else
  ok "⒝ 判别性夹具: 删除 job 后提取器报缺失（删掉即红，判别力成立）"
fi
if [ "$(job_line "$CI" "$JOB")" != "$(job_line "$MUT" "$JOB")" ] && [ -n "$(job_line "$CI" "$JOB")" ] && [ -z "$(job_line "$MUT" "$JOB")" ]; then
  ok "⒝ 变异体实测: 真 ci.yml 行 $LINE ↔ 变异体无该 job"
else
  no "⒝ 变异体行号对照失败（真=$LINE 变异=$(job_line "$MUT" "$JOB")）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
