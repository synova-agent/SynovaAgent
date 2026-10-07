#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-contract.sh — DOC-CONTRACT 三闸校验器（D1107 首版 · D1193 判据修复+接线）
#
# 契约（铁律 47 — 契约优先）:
#   @input  — 透传参数给内核 scripts/control-tower/validate_doc_contract.py
#             无参 = 只跑闸 1/2（本次变更内的决策件）
#             --staged            本地 pre-commit（git diff --cached）
#             --base <ref>        CI（git diff <ref>...HEAD；配合 SYNO_DIFF_BASE）
#             --files <路径...>   显式清单
#             --baseline          全量 tracked 文档 ⇒ 出库工作清单（只报告）
#             --all-decisions     全量决策件跑闸 1/2
#             --json              结构化输出
#   @output — 三闸逐条结论 + 违规清单（文件:行 + 原因）+ 过渡命中统计
#   @exit   — 0 = 三闸全过 / 1 = 有违规（可阻断）/ 2 = degraded（判据源读不到，fail-closed）
#   @degraded — 见 validate_doc_contract.py 契约段；**不把"读不到"当其通过**
#
# 判据来源（不发明判据，全部解析自契约机器可读块）:
#   闸 1 ← DOC-CONTRACT §2.2 模板（头三行 + 六段齐 + 状态↔目录交叉校验）
#   闸 2 ← §3 取代闸 + §2.2 取代链三步
#   闸 3 ← §3 白名单 + 阻断清单 + §9.1 过渡表（**阻断优先于白名单**，md + html 同判）
#
# 独立性声明（红线 R-6: 改门禁者不得自判通过）:
#   本件判据正确性须 K3 独立复核；作者侧仅附红/绿夹具，夹具自测 ≠ 独立验证。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# D520 清单1: PYBIN 三级探测（禁裸 python3；探存在性 + 探可用性，损坏 shim 不静默漏拦）
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（D520 清单1）
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
if [[ -z "$PYBIN" ]]; then
  echo "degraded: 未找到 python3/python/py（D520 清单1 三级探测全失败）—— 无法核三闸（fail-closed，不静默放行）" >&2
  exit 2
fi

exec "$PYBIN" "$SCRIPT_DIR/validate_doc_contract.py" --repo-root "$ROOT" "$@"
