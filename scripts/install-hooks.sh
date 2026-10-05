#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# install-hooks.sh — D318 双机 Git Hooks 安装脚本
#
# 用法: bash scripts/install-hooks.sh
#
# 作用:
#   将 .git/hooks/ 中的 git hook 设为从仓库内脚本加载，全部 toplevel-relative
#   可移植（Windows + Mac 同一脚本，无绝对路径硬编码）。
#
# install_hook 双模式（按 name 分派）:
#   entry   — scripts/<name>-check.sh 门禁入口（pre-commit / pre-push / commit-msg）
#   tracked — scripts/hooks/<name>.sh 逻辑（post-commit）
#
# 包装器统一 `bash "$(git rev-parse --show-toplevel)/..."` 运行时求值:
#   旧版写死 $ROOT 绝对路径（post-commit 包装器为 Windows 盘符路径残留）→ Mac 必挂。
#   $() 在运行时展开 → 克隆到任何机器路径均可用。
#
# pre-commit 包装器保留"双日志分离 + 成功标记"三段逻辑:
#   失败 → 写 .claude/pre-commit-failures.log；成功 → 写 .claude/last-precommit-success。
#   post-commit.sh 靠 marker 检测 --no-verify 绕过（V4.5.1 核心机制，不可丢）。
#
# synova-commit alias: Windows 用 Git bash.exe 绝对路径；Mac/Linux 用 bash（PATH）。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "=== SynovaAgent D318 Git Hooks 安装（双机可移植）==="
mkdir -p "$ROOT/scripts/hooks"

install_hook() {
  local name="$1"
  local entry="$ROOT/scripts/${name}-check.sh"
  local tracked="$ROOT/scripts/hooks/${name}.sh"
  local target="$ROOT/.git/hooks/$name"
  local body
  if [ "$name" = "pre-commit" ] && [ -f "$entry" ]; then
    # 双日志分离 + 成功标记（V4.5.1 核心，post-commit 检测 --no-verify 依赖 marker）
    # 方案1(挪CI, D468): 本地门禁软提示——失败不阻断，CI 权威（merge 前必须绿）
    body='#!/bin/bash
# v4.8.x 方案1(挪CI): pre-commit 软提示 — 本地门禁失败不阻断，CI 权威
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
bash "$ROOT/scripts/pre-commit-check.sh"
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$EXIT_CODE branch=$(git branch --show-current 2>/dev/null || echo unknown)" >> "$ROOT/.claude/pre-commit-failures.log"
  # 软提示: 记录门禁失败但放行（K3 审计证据），CI 权威判定
  # D508/Win#10: 软门禁噪声移出 bypass.log（证据链只记真实提交/绕过；软告警独立日志——
  #   否则每次 commit 污染 bypass.log → 下次操作前必 checkout 清理，实测 10+ 次）
  echo "$(date -Iseconds) | GATE_FAIL_SOFT | exit=$EXIT_CODE | branch=$(git branch --show-current 2>/dev/null || echo unknown)" >> "$ROOT/.claude/gate-soft-warnings.log"
  echo "⚠️ 本地门禁未通过（exit=$EXIT_CODE）— 已放行，CI 将作为权威判定（merge 前必须绿）" >&2
fi
# 无论成败都写 marker（失败但放行 = 经过了 pre-commit，非 --no-verify）
echo "$(git rev-parse HEAD 2>/dev/null || true)|$(date +%s)" > "$ROOT/.claude/last-precommit-success"
exit 0'
  elif [ -f "$entry" ]; then
    # 门禁入口（commit-msg 需 "$1" 提交信息文件；pre-push 需 "$1" remote 名 "$2" url —
    # D334 多机同步检查要 fetch 目标 remote；hook stdin refs 透传）
    if [ "$name" = "commit-msg" ]; then
      body='#!/bin/bash
bash "$(git rev-parse --show-toplevel)/scripts/commit-msg-check.sh" "$1"'
    elif [ "$name" = "pre-push" ]; then
      body='#!/bin/bash
bash "$(git rev-parse --show-toplevel)/scripts/pre-push-check.sh" "$1" "$2"'
    else
      body='#!/bin/bash
bash "$(git rev-parse --show-toplevel)/scripts/'"$name"'-check.sh"'
    fi
  elif [ -f "$tracked" ]; then
    # hooks/ 逻辑入口（post-commit）
    body='#!/bin/bash
exec bash "$(git rev-parse --show-toplevel)/scripts/hooks/'"$name"'.sh"'
  else
    echo "  !! $name 无入口（$entry / $tracked）— 跳过"
    return
  fi
  printf '%s\n' "$body" > "$target"
  chmod +x "$target"
  echo "  ✅ $name"
}

# ═══ D540: 降级记录（degraded-events.log，铁律 11 不静默）═══
_degraded_log() {
  # 契约(铁律 47): @input $1=component $2=reason; @output append degraded-events.log;
  #               @degraded 写失败静默（降级记录失败不阻断脚本，铁律 31）
  local comp="$1" reason="$2"
  local dlog="${SYNO_CT_DIR:-$ROOT/.codex/control-tower}/logs/degraded-events.log"
  mkdir -p "$(dirname "$dlog")" 2>/dev/null || true  # swallow-ok: 目录创建失败不阻断
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"$comp\", \"reason\": \"$reason\"}" >> "$dlog" 2>/dev/null || true  # swallow-ok: 降级记录失败不阻断
}

# D540: clone 环境 git 配置初始化（幂等）——影子提交前置（post-commit.sh L87 降级路径堵漏）
# 仅在 local 未设时写默认；已设则不覆盖（尊重已有配置，主仓重复跑无害）。
_ensure_clone_git_config() {
  # 契约(铁律 47):
  #   @input  — $ROOT（仓库根）+ env: SYNO_GIT_NAME(默认 synova-mac) / SYNO_GIT_EMAIL(默认 claworg@users.noreply.github.com)
  #             / SYNO_GIT_CREDENTIAL_HELPER(默认 osxkeychain)
  #   @output — user.name/user.email 已设（local 未设则写 local；local 已有则跳过不覆盖）;
  #             core.quotepath=false; credential.helper（若 local 未设）
  #   @degraded — 任一 git config 写入失败 → degraded 记录（铁律 11），不阻断 hooks 安装
  #   @error  — 不抛（bash 函数，配置失败返回非 0 由调用方处理）
  local name="${SYNO_GIT_NAME:-synova-mac}"
  local email="${SYNO_GIT_EMAIL:-claworg@users.noreply.github.com}"
  local degraded=0
  # user.name / user.email —— 影子提交（post-commit.sh L84 git commit）的前置，缺失 → L87 降级
  if ! git -C "$ROOT" config --local user.name >/dev/null 2>&1; then
    git -C "$ROOT" config --local user.name "$name" || degraded=1
  fi
  if ! git -C "$ROOT" config --local user.email >/dev/null 2>&1; then
    git -C "$ROOT" config --local user.email "$email" || degraded=1
  fi
  # core.quotepath=false —— 中文文件名不被转义（D339 synova-commit 同款）
  git -C "$ROOT" config --local core.quotepath false || degraded=1
  # credential.helper —— push 凭据；local 未设才配（已有则不动，尊重 token）
  if ! git -C "$ROOT" config --local credential.helper >/dev/null 2>&1; then
    git -C "$ROOT" config --local credential.helper "${SYNO_GIT_CREDENTIAL_HELPER:-osxkeychain}" 2>/dev/null || degraded=1
  fi
  if [ "$degraded" -ne 0 ]; then
    echo "  ⚠️  部分 git 配置写入失败 — 影子提交/中文文件名/push 可能降级 (degraded)" >&2
    _degraded_log "install-hooks.clone-config" "git config 写入部分失败 (degraded=$degraded)"
  fi
  echo "  ✅ clone git 配置初始化 — user=$name <$email> / quotepath=false / credential.helper"
}

install_hook "pre-commit"
install_hook "commit-msg"
install_hook "pre-push"
install_hook "post-commit"

# D540: clone 环境 git 配置初始化（在装完 hooks 后调用）——影子提交前置（post-commit.sh L87 降级路径堵漏）
# 幂等: 在 clone 与主仓重复运行均无害（local 已设 -> 跳过不覆盖）。
_ensure_clone_git_config

# CT-47 / D457 + D1145: 注册 union 合并驱动
# 🔴 D1145 变更: `.claude/bypass.log` 已**停跟踪**（.gitignore）⇒ 它不再是 union 的适用对象。
#   本驱动仍保留，因为 `.claude/reference-map.md`（CT-48/D508）仍声明 `merge=union`。
#   幂等: 重复运行 set 覆盖，无害。
git config merge.union.driver "git merge-file --union %A %O %B" 2>/dev/null || true  # swallow-ok: git config 失败=非 git 仓库/只读, 降级不阻断
echo "  ✅ git config merge.union.driver — reference-map.md 自动合并（bypass.log 已停跟踪，不再适用）"

# D515 项8: git 网络韧性（Codex P9）— 30s 低于 1KB/s 即断，快速失败。
# 幂等: 重复运行 set 覆盖，无害。慢连接被快速断开后建议直接重试 push。
git config http.lowSpeedLimit 1000 2>/dev/null || true  # swallow-ok: 非 git 仓库/只读降级不阻断
git config http.lowSpeedTime 30 2>/dev/null || true
echo "  ✅ git config http.lowSpeedLimit/Time — 慢连接 30s 快速失败"

# D201-FIX: 安装 synova-commit git alias（commit gatekeeper）
SYNOVA_COMMIT="$ROOT/scripts/control-tower/synova-commit"
if [ -f "$SYNOVA_COMMIT" ]; then
  # Windows 需要 bash.exe 绝对路径；Linux/macOS 直接用 bash
  if [ -f "/c/Program Files/Git/bin/bash.exe" ]; then
    BASH_PATH="C:\Program Files\Git\bin\bash.exe"
  elif command -v bash >/dev/null 2>&1; then
    BASH_PATH="bash"
  else
    echo "  ⚠️  bash 未找到 — 跳过 synova-commit 安装"
    exit 0
  fi
  git config alias.synova-commit "!\"$BASH_PATH\" \"$SYNOVA_COMMIT\""
  echo "  ✅ git alias synova-commit — bash=$BASH_PATH"
else
  echo "  ⚠️  synova-commit 不存在: $SYNOVA_COMMIT"
fi

echo ""
echo "✅ 安装完成。当前 hooks:"
ls -la "$ROOT/.git/hooks/" | grep -v ".sample"
