#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-bypass-log.beforeafter.sh — D1157 P0 假绿修复的 **改坏即红** 证据生成器
#
# 用途（CTO 硬约束 ①「改坏即红」夹具 / ③「修复前后两段输出」）:
#   把同一个夹具账本分别喂给**修复前**与**修复后**的 check-bypass-log.sh，
#   自证「修复前必绿（假绿成立）、修复后必红（已堵）」。
#
# 用法:
#   bash tests/control-tower/check-bypass-log.beforeafter.sh <gate-script-path>
#   默认 <gate-script-path> = 本仓 scripts/control-tower/check-bypass-log.sh（= 修复后）
#   复现修复前输出（任取其一）:
#     git show origin/main:scripts/control-tower/check-bypass-log.sh > /tmp/prefix/check-bypass-log.sh
#     bash tests/control-tower/check-bypass-log.beforeafter.sh /tmp/prefix/check-bypass-log.sh
#
# 夹具（最小可判）:
#   · 沙箱 repo: main 上 1 个 seed 提交 → 建 origin/main tracking ref → 切 feat/p0 → 1 个新提交
#   · 账本 = `detected-bypass head-mismatch marker=<零号> parent=<该提交>` —— **只有 parent=，无该提交自身记录**
#   · feat/p0 的远端 ref 不存在 ⇒ D1152「他机已过闸」过滤关闭 ⇒ 该提交必进待记录集（不靠运气）
#   · 修复前: 无锚 `grep -q "$h"` 命中 parent= ⇒ exit 0（**假绿**）
#   · 修复后: 只认 COMMITTED 记录行的 HASH= 字段 ⇒ exit 1（**拦住**）
#
# 契约（铁律 47）:
#   @input  — $1 = 被测门禁脚本路径（默认本仓）
#   @output — 夹具构造过程 + 被测门禁原始 stdout/stderr + `GATE_EXIT=<n>` + `VERDICT=<fake-green|blocked|unexpected>`
#   @exit   — 0 = 夹具跑完（不论被测门禁判绿判红）；3 = **夹具自身失败**（不是被测缺陷，不产生指控）
#   @degraded — 沙箱不可用（git init/clone/commit 失败）→ 显式打印 fixture 失败并 exit 3，绝不静默
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="${1:-$REPO/scripts/control-tower/check-bypass-log.sh}"

if [ ! -f "$GATE" ]; then
  echo "❌ fixture: 被测门禁不存在: $GATE" >&2; exit 3
fi

TMPD="$(mktemp -d "${TMPDIR:-/tmp}/d1157-ba.XXXXXX")"
trap 'rm -rf "$TMPD"' EXIT
mkdir -p "$TMPD/empty-hooks"
S="$TMPD/sandbox"
_fix_fail() { echo "❌ fixture 自身失败: $1（非被测门禁缺陷）" >&2; exit 3; }

git init -q -b main "$S" >/dev/null 2>&1 || _fix_fail "git init"
git -C "$S" config user.name d1157-fixture
git -C "$S" config user.email d1157@fixture
git -C "$S" config core.hooksPath "$TMPD/empty-hooks"
echo seed > "$S/seed.txt"
git -C "$S" add -A >/dev/null 2>&1 && git -C "$S" commit -qm seed >/dev/null 2>&1 || _fix_fail "seed 提交"
git -C "$S" update-ref refs/remotes/origin/main HEAD     # BASE=origin/main 可解析
git -C "$S" checkout -q -b feat/p0 || _fix_fail "切分支"
echo payload > "$S/payload.txt"
git -C "$S" add -A >/dev/null 2>&1 && git -C "$S" commit -qm "feat: 待记录提交（无自身记录）" >/dev/null 2>&1 || _fix_fail "夹具提交"
SHA="$(git -C "$S" rev-parse HEAD)"
SHA8="${SHA:0:8}"
ZERO40="0000000000000000000000000000000000000000"

mkdir -p "$S/.claude"
LEDGER_LINE="2026-10-05T00:00:00Z detected-bypass head-mismatch marker=$ZERO40 parent=$SHA"
printf '%s\n' "$LEDGER_LINE" > "$S/.claude/bypass.log"

echo "════════════════════════════════════════════════════════════════════"
echo "夹具: 账本只有 parent=<sha>（无该提交自身记录）"
echo "  被测门禁: $GATE"
echo "  账本内容: $LEDGER_LINE"
echo "  待记录提交: ${SHA8}（远端 ref origin/feat/p0 不存在 ⇒ D1152 过滤关闭 ⇒ 必进待记录集）"
echo "────────────────────────────────────────────────────────────────────"
OUT="$(cd "$S" && bash "$GATE" origin/main 2>&1)"; RC=$?
echo "$OUT"
echo "────────────────────────────────────────────────────────────────────"
echo "GATE_EXIT=$RC"
if [ "$RC" -eq 0 ]; then
  echo "VERDICT=fake-green  （exit 0 = 无自身记录的提交被放行 ⇒ 假绿成立）"
elif [ "$RC" -eq 1 ]; then
  echo "VERDICT=blocked     （exit 1 = 无自身记录的提交被拦 ⇒ 假绿已堵）"
else
  echo "VERDICT=unexpected  （exit $RC = 既非通过也非违规 —— 检查自身失败路径，须单独判定）"
fi
echo "════════════════════════════════════════════════════════════════════"
exit 0
