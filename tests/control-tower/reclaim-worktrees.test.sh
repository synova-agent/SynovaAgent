#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# reclaim-worktrees.test.sh — D1150 worktree 回收器测试（铁律 48: 正常/降级/边界 + 副作用）
#
# 覆盖矩阵:
#   正常 — 夹具仓 4 个特征工作树（已并入且干净 / 领先 1 提交 / 脏 / 保护名单）→ 分类正确
#   副作用 — dry-run 零删除（注册表条目数不变）；--apply 只回收 RECLAIM 那一棵
#   降级 — --repo 指向非仓库 → exit 2（fail-closed，不当成「零可回收」放过）
#   边界 — 未知参数 → exit 2
#   接线 — 工具被 D1150 brief / memory note 引用（grep 物理事实）
#
# 沙箱说明: 夹具建在**本工作树内**（$REPO/.tmp-reclaim-test-$$），不写系统临时区 ——
#   DSH 会话沙箱只保证本工作树可写（实测 /Users/wane 下 mkdir = Operation not permitted）。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$REPO/scripts/control-tower/reclaim-worktrees.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

PY=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1; then PY="$_c"; break; fi
done
[ -n "$PY" ] || { echo "❌ 无可用 python（fail-closed）"; exit 2; }

echo "=== reclaim-worktrees 测试 ==="

# ── 边界: 未知参数 / 非仓库 → exit 2 ──
"$PY" "$TOOL" --bogus-flag >/dev/null 2>&1
[ $? -eq 2 ] && ok "未知参数 → exit 2" || no "未知参数应 exit 2"

"$PY" "$TOOL" --repo /nonexistent-d1150 >/dev/null 2>&1
[ $? -eq 2 ] && ok "非仓库 --repo → exit 2（fail-closed）" || no "非仓库应 exit 2"

# ── 夹具: 独立 mini 仓 + 4 棵特征工作树 ──
TMP="$REPO/.tmp-reclaim-test-$$"
trap 'rm -rf "$TMP"' EXIT
git init -q --bare "$TMP/origin.git"
git init -q -b main "$TMP/work" >/dev/null 2>&1
git -C "$TMP/work" config user.email t@t.local
git -C "$TMP/work" config user.name t
echo a > "$TMP/work/a.txt"
git -C "$TMP/work" add a.txt >/dev/null
git -C "$TMP/work" commit -qm "init"
git -C "$TMP/work" remote add origin "$TMP/origin.git"
git -C "$TMP/work" push -q origin main
git -C "$TMP/work" fetch -q origin

git -C "$TMP/work" worktree add -q "$TMP/wt-a" -b feat/merged origin/main     # 已并入 + 干净
git -C "$TMP/work" worktree add -q "$TMP/wt-b" -b feat/ahead  origin/main     # 领先 1 提交
git -C "$TMP/work" worktree add -q "$TMP/wt-c" -b feat/dirty  origin/main     # 脏
git -C "$TMP/work" worktree add -q "$TMP/wt-d" -b feat/prot   origin/main     # 保护名单
( cd "$TMP/wt-b" && echo b >> a.txt && git commit -qam "ahead commit" )
echo z >> "$TMP/wt-c/a.txt"

BEFORE="$(git -C "$TMP/work" worktree list | wc -l | tr -d ' ')"
[ "$BEFORE" -eq 5 ] && ok "夹具就绪（5 个 worktree: 主 + 4）" || no "夹具工作树数异常: $BEFORE"

# ── 安全: 默认新鲜度护栏（刚 checkout 出来的工作树一律不碰）──
FRESH="$("$PY" "$TOOL" --repo "$TMP/work" --protect "$TMP/wt-d" --json 2>/dev/null \
  | "$PY" -c 'import json,sys; d=json.load(sys.stdin); print(d["counts"].get("RECLAIM",0), d["counts"].get("KEEP_RECENT",0))')"
[ "$FRESH" = "0 3" ] && ok "默认新鲜度护栏: RECLAIM=0、KEEP_RECENT=3（刚建的三棵一律不碰；护栏优先于其余判据）" \
  || no "新鲜度护栏失效: ${FRESH}（应 0 3）"

# ── 正常: 分类（关护栏，验判据本身）──
OUT_JSON="$("$PY" "$TOOL" --repo "$TMP/work" --protect "$TMP/wt-d" --recent-minutes 0 --json 2>/dev/null)"
COUNTS="$("$PY" - "$OUT_JSON" <<'PYEOF'
import json,sys
d=json.loads(sys.argv[1])
c=d["counts"]
print(f'{c.get("RECLAIM",0)} {c.get("KEEP_UNPUSHED",0)} {c.get("KEEP_DIRTY",0)} {c.get("KEEP_PROTECTED",0)}')
print(",".join(sorted(r["path"].split("/")[-1] for r in d["worktrees"] if r["kind"]=="RECLAIM")))
PYEOF
)"
REC_CNT="$(echo "$COUNTS" | head -1 | awk '{print $1}')"
UNP_CNT="$(echo "$COUNTS" | head -1 | awk '{print $2}')"
DRT_CNT="$(echo "$COUNTS" | head -1 | awk '{print $3}')"
PRT_CNT="$(echo "$COUNTS" | head -1 | awk '{print $4}')"
REC_NAMES="$(echo "$COUNTS" | tail -1)"
[ "$REC_CNT" = "1" ] && [ "$REC_NAMES" = "wt-a" ] && ok "RECLAIM=1 且恰为 wt-a（已并入+干净）" || no "RECLAIM 判定错: n=$REC_CNT names=$REC_NAMES"
[ "$UNP_CNT" = "1" ] && ok "KEEP_UNPUSHED=1（wt-b 有未推送提交）" || no "KEEP_UNPUSHED 应为 1，实为 $UNP_CNT"
[ "$DRT_CNT" = "1" ] && ok "KEEP_DIRTY=1（wt-c 有脏文件）" || no "KEEP_DIRTY 应为 1，实为 $DRT_CNT"
[ "$PRT_CNT" = "2" ] && ok "KEEP_PROTECTED=2（主 worktree + --protect wt-d）" || no "KEEP_PROTECTED 应为 2，实为 $PRT_CNT"

# ── 副作用: dry-run 零删除 ──
"$PY" "$TOOL" --repo "$TMP/work" --protect "$TMP/wt-d" --recent-minutes 0 >/dev/null 2>&1
MID="$(git -C "$TMP/work" worktree list | wc -l | tr -d ' ')"
[ "$MID" -eq "$BEFORE" ] && ok "dry-run 零删除（注册表仍 $BEFORE 条）" || no "dry-run 竟有副作用: $BEFORE → $MID"
[ -d "$TMP/wt-a" ] && ok "dry-run 保留 wt-a 目录" || no "dry-run 删了 wt-a"

# ── 正常: --apply 只回收 RECLAIM ──
"$PY" "$TOOL" --repo "$TMP/work" --protect "$TMP/wt-d" --recent-minutes 0 --apply >/dev/null 2>&1
AFTER="$(git -C "$TMP/work" worktree list | wc -l | tr -d ' ')"
REG_LIST="$(git -C "$TMP/work" worktree list --porcelain | grep '^worktree ' | sed 's#.*/##' | sort | tr '\n' ' ')"
[ "$AFTER" -eq 4 ] && ok "--apply 回收 1 棵（5 → 4）" || no "--apply 应 5 → 4，实为 $AFTER"
case "$REG_LIST" in
  *wt-a*) no "wt-a 仍在注册表（${REG_LIST}）" ;;
  *)      ok "wt-a 已不在注册表（${REG_LIST}）" ;;
esac
for d in wt-b wt-c wt-d; do
  case "$REG_LIST" in
    *"$d"*) ok "$d 保留（未被回收）" ;;
    *)      no "$d 被误删" ;;
  esac
done

# ── 无需回收时空跑 → exit 0 ──
"$PY" "$TOOL" --repo "$TMP/work" --protect "$TMP/wt-d" --recent-minutes 0 --apply >/dev/null 2>&1
[ $? -eq 0 ] && ok "已无 RECLAIM 时空跑 → exit 0" || no "空跑应 exit 0"

# ── 降级: 注册表有、目录已删（孤儿）→ 逐项降级，整轮仍 rc=0（2026-10-05 实测教训）──
git -C "$TMP/work" worktree add -q "$TMP/wt-orphan" -b feat/orphan origin/main
rm -rf "$TMP/wt-orphan"
ORPH_JSON="$("$PY" "$TOOL" --repo "$TMP/work" --protect "$TMP/wt-d" --recent-minutes 0 --json 2>/dev/null)"
ORPH_RC=$?
ORPH="$("$PY" - "$ORPH_JSON" <<'PYEOF2'
import json,sys
d=json.loads(sys.argv[1])
print(d["counts"].get("KEEP_ORPHAN",0))
PYEOF2
)"
[ "$ORPH_RC" -eq 0 ] && ok "孤儿注册项不再中断整轮（rc=0）" || no "孤儿应逐项降级，实际 rc=$ORPH_RC"
[ "$ORPH" = "1" ] && ok "KEEP_ORPHAN=1（目录已删项被点名，不判 RECLAIM）" || no "KEEP_ORPHAN 应为 1，实为 ${ORPH}"
git -C "$TMP/work" worktree prune >/dev/null 2>&1

# ── 接线: 工具被本卡文书引用（grep 物理事实，铁律 0-2）──
if grep -rql "reclaim-worktrees.py" "$REPO/.claude/task-briefs" "$REPO/memory/notes" 2>/dev/null; then
  ok "接线: brief/memory 引用了本工具"
else
  no "接线: brief/memory 未引用 reclaim-worktrees.py"
fi

echo "── 汇总: PASS=$PASS FAIL=$FAIL ──"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
