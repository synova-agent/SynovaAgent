#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# ct-health.sh — 控制塔健康域统一宿主（D962-B2，吸收原 check-ci-stale-red.sh /
#                check-orphan-worktrees.sh / check-canary-drift.sh（task-28 裁定②：
#                canary 逻辑内联为 run_canary_drift 并退役原脚本，ci.yml 调用点改指本宿主）)
#
# 命名说明: 宿主不带 check- 前缀（与 gen-cto-health.sh 同族），使 D962 终态
#           `find scripts -name 'check-*'` 计数 = 20（plan §一 keep-20 清单
#           不含本宿主；若带前缀则 20+1=21 与已批计数等式矛盾）。
#
# 契约:
#   @input  — 子命令: ci-stale-red [--check|--json] | orphan-worktrees [--json]
#             | canary-drift [...原参]（过渡期转发）
#   @output — 各子命令原输出不变（逐字迁移，行为等价）
#   @exit   — 各子命令原三态: 0 正常 / 1 有发现 / 2 降级（铁律 11 显式降级）
#   @degraded — 各子命令降级路径原样保留（API 不可用 / git 不可用 → exit 2 + 显式 log）
#
# 用法: bash scripts/control-tower/ct-health.sh ci-stale-red --json
# 集成: gen-cto-health.py（ci-stale-red / orphan-worktrees 两调用点已改指本宿主）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3；task-28 wire⑤ 连带修复：
#   恢复的 D520 平台检查实测点名本脚本 —— 原 5 处裸 python3 在 Win（仅 python/py）不可用）
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

# ── 子命令: ci-stale-red（原 check-ci-stale-red.sh 逐字迁移，exit→return）──
# CT-39: CI 红超 24h 自动入 CTO 待办（D387 P2-5，红常态化=信号失效 M1 同型）
run_ci_stale_red() {
  local TODO_FILE="$REPO_DIR/docs/synova/coordination/CI-STALE-RED.md"
  local THRESHOLD_HOURS=24
  local RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' NC='\033[0m'
  local MODE="normal" arg
  for arg in "$@"; do
    case "$arg" in
      --check) MODE="check" ;;
      --json) MODE="json" ;;
    esac
  done

  # ── 取 origin/main 最新 run（匿名 API，不用 token 避免泄露）──
  local API="https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/runs?branch=main&per_page=5"
  local RESP RC
  RESP=$("$PYBIN" - "$API" <<'PYEOF'
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
    echo "degraded: CI API 拉取失败（$RESP）" >&2
    return 2
  fi
  if [ "$RESP" = "NONE" ]; then
    [ "$MODE" = "json" ] && echo '{"stale": false, "reason": "无 failure run"}'
    echo -e "${GREEN}✅ CT-39: main 无 failure run，无 stale red${NC}"
    return 0
  fi

  # ── 解析 created_at 距今小时数 ──
  local AGE_HOURS
  AGE_HOURS=$("$PYBIN" - "$RESP" <<'PYEOF'
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
    "$PYBIN" - "$RESP" "$AGE_HOURS" "$THRESHOLD_HOURS" <<'PYEOF'
import json, sys
d = json.loads(sys.argv[1])
age = float(sys.argv[2])
th = float(sys.argv[3])
print(json.dumps({"stale": age > th, "run": d["num"], "age_hours": age, "threshold": th,
                  "title": d["title"], "sha": d["sha"]}))
PYEOF
    [ "$(echo "$AGE_HOURS > $THRESHOLD_HOURS" | bc 2>/dev/null)" = "1" ] && return 1 || return 0
  fi

  local STALE
  STALE=$("$PYBIN" -c "print(1 if $AGE_HOURS > $THRESHOLD_HOURS else 0)" 2>/dev/null || echo 0)  # swallow-ok: age 解析失败按 0 处理，不阻断（AGE_HOURS 已由上游 python 保证）
  if [ "$STALE" = "1" ]; then
    echo -e "${RED}❌ CT-39: main CI 红灯已持续 ${AGE_HOURS}h（>24h）——信号失效，写入待办${NC}"
    if [ "$MODE" != "check" ]; then
      "$PYBIN" - "$RESP" "$AGE_HOURS" "$TODO_FILE" <<'PYEOF'
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
    return 1
  else
    [ "$MODE" = "json" ] && echo '{"stale": false}'
    echo -e "${GREEN}✅ CT-39: main CI 红 ${AGE_HOURS}h（<24h），暂不告警${NC}"
    return 0
  fi
}

# ── 子命令: orphan-worktrees（原 check-orphan-worktrees.sh 逐字迁移，exit→return）──
# worktree 收尾检测（2026-08-21 控制塔冻结决策·必修项，D402/D445 交付躺分支事故）
run_orphan_worktrees() {
  local ROOT="$REPO_DIR"
  local RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' NC='\033[0m'
  local JSON_OUT=false
  [ "${1:-}" = "--json" ] && JSON_OUT=true

  # ── git worktree 可用性 ──
  if ! git -C "$ROOT" worktree list >/dev/null 2>&1; then  # swallow-ok: 非 git 仓库/损坏，降级
    echo -e "${YELLOW}⚠ worktree 检测降级: git 不可用${NC}" >&2
    echo "degraded: git worktree list 失败" >&2
    return 2
  fi

  # ── 收集所有 worktree（排除主 worktree）──
  local ORPHANS="" COUNT=0 line WT_PATH WT_BRANCH UNMERGED
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    # porcelain 格式: worktree <path> / HEAD <sha> / branch <ref>
    if [[ "$line" == worktree\ * ]]; then
      WT_PATH="${line#worktree }"
      # 主 worktree（仓库根）不是孤儿
      if [ "$WT_PATH" = "$ROOT" ]; then
        continue
      fi
    elif [[ "$line" == branch\ * ]]; then
      WT_BRANCH="${line#branch }"
      # 检查该分支是否有未合并到 origin/main 的独有提交
      UNMERGED=$(git -C "$ROOT" rev-list --count origin/main.."$WT_BRANCH" 2>/dev/null || echo "0")  # swallow-ok: 已删分支回退 0（原脚本逐字迁移）
      if [ "$UNMERGED" -gt 0 ] 2>/dev/null; then  # swallow-ok: 非数值按无独有提交（原脚本逐字迁移）
        # 有独有提交 → 待收尾（可能是真交付没合并，也可能过时）
        COUNT=$((COUNT+1))
        if [ "$JSON_OUT" = true ]; then
          ORPHANS="${ORPHANS}${ORPHANS:+,}{\"path\":\"$WT_PATH\",\"branch\":\"$WT_BRANCH\",\"unmerged\":$UNMERGED}"
        else
          ORPHANS="${ORPHANS}  - ${WT_PATH} (分支 ${WT_BRANCH}, ${UNMERGED} 个独有提交待收尾)\n"
        fi
      fi
    fi
  done < <(git -C "$ROOT" worktree list --porcelain 2>/dev/null)  # swallow-ok: git 失败已由上方可用性检查降级（原脚本逐字迁移）

  if [ "$JSON_OUT" = true ]; then
    echo "{\"orphan_count\":$COUNT,\"orphans\":[$ORPHANS]}"
  else
    if [ "$COUNT" -gt 0 ]; then
      echo -e "${RED}❌ worktree 收尾: $COUNT 个孤儿 worktree 有待收尾（实现可能躺分支未合并）${NC}"
      echo -e "$ORPHANS"
      echo "  处理: 确认独有提交是否该合并（真交付）→ worktree-manager finish 或 merge 进 main；过时则删除"
    else
      echo -e "${GREEN}✅ worktree 收尾: 无孤儿 worktree${NC}"
    fi
  fi
  [ "$COUNT" -gt 0 ] && return 1 || return 0
}

# ── 子命令: canary-drift（原 check-canary-drift.sh 逐字迁移，exit→return；task-28 裁定②）──
run_canary_drift() {
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  TESTS_DIR="${SYNO_TESTS_DIR:-$ROOT/tests}"
  CI_YML="${SYNO_CI_YML:-$ROOT/.github/workflows/ci.yml}"
  YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RESET='\033[0m'

  if [ ! -f "$CI_YML" ]; then
    echo -e "${YELLOW}⚠ canary 清单来源缺失: ${CI_YML} — 漂移检查跳过（铁律 11 显式）${RESET}"
    return 0
  fi
  if [ ! -d "$TESTS_DIR" ]; then
    echo -e "${YELLOW}⚠ 测试目录缺失: ${TESTS_DIR} — 漂移检查跳过（铁律 11 显式）${RESET}"
    return 0
  fi

  # CI canary 清单（ci.yml control-tower-tests job 的 for t in 列表）
  LISTED=$(grep -oE 'tests/[A-Za-z0-9_/.-]+\.test\.sh' "$CI_YML" | sort -u)
  # 全部测试文件（.test.sh/.test.ts/.test.py，排除 node_modules）
  # 路径规约: 相对 TESTS_DIR 的父目录（默认即仓库根 → "tests/..."，与清单同形；
  #   注入缝下同样成立——前缀取 dirname(TESTS_DIR) 而非 git ROOT）
  _BASE="$(dirname "${TESTS_DIR%/}")"
  ALL=$(find "$TESTS_DIR" -name '*.test.*' -not -path '*/node_modules/*' 2>/dev/null | sed "s|^$_BASE/||" | sort -u)

  LIST_N=$(echo "$LISTED" | grep -c . || true)
  ALL_N=$(echo "$ALL" | grep -c . || true)

  # 漂移 = 在仓库但不在清单（只对 .test.sh 报——.ts/.py 走 vitest/pytest 不属 canary 语义）
  DRIFT=""
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    case "$t" in
      *.test.sh)
        echo "$LISTED" | grep -qxF "$t" || DRIFT="${DRIFT}  $t\n" ;;
      *) : ;;  # .ts/.py 由各自 runner 覆盖，不计 canary 漂移
    esac
  done <<< "$ALL"

  # 反向漂移 = 清单里有但文件已删/改名（防幽灵清单项）
  GHOST=""
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    [ -f "$_BASE/$t" ] || GHOST="${GHOST}  $t\n"   # 注入缝下同样以 _BASE 为根
  done <<< "$LISTED"

  echo ""
  echo "── canary 漂移对账 (D526) ──"
  echo "  测试文件总数: $ALL_N | canary 清单: $LIST_N 项"
  if [ -n "$DRIFT" ]; then
    # DRIFT 以字面 \n 拼接——printf %b 展开后再计数/取首行
    N=$(printf '%b' "$DRIFT" | grep -c . || true)
    echo -e "${YELLOW}⚠ 漂移: $N 个 .test.sh 不在 CI canary 清单（红态无防线感知——评估纳入或确认排除）:${RESET}"
    printf '%b' "$DRIFT"
    # CI 上进 GitHub warnings 面板（本地输出无害）
    FIRST=$(printf '%b' "$DRIFT" | head -3 | tr '\n' ',' | tr -d '%' | cut -c1-250)
    echo "::warning title=canary-drift::${N} 个测试不在 CI canary 清单: ${FIRST}"
  fi
  if [ -n "$GHOST" ]; then
    echo -e "${YELLOW}⚠ 幽灵清单项（清单有、文件无——改删）:${RESET}"
    printf '%b' "$GHOST"
    echo "::warning title=canary-ghost::CI 清单含不存在文件"
  fi
  if [ -z "$DRIFT" ] && [ -z "$GHOST" ]; then
    echo -e "${GREEN}✅ canary 清单零漂移（.test.sh 全覆盖或显式排除）${RESET}"
  fi
  return 0
}

# ── 分发 ──
case "${1:-}" in
  ci-stale-red)
    shift
    run_ci_stale_red "$@"
    exit $?
    ;;
  orphan-worktrees)
    shift
    run_orphan_worktrees "$@"
    exit $?
    ;;
  canary-drift)
    # task-28 裁定②: 逻辑已内联为 run_canary_drift（原 check-canary-drift.sh 退役）；
    #   ci.yml 调用点同步改指本宿主（不再有过渡期转发，单一入口）。
    shift
    run_canary_drift "$@"
    exit $?
    ;;
  *)
    echo "用法: ct-health.sh <ci-stale-red|--check|--json | orphan-worktrees|--json | canary-drift ...>" >&2
    echo "exit: 0 正常 / 1 有发现 / 2 降级（显式 degraded 输出）" >&2
    exit 2
    ;;
esac
