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

printf '1197\t【坐标系】⏎模块: K2 写入门禁与工具治理⏎执行态: 在飞⏎施工批次: P0⏎服务承重件: CI⏎总闸: 无⏎命名空间: .github⏎验证级别: 夹具⏎阻塞源: K3⏎⏎正文\n' > "$SB/ok.txt"
printf '1200\t【坐标系】⏎模块: K2 写入门禁与工具治理⏎\n' > "$SB/miss.txt"
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
# D1224: 字段集已改为 CORE(3 必需) + LEGACY(4 可选) ⇒ 变异体锚点同步到 CORE_FIELDS
s = s.replace('CORE_FIELDS="模块 阻塞源"',
              'CORE_FIELDS="模块"  # MUTANT: 只查一个字段')
open(sys.argv[2], 'w').write(s)
PY
chmod +x "$MUT"
bash "$MUT" --from-file "$SB/miss.txt" --enforce >/dev/null 2>&1; rc=$?
[ $rc = 0 ] && ok "4.1 变异体（字段集缩水）⇒ 缺字段场景变绿（原工具红 ⇒ 夹具判别性成立）" || no "4.1 变异体应 0 实际 $rc"

echo ""

# ── 5. D1224（D-H 7→3）: 3 核心必需 + 4 遗留容忍 + STRICT_7 逃生缝 ──
# 协议: <issue号>TAB<正文>，正文换行用 ⏎ 占位（与 gh --jq gsub 同协议）
printf '7\t【坐标系】⏎模块: K2 工具治理⏎执行态: 在飞⏎施工批次: 门禁减法1⏎服务承重件: CI⏎总闸: 无⏎命名空间: .github⏎验证级别: 夹具⏎阻塞源: 无⏎' > "$SB/seven.txt"
printf '3\t【坐标系】⏎模块: K2 工具治理⏎阻塞源: 无⏎' > "$SB/three.txt"
printf '2\t【坐标系】⏎模块: K2 工具治理⏎' > "$SB/two.txt"

OUT="$(bash "$TOOL" --from-file "$SB/three.txt" --enforce 2>&1)"; rc=$?
[ $rc = 0 ] && ok "5.1 只写核心字段（模块+阻塞源） ⇒ 齐全（不再要求 7 字段）" || no "5.1 三字段应齐全 rc=$rc :: $OUT"

OUT="$(bash "$TOOL" --from-file "$SB/seven.txt" --enforce 2>&1)"; rc=$?
[ $rc = 0 ] && ok "5.2 含全部旧字段（7 项） ⇒ 不报错（过渡期容忍）" || no "5.2 七字段不应报错 rc=$rc"

OUT="$(bash "$TOOL" --from-file "$SB/two.txt" --enforce 2>&1)"; rc=$?
[ $rc = 1 ] && echo "$OUT" | grep -q "阻塞源" && ok "5.3 缺核心字段（阻塞源）⇒ 点名 + exit 1" || no "5.3 缺核心字段未判 rc=$rc :: $OUT"

# 5.4 STRICT_7 逃生缝: 只写 3 字段 ⇒ 按旧口径判缺（证明逃生缝真在判）
OUT="$(SYNO_COORDS_STRICT_7=1 bash "$TOOL" --from-file "$SB/three.txt" --enforce 2>&1)"; rc=$?
[ $rc = 1 ] && ok "5.4 STRICT_7=1 ⇒ 按旧口径判缺（逃生缝生效）" || no "5.4 STRICT_7 未生效 rc=$rc"

# 5.5 变异体（改坏即红）: 把 CORE 缩成 1 字段的副本 ⇒ 缺字段场景变绿（判别性）
MUT="$SB/mut5.sh"; sed 's/^CORE_FIELDS="模块 阻塞源"/CORE_FIELDS="模块"/' "$TOOL" > "$MUT"
rc=0; bash "$MUT" --from-file "$SB/two.txt" --enforce >/dev/null 2>&1 || rc=$?
[ $rc = 0 ] && ok "5.5 变异体（CORE 缩水）⇒ 缺字段场景变绿（夹具判别性成立）" || no "5.5 变异体应 0 实际 $rc"


echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" = 0 ] && exit 0 || exit 1
