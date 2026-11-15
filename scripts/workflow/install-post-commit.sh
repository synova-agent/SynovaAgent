#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# install-post-commit.sh — post-commit 安装脚本
#
# 用法: bash scripts/workflow/install-post-commit.sh
#
# 作用:
#   将 scripts/hooks/post-commit.sh 安装到 .git/hooks/post-commit。
#   外部审计默认关闭；仅 SYNO_AUDIT_HOOK=1 时触发 external-auditor.sh。
#   幂等：重复安装不报错。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SOURCE="$ROOT/scripts/hooks/post-commit.sh"
TARGET="$ROOT/.git/hooks/post-commit"

if [ ! -f "$SOURCE" ]; then
  echo "❌ source 不存在: $SOURCE"
  exit 1
fi

cat > "$TARGET" <<SCRIPT
#!/bin/bash
exec bash "$SOURCE"
SCRIPT
chmod +x "$TARGET"

echo "✅ post-commit hook 已安装 → $TARGET"
echo "   调用链: git commit → .git/hooks/post-commit → $SOURCE"
echo "   外部审计: 默认关闭；SYNO_AUDIT_HOOK=1 时启用 external-auditor.sh"
