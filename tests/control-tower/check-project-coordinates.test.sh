#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# check-project-coordinates.test.sh — 坐标系校验器夹具（#991 / D1142）
# 覆盖: 正常（合规 Issue 零违规）/ 反例三态（不在板上 / 字段不足 / 词表外值）/
#       边界 exit 2（输入缺失、解析失败）/ 接线（ci.yml 登记）/ 词表来源标注（待 #948）
# 隔离: 全部输入走夹具文件（--issues-file/--board-file），**零网络**。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/../.." && pwd)"
CHECK="$REPO_DIR/scripts/control-tower/check-project-coordinates.sh"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
[ -f "$CHECK" ] || { echo "degraded: 检查器不存在" >&2; exit 2; }
SB="$(mktemp -d)"; trap 'rm -rf "$SB"' EXIT

cat > "$SB/ok.json" <<'EOF'
[{"number":1,"body":"**坐标系**\n执行态: 已派单\n验证级别: L2-真跑通\n阻塞源: 无阻塞\n总闸: 不适用\n"}]
EOF
cat > "$SB/bad.json" <<'EOF'
[{"number":2,"body":"**坐标系**\n执行态: 随便的词\n验证级别: L1-静态可达\n"},
 {"number":3,"body":"**坐标系**\n执行态: 未开工\n验证级别: L1-静态可达\n阻塞源: 无阻塞\n"}]
EOF
cat > "$SB/board_ok.json" <<'EOF'
{"data":{"node":{"items":{"nodes":[{"content":{"number":1}}]}}}}
EOF
cat > "$SB/board_miss.json" <<'EOF'
{"data":{"node":{"items":{"nodes":[{"content":{"number":2}}]}}}}
EOF

grep -q 'check-project-coordinates.test.sh' "$REPO_DIR/.github/workflows/ci.yml" \
  && ok "接线: 夹具登记 ci.yml" || bad "接线: 夹具未登记 ci.yml"

OUT=$(bash "$CHECK" --issues-file "$SB/ok.json" --board-file "$SB/board_ok.json" 2>&1); RC=$?
[ "$RC" = "0" ] && ok "1 正常: 合规 Issue ⇒ exit 0" || bad "1 正常: exit=${RC}"
case "$OUT" in *"off_board=0 lt_min_fields=0 vocab_bad=0"*) ok "1 正常: 三项计数全零";; *) bad "1 正常: 计数不符（$(echo "$OUT"|grep -o 'PROJECT_COORD_SUMMARY.*')）";; esac

OUT=$(bash "$CHECK" --issues-file "$SB/bad.json" --board-file "$SB/board_miss.json" 2>&1); RC=$?
[ "$RC" = "1" ] && ok "2 反例: 三类违规 ⇒ exit 1" || bad "2 反例: exit=${RC}（应 1）"
case "$OUT" in *"#2 坐标系字段仅 2 个非空"*) ok "2 反例: 判据② 点名（字段不足）";; *) bad "2 反例: 判据② 未点名";; esac
case "$OUT" in *"#3 不在 Project"*) ok "2 反例: 判据① 点名（不在板上）";; *) bad "2 反例: 判据① 未点名";; esac
case "$OUT" in *"词表外值: 执行态=随便的词"*) ok "2 反例: 判据③ 点名（词表外值）";; *) bad "2 反例: 判据③ 未点名";; esac

RC=0; bash "$CHECK" --issues-file "$SB/none.json" --board-file "$SB/board_ok.json" >/dev/null 2>&1 || RC=$?
[ "$RC" = "2" ] && ok "3 边界: 输入文件缺失 ⇒ exit 2" || bad "3 边界: exit=${RC}（应 2）"
printf 'not-json' > "$SB/broken.json"
RC=0; bash "$CHECK" --issues-file "$SB/broken.json" --board-file "$SB/board_ok.json" >/dev/null 2>&1 || RC=$?
[ "$RC" = "2" ] && ok "3 边界: JSON 解析失败 ⇒ exit 2（不静默）" || bad "3 边界: exit=${RC}（应 2）"

OUT=$(bash "$CHECK" --issues-file "$SB/ok.json" --board-file "$SB/board_ok.json" 2>&1)
case "$OUT" in *"待 #948"*) ok "4 依赖标注: 词表口径显式标注「待 #948」（#948 未落地）";; *) bad "4 依赖标注: 未标注 #948";; esac

echo ""
echo "  结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || { echo "❌ FAILED"; exit 1; }
echo "PROJECT_COORD_TEST_SUMMARY: pass=${PASS} fail=0"
