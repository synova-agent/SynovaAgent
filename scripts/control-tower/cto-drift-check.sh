#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# cto-drift-check.sh — CTO 跑偏自查（**机器判，不靠自律**）
#
# 契约（铁律 47 — 契约优先）:
#   @input  — 无参；`--json` 结构化输出；`--ledger <path>` 覆盖台账路径（测试用）
#   @output — 6 条不变量的逐条结论 + 违规清单
#   @exit   — 0 = 无违规 / 1 = 有违规 / 2 = degraded（判据源读不到，**fail-closed**）
#   @degraded — 台账/台账模板不可读 → exit 2 + stderr；**不把"读不到"当其通过**
#
# 为什么要有它（创始人 2026-10-01 原话）:
#   「你的上下文，你不跑偏是唯一最重要的事情。一旦你跑偏我们就完了。」
#   ⇒ **"我小心"不是机制**。本脚本把"跑偏"变成**可机器判的不变量**，
#     且设计上**不依赖我自评**（判据是"台账里有没有那一行"这种机械事实）。
#
# 六条不变量（每条都是"跑偏"的一个可观测投影）:
#   I1 台账存在且 ≤60 行            —— 治"台账膨胀"（前任 98→136→154 的病根）
#   I2 台账含四个必需段（①本窗锚②待裁③裁决④冷启动）
#   I3 ①本窗锚 三线齐全（基座/治理/产品）—— 缺锚 = 该线该窗无授权（C′1 同判据）
#   I4 ②待裁 每条有到期日 —— 无到期日 = 事实上的无限期挂起
#   I5 ④冷启动 最后重建 ≤14 天 —— 超期 = 我已在用"过期记忆"工作
#   I6 我最近 N 天 commit 里**零** `scripts/audit/**` 改名/改动 —— 红线机械核
#
# 独立第一性: 本脚本**只读**，不改任何东西；判定用 grep/行数/日期，**无一处需要我判断**。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LEDGER_DEFAULT="$ROOT/docs/synova/coordination/CTO-状态台账.md"
LEDGER=""
JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --ledger) LEDGER="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$LEDGER" ] || LEDGER="$LEDGER_DEFAULT"

FAIL=0; V=()

# ── degraded：判据源不可读 ⇒ fail-closed（不静默） ─────────────────────────────
if [ ! -f "$LEDGER" ]; then
  echo "degraded: 台账不可读: $LEDGER （fail-closed：不把'读不到'当其通过）" >&2
  exit 2
fi

LINES=$(grep -c . "$LEDGER" 2>/dev/null | tr -d '\n\r'); LINES=${LINES:-0}

# ── I1 台账存在且 ≤60 行 ───────────────────────────────────────────────────────
if [ "${LINES:-0}" -le 60 ]; then
  echo "  ✅ I1 台账 ${LINES} 行（≤60）"
else
  echo "  ❌ I1 台账 ${LINES} 行 > 60 —— 必须删到 60 以内才准提交新版"
  V+=("I1:台账膨胀(${LINES}行)"); FAIL=1
fi

# ── I2 四个必需段 ─────────────────────────────────────────────────────────────
for sec in "① 本窗锚" "② 待裁" "③ 裁决记录" "④ 冷启动留痕"; do
  if grep -qF "$sec" "$LEDGER"; then
    echo "  ✅ I2 含段：$sec"
  else
    echo "  ❌ I2 缺段：$sec"
    V+=("I2:缺段$sec"); FAIL=1
  fi
done

# ── I3 本窗锚 三线齐全 ────────────────────────────────────────────────────────
MISS=""
for line in 基座线 治理线 产品线; do
  if ! awk '/^## ① 本窗锚/,/^## ②/' "$LEDGER" | grep -q "$line"; then MISS="$MISS$line "; fi
done
if [ -z "$MISS" ]; then
  echo "  ✅ I3 本窗锚三线齐全"
else
  echo "  ❌ I3 本窗锚缺线：$MISS（缺锚=该线该窗无授权，C′1 同判据）"
  V+=("I3:缺锚$MISS"); FAIL=1
fi

# ── I4 待裁每条有到期日 ───────────────────────────────────────────────────────
# 判据：'## ② 待裁' 段内的表格数据行（以 | 开头且非表头/分隔），末列须匹配 日期或"随时|不急"
BAD4=$(awk '/^## ② 待裁/,/^## ③/' "$LEDGER" \
  | grep -E '^\| *[0-9]+ *\|' \
  | grep -vE '\|[^|]*(20[0-9]{2}-[0-9]{2}-[0-9]{2}|随时|不急|待定)[^|]*\| *$' || true)
if [ -z "$BAD4" ]; then
  echo "  ✅ I4 待裁均有到期口径"
else
  echo "  ❌ I4 待裁缺到期口径："
  echo "$BAD4" | sed 's/^/      /'
  V+=("I4:待裁缺到期"); FAIL=1
fi

# ── I5 冷启动最后重建 ≤14 天 ──────────────────────────────────────────────────
# 判据源收紧：只认台账头部「最后重建」那一行（原先整段取 ⇒ 抓到 POINTER 里文件名日期，属误判）
LAST=$(grep -E '^\| *最后重建 *\|' "$LEDGER" | grep -oE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' | head -1)
[ -n "$LAST" ] || LAST=$(awk '/^## ④ 冷启动留痕/,0' "$LEDGER" | grep -oE '^\| *20[0-9]{2}-[0-9]{2}-[0-9]{2}' | tail -1 | grep -oE '20[0-9]{2}-[0-9]{2}-[0-9]{2}')
if [ -z "$LAST" ]; then
  echo "  ❌ I5 冷启动段无日期"
  V+=("I5:无重建日期"); FAIL=1
else
  if command -v python3 >/dev/null 2>&1; then
    AGE=$(python3 -c "
import datetime,sys
d=datetime.date.fromisoformat('$LAST'); print((datetime.date.today()-d).days)" 2>/dev/null || echo 999)
  else
    AGE=999
  fi
  if [ "$AGE" -le 14 ]; then
    echo "  ✅ I5 最后重建 ${LAST}（${AGE} 天前 ≤14）"
  else
    echo "  ❌ I5 最后重建 ${LAST}（${AGE} 天前 >14）—— 已在用过期记忆工作"
    V+=("I5:冷启动超期${AGE}天"); FAIL=1
  fi
fi

# ── I6 红线机械核：近 N 天我的 commit 不得触 scripts/audit/** ────────────────
DAYS="${CTO_DRIFT_DAYS:-7}"
AUDIT_TOUCH=$(git -C "$ROOT" log --since="${DAYS} days ago" --name-only --pretty=format: 2>/dev/null \
  | grep -cE '^scripts/audit/' | tr -d '\n\r' )
AUDIT_TOUCH=${AUDIT_TOUCH:-0}
if [ "${AUDIT_TOUCH:-0}" -eq 0 ]; then
  echo "  ✅ I6 近 ${DAYS} 天零 scripts/audit/** 改动（红线 R-4）"
else
  echo "  ❌ I6 近 ${DAYS} 天触碰 scripts/audit/** ${AUDIT_TOUCH} 次（红线 R-4）"
  V+=("I6:touch-audit(${AUDIT_TOUCH})"); FAIL=1
fi

# ── 汇总 ──────────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────"
if [ "$JSON" -eq 1 ]; then
  printf '{"ledger":"%s","lines":%s,"fail":%s,"violations":[%s]}\n' \
    "$LEDGER" "${LINES:-0}" "$FAIL" "$(printf '"%s",' "${V[@]:-}" | sed 's/,$//')"
fi
if [ "$FAIL" -eq 0 ]; then echo "结论: ✅ 无跑偏迹象（6 条不变量全过）"; else echo "结论: ❌ 有跑偏迹象（见上）"; fi
exit "$FAIL"
