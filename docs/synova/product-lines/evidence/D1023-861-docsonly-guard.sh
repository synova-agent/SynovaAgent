#!/usr/bin/env bash
# D1023 / PR#861 P1 — docs-only 早退白名单判别性夹具（"删掉即报红"）
#
# 背景（K3 审 #861 CONDITIONAL PASS, P1×2）:
#   #861 把 `.gitattributes` / `.gitmodules` 加进了 docs-only 早退白名单，两条都是
#   "把该走全量的文件放进了早退"：
#     ① .gitattributes 是 CI 运行时语义载体（*.sh text eol=lf = D520 Windows CRLF 事故修复件；
#        merge=union；scripts/audit/** -text = K3 红线 D533）⇒ 改它 = 改 CI 本身 ⇒ 必须走全量。
#     ② .gitmodules 仓库现无此文件；留着 ⇒ "新增 .gitmodules + 文档" = 外部代码零验证入库。
#   D1023/P1 把两条从白名单移除，本夹具就是"移除了才绿、加回去就红"的物理判据。
#
# 契约（铁律 47）
#   输入:
#     env SYNO_CI_YML  被测 ci.yml 路径（默认 .github/workflows/ci.yml）
#     env SYNO_CI      "1" = HARD（任一 FAIL ⇒ exit 1）；其它/未设 = SOFT（照常打印，exit 0）
#                      —— 对齐 D515/D516「本地软提示 + CI 权威」
#   处理:
#     ① 单一真值源: 白名单正则**从被测 ci.yml 里 grep 提取**，绝不抄死在夹具里
#        （抄死 = 夹具与真值漂移，夹具就失去判别力）。
#     ② 结构断言 5 条 + 用例断言 6 条，逐条打印 PASS/FAIL。
#        反例警戒: 断言 ④/⑤ 用「判定行为」而非「grep 正则字面量」——禁 grep 型静态判据当验收
#        （坑清单：grep 型静态判据实测 3/5=60%）。
#     ③ 用例判定与 ci.yml 同构: `printf '%s\n' "$FILES" | grep -qvE "$RE"`
#        返回 0 ⇒ docs_only=false（走全量）；否则 docs_only=true（早退）。
#   输出:
#     逐条 `PASS/FAIL <name> expect=<v> got=<v>`；末尾 `RESULT: <n> PASS / <m> FAIL`
#     + `SOFT/HARD mode: <SOFT|HARD>`。
#   降级:
#     ① 被测 ci.yml 不存在 ⇒ 显式 `ERROR:` + exit 2（调用错误，不是用例 FAIL，两种模式都退 2，
#        绝不静默当作全 PASS）。
#     ② SOFT 模式下有 FAIL ⇒ 打印全部 FAIL 明细后 exit 0（不吞：FAIL 行照打）。
#     ③ 提取到的正则条数 ≠ 10 时，结构断言 FAIL 且用例仍继续跑（把结构缺陷暴露成可见红，不早退）。
#
# 兼容性: macOS bash 3.2（GNU bash 3.2.57 实测）——禁 mapfile / 禁关联数组；
#         只用 while read / 变量 / 函数。故意**不用 set -e**（要跑完全部用例再汇总）。
set -uo pipefail

CI_YML="${SYNO_CI_YML:-.github/workflows/ci.yml}"

if [ ! -f "$CI_YML" ]; then
  echo "ERROR: 被测 ci.yml 不存在: $CI_YML" >&2
  exit 2
fi

if [ "${SYNO_CI:-}" = "1" ]; then
  MODE_LABEL="HARD"
else
  MODE_LABEL="SOFT"
fi

PASS_N=0
FAIL_N=0
STRUCT_PASS=0
STRUCT_FAIL=0
CASE_PASS=0
CASE_FAIL=0

# report <kind> <name> <expect> <got>
#   kind = struct | case（分类只为末尾分组汇总，判定同权）
report() {
  _kind="$1"
  _name="$2"
  _expect="$3"
  _got="$4"
  if [ "$_expect" = "$_got" ]; then
    echo "PASS $_name expect=$_expect got=$_got"
    PASS_N=$((PASS_N + 1))
    if [ "$_kind" = "struct" ]; then
      STRUCT_PASS=$((STRUCT_PASS + 1))
    else
      CASE_PASS=$((CASE_PASS + 1))
    fi
  else
    echo "FAIL $_name expect=$_expect got=$_got"
    FAIL_N=$((FAIL_N + 1))
    if [ "$_kind" = "struct" ]; then
      STRUCT_FAIL=$((STRUCT_FAIL + 1))
    else
      CASE_FAIL=$((CASE_FAIL + 1))
    fi
  fi
}

echo "=== D1023/P1 docs-only whitelist guard ==="
echo "ci.yml       : $CI_YML"
echo "SOFT/HARD mode: $MODE_LABEL"
echo

# ── 单一真值源: 从被测 ci.yml 提取白名单正则（不抄死） ──────────────────────
RE_ALL=$(grep -oE "grep -qvE '[^']+'" "$CI_YML" | sed -E "s/^grep -qvE '//; s/'\$//")
RE_COUNT=$(printf '%s\n' "$RE_ALL" | grep -c . || true)
RE_UNIQ_COUNT=$(printf '%s\n' "$RE_ALL" | sort -u | grep -c . || true)
RE=$(printf '%s\n' "$RE_ALL" | sed -n '1p')

echo "--- 提取到的正则（按出现顺序，去空行） ---"
printf '%s\n' "$RE_ALL" | grep . | nl -ba || true
echo "--- 结构断言 ---"

# ① 提取条数 = 10（ci.yml 中恰好 10 个 Detect docs-only 步骤）
if [ "$RE_COUNT" = "10" ]; then got="10"; else got="$RE_COUNT"; fi
report struct "struct-count-10" "10" "$got"

# ② 唯一模式数 = 1（10 处模式必须完全一致，防单处漂移）
if [ "$RE_UNIQ_COUNT" = "1" ]; then got="1"; else got="$RE_UNIQ_COUNT"; fi
report struct "struct-unique-1" "1" "$got"

# ③ 全量提取结果不含 gitattributes / gitmodules（D1023/P1 的核心断言）
if printf '%s\n' "$RE_ALL" | grep -qE 'gitattributes|gitmodules'; then got="present"; else got="absent"; fi
report struct "struct-no-gitattributes-gitmodules" "absent" "$got"

# ④ 行为断言: 根级 .gitignore 仍被白名单覆盖（不许把 #861 原本要修的那条改坏）
#    用「判定行为」而非「grep 正则字面量」——本文件里不出现白名单正则的字面量（单一真值源）。
if printf '.gitignore\n' | grep -qE "$RE"; then got="t"; else got="f"; fi
report struct "struct-gitignore-root-covered" "t" "$got"

# ⑤ 行为断言: 锚定仍在 —— `docs/.gitignore`（非根）必须**不**被覆盖。
#    若后人「统一锚点」把 gitignore 那条的 ^…$ 去掉，本例即报红（P2 锚定分层的判别性证据）。
if printf 'docs/.gitignore\n' | grep -qE "$RE"; then got="t"; else got="f"; fi
report struct "struct-gitignore-anchor-root-only" "f" "$got"

# ⑥ 行为断言（D1111/A5 + 独立自验 E4 整改）: **docs-only detect 的 fail-safe 计数 = 10**。
#    为什么是这一条而不是「存在任意 ^ 锚」: 独立自验实测（第 2 批 §不一致 1）证明
#    「存在 ^ 锚」型判据对旧正则**必然 PASS**（旧式本来就有 `^\.gitignore$`/`^LICENSE$`/`^\.gitkeep$`）
#    ⇒ 判别力 0，是纸老虎，且其注释理由与事实相反。本夹具头注释自己就禁「grep 型静态判据当验收」。
#    本条的判别力来源 = 现成先红夹具: 删掉 ci.yml block@51 的 fail-safe（其余不动）时，
#    本计数 10→9 ⇒ 必红（该变体夹具见验证方 `fixtures/ci-no-failsafe-51.yml`）。
#    即：它守的是「10 处 detect 必须同样 fail-closed」这条**有后果**的不变量
#    （唯一一处缺 fail-safe 时，origin/main 不可解析会让那处反方向早退）。
#    ⚠️ D1147（单套门禁 · 批2，2026-10-05）计数口径收紧（**变强，不是放宽**）:
#      ci.yml 新增了 `windows-leg-trigger` job，其 detect step 也含同款
#      `git rev-parse --verify -q origin/main` fail-safe（**路径触发**判据，非 docs-only detect）
#      ⇒ 全文件裸计数会变成 11，从而把"本断言的语义"稀释成"数任意用途的 lookup"。
#      故本计数**限定在 10 个 `Detect docs-only change (D515)` step 的 step 体内**（awk 按 step 边界定界）:
#      断言仍是 10（id 不变，D1112/K3 送审件引用继续有效），且不再受无关新增影响。
FAILSAFE_N=$(awk '
  /^      - name: Detect docs-only change \(D515\)$/ { inside=1; next }
  inside && /^      - name: / { inside=0 }
  inside && /^  [A-Za-z0-9_-]+:$/ { inside=0 }
  inside && /git rev-parse --verify -q origin\/main/ { n++ }
  END { printf "%d", n+0 }
' "$CI_YML")
FAILSAFE_N=$(printf '%s' "$FAILSAFE_N" | tr -d '[:space:]')
if [ "$FAILSAFE_N" = "10" ]; then got="10"; else got="$FAILSAFE_N"; fi
report struct "struct-failsafe-count-10" "10" "$got"

echo "--- 用例断言（判定与 ci.yml 同构: grep -qvE 返 0 ⇒ docs_only=false）---"

# run_case <name> <expect t/f> <files 多行字符串>
#   t = docs_only=true（早退/瘦身）；f = docs_only=false（走全量）
run_case() {
  _name="$1"
  _expect="$2"
  _files="$3"
  if printf '%s\n' "$_files" | grep -qvE "$RE"; then
    _got="f"
  else
    _got="t"
  fi
  report case "$_name" "$_expect" "$_got"
}

# a) .gitattributes 是 CI 运行时语义载体 ⇒ 必须走全量（D1023/P1 修复点）
run_case "a-gitattributes-goes-full" "f" ".gitattributes
docs/x.md"

# b) .gitmodules 仓库不存在，留着 = 新增子模块零验证入库 ⇒ 必须走全量（D1023/P1 修复点）
run_case "b-gitmodules-goes-full" "f" ".gitmodules
docs/x.md"

# c) .gitignore 仍在白名单内 ⇒ 仍早退（#861 原本要修的那条不许改坏）
run_case "c-gitignore-still-docsonly" "t" ".gitignore
docs/x.md"

# d) 纯文档组合（docs 任意深度 + task-state 根级）⇒ 仍早退
#    ⚠️ D1111/A5 语义变更（有意，非放宽）: 旧例含 `.claude/task-briefs/x.md` 并期望 t；
#    因 `.claude/**` 移除早退面（改 .claude/settings.json/hooks.json = 改门禁本身 ⇒ 必须全量），
#    该路径现判 f。故本用例只留白名单内路径（同时断言新边界，见案例 n）。
run_case "d-pure-docs-still-docsonly" "t" "docs/x.md
task-state/D1.json
.dsh/skills/pr-review/SKILL.md"

# n) D1111/A5 边界: `.claude/task-briefs/*.md` 现在走**全量**（旧: 早退）
#    理由: 同一目录下 settings.json/hooks.json 是门禁配置；按目录整体放行 = 让配置变更混在
#    brief 变更里零验证入库。此项与案例 d 成对，显式锁定新边界（不是"少写一行"）。
run_case "n-claude-task-briefs-goes-full" "f" ".claude/task-briefs/x.md"

# e) 源码文件 ⇒ 走全量
run_case "e-source-goes-full" "f" "src/a.ts"

# f) CI 自身改动 ⇒ 走全量
run_case "f-ci-yml-goes-full" "f" ".github/workflows/ci.yml"

# ── D1111/A5 扩充用例（旧正则与新正则判定**相反** ⇒ 真判别性；旧六例无判别）─────────
#   旧行为 = 无锚点 ⇒ 以下 5 例在旧正则下判 t（早退），实为「非文档变更跳过全部检查」。

# g) 根级 package.json ⇒ 走全量（旧: 早退）
run_case "g-root-package-json-goes-full" "f" "package.json"

# h) 根级 tsconfig.json ⇒ 走全量（旧: 早退）
run_case "h-root-tsconfig-goes-full" "f" "tsconfig.json"

# i) 任意深度 .json（src/）⇒ 走全量（旧: 早退）
run_case "i-src-json-goes-full" "f" "src/probe.json"

# j) 同名深层目录（src/task-state/）⇒ 走全量（旧: 早退）
run_case "j-nested-task-state-dir-goes-full" "f" "src/task-state/probe.sh"

# k) expert 运行时资产 .md ⇒ 走全量（旧: 早退）
run_case "k-expert-md-goes-full" "f" "expert/host/SKILL.md"

# l) 本地控制塔配置 .claude/settings.json ⇒ 走全量（旧: 早退；改它=改门禁本身）
run_case "l-claude-settings-goes-full" "f" ".claude/settings.json"

# m) docs 下 .html ⇒ 早退（D1111/D2 新纳入：.html 进文档面；旧正则判 f 属**漏放行**方向）
run_case "m-docs-html-still-docsonly" "t" "docs/report.html"

echo
echo "RESULT: $PASS_N PASS / $FAIL_N FAIL"
echo "分组: struct $STRUCT_PASS PASS / $STRUCT_FAIL FAIL ; case $CASE_PASS PASS / $CASE_FAIL FAIL"
echo "SOFT/HARD mode: $MODE_LABEL"

if [ "$FAIL_N" -gt 0 ] && [ "$MODE_LABEL" = "HARD" ]; then
  exit 1
fi
exit 0
