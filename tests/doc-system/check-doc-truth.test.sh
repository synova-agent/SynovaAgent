#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-truth.test.sh — 文档真相验证脚本测试（铁律 48：正常/边界/降级三路径）
# 用例: A 全一致→0 | B 专家数不符→1 | C 组数不符→1 | D 版本不符→1 | E 路径缺失→1
# 运行: bash tests/doc-system/check-doc-truth.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/doc-system/check-doc-truth.sh"
PASS=0; FAIL=0

t() { # $1=用例名 $2=期望exit $3=实际exit
  if [ "$2" = "$3" ]; then echo "  ✅ $1 (exit $3)"; PASS=$((PASS+1)); else echo "  ❌ $1 (期望 $2 实际 $3)"; FAIL=$((FAIL+1)); fi
}

FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT

# ── fixture：registry 2 专家 + pre-commit 自声明 5 组 + 文档全一致 + 权威层齐全 ──
mkdir -p "$FIX/expert" "$FIX/scripts" "$FIX/docs/authority" "$FIX/knowledge/shared"
cat > "$FIX/expert/expert-registry.yaml" <<'EOF'
experts:
  alpha:
    enabled: true
  beta:
    enabled: true
EOF
printf '  echo "  Loop Engineering V1.0.0 — pre-commit (5 组)"\n' > "$FIX/scripts/pre-commit-check.sh"
printf '  echo -e "  ✅ 全部 5 组通过"\n' >> "$FIX/scripts/pre-commit-check.sh"
printf '> V1.0.0 | 2026-08-19 | pre-commit 5 组\n\n2位专家\n' > "$FIX/AGENTS.md"
printf '> V1.0.0\n\npre-commit 5 组\n' > "$FIX/LOOP.md"
printf '2位专家\n' > "$FIX/knowledge/shared/README.md"
: > "$FIX/CHRONICLE.md"; : > "$FIX/INDEX.md"; : > "$FIX/START-HERE.md"
: > "$FIX/docs/authority/PRD.md"; : > "$FIX/docs/authority/ARCHITECTURE.md"
: > "$FIX/docs/authority/STATUS.md"; : > "$FIX/docs/authority/DOCS-REGISTRY.yaml"

DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "A 全一致" 0 $?

# B: 专家数不符
sed -i.bak 's/2位专家/3位专家/' "$FIX/AGENTS.md"
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "B 专家数不符" 1 $?
sed -i.bak 's/3位专家/2位专家/' "$FIX/AGENTS.md" && rm -f "$FIX/AGENTS.md.bak"

# C: 组数不符
sed -i.bak 's/pre-commit 5 组/pre-commit 13 组/' "$FIX/AGENTS.md"
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "C 组数不符" 1 $?
sed -i.bak 's/pre-commit 13 组/pre-commit 5 组/' "$FIX/AGENTS.md" && rm -f "$FIX/AGENTS.md.bak"

# D: 版本不符
sed -i.bak 's/V1.0.0/V2.0.0/' "$FIX/LOOP.md"
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "D 版本不符" 1 $?
sed -i.bak 's/V2.0.0/V1.0.0/' "$FIX/LOOP.md" && rm -f "$FIX/LOOP.md.bak"

# E: 权威层路径缺失
rm "$FIX/docs/authority/PRD.md"
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; t "E 路径缺失" 1 $?

echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
