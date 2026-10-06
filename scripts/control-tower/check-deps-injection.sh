#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-deps-injection.sh — D925: deps 接口 / setter 注入标准检查器（首版只报不拦）
#
# 标准全文: docs/synova/coordination/标准-deps接口与setter注入-20260923.md
#
# 判据（队长已核准的「判据冻结」：变体 B 窄 / 闭集排除 getDatabase / 排除面 +4 条）:
#   R1 无注入缝的编排入口直连生产单例（按文件判定）
#      (a) 含生产单例 getter 调用（具名闭集 SINGLETON_GETTERS_RE）
#      (b) 导出编排入口函数（具名清单 ENTRY_FN_RE）
#      (c) 未导出任何 setXxxDeps 注入缝
#   R2 注入缝签名偏离标准形状（须为 (deps: <Type> | null): void）
#
# 契约:
#   @input   — 二选一: [--dir <路径>]（全扫盘点） | [--base <ref> --head <ref>]（只判新增/改动文件）
#              [--strict]（翻转 exit 1）; [--baseline <文件>]; [--exempt <文件>]; [--verbose]
#              注入缝（测试）: SYNO_DEPS_GREP / SYNO_DEPS_GIT
#   @output  — stdout: 命中清单; report 模式下每命中一行
#              "::warning file=<f>,line=<n>::DEPS-INJECTION R1/R2 <说明>"; 末行
#              "DEPS-INJECTION: OK|REPORT(n)|VIOLATION(n)"
#   @exit    — 0 = 通过（含 report 模式恒 0，裁定 5「只报不拦」）
#              1 = --strict 且存在新增违规
#              2 = 检查执行失败/降级（fail-closed，绝不等同通过，D328 三态）
#   @degraded— 扫描器/仓库不可用、指定 baseline 缺失 → exit 2 + stderr "degraded: <原因>"
#              + 追加 <扫描根>/.codex/control-tower/logs/degraded-events.log（铁律 11，不静默）
#   @error   — .code = DEPS_SCAN_UNAVAILABLE | DEPS_BASELINE_UNREADABLE ; .phase = 'scan'|'baseline'
#              .retryable = 布尔（铁律 32）
#
# 适用范围（声明式，与标准文档 §2 同源）: 仅 `src/**` 的 .ts/.tsx；排除测试面。
# 已知边界: `packages/**` 未纳入（标准文档失效条件登记）；R1 为文件级，抓不到有缝文件内部的直连。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── 具名常量（裁定 1/2：禁内联正则散落） ──────────────────────────────────────
# 生产单例 getter 闭集。各 getter 在 src/ 的命中文件数（命令:
#   `git grep -l "<getter>(" -- src | wc -l`，截至 2026-09-23 实测）:
#   getFeedbackCollector 4 / getExpertRegistry 8 / getGlobalScheduler 7 / getRegistry 1 / getScheduler 3
# **有意排除 `getDatabase`**：`git grep -l 'getDatabase(' -- src | wc -l` → 34 文件（纳入即 34 处噪声）；
#   且 src/agent/loop-handlers.ts:471 的 `deps?.getDatabase ?? (await import('../init/engine-context')).getDatabase`
#   是**合规 fallback 写法** —— 纳入闭集会把合规代码判违规（正是"禁 grep 型静态判据"要防的形态）。
SINGLETON_GETTERS_RE='(getFeedbackCollector|getExpertRegistry|getGlobalScheduler|getRegistry|getScheduler)\('

# 编排入口函数命名清单。命令（截至 2026-09-23 实测）:
#   `git grep -lE 'export (async )?function [A-Za-z_]*(Handler|Runner|Coordinator|Dispatcher)\(' -- src` → 3 文件
#   （src/agent/loop-handlers.ts、src/l3/expert-dispatcher.ts、src/sentinel/runner.ts）
# 收紧/放宽走标准文档「失效条件」节。
ENTRY_FN_RE='export (async )?function [A-Za-z_]*(Handler|Runner|Coordinator|Dispatcher)\('

# 注入缝：导出 + 签名须为 (deps: <Type> | null): void
SEAM_RE='export function set[A-Za-z]+Deps\('
SEAM_SIG_RE='export function set[A-Za-z]+Deps\(deps: [A-Za-z_][A-Za-z0-9_]* \| null\): void'

# 测试面（不属标准适用范围）
TEST_FACE_RE='(^|/)(tests?)/|\.(test|integration\.test|e2e\.test)\.tsx?$'

MODE="full"
TARGET_DIR="$REPO_DIR"
BASE_REF=""
HEAD_REF=""
STRICT=0
VERBOSE=0
BASELINE_FILE="$SCRIPT_DIR/deps-injection-baseline.txt"
EXEMPT_FILE="$SCRIPT_DIR/deps-injection-exempt.txt"

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)      MODE="full"; TARGET_DIR="${2:-}"; shift 2 ;;
    --base)     MODE="diff"; BASE_REF="${2:-}"; shift 2 ;;
    --head)     MODE="diff"; HEAD_REF="${2:-}"; shift 2 ;;
    --strict)   STRICT=1; shift ;;
    --verbose)  VERBOSE=1; shift ;;
    --baseline) BASELINE_FILE="${2:-}"; shift 2 ;;
    --exempt)   EXEMPT_FILE="${2:-}"; shift 2 ;;
    -h|--help)  sed -n '5,44p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

GREP_BIN="${SYNO_DEPS_GREP:-grep}"
GIT_BIN="${SYNO_DEPS_GIT:-git}"

degrade() {
  local code="$1" reason="$2" phase="${3:-scan}"
  echo "degraded: $reason (code=$code phase=$phase retryable=false)" >&2
  mkdir -p "$TARGET_DIR/.codex/control-tower/logs" 2>/dev/null || true
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"check-deps-injection\", \"code\": \"$code\", \"reason\": \"$reason\"}" \
    >> "$TARGET_DIR/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true
  exit 2
}

# ── 探测可用性而非存在性（D328 P1-1）；不吞 stderr，损坏 shim 的报错应可见 ──
command -v "$GREP_BIN" >/dev/null 2>&1 || degrade DEPS_SCAN_UNAVAILABLE "grep 不可用: $GREP_BIN"
printf 'probe\n' | "$GREP_BIN" -q 'probe' || degrade DEPS_SCAN_UNAVAILABLE "grep 试运行失败（存在但不可用）: $GREP_BIN"
if [ "$MODE" = "diff" ]; then
  command -v "$GIT_BIN" >/dev/null 2>&1 || degrade DEPS_SCAN_UNAVAILABLE "git 不可用（diff 模式必需）: $GIT_BIN"
  if [ -z "$BASE_REF" ] || [ -z "$HEAD_REF" ]; then
    degrade DEPS_SCAN_UNAVAILABLE "diff 模式需同时给 --base 与 --head"
  fi
  "$GIT_BIN" -C "$TARGET_DIR" rev-parse --verify "$BASE_REF" >/dev/null 2>&1 || degrade DEPS_SCAN_UNAVAILABLE "base ref 无法解析: $BASE_REF"
  "$GIT_BIN" -C "$TARGET_DIR" rev-parse --verify "$HEAD_REF" >/dev/null 2>&1 || degrade DEPS_SCAN_UNAVAILABLE "head ref 无法解析: $HEAD_REF"
else
  [ -d "$TARGET_DIR" ] || degrade DEPS_SCAN_UNAVAILABLE "扫描根目录不存在: $TARGET_DIR"
  [ -d "$TARGET_DIR/src" ] || degrade DEPS_SCAN_UNAVAILABLE "扫描根下无 src/ 目录（适用范围 = src/**）: $TARGET_DIR"
fi

# ── 豁免/存量清单: 「<路径> — <理由>」；**无理由不生效**（fail-closed：豁免更少 = 报得更多） ──
load_reason_list() {
  local f="$1"
  [ -f "$f" ] || return 0
  "$GREP_BIN" -v '^[[:space:]]*#' "$f" 2>/dev/null | "$GREP_BIN" -v '^[[:space:]]*$' | tr -d '\r' | while IFS= read -r ln; do
    case "$ln" in
      *' — '*) printf '%s\n' "${ln%% — *}" ;;
      *) : ;; # 无理由 → 不生效（既不留空档，也绝不"全豁免"）
    esac
  done
}
# 显式指定的 baseline 不存在 = 调用方错误（fail-closed，不静默当空）
if [ "$BASELINE_FILE" != "$SCRIPT_DIR/deps-injection-baseline.txt" ] && [ ! -f "$BASELINE_FILE" ]; then
  degrade DEPS_BASELINE_UNREADABLE "指定的 baseline 不存在: $BASELINE_FILE" baseline
fi
BASELINE_KEYS="$(load_reason_list "$BASELINE_FILE")"
EXEMPT_KEYS="$(load_reason_list "$EXEMPT_FILE")"   # 文件缺失/格式坏 → 空 = 0 条豁免

in_list() {
  local keys="$1" want="$2"
  [ -z "$keys" ] && return 1
  printf '%s\n' "$keys" | "$GREP_BIN" -Fxq "$want"
}

# ── 文件收集 ────────────────────────────────────────────────────────────────
FILES_LIST="$(mktemp)"; HITS_TMP="$(mktemp)"
trap 'rm -f "$FILES_LIST" "$HITS_TMP"' EXIT

if [ "$MODE" = "diff" ]; then
  "$GIT_BIN" -C "$TARGET_DIR" -c core.quotepath=false diff --name-only --diff-filter=AM "$BASE_REF".."$HEAD_REF" 2>/dev/null \
    | "$GREP_BIN" -E '^src/.*\.tsx?$' > "$FILES_LIST" || true
else
  ( cd "$TARGET_DIR" && find src -type f \( -name '*.ts' -o -name '*.tsx' \) ) > "$FILES_LIST" 2>/dev/null \
    || degrade DEPS_SCAN_UNAVAILABLE "find 扫描失败: $TARGET_DIR/src"
fi

FILE_COUNT=0
[ -s "$FILES_LIST" ] && FILE_COUNT=$(wc -l < "$FILES_LIST" | tr -d ' \n\r')

HITS=0; EXEMPTED=0; SKIPPED_TEST=0

record() { # <相对路径> <行号> <规则> <说明>
  local rel="$1" ln="$2" rule="$3" desc="$4"
  if in_list "$EXEMPT_KEYS" "$rel"; then EXEMPTED=$((EXEMPTED + 1)); return; fi
  if in_list "$BASELINE_KEYS" "$rel"; then EXEMPTED=$((EXEMPTED + 1)); return; fi
  HITS=$((HITS + 1))
  printf 'HIT  %s:%s  %s  %s\n' "$rel" "$ln" "$rule" "$desc" >> "$HITS_TMP"
  printf '::warning file=%s,line=%s::DEPS-INJECTION %s %s\n' "$rel" "$ln" "$rule" "$desc" >> "$HITS_TMP"
}

scan_file() { # <文件路径> <相对路径>
  local f="$1" rel="$2" line ln seamline sl
  # 测试面排除（EX-A）
  if printf '%s' "$rel" | "$GREP_BIN" -qE "$TEST_FACE_RE"; then SKIPPED_TEST=$((SKIPPED_TEST + 1)); return; fi
  [ "$VERBOSE" = "1" ] && echo "  scan  $rel"

  # R1: (a) getter 调用 + (b) 编排入口 + (c) 无注入缝
  if "$GREP_BIN" -qE "$SINGLETON_GETTERS_RE" "$f" 2>/dev/null \
    && "$GREP_BIN" -qE "$ENTRY_FN_RE" "$f" 2>/dev/null \
    && ! "$GREP_BIN" -qE "$SEAM_RE" "$f" 2>/dev/null; then
    line=$("$GREP_BIN" -HInE "$SINGLETON_GETTERS_RE" "$f" 2>/dev/null | head -1 | tr -d '\r' || true)
    ln="${line#*:}"; ln="${ln%%:*}"
    record "$rel" "${ln:-1}" "R1" "编排入口直连生产单例且无 setXxxDeps 注入缝"
  fi

  # R2: 注入缝签名偏离标准形状（here-string 避免管道子 shell，record 可累计）
  local seams
  seams=$("$GREP_BIN" -HInE "$SEAM_RE" "$f" 2>/dev/null | tr -d '\r' || true)
  while IFS= read -r seamline; do
    [ -z "$seamline" ] && continue
    printf '%s' "$seamline" | "$GREP_BIN" -qE "$SEAM_SIG_RE" && continue
    sl="${seamline#*:}"; sl="${sl%%:*}"
    record "$rel" "${sl:-1}" "R2" "setXxxDeps 签名偏离标准形状（须 (deps: T | null): void）"
  done <<< "$seams"
}

if [ "$MODE" = "diff" ]; then
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    [ -f "$TARGET_DIR/$rel" ] || continue
    scan_file "$TARGET_DIR/$rel" "$rel"
  done < "$FILES_LIST"
else
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    [ -f "$TARGET_DIR/$rel" ] || continue
    scan_file "$TARGET_DIR/$rel" "$rel"
  done < "$FILES_LIST"
fi

BASELINE_COUNT=0
[ -n "$BASELINE_KEYS" ] && BASELINE_COUNT=$(printf '%s\n' "$BASELINE_KEYS" | "$GREP_BIN" -c . | tr -d ' \n\r' || true)
[ -z "$BASELINE_COUNT" ] && BASELINE_COUNT=0
EXEMPT_COUNT=0
[ -n "$EXEMPT_KEYS" ] && EXEMPT_COUNT=$(printf '%s\n' "$EXEMPT_KEYS" | "$GREP_BIN" -c . | tr -d ' \n\r' || true)
[ -z "$EXEMPT_COUNT" ] && EXEMPT_COUNT=0

echo "[deps-injection] mode=$MODE files=$FILE_COUNT baseline=$BASELINE_COUNT exempt=$EXEMPT_COUNT skipped_test=$SKIPPED_TEST"
if [ -s "$HITS_TMP" ]; then
  "$GREP_BIN" '^HIT ' "$HITS_TMP" || true
  "$GREP_BIN" '^::warning' "$HITS_TMP" || true
fi

if [ "$HITS" -gt 0 ]; then
  if [ "$STRICT" = "1" ]; then
    echo "DEPS-INJECTION: VIOLATION($HITS)"
    echo "  修法: 编排入口经 deps 接口取依赖——export function setXxxDeps(deps: XxxDeps | null): void，传 null 恢复生产默认。"
    echo "  标准: docs/synova/coordination/标准-deps接口与setter注入-20260923.md"
    exit 1
  fi
  echo "DEPS-INJECTION: REPORT($HITS) — 首版只报不拦（--strict 才 exit 1）"
  exit 0
fi
echo "DEPS-INJECTION: OK (files=$FILE_COUNT, hits=0, exempted=$EXEMPTED, baseline=$BASELINE_COUNT, exempt=$EXEMPT_COUNT)"
exit 0
