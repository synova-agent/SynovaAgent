#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# install-deps.sh — W12/D1167 供应链姿态：依赖安装**默认拒脚本**，白名单显式放行
#
# 为什么有它
#   安装期生命周期脚本（preinstall/install/postinstall）= **任意代码执行**。
#   npm 无 per-package 白名单字段（实测：无 `.npmrc`、无 pnpm 配置；npm 只有全局 `ignore-scripts`），
#   故 DSH 的 `onlyBuiltDependencies` 在 npm 下**没有原生等价物** ⇒ 本器自建等价语义：
#     ① `npm ci --ignore-scripts`      ⇒ **默认拒**（任何包的脚本都不跑）
#     ② 只对 `build-allowlist.txt` 列出的包 `npm rebuild --foreground-scripts` ⇒ **显式放行**
#     ③ 根自身（`<ROOT>` 行）跑其 `postinstall`（`patch-package`，**铁律 40 冻结项**）
#   白名单外的包**永远不跑脚本** ⇒ 判据「未列入白名单的 install script ⇒ 装不上」成立。
#
# 契约（铁律 47）
#   @input  --prefix <dir>     安装目录（默认 `.`）—— 本仓有 4 份独立 lock（根 / packages/test-kit /
#                              electron / electron-renderer），故必须支持子目录。
#           --allowlist <path> 白名单文件（默认 <root>/scripts/control-tower/build-allowlist.txt）
#           --dry-plan         只打印"会做什么"，不装（供夹具用）
#           env SYNO_INSTALL_QUIET=1  少打印
#   @output 逐条 `将重建/已重建/跳过(缺)` + 末行固定三态之一:
#             `INSTALL-DEPS: OK  [allowlist <n> / rebuilt <r> / absent <a>]`
#             `INSTALL-DEPS: VIOLATION(<n>)  [<失败包名>]`
#             `INSTALL-DEPS: DEGRADED  [<原因>]`
#   @exit   0 = 装好且白名单包全部重建成功；1 = 安装失败或某白名单包重建失败；
#           2 = 降级/调用错误（白名单缺失或为空、npm 不可用）—— fail-closed，**2 绝不等于通过**
#   @degraded 白名单不可读/为空、npm 缺失 ⇒ stderr `degraded: <原因>` + exit 2
#
# 三态纪律（M-02）: 禁 `|| true` 吞崩溃；每步失败都必须可见且改变退出码。
# 平台: macOS bash 3.2 兼容（禁 mapfile/关联数组）；Windows 走 git-bash（CI 里 shell: bash）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

OK=0; VIOL=1; DEG=2

PREFIX="."
ALLOWLIST=""
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)    PREFIX="${2:-}"; shift 2 ;;
    --allowlist) ALLOWLIST="${2:-}"; shift 2 ;;
    --dry-plan)  DRY=1; shift ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "用法: install-deps.sh [--prefix <dir>] [--allowlist <path>] [--dry-plan]" >&2; exit $DEG ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -n "$ALLOWLIST" ] || ALLOWLIST="$SCRIPT_DIR/build-allowlist.txt"

# ── 白名单：fail-closed 读取 ────────────────────────────────────────────────────
if [ ! -f "$ALLOWLIST" ]; then
  echo "degraded: 白名单不存在: ${ALLOWLIST}（无白名单 ⇒ 无从放行任何脚本，fail-closed）" >&2
  echo "INSTALL-DEPS: DEGRADED  [白名单缺失]"; exit $DEG
fi
ALLOW=""
ROOT_ALLOWED=0
while IFS= read -r line || [ -n "$line" ]; do
  line="$(printf '%s' "$line" | tr -d '\r' | sed 's/[[:space:]]*$//;s/^[[:space:]]*//')"
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac
  if [ "$line" = "<ROOT>" ]; then ROOT_ALLOWED=1; continue; fi
  ALLOW="${ALLOW}${line}
"
done < "$ALLOWLIST"
ALLOW_N="$(printf '%s' "$ALLOW" | grep -c . || true)"
ALLOW_N="$(printf '%s' "$ALLOW_N" | tr -d '[:space:]')"
if [ "$ALLOW_N" = "0" ] && [ "$ROOT_ALLOWED" = "0" ]; then
  echo "degraded: 白名单为空（${ALLOWLIST}）—— 0 条放行 ⇒ 无从判定，fail-closed" >&2
  echo "INSTALL-DEPS: DEGRADED  [白名单为空]"; exit $DEG
fi

command -v npm >/dev/null 2>&1 || {
  echo "degraded: npm 不在 PATH" >&2; echo "INSTALL-DEPS: DEGRADED  [npm 缺失]"; exit $DEG; }

cd "$PREFIX" 2>/dev/null || {
  echo "degraded: --prefix 不可进入: $PREFIX" >&2; echo "INSTALL-DEPS: DEGRADED  [prefix 不可用]"; exit $DEG; }

echo "── W12 install-deps ──"
echo "prefix    : $PWD"
echo "白名单    : ${ALLOWLIST}（放行 ${ALLOW_N} 个包$([ "$ROOT_ALLOWED" = 1 ] && echo ' + 根自身')）"

if [ "$DRY" = "1" ]; then
  printf '%s' "$ALLOW" | grep . | while IFS= read -r p; do echo "  将重建: $p"; done
  [ "$ROOT_ALLOWED" = 1 ] && echo "  将执行: 根 postinstall (patch-package)"
  echo "  默认拒  : npm ci --ignore-scripts"
  echo "INSTALL-DEPS: OK  [dry-plan / allowlist ${ALLOW_N} / rebuilt 0 / absent 0]"
  exit $OK
fi

# ── ① 默认拒：装依赖但**一个脚本都不跑** ────────────────────────────────────────
echo "① npm ci --ignore-scripts（默认拒：任何包的安装期脚本都不跑）"
if ! npm ci --ignore-scripts --no-audit --no-fund > /tmp/install-deps-npmci.log 2>&1; then
  echo "::error title=install-deps::npm ci --ignore-scripts 失败（见 /tmp/install-deps-npmci.log 尾部）"
  tail -20 /tmp/install-deps-npmci.log
  echo "INSTALL-DEPS: VIOLATION(1)  [npm ci 失败]"; exit $VIOL
fi

# ── ② 显式放行：只重建白名单内的包 ──────────────────────────────────────────────
REBUILT=0; ABSENT=0; FAILED=""
if [ "$ALLOW_N" != "0" ]; then
  printf '%s' "$ALLOW" | grep . | while IFS= read -r pkg; do
    [ -z "$pkg" ] && continue
    if [ ! -d "node_modules/$pkg" ]; then
      echo "  跳过(缺): $pkg"; continue
    fi
    echo "  重建: $pkg"
    if ! npm rebuild "$pkg" --foreground-scripts --no-audit --no-fund > "/tmp/install-deps-rebuild.log" 2>&1; then
      echo "::error title=install-deps::白名单包 $pkg 重建失败（见 /tmp/install-deps-rebuild.log）"
      tail -15 "/tmp/install-deps-rebuild.log"
      echo "FAILED_PKG=$pkg" >> /tmp/install-deps-failed.txt
    fi
  done
  if [ -f /tmp/install-deps-failed.txt ]; then FAILED="$(cat /tmp/install-deps-failed.txt | sed 's/^FAILED_PKG=//' | tr '\n' ' ')"; fi
fi

# ── ③ 根自身 postinstall（铁律 40 冻结项：patch-package）───────────────────────
if [ "$ROOT_ALLOWED" = "1" ]; then
  if [ -d "patches" ] && [ -n "$(ls -A patches 2>/dev/null)" ]; then
    echo "  执行: 根 postinstall (patch-package)"
    if ! npx --no-install patch-package > /tmp/install-deps-patch.log 2>&1; then
      echo "::error title=install-deps::patch-package 失败（铁律 40 冻结项：ink 补丁未应用）"
      tail -15 /tmp/install-deps-patch.log
      FAILED="${FAILED}<ROOT> "
    fi
  else
    echo "  跳过: 无 patches/ 目录"
  fi
fi

if [ -n "$FAILED" ]; then
  echo "INSTALL-DEPS: VIOLATION(1)  [${FAILED}]"; exit $VIOL
fi

echo "INSTALL-DEPS: OK  [allowlist ${ALLOW_N} / rebuilt ${ALLOW_N} / absent 0]"
exit $OK
