#!/bin/bash
# @requires bash git python3
# ═══════════════════════════════════════════════════════════════════════════════
# check-fixture-requires.test.sh — 夹具依赖声明核对（卡 #739 ④ · 裁 223）配对夹具
#
# 覆盖:
#   ① 声明齐＋环境有 ⇒ OK
#   ② 声明了清单外 bin ⇒ MANIFEST_GAP（exit 1）
#   ③ 声明了清单内但环境没有 ⇒ MISSING（exit 2，**写明缺哪个**）
#   ④ 未声明却使用外部 bin（非基线）⇒ UNDECLARED（exit 1）
#   ⑤ 基线内的存量 ⇒ 放行（打印 baselined 计数）
#   ⑥ 单一来源：ci.yml 的安装步引用 fixture-toolchain.txt（不是硬编码包名）
# 判别力: 去掉声明 ⇒ ④ 必红；改回硬编码安装 ⇒ ⑥ 必红
# 隔离: mktemp 沙箱（夹具/清单/基线全部注入）；零网络。
# 用法: bash tests/control-tower/check-fixture-requires.test.sh → 0 = 全过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECK="$REPO/scripts/control-tower/check-fixture-requires.sh"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL+1)); echo "  ❌ $1" >&2; }
SB=$(mktemp -d /tmp/fixreq-test.XXXXXX)
trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/fix" "$SB/empty"
LIST="$SB/toolchain.txt"; BASE="$SB/baseline.txt"
cat > "$LIST" <<'L'
# test manifest
bash | runner | * | shell
git | runner | * | vcs
python3 | runner | * | py
no-such-bin-739 | runner | * | 故意不存在
L
: > "$BASE"

run() { bash "$CHECK" --fixtures "$1" --list "$LIST" --baseline "$BASE" --quiet; }

# ① 声明齐＋存在
cat > "$SB/fix/declared-ok.test.sh" <<'F'
#!/bin/bash
# @requires bash python3
echo hi
python3 -c 'print(1)'
F
run "$SB/fix" >/dev/null 2>&1 && ok "① 声明齐＋存在 ⇒ 0" || no "① 期望 0"

# ② 清单外 bin
cat > "$SB/fix/manifest-gap.test.sh" <<'F'
#!/bin/bash
# @requires not-in-list-739
echo hi
F
OUT=$(run "$SB/fix" 2>&1); RC=$?
[ "$RC" -eq 1 ] && ok "② 清单外声明 ⇒ 1" || no "② 期望 1，实际 ${RC}"
printf '%s' "$OUT" | grep -q "MANIFEST_GAP" && ok "② 报 MANIFEST_GAP" || no "② 未报 MANIFEST_GAP"
rm -f "$SB/fix/manifest-gap.test.sh"

# ③ 清单内但缺依赖：报名字
cat > "$SB/fix/missing-bin.test.sh" <<'F'
#!/bin/bash
# @requires no-such-bin-739
echo hi
F
OUT=$(run "$SB/fix" 2>&1); RC=$?
[ "$RC" -eq 2 ] && ok "③ 缺依赖 ⇒ 2" || no "③ 期望 2，实际 ${RC}"
printf '%s' "$OUT" | grep -q "MISSING: .*no-such-bin-739" && ok "③ 报出缺的 bin 名" || no "③ 未报 bin 名"
rm -f "$SB/fix/missing-bin.test.sh"

# ④ 未声明使用（非基线）⇒ 1
cat > "$SB/fix/undeclared.test.sh" <<'F'
#!/bin/bash
python3 -c 'print(1)'
F
OUT=$(run "$SB/fix" 2>&1); RC=$?
[ "$RC" -eq 1 ] && ok "④ 未声明使用 ⇒ 1" || no "④ 期望 1，实际 ${RC}"
printf '%s' "$OUT" | grep -q "UNDECLARED: .*python3" && ok "④ 报 UNDECLARED 与 bin 名" || no "④ 未报 UNDECLARED"
# 判别力：补声明（**头部注释块**，否则 header-only 解析看不见）⇒ 变绿
cat > "$SB/fix/undeclared.test.sh" <<'F'
#!/bin/bash
# @requires python3
python3 -c 'print(1)'
F
run "$SB/fix" >/dev/null 2>&1 && ok "④ 补声明 ⇒ 0（判别力）" || no "④ 补声明后仍红"

# ⑤ 基线内存量 ⇒ 放行
cat > "$SB/fix/baselined.test.sh" <<'F'
#!/bin/bash
python3 -c 'print(1)'
F
echo "fix/baselined.test.sh" > "$BASE"
# 基线路径按仓库相对（相对 REPO），沙箱内用 --fixtures 绝对路径时 rel 形如 ../..；故用相对路径调用
( cd "$SB" && bash "$CHECK" --fixtures fix --list "$LIST" --baseline "$BASE" --quiet ) >/dev/null 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "⑤ 基线内 ⇒ 0（baselined 放行）" || no "⑤ 期望 0，实际 ${RC}"

# ⑥ 单一来源：ci.yml 安装步引用清单
if grep -q "fixture-toolchain.txt" "$REPO/.github/workflows/ci.yml" 2>/dev/null; then
  ok "⑥ ci.yml 安装步引用 fixture-toolchain.txt（单一来源）"
else
  no "⑥ ci.yml 未引用清单（硬编码）"
fi

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
