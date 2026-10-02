#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# doc-registry-gate.test.sh — 登记门禁脚本测试（铁律 48：正常/边界/降级三路径）
# 用例: A 检出未登记→1 | B 全登记→0 | C registry 缺失降级→0 | D 排除生效→0
# 运行: bash tests/doc-system/doc-registry-gate.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e
# 被检实现注入点（ctrl-tower-change 模式 5）: 默认 = 仓内实现；
#   SYNO_DOC_GATE_SRC=<path> 指向基线/变异副本 ⇒ "改坏即红"取证，零真实文件改动。
SCRIPT="${SYNO_DOC_GATE_SRC:-$(cd "$(dirname "$0")/../.." && pwd)/scripts/doc-system/doc-registry-gate.sh}"
PASS=0; FAIL=0

t() { # $1=用例名 $2=期望 $3=实际
  if [ "$2" = "$3" ]; then echo "  ✅ $1 (exit $3)"; PASS=$((PASS+1)); else echo "  ❌ $1 (期望 $2 实际 $3)"; FAIL=$((FAIL+1)); fi
}

FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
mkdir -p "$FIX/docs/authority" "$FIX/docs/archive"
: > "$FIX/a.md"; : > "$FIX/docs/good.md"; : > "$FIX/docs/bad.md"; : > "$FIX/docs/archive/hist.md"

# A: registry 只登记 a.md + good.md → bad.md 未登记 → exit 1
cat > "$FIX/docs/authority/DOCS-REGISTRY.yaml" <<'EOF'
documents:
  - id: T1
    type: prd
    path: a.md
  - id: T2
    type: prd
    path: docs/good.md
EOF
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "A 检出未登记" 1 $?

# B: 补登记 bad.md → exit 0
printf '  - id: T3\n    type: prd\n    path: docs/bad.md\n' >> "$FIX/docs/authority/DOCS-REGISTRY.yaml"
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "B 全登记通过" 0 $?

# C: registry 缺失 → 降级 exit 0
mv "$FIX/docs/authority/DOCS-REGISTRY.yaml" "$FIX/docs/authority/.bak"
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "C registry缺失降级" 0 $?
mv "$FIX/docs/authority/.bak" "$FIX/docs/authority/DOCS-REGISTRY.yaml"

# D: archive 路径排除 → 即使未登记也不报 → exit 0（bad.md 已登记）
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "D 排除+全登记" 0 $?

# E: git 模式 — staged 新增未登记 → exit 1（提交场景核心：git add 后 ls-files --others 看不到）
git -C "$FIX" init -q 2>/dev/null # swallow-ok:
git -C "$FIX" config user.email t@t 2>/dev/null # swallow-ok:
git -C "$FIX" config user.name t 2>/dev/null # swallow-ok:
git -C "$FIX" add a.md docs/good.md docs/bad.md 2>/dev/null # swallow-ok:
: > "$FIX/docs/new.md"
git -C "$FIX" add docs/new.md 2>/dev/null # swallow-ok:
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "E git模式检出staged未登记" 1 $?

# F: 补登记 new.md → git 模式全登记 → exit 0
printf '  - id: T4\n    type: prd\n    path: docs/new.md\n' >> "$FIX/docs/authority/DOCS-REGISTRY.yaml"
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "F git模式全登记通过" 0 $?

# G: tmp/ 临时区排除 → 即使未登记也不报 → exit 0
mkdir -p "$FIX/tmp"
: > "$FIX/tmp/scratch.md"
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "G tmp临时区排除" 0 $?

# W: 生产接线检查（铁律 0-2 WIRE CHECK — doc-system 脚本已被 pre-commit 调用）
PRE_COMMIT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/pre-commit-check.sh"
grep -q "doc-registry-gate.sh" "$PRE_COMMIT"; t "W1 接线: registry-gate 在 pre-commit" 0 $?
grep -q "check-doc-truth.sh" "$PRE_COMMIT"; t "W2 接线: check-doc-truth 在 pre-commit" 0 $?

# ═══ CT-D2: CI 形态（纯 tracked 仓库，无 untracked/staged）⇒ 必须真扫到文件 ═══
# 根因: 旧实现只取 untracked + staged-new，CI `actions/checkout`（fetch-depth: 0）后
#   两者皆空 ⇒ 「检查 0 个文档」⇒ 放行 = fail-open（门禁在提交态从未行使）。
echo ""
echo "── H. CT-D2: CI 形态（提交态）新增文档必须被拦 ──"
CIF="$FIX/ci-form"
mkdir -p "$CIF/docs/authority" "$CIF/docs"
printf 'documents:\n  - id: T1\n    type: prd\n    path: docs/old.md\n' > "$CIF/docs/authority/DOCS-REGISTRY.yaml"
: > "$CIF/docs/old.md"
git -C "$CIF" init -q -b main 2>/dev/null # swallow-ok:
git -C "$CIF" config user.email t@t 2>/dev/null # swallow-ok:
git -C "$CIF" config user.name t 2>/dev/null # swallow-ok:
git -C "$CIF" add -A 2>/dev/null # swallow-ok:
git -C "$CIF" commit -q -m "chore: base" 2>/dev/null # swallow-ok:
git -C "$CIF" checkout -q -b feat/D999-add-doc 2>/dev/null # swallow-ok:
: > "$CIF/docs/newdoc.md"
git -C "$CIF" add -A 2>/dev/null # swallow-ok:
git -C "$CIF" commit -q -m "docs(D999): 新增未登记文档" 2>/dev/null # swallow-ok:

# 前提守卫: 必须真是纯 tracked（untracked=0 且 staged-new=0），否则没压到 fail-open 路径 ⇒ 假绿
PRE_UT=$(git -C "$CIF" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
PRE_ST=$(git -C "$CIF" diff --cached --name-only --diff-filter=A 2>/dev/null | wc -l | tr -d ' ')
if [ "$PRE_UT" = "0" ] && [ "$PRE_ST" = "0" ]; then
  echo "  ✅ H 前提: 纯 tracked 仓库（untracked=0 / staged-new=0）= CI checkout 形态"; PASS=$((PASS+1))
else
  echo "  ❌ H 前提不成立: untracked=$PRE_UT staged-new=$PRE_ST ⇒ 未压到 fail-open 路径"; FAIL=$((FAIL+1))
fi

OUT_H=$(DOC_TRUTH_ROOT="$CIF" bash "$SCRIPT" 2>&1); _e=$?
t "H1 CI 形态新增未登记文档 → exit 1" 1 $_e
N_H=$(printf '%s\n' "$OUT_H" | sed -n 's/.*检查 \([0-9][0-9]*\) 个文档.*/\1/p' | head -1)
case "${N_H:-}" in
  ''|0) echo "  ❌ H1 检查数 N=${N_H:-空}（必须 >0；改前这里是 0 = fail-open）"; FAIL=$((FAIL+1)) ;;
  *)    echo "  ✅ H1 检查数 N=$N_H > 0（提交态真扫到文件）"; PASS=$((PASS+1)) ;;
esac
printf '%s\n' "$OUT_H" | grep -q 'docs/newdoc.md' && { echo "  ✅ H1 逐文件点名未登记文档"; PASS=$((PASS+1)); } || { echo "  ❌ H1 未点名未登记文档"; FAIL=$((FAIL+1)); }

# H2: 补登记 → exit 0
printf '  - id: T2\n    type: prd\n    path: docs/newdoc.md\n' >> "$CIF/docs/authority/DOCS-REGISTRY.yaml"
git -C "$CIF" add -A 2>/dev/null # swallow-ok:
git -C "$CIF" commit -q -m "docs(D999): 登记 newdoc" 2>/dev/null # swallow-ok:
DOC_TRUTH_ROOT="$CIF" bash "$SCRIPT" >/dev/null 2>&1; t "H2 补登记后通过" 0 $?

# H3: evidence/ 目录新增 → 豁免（运行期产物口径；**只豁免不登记**，不得又豁免又检查）
mkdir -p "$CIF/docs/synova/product-lines/evidence"
: > "$CIF/docs/synova/product-lines/evidence/D999-proof.md"
git -C "$CIF" add -A 2>/dev/null # swallow-ok:
git -C "$CIF" commit -q -m "docs(D999): 证据（应豁免）" 2>/dev/null # swallow-ok:
OUT_H3=$(DOC_TRUTH_ROOT="$CIF" bash "$SCRIPT" 2>&1); _e3=$?
t "H3 evidence/ 新增豁免（运行期产物）" 0 $_e3
printf '%s\n' "$OUT_H3" | grep -q 'D999-proof.md' && { echo "  ❌ H3 evidence 文档不应进检查面（又豁免又检查=双口径）"; FAIL=$((FAIL+1)); } || { echo "  ✅ H3 evidence 文档未进检查面（只豁免不登记）"; PASS=$((PASS+1)); }

# H4: 降级 —— base 全链不可解析 ⇒ 显式留痕 + 不误红（沿用既有 fetch 失败语义）
CIF2="$FIX/ci-form-nobase"
mkdir -p "$CIF2/docs/authority"
printf 'documents: []\n' > "$CIF2/docs/authority/DOCS-REGISTRY.yaml"
git -C "$CIF2" init -q -b trunk 2>/dev/null # swallow-ok:
git -C "$CIF2" config user.email t@t 2>/dev/null # swallow-ok:
git -C "$CIF2" config user.name t 2>/dev/null # swallow-ok:
: > "$CIF2/docs/x.md"
git -C "$CIF2" add -A 2>/dev/null # swallow-ok:
git -C "$CIF2" commit -q -m c 2>/dev/null # swallow-ok:
OUT_H4=$(DOC_TRUTH_ROOT="$CIF2" bash "$SCRIPT" 2>&1); _e4=$?
t "H4 base 不可解析 → 显式降级（不 exit 2、不误红）" 0 $_e4
printf '%s\n' "$OUT_H4" | grep -q 'base 全链不可解析' && { echo "  ✅ H4 降级留痕（不静默）"; PASS=$((PASS+1)); } || { echo "  ❌ H4 降级未留痕"; FAIL=$((FAIL+1)); }

echo ""
echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
