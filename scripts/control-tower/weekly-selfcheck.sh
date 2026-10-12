#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# weekly-selfcheck.sh — CTO 每周自检对齐（2026-08-25 创始人定，AGENTS.md 对齐教训）
#
# 背景: AGENTS.md 停在 V4.5.1（08-02），控制塔演进到 V5.1.1 期间文档冻结——门禁语义/版本/定位
#       与实际严重漂移。教训: 关键文档没有"谁负责定期对齐"的机制 → 漂移无感知。
#
# 职责: 检查关键文档（AGENTS.md/cto-handover/预设）vs 实际代码的漂移，
#       输出漂移报告（哪些文档过时 + 差异点）→ CTO 看到漂移 → 安排对齐。
#       由 dsh-task-board cron（每周一）或 launchd 触发；也可手动跑。
#
# 契约 (铁律 47):
#   @input  — 无参数（默认检查 <repo>/AGENTS.md 等）; --check 只输出不提示
#   @output — 漂移检查报告（stdout）:
#             [OK]   无漂移
#             [DRIFT] <文档> <差异点>     ← 每个漂移一行
#   @exit   — 0 = 检查完成且零漂移; 1 = 检查完成但发现漂移; 2 = 检查失败/降级
#   @degraded — exit 2 + stderr "degraded: <原因>"（缺文件/无法读取等，不静默）
#   @error  — .code=SELFCHECK_ERROR .phase=check .retryable=true
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
MODE="${1:-}"

DRIFT=0
declare -a REPORT

# 工具: 提取 main 上 VERSION.md 最新版本
get_latest_version() {
  # main 优先；本地 fallback
  if git -C "$REPO_DIR" show origin/main:.codex/control-tower/VERSION.md 2>/dev/null | grep -m1 -E "^## V" | grep -oE "V[0-9]+\.[0-9]+\.[0-9]+"; then
    :
  elif [ -f "$REPO_DIR/.codex/control-tower/VERSION.md" ]; then
    grep -m1 -E "^## V" "$REPO_DIR/.codex/control-tower/VERSION.md" | grep -oE "V[0-9]+\.[0-9]+\.[0-9]+"
  else
    echo "unknown"
  fi
}

# 工具: 提取文档头部版本
doc_version() { # doc_version <文件>
  local f="$1"
  if [ -f "$f" ]; then
    grep -m1 -oE "V[0-9]+\.[0-9]+\.[0-9]+" "$f" 2>/dev/null | head -1
  else
    echo "missing"
  fi
}

report_drift() { # report_drift <文档> <差异点>
  DRIFT=1
  REPORT+=("[DRIFT] $1: $2")
}

report_alert() { # report_alert <项> <详情> — 告警级（数据/备份健康），比文档漂移更紧急
  DRIFT=1
  REPORT+=("[ALERT] $1: $2")
}

# ═══ ① 版本漂移: AGENTS.md vs VERSION.md ═══
LATEST="$(get_latest_version)"
if [ "$LATEST" = "unknown" ]; then
  echo "degraded: 无法读取 VERSION.md（main 与本地均缺）" >&2
  exit 2
fi

for doc in AGENTS.md; do
  DV="$(doc_version "$REPO_DIR/$doc")"
  if [ "$DV" = "missing" ]; then
    report_drift "$doc" "文件缺失"
  elif [ "$DV" != "$LATEST" ] && [ "$DV" != "unknown" ]; then
    report_drift "$doc" "版本 $DV ≠ 控制塔 $LATEST"
  fi
done

# ═══ ② 门禁语义: pre-commit 软提示 / pre-push 门禁 0-5 ═══
if [ -f "$REPO_DIR/AGENTS.md" ] && [ -f "$REPO_DIR/scripts/pre-commit-check.sh" ]; then
  if grep -q "软提示" "$REPO_DIR/AGENTS.md" && ! grep -q "软提示" "$REPO_DIR/scripts/pre-commit-check.sh"; then
    report_drift "AGENTS.md" "声称 pre-commit 软提示但 pre-commit-check.sh 无软提示实现"
  fi
  if ! grep -q "软提示" "$REPO_DIR/AGENTS.md" && grep -q "软提示" "$REPO_DIR/scripts/pre-commit-check.sh"; then
    report_drift "AGENTS.md" "pre-commit-check.sh 已软提示但 AGENTS.md 未同步"
  fi
fi
if [ -f "$REPO_DIR/AGENTS.md" ] && [ -f "$REPO_DIR/scripts/pre-push-check.sh" ]; then
  if grep -q "门禁 0-5" "$REPO_DIR/AGENTS.md" && ! grep -q "门禁 0" "$REPO_DIR/scripts/pre-push-check.sh"; then
    report_drift "AGENTS.md" "声称 pre-push 门禁 0-5 但 pre-push-check.sh 无门禁 0"
  fi
fi

# ═══ ③ 专家数: AGENTS.md "7位专家" vs expert/ 目录 ═══
EXPERT_DIRS=$(ls -d "$REPO_DIR"/expert/*/ 2>/dev/null | grep -vE "_deprecated|_template" | wc -l | tr -d ' ')
if [ -f "$REPO_DIR/AGENTS.md" ]; then
  DOC_EXPERT=$(grep -oE "[0-9]+位专家" "$REPO_DIR/AGENTS.md" | head -1 | grep -oE "[0-9]+")
  if [ -n "$DOC_EXPERT" ] && [ "$DOC_EXPERT" != "$EXPERT_DIRS" ]; then
    report_drift "AGENTS.md" "声称 ${DOC_EXPERT} 位专家但 expert/ 实测 ${EXPERT_DIRS} 个"
  fi
fi

# ═══ ④ 桌面端定位（品牌表层）═══
if [ -f "$REPO_DIR/AGENTS.md" ] && ! grep -q "桌面端" "$REPO_DIR/AGENTS.md"; then
  report_drift "AGENTS.md" "未含桌面端定位（切片 A/B/C 已交付 Electron）"
fi

# ═══ ⑤ 技能双轨同步 (.claude ↔ .dsh) ═══
if [ -f "$REPO_DIR/scripts/workflow/sync-dsh-skills.sh" ]; then
  SYNC_OUT=$(bash "$REPO_DIR/scripts/workflow/sync-dsh-skills.sh" --check 2>&1)
  SYNC_RC=$?
  if [ "$SYNC_RC" -ne 0 ]; then
    report_drift "skills 双轨" "sync-dsh-skills --check 失败 (rc=$SYNC_RC): $(echo "$SYNC_OUT" | head -1)"
  fi
fi

# ═══ ⑥ cto-handover 派单规范 ═══
if [ -f "$REPO_DIR/.claude/skills/cto-handover/SKILL.md" ]; then
  if ! grep -q "派单必带 DSH 借鉴核查" "$REPO_DIR/.claude/skills/cto-handover/SKILL.md"; then
    report_drift "cto-handover skill" "缺『派单必带 DSH 借鉴核查』规范（§〇b）"
  fi
fi

# ═══ ⑦ 备份健康 + db 完整性（2026-08-27 P0 数据事故教训：备份失败曾静默 7 天）═══
# 三查：① backup-health.json 记录失败 ② data/synova.db 完整性 ③ iCloud 最新备份新鲜度（48h 阈值）
if [ -f "$REPO_DIR/.claude/backup-health.json" ]; then
  if grep -q '"status":"fail"' "$REPO_DIR/.claude/backup-health.json"; then
    report_alert "备份健康" "backup-health.json 记录最近一次备份失败（数据异地副本停更风险）"
  fi
fi
if [ -f "$REPO_DIR/data/synova.db" ] && command -v sqlite3 >/dev/null 2>&1; then
  INTEGRITY="$(sqlite3 "$REPO_DIR/data/synova.db" 'PRAGMA integrity_check;' 2>/dev/null | head -1 || echo '')" # swallow-ok: 失败经空值+下方 integrity!=ok 检查 fail-closed
  if [ "$INTEGRITY" != "ok" ]; then
    report_alert "数据库" "data/synova.db 完整性异常: ${INTEGRITY:-<无法读取>}"
  fi
fi
ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/SynovaAgent-backups"
LATEST_BAK="$(ls -1t "$ICLOUD_DIR"/synova-backup-*.db 2>/dev/null | head -1)" # swallow-ok: 无备份文件时 ls 报错经下方 else 分支 fail-closed
if [ -n "$LATEST_BAK" ]; then
  BAK_AGE_HOURS=$(( ($(date +%s) - $(stat -f%m "$LATEST_BAK")) / 3600 ))
  if [ "$BAK_AGE_HOURS" -gt 48 ]; then
    report_alert "备份新鲜度" "iCloud 最新备份 ${BAK_AGE_HOURS} 小时前（>48h 阈值）"
  fi
else
  report_alert "备份新鲜度" "iCloud 目录无备份文件"
fi

# ═══ 输出 ═══
if [ "$MODE" = "--report" ]; then
  # launchd 自动模式：写报告到 docs/synova/CTO-HEALTH.md 自检段（创始人/CTO 打开可见）
  REPORT_FILE="$REPO_DIR/docs/synova/CTO-HEALTH.md"
  STAMP="$(date +%Y-%m-%d)"
  {
    echo ""
    echo "## 每周自检（${STAMP}）"
    if [ "$DRIFT" -eq 0 ]; then
      echo "- ✅ 对齐通过（控制塔 ${LATEST}）"
    else
      echo "- ⚠️ 发现 ${#REPORT[@]} 项问题（[ALERT] 告警 / [DRIFT] 漂移）："
      for line in "${REPORT[@]}"; do echo "  - ${line}"; done
    fi
  } >> "$REPORT_FILE" 2>/dev/null
  echo "自检报告已写入 $REPORT_FILE"
fi
if [ "$DRIFT" -eq 0 ]; then
  echo "[OK] 自检对齐通过 — 文档与代码一致（版本 ${LATEST}）"
  exit 0
else
  echo "[自检漂移报告] 控制塔版本 ${LATEST} | $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for line in "${REPORT[@]}"; do echo "$line"; done
  echo "[提示] 漂移项由 CTO 安排对齐（AGENTS.md 同步自代码，门禁语义对照实际脚本）"
  exit 1
fi
