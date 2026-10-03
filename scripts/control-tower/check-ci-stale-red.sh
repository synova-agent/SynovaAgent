#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-ci-stale-red.sh — CT-39: CI 红超 24h 自动入 CTO 待办
#
# 背景: D387 P2-5 实证 CI 双红 ≥16:03 无人认领 = 信号失效（M1 同型）。
#       红常态化让"红=有问题"的信号钝化。本脚本检测 origin/main 的 CI 红灯
#       是否持续超 24h，超时则写入 CTO 待办（docs/synova/coordination/CI-STALE-RED.md），
#       让 CTO 开工第一眼看到"有人要认领这个红"。
#
# 契约:
#   @input  — 无参 | --check（只判定，不写待办，供测试/CI 用）| --json（输出 JSON）
#   @output — 无 stale red → exit 0（无待办）；有 stale red → 写待办文件 + exit 1
#   @exit   — 0 无 stale red；1 有 stale red（已写待办）；2 降级（API 不可用/网络失败）
#   @degraded — GitHub API 不可用 → exit 2 + 显式 log（铁律 11，不静默当真）
#
# 判定标准（只认"当前 main 持续红"，不认历史 transient）:
#   origin/main 最新一次 run 的 conclusion = failure，且 created_at 距今 > 24h
#   → stale red（该红没人修，信号失效）
#
# 用法: bash scripts/control-tower/check-ci-stale-red.sh [--check|--json]
# 集成: gen-cto-health.py 渲染前调用（CT-41① 增强）；或 cron/CI 独立触发
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TODO_FILE="$REPO_DIR/docs/synova/coordination/CI-STALE-RED.md"
THRESHOLD_HOURS=24

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

MODE="normal"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --json) MODE="json" ;;
  esac
done

# ── 取 origin/main 最新 run（匿名 API，不用 token 避免泄露）──
# 只查 main 分支的 run，排除 bot 分支（auto/*）的噪音
API="https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/runs?branch=main&per_page=5"
RESP=$(python3 - "$API" <<'PYEOF'
import json, sys, urllib.request
url = sys.argv[1]
try:
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "check-ci-stale-red"})
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.loads(r.read().decode("utf-8"))
    for run in d.get("workflow_runs", []):
        if run.get("conclusion") == "failure":
            print(json.dumps({"num": run.get("run_number"), "created": run.get("created_at"),
                              "title": (run.get("display_title") or "")[:60], "sha": (run.get("head_sha") or "")[:7]}))
            break
    else:
        print("NONE")
except Exception as e:
    print("ERR:" + str(e))
    sys.exit(2)
PYEOF
)
RC=$?
if [ $RC -ne 0 ]; then
  echo -e "${YELLOW}⚠ CT-39: GitHub API 不可用 — 降级（不静默当真）${NC}"
  echo "degraded: CI API 拉取失败（${RESP}）" >&2
  exit 2
fi
if [ "$RESP" = "NONE" ]; then
  [ "$MODE" = "json" ] && echo '{"stale": false, "reason": "无 failure run"}'
  echo -e "${GREEN}✅ CT-39: main 无 failure run，无 stale red${NC}"
  exit 0
fi

# ── 解析 created_at 距今小时数 ──
AGE_HOURS=$(python3 - "$RESP" <<'PYEOF'
import json, sys, datetime
d = json.loads(sys.argv[1])
created = d["created"]
try:
    dt = datetime.datetime.fromisoformat(created.replace("Z", "+00:00"))
    now = datetime.datetime.now(datetime.timezone.utc)
    return_age = (now - dt).total_seconds() / 3600
    print(f"{return_age:.1f}")
except Exception:
    print("-1")
PYEOF
)

if [ "$MODE" = "json" ]; then
  python3 - "$RESP" "$AGE_HOURS" "$THRESHOLD_HOURS" <<'PYEOF'
import json, sys
d = json.loads(sys.argv[1])
age = float(sys.argv[2])
th = float(sys.argv[3])
print(json.dumps({"stale": age > th, "run": d["num"], "age_hours": age, "threshold": th,
                  "title": d["title"], "sha": d["sha"]}))
PYEOF
  [ "$(echo "$AGE_HOURS > $THRESHOLD_HOURS" | bc 2>/dev/null)" = "1" ] && exit 1 || exit 0
fi

STALE=$(python3 -c "print(1 if $AGE_HOURS > $THRESHOLD_HOURS else 0)" 2>/dev/null || echo 0)  # swallow-ok: age 解析失败按 0 处理，不阻断（AGE_HOURS 已由上游 python 保证）
if [ "$STALE" = "1" ]; then
  echo -e "${RED}❌ CT-39: main CI 红灯已持续 ${AGE_HOURS}h（>24h）——信号失效，写入待办${NC}"
  if [ "$MODE" != "check" ]; then
    python3 - "$RESP" "$AGE_HOURS" "$TODO_FILE" <<'PYEOF'
import json, sys, datetime
d = json.loads(sys.argv[1]); age = sys.argv[2]; path = sys.argv[3]
content = f"""# CI 红灯待办（CT-39 自动生成）

> 生成: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} | 红灯持续 {age}h（阈值 24h）

## 当前 stale red

- Run #{d['num']} — **failure**（创建 {d['created'][:16]}，距今 {age}h）
- 标题: {d['title']}
- SHA: {d['sha']}

## 该做什么

1. CTO 认领这个红，查 failure 原因（CI job 日志）
2. 修复后 push → main 转绿 → 本待办自动清除（下次 check 无 failure 即删）
3. 若确属已知豁免（如 npm audit），记录豁免理由到台账，勿让红灯常态化

> 红线: 红常态化 = 信号失效（M1 同型）。要么修，要么显式豁免，绝不无视。
"""
open(path, 'w', encoding='utf-8').write(content)
PYEOF
    echo "待办已写: $TODO_FILE"
  fi
  exit 1
else
  [ "$MODE" = "json" ] && echo '{"stale": false}'
  echo -e "${GREEN}✅ CT-39: main CI 红 ${AGE_HOURS}h（<24h），暂不告警${NC}"
  exit 0
fi
