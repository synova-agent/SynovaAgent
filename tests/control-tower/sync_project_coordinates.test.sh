#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# sync_project_coordinates.test.sh — D1196 workflow 薄壳化配套测试
# 覆盖矩阵:
#   正常: 正文七字段齐全 ⇒ 解析 7/7 + 无 warning + 无 token ⇒ notice + exit 0
#   降级/边界: 缺字段 ⇒ warning 点名；无【坐标系】块 ⇒ notice + exit 0（不红）
#   自身失败: --from-body 不可读 ⇒ 解释器异常 rc≠0（fail-closed）；未知参数 ⇒ exit 2
#   判别性: 把 parse 正则改坏（不认字段）的变异体 ⇒ 齐全用例变「0 字段」⇒ 夹具判别成立
# 沙箱: mktemp 正文文件，零网络（无 token 下不触 API）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$REPO/scripts/control-tower/sync_project_coordinates.py"
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }
SB="$(mktemp -d)"; trap 'rm -rf "$SB"' EXIT

printf '【坐标系】\n执行态: 在飞\n施工批次: 门禁减法1\n服务承重件: CI\n总闸: 无\n命名空间: .github\n验证级别: 夹具\n阻塞源: 无\n\n正文\n' > "$SB/full.md"
printf '【坐标系】\n执行态: 在飞\n' > "$SB/partial.md"
printf '无坐标系块的正文\n' > "$SB/none.md"

echo "=== D1196: sync_project_coordinates 薄壳脚本 ==="

OUT="$(ISSUE_NUMBER=1 PROJECT_TOKEN= python3 "$TOOL" --from-body "$SB/full.md" 2>&1)"; rc=$?
[ $rc = 0 ] && echo "$OUT" | grep -q "解析=7/7 字段" && ok "1.1 七字段齐全 ⇒ 解析 7/7，exit 0" || no "1.1 rc=$rc :: $OUT"
echo "$OUT" | grep -q "warning" && no "1.2 齐全时不应有 warning" || ok "1.2 齐全时无 warning"
echo "$OUT" | grep -q "PROJECT_TOKEN 未配置" && ok "1.3 无 token ⇒ notice（跳过且不红）" || no "1.3 缺 notice"

OUT="$(ISSUE_NUMBER=2 PROJECT_TOKEN= python3 "$TOOL" --from-body "$SB/partial.md" 2>&1)"; rc=$?
[ $rc = 0 ] && echo "$OUT" | grep -q "缺=施工批次" && ok "2.1 缺字段 ⇒ warning 逐名点名" || no "2.1 rc=$rc :: $OUT"

OUT="$(ISSUE_NUMBER=3 PROJECT_TOKEN= python3 "$TOOL" --from-body "$SB/none.md" 2>&1)"; rc=$?
[ $rc = 0 ] && echo "$OUT" | grep -q "无【坐标系】块" && ok "2.2 无坐标系块 ⇒ notice + exit 0（不红）" || no "2.2 rc=$rc :: $OUT"

python3 "$TOOL" --from-body "$SB/nonexistent.md" >/dev/null 2>&1; rc=$?
[ $rc -ne 0 ] && ok "3.1 --from-body 不可读 ⇒ 非 0（fail-closed）" || no "3.1 应非 0 实际 0"

python3 "$TOOL" --bad-flag >/dev/null 2>&1; rc=$?
[ $rc = 2 ] && ok "3.2 未知参数 ⇒ exit 2" || no "3.2 应 2 实际 $rc"

# 判别性: 变异体（parse 正则改为匹配不存在字段）
MUT="$SB/mut.py"
python3 - "$TOOL" "$MUT" <<'PY'
import sys
s = open(sys.argv[1], encoding='utf-8').read()
s = s.replace('FIELDS = ["执行态",', 'FIELDS = ["__不存在的字段__",')
open(sys.argv[2], 'w', encoding='utf-8').write(s)
PY
OUT="$(ISSUE_NUMBER=4 PROJECT_TOKEN= python3 "$MUT" --from-body "$SB/full.md" 2>&1)"; rc=$?
if echo "$OUT" | grep -q "解析=7/7 字段"; then no "4.1 变异体未体现差异（仍 7/7）:: $OUT"; else ok "4.1 变异体（字段集改坏）⇒ 齐全用例解析数偏离 7/7（夹具判别性成立）"; fi

echo ""
# ── 17. D1216 回归: GraphQL query 括号平衡（可真构造 + 变异体）──
#    历史事故(2026-10-07): field 查询 5 个 `{` 只 4 个 `}` ⇒ CI 每轮红
#    (`Expected NAME, actual: (none) at [1,124]`)；旧夹具(示例驱动)抓不到。
q_line="$(python3 - <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("spc", "scripts/control-tower/sync_project_coordinates.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
q = m.q_field_by_name()
print(q.count("{"), q.count("}"))
PY
)"
echo "  #17.1 真构造 q_field_by_name() ⇒ { 与 } 计数: $q_line"
if echo "$q_line" | awk 'NF==2 && $1 ~ /^[0-9]+$/ && $1==$2 {found=1} END{exit !found}'; then
  ok "17.1 真构造 query 括号平衡"
else
  no "17.1 query 括号不平衡（GraphQL 必失败）"
fi

# 变异体: 人为去掉一个右括号 ⇒ assert_query_balanced 必须抛错（证明判据真在判）
mut="$(python3 - <<'PY'
import importlib.util
spec = importlib.util.spec_from_file_location("spc", "scripts/control-tower/sync_project_coordinates.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
try:
    m.assert_query_balanced(m.q_field_by_name()[:-1])   # 删一个 }
    print("NOPASS")
except ValueError:
    print("RAISED")
PY
)"
echo "  #17.2 变异体(删一个右括号) ⇒ $mut"
if [ "$mut" = "RAISED" ]; then
  ok "17.2 变异体：括号不平衡 ⇒ 契约抛错（判别性成立）"
else
  no "17.2 变异体未被捕获（判据是纸老虎）"
fi

# 17.3 字段名走查询变量（不再字符串插值）⇒ 规避引号/非 ASCII 转义面
if grep -q 'field(name:\$name)' scripts/control-tower/sync_project_coordinates.py; then
  ok "17.3 字段名走查询变量 \$name（非插值）"
else
  no "17.3 仍用字符串插值拼字段名"
fi

echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" = 0 ] && exit 0 || exit 1

