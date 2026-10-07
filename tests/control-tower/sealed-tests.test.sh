#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# sealed-tests-discovery.test.sh — 密封面「发现制」清单提供者判别性夹具（D-F/② · 卡 #1227）
#
# 覆盖矩阵（铁律 48 三路径 + 判别性 + 变异体）:
#   正常 — 真仓库 --scan/--quarantine/--list 三出口自洽；执行集 = 扫描 − 隔离
#   边界 — 面内新增测试（零登记）⇒ 自动进入 --list（新测试零登记自动纳入）
#   降级 — 仓根无 tests/ ⇒ exit 2（fail-closed，绝不返回空清单当"没测试要跑"）
#   失败 — FACE-TOTAL 高于实况（删测试未下调）⇒ --list exit 1 且点名
#   失败 — QUARANTINE-TOTAL 低于实况（新增隔离未上调）⇒ --list exit 1 且点名
#   失败 — 隔离条目指向不存在的文件 ⇒ --list exit 1 且点名
#   判别 — 变异体: 把 FACE-TOTAL 下调到实况 ⇒ 同一删除场景转绿（证明棘轮是判据而非恒红）
# 沙箱: mktemp 合成仓（只造 tests/ + 台账），不写真实仓库。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$REPO/scripts/control-tower/sealed-tests.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D-F/②: sealed-tests.sh 发现制夹具 ==="
[ -f "$SUT" ] && ok "被测脚本存在" || { no "被测脚本缺失: $SUT"; echo "结果: $PASS 通过, $FAIL 失败"; exit 1; }

# ── 正常: 真仓库三出口自洽 ──
SCAN_N="$(bash "$SUT" --scan | wc -l | tr -d ' ')"
QUAR_N="$(bash "$SUT" --quarantine | wc -l | tr -d ' ')"
LIST_N="$(bash "$SUT" --list | wc -l | tr -d ' ')"
bash "$SUT" --list >/dev/null 2>&1 && ok "正常: 真仓库 --list exit 0" || no "正常: --list 非 0"
[ "$SCAN_N" -ge "$LIST_N" ] && [ "$QUAR_N" -ge 0 ] \
  && ok "正常: 扫描 ${SCAN_N} ≥ 执行 ${LIST_N}（隔离 ${QUAR_N}）" \
  || no "正常: 计数不自洽 scan=${SCAN_N} list=${LIST_N} quar=${QUAR_N}"
# 执行集 ⊆ 扫描集（逐条包含，非仅计数）
if comm -13 <(bash "$SUT" --scan | sort -u) <(bash "$SUT" --list | sort -u) | grep -q .; then
  no "正常: 执行集存在扫描集外的条目（发现制集合运算错误）"
else
  ok "正常: 执行集 ⊆ 扫描集"
fi
bash "$SUT" --face-total | grep -qE '^[0-9]+$' && ok "正常: --face-total 输出为整数" || no "正常: --face-total 非整数"

# ── 合成仓工厂: 造 tests/control-tower + 台账 ──
mkfix() {   # $1 = face-total 行内容（如 '3' 或 ''）; $2 = quarantine-total 行内容
  local d="$1_$2" root="$TMPD/fix-$1-$2"
  rm -rf "$root"; mkdir -p "$root/tests/control-tower" "$root/scripts/control-tower"
  printf '#!/bin/bash\n' > "$root/tests/control-tower/aa.test.sh"
  printf '#!/bin/bash\n' > "$root/tests/control-tower/bb.test.sh"
  [ "$1" != "none" ] && printf '# FACE-TOTAL=%s\n' "$1" > "$root/scripts/control-tower/gate-integrity-baseline.txt" \
                     || : > "$root/scripts/control-tower/gate-integrity-baseline.txt"
  [ "$2" != "none" ] && printf '# QUARANTINE-TOTAL=%s\n' "$2" >> "$root/scripts/control-tower/gate-integrity-baseline.txt"
  printf '# ═══ REGISTRY-BASELINE（夹具）═══\n' >> "$root/scripts/control-tower/gate-integrity-baseline.txt"
  printf '%s\n' "$root"
}
run_in() {  # $1 = root ; 其余 = 参数
  local root="$1"; shift
  bash "$SUT" "$@" --root "$root" 2>&1
}

# ── 边界: 面内新增（零登记）⇒ 自动纳入 ──
R1="$(mkfix 2 none)"
printf '#!/bin/bash\n' > "$R1/tests/control-tower/cc.test.sh"
OUT="$(run_in "$R1" --list)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q 'cc.test.sh'; then
  ok "边界: 面内新增零登记 ⇒ 自动进入执行集（发现制核心语义）"
else
  no "边界: 面内新增未自动纳入（rc=${rc}）"
fi

# ── 失败: 删测试未下调 FACE-TOTAL（实况 2 < 下界 3）⇒ 红 ──
R2="$(mkfix 3 none)"
OUT="$(run_in "$R2" --list)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q 'FACE-TOTAL'; then
  ok "失败: 面实况 < FACE-TOTAL ⇒ exit 1 且点名棘轮"
else
  no "失败: 删测试棘轮未生效（rc=${rc}）"
fi
# 判别性变异体: 同场景 + 同批下调下界 ⇒ 绿（棘轮是判据，非恒红）
R3="$(mkfix 2 none)"
OUT="$(run_in "$R3" --list)"; rc=$?
[ "$rc" -eq 0 ] && ok "判别性: 同批下调 FACE-TOTAL ⇒ exit 0（下调通路可达）" || no "判别性: 下调后仍红（rc=${rc}）"

# ── 失败: 新增隔离未上调 QUARANTINE-TOTAL ⇒ 红 ──
R4="$(mkfix 2 0)"
printf '# FACE-TOTAL=2\n# QUARANTINE-TOTAL=0\n# ═══ REGISTRY-BASELINE（夹具）═══\ntests/control-tower/aa.test.sh\n' > "$R4/scripts/control-tower/gate-integrity-baseline.txt"
OUT="$(run_in "$R4" --list)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q 'QUARANTINE-TOTAL'; then
  ok "失败: 隔离条目 > 上界 ⇒ exit 1 且点名棘轮"
else
  no "失败: 隔离上界棘轮未生效（rc=${rc}）"
fi

# ── 失败: 隔离条目指向不存在的文件 ⇒ 红 ──
R5="$(mkfix 2 none)"
printf '# ═══ REGISTRY-BASELINE（夹具）═══\ntests/control-tower/ghost.test.sh\n' > "$R5/scripts/control-tower/gate-integrity-baseline.txt"
OUT="$(run_in "$R5" --list)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q '不存在的文件'; then
  ok "失败: 隔离台账幽灵条目 ⇒ exit 1 且点名"
else
  no "失败: 幽灵条目未判红（rc=${rc}）"
fi

# ── 降级: 仓根无 tests/ ⇒ exit 2（fail-closed，绝不空清单当"无测试"）──
EMPTY="$TMPD/empty"; mkdir -p "$EMPTY"
OUT="$(bash "$SUT" --list --root "$EMPTY" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'SEALED-TESTS'; then
  ok "降级: 仓根无 tests/ ⇒ exit 2 + stderr 留痕（fail-closed）"
else
  no "降级: 缺 tests/ 未 fail-closed（rc=${rc}）"
fi

# ── 接线: ci.yml 两腿均取发现制清单（不再有字面 for t in 清单）──
CI="$REPO/.github/workflows/ci.yml"
N_DISC="$(grep -c 'sealed-tests.sh --list' "$CI" || true)"
[ "$N_DISC" -eq 2 ] && ok "接线: ci.yml 两条腿均调用发现制（2 处）" || no "接线: 发现制调用点 = ${N_DISC}（应 2）"
if grep -qE '^\s+tests/[A-Za-z0-9_./-]+\.test\.(sh|py)[;]? do$' "$CI"; then
  no "接线: ci.yml 仍存字面密封清单（双真相源）"
else
  ok "接线: ci.yml 已无字面密封清单（单源）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
