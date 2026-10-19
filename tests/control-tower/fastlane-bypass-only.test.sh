#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# fastlane-bypass-only.test.sh — D515 项2: 纯补记提交快速通道
#
# 覆盖矩阵:
#   正常 — SYNO_FASTLANE=1 → 仅 Secrets、跳过 12 组、exit 0、<10s（D563/D564 验收发现：3s 对负载机器/模拟冷沙箱过脆，实测 4s；断言意图=快于原 90-120s，10s 仍严格证明）
#   防绕过 — 判定只认环境变量（synova-commit export），不裸看暂存区（D414 坑）
#   接线 — synova-commit --files 唯一 bypass.log → export SYNO_FASTLANE=1
# 沙箱: 本仓库 dry 运行（无副作用——快速通道在组 1 前退出，不改暂存区）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PC="$REPO/scripts/pre-commit-check.sh"
SC="$REPO/scripts/control-tower/synova-commit"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "=== D515 项2: 纯补记快速通道 ==="

# ── 接线: synova-commit 侧判定（--files 唯一且为 bypass.log → export）──
grep -q 'SYNO_FASTLANE=1' "$SC" && grep -q '\${FILES\[0\]}.*bypass.log' "$SC" \
  && ok "接线: synova-commit --files 唯一 bypass.log → SYNO_FASTLANE=1" || no "synova-commit 判定缺失"
grep -q 'D414' "$PC" && ok "防绕过注释: 不裸看暂存区（D414 坑）已记录" || no "D414 坑注释缺失"

# ── 正常: SYNO_FASTLANE=1 → 快速通道 exit 0 且跳过 12 组 ──
# GATEKEEPER 用 SYNO_GATEKEEPER_ACK=1 防 bypass.log 历史记录干扰；并行告警关闭。
T0=$(date +%s)
OUT=$(SYNO_FASTLANE=1 SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
  SYNO_GATE_HITS_LOG="$(mktemp)" bash "$PC" 2>&1); rc=$?
T1=$(date +%s); DUR=$((T1 - T0))
[ "$rc" -eq 0 ] && ok "快速通道: exit 0" || no "应 exit 0, 实际 $rc"
echo "$OUT" | grep -q "V5 纯补记快速通道" && ok "输出含快速通道横幅" || no "缺快速通道横幅"
echo "$OUT" | grep -q "跳过 12 组" && ok "横幅明示跳过 12 组" || no "横幅未明示跳过组数"
if echo "$OUT" | grep -q "组 1:"; then no "不应跑组 1（性能未达标）"; else ok "全组跳过（未输出 组 1:）"; fi
[ "$DUR" -lt 10 ] && ok "耗时 ${DUR}s < 10s（原 90-120s）" || no "耗时 ${DUR}s ≥ 10s"

# ── 防绕过: 未设 SYNO_FASTLANE 时不看暂存区自行判定（结构断言）──
if grep -A2 'SYNO_FASTLANE:-0' "$PC" | grep -q 'diff --cached'; then
  no "快速通道判定裸看暂存区（D414 误触发风险）"
else
  ok "判定只认环境变量，无暂存区猜测"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
