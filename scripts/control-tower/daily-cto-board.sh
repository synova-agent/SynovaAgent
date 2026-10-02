#!/usr/bin/env bash
# D948 — CTO 每日自动看板（官方 schedule 触发；吸收 D796 每日体检静默失败的教训）
# 三态：0=OK 1=有红项(已告警) 2=degraded(环境不可用, fail-closed，绝不静默通过)
set -uo pipefail

# D520/V5 平台敏感命令规避：Windows 可能无 python3.exe（仅 python / py -3）
PYBIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || echo python3)"
REPO="${SYNO_REPO:-/Users/wane/SynovaAgent}"
OUT="$REPO/docs/synova/coordination/CTO-看板-自动.md"
LOG="$REPO/.codex/control-tower/logs/daily-board.log"
mkdir -p "$(dirname "$LOG")" "$(dirname "$OUT")"
stamp="$(date '+%Y-%m-%dT%H:%M:%S%z')"

# ── 工作区自检（D796 的失败根因就是"目标工作区已不存在"却没告警）──
# 注意: worktree 的 .git 是**文件**不是目录，故用 -e 而非 -d（D948 自证发现）
if [ ! -e "$REPO/.git" ]; then
  printf '%s degraded: 目标工作区不存在 (%s)\n' "$stamp" "$REPO" | tee -a "$LOG" >&2
  echo "DAILY-BOARD: DEGRADED (工作区不存在)"; exit 2
fi
cd "$REPO" || { echo "$stamp degraded: 无法进入 $REPO" | tee -a "$LOG" >&2; echo "DAILY-BOARD: DEGRADED"; exit 2; }

red=0; body=""
sec() { body="$body
## $1
"; }
line() { body="$body- $1
"; }

# 1) DSH 断面
if a=$("$PYBIN" scripts/control-tower/check-dsh-anchor.py --repo . 2>&1); then line "✅ DSH 断面: $(echo "$a"|tail -1)"
else rc=$?; line "❌ DSH 断面: $(echo "$a"|tail -1) (rc=$rc)"; red=1; fi
# 2) 卡状态
tot=$(ls task-state/D*.json 2>/dev/null | wc -l | tr -d ' ')
line "卡总数: ${tot:-0}（在制按 task-state+worktree 判定）"
# 3) 工作树（在制槽位）
wt=$(git worktree list 2>/dev/null | wc -l | tr -d ' ')
line "工作树数: ${wt:-0}"
# 4) 门禁健康（本地软提示级）
if bash scripts/pre-commit-check.sh >/tmp/daily-pc.log 2>&1; then line "✅ 本地门禁: 全组通过"
else line "⚠️ 本地门禁: 有非通过项（详见 .codex/control-tower/logs）"; fi
# 6) 台账 P0 与队列对账（D943：**登记 ≠ 执行** —— gen-cto-health 的 P0 挂了 10 天无人开卡）
LEDGER="$REPO/docs/synova/coordination/审计发现台账-DSH-CTO.md"
if [ -f "$LEDGER" ]; then
  aged=$("$PYBIN" - "$LEDGER" "$REPO" <<'PYEOF'
import datetime, os, re, sys
p, repo = sys.argv[1], sys.argv[2]
today = datetime.date.today()
miss = []
for ln in open(p, encoding="utf-8", errors="replace"):
    m = re.match(r"\|\s*(\d{4}-\d{2}-\d{2})\s*\|", ln)
    if not m or "P0" not in ln: continue
    try: d = datetime.date.fromisoformat(m.group(1))
    except Exception: continue
    if (today - d).days < 7: continue
    ids = set(re.findall(r"\bD(\d{3})\b", ln))
    if not ids: continue
    if not any(os.path.exists(os.path.join(repo, "task-state", "D%s.json" % i)) for i in ids):
        miss.append("%s 的 P0 条目（D%s）无对应卡" % (m.group(1), ",".join(sorted(ids))))
for x in miss[:5]: print(x)
PYEOF
)
  if [ -n "$aged" ]; then
    line "❌ 台账 P0 未进队列（登记≠执行）: $(echo "$aged" | head -1)"
    red=1
  else
    line "✅ 台账 P0 与队列对账: 无超期未开卡"
  fi
fi

# 5) 漂移/孤儿
orph=$(find . -maxdepth 1 -type d -name ".synova-wt-*" 2>/dev/null | wc -l | tr -d ' ')
line "孤儿工作树候选: ${orph:-0}"

# 7) 文档:代码 比（D964 文档减负——旁路指标，**不参与红项判定**）
#    口径（写死，防假绿，复核命令与本行一致）:
#      文档 = git ls-files '*.md' 排除 .sessions/**（会话产物）
#      代码 = git ls-files 'src/*.ts' 'packages/*.ts'（产品码，含 src/ 与 packages/ 下全部 .ts 含测试）
#      .synova-wt-* 为未跟踪工作树 → 天然不在 git ls-files 结果内（无需额外排除）
#    基准: DSH 0.68（3936 md / 5774 源文件）；本仓治理目标 = 停止恶化并逐批下降
DOC_N=$(git ls-files '*.md' 2>/dev/null | grep -v '^\.sessions/' | wc -l | tr -d ' ')
CODE_N=$(git ls-files 'src/*.ts' 'packages/*.ts' 2>/dev/null | wc -l | tr -d ' ')
if [ "${CODE_N:-0}" -gt 0 ]; then
  RATIO=$("$PYBIN" -c "print(f'{${DOC_N}/${CODE_N}:.2f}')" 2>/dev/null || echo "n/a")
  line "📄 文档:代码 比 = ${RATIO}（${DOC_N:-0} md ÷ ${CODE_N:-0} ts；口径: *.md 排除 .sessions/** ÷ src/+packages/ .ts）"
else
  line "📄 文档:代码 比 = n/a（代码计数为 0，degraded）"
fi

{
  echo "# CTO 自动看板（每日）"; echo; echo "> 生成: $stamp ｜ 触发: DSH 官方 schedule ｜ 失败即告警，不静默"; echo
  echo "**结论: $([ $red = 0 ] && echo 无红项 || echo 有红项)**"; echo "$body"
} > "$OUT"

if [ $red = 0 ]; then echo "$stamp OK" >> "$LOG"; echo "DAILY-BOARD: OK → $OUT"; exit 0
else echo "$stamp RED" >> "$LOG"; echo "DAILY-BOARD: RED → ${OUT}（已告警）" >&2; exit 1; fi
