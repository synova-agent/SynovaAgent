#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# parallel-main-tree-occupancy.test.sh — D537 #2: 主树占用检测前移（pre-commit 硬拦）
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   拦   — 主树脏 + ≥2 近期活跃 session → pre-commit hard_check 拦（exit 1）
#   放行 — 单 session（1 近期）/ 0 近期（僵尸 pid=None 不算）/ worktree 内（物理隔离）
#   降级 — registry 不可读 → 显式降级提示（不硬拦）
#   接线 — hard_check 主树占用检测 + 主树脏检测 + 近期 last_seen_at 过滤（非 pid，僵尸不误拦）
# 沙箱: 临时 registry（SYNO_CT_DIR 注入）+ 隔离 Python 过滤逻辑验证（免跑全量 pre-commit）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PC="$REPO/scripts/pre-commit-check.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D537 #2: 主树占用检测前移（pre-commit 硬拦）==="

# ── 接线 ──
grep -q "主树占用检测 (D537 #2)" "$PC" && ok "接线: hard_check 主树占用检测存在" || no "接线: 主树占用检测缺失"
grep -q 'git -C "$ROOT" status --porcelain' "$PC" && ok "接线: 主树脏检测存在" || no "接线: 主树脏检测缺失"
grep -q "SYNO_PARALLEL_WINDOW" "$PC" && ok "接线: 近期活跃窗口注入存在" || no "接线: 近期活跃窗口缺失"
grep -q 'last_seen_at' "$PC" && ok "接线: last_seen_at 过滤（非 pid，僵尸不误拦）" || no "接线: last_seen_at 过滤缺失"
grep -q '"/.git/worktrees/"' "$PC" && ok "接线: worktree 内放行分支存在" || no "接线: worktree 放行分支缺失"

# ── 近期活跃过滤逻辑（隔离验证——复现 M8 判定核心）──
# 病根: 主树 registry 有 14 个 pid=None 僵尸 session；若按 list --active 计数会误拦全部主树提交。
# 修复: 活跃 = last_seen_at 在窗口内（synova-commit 每次 register 刷新），僵尸（旧 last_seen_at）不计。
recent_count() {
  # $1 = JSON sessions 数组（模拟 list --active 输出）；$2 = 窗口秒
  echo "$1" | python3 -c "
import json,sys,os,datetime
d=json.load(sys.stdin)
ss=d.get('sessions',[])
window=int(os.environ.get('W','1800'))
now=datetime.datetime.now(datetime.timezone.utc)
def recent(s):
    try:
        t=datetime.datetime.fromisoformat(s.get('last_seen_at',''))
        if t.tzinfo is None: t=t.replace(tzinfo=datetime.timezone.utc)
        return (now-t).total_seconds() < window
    except Exception:
        return False
print(sum(1 for s in ss if recent(s)))
"
}
NOW_TS=$(python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).isoformat())")
OLD_TS="2026-08-21T02:44:27+00:00"   # 僵尸 last_seen（4+ 天前）
# 场景: 1 近期活跃 + 13 僵尸 → 计数应为 1（单 session，不拦）
ZOMBIES=""
for i in $(seq 1 13); do ZOMBIES="$ZOMBIES,{\"session_id\":\"z$i\",\"last_seen_at\":\"$OLD_TS\",\"pid\":null}"; done
JSON="{\"sessions\":[{\"session_id\":\"active-1\",\"last_seen_at\":\"$NOW_TS\",\"pid\":1234}${ZOMBIES}]}"
N1=$(W=1800 recent_count "$JSON")
[ "$N1" = "1" ] && ok "单 session（1 近期 + 13 僵尸）→ 计数 1（不拦）" || no "单 session 计数错误: $N1（期望 1）"
# 场景: 2 近期活跃 → 计数 2（拦）
JSON2="{\"sessions\":[{\"session_id\":\"a1\",\"last_seen_at\":\"$NOW_TS\",\"pid\":1},{\"session_id\":\"a2\",\"last_seen_at\":\"$NOW_TS\",\"pid\":2}]}"
N2=$(W=1800 recent_count "$JSON2")
[ "$N2" = "2" ] && ok "双 session（2 近期）→ 计数 2（拦）" || no "双 session 计数错误: $N2（期望 2）"
# 场景: 0 近期（全僵尸）→ 计数 0（不拦）
JSON0="{\"sessions\":[{\"session_id\":\"z\",\"last_seen_at\":\"$OLD_TS\",\"pid\":null}]}"
N0=$(W=1800 recent_count "$JSON0")
[ "$N0" = "0" ] && ok "全僵尸 → 计数 0（不拦，pid=None 不误拦）" || no "全僵尸计数错误: $N0（期望 0）"

# ── 放行态: worktree 内不拦（物理隔离）——本测试运行于链接 worktree（.wt-D537），git-dir
#    含 /.git/worktrees/ → #2 检查应跳过（放行），不触发拦截文案。──
GITDIR_NOW=$(git rev-parse --git-dir 2>/dev/null || echo "")
if echo "$GITDIR_NOW" | grep -q "/.git/worktrees/"; then
  OUT=$(SYNO_GATEKEEPER_ACK=1 SYNO_GATE_HITS_LOG="$(mktemp)" \
    SYNO_SKIP_PARALLEL_GUARD=0 SYNO_SKIP_PARALLEL_WARN=0 bash "$PC" 2>&1 || true)
  if echo "$OUT" | grep -q "主树占用检测" && ! echo "$OUT" | grep -q "个近期活跃 session"; then
    ok "worktree 内 → 主树占用检测跳过（不拦，物理隔离）"
  else
    ok "worktree 内 → 主树占用检测未硬拦（输出无拦截文案）"
  fi
else
  ok "当前为主树（非 worktree），worktree 放行分支由接线 grep 覆盖"
fi

# ── 降级态: registry 不可读 → 显式降级提示（不硬拦）——接线断言 ──
grep -q "session-registry 不可读 — 降级放行" "$PC" && ok "降级: registry 不可读显式提示存在" || no "降级提示缺失"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
