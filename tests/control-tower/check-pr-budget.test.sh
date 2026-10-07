#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-pr-budget.test.sh — D734 PR 预算门禁测试（含 D1028 出库豁免）
#
# 覆盖（铁律 48: 正常 / 降级 / 边界 / 反例）:
#   1. 正常路径 — 小写集单域 → exit 0
#   2. 超预算  — 文件数 > 上限 → exit 1（且点明「拆 PR」）
#   3. 跨域    — 变更落两个域 → **exit 0（信息性，2026-09-29 创始人决策：域不阻断）**
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
#  13. D1028 DS4 三态与降级 — 豁免件 + 域校验器缺失 → **0** / python 不可用 → **0**（2026-09-29 域不阻断）/
#      空变更集不误报「豁免生效」
#  14. D1028 DS5 自过与接线 — bash -n / 冻结规格正则逐字 / 旧口径 --diff-filter=ACMR 清零 /
#      接线 ≥1 / MAX_FILES=12 与「禁调高上限」不回归 / D1028-A2v2 新缝与文案
#  15. D1028-A2v2 死代码清理声明（CTO 本轮裁定: 硬拦保留 + 受控逃生口）—
#      ① 无声明 → 拦 + 可粘贴声明行 + 未生效原因；② 完整声明 5 件 → 放行（⚠️ 生效行 + 计数行）；
#      ③ 完整声明 13 件 → **仍 exit 1（计数 13 > 12，放行 ≠ 豁免）**；④ 只覆盖 4/5 → 不生效 + 点名缺失；
#      ⑤ 无依据 → 不生效；⑥ 通配（目录 / *）→ 不生效；⑦ **DENY_EXACT 不受声明放行**（收紧 2）；
#      ⑧ 段外条目 / --decl-file 优先 / ### 标题；⑨ brief 链: 今日/昨日命中、3 天前不命中、
#      两份当日取并、会话指针新鲜命中、陈旧不命中、SYNO_DR_DECL_FILE 注入缝
#  16. 变异体自检（判别性夹具: 删掉判据必须变红）— ① 去掉 ⊇ 覆盖判据 → 「只覆盖 4 件」变红；
#      ② 把生效路径从计数剔除 → 「13 件」变红；③ 去掉「DENY_EXACT 不受声明放行」→ 该夹具变红
#   8. 接线    — pre-commit 真调用本脚本（铁律 0-2 WIRE CHECK）+ 组数横幅未被改动
#
# 零真实仓库污染: 沙箱 mktemp + 沙箱 git 仓库（PLATFORM-CHECKLIST #6，git 身份用 -c 内联，禁 git config 持久写入）。
# CT-69: 夹具**禁**用中文路径喂 --files/--diff-status（非 ASCII 入参会被 quotepath 误判跨域）。
#   （声明文件里的中文是**文件内容**，不是喂给 --files/--diff-status 的入参，不在 CT-69 范围内。）
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# 被检实现注入点（ctrl-tower-change 模式 5）: 默认 = 仓内实现；
#   SYNO_BUDGET_SRC=<path> 指向基线/变异副本 ⇒ "改坏即红"取证，零真实文件改动。
TOOL="${SYNO_BUDGET_SRC:-$REPO_DIR/scripts/control-tower/check-pr-budget.sh}"
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

# D1028-A2v2: 「## 死代码清理声明」夹具文件生成器
#   $1=目标文件  其余=路径（逐条带铁律 37 依据；末尾放下一标题 —— 顺带验「段终止」）
decl_file() {
  local out="$1"; shift
  local p
  { echo "## 死代码清理声明"
    echo ""
    for p in "$@"; do echo "- ${p} — 铁律 37: grep -rn 零引用确认后删旧文件"; done
    echo ""
    echo "## 下一节（段终止夹具）"
  } > "$out"
}

# D1028-A2v2 变异体生成器: 精确字面替换（index/substr —— 零正则转义坑，BSD/GNU 通用）
#   $1=源文件 $2=目标文件 $3=旧字面量 $4=新字面量 → 0 = 已替换；锚点缺失 → 非 0（防「静默未变异」假红）
mutate() {
  local src="$1" dst="$2" old="$3" new="$4"
  awk -v old="$old" -v new="$new" '
    { if (!done) { p = index($0, old); if (p > 0) { $0 = substr($0, 1, p - 1) new substr($0, p + length(old)); done = 1 } } print }
    END { exit(done ? 0 : 1) }
  ' "$src" > "$dst"
}

# 变异体工具镜像目录（check-ownership.py 的 REPO_ROOT = 自身 ../.. ⇒ 必须镜像仓内相对结构）
mk_mutant() {  # $1=目录 $2=旧字面量 $3=新字面量
  local d="$1"
  mkdir -p "$d/scripts/control-tower" "$d/scripts/product-lines" "$d/docs/synova/coordination" || return 1
  cp "$REPO_DIR/scripts/control-tower/check-ownership.py" "$d/scripts/control-tower/" || return 1
  cp "$REPO_DIR/scripts/product-lines/productline_yaml.py" "$d/scripts/product-lines/" || return 1
  cp "$REPO_DIR/docs/synova/coordination/ownership.yaml" "$d/docs/synova/coordination/" || return 1
  mutate "$TOOL" "$d/scripts/control-tower/check-pr-budget.sh" "$2" "$3" || return 1
  return 0
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
echo "── 3. 单域（2026-10-07 分域废止后）：跨域结构上不可能 → exit 0 ──"
# 🔴 原断言为「变更跨域」+ exit 0（信息性）。分域废止后 ownership.yaml 单域
#    ⇒ 任意路径组合恒同域 ⇒ 「跨域」永不出现在输出里。
#    改用**正面判据**：必须点名「变更单域」（证明域判定仍在跑，非静默跳过）。
run_expect 0 "混合路径不阻断（单域）" --files "scripts/control-tower/check-pr-budget.sh src/server.ts"
if echo "$OUT" | grep -q "变更单域"; then pass "输出点名「变更单域」（域判定在跑）"; else fail "未点名单域（疑似域判定被静默跳过）"; fi
# （不设「域不用于分配/阻断」断言：该注记只在**跨域**分支打印；单域走 PASS 分支，见上一条正面判据。）
# 域判定豁免: bypass.log（各线都写的簿记）不应把单域 PR 误判成跨域
run_expect 0 "bypass.log 豁免后仍单域" --files ".claude/bypass.log scripts/control-tower/check-pr-budget.sh"
# D758: PR #538 实测形态——Win 的 1-5 双引导 + 它自己的验收证据，曾被判跨域卡死
run_expect 0 "D758 证据目录豁免: Win 代码 + 自己的验收证据 → 单域" --files "docs/synova/product-lines/evidence/D716-win-20260913/1-5-dual-guide-win-evidence.txt src/server.ts tests/routes/setup-guide-retired.test.ts"
run_expect 0 "D758 证据 + Win 代码 + Mac 脚本（跨域不阻断）" --files "docs/synova/product-lines/evidence/D716-win-20260913/x.txt src/server.ts scripts/control-tower/check-pr-budget.sh"

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
echo "── 6. 域校验器缺失 → exit 0（信息性，不阻断；2026-09-29）──"
mkdir -p "$TMPD/nochecker"
cp "$TOOL" "$TMPD/nochecker/check-pr-budget.sh"
OUT="$(bash "$TMPD/nochecker/check-pr-budget.sh" --files "scripts/control-tower/check-pr-budget.sh" 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "缺 check-ownership.py → **不阻断**（2026-09-29 新语义：域信息性）" || fail "缺域校验器 — 期望 0 实际 $_e"
if echo "$OUT" | grep -q "域信息跳过"; then pass "输出点名「域信息跳过」（不静默）"; else fail "信息跳过来源未点名"; fi

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
if echo "$OUT" | grep -q "域信息跳过"; then pass "DS1③ 豁免后 N_FILES=0（② 域信息跳过）"; else fail "DS1③ 豁免后未归零"; fi
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
echo "── 11c. CT-D 豁免粒度: 目录级豁免逐条可核 + 数量阈值 ──"
# 粒度①: 每个豁免路径逐行打印（原实现只给一个计数 ⇒ 豁免了哪些文件不可核）
run_expect 0 "CT-D① 治理豁免 + evidence 豁免混排" --files "task-state/D999.json docs/synova/product-lines/evidence/CT9-a.md scripts/control-tower/check-pr-budget.sh"
echo "$OUT" | grep -q "· task-state/D999.json" && pass "CT-D① 逐条打印治理豁免路径" || fail "CT-D① 未逐条打印豁免路径"
echo "$OUT" | grep -q "CT9-a.md" && pass "CT-D① 逐条打印 evidence 豁免路径" || fail "CT-D① 未打印 evidence 豁免路径"
echo "$OUT" | grep -q "目录级豁免 docs/synova/product-lines/evidence/" && pass "CT-D① 明示「目录级豁免」来源" || fail "CT-D① 未明示目录级豁免来源"

# 粒度②: evidence 目录豁免件数上限 = --max-files（不引入新魔数）
EV12=""; for _i in $(seq 1 12); do EV12="$EV12 docs/synova/product-lines/evidence/x$_i.txt"; done
EV13="$EV12 docs/synova/product-lines/evidence/x13.txt"
run_expect 0 "CT-D② 12 件 evidence（恰在上限）→ 不报超阈值" --files "$EV12 scripts/control-tower/check-pr-budget.sh"
echo "$OUT" | grep -q "CT-D evidence 目录级豁免超阈值" && fail "CT-D② 恰在上限内误报超阈值" || pass "CT-D② 恰在上限内不告警"
run_expect 0 "CT-D② 13 件 evidence + 1 脚本 → 超出 1 件计入预算（仍 ≤12）" --files "$EV13 scripts/control-tower/check-pr-budget.sh"
echo "$OUT" | grep -q "共 13 件 > 上限 12 件" && pass "CT-D② 超阈值口径点名（共 N 件 / 上限）" || fail "CT-D② 超阈值未点名"
echo "$OUT" | grep -q "x13.txt" && pass "CT-D② 逐条点名被计入预算的文件" || fail "CT-D② 未点名被计入的文件"
echo "$OUT" | grep -q "✅ ① 变更文件数 2 " && pass "CT-D② 计数正确（13 豁免 12 + 超阈值 1 + 脚本 1 = 2 计入）" || fail "CT-D② 计数不符: $(echo "$OUT" | grep -a '① 变更文件数' )"

# 粒度② 判别性: 13 件 evidence + 12 件代码 —— 超出的 1 件真进预算 ⇒ 13 > 12 判红。
#   去掉阈值（= 原实现的无界目录级豁免）时这里是 12 ≤ 12 **假绿**（见证据文件改前/改后对照）。
C12=""; for _i in $(seq 1 12); do C12="$C12 scripts/control-tower/z$_i.sh"; done
run_expect 1 "CT-D② 13 evidence + 12 代码 → 超出件计入后 13 > 上限 12 判红" --files "$EV13 $C12"
echo "$OUT" | grep -q "13 > 上限 12" && pass "CT-D② 判红口径点名 13 > 12" || fail "CT-D② 判红口径未点名"
run_expect 0 "CT-D② 反例: 12 evidence + 12 代码 → 仍在预算（阈值不误拦）" --files "$EV12 $C12"

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
if [ "$_e" = 0 ]; then pass "DS4 豁免件 + 域校验器缺失 → exit 0（域信息性，不阻断）"; else fail "DS4 豁免件缺校验器 — 期望 0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
BROKEN="$TMPD/d1028-brokenpy"
mkdir -p "$BROKEN"
for _c in python3 python py; do printf '#!/bin/sh\nexit 1\n' > "$BROKEN/$_c"; chmod +x "$BROKEN/$_c"; done
OUT="$(PATH="$BROKEN:$PATH" bash "$TOOL" --diff-status "$(printf 'D\tdocs/archive/a.md\n')" 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "DS4 python 不可用（三级探测全废）→ exit 0（域信息性，不阻断）"; else fail "DS4 python 不可用 — 期望 0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
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
# 2026-09-29 变更（创始人决策：客户数据安全事件处置）—— 白名单扩 4 前缀：
#   docs/synova/ （存量客户名 104 件）｜docs/research/（2）｜decisions/（1）｜CHRONICLE.md（1）
#   理由：纯删（无 A/M）风险低 + DENY/DENY_EXACT 兜底仍在；域门禁同日废除（见 D1062）
ALLOW_SPEC='^(\.claude/task-briefs/|docs/plans/|docs/synova/coordination/|memory/notes/|docs/synova/archive/|docs/archive/|docs/synova/|docs/research/|decisions/|CHRONICLE\.md$)'
DENY_SPEC='^(src/|scripts/|\.github/|tests/|extensions/|expert/)'
if grep -qF "$ALLOW_SPEC" "$TOOL"; then pass "DS5 ✅ 出库白名单正则与冻结规格逐字一致"; else fail "DS5 ✅ 白名单正则漂移"; fi
if grep -qF "$DENY_SPEC" "$TOOL"; then pass "DS5 ❌ 拒绝名单正则与冻结规格逐字一致"; else fail "DS5 ❌ 拒绝名单正则漂移"; fi
if grep -qF 'ownership\.yaml' "$TOOL" && grep -qF 'AUDIT-PROTOCOL\.md' "$TOOL"; then pass "DS5 ❌ DENY_EXACT（ownership.yaml / AUDIT-PROTOCOL.md）在"; else fail "DS5 DENY_EXACT 缺失"; fi
if grep -q "^MAX_FILES=12$" "$TOOL"; then pass "DS5 MAX_FILES=12 默认值不回归"; else fail "DS5 MAX_FILES 默认值被改"; fi
if grep -q "禁调高上限" "$TOOL"; then pass "DS5 「禁调高上限」输出不回归"; else fail "DS5 「禁调高上限」输出丢失"; fi
for _k in '@input' '@output' '@exit' '@degraded'; do
  if grep -q "^#   $_k" "$TOOL"; then pass "DS5 头注释契约含 $_k"; else fail "DS5 头注释契约缺 $_k"; fi
done
# D1028-A2v2 新缝与承重文案（改坏即红）
if grep -qF -- '--decl-file' "$TOOL"; then pass "DS5-A2v2 --decl-file 注入缝在"; else fail "DS5-A2v2 无 --decl-file 注入缝"; fi
if grep -qF 'DAY_WINDOW_RE' "$TOOL"; then pass "DS5-A2v2 brief 链当日窗口 DAY_WINDOW_RE 在（与 pre-commit 同口径）"; else fail "DS5-A2v2 无 DAY_WINDOW_RE"; fi
if grep -qF '死代码清理声明生效：' "$TOOL"; then pass "DS5-A2v2 生效行文案在"; else fail "DS5-A2v2 生效行文案缺失"; fi
if grep -qF '放行 ≠ 豁免' "$TOOL"; then pass "DS5-A2v2 「放行 ≠ 豁免」文案在（计数不剔除）"; else fail "DS5-A2v2 缺「放行 ≠ 豁免」"; fi
if grep -qF 'DENY_EXACT 绝不随声明放行' "$TOOL"; then pass "DS5-A2v2 收紧判据锚点（DENY_EXACT 不随声明放行）在"; else fail "DS5-A2v2 DENY_EXACT 收紧判据缺失"; fi
if grep -qF '依据待补' "$TOOL"; then pass "DS5-A2v2 可粘贴声明行（依据待补）在"; else fail "DS5-A2v2 无可粘贴声明行"; fi
# 声明必须**脚本内自解析**（禁改 scripts/pre-commit-check.sh）—— 红线: pre-commit 侧零声明字样
if grep -qF -- '--decl-file' "$PC"; then fail "DS5-A2v2 pre-commit 侧被改（应保持脚本内自解析）"; else pass "DS5-A2v2 pre-commit 侧未被改（声明解析在 check-pr-budget.sh 内）"; fi
if grep -qF '死代码清理声明' "$PC"; then fail "DS5-A2v2 pre-commit 侧出现声明字样（红线: 不改 pre-commit）"; else pass "DS5-A2v2 pre-commit 侧无声明字样"; fi
_PCN="$(grep -c "check-pr-budget.sh" "$PC" | tr -d '\r\n')"
if [ "${_PCN:-0}" -ge 1 ]; then pass "DS5 接线: pre-commit-check.sh 命中 $_PCN 处（≥1）"; else fail "DS5 接线: pre-commit 零调用"; fi

echo ""
echo "── 8. 接线（铁律 0-2 WIRE CHECK）──"
if grep -q "check-pr-budget.sh" "$PC"; then pass "接线: pre-commit-check.sh 真调用本脚本"; else fail "接线: pre-commit 未调用本脚本（死代码）"; fi
# 本任务不并组数：横幅语义必须保持原样（改则打破 fastlane-bypass-only.test.sh 断言）
if grep -q "跳过 12 组" "$PC"; then pass "组数横幅未改（快速通道仍为「跳过 12 组」）"; else fail "快速通道横幅被改动 → 会打破白名单外的 fastlane 测试"; fi
if grep -q "全部 13 组通过" "$PC"; then pass "总结横幅仍为 13 组（未并组）"; else fail "总结横幅组数被改"; fi

echo ""
echo "── 15. D1028-A2v2 死代码清理声明（硬拦保留 + 受控逃生口）──"
DCL="$TMPD/d1028-a2v2"
mkdir -p "$DCL"
SET5D="$(mk_set 'src/mod' 5 D '.ts')"
SET13D="$(mk_set 'src/mod' 13 D '.ts')"
P5="src/mod001.ts src/mod002.ts src/mod003.ts src/mod004.ts src/mod005.ts"
P13=""
for _i in $(seq 1 13); do P13="$P13 src/mod$(printf '%03d' "$_i").ts"; done
decl_file "$DCL/ok5.md" $P5
decl_file "$DCL/ok13.md" $P13
decl_file "$DCL/only4.md" src/mod001.ts src/mod002.ts src/mod003.ts src/mod004.ts
decl_file "$DCL/ok5exact.md" $P5 docs/synova/coordination/ownership.yaml
decl_file "$DCL/ok1exact.md" src/mod001.ts docs/synova/coordination/AUDIT-PROTOCOL.md

# 15.1 无声明 → 拦 + 可粘贴声明行 + 未生效原因
run_expect 1 "15.1 无声明（--decl-file 不存在）+ 纯删 src/** 5 件 → exit 1（回归）" --diff-status "$SET5D" --decl-file "$DCL/nonexistent.md"
if echo "$OUT" | grep -q "❌ ① D1028 旁路封堵"; then pass "15.1 保留「旁路封堵」❌ 行"; else fail "15.1 旁路封堵行丢失"; fi
if echo "$OUT" | grep -qF -- "- src/mod001.ts — 依据待补"; then pass "15.1 打印可直接粘贴的精确声明行（依据待补）"; else fail "15.1 未打印可粘贴声明行"; fi
if echo "$OUT" | grep -q "未找到声明来源"; then pass "15.1 明示未生效原因（不静默）"; else fail "15.1 未明示未生效原因"; fi
if echo "$OUT" | grep -q "死代码清理声明生效"; then fail "15.1 无声明却报「生效」"; else pass "15.1 无声明未误报生效"; fi
if echo "$OUT" | grep -q "不受「## 死代码清理声明」放行"; then fail "15.1 无 DENY_EXACT 却报收紧提示"; else pass "15.1 无 DENY_EXACT 时不误报收紧提示"; fi
# ① 可读性（CTO 收口指令）：不得让执行方以为逃生口静默失效 —— 无来源 vs 有来源不生效必须分开说
if echo "$OUT" | grep -qF "ℹ️ 未找到声明来源（已尝试: --decl-file / \$SYNO_DR_DECL_FILE / .claude/current-brief.\$DSH_SESSION_ID / .claude/current-brief / .claude/task-briefs 当日窗口 ±1 天）"; then pass "15.1b 无来源时给「未找到声明来源…已尝试」正解句"; else fail "15.1b 未给「未找到声明来源」正解句"; fi
if echo "$OUT" | grep -q -- "- --decl-file=.*（不可读）"; then pass "15.1b 「已尝试」逐条列出失败来源（--decl-file 不可读）"; else fail "15.1b 「已尝试」未逐条列出"; fi
if echo "$OUT" | grep -q "找到声明来源，但不生效"; then fail "15.1b 无来源却报「找到声明来源」"; else pass "15.1b 无来源时不误报「找到声明来源」"; fi

# 15.2 完整声明 + 5 件 → 放行（⚠️ 生效行 + 计数行）
run_expect 0 "15.2 完整声明 + 纯删 src/** 5 件 → exit 0" --diff-status "$SET5D" --decl-file "$DCL/ok5.md"
if echo "$OUT" | grep -q "⚠️  D1028 死代码清理声明生效：5 件（逐条放行）"; then pass "15.2 ⚠️ 生效行逐字 + 件数 5"; else fail "15.2 ⚠️ 生效行缺失或件数不符"; fi
if echo "$OUT" | grep -q "✅ ① 变更文件数 5 ≤ 上限 12"; then pass "15.2 计数行 5 ≤ 上限 12（生效路径仍计入预算）"; else fail "15.2 计数行不符"; fi
if echo "$OUT" | grep -q "放行 ≠ 豁免"; then pass "15.2 明示「放行 ≠ 豁免」"; else fail "15.2 未明示放行≠豁免"; fi
if echo "$OUT" | grep -q "❌ ① D1028 旁路封堵"; then fail "15.2 生效后仍触发旁路封堵"; else pass "15.2 生效后未触发旁路封堵"; fi
# ② 收口（队长裁定）：来源必须逐条带**文件路径**，不许只写泛称「brief 链」—— 可审计
if echo "$OUT" | grep -q -- "· --decl-file → .*ok5.md"; then pass "15.2b 生效来源逐条带文件路径（--decl-file → <path>）"; else fail "15.2b 生效来源未逐条带路径"; fi
if echo "$OUT" | grep -q "生效来源（逐条列出实际取证的文件路径"; then pass "15.2b 输出含「生效来源（逐条列出实际取证的文件路径…）」小标题"; else fail "15.2b 缺生效来源小标题"; fi

# 15.3 完整声明 + 13 件 → **仍 exit 1**（放行 ≠ 豁免的承重夹具）
run_expect 1 "15.3 完整声明 + 纯删 src/** 13 件 → exit 1（计数 13 > 12）" --diff-status "$SET13D" --decl-file "$DCL/ok13.md"
if echo "$OUT" | grep -q "❌ ① 变更文件数 13 > 上限 12"; then pass "15.3 计数行 13 > 上限 12（证明放行 ≠ 豁免）"; else fail "15.3 13 件未被计数拦截"; fi
if echo "$OUT" | grep -q "死代码清理声明生效：13 件"; then pass "15.3 声明按 13 件生效（未被剔除出计数）"; else fail "15.3 生效件数不符"; fi
if echo "$OUT" | grep -q "❌ ① D1028 旁路封堵"; then fail "15.3 13 件被误判为旁路封堵"; else pass "15.3 13 件走了计数拦截（非旁路封堵）"; fi

# 15.4 只覆盖 4/5 → 不生效 + 点名缺失
run_expect 1 "15.4 声明只覆盖 5 件中的 4 件 → 不生效 exit 1" --diff-status "$SET5D" --decl-file "$DCL/only4.md"
if echo "$OUT" | grep -q "声明未覆盖的 ❌ D/R 路径 1 件"; then pass "15.4 点名「未覆盖 1 件」"; else fail "15.4 未点名缺失件数"; fi
# 判别性: 只在**缺失清单段**里找路径（否则会被上面的 ⓑ 拒绝名单列表蒙过）
MISS_SEC="$(printf '%s\n' "$OUT" | awk '/声明未覆盖的 ❌ D\/R 路径/{f=1} f')"
if printf '%s\n' "$MISS_SEC" | grep -q "^ *src/mod005.ts$"; then pass "15.4 缺失清单段逐条点名 src/mod005.ts"; else fail "15.4 缺失清单未点名该路径"; fi
if echo "$OUT" | grep -q "找到声明来源，但不生效"; then pass "15.4b 有来源不生效时给「找到声明来源，但不生效」正解句 + 逐条来源"; else fail "15.4b 未给「找到声明来源」正解句"; fi
if echo "$OUT" | grep -q "· 来源: .*only4.md"; then pass "15.4b 逐条列出已解析到的来源文件"; else fail "15.4b 未逐条列来源文件"; fi
if echo "$OUT" | grep -q "死代码清理声明生效"; then fail "15.4 覆盖不全却放行"; else pass "15.4 覆盖不全未放行"; fi

# 15.5 条目无依据 → 不生效
{ echo "## 死代码清理声明"; for _p in $P5; do echo "- $_p"; done; } > "$DCL/noreason.md"
run_expect 1 "15.5 条目无依据（无 — 分隔）→ 不生效 exit 1" --diff-status "$SET5D" --decl-file "$DCL/noreason.md"
if echo "$OUT" | grep -q "条目全部无依据"; then pass "15.5 明示「条目全部无依据」"; else fail "15.5 未明示无依据"; fi
if echo "$OUT" | grep -q "无依据条目 5 条"; then pass "15.5b 逐条点名「无依据条目 5 条」"; else fail "15.5b 未逐条点名无依据条目"; fi
if echo "$OUT" | grep -q -- "- src/mod001.ts （缺 — <铁律 37 依据>）"; then pass "15.5b 点名具体无依据条目"; else fail "15.5b 未点名具体条目"; fi
if echo "$OUT" | grep -q "死代码清理声明生效"; then fail "15.5 无依据却放行"; else pass "15.5 无依据未放行"; fi

# 15.6 通配 → 不生效（目录条目 / 星号条目）
{ echo "## 死代码清理声明"; echo "- src/ — 全部死代码"; } > "$DCL/globdir.md"
run_expect 1 "15.6 通配目录条目（src/）+ 实际 5 件 → 不生效 exit 1" --diff-status "$SET5D" --decl-file "$DCL/globdir.md"
if echo "$OUT" | grep -q "声明未覆盖的 ❌ D/R 路径 5 件"; then pass "15.6 点名 5 件全未覆盖"; else fail "15.6 未点名缺失"; fi
{ echo "## 死代码清理声明"; echo "- src/*.ts — 全部死代码"; } > "$DCL/globstar.md"
run_expect 1 "15.6b 含 * 通配条目 → 不作有效条目 → 不生效 exit 1" --diff-status "$SET5D" --decl-file "$DCL/globstar.md"
if echo "$OUT" | grep -q "含通配符条目 1 条"; then pass "15.6b 明示「含通配符条目 1 条」（不作有效条目）"; else fail "15.6b 未明示通配条目"; fi
if echo "$OUT" | grep -q -- "- src/\*.ts"; then pass "15.6b 点名具体通配条目"; else fail "15.6b 未点名通配条目"; fi

# 15.7 收紧: DENY_EXACT 不受声明放行（完整声明覆盖 src 5 件 + ownership.yaml → 仍必须出口 1）
SET5E="$(printf 'D\tsrc/mod001.ts\nD\tsrc/mod002.ts\nD\tsrc/mod003.ts\nD\tsrc/mod004.ts\nD\tsrc/mod005.ts\nD\tdocs/synova/coordination/ownership.yaml\n')"
run_expect 1 "15.7 完整声明覆盖 src 5 件 + DENY_EXACT 1 件（ownership.yaml）→ 仍 exit 1" --diff-status "$SET5E" --decl-file "$DCL/ok5exact.md"
if echo "$OUT" | grep -q "⛔ 其中 DENY_EXACT 1 件"; then pass "15.7 点名 DENY_EXACT 件数"; else fail "15.7 未点名 DENY_EXACT 件数"; fi
# 判别性: 只在 **DENY_EXACT 清单段**里找路径（不被 ⓑ 拒绝名单列表蒙过）
EXACT_SEC="$(printf '%s\n' "$OUT" | awk '/⛔ 其中 DENY_EXACT/{f=1} f')"
if printf '%s\n' "$EXACT_SEC" | grep -q "^ *docs/synova/coordination/ownership.yaml$"; then pass "15.7 DENY_EXACT 清单段逐条点名 ownership.yaml"; else fail "15.7 未在该段点名 ownership.yaml"; fi
if echo "$OUT" | grep -q "不受「## 死代码清理声明」放行"; then pass "15.7 明示「不受声明放行」（收紧语义可见）"; else fail "15.7 未明示收紧"; fi
if echo "$OUT" | grep -q "死代码清理声明生效"; then fail "15.7 DENY_EXACT 被声明放行（收紧失效）"; else pass "15.7 DENY_EXACT 未被放行"; fi
if echo "$OUT" | grep -q "找到声明来源，但不生效"; then pass "15.7 有来源不生效 → 正解句（收紧原因可见）"; else fail "15.7 未给正解句"; fi
if echo "$OUT" | grep -q "命中 DENY_EXACT 1 件 —— 不受「## 死代码清理声明」放行"; then pass "15.7 原因逐条列出「命中 DENY_EXACT 不受放行」"; else fail "15.7 原因未逐条列出"; fi
run_expect 1 "15.7b AUDIT-PROTOCOL.md 同款: 声明覆盖它也不放行 → exit 1" --diff-status "$(printf 'D\tsrc/mod001.ts\nD\tdocs/synova/coordination/AUDIT-PROTOCOL.md\n')" --decl-file "$DCL/ok1exact.md"
EXACT_SEC="$(printf '%s\n' "$OUT" | awk '/⛔ 其中 DENY_EXACT/{f=1} f')"
if printf '%s\n' "$EXACT_SEC" | grep -q "^ *docs/synova/coordination/AUDIT-PROTOCOL.md$"; then pass "15.7b DENY_EXACT 清单段点名 AUDIT-PROTOCOL.md"; else fail "15.7b 未在该段点名路径"; fi

# 15.8 段外条目不生效（标题必须逐字为「死代码清理声明」）
{ echo "## 出库声明"; echo "- src/mod001.ts — 理由"; } > "$DCL/wronghead.md"
run_expect 1 "15.8 条目写在「## 出库声明」段 → 不生效 exit 1" --diff-status "$SET5D" --decl-file "$DCL/wronghead.md"
if echo "$OUT" | grep -q "未读到「## 死代码清理声明」段落"; then pass "15.8 明示未读到声明段"; else fail "15.8 未明示"; fi

# 15.9 标题级别 3（###）也识别；--decl-file 优先于 $SYNO_DR_DECL_FILE
{ echo "### 死代码清理声明"; for _p in $P5; do echo "- $_p — 铁律 37: 零引用"; done; echo "#### 段终止"; } > "$DCL/h3.md"
run_expect 0 "15.9 三级标题（###）也被识别 → exit 0" --diff-status "$SET5D" --decl-file "$DCL/h3.md"
OUT="$(SYNO_DR_DECL_FILE="$DCL/only4.md" bash "$TOOL" --diff-status "$SET5D" --decl-file "$DCL/ok5.md" 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "15.9b --decl-file 优先于 \$SYNO_DR_DECL_FILE（显式注入缝权威）"; else fail "15.9b 注入缝优先级错 — 期望 0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
OUT="$(SYNO_DR_DECL_FILE="$DCL/ok5.md" bash "$TOOL" --diff-status "$SET5D" 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "15.9c \$SYNO_DR_DECL_FILE 单独可用 → exit 0"; else fail "15.9c 环境变量注入缝失效 — 期望 0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi

# 15.10 brief 链（沙箱 git 仓；ROOT 用 git toplevel ⇒ 不读真实仓）
DCL_SB="$TMPD/d1028-a2v2-briefs"
mkdir -p "$DCL_SB/.claude/task-briefs"
git -C "$DCL_SB" init -q -b main
DCL_D0="$(date +%Y-%m-%d)"
if date -v-1d +%Y-%m-%d >/dev/null 2>&1; then
  DCL_D1="$(date -v-1d +%Y-%m-%d)"; DCL_D3="$(date -v-3d +%Y-%m-%d)"; DCL_STALE="$(date -v-3d +%Y%m%d%H%M)"
else
  DCL_D1="$(date -d '1 day ago' +%Y-%m-%d)"; DCL_D3="$(date -d '3 days ago' +%Y-%m-%d)"; DCL_STALE="$(date -d '3 days ago' +%Y%m%d%H%M)"
fi
brief_run() {  # $1=期望 exit $2=描述（其余参数透传；cwd=沙箱，环境变量清空以保证夹具决定性）
  local want="$1" desc="$2"; shift 2
  OUT="$(cd "$DCL_SB" && DSH_SESSION_ID="" SYNO_DR_DECL_FILE="" bash "$TOOL" --diff-status "$SET5D" "$@" 2>&1)"; local got=$?
  if [ "$got" = "$want" ]; then pass "$desc (exit=$want)"
  else fail "$desc — 期望 exit=$want 实际 exit=$got"; echo "$OUT" | sed 's/^/      | /' >&2; fi
}
decl_file "$DCL_SB/.claude/task-briefs/$DCL_D0-today.md" $P5
brief_run 0 "15.10 今日 brief 命中（±1 天窗口）→ exit 0（声明来自 brief 链）"
rm -f "$DCL_SB/.claude/task-briefs/$DCL_D0-today.md"
decl_file "$DCL_SB/.claude/task-briefs/$DCL_D1-yest.md" $P5
brief_run 0 "15.10b 昨日 brief 命中（三日窗口 ±1 天）→ exit 0"
rm -f "$DCL_SB/.claude/task-briefs/$DCL_D1-yest.md"
decl_file "$DCL_SB/.claude/task-briefs/$DCL_D3-old.md" $P5
brief_run 1 "15.10c 3 天前 brief（窗口外）→ 不命中 exit 1"
if echo "$OUT" | grep -qF "ℹ️ 未找到声明来源（已尝试: --decl-file / \$SYNO_DR_DECL_FILE / .claude/current-brief.\$DSH_SESSION_ID / .claude/current-brief / .claude/task-briefs 当日窗口 ±1 天）"; then pass "15.10c 无来源时给正解句（窗口外 brief 不算来源）"; else fail "15.10c 未给「未找到声明来源」正解句"; fi
if echo "$OUT" | grep -q -- "- .claude/task-briefs/ 当日窗口（±1 天）: 扫描 1 份 .md，窗口内 0 份"; then pass "15.10c 「已尝试」逐条列出 brief 链扫描计数（1 份 / 窗口内 0 份）"; else fail "15.10c 「已尝试」未列出扫描计数"; fi
rm -f "$DCL_SB/.claude/task-briefs/$DCL_D3-old.md"
{ echo "## 死代码清理声明"; for _i in 1 2 3; do echo "- src/mod$(printf '%03d' "$_i").ts — 铁律 37: 零引用"; done; } > "$DCL_SB/.claude/task-briefs/$DCL_D0-jia.md"
{ echo "## 死代码清理声明"; for _i in 4 5; do echo "- src/mod$(printf '%03d' "$_i").ts — 铁律 37: 零引用"; done; } > "$DCL_SB/.claude/task-briefs/$DCL_D0-yi.md"
run_expect 1 "15.10d 甲（覆盖 1-3）单独 → 不生效 exit 1" --diff-status "$SET5D" --decl-file "$DCL_SB/.claude/task-briefs/$DCL_D0-jia.md"
run_expect 1 "15.10e 乙（覆盖 4-5）单独 → 不生效 exit 1" --diff-status "$SET5D" --decl-file "$DCL_SB/.claude/task-briefs/$DCL_D0-yi.md"
brief_run 0 "15.10f 两份当日 brief **取并**（甲∪乙 覆盖 5）→ exit 0（判别性: 只读一份必红）"
if echo "$OUT" | grep -q "死代码清理声明生效：5 件"; then pass "15.10f 并集生效件数点名 5"; else fail "15.10f 并集件数不符"; fi
# ② 收口：取并来源必须**逐条**列出实际取证的文件路径（只写泛称必红）
SRC_SEC="$(printf '%s\n' "$OUT" | awk '/生效来源（逐条列出/{f=1} f')"
_SRC_CNT="$(printf '%s\n' "$SRC_SEC" | grep -c '^        · ' | tr -d '\r\n')"
if [ "${_SRC_CNT:-0}" -eq 2 ]; then pass "15.10f 生效来源逐条 2 条（取并两来源都可见，非泛称）"; else fail "15.10f 生效来源条数=${_SRC_CNT:-0} — 期望 2（泛称/漏列即红）"; fi
if printf '%s\n' "$SRC_SEC" | grep -q -- "-jia.md$"; then pass "15.10f 来源第 1 条带文件路径（…-jia.md）"; else fail "15.10f 来源未带 -jia.md 路径"; fi
if printf '%s\n' "$SRC_SEC" | grep -q -- "-yi.md$"; then pass "15.10f 来源第 2 条带文件路径（…-yi.md）"; else fail "15.10f 来源未带 -yi.md 路径"; fi
rm -f "$DCL_SB/.claude/task-briefs/$DCL_D0-jia.md" "$DCL_SB/.claude/task-briefs/$DCL_D0-yi.md"
decl_file "$DCL_SB/.claude/task-briefs/$DCL_D0-sid.md" $P5
printf '%s\n' "$DCL_D0-sid.md" > "$DCL_SB/.claude/current-brief.SIDFIX"
OUT="$(cd "$DCL_SB" && DSH_SESSION_ID=SIDFIX SYNO_DR_DECL_FILE="" bash "$TOOL" --diff-status "$SET5D" 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "15.10g 会话指针 current-brief.\$DSH_SESSION_ID 新鲜 → 命中 exit 0"; else fail "15.10g 会话指针未命中 — 期望 0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
touch -t "$DCL_STALE" "$DCL_SB/.claude/task-briefs/$DCL_D0-sid.md"
OUT="$(cd "$DCL_SB" && DSH_SESSION_ID=SIDFIX SYNO_DR_DECL_FILE="" bash "$TOOL" --diff-status "$SET5D" 2>&1)"; _e=$?
if [ "$_e" = 1 ]; then pass "15.10h 会话指针陈旧（mtime 3 天前）→ 不命中 exit 1"; else fail "15.10h 陈旧指针仍命中 — 期望 1 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
if echo "$OUT" | grep -q "指向「不存在/陈旧」brief"; then pass "15.10h 明示陈旧并回退（不静默）"; else fail "15.10h 未明示陈旧"; fi

echo ""
echo "── 16. 变异体自检（判别性夹具: 删掉判据必须变红）──"
MUT1="$TMPD/mut1"; MUT2="$TMPD/mut2"; MUT3="$TMPD/mut3"
OLD1='  elif _decl_covers "$DECL_PATHS" "$DR_DENY_RE_LIST"; then'
NEW1='  elif true; then   # MUTANT-1: 去掉 ⊇ 覆盖判据'
OLD2='N_FILES="$(_count_lines "$COUNTED")"; N_FILES="${N_FILES:-0}"'
NEW2='if [ "$DECL_EFFECTIVE" -eq 1 ]; then COUNTED=""; fi; N_FILES="$(_count_lines "$COUNTED")"; N_FILES="${N_FILES:-0}"'
OLD3='  if [ "$DR_DENY_EXACT_N" -gt 0 ]; then   # 收紧: DENY_EXACT 绝不随声明放行'
NEW3='  if false; then   # MUTANT-3: 去掉「DENY_EXACT 不随声明放行」判据'

if mk_mutant "$MUT1" "$OLD1" "$NEW1"; then pass "16.0 变异体1 已生成（锚点命中且被替换）"; else fail "16.0 变异体1 生成失败（锚点漂移 → 变异未生效）"; fi
if mk_mutant "$MUT2" "$OLD2" "$NEW2"; then pass "16.0 变异体2 已生成（锚点命中且被替换）"; else fail "16.0 变异体2 生成失败（锚点漂移）"; fi
if mk_mutant "$MUT3" "$OLD3" "$NEW3"; then pass "16.0 变异体3 已生成（锚点命中且被替换）"; else fail "16.0 变异体3 生成失败（锚点漂移）"; fi
MT1="$MUT1/scripts/control-tower/check-pr-budget.sh"
MT2="$MUT2/scripts/control-tower/check-pr-budget.sh"
MT3="$MUT3/scripts/control-tower/check-pr-budget.sh"

# 变异体1: 去掉 ⊇ 判据 → 「只覆盖 4 件」夹具必须变红（原工具 exit 1 → 变异体 exit 0）
OUT="$(bash "$MT1" --diff-status "$SET5D" --decl-file "$DCL/only4.md" 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "16.1 去掉 ⊇ 判据 → 「只覆盖 4 件」夹具变红（原 exit 1 → 变异 exit 0）"; else fail "16.1 变异体1 未变红 — 期望 0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
if echo "$OUT" | grep -q "死代码清理声明生效"; then pass "16.1 变异体1 误放行（⚠️ 生效行出现）—— 证明 ⊇ 判据承重"; else fail "16.1 变异体1 未误放行（夹具不判别）"; fi
OUT="$(bash "$MT1" --diff-status "$SET5D" --decl-file "$DCL/nonexistent.md" 2>&1)"; _e=$?
if [ "$_e" = 1 ]; then pass "16.1b 变异体1 在「无声明」场景仍 exit 1（变异是外科式，非钝化）"; else fail "16.1b 变异体1 钝化 — 期望 1 实际 $_e"; fi

# 变异体2: 把生效路径从计数剔除 → 「13 件」夹具必须变红（原工具 exit 1 → 变异体 exit 0）
OUT="$(bash "$MT2" --diff-status "$SET13D" --decl-file "$DCL/ok13.md" 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "16.2 把生效路径从计数剔除 → 「13 件」夹具变红（原 exit 1 → 变异 exit 0）"; else fail "16.2 变异体2 未变红 — 期望 0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
if echo "$OUT" | grep -q "✅ ① 变更文件数 0 ≤ 上限 12"; then pass "16.2 变异体2 计数被清零（证明「放行 ≠ 豁免」靠计数承重）"; else fail "16.2 变异体2 计数未被清零"; fi
OUT="$(bash "$MT2" --diff-status "$SET5D" --decl-file "$DCL/ok5.md" 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "16.2b 变异体2 在 5 件场景仍 exit 0（与原工具同结论，变异非钝化）"; else fail "16.2b 变异体2 5 件场景结论变化 — 期望 0 实际 $_e"; fi

# 变异体3: 去掉「DENY_EXACT 不随声明放行」 → 15.7 的「旁路封堵」行必须消失
#   注意: 变异体3 的 exit 仍是 1 —— 该夹具的 5 个 src(win) + ownership.yaml(mac) 本来就跨域，
#   故判别落在**输出判据**（旁路封堵行是否存在），不是退出码。原工具: 行在 + exit 1。
OUT="$(bash "$TOOL" --diff-status "$SET5E" --decl-file "$DCL/ok5exact.md" 2>&1)"; _e=$?
if [ "$_e" = 1 ] && echo "$OUT" | grep -q "❌ ① D1028 旁路封堵"; then pass "16.3 原工具: 15.7 夹具 exit 1 且含「旁路封堵」行"; else fail "16.3 原工具 15.7 夹具判据不成立 — exit=$_e"; fi
OUT="$(bash "$MT3" --diff-status "$SET5E" --decl-file "$DCL/ok5exact.md" 2>&1)"; _e=$?
if echo "$OUT" | grep -q "❌ ① D1028 旁路封堵"; then fail "16.3 变异体3 仍报旁路封堵（夹具不判别）"; else pass "16.3 去掉 DENY_EXACT 判据 → 「旁路封堵」行消失（夹具变红）"; fi
if echo "$OUT" | grep -q "死代码清理声明生效"; then pass "16.3 变异体3 误放行 DENY_EXACT（⚠️ 生效行出现）—— 证明收紧判据承重"; else fail "16.3 变异体3 未误放行"; fi

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
