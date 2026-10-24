#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null   # swallow-ok: locale 不可用时回退默认 locale（非错误路径）
# ═══════════════════════════════════════════════════════════════════════════════
# check-merge-conditions.sh — #582 四条件自证检查器（批次 P7-1）
#
# 【一句话】对任意 PR/diff 一条命令判「四条件」：① CI 全绿 pending=0 ② 零写集重叠
#   ③ 已过独立复核（T1 attested）④ 串行；末行 `CAN-自合并` / `NO: <条件名>` /
#   `degraded: <原因>`，三态退出码。
#
# 【设计哲学】一个分离 ＋ 四条承诺
#   · 一个分离：**判定与执行分离** —— 本件只判，不 merge、不 push、不改任何被判对象。
#   · 承诺 1「看不见 ≠ 没问题」：CI 信号量==0（total_count=0）、open PR 列表取不到、
#     ref 取不到 ⇒ **exit 2**，绝不判绿也绝不判红（F4 实测：无 CI 的提交被 Gitea 报成
#     `state=pending,total_count=0`）。
#   · 承诺 2「声明 ≠ 证明」：③ 通过恒输出 `③=ok(attested)`，**禁裸形态（不带级别）**（裁 B3-1）。
#   · 承诺 3「fail-closed」：取不到就降级，不用"取不到"当"没有重叠/没有红"。
#   · 承诺 4「只读」：不写任何仓库文件；`--selfcheck` 只写系统临时目录并在退出时清理。
#
# 契约（铁律 47 / P7 守则 §八之三②）:
#   @input
#     --pr <N>                  目标 PR（缺省＝按当前分支名反查 open PR，查不到 ⇒ exit 2）
#     --base <ref>              基线分支（缺省 SYNO_MERGE_BASE | local-main）
#     --repo-root <path>        仓库根（缺省＝脚本所在目录的上两级）
#     --json                    stdout 仅 JSON（与 --selfcheck 互斥 ⇒ exit 2）
#     --offline                 不访问网络（🔴 ① 恒 exit 2 —— 裁 B5：不引本地 CI 缓存）
#     --diff-fingerprint        只打印 ③-2.1 的 fp（64 hex，供回执填写）
#     --print-receipt-template  打印 syno-review-receipt/v1 回执骨架（不写文件）
#     --fp-of <mb> <head>       直接算 ③ 指纹（测试缝；不走 API）
#     --selfcheck               判别力自检（临时 git 仓＋夹具，零网络，13 判定点）
#     --help
#     注入缝（测试/自检）：SYNO_MERGE_COND_FIXTURE=<fixture.json>（API 替换层，零网络）
#   @output
#     逐条件证据（4 行）＋ 信息级补充行 ＋ 机器行
#       `MERGE-COND: can|no|degraded ①=ok|no ②=ok|no[(shared:<n>)] ③=ok(attested)|no ④=ok|no`
#     末行 ∈ {`CAN-自合并`, `NO: <条件名[, 条件名]>`, `degraded: <原因>`}
#     --json：{tool,pr,base,tip,head,fp,conditions:{ci,overlap,review,serial},verdict,exit}
#   @exit  0 = 四条件全绿（CAN-自合并）
#          1 = 至少一条红（NO: …，逐条给失败点）
#          2 = 检查自身失败/降级（API 不可达、HTTP≠200、refs 取不到、CI 信号量==0、
#              JSON 解析失败、git 不可用、参数非法）
#   @degraded  stderr 一行 `degraded: <原因> [code=<CODE>]` ＋ 追加 JSON 到
#              SYNO_GATE_DEGRADED_LOG（缺省 .codex/control-tower/logs/degraded-events.log；
#              字段 time/component/code/phase/retryable）＋ exit 2（铁律 11/32）
#   @authority 任何会话/任何人可调（只读判定器）；它**不执行合并** —— 合并权限仍归
#              「四条件自合」的人/会话。本件不接 CI（CTO 令②）。
#   @cross_platform  bash 3.2 ＋ git ≥2.20 ＋ python3 ≥3.9 ＋ curl；macOS / Git-Bash(Windows)
#              同一路径；UTF-8 强制（D732）；禁第三方包；路径全程引号/-z，中文与空格安全。
#
# 结构（Source map · 规格 §2.2 七段）
#   ① 头部契约（本块）            — 契约 / 设计哲学 / 结构 / 已知限制
#   ② 常量与环境                  — UTF-8、API/repo/token、degraded log、临时目录
#   ③ 参数与用法                  — 解析 ＋ 互斥检查（非法 ⇒ exit 2）
#   ④ 基础函数                    — degrade/fail/api_get/scan_open_prs/ensure_ref/
#                                   diff_files/patch_fingerprint/jget/emit_json
#      错误出口（typed error 统一，只有两个）:
#        · die_degraded "<CODE>: <原因>"    ⇒ stderr `degraded: <原因> [code=<CODE>]` ＋ degraded log ＋ exit 2
#          （参数预检同形，只是无 MERGE-COND 机器行）
#        · fail "<规则码> <消息>"      ⇒ 红点，逐条紧随其条件行；行首 token 即规则码
#          （R1..R9 / S1 / S2 / CI_* / OVL_*），输出原文可 grep，与规格 §4.3.1 逐字一致
#   ⑤ 四条件                      — cond1_ci / cond2_overlap / cond3_review / cond4_serial
#   ⑥ 编排与输出                  — main：解析 PR → 四条件 → 机器行 → 末行 → 三态 exit
#   ⑦ --selfcheck                — 临时 git 仓＋夹具跑 A/B/C/D1–D4/E/F/G/H/I/J 13 判定点
#
# 已知限制（Known Limitations · C1 四条 ＋ 规格 §4bis）
#   1. ③ 的「独立」只有 **T1 `attested`** 一级（创始人裁 B3；T0 `proven` 待 B6-a，本批不实现）。
#      attested 能保证「回执与补丁指纹绑定 ∧ 回执之后无代码改动 ∧ reviewer≠author 的**声明**」，
#      改码不重做复核必红；但「作者冒用 reviewer 名」**抓不到**（R9 只告警，恒打印）。
#      本机确有两个可写账号（`synova`(1,owner) / `win-push`(3,write)）⇒ 原生 review 技术可用，
#      升级为 `ok(proven)` 的触发点 = 创始人裁 B6-a；**未批前单轨 T1，禁两套并存**。
#   2. ② 只比**文件路径**，不比内容：两个 PR 改同一文件的**不同行**仍判重叠
#      （有意 fail-closed：少误放行，多一次人工确认）。
#   3. ① 只认 CI 的**最终态**：不判「红是不是存量红」（那属 check-ci-stale-red.sh）。
#   4. ④ 的 S2（队首）依赖各 PR 的 ①∧②∧③ 可判：**③ 回执缺失的 PR 不进就绪集** ⇒ 不阻塞他人
#      （有意，避免死锁）；就绪集为空 ⇒ S2 绿。
#   ＋ `--offline` **不提供任何判定**（① 恒 exit 2，裁 B5：缓存过期即产假绿）；
#     ② 的「声明写集交集」为信息级、由 devdoc_writeset.py 提供（本件不重写、不入判定）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# ─── ② 常量与环境 ──────────────────────────────────────────────────────────────
SELF="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

API="${SYNO_GITEA_API:-http://127.0.0.1:3000/api/v1}"
REPO="${SYNO_GITEA_REPO:-synova-agent/SynovaAgent}"
BASE="${SYNO_MERGE_BASE:-local-main}"
COMPONENT="check-merge-conditions"
DEGRADED_LOG="${SYNO_GATE_DEGRADED_LOG:-$DEFAULT_ROOT/.codex/control-tower/logs/degraded-events.log}"
FIXTURE="${SYNO_MERGE_COND_FIXTURE:-}"
PAGE_SIZE=50     # 分页大小（禁 limit 静默饱和：实测 --limit 100 会给假数，见 check-board-truth.ts:41-52）
MAX_PAGES=20     # 分页上限（open PR 数现场取，不写死预期值）

WORK="$(mktemp -d "${TMPDIR:-/tmp}/syno-mc.XXXXXX")"
if [ -z "${WORK:-}" ] || [ ! -d "$WORK" ]; then
  echo "degraded: 无法创建临时目录（TMPDIR 不可写） [code=E_TMP]" >&2
  exit 2
fi
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM
: > "$WORK/fails.txt"
: > "$WORK/warns.txt"

# ─── 运行状态（全局；bash 3.2 无关联数组 ⇒ 用标量） ────────────────────────────
JSON_MODE=0
OFFLINE=0
SELFCHECK=0
DIFF_FP=0
TEMPLATE=0
FIXTURE_MODE=0
[ -n "$FIXTURE" ] && FIXTURE_MODE=1
ROOT="$DEFAULT_ROOT"
TOKEN=""
PRNUM=""
FP_MB=""
FP_HEAD=""
HEAD=""
TIP=""
MB=""
FP=""
REF_POINT=""
CI_V="skip"
OV_V="skip"
RV_V="skip"
SR_V="skip"
MACHINE_TAIL=""

# ─── ④ 基础函数 ────────────────────────────────────────────────────────────────
say() { # 人读行：--json 时走 stderr（保证 stdout 仅 JSON）
  if [ "$JSON_MODE" = "1" ]; then printf '%s\n' "$*" >&2; else printf '%s\n' "$*"; fi
}
say_cat() { # 把缓冲文件逐行按 say 输出（保持 --json 时不进 stdout）
  local l
  while IFS= read -r l; do say "$l"; done < "$1"
}
flush_fails() { # 条件行之后紧跟该条件的失败点（逐条、禁截断）
  if [ -s "$WORK/fails.txt" ]; then say_cat "$WORK/fails.txt"; : > "$WORK/fails.txt"; fi
}
warn() { printf 'warn: %s\n' "$*" >> "$WORK/warns.txt"; }
flush_warns() { # R9 告警恒打印（裁 B3-2）：不因判定通过而省略
  if [ -s "$WORK/warns.txt" ]; then say_cat "$WORK/warns.txt"; : > "$WORK/warns.txt"; fi
}

append_degraded_log() { # <code> <reason> <phase>
  local code="$1" reason="$2" phase="${3:-}"
  local dir ts esc
  dir="$(dirname "$DEGRADED_LOG")"
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir" >/dev/null 2>&1   # swallow-ok: 日志目录不可建时不影响判定主流程（已 stderr 报因）
  fi
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  esc="$(printf '%s' "$reason" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
  printf '{"time":"%s","component":"%s","code":"%s","phase":"%s","retryable":false,"reason":"%s"}\n' \
    "$ts" "$COMPONENT" "$code" "$phase" "$esc" >> "$DEGRADED_LOG" 2>/dev/null   # swallow-ok: 日志不可写不改变退出码，原因已 stderr 输出
}

emit_json() { # <verdict> <exit> [code] [reason]
  local verdict="$1" ec="$2" code="${3:-}" reason="${4:-}"
  python3 - "$PRNUM" "$BASE" "$TIP" "$HEAD" "$FP" "$CI_V" "$OV_V" "$RV_V" "$SR_V" \
            "$verdict" "$ec" "$code" "$reason" "${shared:-0}" <<'PY'
import json, sys
(pr, base, tip, head, fp, ci, ov, rv, sr, verdict, ec, code, reason, shared) = sys.argv[1:15]
def cond(v):
    return v if v in ("ok", "no", "degraded", "skip") else "skip"
obj = {
    "tool": "check-merge-conditions@v1",
    "pr": int(pr) if pr else None,
    "base": base or None,
    "tip": tip or None,
    "head": head or None,
    "fp": ("sha256:" + fp) if fp else None,
    "conditions": {
        "ci": cond(ci),
        "overlap": cond(ov),
        "overlap_shared": int(shared) if str(shared).isdigit() else 0,   # #639-2：共享追加计数（机器可读的「须串行」痕迹）
        "review": "ok(attested)" if rv == "ok" else cond(rv),  # 裁 B3-1：③ 绿必须带级别
        "serial": cond(sr),
    },
    "verdict": verdict,
    "exit": int(ec),
}
if code:
    obj["degraded"] = {"code": code, "reason": reason}
print(json.dumps(obj, ensure_ascii=False, indent=2))
PY
}

die_degraded() { # die_degraded "<code>: <原因>" —— typed error 统一出口（stderr 一行 ＋ degraded log ＋ exit 2）
  local spec="$1" code reason
  code="${spec%%: *}"
  reason="${spec#*: }"
  if [ "$code" = "$spec" ] || [ -z "$reason" ]; then
    code="E_UNKNOWN"
    reason="$spec"
  fi
  printf 'degraded: %s [code=%s]\n' "$reason" "$code" >&2
  append_degraded_log "$code" "$reason" "check"
  if [ "$JSON_MODE" = "1" ]; then
    emit_json "degraded" 2 "$code" "$reason"
  else
    say "MERGE-COND: degraded ${MACHINE_TAIL}"
    say "degraded: ${reason}"
  fi
  exit 2
}

fail() { # fail "<规则码> <消息>" —— 红点统一出口；行首 token 即规则码（R1..R9/S1/S2/CI_*/OVL_*）
  printf '   ✗ %s\n' "$1" >> "$WORK/fails.txt"
}

resolve_token() { # token 三级：GITEA_TOKEN → SYNO_GITEA_TOKEN → $HOME/gitea/.win-push-token
  if [ -n "${GITEA_TOKEN:-}" ]; then printf '%s' "${GITEA_TOKEN}"; return 0; fi
  if [ -n "${SYNO_GITEA_TOKEN:-}" ]; then printf '%s' "${SYNO_GITEA_TOKEN}"; return 0; fi
  if [ -n "${HOME:-}" ] && [ -r "${HOME}/gitea/.win-push-token" ]; then
    tr -d '\r\n' < "${HOME}/gitea/.win-push-token"
    return 0
  fi
  return 1
}

api_curl() { # api_curl <url> <out> <err> → stdout 打 HTTP code（000 = 连接失败/无响应）
  if [ -n "$TOKEN" ]; then
    curl -sS -m 20 -o "$2" -w '%{http_code}' -H "Authorization: token ${TOKEN}" "$1" 2>"$3"
  else
    curl -sS -m 20 -o "$2" -w '%{http_code}' "$1" 2>"$3"
  fi
}

fixture_get() { # fixture_get <api-path> <outfile> → 0 成功 / 1 模拟失败（api_errors / 路径未知）
  python3 - "$FIXTURE" "$1" "$2" <<'PY'
import json, re, sys
fx_path, path, out = sys.argv[1], sys.argv[2], sys.argv[3]
fx = json.load(open(fx_path, encoding="utf-8"))
errs = fx.get("api_errors") or {}

def dump(obj):
    json.dump(obj, open(out, "w", encoding="utf-8"), ensure_ascii=False)

def pr_obj(p):
    return {"number": p["number"], "state": "open",
            "head": {"sha": p.get("head", ""), "ref": p.get("branch", "")},
            "base": {"sha": fx.get("tip", ""), "ref": "local-main"},
            "user": {"login": fx.get("author", "")}}

m = re.match(r"^/pulls\?(.*)$", path)
if m:
    if errs.get("open_prs"):
        sys.exit(1)
    qs = dict(part.split("=", 1) for part in m.group(1).split("&") if "=" in part)
    page = int(qs.get("page", "1"))
    limit = int(qs.get("limit", "50"))
    items = [pr_obj(p) for p in fx.get("open_prs", [])]
    start = (page - 1) * limit
    dump(items[start:start + limit])
    sys.exit(0)

m = re.match(r"^/pulls/(\d+)$", path)
if m:
    n = int(m.group(1))
    if errs.get("pr"):
        sys.exit(1)
    mine = fx.get("pr") or {}
    if int(mine.get("number", -1)) == n:
        dump(pr_obj(dict(mine, number=n)))
        sys.exit(0)
    for p in fx.get("open_prs", []):
        if int(p.get("number", -1)) == n:
            dump(pr_obj(p))
            sys.exit(0)
    sys.exit(1)

m = re.match(r"^/commits/([0-9a-fA-F]+)/status$", path)
if m:
    sha = m.group(1)
    ci = fx.get("ci") or {}
    if sha in ci:
        dump(ci[sha])
    else:  # 夹具未给数据 ＝ 不绿（规格 §4.3.0 数据规则 ④），不得因此 degraded
        dump({"state": "pending", "total_count": 0, "statuses": None})
    sys.exit(0)

sys.exit(1)
PY
}

api_get() { # api_get <api-path> <outfile> → stdout 打 HTTP code（fixture 模式由夹具替换）
  local path="$1" out="$2" code rc
  if [ "$FIXTURE_MODE" = "1" ]; then
    if fixture_get "$path" "$out"; then printf '200'; else printf '500'; fi
    return 0
  fi
  code="$(api_curl "${API}/repos/${REPO}${path}" "$out" "$WORK/api.err")"
  rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$code" ]; then printf '000'; return 0; fi
  printf '%s' "$code"
}

jget() { # jget <jsonfile> <dotted-path> → 标量值（失败非零退出）
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    cur = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(3)
for k in sys.argv[2].split("."):
    if isinstance(cur, list):
        try:
            cur = cur[int(k)]
        except Exception:
            sys.exit(4)
    elif isinstance(cur, dict):
        if k not in cur:
            sys.exit(4)
        cur = cur[k]
    else:
        sys.exit(4)
if isinstance(cur, (dict, list)):
    print(json.dumps(cur, ensure_ascii=False))
else:
    print("" if cur is None else cur)
PY
}

ci_summary() { # ci_summary <jsonfile> → "<state> <total_count>"（解析失败非零退出）
  python3 - "$1" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    st = str(d.get("state", ""))
    tc = int(d.get("total_count", 0))
except Exception:
    sys.exit(3)
print(st, tc)
PY
}

ci_bad_statuses() { # ci_bad_statuses <jsonfile> → 每行 "context=status"（仅 pending/failure/error）
  python3 - "$1" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(3)
for s in (d.get("statuses") or []):
    st = s.get("status", "")
    if st in ("pending", "failure", "error"):
        print("%s=%s" % (s.get("context", ""), st))
PY
}

scan_open_prs() { # 分页拉全 open PR（禁 limit 饱和）→ $WORK/pulls.json ＋ $WORK/prs.tsv
  if [ -s "$WORK/prs.tsv" ]; then return 0; fi
  local page=1 code n
  : > "$WORK/pulls_parts.txt"
  while [ "$page" -le "$MAX_PAGES" ]; do
    code="$(api_get "/pulls?state=open&limit=${PAGE_SIZE}&page=${page}" "$WORK/pulls_p${page}.json")"
    if [ "$code" != "200" ]; then
      if [ "$code" = "000" ]; then
        die_degraded "E_API_UNREACHABLE: Gitea API 不可达（${API}）"
      fi
      die_degraded "E_OPENPRS_HTTP: open PR 列表不可达（HTTP ${code} on /pulls?state=open，fail-closed）"
    fi
    n="$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1],encoding="utf-8"))))' "$WORK/pulls_p${page}.json")" || n=""
    if [ -z "$n" ]; then
      die_degraded "E_OPENPRS_JSON: open PR 列表 JSON 解析失败（/pulls page ${page}）"
    fi
    printf '%s\n' "$WORK/pulls_p${page}.json" >> "$WORK/pulls_parts.txt"
    if [ "$n" -lt "$PAGE_SIZE" ]; then break; fi
    page=$((page + 1))
  done
  python3 - "$WORK" <<'PY'
import json, os, sys
work = sys.argv[1]
items, seen = [], set()
for line in open(os.path.join(work, "pulls_parts.txt"), encoding="utf-8"):
    part = line.strip()
    if not part:
        continue
    for it in json.load(open(part, encoding="utf-8")):
        n = it.get("number")
        if n in seen:
            continue
        seen.add(n)
        items.append(it)
json.dump(items, open(os.path.join(work, "pulls.json"), "w", encoding="utf-8"), ensure_ascii=False)
with open(os.path.join(work, "prs.tsv"), "w", encoding="utf-8") as f:
    for it in items:
        head = (it.get("head") or {})
        f.write("%s\t%s\t%s\n" % (it.get("number"), head.get("sha", ""), head.get("ref", "")))
PY
  return 0
}

ensure_ref() { # ensure_ref <sha> <pr-number> → 0 且置 REF_POINT（规范 §2.2：fetch refs/pull/<n>/head → refs/p7cmp/pr/<n>）
  local sha="$1" n="$2"
  REF_POINT=""
  if git -C "$ROOT" cat-file -e "${sha}^{commit}" >/dev/null 2>&1; then
    REF_POINT="$sha"
    return 0
  fi
  if [ "$FIXTURE_MODE" = "1" ] || [ "$OFFLINE" = "1" ]; then
    if git -C "$ROOT" rev-parse -q --verify "refs/p7cmp/pr/${n}" >/dev/null 2>&1; then
      REF_POINT="$(git -C "$ROOT" rev-parse "refs/p7cmp/pr/${n}")"
      return 0
    fi
    return 1
  fi
  if git -C "$ROOT" fetch -q gitea "refs/pull/${n}/head" >/dev/null 2>&1; then
    if git -C "$ROOT" update-ref "refs/p7cmp/pr/${n}" FETCH_HEAD >/dev/null 2>&1; then
      REF_POINT="$(git -C "$ROOT" rev-parse "refs/p7cmp/pr/${n}")"
      return 0
    fi
  fi
  return 1
}

diff_files() { # diff_files <a> <b> → 每行一个文件（-z 安全：中文/空格不裂）
  local a="$1" b="$2"
  if ! git -C "$ROOT" diff --name-only -z "$a" "$b" -- . > "$WORK/.diff.tmp"; then
    return 1
  fi
  tr '\0' '\n' < "$WORK/.diff.tmp"
}

_fp_compute() { # _fp_compute <root> <mb> <head> → 64 hex（③-2.1 唯一实现：逐字增删行＋EOF 标记＋二进制 blob id）
  # ③-2.1 定义（裁 386；替换 ③-2.0）：
  #   canonical = 每文件的「增删行原文（含空白、含 "\ No newline at end of file" 标记）」＋ 路径 ＋ 模式/改名；
  #               **二进制文件**改记 "B <path> <head 侧 blob sha>"（没有行可看，用内容 id 兜住）；
  #   **不含** hunk 头（行号）与上下文行 ⇒ `git merge main` 不改指纹；
  #   **含空白与 EOF 换行** ⇒ 改一个空格/去一个末尾换行也必变（R3 不削弱）。
  #   fail-closed：diff 非空但 canonical 取不到 ⇒ return 1（不冒充空 diff）。
  local ROOT="$1" mb="$2" head="$3"
  if ! git -C "$ROOT" diff --no-color -M --binary "$mb" "$head" \
        -- . ':(exclude)docs/synova/reviews/**' > "$WORK/fp.diff"; then
    return 1
  fi
  if [ ! -s "$WORK/fp.diff" ]; then
    printf '%s' "EMPTY-DIFF" | python3 -c 'import hashlib,sys;print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
    return 0
  fi
  python3 - "$ROOT" "$head" "$WORK/fp.diff" "$WORK/fp.canon" <<'PY'
import hashlib, subprocess, sys
root, head, diff_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
lines = open(diff_path, 'rb').read().decode('utf-8', 'surrogateescape').splitlines()
out, cur, binary = [], None, False
def flush():
    global cur, binary
    if cur is not None and binary:
        try:
            blob = subprocess.run(['git','-C',root,'rev-parse',f'{head}:{cur}'],
                                  capture_output=True, text=True, timeout=20).stdout.strip()
        except Exception:
            blob = ''
        if not blob:
            raise SystemExit(3)   # head 侧取不到 blob ⇒ fail-closed
        out.append('B ' + cur + ' ' + blob)
    cur, binary = None, False
for ln in lines:
    if ln.startswith('diff --git '):
        flush()
        cur = ln.rsplit(' b/', 1)[-1]
        out.append('F ' + cur)
    elif ln.startswith('Binary files ') or ln.startswith('GIT binary patch'):
        binary = True
    elif ln.startswith('+++ ') or ln.startswith('--- '):
        continue
    elif ln.startswith('\\ No newline at end of file'):
        out.append('E ' + ln)          # EOF 换行标记也参与哈希
    elif ln.startswith('+'):
        out.append('A' + ln[1:])
    elif ln.startswith('-'):
        out.append('R' + ln[1:])
    elif ln.startswith(('old mode','new mode','rename from','rename to',
                        'similarity index','dissimilarity index',
                        'new file mode','deleted file mode')):
        out.append('M ' + ln)
flush()
if not out:
    raise SystemExit(3)
open(out_path, 'wb').write(('\n'.join(out) + '\n').encode('utf-8', 'surrogateescape'))
print(hashlib.sha256(open(out_path,'rb').read()).hexdigest())
PY
}
patch_fingerprint() { _fp_compute "$ROOT" "$1" "$2"; }   # 生产路径：③ 指纹（③-2.1）


resolve_tip() { # ④ S1 基线真值：git ls-remote（禁本地 stale ref）；fixture 模式取夹具 tip
  if [ "$FIXTURE_MODE" = "1" ]; then
    if ! TIP="$(jget "$FIXTURE" tip)"; then
      die_degraded "E_FIXTURE_TIP: fixture 缺 tip 字段"
    fi
    if [ -z "$TIP" ]; then die_degraded "E_FIXTURE_TIP: fixture tip 为空"; fi
    return 0
  fi
  local out
  out="$(git -C "$ROOT" ls-remote gitea "refs/heads/${BASE}" 2>"$WORK/lsremote.err")"
  if [ $? -ne 0 ] || [ -z "$out" ]; then
    die_degraded "E_REF_TIP: git ls-remote gitea refs/heads/${BASE} 失败（④ 需远端真值，禁本地 stale ref）"
  fi
  set -- $out
  TIP="$1"
  if [ -z "$TIP" ]; then die_degraded "E_REF_TIP: refs/heads/${BASE} 远端为空"; fi
}

review_check() { # review_check <pr> <head> <mb> <out-file> [warn-flag] → stdout ok|no
  # ③ T1 attested：R1–R9 全部由 git 事实判定（R9 只告警且恒打印）
  local pr="$1" head="$2" mb="$3" out="$4" do_warn="${5:-0}"
  : > "$out"
  local fp fp12 rpath
  if ! fp="$(patch_fingerprint "$mb" "$head")"; then
    printf 'degraded\n' > "$out.verdict"
    return 0
  fi
  fp12="${fp:0:12}"
  rpath="docs/synova/reviews/${pr}.${fp12}.json"
  local rpath_used=""
  # R1 回执在 head 树：先查当次指纹的规范路径；查不到再看该 PR 是否有「旧指纹」的回执
  #（改码后指纹变 ⇒ 旧回执立即作废：此时报 R3/R7 而非 R1，才说得出「为什么作废」）
  if git -C "$ROOT" cat-file -e "${head}:${rpath}" >/dev/null 2>&1; then
    rpath_used="$rpath"
  else
    rpath_used="$(git -C "$ROOT" ls-tree -r --name-only "$head" -- "docs/synova/reviews" \
      | grep -E "^docs/synova/reviews/${pr}\\.[0-9a-f]{12}\\.json$" | tail -n 1)"
    if [ -z "$rpath_used" ]; then
      printf 'R1 缺回执 %s\n' "$rpath" >> "$out"
      printf 'no\n' > "$out.verdict"
      return 0
    fi
  fi
  if ! git -C "$ROOT" show "${head}:${rpath_used}" > "$WORK/receipt_${pr}.json" 2>"$WORK/receipt.err"; then
    printf 'R2 回执不可读 %s\n' "$rpath_used" >> "$out"
    printf 'no\n' > "$out.verdict"
    return 0
  fi
  # R2 schema/字段、R3 指纹、R4 结论、R5 阻断发现、R6 非自我复核、R8 证据非空
  python3 - "$WORK/receipt_${pr}.json" "$pr" "$fp" >> "$out" <<'PY'
import json, re, sys
path, prnum, exp_fp = sys.argv[1], int(sys.argv[2]), sys.argv[3]
try:
    d = json.load(open(path, encoding="utf-8"))
except Exception:
    print("R2 回执 JSON 不可解析")
    raise SystemExit(0)
fails = []
# R2 逐字段
if d.get("schema") != "syno-review-receipt/v1":
    fails.append("R2 schema 必须为 syno-review-receipt/v1（实际 %r）" % (d.get("schema"),))
if d.get("pr") != prnum:
    fails.append("R2 pr 必须为 %d（实际 %r）" % (prnum, d.get("pr")))
for k in ("author", "reviewer", "tool"):
    v = d.get(k)
    if not isinstance(v, str) or not v.strip():
        fails.append("R2 缺字段或为空 %s" % k)
if d.get("independence") != "fresh-session":
    fails.append("R2 independence 必须为 fresh-session（实际 %r）" % (d.get("independence"),))
if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", str(d.get("issued_at", ""))):
    fails.append("R2 issued_at 必须为 ISO-8601（实际 %r）" % (d.get("issued_at"),))
# R3 防重放（禁前缀/模糊匹配）
if str(d.get("patch_fingerprint", "")) != ("sha256:" + exp_fp):
    fails.append("R3 指纹不匹配（回执已被改码作废）")
# R4 复核结论
checks = d.get("checks")
findings = d.get("findings")
if d.get("verdict") != "PASS":
    fails.append("R4 verdict 必须为 PASS（实际 %r）" % (d.get("verdict"),))
if not isinstance(checks, list):
    fails.append("R4 checks 必须是数组")
elif len(checks) < 5:
    fails.append("R4 checks 不足 5 条（实际 %d）" % len(checks))
else:
    for i, c in enumerate(checks):
        if not isinstance(c, dict) or c.get("result") != "pass":
            fails.append("R4 checks[%d] 未 pass" % i)
if not isinstance(findings, list):
    fails.append("R4 findings 必须是数组")
else:
    # R5 无阻断发现
    for i, fd in enumerate(findings):
        if isinstance(fd, dict) and fd.get("severity") == "block":
            fails.append("R5 存在 block 级发现（findings[%d]）" % i)
# R6 非自我复核
if d.get("author") == d.get("reviewer"):
    fails.append("R6 reviewer 与 author 相同")
# R8 证据非空
if isinstance(checks, list):
    for i, c in enumerate(checks):
        if not isinstance(c, dict):
            fails.append("R8 checks[%d] 缺 cmd/evidence" % i)
            continue
        if not str(c.get("cmd") or "").strip() or not str(c.get("evidence") or "").strip():
            fails.append("R8 checks[%d] 缺 cmd/evidence" % i)
for f in fails:
    print(f)
PY
  # R7 时序：回执引入提交之后只允许 docs/synova/reviews/**
  local csha after
  csha="$(git -C "$ROOT" log --diff-filter=A --format=%H -1 "$head" -- "$rpath_used")"
  if [ -z "$csha" ]; then
    printf 'R7 无法定位回执引入提交 %s\n' "$rpath" >> "$out"
  else
    # 只禁"非合并提交"在回执之后：sync 的 merge 提交不算代码改动（其内容变化由 R3 指纹兜住）
    after="$(git -C "$ROOT" rev-list --no-merges --first-parent "$csha..$head")"
    if [ -n "$after" ]; then
      while IFS= read -r c; do
        [ -n "$c" ] && printf 'R7 回执之后仍有代码改动: %s\n' "$c" >> "$out"
      done <<EOF
$after
EOF
    fi
  fi
  # R9 告警级（恒打印，裁 B3-2）：回执引入提交 %ae ∈ PR 代码提交 %ae 集合
  if [ "$do_warn" = "1" ] && [ -n "$csha" ]; then
    local cemail emails
    cemail="$(git -C "$ROOT" log -1 --format='%ae' "$csha")"
    emails="$(git -C "$ROOT" log --format='%ae' "${mb}..${head}" -- . ':(exclude)docs/synova/reviews/**')"
    if [ -n "$cemail" ] && printf '%s\n' "$emails" | grep -Fxq "$cemail"; then
      warn "身份未分离（本机 git 身份不可信：回执引入提交的作者邮箱与 PR 代码提交相同；R9 只告警，不阻断）"
    fi
  fi
  if [ -s "$out" ]; then printf 'no\n' > "$out.verdict"; else printf 'ok\n' > "$out.verdict"; fi
}

# ─── ⑤ 四条件 ──────────────────────────────────────────────────────────────────
cond1_ci() { # ① CI 全绿 pending=0
  if [ "$OFFLINE" = "1" ]; then
    die_degraded "E_CI_OFFLINE: --offline 无 CI 真值（不引本地缓存，裁 B5）"
  fi
  local code state total raw bad
  code="$(api_get "/commits/${HEAD}/status" "$WORK/ci.json")"
  case "$code" in
    200) : ;;
    000) die_degraded "E_API_UNREACHABLE: Gitea API 不可达（${API}）" ;;
    *)   die_degraded "E_CI_HTTP: HTTP ${code} on /commits/${HEAD}/status" ;;
  esac
  if ! raw="$(ci_summary "$WORK/ci.json")"; then
    die_degraded "E_CI_JSON: CI 状态 JSON 解析失败（/commits/${HEAD}/status）"
  fi
  state="${raw%% *}"
  total="${raw##* }"
  if [ "$total" = "0" ]; then
    # F4：无 CI 的提交被 Gitea 报成 pending ⇒ 「看不见」≠「没问题」（信号量==0 约定）
    die_degraded "E_CI_VOID: CI 信号量==0（state=${state} total_count=0；禁判绿也禁判红）"
  fi
  if ! bad="$(ci_bad_statuses "$WORK/ci.json")"; then
    die_degraded "E_CI_JSON: CI statuses 解析失败"
  fi
  if [ -n "$bad" ]; then
    CI_V="no"
    while IFS= read -r line; do
      [ -n "$line" ] && fail "CI_NOT_GREEN: ${line}"
    done <<EOF
$bad
EOF
    if [ "$state" != "success" ]; then fail "CI_NOT_GREEN: state=${state}（绿要求 state==success）"; fi
  elif [ "$state" != "success" ]; then
    CI_V="no"
    fail "CI_NOT_GREEN: state=${state}（绿要求 state==success；total_count=${total}）"
  else
    CI_V="ok"
  fi
  MACHINE_TAIL="①=${CI_V}"
  say "① CI 全绿 pending=0 ......... ${CI_V} (state=${state} total_count=${total})"
  flush_fails
}

# ── ② 共享追加文件白名单（创始人 2026-10-19 裁 A；Issue #627）────────────────
#   为什么：`docs/authority/DOCS-REGISTRY.yaml` 是**追加型中枢**——任何需 D2 登记的新文档
#   PR 都会碰它 ⇒ 严格重叠判定下，在飞期间**所有持有方都无法合并**（实测 8 个 PR 互相锁死）。
#   判定改为：白名单文件的重叠**不计 ②**，改由 ④ 的 S2（队列头）＋合并前 rebase 保证**一次只合一个**。
# #裁 370/376（效率）：登记表类**纯追加**才算共享追加；**任何删除/改写仍判硬重叠**
#   （防"借追加之名删登记行"）。三条均为 append-only 中枢：DOCS / WIRING / GATE-INVENTORY。
SHARED_APPEND_PATHS="docs/authority/DOCS-REGISTRY.yaml
docs/authority/WIRING-REGISTRY.yaml
docs/authority/GATE-INVENTORY.yaml"
is_shared_append() { # <path> ⇒ 0=白名单内（不判硬重叠） / 1=不在
  local p="$1" x
  while IFS= read -r x; do          # #636 复核 finding 5：逐行读，防单词拆分/通配展开
    [ -n "$x" ] || continue
    [ "$p" = "$x" ] && return 0
  done <<EOF
$SHARED_APPEND_PATHS
EOF
  return 1
}

is_pure_append() { # <base> <head> <file> ⇒ 0=纯追加（additions>0 且 deletions==0）
  local base="$1" head="$2" f="$3" nums add del
  nums="$(git -C "$ROOT" diff --numstat "$base" "$head" -- "$f" | head -1)"
  [ -n "$nums" ] || return 1
  add="$(printf '%s' "$nums" | awk '{print $1}')"
  del="$(printf '%s' "$nums" | awk '{print $2}')"
  case "$add$del" in *-*) return 1 ;; esac          # 二进制 ⇒ 不看内容，判非纯追加
  [ "$del" = "0" ] && [ "${add:-0}" -gt 0 ]
}

cond2_overlap() { # ② 零写集重叠（实际 diff × 实际 diff；open PR 分页拉全）
  local mb="$1" head="$2"
  scan_open_prs
  mkdir -p "$WORK/files" "$WORK/mb" "$WORK/head"
  if ! diff_files "$mb" "$head" > "$WORK/files/0.txt"; then
    die_degraded "E_DIFF: git diff 失败（本 PR 文件集 ${mb}..${head}）"
  fi
  local pairs=0 hits=0 pnum phead pref psha pmb f
  shared=0
  while IFS="$(printf '\t')" read -r pnum phead pref; do
    [ -n "$pnum" ] || continue
    [ "$pnum" = "$PRNUM" ] && continue
    if ! ensure_ref "$phead" "$pnum"; then
      die_degraded "E_REF_FETCH: PR#${pnum} 的 head ${phead} 取不到（ref fetch 失败，fail-closed）"
    fi
    psha="$REF_POINT"
    if ! pmb="$(git -C "$ROOT" merge-base "$TIP" "$psha")"; then
      die_degraded "E_MERGE_BASE: PR#${pnum} merge-base(${TIP},${psha}) 失败"
    fi
    printf '%s\n' "$pmb" > "$WORK/mb/${pnum}.txt"
    printf '%s\n' "$psha" > "$WORK/head/${pnum}.txt"
    if ! diff_files "$pmb" "$psha" > "$WORK/files/${pnum}.txt"; then
      die_degraded "E_DIFF: git diff 失败（PR#${pnum} 文件集）"
    fi
    pairs=$((pairs + 1))
    local hit
    hit="$(comm -12 <(LC_ALL=C sort -u "$WORK/files/0.txt") <(LC_ALL=C sort -u "$WORK/files/${pnum}.txt"))"
    if [ -n "$hit" ]; then
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        if is_shared_append "$f"; then
          if is_pure_append "$mb" "$head" "$f" && is_pure_append "$pmb" "$psha" "$f"; then
            shared=$((shared + 1))
            say "   ② 共享追加（纯追加，不计重叠，须串行合）: ${f} → PR#${PRNUM},#${pnum}"
            continue
          fi
          hits=$((hits + 1))
          fail "OVL_FILE: ${f} → PR#${PRNUM},#${pnum}（登记表非纯追加：含删除/改写 ⇒ 判硬重叠）"
          continue
        fi
        hits=$((hits + 1))
        fail "OVL_FILE: ${f} → PR#${PRNUM},#${pnum}"
      done <<EOF
$hit
EOF
    fi
  done < "$WORK/prs.tsv"
  if [ "$hits" -gt 0 ]; then OV_V="no"; else OV_V="ok"; fi
  # #639-2：共享追加须有机器可读痕迹（下游 grep MERGE-COND 能看到"存在共享追加、须串行"）
  if [ "$shared" -gt 0 ]; then MACHINE_TAIL="${MACHINE_TAIL} ②=${OV_V}(shared:${shared})"; else MACHINE_TAIL="${MACHINE_TAIL} ②=${OV_V}"; fi
  if [ "$shared" -gt 0 ]; then OV_SHARED_SUFFIX="(shared:${shared})"; else OV_SHARED_SUFFIX=""; fi
  say "② 零写集重叠 ............... ${OV_V} (比对 ${pairs} 对，${hits} 处文件重叠，${shared} 处共享追加不计)"
  say "   ② 信息级：声明 vs 声明交集 由 devdoc_writeset.py --overlap-a/--overlap-b 提供（本件不重写、不参与判定）"
  flush_fails
}

cond3_review() { # ③ 已过独立复核（T1 attested 单轨）
  local mb="$1" head="$2" rv
  if ! FP="$(patch_fingerprint "$mb" "$head")"; then
    die_degraded "E_FP: 补丁指纹计算失败（${mb}..${head}）"
  fi
  review_check "$PRNUM" "$head" "$mb" "$WORK/rv_self.txt" 1
  rv="$(cat "$WORK/rv_self.txt.verdict")"
  if [ "$rv" = "degraded" ]; then
    die_degraded "E_FP: 补丁指纹计算失败（③ 无法判定）"
  fi
  RV_V="$rv"
  if [ "$rv" = "no" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] && fail "$line"
    done < "$WORK/rv_self.txt"
  fi
  # （#603：此处原写 MACHINE_TAIL 的 ③ 赋值＝死代码 —— 只有 die_degraded 打印 MACHINE_TAIL，
  #   ③ 赋值之后无降级点 ⇒ 永不输出，铁律 37。机器行统一由 main() 的 tok3 出，见下）
  say "③ 已过独立复核（T1 attested） ${RV_V}$( [ "$RV_V" = "ok" ] && printf '(attested)') (fp=${FP:0:12})"
  flush_fails
  flush_warns
}

cond4_serial() { # ④ 串行（S1 基线新 ＋ S2 队首）
  local tip="$1" head="$2" s1="ok" s2="ok" behind ready="" q=""
  # S1 基线新：远端真值 tip 必须是 head 祖先
  if ! git -C "$ROOT" merge-base --is-ancestor "$tip" "$head" >/dev/null 2>&1; then
    behind="$(git -C "$ROOT" rev-list --count "${head}..${tip}")"
    [ -n "$behind" ] || behind="?"
    fail "S1 tip ${tip:0:9} 不是 head 祖先（落后 ${behind} commits）⇒ 需 rebase"
    s1="no"
  fi
  # S2 队首：就绪集 = ①∧②∧③∧S1 全绿者，取编号最小者 Q
  local pnum phead pref psha pmb ciq ovq rvq s1q code2 raw st tc of other nums=""
  # 先把全部 open PR 编号收齐（次级 ② 要对该集合内所有其它 PR 比对，不能只看「已处理过的」）
  local n_tmp
  while IFS="$(printf '\t')" read -r n_tmp phead pref; do
    [ -n "$n_tmp" ] && nums="${nums} ${n_tmp}"
  done < "$WORK/prs.tsv"
  while IFS="$(printf '\t')" read -r pnum phead pref; do
    [ -n "$pnum" ] || continue
    if [ "$pnum" = "$PRNUM" ]; then
      if [ "$CI_V" = "ok" ] && [ "$OV_V" = "ok" ] && [ "$RV_V" = "ok" ] && [ "$s1" = "ok" ]; then
        ready="${ready} ${pnum}"
      fi
      continue
    fi
    # ① 次级 CI：取不到 ⇒ 不绿（不 degrade；夹具未给数据同理）
    ciq="no"
    if ! ensure_ref "$phead" "$pnum"; then
      ciq="no"
    else
      psha="$REF_POINT"
      code2="$(api_get "/commits/${psha}/status" "$WORK/ci_${pnum}.json")"
      if [ "$code2" = "200" ]; then
        if raw="$(ci_summary "$WORK/ci_${pnum}.json")"; then
          st="${raw%% *}"
          tc="${raw##* }"
          if [ "$st" = "success" ] && [ "$tc" -ge 1 ]; then
            if [ -z "$(ci_bad_statuses "$WORK/ci_${pnum}.json")" ]; then ciq="ok"; fi
          fi
        fi
      fi
    fi
    # ② 次级重叠：与该集合内任一号的文件集有交集 ⇒ 不绿
    ovq="ok"
    if [ -f "$WORK/files/${pnum}.txt" ]; then
      for other in $nums; do
        [ "$other" = "$pnum" ] && continue
        of="$WORK/files/${other}.txt"
        [ "$other" = "$PRNUM" ] && of="$WORK/files/0.txt"
        if [ -f "$of" ] && [ -n "$(comm -12 <(LC_ALL=C sort -u "$WORK/files/${pnum}.txt") <(LC_ALL=C sort -u "$of"))" ]; then
          ovq="no"
          break
        fi
      done
    else
      ovq="no"
    fi
    # ③ 次级复核
    rvq="no"
    if [ -f "$WORK/mb/${pnum}.txt" ]; then
      pmb="$(cat "$WORK/mb/${pnum}.txt")"
      review_check "$pnum" "$psha" "$pmb" "$WORK/rv_${pnum}.txt" 0
      rvq="$(cat "$WORK/rv_${pnum}.txt.verdict")"
      [ "$rvq" = "degraded" ] && rvq="no"
    fi
    # ④ S1 次级
    s1q="no"
    if git -C "$ROOT" merge-base --is-ancestor "$tip" "$psha" >/dev/null 2>&1; then s1q="ok"; fi
    if [ "$ciq" = "ok" ] && [ "$ovq" = "ok" ] && [ "$rvq" = "ok" ] && [ "$s1q" = "ok" ]; then
      ready="${ready} ${pnum}"
    fi
  done < "$WORK/prs.tsv"
  for other in $ready; do
    if [ -z "$q" ] || [ "$other" -lt "$q" ]; then q="$other"; fi
  done
  if [ -z "$q" ] || [ "$q" = "$PRNUM" ]; then
    s2="ok"
  else
    s2="no"
    fail "S2 前置就绪 PR #${q} 编号更小 ⇒ 先合它"
  fi
  if [ "$s1" = "ok" ] && [ "$s2" = "ok" ]; then SR_V="ok"; else SR_V="no"; fi
  # （#603：原 MACHINE_TAIL 的 ④ 赋值同样是死代码 —— cond4 无降级点，永不输出）
  say "④ 串行 ..................... ${SR_V} (S1=${s1} S2=${s2} 就绪集=${ready:-空})"
  flush_fails
}

# ─── ③ 参数与用法 ──────────────────────────────────────────────────────────────
usage() {
  cat <<'USAGE'
check-merge-conditions.sh — 四条件一条命令判绿/红（#582 · P7-1）

用法:
  bash scripts/control-tower/check-merge-conditions.sh [选项]

选项:
  --pr <N>                  目标 PR（缺省＝按当前分支名反查 open PR，查不到 ⇒ exit 2）
  --base <ref>              基线分支（缺省 SYNO_MERGE_BASE | local-main）
  --repo-root <path>        仓库根（缺省＝脚本所在目录的上两级）
  --json                    stdout 仅 JSON（与 --selfcheck 互斥 ⇒ exit 2）
  --offline                 不访问网络（🔴 ① 恒 exit 2 —— 裁 B5：不引本地 CI 缓存）
  --diff-fingerprint        只打印 ③ 的补丁指纹（64 hex，供回执填写）
  --fp-of <mb> <head>       直接算两个提交之间的 ③ 指纹（测试/自检缝；不走 API）
  --print-receipt-template  打印 syno-review-receipt/v1 回执骨架（不写文件）
  --fp-of <mb> <head>       直接算 ③ 指纹（测试缝；不走 API）
  --selfcheck               判别力自检（临时 git 仓＋夹具，零网络，13 判定点）
  --help                    本帮助

退出码（三态）:
  0 四条件全绿（末行 CAN-自合并）
  1 至少一条红（末行 NO: <条件名>，逐条给失败点）
  2 检查自身失败/降级（stderr degraded: <原因>，绝不等于通过）

④ 回执生成（本题只走路径二）:
  bash scripts/control-tower/check-merge-conditions.sh --pr <N> --diff-fingerprint
  bash scripts/control-tower/check-merge-conditions.sh --pr <N> --print-receipt-template > /tmp/r.json
  # 复核者按 .dsh/skills/pr-review/SKILL.md 五步填 checks/verdict，写入
  # docs/synova/reviews/<N>.<fp 前 12 位>.json 并 commit（必须是本分支最后一个提交）
USAGE
}

need_value() { # need_value <flag>
  if [ "$2" -lt 2 ]; then
    printf 'degraded: 参数 %s 缺少取值 [code=E_ARGS]\n' "$1" >&2
    usage >&2
    exit 2
  fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --pr) need_value "--pr" $#; PRNUM="$2"; shift 2 ;;
      --pr=*) PRNUM="${1#--pr=}"; shift ;;
      --base) need_value "--base" $#; BASE="$2"; shift 2 ;;
      --base=*) BASE="${1#--base=}"; shift ;;
      --repo-root) need_value "--repo-root" $#; ROOT="$2"; shift 2 ;;
      --repo-root=*) ROOT="${1#--repo-root=}"; shift ;;
      --json) JSON_MODE=1; shift ;;
      --offline) OFFLINE=1; shift ;;
      --diff-fingerprint) DIFF_FP=1; shift ;;
      --fp-of)
        if [ "$#" -lt 3 ] || [ -z "$3" ]; then
          printf 'degraded: --fp-of 需要两个提交（mb head） [code=E_ARGS]\n' >&2; exit 2
        fi
        FP_MB="$2"; FP_HEAD="$3"; shift 3 ;;
      --print-receipt-template) TEMPLATE=1; shift ;;
      --selfcheck) SELFCHECK=1; shift ;;
      --help|-h) usage; exit 0 ;;
      *)
        printf 'degraded: 非法参数 %s [code=E_ARGS]\n' "$1" >&2
        usage >&2
        exit 2
        ;;
    esac
  done
  if [ -n "$PRNUM" ]; then
    case "$PRNUM" in
      ''|*[!0-9]*) printf 'degraded: --pr 必须是数字（实际 %s） [code=E_ARGS]\n' "$PRNUM" >&2; exit 2 ;;
    esac
  fi
  if [ "$JSON_MODE" = "1" ] && [ "$SELFCHECK" = "1" ]; then
    printf 'degraded: --json 与 --selfcheck 互斥 [code=E_ARGS_MUTEX]\n' >&2
    exit 2
  fi
}

# ─── ⑥ 编排与输出 ──────────────────────────────────────────────────────────────
resolve_pr() {
  if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
    die_degraded "E_REPO_ROOT: 仓库根不存在（${ROOT}）"
  fi
  if ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    die_degraded "E_REPO_ROOT: 不是 git 仓库（${ROOT}）"
  fi
  if [ -z "$PRNUM" ]; then
    local br
    br="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
    scan_open_prs
    PRNUM="$(awk -F"$(printf '\t')" -v b="$br" '$3==b{print $1; exit}' "$WORK/prs.tsv")"
    if [ -z "$PRNUM" ]; then
      die_degraded "E_PR_LOOKUP: 无法按分支名 ${br} 反查 open PR（请显式给 --pr）"
    fi
  fi
  local code state
  code="$(api_get "/pulls/${PRNUM}" "$WORK/pr.json")"
  case "$code" in
    200) : ;;
    000) die_degraded "E_API_UNREACHABLE: Gitea API 不可达（${API}）" ;;
    *)   die_degraded "E_API_HTTP: HTTP ${code} on /pulls/${PRNUM}" ;;
  esac
  if ! state="$(jget "$WORK/pr.json" state)"; then
    die_degraded "E_PR_JSON: PR JSON 解析失败（/pulls/${PRNUM}）"
  fi
  if [ "$state" != "open" ]; then
    die_degraded "E_PR_NOT_OPEN: PR #${PRNUM} 非 open（state=${state}）"
  fi
  if ! HEAD="$(jget "$WORK/pr.json" head.sha)"; then
    die_degraded "E_PR_JSON: /pulls/${PRNUM} 缺 head.sha"
  fi
  if [ -z "$HEAD" ]; then die_degraded "E_PR_JSON: /pulls/${PRNUM} head.sha 为空"; fi
}

main() {
  parse_args "$@"
  # --fp-of：纯本地指纹（测试/自检缝；不解析 PR、不访问网络）
  if [ -n "$FP_MB" ]; then
    if [ -z "$FP_HEAD" ]; then
      printf 'degraded: --fp-of 需要两个提交（mb head） [code=E_ARGS]\n' >&2
      exit 2
    fi
    if ! FP="$(patch_fingerprint "$FP_MB" "$FP_HEAD")"; then
      die_degraded "E_FP: 补丁指纹计算失败（--fp-of ${FP_MB} ${FP_HEAD}）"
    fi
    printf '%s\n' "$FP"
    exit 0
  fi
  if [ "$SELFCHECK" = "1" ]; then
    selfcheck
    exit $?
  fi
  if [ "$FIXTURE_MODE" != "1" ]; then
    TOKEN="$(resolve_token)" || TOKEN=""
  fi
  # 裁 B5：--offline 时 ① 恒 exit 2（无 API 即无 CI 真值；禁产假绿）
  if [ "$OFFLINE" = "1" ]; then
    if [ -z "$PRNUM" ]; then
      die_degraded "E_OFFLINE_PR: --offline 必须显式给 --pr（不访问网络，无法反查 open PR）"
    fi
    die_degraded "E_CI_OFFLINE: --offline 无 CI 真值（不引本地缓存，裁 B5）"
  fi
  resolve_pr
  resolve_tip
  if ! git -C "$ROOT" cat-file -e "${HEAD}^{commit}" >/dev/null 2>&1; then
    if ! ensure_ref "$HEAD" "$PRNUM"; then
      die_degraded "E_REF_FETCH: PR#${PRNUM} 的 head ${HEAD} 取不到（fail-closed）"
    fi
  fi
  if ! git -C "$ROOT" cat-file -e "${HEAD}^{commit}" >/dev/null 2>&1; then
    die_degraded "E_HEAD: head ${HEAD} 在本地仍取不到（ref 已前移？请重跑）"
  fi
  if ! MB="$(git -C "$ROOT" merge-base "$TIP" "$HEAD")"; then
    die_degraded "E_MERGE_BASE: merge-base(${TIP},${HEAD}) 失败"
  fi
  if [ "$DIFF_FP" = "1" ]; then
    if ! FP="$(patch_fingerprint "$MB" "$HEAD")"; then
      die_degraded "E_FP: 补丁指纹计算失败"
    fi
    printf '%s\n' "$FP"
    exit 0
  fi
  if [ "$TEMPLATE" = "1" ]; then
    if ! FP="$(patch_fingerprint "$MB" "$HEAD")"; then
      die_degraded "E_FP: 补丁指纹计算失败"
    fi
    python3 - "$PRNUM" "$FP" <<'PY'
import datetime, json, sys
pr, fp = int(sys.argv[1]), sys.argv[2]
tmpl = {
    "schema": "syno-review-receipt/v1",
    "pr": pr,
    "patch_fingerprint": "sha256:" + fp,
    "author": "<被复核会话标识>",
    "reviewer": "<复核会话标识（fresh，未参与实现）>",
    "independence": "fresh-session",
    "verdict": "PASS",
    "checks": [],
    "findings": [],
    "issued_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
    "tool": "pr-review@v1（.dsh/skills/pr-review/SKILL.md 五步）",
}
print(json.dumps(tmpl, ensure_ascii=False, indent=2))
PY
    say "① 骨架已打印：checks[] 需按 pr-review 五步填满 ≥5 条（每条的 cmd/evidence 非空），否则 R4/R8 会红" >&2
    exit 0
  fi
  cond1_ci
  cond2_overlap "$MB" "$HEAD"
  cond3_review "$MB" "$HEAD"
  cond4_serial "$TIP" "$HEAD"
  local names="" tok3="no"
  [ "$RV_V" = "ok" ] && tok3="ok(attested)"
  if [ "$CI_V" = "ok" ] && [ "$OV_V" = "ok" ] && [ "$RV_V" = "ok" ] && [ "$SR_V" = "ok" ]; then
    if [ "$JSON_MODE" = "1" ]; then
      emit_json "can" 0
    else
      say "MERGE-COND: can ①=ok ②=ok${OV_SHARED_SUFFIX} ③=${tok3} ④=ok"
      say "CAN-自合并"
    fi
    exit 0
  fi
  [ "$CI_V" = "ok" ] || names="${names}① CI 全绿 pending=0, "
  [ "$OV_V" = "ok" ] || names="${names}② 零写集重叠, "
  [ "$RV_V" = "ok" ] || names="${names}③ 已过独立复核, "
  [ "$SR_V" = "ok" ] || names="${names}④ 串行, "
  names="${names%, }"
  if [ "$JSON_MODE" = "1" ]; then
    emit_json "no" 1
  else
    say "MERGE-COND: no ①=${CI_V} ②=${OV_V}${OV_SHARED_SUFFIX} ③=${tok3} ④=${SR_V}"
    say "NO: ${names}"
  fi
  exit 1
}

# ─── ⑦ --selfcheck（判别力自检 · 13 判定点） ───────────────────────────────────
_mkc() { # _mkc <repo> <msg> <author-email>
  GIT_AUTHOR_NAME="agent" GIT_AUTHOR_EMAIL="$3" GIT_COMMITTER_NAME="agent" GIT_COMMITTER_EMAIL="$3" \
    git -C "$1" commit -q -m "$2"
}

_repo_fp() { _fp_compute "$1" "$2" "$3"; }   # 自检侧：与生产同一实现（杜绝口径漂移）

_write_receipt() { # _write_receipt <repo> <pr> <fp> <fp-for-path> <independence> <author-email> [schema-verdict]
  local R="$1" pr="$2" fp="$3" fpp="$4" indep="$5" email="$6"
  local d="$R/docs/synova/reviews"
  mkdir -p "$d"
  python3 - "$d/$pr.$fpp.json" "$pr" "$fp" "$indep" <<'PY'
import datetime, json, sys
path, pr, fp, indep = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
checks = [
    {"id": "铁律47 契约", "cmd": "head -40 f | grep -E '@input|@output'", "result": "pass", "evidence": "四块齐"},
    {"id": "铁律48 非空壳测试", "cmd": "grep -c 'inner_exit=' t.sh", "result": "pass", "evidence": "13 判定点"},
    {"id": "铁律38 as any", "cmd": "grep -rn 'as any' <变更文件>", "result": "pass", "evidence": "0 命中"},
    {"id": "铁律11 静默降级", "cmd": "grep -n 'degraded:' x.sh", "result": "pass", "evidence": "stderr 一行 + exit 2"},
    {"id": "三态退出码", "cmd": "bash x.sh --selfcheck; echo $?", "result": "pass", "evidence": "13/13"},
]
doc = {
    "schema": "syno-review-receipt/v1",
    "pr": pr,
    "patch_fingerprint": "sha256:" + fp,
    "author": "enc-w1",
    "reviewer": "verifier-v1",
    "independence": indep,
    "verdict": "PASS",
    "checks": checks,
    "findings": [],
    "issued_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
    "tool": "pr-review@v1（.dsh/skills/pr-review/SKILL.md 五步）",
}
json.dump(doc, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  git -C "$R" add "docs/synova/reviews" >/dev/null 2>&1
  _mkc "$R" "review-receipt(${pr})" "$email"
}

_fixture_write() { # _fixture_write <out> <tip> <ahead> <bhead> <chead> <dhead> <ehead> <case>
  python3 - "$@" <<'PY'
import json, sys
out, tip, ahead, bhead, chead, dhead, ehead, case = sys.argv[1:9]
ok = {"state": "success", "total_count": 2, "statuses": [
    {"context": "local-gates / gates (push)", "status": "success"},
    {"context": "local-gates / gates (pull_request)", "status": "success"}]}
pending = {"state": "pending", "total_count": 2, "statuses": [
    {"context": "local-gates / gates (push)", "status": "success"},
    {"context": "local-gates / gates (pull_request)", "status": "pending"}]}
void = {"state": "pending", "total_count": 0, "statuses": None}
ci = {ahead: ok, ehead: ok}
api_errors = {}
if case == "B":
    ci[ahead] = pending
if case == "F":
    ci[ahead] = void
if case == "I":
    api_errors = {"open_prs": 500}
r100 = {"path": "docs/synova/reviews/100.<fp12>.json", "in_tree": True,
        "independence": "fresh-session", "fingerprint": "correct"}
r99 = {"in_tree": False}
if case == "D1":
    r100["in_tree"] = False
if case == "D2":
    r100["fingerprint"] = "wrong"
if case == "D4":
    r100["independence"] = "same-session"
if case == "G":
    r99 = {"in_tree": True, "independence": "fresh-session", "fingerprint": "correct"}
fx = {
    "tip": tip,
    "author": "synova",
    "pr": {"number": 100, "head": ahead, "branch": "A"},
    "open_prs": [
        {"number": 101, "head": bhead, "branch": "B"},
        {"number": 102, "head": chead, "branch": "C"},
        {"number": 98, "head": dhead, "branch": "D"},
        {"number": 99, "head": ehead, "branch": "E"},
    ],
    "ci": ci,
    "receipt_by_pr": {"100": r100, "99": r99},
    "receipt_commit_after_code": (case != "D3"),
    "api_errors": api_errors,
}
json.dump(fx, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
}

build_fixture_repo() { # build_fixture_repo <case> <dir> → 重建夹具（规格 §4.3.0 铁约束 ②：子例间重建）
  local case="$1" dir="$2" R
  R="$dir/repo"
  rm -rf "$dir"
  mkdir -p "$dir"
  if ! git init -q "$R"; then return 1; fi
  git -C "$R" config user.email "agent@synova.local"
  git -C "$R" config user.name "agent"
  git -C "$R" config commit.gpgsign false
  if ! git -C "$R" checkout -q -b local-main 2>/dev/null; then return 1; fi   # swallow-ok: 临时仓自建，失败已 return 1
  # 基线：local-main T1 → T2（T2 = 当前 tip）
  printf 'base1\n' > "$R/base.ts"
  git -C "$R" add base.ts
  _mkc "$R" "T1" "agent@synova.local" || return 1
  local T1 T2 A_code B_head C_head D_head E_code
  T1="$(git -C "$R" rev-parse HEAD)"
  printf 'base2\n' > "$R/base.ts"
  git -C "$R" add base.ts
  _mkc "$R" "T2" "agent@synova.local" || return 1
  T2="$(git -C "$R" rev-parse HEAD)"
  # 分支 A（本 PR 100）：基于 T2 改 a.ts
  git -C "$R" checkout -q -b A "$T2" || return 1
  if [ "$case" = "J" ]; then
    mkdir -p "$R/docs/authority"
    printf 'a\n' > "$R/docs/authority/DOCS-REGISTRY.yaml"
    git -C "$R" add docs/authority/DOCS-REGISTRY.yaml
  else
    printf 'a\n' > "$R/a.ts"
    git -C "$R" add a.ts
  fi
  _mkc "$R" "A_code" "agent@synova.local" || return 1
  A_code="$(git -C "$R" rev-parse HEAD)"
  # 分支 B（101）/ C（102）/ D（98，基于 T1）/ E（99）
  git -C "$R" checkout -q -b B "$T2" || return 1
  printf 'b\n' > "$R/b.ts"
  git -C "$R" add b.ts
  _mkc "$R" "B_code" "agent@synova.local" || return 1
  B_head="$(git -C "$R" rev-parse HEAD)"
  git -C "$R" checkout -q -b Cb "$T2" || return 1
  printf 'c\n' > "$R/c.ts"
  git -C "$R" add c.ts
  _mkc "$R" "C_code" "agent@synova.local" || return 1
  C_head="$(git -C "$R" rev-parse HEAD)"
  git -C "$R" checkout -q -b D "$T1" || return 1
  printf 'd\n' > "$R/d.ts"
  git -C "$R" add d.ts
  _mkc "$R" "D_code" "agent@synova.local" || return 1
  D_head="$(git -C "$R" rev-parse HEAD)"
  git -C "$R" checkout -q -b E "$T2" || return 1
  printf 'e\n' > "$R/e.ts"
  git -C "$R" add e.ts
  _mkc "$R" "E_code" "agent@synova.local" || return 1
  E_code="$(git -C "$R" rev-parse HEAD)"
  # 本 PR 的回执（attested 单轨：回执是本分支最后一个提交）
  local fp fp12 wrong A_head
  git -C "$R" checkout -q A || return 1
  fp="$(_repo_fp "$R" "$T2" "$A_code")" || return 1
  fp12="${fp:0:12}"
  case "$case" in
    D1)
      : # 缺回执：不写文件
      ;;
    D2)
      wrong="$fp"
      case "$fp" in
        a*) wrong="b${fp#a}" ;;
        *)  wrong="a${fp#?}" ;;
      esac
      _write_receipt "$R" 100 "$wrong" "$fp12" "fresh-session" "reviewer@synova.local" || return 1
      ;;
    D4)
      _write_receipt "$R" 100 "$fp" "$fp12" "same-session" "reviewer@synova.local" || return 1
      ;;
    H)
      _write_receipt "$R" 100 "$fp" "$fp12" "fresh-session" "agent@synova.local" || return 1
      ;;
    *)
      _write_receipt "$R" 100 "$fp" "$fp12" "fresh-session" "reviewer@synova.local" || return 1
      ;;
  esac
  A_head="$(git -C "$R" rev-parse HEAD)"
  # D3：回执之后仍有代码改动（R7）
  if [ "$case" = "D3" ]; then
    printf 'a2\n' >> "$R/a.ts"
    git -C "$R" add a.ts
    _mkc "$R" "A_code2" "agent@synova.local" || return 1
    A_head="$(git -C "$R" rev-parse HEAD)"
  fi
  # C（自检子例）：把 101 的 head 换成「改 a.ts」的新分支 ⇒ 与 A 撞 a.ts
  if [ "$case" = "C" ]; then
    git -C "$R" checkout -q -b B2 "$T2" || return 1
    printf 'a-conflict\n' > "$R/a.ts"
    git -C "$R" add a.ts
    _mkc "$R" "B2_code" "agent@synova.local" || return 1
    B_head="$(git -C "$R" rev-parse HEAD)"
  fi
  if [ "$case" = "J" ]; then
    git -C "$R" checkout -q -b B2 "$T2" || return 1
    mkdir -p "$R/docs/authority"
    printf 'b-registry\n' > "$R/docs/authority/DOCS-REGISTRY.yaml"
    git -C "$R" add docs/authority/DOCS-REGISTRY.yaml
    _mkc "$R" "B2_reg" "agent@synova.local" || return 1
    B_head="$(git -C "$R" rev-parse HEAD)"
  fi
  # G：给 99 号置回执 ⇒ 它进就绪集且编号更小
  local E_head="$E_code"
  if [ "$case" = "G" ]; then
    local fp99 fp99_12
    git -C "$R" checkout -q E || return 1
    fp99="$(_repo_fp "$R" "$T2" "$E_code")" || return 1
    fp99_12="${fp99:0:12}"
    _write_receipt "$R" 99 "$fp99" "$fp99_12" "fresh-session" "reviewer@synova.local" || return 1
    E_head="$(git -C "$R" rev-parse HEAD)"
  fi
  # E（自检子例）：tip 前移到 T3（A 不含 T3 ⇒ S1 红，落后 1 commit）
  local tip="$T2"
  if [ "$case" = "E" ]; then
    git -C "$R" checkout -q local-main || return 1
    printf 't3\n' > "$R/t3.ts"
    git -C "$R" add t3.ts
    _mkc "$R" "T3" "agent@synova.local" || return 1
    tip="$(git -C "$R" rev-parse HEAD)"
  fi
  _fixture_write "$dir/fixture.json" "$tip" "$A_head" "$B_head" "$C_head" "$D_head" "$E_head" "$case" || return 1
  return 0
}

case_desc() {
  case "$1" in
    A) printf '全绿基线（PR#100 四条件全绿）' ;;
    B) printf '① 红（statuses 含 pending）' ;;
    C) printf '② 红（101 撞 a.ts）' ;;
    D1) printf '③ 缺回执（in_tree=false）' ;;
    D2) printf '③ 指纹不匹配（改 1 hex）' ;;
    D3) printf '③ 时序（回执之后又改码）' ;;
    D4) printf '③ 字段不合规（independence=same-session）' ;;
    E) printf '④ S1 红（tip 前移到 T3）' ;;
    F) printf '① 看不见（total_count=0）' ;;
    G) printf '④ S2 红（99 号更小且就绪）' ;;
    H) printf '身份未分离（仍绿 ＋ warn）' ;;
    I) printf '② fail-closed（open PR 列表 500）' ;;
    J) printf '② 共享追加白名单（登记表重叠不计，仍 CAN）' ;;
    *) printf '%s' "$1" ;;
  esac
}

run_case() { # run_case <case> <want-exit> <want-last-line> [needle...]
  local case="$1" want_exit="$2" want_last="$3"
  shift 3
  local dir repo out err inner last machine
  dir="$WORK/sc/$case"
  repo="$dir/repo"
  out="$dir/out.txt"
  err="$dir/err.txt"
  if ! build_fixture_repo "$case" "$dir"; then
    printf 'SELFCHECK-FAIL: %s（夹具构建失败）\n' "$case"
    return 1
  fi
  SYNO_MERGE_COND_FIXTURE="$dir/fixture.json" \
  SYNO_GATE_DEGRADED_LOG="$dir/degraded.log" \
    bash "$SELF" --pr 100 --repo-root "$repo" --base local-main > "$out" 2> "$err"
  inner=$?
  last="$(tail -n 1 "$out")"
  machine="$(grep -m1 '^MERGE-COND:' "$out")"
  printf '[selfcheck] %s %s … inner_exit=%s verdict=%s machine=%s\n' \
    "$case" "$(case_desc "$case")" "$inner" "${last:-<空>}" "${machine:-<无>}"
  # 原始证据（失败点 / 降级 / 告警），禁截断
  if [ -s "$err" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] && printf '[selfcheck]   · stderr: %s\n' "$line"
    done < "$err"
  fi
  local bad=""
  if [ "$inner" != "$want_exit" ]; then
    bad="inner_exit=${inner}（期望 ${want_exit}）"
  elif [ "$last" != "$want_last" ]; then
    bad="末行=${last:-<空>}（期望 ${want_last}）"
  else
    while [ $# -gt 0 ]; do
      if ! grep -Fq -- "$1" "$out" "$err"; then
        bad="缺证据片段「$1」"
        break
      fi
      shift
    done
  fi
  if [ -z "$bad" ] && [ "$case" = "I" ]; then
    if grep -Fq -- "CAN-自合并" "$out" || grep -Fq -- "②=ok" "$out"; then
      bad="降级时不得输出 CAN-自合并 / ②=ok"
    fi
  fi
  # 🔴 #603 输出级反例（裁 B3-1 硬条件）：任何 MERGE-COND 行出现**裸** ③=ok（无 attested 级别）⇒ 失败
  #    根因：机器行 ③ 由 tok3 运行时拼接 ⇒ 只钉 needle 抓不住「改坏 tok3」；本断言直接看**输出**。
  # 🔴 #603/#605 白名单式：**计数法，禁走管道**。
  #   管道法 `grep … | grep -Evq …` 在 `set -uo pipefail` 下：下游 -q 命中即退 ⇒ 上游收 SIGPIPE(141)
  #   ⇒ 管道判非零 ⇒ 把"有非法行"误判成"没问题"（实测 200k 行假级别 MISSED）。
  #   ＋**存在性**：非降级机行里没有 `③=` 也非法（"看不见 ≠ 没问题"；删掉机器行 ③ 段曾仍 12/12 绿）。
  #   降级机行 `MERGE-COND: degraded`（①/② 阶段即 exit 2）合法地没有 ③= ⇒ **豁免**。
  #   ⚠️ 已知限制：计数**按行**——同一行兼有合法与非法 `③=` 会判过（旧形同样放过；如需更严改 grep -o 口径）。
  if [ -z "$bad" ]; then
    local n3=0 ok3=0 mline=""
    if mline="$(grep -m1 '^MERGE-COND:' "$out")"; then :; else mline=""; fi
    case "$mline" in
      "") bad="缺 MERGE-COND 机器行（非降级路径必须有机行）" ;;
      *degraded*) : ;;   # 降级路径豁免
      *)
        if n3="$(grep -Ec '③=' "$out")"; then :; else n3=0; fi
        if [ "$n3" -eq 0 ]; then
          bad="机器行缺 ③= 字段（信号量==0：看不见≠没问题）"
        else
          if ok3="$(grep -Ec '③=(ok\(attested\)|no)([[:space:]]|$)' "$out")"; then :; else ok3=0; fi
          if [ "$n3" -ne "$ok3" ]; then
            bad="机器行 ③ 形态非法（$((n3-ok3)) 行 / 共 ${n3} 行；只允许 ok(attested) / no）"
          fi
        fi
        ;;
    esac
  fi
  if [ -z "$bad" ] && [ -s "$out" ]; then
    # 打印该子例的红点/告警行作为原始输出证据（非 head 截断：全量）
    while IFS= read -r line; do
      case "$line" in
        *"✗"*|*"warn:"*|*"degraded:"*) printf '[selfcheck]   · %s\n' "$line" ;;
      esac
    done < "$out"
  fi
  if [ -n "$bad" ]; then
    printf '[selfcheck]   ✗ 断言失败: %s\n' "$bad"
    return 1
  fi
  return 0
}

selfcheck() {
  mkdir -p "$WORK/sc"
  local total=0 passed=0 f
  for f in A B C D1 D2 D3 D4 E F G H I J; do
    total=$((total + 1))
    case "$f" in
      A) run_case A 0 "CAN-自合并" "③=ok(attested)" "①=ok" "④=ok" ;;
      B) run_case B 1 "NO: ① CI 全绿 pending=0" "local-gates / gates (pull_request)=pending" ;;
      C) run_case C 1 "NO: ② 零写集重叠" "a.ts → PR#100,#101" ;;
      D1) run_case D1 1 "NO: ③ 已过独立复核" "R1 缺回执" ;;
      D2) run_case D2 1 "NO: ③ 已过独立复核" "R3 指纹不匹配" ;;
      D3) run_case D3 1 "NO: ③ 已过独立复核" "R7 回执之后仍有代码改动" ;;
      D4) run_case D4 1 "NO: ③ 已过独立复核" "R2 independence 必须为 fresh-session" ;;
      E) run_case E 1 "NO: ④ 串行" "S1 tip" "落后 1 commits" ;;
      F) run_case F 2 "degraded: CI 信号量==0（state=pending total_count=0；禁判绿也禁判红）" "degraded:" ;;
      G) run_case G 1 "NO: ④ 串行" "S2 前置就绪 PR #99 编号更小 ⇒ 先合它" ;;
      H) run_case H 0 "CAN-自合并" "warn: 身份未分离" ;;
      I) run_case I 2 "degraded: open PR 列表不可达（HTTP 500 on /pulls?state=open，fail-closed）" "degraded:" ;;
      J) run_case J 0 "CAN-自合并" "②=ok" "共享追加" ;;
    esac
    if [ $? -eq 0 ]; then
      passed=$((passed + 1))
    else
      printf 'SELFCHECK-FAIL: %s\n' "$f"
      return 2
    fi
  done
  if [ "$passed" -ne "$total" ]; then
    printf 'SELFCHECK-FAIL: 通过 %s/%s\n' "$passed" "$total"
    return 2
  fi
  printf 'SELFCHECK-OK: %s/%s\n' "$passed" "$total"
  return 0
}

main "$@"
