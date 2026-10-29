#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# resolve-ci-base.sh — CI base 解析 / 刷新 / 新鲜度断言（#598；①/①d/①e/①g/①i/①f 共用）
#
# 背景: ①d 曾在步骤内联 base 解析（#610 修 CI 空跑时加的刷新＋断言）；#598 要把它
#   抽成共享件，让「① 12 组门禁」也能拿到 base（doc-contract 闸 3 在 CI 空跑），
#   并让 ① 与 ①d 不再两处漂移（规格 §6「禁重复建设」）。
#   #1117 P0：CI 是 detached checkout，裸名 base（如 `main`）没有本地分支可解析 ⇒
#   本件按「裸名归一化到唯一远端 ＋ fetch 重试 ＋ 仍不可解析 exit 2」修，使 base=trunk
#   的 PR 在 CI 不再 1 秒失败（修法见 #1117 规格 §6.3）。
#
# 契约（铁律 47）:
#   @input  — 环境 SYNO_BASE_REF / GITHUB_BASE_REF / SYNO_TRUNK_REF / SYNO_CI / GITHUB_ACTIONS
#             ＋ git 仓库（在仓库任意子目录运行均可，内部 git rev-parse --show-toplevel）
#   @output — **stdout 仅一行**：解析后的 ref（如 `origin/main` / `gitea/main`）；
#             全部日志/warning/error 走 stderr（stdout 供 `$(...)` 直接取值）
#   @exit   — 0 = 解析成功；2 = 不可解析 / 刷新失败 / 陈旧 base（fail-closed；禁回退 --staged）
#   @side-effect — 仅可能 `git fetch`（写 remote-tracking ref）；不写工作树、不切分支
#   @error  — 沿用既有码：E_BAD_BASE（不可解析/陈旧）、E_INTERNAL（仓库根不可定位）；不新增码
#
# 解析链（#1117 规格 §6.3；禁引入 GitHub 镜像的分支字面）:
#   SYNO_BASE_REF → GITHUB_BASE_REF → <唯一远端>/<TRUNK>；TRUNK 由 SYNO_TRUNK_REF 注入，缺省 main
#   · 裸名（不含 `/`）⇒ 归一化：单远端 → `<远端>/<裸名>`；多远端 → 本地 → gitea → origin 首个可解析
#   · 单远端下裸名 ref 不可解析 ⇒ `git fetch +refs/heads/<名>:refs/remotes/<远端>/<名>` 后重试
#   · 多远端（开发机）⇒ **不 fetch、不猜**（origin 不一定是 Gitea ⇒ 不归一化到 origin/）
# 刷新（#610 语义，本件统一）:
#   单远端 ∧（CI ∨ 裸名 ref 不可解析 ∨ base 即 TRUNK）⇒ fetch `+refs/heads/<TRUNK>:refs/remotes/<远端>/<TRUNK>`
# 新鲜度断言（仅 CI ∧ 单远端 ∧ base 即 TRUNK）:
#   canonical（`<远端>/<TRUNK>`）不可解析 ⇒ exit 2；远端跟踪引用可解析 ⇒ 其 SHA 必须与 canonical 相等
#
# 已知限制（如实，非待办）:
#   1. workflow 的 YAML 静态键（`branches:` / `CHANGED_BASE` 字面）读不到本契约 ⇒ 换 trunk 名须另改字面。
#   2. 多远端不 fetch：远端跟踪引用陈旧时按链取「首个可解析者」；新鲜度由调用方保证（CI 恒单远端）。
#   3. 本件只解析 base；变更集/空绿等判据归调用方（本件不判业务）。
#   4. 显式传入历史冻结分支名时按同名 git ref 解析，**不会**被悄悄改指当前 trunk（#1117 §6.4）。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

log() { printf '%s\n' "$*" >&2; }
die() { printf '::error title=resolve-ci-base::%s\n' "$*" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] || die "E_INTERNAL: 非 git 仓库（无法定位仓库根）"
cd "$ROOT" 2>/dev/null || die "E_INTERNAL: 无法进入仓库根: ${ROOT}"

TRUNK="${SYNO_TRUNK_REF:-main}"

# ── ① 候选（解析链第一、二环；第三环由 TRUNK 派生） ─────────────────────────
EXPLICIT=0
if [ -n "${SYNO_BASE_REF:-}" ]; then
  BASE_IN="$SYNO_BASE_REF"; EXPLICIT=1
elif [ -n "${GITHUB_BASE_REF:-}" ]; then
  BASE_IN="$GITHUB_BASE_REF"; EXPLICIT=1
else
  BASE_IN="$TRUNK"
fi
log "trunk = ${TRUNK}；base 候选（原始）= ${BASE_IN}（显式=${EXPLICIT}）"

# ── ② CI 标记 ────────────────────────────────────────────────────────────────
CI_FLAG=0
if [ "${SYNO_CI:-0}" = "1" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  CI_FLAG=1
fi

# ── ③ 远端拓扑 ───────────────────────────────────────────────────────────────
REMOTES="$(git remote 2>/dev/null || true)"
N_REMOTES="$(printf '%s\n' "$REMOTES" | grep -c . || true)"
ONLY_REMOTE=""
if [ "${N_REMOTES:-0}" -eq 1 ]; then
  ONLY_REMOTE="$(printf '%s\n' "$REMOTES" | head -1)"
fi

resolvable() { git rev-parse --verify -q "${1}^{commit}" >/dev/null 2>&1; }

case "$BASE_IN" in
  */*) BARE=0 ;;
  *)   BARE=1 ;;
esac

# ── ④ 裸名归一化（单远端含 fetch 重试；多远端不 fetch） ──────────────────────
BASE="$BASE_IN"
if [ "$BARE" -eq 1 ]; then
  if [ "${N_REMOTES:-0}" -eq 1 ]; then
    BASE="${ONLY_REMOTE}/${BASE_IN}"
    WANT_FETCH=0
    resolvable "$BASE" || WANT_FETCH=1
    if [ "$CI_FLAG" -eq 1 ] && [ "$BASE_IN" = "$TRUNK" ]; then WANT_FETCH=1; fi
    if [ "$WANT_FETCH" -eq 1 ]; then
      if git fetch -q "$ONLY_REMOTE" "+refs/heads/${BASE_IN}:refs/remotes/${ONLY_REMOTE}/${BASE_IN}"; then
        log "已刷新 refs/remotes/${ONLY_REMOTE}/${BASE_IN}（远端 ${ONLY_REMOTE}；CI=${CI_FLAG}）"
      else
        log "::warning title=resolve-ci-base::fetch 远端 ${ONLY_REMOTE} 失败（不猜；交 ⑥ 可解析性判定）"
      fi
    fi
  elif [ "${N_REMOTES:-0}" -eq 0 ]; then
    BASE="origin/${BASE_IN}"
    log "无远端 ⇒ 缺省回退 ${BASE}"
  else
    if resolvable "$BASE_IN"; then BASE="$BASE_IN"
    elif resolvable "gitea/${BASE_IN}"; then BASE="gitea/${BASE_IN}"
    elif resolvable "origin/${BASE_IN}"; then BASE="origin/${BASE_IN}"
    else BASE="$BASE_IN"; fi
    log "多远端（${N_REMOTES} 个）⇒ 不 fetch、不猜；归一化 = ${BASE}"
  fi
fi
log "base 候选（归一化后）= ${BASE}"

# ── ⑤ 新鲜度断言（仅 CI ∧ 单远端 ∧ base 即 TRUNK） ──────────────────────────
if [ "$CI_FLAG" -eq 1 ] && [ "${N_REMOTES:-0}" -eq 1 ] \
   && [ "$BARE" -eq 1 ] && [ "$BASE_IN" = "$TRUNK" ]; then
  resolvable "$BASE" || die "E_BAD_BASE: CI 下 canonical ref ${BASE} 不可解析（刷新失败）⇒ fail-closed"
  TRACK_REF="refs/remotes/${ONLY_REMOTE}/${TRUNK}"
  if TRACK_SHA="$(git rev-parse --verify -q "$TRACK_REF" 2>/dev/null)"; then
    BASE_SHA="$(git rev-parse --verify -q "$BASE")"
    if [ "$BASE_SHA" != "$TRACK_SHA" ]; then
      die "E_BAD_BASE: canonical 陈旧：$(git rev-parse --short "${BASE}") != 远端跟踪引用 ${TRACK_REF}=$(git rev-parse --short "${TRACK_SHA}")"
    fi
    log "新鲜度断言通过：canonical = 远端跟踪引用（${TRACK_REF}）"
  else
    log "新鲜度断言：远端跟踪引用不可解析 ⇒ 只断言 canonical 可解析（不猜）"
  fi
fi

# ── ⑥ 可解析性 ＋ 输出 ───────────────────────────────────────────────────────
resolvable "$BASE" || die "E_BAD_BASE: base 不可解析: ${BASE}"
printf '%s\n' "$BASE"
exit 0
