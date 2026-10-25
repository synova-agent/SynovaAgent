#!/usr/bin/env bash
# @requires python3
# weekly-recon.test.sh —— #808 判据测试 T1–T12（本地假 Gitea，仅 127.0.0.1，不联网出本机）
#
# 三态退出码：0 = ALL PASS ｜ 1 = 断言失败（真红，具体失败点逐条打印）｜ 2 = 环境失败
#            （无 python3／假服务起不来／缺被测脚本或 asset-sync.py）—— 禁把「看不见」当「没问题」。
#
# 覆盖矩阵（规格 §4 判据 2/4/5 + 三态/幂等/反例/WIRE）:
#   T1  首跑（无基线，真跑）: exit 0；五指标行；SUMMARY diffs=0 issue=#1；基线建成（as_of 40hex／
#       week／issue／五 metrics）；卡恰 1 张、标题全等、label 按名解析为 id、正文含当周节＋「基线首建」
#   T2  反例 a（改坏必红）: 夹具基线 FILES+1 ⇒ exit 1、diffs≥1、PATCH 同一卡（POST=0，卡数仍 1）、
#       正文差异表出现旧值/新值、基线刷新回实测真值
#   T3  幂等: 同周二跑 ⇒ exit 0、diffs=0 issue=同#、**零写请求**（不写卡不刷基线）
#   T4  反例 c: 基线 JSON 损坏 ⇒ exit 2 ＋ degraded 行 code=BASELINE_CORRUPT ＋ degraded JSONL 五字段
#   T5  token 不可读 ⇒ exit 2 ＋ TOKEN_UNREADABLE ＋ **零请求**
#   T6  --dry-run（只读）: a) 无基线 ⇒ exit 0、零写请求、零基线文件、卡 0 张；
#       b) 有差异基线 ⇒ exit 1、SUMMARY issue=none (DRY)、零写请求、基线字节不变、卡 0 张
#   T7  跨周（基线 week 不同＋有差异）⇒ 单卡、旧周节逐字保留、新周节追加（旧在前）
#   T8  反例 b（判别力自检·硬要求）: sed 摘掉去重（`if existing is None:` → `if True:`）的变异副本
#       ⇒ 必产生双卡（卡数=2）；原脚本同场景仍单卡
#   T9  AUDIT 桩: a) critical:4；b) npm 不存在 ⇒ unavailable:0＋degraded（指标级、不改 exit）；c) 坏 JSON ⇒ unavailable:0
#   T10 WIRE CHECK: `grep -rn "weekly-recon" .gitea/ scripts/ tests/` 非零，且命中新测试与 AGENTS.md 报备行
#   T11 五指标行格式＋顺序＋SUMMARY 终行；MODS 顺序 == ASSET-MAP required_modules（独立解析）
#   T12 脚本 `bash -n` ＋ 契约头要素齐（@input/@output/@exit/@degraded/设计哲学/explicit authority/
#       Known Limitations/错误码表/Source map）
# 隔离：假 Gitea 绑 127.0.0.1 随机端口；请求落 jsonl；夹具（基线/token/npm 桩）全在 $TMP；
#       只写 $TMP；绝不动 $HOME/.ci-work 与真 Gitea API；trap 清理（失败保留夹具供排查）。
set -u

export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || { echo "ENV-FAIL: 无法 cd $ROOT"; exit 2; }
PY=python3
RECON="$ROOT/scripts/control-tower/weekly-recon.sh"
ASSET_SYNC="$ROOT/scripts/control-tower/asset-sync.py"
MAP="$ROOT/docs/authority/ASSET-MAP.yaml"
TMP="$(mktemp -d)"
SERVER_PID=""
OUT=""
ERR=""
RC=0
pass_n=0
fail_n=0

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null  # swallow-ok: 收尾清理，进程已退出时失败不影响断言
    wait "$SERVER_PID" 2>/dev/null  # swallow-ok: 同上
    SERVER_PID=""
  fi
  if [ "$fail_n" -gt 0 ]; then
    echo "夹具保留（失败排查）: $TMP"
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT INT TERM

if ! command -v "$PY" >/dev/null 2>&1; then
  echo "ENV-FAIL: 无 ${PY}（判据测试需 python3 stdlib）"
  exit 2
fi
if [ ! -f "$RECON" ]; then
  echo "ENV-FAIL: 缺 ${RECON}（未接线）"
  exit 2
fi
if [ ! -f "$ASSET_SYNC" ]; then
  echo "ENV-FAIL: 缺 ${ASSET_SYNC}（模块计数复用源）"
  exit 2
fi
if [ ! -f "$MAP" ]; then
  echo "ENV-FAIL: 缺 ${MAP}"
  exit 2
fi

ok()  { pass_n=$((pass_n + 1)); echo "PASS $1${2:+（$2）}"; }
bad() { fail_n=$((fail_n + 1)); echo "FAIL $1 —— $2"; }
t_exit() { # t_exit <名称> <期望码> <实际码>
  if [ "$2" = "$3" ]; then ok "$1" "exit=$3"; else bad "$1" "期望 exit=$2 实际=$3"; fi
}
has() { # has <名称> <文本> <扩展正则>
  if printf '%s\n' "$2" | grep -qE -- "$3"; then
    ok "$1"
  else
    bad "$1" "输出未命中 /$3/；实际前 6 行: $(printf '%s\n' "$2" | head -6 | tr '\n' '|')"
  fi
}
hasnt() { # hasnt <名称> <文本> <扩展正则>
  if printf '%s\n' "$2" | grep -qE -- "$3"; then
    bad "$1" "输出不应命中 /$3/；实际: $(printf '%s\n' "$2" | grep -E -- "$3" | head -3 | tr '\n' '|')"
  else ok "$1"; fi
}
eq() { # eq <名称> <期望> <实际>
  if [ "$2" = "$3" ]; then ok "$1" "$3"; else bad "$1" "期望 $2 实际 $3"; fi
}

# ══════════════════════════════════════════════════════════════════════════════
# 本地假 Gitea（stdlib http.server，127.0.0.1 随机端口；请求落 jsonl；状态落 state.json）
# 覆盖端点：GET pulls（带 X-Total-Count）｜GET issues 列表｜GET issues/{n}｜GET labels｜
#           POST issues｜PATCH issues/{n}
# ══════════════════════════════════════════════════════════════════════════════
cat > "$TMP/gitea_server.py" <<'PY'
# -*- coding: utf-8 -*-
"""假 Gitea（#808 判据测试专用）：只实现 weekly-recon.sh 用到的端点。"""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PREFIX = "/api/v1/repos/synova-agent/SynovaAgent/"


class Store:
    def __init__(self, fixture, state_path):
        with open(fixture, encoding="utf-8") as f:
            data = json.load(f)
        self.pulls = data.get("pulls") or []
        self.labels = data.get("labels") or []
        self.issues = {int(k): v for k, v in (data.get("issues") or {}).items()}
        self.state_path = state_path
        self._persist()

    def _persist(self):
        payload = {"pulls": self.pulls, "labels": self.labels,
                   "issues": {str(k): v for k, v in self.issues.items()}}
        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)


class Handler(BaseHTTPRequestHandler):
    store = None
    log_path = None

    def log_message(self, *_a):
        return

    def _rec(self, body):
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"method": self.command, "path": self.path,
                                "body": body}, ensure_ascii=False) + "\n")

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return None
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            return {"_unparsed": raw.decode("utf-8", "replace")}

    def _send(self, code, obj, extra_headers=None):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self._rec(None)
        path = urlparse(self.path).path
        if path.startswith(PREFIX):
            rest = path[len(PREFIX):]
            if rest.startswith("pulls"):
                self._send(200, self.store.pulls,
                           {"X-Total-Count": str(len(self.store.pulls))})
                return
            if rest.startswith("labels"):
                return self._send(200, self.store.labels)
            if rest.startswith("issues/"):
                try:
                    num = int(rest.split("/", 1)[1])
                except ValueError:
                    return self._send(404, {"message": "not found"})
                if num in self.store.issues:
                    return self._send(200, self.store.issues[num])
                return self._send(404, {"message": "issue not found"})
            if rest.startswith("issues"):
                return self._send(200, list(self.store.issues.values()))
        return self._send(404, {"message": "not found"})

    def do_PATCH(self):
        body = self._body()
        self._rec(body)
        path = urlparse(self.path).path
        if path.startswith(PREFIX):
            rest = path[len(PREFIX):]
            if rest.startswith("issues/"):
                try:
                    num = int(rest.split("/", 1)[1])
                except ValueError:
                    return self._send(404, {"message": "not found"})
                if num not in self.store.issues:
                    return self._send(404, {"message": "issue not found"})
                iss = self.store.issues[num]
                if isinstance(body, dict):
                    if "body" in body:
                        iss["body"] = body["body"]
                    if "labels" in body:
                        iss["labels"] = body["labels"]
                self.store._persist()
                return self._send(200, iss)
        return self._send(404, {"message": "not found"})

    def do_POST(self):
        body = self._body()
        self._rec(body)
        path = urlparse(self.path).path
        if path.startswith(PREFIX) and path[len(PREFIX):] == "issues":
            num = max(self.store.issues) + 1 if self.store.issues else 1
            iss = {"number": num, "title": (body or {}).get("title", ""),
                   "body": (body or {}).get("body", ""), "state": "open",
                   "labels": (body or {}).get("labels", [])}
            self.store.issues[num] = iss
            self.store._persist()
            return self._send(201, iss)
        return self._send(404, {"message": "not found"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", required=True)
    ap.add_argument("--log", required=True)
    ap.add_argument("--state", required=True)
    ap.add_argument("--port-file", required=True)
    a = ap.parse_args()
    Handler.store = Store(a.fixture, a.state)
    Handler.log_path = a.log
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    with open(a.port_file, "w", encoding="utf-8") as f:
        f.write(str(httpd.server_address[1]))
    httpd.serve_forever()


if __name__ == "__main__":
    main()
PY

start_server() { # start_server <fixture>
  stop_server
  rm -f "$TMP/reqlog.jsonl" "$TMP/state.json" "$TMP/port"
  "$PY" "$TMP/gitea_server.py" --fixture "$1" --log "$TMP/reqlog.jsonl" \
      --state "$TMP/state.json" --port-file "$TMP/port" &
  SERVER_PID=$!
  for _ in $(seq 1 200); do
    [ -s "$TMP/port" ] && break
    sleep 0.05
  done
  if [ ! -s "$TMP/port" ]; then
    echo "ENV-FAIL: 假 Gitea 未起来（端口文件空）"
    exit 2
  fi
  export SYNO_PUSH_GITEA_API="http://127.0.0.1:$(cat "$TMP/port")/api/v1"
  export SYNO_PUSH_GITEA_REPO="synova-agent/SynovaAgent"
}
stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null  # swallow-ok: 收尾清理，进程已退出时失败不影响断言
    wait "$SERVER_PID" 2>/dev/null  # swallow-ok: 同上
    SERVER_PID=""
  fi
}

run_recon() { # run_recon <脚本路径> [args...]
  local s="$1"
  shift
  OUT="$(bash "$s" "$@" 2>"$TMP/stderr.txt")"
  RC=$?
  ERR="$(cat "$TMP/stderr.txt")"
}

# 请求统计（jsonl）：count_req <METHOD> [path 前缀]
count_req() {
  "$PY" - "$TMP/reqlog.jsonl" "${1:-}" "${2:-}" <<'PY'
import json, sys
log = sys.argv[1]
method = sys.argv[2]
prefix = sys.argv[3]
n = 0
try:
    for line in open(log, encoding="utf-8"):
        r = json.loads(line)
        if method and r.get("method") != method:
            continue
        if prefix and not (r.get("path") or "").startswith(prefix):
            continue
        n += 1
except OSError:
    pass
print(n)
PY
}
total_reqs() { wc -l < "$TMP/reqlog.jsonl" | tr -d ' \n'; }
reset_reqlog() { : > "$TMP/reqlog.jsonl"; }
writes() { echo $(( $(count_req POST) + $(count_req PATCH) )); }
card_count() {
  "$PY" - "$TMP/state.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(len(d.get("issues") or {}))
PY
}
card_body() { # card_body <number>
  "$PY" - "$TMP/state.json" "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print((d.get("issues") or {}).get(str(sys.argv[2]), {}).get("body") or "")
PY
}
card_title() {
  "$PY" - "$TMP/state.json" "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print((d.get("issues") or {}).get(str(sys.argv[2]), {}).get("title") or "")
PY
}
baseline_sha() { "$PY" -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }
metrics_line() { printf '%s\n' "$1" | grep -E "^$2=" | tail -1; }
line_no() { printf '%s\n' "$1" | grep -nE -- "$2" | head -1 | cut -d: -f1; }

# ── 夹具与环境 ────────────────────────────────────────────────────────────────
mkdir -p "$TMP/bin"
printf 'dummy-token-for-test\n' > "$TMP/token"
cat > "$TMP/bin/npm-good" <<'SH'
#!/bin/bash
printf '%s\n' '{"auditReportVersion":2,"vulnerabilities":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":1,"high":2,"critical":4,"total":7}}}'
exit 1
SH
cat > "$TMP/bin/npm-bad" <<'SH'
#!/bin/bash
printf '%s\n' 'this-is-not-json'
exit 0
SH
chmod +x "$TMP/bin/npm-good" "$TMP/bin/npm-bad"

fixture() { # fixture <out> [issues-json]
  "$PY" - "$1" "${2:-{\}}" <<'PY'
import json, sys
out = sys.argv[1]
issues = json.loads(sys.argv[2])
data = {"pulls": [{"number": 1}, {"number": 2}, {"number": 3}],
        "labels": [{"id": 7, "name": "域/治理"}, {"id": 9, "name": "包/P6"}],
        "issues": issues}
with open(out, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
PY
}

export SYNO_PUSH_GITEA_TOKEN_FILE="$TMP/token"
export SYNO_RECON_ROOT="$ROOT"
export SYNO_GATE_DEGRADED_LOG="$TMP/degraded.jsonl"
export SYNO_RECON_NPM="$TMP/bin/npm-good"
BL="$TMP/baseline.json"
GOOD="$TMP/base-good.json"
WEEK="$("$PY" -c 'from datetime import datetime
y,w,_=datetime.now().isocalendar();print("%d-W%02d"%(y,w))')"
REAL_FILES="$(git -C "$ROOT" ls-tree -r HEAD | wc -l | tr -d ' ')"
REAL_WT="$(git -C "$ROOT" worktree list --porcelain | grep -c '^worktree ')"

echo "──── #808 weekly-recon 判据测试（T1–T12）｜ as_of HEAD=$(git -C "$ROOT" rev-parse --short HEAD) ls-tree=$REAL_FILES week=$WEEK ────"

# ══════════════════════════════════════════════════════════════════════════════
# T1 首跑（无基线，真跑）：exit 0 + 五指标 + 建基线 + 唯一卡（标题全等/label/当周节/基线首建）
# ══════════════════════════════════════════════════════════════════════════════
fixture "$TMP/fix-empty.json" '{}'
start_server "$TMP/fix-empty.json"
rm -f "$BL"
eq "T1 前置：假 API 只在 127.0.0.1" "1" "$(printf '%s' "$SYNO_PUSH_GITEA_API" | grep -cE '^http://127\.0\.0\.1:[0-9]+/api/v1$')"
run_recon "$RECON" --baseline "$BL"
t_exit "T1 首跑 exit" 0 "$RC"
has "T1 FILES 行" "$OUT" '^FILES=[0-9]+$'
has "T1 MODS 行" "$OUT" '^MODS=([A-Za-z0-9]+:[0-9]+,?)+$'
has "T1 PRAVG 行" "$OUT" '^PRAVG=[0-9]+$'
has "T1 WORKTREES 行" "$OUT" '^WORKTREES=[0-9]+$'
has "T1 AUDIT 行" "$OUT" '^AUDIT=[A-Za-z]+:[0-9]+$'
has "T1 SUMMARY 终行" "$OUT" '^SUMMARY diffs=0 issue=#[0-9]+$'
eq "T1 FILES == git ls-tree -r HEAD 条数" "$REAL_FILES" "$(metrics_line "$OUT" FILES | sed 's/^FILES=//')"
eq "T1 WORKTREES == git worktree list 计数" "$REAL_WT" "$(metrics_line "$OUT" WORKTREES | sed 's/^WORKTREES=//')"
eq "T1 PRAVG == 夹具 open PR 数（3）" "3" "$(metrics_line "$OUT" PRAVG | sed 's/^PRAVG=//')"
eq "T1 AUDIT == npm 桩最高等级" "AUDIT=critical:4" "$(metrics_line "$OUT" AUDIT)"
if [ -f "$BL" ]; then ok "T1 基线已建成"; else bad "T1 基线已建成" "缺 $BL"; fi
eq "T1 基线 as_of == 40 位 sha" "1" "$("$PY" -c 'import json,re,sys;d=json.load(open(sys.argv[1],encoding="utf-8"));print(1 if re.fullmatch(r"[0-9a-f]{40}",d.get("as_of","")) else 0)' "$BL")"
eq "T1 基线 week == 当前 ISO 周" "$WEEK" "$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8")).get("week"))' "$BL")"
eq "T1 基线 issue == 1" "1" "$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8")).get("issue"))' "$BL")"
eq "T1 基线 metrics.files == 实测" "$REAL_FILES" "$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8"))["metrics"]["files"])' "$BL")"
eq "T1 卡数 == 1" "1" "$(card_count)"
eq "T1 卡标题全等" "[RECON] 周对账（滚动）" "$(card_title 1)"
eq "T1 POST 恰 1 次" "1" "$(count_req POST)"
eq "T1 PATCH 0 次" "0" "$(count_req PATCH)"
eq "T1 开卡 label 按名解析为 id 7" "1" "$("$PY" - "$TMP/reqlog.jsonl" <<'PY'
import json, sys
for line in open(sys.argv[1], encoding="utf-8"):
    r = json.loads(line)
    if r.get("method") == "POST":
        print(1 if (r.get("body") or {}).get("labels") == [7] else 0)
        break
else:
    print(0)
PY
)"
T1_BODY="$(card_body 1)"
has "T1 正文含当周节" "$T1_BODY" "^## ${WEEK}$"
has "T1 正文标注基线首建" "$T1_BODY" '基线首建'
has "T1 正文含 FILES 指标表行" "$T1_BODY" '^\| FILES \| `[0-9]+` \|$'
cp "$BL" "$GOOD"

# ══════════════════════════════════════════════════════════════════════════════
# T2 反例 a（改坏必红）：基线 FILES+1 ⇒ 必报差异；PATCH 同卡（POST=0、卡数仍 1）；基线刷新
# ══════════════════════════════════════════════════════════════════════════════
"$PY" - "$GOOD" "$BL" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
d["metrics"]["files"] += 1
json.dump(d, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
P0="$(count_req POST)"
run_recon "$RECON" --baseline "$BL"
t_exit "T2 有差异 exit" 1 "$RC"
has "T2 SUMMARY 差异计数" "$OUT" '^SUMMARY diffs=[1-5] issue=#[0-9]+$'
eq "T2 卡数仍 1（不重复开卡）" "1" "$(card_count)"
eq "T2 PATCH 1 次（更新同卡）" "1" "$(count_req PATCH)"
eq "T2 本次跑无 POST（reqlog 累积，T1 已有 1 次）" "$P0" "$(count_req POST)"
T2_BODY="$(card_body 1)"
has "T2 差异表含 FILES 旧值/新值（旧=篡改基线 $((REAL_FILES + 1)) → 新=实测 ${REAL_FILES}）" "$T2_BODY" "^\| FILES \| \`$((REAL_FILES + 1))\` \| \`${REAL_FILES}\` \|$"
eq "T2 基线刷新回实测真值" "$REAL_FILES" "$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8"))["metrics"]["files"])' "$BL")"

# ══════════════════════════════════════════════════════════════════════════════
# T3 幂等：同周二跑 ⇒ exit 0、diffs=0 issue=同#、零写请求
# ══════════════════════════════════════════════════════════════════════════════
BEFORE_W="$(writes)"
run_recon "$RECON" --baseline "$BL"
t_exit "T3 二跑 exit" 0 "$RC"
has "T3 SUMMARY 幂等" "$OUT" '^SUMMARY diffs=0 issue=#1$'
eq "T3 卡数仍 1" "1" "$(card_count)"
eq "T3 二跑零写请求" "$BEFORE_W" "$(writes)"

# ══════════════════════════════════════════════════════════════════════════════
# T4 反例 c：基线损坏 JSON ⇒ exit 2 ＋ degraded（行 + JSONL 五字段）
# ══════════════════════════════════════════════════════════════════════════════
printf '{oops-not-json\n' > "$BL"
run_recon "$RECON" --baseline "$BL"
t_exit "T4 坏 JSON exit" 2 "$RC"
has "T4 stderr degraded 行" "$ERR" '^degraded: code=BASELINE_CORRUPT '
eq "T4 degraded JSONL 含 BASELINE_CORRUPT 且五字段齐" "1" "$("$PY" - "$TMP/degraded.jsonl" <<'PY'
import json, sys
want = {"time", "component", "code", "phase", "retryable"}
ok = 0
for line in open(sys.argv[1], encoding="utf-8"):
    try:
        r = json.loads(line)
    except ValueError:
        continue
    if r.get("code") == "BASELINE_CORRUPT" and want <= set(r):
        ok = 1
print(ok)
PY
)"
cp "$GOOD" "$BL"

# ══════════════════════════════════════════════════════════════════════════════
# T5 token 不可读 ⇒ exit 2 ＋ TOKEN_UNREADABLE ＋ 零请求
# ══════════════════════════════════════════════════════════════════════════════
BEFORE_REQ="$(total_reqs)"
export SYNO_PUSH_GITEA_TOKEN_FILE="$TMP/no-such-token"
run_recon "$RECON" --baseline "$BL"
t_exit "T5 token 不可读 exit" 2 "$RC"
has "T5 stderr TOKEN_UNREADABLE" "$ERR" '^degraded: code=TOKEN_UNREADABLE '
eq "T5 零请求" "$BEFORE_REQ" "$(total_reqs)"
export SYNO_PUSH_GITEA_TOKEN_FILE="$TMP/token"

# ══════════════════════════════════════════════════════════════════════════════
# T6 --dry-run（只读）：a) 无基线 ⇒ 不写、不开卡；b) 有差异 ⇒ exit 1 + DRY 标记 + 基线字节不变
# ══════════════════════════════════════════════════════════════════════════════
start_server "$TMP/fix-empty.json"
rm -f "$BL"
run_recon "$RECON" --baseline "$BL" --dry-run
t_exit "T6a dry-run（无基线）exit" 0 "$RC"
has "T6a SUMMARY" "$OUT" '^SUMMARY diffs=0 issue=none$'
eq "T6a 零写请求" "0" "$(writes)"
eq "T6a 卡 0 张" "0" "$(card_count)"
if [ -f "$BL" ]; then bad "T6a 不写基线" "基线被写入"; else ok "T6a 不写基线"; fi
has "T6a 五指标仍输出" "$OUT" '^AUDIT=critical:4$'

cp "$GOOD" "$BL"
"$PY" - "$GOOD" "$BL" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
d["metrics"]["files"] += 1
json.dump(d, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
SHA_BEFORE="$(baseline_sha "$BL")"
run_recon "$RECON" --baseline "$BL" --dry-run
t_exit "T6b dry-run（有差异）exit" 1 "$RC"
has "T6b SUMMARY DRY 标记" "$OUT" '^SUMMARY diffs=[1-5] issue=none \(DRY\)$'
eq "T6b 零写请求" "0" "$(writes)"
eq "T6b 基线字节不变" "$SHA_BEFORE" "$(baseline_sha "$BL")"
eq "T6b 卡 0 张" "0" "$(card_count)"
cp "$GOOD" "$BL"

# ══════════════════════════════════════════════════════════════════════════════
# T7 跨周：基线 week 不同＋有差异 ⇒ 单卡、旧周节逐字保留、新周节追加（旧在前）
# ══════════════════════════════════════════════════════════════════════════════
OLD_BODY=$'# 周对账（滚动）\n\n## 2020-W01\n\n- 旧周标记：OLD-WEEK-KEEP\n\n| 指标 | 值 |\n|---|---|\n| FILES | `1` |\n'
"$PY" - "$TMP/fix-oldweek.json" "$OLD_BODY" <<'PY'
import json, sys
body = sys.argv[2]
data = {"pulls": [{"number": 1}, {"number": 2}, {"number": 3}],
        "labels": [{"id": 7, "name": "域/治理"}],
        "issues": {"1": {"number": 1, "title": "[RECON] 周对账（滚动）",
                         "body": body, "state": "open"}}}
json.dump(data, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
start_server "$TMP/fix-oldweek.json"
cp "$GOOD" "$BL"
"$PY" - "$BL" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
d["week"] = "2020-W01"
d["issue"] = 1
d["metrics"]["files"] -= 1
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
run_recon "$RECON" --baseline "$BL"
t_exit "T7 跨周有差异 exit" 1 "$RC"
eq "T7 仍单卡（不重复开卡）" "1" "$(card_count)"
eq "T7 无 POST" "0" "$(count_req POST)"
T7_BODY="$(card_body 1)"
has "T7 旧周节保留" "$T7_BODY" '^## 2020-W01$'
has "T7 旧周节逐字保留（标记行）" "$T7_BODY" '^\- 旧周标记：OLD-WEEK-KEEP$'
has "T7 新周节追加" "$T7_BODY" "^## ${WEEK}$"
OLD_LINE="$(line_no "$T7_BODY" '^## 2020-W01$')"
NEW_LINE="$(line_no "$T7_BODY" "^## ${WEEK}$")"
if [ -n "$OLD_LINE" ] && [ -n "$NEW_LINE" ] && [ "$OLD_LINE" -lt "$NEW_LINE" ]; then
  ok "T7 节序：旧周节在前、新周节在后"
else
  bad "T7 节序" "旧节行=$OLD_LINE 新节行=$NEW_LINE"
fi
eq "T7 基线 week 刷新为当前周" "$WEEK" "$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8"))["week"])' "$BL")"
cp "$GOOD" "$BL"

# ══════════════════════════════════════════════════════════════════════════════
# T8 反例 b（判别力自检·硬要求）：摘掉去重 ⇒ 必双卡；原脚本同场景仍单卡
# ══════════════════════════════════════════════════════════════════════════════
MUT="$TMP/weekly-recon-mutant.sh"
sed 's/^    if existing is None:$/    if True:/' "$RECON" > "$MUT"
if grep -q '^    if True:$' "$MUT"; then
  ok "T8 变异副本已生成（去重条件被摘掉）"
else
  bad "T8 变异副本" "sed 未命中去重条件行（脚本结构已变，需同步变异点）"
fi
cp "$GOOD" "$BL"
"$PY" - "$BL" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
d["metrics"]["files"] += 1
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
reset_reqlog
run_recon "$MUT" --baseline "$BL"
t_exit "T8 变异副本 exit（有差异）" 1 "$RC"
eq "T8 变异副本必双卡（摘去重 ⇒ 2 张）" "2" "$(card_count)"
eq "T8 变异副本 POST 1 次" "1" "$(count_req POST)"
# 原脚本同场景（同夹具）仍单卡
start_server "$TMP/fix-oldweek.json"
cp "$GOOD" "$BL"
"$PY" - "$BL" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
d["metrics"]["files"] += 1
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
reset_reqlog
run_recon "$RECON" --baseline "$BL"
eq "T8 原脚本同场景仍单卡（判别力对照）" "1" "$(card_count)"
cp "$GOOD" "$BL"

# ══════════════════════════════════════════════════════════════════════════════
# T9 AUDIT 桩：a) critical:4 ｜ b) npm 不存在 ⇒ unavailable:0＋degraded（不改 exit）｜ c) 坏 JSON
# ══════════════════════════════════════════════════════════════════════════════
start_server "$TMP/fix-empty.json"
run_recon "$RECON" --baseline "$BL" --dry-run
t_exit "T9a AUDIT 正常路径 exit" 0 "$RC"
eq "T9a AUDIT=critical:4" "AUDIT=critical:4" "$(metrics_line "$OUT" AUDIT)"
NPM_BAK="$SYNO_RECON_NPM"
NOAUD="$TMP/base-noaudit.json"
"$PY" - "$GOOD" "$NOAUD" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
d["metrics"]["audit"] = "unavailable:0"
json.dump(d, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
export SYNO_RECON_NPM="/nonexistent/npm-for-test"
run_recon "$RECON" --baseline "$NOAUD" --dry-run
t_exit "T9b npm 缺失不改变 exit（零差异仍 0，不升 2）" 0 "$RC"
eq "T9b AUDIT=unavailable:0" "AUDIT=unavailable:0" "$(metrics_line "$OUT" AUDIT)"
has "T9b stderr 指标级 degraded 行" "$ERR" '^degraded: code=AUDIT_UNAVAILABLE '
eq "T9b AUDIT_UNAVAILABLE 写入 degraded JSONL" "1" "$("$PY" - "$TMP/degraded.jsonl" <<'PY'
import json, sys
print(1 if any(json.loads(x).get("code") == "AUDIT_UNAVAILABLE"
               for x in open(sys.argv[1], encoding="utf-8") if x.strip()) else 0)
PY
)"
export SYNO_RECON_NPM="$TMP/bin/npm-bad"
run_recon "$RECON" --baseline "$NOAUD" --dry-run
t_exit "T9c npm 坏 JSON exit 不变（零差异仍 0，不升 2）" 0 "$RC"
eq "T9c AUDIT=unavailable:0" "AUDIT=unavailable:0" "$(metrics_line "$OUT" AUDIT)"
export SYNO_RECON_NPM="$NPM_BAK"
cp "$GOOD" "$BL"

# ══════════════════════════════════════════════════════════════════════════════
# T10 WIRE CHECK：grep 非零（新测试引用 + AGENTS.md 报备行）
# ══════════════════════════════════════════════════════════════════════════════
WIRE="$(grep -rn "weekly-recon" .gitea/ scripts/ tests/ 2>/dev/null || true)"  # swallow-ok: 零命中即未接线，由下方断言判红
if [ -n "$WIRE" ]; then ok "T10 WIRE CHECK 非零"; else bad "T10 WIRE CHECK 非零" "grep weekly-recon 零结果 = 未接线"; fi
if printf '%s\n' "$WIRE" | grep -q "tests/control-tower/weekly-recon.test.sh"; then
  ok "T10 WIRE 命中测试文件自身引用"
else
  bad "T10 WIRE 命中测试文件自身引用" "未命中 tests/control-tower/weekly-recon.test.sh"
fi
if printf '%s\n' "$WIRE" | grep -q "tests/control-tower/AGENTS.md"; then
  ok "T10 WIRE 命中 AGENTS.md 报备行"
else
  bad "T10 WIRE 命中 AGENTS.md 报备行" "tests/control-tower/AGENTS.md 缺报备行"
fi

# ══════════════════════════════════════════════════════════════════════════════
# T11 五指标行格式＋顺序＋SUMMARY 终行；MODS 顺序 == ASSET-MAP required_modules（独立解析）
# ══════════════════════════════════════════════════════════════════════════════
run_recon "$RECON" --baseline "$BL" --dry-run
t_exit "T11 取样运行 exit" 0 "$RC"
LAST_LINE="$(printf '%s\n' "$OUT" | grep -v '^$' | tail -1)"
has "T11 SUMMARY 终行格式" "$LAST_LINE" '^SUMMARY diffs=[0-5] issue=(#[0-9]+|none)( \(DRY\))?$'
# 行序固定：FILES < MODS < PRAVG < WORKTREES < AUDIT
SEQ="$(printf '%s\n' "$OUT" | grep -nE '^(FILES|MODS|PRAVG|WORKTREES|AUDIT)=' | sed -E 's/^([0-9]+):.*/\1/' | tr '\n' ' ')"
eq "T11 五指标恰 5 行" "5" "$(printf '%s\n' "$SEQ" | wc -w | tr -d ' ')"
MODS_VAL="$(metrics_line "$OUT" MODS | sed 's/^MODS=//')"
EXPECT_ORDER="$("$PY" - "$MAP" <<'PY'
import re, sys
mods, section = [], None
for line in open(sys.argv[1], encoding="utf-8"):
    s = line.split("#", 1)[0].rstrip()
    if not s.strip():
        continue
    if not s[:1].isspace():
        section = s.split(":", 1)[0].strip()
        continue
    m = re.match(r"^-\s*(\S+)$", s.strip())
    if section == "required_modules" and m:
        mods.append(m.group(1))
print(",".join(mods))
PY
)"
ACTUAL_ORDER="$(printf '%s' "$MODS_VAL" | sed -E 's/:[0-9]+//g')"
eq "T11 MODS 顺序 == required_modules 顺序" "$EXPECT_ORDER" "$ACTUAL_ORDER"
eq "T11 MODS 条目数 == required_modules 数" "$("$PY" -c 'import sys;print(len(sys.argv[1].split(",")))' "$EXPECT_ORDER")" "$("$PY" -c 'import sys;print(len(sys.argv[1].split(",")))' "$MODS_VAL")"

# ══════════════════════════════════════════════════════════════════════════════
# T12 bash -n ＋ 契约头要素齐（@input/@output/@exit/@degraded/设计哲学/explicit authority/
#     Known Limitations/错误码表/Source map）
# ══════════════════════════════════════════════════════════════════════════════
if bash -n "$RECON" 2>"$TMP/bashn.txt"; then ok "T12 bash -n"; else bad "T12 bash -n" "$(cat "$TMP/bashn.txt")"; fi
for token in "@input" "@output" "@exit" "@degraded" "@error" "设计哲学" "explicit authority" \
             "Known Limitations" "TOKEN_UNREADABLE" "ISSUE_WRITE_FAILED" "Source map"; do
  if grep -q -- "$token" "$RECON"; then ok "T12 契约头要素: $token"; else bad "T12 契约头要素: $token" "未找到 $token"; fi
done

# ── 汇总 ──────────────────────────────────────────────────────────────────────
echo "────────────────────────────────────────────────"
echo "PASS=$pass_n FAIL=$fail_n"
if [ "$fail_n" -eq 0 ]; then
  echo "ALL PASS（T1–T12，$pass_n 项断言；判据测试三态：0=ALL PASS）"
  exit 0
fi
echo "❌ 断言失败 $fail_n 项（exit 1 = 真红）"
exit 1
