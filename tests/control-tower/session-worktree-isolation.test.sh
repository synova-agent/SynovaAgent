#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# session-worktree-isolation.test.sh — D539: 会话 worktree 隔离（主仓只读化 → 强制 worktree → 会话 brief）
#
# 覆盖矩阵（铁律 47/48 三路径 + 物理断言 + 接线）:
#   session-id 解析      — 参数优先 / env 回退 / branch 回退 / 全不可解析→回退全局
#   废除全局             — session-id 解析成功 → 全局 current-brief 被删，仅 <sid> 存在
#   主树阻断             — 主树（gitdir 不含 worktrees/）→ exit 1 + stderr 含 worktree-manager.py create（接线）
#   worktree 放行        — linked worktree 内 → exit 0（不阻断）
#   SYNO_ALLOW_MAIN 豁免 — 主树 + SYNO_ALLOW_MAIN=1 → exit 0 + degraded-events.log（铁律 11 不静默）
#   attach 不 clobber    — current-brief.<sid> 已存在 → attach 不覆盖它（CT-42 写方一致性）
#   物理隔离断言         — 双 worktree，A commit → B 的 index 哈希 + current-brief.B 零变化（sha256 指纹，非声明）
#
# 沙箱: mktemp 仓库 + 复制 scripts/（M13: git 身份 -c 一次性参数，零真实目录零网络）。
# 环境坑: DSH_SESSION_ID 被宿主注入 → branch/全不可解析用例必须 env -u DSH_SESSION_ID。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TS="$REPO/scripts/workflow/task-start.sh"
WM="$REPO/scripts/control-tower/worktree-manager.py"
ATTACH="$REPO/scripts/control-tower/attach.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D539: 会话 worktree 隔离 ==="

# ── helper: 建沙箱仓库（复制 scripts/ + git init + commit + briefs 目录）──
# M13: git 身份用仓库级 config（非全局），零持久污染
build_repo() {
  local dir="$1"
  mkdir -p "$dir"
  cp -R "$REPO/scripts" "$dir/scripts"
  git -C "$dir" init -q
  git -C "$dir" config user.email "t@t"
  git -C "$dir" config user.name "t"
  git -C "$dir" add -A >/dev/null 2>&1
  git -C "$dir" commit -q -m base >/dev/null 2>&1
  mkdir -p "$dir/.claude/task-briefs"
}

# ── 接线: 脚本生产调用点（S-3 测试调用不计）──
grep -q "_resolve_session_id" "$TS" && grep -q "_assert_dev_worktree" "$TS" \
  && ok "接线: task-start 含 _resolve_session_id/_assert_dev_worktree" || no "接线: 缺 D539 函数"
grep -q "worktree-manager.py create" "$TS" \
  && ok "接线: task-start 引用 worktree-manager.py create（生产调用点）" || no "接线: worktree-manager.py create 未引用"
grep -q 'current-brief\.\$SESSION_ID' "$TS" \
  && ok "接线: task-start 写 current-brief.\$SESSION_ID（会话专属）" || no "接线: 会话专属写缺失"
grep -q 'rm -f "$PROJECT_ROOT/.claude/current-brief"' "$TS" \
  && ok "接线: task-start 废除全局 current-brief" || no "接线: 全局未废除"

# ── 1. session-id 参数优先 → current-brief.D539 ──
SB1="$TMPD/sb1"; build_repo "$SB1"
(cd "$SB1" && env -u DSH_SESSION_ID SYNO_ALLOW_MAIN=1 SYNO_SKIP_PARALLEL_GUARD=1 \
    bash "$SB1/scripts/workflow/task-start.sh" "参数优先" --session-id D539 >/dev/null 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "参数优先: task-start exit 0" || no "参数优先: exit=$rc"
[ -f "$SB1/.claude/current-brief.D539" ] && ok "参数优先: current-brief.D539 已写" || no "参数优先: current-brief.D539 缺失"
[ ! -f "$SB1/.claude/current-brief" ] && ok "参数优先: 全局 current-brief 已删除（废除全局）" || no "参数优先: 全局 current-brief 仍存在"
grep -q '2026-08-27' "$SB1/.claude/current-brief.D539" && ok "参数优先: 含最新 brief 名" || no "参数优先: brief 名异常"

# ── 2. session-id env 回退（DSH_SESSION_ID）→ current-brief.D539env ──
SB2="$TMPD/sb2"; build_repo "$SB2"
(cd "$SB2" && env -u DSH_SESSION_ID SYNO_ALLOW_MAIN=1 SYNO_SKIP_PARALLEL_GUARD=1 \
    DSH_SESSION_ID=D539env bash "$SB2/scripts/workflow/task-start.sh" "env 回退" >/dev/null 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "env 回退: exit 0" || no "env 回退: exit=$rc"
[ -f "$SB2/.claude/current-brief.D539env" ] && ok "env 回退: current-brief.D539env 已写" || no "env 回退: current-brief.D539env 缺失"
[ ! -f "$SB2/.claude/current-brief" ] && ok "env 回退: 全局已删除" || no "env 回退: 全局仍存在"

# ── 3. session-id branch 回退（session/D539 → D539）──
SB3="$TMPD/sb3"; build_repo "$SB3"
git -C "$SB3" checkout -q -b session/D539
(cd "$SB3" && env -u DSH_SESSION_ID SYNO_ALLOW_MAIN=1 SYNO_SKIP_PARALLEL_GUARD=1 \
    bash "$SB3/scripts/workflow/task-start.sh" "branch 回退" >/dev/null 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "branch 回退: exit 0" || no "branch 回退: exit=$rc"
[ -f "$SB3/.claude/current-brief.D539" ] && ok "branch 回退: current-brief.D539 已写（branch basename）" || no "branch 回退: current-brief.D539 缺失"
[ ! -f "$SB3/.claude/current-brief" ] && ok "branch 回退: 全局已删除" || no "branch 回退: 全局仍存在"

# ── 4. session-id 全不可解析（detached HEAD + 无 flag/env/TASK_ID）→ 回退全局 ──
SB4="$TMPD/sb4"; build_repo "$SB4"
git -C "$SB4" checkout -q --detach HEAD
(cd "$SB4" && env -u DSH_SESSION_ID -u TASK_ID SYNO_ALLOW_MAIN=1 SYNO_SKIP_PARALLEL_GUARD=1 \
    bash "$SB4/scripts/workflow/task-start.sh" "全不可解析" >/dev/null 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "全不可解析: exit 0" || no "全不可解析: exit=$rc"
[ -f "$SB4/.claude/current-brief" ] && ok "全不可解析: 回退写全局 current-brief" || no "全不可解析: 全局未写"
[ -z "$(ls "$SB4/.claude"/current-brief.* 2>/dev/null)" ] && ok "全不可解析: 无会话专属文件（legacy）" || no "全不可解析: 意外出现 .<sid> 文件"

# ── 5. 主树阻断（非豁免）→ exit 1 + stderr 含 worktree-manager.py create ──
SB5="$TMPD/sb5"; build_repo "$SB5"
OUT5=$(cd "$SB5" && env -u DSH_SESSION_ID bash "$SB5/scripts/workflow/task-start.sh" "主树任务" 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "主树阻断: 主工作区 task-start exit 1" || no "主树阻断: exit=$rc（应为 1）"
echo "$OUT5" | grep -q "worktree-manager.py create" && ok "主树阻断: stderr 含 worktree-manager.py create（接线引导）" || no "主树阻断: 缺 worktree 引导"
echo "$OUT5" | grep -q "主工作区只读" && ok "主树阻断: stderr 含只读提示" || no "主树阻断: 缺只读提示"

# ── 6. worktree 放行（linked worktree 内跑 task-start）→ exit 0 ──
SB6="$TMPD/sb6"; build_repo "$SB6"
git -C "$SB6" worktree add -q "$TMPD/wt6" -b session/B6
(cd "$TMPD/wt6" && env -u DSH_SESSION_ID SYNO_SKIP_PARALLEL_GUARD=1 \
    bash "$TMPD/wt6/scripts/workflow/task-start.sh" "worktree 任务" >/dev/null 2>&1); rc6=$?
[ "$rc6" -eq 0 ] && ok "worktree 放行: linked worktree 内 exit 0" || no "worktree 放行: exit=$rc6（应为 0）"
[ -f "$TMPD/wt6/.claude/current-brief.B6" ] && ok "worktree 放行: current-brief.B6 已写" || no "worktree 放行: 会话专属写缺失"

# ── 7. SYNO_ALLOW_MAIN 豁免 → exit 0 + degraded-events.log（铁律 11 不静默）──
SB7="$TMPD/sb7"; build_repo "$SB7"
SYNO_CT="$TMPD/ct7"; rm -rf "$SYNO_CT"; mkdir -p "$SYNO_CT"
(cd "$SB7" && env -u DSH_SESSION_ID SYNO_CT_DIR="$SYNO_CT" SYNO_ALLOW_MAIN=1 SYNO_SKIP_PARALLEL_GUARD=1 \
    bash "$SB7/scripts/workflow/task-start.sh" "豁免任务" --session-id D539 >/dev/null 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "豁免: SYNO_ALLOW_MAIN=1 exit 0" || no "豁免: exit=$rc"
grep -q "main-exempt" "$SYNO_CT/logs/degraded-events.log" 2>/dev/null \
  && ok "豁免: degraded-events.log 记录 main-exempt（铁律 11 不静默）" || no "豁免: degraded-events.log 未记录豁免"

# ── 8. 物理隔离断言（双 worktree，A commit → B 的 index/current-brief.B 零变化）──
SB8="$TMPD/sb8"; mkdir -p "$SB8"; git -C "$SB8" init -q
git -C "$SB8" config user.email "t@t"; git -C "$SB8" config user.name "t"
git -C "$SB8" commit -q --allow-empty -m base
git -C "$SB8" worktree add -q "$TMPD/wt-b8" -b session/B8
git -C "$SB8" worktree add -q "$TMPD/wt-a8" -b session/A8
mkdir -p "$SB8/.claude"; printf 'B8-brief.md\n' > "$SB8/.claude/current-brief.B8"
B_INDEX8="$(sha256sum "$SB8/.git/worktrees/wt-b8/index" 2>/dev/null | awk '{print $1}')"  # swallow-ok: worktree index 缺失/读失败 → 输出空, 由下方非空断言拒绝（不假绿）
B_CB8="$(cat "$SB8/.claude/current-brief.B8" 2>/dev/null || echo none)"  # swallow-ok: current-brief.B8 缺失 → none, 由下方比对暴露
git -C "$TMPD/wt-a8" commit -q --allow-empty -m "A work"
B_INDEX8_2="$(sha256sum "$SB8/.git/worktrees/wt-b8/index" 2>/dev/null | awk '{print $1}')"  # swallow-ok: 同上方——非空断言拒绝缺失
B_CB8_2="$(cat "$SB8/.claude/current-brief.B8" 2>/dev/null || echo none)"  # swallow-ok: 同上方
[ -n "$B_INDEX8" ] && [ "$B_INDEX8" = "$B_INDEX8_2" ] && ok "物理隔离: B 的 index sha256 零变化（A commit 未污染 B）" || no "物理隔离: B index 被改/缺失"
[ "$B_CB8" = "$B_CB8_2" ] && ok "物理隔离: B 的 current-brief.B8 零变化" || no "物理隔离: B current-brief 被改"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
