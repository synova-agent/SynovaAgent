#!/usr/bin/env bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# daily-cto-board.test.sh — D1008 配对测试（U7/CT-40 硬要求）
#
# 被考核对象: scripts/control-tower/daily-cto-board.sh（三态: 0=OK 1=红项 2=degraded）
#
# 覆盖矩阵（铁律 48 三路径 + 新增接线判据）:
#   ① 正常路径 — 3 卡 / 有探针(rc=0) / 断面桩 OK / 门禁桩 OK → rc=0，看板「无红项」且各段齐全
#   ② 降级路径 — SYNO_REPO 指向不存在目录 → rc=2 + 「DAILY-BOARD: DEGRADED（工作区不存在）」
#   ③ 边界路径 — 空 task-state/ + 0 个 .ts → rc=0，卡总数 0、比值 n/a（degraded 而非假绿）
#   ④ 探针三态（接线判据）— ok → 一致不报红；DRIFT/rc=1 → rc=1 报红；rc=2 → rc=1 fail-closed
#   ⑤ 无探针 —— 显式「无探针」登记，**不得静默跳过**
#   ⑥ 默认 REPO 判别性断言 —— 不设 SYNO_REPO，跑沙箱内的**脚本副本**：
#        产物必须落沙箱内；回退成硬编码绝对路径 ⇒ 本断言必红
#   ⑦ 沙箱外零写入 —— 全程对「主工作区 + 本仓库」的看板/日志做前后指纹比对
#
# 判别性夹具: ④ 的断言在「移除探针分支的 red=1」或「主流程提前非 0 退出」时必红
#   （改坏即红原始输出见交付回执，非本文件自证）。
#
# 污染边界: 全部沙箱在 mktemp -d，trap 清理；看板一律以 SYNO_REPO 注入沙箱路径，
#   **从不使用默认 REPO（主工作区）**。本脚本只读被考核脚本，不写仓库任何文件。
#   DSH 断面检查器/本地门禁以桩替代 —— 二者本体不在本测试覆盖范围（另有其覆盖）。
# 前置: 需要可用的 python（与脚本同源的三级探测；缺失时脚本自身降级为红，测试即红）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO/scripts/control-tower/daily-cto-board.sh"

# PYBIN 三级探测（禁裸 python3，D520/V5）
PYBIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || command -v py 2>/dev/null || true)"

PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D1008: daily-cto-board 配对测试（正常/降级/边界/探针三态）==="
echo "  脚本: $SCRIPT"
echo "  沙箱: $TMPD"
echo "  PYBIN: ${PYBIN:-<无>}"

# ── 沙箱构造 ────────────────────────────────────────────────────────────────
# $1 = task-state 卡数; $2 = 探针规格 ok|drift|degraded|none; $3 = .ts 文件数
mk_sandbox() {
  SB="$TMPD/sb-$1-$2-$3-$RANDOM"; mkdir -p "$SB"
  git -C "$SB" init -q
  git -C "$SB" config user.email t@t.local
  git -C "$SB" config user.name t
  mkdir -p "$SB/task-state" "$SB/docs" "$SB/src" \
           "$SB/scripts/control-tower" "$SB/.codex/control-tower/logs"
  # DSH 断面检查器桩（本体不在本测试范围）
  printf 'import sys\nprint("DSH-ANCHOR: OK  [stub]")\nsys.exit(0)\n' \
    > "$SB/scripts/control-tower/check-dsh-anchor.py"
  # 本地门禁桩
  printf '#!/usr/bin/env bash\nexit 0\n' > "$SB/scripts/pre-commit-check.sh"
  local i=0
  while [ "$i" -lt "$1" ]; do printf '{"id":"D%s"}\n' "$i" > "$SB/task-state/D$i.json"; i=$((i+1)); done
  i=0
  while [ "$i" -lt "$3" ]; do printf 'export const a%s = 1;\n' "$i" > "$SB/src/a$i.ts"; i=$((i+1)); done
  printf '# doc\n' > "$SB/docs/d.md"
  case "$2" in
    ok)       mkdir -p "$SB/scripts/control-tower/probes"
              printf '#!/usr/bin/env bash\necho "OK: 水位一致"\nexit 0\n' \
                > "$SB/scripts/control-tower/probes/ok-probe.sh" ;;
    drift)    mkdir -p "$SB/scripts/control-tower/probes"
              printf '#!/usr/bin/env bash\necho "DRIFT: 水位落后（声明 D900 / 实测 D1007）"\nexit 1\n' \
                > "$SB/scripts/control-tower/probes/drift-probe.sh" ;;
    degraded) mkdir -p "$SB/scripts/control-tower/probes"
              printf '#!/usr/bin/env bash\necho "degraded: 无 token，无法测量"\nexit 2\n' \
                > "$SB/scripts/control-tower/probes/deg-probe.sh" ;;
    none)     : ;;
  esac
  git -C "$SB" add -A >/dev/null 2>&1
  git -C "$SB" commit -q -m "chore: base"
  echo "$SB"
}

BOARD_REL="docs/synova/coordination/CTO-看板-自动.md"
LOG_REL=".codex/control-tower/logs/daily-board.log"

run_board() { # $1 = sandbox 路径 → 输出合并流；rc 由调用方 $? 取
  SYNO_REPO="$1" bash "$SCRIPT" 2>&1
}

# ── 沙箱外零写入的指纹基线（⑥ 与之比对；主工作区 = git worktree list 首条）──
MAIN_WT="$(git -C "$REPO" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
snap() { if [ -f "$1" ]; then cksum < "$1"; else echo absent; fi; }
snap_all() { for f in "$@"; do printf '%s => %s\n' "$f" "$(snap "$f")"; done; }
GUARD_PATHS=("$MAIN_WT/$BOARD_REL" "$MAIN_WT/$LOG_REL" "$REPO/$BOARD_REL" "$REPO/$LOG_REL")
GUARD_BEFORE="$(snap_all "${GUARD_PATHS[@]}")"
echo "  守卫面（主工作区）: $MAIN_WT"

# ── ① 正常路径 ──────────────────────────────────────────────────────────────
SB=$(mk_sandbox 3 ok 1)
OUT=$(run_board "$SB"); RC=$?
BOARD="$SB/$BOARD_REL"
[ "$RC" -eq 0 ] && ok "① rc=0（无红项即 0，不越界）" || no "① rc 应为 0，实为 ${RC}：$(printf '%s' "$OUT" | tr '\n' ' ')"
[ -f "$BOARD" ] && ok "① 看板已落盘 $BOARD_REL" || no "① 看板未生成"
grep -qF '**结论: 无红项**' "$BOARD" && ok "① 结论=无红项" || no "① 结论错"
grep -qF '卡总数: 3' "$BOARD" && ok "① 卡总数=3（读 task-state）" || no "① 卡总数错"
grep -qF '工作树数: 1' "$BOARD" && ok "① 工作树数=1（git worktree list 生效）" || no "① 工作树数错"
grep -qF '✅ 本地门禁: 全组通过' "$BOARD" && ok "① 门禁段读到桩的 rc=0" || no "① 门禁段错"
grep -qF '📄 文档:代码 比 = 1.00' "$BOARD" && ok "① 比值 1 md ÷ 1 ts = 1.00" || no "① 比值错"
grep -qF '✅ 对账探针 ok-probe.sh: 一致 (rc=0)' "$BOARD" \
  && ok "① 接线: 探针被真实执行且结果进看板（非 grep 型静态判据）" \
  || no "① 探针未被执行/未进看板"

# ── ② 降级路径: 目标工作区不存在 ────────────────────────────────────────────
OUT=$(run_board "$TMPD/does-not-exist-$RANDOM"); RC=$?
[ "$RC" -eq 2 ] && ok "② 缺工作区 → rc=2（degraded，fail-closed）" || no "② rc 应为 2，实为 $RC"
echo "$OUT" | grep -qF 'DAILY-BOARD: DEGRADED (工作区不存在)' \
  && ok "② 降级显式可见（含原因）" || no "② 降级信息缺失: $(printf '%s' "$OUT" | tr '\n' ' ')"

# ── ③ 边界: 空 task-state/ + 0 个 .ts ───────────────────────────────────────
SB=$(mk_sandbox 0 none 0)
OUT=$(run_board "$SB"); RC=$?
BOARD="$SB/$BOARD_REL"
[ "$RC" -eq 0 ] && ok "③ 空 task-state → rc=0（不误报红）" || no "③ rc 应为 0，实为 $RC"
grep -qF '卡总数: 0' "$BOARD" && ok "③ 卡总数=0（空集边界）" || no "③ 卡总数错"
grep -qF '📄 文档:代码 比 = n/a（代码计数为 0，degraded）' "$BOARD" \
  && ok "③ 0 代码 → n/a（degraded 显式，不假绿）" || no "③ 未走 degraded 分支"

# ── ④ 探针三态（本卡新增接线判据）────────────────────────────────────────────
SB=$(mk_sandbox 1 drift 1)
OUT=$(run_board "$SB"); RC=$?
BOARD="$SB/$BOARD_REL"
[ "$RC" -eq 1 ] && ok "④a DRIFT 探针 → rc=1（有红项已告警）" || no "④a rc 应为 1，实为 $RC"
grep -qF '❌ 对账探针 drift-probe.sh: rc=1' "$BOARD" \
  && ok "④a 报警含探针名 + 退出码" || no "④a 未报警/未含退出码"
grep -qF 'DRIFT' "$BOARD" && ok "④a DRIFT 字样进看板（非静默）" || no "④a DRIFT 未透出"

SB=$(mk_sandbox 1 degraded 1)
OUT=$(run_board "$SB"); RC=$?
BOARD="$SB/$BOARD_REL"
[ "$RC" -eq 1 ] && ok "④b 探针 rc=2（无法测量）→ rc=1，fail-closed 不与通过混同" || no "④b rc 应为 1，实为 $RC"
grep -qF '❌ 对账探针 deg-probe.sh: rc=2' "$BOARD" \
  && ok "④b degraded 报警含退出码 2" || no "④b 未报警 rc=2"

SB=$(mk_sandbox 1 ok 1)
OUT=$(run_board "$SB"); RC=$?
BOARD="$SB/$BOARD_REL"
[ "$RC" -eq 0 ] && ok "④c 探针一致 → rc=0（不无端报红）" || no "④c rc 应为 0，实为 $RC"
grep -qF '**结论: 无红项**' "$BOARD" && ok "④c 探针一致不污染结论" || no "④c 结论错"

# ── ⑤ 无探针: 显式登记，不得静默 ────────────────────────────────────────────
SB=$(mk_sandbox 1 none 1)
OUT=$(run_board "$SB"); RC=$?
BOARD="$SB/$BOARD_REL"
grep -qF '⚠️ 对账探针: 无探针' "$BOARD" \
  && ok "⑤ 无探针 → 显式登记（非静默跳过）" || no "⑤ 无探针被静默跳过"
[ "$RC" -eq 0 ] && ok "⑤ 无探针本身不算红（登记≠告警）" || no "⑤ rc 应为 0，实为 $RC"

# ── ⑥ 默认 REPO 判别性断言（D1008-FIX 回归闸）──────────────────────────────
#   以「非主工作区」身份跑**沙箱内的脚本副本**，且**不设 SYNO_REPO**:
#     修复后 → REPO=脚本自身所属仓库根=沙箱 → 产物落沙箱
#     回退成硬编码绝对路径 → 产物落到那个路径，沙箱内无产物 ⇒ 本断言必红
SB=$(mk_sandbox 1 none 1)
cp "$SCRIPT" "$SB/scripts/control-tower/daily-cto-board.sh"
OUT=$(cd "$SB" && bash scripts/control-tower/daily-cto-board.sh 2>&1); RC=$?
if [ "$RC" -eq 0 ]; then ok "⑥ 默认（无 SYNO_REPO）→ rc=0"; else no "⑥ rc 应为 0，实为 ${RC}：$(printf '%s' "$OUT" | tr '\n' ' ')"; fi
if [ -f "$SB/$BOARD_REL" ]; then
  ok "⑥ 产物落「脚本自身所属仓库根」= 沙箱内（默认不再指向主工作区）"
else
  no "⑥ 沙箱内无产物 —— 默认 REPO 解析出了沙箱（硬编码回归）"
fi

# ── ⑦ 沙箱外零写入（指纹前后比对，覆盖 ①–⑥ 全部运行）────────────────────────
GUARD_AFTER="$(snap_all "${GUARD_PATHS[@]}")"
if [ "$GUARD_BEFORE" = "$GUARD_AFTER" ]; then
  ok "⑦ 沙箱外零写入（$MAIN_WT 与本仓库的看板/日志指纹均未变）"
else
  no "⑦ 沙箱外出现写入: $(printf '%s\n%s\n' "$GUARD_BEFORE" "$GUARD_AFTER" | sort | uniq -u | tr '\n' ' ')"
fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
