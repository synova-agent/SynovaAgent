#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# resolve-ci-base.sh — CI base 解析 / 刷新 / 新鲜度断言（#598；① 与 ①d 共用）
#
# 背景: ①d 曾在步骤内联 base 解析（#610 修 CI 空跑时加的刷新＋断言）；#598 要把它
#   抽成共享件，让「① 12 组门禁」也能拿到 base（doc-contract 闸 3 在 CI 空跑），
#   并让 ① 与 ①d 不再两处漂移（规格 §6「禁重复建设」）。
#
# 契约（铁律 47）:
#   @input  — 环境 SYNO_BASE_REF / GITHUB_BASE_REF / SYNO_CI / GITHUB_ACTIONS；git 仓库
#             （在仓库任意子目录运行均可，内部 git rev-parse --show-toplevel）
#   @output — **stdout 仅一行**：解析后的 ref（如 `gitea/main`）；
#             全部日志/warning/error 走 stderr（stdout 供 `$(...)` 直接取值）
#   @exit   — 0 = 解析成功；2 = 不可解析 / 刷新失败 / 陈旧 base（fail-closed；禁回退 --staged）
#   @side-effect — 仅可能 `git fetch`（写 remote-tracking ref）；不写工作树、不切分支
#
# 解析链（规格 §S1-e，禁引入镜像分支字面）:
#   SYNO_BASE_REF → GITHUB_BASE_REF → gitea/main；裸 `local-main` 规范化为 `gitea/main`
# 刷新（#610 语义，本件统一）:
#   单远端 ∧（CI ∨ canonical 不可解析）⇒ fetch `+refs/heads/main:refs/remotes/gitea/main`
#   多远端（开发机）⇒ 不 fetch、不猜
# 新鲜度断言（仅 CI）:
#   canonical 不可解析 ⇒ exit 2；唯一远端的 local-main 跟踪引用可解析 ⇒ 其 SHA 必须与 canonical 相等
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

log() { printf '%s\n' "$*" >&2; }
die() { printf '::error title=resolve-ci-base::%s\n' "$*" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] || die "非 git 仓库（无法定位仓库根）"
cd "$ROOT" 2>/dev/null || die "无法进入仓库根: $ROOT"

# ── ① 解析链 ＋ 裸名规范化 ─────────────────────────────────────────────────────
BASE=""
if [ -n "${SYNO_BASE_REF:-}" ]; then
  BASE="$SYNO_BASE_REF"
elif [ -n "${GITHUB_BASE_REF:-}" ]; then
  BASE="$GITHUB_BASE_REF"
else
  BASE="gitea/main"
fi
case "$BASE" in
  main|local-main) BASE="gitea/main" ;;
esac
log "base 候选 = $BASE"

# ── ② CI 标记 ─────────────────────────────────────────────────────────────────
CI_FLAG=0
if [ "${SYNO_CI:-0}" = "1" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  CI_FLAG=1
fi

# ── ③ 远端拓扑 ────────────────────────────────────────────────────────────────
REMOTES="$(git remote 2>/dev/null || true)"
N_REMOTES="$(printf '%s\n' "$REMOTES" | grep -c . || true)"
ONLY_REMOTE=""
if [ "${N_REMOTES:-0}" -eq 1 ]; then
  ONLY_REMOTE="$(printf '%s\n' "$REMOTES" | head -1)"
fi

# ── ④ canonical 刷新 ＋ 新鲜度断言 ───────────────────────────────────────────
if [ "$BASE" = "gitea/main" ]; then
  CANONICAL_OK=0
  if git rev-parse --verify -q gitea/main >/dev/null 2>&1; then
    CANONICAL_OK=1
  fi
  if [ "${N_REMOTES:-0}" -eq 1 ] && { [ "$CI_FLAG" -eq 1 ] || [ "$CANONICAL_OK" -eq 0 ]; }; then
    if git fetch -q "$ONLY_REMOTE" '+refs/heads/main:refs/remotes/gitea/main'; then
      log "已刷新 refs/remotes/gitea/main（远端 ${ONLY_REMOTE}；CI=${CI_FLAG}）"
    else
      log "::warning title=resolve-ci-base::fetch 远端 ${ONLY_REMOTE} 失败；交调用方/检查器判 exit 2"
    fi
  elif [ "${N_REMOTES:-0}" -ne 1 ] && { [ "$CI_FLAG" -eq 1 ] || [ "$CANONICAL_OK" -eq 0 ]; }; then
    log "::warning title=resolve-ci-base::远端数=${N_REMOTES:-0} != 1，不 fetch、不猜"
  fi
  log "canonical 刷新后 = $(git rev-parse --short gitea/main 2>/dev/null || echo '<仍不可解析>')"
  if [ "$CI_FLAG" -eq 1 ]; then
    git rev-parse --verify -q gitea/main >/dev/null 2>&1 \
      || die "CI 下 canonical ref gitea/main 不可解析（刷新失败）⇒ fail-closed"
    TRACK_REF=""
    if [ -n "$ONLY_REMOTE" ]; then
      TRACK_REF="refs/remotes/${ONLY_REMOTE}/main"
    fi
    if [ -n "$TRACK_REF" ] && TRACK_SHA="$(git rev-parse --verify -q "$TRACK_REF" 2>/dev/null)"; then
      BASE_SHA="$(git rev-parse --verify -q gitea/main)"
      if [ "$BASE_SHA" != "$TRACK_SHA" ]; then
        die "canonical 陈旧：$(git rev-parse --short gitea/main) != 远端跟踪引用 ${TRACK_REF}=$(git rev-parse --short "$TRACK_SHA")"
      fi
      log "新鲜度断言通过：canonical = 远端跟踪引用（${TRACK_REF}）= $(git rev-parse --short gitea/main)"
    else
      log "新鲜度断言：无唯一远端或跟踪引用不可解析 ⇒ 只断言 canonical 可解析（不猜）"
    fi
  fi
fi

# ── ⑤ 可解析性 ＋ 输出 ────────────────────────────────────────────────────────
git rev-parse --verify -q "${BASE}^{commit}" >/dev/null 2>&1 || die "base 不可解析: ${BASE}"
printf '%s\n' "$BASE"
exit 0
