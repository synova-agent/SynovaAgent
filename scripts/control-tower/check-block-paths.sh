#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-block-paths.sh — 块级 `paths` 对账门禁（**薄壳**；CTO 裁定 074 步 1b）
#
# 🔴 **本壳零判定逻辑**（可 grep 证：无 sort / Set / 比较运算符 / 数组聚合）——
#    判定全部在 `block-paths-core.ts`（一份实现，生成器与门禁共用）。
#    壳只做三件事：① 定位仓根 ② 定位 tsx（三级探测，禁裸依赖）③ 透传退出码。
#
# 契约（铁律 47）:
#   @input  — `--source <path>`（透传给 `check-block-paths.ts`；默认 = 真源
#             `docs/synova/coordination/施工项登记.ts`）
#   @output — 透传子进程 stdout/stderr
#   @exit   — 🔴 **三态（D328）**：0 = 一致 ｜ 1 = 不一致 ｜ **2 = 判不了（fail-closed）**
#             · tsx 不可用 / 脚本缺失 / 子进程被信号杀 ⇒ **exit 2**（**禁 `|| true` 吞崩溃**）
#   @degraded — 无（fail-closed：环境失败即 2，不与"通过"混同）
#
# 历史（为什么壳里要显式接 rc）:
#   控制塔既有教训 —— `CMD="$(cmd)"; RC=$?` 在 `set -e` 下子命令失败即整步退出（#338），
#   ⇒ 本壳**不捕获输出**（直接透传），并用 `rc=$?` 显式接住，`case` 三值分流，
#     绝不出现"子命令挂了但壳返回 0"。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENTRY="$ROOT/scripts/control-tower/check-block-paths.ts"

if [ ! -f "$ENTRY" ]; then
  echo "❌ 门禁判不了（exit 2）：入口脚本缺失: ${ENTRY}" >&2
  exit 2
fi

# 🔴 运行环境定位（**两件事：tsx 与 node**；逐条给理由，配对测试的「接线」组逐条断言）
#
# ① node（先解决它，因为 tsx 是 `#!/usr/bin/env node` 的 JS 启动器）
#    判据：`node -v` **真跑一次**，不看"文件存在"——
#      D328 P1-1 的教训：`command -v` 只探存在性、不探可用性 ⇒ 损坏的 shim 会静默漏拦。
#    探测顺序：PATH → 本仓/worktree 上溯 → **$HOME/.nvm/versions/node/*/bin（版本号降序）**。
#    🔴 为什么必须有第三级（实测）：DSH 会话的 PATH **不含 nvm** ⇒
#       `node_modules/.bin/tsx` 能被执行、但它 `env node` 失败 ⇒ **exit 127**
#       （我第一版实跑就是这个错，原始输出：`env: node: No such file or directory`）。
NODE_BIN_DIR=""
if command -v node >/dev/null 2>&1 && [ "$(node -v 2>/dev/null || true)" != "" ]; then
  NODE_BIN_DIR="$(cd "$(dirname "$(command -v node)")" && pwd)"
else
  _probe="$ROOT"
  for _i in 1 2 3 4 5; do
    _probe="$(dirname "$_probe")"
    if [ -x "$_probe/node_modules/.bin/tsx" ]; then
      # worktree 布局：主仓根的 .bin 里通常有 node 的影子（npm 会放）
      if [ -x "$_probe/node_modules/.bin/node" ]; then NODE_BIN_DIR="$_probe/node_modules/.bin"; break; fi
    fi
    [ "$_probe" = "/" ] && break
  done
fi
if [ -z "$NODE_BIN_DIR" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  # 版本号降序取第一个可用（`sort -V` 是 GNU 扩展 ⇒ 用 BSD/GNU 都支持的 sort -r 后逐个人肉比较）
  for _nbin in $(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -r || true); do
    if [ -x "$_nbin/node" ] && [ "$("$_nbin/node" -v 2>/dev/null || true)" != "" ]; then
      NODE_BIN_DIR="$_nbin"; break
    fi
  done
fi
if [ -z "$NODE_BIN_DIR" ]; then
  echo "❌ 门禁判不了（exit 2）：找不到可用的 node（已试 PATH / 仓根上溯 / \$HOME/.nvm/versions/node/*/bin）" >&2
  echo "   ⇒ fail-closed：环境缺依赖时**不许**当作通过（禁 '|| true' 吞崩溃）" >&2
  exit 2
fi
PATH="${NODE_BIN_DIR}:${PATH}"

# ② tsx（优先级：测试注入缝 → 本仓 → PATH（CI runner 的 nvm 布局走这条）→ 上溯 5 级）
#    🔴 上溯的理由（实测）：git worktree 共用主仓 `.git` 但**不共用 node_modules**
#       ⇒ 在 `.synova-wt-*/` worktree 里跑本壳时 `$ROOT/node_modules/.bin/tsx` 不存在，而主仓根有。
TSX=""
for _cand in \
  "${SYNO_TSX:-}" \
  "$ROOT/node_modules/.bin/tsx" \
  "$(command -v tsx 2>/dev/null || true)"
do
  if [ -n "${_cand}" ] && [ -x "${_cand}" ]; then TSX="${_cand}"; break; fi
done
if [ -z "${TSX}" ]; then
  _probe="$ROOT"
  for _i in 1 2 3 4 5; do
    _probe="$(dirname "$_probe")"
    if [ -x "$_probe/node_modules/.bin/tsx" ]; then TSX="$_probe/node_modules/.bin/tsx"; break; fi
    [ "$_probe" = "/" ] && break
  done
fi
if [ -z "${TSX}" ]; then
  echo "❌ 门禁判不了（exit 2）：找不到 tsx（试过 \$SYNO_TSX / ${ROOT}/node_modules/.bin/tsx / PATH / 上溯 5 级）" >&2
  echo "   ⇒ fail-closed：环境缺依赖时**不许**当作通过（禁 '|| true' 吞崩溃）" >&2
  exit 2
fi

# 证可用性：tsx 真跑一次版本（不是只看文件存在）——D328 P1-1 同源
if [ "$("${TSX}" --version 2>/dev/null || true)" = "" ]; then
  echo "❌ 门禁判不了（exit 2）：tsx 存在但**跑不起来**（${TSX}）—— 存在性≠可用性（D328 P1-1）" >&2
  exit 2
fi

"${TSX}" "$ENTRY" "$@"
rc=$?

case "$rc" in
  0) echo "  ✅ 块级 paths 对账（exit 0：一致）" ;;
  1) echo "  🔴 块级 paths 对账（exit 1：不一致 —— 快照已过时，见上方差集）" >&2 ;;
  *) echo "  🔴🔴 块级 paths 对账**判不了**（exit ${rc}：环境/形状失败）—— fail-closed，不作为通过" >&2
     exit 2 ;;
esac
exit "$rc"
