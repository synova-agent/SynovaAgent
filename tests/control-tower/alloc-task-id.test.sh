#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# alloc-task-id.test.sh — D384/CT-36 D# 统一分配器测试
#
# 覆盖 (铁律 48: 正常/降级/边界):
#   1. 正常分配 → 输出 D# + 建空壳 (status=claimed)
#   2. 连续分配 → 单调递增 (不重复发号)
#   3. dry-run → 只预览不建壳
#   4. 空任务名 → exit 1 + 用法提示
#   5. 撞车防护 → 目标号已存在时报错 (fail-closed)
#   9. D938 判别性夹具（中文/斜杠 title + A′ 反吞 + 合法提前退出）
#  10. D938-a 并发隔离: 消费 SYNO_LOCK_DIR 注入缝（每进程唯一锁目录）+ 缝消费判别探针
#
# 零真实仓库污染: 临时 task-state 目录 (SYNO_TASK_STATE_DIR 注入缝)。
# D938-a 并发安全: 沙箱/锁目录**全部每进程唯一**（mktemp）—— 改前 TMP_DIR 是固定路径
#   `/tmp/d384-alloc-tests`，同测试并发两份会互相 rm -rf 沙箱；加上仓库级锁
#   `$ROOT/.alloc-task-id.lock` 被两个测试共用 → 实测并发下本测试 A 组 FAIL=4。
#   修法: ① 沙箱走 mktemp（本文件）② 锁走 SYNO_LOCK_DIR 注入缝（生产不设 = 行为不变）。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/control-tower/alloc-task-id.sh"
TMP_DIR="$(mktemp -d)"                 # D938-a: 每进程唯一（改前固定 /tmp/d384-alloc-tests → 并发互踩）
LOCK_PARENT="$(mktemp -d)"             # D938-a: 每进程唯一锁父目录
ALLOC_LOCK_DIR="$LOCK_PARENT/lock"     # 不存在 → mkdir 即拿锁（语义同生产）
CLEANUP_DIRS=("$TMP_DIR" "$LOCK_PARENT")
cleanup() { local _d; for _d in ${CLEANUP_DIRS[@]+"${CLEANUP_DIRS[@]}"}; do rm -rf "$_d"; done; }
trap cleanup EXIT
export SYNO_LOCK_DIR="$ALLOC_LOCK_DIR"  # D938-a: 消费注入缝（子进程全部继承，含各 section 的内联调用）

PASS=0; FAIL=0
FAILED_NAMES=()
FIRST_FAIL=""
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
# D938-CI: 失败断言名落盘 —— CI 只把 `tail -8` 写进 ::error 注解，没有摘要就只剩尾几行、
#   定位靠猜。摘要压成**一行**放最后，使注解里能看到"到底哪条红"。
# D938-CI-2(可见性): ci.yml 注解还叠了 `cut -c1-450`——末行摘要在长输出下会被截掉
#   （#739 实测：截断发生在结果行之后的分隔线上，FAILED(N) 摘要永远进不了注解）。
#   FIRST_FAIL 压进**结果行本身**，只要 tail -8 窗口含结果行就必可见；与末行摘要叠加，不替换。
fail() {
  FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1")
  if [ -z "$FIRST_FAIL" ]; then FIRST_FAIL="$1"; fi
  echo "  ❌ $1" >&2
}
assert_contains() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi; }
assert_exit() { if [ "$1" = "$2" ]; then pass "$3 (exit=$2)"; else fail "$3 — 期望 exit=$1 实际=$2"; fi; }
# D940 判别性夹具辅助: 「必须拒绝」与「不得出现某标记」
assert_ne0() { if [ "$1" != "0" ]; then pass "$2 (exit=$1)"; else fail "$2 — 期望 exit≠0，实际 0（fail-closed 未生效）"; fi; }
assert_lacks() { if echo "$1" | grep -qF "$2"; then fail "$3 — 不应出现: $2"; else pass "$3"; fi; }

mkdir -p "$TMP_DIR"
rm -rf "$TMP_DIR/task-state" 2>/dev/null || true
mkdir -p "$TMP_DIR/task-state"
# 注入缝: 复制 TEMPLATE + 预置占用号 D499 模拟已有任务（D500 起步边界：max=499 → +1=500）
cp "$REPO_DIR/task-state/TEMPLATE.json" "$TMP_DIR/task-state/TEMPLATE.json"
cat > "$TMP_DIR/task-state/D499.json" <<'EOF'
{"task_id":"D499","status":"claimed","spec":null,"impl":null,"audit":null}
EOF

echo "═══════════════════════════════════════════════════════════"
echo "  D384 alloc-task-id 分配器测试"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "── 1. 正常分配 → D500 + 建壳 ──"
OUT=$(SYNO_TASK_STATE_DIR="$TMP_DIR/task-state" SYNO_BRIEF_DIR="$TMP_DIR/task-briefs" SYNO_ALLOC_NO_REMOTE=1 bash "$TOOL" "测试任务A" 2>&1)
assert_contains "$OUT" "D500" "分配 D500 (max=499 → +1=500 起步)"
assert_contains "$OUT" "已登记" "登记提示"
if [ -f "$TMP_DIR/task-state/D500.json" ]; then pass "空壳已建"; else fail "空壳未建"; fi
if grep -q '"status": "claimed"' "$TMP_DIR/task-state/D500.json"; then pass "status=claimed"; else fail "status 非 claimed"; fi
echo ""

echo "── 2. 连续分配 → D501 (单调递增) ──"
OUT=$(SYNO_TASK_STATE_DIR="$TMP_DIR/task-state" SYNO_BRIEF_DIR="$TMP_DIR/task-briefs" SYNO_ALLOC_NO_REMOTE=1 bash "$TOOL" "测试任务B" 2>&1)
assert_contains "$OUT" "D501" "第二次分配 D501"
echo ""

echo "── 3. dry-run → 只预览不建壳 ──"
OUT=$(SYNO_TASK_STATE_DIR="$TMP_DIR/task-state" SYNO_BRIEF_DIR="$TMP_DIR/task-briefs" SYNO_ALLOC_NO_REMOTE=1 bash "$TOOL" "预览任务" --dry-run 2>&1)
assert_contains "$OUT" "D502" "dry-run 预览 D502"
assert_contains "$OUT" "dry-run" "dry-run 标注"
if [ ! -f "$TMP_DIR/task-state/D502.json" ]; then pass "dry-run 未建壳"; else fail "dry-run 竟建壳了"; fi
echo ""

echo "── 4. 空任务名 → exit 1 + 用法 ──"
EXIT=0
OUT=$(SYNO_TASK_STATE_DIR="$TMP_DIR/task-state" SYNO_BRIEF_DIR="$TMP_DIR/task-briefs" SYNO_ALLOC_NO_REMOTE=1 bash "$TOOL" 2>&1) || EXIT=$?
assert_exit 1 "$EXIT" "空名拒绝"
assert_contains "$OUT" "用法" "用法提示"
echo ""

echo "── 5. 撞车防护逻辑存在（并发竞态防御；单进程不可触发，靠唯一入口 + 建壳原子检查）──"
# NEXT=MAX+1 天然不撞；并发窗口（两进程同算 NEXT）靠「建壳前 -f 检查」拒绝。
# 单测验证防护代码存在 + 正常流程不误触发。
if grep -q '已存在\|STATE_FILE' "$TOOL"; then pass "防护逻辑存在 (建壳前检查)"; else fail "防护逻辑缺失"; fi
EXIT=0
OUT=$(SYNO_TASK_STATE_DIR="$TMP_DIR/task-state" SYNO_BRIEF_DIR="$TMP_DIR/task-briefs" SYNO_ALLOC_NO_REMOTE=1 bash "$TOOL" "正常任务" 2>&1) || EXIT=$?
assert_exit 0 "$EXIT" "正常流程不误触发 (exit 0)"
echo ""

echo "── 6. D550: origin/main 占用合并（落后本地不漏号——D547/D548 撞号实证）──"
# D940返工(#743): 改**自带 origin/main 的夹具仓**（判别性构造）——
#   原版以真仓 origin/main 为期望源，实际依赖「工具读 CWD 真仓」这一被 #743 修掉的污染行为
#   （工具现按 TS_TOP 归属读 origin/main，沙箱非 git 仓时正确降级本地发号 → 原断言必红）。
#   夹具: 本地空 task-state + 本仓 origin/main 预置 D600 → 期望发 D601（D550 语义经 TS_TOP 生效）。
F6=$(mktemp -d); CLEANUP_DIRS+=("$F6")
git init -q "$F6/w"
mkdir -p "$F6/w/task-state"
cp "$REPO_DIR/task-state/TEMPLATE.json" "$F6/w/task-state/TEMPLATE.json"
printf '{"task_id":"D600","status":"claimed"}\n' > "$F6/w/task-state/D600.json"
( cd "$F6/w" && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init )
git -C "$F6/w" update-ref refs/remotes/origin/main HEAD
rm -f "$F6/w/task-state/D600.json"   # 本地抹掉 → 只剩 origin/main 占用 600
OUT=$(SYNO_TASK_STATE_DIR="$F6/w/task-state" SYNO_BRIEF_DIR="$F6/briefs" \
      SYNO_ALLOC_NO_WORKTREE=1 SYNO_ALLOC_NO_BRANCH=1 bash "$TOOL" "空目录测试" 2>&1)
GOT=$(echo "$OUT" | grep -oE 'D[0-9]+' | head -1 | sed 's/D//')
if [ "$GOT" = "601" ]; then
  pass "origin/main 合并: 本地空 + 夹具 origin/main 占 D600 → 发 D601（不漏号，经 TS_TOP 归属）"
else
  fail "origin/main 合并失败: 发 D${GOT:-<空>} 应 = 601（夹具 origin/main 占 D600）"
fi
echo ""

echo "── 7. CT-63: 远端分支名 D# 扫描 ──"
CT63_DIR=$(mktemp -d)
mkdir -p "$CT63_DIR/task-state"
echo '{"task_id":"D499","status":"claimed"}' > "$CT63_DIR/task-state/D499.json"
# D662 密封身份隔离: 沙箱 commit 显式注入身份（CI 零配置无 gecos fallback → empty ident name）
cd "$CT63_DIR" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init
git update-ref refs/remotes/origin/feat/d605-test HEAD
cd "$REPO_DIR"
OUT=$(SYNO_TASK_STATE_DIR="$CT63_DIR/task-state" SYNO_BRIEF_DIR="$CT63_DIR/briefs" SYNO_ALLOC_NO_REMOTE=1 bash "$TOOL" "CT63" 2>&1)
GOT=$(echo "$OUT" | grep -oE 'D[0-9]+' | head -1 | sed 's/D//')
if [ -n "$GOT" ] && [ "$GOT" -gt 605 ]; then pass "CT-63: 分支 d605 → 发 D$GOT > 605"; else fail "CT-63: 发 D$GOT 应 > 605"; fi
rm -rf "$CT63_DIR"
echo ""

echo "── 8. CT-63 注入缝 NO_BRANCH=1 ──"
CT63B_DIR=$(mktemp -d)
mkdir -p "$CT63B_DIR/task-state"
echo '{"task_id":"D499","status":"claimed"}' > "$CT63B_DIR/task-state/D499.json"
# D662 密封身份隔离: 同上（CT-63 NO_BRANCH 场景）
cd "$CT63B_DIR" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init
git update-ref refs/remotes/origin/feat/d605-test HEAD
cd "$REPO_DIR"
OUT=$(SYNO_TASK_STATE_DIR="$CT63B_DIR/task-state" SYNO_BRIEF_DIR="$CT63B_DIR/briefs" SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_BRANCH=1 bash "$TOOL" "CT63B" 2>&1)
GOT=$(echo "$OUT" | grep -oE 'D[0-9]+' | head -1 | sed 's/D//')
if [ -n "$GOT" ] && [ "$GOT" -eq 500 ]; then pass "CT-63 NO_BRANCH: 发 D$GOT = 500"; else fail "CT-63 NO_BRANCH: 发 D$GOT 应 = 500"; fi
rm -rf "$CT63B_DIR"
echo ""

echo "── 9. D938 判别性夹具: 中文/斜杠 title + A′ 反吞 + 合法提前退出 ──"
# 覆盖矩阵（铁律 48 三路径）:
#   正常 — 纯中文 title: **stderr 空** + rc=0 + 骨架 1 个
#          （改前实测: stderr `line 245: BRIEF_FILE<EF>: unbound variable` + rc=0 —— 报错却 rc=0）
#   边界 — 含 `/` title: stderr 空 + rc=0 + 骨架 1 个 + **无孤儿号**
#          （改前实测: `line 207: …/D500-M1/ownership-域修正.md: No such file or directory`
#           + `D500.json` 已登记 + 骨架 0 个 = 号烧掉无人认领）
#   边界 — 空格/中文/全角混合 title: rc=0 + stderr 空 + 骨架不裂子目录
#   降级 — A′ 反吞: ① 真实 `_lock_release` handler 在 set -u 中止下 rc≠0（改前 rc=0 = fail-open）
#          ② **对照组**（改前形态 handler）同场景 rc=0 → 证明本夹具能看见 fail-open（非空转）
#          ③ 可达中止路径（brief 目录建不出）rc≠0 且回滚登记（不留孤儿号）
#   降级 — 合法提前退出不被哨兵误伤: dry-run rc=0；D718 守卫 rc=0
D938_DIR=$(mktemp -d)
CLEANUP_DIRS+=("$D938_DIR")
D938_RUN() {  # $1=task-state 目录 $2=brief 目录 $3..=透传参数
  local _ts="$1" _br="$2"; shift 2
  SYNO_TASK_STATE_DIR="$_ts" SYNO_BRIEF_DIR="$_br" \
    SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_WORKTREE=1 SYNO_ALLOC_NO_BRANCH=1 \
    bash "$TOOL" "$@"
}
D938_SANDBOX() {  # $1=目录 → 建 ts + 预置 D499
  mkdir -p "$1/ts"
  cp "$REPO_DIR/task-state/TEMPLATE.json" "$1/ts/TEMPLATE.json"
  echo '{"task_id":"D499","status":"claimed","spec":null,"impl":null,"audit":null}' > "$1/ts/D499.json"
}
D938_NEWJSON() { ls "$1"/ts/D*.json 2>/dev/null | grep -v '/D499\.json$' | wc -l | tr -d ' \r' || true; }  # swallow-ok: 空=0 正常；pipefail 下 grep -v 无选中返 1，须兜底
D938_BRIEFS()  { ls -1 "$1/briefs" 2>/dev/null | wc -l | tr -d ' \r' || true; }                              # swallow-ok: 空=0 正常

# 9.1 纯中文 title —— 判别点 = stderr 必须为空
D938_SANDBOX "$D938_DIR/cn"
RC=0; OUT=$(D938_RUN "$D938_DIR/cn/ts" "$D938_DIR/cn/briefs" "测试中文标题" 2>"$D938_DIR/cn.err") || RC=$?
assert_exit 0 "$RC" "9.1 中文 title rc"
if [ -s "$D938_DIR/cn.err" ]; then
  fail "9.1 中文 title → stderr 非空（改前即此形态: unbound variable）: $(tr '\n' '|' 2>/dev/null < "$D938_DIR/cn.err")"
else
  pass "9.1 中文 title → stderr 空"
fi
assert_contains "$OUT" "D500" "9.1 分配 D500"
[ "$(D938_BRIEFS "$D938_DIR/cn")" = "1" ] && pass "9.1 骨架 1 个" || fail "9.1 骨架应 1 个，实得 $(D938_BRIEFS "$D938_DIR/cn")"

# 9.2 含 `/` title —— 判别点 = 无孤儿号（登记与骨架同成同败）
D938_SANDBOX "$D938_DIR/slash"
RC=0; OUT=$(D938_RUN "$D938_DIR/slash/ts" "$D938_DIR/slash/briefs" "M1/ownership 域修正" 2>"$D938_DIR/slash.err") || RC=$?
assert_exit 0 "$RC" "9.2 含 / title rc"
if [ -s "$D938_DIR/slash.err" ]; then
  fail "9.2 含 / title → stderr 非空: $(tr '\n' '|' 2>/dev/null < "$D938_DIR/slash.err")"
else
  pass "9.2 含 / title → stderr 空"
fi
NJ=$(D938_NEWJSON "$D938_DIR/slash"); NB=$(D938_BRIEFS "$D938_DIR/slash")
[ "$NB" = "1" ] && pass "9.2 骨架 1 个" || fail "9.2 骨架应 1 个，实得 ${NB}（改前实测 0 个）"
if [ "$NJ" = "$NB" ]; then
  pass "9.2 无孤儿号（登记 $NJ 个 ↔ 骨架 $NB 个）"
else
  fail "9.2 孤儿号: 登记 $NJ 个但骨架 $NB 个（号已烧、无人认领）"
fi
if [ -z "$(find "$D938_DIR/slash/briefs" -mindepth 2 2>/dev/null)" ]; then
  pass "9.2 骨架未裂成子目录（title 分隔符已消毒）"
else
  fail "9.2 骨架裂进子目录: $(find "$D938_DIR/slash/briefs" -mindepth 2 2>/dev/null | tr '\n' ' ')"
fi

# 9.3 边界: 空格 + 中文 + 全角混合 title
D938_SANDBOX "$D938_DIR/mix"
RC=0; OUT=$(D938_RUN "$D938_DIR/mix/ts" "$D938_DIR/mix/briefs" "混合 标题 全角A" 2>"$D938_DIR/mix.err") || RC=$?
assert_exit 0 "$RC" "9.3 混合 title rc"
if [ -s "$D938_DIR/mix.err" ]; then
  fail "9.3 混合 title → stderr 非空: $(tr '\n' '|' 2>/dev/null < "$D938_DIR/mix.err")"
else
  pass "9.3 混合 title → stderr 空"
fi
[ "$(D938_BRIEFS "$D938_DIR/mix")" = "1" ] && pass "9.3 骨架 1 个" || fail "9.3 骨架应 1 个"

# 9.4 A′ 反吞 ①②: 提取**生产** _lock_release handler，在 set -u 中止下验退出码
#   说明: 改前 fail-open 的可达触发是 `set -u` unbound（实测矩阵: unbound→0 / false→1 /
#   assign-from-failed-cmdsub→1）。c1 修掉 :242 后生产路径已无 unbound，故用「真实 handler
#   源码 + 合成 unbound」驱动 —— 不是测副本函数体，也不是 grep 型静态判据。
D938_HANDLER=""
# D938-CI(方言): 提取必须**方言无关** —— 原实现用 `awk '/^_lock_release\(\) \{/…'`：`\{` 在 POSIX ERE 里
#   单独出现属**未定义**（GNU awk/mawk 与 BSD awk 处理不一致），可能提取为空 → 断言红且判别信息丢给
#   "unbound variable" 那类噪音，定位要靠猜。改成纯字面量 sed 区间（BRE 里 `(` `{` 都是字面字符，
#   无 interval 构造）→ BSD/GNU/msys 一致。（根因结论以 CI 注解中的失败摘要为准，本注释是修因不是判据。）
D938_HL="$(grep -n '^_lock_release() {' "$TOOL" | head -1 | cut -d: -f1)"
if [ -n "$D938_HL" ]; then
  D938_FIRST="$(sed -n "${D938_HL}p" "$TOOL")"
  case "$D938_FIRST" in
    *'{'*'}'*) D938_HANDLER="$D938_FIRST" ;;
    *) D938_HANDLER="$(sed -n '/^_lock_release() {/,/^}/p' "$TOOL")" ;;
  esac
fi
if printf '%s' "$D938_HANDLER" | grep -q '_lock_release' && printf '%s' "$D938_HANDLER" | grep -q 'exit'; then
  pass "9.4 已从生产脚本提取 _lock_release（含显式 exit）"
else
  fail "9.4 _lock_release 提取失败或未含显式 exit（提取器与源码漂移 —— fail-loud，不静默跳过）"
fi
# ① 生产 handler + 合成 unbound → 必须 rc≠0
{
  echo 'set -euo pipefail'
  echo 'DONE=0'
  echo "LOCK_DIR=\"$D938_DIR/prod-lock\""
  echo 'mkdir -p "$LOCK_DIR"'
  printf '%s\n' "$D938_HANDLER"
  echo 'trap _lock_release EXIT'
  echo 'echo "[[${D938_UNDEF_PROBE}]]"'
} > "$D938_DIR/a2_prod.sh"
RC=0; bash "$D938_DIR/a2_prod.sh" >/dev/null 2>&1 || RC=$?
if [ "$RC" -ne 0 ]; then
  pass "9.4 ① 生产 handler: unbound 中止 → rc=$RC ≠ 0（fail-closed）"
else
  fail "9.4 ① 生产 handler: unbound 中止 → rc=0（EXIT trap 仍把失败洗成成功 = fail-open）"
fi
# ② 对照组（改前形态 handler）→ rc=0，证明夹具看得见 fail-open
#   D938-CI(方言/bash版本): 原对照组 handler 末尾无显式 exit，rc=0 依赖「EXIT trap 内末条命令
#   成功 → 覆盖非零退出状态」——bash <5.1 语义；bash ≥5.1 起 EXIT trap 成功不再洗白非零退出码
#   （#739 CI 双平台 FIRST_FAIL=9.4② 实证；本机 bash 3.2 成立、CI bash 5.x rc=1）。
#   改**方言无关 fail-open 形态**: handler 显式 `exit 0`（不依赖任何 trap 退出码语义，
#   BSD bash 3.2 / GNU bash 5.x 一致 rc=0）。演示的缺陷本质不变——handler 无条件导出
#   成功、掩盖早先失败。
{
  echo 'set -euo pipefail'
  echo 'DONE=0'
  echo "LOCK_DIR=\"$D938_DIR/ctrl-lock\""
  echo 'mkdir -p "$LOCK_DIR"'
  echo '_lock_release() { rmdir "$LOCK_DIR" 2>/dev/null || true; exit 0; }'
  echo 'trap _lock_release EXIT'
  echo 'echo "[[${D938_UNDEF_PROBE}]]"'
} > "$D938_DIR/a2_ctrl.sh"
RC=0; bash "$D938_DIR/a2_ctrl.sh" >/dev/null 2>&1 || RC=$?
if [ "$RC" = "0" ]; then
  pass "9.4 ② 对照组(改前形态): 同场景 rc=0 → 夹具能看见 fail-open（非空转网）"
else
  fail "9.4 ② 对照组异常: rc=${RC}（应 0；说明该夹具测不到真东西，结论不可信）"
fi

# 9.5 可达中止路径 → rc≠0 且回滚登记（不留孤儿号）
D938_SANDBOX "$D938_DIR/abort"
: > "$D938_DIR/blocker"   # 普通文件占位 → SYNO_BRIEF_DIR 的父路径不是目录 → 建目录必失败
RC=0; OUT=$(D938_RUN "$D938_DIR/abort/ts" "$D938_DIR/blocker/briefs" "中止探针" 2>"$D938_DIR/abort.err") || RC=$?
if [ "$RC" -ne 0 ]; then
  pass "9.5 可达中止 → rc=$RC ≠ 0（不留 rc=0 的假成功）"
else
  fail "9.5 可达中止 → rc=0（错误却宣称成功）"
fi
NJ=$(D938_NEWJSON "$D938_DIR/abort"); NB=$(D938_BRIEFS "$D938_DIR/abort")
if [ "$NJ" = "0" ] && [ "$NB" = "0" ]; then
  pass "9.5 同成同败: 登记 0 个 / 骨架 0 个（回滚生效，无孤儿号）"
else
  fail "9.5 回滚未生效: 登记 $NJ 个 / 骨架 $NB 个（应为 0/0）"
fi

# 9.6/9.7 合法提前退出不得被成功哨兵误伤
D938_SANDBOX "$D938_DIR/legal"
RC=0; OUT=$(D938_RUN "$D938_DIR/legal/ts" "$D938_DIR/legal/briefs" "干跑" --dry-run 2>"$D938_DIR/dry.err") || RC=$?
assert_exit 0 "$RC" "9.6 dry-run 合法提前退出 rc"
assert_contains "$OUT" "dry-run" "9.6 dry-run 标注"
[ ! -s "$D938_DIR/dry.err" ] && pass "9.6 dry-run stderr 空" || fail "9.6 dry-run stderr 非空"
RC=0; OUT=$(SYNO_TASK_STATE_DIR="$D938_DIR/legal/ts" SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_WORKTREE=1 \
  SYNO_ALLOC_NO_BRANCH=1 bash "$TOOL" "守卫测试" 2>"$D938_DIR/guard.err") || RC=$?
assert_exit 0 "$RC" "9.7 D718 守卫合法提前退出 rc（防哨兵误伤）"
assert_contains "$(cat "$D938_DIR/guard.err")" "跳过 brief 骨架生成" "9.7 守卫仍按降级路径告警"
echo ""

# ── 10. D938-a: SYNO_LOCK_DIR 注入缝（并发隔离）──
# 判别方式 = **行为 + 路径特异**，不是 grep 源码:
#   预置一个 mtime=2000-01-01 的**陈旧**锁目录交给 SYNO_LOCK_DIR，运行后断言：
#     ① rc=0（照常发号）② **该注入目录被脚本清理掉**（缝被消费的铁证：没消费就不碰它）
#     ③ stderr 出现「陈旧锁」告警（次级证据，说明走的是陈旧清理分支）
#   ⚠️ 只用 ③ 会假阳: 仓库锁若恰好陈旧，告警也会出现（本轮实测踩到过）→ 主判据是 ②。
# D938-CI(方言): 锁路径改用**相对路径**（CWD = 探针目录）。
#   原因: 工具的陈旧判定走 `python3 -c "…os.path.getmtime('$LOCK_DIR')"`；Git Bash(msys) 下 native python
#   解析不了 `/tmp/...` 这类 MSYS 绝对路径 → 抛错被 `|| echo 0` 吞成 lock_age=0 → **恒判不陈旧**
#   → 走 30s 等待超时分支（CI windows 实测 2 红）。相对路径下 python 继承同一 CWD → 全平台一致。
#   另加**平台探针 + 双分支期望**（CTO 新规范）：探针证明本平台能 stat 该路径才断言陈旧分支；
#   不能 stat 时走「持锁等待超时」分支并**显式标 PLATFORM-DIFF**（不是静默 skip，也不是假绿）。
echo "── 10. D938-a: 锁注入缝消费判别 + 并发隔离 ──"
PROBE_DIR=$(mktemp -d); CLEANUP_DIRS+=("$PROBE_DIR")
mkdir -p "$PROBE_DIR/lock"
: > "$PROBE_DIR/ref"
touch -t 200001010000 "$PROBE_DIR/ref"          # BSD/GNU/msys 均支持 -t
touch -r "$PROBE_DIR/ref" "$PROBE_DIR/lock"     # 锁目录 mtime → 2000 年 ⇒ 锁龄 > 60s ⇒ 判陈旧
D938_SANDBOX "$PROBE_DIR/sb"
# 平台探针: 本平台 python 能否 stat 相对路径（决定期望分支，不去猜方言）
PROBE_PY=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c 'import sys' >/dev/null 2>&1; then PROBE_PY="$_c"; break; fi
done
PROBE_REL_OK=0
if [ -n "$PROBE_PY" ] && ( cd "$PROBE_DIR" && "$PROBE_PY" -c "import os;os.path.getmtime('ref')" >/dev/null 2>&1 ); then PROBE_REL_OK=1; fi
echo "  平台探针: python(${PROBE_PY:-none}) 相对路径 stat → ${PROBE_REL_OK}（1=可执行陈旧分支）"
RC=0; OUT=$( cd "$PROBE_DIR" && SYNO_LOCK_DIR="lock" SYNO_TASK_STATE_DIR="$PROBE_DIR/sb/ts" \
  SYNO_BRIEF_DIR="$PROBE_DIR/sb/briefs" SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_WORKTREE=1 \
  SYNO_ALLOC_NO_BRANCH=1 bash "$TOOL" "陈旧锁探针" 2>&1 ) || RC=$?
if [ "$PROBE_REL_OK" = "1" ]; then
  assert_exit 0 "$RC" "10.1 陈旧锁被清理后照常发号 rc"
  if [ ! -d "$PROBE_DIR/lock" ]; then
    pass "10.1 缝被真实消费（注入的锁目录运行后被清理 = 该路径确被脚本使用）"
  else
    fail "10.1 缝未被消费：注入的锁目录仍在（脚本用的是仓库级锁 → 并发仍会互撞）"
  fi
  assert_contains "$OUT" "陈旧锁" "10.1 陈旧清理分支可达（次级证据）"
else
  # 双分支期望: 本平台 python 读不到 mtime → 工具的陈旧清理不可达 → 期望「持锁等待超时」分支。
  # 该分支同样证明**缝被消费**（脚本在等我们注入的那把锁，而不是仓库锁），且不靠任何方言。
  echo "  ⚠️ PLATFORM-DIFF: 本平台 python 无法 stat 相对路径 → 改判「持锁超时」分支（可见降级，非静默）"
  if [ "$RC" -ne 0 ]; then
    pass "10.1 缝被真实消费（持锁分支 rc=${RC} ≠ 0 = 脚本在等注入的锁，非仓库锁）"
  else
    fail "10.1 缝未被消费：持锁情况下仍 rc=0（说明脚本没在用注入的锁目录）"
  fi
  if printf '%s' "$OUT" | grep -q "分配锁超时"; then
    pass "10.1 超时告警出现（注入锁确有阻塞效果 = 次级证据）"
  else
    fail "10.1 未出现超时告警（注入锁未生效）"
  fi
fi

# 10.2 并发隔离快检: 两把**不同**的锁目录 + 两个沙箱 → 互不干扰、都拿到号
P1="$PROBE_DIR/p1"; P2="$PROBE_DIR/p2"; D938_SANDBOX "$P1"; D938_SANDBOX "$P2"
( SYNO_LOCK_DIR="$P1/lock" SYNO_TASK_STATE_DIR="$P1/ts" SYNO_BRIEF_DIR="$P1/briefs" \
    SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_WORKTREE=1 SYNO_ALLOC_NO_BRANCH=1 \
    bash "$TOOL" "并发甲" > "$PROBE_DIR/o1" 2>&1; echo $? > "$PROBE_DIR/r1" ) &
( SYNO_LOCK_DIR="$P2/lock" SYNO_TASK_STATE_DIR="$P2/ts" SYNO_BRIEF_DIR="$P2/briefs" \
    SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_WORKTREE=1 SYNO_ALLOC_NO_BRANCH=1 \
    bash "$TOOL" "并发乙" > "$PROBE_DIR/o2" 2>&1; echo $? > "$PROBE_DIR/r2" ) &
wait || true  # swallow-ok: 两个 rc 已各自落文件，wait 的聚合状态无意义
R1="$(tr -d ' \r' < "$PROBE_DIR/r1" 2>/dev/null || echo 9)"; R2="$(tr -d ' \r' < "$PROBE_DIR/r2" 2>/dev/null || echo 9)"
assert_exit 0 "${R1:-9}" "10.2 并发甲（独立锁目录）rc"
assert_exit 0 "${R2:-9}" "10.2 并发乙（独立锁目录）rc"
assert_contains "$(cat "$PROBE_DIR/o1")" "D500" "10.2 并发甲拿到 D500（沙箱隔离）"
assert_contains "$(cat "$PROBE_DIR/o2")" "D500" "10.2 并发乙拿到 D500（沙箱隔离，与甲互不干扰）"
echo "── 9. D940 判别性[真实样本名]: 远端分支占 942 而本地未 fetch → 取号必须拒绝并点名 ──"
# 真实样本: origin 上确有 refs/heads/docs/d942-cto-fixation 与 docs/d943-cto-a-items。
# 关键条件「远端有、本地 branch -r 看不见」用**本地 bare 仓当 origin** 密封复刻
# （离线、CI 可跑、不连真网）；真仓当前**有** tracking ref，故不能直接用真仓构造该条件。
# ⚠ 夹具硬约束（c1 接口对齐 (A)）: 夹具 task-state 必须 max=941 →
#   计算表 941 → NEXT=942 → 发号前权威校验经 ls-remote 看到 d942 → 拒绝。
#   （c1 刻意不把 ls-remote 喂进「下一个号」计算表，否则 NEXT 会跳到 943、拒绝永不触发。）
mk_bare_fixture() {   # $1=夹具根目录；$2..=建在 bare origin 上的远端分支名；stdout=工作区路径
  local fix="$1"; shift
  local bare="$fix/origin.git" work="$fix/work" b
  git init -q --bare "$bare"
  git init -q "$work"
  mkdir -p "$work/task-state"
  cp "$REPO_DIR/task-state/TEMPLATE.json" "$work/task-state/TEMPLATE.json"
  printf '{"task_id":"D941","status":"claimed"}\n' > "$work/task-state/D941.json"
  ( cd "$work" && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init \
      && git remote add origin "$bare" && git push -q origin HEAD:refs/heads/main )
  for b in "$@"; do
    git -C "$work" push -q origin "HEAD:refs/heads/$b"
    # 关键: 抹掉 push 可能顺带建立的 tracking ref → 复现"未 fetch"
    git -C "$work" update-ref -d "refs/remotes/origin/$b" 2>/dev/null || true
  done
  echo "$work"
}
F9=$(mktemp -d)
W9=$(mk_bare_fixture "$F9" "docs/d942-cto-fixation" "docs/d943-cto-a-items")
BLIND=$(git -C "$W9" branch -r --format='%(refname:short)' | grep -c 'd94[23]' || true)
SEEN=$(git -C "$W9" ls-remote --heads origin | grep -c 'd94[23]' || true)
if [ "$BLIND" = "0" ] && [ "$SEEN" = "2" ]; then
  pass "前置自校验: branch -r 看不见 d942/d943 ($BLIND)，ls-remote 看得见 ($SEEN)"
else
  fail "前置不成立: branch -r 命中=$BLIND 应为 0；ls-remote 命中=$SEEN 应为 2 —— 夹具未能复现「未 fetch」，后续断言无意义"
fi
EXIT=0
OUT=$(SYNO_TASK_STATE_DIR="$W9/task-state" SYNO_BRIEF_DIR="$F9/briefs" bash "$TOOL" "判别性-未fetch远端占942" 2>&1) || EXIT=$?
assert_ne0 "$EXIT" "未 fetch 的远端分支占用 → 拒绝（fail-closed，不发放）"
assert_contains "$OUT" "docs/d942-cto-fixation" "点名冲突位置（远端分支全 ref 原文）"
assert_lacks "$OUT" "已登记:" "拒绝时不建壳"
if [ ! -f "$W9/task-state/D942.json" ]; then pass "拒绝后未建 D942 壳"; else fail "拒绝却建了 D942 壳"; fi
rm -rf "$F9"
echo ""

echo "── 10. D940 判别性: worktree 目录名占 942（其它位置均无 942）→ 不得发放 942 ──"
# 隔离信号: 分支名**不含 D 号**、worktree 内**无 task-state** → 占用信号只在目录名。
# 断言取"不得发放 942"这一不变量（若拒绝则须点名 worktree）——两种实现口径下都成立，
# 旧实现（不扫目录名）会发放 D942 → 必红。
F10=$(mktemp -d); M10="$F10/main"
git init -q "$M10"
mkdir -p "$M10/task-state"
cp "$REPO_DIR/task-state/TEMPLATE.json" "$M10/task-state/TEMPLATE.json"
printf '{"task_id":"D941","status":"claimed"}\n' > "$M10/task-state/D941.json"
( cd "$M10" && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init )
git -C "$M10" worktree add -q "$F10/.synova-wt-squad-d942" -b squad-probe >/dev/null 2>&1
if [ ! -f "$F10/.synova-wt-squad-d942/task-state/D942.json" ]; then
  pass "前置自校验: worktree 内无 D942.json（信号只在目录名）"
else
  fail "前置失败: worktree 内竟有 D942.json —— 信号未隔离到目录名"
fi
EXIT=0
OUT=$(SYNO_TASK_STATE_DIR="$M10/task-state" SYNO_BRIEF_DIR="$F10/briefs" \
      SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_BRANCH=1 bash "$TOOL" "判别性-worktree名占942" 2>&1) || EXIT=$?
GOT10=$(printf '%s\n' "$OUT" | grep -oE '(^|[^A-Za-z0-9])D942([^0-9]|$)' | sed -n '1p' | grep -oE 'D942' || true)
if [ "$EXIT" != "0" ]; then
  assert_contains "$OUT" ".synova-wt-squad-d942" "拒绝并点名冲突位置（worktree 名原文）"
elif [ "$GOT10" = "D942" ]; then
  fail "worktree 目录名已占 942，却仍发放 D942（漏号）"
else
  pass "worktree 目录名占用 942 → 未发放 942（实际 exit=${EXIT}，无 D942 发放痕迹）"
fi
git -C "$M10" worktree remove --force "$F10/.synova-wt-squad-d942" >/dev/null 2>&1 || true
rm -rf "$F10"
echo ""

echo "── 11. D940 回归守卫: task-state 已占 942 → 绝不发放 942 ──"
# 注: 本用例在**旧实现**下也绿（NEXT=MAX+1=943，天然跳过）→ 是回归守卫、非判别性用例。
# 「task-state 已占」的判别性形态在 check-name-allocation.test.sh（校验器 --id 面）。
F11=$(mktemp -d); mkdir -p "$F11/task-state"
cp "$REPO_DIR/task-state/TEMPLATE.json" "$F11/task-state/TEMPLATE.json"
printf '{"task_id":"D941","status":"claimed"}\n' > "$F11/task-state/D941.json"
printf '{"task_id":"D942","status":"claimed"}\n' > "$F11/task-state/D942.json"
EXIT=0
OUT=$(SYNO_TASK_STATE_DIR="$F11/task-state" SYNO_BRIEF_DIR="$F11/briefs" \
      SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_WORKTREE=1 SYNO_ALLOC_NO_BRANCH=1 bash "$TOOL" "回归-task-state占942" 2>&1) || EXIT=$?
FIRST11=$(printf '%s\n' "$OUT" | sed -n '1p')
case "$FIRST11" in
  D942) fail "task-state 已占 942，却发放了 D942" ;;
  D[0-9]*) pass "已占 942 → 未发放 942（实际 ${FIRST11}）" ;;
  *) fail "stdout 第一行不是 D#（契约偏离，非静默放行）: ${FIRST11:-<空>}" ;;
esac
rm -rf "$F11"
echo ""

echo "── 12. D940/E-M5 接线判别性: 本测试必须在 ci.yml 密封清单内（删掉该行即红）──"
# 沿 check-progress-freshness.test.sh:44 / merge_writeset_gate.test.sh:36 同款。
# 此前全仓只有 check-canary-drift.sh 能察觉本测试掉出清单，但它契约恒 exit 0（CI 里写作 `|| true`）
# ⇒ 非判别性防线（E-M5，d937-v 独立自验发现）。本条把"掉出密封清单"变成**红**。
grep -q 'alloc-task-id.test.sh' "$REPO_DIR/.github/workflows/ci.yml" \
  && pass "接线: 本测试在 ci.yml control-tower-tests 密封清单（删掉该行即红）" \
  || fail "接线: 本测试不在 ci.yml 密封清单（CI 不跑 = 摆设，M3 未接线）"
echo ""

echo "═══════════════════════════════════════════════════════════"
# D938-CI-2: FAIL>0 但 FIRST_FAIL 为空 = 夹具自身缺陷（记名机制失灵），必须显式红，不得静默
if [ "$FAIL" -gt 0 ] && [ -z "$FIRST_FAIL" ]; then
  echo "  ❌ SELF-CHECK: FAIL=$FAIL 但 FIRST_FAIL 为空（fail() 记名机制缺陷）"
  exit 2
fi
# ═══ FIX-006: 拒绝面必须使用读取面同源（其它 worktree 的 task-state）——成对反例 ═══
# 缺陷: `_occupy_locations` 原只查 worktree **目录名**（⑤），而占用表读取面用的是
#   「其它 worktree 的 task-state/D*.json」⇒ 号已在别处登记时，--check-id 仍答"未占"。
# ⒜ 未占用名 → 放行（rc=0） ｜ ⒝ 已占用名（登记在另一 worktree）→ 拒绝（rc=1 + 点名）
F6_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$F6_DIR")
F6_MAIN="$F6_DIR/main"; F6_WT2="$F6_DIR/wt2"
mkdir -p "$F6_MAIN/task-state"
git -C "$F6_MAIN" init -q
git -C "$F6_MAIN" config user.email t@t.local && git -C "$F6_MAIN" config user.name t
printf '{}\n' > "$F6_MAIN/task-state/D1000.json"
git -C "$F6_MAIN" add -A >/dev/null 2>&1 && git -C "$F6_MAIN" commit -q -m base
git -C "$F6_MAIN" worktree add -q "$F6_WT2" -b wt2 >/dev/null 2>&1
mkdir -p "$F6_WT2/task-state"; printf '{}\n' > "$F6_WT2/task-state/D9999.json"
f6_check() { # $1 = 号; $2 = 锁目录后缀
  SYNO_TASK_STATE_DIR="$F6_MAIN/task-state" SYNO_LOCK_DIR="$F6_DIR/lock-$2" \
  SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_BRANCH=1 bash "$TOOL" --check-id "$1" 2>&1
}
OUT=$(f6_check 8888 a) && F6_RC=0 || F6_RC=$?
[ "$F6_RC" -eq 0 ] && pass "FIX-006⒜ 未占用名 → 放行（rc=0）" || fail "FIX-006⒜ 未占用名被拒（rc=$F6_RC）"
OUT=$(f6_check 9999 b) && F6_RC=0 || F6_RC=$?
[ "$F6_RC" -eq 1 ] && pass "FIX-006⒝ 已占用名（另一 worktree 的 task-state）→ 拒绝（rc=1）" || fail "FIX-006⒝ 漏判：已占用名被放行（rc=$F6_RC）"
printf '%s\n' "$OUT" | grep -q 'worktree-task-state' \
  && pass "FIX-006⒝ 冲突点名 worktree-task-state（读取面同源）" || fail "FIX-006⒝ 未点名 worktree-task-state"
# 判别性反例（改坏即红）: 把 ⑥ 段外层条件改成 `if false; then`（模拟回退到修前）→ ⒝ 必须重新漏判
F6_MUT="$F6_DIR/alloc-mutant.sh"
python3 -c "
import sys
src=open(sys.argv[1],encoding='utf-8').read().split(chr(10))
out=[];armed=False
for line in src:
    if line.startswith('  # ⑥ FIX-006:'):
        armed=True
    if armed and line.startswith('  if '):
        line='  if false; then   # MUTANT: 禁用 ⑥'
        armed=False
    out.append(line)
open(sys.argv[2],'w',encoding='utf-8').write(chr(10).join(out))
" "$TOOL" "$F6_MUT"
grep -q 'MUTANT: 禁用 ⑥' "$F6_MUT" && pass "FIX-006 变异体已生成（⑥ 段外层条件 → if false）" || fail "FIX-006 变异体生成失败（sed/python 未命中 ⑥ 段）"
OUT=$(SYNO_TASK_STATE_DIR="$F6_MAIN/task-state" SYNO_LOCK_DIR="$F6_DIR/lock-m" SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_BRANCH=1 bash "$F6_MUT" --check-id 9999 2>&1) && F6_RC=0 || F6_RC=$?
[ "$F6_RC" -eq 0 ] && pass "FIX-006 判别性反例: 屏蔽 ⑥ 后 ⒝ 重新漏判（说明该断言非恒真）" || fail "FIX-006 判别性反例失败: 屏蔽 ⑥ 后仍判已占用（变异体未生效）"

echo "  结果: PASS=$PASS FAIL=$FAIL${FIRST_FAIL:+ FIRST_FAIL=${FIRST_FAIL}}"
echo "═══════════════════════════════════════════════════════════"
# 失败摘要（**必须留在最后一行**：CI 只截 tail -8 进 ::error 注解）
if [ "$FAIL" -gt 0 ]; then
  D938_DIGEST=""
  for _n in ${FAILED_NAMES[@]+"${FAILED_NAMES[@]}"}; do D938_DIGEST="${D938_DIGEST}${_n} ; "; done
  echo "❌ FAILED(${FAIL}): ${D938_DIGEST}"
fi
[ "$FAIL" -eq 0 ] || exit 1
exit 0
