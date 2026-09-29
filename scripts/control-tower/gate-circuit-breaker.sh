#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gate-circuit-breaker.sh — D1061 任务 3: 门禁熔断 + 元监控
#
# 为什么存在:
#   门禁自身故障（夹具假绿、平台差异、间歇红）会把**所有 PR 连带拖红**，
#   而红的原因不在 PR 的改动里 ⇒ 作者只能反复重试或绕过门禁。
#   本脚本给出一条**显式、可审计**的熔断通道:
#     已知故障 → 登记（带 owner + expires + evidence）→ 熔断跳过（跳过必留痕）
#     expires 到期 → 自动失效，必须照跑且告警（棘轮: 不许无声续期）
#
# 熔断口径（CTO 2026-09-29 裁定）: **连续 2 次同因失败**才告警。
#   依据: `baseline=FAIL` 实测是间歇（1/5，见 docs/synova/product-lines/evidence/D1061/
#   00-前提实测-原始输出.md P5）——单次命中不足以判"门禁坏了"，连续 2 次才告警，
#   避免把间歇噪声当故障，也避免把真故障淹没在噪声里。
#
# 到期棘轮模式来源: `scripts/control-tower/gate-integrity-baseline.txt` 的
#   `<路径>:<行号> | owner=<D#> | expires=YYYY-MM-DD | evidence=<引用>` 语义。
#   本脚本只把该模式搬到 JSON（门禁级而非模式级），**不新造范式**。
#
# 契约 (铁律 47):
#   @input  --should-skip <gate-id>   查询该门禁此刻该不该跑
#           --selfcheck                每日自检（登记表完整性 + 门禁健康 + 连续失败）
#           --report                   人读报告（登记表 + 连续失败 + 健康行）
#           --health-line              输出**一行**门禁健康状态（D963 工作台面板读）
#           --json                     附机器可读 JSON（与其它模式并用）
#           --registry <path>          覆盖登记表路径（默认 scripts/control-tower/gate-incident-registry.json）
#   @output --should-skip : 0 = 照跑（无登记 / 登记已过期）; 3 = 已知故障跳过
#           --health-line : 0 = OK|KNOWN-FAULT（无需人介入）; 1 = DEGRADED（需人介入）
#           --selfcheck   : 0 = 自检通过; 1 = 自检发现问题（登记过期/字段缺失/连续失败）
#           --report      : 0（只读报告，不判定）
#   @error  2 = **熔断器自身故障**（登记表损坏、python 不可用）——绝不与"通过"混同（三态退出码 D328）
#   @degraded 跳过时: 写 .codex/control-tower/logs/degraded-events.log（复用
#              control_tower_log.py，不另造日志）+ stderr 可见告警。
#              登记表缺失 → 视为空表（不是故障，无登记即照跑）；登记表**存在但损坏** → exit 2（fail-closed）。
#
# 健康行格式（**冻结**，键序固定，ASCII 前缀可检索）:
#   GATE-HEALTH: status=<OK|DEGRADED|KNOWN-FAULT> known=<n> expired=<n> sources=<n> checked_at=<ISO8601>
#   status 优先级: DEGRADED > KNOWN-FAULT > OK
#     DEGRADED    = 登记表损坏 ‖ 有 expired>0 ‖ 有门禁连续失败 ≥2 次
#     KNOWN-FAULT = 无上述问题，但存在生效中的登记（known>0）
#     OK          = 无登记、无过期、无连续失败
#   known   = expires >= 今天 的生效登记条数
#   expired = expires <  今天 的失效登记条数（该条不再熔断，且必须告警）
#   sources = 本次实际读到的独立数据源个数（登记表 / gate-hits 日志 / degraded 日志 ∈ 0..3）
#   checked_at = UTC ISO8601（秒精度）
#
# 用法（CTO 一行命令 → 见 README):
#   bash scripts/control-tower/gate-circuit-breaker.sh --should-skip <gate-id>
#   bash scripts/control-tower/gate-circuit-breaker.sh --health-line
#   bash scripts/control-tower/gate-circuit-breaker.sh --selfcheck
#   bash scripts/control-tower/gate-circuit-breaker.sh --report
#
# 测试注入缝（测试零真实目录、零网络）:
#   SYNO_GATE_INCIDENT_REGISTRY  覆盖登记表路径
#   SYNO_GATE_HITS_LOG           覆盖门禁命中日志（与 gate-stats.sh 同名单源）
#   SYNO_CT_DIR                  覆盖控制塔日志目录（与 control_tower_log.py 同名单源）
#   SYNO_GATE_DEGRADED_LOG       覆盖 degraded 日志路径（仅自检读取面用）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REGISTRY="${SYNO_GATE_INCIDENT_REGISTRY:-$ROOT/scripts/control-tower/gate-incident-registry.json}"
HITS_LOG="${SYNO_GATE_HITS_LOG:-$ROOT/.claude/gate-hits.log}"
CT_DIR="${SYNO_CT_DIR:-$ROOT/.codex/control-tower}"
DEGRADED_LOG="${SYNO_GATE_DEGRADED_LOG:-$CT_DIR/logs/degraded-events.log}"

MODE=""; GATE_ID=""; AS_JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --should-skip) MODE="should-skip"; GATE_ID="${2:-}"; shift 2 ;;
    --selfcheck)   MODE="selfcheck"; shift ;;
    --report)      MODE="report"; shift ;;
    --health-line) MODE="health-line"; shift ;;
    --json)        AS_JSON=1; shift ;;
    --registry)    REGISTRY="${2:-}"; shift 2 ;;
    -h|--help)     sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ 未知参数: $1（--help 看用法）" >&2; exit 2 ;;
  esac
done

if [ -z "$MODE" ]; then
  echo "❌ 必须给一个模式: --should-skip <gate-id> | --selfcheck | --report | --health-line" >&2
  exit 2
fi
if [ "$MODE" = "should-skip" ] && [ -z "$GATE_ID" ]; then
  echo "❌ --should-skip 需要 <gate-id>" >&2
  exit 2
fi

PYBIN=""
if command -v python3 >/dev/null 2>&1; then PYBIN="python3"
elif command -v python >/dev/null 2>&1; then PYBIN="python"
else
  echo "❌ 熔断器自身故障: 找不到 python3/python（无法解析登记表）→ exit 2（不与通过混同）" >&2
  exit 2
fi

# ── 写降级事件（复用 control_tower_log.py 单源；不可写不阻断业务，但必须有可见告警）──
_log_degraded() { # $1=reason
  local logger="$ROOT/scripts/control-tower/control_tower_log.py" rc=0
  if [ -f "$logger" ]; then
    "$PYBIN" "$logger" degraded --component "gate-circuit-breaker" --reason "$1" >/dev/null 2>&1 || rc=$?
  else
    rc=1
  fi
  if [ "$rc" -ne 0 ]; then
    echo "   ⚠️ 降级事件未能落盘（control_tower_log.py rc=${rc}）—— 本次跳过仅有 stderr 留痕" >&2
  fi
  return 0
}

# ── 核心计算：一次 python 调用产出 known/expired/entries/streak/sources/broken ──
#   输出: JSON 单行。任何解析失败 → 打印 {"broken":true,...} 而不是吞错。
COMPUTE=$("$PYBIN" - "$REGISTRY" "$HITS_LOG" "$DEGRADED_LOG" <<'PYEOF' 2>/dev/null
import json, os, sys
from datetime import date, datetime, timezone

registry, hits_log, degraded_log = sys.argv[1], sys.argv[2], sys.argv[3]
out = {"registry_path": registry, "broken": False, "broken_reason": "",
       "entries": [], "known": 0, "expired": 0, "sources": 0, "streaks": []}
today = date.today()

# 源①: 登记表（缺失 = 空表，不是故障；存在但损坏 = fail-closed）
if os.path.exists(registry):
    out["sources"] += 1
    try:
        with open(registry, encoding="utf-8") as fh:
            raw = json.load(fh)
        gates = raw.get("gates")
        if not isinstance(gates, list):
            out["broken"] = True
            out["broken_reason"] = "登记表 gates 字段不是数组（schema 损坏）"
        else:
            for g in gates:
                if not isinstance(g, dict):
                    out["broken"] = True
                    out["broken_reason"] = "登记表 gates 内出现非对象条目"
                    break
                gid = str(g.get("gate_id") or "").strip()
                exp = str(g.get("expires") or "").strip()
                owner = str(g.get("owner") or "").strip()
                evid = str(g.get("evidence") or "").strip()
                try:
                    d = date.fromisoformat(exp)
                    exp_ok = True
                except ValueError:
                    exp_ok = False
                    d = None
                rec = {"gate_id": gid, "owner": owner, "expires": exp, "evidence": evid,
                       "expires_parsable": exp_ok,
                       "active": bool(exp_ok and d >= today)}
                if not exp_ok:
                    out["broken"] = True
                    out["broken_reason"] = f"登记表条目 {gid!r} 的 expires 不是 YYYY-MM-DD: {exp!r}"
                if rec["active"]:
                    out["known"] += 1
                else:
                    out["expired"] += 1
                out["entries"].append(rec)
    except (OSError, json.JSONDecodeError) as exc:
        out["broken"] = True
        out["broken_reason"] = f"登记表不可解析: {exc}"

# 源②: gate-hits 日志（连续同因失败口径）——取每个 gate 的**尾部连续 hit 数**
trailing = {}
if os.path.exists(hits_log):
    out["sources"] += 1
    try:
        rows = []
        with open(hits_log, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                rows.append((str(d.get("time") or ""), str(d.get("gate") or "?"),
                             str(d.get("result") or "?")))
        rows.sort(key=lambda r: r[0])
        for _, gate, result in rows:
            if result == "hit":
                trailing[gate] = trailing.get(gate, 0) + 1
            else:
                trailing[gate] = 0
    except OSError:
        pass
out["streaks"] = sorted([{"gate_id": g, "consecutive_hits": n}
                         for g, n in trailing.items() if n > 0],
                        key=lambda r: (-r["consecutive_hits"], r["gate_id"]))

# 源③: degraded 日志
if os.path.exists(degraded_log):
    out["sources"] += 1

out["checked_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
print(json.dumps(out, ensure_ascii=False))
PYEOF
)
if [ -z "$COMPUTE" ]; then
  echo "❌ 熔断器自身故障: 健康计算未产出（python 解析失败）→ exit 2" >&2
  exit 2
fi

json_field() { printf '%s' "$COMPUTE" | "$PYBIN" -c "
import json,sys
d=json.load(sys.stdin)
print(d.get(sys.argv[1]))" "$1" 2>/dev/null || echo "ERR"; }

# ── status 判定（优先级 DEGRADED > KNOWN-FAULT > OK）──
#   连续失败阈值 = 2（CTO 裁定：单次是间歇，连续 2 次才告警）
STREAK_THRESHOLD=2
STATUS=$("$PYBIN" - "$COMPUTE" "$STREAK_THRESHOLD" <<'PYEOF' 2>/dev/null || echo "DEGRADED"
import json, sys
d = json.loads(sys.argv[1]); thr = int(sys.argv[2])
if d.get("broken") or d.get("expired", 0) > 0 or any(s["consecutive_hits"] >= thr for s in d.get("streaks", [])):
    print("DEGRADED")
elif d.get("known", 0) > 0:
    print("KNOWN-FAULT")
else:
    print("OK")
PYEOF
)
[ -z "$STATUS" ] && STATUS="DEGRADED"

print_health_line() {
  echo "GATE-HEALTH: status=$STATUS known=$(json_field known) expired=$(json_field expired) sources=$(json_field sources) checked_at=$(json_field checked_at)"
}

emit_json() {
  [ "$AS_JSON" -eq 1 ] || return 0
  printf '%s' "$COMPUTE" | "$PYBIN" -c "
import json,sys
d=json.load(sys.stdin); d['status']=sys.argv[1]
print(json.dumps(d, ensure_ascii=False))" "$STATUS" 2>/dev/null || true
}

# ═══ 模式 --should-skip ═══
if [ "$MODE" = "should-skip" ]; then
  BROKEN=$(json_field broken)
  if [ "$BROKEN" = "True" ]; then
    echo "❌ 熔断器自身故障: $(json_field broken_reason)" >&2
    echo "   → fail-closed: **不跳过**该门禁（登记表损坏时不给熔断通道）" >&2
    exit 2
  fi
  LINE=$("$PYBIN" - "$COMPUTE" "$GATE_ID" <<'PYEOF' 2>/dev/null
import json, sys
d = json.loads(sys.argv[1]); gid = sys.argv[2]
for e in d.get("entries", []):
    if e.get("gate_id") == gid:
        print("ACTIVE" if e.get("active") else "EXPIRED")
        break
else:
    print("ABSENT")
PYEOF
)
  [ -z "$LINE" ] && LINE="ABSENT"
  case "$LINE" in
    ACTIVE)
      echo -e "${YELLOW}⚠️  门禁熔断: $GATE_ID 命中生效中的故障登记 → 本次**跳过**${RESET}" >&2
      echo -e "${YELLOW}   依据: ${REGISTRY}（owner/expires/evidence 见 --report）；跳过必留痕${RESET}" >&2
      _log_degraded "gate-circuit-breaker: 跳过已知故障门禁 ${GATE_ID}（登记表 ${REGISTRY}）"
      emit_json
      exit 3
      ;;
    EXPIRED)
      echo -e "${RED}❌ 门禁熔断: $GATE_ID 的登记**已过期** → 不跳过，按棘轮必须照跑${RESET}" >&2
      echo -e "${RED}   处置: 修好该门禁后删除条目，或重修 expires 并补 evidence（不许无声续期）${RESET}" >&2
      emit_json
      exit 0
      ;;
    *)
      emit_json
      exit 0
      ;;
  esac
fi

# ═══ 模式 --health-line（格式冻结，D963 面板读）═══
if [ "$MODE" = "health-line" ]; then
  print_health_line
  emit_json
  [ "$STATUS" = "DEGRADED" ] && exit 1
  exit 0
fi

# ═══ 模式 --selfcheck / --report ═══
if [ "$MODE" = "selfcheck" ] || [ "$MODE" = "report" ]; then
  echo "── 门禁熔断 / 元监控（D1061 任务 3）──"
  echo "   登记表: $REGISTRY"
  echo "   命中日志: $HITS_LOG"
  echo "   连续失败告警阈值: ${STREAK_THRESHOLD} 次同因"
  echo ""
  echo "── 故障登记表（到期棘轮）──"
  "$PYBIN" - "$COMPUTE" <<'PYEOF' 2>/dev/null || echo "   （登记表不可读）"
import json, sys
d = json.loads(sys.argv[1])
entries = d.get("entries", [])
if not entries:
    print("   （空表 —— 当前无已知门禁故障登记）")
for e in entries:
    state = "生效" if e.get("active") else "**已过期（不熔断，须人处理）**"
    print(f"   · {e.get('gate_id')} | owner={e.get('owner') or '(缺失)'} | expires={e.get('expires')} | {state}")
    print(f"     evidence: {e.get('evidence') or '(缺失)'}")
PYEOF
  echo ""
  echo "── 连续同因失败（阈值 ${STREAK_THRESHOLD}）──"
  "$PYBIN" - "$COMPUTE" "$STREAK_THRESHOLD" <<'PYEOF' 2>/dev/null || echo "   （命中日志不可读）"
import json, sys
d = json.loads(sys.argv[1]); thr = int(sys.argv[2])
rows = d.get("streaks", [])
if not rows:
    print("   （无连续失败）")
for r in rows:
    flag = "❌ 告警" if r["consecutive_hits"] >= thr else "·"
    print(f"   {flag} {r['gate_id']}: 连续 {r['consecutive_hits']} 次")
PYEOF
  echo ""
  echo "── 健康状态 ──"
  print_health_line
  emit_json

  if [ "$MODE" = "selfcheck" ]; then
    SELF_RC=0
    BROKEN=$(json_field broken)
    EXPIRED=$(json_field expired)
    if [ "$BROKEN" = "True" ]; then
      echo -e "${RED}   ❌ 登记表损坏: $(json_field broken_reason)${RESET}" >&2
      SELF_RC=1
    fi
    # 字段完整性（owner / evidence 必填 —— 缺失即无责任人/无证据，棘轮形同虚设）
    MISSING=$("$PYBIN" - "$COMPUTE" <<'PYEOF' 2>/dev/null || echo "0"
import json, sys
d = json.loads(sys.argv[1])
bad = [e.get("gate_id") or "?" for e in d.get("entries", [])
       if not (e.get("owner") or "").strip() or not (e.get("evidence") or "").strip()]
print(len(bad))
PYEOF
)
    if [ "${MISSING:-0}" -gt 0 ]; then
      echo -e "${RED}   ❌ ${MISSING} 条登记缺 owner 或 evidence（无责任人/无证据 = 不可审计）${RESET}" >&2
      SELF_RC=1
    fi
    if [ "${EXPIRED:-0}" -gt 0 ]; then
      echo -e "${RED}   ❌ ${EXPIRED} 条登记已过期 —— 按棘轮：不熔断且必须处理（删除条目或重修 expires）${RESET}" >&2
      SELF_RC=1
    fi
    if [ "$STATUS" = "DEGRADED" ] && [ "$SELF_RC" -eq 0 ]; then
      echo -e "${RED}   ❌ 有门禁连续失败 ≥${STREAK_THRESHOLD} 次（同因）—— 按熔断口径告警${RESET}" >&2
      SELF_RC=1
    fi
    if [ "$SELF_RC" -eq 0 ]; then
      echo -e "${GREEN}   ✅ 自检通过（登记表 schema/字段/到期/连续失败 全过）${RESET}"
    fi
    exit "$SELF_RC"
  fi
  exit 0
fi

echo "❌ 未达任何分支（内部错误）" >&2
exit 2
