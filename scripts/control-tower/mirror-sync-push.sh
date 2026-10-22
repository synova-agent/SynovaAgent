#!/usr/bin/env bash
# D732 UTF-8 强制（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null   # swallow-ok: locale 不可用时回退默认 locale（非错误路径）
# ═══════════════════════════════════════════════════════════════════════════════
# mirror-sync-push.sh — 双仓镜像「对账 → 门禁放行 → 推送 → 核 SHA → 可见信号」（任务 #740）
#
# 【一句话】一条命令做完每天那趟镜像同步：一致就收工；落后且能安全快进就自动推；
#   分叉就住手；推完回头核 SHA，对不上算降级；任何失败都在 Gitea 上留一张能看见的单子。
#
# 【设计哲学】一个分离 ＋ 五条承诺
#   · 一个分离：**判据归门禁/探针，本脚本只做编排**。
#     一致/落后/分叉 ⇒ `check-dual-repo-sync.sh`（远端真值，只读）；
#     mirror main 放行/留痕/pending ⇒ `pre-push-check.sh` 门禁 0-2（同一判据，不另写一套）；
#     推后核 SHA ⇒ `pre-push-check.sh --verify-mirror-sync`（#657 既有模式）。
#     本脚本**不新造任何判定** ⇒ 不可能与门禁口径分叉（防双真源）。
#   · 承诺 1「看不见 ≠ 没问题」：任一远端读不到 / sha 形态非法 / lag 非数字 / JSON 写不出
#     ⇒ **exit 2（degraded）**，绝不当通过（铁律 11）。
#   · 承诺 2「分叉住手」：non-ff ⇒ 拒推 + exit 1，**绝不 merge / 绝不 force**（镜像只读）。
#   · 承诺 3「推完必须核」：推成功不算完，远端 main 必须等于推的 sha（判据④，硬门）。
#   · 承诺 4「失败必须出声」：失败/降级在 Gitea 留 issue；发不出时显式打 `SIGNAL-FAILED`
#     并把退出码升为 2（判据⑤：不许只写 log）。
#   · 承诺 5「只走正规通道」：**不用 SYNO_ALLOW_MAIN_PUSH**、`--force`、`--no-verify`。
#
# 契约（铁律 47 / P10 守则 §八之三②）:
#   @input  --json         stdout 只出 JSON（人读行改走 stderr）
#           --dry-run      只判定不推送
#           --no-signal    不发信号（生产禁开；调用方自负责）
#           --help
#           环境缝（默认值 = 生产值）:
#             SYNO_PUSH_REPO                目标树（缺省 = 本脚本上两级）
#             SYNO_PUSH_GITEA_URL           Gitea 远端（缺省 gitea；透传探针）
#             SYNO_PUSH_GITEA_REF           Gitea 侧 ref（缺省 refs/heads/local-main）
#             SYNO_PUSH_MIRROR_REMOTE       镜像远端名（缺省 mirror；门禁 0-2 认这个名字）
#             SYNO_PUSH_GITHUB_SHA          注入缝（测试）：直接给定 GitHub main sha
#             SYNO_PUSH_SSH_CMD             推送用 SSH 命令（缺省 deploy key）
#             SYNO_PUSH_WATCH_CI            auto|off（缺省 auto）：推后/一致时都观察 GitHub 集成测试
#                                           （一致时也看：镜像停在旧 sha 但 CI 红，同样必须可见）
#             SYNO_PUSH_GH_REPO             GitHub 仓库全名（缺省 synova-agent/SynovaAgent）
#             SYNO_PUSH_CI_TIMEOUT          等 CI 的最长秒数（缺省 900）
#             SYNO_PUSH_CI_INTERVAL         轮询间隔秒（缺省 20）
#             SYNO_PUSH_CI_CMD              注入缝（测试）：参数=sha，输出 "id|conclusion|url[|失败job]"
#             SYNO_PUSH_GH_TOKEN_FILE       GitHub token 文件（缺省试 ~/.dsh/.credentials.yaml）；
#                                           用于 launchd/无 keychain 场景（实测 gh 在 launchd 下不可靠）
#             SYNO_PUSH_VERIFY_TRIES        核 SHA 重试次数（缺省 3）
#             SYNO_PUSH_VERIFY_INTERVAL     重试间隔秒（缺省 5）
#             SYNO_PUSH_OUT                 结果 JSON 路径
#             SYNO_PUSH_MIRROR_LOG          门禁留痕路径（缺省 <repo>/.claude/mirror-sync.log）
#             SYNO_PUSH_MIRROR_PENDING      门禁 pending（缺省 <repo>/.claude/mirror-sync.pending）
#             SYNO_PUSH_STATUS              auto|off（缺省 auto）：每趟更新常驻状态单
#             SYNO_PUSH_STATUS_TITLE        状态单标题（缺省 [AUTO] 镜像同步状态（自动更新））
#             SYNO_PUSH_STATUS_HIST         历史 JSONL（缺省 ~/Library/Logs/synova-mirror-sync-history.jsonl）
#                                           🔴 共享位置：不同 checkout 各写各的会把状态单覆盖成单行（实测）
#             SYNO_PUSH_STATUS_CMD          注入缝（测试）：状态载荷走该命令 stdin
#             SYNO_PUSH_SIGNAL              auto|off（缺省 auto）
#             SYNO_PUSH_SIGNAL_CMD          注入缝（测试）：载荷走该命令的 stdin
#             SYNO_PUSH_GITEA_API           Gitea API 前缀（缺省 http://127.0.0.1:3000/api/v1）
#             SYNO_PUSH_GITEA_REPO          仓库全名（缺省 synova-agent/SynovaAgent）
#             SYNO_PUSH_GITEA_TOKEN_FILE    token 文件（缺省 /Users/wane/gitea/.win-push-token）
#             SYNO_PUSH_ISSUE_TITLE         失败单标题（缺省 [AUTO] 双仓镜像同步失败）
#             SYNO_PUSH_RUN_URL             写入单子的运行地址（CI 由 workflow 传）
#             SYNO_PUSH_TEST_AFTER_PUSH     注入缝（测试）：推送成功后、核 SHA 前执行
#   @output stdout: 末行 `MIRROR-SYNC-PUSH: <verdict> ...`；--json 时为结果 JSON
#           file:   <OUT>（schema syno-mirror-push/v1）
#   @exit   0 = 一致（NOOP）／推送且核 SHA 相等（PUSHED）／dry-run
#           1 = 真红（分叉拒推 FORK ／ 门禁或远端拒推 PUSH_REJECTED）
#           2 = 检查自身失败（DEGRADED / VERIFY_MISMATCH / 信号发不出）
#   @degraded 写 <OUT>（degraded=true + reason）＋ 尽力发信号；**禁静默**
#   @error   code ∈ {E_REPO_MISSING, E_PROBE_MISSING, E_GATE_MISSING, E_PROBE_DEGRADED,
#                    E_FORK, E_PUSH_REJECTED, E_VERIFY_MISMATCH, E_OUT_UNWRITABLE,
#                    E_SIGNAL_FAILED, E_USAGE}
#
# 授权（explicit authority）: 调用者 = 本机 launchd 每日任务（com.synova.mirror-sync）
#   ＋ Gitea workflow `dual-repo-sync` 的 workflow_dispatch。不要求任何提权参数。
#   写权限仅限：<repo>/.claude/（门禁留痕，gitignored）、<OUT>、Gitea issue。
#
# 已知限制（Known Limitations）:
#   1. **不测触发器存活**：launchd/runner 挂了本脚本不会被调用（判据⑥ 靠日志证据，不归本脚本）。
#   2. **不做"滞后是否可接受"的豁免**：lag>0 且 ff ⇒ 必推（与探针承诺一致）。
#   3. **推送时若目标树已装 pre-push 钩子**，门禁会再跑一次同一判据（幂等，仅多一行 ALLOW 留痕）。
#   4. **Gitea issue 通道依赖本机 token 文件**；无权限/无网络 ⇒ `SIGNAL-FAILED` 显式降级行 + exit 2。
#   5. **只处理 main 一条腿**（镜像契约 = GitHub main 单分支只读镜像）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# D520 清单第 1 条：禁裸 python3（Windows 只有 python/py -3；损坏 shim 要探可用性）
PYBIN=""
for _c in python3 python py; do   # PYBIN 探测器自身（D520 清单第 1 条），非调用
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBE="$SCRIPT_DIR/check-dual-repo-sync.sh"
GATE="$SCRIPT_DIR/../pre-push-check.sh"

REPO="${SYNO_PUSH_REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
GITEA_URL="${SYNO_PUSH_GITEA_URL:-gitea}"
GITEA_REF="${SYNO_PUSH_GITEA_REF:-refs/heads/local-main}"
MIRROR="${SYNO_PUSH_MIRROR_REMOTE:-mirror}"
SSH_CMD="${SYNO_PUSH_SSH_CMD:-ssh -i $HOME/.ssh/synova_gh_deploy -o IdentitiesOnly=yes -o BatchMode=yes}"
CI_WATCH="${SYNO_PUSH_WATCH_CI:-auto}"
CI_TIMEOUT="${SYNO_PUSH_CI_TIMEOUT:-900}"
CI_INTERVAL="${SYNO_PUSH_CI_INTERVAL:-20}"
GH_REPO_SLUG="${SYNO_PUSH_GH_REPO:-synova-agent/SynovaAgent}"
GH_TOKEN_FILE="${SYNO_PUSH_GH_TOKEN_FILE:-$HOME/.dsh/.credentials.yaml}"
VERIFY_TRIES="${SYNO_PUSH_VERIFY_TRIES:-3}"
VERIFY_INTERVAL="${SYNO_PUSH_VERIFY_INTERVAL:-5}"
OUT="${SYNO_PUSH_OUT:-$REPO/.codex/control-tower/tmp/mirror-sync-push.json}"
MIRROR_LOG="${SYNO_PUSH_MIRROR_LOG:-$REPO/.claude/mirror-sync.log}"
MIRROR_PENDING="${SYNO_PUSH_MIRROR_PENDING:-$REPO/.claude/mirror-sync.pending}"
SIGNAL_MODE="${SYNO_PUSH_SIGNAL:-auto}"
STATUS_MODE="${SYNO_PUSH_STATUS:-auto}"
STATUS_TITLE="${SYNO_PUSH_STATUS_TITLE:-[AUTO] 镜像同步状态（自动更新）}"
STATUS_HIST="${SYNO_PUSH_STATUS_HIST:-$HOME/Library/Logs/synova-mirror-sync-history.jsonl}"
GITEA_API="${SYNO_PUSH_GITEA_API:-http://127.0.0.1:3000/api/v1}"
GITEA_REPO="${SYNO_PUSH_GITEA_REPO:-synova-agent/SynovaAgent}"
TOKEN_FILE="${SYNO_PUSH_GITEA_TOKEN_FILE:-/Users/wane/gitea/.win-push-token}"
ISSUE_TITLE="${SYNO_PUSH_ISSUE_TITLE:-[AUTO] 双仓镜像同步失败}"

JSON_ONLY=0; DRY=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON_ONLY=1 ;;
    --dry-run) DRY=1 ;;
    --no-signal) SIGNAL_MODE=off ;;
    --help|-h) sed -n '4,70p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ E_USAGE 未知参数: ${arg}（--help 看用法）" >&2; exit 2 ;;
  esac
done

AS_OF="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GITEA_SHA=""; GH_SHA=""; LAG=""; ANCESTOR=""; PUSHED_SHA=""; VERDICT=""; SIGNAL_STATE="none"; CI_RESULT="off"; CI_DETAIL=""

say()     { [ "$JSON_ONLY" = "1" ] && return 0; echo "$*"; }
say_err() { echo "$*" >&2; }

_json() { "$PYBIN" -c 'import json,sys; print(json.dumps(sys.argv[1], ensure_ascii=False))' "$1" 2>/dev/null || printf '"%s"' "$1"; }

write_json() {  # $1=exit $2=verdict $3=reason
  local rc="$1" verdict="$2" reason="${3:-}"
  mkdir -p "$(dirname "$OUT")" 2>/dev/null || return 1   # swallow-ok: 写不出 ⇒ 调用方判 degraded exit 2
  {
    printf '{\n'
    printf '  "schema": "syno-mirror-push/v1",\n'
    printf '  "as_of": "%s",\n' "$AS_OF"
    printf '  "repo": %s,\n' "$(_json "$REPO")"
    printf '  "gitea": {"url": %s, "ref": "%s", "sha": "%s"},\n' "$(_json "$GITEA_URL")" "$GITEA_REF" "${GITEA_SHA:-}"
    printf '  "github": {"sha": "%s"},\n' "${GH_SHA:-}"
    printf '  "lag": %s,\n' "${LAG:-null}"
    printf '  "ff_safe": %s,\n' "${ANCESTOR:-null}"
    printf '  "pushed_sha": "%s",\n' "${PUSHED_SHA:-}"
    printf '  "verdict": "%s",\n' "$verdict"
    printf '  "reason": %s,\n' "$(_json "$reason")"
    printf '  "degraded": %s,\n' "$([ "$rc" = "2" ] && echo true || echo false)"
    printf '  "ci": "%s",\n' "$CI_RESULT"
    printf '  "ci_detail": %s,\n' "$(_json "$CI_DETAIL")"
    printf '  "signal": "%s",\n' "$SIGNAL_STATE"
    printf '  "exit": %s\n' "$rc"
    printf '}\n'
  } > "$OUT" 2>/dev/null || return 1   # swallow-ok: 同上（写失败 ⇒ degraded）
  return 0
}

# ── 信号（判据⑤）：失败开单／再失败评论／恢复关单 ───────────────────────────────
_signal_payload() {  # $1=kind $2=verdict $3=reason
  local kind="$1" verdict="$2" reason="$3"
  SYNO_SF_TITLE="$ISSUE_TITLE" SYNO_SF_KIND="$kind" SYNO_SF_VERDICT="$verdict" \
  SYNO_SF_REASON="$reason" SYNO_SF_ASOF="$AS_OF" SYNO_SF_GITEA="${GITEA_SHA:-}" \
  SYNO_SF_GITHUB="${GH_SHA:-}" SYNO_SF_LAG="${LAG:-}" SYNO_SF_PUSHED="${PUSHED_SHA:-}" \
  SYNO_SF_RUN="${SYNO_PUSH_RUN_URL:-}" \
  "$PYBIN" - <<'PY'
import json,os
e=os.environ
p={k:(e.get("SYNO_SF_"+k.upper(),"") or "") for k in ("title","kind","verdict","reason","asof","gitea","github","lag","pushed","run")}
print(json.dumps(p, ensure_ascii=False))
PY
}

list_open_issue_no() {  # $1=token → stdout: 同名失败单号（可能为空）
  local tok="$1" raw=""
  raw="$(curl -fsS --max-time 15 -G -H "Authorization: token $tok" \
      --data-urlencode "state=open" --data-urlencode "limit=50" --data-urlencode "q=双仓镜像同步失败" \
      "$GITEA_API/repos/$GITEA_REPO/issues" 2>/dev/null || true)"   # swallow-ok: 读不到 ⇒ 空 ⇒ 调用方走新建分支
  [ -n "$raw" ] || return 0
  printf '%s' "$raw" | SYNO_ISSUE_TITLE="$ISSUE_TITLE" "$PYBIN" -c '
import json,sys,os
try: arr=json.load(sys.stdin)
except Exception: raise SystemExit(0)
t=os.environ["SYNO_ISSUE_TITLE"]
for i in arr:
    if (i.get("title") or "")==t: print(i["number"]); break
' 2>/dev/null || true   # swallow-ok: 解析失败 ⇒ 空 ⇒ 走新建分支（不静默：issue 建不成会打 SIGNAL-FAILED）
}

status_update() {  # $1=exit $2=verdict $3=reason —— B 层：常驻状态单（每趟 PATCH 正文）
  local rc="$1" verdict="$2" reason="${3:-}" payload tok issue_no body
  [ "$STATUS_MODE" = "off" ] && return 0
  mkdir -p "$(dirname "$STATUS_HIST")" 2>/dev/null || true   # swallow-ok: 目录建不出 ⇒ 下方显式 STATUS-UNREACHABLE
  printf '{"as_of":"%s","verdict":"%s","reason":%s,"lag":%s,"gitea":"%s","github":"%s","pushed":"%s","exit":%s}\n' \
    "$AS_OF" "$verdict" "$(_json "$reason")" "${LAG:-null}" "${GITEA_SHA:-}" "${GH_SHA:-}" "${PUSHED_SHA:-}" "$rc" \
    >> "$STATUS_HIST" 2>/dev/null || true   # swallow-ok: 历史仅供渲染，写不出不阻断（下方显式提示）
  if [ -f "$STATUS_HIST" ]; then
    tail -10 "$STATUS_HIST" > "$STATUS_HIST.tmp" 2>/dev/null && mv "$STATUS_HIST.tmp" "$STATUS_HIST" 2>/dev/null || true   # swallow-ok: 截断失败不影响本轮
  fi

  if [ -n "${SYNO_PUSH_STATUS_CMD:-}" ]; then
    payload="$(printf '{"title": %s, "verdict": "%s", "as_of": "%s", "lag": %s, "exit": %s}' \
      "$(_json "$STATUS_TITLE")" "$verdict" "$AS_OF" "${LAG:-null}" "$rc")"
    printf '%s\n' "$payload" | sh -c "$SYNO_PUSH_STATUS_CMD" >/dev/null 2>&1 && return 0
    say_err "STATUS-UNREACHABLE reason=status_cmd_failed（状态单未更新；不改变本趟结论）"; return 0
  fi

  command -v curl >/dev/null 2>&1 || { say_err "STATUS-UNREACHABLE reason=curl_missing"; return 0; }
  [ -r "$TOKEN_FILE" ] || { say_err "STATUS-UNREACHABLE reason=token_unreadable"; return 0; }
  tok="$(tr -d '\r\n' < "$TOKEN_FILE")"
  body="$(SYNO_ST_HIST="$STATUS_HIST" SYNO_ST_TITLE="$STATUS_TITLE" SYNO_ST_LAST="$verdict" \
    SYNO_ST_ASOF="$AS_OF" SYNO_ST_GITEA="${GITEA_SHA:-}" SYNO_ST_GITHUB="${GH_SHA:-}" \
    SYNO_ST_LAG="${LAG:-}" SYNO_ST_PUSHED="${PUSHED_SHA:-}" SYNO_ST_EXIT="$rc" "$PYBIN" - <<'PY'
import json,os
e=os.environ
rows=[]
try:
    for line in open(e["SYNO_ST_HIST"],encoding="utf-8"):
        line=line.strip()
        if not line: continue
        try: rows.append(json.loads(line))
        except Exception: continue
except Exception:
    pass
rows=rows[-10:]
md=["# 镜像同步状态（自动更新，请勿手改）","",
    "- 最近一次：**%s**（as_of %s，exit %s）"%(e.get("SYNO_ST_LAST",""),e.get("SYNO_ST_ASOF",""),e.get("SYNO_ST_EXIT","")),
    "- 两仓 sha：Gitea `%s` | GitHub `%s`"%(e.get("SYNO_ST_GITEA","") or "<未读到>", e.get("SYNO_ST_GITHUB","") or "<未读到>"),
    "- 落后：%s"%(e.get("SYNO_ST_LAG","") or "-"),
    "- 已推：%s"%(e.get("SYNO_ST_PUSHED","") or "-"),"",
    "| 时间(as_of) | 结论 | 落后 | Gitea | GitHub | 已推 | exit |","|---|---|---|---|---|---|---|"]
for r in reversed(rows):
    _lag = "-" if r.get("lag") is None else r.get("lag")
    md.append("| %s | %s | %s | `%s` | `%s` | `%s` | %s |"%(
        (r.get("as_of") or "")[:19], r.get("verdict",""), _lag,
        (r.get("gitea") or "-")[:9], (r.get("github") or "-")[:9], (r.get("pushed") or "-")[:9], r.get("exit","")))
md += ["","说明：本单由 mirror-sync-push.sh 每趟自动 PATCH 正文；失败/恢复历史留在评论里。",
       "判据与处置见 handbook 派单件/2026-10-20-规格-740-镜像自动推送.md。"]
print(json.dumps("\n".join(md), ensure_ascii=False))
PY
)"
  issue_no="$(curl -fsS --max-time 15 -G -H "Authorization: token $tok" \
      --data-urlencode "state=open" --data-urlencode "limit=50" --data-urlencode "q=镜像同步状态" \
      "$GITEA_API/repos/$GITEA_REPO/issues" 2>/dev/null \
    | SYNO_ISSUE_TITLE="$STATUS_TITLE" "$PYBIN" -c '
import json,sys,os
try: arr=json.load(sys.stdin)
except Exception: raise SystemExit(0)
t=os.environ["SYNO_ISSUE_TITLE"]
for i in arr:
    if (i.get("title") or "")==t: print(i["number"]); break
' 2>/dev/null || true)"   # swallow-ok: 读不到 ⇒ 走新建分支（建不出会打 STATUS-UNREACHABLE）
  if [ -n "$issue_no" ]; then
    curl -fsS --max-time 15 -X PATCH -H "Authorization: token $tok" -H "Content-Type: application/json" \
      -d "$(printf '{"body":%s}' "$body")" "$GITEA_API/repos/$GITEA_REPO/issues/$issue_no" >/dev/null 2>&1 && return 0
  else
    curl -fsS --max-time 15 -X POST -H "Authorization: token $tok" -H "Content-Type: application/json" \
      -d "$(printf '{"title":%s,"body":%s}' "$(_json "$STATUS_TITLE")" "$body")" \
      "$GITEA_API/repos/$GITEA_REPO/issues" >/dev/null 2>&1 && return 0
  fi
  say_err "STATUS-UNREACHABLE reason=issue_write_failed（状态单未更新；不改变本趟结论）"
  return 0
}

signal_fail() {  # $1=code $2=verdict $3=reason
  local code="${1:-E_SIGNAL_FAILED}" verdict="${2:-}" reason="${3:-}" payload tok
  [ "$SIGNAL_MODE" = "off" ] && { SIGNAL_STATE="off"; return 0; }
  payload="$(_signal_payload failure "$verdict" "$reason")"
  if [ -n "${SYNO_PUSH_SIGNAL_CMD:-}" ]; then
    if printf '%s\n' "$payload" | sh -c "$SYNO_PUSH_SIGNAL_CMD" >/dev/null 2>&1; then
      SIGNAL_STATE="sent"; return 0
    fi
    SIGNAL_STATE="failed"; say_err "🔴 SIGNAL-FAILED code=${code}（注入命令失败；判据⑤ 未满足）"; return 1
  fi
  command -v curl >/dev/null 2>&1 || { SIGNAL_STATE="failed"; say_err "🔴 SIGNAL-FAILED code=$code curl_missing"; return 1; }
  [ -r "$TOKEN_FILE" ] || { SIGNAL_STATE="failed"; say_err "🔴 SIGNAL-FAILED code=$code token_unreadable=$TOKEN_FILE"; return 1; }
  tok="$(tr -d '\r\n' < "$TOKEN_FILE")"
  local body payload_json open_no
  body="$(SYNO_SB_TITLE="$ISSUE_TITLE" SYNO_SB_VERDICT="$verdict" SYNO_SB_REASON="$reason" \
    SYNO_SB_ASOF="$AS_OF" SYNO_SB_GITEA="${GITEA_SHA:-}" SYNO_SB_GITHUB="${GH_SHA:-}" \
    SYNO_SB_LAG="${LAG:-}" SYNO_SB_PUSHED="${PUSHED_SHA:-}" SYNO_SB_RUN="${SYNO_PUSH_RUN_URL:-}" \
    "$PYBIN" - <<'PY'
import json,os
e=os.environ
md=f"""自动镜像同步失败（由 `mirror-sync-push.sh` 每趟自动开/评单）。

- 结论：{e.get('SYNO_SB_VERDICT','')}
- 原因：{e.get('SYNO_SB_REASON','')}
- as_of：{e.get('SYNO_SB_ASOF','')}
- Gitea local-main：{e.get('SYNO_SB_GITEA','') or '<未读到>'}
- GitHub main：{e.get('SYNO_SB_GITHUB','') or '<未读到>'}
- 落后提交：{e.get('SYNO_SB_LAG','') or '<未知>'}
- 已推 sha：{e.get('SYNO_SB_PUSHED','') or '<未推>'}
- 运行地址：{e.get('SYNO_SB_RUN','') or '<非 CI 运行>'}

处置与判据见 handbook `派单件/2026-10-20-规格-740-镜像自动推送.md`；恢复后本单会被自动评论并关闭。
"""
print(json.dumps(md, ensure_ascii=False))
PY
)"
  payload_json="$(_json "$payload")"
  open_no="$(list_open_issue_no "$tok")" || true   # swallow-ok: 读不到 ⇒ 走新建分支（下面按失败分支判）
  if [ -n "$open_no" ]; then
    if curl -fsS --max-time 15 -X POST -H "Authorization: token $tok" -H "Content-Type: application/json" \
        -d "$(printf '{"body":%s}' "$payload_json")" \
        "$GITEA_API/repos/$GITEA_REPO/issues/$open_no/comments" >/dev/null 2>&1; then
      SIGNAL_STATE="commented:#$open_no"; return 0
    fi
  elif curl -fsS --max-time 15 -X POST -H "Authorization: token $tok" -H "Content-Type: application/json" \
      -d "$(printf '{"title":%s,"body":%s}' "$(_json "$ISSUE_TITLE")" "$body")" \
      "$GITEA_API/repos/$GITEA_REPO/issues" >/dev/null 2>&1; then
    SIGNAL_STATE="created"; return 0
  fi
  SIGNAL_STATE="failed"
  say_err "🔴 SIGNAL-FAILED code=${code}（Gitea issue 未建成/未评论；判据⑤ 未满足，需人工看 CI 日志）"
  return 1
}

signal_recover() {
  local tok open_no
  [ "$SIGNAL_MODE" = "off" ] && return 0
  if [ -n "${SYNO_PUSH_SIGNAL_CMD:-}" ]; then
    printf '%s\n' "$(_signal_payload recovery "${VERDICT:-}" "ok")" | sh -c "$SYNO_PUSH_SIGNAL_CMD" >/dev/null 2>&1 || true
    return 0
  fi
  command -v curl >/dev/null 2>&1 || return 0
  [ -r "$TOKEN_FILE" ] || return 0
  tok="$(tr -d '\r\n' < "$TOKEN_FILE")"
  open_no="$(list_open_issue_no "$tok")" || true   # swallow-ok: 恢复信号是加分项，失败不改 verdict
  [ -z "$open_no" ] && return 0
  curl -fsS --max-time 15 -X POST -H "Authorization: token $tok" -H "Content-Type: application/json" \
    -d "$(printf '{"body":%s}' "$(_json "已恢复：${VERDICT}（as_of ${AS_OF}，两仓一致或推送后核 SHA 相等）⇒ 自动关单。")")" \
    "$GITEA_API/repos/$GITEA_REPO/issues/$open_no/comments" >/dev/null 2>&1 || true   # swallow-ok: 同上
  curl -fsS --max-time 15 -X PATCH -H "Authorization: token $tok" -H "Content-Type: application/json" \
    -d '{"state":"closed"}' "$GITEA_API/repos/$GITEA_REPO/issues/$open_no" >/dev/null 2>&1 || true   # swallow-ok: 同上
  return 0
}

norm_reason() { printf '%s' "$1" | sed -E 's/run=[0-9]+//g; s#url=[^ ]+##g; s/[[:space:]]+/ /g' | sed 's/^ *//; s/ *$//'; }

prev_sig_key() {  # 读历史最后一行的 verdict|归一化reason（用于去重；读不到 ⇒ 空 ⇒ 照常发信号）
  [ -f "$STATUS_HIST" ] || return 0
  tail -1 "$STATUS_HIST" 2>/dev/null | "$PYBIN" -c '
import json,sys
try: r=json.load(sys.stdin)
except Exception: raise SystemExit(0)
import re
_rs=re.sub(r"run=\d+","",r.get("reason","") or "")
_rs=re.sub(r"url=\S+","",_rs)
_rs=" ".join(_rs.split())
stage=(_rs.split(" ",1)[0] if _rs else "")
print("%s|%s"%(r.get("verdict",""), stage))
' 2>/dev/null || true   # swallow-ok: 历史坏了 ⇒ 空键 ⇒ 照常发信号（不静默：信号照发）
}

finish() {  # $1=exit $2=verdict $3=reason $4=fail|recover|""
  local rc="$1" verdict="$2" reason="${3:-}" sig="${4:-}"
  VERDICT="$verdict"
  if [ "$verdict" = "NOOP" ] && [ -f "$STATUS_HIST" ]; then
    if ! grep -q "$GITEA_SHA" "$STATUS_HIST" 2>/dev/null && [ "$(wc -l < "$STATUS_HIST" 2>/dev/null || echo 0)" -gt 0 ]; then
      say_err "ℹ️ MIRROR-ADVANCED-ELSEWHERE sha=${GITEA_SHA:0:9}（本执行器历史里无此 sha ⇒ 有别的通道推过；本趟只核一致/CI，不认领该次推送）"
      CI_DETAIL="${CI_DETAIL} source=external"
    fi
  fi
  case "$sig" in
    fail)
      _stage="$(norm_reason "$reason")"; _stage="${_stage%% *}"
      if [ "$(prev_sig_key)" = "${verdict}|${_stage}" ]; then
        SIGNAL_STATE="deduped"     # 与上一趟同一结论 ⇒ 不重复开/评单（历史仍记一行）
      else
        signal_fail "E_${verdict}" "$verdict" "$reason" || rc=2
      fi ;;
    recover) [ "$rc" = "0" ] && signal_recover ;;
  esac
  status_update "$rc" "$verdict" "$reason" || true   # B 层：常驻状态单（失败显式 STATUS-UNREACHABLE，不改结论）
  if ! write_json "$rc" "$verdict" "$reason"; then
    echo "MIRROR-SYNC-PUSH: DEGRADED reason=E_OUT_UNWRITABLE out=$OUT"
    exit 2
  fi
  if [ "$JSON_ONLY" = "1" ]; then cat "$OUT"; else
    printf 'MIRROR-SYNC-PUSH: %s' "$verdict"
    [ -n "$reason" ]    && printf ' reason=%s' "$reason"
    [ -n "$LAG" ]       && printf ' lag=%s' "$LAG"
    [ -n "$GITEA_SHA" ] && printf ' gitea=%s' "${GITEA_SHA:0:9}"
    [ -n "$GH_SHA" ]    && printf ' github=%s' "${GH_SHA:0:9}"
    [ -n "$PUSHED_SHA" ] && printf ' pushed=%s' "${PUSHED_SHA:0:9}"
    printf ' signal=%s ci=%s as_of=%s out=%s\n' "$SIGNAL_STATE" "$CI_RESULT" "$AS_OF" "$OUT"
  fi
  exit "$rc"
}

gh_token() {  # 依次：环境变量 → token 文件里的 GITHUB_TOKEN → 空
  local t="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  [ -n "$t" ] && { printf '%s' "$t"; return 0; }
  [ -r "$GH_TOKEN_FILE" ] || return 0
  awk -F': *' '/^[[:space:]]*GITHUB_TOKEN:/{gsub(/["\r]/,"",$2); print $2; exit}' "$GH_TOKEN_FILE" 2>/dev/null || true   # swallow-ok: 无该键 ⇒ 空 ⇒ 上层判 unknown
}

ci_query() {  # $1=sha → stdout "id|conclusion|url[|failing_jobs]"；读不到 ⇒ 非 0
  local sha="$1" tok
  if [ -n "${SYNO_PUSH_CI_CMD:-}" ]; then
    sh -c "$SYNO_PUSH_CI_CMD $sha"
    return $?
  fi
  tok="$(gh_token)"
  [ -z "$tok" ] && return 1
  SYNO_CI_SHA="$sha" SYNO_CI_REPO="$GH_REPO_SLUG" SYNO_CI_TOK="$tok" "$PYBIN" - <<'PY'
import json,os,sys,urllib.request
sha=os.environ["SYNO_CI_SHA"]; repo=os.environ["SYNO_CI_REPO"]; tok=os.environ["SYNO_CI_TOK"]
def get(u):
    r=urllib.request.Request(u,headers={"Authorization":"token "+tok,"Accept":"application/vnd.github+json","User-Agent":"mirror-sync-push"})
    return json.load(urllib.request.urlopen(r,timeout=20))
try:
    runs=get("https://api.github.com/repos/%s/actions/runs?per_page=50"%repo).get("workflow_runs",[])
except Exception:
    sys.exit(1)
mine=[r for r in runs if (r.get("head_sha") or "")==sha and "CI" in (r.get("name") or "")]
if not mine:
    sys.exit(1)
r=sorted(mine,key=lambda x:x.get("created_at") or "")[-1]
concl=r.get("conclusion") or r.get("status") or ""
jobs=""
if concl=="failure":
    try:
        js=get("https://api.github.com/repos/%s/actions/runs/%s/jobs?per_page=100"%(repo,r["id"])).get("jobs",[])
        jobs=" / ".join(j["name"] for j in js if j.get("conclusion")=="failure")
    except Exception:
        jobs=""
print("%s|%s|%s|%s"%(r["id"],concl,r.get("html_url",""),jobs))
PY
}

ci_watch() {  # $1=被推 sha —— 观察 GitHub 集成测试；结果写 CI_RESULT/CI_DETAIL
  local sha="$1" deadline=$(( $(date +%s) + CI_TIMEOUT )) out id concl url jobs run_id
  [ "$CI_WATCH" = "off" ] && { CI_RESULT="off"; return 0; }
  CI_RESULT="unknown"
  while [ "$(date +%s)" -lt "$deadline" ]; do
    out="$(ci_query "$sha")"   # swallow-ok: 读不到 ⇒ 下一轮重试；超时统一判 unknown（下面显式发信号）
    if [ -n "$out" ]; then
      id="${out%%|*}"; rest="${out#*|}"; concl="${rest%%|*}"; rest2="${rest#*|}"; url="${rest2%%|*}"
      case "$concl" in
        success) CI_RESULT="green"; CI_DETAIL="run=$id url=$url"; return 0 ;;
        failure|cancelled|timed_out|startup_failure|action_required)
          CI_RESULT="red"
          jobs="${rest2#*|}"; [ "$jobs" = "$rest2" ] && jobs=""
          CI_DETAIL="run=$id url=$url 失败job=${jobs:-<未取到>}"
          return 0 ;;
        *) : ;;   # queued/in_progress ⇒ 继续等
      esac
    fi
    sleep "$CI_INTERVAL"
  done
  CI_DETAIL="等满 ${CI_TIMEOUT}s 仍未出结论（禁当通过）"
  return 0
}

is_sha() { printf '%s' "$1" | grep -qE '^[0-9a-f]{40}$'; }
jq_py()  { "$PYBIN" -c "import json,sys; d=json.load(sys.stdin); $1" 2>/dev/null || true; }   # swallow-ok: 解析失败 ⇒ 空 ⇒ 下方 sha 形态自检判降级（不静默）

# ── 0. 前置 ───────────────────────────────────────────────────────────────────
[ -e "$REPO/.git" ] || git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || finish 2 DEGRADED E_REPO_MISSING fail
[ -f "$PROBE" ] || finish 2 DEGRADED E_PROBE_MISSING fail
[ -f "$GATE" ]  || finish 2 DEGRADED E_GATE_MISSING fail
[ -n "$PYBIN" ] || finish 2 DEGRADED E_NO_PYTHON fail   # 铁律 11：显式降级，不静默

# ── 1. 对账（唯一判据源：探针；远端真值，不读本地同名分支指针）─────────────────
PROBE_JSON="$(SYNO_SYNC_REPO="$REPO" SYNO_SYNC_GITEA_URL="$GITEA_URL" SYNO_SYNC_GITEA_REF="$GITEA_REF" \
  SYNO_SYNC_GITHUB_SHA="${SYNO_PUSH_GITHUB_SHA:-}" bash "$PROBE" --json 2>/dev/null)"; PROBE_RC=$?   # swallow-ok: rc 即三态判据
GITEA_SHA="$(printf '%s' "$PROBE_JSON" | jq_py 'print((d.get("gitea") or {}).get("sha") or "")')"
GH_SHA="$(printf '%s' "$PROBE_JSON" | jq_py 'print((d.get("github") or {}).get("sha") or "")')"
LAG="$(printf '%s' "$PROBE_JSON" | jq_py 'v=d.get("lag"); print("" if v is None else v)')"
ANCESTOR="$(printf '%s' "$PROBE_JSON" | jq_py 'v=d.get("ancestor"); print("true" if v is True else ("false" if v is False else "null"))')"
[ -z "$ANCESTOR" ] && ANCESTOR="null"

# 判别力自检：读不到 sha ⇒ 绝不判绿（禁把"看不见"当"没问题"）
is_sha "$GITEA_SHA" || finish 2 DEGRADED E_PROBE_DEGRADED fail
is_sha "$GH_SHA"    || finish 2 DEGRADED E_PROBE_DEGRADED fail

case "$PROBE_RC" in
  0)                                                        # 判据①：一致 ⇒ 不推；但**镜像侧 CI 也要核**
     ci_watch "$GITEA_SHA"
     case "$CI_RESULT" in
       green|off) finish 0 NOOP "" recover ;;
       red)       finish 2 MIRROR_CI_RED "镜像已就位但 GitHub CI 红：$CI_DETAIL" fail ;;
       *)         finish 2 MIRROR_CI_UNKNOWN "$CI_DETAIL" fail ;;
     esac ;;
  1) : ;;                                                   # 落后或分叉 ⇒ 下面分流
  *) finish 2 DEGRADED E_PROBE_DEGRADED fail ;;
esac

# 判据③ 先于 lag：探针在 FORK 分支不算 lag
case "$ANCESTOR" in
  true)  : ;;
  false) finish 1 FORK E_FORK fail ;;          # 明确分叉 ⇒ 拒推（真红）
  *)     finish 2 DEGRADED E_PROBE_DEGRADED fail ;;   # 祖先关系判不出 ⇒ 检查自身失败（三态纪律）
esac
printf '%s' "$LAG" | grep -qE '^[0-9]+$' || finish 2 DEGRADED E_PROBE_DEGRADED fail
[ "$LAG" -gt 0 ] || finish 2 DEGRADED E_PROBE_DEGRADED fail # 判据②前提不成立却报落后 ⇒ 降级
[ "$DRY" = "1" ] && finish 0 DRYRUN "will_push=$LAG" ""

# ── 2. 门禁放行（0-2 mirror：ff 校验 ＋ ALLOW 留痕 ＋ pending）；正规通道，无逃生舱 ──
MIRROR_URL="$(git -C "$REPO" ls-remote --get-url "$MIRROR" 2>/dev/null)"   # swallow-ok: 取不到 ⇒ 下面判红
[ -n "$MIRROR_URL" ] || finish 1 PUSH_REJECTED E_PUSH_REJECTED fail
if ! printf '%s %s %s %s\n' "$GITEA_SHA" "$GITEA_SHA" "refs/heads/main" "$GH_SHA" \
  | ( cd "$REPO" && SYNO_SYNC_ONLY=1 SYNO_MIRROR_SYNC_LOG="$MIRROR_LOG" \
      SYNO_MIRROR_PENDING="$MIRROR_PENDING" bash "$GATE" "$MIRROR" "$MIRROR_URL" ) >/dev/null 2>&1; then
  finish 1 PUSH_REJECTED E_PUSH_REJECTED fail                 # 门禁拒（非 ff／缺 sha）⇒ 真红，不推
fi

# ── 3. 推送（deploy key；同一门禁，不经 --no-verify）────────────────────────────
if ! GIT_SSH_COMMAND="$SSH_CMD" git -C "$REPO" push "$MIRROR" "$GITEA_SHA:refs/heads/main" >/dev/null 2>&1; then
  finish 1 PUSH_REJECTED E_PUSH_REJECTED fail
fi
PUSHED_SHA="$GITEA_SHA"
say "✅ 已推 ${PUSHED_SHA:0:9} → $MIRROR/main（$LAG 提交）"

[ -n "${SYNO_PUSH_TEST_AFTER_PUSH:-}" ] && sh -c "$SYNO_PUSH_TEST_AFTER_PUSH" >/dev/null 2>&1   # 注入缝（测试）

# ── 4. 推后核 SHA（判据④：不等 ⇒ exit 2；复用门禁 --verify-mirror-sync）──────────
i=1; VERIFY_OK=0
while [ "$i" -le "$VERIFY_TRIES" ]; do
  if ( cd "$REPO" && SYNO_MIRROR_SYNC_LOG="$MIRROR_LOG" SYNO_MIRROR_PENDING="$MIRROR_PENDING" \
        bash "$GATE" --verify-mirror-sync ) >/dev/null 2>&1; then VERIFY_OK=1; break; fi
  [ "$i" -lt "$VERIFY_TRIES" ] && sleep "$VERIFY_INTERVAL"
  i=$((i + 1))
done
[ "$VERIFY_OK" = "1" ] || finish 2 VERIFY_MISMATCH E_VERIFY_MISMATCH fail

# ── 5. 推后观察 GitHub 集成测试（判据④的延伸：镜像"能打开"不等于"测试过了"）──────────
ci_watch "$PUSHED_SHA"
case "$CI_RESULT" in
  green|off) : ;;
  red)     finish 2 CI_RED "github_ci_failed $CI_DETAIL" fail ;;
  *)       finish 2 CI_UNKNOWN "$CI_DETAIL" fail ;;
esac

finish 0 PUSHED "" recover
