#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# bypass-ledger.sh — bypass 证据账本：路径解析 / 追加 / 来源合并（D735 Stage 1）
#
# 背景（D735 派单 §三）: bypass 证据账本 `.claude/bypass.log` 是 **git 跟踪文件**，
#   每次提交都被 post-commit hook 追加一行 → 每个分支必带 bypass.log 变更
#   （实测：origin 上抽样 3 个分支，100% 出现），多 PR 并发合并还要靠 union driver 兜冲突。
#   本脚本提供 **per-session 落点**（`.sessions/<sid>/bypass.log`，`.gitignore:83` 已忽略
#   → 写入不产生任何 git status 变更）。
#
# Stage 1 = 兼容并存（派单硬要求「不许一个 PR 切完」）:
#   新落点**可写可读**，旧路径 `.claude/bypass.log` 仍是权威 —— 本阶段零行为变化，
#   目的是把新链路先跑起来并留下证据，切换与清理留给 Stage 2。
#
# 契约（铁律 47）:
#   @input  — 子命令 + 参数；环境变量:
#               SYNO_SESSION_ID / DSH_SESSION_ID / SYNO_TASK_ID / TASK_ID  会话标识（优先级见下）
#               SYNO_BYPASS_LEDGER_DIR   落点目录覆盖（测试注入缝；默认 $ROOT/.sessions/<sid>）
#               SYNO_LEGACY_BYPASS_LOG   旧账本路径覆盖（测试注入缝；默认 $ROOT/.claude/bypass.log）
#               SYNO_BYPASS_SESSIONS_ROOT 仓库级 .sessions 根覆盖（测试注入缝；默认 $ROOT/.sessions）
#   @output — path:    一行，本 session 账本绝对路径（默认 $ROOT/.sessions/<sid>/bypass.log）
#             append:  无 stdout（追加成功即 exit 0）
#             sources: 逐行，对账应读的**全部**账本路径（旧路径在前，per-session 按名排序；只列已存在的）
#             read:    全部来源的合并内容（顺序同 sources）
#   @exit   — 0 成功；1 用法错误 / append 缺内容；2 落点无法解析或写入失败（fail-closed）
#   @degraded — 会话标识全不可解析 → 依次回退 git 分支名 → 仓库目录名 → "default"，
#               并在 stderr 明示用了哪个回退（铁律 11：显式，不静默）
#   @error  — 不抛异常；全部经退出码表达（ctrl-tower 模式 1）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# #1295：落点必须**按 repo 共享**，不能按 worktree 隔离 —— 否则在两棵 worktree 之间搬提交后
#   push 会因"新 worktree 没有本 session 记录"被 D331 拒；旧做法要手工复制 .sessions/ 或手补继承行
#   （= 手写证据）。修法：取 `--git-common-dir` 的**上一级**（主仓根），所有 worktree 共用同一 .sessions/。
_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")"  # swallow-ok: 非 git/旧 git ⇒ 回退 show-toplevel
if [ -n "$_COMMON_DIR" ]; then
  ROOT="$(cd "$_COMMON_DIR/.." 2>/dev/null && pwd)"   # common dir = <主仓根>/.git ⇒ 上一级即主仓根
else
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
[ -n "$ROOT" ] || ROOT="$(pwd)"
LEGACY_LOG="${SYNO_LEGACY_BYPASS_LOG:-$ROOT/.claude/bypass.log}"

# ── 会话标识解析（优先级: 显式 env > 任务号 env > git 分支 > 仓库目录名 > default）──
_resolve_sid() {
  local raw="" src=""
  if [ -n "${SYNO_SESSION_ID:-}" ]; then raw="$SYNO_SESSION_ID"; src="SYNO_SESSION_ID"
  elif [ -n "${DSH_SESSION_ID:-}" ]; then raw="$DSH_SESSION_ID"; src="DSH_SESSION_ID"
  elif [ -n "${SYNO_TASK_ID:-}" ]; then raw="$SYNO_TASK_ID"; src="SYNO_TASK_ID"
  elif [ -n "${TASK_ID:-}" ]; then raw="$TASK_ID"; src="TASK_ID"
  elif raw="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)" && [ -n "$raw" ] && [ "$raw" != "HEAD" ]; then
    src="git-branch"
  elif raw="$(basename "$ROOT")" && [ -n "$raw" ]; then
    src="repo-dirname"
  else
    raw="default"; src="fallback-default"
  fi
  # 归一：只留 [A-Za-z0-9._-]，其余（含 / 与中文）→ _（路径安全 + 跨平台）
  local sid
  sid="$(printf '%s' "$raw" | tr -c 'A-Za-z0-9._-' '_' | sed 's/_*$//')"
  [ -n "$sid" ] || sid="default"
  if [ "$src" = "repo-dirname" ] || [ "$src" = "fallback-default" ]; then
    echo "⚠ bypass-ledger: 会话标识回退到 ${src}（${sid}）——建议设 SYNO_SESSION_ID" >&2
  fi
  printf '%s' "$sid"
}

_ledger_dir() { printf '%s' "${SYNO_BYPASS_LEDGER_DIR:-$ROOT/.sessions/$(_resolve_sid)}"; }
_ledger_path() { printf '%s' "$(_ledger_dir)/bypass.log"; }

# ── 对账来源（旧路径在前；per-session 按名排序，稳定可复现）──
_sources() {
  [ -f "$LEGACY_LOG" ] && printf '%s\n' "$LEGACY_LOG"
  # per-session 账本：当前落点目录（可能被 SYNO_BYPASS_LEDGER_DIR 覆盖到仓库外）
  # + 仓库内全部 .sessions/*/bypass.log（D331 要覆盖本分支全部提交，
  #   而提交可能由别的 session 产生过登记）。两处会重叠 → sort -u 去重（否则 read 会重复输出）。
  {
    local d; d="$(_ledger_dir)"
    ls -1 "$d"/*.log 2>/dev/null   # swallow-ok: 目录为空/不存在时 ls 报错属正常（探测型）
    ls -1 "${SYNO_BYPASS_SESSIONS_ROOT:-$ROOT/.sessions}"/*/bypass.log 2>/dev/null   # swallow-ok: 同上（探测型）
  } | sort -u
}

case "${1:-}" in
  path)
    _ledger_path; echo; exit 0 ;;
  append)
    line="${2:-}"
    if [ -z "$line" ]; then echo "❌ bypass-ledger: append 需要一个参数（行内容）" >&2; exit 1; fi
    dir="$(_ledger_dir)"
    if ! mkdir -p "$dir" 2>/dev/null; then   # swallow-ok: 失败已在下一行 exit 2 显式处理（fail-closed）
      echo "❌ bypass-ledger: 落点目录创建失败: ${dir}（fail-closed，不回退静默写旧路径）" >&2
      exit 2
    fi
    if ! printf '%s\n' "$line" >> "$dir/bypass.log" 2>/dev/null; then   # swallow-ok: 失败已在下一行 exit 2 显式处理（fail-closed）
      echo "❌ bypass-ledger: 追加失败: ${dir}/bypass.log（fail-closed）" >&2
      exit 2
    fi
    exit 0 ;;
  sources)
    _sources; exit 0 ;;
  read)
    _sources | while IFS= read -r f; do [ -n "$f" ] && cat "$f" 2>/dev/null; done
    exit 0 ;;
  ""|-h|--help)
    echo "用法: bash bypass-ledger.sh {path|append <行>|sources|read}" >&2
    exit 1 ;;
  *)
    echo "❌ bypass-ledger: 未知子命令 ${1}（支持 path/append/sources/read）" >&2; exit 1 ;;
esac
