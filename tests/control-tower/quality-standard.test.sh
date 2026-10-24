#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# tests/control-tower/quality-standard.test.sh — #841 P4-P0 标准 v1 的结构与可核性测试
#
# 一句话: 断言「标准 v1」不是空壳 —— G1–G6 每条五字段齐、「怎么判/红条件」带规则 ID 或
#         可执行命令、规则映射表在、登记表 3 行可校验、盘点表覆盖 100% ＋ 配对账 5/5；
#         并用**改坏两态**自证本测试有判别力（删「红条件」⇒ 必须判红）。
#
# 契约（铁律 47）:
#   @input  — docs/authority/quality-standard-g1g6.md          （标准，本批新建）
#             docs/authority/WIRING-REGISTRY.yaml             （登记表，本批新建）
#             docs/authority/GATE-INVENTORY.yaml              （盘点表，本批新建）
#             scripts/control-tower/quality-baseline.py       （扫描器，本批新建）
#             无参数；cwd 任意（仓根由脚本自身位置解析）
#   @output — 逐条 ✅/❌ ＋ 汇总；末行固定 `STANDARD-OK g=6 fields=5 rules=5`
#   @exit   — 0 = 全通过 ｜ 1 = 有违规（结构缺失/覆盖不足/配对账不齐）｜
#             2 = 检查自身失败或依赖件尚未落地（看不到 ⇒ 不得当通过，信号量==0 ⇒ 2）
#   @degraded — 扫描器/登记表/盘点表缺失 ⇒ 显式打印 pending ＋ rc=2（禁把"没落地"当"通过"）
#
# 判据来源（规格 §4）：J1（标准结构 ＋ 判别力）／J4（盘点覆盖 ＋ 配对）／J5（登记表 3 行）／J14（配对账）
# 反例自证：删「红条件」⇒ 判红 —— 在本测试的 mktemp 沙箱内做，绝不改仓内文件
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

STANDARD="$ROOT/docs/authority/quality-standard-g1g6.md"
REGISTRY="$ROOT/docs/authority/WIRING-REGISTRY.yaml"
INVENTORY="$ROOT/docs/authority/GATE-INVENTORY.yaml"
SCANNER="$ROOT/scripts/control-tower/quality-baseline.py"

FAIL=0
PENDING=0
NOTE() { printf '  %s %s\n' "$1" "$2"; }
pass() { NOTE "✅" "$1"; }
fail() { NOTE "❌" "$1"; FAIL=$((FAIL + 1)); }
pend() { NOTE "⏳" "$1"; PENDING=$((PENDING + 1)); }

# ── PYBIN 三级探测（windows-compat：python3 / python / py）──
PYBIN=""
for c in python3 python py; do
  if command -v "$c" >/dev/null 2>&1; then PYBIN="$c"; break; fi
done
if [ -z "$PYBIN" ]; then
  echo "FAIL 找不到 python（python3/python/py 均不可用）⇒ 信号量=0"
  echo "STANDARD-TEST rc=2"
  exit 2
fi

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/quality-standard-test.XXXXXX")" || {
  echo "FAIL mktemp 失败 ⇒ 信号量=0"; echo "STANDARD-TEST rc=2"; exit 2; }
cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────────
# 结构校验器（落沙箱，不在仓内建文件）：标准件 → rc 0/1/2
# ─────────────────────────────────────────────────────────────────────────────
cat > "$SANDBOX/struct_check.py" <<'PY'
# -*- coding: utf-8 -*-
"""标准件结构校验：6×5 字段齐 + 怎么判/红条件带规则 ID 或命令 + 映射表 + 三节齐。"""
import re
import sys

path = sys.argv[1]
try:
    text = open(path, encoding="utf-8").read()
except OSError as e:
    print("FAIL 读不到标准件: %s" % e)
    sys.exit(2)

FIELDS = ["判据定义", "怎么判（机械）", "红条件", "证据要求", "豁免条件"]
RULE = re.compile(r"\bT[1-5]\b")
CMD = re.compile(r"(scripts/[\w./-]+|docs/[\w./-]+|\bpython3\b|\bbash\s|\bnpx\b|git grep)")

errs = []
parts = re.split(r"^## ", text, flags=re.M)
secs = {}
for part in parts[1:]:
    m = re.match(r"^(G[1-6])\b", part)
    if m:
        secs[m.group(1)] = part

for g in ("G1", "G2", "G3", "G4", "G5", "G6"):
    if g not in secs:
        errs.append("缺 G 小节: %s" % g)


def block(body, title):
    """取某字段后面到下一个字段子弹前的正文；字段不存在返回 None。"""
    m = re.search(r"\*\*" + re.escape(title) + r"\*\*", body)
    if not m:
        return None
    rest = body[m.end():]
    nxt = re.search(r"\n\s*-\s+\*\*", rest)
    return rest[: nxt.start()] if nxt else rest


for g in ("G1", "G2", "G3", "G4", "G5", "G6"):
    if g not in secs:
        continue
    body = secs[g]
    for t in FIELDS:
        if ("**%s**" % t) not in body:
            errs.append("%s 缺字段「%s」" % (g, t))
    j = block(body, "怎么判（机械）")
    if j is not None and not (RULE.search(j) or CMD.search(j)):
        errs.append("%s 「怎么判（机械）」既无规则 ID 也无可执行命令" % g)
    r = block(body, "红条件")
    if r is not None:
        bullets = [l for l in r.splitlines() if re.match(r"\s*-\s+\S", l)]
        if not bullets:
            errs.append("%s 「红条件」为空（0 条）" % g)
        elif not (RULE.search(r) or CMD.search(r)):
            errs.append("%s 「红条件」既无规则 ID 也无可执行命令（不可机器判）" % g)

# 规则映射表（G1–G6 × T1–T5 都在）
if "## 规则映射表" not in text:
    errs.append("缺「规则映射表」小节")
else:
    mt = text.split("## 规则映射表", 1)[1].split("\n## ", 1)[0]
    for g in ("G1", "G2", "G3", "G4", "G5", "G6"):
        if not re.search(r"^\|\s*" + g + r"\s*\|", mt, re.M):
            errs.append("规则映射表缺 %s 行" % g)
    for t in ("T1", "T2", "T3", "T4", "T5"):
        if t not in mt:
            errs.append("规则映射表缺规则 %s" % t)

for sec in ("## 已知盲区", "## 新门禁准入", "## 失效条件"):
    if sec not in text:
        errs.append("缺 %s 小节" % sec)

if errs:
    for e in errs:
        print("FAIL " + e)
    print("STRUCT rc=1 g=%d fields=5 rules=5 errs=%d" % (len(secs), len(errs)))
    sys.exit(1)
print("STRUCT-OK g=6 fields=5 rules=5")
sys.exit(0)
PY

# ── 1. 标准件存在 ＋ 结构（6×5 字段 ＋ 规则 ID/命令 ＋ 映射表）──
echo "── 1. 标准结构 ──"
if [ ! -f "$STANDARD" ]; then
  fail "缺件 docs/authority/quality-standard-g1g6.md"
  echo "STANDARD-TEST rc=2 signal-zero=1"
  exit 2
fi
pass "docs/authority/quality-standard-g1g6.md"
"$PYBIN" "$SANDBOX/struct_check.py" "$STANDARD"
STRUCT_RC=$?
if [ "$STRUCT_RC" -eq 0 ]; then
  pass "结构：g=6 fields=5（判据定义/怎么判/红条件/证据要求/豁免条件）"
else
  fail "结构校验 rc=${STRUCT_RC}（逐条见上）"
fi

# ── 2. 反例自证（判别力）：改坏 ⇒ 必须判红（两态各给原始输出）──
echo "── 2. 反例自证（改坏必须判红）──"
"$PYBIN" - "$STANDARD" "$SANDBOX" <<'PY'
import re
import sys

src, outdir = sys.argv[1], sys.argv[2]
lines = open(src, encoding="utf-8").read().split("\n")

# 变体 A：删掉 G2 的「红条件」字段行 ⇒ 字段缺失
cur = None
a = []
for l in lines:
    m = re.match(r"^## (G[1-6])\b", l)
    if m:
        cur = m.group(1)
    if cur == "G2" and re.match(r"^- \*\*红条件\*\*", l):
        cur = "G2-done"
        continue
    a.append(l)
open(outdir + "/mut_a.md", "w", encoding="utf-8").write("\n".join(a))

# 变体 B：清空 G5「红条件」下的全部子弹 ⇒ 字段在但 0 条
in_g5 = in_red = False
b = []
for l in lines:
    if re.match(r"^## ", l):
        in_g5 = bool(re.match(r"^## G5\b", l))
        in_red = False
    if in_g5 and re.match(r"^- \*\*红条件\*\*", l):
        in_red = True
        b.append(l)
        continue
    if in_red:
        if re.match(r"^- \*\*", l):
            in_red = False
        elif re.match(r"^\s*-\s+\S", l):
            continue
    b.append(l)
open(outdir + "/mut_b.md", "w", encoding="utf-8").write("\n".join(b))
print("MUTANTS: mut_a=删 G2 红条件字段 / mut_b=清空 G5 红条件子弹")
PY

for m in mut_a mut_b; do
  out="$("$PYBIN" "$SANDBOX/struct_check.py" "$SANDBOX/$m.md" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "反例 $m 未被判红（判别力不足，rc=0）"
  else
    pass "反例 $m ⇒ rc=${rc}（改坏确实红）"
    printf '%s\n' "$out" | sed 's/^/       /' | head -3
  fi
done

# ── 3. 依赖件存在性（缺 ⇒ 看不见 ⇒ rc=2，不当通过）──
echo "── 3. 依赖件 ──"
MISSING=0
for f in "$REGISTRY" "$INVENTORY" "$SCANNER"; do
  if [ -f "$f" ]; then pass "${f#"$ROOT"/}"; else pend "缺件 ${f#"$ROOT"/}（本批未落地）"; MISSING=$((MISSING + 1)); fi
done
if [ "$MISSING" -ne 0 ]; then
  echo "STANDARD-TEST rc=2 pending=${PENDING}（依赖件未落地 ⇒ 信号量=0，禁当通过）"
  exit 2
fi

# ── 4. 登记表 3 行可校验（J5）──
echo "── 4. 登记表 ──"
REG_OUT="$("$PYBIN" "$SCANNER" --check-registry "$REGISTRY" 2>&1)"
REG_RC=$?
if [ "$REG_RC" -eq 0 ] && printf '%s\n' "$REG_OUT" | grep -q 'REGISTRY-OK rows=10'; then
  pass "登记表：$(printf '%s\n' "$REG_OUT" | tail -1)"
else
  fail "登记表校验失败 rc=${REG_RC}（期望 0 ＋ REGISTRY-OK rows=10）"
  printf '%s\n' "$REG_OUT" | tail -3 | sed 's/^/     /'
fi

# ── 5. 盘点覆盖 100% ＋ 配对账（J4 / J14）──
echo "── 5. 盘点表 ──"
INV_OUT="$("$PYBIN" "$SCANNER" --check-inventory "$INVENTORY" 2>&1)"
INV_RC=$?
INV_OK=1
for pat in \
  'covered=G12/12 B9/9 X7/7 S12/12 K35/35 R40/40' \
  'PAIRING-OK t1..t5=5/5' \
  'excluded_headers=19'
do
  if ! printf '%s\n' "$INV_OUT" | grep -qF "$pat"; then
    fail "盘点输出缺：$pat"
    INV_OK=0
  fi
done
if [ "$INV_RC" -eq 0 ] && [ "$INV_OK" -eq 1 ]; then
  pass "盘点：covered 6 段满 ＋ PAIRING-OK 5/5 ＋ excluded_headers=19"
  printf '%s\n' "$INV_OUT" | grep -E 'covered=|PAIRING-OK|excluded_headers|orphans=' | sed 's/^/     /'
else
  fail "盘点校验失败 rc=$INV_RC"
  printf '%s\n' "$INV_OUT" | tail -5 | sed 's/^/     /'
fi

# ── 汇总 ──
echo "──────────────────────────────────────────────"
if [ "$FAIL" -ne 0 ]; then
  echo "STANDARD-TEST rc=1 failures=$FAIL"
  exit 1
fi
echo "STANDARD-OK g=6 fields=5 rules=5"
exit 0
