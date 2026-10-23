#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-quality-delta.test.sh — #912 批 1 配对判据测试（CT-40；只读脚本 + mktemp 沙箱）
#
# 覆盖矩阵（铁律 48: 正常/降级/边界 + 改坏必红；ctrl-tower-change 模式 1: 三态 0/1/2）:
#   正常 — T4 新增能力件＋登记行＋生产调用点 ⇒ rc0 绿（G1 两态的正态）
#   降级 — T5 恒真断言（expect 布尔字面量）⇒ rc1（R3.3）｜T6 req.body.orgId ⇒ rc1（R4.1）
#          T7 出站无超时 ⇒ rc1（R4.3）｜T8 白名单棘轮被抬 ⇒ rc1（W-RATCHET）
#   边界 — T1 纯文档变更 ⇒ rc0 + SKIP（**A1：不适用 ≠ 看不见**）｜T2 坏 base ⇒ rc2
#          T3 只在 tests/ 引用 ⇒ rc1 点名 R1.2｜T10 登记表缺失 ⇒ rc2（E_REGISTRY）
#          T11 declared-only ⇒ rc0（A3 显式豁免，不红）
#   改坏必红 — T12 变异体（删 R4.1 检出 / 删 R3.3 恒真检出）⇒ 对应夹具翻绿 ⇒ 证明规则承重
#
# 隔离: 每个用例独立 mktemp 仓（git init + 本地身份），零网络、零宿主写入、不触真实仓库。
# 依赖: python3（与生产同契约；缺 ⇒ exit 2 —— 不静默当通过）
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$REPO/scripts/control-tower/check-quality-delta.py"
PC="$REPO/scripts/pre-commit-check.sh"
WF="$REPO/.gitea/workflows/local-gates.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
assert_rc() { if [ "$1" -eq "$2" ]; then ok "$3 (exit=$1)"; else no "$3 — exit=$1 期望 $2"; fi; }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "❌ 缺 python3（检查自身失败）"; exit 2; }
[ -f "$SUT" ] || { echo "❌ 缺被测件: $SUT"; exit 2; }

TMPROOT="$(mktemp -d)"; trap 'rm -rf "$TMPROOT"' EXIT

mk_repo() { # <dir> —— 含 registry/whitelist 的最小仓（base 提交为空）
  local d="$1"
  mkdir -p "$d/docs/authority"
  ( cd "$d"
    git init -q; git config user.email t@t; git config user.name t
    printf 'entries:\n' > docs/authority/WIRING-REGISTRY.yaml
    printf 'schema_version: 1\nratchet:\n  max_entries: 0\nentries: []\n' > docs/authority/quality-delta-whitelist.yaml
    printf '__pycache__/\n' > .gitignore
    git add -A; git commit -q -m base )
}
runq() { # <dir> <args...> → 输出（stdout+stderr），rc 存 RUN_RC
  local d="$1"; shift
  RUN_OUT="$( cd "$d" && "$PYBIN" "$SUT" --root . "$@" 2>&1 )"; RUN_RC=$?
}

echo "═══════════════════════════════════════════════════════════"
echo "  #912 批 1 · check-quality-delta（G1/G3/G4 · 只判变更集）"
echo "═══════════════════════════════════════════════════════════"

# ── T1 纯文档变更 ⇒ rc0 + SKIP（A1）──
D="$TMPROOT/t1"; mk_repo "$D"
( cd "$D" && mkdir -p docs/notes && echo "# 提案" > docs/notes/x.md && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 0 "T1 纯文档变更 ⇒ exit 0（A1：不适用 ≠ 看不见）"
printf '%s' "$RUN_OUT" | grep -q 'SKIP: 无代码变更' && ok "T1 打印 SKIP 语义" || no "T1 缺 SKIP 文案: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'QUALITY-DELTA: SKIP' && ok "T1 末行 QUALITY-DELTA: SKIP" || no "T1 末行不合约"

# ── T2 坏 base ⇒ rc2（fail-closed）──
D="$TMPROOT/t2"; mk_repo "$D"
( cd "$D" && mkdir -p src && echo 'export const a = 1;' > src/a.ts && git add -A )
runq "$D" --base no-such-ref-xyz
assert_rc "$RUN_RC" 2 "T2 坏 base ⇒ exit 2"
printf '%s' "$RUN_OUT" | grep -q 'E_BAD_BASE' && ok "T2 点名 E_BAD_BASE" || no "T2 未点名错误码: $RUN_OUT"

# ── T3 只在 tests/ 里 import 的新能力件 ⇒ rc1 点名 R1.2 ──
D="$TMPROOT/t3"; mk_repo "$D"
( cd "$D" && mkdir -p src/x tests/x
  printf 'export function newCap(): number { return 1; }\n' > src/x/new-cap.ts
  printf "import { newCap } from '../../src/x/new-cap';\nexpect(newCap()).toBe(1);\n" > tests/x/new-cap.test.ts
  git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T3 只在 tests/ 引用 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q 'R1.2' && ok "T3 点名 R1.2（无生产调用点）" || no "T3 未点名 R1.2: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'R1.1' && ok "T3 同时点名 R1.1（未登记）" || no "T3 未点名 R1.1: $RUN_OUT"

# ── T4 登记行 wired ＋ 生产调用点 ⇒ rc0（G1 两态的正态）──
D="$TMPROOT/t4"; mk_repo "$D"
( cd "$D" && mkdir -p src/x tests/x
  printf "import { newCap } from './new-cap';\nexport const v = newCap();\n" > src/x/caller.ts
  git add -A; git commit -q -m base2
  printf 'export function newCap(): number { return 1; }\n' > src/x/new-cap.ts
  printf "import { newCap } from '../../src/x/new-cap';\nexpect(newCap()).toBe(1);\n" > tests/x/new-cap.test.ts
  cat > docs/authority/WIRING-REGISTRY.yaml <<'YAML'
entries:
  - capability: x.newCap
    defined_at: "src/x/new-cap.ts:1"
    provider: "src/x/new-cap.ts:1"
    consumer: "src/x/caller.ts:1"
    test: "tests/x/new-cap.test.ts"
    status: wired
    owner: P4
YAML
  git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 0 "T4 有登记行＋生产调用点 ⇒ exit 0"

# ── T5 恒真断言（expect 布尔字面量）⇒ rc1（R3.3）──
D="$TMPROOT/t5"; mk_repo "$D"
( cd "$D" && mkdir -p tests
  printf 'expect(compute()).toBe(1);\n' > tests/a.test.ts
  git add -A; git commit -q -m base2
  printf 'expect(%s).toBe(true);\n' true > tests/a.test.ts
  git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T5 恒真断言 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q 'R3.3' && ok "T5 点名 R3.3（空壳断言）" || no "T5 未点名 R3.3: $RUN_OUT"

# ── T6 req.body.orgId ⇒ rc1（R4.1）──
D="$TMPROOT/t6"; mk_repo "$D"
( cd "$D" && mkdir -p src/routes
  printf 'const org = req.auth.orgId;\nres.json({ org });\n' > src/routes/r.ts
  git add -A; git commit -q -m base2
  printf 'const org = req.body.orgId;\nres.json({ org });\n' > src/routes/r.ts
  git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T6 req.body.orgId ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q 'R4.1' && ok "T6 点名 R4.1（租户来源）" || no "T6 未点名 R4.1: $RUN_OUT"
T6DIR="$D"

# ── T7 出站无超时 ⇒ rc1（R4.3）──
D="$TMPROOT/t7"; mk_repo "$D"
( cd "$D" && mkdir -p src/routes
  printf 'const org = req.auth.orgId;\nres.json({ org });\n' > src/routes/r.ts
  git add -A; git commit -q -m base2
  printf 'const r = await fetch("http://x");\nres.json({ r });\n' > src/routes/r.ts
  git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T7 出站无超时 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q 'R4.3' && ok "T7 点名 R4.3（无 AbortSignal/timeout）" || no "T7 未点名 R4.3: $RUN_OUT"

# ── T8 白名单棘轮被抬 ⇒ rc1（W-RATCHET，A3 只减不增）──
D="$TMPROOT/t8"; mk_repo "$D"
( cd "$D" && mkdir -p src/routes
  printf 'x\n' > src/routes/r.ts
  git add -A; git commit -q -m base2
  printf 'const org = req.body.orgId;\n' > src/routes/r.ts
  cat > docs/authority/quality-delta-whitelist.yaml <<'YAML'
schema_version: 1
ratchet:
  max_entries: 0
entries:
  - path: "src/routes/r.ts"
    rule: "R4.1"
    reason: "夹具：证明棘轮只减不增，条目超过上限即违规"
    ruling: "裁 330"
YAML
  git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T8 条目 1 > max_entries 0 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q 'W-RATCHET' && ok "T8 点名 W-RATCHET" || no "T8 未点名 W-RATCHET: $RUN_OUT"

# ── T10 登记表缺失 + 新增能力件 ⇒ rc2（E_REGISTRY，fail-closed）──
D="$TMPROOT/t10"; mk_repo "$D"
( cd "$D" && mkdir -p src/x
  printf 'export function cap10(): number { return 1; }\n' > src/x/cap10.ts
  rm -f docs/authority/WIRING-REGISTRY.yaml
  git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 2 "T10 登记表缺失 ⇒ exit 2"
printf '%s' "$RUN_OUT" | grep -q 'E_REGISTRY' && ok "T10 点名 E_REGISTRY" || no "T10 未点名 E_REGISTRY: $RUN_OUT"

# ── T11 declared-only ⇒ rc0（A3 显式豁免，不红）──
D="$TMPROOT/t11"; mk_repo "$D"
( cd "$D" && mkdir -p src/x
  printf 'export function cap11(): number { return 1; }\n' > src/x/cap11.ts
  cat > docs/authority/WIRING-REGISTRY.yaml <<'YAML'
entries:
  - capability: x.cap11
    defined_at: "src/x/cap11.ts:1"
    provider: "src/x/cap11.ts:1"
    consumer: null
    test: null
    status: declared-only
    owner: P4
YAML
  git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 0 "T11 declared-only ⇒ exit 0（显式豁免）"
printf '%s' "$RUN_OUT" | grep -q 'declared-only 1' && ok "T11 计数进棘轮打印" || no "T11 未打印 declared-only 计数: $RUN_OUT"

# ── T9 接线（生产接线，非自证）──
grep -q 'SYNO_QUALITY_DELTA' "$PC" && ok "T9 接线: pre-commit 读 SYNO_QUALITY_DELTA（回滚点）" || no "T9 接线: pre-commit 缺开关"
grep -q 'check-quality-delta.py' "$PC" && ok "T9 接线: pre-commit 真调扫描器" || no "T9 接线: pre-commit 未调用"
grep -q '①e' "$WF" && ok "T9 接线: CI 有 ①e 步" || no "T9 接线: CI 缺 ①e"
grep -cE '── 组 [0-9]+:' "$PC" | grep -qx '12' && ok "T9 组数不变（12 组；附加块不计组号）" || no "T9 组数漂移"

# ── T12 改坏即红（变异体：删规则 ⇒ 对应夹具翻绿 = 规则承重）──
MUT="$TMPROOT/mut.py"
"$PYBIN" - "$SUT" "$MUT" <<'PY'
import sys
src = open(sys.argv[1], encoding='utf-8').read()
# 去掉 R4.1 的检出（把 orgId|teamId|tenantId 改成永不命中的串）
src = src.replace(r'req\.body\.(orgId|teamId|tenantId)\b', r'req\.body\.(zzzNoMatch)\b')
# 去掉 R3.3 的恒真断言检出
src = src.replace(r'expect\(\s*(?:true|false)\s*\)', r'expect\(\s*(?:zzzNoMatch)\s*\)')
open(sys.argv[2], 'w', encoding='utf-8').write(src)
PY
( cd "$T6DIR" && "$PYBIN" "$MUT" --root . --staged >/dev/null 2>&1 ); MRC=$?
[ "$MRC" -eq 0 ] && ok "T12 变异体（删 R4.1 检出）⇒ T6 场景翻转 rc=0 ⇒ 规则承重" || no "T12 变异体仍判红（rc=$MRC）⇒ 规则可能空转"
runq "$TMPROOT/t5" --staged >/dev/null 2>&1
( cd "$TMPROOT/t5" && "$PYBIN" "$MUT" --root . --staged >/dev/null 2>&1 ); MRC2=$?
[ "$MRC2" -eq 0 ] && ok "T12 变异体（删 R3.3 恒真检出）⇒ T5 场景翻转 rc=0 ⇒ 规则承重" || no "T12 变异体仍判红（rc=$MRC2）⇒ 规则可能空转"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
