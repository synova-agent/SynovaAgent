#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-pr-budget.test.sh — D734 PR 预算门禁测试（含 D1028 出库豁免）
#
# 覆盖（铁律 48: 正常 / 降级 / 边界 / 反例）:
#   1. 正常路径 — 小写集单域 → exit 0
#   2. 超预算  — 文件数 > 上限 → exit 1（且点明「拆 PR」）
#   3. 跨域    — 变更落两个域 → exit 1（调 D733 check-ownership 单域模式）
#   4. 边界    — 0 文件 / 恰好等于上限 / --max-files 注入
#   5. 降级    — 基线全链不可解析 → 显式 ⚠️ 留痕 + exit 0（不静默、不误红）
#   6. 检查失败 — 域校验器缺失 → exit 2（fail-closed）
#   7. 落后基线 — 沙箱 git 仓库落后 → ⚠️ 告警但 exit 0（不阻断）
#   9. D860 治理产物豁免 — 不计入 ≤12 预算（不回归）
#  10. D860 反例 — 伪装成治理产物的代码仍被计数（不回归）
#  11. D1028 DS1 出库豁免反例 — ① 纯删 src/** 拦 / ② 删 13+改 1 拦 /
#      ②' 判别性夹具（删 1+改 1 → exit 0 且必须报「出库豁免不适用」）/
#      ③ 只删白名单内 300 件放行 / ④ 无「## 出库声明」时豁免仍生效 + ⚠️
#  12. D1028 DS3 旁路封堵 — R 双侧真 git mv（双向）/ DENY_EXACT 精确拒绝 /
#      各 ❌ 前缀 ≥13 件纯删 → 全 exit 1
#  13. D1028 DS4 三态与降级 — 豁免件 + 域校验器缺失 → 2 / python 不可用 → 2 /
#      空变更集不误报「豁免生效」
#  14. D1028 DS5 自过与接线 — bash -n / 冻结规格正则逐字 / 旧口径 --diff-filter=ACMR 清零 /
#      接线 ≥1 / MAX_FILES=12 与「禁调高上限」不回归
#   8. 接线    — pre-commit 真调用本脚本（铁律 0-2 WIRE CHECK）+ 组数横幅未被改动
#
# 零真实仓库污染: 沙箱 mktemp + 沙箱 git 仓库（PLATFORM-CHECKLIST #6，git 身份用 -c 内联，禁 git config 持久写入）。
# CT-69: 夹具**禁**用中文路径喂 --files/--diff-status（非 ASCII 入参会被 quotepath 误判跨域）。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/control-tower/check-pr-budget.sh"
PC="$REPO_DIR/scripts/pre-commit-check.sh"

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

OUT=""
run_expect() {
  local want="$1"; shift
  local desc="$1"; shift
  OUT="$(bash "$TOOL" "$@" 2>&1)"
  local got=$?
  if [ "$got" = "$want" ]; then pass "$desc (exit=$want)"
  else fail "$desc — 期望 exit=$want 实际 exit=$got"; echo "$OUT" | sed 's/^/      | /' >&2; fi
}

# D1028: name-status 注入集生成器（真 TAB 分隔；禁中文路径 —— CT-69）
#   $1=前缀(含目录) $2=件数 $3=状态(D/M/A) $4=后缀(可空)
mk_set() {
  local i
  for i in $(seq 1 "$2"); do printf '%s\t%s%03d%s\n' "$3" "$1" "$i" "${4:-}"; done
}

echo "═══════════════════════════════════════════════════════════"
echo "  D734 PR 预算门禁测试（含 D1028 出库豁免）"
echo "═══════════════════════════════════════════════════════════"

echo ""
echo "── 1. 正常路径: 小写集单域 → exit 0 ──"
run_expect 0 "2 个 Mac 文件" --files "scripts/control-tower/check-pr-budget.sh tests/control-tower/check-pr-budget.test.sh"
if echo "$OUT" | grep -q "✅ ② 变更单域"; then pass "单域判定输出点名"; else fail "单域判定未点名"; fi

echo ""
echo "── 2. 超预算: 文件数 > 上限 → exit 1 ──"
run_expect 1 "13 文件 > 默认 12" --files "a1.ts a2.ts a3.ts a4.ts a5.ts a6.ts a7.ts a8.ts a9.ts a10.ts a11.ts a12.ts a13.ts"
if echo "$OUT" | grep -q "拆 PR"; then pass "超限输出点名「拆 PR」"; else fail "超限未点名拆 PR"; fi
if echo "$OUT" | grep -q "禁调高上限"; then pass "输出禁调高上限"; else fail "未出现禁调高上限"; fi
run_expect 0 "--max-files 20 时同写集放行" --max-files 20 --files "a1.ts a2.ts a3.ts a4.ts a5.ts a6.ts a7.ts a8.ts a9.ts a10.ts a11.ts a12.ts a13.ts"

echo ""
echo "── 3. 跨域: 变更落两个域 → exit 1 ──"
run_expect 1 "Mac 脚本 + Win src 混合" --files "scripts/control-tower/check-pr-budget.sh src/server.ts"
if echo "$OUT" | grep -q "变更跨域"; then pass "跨域输出点名"; else fail "跨域未点名"; fi
# 域判定豁免: bypass.log（各线都写的簿记）不应把单域 PR 误判成跨域
run_expect 0 "bypass.log 豁免后仍单域" --files ".claude/bypass.log scripts/control-tower/check-pr-budget.sh"
# D758: PR #538 实测形态——Win 的 1-5 双引导 + 它自己的验收证据，曾被判跨域卡死
run_expect 0 "D758 证据目录豁免: Win 代码 + 自己的验收证据 → 单域" --files "docs/synova/product-lines/evidence/D716-win-20260913/1-5-dual-guide-win-evidence.txt src/server.ts tests/routes/setup-guide-retired.test.ts"
run_expect 1 "D758 豁免不掩盖真跨域（证据 + Win 代码 + Mac 脚本）" --files "docs/synova/product-lines/evidence/D716-win-20260913/x.txt src/server.ts scripts/control-tower/check-pr-budget.sh"

echo ""
echo "── 4. 边界 ──"
run_expect 0 "0 文件（空写集）" --files ""
run_expect 0 "恰好等于上限" --max-files 2 --files "scripts/control-tower/check-pr-budget.sh tests/control-tower/check-pr-budget.test.sh"
run_expect 1 "上限 1、写集 2" --max-files 1 --files "scripts/control-tower/check-pr-budget.sh tests/control-tower/check-pr-budget.test.sh"

echo ""
echo "── 5. 降级: 基线全链不可解析 → 显式留痕 + exit 0（不误红）──"
# 沙箱用 trunk 而非 main：确保 origin/main / main / origin/HEAD 全链均不存在，才走降级分支
SB="$TMPD/sandbox-repo"
mkdir -p "$SB"
git -C "$SB" init -q -b trunk
git -C "$SB" -c user.name=t -c user.email=t@t commit -q --allow-empty -m c1
OUT="$(cd "$SB" && bash "$TOOL" 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "无任何基线的仓库 → exit 0" || fail "无基线仓库 — 期望 0 实际 $_e"
if echo "$OUT" | grep -q "degraded: 基线不可解析"; then pass "降级明示「基线不可解析」（不静默）"; else fail "降级未明示"; fi
if echo "$OUT" | grep -q "不静默放过"; then pass "降级说明不静默放过"; else fail "降级说明缺失"; fi

echo ""
echo "── 6. 检查失败: 域校验器缺失 → exit 2（fail-closed）──"
mkdir -p "$TMPD/nochecker"
cp "$TOOL" "$TMPD/nochecker/check-pr-budget.sh"
OUT="$(bash "$TMPD/nochecker/check-pr-budget.sh" --files "scripts/control-tower/check-pr-budget.sh" 2>&1)"; _e=$?
[ "$_e" = 2 ] && pass "缺 check-ownership.py → exit 2" || fail "缺域校验器 — 期望 2 实际 $_e"
if echo "$OUT" | grep -q "域校验器缺失"; then pass "缺口点名「域校验器缺失」"; else fail "缺口未点名"; fi

echo ""
echo "── 7. 落后基线: 沙箱仓库真落后 → ⚠️ 告警但 exit 0 ──"
SB2="$TMPD/behind-repo"
mkdir -p "$SB2"
git -C "$SB2" init -q -b main
git -C "$SB2" -c user.name=t -c user.email=t@t commit -q --allow-empty -m c1
git -C "$SB2" checkout -q -b feat
git -C "$SB2" checkout -q main
git -C "$SB2" -c user.name=t -c user.email=t@t commit -q --allow-empty -m c2
git -C "$SB2" checkout -q feat
OUT="$(cd "$SB2" && bash "$TOOL" --base main --max-behind 0 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "落后但未超文件/域预算 → exit 0（落后不阻断）" || fail "落后分支 — 期望 0 实际 $_e"
if echo "$OUT" | grep -q "③ 分支落后"; then pass "落后告警输出点名"; else fail "落后告警未点名"; fi

echo ""
echo "── 9. D860 治理产物豁免: 不计入 ≤12 预算 ──"
# #657/#693 实测形态: 12 交付文件 + 治理产物上枝 → 13/14 件被拦（F9/F12）
run_expect 0 "12 交付文件 + brief/卡/Note/规格 各 1 → 豁免 4 件后 12 计数放行" --files "task-state/D999.json .claude/task-briefs/brief.md memory/notes/implemented/note.md docs/plans/spec.md scripts/control-tower/check-pr-budget.sh tests/control-tower/check-pr-budget.test.sh scripts/control-tower/a3.sh scripts/control-tower/a4.sh scripts/control-tower/a5.sh scripts/control-tower/a6.sh scripts/control-tower/a7.sh scripts/control-tower/a8.sh scripts/control-tower/a9.sh scripts/control-tower/a10.sh"
if echo "$OUT" | grep -q "D860 治理产物豁免: 4 件"; then pass "豁免件数点名（可见，不静默）"; else fail "豁免行未输出"; fi
run_expect 0 "memory/notes yaml 也豁免" --files "memory/notes/proposed/d.yaml scripts/control-tower/check-pr-budget.sh"
run_expect 0 "自验证据目录豁免（docs/synova/product-lines/evidence/）" --files "docs/synova/product-lines/evidence/D860-20260921/a.txt scripts/control-tower/check-pr-budget.sh"

echo ""
echo "── 10. D860 反例: 伪装成治理产物的代码必须仍被计数 ──"
run_expect 1 "13 件纯代码仍被拦（豁免不放宽真代码）" --files "a1.ts a2.ts a3.ts a4.ts a5.ts a6.ts a7.ts a8.ts a9.ts a10.ts a11.ts a12.ts a13.ts"
run_expect 1 "反例: task-state/evil.ts（代码伪装进治理前缀）→ 仍计数 13 > 12" --files "task-state/evil.ts a1.ts a2.ts a3.ts a4.ts a5.ts a6.ts a7.ts a8.ts a9.ts a10.ts a11.ts a12.ts"
if echo "$OUT" | grep -q "13 > 上限 12"; then pass "反例计数点名 13"; else fail "反例计数未点名"; fi
run_expect 1 "反例: .claude/task-briefs/evil.sh 仍计数" --files ".claude/task-briefs/evil.sh a1.ts a2.ts a3.ts a4.ts a5.ts a6.ts a7.ts a8.ts a9.ts a10.ts a11.ts a12.ts"

echo ""
echo "── 11. D1028 DS1 出库豁免反例（--diff-status 注入缝）──"
# ① 纯删 src/** 13 件（旧口径 --diff-filter=ACMR 会滤成 0 件 → 恒过；本项即那条 P6 承重事实的反例）
run_expect 1 "DS1① 纯删 src/** 13 件 → exit 1" --diff-status "$(mk_set 'src/mod' 13 D '.ts')"
if echo "$OUT" | grep -q "白名单外路径"; then pass "DS1① 输出点名「白名单外路径」"; else fail "DS1① 未点名「白名单外路径」"; fi
if echo "$OUT" | grep -q "命中 ❌ 拒绝名单 13 件"; then pass "DS1① 逐条点名 ❌ 命中（共 13 件）"; else fail "DS1① 未点名 ❌ 命中件数"; fi
if echo "$OUT" | grep -q "src/mod001.ts"; then pass "DS1① 逐条列出 ❌ 路径（src/mod001.ts 可见）"; else fail "DS1① ❌ 路径未逐条列出"; fi

# ② 删白名单内 13 件 + 改 1 件 → ⓐ 不满足 → 14 > 12
DS1_2="$(mk_set 'docs/synova/archive/f' 13 D '.md')
M	docs/synova/archive/mod.md"
run_expect 1 "DS1② 删白名单内 13 件 + 改 1 件 → exit 1" --diff-status "$DS1_2"
if echo "$OUT" | grep -q "14 > 上限 12"; then pass "DS1② 计数点名 14 > 上限 12（D/R 计入）"; else fail "DS1② 计数未点名 14"; fi
if echo "$OUT" | grep -q "ⓐ 不满足"; then pass "DS1② 不豁免原因点名 ⓐ"; else fail "DS1② ⓐ 原因缺失"; fi

# ②' 判别性夹具: 删白名单内 1 件 + 改 1 件 → exit 0，但**必须**报「出库豁免不适用」
#      （把 ⓐ 检查删掉 → 本项变红：会误报「出库豁免生效」）
run_expect 0 "DS1②' 删白名单内 1 件 + 改 1 件 → exit 0" --diff-status "$(printf 'D\tdocs/synova/archive/f001.md\nM\tdocs/synova/archive/mod.md\n')"
if echo "$OUT" | grep -q "出库豁免不适用"; then pass "DS1②' 输出含「出库豁免不适用」（判别性夹具）"; else fail "DS1②' 未报「出库豁免不适用」（ⓐ 检查可能被删）"; fi
if echo "$OUT" | grep -q "出库豁免生效"; then fail "DS1②' 误报「出库豁免生效」（ⓐ 未拦住增改件）"; else pass "DS1②' 未误报「出库豁免生效」"; fi
if echo "$OUT" | grep -q "变更文件数 2 ≤ 上限 12"; then pass "DS1②' 回落到既有 ① 计数（2 件）"; else fail "DS1②' 未回落到既有计数"; fi
# 变体: 白名单内但属 D860 治理前缀的 .md（走的另一条不计入路径）→ 仍必须报不适用
run_expect 0 "DS1②' 变体（docs/plans/*.md, D860 前缀）→ exit 0 且仍报不适用" --diff-status "$(printf 'D\tdocs/plans/a.md\nM\tdocs/plans/b.md\n')"
if echo "$OUT" | grep -q "出库豁免不适用"; then pass "DS1②' 变体 输出含「出库豁免不适用」"; else fail "DS1②' 变体 未报不适用"; fi

# ③ 只删白名单内 300 件（无 A/M）→ 豁免生效 + N_FILES=0
#    落点 docs/archive/ 不在 D860 GOV_PREFIX_RE 内 → 放行只能来自 D1028 出库豁免（判别性）
run_expect 0 "DS1③ 只删白名单内 300 件 → exit 0" --diff-status "$(mk_set 'docs/archive/f' 300 D '.md')"
if echo "$OUT" | grep -q "出库豁免生效（300 件纯删除/重命名"; then pass "DS1③ 输出点名「出库豁免生效」+ 300 件"; else fail "DS1③ 未点名豁免生效/件数"; fi
if echo "$OUT" | grep -q "✅ ② 无变更文件 → 域校验跳过"; then pass "DS1③ 豁免后 N_FILES=0（② 域校验跳过）"; else fail "DS1③ 豁免后未归零"; fi
if echo "$OUT" | grep -q "13 > 上限"; then fail "DS1③ 仍在报超预算"; else pass "DS1③ 无超预算残留"; fi

# ④ 只删白名单内文件 + 无「## 出库声明」→ 豁免仍生效 + ⚠️ 提示（§Q2.S4）
run_expect 0 "DS1④ 无「## 出库声明」→ 豁免仍生效" --diff-status "$(mk_set 'docs/synova/archive/g' 5 D '.md')"
if echo "$OUT" | grep -q "出库豁免生效"; then pass "DS1④ 无声明仍放行（未把 PR 正文做成硬条件）"; else fail "DS1④ 无声明被误拦"; fi
if echo "$OUT" | grep -q "⚠️"; then pass "DS1④ ⚠️ 提示可见（不静默）"; else fail "DS1④ 无 ⚠️ 提示"; fi
if echo "$OUT" | grep -q "出库声明"; then pass "DS1④ 提示点明「## 出库声明」"; else fail "DS1④ 未提示补声明"; fi
if grep -qE "gh pr view|GITHUB_EVENT|pull_request\.body" "$TOOL"; then
  fail "DS1④ 脚本读了 PR 正文（pre-commit 拿不到 → 假接线）"
else
  pass "DS1④ 脚本未读 PR 正文（声明确非硬条件，非假接线）"
fi

echo ""
echo "── 11b. D1028 DS1① 真 git 纯删除（非注入：P6 承重事实的反例）──"
# 旧口径 `--name-only --diff-filter=ACMR` 会把 D 全滤掉 → 纯删 13 件 src/** 恒 exit 0。
# 本夹具走**真 git diff**（不经注入缝），故可判别「S1 口径是否真的换成含 D 的 name-status」。
DEL_SB="$TMPD/d1028-del-src"
mkdir -p "$DEL_SB/src" "$DEL_SB/docs/archive"
_i=1
while [ "$_i" -le 13 ]; do printf 'x\n' > "$DEL_SB/src/del$(printf '%03d' "$_i").ts"; _i=$((_i + 1)); done
printf 'y\n' > "$DEL_SB/docs/archive/keep.md"
git -C "$DEL_SB" init -q -b main
git -C "$DEL_SB" add src docs
git -C "$DEL_SB" -c user.name=t -c user.email=t@t commit -q -m base
DEL_BASE="$(git -C "$DEL_SB" rev-parse HEAD)"
_i=1
while [ "$_i" -le 13 ]; do rm -f "$DEL_SB/src/del$(printf '%03d' "$_i").ts"; _i=$((_i + 1)); done
git -C "$DEL_SB" add src
git -C "$DEL_SB" -c user.name=t -c user.email=t@t commit -q -m del
_D_RAW="$(git -C "$DEL_SB" -c core.quotepath=false diff --name-status --find-renames "$DEL_BASE...HEAD")"
if [ "$(printf '%s\n' "$_D_RAW" | grep -c '^D')" = 13 ]; then pass "11b 真 git diff 原始输出含 13 条 D（旧 ACMR 口径为 0 条）"; else fail "11b 真 git D 行数不为 13"; echo "$_D_RAW" | sed 's/^/      | /' >&2; fi
OUT="$(cd "$DEL_SB" && bash "$TOOL" --base "$DEL_BASE" 2>&1)"; _e=$?
if [ "$_e" = 1 ]; then pass "11b 真 git 纯删 src/** 13 件 → exit 1（D 计入预算）"; else fail "11b 真 git 纯删未拦 — 期望 1 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
if echo "$OUT" | grep -q "白名单外路径"; then pass "11b 真 git 纯删点名「白名单外路径」"; else fail "11b 真 git 纯删未点名"; fi
# 反向对照: 真 git 纯删白名单内 20 件 → 豁免生效 exit 0（同一路径上不误拦纯归档）
DEL_SB2="$TMPD/d1028-del-doc"
mkdir -p "$DEL_SB2/docs/archive"
_i=1
while [ "$_i" -le 20 ]; do printf 'x\n' > "$DEL_SB2/docs/archive/doc$(printf '%03d' "$_i").md"; _i=$((_i + 1)); done
git -C "$DEL_SB2" init -q -b main
git -C "$DEL_SB2" add docs
git -C "$DEL_SB2" -c user.name=t -c user.email=t@t commit -q -m base
DEL_BASE2="$(git -C "$DEL_SB2" rev-parse HEAD)"
_i=1
while [ "$_i" -le 20 ]; do rm -f "$DEL_SB2/docs/archive/doc$(printf '%03d' "$_i").md"; _i=$((_i + 1)); done
git -C "$DEL_SB2" add docs
git -C "$DEL_SB2" -c user.name=t -c user.email=t@t commit -q -m del
OUT="$(cd "$DEL_SB2" && bash "$TOOL" --base "$DEL_BASE2" 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "11b 真 git 纯删白名单内 20 件 → exit 0"; else fail "11b 真 git 纯归档删除被误拦 — 期望 0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
if echo "$OUT" | grep -q "出库豁免生效（20 件纯删除/重命名"; then pass "11b 真 git 纯归档删除点名豁免生效 + 件数"; else fail "11b 真 git 纯归档删除未点名豁免"; fi

echo ""
echo "── 12. D1028 DS3 旁路封堵（R 双侧真 git mv + DENY_EXACT + 各 ❌ 前缀）──"
# 真 git mv 沙箱: base 提交 → git mv → 门禁对 base...HEAD 判定（--find-renames 产出 R 行）
mv_case() {  # $1=沙箱名 $2=源路径 $3=目标路径
  local sb="$TMPD/$1"
  mkdir -p "$sb/$(dirname "$2")" "$sb/$(dirname "$3")"
  git -C "$sb" init -q -b main
  printf 'x\n' > "$sb/$2"
  git -C "$sb" add "$2"
  git -C "$sb" -c user.name=t -c user.email=t@t commit -q -m base
  local base; base="$(git -C "$sb" rev-parse HEAD)"
  git -C "$sb" mv "$2" "$3"
  git -C "$sb" -c user.name=t -c user.email=t@t commit -q -m mv
  OUT="$(cd "$sb" && bash "$TOOL" --base "$base" 2>&1)"; MV_EXIT=$?
}
mv_case d1028-mv-src src/a.ts docs/archive/a.ts
if [ "$MV_EXIT" = 1 ]; then pass "DS3 git mv src/a.ts → docs/archive/a.ts → exit 1 (exit=$MV_EXIT)"; else fail "DS3 R 双侧（新侧白名单）未拦 — 期望 1 实际 $MV_EXIT"; echo "$OUT" | sed 's/^/      | /' >&2; fi
if echo "$OUT" | grep -q "src/a.ts"; then pass "DS3 R 双侧 旧侧 src/a.ts 被点名"; else fail "DS3 R 双侧 旧侧未点名"; fi
mv_case d1028-mv-doc docs/plans/a.md src/a.ts
if [ "$MV_EXIT" = 1 ]; then pass "DS3 git mv docs/plans/a.md → src/a.ts → exit 1 (exit=$MV_EXIT)"; else fail "DS3 R 双侧（反向）未拦 — 期望 1 实际 $MV_EXIT"; echo "$OUT" | sed 's/^/      | /' >&2; fi
if echo "$OUT" | grep -q "src/a.ts"; then pass "DS3 R 双侧（反向）新侧 src/a.ts 被点名"; else fail "DS3 R 双侧（反向）未点名新侧"; fi
# 反向对照: 白名单内互相重命名（纯归档）→ 豁免生效，不误拦
mv_case d1028-mv-ok docs/plans/b.md docs/archive/b.md
if [ "$MV_EXIT" = 0 ]; then pass "DS3 白名单内重命名（docs/plans → docs/archive）→ exit 0 豁免"; else fail "DS3 纯归档重命名被误拦 — 期望 0 实际 $MV_EXIT"; echo "$OUT" | sed 's/^/      | /' >&2; fi
if echo "$OUT" | grep -q "出库豁免生效"; then pass "DS3 纯归档重命名 点名豁免生效"; else fail "DS3 纯归档重命名 未点名豁免"; fi

# DENY_EXACT（CTO 2026-09-27 追加）: 单件删除也必须拦
run_expect 1 "DS3 删 docs/synova/coordination/ownership.yaml → exit 1" --diff-status "$(printf 'D\tdocs/synova/coordination/ownership.yaml\n')"
if echo "$OUT" | grep -q "ownership.yaml"; then pass "DS3 DENY_EXACT ownership.yaml 被点名"; else fail "DS3 ownership.yaml 未点名"; fi
run_expect 1 "DS3 删 docs/synova/coordination/AUDIT-PROTOCOL.md → exit 1" --diff-status "$(printf 'D\tdocs/synova/coordination/AUDIT-PROTOCOL.md\n')"
if echo "$OUT" | grep -q "AUDIT-PROTOCOL.md"; then pass "DS3 DENY_EXACT AUDIT-PROTOCOL.md 被点名"; else fail "DS3 AUDIT-PROTOCOL.md 未点名"; fi
# 各 ❌ 前缀 ≥13 件纯删 → 全 exit 1
for _p in ".github/workflows/w" "tests/control-tower/t" "extensions/sentinels/s" "expert/host/e" "scripts/control-tower/s"; do
  run_expect 1 "DS3 ❌ 前缀 $_p ≥13 件纯删 → exit 1" --diff-status "$(mk_set "$_p" 13 D '.ts')"
done

echo ""
echo "── 13. D1028 DS4 三态与降级（豁免不破 fail-closed）──"
NOC="$TMPD/d1028-nochecker"
mkdir -p "$NOC"
cp "$TOOL" "$NOC/check-pr-budget.sh"
OUT="$(bash "$NOC/check-pr-budget.sh" --diff-status "$(printf 'D\tdocs/archive/a.md\n')" 2>&1)"; _e=$?
if [ "$_e" = 2 ]; then pass "DS4 豁免件 + 域校验器缺失 → exit 2（豁免不放行 fail-closed）"; else fail "DS4 豁免件缺校验器 — 期望 2 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
BROKEN="$TMPD/d1028-brokenpy"
mkdir -p "$BROKEN"
for _c in python3 python py; do printf '#!/bin/sh\nexit 1\n' > "$BROKEN/$_c"; chmod +x "$BROKEN/$_c"; done
OUT="$(PATH="$BROKEN:$PATH" bash "$TOOL" --diff-status "$(printf 'D\tdocs/archive/a.md\n')" 2>&1)"; _e=$?
if [ "$_e" = 2 ]; then pass "DS4 python 不可用（三级探测全废）→ exit 2"; else fail "DS4 python 不可用 — 期望 2 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
if echo "$OUT" | grep -q "python 不可用"; then pass "DS4 python 不可用明示（不静默）"; else fail "DS4 python 不可用未明示"; fi
run_expect 0 "DS4 空变更集（--diff-status \"\"）→ exit 0" --diff-status ""
if echo "$OUT" | grep -q "出库豁免生效"; then fail "DS4 空变更集误报「豁免生效」"; else pass "DS4 空变更集不误报「豁免生效」"; fi
if echo "$OUT" | grep -q "变更文件数 0 ≤ 上限 12"; then pass "DS4 空变更集走既有 ① 分支"; else fail "DS4 空变更集未走既有分支"; fi

echo ""
echo "── 14. D1028 DS5 自过与接线 ──"
if bash -n "$TOOL" 2>/dev/null; then pass "DS5 bash -n 语法通过"; else fail "DS5 bash -n 失败"; fi # swallow-ok: bash -n 仅做语法探测，stderr 噪音无信息量，失败由同句 else 断言表达
if grep -q -- "--name-status --find-renames" "$TOOL"; then pass "DS5 S1 新口径 --name-status --find-renames 在"; else fail "DS5 未用 name-status 口径"; fi
if grep -q "diff --name-only --diff-filter=ACMR" "$TOOL"; then fail "DS5 旧口径 --diff-filter=ACMR 残留（双口径风险）"; else pass "DS5 旧口径 --diff-filter=ACMR 已清零"; fi
if grep -qF -- '--diff-status' "$TOOL"; then pass "DS5 --diff-status 注入缝在"; else fail "DS5 无 --diff-status 注入缝"; fi
# 冻结规格正则逐字（防漂移；改一个字符 = 白名单/拒绝名单语义变了）
ALLOW_SPEC='^(\.claude/task-briefs/|docs/plans/|docs/synova/coordination/|memory/notes/|docs/synova/archive/|docs/archive/)'
DENY_SPEC='^(src/|scripts/|\.github/|tests/|extensions/|expert/)'
if grep -qF "$ALLOW_SPEC" "$TOOL"; then pass "DS5 ✅ 出库白名单正则与冻结规格逐字一致"; else fail "DS5 ✅ 白名单正则漂移"; fi
if grep -qF "$DENY_SPEC" "$TOOL"; then pass "DS5 ❌ 拒绝名单正则与冻结规格逐字一致"; else fail "DS5 ❌ 拒绝名单正则漂移"; fi
if grep -qF 'ownership\.yaml' "$TOOL" && grep -qF 'AUDIT-PROTOCOL\.md' "$TOOL"; then pass "DS5 ❌ DENY_EXACT（ownership.yaml / AUDIT-PROTOCOL.md）在"; else fail "DS5 DENY_EXACT 缺失"; fi
if grep -q "^MAX_FILES=12$" "$TOOL"; then pass "DS5 MAX_FILES=12 默认值不回归"; else fail "DS5 MAX_FILES 默认值被改"; fi
if grep -q "禁调高上限" "$TOOL"; then pass "DS5 「禁调高上限」输出不回归"; else fail "DS5 「禁调高上限」输出丢失"; fi
for _k in '@input' '@output' '@exit' '@degraded'; do
  if grep -q "^#   $_k" "$TOOL"; then pass "DS5 头注释契约含 $_k"; else fail "DS5 头注释契约缺 $_k"; fi
done
_PCN="$(grep -c "check-pr-budget.sh" "$PC" | tr -d '\r\n')"
if [ "${_PCN:-0}" -ge 1 ]; then pass "DS5 接线: pre-commit-check.sh 命中 $_PCN 处（≥1）"; else fail "DS5 接线: pre-commit 零调用"; fi

echo ""
echo "── 8. 接线（铁律 0-2 WIRE CHECK）──"
if grep -q "check-pr-budget.sh" "$PC"; then pass "接线: pre-commit-check.sh 真调用本脚本"; else fail "接线: pre-commit 未调用本脚本（死代码）"; fi
# 本任务不并组数：横幅语义必须保持原样（改则打破 fastlane-bypass-only.test.sh 断言）
if grep -q "跳过 12 组" "$PC"; then pass "组数横幅未改（快速通道仍为「跳过 12 组」）"; else fail "快速通道横幅被改动 → 会打破白名单外的 fastlane 测试"; fi
if grep -q "全部 13 组通过" "$PC"; then pass "总结横幅仍为 13 组（未并组）"; else fail "总结横幅组数被改"; fi

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ 全部通过: $PASS 项"
  echo "═══════════════════════════════════════════════════════════"
  exit 0
else
  echo "  ❌ $FAIL 项失败 / $PASS 项通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
