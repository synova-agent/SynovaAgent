#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# install-squad-lead.sh — 安装 synova-squad-lead 预设（D945: 改走 **bundle 层**）
#
# 迁移（D945，CTO 批准）: 本脚本原先把 legacy `synova-cto/agent.cordis.yml` 当组成模板、
#   用仓库 SYSTEM-PROMPT.md 替换 persona 行，再写 `$HOME/.dsh/.agent-presets/synova-squad-lead/`
#   —— 手工路径 + 仓库外产物 = 多机漂移源；且 D931 修复（legacy `delegation` 组 →
#   `agent-team` + `tool-agent-team` + `ui-agent-team`）只在脚本内存里做，不入库、不可复现。
#
#   现在: 单一入口 = `scripts/control-tower/install-dsh-preset.sh`，载体 = profile 的
#   **bundle 层**（node_modules/@local/dsh-preset-synova-squad-lead/ + dsh.profile.bundles 声明），
#   源 = 仓库 `docs/synova/presets/synova-squad-lead/{package.json,cordis.patch.yml}`（入库、
#   可 PR 评审、可 `check-preset-bundles.sh --emit` 逐字节复现）。
#
# 契约（铁律 47）:
#   @input  — [--check]           缺省 install；--check 只校验不落位
#             [--repo <path>]     仓库根（默认 = 本脚本上溯两级）
#             [--legacy]          **已废弃**（旧 legacy 落位路径）→ 提示 + exit 2
#   @output — 透传 install-dsh-preset.sh 的判定位（INSTALLED: / SYNC-OK: / INSTALL-DRIFT:
#             / LEGACY-PRESENT: / degraded:）
#   @exit   — 0 = 落位成功 / 一致；1 = 漂移或目标不可满足；2 = 降级或执行失败（D328 三态）
#   @degraded — 由 install-dsh-preset.sh 写 degraded-events.log 五字段（本层不重复实现）
#   @error  — 不抛异常给调用方；全部经退出码表达
#
# 本脚本**不写** `$HOME/.agent-presets/**`（旧载体已废弃）；也**不删除**既有 legacy 目录
#   （删目录不在 D945-A 授权内；收口判红由 check-preset-bundles.sh --consistency 负责）。
# 用法: bash docs/synova/presets/install-squad-lead.sh [--check] [--repo <path>]
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ARG=""
CHECK_ONLY="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK_ONLY="yes" ;;
    --repo) REPO_ARG="${2:-}"; shift ;;
    --legacy)
      echo "DEPRECATED: --legacy 已废弃（D945: 预设落位改走 bundle 层；不再写 .agent-presets/）" >&2
      echo "  替代: 直接运行（bundle 层落位）或 --check（只校验）" >&2
      exit 2 ;;
    -h|--help)
      echo "用法: $0 [--check] [--repo <path>]   （--legacy 已废弃，调用即 exit 2）"
      exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -n "$REPO_ARG" ]; then
  REPO_DIR="$(cd "$REPO_ARG" && pwd)"
else
  REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

INSTALLER="$REPO_DIR/scripts/control-tower/install-dsh-preset.sh"
if [ ! -f "$INSTALLER" ]; then
  echo "degraded: bundle 安装器缺失: $INSTALLER（D945 后单一口径是 install-dsh-preset.sh）" >&2
  exit 2
fi

MODE="--install"
[ "$CHECK_ONLY" = "yes" ] && MODE="--check"

echo "install-squad-lead: 载体 = bundle 层（legacy 已废弃）→ install-dsh-preset.sh $MODE synova-squad-lead" >&2
bash "$INSTALLER" "$MODE" synova-squad-lead
RC=$?
if [ "$RC" -eq 0 ] && [ "$CHECK_ONLY" = "no" ]; then
  echo "✅ 落位完成：重启 DSH 后在选择器里选 🎽 Synova 小队队长"
fi
exit "$RC"
