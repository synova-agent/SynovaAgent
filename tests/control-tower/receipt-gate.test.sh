#!/bin/bash
# D313/D520 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# receipt-gate.test.sh — 收件闸（D1163）配对测试
#
# 覆盖矩阵:
#   正常  — 六行齐全 ⇒ exit 0
#   违规  — 缺「基线 ref」⇒ exit 1 + 点名该行（先红后绿对偶：补上即绿）
#   违规  — 「例外清单」有标签无值 ⇒ exit 1（空值=没填）
#   违规  — 只有标题「回执（D1163）」⇒ exit 1（六行全缺）
#   误拦防回归 — 正文提到"回执"二字 ⇒ exit 0（不得因提到就拦）
#   误拦防回归 — 派单件里"列出"六个字段名 ⇒ exit 0（标签须锚行首才算信封）
#   宿主方言 — hook 模式: 违规 ⇒ exit 2（阻断位）；通过 ⇒ 0
#   fail-closed — payload 不可解析 ⇒ exit 2 + GATE-ERROR（禁静默放行）
#   advise 模式 — 违规降为 exit 0 但打印 ADVISORY（先软后硬可回退）
#   留痕 — SYNO_GATE_LOG_DIR 下有 jsonl 追加
# 沙箱: 全量夹具走 mktemp 副本（不写真实仓库）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/receipt-gate.sh"
FIX="$REPO/tests/control-tower/fixtures/gates"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== 收件闸 receipt-gate（D1163）==="
[ -f "$GATE" ] && ok "闸脚本存在" || { no "闸脚本缺失: $GATE"; echo "结果: $PASS 通过, $FAIL 失败"; exit 1; }
bash -n "$GATE" 2>/dev/null && ok "bash -n 语法通过" || no "bash -n 语法失败"
# ── 平台守卫: 禁「$var 紧跟非 ASCII」形态 ──
# macOS bash 3.2 + UTF-8 下 `${rc}；` 会把多字节字节并进变量名 → unbound variable（本卡实测两次）
D1163_SHELLS=(
  "$REPO/scripts/control-tower/receipt-gate.sh"
  "$REPO/scripts/control-tower/dispatch-gate.sh"
  "$REPO/scripts/control-tower/gate-hook-entry.sh"
  "$REPO/scripts/control-tower/install-cto-gates.sh"
  "$REPO/tests/control-tower/receipt-gate.test.sh"
  "$REPO/tests/control-tower/dispatch-gate.test.sh"
)
BAD="$(LC_ALL=C grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^[:print:][:space:]]' "${D1163_SHELLS[@]}" | head -3)"
[ -z "$BAD" ] && ok "平台守卫: D1163 全部 shell 件无「\$var 紧跟中文」形态（bash 3.2 实测会 unbound）" || no "变量未加花括号: $BAD"
# 同族: 仓库自带扫描器（D938）在写集内零违规（权威口径，非自造 grep）
SCAN="$REPO/scripts/control-tower/scan-fullwidth-vars.sh"
if [ -f "$SCAN" ]; then
  OUTS="$(bash "$SCAN" --paths "$(IFS=,; echo "${D1163_SHELLS[*]}")" 2>&1)"; rcs=$?
  [ "$rcs" -eq 0 ] && ok "D938 扫描器: 写集内 \$VAR 紧贴全角标点 = 0 处" || no "D938 扫描器报违规（rc=${rcs}）"
else
  echo "  ⚠️ SKIP: D938 扫描器缺失 ⇒ 该用例跳过（显式，不静默计绿）"
fi


# ── 1. 正常: 六行齐全 ──
OUT="$(bash "$GATE" --file "$FIX/receipt-complete.txt" 2>&1)"; rc=$?
[ "${rc}" -eq 0 ] && ok "正常: 六行齐全 ⇒ exit 0" || no "六行齐全应 exit 0，实际 ${rc}；输出: $OUT"

# ── 2. 违规: 缺 基线 ref（反例夹具，CTO 点名要求）──
OUT="$(bash "$GATE" --file "$FIX/receipt-missing-baseline-ref.txt" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "反例: 缺「基线 ref」⇒ exit 1" || no "缺「基线 ref」应 exit 1，实际 $rc"
echo "$OUT" | grep -q "基线 ref" && ok "反例: 违规输出点名「基线 ref」" || no "违规输出未点名缺项"

# ── 3. 先红后绿: 补上 基线 ref 即绿 ──
cp "$FIX/receipt-missing-baseline-ref.txt" "$TMPD/fixed.txt"
printf '基线 ref: origin/main@74eb6c44c\n' >> "$TMPD/fixed.txt"
OUT="$(bash "$GATE" --file "$TMPD/fixed.txt" 2>&1)"; rc=$?
[ "${rc}" -eq 0 ] && ok "补上缺行 ⇒ 必绿（先红后绿对偶）" || no "补上缺行仍红，实际 ${rc}；输出: $OUT"

# ── 4. 违规: 有标签无值 ──
OUT="$(bash "$GATE" --file "$FIX/receipt-empty-exception.txt" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "反例: 「例外清单」空值 ⇒ exit 1" || no "空值应 exit 1，实际 $rc"
echo "$OUT" | grep -q "例外清单" && ok "反例: 点名「例外清单」空值" || no "未点名空值项"

# ── 5. 违规: 只有标题 ──
OUT="$(bash "$GATE" --file "$FIX/receipt-title-only.txt" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "反例: 只有标题 ⇒ exit 1（六行全缺）" || no "只有标题应 exit 1，实际 $rc"

# ── 6. 误拦防回归: 正文提到"回执" ──
OUT="$(bash "$GATE" --file "$FIX/receipt-prose-mention.txt" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "误拦防回归: 正文提到「回执」⇒ exit 0（非声称）" || no "正文提到「回执」被误拦，rc=$rc"

# ── 7. 误拦防回归: 派单件列出六个字段名 ──
OUT="$(bash "$GATE" --file "$FIX/cto-dispatch-gate-spec.txt" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "误拦防回归: 列出六个字段名的说明件 ⇒ exit 0（标签须锚行首）" || no "说明件被误拦，rc=$rc"

# ── 8. 宿主方言: hook 模式 ──
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
if [ -z "$PYBIN" ]; then
  echo "  ⚠️ SKIP: 无 python ⇒ hook 模式用例跳过（显式，不静默计绿）"
else
  mkpayload() { "$PYBIN" -c 'import json,sys;print(json.dumps({"session_id":"t","cwd":sys.argv[2],"hook_event_name":"UserPromptSubmit","prompt":open(sys.argv[1],encoding="utf8").read()}))' "$1" "$REPO"; }
  mkpayload "$FIX/receipt-missing-baseline-ref.txt" > "$TMPD/p-red.json"
  OUT="$(cat "$TMPD/p-red.json" | bash "$GATE" --hook 2>&1)"; rc=$?
  [ "$rc" -eq 2 ] && ok "hook 模式: 违规 ⇒ exit 2（宿主阻断位）" || no "hook 模式违规应 exit 2，实际 $rc"
  echo "$OUT" | grep -q "基线 ref" && ok "hook 模式: 缺项清单进 stderr（喂给收件方）" || no "hook 模式未输出缺项清单"

  mkpayload "$FIX/receipt-complete.txt" > "$TMPD/p-green.json"
  OUT="$(cat "$TMPD/p-green.json" | bash "$GATE" --hook 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && ok "hook 模式: 通过 ⇒ exit 0" || no "hook 模式通过应 exit 0，实际 $rc"

  # ── 9. fail-closed: payload 不可解析 ──
  OUT="$(printf 'not json' | bash "$GATE" --hook 2>&1)"; rc=$?
  [ "$rc" -eq 2 ] && echo "$OUT" | grep -q "GATE-ERROR" \
    && ok "fail-closed: payload 不可解析 ⇒ exit 2 + GATE-ERROR" \
    || no "payload 不可解析应 exit 2 + GATE-ERROR，实际 $rc / $OUT"

  # ── 10. advise 模式（先软后硬可回退）──
  OUT="$(cat "$TMPD/p-red.json" | SYNO_GATE_MODE=advise bash "$GATE" --hook 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && echo "$OUT" | grep -q "ADVISORY" \
    && ok "advise 模式: 违规降为 exit 0 + ADVISORY 可见" \
    || no "advise 模式未生效（rc=${rc}）"

  # ── 11. 留痕 ──
  SYNO_GATE_LOG_DIR="$TMPD/logs" bash "$GATE" --file "$FIX/receipt-complete.txt" >/dev/null 2>&1
  SYNO_GATE_LOG_DIR="$TMPD/logs" bash "$GATE" --file "$FIX/receipt-missing-baseline-ref.txt" >/dev/null 2>&1
  [ -s "$TMPD/logs/receipt-gate.jsonl" ] && ok "留痕: jsonl 已追加（$(wc -l < "$TMPD/logs/receipt-gate.jsonl" | tr -d ' ') 行）" || no "无留痕文件"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
