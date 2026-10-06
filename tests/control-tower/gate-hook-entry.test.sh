#!/bin/bash
# D313/D520 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# gate-hook-entry.test.sh — D1163 登记点入口配对测试（U7/CT-40）
#
# 覆盖矩阵:
#   正常 — receipt 绿 payload ⇒ 0；dispatch 绿文本路径 ⇒ 0（透传闸脚本退出码）
#   违规 — receipt 红 payload ⇒ 2 + 缺项清单（宿主阻断位）
#   fail-closed — 未知闸名 ⇒ 2 + GATE-ERROR；闸脚本缺失 ⇒ 2 + GATE-ERROR
# 沙箱: mktemp 目录做「空项目目录」（模拟 CLAUDE_PROJECT_DIR 指错），不写真实仓库
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENTRY="$REPO/scripts/control-tower/gate-hook-entry.sh"
FIX="$REPO/tests/control-tower/fixtures/gates"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== 登记点入口 gate-hook-entry（D1163）==="
if [ ! -f "$ENTRY" ]; then
  echo "  ❌ 入口脚本缺失: $ENTRY"
  echo "结果: 0 通过, 1 失败"; exit 1
fi
ok "入口脚本存在"
bash -n "$ENTRY" 2>/dev/null && ok "bash -n 语法通过" || no "bash -n 语法失败"

PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done

# ── fail-closed: 未知闸名 ──
OUT="$(printf '{}' | bash "$ENTRY" bogus 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && echo "$OUT" | grep -q "GATE-ERROR" \
  && ok "未知闸名 ⇒ exit 2 + GATE-ERROR（不静默）" || no "未知闸名应 exit 2 + GATE-ERROR，实际 ${rc}"

# ── fail-closed: 闸脚本缺失（登记点在而闸不在 = 门禁空转）──
mkdir -p "$TMPD/empty-project"
OUT="$(printf '{}' | CLAUDE_PROJECT_DIR="$TMPD/empty-project" bash "$ENTRY" receipt 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && echo "$OUT" | grep -q "闸脚本缺失" \
  && ok "闸脚本缺失 ⇒ exit 2 fail-closed（宁红不空转）" || no "缺件应 fail-closed，实际 ${rc}"

# ── 缺省回退: 无 CLAUDE_PROJECT_DIR 时用 \$PWD ──
OUT="$(cd "$TMPD/empty-project" && printf '{}' | env -u CLAUDE_PROJECT_DIR bash "$ENTRY" dispatch 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && echo "$OUT" | grep -q "闸脚本缺失" \
  && ok "无 CLAUDE_PROJECT_DIR ⇒ 回退 \$PWD 判定（同样 fail-closed）" || no "回退路径行为异常，实际 ${rc}"

# ── 透传（需 python 造 hook payload）──
if [ -z "$PYBIN" ]; then
  echo "  ⚠️ SKIP: 无 python ⇒ 透传用例跳过（显式，不静默计绿）"
else
  "$PYBIN" -c 'import json,sys;print(json.dumps({"hook_event_name":"UserPromptSubmit","prompt":open(sys.argv[1],encoding="utf8").read()}))' \
    "$FIX/receipt-missing-baseline-ref.txt" > "$TMPD/red.json"
  OUT="$(CLAUDE_PROJECT_DIR="$REPO" bash "$ENTRY" receipt < "$TMPD/red.json" 2>&1)"; rc=$?
  [ "$rc" -eq 2 ] && echo "$OUT" | grep -q "基线 ref" \
    && ok "透传 receipt 闸: 红 payload ⇒ 2 + 缺项清单" || no "透传失败（rc=${rc}）"

  "$PYBIN" -c 'import json,sys;print(json.dumps({"hook_event_name":"UserPromptSubmit","prompt":open(sys.argv[1],encoding="utf8").read()}))' \
    "$FIX/receipt-complete.txt" > "$TMPD/green.json"
  OUT="$(CLAUDE_PROJECT_DIR="$REPO" bash "$ENTRY" receipt < "$TMPD/green.json" 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && ok "透传 receipt 闸: 绿 payload ⇒ 0" || no "绿路径失败（rc=${rc}）"

  "$PYBIN" -c 'import json;print(json.dumps({"hook_event_name":"PreToolUse","tool_name":"send_message","tool_input":{"message":"收到，我看一眼就回。"}}))' > "$TMPD/chat.json"
  OUT="$(CLAUDE_PROJECT_DIR="$REPO" bash "$ENTRY" dispatch < "$TMPD/chat.json" 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && ok "透传 dispatch 闸: 非指令 ⇒ 0" || no "dispatch 透传失败（rc=${rc}）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
