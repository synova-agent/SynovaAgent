#!/bin/bash
# #1394: post-commit 安装器真实入口与默认关闭说明
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_SRC="$REPO/scripts/workflow/install-post-commit.sh"
HOOK_SRC="$REPO/scripts/hooks/post-commit.sh"
PASS=0
FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
SB="$TMPD/repo"
mkdir -p "$SB/scripts/workflow" "$SB/scripts/hooks"
git -C "$SB" init -q || { echo "  ❌ fixture: git init 不可用"; exit 3; }
SB_GIT_ROOT="$(cd "$SB" && git rev-parse --show-toplevel)"
cp "$INSTALL_SRC" "$SB/scripts/workflow/install-post-commit.sh"
cp "$HOOK_SRC" "$SB/scripts/hooks/post-commit.sh"

OUT="$(cd "$SB" && bash scripts/workflow/install-post-commit.sh 2>&1)"
RC=$?
[ "$RC" -eq 0 ] && ok "真实临时仓库安装成功" || no "安装失败 rc=$RC: $OUT"
TARGET="$SB/.git/hooks/post-commit"
[ -x "$TARGET" ] && ok "post-commit 包装器已安装且可执行" || no "包装器缺失或不可执行"
grep -Fq "exec bash \"$SB_GIT_ROOT/scripts/hooks/post-commit.sh\"" "$TARGET" \
  && ok "包装器指向仓内真实 post-commit.sh" \
  || no "包装器未指向仓内真实 post-commit.sh"
printf '%s' "$OUT" | grep -Fq '外部审计: 默认关闭；SYNO_AUDIT_HOOK=1 时启用 external-auditor.sh' \
  && ok "安装输出明确默认关闭与显式启用方式" \
  || no "安装输出缺默认关闭说明: $OUT"
OUT_SECOND="$(cd "$SB" && bash scripts/workflow/install-post-commit.sh 2>&1)"
RC_SECOND=$?
[ "$RC_SECOND" -eq 0 ] && ok "重复安装幂等" || no "重复安装失败 rc=$RC_SECOND: $OUT_SECOND"

printf '结果: %s 通过, %s 失败\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
