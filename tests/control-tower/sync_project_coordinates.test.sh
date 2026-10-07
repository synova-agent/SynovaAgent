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
[ $rc = 0 ] && echo "$OUT" | grep -q "核心字段=3/3" && ok "1.1 七字段齐全 ⇒ 解析 7/7，exit 0" || no "1.1 rc=$rc :: $OUT"
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
if echo "$OUT" | grep -q "核心字段=3/3"; then no "4.1 变异体未体现差异（仍 7/7）:: $OUT"; else ok "4.1 变异体（字段集改坏）⇒ 齐全用例解析数偏离 7/7（夹具判别性成立）"; fi

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


# ── 17.4 D1216-R1: except 收窄 —— 非配置面错误必须 re-raise（防"宽吞"回归）──
narrow="$(python3 - <<'PY'
import re, pathlib
src = pathlib.Path("scripts/control-tower/sync_project_coordinates.py").read_text(encoding="utf-8")
i = src.index("except RuntimeError as e:")
blk = src[i:i+700]
pat = r"does not accept|Cannot coerce|Could not resolve to a node"
ok = ("re.search" in blk and "raise" in blk
      and re.search(pat, "field does not accept text")
      and not re.search(pat, "connection reset by peer"))
print("NARROW" if ok else "WIDE")
PY
)"
echo "  #17.4 except 收窄判定: $narrow"
[ "$narrow" = "NARROW" ] && ok "17.4 非配置面错误 re-raise（收窄成立）" || no "17.4 except 过宽（会吞传输/权限类失败）"



# ── 18. D1224（D-H 7→3）: 解析面 7 项全认 / 灌板面只灌 3 项 ──
# 18.0 判据函数（verifier P2: 原 18.2 用 grep -qv —— 逐行取反 ⇒ 恒真纸老虎；
#      原 18.4 只 grep 变异体自己的输出 ⇒ 自指。两处改为「同一判据 + 变异体真喂回」。）
post_face_is_3only() {
  printf '%s\n' "$1" | grep -q '"执行态"' || return 1
  for _legacy in 服务承重件 总闸 命名空间 验证级别; do
    printf '%s\n' "$1" | grep -q "\"$_legacy\"" && return 1
  done
  return 0
}

# 18.1 老正文（7 字段）⇒ 核心字段 3/3（说明老正文不会被当"无坐标系块"误判）
OUT="$(ISSUE_NUMBER=9 PROJECT_TOKEN= python3 "$TOOL" --from-body "$SB/full.md" 2>&1)"; rc=$?
echo "$OUT" | grep -q "核心字段=3/3" && ok "18.1 老正文（7 字段）⇒ 核心字段 3/3（不误判为无块）" || no "18.1 核心字段计数异常 :: $OUT"

# 18.2 灌板面 = 3（dry-run 打印将写入的字段集，不触网）
OUT="$(ISSUE_NUMBER=9 PROJECT_TOKEN=x python3 "$TOOL" --from-body "$SB/full.md" --dry-run 2>&1)"; rc=$?
if post_face_is_3only "$OUT"; then ok "18.2 灌板只含 3 核心字段（遗留 4 项不灌）"; else no "18.2 灌板字段集异常 :: $OUT"; fi

# 18.3 STRICT_7 逃生缝: 置 1 ⇒ 灌板面回到 7 项
OUT="$(SYNO_COORDS_STRICT_7=1 ISSUE_NUMBER=9 PROJECT_TOKEN=x python3 "$TOOL" --from-body "$SB/full.md" --dry-run 2>&1)"; rc=$?
echo "$OUT" | grep -q '"服务承重件"' && ok "18.3 STRICT_7=1 ⇒ 灌板面含遗留字段（逃生缝生效）" || no "18.3 STRICT_7 未生效 :: $OUT"



# 18.4 变异体（改坏即红）: 把 POST_FIELDS 退回 FIELDS ⇒ 18.2 的断言必须失败
MUT18="$SB/mut18.py"
sed 's/^POST_FIELDS = CORE_FIELDS.*/POST_FIELDS = FIELDS/' "$TOOL" > "$MUT18"
OUT="$(ISSUE_NUMBER=9 PROJECT_TOKEN=x python3 "$MUT18" --from-body "$SB/full.md" --dry-run 2>&1)"
if post_face_is_3only "$OUT"; then no "18.4 变异体未体现差异（退回 7 项后仍判 3-only ⇒ 18.2 是纸老虎）"; else ok "18.4 变异体（POST_FIELDS 退回 7 项）⇒ 同一判据转红（判别力成立）"; fi

echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" = 0 ] && exit 0 || exit 1

