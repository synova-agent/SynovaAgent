#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# task-state-retention.test.sh — D1150 保留策略 + 索引生成器测试（铁律 48: 正常/降级/边界）
#
# 覆盖矩阵:
#   正常 — 终态+超期(>30天) → ARCHIVE；终态+窗口内 → KEEP；非终态无论多老 → KEEP
#   副作用 — dry-run 零移动；--apply 只移动判 ARCHIVE 的件（git mv，可回滚）
#   降级 — 未跟踪件按 mtime 判 + os.replace 移动 → 显式 `degraded:` 留痕
#   冲突 — 归档目标已存在 → exit 1 且**整批不动**（绝不覆盖同名件）
#   索引 — INDEX.md 覆盖自检（行数 == 顶层 + archive 件数）；字面 90 天口径留证（ARCHIVE=0）
#   边界 — 负 --days → exit 2；根不存在 → exit 2
#
# 沙箱说明: 夹具建在**本工作树内**（$REPO/.tmp-tsret-test-$$），不写系统临时区。
# 日期确定性: 全部经由 SYNO_TODAY=2026-10-05 注入「今天」+ GIT_*_DATE 造提交日期。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$REPO/scripts/control-tower/task-state-retention.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

PY=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1; then PY="$_c"; break; fi
done
[ -n "$PY" ] || { echo "❌ 无可用 python（fail-closed）"; exit 2; }

echo "=== task-state-retention 测试 ==="
export SYNO_TODAY=2026-10-05

# ── 边界: 负天数 / 不存在的根 → exit 2 ──
"$PY" "$TOOL" expire --days -1 >/dev/null 2>&1
[ $? -eq 2 ] && ok "负 --days → exit 2" || no "负 --days 应 exit 2"
"$PY" "$TOOL" expire --root /nonexistent-d1150 >/dev/null 2>&1
[ $? -eq 2 ] && ok "不存在的根 → exit 2（fail-closed）" || no "不存在根应 exit 2"

# ── 夹具: mini 仓 + task-state 5 件 ──
TMP="$REPO/.tmp-tsret-test-$$"
trap 'rm -rf "$TMP"' EXIT
git init -q -b main "$TMP" >/dev/null 2>&1
git -C "$TMP" config user.email t@t.local
git -C "$TMP" config user.name t
mkdir -p "$TMP/task-state"

OLD_ENV=(env GIT_AUTHOR_DATE=2026-08-01T00:00:00 GIT_COMMITTER_DATE=2026-08-01T00:00:00)
NEW_ENV=(env GIT_AUTHOR_DATE=2026-10-04T00:00:00 GIT_COMMITTER_DATE=2026-10-04T00:00:00)

# D900 终态 audited + 旧提交（>30 天）→ 期望 ARCHIVE
printf '{"id":"D900","title":"终态超期件","status":"audited"}\n' > "$TMP/task-state/D900.json"
# D901 非终态 in_progress + 旧提交 → 期望 KEEP（活跃件不动）
printf '{"id":"D901","title":"在制件","status":"in_progress"}\n' > "$TMP/task-state/D901.json"
# D904 终态 closed + 旧提交（用于冲突用例）→ 期望 ARCHIVE
printf '{"id":"D904","title":"冲突用例件","status":"closed"}\n' > "$TMP/task-state/D904.json"
git -C "$TMP" add -A >/dev/null
"${OLD_ENV[@]}" git -C "$TMP" commit -qm "old cards"
# D902 终态 audited + 新提交（窗口内）→ 期望 KEEP
printf '{"id":"D902","title":"终态窗口内","status":"audited"}\n' > "$TMP/task-state/D902.json"
git -C "$TMP" add -A >/dev/null
"${NEW_ENV[@]}" git -C "$TMP" commit -qm "recent card"
# D903 未跟踪 + 终态 closed + mtime=今天 → 期望 KEEP（年龄 0）
printf '{"id":"D903","title":"未跟踪新件","status":"closed"}\n' > "$TMP/task-state/D903.json"
# D905 未跟踪 + 终态 closed + mtime=旧 → 期望 ARCHIVE（走 degraded 分支）
printf '{"id":"D905","title":"未跟踪超期件","status":"closed"}\n' > "$TMP/task-state/D905.json"
touch -t 202608010000 "$TMP/task-state/D905.json"

# ── 正常: dry-run 判定 ──
DRY="$("$PY" "$TOOL" expire --root "$TMP" --days 90 --terminal-days 30 --json 2>/dev/null)"
ARCH="$("$PY" - "$DRY" <<'PYEOF'
import json,sys
d=json.loads(sys.argv[1])
import os
print(",".join(sorted(os.path.basename(x).replace(".json","") for x in d["archive"])))  # 平台无关（D1150-WIN1）
print(len(d["keep"]))
PYEOF
)"
[ "$(echo "$ARCH" | head -1)" = "D900,D904,D905" ] && ok "dry-run ARCHIVE = D900,D904,D905（终态且超期）" \
  || no "dry-run ARCHIVE 应为 D900,D904,D905，实为 $(echo "$ARCH" | head -1)"
N_TOP="$(ls "$TMP/task-state"/*.json | wc -l | tr -d ' ')"
[ "$N_TOP" -eq 6 ] && [ ! -d "$TMP/task-state/archive" ] \
  && ok "dry-run 零副作用（顶层仍 6 件，archive/ 未创建）" \
  || no "dry-run 竟有副作用（顶层 ${N_TOP}）"

# ── 字面 90 天口径留证（D1150 偏差说明的证据）──
LIT="$("$PY" "$TOOL" expire --root "$TMP" --days 90 --no-terminal-archive --json 2>/dev/null \
  | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin)["archive"]))')"
[ "$LIT" = "0" ] && ok "字面 90 天口径 → ARCHIVE=0（本仓同类实测，判据②「下降」按字面恒 0 的证据）" \
  || no "字面口径应为 0，实为 $LIT"

# ── 冲突: 归档目标已存在 → exit 1 且整批不动 ──
mkdir -p "$TMP/task-state/archive"
printf '{}\n' > "$TMP/task-state/archive/D904.json"
"$PY" "$TOOL" expire --root "$TMP" --days 90 --terminal-days 30 --apply >/dev/null 2>&1
RC=$?
[ "$RC" -eq 1 ] && ok "归档目标冲突 → exit 1" || no "冲突应 exit 1，实为 $RC"
[ -f "$TMP/task-state/D900.json" ] && ok "冲突时整批不动（D900 仍在顶层，绝不覆盖）" || no "冲突时竟发生了移动"
rm -f "$TMP/task-state/archive/D904.json"

# ── 正常: --apply ──
"$PY" "$TOOL" expire --root "$TMP" --days 90 --terminal-days 30 --apply >/dev/null 2>"$TMP/err.txt"
RC=$?
[ "$RC" -eq 0 ] && ok "--apply → exit 0" || no "--apply 应 exit 0，实为 $RC"
for d in D900 D904 D905; do
  [ -f "$TMP/task-state/archive/$d.json" ] && ok "$d 已归档（archive/$d.json）" || no "$d 未归档"
done
for d in D901 D902 D903; do
  [ -f "$TMP/task-state/$d.json" ] && ok "$d 保留在顶层" || no "$d 被误归档"
done
grep -q "degraded:" "$TMP/err.txt" && ok "未跟踪件移动 → degraded 显式留痕" || no "未跟踪件移动缺少 degraded 留痕"
git -C "$TMP" ls-files --error-unmatch task-state/archive/D900.json >/dev/null 2>&1 \
  && ok "归档走 git mv（D900 有 git 历史，可回滚）" || no "D900 未进入 git 索引"

# ── 索引: 覆盖自检 ──
IDX="$("$PY" "$TOOL" index --root "$TMP" --apply --json 2>/dev/null)"
COV="$("$PY" - "$IDX" <<'PYEOF'
import json,sys
d=json.loads(sys.argv[1])
print(f'{d["retained"]} {d["archived"]} {d["total"]} {d["covered_rows"]} {d["coverage_ok"]}')
PYEOF
)"
[ "$COV" = "3 3 6 6 True" ] && ok "INDEX 覆盖自检: 保留 3 + 归档 3 = 6，表行 6，coverage_ok=True" \
  || no "INDEX 覆盖异常: $COV"
[ -f "$TMP/task-state/INDEX.md" ] && ok "INDEX.md 已落盘" || no "INDEX.md 未生成"
grep -q "D903" "$TMP/task-state/INDEX.md" && ok "INDEX.md 含未跟踪件 D903（不漏件）" || no "INDEX.md 漏 D903"

# ── 接线: 工具被本卡文书引用（grep 物理事实，铁律 0-2）──
if grep -rql "task-state-retention.py" "$REPO/.claude/task-briefs" "$REPO/memory/notes" 2>/dev/null; then
  ok "接线: brief/memory 引用了本工具"
else
  no "接线: brief/memory 未引用 task-state-retention.py"
fi

echo "── 汇总: PASS=$PASS FAIL=$FAIL ──"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
