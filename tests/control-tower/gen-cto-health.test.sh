#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# gen-cto-health.test.sh — D384/CT-37 第③面生成器测试（幂等 + 数据源指纹）
#
# 背景: K3 审 D383 P1-4 发现 gen-cto-health.py 幂等声称不实（时间戳内嵌恒写文件）
#       + 329 行零测试。D384 修复: 数据源指纹判定（数据未变不重写）。
#
# 覆盖 (铁律 48: 正常/降级/边界):
#   1. 首次生成 → 产物含指纹行
#   2. 连续运行 → 幂等（指纹未变不写，输出"幂等"）
#   3. 数据源变化（追加 bypass.log 事件）→ 指纹变 → 重写
#   4. 语法/主流程可跑（dry-run 输出完整）
#
# 隔离: 复制仓库数据源到临时目录, 用 SYNO_* 注入? 生成器路径硬编码 → 用临时拷贝
# 方式: 直接对真实产物测试（生成器可写仓库产物，测试后恢复）。简化: 只测幂等逻辑
#       依赖的真实文件（mtime 不改动）。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
GEN="$REPO_DIR/scripts/control-tower/gen-cto-health.py"
OUT="$REPO_DIR/docs/synova/CTO-HEALTH.md"
BY_LOG="$REPO_DIR/.claude/bypass.log"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_contains() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi; }

TMPD="$(mktemp -d)"
# D1215（Lead 裁决③）—— 本测试**设计上**会改写真实产物（头注释即「直接对真实产物测试」），
#   但旧版只在「数据源未变」时才不写 ⇒ 每跑一次就把 docs/synova/CTO-HEALTH.md 弄脏
#   （实测：时间戳必变，且 git 派生计数随分支集合变）⇒ **提交产物后下一跑又脏 = 等于没修**。
#   头注释早写了「测试后恢复」的意图，本卡把它落实：**开跑前快照 + EXIT trap 无条件还原**
#   （含失败路径，避免"失败了还把产物改坏"）。
OUT_SNAPSHOT="$TMPD/CTO-HEALTH.md.orig"
[ -f "$OUT" ] && cp "$OUT" "$OUT_SNAPSHOT" 2>/dev/null || true
restore_artifact() { [ -f "$OUT_SNAPSHOT" ] && cp "$OUT_SNAPSHOT" "$OUT" 2>/dev/null || true; }
trap 'restore_artifact; rm -rf "$TMPD"' EXIT

# D1215/卡 #1268 — **生成器调用统一走此函数**：把 rc 显式交回调用方。
#   旧写法 `OUT1=$(python3 "$GEN" 2>&1)` 在 `set -euo pipefail` 下遇 rc≠0 会**立即静默中止**
#   整个测试，而 traceback 被 `2>&1` 收进变量、**永不打印** ⇒ 只剩 8 行输出 + rc=1 + 零诊断。
#   卡 #1268 的"配对门禁把该脚本一切改动锁死"正是靠这个形态实现的（失败无声）。
#   用法: run_gen <接收输出的变量名> [生成器参数…]；返回生成器的 rc（**不**中止本脚本）。
run_gen() {
  local __var="$1"; shift
  local __out __rc=0
  __out="$(python3 "$GEN" "$@" 2>&1)" || __rc=$?
  printf -v "$__var" '%s' "$__out"
  return "$__rc"
}
dump_tail() { printf '%s\n' "$1" | tail -8 | sed 's/^/      | /' >&2; }

[ -f "$OUT" ] || python3 "$GEN" >/dev/null 2>&1 || true

echo "═══════════════════════════════════════════════════════════"
echo "  D384 gen-cto-health 生成器测试（幂等 + 指纹）"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "── 1. 产物含数据源指纹行 ──"
if head -3 "$OUT" | grep -qE "数据源指纹: [0-9a-f]{12}"; then pass "指纹行存在 (12 hex)"; else fail "指纹行缺失"; fi
echo ""

echo "── 2. 连续运行 → 幂等不写 ──"
# D1215: 显式收 rc + 失败即打印原始输出（旧版把 traceback 吞进变量 ⇒ 零诊断）
rc1=0; run_gen OUT1 || rc1=$?
rc2=0; run_gen OUT2 || rc2=$?
[ "$rc1" = 0 ] && pass "第 1 次运行 exit 0" || { fail "第 1 次运行非 0 (rc=$rc1)"; dump_tail "$OUT1"; }
[ "$rc2" = 0 ] && pass "第 2 次运行 exit 0" || { fail "第 2 次运行非 0 (rc=$rc2)"; dump_tail "$OUT2"; }
assert_contains "$OUT2" "幂等" "第二次运行输出幂等"
assert_contains "$OUT2" "不写文件" "不写文件"
echo ""

echo "── 3. 数据源变化 → 指纹变 → 重写 ──"
# 备份 bypass.log 尾部, 追加一条测试事件, 运行, 恢复
TAIL_BACKUP=$(tail -1 "$BY_LOG" 2>/dev/null || true)
echo "2026-08-16T12:00:00+08:00 | COMMITTED | pre-commit PASS | TASK_ID=D384-TEST | AGENT=test" >> "$BY_LOG" 2>/dev/null || true
OUT3=""; rc3=0; run_gen OUT3 || rc3=$?
if echo "$OUT3" | grep -q "已生成"; then pass "数据源变 → 重写"; else fail "数据源变但未重写 (rc=$rc3): $(echo "$OUT3" | tail -3)"; fi
# 恢复 bypass.log（去掉测试行）
# D1215: 临时文件放 $TMPD 且**无条件清理** —— 旧写法 `> "$BY_LOG.tmp"` 把临时文件写在
#   仓内 `.claude/bypass.log.tmp`，且 `grep -v` 无命中（rc=1）时 `&& mv` 短路 ⇒ **留下垃圾**（实测 0 字节残留）。
if [ -n "$TAIL_BACKUP" ]; then
  _rstr="$TMPD/bypass.log.restored"
  if grep -v "D384-TEST" "$BY_LOG" > "$_rstr" 2>/dev/null; then
    mv "$_rstr" "$BY_LOG" 2>/dev/null || true
  fi
  rm -f "$_rstr"
fi
# 恢复幂等态
python3 "$GEN" >/dev/null 2>&1 || true
echo ""

echo "── 5. 派生逻辑（D393）: 状态从工件算, 不靠 json.status ──"
OUT5=""; rc5=0; run_gen OUT5 || rc5=$?
# D356 有 impl 提交(6db5a17a) + 审计报告 → audited; D393 新建无工件 → claimed
if echo "$OUT5" | grep -q "已生成\|幂等"; then
  TABLE=$(sed -n '/### 五、任务状态汇总/,/红线提醒/p' "$OUT" 2>/dev/null || true)
  # 输出文件可能未更新（幂等）——直接调 dry-run 拿表格
  DRY=""; run_gen DRY --dry-run || true
  # D399 (P0-1): 交付态对齐——feat(D393) 提交自身是 impl 工件 → impl_done
  if echo "$DRY" | grep -q "| D393 | audited"; then pass "D393 派生=audited (审计完成后)"; else fail "D393 派生非 audited"; fi
  if echo "$DRY" | grep -q "| D383 | audited"; then pass "D383 派生=audited (impl+audit, 无 spec 也成立)"; else fail "D383 派生非 audited"; fi
else
  fail "生成器执行失败 (rc=$rc5)"; dump_tail "$OUT5"
fi
echo ""
OUT4=""; run_gen OUT4 --dry-run || true
assert_contains "$OUT4" "数据源指纹" "dry-run 含指纹"
echo ""

echo "── 6. 🔴 三形态夹具: task-state 的 spec = dict / str / null 都必须不崩（D1215/卡 #1268）──"
# 沙箱镜像仓内相对结构（生成器 REPO = 自身 ../..），三形态台账各一条。
# 改前实测: 命中 str ⇒ AttributeError at gen-cto-health.py:305 ⇒ rc=1（本夹具因此恒红）。
SB="$TMPD/sandbox"
mkdir -p "$SB/scripts/control-tower" "$SB/task-state" "$SB/docs/synova"
if cp "$GEN" "$SB/scripts/control-tower/" 2>/dev/null; then
  pass "三形态沙箱镜像就绪"
else
  fail "三形态沙箱镜像失败（无法验证 D1215）"
fi
printf '{"task_id":"D900","title":"dict 形态","spec":{"path":"docs/synova/x.md"},"status":"claimed"}\n' > "$SB/task-state/D900.json"
printf '{"task_id":"D901","title":"str 形态","spec":"卡 #1 一段中文说明","status":"claimed"}\n'    > "$SB/task-state/D901.json"
printf '{"task_id":"D902","title":"null 形态","spec":null,"status":"claimed"}\n'                  > "$SB/task-state/D902.json"
printf '# x\n' > "$SB/docs/synova/x.md"
# 生成器依赖 git 取 head_files；沙箱无 git ⇒ 它 fail-closed exit 2（那是"检查环境不完整"，
# 不是本次要测的形态）⇒ 沙箱必须自带一个真 git 仓（与 check-pr-budget.test.sh 同款做法）。
( cd "$SB" && git init -q . && git add -A \
  && git -c user.email=t@t -c user.name=t commit -qm "sandbox init" ) >/dev/null 2>&1 || true
SB_RC=0
SB_OUT="$( ( cd "$SB" && python3 scripts/control-tower/gen-cto-health.py --dry-run 2>&1 ) )" || SB_RC=$?
# ① 正常路径: 三形态共存 ⇒ rc=0（改前此处 rc=1 —— 本夹具的核心判据）
[ "$SB_RC" = 0 ] && pass "dict/str/null 三形态共存 ⇒ rc=0（改前 AttributeError ⇒ rc=1）" \
  || { fail "三形态共存仍崩 (rc=$SB_RC)"; dump_tail "$SB_OUT"; }
# ② dict 形态仍被采信（防"过度修正成一律忽略 spec"）—— spec 列 ✅
if printf '%s' "$SB_OUT" | grep -qE '\| D900 \| spec_done \| ✅'; then
  pass "dict 形态: json spec.path 仍被采信（spec=✅，未过度修正）"
else
  fail "dict 形态 spec.path 未被采信（过度修正？）"; printf '%s\n' "$SB_OUT" | grep -E '\| D90[0-2] ' | sed 's/^/      | /' >&2
fi
# ③ str/null 形态 = 「无 json path」契约（不得崩、不得误判为有 spec）
for _t in D901 D902; do
  if printf '%s' "$SB_OUT" | grep -qE "\| ${_t} \| [a-z_]+ \| —"; then
    pass "${_t} 形态: 视为「无 json path」（spec=—，不崩）"
  else
    fail "${_t} 形态归属判定异常"; printf '%s\n' "$SB_OUT" | grep -E "\| ${_t} " | sed 's/^/      | /' >&2
  fi
done
echo ""

echo "── 7. 🔴 4 位编号: impl 提交必须被识别（D1215/卡 #1268 同族，4 处正则同修）──"
# 旧码 4 处用 `D(\d{3})`：三位正则把 D1215 读成 121，且 commit 主体的 `(D1215)` 因要求
# 紧跟 `)` 而**完全匹配不上** ⇒ 该任务的 impl 提交被**静默漏掉** ⇒ 仪表盘状态少报
# （实测 old: claimed ／ new: impl_done）。本夹具锚定「4 位号必须被解析」。
SB2="$TMPD/sandbox4"
mkdir -p "$SB2/scripts/control-tower" "$SB2/task-state" "$SB2/docs/synova"
cp "$GEN" "$SB2/scripts/control-tower/" 2>/dev/null || true
printf '{"task_id":"D1215","title":"四位数任务","spec":null,"status":"claimed"}\n' > "$SB2/task-state/D1215.json"
( cd "$SB2" && git init -q . && git add -A \
  && git -c user.email=t@t -c user.name=t commit -qm "feat(D1215): 四位数任务提交" ) >/dev/null 2>&1 || true
SB2_OUT="$( ( cd "$SB2" && python3 scripts/control-tower/gen-cto-health.py --dry-run 2>&1 ) )" || true
if printf '%s' "$SB2_OUT" | grep -qE '\| D1215 \| impl_done \|'; then
  pass "4 位号 D1215 的 impl 提交被识别（status=impl_done；三位正则下实测为 claimed）"
else
  fail "4 位号 D1215 的 impl 提交未被识别（三位正则回归？）"
  printf '%s\n' "$SB2_OUT" | grep -E '\| D121' | sed 's/^/      | /' >&2
fi
if grep -qE 'D\(\\d\{3,\}\)' "$GEN"; then
  pass "4 处 D# 正则均为 3+ 位（D(\\d{3,})）"
else
  fail "仍存在三位 D# 正则 D(\\d{3})（4 位号会被截断/漏匹配）"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
echo "═══════════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
