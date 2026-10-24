#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# auto-merge.sh — 四条件 can 且**非受保护路径**的 PR 自动合并（裁 367 一期；自动化裁 354 A 档）
#
# @input   环境: GITEA_TOKEN（或 ~/gitea/.win-push-token）
#          文件: .gitea/protected-files.txt（受保护清单）
#          可选: SYNO_AUTO_MERGE_BASE（check-merge-conditions 的 base，默认 gitea/local-main）
# @output  每个 open PR 一行判定：`AUTO-MERGE: <pr> 可自动合` / `SKIP <pr>: <原因>`
# @exit    0 = 正常（含无可合项）；1 = --apply 时有 PR 合并失败；2 = 自身失败（E_TOKEN/E_NET/E_GIT）
# @degraded 无 token ⇒ `E_TOKEN`；环境不可用 ⇒ `E_ENV`；git 不可用 ⇒ `E_GIT`；网络/API ⇒ `E_NET`；合并被拒 ⇒ `E_MERGE`
# 测试接缝: SYNO_AUTO_MERGE_FORCE_CAN=1 跳过四条件（仅供配对测试，禁止生产使用）
# 已知限制: 只判"路径是否受保护"与四条件；**不做语义裁决**（A 类必须人批，见裁 354）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D520/V5 平台敏感命令规避（PLATFORM-CHECKLIST.md #1）：**禁裸 python3**
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（含 PYBIN 标记）
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
[ -z "$PYBIN" ] && { echo "E_ENV: python 不可用（python3/python/py 均不可用）" >&2; exit 2; }

APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --help|-h) echo "用法: $0 [--apply]"; exit 0 ;;
    *) echo "用法: $0 [--apply]" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "E_GIT: 不在 git 仓内" >&2; exit 2; }
PROTECTED="$ROOT/.gitea/protected-files.txt"
[ -f "$PROTECTED" ] || { echo "E_GIT: 缺 $PROTECTED" >&2; exit 2; }
TOKEN="${GITEA_TOKEN:-$(cat "$HOME/gitea/.win-push-token" 2>/dev/null || true)}"
API="${SYNO_GITEA_BASE:-http://127.0.0.1:3000/api/v1/repos/synova-agent/SynovaAgent}"
[ -n "$TOKEN" ] || { echo "E_TOKEN: 无 GITEA_TOKEN（或 ~/gitea/.win-push-token）" >&2; exit 2; }

is_protected() {
  local p="$1" pat
  shopt -s nocasematch 2>/dev/null || true
  while IFS= read -r pat; do
    case "$pat" in ''|\#*) continue ;; esac
    # shellcheck disable=SC2254
    case "$p" in $pat) return 0 ;; esac
  done < "$PROTECTED"
  shopt -u nocasematch 2>/dev/null || true
  return 1
}

if ! OPEN_PRS="$(GITEA_TOKEN="$TOKEN" SYNO_GITEA_BASE="$API" "$PYBIN" - <<'PY'

import json, os, sys, urllib.request, urllib.error
tok=os.environ["GITEA_TOKEN"]; base=os.environ["SYNO_GITEA_BASE"]
def api(u):
    r=urllib.request.Request(u,headers={"Authorization":"token "+tok})
    try:
        with urllib.request.urlopen(r, timeout=10) as x: return json.load(x)
    except Exception as e:
        print("E_NET: %s" % e, file=sys.stderr); sys.exit(2)
out=[]; page=1
while True:
    d=api("%s/pulls?state=open&limit=50&page=%d" % (base,page))
    if not d: break
    for p in d:
        if p.get("draft") or p.get("merged_at"): continue
        out.append("%d\t%s\t%s" % (p["number"], p["head"]["sha"], p["base"]["ref"]))
    page+=1
    if page > 20:
        print("E_NET: 列表分页超过 20 页仍未结束（服务端异常）", file=sys.stderr); sys.exit(2)
print("\n".join(out))
PY
)"; then
  echo "E_NET: open PR 列表获取失败（fail-closed，不当作\"无 PR\"）" >&2
  exit 2
fi
[ -n "$OPEN_PRS" ] || { echo "AUTO-MERGE: 无 open PR"; exit 0; }

FAIL=0
while IFS=$'\t' read -r N HEAD BASE; do
  [ -n "$N" ] || continue
  if [ "${SYNO_AUTO_MERGE_FORCE_CAN:-}" = "1" ]; then
    COND="MERGE-COND: can（测试接缝 SYNO_AUTO_MERGE_FORCE_CAN=1）"
  else
    COND="$(cd "$ROOT" && SYNO_MERGE_BASE="${SYNO_AUTO_MERGE_BASE:-}" bash scripts/control-tower/check-merge-conditions.sh --pr "$N" 2>&1 | tail -1)"
    case "$COND" in
      *"MERGE-COND: can"*) : ;;
      *) echo "SKIP $N: 四条件未满足 -- ${COND}"; continue ;;
    esac
  fi
  if ! FILES="$(GITEA_TOKEN="$TOKEN" PR="$N" SYNO_GITEA_BASE="$API" "$PYBIN" - <<'PY'

import json, os, sys, urllib.request
tok=os.environ["GITEA_TOKEN"]; pr=os.environ["PR"]
out=[]; page=1
while True:
    u="%s/pulls/%s/files?limit=50&page=%d" % (os.environ["SYNO_GITEA_BASE"], pr, page)
    r=urllib.request.Request(u,headers={"Authorization":"token "+tok})
    try:
        with urllib.request.urlopen(r, timeout=10) as x: d=json.load(x)
    except Exception as e:
        print("E_NET: %s" % e, file=sys.stderr); sys.exit(2)
    if not d: break
    for f in d:
        out.append(f.get("filename",""))
        pf = f.get("previous_filename")
        if pf: out.append(pf)
    page += 1
    if page > 20:
        print("E_NET: 文件分页超过 20 页仍未结束（服务端异常）", file=sys.stderr); sys.exit(2)
print("\n".join(out))
PY
)"; then
    echo "E_NET: PR $N 变更文件获取失败 ⇒ fail-closed（禁止在看不见时合并）" >&2
    exit 2
  fi
  [ -n "$FILES" ] || { echo "E_NET: PR $N 变更文件为空 ⇒ fail-closed" >&2; exit 2; }
  HIT=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if is_protected "$f"; then HIT="$f"; break; fi
  done <<< "$FILES"
  if [ -n "$HIT" ]; then
    echo "SKIP $N: 触受保护路径 ${HIT} ⇒ B 档由 CTO 合"
    continue
  fi
  if [ "$APPLY" = "1" ]; then
    if GITEA_TOKEN="$TOKEN" PR="$N" SYNO_GITEA_BASE="$API" "$PYBIN" - <<'PY'
import json, os, sys, urllib.request, urllib.error
tok=os.environ["GITEA_TOKEN"]; pr=os.environ["PR"]
u="%s/pulls/%s/merge" % (os.environ["SYNO_GITEA_BASE"], pr)
req=urllib.request.Request(u, data=json.dumps({"Do":"merge","delete_branch_after_merge":False}).encode(),
    headers={"Authorization":"token "+tok,"Content-Type":"application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=15) as x: x.read()
except urllib.error.HTTPError as e:
    print("E_MERGE: %s" % e.read()[:200].decode(errors="replace"), file=sys.stderr); sys.exit(1)
PY
    then echo "AUTO-MERGE: $N 已合并"; else echo "AUTO-MERGE: $N 合并失败"; FAIL=1; fi
  else
    echo "AUTO-MERGE: $N 可自动合 (dry-run; 加 --apply 执行)"
  fi
done <<< "$OPEN_PRS"

[ "$FAIL" = "0" ] && exit 0 || exit 1
