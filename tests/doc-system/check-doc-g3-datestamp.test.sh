#!/usr/bin/env bash
# D313/D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-g3-datestamp.test.sh — G-DOC-3 日期戳判据配对测试（#1148 / B3 批）
#
# 为什么是"判别力"夹具而不是示例夹具:
#   判据能不能拦人，只能由**改坏即红**证明——原脚本在违规夹具上必须 exit 1；
#   同一夹具上把判定点 sed 成恒假（`@mutate-point: date-compare`）后必须 exit 0；
#   变异体仍 exit 1 ⇒ 本测试判红（监听点没生效 = 纸老虎）。
#
# 覆盖矩阵（A 正常/两态 ｜ B ±1 天边界 ｜ C 基线棘轮 ｜ D 三态降级 ｜ E 变异体）:
#   A1 头部日期=首次提交日（今天）⇒ exit 0 且 `G-DOC-3: OK 1/1`
#   A2 判据两态: 头部 2026-01-01、首次提交今天 ⇒ exit 1 且点名 `doc.md:1`；
#      改成今天日期再 commit ⇒ exit 0
#   A3 默认基线不存在 ⇒ 打印 `ℹ️ 无基线`，不制造假红
#   B  ±1 天容忍: 昨天/明天 ⇒ 0；前天 ⇒ 1（含 `日期：`/`date:` 两种字段形态）
#   C  基线棘轮: 存量违规入基线 ⇒ 0 且 `存量基线: 1`（基线文件自身不参与扫描）；
#      再新增一份违规 ⇒ 1 且只点新增；基线路径已修好 ⇒ 提示 `基线可收紧`；
#      显式基线不存在 ⇒ 2 + E_BASELINE_MISSING
#   D  三态: 非 git 仓 ⇒ 2（E_NOT_REPO）；空仓（git log 失败）⇒ 2（E_GIT_LOG）；
#      追踪文件在工作树被删 ⇒ 2（E_UNREADABLE）；检出头部日期=0 ⇒ 2（E_EMPTY，信号量==0）；
#      降级日志恰含 JSON 一行且五字段齐全
#   E  变异体: 原脚本在违规夹具 ⇒ 1；`MUTATE_TARGET = False` 变异体 ⇒ 0
#
# 沙箱: 全部夹具在 mktemp -d 内；日期用 GIT_AUTHOR_DATE/GIT_COMMITTER_DATE 固定；
#       降级日志经 SYNO_GATE_DEGRADED_LOG 重定向进临时目录（绝不写仓库）。
# 依赖: git（夹具）＋ python（日期与 JSON 断言；三级探测，缺失 ⇒ 判红不 skip）。
# 运行: bash tests/doc-system/check-doc-g3-datestamp.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e

# 环境隔离（AGENTS.md §8.1 ②）: 夹具不得继承外层 git 上下文/CI 变量，否则夹具可能在错误仓库里提交
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
unset GIT_AUTHOR_DATE GIT_COMMITTER_DATE

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
S="$REPO/scripts/doc-system/check-doc-g3-datestamp.sh"
PASS=0
FAIL=0

ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
t() { if [ "$2" = "$3" ]; then ok "$1 (=$3)"; else no "$1 (期望 $2 实际 $3)"; fi; }

fatal() { # 夹具/环境失败 ⇒ 后续断言不可信：打印汇总后判红（禁 skip 冒充通过）
  no "环境/夹具失败: $1"
  echo ""
  echo "── 汇总: ${PASS} 通过 / ${FAIL} 失败 ──"
  echo "结果: ${PASS} 通过, ${FAIL} 失败"
  exit 1
}

[ -f "$S" ] || fatal "被测脚本缺失: $S"

PY=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import datetime" >/dev/null 2>&1 && PY="$_c" && break
done
[ -n "$PY" ] || fatal "python 三级探测全失败（D520 清单1）—— 无法核判据"
command -v git >/dev/null 2>&1 || fatal "git 不可用 —— 夹具需要真实 git 历史"

TMPD="$(mktemp -d)" || fatal "mktemp -d 失败"
trap 'rm -rf "$TMPD"' EXIT
LAST="$TMPD/last.out"
export SYNO_GATE_DEGRADED_LOG="$TMPD/degraded-events.log"  # 降级只落临时目录，不进仓库

# 固定日期轴（与机器时钟无关的只有"相对今天"这件事；提交日期显式给，不靠当前时钟）
DATES="$("$PY" -c 'import datetime
t = datetime.date.today()
print(t.isoformat())
print((t - datetime.timedelta(days=1)).isoformat())
print((t + datetime.timedelta(days=1)).isoformat())
print((t - datetime.timedelta(days=2)).isoformat())')"
TODAY="$(printf '%s\n' "$DATES" | sed -n 1p)"
YDAY="$(printf '%s\n'   "$DATES" | sed -n 2p)"
TMRW="$(printf '%s\n'   "$DATES" | sed -n 3p)"
D2="$(printf '%s\n'     "$DATES" | sed -n 4p)"
[ -n "$TODAY" ] && [ -n "$D2" ] || fatal "取不到日期轴（today=${TODAY} today-2=${D2}）"

# rc_of: 跑被测脚本（--root 夹具 + 额外参数），stdout+stderr 落 $LAST，回显退出码
rc_of() {
  local d="$1"; shift
  bash "$S" --root "$d" "$@" > "$LAST" 2>&1
  echo $?
}
out_has() { grep -qF -- "$1" "$LAST"; }
out_cnt() { grep -cF -- "$1" "$LAST" | tr -d '\r\n'; }

new_repo() { git -c init.defaultBranch=main init -q "$1" >/dev/null 2>&1; }
# commit_at: 在 $1 里以 $2 的日期提交全部变更（作者/提交者日期固定，禁靠当前时钟）
commit_at() {
  ( cd "$1" && GIT_AUTHOR_DATE="${2}T12:00:00+0000" GIT_COMMITTER_DATE="${2}T12:00:00+0000" \
      git -c user.name=t -c user.email=t@t -c commit.gpgsign=false add -A && \
    GIT_AUTHOR_DATE="${2}T12:00:00+0000" GIT_COMMITTER_DATE="${2}T12:00:00+0000" \
      git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm "${3:-step}" ) >/dev/null 2>&1
}

echo "═══ check-doc-g3-datestamp.test.sh — G-DOC-3 日期戳判据（#1148 B3）═══"
echo "日期轴: today=${TODAY} yesterday=${YDAY} tomorrow=${TMRW} today-2=${D2}"

# ── A 正常 / 判据两态 ───────────────────────────────────────────────────────
echo "── A 正常 / 判据两态 ──"
D="$TMPD/a1"; mkdir -p "$D"
new_repo "$D" || fatal "A1 git init 失败"
printf '# 夹具文档\n\n> 版本 V1 | %s\n\n正文。\n' "$TODAY" > "$D/doc.md"
commit_at "$D" "$TODAY" base || fatal "A1 commit 失败"
t "A1 头部日期=首次提交日（${TODAY}）⇒ 0" 0 "$(rc_of "$D")"
out_has "G-DOC-3: OK 1/1" && ok "A1 汇总 G-DOC-3: OK 1/1" || no "A1 缺汇总 G-DOC-3: OK 1/1"
out_has "ℹ️ 无基线" && ok "A3 默认基线缺失 ⇒ 打印 ℹ️ 无基线（不判红）" || no "A3 未打印 ℹ️ 无基线"

D="$TMPD/a2"; mkdir -p "$D"
new_repo "$D" || fatal "A2 git init 失败"
printf '日期：2026-01-01\n\n正文。\n' > "$D/doc.md"
commit_at "$D" "$TODAY" base || fatal "A2 commit 失败"
t "A2 头部 2026-01-01 vs 首次提交 ${TODAY} ⇒ 1" 1 "$(rc_of "$D" --no-baseline)"
out_has "doc.md:1" && ok "A2 点名 doc.md:1" || no "A2 未点名 doc.md:1"
out_has "G-DOC-3: VIOLATION 1" && ok "A2 汇总 G-DOC-3: VIOLATION 1" || no "A2 汇总行不符"
printf '日期：%s\n\n正文。\n' "$TODAY" > "$D/doc.md"
commit_at "$D" "$TODAY" fix || fatal "A2 修复 commit 失败"
t "A2 改成今天日期再 commit ⇒ 0" 0 "$(rc_of "$D" --no-baseline)"

# ── B ±1 天容忍边界 ─────────────────────────────────────────────────────────
echo "── B ±1 天容忍边界 ──"
D="$TMPD/b1"; mkdir -p "$D"
new_repo "$D" || fatal "B1 git init 失败"
printf 'date: %s\n\n正文。\n' "$YDAY" > "$D/doc.md"
commit_at "$D" "$TODAY" base || fatal "B1 commit 失败"
t "B1 昨天（差 1 天，date: 形态）⇒ 0" 0 "$(rc_of "$D" --no-baseline)"

D="$TMPD/b2"; mkdir -p "$D"
new_repo "$D" || fatal "B2 git init 失败"
printf '> 版本 V1 | %s\n' "$TMRW" > "$D/doc.md"
commit_at "$D" "$TODAY" base || fatal "B2 commit 失败"
t "B2 明天（差 1 天）⇒ 0" 0 "$(rc_of "$D" --no-baseline)"

D="$TMPD/b3"; mkdir -p "$D"
new_repo "$D" || fatal "B3 git init 失败"
printf '> 版本 V1 | %s\n' "$D2" > "$D/doc.md"
commit_at "$D" "$TODAY" base || fatal "B3 commit 失败"
t "B3 前天（差 2 天）⇒ 1" 1 "$(rc_of "$D" --no-baseline)"

# ── C 基线棘轮（只减不增）──────────────────────────────────────────────────
echo "── C 基线棘轮 ──"
D="$TMPD/c1"; mkdir -p "$D"
new_repo "$D" || fatal "C1 git init 失败"
# 基线文件自身也带"违规日期头"：若被扫进扫描面就会新增违规 ⇒ 下面 rc=0 同时证明"禁自指"
printf '> 2026-01-01\n\n<!-- G-DOC-3-BASELINE:BEGIN -->\ndoc.md\n<!-- G-DOC-3-BASELINE:END -->\n' > "$D/base.md"
printf '> 2026-01-01\n' > "$D/doc.md"
commit_at "$D" "$TODAY" base || fatal "C1 commit 失败"
t "C1 存量违规入基线 ⇒ 0（基线内不阻断）" 0 "$(rc_of "$D" --baseline "$D/base.md")"
out_has "存量基线: 1" && ok "C1 汇总 存量基线: 1" || no "C1 缺 存量基线: 1"
[ "$(out_cnt "❌")" = "0" ] && ok "C1 存量违规不打 ❌（只打存量豁免）" || no "C1 存量违规仍打 ❌（计数=$(out_cnt "❌")）"
out_has "ℹ️ 存量豁免: doc.md:1" && ok "C1 存量逐条点名（ℹ️ 存量豁免）" || no "C1 未列存量豁免行"
# 新增一份违规（已 commit ⇒ 有首次提交记录）
printf '> 2026-01-01\n' > "$D/doc2.md"
commit_at "$D" "$TODAY" add-doc2 || fatal "C2 commit 失败"
t "C2 基线外新增一份违规 ⇒ 1" 1 "$(rc_of "$D" --baseline "$D/base.md")"
out_has "❌ doc2.md:1" && ok "C2 点名新增 doc2.md:1" || no "C2 未点名新增 doc2.md:1"
[ "$(out_cnt "❌")" = "1" ] && ok "C2 只点新增（❌ 计数=1）" || no "C2 ❌ 计数=$(out_cnt "❌")（应 1）"
out_has "存量基线: 1" && ok "C2 存量仍单列 1" || no "C2 存量计数丢失"

D="$TMPD/c3"; mkdir -p "$D"
new_repo "$D" || fatal "C3 git init 失败"
printf '> 2026-01-01\n\n<!-- G-DOC-3-BASELINE:BEGIN -->\ndoc.md\n<!-- G-DOC-3-BASELINE:END -->\n' > "$D/base.md"
printf '> %s\n' "$TODAY" > "$D/doc.md"
commit_at "$D" "$TODAY" base || fatal "C3 commit 失败"
t "C3 基线路径已修好 ⇒ 0" 0 "$(rc_of "$D" --baseline "$D/base.md")"
out_has "ℹ️ 基线可收紧: doc.md" && ok "C3 提示 基线可收紧: doc.md（不判红）" || no "C3 未提示可收紧"
out_has "存量基线: 0" && ok "C3 存量基线: 0 条" || no "C3 存量计数不为 0"

D="$TMPD/c4"; mkdir -p "$D"
new_repo "$D" || fatal "C4 git init 失败"
printf '> %s\n' "$TODAY" > "$D/doc.md"
commit_at "$D" "$TODAY" base || fatal "C4 commit 失败"
t "C4 显式基线不存在 ⇒ 2" 2 "$(rc_of "$D" --baseline "$TMPD/no-such-baseline.md")"
out_has "degraded: E_BASELINE_MISSING" && ok "C4 degraded: E_BASELINE_MISSING" || no "C4 缺 E_BASELINE_MISSING"

# ── D 三态与降级（判不了 ≠ 通过）────────────────────────────────────────────
echo "── D 三态与降级 ──"
D="$TMPD/d1"; mkdir -p "$D"   # 非 git 仓
t "D1 非 git 仓 ⇒ 2" 2 "$(rc_of "$D")"
out_has "degraded: E_NOT_REPO" && ok "D1 degraded: E_NOT_REPO" || no "D1 缺 E_NOT_REPO"

D="$TMPD/d2"; mkdir -p "$D"   # 空仓：git init 无 commit ⇒ git log 失败
new_repo "$D" || fatal "D2 git init 失败"
t "D2 空仓（git log 失败）⇒ 2" 2 "$(rc_of "$D")"
out_has "degraded: E_GIT_LOG" && ok "D2 degraded: E_GIT_LOG" || no "D2 缺 E_GIT_LOG"

D="$TMPD/d3"; mkdir -p "$D"   # 追踪文件在工作树被删
new_repo "$D" || fatal "D3 git init 失败"
printf '> %s\n' "$TODAY" > "$D/doc.md"
commit_at "$D" "$TODAY" base || fatal "D3 commit 失败"
rm -f "$D/doc.md"
t "D3 追踪文件在工作树被删 ⇒ 2" 2 "$(rc_of "$D")"
out_has "degraded: E_UNREADABLE" && ok "D3 degraded: E_UNREADABLE" || no "D3 缺 E_UNREADABLE"

D="$TMPD/d4"; mkdir -p "$D"   # 有 .md 但无头部日期 ⇒ 信号量==0
new_repo "$D" || fatal "D4 git init 失败"
printf '# 无头部日期\n\n正文。\n' > "$D/doc.md"
commit_at "$D" "$TODAY" base || fatal "D4 commit 失败"
t "D4 检出头部日期=0 ⇒ 2（信号量==0 禁当通过）" 2 "$(rc_of "$D")"
out_has "degraded: E_EMPTY" && ok "D4 degraded: E_EMPTY" || no "D4 缺 E_EMPTY"

tail -1 "$SYNO_GATE_DEGRADED_LOG" | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
assert d.get("time"), "time missing"
assert d.get("component") == "check-doc-g3-datestamp", "component=%r" % d.get("component")
assert d.get("code"), "code missing"
assert d.get("phase"), "phase missing"
assert d.get("retryable") is True, "retryable=%r" % d.get("retryable")
' && ok "D5 降级日志 JSON 字段齐全（time/component/code/phase/retryable）" \
  || no "D5 降级日志字段缺失或不是合法 JSON"

# ── E 变异体（改坏即红 = 判别力自证）─────────────────────────────────────────
echo "── E 变异体（改坏即红）──"
MUT="$TMPD/mut"; mkdir -p "$MUT" || fatal "建变异体目录失败"
D="$TMPD/e1"; mkdir -p "$D"
new_repo "$D" || fatal "E1 git init 失败"
printf '日期：2026-01-01\n\n正文。\n' > "$D/doc.md"   # 与 A2 同型的违规夹具
commit_at "$D" "$TODAY" base || fatal "E1 commit 失败"
t "E1 原脚本在违规夹具 ⇒ 1（监听点有判别力）" 1 "$(rc_of "$D" --no-baseline)"
sed 's/^[[:space:]]*MUTATE_TARGET = .*/    MUTATE_TARGET = False  # MUTANT/' "$S" > "$MUT/mutant.sh"
grep -q 'MUTATE_TARGET = False' "$MUT/mutant.sh" \
  && ok "E2 变异体已生成（sed 命中 @mutate-point: date-compare）" \
  || no "E2 sed 未命中变异靶（脚本结构已变，须同步本测试）"
bash "$MUT/mutant.sh" --root "$D" --no-baseline > "$LAST" 2>&1
[ "$?" -eq 0 ] && ok "E3 变异体（MUTATE_TARGET=False）仍 exit 0（监听点真实生效）" \
  || no "E3 变异体仍非 0 ⇒ 判据没在看日期比较（夹具是纸老虎，判红）"

echo ""
echo "── 汇总: ${PASS} 通过 / ${FAIL} 失败 ──"
echo "结果: ${PASS} 通过, ${FAIL} 失败"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
