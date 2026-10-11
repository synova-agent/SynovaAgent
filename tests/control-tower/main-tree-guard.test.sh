#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# main-tree-guard.test.sh — D537r2: 主树提交禁止门禁（main-tree-guard.sh）
#
# 覆盖矩阵（铁律 48 三路径 + 技能模式 5 + 纪律 8）:
#   正常（甲） — worktree / 独立克隆（toplevel != SYNO_MAIN_TREE）⇒ 放行 exit 0
#   拦（乙）   — 主树（toplevel == SYNO_MAIN_TREE）⇒ exit 非 0 且点名「禁止在主树提交」
#   逃生舱（丙）— 主树 + SYNO_ALLOW_MAIN_TREE=1 ⇒ 放行，且 degraded-events.log 与
#                bypass 台账均有新行（SYNO_MAIN_TREE / SYNO_CT_DIR / SYNO_BYPASS_LEDGER_DIR
#                注入缝指向 mktemp，零真实主树污染）
#   CI 跳过    — SYNO_CI=1 ⇒ exit 0 且显式打印「主树判据为本地层门禁」（非静默）
#   纪律 8     — 判据自证: SYNO_MAIN_TREE 注入路径互换 ⇒ 甲/乙结果跟着换（证明判定用的
#                是注入路径本身，不是猜的/不是 toplevel 自比较）
#   反例①     — 把判据改回 toplevel 自比较（sed 副本）⇒ 甲必须变红（exit 非 0）
#   反例②     — 去掉逃生舱留痕（sed 副本删两处写日志）⇒ 丙的断言必须变红（日志无新行）
#   接线       — guard 在 pre-commit-check.sh 与 install-hooks.sh 钩子模板中被调用（铁律 0-2）
#   插入点     — pre-commit 内 guard 调用块不含 SYNO_SKIP_PARALLEL_*（外层，A11）
# 沙箱: mktemp 临时 git 仓 + 全量 env 注入；断言三态 exit code + 输出点名
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$REPO/scripts/control-tower/main-tree-guard.sh"
PC="$REPO/scripts/pre-commit-check.sh"
IH="$REPO/scripts/install-hooks.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

echo "=== D537r2: 主树提交禁止门禁 ==="

[ -f "$GUARD" ] && ok "guard 脚本存在" || { no "guard 脚本缺失: ${GUARD}"; echo "结果: 0 通过, 1 失败"; exit 1; }

# ── 沙箱: 两棵独立 git 树（互不为对方的"主树"）──
git init -q "$TMPD/repo-a" && git -C "$TMPD/repo-a" commit -q --allow-empty -m init
git init -q "$TMPD/repo-b" && git -C "$TMPD/repo-b" commit -q --allow-empty -m init

# ── 甲: worktree / 独立克隆 ⇒ 放行 ──
cd "$TMPD/repo-a"
SYNO_MAIN_TREE="$TMPD/repo-b" bash "$GUARD"; RC=$?
[ "$RC" -eq 0 ] && ok "甲: 非主树（独立克隆）→ exit 0" || no "甲: 应 exit 0, 实际 $RC"

# ── 乙: 主树 ⇒ 拦 + 点名 ──
OUT=$(SYNO_MAIN_TREE="$TMPD/repo-a" bash "$GUARD" 2>&1); RC=$?
[ "$RC" -ne 0 ] && ok "乙: 主树 → exit 非 0（${RC}）" || no "乙: 主树应拦, 实际 exit 0"
echo "$OUT" | grep -q "禁止在主树提交" && ok "乙: 点名「禁止在主树提交」" || no "乙: 未点名: $(echo "$OUT" | head -2)"

# ── 丙: 主树 + 逃生舱 ⇒ 放行 + 双日志留痕 ──
CTD="$TMPD/ct"; BLD="$TMPD/bypass"
DLOG="$CTD/logs/degraded-events.log"
BLOG="$BLD/bypass.log"
cd "$TMPD/repo-a"
SYNO_MAIN_TREE="$TMPD/repo-a" SYNO_ALLOW_MAIN_TREE=1 \
  SYNO_CT_DIR="$CTD" SYNO_BYPASS_LEDGER_DIR="$BLD" bash "$GUARD"; RC=$?
[ "$RC" -eq 0 ] && ok "丙: 逃生舱放行 exit 0" || no "丙: 应 exit 0, 实际 $RC"
[ -f "$DLOG" ] && grep -q "main-tree-guard" "$DLOG" && ok "丙: degraded-events.log 有新行" || no "丙: degraded-events.log 缺失/无新行"
[ -f "$BLOG" ] && grep -q "MAIN_TREE_BYPASS" "$BLOG" && ok "丙: bypass 台账有新行" || no "丙: bypass 台账缺失/无新行"
# 逃生舱留痕落点契约: ledger path 机制尊重 SYNO_BYPASS_LEDGER_DIR
LP=$(SYNO_BYPASS_LEDGER_DIR="$BLD" bash "$REPO/scripts/control-tower/bypass-ledger.sh" path 2>/dev/null)   # swallow-ok: 探测型——落点缺失属正常（丙断言另行判空)
[ "$LP" = "$BLOG" ] && ok "丙: bypass 台账走 bypass-ledger.sh path 机制（注入缝生效）" || no "丙: ledger 落点异常: ${LP}"

# ── CI 跳过: SYNO_CI=1 ⇒ exit 0 + 显式原因 ──
cd "$TMPD/repo-a"
OUT=$(SYNO_CI=1 SYNO_MAIN_TREE="$TMPD/repo-a" bash "$GUARD" 2>&1); RC=$?
[ "$RC" -eq 0 ] && ok "CI: SYNO_CI=1 → 跳过 exit 0" || no "CI: 应 exit 0, 实际 $RC"
echo "$OUT" | grep -q "主树判据为本地层门禁" && ok "CI: 显式打印跳过原因（非静默）" || no "CI: 未打印原因: ${OUT}"

# ── 纪律 8: 判据自证「跑的是注入的 SYNO_MAIN_TREE」──
# 同一棵树，注入路径互换 ⇒ 结果必须跟着换（若判据写死/toplevel 自比较，此处必红）
cd "$TMPD/repo-b"
SYNO_MAIN_TREE="$TMPD/repo-a" bash "$GUARD"; RC_A=$?
SYNO_MAIN_TREE="$TMPD/repo-b" bash "$GUARD" 2>/dev/null; RC_B=$?   # swallow-ok: 探测型——非零 rc 即断言对象（B注入应拦）
[ "$RC_A" -eq 0 ] && [ "$RC_B" -ne 0 ] \
  && ok "纪律8: 注入路径互换 ⇒ 放行/拦跟着换（判据消费注入路径）" \
  || no "纪律8: repo-b 下 A注入=$RC_A(期望0) B注入=$RC_B(期望非0)"
# 判据链物理自证: SYNO_MAIN_TREE → MAIN_TREE_CFG → _MAIN_RP（比较项）三环齐备
grep -q 'MAIN_TREE_CFG="${SYNO_MAIN_TREE:-' "$GUARD" \
  && grep -q '_MAIN_RP="$(cd "${MAIN_TREE_CFG}"' "$GUARD" \
  && ok "纪律8: 判定链物理含 SYNO_MAIN_TREE（注入路径进比较项）" \
  || no "纪律8: 判定链未见 SYNO_MAIN_TREE → MAIN_TREE_CFG → _MAIN_RP"

# ── 反例①: 判据改回 toplevel 自比较 ⇒ 甲必须变红 ──
MUT="$TMPD/mut1-guard.sh"
sed 's#_MAIN_RP="$(cd "${MAIN_TREE_CFG}" 2>/dev/null \&\& pwd -P)" || _MAIN_RP="${MAIN_TREE_CFG}"#_MAIN_RP="$_TOP_RP"#' "$GUARD" > "$MUT"
if grep -q '_MAIN_RP="$_TOP_RP"' "$MUT"; then
  cd "$TMPD/repo-a"
  SYNO_MAIN_TREE="$TMPD/repo-b" bash "$MUT" 2>/dev/null; RC=$?   # swallow-ok: 探测型——非零 rc 即断言对象（反例①应拦）
  [ "$RC" -ne 0 ] && ok "反例①: toplevel 自比较变异体 → 甲变红（exit 非 0，变异被抓）" \
    || no "反例①: 变异体仍放行 ⇒ 本测试对型 B 无判别力（首跑就绿=假反例）"
else
  no "反例①: 变异未生效（sed 未命中判据行）— 检查 guard 判据行格式"
fi

# ── 反例②: 去掉逃生舱留痕 ⇒ 丙必须变红 ──
MUT2="$TMPD/mut2-guard.sh"
grep -v 'degraded-events.log 不可写\|MAIN_TREE_BYPASS\|reason\\": \\"main-tree-commit-allowed' "$GUARD" \
  | sed 's#>> "${_DLOG}"#/dev/null#; s#>> "${_LEDGER}"#/dev/null#' > "$MUT2"
if ! grep -q 'MAIN_TREE_BYPASS' "$MUT2"; then
  cd "$TMPD/repo-a"
  D2="$TMPD/ct2/logs/degraded-events.log"; B2="$TMPD/bp2/bypass.log"
  SYNO_MAIN_TREE="$TMPD/repo-a" SYNO_ALLOW_MAIN_TREE=1 \
    SYNO_CT_DIR="$TMPD/ct2" SYNO_BYPASS_LEDGER_DIR="$TMPD/bp2" bash "$MUT2" >/dev/null 2>&1
  if [ ! -f "$D2" ] && [ ! -f "$B2" ]; then
    ok "反例②: 无留痕变异体 → 两日志均无新行 ⇒ 丙的断言必红（变异被抓）"
  else
    no "反例②: 变异体仍产生留痕 ⇒ 丙抓不住去留痕回归"
  fi
else
  no "反例②: 变异未生效（留痕语句仍在）— 检查 grep 过滤模式"
fi

# ── 接线（铁律 0-2 WIRE CHECK）──
grep -q 'main-tree-guard.sh' "$PC" \
  && ok "接线: pre-commit-check.sh 调用 guard" || no "接线: pre-commit 未调用 guard"
grep -q 'scripts/control-tower/main-tree-guard.sh' "$IH" \
  && ok "接线: install-hooks.sh 钩子模板调用 guard" || no "接线: 钩子模板未调用 guard"
# 插入点（A11）: guard 调用块不受 SYNO_SKIP_PARALLEL_* 连坐
_MT_BLOCK=$(awk '/D537 #2 \(D537r2\)/,/^fi$/' "$PC" | grep -v '^[[:space:]]*#')
if echo "$_MT_BLOCK" | grep -q 'main-tree-guard.sh' && ! echo "$_MT_BLOCK" | grep -q 'SYNO_SKIP_PARALLEL'; then
  ok "插入点: guard 调用块在 SYNO_SKIP_PARALLEL_* 外层（不受连坐）"
else
  no "插入点: guard 调用块含 SYNO_SKIP_PARALLEL_* 或未找到调用"
fi
# 生效层（A8）: 钩子模板内 guard 非 0 ⇒ exit 1 硬拦
grep -A4 'main-tree-guard.sh' "$IH" | grep -q 'exit 1' \
  && ok "生效层: 钩子模板 guard 非 0 ⇒ exit 1（裸 git commit 也拦）" || no "生效层: 钩子模板缺硬拦 exit 1"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
