#!/bin/bash
# D313 M5 约定行: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# 注意（踩过的坑，勿"顺手改回来"）: 不要在这里全局改 LC_ALL。
#   macOS 无 C.UTF-8 → BWK awk 遇多字节输入报 "towc: multibyte conversion failure"
#   并**静默产出空结果**（实测: 家族网可判数直接归零）。
#   但全局改成 LC_ALL=C 又会引发第二个坑: bash 3.2 把 `$VAR` 后紧跟的多字节首字节
#   吞进变量名 → "unbound variable" 直接崩测试。
#   故：环境保持约定值，只对本夹具自己的解析/编译检查**定点**加 LC_ALL=C（见 family_scan）。
#   ⚠ 写法硬约束（本文件已按此写，勿改回去）：凡是 `$VAR` **后面紧跟非 ASCII 字符**（如全角
#     `（）、：`）的地方，一律写成 `${VAR}`。否则 bash 3.2 会把多字节首字节并进变量名 →
#     "unbound variable" 直接崩——**且只在某些分支上崩**（2026-09-24 实测：变量名后紧跟全角
#     `）` 的那种写法，恰好只在"平台不判 ^+++ 非法"的 GNU 分支上崩，本地 BSD 分支永远看不到）。
#     自查命令：`LC_ALL=C grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^ -~]' <本文件>` → 必须 0 命中。
# ═══════════════════════════════════════════════════════════════════════════════
# gate-failopen-net.test.sh — D937 门禁 fail-open 假绿判别夹具 + grep -E 家族回归网
#
# 病根（D937，台账第三批）:
#   组 7a（scripts/pre-commit-check.sh）的排除管道含未转义 `^+++`。
#   ⚠ 方言订正（2026-09-24，CI #737 实证）：`^+++` **不是**"两方言都非法"的构造 ——
#     BSD grep 判其非法（exit 2，"repetition-operator operand invalid"）；
#     **GNU grep 接受**（rc 0/1）。故该假绿机制是 **BSD 侧**成立的：grep exit 2 →
#     `grep -Ev` 拿不到模式 → 管道失败 → NEW_DIAG 恒空 → 检查恒判 ✅（自 D467 起长期假绿）。
#   → 本夹具因此**不再拿 `^+++` 当判据**（CTO 新规范第 5 条：夹具禁依赖平台方言，
#     且本件是当日第 3 例方言同族）；改用与方言无关的非法 ERE（见 OVR_UNLAWFUL），
#     `^+++` 降级为**可见观测**（平台探针 + 条件化金丝雀），不参与任何 pass/fail。
#
# 改前基线（本夹具作者亲测，**测量机 = macOS / BSD grep**；T2 即钉死这一条）:
#   SYNO_TEST_ARM=1 SYNO_CI=1 SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
#     SYNO_GATE_HITS_LOG="$(mktemp)" \
#     SYNO_GIT_CACHED_DIFF='+const x = new Diagnostic'+'Module();' \
#     bash scripts/pre-commit-check.sh
#   → exit 0 + "✅ 禁止 Diagnostic(被禁)Module: ..." + "✅ 全部 13 组通过"
#     stderr 仅 "grep: repetition-operator operand invalid"（该 stderr 为 BSD 措辞）
#   = 注入了一个货真价实的违规用法，门禁却全绿。修好后必须是 exit 1 + 点名组 7a。
#
# 覆盖矩阵（铁律 48 三路径 + 判别性）:
#   T1  正常 — 干净 diff（无注入）→ 组 7a ✅ 且 exit 0
#   T2  判别 — 注入被禁模块用法（一票判据）→ CI strict 下 exit 1 且点名组 7a
#   T2b 判别 — 同一命中带 `+++ b/src/x.ts` 头（真实 diff 形态）→ 仍 exit 1
#   T3p 前置 — 本平台必须**实测**拒收 OVR_UNLAWFUL（rc=2）；不成立则 fail loud（不靠方言假设）
#   T3  降级 — 排除模式非法（武装缝覆盖）→ 显式降级、该检查行无 ✅
#   T3f 无缝合 — 不设 SYNO_TEST_ARM 时覆盖变量必须被忽略（生产 fail-closed，两次）
#   T3d 方言观测 — 历史模式 `^+++` 的平台探针（**可见、不参与判据**）
#   T4  边界 — // # * 三注释形态不得误报
#   T5  边界 — 文档（.html）正文不得误伤 + 真实样本 git show 58a19796 零命中
#   家族网 — scripts/**/*.sh 的 grep -E 字面模式逐个行为编译检查（rc==2 = 非法 ERE）
#   金丝雀 — 临时 .sh 塞非法 ERE → 网必须抓到（防空转网）
#   接线 — 本测试在 .github/workflows/ci.yml 密封清单内（M3：机制建成未接线）
#
# 自伤规避（重要，勿"顺手简化"）:
#   组 7a 是**子串门禁**。本文件若在代码行里出现连续的被禁模块名字面量，
#   本文件自身（在 PR diff 里）就会被 7a 判红 —— 测试自己把自己钉死。
#   故：① 代码里一律拆写为 "Diagnostic""Module"（shell 相邻串拼接，运行时值等价）
#       ② 需要在注释里提及原名时，只写在**行首 # 注释**里（7a 的行级注释豁免覆盖
#          ^\+\s*#；若该豁免失效，本文件会在 PR diff 里立刻变红 —— 属预期暴露）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PC="$REPO/scripts/pre-commit-check.sh"
CIY="$REPO/.github/workflows/ci.yml"
PASS=0; FAIL=0
FIRST_FAIL=""
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
# D938-CI-2(可见性): CI 注解 tail -8|cut -c1-450 会截掉末行摘要——FIRST_FAIL 压进**结果行本身**
#   （#762 实证：本测试 ubuntu 红但断言名不可见）。与 alloc/scan-fullwidth 同款，叠加不替换。
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); if [ -z "$FIRST_FAIL" ]; then FIRST_FAIL="$1"; fi; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ESC="$(printf '\033')"

# 被禁模块名（拆写，见头注 ①）——运行时值为原名
BANNED="Diagnostic""Module"
# ═══ 非法 ERE 覆盖模式 —— **必须与方言无关**（CTO 新规范第 5 条；CI #737 返修）═══
# 选「括号不平衡」：BSD grep = "parentheses not balanced"；GNU grep = "Unmatched ( or \("
# → 两方言一律 exit 2。**不假设、要实测**：下方 T3p 会先探本平台是否真的 rc=2，不成立即红。
OVR_UNLAWFUL='a(b'
# 历史模式 `^+++`（D467 病根）**是方言相关的**（BSD 非法 / GNU 接受）→ **不作判据**，
# 仅保留在 T3d 平台探针与条件化金丝雀里做**可见观测**。
OVR_HISTORIC='^+++'

# ── 驱动: 跑生产脚本本体（禁测副本，铁律 0-2）────────────────────────────────
# 用法: run_pc <strict|soft> <注入 diff 文本> [额外 ENV=VAL ...]
#   注入 diff 传单个空格（非空）→ 走注入缝且等价"干净树"，不受本机暂存区状态影响。
#   其余注入缝变量同样钉成空格 → 夹具与"本机此刻暂存了什么"解耦（可重复）。
#
# 模式选择（密封性的关键，沿 platform-checklist.test.sh / ci-strict-visible.test.sh 先例）:
#   soft   → 断言「✅ + exit 0」用软模式: 软检查不累加 HARD_FAIL，exit 0 只取决于
#            与本次注入无关的硬检查，且本夹具已把暂存集钉空 → 与仓库里是否躺着
#            别人未跟踪的 .md 无关（否则 D782/D2 登记门禁会把本夹具弄成假红）。
#   strict → 断言「❌ + exit 1」用 CI 严格模式: 期望非零退出，多出来的失败不影响判据。
# 两种模式下组 7a 的判定逻辑完全同一条代码路径，故 soft 下的 ✅ 与 CI 上的 ✅ 等价。
run_pc() {
  local mode="$1" inj="$2"; shift 2
  local ci=1; [ "$mode" = "soft" ] && ci=0
  ( cd "$REPO" && env SYNO_TEST_ARM=1 SYNO_CI="$ci" \
      SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
      SYNO_GATE_HITS_LOG="$(mktemp)" \
      SYNO_GIT_CACHED_NAMES=' ' SYNO_GIT_CACHED_ALL_NAMES=' ' \
      SYNO_GIT_CACHED_ADDED_NAMES=' ' SYNO_GIT_CACHED_DIFF="$inj" \
      "$@" bash "$PC" 2>&1 )
}

# 组 7a 的**检查行**：含被禁模块名 + 行首是状态标记（✅/❌/⚠️）。
# 不用检查名的固定文案定位 —— 降级路径打印的是另一句（"检查降级"），
# 命中路径打印的是 soft_check 的名字；只有"状态标记行"能同时覆盖三态。
# 命中时下方会列出命中的 diff 行（5 空格缩进、无状态标记），不会误入。
seven_a_lines() {
  printf '%s\n' "$1" | sed "s/${ESC}\[[0-9;]*m//g" \
    | grep -F "$BANNED" | grep -E "^[[:space:]]*(✅|❌|⚠️)"
}
has_ok()   { printf '%s' "$1" | grep -q "✅"; }
has_bad()  { printf '%s' "$1" | grep -q "❌"; }

echo "=== D937: 组 7a fail-open 假绿判别夹具 ==="
echo "  平台: $(uname -s 2>/dev/null || echo unknown) ｜ grep: $(grep -V 2>&1 | sed -n '1p')"
echo ""

# ── T1 正常: 干净 diff → 组 7a ✅ 且 exit 0 ──────────────────────────────────
OUT=$(run_pc soft ' '); RC=$?
L=$(seven_a_lines "$OUT")
if [ -n "$L" ] && has_ok "$L"; then
  ok "T1 正常: 干净 diff → 组 7a ✅"
else
  no "T1 正常: 干净 diff 应 7a ✅，实际: ${L:-<无 7a 行>}"
fi
if [ "$RC" -eq 0 ]; then
  ok "T1 正常: 干净 diff → exit 0"
else
  no "T1 正常: 应 exit 0，实际 ${RC}；失败组:"
  printf '%s\n' "$OUT" | sed "s/${ESC}\[[0-9;]*m//g" | grep -F "❌" | sed 's/^/      /'
fi

# ── T1s 正常(CI 严格): 干净 diff + SYNO_CI=1 → 组 7a 仍 ✅（不得假红）────────
# 只钉 7a：严格模式下全局 exit 还受与本次注入无关的门禁影响（例：D782/D2 登记门禁
# 的输入含"未跟踪 .md"= 非密封状态），那不属于本夹具的判据域。
OUT=$(run_pc strict ' '); RC=$?
L=$(seven_a_lines "$OUT")
if [ -n "$L" ] && has_ok "$L"; then
  ok "T1s 正常(CI strict): 干净 diff → 组 7a ✅（严格模式不假红，实测全局 exit=${RC}）"
else
  no "T1s 正常(CI strict): 应 7a ✅，实际: ${L:-<无 7a 行>}"
fi

# ── T2 判别（一票判据）: 注入违规用法 → CI strict exit 1 + 点名组 7a ──────────
# 与头注"改前基线"完全同一注入串：改前 exit 0 ✅，改后必须 exit 1 ❌。
OUT=$(run_pc strict "+const x = new ${BANNED}();"); RC=$?
L=$(seven_a_lines "$OUT")
if [ "$RC" -eq 1 ] && [ -n "$L" ] && has_bad "$L" && ! has_ok "$L"; then
  ok "T2 判别: 注入被禁模块用法 → CI strict exit 1 且组 7a 判 ❌（非假绿）"
else
  no "T2 判别: 应 exit 1 + 组 7a ❌，实际 exit=$RC 行=[${L:-<无 7a 行>}]"
  printf '%s\n' "$OUT" | sed "s/${ESC}\[[0-9;]*m//g" | grep -F "$BANNED" | sed 's/^/      /'
fi

# ── T2b 判别: 命中带真实 `+++ b/<file>` 头 → 仍须 exit 1 ────────────────────
DIFF_T2B="$(printf 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,3 @@\n+const x = new %s();\n' "$BANNED")"
OUT=$(run_pc strict "$DIFF_T2B"); RC=$?
L=$(seven_a_lines "$OUT")
if [ "$RC" -eq 1 ] && [ -n "$L" ] && has_bad "$L" && ! has_ok "$L"; then
  ok "T2b 判别: 带 +++ 头的 src/x.ts 命中 → exit 1 + 组 7a ❌"
else
  no "T2b 判别: 应 exit 1 + 组 7a ❌，实际 exit=$RC 行=[${L:-<无 7a 行>}]"
fi

# ── T3p 前置 + T3d 方言观测（**先探后判**，不靠方言假设）──────────────────────
# T3p: 判据前提 = 本平台真的拒收 OVR_UNLAWFUL。若某平台接受它 → 判据不成立 → **fail loud**
#      （绝不静默跳过，也绝不放宽成假绿）。
grep -E -e "$OVR_UNLAWFUL" /dev/null >/dev/null 2>&1; PRC_UNLAWFUL=$?
if [ "$PRC_UNLAWFUL" -eq 2 ]; then
  ok "T3p 前置: 本平台 grep 拒收非法 ERE '$OVR_UNLAWFUL'（rc=2）—— T3 判据与方言无关"
else
  no "T3p 前置: 本平台对 '$OVR_UNLAWFUL' 返回 rc=${PRC_UNLAWFUL}（应 2）—— 判据前提不成立，fail loud"
fi
# T3d: 历史模式 `^+++` 的方言差异 —— **可见观测，不参与判据**（CTO 规范第 5 条：
#      与方言无关 或 显式探针 + 双分支期望；此处选"探针 + 只观测"）。
grep -E -e "$OVR_HISTORIC" /dev/null >/dev/null 2>&1; PRC_HISTORIC=$?
if [ "$PRC_HISTORIC" -eq 2 ]; then
  echo "      （T3d 方言观测: grep -E -e '$OVR_HISTORIC' /dev/null → rc=2 = 本平台判其非法；GNU grep 接受之）"
else
  echo "      ⚠️ PLATFORM-DIFF: 本平台 grep 未把 '$OVR_HISTORIC' 判为非法 ERE（rc=${PRC_HISTORIC}）—— 历史模式方言相关，故本夹具只用 '$OVR_UNLAWFUL' 作判据"
fi

# ── T3 降级: 排除模式非法（武装缝覆盖，**与方言无关的非法 ERE**）→ 显式降级，不得判 ✅ ──
OUT=$(run_pc strict "+const x = new ${BANNED}();" "SYNO_DIAG_EXCL_OVERRIDE=$OVR_UNLAWFUL"); RC=$?
L=$(seven_a_lines "$OUT")
if [ -n "$L" ] && ! has_ok "$L"; then
  ok "T3 降级: 排除模式非法 → 组 7a 不判 ✅"
else
  no "T3 降级: 组 7a 在非法排除模式下仍判 ✅（fail-open 未修）: ${L:-<无 7a 行>}"
fi
if printf '%s' "$OUT" | grep -q "降级"; then
  ok "T3 降级: stdout 含显式「降级」字样"
else
  no "T3 降级: 缺显式「降级」字样（静默吞错）"
fi
if [ "$RC" -eq 1 ]; then
  ok "T3 降级: CI strict 下降级计 HARD_FAIL (exit 1)"
else
  no "T3 降级: CI strict 下降级应 exit 1（fail-closed），实际 $RC"
fi

# ── T3f 无缝合: 不设 SYNO_TEST_ARM → SYNO_DIAG_EXCL_OVERRIDE 必须被忽略 ──────
# 判别原理: grep 在读输入前先编译模式。若生产路径真的采纳了非法覆盖模式，
# 即使 diff 为空，grep -Ev 也会 exit 2 → 必然打出「降级」。故"无降级 + 7a ✅"
# 即为"覆盖变量未被采纳"的行为证据（不需改仓库、不需造真暂存）。
# ⚠ 返修要点: 覆盖模式必须用 **OVR_UNLAWFUL**（方言无关）—— 若用 `^+++`，GNU 平台下
#   即使覆盖真的泄漏进生产也不会产生 exit 2 ⇒ 本断言在 GNU 上**恒绿 = 判别力归零**。
OUT=$( cd "$REPO" && env -u SYNO_TEST_ARM -u SYNO_GIT_CACHED_DIFF \
        GITHUB_ACTIONS=true SYNO_DIFF_BASE=HEAD SYNO_CI=1 \
        SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
        SYNO_GATE_HITS_LOG="$(mktemp)" "SYNO_DIAG_EXCL_OVERRIDE=$OVR_UNLAWFUL" \
        bash "$PC" 2>&1 ); RC=$?
L=$(seven_a_lines "$OUT")
if ! printf '%s' "$OUT" | grep -q "降级" && has_ok "$L"; then
  ok "T3f 无缝合: 未武装时覆盖变量被忽略（空 diff 路径，fail-closed）"
else
  no "T3f 无缝合: 未武装时覆盖变量仍生效（生产可被覆盖 = fail-open）: ${L:-<无 7a 行>}"
fi
# 第二跑: 无 GITHUB_ACTIONS / 无 SYNO_DIFF_BASE → 走真实 `git diff --cached`
# D937返修(#737 CI 实证): 原判据 `grep -q "降级"` 扫**全输出** —— 本测试自己注入的
#   SYNO_GATEKEEPER_ACK=1 会让 GATEKEEPER 打出「已人工确认 — 降级为告警放行」横幅，
#   该横幅含「降级」二字 → 本断言恒红（CI ubuntu 红 = 此，非方言、非产品 fail-open）。
#   修法=判据收敛到**组 7a 行本身**（与第一跑同构）: 7a ✅ 且无 ❌ ⇒ 覆盖变量未被采纳；
#   若覆盖真泄漏进生产，grep 编译期 exit 2 → 7a 必打「降级」且 ❌（判别力保留）。
OUT=$( cd "$REPO" && env -u SYNO_TEST_ARM -u GITHUB_ACTIONS -u SYNO_DIFF_BASE \
        -u SYNO_GIT_CACHED_DIFF SYNO_CI=1 \
        SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
        SYNO_GATE_HITS_LOG="$(mktemp)" "SYNO_DIAG_EXCL_OVERRIDE=$OVR_UNLAWFUL" \
        bash "$PC" 2>&1 ); RC=$?
L=$(seven_a_lines "$OUT")
if has_ok "$L" && ! has_bad "$L"; then
  ok "T3f 无缝合: 真实暂存区路径下覆盖变量同样被忽略"
else
  no "T3f 无缝合: 真实暂存区路径下覆盖变量生效（fail-open）: ${L:-<无 7a 行>}"
fi
echo "      （无缝合依据: 非法覆盖='$OVR_UNLAWFUL' 若被采纳, grep 编译期即 exit 2 → 必出「降级」；该 exit 2 已由 T3p 在本平台实测）"

# ── T4 边界: 三注释形态不得误报 ─────────────────────────────────────────────
DIFF_T4="$(printf 'diff --git a/src/y.ts b/src/y.ts\n--- a/src/y.ts\n+++ b/src/y.ts\n@@ -1,3 +1,6 @@\n+// %s 已废弃\n+# %s 只在注释里\n+ * %s 也只在注释里\n' "$BANNED" "$BANNED" "$BANNED")"
OUT=$(run_pc soft "$DIFF_T4"); RC=$?
L=$(seven_a_lines "$OUT")
if [ "$RC" -eq 0 ] && [ -n "$L" ] && has_ok "$L" && ! has_bad "$L"; then
  ok "T4 边界: // # * 三注释形态 → 组 7a ✅（零误报）"
else
  no "T4 边界: 注释形态被误报，exit=$RC 行=[${L:-<无 7a 行>}]"
fi

# ── T5 边界: 文档（.html）正文不得误伤 ──────────────────────────────────────
DIFF_T5="$(printf 'diff --git a/docs/x.html b/docs/x.html\n--- a/docs/x.html\n+++ b/docs/x.html\n@@ -1,2 +1,3 @@\n+<p>%s 已迁移到 Sentinel</p>\n' "$BANNED")"
OUT=$(run_pc soft "$DIFF_T5"); RC=$?
L=$(seven_a_lines "$OUT")
if [ "$RC" -eq 0 ] && [ -n "$L" ] && has_ok "$L" && ! has_bad "$L"; then
  ok "T5 边界: .html 文档正文提及 → 组 7a ✅（零误伤）"
else
  no "T5 边界: 文档正文被误伤，exit=$RC 行=[${L:-<无 7a 行>}]"
fi
# ── T5b 判别对照（防"✅ 是因为管道空转"）: 同一正文、仅把头改成 .ts ──────────
# T5 的 ✅ 有且只有两个可能来源: ①文件级 .html 豁免真的生效 ②候选提取是空转的。
# 本对照把同一段正文挂到 .ts 头下 —— 若 ① 成立，此处必然 ❌。两个断言合起来排除 ②。
DIFF_T5B="$(printf 'diff --git a/docs/x.ts b/docs/x.ts\n--- a/docs/x.ts\n+++ b/docs/x.ts\n@@ -1,2 +1,3 @@\n+const y = "<p>%s 已迁移到 Sentinel</p>";\n' "$BANNED")"
OUT=$(run_pc strict "$DIFF_T5B"); RC=$?
L=$(seven_a_lines "$OUT")
if [ "$RC" -eq 1 ] && [ -n "$L" ] && has_bad "$L" && ! has_ok "$L"; then
  ok "T5b 判别对照: 同正文挂 .ts 头 → 组 7a ❌（证明 T5 的 ✅ 来自豁免而非空转）"
else
  no "T5b 判别对照: 同正文挂 .ts 头应 ❌，实际 exit=$RC 行=[${L:-<无 7a 行>}]"
fi
# ── T5c 真实样本（fetch-depth:0 下恒可解析）: 58a19796 的朴素修复误报源头 ──
# 该 commit 全文里指向被禁模块的 + 行分布: .html 正文 9 行 + .ts 注释 1 行 +
# 检查器自身 1 行 —— 三者都应被豁免/排除，故判据是"组 7a ✅"。
# 不断言全局 exit: 历史 commit 的 diff 会合法触发其他组（本夹具只负责 7a）。
# D937返修-3(#762 CI 实证): 全文 `git show` = 267,539 字节 —— 超过 Linux 单环境变量
#   上限（MAX_ARG_STRLEN=131,072）→ CI ubuntu 上 `env SYNO_GIT_CACHED_DIFF=<全文>`
#   E2BIG，pre-commit 根本没跑 → 无 7a 行 → 断言红（macOS 无每变量限制故本地恒绿）。
#   修法=**最小保真切片**: 7a 只消费「diff --git/---/+++ 文件头 + 含 token 的 + 行」，
#   从真实 commit 现切（.html 9 行 + .ts 注释 + 检查器自身，三类豁免全覆盖），
#   体积 <2KB，任何平台 env 限制内。切片 >100KB → 夹具自身红（fail loud）。
if git -C "$REPO" cat-file -e 58a19796^{commit} 2>/dev/null; then
  T5C_SAMPLE="$(git -C "$REPO" show 58a19796 | awk '
    /^diff --git /{h1=$0;h2="";h3="";done=0;next}
    /^--- /{h2=$0;next}
    /^\+\+\+ /{h3=$0;next}
    /^\+/ && /Diagnostic/ && /Module/{
      if(!done){print h1; if(h2!="")print h2; if(h3!="")print h3; done=1}
      print
    }')"
  T5C_BYTES=$(printf '%s' "$T5C_SAMPLE" | wc -c | tr -d ' ')
  if [ "$T5C_BYTES" -gt 100000 ]; then
    no "T5c 真实样本切片异常: ${T5C_BYTES}B > 100KB（切片器失效，fail loud）"
  else
    OUT=$(run_pc soft "$T5C_SAMPLE"); RC=$?
    L=$(seven_a_lines "$OUT")
    if [ -n "$L" ] && has_ok "$L" && ! has_bad "$L"; then
      ok "T5c 真实样本: 58a19796 切片(${T5C_BYTES}B) → 组 7a ✅（0 命中；全局 exit=$RC 不判）"
    else
      no "T5c 真实样本: 58a19796 误报，行=[${L:-<无 7a 行>}]"
    fi
  fi
else
  no "T5c 真实样本: commit 58a19796 不可达（CI fetch-depth 应为 0）——判据不可判，fail loud"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 家族回归网: scripts/**/*.sh 的 `grep -E` 家族字面模式 → 逐个行为编译检查
#   提取用 POSIX 引号解析器（支持 '...' / "..." / 'a'\''b' / '"'"' 拼接、
#   双引号内 `\` 只对 $ ` " \ 生效、引号外 \x 为转义）。
#   动态（$VAR / $(...) / backtick / -f 模式文件）→ 计数登记，不判违禁。
#   解析不了 → 计入「未解析」并 fail loud（禁静默跳过）。
# ═══════════════════════════════════════════════════════════════════════════════
cat > "$TMP/parse.awk" <<'AWKEOF'
BEGIN {
  SQ = sprintf("%c", 39); DQ = sprintf("%c", 34); BS = sprintf("%c", 92)
  DL = sprintf("%c", 36); BT = sprintf("%c", 96); TAB = sprintf("%c", 9)
  npat = 0; ndyn = 0; nbad = 0; nnon = 0
}
function emit(tag, loc, body) { print tag TAB loc TAB body }

# 把一个"词"按 POSIX 引号规则解析成字符串（或标记动态/未解析）
function classify(word,   n,i,c,nxt,st,out,dyn) {
  n = length(word); st = 0; out = ""; dyn = 0; i = 1
  while (i <= n) {
    c = substr(word, i, 1)
    if (st == 0) {                                   # 引号外
      if (c == SQ) { st = 1; i++; continue }
      if (c == DQ) { st = 2; i++; continue }
      if (c == BS) { if (i < n) out = out substr(word, i+1, 1); i += 2; continue }
      if (c == DL || c == BT) { dyn = 1; out = out c; i++; continue }
      if (c == " " || c == "\t") break                # 词结束: 未引号空白
      # shell 操作符同样终止一个词（否则 `grep -E 'pat')"` 会把后面的引号吃进来）
      if (c == ";" || c == "&" || c == "|" || c == "<" || c == ">" || c == "(" || c == ")") break
      out = out c; i++; continue
    } else if (st == 1) {                             # 单引号内: 一切字面
      if (c == SQ) { st = 0; i++; continue }
      out = out c; i++; continue
    } else {                                          # 双引号内
      if (c == DQ) { st = 0; i++; continue }
      if (c == BS) {
        nxt = (i < n) ? substr(word, i+1, 1) : ""
        if (nxt == DL || nxt == BT || nxt == DQ || nxt == BS) { out = out nxt; i += 2; continue }
        out = out BS; i++; continue                   # 双引号内 \x → 反斜杠保留
      }
      if (c == DL || c == BT) dyn = 1
      out = out c; i++; continue
    }
  }
  if (st == 1) return "B\tunterminated single-quote in pattern word"
  if (st == 2) return "B\tunterminated double-quote in pattern word"
  if (dyn) return "D\texpansion ($/backtick) in pattern - not statically decidable"
  return "P\t" out
}

# 从 grep/egrep 之后解析选项簇与模式操作数
function parse_inv(line, pos, iseg,   n,end,tok,cl,k,ch2,rest,ere,fromfile) {
  n = length(line); ere = iseg; fromfile = 0
  while (pos <= n) {
    while (pos <= n && (substr(line,pos,1) == " " || substr(line,pos,1) == "\t")) pos++
    if (pos > n) return "B\tno pattern operand"
    if (substr(line,pos,1) == "-") {
      if (substr(line,pos,2) == "--") {               # 长选项
        end = pos
        while (end <= n && substr(line,end,1) != " " && substr(line,end,1) != "\t") end++
        tok = substr(line,pos,end-pos)
        if (tok == "--extended-regexp") { ere = 1; pos = end; continue }
        if (tok == "--regexp") {
          pos = end
          while (pos <= n && (substr(line,pos,1) == " " || substr(line,pos,1) == "\t")) pos++
          if (!ere) return "X\tBRE (-e without -E)"
          return classify(substr(line,pos))
        }
        if (substr(tok,1,9) == "--regexp=") {
          if (!ere) return "X\tBRE (-e without -E)"
          return classify(substr(tok,10))
        }
        if (tok == "--") {
          pos = end
          while (pos <= n && (substr(line,pos,1) == " " || substr(line,pos,1) == "\t")) pos++
          if (pos > n) return "B\tno operand after --"
          if (fromfile) return "D\tpatterns-from-file (-f)"
          if (!ere) return "X\tnot ERE"
          return classify(substr(line,pos))
        }
        pos = end; continue                            # 其他长选项: 视为无独立取值
      }
      end = pos
      while (end <= n && substr(line,end,1) != " " && substr(line,end,1) != "\t") end++
      cl = substr(line,pos+1,end-pos-1)
      k = 1
      while (k <= length(cl)) {
        ch2 = substr(cl,k,1)
        if (ch2 == "E") ere = 1
        else if (ch2 == "f") fromfile = 1
        else if (ch2 == "e") {
          rest = substr(cl,k+1)
          if (rest != "") { if (!ere) return "X\tBRE (-e without -E)"; return classify(rest) }
          pos = end
          while (pos <= n && (substr(line,pos,1) == " " || substr(line,pos,1) == "\t")) pos++
          if (pos > n) return "B\t-e without value"
          if (!ere) return "X\tBRE (-e without -E)"
          return classify(substr(line,pos))
        }
        k++
      }
      pos = end; continue
    }
    # 操作数 = 模式
    if (fromfile) return "D\tpatterns-from-file (-f)"
    if (!ere) return "X\tnot ERE"
    return classify(substr(line,pos))
  }
  return "B\tno pattern operand"
}

{
  line = $0
  if (!match(line, /^[^:]+:[0-9]+:/)) next
  pre = substr(line, 1, RLENGTH)
  content = substr(line, RLENGTH+1)
  p2 = substr(pre, 1, length(pre)-1)
  kk = 0
  for (j = length(p2); j >= 1; j--) if (substr(p2,j,1) == ":") { kk = j; break }
  loc = substr(p2,1,kk-1) ":" substr(p2,kk+1)
  tmp = content; sub(/^[ \t]+/, "", tmp)
  if (substr(tmp,1,1) == "#") next                   # 注释行不执行
  n = length(content); i = 1
  while (i <= n) {
    if (i > 1) { p = substr(content,i-1,1); if (p ~ /[A-Za-z0-9_.-]/) { i++; continue } }
    if (substr(content,i,4) == "grep") { pos = i+4; iseg = 0 }
    else if (substr(content,i,5) == "egrep") { pos = i+5; iseg = 1 }
    else { i++; continue }
    q = substr(content,pos,1)
    if (q ~ /[A-Za-z0-9_-]/) { i++; continue }        # grepfoo 不算
    res = parse_inv(content, pos, iseg)
    ty = substr(res,1,1); body = substr(res,3)
    if (ty == "P") { npat++; emit("P", loc, body) }
    else if (ty == "D") { ndyn++; emit("D", loc, body) }
    else if (ty == "X") { nnon++ }
    else { nbad++; emit("B", loc, body) }
    i = pos
  }
}
END { print "S" TAB npat TAB ndyn TAB nbad TAB nnon }
AWKEOF

# family_scan <目录> <标签>  → 设 FS_FILES FS_PAT FS_DYN FS_BAD FS_NON FS_VIOL
# 全程字节语义（LC_ALL=C）: 模式提取与 ERE 编译判定都不该受 locale 转码影响，
# 也让 macOS(BWK awk) / ubuntu(mawk|gawk) / windows(gawk) 三平台结论一致。
family_scan() {
  local dir="$1" tag="$2"
  local hits="$TMP/fs-$tag.hits" emit="$TMP/fs-$tag.emit" sline
  : > "$TMP/fs-$tag.viol"
  FS_FILES=$(find "$dir" -type f -name '*.sh' 2>/dev/null | wc -l | tr -d ' \n\r')
  LC_ALL=C grep -rnE '(^|[^A-Za-z0-9_.-])(grep|egrep)([[:space:]]|$)' "$dir" --include='*.sh' \
      2>/dev/null > "$hits" || true
  LC_ALL=C awk -f "$TMP/parse.awk" "$hits" > "$emit"
  sline=$(LC_ALL=C grep -a '^S' "$emit" | sed -n '1p')
  FS_PAT=$(printf '%s' "$sline" | cut -f2)
  FS_DYN=$(printf '%s' "$sline" | cut -f3)
  FS_BAD=$(printf '%s' "$sline" | cut -f4)
  FS_NON=$(printf '%s' "$sline" | cut -f5)
  FS_VIOL=0
  local rec loc pat rc
  while IFS= read -r rec; do
    [ -z "$rec" ] && continue
    loc="${rec#*$'\t'}"; loc="${loc%%$'\t'*}"
    pat="${rec#*$'\t'}"; pat="${pat#*$'\t'}"
    LC_ALL=C grep -E -e "$pat" /dev/null >/dev/null 2>&1; rc=$?
    if [ "$rc" -eq 2 ]; then
      FS_VIOL=$((FS_VIOL+1)); printf '%s\t%s\n' "$loc" "$pat" >> "$TMP/fs-$tag.viol"
    elif [ "$rc" -gt 1 ]; then
      FS_BAD=$((FS_BAD+1)); printf '%s\tgrep rc=%s\n' "$loc" "$rc" >> "$TMP/fs-$tag.viol"
    fi
  done < <(LC_ALL=C grep -a '^P' "$emit" || true)
}

echo ""
echo "── 家族网: scripts/**/*.sh 的 grep -E 家族（行为编译检查 grep -E -e PAT /dev/null）──"
family_scan "$REPO/scripts" main
echo "  扫描 ${FS_FILES} 个 .sh ｜ 可判 ${FS_PAT} ｜ 未解析 ${FS_BAD} ｜ 非法 ${FS_VIOL}"
echo "  （动态不可判 ${FS_DYN} ｜ 非 ERE 跳过 ${FS_NON}）"
if [ "$FS_VIOL" -eq 0 ]; then
  ok "家族网: 非法 ERE 0"
else
  no "家族网: 非法 ERE $FS_VIOL 个:"
  while IFS= read -r v; do
    [ -z "$v" ] && continue
    printf '      %s\t%s\n' "${v%%$'\t'*}" "${v#*$'\t'}"
  done < "$TMP/fs-main.viol"
fi
if [ "$FS_BAD" -eq 0 ]; then
  ok "家族网: 未解析 0"
else
  no "家族网: 未解析 $FS_BAD 个（解析器覆盖不足，fail loud）:"
  grep -a '^B' "$TMP/fs-main.emit" | sed 's/^/      /'
fi
if [ "$FS_PAT" -ge 200 ] && [ "$FS_FILES" -ge 100 ]; then
  ok "家族网: ${FS_PAT}/${FS_FILES}（≥200/100）"
else
  no "家族网: 网规模异常（可判 ${FS_PAT} / .sh ${FS_FILES}）——疑似网被削空"
fi

# ── 金丝雀: 临时 .sh 塞非法 ERE → 网必须抓到 ────────────────────────────────
# 判别性设计（铁律 0-2「接线了≠被执行」的前置）:
#   金丝雀 = canary-paren.sh（${OVR_UNLAWFUL}，括号不平衡）—— **方言无关强制判据**，
#   BSD/GNU/msys 的 grep -E 对括号不平衡一律 rc=2，任何平台都必须被网抓到。
# D937返修-2(#762 创始人解锁): 撤掉 `^+++` 条件化金丝雀（canary-caret.sh 及其 pass/fail）——
#   它平台相对（BSD 非法 / GNU 合法），CI ubuntu 下判据与期望分叉（注解实证）。
#   `^+++` 仅保留**探针打印**（可见观测），不参与任何 pass/fail。
#   顺带压缩本段输出行数，保证 tail-8|cut-450 窗口内 FIRST_FAIL（结果行）可见。
echo "── 金丝雀（a(b）──"
CAN="$TMP/canary"; mkdir -p "$CAN"
printf '#!/bin/bash\ngrep -E "%s" /dev/null\n' "$OVR_UNLAWFUL" > "$CAN/canary-paren.sh"
grep -E -e "$OVR_HISTORIC" /dev/null >/dev/null 2>&1; PRC=$?
echo "  探针: ^+++ rc=${PRC}（仅观测）"
family_scan "$CAN" canary
if grep -q "canary-paren.sh" "$TMP/fs-canary.viol"; then
  ok "金丝雀: a(b 被网抓到（非空转）"
else
  no "金丝雀: 网抓不到非法 ERE —— 网是空转的"
fi

# ── 接线: 本测试必须在 ci.yml 密封清单内（M3「机制建成未接线」）──────────────
if grep -qF 'tests/control-tower/gate-failopen-net.test.sh' "$CIY" 2>/dev/null; then
  ok "接线: ci.yml 含本测试"
else
  no "接线: ci.yml 密封清单缺本测试（跑了也不会被执行）"
fi
# D938-CI-2: FAIL>0 但 FIRST_FAIL 为空 = 夹具自身缺陷（记名机制失灵），显式红，不得静默
if [ "$FAIL" -gt 0 ] && [ -z "$FIRST_FAIL" ]; then
  echo "  ❌ SELF-CHECK: FAIL=$FAIL 但 FIRST_FAIL 为空（no() 记名机制缺陷）"
  exit 2
fi
echo "结果: $PASS/$FAIL${FIRST_FAIL:+ FIRST_FAIL=${FIRST_FAIL}}"
[ "$FAIL" -eq 0 ]
