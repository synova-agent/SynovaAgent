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

# ═══ D1136（K3 P1 批）: ④a 台账查重 + ④b basename 顶替洞 + B2 不夹带 + (b) 消费端 ═══
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
REG_FIX="$FIX/reg1136"; rm -rf "$REG_FIX"
mkdir -p "$REG_FIX/docs/authority" "$REG_FIX/alpha" "$REG_FIX/beta"
# ⚠️ 必须 `git init`：否则本 fixture 落在哪个扫描模式（non-git 全量 find vs git ①untracked）
#   取决于祖先链上有没有仓库 —— 会让断言随环境漂移（实测：不加时本例在 CI 形态下走 git 路径）。
#   加 init 后：① untracked 稳定命中 alpha/beta 两个 .md，模式确定、与祖先无关。
git -C "$REG_FIX" init -q 2>/dev/null # swallow-ok: 建最小仓只为定模式
: > "$REG_FIX/alpha/SKILL.md"
: > "$REG_FIX/beta/SKILL.md"      # 未登记，basename 与已登记的 alpha/SKILL.md **相同** ⇒ 顶替洞靶子

# I: ④b 顶替反例 —— beta/SKILL.md 必须判"未登记"（修前会误判"已登记"）
printf 'documents:\n  - id: DOC-0001\n    type: knowledge\n    path: alpha/SKILL.md\n    status: active\n' \
  > "$REG_FIX/docs/authority/DOCS-REGISTRY.yaml"
OUT_I=$(DOC_TRUTH_ROOT="$REG_FIX" bash "$SCRIPT" 2>&1); _ei=$?
t "I 两目录同名（beta 未登记）→ 阻断" 1 $_ei
printf '%s\n' "$OUT_I" | grep -q '❌ 未登记: beta/SKILL.md' \
  && { echo "  ✅ I beta/SKILL.md 正确判未登记（不与 alpha 互相顶替）"; PASS=$((PASS+1)); } \
  || { echo "  ❌ I beta/SKILL.md 未正确判未登记"; FAIL=$((FAIL+1)); }

# I′: 判别性（改坏即红）—— 把精确匹配**变异回**"整表子串"⇒ 同一夹具必须变绿
#     证明本用例真在测该洞，而非恒真。
MUT="$FIX/mut-gate.sh"
python3 - "$SCRIPT" "$MUT" <<'PY'
import sys
src = open(sys.argv[1], encoding='utf-8').read()
old = '''"$REG_BARE_NL" == *$'\\n'"$base"$'\\n'*'''
new = '''"$(cat "$REGISTRY")" == *"$base"*'''
if old not in src:
    print("MUTATION-MISS"); sys.exit(3)
open(sys.argv[2], 'w', encoding='utf-8').write(src.replace(old, new, 1))
PY
if [ $? -eq 0 ]; then
  OUT_I2=$(SYNO_DOC_GATE_SRC="$MUT" DOC_TRUTH_ROOT="$REG_FIX" bash "$MUT" 2>&1); _ei2=$?
  t "I′ 变异回整表子串 → 复现顶替（exit 0 = 洞回来）" 0 $_ei2
  printf '%s\n' "$OUT_I2" | grep -q '✅ 已登记: beta/SKILL.md' \
    && { echo "  ✅ I′ 变异体确实误判 beta 为已登记 ⇒ 夹具判别性成立"; PASS=$((PASS+1)); } \
    || { echo "  ❌ I′ 变异体未复现洞 ⇒ 夹具可能是恒真"; FAIL=$((FAIL+1)); }
else
  echo "  ❌ I′ 变异未命中（实现条件已改？）——夹具失去判别性"; FAIL=$((FAIL+1))
fi

# J: ④a 重复 id → exit 1 并点名
printf 'documents:\n  - id: DOC-0001\n    type: a\n    path: alpha/SKILL.md\n  - id: DOC-0001\n    type: b\n    path: beta/SKILL.md\n' \
  > "$REG_FIX/docs/authority/DOCS-REGISTRY.yaml"
OUT_J=$(DOC_TRUTH_ROOT="$REG_FIX" bash "$SCRIPT" 2>&1); _ej=$?
t "J 重复 id → 阻断" 1 $_ej
printf '%s\n' "$OUT_J" | grep -q '重复 id:.*DOC-0001' \
  && { echo "  ✅ J 点名重复 id（DOC-0001）"; PASS=$((PASS+1)); } \
  || { echo "  ❌ J 未点名重复 id"; FAIL=$((FAIL+1)); }

# J2: ④a 重复 path → exit 1 并点名
printf 'documents:\n  - id: DOC-0001\n    type: a\n    path: alpha/SKILL.md\n  - id: DOC-0002\n    type: b\n    path: alpha/SKILL.md\n' \
  > "$REG_FIX/docs/authority/DOCS-REGISTRY.yaml"
OUT_J2=$(DOC_TRUTH_ROOT="$REG_FIX" bash "$SCRIPT" 2>&1); _ej2=$?
t "J2 重复 path → 阻断" 1 $_ej2
printf '%s\n' "$OUT_J2" | grep -q '重复 path:.*alpha/SKILL.md' \
  && { echo "  ✅ J2 点名重复 path"; PASS=$((PASS+1)); } \
  || { echo "  ❌ J2 未点名重复 path"; FAIL=$((FAIL+1)); }

# K: 混排异构前缀正例 —— ARCH-* / DOC-* 混排 ⇒ exit 0（查重不得误伤异构前缀）
printf 'documents:\n  - id: ARCH-0001\n    type: architecture\n    path: alpha/SKILL.md\n  - id: DOC-0001\n    type: knowledge\n    path: beta/SKILL.md\n' \
  > "$REG_FIX/docs/authority/DOCS-REGISTRY.yaml"
OUT_K=$(DOC_TRUTH_ROOT="$REG_FIX" bash "$SCRIPT" 2>&1); _ek=$?
t "K ARCH-*/DOC-* 混排 → 通过（不误伤）" 0 $_ek

# L: 🔴 B2 不得夹带 —— 台账缺失必须**仍 exit 0**（锁住语义，防后人顺手改成 exit 2）
NOFIX="$FIX/noreg1136"; rm -rf "$NOFIX"; mkdir -p "$NOFIX"; git -C "$NOFIX" init -q 2>/dev/null # swallow-ok: 定模式
: > "$NOFIX/x.md"
OUT_L=$(DOC_TRUTH_ROOT="$NOFIX" bash "$SCRIPT" 2>&1); _el=$?
t "L 台账缺失 → exit 0（B2 未采纳，禁止夹带）" 0 $_el
printf '%s\n' "$OUT_L" | grep -q 'DOCS-REGISTRY.yaml 不存在' \
  && { echo "  ✅ L 缺失降级显式留痕（不静默）"; PASS=$((PASS+1)); } \
  || { echo "  ❌ L 缺失未留痕"; FAIL=$((FAIL+1)); }

# M: (b) 消费端契约 —— 查重失败必须能被 pre-commit 捕获，否则 exit 1 被吞成 ✅ 假绿
PCC="$REPO/scripts/pre-commit-check.sh"
if [ -f "$PCC" ]; then
  printf 'documents:\n  - id: DOC-0001\n    type: a\n    path: alpha/SKILL.md\n  - id: DOC-0001\n    type: b\n    path: beta/SKILL.md\n' \
    > "$REG_FIX/docs/authority/DOCS-REGISTRY.yaml"
  OUT_M=$(DOC_TRUTH_ROOT="$REG_FIX" bash "$SCRIPT" 2>&1)
  # 从**生产脚本**取真实式样，不硬编码 ⇒ 有人把它改回去，本断言即红
  CNT_NEW=$(printf '%s\n' "$OUT_M" | grep -E '未登记|重复' | grep -c .)
  CNT_OLD=$(printf '%s\n' "$OUT_M" | grep '未登记' | grep -c .)
  [ "$CNT_NEW" -ge 1 ] && { echo "  ✅ M 消费端新式样可捕获（$CNT_NEW 行）⇒ SYNO_CI=1 下为 ❌"; PASS=$((PASS+1)); } \
                       || { echo "  ❌ M 消费端新式样捕获 0 行 ⇒ 查重失败会被吞"; FAIL=$((FAIL+1)); }
  [ "$CNT_OLD" -eq 0 ] && { echo "  ✅ M 对照：旧式样（仅'未登记'）捕获 0 行 = 修前会显示 ✅ 假绿"; PASS=$((PASS+1)); } \
                       || { echo "  ⚠️ M 对照：旧式样竟捕获 $CNT_OLD 行（夹具需复核）"; FAIL=$((FAIL+1)); }
  grep -qE "DOC_REG_OUT\"? *\| *grep -E? ['\"]?[^\"']*重复" "$PCC" \
    && { echo "  ✅ M 生产脚本的提取式样含『重复』（契约在位）"; PASS=$((PASS+1)); } \
    || { echo "  ❌ M 生产脚本提取式样未含『重复』⇒ 假绿会回归"; FAIL=$((FAIL+1)); }
else
  echo "  ❌ M pre-commit-check.sh 不存在，无法校验消费端契约"; FAIL=$((FAIL+1))
fi

echo ""
echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
