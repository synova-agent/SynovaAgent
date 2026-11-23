#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# today-by-name.test.sh — D366 单测: 文件名日期筛选函数 today_files_by_prefix/suffix
#
# 缺陷 A 回归 (dev doc §4 RED 场景 1, D362 死锁复现):
#   git pull 刷 mtime 后, 旧逻辑 find -newermt 把 346 个历史 brief 全部误判为今日
#   → 修复后按文件名日期前缀/后缀筛选, 346 → 1。
#
# 测试策略: 不 source 生产脚本 (会执行 main 逻辑), 而是用 sed 提取真实函数体
#   eval 进本测试的 set -euo pipefail 环境 — 锁死三个行为:
#   1) 函数在生产脚本中真实存在 (提取为空 = RED)
#   2) 函数在 pipefail 下安全: 文件名不匹配日期时不得崩溃
#      (dev doc §3.2 草图的 `| tail -1` 无 || true 陷阱 — 断言 9 覆盖)
#   3) 性能: 纯 bash for+case 零子进程, 346 文件必须秒级 — 旧 grep|head 实现
#      每文件 3 spawn, Windows 349 brief 实测 >30s 门禁挂死 (决策点 4 — 性能断言)
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }
check() { # check <描述> <期望> <实际>
  if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (期望 [$2] 实际 [$3])"; fi
}
count_lines() { # count_lines <多行输出> — 空输出计 0 (echo "" | wc -l = 1 是坑)
  if [ -z "$1" ]; then echo 0; else echo "$1" | wc -l | tr -d ' \r'; fi
}

# 固定"今天" — 生产函数读全局 TODAY_DASH/TODAY_COMPACT, 测试覆盖为固定值保证确定性
TODAY_DASH="2026-08-15"
TODAY_COMPACT="20260815"

# ── 0. 提取生产函数体 (RED: 实现前提取为空 → 本组失败) ──
echo "── 0. 生产定义提取 ──"
PREFIX_FN=$(sed -n '/^today_files_by_prefix()/,/^}/p' "$TEST_ROOT/scripts/pre-commit-check.sh" || true)
SUFFIX_FN=$(sed -n '/^today_files_by_suffix()/,/^}/p' "$TEST_ROOT/scripts/control-tower/verify-parallel.sh" || true)

if [ -n "$PREFIX_FN" ]; then ok "pre-commit-check.sh 定义 today_files_by_prefix"; else fail "pre-commit-check.sh 未定义 today_files_by_prefix (提取为空)"; fi
if [ -n "$SUFFIX_FN" ]; then ok "verify-parallel.sh 定义 today_files_by_suffix"; else fail "verify-parallel.sh 未定义 today_files_by_suffix (提取为空)"; fi

# 语法自检: 提取的函数体 bash -n 必须合法
SYNTAX_FILE=$(mktemp)
printf '%s\n%s\n' "$PREFIX_FN" "$SUFFIX_FN" > "$SYNTAX_FILE"
if bash -n "$SYNTAX_FILE"; then ok "提取函数体 bash -n 语法合法"; else fail "提取函数体语法错误 (见上方 stderr)"; fi
rm -f "$SYNTAX_FILE"

if [ -z "$PREFIX_FN" ] || [ -z "$SUFFIX_FN" ]; then
  echo ""
  echo "RED: 生产脚本尚未定义 today_files_by_* — 先实现 (dev doc §4 测试优先)"
  echo "结果: 通过 $PASS / 失败 $FAIL"
  exit 1
fi

eval "$PREFIX_FN"
eval "$SUFFIX_FN"

# ── 1. 缺陷 A 复现: 346 个 brief, mtime 全部=现在, 仅 1 个文件名是今日 ──
echo ""
echo "── 1. brief 前缀筛选 (D362 死锁复现) ──"
TMPROOT=$(mktemp -d)
trap 'rm -rf "$TMPROOT"' EXIT
BRIEF_DIR="$TMPROOT/briefs"
mkdir -p "$BRIEF_DIR"
i=1
while [ "$i" -le 344 ]; do touch "$BRIEF_DIR/2026-06-01-hist-$i.md"; i=$((i + 1)); done
touch "$BRIEF_DIR/2026-08-15-today.md" "$BRIEF_DIR/2026-08-14-yesterday.md"
# 全部 346 个文件 mtime = 现在 (touch 即刷), 与 git pull 刷 mtime 等效

# 旧逻辑基线: find -newermt (缺陷 A 的根因, 仅测试内复现对比, 生产已清零 DS1)
LEGACY=$(find "$BRIEF_DIR" -maxdepth 1 -name "*.md" -newermt "$TODAY_DASH 00:00:00" | sort || true)
LEGACY_COUNT=$(count_lines "$LEGACY")
check "旧逻辑基线: mtime 判定返回 346 (缺陷 A 复现)" "346" "$LEGACY_COUNT"

FIXED=$(today_files_by_prefix "$BRIEF_DIR" || true)
FIXED_COUNT=$(count_lines "$FIXED")
check "修复后: 文件名日期前缀判定返回 1 (346 → 1)" "1" "$FIXED_COUNT"

# 性能断言 (决策点 4): 346 文件必须 ≤10s — 旧 grep|head 实现每文件 3 spawn,
# Windows 349 brief 实测 >30s (resolve-commit-brief 挂死复现, 门禁整体超时根因)
PERF_START=$(date +%s)
_PERF_OUT=$(today_files_by_prefix "$BRIEF_DIR" || true)
PERF_END=$(date +%s)
PERF_SECONDS=$((PERF_END - PERF_START))
if [ "$PERF_SECONDS" -le 10 ]; then
  ok "性能: 346 文件筛选 ≤10s (实测 ${PERF_SECONDS}s)"
else
  fail "性能: 346 文件筛选 ${PERF_SECONDS}s > 10s (子进程风暴回归)"
fi
if echo "$FIXED" | grep -qF "2026-08-15-today.md"; then
  ok "今日文件名 brief 命中"
else
  fail "今日文件名 brief 未命中 (输出: $FIXED)"
fi
if echo "$FIXED" | grep -qF "2026-08-14-yesterday.md"; then
  fail "昨日文件名 brief (mtime 今日) 不应命中"
else
  ok "边界: 昨日文件名 (mtime 今日) 不命中"
fi
if echo "$FIXED" | grep -qF "2026-06-01"; then
  fail "历史文件名 brief (mtime 今日) 不应命中"
else
  ok "边界: 历史文件名 (mtime 今日) 不命中"
fi

# ── 2. 无今日文件 ──
echo ""
echo "── 2. 无今日文件 ──"
EMPTY_DIR="$TMPROOT/empty"
mkdir -p "$EMPTY_DIR"
touch "$EMPTY_DIR/2026-06-02-old.md"
EMPTY_OUT=$(today_files_by_prefix "$EMPTY_DIR" || true)
EMPTY_COUNT=$(count_lines "$EMPTY_OUT")
check "无今日文件: 输出为空" "0" "$EMPTY_COUNT"

# ── 3. dev doc 后缀筛选 ──
echo ""
echo "── 3. dev doc 后缀筛选 (-YYYYMMDD.md) ──"
DEV_DIR="$TMPROOT/devdocs"
mkdir -p "$DEV_DIR"
touch "$DEV_DIR/SYNOVA-IMPL-D366-x-20260815.md" \
      "$DEV_DIR/SYNOVA-IMPL-D307-y-20260814.md" \
      "$DEV_DIR/SYNOVA-IMPL-nodate.md"
SFIX=$(today_files_by_suffix "$DEV_DIR" || true)
SFIX_COUNT=$(count_lines "$SFIX")
check "后缀: 仅今日 dev doc 命中 (3 选 1)" "1" "$SFIX_COUNT"
if echo "$SFIX" | grep -qF "20260815"; then ok "今日后缀 -20260815.md 命中"; else fail "今日后缀未命中 (输出: $SFIX)"; fi
if echo "$SFIX" | grep -qF "20260814"; then
  fail "昨日后缀 -20260814.md (mtime 今日) 不应命中"
else
  ok "边界: 昨日后缀 (mtime 今日) 不命中"
fi
if echo "$SFIX" | grep -qF "nodate"; then
  fail "无日期文件名不应命中"
else
  # 断言 9 (pipefail 陷阱): nodate 文件名不匹配 case 模式 — 纯 bash case 无管道,
  # set -euo pipefail 下天然安全 (dev doc §3.2 草图的 grep|tail 无 || true 会杀死循环)
  ok "陷阱: 无日期文件名在 pipefail 下不崩溃且被排除 (case 模式不匹配)"
fi

# ── 4. 生产接线 (DS2) ──
echo ""
echo "── 4. 生产调用点 (DS2: ≥3) ──"
CALLS=$(grep -hc "today_files_by" \
  "$TEST_ROOT/scripts/pre-commit-check.sh" \
  "$TEST_ROOT/scripts/workflow/resolve-commit-brief.sh" \
  "$TEST_ROOT/scripts/control-tower/verify-parallel.sh" \
  | awk '{s+=$1} END {print s+0}' || true)
if [ "$CALLS" -ge 3 ]; then ok "3 脚本 today_files_by 生产调用 ≥3 (实际 $CALLS)"; else fail "生产调用不足 3 (实际 $CALLS)"; fi

echo ""
echo "结果: 通过 $PASS / 失败 $FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
