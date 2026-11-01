#!/usr/bin/env bash
# gate-retirement-batch1.test.sh — 退役台账结构校验（#1146 批1 ＋ #1219 W1 批2 扩面）
# @input  docs/authority/GATE-INVENTORY.yaml 的 retired: 段
#         （SYNO_RETIREMENT_INV 可覆盖路径，仅供 /tmp 变异自验；默认行为不变）
# @output 逐条 ✅/❌ ＋ 末行「结果: N 通过, M 失败」
# @exit   0 全过 / 1 有失败 / 2 判不了（python3 缺、台账缺失）
# @degraded 无
# 判据（R1–R4）:
#   R1a retired: 段存在 ｜ R1b 条目数 ≥8 且 id 无重复（动态，禁写死条数）
#   R2/R3 字段：path/date/observation_until/evidence 非空、reason≥10；
#         batch==1（#1146 的 8 条历史条目）replacement=none ⇒ evidence 非空（不补字段）；
#         batch==2（#1219 W1）另要求 absorbed_by/replacement 非空、reason≥10、
#         replacement=none ⇒ na_cmd 非空（可复跑负证据，防「退了不管」）
#   R4 改坏即红：R4a 删 1 条 ⇒ 条目 = 基准-1；R4b reason 清空 ⇒ 违规>0；
#         R4c 删 batch2 一条 evidence ⇒ 违规>0（三态两态各自可红）
# 沙箱: 变异体全写 /tmp（mktemp），不触仓库台账。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INV="${SYNO_RETIREMENT_INV:-$ROOT/docs/authority/GATE-INVENTORY.yaml}"
PYBIN="$(command -v python3 2>/dev/null)"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

[ -n "$PYBIN" ] || { echo "PYBIN 缺失 ⇒ 判不了 (exit 2)"; exit 2; }
[ -f "$INV" ] || { echo "台账缺失 ⇒ 判不了 (exit 2)"; exit 2; }

# assess <file> → 打印 SECTION/COUNT/IDS/DUP/ERR 行
assess() {
  "$PYBIN" - "$1" <<'PY'
import sys, re
p = sys.argv[1]
try:
    lines = open(p, encoding="utf-8").read().splitlines()
except Exception as e:
    print("SECTION=no"); print("COUNT=0"); print("IDS="); print("DUP=0"); print("ERR=1"); print(f"  E_READ: {e}"); sys.exit(0)
start = None
for i, l in enumerate(lines):
    if re.match(r"^retired:\s*$", l):
        start = i; break
if start is None:
    print("SECTION=no"); print("COUNT=0"); print("IDS="); print("DUP=0"); print("ERR=0"); sys.exit(0)
items, cur = [], None
for l in lines[start+1:]:
    if re.match(r"^[a-z_]+:\s*$", l):
        break
    m = re.match(r"^  - id:\s*(.+)$", l)
    if m:
        cur = {"id": m.group(1).strip()}
        items.append(cur); continue
    m = re.match(r"^    ([a-z_]+):\s*(.*)$", l)
    if m and cur is not None:
        cur[m.group(1)] = m.group(2).strip().strip('"')
errs = []
for it in items:
    iid = it.get("id", "?")
    for k in ("path", "date", "observation_until", "evidence"):
        if not it.get(k):
            errs.append(f"  E_EMPTY {iid}.{k}")
    reason = it.get("reason", "")
    if len(reason) < 10:
        errs.append(f"  E_REASON {iid} len={len(reason)}")
    repl = it.get("replacement")
    if it.get("batch") == "2":
        # W1 批2 扩面（#1219）：吸收方 ＋ 可复跑负证据；batch==1 历史条目不加这两项
        for k in ("absorbed_by", "replacement"):
            if not it.get(k):
                errs.append(f"  E_EMPTY {iid}.{k}")
        if repl in ("none", "None", "", None) and not it.get("na_cmd"):
            errs.append(f"  E_NO_NACMD {iid} replacement=none")
    elif repl in ("none", "None", ""):
        if not it.get("evidence"):
            errs.append(f"  E_NO_EVIDENCE {iid} replacement=none")
ids = [it.get("id", "") for it in items]
print("SECTION=yes")
print(f"COUNT={len(items)}")
print("IDS=" + "|".join(ids))
print(f"DUP={len(ids) - len(set(ids))}")
print(f"ERR={len(errs)}")
for e in errs:
    print(e)
PY
}

val() { printf '%s\n' "$1" | grep -m1 "^$2=" | cut -d= -f2-; }

echo "── 退役台账（#1146 批1 ＋ #1219 W1 批2）──"
OUT="$(assess "$INV")"
SEC="$(val "$OUT" SECTION)"; CNT="$(val "$OUT" COUNT)"; DUP="$(val "$OUT" DUP)"; ERR="$(val "$OUT" ERR)"
CNT="${CNT:-0}"; DUP="${DUP:-1}"; ERR="${ERR:-1}"

[ "$SEC" = "yes" ] && ok "R1a retired 段存在" || no "R1a retired 段缺失"
[ "$CNT" -ge 8 ] && [ "$DUP" = "0" ] \
  && ok "R1b 条目数=$CNT（动态，≥8）且 id 无重复" \
  || no "R1b 条目数=$CNT（应 ≥8）或 id 有重复（DUP=$DUP）"
[ "$ERR" = "0" ] \
  && ok "R2/R3 字段完整、reason≥10；批1 replacement=none ⇒ evidence；批2 absorbed_by/replacement 非空、replacement=none ⇒ na_cmd" \
  || { no "R2/R3 存在 $ERR 处违规"; printf '%s\n' "$OUT" | grep '^  E_' | head -6; }

TMP1="$(mktemp)"; TMP2="$(mktemp)"; TMP3="$(mktemp)"
"$PYBIN" - "$INV" "$TMP1" "$TMP2" "$TMP3" <<'PY'
import sys, re
src, t1, t2, t3 = sys.argv[1:5]
txt = open(src, encoding="utf-8").read()
lines = txt.splitlines(keepends=True)
# 变体1：删掉第一条 retired 记录（只删 `- id:` 行 ⇒ 该条不再计入条目数）
out, dropped, start = [], False, False
for l in lines:
    if re.match(r"^retired:\s*$", l):
        start = True; out.append(l); continue
    if start and re.match(r"^  - id:", l):
        if not dropped:
            dropped = True; continue
    out.append(l)
open(t1, "w", encoding="utf-8", newline="\n").write("".join(out))
# 变体2：把第一条 reason 清空
out2, start = [], False
for l in lines:
    if re.match(r"^retired:\s*$", l):
        start = True; out2.append(l); continue
    if start and re.match(r"^    reason:\s*", l):
        out2.append('    reason: ""\n'); start = False; continue
    out2.append(l)
open(t2, "w", encoding="utf-8", newline="\n").write("".join(out2))
# 变体3：删掉第一条 batch==2 条目的 evidence 行 ⇒ 批2 字段校验必须红
out3, start, cur_batch, done = [], False, None, False
for l in lines:
    if re.match(r"^retired:\s*$", l):
        start = True; out3.append(l); continue
    if start and re.match(r"^[a-z_]+:\s*$", l):
        start = False
    if start:
        if re.match(r"^  - id:", l):
            cur_batch = None
        mb = re.match(r"^    batch:\s*(\S+)\s*$", l)
        if mb:
            cur_batch = mb.group(1)
        if not done and cur_batch == "2" and re.match(r"^    evidence:", l):
            done = True
            continue
    out3.append(l)
if not done:
    raise SystemExit("fixture: 未找到 batch=2 的 evidence 行")
open(t3, "w", encoding="utf-8", newline="\n").write("".join(out3))
PY

OUT1="$(assess "$TMP1")"; OUT2="$(assess "$TMP2")"; OUT3="$(assess "$TMP3")"
CNT1="$(val "$OUT1" COUNT)"; ERR2="$(val "$OUT2" ERR)"; ERR3="$(val "$OUT3" ERR)"
CNT1="${CNT1:-0}"; ERR2="${ERR2:-0}"; ERR3="${ERR3:-0}"
EXPECT1=$((CNT - 1))
[ "$CNT1" = "$EXPECT1" ] && [ "$CNT1" != "$CNT" ] \
  && ok "R4a 改坏即红：删 1 条 ⇒ 条目=$CNT1 = 基准 $CNT - 1 ≠ $CNT（动态）" \
  || no "R4a 改坏未生效或被误判：删除后条目=$CNT1（应 $EXPECT1，基准 $CNT）"
[ "$ERR2" = "0" ] && no "R4b 改坏未生效（reason 清空后 ERR=0 ⇒ 判据不承重）" || ok "R4b 改坏即红：reason 清空 ⇒ 违规 $ERR2 处"
[ "$ERR3" = "0" ] && no "R4c 改坏未生效（删 batch2 evidence 后 ERR=0 ⇒ 判据不承重）" || ok "R4c 改坏即红：删 batch2 一条 evidence ⇒ 违规 $ERR3 处"

rm -f "$TMP1" "$TMP2" "$TMP3"
echo
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
