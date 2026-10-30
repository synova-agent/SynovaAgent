#!/bin/bash
# T2.5 / #1147 — gen-gate-meta.sh 配对测试（全本地沙箱，不触网络）
#
# 覆盖（①–⑪ 既有 12 断言 + ⑫–⑰ 配额双闸 / --emit 假绿防线）：
#  ① --emit 真树 ⇒ rc=0，产出 gate_meta 且六字段齐全（rows=120；追平 main 后）
#  ①b legacy_sections 已登记
#  ② --check 真树 ⇒ rc=0（同源一致）
#  ③ 手改某条 orphan（false→true）⇒ rc=1 并点名
#  ④ 删掉一条 rows 条目 ⇒ rc=1（行数不一致）
#  ⑤ 清单不可读 ⇒ rc=2（判不了，禁当通过）
#  ⑥ 无 run_by 段 ⇒ rc=2（无法机械判定）
#  ⑦ orphan=true 却 quota=true ⇒ rc=1（B1 非法组合）
#  ⑧ 变异体：把腿源读取改空 ⇒ orphan 暴涨（== rows）⇒ 断言红（证明 join 承重）
#  ⑨ check-gate-inventory 集成：gate_meta 与生成物不一致 ⇒ VIOLATION 1（R10）
#  ⑩ check-gate-inventory 集成：一致 ⇒ OK（无回归）
#  ⑪ 改坏即红：把 --check 的比对改成恒真（/tmp 副本）⇒ ③ 用例必须红
#  ⑫ --quota 真树：rc=1（超编）；non_doc=37/30、total=39/45、bypass=0/8、quota_true=39；
#     独立交叉核对 gate_meta 段 quota:true=39（整文件 79 = run_by 39 + gate_meta 39 + 注释 1）；
#     ⑫b --quota --json 三桶/rows/超编条目齐全
#  ⑬ 手改 artifact 的 quota（true→false 副本）：--check rc=1 且点名 B3；--quota 计数相应变小
#     （证明 --quota 的数字来自 artifact，不是重算 run_by）
#  ⑭ bypass 9 条夹具（artifact 副本）：--quota rc=1 + `bypass=9/8` + 逐条点名 9 条
#  ⑮ --emit 失败两态：(a) run_by 段零行夹具 ⇒ rc=2（E_EMIT_SHAPE）；
#     (b) TMPDIR=/nonexistent ⇒ rc=2（E_EMIT_TMP，写临时文件失败）
#  ⑯ quota_scope 非法 / 缺失 / quota 非布尔夹具 ⇒ --quota rc=2（E_QUOTA_SCOPE）；
#     ⑯b gate_meta 段缺失 ⇒ rc=2（E_GATE_META_MISSING）／段内 0 行 ⇒ rc=2（E_NO_ROWS）
#  ⑰ 改坏即红：副本把 non_doc >30 判断改恒假 ⇒ 31 条非文档夹具由 rc=1 变 rc=0（原断言失效，证明承重）
#  ⑰b 边界绿：non_doc=30（恰在限内）⇒ 原脚本 rc=0 且无 QUOTA-OVER（防恒红）
#
# 口径：三态 0/1/2；零失败 ⇒ exit 0
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$REPO/scripts/control-tower/gen-gate-meta.sh"
CGI="$REPO/scripts/control-tower/check-gate-inventory.sh"
INV="$REPO/docs/authority/GATE-INVENTORY.yaml"
[ -f "$GEN" ] || { echo "❌ 被测件不存在: $GEN"; exit 2; }
[ -f "$CGI" ] || { echo "❌ 检查器不存在: $CGI"; exit 2; }
[ -f "$INV" ] || { echo "❌ 清单不存在: $INV"; exit 2; }

PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

# ── ① --emit 真树 ────────────────────────────────────────────────────────
OUT="$(bash "$GEN" --emit --root "$REPO" --inv "$INV" 2>&1)"; RC=$?
ROWS=$(printf '%s\n' "$OUT" | grep -c '^    - entrypoint:')
SIX=$(printf '%s\n' "$OUT" | grep -cE '^      (class|run_by|orphan|quota|quota_scope|nature):')
if [ "$RC" -eq 0 ] && printf '%s\n' "$OUT" | grep -q '^gate_meta:' && [ "$ROWS" -ge 100 ] && [ "$SIX" -eq $((ROWS*6)) ]; then
  ok "① --emit：rc=0 / rows=$ROWS / 六字段×$ROWS=齐全"
else
  no "① --emit 异常：rc=$RC rows=$ROWS six=$SIX"
fi
ORPH=$(printf '%s\n' "$OUT" | grep -c '^      orphan: true')
LEGACY=$(printf '%s\n' "$OUT" | grep -c '^    - name: ')
QTRUE=$(printf '%s\n' "$OUT" | grep -c '^      quota: true')
[ "$LEGACY" -ge 6 ] && ok "①b legacy_sections 已登记（$LEGACY 段）" || no "①b legacy_sections 缺（$LEGACY）"

# ── ② --check 真树 ───────────────────────────────────────────────────────
bash "$GEN" --check --root "$REPO" --inv "$INV" >/dev/null 2>&1
[ $? -eq 0 ] && ok "② --check 真树一致 ⇒ rc=0" || no "② --check 真树不一致（应 0）"

# ── ③ 手改 orphan（false → true）──────────────────────────────────────────
cp "$INV" "$TMPD/inv3.yaml"
python3 - "$TMPD/inv3.yaml" <<'PY'
import re, sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().splitlines()
st = next(i for i, ln in enumerate(lines) if re.match(r"^gate_meta:\s*$", ln))
for i in range(st + 1, len(lines)):
    if lines[i].strip() == "orphan: false":
        lines[i] = "      orphan: true"
        break
open(p, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
PY
OUT="$(bash "$GEN" --check --root "$REPO" --inv "$TMPD/inv3.yaml" 2>&1)"; RC=$?
if [ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -q 'B3'; then
  ok "③ 手改 orphan ⇒ rc=1 且点名（B3）"
else
  no "③ 手改 orphan 未被识别：rc=$RC"
fi

# ── ④ 删一条 rows 条目 ────────────────────────────────────────────────────
cp "$INV" "$TMPD/inv4.yaml"
python3 - "$TMPD/inv4.yaml" <<'PY'
import sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().splitlines()
out, drop, dropped = [], False, 0
i = 0
while i < len(lines):
    if lines[i].startswith("    - entrypoint:") and dropped == 0:
        # 删该条目 7 行（entrypoint + 6 字段）
        i += 7; dropped += 1; continue
    out.append(lines[i]); i += 1
open(p, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
PY
bash "$GEN" --check --root "$REPO" --inv "$TMPD/inv4.yaml" >/dev/null 2>&1; RC=$?
[ "$RC" -eq 1 ] && ok "④ 删一条 ⇒ rc=1（行数不一致）" || no "④ 删条未识别：rc=$RC"

# ── ⑤ 清单不可读 ─────────────────────────────────────────────────────────
bash "$GEN" --check --root "$REPO" --inv "$TMPD/nope.yaml" >/dev/null 2>&1; RC=$?
[ "$RC" -eq 2 ] && ok "⑤ 清单不可读 ⇒ rc=2（判不了）" || no "⑤ 清单不可读 rc=$RC（应 2）"

# ── ⑥ 无 run_by 段 ───────────────────────────────────────────────────────
cp "$INV" "$TMPD/inv6.yaml"
python3 - "$TMPD/inv6.yaml" <<'PY'
import re, sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().splitlines()
out, skip = [], False
for ln in lines:
    if re.match(r"^run_by:\s*$", ln):
        skip = True; continue
    if skip and re.match(r"^[A-Za-z_][A-Za-z0-9_]*:", ln):
        skip = False
    if not skip:
        out.append(ln)
open(p, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
PY
bash "$GEN" --check --root "$REPO" --inv "$TMPD/inv6.yaml" >/dev/null 2>&1; RC=$?
[ "$RC" -eq 2 ] && ok "⑥ 无 run_by 段 ⇒ rc=2（无法机械判定）" || no "⑥ 无 run_by rc=$RC（应 2）"

# ── ⑦ orphan=true ∧ quota=true ───────────────────────────────────────────
cp "$INV" "$TMPD/inv7.yaml"
python3 - "$TMPD/inv7.yaml" <<'PY'
import re, sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().splitlines()
# 把 run_by 段里所有 run_by: 无 的条目的 quota 改成 true（制造 orphan∧quota）
st = next(i for i, ln in enumerate(lines) if re.match(r"^run_by:\s*$", ln))
for i in range(st + 1, len(lines)):
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*:", lines[i]):
        break
    if re.match(r'^run_by:\s*"?无"?$', lines[i].strip()):
        for j in range(i + 1, min(i + 4, len(lines))):
            if lines[j].strip() == "quota: false":
                lines[j] = "      quota: true"
                break
open(p, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
PY
OUT="$(bash "$GEN" --check --root "$REPO" --inv "$TMPD/inv7.yaml" 2>&1)"; RC=$?
if [ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -q 'B1'; then
  ok "⑦ orphan∧quota ⇒ rc=1（B1）"
else
  no "⑦ 非法组合未识别：rc=$RC"
fi

# ── ⑧ 变异体：腿源读取改空 ⇒ orphan 暴涨（证明 join 承重）────────────────
python3 - "$GEN" "$TMPD/gen_mut.sh" <<'PY'
import sys
s = open(sys.argv[1], encoding="utf-8").read()
s = s.replace('for leg in PRIORITY:', 'for leg in []:', 1)
open(sys.argv[2], "w", encoding="utf-8", newline="\n").write(s)
PY
cp "$REPO/scripts/control-tower/gate-assert.sh" "$TMPD/gate-assert.sh"
MUTROWS=$(bash "$TMPD/gen_mut.sh" --emit --root "$REPO" --inv "$INV" 2>/dev/null | grep -c '^    - entrypoint:' || true)
MUTORPH=$(bash "$TMPD/gen_mut.sh" --emit --root "$REPO" --inv "$INV" 2>/dev/null | grep -c '^      orphan: true' || true)
if [ "$MUTROWS" -gt 0 ] && [ "$MUTORPH" -eq "$MUTROWS" ] && [ "$ORPH" -lt "$MUTORPH" ]; then
  ok "⑧ 变异体（腿源置空）⇒ orphan=$MUTORPH/$MUTROWS（原 $ORPH）⇒ join 承重"
else
  no "⑧ 变异体未按预期（mutrows=$MUTROWS mutorph=$MUTORPH orig_orph=$ORPH）"
fi

# ── ⑨ / ⑩ check-gate-inventory 集成 ──────────────────────────────────────
OUT="$(bash "$CGI" --root "$REPO" 2>&1)"; RC=$?
printf '%s\n' "$OUT" | grep -q 'GATE-INVENTORY: OK' && [ "$RC" -eq 0 ] && ok "⑩ 集成：一致 ⇒ OK（rc=0）" || no "⑩ 集成回归：rc=$RC"

cp "$INV" "$TMPD/inv9.yaml"
python3 - "$TMPD/inv9.yaml" <<'PY'
import re, sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().splitlines()
st = next(i for i, ln in enumerate(lines) if re.match(r"^gate_meta:\s*$", ln))
for i in range(st + 1, len(lines)):
    if lines[i].strip() == "orphan: false":
        lines[i] = "      orphan: true"; break
open(p, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
PY
# 用同目录相对布局让检查器读到被改清单：以 --root 指向临时副本树
mkdir -p "$TMPD/root/docs/authority" "$TMPD/root/scripts/control-tower" "$TMPD/root/.gitea/workflows" "$TMPD/root/.github/workflows"
cp "$TMPD/inv9.yaml" "$TMPD/root/docs/authority/GATE-INVENTORY.yaml"
cp "$REPO/scripts/control-tower/"*.sh "$TMPD/root/scripts/control-tower/" 2>/dev/null
cp "$REPO/scripts/control-tower/"*.py "$TMPD/root/scripts/control-tower/" 2>/dev/null
cp "$REPO/scripts/pre-commit-check.sh" "$REPO/scripts/pre-push-check.sh" "$REPO/scripts/commit-msg-check.sh" "$TMPD/root/scripts/" 2>/dev/null
cp "$REPO/".gitea/workflows/*.yml "$TMPD/root/.gitea/workflows/" 2>/dev/null
cp "$REPO/".github/workflows/*.yml "$TMPD/root/.github/workflows/" 2>/dev/null
cp "$REPO/package.json" "$TMPD/root/package.json" 2>/dev/null
if [ ! -f "$TMPD/root/scripts/control-tower/gen-gate-meta.sh" ] || [ ! -f "$TMPD/root/scripts/control-tower/gate-assert.sh" ]; then
  no "⑨ 沙箱复制失败（生成器/归一库缺失），跳过集成断言"
else
OUT="$(bash "$CGI" --root "$TMPD/root" 2>&1)"; RC=$?
  if printf '%s\n' "$OUT" | grep -q 'R10'; then
    ok "⑨ 集成：gate_meta 不一致 ⇒ R10 违规（rc=$RC）"
  else
    no "⑨ 集成：不一致未报 R10（rc=$RC）"
  fi
fi

# ── ⑪ 改坏即红：--check 比对恒真 ⇒ ③ 必须红 ──────────────────────────────
python3 - "$GEN" "$TMPD/gen_bad.sh" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
s = s.replace("if want != have:", "if False:", 1)
open(dst, "w", encoding="utf-8", newline="\n").write(s)
PY
cp "$REPO/scripts/control-tower/gate-assert.sh" "$TMPD/gate-assert.sh" 2>/dev/null
bash "$TMPD/gen_bad.sh" --check --root "$REPO" --inv "$TMPD/inv3.yaml" >/dev/null 2>&1; RC=$?
[ "$RC" -eq 0 ] && ok "⑪ 改坏即红：比对恒真 ⇒ 原应为红的 ③ 变绿（证明断言承重）" || no "⑪ 变异体未按预期：rc=$RC"

# ═══ ⑫ 起：配额双闸（--quota）与 --emit 假绿防线 ═══════════════════════════════
# 夹具统一 $TMPD 沙箱（mktemp -d + EXIT trap）；篡改只发生副本，不触真清单。
# mangle <src> <dst> <op> <n>：按 gate_meta 行块机械篡改（op ∈ flip_quota_false /
# scope_bypass / scope_bad / scope_missing / quota_bad）；scope_bypass 另写 <dst>.eps
# 记录被改 entrypoint（逐条点名用）。
mangle() {
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import re, sys
src, dst, op, n = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
lines = open(src, encoding="utf-8").read().splitlines()
st = next(i for i, ln in enumerate(lines) if re.match(r"^gate_meta:\s*$", ln))
blocks, cur = [], None
for i in range(st + 1, len(lines)):
    ln = lines[i]
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*:", ln):
        break
    m = re.match(r"^    - entrypoint:\s*(.*)$", ln)
    if m:
        cur = {"ep": m.group(1).strip(), "idx": {}}
        blocks.append(cur)
        cur["idx"]["entrypoint"] = i
        continue
    if cur is not None:
        m2 = re.match(r"^      ([A-Za-z_]+):", ln)
        if m2:
            cur["idx"][m2.group(1)] = i

def field(b, name):
    if name not in b["idx"]:
        raise SystemExit("fixture: 行缺字段 %s（%s）" % (name, b["ep"]))
    return b["idx"][name]

if op == "flip_quota_false":
    used = 0
    for b in blocks:
        if used >= n:
            break
        if lines[field(b, "quota")].strip() == "quota: true" and lines[field(b, "quota_scope")].strip() == "quota_scope: non-doc":
            lines[field(b, "quota")] = "      quota: false"; used += 1
    if used != n:
        raise SystemExit("fixture: flip_quota_false 只改了 %d/%d" % (used, n))
elif op == "scope_bypass":
    used, eps = 0, []
    for b in blocks:
        if used >= n:
            break
        if lines[field(b, "quota")].strip() == "quota: true" and lines[field(b, "quota_scope")].strip() == "quota_scope: non-doc":
            lines[field(b, "quota_scope")] = "      quota_scope: bypass"; eps.append(b["ep"]); used += 1
    if used != n:
        raise SystemExit("fixture: scope_bypass 只改了 %d/%d" % (used, n))
    open(dst + ".eps", "w", encoding="utf-8", newline="\n").write("\n".join(eps) + "\n")
elif op == "scope_bad":
    lines[field(blocks[0], "quota_scope")] = "      quota_scope: bogus"
elif op == "scope_missing":
    del lines[field(blocks[0], "quota_scope")]
elif op == "quota_bad":
    lines[field(blocks[0], "quota")] = "      quota: yes"
else:
    raise SystemExit("fixture: 未知 op " + op)
open(dst, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
PY
}

# ── ⑫ --quota 真树：三桶计数 + 独立交叉核对 ─────────────────────────────
OUT="$(bash "$GEN" --quota --root "$REPO" --inv "$INV" 2>&1)"; RC=$?
Q_HIT=0
printf '%s\n' "$OUT" | grep -q '^QUOTA: non_doc=37/30（超编 7） total=39/45 bypass=0/8' && Q_HIT=$((Q_HIT+1))
printf '%s\n' "$OUT" | grep -q '^QUOTA-SRC: quota_true=39 doc=2 non_doc=37 bypass=0 rows=120' && Q_HIT=$((Q_HIT+1))
Q_OVER=$(printf '%s\n' "$OUT" | grep -c '^QUOTA-OVER: non-doc ')
# 独立交叉核对（不读被测命令输出）：gate_meta 段 39 ／ run_by 段 39 ／ 注释 1 ／ 整文件 79
GM_TRUE=$(sed -n '/^gate_meta:/,/^retired:/p' "$INV" | grep -c '^      quota: true')
RB_TRUE=$(sed -n '/^run_by:/,/^run_by_candidates:/p' "$INV" | grep -c '^    quota: true')
CMT_TRUE=$(grep -c '^#.*quota: true' "$INV")
ALL_TRUE=$(grep -c 'quota: true' "$INV")
if [ "$RC" -eq 1 ] && [ "$Q_HIT" -eq 2 ] && [ "$Q_OVER" -eq 37 ] \
   && [ "$GM_TRUE" -eq 39 ] && [ "$RB_TRUE" -eq 39 ] && [ "$CMT_TRUE" -eq 1 ] && [ "$ALL_TRUE" -eq 79 ]; then
  ok "⑫ --quota 真树 ⇒ rc=1；non_doc=37/30 total=39/45 bypass=0/8 quota_true=39 超编 37 条；交叉核对 gate_meta=39 + run_by=39 + 注释=1 = 整文件 79"
else
  no "⑫ --quota 真树异常（rc=$RC hit=$Q_HIT over=$Q_OVER gm=$GM_TRUE rb=$RB_TRUE cmt=$CMT_TRUE all=$ALL_TRUE）"
fi

# ⑫b --quota --json：机器行含三桶 / rows / 全部超编条目
OUT="$(bash "$GEN" --quota --json --root "$REPO" --inv "$INV" 2>&1)"; RC=$?
printf '%s\n' "$OUT" | tail -1 | python3 -c 'import json,sys; d=json.load(sys.stdin); assert (d["non_doc"],d["doc"],d["total"],d["bypass"],d["quota_true"],d["rows"])==(37,2,39,0,39,120) and len(d["over"])==37 and all(o["bucket"]=="non-doc" for o in d["over"])' 2>/dev/null \
  && ok "⑫b --quota --json：三桶/rows/超编条目齐全（37 条非文档）" || no "⑫b --quota --json 异常（rc=$RC）"

# ── ⑬ 手改 artifact 的 quota（true→false）：--check 点名 B3；--quota 变小 ────────
mangle "$INV" "$TMPD/inv13-quota.yaml" flip_quota_false 1
OUT="$(bash "$GEN" --check --root "$REPO" --inv "$TMPD/inv13-quota.yaml" 2>&1)"; RC=$?
C13=0
[ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -q '\[B3\]' && C13=$((C13+1))
OUT="$(bash "$GEN" --quota --root "$REPO" --inv "$TMPD/inv13-quota.yaml" 2>&1)"; RC=$?
printf '%s\n' "$OUT" | grep -q '^QUOTA: non_doc=36/30（超编 6） total=38/45 bypass=0/8' && C13=$((C13+1))
printf '%s\n' "$OUT" | grep -q '^QUOTA-SRC: quota_true=38 doc=2 non_doc=36 bypass=0 rows=120' && C13=$((C13+1))
if [ "$RC" -eq 1 ] && [ "$C13" -eq 3 ]; then
  ok "⑬ 手改 artifact quota=true→false：--check rc=1 点名 B3；--quota 计数 38/36（数字来自 artifact）"
else
  no "⑬ 手改 artifact 未按预期（--quota rc=$RC 命中=$C13/3）"
fi

# ── ⑭ bypass 9 条夹具：rc=1 + bypass=9/8 + 逐条点名 ─────────────────────────────
mangle "$INV" "$TMPD/inv14-bypass9.yaml" scope_bypass 9
OUT="$(bash "$GEN" --quota --root "$REPO" --inv "$TMPD/inv14-bypass9.yaml" 2>&1)"; RC=$?
C14=0
[ "$RC" -eq 1 ] && C14=$((C14+1))
printf '%s\n' "$OUT" | grep -q '^QUOTA: non_doc=28/30（超编 0） total=30/45 bypass=9/8' && C14=$((C14+1))
[ "$(printf '%s\n' "$OUT" | grep -c '^QUOTA-OVER: bypass ')" -eq 9 ] && C14=$((C14+1))
NAMED=0
while IFS= read -r ep; do
  [ -n "$ep" ] && printf '%s\n' "$OUT" | grep -qF "QUOTA-OVER: bypass $ep" && NAMED=$((NAMED+1))
done < "$TMPD/inv14-bypass9.yaml.eps"
[ "$NAMED" -eq 9 ] && C14=$((C14+1))
[ "$(printf '%s\n' "$OUT" | grep -c '^QUOTA-OVER: non-doc ')" -eq 0 ] && C14=$((C14+1))
if [ "$C14" -eq 5 ]; then
  ok "⑭ bypass 9 条夹具 ⇒ rc=1；bypass=9/8；逐条点名 9/9；非文档桶不再超编"
else
  no "⑭ bypass 夹具异常（rc=$RC 命中=$C14/5 named=$NAMED）"
fi

# ── ⑮ --emit 失败两态（假绿入口①）────────────────────────────────────────────
# (a) run_by 段零行夹具（保留段头、清空行级条目）⇒ rows=0 ⇒ E_EMIT_SHAPE rc=2
cp "$INV" "$TMPD/inv15-norows.yaml"
python3 - "$TMPD/inv15-norows.yaml" <<'PY'
import re, sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().splitlines()
out, skip = [], False
for ln in lines:
    if re.match(r"^run_by:\s*$", ln):
        out.append(ln); skip = True; continue
    if skip and re.match(r"^[A-Za-z_][A-Za-z0-9_]*:", ln):
        skip = False
    if not skip:
        out.append(ln)
open(p, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
PY
OUT="$(bash "$GEN" --emit --root "$REPO" --inv "$TMPD/inv15-norows.yaml" 2>&1)"; RC=$?
C15A=0
[ "$RC" -eq 2 ] && C15A=$((C15A+1))
printf '%s\n' "$OUT" | grep -q 'E_EMIT_SHAPE' && C15A=$((C15A+1))
[ "$C15A" -eq 2 ] && ok "⑮a run_by 零行夹具 ⇒ --emit rc=2（E_EMIT_SHAPE，空产出禁当成功）" || no "⑮a run_by 零行 rc=$RC（应 2/E_EMIT_SHAPE）"
# (b) TMPDIR 不可用 ⇒ mktemp 失败 ⇒ E_EMIT_TMP rc=2
OUT="$(TMPDIR=/nonexistent bash "$GEN" --emit --root "$REPO" --inv "$INV" 2>&1)"; RC=$?
C15B=0
[ "$RC" -eq 2 ] && C15B=$((C15B+1))
printf '%s\n' "$OUT" | grep -q 'E_EMIT_TMP' && C15B=$((C15B+1))
printf '%s\n' "$OUT" | grep -q '写临时文件失败' && C15B=$((C15B+1))
[ "$C15B" -eq 3 ] && ok "⑮b TMPDIR=/nonexistent ⇒ --emit rc=2（E_EMIT_TMP，写临时文件失败）" || no "⑮b TMPDIR 夹具 rc=$RC（应 2/E_EMIT_TMP）"

# ── ⑯ quota / quota_scope 非法或缺失 ⇒ rc=2（判不了 ≠ 通过）───────────────────
C16=0
for spec in "scope_bad:quota_scope 非法" "scope_missing:quota_scope 缺失" "quota_bad:quota 非布尔"; do
  op="${spec%%:*}"; label="${spec#*:}"
  mangle "$INV" "$TMPD/inv16-$op.yaml" "$op" 0
  OUT="$(bash "$GEN" --quota --root "$REPO" --inv "$TMPD/inv16-$op.yaml" 2>&1)"; RC=$?
  if [ "$RC" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'degraded: E_QUOTA_SCOPE'; then
    C16=$((C16+1)); echo "    · ⑯ $label ⇒ rc=2（E_QUOTA_SCOPE）"
  fi
done
[ "$C16" -eq 3 ] && ok "⑯ quota_scope 非法/缺失、quota 非布尔 ⇒ 均 rc=2（E_QUOTA_SCOPE）" || no "⑯ 非法夹具未全判 2（命中 $C16/3）"

# ⑯b gate_meta 段缺失 / 段内 0 行 ⇒ rc=2（E_GATE_META_MISSING / E_NO_ROWS）
cp "$INV" "$TMPD/inv16b-noseg.yaml"
python3 - "$TMPD/inv16b-noseg.yaml" <<'PY'
import re, sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().splitlines()
out, skip = [], False
for ln in lines:
    if re.match(r"^gate_meta:\s*$", ln):
        skip = True; continue
    if skip and re.match(r"^[A-Za-z_][A-Za-z0-9_]*:", ln):
        skip = False
    if not skip:
        out.append(ln)
open(p, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
PY
OUT="$(bash "$GEN" --quota --root "$REPO" --inv "$TMPD/inv16b-noseg.yaml" 2>&1)"; RC=$?
C16B=0
[ "$RC" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'E_GATE_META_MISSING' && C16B=$((C16B+1))
cp "$INV" "$TMPD/inv16b-norows.yaml"
python3 - "$TMPD/inv16b-norows.yaml" <<'PY'
import re, sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().splitlines()
out, skip, in_gm = [], False, False
for ln in lines:
    if re.match(r"^gate_meta:\s*$", ln):
        in_gm = True; out.append(ln); continue
    if in_gm and re.match(r"^[A-Za-z_][A-Za-z0-9_]*:", ln):
        in_gm = False; skip = False
    if in_gm and re.match(r"^  rows:\s*$", ln):
        skip = True; continue
    if not skip:
        out.append(ln)
open(p, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
PY
OUT="$(bash "$GEN" --quota --root "$REPO" --inv "$TMPD/inv16b-norows.yaml" 2>&1)"; RC=$?
[ "$RC" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'E_NO_ROWS' && C16B=$((C16B+1))
[ "$C16B" -eq 2 ] && ok "⑯b gate_meta 段缺失 ⇒ rc=2（E_GATE_META_MISSING）；段内 0 行 ⇒ rc=2（E_NO_ROWS）" || no "⑯b 段级夹具未全判 2（命中 $C16B/2）"

# ── ⑰ 改坏即红：non_doc >30 判断恒假 ⇒ 31 条夹具由红变绿 ────────────────────────
mangle "$INV" "$TMPD/inv17-non31.yaml" flip_quota_false 6
OUT="$(bash "$GEN" --quota --root "$REPO" --inv "$TMPD/inv17-non31.yaml" 2>&1)"; RC=$?
C17=0
[ "$RC" -eq 1 ] && C17=$((C17+1))
printf '%s\n' "$OUT" | grep -q '^QUOTA: non_doc=31/30（超编 1） total=33/45 bypass=0/8' && C17=$((C17+1))
[ "$(printf '%s\n' "$OUT" | grep -c '^QUOTA-OVER: non-doc ')" -eq 31 ] && C17=$((C17+1))
python3 - "$GEN" "$TMPD/gen_bad_quota.sh" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
old = 'if len(non_doc) > QUOTA_LIMITS["non_doc"]:'
new = 'if False:  # 改坏即红：>30 判断恒假'
if s.count(old) != 1:
    raise SystemExit("mutation anchor 命中 %d 次（应 1）" % s.count(old))
open(dst, "w", encoding="utf-8", newline="\n").write(s.replace(old, new))
PY
cp "$REPO/scripts/control-tower/gate-assert.sh" "$TMPD/gate-assert.sh"
OUTM="$(bash "$TMPD/gen_bad_quota.sh" --quota --root "$REPO" --inv "$TMPD/inv17-non31.yaml" 2>&1)"; MRC=$?
printf '%s\n' "$OUTM" | grep -q '^QUOTA: non_doc=31/30（超编 1） total=33/45 bypass=0/8' && C17=$((C17+1))
[ "$MRC" -eq 0 ] && C17=$((C17+1))
if [ "$C17" -eq 5 ]; then
  ok "⑰ 改坏即红：>30 恒假 ⇒ 31 条非文档夹具 rc 1→0（原断言失效，证明比较承重）"
else
  no "⑰ 改坏即红未按预期（原 rc=$RC 命中=$C17/5 mutant_rc=$MRC）"
fi

# ── ⑰b 边界绿：non_doc=30（恰在限内）⇒ rc=0 且无 QUOTA-OVER（防恒红）────────────
mangle "$INV" "$TMPD/inv17b-non30.yaml" flip_quota_false 7
OUT="$(bash "$GEN" --quota --root "$REPO" --inv "$TMPD/inv17b-non30.yaml" 2>&1)"; RC=$?
C17B=0
[ "$RC" -eq 0 ] && C17B=$((C17B+1))
printf '%s\n' "$OUT" | grep -q '^QUOTA: non_doc=30/30（超编 0） total=32/45 bypass=0/8' && C17B=$((C17B+1))
printf '%s\n' "$OUT" | grep -q '^QUOTA-SRC: quota_true=32 doc=2 non_doc=30 bypass=0 rows=120' && C17B=$((C17B+1))
[ "$(printf '%s\n' "$OUT" | grep -c '^QUOTA-OVER: ')" -eq 0 ] && C17B=$((C17B+1))
if [ "$C17B" -eq 4 ]; then
  ok "⑰b 边界绿：non_doc=30 ⇒ rc=0 且无 QUOTA-OVER（未超不得误红）"
else
  no "⑰b 边界异常（rc=$RC 命中=$C17B/4）"
fi

echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
