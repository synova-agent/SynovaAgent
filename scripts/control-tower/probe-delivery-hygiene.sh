#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# probe-delivery-hygiene.sh — 交付面卫生探针（卡 #1466 · BC-CLEAN · 院方《边界C》§3.4 BC-3/4/7/8）
#
# 登记件: docs/synova/coordination/施工项登记.ts :: BC-CLEAN
#         acceptance: { run: 'bash scripts/control-tower/probe-delivery-hygiene.sh', expectExit: 0 }
#
# ── 契约（铁律 47）────────────────────────────────────────────────────────────
#   @input   --ref <git-ref>        判据源 ref（默认 origin/main；判例 R66/S-01：显式 ref，
#                                   禁用工作树 `cat` 当真相源）
#            --repo <path>          判据对象仓库（默认 = 本脚本所在仓库；V-08 夹具注入缝）
#            --dockerignore <path>  覆盖 .dockerignore 载体路径（默认从 <ref> 取；
#                                   该注入点 = V-08「改坏即红」反例的构造入口）
#            --json                 结构化输出
#   @output  V1 / V2 / V3 逐条 PASS/FAIL 明细行 + 证据行
#   @exit     0 = 三条全过
#             1 = 有判据违规（附违规清单 + 修复指引）
#             2 = 检查自身失败（git 不可用 / ref 不可解析 / .dockerignore 用了本探针
#                 未实现的语义子集）—— 判例 M-02 三态：检查自身失败同样阻断，禁 `|| true` 吞
#   @degraded docker 二进制不可用 → V2 以 .dockerignore 语义模拟器计算客户构建上下文，
#             输出显式标 `[simulated]`；**不静默当成真 build**（铁律 11 + 判例 V-09）
#
# ── 三判据 ───────────────────────────────────────────────────────────────────
#   V1 交付面无日期快照 / 0 字节空件 / 占位符桩件
#      V1-a app/**      无文件名含日期戳（YYYY-MM-DD 或 YYYYMMDD）
#      V1-b app/**      无 0 字节件
#      V1-c app/**      无占位符二进制（图像扩展名且 < 64 字节 —— 不可能合法）
#      V1-d src/**+tests/**  无 0 字节件（白名单 __init__.py / .gitkeep 除外）
#   V2 客户构建产物零 control-tower —— **口径**：零【非 src/ 依赖闭包】件
#      🌐 BC-7 原文「control-tower 面引入 Python 依赖**且非客户功能**」⇒ 判据语义 =
#         交付面不得含【非客户功能】件；凡被 src/ 运行期引用者按定义即客户功能承重件。
#      判据 = 客户构建上下文幸存集合 **双向等于** src/ 闭包：
#        方向①安全：闭包 ⊆ 幸存（少一件 ⇒ 客户镜像启动/降级路径断 ⇒ FAIL）
#        方向②剥离：幸存 ⊆ 闭包（多一件 ⇒ 非客户功能污染交付面 ⇒ FAIL）
#   V3 全仓无 .synova-wt-*（仓库面 + CI 面；本机 live worktree 数只作 info 不判红 ——
#      那是各在飞线的活动工作区，删一个即事故，见卡 #1466 §红线）
#
# ── 为什么 V2 不是「零 control-tower 目录」────────────────────────────────────
#   src/ 对 scripts/control-tower/ 存在 **load-bearing 引用**（实测见 --explain）：
#     src/l4/agent-memory-store.ts:20      静态 value import → enterprise-fact-store.ts
#     src/deploy/bootstrap.ts:1125         await import  → conflict-scanner.ts
#     src/agent/{proactive-push,synova-agent,department-memory-store}.ts → python3 emit-signal.py
#     src/routes/cockpit.ts:27             → python3 generate-dashboard.py（→ views/*.py + founder-truth.py）
#   ⇒ 整目录剥离必须改 src/（写集外 + 架构变更）⇒ 本探针按 BC-7 原文口径判【非客户功能件=0】，
#     并把「整目录归零」的差额显式列在 --explain（判例 V-09：不可达项必须显式列出，不许写成已核）。
#
# 用法:
#   bash scripts/control-tower/probe-delivery-hygiene.sh
#   bash scripts/control-tower/probe-delivery-hygiene.sh --ref HEAD --json
#   bash scripts/control-tower/probe-delivery-hygiene.sh --dockerignore /tmp/broken.dockerignore   # V-08 反例
#   bash scripts/control-tower/probe-delivery-hygiene.sh --explain
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT_OVERRIDE=""      # --repo <path>：判据对象仓库（测试夹具注入缝；默认 = 本脚本所在仓库）
REF="origin/main"
JSON_OUT=0
DI_OVERRIDE=""
EXPLAIN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)          REF="${2:-}"; shift 2 ;;
    --repo)         ROOT_OVERRIDE="${2:-}"; shift 2 ;;
    --dockerignore) DI_OVERRIDE="${2:-}"; shift 2 ;;
    --json)         JSON_OUT=1; shift ;;
    --explain)      EXPLAIN=1; shift ;;
    -h|--help)      sed -n '2,70p' "$0"; exit 0 ;;
    *) echo "probe-delivery-hygiene: 未知参数 $1" >&2; exit 2 ;;
  esac
done

# --repo 覆盖（夹具注入缝）：CLI 解析在 ROOT 初值之后，故在此应用
if [ -n "$ROOT_OVERRIDE" ]; then
  if [ ! -d "$ROOT_OVERRIDE" ]; then
    echo "❌ 探针自身失败(2): --repo 目录不存在 —— $ROOT_OVERRIDE" >&2
    exit 2
  fi
  ROOT="$(cd "$ROOT_OVERRIDE" && pwd)"
fi

# ── 判例 M-02: 检查自身失败 = exit 2（不许静默降级）──
if ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ 探针自身失败(2): git 不可用（$ROOT）" >&2
  exit 2
fi
if ! git -C "$ROOT" rev-parse --verify --quiet "${REF}^{commit}" >/dev/null 2>&1; then
  echo "❌ 探针自身失败(2): ref 不可解析 —— ref=$REF" >&2
  exit 2
fi
REF_SHA="$(git -C "$ROOT" rev-parse "${REF}^{commit}")"

DOCKER_BIN="$(command -v docker 2>/dev/null || true)"
SIM_NOTE="[simulated]"
[ -n "$DOCKER_BIN" ] && SIM_NOTE="[docker-present-but-context-still-simulated]"

# ─────────────────────────────────────────────────────────────────────────────
# V1 / V2 / V3 计算 + 判定，全部在 python3 内完成（输出 = 机器可读行）
# ─────────────────────────────────────────────────────────────────────────────
OUT="$(
python3 - "$ROOT" "$REF" "$DI_OVERRIDE" "$SIM_NOTE" <<'PY'
import json, os, re, subprocess, sys
from fnmatch import fnmatchcase

root, ref, di_override, sim_note = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

def git(*args, check=True, ok_rc=(0,)):
    """ok_rc: 可接受退出码（git grep 零命中 = rc 1，属正常"零结果"；其余非 0 = 检查自身失败 —— M-02）"""
    r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    if check and r.returncode not in ok_rc:
        print(f"__SELFFAIL__ git {' '.join(args)} -> rc={r.returncode}: {r.stderr.strip()}")
        sys.exit(2)
    return r.stdout

def show(path):
    return git("show", f"{ref}:{path}")

def ls_tree(path=""):
    """→ [(mode, type, size, path)]"""
    out = git("ls-tree", "-r", "-l", ref, *( [path] if path else [] ))
    rows = []
    for line in out.splitlines():
        if not line.strip():
            continue
        meta, p = line.split("\t", 1)
        parts = meta.split()
        rows.append((parts[0], parts[1], int(parts[3]), p))
    return rows

def ls_tree_dirs(path=""):
    out = git("ls-tree", "-r", "-t", "--name-only", ref, *( [path] if path else [] ))
    return [l for l in out.splitlines() if l.strip()]

viol = {"V1": [], "V2": [], "V3": []}
info = []

# ═══════════════════════════════════════════ V1 ═══════════════════════════════
APP = [r for r in ls_tree("app/")]
DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2}|\d{8})")
IMG_EXT = (".ico", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")
for mode, typ, size, p in APP:
    base = p.rsplit("/", 1)[-1]
    if DATE_RE.search(base):
        viol["V1"].append(f"V1-a 日期快照仍在交付目录: {p}")
    if size == 0:
        viol["V1"].append(f"V1-b 0 字节空件: {p}")
    if p.lower().endswith(IMG_EXT) and size < 64:
        viol["V1"].append(f"V1-c 占位符桩二进制({size}B，不可能是合法图像): {p}")

EMPTY_ALLOW = ("__init__.py", ".gitkeep")
for scope in ("src/", "tests/"):
    for mode, typ, size, p in ls_tree(scope):
        if size != 0:
            continue
        if p.rsplit("/", 1)[-1] in EMPTY_ALLOW:
            continue
        viol["V1"].append(f"V1-d 0 字节空源码/测试件: {p}")

# ═══════════════════════════════════════════ V2 ═══════════════════════════════
CT = "scripts/control-tower/"
all_ct = [p for _, _, _, p in ls_tree(CT)]
ct_dirs = [p + "/" for p in ls_tree_dirs(CT) if p.startswith(CT) and git("ls-tree", "-d", ref, p).strip()]

# ── 2a. src/ 闭包：直接引用（剔注释行）──
raw = git("grep", "-nE", r"scripts/control-tower/[A-Za-z0-9_./-]+", ref, "--", "src/", ok_rc=(0, 1))
direct = set()
for line in raw.splitlines():
    if not line.strip():
        continue
    p, ln, code = line.split(":", 2)
    if code.lstrip().startswith(("//", "*", "/*")):
        continue
    for m in re.finditer(r"scripts/control-tower/([A-Za-z0-9_./-]+)", code):
        # 尾注释剔除：命中点之前若已出现 `//`，则该命中在注释里，不是引用
        if "//" in code[:m.start()]:
            continue
        direct.add(m.group(1))

def resolve(name):
    """裸模块名 → 仓库内真实路径（TS 优先；无扩展名按 .ts 补）"""
    for cand in (CT + name, CT + name + ".ts", CT + name + ".py"):
        if cand in all_ct:
            return cand
    return None

closure = set()
py_roots = []
for d in sorted(direct):
    if d.endswith(".py"):
        r = resolve(d)
        if r:
            py_roots.append(r)
    else:
        r = resolve(d.rstrip("/"))
        if r:
            closure.add(r)

# ── 2b. python 传递闭包（同一子树内的 sibling import + 字符串 "x.py" 引用 + views 整包）──
py_all = [p for p in all_ct if p.endswith(".py")]
name2path = {}
for p in py_all:
    b = p.rsplit("/", 1)[-1]
    if b == "__init__.py":
        name2path[p.rsplit("/", 1)[0].rsplit("/", 1)[-1]] = p.rsplit("/", 1)[0] + "/"
    else:
        name2path[b[:-3]] = p

def py_edges(p):
    try:
        s = show(p)
    except SystemExit:
        raise
    out = set()
    for m in re.finditer(r"^\s*from\s+([A-Za-z_][A-Za-z0-9_]*)", s, re.M):
        n = m.group(1)
        if n in name2path:
            out.add(name2path[n])
    for m in re.finditer(r"^\s*import\s+([A-Za-z_][A-Za-z0-9_]*)", s, re.M):
        n = m.group(1)
        if n in name2path:
            out.add(name2path[n])
    for m in re.finditer(r'"([A-Za-z0-9_.-]+)\.py"', s):
        n = m.group(1)
        if n in name2path:
            out.add(name2path[n])
    if re.search(r"\bfrom\s+views\b|\bimport\s+views\b", s):
        out.add(CT + "views/")
    return out

seen, stack = set(), list(py_roots)
while stack:
    cur = stack.pop()
    if cur in seen:
        continue
    seen.add(cur)
    if cur.endswith("/"):
        for p in py_all:
            if p.startswith(cur) and p not in seen:
                stack.append(p)
    else:
        closure.add(cur)
        for t in py_edges(cur):
            if t not in seen:
                stack.append(t)
# python 闭包结果落回 closure（含 views/ 目录下的件）
for p in seen:
    if not p.endswith("/"):
        closure.add(p)
CLOSURE_DIRS = {CT + "views/"} if any(p.startswith(CT + "views/") for p in closure) else set()

# ── 2c. .dockerignore 语义模拟（子集：* ! ** ? 尾斜杠目录 无斜杠按 basename 末次匹配胜）──
di_path = di_override or ".dockerignore"
if di_override:
    if not os.path.isfile(di_override):
        print(f"__SELFFAIL__ --dockerignore 不存在: {di_override}")
        sys.exit(2)
    di_text = open(di_override, encoding="utf-8").read()
else:
    di_text = show(".dockerignore")

unsupported = []
patterns = []   # (negate, dir_only, pat)
for line in di_text.splitlines():
    s = line.strip()
    if not s or s.startswith("#"):
        continue
    if "\\" in s or "[" in s or "]" in s:
        unsupported.append(s)
        continue
    neg = s.startswith("!")
    if neg:
        s = s[1:]
    dir_only = s.endswith("/")
    s = s.rstrip("/")
    if not s:
        continue
    patterns.append((neg, dir_only, s))

if unsupported:
    print("__SELFFAIL__ .dockerignore 使用了探针未实现的语义（转义/字符类）: "
          + ", ".join(unsupported))
    sys.exit(2)

def rx(pat):
    out, i = "", 0
    while i < len(pat):
        c = pat[i]
        if c == "*":
            if pat[i:i+2] == "**":
                out += ".*"; i += 2; continue
            out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        else:
            out += re.escape(c)
        i += 1
    return re.compile("^" + out + "$")

COMP = [(neg, dir_only, rx(p), p) for (neg, dir_only, p) in patterns]

def last_match(path, is_dir):
    """→ (matched, negate, pattern)。末次匹配胜：matched=True 且 negate=True ⇒ 反选=保留；
    matched=True 且 negate=False ⇒ 排除；matched=False ⇒ 保留（docker 默认全收）"""
    res = (False, False, None)
    for neg, dir_only, r, raw in COMP:
        if dir_only and not is_dir:
            continue
        hay = path if "/" in raw else path.rsplit("/", 1)[-1]
        if r.match(hay):
            res = (True, neg, raw)
    return res

# 目录剪枝遍历（moby patternmatcher 行为：目录被排除且未被反选 ⇒ 不下探）
entries = sorted(set([p for p in all_ct]) | set(d for d in ct_dirs))
survivors = set()

def walk(prefix):
    """prefix 形如 'scripts/control-tower/'（已确认可下探）"""
    direct_children = sorted({(p[len(prefix):].split("/")[0], ("/" in p[len(prefix):])) for p in entries if p.startswith(prefix) and p != prefix})
    for name, is_deep in direct_children:
        full = prefix + name
        is_dir = is_deep
        matched, neg, _pat = last_match(full, is_dir)
        excluded = matched and not neg
        if excluded:
            # 目录被排除且未被反选 ⇒ 剪枝，不下探（moby patternmatcher 行为）
            continue
        if is_dir:
            # 目录保留：下探时逐件重判（其子件可能有自己的匹配）
            walk(full + "/")
        else:
            survivors.add(full)

walk(CT)
ct_survivors = sorted(survivors)
ct_closure = sorted(closure)

missing = [p for p in ct_closure if p not in survivors]
extra = [p for p in ct_survivors if p not in ct_closure]
for p in missing:
    viol["V2"].append(f"V2-①闭包件被排除（客户镜像缺件）: {p}")
for p in extra:
    viol["V2"].append(f"V2-②非闭包件仍在交付面: {p}")

# 等价性边界披露（不判红）：哪些闭包件依赖「反选目录 ⇒ 可下探」语义、哪些是文件级直保
CT_DESCENT = [p for p in ct_closure
              if last_match(p, False)[0] and last_match(p, False)[1]
              and not any(raw == p for _n, _d, _r, raw in COMP)]
INFO_DESCENT = CT_DESCENT

# ═══════════════════════════════════════════ V3 ═══════════════════════════════
tracked = [p for p in git("ls-tree", "-r", "--name-only", ref).splitlines() if ".synova-wt-" in p]
for p in tracked:
    viol["V3"].append(f"V3-a 仓库内被追踪的 .synova-wt-*: {p}")

gi = show(".gitignore")
gi_lines = gi.splitlines()
# 行为化判定（非 grep）：把 ignore 规则喂给 `git check-ignore --no-index`（V-02：禁 grep 作验收）
probe_names = [".synova-wt-__probe__", ".synova-wt-1466", ".synova-wt-abc/keep.txt"]
tmp = subprocess.run(
    ["git", "-C", root, "-c", "core.excludesFile=/dev/null", "check-ignore", "--no-index", "-q", "--stdin"],
    input="\n".join(probe_names), capture_output=True, text=True,
)
# --stdin + -q 的 rc 语义：0=至少一条被忽略；1=全部未被忽略；>1=自身失败
if tmp.returncode not in (0, 1):
    print(f"__SELFFAIL__ git check-ignore rc={tmp.returncode}: {tmp.stderr.strip()}")
    sys.exit(2)
res = subprocess.run(
    ["git", "-C", root, "-c", "core.excludesFile=/dev/null", "check-ignore", "--no-index", "--stdin", "-v"],
    input="\n".join(probe_names), capture_output=True, text=True,
)
ignored = {l.split("\t")[-1] for l in res.stdout.splitlines() if "\t" in l}
for n in probe_names:
    if n not in ignored:
        viol["V3"].append(f"V3-b .gitignore 未覆盖工作树残留名（行为化 check-ignore 实测）: {n}")

ci_hits = git("grep", "-n", "synova-wt", ref, "--", ".github/", ok_rc=(0, 1)).strip()
if ci_hits:
    for line in ci_hits.splitlines():
        viol["V3"].append(f"V3-c CI 面引用 .synova-wt（可能被提交/缓存）: {line}")

# 本地 live worktree 数（info，不判红 —— 各在飞线的活动工作区）
live = subprocess.run(["git", "-C", root, "worktree", "list"], capture_output=True, text=True).stdout.splitlines()
info.append(f"V2 等价性边界：{len(INFO_DESCENT)} 件闭包依赖「反选目录 ⇒ 可下探」语义"
            f"（{'、'.join(sorted(INFO_DESCENT)) or '无'}）；其余为直接子件按文件级反选，不依赖下探")
info.append(f"本地 live worktree 总数(含 main) = {len(live)}；其中 .synova-wt-* 命名 = "
            f"{sum(1 for l in live if '.synova-wt-' in l)}  ← info only，非判据（删他线工作区=事故）")

# ═══════════════════════════════════════ 输出 ═══════════════════════════════
print("__DATA__" + json.dumps({
    "ref": ref,
    "descriptor": git("rev-parse", ref).strip(),
    "sim_note": sim_note,
    "v1": {"app_files": len(APP), "violations": viol["V1"]},
    "v2": {
        "direct_src_refs": sorted(direct),
        "closure": ct_closure,
        "closure_dirs": sorted(CLOSURE_DIRS),
        "ct_total": len(all_ct),
        "survivors": ct_survivors,
        "excluded_count": len(all_ct) - len(ct_survivors),
        "violations": viol["V2"],
    },
    "v3": {"violations": viol["V3"], "gitignore_lines": len(gi_lines)},
    "info": info,
}))
PY
)"
PY_RC=$?
if [ "$PY_RC" -ne 0 ]; then
  echo "$OUT" | grep '__SELFFAIL__' >&2 || true
  echo "❌ 探针自身失败(2): 计算阶段异常 rc=$PY_RC" >&2
  exit 2
fi
DATA="$(printf '%s\n' "$OUT" | grep '^__DATA__' | sed 's/^__DATA__//')"
if [ -z "$DATA" ]; then
  echo "❌ 探针自身失败(2): 无结构化输出" >&2
  exit 2
fi

RC=0
V1V=$(printf '%s' "$DATA" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["v1"]["violations"]))')
V2V=$(printf '%s' "$DATA" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["v2"]["violations"]))')
V3V=$(printf '%s' "$DATA" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["v3"]["violations"]))')
[ "$V1V" -eq 0 ] && [ "$V2V" -eq 0 ] && [ "$V3V" -eq 0 ] || RC=1

if [ "$JSON_OUT" -eq 1 ]; then
  printf '%s' "$DATA" | python3 -c 'import json,sys; d=json.load(sys.stdin); d["exit"]=int(sys.argv[1]); print(json.dumps(d, ensure_ascii=False, indent=1))' "$RC"
else
  REF_D="$(printf '%s' "$DATA" | python3 -c 'import json,sys; print(json.load(sys.stdin)["descriptor"])')"
  echo "═══ probe-delivery-hygiene ═══ ref=${REF} @ ${REF_D:0:9} ${SIM_NOTE}"
  echo
  if [ "$V1V" -eq 0 ]; then
    echo "V1 PASS  交付面无日期快照 / 0 字节空件 / 占位符桩件"
  else
    echo "V1 FAIL（$V1V 项）"
    printf '%s' "$DATA" | python3 -c 'import json,sys;[print("   -",x) for x in json.load(sys.stdin)["v1"]["violations"]]'
  fi
  printf '%s' "$DATA" | python3 -c '
import json,sys
d=json.load(sys.stdin)["v2"]
verdict = "PASS" if not d["violations"] else "FAIL"
print("V2 %s  客户构建上下文 control-tower 幸存集合 == src/ 依赖闭包（双向）" % verdict)
print("   控制塔文件总量 = %d｜排除 = %d｜幸存 = %d" % (d["ct_total"], d["excluded_count"], len(d["survivors"])))
print("   闭包（%d 件，机器推导自 src/ 引用 + python 传递）:" % len(d["closure"]))
for p in d["closure"]:
    print("     ·", p)
lim = 8
for x in d["violations"][:lim]:
    print("   -", x)
if len(d["violations"]) > lim:
    print("   … 其余 %d 项见 --json（总量 %d 项）" % (len(d["violations"]) - lim, len(d["violations"])))
'
  if [ "$V3V" -eq 0 ]; then
    echo "V3 PASS  全仓无 .synova-wt-*（tracked=0 + .gitignore 行为化 check-ignore 覆盖 + CI=0 引用）"
  else
    echo "V3 FAIL（$V3V 项）"
    printf '%s' "$DATA" | python3 -c 'import json,sys;[print("   -",x) for x in json.load(sys.stdin)["v3"]["violations"]]'
  fi
  echo
  printf '%s' "$DATA" | python3 -c 'import json,sys;[print("info:",x) for x in json.load(sys.stdin)["info"]]'
fi

if [ "$EXPLAIN" -eq 1 ]; then
  echo
  echo "── V2 口径与不可达差额（判例 V-09：显式列出，不许写成已核）──"
  echo "BC-7 原文「control-tower 面引入 Python 依赖且非客户功能」⇒ 判据语义 = 交付面零【非客户功能】件。"
  echo "「整目录归零」不可达，因 src/ 对 scripts/control-tower/ 有 load-bearing 引用："
  echo "  src/l4/agent-memory-store.ts:20      静态 value import → enterprise-fact-store.ts（静态 import 缺件 = 启动崩）"
  echo "  src/deploy/bootstrap.ts:1125         await import      → conflict-scanner.ts（缺件 = cron 降级，不崩）"
  echo "  src/agent/proactive-push.ts:192 / synova-agent.ts:106,127 / l4/department-memory-store.ts:216"
  echo "                                       python3 emit-signal.py"
  echo "  src/routes/cockpit.ts:27             python3 generate-dashboard.py（→ views/*.py + founder-truth.py）"
  echo "达成「整目录归零」需改 src/（写集外）⇒ 属架构变更，须 CTO 裁。"
fi

if [ "$RC" -eq 0 ]; then
  STATUS="PROBE-DELIVERY-HYGIENE: PASS (exit 0)"
else
  STATUS="PROBE-DELIVERY-HYGIENE: FAIL (exit 1)"
fi
# --json 模式: stdout 只放 JSON（机器可读），状态行走 stderr
if [ "$JSON_OUT" -eq 1 ]; then echo "$STATUS" >&2; else echo "$STATUS"; fi
exit "$RC"
