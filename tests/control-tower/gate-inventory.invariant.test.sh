#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gate-inventory.invariant.test.sh — 不变式伴生件判别性夹具（B3 · W0 附 · #1210）
#
# 覆盖矩阵（铁律 48 三路径 ＋ 判别性 ＋ 变异体）:
#   正常 — 真清单 ⇒ schema／①配额恒等式／②id 唯一／③workflows／④disk↔registry 五项全绿，
#          末行 `GATE-INVENTORY-INVARIANT: OK`、exit 0
#   失败 — 改坏①：gate_meta 一条 quota_scope non-doc→doc ⇒ ① 红（28→27／2→3），exit 1
#   失败 — 改坏②：classification 复制一条完整行（同 id）⇒ ② 红，exit 1
#   失败 — 改坏③：删 workflows: 段 ⇒ ③ 红（段缺失），exit 1
#   降级 — 清单不存在 ⇒ exit 2 ＋ degraded: E_INV_MISSING（判不了 ≠ 通过）
#   降级 — 缺 classification: 段 ⇒ exit 2（结构判不了）
#   只读 — 跑前/跑后清单字节级不变（本件承诺不写仓库件）
# 沙箱: mktemp -d（只写 /tmp）；变异体全部在 $TMPD，不碰仓内被跟踪文件。
# 配对件: scripts/control-tower/gate-inventory.invariant.sh（CT-40）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$REPO/scripts/control-tower/gate-inventory.invariant.sh"
INV="$REPO/docs/authority/GATE-INVENTORY.yaml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
export SYNO_GATE_DEGRADED_LOG="$TMPD/degraded.log"

echo "=== B3: gate-inventory.invariant.sh 不变式夹具 ==="
[ -f "$SUT" ] && ok "被测脚本存在" || { no "被测脚本缺失: $SUT"; echo "结果: $PASS 通过, $FAIL 失败"; exit 1; }
[ -f "$INV" ] && ok "被检查清单存在" || { no "清单缺失: $INV"; echo "结果: $PASS 通过, $FAIL 失败"; exit 1; }

# ── 正常：真清单五项全绿 ──
OUT="$(bash "$SUT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] \
   && printf '%s\n' "$OUT" | grep -q '✅ \[schema\] 段名白名单' \
   && printf '%s\n' "$OUT" | grep -q '✅ \[①配额恒等式\] quota_true=32 = non_doc 28 ＋ doc 2 ＋ bypass 2' \
   && printf '%s\n' "$OUT" | grep -q '✅ \[②id 唯一\]' \
   && printf '%s\n' "$OUT" | grep -q '✅ \[③workflows\] n=10' \
   && printf '%s\n' "$OUT" | grep -q '✅ \[④disk↔registry\] check-gate-inventory rc=0' \
   && printf '%s\n' "$OUT" | grep -q '^GATE-INVENTORY-INVARIANT: OK$'; then
  ok "正常: 五项全绿（schema／① 32=28+2+2／② id／③ workflows n=10／④ 对齐）＋ OK 末行"
else
  no "正常: 真清单未全绿（rc=${rc}）: $(printf '%s' "$OUT" | tr '\n' '|' | cut -c1-220)"
fi

# ── 只读承诺：跑前/跑后清单字节不变 ──
# 路径必须走 argv（MSYS 路径在 -c 字符串里不会被转成 Windows 路径；实测踩过）
SHA_CMD='import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())'
SHA_BEFORE="$(python3 -c "$SHA_CMD" "$INV")"
bash "$SUT" >/dev/null 2>&1 || true
SHA_AFTER="$(python3 -c "$SHA_CMD" "$INV")"
[ -n "$SHA_BEFORE" ] && [ "$SHA_BEFORE" = "$SHA_AFTER" ] \
  && ok "只读: 跑前/跑后清单 sha256 相同（本件不写仓库件）" \
  || no "只读: 清单被改动（${SHA_BEFORE:0:12} → ${SHA_AFTER:0:12}）"

# ── 失败（改坏①）：gate_meta 一条 quota_scope non-doc → doc ⇒ 恒等式红 ──
F1="$TMPD/inv-mut1.yaml"
python3 - "$INV" "$F1" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
lines = open(src, encoding="utf-8", newline="").read().split("\n")
st = next(i for i, l in enumerate(lines) if l.rstrip("\r") == "gate_meta:")
end = next((i for i in range(st + 1, len(lines)) if lines[i] and lines[i][0].isalpha() and lines[i].rstrip("\r").endswith(":")), len(lines))
done = False
i = st + 1
while i < end:
    if lines[i].rstrip("\r") == "      quota: true":
        j = i + 1
        while j < end and not lines[j].startswith("    - entrypoint:"):
            if lines[j].rstrip("\r") == "      quota_scope: non-doc":
                lines[j] = lines[j].replace("quota_scope: non-doc", "quota_scope: doc")
                done = True
                break
            j += 1
    if done:
        break
    i += 1
assert done, "fixture: no gate_meta quota:true/non-doc row found"
open(dst, "w", encoding="utf-8", newline="").write("\n".join(lines))
PY
OUT="$(bash "$SUT" --inv "$F1" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q '❌ \[①配额恒等式\]' \
   && printf '%s\n' "$OUT" | grep -q 'non_doc=27' ; then
  ok "改坏①: gate_meta 一条 non-doc→doc ⇒ ① 红（non_doc=27，常量 28）＋ exit 1"
else
  no "改坏①: 恒等式未变红（rc=${rc}）"
fi

# ── 失败（改坏②）：classification 复制一条完整行（同 id）⇒ id 唯一红 ──
F2="$TMPD/inv-mut2.yaml"
python3 - "$INV" "$F2" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
lines = open(src, encoding="utf-8", newline="").read().split("\n")
st = next(i for i, l in enumerate(lines) if l.rstrip("\r") == "classification:")
end = next(i for i in range(st + 1, len(lines)) if lines[i] and lines[i][0].isalpha() and lines[i].rstrip("\r").endswith(":") and not lines[i].startswith(" "))
row = next(i for i in range(st + 1, end) if lines[i].startswith("  - id:"))
j = row + 1
block = [lines[row]]
while j < end and not lines[j].startswith("  - id:"):
    block.append(lines[j])
    j += 1
lines[j:j] = block
open(dst, "w", encoding="utf-8", newline="").write("\n".join(lines))
PY
OUT="$(bash "$SUT" --inv "$F2" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q '❌ \[②id 唯一\]'; then
  ok "改坏②: classification 复制同 id 行 ⇒ ② 红 ＋ exit 1"
else
  no "改坏②: id 唯一性未变红（rc=${rc}）"
fi

# ── 失败（改坏③）：删 workflows: 段 ⇒ ③ 红 ──
F3="$TMPD/inv-mut3.yaml"
python3 - "$INV" "$F3" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
lines = open(src, encoding="utf-8", newline="").read().split("\n")
st = next(i for i, l in enumerate(lines) if l.rstrip("\r") == "workflows:")
end = next((i for i in range(st + 1, len(lines)) if lines[i] and lines[i][0].isalpha() and lines[i].rstrip("\r").endswith(":") and not lines[i].startswith(" ")), len(lines))
open(dst, "w", encoding="utf-8", newline="").write("\n".join(lines[:st] + lines[end:]))
PY
OUT="$(bash "$SUT" --inv "$F3" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q '❌ \[③workflows\] 缺 workflows: 段'; then
  ok "改坏③: 删 workflows: 段 ⇒ ③ 红（段缺失）＋ exit 1"
else
  no "改坏③: 缺段未变红（rc=${rc}）"
fi

# ── 降级：清单不存在 ⇒ exit 2 ＋ degraded ──
OUT="$(bash "$SUT" --inv "$TMPD/nonexistent.yaml" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'degraded: E_INV_MISSING'; then
  ok "降级: 清单不存在 ⇒ exit 2 ＋ degraded: E_INV_MISSING（判不了 ≠ 通过）"
else
  no "降级: 清单不存在未 fail-closed（rc=${rc}）"
fi

# ── 降级：缺 classification: 段 ⇒ exit 2（结构判不了）──
F4="$TMPD/inv-mut4.yaml"
python3 - "$INV" "$F4" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
lines = open(src, encoding="utf-8", newline="").read().split("\n")
st = next(i for i, l in enumerate(lines) if l.rstrip("\r") == "classification:")
end = next(i for i in range(st + 1, len(lines)) if lines[i] and lines[i][0].isalpha() and lines[i].rstrip("\r").endswith(":") and not lines[i].startswith(" "))
open(dst, "w", encoding="utf-8", newline="").write("\n".join(lines[:st] + lines[end:]))
PY
OUT="$(bash "$SUT" --inv "$F4" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q '缺段: classification'; then
  ok "降级: 缺 classification: 段 ⇒ exit 2（结构判不了 ⇒ 不猜）"
else
  no "降级: 缺 classification 未 fail-closed（rc=${rc}）"
fi

# ── 降级：清单结构坏（顶格段重复）⇒ exit 2 ──
F5="$TMPD/inv-mut5.yaml"
python3 - "$INV" "$F5" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
lines = open(src, encoding="utf-8", newline="").read().split("\n")
st = next(i for i, l in enumerate(lines) if l.rstrip("\r") == "classification:")
lines[st:st] = ["classification:"]
open(dst, "w", encoding="utf-8", newline="").write("\n".join(lines))
PY
OUT="$(bash "$SUT" --inv "$F5" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q '顶格段重复'; then
  ok "降级: 顶格段重复 ⇒ exit 2（结构坏 ⇒ 判不了）"
else
  no "降级: 段重复未 fail-closed（rc=${rc}）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
