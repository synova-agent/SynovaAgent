#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-ledger-budget.sh — 台账三条判据（GATE-STANDARD v3.1 §十二 ⑥ ／ §十一 W5）
#
# 契约（铁律 47）:
#   @input  — 无位置参数；`--inv <path>` 台账（默认 <root>/docs/authority/GATE-INVENTORY.yaml）
#             `--root <dir>` 仓库根（默认 git toplevel）｜`--max-lines <n>` 行数上限（默认 800）
#             `--base <ref>` 当前基准（默认 env SYNO_LEDGER_BASE → `gitea/main` → `HEAD`）
#             `--json` 追加一行机读摘要｜`--strict` 违规时 exit 1（默认即 strict；
#             预留 `--advisory` = 违规仍 exit 0，仅供 pre-commit 软提示）
#   @output — 首行恒为 `LEDGER: lines=<n>/<max> dup_across_sections=<d> measured_at=<a> base=<b>`
#             每个违规一行 `LEDGER-VIOLATION: <code> — <细节>`
#   @exit   — 0 三条全通过 ｜ 1 违规 ｜ **2 判不了**（台账缺失／无 git／无 python／解析失败）
#             🔴 2 绝不等于通过（三态铁律）
#   @degraded — E_INV_MISSING / E_NO_GIT / E_NO_PYTHON / E_PARSE / E_BASE（stderr `degraded: <code> — …`）
#   @authority — 授权（explicit authority）: 任何本地会话／CI job／人工复核均可调用；**只读仓库事实**，
#             唯一副作用是 stdout/stderr；本件**不写台账、不改任何文件、不 git add/commit**
#             （台账是权威账，"怎么缩"由 W5 施工，本件只出数与点名）。
#
# 三条判据（逐条可复跑；判据源＝标准 §十二 ⑥）:
#   ① 行数 ≤ MAX-LINES（标准写 800）
#   ② **跨段无重复**：同一个键（`- id:` 或 `- entrypoint:`）不得出现在**多个顶层段**；
#      计 `dup_across_sections` = 跨段键数。⚠️ 台账历史是「同一 checker 在 classification／run_by／
#      gate_meta 各登记一次」的结构性重复 ⇒ 该数为**存量债**（W5 收口对象），不是本判据写错。
#   ③ `measured_at` ＝ 当前基准（比对 `git rev-parse --short=9 <base>`）。
#
# 设计哲学: **只出数与点名，不改台账** —— 台账是生成物/权威账，"怎么缩"是 W5 的施工，不是检查器的权力。
#
# 已知限制:
#   - 跨段重复只按 `id` / `entrypoint` 两种键计；其它键（如 path）不参与，避免误把"同路径不同登记面"算重复。
#   - 不判**同段内**重复（同段两次登记同一键）—— 当前实测为 0；若将来出现，本件会漏判（另卡）。
#   - `measured_at` 比对用 9 位短 sha：仓库若改用更长缩写，须同步此处（否则恒红）。
#
# 结构（Source map）:
#   段                    职责
#   ───────────────────   ────────────────────────────────────────────────
#   参数解析 / degrade     四个旗标 ＋ E_* 降级码（D1 三态、D2 @降级）
#   基准 ref 解析          SYNO_LEDGER_BASE → gitea/main → origin/main → HEAD
#   核心（内嵌 Python）    一次进程完成：段边界／键收集／跨段重复／measured_at 比对
#   输出与退出            首行摘要 ＋ 逐条 LEDGER-VIOLATION ＋ 0/1/2 三态
#
# 判别力自检（D4，改坏必红）: 见配对测试 `tests/control-tower/check-ledger-budget.test.sh`
#   ① 超行数 ⇒ 必红（L_LINES 点名）｜② 跨段重复 ⇒ 必红（L_DUP 点名键）｜③ measured_at 落后 ⇒ 必红
#   ④ 台账缺失 ⇒ exit 2（判不了≠通过）｜⑤ --advisory 下仍**照出违规行**（可见，不静默）。
#   反证：把任一条判据改成恒 false，对应用例即由 1 变 0 ⇒ 证明红是判据而非恒红。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true   # D732/D313 M5：与 check-gate-budget.sh 同形（复核挑出原来只有一半）

degrade() { # <CODE> <msg>  —— D2 契约：stderr 一行 + 追加 JSON 到 SYNO_GATE_DEGRADED_LOG
  echo "degraded: $1 — $2" >&2
  _dl="${SYNO_GATE_DEGRADED_LOG:-.codex/control-tower/logs/degraded-events.log}"
  mkdir -p "$(dirname "$_dl")" 2>/dev/null || true   # swallow-ok: 日志目录不可建不阻断降级本身
  printf '{"time":"%s","component":"check-ledger-budget","code":"%s","phase":"%s","retryable":false}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${2:-main}" >> "$_dl" 2>/dev/null || true   # swallow-ok: 落盘失败不改变 exit 2
  exit 2
}

ROOT=""; INV=""; MAX_LINES=800; BASE_REF=""; JSON=0; ADVISORY=0; MAX_DRIFT=30
while [ $# -gt 0 ]; do
  case "$1" in
    --inv) INV="${2:-}"; shift 2 ;;
    --inv=*) INV="${1#--inv=}"; shift ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    --root=*) ROOT="${1#--root=}"; shift ;;
    --max-lines) MAX_LINES="${2:-}"; shift 2 ;;
    --max-lines=*) MAX_LINES="${1#--max-lines=}"; shift ;;
    --max-drift) MAX_DRIFT="${2:-}"; shift 2 ;;
    --max-drift=*) MAX_DRIFT="${1#--max-drift=}"; shift ;;
    --base) BASE_REF="${2:-}"; shift 2 ;;
    --base=*) BASE_REF="${1#--base=}"; shift ;;
    --json) JSON=1; shift ;;
    --strict) ADVISORY=0; shift ;;   # 默认即 strict；显式旗标保留（与头注释一致，防"写了没实现"）
    --advisory) ADVISORY=1; shift ;;
    -h|--help) awk 'NR>1 && /^set -uo/{exit} NR>1' "$0"; exit 0 ;;
    *) degrade E_USAGE "未知参数: $1" ;;
  esac
done
case "$MAX_LINES" in ''|*[!0-9]*) degrade E_USAGE "--max-lines 须为正整数: ${MAX_LINES}" ;; esac
case "$MAX_DRIFT" in ''|*[!0-9]*) degrade E_USAGE "--max-drift 须为非负整数: ${MAX_DRIFT}" ;; esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -n "$ROOT" ] || ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] || degrade E_NO_GIT "非 git 仓库且未给 --root"
[ -n "$INV" ] || INV="$ROOT/docs/authority/GATE-INVENTORY.yaml"
[ -f "$INV" ] || degrade E_INV_MISSING "台账不存在: $INV"

PYBIN=""
for _c in python3 python py; do   # PYBIN 三级探测（D520：禁裸 python3；本行为探测循环，非裸调用）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || degrade E_NO_PYTHON "python3/python/py 均不可用"

# ── 基准 ref（测量"measured_at 是否等于当前基准"）──
if [ -z "$BASE_REF" ]; then
  for _r in "${SYNO_LEDGER_BASE:-}" gitea/main origin/main HEAD; do
    [ -n "$_r" ] || continue
    if git -C "$ROOT" rev-parse --verify --quiet "${_r}^{commit}" >/dev/null 2>&1; then BASE_REF="$_r"; break; fi
  done
fi
[ -n "$BASE_REF" ] || degrade E_BASE "无可解析的基准 ref（--base / SYNO_LEDGER_BASE / gitea/main / origin/main / HEAD 全失败）"
BASE_SHA="$(git -C "$ROOT" rev-parse --short=9 "${BASE_REF}^{commit}" 2>/dev/null)" || degrade E_BASE "base 不可解析: ${BASE_REF}"
[ -n "$BASE_SHA" ] || degrade E_BASE "base 短 sha 为空: ${BASE_REF}"

# ── #1296：measured_at 漂移量（>=0 = 台账落后代码多少个提交；-1 = 判不了/非祖先）──
_MEASURED="$(sed -n 's/^[[:space:]]*measured_at:[[:space:]]*\([^[:space:]\#]*\).*/\1/p' "$INV" 2>/dev/null | head -1)"   # swallow-ok: 台账不可读时由 E_PARSE 分支先行拦截
DRIFT=-1
if [ -n "$_MEASURED" ]; then
  if git -C "$ROOT" merge-base --is-ancestor "$_MEASURED" "$BASE_REF" 2>/dev/null; then   # swallow-ok: 非祖先由 drift=-1 显式判红
    DRIFT="$(git -C "$ROOT" rev-list --count "${_MEASURED}..${BASE_REF}" 2>/dev/null)" || DRIFT=-1
    case "$DRIFT" in ''|*[!0-9]*) DRIFT=-1 ;; esac
  fi
fi


OUT="$("$PYBIN" - "$INV" "$MAX_LINES" "$BASE_SHA" "$DRIFT" "$MAX_DRIFT" 2>"${ERRF:=/tmp/syno-ledger-err.$$}" <<'PYCORE'
import io, re, sys
from collections import defaultdict

inv, max_lines, base = sys.argv[1], int(sys.argv[2]), sys.argv[3]
drift, max_drift = int(sys.argv[4]), int(sys.argv[5])   # #1296：<measured>..<base> 的提交数
try:
    lines = io.open(inv, encoding="utf-8", errors="replace").read().splitlines()
except OSError as e:
    print("degraded: E_PARSE — 台账不可读: %s" % e, file=sys.stderr); sys.exit(2)

# 顶层段边界
secs = [(i, ln.strip().rstrip(":")) for i, ln in enumerate(lines)
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*:\s*$", ln)]
def sec_of(idx):
    cur = None
    for i, name in secs:
        if i <= idx: cur = name
        else: break
    return cur

key_secs = defaultdict(set)
for i, ln in enumerate(lines):
    m = re.match(r"^\s+-\s+id:\s*(\S+)\s*$", ln) or re.match(r"^\s+-\s+entrypoint:\s*(\S+)\s*$", ln)
    if m:
        key_secs[m.group(1).strip('"')].add(sec_of(i))

dup = {k: sorted(v) for k, v in key_secs.items() if len(v) > 1}
measured = ""
for ln in lines:
    m = re.match(r"^\s*measured_at:\s*([^\s#]+)", ln)
    if m: measured = m.group(1).strip('"')

# ── 字段齐全（#1296 · W5 例外 6）：dup 可被"改名"归零，字段面挡这条路 ──
# 为什么需要: 把 `- entrypoint:` 改名 `- path:` 就能让 dup 从 159 掉到 32（K3 实测），
#   因为判据只认两种键名。字段齐全检查让"改名"立刻在**缺字段**上红。
CLS_REQUIRED = ("id", "class", "owner", "review_after", "entrypoint", "required_ci")
RB_REQUIRED = ("entrypoint", "run_by", "quota")

def block_records(secname):
    """按顶层段取出 - 开头的记录块，返回 [(首键, {字段: 值})]"""
    recs, cur = [], None
    for i, ln in enumerate(lines):
        if sec_of(i) != secname:
            continue
        m = re.match(r"^\s*-\s+(\w+):\s*(.*?)\s*$", ln)
        if m:
            if cur: recs.append(cur)
            cur = {m.group(1): m.group(2).strip().strip('"')}
            continue
        if cur is None: continue
        m2 = re.match(r"^\s+(\w+):\s*(.*?)\s*$", ln)
        if m2 and m2.group(1) not in cur:
            cur[m2.group(1)] = m2.group(2).strip().strip('"')
    if cur: recs.append(cur)
    return recs

missing_fields = []
for rec in block_records("classification"):
    lack = [f for f in CLS_REQUIRED if not rec.get(f, "").strip()]
    if lack:
        missing_fields.append(("classification", rec.get("id") or rec.get("entrypoint") or "<无 id>", lack))
for rec in block_records("run_by"):
    lack = [f for f in RB_REQUIRED if not rec.get(f, "").strip()]
    if lack:
        missing_fields.append(("run_by", rec.get("entrypoint") or "<无 entrypoint>", lack))

n = len(lines)
viol = []
if n > max_lines:
    viol.append(("L_LINES", "台账 %d 行 > 上限 %d（超出 %d 行）" % (n, max_lines, n - max_lines)))
if dup:
    sample = "；".join("%s@%s" % (k, "/".join(v)) for k, v in list(dup.items())[:5])
    viol.append(("L_DUP", "跨段重复键 %d 个（同一键出现在多个顶层段）：%s%s" % (
        len(dup), sample, " …" if len(dup) > 5 else "")))
if missing_fields:
    sample = "；".join("%s:%s 缺 %s" % (s, k, ",".join(l)) for s, k, l in missing_fields[:5])
    viol.append(("L_FIELDS", "字段不全的记录 %d 条（rename 归零挡板）：%s%s" % (
        len(missing_fields), sample, " …" if len(missing_fields) > 5 else "")))

# ── measured_at（#1296 · 例外 7）：由"等于 base"改为"是 base 祖先且落后 ≤ max_drift 个提交" ──
# 为什么改: `--regen` 按设计保留旧 measured_at（防噪声）⇒ 旧判据**结构性常红**（永远 ≠ 新 base）。
# 判据改成"漂移量"，语义变成"台账数据落后代码多少"；需要锚定时用 `gen-gate-meta.sh --regen --stamp`。
if not measured:
    viol.append(("L_MEASURED_AT", "measured_at 缺失（无法判漂移）"))
else:
    if drift < 0:
        viol.append(("L_MEASURED_AT", "measured_at=%s 不是当前基准 %s 的祖先（drift=未知）⇒ 需 `gen-gate-meta.sh --regen --stamp` 重锚" % (measured, base)))
    elif drift > max_drift:
        viol.append(("L_MEASURED_AT", "measured_at=%s 落后当前基准 %s **%d 个提交** > 上限 %d ⇒ 需 `gen-gate-meta.sh --regen --stamp`" % (
            measured, base, drift, max_drift)))

print("LEDGER: lines=%d/%d dup_across_sections=%d missing_fields=%d drift=%d measured_at=%s base=%s" % (
    n, max_lines, len(dup), len(missing_fields), drift, measured or "<缺失>", base))
for code, msg in viol:
    print("LEDGER-VIOLATION: %s — %s" % (code, msg))
sys.exit(1 if viol else 0)
PYCORE
)"
RC=$?
[ -s "${ERRF:-/dev/null}" ] && { cat "${ERRF}" >&2; rm -f "${ERRF}"; }   # 降级/错因走 stderr（契约 @degraded）
[ -n "$OUT" ] && printf '%s\n' "$OUT"
case "$RC" in 0|1|2) ;; *) RC=2 ;; esac   # 归一：被信号杀等异常码一律按"判不了"（三态铁律）
[ "$RC" = 2 ] && exit 2
[ "$RC" != 0 ] || RC=0

if [ "$JSON" = 1 ]; then
  printf '{"lines":%s,"max_lines":%s,"rc":%s}\n' \
    "$(printf '%s' "$OUT" | sed -n 's/^LEDGER: lines=\([0-9]*\)\/.*/\1/p' | head -1)" \
    "$MAX_LINES" "$RC"
fi
if [ "$RC" != 0 ] && [ "$ADVISORY" = 1 ]; then
  exit 0   # 软提示模式：出数 + 点名，但不阻断（W5 收口前的过渡态）
fi
exit "$RC"
