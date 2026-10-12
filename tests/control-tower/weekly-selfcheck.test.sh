#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# weekly-selfcheck.test.sh — 第⑦项备份健康三查测试（U7/CT-40 配对）
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 健康状态（ok health + 有效 db + 新鲜备份）→ 无 [ALERT]
#   降级 — backup-health.json status=fail → [ALERT] 备份健康
#   边界 — data/synova.db 损坏（非 SQLite）→ [ALERT] 数据库
#   接线 — weekly-selfcheck.sh 含第⑦项 + report_alert 函数（铁律 0-2）
# 沙箱: mktemp 临时仓库（复制脚本 + 最小文件）→ trap 强制清理；零真实目录零网络
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# 临时仓库结构（REPO_DIR = 脚本上上级 = $TMP）
mkdir -p "$TMP/scripts/control-tower" "$TMP/.claude" "$TMP/data" "$TMP/.codex/control-tower"
cp "$REPO/scripts/control-tower/weekly-selfcheck.sh" "$TMP/scripts/control-tower/weekly-selfcheck.sh"
# 最小文件让第①-⑥项不 degrade/不误报（版本对齐 + 桌面端 + 专家数）
printf '## V5.1.4\n' > "$TMP/.codex/control-tower/VERSION.md"
printf '> V5.1.4\n桌面端\n7位专家\n软提示\n门禁 0-5\n' > "$TMP/AGENTS.md"
printf '> V5.1.4\n桌面端\n' > "$TMP/AGENTS.md"

SELF="$TMP/scripts/control-tower/weekly-selfcheck.sh"

echo "=== weekly-selfcheck 第⑦项备份健康三查测试 ==="

# ── 接线: 第⑦项 + report_alert 已存在 ──
if grep -q "备份健康" "$REPO/scripts/control-tower/weekly-selfcheck.sh" && grep -q "report_alert()" "$REPO/scripts/control-tower/weekly-selfcheck.sh"; then
  ok "接线: 第⑦项备份健康 + report_alert 已存在"
else
  no "接线: 缺第⑦项或 report_alert"
fi

# ── 正常: 健康状态 → 无 [ALERT] ──
sqlite3 "$TMP/data/synova.db" "CREATE TABLE t(x);" 2>/dev/null # swallow-ok: 建表失败不影响断言（后续独立断言覆盖）
printf '{"status":"ok"}' > "$TMP/.claude/backup-health.json"
OUT=$(bash "$SELF" 2>&1)
if echo "$OUT" | grep -q "\[ALERT\]"; then
  no "正常: 健康状态不应有 [ALERT]（实际: $(echo "$OUT" | grep '\[ALERT\]' | head -1)）"
else
  ok "正常: 健康状态无 [ALERT]"
fi

# ── 降级: backup-health.json fail → [ALERT] 备份健康 ──
printf '{"status":"fail"}' > "$TMP/.claude/backup-health.json"
OUT=$(bash "$SELF" 2>&1)
if echo "$OUT" | grep -q "\[ALERT\] 备份健康"; then
  ok "降级: health fail → [ALERT] 备份健康"
else
  no "降级: health fail 应报 [ALERT] 备份健康"
fi

# ── 边界: db 损坏（非 SQLite）→ [ALERT] 数据库 ──
printf '{"status":"ok"}' > "$TMP/.claude/backup-health.json"
printf 'not a sqlite database' > "$TMP/data/synova.db"
OUT=$(bash "$SELF" 2>&1)
if echo "$OUT" | grep -q "\[ALERT\] 数据库"; then
  ok "边界: db 损坏 → [ALERT] 数据库"
else
  no "边界: db 损坏应报 [ALERT] 数据库"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ]
