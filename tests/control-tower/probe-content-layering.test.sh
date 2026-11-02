#!/usr/bin/env bash
# probe-content-layering.test.sh — 配对测试（#1271 P1-2；U7/CT-40）
# 判据: ① 不再引用已作废目录（裁 423）② 内容差异限定内容面（排除身份/层名）③ 真跑 dept-diff 绿
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
P="$ROOT/scripts/control-tower/probe-content-layering.ts"
PASS=0; FAIL=0; ok(){ PASS=$((PASS+1)); echo "  ✅ $1"; }; no(){ FAIL=$((FAIL+1)); echo "  ❌ $1"; }

echo "── 1. 判据面（防回归）──"
if grep -qF "extensions/knowledge-scope" "$P"; then no "仍引用已作废目录 extensions/knowledge-scope（裁 423）"; else ok "无作废目录引用"; fi
grep -q "function contentLeaves" "$P" && ok "内容差异限定内容面（contentLeaves）" || no "缺 contentLeaves 过滤"

echo "── 2. 真跑 dept-diff ──"
out="$(cd "$ROOT" && PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" npx tsx "$P" --case dept-diff 2>&1)"; rc=$?
[ "$rc" = "0" ] && ok "退出码=0" || no "退出码=$rc（应 0）"
case "$out" in *"RESULT=PASS"*) ok "末行 RESULT=PASS";; *) no "缺 RESULT=PASS";; esac
case "$out" in *"V2 内容不同"*) ok "V2 内容差异有牙";; *) no "V2 未判内容差异";; esac

echo; echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"; [ "$FAIL" = "0" ] || exit 1
