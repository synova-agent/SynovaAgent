#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# check-dev-doc-write-set.test.sh — D415/U2 dev doc 写集双向对账门禁测试
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 写集=实际变更 → exit 0
#   降级 —（fail-open 路径由既有 write-set-check.test.sh 覆盖）
#   边界 — 反向漂移（实际变更但未登记）→ exit 1 点名; 文档类豁免（不算漂移）→ exit 0
#   接线 — 反向对账代码真实存在于脚本（铁律 0-2）; quotepath=false 覆盖 3 处 git diff（G12c 中文名盲区）
#   行为 — 中文文件名在 core.quotepath 下还原（K3 上报 + codex 复踩的盲区，真实 git 验证）
#   #1125 删除项语义（真 git 夹具，沙箱"大仓"内真跑生产脚本副本）:
#     正常 — 声明 a.md(删除) + `git mv a.md b.md` ⇒ exit 0
#     承重 — 同一夹具跑"去掉 D"的改坏版 ⇒ exit 1 且点名 a.md（证明承重的是 D）
#     正常 — 纯删除（`rm` + add）声明 (删除) ⇒ exit 0
#     判别 — 声明 c.md(修改) + 零变更 ⇒ **仍 exit 1**（判别力未丢）
#     回归 — 真改 c.md + 声明(修改) ⇒ exit 0（正常路径未被 D 语义带坏）
#     三态 — 非 git 仓 / GIT_DIR 指向不存在 ⇒ exit 2（判不了，不与通过混同）
# 沙箱: SYNO_DEV_DOC 注入 dev doc（跳过得正向对账）+ SYNO_STAGED_FILES 注入暂存文件;
#       mktemp 沙箱 + trap 清理, 零真实 git 暂存; #1125 段用沙箱"大仓"副本（REPO_DIR 落在沙箱内）。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/workflow/check-dev-doc-write-set.sh"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "=== D415/U2 写集双向对账门禁测试 ==="

# ── 接线: 反向对账代码真实存在 ──
if grep -q "实际变更但未登记" "$GATE" && grep -q "SYNO_STAGED_FILES" "$GATE"; then
  ok "接线: 反向对账已接入"
else
  no "接线: 反向对账缺失"
fi

# ── 临时 dev doc（写集声明真实存在的控制塔脚本——正向对账存在性检查要求真实存在）──
REAL="scripts/control-tower/devdoc_writeset.py"
OTHER="scripts/control-tower/staging_guard.py"
DEVDOC="$TMPD/SYNOVA-IMPL-D998-u2test.md"
cat > "$DEVDOC" <<EOF
### 3.1 写集 (1 修改)
| 文件 | 操作 | 说明 |
|------|:---:|------|
| $REAL | 修改 | 测试 |
EOF

# ── 正常: 写集=实际（已登记）→ exit 0 ──
SYNO_DEV_DOC="$DEVDOC" SYNO_STAGED_FILES="$REAL" bash "$GATE" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && ok "写集=实际 → exit 0" || no "写集=实际应 exit 0, 实际 $rc"

# ── 边界: 反向漂移（实际多了未登记的真实文件）→ exit 1 且点名 ──
OUT=$(SYNO_DEV_DOC="$DEVDOC" SYNO_STAGED_FILES="$REAL
$OTHER" bash "$GATE" 2>&1)
rc=$?
if [ "$rc" -eq 1 ] && echo "$OUT" | grep -q "$OTHER"; then
  ok "反向漂移: 未登记 $OTHER 检出 → exit 1"
else
  no "反向漂移应 exit 1 且点名 $OTHER, 实际 rc=$rc"
fi

# ── 边界: 文档豁免（实际含 docs/foo.md 文档类）→ 不算漂移 exit 0 ──
SYNO_DEV_DOC="$DEVDOC" SYNO_STAGED_FILES="$REAL
docs/foo.md" bash "$GATE" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && ok "文档豁免: docs/ 不算漂移 → exit 0" || no "文档豁免应 exit 0, 实际 $rc"

# ── 接线: 中文文件名 quotepath 修复（G12c 盲区，K3 上报 + codex 复踩）──
QW_COUNT=$(grep -c 'git -c core.quotepath=false diff' "$GATE" 2>/dev/null || echo 0)
QW_COUNT=$(echo "$QW_COUNT" | tr -d '\n\r')
[ "$QW_COUNT" -ge 3 ] && ok "接线: quotepath=false 覆盖 3 处 git diff（实际 ${QW_COUNT}）" || no "quotepath=false 应 ≥3 处, 实际 ${QW_COUNT}"

# ── 行为: 中文文件名在 core.quotepath 下还原（真实 git 验证）──
TMPGIT="$TMPD/quotepath-git"
mkdir -p "$TMPGIT" && cd "$TMPGIT" || exit 1
git init -q
git config user.email t@t.com && git config user.name t
echo x > "数据层-测试.md"
git add "数据层-测试.md"
ESCAPED=$(git diff --cached --name-only | head -1)
NORMAL=$(git -c core.quotepath=false diff --cached --name-only | head -1)
cd "$REPO" || exit 1
if echo "$ESCAPED" | grep -q '\\[0-9]' && echo "$NORMAL" | grep -q '数据层-测试'; then
  ok "行为: 默认转义 → quotepath=false 还原中文"
else
  no "quotepath 行为异常: escaped=$ESCAPED normal=$NORMAL"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# #1125：删除项语义（变更集补 D）—— 真 git 夹具，沙箱"大仓"里真跑生产脚本副本
#
# 为什么用副本: 被测脚本的 REPO_DIR 由**脚本自身位置**推（<脚本>/../..），把**运行期 cp 出来的
#   字节相同副本**放进 mktemp 沙箱的 scripts/workflow/ 下，REPO_DIR / WRITESET / DEGRADED_LOG
#   就全部落在沙箱内 ⇒ 既有真实 git 行为，又绝不写真实仓库（零暂存污染）。
#   副本每跑一次测试都由 cp 生成 ⇒ 不会悄悄偏离生产件；另有 WIRE 断言钉住生产件里的 D 覆盖点。
# ═══════════════════════════════════════════════════════════════════════════════
SB="$TMPD/sb"
mkdir -p "$SB/scripts/workflow" "$SB/scripts/control-tower"
cp "$GATE" "$SB/scripts/workflow/check-dev-doc-write-set.sh"
cp "$REPO/scripts/control-tower/devdoc_writeset.py" "$SB/scripts/control-tower/"
GATE_SB="$SB/scripts/workflow/check-dev-doc-write-set.sh"
# 改坏版: 三处变更集一起去掉 D（只有 D 一处差别）—— 用来证明本卡承重的是 D
sed 's/--diff-filter=ACMRD/--diff-filter=ACMR/g' "$GATE_SB" > "$SB/scripts/workflow/gate-no-d.sh"
GATE_NOD="$SB/scripts/workflow/gate-no-d.sh"
( cd "$SB" && git init -q . && git config user.email t@e.com && git config user.name t \
    && git config commit.gpgsign false \
    && printf 'alpha\n' > a.md && printf 'gamma\n' > c.md && printf 'delta\n' > d.md \
    && git add -A && git commit -qm init ) >/dev/null 2>&1
mkdoc() { # $1=doc 文件名 $2=写集路径 $3=操作
  printf '### 3.1 写集 (1 修改)\n| 文件 | 操作 | 说明 |\n|------|:---:|------|\n| %s | %s | #1125 夹具 |\n' \
    "$2" "$3" > "$TMPD/$1"
}

# ── ① 夹具A（正常）: 声明 a.md(删除) + 实际 git mv a.md b.md ⇒ exit 0 ──
( cd "$SB" && git mv a.md b.md ) >/dev/null 2>&1
mkdoc docA.md a.md 删除
OUT_A="$( cd "$SB" && bash "$GATE_SB" "$TMPD/docA.md" 2>&1 )"; RC_A=$?
if [ "$RC_A" -eq 0 ] && printf '%s' "$OUT_A" | grep -q '声明与实际一致'; then
  ok "① #1125 夹具A: 声明 a.md(删除) + git mv a.md b.md ⇒ exit 0（假红已修）"
else
  no "① #1125 夹具A 应 exit 0，实际 rc=${RC_A}: $(printf '%s' "$OUT_A" | tail -3 | tr '\n' ' ')"
fi

# ── ① 承重（改坏即红）: 同一夹具跑"去掉 D"的改坏版 ⇒ exit 1 且点名 a.md ──
OUT_A_NOD="$( cd "$SB" && bash "$GATE_NOD" "$TMPD/docA.md" 2>&1 )"; RC_A_NOD=$?
if [ "$RC_A_NOD" -eq 1 ] && printf '%s' "$OUT_A_NOD" | grep -q 'a\.md'; then
  ok "① 承重: 改坏版（三处变更集去掉 D）同一夹具 ⇒ exit 1 且点名 a.md（D 是承重的）"
else
  no "① 承重失败: 改坏版应 exit 1 且点名 a.md，实际 rc=${RC_A_NOD}: $(printf '%s' "$OUT_A_NOD" | tail -3 | tr '\n' ' ')"
fi

# ── ② 夹具D（正常/纯删除）: rm d.md + add，声明 d.md(删除) ⇒ exit 0 ──
( cd "$SB" && git reset -q --hard && rm -f d.md && git add -A ) >/dev/null 2>&1
mkdoc docD.md d.md 删除
OUT_D="$( cd "$SB" && bash "$GATE_SB" "$TMPD/docD.md" 2>&1 )"; RC_D=$?
[ "$RC_D" -eq 0 ] && ok "② #1125 纯删除夹具: 声明 d.md(删除) + rm ⇒ exit 0（D 进变更集即命中）" \
  || no "② 纯删除夹具应 exit 0，实际 rc=${RC_D}: $(printf '%s' "$OUT_D" | tail -3 | tr '\n' ' ')"

# ── ③ 夹具B（判别力）: 声明 c.md(修改) + 零变更 ⇒ 仍 exit 1 ──
( cd "$SB" && git reset -q --hard ) >/dev/null 2>&1
mkdoc docB.md c.md 修改
OUT_B="$( cd "$SB" && bash "$GATE_SB" "$TMPD/docB.md" 2>&1 )"; RC_B=$?
if [ "$RC_B" -eq 1 ] && printf '%s' "$OUT_B" | grep -q '零实际变更'; then
  ok "③ #1125 判别力: 声明 c.md(修改) + 零变更 ⇒ 仍 exit 1（点：「零实际变更」）"
else
  no "③ 判别力丢失: 声明修改 + 零变更应 exit 1，实际 rc=${RC_B}: $(printf '%s' "$OUT_B" | tail -3 | tr '\n' ' ')"
fi

# ── ④ 回归（正常路径）: 真改 c.md + 声明(修改) ⇒ exit 0 ──
( cd "$SB" && printf 'gamma-changed\n' > c.md ) >/dev/null 2>&1
OUT_B2="$( cd "$SB" && bash "$GATE_SB" "$TMPD/docB.md" 2>&1 )"; RC_B2=$?
( cd "$SB" && git checkout -q -- c.md ) >/dev/null 2>&1
[ "$RC_B2" -eq 0 ] && ok "④ #1125 回归: 真改 c.md + 声明(修改) ⇒ exit 0（D 语义未带坏正常路径）" \
  || no "④ 正常路径被带坏: 应 exit 0，实际 rc=${RC_B2}: $(printf '%s' "$OUT_B2" | tail -3 | tr '\n' ' ')"

# ── ⑤ 三态: git 不可用 ⇒ exit 2（非 git 目录 / GIT_DIR 指向不存在）──
mkdir -p "$TMPD/notgit"
OUT_C1="$( cd "$TMPD/notgit" && bash "$GATE_SB" "$TMPD/docB.md" 2>&1 )"; RC_C1=$?
if [ "$RC_C1" -eq 2 ] && printf '%s' "$OUT_C1" | grep -q 'exit 2'; then
  ok "⑤ #1125 三态: 非 git 目录 ⇒ exit 2（判不了，不与通过混同）"
else
  no "⑤ 非 git 目录应 exit 2，实际 rc=${RC_C1}: $(printf '%s' "$OUT_C1" | tail -2 | tr '\n' ' ')"
fi
OUT_C2="$( cd "$SB" && GIT_DIR="$TMPD/no-such-git-dir" bash "$GATE_SB" "$TMPD/docB.md" 2>&1 )"; RC_C2=$?
[ "$RC_C2" -eq 2 ] && ok "⑤ #1125 三态: GIT_DIR 指向不存在 ⇒ exit 2（fail-closed）" \
  || no "⑤ GIT_DIR 损坏应 exit 2，实际 rc=${RC_C2}: $(printf '%s' "$OUT_C2" | tail -2 | tr '\n' ' ')"

# ── ⑥ 接线（WIRE）: 生产件三处变更集都带 D ＋ 状态表用 name-status --no-renames ──
if grep -q 'diff --cached --name-only --diff-filter=ACMRD' "$GATE" \
   && grep -q 'diff --cached --name-status --diff-filter=ACMRD --no-renames' "$GATE" \
   && grep -q '"--diff-filter=ACMRD"' "$GATE"; then
  ok "⑥ 接线: 三处变更集（doc 发现 / 状态表 / 反向对账）都带 D"
else
  no "⑥ 接线缺失: 三处变更集未同时带 AC MRD（$(grep -c -- '--diff-filter=ACMRD' "$GATE" | tr -d '\r\n') 处命中，含注释）"
fi
if grep -q '判不了：git 不可用' "$GATE" && grep -q 'diff HEAD --name-status --diff-filter=ACMRD --no-renames' "$GATE"; then
  ok "⑥ 接线: git 不可用 exit 2 出口 ＋ worktree-vs-HEAD 状态源均在"
else
  no "⑥ 接线缺失: exit 2 出口或 diff HEAD 状态源缺失"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
