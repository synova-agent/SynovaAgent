#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-ownership.test.sh — ownership 机器化测试（ownership.yaml + check-ownership.py）
#
# 🔴 2026-10-07 · 分域废止后的重写（创始人授权清「分域」）
#   创始人原话：「不分域。谁有空，谁能做就谁做。」
#   ⇒ ownership.yaml 改为**单域**（全路径同一 owner）⇒ 原「越域 / 跨域」断言失去对象。
#
# **保留**（判据能力不降级）:
#   · 单域正例 / 反向验证（删兜底 → 变绿 + 无归属明示）/ 降级 fail-closed
#   · 产物契约 drift（逐字节）/ 结构契约 / 生产接线（铁律 0-2 WIRE CHECK）
# **替换**（域语义 → 单域语义）:
#   · §3 判别性夹具: **非单域必须 exit 1**（证明判定真读数据，非静态恒绿）
#   · §4 显式豁免仍被**明示**（单域下 domain-neutral 不再是域信号）
#   · §7 结构契约: 恰 1 条 default + 恰 1 条 glob + **无分域残留**（owner:/territory:/mac|win|k3 键）
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/control-tower/check-ownership.py"
YAML="$REPO_DIR/docs/synova/coordination/ownership.yaml"
CODEOWNERS="$REPO_DIR/.github/CODEOWNERS"

# PLATFORM-CHECKLIST #1: PYBIN 三级探测（禁裸 python3 —— Win 部分机器无 python3.exe）
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then echo "❌ python 不可用 — 无法运行 ownership 测试" >&2; exit 2; fi

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

OUT=""
run_expect() {
  local want="$1"; shift
  local desc="$1"; shift
  OUT="$("$PYBIN" "$TOOL" "$@" 2>&1)"
  local got=$?
  if [ "$got" = "$want" ]; then pass "$desc (exit=$want)"
  else fail "$desc — 期望 exit=$want 实际 exit=$got"; echo "$OUT" | sed 's/^/      | /' >&2; fi
}

echo "═══════════════════════════════════════════════════════════"
echo "  ownership 机器化测试（2026-10-07 分域废止后重写）"
echo "═══════════════════════════════════════════════════════════"

echo ""
echo "── 1. 单域：全部路径同一个 owner（分域废止后唯一合法形态）──"
run_expect 0 "src 代码 + 控制塔脚本 + ownership.yaml 同域" \
  src/server.ts scripts/control-tower/check-ownership.py docs/synova/coordination/ownership.yaml
if echo "$OUT" | grep -q "同域"; then pass "单域输出点名「同域」"; else fail "单域输出未点名同域"; fi
run_expect 0 "尚未创建的文件路径也可判归属" src/evidence/not-yet-created.ts
run_expect 0 "显式 --owner 断言（单域下必然全中）" src/server.ts --owner maintainer
run_expect 1 "错 owner 仍必红（断言未被废掉）" src/server.ts --owner win

echo ""
echo "── 2. 反向验证（多规则副本）: 归由数据决定（真读 yaml，非静态恒绿）──"
# ⚠️ 单域下 ownership.yaml 只有一条兜底，而解析器要求 rules **非空**
#    （实测 `rules: []` 亦 exit 2 —— 缺非空 rules 列表即 fail-closed）
#    ⇒ 不能靠"删唯一规则"验证。改用一个多规则副本：兜底(maintainer) + 后置例外(alt)。
#      删掉兜底后，后置例外对全路径生效 ⇒ 同一路径的 owner 必须**变** ——
#      若这项恒不变，说明判定是静态/硬编码而非真读数据（反 grep 型静态判据）。
REV="$TMPD/ownership-rev.yaml"
cat > "$REV" <<'YEOF'
owners:
  maintainer: "把关人"
  alt: "临时备用 owner"
github:
  maintainer: "@tangbaobao520"
  alt: "@tangbaobao520"
rules:
  - glob: "**"
    owner: "maintainer"
    default: true
  - glob: "src/**"
    owner: "alt"
YEOF
run_expect 0 "副本: src/** 判 alt（后置例外生效）" src/server.ts --owner alt --yaml "$REV"
run_expect 0 "副本: 非 src 路径判 maintainer（兜底生效）" README.md --owner maintainer --yaml "$REV"
run_expect 1 "副本: 跨域（src/** alt vs 其余 maintainer）→ exit 1" src/server.ts README.md --yaml "$REV"
REV_OFF="$TMPD/ownership-rev-nodefault.yaml"
cp "$REV" "$REV_OFF"
"$PYBIN" - "$REV_OFF" <<'PYEOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
lines = p.read_text(encoding="utf-8").splitlines(keepends=True)
out, i = [], 0
while i < len(lines):
    if lines[i].strip().startswith('- glob: "**"'):
        i += 1
        while i < len(lines) and not lines[i].strip().startswith("- glob:"):
            i += 1
        continue
    out.append(lines[i]); i += 1
p.write_text("".join(out), encoding="utf-8")
PYEOF
if grep -qF -- '- glob: "**"' "$REV_OFF"; then
  fail "多规则反向验证前置: 兜底规则未删掉"
else
  pass "多规则反向验证前置: 兜底规则已移除"
fi
run_expect 0 "删兜底后 src/** 改判 alt（例外接管全路径 ⇒ owner 真的变了）" src/server.ts --owner alt --yaml "$REV_OFF"
run_expect 1 "删兜底后 src/** 不再是 maintainer（旧判定已失效）" src/server.ts --owner maintainer --yaml "$REV_OFF"

echo ""
echo "── 3. 🔴 判别性夹具: 非单域必须 exit 1（「判定仍有效」的核心证据）──"
TWO_DOMAIN="$TMPD/ownership-two-domain.yaml"
cat > "$TWO_DOMAIN" <<'YEOF'
owners:
  maintainer: "把关人"
  other: "第二 owner"
github:
  maintainer: "@tangbaobao520"
  other: "@tangbaobao520"
rules:
  - glob: "**"
    owner: "other"
    default: true
  - glob: "src/**"
    owner: "maintainer"
YEOF
run_expect 1 "两个真源混用（src/** 与其余不同 key）→ exit 1" src/server.ts README.md --yaml "$TWO_DOMAIN"
if echo "$OUT" | grep -q "跨域"; then pass "非单域输出点名「跨域」"; else fail "非单域输出未点名「跨域」"; fi
run_expect 0 "两条路径同属 src/** → 仍 exit 0（判定按数据，非按规则条数）" \
  src/server.ts src/routes/x.ts --yaml "$TWO_DOMAIN"

echo ""
echo "── 4. 显式豁免（domain_neutral）：单域下不再构成域信号，但仍必须**明示**（不静默）──"
run_expect 0 "豁免路径 + 普通路径 → exit 0" .claude/bypass.log src/server.ts
# 单域下豁免路径也归同一 owner ⇒ 脚本正确地**不再**打 domain-neutral（豁免不再是域信号）。
# 断言其反面: 结论行必须明示「域判定豁免 N」且不得把豁免路径算成无归属。
if echo "$OUT" | grep -qE "域判定豁免"; then pass "结论行明示「域判定豁免 N」（不静默）"; else fail "结论行未明示豁免计数"; fi
if echo "$OUT" | grep -q "无归属 0"; then pass "豁免路径未被算成「无归属」（语义正确）"; else fail "豁免路径被误算为无归属"; fi
run_expect 0 "纯豁免路径 → exit 0" .claude/bypass.log task-state/D733.json
run_expect 0 "证据目录路径 + 代码 → exit 0（单域下不存在掺域）" \
  docs/synova/product-lines/evidence/D716-win-20260913/x.txt src/server.ts

echo ""
echo "── 5. 降级与边界（fail-closed → exit 2）──"
run_expect 2 "yaml 不存在 → exit 2"      src/server.ts --yaml "$TMPD/nope.yaml"
printf 'rules:\n  - glob: "**"\n   bad_indent: 1\n' > "$TMPD/bad.yaml"
run_expect 2 "yaml 语法非法 → exit 2"    src/server.ts --yaml "$TMPD/bad.yaml"
printf 'rules: []\n' > "$TMPD/empty.yaml"
run_expect 2 "rules 为空 → exit 2"       src/server.ts --yaml "$TMPD/empty.yaml"
printf '{"not": "mapping"}\n' > "$TMPD/scalar.yaml"
run_expect 2 "yaml 非映射 → exit 2"      src/server.ts --yaml "$TMPD/scalar.yaml"
OUT="$("$PYBIN" "$TOOL" 2>&1)"; _e=$?
[ "$_e" = 2 ] && pass "无文件参数 → exit 2" || fail "无文件参数 — 期望 exit=2 实际 $_e"

echo ""
echo "── 6. 产物契约: CODEOWNERS == --emit-codeowners（drift 门禁）──"
if [ -f "$CODEOWNERS" ]; then
  "$PYBIN" "$TOOL" --emit-codeowners > "$TMPD/CODEOWNERS.gen" 2> "$TMPD/emit.err"
  _emit_e=$?
  [ "$_emit_e" = 0 ] || fail "--emit-codeowners 执行失败 (exit=$_emit_e): $(head -3 "$TMPD/emit.err")"
  if diff -q "$TMPD/CODEOWNERS.gen" "$CODEOWNERS" >/dev/null 2>&1; then
    pass "drift: .github/CODEOWNERS 与生成结果逐字节一致"
  else
    fail "drift: CODEOWNERS 漂移 —— 重跑 --emit-codeowners > .github/CODEOWNERS"; diff "$TMPD/CODEOWNERS.gen" "$CODEOWNERS" | head -10 >&2
  fi
  run_expect 0 "--emit-codeowners exit 0" --emit-codeowners
else
  fail "drift: .github/CODEOWNERS 不存在"
fi
CATCH=$(grep -cE '^\* +@' "$CODEOWNERS" 2>/dev/null || echo 0)
CATCH="${CATCH//[^0-9]/}"
[ "$CATCH" = "1" ] && pass "CODEOWNERS 恰 1 条兜底（* → 账号）" || fail "CODEOWNERS 兜底行 $CATCH 条（期望恰 1）"
if grep -qE '^\* +@[A-Za-z0-9_-]+' "$CODEOWNERS"; then pass "兜底行指向真实 GitHub 账号"; else fail "兜底行未指向账号"; fi

echo ""
echo "── 7. 结构契约: ownership.yaml 是单域形态 + 无分域残留 ──"
NDEF=$(grep -c 'default: true' "$YAML" | tr -d '\n\r'); NDEF="${NDEF//[^0-9]/}"
[ "$NDEF" = "1" ] && pass "default 规则恰 1 条" || fail "default 规则 $NDEF 条（期望恰 1）"
NGLOB=$(grep -cE '^[[:space:]]*- glob:' "$YAML" | tr -d '\n\r'); NGLOB="${NGLOB//[^0-9]/}"
[ "$NGLOB" = "1" ] && pass "恰 1 条 glob 规则（单域：全路径同一 owner）" || fail "glob 规则 $NGLOB 条（单域期望恰 1）"
# 每条规则的 `owner:` 是 CODEOWNERS 生成**必需**字段 ⇒ 不能断言"不存在"。
# 单域的正确形态 = **owner 键恰 1 个**（多 key ⇒ 分域残留）。
NOWN=$(grep -oE 'owner: "[^"]+"' "$YAML" | sort -u | wc -l | tr -d ' \n\r'); NOWN="${NOWN//[^0-9]/}"
[ "$NOWN" = "1" ] && pass "owner 键恰 1 个（单域；多键=分域残留）" || fail "owner 键 $NOWN 个（单域期望恰 1）"
if grep -qE '^[[:space:]]+territory:' "$YAML"; then fail "仍有 territory: 字段（分域残留）"; else pass "无 territory: 字段（分域残留已清）"; fi
if grep -qE '^[[:space:]]+(mac|win|k3):' "$YAML"; then fail "仍有 mac/win/k3 owner 键（分域残留）"; else pass "无 mac/win/k3 owner 键（分域残留已清）"; fi

echo ""
echo "── 8. 生产接线（铁律 0-2 WIRE CHECK）──"
if grep -q "check-ownership.py" "$CODEOWNERS" 2>/dev/null; then
  pass "接线: CODEOWNERS 头声明由 check-ownership.py 生成（产物消费成立）"
else
  fail "接线: CODEOWNERS 未声明生成来源"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ 全部通过: $PASS 项"
  echo "═══════════════════════════════════════════════════════════"
  exit 0
else
  echo "  ❌ $FAIL 项失败 / $PASS 项通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
