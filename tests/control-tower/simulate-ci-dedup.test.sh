#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# simulate-ci-dedup.test.sh — D1061/PR-A: N1 嵌套全量重跑消解（判别性夹具）
#
# 靶心: CI windows CT 腿 1619s 中 simulate-ci.test.sh 占 1051s（65%）——
#   该测试调 simulate-ci.sh 3 次 × 每次重跑 ci.yml 提取的 44 条密封测试 = 嵌套 132 次内层执行，
#   而外层 CI job 早已逐条跑同一份清单 → 纯重复。
#
# 覆盖矩阵（铁律 48 三路径 + 变异体）:
#   正常  — **本地**（无 GITHUB_ACTIONS/CI）：内层执行数 = 全量条数（本地全量语义零损）
#   修法  — **CI 环境**：内层执行数 = **0**（本卡核心判据）
#   降级  — CI 内跳过必须**显式**：stderr 打原因 + degraded-events.log 落 N1 事件（铁律 11）
#   覆盖缝 — SYNO_SIM_NESTED=full 在 CI 下强制全量；非法值 fail-closed 按 full
#   三态  — CI 内红桩仍 exit 1（跳过不吞业务失败）；缺失桩仍 exit 2
#   变异体 — 删掉跳过分支（if false）→ 「CI 内层执行数 = 0」断言必红
# 沙箱: mktemp -d 合成 git 仓（计数桩测试）+ 真实脚本；另对**真实仓库**做端到端计时判据
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# 注入缝（证据用）: SYNO_SIM_BIN 指向变异体副本 → 本夹具应在「CI 内层执行数 = 0」处**变红**
SIM="${SYNO_SIM_BIN:-$REPO/scripts/control-tower/simulate-ci.sh}"
CIY="$REPO/.github/workflows/ci.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
nlines() { printf '%s\n' "${1:-}" | grep -c . || true; }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

echo "=== D1061/PR-A: simulate-ci N1 嵌套消解 ==="

# ── 接线 ──
[ -x "$SIM" ] && ok "simulate-ci.sh 存在且可执行" || no "脚本缺失/不可执行"
grep -q "simulate-ci.test.sh" "$CIY" && ok "接线: ci.yml 密封清单含 simulate-ci.test.sh（外层 job 逐条跑同源清单）" || no "ci.yml 未含 simulate-ci.test.sh"
grep -q 'scripts/control-tower/simulate-ci.sh' "$REPO/tests/control-tower/simulate-ci.test.sh" \
  && ok "接线: 真实调用方 tests/control-tower/simulate-ci.test.sh 指向本脚本（#868 占用中，本卡不改它）" \
  || no "真实调用方路径未指向本脚本"

# ── 沙箱: 计数桩测试 ──
SB="$TMPD/sb"; CNT="$TMPD/count.txt"; DEG="$TMPD/deg.log"
mkdir -p "$SB/.github/workflows" "$SB/tests/control-tower"
cat > "$SB/.github/workflows/ci.yml" <<'YML'
jobs:
  control-tower-tests:
    steps:
      - run: |
          FAIL=0
          for t in \
            tests/control-tower/dd-a.test.sh \
            tests/control-tower/dd-b.test.sh; do
            echo "── $t"
          done
YML
for n in a b; do
  cat > "$SB/tests/control-tower/dd-$n.test.sh" <<EOF
#!/bin/bash
echo "ran dd-$n" >> "\${DD_COUNT_FILE:?}"
exit 0
EOF
done
git -C "$SB" init -q
git -C "$SB" -c user.name=t -c user.email=t@t add -A
git -C "$SB" -c user.name=t -c user.email=t@t commit -qm base
git -C "$SB" update-ref refs/remotes/origin/main HEAD
STUB="$TMPD/green.sh"; printf '#!/bin/bash\nexit 0\n' > "$STUB"
RED="$TMPD/red.sh"; printf '#!/bin/bash\necho "❌ 模拟 CI 差异错误"\nexit 1\n' > "$RED"

runsb() {  # $1=计数文件 $2=桩 ；其余经环境传入
  ( cd "$SB" && DD_COUNT_FILE="$1" SYNO_SIM_PRECOMMIT="$2" SYNO_SIM_DEGRADED_LOG="$DEG" bash "$SIM" )
}
runsb_local() {  # 同 runsb，但屏蔽 CI 标记（模拟"开发者本机跑"的本地语义）
  ( cd "$SB" && unset GITHUB_ACTIONS CI \
    && DD_COUNT_FILE="$1" SYNO_SIM_PRECOMMIT="$2" SYNO_SIM_DEGRADED_LOG="$DEG" bash "$SIM" )
}

# ── 正常: 本地（无 CI 标记）→ 内层执行 = 全量 2 条（本地全量语义零损）──
: > "$CNT"; : > "$DEG"
OUT=$(runsb_local "$CNT" "$STUB" 2>&1); RC=$?
N=$(grep -c . "$CNT" 2>/dev/null || true)
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 2 ] \
  && ok "正常: 本地（无 CI 标记）→ 内层执行 ${N}/2 条 = 全量语义保留" \
  || no "本地应跑 2 条内层测试（rc=$RC 实跑 ${N:-0} 条）"

# ── 修法: CI 环境 → 内层执行 = 0 ──
: > "$CNT"; : > "$DEG"
OUT=$(GITHUB_ACTIONS=true runsb "$CNT" "$STUB" 2>&1); RC=$?
N=$(grep -c . "$CNT" 2>/dev/null || true)
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 0 ] \
  && ok "★ 修法: CI 环境（GITHUB_ACTIONS=true）→ 内层执行数 = ${N:-0}（本卡靶心判据）" \
  || no "CI 环境应 0 条内层执行（rc=$RC 实跑 ${N:-0} 条）"

: > "$CNT"
OUT=$(CI=true runsb "$CNT" "$STUB" 2>&1); RC=$?
N=$(grep -c . "$CNT" 2>/dev/null || true)
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 0 ] && ok "★ 修法: CI=true 变体 → 内层执行数 = ${N:-0}" || no "CI=true 应 0 条（rc=$RC 实跑 ${N:-0} 条）"

# ── 降级显式性（铁律 11）: 原因打印 + degraded 日志 ──
echo "$OUT" | grep -q "显式跳过" && ok "降级显式: stderr 打印跳过原因（非静默）" || no "跳过未打印原因（静默风险）"
grep -q '"code":"N1-ci-nested-full-suite-skipped"' "$DEG" && ok "降级显式: degraded-events.log 落 N1 事件" || no "degraded 日志缺 N1 事件"

# ── 覆盖缝: SYNO_SIM_NESTED=full 在 CI 下强制全量 ──
: > "$CNT"
OUT=$(GITHUB_ACTIONS=true SYNO_SIM_NESTED=full runsb "$CNT" "$STUB" 2>&1); RC=$?
N=$(grep -c . "$CNT" 2>/dev/null || true)
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 2 ] && ok "覆盖缝: CI + SYNO_SIM_NESTED=full → 强制全量 ${N}/2 条" || no "full 覆盖缝失效（rc=$RC ${N:-0} 条）"

# ── 覆盖缝: 非法 SYNO_SIM_NESTED → fail-closed 按 full（**绝不静默 skip**）──
# A6 覆盖缺口补断言（verifier 2026-09-29 复核发现：头注释声明该语义但夹具内无对应断言）
: > "$CNT"
OUT=$(GITHUB_ACTIONS=true SYNO_SIM_NESTED=bogus runsb "$CNT" "$STUB" 2>&1); RC=$?
N=$(grep -c . "$CNT" 2>/dev/null || true)
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 2 ] && echo "$OUT" | grep -q "非法" \
  && ok "覆盖缝: SYNO_SIM_NESTED 非法值 → fail-closed 按 full（内层 ${N}/2 条）+ 显式点名（不静默 skip）" \
  || no "非法值应 fail-closed 全量（rc=$RC 实跑 ${N:-0} 条、stderr 无『非法』点名）"

# ── 三态: CI 内红桩仍 exit 1（跳过不吞业务失败）──
OUT=$(GITHUB_ACTIONS=true runsb "$TMPD/c2.txt" "$RED" 2>&1); RC=$?
[ "$RC" -eq 1 ] && echo "$OUT" | grep -q "模拟失败" && ok "三态: CI 内红桩仍 exit 1 + 修复指引（跳过不吞失败）" || no "CI 内红桩应 exit 1（实际 rc=${RC}）"
OUT=$(GITHUB_ACTIONS=true runsb "$TMPD/c3.txt" "$TMPD/missing.sh" 2>&1); RC=$?
[ "$RC" -eq 2 ] && ok "三态: CI 内 pre-commit 缺失仍 exit 2 显式降级" || no "CI 内缺失桩应 exit 2（实际 rc=${RC}）"

# ── 真实仓库端到端: CI 模式下真实脚本必须秒级返回且零内层输出 ──
T0=$(date +%s)
OUT=$(cd "$REPO" && GITHUB_ACTIONS=true SYNO_SIM_PRECOMMIT="$STUB" SYNO_SIM_DEGRADED_LOG="$TMPD/deg-real.log" bash "$SIM" 2>&1); RC=$?
T1=$(date +%s); DUR=$((T1 - T0))
INNER=$(printf '%s\n' "$OUT" | grep -c '✅ tests/' || true)
[ "$RC" -eq 0 ] && [ "${INNER:-0}" -eq 0 ] && [ "$DUR" -lt 20 ] \
  && ok "真实仓库端到端: CI 模式 ${DUR}s、内层 ✅ 行 ${INNER} 个（改前为 3×44=132 次内层执行）" \
  || no "真实仓库 CI 模式异常（rc=$RC 内层 ${INNER:-0} 行 耗时 ${DUR}s）"

# ══════════ 变异体: 删掉跳过分支 → 「CI 内层执行数 = 0」必红 ══════════
echo ""
echo "── 变异体（判别力自证）──"
if [ -z "$PYBIN" ]; then
  no "PYBIN 不可用 —— 变异体无法构造，显式失败而非静默跳过"
else
  MUT="$TMPD/mut.sh"; cp "$SIM" "$MUT"
  "$PYBIN" - "$MUT" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); t = p.read_text(encoding="utf-8")
old = 'if [ "$SKIP_NESTED" -eq 1 ]; then'
assert old in t, "MUT anchor missing"
p.write_text(t.replace(old, 'if false; then  # MUTATION: 跳过分支被删', 1), encoding="utf-8")
PY
  if cmp -s "$SIM" "$MUT"; then
    no "变异体锚点未命中（脚本结构已变，夹具须同步）"
  else
    : > "$CNT"
    ( cd "$SB" && DD_COUNT_FILE="$CNT" SYNO_SIM_PRECOMMIT="$STUB" SYNO_SIM_DEGRADED_LOG="$TMPD/deg-mut.log" GITHUB_ACTIONS=true bash "$MUT" ) >/dev/null 2>&1
    MN=$(grep -c . "$CNT" 2>/dev/null || true)
    [ "${MN:-0}" -eq 2 ] \
      && ok "变异体被检出: 删跳过分支 → CI 内层执行 ${MN} 条 ≠ 0（靶心断言必红）" \
      || no "变异体未被检出（CI 内层 ${MN:-0} 条）—— 靶心断言无判别力"
  fi

  # 变异体②: 非法值改判**静默 skip** → 「非法值 fail-closed 按 full」断言必红
  MUT3="$TMPD/mut3.sh"; cp "$SIM" "$MUT3"
  "$PYBIN" - "$MUT3" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); t = p.read_text(encoding="utf-8")
old = 'fail-closed 按 full 执行${RESET}" >&2; SKIP_NESTED=0 ;;'
assert old in t, "MUT3 anchor missing"
p.write_text(t.replace(old, '非法值静默 skip${RESET}" >&2; SKIP_NESTED=1 ;;', 1), encoding="utf-8")
PY
  if cmp -s "$SIM" "$MUT3"; then
    no "变异体②锚点未命中（脚本结构已变，夹具须同步）"
  else
    : > "$CNT"
    ( cd "$SB" && DD_COUNT_FILE="$CNT" SYNO_SIM_PRECOMMIT="$STUB" SYNO_SIM_DEGRADED_LOG="$TMPD/deg-mut3.log" GITHUB_ACTIONS=true SYNO_SIM_NESTED=bogus bash "$MUT3" ) >/dev/null 2>&1
    M3N=$(grep -c . "$CNT" 2>/dev/null || true)
    [ "${M3N:-0}" -eq 0 ] \
      && ok "变异体②被检出: 非法值改判静默 skip → 内层 0 条 ≠ 期望 2 条（fail-closed 断言必红）" \
      || no "变异体②未被检出（内层 ${M3N:-0} 条）—— fail-closed 断言无判别力"
  fi
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
