#!/bin/bash
# T2.5 / #1147 — gen-gate-meta.sh 配对测试（全本地沙箱，不触网络）
#
# 覆盖（8 条主夹具 + 3 条集成/变异）：
#  ① --emit 真树 ⇒ rc=0，产出 gate_meta 且六字段齐全（rows=117）
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

echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
