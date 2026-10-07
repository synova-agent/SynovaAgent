#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-notes-lifecycle.sh — D472 Agent Notes 四态生命周期迁移门禁
#
# 契约（铁律 47 — 契约优先，先定义再实现）:
#   @input  — 无参数；扫描 $ROOT/memory/notes/proposed/
#   @output — 僵尸 proposed 清单（实现已落地但未 git mv）+ 修复指引
#   @exit   — 0 = 无僵尸 / 1 = 有僵尸（阻断，需 git mv 或删除后重提）
#   @degraded — 目录不可读 → exit 2 + stderr "degraded: <原因>"（铁律 11/24，不静默）
#   @error  — 非 UTF-8 / 无读权限 → .code + stderr
#
# 僵尸判定（D472 修正 — 兼容现有 Note 双格式头，保守不误杀）:
#   ① 提取 D#：优先中文头 "任务: DXXX" / "相关 D#: DXXX"；
#      兼容英文头（check-lessons-learned 写入）: name:/class:/description: 中匹配 D\d+
#      （如 "name: D406 lessons-learned 通道改向" → D406；"class: D406_M7" → D406）
#   ② 判定：提取到 D# 且 task-state/D#.json 存在且 status ∈ {impl_done, spec_done}
#      （实现已落地）→ 判定"实现已落地，提案未迁移"→ 列僵尸清单
#   ③ 其余（无 D# 引用 / D# 未 impl/未 spec）→ 视为真实进行中提议，不阻断（放行）
#
# 设计哲学: 迁移是人的决策（提案是否落地/否决），脚本只检查+阻断，不替人判断。
# 门禁只在 proposed/ 有变更时触发（pre-commit 组 6 条件调用，保持 <1s）。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

# 项目标准定位: 脚本自身路径 → 仓库根（不依赖 git rev-parse, 兼容 worktree/沙箱）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# 注入缝 (测试隔离): TASK_STATE_DIR 覆盖真实 task-state/
NOTES_DIR="${SYNO_NOTES_DIR:-$ROOT/memory/notes}"
TASK_STATE_DIR="${TASK_STATE_DIR:-$ROOT/task-state}"
PROPOSED_DIR="$NOTES_DIR/proposed"

ZOMBIES=""

# ── 目录可读性检查（铁律 24: 显式降级，不静默）──
if [ ! -d "$PROPOSED_DIR" ]; then
  # proposed/ 不存在 = 四态目录未初始化 → 无僵尸可查（放行，不误报）
  echo "✅ [notes-lifecycle] proposed/ 不存在 — 跳过"
  exit 0
fi

if [ ! -d "$TASK_STATE_DIR" ]; then
  echo "degraded: task-state/ 目录不可读: $TASK_STATE_DIR" >&2
  exit 2
fi

# ── 提取 Note 关联的 D#（双格式兼容）──
# 中文头: "任务: DXXX" / "相关 D#: DXXX"；英文头: name:/class:/description: 中 D\d+
extract_d_id() {
  local file="$1"
  local d
  d=$(grep -oE '任务: *D[0-9]+|相关 ?D#: *D[0-9]+|相关 ?D# *D[0-9]+' "$file" 2>/dev/null | grep -oE 'D[0-9]+' | head -1 || true)
  if [ -n "$d" ]; then echo "$d"; return 0; fi
  d=$(grep -oE '^(name|class|description): *[^ ]*D[0-9]+' "$file" 2>/dev/null | grep -oE 'D[0-9]+' | head -1 || true)
  if [ -n "$d" ]; then echo "$d"; return 0; fi
  echo ""
}

# ── 扫描 proposed/ 判僵尸 ──
UNREGISTERED=""   # E4（K3 R6）: 无 task-state 卡的条目——显式登记，末尾打印迁移期标识
while IFS= read -r note; do
  [ -z "$note" ] && continue
  [ ! -f "$note" ] && continue
  # 跳过索引文件
  base=$(basename "$note")
  if echo "$base" | grep -qE '^MEMORY\.md$'; then continue; fi

  D_ID=$(extract_d_id "$note")
  [ -z "$D_ID" ] && continue  # 无 D# 引用 → 真实提议，放行

  STATE_FILE="$TASK_STATE_DIR/${D_ID}.json"
  if [ ! -f "$STATE_FILE" ]; then
    # E4（K3 R6 禁静默空白）: 原本是**静默 continue**（读不到卡 = 当作"进行中"）。
    #   迁移期 task-state 停更后，所有新任务都落这条分支 ⇒ 僵尸判定整体失效而**无任何提示**。
    #   现改为显式登记 + 末尾统一打印迁移期标识（不阻断，但可见）。
    UNREGISTERED="${UNREGISTERED}${note}"$'\n'
    continue
  fi
  STATUS=$(grep -oE '"status"[[:space:]]*:[[:space:]]*"[^"]+"' "$STATE_FILE" 2>/dev/null | head -1 | sed -E 's/.*"([^"]+)"$/\1/' || true)
  case "$STATUS" in
    impl_done|spec_done)
      ZOMBIES="${ZOMBIES}${note}"$'\n'
      ;;
    *)
      : ;;  # 其他状态（claimed/audit_pending/audited/fix_needed）→ 进行中，放行
  esac
done < <(find "$PROPOSED_DIR" -name "*.md" -type f 2>/dev/null | sort || true)

# ── E4（K3 R6）: 迁移期显式降级输出（禁静默空白）──
if [ -n "${UNREGISTERED:-}" ]; then
  _un=$(printf '%s' "$UNREGISTERED" | grep -c . | tr -d '\r\n')
  echo "[迁移期] ${_un} 条 proposed Note 的 D# 无 task-state 卡（旧 D# 卡只读；新任务声明在 .claude/claims/）"
  echo "           ⇒ 僵尸判定对这批条目**未生效**（不是"通过"，是"无判据对象"）。"
  printf '%s' "$UNREGISTERED" | sed '/^$/d' | sed 's/^/            - /'
fi

# ── 输出 ──
if [ -n "$ZOMBIES" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  D472 迁移门禁: proposed/ 存在僵尸条目（实现已落地未迁移）     ║"
  echo "╠══════════════════════════════════════════════════════════════╣"
  while IFS= read -r note; do
    [ -z "$note" ] && continue
    rel="${note#$ROOT/}"
    D_ID=$(extract_d_id "$note")
    echo "║  📋 $rel (D#: $D_ID)"
  done <<< "$ZOMBIES"
  echo "╠══════════════════════════════════════════════════════════════╣"
  echo "║  修复: 若提案已落地 → git mv 到 implemented/ 并更新头字段     ║"
  echo "║        若提案已否决 → git mv 到 rejected/                     ║"
  echo "║        若确为测试残留 → 删除该文件                            ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  ZOMBIES_COUNT=$(echo "$ZOMBIES" | grep -c . 2>/dev/null | tr -d '\n\r' || echo 1)
  echo "[notes-lifecycle] ❌ ${ZOMBIES_COUNT} 个僵尸条目 — 迁移门禁阻断"
  exit 1
fi

echo "✅ [notes-lifecycle] proposed/ 无僵尸条目"
exit 0
