#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# precommit-evidence.sh — D1068: 门禁证据载体 = commit trailer（写入侧原语）
#
# 背景（D1068 §一）: 证据旧载体 `.claude/bypass.log` 是 **git 跟踪的 append-only 文件**，
#   `scripts/hooks/post-commit.sh:23` 每次提交都追加一行 ⇒ 每个分支必带该文件变更 ⇒
#   多 PR 并发合并必冲突（靠 `.gitattributes merge=union` 兜住）。真根因 = 同一份事实
#   有两条写入路径且落在一个共享可变文件上。
#   新载体 = **commit trailer**（证据随提交消息走，仓库内不再有共享可变证据文件）。
#
# 本脚本职责（单一）: 把「pre-commit 已通过」这件事，从**跑门禁的那一刻**落到一个
#   git 内部、**不被跟踪**的标记文件；并给出其 sha256 供 trailer 使用。
#
# ⚠️ 绑定强度的诚实表述（D1068 独立自验 R1 实测指出，勿淡化）:
#   本机制能保证的是「**未调用本脚本就无法自动产出** trailer」，**不是**「trailer 不可伪造」。
#   对账器只校验 trailer **存在**（经 git 的原生 trailer 解析，不吃正文里的同名字符串），
#   不校验其值是否由本脚本产出 —— 手写 `PreCommit-PASS: <任意串>` 同样会通过对账。
#   故它是**误漏防护**（防止「跑了门禁却忘记录」与「没跑门禁就提交」的静默缺口），
#   不是**防恶意**边界。无密钥、无树绑定、无提交绑定；标记被下次提交覆盖后亦不可回溯核验。
#   要提升强度需引入签名/密钥（属另一张卡，本卡不做、不声称）。
#
# 契约（铁律 47）:
#   @input  — 子命令；环境变量:
#               SYNO_EVIDENCE_MARKER  标记文件路径覆盖（测试注入缝；默认 $GIT_DIR/synova-evidence/precommit-pass）
#   @output — path:  一行，标记文件绝对路径
#             write: 无 stdout（写入成功即 exit 0）—— 内容 4 行:
#                      version=1
#                      tree=<git write-tree>            （门禁实际校验的树）
#                      head=<HEAD 或空>                  （门禁运行时的 HEAD，空仓为空）
#                      epoch=<秒级时间戳>
#             hash:  一行，标记文件内容的 sha256（trailer 值）
#   @exit   — 0 成功；1 用法错误 / 标记不存在（hash 前未 write）；2 无法解析 git 目录或写入失败（fail-closed）
#   @degraded — 找不到 sha256 工具（sha256sum/shasum/certutil）→ **不静默降级为弱哈希**，
#               直接 exit 2 并在 stderr 明示（铁律 11：证据哈希不能用不可信算法替代）
#   @error  — 不抛异常；全部经退出码表达（ctrl-tower-change 模式 1：三态退出码）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ── 标记落点: 必须在 .git/ 之下（不被 git 跟踪 —— 否则又是「每提交必脏」的老病）──
_default_marker() {
  local gd
  gd="$(git rev-parse --git-dir 2>/dev/null)" || return 1
  # git-dir 在 worktree 内是相对路径（如 /abs/.git/worktrees/x）—— 已是绝对或可拼接
  case "$gd" in
    /*) printf '%s/synova-evidence/precommit-pass' "$gd" ;;
    *)  printf '%s/%s/synova-evidence/precommit-pass' "$ROOT" "$gd" ;;
  esac
}

MARKER="${SYNO_EVIDENCE_MARKER:-}"
if [ -z "$MARKER" ]; then
  if ! MARKER="$(_default_marker)"; then
    echo "❌ precommit-evidence: 无法解析 git 目录（fail-closed）" >&2
    exit 2
  fi
fi

# ── sha256（Mac: shasum -a 256 / Linux: sha256sum / Windows: certutil）──
# 统一读 stdin，输出纯十六进制小写。
_sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v certutil >/dev/null 2>&1; then
    # Windows Git bash: certutil -hashfile - SHA256 读 stdin 不稳 → 走临时文件
    local tmp; tmp="$(mktemp)" || return 1
    cat > "$tmp"
    certutil -hashfile "$tmp" SHA256 2>/dev/null | sed -n 2p | tr -d ' \r' | tr 'A-F' 'a-f'   # swallow-ok: 失败由调用方 return 反应（本分支仅在 certutil 存在时进入）
    local _rc=$?; rm -f "$tmp" 2>/dev/null || true
    return $_rc
  else
    return 1
  fi
}

_hash_file() {
  # @input $1=文件路径; @output 一行 sha256; @exit 0 成功 / 2 无可用工具或不可读
  [ -r "$1" ] || return 2
  local out
  if command -v sha256sum >/dev/null 2>&1; then
    out="$(sha256sum "$1" 2>/dev/null | awk '{print $1}')"   # swallow-ok: 失败由下方 [ -n "$out" ] 判定并 return 2（fail-closed）
  elif command -v shasum >/dev/null 2>&1; then
    out="$(shasum -a 256 "$1" 2>/dev/null | awk '{print $1}')"   # swallow-ok: 同上（fail-closed）
  elif command -v certutil >/dev/null 2>&1; then
    out="$(certutil -hashfile "$1" SHA256 2>/dev/null | sed -n 2p | tr -d ' \r' | tr 'A-F' 'a-f')"   # swallow-ok: 同上（fail-closed）
  else
    echo "❌ precommit-evidence: 无 sha256 工具（sha256sum/shasum/certutil 均不可用）— 不降级为弱哈希（fail-closed）" >&2
    return 2
  fi
  [ -n "$out" ] || return 2
  printf '%s' "$out"
}

case "${1:-}" in
  path)
    printf '%s\n' "$MARKER"
    exit 0
    ;;
  write)
    _dir="$(dirname "$MARKER")"
    if ! mkdir -p "$_dir" 2>/dev/null; then   # swallow-ok: 失败已在下一行 exit 2 显式处理（fail-closed）
      echo "❌ precommit-evidence: 标记目录创建失败: ${_dir}（fail-closed）" >&2
      exit 2
    fi
    _tree="$(git write-tree 2>/dev/null)" || _tree=""
    _head="$(git rev-parse HEAD 2>/dev/null || true)"
    {
      printf 'version=1\n'
      printf 'tree=%s\n' "$_tree"
      printf 'head=%s\n' "$_head"
      printf 'epoch=%s\n' "$(date +%s)"
    } > "$MARKER" 2>/dev/null || {
      echo "❌ precommit-evidence: 标记写入失败: ${MARKER}（fail-closed）" >&2
      exit 2
    }
    exit 0
    ;;
  hash)
    if [ ! -f "$MARKER" ]; then
      echo "❌ precommit-evidence: 标记不存在: ${MARKER} — 未跑门禁不得产出 trailer（fail-closed）" >&2
      exit 1
    fi
    _h="$(_hash_file "$MARKER")" || exit 2
    printf '%s\n' "$_h"
    exit 0
    ;;
  verify)
    # @input $1=待核对 sha256（通常来自 commit trailer）
    # 核对「该 sha256 是否与本机标记一致」——标记已被下次提交覆盖时**不可核对**，
    # 此时输出 unverifiable 并 exit 3（显式区分「不一致」与「无法核对」，铁律 11 不静默）。
    _want="${2:-}"
    if [ -z "$_want" ]; then echo "用法: bash precommit-evidence.sh verify <sha256>" >&2; exit 1; fi
    if [ ! -f "$MARKER" ]; then echo "unverifiable"; exit 3; fi
    _got="$(_hash_file "$MARKER")" || exit 2
    if [ "$_got" = "$_want" ]; then echo "match"; exit 0; else echo "mismatch"; exit 1; fi
    ;;
  ""|-h|--help)
    echo "用法: bash precommit-evidence.sh {path|write|hash|verify <sha256>}" >&2
    exit 1
    ;;
  *)
    echo "❌ precommit-evidence: 未知子命令 ${1}（支持 path/write/hash/verify）" >&2
    exit 1
    ;;
esac
