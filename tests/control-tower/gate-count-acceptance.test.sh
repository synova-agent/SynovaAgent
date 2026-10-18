#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# gate-count-acceptance.test.sh — #595 门禁组数口径自证（真值 = 数出来的 12 组）
#
# 批次: P4 · #595 ｜ 写集: tests/control-tower/gate-count-acceptance.test.sh（新建）
# 治的病: 文档/脚本/夹具/CI 自称 13 组，脚本实际只执行 12 组；C2 拿脚本里的
#         「全部 13 组通过」字串当真相 ⇒ 文档与脚本写同一个错数即恒绿（自指）。
# 本件立场: 真值只有一个来源 —— 脚本里实际会被执行的 `── 组 N:` 横幅数（=12）；
#         文档/夹具/CI step 名必须跟随它；任何硬编码总数都是回潮，必红。
#
# 契约（铁律 47）
#   @用途     #595 自证：12 项判据 ＋ R1/R2/R3 三条反例（改坏确实红、恢复确实绿）
#   @input    仓库根（由本脚本位置 tests/control-tower/../.. 推导；不可覆盖——本脚本只读仓库）
#   @output   每项判据「命令 ＋ 原始输出 ＋ ✅/❌」；反例红/绿原始输出（禁截断）；
#             末段固定 `── 汇总: N 通过 / M 失败 ──`
#   @exit     0 = 全过 ｜ 1 = 有失败项 ｜ 2 = 环境/自身失败（信号量==0 或依赖缺失，fail-closed）
#   @errors   E_ENV_MISSING（必需文件/命令缺失）｜ E_SIGNAL_ZERO（新口径横幅数=0）
#   @degraded 不走 degraded 通道：环境不满足直接 exit 2 并点名（三态复用 D1；禁静默绿）
#   @authority 谁能调：人工自验 / L1 复核 / CI。本脚本只读仓库，只写 mktemp 沙箱。
#   D732 UTF-8 强制：本文件须为合法 UTF-8（下方自检），python3 统一 encoding='utf-8'
#   判别力自检（D4）：R1 删组必红 / R2 改数必红 / R3 硬编码回潮必红；任一不红即本件失效
#
# 设计哲学: 一个分离（真值 = 数横幅）＋ 三条承诺（文档跟随真值／硬编码必红／改坏必红）。
#
# Known Limitations（做不到什么）:
#   1. 不跑全量 pre-commit（单次 ~50s；终态由验证据单跑一次并对末行「全部 12 组通过」负责）。
#   2. 不跑 5 个控制塔夹具全量（DS-8 由独立验证据逐件跑；本件只做静态文本断言）。
#   3. DS-10 判红范围仅限「现行声明白名单（14 文件）」。全仓其余 `13 组` 只打印文件数、
#      分类计数与路径，一律不判红。不判红的排除类别：CHRONICLE.md（历史）、docs/plans/**
#      （冻结 dev doc）、docs/synova/**＋docs/evidence/**（历史证据/批次记录）、memory/**
#      （四态 Note 引述）、task-state、.claude、.handbook-mirror、.github（非权威）、
#      scripts/audit（K3 禁碰）、.codex（过程日志）；其余现行件只列残留清单，交 L1/独立复核裁决。
#   4. C2 只覆盖 AGENTS.md/LOOP.md 两处文档；其余现行声明由判据 8/9/11 兜底。
#   5. 组块是否"移位"无法仅由文本断言判定（DS-11 用组号集合 ＋ 横幅数兜底；逐行 diff 另核）。
# ═══════════════════════════════════════════════════════════════════════════════
set +e
export PYTHONIOENCODING=utf-8

SELF="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SELF/../.." && pwd)"
PCC="$ROOT/scripts/pre-commit-check.sh"
C2="$ROOT/scripts/doc-system/check-doc-truth.sh"
WF="$ROOT/.gitea/workflows/local-gates.yml"
PASS=0; FAIL=0; ENV_ERR=0; SIGNAL_ZERO=0

ok()      { PASS=$((PASS+1)); echo "  ✅ $1"; }
no()      { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
envfail() { ENV_ERR=1; echo "  ❌ [E_ENV_MISSING] $1"; }
crit()    { if [ "$3" -eq 0 ]; then ok "判据 $1 — $2"; else no "判据 $1 — $2"; fi; } # $1=编号 $2=名 $3=失败数
show()    { # $1=命令原文 $2=原始输出（多行原样缩进，不截断）
  echo "  \$ $1"
  if [ -n "$2" ]; then printf '%s\n' "$2" | sed 's/^/    | /'; else echo "    | (无输出)"; fi
}
gcount() { # $1=文件 $2=ERE → 行计数；无命中/文件缺失一律回 "0"（禁 "0\n0"，CT 模式 4）
  local n
  n=$(grep -cE "$2" "$1" 2>/dev/null | tr -d '\n\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
  [ -z "$n" ] && n=0
  echo "$n"
}
hexists() { [ -f "$1" ] && echo 1 || echo 0; }

echo "═══ gate-count-acceptance.test.sh — #595 门禁组数口径自证（真值=12）═══"
echo "  root: $ROOT"
echo "  用途: 12 项判据 ＋ R1/R2/R3 反例；只读仓库、只写 mktemp 沙箱"

# ── 环境前置（缺一 ⇒ exit 2；三态 fail-closed，禁静默绿）──────────────────────
echo ""
echo "── 环境前置 ──"
for f in "$PCC" "$C2" "$WF" "$ROOT/AGENTS.md" "$ROOT/LOOP.md" \
         "$ROOT/expert/expert-registry.yaml" "$ROOT/knowledge/shared/README.md" \
         "$ROOT/CHRONICLE.md" "$ROOT/INDEX.md" "$ROOT/START-HERE.md" \
         "$ROOT/docs/authority/PRD.md" "$ROOT/docs/authority/ARCHITECTURE.md" \
         "$ROOT/docs/authority/STATUS.md" "$ROOT/docs/authority/DOCS-REGISTRY.yaml" \
         "$ROOT/scripts/control-tower/synova-commit" \
         "$ROOT/scripts/control-tower/merge_writeset_gate.py" \
         "$ROOT/scripts/check-content-coupling.sh" \
         "$ROOT/agents/P4-门禁/AGENTS.md"; do
  [ -f "$f" ] || envfail "必需文件缺失: ${f#$ROOT/}"
done
command -v python3 >/dev/null 2>&1 || envfail "python3 不可用（反例 R1/R2/R3 依赖）"
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || envfail "git 不可用或 ROOT 非 git 仓库（判据 11 全仓清单依赖）"
python3 -c 'import sys; open(sys.argv[1], encoding="utf-8").read()' "$0" 2>/dev/null || envfail "本脚本不是合法 UTF-8（D732）"  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
if [ "$ENV_ERR" -ne 0 ]; then
  echo ""
  echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
  echo "  ❌ 环境/自身失败（E_ENV_MISSING）：前置不满足，未执行判据 ⇒ exit 2"
  exit 2
fi
echo "  ✅ 环境前置满足（文件/命令/UTF-8/git）"

# ═══════════════════════════════════════════════════════════════════════════════
# B. 12 项判据（逐项打印命令＋原始输出＋✅/❌）
# ═══════════════════════════════════════════════════════════════════════════════

# ── 判据 1: 横幅数（真值）= 12 ────────────────────────────────────────────────
echo ""
echo "── 判据 1: 横幅数（真值）= 12 ──"
N1=$(gcount "$PCC" '── 组 [0-9]+:')
show "grep -cE '── 组 [0-9]+:' scripts/pre-commit-check.sh" "$N1"
F1=0
[ "$N1" -eq 12 ] || { echo "  ↳ 期望 12，实际 $N1"; F1=1; }
if [ "$N1" -eq 0 ]; then
  SIGNAL_ZERO=1
  echo "  ↳ [E_SIGNAL_ZERO] 新口径横幅数=0 —— 看不见 ≠ 没问题（终局 exit 2）"
fi
crit 1 "横幅数 = 12（DS-1）" "$F1"

# ── 判据 2: 组号集合 = {1..10,12,13} ─────────────────────────────────────────
echo ""
echo "── 判据 2: 组号集合 = {1..10,12,13}（组 11 已并入组 4，非缺功能）──"
IDS=$(grep -oE '── 组 [0-9]+' "$PCC" 2>/dev/null | grep -oE '[0-9]+' | sort -n | uniq | tr '\n' ' ' | sed 's/ *$//')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
show "grep -oE '── 组 [0-9]+' scripts/pre-commit-check.sh | grep -oE '[0-9]+' | sort -n | uniq" "$IDS"
EXPECT_IDS="1 2 3 4 5 6 7 8 9 10 12 13"
F2=0
[ "$IDS" = "$EXPECT_IDS" ] || { echo "  ↳ 期望「$EXPECT_IDS」，实际「$IDS」"; F2=1; }
crit 2 "组号集合 = {1..10,12,13}" "$F2"

# ── 判据 3: 脚本＋5 夹具无 `组 N/13` 分母 ────────────────────────────────────
echo ""
echo "── 判据 3: 脚本＋5 夹具无 \`组 N/13\` 分母（DS-4）──"
F3=(scripts/pre-commit-check.sh \
    tests/control-tower/precommit-groups-injection.test.sh \
    tests/control-tower/fastlane-bypass-only.test.sh \
    tests/control-tower/check-pr-budget.test.sh \
    tests/control-tower/gate-failopen-net.test.sh \
    tests/control-tower/ci-deps-step-sim.test.sh)
N3=0; RAW3=""
for f in "${F3[@]}"; do
  c=$(gcount "$ROOT/$f" '组 [0-9]+/13')
  N3=$((N3+c)); RAW3="${RAW3}${f}: ${c}"$'\n'
done
show "grep -cE '组 [0-9]+/13' <脚本＋5 夹具>（逐文件）" "$(printf '%s' "$RAW3")"
F3F=0
[ "$N3" -eq 0 ] || { echo "  ↳ 合计 $N3 处 ≠ 0"; F3F=1; }
crit 3 "无 /13 分母（脚本＋5 夹具）" "$F3F"

# ── 判据 4: 脚本内无 `全部 N 组通过` 字面量 ─────────────────────────────────
echo ""
echo "── 判据 4: 脚本内无 \`全部 N 组通过\` 字面量（DS-2 防回潮）──"
N4=$(gcount "$PCC" '全部 [0-9]+ 组通过')
HITS4=$(grep -nE '全部 [0-9]+ 组通过' "$PCC" 2>/dev/null | tr -d '\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
show "grep -cE '全部 [0-9]+ 组通过' scripts/pre-commit-check.sh" "$N4"
[ -n "$HITS4" ] && show "grep -nE '全部 [0-9]+ 组通过' scripts/pre-commit-check.sh（命中原文）" "$HITS4"
F4=0
[ "$N4" -eq 0 ] || { echo "  ↳ 期望 0，实际 $N4"; F4=1; }
crit 4 "脚本内无字面总数" "$F4"

# ── 判据 5: 汇总行运行时计数（12 次自增 ＋ 汇总引用变量）───────────────────
echo ""
echo "── 判据 5: 汇总行运行时计数（DS-2 DS-12）──"
INC5=$(grep -cF 'GROUP_DONE=$((GROUP_DONE+1))' "$PCC" 2>/dev/null | tr -d '\n\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
SUM5_ALL=$(grep -cF '全部 ${GROUP_DONE} 组通过' "$PCC" 2>/dev/null | tr -d '\n\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
# 「汇总行」= 可执行行（非注释）；W1 有意在自承注释里引用同一变量，不计入汇总行
SUM5=$(grep -nF '全部 ${GROUP_DONE} 组通过' "$PCC" 2>/dev/null | grep -vE '^[0-9]+:[[:space:]]*#' | wc -l | tr -d ' \r\n')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
INIT5=$(grep -cE 'GROUP_DONE=0([^0-9]|$)' "$PCC" 2>/dev/null | tr -d '\n\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
show "grep -cF 'GROUP_DONE=\$((GROUP_DONE+1))' scripts/pre-commit-check.sh" "$INC5"
show "grep -cF '全部 \${GROUP_DONE} 组通过' scripts/pre-commit-check.sh（含注释引用）" "$SUM5_ALL"
show "汇总行（非注释可执行行）计数" "$SUM5"
show "（参考·不判红）grep -cE 'GROUP_DONE=0' scripts/pre-commit-check.sh" "$INIT5"
F5=0
[ "$INC5" -eq 12 ] || { echo "  ↳ 自增期望 12，实际 $INC5"; F5=1; }
[ "$SUM5" -eq 1 ]  || { echo "  ↳ 汇总行（非注释）引用变量期望 1，实际 $SUM5"; F5=1; }
crit 5 "运行时计数（12 增 ＋ 汇总引用变量）" "$F5"

# ── 判据 6: C2 真值（数横幅）⇒ exit 0 ＋ 两行 12 = 12 ──────────────────────
echo ""
echo "── 判据 6: C2 真值（数横幅）⇒ exit 0 ＋ 两行 12 = 12（DS-3）──"
OUT6=$(cd "$ROOT" && bash "$C2" 2>&1); RC6=$?
show "bash scripts/doc-system/check-doc-truth.sh; echo exit=\$?" "$(printf '%s\nexit=%s' "$OUT6" "$RC6")"
C2LINES=$(printf '%s\n' "$OUT6" | grep -cE 'C2 门禁组数.*12 = .*12')
show "grep -cE 'C2 门禁组数.*12 = .*12'（对 C2 输出）" "$C2LINES"
F6=0
[ "$RC6" -eq 0 ] || { echo "  ↳ C2 exit=$RC6 ≠ 0"; F6=1; }
[ "$C2LINES" -eq 2 ] || { echo "  ↳ 期望 2 行「12 = 12」口径，实际 $C2LINES 行"; F6=1; }
crit 6 "C2 真值 = 12（两行）" "$F6"

# ── 判据 7: 6 处文档声明均 = 12（C2 同款正则；F7 覆盖不全由本项兜）──────────
echo ""
echo "── 判据 7: 6 处文档声明均 = 12（C2 同款正则）──"
D_AG=$(grep -vE '第.*组硬阻断' "$ROOT/AGENTS.md" 2>/dev/null | grep -oE '[0-9]+ 组 pre-commit|pre-commit [0-9]+ 组|[0-9]+ 组硬阻断' | grep -oE '[0-9]+' | tr -d '\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
D_LO=$(grep -vE '第.*组硬阻断' "$ROOT/LOOP.md" 2>/dev/null | grep -oE '[0-9]+ 组 pre-commit|pre-commit [0-9]+ 组|[0-9]+ 组硬阻断' | grep -oE '[0-9]+' | tr -d '\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
show "C2 同款正则提取 AGENTS.md → $(printf '%s' "$D_AG" | tr '\n' ' ')" "$(printf '%s' "$D_AG" | tr '\n' ' ')"
show "C2 同款正则提取 LOOP.md → $(printf '%s' "$D_LO" | tr '\n' ' ')" "$(printf '%s' "$D_LO" | tr '\n' ' ')"
ALL7=$( { printf '%s\n' "$D_AG"; printf '%s\n' "$D_LO"; } | grep -E '^[0-9]+$' )
N7=$(printf '%s\n' "$ALL7" | grep -cE '^[0-9]+$')
BAD7=$(printf '%s\n' "$ALL7" | grep -E '^[0-9]+$' | grep -vcE '^12$')
show "声明总数 / 非 12 个数" "$N7 / $BAD7"
F7=0
[ "$N7" -eq 6 ]  || { echo "  ↳ 期望 6 处，实际 $N7"; F7=1; }
[ "$BAD7" -eq 0 ] || { echo "  ↳ 存在 $BAD7 处 ≠ 12"; F7=1; }
crit 7 "6 处声明均 = 12" "$F7"

# ── 判据 8: workflow step 名与注释同口径 ────────────────────────────────────
echo ""
echo "── 判据 8: workflow（DS-9）──"
N8A=$(grep -cF '① 12 组门禁' "$WF" 2>/dev/null | tr -d '\n\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
N8B=$(gcount "$WF" '13 组')
show "grep -cF '① 12 组门禁' .gitea/workflows/local-gates.yml" "$N8A"
show "grep -cE '13 组' .gitea/workflows/local-gates.yml" "$N8B"
F8=0
[ "$N8A" -eq 1 ] || { echo "  ↳ 期望 1，实际 $N8A"; F8=1; }
[ "$N8B" -eq 0 ] || { echo "  ↳ 期望 0，实际 $N8B"; F8=1; }
crit 8 "workflow = 12 组且无 13" "$F8"

# ── 判据 9: W6 其余现行声明四文件 ───────────────────────────────────────────
echo ""
echo "── 判据 9: W6 四文件无 \`13 组\`（DS-10 现行声明）──"
F9=(scripts/control-tower/synova-commit \
    scripts/control-tower/merge_writeset_gate.py \
    scripts/check-content-coupling.sh \
    "agents/P4-门禁/AGENTS.md")
N9=0; RAW9=""
for f in "${F9[@]}"; do
  c=$(gcount "$ROOT/$f" '13 组')
  N9=$((N9+c)); RAW9="${RAW9}${f}: ${c}"$'\n'
done
show "grep -cE '13 组' <W6 四文件>（逐文件）" "$(printf '%s' "$RAW9")"
F9F=0
[ "$N9" -eq 0 ] || { echo "  ↳ 合计 $N9 处 ≠ 0"; F9F=1; }
crit 9 "W6 四文件无 13 组" "$F9F"

# ── 判据 10: 5 控制塔夹具 ＋ 2 doc-system 夹具 ─────────────────────────────
echo ""
echo "── 判据 10: 7 夹具同口径（DS-8）──"
F10A=(tests/control-tower/precommit-groups-injection.test.sh \
      tests/control-tower/fastlane-bypass-only.test.sh \
      tests/control-tower/check-pr-budget.test.sh \
      tests/control-tower/gate-failopen-net.test.sh \
      tests/control-tower/ci-deps-step-sim.test.sh)
N10A=0; RAW10A=""
for f in "${F10A[@]}"; do
  c=$(gcount "$ROOT/$f" '13 组')
  N10A=$((N10A+c)); RAW10A="${RAW10A}${f}: ${c}"$'\n'
done
show "grep -cE '13 组' <5 控制塔夹具>（逐文件）" "$(printf '%s' "$RAW10A")"
F10B=(tests/doc-system/check-doc-truth.test.sh tests/doc-system/doc-truth-probe.test.sh)
RAW10B=""; F10Bf=0
for f in "${F10B[@]}"; do
  lit=$(grep -cF '全部 5 组通过' "$ROOT/$f" 2>/dev/null | tr -d '\n\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
  bann=$(grep -oF '── 组 ' "$ROOT/$f" 2>/dev/null | wc -l | tr -d ' \r\n')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
  RAW10B="${RAW10B}${f}: 全部5组通过=${lit} 横幅=${bann}"$'\n'
  [ "$lit" -eq 0 ]  || F10Bf=1
  [ "$bann" -eq 5 ] || F10Bf=1
done
show "grep -cF '全部 5 组通过' ／ grep -oF '── 组 ' | wc -l（2 doc-system 夹具）" "$(printf '%s' "$RAW10B")"
F10=0
[ "$N10A" -eq 0 ] || { echo "  ↳ 5 控制塔夹具合计 $N10A 处 13 组 ≠ 0"; F10=1; }
[ "$F10Bf" -eq 0 ] || { echo "  ↳ doc-system 夹具期望「0 处字面 / 各 5 条横幅」，见上"; F10=1; }
crit 10 "7 夹具同口径" "$F10"

# ── 判据 11: 现行声明白名单 14 文件 = 0 ＋ 全仓清单打印（不判红）───────────
echo ""
echo "── 判据 11: 现行声明白名单 14 文件无 13 组（DS-10）＋ 全仓残留清单 ──"
WL=(AGENTS.md LOOP.md \
    scripts/pre-commit-check.sh scripts/doc-system/check-doc-truth.sh \
    .gitea/workflows/local-gates.yml \
    scripts/control-tower/synova-commit scripts/control-tower/merge_writeset_gate.py \
    scripts/check-content-coupling.sh "agents/P4-门禁/AGENTS.md" \
    tests/control-tower/precommit-groups-injection.test.sh \
    tests/control-tower/fastlane-bypass-only.test.sh \
    tests/control-tower/check-pr-budget.test.sh \
    tests/control-tower/gate-failopen-net.test.sh \
    tests/control-tower/ci-deps-step-sim.test.sh)
N11=0; RAW11=""
for f in "${WL[@]}"; do
  c=$(gcount "$ROOT/$f" '13 组')
  N11=$((N11+c)); RAW11="${RAW11}${f}: ${c}"$'\n'
done
show "grep -cE '13 组' <白名单 14 文件>（逐文件）" "$(printf '%s' "$RAW11")"
F11=0
[ "$N11" -eq 0 ] || { echo "  ↳ 白名单合计 $N11 处 ≠ 0"; F11=1; }
# 全仓清单：只打印，不判红（DS-10 白名单口径；历史/过程件有意保留）
ALLFILES=$(git -C "$ROOT" grep -l '13 组' 2>/dev/null | tr -d '\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
NFILES=$(printf '%s\n' "$ALLFILES" | grep -c .)
WLHIT=0; HISTN=0; OTHERN=0; OTHERLIST=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  in_wl=0
  for w in "${WL[@]}"; do [ "$f" = "$w" ] && in_wl=1 && break; done
  if [ "$in_wl" -eq 1 ]; then
    WLHIT=$((WLHIT+1))
  elif printf '%s' "$f" | grep -qE '^(CHRONICLE\.md|docs/plans/|docs/synova/|docs/evidence/|memory/|task-state/|\.claude/|\.handbook-mirror/|\.github/|scripts/audit/|\.codex/)'; then
    HISTN=$((HISTN+1))
  else
    OTHERN=$((OTHERN+1)); OTHERLIST="${OTHERLIST}${f}"$'\n'
  fi
done <<< "$ALLFILES"
show "git grep -l '13 组' | wc -l（全仓 tracked 文件数）" "$NFILES"
show "分类: 白名单(判红) / 历史·过程件(不判红) / 其余现行(不判红，列残留)" "A=$WLHIT B=$HISTN C=$OTHERN"
echo "  排除规则（B 类，不判红）: CHRONICLE.md｜docs/plans/**（冻结 dev doc）｜docs/synova/**（历史证据/批次记录）｜docs/evidence/**｜memory/**（四态 Note 引述）｜task-state｜.claude｜.handbook-mirror｜.github（非权威）｜scripts/audit（K3 禁碰）｜.codex（过程日志）"
if [ -n "$OTHERLIST" ]; then
  show "其余现行文件（不判红；残留清单交 L1/独立复核裁决）" "$(printf '%s' "$OTHERLIST")"
fi
crit 11 "白名单 14 文件无 13 组" "$F11"

# ── 判据 12: DS-11 组号集合 ＋ 组块数（互补，确认无增删）─────────────────
echo ""
echo "── 判据 12: DS-11 组号集合 ＋ 组块数（与判据 1/2 互补）──"
IDS12=$(grep -oE '── 组 [0-9]+' "$PCC" 2>/dev/null | grep -oE '[0-9]+' | sort -n | uniq | tr '\n' ' ' | sed 's/ *$//')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
N12=$(gcount "$PCC" '── 组 [0-9]+:')
CNT12=$(printf '%s\n' "$IDS12" | tr ' ' '\n' | grep -cE '^[0-9]+$')
show "组号集合" "$IDS12"
show "横幅数 / 去重组号数" "$N12 / $CNT12"
F12=0
[ "$IDS12" = "$EXPECT_IDS" ] || { echo "  ↳ 组号集合 ≠ {1..10,12,13}"; F12=1; }
[ "$N12" -eq 12 ]  || { echo "  ↳ 横幅数期望 12，实际 $N12"; F12=1; }
[ "$CNT12" -eq 12 ] || { echo "  ↳ 去重组号数期望 12，实际 $CNT12"; F12=1; }
crit 12 "DS-11 组号集合＋组块数" "$F12"

# ═══════════════════════════════════════════════════════════════════════════════
# C. 三条反例（全部 mktemp 沙箱；DOC_TRUTH_ROOT 注入；恢复后必须回绿）
# ═══════════════════════════════════════════════════════════════════════════════
SBX=$(mktemp -d "${TMPDIR:-/tmp}/gate-count-acceptance.XXXXXX") || {
  echo "  ❌ [E_ENV_MISSING] mktemp 沙箱创建失败 ⇒ exit 2"; exit 2;
}
trap 'rm -rf "$SBX"' EXIT

mksbx() { # $1=沙箱根：复制 C2 所需最小真源（只读仓库 → 写沙箱）
  local s=$1
  rm -rf "$s"; mkdir -p "$s/scripts/doc-system" "$s/expert" "$s/knowledge/shared" "$s/docs/authority"
  cp "$PCC" "$s/scripts/pre-commit-check.sh"
  cp "$ROOT/AGENTS.md" "$ROOT/LOOP.md" "$s/"
  cp "$ROOT/expert/expert-registry.yaml" "$s/expert/"
  [ -f "$ROOT/knowledge/shared/README.md" ] && cp "$ROOT/knowledge/shared/README.md" "$s/knowledge/shared/"
  cp "$ROOT/CHRONICLE.md" "$ROOT/INDEX.md" "$ROOT/START-HERE.md" "$s/"
  cp "$ROOT/docs/authority/PRD.md" "$ROOT/docs/authority/ARCHITECTURE.md" \
     "$ROOT/docs/authority/STATUS.md" "$ROOT/docs/authority/DOCS-REGISTRY.yaml" "$s/docs/authority/"
}
run_c2() { # $1=沙箱根 → stdout 写 $SBX/.c2.out，echo exit code
  ( cd "$ROOT" && DOC_TRUTH_ROOT="$1" bash "$C2" ) >"$SBX/.c2.out" 2>&1
  echo $?
}
c2out() { tr -d '\r' < "$SBX/.c2.out"; }

# ── R1: 删最后一个分组块（含横幅）⇒ C2 必红；恢复 ⇒ 绿 ─────────────────────
echo ""
echo "── 反例 R1: 删最后分组块（含横幅）⇒ C2 必红；恢复 ⇒ 绿（DS-5）──"
mksbx "$SBX"
RC=$(run_c2 "$SBX"); OUT=$(c2out)
show "DOC_TRUTH_ROOT=<sbx> bash scripts/doc-system/check-doc-truth.sh（基线）" "$(printf '%s\nexit=%s' "$OUT" "$RC")"
F_R1=0
if [ "$RC" -ne 0 ]; then
  echo "  ↳ 沙箱基线期望 exit 0，实际 $RC（前置 W1/W2/W3 未齐 ⇒ R1 暂无判别力）"
  F_R1=1
else
  DEL_OUT=$(python3 - "$SBX/scripts/pre-commit-check.sh" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
needle = '── 组 13:'
idx = s.rfind(needle)
if idx < 0:
    print('ERROR: 副本未找到 `── 组 13:` 横幅（W1 未完成？）')
    sys.exit(3)
line_start = s.rfind('\n', 0, idx) + 1
open(p, 'w', encoding='utf-8').write(s[:line_start])
print(f'已删除：从 `── 组 13:` 横幅行到 EOF（{len(s) - line_start} 字符）')
PY
)
  RCdel=$?
  show "python3 删除副本最后一个分组块（── 组 13: → EOF）" "$(printf '%s\nexit=%s' "$DEL_OUT" "$RCdel")"
  if [ "$RCdel" -ne 0 ]; then
    F_R1=1
  else
    RC2=$(run_c2 "$SBX"); OUT2=$(c2out)
    show "DOC_TRUTH_ROOT=<sbx> bash scripts/doc-system/check-doc-truth.sh（删组后）" "$(printf '%s\nexit=%s' "$OUT2" "$RC2")"
    [ "$RC2" -eq 1 ] || { echo "  ↳ 删组后期望 C2 exit 1，实际 $RC2"; F_R1=1; }
    printf '%s\n' "$OUT2" | grep -qE '❌.*C2 门禁组数' || { echo "  ↳ C2 未点名 C2 门禁组数 失败点"; F_R1=1; }
    cp "$PCC" "$SBX/scripts/pre-commit-check.sh"
    RC3=$(run_c2 "$SBX"); OUT3=$(c2out)
    show "DOC_TRUTH_ROOT=<sbx> bash scripts/doc-system/check-doc-truth.sh（恢复后）" "$(printf '%s\nexit=%s' "$OUT3" "$RC3")"
    [ "$RC3" -eq 0 ] || { echo "  ↳ 恢复后期望 exit 0，实际 $RC3"; F_R1=1; }
  fi
fi
[ "$F_R1" -eq 0 ] && ok "反例 R1 — 删组必红，恢复必绿" || no "反例 R1 — 删组必红，恢复必绿"

# ── R2: 文档声明改回 13 ⇒ C2 必红；恢复 ⇒ 绿 ───────────────────────────────
echo ""
echo "── 反例 R2: 文档声明 12→13 ⇒ C2 必红；恢复 ⇒ 绿（DS-6）──"
mksbx "$SBX"
RC=$(run_c2 "$SBX"); OUT=$(c2out)
show "DOC_TRUTH_ROOT=<sbx> bash scripts/doc-system/check-doc-truth.sh（基线）" "$(printf '%s\nexit=%s' "$OUT" "$RC")"
F_R2=0
if [ "$RC" -ne 0 ]; then
  echo "  ↳ 沙箱基线期望 exit 0，实际 $RC（前置 W1/W2/W3 未齐 ⇒ R2 暂无判别力）"
  F_R2=1
else
  MOD_OUT=$(python3 - "$SBX/AGENTS.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old, new = '12 组 pre-commit', '13 组 pre-commit'
if old not in s:
    print(f'ERROR: 副本 AGENTS.md 未找到 `{old}`（W3 未完成？）')
    sys.exit(3)
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print(f'已改：`{old}` → `{new}`（替换 1 处）')
PY
)
  RCmod=$?
  show "python3 把副本 AGENTS.md 首个 12 组 pre-commit → 13 组 pre-commit" "$(printf '%s\nexit=%s' "$MOD_OUT" "$RCmod")"
  if [ "$RCmod" -ne 0 ]; then
    F_R2=1
  else
    RC2=$(run_c2 "$SBX"); OUT2=$(c2out)
    show "DOC_TRUTH_ROOT=<sbx> bash scripts/doc-system/check-doc-truth.sh（改数后）" "$(printf '%s\nexit=%s' "$OUT2" "$RC2")"
    [ "$RC2" -eq 1 ] || { echo "  ↳ 改数后期望 C2 exit 1，实际 $RC2"; F_R2=1; }
    printf '%s\n' "$OUT2" | grep -qE '❌.*C2 门禁组数' || { echo "  ↳ C2 未点名 C2 门禁组数 失败点"; F_R2=1; }
    cp "$ROOT/AGENTS.md" "$SBX/AGENTS.md"
    RC3=$(run_c2 "$SBX"); OUT3=$(c2out)
    show "DOC_TRUTH_ROOT=<sbx> bash scripts/doc-system/check-doc-truth.sh（恢复后）" "$(printf '%s\nexit=%s' "$OUT3" "$RC3")"
    [ "$RC3" -eq 0 ] || { echo "  ↳ 恢复后期望 exit 0，实际 $RC3"; F_R2=1; }
  fi
fi
[ "$F_R2" -eq 0 ] && ok "反例 R2 — 改数必红，恢复必绿" || no "反例 R2 — 改数必红，恢复必绿"

# ── R3: 硬编码回潮（${GROUP_DONE} → 字面 12）⇒ 判据 4 同款断言必 >0 ──────
echo ""
echo "── 反例 R3: 汇总行硬编码回潮 ⇒ 判据 4 同款 grep 必 >0（DS-7）──"
cp "$PCC" "$SBX/scripts/pre-commit-check.sh"
MOD_OUT=$(python3 - "$SBX/scripts/pre-commit-check.sh" <<'PY'
import sys
p = sys.argv[1]
old, new = '全部 ${GROUP_DONE} 组通过', '全部 12 组通过'
lines = open(p, encoding='utf-8').read().splitlines(keepends=True)
for i, line in enumerate(lines):
    # 只改可执行汇总行（非注释）；注释里的自承引用不算回潮
    if old in line and not line.lstrip().startswith('#'):
        lines[i] = line.replace(old, new, 1)
        open(p, 'w', encoding='utf-8').write(''.join(lines))
        print(f'已改第 {i + 1} 行（可执行汇总行）：`{old}` → `{new}`')
        break
else:
    print(f'ERROR: 副本未找到可执行的 `{old}`（W1 未完成？）')
    sys.exit(3)
PY
)
RCmod=$?
show "python3 把副本汇总行改为字面 12" "$(printf '%s\nexit=%s' "$MOD_OUT" "$RCmod")"
F_R3=0
if [ "$RCmod" -ne 0 ]; then
  F_R3=1
else
  N_R3=$(grep -cE '全部 [0-9]+ 组通过' "$SBX/scripts/pre-commit-check.sh" 2>/dev/null | tr -d '\n\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
  HITS_R3=$(grep -nE '全部 [0-9]+ 组通过' "$SBX/scripts/pre-commit-check.sh" 2>/dev/null | tr -d '\r')  # swallow-ok: 测试内受控 grep（结果由计数/断言兜底）
  show "grep -cE '全部 [0-9]+ 组通过' <R3 副本>（判据 4 同款断言）" "$N_R3"
  show "grep -nE '全部 [0-9]+ 组通过' <R3 副本>（命中原文）" "$HITS_R3"
  [ "$N_R3" -gt 0 ] || { echo "  ↳ 期望 >0（自证必须捕获回潮），实际 $N_R3"; F_R3=1; }
  # 参考（不判红）：W2 的 C2 硬断言是否独立捕获
  RC_C2_R3=$(run_c2 "$SBX")
  show "（参考·不判红）C2 对 R3 副本 exit=$RC_C2_R3" "exit=$RC_C2_R3"
fi
cp "$PCC" "$SBX/scripts/pre-commit-check.sh"
[ "$F_R3" -eq 0 ] && ok "反例 R3 — 硬编码回潮必被捕获" || no "反例 R3 — 硬编码回潮必被捕获"

# ═══════════════════════════════════════════════════════════════════════════════
# D. 汇总（固定格式；三态退出码）
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
if [ "$SIGNAL_ZERO" -ne 0 ]; then
  echo "  ❌ [E_SIGNAL_ZERO] 新口径横幅数=0：信号量==0，禁把「看不见」当「没问题」 ⇒ exit 2"
  exit 2
fi
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ gate-count-acceptance 未通过（$FAIL 项失败）"
  exit 1
fi
echo "  Status: ✅ gate-count-acceptance 全部通过（自验结论；通过判定归 L1/K3）"
exit 0
