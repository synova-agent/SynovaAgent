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

# H5: 2026-10-11 创始人裁定 —— `extensions/**` 内容面 yaml 豁免（只限 yaml/yml，不含 .md）
#   背景（实测）: 批 2 三张 PR 因 extensions/ 下 3/3/12 件内容 yaml 被判"未登记"而 CI 硬红。
#   反例分离: 同目录下 .md 是**说明文档**，仍须登记 ⇒ 两半都要断言，"一锅端"会失去判别力。
EXTDIR="$CIF/extensions/onboarding"
mkdir -p "$EXTDIR" 2>/dev/null # swallow-ok: 夹具目录
printf 'a: 1\n' > "$EXTDIR/what-to-ask.yaml"
git -C "$CIF" add -A 2>/dev/null # swallow-ok:
git -C "$CIF" commit -q -m "feat(D999): 内容面 yaml（应豁免）" 2>/dev/null # swallow-ok:
OUT_H5=$(DOC_TRUTH_ROOT="$CIF" bash "$SCRIPT" 2>&1); _e5=$?
t "H5 extensions/ 内容 yaml 豁免 → exit 0" 0 $_e5
printf '%s\n' "$OUT_H5" | grep -q 'what-to-ask.yaml' && { echo "  ❌ H5 内容 yaml 不应进检查面（又豁免又检查=双口径）"; FAIL=$((FAIL+1)); } || { echo "  ✅ H5 内容 yaml 未进检查面（只豁免不登记）"; PASS=$((PASS+1)); }

# H6: 同目录 `extensions/**` 的 .md **不豁免** —— 守住豁免边界（不含 .md）
printf '# 说明文档\n' > "$EXTDIR/README-scope.md"
git -C "$CIF" add -A 2>/dev/null # swallow-ok:
git -C "$CIF" commit -q -m "docs(D999): 扩展说明文档（应登记）" 2>/dev/null # swallow-ok:
OUT_H6=$(DOC_TRUTH_ROOT="$CIF" bash "$SCRIPT" 2>&1); _e6=$?
t "H6 extensions/ 下 .md 不豁免 → exit 1（豁免边界=不含 .md）" 1 $_e6
printf '%s\n' "$OUT_H6" | grep -q 'README-scope.md' && { echo "  ✅ H6 .md 仍被点名（豁免未越界）"; PASS=$((PASS+1)); } || { echo "  ❌ H6 .md 未被点名 ⇒ 豁免越界（吞掉了说明文档）"; FAIL=$((FAIL+1)); }

# ═══ H7: D782 D2 —— base 链前置（origin/local-main）回归护栏 ═══
# 缺口（PR #250 独立复核指出）: 既有夹具只解析得到**自带的 `main` 分支** ⇒ 把 base 链改回
#   `origin/main` 在夹具里是 **no-op**（22 例仍全绿）⇒ 这半边**零回归护栏**。
# 本夹具让 `origin/main` 与 `origin/local-main` **指向不同提交**，且未登记件落在**两者之间**
#   （模拟"他线已合并提交里新增的文档" —— 与老 base 把 73+ 他线提交卷进 range 同型机理）:
#     A ← `main` 头 = refs/remotes/origin/main
#     └─ U  docs/orphan.md（**未登记**）
#        └─ L  docs/lm-only.md（已登记） = refs/remotes/origin/local-main
#           └─ F  docs/feat-new.md（已登记） = HEAD（feature）
# 两半判据（缺一即无判别力）:
#   ① base 前置 origin/local-main ⇒ merge-base=L ⇒ range 仅本支新增 ⇒ 检查 1 件、exit 0
#   ② 去掉 origin/local-main（base 退到 origin/main）⇒ merge-base=A ⇒ range 含 U 的未登记件
#      ⇒ exit 1 且点名 docs/orphan.md
echo ""
echo "── H7. D782 D2: base 链前置（origin/local-main）回归护栏 ──"
FORK="$FIX/fork-base"
mkdir -p "$FORK/docs/authority" "$FORK/docs"
printf 'documents:\n  - id: T1\n    type: prd\n    path: docs/keep.md\n' > "$FORK/docs/authority/DOCS-REGISTRY.yaml"
: > "$FORK/docs/keep.md"
git -C "$FORK" init -q -b main 2>/dev/null # swallow-ok:
git -C "$FORK" config user.email t@t 2>/dev/null # swallow-ok:
git -C "$FORK" config user.name t 2>/dev/null # swallow-ok:
git -C "$FORK" config commit.gpgsign false 2>/dev/null # swallow-ok:
git -C "$FORK" add -A 2>/dev/null # swallow-ok:
git -C "$FORK" commit -q -m "chore: base" 2>/dev/null # swallow-ok:
git -C "$FORK" update-ref refs/remotes/origin/main "$(git -C "$FORK" rev-parse HEAD)" 2>/dev/null # swallow-ok:
git -C "$FORK" checkout -q -b local-main 2>/dev/null # swallow-ok:
: > "$FORK/docs/orphan.md"
git -C "$FORK" add -A 2>/dev/null # swallow-ok:
git -C "$FORK" commit -q -m "docs(D998): 他线新增未登记文档" 2>/dev/null # swallow-ok:
printf '  - id: T2\n    type: prd\n    path: docs/lm-only.md\n' >> "$FORK/docs/authority/DOCS-REGISTRY.yaml"
: > "$FORK/docs/lm-only.md"
git -C "$FORK" add -A 2>/dev/null # swallow-ok:
git -C "$FORK" commit -q -m "docs(D998): local-main 自身新增（已登记）" 2>/dev/null # swallow-ok:
git -C "$FORK" update-ref refs/remotes/origin/local-main "$(git -C "$FORK" rev-parse HEAD)" 2>/dev/null # swallow-ok:
git -C "$FORK" checkout -q -b feature 2>/dev/null # swallow-ok:
printf '  - id: T3\n    type: prd\n    path: docs/feat-new.md\n' >> "$FORK/docs/authority/DOCS-REGISTRY.yaml"
: > "$FORK/docs/feat-new.md"
git -C "$FORK" add -A 2>/dev/null # swallow-ok:
git -C "$FORK" commit -q -m "docs(D998): 本支新增（已登记）" 2>/dev/null # swallow-ok:

# 前提守卫 1: 纯 tracked（①untracked=0 ②staged-new=0）⇒ 判别力只可能来自源③（base 链）
F7_UT=$(git -C "$FORK" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ') # swallow-ok:
F7_ST=$(git -C "$FORK" diff --cached --name-only --diff-filter=A 2>/dev/null | wc -l | tr -d ' ') # swallow-ok:
if [ "$F7_UT" = "0" ] && [ "$F7_ST" = "0" ]; then
  echo "  ✅ H7 前提: 纯 tracked（untracked=0 / staged-new=0）⇒ 判别力只来自源③"; PASS=$((PASS+1))
else
  echo "  ❌ H7 前提不成立: untracked=$F7_UT staged-new=$F7_ST ⇒ 判别力被①②污染"; FAIL=$((FAIL+1))
fi

# 前提守卫 2: origin/main 与 origin/local-main 必须**指向不同提交**（Done ③；相同 ⇒ 与既有 22 例同型 = no-op）
F7_OM=$(git -C "$FORK" rev-parse origin/main 2>/dev/null | tr -d '\n') # swallow-ok:
F7_OLM=$(git -C "$FORK" rev-parse origin/local-main 2>/dev/null | tr -d '\n') # swallow-ok:
if [ -n "$F7_OM" ] && [ -n "$F7_OLM" ] && [ "$F7_OM" != "$F7_OLM" ]; then
  echo "  ✅ H7 前提: origin/main(${F7_OM:0:8}) ≠ origin/local-main(${F7_OLM:0:8})（夹具可判别 base 链）"; PASS=$((PASS+1))
else
  echo "  ❌ H7 前提不成立: origin/main=${F7_OM:0:8} origin/local-main=${F7_OLM:0:8} ⇒ 夹具无判别力（no-op）"; FAIL=$((FAIL+1))
fi

# 前提守卫 3: merge-base(origin/local-main, HEAD) 必须 = origin/local-main 本身（range 收窄的机械条件）
F7_MBLM=$(git -C "$FORK" merge-base origin/local-main HEAD 2>/dev/null | tr -d '\n') # swallow-ok:
if [ -n "$F7_OLM" ] && [ "$F7_MBLM" = "$F7_OLM" ]; then
  echo "  ✅ H7 前提: merge-base(origin/local-main, HEAD) = origin/local-main ⇒ range 仅本支"; PASS=$((PASS+1))
else
  echo "  ❌ H7 前提不成立: merge-base=${F7_MBLM:0:8} ≠ origin/local-main=${F7_OLM:0:8}"; FAIL=$((FAIL+1))
fi

# H7a: base 链已前置 origin/local-main ⇒ 本支新增（已登记）通过，他线未登记件**不进检查面**
OUT_H7=$(DOC_TRUTH_ROOT="$FORK" bash "$SCRIPT" 2>&1); _e7=$?
t "H7a base 前置 origin/local-main → exit 0（改回 origin/main 必红）" 0 $_e7
N_H7=$(printf '%s\n' "$OUT_H7" | sed -n 's/.*检查 \([0-9][0-9]*\) 个文档.*/\1/p' | head -1)
if [ "${N_H7:-}" = "1" ]; then
  echo "  ✅ H7a 检查数 N=1（range 收窄到本支新增，未把他线提交卷进来）"; PASS=$((PASS+1))
else
  echo "  ❌ H7a 检查数 N=${N_H7:-空}（期望 1 ⇒ base 未前置 / range 过宽）"; FAIL=$((FAIL+1))
fi
printf '%s\n' "$OUT_H7" | grep -q 'docs/orphan.md' && { echo "  ❌ H7a 未登记件 docs/orphan.md 进了检查面 ⇒ base 未前置"; FAIL=$((FAIL+1)); } || { echo "  ✅ H7a 未登记件未进检查面（base 前置生效）"; PASS=$((PASS+1)); }

# H7b: 反例自证（改坏即红的内生版）—— 去掉 origin/local-main ⇒ base 退到 origin/main
#   ⇒ merge-base 回到 A ⇒ range 把他线未登记件卷进来 ⇒ **必须 exit 1 且点名**
#   （等价于"base 链未前置"：链上 origin/local-main 不可解析时行为完全相同）
git -C "$FORK" update-ref -d refs/remotes/origin/local-main 2>/dev/null # swallow-ok:
OUT_H7B=$(DOC_TRUTH_ROOT="$FORK" bash "$SCRIPT" 2>&1); _e7b=$?
t "H7b base 退到 origin/main → exit 1（改坏即红）" 1 $_e7b
printf '%s\n' "$OUT_H7B" | grep -q 'docs/orphan.md' && { echo "  ✅ H7b 未登记件被点名（夹具确有判别力）"; PASS=$((PASS+1)); } || { echo "  ❌ H7b 未登记件未被点名 ⇒ 夹具无判别力"; FAIL=$((FAIL+1)); }

echo ""
echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
