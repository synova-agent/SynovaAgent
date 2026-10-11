#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# main-tree-guard.sh — 主树提交禁止门禁（D537 #2 收窄，D537r2）
#
# 判据（CTO 裁定 §三bis，照抄不许自改）:
#   拦   — 在主树提交: 当前仓 toplevel（pwd -P 后）== ${SYNO_MAIN_TREE}（默认 $HOME/SynovaAgent）
#   放行 — 非主树（worktree / 独立克隆）｜ 显式 SYNO_ALLOW_MAIN_TREE=1（必须留痕）
#   降级 — 不适用（本判据不依赖 session-registry）
#
# 三态退出码（ctrl-tower-change 模式 1, fail-closed）:
#   exit 0 — 放行（非主树 / CI 跳过 / 逃生舱已留痕）
#   exit 1 — 业务阻断: 在主树提交（点名「禁止在主树提交」）
#   exit 2 — 检查自身失败（toplevel 不可解析 / 留痕写失败），同样阻断
#
# 注入缝（测试沙箱，零真实主树污染）:
#   SYNO_MAIN_TREE          主树路径覆盖（默认 $HOME/SynovaAgent）
#   SYNO_CT_DIR             degraded-events.log 根覆盖（默认 <toplevel>/.codex/control-tower）
#   SYNO_BYPASS_LEDGER_DIR  bypass 台账落点目录覆盖（透传 bypass-ledger.sh）
#
# 留痕（逃生舱硬要求，铁律 11）:
#   ① degraded-events.log（真实路径 .codex/control-tower/logs/degraded-events.log）
#   ② bypass 台账（bypass-ledger.sh path 机制 → .sessions/<sid>/bypass.log）
#   任一留痕写失败 ⇒ exit 2（不许静默放行）
#
# CI 语义（§三bis②）: SYNO_CI=1 ⇒ 显式跳过并打印原因「主树判据为本地层门禁」（非静默）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# CI 层显式跳过（不是静默——打印原因）
if [ "${SYNO_CI:-0}" = "1" ]; then
  echo "main-tree-guard: SYNO_CI=1 → 跳过（主树判据为本地层门禁，CI 看不到主树上下文）"
  exit 0
fi

MAIN_TREE_CFG="${SYNO_MAIN_TREE:-$HOME/SynovaAgent}"
_TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [ -z "$_TOPLEVEL" ]; then
  echo "main-tree-guard: 检查自身失败 — git toplevel 不可解析（非 git 仓?）" >&2
  exit 2
fi
# 🔴 判据核心: 双方都 pwd -P（物理真实路径），比较的是固定主树路径，不是"当前仓 toplevel"
#   （型 B 教训: 若 _MAIN_RP 误用 toplevel 自身 ⇒ _TOP_RP 恒 == _MAIN_RP ⇒ 判据无判别力）
_TOP_RP="$(cd "$_TOPLEVEL" 2>/dev/null && pwd -P)" || _TOP_RP="$_TOPLEVEL"
_MAIN_RP="$(cd "${MAIN_TREE_CFG}" 2>/dev/null && pwd -P)" || _MAIN_RP="${MAIN_TREE_CFG}"

# 放行: 非主树（worktree / 独立克隆）
if [ "${_TOP_RP}" != "${_MAIN_RP}" ]; then
  exit 0
fi

# ── 主树 + 逃生舱 ──
if [ "${SYNO_ALLOW_MAIN_TREE:-0}" = "1" ]; then
  # 留痕①: degraded-events.log（形态对齐 pre-commit-check.sh:216 / install-hooks _degraded_log）
  _DLOG="${SYNO_CT_DIR:-${_TOPLEVEL}/.codex/control-tower}/logs/degraded-events.log"
  if ! mkdir -p "$(dirname "${_DLOG}")" 2>/dev/null; then   # swallow-ok: 失败在下行显式 exit 2（fail-closed）
    echo "main-tree-guard: 留痕失败 — 目录创建失败: $(dirname "${_DLOG}")" >&2
    exit 2
  fi
  if ! echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"component\": \"main-tree-guard\", \"reason\": \"main-tree-commit-allowed (SYNO_ALLOW_MAIN_TREE=1)\", \"path\": \"${_TOP_RP}\"}" >> "${_DLOG}" 2>/dev/null; then   # swallow-ok: 失败在下行显式 exit 2（fail-closed）
    echo "main-tree-guard: 留痕失败 — degraded-events.log 不可写: ${_DLOG}" >&2
    exit 2
  fi
  # 留痕②: bypass 台账（bypass-ledger.sh 的 path 机制 → .sessions/<sid>/bypass.log）
  # 脚本按 guard 自身位置解析（BASH_SOURCE），不依赖沙箱 toplevel 内有 scripts/
  _GUARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)" || _GUARD_DIR="$(dirname "${BASH_SOURCE[0]}")"
  _LEDGER="$(bash "${_GUARD_DIR}/bypass-ledger.sh" path 2>/dev/null)"   # swallow-ok: stderr 静音；rc 下一行显式判定（非 0 即 exit 2）
  _LEDGER_RC=$?
  if [ "${_LEDGER_RC}" -ne 0 ] || [ -z "${_LEDGER}" ]; then
    echo "main-tree-guard: 留痕失败 — bypass-ledger.sh path 解析失败 rc=${_LEDGER_RC}" >&2
    exit 2
  fi
  if ! mkdir -p "$(dirname "${_LEDGER}")" 2>/dev/null; then   # swallow-ok: 失败在下行显式 exit 2（fail-closed）
    echo "main-tree-guard: 留痕失败 — 台账目录创建失败: $(dirname "${_LEDGER}")" >&2
    exit 2
  fi
  if ! echo "$(date -Iseconds) | MAIN_TREE_BYPASS | allow=SYNO_ALLOW_MAIN_TREE | path=${_TOP_RP}" >> "${_LEDGER}" 2>/dev/null; then   # swallow-ok: 失败在下行显式 exit 2（fail-closed）
    echo "main-tree-guard: 留痕失败 — bypass 台账不可写: ${_LEDGER}" >&2
    exit 2
  fi
  echo "⚠️  main-tree-guard: 主树提交已放行（SYNO_ALLOW_MAIN_TREE=1）— 已留痕 degraded-events.log + bypass 台账"
  exit 0
fi

# 拦: 在主树提交
echo "🔴 禁止在主树提交 — 主树是共享真相源，请在独立 worktree 工作" >&2
echo "   修复: python3 ${_MAIN_RP}/scripts/control-tower/worktree-manager.py create <任务名>" >&2
echo "   逃生舱: SYNO_ALLOW_MAIN_TREE=1（显式声明，自动留痕 degraded-events.log + bypass 台账）" >&2
exit 1
