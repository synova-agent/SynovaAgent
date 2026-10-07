#!/usr/bin/env bash
# D1023 / PR#861 P1 — docs-only 早退白名单判别性夹具（"删掉即报红"）
# D-F/①（卡 #1227，2026-10-07）改造: 判据文本**移出 ci.yml** ⇒ 本夹具改「从单源文件派生」，
#   并新增「内联副本 = 0」「消费点 = 9」两条结构断言（原「副本计数 = 9」断言随之退役）。
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
#     env SYNO_CI_YML          被测 ci.yml 路径（默认 .github/workflows/ci.yml）
#     env SYNO_DOCSONLY_RE_FILE 单源判据文件路径（默认 .github/ci-criteria.txt）
#     env SYNO_CI              "1" = HARD（任一 FAIL ⇒ exit 1）；其它/未设 = SOFT（照常打印，exit 0）
#                              —— 对齐 D515/D516「本地软提示 + CI 权威」
#   处理:
#     ① 单一真值源: 白名单正则**从单源文件读取**（`DOCSONLY_WHITELIST_RE=` 键），绝不抄死在夹具里
#        （抄死 = 夹具与真值漂移，夹具就失去判别力）。同时断言 ci.yml **内联副本 = 0**
#        且消费点 = 9 —— 防「单源在，但同时留了内联副本」这种双真相源形态。
#     ② 结构断言 9 条 + 用例断言 14 条，逐条打印 PASS/FAIL。
#        反例警戒: 断言用「判定行为」而非「grep 正则字面量」——禁 grep 型静态判据当验收
#        （坑清单：grep 型静态判据实测 3/5=60%）。含一条**变异体自证**（旧式无锚点正则下
#        判别性探针必须翻面），使「用例本身有判别力」不依赖外部夹具。
#     ③ 用例判定与 ci.yml 同构: `printf '%s\n' "$FILES" | grep -qvE "$RE"`
#        返回 0 ⇒ docs_only=false（走全量）；否则 docs_only=true（早退）。
#     🔴 但"grep 的语义" ≠ "detect step 的控制流"：D-F/①-fix（独立复核 R1）实测
#        `grep -qvE ''`（空正则）返 **1** ⇒ 依赖隐式返回会在单源不可读时**早退**（fail-OPEN）。
#        故 §控制流 段把 ci.yml 里**真 step 正文**抽出来在合成 git 仓里真执行，断言 4 种场景。
#   输出:
#     逐条 `PASS/FAIL <name> expect=<v> got=<v>`；末尾 `RESULT: <n> PASS / <m> FAIL`
#     + `SOFT/HARD mode: <SOFT|HARD>`。
#   降级:
#     ① 被测 ci.yml 不存在、或单源判据文件不存在 ⇒ 显式 `ERROR:` + exit 2
#        （调用错误，不是用例 FAIL，两种模式都退 2，绝不静默当作全 PASS）。
#     ② SOFT 模式下有 FAIL ⇒ 打印全部 FAIL 明细后 exit 0（不吞：FAIL 行照打）。
#     ③ 单源键缺失/重复（≠1）⇒ 结构断言 FAIL 且用例仍继续跑（把结构缺陷暴露成可见红，不早退）。
#
# 兼容性: macOS bash 3.2（GNU bash 3.2.57 实测）——禁 mapfile / 禁关联数组；
#         只用 while read / 变量 / 函数。故意**不用 set -e**（要跑完全部用例再汇总）。
set -uo pipefail

CI_YML="${SYNO_CI_YML:-.github/workflows/ci.yml}"
RE_FILE="${SYNO_DOCSONLY_RE_FILE:-.github/ci-criteria.txt}"

if [ ! -f "$CI_YML" ]; then
  echo "ERROR: 被测 ci.yml 不存在: $CI_YML" >&2
  exit 2
fi
if [ ! -f "$RE_FILE" ]; then
  echo "ERROR: 单源判据文件不存在: ${RE_FILE}（D-F/① 起白名单正则只此一份；缺失即结构缺陷）" >&2
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
echo "单源判据文件 : $RE_FILE"
echo "SOFT/HARD mode: $MODE_LABEL"
echo

# ── 单一真值源: 从单源文件读取白名单正则（不抄死），并断言 ci.yml 内零内联副本 ─────
RE_LINES=$(grep -c '^DOCSONLY_WHITELIST_RE=' "$RE_FILE" 2>/dev/null || true)
RE=$(grep -m1 '^DOCSONLY_WHITELIST_RE=' "$RE_FILE" 2>/dev/null | sed 's/^DOCSONLY_WHITELIST_RE=//' | tr -d '\r')

# 内联副本两条独立探针（都必须是 0）:
#   ① 正则文本片段（-F 固定串；**不要**用 BRE 裸写该串——BRE 下 `\.`/`+` 语义不同，
#      实测裸 grep 对本串恒 0 命中 = 纸老虎，这正是本改造顺带修正的验收命令缺陷）
#   ② 单引号内联正则的消费形态 `grep -qvE '<字面量>'`（单源消费形态是 `"$DS_RE"`）
INLINE_LITERAL=$(grep -cF 'docs/.+\.(md|json|html)' "$CI_YML" 2>/dev/null || true)
#   ② 的探针只计**非注释行**——注释里引用消费形态（``grep -qvE ''``）不算内联判据
INLINE_QUOTED=$(grep -n "grep -qvE '" "$CI_YML" 2>/dev/null | grep -vc ':[[:space:]]*#' || true)
CONSUME_N=$(grep -cF 'DS_RE="$(grep -m1' "$CI_YML" 2>/dev/null || true)
DETECT_N=$(grep -c '^      - name: Detect docs-only change (D515)$' "$CI_YML" 2>/dev/null || true)

echo "--- 单源正则（${RE_FILE}） ---"
printf '%s\n' "$RE"
echo "--- 结构断言 ---"

# ① 单源键恰 1 行（多行/缺键 = 双真相源或空源）
if [ "$RE_LINES" = "1" ]; then got="1"; else got="$RE_LINES"; fi
report struct "struct-single-source-key-lines-1" "1" "$got"

# ② ci.yml 内联正则文本副本 = 0（D-F/① 的核心断言：判据文本只许在单源文件里）
if [ "$INLINE_LITERAL" = "0" ]; then got="0"; else got="$INLINE_LITERAL"; fi
report struct "struct-inline-regex-copies-0" "0" "$got"

# ③ ci.yml 内联单引号正则消费形态 = 0（防"单源 + 内联"双真相源并存）
if [ "$INLINE_QUOTED" = "0" ]; then got="0"; else got="$INLINE_QUOTED"; fi
report struct "struct-inline-quoted-regex-0" "0" "$got"

# ④ 消费点 = 9（每个 detect step 必须真读单源；改漏一处 = 那一处回退成字面量/空白判据）
EXPECT_DOCS_ONLY_COPIES=9
if [ "$CONSUME_N" = "$EXPECT_DOCS_ONLY_COPIES" ]; then got="$EXPECT_DOCS_ONLY_COPIES"; else got="$CONSUME_N"; fi
report struct "struct-consumption-points-${EXPECT_DOCS_ONLY_COPIES}" "$EXPECT_DOCS_ONLY_COPIES" "$got"

# ⑤ detect step 数 = 9（与消费点、fail-safe 计数同轴；载体增删必须同批改本夹具）
if [ "$DETECT_N" = "$EXPECT_DOCS_ONLY_COPIES" ]; then got="$EXPECT_DOCS_ONLY_COPIES"; else got="$DETECT_N"; fi
report struct "struct-detect-steps-${EXPECT_DOCS_ONLY_COPIES}" "$EXPECT_DOCS_ONLY_COPIES" "$got"

# ⑥ 单源正则不含 gitattributes / gitmodules（D1023/P1 的核心断言）
if printf '%s\n' "$RE" | grep -qE 'gitattributes|gitmodules'; then got="present"; else got="absent"; fi
report struct "struct-no-gitattributes-gitmodules" "absent" "$got"

# ⑦ 行为断言: 根级 .gitignore 仍被白名单覆盖（不许把 #861 原本要修的那条改坏）
#    用「判定行为」而非「grep 正则字面量」——本文件里不出现白名单正则的字面量（单一真值源）。
if printf '.gitignore\n' | grep -qE "$RE"; then got="t"; else got="f"; fi
report struct "struct-gitignore-root-covered" "t" "$got"

# ⑧ 行为断言: 锚定仍在 —— `docs/.gitignore`（非根）必须**不**被覆盖。
#    若后人「统一锚点」把 gitignore 那条的 ^…$ 去掉，本例即报红（P2 锚定分层的判别性证据）。
if printf 'docs/.gitignore\n' | grep -qE "$RE"; then got="t"; else got="f"; fi
report struct "struct-gitignore-anchor-root-only" "f" "$got"

# ⑨ 判别性自证（变异体，D-F/① 新增）: 把白名单换回 D1111 之前的**无锚点宽松式**，
#    下列 6 个探针必须全部命中 ⇒ 证明「用例 g/h/i/j/k/l 的 f 期望」是靠新式锚定挣来的，
#    不是恒 f 的纸老虎。断言 = 宽松式命中数恰 6（若新式也命中其一，下列用例会另有 FAIL 暴露）。
#    宽松式 = D1111 之前的两条无锚点分支: `\.(md|json)$` 与 `(task-state|memory|decisions)/`
LEGACY_RE='\.(md|json)$|task-state/'
MUT_HITS=0
for _probe in package.json tsconfig.json src/probe.json src/task-state/probe.sh expert/host/SKILL.md .claude/settings.json; do
  if printf '%s\n' "$_probe" | grep -qE "$LEGACY_RE"; then MUT_HITS=$((MUT_HITS + 1)); fi
done
if [ "$MUT_HITS" = "6" ]; then got="6"; else got="$MUT_HITS"; fi
report struct "struct-mutant-legacy-regex-flips-6" "6" "$got"

# ⑩ 行为断言（D1111/A5 + 独立自验 E4 整改）: **docs-only detect 的 fail-safe 计数 = 9**。
#    为什么是这一条而不是「存在任意 ^ 锚」: 独立自验实测（第 2 批 §不一致 1）证明
#    「存在 ^ 锚」型判据对旧正则**必然 PASS**（旧式本来就有 `^\.gitignore$`/`^LICENSE$`/`^\.gitkeep$`）
#    ⇒ 判别力 0，是纸老虎，且其注释理由与事实相反。本夹具头注释自己就禁「grep 型静态判据当验收」。
#    本条的判别力来源 = 现成先红夹具: 删掉某处 detect 的 fail-safe（其余不动）时，
#    本计数 9→8 ⇒ 必红。
#    即：它守的是「9 处 detect 必须同样 fail-closed」这条**有后果**的不变量
#    （任一处缺 fail-safe 时，origin/main 不可解析会让那处反方向早退）。
#    ⚠️ D1147 计数口径收紧（**变强，不是放宽**）: `windows-leg-trigger` job 的 detect step 含同款
#      `git rev-parse --verify -q origin/main` fail-safe（**路径触发**判据，非 docs-only detect）
#      ⇒ 故本计数**限定在 9 个 `Detect docs-only change (D515)` step 的 step 体内**（awk 按 step 边界定界）。
#    ⚠️ D1195（2026-10-07）: audit job 退役 ⇒ 载体数 10 → 9。
FAILSAFE_N=$(awk '
  /^      - name: Detect docs-only change \(D515\)$/ { inside=1; next }
  inside && /^      - name: / { inside=0 }
  inside && /^  [A-Za-z0-9_-]+:$/ { inside=0 }
  inside && /git rev-parse --verify -q origin\/main/ { n++ }
  END { printf "%d", n+0 }
' "$CI_YML")
FAILSAFE_N=$(printf '%s' "$FAILSAFE_N" | tr -d '[:space:]')
if [ "$FAILSAFE_N" = "$EXPECT_DOCS_ONLY_COPIES" ]; then got="$EXPECT_DOCS_ONLY_COPIES"; else got="$FAILSAFE_N"; fi
report struct "struct-failsafe-count-${EXPECT_DOCS_ONLY_COPIES}" "$EXPECT_DOCS_ONLY_COPIES" "$got"

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

# o) D-F/① 新增边界: 单源判据文件自身 ⇒ 必须走全量（改判据 = 改 CI 判据本身）
run_case "o-criteria-file-goes-full" "f" ".github/ci-criteria.txt"


echo "--- detect step 控制流判别（抽 ci.yml 真 step 正文，在合成 git 仓里真执行）---"
# 契约: DS_RE 空/不可读 ⇒ **显式** docs_only=false（全量）；origin/main 不可解析 ⇒ 显式 false；
#       仅有白名单内变更 ⇒ true；含非白名单变更 ⇒ false。任一方向反了即 FAIL（改坏即红）。
CTRL_TMP="$(mktemp -d)"
extract_detect_step() {   # 打印 ci.yml 中第一个 Detect docs-only step 的 run 正文（去 10 空格缩进）
  awk '
    !found { if ($0 == "      - name: Detect docs-only change (D515)") { found=1 } ; next }
    found && !inrun { if ($0 ~ /^        run: \|/) { inrun=1 } ; next }
    inrun && $0 ~ /^[ ]{0,9}[^ ]/ { exit }
    inrun { sub(/^ {10}/, ""); print }
  ' "$CI_YML"
}
extract_detect_step > "$CTRL_TMP/step.sh"
if [ -s "$CTRL_TMP/step.sh" ] && grep -q 'DS_RE=' "$CTRL_TMP/step.sh"; then
  report struct "struct-ctrl-step-extracted" "1" "1"
else
  report struct "struct-ctrl-step-extracted" "1" "0"
fi
CTRL_REPO="$CTRL_TMP/repo"
mkdir -p "$CTRL_REPO/docs" "$CTRL_REPO/.github"
( cd "$CTRL_REPO" && git init -q && git config user.email t@example.com && git config user.name t \
    && echo base > docs/base.md && git add -A && git commit -qm base \
    && git update-ref refs/remotes/origin/main HEAD \
    && git checkout -qb work && echo doc > docs/new.md && git add -A && git commit -qm doc ) >/dev/null 2>&1
run_ctrl() {   # $1 = 场景名 ; 前置由调用方摆好 → 打印 docs_only 值
  local out="$CTRL_TMP/out-$1.txt"
  : > "$out"
  ( cd "$CTRL_REPO" && GITHUB_OUTPUT="$out" bash --noprofile --norc -eo pipefail "$CTRL_TMP/step.sh" ) >/dev/null 2>&1
  sed -n 's/^docs_only=//p' "$out" | tail -1
}
# 场景 ①（正常）: 仅有白名单内变更（docs/new.md）⇒ true（早退仍可用，未过度收紧）
printf 'DOCSONLY_WHITELIST_RE=%s\n' "$RE" > "$CTRL_REPO/.github/ci-criteria.txt"
got="$(run_ctrl a)"; if [ "$got" = "true" ]; then got="t"; else got="f"; fi
report struct "ctrl-docsonly-change-early-exit" "t" "$got"
# 场景 ②（正常）: 含非白名单变更（.github/ci-criteria.txt 自身）⇒ false（走全量）
( cd "$CTRL_REPO" && git update-ref -d refs/remotes/origin/main && git update-ref refs/remotes/origin/main HEAD ) >/dev/null 2>&1
# 重新造「origin/main..HEAD 含非白名单文件」：在 HEAD 提交里加入 ci-criteria.txt（不在白名单内）
( cd "$CTRL_REPO" && echo cfg > .github/other.txt && git add -A && git commit -qm cfg ) >/dev/null 2>&1
got="$(run_ctrl b)"; if [ "$got" = "true" ]; then got="t"; else got="f"; fi
report struct "ctrl-nonwhitelist-goes-full" "f" "$got" 2>/dev/null || true
# 场景 ③（R1 核心）: 单源为空 ⇒ 必须 false（fail-closed；旧形态此处返 true = fail-OPEN）
: > "$CTRL_REPO/.github/ci-criteria.txt"
got="$(run_ctrl c)"; if [ "$got" = "true" ]; then got="t"; else got="f"; fi
report struct "ctrl-empty-single-source-full" "f" "$got"
# 场景 ④: origin/main 不可解析 ⇒ 必须 false
printf 'DOCSONLY_WHITELIST_RE=%s\n' "$RE" > "$CTRL_REPO/.github/ci-criteria.txt"
( cd "$CTRL_REPO" && git update-ref -d refs/remotes/origin/main ) >/dev/null 2>&1
got="$(run_ctrl d)"; if [ "$got" = "true" ]; then got="t"; else got="f"; fi
report struct "ctrl-origin-main-unresolvable-full" "f" "$got"
rm -rf "$CTRL_TMP"

echo
echo "RESULT: $PASS_N PASS / $FAIL_N FAIL"
echo "分组: struct $STRUCT_PASS PASS / $STRUCT_FAIL FAIL ; case $CASE_PASS PASS / $CASE_FAIL FAIL"
echo "SOFT/HARD mode: $MODE_LABEL"

if [ "$FAIL_N" -gt 0 ] && [ "$MODE_LABEL" = "HARD" ]; then
  exit 1
fi
exit 0
