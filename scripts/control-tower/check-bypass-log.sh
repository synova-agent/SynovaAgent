#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-bypass-log.sh — D331 (L4-2 / P1-2): bypass.log 执行证据链对账
#
# 背景: D329 的 dc369fd 经 git commit --amend 重提交 — synova-commit 的 pathspec
# 提交（-- "${FILES[@]}"）不含删除/改回，配套变更须 amend 并入；amend 绕过了
# synova-commit 的 COMMITTED 记录写入，导致版本锚点 tag 与执行证据链同时断裂
# （tag V4.7.1 孤儿 f685fa0 + dc369fd 无 bypass.log 记录），无人发现（无对账方）。
#
# 对账（D1068 起为三态）:
#   态 1 提交消息含 `PreCommit-PASS: <sha256>` trailer（新载体，由 synova-commit 写入）
#   态 2 无 trailer 但旧账本 `.claude/bypass.log` 含该提交 SHA（兼容过渡期）
#   态 3 两者皆无 ⇒ 列出 + exit 1（新提交硬要求）；全部有证据 → exit 0。
#
# 用法: bash check-bypass-log.sh [base-ref]
#       默认 base: origin/feat/prompt-architecture（D311 改基约定）
# 注入: SYNO_BASE_REF 环境变量覆盖（测试隔离；显式给出则必须可解析）
# 豁免: 历史提交一次性补记（D331 已对 ea1cb71/dc369fd 回填）；对账从 D331 起强制
# 降级: base 不可解析且非显式 → fetch 一次后仍不可用 → 显式跳过 exit 2（fail-closed，
#       不当作通过 — D414/U1c 修复 M1 假 PASS）
#       D1068: 旧日志**不再是存在性前提**（载体已迁移）；无来源时转纯 trailer 对账，
#       「都缺证据」由态 3 给出 exit 1，不靠「文件不存在」误拦空区间。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LOG="$ROOT/.claude/bypass.log"
# D735 Stage 1: 对账来源 = 旧路径 + per-session 新落点（union）。
# Stage 1 旧路径仍权威；union 读保证「登记写在新落点、对账只读旧路径」不会误判缺记录。
LEDGER_SH="$ROOT/scripts/control-tower/bypass-ledger.sh"
LEDGER_SOURCES=""
_HAS_LEDGER=0
if [ -f "$LEDGER_SH" ]; then
  _SRC_OUT="$(bash "$LEDGER_SH" sources 2>/dev/null)" || _SRC_OUT=""  # swallow-ok: 解析器失败即回退旧路径（下行显式判定）
  [ -n "$_SRC_OUT" ] && { LEDGER_SOURCES="$_SRC_OUT"; _HAS_LEDGER=1; }
fi
if [ "$_HAS_LEDGER" -eq 0 ] && [ -f "$LOG" ]; then LEDGER_SOURCES="$LOG"; _HAS_LEDGER=1; fi
BASE="${SYNO_BASE_REF:-${1:-origin/feat/prompt-architecture}}"

# D513/③(Win 37dc1cae 根因): 防御性刷新 base —— `git push <URL>` 不更新本地
# remote-tracking ref，BASE 解析到陈旧 ref → merge-base 化失效 → 对账范围扩大 →
# 补记循环（Win 实测 11 条）。fetch 最新 tracking ref 后再对账；失败不阻断（显式
# 降级——本地 ref 至少是最新的已知态，比静默用陈旧 ref 强）。
_base_remote="${BASE%%/*}"
_base_branch="${BASE#*/}"
if [ -n "$_base_remote" ] && [ "$_base_remote" != "$_base_branch" ] && [ "${SYNO_BASE_REF:-}" = "" ]; then
  # D515 项9: fetch 失败不再纯静默 — 显式提示 tracking ref 可能陈旧（Codex P10）
  if ! git fetch --no-tags "$_base_remote" "$_base_branch" --quiet 2>/dev/null; then  # swallow-ok: 失败走下方显式降级提示
    echo "⚠ fetch 失败——base 可能陈旧（push URL 不更新 tracking ref）；建议 git fetch origin 后重试"  # swallow-ok: 降级用本地 ref（铁律 11 显式）
  fi
fi
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

# D1068: 旧日志**不再是存在性前提** —— 证据载体已迁至 commit trailer。
#   仅当「既无旧日志、也无任何账本来源」且**本区间还真有需要证据的提交**时，才由下方
#   逐提交判定给出 fail-closed（exit 1）。空区间不得因为「文件不在」而误拦。
if [[ ! -f "$LOG" ]] && [ "$_HAS_LEDGER" -eq 0 ]; then
  echo -e "${YELLOW}ℹ D1068: 旧日志不存在且无账本来源 — 转为纯 trailer 对账${RESET}"
fi

# base 可解析性: 显式 SYNO_BASE_REF 不可解析 → 硬错误（测试/调用方给错引用须显式暴露）
if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  if [[ -n "${SYNO_BASE_REF:-}" ]]; then
    echo -e "${RED}❌ base 不可解析: $BASE${RESET}"
    exit 1
  fi
  git fetch origin >/dev/null 2>&1 || true
  if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  base 引用缺失 ($BASE) — 对账无法执行（fail-closed，exit 2 不当作通过）${RESET}"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) check-bypass-log degraded: base $BASE 不可解析, 对账跳过" >> "$ROOT/.claude/degraded-events.log" 2>/dev/null || true
    exit 2
  fi
fi

MISSING=""
# D1068: 证据形态计数（收尾输出用，便于区分过渡期两态分布）
_EVIDENCE_TRAILER=0
_EVIDENCE_LEGACY=0
# D334: --no-merges — PR 工作流下 GitHub 网页合并产生的 merge commit 不经过
# synova-commit（无 COMMITTED 记录），对账只覆盖本地产生的实体提交。
# D414/U1c: git log 失败检测 — 原 `|| true` 会把"git 失败空循环"当成"对账通过"（M1 假 PASS）。
# D451: 豁免"纯补记提交"——只改 .claude/bypass.log 的提交本身就是补记动作，
#   它改的就是证据文件，不能被要求"自己被自己记录"（否则补记→新提交→再缺→死循环）。
# D508: 对账范围 merge-base 化（范围收窄优化）——"$BASE..HEAD" 在 merge main 后
#   会把 main 侧已验提交也落入范围，只制造补记噪音；merge-base 起点后范围=分支自己的
#   新提交，main 引入提交天然排除（merge-base 是其祖先）。
#   如实注记（D561，K3 P1-D508——原注释声称「6+ 次补记循环根治」不实）:
#   merge-base 化只是范围收窄，非根治——已 merge 场景下 merge-base(BASE, HEAD) 收敛到
#   同一点，范围与原语义恒等；补记循环的真根治 = D513 防御性 fetch 刷新（本文件上方，
#   tracking ref 陈旧才是根因）+ D451 纯补记豁免（打断「补记→新提交→再缺」死循环）。
MB=$(git merge-base "$BASE" HEAD 2>/dev/null || echo "")
if [ -n "$MB" ]; then
  RANGE="${MB}..HEAD"
else
  RANGE="$BASE..HEAD"  # 无共同历史 → 回退原语义
fi
GIT_LOG_OUT=$(git log "$RANGE" --format=%H --no-merges 2>&1)
if [ $? -ne 0 ]; then
  echo -e "${RED}❌ git log 执行失败 ($BASE..HEAD) — 对账无法执行（fail-closed, 不当作通过）${RESET}" >&2
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) check-bypass-log degraded: git log $BASE..HEAD 失败" >> "$ROOT/.claude/degraded-events.log" 2>/dev/null || true
  exit 2
fi
for h in $GIT_LOG_OUT; do
  # D451: 纯补记提交（只改 bypass.log）豁免——它是补记动作本身
  _FILES=$(git show --name-only --format="" "$h" 2>/dev/null | grep -v '^$' || true)
  _OTHER=$(echo "$_FILES" | grep -v '^\.claude/bypass\.log$' || true)
  if [ -z "$_OTHER" ]; then
    continue
  fi

  # ═══ D1068 三态对账（本卡机制核）═══
  # 态 1 — 新载体: 提交消息含 `PreCommit-PASS: <sha256>` trailer ⇒ 通过。
  #   用 git 自己的 %(trailers) 解析（不靠 grep 正文，避免消息体里恰好出现同串而误判通过）。
  # 态 2 — 旧载体（兼容过渡）: 无 trailer，但旧账本里有该提交 SHA ⇒ 仍通过。
  #   D331 意图（「每个非历史提交须有证据」）在过渡期不被破坏。
  # 态 3 — 两者皆无 ⇒ 拦（exit 1）。这就是「改坏即红」的判据：一旦 trailer 不再写入，
  #   新提交落入态 3 —— 不会被旧日志的存在掩盖。
  _TRAILER=$(git log -1 --format='%(trailers:key=PreCommit-PASS,valueonly)' "$h" 2>/dev/null | tr -d ' \r\n')  # swallow-ok: git log 失败=该提交无 trailer，落入下方态2/态3 判定（非静默通过）
  if [ -n "$_TRAILER" ]; then
    _EVIDENCE_TRAILER=$((_EVIDENCE_TRAILER + 1))
    continue
  fi
  # 态 2: 旧账本（多来源，换行分隔）——任一命中即通过
  _LEGACY_OK=0
  if [ "$_HAS_LEDGER" -eq 1 ]; then
    # shellcheck disable=SC2086  # 有意分词: LEDGER_SOURCES 是换行分隔的多文件列表
    if grep -q "$h" $LEDGER_SOURCES 2>/dev/null; then _LEGACY_OK=1; fi
  fi
  if [ "$_LEGACY_OK" -eq 1 ]; then
    _EVIDENCE_LEGACY=$((_EVIDENCE_LEGACY + 1))
    continue
  fi
  SUBJ=$(git log -1 --format=%s "$h" 2>/dev/null || echo "$h")
  MISSING="${MISSING}  $SUBJ [${h:0:8}]\n"
done

if [[ -n "$MISSING" ]]; then
  echo -e "${RED}❌ 以下提交既无 PreCommit-PASS trailer、也无旧账本记录（执行证据链断裂）:${RESET}"
  printf '%b' "$MISSING"
  echo "  请确认提交经 synova-commit（写入 trailer）或一次性补记后再推送"
  echo -e "  ${YELLOW}提示: 态1=trailer / 态2=旧 bypass.log（兼容过渡）/ 态3=两者皆无（本条即态3）${RESET}"
  exit 1
fi

echo -e "${GREEN}✅ 门禁证据对账通过: ${RANGE} 全部提交有证据${RESET}"
echo -e "   证据形态分布: trailer=${_EVIDENCE_TRAILER} 笔 / 旧账本（兼容）=${_EVIDENCE_LEGACY} 笔"
exit 0
