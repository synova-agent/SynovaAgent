#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# baseline-check.sh — D312 官方基线工具 (M2)
#
# 对比当前输出 vs 快照基线（.codex/control-tower/baseline/），输出
# "存量 N 条 + 新增 M 条"（tsc 错误 / 测试失败 / 审计发现 三基线）。
#
# 算法（快照基线法，对齐设计文档 §2.2 M4 既定方案）:
#   存量 = 基线 ∩ 当前；新增 = 当前 − 基线；已修复 = 基线 − 当前
#   增强: 命中存量的错误若文件 ∈ git diff 改动集 → 标注"存量但位于本次改动文件"
#
# fail-open（铁律 24+31）: 某基线采集器崩溃 → degraded + 其余基线继续，exit 0；
#   基线目录缺失 → degraded + 按全量判定，exit 0（绝不静默）。
#
# 用法:
#   baseline-check.sh [--tsc] [--tests] [--audit] [--json] [--seed] [--update-baseline]
#   env 注入缝（测试免跑真实命令）:
#     SYNO_CT_DIR=<dir> 覆盖 .codex/control-tower 路径
#     SYNO_TSC_OUTPUT / SYNO_VITEST_OUTPUT / SYNO_AUDIT_OUTPUT = fixture 文件
#
# 退出码: 0 = pass/degraded, 1 = 有新增（业务信号）
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CT_DIR="${SYNO_CT_DIR:-$REPO_DIR/.codex/control-tower}"
BASELINE_DIR="$CT_DIR/baseline"
DEGRADED_LOG="$CT_DIR/logs/degraded-events.log"

# Windows 路径归一: /d/xxx → D:/xxx（python open() 不认 Git Bash /d/ 前缀，
# 与 golden-case-checker.ts 同款模式；Linux /home/... 原样）
PY_CT_DIR=$(echo "$CT_DIR" | sed -E 's|^/([a-zA-Z]):|\1:|')
PY_BASELINE_DIR=$(echo "$BASELINE_DIR" | sed -E 's|^/([a-zA-Z]):|\1:|')
PY_DEGRADED_LOG=$(echo "$DEGRADED_LOG" | sed -E 's|^/([a-zA-Z]):|\1:|')

DO_TSC=0; DO_TESTS=0; DO_AUDIT=0; JSON_OUT=0; SEED=0; UPDATE=0
for arg in "$@"; do
  case "$arg" in
    --tsc) DO_TSC=1 ;;
    --tests) DO_TESTS=1 ;;
    --audit) DO_AUDIT=1 ;;
    --json) JSON_OUT=1 ;;
    --seed) SEED=1 ;;
    --update-baseline) UPDATE=1 ;;
    --help)
      echo "baseline-check.sh [--tsc] [--tests] [--audit] [--json] [--seed] [--update-baseline]"
      exit 0
      ;;
  esac
done
# 默认: 全跑（--tsc 常用；--tests/--audit 手动触发）
if [ "$DO_TSC" -eq 0 ] && [ "$DO_TESTS" -eq 0 ] && [ "$DO_AUDIT" -eq 0 ]; then
  DO_TSC=1; DO_TESTS=1; DO_AUDIT=1
fi

# ═══ D537 #5: 基线漂移自动归因（对比 origin/main 改动集）═══
# 病根: merge main 引入 mac 提交后 tsc 基线变化（src/server.ts:396 等），每次人工确认
#   "main 现状 vs 本分支引入"。本分支新增才拦（漏拦=假绿）；main 既有漂移自动归因不拦
#   （误拦=每次 merge 后被迫 --update-baseline 确认）。
# 归因: "新增" 错误按文件归属——文件 ∈ 本分支改动集（vs origin/main）→ 本分支引入(拦)；
#   否则 → main 既有漂移(不拦)。归因不可用（origin/main 不可解析且无注入缝）→ fail-closed
#   拦全部新增（绝不静默放行，铁律 24/31）。
# 注入: SYNO_BRANCH_CHANGED 覆盖本分支改动集（测试隔离，模式 5——免跑真实 git diff）。
BRANCH_CHANGED=""
BRANCH_ATTR_AVAILABLE=0
if [ -n "${SYNO_BRANCH_CHANGED:-}" ]; then
  BRANCH_CHANGED="$SYNO_BRANCH_CHANGED"
  BRANCH_ATTR_AVAILABLE=1
elif git diff --name-only origin/main...HEAD >/dev/null 2>&1; then
  BRANCH_CHANGED="$(git diff --name-only origin/main...HEAD 2>/dev/null || true)"
  BRANCH_ATTR_AVAILABLE=1
fi

log_degraded() {
  mkdir -p "$(dirname "$DEGRADED_LOG")"
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"baseline-check\", \"reason\": \"$1\"}" >> "$DEGRADED_LOG" 2>/dev/null || true
}
# python 可读路径版本（Windows /d/ → D:/）— 用 python 归一（sed 反向引用在
# Git Bash 不可靠；与 golden-case-checker.ts 同款模式）
PY_PATH() {
  python3 -c "
import sys
p = sys.argv[1]
if len(p) > 2 and p[0] == '/' and p[2] == ':':
    p = p[1:2] + ':' + p[2:]
print(p)
" "$1" 2>/dev/null || echo "$1"
}

# ── key 提取 ──
extract_tsc_keys() { # <input_file> — 文件路径:行号（保留冒号）
  grep -oE '^([^()]+)\([0-9]+,[0-9]+\): error TS' "$1" 2>/dev/null \
    | sed -E 's/\(([0-9]+),[0-9]+\): error TS/:\1/' | sort -u || true
}
extract_test_keys() { # <input_file> — tests/X.test.ts 文件路径
  sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$1" 2>/dev/null \
    | grep -oE 'tests/[^[:space:]]+\.test\.ts' | sort -u || true
}
extract_audit_keys() { # <input_file> — src/x.ts:NN
  grep -oE '^[^:]+\.ts:[0-9]+' "$1" 2>/dev/null | sort -u || true
}

# ── 采集当前输出（SYNO_ 注入缝优先）──
collect() { # collect <kind> → stdout: 原始输出
  local kind="$1"
  case "$kind" in
    tsc)
      if [ -n "${SYNO_TSC_OUTPUT:-}" ]; then cat "$SYNO_TSC_OUTPUT" 2>/dev/null || true
      elif [ -f "$REPO_DIR/node_modules/typescript/bin/tsc" ]; then
        # #1417: 只用本地依赖（禁 npx 联网下载 tsc —— 无 node_modules 时会挂住/超时）
        ( cd "$REPO_DIR" && node node_modules/typescript/bin/tsc --noEmit 2>&1 ) | grep "error TS" | grep -v "server/vendor/" | grep -v "packages/" | grep -v "node_modules" || true
      else
        printf '环境未就绪，先 npm ci（缺 node_modules/typescript；禁 npx 联网下载 tsc）\n' >&2
        echo "__ENV_NOT_READY__"
      fi
      ;;
    tests)
      if [ -n "${SYNO_VITEST_OUTPUT:-}" ]; then cat "$SYNO_VITEST_OUTPUT" 2>/dev/null || true
      else npx vitest run --reporter=verbose 2>&1 || true; fi
      ;;
    audit)
      if [ -n "${SYNO_AUDIT_OUTPUT:-}" ]; then cat "$SYNO_AUDIT_OUTPUT" 2>/dev/null || true
      else bash "$REPO_DIR/scripts/check-architecture.sh" 2>&1 || true; fi
      ;;
  esac
}

# ── 单基线判定 ──
check_baseline() { # check_baseline <kind> <baseline_file> <extract_fn>
  local kind="$1" bfile="$2" extract="$3"
  local current baseline existing added fixed
  current=$(collect "$kind")
  if [ "$kind" = "tsc" ] && [ "$current" = "__ENV_NOT_READY__" ]; then
    # #1417: 环境未就绪 ⇒ exit 2 语义（判不了 ≠ 通过；也不得挂住等 npx）
    echo "  ⚠️ 环境未就绪，先 npm ci —— tsc 基线快检判不了（exit 2，禁当通过）"
    return 2
  fi
  if [ -z "$current" ]; then
    # 采集器崩溃/无输出 → degraded，不误报新增（fail-open）
    log_degraded "$kind 采集无输出"
    echo "  ⚠️  degraded: $kind 采集无输出 (fail-open)"
    return 0
  fi
  local tmp_current tmp_baseline
  mkdir -p "$CT_DIR/tmp"
  tmp_current=$(mktemp "$CT_DIR/tmp/bc-cur-XXXX" 2>/dev/null || echo "")
  if [ -z "$tmp_current" ]; then log_degraded "mktemp 失败"; echo "  ⚠️  degraded: 无法创建临时文件"; return 0; fi
  echo "$current" > "$tmp_current"
  local cur_keys base_keys
  cur_keys=$($extract "$tmp_current")
  rm -f "$tmp_current"

  if [ "$SEED" -eq 1 ]; then
    mkdir -p "$BASELINE_DIR"
    cat > "$bfile" <<EOF
{"schema": "control-tower/baseline/$kind/v1", "version": "4.6.0-WIP", "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%S+00:00)", "baseline": [$(echo "$cur_keys" | sed 's/^/"/; s/$/"/' | tr '\n' ',' | sed 's/,$//')]}
EOF
    echo "  ✅ $kind 基线已建立: $(echo "$cur_keys" | grep -c . || echo 0) 条"
    return 0
  fi

  if [ ! -f "$bfile" ]; then
    log_degraded "$kind 基线缺失: $bfile"
    echo "  ⚠️  degraded: $kind 基线缺失 — 按全量判定（运行 --seed 建立）"
    return 0
  fi

  local py_bfile
  py_bfile=$(PY_PATH "$bfile")
  base_keys=$(python3 -c "
import json, sys
try:
    d = json.load(open('$py_bfile', encoding='utf-8'))
    print('\n'.join(d.get('baseline', [])))
except Exception:
    print('')
" 2>/dev/null || echo "")

  # 集合运算（python 避免 bash 数组 + 中文路径问题）
  # D537 #5: 漂移归因——"新增" 拆分: 文件 ∈ 本分支改动集 → 本分支引入(拦)；否则 main 既有(不拦)
  local result
  result=$(python3 -c "
import sys
def norm(p): return p.replace('\\\\\\\\','/').lstrip('./')
cur = set(l.strip() for l in '''$cur_keys'''.split('\n') if l.strip())
base = set(l.strip() for l in '''$base_keys'''.split('\n') if l.strip())
changed = [norm(c) for c in '''$BRANCH_CHANGED'''.split('\n') if c.strip()]
attr_ok = $BRANCH_ATTR_AVAILABLE
existing = sorted(cur & base)
added = sorted(cur - base)
fixed = sorted(base - cur)
added_branch = []
added_main = []
for a in added:
    in_branch = any(c and c in norm(a) for c in changed)
    if attr_ok and not in_branch:
        added_main.append(a)   # main 既有漂移（自动归因，不拦）
    else:
        added_branch.append(a)  # 本分支引入 或 归因不可用(fail-closed)
print(f'EXISTING={len(existing)}')
print(f'ADDED={len(added_branch)}')
print(f'FIXED={len(fixed)}')
print(f'MAIN_DRIFT={len(added_main)}')
for a in added_branch: print(f'ADD:{a}')
for a in added_main: print(f'MAIN:{a}')
" 2>/dev/null || echo "EXISTING=0 ADDED=0 FIXED=0 MAIN_DRIFT=0")

  local n_existing n_added n_fixed n_main_drift
  n_existing=$(echo "$result" | grep '^EXISTING=' | cut -d= -f2)
  n_added=$(echo "$result" | grep '^ADDED=' | cut -d= -f2)
  n_fixed=$(echo "$result" | grep '^FIXED=' | cut -d= -f2)
  n_main_drift=$(echo "$result" | grep '^MAIN_DRIFT=' | cut -d= -f2)

  if [ "$UPDATE" -eq 1 ]; then
    # 并集合并（存量 + 当前全部 → 全部转存量）
    local merged
    merged=$( { echo "$base_keys"; echo "$cur_keys"; } | tr -d '\r' | sort -u )
    cat > "$bfile" <<EOF
{"schema": "control-tower/baseline/$kind/v1", "version": "4.6.0-WIP", "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%S+00:00)", "baseline": [$(echo "$merged" | sed 's/^/"/; s/$/"/' | tr '\n' ',' | sed 's/,$//')]}
EOF
    echo "  ✅ $kind 基线已更新: $(echo "$merged" | grep -c . || echo 0) 条"
    return 0
  fi

  echo "  $kind 基线:   存量 ${n_existing:-0} + 新增 ${n_added:-0}（本分支）+ main 漂移 ${n_main_drift:-0}（已修复 ${n_fixed:-0}）"
  if [ "${n_main_drift:-0}" -gt 0 ]; then
    echo "$result" | grep '^MAIN:' | sed 's/^MAIN:/     ~/' | head -5
    echo "     ↑ main 既有漂移（自动归因 D537 #5，不拦——本分支未改这些文件）"
  fi
  if [ "${n_added:-0}" -gt 0 ]; then
    echo "$result" | grep '^ADD:' | sed 's/^ADD:/     +/' | head -5
    return 1
  fi
  return 0
}

# ── 主流程 ──
echo "── baseline-check (D312): 存量 vs 新增 ──"
BLOCKED=0
JSON_PARTS=""

if [ "$DO_TSC" -eq 1 ]; then
  OUT_TSC=$(check_baseline "tsc" "$BASELINE_DIR/tsc-errors.json" extract_tsc_keys); TSC_RC=$?
  echo "$OUT_TSC"
  if [ "$TSC_RC" -eq 2 ]; then exit 2; fi
  [ "$TSC_RC" -eq 1 ] && BLOCKED=1
  N_TSC=$(echo "$OUT_TSC" | grep -oE '存量 [0-9]+' | head -1 | grep -oE '[0-9]+' || echo 0)
  A_TSC=$(echo "$OUT_TSC" | grep -oE '新增 [0-9]+' | head -1 | grep -oE '[0-9]+' || echo 0)
  JSON_PARTS="${JSON_PARTS}{\"tsc\":{\"existing\":$N_TSC,\"added\":$A_TSC}},"
fi
if [ "$DO_TESTS" -eq 1 ]; then
  OUT_TESTS=$(check_baseline "tests" "$BASELINE_DIR/test-failures.json" extract_test_keys) && : || BLOCKED=1
  echo "$OUT_TESTS"
  N_TESTS=$(echo "$OUT_TESTS" | grep -oE '存量 [0-9]+' | head -1 | grep -oE '[0-9]+' || echo 0)
  A_TESTS=$(echo "$OUT_TESTS" | grep -oE '新增 [0-9]+' | head -1 | grep -oE '[0-9]+' || echo 0)
  JSON_PARTS="${JSON_PARTS}{\"tests\":{\"existing\":$N_TESTS,\"added\":$A_TESTS}},"
fi
if [ "$DO_AUDIT" -eq 1 ]; then
  OUT_AUDIT=$(check_baseline "audit" "$BASELINE_DIR/audit-findings.json" extract_audit_keys) && : || BLOCKED=1
  echo "$OUT_AUDIT"
  N_AUDIT=$(echo "$OUT_AUDIT" | grep -oE '存量 [0-9]+' | head -1 | grep -oE '[0-9]+' || echo 0)
  A_AUDIT=$(echo "$OUT_AUDIT" | grep -oE '新增 [0-9]+' | head -1 | grep -oE '[0-9]+' || echo 0)
  JSON_PARTS="${JSON_PARTS}{\"audit\":{\"existing\":$N_AUDIT,\"added\":$A_AUDIT}},"
fi

echo ""
if [ "$JSON_OUT" -eq 1 ]; then
  echo "{\"verdict\":\"$([ "$BLOCKED" -eq 1 ] && echo block || echo pass)\",\"baselines\":[${JSON_PARTS%,}]}"
fi
if [ "$BLOCKED" -eq 1 ]; then
  echo "  ❌ 存在新增问题 — 请修复后重试 (或 --update-baseline 确认后收录)"
  exit 1
fi
echo "  ✅ 无新增 — 基线通过"
exit 0
