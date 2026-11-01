#!/usr/bin/env bash
# probe-role-config.test.sh — 配对测试（#1271 P2-2b；U7/CT-40）
# 判据: ① 靶已归一（无旧 grants/ 目录引用）② 真跑 --all 绿 ③ V1–V6 均有判定
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
P="$ROOT/scripts/control-tower/probe-role-config.ts"
PASS=0; FAIL=0; ok(){ PASS=$((PASS+1)); echo "  ✅ $1"; }; no(){ FAIL=$((FAIL+1)); echo "  ❌ $1"; }

echo "── 1. 靶归一（防回归 #505）──"
if grep -qF "extensions/presets/grants" "$P"; then no "仍引用旧靶 extensions/presets/grants"; else ok "无旧靶引用"; fi
grep -q "permissionGrants" "$P" && ok "靶=角色包 permissionGrants" || no "缺 permissionGrants 靶"

echo "── 2. 真跑 --all ──"
out="$(cd "$ROOT" && PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" npx tsx "$P" --all 2>&1)"; rc=$?
[ "$rc" = "0" ] && ok "退出码=0" || no "退出码=$rc（应 0）"
case "$out" in *"RESULT=PASS"*) ok "末行 RESULT=PASS";; *) no "缺 RESULT=PASS";; esac
for v in V1 V2 V3 V4 V5 V6; do
  case "$out" in *"$v "*) ok "$v 有判定";; *) no "$v 无判定";; esac
done

echo; echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"; [ "$FAIL" = "0" ] || exit 1
