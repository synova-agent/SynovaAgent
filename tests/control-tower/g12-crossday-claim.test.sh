#!/usr/bin/env bash
# tests/control-tower/g12-crossday-claim.test.sh — G12「跨天分支认领」判据夹具
#   立项: CTO 派单 A1（2026-10-06）· 提案件 §3「改坏即红夹具」· 送审 K3 前置
#
# 覆盖矩阵（铁律 48：正常 / 反向 / 边界，红必须来自断言而非 exit code 巧合）:
#   A 正常（跨天）  : brief 文件名日期 = 今天−2，暂存文件在**它**的 Q2 写集内
#                     ⇒ 期望「无 G12 违规」（修前：报"不在 Q2 范围内" = 假红）
#   B 反向（真越界）: 暂存文件不在**任何** brief 写集内 ⇒ 期望「有 G12 违规」（修前修后都必须红）
#   C 反向（排除项）: 文件被窗口内 brief 认领但被同一 brief 显式排除 ⇒ 期望「有 G12 违规」
#                     （证明放宽的是"日期"，不是"范围"）
#   D 反向（陈旧非本分支）: 30 天前的 brief 认领该文件，但它既不是本分支可解析的 brief，
#                     也不在窗口内 ⇒ 期望「有 G12 违规」
#                     （这条是红线 §4② 的物理化：防"把日期窗口整个去掉"→ 旧 brief 永久有效）
#   E 边界（fail-open）: 目录内**零**窗口内 brief + 跨天 brief 认领该文件
#                     ⇒ 期望「有认领者」（修前：G12 整段跳过 = 静默放行，连假红都报不出来）
#
# 判定来源：**逐字提取生产脚本的 G12 段**执行（sed 段提取），不重写判定逻辑。
#   ⇒ 生产逻辑被改坏时，本夹具的输入输出随之变化 ⇒ 「改坏即红」。
#   ⇒ 段锚点消失 ⇒ exit 2（三态退出码：2 = 检查自身失败，同样阻断，禁 || true 吞掉）。
#
# 沙箱：零网络、零真实 brief 目录、零 git 依赖（ROOT=临时目录，brief_parser.py 复制入内）。
# ⚠️ 接入：本夹具随**修复 PR** 落地。修复未落地时它按设计为红 —— 不得单独合入 main
#    的必跑面（否则 main 恒红）。注册点 = .github/workflows/ci.yml 的 `for t in \` 密封清单。
# 用法: bash tests/control-tower/g12-crossday-claim.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# 判据预演口: G12_PCC_OVERRIDE=<候选修复脚本> → 用候选脚本的判定段跑同一套断言
#   （用途: K3/CTO 在修复落地**前**就能核"候选判据是否同时满足 6 条断言"，不必先合代码）
PCC="${G12_PCC_OVERRIDE:-$REPO/scripts/pre-commit-check.sh}"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

[ -f "$PCC" ] || { echo "FATAL: 找不到 $PCC"; exit 2; }
# ── 段锚点（生产脚本结构变更即 exit 2，不静默降级）──
S=$(grep -n '^CUR_BRIEF_PATH=""$' "$PCC" | head -1 | cut -d: -f1)
E=$(grep -n 'soft_pass "G12: 所有文件均在 Q2 范围内"' "$PCC" | head -1 | cut -d: -f1)
if [ -z "$S" ] || [ -z "$E" ] || [ "$E" -le "$S" ]; then
  echo "FATAL: G12 段锚点未命中（S='$S' E='$E'）— 生产脚本结构已变，夹具失效需同步"; exit 2
fi
REGION="$(mktemp /tmp/g12region.XXXXXX)"
sed -n "${S},$((E+1))p" "$PCC" > "$REGION"
bash -n "$REGION" || { echo "FATAL: 提取段语法错误（锚点切偏）"; rm -f "$REGION"; exit 2; }

D0=$(date +%Y-%m-%d)
D_OLD=$(date -v-2d +%Y-%m-%d 2>/dev/null || date -d "2 days ago" +%Y-%m-%d 2>/dev/null || echo "$D0")
D_ANCIENT=$(date -v-30d +%Y-%m-%d 2>/dev/null || date -d "30 days ago" +%Y-%m-%d 2>/dev/null || echo "$D0")

G12_VIOLATION=""; G12_SKIPPED=0
brief() { # brief <path> <Q2 做什么 的裸路径...>（必须是裸路径：反引号会被 brief_parser 原样带回 → 匹配失效）
  local p="$1"; shift
  { echo "# T"
    echo "## Q2: 范围 — 正确的最简方案"
    echo "做什么"
    for l in "$@"; do echo "- $l"; done
    echo ""
    echo "不做什么"
    echo "- none/none.ts（无）"
  } > "$p"
}
# run_g12 <briefs_dir> <staged 清单(可多行)> <注入分支名>
run_g12() {
  local bdir="$1" staged="$2" br="$3"
  local sb; sb=$(mktemp -d /tmp/g12case.XXXXXX)
  mkdir -p "$sb/.claude/task-briefs" "$sb/.claude" "$sb/scripts/control-tower"
  cp "$bdir"/*.md "$sb/.claude/task-briefs/" 2>/dev/null || true
  cp "$REPO/scripts/control-tower/brief_parser.py" "$sb/scripts/control-tower/"
  ROOT="$sb"; STAGED_ALL="$staged"; TODAY="$D0"
  # 判据输入契约: 分支名来源 = $SYNO_BRANCH（沙箱可注入；生产缺省 git branch --show-current）
  SYNO_BRANCH="$br"; export SYNO_BRANCH
  G12_VIOLATION=""; G12_SKIPPED=0; G12_POOL=""
  decl_check() { G12_VIOLATION="$2"; }
  hard_check() { G12_VIOLATION="$2"; }
  soft_pass()  { case "$1" in *"G12: 所有文件均在 Q2 范围内"*) G12_SKIPPED=1 ;; esac; }
  soft_check() { :; }
  # shellcheck disable=SC1090
  . "$REGION"
  G12_POOL="$ALL_TODAY_BRIEFS"   # 认领池 — 区分「被认领」与「整段跳过(fail-open)」的判别依据
  rm -rf "$sb"
}

echo "── A 正常：跨天 brief（${D_OLD}）认领自己的写集 ⇒ 期望无违规 ──"
A=$(mktemp -d); brief "$A/${D_OLD}-D900-crossday.md" "src/foo/a.ts"
brief "$A/${D0}-D901-intoday.md" "src/bar/b.ts"
run_g12 "$A" "src/foo/a.ts" "fix/D900-crossday"
if [ -z "$G12_VIOLATION" ]; then ok "跨天 brief 认领成功（无违规）"; else bad "跨天分支被误判越界（假红）: $(echo "$G12_VIOLATION" | tr '\n' ' ')"; fi
rm -rf "$A"

echo "── B 反向：真越界（无人认领）⇒ 期望仍红 ──"
B=$(mktemp -d); brief "$B/${D0}-D901-intoday.md" "src/bar/b.ts"
run_g12 "$B" "src/orphan/c.ts" "fix/D901-intoday"
if echo "$G12_VIOLATION" | grep -q "src/orphan/c.ts"; then ok "真越界仍被阻断"; else bad "真越界被放行（假绿）"; fi
rm -rf "$B"

echo "── C 反向：认领者显式排除 ⇒ 期望仍红 ──"
C=$(mktemp -d)
{ echo "# T"; echo "## Q2: 范围 — 正确的最简方案"; echo "做什么"; echo "- src/bar/b.ts"
  echo ""; echo "不做什么"; echo "- src/bar/b.ts（本卡不碰）"; } > "$C/${D0}-D901-intoday.md"
run_g12 "$C" "src/bar/b.ts" "fix/D901-intoday"
if echo "$G12_VIOLATION" | grep -q "src/bar/b.ts"; then ok "排除项仍生效（范围未被放宽）"; else bad "排除项失效（范围被放宽）"; fi
rm -rf "$C"

echo "── D 反向：陈旧且非本分支的 brief 不得认领（防「窗口整个去掉」）──"
Dd=$(mktemp -d); brief "$Dd/${D_ANCIENT}-D800-lorem.md" "src/legacy/d.ts"
brief "$Dd/${D0}-D901-intoday.md" "src/bar/b.ts"
run_g12 "$Dd" "src/legacy/d.ts" "fix/D901-intoday"
if echo "$G12_VIOLATION" | grep -q "src/legacy/d.ts"; then ok "陈旧非本分支 brief 未获认领权"; else bad "陈旧 brief 永久有效（认领制失效）"; fi
rm -rf "$Dd"

echo "── E 边界：零窗口内 brief + 跨天 brief 认领 ⇒ 期望被纳入认领池（非静默跳过）──"
Ee=$(mktemp -d); brief "$Ee/${D_OLD}-D900-crossday.md" "src/foo/a.ts"
run_g12 "$Ee" "src/foo/a.ts" "fix/D900-crossday"
if ! echo "$G12_POOL" | grep -q "D900-crossday"; then
  bad "G12 认领池为空 → 整段跳过（fail-open，静默放行）"
elif [ -n "$G12_VIOLATION" ]; then
  bad "跨天 brief 在池内但仍被误判: $(echo "$G12_VIOLATION" | tr '\n' ' ')"
else
  ok "跨天 brief 入池且文件被认领（非静默跳过）"
fi
rm -rf "$Ee"

# F = 主链实景（#1009 复现）：分支名不含 D#（fix/batch0a-gates-l1 型）+ CI 树里无 current-brief，
#   跨天 brief 随本提交一起进暂存区 ⇒ 期望它入池并完成认领。
#   ⚠️ 若 CTO 只选 (a)/(c) 不选 (d)，本案例无法满足 —— 那是**已知覆盖边界**，
#      须同时以「brief 改名到执行日」类临时解法兜底（D664×2 + D1137 已有 3 次前例）。
echo "── F 主链实景（#1009 型）：分支名无 D# + 唯一 staged brief 入池 ⇒ 期望无违规 ──"
Ff=$(mktemp -d); brief "$Ff/${D_OLD}-D902-crossday.md" "src/foo/a.ts"
brief "$Ff/${D0}-D901-intoday.md" "src/bar/b.ts"
run_g12 "$Ff" "$(printf 'src/foo/a.ts\n.claude/task-briefs/%s-D902-crossday.md' "$D_OLD")" "fix/batch0a-gates-l1"
if [ -z "$G12_VIOLATION" ]; then ok "本提交携带的 brief 完成认领（主链场景）"; else bad "主链场景仍假红: $(echo "$G12_VIOLATION" | tr '\n' ' ')"; fi
rm -rf "$Ff"

rm -f "$REGION"
echo "结果: $PASS 通过, $FAIL 失败（判定段 = 生产脚本原文 行 $S..$((E+1))）"
[ "$FAIL" -eq 0 ]
