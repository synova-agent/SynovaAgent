#!/usr/bin/env bash
# D313/D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gate-inventory.invariant.sh — GATE-INVENTORY 不变式伴生件（B3 invariant companion · W0 附 · #1210）
#
# 设计哲学（一句）: **重放一致 ≠ 账本自洽** —— gen-gate-meta --check 只证明「生成物与重放一致」，
#                    本件把四条账本不变式（配额恒等式／id 唯一／workflows 定态／disk↔registry 对齐）
#                    独立成件，让「手工拼错一行」在解析前就被拦，而不是只报「对不上」。
#
# 契约（铁律 47）:
#   @input  — --inv <GATE-INVENTORY.yaml>（默认 <root>/docs/authority/GATE-INVENTORY.yaml）
#             --root <repo>（默认 git toplevel）
#             环境 SYNO_GATE_DEGRADED_LOG  降级日志（默认 <root>/.codex/control-tower/logs/degraded-events.log）
#             依赖（判据单源，禁重复实现）：scripts/control-tower/check-gate-inventory.sh（④）
#                                          scripts/control-tower/gen-gate-meta.sh --quota（①的对照源）
#   @output — 逐项 ✅/❌（含实测数字）＋ 末行机器行：
#             `GATE-INVENTORY-INVARIANT: OK` | `GATE-INVENTORY-INVARIANT: VIOLATION <n>`
#             | `GATE-INVENTORY-INVARIANT: DEGRADED <code>`
#   @exit   — 0 四项＋schema 全绿 ｜ 1 违规 ｜ 2 判不了（清单缺失·结构不可解析·段缺失·
#             python/依赖缺失·④ 自身判不了）—— 🔴 2 绝不等于通过（fail-closed）
#   @degraded — stderr `degraded: <CODE> — <原因>` ＋ 追加 JSON 到 SYNO_GATE_DEGRADED_LOG
#             （time/component/code/phase/retryable；铁律 11/32）＋ exit 2
#   @error   — E_USAGE / E_NO_PYTHON / E_INV_MISSING / E_SECTION_MISSING / E_SCHEMA /
#              E_DEP_MISSING / E_INTERNAL
#   @authority — explicit authority（DSH B5）: 只读件。唯一落盘 = 降级日志（.codex/ 下、被 gitignore
#             忽略）。修复动作不在本件：生成物重放归 `gen-gate-meta.sh --regen`，登记面归人。
#
# 四项不变量 ＋ schema 面（判据）:
#   ① 配额恒等式（W0 出口数字，创始人裁定 #1212）：quota_true=39 = non_doc 35 ＋ doc 2 ＋ bypass 2。
#      · 从 gate_meta 段机械统计（quota:true 的 quota_scope 分布）；
#      · 与 `gen-gate-meta.sh --quota` 的 `QUOTA-SRC:` 行逐数字对照（禁只信自己算的）；
#      · 常量是 **W0 出口棘轮**：W1 退役批把 37→30 时须**同批显式更新**（改常量 = 改判据，带卡号）。
#   ② id 唯一：全清单所有 `- id:` 值（classification／retired／candidates …）出现次数 == 去重数。
#   ③ workflows：段存在、恰好 10 条、state ∈ {阻断,只报,advisory,账外}、**账外 = 0**。
#   ④ disk↔registry 双向对齐：**直接复用** `check-gate-inventory.sh --root <root>` 的退出码
#      （本件不重写它的判据；两件都跑才是完整判据）。
#   schema（B2）: 段名白名单 ＋ 必填字段/类型 —— classification 六字段、run_by 三字段、
#      gate_meta 六字段；手工拼的 YAML 在解析前被拦（未知段/未知字段/空必填/类型不符）。
#
# 已知限制（做不到什么 —— 禁读成"已检测"）:
#   1. **不是第二份判据**：④ 直接复用 check-gate-inventory.sh 的 rc；本件只在它之上加
#      「恒等式／id／workflows／schema」四条**生成物自洽**检查 ⇒ 单独跑本件不等于验收。
#   2. **只解析本仓 YAML 子集**（顶格 `key:` ＋ 两空格缩进 ＋ `- key: value`）；锚点/多行标量/
#      流式集合等语法超出子集 ⇒ exit 2（判不了，不猜）。
#   3. **id 唯一性是全清单口径**：同一 id 出现在两段也算违规（= 账本两说）；历史段若真有
#      跨段复用，须先把账改对而不是放宽本件。
#   4. **workflows 的 trigger 实况对账不在本件**（归 `gen-gate-meta.sh --check` 的实况①②）；
#      本件只判「段在／n=10／四态合法／无账外」。
#   5. **不判配额是否超编**（35>30 现网预期红，归 gen-gate-meta --quota / W1 退役批）；
#      本件只判恒等式与常量不回退。
#   6. **不判语义**：字段「写得对不对」仍需评审；本件只拦结构/类型/算术/枚举。
#
# 判别力自检（改坏确实红，见配对测试 tests/control-tower/gate-inventory.invariant.test.sh）:
#   · 改一条 gate_meta 的 quota_scope（non-doc→doc）⇒ ① 红（35→34、2→3，恒等式 39≠39 值不符）
#   · 复制一个 id ⇒ ② 红
#   · 删 workflows 段 ⇒ ③ 红
#   · 清单不可读 / 缺 classification 段 ⇒ exit 2（判不了 ≠ 通过）
#   · 正常清单 ⇒ 四项＋schema 全绿、exit 0
#
# 结构（Source map · File→Role）:
#   段                   职责
#   ──────────────────   ───────────────────────────────────────────────────────────
#   ① 头部契约           本段（契约／判据／已知限制／自检／Source map）
#   ② 参数与降级出口     --inv/--root 解析；deg()（stderr ＋ SYNO_GATE_DEGRADED_LOG ＋ exit 2）
#   ③ 依赖探测           python3、check-gate-inventory.sh、gen-gate-meta.sh（缺 ⇒ 2）
#   ④ ① 的对照源         跑 `gen-gate-meta.sh --quota`，取 QUOTA-SRC 行（超编 rc=1 是现状，不判死）
#   ⑤ python 不变式      schema 白名单 / ① 恒等式 / ② id 唯一 / ③ workflows
#   ⑥ ④ 对齐复用         跑 `check-gate-inventory.sh --root`，整流 rc（0/1/2）
#   ⑦ 输出               逐项 ✅❌ ＋ 机器行 ＋ 三态退出码
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT=""
INV=""
while [ $# -gt 0 ]; do
  case "$1" in
    --inv) shift; INV="${1:-}" ;;
    --inv=*) INV="${1#--inv=}" ;;
    --root) shift; ROOT="${1:-}" ;;
    --root=*) ROOT="${1#--root=}" ;;
    -h|--help) awk 'NR>1 && /^set -uo pipefail/{exit} NR>1' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -z "$ROOT" ] && ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"  # swallow-ok: 失败由下一行显式 exit 2
[ -n "$ROOT" ] || { echo "❌ 非 git 仓库（且未给 --root）" >&2; exit 2; }
[ -z "$INV" ] && INV="$ROOT/docs/authority/GATE-INVENTORY.yaml"
DEG_LOG="${SYNO_GATE_DEGRADED_LOG:-$ROOT/.codex/control-tower/logs/degraded-events.log}"

deg() { # $1=code $2=phase $3=原因（D2：stderr 一行 ＋ JSON 追加 ＋ exit 2）
  printf 'degraded: %s — %s\n' "$1" "$3" >&2
  mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null || true
  printf '{"time":"%s","component":"gate-inventory-invariant","code":"%s","phase":"%s","retryable":false}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$DEG_LOG" 2>/dev/null || true
  echo "GATE-INVENTORY-INVARIANT: DEGRADED $1"
  exit 2
}

PYBIN="$(command -v python3 2>/dev/null)"  # swallow-ok: 缺失由下一行显式 degrade（禁裸 python3，D520）
[ -n "$PYBIN" ] || deg E_NO_PYTHON runtime "python3 不在 PATH（判不了）"
[ -f "$INV" ] || deg E_INV_MISSING parse "清单不存在: $INV"
[ -r "$INV" ] || deg E_INV_MISSING parse "清单不可读: $INV"

INV_CHECKER="$ROOT/scripts/control-tower/check-gate-inventory.sh"
GGM="$ROOT/scripts/control-tower/gen-gate-meta.sh"
[ -f "$INV_CHECKER" ] || deg E_DEP_MISSING deps "④ 的判据单源缺失: $INV_CHECKER"
[ -f "$GGM" ] || deg E_DEP_MISSING deps "① 的对照源缺失: $GGM"

# ── ④ 的对照源：QUOTA-SRC（超编 rc=1 是现网预期，不据此判死；无该行才判不了）──
QUOTA_OUT="$(bash "$GGM" --quota --inv "$INV" --root "$ROOT" 2>&1)"; QRC=$?
SRC_LINE="$(printf '%s\n' "$QUOTA_OUT" | grep '^QUOTA-SRC:' | tail -1)"
[ -n "$SRC_LINE" ] || deg E_INTERNAL quota "gen-gate-meta --quota 未产出 QUOTA-SRC（rc=${QRC}）—— 判不了"

# ── ⑤ python 不变式（schema ／ ① ／ ② ／ ③）──
PY_OUT="$("$PYBIN" - "$INV" "$SRC_LINE" <<'PYEOF'
import re
import sys

inv_path, src_line = sys.argv[1], sys.argv[2]

# W0 出口数字（创始人裁定 #1212；W1 退役批须同批显式更新，改常量 = 改判据）
EXPECT = {"quota_true": 39, "non_doc": 35, "doc": 2, "bypass": 2}
WF_IDS_EXPECT = 10
WF_STATES = ("阻断", "只报", "advisory", "账外")
TOP_ALLOWED = {
    "schema_version", "meta", "findings", "excluded_headers", "gates", "checkers", "pairing",
    "candidates", "classification", "run_by", "run_by_candidates", "gate_meta", "retired", "workflows",
}
CLS_FIELDS = ("id", "class", "owner", "review_after", "entrypoint", "required_ci")
RB_FIELDS = ("entrypoint", "run_by", "quota")
GM_FIELDS = ("entrypoint", "class", "run_by", "orphan", "quota", "quota_scope", "nature")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RUN_BY_VALS = ("pre-commit", "pre-push", "gitea-ci", "github-ci", "npm", "无")

def fail(msg):
    print("  ❌ " + msg)

try:
    with open(inv_path, encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()
except OSError:
    print("  ❌ 清单不可读: %s" % inv_path)
    sys.exit(2)

# ── 段解析（本仓 YAML 子集；结构越界 ⇒ exit 2 判不了）──
sections = []          # [(name, start, body_lines, inline_value)]
cur = None
for i, ln in enumerate(lines):
    # 顶格键：`key:`（list 段）或 `key: value`（标量段，如 schema_version）
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$", ln)
    if m:
        if cur is not None:
            sections.append(cur)
        cur = [m.group(1), i, [], m.group(2).strip()]
        continue
    if cur is not None:
        cur[2].append(ln)
        continue
    if ln.strip() and not ln.strip().startswith("#"):
        print("  ❌ [schema] 首个段之前出现非注释内容（第 %d 行）—— 结构不可解析" % (i + 1))
        sys.exit(2)
if cur is not None:
    sections.append(cur)
if not sections:
    print("  ❌ [schema] 清单无任何顶格段（结构不可解析）")
    sys.exit(2)
names = [s[0] for s in sections]
dups = sorted({n for n in names if names.count(n) > 1})
if dups:
    print("  ❌ [schema] 顶格段重复: %s" % ", ".join(dups))
    sys.exit(2)

def rows_of(name, key, indent=2):
    """段内指定缩进层级的 `- key: v` 行组 → [dict]；段不存在 ⇒ None。
    缩进必须显式给：workflows 的 jobs 里也有 `- id:`，不限定层级会把 12 个 job 当成 workflow 行。"""
    for s in sections:
        if s[0] != name:
            continue
        out, cur_row = [], None
        row_re = re.compile(r"^%s-\s+%s:\s*(.*)$" % (" " * indent, re.escape(key)))
        field_re = re.compile(r"^%s([A-Za-z_]+):\s*(.*)$" % (" " * (indent + 2)))
        for ln in s[2]:
            m2 = row_re.match(ln)
            if m2:
                cur_row = {key: m2.group(1).strip().strip('"')}
                out.append(cur_row)
                continue
            m2 = field_re.match(ln)
            if m2 and cur_row is not None:
                cur_row[m2.group(1)] = m2.group(2).strip().strip('"')
        return out
    return None

viol = 0

# ── schema：段名白名单 ──
unknown = [n for n in names if n not in TOP_ALLOWED]
if unknown:
    fail("[schema] 出现白名单外的顶格段: %s（手工拼 YAML 拦截；新段须先入白名单）" % ", ".join(unknown))
    viol += 1
else:
    print("  ✅ [schema] 段名白名单：%d 个顶格段全部已登记（清单 %s）"
          % (len(names), ", ".join(names[:6]) + (" …" if len(names) > 6 else "")))

cls = rows_of("classification", "id", 2)
rb = rows_of("run_by", "entrypoint", 2)
gm = rows_of("gate_meta", "entrypoint", 4)
wf = rows_of("workflows", "id", 2)
if cls is None or rb is None or gm is None:
    missing = [n for n, v in (("classification", cls), ("run_by", rb), ("gate_meta", gm)) if v is None]
    print("  ❌ [schema] 缺段: %s（判不了账本结构）" % ", ".join(missing))
    sys.exit(2)
if not cls or not rb or not gm:
    print("  ❌ [schema] 段内 0 行（信号量==0 ⇒ 判不了）")
    sys.exit(2)

# ── schema：classification / run_by / gate_meta 必填与类型 ──
schema_bad = []
for idx, r in enumerate(cls):
    for f in CLS_FIELDS:
        if f not in r or r[f] == "":
            schema_bad.append("classification[%d] 缺/空 %s" % (idx, f))
    if r.get("class") not in ("P0", "P1", "P2"):
        schema_bad.append("classification[%d] class 非法: %r" % (idx, r.get("class")))
    if r.get("review_after") and not DATE_RE.match(r["review_after"]):
        schema_bad.append("classification[%d] review_after 非 YYYY-MM-DD: %r" % (idx, r.get("review_after")))
    if r.get("required_ci") not in ("true", "false"):
        schema_bad.append("classification[%d] required_ci 非布尔: %r" % (idx, r.get("required_ci")))
for idx, r in enumerate(rb):
    for f in RB_FIELDS:
        if f not in r or r[f] == "":
            schema_bad.append("run_by[%d] 缺/空 %s" % (idx, f))
    if r.get("run_by") not in RUN_BY_VALS:
        schema_bad.append("run_by[%d] run_by 非法: %r" % (idx, r.get("run_by")))
    if r.get("quota") not in ("true", "false"):
        schema_bad.append("run_by[%d] quota 非布尔: %r" % (idx, r.get("quota")))
for idx, r in enumerate(gm):
    for f in GM_FIELDS:
        if f not in r or r[f] == "":
            schema_bad.append("gate_meta[%d] 缺/空 %s" % (idx, f))
    if r.get("orphan") not in ("true", "false"):
        schema_bad.append("gate_meta[%d] orphan 非布尔: %r" % (idx, r.get("orphan")))
    if r.get("quota") not in ("true", "false"):
        schema_bad.append("gate_meta[%d] quota 非布尔: %r" % (idx, r.get("quota")))
    if r.get("quota_scope") not in ("doc", "non-doc", "bypass"):
        schema_bad.append("gate_meta[%d] quota_scope 非法: %r" % (idx, r.get("quota_scope")))
if schema_bad:
    for b in schema_bad[:8]:
        fail("[schema] " + b)
    if len(schema_bad) > 8:
        fail("[schema] … 其余 %d 条省略" % (len(schema_bad) - 8))
    viol += 1
else:
    print("  ✅ [schema] 必填/类型：classification %d 条／run_by %d 条／gate_meta %d 条 全合规"
          % (len(cls), len(rb), len(gm)))

# ── ① 配额恒等式（gate_meta 机械统计 ＋ QUOTA-SRC 对照）──
q_true = [r for r in gm if r.get("quota") == "true"]
c_non_doc = sum(1 for r in q_true if r.get("quota_scope") == "non-doc")
c_doc = sum(1 for r in q_true if r.get("quota_scope") == "doc")
c_byp = sum(1 for r in q_true if r.get("quota_scope") == "bypass")
got = {"quota_true": len(q_true), "non_doc": c_non_doc, "doc": c_doc, "bypass": c_byp}
bad1 = []
if got["quota_true"] != got["non_doc"] + got["doc"] + got["bypass"]:
    bad1.append("恒等式破：quota_true=%d ≠ non_doc %d ＋ doc %d ＋ bypass %d（=%d）"
                % (got["quota_true"], c_non_doc, c_doc, c_byp, c_non_doc + c_doc + c_byp))
for k in ("quota_true", "non_doc", "doc", "bypass"):
    if got[k] != EXPECT[k]:
        bad1.append("%s=%d ≠ W0 出口常量 %d（账本回退或被手改）" % (k, got[k], EXPECT[k]))
# 与 --quota 的 QUOTA-SRC 逐数字对照（禁只信自己算的）
m = re.match(r"^QUOTA-SRC:\s*quota_true=(\d+)\s+doc=(\d+)\s+non_doc=(\d+)\s+bypass=(\d+)\s+rows=(\d+)",
             src_line)
if not m:
    print("  ❌ [①配额恒等式] 无法解析 QUOTA-SRC 行: %r" % src_line)
    viol += 1
else:
    src = {"quota_true": int(m.group(1)), "doc": int(m.group(2)),
           "non_doc": int(m.group(3)), "bypass": int(m.group(4)), "rows": int(m.group(5))}
    for k in ("quota_true", "non_doc", "doc", "bypass"):
        if src[k] != got[k]:
            bad1.append("QUOTA-SRC 对照不一致：%s 生成侧=%d ／ 本件统计=%d" % (k, src[k], got[k]))
    if src["rows"] != len(gm):
        bad1.append("QUOTA-SRC rows=%d ≠ gate_meta 行数 %d" % (src["rows"], len(gm)))
if bad1:
    for b in bad1:
        fail("[①配额恒等式] " + b)
    viol += 1
else:
    print("  ✅ [①配额恒等式] quota_true=%d = non_doc %d ＋ doc %d ＋ bypass %d（QUOTA-SRC 对照一致；rows=%d）"
          % (got["quota_true"], got["non_doc"], got["doc"], got["bypass"], len(gm)))

# ── ② id 唯一（**按段口径**：每段内 id 不得重复；跨段历史账（gates/checkers/candidates）有意复用）──
#   为什么不是全清单唯一：本仓历史段 gates/checkers/candidates 与 classification 是**两本账**
#   （旧清单 vs 现行登记），跨段同 id 是历史事实而非账本两说；判「段内重复」才抓得到手拼错行。
sec_ids = {}
for s in sections:
    ids_s = []
    for ln in s[2]:
        m2 = re.match(r"^  - id:\s*(.*)$", ln)   # 只认 2 空格缩进的条目行（jobs 的 6 空格不算）
        if m2:
            ids_s.append(m2.group(1).strip().strip('"'))
    if ids_s:
        sec_ids[s[0]] = ids_s
bad2 = []
for name, ids_s in sec_ids.items():
    dup = sorted({x for x in ids_s if ids_s.count(x) > 1})
    for d in dup[:8]:
        bad2.append("段 %s 内重复 id: %s（出现 %d 次）" % (name, d, ids_s.count(d)))
if bad2:
    for b in bad2:
        fail("[②id 唯一] " + b)
    viol += 1
else:
    summary = "／".join("%s %d" % (k, len(v)) for k, v in sec_ids.items())
    print("  ✅ [②id 唯一] 各 id 段内无重复（%s）" % summary)

# ── ③ workflows：段存在 / n=10 / 四态合法 / 账外=0 ──
bad3 = []
if wf is None:
    bad3.append("缺 workflows: 段（W0 之后它是必需项；禁删段绕过）")
    wf = []
if len(wf) != WF_IDS_EXPECT:
    bad3.append("workflows 条数=%d（期望 %d）" % (len(wf), WF_IDS_EXPECT))
for r in wf:
    st = r.get("state", "")
    if st not in WF_STATES:
        bad3.append("%s state 非法: %r" % (r.get("id", "?"), st))
    elif st == "账外":
        bad3.append("%s state=账外（W0 出口判据＝无账外）" % r.get("id", "?"))
if bad3:
    for b in bad3[:8]:
        fail("[③workflows] " + b)
    viol += 1
else:
    dist = " ".join("%s=%d" % (s, sum(1 for r in wf if r.get("state") == s)) for s in WF_STATES)
    print("  ✅ [③workflows] n=%d（%s）账外=0" % (len(wf), dist))

sys.exit(1 if viol else 0)
PYEOF
)"; PY_RC=$?

# ── ⑥ ④ disk↔registry 双向对齐（复用 check-gate-inventory.sh 的判据，禁重复实现）──
INV_OUT="$(bash "$INV_CHECKER" --root "$ROOT" 2>&1)"; INV_RC=$?
[ "$INV_RC" -ne 2 ] || deg E_INTERNAL align "④ 判据单源判不了（check-gate-inventory rc=2）"

printf '%s\n' "$PY_OUT"
[ "$PY_RC" -eq 2 ] && deg E_SCHEMA parse "python 不变式判不了（清单结构超出本仓 YAML 子集）"
if [ "$INV_RC" -eq 0 ]; then
  echo "  ✅ [④disk↔registry] check-gate-inventory rc=0（双向对齐）"
else
  echo "  ❌ [④disk↔registry] check-gate-inventory rc=${INV_RC}"
  printf '%s\n' "$INV_OUT" | grep -E '❌' | head -5 | sed 's/^/     /'
fi

VIOL=$(printf '%s\n' "$PY_OUT" | grep -c '❌' || true)  # swallow-ok: 无 ❌ 时 grep 落空=0 条
[ "$INV_RC" -eq 0 ] || VIOL=$((VIOL + 1))
if [ "$VIOL" -gt 0 ]; then
  echo "GATE-INVENTORY-INVARIANT: VIOLATION ${VIOL}"
  exit 1
fi
echo "GATE-INVENTORY-INVARIANT: OK"
exit 0
