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
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8

DEGRADED=0
degrade() { # <CODE> <msg>
  echo "degraded: $1 — $2" >&2
  exit 2
}

ROOT=""; INV=""; MAX_LINES=800; BASE_REF=""; JSON=0; ADVISORY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --inv) INV="${2:-}"; shift 2 ;;
    --inv=*) INV="${1#--inv=}"; shift ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    --root=*) ROOT="${1#--root=}"; shift ;;
    --max-lines) MAX_LINES="${2:-}"; shift 2 ;;
    --max-lines=*) MAX_LINES="${1#--max-lines=}"; shift ;;
    --base) BASE_REF="${2:-}"; shift 2 ;;
    --base=*) BASE_REF="${1#--base=}"; shift ;;
    --json) JSON=1; shift ;;
    --advisory) ADVISORY=1; shift ;;
    -h|--help) awk 'NR>1 && /^set -uo/{exit} NR>1' "$0"; exit 0 ;;
    *) degrade E_USAGE "未知参数: $1" ;;
  esac
done
case "$MAX_LINES" in ''|*[!0-9]*) degrade E_USAGE "--max-lines 须为正整数: ${MAX_LINES}" ;; esac

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

OUT="$("$PYBIN" - "$INV" "$MAX_LINES" "$BASE_SHA" <<'PYCORE' 2>&1
import io, re, sys
from collections import defaultdict

inv, max_lines, base = sys.argv[1], int(sys.argv[2]), sys.argv[3]
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

n = len(lines)
viol = []
if n > max_lines:
    viol.append(("L_LINES", "台账 %d 行 > 上限 %d（超出 %d 行）" % (n, max_lines, n - max_lines)))
if dup:
    sample = "；".join("%s@%s" % (k, "/".join(v)) for k, v in list(dup.items())[:5])
    viol.append(("L_DUP", "跨段重复键 %d 个（同一键出现在多个顶层段）：%s%s" % (
        len(dup), sample, " …" if len(dup) > 5 else "")))
if measured != base:
    viol.append(("L_MEASURED_AT", "measured_at=%s ≠ 当前基准 %s" % (measured or "<缺失>", base)))

print("LEDGER: lines=%d/%d dup_across_sections=%d measured_at=%s base=%s" % (
    n, max_lines, len(dup), measured or "<缺失>", base))
for code, msg in viol:
    print("LEDGER-VIOLATION: %s — %s" % (code, msg))
sys.exit(1 if viol else 0)
PYCORE
)"
RC=$?
[ -n "$OUT" ] && printf '%s\n' "$OUT"
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
