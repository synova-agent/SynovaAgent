#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# doc-truth-probe.sh — 文档真相防线存活探针 + DRIFT-LEDGER 机器生成（D782 / K3 §7.2 收割 3）
#
# 解决的问题（K3 2026-09-14 审计 T1/收割 3）: DRIFT-LEDGER 手写台账 25 天未重跑且
#   声称与 git 事实相反（"LOOP.md 8-20 已重写"从未合入）——"防线绿"与"防线从未运行"
#   无法区分。本脚本使台账由机器生成（最后验证时间 + exit + 原始输出摘要 + 红龄），
#   并以三态探针区分: FRESH-GREEN / FRESH-RED / STALE|NEVER-RUN。
#
# 契约（铁律 47 契约优先）:
#   @input  — [无参] 跑 D1 check-doc-truth.sh 并刷新 DRIFT-LEDGER.md 机器段 + 输出探针判定
#             --probe-only  只读台账机器段判定（不跑 D1、不写文件——CI/巡检用）
#             DOC_TRUTH_ROOT 覆盖仓库根（测试用）; DOC_PROBE_STALE_DAYS 覆盖红龄阈值(默认7)
#   @output — stdout: 探针判定行（PROBE: <态> ...）+ 机器段台账; 台账含 lastVerifiedAt/
#             exitCode/summary/firstRedAt/redAgeDays 五字段（HTML 注释块，探针自解析）
#   @exit   — 0 = FRESH-GREEN（防线绿且新鲜）
#             1 = FRESH-RED（防线红但新鲜——真实漂移待修）或 STALE/NEVER-RUN（防线停摆）
#             2 = 探针自身执行失败（D1 缺失/台账不可解析——D328 三态，绝不与通过混同）
#   @degraded — D1 脚本缺失 / python3 不可用 → exit 2 + stderr "degraded: <原因>"（铁律 11/24）
#
# 设计约束:
#   - bash 3.2 兼容（mac 自带; 无 declare -A）+ 无 GNU-only 语法（touch -d/date -v 禁用,
#     时间运算走 python3——D520 平台清单）
#   - 台账人工段（修复历史）只追加不覆盖; 机器段整体重写
#   - pre-commit 的 D782 块（PR-1）每次真实提交都会跑 D1 → 台账天然保鲜
# ═══════════════════════════════════════════════════════════════════════════════
set +e

ROOT="${DOC_TRUTH_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" # swallow-ok:
LEDGER="$ROOT/docs/authority/DRIFT-LEDGER.md"
D1="$ROOT/scripts/doc-system/check-doc-truth.sh"
STALE_DAYS="${DOC_PROBE_STALE_DAYS:-7}"
MODE="run"
[ "$1" = "--probe-only" ] && MODE="probe-only"

# ── 时间工具（python3 跨平台; 不可用 → degraded exit 2）──
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then
  echo "degraded: python3 不可用，探针无法判定新鲜度（D328 exit 2）" >&2
  exit 2
fi

now_iso=$("$PYBIN" -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(timespec='seconds'))")

# ── 台账机器段解析（probe-only 与 run 共用）──
# 输出: <lastVerifiedAt>\t<exitCode>\t<firstRedAt>（无台账/无字段 → 空行）
parse_ledger() {
  if [ ! -f "$LEDGER" ]; then echo ""; echo ""; echo ""; return; fi
  "$PYBIN" - "$LEDGER" <<'PYEOF'
import sys, re
try:
    text = open(sys.argv[1], encoding='utf-8', errors='replace').read()
except OSError:
    print(""); print(""); print(""); sys.exit(0)
m = re.search(r'<!--\s*doc-truth-probe 机器段.*?-->', text, re.S)
if not m:
    print(""); print(""); print(""); sys.exit(0)
block = m.group(0)
def field(name):
    fm = re.search(rf'^{name}:[ \t]*(.*)$', block, re.M)
    return fm.group(1).strip() if fm else ''
for name in ('lastVerifiedAt', 'exitCode', 'firstRedAt'):
    print(field(name))
PYEOF
}

# ── 新鲜度/红龄计算: $1=lastVerifiedAt $2=exitCode $3=firstRedAt → stdout <age>\t<stale>\t<redAge> ──
# 注意: 参数走 argv 不走 stdin——本函数用 heredoc 传 python 脚本（`python -` 的 stdin 已被
#       脚本占用，sys.stdin.read() 恒空 → D782 调试实测 never-run 假判）
age_calc() {
  "$PYBIN" - "$STALE_DAYS" "$now_iso" "$1" "$2" "$3" <<'PYEOF'
import sys, datetime
stale_days = int(sys.argv[1]); now_s = sys.argv[2]
last, exit_code, first_red = (list(sys.argv[3:6]) + ['', '', ''])[:3]
def parse_iso(s):
    if not s: return None
    try:
        t = datetime.datetime.fromisoformat(s)
        if t.tzinfo is None: t = t.replace(tzinfo=datetime.timezone.utc)
        return t
    except ValueError: return None
now = parse_iso(now_s)
age = red_age = ''
stale = 'never-run' if not last else ''
if last and now:
    t = parse_iso(last)
    if t is None:
        stale = 'unparseable'
    else:
        d = (now - t).total_seconds() / 86400.0
        if d > stale_days: stale = 'stale'
        age = f"{d:.2f}"
if stale in ('', 'stale') and first_red and now:
    t = parse_iso(first_red)
    if t is not None:
        red_age = f"{max(0.0, (now - t).total_seconds() / 86400.0):.2f}"
print(f"{age}\t{stale}\t{red_age}")
PYEOF
}

# ── probe-only: 只读判定 ──
if [ "$MODE" = "probe-only" ]; then
  if [ ! -f "$D1" ]; then
    echo "degraded: D1 脚本缺失 ${D1}（D328 exit 2）" >&2; exit 2
  fi
  PARSED=$(parse_ledger)
  _LV=$(printf '%s\n' "$PARSED" | sed -n '1p' | tr -d '\r')
  _EC=$(printf '%s\n' "$PARSED" | sed -n '2p' | tr -d '\r')
  _FR=$(printf '%s\n' "$PARSED" | sed -n '3p' | tr -d '\r')
  AGE_LINE=$(age_calc "$_LV" "$_EC" "$_FR")
  # 三值单行 tab 分隔（age \t stale \t redAge）→ cut 取字段（sed -n Np 是按行取，此处是按列）
  AGE=$(printf '%s' "$AGE_LINE" | cut -f1 | tr -d '\r')
  STALE=$(printf '%s' "$AGE_LINE" | cut -f2 | tr -d '\r')
  RED_AGE=$(printf '%s' "$AGE_LINE" | cut -f3 | tr -d '\r')
  EXIT_CODE=$(printf '%s\n' "$PARSED" | sed -n '2p' | tr -d '\r')
  case "$STALE" in
    never-run) echo "PROBE: NEVER-RUN — 台账无机器段，防线从未运行（D782 探针）"; exit 1 ;;
    unparseable) echo "degraded: 台账机器段不可解析（D328 exit 2）" >&2; exit 2 ;;
    stale) echo "PROBE: STALE — 台龄超 ${STALE_DAYS} 天（age=${AGE}d），防线停摆或从未被调用（D782 探针）"; exit 1 ;;
  esac
  if [ "$EXIT_CODE" = "0" ]; then
    echo "PROBE: FRESH-GREEN — 防线新鲜且绿（age=${AGE}d, redAge=${RED_AGE:-0}d）（D782 探针）"; exit 0
  else
    echo "PROBE: FRESH-RED — 防线新鲜但红（redAge=${RED_AGE:-?}d > 7 天应升级防线失效，K3 M9 提案）（D782 探针）"; exit 1
  fi
fi

# ── run: 跑 D1 → 刷新台账机器段 → 判定 ──
if [ ! -f "$D1" ]; then
  echo "degraded: D1 脚本缺失 ${D1}（D328 exit 2）" >&2; exit 2
fi
D1_OUT=$(bash "$D1" 2>&1)
D1_EXIT=$?
ANSI_ESC=$'\033'
D1_PLAIN=$(printf '%s\n' "$D1_OUT" | sed "s/${ANSI_ESC}\\[[0-9;]*m//g")
SUMMARY=$(printf '%s\n' "$D1_PLAIN" | grep -E '汇总|✅ 全部硬检查通过|项硬失败' | tail -1 | sed 's/^ *//' || true)
[ -z "$SUMMARY" ] && SUMMARY=$(printf '%s\n' "$D1_PLAIN" | tail -1 | sed 's/^ *//')
FAILS=$(printf '%s\n' "$D1_PLAIN" | grep '❌' | sed 's/^ *//' || true)

# 保留旧机器段的 firstRedAt（红连续性计算）
OLD_PARSED=$(parse_ledger)
OLD_EXIT=$(printf '%s\n' "$OLD_PARSED" | sed -n '2p' | tr -d '\r')
OLD_FIRST_RED=$(printf '%s\n' "$OLD_PARSED" | sed -n '3p' | tr -d '\r')

if [ "$D1_EXIT" -eq 0 ]; then
  FIRST_RED=""
else
  # 首红时刻: 上一轮也红 → 继承; 本轮新红 → now
  if [ "$OLD_EXIT" != "0" ] && [ -n "$OLD_FIRST_RED" ]; then
    FIRST_RED="$OLD_FIRST_RED"
  else
    FIRST_RED="$now_iso"
  fi
fi

MACHINE_BLOCK="<!-- doc-truth-probe 机器段（勿手编——scripts/doc-system/doc-truth-probe.sh 生成; 探针解析 lastVerifiedAt/exitCode/firstRedAt）
lastVerifiedAt: $now_iso
exitCode: $D1_EXIT
summary: $SUMMARY
firstRedAt: $FIRST_RED
-->"

# 台账写入: 已有台账 → 替换机器段（无则头部插入）; 无台账 → 新建（含人工段骨架）
if [ -f "$LEDGER" ]; then
  "$PYBIN" - "$LEDGER" "$MACHINE_BLOCK" <<'PYEOF'
import sys, re
path, block = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
if re.search(r'<!--\s*doc-truth-probe 机器段.*?-->', text, re.S):
    text = re.sub(r'<!--\s*doc-truth-probe 机器段.*?-->', lambda m: block, text, count=1, flags=re.S)
else:
    text = block + '\n\n' + text
open(path, 'w', encoding='utf-8').write(text)
print('ledger-updated')
PYEOF
else
  mkdir -p "$(dirname "$LEDGER")"
  {
    echo "$MACHINE_BLOCK"
    echo ""
    echo "# DRIFT-LEDGER.md — 文档漂移台账"
    echo ""
    echo "> 用途：记录 \`check-doc-truth.sh\` 发现的文档-事实不一致。机器段由 \`doc-truth-probe.sh\` 生成（勿手编），人工修复历史在下方追加。"
    echo "> 检测命令：\`bash scripts/doc-system/doc-truth-probe.sh\`（跑 D1 + 刷新台账 + 三态探针）"
    echo ""
    echo "## 当前状态（机器段，见文件头注释块）"
    echo ""
    echo "## 已修复历史（人工维护，只追加）"
    echo ""
    echo "| # | 位置 | 问题 | 修复 | 日期 |"
    echo "|---|---|---|---|---|"
  } > "$LEDGER"
fi

# 人工段追加本轮红项提示（不重复刷机器段）
if [ "$D1_EXIT" -ne 0 ]; then
  echo "PROBE: FRESH-RED — D1 存在硬失败，台账已刷新（firstRedAt=${FIRST_RED}）:"
  printf '%s\n' "$FAILS" | head -8 | sed 's/^/     /'
  exit 1
fi
echo "PROBE: FRESH-GREEN — D1 全部硬检查通过，台账已刷新（${SUMMARY}）"
exit 0
