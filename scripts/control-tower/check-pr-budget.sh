#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# check-pr-budget.sh — D734 PR 预算门禁（冲突概率 ∝ 改动大小 × 分支存活时间）
#
# 背景（派单 §二）: D721 一个 PR 背三类门禁问题挂半天；K3 审计分支落后 main
#   差点回退他人成果。大 PR + 长存活分支 = 冲突源，也是 D734 自己要禁止的形态。
#
# D1028（纯归档/出库路径级豁免，CTO 2026-09-27 方案A 授权）:
#   旧口径 `--diff-filter=ACMR` 把 D 全滤掉 ⇒ **对纯删除 PR 完全失明**（实测：合成仓库纯删 5 件
#   → ACMR 空 → N_FILES=0 → 今天恒 exit 0）。本卡把变更集口径改为
#   `--name-status --find-renames`（**取全量含 D**），并新增**路径级出库豁免**：
#     ⓐ 无增/改件（AM_SET 为空，即纯删除/纯重命名） ∧
#     ⓑ 全部变更路径落 ✅ 出库白名单 **且零条命中** ❌ 拒绝名单
#   两条同时成立 → COUNT_PATHS 全不计入 → N_FILES=0（豁免生效）；
#   否则 **不豁免**且 D/R 计入预算（收紧），并逐条打印不满足的原因与命中的 ❌ 路径。
#   旁路封堵（DS3）：**纯删除/重命名**（AM_SET 空）命中 ❌ 拒绝名单 → 直接 FAIL（exit 1）——
#   ❌ = 绝不豁免，单人一次改名/删件即可改门禁，故不随「纯出库」放行。
#
# D1028-A2v2（CTO 本轮裁定，替代「一刀切硬拦」）—— `## 死代码清理声明` 逃生口:
#   动机: 合法死代码清理 PR（删死文件 + 无其他改动）会被上一版的纯 D/R 硬拦**一刀切拦死**。
#   裁定: 「纯 D/R 无条件 FAIL」**保留**，但开一个受控逃生口 —— brief 里写
#         `## 死代码清理声明`（逐条路径 + 铁律 37 依据）⇒ 放行 + ⚠️ 警告 + 计数。
#   语义（三条同时成立才生效）:
#     a) ≥1 条条目行（段内 `- <路径> — <依据>`）；b) 声明路径集 ⊇ 本次**实际命中的 ❌ 拒绝名单
#     （`OUTBOUND_DENY_RE`）D/R 路径集**（缺一条即不生效 —— 防「写一条洗全场」）；c) 至少一条依据
#     非空（无理由不生效；含通配符的条目一律不作有效条目 —— 必须逐条精确路径）。
#   **收紧（CTO 本轮裁定）**: `OUTBOUND_DENY_EXACT` 两条（ownership.yaml / AUDIT-PROTOCOL.md）
#     **不受声明放行** —— 逃生口动机是铁律 37 死代码清理（代码域），删治理文件不是死代码清理；
#     命中即照旧 FAIL。要动这两条须独立卡 + CTO 批复，不走「清理声明」这道门。
#   **放行 ≠ 豁免**: 生效只解除旁路封堵，这些路径**照常计入 N_FILES**（仍受 `--max-files` 约束，
#     13 件声明齐全照样 exit 1）—— 逃生口解的是「一刀切」，不是预算。
#   不生效 ⇒ 维持硬拦（❌ + FAILED=1），并打印**可直接粘贴**的精确声明行 + 点名缺失路径（修复指引）。
#   声明来源链（**脚本内自解析**；禁把 `## 出库声明` 那类 PR 正文做成硬条件 —— pre-commit 读不到 PR
#   正文，设为硬条件 = 假接线，违铁律 0-2）:
#     ① `--decl-file <path>` ② `$SYNO_DR_DECL_FILE` ③ brief 链（**取并**，与 pre-commit 的
#        today_files_by_prefix 同口径）:
#        `.claude/current-brief.$DSH_SESSION_ID`（新鲜才采用）∪ `.claude/current-brief`（新鲜才采用）
#        ∪ `.claude/task-briefs/` 当日窗口（`^YYYY-MM-DD-` ±1 天，且 mtime 非陈旧）；
#        全不可得 ⇒ 视为「无声明」。
#     ①/② 是显式注入缝（测试 + CI）: 给出但不可读 ⇒ 视为「无声明」且**不回退** brief 链
#     （保证注入缝决定性）；留空等价于未给出。
#
# 契约（铁律 47）:
#   @input  — 选项:
#               --base <ref>        对比基线（默认 origin/main）
#               --max-files <N>     变更文件数上限（默认 12）
#               --max-behind <N>    落后基线提交数告警阈值（默认 20）
#               --files "<f1> <f2>" 显式变更集（测试注入；**语义不变**：视为 A/M，
#                                   故 ⓐ 恒不满足 → 按原口径计数，既有 32 项不回归）
#               --diff-status "<txt>" D1028 新增注入缝: 原样喂 `git diff --name-status`
#                                   文本，每行 `X<TAB>path`（R/C 为 `R100<TAB>old<TAB>new`），
#                                   取全量含 D → 可测纯删除/重命名豁免分支
#               --decl-file <path>  D1028-A2v2「死代码清理声明」注入缝（测试/CI 用）。
#                                   显式给出即权威: 文件不可读 ⇒ 视为「无声明」且**不回退**
#                                   brief 链；留空等价于未给出
#               --quiet             只输出结论行
#             （--diff-status 优先于 --files）
#   @output — stdout 逐项 ✅/⚠️/❌ 点名: ① 文件数（豁免生效时为出库豁免行） ② 域（调
#             check-ownership.py） ③ 落后基线提交数；❌ 行点名具体超标项。
#             豁免不生效时必须打印「出库豁免不适用」+ ⓐ/ⓑ 哪条不满足 + 逐条点名命中的 ❌ 路径
#             （超 30 件时截断显示，行内恒给「共 N 件」）。
#   @exit   — 0 = 在预算内（可含 ⚠️ 落后告警，不阻断）
#             1 = 超预算（文件数超上限 / 变更跨域 / 纯 D/R 命中 ❌ 拒绝名单）
#             2 = 检查执行失败（git 不可用 / 域校验器不可用 / 变更集算不出）—— fail-closed
#   @degraded — 基线 ref 全链不可解析（origin/main→main→origin/HEAD 均无）→ **显式 ⚠️ 留痕 +
#               跳过（exit 0）**，不 exit 2：沿用 pre-push 门禁 0-1 对「fetch 失败」的既有语义
#               （显式提示不静默跳过），避免环境性缺 ref 把所有 PR 误打成红；
#               域校验器缺失/python 不可用 → exit 2（这两类是检查本身坏了，不与通过混同）
#   @error  — 不抛；全部经退出码表达（ctrl-tower 模式 1）
#
# D1172（#1017 路径级口径，2026-10-07，提案待 K3→CTO）—— `## 同构批量声明` 豁免:
#   病根: D708 要求声明 ⊇ 变更集、G12 要求 brief Q2 ⊇ 变更集、D734 要求 ≤ MAX_FILES ——
#     三者对「归集型/同构批量 PR」物理互斥 ⇒ 越守规矩越红（#948 实测 31 件；#1017）。
#   口径（五条同时成立才豁免 ① 文件数上限，其余判据照旧）:
#     ⓐ 变更集全部为 M（零新增 A / 零复制 C / 零删除 D / 零重命名 R —— 「零新增文件」）
#     ⓑ M 件数 ≥ 10 且全部同扩展名（同构代理 1）
#     ⓒ 每件 churn（numstat added+removed）完全相等 且 ≤ 6（同构代理 2 = 零逻辑改动的
#        机器可判代理；不等/超限即普通 PR，照旧计数）
#     ⓓ `## 同构批量声明`（来源链同 D1028-A2v2: --iso-decl-file / $SYNO_ISO_DECL_FILE /
#        brief 链当日窗口）逐条精确路径 ⊇ 变更集（禁通配）且 ≥1 条依据非空
#     ⓔ 域信息/落后告警/旁路封堵等其余判据不受本豁免影响（豁免 ≠ 放行一切）
#   注入缝: --numstat "<numstat 文本>"（与 --diff-status 配套测 ⓒ；真 git 模式自动取
#     git diff --numstat BASE...HEAD）。豁免生效 ⇒ ① 打 ✅+⚠️+全量清单（不静默）。
#
# D1028 出库白/黑名单（§Q2.S2 冻结规格，逐字）:
#   ✅ OUTBOUND_ALLOW_RE   — 出库白名单前缀（纯归档/出库批次允许）
#   ❌ OUTBOUND_DENY_RE    — 拒绝名单前缀（代码/门禁/测试/扩展域，绝不豁免）
#   ❌ OUTBOUND_DENY_EXACT — CTO 2026-09-27 追加的精确路径（ownership.yaml /
#                            AUDIT-PROTOCOL.md：单人改名即可改门禁，绝不随出库豁免放行）
#
# 决策（派单要求「接线取舍理由写进 PR 描述」）:
#   接线选 pre-commit 组而非 CI quality job —— 派单红区已列 .github/workflows/ci.yml
#   （#520 刚改过，避免撞车），故 CI 侧不可用；本组按 V5.0.0「本地软提示 + CI 权威」
#   用 soft_check（本地不阻断、CI strict 转硬），条件跳过保持 <1s。
#   `## 出库声明` **不作硬条件**（§Q2.S4）：本脚本跑在 git pre-commit，读不到 PR 正文；
#   设为硬条件 = 本地永久报红/永久放行 = **假接线**（违铁律 0-2）。故豁免生效时只打 ⚠️
#   提示补声明；硬条件落在能读到 PR 正文的 merge_writeset_gate.py / ci.yml（A4 的活，本卡红线外）。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OWNERSHIP="$SCRIPT_DIR/check-ownership.py"

# PLATFORM-CHECKLIST #1: PYBIN 三级探测（禁裸 python3 —— Win 部分机器无 python3.exe）
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

BASE="origin/main"
MAX_FILES=12
MAX_BEHIND=20
FILES_OVERRIDE=""
FILES_SET=0                     # D1235: 与 DIFF_STATUS_SET 同款「是否**显式提供**」标志。
                                #   旧口径 `[ -n "$FILES_OVERRIDE" ]` 无法区分「--files ""」与「未给 --files」
                                #   ⇒ 前者会**直落真实三点 diff** ⇒ 用例在 diff>12 的工作树上必红，
                                #   且误报成「空写集失败」。夹具: check-pr-budget.test.sh §空写集注入缝。
DIFF_STATUS=""
DIFF_STATUS_SET=0
DECL_FILE=""
ISO_DECL_FILE="${SYNO_ISO_DECL_FILE:-}"
NUMSTAT_OVERRIDE=""
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base)        BASE="${2:-}"; shift 2 ;;
    --max-files)   MAX_FILES="${2:-}"; shift 2 ;;
    --max-behind)  MAX_BEHIND="${2:-}"; shift 2 ;;
    --files)       FILES_OVERRIDE="${2:-}"; FILES_SET=1; shift 2 ;;
    --diff-status) DIFF_STATUS="${2:-}"; DIFF_STATUS_SET=1; shift 2 ;;
    --decl-file)   DECL_FILE="${2:-}"; shift 2 ;;
    --iso-decl-file) ISO_DECL_FILE="${2:-}"; shift 2 ;;
    --numstat)     NUMSTAT_OVERRIDE="${2:-}"; shift 2 ;;
    --quiet)       QUIET=1; shift ;;
    *) echo "❌ check-pr-budget: 未知参数 $1" >&2; exit 2 ;;
  esac
done

# PLATFORM-CHECKLIST #2: 数字入算术前二次清洗（CRLF + 非数字）
_clean_num() { local n="${1:-}"; n="$(printf '%s' "$n" | tr -d '\r\n')"; printf '%s' "${n//[^0-9]/}"; }
# 行数计数（grep -c 无匹配时输出 "0" 且 exit 1 —— 只取 stdout，再剥 CRLF，避免 "0\n0"）
_count_lines() { printf '%s\n' "${1:-}" | sed '/^$/d' | grep -c . | tr -d '\r\n'; }
MAX_FILES="$(_clean_num "$MAX_FILES")"; MAX_FILES="${MAX_FILES:-12}"
MAX_BEHIND="$(_clean_num "$MAX_BEHIND")"; MAX_BEHIND="${MAX_BEHIND:-20}"

echo "── PR 预算门禁（D734）: 基线=$BASE 上限=${MAX_FILES} 文件 / 落后阈值=${MAX_BEHIND} ──"

# ── S1 取变更集（D1028：全量含 D；--files/--diff-status 为测试注入缝）──
STATUS_TEXT=""
INJECT_MODE=0
BEHIND=""
if [ "$DIFF_STATUS_SET" -eq 1 ]; then
  INJECT_MODE=1
  STATUS_TEXT="$DIFF_STATUS"
elif [ "$FILES_SET" -eq 1 ]; then
  INJECT_MODE=1
  # D1235: 判据从「值非空」改为「**是否显式提供**」——`--files ""` = 真空写集（与 `--diff-status ""` 对称）。
  # 语义: 提供即接管（空串 ⇒ 变更集为空 ⇒ 0 文件 ≤ 上限 ⇒ exit 0）；未提供才走真实三点 diff。
  # --files 语义不变（视为 A/M）。用 awk 加状态列而非 sed —— BSD sed 的替换侧不认 \t
  STATUS_TEXT="$(printf '%s\n' "$FILES_OVERRIDE" | tr ' ' '\n' | sed '/^$/d' | awk '{printf "M\t%s\n", $0}')"
else
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "❌ 检查执行失败: 非 git 仓库且未提供 --files/--diff-status（fail-closed）" >&2
    exit 2
  fi
  # 基线解析链（origin/main 首选；独立 clone / 浅克隆下回退）。全不可解析 → **显式降级跳过**，
  # 不 exit 2 —— 沿用 pre-push 门禁 0-1 对「fetch 失败」的既有语义（显式提示 + 不静默跳过），
  # 避免环境性缺 ref 把所有 PR 误打成红（fail-open 但留痕；铁律 11 不静默）。
  BASE_RESOLVED=""
  for _cand in "$BASE" origin/main main origin/HEAD; do
    if git rev-parse --verify --quiet "$_cand" >/dev/null 2>&1; then BASE_RESOLVED="$_cand"; break; fi
  done
  if [ -z "$BASE_RESOLVED" ]; then
    echo "  ⚠️  degraded: 基线不可解析（尝试过 $BASE / origin/main / main / origin/HEAD）"
    echo "      → 跳过 PR 预算检查（先 git fetch origin；此处显式留痕，不静默放过）"
    exit 0
  fi
  [ "$BASE_RESOLVED" != "$BASE" ] && echo "  ⚠️  基线 $BASE 不可解析 → 回退用 $BASE_RESOLVED"
  BASE="$BASE_RESOLVED"
  # S1: --name-status --find-renames 取全量（含 D）——旧口径 --diff-filter=ACMR 对纯删除 PR 失明
  STATUS_TEXT="$(git -c core.quotepath=false diff --name-status --find-renames "$BASE...HEAD" 2>/dev/null)" || {
    echo "❌ 检查执行失败: 无法计算 $BASE...HEAD 变更集（fail-closed）" >&2; exit 2; }
  # ③ 落后基线提交数（只有真 git 模式才算得出来）
  BEHIND="$(git rev-list --count "HEAD..$BASE" 2>/dev/null)" || BEHIND=""
  BEHIND="$(_clean_num "$BEHIND")"
fi

# ── S1 派生三集合（R 记双侧 old+new；D 记 1、R 记 1 用新路径、A/M/C 各记 1）──
# D1028-A2v2: ALL_PATHS → **状态标签集** ALL_TAGGED（`<X><TAB>path`，X = name-status 首字母）。
#   条目数与旧 ALL_PATHS 逐条等价（R/C 双侧各记 1）；带标签是为了 S2 能区分
#   「D/R 路径」（死代码清理声明的覆盖判据）与 A/M/C 路径（ⓐ 判据）。
TAB=$'\t'; NL=$'\n'
ALL_TAGGED=""
AM_PATHS=""
COUNT_PATHS=""
N_DEL=0
N_REN=0
while IFS=$'\t' read -r _st _p1 _p2; do
  _st="${_st%$'\r'}"; _p1="${_p1%$'\r'}"; _p2="${_p2%$'\r'}"
  [ -z "$_st" ] && continue
  if [ -z "$_p1" ]; then _p1="$_st"; _st="M"; fi   # 容错: 无 TAB 的行按 A/M 记（注入缝健壮性）
  [ -z "$_p1" ] && continue
  _s1="${_st:0:1}"
  case "$_st" in
    D*)
      ALL_TAGGED="${ALL_TAGGED}${_s1}${TAB}${_p1}${NL}"
      COUNT_PATHS="${COUNT_PATHS}${_p1}${NL}"
      N_DEL=$((N_DEL + 1)) ;;
    R*)
      ALL_TAGGED="${ALL_TAGGED}${_s1}${TAB}${_p1}${NL}${_s1}${TAB}${_p2}${NL}"
      COUNT_PATHS="${COUNT_PATHS}${_p2}${NL}"
      N_REN=$((N_REN + 1)) ;;
    C*)
      ALL_TAGGED="${ALL_TAGGED}${_s1}${TAB}${_p1}${NL}${_s1}${TAB}${_p2}${NL}"
      COUNT_PATHS="${COUNT_PATHS}${_p2}${NL}"
      AM_PATHS="${AM_PATHS}${_p2}${NL}" ;;
    *)
      ALL_TAGGED="${ALL_TAGGED}${_s1}${TAB}${_p1}${NL}"
      COUNT_PATHS="${COUNT_PATHS}${_p1}${NL}"
      AM_PATHS="${AM_PATHS}${_p1}${NL}" ;;
  esac
done < <(printf '%s\n' "$STATUS_TEXT")
ALL_N="$(_count_lines "$ALL_TAGGED")"; ALL_N="${ALL_N:-0}"
AM_N="$(_count_lines "$AM_PATHS")"; AM_N="${AM_N:-0}"

# ═══ S1.5 D1028-A2v2 死代码清理声明: 来源链解析 + 段落解析 ═══
# **惰性**: 只在真有 D/R 命中 ❌ 拒绝名单（S2.5，可能触发旁路封堵）时才解析 —— 正常 PR 零开销
#   （briefs 目录数百份文件，每次 commit 都全扫 = pre-commit 预算事故，V4.5.1 教训）。
# 来源（①/② 为显式注入缝 ⇒ 给出即权威，不可读即「无声明」且不回退；③ 为 brief 链）:
#   ① --decl-file  ② $SYNO_DR_DECL_FILE
#   ③ .claude/current-brief.$DSH_SESSION_ID（新鲜才采用）∪ .claude/current-brief（新鲜才采用）
#      ∪ .claude/task-briefs/ 当日窗口（±1 天，与 pre-commit-check.sh 的 DAY_WINDOW_RE 同口径；多份取并）
ROOT_DECL=""
DAY_WINDOW_RE=""
_DECL_FRESH_SET=""
_DECL_FRESH_NOFILTER=0

_decl_fresh_briefs() {  # 一次性 find（-mtime -2 = 2 天内新鲜）→ 全局 _DECL_FRESH_SET（零 per-file 子进程）
  local _dir="$ROOT_DECL/.claude/task-briefs" _out _x
  _DECL_FRESH_SET="|"
  [ -d "$_dir" ] || return 0            # 无 briefs 目录 → 空集（无需 find，也不产生 stderr 噪音）
  if ! _out="$(find "$_dir" -maxdepth 1 -name '*.md' -mtime -2)"; then
    _DECL_FRESH_NOFILTER=1              # find 不可用 → 退化为纯日期窗口（不因环境缺工具静默关死逃生口）
    return 0
  fi
  while IFS= read -r _x; do
    [ -z "$_x" ] && continue
    _DECL_FRESH_SET="${_DECL_FRESH_SET}${_x}|"
  done < <(printf '%s\n' "$_out")
  return 0
}
_decl_brief_in_window() {  # $1=brief 路径 → 0 = 文件名日期在当日窗口(±1 天) 且 mtime 非陈旧
  local b
  [ -f "$1" ] || return 1
  b="${1##*/}"
  [[ "$b" =~ $DAY_WINDOW_RE ]] || return 1
  [ "$_DECL_FRESH_NOFILTER" -eq 1 ] && return 0
  case "$_DECL_FRESH_SET" in *"|$1|"*) return 0 ;; esac
  return 1
}

DECL_SRC_FILES=""
DECL_SRC_DESC=""
DECL_SRC_N=0
DECL_TRIED=""            # 「已尝试」来源逐条留痕（未找到来源时必须逐条列出 —— 门禁必须给正解，D911 C5）
_DECL_SCAN_N=0           # brief 目录扫描总数
_DECL_MATCH_N=0          # 其中落入当日窗口（且 mtime 非陈旧）的份数
_decl_add_src() {  # $1=文件 $2=来源标签（去重追加）
  local f="$1" label="$2"
  [ -f "$f" ] || return 1
  if [ "$DECL_SRC_N" -gt 0 ] && printf '%s\n' "$DECL_SRC_FILES" | grep -Fxq -- "$f"; then return 0; fi
  DECL_SRC_FILES="${DECL_SRC_FILES}${f}${NL}"
  # 「来源」必须**逐条带文件路径**（可审计；取并来源全部可见）—— 不许只写泛称「brief 链」
  DECL_SRC_DESC="${DECL_SRC_DESC}${label} → ${f}${NL}"
  DECL_SRC_N=$((DECL_SRC_N + 1))
  return 0
}
_decl_try() { DECL_TRIED="${DECL_TRIED}$1${NL}"; }

# 段落解析: 标题 `^#{2,4}\s*死代码清理声明` 起，至下一 `^#{1,4}\s` 标题止；段内每行 `- <路径> — <依据>`。
#   分类: P = 有效条目（有依据、精确路径） / N = 无依据（不生效） / G = 含通配符（不生效，须逐条精确路径）
#   语义与 merge_writeset_gate.py `## 写集豁免`（scan_exempt_section）同款: 无理由不生效。
_decl_scan_file() {
  local f="$1" line entry kind p reason
  [ -f "$f" ] || return 0
  local in_sec=0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    if [ "$in_sec" -eq 0 ]; then
      if printf '%s' "$line" | grep -qE '^#{2,4}[[:space:]]*死代码清理声明'; then in_sec=1; fi
      continue
    fi
    if printf '%s' "$line" | grep -qE '^#{1,4}[[:space:]]'; then break; fi
    entry="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    case "$entry" in
      "- "*) entry="${entry#- }" ;;
      *) continue ;;
    esac
    p=""; reason=""
    case "$entry" in
      *" — "*)  p="${entry%% — *}";  reason="${entry#* — }" ;;
      *" – "*)  p="${entry%% – *}";  reason="${entry#* – }" ;;
      *" -- "*) p="${entry%% -- *}"; reason="${entry#* -- }" ;;
      *" - "*)  p="${entry%% - *}";  reason="${entry#* - }" ;;
      *)        p="$entry";          reason="" ;;
    esac
    p="$(printf '%s' "$p" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    reason="$(printf '%s' "$reason" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -z "$p" ] && continue
    case "$p" in
      *'*'*|*'?'*|*'['*) printf 'G\t%s\n' "$p" ;;
      *) if [ -n "$reason" ]; then printf 'P\t%s\n' "$p"; else printf 'N\t%s\n' "$p"; fi ;;
    esac
  done < "$f"
}

DECL_ENTRY_N=0
DECL_REASON_N=0
DECL_GLOB_N=0
DECL_GLOB_LIST=""
DECL_NOREASON_N=0
DECL_NOREASON_LIST=""
DECL_PATHS=""

# 惰性入口: 只有真要裁定旁路封堵时才解析（正常 PR 零开销）
_decl_load() {
  ROOT_DECL="$(git rev-parse --show-toplevel 2>/dev/null | tr -d '\r\n' || true)"
  [ -z "$ROOT_DECL" ] && ROOT_DECL="$(cd "$SCRIPT_DIR/../.." && pwd)"
  TODAY_DASH="$(date +%Y-%m-%d)"
  if [ -n "$PYBIN" ]; then
    # 与 pre-commit-check.sh:1288-1300 同口径: 今天 ±1 天（三日窗口）的 ERE
    DAY_WINDOW_RE="$("$PYBIN" -c "
import datetime
t = datetime.date.today()
print('^(' + '|'.join((t + datetime.timedelta(days=k)).isoformat() for k in (-1, 0, 1)) + ')-')" 2>/dev/null || true)"
  fi
  [ -z "$DAY_WINDOW_RE" ] && DAY_WINDOW_RE="^${TODAY_DASH}-"

  if [ -n "${DECL_FILE:-}" ]; then
    if [ -f "$DECL_FILE" ]; then
      _decl_try "--decl-file=${DECL_FILE}"
      _decl_add_src "$DECL_FILE" "--decl-file"
    else
      _decl_try "--decl-file=${DECL_FILE}（不可读）"
      echo "  ⚠️  D1028 声明来源 --decl-file=${DECL_FILE} 不可读 → 视为「无声明」（显式注入缝不回退 brief 链）"
    fi
  elif [ -n "${SYNO_DR_DECL_FILE:-}" ]; then
    if [ -f "$SYNO_DR_DECL_FILE" ]; then
      _decl_try "\$SYNO_DR_DECL_FILE=${SYNO_DR_DECL_FILE}"
      _decl_add_src "$SYNO_DR_DECL_FILE" "SYNO_DR_DECL_FILE"
    else
      _decl_try "\$SYNO_DR_DECL_FILE=${SYNO_DR_DECL_FILE}（不可读）"
      echo "  ⚠️  D1028 声明来源 \$SYNO_DR_DECL_FILE=${SYNO_DR_DECL_FILE} 不可读 → 视为「无声明」（同上，不回退 brief 链）"
    fi
  else
    _decl_fresh_briefs   # 仅 brief 链需要（一次性 find，零 per-file 子进程）
    local _bn
    if [ -n "${DSH_SESSION_ID:-}" ] && [ -f "$ROOT_DECL/.claude/current-brief.$DSH_SESSION_ID" ]; then
      _bn="$(cat "$ROOT_DECL/.claude/current-brief.$DSH_SESSION_ID" 2>/dev/null | tr -d '[:space:]' || true)"
      if [ -n "$_bn" ] && _decl_brief_in_window "$ROOT_DECL/.claude/task-briefs/$_bn"; then
        _decl_try ".claude/current-brief.\$DSH_SESSION_ID → $_bn"
        _decl_add_src "$ROOT_DECL/.claude/task-briefs/$_bn" "brief(current-brief.\$DSH_SESSION_ID)"
      else
        _decl_try ".claude/current-brief.\$DSH_SESSION_ID → ${_bn:-（空）}（不存在/陈旧，不采用）"
        echo "  ℹ️  D1028 声明来源: current-brief.\$DSH_SESSION_ID 指向「不存在/陈旧」brief（${_bn:-空}）→ 回退当日窗口并集"
      fi
    fi
    if [ -f "$ROOT_DECL/.claude/current-brief" ]; then
      _bn="$(cat "$ROOT_DECL/.claude/current-brief" 2>/dev/null | tr -d '[:space:]' || true)"
      if [ -n "$_bn" ] && _decl_brief_in_window "$ROOT_DECL/.claude/task-briefs/$_bn"; then
        _decl_try ".claude/current-brief → $_bn"
        _decl_add_src "$ROOT_DECL/.claude/task-briefs/$_bn" "brief(current-brief)"
      else
        _decl_try ".claude/current-brief → ${_bn:-（空）}（不存在/陈旧，不采用）"
      fi
    fi
    local _f
    for _f in "$ROOT_DECL"/.claude/task-briefs/*.md; do
      [ -e "$_f" ] || continue
      _DECL_SCAN_N=$((_DECL_SCAN_N + 1))
      if _decl_brief_in_window "$_f"; then
        _DECL_MATCH_N=$((_DECL_MATCH_N + 1))
        _decl_add_src "$_f" "brief(task-briefs 当日窗口)"
      fi
    done
    _decl_try ".claude/task-briefs/ 当日窗口（±1 天）: 扫描 ${_DECL_SCAN_N} 份 .md，窗口内 ${_DECL_MATCH_N} 份"
  fi

  if [ "$DECL_SRC_N" -gt 0 ]; then
    local _sf kind p
    while IFS= read -r _sf; do
      [ -z "$_sf" ] && continue
      while IFS="$TAB" read -r kind p; do
        [ -z "$kind" ] && continue
        DECL_ENTRY_N=$((DECL_ENTRY_N + 1))
        case "$kind" in
          P) DECL_REASON_N=$((DECL_REASON_N + 1)); DECL_PATHS="${DECL_PATHS}${p}${NL}" ;;
          N) DECL_NOREASON_N=$((DECL_NOREASON_N + 1)); DECL_NOREASON_LIST="${DECL_NOREASON_LIST}${p}${NL}" ;;
          G) DECL_GLOB_N=$((DECL_GLOB_N + 1)); DECL_GLOB_LIST="${DECL_GLOB_LIST}${p}${NL}" ;;
        esac
      done < <(_decl_scan_file "$_sf")
    done < <(printf '%s\n' "$DECL_SRC_FILES")
    DECL_PATHS="$(printf '%s' "$DECL_PATHS" | sed '/^$/d' | sort -u)"
  fi
  return 0
}

_decl_covers() {  # $1=声明路径集 $2=需覆盖路径集 → 0 = 全覆盖（⊇）
  local _p
  [ -z "${2:-}" ] && return 0
  while IFS= read -r _p; do
    [ -z "$_p" ] && continue
    printf '%s\n' "${1:-}" | grep -Fxq -- "$_p" || return 1
  done < <(printf '%s\n' "$2")
  return 0
}
_decl_missing_list() {  # $1=声明路径集 $2=需覆盖路径集 → 打印未覆盖项（逐条点名）
  local _p
  [ -z "${2:-}" ] && return 0
  while IFS= read -r _p; do
    [ -z "$_p" ] && continue
    printf '%s\n' "${1:-}" | grep -Fxq -- "$_p" || printf '%s\n' "$_p"
  done < <(printf '%s\n' "$2")
}

# ── S2 路径级出库豁免: ⓐ（AM_SET 空）∧ ⓑ（全部变更路径落 ✅ 且零命中 ❌）──
# 2026-09-29 扩：客户数据处置（docs/synova 存量 / research / decisions / CHRONICLE）——
#   依据：创始人 2026-09-29 安全事件处置（公开仓库客户名 172 件并集）；纯删风险低 + DENY 兜底仍在。
OUTBOUND_ALLOW_RE='^(\.claude/task-briefs/|docs/plans/|docs/synova/coordination/|memory/notes/|docs/synova/archive/|docs/archive/|docs/synova/|docs/research/|decisions/|CHRONICLE\.md$)'
OUTBOUND_DENY_RE='^(src/|scripts/|\.github/|tests/|extensions/|expert/)'
OUTBOUND_DENY_EXACT_RE='^docs/synova/coordination/(ownership\.yaml|AUDIT-PROTOCOL\.md)$'
OUTBOUND_EXEMPT=0
OUTBOUND_DENY_HARD=0
OUTSIDE_N=0
OUTSIDE_LIST=""
DENY_N=0
DENY_LIST=""
DR_DENY_N=0
DR_DENY_RE_N=0
DR_DENY_RE_LIST=""
DR_DENY_EXACT_N=0
DR_DENY_EXACT_LIST=""
# D1028-A2v2: 按状态标签分流 —— D/R 命中的才可能被「死代码清理声明」放行，且其中的
#   DENY_EXACT 命中**永不放行**（CTO 裁定），故两个集合分开记。
while IFS="$TAB" read -r _st_t _p; do
  [ -z "$_p" ] && continue
  _in_allow=0
  _in_deny=0
  _in_deny_exact=0
  printf '%s' "$_p" | grep -qE "$OUTBOUND_ALLOW_RE" && _in_allow=1
  printf '%s' "$_p" | grep -qE "$OUTBOUND_DENY_RE" && _in_deny=1
  printf '%s' "$_p" | grep -qE "$OUTBOUND_DENY_EXACT_RE" && _in_deny_exact=1
  if [ "$_in_deny" -eq 0 ] && [ "$_in_deny_exact" -eq 1 ]; then _in_deny=2; fi
  if [ "$_in_allow" -eq 0 ]; then
    OUTSIDE_N=$((OUTSIDE_N + 1))
    OUTSIDE_LIST="${OUTSIDE_LIST}${_p}${NL}"
  fi
  if [ "$_in_deny" -ne 0 ]; then
    DENY_N=$((DENY_N + 1))
    DENY_LIST="${DENY_LIST}${_p}${NL}"
    case "$_st_t" in
      D|R)
        DR_DENY_N=$((DR_DENY_N + 1))
        if [ "$_in_deny" -eq 2 ]; then
          DR_DENY_EXACT_N=$((DR_DENY_EXACT_N + 1)); DR_DENY_EXACT_LIST="${DR_DENY_EXACT_LIST}${_p}${NL}"
        else
          DR_DENY_RE_N=$((DR_DENY_RE_N + 1)); DR_DENY_RE_LIST="${DR_DENY_RE_LIST}${_p}${NL}"
        fi ;;
    esac
  fi
done < <(printf '%s\n' "$ALL_TAGGED")

if [ "$ALL_N" -gt 0 ]; then
  if [ "$AM_N" -eq 0 ] && [ "$OUTSIDE_N" -eq 0 ] && [ "$DENY_N" -eq 0 ]; then
    OUTBOUND_EXEMPT=1
  else
    echo "  ℹ️  出库豁免不适用（D1028 路径级豁免未生效）:"
    if [ "$AM_N" -eq 0 ]; then
      echo "       ⓐ 满足: 无增/改件（纯删除 ${N_DEL} 件 + 重命名 ${N_REN} 件）"
    else
      echo "       ⓐ 不满足: 变更含 ${AM_N} 件增/改（非纯删除/重命名）→ D/R 计入预算"
    fi
    if [ "$OUTSIDE_N" -gt 0 ]; then
      echo "       ⓑ 不满足: 白名单外路径 ${OUTSIDE_N} 件（未落出库白名单）:"
      printf '%s\n' "$OUTSIDE_LIST" | awk -v ind="         " -v cap=30 'NF { if (++i <= cap) print ind $0 } END { if (i > cap) print ind "… 其余 " (i - cap) " 件省略（共 " i " 件）" }'
    fi
    if [ "$DENY_N" -gt 0 ]; then
      echo "       ⓑ 不满足: 命中 ❌ 拒绝名单 ${DENY_N} 件（绝不豁免）:"
      printf '%s\n' "$DENY_LIST" | awk -v ind="         " -v cap=30 'NF { if (++i <= cap) print ind $0 } END { if (i > cap) print ind "… 其余 " (i - cap) " 件省略（共 " i " 件）" }'
      # 旁路封堵（DS3）的最终裁定移到 S2.5 —— 那里才知道「死代码清理声明」是否放行
    fi
  fi
fi

# ── S2.5 D1028-A2v2 死代码清理声明裁定: 硬拦保留，仅对「声明覆盖全部 DENY_RE 命中 D/R 路径」放行 ──
# 收紧（CTO 本轮裁定）: DENY_EXACT 两条（ownership.yaml / AUDIT-PROTOCOL.md）**不受声明放行** ——
#   逃生口动机是铁律 37 死代码清理（代码域），删治理文件不是死代码清理；要动须独立卡 + CTO 批复。
DECL_EFFECTIVE=0
DECL_RELEASED_N=0
DECL_MISSING_LIST=""
DECL_MISSING_N=0
DECL_INEFFECTIVE=""
if [ "$DR_DENY_N" -gt 0 ]; then
  _decl_load   # 惰性: 仅此处需要（正常 PR 不解析 brief/声明，零开销）
  if [ "$DECL_ENTRY_N" -eq 0 ]; then
    DECL_INEFFECTIVE="未读到「## 死代码清理声明」段落（或段内零条目）"
  elif [ "$DECL_REASON_N" -eq 0 ]; then
    if [ "$DECL_GLOB_N" -gt 0 ]; then
      DECL_INEFFECTIVE="条目全部无效（含通配符 ${DECL_GLOB_N} 条 / 或全部无依据）—— 须逐条精确路径 + 依据"
    else
      DECL_INEFFECTIVE="条目全部无依据（须「- <路径> — <铁律 37 依据>」，无理由不生效）"
    fi
  elif [ "$DR_DENY_RE_N" -eq 0 ]; then
    DECL_INEFFECTIVE="本次无 DENY_RE 命中路径（仅 DENY_EXACT）—— 声明无从放行"
  elif _decl_covers "$DECL_PATHS" "$DR_DENY_RE_LIST"; then
    DECL_EFFECTIVE=1
    DECL_RELEASED_N="$DR_DENY_RE_N"
  else
    DECL_MISSING_LIST="$(_decl_missing_list "$DECL_PATHS" "$DR_DENY_RE_LIST")"
    DECL_MISSING_N="$(_count_lines "$DECL_MISSING_LIST")"; DECL_MISSING_N="${DECL_MISSING_N:-0}"
    DECL_INEFFECTIVE="声明路径未覆盖全部命中的 ❌ D/R 路径（缺 ${DECL_MISSING_N} 条）"
  fi
  if [ "$DR_DENY_EXACT_N" -gt 0 ]; then   # 收紧: DENY_EXACT 绝不随声明放行
    DECL_EFFECTIVE=0
    DECL_RELEASED_N=0
    DECL_INEFFECTIVE="命中 DENY_EXACT ${DR_DENY_EXACT_N} 件 —— 不受「## 死代码清理声明」放行（CTO 裁定: 删治理文件 ≠ 铁律 37 死代码清理，须独立卡 + CTO 批复）"
  fi
  if [ "$AM_N" -eq 0 ] && [ "$DECL_EFFECTIVE" -eq 0 ]; then OUTBOUND_DENY_HARD=1; fi
fi

# ── S3 收紧: D/R 路径默认计入预算 + 既有 D860 治理产物豁免口径（原样保留）──
# 规则: 治理前缀（brief/卡/Note/规格/自验证据）且扩展名属治理产物（md/json/yaml/yml/txt）
#        → 不计入 ≤12 文件预算（交付文件才计数）。
# 反例防线: 同前缀下的**代码文件**（.ts/.sh/.py 等）不豁免——伪装成治理产物的代码仍被计数。
#
# ── CT-D（2026-09-27）豁免**粒度**评估结论 ──
# 评估对象: 本表第 5 项 `docs/synova/product-lines/evidence/` 是**目录级**豁免
#   （`merge_writeset_gate.py` 侧只有 `.claude/bypass.log` 一条路径级内置豁免 → 口径不一致）。
# 结论 = **保留目录级豁免，但补两条粒度约束**（不改成路径级白名单）:
#   · 为什么不用路径级白名单: evidence 文件名是任务定制的（`CT1-*`/`D940-*`/`D716-win-*/...`），
#     白名单必然漏 → 每次新任务都得改门禁脚本（把"运行期产物"变成"改门禁"），违背 D860 本意。
#   · 为什么必须补粒度: 目录级豁免若不设界 = **无界通道**（evidence/ 下随便塞，预算恒绿）；
#     且原实现只打印一个**计数**，豁免了哪些文件**不可核**（与 `merge_writeset_gate.py`
#     自己写的"豁免必须显式、且逐条打印理由"同款原则冲突）。
#   粒度① **逐条列举**: 每个豁免路径逐行打印（内容可核，不静默）。
#   粒度② **数量阈值**: evidence 目录的豁免件数上限 = `--max-files`（复用同一个旋钮，**不引入新魔数**）。
#     超出部分**计入预算**并逐条点名。阈值本身不单独判红（判红仍只由 ① 文件数预算决定）
#     ⇒ 不会凭一个魔数误拦正常 PR。
#     为何上限 = MAX_FILES: 本豁免是给 M5 必备证据开的**窄口子**（每任务 1~3 件），
#     其规模不应超过整个 PR 允许的文件数；超过即视为"证据顺带夹带"，回到预算视野。
#   ⚠️ 与 `merge_writeset_gate.py` 的分工: 那边是**授权口径**（该文件是否属本 PR 写集），
#     故**不加**目录级豁免（否则任何 PR 可静默改写他人证据）；这边是**计数口径**，
#     故保留目录级豁免 + 上述两条约束。两者不是"口径不一致"，是不同语义。
GOV_PREFIX_RE='^(\.claude/task-briefs/|task-state/|memory/notes/|docs/plans/|docs/synova/product-lines/evidence/)'
GOV_EXT_RE='\.(md|json|ya?ml|txt)$'
EVIDENCE_PREFIX='docs/synova/product-lines/evidence/'
COUNTED=""
GOV_OTHER=""
EVID_CAND=""
while IFS= read -r _f; do
  [ -z "$_f" ] && continue
  if printf '%s' "$_f" | grep -qE "$GOV_PREFIX_RE" && printf '%s' "$_f" | grep -qE "$GOV_EXT_RE"; then
    case "$_f" in
      "$EVIDENCE_PREFIX"*) EVID_CAND="${EVID_CAND}${_f}
" ;;
      *) GOV_OTHER="${GOV_OTHER}${_f}
" ;;
    esac
  else
    COUNTED="${COUNTED}${_f}
"
  fi
done < <(printf '%s\n' "$COUNT_PATHS")

# CT-D 粒度②: evidence 目录豁免有界化 —— 取**字典序前 MAX_FILES 件**豁免（与输入顺序无关 ⇒ 结果确定），
#   其余计入预算。EVID_ALL_N 是"共 N 件"的全量口径（逐条点名，不截断输出）。
_EV_ALL="$(printf '%s' "$EVID_CAND" | sed '/^$/d' | sort)"
EVID_ALL_N="$(printf '%s\n' "$_EV_ALL" | grep -c . | tr -d '\r\n')"; EVID_ALL_N="$(_clean_num "$EVID_ALL_N")"
EVID_KEEP="$(printf '%s\n' "$_EV_ALL" | head -n "$MAX_FILES")"
EVID_OVER="$(printf '%s\n' "$_EV_ALL" | tail -n "+$((MAX_FILES + 1))")"
GOV_OTHER_N="$(printf '%s\n' "$GOV_OTHER" | grep -c . | tr -d '\r\n')"; GOV_OTHER_N="$(_clean_num "$GOV_OTHER_N")"
EVID_KEEP_N="$(printf '%s\n' "$EVID_KEEP" | grep -c . | tr -d '\r\n')"; EVID_KEEP_N="$(_clean_num "$EVID_KEEP_N")"
EVID_OVER_N="$(printf '%s\n' "$EVID_OVER" | grep -c . | tr -d '\r\n')"; EVID_OVER_N="$(_clean_num "$EVID_OVER_N")"
EXEMPT_N=$((GOV_OTHER_N + EVID_KEEP_N))
COUNTED="$(printf '%s%s\n' "$COUNTED" "$EVID_OVER" | sed '/^$/d')"
if [ "$OUTBOUND_EXEMPT" -eq 0 ] && [ "$EXEMPT_N" -gt 0 ]; then
  echo "  ℹ️  D860 治理产物豁免: ${EXEMPT_N} 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计入）"
  # CT-D 粒度①: 逐条列举（豁免内容可核，不静默）
  [ "$GOV_OTHER_N" -gt 0 ] && printf '%s\n' "$GOV_OTHER" | sed '/^$/d' | sed 's/^/       · /'
  if [ "$EVID_KEEP_N" -gt 0 ]; then
    echo "       · [目录级豁免 ${EVIDENCE_PREFIX}] ${EVID_KEEP_N}/${MAX_FILES} 件:"
    printf '%s\n' "$EVID_KEEP" | sed '/^$/d' | sed 's/^/         - /'
  fi
fi
if [ "$OUTBOUND_EXEMPT" -eq 0 ] && [ "$EVID_OVER_N" -gt 0 ]; then
  echo "  ⚠️  CT-D evidence 目录级豁免超阈值: 目录内共 ${EVID_ALL_N} 件 > 上限 ${MAX_FILES} 件"
  echo "      ⇒ 超出 ${EVID_OVER_N} 件**计入预算**（阈值不单独判红；判红仍由 ① 文件数决定）:"
  printf '%s\n' "$EVID_OVER" | sed '/^$/d' | sed 's/^/         - /'
fi
N_FILES="$(_count_lines "$COUNTED")"; N_FILES="${N_FILES:-0}"
if [ "$OUTBOUND_EXEMPT" -eq 1 ]; then
  # 豁免生效 → COUNT_PATHS 全不计入（含 D860 治理产物口径不再适用）
  N_FILES=0
  COUNTED=""
fi

FAILED=0

# ── ① 变更文件数 ≤ 上限（或 D1028 出库豁免生效 / 旁路封堵 FAIL）──
if [ "$OUTBOUND_EXEMPT" -eq 1 ]; then
  echo "  ✅ ① D734 出库豁免生效（$((N_DEL + N_REN)) 件纯删除/重命名，全部落出库白名单）"
  # §Q2.S4 裁定: 无 `## 出库声明` 时豁免仍生效，只给 ⚠️（本脚本读不到 PR 正文，禁做硬条件）
  echo "  ⚠️  未读到「## 出库声明」（pre-commit 读不到 PR 正文）—— 请在 PR 描述补「## 出库声明」批次段，合并级对账见 D708"
elif [ "$N_FILES" -le "$MAX_FILES" ]; then
  echo "  ✅ ① 变更文件数 $N_FILES ≤ 上限 $MAX_FILES"
else
  # ═══ D1172 (#1017) 同构批量豁免判定（仅超限才尝试；未生效 ⇒ 照旧红）═══
  ISO_OK=0; ISO_WHY=""
  _iso_all_m=1; _iso_ext=""
  while IFS=$'\t' read -r _t _ip; do
    [ -z "${_ip:-}" ] && continue
    case "$_t" in
      M*) _e="${_ip##*.}"; [ "$_e" = "$_ip" ] && _e="(无扩展名)"
          if [ -z "$_iso_ext" ]; then _iso_ext="$_e"; elif [ "$_iso_ext" != "$_e" ]; then ISO_WHY="扩展名不一（${_iso_ext} vs ${_e}）"; _iso_all_m=2; fi ;;
      *)  _iso_all_m=0; break ;;
    esac
  done < <(printf '%s\n' "$ALL_TAGGED")
  if [ "$_iso_all_m" -eq 0 ]; then ISO_WHY="变更集含非 M 状态（A/C/D/R —— 零新增文件是硬条件）"; fi
  if [ "$_iso_all_m" -ne 2 ] && [ "$_iso_all_m" -eq 1 ]; then
    if [ "$N_FILES" -lt 10 ]; then ISO_WHY="M 件数 ${N_FILES} < 10"; _iso_all_m=3; fi
  fi
  if [ "$_iso_all_m" -eq 1 ]; then
    # ⓒ churn 同构（numstat: added<TAB>removed<TAB>path）
    if [ -n "$NUMSTAT_OVERRIDE" ]; then _NS="$NUMSTAT_OVERRIDE"
    else _NS="$(git -c core.quotepath=false diff --numstat "$BASE...HEAD" 2>/dev/null || true)"; fi
    # 只保留本次 M 集内路径的 numstat 行
    _NS_FILTERED=""
    while IFS=$'\t' read -r _a _r _np; do
      [ -z "${_np:-}" ] && continue
      case "$AM_PATHS" in *"$_np"*) _NS_FILTERED="${_NS_FILTERED}${_a}${TAB}${_r}${TAB}${_np}${NL}" ;; esac
    done < <(printf '%s\n' "$_NS")
    _churn=""; _churn_bad=0
    while IFS=$'\t' read -r _a _r _np; do
      [ -z "${_np:-}" ] && continue
      _c=$(( ${_a:-0} + ${_r:-0} ))
      if [ -z "$_churn" ]; then _churn="$_c"
      elif [ "$_churn" != "$_c" ]; then _churn_bad=1; fi
      if [ "$_c" -gt 6 ]; then _churn_bad=2; fi
    done < <(printf '%s\n' "$_NS_FILTERED")
    if [ "$_churn_bad" -ne 0 ] || [ -z "$_churn" ]; then
      ISO_WHY="churn 非同构或 >6（每件 added+removed 须相等且 ≤6）"; _iso_all_m=4
    fi
  fi
  if [ "$_iso_all_m" -eq 1 ]; then
    # ⓓ 同构批量声明: --iso-decl-file 权威 / env / brief 链当日窗口
    _ISO_SOURCES=""
    if [ -n "$ISO_DECL_FILE" ]; then
      [ -f "$ISO_DECL_FILE" ] && _ISO_SOURCES="$ISO_DECL_FILE" || _ISO_SOURCES=""
    elif [ -n "${SYNO_ISO_DECL_FILE:-}" ] && [ -f "${SYNO_ISO_DECL_FILE:-}" ]; then
      _ISO_SOURCES="$SYNO_ISO_DECL_FILE"
    else
      _root="$(git rev-parse --show-toplevel 2>/dev/null | tr -d '\r\n' || true)"
      if [ -n "$_root" ] && [ -d "$_root/.claude/task-briefs" ]; then
        _d1="$(date -v-1d +%F 2>/dev/null || date -d yesterday +%F 2>/dev/null || true)"
        _d2="$(date +%F)"
        for _bf in "$_root"/.claude/task-briefs/*.md; do
          [ -e "$_bf" ] || continue
          _b="${_bf##*/}"
          case " $_d1 $_d2 " in *" ${_b:0:10} "*) _ISO_SOURCES="${_ISO_SOURCES}${_bf}${NL}" ;; esac
        done
      fi
    fi
    _ISO_DECL_PATHS=""; _ISO_DECL_REASON=0
    if [ -z "$_ISO_SOURCES" ]; then ISO_WHY="未找到「## 同构批量声明」来源"; _iso_all_m=5
    else
      while IFS= read -r _srcf; do
        [ -z "$_srcf" ] && continue
        awk 'BEGIN{in_sec=0} /^#{2,4}[[:space:]]*同构批量声明/{in_sec=1;next} /^#{1,4}[[:space:]]/{in_sec=0} in_sec && /^- /{
          line=substr($0,3); n=split(line, seg, " — "); p=seg[1]; gsub(/^[[:space:]]+|[[:space:]]+$/, "", p);
          if (p ~ /[*?]/) next; print p; if (n>=2 && seg[2] ~ /[^[:space:]]/) print "__HAS_REASON__"
        }' "$_srcf" 2>/dev/null | while read -r _l; do echo "$_l"; done >> /tmp/.synova-iso-decl.$$  # swallow-ok: 声明文件读失败=无该来源条目（下方有/无声明分支显式处理）
      done < <(printf '%s\n' "$_ISO_SOURCES")
      if [ -s /tmp/.synova-iso-decl.$$ ]; then
        _ISO_DECL_PATHS="$(grep -v '^__HAS_REASON__$' /tmp/.synova-iso-decl.$$ | sort -u)"
        grep -q '^__HAS_REASON__$' /tmp/.synova-iso-decl.$$ && _ISO_DECL_REASON=1
        rm -f /tmp/.synova-iso-decl.$$
      else rm -f /tmp/.synova-iso-decl.$$; fi
      _missing="$(printf '%s\n' "$AM_PATHS" | sed '/^$/d' | while IFS= read -r _mp; do
        printf '%s\n' "$_ISO_DECL_PATHS" | grep -Fxq -- "$_mp" || echo "$_mp"; done)"
      if [ -n "$_missing" ]; then ISO_WHY="同构批量声明未覆盖 ${_missing%%$NL*} 等（须逐条精确路径）"; _iso_all_m=6
      elif [ "$_ISO_DECL_REASON" -ne 1 ]; then ISO_WHY="声明无依据（至少 1 条「— <依据>」非空）"; _iso_all_m=7; fi
    fi
  fi
  if [ "$_iso_all_m" -eq 1 ]; then ISO_OK=1; fi
  if [ "$ISO_OK" -eq 1 ]; then
    echo "  ✅ ① D1172 同构批量豁免生效: ${N_FILES} 件全部 M / 同扩展名 / churn=${_churn} / 声明全覆盖"
    echo "  ⚠️  豁免只解除文件数上限（≤${MAX_FILES}）;其余判据照旧;完整清单见「## 同构批量声明」（#1017 口径）"
    FAILED=0
  else
    echo "  ❌ ① 变更文件数 $N_FILES > 上限 $MAX_FILES —— 拆 PR（禁调高上限）"
    echo "      ℹ️  D1172 同构批量豁免不适用: ${ISO_WHY:-未知原因}"
    FAILED=1
  fi
fi
if [ "$DECL_EFFECTIVE" -eq 1 ]; then
  # D1028-A2v2: 声明生效 = 解除旁路封堵（**不豁免预算** —— 这批路径仍在 COUNTED/N_FILES 里）
  echo "  ⚠️  D1028 死代码清理声明生效：${DECL_RELEASED_N} 件（逐条放行）"
  echo "      生效来源（逐条列出实际取证的文件路径 —— 取并来源必须全部可见，可审计）:"
  printf '%s\n' "${DECL_SRC_DESC:-（未标注）}" | awk 'NF { print "        · " $0 }'
  echo "      → 放行 ≠ 豁免: 这 ${DECL_RELEASED_N} 件**照常计入上面 ${N_FILES} 件预算**（> ${MAX_FILES} 仍阻断）"
  printf '%s\n' "$DR_DENY_RE_LIST" | awk -v ind="      " -v cap=30 'NF { if (++i <= cap) print ind "- " $0 } END { if (i > cap) print ind "… 其余 " (i - cap) " 件省略（共 " i " 件）" }'
fi
if [ "$OUTBOUND_DENY_HARD" -eq 1 ]; then
  echo "  ❌ ① D1028 旁路封堵: 纯删除/重命名命中 ❌ 拒绝名单 ${DENY_N} 件 —— 绝不豁免（exit 1）"
  if [ "$DR_DENY_EXACT_N" -gt 0 ]; then   # 逐条点名（不受声明放行者）
    echo "      ⛔ 其中 DENY_EXACT ${DR_DENY_EXACT_N} 件**不受「## 死代码清理声明」放行**（CTO 裁定: 删治理文件 ≠ 铁律 37 死代码清理；要动须独立卡 + CTO 批复）:"
    printf '%s\n' "$DR_DENY_EXACT_LIST" | awk -v ind="         " -v cap=30 'NF { if (++i <= cap) print ind $0 } END { if (i > cap) print ind "… 其余 " (i - cap) " 件省略（共 " i " 件）" }'
  fi
  if [ "$DR_DENY_RE_N" -gt 0 ]; then
    echo "      逃生口（CTO 本轮裁定）: 在本任务 brief 补「## 死代码清理声明」段落，逐条列出**下列全部**路径 + 铁律 37 依据（缺一条即不生效；通配不生效）:"
    echo "      ── 可直接粘贴（逐条把「依据待补」换成真依据）──"
    echo "      ## 死代码清理声明"
    printf '%s\n' "$DR_DENY_RE_LIST" | awk -v ind="      " -v cap=30 'NF { if (++i <= cap) print ind "- " $0 " — 依据待补（铁律 37: grep -rn 零引用确认后删旧文件）" } END { if (i > cap) print ind "- …（其余 " (i - cap) " 件省略，共 " i " 件，须逐条列出）" }'
  fi
  if [ "$DECL_SRC_N" -eq 0 ]; then
    # 原因①：根本没有声明来源 —— 必须把「已尝试」**列表填满**（悬空冒号会被读成"还有东西没显示"）
    echo "      ℹ️ 未找到声明来源（已尝试: --decl-file / \$SYNO_DR_DECL_FILE / .claude/current-brief.\$DSH_SESSION_ID / .claude/current-brief / .claude/task-briefs 当日窗口 ±1 天）"
    echo "         逐条留痕（实际探过的路径/来源）:"
    printf '%s\n' "$DECL_TRIED" | awk 'NF { print "         - " $0 }'
  else
    # 原因②：有来源，但声明本身不成立 —— 逐条列原因（缺哪条路径 / 哪条无依据 / 命中 DENY_EXACT 不受放行）
    echo "      ❌ 找到声明来源，但不生效:"
    printf '%s\n' "$DECL_SRC_DESC" | awk 'NF { print "         · 来源: " $0 }'
    printf '%s\n' "         · 汇总: ${DECL_INEFFECTIVE}"
    if [ "$DECL_ENTRY_N" -eq 0 ]; then
      echo "         · 声明段内零条目（须逐行「- <路径> — <铁律 37 依据>」；标题须为 ## / ### / #### 死代码清理声明）"
    fi
    if [ "$DECL_NOREASON_N" -gt 0 ]; then
      echo "         · 无依据条目 ${DECL_NOREASON_N} 条（无理由不生效，逐条点名）:"
      printf '%s\n' "$DECL_NOREASON_LIST" | awk 'NF { print "           - " $0 " （缺 — <铁律 37 依据>）" }'
    fi
    if [ "$DECL_GLOB_N" -gt 0 ]; then
      echo "         · 含通配符条目 ${DECL_GLOB_N} 条（不作有效条目，须逐条精确路径）:"
      printf '%s\n' "$DECL_GLOB_LIST" | awk 'NF { print "           - " $0 }'
    fi
    if [ "$DR_DENY_EXACT_N" -gt 0 ]; then
      echo "         · 命中 DENY_EXACT ${DR_DENY_EXACT_N} 件 —— 不受「## 死代码清理声明」放行（须独立卡 + CTO 批复，逐条点名）:"
      printf '%s\n' "$DR_DENY_EXACT_LIST" | awk 'NF { print "           - " $0 }'
    fi
  fi
  if [ "$DECL_MISSING_N" -gt 0 ]; then
    echo "      ❌ 声明未覆盖的 ❌ D/R 路径 ${DECL_MISSING_N} 件（缺这一条即不生效，逐条点名）:"
    printf '%s\n' "$DECL_MISSING_LIST" | awk -v ind="         " -v cap=30 'NF { if (++i <= cap) print ind $0 } END { if (i > cap) print ind "… 其余 " (i - cap) " 件省略（共 " i " 件）" }'
  fi
  echo "      注意: 声明生效只解除旁路封堵，**这些路径照常计入 ≤ ${MAX_FILES} 件预算**（放行 ≠ 豁免）"
  FAILED=1
fi

# ── ② 变更涉及的域（**信息性，不阻断**）──
  # 创始人 2026-09-29 决策：**域不用于分配与阻断**（"硬要分域，门禁相互拉扯，浪费时间"）。
  # 分配由 CTO 指定；本段只显示信息。校验器缺失 / python 不可用 ⇒ 同样不阻断。
  if [ "${N_FILES:-0}" -gt 0 ] && [ -f "$OWNERSHIP" ] && [ -n "$PYBIN" ]; then
    DOMAIN_OUT="$("$PYBIN" "$OWNERSHIP" $COUNTED 2>&1)" || true
    if printf '%s' "$DOMAIN_OUT" | grep -q '^✅ PASS'; then
      echo "  ✅ ② 变更单域: $(printf '%s\n' "$DOMAIN_OUT" | grep -E '^✅ PASS' | head -1)"
    else
      echo "  ℹ️  ② 变更跨域（**信息性，不阻断** —— 域不用于分配/阻断）:"
      printf '%s\n' "$DOMAIN_OUT" | grep -vE '^✅' | head -8 | sed 's/^/       /'
    fi
  else
    echo "  ℹ️  ② 域信息跳过（无变更 / 校验器缺失 / python 不可用 —— 不阻断）"
  fi

  # ── ③ 落后基线提交数（告警，不阻断——防「落后分支直接合」）──
if [ -n "${BEHIND:-}" ]; then
  if [ "$BEHIND" -gt "$MAX_BEHIND" ]; then
    echo "  ⚠️  ③ 分支落后 $BASE 共 $BEHIND 个提交（> ${MAX_BEHIND}）—— 先 rebase/merge 再开 PR"
  else
    echo "  ✅ ③ 落后 $BASE $BEHIND 个提交 ≤ $MAX_BEHIND"
  fi
else
  if [ "$INJECT_MODE" -eq 1 ]; then
    echo "  ✅ ③ 落后检查跳过（注入模式 --files/--diff-status 无 git 上下文）"
  else
    echo "  ✅ ③ 落后检查跳过（无 git 上下文）"
  fi
fi

if [ "$FAILED" -eq 0 ]; then
  [ "$QUIET" -eq 0 ] && echo "✅ PASS PR 预算内（$N_FILES 文件）"
  exit 0
fi
echo "❌ FAIL PR 超预算 —— 拆 PR，不要调高上限"
exit 1
