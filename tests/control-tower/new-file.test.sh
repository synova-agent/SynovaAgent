#!/bin/bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# new-file.test.sh — #1101（W7 · L0 脚手架）配对测试：生成器 ＋ pre-commit「附: 三段契约兜底」
#
# 覆盖矩阵（正常 / 边界 / 降级 / 违规，四类都真跑，不用 grep 断言代替行为）:
#   生成器 scripts/dev/new-file.sh
#     G1 正常   component ⇒ 实现件＋配对测试件；三段契约齐；头注 ≤12 行；无 TBD/TODO；纯 LF
#     G2 正常   module(kebab) ⇒ 文件名 kebab、导出标识符 PascalCase；配对测试件；三段齐
#     G3 边界   实现件落在 <repo>/src/** ⇒ 配对测试件镜像到 <repo>/tests/**，且 import 相对路径可解析
#     G4 违规   非法 kind / 名字与 kind 语法不符 / 目标已存在 ⇒ exit 1（不静默覆盖）
#     G5 降级   模板缺失 ⇒ exit 2（三态 fail-closed，绝不与「生成成功」混同）
#   兜底闸（从 scripts/pre-commit-check.sh 按 CONTRACT-BACKSTOP 标记**提取后真跑**）
#     B1 边界   空变更集（无新增 src）⇒ 不触发
#     B2 正常   三段齐的新增 src/*.ts、src/*.tsx ⇒ 不判红
#     B3 **改坏即红** 把生成件的 `@degraded` 段删掉、暂存该文件 ⇒ **恰 1 处**违规且点名该文件
#     B4 回滚   SYNO_CONTRACT_BACKSTOP=0 ⇒ 同一坏样本不再报（唯一回滚点生效）
#     B5 边界   非 src / 非 ts(x) 的新增文件 ⇒ 不计入（fail-closed 不得变成"什么都拦"）
#     B6 接线   本段在 `# 结果` 汇总锚点**之前**；package.json 有 `new` 脚本（WIRE CHECK）
#
# 判据来源: #1101 §判据 G7（生成即合规）/ G8（删 @degraded ⇒ 兜底判 1 违规）。
# 沙箱纪律: 全部产物落 mktemp，绝不写真实 src/（镜像分支用 SYNO_SCAFFOLD_REPO 注入假仓根）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$REPO/scripts/dev/new-file.sh"
PRECOMMIT="$REPO/scripts/pre-commit-check.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TODAY="$(date +%Y-%m-%d)"
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
export SYNO_AUTHOR="new-file-test"

echo "=== #1101 W7-L0: 脚手架生成器 ＋ 三段契约兜底 ==="

# ── 工具: 头注行数（文件开头连续的 `//` 行）──
header_lines() { awk '{ if ($0 ~ /^\/\//) { n++; next } else { print n; exit } }' "$1"; }
have3() { # $1 = 文件；三段齐 ⇒ 0
  local f="$1" k
  for k in input output degraded; do
    grep -q -- "@${k}" "$f" || return 1
  done
  return 0
}

# ══════════ G1: component 正常路径 ══════════
D1="$TMPD/d1"; mkdir -p "$D1"
bash "$GEN" --kind component --name FooBar --root "$D1" >"$TMPD/g1.out" 2>&1; G1_RC=$?
IMPL="$D1/FooBar.tsx"; TESTF="$D1/FooBar.test.ts"
if [ "$G1_RC" -eq 0 ] && [ -f "$IMPL" ] && [ -f "$TESTF" ]; then
  ok "G1a component 生成 exit 0，实现件＋配对测试件都在（$(basename "$IMPL") / $(basename "$TESTF")）"
else
  no "G1a component 生成失败 rc=${G1_RC}：$(tail -2 "$TMPD/g1.out" | tr '\n' ' ')"
fi
if have3 "$IMPL"; then
  ok "G1b 生成件头注三段齐（@input/@output/@degraded）"
else
  no "G1b 生成件缺三段契约：$(grep -c '@input\|@output\|@degraded' "$IMPL" | tr -d '\r') 段"
fi
HL="$(header_lines "$IMPL")"; : "${HL:=0}"
if [ "$HL" -gt 0 ] && [ "$HL" -le 12 ]; then
  ok "G1c 头注 ${HL} 行（≤12）"
else
  no "G1c 头注 ${HL} 行（要求 1–12 行）"
fi
TBD_N="$(grep -ciE 'TBD|TODO|FIXME|<placeholder>' "$IMPL" | tr -d '\r')"
if [ "${TBD_N:-1}" -eq 0 ]; then
  ok "G1d 生成件无 TBD/TODO 占位（0 处）"
else
  no "G1d 生成件含 ${TBD_N} 处占位（禁 TBD 占位）"
fi
# CR 检测必须数**字节**，不能用 `grep -c $'\r'`：Git-bash(MSYS) 的 grep 按文本模式
# 把 CR 当行尾吃掉 ⇒ CR-only 模式退化成"空模式"，**每行都命中**（实测 15 行文件报 15）。
# tr 是字节流工具，不受行尾语义影响。
cr_bytes() { tr -cd '\r' < "$1" | wc -c | tr -d ' '; }
CR_N="$(cr_bytes "$IMPL")"
if [ "${CR_N:-1}" -eq 0 ]; then
  ok "G1e 生成件纯 LF（CR 字节 = 0）"
else
  no "G1e 生成件含 CR 字节 ${CR_N} —— Windows 编辑器污染"
fi
grep -q "$TODAY" "$IMPL" && grep -q "new-file-test" "$IMPL" \
  && ok "G1f 路径/日期/作者由脚本填（date=${TODAY}，author=new-file-test）" \
  || no "G1f 日期/作者未填入生成件"

# ══════════ G2: module（kebab）＋ 三段齐 ══════════
D2="$TMPD/d2"; mkdir -p "$D2"
bash "$GEN" --kind module --name my-thing --root "$D2" >"$TMPD/g2.out" 2>&1; G2_RC=$?
MIMPL="$D2/my-thing.ts"; MTEST="$D2/my-thing.test.ts"
if [ "$G2_RC" -eq 0 ] && [ -f "$MIMPL" ] && [ -f "$MTEST" ]; then
  ok "G2a module 生成 exit 0（kebab 文件名 my-thing.ts ＋ 配对测试件）"
else
  no "G2a module 生成失败 rc=${G2_RC}：$(tail -2 "$TMPD/g2.out" | tr '\n' ' ')"
fi
grep -q 'export function MyThing(' "$MIMPL" && ok "G2b kebab → PascalCase 导出标识符（MyThing）" \
  || no "G2b 导出标识符未按 kebab→PascalCase 生成"
have3 "$MIMPL" && ok "G2c module 生成件三段齐" || no "G2c module 生成件缺三段契约"

# ══════════ G3: 仓内 src/** ⇒ tests/** 镜像（组 2b 机械映射）══════════
FR="$TMPD/fakerepo"; mkdir -p "$FR/src/base"
SYNO_SCAFFOLD_REPO="$FR" bash "$GEN" --kind module --name bar-baz --root "$FR/src/base" >/dev/null 2>&1
if [ -f "$FR/src/base/bar-baz.ts" ] && [ -f "$FR/tests/base/bar-baz.test.ts" ]; then
  ok "G3a src/** 新件 ⇒ 配对测试件镜像到 tests/**（pre-commit 组 2b 的 src/x.ts→tests/x.test.ts）"
else
  no "G3a 未镜像到 tests/**（实见：$(find "$FR" -type f | tr '\n' ' ')）"
fi
grep -q "from '../../src/base/bar-baz'" "$FR/tests/base/bar-baz.test.ts" \
  && ok "G3b 测试件 import 相对路径可解析（../../src/base/bar-baz）" \
  || no "G3b 测试件 import 路径不对：$(grep -m1 'from ' "$FR/tests/base/bar-baz.test.ts")"

# ══════════ G4: 违规输入 ⇒ exit 1（不静默覆盖）══════════
D3="$TMPD/d3"; mkdir -p "$D3"
bash "$GEN" --kind widget --name Foo --root "$D3" >/dev/null 2>&1; R_KIND=$?
bash "$GEN" --kind component --name foo-bar --root "$D3" >/dev/null 2>&1; R_NAME=$?
bash "$GEN" --kind module --name FooBar --root "$D3" >/dev/null 2>&1; R_NAME2=$?
bash "$GEN" --kind component --name Zed --root "$D3" >/dev/null 2>&1
SUM_BEFORE="$(cksum < "$D3/Zed.tsx" 2>/dev/null || true)"  # swallow-ok: 文件不存在时为空，下一行按"覆盖保护失效"判红
bash "$GEN" --kind component --name Zed --root "$D3" >/dev/null 2>&1; R_EXIST=$?
SUM_AFTER="$(cksum < "$D3/Zed.tsx" 2>/dev/null || true)"  # swallow-ok: 同上，空值必与 SUM_BEFORE 比较失败 ⇒ 判红
if [ "$R_KIND" -eq 1 ] && [ "$R_NAME" -eq 1 ] && [ "$R_NAME2" -eq 1 ] && [ "$R_EXIST" -eq 1 ]; then
  ok "G4a 非法 kind / 名字与 kind 语法不符 / 目标已存在 ⇒ 全 exit 1（三态：可修正）"
else
  no "G4a 违规输入未按 exit 1 处理（kind=${R_KIND} name=${R_NAME}/${R_NAME2} exists=${R_EXIST}）"
fi
if [ -n "$SUM_BEFORE" ] && [ "$SUM_BEFORE" = "$SUM_AFTER" ]; then
  ok "G4b 覆盖保护：第二次生成被拒后首版文件内容未变（cksum 相同）"
else
  no "G4b 覆盖保护失效（before='${SUM_BEFORE}' after='${SUM_AFTER}'）"
fi

# ══════════ G5: 模板缺失 ⇒ exit 2（三态 fail-closed）══════════
SYNO_TEMPLATE_DIR="$TMPD/no-such-templates" bash "$GEN" --kind component --name Zed --root "$TMPD/d3" >/dev/null 2>&1
R_NTMPL=$?
[ "$R_NTMPL" -eq 2 ] && ok "G5a 模板缺失 ⇒ exit 2（检查自身失败，不与「生成成功」混同）" \
  || no "G5a 模板缺失未按 exit 2 处理（实测 rc=${R_NTMPL}）"

# ══════════ 兜底闸：按标记提取后**真跑** ══════════
awk '/^# ═══ CONTRACT-BACKSTOP-BEGIN/{f=1} f{print} /^# ═══ CONTRACT-BACKSTOP-END/{f=0}' \
  "$PRECOMMIT" > "$TMPD/backstop.sh"
if [ -s "$TMPD/backstop.sh" ] && grep -q '@degraded' "$TMPD/backstop.sh" \
   && grep -q 'SYNO_CONTRACT_BACKSTOP' "$TMPD/backstop.sh"; then
  ok "B0 兜底段可提取（$(wc -l < "$TMPD/backstop.sh" | tr -d ' ') 行，含三段判据＋回滚开关）"
else
  no "B0 兜底段提取失败（$PRECOMMIT 无 CONTRACT-BACKSTOP 标记或段为空）"
fi

SB="$TMPD/sb"; mkdir -p "$SB/src" "$SB/tests"
( cd "$SB" && git init -q . && git config user.email t@e.com && git config user.name t \
    && git config commit.gpgsign false && echo seed > seed.txt && git add -A && git commit -qm init ) >/dev/null 2>&1

run_backstop() { # $1 可选 = rollback（置 SYNO_CONTRACT_BACKSTOP=0）；stdout = 段输出
  (
    cd "$SB" || exit 9
    ROOT="$SB"; CYAN=""; RESET=""
    GIT_CACHED_ADDED_NAMES="$(git -C "$SB" diff --cached --name-only --diff-filter=A)"
    soft_pass() { printf 'PASS: %s\n' "$1"; }
    soft_check() {
      if [ -n "${2:-}" ]; then printf 'SOFTFAIL: %s | %s\n' "$1" "$2"; else printf 'OK: %s\n' "$1"; fi
    }
    if [ "${1:-}" = "rollback" ]; then export SYNO_CONTRACT_BACKSTOP=0; fi
    # shellcheck disable=SC1090
    . "$TMPD/backstop.sh"
  ) 2>&1
}
sf_count() { printf '%s' "$1" | grep -c 'SOFTFAIL' | tr -d '\r'; }

# B1 空变更集：只暂存 tests/ 下的新件 ⇒ 无新增 src ⇒ 不触发
printf 'echo x\n' > "$SB/tests/only.test.sh"; git -C "$SB" add -A
OUT="$(run_backstop)"
if [ "$(sf_count "$OUT")" -eq 0 ] && printf '%s' "$OUT" | grep -q 'PASS:'; then
  ok "B1 空变更集（无新增 src）⇒ 不触发（不判红）"
else
  no "B1 空变更集仍触发：$(printf '%s' "$OUT" | tr '\n' ' ' | tail -c 200)"
fi

# B2 三段齐的新增 src/*.ts、src/*.tsx ⇒ 不判红
#   注: 不造 src/*.test.ts —— 本闸对象是「新增的 src/**/*.ts(x)」全量，测试件按仓约定落 tests/，
#   生成器也不会往 src/ 里写 .test.ts（配对件镜像到 tests/**，见 G3）。
cp "$MIMPL" "$SB/src/good.ts"
cp "$IMPL" "$SB/src/GoodComp.tsx"
git -C "$SB" add -A
OUT="$(run_backstop)"
if [ "$(sf_count "$OUT")" -eq 0 ]; then
  ok "B2 三段齐的新增 src/*.ts ＋ src/*.tsx ⇒ 0 违规"
else
  no "B2 合规新件被判红：$(printf '%s' "$OUT" | grep 'SOFTFAIL' | head -2 | tr '\n' ' ')"
fi

# B3 改坏即红：删 @degraded 段（用真生成件，不是手搓样本）
#   取 component 生成件：它的 `@degraded` 只出现 1 次（头注那行）⇒ 删掉即"仅缺 @degraded"，
#   报错文本可逐字核对（比 module 件更干净的样本——module 的 @input 行里也提到 @degraded）。
BAD="$SB/src/bad.tsx"
grep -v '@degraded' "$IMPL" > "$BAD"
git -C "$SB" add -A
N_AFTER_DEL="$(grep -c '@degraded' "$BAD" | tr -d '\r')"
OUT="$(run_backstop)"
if [ "${N_AFTER_DEL:-1}" -eq 0 ] && [ "$(sf_count "$OUT")" -eq 1 ] \
   && printf '%s' "$OUT" | grep 'SOFTFAIL' | grep -q 'src/bad.tsx' \
   && printf '%s' "$OUT" | grep 'SOFTFAIL' | grep -q '缺 @degraded'; then
  ok "B3 **改坏即红**：删生成件 @degraded 段并暂存 ⇒ 恰 1 处违规，点名 src/bad.tsx 且报「缺 @degraded」"
else
  no "B3 删 @degraded 未被判红（违规数 $(sf_count "$OUT")，@degraded 残留 ${N_AFTER_DEL}）：$(printf '%s' "$OUT" | grep 'SOFTFAIL' | head -1)"
fi

# B4 回滚点：同一坏样本 + SYNO_CONTRACT_BACKSTOP=0 ⇒ 不再报
OUT="$(run_backstop rollback)"
if [ "$(sf_count "$OUT")" -eq 0 ]; then
  ok "B4 回滚点生效（SYNO_CONTRACT_BACKSTOP=0 ⇒ 同一坏样本 0 违规）"
else
  no "B4 回滚开关未生效（仍有 $(sf_count "$OUT") 处违规）"
fi

# B5 边界：非 src / 非 ts(x) 新增不计入（坏样本仍在，计数不得增加）
printf '# doc\n' > "$SB/src/notes.md"
printf 'echo y\n' > "$SB/tests/plain.ts"
git -C "$SB" add -A
OUT="$(run_backstop)"
if [ "$(sf_count "$OUT")" -eq 1 ] && printf '%s' "$OUT" | grep 'SOFTFAIL' | grep -q 'src/bad.tsx'; then
  ok "B5 边界：新增 src/*.md、tests/*.ts 不计入（计数仍 1，只因 src/bad.tsx）"
else
  no "B5 范围失配（违规数 $(sf_count "$OUT")，期望仍为 1）"
fi

# B6 生产接线（WIRE CHECK）: 段必须在 `# 结果` 汇总锚点之前；package.json 有 new 脚本
L_BEGIN="$(grep -n 'CONTRACT-BACKSTOP-BEGIN' "$PRECOMMIT" | head -1 | cut -d: -f1)"
L_RESULT="$(grep -n '^# 结果' "$PRECOMMIT" | head -1 | cut -d: -f1)"
if [ -n "$L_BEGIN" ] && [ -n "$L_RESULT" ] && [ "$L_BEGIN" -lt "$L_RESULT" ]; then
  ok "B6a 兜底段在「# 结果」汇总锚点之前（begin=L${L_BEGIN} < result=L${L_RESULT}）"
else
  no "B6a 兜底段不在汇总锚点之前（begin=${L_BEGIN:-无} result=${L_RESULT:-无}）—— 放汇总后等于永不点火"
fi
if grep -q 'bash scripts/dev/new-file.sh' "$REPO/package.json"; then
  ok "B6b 生产接线：package.json 有 new 脚本（bash scripts/dev/new-file.sh）"
else
  no "B6b package.json 未接 new 脚本（生成器无入口）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
