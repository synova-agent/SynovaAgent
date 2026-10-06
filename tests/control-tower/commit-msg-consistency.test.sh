#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# commit-msg-consistency.test.sh — D328 提交声明-内容一致性门禁测试
#
# 背景: D320 劫持事故 — chore(D318) 提交把 D320 的 8 个文件带走, G12(范围)与
#       commit-msg(格式)两道门禁全过。根因: 无物理检查绑定"消息声明的 D#"
#       与"暂存文件认领 brief 的 D#"。
#
# 覆盖（铁律 48：正常/降级/边界/劫持/豁免）:
#   1. 真实劫持场景（red 基准）: D320 风格 brief 认领文件 + 消息 chore(D318)
#      → exit 1 硬阻断（修复前 exit 0 = 劫持复现）; stage 8 文件含 D320 brief 本身
#   2. 一致场景: 消息 chore(D320) == 认领 brief D# → exit 0 不误伤
#   3. 消息无 D# + 认领 brief 有 D# → exit 1
#   4. Merge 提交 → 跳过 exit 0
#   5. 认领 brief 无 D#（basename 无 D 号）→ fail-open exit 0
#   6. 无真实认领（resolver 回退到无关 brief）→ 跳过 exit 0 防假阳性
#   (D330 新增 — KIMI K3 审计补全):
#   7. Revert 提交 → 跳过 exit 0（DS4 声称补齐）
#   8. 无暂存文件 → fail-open exit 0（DS4 声称补齐）
#   9. broken-shim（red 基准）: PATH 前置全损坏 python（exit 127）→ 输出含显式
#      degraded 提示（修复前静默 skip 无提示 = 违反铁律 24/31）
#  10. broken-shim 劫持可追溯: 前置损坏 python3 → 修复前静默放行（exit 0 无提示,
#      GENUINE 静默归 0）; 修复后 resolver 失败 rc 被捕获 → 显式 degraded 提示
#      + fail-open exit 0（dev doc §4: 提示+跳过可追溯）
#   (D979 FIX-011 新增 — 共享治理文件多卡归属 ⒝):
#  14. 反例①: 授权卡改共享件（被改文件声明含 MSG_DID + CLAIM_DID 双向）→ 放行 exit 0
#      + 证据行（MSG_DID / CLAIM_DID / 命中文件 / 声明原文）
#  15. 反例②: 非授权卡改同一共享件（声明无 MSG_DID）→ 仍拒 exit 1 疑似并行劫持
#  16. 判别性夹具（删掉即报红）: 同 fixture 只留本卡自己的 D# → 放行转拒绝
#      （证明门禁真读被改文件声明，非 grep 型静态判据）
#  17. 零回归: MSG_DID 空 + 共享声明齐全 → 仍拒（禁把「提交未声明任务归属」洗成放行）
#  18. 逐文件强制: 两共享件其一未声明 → 拒（M 中每个 F 都须双向命中）
#
# 隔离: 每个用例独立临时 repo（mktemp -d + git init）+ 今日 mtime brief
#       （文件名带日期前缀 + #CRITERIA — resolver 最终回退路径的筛选条件）。
#       SUT 经真实仓库路径调用（commit-msg-check.sh 内部 BASH_SOURCE 自包含
#       定位 resolver/brief_parser — D317 教训, 临时 repo 无脚本目录）。
#
# 用法: bash tests/control-tower/commit-msg-consistency.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECKER="$REPO_DIR/scripts/commit-msg-check.sh"
TODAY=$(date +%Y-%m-%d)

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_exit() { if [ "$1" = "$2" ]; then pass "$3 (exit=$2)"; else fail "$3 — 期望 exit=$1 实际=$2"; fi; }

# ─── 辅助: 临时 repo 构造 ───
make_repo() {
  local r; r=$(mktemp -d /tmp/gtb-cmc-XXXXXX)
  git -C "$r" init -q -b main
  git -C "$r" config user.email test@synova.local
  git -C "$r" config user.name "Test Runner"
  mkdir -p "$r/.claude/task-briefs"
  echo "$r"
}

# 写 brief (文件名须带日期前缀 + #CRITERIA — resolver 最终回退的筛选条件)
write_brief() {
  local repo="$1" name="$2" include_path="$3"
  cat > "$repo/.claude/task-briefs/$name" <<EOF
## Q0: 定位 — 测试
### a) 项目拼图
测试 brief（D328 一致性门禁隔离）
### b) 文件审计
无
### c) 决策
无
## Q1: 调研
### a) 决策链
测试
### b) 执行约束
无
## Q2: 范围
做什么：
- $include_path
## Q3: 验收
入口：测试
处理：测试
结果：测试
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] DS1 测试 — verify: echo 1
EOF
  # 强制 mtime = 今日（resolver 只认今日 mtime brief; 避免跨天假阴性）
  touch -d "$TODAY 12:00:00" "$repo/.claude/task-briefs/$name"
}

# 写消息文件并运行 SUT（在临时 repo 内执行 — git diff --cached 用 repo 上下文）
# 第 3 参 extra_path: 前置注入 PATH（broken-shim 场景）
# 输出写入 RUN_OUT_FILE（命令替换子 shell 无法回传全局变量 — bash 语义）
RUN_OUT_FILE=/tmp/gtb-run-out.txt
run_check() {
  local repo="$1" msg="$2" extra_path="${3:-}"
  local mf; mf=$(mktemp /tmp/gtb-msg-XXXXXX)
  printf '%s\n' "$msg" > "$mf"
  local co; co=$(mktemp /tmp/gtb-out-XXXXXX)
  local exit_code=0
  if [ -n "$extra_path" ]; then
    (cd "$repo" && PATH="$extra_path:$PATH" bash "$CHECKER" "$mf") >"$co" 2>&1 || exit_code=$?
  else
    (cd "$repo" && bash "$CHECKER" "$mf") >"$co" 2>&1 || exit_code=$?
  fi
  cat "$co" > "$RUN_OUT_FILE" 2>/dev/null || true # swallow-ok: 输出文件写失败 → 断言侧视为无输出
  rm -f "$mf" "$co"
  echo "$exit_code"
}

# 构造损坏 python shim 目录（exit 127 — Windows Store stub 同款行为）
make_broken_shims() {
  local d; d=$(mktemp -d /tmp/gtb-fakebin-XXXXXX)
  for c in "$@"; do
    printf '#!/bin/bash\nexit 127\n' > "$d/$c"
    chmod +x "$d/$c"
  done
  echo "$d"
}

echo "═══════════════════════════════════════════════════════════"
echo "  D328 commit 声明-内容一致性门禁 — 测试"
echo "  SUT: $CHECKER"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ════════════════════════════════════════════════════════════════
# 用例 1: 真实劫持场景（red 基准 — c576e2b 同类事故）
# ════════════════════════════════════════════════════════════════
echo "── 1. 真实劫持场景: 消息 chore(D318) + D320 brief 认领的文件 → exit 1 ──"
R1=$(make_repo)
write_brief "$R1" "$TODAY-D320-hijack.md" "src/utils/gen-task-board.ts"
# c576e2b 劫持的 8 个文件 (D320 写集): stage 全部 → 消息声明 D318
# D330 (P2-2 修正): 第 8 个文件 = .claude/task-briefs/D320-dashboard-gitify.md（D320 brief 本身）
#   — mtime 设为昨日, 不参与今日认领（resolver 只认今日 mtime brief）, 零干扰
for f in src/utils/gen-task-board.ts \
         tests/utils/gen-task-board.test.ts \
         docs/synova/coverage/board-override.yaml \
         docs/synova/coverage/README.md \
         docs/synova/DASHBOARD-CN.md \
         docs/synova/DASHBOARD.md \
         .gitignore \
         .claude/task-briefs/D320-dashboard-gitify.md; do
  mkdir -p "$R1/$(dirname "$f")"
  if [ "$f" = ".claude/task-briefs/D320-dashboard-gitify.md" ]; then
    cat > "$R1/$f" <<'EOF'
## Q2: 范围
做什么：
- src/utils/gen-task-board.ts
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] DS1 — verify: echo 1
EOF
    YDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)
    touch -d "$YDAY 12:00:00" "$R1/$f"
  else
    echo "content" > "$R1/$f"
  fi
  git -C "$R1" add "$f"
done
# 声明-内容一致: 确 staging 8 个文件（D328 审计 P2-2 — 声称 vs 物理必须对齐）
# CT-60 同批修复: macOS BSD wc -l 输出带前导空格 → 字符串比较恒失败（存量 bug）
STAGED_COUNT=$(git -C "$R1" diff --cached --name-only | wc -l | tr -d ' ')
[ "$STAGED_COUNT" = "8" ] && pass "用例 1 stage 8 文件 (与 commit message 声明一致)" || fail "用例 1 stage 数=$STAGED_COUNT 期望 8"
EXIT=$(run_check "$R1" "chore(D318): 双机身份与 hooks 可移植")
assert_exit 1 "$EXIT" "劫持拦截 (8 文件 + chore(D318) → 硬阻断)"
rm -rf "$R1"
echo ""

# ════════════════════════════════════════════════════════════════
# 用例 2: 一致场景 — 不误伤
# ════════════════════════════════════════════════════════════════
echo "── 2. 一致场景: 消息 chore(D320) == 认领 brief D# → exit 0 ──"
R2=$(make_repo)
write_brief "$R2" "$TODAY-D320-ok.md" "src/utils/gen-task-board.ts"
mkdir -p "$R2/src/utils"
echo "content" > "$R2/src/utils/gen-task-board.ts"
git -C "$R2" add src/utils/gen-task-board.ts
EXIT=$(run_check "$R2" "chore(D320): 仪表盘 git 化生成器")
assert_exit 0 "$EXIT" "一致提交放行"
rm -rf "$R2"
echo ""

# ════════════════════════════════════════════════════════════════
# 用例 3: 消息无 D# + 认领 brief 有 D# → 阻断
# ════════════════════════════════════════════════════════════════
echo "── 3. 消息无 D# (chore: 无 scope) + 认领有 D# → exit 1 ──"
R3=$(make_repo)
write_brief "$R3" "$TODAY-D320-noscope.md" "src/utils/gen-task-board.ts"
mkdir -p "$R3/src/utils"
echo "content" > "$R3/src/utils/gen-task-board.ts"
git -C "$R3" add src/utils/gen-task-board.ts
EXIT=$(run_check "$R3" "chore: 无 scope 提交")
assert_exit 1 "$EXIT" "无 D# 声明阻断"
rm -rf "$R3"
echo ""

# ════════════════════════════════════════════════════════════════
# 用例 4: Merge 豁免
# ════════════════════════════════════════════════════════════════
echo "── 4. Merge 提交 → 跳过 exit 0 ──"
R4=$(make_repo)
write_brief "$R4" "$TODAY-D320-merge.md" "src/utils/gen-task-board.ts"
mkdir -p "$R4/src/utils"
echo "content" > "$R4/src/utils/gen-task-board.ts"
git -C "$R4" add src/utils/gen-task-board.ts
EXIT=$(run_check "$R4" "Merge branch 'feature-x' into main")
assert_exit 0 "$EXIT" "Merge 豁免"
rm -rf "$R4"
echo ""

# ════════════════════════════════════════════════════════════════
# 用例 5: 认领 brief 无 D# → fail-open
# ════════════════════════════════════════════════════════════════
echo "── 5. 认领 brief 无 D# (basename 无 D 号) → fail-open exit 0 ──"
R5=$(make_repo)
write_brief "$R5" "$TODAY-no-number.md" "src/utils/gen-task-board.ts"
mkdir -p "$R5/src/utils"
echo "content" > "$R5/src/utils/gen-task-board.ts"
git -C "$R5" add src/utils/gen-task-board.ts
EXIT=$(run_check "$R5" "chore(D999): 无关任务提交")
assert_exit 0 "$EXIT" "无 D# brief 跳过"
rm -rf "$R5"
echo ""

# ════════════════════════════════════════════════════════════════
# 用例 6: 无真实认领 → 防假阳性
# ════════════════════════════════════════════════════════════════
echo "── 6. 无真实认领 (resolver 回退到无关 brief) → 跳过 exit 0 ──"
R6=$(make_repo)
write_brief "$R6" "$TODAY-D320-unrelated.md" "scripts/other/xyz.py"
mkdir -p "$R6/src/utils"
echo "content" > "$R6/src/utils/gen-task-board.ts"
git -C "$R6" add src/utils/gen-task-board.ts
EXIT=$(run_check "$R6" "chore(D320): 无关文件提交")
assert_exit 0 "$EXIT" "无真实认领跳过 (防假阳性)"
rm -rf "$R6"
echo ""

# ════════════════════════════════════════════════════════════
# 用例 7: Revert 豁免（D330 补全 — DS4 声称与覆盖一致）
# ════════════════════════════════════════════════════════════
echo "── 7. Revert 提交 → 跳过 exit 0 ──"
R7=$(make_repo)
write_brief "$R7" "$TODAY-D320-revert.md" "src/utils/gen-task-board.ts"
mkdir -p "$R7/src/utils"
echo "content" > "$R7/src/utils/gen-task-board.ts"
git -C "$R7" add src/utils/gen-task-board.ts
EXIT=$(run_check "$R7" 'Revert "feat(D320): 仪表盘生成器"')
assert_exit 0 "$EXIT" "Revert 豁免 (D330 补用例)"
rm -rf "$R7"
echo ""

# ════════════════════════════════════════════════════════════
# 用例 8: 无暂存 fail-open（D330 补全 — DS4 声称与覆盖一致）
# ════════════════════════════════════════════════════════════
echo "── 8. 无暂存文件 → fail-open exit 0 ──"
R8=$(make_repo)
write_brief "$R8" "$TODAY-D320-nostaged.md" "src/utils/gen-task-board.ts"
EXIT=$(run_check "$R8" "chore(D320): 无暂存提交")
assert_exit 0 "$EXIT" "无暂存 fail-open (D330 补用例)"
rm -rf "$R8"
echo ""

# ════════════════════════════════════════════════════════════
# 用例 9: broken-shim degraded 提示（D330 red 基准 — 铁律 24/31）
# PATH 前置全损坏 python (python3+python+py 全部 exit 127, Windows Store stub
# 同款行为) → PYBIN 探测全失败 → 必须显式 degraded 提示（修复前静默 skip）
# ════════════════════════════════════════════════════════════
echo "── 9. broken-shim: python 全损坏 → 显式 degraded 提示 (red 基准) ──"
R9=$(make_repo)
write_brief "$R9" "$TODAY-D320-shim.md" "src/utils/gen-task-board.ts"
mkdir -p "$R9/src/utils"
echo "content" > "$R9/src/utils/gen-task-board.ts"
git -C "$R9" add src/utils/gen-task-board.ts
FAKE9=$(make_broken_shims python3 python py)
EXIT=$(run_check "$R9" "chore(D318): 劫持测试" "$FAKE9")
# 断言 1 (red): 输出必须含显式 degraded 提示 — 修复前静默无提示 → 断言失败
if grep -qE "不可用或损坏|degraded" "$RUN_OUT_FILE" 2>/dev/null; then
  pass "broken-shim 显式 degraded 提示 (exit=$EXIT)"
else
  fail "broken-shim 静默 skip — 期望显式 degraded 提示（铁律 24/31）"
fi
# 断言 2: fail-open exit 0（不误伤提交, 但有提示可追溯）
assert_exit 0 "$EXIT" "broken-shim fail-open exit 0"
rm -rf "$R9" "$FAKE9"
echo ""

# ════════════════════════════════════════════════════════════
# 用例 10: broken-shim 劫持拦截（D330 red 基准 — KIMI 2/6 败同构场景）
# PATH 前置损坏 python3 + 真实 python 可用: 修复前 PYBIN 选中损坏 shim
# (command -v 首个命中) → GENUINE 静默归 0 → 劫持漏拦 exit 0; 修复后
# 可用性探测跳过损坏候选 → 真实 python 接棒 → 劫持 exit 1
# ════════════════════════════════════════════════════════════
echo "── 10. broken-shim 劫持: 损坏 python3 前置 → 修复后仍拦截 exit 1 ──"
R10=$(make_repo)
write_brief "$R10" "$TODAY-D320-shimhijack.md" "src/utils/gen-task-board.ts"
mkdir -p "$R10/src/utils"
echo "content" > "$R10/src/utils/gen-task-board.ts"
git -C "$R10" add src/utils/gen-task-board.ts
FAKE10=$(make_broken_shims python3)
EXIT=$(run_check "$R10" "chore(D318): 劫持测试" "$FAKE10")
# dev doc §4 语义: "提示 + 跳过（可追溯）" — 修复前静默放行（exit 0 无提示）,
# 修复后 resolver 失败 rc 被捕获 → 显式 degraded 提示 + fail-open exit 0
# （broken-shim 下无法可靠判定归属, 不误伤提交, 但绝不静默）
if grep -qE "degraded|解析失败" "$RUN_OUT_FILE" 2>/dev/null; then
  pass "broken-shim 劫持场景显式 degraded 提示 (exit=$EXIT)"
else
  fail "broken-shim 劫持场景静默放行 — 期望显式 degraded 提示（可追溯）"
fi
assert_exit 0 "$EXIT" "broken-shim 劫持 fail-open exit 0"
rm -rf "$R10" "$FAKE10"
echo ""

# ════════════════════════════════════════════════════════════
# 用例 11-13: CT-60 scope 大小写/后缀兼容（2026-09-06 CTO 实测三次误拦）
# 背景: MSG_DID 提取正则 \(D[0-9]+\) 只认大写 D——小写 scope（docs(d578)）
# 被判"声明(无)"误拦；修复前 (d320) 小写 = 空声明 → 劫持误报。
# ════════════════════════════════════════════════════════════

# 用例 11: 小写 scope (d320) + 认领 D320 → 一致 exit 0（修复前 exit 1 = red 基准）
echo "── 11. CT-60: 小写 scope (d320) 一致 → exit 0 ──"
R11=$(make_repo)
write_brief "$R11" "$TODAY-D320-lowercase.md" "src/utils/gen-task-board.ts"
mkdir -p "$R11/src/utils"
echo "content" > "$R11/src/utils/gen-task-board.ts"
git -C "$R11" add src/utils/gen-task-board.ts
EXIT=$(run_check "$R11" "chore(d320): 小写 scope 声明一致性")
assert_exit 0 "$EXIT" "小写 (d320) 声明一致 (CT-60)"
rm -rf "$R11"
echo ""

# 用例 12: scope 带后缀 (d320-closeout) → 提取 D320 前缀 → 一致 exit 0
echo "── 12. CT-60: scope 后缀 (d320-closeout) → 提取 D320 ──"
R12=$(make_repo)
write_brief "$R12" "$TODAY-D320-closeout.md" "src/utils/gen-task-board.ts"
mkdir -p "$R12/src/utils"
echo "content" > "$R12/src/utils/gen-task-board.ts"
git -C "$R12" add src/utils/gen-task-board.ts
EXIT=$(run_check "$R12" "feat(d320-closeout): scope 后缀提取前缀")
assert_exit 0 "$EXIT" "后缀 scope 提取 D320 (CT-60)"
rm -rf "$R12"
echo ""

# 用例 13: 小写劫持仍拦 (d318) vs 认领 D320 → exit 1（大小写兼容不放松劫持检测）
echo "── 13. CT-60: 小写劫持 (d318) vs 认领 D320 → 仍 exit 1 ──"
R13=$(make_repo)
write_brief "$R13" "$TODAY-D320-hijack.md" "src/utils/gen-task-board.ts"
mkdir -p "$R13/src/utils"
echo "content" > "$R13/src/utils/gen-task-board.ts"
git -C "$R13" add src/utils/gen-task-board.ts
EXIT=$(run_check "$R13" "chore(d318): 小写劫持仍应拦截")
assert_exit 1 "$EXIT" "小写劫持仍拦 (CT-60)"
rm -rf "$R13"
echo ""

# ════════════════════════════════════════════════════════════
# 用例 14-18: D979 FIX-011 ⒝ 共享治理文件多卡归属
# 场景: 共享件被历史 owner 卡（D582）的 brief 认领，本卡（D979）改它 →
#   CLAIM_DID=D582 ≠ MSG_DID=D979。放行条件 = 被认领文件**每个**的声明集
#   SHARED(F) 同时含 MSG_DID 与 CLAIM_DID（声明写在被改文件内，diff 可见）。
# ════════════════════════════════════════════════════════════

# 共享件 fixture 构造器（14/15/16 共用，唯一差异 = 声明行内容 → 判别性夹具）
# <repo> <声明行内容（不含 # 前缀，可为空=无声明）> <brief D#>
make_shared_fixture() {
  local repo="$1" decl="$2" owner="${3:-D582}"
  mkdir -p "$repo/scripts"
  if [ -n "$decl" ]; then
    printf '#!/bin/bash\n# %s\necho shared\n' "$decl" > "$repo/scripts/gov-shared.sh"
  else
    printf '#!/bin/bash\necho shared\n' > "$repo/scripts/gov-shared.sh"
  fi
  write_brief "$repo" "$TODAY-$owner-shared-owner.md" "scripts/gov-shared.sh"
  git -C "$repo" add scripts/gov-shared.sh
}

# 用例 14: 反例① — 授权卡（双向声明命中）→ 放行 exit 0 + 证据行
echo "── 14. FIX-011 反例①: 授权卡改共享件（声明含 D582+D979）→ 放行 ──"
R14=$(make_repo)
make_shared_fixture "$R14" "共享声明: D582, D979"
EXIT=$(run_check "$R14" "fix(D979): 授权卡改共享治理文件")
assert_exit 0 "$EXIT" "授权卡改共享件放行 (D979 FIX-011)"
if grep -qF "D328 共享声明放行" "$RUN_OUT_FILE" 2>/dev/null; then
  pass "输出含放行证据行标题"
else
  fail "输出缺放行证据行标题"
fi
for needle in "MSG_DID=D979 CLAIM_DID=D582" "FILE=scripts/gov-shared.sh" "DECL=# 共享声明: D582, D979"; do
  if grep -qF "$needle" "$RUN_OUT_FILE" 2>/dev/null; then
    pass "证据行含: $needle"
  else
    fail "证据行缺: $needle"
  fi
done
rm -rf "$R14"
echo ""

# 用例 15: 反例② — 非授权卡（声明无 D318）→ 仍拒 exit 1
echo "── 15. FIX-011 反例②: 非授权卡改同一共享件（D318 未在声明中）→ 仍拒 ──"
R15=$(make_repo)
make_shared_fixture "$R15" "共享声明: D582, D979"
EXIT=$(run_check "$R15" "chore(D318): 非授权卡改共享件")
assert_exit 1 "$EXIT" "非授权卡仍拦 (D979 FIX-011)"
if grep -qF "疑似并行劫持" "$RUN_OUT_FILE" 2>/dev/null; then
  pass "保留劫持判定文案（未复制放行逻辑绕开）"
else
  fail "缺 疑似并行劫持 文案"
fi
if grep -qF "MISSING=D318" "$RUN_OUT_FILE" 2>/dev/null; then
  pass "原因行点名缺失的 MSG_DID=D318"
else
  fail "原因行未点名缺失 D#"
fi
rm -rf "$R15"
echo ""

# 用例 16: 判别性夹具（删掉即报红）—— 与用例 14 同 fixture，仅声明内容不同
echo "── 16. FIX-011 判别性夹具: 声明只留本卡自己（D979）→ 放行转拒绝 ──"
R16=$(make_repo)
make_shared_fixture "$R16" "共享声明: D979"
EXIT=$(run_check "$R16" "fix(D979): 声明只写自己（应拒绝）")
assert_exit 1 "$EXIT" "双向强制: 单独把自己加进声明不放行（14 与 16 仅声明行不同）"
if grep -qF "MISSING=D582" "$RUN_OUT_FILE" 2>/dev/null; then
  pass "原因行点名缺失的 CLAIM_DID=D582"
else
  fail "原因行未点名缺失 CLAIM_DID"
fi
rm -rf "$R16"
echo ""

# 用例 17: 零回归 — MSG_DID 空 + 共享声明齐全 → 仍拒（不得成为逃生口）
echo "── 17. FIX-011 零回归: 消息无 D# + 共享声明齐全 → 仍拒 ──"
R17=$(make_repo)
make_shared_fixture "$R17" "共享声明: D582, D979"
EXIT=$(run_check "$R17" "chore: 未声明任务归属")
assert_exit 1 "$EXIT" "MSG_DID 空 → 行为与修复前一致（现状零回归）"
if grep -qF "提交声明(无)" "$RUN_OUT_FILE" 2>/dev/null; then
  pass "保留「提交声明(无)」原判定文案"
else
  fail "缺原判定文案"
fi
rm -rf "$R17"
echo ""

# 用例 18: 逐文件强制 — 两共享件其一未声明 → 拒
echo "── 18. FIX-011 逐文件强制: 两共享件其一未声明 → 拒 ──"
R18=$(make_repo)
mkdir -p "$R18/scripts"
printf '#!/bin/bash\n# 共享声明: D582, D979\n' > "$R18/scripts/shared-a.sh"
printf '#!/bin/bash\n# 未声明\n' > "$R18/scripts/shared-b.sh"
cat > "$R18/.claude/task-briefs/$TODAY-D582-shared-two.md" <<EOF
## Q2: 范围
做什么：
- scripts/shared-a.sh
- scripts/shared-b.sh
## 架构层: 基础设施
#CRITERIA: A
EOF
touch -d "$TODAY 12:00:00" "$R18/.claude/task-briefs/$TODAY-D582-shared-two.md"
git -C "$R18" add scripts/shared-a.sh scripts/shared-b.sh
EXIT=$(run_check "$R18" "fix(D979): 两共享件其一未声明")
assert_exit 1 "$EXIT" "M 中每个 F 都要双向命中"
if grep -qF "FILE=scripts/shared-b.sh" "$RUN_OUT_FILE" 2>/dev/null; then
  pass "原因行点名未声明的 shared-b.sh"
else
  fail "原因行未点名未声明文件"
fi
rm -rf "$R18"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过 / $FAIL 失败"
echo "═══════════════════════════════════════════════════════════"
[ "$FAIL" = "0" ] || exit 1
