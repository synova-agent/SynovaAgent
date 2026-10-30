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
  - id: DOC-9001
    type: prd
    path: a.md
    status: active
  - id: DOC-9002
    type: prd
    path: docs/good.md
    status: active
EOF
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "A 检出未登记" 1 $?

# B: 补登记 bad.md → exit 0
printf '  - id: DOC-9003\n    type: prd\n    path: docs/bad.md\n    status: active\n' >> "$FIX/docs/authority/DOCS-REGISTRY.yaml"
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
printf '  - id: DOC-9004\n    type: prd\n    path: docs/new.md\n    status: active\n' >> "$FIX/docs/authority/DOCS-REGISTRY.yaml"
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
printf 'documents:\n  - id: DOC-9001\n    type: prd\n    path: docs/old.md\n    status: active\n' > "$CIF/docs/authority/DOCS-REGISTRY.yaml"
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
printf '  - id: DOC-9002\n    type: prd\n    path: docs/newdoc.md\n    status: active\n' >> "$CIF/docs/authority/DOCS-REGISTRY.yaml"
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
printf 'documents:\n  - id: DOC-9001\n    type: prd\n    path: docs/x.md\n    status: active\n' > "$CIF2/docs/authority/DOCS-REGISTRY.yaml"
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

# ═══ H7: D782 D2 —— base 链前置（真源 gitea/<TRUNK>）回归护栏 ═══
# 缺口（PR #250 独立复核指出）: 既有夹具只解析得到**自带的 `main` 分支** ⇒ 把 base 链改回
#   `origin/main` 在夹具里是 **no-op**（22 例仍全绿）⇒ 这半边**零回归护栏**。
# 本夹具让 `origin/main`（陈旧镜像位）与 `gitea/main`（真源位）**指向不同提交**，且未登记件落在**两者之间**
#   （模拟"他线已合并提交里新增的文档" —— 与老 base 把 73+ 他线提交卷进 range 同型机理）:
#     A ← `main` 头 = refs/remotes/origin/main（本地 main 亦在 A = 陈旧位）
#     └─ U  docs/orphan.md（**未登记**）
#        └─ L  docs/lm-only.md（已登记） = refs/remotes/gitea/main（真源）
#           └─ F  docs/feat-new.md（已登记） = HEAD（feature）
# 两半判据（缺一即无判别力）:
#   ① base 前置 gitea/main ⇒ merge-base=L ⇒ range 仅本支新增 ⇒ 检查 1 件、exit 0
#   ② 去掉 gitea/main（base 退到本地 main=A）⇒ merge-base=A ⇒ range 含 U 的未登记件
#      ⇒ exit 1 且点名 docs/orphan.md
echo ""
echo "── H7. D782 D2: base 链前置（真源 gitea/main）回归护栏 ──"
FORK="$FIX/fork-base"
mkdir -p "$FORK/docs/authority" "$FORK/docs"
printf 'documents:\n  - id: DOC-9001\n    type: prd\n    path: docs/keep.md\n    status: active\n' > "$FORK/docs/authority/DOCS-REGISTRY.yaml"
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
printf '  - id: DOC-9002\n    type: prd\n    path: docs/lm-only.md\n    status: active\n' >> "$FORK/docs/authority/DOCS-REGISTRY.yaml"
: > "$FORK/docs/lm-only.md"
git -C "$FORK" add -A 2>/dev/null # swallow-ok:
git -C "$FORK" commit -q -m "docs(D998): local-main 自身新增（已登记）" 2>/dev/null # swallow-ok:
git -C "$FORK" update-ref refs/remotes/gitea/main "$(git -C "$FORK" rev-parse HEAD)" 2>/dev/null # swallow-ok:
git -C "$FORK" checkout -q -b feature 2>/dev/null # swallow-ok:
printf '  - id: DOC-9003\n    type: prd\n    path: docs/feat-new.md\n    status: active\n' >> "$FORK/docs/authority/DOCS-REGISTRY.yaml"
printf '%s\n' '---' '任务: "#9003"' '---' > "$FORK/docs/feat-new.md"   # R1/R2: 夹具新件须可派生 Issue 来源
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

# 前提守卫 2: origin/main 与 gitea/main 必须**指向不同提交**（Done ③；相同 ⇒ 与既有 22 例同型 = no-op）
F7_OM=$(git -C "$FORK" rev-parse origin/main 2>/dev/null | tr -d '\n') # swallow-ok:
F7_OLM=$(git -C "$FORK" rev-parse gitea/main 2>/dev/null | tr -d '\n') # swallow-ok:
if [ -n "$F7_OM" ] && [ -n "$F7_OLM" ] && [ "$F7_OM" != "$F7_OLM" ]; then
  echo "  ✅ H7 前提: origin/main(${F7_OM:0:8}) ≠ gitea/main(${F7_OLM:0:8})（夹具可判别 base 链）"; PASS=$((PASS+1))
else
  echo "  ❌ H7 前提不成立: origin/main=${F7_OM:0:8} gitea/main=${F7_OLM:0:8} ⇒ 夹具无判别力（no-op）"; FAIL=$((FAIL+1))
fi

# 前提守卫 3: merge-base(gitea/main, HEAD) 必须 = gitea/main 本身（range 收窄的机械条件）
F7_MBLM=$(git -C "$FORK" merge-base gitea/main HEAD 2>/dev/null | tr -d '\n') # swallow-ok:
if [ -n "$F7_OLM" ] && [ "$F7_MBLM" = "$F7_OLM" ]; then
  echo "  ✅ H7 前提: merge-base(gitea/main, HEAD) = gitea/main ⇒ range 仅本支"; PASS=$((PASS+1))
else
  echo "  ❌ H7 前提不成立: merge-base=${F7_MBLM:0:8} ≠ gitea/main=${F7_OLM:0:8}"; FAIL=$((FAIL+1))
fi

# H7a: base 链已前置 gitea/main ⇒ 本支新增（已登记）通过，他线未登记件**不进检查面**
OUT_H7=$(DOC_TRUTH_ROOT="$FORK" bash "$SCRIPT" 2>&1); _e7=$?
t "H7a base 前置 gitea/main → exit 0（改回 origin/main 必红）" 0 $_e7
N_H7=$(printf '%s\n' "$OUT_H7" | sed -n 's/.*检查 \([0-9][0-9]*\) 个文档.*/\1/p' | head -1)
if [ "${N_H7:-}" = "1" ]; then
  echo "  ✅ H7a 检查数 N=1（range 收窄到本支新增，未把他线提交卷进来）"; PASS=$((PASS+1))
else
  echo "  ❌ H7a 检查数 N=${N_H7:-空}（期望 1 ⇒ base 未前置 / range 过宽）"; FAIL=$((FAIL+1))
fi
printf '%s\n' "$OUT_H7" | grep -q 'docs/orphan.md' && { echo "  ❌ H7a 未登记件 docs/orphan.md 进了检查面 ⇒ base 未前置"; FAIL=$((FAIL+1)); } || { echo "  ✅ H7a 未登记件未进检查面（base 前置生效）"; PASS=$((PASS+1)); }

# H7b: 反例自证（改坏即红的内生版）—— 去掉 gitea/main 真源引用（本地 main=A 不再被遮蔽）
#   ⇒ base 退到本地 main（=A）⇒ merge-base 回到 A ⇒ range 把他线未登记件卷进来
#   ⇒ **必须 exit 1 且点名**（等价于"base 链全未前置"：链上各候选不可解析时行为相同）
#   （2026-10-29 注: 新基线链为 gitea/$TRUNK → 本地 $TRUNK，故反例移除 gitea 侧真源即落到本地 main=A）
git -C "$FORK" update-ref -d refs/remotes/gitea/main 2>/dev/null # swallow-ok:
git -C "$FORK" branch -q -D local-main 2>/dev/null # swallow-ok:
OUT_H7B=$(DOC_TRUTH_ROOT="$FORK" bash "$SCRIPT" 2>&1); _e7b=$?
t "H7b base 退到本地 main=A → exit 1（改坏即红）" 1 $_e7b
printf '%s\n' "$OUT_H7B" | grep -q 'docs/orphan.md' && { echo "  ✅ H7b 未登记件被点名（夹具确有判别力）"; PASS=$((PASS+1)); } || { echo "  ❌ H7b 未登记件未被点名 ⇒ 夹具无判别力"; FAIL=$((FAIL+1)); }

# H7c（2026-10-12，CTO P0 bug 1 同型实证）: gitea/main **陈旧**（指回 A，落后两个提交）
#   真源引用陈旧 ⇒ 链上取到的就是旧点（不 fetch 不猜，同 bug 1 口径）
#   ⇒ range 卷入 docs/orphan.md ⇒ **必须 exit 1**（改坏即红：陈旧真源引用不得作基线）
git -C "$FORK" update-ref refs/remotes/gitea/main "$F7_OM" 2>/dev/null # swallow-ok:
OUT_H7C=$(DOC_TRUTH_ROOT="$FORK" bash "$SCRIPT" 2>&1); _e7c=$?
t "H7c gitea/main 陈旧(指A) → 必红（bug1 同型，改坏即红）" 1 $_e7c
# 恢复 gitea/main 为新鲜值（不泄漏影响后续）
git -C "$FORK" update-ref refs/remotes/gitea/main "$F7_OLM" 2>/dev/null # swallow-ok:

# H8（2026-10-12，CTO P0 bug 2 判据）: 未在本 PR 里的 untracked 文件 ⇒ **不得阻断**（仅警告）
: > "$FORK/docs/decoy-untracked.md"
OUT_H8=$(DOC_TRUTH_ROOT="$FORK" bash "$SCRIPT" 2>&1); _e8=$?
t "H8 untracked 未登记件 → exit 0（仅警告，不阻断）" 0 $_e8
printf '%s\n' "$OUT_H8" | grep -q '⚠️ 未登记(仅警告,untracked): docs/decoy-untracked.md' && { echo "  ✅ H8 untracked 件被警告点名（不静默）"; PASS=$((PASS+1)); } || { echo "  ❌ H8 untracked 件未警告 ⇒ 静默放过（违反铁律 11）"; FAIL=$((FAIL+1)); }
rm -f "$FORK/docs/decoy-untracked.md"

echo ""
echo "── I. #942 唯一性: DOC id 重号必红、逐条点名（不得只告警）──"
cp "$FIX/docs/authority/DOCS-REGISTRY.yaml" "$FIX/reg.bak"
# I1: 注入重号（同一 DOC-0500 两条）⇒ exit 1 且点名
printf '  - id: DOC-0500\n    type: prd\n    path: a.md\n  - id: DOC-0500\n    type: prd\n    path: docs/good.md\n' >> "$FIX/docs/authority/DOCS-REGISTRY.yaml"
OUT_I=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); _ei=$?
t "I1 注入 DOC id 重号 → exit 1" 1 $_ei
if printf '%s\n' "$OUT_I" | grep -q '重号: DOC-0500'; then
  echo "  ✅ I1 逐条点名重号 id（重号: DOC-0500）"; PASS=$((PASS+1))
else
  echo "  ❌ I1 未点名重号 id（唯一性未落）"; FAIL=$((FAIL+1))
fi
printf '%s\n' "$OUT_I" | grep -q '唯一性: .*条 DOC id，重号 1 个' && { echo "  ✅ I1 汇总行报重号数"; PASS=$((PASS+1)); } || { echo "  ❌ I1 汇总行未报重号数"; FAIL=$((FAIL+1)); }
# I2: 还原 ⇒ exit 0（两态）
cp "$FIX/reg.bak" "$FIX/docs/authority/DOCS-REGISTRY.yaml"
OUT_I2=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); _ei2=$?
t "I2 还原重号 → exit 0" 0 $_ei2
printf '%s\n' "$OUT_I2" | grep -q '重号 0 个' && { echo "  ✅ I2 还原后重号归零"; PASS=$((PASS+1)); } || { echo "  ❌ I2 还原后仍报重号"; FAIL=$((FAIL+1)); }
# I3: 存量（真实仓）⇒ exit 0（#934 合入后应为 0 重号）
RR="$(cd "$(dirname "$0")/../.." && pwd)"
DOC_TRUTH_ROOT="$RR" bash "$SCRIPT" >/dev/null 2>&1; t "I3 存量真实仓 → exit 0" 0 $?

echo ""
echo "── J. #942 F1/F2: 引号 id / 行尾注释 / 解析为 0（fail-closed）──"
cp "$FIX/docs/authority/DOCS-REGISTRY.yaml" "$FIX/reg2.bak"
# J1: 带引号 id 重号 ⇒ 非 0 退出并点名
printf '  - id: "DOC-0500"\n    type: prd\n    path: a.md\n  - id: "DOC-0500"\n    type: prd\n    path: docs/good.md\n' >> "$FIX/docs/authority/DOCS-REGISTRY.yaml"
OUT_J1=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); _ej1=$?
t "J1 带引号 id 重号 → 非 0 退出" 1 $_ej1
printf '%s\n' "$OUT_J1" | grep -q '重号: DOC-0500' && { echo "  ✅ J1 带引号重号被点名"; PASS=$((PASS+1)); } || { echo "  ❌ J1 带引号重号未点名（正则不认引号）"; FAIL=$((FAIL+1)); }
cp "$FIX/reg2.bak" "$FIX/docs/authority/DOCS-REGISTRY.yaml"
# J2: 行尾注释重号 ⇒ 次数正确（出现 2 次）
printf '  - id: DOC-0501  # 行尾注释\n    type: prd\n    path: a.md\n  - id: DOC-0501\t# tab 注释\n    type: prd\n    path: docs/good.md\n' >> "$FIX/docs/authority/DOCS-REGISTRY.yaml"
OUT_J2=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); _ej2=$?
t "J2 行尾注释重号 → exit 1" 1 $_ej2
printf '%s\n' "$OUT_J2" | grep -q '重号: DOC-0501（出现 2 次）' && { echo "  ✅ J2 次数正确（出现 2 次）"; PASS=$((PASS+1)); } || { echo "  ❌ J2 次数失真（F2 未对齐）: $(printf '%s' "$OUT_J2" | grep '重号: DOC-0501' | head -1)"; FAIL=$((FAIL+1)); }
cp "$FIX/reg2.bak" "$FIX/docs/authority/DOCS-REGISTRY.yaml"
# J3: 还原 ⇒ exit 0
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "J3 还原 → exit 0" 0 $?
# J4: F1 fail-closed —— 台账里一条 DOC id 都解析不到（全是 T 型）⇒ exit 2 + 「不可见」
printf 'documents:\n  - id: T1\n    type: prd\n    path: a.md\n' > "$FIX/docs/authority/DOCS-REGISTRY.yaml"
OUT_J4=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); _ej4=$?
t "J4 解析到 0 条 DOC id → exit 2（fail-closed）" 2 $_ej4
printf '%s\n' "$OUT_J4" | grep -q '不可见' && { echo "  ✅ J4 打印「不可见」不静默"; PASS=$((PASS+1)); } || { echo "  ❌ J4 未打印「不可见」"; FAIL=$((FAIL+1)); }
cp "$FIX/reg2.bak" "$FIX/docs/authority/DOCS-REGISTRY.yaml"

# ═══ K. #976 存活: `status: active` 且 `path` 不在树内 ⇒ 红、逐条点名 ═══
# 缺口（K3 #974 D2）: 旧门禁只查"新增文档是否登记"，**不查已登记的是否还在**
#   ⇒ 台账可长期指向不存在的路径（实测 24 条 active 指向已不存在的文件）。
# 两态判据（缺一即无判别力）: ① 造 active+缺路径 ⇒ exit 1 并点名 ② 同台账改 archived ⇒ exit 0。
# 边界三例（防止"删字段/通配/看不见"绕过）:
#   K4 active 但无 path 字段 ⇒ 红（否则删 path 行即绕过）｜K5 一条 status 都解析不到 ⇒ exit 2
#   K6 active 且 path 是通配（`WORKLOG-*.md`）⇒ 红（通配不是"存在的文件"）
echo ""
echo "── K. #976 存活: active 且 path 不在树内 ⇒ 红、逐条点名 ──"
# ⚠️ 必须**脱离 $FIX**：$FIX 在 E 段已被 `git init` ⇒ 嵌套目录会走 git 模式，
#   扫到 FIX 仓的 staged-new（a.md/docs/*.md 等）⇒ 与本夹具台账无关的恒红。
KF=$(mktemp -d "${TMPDIR:-/tmp}/doc-gate-alive.XXXXXX")
trap 'rm -rf "$FIX" "$KF"' EXIT
mkdir -p "$KF/docs/authority" "$KF/docs"
: > "$KF/docs/live.md"
cat > "$KF/docs/authority/DOCS-REGISTRY.yaml" <<'EOF'
documents:
  - id: DOC-9101
    type: prd
    path: docs/live.md
    status: active
  - id: DOC-9102
    type: retrospective
    path: docs/gone.md
    status: archived
EOF

# K1: 存量降级口径 —— 缺文件的那条是 archived ⇒ 不查存活 ⇒ exit 0
OUT_K1=$(DOC_TRUTH_ROOT="$KF" bash "$SCRIPT" 2>&1); _ek1=$?
t "K1 archived 条目不查存活 → exit 0" 0 $_ek1
printf '%s\n' "$OUT_K1" | grep -q '存活: 1 条 status=active，path 失配 0 个' && { echo "  ✅ K1 汇总行报 active 计数（存活检查真跑过，非空转）"; PASS=$((PASS+1)); } || { echo "  ❌ K1 汇总行缺失/计数失真: $(printf '%s' "$OUT_K1" | grep '存活:' | head -1)"; FAIL=$((FAIL+1)); }

# K2: 把 DOC-9102 翻回 active（path 不存在）⇒ 必须 exit 1 且**逐条点名**（改坏即红）
sed -i.bak 's/^    status: archived$/    status: active/' "$KF/docs/authority/DOCS-REGISTRY.yaml"
OUT_K2=$(DOC_TRUTH_ROOT="$KF" bash "$SCRIPT" 2>&1); _ek2=$?
t "K2 active 且 path 不存在 → exit 1（改坏即红）" 1 $_ek2
printf '%s\n' "$OUT_K2" | grep -q '存活失配: DOC-9102' && { echo "  ✅ K2 逐条点名 DOC-9102"; PASS=$((PASS+1)); } || { echo "  ❌ K2 未点名 DOC-9102（判据未落）"; FAIL=$((FAIL+1)); }
printf '%s\n' "$OUT_K2" | grep -q 'docs/gone.md' && { echo "  ✅ K2 点名缺失路径 docs/gone.md"; PASS=$((PASS+1)); } || { echo "  ❌ K2 未点名缺失路径"; FAIL=$((FAIL+1)); }
printf '%s\n' "$OUT_K2" | grep -q '存活: 2 条 status=active，path 失配 1 个' && { echo "  ✅ K2 汇总行报失配数 1"; PASS=$((PASS+1)); } || { echo "  ❌ K2 汇总行未报失配数"; FAIL=$((FAIL+1)); }
printf '%s\n' "$OUT_K2" | grep -q '登记门禁阻断（active 条目 path 失配' && { echo "  ✅ K2 阻断行点明判据（active 条目 path 失配）"; PASS=$((PASS+1)); } || { echo "  ❌ K2 阻断行未点明判据"; FAIL=$((FAIL+1)); }

# K3: 还原为 archived ⇒ exit 0（两态闭环；证明 K2 的红来自本条判据、不是别的恒红）
mv "$KF/docs/authority/DOCS-REGISTRY.yaml.bak" "$KF/docs/authority/DOCS-REGISTRY.yaml"
OUT_K3=$(DOC_TRUTH_ROOT="$KF" bash "$SCRIPT" 2>&1); _ek3=$?
t "K3 还原 archived → exit 0（两态闭环）" 0 $_ek3

# K4: active 但**无 path 字段** ⇒ 红（否则删 path 行即可绕过判据）
cat >> "$KF/docs/authority/DOCS-REGISTRY.yaml" <<'EOF'
  - id: DOC-9103
    type: decision
    status: active
EOF
OUT_K4=$(DOC_TRUTH_ROOT="$KF" bash "$SCRIPT" 2>&1); _ek4=$?
t "K4 active 无 path 字段 → exit 1（删字段不可绕过）" 1 $_ek4
printf '%s\n' "$OUT_K4" | grep -q '存活失配: DOC-9103 status=active 但条目无 path 字段' && { echo "  ✅ K4 点名「无 path 字段」"; PASS=$((PASS+1)); } || { echo "  ❌ K4 未点名无 path 字段"; FAIL=$((FAIL+1)); }

# K6: active 且 path 是通配 ⇒ 红（通配不是"存在的文件"，不能算活）
python3 - "$KF/docs/authority/DOCS-REGISTRY.yaml" <<'PYEOF'
import sys, re
p = sys.argv[1]
s = open(p).read()
s = s.replace("""  - id: DOC-9103
    type: decision
    status: active
""", """  - id: DOC-9103
    type: diary
    path: WORKLOG-*.md
    status: active
""")
open(p, 'w').write(s)
PYEOF
OUT_K6=$(DOC_TRUTH_ROOT="$KF" bash "$SCRIPT" 2>&1); _ek6=$?
t "K6 active + 通配 path → exit 1（通配不算活）" 1 $_ek6
printf '%s\n' "$OUT_K6" | grep -q '存活失配: DOC-9103 path 不存在: WORKLOG-\*\.md' && { echo "  ✅ K6 通配路径被按字面判红"; PASS=$((PASS+1)); } || { echo "  ❌ K6 通配路径被当活件放过"; FAIL=$((FAIL+1)); }

# K5: fail-closed —— 台账里一条 status 字段都没有 ⇒ 存活检查不可执行 ⇒ exit 2（禁把看不见当没问题）
printf 'documents:\n  - id: DOC-9101\n    type: prd\n    path: docs/live.md\n' > "$KF/docs/authority/DOCS-REGISTRY.yaml"
OUT_K5=$(DOC_TRUTH_ROOT="$KF" bash "$SCRIPT" 2>&1); _ek5=$?
t "K5 0 条 status 字段 → exit 2（fail-closed）" 2 $_ek5
printf '%s\n' "$OUT_K5" | grep -q '不可见: 台账中解析到 0 条 status 字段' && { echo "  ✅ K5 打印「不可见」不静默"; PASS=$((PASS+1)); } || { echo "  ❌ K5 未打印「不可见」"; FAIL=$((FAIL+1)); }

# K7: 存量真实仓 ⇒ 绿（#976 批量降级后应 0 条 active 失配）
RR976="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_K7=$(DOC_TRUTH_ROOT="$RR976" bash "$SCRIPT" 2>&1); _ek7=$?
t "K7 存量真实仓 → exit 0（批量降级后 0 失配）" 0 $_ek7
_K7N=$(printf '%s\n' "$OUT_K7" | sed -n 's/.*存活: \([0-9][0-9]*\) 条 status=active，path 失配 \([0-9][0-9]*\) 个.*/\1 \2/p' | head -1)
set -- $_K7N
if [ -n "${1:-}" ] && [ "${1:-0}" -gt 0 ] && [ "${2:-1}" = "0" ]; then
  echo "  ✅ K7 存量：active=${1} 条、失配 0（判别力非空转：active 计数 > 0）"; PASS=$((PASS+1))
else
  echo "  ❌ K7 存量汇总异常（active=${1:-空} 失配=${2:-空}）"; FAIL=$((FAIL+1))
fi

# K8: 判别力自证 —— 变异实现（把 emit 判据改成永远不命中）跑 K2 的红态夹具
#   期望 **exit 0** ⇒ 说明"判据被删/被改坏"时 K2 必红（K2 的红来自该判据，不是别的恒红）。
MUT="${TMPDIR:-/tmp}/doc-gate-mut-$$.sh"
sed 's/st == "active"/st == "NEVER-MATCH"/g' "$SCRIPT" > "$MUT"
cp "$KF/docs/authority/DOCS-REGISTRY.yaml" "$KF/reg.k5.bak"
printf 'documents:\n  - id: DOC-9101\n    type: prd\n    path: docs/live.md\n    status: active\n  - id: DOC-9102\n    type: retrospective\n    path: docs/gone.md\n    status: active\n' > "$KF/docs/authority/DOCS-REGISTRY.yaml"
DOC_TRUTH_ROOT="$KF" bash "$MUT" >/dev/null 2>&1; _emut=$?
if [ "$_emut" = "0" ]; then
  echo "  ✅ K8 变异实现（判据被改坏）→ exit 0 ⇒ K2 的 exit 1 确由该判据产生（判别力自证）"; PASS=$((PASS+1))
else
  echo "  ❌ K8 变异实现仍 exit $_emut ⇒ K2 红来自别处（本条判据无判别力）"; FAIL=$((FAIL+1))
fi
cp "$KF/reg.k5.bak" "$KF/docs/authority/DOCS-REGISTRY.yaml"
rm -f "$MUT" "$KF/reg.k5.bak"

echo ""

# ═══ R1/R2（#1123 批1）：DOC 编号形态 + Issue 来源 ═══
export SYNO_DOCID_CHECK=1   # 本段夹具需要 R1/R2 生效（真实仓由基线驱动，无需此变量）
# 每个用例独立 fixture，避免状态耦合；非 DOC- 前缀 id 不参与 R1/R2
mkfix() { # $1=目录
  mkdir -p "$1/docs/authority" "$1/gate-exemptions"
}
wreg() { printf '%s\n' "$2" > "$1/docs/authority/DOCS-REGISTRY.yaml"; }

# H 形态合规 + 来源可达（文件名 -1234-）⇒ 0
H=$(mktemp -d); mkfix "$H"; : > "$H/gate-exemptions/2026-10-29-1234-demo.md"
wreg "$H" 'documents:
  - id: DOC-1234
    path: gate-exemptions/2026-10-29-1234-demo.md
    status: active'
DOC_TRUTH_ROOT="$H" bash "$SCRIPT" >/dev/null 2>&1; t "H 形态合规+来源可达" 0 $?

# I 形态不合规（DOC-1234-1，两位后缀要求）⇒ 1 且点名 R1
I=$(mktemp -d); mkfix "$I"; : > "$I/gate-exemptions/2026-10-29-1234-demo.md"
wreg "$I" 'documents:
  - id: DOC-1234-1
    path: gate-exemptions/2026-10-29-1234-demo.md
    status: active'
OUTI=$(DOC_TRUTH_ROOT="$I" bash "$SCRIPT" 2>&1); RCI=$?
t "I 形态不合规→红" 1 $RCI
echo "$OUTI" | grep -q '\[R1\]'; t "I2 点名 R1" 0 $?

# J 无来源（id 合规但文件名无 -N-、无 front-matter）⇒ 1 且点名 R2
J=$(mktemp -d); mkfix "$J"; : > "$J/gate-exemptions/plain-demo.md"
wreg "$J" 'documents:
  - id: DOC-2001
    path: gate-exemptions/plain-demo.md
    status: active'
OUTJ=$(DOC_TRUTH_ROOT="$J" bash "$SCRIPT" 2>&1); RCJ=$?
t "J 无来源→红" 1 $RCJ
echo "$OUTJ" | grep -q '\[R2\]'; t "J2 点名 R2" 0 $?

# K 同卡两件 DOC-3333-01 / -02（文件名各含 -3333-）⇒ 0
K=$(mktemp -d); mkfix "$K"
: > "$K/gate-exemptions/2026-10-29-3333-a.md"; : > "$K/gate-exemptions/2026-10-29-3333-b.md"
wreg "$K" 'documents:
  - id: DOC-3333-01
    path: gate-exemptions/2026-10-29-3333-a.md
    status: active
  - id: DOC-3333-02
    path: gate-exemptions/2026-10-29-3333-b.md
    status: active'
DOC_TRUTH_ROOT="$K" bash "$SCRIPT" >/dev/null 2>&1; t "K 同卡两件 -01/-02" 0 $?

# L 存量 DOC-0xxx 冻结（形态不合规也不红）⇒ 0
L=$(mktemp -d); mkfix "$L"; : > "$L/gate-exemptions/legacy.md"
wreg "$L" 'documents:
  - id: DOC-0123
    path: gate-exemptions/legacy.md
    status: archived'
DOC_TRUTH_ROOT="$L" bash "$SCRIPT" >/dev/null 2>&1; t "L 存量 DOC-0xxx 不误伤" 0 $?

# M 改坏即红：变异体把后缀 `(-[0-9]{2})?` 放宽为 `(-[0-9]+)?` ⇒ 用例 I 的 fixture 变 0（证明形态检查承重）
MUT=$(mktemp -d); cp "$SCRIPT" "$MUT/gate-mut.sh"
sed -i 's/(-\[0-9\]{2})?/(-\[0-9\]+)?/' "$MUT/gate-mut.sh"
M=$(mktemp -d); mkfix "$M"; : > "$M/gate-exemptions/2026-10-29-1234-demo.md"
wreg "$M" 'documents:
  - id: DOC-1234-1
    path: gate-exemptions/2026-10-29-1234-demo.md
    status: active'
DOC_TRUTH_ROOT="$M" bash "$MUT/gate-mut.sh" >/dev/null 2>&1; RCM=$?
if [ "$RCM" -eq 0 ]; then t "M 变异体放行→证明形态检查承重" 0 0; else t "M 改坏即红(变异体仍红)" 0 1; fi

# N 来源走 front-matter `任务: "#N"`（文件名无号）⇒ 0
N=$(mktemp -d); mkfix "$N"
printf '%s\n' '---' '任务: "#4400"' '---' '# demo' > "$N/gate-exemptions/demo-frontmatter.md"
wreg "$N" 'documents:
  - id: DOC-4400
    path: gate-exemptions/demo-frontmatter.md
    status: active'
DOC_TRUTH_ROOT="$N" bash "$SCRIPT" >/dev/null 2>&1; t "N front-matter 任务来源" 0 $?

unset SYNO_DOCID_CHECK
rm -rf "$H" "$I" "$J" "$K" "$L" "$M" "$N" "$MUT" 2>/dev/null # swallow-ok:

echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
