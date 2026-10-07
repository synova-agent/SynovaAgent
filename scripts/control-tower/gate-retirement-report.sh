#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gate-retirement-report.sh — D1201（v2.0 方案五）: 门禁退役候选 + 净增预算台账
#
# 背景（父卡 #1221，创始人 2026-10-07 批准）:
#   治理:产品比 1:4.9 的根源 = 「每出一次事故就永久加一道闸」，从无退出机制。
#   本脚本产**季度复审**所需的三样数据（只产数不判据——退留由创始人裁）:
#     ① 90 天零命中清单（.claude/gate-hits.log 逐 gate 聚合）⇒ 退役候选
#     ② 现存检查点总数（扫 scripts/pre-commit-check.sh 的 hard_check/soft_check/v5_soft 调用）
#     ③ 季度净增预算状态（现存 vs 90 天前同文件版本，git show 取历史）——净增 > 预算限额 ⇒ 提示
#
# 契约（铁律 47）:
#   @input  — argv: [--days N]（默认 90）; [--budget N]（季度净增上限，默认 3）
#             env: SYNO_GATE_HITS_LOG（默认 $ROOT/.claude/gate-hits.log）
#                  SYNO_PRECOMMIT（默认 $ROOT/scripts/pre-commit-check.sh）
#   @output — stdout: Markdown 三段（零命中候选 / 现存清单 / 净增预算），
#             零命中项逐条列名 + 命中数 0 证据
#   @exit   — 0 = 报告产出成功（不论是否超预算；本工具**只产数不裁决**）
#             1 = 预留（--enforce 时：净增超预算 ⇒ 1）——默认关闭，治理线季度复审后再定是否启用
#             2 = 检查自身失败（日志不可读但存在 / 基线文件不可读 / python 不可用）——fail-closed
#   @degraded — 日志不存在 ⇒ 输出空表 + 明确标注「无数据」（无数据≠零命中，不据此退役任何检查）
#
# 用法:
#   bash scripts/control-tower/gate-retirement-report.sh                # 90 天报告
#   bash scripts/control-tower/gate-retirement-report.sh --days 30 --budget 3
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DAYS=90
BUDGET=3
ENFORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --days)   DAYS="${2:-90}"; shift 2 ;;
    --budget) BUDGET="${2:-3}"; shift 2 ;;
    --enforce) ENFORCE=1; shift ;;
    *) echo "❌ gate-retirement-report: 未知参数 ${1}（exit 2）" >&2; exit 2 ;;
  esac
done

LOG="${SYNO_GATE_HITS_LOG:-$ROOT/.claude/gate-hits.log}"
PC="${SYNO_PRECOMMIT:-$ROOT/scripts/pre-commit-check.sh}"

# PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -z "$PYBIN" ] && { echo "❌ 检查执行失败: python 不可用（exit 2，fail-closed）" >&2; exit 2; }
[ -r "$PC" ] || { echo "❌ 检查执行失败: pre-commit 脚本不可读: ${PC}（exit 2）" >&2; exit 2; }

"$PYBIN" - "$LOG" "$PC" "$DAYS" "$BUDGET" "$ROOT" "$ENFORCE" <<'PYEOF'
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone

log_path, pc_path, days, budget, root, enforce = (
    sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], sys.argv[6] == "1")

# ── ① 现存检查点（扫调用名）──
pat = re.compile(r'^\s*(?:QUIET_SUCCESS=\d+\s+)?(?:hard_check|soft_check|v5_soft|decl_check)\s+"([^"]+)"')
current = []
for line in open(pc_path, encoding="utf-8"):
    m = pat.match(line)
    if m:
        name = m.group(1)
        # 过滤模板/动态名（含 $ 占位符者非稳定检查点名，如 "$1" / "…exit=$RC"）
        if "$" in name:
            continue
        current.append(name)
current_set = sorted(set(current))

# ── ② 90 天命中聚合 ──
hits = {}
no_data = True
try:
    with open(log_path, encoding="utf-8") as f:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = rec.get("time", "")
            try:
                t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
            except (ValueError, AttributeError):
                continue
            if t < cutoff:
                continue
            no_data = False
            g = rec.get("gate", "?")
            hits[g] = hits.get(g, 0) + 1
except FileNotFoundError:
    pass

print(f"# 门禁退役复审报告（窗口 {days} 天）")
print()
print(f"数据源: `{log_path}`" + ("　⚠️ **无数据**（日志不存在）" if no_data else ""))
print()

# ── ③ 零命中候选 ──
zero = [g for g in current_set if hits.get(g, 0) == 0]
print(f"## ① 零命中候选（现存 {len(current_set)} 项中 {len(zero)} 项）")
print()
if no_data:
    print("> ⚠️ 无命中数据 ⇒ **不得**据此退役任何检查（无数据 ≠ 零命中）。")
print()
for g in zero[:40]:
    print(f"- `{g}` — {days} 天命中 0")
if len(zero) > 40:
    print(f"- … 其余 {len(zero) - 40} 项省略")
print()
print("（退留由创始人裁；本工具只产数。）")
print()

# ── ④ 净增预算（对比历史版本）──
def count_checks(rev):
    try:
        txt = subprocess.run(["git", "-C", root, "show", rev], capture_output=True,
                             text=True, timeout=30).stdout
    except Exception:
        return None
    if not txt.strip():
        return None  # 空输出 = 该时点不可得（≠ 0 项），避免把"无基线"误报成"净增 +31"
    found = {m.group(1) for m in (pat.match(l) for l in txt.splitlines()) if m}
    found = {n for n in found if "$" not in n}
    return len(found) if found else None


now_n = len(current_set)
past = count_checks(f"HEAD@{days}.days.ago") if days else None
print("## ② 净增预算状态")
print()
print(f"- 现存检查点: **{now_n}**")
if past is None:
    print(f"- {days} 天前基线: 不可得（reflog 无该时点）⇒ 净增不可算，标记为「未判定」")
    net = None
else:
    net = now_n - past
    print(f"- {days} 天前基线: {past} ⇒ 净增 **{net:+d}**（季度预算上限 {budget}）")
print()
if net is not None and net > budget:
    print(f"⚠️ 净增 {net} > 预算 {budget} —— 按 v2.0 方案五: 新增须等额退役（创始人裁定退役对象）")
else:
    print("✅ 净增在预算内（或未判定）")
sys.exit(0)
PYEOF
py_rc=$?
[ "$py_rc" -ne 0 ] && { echo "❌ 检查执行失败: 报告生成异常 rc=${py_rc}（exit 2）" >&2; exit 2; }

# --enforce（默认关闭）：净增超预算 ⇒ exit 1。报告里已打印判定，此处仅按需转退出码。
if [ "$ENFORCE" -eq 1 ]; then
  if bash "$0" --days "$DAYS" --budget "$BUDGET" 2>/dev/null | grep -q "⚠️ 净增"; then
    echo "❌ enforce: 净增超预算（exit 1）"
    exit 1
  fi
fi
exit 0
