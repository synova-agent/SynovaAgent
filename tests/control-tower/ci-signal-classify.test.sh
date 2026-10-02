#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# ci-signal-classify.test.sh — D1039: control-tower 重活「按需跑」判据（配对测试）
#
# 覆盖矩阵（铁律 48 三路径 + 接线 + 判别性）:
#   正常 — 逐条命中夹具（scripts/ 全树 3 子域 + 根级脚本 + tests/control-tower +
#          tests/doc-system + 全体 .github/workflows/** + .gitattributes + .gitmodules
#          + tsconfig*.json + package.json）⇒ run=true
#   正常 — 未命中夹具（src/x.ts、docs/y.md）⇒ run=false（不误跑）
#   边界 — 空变更集 ⇒ run=false；混合 ⇒ run=true；换行分隔 ⇒ run=true；
#          近名/子串（docs/ci.yml.bak、my-package.json、sub/package.json、docs/tsconfig.json）⇒ run=false（锚定生效）
#   降级 — base ref 不可解析 ⇒ exit 2 + run=true + stderr 留痕（绝不误跳）
#   降级 — git 不在 PATH（`command -v` 守卫）⇒ exit 2 + run=true（不可用平台显式 SKIP，不谎报通过）
#   失败 — 调用非法（未知参数 / 未知 --mode / --mode github 缺 $GITHUB_OUTPUT）⇒ exit 1 + fail-closed run=true
#   接线 — ci.yml control-tower-tests 真调用分类器 + id: ctsignal + 重活 step 消费 run；
#          job 恒被调度（无 job 级 if:/paths:）；job 名/matrix/timeout 未改；其余 9 job 保持
#          无 job 级 if:（分支保护基线不变，仅 checker-review 原有 if: 逐字不变）；
#          workflow_dispatch + force 输入 + schedule cron 已声明；ctsignal 在重活 step 之前；canary 清单含本测试
#   判别 — 「路径集收窄即红」①: tests/ 引用的 N 个 scripts/ leaf 必须全部 run=true
#   判别 — 「路径集收窄即红」②: tests 引用的全体 workflow 文件必须全部 run=true
#          （漏点1: 只列 ci.yml ⇒ progress-freshness-watchdog.yml / dashboard-auto.yml 静默跳过）
#   判别 — 「漏点2 净回归」: .gitattributes 单文件 ⇒ run=true（今天它触发全量；不覆盖=跑→静默跳）
#   判别 — 「GH errexit 语义」③: 从 ci.yml 抽真 step 正文，在
#          `bash --noprofile --norc -eo pipefail`（= GH `shell: bash` 真实语义）下跑：
#          分类器降级(2) ⇒ STEP EXIT=0 + ::warning 可见；自身失败(1) ⇒ STEP EXIT=1（fail-closed）。
#          红向证明: 去掉「|| RC=赋值」⇒ STEP EXIT=2 ⇒ 用例转红（夹具判别性成立）。
# 沙箱: 全部走 --files / SYNO_CT_CLASSIFY_FILES 注入缝 + mktemp 临时 $GITHUB_OUTPUT + 桩分类器；
#       不写真实仓库、不依赖本仓库 diff 状态、零网络、零外部依赖（CI canary job 无 npm ci）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO/scripts/control-tower/ci-signal-classify.sh"
CI="$REPO/.github/workflows/ci.yml"
PASS=0; FAIL=0; SKIP=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
no()   { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
skip() { echo "  ⚠ SKIP($1): $2 —— 显式声明，不计通过"; SKIP=$((SKIP+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D1039: ci-signal-classify（control-tower 重活按需跑判据）==="

# ── 工具: 跑分类器，首行 = rc，其余 = 合并输出 ──
run_cls() {   # $1 = 注入变更集（显式；空串 = 空变更集）
  local res rc
  res="$( ( unset SYNO_CT_CLASSIFY_FILES; bash "$SCRIPT" --files "$1" ) 2>&1 )"
  rc=$?
  printf '%s\n%s\n' "$rc" "$res"
}
expect_run() {   # $1 = true|false  $2 = 用例名  $3 = 变更集
  local want="$1" name="$2" files="$3" res rc body
  res="$(run_cls "$files")"
  rc="$(printf '%s\n' "$res" | sed -n '1p')"
  body="$(printf '%s\n' "$res" | sed -n '2,$p')"
  if [ "$rc" != "0" ]; then
    no "${name}: 应 exit 0，实际 ${rc}（$(printf '%s' "$body" | tr '\n' '|')）"
    return
  fi
  if printf '%s' "$body" | grep -q "run=${want}"; then
    ok "${name} ⇒ run=${want}"
  else
    no "${name}: 未得 run=${want}（尾两行: $(printf '%s' "$body" | tail -n2 | tr '\n' '|')）"
  fi
}
job_block() {   # $1 = job 名 → 该 job 的 YAML 块（2 空格缩进锚定 job 边界）
  awk -v job="$1" '
    $0 ~ "^  " job ":$" { inside=1; print; next }
    inside && /^  [A-Za-z0-9_-]+:$/ { exit }
    inside { print }
  ' "$CI"
}

# ── 0. 前置: 脚本 + 契约头块（铁律 47）──
[ -f "$SCRIPT" ] && ok "分类器存在" || no "分类器缺失: $SCRIPT"
[ -x "$SCRIPT" ] && ok "分类器可执行" || no "分类器不可执行"
for k in '@input' '@output' '@exit' '@degraded' '@seam'; do
  grep -q -- "$k" "$SCRIPT" && ok "契约头块含 ${k}" || no "契约头块缺 ${k}"
done

# ── 1. 正常: 逐条命中夹具 ⇒ run=true（判别性夹具之一）──
expect_run true "命中 scripts/hooks/x.sh（scripts 全树·非 control-tower 域）" "scripts/hooks/x.sh"
expect_run true "命中 scripts/ci/y.sh（scripts 全树·非 control-tower 域）"    "scripts/ci/y.sh"
expect_run true "命中 scripts/product-lines/z.py（scripts 全树·非 ct 域）"    "scripts/product-lines/z.py"
expect_run true "命中 scripts/pre-commit-check.sh（根级脚本）"                "scripts/pre-commit-check.sh"
expect_run true "命中 tests/control-tower/a.test.sh"                          "tests/control-tower/a.test.sh"
expect_run true "命中 tests/doc-system/b.test.sh"                             "tests/doc-system/b.test.sh"
expect_run true "命中 .github/workflows/ci.yml"                               ".github/workflows/ci.yml"
expect_run true "命中 .github/workflows/progress-freshness-watchdog.yml（漏点1: check-progress-freshness.test.sh:42 直引且真会跑）" ".github/workflows/progress-freshness-watchdog.yml"
expect_run true "命中 .github/workflows/dashboard-auto.yml（generated-gate.test.sh:49 同型直引）" ".github/workflows/dashboard-auto.yml"
expect_run true "命中 .gitattributes（漏点2: *.sh eol=lf 检出层；不覆盖=净回归）" ".gitattributes"
expect_run true "命中 .gitmodules（同族检出层）"                               ".gitmodules"
expect_run true "命中 tsconfig.build.json"                                    "tsconfig.build.json"
expect_run true "命中 package.json"                                           "package.json"

# ── 2. 正常: 未命中夹具 ⇒ run=false（不误跑）──
expect_run false "未命中 src/x.ts"  "src/x.ts"
expect_run false "未命中 docs/y.md" "docs/y.md"

# ── 3. 边界 ──
expect_run false "边界: 空变更集 ⇒ run=false"                     ""
expect_run true  "边界: 混合（未命中 + 命中）⇒ run=true"          "src/x.ts docs/y.md scripts/ci/y.sh"
expect_run true  "边界: 换行分隔多文件 ⇒ run=true"                "$(printf 'src/x.ts\n.github/workflows/ci.yml')"
expect_run false "边界: 子串不误命中 docs/ci.yml.bak（锚定 ^…$ 生效）"  "docs/ci.yml.bak"
expect_run false "边界: 近名不误命中 my-package.json"             "my-package.json"
expect_run false "边界: 近名不误命中 sub/package.json"            "sub/package.json"
expect_run false "边界: 非根 tsconfig（docs/tsconfig.json）"      "docs/tsconfig.json"

# ── 4. 降级: base ref 不可解析 ⇒ exit 2 + run=true + stderr 留痕 ──
GOD="$TMPD/gho-degrade"; : > "$GOD"
( unset SYNO_CT_CLASSIFY_FILES; GITHUB_OUTPUT="$GOD" \
  bash "$SCRIPT" --mode github --base refs/heads/__no_such_base__ ) >"$TMPD/out-degrade" 2>"$TMPD/err-degrade"
rcd=$?
[ "$rcd" -eq 2 ] && ok "降级: base 不可解析 ⇒ exit 2" || no "降级 exit 应为 2，实际 $rcd"
grep -q '^run=true$' "$GOD" && ok "降级: 强制 run=true（全量跑，绝不误跳）" \
  || no "降级未写 run=true（$GOD 内容: $(tr '\n' '|' < "$GOD")）"
grep -q 'degraded' "$TMPD/err-degrade" && ok "降级: stderr 显式留痕（铁律 11）" || no "降级无 stderr 留痕"

# ── 4b. 降级: base 为空串（workflow_dispatch 的 base_ref 可为空）⇒ exit 2 + run=true ──
GOE="$TMPD/gho-emptybase"; : > "$GOE"
( unset SYNO_CT_CLASSIFY_FILES; GITHUB_OUTPUT="$GOE" \
  bash "$SCRIPT" --mode github --base "" ) >/dev/null 2>"$TMPD/err-emptybase"
rce=$?
[ "$rce" -eq 2 ] && ok "降级: base 为空串 ⇒ exit 2（不落 run=false）" || no "base 空串应 exit 2，实际 ${rce}"
grep -q '^run=true$' "$GOE" && ok "降级: base 为空串 ⇒ run=true（人工触发永不判「不跑」）" \
  || no "base 空串未写 run=true（人工触发被静默跳过）"

# ── 5. 降级: git 不在 PATH（command -v 守卫）⇒ exit 2 + run=true ──
if [ -n "${BASH:-}" ]; then
  GOG="$TMPD/gho-nogit"; : > "$GOG"
  ( unset SYNO_CT_CLASSIFY_FILES; GITHUB_OUTPUT="$GOG" \
    env PATH="$TMPD/empty-path-dir" "$BASH" "$SCRIPT" --mode github ) >"$TMPD/out-nogit" 2>"$TMPD/err-nogit"
  rcg=$?
  case "$rcg" in
    2)
      grep -q '^run=true$' "$GOG" && ok "降级: git 不在 PATH ⇒ exit 2 + run=true" \
        || no "git 缺失降级未写 run=true"
      ;;
    127) skip "portability" "PATH 剥离下子 shell 无法启动（本平台）⇒ git 缺失分支未覆盖" ;;
    *)   no "git 缺失分支应 exit 2，实际 ${rcg}（$(tr '\n' '|' < "$TMPD/err-nogit")）" ;;
  esac
else
  skip "portability" "\$BASH 不可用 ⇒ git 缺失分支未覆盖"
fi

# ── 6. 失败: 调用非法 ⇒ exit 1 + fail-closed run=true ──
GOF="$TMPD/gho-badarg"; : > "$GOF"
( unset SYNO_CT_CLASSIFY_FILES; GITHUB_OUTPUT="$GOF" bash "$SCRIPT" --bogus ) >/dev/null 2>&1
rcf=$?
[ "$rcf" -eq 1 ] && ok "失败: 未知参数 ⇒ exit 1" || no "未知参数应 exit 1，实际 $rcf"
grep -q '^run=true$' "$GOF" && ok "失败: 未知参数 ⇒ fail-closed run=true" || no "未知参数未写 run=true"
( bash "$SCRIPT" --mode bogus ) >/dev/null 2>&1; rch=$?
[ "$rch" -eq 1 ] && ok "失败: 未知 --mode ⇒ exit 1" || no "未知 --mode 应 exit 1，实际 $rch"
( unset GITHUB_OUTPUT; bash "$SCRIPT" --mode github --files "src/x.ts" ) >/dev/null 2>&1; rci=$?
[ "$rci" -eq 1 ] && ok "失败: --mode github 缺 \$GITHUB_OUTPUT ⇒ exit 1" \
  || no "--mode github 缺 GITHUB_OUTPUT 应 exit 1，实际 $rci"

# ── 7. --mode github: 正常写 $GITHUB_OUTPUT ──
GOT="$TMPD/gho-hit"; : > "$GOT"
GITHUB_OUTPUT="$GOT" bash "$SCRIPT" --mode github --files "scripts/ci/y.sh" >/dev/null 2>&1
if [ "$?" -eq 0 ] && grep -q '^run=true$' "$GOT"; then ok "mode github: 命中 ⇒ 写 run=true"; else no "mode github 命中未写 run=true"; fi
GOM="$TMPD/gho-miss"; : > "$GOM"
GITHUB_OUTPUT="$GOM" bash "$SCRIPT" --mode github --files "src/x.ts" >/dev/null 2>&1
if [ "$?" -eq 0 ] && grep -q '^run=false$' "$GOM"; then ok "mode github: 未命中 ⇒ 写 run=false"; else no "mode github 未命中未写 run=false"; fi

# ── 8. 注入缝 SYNO_CT_CLASSIFY_FILES ──
if SYNO_CT_CLASSIFY_FILES="tests/doc-system/b.test.sh" bash "$SCRIPT" 2>/dev/null | grep -q 'run=true'; then
  ok "seam: SYNO_CT_CLASSIFY_FILES 生效（测试不改写真实仓库）"
else
  no "seam SYNO_CT_CLASSIFY_FILES 未生效"
fi

# ── 9. 判别性: 路径集收窄即红 —— tests 引用的 scripts/ leaf 必须全覆盖 ──
LEAVES="$(grep -rhoE 'scripts/[A-Za-z0-9._/-]+\.(sh|py|ts|json)' \
  "$REPO"/tests/control-tower/*.test.sh "$REPO"/tests/doc-system/*.test.sh 2>/dev/null | sort -u)"  # swallow-ok: 夹具路径提取；无匹配仅致空集，且紧随的「夹具退化」断言会把空集判红
NLEAF="$(printf '%s\n' "$LEAVES" | grep -c . | tr -d '\n\r')"
if [ "$NLEAF" -ge 100 ]; then
  ok "夹具前置: 提取到 ${NLEAF} 个 scripts/ leaf（≥100，夹具未退化）"
else
  no "夹具退化: 只提取到 ${NLEAF} 个 scripts/ leaf（判据可能漏跑）"
fi
for probe in scripts/hooks/hook-block-write.sh scripts/pre-commit-check.sh scripts/ci/verify-doc.sh; do
  printf '%s\n' "$LEAVES" | grep -qxF "$probe" \
    && ok "夹具含非 control-tower 域 leaf: ${probe}" || no "夹具缺 leaf: ${probe}"
done
JOINED="$(printf '%s ' $LEAVES)"
res9="$(run_cls "$JOINED")"; rc9="$(printf '%s\n' "$res9" | sed -n '1p')"
if [ "$rc9" = "0" ] && printf '%s' "$res9" | grep -q 'run=true'; then
  ok "判别性: ${NLEAF} 个 leaf 全部命中 ⇒ run=true（收窄 RULES 即转红）"
else
  no "判别性失败: script leaf 覆盖不全（rc=${rc9}）⇒ 有路径会被漏跑"
fi

# ── 9b. 判别性: 全体 workflow 引用面（tests 引到的每个 workflow 文件必须 run=true）──
# 漏点1 的口径: 只列 ci.yml 会漏掉 watchdog/dashboard-auto —— 这里把「tests 真引用的 workflow」
# 当作夹具输入，收窄成只认 ci.yml 即转红。
WFS="$(grep -rhoE '\.github/workflows/[A-Za-z0-9._-]+' \
  "$REPO"/tests/control-tower/*.test.sh "$REPO"/tests/doc-system/*.test.sh 2>/dev/null | sort -u)"  # swallow-ok: 夹具路径提取；无匹配仅致空集，且紧随的「夹具退化」断言会把空集判红
NWF="$(printf '%s\n' "$WFS" | grep -c . | tr -d '\n\r')"
if [ "$NWF" -ge 2 ]; then
  ok "夹具前置: 提取到 ${NWF} 个 workflow 引用（≥2，夹具未退化）"
else
  no "夹具退化: 只提取到 ${NWF} 个 workflow 引用"
fi
for probe in .github/workflows/progress-freshness-watchdog.yml .github/workflows/dashboard-auto.yml; do
  printf '%s\n' "$WFS" | grep -qxF "$probe" \
    && ok "夹具含 workflow 漏点: ${probe}" || no "夹具缺 workflow 漏点: ${probe}"
done
WJOINED="$(printf '%s ' $WFS)"
res9b="$(run_cls "$WJOINED")"; rc9b="$(printf '%s\n' "$res9b" | sed -n '1p')"
if [ "$rc9b" = "0" ] && printf '%s' "$res9b" | grep -q 'run=true'; then
  ok "判别性: ${NWF} 个 workflow 引用全部命中 ⇒ run=true（只认 ci.yml 即转红）"
else
  no "判别性失败: workflow 引用面覆盖不全（rc=${rc9b}）⇒ 改非 ci.yml 的 workflow 会静默跳过"
fi

# ── 10. 接线: ci.yml 结构断言（必需 context 恒上报是硬约束）──
CTJOB="$(job_block control-tower-tests)"
[ -n "$CTJOB" ] && ok "ci.yml: control-tower-tests job 块可解析" || no "job 块提取失败"
printf '%s' "$CTJOB" | grep -q 'id: ctsignal' \
  && ok "接线: classify step 有 id: ctsignal" || no "缺 id: ctsignal"
printf '%s' "$CTJOB" | grep -q 'scripts/control-tower/ci-signal-classify.sh' \
  && ok "接线: ci.yml 真调用分类器（铁律 0-2 WIRE CHECK）" || no "ci.yml 未调用分类器"
printf '%s' "$CTJOB" | grep -q 'steps.ctsignal.outputs.run' \
  && ok "接线: 重活 step 消费 ctsignal.outputs.run" || no "重活 step 未消费判据输出"
printf '%s' "$CTJOB" | grep -q "github.event_name == 'schedule'" \
  && ok "安全网③: schedule run 无条件跑重活" || no "缺 schedule 无条件分支"
if printf '%s' "$CTJOB" | grep -qE '^    if:'; then
  no "control-tower-tests 出现 job 级 if:（必需 context 有被跳过的风险）"
else
  ok "必需 context: control-tower-tests 无 job 级 if:（恒被调度）"
fi
if printf '%s' "$CTJOB" | grep -qE '^    paths:'; then
  no "control-tower-tests 出现 job 级 paths:（job 不创建 ⇒ 必需 context 永不报告）"
else
  ok "必需 context: control-tower-tests 无 job 级 paths:"
fi
printf '%s' "$CTJOB" | grep -qF "name: Control Tower Gate Tests (\${{ matrix.os }})" \
  && ok "身份不变: job 名未改（必需 context 名依赖）" || no "job 名被改动"
printf '%s' "$CTJOB" | grep -qF "timeout-minutes: \${{ matrix.os == 'windows-latest' && 106 || 14 }}" \
  && ok "身份不变: job timeout-minutes 未改" || no "job timeout-minutes 被改动"
printf '%s' "$CTJOB" | grep -qF 'os: [ubuntu-latest, windows-latest]' \
  && ok "身份不变: strategy.matrix 未改" || no "strategy.matrix 被改动"
printf '%s' "$CTJOB" | grep -q 'steps.docsonly.outputs.docs_only' \
  && ok "判据嵌套: docs-only 内门保留（非替代）" || no "docs-only 内门丢失"
# 分支保护基线（D1039 队长裁决 → **D1112 语义修正，2026-10-02**）
#   原判据: 8 个无 if: 的 job「一律不许出现 job 级 if:」。
#   D1112 实测该判据**抓错了方向**（PR #935 CI 实证 + PR #931 check-runs 实证）:
#     `test`（Vitest (1/2)(2/2)）与 `golden-case`（Golden Case F1 Gate）承载必需 context 且有 `needs:`；
#     上游 quality 红时**无 job 级 if:** ⇒ 被隐式 success() 跳过 ⇒ **必需 context 根本不产生**
#     （PR #931 head 84e9d033 实测: check-run 名回退为未展开的 `Vitest (${{ matrix.shard }})`，
#      `Vitest (1/2)/(2/2)` 从未出现，`mergeStateStatus=BLOCKED`）。
#   ⇒ 正确的判据不是"有没有 if:"，而是"if: **是否锁死在已登记的冻结表达式**上"：
#     ① `needs:` 下游（承载必需 context）**必须** `if: ${{ !cancelled() }}`（= 照跑并如实报红、不消失）
#     ② 其余 job 保持无 if:（不给必需 context 加新风险面）
#     ③ 任何**新** if: 或表达式漂移 ⇒ 必红（本判据仍是判别性棘轮，不是放行开关）
#   冻结表达式登记表（改它 = 改门禁语义 ⇒ 必须过 K3→CTO；见 PR #935 送审项 S-3）
FROZEN_IF_TEST='${{ !cancelled() }}'
DOWNSTREAM_NEEDS_JOBS="test golden-case"   # 有 needs: 且承载必需 context 的 job（新增者必须显式登记）
BASELINE_NO_IF_JOBS="quality architecture test-kit-architecture integration-check audit gate-integrity"
IF_TOUCHED=""
for j in $BASELINE_NO_IF_JOBS; do
  job_block "$j" | grep -qE '^    if:' && IF_TOUCHED="${IF_TOUCHED} ${j}"
done
for j in $DOWNSTREAM_NEEDS_JOBS; do
  if job_block "$j" | grep -qE "^    if: \\\$\\{\\{ !cancelled\\(\\) \\}\\}\$"; then :; else
    IF_TOUCHED="${IF_TOUCHED} ${j}(缺/偏离冻结表达式 ${FROZEN_IF_TEST})"
  fi
done
[ -z "$IF_TOUCHED" ] \
  && ok "分支保护基线: 上游 6 job 无 if: + needs 下游 2 job 锁死 !cancelled()（表达式冻结，漂移即红）" \
  || no "job 级 if: 偏离登记（新增/漂移 = 必需 context 风险面变化）:${IF_TOUCHED}"
if job_block checker-review | grep -qF "if: github.event_name == 'pull_request' || startsWith(github.ref, 'refs/heads/feat/')"; then
  ok "分支保护基线: checker-review 的 if: 与基线逐字一致（未加 schedule 门控）"
else
  no "checker-review 的 if: 偏离基线（基线 = github.event_name == 'pull_request' || startsWith(…feat/)）"
fi
# 兜底棘轮（D1112）: 穷举 ci.yml 里**所有**有 `needs:` 的 job，必须逐个登记。
#   防"新增一个 needs 下游 job 却忘了加 !cancelled()"⇒ 该 job 的必需 context 又会在上游红时消失。
#   登记面 = DOWNSTREAM_NEEDS_JOBS（上面做 if: 冻结核）+ 已知无需 job 级 if 的例外白名单。
NEEDS_UNREG=""
for j in $(grep -nE '^  [a-z0-9_-]+:$' "$CI" | sed 's/^[0-9]*:  //; s/:$//'); do
  if job_block "$j" | grep -qE "^    needs:"; then
    case " $DOWNSTREAM_NEEDS_JOBS checker-review " in
      *" $j "*) : ;;
      *) NEEDS_UNREG="${NEEDS_UNREG} ${j}" ;;
    esac
  fi
done
[ -z "$NEEDS_UNREG" ] \
  && ok "兜底棘轮: 全部有 needs: 的 job 均已登记（新增未登记者 ⇒ 必红）" \
  || no "有 needs: 但未登记的 job（上游红时其必需 context 可能消失）:${NEEDS_UNREG}"
printf '%s' "$CTJOB" | grep -q "github.event_name == 'workflow_dispatch'" \
  && ok "安全网②: workflow_dispatch ⇒ 重活无条件跑（人工触发不落 run=false）" \
  || no "缺 dispatch 无条件分支（手动触发可能被静默跳过）"
grep -qE '^  workflow_dispatch:' "$CI" && ok "安全网②: workflow_dispatch 已声明" || no "缺 workflow_dispatch"
grep -qE '^      force_control_tower_tests:' "$CI" \
  && ok "安全网②: 布尔输入 force_control_tower_tests 已声明" || no "缺 force 输入"
if grep -qE '^  schedule:' "$CI" && grep -qE '^    - cron: "0 20 \* \* 0"' "$CI"; then
  ok "安全网③: schedule 每周触发已声明（cron 0 20 * * 0）"
else
  no "缺 schedule/cron 声明"
fi

# ── 11. 可审计: 输出逐条点名「规则 ← 文件」+ 未命中明细 ──
OUT="$TMPD/human.out"
bash "$SCRIPT" --files "scripts/ci/y.sh src/x.ts" >"$OUT" 2>&1
if grep -q 'scripts-tree' "$OUT" && grep -q 'scripts/ci/y.sh' "$OUT"; then
  ok "可审计: 输出逐条点名「规则 ← 文件」"
else
  no "输出未逐条点名命中规则"
fi
grep -q 'src/x.ts' "$OUT" && ok "可审计: 输出列出未命中明细" || no "未列出未命中明细"

# ── 12. 本测试真被 CI 执行（清单项，非注释提及）──
if grep -qE 'tests/control-tower/ci-signal-classify\.test\.sh(; do)?[[:space:]]*$' "$CI"; then
  ok "canary 清单含本测试（不是只写在注释里）"
else
  no "canary 清单未含本测试 ⇒ 本测试在 CI 无人执行"
fi

# ── 13. 判别性: GH Actions errexit 语义（`shell: bash` 实为 bash --noprofile --norc -eo pipefail）──
# 缺陷史（D1039 修）: 裸 `cmd; RC=$?` 在 -e 下 RC 赋值是死代码 ⇒ 分类器降级(2) 直接判 step 红
#   ⇒ job 红 ⇒ 必需 context 红 ⇒ PR blocked（正是本卡要消灭的失效模式）；且后续重活 step 因
#   隐式 success() 被 skip ⇒ PR 红 + 重活没跑，双重失效。
# 判据建在「-e 下也能走完」上（不是断言 RC 的值）——否则夹具在裸 bash 下假绿（这正是漏检原因）。
STEPDIR="$TMPD/stepbody"
mkdir -p "$STEPDIR/scripts/control-tower"
awk -v want="Classify control-tower CI signal (D1039)" '
  !found { if ($0 == "      - name: " want) { found=1 } ; next }
  found && !inrun { if ($0 ~ /^        run: \|/) { inrun=1 } ; next }
  inrun && $0 ~ /^[ ]{0,9}[^ ]/ { exit }
  inrun { sub(/^ {10}/, ""); print }
' "$CI" > "$STEPDIR/step.sh"
if grep -qF 'ci-signal-classify.sh' "$STEPDIR/step.sh"; then
  ok "GH 语义夹具前置: 从 ci.yml 抽到真 step 正文（非副本，防漂移）"
else
  no "GH 语义夹具退化: 未抽到 step 正文（step 名或缩进变了）"
fi
# 顺序: 判据 step 必须在重活 step 之前（否则 steps.ctsignal.outputs.run 为空 ⇒ 恒不跑）
CLS_LN="$(grep -n 'id: ctsignal' "$CI" | head -n1 | cut -d: -f1)"
HEAVY_LN="$(grep -n 'name: Run hermetic control-tower gate tests' "$CI" | head -n1 | cut -d: -f1)"
if [ -n "$CLS_LN" ] && [ -n "$HEAVY_LN" ] && [ "$CLS_LN" -lt "$HEAVY_LN" ]; then
  ok "接线顺序: ctsignal step (L${CLS_LN}) 在重活 step (L${HEAVY_LN}) 之前"
else
  no "接线顺序异常: ctsignal=L${CLS_LN} 重活=L${HEAVY_LN}（判据须在前）"
fi
gh_step() {   # $1 = 分类器桩退出码 → 打印 "rc" 后接输出
  local rc out
  printf '#!/bin/bash\nexit %s\n' "$1" > "$STEPDIR/scripts/control-tower/ci-signal-classify.sh"
  out="$( cd "$STEPDIR" && bash --noprofile --norc -eo pipefail step.sh 2>&1 )"
  rc=$?
  printf '%s\n%s\n' "$rc" "$out"
}
R="$(gh_step 2)"; rc2="$(printf '%s\n' "$R" | sed -n '1p')"; o2="$(printf '%s\n' "$R" | sed -n '2,$p')"
if [ "$rc2" = "0" ]; then
  ok "GH 语义: 分类器降级(2) ⇒ STEP EXIT=0（降级不误判 PR 红）"
else
  no "GH 语义: 降级(2) 下 STEP EXIT=${rc2}（应 0 —— errexit 死代码缺陷复现）"
fi
printf '%s' "$o2" | grep -q '::warning' \
  && ok "GH 语义: 降级仍显式可见（::warning 留痕，铁律 11）" || no "GH 语义: 降级无 ::warning 留痕"
R="$(gh_step 1)"; rc1="$(printf '%s\n' "$R" | sed -n '1p')"
[ "$rc1" = "1" ] && ok "GH 语义: 分类器自身失败(1) ⇒ STEP EXIT=1（fail-closed 仍红）" \
  || no "GH 语义: exit 1 下 STEP EXIT=${rc1}（应 1 —— 不得静默放行）"
R="$(gh_step 0)"; rc0="$(printf '%s\n' "$R" | sed -n '1p')"
[ "$rc0" = "0" ] && ok "GH 语义: 正常(0) ⇒ STEP EXIT=0" || no "GH 语义: exit 0 下 STEP EXIT=$rc0"
# 红向证明: 还原成裸 cmd; RC=$? ⇒ 必须复现缺陷（证明本夹具真的能抓这类回归）
if grep -qF '|| RC=$?' "$STEPDIR/step.sh"; then
  sed 's/ || RC=[$]?//' "$STEPDIR/step.sh" > "$STEPDIR/step-bare.sh"
  printf '#!/bin/bash\nexit 2\n' > "$STEPDIR/scripts/control-tower/ci-signal-classify.sh"
  ( cd "$STEPDIR" && bash --noprofile --norc -eo pipefail step-bare.sh ) >/dev/null 2>&1; rcm=$?
  [ "$rcm" = "2" ] && ok "红向证明: 去掉「|| RC=赋值」⇒ STEP EXIT=2（夹具判别性成立）" \
    || no "红向证明失败: 裸写法下 STEP EXIT=${rcm}（应 2）—— 夹具不判别"
else
  skip "fixture" "step 正文未使用「|| RC=赋值」写法（或已改用其他 errexit 安全写法）⇒ 红向证明不适用"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败, $SKIP 显式跳过"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1

# ── D1039 P1(K3) presets-哨兵：删 RULES 条目即红 + 行为必须命中 ──────────
grep -q '"presets|^docs/synova/presets/"' scripts/control-tower/ci-signal-classify.sh \
  || { echo "FAIL: RULES 缺 presets 条目（删规则即红）"; exit 1; }
_po="$( ( unset SYNO_CT_CLASSIFY_FILES; \
  bash scripts/control-tower/ci-signal-classify.sh --files docs/synova/presets/_probe.yml ) 2>&1 )"
case "$_po" in *run=true*) ;; *) echo "FAIL: presets 未命中 run=true（输出: $_po）"; exit 1;; esac
echo "PASS: presets 哨兵（条目在 + run=true 行为命中）"
