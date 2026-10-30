#!/usr/bin/env bash
# gate-retirement-batch1.test.sh — 批1 退役台账结构校验（#1146）
# @input  docs/authority/GATE-INVENTORY.yaml 的 retired: 段
# @output 逐条 ✅/❌ ＋ 末行「结果: N 通过, M 失败」
# @exit   0 全过 / 1 有失败 / 2 判不了（python3 缺、台账缺失）
# @degraded 无
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INV="$ROOT/docs/authority/GATE-INVENTORY.yaml"
PYBIN="$(command -v python3 2>/dev/null)"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

[ -n "$PYBIN" ] || { echo "PYBIN 缺失 ⇒ 判不了 (exit 2)"; exit 2; }
[ -f "$INV" ] || { echo "台账缺失 ⇒ 判不了 (exit 2)"; exit 2; }

# assess <file> → 打印 SECTION/COUNT/ERR 行
assess() {
  "$PYBIN" - "$1" <<'PY'
import sys, re
p = sys.argv[1]
try:
    lines = open(p, encoding="utf-8").read().splitlines()
except Exception as e:
    print("SECTION=no"); print("COUNT=0"); print(f"ERR=1"); print(f"  E_READ: {e}"); sys.exit(0)
start = None
for i, l in enumerate(lines):
    if re.match(r"^retired:\s*$", l):
        start = i; break
if start is None:
    print("SECTION=no"); print("COUNT=0"); print("ERR=0"); sys.exit(0)
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
    if it.get("replacement") in ("none", "None", ""):
        if not it.get("evidence"):
            errs.append(f"  E_NO_EVIDENCE {iid} replacement=none")
print("SECTION=yes")
print(f"COUNT={len(items)}")
print(f"ERR={len(errs)}")
for e in errs:
    print(e)
PY
}

val() { printf '%s\n' "$1" | grep -m1 "^$2=" | cut -d= -f2-; }

echo "── 批1 退役台账（#1146）──"
OUT="$(assess "$INV")"
SEC="$(val "$OUT" SECTION)"; CNT="$(val "$OUT" COUNT)"; ERR="$(val "$OUT" ERR)"

[ "$SEC" = "yes" ] && ok "R1a retired 段存在" || no "R1a retired 段缺失"
[ "$CNT" = "8" ] && ok "R1b 条目数=8（实测 $CNT）" || no "R1b 条目数应为 8，实测 $CNT"
[ "$ERR" = "0" ] && ok "R2/R3 字段完整、reason≥10、replacement=none 均带 evidence" || { no "R2/R3 存在 $ERR 处违规"; printf '%s\n' "$OUT" | grep '^  E_' | head -6; }

TMP1="$(mktemp)"; TMP2="$(mktemp)"
"$PYBIN" - "$INV" "$TMP1" "$TMP2" <<'PY'
import sys, re
src, t1, t2 = sys.argv[1:4]
txt = open(src, encoding="utf-8").read()
lines = txt.splitlines(keepends=True)
# 变体1：删掉第一条 retired 记录
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
PY

OUT1="$(assess "$TMP1")"; OUT2="$(assess "$TMP2")"
CNT1="$(val "$OUT1" COUNT)"; ERR2="$(val "$OUT2" ERR)"
[ "$CNT1" = "8" ] && no "R4a 改坏未生效（删一条后仍 8 ⇒ 判据不承重）" || ok "R4a 改坏即红：删 1 条 ⇒ 条目=$CNT1 ≠ 8"
[ "$ERR2" = "0" ] && no "R4b 改坏未生效（reason 清空后 ERR=0 ⇒ 判据不承重）" || ok "R4b 改坏即红：reason 清空 ⇒ 违规 $ERR2 处"

rm -f "$TMP1" "$TMP2"
echo
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
