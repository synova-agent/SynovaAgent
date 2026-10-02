#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-truth.test.sh — 文档真相验证脚本测试（铁律 48：正常/降级/边界三路径）
#
# D1133（2026-10-03）门禁语义变更：C1/C2 判定面移出 CLAUDE.md；C3 改「单一真源
#   AGENTS.md」；版本真源不可解析 ⇒ exit 2 fail-closed。本夹具同步扩到 11 例。
#
# 用例（含 D1133 反例矩阵 5 条）:
#   A 三件齐+版本一致          → 0   （改造不误伤 —— 卡面反例矩阵第 1 条）
#   B AGENTS.md 专家数不符      → 1
#   C AGENTS.md 组数不符        → 1
#   D LOOP.md 版本 ≠ 真源       → 1   （卡面矩阵第 3 条：红并点名）
#   E 权威层路径缺失            → 1
#   F CLAUDE.md = 31 行指针件   → 0   （**卡面矩阵第 2 条 = 本卡目标态**）
#   G CLAUDE.md 缺失            → 0   （卡面矩阵第 5 条：已移出判定面）
#   H AGENTS.md 缺失            → 2   （卡面矩阵第 4 条：fail-closed）
#   I AGENTS.md 版本不可解析    → 2   （fail-closed，边界）
#   J LOOP.md 缺失              → 2   （fail-closed，边界；判定面不可判定）
#   K CLAUDE.md 专家数不符      → 0   （**语义变更证据**：CLAUDE.md 已移出 C1 判定面）
#
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

mk() { # 重建全部 fixture（每个用例都从干净基线起，防用例间污染）
  rm -rf "$FIX"; mkdir -p "$FIX/expert" "$FIX/scripts" "$FIX/docs/authority" "$FIX/knowledge/shared"
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
  printf '> V1.0.0 "Main" | 2026-08-19\n\npre-commit 5 组\n\n2位专家\n' > "$FIX/CLAUDE.md"
  printf '> V1.0.0\n\npre-commit 5 组\n' > "$FIX/LOOP.md"
  printf '2位专家\n' > "$FIX/knowledge/shared/README.md"
  : > "$FIX/CHRONICLE.md"; : > "$FIX/INDEX.md"; : > "$FIX/START-HERE.md"
  : > "$FIX/docs/authority/PRD.md"; : > "$FIX/docs/authority/ARCHITECTURE.md"
  : > "$FIX/docs/authority/STATUS.md"; : > "$FIX/docs/authority/DOCS-REGISTRY.yaml"
}
ptr() { # 31 行指针件的等价最小体（保留版本号 + 流程约束行，删专家数/组数声明）
  { echo '# CLAUDE.md — 已退役（指针件）'
    echo '> **V1.0.0** | 2026-08-19 | **本文件已退役，内容并入 AGENTS.md**'
    echo '**流程约束: V1.0.0** — 全文见 AGENTS.md（本文件不再重复）'; } > "$FIX/CLAUDE.md"
}
run() { DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1; echo $?; }

mk; t "A 三件齐+版本一致" 0 "$(run)"

mk; sed -i.bak 's/2位专家/3位专家/' "$FIX/AGENTS.md"
t "B AGENTS.md 专家数不符" 1 "$(run)"

mk; sed -i.bak 's/pre-commit 5 组/pre-commit 13 组/' "$FIX/AGENTS.md"
t "C AGENTS.md 组数不符" 1 "$(run)"

mk; sed -i.bak 's/V1.0.0/V2.0.0/' "$FIX/LOOP.md"
t "D LOOP.md 版本 ≠ 真源" 1 "$(run)"

mk; rm "$FIX/docs/authority/PRD.md"
t "E 权威层路径缺失" 1 "$(run)"

mk; ptr
t "F CLAUDE.md=指针件（目标态）" 0 "$(run)"

mk; rm "$FIX/CLAUDE.md"
t "G CLAUDE.md 缺失" 0 "$(run)"

mk; rm "$FIX/AGENTS.md"
t "H AGENTS.md 缺失（fail-closed）" 2 "$(run)"

mk; sed -i.bak 's/> V1.0.0 | 2026-08-19/> 无版本号 | 2026-08-19/' "$FIX/AGENTS.md"
t "I AGENTS.md 版本不可解析（fail-closed）" 2 "$(run)"

mk; rm "$FIX/LOOP.md"
t "J LOOP.md 缺失（fail-closed）" 2 "$(run)"

mk; sed -i.bak 's/2位专家/3位专家/' "$FIX/CLAUDE.md"
t "K CLAUDE.md 专家数不符（已移出判定面）" 0 "$(run)"

echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
