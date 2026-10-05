#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# Loop Engineering V5.3 — pre-commit 本地精简版（D962 2a① 重写）
# 本地 10 条目: #46 GATEKEEPER+fastlane / #11家 CT-34 早退 / #17 主树占用 /
#   #33 绕过审计 / #3 硬编码(改判保留) / #30 DiagnosticModule / #38 G10 / #39 G11 /
#   gate-hits 钩子 / D943 断面(×3 不删)。34 项迁 CI: SYNO_CI=1 走 §CI 权威区（双端单一实现）。
# 修复: D260 死分支赋值；CP3 ||true→三态；组7a 正则保全；PYBIN 全局化；
#   G12 \$ 逃逸 bug（恒绿 fail-open）。三态: 0过/1拦/2降级登记。
# ═══════════════════════════════════════════════════════════════
set +e
HARD_FAIL=0; WARN_COUNT=0; SOFT_COUNT=0
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'

log_gate() {  # 契约(铁律47): @input 检查名+hit|miss; @output JSONL→gate-hits（旁路4数据源）
  local g="$1" r="$2"; [ -z "$g" ] && return 0
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"gate\": \"${g}\", \"result\": \"${r}\", \"branch\": \"${_GATE_BRANCH}\"}" >> "${GATE_HITS_LOG}" 2>/dev/null || true  # swallow-ok: 统计非门禁
}
_emit_matches() {  # FIX-015: CI 下不截断（原 head -8 使第 9 行起 CI 不可见）+ ::error 注解带失败断言原文
  local m="$1" name="${2:-}" n="${3:-8}"
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "$m" | while read -r l; do [ -n "$l" ] && echo "     ${l}"; done
    [ -n "$name" ] && echo "::error title=IronLaws:${name}::$(echo "$m" | head -1 | tr -d '%' | cut -c1-280)"
  else
    echo "$m" | head -"$n" | while read -r l; do [ -n "$l" ] && echo "     ${l}"; done
  fi
}
hard_check() {  # @三态 1: 命中即 HARD_FAIL（本地硬拦）
  local name="$1" matches="$2" count=0
  [ -n "$matches" ] && count=$(echo "$matches" | grep -c . 2>/dev/null) || count=0
  if [ "$count" -gt 0 ]; then
    echo -e "  ${RED}❌ ${name}: ${count} 处  [硬阻断]${RESET}"
    _emit_matches "$matches" "$name" 8
    HARD_FAIL=$((HARD_FAIL + 1)); log_gate "$name" hit
  else
    echo -e "  ${GREEN}✅ ${name}${RESET}"; log_gate "$name" miss
  fi
}
soft_check() {  # @三态 1: 本地软 / SYNO_CI=1 转硬（D516；D542 CI 下必显 ❌）
  local name="$1" matches="$2" count=0
  [ -n "$matches" ] && count=$(echo "$matches" | grep -c . 2>/dev/null) || count=0
  if [ "$count" -gt 0 ]; then
    if [ "${SYNO_CI:-0}" = "1" ]; then
      echo -e "  ${RED}❌ ${name}: ${count} 处  [CI strict——软提示转硬]${RESET}"
      HARD_FAIL=$((HARD_FAIL + 1))
    else
      echo -e "  ${YELLOW}⚠️  ${name}: ${count} 处  [V5 软提示——CI 为权威]${RESET}"
      SOFT_COUNT=$((SOFT_COUNT + 1))
    fi
    _emit_matches "$matches" "$([ "${SYNO_CI:-0}" = "1" ] && echo "$name")" 8
    log_gate "$name" hit
  else
    echo -e "  ${GREEN}✅ ${name}${RESET}"; log_gate "$name" miss
  fi
}
warn_check() {  # CI 也转硬（D542）
  local name="$1" matches="$2" count=0
  [ -n "$matches" ] && count=$(echo "$matches" | grep -c . 2>/dev/null) || count=0
  if [ "$count" -gt 0 ]; then
    if [ "${SYNO_CI:-0}" = "1" ]; then
      echo -e "  ${RED}❌ ${name}: ${count} 处  [CI strict]${RESET}"; HARD_FAIL=$((HARD_FAIL + 1))
    else
      echo -e "  ${YELLOW}⚠️  ${name}: ${count} 处  [警告]${RESET}"; WARN_COUNT=$((WARN_COUNT + 1))
    fi
    _emit_matches "$matches" "$([ "${SYNO_CI:-0}" = "1" ] && echo "$name")" 5
    log_gate "$name" hit
  fi
}
soft_pass() { echo -e "  ${GREEN}✅ $1${RESET}"; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
GATE_HITS_LOG="${SYNO_GATE_HITS_LOG:-$ROOT/.claude/gate-hits.log}"
_GATE_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

# task-30 P0（Windows 平台差异）: 本脚本多处把路径喂给**原生 Windows python**，而 Git-Bash 的
#   POSIX 路径（/d/a/…、/tmp/…）打不开 ⇒ 旧版静默读到空集（G10/G12 在 Win 上静默降级）。
#   统一经本函数转换（无 cygpath 平台原样返回 ⇒ macOS/Linux 行为不变）。
_TO_PY() { command -v cygpath >/dev/null 2>&1 && { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; } || printf '%s' "$1"; }


# ── #46 GATEKEEPER 前置: 当日 detected-bypass 硬拦（ACK=1 人工复核降级 D421）──
BYPASS_LOG="$ROOT/.claude/bypass.log"
if [ -f "$BYPASS_LOG" ] && [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  TODAY=$(date +%Y-%m-%d)
  BYPASS_COUNT=$(grep -c "${TODAY}.*detected-bypass" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  BYPASS_COUNT=${BYPASS_COUNT//[^0-9]/}; [ -z "$BYPASS_COUNT" ] && BYPASS_COUNT=0
  if [ "$BYPASS_COUNT" -gt 0 ]; then
    echo "[GATEKEEPER] 检测到今日 ${BYPASS_COUNT} 次 --no-verify 绕过记录"
    if [ "${SYNO_GATEKEEPER_ACK:-0}" = "1" ]; then
      echo "[GATEKEEPER] 已人工确认 — 降级为告警放行本次提交"; mkdir -p "$ROOT/.codex/control-tower/logs"
      echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"component\": \"gatekeeper\", \"reason\": \"ACK=1 放行 ${BYPASS_COUNT} 次 detected-bypass\"}" >> "$ROOT/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true  # swallow-ok: 降级登记
    else
      echo "[GATEKEEPER] 请使用: git synova-commit --task-id <D#> ...；误报复核可用 SYNO_GATEKEEPER_ACK=1"
      exit 1
    fi
  fi
fi

# ── diff 缓存（D390 武装注入缝: 仅 SYNO_TEST_ARM=1 可注入；CI 用 base...HEAD）──
if [ "${SYNO_TEST_ARM:-0}" = "1" ]; then
  GIT_CACHED_NAMES="${SYNO_GIT_CACHED_NAMES:-$(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)}"
  GIT_CACHED_ALL_NAMES="${SYNO_GIT_CACHED_ALL_NAMES:-$GIT_CACHED_NAMES}"
  GIT_CACHED_ADDED_NAMES="${SYNO_GIT_CACHED_ADDED_NAMES:-$(git -c core.quotepath=false diff --cached --name-only --diff-filter=A 2>/dev/null || true)}"
  GIT_CACHED_DIFF="${SYNO_GIT_CACHED_DIFF:-$(git diff --cached 2>/dev/null || true)}"
else
  _DIFFARGS=(--name-only --diff-filter=ACMR)
  # task-26 2a②: 原三处 `git … || true` 在 git 失败时把缓存置空 ⇒ 判定面看到「无变更」= fail-open。
  #   改为捕获 rc：任一处非 0 ⇒ _GIT_DIFF_RC=1，末尾显式降级（HARD_FAIL，本地/CI 一律阻断）。
  _GIT_DIFF_RC=0
  if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "${SYNO_DIFF_BASE:-}" ]; then
    _R="${SYNO_DIFF_BASE}...HEAD"
    GIT_CACHED_NAMES="$(git -c core.quotepath=false diff "${_DIFFARGS[@]}" "$_R" 2>/dev/null)"; [ $? -ne 0 ] && _GIT_DIFF_RC=1
    GIT_CACHED_ADDED_NAMES="$(git -c core.quotepath=false diff --name-only --diff-filter=A "$_R" 2>/dev/null)"; [ $? -ne 0 ] && _GIT_DIFF_RC=1
    GIT_CACHED_DIFF="$(git diff "$_R" 2>/dev/null)"; [ $? -ne 0 ] && _GIT_DIFF_RC=1
  else
    GIT_CACHED_NAMES="$(git -c core.quotepath=false diff --cached "${_DIFFARGS[@]}" 2>/dev/null)"; [ $? -ne 0 ] && _GIT_DIFF_RC=1
    GIT_CACHED_ADDED_NAMES="$(git -c core.quotepath=false diff --cached --name-only --diff-filter=A 2>/dev/null)"; [ $? -ne 0 ] && _GIT_DIFF_RC=1
    GIT_CACHED_DIFF="$(git diff --cached 2>/dev/null)"; [ $? -ne 0 ] && _GIT_DIFF_RC=1
  fi
  GIT_CACHED_ALL_NAMES="$GIT_CACHED_NAMES"
  if [ "$_GIT_DIFF_RC" -ne 0 ]; then
    echo -e "  ${RED}❌ diff 采集降级: git 返回非 0 — 判定面无输入（fail-closed，绝不当作「无变更」）${RESET}"
    mkdir -p "$ROOT/.codex/control-tower/logs" 2>/dev/null || true
    echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"component\": \"pre-commit-diff-cache\", \"reason\": \"git diff 采集失败 (degraded, 非通过)\"}" >> "$ROOT/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true
    HARD_FAIL=$((HARD_FAIL + 1))
  fi
fi
# D962 死分支修复: G10/G11 数据源赋值（原 CHANGED_FILES/STAGED_FILES 全脚本零赋值→恒跳过）
CHANGED_FILES="$GIT_CACHED_ALL_NAMES"; STAGED_FILES="$GIT_CACHED_ALL_NAMES"; STAGED_ALL="$GIT_CACHED_ALL_NAMES"

# ── FIX-015: 「代码字面量」类判定的**按路径**自伤排除（hunk 级 `+++ b/<path>`）──
# 根因（#803 CI 实测 12 处 100% 自伤）: 这些判定扫 $GIT_CACHED_DIFF（本 PR 全 diff），而
#   检查脚本自身的正则/标签/注解、测试夹具的**故意注入**、文档对规则的**引用**，本身就含这些
#   字面量 ⇒ 检查在自己的 diff 上自伤报红（B 类生产真红 = 0 处）。
# 规则: 只有**源面代码文件**的 added 行参与判定；本脚本自身 / tests/** / *.test.* /
#   docs/** / memory/** / .claude/** / task-state/** / *.md|txt|html 一律按路径排除。
# 禁行内字面量白名单（那会把真注入一起放过）——排除只按文件路径，且是 hunk 级。
# ── FIX-013/015 P1（PR #816 verifier 退回）: `_SELF_REL` 必须与 ROOT **同口径**比较 ──
# 缺陷：`ROOT` 来自 `git rev-parse --show-toplevel`（**物理**路径，如 `/private/tmp/x`），
#   而 `BASH_SOURCE[0]` 是**调用串**（如 `/tmp/x/scripts/…`；macOS `/tmp` 是软链 ⇒ 逻辑路径）。
#   前缀不匹配 → 剥离失败 → `_SELF_REL` 仍是绝对路径 → hunk 里的
#   `+++ b/scripts/pre-commit-check.sh` 永不等于 self ⇒ **自伤排除整体失效**
#   （verifier 实测翻转：相对调用 ✅/✅ ↔ 绝对调用 ❌1 处/❌1 处）。
# 修法：两侧都**物理化**（`pwd -P`）后再比 —— 相对 / 绝对 / 软链三种调用串结果一致。
_PHYS_ROOT="$(cd "$ROOT" 2>/dev/null && pwd -P || printf '%s' "$ROOT")"
_SRC_RAW="${BASH_SOURCE[0]}"
_SELF_DIR="${BASH_SOURCE[0]%/*}"
[ "$_SELF_DIR" = "${BASH_SOURCE[0]}" ] && _SELF_DIR="."
_SELF_ABS="$(cd "$_SELF_DIR" 2>/dev/null && pwd -P || printf '%s' "$_SELF_DIR")/${BASH_SOURCE[0]##*/}"
_SELF_REL="$_SELF_ABS"
case "$_SELF_ABS" in
  "$_PHYS_ROOT"/*) _SELF_REL="${_SELF_ABS#"$_PHYS_ROOT"/}" ;;
  # 相对调用且 CWD≠仓根（非典型，但存在脚本被从别处 `bash <相对路径>` 调起的场景）：
  # 落到仓根的相对串，保证 self 与 diff 里的 `b/<rel>` 同口径。
  *) [ -f "$_PHYS_ROOT/$_SRC_RAW" ] && _SELF_REL="$_SRC_RAW" ;;
esac
code_added_lines() {  # @output 仅「源面代码文件」的 added 行（含前导 +）
  # task-26 收窄: 原第 4 条把 `docs/**` **整目录**排除 ⇒ `docs/*.ts|py|sh` 这类**代码**文件
  #   也被跳过 = 判定面漏面（gate-failopen-net T5b 判别对照实测：同正文挂 .ts 头应 ❌ 实得 ✅）。
  #   改为「docs/ 下**非代码扩展名**才跳过」；memory/.claude/task-state 维持整目录跳过（治理产物）。
  awk -v self="$_SELF_REL" '
    /^\+\+\+ / {
      p=$2; sub(/^b\//, "", p)
      skip = (p==self) || (p=="/dev/null") \
          || (p ~ /(^|\/)tests\//) || (p ~ /\.test\.[A-Za-z]+$/) \
          || (p ~ /(^|\/)(memory|\.claude|task-state)\//) \
          || (p ~ /(^|\/)docs\// && p !~ /\.(ts|tsx|js|jsx|py|sh)$/) \
          || (p ~ /\.(md|txt|html|json|yaml|yml|log)$/)
      next
    }
    skip { next }
    /^\+\+\+/ { next }
    /^\+/ { print }
  ' <<< "$GIT_CACHED_DIFF"
}

# ── #11家 CT-34 纯文档早退（豁免，仅 Secrets + 骨架D547 + Notes D472 硬拦）──
DOC_PREFIX_RE='^(docs/.*\.(md|html|txt)$|\.claude/task-briefs/.*\.(md|html|txt)$|memory/.*\.(md|html|txt)$|task-state/.*\.(json|md)$|[^/]+\.(md|html|txt)$)'
# 空暂存=fail-closed 不豁免；非空且全部命中文档前缀=纯文档
# task-26 2a②: 原写法 `[ -z "$(echo … | grep -vE … || true)" ]` 在 grep 失败(rc≥2)时也判纯文档
#   ⇒ **fail-open**（判定失败 ⇒ 静默走豁免通道，跳过绝大多数门禁）。改为 grep 三态：
#   0=有非文档文件 / 1=确无匹配(真·纯文档) / ≥2=判定失败 ⇒ 按非纯文档继续 + 显式降级登记。
DOC_ONLY=0
if [ -n "$STAGED_ALL" ]; then
  _NONDOC="$(printf '%s\n' "$STAGED_ALL" | grep -vE "$DOC_PREFIX_RE")"; _ND_RC=$?
  if [ "$_ND_RC" -eq 0 ]; then
    DOC_ONLY=0
  elif [ "$_ND_RC" -eq 1 ]; then
    DOC_ONLY=1
  else
    DOC_ONLY=0
    echo -e "  ${YELLOW}⚠️  纯文档早退判定降级 — grep rc=${_ND_RC}；按非纯文档继续（fail-closed）${RESET}"
    mkdir -p "$ROOT/.codex/control-tower/logs" 2>/dev/null || true
    echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"component\": \"pre-commit-ct34-doc-only\", \"reason\": \"grep rc=${_ND_RC} — 判定失败，不当作纯文档 (degraded)\"}" >> "$ROOT/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true
    WARN_COUNT=$((WARN_COUNT + 1))
  fi
fi
if [ "$DOC_ONLY" -eq 1 ]; then
  echo "  纯文档提交 (CT-34): 豁免 — 仅 Secrets + Notes"
  EXEMPT_LOG="${SYNO_EXEMPT_LOG:-$ROOT/.claude/exempt.log}"; mkdir -p "$(dirname "$EXEMPT_LOG")" 2>/dev/null || true
  echo "$(date +%Y-%m-%dT%H:%M:%S%z) | EXEMPT | staged=$(echo "$STAGED_ALL" | tr '\n' ',' | sed 's/,$//')" >> "$EXEMPT_LOG" 2>/dev/null || true  # swallow-ok: 豁免审计登记
  if bash "$ROOT/scripts/check-secrets.sh" 2>&1; then
    # D547 骨架 brief 硬拦并入早退路径（纯 brief 提交走不到 CI 区——结构性不可达洞）
    SKEL_EARLY=$(echo "$STAGED_ALL" | grep '^\.claude/task-briefs/.*\.md$' || true)
    for bf in $SKEL_EARLY; do
      if [ -f "$ROOT/$bf" ] && grep -q '认领: <agent>\|<本任务在哪一层' "$ROOT/$bf" 2>/dev/null; then
        echo -e "  ${RED}❌ 骨架 brief 占位符未填（D547）: ${bf} [硬阻断]${RESET}"; exit 1
      fi
    done
    NOTES_TOUCHED_DOC=$(echo "$STAGED_ALL" | grep -E '^memory/notes/proposed/' || true)
    if [ -n "$NOTES_TOUCHED_DOC" ]; then
      if bash "$ROOT/scripts/control-tower/check-notes-lifecycle.sh"; then
        soft_pass "Notes 迁移门禁: proposed/ 无僵尸条目"
      else
        echo -e "  ${RED}❌ Notes 迁移门禁: proposed/ 僵尸条目 [硬阻断]${RESET}"; exit 1
      fi
    fi
    echo -e "  ${GREEN}✅ 纯文档提交豁免检查完成 (CT-34)${RESET}"; exit 0
  else
    echo -e "  ${RED}❌ Secrets 扫描失败 — 提交已拒绝${RESET}"; exit 1
  fi
fi

# ── fastlane 通道（bypass.log 单文件补记，唯一信号源=环境变量——D414 坑: 禁裸看暂存区防误触发）──
if [ "${SYNO_FASTLANE:-0}" = "1" ]; then
  log_gate "fastlane-bypass-only" hit
  if bash "$ROOT/scripts/check-secrets.sh" 2>&1; then
    echo -e "  ${GREEN}✅ Secrets 通过 — 纯补记放行${RESET}"; exit 0
  else
    echo -e "  ${RED}❌ Secrets 失败 — 拒绝${RESET}"; exit 1
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Loop Engineering V5.3 — pre-commit 本地精简版 (D962 2a①)"
echo "═══════════════════════════════════════════════════════════"

# ── #17 主树占用检测（D537 #2 / M8: 本地并行语义，CI 单 runner 无意义）──
_PAR_BLOCK_MSG=""
if [ "${SYNO_SKIP_PARALLEL_GUARD:-0}" != "1" ] && [ "${SYNO_SKIP_PARALLEL_WARN:-0}" != "1" ]; then
  case "$(git rev-parse --git-dir 2>/dev/null || echo '')" in
    *"/.git/worktrees/"*) : ;;
    *)
      _MAIN_DIRTY="$(git -C "$ROOT" status --porcelain 2>/dev/null | head -1 || true)"
      if [ -n "$_MAIN_DIRTY" ] && [ -f "$ROOT/scripts/control-tower/session_registry.py" ]; then
        _ACT_JSON=$("$PYBIN" "$ROOT/scripts/control-tower/session_registry.py" list --active 2>/dev/null </dev/null || true)
        if [ -n "$_ACT_JSON" ]; then
          _ACT_N=$(echo "$_ACT_JSON" | "$PYBIN" -c "
import json,sys,os,datetime
d=json.load(sys.stdin); now=datetime.datetime.now(datetime.timezone.utc)
w=int(os.environ.get('SYNO_PARALLEL_WINDOW','1800'))
def r(s):
    try:
        t=datetime.datetime.fromisoformat(s.get('last_seen_at',''))
        return (now-t.replace(tzinfo=t.tzinfo or datetime.timezone.utc)).total_seconds()<w
    except Exception: return False
print(sum(1 for s in d.get('sessions',[]) if r(s)))
" 2>/dev/null | tr -d '\r\n' || echo "")
          _ACT_N="${_ACT_N//[^0-9]/}"
          if [ -n "$_ACT_N" ] && [ "$_ACT_N" -gt 1 ]; then
            _PAR_BLOCK_MSG="主树脏且 ${_ACT_N} 个活跃 session — 并行互踩风险（M8）: python3 scripts/control-tower/worktree-manager.py create <任务名>"
          fi
        else
          echo -e "  ${YELLOW}⚠️  主树占用检测: registry 不可读 — 降级放行（铁律 11）${RESET}"
        fi
      fi
      ;;
  esac
fi
hard_check "主树占用检测 (D537 #2): 主树脏 + 多活跃 session" "${_PAR_BLOCK_MSG:-}"

# ── #33 绕过审计 7c（D438 强弱信号分离; 本地语义）──
POSSIBLE_COUNT=0; BYPASS_COUNT=0
if [ -f "$BYPASS_LOG" ]; then
  BYPASS_COUNT=$(grep -cE "$(date +%Y-%m-%d).*detected-bypass" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  POSSIBLE_COUNT=$(grep -cE "$(date +%Y-%m-%d).*possible-bypass" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  BYPASS_COUNT=${BYPASS_COUNT//[^0-9]/}; POSSIBLE_COUNT=${POSSIBLE_COUNT//[^0-9]/}
  [ -z "$BYPASS_COUNT" ] && BYPASS_COUNT=0; [ -z "$POSSIBLE_COUNT" ] && POSSIBLE_COUNT=0
fi
if [ "${BYPASS_COUNT:-0}" -ge 3 ]; then
  if [ "${SYNO_GATEKEEPER_ACK:-0}" = "1" ]; then
    echo -e "  ${YELLOW}⚠️  绕过审计: 今日 ${BYPASS_COUNT} 次 — 已人工确认 [告警]${RESET}"
  else
    soft_check "绕过审计: 24h 内 --no-verify ${BYPASS_COUNT} 次 — 已超限" "连续绕过（第 3 次起须修根因；误报可用 SYNO_GATEKEEPER_ACK=1）"
  fi
elif [ "${BYPASS_COUNT:-0}" -ge 2 ]; then
  echo -e "  ${YELLOW}⚠️  绕过审计: 今日 ${BYPASS_COUNT} 次 — 警告${RESET}"
elif [ "${POSSIBLE_COUNT:-0}" -gt 0 ]; then
  echo -e "  ${YELLOW}⚠️  绕过审计: possible-bypass ${POSSIBLE_COUNT} 次（弱信号，U1 推送对账兜底）[告警不阻断]${RESET}"
else
  soft_pass "绕过审计"
fi

# ── #3 硬编码业务数据（CTO 改判保留·本地; linter 化前过渡）──
HARDCODE_DATA=""
STAGED_HTML=$(echo "$STAGED_ALL" | grep -E '\.(html|ts)$' | grep -v node_modules | grep -v '\.test\.' || true)
if [ -n "$STAGED_HTML" ]; then
  for hf in $STAGED_HTML; do
    [ -z "$hf" ] && continue; [ ! -f "$hf" ] && continue
    DEPS=$(grep -n "'marketing'\|'sales'\|'finance'\|'研发部'\|'市场部'\|'销售部'" "$hf" 2>/dev/null | grep -v "import\|export\|//\|/\*\|^\s*\*\|token.split\|dept.*=\|LAYER_EXPERTS\|experts:\|'org'\|'tech'\|'strategy'\|'knowledge'\|'business_model'\|'finance'\|'marketing'\|'sales'\|: \[" | head -3 || true)
    [ -n "$DEPS" ] && HARDCODE_DATA="${HARDCODE_DATA}  ${hf}: 可能硬编码业务数据\n"
  done
fi
soft_check "硬编码业务数据/类型 (#3 保留·本地)" "${HARDCODE_DATA:-}"

# ── #30 禁止新 DiagnosticModule（FIX-015: 判定面 = 源面代码 added 行，按路径排除自伤面）──
# task-26 补回 V5.2.x 的 **grep 三态降级**（V5.3 重写时退化为 `… || true` = 静默吞错，铁律11）:
#   排除模式非法/grep 不可用（rc≥2）⇒ 显式「检查降级」+ degraded-events 登记 + CI strict 计 HARD_FAIL，
#   绝不以静默方式当作通过。判据载体 = tests/control-tower/gate-failopen-net.test.sh T3。
# 注释形态用**行首锚**（`^\+[[:space:]]*(//|/*|*|#)`），不用裸 `//`——裸 `//` 会把
#   代码行内注释前的真命中一并放过（gate-failopen-net T4/T5b 成对判据：注释三形态零误报 ∧ .ts 正文必判 ❌）。
_DIAG_EXCL='@deprecated|import type|^\+[[:space:]]*(//|/\*|\*|#)|hard_check|禁止 ?新? ?DiagnosticModule|不要再使用 DiagnosticModule'
# D390 武装缝: 排除模式覆盖仅 SYNO_TEST_ARM=1 时生效（生产路径忽略该变量，fail-closed — T3f 判据）
if [ "${SYNO_TEST_ARM:-0}" = "1" ]; then
  _DIAG_EXCL="${SYNO_DIAG_EXCL_OVERRIDE:-$_DIAG_EXCL}"
fi
_DIAG_RC=0
if command -v grep >/dev/null 2>&1; then
  NEW_DIAG=$(code_added_lines | grep "DiagnosticModule" | grep -Ev -- "$_DIAG_EXCL"); _DIAG_RC=$?
else
  NEW_DIAG=""; _DIAG_RC=127
fi
if [ "$_DIAG_RC" -ge 2 ]; then
  echo -e "  ${YELLOW}⚠️  禁止新 DiagnosticModule: 检查降级 — grep 不可用或排除模式非法 (rc=${_DIAG_RC})；本项未判定${RESET}"
  mkdir -p "$ROOT/.codex/control-tower/logs" 2>/dev/null || true
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"pre-commit-group7a-diagnosticmodule\", \"reason\": \"grep rc=${_DIAG_RC} — 排除模式非法或 grep 不可用 (degraded, 非通过)\"}" >> "$ROOT/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true
  if [ "${SYNO_CI:-0}" = "1" ]; then
    echo -e "  ${RED}❌ 禁止新 DiagnosticModule: 检查降级  [CI strict——降级即失败]${RESET}"
    HARD_FAIL=$((HARD_FAIL + 1))
  else
    SOFT_COUNT=$((SOFT_COUNT + 1))
  fi
  log_gate "禁止 DiagnosticModule: 新模块须实现 Sentinel 接口" degraded
else
  soft_check "禁止 DiagnosticModule: 新模块须实现 Sentinel 接口" "${NEW_DIAG:-}"
fi

# ── #38 G10 / #39 G11（D260 CP3 — 死分支已修活，首次真实执行）──
MISMATCH=""
CRITERIA_MAP="$ROOT/.codex/criteria-code-map.json"
BRIEF_FILE=$(echo "$CHANGED_FILES" | grep -m1 "\.claude/task-briefs/" || true)
if [ -f "$CRITERIA_MAP" ] && [ -n "$BRIEF_FILE" ] && [ -f "$ROOT/$BRIEF_FILE" ]; then
  CRITERIA=$(grep -oE '#CRITERIA[[:space:]]*[:=：][[:space:]]*[A-D]' "$ROOT/$BRIEF_FILE" 2>/dev/null | sed -E 's/.*[=:：][[:space:]]*//' | head -1 || true)
  if [ -n "$CRITERIA" ]; then
    # task-26 2a②: 原 `… || true` 使 python 失败时 glob 集为空 ⇒ G10 静默走「无映射跳过」= fail-open。
    #   改为捕获 rc：非 0 ⇒ 显式降级（CI strict 转硬），不当作「无映射」。
    # task-32（Windows 二修）: 原「把路径喂给 python」在 Windows 仍失败（native python 打不开 Git-Bash
    #   POSIX 路径；cygpath 前置探测在 CI 腿未生效）。改 **stdin 喂 JSON**：bash 自己开文件
    #   （Git-Bash 路径语义 ✓），python 只读 stdin ⇒ 彻底无路径跨界，三平台同一行为。
    CRITERIA_GLOBS=$(CRITERIA_KEY="$CRITERIA" "$PYBIN" -c "
import json, os, sys
try: print('\n'.join(json.load(sys.stdin).get('criteria',{}).get(os.environ['CRITERIA_KEY'],{}).get('glob',[])))
except Exception: pass
" < "$CRITERIA_MAP" 2>/dev/null); _CG_RC=$?
    if [ "$_CG_RC" -ne 0 ]; then
      soft_check "G10: criteria-map 解析降级（$PYBIN rc=${_CG_RC}，不当作无映射）" "1"
      echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"component\": \"pre-commit-g10-criteria-globs\", \"reason\": \"python rc=${_CG_RC} (degraded, 非通过)\"}" >> "$ROOT/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true
    fi
    REGEX_GLOBS=$(echo "$CRITERIA_GLOBS" | sed 's/\*/.*/g; s/?/./g' | grep -v '^$' | paste -sd'|' -)
    if [ -n "$REGEX_GLOBS" ]; then
      for sf in $STAGED_FILES; do
        [ -n "$sf" ] && ! echo "$sf" | grep -qE "($REGEX_GLOBS)" && MISMATCH="${MISMATCH}  $sf (不在条件 $CRITERIA 映射区域)\n"
      done
      if [ -n "$MISMATCH" ]; then warn_check "G10: 条件区域不匹配" "$MISMATCH"; else soft_pass "G10: 条件区域检查通过 ($CRITERIA)"; fi
    else soft_pass "G10: 条件 $CRITERIA 无映射区域(跳过)"
    fi
  else soft_pass "G10: 无条件归属(跳过)"
  fi
else soft_pass "G10: 无 task brief 变更或无映射(跳过)"
fi
HAS_E2E=0; HAS_TESTS=0
BRIEF_ID=$(echo "$STAGED_FILES" | grep -oE '\.claude/task-briefs/[^.]+' | sed -E 's|^\.claude/task-briefs/||' | head -1 || true)
if [ -n "$BRIEF_ID" ] && [ -f "$ROOT/.claude/task-briefs/${BRIEF_ID}.md" ]; then
  HAS_E2E=$(grep -c "端到端\|e2e\|curl.*200\|HTTP.*200" "$ROOT/.claude/task-briefs/${BRIEF_ID}.md" 2>/dev/null | tr -d '\n\r' || echo 0)
  HAS_TESTS=$(echo "$STAGED_FILES" | grep -c "\.test\.ts" 2>/dev/null | tr -d '\n\r' || true)
  HAS_E2E=${HAS_E2E//[^0-9]/}; HAS_TESTS=${HAS_TESTS//[^0-9]/}
  [ -z "$HAS_E2E" ] && HAS_E2E=0; [ -z "$HAS_TESTS" ] && HAS_TESTS=0
  if [ "${HAS_E2E:-0}" -gt 0 ] && [ "${HAS_TESTS:-0}" -eq 0 ]; then
    warn_check "G11: 声明端到端验收但无测试文件" "$BRIEF_ID 声明端到端验收，暂存区无测试文件"
  else
    soft_pass "G11: 测试覆盖检查通过"
  fi
else
  soft_pass "G11: 无 task brief 变更(跳过)"
fi

# ── Secrets 全路径（#11 CI 权威侧; 保留脚本单点）──
if bash "$ROOT/scripts/check-secrets.sh" 2>&1 >/dev/null; then
  soft_pass "Secrets 扫描（全工作区）"
else
  echo -e "  ${RED}❌ Secrets 扫描失败${RESET}"; HARD_FAIL=$((HARD_FAIL + 1)); log_gate "Secrets 扫描" hit
fi

# ── D520/任务3: 平台敏感命令软检查（V5 软提示——新增脚本须对照 PLATFORM-CHECKLIST.md）──
# task-28 裁定⑤ 接回：V5.3 重写时该块被移除且无落点（红线真警报）。**原位恢复**（本地软 + SYNO_CI=1 转硬）——
#   实测：若只放 CI 权威区，则 platform-checklist.test.sh 的本地行为断言（SYNO_CI=0 下须点名裸 python3 探针）必红。
# 只查本次新增（A）的 scripts/control-tower|workflow 下的 .sh/.py 文件：
#   裸 python3（非 PYBIN 模式）/ date +%s / date -v / grep -P → 提示见 checklist。
if [ -f "$ROOT/scripts/control-tower/PLATFORM-CHECKLIST.md" ]; then
  _PLAT_NEW=$(echo "$GIT_CACHED_ADDED_NAMES" | grep -E '^scripts/(control-tower|workflow)/.*\.(sh|py)$' || true)
  _PLAT_HITS=""
  if [ -n "$_PLAT_NEW" ]; then
    while IFS= read -r _pf; do
      [ -z "$_pf" ] && continue; [ ! -f "$ROOT/$_pf" ] && continue
      _pf_hits=$(grep -nE '\bpython3\b|date \+%s|date -v|grep -P' "$ROOT/$_pf" 2>/dev/null | grep -v 'PYBIN\|swallow-ok\|D520\|#' | head -3 || true)  # grep-P-scan-ok: 本行是 -P 检测器自身（模式字面量，非调用）
      [ -n "$_pf_hits" ] && _PLAT_HITS="${_PLAT_HITS}  ${_pf}: 平台敏感命令（见 PLATFORM-CHECKLIST.md）\n"
    done <<< "$_PLAT_NEW"
  fi
  soft_check "V5 平台敏感命令: 新控制塔脚本对照 PLATFORM-CHECKLIST.md (D520)" "${_PLAT_HITS:-}"
else
  soft_pass "V5 平台检查: PLATFORM-CHECKLIST.md 不存在(跳过)"
fi

# ═════ CI 权威区（SYNO_CI=1 才执行；本地零成本跳过 <1s）═══════
# 迁 CI 34 项回归集紧凑内联（铁律38/桥接/接线/D296/D547）；完整 13 组语义由 iron-laws ::error 承担。
if [ "${SYNO_CI:-0}" = "1" ]; then
  echo -e "${CYAN}── CI 权威区（D962 迁移判定）──${RESET}"
  # 铁律38: as any / as never / as unknown as（跳注释行；FIX-015: 判定面 = 源面代码 added 行）
  M=$(code_added_lines | grep -E 'as (any|never)\b|as unknown as' | grep -vE '^\+\s*(//|/\*|\*|#)' || true)
  soft_check "as any / as never / as unknown as 零容忍（铁律38）" "$M"
  # 铁律46: engine-core 引用（白名单外; 含相对路径三重匹配）
  BRIDGE_FAIL=""
  for file in $(echo "$STAGED_ALL" | grep -E '^(src|packages)/.*\.ts$' | grep -v '\.test\.' | grep -vE 'src/init/engine-context\.ts|src/l4/graph-bridge\.ts|src/l4/diagnosis-graph-query\.ts' || true); do
    [ -f "$file" ] && grep -qE "packages/engine-core|\.\./engine-core|\.\./\.\./engine-core" "$file" 2>/dev/null && BRIDGE_FAIL="${BRIDGE_FAIL}  ${file}: 引用 engine-core (铁律46)\n"
  done
  soft_check "铁律46: 桥接/包级 engine-core 引用" "${BRIDGE_FAIL:-}"
  # 接线（铁律4/5: 新 export 须被引用——物理事实）
  NEW_IMPL=$(echo "$GIT_CACHED_ADDED_NAMES" | grep -E "^src/|^extensions/" | grep "\.ts$" | grep -v "\.test\." | grep -v "\.d\.ts" | grep -v "types\.ts$\|index\.ts$\|helpers\.ts$" || true)
  UNWIRED=""
  for file in $NEW_IMPL; do
    [ -f "$file" ] || continue
    for name in $(grep -oE 'export (function|class|const) [A-Za-z_][A-Za-z0-9_]*' "$file" 2>/dev/null | sed -E 's/^export (function|class|const) //' || true); do
      echo "$name" | grep -qi 'mock\|fake\|_internal\|_deprecated' && continue
      WIRED=$(grep -rn "\b${name}\b" src/ --include="*.ts" 2>/dev/null | grep -v "export.*${name}" | grep -v "$file" | grep -v "\.test\." | head -1 || true)
      [ -z "$WIRED" ] && UNWIRED="${UNWIRED}${file}: export ${name} — 未被引用\n"
    done
  done
  soft_check "接线审计: 新 export 必须被引用 (铁律4/5)" "${UNWIRED:-}"
  # D296/D749 G12 认领制写集（brief_parser 单源 + D506 ±1 天窗 + 认领制 v2）
  # task-26: python 不可用 → **fail-closed 显式降级**。原实现（V5.3）在 $PYBIN 为空/失败时
  #   命令替换产出空集 ⇒ SCOPE_VIOLATION 恒空 ⇒ 打印「所有文件均在 Q2 范围内」= 静默假绿
  #   （铁律 11 静默降级禁止；旧 V5.2.x 有单日 glob 回退，重写时丢失）。此处补显式三态分支。
  if [ -z "$PYBIN" ]; then
    soft_check "G12: 无可用 python — fail-closed（不静默当作范围全通过，D328 三态）" "fail-closed"
  else
  SCOPE_TSV=$(mktemp); EXCL_TSV=$(mktemp)
  # （路径→python 的转换统一用脚本首部的 _TO_PY，见上）
  SCOPE_TSV_PY="$(_TO_PY "$SCOPE_TSV")"; EXCL_TSV_PY="$(_TO_PY "$EXCL_TSV")"
  for B in $("$PYBIN" -c "
import datetime,glob,os
t=datetime.date.today()
print('\n'.join(f.replace(os.sep,'/') for k in (-1,0,1) for f in glob.glob('.claude/task-briefs/%s-*.md' % (t+datetime.timedelta(days=k)).isoformat())))
" 2>/dev/null); do
    [ -f "$B" ] || continue
    "$PYBIN" "$ROOT/scripts/control-tower/brief_parser.py" --q2-include "$B" 2>/dev/null | sed "s|^|$(basename "$B")\\t|" >> "$SCOPE_TSV" || true
    "$PYBIN" "$ROOT/scripts/control-tower/brief_parser.py" --q2-exclude "$B" 2>/dev/null | sed "s|^|$(basename "$B")\\t|" >> "$EXCL_TSV" || true
  done
  SCOPE_VIOLATION=$(STAGED_ALL="$STAGED_ALL" SCOPE_TSV="$SCOPE_TSV_PY" EXCL_TSV="$EXCL_TSV_PY" "$PYBIN" -c "
import os, re, sys
def load(p):
    out = []
    try:
        for line in open(p, encoding='utf-8'):
            if '\t' in line:
                b, q = line.rstrip('\n').split('\t', 1)
                if q: out.append((b, q))
    except OSError: pass
    return out
scope, excl = load(os.environ['SCOPE_TSV']), load(os.environ['EXCL_TSV'])
m = lambda path, pat: re.search(r'(^|/)' + re.escape(pat) + r'\$', path)
skip_re = re.compile(r'\.claude/|scripts/workflow/|\.codex/|memory/|docs/|task-state/.*\.(json|md)\$|\.github/')
code_re = re.compile(r'\.(ts|tsx|js|jsx|json|py|sh)\$')
viol = []
try:
    for sf in (x.strip() for x in os.environ['STAGED_ALL'].split('\n')):
        if not sf or skip_re.search(sf) or not code_re.search(sf): continue
        claim = [b for b, p in scope if m(sf, p)]
        if not claim: viol.append('  %s (不在 Q2 范围内)' % sf); continue
        for b, ex in excl:
            if b in claim and m(sf, ex):
                viol.append('  %s (Q2 排除项禁止修改: %s, 来自 %s)' % (sf, ex, b)); break
except Exception as e:   # task-26 2a②: 原实现静默吞（外层无 try + bash 吞错）⇒ 判定失败变「范围全通过」
    sys.stderr.write('DEGRADED: %s\n' % e); sys.exit(2)
print('\n'.join(viol))
" 2>/dev/null); _SV_RC=$?
  rm -f "$SCOPE_TSV" "$EXCL_TSV"
  if [ "$_SV_RC" -ne 0 ]; then
    soft_check "G12: 写集判定执行失败（$PYBIN rc=${_SV_RC}）— fail-closed，不当作范围全通过" "1"
  elif [ -n "$SCOPE_VIOLATION" ]; then
    soft_check "G12: Q2 范围一致性（D296/D749）" "$SCOPE_VIOLATION"
  else
    soft_pass "G12: 所有文件均在 Q2 范围内"
  fi
  fi
  # D547 骨架 brief 占位符（第三次复发 → 物理硬阻断）
  SKEL_BRIEF=""
  for bf in $(echo "$STAGED_ALL" | grep -E '^\.claude/task-briefs/.*\.md$' || true); do
    [ -f "$ROOT/$bf" ] && grep -q '认领: <agent>\|<本任务在哪一层' "$ROOT/$bf" 2>/dev/null && SKEL_BRIEF="${SKEL_BRIEF}  ${bf}（骨架占位符未填）\n"
  done
  hard_check "骨架 brief 占位符检测（D547）" "${SKEL_BRIEF:-}"

  # ═══ D782: 文档真相防线 D1/D2（本块即 W1/W2 接线断言的落点）═══
  # 背景: K3 2026-09-14 §7.2 收割 2/3 —— D1 check-doc-truth.sh 与 D2 doc-registry-gate.sh
  #   建成即零调用（M3「机制建成未接线」）；D782（3622a3d1）补调用点使 W1/W2 转绿。
  # D962 2a①（0889eb16）重写时该块**被移除且未落 CI 侧** ⇒ W1/W2 断言红（真警报）。
  # task-26 按 plan §一 #47「check-doc-truth 保留，调用随 33 项迁 CI」接入 **CI 权威区**：
  #   活点 = `iron-laws` job（ci.yml:111，无 needs）——本块三态: 0过 / 1判定红（SYNO_CI=1 转硬）
  #   / 其它=执行失败显式降级（D328，不静默当作通过）。
  echo -e "${CYAN}── D782: 文档真相防线（D1 真相验证 + D2 登记门禁）──${RESET}"
  if [ -f "$ROOT/scripts/doc-system/check-doc-truth.sh" ]; then
    DOC_TRUTH_OUT="$(bash "$ROOT/scripts/doc-system/check-doc-truth.sh" 2>&1)"; DOC_TRUTH_EXIT=$?
    _ANSI=$'\033'
    if [ "$DOC_TRUTH_EXIT" -eq 0 ]; then
      soft_pass "D1 文档真相: 全部硬检查通过 ($(printf '%s' "$DOC_TRUTH_OUT" | grep -c '✅' || true) ✅)"
    elif [ "$DOC_TRUTH_EXIT" -eq 1 ]; then
      DOC_TRUTH_FAILS="$(printf '%s' "$DOC_TRUTH_OUT" | grep '❌' | sed "s/${_ANSI}\\[[0-9;]*m//g" | sed 's/^ *//' || true)"
      soft_check "D1 文档真相: 导航层文档与代码事实不一致 — 修正后重试（bash scripts/doc-system/check-doc-truth.sh）" "$DOC_TRUTH_FAILS"
    else
      soft_check "D1 文档真相: 检查执行失败 (exit=$DOC_TRUTH_EXIT, D328 三态)" "exit=$DOC_TRUTH_EXIT"
    fi
  else
    soft_check "D1 文档真相: 脚本缺失 scripts/doc-system/check-doc-truth.sh" "1"
  fi
  # D2 输入集 = untracked 新增 + git add 未提交的新增（脚本契约如此）。
  #   ⚠ 已知空转面（如实登记，不当作加分）: CI checkout 两者皆空 ⇒ 本项在 CI 恒过（0 文档）；
  #   要 CI 真判需给 doc-registry-gate.sh 加 PR-diff 输入缝（scripts/doc-system/ 不在本卡写集）。
  if [ -f "$ROOT/scripts/doc-system/doc-registry-gate.sh" ]; then
    DOC_REG_OUT="$(bash "$ROOT/scripts/doc-system/doc-registry-gate.sh" 2>&1)"; DOC_REG_EXIT=$?
    if [ "$DOC_REG_EXIT" -eq 0 ]; then
      soft_pass "D2 登记门禁: $(printf '%s' "$DOC_REG_OUT" | grep '汇总' | sed 's/^ *//' || true)"
    elif [ "$DOC_REG_EXIT" -eq 1 ]; then
      DOC_REG_FAILS="$(printf '%s' "$DOC_REG_OUT" | grep '未登记' | sed 's/^ *//' || true)"
      soft_check "D2 登记门禁: 有未登记文档 — 登记 docs/authority/DOCS-REGISTRY.yaml 或核对排除规则" "$DOC_REG_FAILS"
    else
      soft_check "D2 登记门禁: 检查执行失败 (exit=$DOC_REG_EXIT, D328 三态)" "exit=$DOC_REG_EXIT"
    fi
  else
    soft_check "D2 登记门禁: 脚本缺失 scripts/doc-system/doc-registry-gate.sh" "1"
  fi

  # ═══ task-28 裁定④⑥⑦：三处判定面接回 CI 权威区（活点 = iron-laws job）═══
  # ④ CT-40: 控制塔脚本 ↔ 配对测试（原 pre-commit 组2d，V5.3 重写时被移除且无落点）
  if [ ! -f "$ROOT/scripts/control-tower/ct-test-gate.sh" ]; then
    soft_check "CT-40 控制塔脚本测试配对: 门禁脚本缺失" "1"
  else
    # task-30 P0：diff 基**先验证存在**再传（Gate Integrity 的干净副本无 origin/main ⇒
    #   原写法使门禁 rc=2 degraded ⇒ baseline 场景假红）。基不存在 ⇒ 空值 ⇒ 门禁回落暂存区（空 ⇒ SYNC-OK 跳过）。
    _CT40_BASE=""
    if [ -n "${SYNO_DIFF_BASE:-}" ] && git rev-parse --verify -q "${SYNO_DIFF_BASE}" >/dev/null 2>&1; then _CT40_BASE="$SYNO_DIFF_BASE"; fi
    _CT40_OUT="$(SYNO_CT_DIFF_BASE="$_CT40_BASE" bash "$ROOT/scripts/control-tower/ct-test-gate.sh" 2>&1)"; _CT40_RC=$?
    if [ "$_CT40_RC" -eq 0 ]; then
      soft_pass "CT-40 控制塔脚本测试配对: $(printf '%s' "$_CT40_OUT" | head -1)"
    else
      # 反 fail-open：失败载荷必须非空（否则 soft_check 空匹配会打 ✅ —— 实测 rc=127 时踩到）
      _CT40_FAILS="$(printf '%s' "$_CT40_OUT" | grep -v '^SYNC-OK')"
      [ -z "$_CT40_FAILS" ] && _CT40_FAILS="rc=${_CT40_RC}（无输出；见 CT-40 门禁原始退出码）"
      soft_check "CT-40 控制塔脚本测试配对（rc=${_CT40_RC}）" "$_CT40_FAILS"
    fi
  fi

  # ⑥ 铁律 47: 声称完成须 grep 物理证明（D541 收窄版；task-28 裁定⑥ 按 V5.2.x :775 原文接回）
  CLEANUP_CLAIM=""
  BRIEF=$(bash "$ROOT/scripts/workflow/resolve-commit-brief.sh" "$STAGED_ALL" 2>/dev/null || true)
  if [ -n "$BRIEF" ] && [ -f "$BRIEF" ]; then
    if grep -qi "已拆\|已迁移\|已清理\|拆分.*完成\|迁移.*完成\|清理.*完成\|完成.*拆分\|完成.*迁移\|完成.*清理" "$BRIEF" 2>/dev/null; then
      CLEANUP_CLAIM="task brief 声称拆分/迁移/清理完成 — 请确认 grep -r 'packages/engine-core' src/ 零结果"
    fi
  fi
  warn_check "铁律 47: 声称完成须 grep 物理证明" "${CLEANUP_CLAIM:-}"

  # ⑦ D945: 预设 bundle 源形态校验（原脚本零生产调用 = M3；task-28 裁定⑦ wire）
  if [ ! -f "$ROOT/scripts/control-tower/check-preset-bundles.sh" ]; then
    soft_check "D945 预设 bundle 源校验: 脚本缺失" "1"
  else
    _PB_OUT="$(bash "$ROOT/scripts/control-tower/check-preset-bundles.sh" --repo 2>&1)"; _PB_RC=$?
    if [ "$_PB_RC" -eq 0 ]; then
      soft_pass "D945 预设 bundle 源形态: $(printf '%s' "$_PB_OUT" | grep -m1 '汇总')"
    else
      # 反 fail-open：失败载荷非空保证计红（实测：脚本缺失时 rc=127、grep 无命中 → 曾打 ✅）
      _PB_FAILS="$(printf '%s' "$_PB_OUT" | grep -E 'DRIFT|STALE|RUNTIME-ONLY|LEGACY|WARN|degraded|违规')"
      [ -z "$_PB_FAILS" ] && _PB_FAILS="rc=${_PB_RC} — $(printf '%s' "$_PB_OUT" | head -2 | tr '\n' ' ')"
      soft_check "D945 预设 bundle 源校验（rc=${_PB_RC}）" "$_PB_FAILS"
    fi
  fi
fi

# ── D943: DSH 断面一致性（唯一源 DSH-断面.json；条件块外防 M1；--no-tree-check——带树校验归 daily-cto-board）──
if [ -z "$PYBIN" ]; then
  soft_check "DSH 断面一致性 (D943): 无可用 python（fail-closed，不静默跳过）" "1"
elif [ ! -f "$ROOT/scripts/control-tower/check-dsh-anchor.py" ]; then
  soft_check "DSH 断面一致性 (D943): 门禁脚本缺失 scripts/control-tower/check-dsh-anchor.py" "1"
else
  _DSH_ANCHOR_OUT="$("$PYBIN" "$ROOT/scripts/control-tower/check-dsh-anchor.py" --repo "$ROOT" --no-tree-check 2>&1)"
  _DSH_ANCHOR_RC=$?
  if [ "$_DSH_ANCHOR_RC" -eq 0 ]; then _DSH_ANCHOR_HITS=""; else _DSH_ANCHOR_HITS="$(printf '%s' "$_DSH_ANCHOR_OUT" | tail -8) (rc=$_DSH_ANCHOR_RC)"; fi
  soft_check "DSH 断面一致性 (D943)" "${_DSH_ANCHOR_HITS}"
fi

# ── CP3 检查点（三态化: python 失败→显式降级登记，替换原 || true 吞错）──
G10_FAIL=$([ -n "$MISMATCH" ] && echo "true" || echo "false")
G11_FAIL=$([ "${HAS_E2E:-0}" -gt 0 ] && [ "${HAS_TESTS:-0}" -eq 0 ] && echo "true" || echo "false")
CP3_STATUS="pass"; CP3_REASON="全部通过"
if [ "$G10_FAIL" = "true" ]; then CP3_STATUS="warn"; CP3_REASON="有条件区域不匹配"; fi
if [ "$G11_FAIL" = "true" ]; then CP3_STATUS="warn"; CP3_REASON="有验收无测试"; fi
mkdir -p "$ROOT/.codex/checkpoints"
if "$PYBIN" -c "
import json
d = {'name':'CP3: 预提交检查','status':'$CP3_STATUS','reason':'$CP3_REASON','checkedAt':'$(date -u +%Y-%m-%dT%H:%M:%SZ)'}
open('$ROOT/.codex/checkpoints/cp3-commit-check.json','w').write(json.dumps(d))
"; then
  :
else
  CP3_STATUS="degraded"
  echo -e "  ${YELLOW}⚠️  CP3 检查点写入失败 — 降级登记（铁律 11，不静默）${RESET}"
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"component\": \"cp3-checkpoint\", \"reason\": \"python 写入失败，CP3=$CP3_STATUS 未落盘\"}" >> "$ROOT/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true  # swallow-ok: 降级登记
  WARN_COUNT=$((WARN_COUNT + 1))
fi

# ═══════════ 结果 ═══════════
echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$HARD_FAIL" -gt 0 ]; then
  echo -e "  ${RED}❌ ${HARD_FAIL} 组未通过 — 提交已拒绝${RESET}"
  [ "${GITHUB_ACTIONS:-}" = "true" ] && echo "::error title=IronLaws:提交已拒绝::${HARD_FAIL} 组未通过（详见上方 ❌ 行）"
  _TAIL="exit 1"
else
  echo -e "  ${GREEN}✅ 本地清单通过（D962 2a① 终态；33 项判定见 CI iron-laws）${RESET}"
  _TAIL="exit 0"
fi
[ "$WARN_COUNT" -gt 0 ] && echo -e "  ${YELLOW}⚠️  ${WARN_COUNT} 项警告${RESET}"
[ "$SOFT_COUNT" -gt 0 ] && echo -e "  ${YELLOW}⚠ V5: ${SOFT_COUNT} 项软提示——CI 为权威${RESET}"
echo "═══════════════════════════════════════════════════════════"; echo ""; $_TAIL
