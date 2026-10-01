#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# gen-task-board.test.sh — U7/CT-40 配对适配器（D1063）
#
# 为什么存在（不是空壳，是一条被硬编码规则逼出来的转调）:
#   `scripts/control-tower/ct-test-gate.sh:45` **硬编码**只认配对名
#   `tests/control-tower/<bn>.test.sh` —— **不认 `.test.py`**。而 gen-task-board 的真实测试
#   是 python unittest（`tests/control-tower/gen-task-board.test.py`，13 cases）。
#   ⇒ 只要 `scripts/control-tower/gen-task-board.py` 进入任何变更集，配对门禁必红；
#     本文件把它接回门禁覆盖范围。
#   🔴 门槛实测（本卡更正派单前提）:
#     $ GIT_INDEX_FILE=<仅 gen-task-board.py> bash scripts/control-tower/ct-test-gate.sh
#     ❌ 控制塔脚本测试门禁 (U7/CT-40):
#       scripts/control-tower/gen-task-board.py → 缺配对测试 tests/control-tower/gen-task-board.test.sh
#   系统性缺口（已作为独立发现上报 CTO，本卡**不改** ct-test-gate.sh）:
#     全仓 7 个 `.test.py` 对门禁不可见；`scripts/control-tower/*.py` 中 16 件无 `.test.sh`
#     （门禁只查"被改动"的脚本 ⇒ 缺口长期潜伏，谁动谁红）。
#
# 契约（铁律 47）:
#   @input  — 无参
#   @output — 子测试（python unittest）stdout/stderr 原样透传
#   @exit   — **子测试退出码原样透传**（门禁以退出码判定，见 ct-test-gate.sh:55）；
#             python 不可用 → 2（fail-closed：绝不把"跑不了"伪装成"通过"，铁律 11）
#   @cross_platform — PYBIN 三级探测（PLATFORM-CHECKLIST #1）；路径经 BASH_SOURCE 解析
#                     （跨仓库定位用 dirname 而非 $ROOT，D317）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
if [ -z "$PYBIN" ]; then
  echo "degraded: 无可用 python — 配对测试无法运行（fail-closed，不静默放行）" >&2
  exit 2
fi
exec "$PYBIN" "$HERE/gen-task-board.test.py"
