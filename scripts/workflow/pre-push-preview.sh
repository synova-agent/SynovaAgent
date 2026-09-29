#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# pre-push-preview.sh — D1061 任务 4: 推前四件套（本地秒级预演）
#
# ★ 一行命令（CTO 附加①，可直接嵌进推送前流程）:
#      bash scripts/workflow/pre-push-preview.sh --fast        # ≤10s，全绿才推
#
# 为什么存在（实测立论，见 docs/synova/product-lines/evidence/D1061/B-*.md）:
#   CI 上一次红 = windows CT 腿 35 分钟 + 12 条必过检查重跑；而最常见的三种红
#   **在本地就能秒级判定**，且此前没有任何本地闸:
#     ① brief 格式（`brief_parser.py:198` 只认 `- [ ]` checkbox；存量实测 9/150 = 6.0%
#        判红，全部是**手写件绕过生成器**——生成器 `- [ ] 入口可触达:` 自 2026-06-14
#        `37abc153` 起从未回退；8/9 同时缺 `#CRITERIA`）
#     ② 写集对账 D708（merge commit 上 D# 推断 + 声明源三源皆空 → fail-closed）
#     ③ 注入夹具三面残留（a 面代码面 / b 面仓库面 / c 面反向判别）
#
# 契约 (铁律 47):
#   @input  --fast（默认）: ① brief（可解析 + Done checkbox≥1 + #CRITERIA）② D708 写集对账
#                            ③ 夹具真 MARK 三面自测（a=0 / b=0 / c=反向判别必须命中）
#           --full         : fast 三件 + ④ `SYNO_CI=1 bash scripts/pre-commit-check.sh`
#           --brief <path> : 显式指定 brief（否则自动绑定：current-brief → 分支 D# → 可见 SKIP）
#           --json         : 附机器可读 JSON（含逐项 rc / 耗时 ms / 计数）
#   @output 0 = 全绿（可推）; 1 = 预演发现红（不可推）; 2 = **预演自身故障**（三态退出码 D328，
#              绝不与"全绿"混同——脚本缺失/解析器不可用一律 exit 2，不静默放行）
#   @degraded 任一子检查**无法执行**（origin/main 缺失、brief 绑定不到、pre-commit 缺失）
#              → 显式 SKIP 行 + 计入 degraded 列表（**不静默**，也不当作通过）
#
# 与重夹具的分工（不重复、不替代）:
#   `tests/control-tower/precommit-groups-injection.test.sh` 实跑 pre-commit 注入（1051s 级）；
#   本脚本的 ③ 只做**秒级**同名三面 grep 自测（a=0 / b=0 / c 反向判别），用于推前快速判别。
#   → ③ 不是 ④ 的替代：`--full` 的 ④ 才是真跑门禁。
#
# 测试注入缝（测试零真实目录、零网络）:
#   SYNO_PREVIEW_BRIEF      等价于 --brief
#   SYNO_PREVIEW_ROOTS      覆盖 ③ 的 a 面扫描根（默认 "src tests scripts .github"）
#   SYNO_PREVIEW_MARK       覆盖标记串（默认拼接自 INJECTED + -RED，避免本文件自命中）
#   SYNO_PREVIEW_SKIP_D708=1  跳过 ②（仅测试隔离用；跳过会在输出里显式标注）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MODE="fast"; BRIEF_OVERRIDE=""; AS_JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) MODE="fast"; shift ;;
    --full) MODE="full"; shift ;;
    --brief) BRIEF_OVERRIDE="${2:-}"; shift 2 ;;
    --json) AS_JSON=1; shift ;;
    -h|--help) sed -n '6,48p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ 未知参数: $1（--help 看用法）" >&2; exit 2 ;;
  esac
done
[ -n "${SYNO_PREVIEW_BRIEF:-}" ] && [ -z "$BRIEF_OVERRIDE" ] && BRIEF_OVERRIDE="$SYNO_PREVIEW_BRIEF"

PYBIN=""
if command -v python3 >/dev/null 2>&1; then PYBIN="python3"
elif command -v python >/dev/null 2>&1; then PYBIN="python"
else
  echo "❌ 预演自身故障: 找不到 python3/python → exit 2" >&2
  exit 2
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
DEGRADED_NOTES=(); FAIL_NOTES=(); RESULTS=()
now_ms() { "$PYBIN" -c 'import time;print(int(time.time()*1000))'; }
MARK="${SYNO_PREVIEW_MARK:-INJECTED""-RED}"

record() { # $1=id $2=status $3=rc $4=ms $5=note
  RESULTS+=("$1|$2|$3|$4|$5")
}

echo -e "${CYAN}══ 推前预演（D1061 任务 4 · 模式 ${MODE}）══════════════════════${RESET}"
echo "   分支: $BRANCH"
echo "   一行命令: bash scripts/workflow/pre-push-preview.sh --fast"
echo ""

# ═══ ① brief: 可解析 + Done checkbox ≥1 + #CRITERIA 存在 ═══
T0=$(now_ms)
CHECK_BRIEF="$ROOT/scripts/workflow/check-brief-parseable.sh"
BRIEF_FILE=""
if [ -n "$BRIEF_OVERRIDE" ]; then
  BRIEF_FILE="$BRIEF_OVERRIDE"
else
  # 自动绑定顺序: current-brief（session 优先，与 pre-commit CT-42 同口径）→ 分支名 D# → 可见 SKIP
  CB=""
  [ -n "${DSH_SESSION_ID:-}" ] && [ -f "$ROOT/.claude/current-brief.$DSH_SESSION_ID" ] && CB="$ROOT/.claude/current-brief.$DSH_SESSION_ID"
  [ -z "$CB" ] && [ -f "$ROOT/.claude/current-brief" ] && CB="$ROOT/.claude/current-brief"
  if [ -n "$CB" ]; then
    _name="$(head -1 "$CB" | tr -d '\r\n')"
    [ -f "$ROOT/.claude/task-briefs/$_name" ] && BRIEF_FILE="$ROOT/.claude/task-briefs/$_name"
  fi
  if [ -z "$BRIEF_FILE" ]; then
    _did="$(printf '%s' "$BRANCH" | grep -oiE '(^|[^0-9a-z])d[0-9]+' | head -1 | tr -d ' -' | tr '[:lower:]' '[:upper:]')"
    if [ -n "$_did" ]; then
      BRIEF_FILE="$(ls -1 "$ROOT/.claude/task-briefs/"*"$_did"*.md 2>/dev/null | sort | tail -1)"
    fi
  fi
fi

if [ ! -f "$CHECK_BRIEF" ]; then
  echo -e "  ${RED}❌ ① brief 检查器缺失: $CHECK_BRIEF → exit 2（预演自身故障）${RESET}" >&2
  exit 2
fi
if [ -z "$BRIEF_FILE" ] || [ ! -f "$BRIEF_FILE" ]; then
  echo -e "  ${YELLOW}⚠️  ① brief: 绑定不到 brief（无 --brief / 无 current-brief / 分支名无 D#）→ SKIP（显式，不静默）${RESET}"
  DEGRADED_NOTES+=("brief 绑定失败 → 跳过 brief 闸")
  record "brief" "skip" 0 "$(( $(now_ms) - T0 ))" "未绑定到 brief"
else
  BO="$(bash "$CHECK_BRIEF" "$BRIEF_FILE" 2>&1)"; BRC=$?
  # 三件显式回显（队长要求：可解析 + Done 有 checkbox 条目 + #CRITERIA 存在）
  PJ="$("$PYBIN" "$ROOT/scripts/control-tower/brief_parser.py" --all "$BRIEF_FILE" 2>/dev/null || echo '{}')"
  SUB="$("$PYBIN" - "$PJ" <<'PYEOF' 2>/dev/null || echo "?"
import json,sys
try: d=json.loads(sys.argv[1])
except Exception: print("?"); raise SystemExit
print(f"parseable={d.get('parseable')} criteria={d.get('criteria') or '(缺失)'} done_count={d.get('done_count',0)}")
PYEOF
)"
  if [ "$BRC" -eq 0 ]; then
    echo -e "  ${GREEN}✅ ① brief 闸: 通过${RESET}  $SUB"
    echo "     $BO"
    record "brief" "pass" 0 "$(( $(now_ms) - T0 ))" "$SUB"
  else
    echo -e "  ${RED}❌ ① brief 闸: 不通过（推送应被拦）${RESET}  $SUB"
    echo "$BO" | sed 's/^/     /'
    FAIL_NOTES+=("brief 不可解析（Done checkbox≥1 / #CRITERIA 必填）")
    record "brief" "fail" "$BRC" "$(( $(now_ms) - T0 ))" "$SUB"
  fi
fi

# ═══ ② D708 合并级写集对账 ═══
T0=$(now_ms)
GATE="$ROOT/scripts/control-tower/merge_writeset_gate.py"
if [ "${SYNO_PREVIEW_SKIP_D708:-0}" = "1" ]; then
  echo -e "  ${YELLOW}⚠️  ② D708 写集对账: SKIP（SYNO_PREVIEW_SKIP_D708=1，测试隔离用）${RESET}"
  DEGRADED_NOTES+=("D708 被显式跳过")
  record "d708" "skip" 0 "$(( $(now_ms) - T0 ))" "显式跳过"
elif [ ! -f "$GATE" ]; then
  echo -e "  ${RED}❌ ② D708: 门禁脚本缺失 $GATE → exit 2（预演自身故障）${RESET}" >&2
  exit 2
elif ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  echo -e "  ${YELLOW}⚠️  ② D708 写集对账: SKIP（origin/main 不可解析 —— 先 git fetch origin main）${RESET}"
  DEGRADED_NOTES+=("origin/main 缺失 → D708 跳过")
  record "d708" "skip" 0 "$(( $(now_ms) - T0 ))" "origin/main 不可解析"
else
  GO="$("$PYBIN" "$GATE" --base origin/main --head HEAD --branch "$BRANCH" 2>&1)"; GRC=$?
  echo "$GO" | grep -E '^(✅|⚠️|❌|⏭)' | sed 's/^/     /'
  if [ "$GRC" -eq 0 ]; then
    echo -e "  ${GREEN}✅ ② D708 写集对账: 通过（rc=0）${RESET}"
    record "d708" "pass" 0 "$(( $(now_ms) - T0 ))" "rc=0"
  else
    echo -e "  ${RED}❌ ② D708 写集对账: 不通过（rc=$GRC —— 夹带/声明源空）${RESET}"
    FAIL_NOTES+=("D708 写集对账 rc=$GRC")
    record "d708" "fail" "$GRC" "$(( $(now_ms) - T0 ))" "rc=$GRC"
  fi
fi

# ═══ ③ 夹具真 MARK 三面自测（a 面代码面 / b 面仓库面（排除 docs）/ c 面反向判别）═══
T0=$(now_ms)
ROOTS="${SYNO_PREVIEW_ROOTS:-src tests scripts .github}"
A_HITS="$(grep -rl "$MARK" $ROOTS 2>/dev/null | wc -l | tr -d ' \n')"
B_HITS="$(grep -rl "$MARK" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs 2>/dev/null | wc -l | tr -d ' \n')"
# c 面反向判别: 探针必须能**找到**标记（否则 grep 失效/正则写错 → 前两面恒 0 是假绿）
CDIR="$(mktemp -d)"; printf '%s\n' "$MARK" > "$CDIR/probe.txt"
C_HITS="$(grep -rl "$MARK" "$CDIR" 2>/dev/null | wc -l | tr -d ' \n')"
rm -rf "$CDIR"
echo "     a) 代码/测试/脚本/CI 面残留: $A_HITS 个文件（期望 0，扫描根: ${ROOTS}）"
echo "     b) 仓库面残留（排除 docs）: $B_HITS 个文件（期望 0）"
echo "     c) 反向判别（探针必须命中）: ${C_HITS}（期望 ≥1，=0 说明探针失效＝假绿）"
if [ "$A_HITS" -eq 0 ] && [ "$B_HITS" -eq 0 ] && [ "$C_HITS" -ge 1 ]; then
  echo -e "  ${GREEN}✅ ③ 夹具三面自测: 通过${RESET}"
  record "marks" "pass" 0 "$(( $(now_ms) - T0 ))" "a=$A_HITS b=$B_HITS c=$C_HITS"
else
  echo -e "  ${RED}❌ ③ 夹具三面自测: 不通过（a=${A_HITS} b=${B_HITS} c=${C_HITS}）${RESET}"
  FAIL_NOTES+=("夹具三面残留 a=$A_HITS b=$B_HITS c=$C_HITS")
  record "marks" "fail" 1 "$(( $(now_ms) - T0 ))" "a=$A_HITS b=$B_HITS c=$C_HITS"
fi

# ═══ ④（--full）真跑门禁: SYNO_CI=1 pre-commit-check ═══
if [ "$MODE" = "full" ]; then
  T0=$(now_ms)
  PC="$ROOT/scripts/pre-commit-check.sh"
  if [ ! -f "$PC" ]; then
    echo -e "  ${RED}❌ ④ pre-commit 缺失: $PC → exit 2（预演自身故障）${RESET}" >&2
    exit 2
  fi
  echo -e "  ${CYAN}── ④ SYNO_CI=1 pre-commit-check（--full 才跑）──${RESET}"
  if SYNO_CI=1 bash "$PC" > /tmp/syno-preview-precommit.log 2>&1; then
    PRC=0
  else
    PRC=$?
  fi
  grep -E '❌|未通过' /tmp/syno-preview-precommit.log | head -6 | sed 's/^/     /'
  if [ "$PRC" -eq 0 ]; then
    echo -e "  ${GREEN}✅ ④ pre-commit（SYNO_CI strict）: 通过（日志 /tmp/syno-preview-precommit.log）${RESET}"
    record "precommit" "pass" 0 "$(( $(now_ms) - T0 ))" "SYNO_CI=1 全绿"
  else
    echo -e "  ${RED}❌ ④ pre-commit（SYNO_CI strict）: 不通过（rc=${PRC}，完整日志 /tmp/syno-preview-precommit.log）${RESET}"
    FAIL_NOTES+=("SYNO_CI=1 pre-commit rc=$PRC")
    record "precommit" "fail" "$PRC" "$(( $(now_ms) - T0 ))" "rc=$PRC"
  fi
fi

echo ""
if [ "${#DEGRADED_NOTES[@]}" -gt 0 ]; then
  echo -e "  ${YELLOW}⚠️  降级（可见，不计通过也不计红）:${RESET}"
  for n in "${DEGRADED_NOTES[@]}"; do echo "     - $n"; done
fi
if [ "$AS_JSON" -eq 1 ]; then
  _rows="$(printf '%s\n' "${RESULTS[@]}")"
  printf '%s' "$_rows" | "$PYBIN" -c "
import json,sys
rows=[]
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    i,s,rc,ms,note=line.split('|',4)
    rows.append({'id':i,'status':s,'rc':int(rc),'ms':int(ms),'note':note})
executed=[r for r in rows if r['status'] != 'skip']
print(json.dumps({'mode':sys.argv[1],'branch':sys.argv[2],'checks':rows,
                  'suites_run':len(rows),'cases_run':len(executed),
                  'total_ms':sum(r['ms'] for r in rows)}, ensure_ascii=False))" "$MODE" "$BRANCH"
fi

if [ "${#FAIL_NOTES[@]}" -gt 0 ]; then
  echo ""
  echo -e "  ${RED}❌ 推前预演未通过 — 请修复后再推（本地能抓的错别送 CI）${RESET}"
  for n in "${FAIL_NOTES[@]}"; do echo "     - $n"; done
  exit 1
fi
echo -e "  ${GREEN}✅ 推前预演全绿 — 可以推送${RESET}"
exit 0
