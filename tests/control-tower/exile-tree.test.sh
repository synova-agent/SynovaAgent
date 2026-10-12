#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# tests/control-tower/exile-tree.test.sh — `exile-tree.sh` 的**配对测试**（U7/CT-40）
#
# 🔴 判据（逐条可跑，禁空壳 —— 铁律 48）:
#   A 组 薄壳三态：未知子命令 ⇒ exit 2 ｜ 目标已存在 ⇒ exit 2 ｜ 树不存在 ⇒ exit 2
#   B 组 生命周期往返：create ⇒ exile（moved>0）⇒ restore（git 干净）⇒ destroy
#   C 组 实况断言：`paths K4` 必须打印**登记件里的真值**（不是壳自己编的）
#
# 契约（铁律 47）:
#   @input  无（自带环境探测）
#   @output 逐条 PASS/FAIL ＋ 末行 SUMMARY；**失败必贴 stderr**
#   @exit   0 = 全绿 ｜ 1 = 真红 ｜ 2 = 判不了（git / 仓根 / 实现件缺失）
#   @degraded — 无（环境失败即 2，禁 `|| true` 吞崩溃）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SH="$ROOT/scripts/control-tower/exile-tree.sh"
CORE="$ROOT/scripts/control-tower/exile-tree-core.ts"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  [PASS] $1"; }
no()   { FAIL=$((FAIL+1)); echo "  [FAIL] $1"; }

if [ ! -f "$SH" ]; then echo "❌ 判不了（exit 2）：薄壳缺失 $SH" >&2; exit 2; fi
if [ ! -f "$CORE" ]; then echo "❌ 判不了（exit 2）：核心缺失 $CORE" >&2; exit 2; fi
if ! command -v git >/dev/null 2>&1; then echo "❌ 判不了（exit 2）：git 不可用" >&2; exit 2; fi
if ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ 判不了（exit 2）：$ROOT 不是 git 工作树（本测试需要 worktree 能力）" >&2; exit 2
fi

TREE="${TMPDIR:-/tmp}/exile-tree-test-$$"
cleanup() {
  git -C "$ROOT" worktree remove "$TREE" >/dev/null 2>&1 || rm -rf "$TREE"
  git -C "$ROOT" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "── A 组：薄壳三态 ──"
OUT="$(bash "$SH" nosuchsub 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then ok "未知子命令 ⇒ exit 2"; else no "未知子命令 ⇒ 期望 2，实得 $RC（$OUT）"; fi

OUT="$(bash "$SH" create "$ROOT" 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then ok "目标已存在 ⇒ exit 2（禁覆盖）"; else no "目标已存在 ⇒ 期望 2，实得 $RC（$OUT）"; fi

OUT="$(bash "$SH" exile "$TREE-nonexistent" K2 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then ok "树不存在 ⇒ exit 2"; else no "树不存在 ⇒ 期望 2，实得 $RC（$OUT）"; fi

OUT="$(bash "$SH" matrix "$TREE-nonexistent" /tmp/x 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then ok "matrix 树不存在 ⇒ exit 2"; else no "matrix 树不存在 ⇒ 期望 2，实得 $RC（$OUT）"; fi

echo "── B 组：生命周期往返 ──"
OUT="$(bash "$SH" create "$TREE" HEAD 2>&1)"; RC=$?
if [ "$RC" -eq 0 ] && [ -d "$TREE/.git" -o -f "$TREE/.git" ]; then ok "create ⇒ exit 0"; else no "create ⇒ 期望 0，实得 $RC（$OUT）"; fi
if [ -e "$TREE/node_modules" ]; then ok "create 补了 node_modules 软链（缺了必 127）"; else no "create 未补 node_modules 软链"; fi

OUT="$(bash "$SH" exile "$TREE" K2 2>&1)"; RC=$?
MOVED="$(printf '%s' "$OUT" | sed -n 's/.*"moved":\([0-9]*\).*/\1/p')"
if [ "$RC" -eq 0 ] && [ -n "$MOVED" ] && [ "$MOVED" -gt 0 ]; then ok "exile K2 ⇒ moved=$MOVED"; else no "exile K2 ⇒ 期望 moved>0，实得 rc=$RC（$OUT）"; fi
if [ ! -e "$TREE/src/tools/tool-registry.ts" ]; then ok "摘除生效：src/tools/tool-registry.ts 已不在树内"; else no "摘除未生效"; fi

# 摘除面为空 ⇒ 必须真红（exit 1），不许静默当通过
OUT="$(bash "$SH" exile "$TREE" K11 2>&1)"; RC=$?
if [ "$RC" -eq 1 ]; then ok "空摘除面（K11 paths 为空）⇒ exit 1（禁当通过）"; else no "空摘除面 ⇒ 期望 1，实得 $RC（$OUT）"; fi

OUT="$(bash "$SH" restore "$TREE" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "restore ⇒ exit 0"; else no "restore ⇒ 期望 0，实得 $RC（$OUT）"; fi
if [ -e "$TREE/src/tools/tool-registry.ts" ]; then ok "还原生效"; else no "还原未生效"; fi
DIRTY="$(git -C "$TREE" status --porcelain | grep -v '^?? node_modules' | head -3 || true)"
if [ -z "$DIRTY" ]; then ok "还原后 git status 干净"; else no "还原后有改动：$DIRTY"; fi

OUT="$(bash "$SH" destroy "$TREE" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ] && [ ! -d "$TREE" ]; then ok "destroy ⇒ 树已拆"; else no "destroy ⇒ 期望 0 且目录消失，实得 $RC（$OUT）"; fi

echo "── C 组：paths 取数必须来自真源（不是壳编的） ──"
SRC="$(git -C "$ROOT" show HEAD:docs/synova/coordination/施工项登记.ts | grep -c "src/l4/\*\*")"
OUT="$(bash "$SH" paths K4 2>&1)"; RC=$?
CNT="$(printf '%s\n' "$OUT" | grep -c .)"
if [ "$RC" -eq 0 ] && [ "$CNT" -gt 0 ]; then ok "paths K4 ⇒ exit 0，$CNT 条"; else no "paths K4 ⇒ 期望 exit 0 且有内容，实得 rc=$RC"; fi
if printf '%s\n' "$OUT" | grep -q -- 'src/l4/\*\*'; then ok "paths K4 含字面量 src/l4/**（与真源同口径）"; else no "paths K4 缺 src/l4/**（取数口径漂了）"; fi
if [ "$SRC" -ge 1 ]; then ok "真源里确有 src/l4/**（对照成立）"; else no "真源里没找到 src/l4/**（对照不成立）"; fi

echo "SUMMARY: PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then echo "❌ 配对测试真红（exit 1）" >&2; exit 1; fi
echo "✅ 配对测试全绿（exit 0）"
exit 0
