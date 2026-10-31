#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# sync-dsh-skills.sh — DSH 技能同步（单源: .synova/skills → .dsh/skills）
#
# 背景 (2026-08-15 创始人批准 P0-P3；2026-10-21 #819 迁移；2026-10-31 #1227 W3 收口):
#   DSH 的技能发现根是 <项目根>/.dsh/skills（skill-filesystem rank 100），不读
#   .synova/skills/。本脚本把 .synova/skills/（单一事实源）同步到 .dsh/skills/；
#   pre-commit 组 13 以 --check 模式阻断漂移。
#
# 三种模式（#1227 W3：**默认改为 dry-run** —— 无参数不再改文件）:
#   无参数    dry-run 只打印「将同步 / 将移出」清单，**不改任何文件**
#   --apply   真实同步；漂移件与目标多余件**移出** .dsh/skills（移到同级 .skill-trash/），
#             目标侧旧内容一律 mv（可审计、可回滚），不原地销毁
#   --check   只校验（组 13 生产调用点）
#
# 契约 (铁律 47):
#   @input  — 无参数(dry-run) | --apply | --check
#             环境注入(测试用): SYNO_SKILLS_SRC / SYNO_SKILLS_DST 覆盖源/目标目录；
#             SYNO_SKILLS_TRASH 覆盖回收目录（缺省 = 目标父目录/.skill-trash）
#   @output — dry-run: 计划清单 + "DRY-RUN: N 项待处理（未改动任何文件）"
#             --apply: 逐项动作 + "SYNC-OK: N 个技能已同步（M 项移入回收目录 ...）"
#             --check: 一致 → "SYNC-OK: 技能一致（...）"；漂移 → 漂移清单 + 修复命令
#   @exit   — 0 = 一致(check) / 成功(apply) / 无待处理项(dry-run)
#             1 = 漂移（check 点名；dry-run 表示有待处理项）
#             2 = 执行失败/降级（非法参数、源缺失、目标不可写、同步后复核不一致 — D328 三态）
#   @degraded — exit 2 + stderr "degraded: <原因>"（铁律 24+31 显式降级）
#   @error  — .code=SKILLS_SYNC_ERROR .phase=dry-run|apply|check .retryable=true
#
# 设计哲学（一句可诵）: **一个事实源 ＋ 三条承诺** —— 单一真源（.synova/skills）、
#   默认不改文件（dry-run）、目标侧只移不毁（trash）。
#
# 已知限制（Known Limitations，禁读成"全等"）:
#   1. 只认 <name>/SKILL.md 形态；无 SKILL.md 的子目录只 warn 跳过（不删、不同步、
#      不参与漂移判定 —— 它们不是技能，见「计划」段的 in_src 过滤）。
#   2. 回收目录不自动清理（.skill-trash/ 在 .dsh/skills 之外，不影响 DSH 发现；由人定期清）。
#   3. 漂移判定 = `diff -rq` 内容级；权限位 / 时间戳差异不算漂移。
#   4. 路径含空格/换行不支持（DSH 技能目录名为 kebab-case，实测无此形态）。
#   5. dry-run 的 exit 1 只表示"有待处理项"，不是本次调用失败。
#
# 用法: bash scripts/workflow/sync-dsh-skills.sh [--apply|--check]
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="${SYNO_SKILLS_SRC:-$REPO_DIR/.synova/skills}"
DST="${SYNO_SKILLS_DST:-$REPO_DIR/.dsh/skills}"
TRASH="${SYNO_SKILLS_TRASH:-$(dirname "$DST")/.skill-trash}"

USAGE="usage: bash scripts/workflow/sync-dsh-skills.sh [--apply|--check]"
# ── 参数: 无参数 = dry-run（默认不改文件）; --apply 才真同步; --check 只校验 ──
if [ "$#" -gt 1 ]; then
  echo "$USAGE" >&2
  echo "degraded: 参数过多（$# 个）(code=SKILLS_SYNC_ERROR, phase=argparse, retryable=false)" >&2
  exit 2
fi
MODE="dry-run"
case "${1:-}" in
  "")      MODE="dry-run" ;;
  --apply) MODE="apply"   ;;
  --check) MODE="check"   ;;
  *)
    echo "$USAGE" >&2
    echo "degraded: 非法参数 ${1}（只接受 --apply / --check）(code=SKILLS_SYNC_ERROR, phase=argparse, retryable=false)" >&2
    exit 2 ;;
esac

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
SRC_NAMES=" $(tr '\n' ' ' < "$SRC_LIST") "

# ── 计划计算（check / dry-run / apply 后复核 三处共用同一判据）──
#   diff 退出码: 0=一致 / 1=有差异（正常路径）/ >1=读不到（D328 fail-closed，不许当一致）
DST_NAMES=""
DIRTY_NAMES=""
PLAN_NEW=""; PLAN_DIFF=""; PLAN_EXTRA=""
N_NEW=0; N_DIFF=0; N_EXTRA=0; PENDING=0

is_dirty() { case " ${DIRTY_NAMES} " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
in_src()   { case "$SRC_NAMES" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

compute_plan() {
  # 目标技能目录（每次重算：apply 前后目标会变）
  DST_NAMES=""
  if [ -d "$DST" ]; then
    DST_NAMES=$(find "$DST" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while IFS= read -r d; do basename "$d"; done | LC_ALL=C sort) # swallow-ok: find 探测不存在/不可读目录
  fi
  # 漂移判定: 整树一次 diff（逐技能 diff 实测 6.3s；整树 1 次 ~0.1s 同判据）
  DIRTY_NAMES=""
  if [ -d "$DST" ]; then
    local tree_diff diff_rc
    tree_diff=$(diff -rq "$SRC" "$DST" 2>&1)
    diff_rc=$?
    if [ "$diff_rc" -gt 1 ]; then
      degrade "整树 diff 执行失败 rc=${diff_rc}: $(printf '%s' "$tree_diff" | head -1)"
    fi
    if [ -n "$tree_diff" ]; then
      # 把 diff 的绝对路径行折算回技能名（顶格目录名）
      DIRTY_NAMES=$(printf '%s\n' "$tree_diff" | sed -E \
        -e "s#^Files ${SRC}/([^/]+)/.*#\1#" \
        -e "s#^Files ${DST}/([^/]+)/.*#\1#" \
        -e "s#^File ${SRC}/([^/]+)/.*#\1#" \
        -e "s#^File ${DST}/([^/]+)/.*#\1#" \
        -e "s#^Only in ${SRC}/([^/:]+).*#\1#" \
        -e "s#^Only in ${DST}/([^/:]+).*#\1#" \
        -e "s#^Only in ${SRC}: (.*)#\1#" \
        -e "s#^Only in ${DST}: (.*)#\1#" \
        | LC_ALL=C sort -u | tr '\n' ' ')
    fi
  fi
  # 计划: 缺失 / 不一致 / 目标多余（无 SKILL.md 的源目录不是技能，不参与判定）
  PLAN_NEW=""; PLAN_DIFF=""; PLAN_EXTRA=""
  N_NEW=0; N_DIFF=0; N_EXTRA=0
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    if [ ! -d "$DST/$name" ]; then
      PLAN_NEW="${PLAN_NEW}${name}"$'\n'; N_NEW=$((N_NEW + 1))
    elif is_dirty "$name"; then
      PLAN_DIFF="${PLAN_DIFF}${name}"$'\n'; N_DIFF=$((N_DIFF + 1))
    fi
  done < "$SRC_LIST"
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    if ! in_src "$name"; then
      PLAN_EXTRA="${PLAN_EXTRA}${name}"$'\n'; N_EXTRA=$((N_EXTRA + 1))
    fi
  done <<< "$DST_NAMES"
  PENDING=$((N_NEW + N_DIFF + N_EXTRA))
}

print_plan() { # <动词前缀>
  local verb="$1"
  [ -n "$PLAN_DIFF" ]  && printf '%s' "$PLAN_DIFF"  | sed "s/^/  ${verb}(内容不一致): /"
  [ -n "$PLAN_NEW" ]   && printf '%s' "$PLAN_NEW"   | sed "s/^/  ${verb}(目标缺失): /"
  [ -n "$PLAN_EXTRA" ] && printf '%s' "$PLAN_EXTRA" | sed "s/^/  ${verb}(目标多余): /"
  return 0
}

compute_plan

# ═══ check 模式: 只校验不改写（组 13 调用点）═══
if [ "$MODE" = "check" ]; then
  if [ "$PENDING" -gt 0 ]; then
    echo "技能漂移检测（源 ${SRC} → 目标 ${DST}）:"
    print_plan "漂移"
    echo "修复: bash scripts/workflow/sync-dsh-skills.sh --apply（目标多余件会移入 ${TRASH}）"
    exit 1
  fi
  echo "SYNC-OK: 技能一致（源 ${SRC} → 目标 ${DST}, $(wc -l < "$SRC_LIST" | tr -d ' ') 个技能）"
  exit 0
fi

# ═══ dry-run 模式（默认）: 只打印计划，不改任何文件 ═══
if [ "$MODE" = "dry-run" ]; then
  echo "DRY-RUN: 源 ${SRC} → 目标 ${DST}（未改动任何文件）"
  if [ "$PENDING" -gt 0 ]; then
    print_plan "将同步"
    echo "DRY-RUN: ${PENDING} 项待处理（内容不一致 ${N_DIFF} / 目标缺失 ${N_NEW} / 目标多余 ${N_EXTRA}）"
    echo "  执行: bash scripts/workflow/sync-dsh-skills.sh --apply（多余件移入 ${TRASH}）"
    exit 1
  fi
  echo "DRY-RUN: 0 项待处理 —— 源与目标已一致"
  exit 0
fi

# ═══ apply 模式: 确定性全量对齐（目标侧只移不毁）═══
# 可写性探测: 找最深已存在祖先目录（DST 本身可能尚不存在, mkdir -p 会逐级创建）
_WRITE_PROBE="$DST"
while [ ! -d "$_WRITE_PROBE" ]; do _WRITE_PROBE=$(dirname "$_WRITE_PROBE"); done
[ -w "$_WRITE_PROBE" ] || degrade "目标目录不可写: $_WRITE_PROBE"
mkdir -p "$DST" || degrade "无法创建目标目录: $DST"

trash_put() { # <待移路径> <名称> — 移入回收目录（不原地销毁）
  local srcp="$1" nm="$2" dest n=1
  mkdir -p "$TRASH" || degrade "无法创建回收目录: $TRASH"
  dest="$TRASH/$nm"
  while [ -e "$dest" ]; do n=$((n + 1)); dest="$TRASH/$nm.$n"; done
  mv "$srcp" "$dest" || degrade "移入回收目录失败: $srcp -> $dest"
  echo "moved: ${nm} -> ${dest}"
}

copy_skill() { # <名称>
  local name="$1"
  mkdir -p "$DST/$name" || degrade "无法创建技能目录: $DST/$name"
  cp -R "$SRC/$name/." "$DST/$name/" 2>/dev/null || degrade "复制失败: $name"
}

SYNCED=0; TRASHED=0
if [ -n "$PLAN_DIFF" ]; then
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    trash_put "$DST/$name" "$name"
    copy_skill "$name"
    SYNCED=$((SYNCED + 1)); TRASHED=$((TRASHED + 1))
  done <<< "$PLAN_DIFF"
fi
if [ -n "$PLAN_NEW" ]; then
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    copy_skill "$name"
    SYNCED=$((SYNCED + 1))
  done <<< "$PLAN_NEW"
fi
if [ -n "$PLAN_EXTRA" ]; then
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    trash_put "$DST/$name" "$name"
    TRASHED=$((TRASHED + 1))
  done <<< "$PLAN_EXTRA"
fi

# ── 自证: 同步后按同一判据复核（写后校验，禁"做了就算成功"）──
compute_plan
[ "$PENDING" -eq 0 ] || degrade "同步后复核仍不一致（${PENDING} 项待处理；已同步 ${SYNCED} 项）"

if [ "$SYNCED" -eq 0 ] && [ "$TRASHED" -eq 0 ]; then
  echo "SYNC-OK: 无需同步（0 项待处理；源 ${SRC} → 目标 ${DST}）"
else
  echo "SYNC-OK: ${SYNCED} 个技能已同步（源 ${SRC} → 目标 ${DST}；${TRASHED} 项移入回收目录 ${TRASH}）"
fi
exit 0
