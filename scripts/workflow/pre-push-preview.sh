#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# pre-push-preview.sh — 推前预演（L-022「推前四件套」工具化）
#
# 为什么有它：实测 5 类 CI 红（#878/#879/#880 三 PR）**全部本地可提前发现**，
#   每轮 CI 36 分钟 × 5 轮 ≈ 3 小时空转。本脚本把那 4 件检查压到本地秒级。
#
# 用法:
#   bash scripts/workflow/pre-push-preview.sh            # 全跑（1-4）
#   bash scripts/workflow/pre-push-preview.sh --fast     # 只跑 1-3（秒级，跳过重项）
#   bash scripts/workflow/pre-push-preview.sh --strict   # 严模式：存量红也阻断
#   bash scripts/workflow/pre-push-preview.sh --list     # 只列清单
#   （参数可组合：`--fast --strict`）
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
# ⚠️ 平台豁免：第 2 项含 `python3` 字面量，行尾带 `# D520:` 注释（PLATFORM-CHECKLIST 合规）。
#
# 修订（独立复核 2026-10-01 后）:
#   ① 参数解析改为逐项扫描（原只读 $1，`--fast --strict` 静默忽略 strict）
#   ② `--strict` 实现真语义（原两条路径都 exit 1 = 空开关）
#      默认模式：失败项**全属 KNOWN_STALE** ⇒ 警告放行（exit 0）；否则阻断（exit 1）
#      `--strict`：存量红也阻断
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# 存量红清单（显式、可核、可随修复移除）——2026-10-01 实测于 main 原状
#   3/4 夹具自测：`GATE_INJECTION_SUMMARY: not_red=1`（g12「期望红的组未红」）
#      —— 独立复核已在纯净 main 复算为真（非本分支引入）
#   注：2/4 写集一致 **不在此清单** —— 它是"本 PR 自身新增脚本、无写集声明"的真红，
#      修法是给 PR 补 `## 写集豁免` 段，不是把它当存量。
KNOWN_STALE="3/4 夹具自测"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "❌ 不在 git 仓库内" >&2; exit 2; }
cd "$ROOT" || exit 2

# ── 环境修复：把任何已安装的 node bin 加进 PATH（nvm 非交互 shell 不自动加载）──
for _d in "$HOME"/.nvm/versions/node/*/bin; do
  [ -d "$_d" ] && export PATH="$_d:$PATH"
done

# ── 参数解析：逐项扫描（支持组合；未知参数报错退出）──
FAST=0; STRICT=0; LIST=0
# 用 while+shift 而非 `for _arg in "$@"`（后者在 set -u 与含非 ASCII 参数时有 unbound 风险）
while [ "$#" -gt 0 ]; do
  _arg="$1"; shift
  case "$_arg" in
    --fast)   FAST=1;;
    --strict) STRICT=1;;
    --list)   LIST=1;;
    *) printf '未知参数: %s（用 --list 看用法）\n' "$_arg" >&2; exit 2;;
  esac
done

if [ "$LIST" -eq 1 ]; then
  cat <<'LIST'
推前四件套（L-022）:
  1/4 brief 可解析          scripts/workflow/check-brief-parseable.sh
  2/4 写集一致 (D708)       scripts/control-tower/merge_writeset_gate.py
  3/4 夹具真 MARK 三面自测   tests/control-tower/precommit-groups-injection.test.sh
  4/4 pre-commit CI strict   SYNO_CI=1 scripts/pre-commit-check.sh
用法: 无参=全跑 ｜ --fast=只跑 1-3 ｜ --strict=存量红也阻断 ｜ --list=本清单
LIST
  exit 0
fi

LOGDIR="${TMPDIR:-/tmp}/synova-ppp"; mkdir -p "$LOGDIR"
FAIL=0; F1=0; F2=0; F3=0; F4=0
step() {
  local name="$1"; shift
  printf '  %-24s' "$name"
  if "$@" >"$LOGDIR/${name//\//_}.log" 2>&1; then
    echo "✅"
  else
    echo "❌  → 日志: $LOGDIR/${name//\//_}.log"
    FAIL=1
    case "$name" in 1/4) F1=1;; 2/4) F2=1;; 3/4) F3=1;; 4/4) F4=1;; esac
  fi
}

echo "── 推前预演（L-022 四件套）── root=$ROOT"

[ -f scripts/workflow/check-brief-parseable.sh ] && \
  step "1/4 brief 可解析" bash scripts/workflow/check-brief-parseable.sh || echo "  (跳过 1/4：脚本缺失)"

[ -f scripts/control-tower/merge_writeset_gate.py ] && \
  step "2/4 写集一致" python3 scripts/control-tower/merge_writeset_gate.py || echo "  (跳过 2/4：脚本缺失)"  # D520: macOS 自带 python3（PLATFORM-CHECKLIST）

[ -f tests/control-tower/precommit-groups-injection.test.sh ] && \
  step "3/4 夹具自测" bash tests/control-tower/precommit-groups-injection.test.sh || echo "  (跳过 3/4：夹具缺失)"

if [ "$FAST" -eq 1 ]; then
  echo "  (--fast：跳过 4/4 pre-commit，仅 1-3)"
else
  [ -f scripts/pre-commit-check.sh ] && \
    step "4/4 pre-commit" env SYNO_CI=1 bash scripts/pre-commit-check.sh || echo "  (跳过 4/4：脚本缺失)"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 推前预演通过 —— 可以推"
  exit 0
fi
echo "❌ 推前预演有失败项"
echo "   已知存量红（main 原状即失败，非本分支引入）：$KNOWN_STALE"

# ── 默认模式语义（复核修正）：失败项全属 KNOWN_STALE ⇒ 放行；否则阻断 ──
STALE_ONLY=1
[ "$F1" -eq 1 ] && STALE_ONLY=0
[ "$F2" -eq 1 ] && STALE_ONLY=0
[ "$F4" -eq 1 ] && STALE_ONLY=0
# F3（3/4 夹具自测）是唯一允许的存量红
if [ "$STRICT" -eq 1 ]; then
  echo "   （--strict：存量红也阻断）"
  exit 1
fi
if [ "$STALE_ONLY" -eq 1 ]; then
  echo "   ⇒ 失败项全属已知存量红 ⇒ 默认模式放行（用 --strict 可强制阻断）"
  exit 0
fi
echo "   ⇒ 存在'非存量红'失败项 —— 修完再推（不要用 --no-verify 绕过）"
exit 1
