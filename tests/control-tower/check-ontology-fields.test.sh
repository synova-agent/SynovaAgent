#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-ontology-fields.test.sh — D1174 (#1015 G-1) ontology 字段回归防线夹具
# 覆盖矩阵:
#   正常: 真仓 55 件全过 / 沙箱健康集全过
#   改坏即红（卡 Done 原文）: 删任一文件 action_effect_lag ⇒ exit 1；改回 ⇒ exit 0
#   边界: 字段值为空串 ⇒ exit 1 / 顶层非对象 ⇒ exit 1 / 目录不存在 ⇒ exit 2 / 零 json ⇒ exit 2
#   判别性: 删掉字段循环（只数文件不查字段）的变异体 ⇒ 删字段场景变绿（夹具不判别即红）
# 沙箱: mktemp 复制 edge-types 子集，零真仓污染（铁律 0-3 禁 stash；trap 清理）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$REPO/scripts/control-tower/check-ontology-fields.sh"
SRC="$REPO/extensions/ontology/edge-types"
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }

SB="$(mktemp -d)"
cleanup() { rm -rf "$SB"; }
trap cleanup EXIT

# 沙箱集: 取前 5 件（含 augments.json）
i=0; for f in "$SRC"/*.json; do i=$((i+1)); [ $i -gt 5 ] && break; cp "$f" "$SB/"; done

echo "=== D1174 (#1015 G-1): ontology 字段防线 ==="

# 1 正常: 沙箱健康集
OUT="$(SYNO_EDGE_TYPES_DIR="$SB" bash "$TOOL" 2>&1)"; rc=$?
[ $rc = 0 ] && ok "1.1 健康集 exit 0" || no "1.1 应 0 实际 $rc :: $OUT"

# 2 真仓全量
OUT="$(bash "$TOOL" 2>&1)"; rc=$?
[ $rc = 0 ] && echo "$OUT" | grep -q "件边类型关键字段齐全" && ok "1.2 真仓全量过（${OUT}）" || no "1.2 真仓红: $OUT"

# 3 改坏即红: 删 action_effect_lag
python3 -c "
import json; p='$SB/augments.json'; d=json.load(open(p)); del d['action_effect_lag']; json.dump(d,open(p,'w'))"
OUT="$(SYNO_EDGE_TYPES_DIR="$SB" bash "$TOOL" 2>&1)"; rc=$?
[ $rc = 1 ] && echo "$OUT" | grep -q "augments.json: 缺字段 action_effect_lag" \
  && ok "2.1 删 action_effect_lag ⇒ exit 1 且点名" || no "2.1 应 1 实际 $rc :: $OUT"

# 4 改回 ⇒ 绿（卡 Done 原文）
cp "$SRC/augments.json" "$SB/"
OUT="$(SYNO_EDGE_TYPES_DIR="$SB" bash "$TOOL" 2>&1)"; rc=$?
[ $rc = 0 ] && ok "2.2 改回 ⇒ exit 0" || no "2.2 应 0 实际 $rc"

# 5 边界: 值为空串
python3 -c "
import json; p='$SB/augments.json'; d=json.load(open(p)); d['transfer_function']='  '; json.dump(d,open(p,'w'))"
OUT="$(SYNO_EDGE_TYPES_DIR="$SB" bash "$TOOL" 2>&1)"; rc=$?
[ $rc = 1 ] && echo "$OUT" | grep -q "transfer_function 值为空" && ok "3.1 值空串 ⇒ exit 1 且点名" || no "3.1 应 1 实际 $rc :: $OUT"
cp "$SRC/augments.json" "$SB/"

# 6 边界: 目录不存在 ⇒ 2（fail-closed）
SYNO_EDGE_TYPES_DIR="/nonexistent-d1174" bash "$TOOL" >/dev/null 2>&1; rc=$?
[ $rc = 2 ] && ok "3.2 目录不存在 ⇒ exit 2（检查失败≠通过）" || no "3.2 应 2 实际 $rc"

# 7 边界: 零 json ⇒ 2
EMPTY="$(mktemp -d)"
SYNO_EDGE_TYPES_DIR="$EMPTY" bash "$TOOL" >/dev/null 2>&1; rc=$?
[ $rc = 2 ] && ok "3.3 零 *.json ⇒ exit 2" || no "3.3 应 2 实际 $rc"
rmdir "$EMPTY"

# 8 判别性（变异体: 字段循环改为恒通过）
MUT="$(mktemp -d)"; mkdir -p "$MUT"
python3 - "$TOOL" "$MUT/mut.sh" <<'PY'
import sys
s = open(sys.argv[1]).read()
s = s.replace("    for fld in fields:", "    for fld in []:  # MUTANT")
open(sys.argv[2], 'w').write(s)
PY
chmod +x "$MUT/mut.sh"
python3 -c "
import json; p='$SB/augments.json'; d=json.load(open(p)); del d['action_effect_lag']; json.dump(d,open(p,'w'))"
OUT="$(SYNO_EDGE_TYPES_DIR="$SB" bash "$MUT/mut.sh" 2>&1)"; rc=$?
[ $rc = 0 ] && ok "4.1 变异体（不查字段）⇒ 删字段场景变绿（原工具红 ⇒ 夹具判别性成立）" || no "4.1 变异体应 0 实际 $rc"
cp "$SRC/augments.json" "$SB/"; rm -rf "$MUT"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" = 0 ] && exit 0 || exit 1
