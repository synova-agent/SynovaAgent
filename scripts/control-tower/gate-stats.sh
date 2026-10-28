#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# gate-stats.sh — D515 项4: 门禁命中统计汇总（月度清理数据地基）｜D1094 W2 扩：耗时＋未运行
#
# 背景（#1094 / 创始人规格 v2.0 §3 W2、§5 M-8）: 原日志只有 {time,gate,result,branch}，
#   读者**无法区分「没跑」与「跑了但 0 命中」** —— 空日志曾被读成「零命中候选」，
#   会把没运行的检查误判成可退役。本版：
#     ① 表内新增「中位耗时(ms)」「命中」（hits 字段；旧 4 字段行按 result 回退 1/0）；
#     ② **未运行**（窗口内 0 条记录，含日志不存在/为空）与**零命中**（已运行但 0 命中）分列；
#     ③ 无数据 ⇒ 只报「未运行」＋明确不产出退役候选（M-8 判据）。
#
# 契约 (铁律 47):
#   @input  — argv: [天数，默认 30]
#             env: SYNO_GATE_HITS_LOG（默认 $ROOT/.claude/gate-hits.log）
#                  SYNO_PRECOMMIT（默认 $ROOT/scripts/pre-commit-check.sh；用于取"声明检查点"全集）
#             JSONL 行: {"time","gate","result","branch"[,"duration_ms","hits"]}
#             —— 由 scripts/control-tower/gate-telemetry.sh 单点写入（pre-commit 的 log_gate 消费）
#   @output — stdout: Markdown 表（每检查点: 触发/命中/通过/中位耗时/误报代理）
#             ＋「零命中候选（已运行）」段 ＋「未运行」段（逐条点名）
#   @exit   — 0 = 报告产出成功（**无数据也算成功**：无数据不是错误）
#             2 = 检查自身失败（python 不可用 —— fail-closed，禁把"看不见"当"没问题"）
#   @degraded — 日志不存在/为空 ⇒ 状态 **未运行** + 「无数据 ≠ 零命中、不得据此退役」；
#             损坏 JSON 行 ⇒ 跳过并计数（表尾注明，不中断汇总）。
#   口径 —— 中位耗时 = 该检查点每次触发的 duration_ms 中位数；duration_ms 由写入方测得
#             （pre-commit 口径 = 距上一检查点间隔，含该检查的计算时间；0=未测得，不计入中位）。
#             触发器（warn/degraded）计入「触发」，不计「命中/通过」。
#   误报代理指标: 同 branch 上某 gate 命中(hit)后 5 分钟内直接通过(miss)
#             —— 大概率是"重跑就过"的误报或零成本绕过，进删除候选清单（spec §1 项4）。
# 用法: bash scripts/control-tower/gate-stats.sh [天数，默认 30]
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"  # swallow-ok: 非 git 目录回退 pwd（测试以 SYNO_GATE_HITS_LOG/SYNO_PRECOMMIT 注入时不依赖仓库）
LOG="${SYNO_GATE_HITS_LOG:-$ROOT/.claude/gate-hits.log}"
PC="${SYNO_PRECOMMIT:-$ROOT/scripts/pre-commit-check.sh}"
DAYS="${1:-30}"

# D520/PLATFORM-CHECKLIST #1: 禁裸 python3（探存在性；缺失 ⇒ 显式 degraded exit 2）
PYBIN="$(command -v python3 2>/dev/null)"  # swallow-ok: python3 缺失由下方分支显式降级 exit 2（禁裸 python3，D520）
if [ -z "$PYBIN" ]; then
  echo "degraded: python3 不可用 —— 统计无法计算（exit 2，fail-closed）" >&2
  echo "结果: 0 通过, 1 失败"
  exit 2
fi

"$PYBIN" - "$LOG" "$DAYS" "$PC" <<'PYEOF'
import json
import re
import statistics
import sys
from datetime import datetime, timedelta, timezone

log_path, days, pc_path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
cutoff = datetime.now(timezone.utc) - timedelta(days=days)


def _int_or_none(value):
    """JSON 数字字段 → int；bool/字符串/缺失一律 None（旧 4 字段行没有这两个字段）。"""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


rows = []      # (t, gate, result, branch, duration_ms|None, hits|None)
bad = 0        # 损坏 JSON 行数
log_absent = True
try:
    with open(log_path, encoding="utf-8") as fh:
        log_absent = False
        for raw in fh:
            line = raw.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                t = datetime.fromisoformat(str(rec["time"]).replace("Z", "+00:00"))
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
                rows.append((
                    t,
                    str(rec.get("gate", "?")),
                    str(rec.get("result", "?")),
                    str(rec.get("branch", "?")),
                    _int_or_none(rec.get("duration_ms")),
                    _int_or_none(rec.get("hits")),
                ))
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                bad += 1
except OSError:
    rows = []
    log_absent = True

# 窗口过滤（窗口外数据不参与任何判定）
rows = [r for r in rows if r[0] >= cutoff]

# ── 声明检查点全集（pre-commit 的 hard_check/soft_check/v5_soft/decl_check/log_gate 调用名）──
# 用于区分「未运行」（无任何记录）与「零命中」（跑过且 0 命中）。取不到 ⇒ 空集（不编造）。
DECL_RE = re.compile(r'^\s*(?:QUIET_SUCCESS=\d+\s+)?(?:hard_check|soft_check|v5_soft|decl_check)\s+"([^"]+)"')
LOG_GATE_RE = re.compile(r'^\s*log_gate\s+"([^"]+)"')
declared = set()
try:
    with open(pc_path, encoding="utf-8") as fh:
        for line in fh:
            m = DECL_RE.match(line) or LOG_GATE_RE.match(line)
            if not m:
                continue
            name = m.group(1)
            if "$" in name or "…" in name:   # 动态/模板名不是稳定检查点名（对齐 gate-retirement-report 口径）
                continue
            declared.add(name)
except OSError:
    declared = set()

# ── 误报代理: 同 branch+gate 的 hit 之后 5 分钟内出现 miss ──
ordered = sorted(rows, key=lambda r: r[0])
last_hit = {}
suspects = {}
for t, g, r, b, _dur, _hits in ordered:
    key = (g, b)
    if r == "hit":
        last_hit[key] = t
    elif r == "miss" and key in last_hit:
        if (t - last_hit[key]).total_seconds() <= 300:
            suspects[g] = suspects.get(g, 0) + 1
        del last_hit[key]

# ── 逐 gate 聚合 ──
stats = {}
for _t, g, r, _b, dur, hits in rows:
    s = stats.setdefault(g, {"trig": 0, "hit": 0, "miss": 0, "other": 0, "hits": 0, "durs": []})
    s["trig"] += 1
    if r == "hit":
        s["hit"] += 1
    elif r == "miss":
        s["miss"] += 1
    else:
        s["other"] += 1          # warn/degraded: 计触发，不计命中/通过
    s["hits"] += hits if hits is not None else (1 if r == "hit" else 0)
    if dur is not None and dur > 0:
        s["durs"].append(dur)


def median_text(durs):
    if not durs:
        return "-"
    m = statistics.median(durs)
    return str(int(m)) if float(m).is_integer() else ("%.1f" % m)


print(f"# 门禁命中统计（近 {days} 天，{len(rows)} 次触发）")
print("")
print(f"数据源: `{log_path}`")
print("")

if not rows:
    # ═══ M-8 核心：无数据 ⇒ 只有「未运行」，**不产出**零命中/退役候选 ═══
    why = "日志不存在" if log_absent else "窗口内 0 条记录"
    print(f"状态: **未运行**（{why}）")
    print("")
    print("## 未运行（窗口内无任何记录；**无数据 ≠ 零命中**，不得据此退役任何检查）")
    print("")
    if declared:
        for g in sorted(declared):
            print(f"- `{g}` — 未运行（0 条记录）")
        print("")
        print(f"小计: {len(declared)} 个声明检查点全部未运行。")
    else:
        print("- （未能从 pre-commit 解析出声明检查点；请检查 SYNO_PRECOMMIT 路径）")
    print("")
    print("> 本窗口内没有可判定的命中数据 ⇒ **不产出候选清单、不产出退役建议**。")
    print("> 先让检查跑起来（有一次真实提交）再回来判退役（M-8）。")
    if bad:
        print("")
        print(f"⚠ {bad} 行损坏 JSON 已跳过")
    sys.exit(0)

print("| 检查点 | 触发 | 命中 | 通过 | 中位耗时(ms) | 误报代理(5min内hit→miss) |")
print("|---|---|---|---|---|---|")
for g in sorted(stats, key=lambda k: (-stats[k]["trig"], k)):
    s = stats[g]
    print(f"| {g} | {s['trig']} | {s['hits']} | {s['miss']} | {median_text(s['durs'])} | {suspects.get(g, 0)} |")
print("")
print("> 口径：触发=全部记录（含 warn/degraded）｜命中=Σhits（旧 4 字段行按 hit=1/miss=0 回退）"
      "｜通过=miss 数｜中位耗时=该检查点 duration_ms 中位数（0=未测得，不计入；`-`=无样本）。")
if bad:
    print(f"⚠ {bad} 行损坏 JSON 已跳过")
print("")

# ── 零命中（**已运行**但窗口内 0 命中）与未运行（无记录）分列 ──
zero = sorted(g for g in stats if stats[g]["hit"] == 0 and stats[g]["other"] == 0)
if zero:
    print(f"💡 零命中候选（**已运行**·窗口内命中 0）: {', '.join(zero)}")
else:
    print("✅ 零命中候选: 无（窗口内每个已运行检查点均有命中）")
not_run = sorted(g for g in declared if g not in stats)
if not_run:
    print("")
    print("## 未运行（窗口内无记录 · **不得**判为「零命中」· **不得**据此退役）")
    print("")
    for g in not_run[:40]:
        print(f"- `{g}` — 未运行")
    if len(not_run) > 40:
        print(f"- … 其余 {len(not_run) - 40} 项省略")
    print("")
    print(f"小计: {len(not_run)} 个声明检查点未运行（≠ 零命中：它们没有跑过，不能作为退役证据）。")
sys.exit(0)
PYEOF
py_rc=$?
if [ "$py_rc" -ne 0 ]; then
  echo "degraded: gate-stats 报告生成异常 rc=${py_rc}（exit 2，fail-closed）" >&2
  exit 2
fi
exit 0
