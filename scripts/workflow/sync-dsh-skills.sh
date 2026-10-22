#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# sync-dsh-skills.sh — DSH 技能同步（P0: .synova/skills → .dsh/skills 单源复制；2026-10-21 #819 迁移）
#
# 背景 (2026-08-15 创始人批准 P0-P3): DSH 的技能发现根是 <项目根>/.dsh/skills
# （DSH skill-filesystem rank 100），不读 .synova/skills/。仓库 5 个流程技能
# （git-sync-pr 等，沉淀 D313-D334 教训）对 DSH 会话不可见 → 本脚本把 .synova/skills/
# 作为单一事实源同步到 .dsh/skills/，pre-commit 组 13 以 --check 模式物理阻断漂移。
#
# 契约 (铁律 47):
#   @input  — 无参数(默认同步) 或 --check(只校验不改写)
#             环境注入(测试用): SYNO_SKILLS_SRC / SYNO_SKILLS_DST 覆盖源/目标目录
#   @output — 默认: 同步执行报告 + "SYNC-OK: N 个技能"；--check: 一致 → "SYNC-OK" exit 0
#   @exit   — 0 = 一致/同步成功；1 = 漂移（--check 检测到差异，点名文件）；
#             2 = 检查执行失败/降级（源缺失、不可写等 — D328 三态：失败≠通过）
#   @degraded — exit 2 + stderr "degraded: <原因>"（铁律 24+31 显式降级）
#   @error  — .code=SKILLS_SYNC_ERROR .phase=sync|check .retryable=true
#
# 设计约束: 确定性输出（无时间戳）、UTF-8（D313 M5）、只依赖 bash coreutils。
# 用法: bash scripts/workflow/sync-dsh-skills.sh [--check]
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="${SYNO_SKILLS_SRC:-$REPO_DIR/.synova/skills}"
DST="${SYNO_SKILLS_DST:-$REPO_DIR/.dsh/skills}"
MODE="sync"
[ "${1:-}" = "--check" ] && MODE="check"

degrade() { # <原因> — 降级: 显式日志 + exit 2（铁律 11: 不静默）
  echo "degraded: $1 (code=SKILLS_SYNC_ERROR, phase=$MODE, retryable=true)" >&2
  exit 2
}

# ── 收集源技能: 目录 + SKILL.md 才算技能（DSH 格式: <name>/SKILL.md）──
[ -d "$SRC" ] || degrade "源技能目录不存在: $SRC（技能已迁移到 .synova/skills，见 #819）"

SRC_LIST=$(mktemp /tmp/sds-src.XXXXXX)
trap 'rm -f "$SRC_LIST"' EXIT
while IFS= read -r d; do
  name=$(basename "$d")
  if [ -f "$d/SKILL.md" ]; then
    echo "$name" >> "$SRC_LIST"
  else
    echo "warn: 跳过无 SKILL.md 的目录: ${name}（非技能目录）" >&2
  fi
done < <(find "$SRC" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | LC_ALL=C sort) # swallow-ok: find 探测可读子目录, 异常目录跳过
sort -o "$SRC_LIST" "$SRC_LIST"

# ── 收集目标技能 ──
DST_NAMES=""
if [ -d "$DST" ]; then
  DST_NAMES=$(find "$DST" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while IFS= read -r d; do basename "$d"; done | LC_ALL=C sort) # swallow-ok: find 探测不存在/不可读目录
fi

# ═══ check 模式: 只校验不改写 ═══
if [ "$MODE" = "check" ]; then
  DRIFT=""
  # 1) 源有而目标缺/内容异
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    if [ ! -f "$DST/$name/SKILL.md" ]; then
      DRIFT="${DRIFT}  漂移(目标缺失): $name/SKILL.md\n"
    elif ! diff -rq "$SRC/$name" "$DST/$name" >/dev/null 2>&1; then
      DRIFT="${DRIFT}  漂移(内容不一致): $name\n"
    fi
  done < "$SRC_LIST"
  # 2) 目标有而源无（僵尸技能）
  for name in $DST_NAMES; do
    if ! grep -qxF "$name" "$SRC_LIST"; then
      DRIFT="${DRIFT}  漂移(目标多余): $name\n"
    fi
  done
  if [ -n "$DRIFT" ]; then
    echo "技能漂移检测（源 ${SRC} → 目标 ${DST}）:"
    printf "%b" "$DRIFT"
    echo "修复: bash scripts/workflow/sync-dsh-skills.sh"
    exit 1
  fi
  echo "SYNC-OK: 技能一致（源 ${SRC} → 目标 ${DST}, $(wc -l < "$SRC_LIST" | tr -d ' ') 个技能）"
  exit 0
fi

# ═══ sync 模式: 确定性全量对齐 ═══
# 可写性探测: 找最深已存在祖先目录（DST 本身可能尚不存在, mkdir -p 会逐级创建）
_WRITE_PROBE="$DST"
while [ ! -d "$_WRITE_PROBE" ]; do _WRITE_PROBE=$(dirname "$_WRITE_PROBE"); done
[ -w "$_WRITE_PROBE" ] || degrade "目标目录不可写: $_WRITE_PROBE"
mkdir -p "$DST" || degrade "无法创建目标目录: $DST"

SYNCED=0
while IFS= read -r name; do
  [ -z "$name" ] && continue
  # 确定性替换: 先清后拷, 防止源删除的子文件残留在目标
  rm -rf "$DST/$name"
  mkdir -p "$DST/$name" || degrade "无法创建技能目录: $DST/$name"
  cp -R "$SRC/$name/." "$DST/$name/" 2>/dev/null || degrade "复制失败: $name"
  SYNCED=$((SYNCED + 1))
done < "$SRC_LIST"

# 清理僵尸技能（目标有而源无）
for name in $DST_NAMES; do
  if ! grep -qxF "$name" "$SRC_LIST"; then
    rm -rf "$DST/$name"
    echo "removed: ${name}（源已删除的僵尸技能）"
  fi
done

echo "SYNC-OK: ${SYNCED} 个技能已同步（源 ${SRC} → 目标 ${DST}）"
exit 0
