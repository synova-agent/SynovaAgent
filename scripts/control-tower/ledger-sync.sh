#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# ledger-sync.sh — 把 local-main 的 merge 提交自动同步进 #918 §G（裁 367 一期）
#
# @input   环境: GITEA_TOKEN（或 ~/gitea/.win-push-token）
#          可选: SYNO_LEDGER_SYNC_STATE（默认 <root>/.claude/ledger-sync.state）
#          可选: SYNO_LEDGER_ISSUE（默认 918）
# @output  dry-run: 打印待追加的 §G 行；--apply: 插入 #918 §G 表末并更新 state
# @exit    0 = 正常（含"无新增"）；1 = 实际失败（API 写失败）；2 = 自身失败（无 token/无网/非 git 仓）
# @degraded 无 token ⇒ stderr `E_TOKEN` + exit 2；网络/API 不可用 ⇒ `E_NET` + exit 2
# 已知限制: 行内"验收要点"无法自动生成，统一写"自动同步"；state 文件不跨机（路径见 SYNO_LEDGER_SYNC_STATE）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

APPLY=0; LIMIT=20
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --limit) LIMIT="${2:-20}"; shift
      case "$LIMIT" in ''|*[!0-9]*) echo "E_USAGE: --limit 须为非负整数（拿到 ${LIMIT}）" >&2; exit 2 ;; esac ;;
    --help|-h) echo "用法: $0 [--apply] [--limit N]"; exit 0 ;;
    *) echo "用法: $0 [--apply] [--limit N]" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "E_GIT: 不在 git 仓内" >&2; exit 2; }
STATE="${SYNO_LEDGER_SYNC_STATE:-$ROOT/.claude/ledger-sync.state}"
ISSUE="${SYNO_LEDGER_ISSUE:-918}"
TOKEN="${GITEA_TOKEN:-$(cat "$HOME/gitea/.win-push-token" 2>/dev/null || true)}"
[ -n "$TOKEN" ] || { echo "E_TOKEN: 无 GITEA_TOKEN（或 ~/gitea/.win-push-token）" >&2; exit 2; }

LAST="$(cat "$STATE" 2>/dev/null || true)"
if [ -z "$LAST" ]; then
  LAST="$(git rev-parse -q --verify "$(git rev-list --merges -n1 HEAD)~1" 2>/dev/null || true)"
fi
[ -n "$LAST" ] || { echo "E_GIT: 无法确定同步起点（无 state 且无 merge 提交）" >&2; exit 2; }

GITLOG="$(git log --merges --format='%H%x09%s' "$LAST"..HEAD | head -n "$LIMIT")"
ROWS="$(printf '%s\n' "$GITLOG" | python3 -c '
import sys, re
for line in sys.stdin:
    line = line.rstrip("\n")
    if not line: continue
    h, _, s = line.partition("\t")
    m = re.search(r"#(\d+)", s)
    n = m.group(1) if m else "?"
    t = re.sub(r"^Merge pull request ", "", s)
    t = re.sub(r"^Merge PR #\d+:\s*", "", t)
    t = re.sub(r"\x27?\s+from\s+\S+(\s+into\s+.*)?$", "", t).strip(chr(39))
    t = t.replace("|", "/")[:70]
    print("| %s | `%s` | 自动同步（详见 #%s） |" % (t, h[:9], n))
')"

if [ -z "$ROWS" ]; then echo "LEDGER-SYNC: 无新增 merge（起点 ${LAST:0:9}）"; exit 0; fi
echo "$ROWS"
if [ "$APPLY" != "1" ]; then
  echo "LEDGER-SYNC: dry-run（加 --apply 写入 #${ISSUE} §G）"
  exit 0
fi

NEW_STATE="$(git log --merges --format='%H' "$LAST"..HEAD | head -n 1)"
[ -n "$NEW_STATE" ] || NEW_STATE=""

if [ "${SYNO_LEDGER_SYNC_MOCK_WRITE:-}" = "1" ]; then
  echo "LEDGER-SYNC: MOCK_WRITE（测试接缝：跳过 API，仅写 state）"
  rc=0
else
GITEA_TOKEN="$TOKEN" ISSUE="$ISSUE" ROWS="$ROWS" python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error
tok = os.environ["GITEA_TOKEN"]; issue = os.environ["ISSUE"]; rows = os.environ["ROWS"]
base = "http://127.0.0.1:3000/api/v1/repos/synova-agent/SynovaAgent"
def api(url, data=None, method="GET"):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None,
        headers={"Authorization": "token " + tok, "Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            b = r.read(); return json.loads(b) if b else None
    except urllib.error.HTTPError as e:
        print("E_API: HTTP %d %s" % (e.code, e.read()[:200].decode(errors="replace")), file=sys.stderr); sys.exit(1)
    except Exception as e:
        print("E_NET: %s" % e, file=sys.stderr); sys.exit(2)
d = api("%s/issues/%s" % (base, issue))
body = d.get("body") or ""
marker = "> 说明：**\"已收口\"≠"
if marker not in body:
    print("E_MARKER: #%s 缺 §G 表尾标记" % issue, file=sys.stderr); sys.exit(2)
if rows.strip() and rows.strip() in body:
    print("E_DUP: 行已存在（幂等跳过）", file=sys.stderr); sys.exit(0)
body = body.replace(marker, rows.rstrip() + "\n\n" + marker, 1)
api("%s/issues/%s" % (base, issue), {"body": body}, "PATCH")
print("LEDGER-SYNC: 已写入 #%s §G（%d 行）" % (issue, len(rows.strip().split("\n"))))
PY
rc=$?
fi
[ "$rc" = "0" ] || exit "$rc"
if [ -n "${NEW_STATE:-}" ]; then
  mkdir -p "$(dirname "$STATE")" && printf '%s' "$NEW_STATE" > "$STATE"
  echo "LEDGER-SYNC: state 更新为 ${NEW_STATE:0:9}"
fi
exit 0
