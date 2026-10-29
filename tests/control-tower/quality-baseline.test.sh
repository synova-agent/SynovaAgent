#!/bin/bash
# @requires python3
# ═══════════════════════════════════════════════════════════════════════════════
# quality-baseline.test.sh — #841 P0 质量基线扫描器契约测试（配对测试）
#
# 覆盖（规格 §4 J3/J5/J6/J7/J8/J9 ＋ §4.2 R1–R5 判别力两态 ＋ 子命令 C1–C10b）:
#   1. 头契约（@input/@output/@exit/@degraded ＋ 已知限制）与 L8 例外登记
#   2. --selfcheck：判别力 1/1/1/1/1 clean=0；反向（T4 规则改回不查 return []）⇒ rc=1
#   3. --check-registry：真件 REGISTRY-OK rows=<真值>；反例（wired 无 consumer/多余键/坏行号/0 行/YAML 越界）
#      ＋ #1126 防回退：真件 reportMirrorPushes 的 defined_at 必须双引号、owner 非空；
#        改坏两态（去引号 ⇒ rc=2 E_YAML ／ 删 owner ⇒ rc=1 R3）
#   4. --check-inventory：合成夹具 covered/PAIRING 契约；10 个改坏两态（C1/C3/C4/C5/C6/C7/C9/C9b/C10×2）
#      ＋ #975 新增：E 态 gates 段缺失 rc=2；D 跨载体逐字相等（workflow ①i 步名 = 表 CI-S12 label）
#   5. --orphans-only：夹具 2/4 ＋ 真树格式（rc=0，不判红）
#   6. J3 确定性：两次 --write-baseline --out 副本 ⇒ 两次 shasum 相同；首跑 BOOTSTRAP
#   7. J6 三态：0=写基线 / 1=沙箱注入 T4 / 2=坏根目录（信号量==0）
#   8. J7 无绝对路径：产物 JSON grep = 0；JSON 字段/排序/末尾换行契约
#   9. J9 棘轮：沙箱注入 1 条 T4 vs 本仓基线 ⇒ rc=1 点名 path:line；回滚 ⇒ rc=0
#  10. R1–R5 判别力两态：每类「改坏前 totals=0」→「改坏后 +1 判红」→「改回 0」
#
# 用法: bash tests/control-tower/quality-baseline.test.sh
# 契约（铁律 47）:
#   @input  — 无参数；读仓内脚本/登记表/基线（只读）＋ 自建 mktemp 沙箱（可写）
#   @output — 每条断言 ✅/❌ ＋ 末行 TEST-OK pass=<n> fail=0（失败则末行 FAIL pass=<n> fail=<m>）
#   @exit   — 0 = 全部断言通过；1 = 有断言失败（真红）；2 = 环境失败（无 python/沙箱不可建）
#   @degraded — 无 python 解释器 / mktemp 不可用 ⇒ stderr 打印 "degraded:" 并 exit 2
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/control-tower/quality-baseline.py"
REGISTRY="$REPO_DIR/docs/authority/WIRING-REGISTRY.yaml"
BASELINE="$REPO_DIR/scripts/control-tower/quality-baseline.json"

# D732 UTF-8 强制（Windows 控制台/子进程统一 UTF-8）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

# PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）
PYBIN=""
for _cand in python3 python py; do
  if command -v "$_cand" >/dev/null 2>&1; then PYBIN="$_cand"; break; fi
done
if [ -z "$PYBIN" ]; then
  echo "degraded: 无 python 解释器（PYBIN 三级探测失败）" >&2
  exit 2
fi

if [ ! -f "$TOOL" ]; then
  echo "degraded: 扫描器不存在: $TOOL" >&2
  exit 2
fi
if [ ! -f "$REGISTRY" ]; then
  echo "degraded: 登记表不存在: $REGISTRY" >&2
  exit 2
fi
if [ ! -f "$BASELINE" ]; then
  echo "degraded: 基线不存在: $BASELINE" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/quality-baseline-test.XXXXXX")" || {
  echo "degraded: mktemp 不可用" >&2
  exit 2
}
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

assert_rc() {  # $1 期望 $2 实际 $3 描述
  if [ "$1" = "$2" ]; then pass "$3 (rc=$2)"; else fail "$3 — 期望 rc=$1 实际 rc=$2"; fi
}
assert_contains() {  # $1 文本 $2 字面 $3 描述
  if printf '%s' "$1" | grep -qF -- "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi
}
assert_not_contains() {
  if printf '%s' "$1" | grep -qF -- "$2"; then fail "$3 — 不应出现: $2"; else pass "$3"; fi
}
assert_eq() {  # $1 期望 $2 实际 $3 描述
  if [ "$1" = "$2" ]; then pass "$3"; else fail "$3 — 期望 [$1] 实际 [$2]"; fi
}

json_get() {  # $1 file $2 jq-like python expr（默认取 totals[rule]）
  "$PYBIN" -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); print(eval(sys.argv[2], {"d": d}))' "$1" "$2"
}

init_git_sandbox() {  # $1 dir
  git -C "$1" -c init.defaultBranch=main init -q \
    && git -C "$1" -c user.email=test@example.com -c user.name=test add -A \
    && git -C "$1" -c user.email=test@example.com -c user.name=test commit -qm fixture
}

echo "═══════════════════════════════════════════════════════════"
echo "  #841 quality-baseline 契约测试（PYBIN=${PYBIN}）"
echo "═══════════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 1. 头契约（@input/@output/@exit/@degraded ＋ 已知限制）──"
HEADER=$(sed -n '1,80p' "$TOOL")
assert_contains "$HEADER" "@input" "头注释含 @input"
assert_contains "$HEADER" "@output" "头注释含 @output"
assert_contains "$HEADER" "@exit" "头注释含 @exit"
assert_contains "$HEADER" "@degraded" "头注释含 @degraded"
assert_contains "$HEADER" "已知限制" "头注释含「已知限制」节"
assert_contains "$HEADER" "L8 R4 capability pattern" "已知限制登记 L8（R4 pattern 例外）"
grep -q "sys.stdout.reconfigure(encoding=\"utf-8\")" "$TOOL" \
  && pass "stdout 显式 UTF-8" || fail "stdout 未显式 UTF-8"
grep -q "from __future__" "$TOOL" && fail "禁用的 future 导入" || pass "无 future 导入（Python 3.9 直读）"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 2. --selfcheck 判别力自检（J8）──"
OUT=$("$PYBIN" "$TOOL" --selfcheck 2>&1); RC=$?
assert_rc 0 "$RC" "--selfcheck"
assert_contains "$OUT" "SELFCHECK-OK t1..t5=1/1/1/1/1 clean=0" "--selfcheck 字面结果行"

# J8 反向：把 T4 规则改回"不查 return []" ⇒ 自检必须 rc=1（判别力不足）
MUT_TOOL="$TMP_DIR/quality-baseline-mut.py"
"$PYBIN" - "$TOOL" "$MUT_TOOL" <<'PYEOF'
import sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
old = 'T4_RETURN_FORMS = ("return", "returnnull", "return[]", "returnfalse")'
new = 'T4_RETURN_FORMS = ("return", "returnnull", "returnfalse")'
assert old in text, "mutation anchor not found"
open(dst, "w", encoding="utf-8", newline="\n").write(text.replace(old, new))
PYEOF
MUT_OK=$?
assert_rc 0 "$MUT_OK" "反向变异体生成（T4 去掉 return[]）"
OUT=$("$PYBIN" "$MUT_TOOL" --selfcheck 2>&1); RC=$?
assert_rc 1 "$RC" "J8 反向：T4 规则退化 ⇒ 自检判红"
assert_contains "$OUT" "SELFCHECK-FAIL" "J8 反向输出点名 SELFCHECK-FAIL"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 3. --check-registry（J5 ＋ 反例）──"
OUT=$("$PYBIN" "$TOOL" --check-registry "$REGISTRY" 2>&1); RC=$?
assert_rc 0 "$RC" "--check-registry 真件"
REAL_ROWS=$(python3 "${REPO_ROOT}/scripts/control-tower/quality-baseline.py" --check-registry "${REPO_ROOT}/docs/authority/WIRING-REGISTRY.yaml" 2>/dev/null | tail -1 | sed -E "s/.*rows=([0-9]+).*/\1/")
[ -n "$REAL_ROWS" ] || REAL_ROWS=0
assert_contains "$OUT" "REGISTRY-OK rows=$REAL_ROWS" "末行 REGISTRY-OK rows=<真值>"
assert_contains "$OUT" "✅ R7" "R7 信号量（rows≥1）"

# #1126 防回退（真件钉死）：tool.reportMirrorPushes 的 defined_at 必须双引号包裹
# （裸 path:line 含 ':' ⇒ YAML 子集解析失败 ⇒ --check-registry 整器 rc=2），且 owner 非空（R3 必填；
# 归属依据 = DOCS-REGISTRY 的 DOC-0295 同属 #1034 ⇒ CTO）
RM_ENTRY=$(awk '/^  - capability: tool\.reportMirrorPushes$/{f=1} f{print} f&&/^    notes:/{exit}' "$REGISTRY")
assert_contains "$RM_ENTRY" 'defined_at: "scripts/control-tower/report-mirror-pushes.sh:15"' \
  "#1126 真件 defined_at 双引号包裹（裸标量即红）"
assert_contains "$RM_ENTRY" "owner: CTO" "#1126 真件 owner 非空（R3）"

REG_SRC="$REGISTRY"
reg_mutate() {  # $1 名称 $2 输出文件
  "$PYBIN" - "$1" "$2" "$REG_SRC" <<'PYEOF'
import sys
name, dst, src = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src, encoding="utf-8").read()
if name == "wired-no-consumer":
    out = text.replace('    consumer: "src/init/file-driven-loaders.ts:58"', "    consumer: null")
elif name == "zero-rows":
    out = "schema_version: 1\nrow_key: capability\nfields: []\nentries: []\n"
elif name == "extra-top-key":
    out = text.replace("schema_version: 1", "schema_version: 1\nextra_key: 1")
elif name == "flow-map":
    out = text.replace("schema_version: 1", "schema_version: {a: 1}")
elif name == "bad-line":
    out = text.replace('defined_at: "src/deploy/content-registry.ts:632"',
                       'defined_at: "src/deploy/content-registry.ts:99999"')
elif name == "bad-capability":
    out = text.replace("capability: content.initContentTypes", 'capability: "-bad"')
elif name == "extra-entry-key":
    out = text.replace('    notes: "boot', "    stray_key: 1\n    notes: \"boot")
elif name == "bare-scalar":
    # #1126：defined_at 去双引号 ⇒ 裸标量含 ':' ⇒ YAML 子集解析失败（整器 rc=2）
    out = text.replace(
        '    defined_at: "scripts/control-tower/report-mirror-pushes.sh:15"',
        "    defined_at: scripts/control-tower/report-mirror-pushes.sh:15")
elif name == "missing-owner":
    # #1126：删 owner ⇒ R3 required 字段非空判红（rc=1）
    out = text.replace(
        '    status: declared-only\n    owner: CTO\n'
        '    defined_at: "scripts/control-tower/report-mirror-pushes.sh:15"',
        '    status: declared-only\n'
        '    defined_at: "scripts/control-tower/report-mirror-pushes.sh:15"')
else:
    raise SystemExit("unknown registry mutation: " + name)
assert out != text, "mutation no-op: " + name
open(dst, "w", encoding="utf-8", newline="\n").write(out)
PYEOF
}
for m in wired-no-consumer zero-rows extra-top-key flow-map bad-line bad-capability extra-entry-key \
         bare-scalar missing-owner; do
  RF="$TMP_DIR/reg-$m.yaml"
  reg_mutate "$m" "$RF"
  OUT=$("$PYBIN" "$TOOL" --check-registry "$RF" 2>&1); RC=$?
  case "$m" in
    zero-rows|flow-map) assert_rc 2 "$RC" "registry 反例 ${m}（信号量/降级 ⇒ 2）" ;;
    bare-scalar) assert_rc 2 "$RC" "registry 反例 $m（#1126 裸标量 ⇒ YAML 降级 2）"
                 assert_contains "$OUT" "E_YAML" "#1126 裸标量点名 E_YAML"
                 assert_contains "$OUT" "裸标量含不支持的字符" "#1126 裸标量点名解析原因" ;;
    missing-owner) assert_rc 1 "$RC" "registry 反例 $m（#1126 owner 缺失 ⇒ R3）"
                   assert_contains "$OUT" "❌ R3" "#1126 owner 缺失点名 R3"
                   assert_contains "$OUT" ".owner" "#1126 owner 缺失点名 .owner" ;;
    wired-no-consumer) assert_rc 1 "$RC" "registry 反例 $m"; assert_contains "$OUT" "entries[0].consumer" "点名 entries[0].consumer" ;;
    extra-top-key) assert_rc 1 "$RC" "registry 反例 $m"; assert_contains "$OUT" "R1" "点名 R1" ;;
    bad-line) assert_rc 1 "$RC" "registry 反例 $m"; assert_contains "$OUT" "entries[0].defined_at" "点名 entries[0].defined_at" ;;
    bad-capability) assert_rc 1 "$RC" "registry 反例 $m"; assert_contains "$OUT" "R4" "点名 R4" ;;
    extra-entry-key) assert_rc 1 "$RC" "registry 反例 $m"; assert_contains "$OUT" "entries[0].stray_key" "点名 entries[0].stray_key" ;;
  esac
  if [ "$m" = "flow-map" ]; then
    assert_contains "$OUT" "degraded:" "YAML 越界 ⇒ degraded 字样"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 4. --check-inventory 合成夹具（C1–C10b 契约）──"
INV_DIR="$TMP_DIR/inv"
mkdir -p "$INV_DIR/scripts/control-tower" "$INV_DIR/.gitea/workflows"
cat > "$INV_DIR/scripts/pre-commit-check.sh" <<'FIXTURE_PC'
echo -e "${CYAN}── 组 1: Alpha ──${RESET}"
# ref: bash scripts/control-tower/check-alpha.sh
hard_check "cp one" "x"
# ── B1 banner ──
hard_check "cp two" "x"
# ═══ H1: header with cp ═══
soft_check "cp three" "x"
# ── K12-13 fixture banner ──
# ═══ H2: excluded header ═══
FIXTURE_PC
cat > "$INV_DIR/scripts/tool-helper.sh" <<'FIXTURE_HELPER'
#!/bin/bash
bash scripts/control-tower/check-beta.sh
FIXTURE_HELPER
for n in alpha beta gamma delta; do
  printf '#!/bin/bash\nexit 0\n' > "$INV_DIR/scripts/control-tower/check-$n.sh"
done
cat > "$INV_DIR/.gitea/workflows/local-gates.yml" <<'FIXTURE_WF'
name: fixture
on: [push]
jobs:
  gate:
    steps:
      - name: ①c content coupling fixture
        run: bash scripts/control-tower/check-alpha.sh
      - name: plain step
        run: echo ok
FIXTURE_WF
# #975 夹具：跨文件 workflow 引用（.github/workflows/ci.yml）——其行号与
# local-gates.yml 步序无关，引用位必须记 script:<rel>，禁止折算成 CI-S<n>
mkdir -p "$INV_DIR/.github/workflows"
cat > "$INV_DIR/.github/workflows/ci.yml" <<'FIXTURE_CI'
name: fixture-ci
on: [push]
jobs:
  ci:
    steps:
      - name: upstream ci step
        run: bash scripts/control-tower/check-beta.sh
FIXTURE_CI
cat > "$INV_DIR/inventory.yaml" <<'FIXTURE_INV'
schema_version: 1
meta:
  counts:
    groups: 1
  zero_hit_candidates: []
findings:
  - id: F1
    what: "K12-13 fixture 内容面耦合：无命名检查点（fixture 口径）"
    evidence: "E3 含该 banner；CI ①c 在册"
    owner: CTO
excluded_headers:
  - id: PC-X-0dfe02
    label_hash: "0dfe021b7853"
    reason: no_named_checkpoint
gates:
  - id: PC-G1
    kind: group
    line: 1
    label: "组 1: Alpha"
    label_hash: "761e5750a27b"
    occurrences: [1]
    what: "fixture 组 1"
    blocking: soft
    g_axis: [G1]
    checkpoints: ["cp one"]
    decision: keep
    reason: "fixture"
    replacement: ""
  - id: PC-B-192f1b
    kind: banner
    line: 4
    label: "B1 banner"
    label_hash: "192f1bc78291"
    occurrences: [4]
    what: "fixture banner"
    blocking: soft
    g_axis: [G2]
    checkpoints: ["cp two"]
    decision: keep
    reason: "fixture"
    replacement: ""
  - id: PC-X-4570a9
    kind: header
    line: 6
    label: "H1: header with cp"
    label_hash: "4570a933928e"
    occurrences: [6]
    what: "fixture header"
    blocking: soft
    g_axis: [G6]
    checkpoints: ["cp three"]
    decision: keep
    reason: "fixture"
    replacement: ""
  - id: CI-S1
    kind: step
    line: 6
    label: "①c content coupling fixture"
    label_hash: "0ddc26409d01"
    occurrences: [6]
    what: "fixture CI step"
    blocking: soft
    g_axis: [G6]
    checkpoints: []
    decision: keep
    reason: "fixture"
    replacement: ""
  - id: CI-S2
    kind: step
    line: 8
    label: "plain step"
    label_hash: "9c3750b3669b"
    occurrences: [8]
    what: "fixture CI step"
    blocking: soft
    g_axis: [G6]
    checkpoints: []
    decision: keep
    reason: "fixture"
    replacement: ""
checkers:
  - id: CT-check-alpha
    path: scripts/control-tower/check-alpha.sh
    wired_to: [CI-S1, PC-G1]
    orphan: false
    blocking: false
    decision: keep
    reason: "fixture"
    replacement: ""
  - id: CT-check-beta
    path: scripts/control-tower/check-beta.sh
    wired_to: ["script:.github/workflows/ci.yml", "script:scripts/tool-helper.sh"]
    orphan: false
    blocking: false
    decision: keep
    reason: "fixture"
    replacement: ""
  - id: CT-check-gamma
    path: scripts/control-tower/check-gamma.sh
    wired_to: []
    orphan: true
    blocking: false
    decision: retire
    reason: "fixture 孤儿"
    replacement: "T2"
  - id: CT-check-delta
    path: scripts/control-tower/check-delta.sh
    wired_to: []
    orphan: true
    blocking: false
    decision: retire
    reason: "fixture 孤儿"
    replacement: "T3"
pairing:
  - scan: T1
    action: replace
    target: PC-G1
    why: "fixture"
  - scan: T4
    action: replace
    target: PC-G1
    why: "fixture"
  - scan: T5
    action: replace
    target: PC-G1
    why: "fixture"
  - scan: T2
    action: retire
    target: CT-check-gamma
    why: "fixture 等额退役"
  - scan: T3
    action: retire
    target: CT-check-delta
    why: "fixture 等额退役"
FIXTURE_INV

OUT=$("$PYBIN" "$TOOL" --root "$INV_DIR" --check-inventory "$INV_DIR/inventory.yaml" 2>&1); RC=$?
assert_rc 0 "$RC" "--check-inventory 夹具"
assert_contains "$OUT" "PAIRING-OK t1..t5=5/5 excluded_headers=1 orphans=2/4" "次末行 PAIRING-OK 契约"
LAST_LINE=$(printf '%s\n' "$OUT" | tail -1)
assert_eq "covered=G1/1 B1/1 X1/1 S2/2 K3/3 R5/5" "$LAST_LINE" "末行固定 6 段 covered="
assert_not_contains "$OUT" "❌" "夹具全绿无 ❌"

inv_mutate() {  # $1 名称 $2 输出文件
  "$PYBIN" - "$1" "$2" "$INV_DIR/inventory.yaml" <<'PYEOF'
import sys
name, dst, src = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src, encoding="utf-8").read()


def cut(text, a, b):
    i = text.index(a)
    j = text.index(b, i + len(a))
    return text[:i] + text[j:]


if name == "drop-group-row":
    out = cut(text, "  - id: PC-G1\n", "  - id: PC-B-192f1b\n")
elif name == "drop-pairing-t2":
    out = cut(text, "  - scan: T2\n", "  - scan: T3\n")
elif name == "retire-target-active-gate":
    out = text.replace("target: CT-check-gamma", "target: PC-G1")
elif name == "retire-empty-replacement":
    out = text.replace(
        '    decision: keep\n    reason: "fixture"\n    replacement: ""\n  - id: PC-B-192f1b',
        '    decision: retire\n    reason: "fixture"\n    replacement: ""\n  - id: PC-B-192f1b')
elif name == "wrong-wired-to":
    out = text.replace('    wired_to: ["script:.github/workflows/ci.yml", "script:scripts/tool-helper.sh"]',
                       "    wired_to: []")
elif name == "c5-tamper":
    # #975：CI-S2 的 label_hash 篡改 ⇒ C5 真校验判红
    out = text.replace('    label: "plain step"\n    label_hash: "9c3750b3669b"',
                       '    label: "plain step"\n    label_hash: "deadbeefdead"')
elif name == "c10-ci-yml-mapping":
    # #975：把跨文件引用位写回旧 bug 形态（折算成 CI-S2）⇒ C10 复算判红
    out = text.replace('    wired_to: ["script:.github/workflows/ci.yml", "script:scripts/tool-helper.sh"]',
                       '    wired_to: ["CI-S2", "script:scripts/tool-helper.sh"]')
elif name == "drop-excluded-header":
    out = cut(text, "excluded_headers:\n", "gates:\n")
elif name == "handwritten-gate-id":
    out = text.replace(
        "  - id: CI-S2\n",
        "  - id: PC-Z9\n    kind: group\n    line: 99\n    label: \"hand written\"\n"
        "    label_hash: \"ffffffffffff\"\n    occurrences: [99]\n    what: \"hand written\"\n"
        "    blocking: soft\n    g_axis: [G1]\n    checkpoints: []\n    decision: keep\n"
        "    reason: \"x\"\n    replacement: \"\"\n  - id: CI-S2\n")
elif name == "move-checkpoint-to-wrong-row":
    out = text.replace('    checkpoints: ["cp two"]', "    checkpoints: []").replace(
        '    checkpoints: ["cp one"]', '    checkpoints: ["cp one", "cp two"]')
else:
    raise SystemExit("unknown inventory mutation: " + name)
assert out != text, "mutation no-op: " + name
open(dst, "w", encoding="utf-8", newline="\n").write(out)
PYEOF
}
inv_case() {  # $1 名称 $2 期望点名子串 $3 期望 ❌ 规则号
  local name="$1" needle="$2" rule="$3" file="$TMP_DIR/inv-$1.yaml" out rc
  inv_mutate "$name" "$file"
  out=$("$PYBIN" "$TOOL" --root "$INV_DIR" --check-inventory "$file" 2>&1); rc=$?
  assert_rc 1 "$rc" "inventory 反例 $name"
  assert_contains "$out" "❌ $rule" "反例 $name 点名 $rule"
  assert_contains "$out" "$needle" "反例 $name 点名 $needle"
}
inv_case drop-group-row "PC-G1" "C1"
inv_case drop-pairing-t2 "缺扫描 T2" "C9"
inv_case retire-target-active-gate "C9b" "C9b"
inv_case retire-empty-replacement "gates[PC-G1].replacement" "C7"
inv_case wrong-wired-to "wired_to 不一致" "C10"
inv_case drop-excluded-header "PC-X-0dfe02" "C3"
inv_case handwritten-gate-id "PC-Z9" "C6"
inv_case move-checkpoint-to-wrong-row "cp two" "C4"
inv_case c5-tamper "label_hash 不符" "C5"
inv_case c5-tamper "CI-S2" "C5"
inv_case c10-ci-yml-mapping "wired_to 不一致" "C10"

# #975 E 态：gates 段缺失 ⇒ 信号量==0 ⇒ rc=2（不折成 0/1）
INV_E_MISSING="$TMP_DIR/inv-e-missing-gates.yaml"
"$PYBIN" - "$INV_DIR/inventory.yaml" "$INV_E_MISSING" <<'PYEOF'
import sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
i = text.index("gates:\n")
j = text.index("checkers:\n")
out = text[:i] + text[j:]
assert out != text
open(dst, "w", encoding="utf-8", newline="\n").write(out)
PYEOF
OUT=$("$PYBIN" "$TOOL" --root "$INV_DIR" --check-inventory "$INV_E_MISSING" 2>&1); RC=$?
assert_rc 2 "$RC" "inventory E 态：gates 段缺失 ⇒ rc=2"
assert_contains "$OUT" "degraded:" "gates 段缺失打印 degraded 字样"

# #975 D 断言（跨载体逐字相等）：真树 workflow ①i 步名 = 表 CI-S12 label，
# 且表 label_hash = label_hash() 实算（步名/hash 改任一侧 ⇒ 此断言红）
D_CHECK=$("$PYBIN" - "$REPO_DIR" <<'PYEOF'
import hashlib
import re
import sys

root = sys.argv[1]
wf = open(root + "/.gitea/workflows/local-gates.yml", encoding="utf-8").read().split("\n")
inv = open(root + "/docs/authority/GATE-INVENTORY.yaml", encoding="utf-8").read().split("\n")
name_re = re.compile(r"^\s*-\s*name:\s*(.+?)\s*$")
step_labels = [m.group(1).strip() for m in map(name_re.match, wf) if m]
inv_label = None
inv_hash = None
for idx, line in enumerate(inv):
    if re.match(r"\s*-\s*id:\s*CI-S12\s*$", line):
        for probe in inv[idx:idx + 12]:
            m = re.match(r'\s*label:\s*"(.*)"\s*$', probe)
            if m:
                inv_label = m.group(1)
            m = re.match(r'\s*label_hash:\s*"(.*)"\s*$', probe)
            if m:
                inv_hash = m.group(1)
            if inv_label and inv_hash:
                break
        break
assert inv_label and inv_hash, "CI-S12 行未找到 label/label_hash"
tool_step = [s for s in step_labels if "①i" in s]
assert len(tool_step) == 1, "workflow ①i 步不唯一: %r" % tool_step
computed = hashlib.sha1(tool_step[0].encode("utf-8")).hexdigest()[:12]
ok = tool_step[0] == inv_label and computed == inv_hash
print("D-EQUAL %s inv_label=%r inv_hash=%s computed=%s" % ("OK" if ok else "BAD", inv_label, inv_hash, computed))
PYEOF
)
if printf '%s' "$D_CHECK" | grep -q "^D-EQUAL OK"; then
  pass "#975 D：workflow ①i 步名 = 表 CI-S12 label（逐字）且 label_hash 实算一致"
else
  fail "#975 D：跨载体逐字相等断言红 — $D_CHECK"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 5. --orphans-only（只报告不判红）──"
OUT=$("$PYBIN" "$TOOL" --root "$INV_DIR" --orphans-only 2>&1); RC=$?
assert_rc 0 "$RC" "--orphans-only 夹具"
assert_eq "orphans=2/4" "$(printf '%s\n' "$OUT" | tail -1)" "夹具 orphans=2/4"
OUT=$("$PYBIN" "$TOOL" --orphans-only 2>&1); RC=$?
assert_rc 0 "$RC" "--orphans-only 真树（只报告不判红）"
# #1126 期实测常量同步：GATE-INVENTORY 盘点器数 35 → 40（#1087/#1093/#1108 等增件；判据一字不动）
if printf '%s\n' "$OUT" | tail -1 | grep -qE '^orphans=[0-9]+/[0-9]+$'; then
  pass "真树末行格式 orphans=<n>/35"
else
  fail "真树末行格式不符: $(printf '%s\n' "$OUT" | tail -1)"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 6. J3 确定性（两次 shasum 相同；首跑 BOOTSTRAP）──"
DET1="$TMP_DIR/det1.json"
DET2="$TMP_DIR/det2.json"
OUT=$("$PYBIN" "$TOOL" --root "$REPO_DIR" --write-baseline --out "$DET1" 2>&1); RC=$?
assert_rc 0 "$RC" "确定性首跑 --write-baseline"
assert_contains "$OUT" "BOOTSTRAP" "首跑打印 BOOTSTRAP"
cp "$DET1" "$DET2"
OUT=$("$PYBIN" "$TOOL" --root "$REPO_DIR" --write-baseline --out "$DET1" 2>&1); RC=$?
assert_rc 0 "$RC" "确定性第二跑 --write-baseline"
assert_contains "$OUT" "RATCHET" "第二跑打印 RATCHET"
if command -v shasum >/dev/null 2>&1; then
  H1=$(shasum -a 256 "$DET1" | cut -d' ' -f1)
  H2=$(shasum -a 256 "$DET2" | cut -d' ' -f1)
else
  H1=$("$PYBIN" -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$DET1")
  H2=$("$PYBIN" -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$DET2")
fi
assert_eq "$H1" "$H2" "两次跑 shasum -a 256 逐字相同"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 7. J7 无绝对路径 ＋ JSON 结构契约 ──"
ABS_COUNT=$(grep -cE '/Users/|/home/|/private/|[A-Za-z]:\\' "$DET1" || true)
assert_eq "0" "$ABS_COUNT" "产物 JSON 无绝对路径（grep -cE = 0）"
STRUCT=$("$PYBIN" - "$DET1" <<'PYEOF'
import json
import sys

path = sys.argv[1]
raw = open(path, "rb").read().decode("utf-8")
data = json.loads(raw)
ok = []
ok.append(("schema_version==1", data.get("schema_version") == 1))
ok.append(("scanner.name", data.get("scanner", {}).get("name") == "quality-baseline"))
ok.append(("scanner.rules==T1..T5", data.get("scanner", {}).get("rules") == ["T1", "T2", "T3", "T4", "T5"]))
ok.append(("ratchet_reason 键存在", "ratchet_reason" in data.get("scanner", {})))
ok.append(("as_of.ref 非空", bool(data.get("as_of", {}).get("ref"))))
sha = data.get("as_of", {}).get("sha", "")
ok.append(("as_of.sha 40hex", len(sha) == 40 and all(c in "0123456789abcdef" for c in sha)))
ok.append(("scope==src/tests/extensions", data.get("scope") == ["src", "tests", "extensions"]))
ok.append(("totals 键齐", all(k in data.get("totals", {}) for k in ("T1", "T2", "T3", "T4", "T5"))))
mods = data.get("modules", [])
ok.append(("modules 非空", isinstance(mods, list) and len(mods) > 0))
ok.append(("modules 按名排序", [m["module"] for m in mods] == sorted(m["module"] for m in mods)))
viols = data.get("violations", [])
keys = [(v["check"], v["path"], v["line"]) for v in viols]
ok.append(("violations 按 (check,path,line) 排序", keys == sorted(keys)))
ok.append(("limitations≥3", isinstance(data.get("limitations"), list) and len(data["limitations"]) >= 3))
lim = "\n".join(data.get("limitations", []))
ok.append(("limitations 含 T2 窗口", "T2" in lim and "12 行" in lim))
ok.append(("limitations 含 T1 动态", "T1" in lim and "动态" in lim))
ok.append(("limitations 含 T5 .test.sh", "T5" in lim and ".test.sh" in lim))
ok.append(("末尾换行", raw.endswith("\n") and not raw.endswith("\n\n")))
ok.append(("无时间戳", "T00:" not in raw and not any(
    len(tok) >= 19 and tok[4] == "-" and tok[10] == "T" for tok in raw.split())))
for name, good in ok:
    print(("OK " if good else "BAD ") + name)
PYEOF
)
while IFS= read -r line; do
  case "$line" in
    "OK "*) pass "JSON 契约: ${line#OK }" ;;
    "BAD "*) fail "JSON 契约: ${line#BAD }" ;;
  esac
done <<< "$STRUCT"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 8. J6 三态返回码（0/1/2）──"
# 0：写基线（上面已覆盖）；1：沙箱注入 1 条 T4；2：坏根目录（信号量==0）
SB="$TMP_DIR/ratchet"
mkdir -p "$SB/src/mod"
printf 'export function alpha() {\n  return 1;\n}\n' > "$SB/src/mod/a.ts"
printf "import { alpha } from './a';\n\nalpha();\n" > "$SB/src/mod/b.ts"
init_git_sandbox "$SB" || fail "沙箱 git init/commit 失败"
OUT=$("$PYBIN" "$TOOL" --root "$SB" --write-baseline --out "$SB/base.json" 2>&1); RC=$?
assert_rc 0 "$RC" "三态 0：--write-baseline 沙箱"
OUT=$("$PYBIN" "$TOOL" --root "$SB" --baseline "$SB/base.json" 2>&1); RC=$?
assert_rc 0 "$RC" "三态 0：无回退默认模式"
printf 'function swallow() {\n  try {\n    risky();\n  } catch (e) {\n    return [];\n  }\n}\n' > "$SB/src/mod/c.ts"
OUT=$("$PYBIN" "$TOOL" --root "$SB" --baseline "$SB/base.json" 2>&1); RC=$?
assert_rc 1 "$RC" "三态 1：沙箱注入 1 条 T4 ⇒ 真红"
assert_contains "$OUT" "T4 1 > 0" "棘轮输出点名 T4 +1"
assert_contains "$OUT" "src/mod/c.ts:4" "棘轮输出点名 path:line"
rm -f "$SB/src/mod/c.ts"
OUT=$("$PYBIN" "$TOOL" --root "$SB" --baseline "$SB/base.json" 2>&1); RC=$?
assert_rc 0 "$RC" "回滚注入 ⇒ 回到 0"
OUT=$("$PYBIN" "$TOOL" --root /nonexistent --baseline "$SB/base.json" 2>&1); RC=$?
assert_rc 2 "$RC" "三态 2：--root 不存在（环境失败）"
assert_contains "$OUT" "degraded:" "三态 2 打印 degraded 字样"
EMPTY_DIR="$TMP_DIR/empty-tree"
mkdir -p "$EMPTY_DIR"
OUT=$("$PYBIN" "$TOOL" --root "$EMPTY_DIR" --baseline "$SB/base.json" 2>&1); RC=$?
assert_rc 2 "$RC" "三态 2：空树 0 文件/0 模块（信号量==0）"
BAD_BASE="$TMP_DIR/broken-baseline.json"
printf '{broken' > "$BAD_BASE"
OUT=$("$PYBIN" "$TOOL" --root "$SB" --baseline "$BAD_BASE" 2>&1); RC=$?
assert_rc 2 "$RC" "三态 2：基线损坏"
OUT=$("$PYBIN" "$TOOL" --selfcheck --check-registry "$REGISTRY" 2>&1); RC=$?
assert_rc 2 "$RC" "参数互斥违例 ⇒ 2"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 9. J9 棘轮 vs 本仓基线（注入 +1 ⇒ rc=1 点名；回滚 ⇒ rc=0）──"
BASE_REPO_JSON="$BASELINE"
OUT=$("$PYBIN" "$TOOL" --root "$SB" --baseline "$BASE_REPO_JSON" 2>&1); RC=$?
assert_rc 0 "$RC" "J9 注入前：沙箱 vs 本仓基线 ⇒ 0"
printf 'function swallow2() {\n  try {\n    risky();\n  } catch (e) {\n    return [];\n  }\n}\n' > "$SB/src/mod/c.ts"
OUT=$("$PYBIN" "$TOOL" --root "$SB" --baseline "$BASE_REPO_JSON" 2>&1); RC=$?
assert_rc 1 "$RC" "J9 注入 1 条 T4 ⇒ rc=1"
assert_contains "$OUT" "src/mod/c.ts:4" "J9 点名 path:line"
rm -f "$SB/src/mod/c.ts"
OUT=$("$PYBIN" "$TOOL" --root "$SB" --baseline "$BASE_REPO_JSON" 2>&1); RC=$?
assert_rc 0 "$RC" "J9 回滚 ⇒ rc=0"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 10. R1–R5 判别力两态（改坏前 totals=0 → 改坏后 +1 判红 → 改回 0）──"
rule_sandbox() {  # $1 dir $2 rule
  local dir="$1" rule="$2"
  mkdir -p "$dir/src/mod" "$dir/src/routes" "$dir/tests/mod"
  case "$rule" in
    T1)
      printf 'export function alpha() {\n  return 1;\n}\n' > "$dir/src/mod/a.ts"
      printf "import { alpha } from './a';\n\nalpha();\n" > "$dir/src/mod/b.ts"
      printf 'export function testOnlyHelper() {\n  return 1;\n}\n' > "$dir/src/mod/helper.test.ts"
      ;;
    T2)
      printf "async function loadData() {\n  return fetch('/x', { signal: AbortSignal.timeout(1000) });\n}\n" > "$dir/src/mod/a.ts"
      ;;
    T3)
      printf 'function handler(req: any, res: any) {\n  res.json(schema.parse(req.body).data);\n}\n' > "$dir/src/routes/a.ts"
      ;;
    T4)
      printf "function swallow() {\n  try {\n    risky();\n  } catch (e) {\n    console.warn('e', e);\n  }\n}\n" > "$dir/src/mod/a.ts"
      ;;
    T5)
      printf "it('x', () => {\n  expect(add(1, 2)).toBe(3);\n});\n" > "$dir/tests/mod/a.test.ts"
      printf "it('x', () => { echo 1; });\n" > "$dir/tests/mod/shell.test.sh"
      ;;
  esac
}
break_rule() {  # $1 dir $2 rule
  local dir="$1" rule="$2"
  case "$rule" in
    T1) printf "import { alpha } from './a';\n\n// alpha();\n" > "$dir/src/mod/b.ts" ;;
    T2) printf "async function loadData() {\n  return fetch('/x');\n}\n" > "$dir/src/mod/a.ts" ;;
    T3) printf 'function handler(req: any, res: any) {\n  res.json(req.body.user);\n}\n' > "$dir/src/routes/a.ts" ;;
    T4) printf "function swallow() {\n  try {\n    risky();\n  } catch (e) {\n    return [];\n  }\n}\n" > "$dir/src/mod/a.ts" ;;
    T5) printf "it('x', () => {\n});\n" > "$dir/tests/mod/a.test.ts" ;;
  esac
}
restore_rule() {  # $1 dir $2 rule（与 rule_sandbox 相同内容，覆盖回干净态）
  rule_sandbox "$1" "$2"
}
for RULE in T1 T2 T3 T4 T5; do
  RD="$TMP_DIR/rule-$RULE"
  rule_sandbox "$RD" "$RULE"
  init_git_sandbox "$RD" || fail "R$RULE 沙箱初始化失败"
  OUT=$("$PYBIN" "$TOOL" --root "$RD" --write-baseline --out "$RD/base.json" 2>&1); RC=$?
  assert_rc 0 "$RC" "$RULE 基线写入"
  BEFORE=$(json_get "$RD/base.json" "d['totals']['$RULE']")
  assert_eq "0" "$BEFORE" "$RULE 改坏前 totals=0"
  OUT=$("$PYBIN" "$TOOL" --root "$RD" --baseline "$RD/base.json" 2>&1); RC=$?
  assert_rc 0 "$RC" "$RULE 改坏前默认模式 rc=0"
  break_rule "$RD" "$RULE"
  OUT=$("$PYBIN" "$TOOL" --root "$RD" --baseline "$RD/base.json" 2>&1); RC=$?
  assert_rc 1 "$RC" "$RULE 改坏后判红"
  assert_contains "$OUT" "RATCHET-RED totals: $RULE 1 > 0" "$RULE 改坏后 totals +1"
  case "$RULE" in
    T1) assert_contains "$OUT" "alpha" "$RULE 点名符号 alpha" ;;
    T2) assert_contains "$OUT" "12 行窗口内无 signal" "$RULE 点名无 timeout" ;;
    T3) assert_contains "$OUT" "直传且语句内无" "$RULE 点名 schema 直通" ;;
    T4) assert_contains "$OUT" "catch 仅 return" "$RULE 点名 return [] 吞错" ;;
    T5) assert_contains "$OUT" "expect( 数=0" "$RULE 点名测试壳" ;;
  esac
  restore_rule "$RD" "$RULE"
  OUT=$("$PYBIN" "$TOOL" --root "$RD" --baseline "$RD/base.json" 2>&1); RC=$?
  assert_rc 0 "$RC" "$RULE 改回后回归 0"
done

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "── 11. 其它契约（--reason 棘轮 / --json / 解析器不随 --root）──"
# --reason：覆盖既有基线且 totals 上升 ⇒ 缺 reason rc=2；有 reason rc=0 且写入 JSON
SB2="$TMP_DIR/reason"
rule_sandbox "$SB2" "T4"
init_git_sandbox "$SB2" || fail "reason 沙箱初始化失败"
"$PYBIN" "$TOOL" --root "$SB2" --write-baseline --out "$SB2/base.json" >/dev/null 2>&1; RC=$?
assert_rc 0 "$RC" "reason 沙箱基线写入"
break_rule "$SB2" "T4"
OUT=$("$PYBIN" "$TOOL" --root "$SB2" --write-baseline --out "$SB2/base.json" 2>&1); RC=$?
assert_rc 2 "$RC" "覆写基线 totals 上升且缺 --reason ⇒ 2"
OUT=$("$PYBIN" "$TOOL" --root "$SB2" --write-baseline --out "$SB2/base.json" --reason "841 test ratchet" 2>&1); RC=$?
assert_rc 0 "$RC" "覆写基线 totals 上升带 --reason ⇒ 0"
REASON=$(json_get "$SB2/base.json" "d['scanner']['ratchet_reason']")
assert_eq "841 test ratchet" "$REASON" "ratchet_reason 落 JSON"

# --json：stdout 只输出可解析 JSON（不吞 stderr：解析失败必须看得见）
OUT=$("$PYBIN" "$TOOL" --root "$SB" --baseline "$SB/base.json" --json); RC=$?
assert_rc 0 "$RC" "--json 默认模式 rc=0"
JSON_OK=$("$PYBIN" -c 'import json,sys; d=json.loads(sys.stdin.read()); print("OK" if d["scanner"]["name"]=="quality-baseline" else "BAD")' <<< "$OUT")
assert_eq "OK" "$JSON_OK" "--json stdout 可解析"

# 解析器定位不随 --root：沙箱树没有 scripts/product-lines 也能解析（不降级）；
# 但 R5 按 --root 解析 path:line ⇒ 沙箱缺这些文件 ⇒ 应为 rc=1（R5 红而非 E_PARSER 降级）
OUT=$("$PYBIN" "$TOOL" --root "$SB" --check-registry "$REGISTRY" 2>&1); RC=$?
assert_rc 1 "$RC" "解析器不随 --root（能解析；R5 因沙箱缺文件而红）"
assert_contains "$OUT" "❌ R5" "解析器可加载（不再 E_PARSER 降级）"
assert_not_contains "$OUT" "E_PARSER" "无解析器降级（脚本自身仓根定位生效）"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -ne 0 ]; then
  echo "  FAIL pass=$PASS fail=$FAIL"
  exit 1
fi
echo "  TEST-OK pass=$PASS fail=0"
exit 0
