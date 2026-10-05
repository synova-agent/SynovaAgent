#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-bypass-log.sh — D331 (L4-2 / P1-2): bypass.log 执行证据链对账
#
# 背景: D329 的 dc369fd 经 git commit --amend 重提交 — synova-commit 的 pathspec
# 提交（-- "${FILES[@]}"）不含删除/改回，配套变更须 amend 并入；amend 绕过了
# synova-commit 的 COMMITTED 记录写入，导致版本锚点 tag 与执行证据链同时断裂
# （tag V4.7.1 孤儿 f685fa0 + dc369fd 无 bypass.log 记录），无人发现（无对账方）。
#
# 对账: 对比 <base>..HEAD 范围内**本机要新推的提交**（D1152，见下）与 bypass 账本的 HASH 条目
#       （D1145 起来源 = per-session 权威账本 `.sessions/<sid>/bypass.log` ∪ 本地镜像
#        `.claude/bypass.log`）；缺失 → 列出 + exit 1（新提交硬要求）；全部有记录 → exit 0。
#
# 用法: bash check-bypass-log.sh [base-ref]
#       默认 base: origin/feat/prompt-architecture（D311 改基约定）
# 注入: SYNO_BASE_REF 环境变量覆盖（测试隔离；显式给出则必须可解析）
# 豁免: 历史提交一次性补记（D331 已对 ea1cb71/dc369fd 回填）；对账从 D331 起强制
# 降级: 日志缺失 → exit 1（执行证据链缺失显式列出）；base 不可解析且非显式
#       → fetch 一次后仍不可用 → 显式跳过 exit 2（fail-closed，不当作通过 — D414/U1c 修复 M1 假 PASS）
#
# D1152（#1075 阻塞根修 — 跨机证据链，独立复核判阻塞后的最小修）:
#   病灶（复核席实测）: D1145 停跟踪 + 删影子提交后，COMMITTED 行不再随 git 走 ⇒
#     ① 新 clone（.claude/bypass.log 天然不存在）→「全部来源皆空」→ exit 1（假红）；
#     ② 他机拉本分支再推时，range 里列着**别人机已过闸**的提交 → 永久误拦。
#   修法（两处，不再引入新机制、不恢复被跟踪账本）:
#     ① 对账范围收窄为「本机要新推的提交」: range 内每个 sha，若已是 <远端>/<当前分支>
#        的祖先（= 已推到远端 ⇒ 别人机过闸）⇒ 跳过。**ref 缺失（首次推送 / 无远端）⇒
#        不过滤**（全部提交按待记录，fail-closed）——绝不因 ref 取不到把集合算成空集
#        （那等于对首次推送永久免检）。ref 先 fetch 刷新（D513 同源病灶:
#        `git push <URL>` 不更新 remote-tracking ref ⇒ 用陈旧 ref 判祖先会误判）。
#     ② 「全部来源皆空 → exit 1」**条件化**: 先算待记录集合，**空集 ⇒ exit 0**
#        （fresh clone 典型态）；非空且来源全空 ⇒ 仍 exit 1（fail-closed 保留）。
#   判据顺序（不可反）: 待记录集合 ⇒ 空 ⇒ 0；非空 ⇒ 才查来源/可解析性
#     （来源全空 ⇒ 1；base 不可解析 ⇒ 显式 1 / 非显式 2 —— 两条 fail-closed 都保留）。
#   三态不变: 0=无待记录或全部有记录；1=缺记录/来源全空/显式 base 不可解析；2=执行失败。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LOG="$ROOT/.claude/bypass.log"
# D1145 / D735 Stage 2: 对账来源 = **per-session 权威账本**（`.sessions/<sid>/bypass.log`）
#   + 本地兼容镜像（`.claude/bypass.log`，D1145 起已停跟踪 ⇒ 新 clone / CI 里不存在属正常态）。
#   union 读保证「账本写在 per-session、镜像不存在」不会误判缺记录。
LEDGER_SH="$ROOT/scripts/control-tower/bypass-ledger.sh"
LEDGER_SOURCES="$LOG"
if [ -f "$LEDGER_SH" ]; then
  _SRC_OUT="$(bash "$LEDGER_SH" sources 2>/dev/null)" || _SRC_OUT="$LOG"  # swallow-ok: 解析器失败即回退旧路径（显式赋值，非静默跳过对账）
  [ -n "$_SRC_OUT" ] && LEDGER_SOURCES="$_SRC_OUT"
fi
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

# D334: --no-merges — PR 工作流下 GitHub 网页合并产生的 merge commit 不经过
# synova-commit（无 COMMITTED 记录），对账只覆盖本地产生的实体提交。
# D414/U1c: git log 失败检测 — 原 `|| true` 会把"git 失败空循环"当成"对账通过"（M1 假 PASS）。
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

# ═══ D1152/①: 本机要新推的提交 —— 「已是 <远端>/<当前分支> 祖先」者跳过 ═══
# 语义: 已推到远端的提交 = 产生它的机器上已过闸（账本在该机器本地，不随 git 走），
#   本机不重复要求；本机新提交照旧逐条要求（对账强度不降）。
# ref 缺失（首次推送 / 无远端 / detached HEAD）⇒ 过滤关闭 = 全部按待记录（fail-closed）。
CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"  # swallow-ok: 失败=非 git 环境, 空值即走下方"过滤关闭"
PUSH_REMOTE="origin"
if [ -n "${_base_remote:-}" ] && [ "$_base_remote" != "$_base_branch" ] && git remote 2>/dev/null | grep -qx -- "$_base_remote"; then  # swallow-ok: git remote 失败=非 git 环境 → 用默认 origin
  PUSH_REMOTE="$_base_remote"  # base 带远端前缀（origin/main）⇒ 用同一远端判祖先，避免跨远端错判
fi
ANCESTOR_REF=""
if [ -n "$CUR_BRANCH" ] && [ "$CUR_BRANCH" != "HEAD" ]; then
  # D513 同源: 先 fetch 刷新再到判定（push URL 不更新 remote-tracking ref ⇒ 陈旧 ref 误判祖先）
  if ! git fetch --no-tags "$PUSH_REMOTE" "$CUR_BRANCH" --quiet 2>/dev/null; then  # swallow-ok: 失败走下方显式提示 + 用本地 tracking ref（不静默）
    echo -e "${YELLOW}⚠ fetch 失败——${PUSH_REMOTE}/${CUR_BRANCH} 可能陈旧（push URL 不更新 tracking ref）${RESET}" >&2
  fi
  if git rev-parse --verify --quiet "${PUSH_REMOTE}/${CUR_BRANCH}" >/dev/null 2>&1; then
    ANCESTOR_REF="${PUSH_REMOTE}/${CUR_BRANCH}"
  fi
fi
if [ -z "$ANCESTOR_REF" ]; then
  # 显式说明（派单要求）: 不静默改变判定——"跳过该优化"= 全部提交按待记录要求
  echo -e "${YELLOW}⚠️  ${PUSH_REMOTE}/<当前分支> 不可解析（分支=${CUR_BRANCH:-detached}）—— 跳过「他机已过闸」优化，range 内全部提交按待记录要求（fail-closed）${RESET}" >&2
  _SCOPE_NOTE="未启用他机已过闸过滤（ref 不可解析）"
else
  _SCOPE_NOTE="已排除 ${ANCESTOR_REF} 祖先（他机已过闸）"
fi

# 待记录集合 = range 内 ①非纯补记提交（D451）②非他机已过闸提交（D1152）
PENDING=""; PENDING_N=0
for h in $GIT_LOG_OUT; do
  # D451: 纯补记提交（只改 bypass.log）豁免——它是补记动作本身
  _FILES=$(git show --name-only --format="" "$h" 2>/dev/null | grep -v '^$' || true)
  _OTHER=$(echo "$_FILES" | grep -v '^\.claude/bypass\.log$' || true)
  if [ -z "$_OTHER" ]; then
    continue
  fi
  # D1152/①: 已是远端分支祖先 ⇒ 他机已过闸，本机不重复要求
  if [ -n "$ANCESTOR_REF" ] && git merge-base --is-ancestor "$h" "$ANCESTOR_REF" 2>/dev/null; then  # swallow-ok: 非祖先=条件假（本机新提交），静默可接受
    continue
  fi
  PENDING="${PENDING}${h}"$'\n'
  PENDING_N=$((PENDING_N + 1))
done

# ── D1152/②: 空集 ⇒ exit 0（fresh clone 典型态：无本机新提交）──
# 顺序硬要求: 此判定必须在「来源是否为空」之前——否则 fresh clone 里 .claude/bypass.log
# 天然不存在 ⇒ 假红 exit 1（#1075 阻塞项的根因）。
if [ "$PENDING_N" -eq 0 ]; then
  echo -e "${GREEN}✅ bypass.log 对账通过: 无待记录提交（${RANGE}；${_SCOPE_NOTE}）${RESET}"
  exit 0
fi

# ── 非空 ⇒ 才查来源（fail-closed 保留，D1145 语义不变）──
#   停跟踪后 `.claude/bypass.log` 在新 clone / CI 不存在属正常态；只有**所有来源都不存在**
#   （= 对账无任何数据源，且确实有待记录提交）才 exit 1。
_existing_sources=0
for _s in $LEDGER_SOURCES; do  # shellcheck disable=SC2086  # 有意分词: LEDGER_SOURCES 是换行分隔列表
  [ -f "$_s" ] && _existing_sources=$((_existing_sources + 1))
done
if [ "$_existing_sources" -eq 0 ]; then
  echo -e "${RED}❌ bypass 账本不存在（全部来源均为空）—— 但本机有 ${PENDING_N} 条待记录提交${RESET}"
  echo "  已查来源: $(printf '%s ' $LEDGER_SOURCES)"
  echo "  执行证据链缺失 — 请确认提交均经 synova-commit（含 COMMITTED 记录）或一次性补记"
  exit 1
fi

MISSING=""
for h in $PENDING; do
  # D735 Stage 1: 在全部来源里找（旧路径 + per-session）；多文件 grep 任一命中即通过
  # shellcheck disable=SC2086  # 有意分词: LEDGER_SOURCES 是换行分隔的多文件列表
  if ! grep -q "$h" $LEDGER_SOURCES 2>/dev/null; then
    SUBJ=$(git log -1 --format=%s "$h" 2>/dev/null || echo "$h")
    MISSING="${MISSING}  $SUBJ [${h:0:8}]\n"
  fi
done

if [[ -n "$MISSING" ]]; then
  echo -e "${RED}❌ bypass.log 缺以下提交记录（执行证据链断裂）:${RESET}"
  printf '%b' "$MISSING"
  echo "  请确认提交经 synova-commit（含 COMMITTED 记录）或一次性补记后再推送"
  exit 1
fi

echo -e "${GREEN}✅ bypass.log 对账通过: ${PENDING_N} 条本机待推提交全部有记录（${RANGE}；${_SCOPE_NOTE}）${RESET}"
exit 0
