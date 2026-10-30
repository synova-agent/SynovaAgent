#!/usr/bin/env bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true  # swallow-ok: 语言环境设不上不改判定（本件输出为 UTF-8 字面量，非本地化文本）
# gen-gate-meta.sh — 门禁元数据生成器（T2.5 · #1147；B2 配额双闸扩展 · #1147 余项）
#
# 设计哲学（一句）: **判不了就说判不了，绝不把「看不见」洗成通过** —— 三态 0/1/2 里 2 永不等于 0。
#
# @input  — --emit（默认）/ --check / --quota；--root <repo>；--inv <GATE-INVENTORY.yaml>；--json
#           --emit/--check 数据源（全部机械读取，禁手填）：classification: 段、run_by: 段、
#           四条腿源（scripts/pre-commit-check.sh、scripts/pre-push-check.sh、scripts/commit-msg-check.sh、
#           .gitea/workflows/*.yml）＋ 被守护件自身的文件头 @nature 标记
#           --quota 只读 --inv 的 `gate_meta:` 段（生成物）：不重算 run_by、不读腿源、不写任何文件
# @output — stdout：`gate_meta:` 段（--emit）或校验结论（--check）；
#           --quota 首行恒为 `QUOTA: non_doc=<n>/30（超编 <k>） total=<t>/45 bypass=<b>/8`，
#           次行 `QUOTA-SRC: quota_true=<q> doc=<d> non_doc=<n> bypass=<b> rows=<r>`；
#           超编时按桶逐条 `QUOTA-OVER: <bucket> <entrypoint> class=<class>`（artifact 顺序；
#           bucket ∈ {non-doc,total,bypass}，桶顺序 non-doc → total → bypass）
#           --json 追加一行机器可读摘要（--quota 含三桶、rows 与全部超编条目）
# @exit   — 0 一致/产出成功/配额未超 ｜ 1 违规（缺段/缺行/不一致/六字段非法/orphan∧quota）
#           或配额超编（non_doc>30 ∨ total>45 ∨ bypass>8）｜ 2 判不了
#           （清单不可读、run_by 段缺失、python 缺失、段重复、腿源缺失到无法 join、
#             gate_meta 段缺失或段内 0 行、quota/quota_scope 缺失或非法、
#             --emit 产出为空/形状不符（首行非 gate_meta:、rows<1、六字段行数≠rows*6）、
#             mktemp 或临时输出读写失败、python 意外退出码、rc=0 但输出为空）
# @degraded — E_NO_PYTHON / E_INV_MISSING / E_SECTION_MISSING / E_INTERNAL / E_LEG_SRC /
#              E_GATE_META_MISSING / E_NO_ROWS / E_QUOTA_SCOPE / E_EMIT_TMP / E_EMIT_EMPTY / E_EMIT_SHAPE
#
# 已知限制（做不到什么 —— 禁读成"已检测"）:
#   1. **--quota 的数字来自 artifact 的 `gate_meta:` 段**（生成物快照），不是本命令重算 run_by；
#      手改 artifact 的对账防伪由 --check 的 B3 与 check-gate-inventory.sh 的 R10 承担，非本命令。
#   2. **当前生成器无 bypass 标记源**：quota_scope ∈ {doc,non-doc} 由生成逻辑写出，
#      bypass 桶为前向能力（--quota 只统计 artifact 已标 bypass 的行；现网为 0）。
#
# 🔴 三态铁律：2 绝不等于通过（信号量==0 ⇒ exit 2）。
# 🔴 单一真源：run_by 的"实际腿"由 join 机械判定；台账 run_by 段只提供 quota（并受同源校验约束）。
# 🔴 本器不改任何既有行；--emit 仅打印，落盘由人确认后追加（append-only 段）。
set -uo pipefail

ROOT=""
INV=""
MODE="emit"
JSON="0"
while [ $# -gt 0 ]; do
  case "$1" in
    --emit) MODE="emit" ;;
    --check) MODE="check" ;;
    --quota) MODE="quota" ;;
    --json) JSON="1" ;;
    --root) shift; ROOT="${1:-}" ;;
    --root=*) ROOT="${1#--root=}" ;;
    --inv) shift; INV="${1:-}" ;;
    --inv=*) INV="${1#--inv=}" ;;
    -h|--help) awk 'NR>1 && /^set -uo pipefail/{exit} NR>1' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -z "$ROOT" ] && ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"  # swallow-ok: 失败由下一行显式 exit 2
[ -n "$ROOT" ] || { echo "❌ 非 git 仓库（且未给 --root）" >&2; exit 2; }
[ -z "$INV" ] && INV="$ROOT/docs/authority/GATE-INVENTORY.yaml"

degraded() { # <CODE> <reason>
  echo "GATE-META: DEGRADED $1 — $2" >&2
  exit 2
}

PYBIN="$(command -v python3 2>/dev/null)"  # swallow-ok: 缺失由下一行显式 degraded exit 2
[ -n "$PYBIN" ] || degraded E_NO_PYTHON "python3 不在 PATH"
[ -f "$INV" ] || degraded E_INV_MISSING "清单不存在: $INV"
[ -r "$INV" ] || degraded E_INV_MISSING "清单不可读: $INV"

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"  # swallow-ok: 取不到时下一行按库缺失 degraded
GA_LIB="${LIB_DIR:+$LIB_DIR/gate-assert.sh}"
{ [ -n "$GA_LIB" ] && [ -f "$GA_LIB" ]; } || degraded E_INTERNAL "归一库缺失（判不了 ⇒ 2）: ${GA_LIB:-<目录不可解析>}"
# shellcheck source=scripts/control-tower/gate-assert.sh
. "$GA_LIB" || degraded E_INTERNAL "归一库不可载入: $GA_LIB"

# ── stdout 捕获 ───────────────────────────────────────────────────────────────
# --emit 走 mktemp 临时文件（假绿入口①：mktemp 失败 / 产出形状不符 ⇒ exit 2）；
# --check/--quota 走命令行替换、不落盘（A.1：--quota 只读 artifact、不写任何文件）。
EMIT_TMP=""
cleanup_tmp() { if [ -n "${EMIT_TMP:-}" ]; then rm -f "${EMIT_TMP:-}"; fi; }
trap cleanup_tmp EXIT

run_py() {
  "$PYBIN" - "$INV" "$ROOT" "$MODE" "$JSON" <<'PYEOF'
import glob, json, os, re, subprocess, sys

inv_path, root, mode, json_mode = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"

def die(code):
    print("GATE-META: DEGRADED %s" % code)
    sys.exit(2)

try:
    with open(inv_path, encoding="utf-8") as f:
        lines = f.read().splitlines()
except OSError:
    die("E_INV_MISSING")

def section(name):
    """返回 (起始行号, 行列表)；不存在返回 (None, None)。段名重复 ⇒ 判不了。"""
    idx = [i for i, ln in enumerate(lines) if re.match(r"^%s:\s*$" % re.escape(name), ln)]
    if not idx:
        return None, None
    if len(idx) > 1:
        die("E_INTERNAL")  # 段名重复 ⇒ 判不了
    st = idx[0]
    body = []
    for ln in lines[st + 1:]:
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*:", ln):
            break
        body.append(ln)
    return st, body

def rows_of(name, key):
    st, body = section(name)
    if body is None:
        return None
    out, cur = [], None
    for ln in body:
        m = re.match(r"^\s+-\s+%s:\s*(.*)$" % re.escape(key), ln)
        if m:
            cur = {key: m.group(1).strip().strip('"')}
            out.append(cur); continue
        m = re.match(r"^\s+([A-Za-z_]+):\s*(.*)$", ln)
        if m and cur is not None:
            cur[m.group(1)] = m.group(2).strip().strip('"')
    return out

# ── --quota：只读 artifact 的 gate_meta: 段，统计配额三桶（B2 配额双闸）───────────
QUOTA_LIMITS = {"non_doc": 30, "total": 45, "bypass": 8}
GM_FIELDS = ("class", "run_by", "orphan", "quota", "quota_scope", "nature")

def quota_mode():
    """quota 模式：不读 run_by/腿源，只解析 artifact 的六字段行；超编 ⇒ exit 1，判不了 ⇒ exit 2。"""
    gm = rows_of("gate_meta", "entrypoint")
    if gm is None:
        die("E_GATE_META_MISSING")
    if not gm:
        die("E_NO_ROWS")
    for r in gm:
        if not r.get("entrypoint"):
            die("E_INTERNAL")
        for f in GM_FIELDS:
            if f not in r:
                die("E_QUOTA_SCOPE" if f in ("quota", "quota_scope") else "E_INTERNAL")
        if r["quota"] not in ("true", "false"):
            die("E_QUOTA_SCOPE")
        if r["quota_scope"] not in ("doc", "non-doc", "bypass"):
            die("E_QUOTA_SCOPE")
    q_true = [r for r in gm if r["quota"] == "true"]
    non_doc = [r for r in q_true if r["quota_scope"] == "non-doc"]
    doc = [r for r in q_true if r["quota_scope"] == "doc"]
    byp = [r for r in q_true if r["quota_scope"] == "bypass"]
    total_rows = [r for r in q_true if r["quota_scope"] in ("doc", "non-doc")]  # artifact 顺序
    total = len(total_rows)
    over = max(0, len(non_doc) - QUOTA_LIMITS["non_doc"])
    print("QUOTA: non_doc=%d/30（超编 %d） total=%d/45 bypass=%d/8"
          % (len(non_doc), over, total, len(byp)))
    print("QUOTA-SRC: quota_true=%d doc=%d non_doc=%d bypass=%d rows=%d"
          % (len(q_true), len(doc), len(non_doc), len(byp), len(gm)))
    broken = []
    if len(non_doc) > QUOTA_LIMITS["non_doc"]:
        broken.append(("non-doc", non_doc))
    if total > QUOTA_LIMITS["total"]:
        broken.append(("total", total_rows))
    if len(byp) > QUOTA_LIMITS["bypass"]:
        broken.append(("bypass", byp))
    for bucket, rows in broken:
        for r in rows:
            print("QUOTA-OVER: %s %s class=%s" % (bucket, r["entrypoint"], r.get("class", "")))
    if json_mode:
        print(json.dumps({
            "non_doc": len(non_doc), "doc": len(doc), "total": total, "bypass": len(byp),
            "quota_true": len(q_true), "rows": len(gm),
            "over": [{"bucket": b, "entrypoint": r["entrypoint"], "class": r.get("class", "")}
                     for b, rows in broken for r in rows],
        }, ensure_ascii=False))
    sys.exit(1 if broken else 0)

if mode == "quota":
    quota_mode()

cls_rows = rows_of("classification", "id")
if cls_rows is None:
    die("E_SECTION_MISSING")
rb_rows = rows_of("run_by", "entrypoint")
if rb_rows is None:
    die("E_SECTION_MISSING")  # 无 run_by ⇒ 无法机械判定（判不了）

cls_by_ep = {}
for r in cls_rows:
    ep = r.get("entrypoint", "")
    if ep:
        if ep in cls_by_ep:
            die("E_INTERNAL")
        cls_by_ep[ep] = r

# ── 四条腿（去注释后取脚本名；腿源缺失到无法 join ⇒ 判不了）───────────────
def strip_comments(text):
    return "\n".join("" if ln.lstrip().startswith("#") else ln for ln in text.splitlines())

LEG_FILES = {
    "pre-commit": [os.path.join(root, "scripts", "pre-commit-check.sh")],
    "pre-push": [os.path.join(root, "scripts", "pre-push-check.sh")],
    "gitea-ci": sorted(glob.glob(os.path.join(root, ".gitea", "workflows", "*.yml"))),
    "github-ci": sorted(glob.glob(os.path.join(root, ".github", "workflows", "*.yml"))),
    "npm": [os.path.join(root, "package.json")],
}
LEG_TXT, LEG_MISS = {}, []
for leg, paths in LEG_FILES.items():
    src = []
    for p in paths:
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                src.append(f.read())
        except OSError:
            LEG_MISS.append(p)
    LEG_TXT[leg] = strip_comments("\n".join(src))
if not any(LEG_TXT.values()):
    die("E_LEG_SRC")  # 全部腿源缺失 ⇒ join 无意义 ⇒ 判不了

PRIORITY = ["pre-commit", "pre-push", "gitea-ci", "github-ci", "npm"]
NATURE_RE = re.compile(r"@nature:\s*(semantic|mechanical)")

def measure(ep):
    base = os.path.basename(ep)
    for leg in PRIORITY:
        if base and base in LEG_TXT[leg]:
            return leg
    return "无"

def nature_of(ep):
    p = os.path.join(root, ep)
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            head = "".join(f.readlines()[:40])
    except OSError:
        return "mechanical"  # 文件不在盘 ⇒ 由调用方按孤儿处理
    m = NATURE_RE.search(head)
    return m.group(1) if m else "mechanical"

seen, rows = set(), []
for r in rb_rows:
    ep = r.get("entrypoint", "")
    if not ep:
        die("E_INTERNAL")  # run_by 行缺 entrypoint ⇒ 判不了
    if ep in seen:
        die("E_INTERNAL")  # 重复键 ⇒ 判不了
    seen.add(ep)
    qv = r.get("quota", "").strip().lower()
    if qv not in ("true", "false"):
        die("E_INTERNAL")  # quota 无法判定 ⇒ 判不了
    cls = cls_by_ep.get(ep, {}).get("class", "P2")
    scope = "doc" if (ep.startswith("scripts/doc-system/") or ep.startswith("scripts/doc-system")) else "non-doc"
    run_by = measure(ep)
    rows.append({
        "entrypoint": ep,
        "class": cls,
        "run_by": run_by,
        "orphan": run_by == "无",
        "quota": qv == "true",
        "quota_scope": scope,
        "nature": nature_of(ep),
    })
rows.sort(key=lambda r: r["entrypoint"])

# ── 非法组合：orphan ∧ quota ⇒ 违规（exit 1）─────────────────────────────
bad = [r["entrypoint"] for r in rows if r["orphan"] and r["quota"]]

try:
    sha = subprocess.run(["git", "-C", root, "rev-parse", "--short", "HEAD"],
                         capture_output=True, text=True).stdout.strip() or "-"
except Exception:
    sha = "-"

LEGACY = [
    ("meta", "历史统计段（schema_version / 计数口径），非门禁登记"),
    ("gates", "历史门禁行级盘点（checkpoint 视角），已由 classification 取代"),
    ("checkers", "历史检查器清单（35 条旧口径），已由 classification(41) 取代"),
    ("pairing", "历史配对声明（旧扫描产物），非登记面"),
    ("candidates", "历史候选（T1/T2/T3），已由 run_by_candidates 取代"),
    ("run_by_candidates", "S0 退役候选（run_by=无 的可见化面），非元数据"),
]

def render(include_measured=True):
    out = ["gate_meta:"]
    if include_measured:
        out.append("  measured_at: %s" % sha)
    out.append("  class_default: P2  # 非 classification 条目（无 class 声明）的默认级；P0/P1 只来自 classification")
    out.append("  legacy_sections:")
    for n, why in LEGACY:
        out.append("    - name: %s" % n)
        out.append('      reason: "%s"' % why)
    out.append("  rows:")
    for r in rows:
        out.append("    - entrypoint: %s" % r["entrypoint"])
        out.append("      class: %s" % r["class"])
        out.append("      run_by: %s" % r["run_by"])
        out.append("      orphan: %s" % ("true" if r["orphan"] else "false"))
        out.append("      quota: %s" % ("true" if r["quota"] else "false"))
        out.append("      quota_scope: %s" % r["quota_scope"])
        out.append("      nature: %s" % r["nature"])
    return out

def current_section():
    st, body = section("gate_meta")
    if body is None:
        return None
    return ["gate_meta:"] + body

if mode == "emit":
    for ln in render():
        print(ln)
    if json_mode:
        print(json.dumps({"rows": len(rows), "orphan": sum(1 for r in rows if r["orphan"]),
                          "quota_true": sum(1 for r in rows if r["quota"]),
                          "doc_scope": sum(1 for r in rows if r["quota_scope"] == "doc"),
                          "measured_at": sha}, ensure_ascii=False))
    sys.exit(0)

# ── --check：与库内 gate_meta 逐行比对（measured_at 行不参与，防每次提交必红）──
if bad:
    print("❌ [B1] orphan=true 却 quota=true（无主件不得进配额）: %s" % ", ".join(bad))
    sys.exit(1)
cur = current_section()
if cur is None:
    print("❌ [B2] 清单缺 gate_meta: 段（首次产出请用 --emit 后人工追加；禁删段绕过）")
    sys.exit(1)
want = [ln for ln in render(include_measured=False) if not ln.strip().startswith("measured_at:")]
have = [ln for ln in cur if not ln.strip().startswith("measured_at:")]
if want != have:
    for i, (a, b) in enumerate(zip(have, want)):
        if a != b:
            print("❌ [B3] gate_meta 与生成物不一致（第 %d 行）" % (i + 1))
            print("   库内: %s" % a.strip())
            print("   生成: %s" % b.strip())
            break
    else:
        print("❌ [B3] gate_meta 行数不一致：库内 %d 行 ／ 生成 %d 行" % (len(have), len(want)))
    sys.exit(1)
if bad:
    print("❌ [B1] orphan=true 却 quota=true: %s" % ", ".join(bad))
    sys.exit(1)
print("GATE-META: OK（gate_meta 与生成物一致；rows=%d orphan=%d quota=%d）"
      % (len(rows), sum(1 for r in rows if r["orphan"]), sum(1 for r in rows if r["quota"])))
if json_mode:
    print(json.dumps({"rows": len(rows), "orphan": sum(1 for r in rows if r["orphan"]),
                      "quota_true": sum(1 for r in rows if r["quota"]), "mode": "check"}, ensure_ascii=False))
sys.exit(0)
PYEOF
}
if [ "$MODE" = "emit" ]; then
  EMIT_TMP="$(mktemp "${TMPDIR:-/tmp}/synova-gen-gate-meta.XXXXXX")" || EMIT_TMP=""  # swallow-ok: 失败由下一行显式 degraded E_EMIT_TMP
  [ -n "$EMIT_TMP" ] || degraded E_EMIT_TMP "写临时文件失败: mktemp 在 ${TMPDIR:-/tmp} 不可用（判不了 ⇒ 2）"
  run_py >"$EMIT_TMP"; RC=$?
  OUT="$(cat "$EMIT_TMP")" || degraded E_EMIT_TMP "写临时文件失败: 临时输出不可读（判不了 ⇒ 2）"
else
  OUT="$(run_py)"; RC=$?
fi
if [ "$RC" -eq 2 ]; then
  printf '%s\n' "$OUT"
  CODE="$(printf '%s' "$OUT" | grep -oE 'E_[A-Z_]+' | head -1)"
  echo "degraded: ${CODE:-E_INTERNAL} — 判不了 ≠ 通过" >&2
  exit 2
fi
if [ "$RC" -ne 0 ] && [ "$RC" -ne 1 ]; then
  printf '%s\n' "$OUT"
  echo "degraded: E_INTERNAL — 判不了 ≠ 通过（python 意外退出码 rc=$RC）" >&2
  exit 2
fi
if [ -z "$OUT" ]; then
  if [ "$MODE" = "emit" ]; then
    degraded E_EMIT_EMPTY "--emit 产出为空（rc=$RC；空产出禁当成功）"
  fi
  degraded E_INTERNAL "python rc=$RC 但输出为空（判不了 ⇒ 2）"
fi
# --emit 产出形状（假绿入口①：空 / 首行非 gate_meta: / rows<1 / 六字段行数≠rows*6）
if [ "$MODE" = "emit" ] && [ "$RC" -eq 0 ]; then
  FIRST="$(printf '%s\n' "$OUT" | head -1 | tr -d '\r')"
  [ "$FIRST" = "gate_meta:" ] || degraded E_EMIT_SHAPE "--emit 首行非 gate_meta:（首行: ${FIRST:-<空>}）"
  ROWS="$(printf '%s\n' "$OUT" | awk '/^    - entrypoint:/{c++} END{print c+0}')"
  SIX="$(printf '%s\n' "$OUT" | awk '/^      (class|run_by|orphan|quota|quota_scope|nature):/{c++} END{print c+0}')"
  [ "$ROWS" -ge 1 ] || degraded E_EMIT_SHAPE "--emit rows=0（无配额行可落盘）"
  [ "$SIX" -eq $((ROWS * 6)) ] || degraded E_EMIT_SHAPE "--emit 六字段行数 ${SIX} ≠ rows*6=$((ROWS * 6))（产出形状不符）"
fi
printf '%s\n' "$OUT"
exit "$RC"
