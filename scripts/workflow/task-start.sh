#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# task-start.sh — Loop Engineering V4.5.1: 任务启动检查点
#
# 生成 task brief → D200 context-injector 注入权威文档上下文
#
# 用法:
#   bash scripts/workflow/task-start.sh "任务描述"
#   bash scripts/workflow/task-start.sh "任务描述" --session-id <sid>
#   bash scripts/workflow/task-start.sh "任务描述" --create-worktree <sid>
#   TASK_DESC="任务描述" bash scripts/workflow/task-start.sh
#
# D539: 主仓只读化 + 开工强制 worktree + 会话专属 current-brief（CT-42 写侧闭环）
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ═══ D539: 可选参数解析（--session-id / --create-worktree，剥离后不污染 TASK_DESC）═══
# 铁律 47 契约: @input args; @output SESSION_ID_FLAG / CREATE_WT / TASK_DESC; 缺值 → 报错 exit 1
SESSION_ID_FLAG=""; CREATE_WT=""; ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session-id)
      if [[ $# -ge 2 ]]; then SESSION_ID_FLAG="$2"; shift 2; else echo "❌ --session-id 需要值"; exit 1; fi ;;
    --create-worktree)
      if [[ $# -ge 2 ]]; then CREATE_WT="$2"; shift 2; else echo "❌ --create-worktree 需要值"; exit 1; fi ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
TASK_DESC="${ARGS[*]:-${TASK_DESC:-}}"

if [[ -z "$TASK_DESC" ]]; then
  echo "❌ 用法: bash scripts/workflow/task-start.sh \"任务描述\" [--session-id <sid>] [--create-worktree <sid>]"
  exit 1
fi
TASK_ID_RAW="${TASK_ID:-}"  # D539: 捕获原始 env TASK_ID（可空），供 _resolve_session_id 末位回退——避免被下方的 `${TODAY}-auto` 默认值顶替（否则 session-id 永不为空，"回退全局"路径不可达）

# ═══ D539: 降级记录（degraded-events.log，铁律 11 不静默）═══
CT_DIR="${SYNO_CT_DIR:-$PROJECT_ROOT/.codex/control-tower}"
DEGRADED_LOG="$CT_DIR/logs/degraded-events.log"
_degraded_log() {
  # 契约(铁律 47): @input $1=component $2=reason; @output append degraded-events.log;
  #               @degraded 写失败静默（降级记录失败不阻断脚本，铁律 31）
  local comp="$1" reason="$2"
  mkdir -p "$(dirname "$DEGRADED_LOG")" 2>/dev/null || true  # swallow-ok: 目录创建失败不阻断
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"$comp\", \"reason\": \"$reason\"}" >> "$DEGRADED_LOG" 2>/dev/null || true  # swallow-ok: 降级记录失败不阻断
}

# ═══ D539: 会话 id 解析（CT-42 写侧对齐 attach.py(D329) / resolver --session / sop-gate(DSH_SESSION_ID)）═══
_resolve_session_id() {
  # 契约(铁律 47):
  #   @input  — $SESSION_ID_FLAG (--session-id arg) > DSH_SESSION_ID env > $PROJECT_ROOT git branch > TASK_ID_RAW (env TASK_ID, 可空)
  #   @output — session id 字符串（可空）
  #   @degraded — 全不可解析 → 返回空（调用方走全局回退，单 session legacy）；不抛
  #   @error  — 不抛
  local sid="${SESSION_ID_FLAG:-}"
  if [[ -z "$sid" ]]; then sid="${DSH_SESSION_ID:-}"; fi
  if [[ -z "$sid" ]]; then
    sid="$(git -C "$PROJECT_ROOT" symbolic-ref --short HEAD 2>/dev/null | awk -F/ '{print $NF}' || true)"  # branch basename（对齐 attach.py hook-session-start.sh:48）
  fi
  if [[ -z "$sid" ]]; then sid="${TASK_ID_RAW:-}"; fi
  printf '%s' "$sid"
}

# ═══ D539: 主仓只读化 + 开工强制 worktree（决策点: 派单"主仓只读化"强于 D507 §六"单 session 例外"）═══
_assert_dev_worktree() {
  # 契约(铁律 47):
  #   @input  — $PROJECT_ROOT + SYNO_ALLOW_MAIN env + CREATE_WT（--create-worktree）
  #   @output — exit 0（linked worktree / SYNO_ALLOW_MAIN=1 豁免 / git-dir 降级放行）| exit 1（主树非豁免, 业务阻断 + 引导建 worktree）
  #   @degraded — git-dir 解析失败 → 显式降级提示（铁律 11，不静默放行也不静默阻断）
  #   @error  — 不抛（bash 函数，阻断 = exit 1）
  local gitdir
  gitdir="$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null || echo '')"
  if [[ -z "$gitdir" ]]; then
    # 无法解析 git-dir → 显式降级提示（铁律 11，不静默），放行（fail-open：无法判主树/链接树）
    echo "⚠ D539: 无法解析 git-dir（${PROJECT_ROOT}）— worktree 检查降级放行（铁律 11，不静默）" >&2
    _degraded_log "task-start.worktree-gitdir" "git rev-parse --git-dir failed"
    return 0
  fi
  if [[ "$gitdir" == *"/.git/worktrees/"* ]]; then
    return 0  # linked worktree → 物理隔离已成立，放行
  fi
  # 主树检测（gitdir 不含 .git/worktrees/ 特征 = 主工作区）
  if [[ "${SYNO_ALLOW_MAIN:-0}" == "1" ]]; then
    # 显式豁免（仅维护/CI 场景），但记录 degraded（铁律 11，不静默）
    echo "⚠ D539: 主工作区被 SYNO_ALLOW_MAIN=1 豁免（仅维护/CI 用）" >&2
    _degraded_log "task-start.main-exempt" "SYNO_ALLOW_MAIN=1"
    return 0
  fi
  # 主树 + 非豁免 → 业务阻断（ctrl-tower 模式 1）
  echo "❌ 主工作区只读（dev）。请在专属 worktree 开工：" >&2
  WTM="$PROJECT_ROOT/scripts/control-tower/worktree-manager.py"
  if [[ -n "$CREATE_WT" ]]; then
    # 程序化接线（§8）: 显式 --create-worktree <sid> → 实际派发 worktree-manager.py create
    # （不意外建目录：默认不传 --create-worktree 时只给命令 + exit 1）
    if [[ -f "$WTM" ]] && python3 -c "import sys" >/dev/null 2>&1; then
      echo "   → 正在创建 worktree（worktree-manager.py create ${CREATE_WT}）" >&2
      python3 "$WTM" create "$CREATE_WT" 2>&1 | sed 's/^/     /' >&2 || true  # swallow-ok: create 失败已如实输出，不静默
      echo "   → 创建请求已发出。请 cd 到 ../synova-wt-$CREATE_WT 后重跑 task-start.sh。" >&2
    else
      echo "   (worktree-manager.py 不可用或 python 损坏 — 请人工检查)" >&2
      _degraded_log "task-start.worktree-unavailable" "worktree-manager.py or python missing"
    fi
  else
    # 程序化接线（§8）: 阻断消息引用 worktree-manager.py 路径（非仅 echo 建议）
    echo "   python3 scripts/control-tower/worktree-manager.py create <任务名>   # 程序化接线（§8 生产调用点）" >&2
    echo "   cd ../synova-wt-<任务名>" >&2
    echo "   然后在此目录重跑 task-start.sh。" >&2
  fi
  exit 1  # 业务阻断（ctrl-tower 模式 1）
}
_assert_dev_worktree

# ═══ D515 项1: 并行隔离物理强制（Codex P1，三次复发）═══
# 主树有未提交改动 且 session-registry 有其他活跃 session → 硬拦截开工（exit 1）。
# 判定复用 synova-commit D507 段同一信号源（session_registry.py list --active）；
# registry 不可读 → 显式降级提示（铁律 11，不静默）；worktree 内 → 允许（本就物理隔离）。
# 测试注入: SYNO_SKIP_PARALLEL_GUARD=1 跳过本段（仅测试沙箱用）。
if [[ "${SYNO_SKIP_PARALLEL_GUARD:-0}" != "1" ]]; then
  _PAR_GITDIR="$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null || echo '')"
  case "$_PAR_GITDIR" in
    *"/.git/worktrees/"*) : ;;  # worktree 内 → 物理隔离已成立，允许
    *)
      _PAR_DIRTY="$(git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null | head -1 || true)"
      if [[ -n "$_PAR_DIRTY" && -f "$PROJECT_ROOT/scripts/control-tower/session_registry.py" ]]; then
        _PAR_ACT="$(python3 "$PROJECT_ROOT/scripts/control-tower/session_registry.py" list --active </dev/null 2>/dev/null || true)"
        if [[ -z "$_PAR_ACT" ]]; then
          echo "⚠ session-registry 不可读 — 并行检查降级放行（铁律 11，不静默）"
        else
          _PAR_N="$(echo "$_PAR_ACT" | python3 -c "import json,sys;print(len(json.load(sys.stdin).get('sessions',[])))" 2>/dev/null | tr -d '\r\n' || echo "")"  # swallow-ok: 解析失败 → 空 → 跳过拦截（单人语义）
          _PAR_N="${_PAR_N//[^0-9]/}"  # D520/任务1: 二次清洗——只留数字，杜绝任何隐藏字符
          if [[ -n "$_PAR_N" && "$_PAR_N" -gt 0 ]]; then
            echo "❌ 主树有未提交改动，且 registry 有 ${_PAR_N} 个活跃 session — 并行互踩风险（Codex P1）"
            echo "   请在专属 worktree 开工:"
            echo "     python3 scripts/control-tower/worktree-manager.py create <任务名>"
            echo "     cd ../synova-wt-<任务名>"
            exit 1
          fi
        fi
      fi
      ;;
  esac
fi

# 生成 task brief
TODAY=$(date +%Y-%m-%d)
TASK_ID="${TASK_ID:-${TODAY}-auto}"
BRIEF_FILE="$PROJECT_ROOT/.claude/task-briefs/${TASK_ID}.md"

export BRIEF_FILE TASK_DESC
python3 "$SCRIPT_DIR/generate-task-brief.py"

echo "✅ Task brief 已生成: $BRIEF_FILE"
# D539: 会话专属 current-brief（CT-42 写侧闭环）——废除全局，强制 current-brief.<sid>。
# 对齐 attach.py(D329) 写 current-brief.<sid> / resolver --session / sop-gate(DSH_SESSION_ID) 读。
# 仅当 session-id 不可解析（legacy 单 session / 非 session 上下文）才回退全局（不静默）。
SESSION_ID="$(_resolve_session_id)"
LATEST_BRIEF=$(ls -t "$PROJECT_ROOT/.claude/task-briefs/"*.md 2>/dev/null | head -1)  # swallow-ok: 目录空 → 跳过
if [[ -n "$LATEST_BRIEF" ]]; then
  BRIEF_NAME="$(basename "$LATEST_BRIEF")"
  if [[ -n "$SESSION_ID" ]]; then
    printf '%s\n' "$BRIEF_NAME" > "$PROJECT_ROOT/.claude/current-brief.$SESSION_ID"
    rm -f "$PROJECT_ROOT/.claude/current-brief"   # 废除全局（单 session 语义由 <sid> 承载）
  else
    # 无法解析 session-id → 回退全局（兼容 legacy 单 session，不静默）
    printf '%s\n' "$BRIEF_NAME" > "$PROJECT_ROOT/.claude/current-brief"
  fi
fi

# D284-FIX: task-start 完成后清除 session-locked（不依赖 hook 触发）
rm -f "$PROJECT_ROOT/.claude/session-locked" 2>/dev/null
echo "✅ session-locked 已清除"

# D200: 上下文注射 — 注入权威文档上下文到 Q1c 字段
INJECTOR="$PROJECT_ROOT/scripts/control-tower/context-injector.sh"
if [[ -f "$INJECTOR" ]]; then
  bash "$INJECTOR" --task-id "$TASK_ID" && echo "✅ 上下文注射完成" || echo "⚠ 上下文注射降级"
else
  echo "⚠ context-injector.sh 未找到 — 跳过注射"
fi
