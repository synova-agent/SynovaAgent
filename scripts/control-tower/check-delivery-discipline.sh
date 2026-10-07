#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# check-delivery-discipline.sh — D796 交付纪律三闸（物理固化）
#
# 背景（创始人 2026-09-17 三次点名同类问题复发）：
#   ① 交付"文件写好了"就当完工（未 commit / 未开 PR，K3 无法审计、有丢失风险）
#   ② 执行方在**别人的任务分支工作区**里直接改文件（弄脏 D782 分支，D320 劫持同类风险）
#   ③ 派单文档没写"brief 前置 / 写集机器生成 / PR 完工"，执行方走到最后一步才发现提交不了
#   本仓 V3.9 教训：「信息注入型检查对 agent 不可见，软机制 0% 有效，硬阻断 100% 有效」
#   → 三条一律改为**物理检查**，不再写进文档靠自律。
#
# 用法:
#   bash scripts/control-tower/check-delivery-discipline.sh [--files "<换行列表>"] [--repo <root>]
#   bash scripts/control-tower/check-delivery-discipline.sh --scan      # 工作区游离改动扫描
#
# 契约（铁律 47）:
#   @input  — --files 覆盖变更集（默认 `git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR`）
#             --repo 仓库根（默认 git toplevel）｜ --scan 扫描模式（不看暂存区，看工作区游离改动）
#   @output — 逐项 ✅/❌ 点名 + 尾行 DISCIPLINE-OK / DISCIPLINE-FAIL / DISCIPLINE-DEGRADED
#   @exit   — 0 = 通过 ｜ 1 = 发现违规（业务阻断）｜ 2 = 检查自身降级/执行失败（fail-closed，不与通过混同）
#   @degraded — 非 git 仓库 / 无 brief（C1 降级为显式提示，C2/C3 仍生效）/ scan 模式无 HEAD
#
# 三闸:
#   C1 工作区归属（防弄脏别人的分支）:
#        变更集含代码路径（src|scripts|dsh|tests|packages|electron*|app/）时：
#        若 brief 的任务号与本分支任务号都存在且不一致 → ❌
#        若当前分支为 main/master 且含代码路径 → ❌（禁在共享分支上直接改/提交）
#   C2 完工落库（防"文件写好了"当完工）:
#        staged 的 task-state/D###.json 若 status ∈ {impl_done,audited,done,closed} →
#        ① impl 字段非空且含 PR(#N)/branch 引用 → 否则 ❌
#        ② brief 机器写集块内路径必须全部被 git 跟踪（git ls-files）→ 否则 ❌（"写好了没进 git"）
#        ③ brief 必须存在且含机器写集块 → 否则 ❌（brief 前置）
#   C3 派单纪律（派单文档缺件即拦）:
#        staged 的 docs/synova/coordination/*派单*.md 必须含四件套：
#        ① worktree/分支要求 ② task brief 前置 ③ 写集机器生成(declare-write-set) ④ 完工判据=PR
#   --scan: 打印当前分支任务号 + 游离（未跟踪/已修改）代码文件；存在游离代码改动 → exit 1
# 红线: 只读检查，不修改任何文件；不联网；不碰 scripts/audit/**
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

CODE_RE='^(src|scripts|dsh|tests|packages|electron|electron-renderer|app)/'
DONE_STATUS_RE='"status"[[:space:]]*:[[:space:]]*"(impl_done|audited|done|closed)"'
SCAN=0; REPO=""; FILES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --files) FILES="${2:-}"; shift 2 ;;
    --repo)  REPO="${2:-}";  shift 2 ;;
    --scan)  SCAN=1; shift ;;
    *) echo "❌ check-delivery-discipline: 未知参数 $1" >&2; exit 2 ;;
  esac
done
if [ -z "$REPO" ]; then REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "DISCIPLINE-DEGRADED: 非 git 仓库，无法判定"; exit 2; }; fi
cd "$REPO" || { echo "DISCIPLINE-DEGRADED: 无法进入仓库 $REPO"; exit 2; }
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || { echo "DISCIPLINE-DEGRADED: 无 HEAD"; exit 2; }
# 分支/ brief 的任务号提取必须**大小写不敏感**：真实分支名是小写（feat/d782-doc-truth-wiring），
#   漏掉它 = D794 那类"改在别人分支上"完全不报警（本卡反向测试亲证）。
BRANCH_D="$(printf '%s' "$BRANCH" | grep -oiE 'd[0-9]{3}' | head -1 | tr '[:lower:]' '[:upper:]' || true)"

# brief 解析：.claude/current-brief → 否则最新 task-briefs/*.md
BRIEF=""
if [ -f .claude/current-brief ]; then
  _cb="$(tr -d '\r\n' < .claude/current-brief)"
  [ -f "$_cb" ] && BRIEF="$_cb"
fi
if [ -z "$BRIEF" ]; then
  BRIEF="$(ls -t .claude/task-briefs/*.md 2>/dev/null | head -1 || true)"
fi
BRIEF_D=""
[ -n "$BRIEF" ] && BRIEF_D="$(grep -oiE 'd[0-9]{3}' "$BRIEF" 2>/dev/null | head -1 | tr '[:lower:]' '[:upper:]' || true)"

FAIL=0
ok(){ echo "  ✅ $1"; }
bad(){ echo "  ❌ $1"; FAIL=1; }
note(){ echo "  ℹ️  $1"; }

# ── --scan: 工作区游离改动扫描（防"改在别人的工作区 / 改了没提交"）──
if [ "$SCAN" = "1" ]; then
  echo "── D796 C-SCAN: 工作区游离改动（分支=${BRANCH} 任务号=${BRANCH_D:-无}）──"
  DIRTY="$(git -c core.quotepath=false status --porcelain 2>/dev/null | awk '{print $2}' | grep -E "$CODE_RE" || true)"
  if [ -n "$DIRTY" ]; then
    bad "存在游离代码改动（未提交/未跟踪）$(printf '%s\n' "$DIRTY" | grep -c . ) 个——交付前必须先 commit 到自己的分支并开 PR"
    printf '%s\n' "$DIRTY" | head -12 | sed 's/^/       /'
    echo "DISCIPLINE-FAIL: 游离改动未落库"
    exit 1
  fi
  ok "无游离代码改动"
  echo "DISCIPLINE-OK: 工作区干净（代码路径）"
  exit 0
fi

if [ -z "$FILES" ]; then
  FILES="$(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"
fi
FILES="$(printf '%s\n' "$FILES" | sed '/^$/d')"
echo "── D796 交付纪律三闸（分支=${BRANCH}｜brief=${BRIEF_D:-无}｜文件 $(printf '%s\n' "$FILES" | grep -c . ) 个）──"
if [ -z "$FILES" ]; then ok "无暂存变更（跳过）"; echo "DISCIPLINE-OK: 无变更"; exit 0; fi

# ── C1 工作区归属 ──
CODE_FILES="$(printf '%s\n' "$FILES" | grep -E "$CODE_RE" || true)"
if [ -n "$CODE_FILES" ]; then
  if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
    bad "C1: 当前在共享分支 ${BRANCH} 上改代码——禁直接提交，请开自己的 worktree：git worktree add -b feat/dNNN-<slug> ../synova-wt-dNNN"
  elif [ -n "$BRANCH_D" ] && [ -n "$BRIEF_D" ] && [ "$BRANCH_D" != "$BRIEF_D" ]; then
    bad "C1: 任务号不一致——brief=${BRIEF_D} 但分支=${BRANCH}（含 ${BRANCH_D}）：你正在**别人的任务分支**上改代码（D320 劫持风险）→ 换自己的 worktree"
  elif [ -z "$BRIEF_D" ]; then
    note "C1 降级: 未找到 brief（无任务号）→ 无法比对分支归属；C2/C3 仍生效"
  else
    ok "C1: 分支归属一致（${BRIEF_D}）"
  fi
else
  ok "C1: 无代码路径变更（跳过）"
fi

# ── C2 完工落库 ──
TS_DONE=""
while IFS= read -r f; do
  case "$f" in task-state/D*.json) [ -f "$f" ] && grep -qE "$DONE_STATUS_RE" "$f" && TS_DONE="${TS_DONE}${f}\n" ;; esac
done <<< "$FILES"
TS_DONE="$(printf '%b' "$TS_DONE" | sed '/^$/d')"
if [ -n "$TS_DONE" ]; then
  while IFS= read -r card; do
    [ -z "$card" ] && continue
    d="${card#task-state/}"; d="${d%.json}"
    # ① impl 非空且含 PR/branch 引用
    impl_ok=0
    if grep -qE '"impl"[[:space:]]*:[[:space:]]*"[^"]*#[0-9]+' "$card" || grep -qE '"impl"[[:space:]]*:[[:space:]]*"[^"]*branch' "$card"; then impl_ok=1; fi
    if grep -qE '"impl"[[:space:]]*:[[:space:]]*\{' "$card"; then impl_ok=1; fi   # 结构化 impl（含 pr_merged 数组）也算
    [ "$impl_ok" = "1" ] && ok "C2: ${d} impl 有落库引用" || bad "C2: ${d} 标完工但 impl 为空/无 PR·branch 引用——「文件写好了」不算完工，必须 commit+push+开 PR 后回填"
    # ③ brief 前置 + 机器写集块
    if [ -z "$BRIEF" ] || ! grep -q '写集（机器生成' "$BRIEF"; then
      bad "C2: 缺 brief 或 brief 无机器写集块（${d}）→ 先建 .claude/task-briefs/<date>-${d}-*.md，再 bash scripts/control-tower/declare-write-set.sh --brief <brief> --staged"
    else
      # ② 写集路径全部被 git 跟踪
      UNTRACKED=""
      while IFS= read -r p; do
        case "$p" in dsh/*|src/*|scripts/*|tests/*|packages/*|app/*|electron*) ;;
          *) continue ;; esac
        git ls-files --error-unmatch "$p" >/dev/null 2>&1 || UNTRACKED="${UNTRACKED}${p}\n"
      # 解析范围 = 从「写集（机器生成」标题到下一个 `## ` 标题（**不能停在空行**——真实生成的块
      #   标题后紧跟空行，用 /^$/ 截止会解析出 0 条路径 = 该检查永不生效；本卡反向测试亲证）。
      done < <(awk '/写集（机器生成/{f=1;next} f&&/^## /{f=0} f' "$BRIEF" \
                 | grep -oE '^\|[[:space:]]*[^ |]+' | sed 's/^|[[:space:]]*//' \
                 | grep -E '/.*\.' | grep -v '^文件' || true)
      if [ -n "$UNTRACKED" ]; then
        bad "C2: ${d} 写集路径未进 git（$(printf '%b' "$UNTRACKED" | sed '/^$/d' | tr '\n' ' ')）——「写好了没落库」= 不可审计、可丢失"
      else
        ok "C2: ${d} 写集路径全部已入库"
      fi
    fi
  done <<< "$TS_DONE"
else
  ok "C2: 无完工态 task-state 变更（跳过）"
fi

# ── C3 派单纪律（四件套）──
DISPATCH="$(printf '%s\n' "$FILES" | grep -E '^docs/synova/coordination/.*派单.*\.md$' || true)"
if [ -n "$DISPATCH" ]; then
  while IFS= read -r doc; do
    [ -z "$doc" ] && continue; [ -f "$doc" ] || continue
    miss=""
    grep -qE 'worktree' "$doc" || miss="${miss}①worktree/分支要求 "
    grep -qE 'task brief|brief' "$doc" || miss="${miss}②brief 前置 "
    grep -qE 'declare-write-set' "$doc" || miss="${miss}③写集机器生成 "
    grep -qE 'PR' "$doc" || miss="${miss}④完工判据=PR "
    if [ -n "$miss" ]; then bad "C3: $(basename "$doc") 缺交付纪律四件套: ${miss}"; else ok "C3: $(basename "$doc") 四件套齐备"; fi
  done <<< "$DISPATCH"
else
  ok "C3: 无派单文档变更（跳过）"
fi

if [ "$FAIL" -eq 0 ]; then echo "DISCIPLINE-OK: 三闸通过"; exit 0; fi
echo "DISCIPLINE-FAIL: 交付纪律三闸未过——按上面点名修正（不是提示，是阻断：CI 上为硬阻断）"
exit 1
