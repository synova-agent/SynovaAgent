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

# ── 边界（Lead 裁 2026-10-07，**下界语义**）: scan >= FACE-TOTAL 为通过；scan < FACE-TOTAL（净删除）⇒ 红 ──
#   ⚠️ 为什么不是「相等/贴边」: 相等会让**任何新增测试的 PR 都必须改中央基线文件** ⇒ 那是登记制的更糟形态
#      （写集冲突源）。故棘轮只做**下界**：新增不红、净删除红。
#   ⚠️ 代价（如实登记，不假装能抓）: 净零变换（删 1 个 + 加 1 个）**不可检测**——这是「不做逐条登记」的必然代价。
#      生产实证: #1259 新增 3 个测试 ⇒ scan 141→144 ⇒ 下界语义下**不红**（旧贴边断言在此必红）。
FLR_REAL="$(bash "$SUT" --face-total)"
SCAN_REAL="$(bash "$SUT" --scan | grep -c . || true)"
if [ -n "$FLR_REAL" ] && [ "$SCAN_REAL" -ge "$FLR_REAL" ]; then
  ok "边界: 真仓下界语义成立（scan=${SCAN_REAL} >= FACE-TOTAL=${FLR_REAL}；余量 $((SCAN_REAL - FLR_REAL)) 为新增所致，非判据）"
else
  no "边界: 真仓净删除（scan=${SCAN_REAL} < FACE-TOTAL=${FLR_REAL}）⇒ 应红；或下界缺失（FLR='${FLR_REAL}'）"
fi

# ── 边界（贴边态）: floor == scan 时删 1 个 ⇒ 必红（M2c 用 floor 高 1 的形态，覆盖不到本边界）──
R6="$(mkfix 2 none)"
rm -f "$R6/tests/control-tower/bb.test.sh"
OUT="$(run_in "$R6" --list)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q 'FACE-TOTAL'; then
  ok "边界: 贴边态（floor 2 / scan 2→删 1）⇒ exit 1（删 1 个即红）"
else
  no "边界: 贴边态删 1 未红（rc=${rc}）⇒ 棘轮有静默余量"
fi

# ── 成本登记（Lead 裁，2026-10-07 表述修正）: **≤ 当前余量 (scan − FACE-TOTAL) 的净删除不可检测** ──
#   净零变换（删 1 + 加 1）只是该代价的最常见形态；一般形态 = 任何「净删除 ≤ slack」的变更。
R7="$(mkfix 2 none)"
rm -f "$R7/tests/control-tower/aa.test.sh"; printf '#!/bin/bash\n' > "$R7/tests/control-tower/zz.test.sh"
OUT="$(run_in "$R7" --list)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q 'zz.test.sh'; then
  ok "成本登记: 净零变换（删 aa / 加 zz ⇒ scan 不变 ≤ 余量）判 rc=0 —— **≤ 余量的净删除不可检测**（已知代价）"
else
  no "成本登记用例异常: rc=${rc}（下界语义下净零变换应为 rc=0）"
fi

# ── #1227 跟进件: 余量上限 SLACK-CAP（贴上限 ⇒ 绿；超限 ⇒ 红）──
mc() {  # $1 = floor ; $2 = cap
  local d="$TMPD/slack-$1-$2"; rm -rf "$d"; mkdir -p "$d/tests/control-tower" "$d/scripts/control-tower"
  printf '#!/bin/bash\n' > "$d/tests/control-tower/aa.test.sh"
  printf '#!/bin/bash\n' > "$d/tests/control-tower/bb.test.sh"
  printf '#!/bin/bash\n' > "$d/tests/control-tower/cc.test.sh"
  { printf '# FACE-TOTAL=%s\n' "$1"; [ -n "$2" ] && printf '# SLACK-CAP=%s\n' "$2"; printf '# ═══ REGISTRY-BASELINE（夹具）═══\n'; } > "$d/scripts/control-tower/gate-integrity-baseline.txt"
  printf '%s' "$d"
}
R8="$(mc 2 1)"; OUT="$(run_in "$R8" --list)"; rc=$?
if [ "$rc" -eq 0 ]; then ok "余量上限: slack=1 ≤ SLACK-CAP=1 ⇒ rc=0（贴上限绿）"; else no "余量上限: 贴上限被判红（rc=${rc}）"; fi
R9="$(mc 2 0)"; OUT="$(run_in "$R9" --list)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q 'SLACK-CAP'; then
  ok "余量上限: slack=1 > SLACK-CAP=0 ⇒ rc=1 且点名 SLACK-CAP（超限红）"
else
  no "余量上限: 超限未红（rc=${rc}）"
fi
# 真仓: 余量可见 + 不超上限
SL_REAL="$(bash "$SUT" --slack)"; CAP_REAL="$(bash "$SUT" --slack-cap)"
if [ -n "$SL_REAL" ] && [ "$SL_REAL" -le "$CAP_REAL" ]; then
  ok "余量可见: 真仓 slack=${SL_REAL} ≤ SLACK-CAP=${CAP_REAL}（动态打印在 --list stderr）"
else
  no "余量可见: 真仓 slack='${SL_REAL}' vs cap='${CAP_REAL}'（超限或缺值）"
fi

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
# 只计**取数执行点**（`SEALED_LIST="$(bash … --list)"`）——生成物块/漂移提示文本里的命令串不算
N_DISC="$(grep -cF 'SEALED_LIST="$(bash scripts/control-tower/sealed-tests.sh --list)"' "$CI" || true)"
[ "$N_DISC" -eq 2 ] && ok "接线: ci.yml 两条腿均调用发现制（2 处）" || no "接线: 发现制调用点 = ${N_DISC}（应 2）"
if grep -qE '^\s+tests/[A-Za-z0-9_./-]+\.test\.(sh|py)[;]? do$' "$CI"; then
  no "接线: ci.yml 仍存字面密封清单（双真相源）"
else
  ok "接线: ci.yml 已无字面密封清单（单源）"
fi

# ═══ D1227（卡 #1300）: 越线者付账 ═══════════════════════════════════════════════
# 沙箱 = **真 git 仓**（base 侧由 ref 树计数 ⇒ 必须能 git ls-tree）；PR 侧 = 工作树。
mkgitfix() {   # $1=base 侧测试数 $2=工作树测试数 $3=FLOOR $4=CAP $5=载体行（空=无）
  local nb="$1" nw="$2" floor="$3" cap="$4" carrier="$5"
  local root="$TMPD/cross-$nb-$nw-$floor-$cap-$(printf '%s' "$carrier" | tr -cd '0-9')"
  rm -rf "$root"; mkdir -p "$root/tests/control-tower" "$root/scripts/control-tower"
  ( cd "$root" && git init -q && git config user.email t@e.com && git config user.name t ) >/dev/null 2>&1
  local i=1
  while [ "$i" -le "$nb" ]; do printf '#!/bin/bash\n' > "$root/tests/control-tower/b$i.test.sh"; i=$((i+1)); done
  { printf '# FACE-TOTAL=%s\n' "$floor"; printf '# SLACK-CAP=%s\n' "$cap";     [ -n "$carrier" ] && printf '# INHERITED-OVER-CAP-SINCE=%s\n' "$carrier";     printf '# ═══ REGISTRY-BASELINE（夹具）═══\n'; } > "$root/scripts/control-tower/gate-integrity-baseline.txt"
  ( cd "$root" && git add -A && git commit -qm base ) >/dev/null 2>&1
  # PR 侧 = 工作树（可能多于 base）
  local j=$((nb+1))
  while [ "$j" -le "$nw" ]; do printf '#!/bin/bash\n' > "$root/tests/control-tower/w$j.test.sh"; j=$((j+1)); done
  printf '%s' "$root"
}
cli() {  # $1=root $2=SYNO_BASE_REF（空=不给）
  local root="$1" base="$2"
  if [ -n "$base" ]; then
    ( cd "$root" && SYNO_BASE_REF="$base" bash "$SUT" --list --root "$root" 2>&1 )
  else
    ( cd "$root" && env -u SYNO_BASE_REF bash "$SUT" --list --root "$root" 2>&1 )
  fi
}

# ① 越线红: base_slack ≤ CAP 且 pr_slack > CAP
C1="$(mkgitfix 10 13 8 2 "")"          # base_slack=2 ≤ 2；pr_slack=5 > 2
OUT="$(cli "$C1" HEAD)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q '本 PR 使余量越线'; then
  ok "越线红: base_slack ≤ CAP ∧ pr_slack > CAP ⇒ 红（点名『本 PR 使余量越线』）"
else
  no "越线红未生效（rc=${rc}）：$(printf '%s\n' "$OUT" | grep -m1 '余量' | cut -c1-70)"
fi
# ② 反例（卡面必须）: 纯继承 over-cap ⇒ **不得红**（只 warning）
C2="$(mkgitfix 13 13 8 2 "")"          # base_slack=5 > 2；工作树同值 ⇒ 未越线
OUT="$(cli "$C2" HEAD)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q '::warning title=sealed-ratchet::'; then
  ok "反例: 纯继承 over-cap main ⇒ **不红**（rc=0）且出 ::warning（本卡要解决的病）"
else
  no "反例失败: 纯继承仍判红或未告警（rc=${rc}）"
fi
if printf '%s\n' "$OUT" | grep -q 'INHERITED-OVER-CAP-SINCE='; then
  ok "载体缺失: 打印**可直接粘贴**的登记行（且不自动写台账）"
else
  no "载体缺失时未打印可粘贴行"
fi
# ③ 载体超期 ⇒ 升级为红
C3="$(mkgitfix 13 13 8 2 "2000-01-01")"
OUT="$(cli "$C3" HEAD)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q '升级为红'; then
  ok "载体超期（2000-01-01 > 14 天）⇒ 升级为红"
else
  no "载体超期未升级为红（rc=${rc}）"
fi
# ④ 未给 base ⇒ 显式打印「不判越线」+ 退化现状语义（禁静默）
C4="$(mkgitfix 13 13 8 2 "")"
OUT="$(cli "$C4" "")"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q '未给 base'; then
  ok "未给 base ⇒ 显式打印『不判越线』并退化现状语义（rc=1，禁静默）"
else
  no "未给 base 路径未显式说明（rc=${rc}）"
fi
# ⑤ 变异体（同一次运行测量）: 把 base 侧计数换掉 ⇒ 反例应变成越线 ⇒ 夹具对"跨运行比较"回归有判别力
MUT="$TMPD/sealed-mutant.sh"
awk '{ if ($0 ~ /^scan_face_at\(\)/) { print "scan_face_at() { printf \"%s\" \"0\"; }"; skip=1; next } if (skip==1 && $0 ~ /^}/) { skip=0; next } if (skip==1) next; print }' "$SUT" > "$MUT" 2>/dev/null
if ! bash -n "$MUT" >/dev/null 2>&1; then
  no "变异体生成失败（awk 抽取 scan_face_at 出错）"
else
  OUT_M="$( cd "$C2" && SYNO_BASE_REF=HEAD bash "$MUT" --list --root "$C2" 2>&1 )"; rc_m=$?
  if [ "$rc_m" -eq 1 ] && printf '%s\n' "$OUT_M" | grep -q '本 PR 使余量越线'; then
    ok "变异体: base 侧计数被替换（等价『跨运行/外部存数』）⇒ 反例变越线 ⇒ 夹具能分辨该退化"
  else
    no "变异体未生效（rc=${rc_m}）—— 反例未能暴露『base 侧测量退化』"
  fi
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
