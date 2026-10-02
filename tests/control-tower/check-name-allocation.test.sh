#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-name-allocation.test.sh — D940 命名三元组校验器测试
#
# 被测生产脚本: scripts/control-tower/check-name-allocation.sh（D940-T1 新建）
# 契约（与 c1 逐条对齐，2026-09-24）:
#   check-name-allocation.sh [--id D###] [--worktree <名>] [--branch <名>] [--json]
#   rc 三态: 0 = 三者一致且未被占 / 1 = 冲突（号被占 或 三处命名 D# 不一致）
#            / 2 = 校验器自身失败（**不得与 0 混同**）
#   冲突位置标签固定 5 个: task-state / origin-main / remote-branch / local-branch / worktree-name
#   降级: ls-remote 不可达 → stderr 打 `degraded:` 前缀 + 继续按本地判定（绝不静默）
#   --json: {"id":..,"status":"conflict|free|invalid","degraded":bool,"conflicts":[..]}
#
# 覆盖矩阵（铁律 48 三路径 + 接线 + 反向金丝雀）:
#   正常 — 三者一致且未占 → rc=0；--json status=free
#   冲突 — remote-branch（未 fetch 的远端分支）/ task-state / worktree-name 三处各一例 → rc=1 + 点名
#   冲突 — 三处命名 D# 不一致（号本身空闲）→ rc=1（一致性面，与占用面分离）
#   降级 — origin 指向不存在路径 → `degraded:` 可见且仍可用（rc=0）
#   边界 — rc=2 三路径（无输入 / --id 格式非法 / 缺值与未知选项）
#   金丝雀 — 同一夹具只改 id: 占用输入 rc=1 vs 空闲输入 rc=0 → 两者不同才证明校验器真在判
#            （恒 0 或恒 1 的"空转网"在此变红）
#
# 密封性（重要）: 全部用**临时 git 仓 + bare origin**（离线、CI 双平台可跑）。
#   不连真远端、不依赖真仓的 tracking ref —— 真仓当前**有** origin/docs/d942-cto-fixation
#   tracking ref，"未 fetch"这一条件在真仓不可复现（c1 独立实测同结论）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$REPO/scripts/control-tower/check-name-allocation.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "=== D940: 命名三元组校验器（check-name-allocation.sh）==="

# ── 0. 接线（两条缺一不可）──
# ① 被测脚本存在（缺了后面每条都会红，但要点名根因）
if [ -f "$TOOL" ]; then
  ok "接线: $TOOL 存在"
else
  no "接线: $TOOL 不存在（D940-T1 未落地 → 本测试全红属预期，禁放宽）"
fi
# ② 本测试在 ci.yml 密封清单内 —— 沿 check-progress-freshness.test.sh:44 /
#    merge_writeset_gate.test.sh:36 / check-citations.test.sh:36 同款。
# ⚠ E-M5（d937-v 独立自验发现）：此前只断言"文件存在"，**删掉 ci.yml 登记行后本测试仍全绿**
#   （全仓唯一察觉者 check-canary-drift.sh 契约恒 exit 0，且在 CI 里写作 `|| true`）⇒ 非判别性。
#   本条使「删掉 ci.yml 该行」**立即变红** —— 这才是卡面「接线」的实质（CI 不跑 = 摆设）。
grep -q 'check-name-allocation.test.sh' "$REPO/.github/workflows/ci.yml" \
  && ok "接线: 本测试在 ci.yml control-tower-tests 密封清单（删掉该行即红）" \
  || no "接线: 本测试不在 ci.yml 密封清单（CI 不跑 = 摆设，M3 未接线）"

# ── 夹具 A: 本地仓（bare origin 含 docs/d942-cto-fixation；无 tracking ref）──
FA="$TMP/A"; BARE="$FA/origin.git"; WA="$FA/repo"
git init -q --bare "$BARE"
git init -q "$WA"
mkdir -p "$WA/task-state"
cp "$REPO/task-state/TEMPLATE.json" "$WA/task-state/TEMPLATE.json" 2>/dev/null || true
printf '{"task_id":"D941","status":"claimed"}\n' > "$WA/task-state/D941.json"
( cd "$WA" && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init \
    && git remote add origin "$BARE" && git push -q origin HEAD:refs/heads/main )
git -C "$WA" push -q origin HEAD:refs/heads/docs/d942-cto-fixation
# 抹掉 push 顺带建立的 tracking ref → 复现"未 fetch"
git -C "$WA" update-ref -d refs/remotes/origin/docs/d942-cto-fixation 2>/dev/null || true
# worktree 目录名占用信号（分支名不含 D 号 → 信号只在目录名）
git -C "$WA" worktree add -q "$FA/.synova-wt-squad-d99888" -b squad-probe >/dev/null 2>&1

# 夹具前置自校验（构造失败 → 后续断言无意义，必须显式红）
BLIND=$(git -C "$WA" branch -r --format='%(refname:short)' | grep -c 'd942' || true)
SEEN=$(git -C "$WA" ls-remote --heads origin | grep -c 'd942' || true)
if [ "$BLIND" = "0" ] && [ "$SEEN" = "1" ]; then
  ok "夹具前置: branch -r 看不见 d942 ($BLIND)，ls-remote 看得见 ($SEEN)"
else
  no "夹具前置不成立: branch -r=$BLIND 应为 0；ls-remote=$SEEN 应为 1"
fi
WT_OK=$(git -C "$WA" worktree list --porcelain | grep -c '.synova-wt-squad-d99888' || true)
if [ "$WT_OK" = "1" ]; then
  ok "夹具前置: worktree 目录名 .synova-wt-squad-d99888 已登记"
else
  no "夹具前置: worktree 未建（worktree-name 用例无效）"
fi

# ── 夹具 B: origin 指向不存在路径（降级路径物理构造，不吃注入缝）──
FB="$TMP/B"; WB="$FB/repo"
git init -q "$WB"
mkdir -p "$WB/task-state"
printf '{"task_id":"D941","status":"claimed"}\n' > "$WB/task-state/D941.json"
( cd "$WB" && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init \
    && git remote add origin "$FB/nonexistent-origin.git" )

# chk: 在夹具 repo **内部**执行（cwd 必须在此，ls-remote 才解析到夹具的 origin）
chk() { local d="$1"; shift; OUT=$( cd "$d" && SYNO_TASK_STATE_DIR="$d/task-state" bash "$TOOL" "$@" 2>&1 ); RC=$?; }
has() { printf '%s' "$OUT" | grep -qF "$1"; }

echo ""
echo "── 1. 正常: 三者一致且未占 → rc=0（--json status=free）──"
chk "$WA" --id D99999 --worktree .synova-wt-squad-d99999 --branch docs/d99999-probe
[ "$RC" -eq 0 ] && ok "正常输入 rc=0" || no "正常输入应 rc=0，实际 rc=${RC}：$(printf '%s' "$OUT" | sed -n '1,3p' | tr '\n' '|')"
chk "$WA" --json --id D99999 --worktree .synova-wt-squad-d99999 --branch docs/d99999-probe
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qE '"status"[[:space:]]*:[[:space:]]*"free"'; then
  ok "--json 正常: status=free 且 rc=0"
else
  no "--json 正常应 status=free + rc=0，实际 rc=${RC}：$(printf '%s' "$OUT" | sed -n '1,3p' | tr '\n' '|')"
fi

echo ""
echo "── 2. 冲突·remote-branch: 942 只在 bare origin 上（本地未 fetch）→ rc=1 + 点名 ──"
chk "$WA" --id D942 --worktree .synova-wt-squad-d942 --branch docs/d942-cto-fixation
[ "$RC" -eq 1 ] && ok "远端分支占用 rc=1" || no "应 rc=1，实际 rc=$RC"
has "docs/d942-cto-fixation" && ok "点名冲突位置原文 docs/d942-cto-fixation" || no "未点名冲突位置: $(printf '%s' "$OUT" | sed -n '1,4p' | tr '\n' '|')"
chk "$WA" --json --id D942 --worktree .synova-wt-squad-d942 --branch docs/d942-cto-fixation
if [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -qE '"status"[[:space:]]*:[[:space:]]*"conflict"' \
   && has "remote-branch:docs/d942-cto-fixation"; then
  ok "--json 冲突: status=conflict + conflicts 含 remote-branch:docs/d942-cto-fixation"
else
  no "--json 冲突形态不符，rc=${RC}：$(printf '%s' "$OUT" | sed -n '1,3p' | tr '\n' '|')"
fi

echo ""
echo "── 3. 冲突·task-state: 941 已登记 → rc=1 + 点名 task-state ──"
chk "$WA" --id D941 --worktree .synova-wt-squad-d941 --branch docs/d941-probe
[ "$RC" -eq 1 ] && ok "task-state 占用 rc=1" || no "应 rc=1，实际 rc=$RC"
has "task-state" && ok "点名冲突位置标签 task-state" || no "未点名 task-state: $(printf '%s' "$OUT" | sed -n '1,4p' | tr '\n' '|')"

echo ""
echo "── 4. 冲突·worktree-name: 目录名 .synova-wt-squad-d99888 已登记 → rc=1 + 点名 ──"
chk "$WA" --id D99888 --worktree .synova-wt-squad-d99888 --branch docs/d99888-probe
[ "$RC" -eq 1 ] && ok "worktree 目录名占用 rc=1" || no "应 rc=1，实际 rc=$RC"
has "worktree-name" && ok "点名冲突位置标签 worktree-name" || no "未点名 worktree-name: $(printf '%s' "$OUT" | sed -n '1,4p' | tr '\n' '|')"

echo ""
echo "── 5. 冲突·不一致: 三处 D# 互不相同（号本身全空闲）→ rc=1（一致性面，非占用面）──"
chk "$WA" --id D99999 --worktree .synova-wt-squad-d99998 --branch docs/d99998-probe
[ "$RC" -eq 1 ] && ok "三处 D# 不一致 rc=1（号空闲也拦）" || no "应 rc=1，实际 rc=$RC"

echo ""
echo "── 6. 边界·rc=2 三路径（校验器自身失败，不得与 0 混同）──"
chk "$WA"
[ "$RC" -eq 2 ] && ok "无任何有效输入 → rc=2" || no "无输入应 rc=2，实际 rc=$RC"
chk "$WA" --id NOTANID --worktree .synova-wt-squad-x --branch docs/x
[ "$RC" -eq 2 ] && ok "--id 格式非法（NOTANID）→ rc=2" || no "--id 非法应 rc=2，实际 rc=$RC"
chk "$WA" --id
[ "$RC" -eq 2 ] && ok "--id 缺值 → rc=2" || no "--id 缺值应 rc=2，实际 rc=$RC"
chk "$WA" --bogus D99999
[ "$RC" -eq 2 ] && ok "未知选项 --bogus → rc=2" || no "未知选项应 rc=2，实际 rc=$RC"

echo ""
echo "── 7. 降级: origin 不可达 → degraded: 可见 + 仍可用（绝不静默放行）──"
chk "$WB" --id D99999 --worktree .synova-wt-squad-d99999 --branch docs/d99999-probe
has "degraded:" && ok "降级显式: 输出含 degraded: 前缀" || no "缺 degraded: 前缀（静默降级）: $(printf '%s' "$OUT" | sed -n '1,4p' | tr '\n' '|')"
[ "$RC" -eq 0 ] && ok "降级后仍可用（rc=0，按本地占用判定）" || no "降级后应仍可用 rc=0，实际 rc=$RC"
RC_DEG=$RC

echo ""
echo "── 8. 反向金丝雀: 同一夹具只改 id → 占用必须 rc=1、空闲必须 rc=0 ──"
# 金丝雀逻辑: 若校验器是空转网（恒返回同一值），下面两值必相等 → 本节变红。
chk "$WA" --id D942 --worktree .synova-wt-squad-d942 --branch docs/d942-cto-fixation; RC_HIT=$RC
chk "$WA" --id D99999 --worktree .synova-wt-squad-d99999 --branch docs/d99999-probe; RC_MISS=$RC
if [ "$RC_HIT" = "1" ] && [ "$RC_MISS" = "0" ]; then
  ok "金丝雀: 占用输入 rc=1 / 空闲输入 rc=0（校验器非空转网）"
else
  no "金丝雀失败: 占用 rc=${RC_HIT}（应 1）、空闲 rc=${RC_MISS}（应 0）—— 校验器恒返回同一值即空转"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
