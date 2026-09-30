#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# pre-push-preview.sh — 推前预演（L-022「推前四件套」工具化）
#
# 为什么有它：实测 5 类 CI 红（#878/#879/#880 三 PR）**全部本地可提前发现**，
#   每轮 CI 36 分钟 × 5 轮 ≈ 3 小时空转。本脚本把那 4 件检查压到本地秒级。
#
# 用法:
#   bash scripts/workflow/pre-push-preview.sh          # 全跑（1-4）
#   bash scripts/workflow/pre-push-preview.sh --fast   # 只跑 1-3（秒级，跳过重项）
#   bash scripts/workflow/pre-push-preview.sh --list    # 只列清单
#   bash scripts/workflow/pre-push-preview.sh --strict  # 严模式：存量红也阻断（默认：存量红=警告）
#
# ⚠️ **存量红 vs 新引入**（01 号研究 §B-1「失败分类学」的应用）：
#   本脚本默认**不因"存量红"阻断**——实测 2026-10-01：3/4 夹具自测在 **main 原状**下即 ❌
#   （`GATE_INJECTION_SUMMARY: not_red=1`，g12 场景「期望红的组未红」），属**既有缺陷**，
#   非本分支引入。默认模式列出并警告；`--strict` 则一并阻断。
#
# 四件套（缺一不推）:
#   1/4 brief 可解析         scripts/workflow/check-brief-parseable.sh
#   2/4 写集一致 (D708)      scripts/control-tower/merge_writeset_gate.py
#   3/4 夹具真 MARK 三面自测  tests/control-tower/precommit-groups-injection.test.sh
#   4/4 pre-commit CI strict  SYNO_CI=1 scripts/pre-commit-check.sh
#
# ⚠️ 环境依赖（假红家族根因，2026-10-01 实测）：非交互 shell 未加载 nvm ⇒ `npx` 不在 PATH
#    ⇒ golden-case 门禁把「命令找不到」误报成「诊断质量退化解冻」。本脚本首段自动修复。
# ⚠️ 本机 macOS 无 `timeout`（命令不存在）⇒ 本脚本不依赖 timeout。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "❌ 不在 git 仓库内" >&2; exit 2; }
cd "$ROOT" || exit 2

# ── 环境修复：把任何已安装的 node bin 加进 PATH（nvm 非交互 shell 不自动加载）──
for _d in "$HOME"/.nvm/versions/node/*/bin; do
  [ -d "$_d" ] && export PATH="$_d:$PATH"
done

case "${1:-}" in
  --strict) FAST=0; STRICT=1;;
  --list)
    cat <<'LIST'
推前四件套（L-022）:
  1/4 brief 可解析          scripts/workflow/check-brief-parseable.sh
  2/4 写集一致 (D708)       scripts/control-tower/merge_writeset_gate.py
  3/4 夹具真 MARK 三面自测   tests/control-tower/precommit-groups-injection.test.sh
  4/4 pre-commit CI strict   SYNO_CI=1 scripts/pre-commit-check.sh
用法: 无参=全跑 ｜ --fast=只跑 1-3 ｜ --list=本清单
LIST
    exit 0;;
  --fast) FAST=1; STRICT=0;;
  "") FAST=0; STRICT=0;;
  *) echo "未知参数: $1（用 --list 看用法）" >&2; exit 2;;
esac

LOGDIR="${TMPDIR:-/tmp}/synova-ppp"; mkdir -p "$LOGDIR"
FAIL=0
step() {
  local name="$1"; shift
  printf '  %-24s' "$name"
  if "$@" >"$LOGDIR/${name//\//_}.log" 2>&1; then
    echo "✅"
  else
    echo "❌  → 日志: $LOGDIR/${name//\//_}.log"
    FAIL=1
  fi
}

echo "── 推前预演（L-022 四件套）── root=$ROOT"

[ -f scripts/workflow/check-brief-parseable.sh ] && \
  step "1/4 brief 可解析" bash scripts/workflow/check-brief-parseable.sh || echo "  (跳过 1/4：脚本缺失)"

[ -f scripts/control-tower/merge_writeset_gate.py ] && \
  step "2/4 写集一致" python3 scripts/control-tower/merge_writeset_gate.py || echo "  (跳过 2/4：脚本缺失)"

[ -f tests/control-tower/precommit-groups-injection.test.sh ] && \
  step "3/4 夹具自测" bash tests/control-tower/precommit-groups-injection.test.sh || echo "  (跳过 3/4：夹具缺失)"

if [ "$FAST" -eq 1 ]; then
  echo "  (--fast：跳过 4/4 pre-commit，仅 1-3)"
else
  [ -f scripts/pre-commit-check.sh ] && \
    step "4/4 pre-commit" env SYNO_CI=1 bash scripts/pre-commit-check.sh || echo "  (跳过 4/4：脚本缺失)"
fi

echo
# 存量红清单（显式、可核、可随修复移除）——2026-10-01 实测于 main 原状
KNOWN_STALE="3/4 夹具自测"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 推前预演通过 —— 可以推"
  exit 0
fi
echo "❌ 推前预演有失败项"
echo "   已知存量红（main 原状即失败，非本分支引入）：$KNOWN_STALE"
if [ "${STRICT:-0}" -eq 1 ]; then
  echo "   （--strict：存量红也阻断）"
  exit 1
fi
echo "   ⇒ 默认模式：若失败项仅属上述存量红，可继续推（其余项须修）；用 --strict 可强制阻断"
exit 1
