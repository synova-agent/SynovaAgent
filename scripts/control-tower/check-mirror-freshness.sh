#!/usr/bin/env bash
# D313/D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-mirror-freshness.sh — 镜像新鲜度：禁止在旧树上宣布"集成通过"（#1087 / W5）
#
# 设计哲学（一句）: **"通过"必须绑定一个可指名的新鲜提交；镜象落后时，任何绿都是
#                    旧树绿 —— 本器只回答"这棵树是不是最新的"，不回答"代码好不好"。**
#
# 背景（2026-10-28 实测，非转述）:
#   `git ls-remote origin refs/heads/main` = 1ca0d4dfc（GitHub 镜像最后同步点）
#   `git rev-parse gitea/local-main`       = a32efef5b
#   `git rev-list --count 1ca0d4dfc..a32efef5b` = 117
#   ⇒ GitHub 侧任何"已通过门禁"结论都对应 117 提交之前的树。
#
# 契约（铁律 47）:
#   @usage  bash scripts/control-tower/check-mirror-freshness.sh \\
#             [--canonical <ref>] [--mirror-url <url> | --mirror-ref <ref>] [--json] [--root <dir>]
#   @input  git 仓库（默认 -C <root>）；canonical 默认 `gitea/local-main`；
#           镜象二选一：--mirror-url（**live**，git ls-remote；默认 `origin` 的 URL）
#                        / --mirror-ref（**离线**，本地 tracking ref，可能过期）
#   @output stdout: 逐行人读结论 ＋ 末行 `结果: <STATUS> behind=<N> ahead=<N>`；
#           --json 时 stdout 仅一份合法 JSON
#   @exit   0 = 新鲜（mirror sha == canonical sha）
#           1 = 不新鲜（behind / diverged / mirror-ahead）—— 真红，但**只报告不阻断**（W5）
#           2 = 判不了（canonical ref 缺失 / 镜象不可达 / 镜象无 main / git 不可用 / 用法错）
#           🔴 三态铁律：2 绝不等于通过；**严禁把 128 等异常退出当 0**（W6 G6 同源）
#   @degraded stderr 一行 `degraded: <CODE> — <原因>` ＋ 追加一行 JSON 到
#           SYNO_GATE_DEGRADED_LOG（默认 <root>/.codex/control-tower/logs/degraded-events.log；
#           字段 time/component/code/phase/retryable；铁律 11/32），随后 exit 2
#   @error  code ∈ {E_USAGE, E_GIT_MISSING, E_CANONICAL_MISSING, E_MIRROR_UNREACHABLE,
#                   E_MIRROR_NO_MAIN, E_MIRROR_OBJECT_MISSING, E_INTERNAL}
#
# 授权（explicit authority）: 调用者 = 周报（weekly-recon）/ CTO 手跑 / CI（只读报告腿）。
#           只读：不 fetch、不 push、不写仓库内容；唯一落盘 = 降级日志（.codex/ 不入库）。
# 已知限制（Known Limitations）:
#   1. `--mirror-ref` 模式只能证明"我们上次看到的镜象"，tracking ref 未 fetch 时**可能过期**
#      ⇒ 结论行显式标注 "(本地 tracking ref，可能过期)"，周报应优先用 --mirror-url。
#   2. 只比 main 一条线；其它分支/标签不在本器判据内（W5 只要求 main）。
#   3. 不做时间性判断（"落后多少天"）；只给提交数，避免把时钟当判据。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT=""
CANONICAL="gitea/main"
MIRROR_URL=""
MIRROR_REF=""
MIRROR_REF_GIVEN=0
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --canonical)  CANONICAL="${2:-}"; shift 2 ;;
    --mirror-url) MIRROR_URL="${2:-}"; shift 2 ;;
    --mirror-ref) MIRROR_REF="${2:-}"; MIRROR_REF_GIVEN=1; shift 2 ;;
    --root)       ROOT="${2:-}"; shift 2 ;;
    --json)       JSON=1; shift ;;
    -h|--help)    sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$ROOT" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "❌ 非 git 仓库（且未给 --root）—— 判不了，禁当通过" >&2; exit 2; }
fi
[ -d "$ROOT/.git" ] || [ -f "$ROOT/.git" ] || { echo "❌ --root 不是 git 仓库: $ROOT" >&2; exit 2; }

DEG_LOG="${SYNO_GATE_DEGRADED_LOG:-$ROOT/.codex/control-tower/logs/degraded-events.log}"

degraded() { # <code> <reason>
  local code="$1" reason="$2" now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "degraded: $code — $reason" >&2
  if mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null; then  # swallow-ok: 目录不可建走 else 分支显式报 stderr，不吞
    printf '{"time":"%s","component":"check-mirror-freshness","code":"%s","phase":"resolve","retryable":true,"reason":"%s"}\n' \
      "$now" "$code" "${reason//\"/\'}" >> "$DEG_LOG" 2>/dev/null || true   # swallow-ok: 降级日志不可写不得改变门禁结论
  else
    echo "degraded: 降级日志目录不可建（$DEG_LOG）——已 stderr 提示，不静默" >&2
  fi
  exit 2
}

command -v git >/dev/null 2>&1 || degraded E_GIT_MISSING "git 不在 PATH"

CANON_SHA="$(git -C "$ROOT" rev-parse --verify --quiet "${CANONICAL}^{commit}" 2>/dev/null)"  # swallow-ok: 缺失/坏 ref 由下方显式 degraded exit 2，不吞错误路径
[ -n "$CANON_SHA" ] || degraded E_CANONICAL_MISSING "canonical ref 不可解析: $CANONICAL"

# ── 镜象解析：live 优先（--mirror-url），否则离线 tracking ref ────────────────
MIRROR_DESC=""
MIRROR_SHA=""
if [ -n "$MIRROR_URL" ]; then
  MIRROR_DESC="$MIRROR_URL"
  LS_OUT="$(GIT_TERMINAL_PROMPT=0 git -C "$ROOT" ls-remote "$MIRROR_URL" refs/heads/main 2>/dev/null)"  # swallow-ok: 失败由 LS_RC 显式分支 degraded，不吞
  LS_RC=$?
  [ "$LS_RC" -eq 0 ] || degraded E_MIRROR_UNREACHABLE "git ls-remote 失败（rc=$LS_RC）: $MIRROR_URL"
  MIRROR_SHA="$(printf '%s\n' "$LS_OUT" | awk 'NR==1{print $1}')"
  [ -n "$MIRROR_SHA" ] || degraded E_MIRROR_NO_MAIN "镜象无 refs/heads/main: $MIRROR_URL"
else
  if [ "$MIRROR_REF_GIVEN" -eq 1 ]; then
    MIRROR_DESC="$MIRROR_REF（本地 tracking ref，可能过期）"
  else
    MIRROR_REF="origin/main"
    MIRROR_DESC="$MIRROR_REF（本地 tracking ref，可能过期）"
  fi
  MIRROR_SHA="$(git -C "$ROOT" rev-parse --verify --quiet "${MIRROR_REF}^{commit}" 2>/dev/null)"  # swallow-ok: 缺失由下一行显式 degraded exit 2
  [ -n "$MIRROR_SHA" ] || degraded E_MIRROR_UNREACHABLE "镜象 ref 不可解析: $MIRROR_REF"
fi

# ── 判定 ─────────────────────────────────────────────────────────────────────
# 🔴 前置：镜象提交对象必须在本仓可见，否则「落后 vs 分叉」不可分辨
#    （ls-remote 只给 sha，不搬对象；典型 push 镜象的 sha 是 local-main 祖先 ⇒ 天然可见）
if [ "$MIRROR_SHA" != "$CANON_SHA" ]; then
  git -C "$ROOT" cat-file -e "${MIRROR_SHA}^{commit}" 2>/dev/null \
    || degraded E_MIRROR_OBJECT_MISSING "镜象提交对象不在本仓（$MIRROR_SHA）—— 判不了落后/分叉，禁当通过；先 fetch 或改 --mirror-ref"
fi
STATUS=""; BEHIND=0; AHEAD=0; EXIT_CODE=2
if [ "$MIRROR_SHA" = "$CANON_SHA" ]; then  # @mutate-point: fresh
  STATUS="fresh"; EXIT_CODE=0
elif git -C "$ROOT" merge-base --is-ancestor "$MIRROR_SHA" "$CANON_SHA" 2>/dev/null; then  # swallow-ok: 非祖先=条件假，属正常分支
  BEHIND="$(git -C "$ROOT" rev-list --count "${MIRROR_SHA}..${CANON_SHA}" 2>/dev/null)"  # swallow-ok: 空值由下一行显式 degraded exit 2
  [ -n "$BEHIND" ] || degraded E_INTERNAL "rev-list 计数失败（判不了，禁当通过）"
  STATUS="stale"; EXIT_CODE=1
elif git -C "$ROOT" merge-base --is-ancestor "$CANON_SHA" "$MIRROR_SHA" 2>/dev/null; then  # swallow-ok: 非祖先=条件假，属正常分支
  AHEAD="$(git -C "$ROOT" rev-list --count "${CANON_SHA}..${MIRROR_SHA}" 2>/dev/null)"  # swallow-ok: 空值由下一行显式 degraded exit 2
  [ -n "$AHEAD" ] || degraded E_INTERNAL "rev-list 计数失败（判不了，禁当通过）"
  STATUS="mirror-ahead"; EXIT_CODE=1
else
  STATUS="diverged"; EXIT_CODE=1
fi

SHORT_C="$(printf '%s' "$CANON_SHA" | cut -c1-9)"
SHORT_M="$(printf '%s' "$MIRROR_SHA" | cut -c1-9)"

if [ "$JSON" -eq 1 ]; then
  printf '{"status":"%s","canonical":{"ref":"%s","sha":"%s"},"mirror":{"desc":"%s","sha":"%s"},"behind":%s,"ahead":%s}\n' \
    "$STATUS" "$CANONICAL" "$CANON_SHA" "$MIRROR_DESC" "$MIRROR_SHA" "${BEHIND:-0}" "${AHEAD:-0}"
else
  echo "── 镜像新鲜度核验（#1087 / W5）──"
  echo "canonical: $CANONICAL @ $SHORT_C"
  echo "mirror:    $MIRROR_DESC @ $SHORT_M"
  case "$STATUS" in
    fresh)        echo "✅ 镜像新鲜（sha 相同）" ;;
    stale)        echo "❌ 镜像落后 $BEHIND 提交 —— 镜象侧任何『已通过』均为旧树绿" ;;
    mirror-ahead) echo "❌ 镜象超前 $AHEAD 提交 —— canonical 不含镜象提交（分叉前兆，先核谁是真源）" ;;
    diverged)     echo "❌ 镜象与 canonical 已分叉 —— 判据：禁引用镜象结论对外汇报" ;;
  esac
  echo "结果: $STATUS behind=${BEHIND:-0} ahead=${AHEAD:-0}"
fi

exit "$EXIT_CODE"
