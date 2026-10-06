#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-project-coordinates.test.sh — D1175 (#991) 坐标系防漂移校验器夹具
# 覆盖矩阵: 齐全✅ / 缺字段⚠️点名 / 无块❌ / 预演恒 0 / enforce 漂移 1 / enforce 全齐 0 /
#           --from-file 不可读 ⇒ 2（fail-closed 禁降级）/ 变异体（字段循环清空）判别性
# 沙箱: --from-file 注入缝，零网络零真仓依赖（铁律 0-3 禁 stash；trap 清理）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$REPO/scripts/control-tower/check-project-coordinates.sh"
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }
SB="$(mktemp -d)"; trap 'rm -rf "$SB"' EXIT

printf '1197\t【坐标系】⏎执行态: 在飞⏎施工批次: P0⏎服务承重件: CI⏎总闸: 无⏎命名空间: .github⏎验证级别: 夹具⏎阻塞源: K3⏎⏎正文\n' > "$SB/ok.txt"
printf '1200\t【坐标系】⏎执行态: 未开工⏎\n' > "$SB/miss.txt"
printf '1201\t普通正文无坐标系\n' > "$SB/noblock.txt"
cat "$SB/ok.txt" "$SB/miss.txt" "$SB/noblock.txt" > "$SB/all.txt"

echo "=== D1175 (#991): 坐标系防漂移校验器 ==="

OUT="$(bash "$TOOL" --from-file "$SB/all.txt" 2>&1)"; rc=$?
[ $rc = 0 ] && echo "$OUT" | grep -q "齐全 1 / 缺字段 1 / 无块 1" \
  && ok "1.1 预演: 三形态逐条点名 + 汇总正确（恒 exit 0）" || no "1.1 预演 rc=$rc :: $OUT"
echo "$OUT" | grep -q "⚠️ #1200: 缺字段" && ok "1.2 缺字段逐名点名（施工批次…）" || no "1.2 未点名缺字段"
echo "$OUT" | grep -q "❌ #1201: 无【坐标系】块" && ok "1.3 无块点名" || no "1.3 未点名无块"

bash "$TOOL" --from-file "$SB/all.txt" --enforce >/dev/null 2>&1; rc=$?
[ $rc = 1 ] && ok "2.1 enforce + 漂移 ⇒ exit 1" || no "2.1 应 1 实际 $rc"

OUT="$(bash "$TOOL" --from-file "$SB/ok.txt" --enforce 2>&1)"; rc=$?
[ $rc = 0 ] && echo "$OUT" | grep -q "全部齐全" && ok "2.2 enforce + 全齐 ⇒ exit 0" || no "2.2 应 0 实际 $rc :: $OUT"

bash "$TOOL" --from-file "$SB/nonexistent" >/dev/null 2>&1; rc=$?
[ $rc = 2 ] && ok "3.1 --from-file 不可读 ⇒ exit 2（fail-closed 禁降级放行）" || no "3.1 应 2 实际 $rc"

bash "$TOOL" --bad-param >/dev/null 2>&1; rc=$?
[ $rc = 2 ] && ok "3.2 未知参数 ⇒ exit 2" || no "3.2 应 2 实际 $rc"

# 判别性: 变异体（字段集清空 ⇒ 缺字段永不报）⇒ miss 场景在 enforce 下变 0（原 1）
MUT="$SB/mut.sh"
python3 - "$TOOL" "$MUT" <<'PY'
import sys
s = open(sys.argv[1]).read()
s = s.replace('FIELDS="执行态 施工批次 服务承重件 总闸 命名空间 验证级别 阻塞源"',
              'FIELDS="执行态"  # MUTANT: 只查一个字段')
open(sys.argv[2], 'w').write(s)
PY
chmod +x "$MUT"
bash "$MUT" --from-file "$SB/miss.txt" --enforce >/dev/null 2>&1; rc=$?
[ $rc = 0 ] && ok "4.1 变异体（字段集缩水）⇒ 缺字段场景变绿（原工具红 ⇒ 夹具判别性成立）" || no "4.1 变异体应 0 实际 $rc"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" = 0 ] && exit 0 || exit 1
