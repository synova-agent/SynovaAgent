#!/usr/bin/env bash
# D313/D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# verify-doc-gate-effectiveness.test.sh — G-DOC 生效性判据的配对测试（W0-1 / P2-c）
#
# 本测试要证明的三件事（缺一即不合格）:
#   ① **三态**：0（6 规则全生效）／1（真红：无实现、declared-only、MAP 不实）／2（判不了：映射不齐、
#      规则源缺失）各自可达，且 **2 绝不冒充 0**；
#   ② **不编造调用点**：MAP 声称的调用点若不存在、"只在注释里出现"、或 kind 标注不实 ⇒ 必须红；
#   ③ **改坏必红（结论翻转）**：在真实根上把两处判据点（无实现即红／declared-only 即红）
#      改成恒绿 ⇒ rc 从 1 翻成 0；说明判据真在看这两件事，而不是恒红。
#
# 覆盖矩阵（A 真实根 ｜ B 绿态 ｜ C 判不了 ｜ D 编造与误标 ｜ E 变异体 ｜ F 自检与日志）:
#   A1 真实根（本批 @a025fc47e＋裁决 #1238 ③）⇒ rc=1（**如实红**：5 红 / 1 绿）
#   A2 逐条：5 行 ❌ ＋ G-DOC-4 ✅；结论行逐字 `EFFECTIVENESS: RED 6 ｜ 生效 1/6 ｜ declared-only 4 ｜ 无实现 1（G-DOC-6）`
#      ＋ 其上一行口径说明（`RED 6` 的 6 = 判据面规则总数，不是 6 条全红）
#   A3 G-DOC-4 ✅（裁决③：check-doc-contract.sh ＋ pre-commit-check.sh:518）；G-DOC-6 判 E_NO_IMPL
#   A4 G-DOC-1/2/3/5 判 E_DECLARED_ONLY（只有 test/registry 调用点）
#   B1 沙箱绿态（6 规则全有实现 ＋ 生产调用点）⇒ rc=0 ＋ `EFFECTIVENESS: OK 6/6`
#   B2 绿态逐条 6 行 ✅ ＋ 汇总 `生效 6/6`
#   C1 删一条 MAP ⇒ rc=2 ＋ `degraded: E_MAP_MISSING`（映射不齐 = 判不了）
#   C2 规则源缺失 ⇒ rc=2 ＋ `degraded: E_DOC_STANDARD_MISSING`
#   C3 规则源少一条规则行（MAP 多）⇒ rc=2（双向对齐失败）
#   D1 MAP 声明的实现件不存在 ⇒ rc=1 ＋ `E_IMPL_MISSING` ＋ 点名该规则
#   D2 生产调用点只剩注释 ⇒ rc=1 ＋ `E_DECLARED_ONLY`（注释不算调用点）
#   D3 kind 标注不实（production ↔ 实际 tests/）⇒ rc=1 ＋ `E_MAP_MISMATCH`
#   D4 未知参数 ⇒ rc=2 ＋ `degraded: E_USAGE`
#   D5 G-DOC-4 调用点两态：含 pre-commit 调用点 ⇒ ✅；删掉调用点 ⇒ rc=1 点名 E_MAP_MISMATCH
#   E1 变异体（两处判据点改恒绿）在真实根 ⇒ rc=0（原脚本 1）＝ 结论翻转
#   F1 `--selfcheck` ⇒ rc=0 且末行 `SELFCHECK-OK`
#   F2 降级日志 JSON 五字段齐全（time/component/code/phase/retryable）
#
# 沙箱: 夹具全在 mktemp -d 内；`SYNO_GATE_DEGRADED_LOG` 全局指向临时目录 ⇒ 降级日志绝不进仓库。
#       被测脚本**开工时取一次快照**再跑（平台共享 cwd 无隔离，避免读到别的成员正在写的半截文件）。
#       变异体只 sed 两行判据点，不碰其它逻辑（sed 未命中 ⇒ 断言直接判红，防"夹具与实现脱节")。
# 依赖: bash（3.2+）＋ sed/grep/awk ＋ python（仅 JSON 断言；缺失 ⇒ 判红不 skip）。
# 规模: 直接调用被测脚本 13 次（本机 Git Bash 每起一次 ≈ 10 s，故不把用例铺更多）。
# 运行: bash tests/doc-system/verify-doc-gate-effectiveness.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e

# 环境隔离（AGENTS.md §8.1 ②）: 夹具不继承外层 git/CI 上下文
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
S="$REPO/scripts/doc-system/verify-doc-gate-effectiveness.sh"
PASS=0
FAIL=0

ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
t() { if [ "$2" = "$3" ]; then ok "$1 (=$3)"; else no "$1 (期望 $2 实际 $3)"; fi; }

fatal() { # 环境/夹具失败 ⇒ 后续断言不可信：打印汇总后判红（禁 skip 冒充通过）
  no "环境/夹具失败: $1"
  echo ""
  echo "── 汇总: ${PASS} 通过 / ${FAIL} 失败 ──"
  echo "结果: ${PASS} 通过, ${FAIL} 失败"
  exit 1
}

[ -f "$S" ] || fatal "被测脚本缺失: $S"
PY=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import json" >/dev/null 2>&1 && PY="$_c" && break
done
[ -n "$PY" ] || fatal "python 三级探测全失败（D520 清单1）—— 无法核降级日志 JSON"

TMPD="$(mktemp -d)" || fatal "mktemp -d 失败"
trap 'rm -rf "$TMPD"' EXIT
LAST="$TMPD/last.out"
export SYNO_GATE_DEGRADED_LOG="$TMPD/degraded-events.log"

# 平台是**共享 cwd、无隔离**：被测件可能在别的成员写入的瞬间被读到半截
# （2026-10-31 实测一次：A1 拿到空文件 ⇒ rc=0、输出为空；随后直跑同一文件 rc=1 正常，文件 490 行、hash 与 index 一致）。
# ⇒ 测试开始时取**一次快照**，之后所有调用都打在快照上；`--root` 仍指向真实仓，
#   所以"真实根"用例的语义不变（判的是仓，不是脚本位置），只是不再受并发写干扰。
S0="$S"
cp "$S0" "$TMPD/subject.sh" || fatal "被测脚本快照失败: $S0"
S="$TMPD/subject.sh"
[ -s "$S" ] || fatal "被测脚本快照为空（源文件此刻正在被写？稍后重跑本测试）"

rc_of() { # $1=脚本 $2=root [额外参数…] → 输出落 $LAST，回显 rc
  local _s="$1" _r="$2"; shift 2
  bash "$_s" --root "$_r" "$@" > "$LAST" 2>&1
  echo $?
}
out_has() { grep -qF -- "$1" "$LAST"; }
out_cnt() { grep -cF -- "$1" "$LAST" | tr -d '\r\n'; }

# ── 夹具构造（**独立一份**，不复用被测脚本内部的 mk_*；这样脚本夹具坏了本测试才会红）──
mk_rules() { # $1=dir [$2=要省略的规则号]
  mkdir -p "$1/docs/authority" || return 1
  : > "$1/docs/authority/DOC-STANDARD.md" || return 1
  local n
  for n in 1 2 3 4 5 6; do
    [ "${2:-}" = "$n" ] && continue
    printf -- '- **G-DOC-%s 夹具规则%s**：沙箱夹具（配对测试）。\n' "$n" "$n" >> "$1/docs/authority/DOC-STANDARD.md" || return 1
  done
  return 0
}
mk_tree() { # $1=dir  → tools/gN.sh ＋ scripts/caller.sh（生产调用点）＋ tests/gN.test.sh
  mk_rules "$1" || return 1
  mkdir -p "$1/tools" "$1/scripts" "$1/tests" || return 1
  : > "$1/scripts/caller.sh" || return 1
  local n
  for n in 1 2 3 4 5 6; do
    printf '#!/bin/bash\n# 夹具实现 g%s\n' "$n" > "$1/tools/g$n.sh" || return 1
    printf '#!/bin/bash\n# 夹具测试 g%s\nbash tools/g%s.sh\n' "$n" "$n" > "$1/tests/g$n.test.sh" || return 1
    printf 'bash "$ROOT/tools/g%s.sh"\n' "$n" >> "$1/scripts/caller.sh" || return 1
  done
  return 0
}
mk_realmap_tree() { # $1=dir [$2=with-g4-callpoint]  → 按**真实 MAP 的路径与行锚**造树（验 G-DOC-4 调用点两态）
  mk_rules "$1" || return 1
  mkdir -p "$1/scripts/control-tower" "$1/scripts/doc-system" "$1/tests/doc-system" || return 1
  printf '#!/bin/bash\n# 夹具 check-doc-contract.sh\n' > "$1/scripts/control-tower/check-doc-contract.sh" || return 1
  # 行锚必须真的落在第 518 行（真实仓 pre-commit-check.sh:518）⇒ 先铺 517 行填充行，
  # 否则夹具会把"行锚对不上"误报成判据缺陷（2026-10-31 实测踩过一次）。
  { printf '#!/bin/bash\n'; local i=2
    while [ "$i" -le 517 ]; do printf '# filler %s\n' "$i"; i=$((i + 1)); done
    if [ "${2:-with}" = "with" ]; then
      printf 'DOC_CONTRACT_OUT=$(bash "$ROOT/scripts/control-tower/check-doc-contract.sh" 2>&1)\n'
    else
      # 这一行**不得出现实现件文件名**：否则行锚检查仍会命中，"删调用点"的夹具就自证了
      # （2026-10-31 实测踩过一次：注释里写了文件名 ⇒ 走成 E_NO_CALLPOINT 而不是 E_MAP_MISMATCH）
      printf '# 已删掉对该检查器的调用（调用点两态之"删"）\n'
    fi
  } > "$1/scripts/pre-commit-check.sh" || return 1
  local pair
  for pair in "verify-doc-budgets" "verify-doc-gate-effectiveness" "check-doc-g3-datestamp" "check-doc-g5-bare-filename"; do
    printf '#!/bin/bash\n' > "$1/scripts/doc-system/$pair.sh" || return 1
    printf 'bash scripts/doc-system/%s.sh\n' "$pair" > "$1/tests/doc-system/$pair.test.sh" || return 1
  done
  return 0
}
# 绿态变异体: MAP 六行全部指向 tools/gN.sh ＋ scripts/caller.sh（production）
GREEN_SED='s|^# MAP: G-DOC-([1-6]) [^ ]+ [^ ]+ [a-z-]+$|# MAP: G-DOC-\1 tools/g\1.sh scripts/caller.sh production|'
mk_green() {
  sed -E "$GREEN_SED" "$S" > "$1" || return 1
  [ "$(grep -cE '^# MAP: G-DOC-[1-6] tools/g' "$1")" = "6" ] || return 1
  return 0
}

echo "═══ verify-doc-gate-effectiveness.test.sh — G-DOC 生效性（W0-1 P2-c）═══"
echo "夹具根: $TMPD"

# ── A 真实根（如实红：这是本批的事实，不是缺陷）────────────────────────────────
echo "── A 真实根（如实红）──"
t "A1 真实根 ⇒ rc=1（今天 6/6 无生产调用点或无实现）" 1 "$(rc_of "$S" "$REPO")"
out_has "规则源: docs/authority/DOC-STANDARD.md（解析到 6 条规则行）" \
  && ok "A1 解析到 6 条规则行" || no "A1 规则行解析数不符；原始输出: $(grep -F '规则源' "$LAST")"
[ "$(out_cnt "❌ G-DOC-")" = "5" ] && ok "A2 逐条点名 5 条红（❌ 计数=5；G-DOC-4 依裁决 #1238 ③ 判 ✅）" \
  || no "A2 ❌ 计数=$(out_cnt "❌ G-DOC-")（应 5）"
out_has "EFFECTIVENESS: RED 6 ｜ 生效 1/6 ｜ declared-only 4 ｜ 无实现 1（G-DOC-6）" \
  && ok "A2 结论行逐字命中裁决 #1238 ③ 口径" || no "A2 结论行不符；原始输出: $(grep -F 'EFFECTIVENESS:' "$LAST")"
out_has "结论行首个数字 = 判据面规则总数 6" \
  && ok "A2 口径说明行在（防把 RED 6 读成 6 条全红）" || no "A2 缺口径说明行；原始输出: $(grep -F '口径' "$LAST")"
out_has "✅ G-DOC-4 一事实一归属 · OK — 实现 scripts/control-tower/check-doc-contract.sh" \
  && ok "A3 G-DOC-4 ✅（裁决③：check-doc-contract.sh ＋ pre-commit-check.sh:518 生产调用点）" \
  || no "A3 G-DOC-4 判定不符；原始输出: $(grep -F 'G-DOC-4' "$LAST")"
out_has "❌ G-DOC-6 变更史词 · E_NO_IMPL" && ok "A3 G-DOC-6 判 E_NO_IMPL（基线无实现，如实红）" \
  || no "A3 G-DOC-6 判定不符；原始输出: $(grep -F 'G-DOC-6' "$LAST")"
out_has "❌ G-DOC-3 日期戳 · E_DECLARED_ONLY" && ok "A4 G-DOC-3 判 E_DECLARED_ONLY（WIRING-REGISTRY 亦称 declared-only）" \
  || no "A4 G-DOC-3 判定不符；原始输出: $(grep -F 'G-DOC-3' "$LAST")"
out_has "❌ G-DOC-5 裸文件名引用 · E_DECLARED_ONLY" && ok "A4 G-DOC-5 判 E_DECLARED_ONLY" \
  || no "A4 G-DOC-5 判定不符；原始输出: $(grep -F 'G-DOC-5' "$LAST")"
out_has "declared-only 4" && ok "A4 汇总 declared-only 4（G-DOC-1/2/3/5：仅 test/registry 调用点）" \
  || no "A4 汇总行不符；原始输出: $(grep -F '生效 ' "$LAST")"
out_has "无实现 1" && ok "A4 汇总 无实现 1（G-DOC-6）" \
  || no "A4 汇总行不符（无实现数）；原始输出: $(grep -F '生效 ' "$LAST")"

# ── B 绿态（0 可达）──────────────────────────────────────────────────────────
echo "── B 绿态（0 可达）──"
mk_green "$TMPD/green.sh" || fatal "绿态变异体生成失败（MAP 行格式已变，须同步本测试的 sed）"
mk_tree "$TMPD/tree" || fatal "绿态夹具构造失败"
t "B1 6 规则全生效 ⇒ rc=0" 0 "$(rc_of "$TMPD/green.sh" "$TMPD/tree")"
out_has "EFFECTIVENESS: OK 6/6" && ok "B1 结论行 EFFECTIVENESS: OK 6/6" || no "B1 结论行不符"
[ "$(out_cnt "✅ G-DOC-")" = "6" ] && ok "B2 逐条 6 行 ✅" || no "B2 ✅ 计数=$(out_cnt "✅ G-DOC-")（应 6）"
out_has "生效 6/6" && ok "B2 汇总 生效 6/6" || no "B2 汇总行不符"

# ── C 判不了（2：映射不齐 / 规则源缺失）────────────────────────────────────────
echo "── C 判不了（2）──"
grep -vE '^# MAP: G-DOC-2 ' "$S" > "$TMPD/nomap.sh"
grep -qE '^# MAP: G-DOC-2 ' "$TMPD/nomap.sh" && fatal "删 MAP 变异体未生效（sed/grep 与实现脱节）"
t "C1 删一条 MAP ⇒ rc=2" 2 "$(rc_of "$TMPD/nomap.sh" "$TMPD/tree")"
out_has "degraded: E_MAP_MISSING" && ok "C1 degraded: E_MAP_MISSING" || no "C1 缺 E_MAP_MISSING"

D2="$TMPD/no-std"; mkdir -p "$D2" || fatal "C2 夹具目录建失败"
t "C2 规则源缺失 ⇒ rc=2" 2 "$(rc_of "$S" "$D2")"
out_has "degraded: E_DOC_STANDARD_MISSING" && ok "C2 degraded: E_DOC_STANDARD_MISSING" || no "C2 缺 E_DOC_STANDARD_MISSING"

D3="$TMPD/five-rules"; mk_rules "$D3" 6 || fatal "C3 夹具构造失败"
t "C3 规则源少一条规则行（MAP 有 6）⇒ rc=2（双向对齐失败）" 2 "$(rc_of "$S" "$D3")"
out_has "degraded: E_MAP_MISSING" && ok "C3 degraded: E_MAP_MISSING" || no "C3 缺 E_MAP_MISSING"

# ── D 编造与误标（1：不许把"没有"写成"有"）─────────────────────────────────────
echo "── D 编造与误标 ──"
D4="$TMPD/miss-impl"; mk_tree "$D4" || fatal "D1 夹具构造失败"
rm -f "$D4/tools/g3.sh"
t "D1 MAP 声明的实现件不存在 ⇒ rc=1" 1 "$(rc_of "$TMPD/green.sh" "$D4")"
out_has "❌ G-DOC-3 夹具规则3 · E_IMPL_MISSING" && ok "D1 点名 G-DOC-3 E_IMPL_MISSING" \
  || no "D1 未点名；原始输出: $(grep -F 'G-DOC-3' "$LAST")"

D5="$TMPD/comment-only"; mk_tree "$D5" || fatal "D2 夹具构造失败"
{ printf '#!/bin/bash\n# bash "$ROOT/tools/g1.sh"\n'
  printf 'bash "$ROOT/tools/g2.sh"\nbash "$ROOT/tools/g3.sh"\nbash "$ROOT/tools/g4.sh"\n'
  printf 'bash "$ROOT/tools/g5.sh"\nbash "$ROOT/tools/g6.sh"\n'; } > "$D5/scripts/caller.sh"
t "D2 生产调用点只剩注释 ⇒ rc=1" 1 "$(rc_of "$TMPD/green.sh" "$D5")"
out_has "❌ G-DOC-1 夹具规则1 · E_DECLARED_ONLY" && ok "D2 点名 G-DOC-1 E_DECLARED_ONLY（注释不算调用点）" \
  || no "D2 未点名；原始输出: $(grep -F 'G-DOC-1' "$LAST")"

# D3 kind 标注不实: 实现件真实存在、调用点也真的引用它，但 MAP 把 tests/ 的调用点标成 production
grep -vE '^# MAP: G-DOC-1 ' "$S" > "$TMPD/lie.sh"
printf '# MAP: G-DOC-1 tools/g1.sh tests/g1.test.sh production\n' >> "$TMPD/lie.sh"   # 实际 kind(rel)=test
grep -qF 'MAP: G-DOC-1 tools/g1.sh tests/g1.test.sh production' "$TMPD/lie.sh" || fatal "D3 误标变异体生成失败"
D6="$TMPD/lie-tree"; mk_tree "$D6" || fatal "D3 夹具构造失败"
t "D3 kind 标注不实 ⇒ rc=1" 1 "$(rc_of "$TMPD/lie.sh" "$D6")"
out_has "MAP 标注 kind=production，按路径实测应为 test" && ok "D3 点名 kind 标注不实（E_MAP_MISMATCH）" \
  || no "D3 未点名 kind 不实；原始输出: $(grep -F 'MAP 标注' "$LAST")"

t "D4 未知参数 ⇒ rc=2" 2 "$(rc_of "$S" "$TMPD/tree" --bogus)"
out_has "degraded: E_USAGE" && ok "D4 degraded: E_USAGE" || no "D4 缺 E_USAGE"

# D5 删掉 G-DOC-4 的生产调用点（pre-commit-check.sh 仍在，但不再引用 check-doc-contract.sh）
#    ⇒ 必须 rc=1 且点名 G-DOC-4（与 A3 的真实根 ✅ 构成两态：调用点在=绿，调用点删=红）
D7="$TMPD/realmap-with";   mk_realmap_tree "$D7" with    || fatal "D5 夹具(A)构造失败"
D8="$TMPD/realmap-without"; mk_realmap_tree "$D8" without || fatal "D5 夹具(B)构造失败"
t "D5a 真实 MAP 路径树（含 pre-commit 调用点）⇒ G-DOC-4 绿（其余 5 红，rc=1）" 1 "$(rc_of "$S" "$D7")"
out_has "✅ G-DOC-4 夹具规则4 · OK — 实现 scripts/control-tower/check-doc-contract.sh" \
  && ok "D5a 有调用点 ⇒ G-DOC-4 ✅" || no "D5a G-DOC-4 未绿；原始输出: $(grep -F 'G-DOC-4' "$LAST")"
t "D5b 删掉该生产调用点 ⇒ rc=1" 1 "$(rc_of "$S" "$D8")"
out_has "❌ G-DOC-4 夹具规则4 · E_MAP_MISMATCH" && ok "D5b 点名 G-DOC-4 E_MAP_MISMATCH（编造/失效调用点必红）" \
  || no "D5b 未点名；原始输出: $(grep -F 'G-DOC-4' "$LAST")"

# ── E 变异体（改坏必红 = 结论翻转）─────────────────────────────────────────────
echo "── E 变异体（结论翻转）──"
t "E0 原脚本在真实根 ⇒ rc=1（真红，非恒红）" 1 "$(rc_of "$S" "$REPO")"
# 把两处判据点改成恒绿：无实现不再红、declared-only 不再红
sed -e 's/V_RC=1; V_CODE="E_NO_IMPL"/V_RC=0; V_CODE="E_NO_IMPL"/' \
    -e 's/V_RC=1; V_CODE="E_DECLARED_ONLY"/V_RC=0; V_CODE="E_DECLARED_ONLY"/' \
    "$S" > "$TMPD/mutant.sh"
[ "$(grep -cE 'V_RC=0; V_CODE="E_NO_IMPL"' "$TMPD/mutant.sh")" = "1" ] \
  && ok "E1 变异体已生成（命中 @mutate-point: no-impl-is-red）" \
  || no "E1 sed 未命中无实现判据点（结构已变，须同步本测试）"
[ "$(grep -cE 'V_RC=0; V_CODE="E_DECLARED_ONLY"' "$TMPD/mutant.sh")" = "1" ] \
  && ok "E1 变异体已生成（命中 @mutate-point: declared-only-is-red）" \
  || no "E1 sed 未命中 declared-only 判据点（结构已变，须同步本测试）"
t "E1 变异体在真实根 ⇒ rc=0（结论从 1 翻成 0）" 0 "$(rc_of "$TMPD/mutant.sh" "$REPO")"
out_has "EFFECTIVENESS: OK 6/6" && ok "E1 变异体打 OK 6/6（两处判据点确实承重）" \
  || no "E1 变异体未翻绿；原始输出: $(grep -F 'EFFECTIVENESS:' "$LAST")"

# ── F 自检与降级日志 ────────────────────────────────────────────────────────
echo "── F 自检与降级日志 ──"
bash "$S" --selfcheck > "$LAST" 2>&1
t "F1 --selfcheck ⇒ rc=0" 0 "$?"
tail -1 "$LAST" | grep -qx "SELFCHECK-OK" && ok "F1 末行 SELFCHECK-OK" || no "F1 末行不是 SELFCHECK-OK: $(tail -1 "$LAST")"
out_has "SELFCHECK: " && ok "F1 打印自检断言计数" || no "F1 未打印自检断言计数"

tail -1 "$SYNO_GATE_DEGRADED_LOG" | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
assert d.get("time"), "time missing"
assert d.get("component") == "verify-doc-gate-effectiveness", "component=%r" % d.get("component")
assert d.get("code"), "code missing"
assert d.get("phase"), "phase missing"
assert d.get("retryable") is True, "retryable=%r" % d.get("retryable")
' && ok "F2 降级日志 JSON 五字段齐全（time/component/code/phase/retryable）" \
  || no "F2 降级日志字段缺失或非法 JSON: $(tail -1 "$SYNO_GATE_DEGRADED_LOG" 2>/dev/null)"

echo ""
echo "── 汇总: ${PASS} 通过 / ${FAIL} 失败 ──"
echo "结果: ${PASS} 通过, ${FAIL} 失败"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
