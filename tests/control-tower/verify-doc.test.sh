#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# verify-doc.test.sh — D703 证据命令机器化（K3 W-1）：verify-doc.sh 密封测试
#
# 背景: dev doc 的 DS 证据命令停留在「文档字符串」——W2 引用了不存在的测试文件、
#       W4 声称 0 命中实测 2 命中，根因都是没人原样跑过（K3 W-1）。
#       本测试密封覆盖通用回放执行器 scripts/ci/verify-doc.sh 的判定逻辑。
#
# 覆盖矩阵（spec §4 ≥4 断言 + 铁律 48 三路径）:
#   正常   — 合法 grep 命令回放 → exit 0
#   降级   — 引用不存在测试文件的 npx vitest 命令 → exit 1（W2 真实事故形态）
#   降级   — 非白名单命令（rm）→ 拒绝 exit 1
#   降级   — 含危险元字符（; 链接）的命令 → 拒绝 exit 1
#   边界   — 无 DS 命令的 doc → 显式 skip（exit 0 + 打印理由，不静默）
#   边界   — 含 <占位符> 的参数化命令 → 显式 skip（不误判为危险元字符）
#   接线   — scripts/ci/verify-doc.sh 存在（RED 基准：脚本缺失时本测试红）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE="$REPO/scripts/ci/verify-doc.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "=== D703 verify-doc.sh 密封测试 ==="

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ── 接线: 引擎脚本存在（脚本缺失 = RED）──
# 注意: 仓库惯例 scripts/ 与 tests/ 全部 100644（CI 以 bash 调用，不依赖可执行位）——
# 断言 -x 在 ubuntu 必挂（Win 本地 MSYS -x 宽松造成假绿），判存在性 -f 才是 RED 基准本意。
if [ -f "$ENGINE" ]; then
  ok "接线: scripts/ci/verify-doc.sh 存在"
else
  no "接线: scripts/ci/verify-doc.sh 缺失（RED：机制未落地）"
fi

# ── 断言 1: 合法 grep 命令回放 → exit 0 ──
cat > "$TMP/good.md" <<'DOC_EOF'
# 合法 doc
## 6. 完成标准（机器可验证）
- DS1: `grep -c "增长导航" AGENTS.md`
## 8. 交付声明（声称 ↔ 证据对照表）
| 声称 | 证据命令 | 预期 |
|---|---|---|
| 命中 | `ls scripts/ci/verify-doc.sh` | 存在 |
## 9. 其他
DOC_EOF
if OUT=$(bash "$ENGINE" "$TMP/good.md" 2>&1); then
  ok "正常: 合法 grep/ls 回放 exit 0"
else
  no "正常: 合法 grep/ls 回放应 exit 0（实际非零）— $OUT"
fi

# ── 断言 2: 引用不存在测试文件 → exit 1（W2 真实事故形态）──
cat > "$TMP/w2.md" <<'DOC_EOF'
# W2 形态 doc
## 6. 完成标准（机器可验证）
- DS1: `npx vitest run tests/agent/d703-red-nonexistent.test.ts`
## 8. 交付声明（声称 ↔ 证据对照表）
| 声称 | 证据命令 | 预期 |
|---|---|---|
| 全绿 | `npx vitest run tests/agent/d703-red-nonexistent.test.ts` | 全 pass |
## 9. 其他
DOC_EOF
if OUT=$(bash "$ENGINE" "$TMP/w2.md" 2>&1); then
  no "降级: 引用不存在测试文件应 exit 1（W2 形态漏放行）"
else
  if echo "$OUT" | grep -q "不存在"; then
    ok "降级: 引用不存在测试文件 → exit 1 且点名不存在（W2 形态）"
  else
    no "降级: exit 1 但未点名不存在路径 — $OUT"
  fi
fi

# ── 断言 3: 非白名单命令（rm）→ 拒绝 exit 1 ──
cat > "$TMP/rm.md" <<DOC_EOF
# 危险 doc
## 6. 完成标准（机器可验证）
- DS1: \`rm -rf "$TMP/should-never-run"\`
## 8. 交付声明（声称 ↔ 证据对照表）
| 声称 | 证据命令 | 预期 |
|---|---|---|
| x | \`rm -rf "$TMP/should-never-run"\` | x |
## 9. 其他
DOC_EOF
touch "$TMP/should-never-run"
if OUT=$(bash "$ENGINE" "$TMP/rm.md" 2>&1); then
  no "降级: rm 非白名单应拒绝 exit 1"
else
  if echo "$OUT" | grep -q "拒绝"; then
    ok "降级: rm 非白名单 → 拒绝 exit 1"
  else
    no "降级: exit 1 但缺拒绝语义输出 — $OUT"
  fi
fi
if [ -f "$TMP/should-never-run" ]; then
  ok "降级: rm 被拒绝后目标文件未被删除（真的没执行）"
else
  no "降级: rm 竟然执行了（安全闸失效，严重）"
fi

# ── 断言 4: 危险元字符（; 命令链接）→ 拒绝 exit 1 ──
cat > "$TMP/meta.md" <<'DOC_EOF'
# 元字符 doc
## 6. 完成标准（机器可验证）
- DS1: `grep -c "增长导航" AGENTS.md; echo injected`
## 8. 交付声明（声称 ↔ 证据对照表）
| 声称 | 证据命令 | 预期 |
|---|---|---|
| x | `ls scripts && echo injected` | x |
## 9. 其他
DOC_EOF
if bash "$ENGINE" "$TMP/meta.md" >/dev/null 2>&1; then
  no "降级: 含 ; 与 & 的命令应拒绝 exit 1"
else
  ok "降级: 含 ; 与 & 的命令 → 拒绝 exit 1"
fi

# ── 断言 5: 无 DS 命令的 doc → 显式 skip（exit 0 + 理由，不静默）──
cat > "$TMP/empty.md" <<'DOC_EOF'
# 无命令 doc
## 6. 完成标准（机器可验证）
- DS1: 人工核对（无机器可执行命令）
## 8. 交付声明（声称 ↔ 证据对照表）
| 声称 | 证据命令 | 预期 |
|---|---|---|
| x | 人工核对 | x |
## 9. 其他
DOC_EOF
if OUT=$(bash "$ENGINE" "$TMP/empty.md" 2>&1); then
  if echo "$OUT" | grep -qi "skip"; then
    ok "边界: 无 DS 命令 → exit 0 + 显式 skip 理由"
  else
    no "边界: exit 0 但缺显式 skip 理由（静默放行）"
  fi
else
  no "边界: 无 DS 命令的 doc 应 exit 0 显式 skip — $OUT"
fi

# ── 断言 6: <占位符> 参数化命令 → 显式 skip（不误判危险元字符）──
cat > "$TMP/ph.md" <<'DOC_EOF'
# 占位符 doc
## 6. 完成标准（机器可验证）
- DS3: `bash scripts/ci/verify-doc.sh <坏 doc>`
## 8. 交付声明（声称 ↔ 证据对照表）
| 声称 | 证据命令 | 预期 |
|---|---|---|
| x | `bash scripts/ci/verify-doc.sh <坏 doc>` | exit 1 |
## 9. 其他
DOC_EOF
if OUT=$(bash "$ENGINE" "$TMP/ph.md" 2>&1); then
  if echo "$OUT" | grep -qi "skip"; then
    ok "边界: 占位符命令 → 显式 skip 不误拒"
  else
    no "边界: 占位符 exit 0 但缺 skip 理由"
  fi
else
  no "边界: 占位符命令不应被拒绝（应显式 skip）— $OUT"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
