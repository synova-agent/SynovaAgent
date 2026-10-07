#!/bin/bash
# #980 / 0-6 计划阶段 · 前提实测（可复跑；原始输出 = evidence-980-plan-preconditions.txt）
# 用法: bash docs/synova/product-lines/evidence/980/capture-980-preconditions.sh
# 纪律: 一律 git show/git grep origin/main（禁读工作树当权威）
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

echo "=== 环境 ==="
echo "captured_at_utc = $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "origin/main     = $(git rev-parse origin/main)  ($(git log --oneline -1 origin/main))"
echo "HEAD            = $(git rev-parse HEAD)  ($(git log --oneline -1 HEAD))"
echo "branch          = $(git symbolic-ref --short HEAD)"
echo "worktree        = $(pwd)"
echo ""

echo "=== P1: 静默放行点（卡面声称 :141）==="
git show origin/main:src/l4/sog-schema-validator.ts | sed -n '139,142p' | cat -n
echo "[exit=$?]"
echo ""

echo "=== P2: schema 块边界（卡面声称 :36-98）==="
git show origin/main:src/l4/sog-schema-validator.ts | grep -nE '^const NODE_SCHEMAS|^\};'
echo "[exit=$?]"
echo ""

echo "=== P2b: 8 个大写 schema 键（顶层缩进 2 空格 + ': {'）==="
git show origin/main:src/l4/sog-schema-validator.ts | awk 'NR>=36 && NR<=98 && /^  [A-Z_]+: \{/ {print NR": "$0}'
echo "键数 = $(git show origin/main:src/l4/sog-schema-validator.ts | awk 'NR>=36 && NR<=98 && /^  [A-Z_]+: \{/' | wc -l)"
echo ""

echo "=== P3: 校验器引用分布（全仓，完整输出）==="
git grep -n -E 'validateNodeProps|validateAndLog' origin/main -- src packages tests
echo "命中行数 = $(git grep -n -E 'validateNodeProps|validateAndLog' origin/main -- src packages tests | wc -l)"
echo ""

echo "=== P4: sog-schema-validator 全仓引用 ==="
git grep -n 'sog-schema-validator' origin/main
echo "命中行数 = $(git grep -n 'sog-schema-validator' origin/main | wc -l)"
echo ""

echo "=== P5: 判据交付物 probe-diagnosis.ts 是否存在 ==="
echo "scripts/control-tower 内 probe* 命中数 = $(git ls-tree -r --name-only origin/main -- scripts/control-tower/ | grep -c 'probe' || true)"
echo "全仓 probe-diagnosis 命中数 = $(git ls-tree -r --name-only origin/main | grep -c 'probe-diagnosis' || true)"
echo "scripts/control-tower 文件总数 = $(git ls-tree -r --name-only origin/main -- scripts/control-tower/ | wc -l)"
echo ""

echo "=== P6: 目标文件 blob 在 baseline→现 main 漂移中是否变化 ==="
echo "9e9e4bd9d:src/l4/sog-schema-validator.ts = $(git rev-parse 9e9e4bd9d:src/l4/sog-schema-validator.ts)"
echo "origin/main:src/l4/sog-schema-validator.ts = $(git rev-parse origin/main:src/l4/sog-schema-validator.ts)"
echo "9e9e4bd9d:src/l4/graph-bridge.ts        = $(git rev-parse 9e9e4bd9d:src/l4/graph-bridge.ts)"
echo "origin/main:src/l4/graph-bridge.ts        = $(git rev-parse origin/main:src/l4/graph-bridge.ts)"
echo ""

echo "=== P7: 与在飞 #1322 分支的写集对比 ==="
echo "--- feat/1322-goal-creation-entry 相对 main 的改动文件 ---"
git diff --name-only origin/main...origin/feat/1322-goal-creation-entry 2>/dev/null || echo "(分支 ref 不可解析)"
echo "--- 我的分支相对 main 的改动文件 ---"
git diff --name-only origin/main...HEAD
echo "--- 两集合交集（应为空）---"
comm -12 <(git diff --name-only origin/main...origin/feat/1322-goal-creation-entry 2>/dev/null | sort) <(git diff --name-only origin/main...HEAD | sort) || true
echo ""

echo "=== P8: 架构规则相关（layer boundary 不新增跨层 import）==="
echo "HEAD 相对 main 的改动是否触及 src/（应为空 = 纯文档阶段）:"
git diff --name-only origin/main...HEAD -- src/ | sed 's/^/  /'
echo "（空 = 未触及 src/）"
echo ""

echo "=== P9: R28 地雷文件基线哈希（跑探针前后须一致）==="
for f in $(git ls-files 'extensions/industries/*/thresholds.json'); do
  printf '%s  %s\n' "$(git hash-object "$f")" "$f"
done
echo ""

echo "=== DONE ==="
