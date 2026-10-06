#!/bin/bash
# D313/D520 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# install-cto-gates.test.sh — D1163 装/卸器配对测试（U7/CT-40）
#
# 覆盖矩阵:
#   正常 — dry-run ⇒ 0 且**零写入**
#   前置 — profile 目录不存在 ⇒ 1；缺挂载点 cordis.patch.yml ⇒ 1，且都不落文件
#   真写 — --apply ⇒ hooks.json 落位 + 挂载块写入；幂等（重复 --apply 不重复挂载）
#   退出条件 — --uninstall ⇒ 登记点与挂载块清零（自繁殖对冲要求"可退出"）
# 沙箱: 全部落在 mktemp 的假 profile 里，**绝不触碰真实 profile 目录**
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INST="$REPO/scripts/control-tower/install-cto-gates.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== 装/卸器 install-cto-gates（D1163）==="
if [ ! -f "$INST" ]; then
  echo "  ❌ 安装脚本缺失: $INST"
  echo "结果: 0 通过, 1 失败"; exit 1
fi
ok "安装脚本存在"
bash -n "$INST" 2>/dev/null && ok "bash -n 语法通过" || no "bash -n 语法失败"

# ── 前置: profile 目录不存在 ⇒ exit 1，零写入 ──
OUT="$(bash "$INST" "$TMPD/nonexistent-profile" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "profile 目录不存在 ⇒ exit 1（前置不满足）" || no "应 exit 1，实际 ${rc}"

# ── 前置: 有 profile 但缺挂载点 ⇒ exit 1，零写入 ──
BAREP="$TMPD/bare-profile"; mkdir -p "$BAREP"
OUT="$(bash "$INST" "$BAREP" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "缺 cordis.patch.yml ⇒ exit 1" || no "应 exit 1，实际 ${rc}"
[ ! -e "$BAREP/hooks.json" ] && ok "前置不满足时不落任何文件" || no "前置不满足仍写了文件"

# ── dry-run: 完整前置 ⇒ exit 0 且零写入 ──
FAKEP="$TMPD/fake-profile"; mkdir -p "$FAKEP"
: > "$FAKEP/cordis.patch.yml"
OUT="$(bash "$INST" "$FAKEP" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "dry-run ⇒ exit 0" || no "dry-run 非 0（rc=${rc}）"
[ ! -e "$FAKEP/hooks.json" ] && [ ! -s "$FAKEP/cordis.patch.yml" ] \
  && ok "dry-run 零写入（未创建 hooks.json；挂载点仍为空）" \
  || no "dry-run 竟然写了文件——违约束"

# ── --apply 真写 ──
OUT="$(bash "$INST" "$FAKEP" --apply 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -f "$FAKEP/hooks.json" ] && grep -q "dsh-hooks-claude-code" "$FAKEP/cordis.patch.yml"; then
  ok "--apply ⇒ hooks.json 落位 + 挂载块写入"
else
  no "--apply 失败（rc=${rc}）: $(echo "$OUT" | tail -3 | tr '\n' ' ')"
fi
grep -q "gate-hook-entry.sh" "$FAKEP/hooks.json" 2>/dev/null \
  && ok "落地的 hooks.json 指向入口脚本（登记点已接线）" || no "登记点未接上入口脚本"

# ── 幂等 ──
bash "$INST" "$FAKEP" --apply >/dev/null 2>&1
NBLK="$(grep -c "D1163 CTO 侧双闸挂载" "$FAKEP/cordis.patch.yml" | tr -d ' \r\n')"
[ "${NBLK:-0}" -eq 1 ] && ok "重复 --apply 幂等: 挂载块不重复（计数 ${NBLK}）" || no "重复挂载（计数 ${NBLK:-0}）"
NENTRY="$(grep -c "gate-hook-entry.sh" "$FAKEP/hooks.json" | tr -d ' \r\n')"
[ "${NENTRY:-0}" -eq 2 ] && ok "hooks.json 两个登记点各一次（计数 ${NENTRY}）" || no "登记点计数异常（${NENTRY:-0}）"

# ── 卸载（退出条件一条命令可达）──
OUT="$(bash "$INST" "$FAKEP" --uninstall 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$FAKEP/hooks.json" ] && ! grep -q "dsh-hooks-claude-code" "$FAKEP/cordis.patch.yml"; then
  ok "--uninstall ⇒ 登记点与挂载块清零"
else
  no "卸载不干净（rc=${rc}）: $(echo "$OUT" | tail -3 | tr '\n' ' ')"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
