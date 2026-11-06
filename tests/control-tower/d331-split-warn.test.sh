#!/bin/bash
# D331 拆分（#1309）判别力自检：
#   ① 门禁 7 对账失败分支必须"警告但不出 1"（源级断言：该块含只报不拦文案且不含紧随其后的 exit 1）
#   ② 脚本缺件仍 fail-closed（源级断言：缺件分支含 exit 1）
#   ③ L4-1 版本 tag 校验仍在（源级断言：check_tag_ancestry 调用存在）
# 说明：源级断言（grep）是本文件的判据形态；行为级由 CI 推送验证。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
F="$ROOT/scripts/pre-push-check.sh"
fail=0
chk() { if eval "$2"; then echo "  ✅ $1"; else echo "  ❌ $1"; fail=1; fi; }

chk "只报不拦文案存在"        "grep -q '只报不拦' '$F' && grep -q '#1309 D331 拆分' '$F'"
chk "对账失败不再 exit 1"      "! awk '/if ! d331_gate/{f=1} f{print} f&&/^fi$/{exit}' '$F' | grep -q 'exit 1'"
chk "缺件仍 fail-closed"      "awk '/d331-bypass-gate.sh 缺失/{f=1} f&&/exit 1/{found=1} END{exit !found}' '$F'"
chk "L4-1 tag 校验仍在"        "grep -q 'check_tag_ancestry' '$F'"

if [ "$fail" -ne 0 ]; then echo "D331-SPLIT: FAIL"; exit 1; fi
echo "D331-SPLIT: PASS (checks=4)"
