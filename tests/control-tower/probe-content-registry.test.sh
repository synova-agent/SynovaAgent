#!/usr/bin/env bash
# probe-content-registry.test.sh — 配对测试（#1271 P1-1；U7/CT-40）
# 判据: ① 判据里不再硬编码项数（防回归 #505/#304）② 不变式在场 ③ 探针真跑四段全绿
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
P="$ROOT/scripts/control-tower/probe-content-registry.ts"
PASS=0; FAIL=0; ok(){ PASS=$((PASS+1)); echo "  ✅ $1"; }; no(){ FAIL=$((FAIL+1)); echo "  ❌ $1"; }

echo "── 1. 禁硬编码项数（回归守卫）──"
if grep -qE '!== *[0-9]{1,3}' "$P"; then no "仍存在硬编码项数比较（!== N）"; else ok "无硬编码项数比较"; fi
grep -q '磁盘顶层目录数' "$P" && ok "含磁盘集不变式" || no "缺磁盘集不变式"

echo "── 2. 真跑（四段全绿）──"
out="$(cd "$ROOT" && PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" npx tsx "$P" 2>&1)"; rc=$?
[ "$rc" = "0" ] && ok "退出码=0" || no "退出码=$rc（应 0）"
case "$out" in *"CONTENT-REGISTRY-OK"*) ok "末行 CONTENT-REGISTRY-OK";; *) no "缺 CONTENT-REGISTRY-OK";; esac
case "$out" in *"failures=0"*) ok "sections failures=0";; *) no "仍有失败段";; esac

echo; echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"; [ "$FAIL" = "0" ] || exit 1
