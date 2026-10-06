#!/usr/bin/env bash
# D948 — CTO 每日自动看板（官方 schedule 触发；吸收 D796 每日体检静默失败的教训）
# 三态：0=OK 1=有红项(已告警) 2=degraded(环境不可用, fail-closed，绝不静默通过)
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

# D520/V5 平台敏感命令规避：Windows 可能无 python3.exe（仅 python / py -3）
PYBIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || echo python3)"  # swallow-ok: 三级探测逐个降级，全缺失时由调用点失败留痕
# D1008-FIX（2026-09-25 事故根因）: 默认 REPO **禁止硬编码任何工作区绝对路径**。
#   旧默认 `/Users/wane/SynovaAgent` 的后果：在**任何 worktree** 里直接跑本脚本，都会
#   cd 进主工作区并写它的 `.codex/control-tower/logs/daily-board.log` 与
#   `docs/synova/coordination/CTO-看板-自动.md`（多写者写同一被跟踪文件）。
#   新默认 = 「**脚本自身所属仓库根**」——锚定脚本所在目录（而非 cwd），
#   `git rev-parse --show-toplevel` 在 worktree 内返回该 worktree 根 ⇒ 就地写、不越界。
#   schedule 路径不变：主工作区里跑本脚本，脚本目录 → toplevel 仍解析为主工作区。
#   SYNO_REPO 覆盖缝保留（测试/CI 注入）；非 git 环境回落 pwd，由下方 .git 自检 fail-closed。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || SCRIPT_DIR="$(pwd)"
REPO="${SYNO_REPO:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)}"  # swallow-ok: 非 git 环境回落 pwd，随后 .git 自检 fail-closed
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

# 0) 对账探针（D1008 接入点：探针以独立文件落 scripts/control-tower/probes/*-probe.sh）
#    契约（ctrl-tower 模式 1 三态）: 0=一致 / 1=DRIFT(不一致) / 2=无法测量(degraded, fail-closed)
#    任一非 0 或输出含 DRIFT → 显式报警（含探针名 + 退出码），**绝不静默跳过**；无探针也显式登记。
sec "0) 对账探针"
PROBE_REL="scripts/control-tower/probes"
PROBE_DIR="$REPO/$PROBE_REL"
probe_n=0
for p in "$PROBE_DIR"/*-probe.sh; do
  [ -e "$p" ] || continue
  probe_n=$((probe_n + 1))
  pname="$(basename "$p")"
  pout="$(bash "$p" 2>&1)"; prc=$?
  if [ "$prc" -eq 0 ] && ! printf '%s\n' "$pout" | grep -q 'DRIFT'; then
    line "✅ 对账探针 ${pname}: 一致 (rc=0)"
  else
    pd="$(printf '%s\n' "$pout" | grep -m1 -v '^$' || true)"
    line "❌ 对账探针 ${pname}: rc=${prc}${pd:+ ｜ 首行: ${pd}}"
    red=1
  fi
done
if [ "$probe_n" -eq 0 ]; then
  line "⚠️ 对账探针: 无探针（${PROBE_REL}/*-probe.sh 零匹配）—— 显式登记，非静默跳过"
fi

# 1) DSH 断面
if a=$("$PYBIN" scripts/control-tower/check-dsh-anchor.py --repo . 2>&1); then line "✅ DSH 断面: $(echo "$a"|tail -1)"
else rc=$?; line "❌ DSH 断面: $(echo "$a"|tail -1) (rc=$rc)"; red=1; fi
# 2) 卡状态
tot=$(ls task-state/D*.json 2>/dev/null | wc -l | tr -d ' ')  # swallow-ok: 无卡目录/无文件时 ls 报错属正常空集，计数回落 0
line "卡总数: ${tot:-0}（在制按 task-state+worktree 判定）"
# 3) 工作树（在制槽位）
wt=$(git worktree list 2>/dev/null | wc -l | tr -d ' ')  # swallow-ok: 非 git 目录时 git 报错，计数回落 ${wt:-0} 显式降级
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
orph=$(find . -maxdepth 1 -type d -name ".synova-wt-*" 2>/dev/null | wc -l | tr -d ' ')  # swallow-ok: 目录不可读时 find 告警，计数回落 ${orph:-0}
line "孤儿工作树候选: ${orph:-0}"

# 7) 文档:代码 比（D964 文档减负——旁路指标，**不参与红项判定**）
#    口径（写死，防假绿，复核命令与本行一致）:
#      文档 = git ls-files '*.md' 排除 .sessions/**（会话产物）
#      代码 = git ls-files 'src/*.ts' 'packages/*.ts'（产品码，含 src/ 与 packages/ 下全部 .ts 含测试）
#      .synova-wt-* 为未跟踪工作树 → 天然不在 git ls-files 结果内（无需额外排除）
#    基准: DSH 0.68（3936 md / 5774 源文件）；本仓治理目标 = 停止恶化并逐批下降
DOC_N=$(git ls-files '*.md' 2>/dev/null | grep -v '^\.sessions/' | wc -l | tr -d ' ')  # swallow-ok: 非 git 目录时 ls-files 报错，计数回落 ${DOC_N:-0}
CODE_N=$(git ls-files 'src/*.ts' 'packages/*.ts' 2>/dev/null | wc -l | tr -d ' ')  # swallow-ok: 同上，回落 ${CODE_N:-0} 并由下一行判 0 → n/a
if [ "${CODE_N:-0}" -gt 0 ]; then
  RATIO=$("$PYBIN" -c "print(f'{${DOC_N}/${CODE_N}:.2f}')" 2>/dev/null || echo "n/a")  # swallow-ok: python 缺失/表达式失败 → 显式 n/a 降级值，不静默
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
