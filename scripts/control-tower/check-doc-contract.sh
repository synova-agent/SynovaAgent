#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-contract.sh — DOC-CONTRACT 三闸校验器（薄包装，内核为 python）
#
# 契约（铁律 47 — 契约优先）:
#   @input  — 透传参数；无参 = 全仓 mode（对 HEAD 新增文件跑闸 3 + 对新增决策件跑闸 1/2）
#             `--staged` = 只查暂存新增（pre-commit 用）
#             `--files a.md b.md` = 显式清单
#   @output — 逐闸结论 + 违规清单；`--json` 出结构化结果
#   @exit   — 0 = 三闸全过 / 1 = 有违规 / 2 = degraded（判据源读不到，fail-closed）
#   @degraded — 见 validate_doc_contract.py 契约段；**不把"读不到"当其通过**
#
# 背景（2026-10-01 D1098 实测缺口）:
#   契约 §3 自述「三闸（机器可核 —— 不靠自律，铁律 35）」，但全仓无执行体:
#     grep -rn "DOC-CONTRACT" --include=*.sh --include=*.py --include=*.yml scripts/ .github/ = 0
#     阳性对照: grep -rn "pre-commit-check" 同口径 = 45  ⇒ 不是 grep 坏了
#
# ⚠️ 独立性声明（红线 R-6：改门禁者不得自判通过）:
#   本件由 D1107 作者新增 ⇒ **判据正确性须 K3 独立复核**；作者侧仅附反例/阴性夹具，
#   夹具自测 **不等于** 独立验证。
#   🔴 本版 **未接入** pre-commit / CI（接线属治理线工单）—— 不声称"已执法"。
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PY=""
for cand in python3 python py; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [[ -z "$PY" ]]; then
  echo "degraded: 未找到 python3/python/py —— 无法核三闸（fail-closed，不静默放行）" >&2
  exit 2
fi

exec "$PY" "$SCRIPT_DIR/validate_doc_contract.py" --repo-root "$ROOT" "$@"
