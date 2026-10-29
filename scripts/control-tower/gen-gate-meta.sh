#!/usr/bin/env bash
# gen-gate-meta.sh — 门禁元数据生成器（T2.5 · #1147）
#
# @input  — --emit（默认）/ --check；--root <repo>；--inv <GATE-INVENTORY.yaml>；--json
#           数据源（全部机械读取，禁手填）：classification: 段、run_by: 段、
#           四条腿源（scripts/pre-commit-check.sh、scripts/pre-push-check.sh、scripts/commit-msg-check.sh、
#           .gitea/workflows/*.yml）＋ 被守护件自身的文件头 @nature 标记
# @output — stdout：`gate_meta:` 段（--emit）或校验结论（--check）；--json 追加一行机器可读摘要
# @exit   — 0 一致/产出成功 ｜ 1 违规（缺段/缺行/不一致/六字段非法/orphan∧quota）｜ 2 判不了
#           （清单不可读、run_by 段缺失、python 缺失、段重复、腿源缺失到无法 join）
# @degraded — E_NO_PYTHON / E_INV_MISSING / E_SECTION_MISSING / E_INTERNAL / E_LEG_SRC
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

OUT="$("$PYBIN" - "$INV" "$ROOT" "$MODE" "$JSON" <<'PYEOF'
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
)"
RC=$?
printf '%s\n' "$OUT"
if [ "$RC" -eq 2 ]; then
  CODE="$(printf '%s' "$OUT" | grep -oE 'E_[A-Z_]+' | head -1)"
  echo "degraded: ${CODE:-E_INTERNAL} — 判不了 ≠ 通过" >&2
  exit 2
fi
exit "$RC"
