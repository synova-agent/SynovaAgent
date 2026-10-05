#!/usr/bin/env bash
# D313/D520 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# gate-hook-entry.sh — DSH hooks 登记点入口（D1163）
#
# 为什么存在: hooks.json 里的 command 越短越不容易写错；闸脚本是否就位、闸名对不对，
#   由本入口统一判定（**缺件 fail-closed**：登记点存在而闸缺失 = 门禁空转，宁红不静默）。
# 契约（铁律 47）:
#   @input  — $1 = 闸名（receipt | dispatch）; stdin = Claude Code 事件 JSON
#   @output — 透传闸脚本的 stderr（缺项清单 / 违规清单 / GATE-ERROR）
#   @exit   — 0 通过 ｜ 2 阻断（宿主方言：只有 2 阻断；闸脚本的 1 由闸内部映射为 2）
#             3 = 闸名非法或闸脚本缺失（GATE-ERROR，同样阻断，禁静默消失）
#   @env    — CLAUDE_PROJECT_DIR（桥注入；缺省回退 ${PWD}）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
WHICH="${1:-}"
DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
case "$WHICH" in
  receipt|dispatch) : ;;
  *)
    echo "GATE-ERROR: gate-hook-entry 收到未知闸名「${WHICH}」（合法值: receipt | dispatch）" >&2
    echo "           修法: 修 hooks.json 里该登记点的参数；或整体卸载（install-cto-gates.sh --uninstall）" >&2
    exit 2 ;;
esac
GATE="$DIR/scripts/control-tower/${WHICH}-gate.sh"
if [ ! -f "$GATE" ]; then
  echo "GATE-ERROR: ${WHICH} 闸脚本缺失: $GATE" >&2
  echo "           登记点存在而闸缺失 = 门禁空转 ⇒ fail-closed（不静默放行）" >&2
  echo "           修法: 确认 hooks.json 的 CLAUDE_PROJECT_DIR / projectDir 指向本仓库；" >&2
  echo "                 或 bash scripts/control-tower/install-cto-gates.sh --uninstall 卸载本闸" >&2
  exit 2
fi
exec bash "$GATE" --hook
