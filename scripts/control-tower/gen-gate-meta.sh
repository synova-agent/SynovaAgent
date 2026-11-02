#!/usr/bin/env bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true  # swallow-ok: 语言环境设不上不改判定（本件输出为 UTF-8 字面量，非本地化文本）
# gen-gate-meta.sh — 门禁元数据生成器（T2.5 · #1147；B2 配额双闸扩展 · #1147 余项）
#
# 设计哲学（一句）: **判不了就说判不了，绝不把「看不见」洗成通过** —— 三态 0/1/2 里 2 永不等于 0。
#
# @input  — --emit（默认）/ --check / --quota / --regen；--root <repo>；--inv <GATE-INVENTORY.yaml>；--json
#           --emit/--check 数据源（全部机械读取，禁手填）：classification: 段、run_by: 段、
#           四条腿源（scripts/pre-commit-check.sh、scripts/pre-push-check.sh、scripts/commit-msg-check.sh、
#           .gitea/workflows/*.yml）＋ 被守护件自身的文件头 @nature 标记
#           run_by 行可选三字段（W0 · #1205 新增；缺省＝旧行为，向后兼容）:
#             quota_scope: doc|non-doc|bypass  —— 优先于按路径的缺省规则（scripts/doc-system/ ⇒ doc，否则 non-doc）
#             scope:       github-only-integration —— 留 GitHub 不占配额（该行 quota 必须 false）
#             na_cmd:      <可复跑负证据命令>  —— scope=github-only-integration 时必填
#           --check 另验 `workflows:` 段（W0-5 两仓 workflow 全量定态，GATE-STANDARD v3.1 §二）
#           --quota 只读 --inv 的 `gate_meta:` 段（生成物）：不重算 run_by、不读腿源、不写任何文件
#           --regen（W0 附 · #1210）＝ **gate_meta: 段的唯一写盘入口**：解析清单 → 内存生成 →
#           内存校验（N1/N2 ＋ B1 ＋ workflows 定态，与 --check 同规则）→ 同目录 tmp ＋ os.replace
#           原子写 → 重读后跑 --check 同逻辑的等价校验；`measured_at` 保留旧值（无旧值才取当前 HEAD）。
# @output — stdout：`gate_meta:` 段（--emit）或校验结论（--check / --regen）；
#           --check 成功打 `WORKFLOWS: OK n=<n>（阻断=.. 只报=.. advisory=.. 账外=0）` 后打
#           `GATE-META: OK（...）`；违规打 `WORKFLOWS: VIOLATION k=<n>` ＋ 逐条 `  ❌ ...`（点名 id）
#           或 `❌ [N1]/[N2] <entrypoint> ...`（run_by 三字段规则）；
#           --regen 成功打 `GATE-META: REGEN OK（rows=<n> measured_at=<sha> path=<清单>）`，
#           违规打 `  ❌ ...` 并（写前）零改动 /（写后校验失败）显式回滚；
#           --quota 首行恒为 `QUOTA: non_doc=<n>/30（超编 <k>） total=<t>/45 bypass=<b>/8`，
#           次行 `QUOTA-SRC: quota_true=<q> doc=<d> non_doc=<n> bypass=<b> rows=<r>`；
#           超编时按桶逐条 `QUOTA-OVER: <bucket> <entrypoint> class=<class>`（artifact 顺序；
#           bucket ∈ {non-doc,total,bypass}，桶顺序 non-doc → total → bypass）
#           --json 追加一行机器可读摘要（--quota 含三桶、rows 与全部超编条目；--regen 含 mode/rows）
# @exit   — 0 一致/产出成功/配额未超/重放成功 ｜ 1 违规（缺段/缺行/不一致/六字段非法/orphan∧quota/
#           [N1] scope=github-only-integration 却 quota=true/[N2] 缺 na_cmd/
#           workflows 段违规（缺段/条数≠10/必填缺/四态或 category 非法/出现账外/
#           阻断态非 gitea/advisory 无理由/github/ci jobs≠12/dual-repo-sync 非阻断/
#           登记的 yml 不存在或目录里有未登记的 yml））
#           或配额超编（non_doc>30 ∨ total>45 ∨ bypass>8）｜
#           --regen 的 1 ＝ 校验失败（写前：零改动；写后等价校验失败：**回滚原件**并明示）
#           ｜ 2 判不了
#           （清单不可读、run_by 段缺失、python 缺失、段重复、腿源缺失到无法 join、
#             gate_meta 段缺失或段内 0 行、quota/quota_scope 缺失或非法、run_by 的 scope 取值未知、
#             workflows 段结构不可解析、--emit 产出为空/形状不符（首行非 gate_meta:、rows<1、
#             六字段行数≠rows*6）、mktemp 或临时输出读写失败、python 意外退出码、rc=0 但输出为空、
#             --regen 的读/写盘失败（E_REGEN_READ/E_REGEN_WRITE））
# @degraded — E_NO_PYTHON / E_INV_MISSING / E_SECTION_MISSING / E_INTERNAL / E_LEG_SRC /
#              E_GATE_META_MISSING / E_NO_ROWS / E_QUOTA_SCOPE / E_EMIT_TMP / E_EMIT_EMPTY / E_EMIT_SHAPE /
#              E_REGEN_READ / E_REGEN_WRITE
#              降级行写 stderr `degraded: <CODE> — <原因>` 并追加 JSON 到 SYNO_GATE_DEGRADED_LOG
#              （time/component/code/phase/retryable；铁律 11/32）；exit 2（判不了 ≠ 通过）。
# @authority — **explicit authority（DSH B5）**: `gate_meta:` 段的**唯一写入者是本器的 --regen**；
#              --emit 只打印、--check/--quota 只读；其它脚本/人不得直接改该段（check-gate-inventory
#              的 R10 与 --check 的 B3 负责抓「手改生成物」，本器不抓蓄意绕过）。
#
# 结构（Source map · File→Role）:
#   段                        职责
#   ────────────────────────  ─────────────────────────────────────────────────────────
#   ① 头部契约                @input/@output/@exit/@degraded/@authority/已知限制（本段）
#   ② 参数与注入缝            --emit/--check/--quota/--regen、--root、--inv、--json；degraded 出口（含降级日志）
#   ③ 解释器与依赖探测        PYBIN、归一库 gate-assert.sh 载入（缺 ⇒ exit 2）
#   ④ python 主体（heredoc）  段解析 section/rows_of、quota 桶、run_by→gate_meta 生成、
#                             workflows 定态校验、--check 对账、--regen 原子写＋写后校验
#   ⑤ bash 后处理             stdout 捕获、rc→三态归一、--emit 产出形状闸、落盘输出
#
# 已知限制（做不到什么 —— 禁读成"已检测"）:
#   1. **--quota 的数字来自 artifact 的 `gate_meta:` 段**（生成物快照），不是本命令重算 run_by；
#      手改 artifact 的对账防伪由 --check 的 B3 与 check-gate-inventory.sh 的 R10 承担，非本命令。
#   2. **bypass 的源在 run_by**：quota_scope=bypass 由 run_by 行显式声明（W0 · #1205 回填 2 件），
#      不再按路径推导；`--quota` 的 bypass 桶只统计 artifact 已标 bypass 的行。
#   3. **`na_cmd` 只校验「存在且非空」，本命令不执行它**（执行与断言归 W5 的机检）——
#      禁止把"字段在册"读成"负证据已跑过"。
#   4. **gate_meta 仍是六字段形状**（class/run_by/orphan/quota/quota_scope/nature；#1205 不加第 7 字段）：
#      run_by 的 scope/na_cmd 是**登记面字段**，不复制进生成物 ⇒ 二者的一致性由 --check 的 N1/N2 就地判。
#   5. **--regen 只重写 `gate_meta:` 段**：其余段（classification/run_by/workflows/retired/…）**原样保留**，
#      不重排、不规整、不修语法 ⇒ 非生成段的冲突必须人工按登记面解决（本器不猜）。
#   6. **--regen 保留旧 `measured_at`**（该行不参与 --check 对账）：这是为了让「登记批」的 diff
#      只含真实新增行、不因 HEAD 变化制造噪声；刷新 measured_at 仍是独立动作（标准 §七 列为待办）。
#   7. **--regen 的写后校验失败 ⇒ 回滚原件**：回滚本身若也失败（磁盘满/权限）⇒ exit 2 并在 stderr
#      明示「原件可能已损坏」，不静默。
#   8. **不做并发互斥**：两个 --regen 同时跑时后写者胜（os.replace 原子但无锁）；本器是低频人工/批次动作，
#      并发场景由调用方串行化（CI 上不在 12 组主路径）。
#
# 🔴 三态铁律：2 绝不等于通过（信号量==0 ⇒ exit 2）。
# 🔴 单一真源：run_by 的"实际腿"由 join 机械判定；台账 run_by 段只提供 quota（并受同源校验约束）。
# 🔴 --emit 仍只打印（append-only 由人确认）；--regen 是唯一写盘入口（同目录 tmp ＋ os.replace）。
set -uo pipefail

ROOT=""
INV=""
MODE="emit"
STAMP=0
JSON="0"
while [ $# -gt 0 ]; do
  case "$1" in
    --emit) MODE="emit" ;;
    --check) MODE="check" ;;
    --quota) MODE="quota" ;;
    --regen) MODE="regen" ;;
    --stamp) STAMP=1 ;;   # #1296：刷新 measured_at（唯一写盘入口仍是 --regen）
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
DEG_LOG="${SYNO_GATE_DEGRADED_LOG:-$ROOT/.codex/control-tower/logs/degraded-events.log}"

degraded() { # <CODE> <reason>（D2：stderr 一行 ＋ 降级日志 JSON ＋ exit 2；禁静默）
  echo "GATE-META: DEGRADED $1 — $2" >&2
  echo "degraded: $1 — $2" >&2
  mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null || true
  printf '{"time":"%s","component":"gen-gate-meta","code":"%s","phase":"%s","retryable":false}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$DEG_LOG" 2>/dev/null || true
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
  "$PYBIN" - "$INV" "$ROOT" "$MODE" "$JSON" "$STAMP" <<'PYEOF'
import glob, json, os, re, subprocess, sys

inv_path, root, mode, json_mode = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"
STAMP = (len(sys.argv) > 5 and sys.argv[5] == "1")   # #1296：--stamp 时 measured_at 取当前基准


class GateError(Exception):
    """typed error（DSH B1）：code/phase/retryable 随异常走，禁裸字符串降级。"""
    def __init__(self, code, phase="parse", retryable=False):
        super().__init__(code)
        self.code = code
        self.phase = phase
        self.retryable = retryable


def die(code, phase="parse", retryable=False):
    """判不了（exit 2）：打印 typed error 三件后抛 SystemExit(2)，调用方据此判降级。
    为什么 raise 而不是裸 print+exit：让所有降级点共用同一出口，phase/retryable 不会漏写。"""
    err = GateError(code, phase, retryable)
    print("GATE-META: DEGRADED %s" % err.code)
    print("GATE-META: ERROR code=%s phase=%s retryable=%s"
          % (err.code, err.phase, "true" if err.retryable else "false"), file=sys.stderr)
    raise SystemExit(2)

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
# run_by 行的可选三字段（W0 · #1205）；缺省 ⇒ 旧行为（向后兼容）
QUOTA_SCOPES = ("doc", "non-doc", "bypass")
GITHUB_ONLY = "github-only-integration"

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
n_viol = []  # 规则 N1/N2 违规（run_by 三字段书写违规）；任意模式都先判，坏清单禁再生成
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
    # W0 · #1205：quota_scope 优先取 run_by 行（bypass 回填的唯一源）；缺省按路径（旧行为）
    scope_raw = r.get("quota_scope", "").strip()
    if scope_raw:
        if scope_raw not in QUOTA_SCOPES:
            die("E_QUOTA_SCOPE")  # 取值未知 ⇒ 判不了（禁静默回落缺省）
        scope = scope_raw
    else:
        scope = "doc" if (ep.startswith("scripts/doc-system/") or ep.startswith("scripts/doc-system")) else "non-doc"
    # W0 · #1205 规则 N1/N2：留 GitHub 不占配额（工装/集成）⇒ quota:false ＋ 必带 na_cmd
    gscope = r.get("scope", "").strip()
    if gscope and gscope != GITHUB_ONLY:
        die("E_QUOTA_SCOPE")  # 未知 scope 取值 ⇒ 判不了
    if gscope == GITHUB_ONLY:
        if qv == "true":
            n_viol.append("[N1] %s 标 scope=%s 却 quota=true（留 GitHub 不占配额 ⇒ 必须 quota:false）"
                          % (ep, GITHUB_ONLY))
        if not r.get("na_cmd", "").strip():
            n_viol.append("[N2] %s 标 scope=%s 但缺 na_cmd（负证据命令必填；执行归 W5）"
                          % (ep, GITHUB_ONLY))
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

# ── 规则 N1/N2：清单书写违规 ⇒ exit 1（--emit 也判：坏清单禁再生成快照）──────────
if n_viol:
    for msg in n_viol:
        print("❌ " + msg)
    sys.exit(1)

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

# ── W0-5 workflow 全量定态校验（GATE-STANDARD v3.1 §二；判据真源＝本函数）─────────
# 只做「登记面 vs 实况」的机械对账：账外腿（盘上有/清单没有）与幻影腿（清单有/盘上没有）
# 双向都判 —— 否则「无账外」这句判据无法被检验。
WF_IDS = (
    "gitea/local-gates", "gitea/dual-repo-sync", "gitea/asset-sync", "gitea/trunk-freeze-watch",
    "github/ci", "github/dashboard-auto", "github/desktop-build", "github/product-progress",
    "github/progress-freshness-watchdog", "github/project-coordinates",
)
WF_STATES = ("阻断", "只报", "advisory", "账外")
WF_CATS = ("integration", "discipline", "quality", "advisory", "mixed")
WF_JOB_COUNT = 12
WF_REPOS = ("gitea", "github")

def wf_entries():
    """解析 workflows: 段 ⇒ [{id, f:{...}, jobs:[...]}]；段不存在 ⇒ None；结构不可解析 ⇒ die(2)。"""
    st, body = section("workflows")
    if body is None:
        return None
    entries, cur, injobs = [], None, False
    for ln in body:
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        m = re.match(r"^  - id:\s*(.*)$", ln)
        if m:
            cur = {"id": m.group(1).strip().strip('"'), "f": {}, "jobs": []}
            entries.append(cur); injobs = False; continue
        if cur is None:
            die("E_INTERNAL")  # 段头之后缩进非法 ⇒ 结构不可解析（判不了）
        if re.match(r"^    jobs:\s*$", ln):
            injobs = True; continue
        mj = re.match(r"^      - id:\s*(.*)$", ln)
        if injobs and mj:
            cur["jobs"].append({"id": mj.group(1).strip().strip('"'), "category": None, "state": None})
            continue
        if injobs:
            mm = re.match(r"^        (category|state|reason):\s*(.*)$", ln)
            if mm:
                if not cur["jobs"]:
                    die("E_INTERNAL")
                cur["jobs"][-1][mm.group(1)] = mm.group(2).strip().strip('"')
                continue
            if re.match(r"^        ", ln):
                die("E_INTERNAL")  # jobs 块内未知字段 ⇒ 结构不可解析
            injobs = False
        mf = re.match(r"^    (repo|trigger|state|category|reason):\s*(.*)$", ln)
        if mf:
            cur["f"][mf.group(1)] = mf.group(2).strip().strip('"')
            continue
        if re.match(r"^    ", ln):
            die("E_INTERNAL")      # 条目内未知字段 ⇒ 结构不可解析
    return entries

def check_workflows():
    """--check 专用：10 条 workflow 定态。违规 ⇒ 打印 WORKFLOWS: VIOLATION 后 exit 1。"""
    entries = wf_entries()
    viol = []
    if entries is None:
        viol.append("清单缺 workflows: 段（W0 之后它是必需项；禁删段绕过）")
    else:
        ids = [e["id"] for e in entries]
        for want in WF_IDS:
            if want not in ids:
                viol.append("缺登记: %s" % want)
        for got in ids:
            if got not in WF_IDS:
                viol.append("清单多处未登记面（禁造幽灵腿）: %s" % got)
        if len(entries) != len(WF_IDS):
            viol.append("条数=%d（期望 %d 个 workflow）" % (len(entries), len(WF_IDS)))
        for e in entries:
            f = e["f"]
            for k in ("repo", "trigger", "state", "category", "reason"):
                if not f.get(k):
                    viol.append("%s 缺必填 %s" % (e["id"], k))
            if f.get("repo") not in WF_REPOS:
                viol.append("%s repo 非法: %s（只许 %s）" % (e["id"], f.get("repo"), "/".join(WF_REPOS)))
            if f.get("state") not in WF_STATES:
                viol.append("%s state 非法: %s（只许 %s）" % (e["id"], f.get("state"), "/".join(WF_STATES)))
            elif f.get("state") == "账外":
                viol.append("%s state=账外（W0 出口判据＝无账外，须整改后登记）" % e["id"])
            if f.get("category") not in WF_CATS:
                viol.append("%s category 非法: %s（只许 %s）" % (e["id"], f.get("category"), "/".join(WF_CATS)))
            if f.get("state") == "阻断" and f.get("repo") != "gitea":
                viol.append("%s 阻断态越权（只有 Gitea 权威腿可阻断）" % e["id"])
            if f.get("state") == "advisory" and len(f.get("reason", "")) < 8:
                viol.append("%s advisory 须写理由（≥8 字，现 %d 字）" % (e["id"], len(f.get("reason", ""))))
            # 实况对账①：登记的 id 必须对得上两仓 workflows 目录里的真文件（禁凭记忆抄）
            m = re.match(r"^(gitea|github)/(.+)$", e["id"])
            if not m:
                viol.append("%s id 形状非法（须 <repo>/<name>）" % e["id"])
            else:
                rel = os.path.join(".%s" % m.group(1), "workflows", m.group(2) + ".yml")
                if not os.path.isfile(os.path.join(root, rel)):
                    viol.append("%s 登记了但盘上没有 %s（禁凭记忆抄）" % (e["id"], rel))
            if e["id"] == "github/ci":
                if len(e["jobs"]) != WF_JOB_COUNT:
                    viol.append("github/ci jobs=%d（期望 %d）" % (len(e["jobs"]), WF_JOB_COUNT))
                for j in e["jobs"]:
                    if j.get("category") not in WF_CATS:
                        viol.append("github/ci/job %s category 非法: %s" % (j["id"], j.get("category")))
                    if j.get("state") not in WF_STATES:
                        viol.append("github/ci/job %s state 非法: %s" % (j["id"], j.get("state")))
                    elif j.get("state") == "账外":
                        viol.append("github/ci/job %s state=账外（须整改）" % j["id"])
            elif e["jobs"]:
                viol.append("%s 不该有 jobs: 段（只有 github/ci 逐 job 定态）" % e["id"])
        drs = [e for e in entries if e["id"] == "gitea/dual-repo-sync"]
        if drs and drs[0]["f"].get("state") != "阻断":
            viol.append("gitea/dual-repo-sync 必须为阻断（自行判门禁放行后推送＝真阻断腿）")
        # 实况对账②：两仓目录里的每个 yml 都必须在册（账外腿清零）
        for repo in WF_REPOS:
            d = os.path.join(root, ".%s" % repo, "workflows")
            if not os.path.isdir(d):
                die("E_LEG_SRC")  # 目录不存在 ⇒ 无法对账 ⇒ 判不了
            for fn in sorted(glob.glob(os.path.join(d, "*.yml"))):
                wid = "%s/%s" % (repo, os.path.basename(fn)[:-4])
                if wid not in ids:
                    viol.append("盘上有 %s 但清单未登记（账外腿）" % wid)
    if viol:
        print("WORKFLOWS: VIOLATION k=%d" % len(viol))
        for v in viol:
            print("  ❌ " + v)
        sys.exit(1)
    dist = " ".join("%s=%d" % (s, sum(1 for e in entries if e["f"].get("state") == s))
                    for s in WF_STATES)
    print("WORKFLOWS: OK n=%d（%s）" % (len(entries), dist))

# ── --regen（W0 附 · #1210）：gate_meta 段的唯一写盘入口 ─────────────────────────
def _render_with_preserved_measured():
    """渲染 gate_meta 段；measured_at 保留旧值（artifact 稳定、--check 不比该行）。
    → (段行列表, 旧 measured_at 或 None)"""
    st, body = section("gate_meta")
    old_measured = None
    if body is not None:
        for ln in body:
            m = re.match(r"^\s+measured_at:\s*(\S+)\s*$", ln)
            if m:
                old_measured = m.group(1)
                break
    out = render(include_measured=True)
    # #1296（W5/例外 7）：--stamp ⇒ 刷新 measured_at 为**当前基准**；否则保留旧值（原设计，防噪声）
    if STAMP:
        return out, None   # 交给调用方回落到当前 sha（REGEN 消息里显示真值）
    if old_measured:
        out = [("  measured_at: %s" % old_measured) if ln.strip().startswith("measured_at:") else ln
               for ln in out]
    return out, old_measured


def _verify_on_disk():
    """写后等价校验（与 --check 的 B3 同逻辑）：重读清单逐行比 gate_meta（measured_at 除外）。
    → None=一致；否则返回问题码（E_REGEN_READ / NO_SECTION / MISMATCH）"""
    global lines
    try:
        with open(inv_path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return "E_REGEN_READ"
    cur2 = current_section()
    if cur2 is None:
        return "NO_SECTION"
    want = [ln for ln in render(include_measured=False) if not ln.strip().startswith("measured_at:")]
    have = [ln for ln in cur2 if not ln.strip().startswith("measured_at:")]
    return None if have == want else "MISMATCH"


def regen_mode():
    """--regen：内存校验 → 同目录原子写 → 重读等价校验；任一失败不留下半成品。"""
    # ① 写前内存校验（复用 --check 同规则；N1/N2 已在更早处 exit 1）
    check_workflows()
    if bad:
        print("❌ [B1] orphan=true 却 quota=true（无主件不得进配额）: %s" % ", ".join(bad))
        sys.exit(1)
    new_section, old_measured = _render_with_preserved_measured()
    try:
        with open(inv_path, "rb") as fh:
            original_bytes = fh.read()
    except OSError:
        die("E_REGEN_READ", "regen-read")
    try:
        raw = original_bytes.decode("utf-8")
    except UnicodeDecodeError:
        die("E_REGEN_READ", "regen-decode")
    # 行尾保真：本仓 GATE-INVENTORY 实测**混合行尾**（gate_meta 段 CRLF、其余 LF）。
    # 这里按 `\n` 切、保留行尾 `\r`，只给新 gate_meta 行套用旧段的行尾形态，
    # 其它行**逐字节不动** —— 否则一次登记会把整文件行尾换掉（871 行假噪声）。
    raw_lines = raw.split("\n")
    st, body = section("gate_meta")
    # 旧段的行尾形态必须从**原始行**取（section() 的 body 已被 splitlines 去掉 \r —— 实测踩过）
    raw_body = raw_lines[st + 1: st + 1 + len(body)] if (st is not None and body) else []
    if raw_body:
        cr_n = sum(1 for ln in raw_body if ln.endswith("\r"))
        use_cr = cr_n > 0 and cr_n >= len(raw_body) / 2.0
    else:
        use_cr = sum(1 for ln in raw_lines if ln.endswith("\r")) > len(raw_lines) / 2.0
    suffix = "\r" if use_cr else ""
    sec_lines = [ln + suffix for ln in new_section]
    if st is not None:
        end = st + 1 + len(body)
        new_raw = raw_lines[:st] + sec_lines + raw_lines[end:]
    else:
        anchor = next((i for i, ln in enumerate(raw_lines) if ln.rstrip("\r") == "retired:"), None)
        if anchor is None:
            new_raw = raw_lines + sec_lines
        else:
            new_raw = raw_lines[:anchor] + sec_lines + raw_lines[anchor:]
    new_text = "\n".join(new_raw)
    if raw.endswith("\n") and not new_text.endswith("\n"):
        new_text += "\n"   # 保留「文件以换行结尾」的原形态
    first_content = next((ln.strip() for ln in new_raw
                          if ln.strip() and not ln.strip().startswith("#")), "")
    if not re.match(r"^schema_version:\s*\d+", first_content):
        # 防呆：目标清单头必须是 schema_version（防"写错文件/写错位置"；注释头不算）
        print("❌ [REGEN] 目标清单头部异常（首个非注释非空行: %r）——拒绝写入" % first_content)
        sys.exit(1)
    # ③ 原子写（同目录 tmp ＋ os.replace；跨文件系统 rename 不原子 ⇒ 必须同目录）
    tmp = inv_path + ".regen.tmp"
    try:
        with open(tmp, "w", encoding="utf-8", newline="") as fh:
            fh.write(new_text)
        os.replace(tmp, inv_path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        die("E_REGEN_WRITE", "regen-write", retryable=True)
    # ④ 写后等价校验；失败 ⇒ 回滚原件（不允许留下"写了一半的生成物"）
    problem = _verify_on_disk()
    if problem:
        try:
            tmp2 = inv_path + ".regen.rollback.tmp"
            with open(tmp2, "wb") as fh:
                fh.write(original_bytes)
            os.replace(tmp2, inv_path)
            print("❌ [REGEN] 写入后等价校验失败（%s）⇒ 已回滚原件（文件未改变）" % problem)
        except OSError:
            print("❌ [REGEN] 写入后等价校验失败（%s）且回滚失败 —— 原件可能已损坏: %s"
                  % (problem, inv_path))
            die("E_REGEN_WRITE", "regen-rollback")
        sys.exit(1)
    print("GATE-META: REGEN OK（rows=%d measured_at=%s path=%s）"
          % (len(rows), old_measured or sha, os.path.basename(inv_path)))
    if json_mode:
        print(json.dumps({"mode": "regen", "rows": len(rows),
                          "measured_at": old_measured or sha}, ensure_ascii=False))
    sys.exit(0)


if mode == "regen":
    regen_mode()

if mode == "emit":
    for ln in render():
        print(ln)
    if json_mode:
        print(json.dumps({"rows": len(rows), "orphan": sum(1 for r in rows if r["orphan"]),
                          "quota_true": sum(1 for r in rows if r["quota"]),
                          "doc_scope": sum(1 for r in rows if r["quota_scope"] == "doc"),
                          "measured_at": sha}, ensure_ascii=False))
    sys.exit(0)

# ── --check：先验 workflows 定态（W0-5；与 gate_meta 对账相互独立），再对账 gate_meta ──
check_workflows()

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
