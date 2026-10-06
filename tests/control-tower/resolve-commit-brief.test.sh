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
#
# 隔离: 临时 repo（mktemp -d + git init）— resolver 用 git rev-parse --show-toplevel
# 定位 ROOT；brief 放临时 repo 的 .claude/task-briefs/（mtime 今日 → ALL_TODAY 候选）
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESOLVER="$REPO_DIR/scripts/workflow/resolve-commit-brief.sh"

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

# ═══════════════════════════════════════════════════════════════════════════════
# D1069 追加段（用例 12–24）—— 强锚点优先级 / 认领计数去重 / D# 两级定位
#
# 写集说明: D1069 只**追加**本段；上方 1–395 行（用例 1–11 的全部断言与夹具）
#   字节未动，保持 C4「既有套件全绿」的可判别性。本段独立计数 D_PASS/D_FAIL，
#   在汇总前折入总计数。
# 选型说明: 不新建 tests/**/*.test.sh —— 新建 sh/py 测试会触发 M9 密封面棘轮
#   CI-REGISTRY 违规（check-gate-integrity.sh B 模式；实测「基线外新增 1 /
#   GATE-INTEGRITY: VIOLATION(1)」）。本文件已在 gate-integrity-baseline.txt:88。
#
# 覆盖矩阵（铁律 48：正常 / 降级 / 边界；正反例都断言）
# ┌──────┬──────┬──────────────────────────────────────────────────────────────┐
# │ 用例 │ 对应 │ 断言什么（判别性来源 = 修前为何红）                          │
# ├──────┼──────┼──────────────────────────────────────────────────────────────┤
# │  12  │  ①   │ 暂存 task-state/D900.json 强锚点 + 竞争者认领数更高(2>1)      │
# │      │      │ ⇒ 必须返回强锚点 brief；修前 best=2 竞争者胜 ⇒ 红            │
# │  13  │  ②   │ 无强锚点 + 仅 current-brief 认领 ≥1 ⇒ 返回 current-brief（回归）│
# │  14  │  ③   │ 两者皆无（无锚点 / 无 current-brief）⇒ P4 窗口内可解析 brief  │
# │  15  │  ④   │ 规范 4 sed 删 ANCHOR-PRIORITY 缝 → 变异副本返回竞争者；       │
# │      │      │ 生产脚本对同一输入返回强锚点；两结果必须不等（改坏即红 C3）   │
# │  16  │  ⑤   │ 同路径 Q2 写 4 次 vs 另一 brief 声明 2 个不同文件且都被暂存   │
# │      │      │ ⇒ 去重后 2>1 返回后者；修前 4>2 返回前者 ⇒ 红                │
# │  17  │  ⑥   │ <date>-D471.md（D# 结尾无连字符）+ 分支含 D471 ⇒ 必须命中；   │
# │      │      │ 修前 glob *-D471-* 不命中 → 落到无关 brief ⇒ 红              │
# │  18  │  ⑦   │ 负向：无身份锚点的陈旧 brief 认领更多文件 ⇒ 不得劫持          │
# │      │      │ （D291/D296 保护；候选池不因本修复而扩大）                    │
# │  19  │ ⑧a   │ 一级压制：次位 D282 提及件 vs 首 token D282 身份件，同数 n=1   │
# │      │      │ ⇒ 修前旧 glob 双命中 + 字典序 → 09-26 提及件胜出 ⇒ 红          │
# │  20  │ ⑧b   │ 二级兜底：仅 <date>-D313-x-D314-y.md（无 D314 身份件）+       │
# │      │      │ 暂存 task-state/D314.json ⇒ 仍须命中（防纯一级过度收敛）      │
# │  21  │  ⑨   │ 生产接线：脚本含 ANCHOR-PRIORITY 双向标记 + staging_guard.py   │
# │      │      │ 仍在调用（铁律 0-2 WIRE CHECK）                               │
# │  22  │  ⑩   │ 反例 C：断言器本身可红（同值判失败）+ 变异 ≠ 生产（防假绿）   │
# │  23  │  ⑫   │ 二级提及命中不得升格 P0：二级 + 竞争者 2>1 ⇒ 走计数裁决        │
# │      │      │ （若把二级并入 P0 则直接定案返回提及件 ⇒ 红）                 │
# │  24  │  ⑬   │ 来源优先级 state > branch：状态锚点 D1061 与分支锚点 D1069    │
# │      │      │ 不一致 ⇒ 必须取 state 那份；修前 tie→字典序 取分支那份 ⇒ 红   │
# └──────┴──────┴──────────────────────────────────────────────────────────────┘
# 隔离: 全部 mktemp -d 沙箱 + git init（零网络、零真实仓库改动），trap 清理。
# 沙箱镜像结构（用例 15）: <tmp>/scripts/workflow/ + <tmp>/scripts/control-tower/
#   brief_parser.py —— 脚本以 BASH_SOURCE 相对定位 ../control-tower/brief_parser.py。
# ═══════════════════════════════════════════════════════════════════════════════

D_PASS=0; D_FAIL=0
d_pass() { D_PASS=$((D_PASS + 1)); echo "  ✅ $1"; }
d_fail() { D_FAIL=$((D_FAIL + 1)); echo "  ❌ $1" >&2; }
d_assert_exit() { # <got> <want> <msg>
  if [ "$1" -eq "$2" ]; then d_pass "$3 (exit=$1)"; else d_fail "$3 — exit=$1 期望 $2"; fi
}
d_assert_contains() { # <haystack> <needle> <msg>
  if echo "$1" | grep -qF "$2"; then d_pass "$3"; else d_fail "$3 — 未找到: $2"; fi
}
d_assert_not_contains() { # <haystack> <needle> <msg>
  if echo "$1" | grep -qF "$2"; then d_fail "$3 — 不应包含: $2"; else d_pass "$3"; fi
}
d_differs() { [ "$1" != "$2" ]; }   # 纯谓词：供用例 21 空跑红通道自检
d_assert_differs() { # <a> <b> <msg>
  if d_differs "$1" "$2"; then d_pass "$3"; else d_fail "$3 — 两值相同（检查未生效/假绿）"; fi
}

D_CLEANUP=""
d_cleanup() { for d in $D_CLEANUP; do rm -rf "$d"; done; }
trap d_cleanup EXIT
d_new_repo() {
  local d; d=$(mktemp -d)
  D_CLEANUP="$D_CLEANUP $d"
  git -C "$d" init -q 2>/dev/null || true
  mkdir -p "$d/.claude/task-briefs"
  printf '%s\n' "$d"
}
d_run() { # <cwd> <script> [staged] → OUT + EC
  set +e
  OUT=$(cd "$1" && bash "$2" "${3:-}" 2>&1)
  EC=$?
  set -e
}
d_raw() { echo "     [原始输出] exit=$EC out=${OUT:-<空>}"; }
d_mk_brief() { # <repo> <filename> <criteria|-> <path...>
  local repo="$1" fn="$2" crit="$3"; shift 3
  {
    echo "## Q0: 定位 — 测试夹具"
    echo ""
    echo "## Q1: 调研 — 测试夹具"
    if [ "$crit" != "-" ]; then echo "#CRITERIA: $crit"; fi
    echo ""
    echo "## Q2: 范围 — 测试夹具"
    echo "做什么："
    for p in "$@"; do echo "- $p"; done
    echo ""
    echo "不做什么："
    echo "- 不改 docs/never-touched.md"
    echo ""
    echo "## Q3: 验收 — 测试夹具"
    echo ""
    echo "## 架构层: 基础设施"
    echo "## Done 标准"
    echo "- [ ] 可验证"
  } > "$repo/.claude/task-briefs/$fn"
}
d_ago() {
  python3 -c "from datetime import date,timedelta;print((date.today()-timedelta(days=$1)).isoformat())" 2>/dev/null \
    || date -v-"$1"d +%Y-%m-%d
}
D_REAL_PARSER="$REPO_DIR/scripts/control-tower/brief_parser.py"
D2_GUARD="$REPO_DIR/scripts/control-tower/staging_guard.py"
A3_AGO=$(d_ago 3)

echo "═══════════════════════════════════════════════════════════"
echo "  D1069 追加段（用例 12–24）: 强锚点优先级 / 去重计数 / D# 两级定位"
echo "  resolver = $RESOLVER"
echo "  TODAY=$TODAY  THREE_AGO=$A3_AGO"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 12 (=①) 三态之「强锚点命中」：暂存 task-state/D900.json + 竞争者认领数更高 → 强锚点定案 ──"
echo "   判别性：修前 best=2（竞争者 a.sh+b.sh）> 强锚点 brief 的 1 ⇒ 返回竞争者 = 红"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/plain-branch >/dev/null 2>&1 || true
d_mk_brief "$D_R" "${A3_AGO}-D900-strong-anchor.md" A "task-state/D900.json"
d_mk_brief "$D_R" "${TODAY}-D901-competitor.md" A "scripts/a.sh" "scripts/b.sh"
d_run "$D_R" "$RESOLVER" "task-state/D900.json
scripts/a.sh
scripts/b.sh"
d_raw
d_assert_exit "$EC" 0 "12 强锚点场景解析成功"
d_assert_contains "$OUT" "D900-strong-anchor" "12 强锚点 brief 定案（竞争者认领数更高也不得压过）"
d_assert_not_contains "$OUT" "D901-competitor" "12 不返回认领数更高的竞争者"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 13 (=②) 三态之「弱锚点回退」：无暂存 task-state、分支无 D#，仅 current-brief → 返回它 ──"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/plain-branch-2 >/dev/null 2>&1 || true
d_mk_brief "$D_R" "${TODAY}-D902-weak-cur.md" A "scripts/a.sh"
d_mk_brief "$D_R" "${TODAY}-D903-other.md" A "scripts/zzz.sh"
printf '%s\n' "${TODAY}-D902-weak-cur.md" > "$D_R/.claude/current-brief"
d_run "$D_R" "$RESOLVER" "scripts/a.sh"
d_raw
d_assert_exit "$EC" 0 "13 current-brief 认领 ≥1 → 解析成功"
d_assert_contains "$OUT" "D902-weak-cur" "13 返回 current-brief（弱锚点回退语义保留）"
d_assert_not_contains "$OUT" "D903-other" "13 不误选窗口内其他 brief"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 14 (=③) 三态之「两者皆无」：无任何锚点、无 current-brief，仅窗口内可解析 brief → 回退到它 ──"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/plain-branch-3 >/dev/null 2>&1 || true
d_mk_brief "$D_R" "${TODAY}-D904-window-only.md" A "scripts/zzz.sh"
d_run "$D_R" "$RESOLVER" "scripts/a.sh"
d_raw
d_assert_exit "$EC" 0 "14 无锚点无 current-brief → 回退成功（P4）"
d_assert_contains "$OUT" "D904-window-only" "14 回退到窗口内可解析 brief"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 15 (=④) 改坏即红（C3 判别性夹具，规范 4）：sed 删 ANCHOR-PRIORITY 缝 → 变异副本必返回竞争者 ──"
echo "   沙箱镜像结构: <tmp>/scripts/workflow/（脚本）+ <tmp>/scripts/control-tower/brief_parser.py"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/plain-branch-4 >/dev/null 2>&1 || true
mkdir -p "$D_R/scripts/workflow" "$D_R/scripts/control-tower"
cp "$D_REAL_PARSER" "$D_R/scripts/control-tower/brief_parser.py"
sed '/<<<ANCHOR-PRIORITY-START>>>/,/<<<ANCHOR-PRIORITY-END>>>/d' "$RESOLVER" \
  > "$D_R/scripts/workflow/resolve-commit-brief-mutated.sh"
D_MUT="$D_R/scripts/workflow/resolve-commit-brief-mutated.sh"
echo "   变异副本行数: $(wc -l < "$D_MUT" | tr -d ' ')  生产脚本行数: $(wc -l < "$RESOLVER" | tr -d ' ')"
d_mk_brief "$D_R" "${A3_AGO}-D905-strong-anchor-mut.md" A "task-state/D905.json"
d_mk_brief "$D_R" "${TODAY}-D906-competitor-mut.md" A "scripts/a.sh" "scripts/b.sh"
D_STAGED4="task-state/D905.json
scripts/a.sh
scripts/b.sh"
d_run "$D_R" "$RESOLVER" "$D_STAGED4"
D_PROD_EC=$EC; D_PROD_OUT=$OUT
echo "     [绿证 生产脚本] exit=$D_PROD_EC out=${D_PROD_OUT:-<空>}"
d_run "$D_R" "$D_MUT" "$D_STAGED4"
D_MUT_EC=$EC; D_MUT_OUT=$OUT
echo "     [红证 变异副本] exit=$D_MUT_EC out=${D_MUT_OUT:-<空>}"
d_assert_exit "$D_PROD_EC" 0 "15 生产脚本对复现输入退出 0"
d_assert_contains "$D_PROD_OUT" "D905-strong-anchor-mut" "15 生产脚本返回强锚点 brief（绿证）"
d_assert_exit "$D_MUT_EC" 0 "15 变异副本仍可运行（规范 4：删缝后不得语法崩）"
d_assert_contains "$D_MUT_OUT" "D906-competitor-mut" "15 变异副本返回竞争者 brief（红证：强锚点被移除后必红）"
d_assert_differs "$D_PROD_OUT" "$D_MUT_OUT" "15/21 变异副本结果 ≠ 生产脚本结果（改坏即红的判别性证明）"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 16 (=⑤) 规范 2 判别性：同路径 Q2 写 4 次 vs 另一 brief 声明 2 个不同文件且都被暂存 → 2>1 ──"
echo "   判别性：修前出现次数 4 > 2 ⇒ 返回 D910-multi-count = 红"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/plain-branch-5 >/dev/null 2>&1 || true
d_mk_brief "$D_R" "${TODAY}-D910-multi-count.md" A "scripts/a.sh" "scripts/a.sh" "scripts/a.sh" "scripts/a.sh"
d_mk_brief "$D_R" "${TODAY}-D911-dedup-two.md" A "scripts/a.sh" "scripts/b.sh"
d_run "$D_R" "$RESOLVER" "scripts/a.sh
scripts/b.sh"
d_raw
d_assert_exit "$EC" 0 "16 去重计数场景解析成功"
d_assert_contains "$OUT" "D911-dedup-two" "16 去重后 2>1 → 声明两个不同文件的 brief 胜出"
d_assert_not_contains "$OUT" "D910-multi-count" "16 同路径重复写 4 次不得以出现次数获胜（规范 2 不变式）"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 17 (=⑥) 规范 3 判别性（边界）：<date>-D471.md（D# 结尾无连字符）+ 分支含 D471 → 必须命中 ──"
echo "   判别性：修前 glob *-D471-* 不命中该文件名 ⇒ 回退落到无关今日 brief = 红"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/D471-no-trailing-hyphen >/dev/null 2>&1 || true
d_mk_brief "$D_R" "${A3_AGO}-D471.md" A "task-state/D471.json"
d_mk_brief "$D_R" "${TODAY}-D999-unrelated.md" A "scripts/zzz.sh"
d_run "$D_R" "$RESOLVER" "scripts/a.sh"
d_raw
d_assert_exit "$EC" 0 "17 边界文件名场景解析成功"
d_assert_contains "$OUT" "D471.md" "17 D# 结尾无连字符的 brief 被分支强锚点命中（规范 3 边界匹配）"
d_assert_not_contains "$OUT" "D999-unrelated" "17 不落到无关的今日 brief"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 18 (=⑦) 负向（防回归）：无身份锚点的陈旧 brief 认领更多文件 ⇒ 不得劫持（D291/D296）──"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/plain-branch-7 >/dev/null 2>&1 || true
d_mk_brief "$D_R" "${A3_AGO}-D920-stale-hijack.md" A "scripts/a.sh" "scripts/b.sh"
d_mk_brief "$D_R" "${TODAY}-D921-today-wins.md" A "scripts/a.sh"
d_run "$D_R" "$RESOLVER" "scripts/a.sh
scripts/b.sh"
d_raw
d_assert_exit "$EC" 0 "18 无锚点场景解析成功"
d_assert_contains "$OUT" "D921-today-wins" "18 窗口内 brief 胜出（候选池不因本修复而扩大）"
d_assert_not_contains "$OUT" "D920-stale-hijack" "18 无身份锚点的陈旧 brief 未劫持认领（防窗口放宽式退化）"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 19 (=⑧a) 规范 3 一级压制：次位 D282 提及件 vs 首 token D282 身份件 + 暂存 task-state/D282.json ──"
echo "   判别性：修前旧 glob *-D282-* 两者都命中 → 同数 tie-break 按字典序 → 09-26 提及件胜出 = 红"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/plain-branch-8a >/dev/null 2>&1 || true
d_mk_brief "$D_R" "${A3_AGO}-D583-crossref-D282-victim.md" A "task-state/D282.json"
d_mk_brief "$D_R" "${TODAY}-D282-legit-identity.md" A "task-state/D282.json"
d_run "$D_R" "$RESOLVER" "task-state/D282.json"
d_raw
d_assert_exit "$EC" 0 "19 一级压制场景解析成功"
d_assert_contains "$OUT" "D282-legit-identity" "19 一级身份集（首 token == 锚点 D#）胜出"
d_assert_not_contains "$OUT" "D282-victim" "19 次位提及件不得凭字典序压过身份件"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 20 (=⑧b) 规范 3 二级兜底：仅 <date>-D313-x-D314-y.md（无 D314 身份件）+ 暂存 task-state/D314.json ──"
echo "   判别性：防「纯一级」式过度收敛 —— 若二级兜底缺失，该 brief 失去锚点 = 红"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/plain-branch-8b >/dev/null 2>&1 || true
d_mk_brief "$D_R" "${A3_AGO}-D313-merged-D314-cover.md" A "task-state/D314.json"
d_run "$D_R" "$RESOLVER" "task-state/D314.json"
d_raw
d_assert_exit "$EC" 0 "20 二级兜底场景解析成功"
d_assert_contains "$OUT" "D314-cover" "20 一级为空时二级提及集保住覆盖（合卡 brief 不回归）"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 21 (=⑨) 生产接线检查（铁律 0-2 WIRE CHECK）：规范 4 缝存在 + staging_guard.py 仍在调用 ──"
D_SEAM_START=$(grep -n '<<<ANCHOR-PRIORITY-START>>>' "$RESOLVER" || true)
D_SEAM_END=$(grep -n '<<<ANCHOR-PRIORITY-END>>>' "$RESOLVER" || true)
echo "     [原始输出] grep '<<<ANCHOR-PRIORITY-START>>>' $RESOLVER"
echo "     ${D_SEAM_START:-<无命中>}"
echo "     [原始输出] grep '<<<ANCHOR-PRIORITY-END>>>' $RESOLVER"
echo "     ${D_SEAM_END:-<无命中>}"
if [ -n "$D_SEAM_START" ] && [ -n "$D_SEAM_END" ]; then
  d_pass "21 生产脚本同时含 ANCHOR-PRIORITY-START/END（规范 4 注入缝存在）"
else
  d_fail "21 生产脚本缺 ANCHOR-PRIORITY 注入缝（规范 4 未落地）"
fi
D_GUARD_HITS=$(grep -c 'resolve-commit-brief\.sh' "$D2_GUARD" 2>/dev/null | tr -d '\n\r' || true)
echo "     [原始输出] grep -c 'resolve-commit-brief\.sh' $D2_GUARD → ${D_GUARD_HITS:-0}"
if [ "${D_GUARD_HITS:-0}" -ge 1 ]; then
  d_pass "21 staging_guard.py 仍调用 resolve-commit-brief.sh（命中 ${D_GUARD_HITS} 处）"
else
  d_fail "21 staging_guard.py 未调用 resolve-commit-brief.sh（消费方接线断裂）"
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 22 (=⑩) 反例 C：断言器本身可红（防「检查没跑却报绿」/ 防假绿）──"
if d_differs "SAME" "SAME"; then
  d_fail "22 断言器对相同值判通过（假绿通道存在）"
else
  d_pass "22 断言器对相同值判失败（红通道有效）"
fi
if d_differs "A" "B"; then
  d_pass "22 断言器对不同值判通过（绿通道有效）"
else
  d_fail "22 断言器对不同值判失败（断言器失效）"
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 23 (=⑫) 规范 1 判别性：二级提及命中**不得**升格 P0 —— 竞争者认领数更高时按计数裁决 ──"
echo "   判别性：若把二级提及并入 P0，则直接定案返回 D314-cover2 = 红；正确行为 = 计数裁决（2>1）"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/plain-branch-12 >/dev/null 2>&1 || true
d_mk_brief "$D_R" "${A3_AGO}-D313-merged-D314-cover2.md" A "task-state/D314.json"
d_mk_brief "$D_R" "${TODAY}-D999-competitor2.md" A "scripts/a.sh" "scripts/b.sh"
d_run "$D_R" "$RESOLVER" "task-state/D314.json
scripts/a.sh
scripts/b.sh"
d_raw
d_assert_exit "$EC" 0 "23 二级+竞争者场景解析成功"
d_assert_contains "$OUT" "D999-competitor2" "23 二级锚点不进 P0 → 按去重认领数裁决（2>1）"
d_assert_not_contains "$OUT" "D314-cover2" "23 二级提及不得升格为 P0 直接定案"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "── 24 (=⑬) 规范 1 来源优先级：state 锚点 > 分支锚点（锚点不一致时必须取 state 那份）──"
echo "   判别性：两份 brief 同数 n=1 且都被锚定；修前 tie-break 按字典序 → 09-26 的分支件胜出 = 红"
echo "   （若修后实现「先取分支锚点」，本条同样红 ⇒ 判别 P0 是否真的按来源优先级）"
D_R=$(d_new_repo)
git -C "$D_R" symbolic-ref HEAD refs/heads/fix/D1069-branch-anchor >/dev/null 2>&1 || true
d_mk_brief "$D_R" "${A3_AGO}-D1069-branch-loses.md" A "task-state/D1061.json"
d_mk_brief "$D_R" "${TODAY}-D1061-state-wins.md" A "task-state/D1061.json"
d_run "$D_R" "$RESOLVER" "task-state/D1061.json"
d_raw
d_assert_exit "$EC" 0 "24 锚点不一致场景解析成功"
d_assert_contains "$OUT" "D1061-state-wins" "24 暂存 task-state 锚点优先于分支名锚点"
d_assert_not_contains "$OUT" "D1069-branch-loses" "24 分支锚点不得压过 state 锚点"
echo ""

echo "  D1069 追加段小计: $D_PASS 通过, $D_FAIL 失败"
echo ""

PASS=$((PASS + D_PASS))
FAIL=$((FAIL + D_FAIL))
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
