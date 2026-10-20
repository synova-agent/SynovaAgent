#!/usr/bin/env bash
# asset-sync.test.sh —— #776 判据测试 T1–T11（本地假 Gitea，仅 127.0.0.1，不联网出本机）
#
# 三态退出码：0 = ALL PASS ｜ 1 = 断言失败（真红，具体失败点逐条打印）｜ 2 = 环境失败
#            （无 python3／假服务起不来）—— 禁把「看不见」当「没问题」。
# 覆盖：T1 dry-run 零请求＋恒等式｜T2 真跑正例（段外逐字节＋#769 严格前缀＋只 PATCH）
#       T3 两跑幂等（sha256 全等＋changed=0）｜T4 无 marker 原子（零 PATCH）｜T5 catch-all 8d
#       T6 total 造假 8c｜T7 空 MAP｜T8 token 不可读（零请求）｜T9 默认不开卡（零 POST）
#       T10 --open-x-cards 去重（只 1 张）＋T10b 摘掉去重必红（判别力自检）｜T11 缺模块
# 接线（WIRE CHECK）：本测试必须实际调用 scripts/control-tower/asset-sync.py（grep 零结果＝未接线）。
set -u

export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || { echo "ENV-FAIL: 无法 cd $ROOT"; exit 2; }
PY=python3
SYNC="$ROOT/scripts/control-tower/asset-sync.py"
MAP="$ROOT/docs/authority/ASSET-MAP.yaml"
TMP="$(mktemp -d)"
SERVER_PID=""
OUT=""
RC=0
pass_n=0
fail_n=0

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null  # swallow-ok: 收尾清理，进程已退出时失败不影响断言
    wait "$SERVER_PID" 2>/dev/null  # swallow-ok: 同上
    SERVER_PID=""
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

if ! command -v "$PY" >/dev/null 2>&1; then
  echo "ENV-FAIL: 无 ${PY}（判据测试需 python3 stdlib）"
  exit 2
fi
if [ ! -f "$SYNC" ]; then
  echo "ENV-FAIL: 缺 ${SYNC}（未接线）"
  exit 2
fi
if [ ! -f "$MAP" ]; then
  echo "ENV-FAIL: 缺 $MAP"
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
    bad "$1" "输出未命中 /$3/；实际前 4 行: $(printf '%s\n' "$2" | head -4 | tr '\n' '|')"
  fi
}
hasnt() { # hasnt <名称> <文本> <扩展正则>
  if printf '%s\n' "$2" | grep -qE -- "$3"; then
    bad "$1" "输出不应命中 /$3/；实际: $(printf '%s\n' "$2" | grep -E -- "$3" | head -2 | tr '\n' '|')"
  else ok "$1"; fi
}
eq() { # eq <名称> <期望> <实际>
  if [ "$2" = "$3" ]; then ok "$1" "$3"; else bad "$1" "期望 $2 实际 $3"; fi
}

# ══════════════════════════════════════════════════════════════════════════════
# 本地假 Gitea（stdlib http.server，127.0.0.1 随机端口；每个请求落 jsonl；状态落 state.json）
# ══════════════════════════════════════════════════════════════════════════════
cat > "$TMP/gitea_server.py" <<'PY'
# -*- coding: utf-8 -*-
"""假 Gitea（判据测试专用）：只实现 asset-sync.py 用到的 4 类端点。"""
import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PREFIX = "/api/v1/repos/synova-agent/SynovaAgent/"


class Store:
    def __init__(self, fixture, state_path):
        with open(fixture, encoding="utf-8") as f:
            data = json.load(f)
        self.milestones = {m["id"]: m for m in data.get("milestones", [])}
        self.issues = {int(k): v for k, v in (data.get("issues") or {}).items()}
        self.state_path = state_path
        self._persist()

    def _persist(self):
        payload = {"milestones": list(self.milestones.values()),
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

    def _send(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self._rec(None)
        path = urlparse(self.path).path
        if path.startswith(PREFIX):
            rest = path[len(PREFIX):]
            if rest == "milestones":
                return self._send(200, list(self.store.milestones.values()))
            if rest.startswith("issues/"):
                num = rest.split("/", 1)[1]
                try:
                    num = int(num)
                except ValueError:
                    return self._send(404, {"message": "not found"})
                if num in self.store.issues:
                    return self._send(200, self.store.issues[num])
                return self._send(404, {"message": "issue not found"})
            if rest == "issues":
                return self._send(200, list(self.store.issues.values()))
        return self._send(404, {"message": "not found"})

    def do_PATCH(self):
        body = self._body()
        self._rec(body)
        path = urlparse(self.path).path
        if path.startswith(PREFIX):
            rest = path[len(PREFIX):]
            if rest.startswith("milestones/"):
                try:
                    mid = int(rest.split("/", 1)[1])
                except ValueError:
                    return self._send(404, {"message": "not found"})
                if mid not in self.store.milestones:
                    return self._send(404, {"message": "milestone not found"})
                ms = self.store.milestones[mid]
                if "description" in (body or {}):
                    ms["description"] = body["description"]
                self.store._persist()
                return self._send(200, ms)
            if rest.startswith("issues/"):
                try:
                    num = int(rest.split("/", 1)[1])
                except ValueError:
                    return self._send(404, {"message": "not found"})
                if num not in self.store.issues:
                    return self._send(404, {"message": "issue not found"})
                iss = self.store.issues[num]
                if "body" in (body or {}):
                    iss["body"] = body["body"]
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
                   "body": (body or {}).get("body", ""), "state": "open"}
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

# 断言器（状态核对 / sha 快照 / 请求日志核对）
cat > "$TMP/check_state.py" <<'PY'
# -*- coding: utf-8 -*-
import argparse
import hashlib
import json
import re
import sys

BEGIN = "<!-- ASSET-AUTO:BEGIN -->"
END = "<!-- ASSET-AUTO:END -->"
REQ_RE = re.compile(r"^/api/v1/repos/synova-agent/SynovaAgent/(milestones/\d+|issues/769)$")


def outside(text):
    if text.count(BEGIN) != 1 or text.count(END) != 1:
        return None
    i, j = text.index(BEGIN), text.index(END)
    return text[:i] + text[j + len(END):]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", required=True)
    ap.add_argument("--fixture")
    ap.add_argument("--state")
    ap.add_argument("--log")
    ap.add_argument("--out")
    a = ap.parse_args()

    if a.mode == "outside":
        fx = json.load(open(a.fixture, encoding="utf-8"))
        st = json.load(open(a.state, encoding="utf-8"))
        old = {m["id"]: m for m in fx["milestones"]}
        new = {m["id"]: m for m in st["milestones"]}
        problems, changed = [], 0
        for mid, o in old.items():
            n = new.get(mid)
            if n is None:
                problems.append(f"里程碑 {mid} 丢失")
                continue
            o_out, n_out = outside(o["description"]), outside(n["description"])
            if o_out is None:
                if n["description"] != o["description"]:
                    problems.append(f"{o['title']} 无标记却被改写")
                continue
            if n_out is None:
                problems.append(f"{o['title']} 改造后丢标记")
            elif o_out != n_out:
                problems.append(f"{o['title']} 段外被改动（逐字节不等）")
            if n["description"] != o["description"]:
                changed += 1
        ob = fx["issues"]["769"]["body"]
        nb = st["issues"]["769"]["body"]
        if not (nb.startswith(ob) and nb != ob):
            problems.append("#769 既有 body 不是严格前缀")
        if problems:
            print("FAIL " + "；".join(problems))
            sys.exit(1)
        print(f"OK milestones={len(old)} changed={changed} 769=strict-prefix")
        return

    if a.mode == "sha":
        st = json.load(open(a.state, encoding="utf-8"))
        out = {str(m["id"]): hashlib.sha256(m["description"].encode("utf-8")).hexdigest()
               for m in st["milestones"]}
        out["769"] = hashlib.sha256(st["issues"]["769"]["body"].encode("utf-8")).hexdigest()
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
        print(f"OK sha={len(out)} 项 → {a.out}")
        return

    if a.mode == "requests":
        rows = []
        if a.log and __import__("os").path.exists(a.log):
            with open(a.log, encoding="utf-8") as f:
                rows = [json.loads(l) for l in f if l.strip()]
        res = {"total": len(rows), "get": 0, "patch": 0, "post": 0,
               "other": 0, "bad_patch_paths": []}
        for r in rows:
            m = r.get("method")
            if m == "GET":
                res["get"] += 1
            elif m == "PATCH":
                res["patch"] += 1
                if not REQ_RE.match(r.get("path", "")):
                    res["bad_patch_paths"].append(r.get("path"))
            elif m == "POST":
                res["post"] += 1
            else:
                res["other"] += 1
        print(json.dumps(res, ensure_ascii=False))
        return

    if a.mode == "cards":
        st = json.load(open(a.state, encoding="utf-8"))
        cards = [i for i in st["issues"].values()
                 if (i.get("title") or "").startswith("[ASSET]")]
        print(json.dumps({"cards": len(cards),
                          "titles": [i.get("title") for i in cards]}, ensure_ascii=False))
        return

    print(f"FAIL 未知 mode {a.mode}")
    sys.exit(1)


if __name__ == "__main__":
    main()
PY

# 夹具生成（10 条 M 里程碑带/不带标记 ＋ #769 body 无标记）
cat > "$TMP/gen_fixture.py" <<'PY'
# -*- coding: utf-8 -*-
import argparse
import json

BEGIN = "<!-- ASSET-AUTO:BEGIN -->"
END = "<!-- ASSET-AUTO:END -->"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-marker", default="")
    a = ap.parse_args()
    ms = []
    for i in range(1, 11):
        mod = f"M{i}"
        head = f"## {mod} 人工说明（首）\n\n- 人工条目 A\n- 人工条目 B\n\n"
        tail = "\n\n## 人工补充（尾）\n\n- 人工尾条目\n"
        if a.no_marker == mod:
            desc = head + "（本行无标记：原人工描述，一字都不许改）\n" + tail
        else:
            desc = head + BEGIN + "\n旧自动内容\n" + END + tail
        ms.append({"id": 100 + i, "title": f"{mod} 示例里程碑", "description": desc,
                   "state": "open"})
    body = "# 资产地图 v1（#769）\n\n## 手工维护区\n\n- 手工条目 1\n- 手工条目 2\n"
    issues = {"769": {"number": 769, "title": "资产地图 v1", "body": body, "state": "open"}}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"milestones": ms, "issues": issues}, f, ensure_ascii=False, indent=1)
    print(f"OK fixture={a.out} milestones={len(ms)}")


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
run_py() { local s="$1"; shift; OUT="$("$PY" "$s" "$@" 2>&1)"; RC=$?; }
run_sync() { run_py "$SYNC" "$@"; }
reqs() { "$PY" "$TMP/check_state.py" --mode requests --log "$TMP/reqlog.jsonl"; }
field() { printf '%s' "$1" | "$PY" -c "import json,sys;print(json.load(sys.stdin).get(\"$2\"))"; }

printf 'dummy-token-for-test\n' > "$TMP/token"
export SYNO_PUSH_GITEA_TOKEN_FILE="$TMP/token"

REAL_TOTAL="$(git -C "$ROOT" ls-tree -r HEAD | wc -l | tr -d ' ')"
echo "──── #776 asset-sync 判据测试（T1–T11）｜ as_of HEAD=$(git -C "$ROOT" rev-parse --short HEAD) ls-tree=$REAL_TOTAL ────"

# ══════════════════════════════════════════════════════════════════════════════
# T1 dry-run：exit 0 ＋ SUMMARY ＋ total==ls-tree ＋ 恒等式 ＋ 假服务 0 请求（判据 5）
# ══════════════════════════════════════════════════════════════════════════════
"$PY" "$TMP/gen_fixture.py" --out "$TMP/fix.json" >/dev/null
start_server "$TMP/fix.json"
run_sync --dry-run --map "$MAP" --prev HEAD^ --new HEAD
t_exit "T1 dry-run" 0 "$RC"
has "T1 SUMMARY" "$OUT" '^SUMMARY mapped=[0-9]+ unknown=[0-9]+ x=[0-9]+ total=[0-9]+$'
has "T1 DRY-RUN 声明行" "$OUT" '^DRY-RUN: 未联网、未写里程碑、未开卡（判据 5）$'
has "T1 DRY 行" "$OUT" '^DRY \S+ -> '
has "T1 UNKNOWN_TOP 行" "$OUT" '^UNKNOWN_TOP '
has "T1 MOD 行" "$OUT" '^MOD M[0-9]+ files=[0-9]+$'
SUM_LINE="$(printf '%s\n' "$OUT" | grep -E '^SUMMARY ' | tail -1)"
m=$(printf '%s' "$SUM_LINE" | sed -E 's/.*mapped=([0-9]+).*/\1/')
u=$(printf '%s' "$SUM_LINE" | sed -E 's/.*unknown=([0-9]+).*/\1/')
x=$(printf '%s' "$SUM_LINE" | sed -E 's/.*x=([0-9]+).*/\1/')
tt=$(printf '%s' "$SUM_LINE" | sed -E 's/.*total=([0-9]+).*/\1/')
eq "T1 total == git ls-tree -r HEAD | wc -l" "$REAL_TOTAL" "$tt"
eq "T1 恒等式 mapped+unknown+x == total" "$tt" "$((m + u + x))"
n_req=$(reqs | "$PY" -c 'import json,sys;print(json.load(sys.stdin)["total"])')
eq "T1 dry-run 假服务收到请求数（须 0）" "0" "$n_req"
has "T1 TREE 行（full sha ＋ total）" "$OUT" '^TREE new=[0-9a-f]{40} total=[0-9]+$'
TREE_TOTAL=$(printf '%s\n' "$OUT" | grep -E '^TREE ' | sed -E 's/.*total=([0-9]+).*/\1/')
eq "T1 TREE total == SUMMARY total" "$tt" "$TREE_TOTAL"
TREE_SHA=$(printf '%s\n' "$OUT" | grep -E '^TREE ' | sed -E 's/^TREE new=([0-9a-f]{40}).*/\1/')
eq "T1 TREE new == git rev-parse HEAD" "$(git -C "$ROOT" rev-parse HEAD)" "$TREE_SHA"

# ══════════════════════════════════════════════════════════════════════════════
# T1b --root 护栏：不存在／非 git 仓库 ⇒ exit 2 code=BAD_ROOT（禁在误树上静默算数）
# ══════════════════════════════════════════════════════════════════════════════
run_sync --dry-run --root "$TMP/not-a-repo" --map "$MAP"
t_exit "T1b --root 不存在" 2 "$RC"
has "T1b typed error BAD_ROOT" "$OUT" 'code=BAD_ROOT'
run_sync --dry-run --root "$TMP" --map "$MAP"
t_exit "T1b --root 非 git 仓库" 2 "$RC"
has "T1b 非仓 BAD_ROOT" "$OUT" 'code=BAD_ROOT'

# ══════════════════════════════════════════════════════════════════════════════
# T1c 跨 cwd 同一棵树：--root 认树 ⇒ total 与目标树实数一致（修「靠 cwd 认树」假绿点）
# ══════════════════════════════════════════════════════════════════════════════
OUT=$(cd "$TMP" && "$PY" "$SYNC" --dry-run --root "$ROOT" --map "$MAP" --prev HEAD^ --new HEAD 2>&1)
RC=$?
t_exit "T1c 跨 cwd（--root 指目标树）" 0 "$RC"
CROSS_TOTAL=$(printf '%s\n' "$OUT" | grep -E '^SUMMARY ' | sed -E 's/.*total=([0-9]+).*/\1/')
eq "T1c 跨 cwd total == 目标树 ls-tree" "$REAL_TOTAL" "$CROSS_TOTAL"

# ══════════════════════════════════════════════════════════════════════════════
# T2 真跑正例：M1–M10 带标记 ＋ #769 无标记 ⇒ exit 0；段外逐字节不变；只 PATCH
# ══════════════════════════════════════════════════════════════════════════════
stop_server
"$PY" "$TMP/gen_fixture.py" --out "$TMP/fix2.json" >/dev/null
start_server "$TMP/fix2.json"
run_sync --map "$MAP" --prev HEAD^ --new HEAD --rebuild-769
t_exit "T2 真跑" 0 "$RC"
hasnt "T2 无 typed error" "$OUT" '^(真红|degraded): code='
has "T2 PATCH 里程碑" "$OUT" '^PATCHED milestones/[0-9]+ \(M[0-9]+\)$'
has "T2 PATCH #769" "$OUT" '^PATCHED issues/769$'
has "T2 CHANGED 行" "$OUT" '^CHANGED [0-9]+$'
OUTSIDE_OUT="$("$PY" "$TMP/check_state.py" --mode outside \
  --fixture "$TMP/fix2.json" --state "$TMP/state.json" 2>&1)"
if [ $? -eq 0 ]; then ok "T2 段外逐字节不变＋#769 严格前缀（${OUTSIDE_OUT}）"
else bad "T2 段保护" "$OUTSIDE_OUT"; fi
REQ_JSON="$(reqs)"
eq "T2 无 POST" "0" "$(field "$REQ_JSON" post)"
BAD_PATHS="$(field "$REQ_JSON" bad_patch_paths)"
eq "T2 PATCH 路径只 milestones/<id> 与 issues/769" "[]" "$BAD_PATHS"
cp "$TMP/state.json" "$TMP/state-after1.json"
"$PY" "$TMP/check_state.py" --mode sha --state "$TMP/state-after1.json" --out "$TMP/sha1.json" >/dev/null

# ══════════════════════════════════════════════════════════════════════════════
# T3 幂等：同 --prev/--new 二跑 ⇒ changed=0 ＋ 所有 description/body sha256 全等（判据 4）
# ══════════════════════════════════════════════════════════════════════════════
run_sync --map "$MAP" --prev HEAD^ --new HEAD --rebuild-769
t_exit "T3 第二跑" 0 "$RC"
has "T3 CHANGED 0" "$OUT" '^CHANGED 0$'
hasnt "T3 第二跑零 PATCH" "$OUT" '^PATCHED '
"$PY" "$TMP/check_state.py" --mode sha --state "$TMP/state.json" --out "$TMP/sha2.json" >/dev/null
if cmp -s "$TMP/sha1.json" "$TMP/sha2.json"; then
  ok "T3 两跑 sha256 全等（$(wc -l < "$TMP/sha1.json" | tr -d ' ') 行）"
else
  bad "T3 sha256 漂移" "$(diff "$TMP/sha1.json" "$TMP/sha2.json" | head -4 | tr '\n' '|')"
fi

# ══════════════════════════════════════════════════════════════════════════════
# T4 无 marker ⇒ exit 2 ＋ 假服务零 PATCH（原子：先全查再写；判据 8a）
# ══════════════════════════════════════════════════════════════════════════════
stop_server
"$PY" "$TMP/gen_fixture.py" --out "$TMP/fix4.json" --no-marker M5 >/dev/null
start_server "$TMP/fix4.json"
run_sync --map "$MAP" --prev HEAD^ --new HEAD
t_exit "T4 无 marker" 2 "$RC"
has "T4 typed error NO_MARKER" "$OUT" 'code=NO_MARKER'
eq "T4 零 PATCH（原子）" "0" "$(field "$(reqs)" patch)"
# 无标记里程碑描述未被改写（原子性物理证据）
UNCHANGED=$("$PY" - "$TMP/fix4.json" "$TMP/state.json" <<'PY'
import json, sys
fx = {m["id"]: m for m in json.load(open(sys.argv[1], encoding="utf-8"))["milestones"]}
st = {m["id"]: m for m in json.load(open(sys.argv[2], encoding="utf-8"))["milestones"]}
print("yes" if all(fx[i]["description"] == st[i]["description"] for i in fx) else "no")
PY
)
eq "T4 零改写（全部描述未变）" "yes" "$UNCHANGED"

# ══════════════════════════════════════════════════════════════════════════════
# T5 反例 8d：MAP 塞 glob:"**" ⇒ exit 1（输出点名 catch-all）
# ══════════════════════════════════════════════════════════════════════════════
"$PY" - "$MAP" "$TMP/map-catchall.yaml" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read()
inject = '  - glob: "**"\n    module: X\n    owner: P6\n    state: 其他\n'
assert "entries:\n" in text
open(sys.argv[2], "w", encoding="utf-8").write(text.replace("entries:\n", "entries:\n" + inject, 1))
PY
run_sync --dry-run --map "$TMP/map-catchall.yaml" --prev HEAD^ --new HEAD
t_exit "T5 8d catch-all" 1 "$RC"
has "T5 点名 catch-all" "$OUT" 'catch-all'
has "T5 typed error MAP_CATCH_ALL" "$OUT" 'code=MAP_CATCH_ALL'

# ══════════════════════════════════════════════════════════════════════════════
# T6 反例 8c：total 改成 MAP 条目数（变异副本）⇒ exit 1「恒等式不成立」
# ══════════════════════════════════════════════════════════════════════════════
N_ENTRIES=$(grep -c '^  - glob:' "$MAP")
"$PY" - "$SYNC" "$TMP/sync-mutant.py" "$N_ENTRIES" <<'PY'
import sys
src, dst, n = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src, encoding="utf-8").read()
assert text.count("total = len(files)") == 1, "变异锚点 total = len(files) 缺失（测试与实现漂移）"
open(dst, "w", encoding="utf-8").write(text.replace("total = len(files)", f"total = {n}", 1))
print(f"OK mutant total={n}")
PY
run_py "$TMP/sync-mutant.py" --dry-run --map "$MAP" --prev HEAD^ --new HEAD
t_exit "T6 8c total 造假" 1 "$RC"
has "T6 恒等式不成立" "$OUT" '恒等式不成立'
has "T6 typed error IDENTITY_VIOLATION" "$OUT" 'code=IDENTITY_VIOLATION'

# ══════════════════════════════════════════════════════════════════════════════
# T7 空 MAP ⇒ exit 2（信号量自检：禁把看不见当没问题）
# ══════════════════════════════════════════════════════════════════════════════
printf 'match: first\nentries:\n' > "$TMP/map-empty.yaml"
run_sync --dry-run --map "$TMP/map-empty.yaml" --prev HEAD^ --new HEAD
t_exit "T7 空 MAP" 2 "$RC"
has "T7 typed error MAP_EMPTY" "$OUT" 'code=MAP_EMPTY'

# ══════════════════════════════════════════════════════════════════════════════
# T8 token 不可读 ⇒ exit 2 code=TOKEN_UNREADABLE 且零请求
# ══════════════════════════════════════════════════════════════════════════════
stop_server
start_server "$TMP/fix2.json"
SYNO_PUSH_GITEA_TOKEN_FILE="$TMP/no-such-token"
export SYNO_PUSH_GITEA_TOKEN_FILE
run_sync --map "$MAP" --prev HEAD^ --new HEAD
t_exit "T8 token 不可读" 2 "$RC"
has "T8 typed error TOKEN_UNREADABLE" "$OUT" 'code=TOKEN_UNREADABLE'
eq "T8 零请求" "0" "$(field "$(reqs)" total)"
SYNO_PUSH_GITEA_TOKEN_FILE="$TMP/token"
export SYNO_PUSH_GITEA_TOKEN_FILE

# ══════════════════════════════════════════════════════════════════════════════
# T9 未知>0 且不开 --open-x-cards ⇒ 零 POST /issues（裁 277「不建卡」）
# ══════════════════════════════════════════════════════════════════════════════
stop_server
start_server "$TMP/fix2.json"
run_sync --map "$MAP" --prev HEAD^ --new HEAD
t_exit "T9 真跑（默认不开卡）" 0 "$RC"
UNK=$(printf '%s\n' "$OUT" | grep -E '^SUMMARY ' | sed -E 's/.*unknown=([0-9]+).*/\1/')
if [ "${UNK:-0}" -gt 0 ]; then ok "T9 未知>0" "unknown=$UNK"; else bad "T9 未知计数" "unknown=${UNK}（夹具不足：应 >0）"; fi
eq "T9 零 POST /issues" "0" "$(field "$(reqs)" post)"
eq "T9 未建卡" "0" "$(field "$("$PY" "$TMP/check_state.py" --mode cards --state "$TMP/state.json")" cards)"

# ══════════════════════════════════════════════════════════════════════════════
# T10 --open-x-cards 两跑 ⇒ 只 1 张卡（标题全等＋open 去重；判据 6/8b）
# ══════════════════════════════════════════════════════════════════════════════
run_sync --map "$MAP" --prev HEAD^ --new HEAD --open-x-cards
t_exit "T10 首跑开卡" 0 "$RC"
has "T10 建卡行" "$OUT" '^CREATED issues'
run_sync --map "$MAP" --prev HEAD^ --new HEAD --open-x-cards
t_exit "T10 二跑" 0 "$RC"
has "T10 去重命中" "$OUT" '^CARD exists'
eq "T10 累计 POST（须 1）" "1" "$(field "$(reqs)" post)"
CARDS_JSON="$("$PY" "$TMP/check_state.py" --mode cards --state "$TMP/state.json")"
eq "T10 卡数（须 1）" "1" "$(field "$CARDS_JSON" cards)"

# ── T10b 判别力自检（改坏必红）：摘掉标题全等去重 ⇒ 两跑必建 2 张卡 ──
"$PY" - "$SYNC" "$TMP/sync-nodedupe.py" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
anchor = 'if any((i.get("title") or "") == CARD_TITLE for i in issues):'
assert text.count(anchor) == 1, "去重锚点缺失（测试与实现漂移）"
open(dst, "w", encoding="utf-8").write(text.replace(anchor, "if False:  # 变异：摘掉去重", 1))
print("OK mutant nodedupe")
PY
stop_server
start_server "$TMP/fix2.json"
run_py "$TMP/sync-nodedupe.py" --map "$MAP" --prev HEAD^ --new HEAD --open-x-cards >/dev/null
run_py "$TMP/sync-nodedupe.py" --map "$MAP" --prev HEAD^ --new HEAD --open-x-cards >/dev/null
MUT_CARDS=$(field "$("$PY" "$TMP/check_state.py" --mode cards --state "$TMP/state.json")" cards)
eq "T10b 摘掉去重 ⇒ 2 张卡（证明 T10 有判别力）" "2" "${MUT_CARDS:-x}"

# ══════════════════════════════════════════════════════════════════════════════
# T11 MAP 去掉 M7 条目（required_modules 仍声明 M7）⇒ exit 1 code=MAP_MISSING_MODULE
# ══════════════════════════════════════════════════════════════════════════════
"$PY" - "$MAP" "$TMP/map-nom7.yaml" <<'PY'
import sys
lines = open(sys.argv[1], encoding="utf-8").read().splitlines(True)
out, i = [], 0
while i < len(lines):
    if lines[i].lstrip().startswith("- glob:"):
        block, j = [lines[i]], i + 1
        while j < len(lines) and lines[j].strip().split(":")[0] in ("glob", "module", "owner", "state"):
            block.append(lines[j])
            j += 1
        if any(l.strip() == "module: M7" for l in block):
            i = j
            continue
        out.extend(block)
        i = j
        continue
    out.append(lines[i])
    i += 1
text = "".join(out)
assert "module: M7" not in text, "M7 条目未删净（测试自检）"
open(sys.argv[2], "w", encoding="utf-8").write(text)
PY
run_sync --dry-run --map "$TMP/map-nom7.yaml" --prev HEAD^ --new HEAD
t_exit "T11 缺 M7 条目" 1 "$RC"
has "T11 typed error MAP_MISSING_MODULE" "$OUT" 'code=MAP_MISSING_MODULE'
has "T11 点名 M7" "$OUT" '缺 M7'

# ── WIRE CHECK：本测试确实调用被测脚本（grep 零结果＝未接线）──
if grep -q 'control-tower/asset-sync.py' "$0"; then ok "WIRE CHECK 测试引用被测脚本"; else
  bad "WIRE CHECK" "测试未引用 scripts/control-tower/asset-sync.py"; fi

stop_server
echo "──── 汇总：PASS=$pass_n FAIL=$fail_n ────"
if [ "$fail_n" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
fi
echo "HAS FAILURES（具体失败点见上逐条 FAIL）"
exit 1
