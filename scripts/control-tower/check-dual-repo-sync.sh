#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null   # swallow-ok: locale 不可用时回退默认 locale（非错误路径）
# ═══════════════════════════════════════════════════════════════════════════════
# check-dual-repo-sync.sh — 两仓对账探针（任务 #609；P10 双仓与生态面）
#
# 【一句话】一条命令判「Gitea trunk（缺省 main）与 GitHub main 是否已对齐」：落后 N 个提交 /
#   分叉 / 读不到，三态退出码；结果落固定路径 JSON，供人看、供后续 cron 复读。
#
# 【设计哲学】一个分离 ＋ 四条承诺
#   · 一个分离：**取数面与判定面分离** —— 远端 sha 只从「远端真值」取（`ls-remote` /
#     GitHub API），**绝不读本地同名分支指针**。K3 P11 已实证：本地 trunk 分支落后时
#     `git rev-list --count mirror/main..main` 会得出 **0（假绿）**。
#   · 承诺 1「看不见 ≠ 没问题」：任一远端读不到 / sha 不在本地且补取失败 / JSON 写不出
#     ⇒ **exit 2（degraded）**，绝不判 0，也绝不判 1（铁律 11：显式降级，不静默）。
#   · 承诺 2「钉 SHA 不钉分支」：判定只用 40 位 sha；分支名仅作取数参数。
#   · 承诺 3「一个数只在一处」：唯一判据 = `git rev-list --count <gh_main>..<gitea_trunk>`
#     ＋ `merge-base --is-ancestor`（分叉检测）；不引入第二套口径。
#   · 承诺 4「只读」：不改分支、不 push、不 fetch 覆盖（仅在本地缺 commit 时**补取**该 sha 的 ref）。
#
# 契约（铁律 47 / P10 守则 §八之三②）:
#   @input
#     --json            stdout 只输出 JSON（人读行改走 stderr）
#     --help            打印用法
#     环境缝（默认值 = 生产值）:
#       SYNO_SYNC_REPO         仓库根（缺省 = 本脚本上两级）
#       SYNO_SYNC_GITEA_URL    Gitea 远端（remote 名 或 URL/路径；缺省 gitea）
#       SYNO_SYNC_GITEA_REF    Gitea 侧 ref（缺省 refs/heads/${SYNO_TRUNK_REF:-main}）
#       SYNO_SYNC_GITHUB_API   GitHub Repo API 前缀
#                              （缺省 https://api.github.com/repos/synova-agent/SynovaAgent）
#       SYNO_SYNC_GITHUB_SHA   注入缝（测试用）：直接给定 GitHub main sha，跳过取数
#       SYNO_DUAL_REPO_OUT     结果 JSON 固定路径
#                              （缺省 <repo>/.codex/control-tower/tmp/dual-repo-sync.json）
#   @output  stdout: 末行 verdict（OK / LAG lag=N / FORK / DEGRADED reason=…）＋ JSON 路径
#            file:   <OUT>（schema syno-dual-repo-sync/v1；含 as_of/sha/lag/ancestor/verdict/exit）
#   @exit    0 = 两仓一致（lag=0 且 GitHub main 是 Gitea trunk 的祖先）
#            1 = 真红（lag>0 镜像滞后；或分叉：GitHub main 不是祖先）
#            2 = 检查自身失败（degraded：远端读不到／sha 不在本地／JSON 写不出）
#   @degraded 写 <OUT> 且 degraded=true + reason；**禁把"读不到"当"差=0"**
#
# 已知限制（Known Limitations）:
#   1. **不测 runner 存活**：Gitea runner 挂了本探针根本不会跑（那半边归门禁域 P4）。
#   2. **不判断"滞后是否可接受"**：只有 lag=0 才判绿；滞后几天都算红（本探针不做豁免）。
#   3. GitHub main 的 sha 取数依赖公开 API 或 gh；组织改私有时须给凭据（否则 exit 2）。
#   4. 首次在冷树跑需补取两侧提交，可能慢；本探针不设超时（由 CI job 的 timeout 兜底）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="${SYNO_SYNC_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
GITEA_URL="${SYNO_SYNC_GITEA_URL:-gitea}"
GITEA_REF="${SYNO_SYNC_GITEA_REF:-refs/heads/${SYNO_TRUNK_REF:-main}}"
GH_API="${SYNO_SYNC_GITHUB_API:-https://api.github.com/repos/synova-agent/SynovaAgent}"
GH_SHA_INJ="${SYNO_SYNC_GITHUB_SHA:-}"
OUT="${SYNO_DUAL_REPO_OUT:-$ROOT/.codex/control-tower/tmp/dual-repo-sync.json}"

JSON_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON_ONLY=1 ;;
    --help|-h)
      sed -n '3,60p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "❌ 未知参数: ${arg}（--help 看用法）" >&2; exit 2 ;;
  esac
done

AS_OF="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GITEA_SHA=""; GH_SHA=""; LAG=""; ANCESTOR=""; VERDICT=""; REASON=""

say() { [ "$JSON_ONLY" = "1" ] && return 0; echo "$*"; }

write_json() {  # $1=exit  $2=verdict  $3=reason（可空）
  local rc="$1" verdict="$2" reason="${3:-}"
  mkdir -p "$(dirname "$OUT")" 2>/dev/null || return 1   # swallow-ok: 写不出 ⇒ 调用方判 degraded exit 2
  {
    printf '{\n'
    printf '  "schema": "syno-dual-repo-sync/v1",\n'
    printf '  "as_of": "%s",\n' "$AS_OF"
    printf '  "repo": "%s",\n' "$(printf '%s' "$ROOT" | tr -d '"')"
    printf '  "gitea": {"url": "%s", "ref": "%s", "sha": "%s"},\n' \
      "$(printf '%s' "$GITEA_URL" | tr -d '"')" "$GITEA_REF" "${GITEA_SHA:-}"
    printf '  "github": {"api": "%s", "sha": "%s"},\n' \
      "$(printf '%s' "$GH_API" | tr -d '"')" "${GH_SHA:-}"
    printf '  "lag": %s,\n' "${LAG:-null}"
    printf '  "ancestor": %s,\n' "${ANCESTOR:-null}"
    printf '  "verdict": "%s",\n' "$verdict"
    printf '  "reason": "%s",\n' "$(printf '%s' "$reason" | tr -d '"' | tr '\n' ' ')"
    printf '  "degraded": %s,\n' "$([ "$rc" = "2" ] && echo true || echo false)"
    printf '  "exit": %s\n' "$rc"
    printf '}\n'
  } > "$OUT" 2>/dev/null || return 1   # swallow-ok: 同上（写失败 ⇒ degraded）
  return 0
}

finish() {  # $1=exit $2=verdict $3=reason
  local rc="$1" verdict="$2" reason="${3:-}"
  if ! write_json "$rc" "$verdict" "$reason"; then
    echo "DUAL-REPO-SYNC: DEGRADED reason=out_unwritable out=$OUT"
    exit 2
  fi
  if [ "$JSON_ONLY" = "1" ]; then cat "$OUT"; else
    printf 'DUAL-REPO-SYNC: %s' "$verdict"
    [ -n "$reason" ] && printf ' reason=%s' "$reason"
    [ -n "$LAG" ] && printf ' lag=%s' "$LAG"
    [ -n "$GITEA_SHA" ] && printf ' gitea=%s' "${GITEA_SHA:0:9}"
    [ -n "$GH_SHA" ] && printf ' github=%s' "${GH_SHA:0:9}"
    printf ' as_of=%s out=%s\n' "$AS_OF" "$OUT"
  fi
  exit "$rc"
}

is_sha() { printf '%s' "$1" | grep -qE '^[0-9a-f]{40}$'; }

# ── 取数：Gitea 侧（远端真值；绝不读本地同名分支）─────────────────────────────
gitea_read() {
  local out
  out="$(git -C "$ROOT" ls-remote "$GITEA_URL" "$GITEA_REF" 2>/dev/null | awk 'NR==1{print $1}')"   # swallow-ok: 不可达由返回空判定 ⇒ degraded exit 2
  [ -n "$out" ] && is_sha "$out" || return 1
  GITEA_SHA="$out"
}

# ── 取数：GitHub 侧（注入缝 → gh → 匿名 API；三路都失败 ⇒ degraded）────────────
gh_read() {
  if [ -n "$GH_SHA_INJ" ]; then
    is_sha "$GH_SHA_INJ" || return 1
    GH_SHA="$GH_SHA_INJ"; return 0
  fi
  local out=""
  if command -v gh >/dev/null 2>&1; then
    out="$(gh api "$GH_API/commits/main" --jq .sha 2>/dev/null)"   # swallow-ok: 失败回退匿名 API
  fi
  if [ -z "$out" ]; then
    out="$(curl -fsS --max-time 15 "$GH_API/commits/main" 2>/dev/null | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' | head -1)"   # swallow-ok: 失败 ⇒ degraded exit 2
  fi
  [ -n "$out" ] && is_sha "$out" || return 1
  GH_SHA="$out"
}

# ── 本地具备该 commit？缺则补取（只补该 ref，不覆盖分支）──────────────────────
ensure_local() {  # $1=sha $2=url $3=ref
  local sha="$1" url="$2" ref="$3"
  git -C "$ROOT" cat-file -e "$sha^{commit}" 2>/dev/null && return 0   # swallow-ok: 缺 commit ⇒ 走补取
  git -C "$ROOT" fetch -q --no-tags "$url" "$ref" >/dev/null 2>&1 || true   # swallow-ok: 补取失败由下一次 cat-file 判定
  git -C "$ROOT" cat-file -e "$sha^{commit}" 2>/dev/null
}

command -v git >/dev/null 2>&1 || finish 2 DEGRADED git_missing
[ -e "$ROOT/.git" ] || git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || finish 2 DEGRADED not_a_repo

gitea_read || finish 2 DEGRADED gitea_unreadable
gh_read    || finish 2 DEGRADED github_unreadable

ensure_local "$GITEA_SHA" "$GITEA_URL" "$GITEA_REF" || finish 2 DEGRADED gitea_sha_not_local
ensure_local "$GH_SHA" "https://github.com/synova-agent/SynovaAgent.git" main \
  || finish 2 DEGRADED github_sha_not_local

# ── 判定：祖先（分叉）＋ 落后数 ────────────────────────────────────────────────
git -C "$ROOT" merge-base --is-ancestor "$GH_SHA" "$GITEA_SHA" 2>/dev/null   # swallow-ok: rc 捕获后三态判定
mb=$?
case "$mb" in
  0) ANCESTOR=true ;;
  1) ANCESTOR=false; finish 1 FORK "github_main_not_ancestor" ;;
  *) finish 2 DEGRADED merge_base_failed ;;
esac

LAG="$(git -C "$ROOT" rev-list --count "$GH_SHA..$GITEA_SHA" 2>/dev/null)"   # swallow-ok: 失败 ⇒ 下方非数字判 degraded
[[ "$LAG" =~ ^[0-9]+$ ]] || finish 2 DEGRADED rev_list_failed

if [ "$LAG" = "0" ]; then
  finish 0 OK
else
  finish 1 LAG
fi
