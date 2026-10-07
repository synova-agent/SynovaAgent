#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gate-retirement-report.test.sh — D1201（v2.0 方案五）配套测试
# 覆盖矩阵:
#   正常: 有日志+有 pre-commit ⇒ 输出三段（零命中/预算）+ 退出 0
#   边界: 日志缺失 ⇒ **明确标注「无数据」且不据此退役**（无数据≠零命中）；仍 exit 0
#   自身失败: 未知参数 ⇒ exit 2；pre-commit 不可读 ⇒ exit 2；python 不可用 ⇒ exit 2（静态检查）
#   判别性: 变异体（去掉 "$" 过滤）⇒ 报告重新出现模板/code 路径名 ⇒ 夹具断言失败（判别成立）
# 沙箱: mktemp 造 gate-hits.log + 假 pre-commit，零真仓依赖。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$REPO/scripts/control-tower/gate-retirement-report.sh"
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }
SB="$(mktemp -d)"; trap 'rm -rf "$SB"' EXIT

# 假 pre-commit: 三个检查点（两个有点名，一个零命中）+ 一个含 $ 的模板行（应被过滤）
cat > "$SB/pc.sh" <<'EOF'
hard_check "活跃检查A" "$X"
soft_check "活跃检查B" "$Y"
hard_check "死检查C" "$Z"
hard_check "$1" "${2:-}"
EOF
NOW="$(python3 -c 'from datetime import datetime,timezone;print(datetime.now(timezone.utc).isoformat())')"
cat > "$SB/gate-hits.log" <<EOF
{"time":"$NOW","gate":"活跃检查A","result":"hit","branch":"x"}
{"time":"$NOW","gate":"活跃检查B","result":"hit","branch":"x"}
EOF

echo "=== D1201: 门禁退役复审报告 ==="

OUT="$(SYNO_GATE_HITS_LOG="$SB/gate-hits.log" SYNO_PRECOMMIT="$SB/pc.sh" bash "$TOOL" --days 90 2>&1)"; rc=$?
[ $rc = 0 ] && echo "$OUT" | grep -q "零命中候选" && ok "1.1 正常: 三段报告 exit 0" || no "1.1 rc=$rc :: $(echo "$OUT"|head -3)"
echo "$OUT" | grep -q "死检查C" && ok "1.2 零命中检查点被点名" || no "1.2 未点名零命中项"
echo "$OUT" | grep -q '`\$1`' && no "1.3 含 \$ 的模板名未被过滤" || ok "1.3 模板名（\$1）已过滤"
echo "$OUT" | grep -q "活跃检查A" && no "1.4 有点名的检查被误列零命中" || ok "1.4 有点名者不列入零命中"
echo "$OUT" | grep -q "现存检查点: \*\*3\*\*" && ok "1.5 现存计数=3（过滤后）" || no "1.5 现存计数异常: $(echo "$OUT"|grep '现存检查点')"

OUT="$(SYNO_GATE_HITS_LOG="$SB/nonexistent.log" SYNO_PRECOMMIT="$SB/pc.sh" bash "$TOOL" --days 90 2>&1)"; rc=$?
[ $rc = 0 ] && echo "$OUT" | grep -q "无数据" && ok "2.1 日志缺失 ⇒ 标注「无数据」+ exit 0（不据此退役）" || no "2.1 rc=$rc 或缺无数据标注"

SYNO_GATE_HITS_LOG="$SB/gate-hits.log" SYNO_PRECOMMIT="$SB/pc.sh" bash "$TOOL" --bad-flag >/dev/null 2>&1; rc=$?
[ $rc = 2 ] && ok "3.1 未知参数 ⇒ exit 2" || no "3.1 应 2 实际 $rc"

SYNO_GATE_HITS_LOG="$SB/gate-hits.log" SYNO_PRECOMMIT="$SB/missing.sh" bash "$TOOL" >/dev/null 2>&1; rc=$?
[ $rc = 2 ] && ok "3.2 pre-commit 不可读 ⇒ exit 2（fail-closed）" || no "3.2 应 2 实际 $rc"

# 判别性: 变异体（去掉 "$" 过滤）⇒ 模板名回流
MUT="$SB/mut.sh"
python3 - "$TOOL" "$MUT" <<'PY'
import sys
s = open(sys.argv[1], encoding='utf-8').read()
s = s.replace('        if "$" in name:\n            continue\n', '')
open(sys.argv[2], 'w', encoding='utf-8').write(s)
PY
chmod +x "$MUT"
OUT="$(SYNO_GATE_HITS_LOG="$SB/gate-hits.log" SYNO_PRECOMMIT="$SB/pc.sh" bash "$MUT" --days 90 2>&1)"
echo "$OUT" | grep -q '`\$1`' && ok "4.1 变异体（去 \$ 过滤）⇒ 模板名回流（夹具判别性成立）" || no "4.1 变异体未体现差异"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" = 0 ] && exit 0 || exit 1
