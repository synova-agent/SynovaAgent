#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# g6-layer-field.test.sh — 组 6「架构层」字段判据的行为级夹具（#1015 G-2 / D1142）
#
# 病根（CTO 复核，精确 file:line）:
#   scripts/pre-commit-check.sh:881 `[ -z "$LAYER_FILLED" ] || [ ${#LAYER_FILLED} -lt 3 ]`
#   ⇒ 合法值 `L4`（2 字符）必被判「未填写」⇒ 逼执行方把值写长来绕判据（合法但误导后人）。
#   V4.2.7 changelog 自称修过「L3 过短(2字符)导致误判」，但 :881 的 -lt 3 仍在。
#
# 判据边界（卡面 Done 明文）: **允许的最短合法值是 L1–L5（2 字符）**；
#   真空值仍须被判未填写（不放松）。
#
# 覆盖矩阵（铁律 48 三路径 + 接线 + 反例）:
#   正常 — `架构层: L4` / `L1` / `L5` → **不得**出现「架构层: 未填写」
#   正常 — `架构层: 基础设施`（存量自由文本形态，≥3 字符）→ 不得出现
#   边界 — `架构层: X`（1 字符）→ **必须**出现
#   边界 — `架构层: XY`（2 字符非 L1–L5）→ **必须**出现（判别性: 不能把 2 字符一律放行）
#   降级 — 真空值（`## 架构层:` 无值）→ **必须**出现
#   反例 — 每组输出必须含 `组 6/13` 区块；缺失 ⇒ exit 2（夹具自身失效，绝不静默当绿）
#
# 隔离（hermetic，PLATFORM-CHECKLIST §6）: 全部动作在 `mktemp -d` 沙箱内；
#   沙箱 = 独立 git 仓 + **拷贝** 的 scripts/ 树（不用 symlink：Git Bash 下不可靠）。
#   源工作树只读（本夹具不写源树任何文件）。
#
# 被测对象 = **真实 pre-commit-check.sh**（非副本逻辑、非 grep 型静态断言）:
#   沙箱内 `git rev-parse --show-toplevel` = 沙箱 ⇒ `$ROOT/scripts/**` 全部解析到沙箱拷贝；
#   注入缝 SYNO_TEST_ARM=1 + SYNO_GIT_CACHED_* 提供「本次暂存」内容（唯一被许可的注入路径，
#   见 pre-commit-check.sh:260-268 武装守卫）。
#
# 契约（铁律 47）:
#   @input  — 无参数（可选 SYNO_G6_GATE 覆盖被测脚本路径，测试用）
#   @output — 逐用例 ✅/❌ + 收尾 PASS/FAIL 汇总 + 末行机器可读摘要
#   @exit   — 0 = 全用例符合期望 ｜ 1 = 有用例不符（业务失败）｜ 2 = 夹具自身失效
#             （沙箱建不出 / 组 6 区块未出现 / 被测脚本缺失）—— 铁律 11：不静默
#   @degraded — exit 2 且 stderr 以 `degraded:` 起（与"判据红"区分开）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/../.." && pwd)"
GATE="${SYNO_G6_GATE:-$REPO_DIR/scripts/pre-commit-check.sh}"

PASS=0; FAIL=0; FAILED_NAMES=()
ok()  { echo "  ✅ $1"; PASS=$((PASS + 1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); }
degraded() { echo "degraded: $1" >&2; exit 2; }

[ -f "$GATE" ] || degraded "被测脚本不存在: $GATE (code=G6_SETUP, phase=locate)"
command -v git >/dev/null 2>&1 || degraded "git 不可用 (code=G6_SETUP, phase=locate)"

SANDBOX="$(mktemp -d)"
cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT

mkdir -p "$SANDBOX/.claude/task-briefs"
cp -R "$REPO_DIR/scripts" "$SANDBOX/scripts" || degraded "scripts/ 拷贝失败 (code=G6_SETUP, phase=copy)"
( cd "$SANDBOX" && git init -q . ) || degraded "沙箱 git init 失败 (code=G6_SETUP, phase=git)"

FIXNAME_D="$(date +%F)-D999-g6layer-fixture.md"
JSON_LINE='{"time":"2026-10-04T00:00:00+00:00","component":"fixture","reason":"g6-layer"}'

# run_case <架构层 值，空串=真空值> → 组 6 输出落 $SANDBOX/out.log
run_case() {
  local val="$1"
  mkdir -p "$SANDBOX/.claude/task-briefs"
  {
    printf '# Task Brief: D999 g6 layer fixture\n'
    printf '> 认领: fixture\n\n'
    printf '#CRITERIA: A\n\n'
    printf '## Q0: 定位\n定位内容足够长\n'
    printf '## Q1: 调研\n调研内容足够长\n'
    printf '## Q2: 范围\n做什么：\n- scripts/control-tower/alloc-task-id.sh\n'
    printf '不做什么：\n- 不改 scripts/audit/check-gates-v2.py\n'
    printf '## Q3: 验收\n验收内容足够长\n'
    if [ -n "$val" ]; then printf '## 架构层: %s\n' "$val"; else printf '## 架构层:\n'; fi
    printf '## Done 标准\n- [ ] verify: 判据一\n- [ ] verify: 判据二\n'
  } > "$SANDBOX/.claude/task-briefs/$FIXNAME_D"
  printf '%s\n' "$FIXNAME_D" > "$SANDBOX/.claude/current-brief"
  (
    cd "$SANDBOX" || exit 99
    SYNO_TEST_ARM=1 \
    SYNO_GIT_CACHED_NAMES='scripts/control-tower/alloc-task-id.sh' \
    SYNO_GIT_CACHED_ALL_NAMES='scripts/control-tower/alloc-task-id.sh' \
    SYNO_GIT_CACHED_ADDED_NAMES='' \
    SYNO_GIT_CACHED_DIFF='' \
    bash scripts/pre-commit-check.sh
  ) > "$SANDBOX/out.log" 2>&1
  # 反例守卫: 组 6 区块必须真出现（否则"没出现未填写"是假绿）
  if ! grep -q '组 6/13' "$SANDBOX/out.log"; then
    echo "$JSON_LINE" >&2
    degraded "组 6 区块未出现（夹具失效，非判据结果）(code=G6_SETUP, phase=run)"
  fi
}

# 断言辅助: 期望出现 / 期望不出现「架构层: 未填写」
expect_flagged() {   # $1=值描述
  if grep -q '架构层: 未填写' "$SANDBOX/out.log"; then
    ok "$1 → 判「未填写」（符合期望）"
  else
    bad "$1 → 未被判未填写（判据过松，漏拦）"
  fi
}
expect_clean() {     # $1=值描述
  if grep -q '架构层: 未填写' "$SANDBOX/out.log"; then
    bad "$1 → 被误判「未填写」（#1015-G2 病根未修）"
  else
    ok "$1 → 不误判（已填写）"
  fi
}

echo "═══════════════════════════════════════════════════════════"
echo "  #1015-G2 组 6 架构层字段判据夹具（被测 = 真实 pre-commit-check.sh）"
echo "  沙箱: $SANDBOX ｜ 被测: $GATE"
echo "═══════════════════════════════════════════════════════════"

# ── 接线断言: 生产脚本判据必须存在（防"夹具在测一个已删除的判据"）──
grep -q 'TASK_BRIEF_EMPTY="${TASK_BRIEF_EMPTY}  架构层: 未填写' "$GATE" \
  && ok "接线: 生产脚本仍含「架构层: 未填写」判定" \
  || bad "接线: 生产脚本缺该判定（夹具对象漂移）"
grep -q 'brief_parser.py" --layer' "$GATE" \
  && ok "接线: 架构层走同源解析器 brief_parser.py --layer" \
  || bad "接线: 未用同源解析器（D707 单一口径被破坏）"

echo ""
echo "── 正常路径: 合法 2 字符值 L1–L5 与存量自由文本形态 ──"
run_case "L4"; expect_clean "架构层: L4"
run_case "L1"; expect_clean "架构层: L1（合法最短值下界）"
run_case "L5"; expect_clean "架构层: L5（合法最短值上界）"
run_case "基础设施"; expect_clean "架构层: 基础设施（存量自由文本形态）"

echo ""
echo "── 反例（改坏即红 / 不放松）: 空值与 2 字符垃圾仍必须红 ──"
run_case ""; expect_flagged "架构层: 真空值"
run_case "X"; expect_flagged "架构层: X（1 字符）"
run_case "XY"; expect_flagged "架构层: XY（2 字符非 L1–L5）"

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
echo "G6_LAYER_SUMMARY: cases=7 pass=${PASS} fail=0"
exit 0
