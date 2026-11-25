#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# pre-commit 硬阻断: 测试质量检查
#
# 不检查"有没有测试文件"（check-test-first.sh 已随 #1473 退役；该职责不再由本脚本代查）
# 检查"测试质量" — 新增 export 是否在测试中有实际断言。
#
# 挂在: pre-commit (物理阻断 — 新 export 无 assert/expect 不准提交)
# 原则: 增量阻断 (存量不追溯)
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

# ── 1. 找到本次新增的生产文件 ──
NEW_IMPL=$(git diff --cached --name-only --diff-filter=A 2>/dev/null \
  | grep '^src/.*\.ts$' | grep -v '\.test\.' | grep -v '\.d\.ts' \
  | grep -v 'types\.ts$\|index\.ts$\|helpers\.ts$\|builtins\.ts$' || true)

if [ -z "$NEW_IMPL" ]; then
  echo -e "  ${GREEN}✅ 测试质量: 无新增生产文件${RESET}"
  exit 0
fi

# ── 2. 对每个新文件检查 ──
QUALITY_FAILS=""
HAD_FAIL=0

while IFS= read -r impl; do
  [ -z "$impl" ] && continue
  [ ! -f "$impl" ] && continue

  # 提取 export 的函数/类/常量名
  EXPORTS=$(grep -oE 'export (function|class|const) [A-Za-z_][A-Za-z0-9_]*' "$impl" 2>/dev/null | sed -E 's/^export (function|class|const) //' || true)
  if [ -z "$EXPORTS" ]; then
    # 只有 type export — 不需要测试
    continue
  fi

  # 找到对应的测试文件
  test_file=$(echo "$impl" | sed 's|^src/|tests/|; s|\.ts$|.test.ts|')
  if [ ! -f "$test_file" ]; then
    # 测试文件不存在 — check-test-first.sh 已随 #1473 退役，不再兜底
    continue
  fi

  # ── 3. 对每个 export 检查测试中是否有断言 ──
  UNTESTED=""
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    # 跳过 mock/fake/internal/type
    if echo "$name" | grep -qi 'mock\|fake\|_internal\|_deprecated\|^[A-Z].*Props$\|^[A-Z].*Config$\|^[A-Z].*State$'; then continue; fi

    # 测试文件中是否引用了这个 export?
    if grep -q "\b${name}\b" "$test_file" 2>/dev/null; then
      # 是否有断言? expect/assert/tobe/toEqual
      # 在测试文件中找到引用该名称的行附近检查 expect
      test_lines=$(grep -n "\b${name}\b" "$test_file" 2>/dev/null | cut -d: -f1 || true)
      has_assert=false
      while IFS= read -r linenum; do
        [ -z "$linenum" ] && continue
        # 检查引用行前后 5 行是否有 expect/assert
        start=$((linenum - 3))
        [ "$start" -lt 1 ] && start=1
        end=$((linenum + 5))
        if sed -n "${start},${end}p" "$test_file" 2>/dev/null | grep -qE "expect\(|assert\b|\.toBe\(|\.toEqual\(|\.toMatch|\.toThrow|\.toHaveLength"; then
          has_assert=true
          break
        fi
      done <<< "$test_lines"
      if [ "$has_assert" = false ]; then
        UNTESTED="${UNTESTED}  ${name} (已引用但无断言)"$'\n'
      fi
    else
      UNTESTED="${UNTESTED}  ${name} (未在测试文件中引用)"$'\n'
    fi
  done <<< "$EXPORTS"

  if [ -n "$UNTESTED" ]; then
    QUALITY_FAILS="${QUALITY_FAILS}${impl}:"$'\n'"${UNTESTED}"$'\n'
    HAD_FAIL=1
  fi
done <<< "$NEW_IMPL"

# ── 4. 输出 ──
if [ "$HAD_FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}✅ 测试质量: 所有新 export 在测试中有断言${RESET}"
  exit 0
else
  echo -e "  ${RED}❌ 测试质量 (硬阻断): 新 export 缺少测试断言${RESET}"
  echo -e "$QUALITY_FAILS"
  echo ""
  echo "  修复方式: 在对应测试文件中为每个 export 添加 expect() 断言"
  echo "  如果 export 是内部辅助函数: 重命名为 _internal 前缀或移到 helpers.ts"
  exit 1
fi
