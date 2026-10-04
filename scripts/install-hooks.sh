#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# install-hooks.sh — D318 双机 Git Hooks 安装脚本
#
# 用法: bash scripts/install-hooks.sh [--dry-run] [--help]
#
# 作用:
#   将 hooks 目录中的 git hook 设为从仓库内脚本加载，全部 toplevel-relative
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
#
# ═══ #1024 安全化（D1142）—— 三条改动，动机逐条在站点注释里 ═══
#   ① hooks 目录改由 `git rev-parse --git-path hooks` 解析（不再写死 $ROOT/.git/hooks）:
#      worktree 里 $ROOT/.git 是**文件**（gitdir 指针）⇒ 旧写法重定向必失败（脚本半途而废）；
#      且真正生效的 hooks 目录 = 共享 git dir（core.hooksPath 或 $GIT_COMMON_DIR/hooks）
#      ⇒ 必须**显式告知**：在 worktree 里跑本脚本 = 改全队共用的 hooks（不是本 worktree 私有）。
#   ② 幂等合并 + 外来内容自动备份（旧: `printf > target` 无条件覆盖，手改的 hook 静默丢失）。
#      生成的 hook 带 `generated-by` 标记；目标无标记（= 人工/他人内容）⇒ 先 `cp` 备份再写。
#   ③ 4 处 git config 全部加 `--local`（旧: 无 scope 参数 ⇒ 由 git 自行决定落点）。
#      ⚠️ 如实声明：`--local` 写的是**仓库级配置**；在 worktree 里该文件由所有 worktree 共享
#      ⇒ 仍是"改动面 = 全仓"，但**落点确定**（不会因 GIT_CONFIG_GLOBAL/环境漂到全局）。
#   另: aliases 的路径改为**调用时求值** `$(git rev-parse --show-toplevel)`，
#      避免把"我这份 worktree 的绝对路径"写进共享 config 覆盖别人。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      cat <<'USAGE'
用法: bash scripts/install-hooks.sh [--dry-run]
  --dry-run  只报告将要写入/备份的 hook 与配置，不落盘
说明: hooks 目录由 `git rev-parse --git-path hooks` 解析；在 worktree 中该目录为全仓共享。
USAGE
      exit 0 ;;
    *) echo "未知参数: ${1:-}" >&2; exit 2 ;;
  esac
  shift
done
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOKS_DIR="$(git -C "$ROOT" rev-parse --git-path hooks 2>/dev/null || echo "$ROOT/.git/hooks")"
case "$HOOKS_DIR" in /*) : ;; *) HOOKS_DIR="$ROOT/$HOOKS_DIR" ;; esac
GIT_DIR_ABS="$(git -C "$ROOT" rev-parse --git-dir 2>/dev/null || echo "")"
GIT_COMMON_ABS="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || echo "")"

echo "=== SynovaAgent D318 Git Hooks 安装（双机可移植）==="
echo "  hooks 目录: $HOOKS_DIR"
if [ -n "$GIT_DIR_ABS" ] && [ "$GIT_DIR_ABS" != "$GIT_COMMON_ABS" ]; then
  echo "  ⚠️ 当前在 linked worktree（git-dir=${GIT_DIR_ABS}）—— hooks 目录为**全仓共享**："
  echo "     本次安装/覆盖会影响所有 worktree 与并行 session（不是本树私有）。"
fi
[ "$DRY_RUN" = "1" ] && echo "  （--dry-run: 只报告，不落盘）"
mkdir -p "$HOOKS_DIR" 2>/dev/null || true   # swallow-ok: 已存在=正常；建不出时下方写入会显式报错
mkdir -p "$ROOT/scripts/hooks"

install_hook() {
  local name="$1"
  local entry="$ROOT/scripts/${name}-check.sh"
  local tracked="$ROOT/scripts/hooks/${name}.sh"
  local target="$HOOKS_DIR/$name"
  local body tmp
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
  echo "⚠️ 本地门禁未通过（exit=${EXIT_CODE}）— 已放行，CI 将作为权威判定（merge 前必须绿）" >&2
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
    echo "  !! ${name} 无入口（${entry} / ${tracked}）— 跳过"
    return
  fi
  # #1024 ②: 幂等 + 外来内容备份（旧写法 `printf > target` 无条件覆盖，手改/hook 静默丢失）
  tmp="$(mktemp)"
  printf '%s\n' "# generated-by: scripts/install-hooks.sh — 门禁包装器（手改会被下次安装覆盖；如需本地定制请改用 scripts/ 内脚本）" "$body" > "$tmp"
  # ⚠️ 变量边界（D370 教训，本卡自身两次踩中）: 中文全角括号紧贴 `$VAR` 会被 bash 并进变量名
  #   ⇒ set -u 下 unbound variable（且只在特定分支触发）。本函数内一律写 `${VAR}` 显式边界。
  local same=0 is_foreign=0
  if [ -f "$target" ]; then
    if cmp -s "$tmp" "$target"; then
      same=1
    elif ! grep -q 'generated-by: scripts/install-hooks.sh' "$target" 2>/dev/null; then
      is_foreign=1
    fi
  fi
  if [ "$DRY_RUN" = "1" ]; then
    if [ "$same" = "1" ]; then
      echo "  [dry-run] ${name}: 内容已一致（将不重写，不落盘）"
    elif [ "$is_foreign" = "1" ]; then
      echo "  [dry-run] ${name}: 目标为人工/外来内容 ⇒ 将先备份再写入（不落盘）"
    else
      echo "  [dry-run] ${name}: 将写入标准包装器（$(wc -c < "$tmp" | tr -d ' ') 字节，不落盘）"
    fi
    rm -f "$tmp"
    return 0
  fi
  if [ "$same" = "1" ]; then
    echo "  = ${name}（内容已一致，未重写）"
    rm -f "$tmp"
    return 0
  fi
  if [ "$is_foreign" = "1" ]; then
    local bak="${target}.bak.$(date +%Y%m%d%H%M%S)"
    if cp "$target" "$bak" 2>/dev/null; then  # swallow-ok: 备份失败走 else 分支显式告警（非静默）
      echo "  ⚠️  ${name} 目标无 generated-by 标记（人工/外来内容）→ 已备份: ${bak##*/} 后再写入标准包装器"
    else
      echo "  ⚠️  ${name} 目标无 generated-by 标记且备份失败 → 仍写入（原内容可从 git 恢复）" >&2
    fi
  elif [ -f "$target" ]; then
    echo "  ↻ ${name}（旧版本包装器 → 更新为当前版本）"
  fi
  cat "$tmp" > "$target"
  chmod +x "$target"
  rm -f "$tmp"
  echo "  ✅ ${name}"
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

# CT-47 / D457: 注册 bypass.log 的 union 合并驱动
# .gitattributes 声明 .claude/bypass.log merge=union，但 git 需知道 union driver 是什么。
# 这里注册一次，让 append-only 证据日志多 PR 合并自动取并集（不再冲突）。
# 幂等: 重复运行 set 覆盖，无害。
# #1024 ③: 显式 `--local`（落点确定 = 仓库级配置；worktree 下该文件由全 worktree 共享）。
git config --local merge.union.driver "git merge-file --union %A %O %B" 2>/dev/null || true  # swallow-ok: git config 失败=非 git 仓库/只读, 降级不阻断
echo "  ✅ git config --local merge.union.driver — bypass.log 自动合并"

# D515 项8: git 网络韧性（Codex P9）— 30s 低于 1KB/s 即断，快速失败。
# 幂等: 重复运行 set 覆盖，无害。慢连接被快速断开后建议直接重试 push。
# #1024 ③: 同上，显式 `--local`。
git config --local http.lowSpeedLimit 1000 2>/dev/null || true  # swallow-ok: 非 git 仓库/只读降级不阻断
git config --local http.lowSpeedTime 30 2>/dev/null || true     # swallow-ok: 同上
echo "  ✅ git config --local http.lowSpeedLimit/Time — 慢连接 30s 快速失败"

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
  # #1024 ③ + 路径改为**调用时求值**: 旧写法把本树的绝对路径 $SYNOVA_COMMIT 写进共享 config，
  #   在 worktree 里跑会把"别人的路径"覆盖给全仓（虽内容同源，但落点指向单棵树）。
  #   `$(git rev-parse --show-toplevel)` 在 alias 被调用时才求值 ⇒ 始终指向调用者所在树。
  git config --local alias.synova-commit "!\"$BASH_PATH\" \"\$(git rev-parse --show-toplevel)/scripts/control-tower/synova-commit\""
  echo "  ✅ git alias synova-commit（--local，路径调用时求值）— bash=$BASH_PATH"
else
  echo "  ⚠️  synova-commit 不存在: $SYNOVA_COMMIT"
fi

echo ""
echo "✅ 安装完成。当前 hooks（${HOOKS_DIR}）:"
ls -la "$HOOKS_DIR" | grep -v ".sample"
