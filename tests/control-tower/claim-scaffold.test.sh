#!/bin/bash
# claim-scaffold.test.sh — scripts/control-tower/claim_store.py --scaffold 配对测试
# 正常：暂存文件全量进入 writeset（含 claim 自身），生成后 --check 通过，--force 重建
# 失败：已有 claim 拒绝覆盖 exit 1；非 Git 目录 exit 2
# 反例：去掉一条 verify: 前缀后 --check 必须 exit 2，修复由 --force 重建完成
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$REPO/scripts/control-tower/claim_store.py"
PASS=0
FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
assert_rc() {
  if [ "$1" -eq "$2" ]; then ok "$3 (exit=$1)"; else no "$3 — exit=$1 期望 $2"; fi
}
assert_contains() {
  if printf '%s\n' "$1" | grep -Fq -- "$2"; then ok "$3"; else no "$3 — 缺少 $2；输出: $1"; fi
}

PYBIN=""
for candidate in python3 python py; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys" >/dev/null 2>&1; then
    PYBIN="$candidate"
    break
  fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SANDBOX="$TMP/repo"
mkdir -p "$SANDBOX/docs" "$SANDBOX/scripts"
git -C "$SANDBOX" init -q || { echo "  ❌ 无法初始化沙箱仓库"; exit 2; }
printf '# task\n' > "$SANDBOX/docs/任务卡.md"
printf '#!/bin/bash\n' > "$SANDBOX/scripts/a.sh"
git -C "$SANDBOX" add docs/任务卡.md scripts/a.sh || { echo "  ❌ 无法暂存沙箱文件"; exit 2; }
CLAIM_FILE="$SANDBOX/.claude/claims/1402.yaml"
run() { env -u SYNO_CLAIM_DIR "$PYBIN" "$TOOL" --root "$SANDBOX" "$@"; }

echo "=== claim scaffold 配对测试（#1402）==="
OUT=$(run --scaffold 1402 2>&1)
assert_rc $? 0 "scaffold 从真实暂存区生成骨架"
assert_contains "$OUT" "1402.yaml" "输出点名生成文件"
[ -f "$CLAIM_FILE" ] && ok "claim 文件落盘" || no "claim 文件未落盘: $CLAIM_FILE"
if LC_ALL=C grep -q $'\r' "$CLAIM_FILE"; then no "骨架含 CRLF（仓库统一 LF）"; else ok "骨架统一 LF 换行"; fi

RAW_WRITES=$(run --writeset 1402)
assert_rc $? 0 "生成的 writeset 可读取"
WRITES=$(printf '%s' "$RAW_WRITES" | tr -d '\r')
EXPECTED=$(printf '%s\n' '.claude/claims/1402.yaml' 'docs/任务卡.md' 'scripts/a.sh' | sort)
if [ "$WRITES" = "$EXPECTED" ]; then
  ok "writeset 全量且仅含暂存文件与 claim 自身"
else
  no "writeset 不完整 — 实得: $WRITES；期望: $EXPECTED"
fi
TEXT=$(<"$CLAIM_FILE")
assert_contains "$TEXT" "- verify: python scripts/control-tower/claim_store.py --check 1402 --root ." "done 含 --check 自身"
assert_contains "$TEXT" "按任务替换或补充" "标准检查旁有待替换注释"
OUT=$(run --check 1402 2>&1)
assert_rc $? 0 "scaffold 生成后 --check 通过"
assert_contains "$OUT" '"status": "ok"' "--check 返回 ok"

cp "$CLAIM_FILE" "$TMP/original.yaml"
OUT=$(run --scaffold 1402 2>&1)
assert_rc $? 1 "已有 claim 默认拒绝覆盖"
assert_contains "$OUT" "1402.yaml" "拒绝覆盖点名已有 claim"
assert_contains "$OUT" "--force" "拒绝覆盖提示显式 --force"
cmp -s "$CLAIM_FILE" "$TMP/original.yaml" && ok "拒绝覆盖时原文逐字节不变" || no "拒绝覆盖仍改写了 claim"

sed 's#  - verify: bash scripts/pre-commit-check.sh#  - bash scripts/pre-commit-check.sh#' \
  "$TMP/original.yaml" > "$CLAIM_FILE"
OUT=$(run --check 1402 2>&1)
assert_rc $? 2 "改坏一条 verify 前缀后 --check 必红"
assert_contains "$OUT" "claim-done-without-verify" "反例点名缺失 verify 的错误码"
echo "  改坏原始输出: $OUT"

printf '# extra\n' > "$SANDBOX/docs/extra.md"
git -C "$SANDBOX" add docs/extra.md || { echo "  ❌ 无法暂存追加文件"; exit 2; }
OUT=$(run --scaffold 1402 --force 2>&1)
assert_rc $? 0 "--force 显式重建已有 claim"
WRITES=$(run --writeset 1402)
assert_contains "$WRITES" "docs/extra.md" "--force 后 writeset 纳入新增暂存文件"
OUT=$(run --check 1402 2>&1)
assert_rc $? 0 "--force 重建修复反例并再次通过 --check"

mkdir -p "$TMP/not-a-repo"
OUT=$(env -u SYNO_CLAIM_DIR "$PYBIN" "$TOOL" --root "$TMP/not-a-repo" --scaffold 1403 2>&1)
assert_rc $? 2 "读取暂存区失败按检查自身失败退出"
assert_contains "$OUT" "claim-scaffold-git-error" "Git 失败给出可归因错误码"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
