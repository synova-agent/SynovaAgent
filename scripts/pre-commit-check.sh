#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# Loop Engineering V4.5.1 — pre-commit 12 组硬阻断 (全部 <10s) + 免疫系统
# D515 / V5.0.0: 提交端硬阻断收敛到 4 道质量根（as any / 测试配对+expect / Secrets /
#   接线物理事实）+ 特例 G12d 生成物单点（D458）与 G13 技能同步（D370）保持硬阻断。
#   其余检查 hard_check → soft_check：判定代码与输出原样保留（--check 报告与 K3
#   审计依赖），只是本地不再阻断——CI Iron Laws job 为权威（ci.yml 已有）。
#   保留理由（防未来误删）：G12d 防 CI 单点产物污染（D429/D452/D455 实证）、
#   G13 防双目录漂移（误报率低、命中即真事故）。
#   命中统计（项4）：hard_check/soft_check 每次触发追加 JSONL 到 .claude/gate-hits.log，
#   由 scripts/control-tower/gate-stats.sh 汇总（月度清理数据地基）。
#
# v3.6 → v3.8 核心变化 (2026-06-23):
#   + plan.json 支持: 分阶段任务可 deferred wiring/test_pairing 检查
#   + 双日志: pre-commit-failures.log (门禁正常拒绝) vs bypass.log (--no-verify 绕过)
#   + as any 跳过注释行 (不再把 "Iron law #38: as any = 0" 误报为违规)；CT-46 扩 as never / as unknown as
#   + bash 退位: 只做物理验证 (符号存在? 文件存在? 语法合法?)
#   + agent 进位: 语义判断 (调用链正确? 降级诚实? 阶段合理?)
#
# 13 组:
#   1. 类型安全 + 硬编码数据    (as any / as never / as unknown as 跳过注释行 + 硬编码业务字段)
#   2. 测试质量                  (catch 无 log + 测试配对[可 deferred] + 桩测试)
#   3. Secrets                   (全工作区 + .claude/ + 暂存区 + .env)
#   4. 接线完整性               (new export 有调用方[可 deferred] + 接线深度)
#   5. 架构边界 + 桥接文件      (跨层引用 + 铁律 46/47)
#   6. Task Brief                (存在 + 6 核心字段: Q0/Q1/Q2/Q3/架构层/Done)
#   7. 架构合规                  (DiagnosticModule + 专家配置 + 数据流)
#   8. 文件驱动架构完整性       (manifest/tags/回归/目录/feature-flag)
#   9. 契约门禁 NEW (D257)       (.codex/contracts/*.json 声明 vs staged 比对)
#  13. 技能同步一致性            (.claude/skills ↔ .dsh/skills 漂移, 调用 sync-dsh-skills.sh --check)
#
# 设计哲学:
#   bash 只回答"物理事实" — 符号被引用过吗？文件存在吗？
#   agent 自检回答"语义判断" — 引用在正确的调用链中吗？
#   plan.json 声明"架构步骤" — 这个文件接线在后续阶段
# ═══════════════════════════════════════════════════════════════════════════════
set +e

HARD_FAIL=0
WARN_COUNT=0
SOFT_COUNT=0
SOFT_COUNT=0
SOFT_COUNT=0
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
# D1148: 成功静默开关（**赋値点必须在 47 行之后**——ci-strict-visible.test.sh
#   用 `sed -n '42,44p;47p'` 提取计数器/颜色行后单独 source；赋值行不被提取 ⇒
#   该片段里 QUIET_SUCCESS 为空 ⇒ ${QUIET_SUCCESS:-0} 走**打印**语义（夹具断言 ✅）。
QUIET_SUCCESS="${SYNO_QUIET_SUCCESS:-1}"
# ═══ 注释外移留痕（2026-10-16 · 门禁瘦身 · CTO 裁定 122）═══
# 本件形状：**2093 → 1406 行**（净 −687）。**零代码改动**，逐项可核（`git diff -U0 49ddc63ee`）：
#     · 删：注释整行 **707** ＋ 冗余空行 **13**      · 增：本留痕头 **21 行** ＋ 空行 3
#     · **非注释非空行：删除 0 行、新增 0 行** ⇒ 判定文本一字未增未删
# 判据（🔴 **强判据，不是单靠投影**；升级因：独立复核实证「投影」对**多行字符串内的 `#` 行**会假绿）：
#     ① `git diff -U0` 分类：非注释非空行的增删 = **0**（上面那行）
#     ② 被删行 ∩ 「多行字符串/heredoc 区间内的行」 = **0**（本件零 heredoc）
#     ③ 剥掉注释整行与空行后的"代码投影"**逐字节一致**（sha256 双方同值）
# 判据逻辑 / 退出码 / 组编号 / CI 硬阻断语义**一律未动**（改门禁语义归 CTO 裁定 + K3 过审）。
# 被移出的注释原文（理由 / 留痕 / 历史沿革）**未丢**，两处可追：
#   ① handbook 归档 `2026-10-16-pre-commit-check.sh-注释外移原文.md`（逐字照录 **707 条**，带改前行号；
#      注：重复文本（如 `# ═══` 分隔线）的"行号归属"以 git diff 为准，不逐条声称"位置可复现"）
#   ② git 历史 `49ddc63ee`:scripts/pre-commit-check.sh（改前真值）
# 下列内容**必须保留**（仓库内夹具按字面 / 行号 / 标记抓取，删了即红；逐条已实证）：
#   · 第 42,43,44,47 行 ── ci-strict-visible.test.sh:30 按**绝对行号** sed 提取
#   · 旁路计数段的 BEGIN/END 标记注释 ── bypass-rewrite-classify.test.sh:134 按 marker 抽段
#   · 今日 brief 计数函数的用法注释 ── today-by-name.test.sh:149
#     （⚠️ **契约字面保留，非实证必需**：该夹具在本机更早处即因 `DAY_WINDOW_RE` 未定义死红；
#      且 :149 数的是 `today_files_by` 调用数（改前/改后均 18，阈值 4）⇒ 此条不构成"删了即红"的证据）
#   · G12 fail-open 自述注释 ── precommit-groups-injection.test.sh:399
#   · 平台敏感检查段头（D520 相关） ── platform-checklist.test.sh:33
#   · CT-34 纯文档早退标记注释 ── check-doc-contract.test.sh:77（🔴 **顺序敏感**：必须在接线行**之前**）
#   · CI strict 可见性修复标记（两处） ── ci-strict-visible.test.sh:40（要求计数 ≥2）
#   · G12c 退役留痕（须与 D1219 同现） ── doc-commit-exempt.test.sh:239
#   · 暂存区盲区坑注释 ── fastlane-bypass-only.test.sh:27
#   · 骨架 brief 占位符检测留痕 ── skeleton-brief-gate.test.sh:35
#   · D1148 / D1219 各留 1 行 ── hard-gate-convergence.test.sh:93,133
#   · D537r2 段范围起锚注释 ── parallel-main-tree-occupancy.test.sh:36（awk 段抽取起点）
# ⚠️ 本留痕头**不得引用**任何被"**顺序**断言"绑定的字面量（否则头自身会插到锚点之前 ⇒ 假红）。
# ⚠️ 补充：写 `|<` 之类的输出重定向不在本件（无 heredoc）；本头的 `**` 加粗是**注释文本**，不进代码投影。
# ═══════════════════════════════════════════════════════════════════════════════


# ═══ D1148（批 3）: 声明类门禁 15 → 3（降噪，改坏即红）═══

hard_check() {
  local name="$1" matches="$2"
  local count=0
  [ -n "$matches" ] && count=$(echo "$matches" | grep -c . 2>/dev/null) || count=0
  if [ "$count" -gt 0 ]; then
    echo -e "  ${RED}❌ ${name}: ${count} 处  [硬阻断]${RESET}"
    echo "$matches" | head -8 | while read -r line; do [ -n "$line" ] && echo "     ${line}"; done
    if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
      _first=$(echo "$matches" | head -1 | tr -d '%' | cut -c1-300)
      echo "::error title=IronLaws:${name}::${_first}"
    fi
    HARD_FAIL=$((HARD_FAIL + 1))
    log_gate "$name" hit
  else
    [ "${QUIET_SUCCESS:-0}" != "1" ] && echo -e "  ${GREEN}✅ ${name}${RESET}"
    log_gate "$name" miss
  fi
}

soft_pass() {
  local name="$1"
  [ "${QUIET_SUCCESS:-0}" != "1" ] && echo -e "  ${GREEN}✅ ${name}${RESET}"
  return 0
}

log_gate() {
  local g="$1" r="$2"
  [ -z "$g" ] && return 0
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"gate\": \"${g}\", \"result\": \"${r}\", \"branch\": \"${_GATE_BRANCH}\"}" >> "${GATE_HITS_LOG}" 2>/dev/null || true  # swallow-ok: 统计写失败不阻断提交
}

_SANDBOX=0
[ -n "${SYNO_TASK_STATE_DIR:-}" ] && _SANDBOX=1
[ -n "${SYNO_BRIEF_DIR:-}" ] && _SANDBOX=1
[ -n "${SYNO_TEST_ARM:-}" ] && _SANDBOX=1
[ -n "${SYNO_GIT_CACHED_ADDED_NAMES:-}" ] && _SANDBOX=1
decl_check() {
  if [ "$_SANDBOX" = "1" ]; then
    soft_check "$1（沙箱夹具，降级）" "$2"
  else
    hard_check "$1" "$2"
  fi
}

soft_check() {
  local name="$1" matches="$2"
  local count=0
  [ -n "$matches" ] && count=$(echo "$matches" | grep -c . 2>/dev/null) || count=0
  if [ "$count" -gt 0 ]; then
    # D542: CI strict 下必须显示 ❌（此前显示 ⚠️ 导致「N 组未通过」在日志中找不到对应组——M1 类失败不点名）
    if [ "${SYNO_CI:-0}" = "1" ]; then
      echo -e "  ${RED}❌ ${name}: ${count} 处  [CI strict——软提示在 CI 上为硬阻断]${RESET}"
      HARD_FAIL=$((HARD_FAIL + 1))  # D516 CI strict
    else
      echo -e "  ${YELLOW}⚠️  ${name}: ${count} 处  [V5 软提示——CI 为权威，本地不阻断]${RESET}"
      SOFT_COUNT=$((SOFT_COUNT + 1))
    fi
    echo "$matches" | head -8 | while read -r line; do [ -n "$line" ] && echo "     ${line}"; done
    log_gate "$name" hit
  else
    [ "${QUIET_SUCCESS:-0}" != "1" ] && echo -e "  ${GREEN}✅ ${name}${RESET}"
    log_gate "$name" miss
  fi
}

note_check() {
  local name="$1" detail="$2"
  [ -z "$detail" ] && return 0
  echo -e "  ${YELLOW}ℹ️  ${name}（旁路观测，不阻断）${RESET}"
  printf '%s\n' "$detail" | head -3 | while read -r line; do [ -n "$line" ] && echo "     ${line}"; done
  return 0
}

bypass_run() {
  local _bn="$1"; shift
  local _bo _brc
  _bo="$("$@" 2>&1)"; _brc=$?
  [ "$_brc" -eq 0 ] && return 0
  note_check "${_bn} (exit=${_brc})" "$_bo"
  return 0
}

# ═══ D1219（卡 #1225 旁路清场）: 检查自身失败态 ═══
self_fail_missing_script() {
  local _name="$1" _path="$2"
  echo -e "  ${RED}❌ ${_name}: 检查自身失败（脚本缺失，非内容违规）— ${_path} 不存在${RESET}"
  echo "     修复: 恢复该脚本；或若已合法退役，同 PR 移除本调用点 + 过 K3（判据变更）"
  HARD_FAIL=$((HARD_FAIL + 1))
  [ "${SYNO_CI:-0}" = "1" ] && echo "::error title=IronLaws:${_name}::检查自身失败（脚本缺失）: ${_path}"
  log_gate "$_name" hit
  mkdir -p "$ROOT/.codex/control-tower/logs" 2>/dev/null || true
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"component\": \"pre-commit-${_name}\", \"reason\": \"script-missing\", \"path\": \"${_path}\"}" \
    >> "$ROOT/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true
}

v5_soft() {
  if [ "${SYNO_CI:-0}" = "1" ]; then
    echo -e "  ${RED}❌ ${1}: 检查未过 [CI strict——本地软提示在 CI 上为硬阻断]${RESET}"
    echo "::error title=IronLaws:${1}::检查未过（CI strict 转硬）"
    HARD_FAIL=$((HARD_FAIL + 1))
    log_gate "$1" hit
    return
  fi
  echo -e "  ${YELLOW}⚠️  ${1}: 检查未过 [V5 软提示——CI 为权威(SYNO_CI)，本地不阻断]${RESET}"
  SOFT_COUNT=$((SOFT_COUNT + 1))
  log_gate "$1" hit
}

warn_check() {
  local name="$1" matches="$2"
  local count=0
  [ -n "$matches" ] && count=$(echo "$matches" | grep -c . 2>/dev/null) || count=0
  if [ "$count" -gt 0 ]; then
    # D542: CI strict 下必须显示 ❌（与 soft_check 同修——失败不点名则「N 组未通过」无法定位）
    if [ "${SYNO_CI:-0}" = "1" ]; then
      echo -e "  ${RED}❌ ${name}: ${count} 处  [CI strict——历史 WARN 类在 CI 也转硬]${RESET}"
      HARD_FAIL=$((HARD_FAIL + 1))  # D516 CI strict: 历史 WARN 类在 CI 也转硬
    else
      echo -e "  ${YELLOW}⚠️  ${name}: ${count} 处  [警告]${RESET}"
      WARN_COUNT=$((WARN_COUNT + 1))
    fi
    echo "$matches" | head -5 | while read -r line; do [ -n "$line" ] && echo "     ${line}"; done
  fi
}

plan_aware_check() {
  local name="$1" matches="$2" deferred_list="$3"
  local count=0
  [ -n "$matches" ] && count=$(echo "$matches" | grep -c . 2>/dev/null) || count=0
  if [ "$count" -eq 0 ]; then
    [ "${QUIET_SUCCESS:-0}" != "1" ] && echo -e "  ${GREEN}✅ ${name}${RESET}"
    return
  fi
  local non_deferred=""
  while IFS= read -r match_line; do
    [ -z "$match_line" ] && continue
    local match_file=$(echo "$match_line" | grep -oE '^[^:]+' | head -1)
    if [ -n "$deferred_list" ] && echo "$deferred_list" | grep -qF "$match_file" 2>/dev/null; then
      continue  # 在 defer 列表中 → 跳过
    fi
    non_deferred="${non_deferred}${match_line}\n"
  done <<< "$matches"
  if [ -z "$non_deferred" ]; then
    echo -e "  ${YELLOW}⚠️  ${name}: ${count} 处 (plan.json deferred)  [警告]${RESET}"
    echo "$matches" | head -3 | while read -r line; do [ -n "$line" ] && echo "     ${line}"; done
    WARN_COUNT=$((WARN_COUNT + 1))
  else
    echo -e "  ${RED}❌ ${name}: $(echo -e "$non_deferred" | grep -c .) 处  [硬阻断]${RESET}"
    echo -e "$non_deferred" | head -5 | while read -r line; do [ -n "$line" ] && echo "     ${line}"; done
    HARD_FAIL=$((HARD_FAIL + 1))
  fi
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
GATE_HITS_LOG="${SYNO_GATE_HITS_LOG:-$ROOT/.claude/gate-hits.log}"
_GATE_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
GATE_HITS_LOG="${SYNO_GATE_HITS_LOG:-$ROOT/.claude/gate-hits.log}"
_GATE_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
GATE_HITS_LOG="${SYNO_GATE_HITS_LOG:-$ROOT/.claude/gate-hits.log}"
_GATE_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

BYPASS_LOG="$ROOT/.claude/bypass.log"
# GATEKEEPER-COUNT-BEGIN（夹具 tests/control-tower/bypass-rewrite-classify.test.sh 按此标记提取本段做行为断言；改格式须同步夹具）
if [ -f "$BYPASS_LOG" ] && [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  TODAY=$(date +%Y-%m-%d)
  BYPASS_COUNT=$(grep -c "${TODAY}.*detected-bypass" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  SUSPECT_COUNT=$(grep -c "${TODAY}.*suspected-rewrite" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  SUSPECT_RS=$(grep -c "${TODAY}.*suspected-rewrite.*suspect=rebase-state" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  SUSPECT_CP=$(grep -c "${TODAY}.*suspected-rewrite.*suspect=cherry-pick-state" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  SUSPECT_TS=$(grep -c "${TODAY}.*suspected-rewrite.*suspect=tree-subject-match" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  SUSPECT_FG=$(grep -c "${TODAY}.*suspected-rewrite.*forgeable=1" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  SUSPECT_KIND_IP=$(grep -c "${TODAY}.*suspected-rewrite.*kind=in-progress" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  SUSPECT_KIND_CT=$(grep -c "${TODAY}.*suspected-rewrite.*kind=content" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  if [ "${SUSPECT_COUNT:-0}" -gt 0 ]; then
    echo "[GATEKEEPER] 今日 ${SUSPECT_COUNT} 条 suspected-rewrite（重写误报，台账保留、不计入确证绕过阈值）：kind=in-progress ${SUSPECT_KIND_IP}（rebase-state=${SUSPECT_RS} / cherry-pick-state=${SUSPECT_CP}）/ kind=content ${SUSPECT_KIND_CT}（tree-subject-match=${SUSPECT_TS}）；**可伪造类(forgeable=1)=${SUSPECT_FG}**"
  fi
  if [ "$BYPASS_COUNT" -gt 0 ]; then
    echo "[GATEKEEPER] 检测到今日 ${BYPASS_COUNT} 次 --no-verify 绕过记录"
    if [ "${SYNO_GATEKEEPER_ACK:-0}" = "1" ]; then
      echo "[GATEKEEPER] 已人工确认 (SYNO_GATEKEEPER_ACK=1) — 降级为告警放行本次提交"
      echo "[GATEKEEPER] 绕过根因仍需修复; 今日记录将在次日自动清零"
      mkdir -p "$ROOT/.codex/control-tower/logs"
      echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"component\": \"gatekeeper\", \"reason\": \"SYNO_GATEKEEPER_ACK=1 放行 ${BYPASS_COUNT} 次 detected-bypass\"}" >> "$ROOT/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true
    else
      echo "[GATEKEEPER] 请使用: git synova-commit --task-id <D#> --agent claude-code --message '...'"
      echo "[GATEKEEPER] 若该记录系误报且已人工复核, 可用 SYNO_GATEKEEPER_ACK=1 放行本次"
      echo "[GATEKEEPER] 修复导致绕过的根因后，bypass.log 中今日记录将在次日自动清零"
      exit 1
    fi
  fi
fi
# GATEKEEPER-COUNT-END
if [ "${SYNO_TEST_ARM:-0}" = "1" ]; then
  GIT_CACHED_NAMES="${SYNO_GIT_CACHED_NAMES:-$(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)}"
  GIT_CACHED_ALL_NAMES="${SYNO_GIT_CACHED_ALL_NAMES:-$(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)}"
  GIT_CACHED_ADDED_NAMES="${SYNO_GIT_CACHED_ADDED_NAMES:-$(git -c core.quotepath=false diff --cached --name-only --diff-filter=A 2>/dev/null || true)}"
  GIT_CACHED_DIFF="${SYNO_GIT_CACHED_DIFF:-$(git diff --cached 2>/dev/null || true)}"
else
  if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "${SYNO_DIFF_BASE:-}" ]; then
    _DIFF_RANGE="${SYNO_DIFF_BASE}...HEAD"
    GIT_CACHED_NAMES="$(git -c core.quotepath=false diff --name-only --diff-filter=ACMR "$_DIFF_RANGE" 2>/dev/null || true)"
    GIT_CACHED_ALL_NAMES="$(git -c core.quotepath=false diff --name-only --diff-filter=ACMR "$_DIFF_RANGE" 2>/dev/null || true)"
    GIT_CACHED_ADDED_NAMES="$(git -c core.quotepath=false diff --name-only --diff-filter=A "$_DIFF_RANGE" 2>/dev/null || true)"
    GIT_CACHED_DIFF="$(git diff "$_DIFF_RANGE" 2>/dev/null || true)"
  else
    GIT_CACHED_NAMES="$(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"
    GIT_CACHED_ALL_NAMES="$(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"
    GIT_CACHED_ADDED_NAMES="$(git -c core.quotepath=false diff --cached --name-only --diff-filter=A 2>/dev/null || true)"
    GIT_CACHED_DIFF="$(git diff --cached 2>/dev/null || true)"
  fi
fi

STAGED=$(echo "$GIT_CACHED_NAMES" | grep '\.ts$' | grep -v node_modules || true)

DOC_PREFIX_RE='^(docs/.*\.(md|html|txt)$|\.claude/task-briefs/.*\.(md|html|txt)$|memory/.*\.(md|html|txt)$|task-state/.*\.(json|md)$|[^/]+\.(md|html|txt)$)'
is_doc_only() {
  local staged="$1"
  [ -z "$staged" ] && { echo 0; return; }   # fail-closed: 空暂存 → 非纯文档路径
  local non_doc
  non_doc=$(echo "$staged" | grep -vE "$DOC_PREFIX_RE" || true)
  if [ -z "$non_doc" ]; then echo 1; else echo 0; fi
}
STAGED_ALL=$(echo "$GIT_CACHED_ALL_NAMES" | grep -v node_modules || true)
DOC_ONLY=$(is_doc_only "$STAGED_ALL")

DOC_CONTRACT_TOUCHED=$(echo "$STAGED_ALL" | grep -E '\.(md|html?)$' || true)
if [ -z "$DOC_CONTRACT_TOUCHED" ]; then
  soft_pass "D1193 文档契约三闸: 无文档变更（跳过）"
elif [ ! -f "$ROOT/scripts/control-tower/check-doc-contract.sh" ]; then
  soft_check "D1193 文档契约三闸: 执行体缺失（fail-closed）" "scripts/control-tower/check-doc-contract.sh"
  [ "${SYNO_CI:-0}" = "1" ] && exit 1
else
  if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "${SYNO_DIFF_BASE:-}" ]; then
    _DC_ARGS=(--base "$SYNO_DIFF_BASE")
  else
    _DC_ARGS=(--staged)
  fi
  DOC_CONTRACT_OUT=$(bash "$ROOT/scripts/control-tower/check-doc-contract.sh" "${_DC_ARGS[@]}" 2>&1) || DOC_CONTRACT_RC=$?
  DOC_CONTRACT_RC=${DOC_CONTRACT_RC:-0}
  if [ "$DOC_CONTRACT_RC" -eq 0 ]; then
    soft_pass "D1193 文档契约三闸: 全过（md+html，判据源=契约 §3）"
  elif [ "$DOC_CONTRACT_RC" -eq 1 ]; then
    soft_check "D1193 文档契约三闸: 有违规 — 修正后重试（自跑: bash scripts/control-tower/check-doc-contract.sh ${_DC_ARGS[*]}）" \
      "$(echo "$DOC_CONTRACT_OUT" | grep -E '^\[FAIL\]|^       - ' | head -8)"
    [ "${SYNO_CI:-0}" = "1" ] && exit 1
  else
    soft_check "D1193 文档契约三闸: 检查本身降级 (exit=$DOC_CONTRACT_RC)" "$(echo "$DOC_CONTRACT_OUT" | tail -3)"
    [ "${SYNO_CI:-0}" = "1" ] && exit 1
  fi
fi

# ── CT-34 纯文档提交: 仅 Secrets 扫描, 豁免其余 12 组 ──
if [ "$DOC_ONLY" -eq 1 ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  纯文档提交 (CT-34/D387): 豁免 12 组 — 仅 Secrets 扫描"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  EXEMPT_LOG="${SYNO_EXEMPT_LOG:-$ROOT/.claude/exempt.log}"
  mkdir -p "$(dirname "$EXEMPT_LOG")" 2>/dev/null || true
  echo "$(date +%Y-%m-%dT%H:%M:%S%z) | EXEMPT | staged=$(echo "$STAGED_ALL" | tr '\n' ',' | sed 's/,$//')" >> "$EXEMPT_LOG" 2>/dev/null || true
  if bash "$ROOT/scripts/check-secrets.sh" 2>&1; then
    echo -e "  ${GREEN}✅ Secrets 扫描通过${RESET}"
    NOTES_TOUCHED_DOC=$(echo "$STAGED_ALL" | grep -E '^memory/notes/proposed/' || true)
    if [ -n "$NOTES_TOUCHED_DOC" ]; then
      if bash "$ROOT/scripts/control-tower/check-notes-lifecycle.sh"; then
        echo -e "  ${GREEN}✅ Notes 迁移门禁: proposed/ 无僵尸条目${RESET}"
      else
        echo -e "  ${RED}❌ Notes 迁移门禁: proposed/ 存在僵尸条目（实现已落地未迁移） [硬阻断]${RESET}"
        echo "  修复: git mv 到 implemented/ 或 rejected/，或删除测试残留"
        exit 1
      fi
    fi
    echo -e "  ${GREEN}✅ 纯文档提交豁免检查完成 (CT-34)${RESET}"
    exit 0
  else
    echo -e "  ${RED}❌ Secrets 扫描失败 — 提交已拒绝${RESET}"
    exit 1
  fi
fi

# ⚠️ 不裸看 git diff --cached：D414 会把 bypass.log 自动 add 进正常提交——裸看暂存区
if [ "${SYNO_FASTLANE:-0}" = "1" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  ✅ V5 纯补记快速通道：仅 bypass.log + Secrets，跳过 12 组"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  log_gate "fastlane-bypass-only" hit
  if bash "$ROOT/scripts/check-secrets.sh" 2>&1; then
    echo -e "  ${GREEN}✅ Secrets 扫描通过 — 纯补记提交放行${RESET}"
    exit 0
  else
    echo -e "  ${RED}❌ Secrets 扫描失败 — 提交已拒绝${RESET}"
    exit 1
  fi
fi

# ⚠️ 不裸看 git diff --cached：D414 会把 bypass.log 自动 add 进正常提交——裸看暂存区

# ⚠️ 不裸看 git diff --cached：D414 会把 bypass.log 自动 add 进正常提交——裸看暂存区

PAR_DIR="$ROOT/.claude/.precommit-par"
rm -rf "$PAR_DIR" 2>/dev/null
mkdir -p "$PAR_DIR" 2>/dev/null

par_start() {
  local name="$1" script="$2"
  bash "$ROOT/scripts/$script" > "$PAR_DIR/$name.out" 2>&1
  echo $? > "$PAR_DIR/$name.code"
}

par_collect() {
  local name="$1" pid="$2"
  wait "$pid" 2>/dev/null
  local code=0
  [ -f "$PAR_DIR/$name.code" ] && code=$(cat "$PAR_DIR/$name.code" 2>/dev/null | tr -d '\n\r')
  cat "$PAR_DIR/$name.out" 2>/dev/null
  return "${code:-0}"
}

par_collect_quiet() {
  local name="$1" pid="$2"
  wait "$pid" 2>/dev/null
  local code=0
  [ -f "$PAR_DIR/$name.code" ] && code=$(cat "$PAR_DIR/$name.code" 2>/dev/null | tr -d '\n\r')
  code="${code:-0}"
  if [ "$code" -ne 0 ]; then
    cat "$PAR_DIR/$name.out" 2>/dev/null
  fi
  return "$code"
}

( par_start hardcoded check-hardcoded.sh ) &  PAR_HARDCODED=$!
( par_start deprecated-mapping check-deprecated-mapping.sh ) &  PAR_DEPRECATED=$!
( par_start secrets check-secrets.sh ) &  PAR_SECRETS=$!
( par_start plan-integrity check-plan-integrity.sh ) &  PAR_PLAN_INTEGRITY=$!
( par_start verifiable-done check-verifiable-done.sh ) &  PAR_VERIFIABLE=$!
( par_start acceptance-ci check-acceptance-ci.sh ) &  PAR_ACCEPTANCE=$!
( par_start file-driven check-file-driven.sh ) &  PAR_FILE_DRIVEN=$!

PLAN_FILE="$ROOT/.claude/plan.json"
DEFERRED_WIRING_FILES=""
DEFERRED_FF_FILES=""
DEFERRED_TEST_FILES=""
PLAN_ACTIVE=0
if [ -f "$PLAN_FILE" ]; then
  PLAN_PARSE=$(python3 -c "
import json, sys
try:
  p = json.load(open('$PLAN_FILE'))
  phase = p.get('current_phase', -1)
  if phase < 0: sys.exit(0)
  # 收集当前 phase 之前所有标记为 deferred 的文件
  for ph in p.get('phases', []):
    if ph.get('step', 999) > phase: continue
    checks = ph.get('checks', {})
    files = ph.get('files', [])
    if checks.get('wiring') == 'deferred':
      for f in files: print(f'WIRING:{f}')
    if checks.get('feature_flag') == 'deferred':
      for f in files: print(f'FF:{f}')
    if checks.get('test_pairing') == 'deferred':
      for f in files: print(f'TEST:{f}')
except: pass
" 2>/dev/null)
  if [ -n "$PLAN_PARSE" ]; then
    PLAN_ACTIVE=1
    DEFERRED_WIRING_FILES=$(echo "$PLAN_PARSE" | grep "^WIRING:" | sed 's/^WIRING://')
    DEFERRED_FF_FILES=$(echo "$PLAN_PARSE" | grep "^FF:" | sed 's/^FF://')
    DEFERRED_TEST_FILES=$(echo "$PLAN_PARSE" | grep "^TEST:" | sed 's/^TEST://')
  fi
fi
STAGED_SRC=$(echo "$STAGED_ALL" | grep -E '^src/|^tests/|^packages/|^scripts/' | grep -v 'scripts/pre-commit-check.sh\|scripts/check-secrets.sh\|scripts/check-file-driven.sh\|scripts/workflow/' || true)
NEW_IMPL=$(echo "$GIT_CACHED_ADDED_NAMES" | grep -E "^src/|^extensions/" | grep "\.ts$" | grep -v "\.test\." | grep -v "\.d\.ts" | grep -v "types\.ts$\|index\.ts$\|helpers\.ts$" | grep -v "src/sentinel/compute/" || true)

_DECL_IS_MERGE=0
DECL_SCOPE="$STAGED_ALL"
DECL_MERGE_SKIP=0
if [ -n "$(git rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)" ]; then
  _DECL_IS_MERGE=1
  DECL_SCOPE="$(comm -12 \
    <(printf '%s\n' "${STAGED_ALL:-}" | sed '/^$/d' | sort) \
    <(git diff --cached MERGE_HEAD --name-only --diff-filter=ACMR 2>/dev/null | sed '/^$/d' | sort) \
    2>/dev/null || true)"
  [ -z "$DECL_SCOPE" ] && DECL_MERGE_SKIP=1
fi
DECL_SRC="$STAGED_SRC"
[ "$DECL_MERGE_SKIP" = "1" ] && DECL_SRC=""   # 合并提交无自撰文件 → 闸① 无对象

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Loop Engineering V4.5.1 — pre-commit (13 组 + 免疫 + plan-integrity)"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo -e "${CYAN}── 组 1/13: 类型安全 + 硬编码数据 ──${RESET}"

if [ -n "${SYNO_DIFF_BASE:-}" ]; then
  AS_ANY_DIFF="$(git diff "$SYNO_DIFF_BASE"...HEAD -- src/ packages/ ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)**/*.d.ts' 2>/dev/null || true)"
else
  AS_ANY_DIFF="$(git diff --cached -- src/ packages/ ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)**/*.d.ts' 2>/dev/null || true)"
fi
M=$(echo "$AS_ANY_DIFF" | grep -E '^\+' | grep -v '^+++' | grep -E 'as (any|never)\b|as unknown as' | grep -vE '^\+\s*(//|/\*|\*|#)' || true)
hard_check "as any / as never / as unknown as 零容忍（新增，铁律 38；存量独立清理）" "$M"

FROM_DAMAGE=$(grep -rn 'from"' src/ --include="*.ts" 2>/dev/null | grep -v "node_modules" | grep -v ".test." | grep -v ".d.ts" | grep -v '"import.*from"' | grep -v '".*from".*"' || true)
hard_check "from ????: from??????? (D93/D95??)" "${FROM_DAMAGE:-}"

STAGED_HTML=$(echo "$STAGED_ALL" | grep -E '\.(html|ts)$' | grep -v node_modules | grep -v '\.test\.' || true)
HARDCODE_DATA=""
if [ -n "$STAGED_HTML" ]; then
  for hf in $STAGED_HTML; do
    [ -z "$hf" ] && continue; [ ! -f "$hf" ] && continue
    DEPS=$(grep -n "'marketing'\|'sales'\|'finance'\|'研发部'\|'市场部'\|'销售部'" "$hf" 2>/dev/null | grep -v "import\|export\|//\|/\*\|^\s*\*\|token.split\|dept.*=\|LAYER_EXPERTS\|experts:\|'org'\|'tech'\|'strategy'\|'knowledge'\|'business_model'\|'finance'\|'marketing'\|'sales'\|: \[" | head -3 || true)
    [ -n "$DEPS" ] && HARDCODE_DATA="${HARDCODE_DATA}  ${hf}: 可能硬编码业务数据(如部门名)\n"
  done
fi
par_collect_quiet hardcoded "$PAR_HARDCODED" || true
soft_check "硬编码业务数据/类型 (禁止硬编码部门名/可扩展实体列表)" "${HARDCODE_DATA:-}"

par_collect_quiet deprecated-mapping "$PAR_DEPRECATED" || true

echo -e "${CYAN}── 组 2/13: 测试质量 ──${RESET}"

EMPTY=""
if [ -n "$STAGED" ]; then
  while IFS= read -r file; do
    [ -z "$file" ] && continue; [ ! -f "$file" ] && continue
    CATCHES=$(grep -n "catch\s*{" "$file" 2>/dev/null || true)
    if [ -n "$CATCHES" ]; then
      while IFS= read -r cline; do
        linenum=$(echo "$cline" | cut -d: -f1); [ -z "$linenum" ] && continue
        ctx=$(sed -n "${linenum},$((linenum + 2))p" "$file" 2>/dev/null || echo "")
        if ! echo "$ctx" | grep -qE "log\.|logger\.|console\.|degraded|throw\s|/\*|//"; then
          EMPTY="${EMPTY}${file}:${linenum}: 空 catch (无 log/degraded/throw)\n"
        fi
      done <<< "$CATCHES"
    fi
  done <<< "$STAGED"
fi
soft_check "empty catch 无 log (铁律 24+31)" "${EMPTY:-}"

SILENT_OUT=$(bash "$ROOT/scripts/workflow/check-silent-swallow.sh" --diff 2>&1 || true)
if echo "$SILENT_OUT" | grep -q "❌"; then
  soft_check "静默吞错扫描 (D313 M5b)" "$SILENT_OUT"
else
  soft_pass "静默吞错扫描 (D313 M5b)"
fi

MISSING_TEST=""
if [ -n "$NEW_IMPL" ]; then
  while IFS= read -r impl; do
    [ -z "$impl" ] && continue
    test_path=$(echo "$impl" | sed 's|^src/|tests/|; s|^extensions/sentinels/\([^/]*\)/aggregate\.ts$|tests/sentinels/\1.test.ts|; s|^extensions/sentinels/\([^/]*\)/computes/\([^/]*\)\.ts$|tests/sentinels/\1/\2.test.ts|')
    if ! echo "$test_path" | grep -q '\.test\.ts$'; then
      test_path="${test_path%.ts}.test.ts"
    fi
    if ! echo "$GIT_CACHED_NAMES" | grep -q "^${test_path}$"; then
      if [ ! -f "$test_path" ]; then
        MISSING_TEST="${MISSING_TEST}${impl} → 缺少 ${test_path}\n"
      fi
    fi
  done <<< "$NEW_IMPL"
fi
if [ "$PLAN_ACTIVE" -eq 1 ] && [ -n "$DEFERRED_TEST_FILES" ]; then
  plan_aware_check "新文件配对: impl 须同 commit 有 test" "${MISSING_TEST:-}" "$DEFERRED_TEST_FILES"
else
  hard_check "新文件配对: impl 须同 commit 有 test" "${MISSING_TEST:-}"
fi

STUB_FAIL=""
INTG_FAIL=""
STAGED_TESTS=$(echo "$GIT_CACHED_ADDED_NAMES" | grep '^tests/.*\.test\.ts$' || true)
if [ -n "$STAGED_TESTS" ]; then
  for tf in $STAGED_TESTS; do
    [ -z "$tf" ] && continue; [ ! -f "$tf" ] && continue
    EXPECT_COUNT=$(grep -c 'expect(' "$tf" 2>/dev/null | tr -d '\n\r' || echo 0)
    if [ "${EXPECT_COUNT:-0}" -lt 3 ]; then
      STUB_FAIL="${STUB_FAIL}  ${tf}: 仅 ${EXPECT_COUNT} 个 expect() — 可能为桩测试（需 ≥3 个）\n"
    fi
  done
fi
if [ -n "$NEW_IMPL" ]; then
  for nf in $NEW_IMPL; do
    [ -z "$nf" ] && continue
    if echo "$nf" | grep -qiE 'bridge|context|inject|dispatch|connect'; then
      INTG_TEST=$(echo "$nf" | sed 's|^src/|tests/|; s|\.ts$|.integration.test.ts|')
      if [ ! -f "$INTG_TEST" ]; then
        INTG_FAIL="${INTG_FAIL}  ${nf}: 跨模块文件缺少集成测试 → ${INTG_TEST}\n"
      fi
    fi
  done
fi
hard_check "桩测试: 新测试需 ≥3 expect()" "${STUB_FAIL:-}"
hard_check "跨模块集成: bridge/context 类需 .integration.test.ts" "${INTG_FAIL:-}"

CT_GATE_OUT=$(bash "$ROOT/scripts/control-tower/ct-test-gate.sh" 2>&1)
CT_GATE_EXIT=$?
if [ "$CT_GATE_EXIT" -eq 0 ]; then
  soft_pass "控制塔脚本测试门禁 (U7/CT-40)"
elif [ "$CT_GATE_EXIT" -eq 1 ]; then
  hard_check "控制塔脚本测试门禁 (U7/CT-40)" "$CT_GATE_OUT"
else
  hard_check "控制塔脚本测试门禁执行失败 (exit=$CT_GATE_EXIT, D328 三态)" "$CT_GATE_OUT"
fi

echo -e "${CYAN}── 组 3/13: Secrets ──${RESET}"
par_collect_quiet secrets "$PAR_SECRETS" || HARD_FAIL=$((HARD_FAIL + 1))

echo -e "${CYAN}── 组 4/13: 接线完整性 ──${RESET}"

UNWIRED=""
if [ -n "$NEW_IMPL" ]; then
  while IFS= read -r file; do
    [ -z "$file" ] && continue; [ ! -f "$file" ] && continue
    EXPORTS=$(grep -oE 'export (function|class|const) [A-Za-z_][A-Za-z0-9_]*' "$file" 2>/dev/null | sed -E 's/^export (function|class|const) //' || true)
    for name in $EXPORTS; do
      [ -z "$name" ] && continue
      echo "$name" | grep -qi 'mock\|fake\|_internal\|_deprecated' && continue
      WIRED=$(grep -rn "\b${name}\b" src/ --include="*.ts" 2>/dev/null \
        | grep -v "export.*${name}" | grep -v "$file" | grep -v "\.test\." | head -1 || true)
      [ -z "$WIRED" ] && UNWIRED="${UNWIRED}${file}: export ${name} — 未被任何 src/ 文件引用\n"
    done
  done <<< "$NEW_IMPL"
fi
if [ "$PLAN_ACTIVE" -eq 1 ] && [ -n "$DEFERRED_WIRING_FILES" ]; then
  plan_aware_check "接线审计: 新 export 必须被引用" "${UNWIRED:-}" "$DEFERRED_WIRING_FILES"
else
  hard_check "接线审计: 新 export 必须被引用 (物理事实)" "${UNWIRED:-}"
fi

DEEP_FAIL=""
if [ -n "$NEW_IMPL" ]; then
  for file in $NEW_IMPL; do
    [ -z "$file" ] && continue; [ ! -f "$file" ] && continue
    EXPORTS=$(grep -oE 'export (function|class|const) [A-Za-z_][A-Za-z0-9_]*' "$file" 2>/dev/null | sed -E 's/^export (function|class|const) //' || true)
    for name in $EXPORTS; do
      [ -z "$name" ] && continue
      echo "$name" | grep -qi 'mock\|fake\|_internal\|_deprecated' && continue
      CALL_SITES=$(grep -rn "\b${name}\b" src/server.ts src/index.ts src/agent/synova-agent.ts --include="*.ts" 2>/dev/null | grep -v "import.*${name}\b" | grep -v "export.*${name}\b" | grep -v "^\s*//\|^\s*\*" | head -1 || true)
      IMPORT_ONLY=$(grep -rn "import.*\b${name}\b" src/server.ts src/index.ts src/agent/synova-agent.ts --include="*.ts" 2>/dev/null | head -1 || true)
      if [ -z "$CALL_SITES" ] && [ -n "$IMPORT_ONLY" ]; then
        DEEP_FAIL="${DEEP_FAIL}  ${file}: export ${name} — 已 import 但从未调用（空 import 绕过检测）\n"
      fi
    done
  done
fi
hard_check "接线深度: 新 export 必须被调用(非仅 import)" "${DEEP_FAIL:-}"

echo -e "${CYAN}── 组 5/13: 架构边界 + 桥接文件 ──${RESET}"

CROSS_LAYER=""
if [ -n "$STAGED_SRC" ]; then
  L1_TO_L4=$(echo "$STAGED_SRC" | grep -E '^src/(routes/|l1/|l1-interaction/)' | xargs grep -l "from '\.\./l4/\|from '\.\./\.\./l4/\|from '\.\./store/\|from '\.\./\.\./store/" 2>/dev/null | grep -v "knowledge-bridge-service\|\.test\." || true)
  [ -n "$L1_TO_L4" ] && CROSS_LAYER="${CROSS_LAYER}L1→L4/L5: ${L1_TO_L4}\n"
  L2_TO_L5=$(echo "$STAGED_SRC" | grep -E '^src/agent/' | while read -r _sf; do
    grep -E "from '\.\./store/|from '\.\./init/" "$_sf" 2>/dev/null | grep -v "import type\|knowledge-bridge-service\|\.test\." | grep -q . && echo "$_sf"
  done | grep -v "knowledge-bridge-service\|\.test\." || true)
  [ -n "$L2_TO_L5" ] && CROSS_LAYER="${CROSS_LAYER}L2→L5: ${L2_TO_L5}\n"
  L3_TO_ENGINE=$(echo "$STAGED_SRC" | grep -E '^src/sentinel/' | xargs grep -l "from '\.\./\.\./\.\./packages/engine-core/" 2>/dev/null | grep -v "import type\|\.test\.\|src/sentinel/compute/" || true)
  [ -n "$L3_TO_ENGINE" ] && CROSS_LAYER="${CROSS_LAYER}L3→engine-core: ${L3_TO_ENGINE}\n"
fi
soft_check "架构边界: 禁止跨层引用 (铁律 39)" "${CROSS_LAYER:-}"

BRIDGE_ALLOWED="src/init/engine-context.ts|src/l4/graph-bridge.ts|src/l4/diagnosis-graph-query.ts"
BRIDGE_FAIL=""

STAGED_ALL_FILES=$(echo "$GIT_CACHED_ALL_NAMES" | grep -E '^(src|packages)/.*\.ts$' | grep -v '\.test\.' || true)
if [ -n "$STAGED_ALL_FILES" ]; then
  for file in $STAGED_ALL_FILES; do
    [ -z "$file" ] && continue
    echo "$file" | grep -qE "$BRIDGE_ALLOWED" && continue
    if grep -qE "packages/engine-core|\.\./engine-core|\.\./\.\./engine-core" "$file" 2>/dev/null; then
      BRIDGE_FAIL="${BRIDGE_FAIL}  ${file}: 引用 engine-core (铁律 46 — 含相对路径)\n"
    fi
  done
fi

ALL_PKG_SRC=$(find "$ROOT"/packages/*/src -name "*.ts" ! -name "index.ts" 2>/dev/null || true)
SHELL_PKGS=$(awk '
  FNR == 1 { reexport=0; engcore=0 }
  { if ($0 ~ /^export.*from/) reexport=1; if ($0 ~ /engine-core/) engcore=1; lines=FNR }
  ENDFILE { if (reexport && engcore && lines > 0 && lines < 50) print FILENAME }
' "$ROOT"/packages/*/src/index.ts 2>/dev/null || true)
if [ -n "$SHELL_PKGS" ]; then
  while IFS= read -r pkg_idx; do
    [ -z "$pkg_idx" ] && continue
    pkg_dir=$(dirname "$(dirname "$pkg_idx")")
    if echo "$ALL_PKG_SRC" | grep -q "^${pkg_dir}/"; then
      continue  # 包内有其他源文件 → 不是壳包
    fi
    BRIDGE_FAIL="${BRIDGE_FAIL}  $pkg_idx: 壳包 — 仅 ${lines} 行且全部是 export from engine-core (铁律 46)\n"
  done <<< "$SHELL_PKGS"
fi
soft_check "铁律 46: 桥接文件欺诈 + 包级 engine-core + 壳包检测" "${BRIDGE_FAIL:-}"

TODAY=$(date +%Y-%m-%d)
BRIEF=$(bash "$ROOT/scripts/workflow/resolve-commit-brief.sh" "${DECL_SCOPE:-$STAGED_ALL}" 2>/dev/null || true)
BRIEF_RESOLVED="$BRIEF"
CLEANUP_CLAIM=""
if [ -n "$BRIEF" ] && [ -f "$BRIEF" ]; then
  if grep -qi "已拆\|已迁移\|已清理\|拆分.*完成\|迁移.*完成\|清理.*完成\|完成.*拆分\|完成.*迁移\|完成.*清理" "$BRIEF" 2>/dev/null; then  # swallow-ok: brief 不可读→grep 静默→CLEANUP_CLAIM 空（拆分/迁移裸词不作完成声称，避免误伤工作描述）
    CLEANUP_CLAIM="task brief 声称拆分/迁移/清理完成 — 请确认 grep -r 'packages/engine-core' src/ 零结果"
  fi
fi
warn_check "铁律 47: 声称完成须 grep 物理证明" "${CLEANUP_CLAIM:-}"

echo -e "${CYAN}── 组 6/13: Task Brief (6 核心字段) ──${RESET}"

# ═══ D537 #2 (D537r2): 主树提交禁止门禁 ═══
_MT_GUARD="$ROOT/scripts/control-tower/main-tree-guard.sh"
if [ ! -f "$_MT_GUARD" ]; then
  self_fail_missing_script "主树提交禁止门禁 (D537 #2)" "scripts/control-tower/main-tree-guard.sh"
else
  _MT_MSG=""
  _MT_RC=0
  bash "$_MT_GUARD" || _MT_RC=$?   # swallow-ok: 非零退出码在下方 case 显式分派（0/1/2 三态，不吞）
  case "${_MT_RC}" in
    0) : ;;
    1) _MT_MSG="禁止在主树提交 — 请在独立 worktree 工作（SYNO_ALLOW_MAIN_TREE=1 显式放行并留痕）" ;;
    *) _MT_MSG="主树门禁检查自身失败 rc=${_MT_RC} — 同样阻断（fail-closed）" ;;
  esac
  hard_check "主树提交禁止门禁 (D537 #2): 主树判据（本地层）" "${_MT_MSG}"
fi

TASK_BRIEF_MISSING=""
TASK_BRIEF_EMPTY=""
CLAIM_V2=1
case "$(printf '%s' "${SYNO_CLAIM_V2:-}" | tr '[:upper:]' '[:lower:]')" in
  1|true|on|yes|y) CLAIM_V2=1 ;;
  *) CLAIM_V2=0 ;;
esac
IS_CLAIM_DECL=0
case "${BRIEF:-}" in *.yaml) IS_CLAIM_DECL=1 ;; esac
if [ -n "$DECL_SRC" ]; then   # D1148: 合并提交且无自撰文件时为空 → 闸① 无对象
  if [ -z "$BRIEF" ]; then
    TASK_BRIEF_MISSING="今日无 task brief。请先运行: bash scripts/workflow/task-start.sh \"任务描述\""
  elif [ "$CLAIM_V2" = "1" ] && [ "$IS_CLAIM_DECL" = "1" ]; then
    CLAIM_ISSUE="$(basename "$BRIEF" .yaml)"
    CLAIM_CHK_OUT="$(python3 "$ROOT/scripts/control-tower/claim_store.py" --check "$CLAIM_ISSUE" --root "$ROOT" 2>&1)"
    CLAIM_CHK_RC=$?
    echo -e "  ${CYAN}ℹ️  组 6: 声明载体 = claim（${BRIEF##*/}）—— Q0/Q1/Q2/Q3 散文检查按设计不适用${RESET}"
    if [ "$CLAIM_CHK_RC" -eq 1 ]; then
      TASK_BRIEF_EMPTY="${TASK_BRIEF_EMPTY}  claim 声明不合规: $(printf '%s' "$CLAIM_CHK_OUT" | head -1)\n"
    elif [ "$CLAIM_CHK_RC" -ne 0 ]; then
      TASK_BRIEF_EMPTY="${TASK_BRIEF_EMPTY}  claim 检查自身失败 rc=${CLAIM_CHK_RC}: $(printf '%s' "$CLAIM_CHK_OUT" | head -1)\n"
    fi
  else
    for q in "Q1" "Q2" "Q3"; do
      SECTION=$(awk "/^## ${q}(:| )/{found=1; next} /^## /{if(found) exit} found" "$BRIEF" 2>/dev/null)
      FILLED=$(echo "$SECTION" | grep -v "^<!--\|^$" | tr -d "[:space:]" | head -1)
      if [ -z "$FILLED" ] || [ ${#FILLED} -lt 3 ]; then
        TASK_BRIEF_EMPTY="${TASK_BRIEF_EMPTY}  ${q}: 未填写\n"
      fi
    done
    LAYER_FILLED=""
    if command -v python3 >/dev/null 2>&1; then
      LAYER_FILLED=$(python3 "$ROOT/scripts/control-tower/brief_parser.py" --layer "$BRIEF" 2>/dev/null | head -1 || true)
    else
      echo -e "  ${YELLOW}⚠️  D707: python3 不可用 — 架构层字段无法判定，跳过本项（降级登记）${RESET}"
      mkdir -p "$ROOT/.codex/control-tower/logs" 2>/dev/null || true
      echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"pre-commit-group6-layer\", \"reason\": \"python3 不可用 — 架构层字段跳过 (fail-open + degraded)\"}" >> "$ROOT/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true
      LAYER_FILLED="__D707_UNJUDGED__"
    fi
    if [ "$LAYER_FILLED" != "__D707_UNJUDGED__" ]; then
      LAYER_FILLED=$(printf '%s' "$LAYER_FILLED" | tr -d "[:space:]")
      if [ -z "$LAYER_FILLED" ] || [ ${#LAYER_FILLED} -lt 3 ]; then
        TASK_BRIEF_EMPTY="${TASK_BRIEF_EMPTY}  架构层: 未填写\n"
      fi
    fi
    DONE_SECTION=$(awk "/^## Done 标准/{found=1; next} /^## /{if(found) exit} found" "$BRIEF" 2>/dev/null)
    DONE_CHECKED=$(echo "$DONE_SECTION" | grep -cE '^\s*- \[x\]' || true)
    DONE_EMPTY=$(echo "$DONE_SECTION" | grep -v "^##\|^<!--\|^$" | wc -l)
    if [ "${DONE_CHECKED:-0}" -eq 0 ] && [ "${DONE_EMPTY:-0}" -le 1 ]; then
      TASK_BRIEF_EMPTY="${TASK_BRIEF_EMPTY}  Done 标准: 至少需定义一条完成标准\n"
    fi
  fi
fi

SKEL_BRIEF=""
for bf in $(echo "$STAGED_ALL" | grep -E '^\.claude/task-briefs/.*\.md$' || true); do
  if [ -f "$ROOT/$bf" ] && grep -q '认领: <agent>\|<本任务在哪一层' "$ROOT/$bf" 2>/dev/null; then
    SKEL_BRIEF="${SKEL_BRIEF}  ${bf}（alloc-task-id 骨架占位符未填）\n"
  fi
done
# ↑ D1148: 原 `hard_check "骨架 brief 占位符检测…"` 独立执行点 → 并入闸①（SKEL_BRIEF 变量保留）

Q0C_OUT=$(bash "$ROOT/scripts/check-q0c-tracking.sh" 2>&1); Q0C_RC=$?
Q0C_MSG=""
if [ "$Q0C_RC" -ne 0 ]; then
  Q0C_MSG="$(printf '%s\n' "$Q0C_OUT" | grep -v '^[[:space:]]*$' | head -4)\n"
fi
DECL1="${TASK_BRIEF_MISSING:-}${TASK_BRIEF_EMPTY:-}${SKEL_BRIEF:-}${Q0C_MSG}"
if [ "$DECL_MERGE_SKIP" = "1" ]; then
  echo -e "  ${YELLOW}⏭ 声明类三闸：合并提交且无自撰文件（两父文件各已在各自 PR 受门禁）→ 闸①②③ 无对象，跳过${RESET}"
else
  QUIET_SUCCESS=0 decl_check "声明闸① brief schema（Q1–Q3/架构层/Done/骨架/Q0c；D1220 退时间戳+Q0）" "${DECL1:-}"
fi

NOTES_TOUCHED=$(echo "$STAGED_ALL" | grep -E '^memory/notes/proposed/' || true)
if [ -n "$NOTES_TOUCHED" ]; then
  if bash "$ROOT/scripts/control-tower/check-notes-lifecycle.sh"; then
    soft_pass "Notes 迁移门禁: proposed/ 无僵尸条目"
  else
    echo -e "  ${YELLOW}⚠️  Notes 迁移门禁: proposed/ 存在僵尸条目（实现已落地未迁移） [V5 软提示——CI 为权威，本地不阻断]${RESET}"
    echo "  修复: git mv 到 implemented/ 或 rejected/，或删除测试残留"
    SOFT_COUNT=$((SOFT_COUNT + 1))
    log_gate "Notes 迁移门禁 (D472)" hit
  fi
else
  soft_pass "Notes 迁移门禁: 无 proposed/ 变更（跳过）"
fi

PI_OUT=""
PI_RC=0
par_collect plan-integrity "$PAR_PLAN_INTEGRITY" > "$PAR_DIR/plan-integrity.captured" 2>&1 || PI_RC=$?
PI_OUT="$(cat "$PAR_DIR/plan-integrity.captured" 2>/dev/null || true)"
PI_Q2=""
if [ "$PI_RC" -ne 0 ]; then
  if [ "$PI_RC" -ge 2 ]; then
    PI_Q2="$(printf '%s\n' "$PI_OUT" | head -4)\n"
  else
    PI_Q2="$(printf '%s\n' "$PI_OUT" | grep -A3 'Q2 排除项' || true)"
    [ -n "$PI_Q2" ] && PI_Q2="${PI_Q2}\n"
  fi
fi

VD_OUT=""
VD_RC=0
par_collect verifiable-done "$PAR_VERIFIABLE" > "$PAR_DIR/verifiable-done.captured" 2>&1 || VD_RC=$?
VD_OUT="$(cat "$PAR_DIR/verifiable-done.captured" 2>/dev/null || true)"
if [ "$DECL_MERGE_SKIP" = "1" ]; then
  :   # 合并提交无自撰文件 → 闸③ 无对象（跳过行已由闸① 处统一打印）
elif [ "$VD_RC" -ne 0 ]; then
  QUIET_SUCCESS=0 decl_check "声明闸③ Done 可证伪（每项 - [x] 带 verify:；D1148）" "$(printf '%s\n' "$VD_OUT" | grep -v '^[[:space:]]*$' | head -6)"
else
  QUIET_SUCCESS=0 decl_check "声明闸③ Done 可证伪（每项 - [x] 带 verify:；D1148）" ""
fi

SOG_NODE_REFS=$(grep -rn "SOGNodeType\." src/ --include="*.ts" 2>/dev/null | grep -v "node_modules" | head -10 || true)
if [ -n "$SOG_NODE_REFS" ]; then
  echo -e "${YELLOW}  ⚠️  旧 SOGNodeType 枚举仍被引用 — 本体迁移未完成 [V5 软提示——CI 为权威]${RESET}"
  echo "$SOG_NODE_REFS"
  SOFT_COUNT=$((SOFT_COUNT + 1))
fi
SOG_EDGE_REFS=$(grep -rn "SOGEdgeType\." src/ --include="*.ts" 2>/dev/null | grep -v "node_modules" | head -10 || true)
if [ -n "$SOG_EDGE_REFS" ]; then
  echo -e "${YELLOW}  ⚠️  旧 SOGEdgeType 枚举仍被引用 — 本体迁移未完成 [V5 软提示——CI 为权威]${RESET}"
  echo "$SOG_EDGE_REFS"
  SOFT_COUNT=$((SOFT_COUNT + 1))
fi
SOG_IMPORTS=$(grep -rn "from '@synova/sog-core'" src/ --include="*.ts" 2>/dev/null | grep -v "node_modules" | head -10 || true)
if [ -n "$SOG_IMPORTS" ]; then
  echo -e "${YELLOW}  ⚠️  @synova/sog-core 仍被 src/ 引用 — 本体迁移未完成 [V5 软提示——CI 为权威]${RESET}"
  echo "$SOG_IMPORTS"
  SOFT_COUNT=$((SOFT_COUNT + 1))
fi

echo -e "${CYAN}── 组 7/13: 架构合规 ──${RESET}"

_DIAG_SELF='scripts/pre-commit-check.sh'
_DIAG_EXCL='@deprecated|import type|^\+[[:space:]]*(//|/\*|\*|#)|hard_check|禁止 ?新? ?DiagnosticModule|不要再使用 DiagnosticModule'
if [ "${SYNO_TEST_ARM:-0}" = "1" ]; then
  _DIAG_EXCL="${SYNO_DIAG_EXCL_OVERRIDE:-$_DIAG_EXCL}"
fi
_DIAG_CAND=$(printf '%s\n' "$GIT_CACHED_DIFF" | awk -v self="$_DIAG_SELF" '
  substr($0,1,4)=="+++ " {
    f=substr($0,5); n=length(f)
    if (n>=2 && substr(f,1,1)=="\"" && substr(f,n,1)=="\"") { f=substr(f,2,n-2); n=n-2 }
    if (substr(f,1,2)=="b/") { f=substr(f,3); n=n-2 }
    skip=(f==self || (n>=3 && substr(f,n-2)==".md") || (n>=5 && substr(f,n-4)==".html"))
    next
  }
  skip { next }
  substr($0,1,1)=="+" && index($0,"DiagnosticModule")>0 { print }
')
_DIAG_RC=0
if command -v grep >/dev/null 2>&1; then
  NEW_DIAG=$(printf '%s\n' "$_DIAG_CAND" | grep -Ev -- "$_DIAG_EXCL"); _DIAG_RC=$?
else
  _DIAG_RC=127
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
  QUIET_SUCCESS=0 soft_check "禁止 DiagnosticModule: 新模块须实现 Sentinel 接口" "${NEW_DIAG:-}"
fi

if bash "$ROOT/scripts/validate-expert-config.sh" 2>&1; then
  [ "${QUIET_SUCCESS:-0}" != "1" ] && echo -e "  ${GREEN}✅ 专家配置校验${RESET}"
else
  echo -e "  ${YELLOW}⚠️  专家配置校验: yaml 引用断裂  [V5 软提示——CI 为权威，本地不阻断]${RESET}"
  SOFT_COUNT=$((SOFT_COUNT + 1))
fi

FAILURE_LOG="$ROOT/.claude/pre-commit-failures.log"
BYPASS_LOG="$ROOT/.claude/bypass.log"

FAILURE_COUNT=0
if [ -f "$FAILURE_LOG" ]; then
  YESTERDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)
  FAILURE_COUNT=$(grep -c "$YESTERDAY\|$(date +%Y-%m-%d)" "$FAILURE_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  FAILURE_COUNT=${FAILURE_COUNT//[^0-9]/}
  [ -z "$FAILURE_COUNT" ] && FAILURE_COUNT=0
fi
if [ "${FAILURE_COUNT:-0}" -gt 10 ]; then
  echo -e "  ${YELLOW}⚠️  门禁故障审计: 24h 内 pre-commit 失败 ${FAILURE_COUNT} 次 — 门禁可能太激进 [警告]${RESET}"
  echo "    高失败率意味着门禁本身有 bug 或太敏感。请检查误报来源。"
else
  [ "${QUIET_SUCCESS:-0}" != "1" ] && echo -e "  ${GREEN}✅ 门禁故障审计${RESET}"
fi

BYPASS_COUNT=0
POSSIBLE_COUNT=0
if [ -f "$BYPASS_LOG" ]; then
  BYPASS_COUNT=$(grep -cE "$(date +%Y-%m-%d).*detected-bypass" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  POSSIBLE_COUNT=$(grep -cE "$(date +%Y-%m-%d).*possible-bypass" "$BYPASS_LOG" 2>/dev/null | tr -d '\n\r' || echo 0)
  BYPASS_COUNT=${BYPASS_COUNT//[^0-9]/}
  POSSIBLE_COUNT=${POSSIBLE_COUNT//[^0-9]/}
  [ -z "$BYPASS_COUNT" ] && BYPASS_COUNT=0
  [ -z "$POSSIBLE_COUNT" ] && POSSIBLE_COUNT=0
fi
if [ "${BYPASS_COUNT:-0}" -ge 3 ]; then
  if [ "${SYNO_GATEKEEPER_ACK:-0}" = "1" ]; then
    echo -e "  ${YELLOW}⚠️  绕过审计: 24h 内 --no-verify ${BYPASS_COUNT} 次 — 已超限, 但已人工确认 (SYNO_GATEKEEPER_ACK=1)  [告警]${RESET}"
  else
    echo -e "  ${YELLOW}⚠️  绕过审计: 24h 内 --no-verify ${BYPASS_COUNT} 次 — 已超限  [V5 软提示]${RESET}"
    echo "    连续使用 --no-verify 超过 2 次后，第 3 次起必须修复根因而非绕过"
    echo "    若已人工复核为误报, 可用 SYNO_GATEKEEPER_ACK=1 放行本次"
    SOFT_COUNT=$((SOFT_COUNT + 1))
  fi
elif [ "${BYPASS_COUNT:-0}" -ge 2 ]; then
  echo -e "  ${YELLOW}⚠️  绕过审计: 24h 内 --no-verify ${BYPASS_COUNT} 次 — 警告${RESET}"
elif [ "${POSSIBLE_COUNT:-0}" -gt 0 ]; then
  echo -e "  ${YELLOW}⚠️  绕过审计: 24h 内 possible-bypass ${POSSIBLE_COUNT} 次（stale marker 弱信号，非强绕过，U1 推送对账兜底）[告警不阻断]${RESET}"
else
  [ "${QUIET_SUCCESS:-0}" != "1" ] && echo -e "  ${GREEN}✅ 绕过审计${RESET}"
fi

STAGED_ROUTES=$(echo "$GIT_CACHED_ALL_NAMES" | grep -E '^src/routes/.*\.ts$' | grep -v '.test.' || true)
DATA_FLOW_FAIL=""
if [ -n "$STAGED_ROUTES" ]; then
  for rf in $STAGED_ROUTES; do
    [ -z "$rf" ] && continue; [ ! -f "$rf" ] && continue
    HAS_API=$(grep -c "fetch(\|await.*import\|getDatabase()\|\.search(\|\.list(\|\.recall(" "$rf" 2>/dev/null | tr -d '\n\r' || echo 0)
    HAS_HARD=$(grep -c "'marketing'\|'sales'\|'finance'\|'研发部'\|'市场部'\|'销售部'" "$rf" 2>/dev/null | tr -d '\n\r' || echo 0)
    if [ "${HAS_API:-0}" -eq 0 ] && [ "${HAS_HARD:-0}" -gt 0 ]; then
      DATA_FLOW_FAIL="${DATA_FLOW_FAIL}  ${rf}: 含硬编码业务数据但无 API 调用 — 可能为静态模板\n"
    fi
  done
fi
soft_check "数据流: 路由文件须含 API 调用证据" "${DATA_FLOW_FAIL:-}"

echo -e "${CYAN}── 组 8/13: 文件驱动架构完整性 (V3.9) ──${RESET}"
AC_OUT=""
AC_RC=0
par_collect acceptance-ci "$PAR_ACCEPTANCE" > "$PAR_DIR/acceptance-ci.captured" 2>&1 || AC_RC=$?
AC_OUT="$(cat "$PAR_DIR/acceptance-ci.captured" 2>/dev/null || true)"
if [ "$AC_RC" -ne 0 ]; then
  printf '%s\n' "$AC_OUT" | grep -v '^[[:space:]]*$' | head -5 | sed 's/^/     /'
  v5_soft "验收 CI (V3.9)（D1176 K3 整改复执法）"
fi
par_collect_quiet file-driven "$PAR_FILE_DRIVEN" || v5_soft "文件驱动架构完整性 (V3.6)"

echo -e "${CYAN}── 组 9/13: 契约门禁 ──${RESET}"
CONTRACT_DIR="$ROOT/.codex/contracts"
CONTRACT_FAIL=""
if [ -d "$CONTRACT_DIR" ] && [ "$(ls -A "$CONTRACT_DIR" 2>/dev/null)" ]; then
  for cf in "$CONTRACT_DIR"/*.json; do
    [ ! -f "$cf" ] && continue
    DECLARED=$(python -c "
import json, sys
try:
    d = json.load(open('$cf'))
    items = d if isinstance(d, list) else [d]
    for i in items:
        fp = i.get('filePath', '')
        if fp: print(fp)
except: pass
" 2>/dev/null || true)
    for df in $DECLARED; do
      [ -z "$df" ] && continue
      if ! echo "$STAGED_ALL" | grep -qF "$df"; then
        CONTRACT_FAIL="${CONTRACT_FAIL}  ${cf##*/}: 声明产出 $df — 不在暂存区\n"
      fi
    done
  done
fi
soft_check "契约门禁: 声明产出须在暂存区" "${CONTRACT_FAIL:-}"

_tsx_ok="$(command -v node >/dev/null 2>&1 && echo yes || echo no)"
BP_OUT=""
BP_RC=0
if [ "$_tsx_ok" = "yes" ]; then
  bash "$ROOT/scripts/control-tower/check-block-paths.sh" > /tmp/.syno-blockpaths.out 2>&1 &
  _bp_pid=$!
  _bp_i=0
  while kill -0 "$_bp_pid" 2>/dev/null; do   # swallow-ok: 进程已退出=循环正常结束条件，非错误
    if [ "$_bp_i" -ge 100 ]; then   # 10s 上限（0.1s × 100）
      kill -TERM "$_bp_pid" 2>/dev/null || true
      sleep 0.2
      kill -KILL "$_bp_pid" 2>/dev/null || true
      wait "$_bp_pid" 2>/dev/null || true
      BP_RC=124
      break
    fi
    sleep 0.1
    _bp_i=$(( _bp_i + 1 ))
  done
  if [ "$BP_RC" -eq 0 ]; then
    wait "$_bp_pid" 2>/dev/null || BP_RC=$?
  fi
  BP_OUT="$(cat /tmp/.syno-blockpaths.out 2>/dev/null || true)"
  rm -f /tmp/.syno-blockpaths.out
  case "$BP_RC" in
    0) : ;;  # 一致 ⇒ 静默（D1148 成功静默）
    1) soft_check "块级 paths 快照对账" "$(printf '%s' "$BP_OUT" | head -30)\n" ;;
    *) # 🔴 非 0/1 = 判不了或超时 ⇒ **显式**报（不得与"通过"混同），且不吞原始输出
       printf '%s\n' "$BP_OUT" | head -10 | sed 's/^/     /'
       soft_check "块级 paths 快照对账（🔴 判不了/超时 = fail-closed，非通过）" "  exit=${BP_RC} — 读不到真源/形状异常/超时\n" ;;
  esac
else
  echo -e "  ${YELLOW}⚠️  块级 paths 快照对账：node 不可用 — 无法判定（降级登记，fail-closed 语义见门禁自身）${RESET}"
  mkdir -p "$ROOT/.codex/control-tower/logs" 2>/dev/null || true
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"pre-commit-group9-block-paths\", \"reason\": \"node 不可用 — 块级 paths 对账跳过 (degraded)\"}" >> "$ROOT/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true
fi

echo -e "${CYAN}── 组 10/13: V3 流水线健康度 ──${RESET}"

CRITERIA_MAP="$ROOT/.codex/criteria-code-map.json"
if [ -f "$CRITERIA_MAP" ]; then
  BRIEF_FILE=$(echo "$CHANGED_FILES" | grep -m1 "\.claude/task-briefs/" || true)
  if [ -n "$BRIEF_FILE" ]; then
    BRIEF_PATH="$ROOT/$BRIEF_FILE"
    CRITERIA=$(grep -oE '#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]' "$BRIEF_PATH" 2>/dev/null | sed -E 's/.*[=:][[:space:]]*//' || true)
    if [ -n "$CRITERIA" ]; then
      CRITERIA_GLOBS=$(python -c "
import json
with open('$CRITERIA_MAP') as f:
    m = json.load(f)
g = m.get('criteria', {}).get('$CRITERIA', {}).get('glob', [])
for gx in g:
    print(gx)
" 2>/dev/null || true)
      REGEX_GLOBS=""
      while IFS= read -r gx; do
        [ -z "$gx" ] && continue
        REGEX=$(echo "$gx" | sed 's/\*/.*/g; s/?/./g')
        REGEX_GLOBS="${REGEX_GLOBS}|${REGEX}"
      done <<< "$CRITERIA_GLOBS"
      REGEX_GLOBS="${REGEX_GLOBS#|}"
      if [ -n "$REGEX_GLOBS" ]; then
        MISMATCH=""
        for sf in $STAGED_FILES; do
          if ! echo "$sf" | grep -qE "($REGEX_GLOBS)"; then
            MISMATCH="${MISMATCH}  $sf (不在条件 $CRITERIA 的映射区域内)\n"
          fi
        done
        if [ -n "$MISMATCH" ]; then
          warn_check "G10: 条件区域不匹配" "$MISMATCH"
        else
          soft_pass "G10: 条件区域检查通过 ($CRITERIA)"
        fi
      else
        soft_pass "G10: 条件 $CRITERIA 无映射区域(跳过)"
      fi
    else
      soft_pass "G10: 无条件归属(跳过)"
    fi
  else
    soft_pass "G10: 无 task brief 变更(跳过)"
  fi

  HAS_E2E=0; HAS_TESTS=0
  BRIEF_ID=$(echo "$STAGED_FILES" | grep -oE '\.claude/task-briefs/[^.]+' | sed -E 's|^\.claude/task-briefs/||' | head -1 || true)
  if [ -n "$BRIEF_ID" ]; then
    BRIEF_PATH="$ROOT/.claude/task-briefs/${BRIEF_ID}.md"
    if [ -f "$BRIEF_PATH" ]; then
      HAS_E2E=$(grep -c "端到端\|e2e\|curl.*200\|HTTP.*200" "$BRIEF_PATH" 2>/dev/null | tr -d '\n\r' || true)
      HAS_TESTS=$(echo "$STAGED_FILES" | grep -c "\.test\.ts" 2>/dev/null | tr -d '\n\r' || true)
      if [ "$HAS_E2E" -gt 0 ] && [ "$HAS_TESTS" -eq 0 ]; then
        warn_check "G11: 声明的端到端验收但无测试文件" "$BRIEF_ID 声明了端到端验收，但暂存区无测试文件"
      else
        soft_pass "G11: 测试覆盖检查通过"
      fi
    else
      soft_pass "G11: task brief 不存在(跳过)"
    fi
  else
    soft_pass "G11: 无 task brief 变更(跳过)"
  fi
else
  soft_pass "G10/G11: criteria-code-map.json 不存在(跳过)"
fi

echo -e "${CYAN}── 组 12/13: Task Scope 一致性 ──${RESET}"

TODAY=$(date +%Y-%m-%d)
CUR_BRIEF_PATH=""
_CB_SRC="$ROOT/.claude/current-brief"
if [ -n "${DSH_SESSION_ID:-}" ] && [ -f "$ROOT/.claude/current-brief.$DSH_SESSION_ID" ]; then
  _CB_SRC="$ROOT/.claude/current-brief.$DSH_SESSION_ID"
fi
if [ -f "$_CB_SRC" ]; then
  _bname=$(cat "$_CB_SRC" 2>/dev/null | tr -d '[:space:]')  # swallow-ok: current-brief 缺失/读失败 → _bname 空 → 回退认领，非错误吞掉
  _cb_date=$(echo "$_bname" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)
  if [ -n "$_cb_date" ] && [ "$_cb_date" != "$TODAY" ]; then
    :  # 陈旧的 current-brief，忽略它
  elif [ -n "$_bname" ] && [ -f "$ROOT/.claude/task-briefs/$_bname" ]; then
    CUR_BRIEF_PATH="$ROOT/.claude/task-briefs/$_bname"
  fi
fi
# 用法: today_files_by_prefix <dir>   # brief: YYYY-MM-DD 文件名前缀 (扫描 *.md)
TODAY_DASH=$(date +%Y-%m-%d)
#   不是 alternation → 匹配恒失败 → ALL_TODAY_BRIEFS 空 → G12 整段跳过 soft_pass（fail-open）。
DAY_WINDOW_RE=$(python3 -c "
import datetime
t = datetime.date.today()
print('^(' + '|'.join((t + datetime.timedelta(days=k)).isoformat() for k in (-1, 0, 1)) + ')-')" 2>/dev/null || true)
[ -z "$DAY_WINDOW_RE" ] && DAY_WINDOW_RE="^${TODAY_DASH}-"
today_files_by_prefix() {
  local dir="$1" f b
  dir="${dir%/}"
  [ -d "$dir" ] || return 0
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    b=${f##*/}
    if [[ "$b" =~ $DAY_WINDOW_RE ]]; then
      echo "$f"
    fi
  done
  return 0
}
ALL_TODAY_BRIEFS=$(today_files_by_prefix "$ROOT/.claude/task-briefs/" | sort || true)
[ -z "$ALL_TODAY_BRIEFS" ] && [ -n "$CUR_BRIEF_PATH" ] && ALL_TODAY_BRIEFS="$CUR_BRIEF_PATH"
SCOPE_VIOLATION=""

_G12_JUDGE_SET="${STAGED_ALL}"          # 送 legacy 判定的文件集（缺省=全部）
_G12_CLAIM_STATUS="off"

if [ "${CLAIM_V2:-0}" = "1" ] && [ -n "${BRIEF:-}" ] && [ "${IS_CLAIM_DECL:-0}" != "1" ] && [ -f "$BRIEF" ]; then
  case "$ALL_TODAY_BRIEFS" in
    *"$BRIEF"*) : ;;
    *)
      ALL_TODAY_BRIEFS="$(printf '%s\n%s\n' "$ALL_TODAY_BRIEFS" "$BRIEF" | grep -v '^$' | sort -u || true)"
      echo -e "  ${CYAN}ℹ️  组 12: 并入 resolver 定位的 legacy 声明（窗口外/锚点定位，存量 D# 只读兼容）: ${BRIEF##*/}${RESET}"
      ;;
  esac
fi

if [ "${CLAIM_V2:-0}" = "1" ] && [ -n "$STAGED_ALL" ]; then
  _G12_C_OUT="$(printf '%s\n' "$STAGED_ALL" | python3 "$ROOT/scripts/control-tower/claim_store.py" --coverage --root "$ROOT" 2>&1)"
  _G12_C_RC=$?
  if [ "$_G12_C_RC" -eq 2 ] || [ "$_G12_C_RC" -ne 0 ]; then
    _G12_CLAIM_STATUS="degraded-scoped"
    echo -e "  ${YELLOW}⚠️  组 12 claim 覆盖判定: 检查自身失败（rc=${_G12_C_RC}）—— **作用域收窄：不阻断**${RESET}"
    printf '%s\n' "$_G12_C_OUT" | head -3 | sed 's/^/     /'
    echo -e "     ${YELLOW}⇒ 处置（CTO 2026-10-11）：畸形 claim 只告警不阻断；请修复下列条目（列入待修清单）${RESET}"
    echo "$(date +%s) | CLAIM_MALFORMED_WARN | rc=${_G12_C_RC} | 见上（作用域收窄，不阻断）" >> "$ROOT/.claude/claim-malformed.log" 2>/dev/null || true
    log_gate "组 12 claim 覆盖判定（自身失败·作用域收窄·仅告警）" warn
  else
    _G12_CLAIM_STATUS="on"
    _G12_C_REASON="$(printf '%s' "$_G12_C_OUT" | python3 -c "import json,sys;print(json.load(sys.stdin).get('reason',''))" 2>/dev/null || echo "")"
    _G12_C_REMAIN="$(printf '%s' "$_G12_C_OUT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('\n'.join(d.get('uncovered',[])))" 2>/dev/null || echo "")"
    echo -e "  ${CYAN}ℹ️  组 12 claim 载体: ${_G12_C_REASON}${RESET}"
    _G12_JUDGE_SET="${_G12_C_REMAIN}"
    if [ -z "$_G12_JUDGE_SET" ]; then
      echo -e "  ${GREEN}✅ 组 12 claim 载体: 全部暂存文件均被 claim 覆盖（legacy 判定无对象）${RESET}"
    else
      echo -e "  ${CYAN}ℹ️  组 12 claim 载体: 余量 $(printf '%s\n' "$_G12_JUDGE_SET" | grep -c .) 个文件回落 legacy brief 判定${RESET}"
    fi
  fi
fi

if [ -n "$_G12_JUDGE_SET" ] && [ "$_G12_CLAIM_STATUS" = "on" ] && [ -z "$ALL_TODAY_BRIEFS" ]; then
  SCOPE_VIOLATION="$(printf '%s\n' "$_G12_JUDGE_SET" | grep -v '^[[:space:]]*$' \
    | sed 's/^/  /;s/$/ (未被任何 claim 声明覆盖；且本提交无 legacy brief 载体)\n/')"
elif [ -n "$_G12_JUDGE_SET" ] && [ -n "$ALL_TODAY_BRIEFS" ]; then
  SCOPE_TSV="$ROOT/.claude/.g12-scope.tsv"
  EXCL_TSV="$ROOT/.claude/.g12-excl.tsv"
  rm -f "$SCOPE_TSV" "$EXCL_TSV"
  while IFS= read -r BRIEF; do
    [ -z "$BRIEF" ] && continue
    BNAME=$(basename "$BRIEF")
    python3 "$ROOT/scripts/control-tower/brief_parser.py" --q2-include "$BRIEF" 2>/dev/null \
      | sed "s|^|$BNAME\\t|" >> "$SCOPE_TSV" || true
    python3 "$ROOT/scripts/control-tower/brief_parser.py" --q2-exclude "$BRIEF" 2>/dev/null \
      | sed "s|^|$BNAME\\t|" >> "$EXCL_TSV" || true
  done <<< "$ALL_TODAY_BRIEFS"

  SCOPE_VIOLATION=$(python3 -c "
import re, sys
staged = '''$_G12_JUDGE_SET'''.split('\n')
def load_tsv(path):
    out = []
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.rstrip('\n')
                if '\t' in line:
                    brief, p = line.split('\t', 1)
                    if p:
                        out.append((brief, p))
    except OSError:
        pass
    return out
scope = load_tsv('''$SCOPE_TSV''')
excl = load_tsv('''$EXCL_TSV''')
def matches(path, pat):
    return re.search(r'(^|/)' + re.escape(pat) + r'\$', path) is not None
skip_re = re.compile(r'\.claude/|scripts/workflow/|\.codex/|memory/|docs/|task-state/.*\.(json|md)$|\.github/')
code_re = re.compile(r'\.(ts|tsx|js|jsx|json|py|sh)\$')
viol = []
for sf in staged:
    sf = sf.strip()
    if not sf or skip_re.search(sf) or not code_re.search(sf):
        continue
    # 认领者 = 做什么 覆盖该文件的 brief
    claimants = [b for b, p in scope if matches(sf, p)]
    if not claimants:
        viol.append(f'  {sf} (不在 Q2 范围内)')
        continue
    # 排除只来自认领者自身 — 他人 brief 的排除不适用于本文件 (跨 session 根治)
    for b, ex in excl:
        if b in claimants and matches(sf, ex):
            viol.append(f'  {sf} (Q2 排除项禁止修改: {ex}, 来自认领 brief {b})')
            break
print('\n'.join(viol))
" 2>/dev/null || true)
  rm -f "$SCOPE_TSV" "$EXCL_TSV"
fi

DECL2=""
if [ "$_DECL_IS_MERGE" = "1" ] && [ -n "$SCOPE_VIOLATION" ]; then
  _SV_F=""
  while IFS= read -r _svl; do
    [ -z "$_svl" ] && continue
    _svp="$(printf '%s' "$_svl" | sed -E 's/^[[:space:]]*//' | awk '{print $1}')"
    printf '%s\n' "$DECL_SCOPE" | grep -qxF -- "$_svp" && _SV_F="${_SV_F}${_svl}\n"
  done <<< "$(printf '%s' "$SCOPE_VIOLATION")"
  SCOPE_VIOLATION="$_SV_F"
fi
if [ -n "$SCOPE_VIOLATION" ]; then
  DECL2="${DECL2}${SCOPE_VIOLATION}\n"
  DECL2="${DECL2}     💡 改 scripts/ 需先认领 brief（Q2 写集声明）——见 docs/synova/coordination/版本管理规范-控制塔.md\n"
fi

if [ "$DECL_MERGE_SKIP" != "1" ]; then   # 合并提交无自撰文件 → 无对象（跳过行见闸① 处）
  BRIEF_PARSEABLE_OUT=$(bash "$ROOT/scripts/workflow/check-brief-parseable.sh" "${BRIEF_RESOLVED:-}" 2>&1); BP_RC=$?
  if [ "$BP_RC" -ne 0 ]; then
    DECL2="${DECL2}$(printf '%s\n' "$BRIEF_PARSEABLE_OUT" | grep -v '^[[:space:]]*$' | head -6)\n"
  fi
fi

if [ -n "${PI_Q2:-}" ]; then
  DECL2="${DECL2}${PI_Q2}"
fi

if [ "$DECL_MERGE_SKIP" != "1" ]; then
  QUIET_SUCCESS=0 decl_check "声明闸② brief↔代码一致性（Q2 写集/排除项/可解析；D1148 合并 15→3）" "${DECL2:-}"
fi

GENERATED_FILES="app/founder-dashboard.html docs/synova/founder-console.html docs/synova/product-lines/product-progress.json docs/synova/product-lines/product-progress.html docs/synova/product-lines/todos.yaml"
GENERATED_VIOLATION=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  _status="${line:0:1}"
  _path="${line:3}"
  if echo "$GENERATED_FILES" | grep -qw "$_path" 2>/dev/null && [ "$_status" = "M" -o "$_status" = "A" ]; then
    GENERATED_VIOLATION="${GENERATED_VIOLATION}  $_path (CI 单点生成物，session 禁止提交)\n"
  fi
done <<< "$(git diff --cached --name-status 2>/dev/null)"
hard_check "G12d: 生成物单点生成门禁 (D458)" "${GENERATED_VIOLATION:-}"

#   原形态: 暂存含 SYNOVA-IMPL-*.md 时执行 `scripts/workflow/check-dev-doc-write-set.sh`，
#   留痕: 本注释保留脚本名 `check-dev-doc-write-set.sh` 供 T11b 回溯；字样不再出现在**代码路径**。

echo -e "${CYAN}── 组 13/13: 技能同步一致性 ──${RESET}"
SKILL_FILES_STAGED=$(echo "$STAGED_ALL" | grep -E "\.claude/skills/|\.dsh/skills/" || true)
if [ -n "$SKILL_FILES_STAGED" ]; then
  SKILL_SYNC_OUT=$(bash "$ROOT/scripts/workflow/sync-dsh-skills.sh" --check 2>&1)
  SKILL_SYNC_EXIT=$?
  if [ "$SKILL_SYNC_EXIT" -eq 0 ]; then
    soft_pass "G13: 技能同步一致 ($(echo "$SKILL_SYNC_OUT" | head -1 | sed 's/SYNC-OK: //'))"
  elif [ "$SKILL_SYNC_EXIT" -eq 1 ]; then
    hard_check "G13: 技能漂移 — 运行 bash scripts/workflow/sync-dsh-skills.sh 后重新暂存" "$SKILL_SYNC_OUT"
  else
    hard_check "G13: 技能同步检查执行失败 (exit=$SKILL_SYNC_EXIT, D328 三态)" "$SKILL_SYNC_OUT"
  fi
else
  soft_pass "G13: 无技能文件变更(跳过)"
fi

echo -e "${CYAN}── D782: 文档真相防线（D1 真相验证 + D2 登记门禁）──${RESET}"

if [ -f "$ROOT/scripts/doc-system/check-doc-truth.sh" ]; then
  _D1_OUT="$(bash "$ROOT/scripts/doc-system/check-doc-truth.sh" 2>&1)"; _D1_RC=$?
  if [ "$_D1_RC" -ne 0 ]; then
    printf '%s\n' "$_D1_OUT" | head -5 | sed 's/^/     /'
    v5_soft "D782 D1 文档真相（D1171 撤旁路复执法）"
  fi
else
  self_fail_missing_script "D782 D1 文档真相" "scripts/doc-system/check-doc-truth.sh"
fi

if [ -f "$ROOT/scripts/doc-system/doc-registry-gate.sh" ]; then
  _D2_OUT="$(bash "$ROOT/scripts/doc-system/doc-registry-gate.sh" 2>&1)"; _D2_RC=$?
  if [ "$_D2_RC" -ne 0 ]; then
    printf '%s\n' "$_D2_OUT" | head -5 | sed 's/^/     /'
    v5_soft "D782 D2 登记门禁（D1171 撤旁路复执法）"
  fi
else
  self_fail_missing_script "D782 D2 登记门禁" "scripts/doc-system/doc-registry-gate.sh"
fi

if [ "${SYNO_SKIP_PR_BUDGET:-0}" = "1" ]; then
  echo -e "${CYAN}── PR 预算门禁 (D734) ──${RESET}"
  echo -e "  ${YELLOW}ⓘ 本地 CI 显式跳过（CTO 2026-10-11 裁定；执法位置=提交时软提示 + 开 PR 时人工判）${RESET}"
else
echo -e "${CYAN}── PR 预算门禁 (D734) ──${RESET}"
if [ -x "$ROOT/scripts/control-tower/check-pr-budget.sh" ] || [ -f "$ROOT/scripts/control-tower/check-pr-budget.sh" ]; then
  _D734_OUT="$(bash "$ROOT/scripts/control-tower/check-pr-budget.sh" --quiet 2>&1)"; _D734_RC=$?
  if [ "$_D734_RC" -ne 0 ]; then
    printf '%s\n' "$_D734_OUT" | head -5 | sed 's/^/     /'
    v5_soft "D734 PR 预算（D1171 撤旁路复执法）"
  fi
else
  self_fail_missing_script "D734 PR 预算" "scripts/control-tower/check-pr-budget.sh"
fi
fi   # ← SYNO_SKIP_PR_BUDGET 分支结束（CTO 2026-10-11）

# ── D520/任务3: 平台敏感命令软检查（V5 软提示——新增脚本须对照 PLATFORM-CHECKLIST.md）──
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

_DSH_PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then _DSH_PYBIN="$_c"; break; fi
done
if [ -z "$_DSH_PYBIN" ]; then
  soft_check "DSH 断面一致性 (D943): 无可用 python（fail-closed，不静默跳过）" "1"
elif [ ! -f "$ROOT/scripts/control-tower/check-dsh-anchor.py" ]; then
  soft_check "DSH 断面一致性 (D943): 门禁脚本缺失 scripts/control-tower/check-dsh-anchor.py" "1"
else
  _DSH_ANCHOR_OUT="$("$_DSH_PYBIN" "$ROOT/scripts/control-tower/check-dsh-anchor.py" --repo "$ROOT" --no-tree-check 2>&1)"
  _DSH_ANCHOR_RC=$?
  if [ "$_DSH_ANCHOR_RC" -eq 0 ]; then _DSH_ANCHOR_HITS=""; else _DSH_ANCHOR_HITS="$(printf '%s' "$_DSH_ANCHOR_OUT" | tail -8) (rc=$_DSH_ANCHOR_RC)"; fi
  soft_check "DSH 断面一致性 (D943)" "${_DSH_ANCHOR_HITS}"
fi

if [ -f "$ROOT/scripts/check-content-coupling.sh" ]; then
  _CC_OUT="$(bash "$ROOT/scripts/check-content-coupling.sh" 2>&1)"; _CC_RC=$?
  _CC_LINE="$(printf '%s' "$_CC_OUT" | grep -E '^CONTENT-COUPLING:' | tail -1)"
  _CC_NEW="$(printf '%s' "$_CC_LINE" | grep -oE '新增 [0-9]+' | head -1 | grep -oE '[0-9]+' || true)"
  _CC_VIOL="$(printf '%s' "$_CC_LINE" | grep -oE 'new=[0-9]+' | head -1 | grep -oE '[0-9]+' || true)"
  if [ "${_CC_NEW:-0}" != "0" ] || [ "${_CC_VIOL:-0}" != "0" ] || [ "$_CC_RC" -ne 0 ]; then
    printf '%s\n' "$_CC_OUT" | grep -E "CC[1-4] NEW" | head -5 | sed 's/^/     /'
    v5_soft "内容面耦合门禁 CC1–CC4（K12-13/#196；新增 ${_CC_NEW:-${_CC_VIOL:-?}} 条）"
  fi
else
  self_fail_missing_script "内容面耦合门禁 CC1–CC4" "scripts/check-content-coupling.sh"
fi

mkdir -p "$ROOT/.codex/checkpoints"
G10_FAIL=$([ -n "$MISMATCH" ] && echo "true" || echo "false")
G11_FAIL=$([ "$HAS_E2E" -gt 0 ] && [ "$HAS_TESTS" -eq 0 ] && echo "true" || echo "false")
CP3_STATUS="pass"; CP3_REASON="全部通过"
if [ "$G10_FAIL" = "true" ]; then CP3_STATUS="warn"; CP3_REASON="有条件区域不匹配"; fi
if [ "$G11_FAIL" = "true" ]; then CP3_STATUS="warn"; CP3_REASON="有验收无测试"; fi
python -c "
import json, os
d = {'name':'CP3: 预提交检查','status':'$CP3_STATUS','reason':'$CP3_REASON','checkedAt':'$(date -u +%Y-%m-%dT%H:%M:%SZ)'}
os.makedirs('$ROOT/.codex/checkpoints', exist_ok=True)
with open('$ROOT/.codex/checkpoints/cp3-commit-check.json','w') as f:
    json.dump(d, f)
" 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$HARD_FAIL" -gt 0 ]; then
  echo -e "  ${RED}❌ ${HARD_FAIL} 组未通过 — 提交已拒绝${RESET}"
  [ "${GITHUB_ACTIONS:-}" = "true" ] && echo "::error title=IronLaws:提交已拒绝::${HARD_FAIL} 组未通过（详见上方 ❌ 行）"
  [ "$WARN_COUNT" -gt 0 ] && echo -e "  ${YELLOW}⚠️  ${WARN_COUNT} 项警告${RESET}"
  [ "$SOFT_COUNT" -gt 0 ] && echo -e "  ${YELLOW}⚠ V5: ${SOFT_COUNT} 项软提示（详情见上）——CI 为权威，本地不阻断${RESET}"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  exit 1
else
  echo -e "  ${GREEN}✅ 全部 13 组通过${RESET}"
  [ "$WARN_COUNT" -gt 0 ] && echo -e "  ${YELLOW}⚠️  ${WARN_COUNT} 项警告 (不阻断)${RESET}"
  [ "$SOFT_COUNT" -gt 0 ] && echo -e "  ${YELLOW}⚠ V5: ${SOFT_COUNT} 项软提示（详情见上）——CI 为权威，本地不阻断${RESET}"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  exit 0
fi
