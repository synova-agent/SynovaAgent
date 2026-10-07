#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# redeem-task-redeem.test.sh — D576/CT-53 兑换机制诚实化测试
#
# 背景: K3 D572 审计实证 redeem-progress 把任务闭环兑换冒充 record_type=k3 一票翻绿
#       （1-2 假绿）。修复: ①redeem 产出 record_type=task_redeem（走 machine 路径）；
#       ②k3_only 点（desc 含「审计员复核」）禁任务兑换；③calc 存量降级假 k3；
#       ④k3_only 点仅 k3 裁决可 verified。
#
# 覆盖（铁律 48: 正常/降级/边界）:
#   T1 正常兑换 → record_type=task_redeem（非 k3）
#   T2 k3_only 点（1-8 型）→ 跳过不兑换 + skip 提及
#   T3 calc 存量降级: 假 k3（note 含自动兑换特征）→ 加载后 task_redeem → 点非 verified
#   T4 k3_only 点有 task_redeem 证据 → 状态最高 pending_k3（到不了 verified）
#
# 隔离: mktemp 沙箱 + 真实 git 对象（impl commit 校验用真实仓库 HEAD）。
# 用法: bash tests/control-tower/redeem-task-redeem.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
REDEEM="$REPO/scripts/product-lines/redeem-progress.py"
CALC="$REPO/scripts/product-lines/calc-progress.py"

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1" >&2; }

TMP=$(mktemp -d /tmp/redeem-t.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
TODAY=$(date +%Y-%m-%d)
HEAD_SHA=$(git -C "$REPO" rev-parse HEAD)

make_task() { # <dir> <task_id> <points_csv> <status> <verdict>
  local dir="$1" tid="$2" pts="$3" st="$4" vd="$5"
  python3 - "$dir" "$tid" "$pts" "$st" "$vd" <<'PYEOF'
import json, sys
d, tid, pts, st, vd = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
task = {"task_id": tid, "status": st,
        "acceptance_points": pts.split(","),
        "impl": {"commit": "HEAD_PLACEHOLDER"},
        "audit": {"verdict": vd, "report": "docs/synova/audit-reports/2026-08-24-D515.md", "at": "2026-09-04"},
        "updated_at": "2026-09-04"}
task["impl"]["commit"] = __import__("subprocess").run(["git","rev-parse","HEAD"],capture_output=True,text=True).stdout.strip()
import pathlib
p = pathlib.Path(d) / f"{tid}.json"
p.write_text(json.dumps(task, ensure_ascii=False, indent=1), encoding="utf-8")
PYEOF
}

echo "=== D576/CT-53 兑换诚实化测试 ==="

# ── T1: 正常兑换 → task_redeem 类型 ──
mkdir -p "$TMP/t1/task-state" "$TMP/t1/evidence"
make_task "$TMP/t1/task-state" "D990" "7-3,7-4" "impl_done" "PASS"
OUT=$(python3 "$REDEEM" --task-state-dir "$TMP/t1/task-state" --evidence-dir "$TMP/t1/evidence" 2>&1)
RC=$?
if [ "$RC" -eq 0 ] && grep -q "record_type\": \"task_redeem\"" "$TMP/t1/evidence/task-D990.json" 2>/dev/null; then
  pass "T1 正常兑换 → record_type=task_redeem（非 k3 冒充）"
else
  fail "T1 正常兑换应产出 task_redeem（rc=${RC}）"
fi
grep -q "record_type\": \"k3\"" "$TMP/t1/evidence/task-D990.json" 2>/dev/null && fail "T1b 不得再产出 k3 类型" || pass "T1b 无 k3 类型冒充"

# ── T2: k3_only 点（1-8 审计复核）→ 跳过 ──
mkdir -p "$TMP/t2/task-state" "$TMP/t2/evidence"
make_task "$TMP/t2/task-state" "D991" "1-8" "impl_done" "PASS"
OUT=$(python3 "$REDEEM" --task-state-dir "$TMP/t2/task-state" --evidence-dir "$TMP/t2/evidence" 2>&1)
RC=$?
if [ "$RC" -eq 0 ] && [ ! -f "$TMP/t2/evidence/task-D991.json" ] && printf '%s' "$OUT" | grep -q "k3_only"; then
  pass "T2 k3_only 点（1-8）跳过不兑换 + 显式提及"
else
  fail "T2 k3_only 应被跳过（rc=$RC out=$OUT）"
fi

# ── T3: calc 存量降级（假 k3 → task_redeem → 点非 verified）──
mkdir -p "$TMP/t3/evidence"
# 造 mini yaml（1 条线 1 个点，非 k3_only，绑 modules 探针路径）
cat > "$TMP/t3/lines.yaml" <<'YEOF'
lines:
  - id: 1
    name: "测试线"
    weight: 1.0
    modules: ["src/nonexistent-probe-xyz/"]
    acceptance_points:
      - id: "1-1"
        desc: "测试点"
        evidence: ["k3:测试"]
YEOF
# 造假 k3 证据（特征: note 含 自动兑换（redeem-progress.py））
python3 - "$TMP/t3/evidence" <<'PYEOF'
import json, sys, pathlib
d = pathlib.Path(sys.argv[1])
rec = {"schema": 1, "record_type": "k3", "source": "fake", "date": "2026-09-04",
       "note": "任务 D992 自动兑换（redeem-progress.py）：impl abc 在 git + audit 非 FAIL",
       "verdicts": [{"acceptance_point": "1-1", "verdict": "pass", "quote": "x", "quote_ref": "y:1"}]}
(d / "task-D992.json").write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
PYEOF
OUT=$(python3 "$CALC" --yaml "$TMP/t3/lines.yaml" --evidence-dir "$TMP/t3/evidence" --out "$TMP/t3/out.json" 2>&1); RC=$?
ST=$(python3 -c "
import json
d=json.load(open('$TMP/t3/out.json'))
l=[x for x in d['lines'] if x['id']==1][0]
p=[x for x in l['points'] if x['id']=='1-1'][0]
print(p['status'])" 2>/dev/null)
if echo "$OUT" | grep -q "存量自动兑换证据降级" && [ "$ST" != "verified" ]; then
  pass "T3 存量假 k3 降级 task_redeem → 点状态=${ST}（非 verified）"
else
  fail "T3 存量降级未生效（out=$OUT status=${ST}）"
fi

# ── T4: k3_only 点有 task_redeem/demo 证据 → 最高 pending_k3 ──
mkdir -p "$TMP/t4/evidence"
cat > "$TMP/t4/lines.yaml" <<'YEOF'
lines:
  - id: 1
    name: "测试线"
    weight: 1.0
    modules: ["src/nonexistent-probe-xyz/"]
    acceptance_points:
      - id: "1-8"
        desc: "审计员复核某某"
        k3_only: true
        evidence: ["k3:测试"]
YEOF
python3 - "$TMP/t4/evidence" <<'PYEOF'
import json, sys, pathlib
d = pathlib.Path(sys.argv[1])
# 恶意场景: 任务兑换出 task_redeem pass（甚至 founder_demo pass）
rec = {"schema": 1, "record_type": "task_redeem", "source": "fake", "date": "2026-09-04",
       "note": "任务 D993 自动兑换（redeem-progress.py）",
       "verdicts": [{"acceptance_point": "1-8", "verdict": "pass", "quote": "x", "quote_ref": "y:1"}]}
(d / "task-D993.json").write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
rec2 = {"schema": 1, "record_type": "founder_demo", "source": "fake", "date": "2026-09-04",
        "note": "demo",
        "verdicts": [{"acceptance_point": "1-8", "verdict": "pass", "quote": "x", "quote_ref": "y:1"}]}
(d / "demo-D993.json").write_text(json.dumps(rec2, ensure_ascii=False), encoding="utf-8")
PYEOF
python3 "$CALC" --yaml "$TMP/t4/lines.yaml" --evidence-dir "$TMP/t4/evidence" --out "$TMP/t4/out.json" >/dev/null 2>&1
ST=$(python3 -c "
import json
d=json.load(open('$TMP/t4/out.json'))
l=[x for x in d['lines'] if x['id']==1][0]
p=[x for x in l['points'] if x['id']=='1-8'][0]
print(p['status'])" 2>/dev/null)
if [ "$ST" = "pending_k3" ]; then
  pass "T4 k3_only 点有 task_redeem+demo 证据 → 仍 pending_k3（不到 verified）"
else
  fail "T4 k3_only 应封顶 pending_k3（实际 ${ST}）"
fi

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
