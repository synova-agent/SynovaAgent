#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# sealed-runner-dispatch.test.sh — 密封面执行器「按扩展名分派」判别夹具（D-F/②-fix · 卡 #1227）
#
# 背景（Lead 裁 2026-10-07，缺陷 2）: 发现制执行器旧实现一律 `bash "$t"` ⇒ 面内 `.py` 夹具
#   必然 `import: command not found`（CI 实测 tests/control-tower/claim-identity-v2.test.py:40）。
#   修法 = ci.yml 步骤体内按扩展名分派（`.py` → python 三级探测；其余 → bash）。
#
# 判别方式（防"接线了≠被执行"）: 从 ci.yml 提取 `# SEALED-RUNNER-BEGIN/END` 标记段**真执行**——
#   删掉分派/改坏分派本夹具即红（物理判别，非 grep 静态判据）。
#
# 覆盖矩阵（铁律 48 三路径 + 判别性）:
#   正常 — `.py` 夹具经 python 执行（哨兵输出可见、rc 透传 0）
#   失败 — `.py` 夹具非零退出 ⇒ rc 透传（不吞）
#   边界 — `.sh` 夹具仍走 bash（未被分派改坏）
#   降级 — 无 python 解释器 ⇒ 显式 FAIL + ::error（fail-closed，不静默跳过）
#   判别 — 变异体: 用旧形态 `bash <py>` 直接跑同一夹具 ⇒ 必失败（证明分派是承重的）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI="$REPO/.github/workflows/ci.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D-F/②-fix: sealed runner 扩展名分派夹具 ==="

# ── 提取执行器段（真 step 正文，非副本）──
awk '/# SEALED-RUNNER-BEGIN/,/# SEALED-RUNNER-END/' "$CI" | sed 's/^ *//' > "$TMPD/runner.sh"
if [ -s "$TMPD/runner.sh" ] && grep -q 'SEALED_PYBIN' "$TMPD/runner.sh" && grep -q '\*\.py)' "$TMPD/runner.sh"; then
  ok "提取: 执行器段存在且含 .py 分派（${TMPD}/runner.sh）"
else
  no "提取: 未取到执行器分派段（step 名/缩进/标记变了？）"
fi

printf 'print("PYOK-SENTINEL")\n'                    > "$TMPD/ok.test.py"
printf 'import sys\nprint("PYFAIL")\nsys.exit(3)\n'  > "$TMPD/fail.test.py"
printf '#!/bin/bash\necho SHOK-SENTINEL\n'           > "$TMPD/ok.test.sh"

run_runner() {   # $1 = 被测文件 ; $2 = SEALED_PYBIN 注入值（默认三级探测结果）
  local t="$1" pybin="${2-python3}"
  ( t="$t"; SEALED_PYBIN="$pybin"; FAIL=0
    for _once in 1; do . "$TMPD/runner.sh"; done
    printf 'RC=%s FAIL=%s\n' "${_RC:-0}" "$FAIL" )
}

# ① 正常: .py 经 python 执行
OUT="$(run_runner "$TMPD/ok.test.py")"
if printf '%s' "$OUT" | grep -q 'RC=0' && grep -q 'PYOK-SENTINEL' /tmp/ct-out.log 2>/dev/null; then
  ok "正常: .py 夹具经 python 执行（哨兵输出可见，rc=0）"
else
  no "正常: .py 未被执行器正确分派（${OUT//$'\n'/ }）"
fi

# ② 失败: .py 非零退出 ⇒ rc 透传
OUT="$(run_runner "$TMPD/fail.test.py")"
if printf '%s' "$OUT" | grep -q 'RC=3'; then
  ok "失败: .py 非零退出 rc 透传（rc=3，不吞）"
else
  no "失败: .py 非零退出未透传（${OUT//$'\n'/ }）"
fi

# ③ 边界: .sh 仍走 bash
OUT="$(run_runner "$TMPD/ok.test.sh")"
if printf '%s' "$OUT" | grep -q 'RC=0' && grep -q 'SHOK-SENTINEL' /tmp/ct-out.log 2>/dev/null; then
  ok "边界: .sh 夹具仍走 bash（分派未改坏既有路径）"
else
  no "边界: .sh 夹具失败（${OUT//$'\n'/ }）"
fi

# ④ 降级: 无 python ⇒ 显式 FAIL（fail-closed）
OUT="$(run_runner "$TMPD/ok.test.py" "")"
if printf '%s' "$OUT" | grep -q 'FAIL=1' && printf '%s' "$OUT" | grep -q '缺 python 解释器'; then
  ok "降级: 缺 python ⇒ 显式 FAIL + 点名（fail-closed，不静默跳过）"
else
  no "降级: 缺 python 未 fail-closed（${OUT//$'\n'/ }）"
fi

# ⑤ 判别（变异体）: 旧形态 `bash <py>` ⇒ 必失败（证明"分派"是承重件）
if bash "$TMPD/ok.test.py" >/dev/null 2>&1; then
  no "判别: 旧形态 bash 竟然跑通 .py（则本分派非承重件，夹具无判别力）"
else
  ok "判别: 旧形态 bash 跑 .py 必失败 ⇒ 分派是承重件（修前形态可复现缺陷）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
