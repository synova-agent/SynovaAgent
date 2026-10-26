#!/bin/bash
# @requires python3
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
#   G5 — 覆盖率/重复率（#913 PR-3 · 调用方声索制）— 两态（E_COVERAGE exit2 / 无 src 不适用 rc0）｜A 档 30.0·29.9｜M 档 baseline±0.1｜E_BASELINE｜棘轮只升不降｜R5.2 advisory｜jscpd 缺失降级｜变异体 ×3
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

# ═══════════════════════════════════════════════════════════════════════════════
# G5 覆盖率＋重复率（#913 PR-3 · 裁 405/裁 402）—— 只判变更集 src/** .ts
#
#   武装制: 传 --coverage-summary/--coverage-sha/--baseline 之一才判；未传 ⇒ 显式 note＋exit 0
#   两态（裁 405-③）: a) 武装且有 src/** 而 coverage 缺失/缺条目 ⇒ degraded: E_COVERAGE ＋ exit 2
#                      b) 无 src/** ⇒ G5 不适用 ＋ exit 0（不得出 E_COVERAGE）
#   新鲜度: --coverage-sha 与 HEAD 不符/缺省 ⇒ degraded: E_COVERAGE-STALE ＋ exit 2
#   边界: A 档 30.0 过 / 29.9 红（裁 415） ｜ M 档 baseline=实测 过 / baseline +0.1 红 ｜ baseline 非法 ⇒ E_BASELINE
#   棘轮: --update-baseline 降⇒keep＋条目不变；升⇒打印 diff；默认检查模式对 baseline 零写入（sha256 前后同）
#   advisory: R5.2 >5% 仅 ⚠️ 不阻断（恰 5% 不报）｜ jscpd 缺失 ⇒ E_JSCPD-MISSING 且 R5.1 照判
#   回滚: SYNO_QD_G5=0 ⇒ G5-DISABLED（非静默），rules 回 G1,G3,G4，rc 按 G1/G3/G4
#   改坏必红: 变异体 ×3（坏 R5.1 阈值／坏 baseline 阈值／坏棘轮只升不降）⇒ 对应反例翻绿
#   隔离: 每例独立 mktemp 仓；夹具 JSON 运行时写进沙箱（不入库）；R5.2 走注入缝（不联网）
# ═══════════════════════════════════════════════════════════════════════════════
PYABS="$(command -v "$PYBIN")"
[ -n "$PYABS" ] || { echo "❌ python 不可解析（检查自身失败）"; exit 2; }
G5T="$TMPROOT/g5"; mkdir -p "$G5T"

sha_of() { # <file> → sha256（默认检查模式零写入断言用）
  "$PYABS" -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1" 2>/dev/null
}
runq_g5() { # <dir> [VAR=VAL ...] -- <args...>；--root 用物理绝对路径（coverage 键同为绝对路径）
  local d="$1"; shift
  local envs=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  if [ "$#" -gt 0 ]; then shift; fi
  local root; root="$( cd "$d" && pwd -P )"
  if [ "${#envs[@]}" -eq 0 ]; then
    RUN_OUT="$( cd "$d" && "$PYABS" "$SUT" --root "$root" "$@" 2>&1 )"; RUN_RC=$?
  else
    RUN_OUT="$( cd "$d" && env "${envs[@]}" "$PYABS" "$SUT" --root "$root" "$@" 2>&1 )"; RUN_RC=$?
  fi
}
cov_write() { # <out> <abs-path> <pct> [...]（§13 夹具：绝对路径键 ＋ total.lines.pct）
  local out="$1"; shift
  { printf '{"total": {"lines": {"pct": 50.0}}'
    while [ "$#" -ge 2 ]; do printf ', "%s": {"lines": {"pct": %s}}' "$1" "$2"; shift 2; done
    printf '}\n'
  } > "$out"
}
jscpd_empty() { printf '{"statistics": {"total": {"lines": 0}}, "duplicates": []}\n' > "$1"; }
jscpd_dup() { # <out> <变更集内相对路径> <重复行数> [<对照文件相对路径>]
  printf '{"statistics": {"total": {"lines": 0}}, "duplicates": [{"format": "typescript", "lines": %s, "fragment": "dup", "tokens": 0, "firstFile": {"name": "%s", "start": 1, "end": 1}, "secondFile": {"name": "%s", "start": 1, "end": 1}}]}\n' "$3" "$2" "${4:-src/svc/other.ts}" > "$1"
}
mk_g5_repo() { # <dir> —— mk_repo ＋ src/svc/m.ts ＋ baseline 种子（两次提交 ⇒ HEAD~1 可用）
  local d="$1"
  mk_repo "$d"
  ( cd "$d"
    mkdir -p src/svc
    printf 'export const m = 1;\n' > src/svc/m.ts
    printf '{\n  "schema_version": 1,\n  "entries": {}\n}\n' > docs/authority/coverage-baseline.json
    git add -A; git commit -q -m g5-base )
}
g5_sha() { ( cd "$1" && git rev-parse HEAD ); }
g5_modify_m() { ( cd "$1" && printf 'export const m = 1;\nexport const m2 = 2;\n' > src/svc/m.ts && git add -A ); }
g5_reg_declared() { # <dir> <rel-path> <capability> —— 新增 src 件登记 declared-only（G1 显式豁免）
  local d="$1" p="$2" cap="$3"
  cat > "$d/docs/authority/WIRING-REGISTRY.yaml" <<YAML
entries:
  - capability: $cap
    defined_at: "$p:1"
    provider: "$p:1"
    consumer: null
    test: null
    status: declared-only
    owner: P7
YAML
}
g5_baseline() { # <dir> <entries-json-body> —— 重写 baseline（<body> 如 '"src/svc/m.ts": 50.0'）
  printf '{"schema_version": 1, "entries": {%s}}\n' "$2" > "$1/docs/authority/coverage-baseline.json"
}
g5_entries_val() { # <baseline-file> <rel-path> → 打印条目值（无条目打印 MISSING）
  "$PYABS" -c 'import json,sys
try:
    d = json.load(open(sys.argv[1]))
    print(d.get("entries", {}).get(sys.argv[2], "MISSING"))
except Exception as e:
    print("ERR:%s" % e)' "$1" "$2" 2>/dev/null
}

echo ""
echo "── G5 覆盖率/重复率（#913 PR-3 · 只判变更集 src/** .ts）──"

# ── G5-1 正常：A 档 40.0 ＋ M 档 baseline=实测 ⇒ exit 0，末行 rules 含 G5 ──
D="$G5T/normal"; mk_g5_repo "$D"; g5_modify_m "$D"
( cd "$D" && printf 'export const a = 1;\n' > src/svc/new-a.ts )
g5_reg_declared "$D" "src/svc/new-a.ts" "svc.newA"
g5_baseline "$D" '"src/svc/m.ts": 50.0'
( cd "$D" && git add -A )
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/m.ts" 50.0 "$GROOT/src/svc/new-a.ts" 40.0
jscpd_empty "$D/jscpd.json"
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA"
assert_rc "$RUN_RC" 0 "G5-1 正常（A 档 40.0＋M 档 baseline=实测）⇒ exit 0"
printf '%s' "$RUN_OUT" | grep -q 'rules=G1,G3,G4,G5' && ok "G5-1 末行 rules 追加 G5" || no "G5-1 末行缺 rules=...G5: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q '❌ R5.1' && no "G5-1 正常态误报 R5.1" || ok "G5-1 正常态无 R5.1 违规"
printf '%s' "$RUN_OUT" | grep -q '✅ G5 覆盖率/重复率' && ok "G5-1 打印 ✅ G5 通过行" || no "G5-1 缺 ✅ G5 行: $RUN_OUT"

# ── G5-2a 两态 a：武装且含 src/** 而 coverage JSON 缺失 ⇒ E_COVERAGE exit 2 ──
D="$G5T/nocov"; mk_g5_repo "$D"; g5_modify_m "$D"
GSHA="$(g5_sha "$D")"
jscpd_empty "$D/jscpd.json"
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-sha "$GSHA"
assert_rc "$RUN_RC" 2 "G5-2a 武装＋含 src/** 而 coverage 缺失 ⇒ exit 2（fail-closed）"
printf '%s' "$RUN_OUT" | grep -q 'degraded: E_COVERAGE ' && ok "G5-2a 点名 degraded: E_COVERAGE" || no "G5-2a 未点名 E_COVERAGE: $RUN_OUT"

# ── G5-2b 两态 b：变更集不含 src/** ⇒ G5 不适用 exit 0（不得出 E_COVERAGE）──
D="$G5T/nosrc"; mk_repo "$D"
( cd "$D" && mkdir -p scripts && printf '#!/bin/bash\necho a\n' > scripts/x.sh
  git add -A; git commit -q -m b2
  printf '#!/bin/bash\necho b\n' > scripts/x.sh; git add -A )
jscpd_empty "$D/jscpd.json"
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged
assert_rc "$RUN_RC" 0 "G5-2b 无 src/** ⇒ exit 0（不适用 ≠ 看不见）"
printf '%s' "$RUN_OUT" | grep -q 'G5 覆盖率/重复率: 不适用' && ok "G5-2b 打印 G5 不适用说明" || no "G5-2b 缺不适用说明: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'E_COVERAGE' && no "G5-2b 误出 E_COVERAGE" || ok "G5-2b 无 E_COVERAGE（两态不混淆）"

# ── G5-2c 未武装（含 src/** 但不传 coverage 参数）⇒ 显式 note ＋ exit 0（不静默）──
D="$G5T/unarmed"; mk_g5_repo "$D"; g5_modify_m "$D"
runq_g5 "$D" -- --staged
assert_rc "$RUN_RC" 0 "G5-2c 未武装（含 src/** 不传 coverage 参数）⇒ exit 0"
printf '%s' "$RUN_OUT" | grep -q 'G5 未武装' && ok "G5-2c 打印『G5 未武装』note（不静默）" || no "G5-2c 缺未武装 note: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'rules=G1,G3,G4 ' && ok "G5-2c 未武装 ⇒ 末行 rules 不含 G5（裁 415-③：没判过不列）" || no "G5-2c 末行仍含 G5: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q '✅ G5' && no "G5-2c 未武装却打 ✅ G5（假绿）" || ok "G5-2c 未武装不打 ✅ G5"
printf '%s' "$RUN_OUT" | grep -q 'E_COVERAGE' && no "G5-2c 未武装却报 E_COVERAGE" || ok "G5-2c 未武装不判 coverage"

# ── G5-3 coverage 存在但缺该文件条目 ⇒ E_COVERAGE exit 2 ──
D="$G5T/noentry"; mk_g5_repo "$D"; g5_modify_m "$D"
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/other.ts" 99.0
jscpd_empty "$D/jscpd.json"
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA"
assert_rc "$RUN_RC" 2 "G5-3 coverage 缺该文件条目 ⇒ exit 2（应有未有）"
printf '%s' "$RUN_OUT" | grep -q 'degraded: E_COVERAGE ' && ok "G5-3 点名 degraded: E_COVERAGE" || no "G5-3 未点名 E_COVERAGE: $RUN_OUT"

# ── G5-4a 新鲜度：--coverage-sha HEAD~1 ⇒ E_COVERAGE-STALE exit 2 ──
D="$G5T/stale"; mk_g5_repo "$D"; g5_modify_m "$D"
GROOT="$( cd "$D" && pwd -P )"
cov_write "$D/cov.json" "$GROOT/src/svc/m.ts" 99.0
jscpd_empty "$D/jscpd.json"
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$( cd "$D" && git rev-parse HEAD~1 )"
assert_rc "$RUN_RC" 2 "G5-4a --coverage-sha HEAD~1 ⇒ exit 2（陈旧 JSON 不得假绿）"
printf '%s' "$RUN_OUT" | grep -q 'degraded: E_COVERAGE-STALE' && ok "G5-4a 点名 E_COVERAGE-STALE" || no "G5-4a 未点名 E_COVERAGE-STALE: $RUN_OUT"

# ── G5-4b 新鲜度：含 src/** 且未传 --coverage-sha ⇒ E_COVERAGE-STALE exit 2 ──
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json
assert_rc "$RUN_RC" 2 "G5-4b 未传 --coverage-sha ⇒ exit 2（fail-closed）"
printf '%s' "$RUN_OUT" | grep -q 'degraded: E_COVERAGE-STALE' && ok "G5-4b 点名 E_COVERAGE-STALE" || no "G5-4b 未点名 E_COVERAGE-STALE: $RUN_OUT"

# ── G5-5a A 档边界：新增件 39.9 ⇒ ❌ R5.1 exit 1 ──
D="$G5T/a399"; mk_g5_repo "$D"
( cd "$D" && printf 'export const b = 2;\n' > src/svc/new-b.ts )
g5_reg_declared "$D" "src/svc/new-b.ts" "svc.newB"
( cd "$D" && git add -A )
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/new-b.ts" 29.9
jscpd_empty "$D/jscpd.json"
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA"
assert_rc "$RUN_RC" 1 "G5-5a A 档 29.9 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R5.1' && ok "G5-5a 点名 ❌ R5.1" || no "G5-5a 未点名 R5.1: $RUN_OUT"

# ── G5-5b M 档边界：baseline 比实测高 0.1 ⇒ ❌ R5.1 exit 1 ──
D="$G5T/mfail"; mk_g5_repo "$D"; g5_modify_m "$D"
g5_baseline "$D" '"src/svc/m.ts": 50.1'
( cd "$D" && git add -A )
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/m.ts" 50.0
jscpd_empty "$D/jscpd.json"
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA"
assert_rc "$RUN_RC" 1 "G5-5b M 档 baseline+0.1 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R5.1' && ok "G5-5b 点名 ❌ R5.1" || no "G5-5b 未点名 R5.1: $RUN_OUT"

# ── G5-6 baseline 非法值（负/非数字/>100）⇒ E_BASELINE exit 2 ──
D="$G5T/badbl"; mk_g5_repo "$D"; g5_modify_m "$D"
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/m.ts" 55.0
jscpd_empty "$D/jscpd.json"
for BAD in '-1' '"abc"' '101'; do
  g5_baseline "$D" "\"src/svc/m.ts\": $BAD"
  runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA"
  assert_rc "$RUN_RC" 2 "G5-6 baseline=$BAD ⇒ exit 2"
  printf '%s' "$RUN_OUT" | grep -q 'E_BASELINE' && ok "G5-6 baseline=$BAD 点名 E_BASELINE" || no "G5-6 baseline=$BAD 未点名 E_BASELINE: $RUN_OUT"
done

# ── G5-7 棘轮：--update-baseline 只升不降；默认检查模式零写入 ──
D="$G5T/ratchet"; mk_g5_repo "$D"; g5_modify_m "$D"
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/m.ts" 55.0
jscpd_empty "$D/jscpd.json"
BL="$D/docs/authority/coverage-baseline.json"
g5_baseline "$D" '"src/svc/m.ts": 90.0'
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA" --update-baseline
assert_rc "$RUN_RC" 0 "G5-7 降向 --update-baseline ⇒ exit 0"
printf '%s' "$RUN_OUT" | grep -q 'keep src/svc/m.ts=90.00%' && ok "G5-7 降向打印 keep <path>=<旧值>" || no "G5-7 缺 keep 文案: $RUN_OUT"
[ "$(g5_entries_val "$BL" "src/svc/m.ts")" = "90.0" ] && ok "G5-7 降向条目不变（90.0）" || no "G5-7 降向条目被改: $(g5_entries_val "$BL" "src/svc/m.ts")"
printf '%s' "$RUN_OUT" | grep -q 'QUALITY-DELTA: BASELINE updated=0 kept=1' && ok "G5-7 降向末行 updated=0 kept=1" || no "G5-7 降向末行不合约: $RUN_OUT"
g5_baseline "$D" '"src/svc/m.ts": 50.0'
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA" --update-baseline
assert_rc "$RUN_RC" 0 "G5-7 升向 --update-baseline ⇒ exit 0"
printf '%s' "$RUN_OUT" | grep -q '↑ R5.1 baseline: src/svc/m.ts 50.00% → 55.00%' && ok "G5-7 升向打印 diff" || no "G5-7 升向缺 diff: $RUN_OUT"
[ "$(g5_entries_val "$BL" "src/svc/m.ts")" = "55.0" ] && ok "G5-7 升向条目升至 55.0" || no "G5-7 升向条目未升: $(g5_entries_val "$BL" "src/svc/m.ts")"
printf '%s' "$RUN_OUT" | grep -q 'QUALITY-DELTA: BASELINE updated=1 kept=0' && ok "G5-7 升向末行 updated=1 kept=0" || no "G5-7 升向末行不合约: $RUN_OUT"
H1="$(sha_of "$BL")"
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA"
H2="$(sha_of "$BL")"
assert_rc "$RUN_RC" 0 "G5-7 默认检查模式（baseline=实测 55.0）⇒ exit 0"
[ -n "$H1" ] && [ "$H1" = "$H2" ] && ok "G5-7 默认检查模式对 baseline 零写入（sha256 前后同）" || no "G5-7 检查模式写了 baseline: $H1 → $H2"

# ── G5-8a R5.2：重复率 >5% ⇒ 仅 ⚠️ advisory，rc=0、不进 violations ──
D="$G5T/dup"; mk_g5_repo "$D"
( cd "$D" && mkdir -p src/svc && for i in $(seq 1 20); do echo "export const v$i = $i;"; done > src/svc/dup.ts )
g5_reg_declared "$D" "src/svc/dup.ts" "svc.dup"
( cd "$D" && git add -A )
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/dup.ts" 100.0
jscpd_dup "$D/jscpd.json" "src/svc/dup.ts" 2
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA"
assert_rc "$RUN_RC" 0 "G5-8a 重复率 10% > 5% ⇒ exit 0（advisory 不阻断）"
printf '%s' "$RUN_OUT" | grep -q '⚠️ R5.2' && ok "G5-8a 打 ⚠️ R5.2 advisory" || no "G5-8a 缺 ⚠️ R5.2: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q '❌ R5.2' && no "G5-8a R5.2 被计入 violations" || ok "G5-8a R5.2 不进 violations"
printf '%s' "$RUN_OUT" | grep -q 'QUALITY-DELTA: PASS' && ok "G5-8a 末行仍 PASS（rc 不受影响）" || no "G5-8a 末行非 PASS: $RUN_OUT"

# ── G5-8b R5.2：恰 5% ⇒ 不报 ──
jscpd_dup "$D/jscpd.json" "src/svc/dup.ts" 1
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA"
assert_rc "$RUN_RC" 0 "G5-8b 重复率恰 5% ⇒ exit 0"
printf '%s' "$RUN_OUT" | grep -q 'R5.2: ' && no "G5-8b 恰 5% 仍报 R5.2" || ok "G5-8b 恰 5% 不报（>5 才报）"

# ── G5-9 jscpd 不可用（PATH 无 node/npx）⇒ E_JSCPD-MISSING 且 R5.1 照判 ──
D="$G5T/nojscpd"; mk_g5_repo "$D"
( cd "$D" && printf 'export const c = 3;\n' > src/svc/new-c.ts )
g5_reg_declared "$D" "src/svc/new-c.ts" "svc.newC"
( cd "$D" && git add -A )
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/new-c.ts" 80.0
runq_g5 "$D" "PATH=/usr/bin:/bin" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA"
assert_rc "$RUN_RC" 0 "G5-9 jscpd 缺失 ⇒ exit 0（不阻断）"
printf '%s' "$RUN_OUT" | grep -q 'degraded: E_JSCPD-MISSING' && ok "G5-9 点名 degraded: E_JSCPD-MISSING" || no "G5-9 未点名 E_JSCPD-MISSING: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'G5 覆盖率: 判 1 个' && ok "G5-9 R5.1 仍判（打印判 1 个）" || no "G5-9 R5.1 被整组跳过: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'R5.2 跳过（jscpd 不可用' && ok "G5-9 R5.2 整组跳过有痕" || no "G5-9 R5.2 跳过无痕: $RUN_OUT"

# ── G5-10 SYNO_QD_G5=0 ⇒ G5 整组跳过＋degraded: G5-DISABLED，rc 按 G1/G3/G4 ──
D="$G5T/g5off"; mk_g5_repo "$D"; g5_modify_m "$D"
runq_g5 "$D" "SYNO_QD_G5=0" -- --staged
assert_rc "$RUN_RC" 0 "G5-10 SYNO_QD_G5=0（无 coverage）⇒ exit 0（E_COVERAGE 系整组关）"
printf '%s' "$RUN_OUT" | grep -q 'degraded: G5-DISABLED' && ok "G5-10 点名 degraded: G5-DISABLED（非静默）" || no "G5-10 静默跳过: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'G5 覆盖率/重复率: 已禁用' && ok "G5-10 打印已禁用说明" || no "G5-10 缺已禁用说明: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'rules=G1,G3,G4 ' && ok "G5-10 末行 rules 回 G1,G3,G4（不含 G5）" || no "G5-10 末行 rules 未回滚: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'E_COVERAGE' && no "G5-10 开关关闭仍报 E_COVERAGE" || ok "G5-10 关了就不判 coverage（skip 语义）"
( cd "$D" && mkdir -p tests && printf 'expect(%s).toBe(true);\n' true > tests/g3.test.ts && git add -A )
runq_g5 "$D" "SYNO_QD_G5=0" -- --staged
assert_rc "$RUN_RC" 1 "G5-10 开关只关 G5：G3 违规仍 exit 1"
printf '%s' "$RUN_OUT" | grep -q 'R3.3' && ok "G5-10 点名 R3.3（G1/G3/G4 照判）" || no "G5-10 G3 未判: $RUN_OUT"

# ── G5-11 --json 输出含 g5:{checked,advisory,disabled} ──
D="$G5T/json"; mk_g5_repo "$D"; g5_modify_m "$D"
g5_baseline "$D" '"src/svc/m.ts": 50.0'
( cd "$D" && git add -A )
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/m.ts" 60.0
jscpd_empty "$D/jscpd.json"
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-summary cov.json --coverage-sha "$GSHA" --json
assert_rc "$RUN_RC" 0 "G5-11 --json ⇒ exit 0"
G5JSON="$(printf '%s' "$RUN_OUT" | "$PYABS" -c 'import json,sys
d = json.load(sys.stdin); g = d.get("g5") or {}
print("%s|%s|%s" % (g.get("checked"), g.get("advisory"), g.get("disabled")))' 2>/dev/null)"
[ "$G5JSON" = "1|0|False" ] && ok "G5-11 --json g5={checked:1,advisory:0,disabled:false}" || no "G5-11 --json g5 不符: '$G5JSON' 原文: $RUN_OUT"

# ── G5-12 改坏必红（变异体 ×3：坏 R5.1 阈值／坏 baseline 阈值／坏棘轮只升不降）──
mut_build() { # <out> <old> <new>；锚点找不到 ⇒ 非零（py 契约漂移 ⇒ 测试报红而非静默通过）
  "$PYABS" - "$SUT" "$1" "$2" "$3" <<'PYMUT'
import sys
src = open(sys.argv[1], encoding='utf-8').read()
old, new = sys.argv[3], sys.argv[4]
if old not in src:
    sys.stderr.write("mutation anchor not found\n"); sys.exit(3)
open(sys.argv[2], 'w', encoding='utf-8').write(src.replace(old, new, 1))
PYMUT
}
MUT51="$TMPROOT/mut-r51.py"
mut_build "$MUT51" 'if pct + 1e-9 < thr:' 'if False:  # MUT' && ok "G5-12 变异体① 构造（坏 R5.1 阈值比较）" || no "G5-12 变异体① 锚点漂移（py 契约变了，须重核）"
D="$G5T/a399"; GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
( cd "$D" && env SYNO_JSCPD_REPORT="$D/jscpd.json" "$PYABS" "$MUT51" --root "$GROOT" --staged --coverage-summary cov.json --coverage-sha "$GSHA" >/dev/null 2>&1 ); MRC=$?
[ "$MRC" -eq 0 ] && ok "G5-12 变异体① 坏阈值比较 ⇒ A 档 29.9 翻绿 rc=0 ⇒ R5.1 承重" || no "G5-12 变异体① 仍判红 rc=$MRC"
MUTBL="$TMPROOT/mut-baseline.py"
mut_build "$MUTBL" 'thr = base' 'thr = 0.0  # MUT（坏 baseline 阈值：忽略基线）' && ok "G5-12 变异体② 构造（坏 baseline 阈值）" || no "G5-12 变异体② 锚点漂移（py 契约变了，须重核）"
D="$G5T/mfail"; GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
( cd "$D" && env SYNO_JSCPD_REPORT="$D/jscpd.json" "$PYABS" "$MUTBL" --root "$GROOT" --staged --coverage-summary cov.json --coverage-sha "$GSHA" >/dev/null 2>&1 ); MRC2=$?
[ "$MRC2" -eq 0 ] && ok "G5-12 变异体② 坏 baseline 阈值 ⇒ baseline+0.1 翻绿 rc=0 ⇒ baseline 承重" || no "G5-12 变异体② 仍判红 rc=$MRC2"
MUTR="$TMPROOT/mut-ratchet.py"
mut_build "$MUTR" 'elif pct > old + 1e-9:' 'elif True:  # MUT' && ok "G5-12 变异体③ 构造（坏只升不降）" || no "G5-12 变异体③ 锚点漂移（py 契约变了，须重核）"
D="$G5T/mutratchet"; mk_g5_repo "$D"; g5_modify_m "$D"
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/m.ts" 55.0
jscpd_empty "$D/jscpd.json"
g5_baseline "$D" '"src/svc/m.ts": 90.0'
( cd "$D" && env SYNO_JSCPD_REPORT="$D/jscpd.json" "$PYABS" "$MUTR" --root "$GROOT" --staged --coverage-summary cov.json --coverage-sha "$GSHA" --update-baseline >/dev/null 2>&1 )
[ "$(g5_entries_val "$D/docs/authority/coverage-baseline.json" "src/svc/m.ts")" = "55.0" ] \
  && ok "G5-12 变异体③ 坏棘轮 ⇒ 降向被写入 55.0（条目翻降）⇒ 只升不降承重" \
  || no "G5-12 变异体③ 降向仍未写入（条目 $(g5_entries_val "$D/docs/authority/coverage-baseline.json" "src/svc/m.ts")）"

# ── G5-13 裁 415：M 档无基线 ⇒ 以当次实测入册并通过；再降 ⇒ 红 ──
D="$G5T/mnobase"; mk_g5_repo "$D"; g5_modify_m "$D"
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
cov_write "$D/cov.json" "$GROOT/src/svc/m.ts" 12.0
jscpd_empty "$D/jscpd.json"
g5_baseline "$D" ''
( cd "$D" && env SYNO_JSCPD_REPORT="$D/jscpd.json" "$PYABS" "$SUT" --root "$GROOT" --staged --coverage-summary cov.json --coverage-sha "$GSHA" --update-baseline >/dev/null 2>&1 )
[ "$(g5_entries_val "$D/docs/authority/coverage-baseline.json" "src/svc/m.ts")" = "12.0" ] \
  && ok "G5-13 M 档无基线 ⇒ 以实测 12.0 入册（不设 30% 地板）" \
  || no "G5-13 未入册 12.0（实际 $(g5_entries_val "$D/docs/authority/coverage-baseline.json" "src/svc/m.ts")）"
cov_write "$D/cov.json" "$GROOT/src/svc/m.ts" 11.0
( cd "$D" && env SYNO_JSCPD_REPORT="$D/jscpd.json" "$PYABS" "$SUT" --root "$GROOT" --staged --coverage-summary cov.json --coverage-sha "$GSHA" >/dev/null 2>&1 ); RC13=$?
[ "$RC13" -eq 1 ] && ok "G5-13 入册后降到 11.0 ⇒ exit 1（棘轮生效）" || no "G5-13 降向未红 rc=$RC13"


# ── G5-14（裁 422-R2）：--coverage-required 声索武装而 G5 未武装（src 变更在）⇒ E_COV_UNARMED exit 2 ──
D="$G5T/unarmed"; mk_g5_repo "$D"; g5_modify_m "$D"
( cd "$D" && git add -A )
GROOT="$( cd "$D" && pwd -P )"; GSHA="$(g5_sha "$D")"
jscpd_empty "$D/jscpd.json"
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged --coverage-required
assert_rc "$RUN_RC" 2 "G5-14 声索武装+src 变更+无摘要 ⇒ E_COV_UNARMED exit 2（禁把看不见当没问题）"
printf '%s' "$RUN_OUT" | grep -q 'E_COV_UNARMED' && ok "G5-14 点名 E_COV_UNARMED" || no "G5-14 缺 E_COV_UNARMED: $RUN_OUT"
# 对照：无 --coverage-required ⇒ 未武装 note、rc 0（既有声索制不回归）
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" -- --staged
assert_rc "$RUN_RC" 0 "G5-14 对照：无声索 ⇒ 未武装 note + rc 0（不回归）"
printf '%s' "$RUN_OUT" | grep -q 'G5 未武装' && ok "G5-14 对照打印未武装 note" || no "G5-14 对照缺未武装 note: $RUN_OUT"
# 对照：SYNO_QD_G5=0 回滚开关优先（即使误传 --coverage-required 也不炸）
runq_g5 "$D" "SYNO_JSCPD_REPORT=$D/jscpd.json" "SYNO_QD_G5=0" -- --staged --coverage-required
assert_rc "$RUN_RC" 0 "G5-14 对照：SYNO_QD_G5=0 回滚 ⇒ 整组跳过 rc 0（回滚语义优先）"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
