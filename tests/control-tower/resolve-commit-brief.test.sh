#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# resolve-commit-brief.test.sh — D317 回退过滤测试（G12b CI 红根因）
#
# 覆盖（铁律 48：正常/降级/边界）:
#   1. 仅 legacy 不可解析 brief（无 #CRITERIA）→ 最终回退 exit 1（fail-open），
#      绝不静默返回坏 brief（修复前返回它 exit 0 = red）
#   2. 可解析 + 不可解析混存 → 返回最新可解析者（修复前返回最新=不可解析者 = red）
#   3. 仅可解析 brief → 返回该 brief（回归）
#   4. 过期 current-brief（日期≠今日）忽略 → 走回退
#   5. D559 日期窗口 +1 天（UTC 容差）
#   6. 窗口边界：today-2 brief 不参与认领（防跨 session 误伤）
#   7. 陈旧 current-brief 文件存在 → 忽略（D660/D661 根因）
#   D718 跨日任务 + 共享文件归属（身份锚点，8/9/10/11）:
#   8. brief 生成日 today-3 + 分支名含 D# → 认领自己的 brief（修复前落到无关今日 brief = red）
#   9. brief 生成日 today-3 + 暂存 task-state/D#.json → 同上（分支无 D# 时的锚点）
#  10. 负向：无身份锚点的跨日 brief 不得劫持（防「窗口放宽」式退化，D291/D296 保护不回归）
#  11. 共享文件同数认领（tie）→ 身份锚点 brief 胜出（修复前字典序 → 陈旧 brief 恒胜，
#      staging_guard 判「认领 brief D# ≠ 本 session 任务」硬阻断；D718 执行期真实被拦一次）
#  12. CT-A1: 同数认领 + **无任何身份锚点** → fail-closed（exit 2 + 点名全部并列候选）。
#      修复前 max()+字典序 print(top[0]) 静默取首位（陈旧 brief 可恒胜且零告警）= red。
#
# 隔离: 临时 repo（mktemp -d + git init）— resolver 用 git rev-parse --show-toplevel
# 定位 ROOT；brief 放临时 repo 的 .claude/task-briefs/（mtime 今日 → ALL_TODAY 候选）
# 变异测试缝: SYNO_RESOLVER_UNDER_TEST=<路径> 可指定被测 resolver（「改坏即红」用 /tmp
#   下的修复前副本跑同一套断言，无需改动仓库文件；不设置时测仓库内实现）。
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESOLVER="${SYNO_RESOLVER_UNDER_TEST:-$REPO_DIR/scripts/workflow/resolve-commit-brief.sh}"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_exit() { # <got_exit> <want_exit> <msg>
  if [ "$1" -eq "$2" ]; then pass "$3 (exit=$1)"; else fail "$3 — exit=$1 期望 $2"; fi
}
assert_contains() { # <haystack> <needle> <msg>
  if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi
}
assert_not_contains() { # <haystack> <needle> <msg>
  if echo "$1" | grep -qF "$2"; then fail "$3 — 不应包含: $2"; else pass "$3"; fi
}

TODAY=$(date +%Y-%m-%d)

# resolver 修复后 exit 1 会触发外层 set -e → 统一在子 shell 捕获
run_resolver() { # <repo> [staged] → 设置 OUT + EC
  set +e
  OUT=$(cd "$1" && bash "$RESOLVER" "${2:-}" 2>&1)
  EC=$?
  set -e
}

new_repo() {
  local d; d=$(mktemp -d)
  git -C "$d" init -q 2>/dev/null || true
  mkdir -p "$d/.claude/task-briefs"
  echo "$d"
}

# 可解析 brief（含 #CRITERIA）
make_parseable() { # <repo> <filename>
  cat > "$1/.claude/task-briefs/$2" <<EOF
## Q0: 定位 — 测试

## Q1: 调研 — 测试
#CRITERIA: A

## Q2: 范围 — 测试
做什么：
- scripts/test.sh

不做什么：
- 不改 scripts/test.sh

## Q3: 验收 — 测试

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
}

# legacy brief（无 #CRITERIA，模拟 D286 旧模板）
make_legacy() { # <repo> <filename>
  cat > "$1/.claude/task-briefs/$2" <<EOF
## Q0: 定位 — legacy

## Q1: 调研 — legacy

## Q2: 范围 — legacy

## Q3: 验收 — legacy

## 架构层: L4
## Done 标准
- [ ] 入口可触达
EOF
}

echo "═══════════════════════════════════════════════════════════"
echo "  D317 resolve-commit-brief 回退过滤测试"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "── 1. 仅 legacy 不可解析 brief → 回退 exit 1 (fail-open) ──"
R1=$(new_repo)
make_legacy "$R1" "${TODAY}-legacy-only.md"
run_resolver "$R1"
assert_exit "$EC" 1 "仅 legacy 时回退 exit 1（不静默返回坏 brief）"
assert_not_contains "$OUT" "legacy-only" "输出不含不可解析 brief"
assert_exit "$([ -n "$OUT" ] && echo 0 || echo 1)" 1 "输出为空（无可用 brief）"
echo ""

echo "── 2. 可解析 + 不可解析混存 → 返回最新可解析者 ──"
R2=$(new_repo)
make_legacy "$R2" "${TODAY}-legacy-newer.md"       # 今日不可解析（修复前: 回退选中它 = red）
make_parseable "$R2" "2026-07-31-parseable-older.md" # 旧日期可解析（修复前: 被日期排序忽略）
run_resolver "$R2"
assert_exit "$EC" 0 "混存时回退成功"
assert_contains "$OUT" "parseable-older" "返回可解析 brief（跳过日期最新的不可解析者）"
assert_not_contains "$OUT" "legacy-newer" "不返回不可解析 brief"
echo ""

echo "── 3. 仅可解析 brief → 返回该 brief（回归）──"
R3=$(new_repo)
make_parseable "$R3" "${TODAY}-only-parseable.md"
run_resolver "$R3"
assert_exit "$EC" 0 "仅可解析时回退成功"
assert_contains "$OUT" "only-parseable" "返回可解析 brief"
echo ""

echo "── 4. 过期 current-brief（日期≠今日）忽略 → 走回退 ──"
R4=$(new_repo)
echo "2026-07-14-D83-bootstrap-startup-sequence.md" > "$R4/.claude/current-brief"
make_parseable "$R4" "${TODAY}-with-stale-cur.md"
run_resolver "$R4"
assert_exit "$EC" 0 "过期 current-brief 忽略后回退成功"
assert_contains "$OUT" "with-stale-cur" "回退返回今日可解析 brief（非陈旧 current-brief）"
assert_not_contains "$OUT" "D83" "不返回陈旧 current-brief"
echo ""

echo "── 5. 日期窗口 +1 天：明日（UTC+8 vs CI UTC）brief 认领更多文件 → 胜出（D559/PR #295 实证）──"
R5=$(new_repo)
TOMORROW=$(python3 -c "from datetime import date,timedelta; print((date.today()+timedelta(days=1)).isoformat())" 2>/dev/null || echo "")
TWO_AGO=$(python3 -c "from datetime import date,timedelta; print((date.today()-timedelta(days=2)).isoformat())" 2>/dev/null || echo "")
# 明日 brief 认领 2 个文件；今日 brief 只认领 1 个——窗口失效时明日被排除、今日以 n=1 胜出（错误结果）
cat > "$R5/.claude/task-briefs/${TOMORROW}-tomorrow-claims2.md" <<EOF
## Q0: 定位 — 明日双文件认领

## Q1: 调研 — 明日双文件认领
#CRITERIA: A

## Q2: 范围 — 明日双文件认领
做什么：
- scripts/a.sh
- scripts/b.sh

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 明日双文件认领

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
cat > "$R5/.claude/task-briefs/${TODAY}-today-claims1.md" <<EOF
## Q0: 定位 — 今日单文件认领

## Q1: 调研 — 今日单文件认领
#CRITERIA: A

## Q2: 范围 — 今日单文件认领
做什么：
- scripts/a.sh

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 今日单文件认领

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
run_resolver "$R5" "scripts/a.sh
scripts/b.sh"
assert_exit "$EC" 0 "明日 brief 认领成功"
assert_contains "$OUT" "tomorrow-claims2" "窗口内明日 brief 以认领数胜出（UTC 时区容差）"
assert_not_contains "$OUT" "today-claims1" "不误选认领更少的今日 brief"
echo ""

echo "── 6. 窗口边界：前日（today-2）brief 不参与认领（防窗口过度放宽）──"
R6=$(new_repo)
cat > "$R6/.claude/task-briefs/${TWO_AGO}-stale-claims2.md" <<EOF
## Q0: 定位 — 前日双文件认领

## Q1: 调研 — 前日双文件认领
#CRITERIA: A

## Q2: 范围 — 前日双文件认领
做什么：
- scripts/a.sh
- scripts/b.sh

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 前日双文件认领

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
cat > "$R6/.claude/task-briefs/${TODAY}-today-claims1b.md" <<EOF
## Q0: 定位 — 今日单文件认领

## Q1: 调研 — 今日单文件认领
#CRITERIA: A

## Q2: 范围 — 今日单文件认领
做什么：
- scripts/a.sh

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 今日单文件认领

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
run_resolver "$R6" "scripts/a.sh
scripts/b.sh"
assert_exit "$EC" 0 "今日 brief 认领成功"
assert_contains "$OUT" "today-claims1b" "窗口外（today-2）brief 不参与，今日 brief 胜出"
assert_not_contains "$OUT" "stale-claims2" "前日 brief 被窗口排除（±1 天边界）"
echo ""

echo "── 7. 陈旧 current-brief 文件存在（D660/D661 macOS grep -oP 失效根因）→ 忽略 → 走回退 ──"
R7=$(new_repo)
# 陈旧 brief 文件真实存在（D660: macOS grep -oP 失效 → BD 空 → 陈旧 brief 被误用为回退）
make_parseable "$R7" "2026-07-14-D83-stale-existing.md"
echo "2026-07-14-D83-stale-existing.md" > "$R7/.claude/current-brief"
# 今日 brief 认领 scripts/test.sh（与暂存 scripts/a.sh 不匹配 → 认领数 0 → 触发回退路径）
make_parseable "$R7" "${TODAY}-today-noclaim.md"
run_resolver "$R7" "scripts/a.sh"
assert_exit "$EC" 0 "陈旧 current-brief 忽略后回退成功"
assert_contains "$OUT" "today-noclaim" "回退返回今日可解析 brief"
assert_not_contains "$OUT" "D83" "不返回陈旧 current-brief（即使其文件存在）"
echo ""

echo "── 8. D718 跨日任务（D664 型）：brief 生成日 >1 天前 + 分支带 D# → 必须认领自己的提交 ──"
# 缺陷：候选集纯按文件名日期 today±1 → brief 生成 09-10、执行 09-12 时该 brief 永不入池 →
#   认领恒空 → 回退落到无关 brief（= D328 判「他人文件」硬阻断，D664 实测被拦 2 次）。
#   身份锚点（分支名 D#）必须把该 brief 拉回候选池。
R8=$(new_repo)
THREE_AGO=$(python3 -c "from datetime import date,timedelta; print((date.today()-timedelta(days=3)).isoformat())" 2>/dev/null || echo "")
git -C "$R8" symbolic-ref HEAD refs/heads/fix/D664-crossday 2>/dev/null || true
cat > "$R8/.claude/task-briefs/${THREE_AGO}-D664-crossday-task.md" <<EOF
## Q0: 定位 — 跨日任务自身 brief

## Q1: 调研 — 跨日任务自身 brief
#CRITERIA: A

## Q2: 范围 — 跨日任务自身 brief
做什么：
- scripts/a.sh

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 跨日任务自身 brief

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
make_parseable "$R8" "${TODAY}-today-unrelated.md"   # 今日无关 brief（认领数 0）——旧逻辑会回退到它
run_resolver "$R8" "scripts/a.sh"
assert_exit "$EC" 0 "跨日任务认领成功（修复前：回退到无关 brief = 认领失败）"
assert_contains "$OUT" "D664-crossday-task" "返回本任务 brief（身份锚点：分支名 D#）"
assert_not_contains "$OUT" "today-unrelated" "不落到无关的今日 brief"
echo ""

echo "── 9. D718 跨日 + 暂存 task-state/D#.json 锚点（分支无 D#）→ 同样必须认领 ──"
R9=$(new_repo)
cat > "$R9/.claude/task-briefs/${THREE_AGO}-D700-crossday-task.md" <<EOF
## Q0: 定位 — 跨日任务（暂存锚点）

## Q1: 调研 — 跨日任务（暂存锚点）
#CRITERIA: A

## Q2: 范围 — 跨日任务（暂存锚点）
做什么：
- task-state/D700.json

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 跨日任务（暂存锚点）

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
make_parseable "$R9" "${TODAY}-today-unrelated2.md"
run_resolver "$R9" "task-state/D700.json"
assert_exit "$EC" 0 "暂存 task-state 锚点认领成功"
assert_contains "$OUT" "D700-crossday-task" "返回本任务 brief（身份锚点：暂存路径 D#）"
assert_not_contains "$OUT" "today-unrelated2" "不落到无关的今日 brief"
echo ""

echo "── 10. D718 负向：无身份锚点的跨日 brief 仍不得劫持认领（D291/D296 保护不回归）──"
# 修复不可退化为「窗口放宽」：没有身份证据的陈旧 brief 即使认领更多文件也不得入池。
R10=$(new_repo)
cat > "$R10/.claude/task-briefs/${THREE_AGO}-D664-stale-nohijack.md" <<EOF
## Q0: 定位 — 无锚点陈旧 brief

## Q1: 调研 — 无锚点陈旧 brief
#CRITERIA: A

## Q2: 范围 — 无锚点陈旧 brief
做什么：
- scripts/a.sh
- scripts/b.sh

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 无锚点陈旧 brief

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
make_parseable "$R10" "${TODAY}-today-claims1c.md"   # 只认领 1 个文件
run_resolver "$R10" "scripts/a.sh
scripts/b.sh"
assert_exit "$EC" 0 "无锚点场景认领成功"
assert_contains "$OUT" "today-claims1c" "今日 brief 胜出（陈旧 brief 无身份证据 → 不入池）"
assert_not_contains "$OUT" "stale-nohijack" "无锚点陈旧 brief 未劫持认领（防窗口放宽式退化）"
echo ""

echo "── 11. D718 共享文件同数认领（tie）→ 身份锚点 brief 必须胜出（旧逻辑字典序 = 陈旧 brief 恒胜）──"
# 实测现场: 修 pre-doc-audit.sh 时，D664 brief（历史改过该文件）与本任务 brief 同数认领 →
#   稳定排序按字典序 → 2026-09-12-D664-* 恒胜 2026-09-13-D718-* → staging_guard 判
#   「认领 brief D# ≠ 本 session 任务」硬阻断（D718 本单真实被拦一次）。
R11=$(new_repo)
git -C "$R11" symbolic-ref HEAD refs/heads/fix/D900-tiebreak 2>/dev/null || true
cat > "$R11/.claude/task-briefs/${TODAY}-D664-tiebreak-older.md" <<EOF
## Q0: 定位 — 历史任务（同文件）

## Q1: 调研 — 历史任务（同文件）
#CRITERIA: A

## Q2: 范围 — 历史任务（同文件）
做什么：
- scripts/a.sh

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 历史任务（同文件）

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
cat > "$R11/.claude/task-briefs/${TODAY}-D900-tiebreak-current.md" <<EOF
## Q0: 定位 — 本任务（同文件）

## Q1: 调研 — 本任务（同文件）
#CRITERIA: A

## Q2: 范围 — 本任务（同文件）
做什么：
- scripts/a.sh

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 本任务（同文件）

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
run_resolver "$R11" "scripts/a.sh"
assert_exit "$EC" 0 "同数认领场景解析成功"
assert_contains "$OUT" "D900-tiebreak-current" "身份锚点（分支 D900）brief 在同数认领中胜出"
assert_not_contains "$OUT" "D664-tiebreak-older" "陈旧共享 brief 不因字典序靠前而胜出"
echo ""

echo "── 12. CT-A1: 同数认领 + 无任何身份锚点 → fail-closed（exit 2 + 点名全部候选）──"
# 缺陷: 同层并列时原实现 top.sort() + print(top[0]) 静默按字典序取首位——无锚点证据也照样
#   输出一个 brief（陈旧 brief 可恒胜），且零告警（认领制失去物理依据）。
# 判据（改坏即红）: 删除 fail-closed 逻辑（还原 print(top[0])）→ 本场景必须变红。
R12=$(new_repo)
# 显式确保无强锚点: 分支名不含 D#（git init 默认 master/main）
git -C "$R12" symbolic-ref HEAD refs/heads/tie-noanchor 2>/dev/null || true
cat > "$R12/.claude/task-briefs/${TODAY}-tie-noanchor-a.md" <<EOF
## Q0: 定位 — 并列候选 A

## Q1: 调研 — 并列候选 A
#CRITERIA: A

## Q2: 范围 — 并列候选 A
做什么：
- scripts/a.sh

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 并列候选 A

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
cat > "$R12/.claude/task-briefs/${TODAY}-tie-noanchor-b.md" <<EOF
## Q0: 定位 — 并列候选 B

## Q1: 调研 — 并列候选 B
#CRITERIA: A

## Q2: 范围 — 并列候选 B
做什么：
- scripts/a.sh

不做什么：
- 不改 docs/other.md

## Q3: 验收 — 并列候选 B

## 架构层: 基础设施
## Done 标准
- [ ] 可验证
EOF
run_resolver "$R12" "scripts/a.sh"
assert_exit "$EC" 2 "同数且无锚点 → exit 2（fail-closed，不猜 brief）"
assert_contains "$OUT" "tie-noanchor-a" "点名并列候选 A（完整路径）"
assert_contains "$OUT" "tie-noanchor-b" "点名并列候选 B（完整路径）"
assert_contains "$OUT" "fail-closed" "输出显式声明 fail-closed 语义"
# 反例保护: 不得静默输出任一 brief 到 stdout（stdout 是「路径」通道）
_STDOUT_LINES=$(cd "$R12" && bash "$RESOLVER" "scripts/a.sh" 2>/dev/null | grep -c . || true)
[ "$_STDOUT_LINES" = "0" ] && pass "stdout 为空（并列时绝不输出任何 brief 路径）" || fail "stdout 非空: ${_STDOUT_LINES} 行"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ resolve-commit-brief 回退过滤测试未通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
echo "  Status: ✅ resolve-commit-brief 回退过滤测试全部通过"
echo "═══════════════════════════════════════════════════════════"
exit 0
