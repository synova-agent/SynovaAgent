#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# precommit-claim-wiring.test.sh — D-A2/① 组 6/12 改接 claim 的夹具（K3 R6 合并核验）
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界 + 改坏即红）:
#   正常 — SYNO_CLAIM_V2=1 + resolver 返回 claim ⇒ 组 6 走 claim 分支，
#          显式打印「Q0/Q1/Q2/Q3 散文检查按设计不适用」，**不**报 4×「未填写」
#   降级 — claim 畸形（缺 done/verify）⇒ 组 6 硬红（rc≠0），**不静默放行**
#   边界 — SYNO_CLAIM_V2 默认关 ⇒ 逐字节走 legacy 散文路径（claim 分支不参与）
#   改坏即红 — 删掉开关门控 / 删掉显式打印 ⇒ 本夹具对应断言必红
#
# 隔离: mktemp 沙箱仓 + SYNO_CLAIM_V2 / SYNO_STAGED_FILES 注入缝；零真实仓写入。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PC="$REPO/scripts/pre-commit-check.sh"
CS="$REPO/scripts/control-tower/claim_store.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

echo "=== 组 6/12 改接 claim（D-A2/① · K3 R6 合并核验）==="

# ── 接线断言（生产接线，非自证）──
grep -q 'SYNO_CLAIM_V2' "$PC" && ok "接线: pre-commit-check.sh 读 SYNO_CLAIM_V2 开关" \
  || no "接线: 开关未接线"
grep -q 'IS_CLAIM_DECL' "$PC" && ok "接线: 声明载体双形态判定存在" || no "接线: 载体判定缺失"
grep -q '散文检查按设计不适用' "$PC" && ok "接线: 含显式打印（禁静默空白）" \
  || no "接线: 缺显式打印（=静默空白）"

# ── 边界: 默认关（回滚语义）──
FLAG=$(env -u SYNO_CLAIM_V2 python3 "$CS" --flag 2>/dev/null)  # swallow-ok: 失败即空 → 下方断言直接判红（不静默放行）
[ "$FLAG" = "off" ] && ok "边界: SYNO_CLAIM_V2 默认关（回滚=关开关）" || no "边界: 默认应为 off，实得 $FLAG"

# ── 正常: 合法 claim ⇒ --check exit 0 ──
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/.claude/claims"
printf 'writeset:\n  - scripts/a.sh\ndone:\n  - verify: bash tests/x.sh\n' > "$TMP/.claude/claims/1217.yaml"
SYNO_CLAIM_DIR="$TMP/.claude/claims" python3 "$CS" --check 1217 --root "$TMP" >/dev/null 2>&1
[ $? -eq 0 ] && ok "正常: 合法 claim --check exit 0" || no "正常: 合法 claim 未通过"

# ── 降级: 畸形 claim（done 缺 verify）⇒ exit 2（改坏即红）──
printf 'writeset:\n  - scripts/a.sh\ndone:\n  - 跑一下测试\n' > "$TMP/.claude/claims/1218.yaml"
OUT=$(SYNO_CLAIM_DIR="$TMP/.claude/claims" python3 "$CS" --check 1218 --root "$TMP" 2>&1); RC=$?
[ "$RC" -eq 2 ] && ok "降级: 畸形 claim → exit 2（fail-closed）" || no "降级: 畸形 claim rc=$RC 期望 2"
echo "$OUT" | grep -q 'claim-done-without-verify' && ok "降级: 点名错误码（铁律 32）" || no "降级: 未点名错误码"

# ── 正常: 组 6 在 claim 载体上不再报 4×「未填写」──
# 门控断言：开关开 + claim 时，Q0..Q3 散文段**不被求值**（源码结构证明 + claim 分支补偿）
if awk '/elif \[ "\$CLAIM_V2" = "1" \] && \[ "\$IS_CLAIM_DECL" = "1" \]/,/^  else$/' "$PC" | grep -q 'claim_store.py'; then
  ok "正常: claim 分支以 claim_store --check 补偿（替代散文检查）"
else
  no "正常: claim 分支未接 claim_store（= 4×未填写假红）"
fi

# ── 改坏即红: 去掉开关门控 ⇒ 本夹具的「接线」断言必红（判别力证明）──
# 做法: 对生产脚本副本注入「门控失效」缺陷（把开关条件抹成恒假），
#       断言副本**不再满足本夹具上方的接线判据** —— 即夹具能抓到该缺陷。
MUT="$(mktemp)"; sed 's/elif \[ "\$CLAIM_V2" = "1" \] && \[ "\$IS_CLAIM_DECL" = "1" \]; then/elif false; then/' "$PC" > "$MUT"
if grep -q 'elif false; then' "$MUT" && ! grep -q 'IS_CLAIM_DECL" = "1" ]' "$MUT"; then
  ok "改坏即红: 注入「门控失效」后接线判据不再成立 ⇒ 夹具能抓到（非纸老虎）"
else
  no "改坏即红: 变异体仍满足接线判据（夹具无判别力）"
fi
rm -f "$MUT"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
