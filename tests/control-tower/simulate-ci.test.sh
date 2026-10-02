#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# simulate-ci.test.sh — D521/工具2: push 前 CI 等价模拟脚本
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 注入全绿桩 → exit 0
#   失败 — 注入失败桩（模拟"本地绿 CI 红"的环境差异类错误）→ exit 1 + 点名
#   降级 — pre-commit 缺失 → exit 2（D328 fail-closed，不当作通过）
#   接线 — CI 等价环境变量（SYNO_CI/SYNO_DIFF_BASE/GITHUB_ACTIONS）+ ci.yml 清单单源提取
# 沙箱: SYNO_SIM_PRECOMMIT 注入桩脚本（零真实仓库门禁执行）
# D1099: 三次调用统一 SYNO_SIM_SCOPE=smoke（② 只真跑代表样本）；清单完整性另设保值断言
#   （见下方「D1099 瘦身」三条）——本夹具自身就在 CT job 密封清单里，全跑 = 清单×清单
#   重复劳动（实测占 windows CT 腿墙钟 96%: 3474s/3607s）。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SIM="$REPO/scripts/control-tower/simulate-ci.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D521 工具2: simulate-ci ==="

# ── 接线 ──
[ -x "$SIM" ] && ok "simulate-ci.sh 存在且可执行" || no "脚本缺失/不可执行"
grep -q "SYNO_CI=1" "$SIM" && grep -q "SYNO_DIFF_BASE=origin/main" "$SIM" && grep -q "GITHUB_ACTIONS=true" "$SIM" \
  && ok "接线: CI 等价环境三件套（SYNO_CI/SYNO_DIFF_BASE/GITHUB_ACTIONS）" || no "CI 环境变量缺失"
grep -q "grep -oE 'tests/control-tower" "$SIM" \
  && ok "接线: 测试清单从 ci.yml 单源提取（不散列防漂移）" || no "清单硬编码（漂移风险）"

# ── 正常: 全绿桩 → exit 0 ──
# D563/D564 验收（2026-08-31）: 原实现把内层输出丢 /dev/null —— Windows simulate-ci 红时
#   内层失败测试名不可诊断（诊断黑洞）。改为捕获输出，失败时把内层 ❌ 行拼进断言信息，
#   CI ::error annotation 直接给出失败测试名。
GREEN_STUB="$TMPD/green.sh"; printf '#!/bin/bash\nexit 0\n' > "$GREEN_STUB"
OUT_GREEN=$(SYNO_SIM_PRECOMMIT="$GREEN_STUB" SYNO_SIM_SCOPE=smoke bash "$SIM" 2>&1); rc=$?
if [ "$rc" -eq 0 ]; then
  ok "全绿桩 → exit 0"
else
  INNER=$(echo "$OUT_GREEN" | grep -E "❌|FAIL" | tr '\n' '|' | tr -d '%' | cut -c1-400)
  no "应 exit 0, 实际 $rc :: 内层失败: ${INNER:-（无 ❌ 行，见上方输出）}"
fi

# ── 失败: 红桩 → exit 1 + 报告（环境差异类错误本地可抓）──
RED_STUB="$TMPD/red.sh"; printf '#!/bin/bash\necho "❌ 模拟 CI 差异错误 (GNU sed 类)"\nexit 1\n' > "$RED_STUB"
OUT=$(SYNO_SIM_PRECOMMIT="$RED_STUB" SYNO_SIM_SCOPE=smoke bash "$SIM" 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "红桩 → exit 1（本地抓 CI 差异类错误）" || no "应 exit 1, 实际 $rc"
echo "$OUT" | grep -q "模拟失败" && ok "失败报告含修复指引" || no "缺失败报告"

# ── 降级: pre-commit 缺失 → exit 2 ──
OUT2=$(SYNO_SIM_PRECOMMIT="$TMPD/missing.sh" SYNO_SIM_SCOPE=smoke bash "$SIM" 2>&1); rc=$?
[ "$rc" -eq 2 ] && echo "$OUT2" | grep -q "degraded" && ok "pre-commit 缺失 → exit 2 显式降级" || no "应 exit 2+degraded, 实际 $rc"

# ── D1099 瘦身: smoke 保值断言（清单不许被改小 / 必须真缩量）──
# 清单条数「独立重算」：同源 ci.yml，但用本夹具自己的命令再数一遍 —— 防 simulate-ci.sh
# 内部加 head/过滤把清单悄悄改小（那类改动会让 smoke 变成"假缩量"）。
MANIFEST_REF=$(grep -oE 'tests/control-tower/[a-z0-9-]+\.test\.sh' "$REPO/.github/workflows/ci.yml" 2>/dev/null | grep -v 'simulate-ci\.test\.sh' | sort -u | grep -c . || true)
SMOKE_SCOPE=$(echo "$OUT_GREEN" | grep -oE 'SIM_SCOPE=[a-z]+' | head -1 | cut -d= -f2)
SMOKE_TOTAL=$(echo "$OUT_GREEN" | grep -oE 'SIM_MANIFEST_TOTAL=[0-9]+' | head -1 | cut -d= -f2)
SMOKE_RUN=$(echo "$OUT_GREEN" | grep -oE 'SIM_RUN=[0-9]+' | head -1 | cut -d= -f2)
[ "$SMOKE_SCOPE" = "smoke" ] && ok "smoke 模式生效（SIM_SCOPE=smoke）" || no "SIM_SCOPE 应为 smoke, 实际 ${SMOKE_SCOPE:-（缺）}"
if [ -n "$SMOKE_TOTAL" ] && [ "$SMOKE_TOTAL" = "$MANIFEST_REF" ]; then
  ok "smoke 下清单未被改小: ${SMOKE_TOTAL} 条 = 独立重算 ${MANIFEST_REF} 条"
else
  no "清单条数不符: 脚本 ${SMOKE_TOTAL:-（缺）} vs 独立重算 ${MANIFEST_REF}"
fi
if [ -n "$SMOKE_RUN" ] && [ "$SMOKE_RUN" -ge 1 ] && [ "$SMOKE_RUN" -lt "$MANIFEST_REF" ]; then
  ok "smoke 真缩量: 真跑 ${SMOKE_RUN} 条 < 清单 ${MANIFEST_REF} 条"
else
  no "smoke 未缩量: SIM_RUN=${SMOKE_RUN:-（缺）} 清单=${MANIFEST_REF}"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
