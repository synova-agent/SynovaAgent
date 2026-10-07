#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-ownership.test.sh — ownership 机器化测试（发现制 .synova-owner + 生成产物 + 漂移门禁）
#
# 🔴 2026-10-07 · 分域废止后的重写（创始人授权清「分域」）
#   创始人原话：「不分域。谁有空，谁能做就谁做。」
#   ⇒ ownership.yaml 改为**单域**（全路径同一 owner）⇒ 原「越域 / 跨域」断言失去对象。
#
# 🔴 2026-10-07 · D1204 登记制→发现制（卡 #1233）
#   创始人裁定「登记点 = 汇聚点 = 冲突点」⇒ 归属真源就近入目录（`.synova-owner`），
#   中央 ownership.yaml / CODEOWNERS 降级为**生成产物**。本文件补判别性夹具：
#     §9  新目录**零中央登记**即被识别（且未触碰任何中央文件）
#     §10 改/删归属标记 ⇒ exit 1（改坏即红）；重生成 ⇒ 可复绿；owner 真变（反静态恒绿）
#     §11 生成命令幂等可复跑 + **逐字节**漂移即红（不是"内容等价即过"）
#     §12 标记格式非法一律 fail-closed → exit 2（未知键/重复键/空值/缺 owner/缺 handle/二义）
#     §13 根标记缺失 ⇒ exit 1（真源消失是**违规**，不是"检查自己坏了"）
#
# **保留**（判据能力不降级）:
#   · 单域正例 / 反向验证（删兜底 → 变绿 + 无归属明示）/ 降级 fail-closed
#   · 产物契约 drift（逐字节）/ 结构契约 / 生产接线（铁律 0-2 WIRE CHECK）
# **替换**（域语义 → 单域语义）:
#   · §3 判别性夹具: **非单域必须 exit 1**（证明判定真读数据，非静态恒绿）
#   · §4 显式豁免仍被**明示**（单域下 domain-neutral 不再是域信号）
#   · §7 结构契约: 恰 1 条 default + 恰 1 条 glob + **无分域残留**（owner:/territory:/mac|win|k3 键）
#
# 沙箱说明: §9-§13 用 mktemp 沙箱并镜像仓内相对结构 —— check-ownership.py 的 REPO_ROOT
#   由**脚本自身位置**反推（check-ownership.py:50-51），故沙箱内必须以**沙箱相对路径**
#   调用（SBL_TOOL）；若误用真仓绝对路径，沙箱夹具会静默退化到真仓（实测踩过）。
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
echo "── 9. 🔴 发现制: 新增目录零中央登记即被识别（D1204 夹具①）──"
# 沙箱：镜像仓内相对结构 —— check-ownership.py 的 REPO_ROOT = 自身 ../..（同 check-pr-budget.test.sh:96）
SANDBOX="$TMPD/sandbox"
SBL_TOOL="scripts/control-tower/check-ownership.py"   # ⚠️ 必须是**沙箱内相对路径**：REPO_ROOT 由脚本自身位置反推
sb() { ( cd "$SANDBOX" && "$PYBIN" "$SBL_TOOL" "$@" ); }
mk_sandbox() {
  rm -rf "$SANDBOX"
  mkdir -p "$SANDBOX/scripts/control-tower" "$SANDBOX/scripts/product-lines" \
           "$SANDBOX/docs/synova/coordination" "$SANDBOX/.github" "$SANDBOX/src" || return 1
  cp "$TOOL" "$SANDBOX/scripts/control-tower/" || return 1
  cp "$REPO_DIR/scripts/product-lines/productline_yaml.py" "$SANDBOX/scripts/product-lines/" || return 1
  cp "$REPO_DIR/.synova-owner" "$SANDBOX/.synova-owner" || return 1
  printf 'a\n' > "$SANDBOX/src/a.ts"
  ( cd "$SANDBOX" && git init -q . && git add -A ) >/dev/null 2>&1 || return 1
  sb --emit-ownership  > "$SANDBOX/docs/synova/coordination/ownership.yaml" || return 1
  sb --emit-codeowners > "$SANDBOX/.github/CODEOWNERS" || return 1
  return 0
}
if mk_sandbox; then
  pass "发现制沙箱就绪（根标记 + 产物，零中央登记起点）"
else
  fail "发现制沙箱构建失败（无法验证夹具①②③）"
fi
# 9a: 全新目录 + 全新文件 —— **不触碰任何中央文件**
mkdir -p "$SANDBOX/src/brandnew/deep"
printf 'x\n' > "$SANDBOX/src/brandnew/deep/f.ts"
printf 'k\n' > "$SANDBOX/src/brandnew/keep.ts"
( cd "$SANDBOX" && git add -A ) >/dev/null 2>&1
OUT="$(sb src/brandnew/deep/f.ts 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "新目录零中央登记 → 被识别且 exit 0（夹具①）" \
  || { fail "新目录未被识别 (exit=$_e)"; echo "$OUT" | sed 's/^/      | /' >&2; }
echo "$OUT" | grep -q "^maintainer src/brandnew/deep/f.ts" \
  && pass "新目录归属 = 继承最近祖先（根标记 maintainer）" \
  || fail "新目录归属解析错误: $(echo "$OUT" | head -1)"
( cd "$SANDBOX" && git diff --quiet -- docs/synova/coordination/ownership.yaml .github/CODEOWNERS ) \
  && pass "新增目录未触碰任何中央文件（登记点 = 目录自身）" \
  || fail "新增目录被迫改中央文件（登记制未真正退役）"

echo ""
echo "── 10. 🔴 改坏即红: 改/删归属标记 ⇒ exit 1（D1204 夹具②）──"
# 10a: 新增**本目录**标记改归属，产物未重生成 ⇒ 漂移 exit 1
printf 'owner: k3\nhandle: @auditor\n' > "$SANDBOX/src/brandnew/.synova-owner"
( cd "$SANDBOX" && git add -A ) >/dev/null 2>&1
sb src/brandnew/keep.ts > "$TMPD/f10a.out" 2>&1; _e=$?
[ "$_e" = 1 ] && pass "改标记（未重生成产物）⇒ exit 1（改坏即红）" \
  || { fail "改标记后未红 — 期望 exit=1 实际 $_e"; sed 's/^/      | /' >&2 < "$TMPD/f10a.out"; }
grep -q "产物漂移" "$TMPD/f10a.out" && pass "漂移点名「产物漂移」（不静默）" || fail "漂移未点名"
# 10b: 重生成 → green，且归属**真的**变成 k3（反静态恒绿：判定真读标记）
sb --emit-ownership  > "$SANDBOX/docs/synova/coordination/ownership.yaml"
sb --emit-codeowners > "$SANDBOX/.github/CODEOWNERS"
OUT="$(sb src/brandnew/keep.ts 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "重生成产物后 → exit 0（红色可复绿）" \
  || { fail "重生成后仍红 (exit=$_e)"; echo "$OUT" | sed 's/^/      | /' >&2; }
echo "$OUT" | grep -q "^k3 " && pass "本地标记真生效（owner 变 k3 —— 反静态恒绿）" \
  || fail "本地标记未生效（owner 未变 ⇒ 判定可疑为静态）"
grep -qE '^src/brandnew/\*\* +@auditor' "$SANDBOX/.github/CODEOWNERS" \
  && pass "产物 CODEOWNERS 出现本目录行（只动所在目录，未动中央登记）" \
  || fail "CODEOWNERS 未反映本目录标记"
# 10c: 删除标记（回到继承）⇒ 产物未重生成 ⇒ exit 1
rm -f "$SANDBOX/src/brandnew/.synova-owner"
( cd "$SANDBOX" && git add -A ) >/dev/null 2>&1
sb src/brandnew/keep.ts > "$TMPD/f10c.out" 2>&1; _e=$?
[ "$_e" = 1 ] && pass "删标记 ⇒ exit 1（改坏即红）" \
  || { fail "删标记后未红 — 期望 exit=1 实际 $_e"; sed 's/^/      | /' >&2 < "$TMPD/f10c.out"; }

echo ""
echo "── 11. 🔴 生成命令可复跑 + 逐字节漂移即红（D1204 夹具③）──"
if mk_sandbox; then pass "夹具③沙箱重置就绪"; else fail "夹具③沙箱重置失败"; fi
sb --emit-ownership  > "$TMPD/own.1" 2>/dev/null
sb --emit-ownership  > "$TMPD/own.2" 2>/dev/null
if diff -q "$TMPD/own.1" "$TMPD/own.2" >/dev/null 2>&1; then
  pass "生成命令幂等（连续两次逐字节一致 = 可复跑）"
else
  fail "生成命令非幂等（两次输出不同 ⇒ 产物不可复现）"
fi
sb --check-drift >/dev/null 2>&1; _e=$?
[ "$_e" = 0 ] && pass "干净树 --check-drift exit 0" || fail "干净树漂移 (exit=$_e)"
cp "$SANDBOX/docs/synova/coordination/ownership.yaml" "$TMPD/yaml.bak"
printf '\n# 手工追加一行（模拟手改产物）\n' >> "$SANDBOX/docs/synova/coordination/ownership.yaml"
sb --check-drift > "$TMPD/drift.out" 2>&1; _e=$?
[ "$_e" = 1 ] && pass "手工改产物 1 字节 ⇒ --check-drift exit 1（**逐字节**，非等价即过）" \
  || { fail "手改产物未红 — 期望 exit=1 实际 $_e"; sed 's/^/      | /' >&2 < "$TMPD/drift.out"; }
grep -q "产物漂移" "$TMPD/drift.out" && pass "漂移诊断点名文件与行号" || fail "漂移诊断未点名"
cp "$TMPD/yaml.bak" "$SANDBOX/docs/synova/coordination/ownership.yaml"
sb --check-drift >/dev/null 2>&1; _e=$?
[ "$_e" = 0 ] && pass "还原后 --check-drift exit 0（漂移可修可复跑）" || fail "还原后仍红 (exit=$_e)"
# 11c: 真仓双产物新鲜（生产面；对齐 §6 的 CODEOWNERS 侧）
OUT="$("$PYBIN" "$TOOL" --check-drift 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "真仓: ownership.yaml + CODEOWNERS 逐字节新鲜" \
  || { fail "真仓产物漂移 (exit=$_e)"; echo "$OUT" | sed 's/^/      | /' >&2; }
"$PYBIN" "$TOOL" --emit-ownership > "$TMPD/ownership.gen" 2>/dev/null
if diff -q "$TMPD/ownership.gen" "$YAML" >/dev/null 2>&1; then
  pass "drift: docs/synova/coordination/ownership.yaml == --emit-ownership（逐字节）"
else
  fail "drift: ownership.yaml 漂移 —— 重跑 --emit-ownership > docs/synova/coordination/ownership.yaml"
fi

echo ""
echo "── 12. 标记格式契约: 非法标记一律 fail-closed → exit 2 ──"
if mk_sandbox; then pass "格式契约沙箱就绪"; else fail "格式契约沙箱失败"; fi
FMT="$SANDBOX/src/fmt"
mkdir -p "$FMT"; printf 'z\n' > "$FMT/x.ts"
fmt_case() {  # $1=描述 $2=期望 $3=标记内容
  printf '%b' "$3" > "$FMT/.synova-owner"
  ( cd "$SANDBOX" && git add -A ) >/dev/null 2>&1
  OUT="$(sb src/fmt/x.ts 2>&1)"; local _e=$?
  [ "$_e" = "$2" ] && pass "标记格式: $1 (exit=$2)" \
    || { fail "标记格式: $1 — 期望 exit=$2 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; }
  printf '%s' "$OUT" > "$TMPD/fmt.$2.out"
}
fmt_case "未知键 → exit 2" 2 'owner: maintainer\nbogus: 1\n'
grep -q "未知标记键" "$TMPD/fmt.2.out" && pass "点名「未知标记键」" || fail "未点名未知键"
fmt_case "重复键 → exit 2" 2 'owner: maintainer\nowner: k3\n'
grep -q "重复键" "$TMPD/fmt.2.out" && pass "点名「重复键」" || fail "未点名重复键"
fmt_case "空值 → exit 2" 2 'owner:\n'
grep -q "值为空" "$TMPD/fmt.2.out" && pass "点名「值为空」" || fail "未点名空值"
fmt_case "缺 owner 键 → exit 2" 2 'handle: @x\n'
grep -q "缺 \`owner:\`" "$TMPD/fmt.2.out" && pass "点名「缺 owner」" || fail "未点名缺 owner"
fmt_case "非 键:值 行 → exit 2" 2 'justtext\n'
grep -q "非法标记行" "$TMPD/fmt.2.out" && pass "点名「非法标记行」" || fail "未点名非法行"
fmt_case "新 owner 键缺 handle → exit 2" 2 'owner: newkey\n'
grep -q "无 handle" "$TMPD/fmt.2.out" && pass "点名「无 handle」（产不出 CODEOWNERS 即 fail-closed）" || fail "未点名缺 handle"
# handle 二义：根标记已声明 maintainer→@tangbaobao520，深处置不同 handle ⇒ exit 2
fmt_case "同键 handle 二义 → exit 2" 2 'owner: maintainer\nhandle: @somebody-else\n'
grep -q "二义" "$TMPD/fmt.2.out" && pass "点名「handle 二义」（禁静默取一）" || fail "未点名二义"
# 合法标记（同键、无 handle、无冗余）⇒ 不阻断，且因 owner 未变而不产生漂移
fmt_case "合法冗余标记（继承同键，无 handle）→ exit 0" 0 'owner: maintainer\n'

echo ""
echo "── 13. 根标记缺失 ⇒ 漂移 exit 1（真源消失必须红，不得静默降级）──"
if mk_sandbox; then pass "根标记缺失沙箱就绪"; else fail "根标记缺失沙箱失败"; fi
rm -f "$SANDBOX/.synova-owner"
( cd "$SANDBOX" && git add -A ) >/dev/null 2>&1
sb --check-drift > "$TMPD/noroot.out" 2>&1; _e=$?
[ "$_e" = 1 ] && pass "删除根标记 ⇒ --check-drift exit 1（不静默放过）" \
  || { fail "根标记删除后未红 — 期望 exit=1 实际 $_e"; sed 's/^/      | /' >&2 < "$TMPD/noroot.out"; }
grep -q "产物漂移" "$TMPD/noroot.out" && pass "点名漂移（真源消失 = 违规，非「检查失败」exit 2）" || fail "未点名漂移"

echo ""
echo "── 14. 生产接线（铁律 0-2 WIRE CHECK）──"
if grep -q "check-ownership.py" "$CODEOWNERS" 2>/dev/null; then
  pass "接线: CODEOWNERS 头声明由 check-ownership.py 生成（产物消费成立）"
else
  fail "接线: CODEOWNERS 未声明生成来源"
fi
if grep -qE '^owner: ' "$REPO_DIR/.synova-owner" 2>/dev/null; then
  pass "接线: 根标记 .synova-owner 存在且声明 owner（发现制真源在仓内）"
else
  fail "接线: 根标记 .synova-owner 缺失或缺 owner 键"
fi
if grep -qE '\.synova-owner' "$YAML"; then
  pass "接线: 产物 ownership.yaml 自述真源为 .synova-owner（真源↔产物可追）"
else
  fail "接线: 产物未自述真源"
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
