#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═════════════════════════════════════════════════════════════════
# check-canary-drift.test.sh — D526: CI canary 密封清单漂移告警
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 漂移存在（新测试不在清单）→ 告警出现 + ::warning + exit 0（不阻断）
#   通过 — 清单补齐 → 告警消失（✅ 零漂移）
#   边界 — 幽灵清单项（清单有文件无）→ ghost 告警；.ts 测试不计 canary 漂移
#   降级 — ci.yml 缺失 → 显式跳过 + exit 0
#   接线 — ci.yml canary 步骤调用 ct-health.sh canary-drift（task-28 裁定②：原脚本已退役，逻辑内联；真实接线断言）
# 沙箱: SYNO_TESTS_DIR/SYNO_CI_YML 注入临时目录
# ═════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CT_HEALTH="$REPO/scripts/control-tower/ct-health.sh"   # task-28: 原 check-canary-drift.sh 已退役，逻辑内联入 ct-health
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D526: canary 漂移告警 ==="

# ── 接线: ci.yml canary 步骤真实调用 ──
grep -q "ct-health.sh canary-drift" "$REPO/.github/workflows/ci.yml" \
  && ok "接线: ci.yml canary 步骤调用 ct-health.sh canary-drift" || no "ci.yml 未接漂移检查（新活点）"
[ -x "$CT_HEALTH" ] && ok "宿主存在且可执行（ct-health.sh）" || no "宿主缺失/不可执行"

# ── 沙箱 fixture: 测试目录 + 清单 ──
TD="$TMPD/tests/control-tower"; mkdir -p "$TD"
YML="$TMPD/ci.yml"
printf 'run: |\n  for t in \\\n    tests/control-tower/alpha.test.sh \\\n    tests/control-tower/beta.test.sh; do\n' > "$YML"
printf '#!/bin/bash\n' > "$TD/alpha.test.sh"
printf '#!/bin/bash\n' > "$TD/beta.test.sh"
printf '#!/bin/bash\n' > "$TD/gamma.test.sh"    # 漂移项
printf '#!/bin/bash\n' > "$TD/delta.test.ts"    # .ts 不计 canary

# ── 正常: 漂移存在 → 告警 + exit 0 ──
OUT=$(SYNO_TESTS_DIR="$TMPD/tests" SYNO_CI_YML="$YML" bash "$CT_HEALTH" canary-drift 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "漂移场景 exit 0（告警不阻断）" || no "应 exit 0, 实际 $rc"
echo "$OUT" | grep -q "gamma.test.sh" && ok "漂移项被点名（gamma）" || no "未点名漂移项"
echo "$OUT" | grep -q "::warning title=canary-drift" && ok "::warning 注解输出（CI 可见）" || no "缺 ::warning"
echo "$OUT" | grep -q "delta.test.ts" && no ".ts 被误计入 canary 漂移" || ok ".ts 不计 canary 漂移（runner 语义正确）"

# ── 通过: 清单补齐 → 告警消失 ──
printf 'run: |\n  for t in \\\n    tests/control-tower/alpha.test.sh \\\n    tests/control-tower/beta.test.sh \\\n    tests/control-tower/gamma.test.sh; do\n' > "$YML"
OUT2=$(SYNO_TESTS_DIR="$TMPD/tests" SYNO_CI_YML="$YML" bash "$CT_HEALTH" canary-drift 2>&1); rc2=$?
[ "$rc2" -eq 0 ] && echo "$OUT2" | grep -q "零漂移" && ok "清单补齐 → 零漂移 ✅" || no "补齐后仍告警: $(echo "$OUT2" | grep ⚠ | head -2)"

# ── 边界: 幽灵清单项 ──
rm "$TD/beta.test.sh"
OUT3=$(SYNO_TESTS_DIR="$TMPD/tests" SYNO_CI_YML="$YML" bash "$CT_HEALTH" canary-drift 2>&1)
echo "$OUT3" | grep -q "幽灵清单项" && echo "$OUT3" | grep -q "beta.test.sh" \
  && ok "幽灵清单项被点名（beta）" || no "幽灵项未检出"

# ── 降级: ci.yml 缺失 ──
OUT4=$(SYNO_TESTS_DIR="$TMPD/tests" SYNO_CI_YML="$TMPD/missing.yml" bash "$CT_HEALTH" canary-drift 2>&1); rc4=$?
[ "$rc4" -eq 0 ] && echo "$OUT4" | grep -q "跳过" && ok "ci.yml 缺失 → 显式跳过 + exit 0" || no "降级路径异常: rc=$rc4"

# ── 真机自检: 机制在真实仓库工作（存量漂移 47 项是 D526 要曝光的现状，非本批清理项；
#    全量密封化是 K3 P2-4 单独立项——本批只纳入 hermetic 的 synova-commit + 本测试）──
OUT5=$(bash "$CT_HEALTH" canary-drift 2>&1); rc5=$?
[ "$rc5" -eq 0 ] && ok "真机自检: exit 0（告警不阻断）" || no "真机 exit=$rc5"
if echo "$OUT5" | grep -q "::warning title=canary-drift"; then
  ok "真机自检: 存量漂移被曝光（::warning 可见——D526 交付即此可见性）"
elif echo "$OUT5" | grep -q "零漂移"; then
  ok "真机自检: 零漂移"
else
  no "真机输出异常"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
