#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-contract.test.sh — DOC-CONTRACT 三闸执行体测试（铁律 48: 非空壳）
# 覆盖矩阵（正常 / 阻断 / 边界 / 降级 / 接线）:
#   A 白名单命中            → 0
#   B 阻断清单命中(md)      → 1   （D1193 修复点①回归: 首版这里判 pass）
#   C 阻断清单命中(html)    → 1   （D1193 修复点②回归: 首版 HTML 无门）
#   D 过渡放行(task-briefs) → 0 + 计数（不静默）
#   E 阻断优先于白名单      → 1   （docs/plans 同时命中 docs/** 与阻断清单）
#   F 契约块缺失(degraded)  → 2   （fail-closed，不与通过混同）
#   G 逃生舱 ACK=1          → 0 + 落 degraded-events.log
#   H --staged 真实 git 沙箱 → 1（新增件）+ 0（修改件不返工）
#   I 生产接线              → pre-commit 调用点存在且**早于** CT-34 纯文档早退
# 运行: bash tests/control-tower/check-doc-contract.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
IMPL="$REPO/scripts/control-tower/check-doc-contract.sh"
PRE="$REPO/scripts/pre-commit-check.sh"
PASS=0; FAIL=0

t() { # $1=用例名 $2=期望 $3=实际
  if [ "$2" = "$3" ]; then echo "  OK   $1 (=$3)"; PASS=$((PASS+1)); else echo "  FAIL $1 (期望 $2 实际 $3)"; FAIL=$((FAIL+1)); fi
}

FIX=$(mktemp -d)
FIX_EMPTY=$(mktemp -d)
trap 'rm -rf "$FIX" "$FIX_EMPTY"' EXIT
mkdir -p "$FIX/docs/synova"
cp "$REPO/docs/synova/DOC-CONTRACT.md" "$FIX/docs/synova/DOC-CONTRACT.md"

run() { bash "$IMPL" --repo-root "$FIX" "$@" >"$FIX/out.txt" 2>&1; echo $?; }

# A 白名单命中
t "A 白名单命中→0" 0 "$(run --files docs/research/ok.md app/x.html skills/a/SKILL.md)"
# B 阻断清单命中（md）
t "B coordination 阻断→1" 1 "$(run --files docs/synova/coordination/x.md)"
# C 阻断清单命中（html）—— D1193 修复点②
t "C coordination html 阻断→1" 1 "$(run --files docs/synova/coordination/x.html)"
# D 过渡放行 + 计数
t "D task-briefs 过渡放行→0" 0 "$(run --files .claude/task-briefs/a.md)"
grep -q '\.claude/task-briefs' "$FIX/out.txt" && D_HIT=yes || D_HIT=no
t "D 过渡命中可见(不静默)" yes "$D_HIT"
# E 阻断优先于白名单（D1193 修复点①）
t "E docs/plans 仍阻断→1" 1 "$(run --files docs/plans/x.md)"
# F degraded（契约不可读 → 2，fail-closed）
t "F 契约缺失→2" 2 "$(bash "$IMPL" --repo-root "$FIX_EMPTY" --files docs/x.md >/dev/null 2>&1; echo $?)"
# G 逃生舱（显式降级 + 落盘）
t "G ACK=1 放行→0" 0 "$(SYNO_DOC_CONTRACT_ACK=1 SYNO_DOC_CONTRACT_ACK_REASON=test run --files docs/synova/coordination/x.md)"
[ -f "$FIX/.codex/control-tower/logs/degraded-events.log" ] && G_LOG=yes || G_LOG=no
t "G 逃生舱落盘" yes "$G_LOG"
# H/J 真实 git 沙箱: --staged 只判新增；--base = CI 路径
H=$(mktemp -d)
mkdir -p "$H/docs/synova" "$H/docs/synova/coordination"
cp "$REPO/docs/synova/DOC-CONTRACT.md" "$H/docs/synova/DOC-CONTRACT.md"
printf 'old\n' > "$H/docs/synova/coordination/old.md"
( cd "$H" && git init -q . && git add -A && git -c user.email=t@t -c user.name=t commit -qm init )
BASE_SHA=$( cd "$H" && git rev-parse HEAD )
printf 'new\n' > "$H/docs/synova/coordination/new.md"
( cd "$H" && git add docs/synova/coordination/new.md )
t "H --staged 新增违规件→1" 1 "$(bash "$IMPL" --repo-root "$H" --staged >/dev/null 2>&1; echo $?)"
( cd "$H" && git -c user.email=t@t -c user.name=t commit -qm addnew >/dev/null 2>&1 )
printf 'changed\n' >> "$H/docs/synova/coordination/old.md"
( cd "$H" && git add docs/synova/coordination/old.md )
t "H --staged 只判新增(改存量件→0)" 0 "$(bash "$IMPL" --repo-root "$H" --staged >/dev/null 2>&1; echo $?)"
t "J --base (CI 路径) 捕获新增违规→1" 1 "$(bash "$IMPL" --repo-root "$H" --base "$BASE_SHA" >/dev/null 2>&1; echo $?)"
printf 'ok\n' > "$H/docs/synova/research.md"
( cd "$H" && git add docs/synova/research.md && git -c user.email=t@t -c user.name=t commit -qm allowed >/dev/null 2>&1 )
t "J --base 只报违规件(白名单件不计)→1" 1 "$(bash "$IMPL" --repo-root "$H" --base "$BASE_SHA" >/dev/null 2>&1; echo $?)"
rm -rf "$H"
# I 生产接线（铁律 0-2 WIRE CHECK）: 调用点存在且早于 CT-34 早退
WIRE_LINE=$(grep -n 'bash "$ROOT/scripts/control-tower/check-doc-contract.sh"' "$PRE" | head -1 | cut -d: -f1)
EARLY_LINE=$(grep -n 'CT-34 纯文档提交: 仅 Secrets 扫描' "$PRE" | head -1 | cut -d: -f1)
[ -n "$WIRE_LINE" ] && t "I 接线存在" yes yes || t "I 接线存在" yes no
[ -n "$EARLY_LINE" ] && [ -n "$WIRE_LINE" ] && [ "$WIRE_LINE" -lt "$EARLY_LINE" ] && I_ORDER=yes || I_ORDER=no
t "I 接线早于纯文档早退(否则永不点火)" yes "$I_ORDER"
CALLS=$(grep -c 'check-doc-contract.sh' "$PRE")
[ "${CALLS:-0}" -ge 1 ] && t "I CI/本地共用同一执行体" yes yes || t "I CI/本地共用同一执行体" yes no

echo ""
echo "check-doc-contract.test.sh: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0