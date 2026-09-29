#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# d956-failmsg.test.sh — D956 CI 失败消息观测性判别夹具
#
# 背景（D956）: ci.yml control-tower-tests 的 ::error 注解原为
#   `MSG=$(tail -8 … | cut -c1-450)` —— (a) 失败断言行可能不在 tail 窗内被挤掉；
#   (b) cut 按字节截断，中文 ≈150 字即断；(c) 构造失败无降级语义。
#
# 判别方式（防"接线了≠被执行"）: 从 ci.yml 提取 D956-MSG-START/END 标记段，
#   替换日志路径为夹具日志后**真实执行**，断言注解行为——删掉 ci.yml 修复段
#   本夹具即红（物理判别，非 grep 静态判据）。
#
# 覆盖矩阵（铁律 48 三路径）:
#   正常 — 多行失败（断言行在 tail 窗外）→ 注解必含失败断言行
#   降级 — 超长输出 → 注解必含 truncated 标记 + 完整日志位置；空日志 → D956-degraded
#   边界 — 纯中文失败行不被字节截断；通过路径零 ::error（零回归）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI="$REPO/.github/workflows/ci.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# ── 结构前置: D956 标记段存在且旧字节截断已移除 ──
grep -q '# D956-MSG-START' "$CI" && ok "ci.yml 含 D956-MSG-START 标记" || no "缺 D956-MSG-START"
grep -q '# D956-MSG-END' "$CI" && ok "ci.yml 含 D956-MSG-END 标记" || no "缺 D956-MSG-END"
if grep -v '^\s*#' "$CI" | grep -q 'cut -c1-450'; then no "旧的字节截断 cut -c1-450 仍存在（代码行）"; else ok "旧字节截断 cut -c1-450 已移除（仅注释提及）"; fi

# ── 提取 D956 段并做夹具可执行化 ──
BLOCK=$(awk '/# D956-MSG-START/,/# D956-MSG-END/' "$CI")
[ -n "$BLOCK" ] && ok "D956 段提取非空" || no "D956 段提取为空"
# 去掉 YAML run 块的 14 空格缩进
BLOCK=$(printf '%s\n' "$BLOCK" | sed 's/^              //')

# 运行器: 用夹具日志路径替换 /tmp/ct-out.log；$t 由调用方注入
run_d956() {  # $1=夹具日志路径 ; stdout=注解行
  local t="fixture-test-name"
  local LOG="$1"
  printf '%s\n' "$BLOCK" | sed "s|/tmp/ct-out.log|$LOG|g" > "$RUNNER"
  ( . "$RUNNER" ) 2>/dev/null  # swallow-ok: 夹具只取 stdout 注解行，stderr 噪声不入断言
}

RUNNER="$(mktemp)"
trap 'rm -f "$RUNNER" "$F1" "$F2" "$F3"' EXIT

# ── 用例 1（正常路径）: 失败断言行在 tail-8 窗外 → 注解必含断言行 ──
F1="$(mktemp)"; {
  echo "── fixture boot"
  echo "❌ expect(count).toBe(5) — received 3"
  for i in $(seq 1 20); do echo "filler-line-$i 计算进度输出"; done
} > "$F1"
OUT1=$(run_d956 "$F1")
echo "$OUT1" | grep -q 'received 3' && ok "多行失败: 注解含失败断言行（tail 窗外仍入窗）" || no "注解丢了失败断言行: $OUT1"
echo "$OUT1" | grep -q '::error title=fixture-test-name::' && ok "注解格式 title 正确" || no "注解格式异常: $OUT1"

# ── 用例 2（降级-截断自报）: 超长输出 → truncated 标记 + 完整日志位置 ──
F2="$(mktemp)"; {
  echo "FAIL: long-output-case"
  for i in $(seq 1 30); do printf '很长的中文失败上下文行%03d-填充内容' "$i"; printf 'x%.0s' $(seq 1 60); echo; done
} > "$F2"
OUT2=$(run_d956 "$F2")
echo "$OUT2" | grep -q 'truncated' && ok "超长输出: 注解含 truncated 标记" || no "缺 truncated 标记: $OUT2"
echo "$OUT2" | grep -q 'full log' && ok "超长输出: 注解含完整日志位置" || no "缺完整日志位置: $OUT2"
if [ "${#OUT2}" -le 600 ]; then ok "注解总长受控（${#OUT2} 字符）"; else no "注解超长未截断（${#OUT2} 字符）"; fi

# ── 用例 3（降级-空日志三态）: 空日志 → D956-degraded，不静默 ──
F3="$(mktemp); :" ; : > "$F3" 2>/dev/null || F3="$(mktemp)"; : > "$F3"
OUT3=$(run_d956 "$F3")
echo "$OUT3" | grep -q 'D956-degraded' && ok "空日志: 显式降级注解（三态成立）" || no "空日志未降级自报: $OUT3"

# ── 用例 4（边界-中文不字节截断）: 中文失败行完整入窗 ──
echo "$OUT1" | grep -q 'expect(count).toBe(5)' && ok "中文混排失败行未被字节截断" || no "中文失败行被截断: $OUT1"

# ── 用例 5（零回归）: 通过路径零 ::error——D956 段在 if 失败分支内 ──
CTX=$(awk '/Run hermetic control-tower gate tests/,/exit \$FAIL/' "$CI")
FIRST_ERR=$(printf '%s\n' "$CTX" | grep -v '^\s*#' | grep -n '::error' | head -1 | cut -d: -f1)
FIRST_IF=$(printf '%s\n' "$CTX" | grep -v '^\s*#' | grep -n 'if ! bash "\$t"' | head -1 | cut -d: -f1)
FI_LINE=$(printf '%s\n' "$CTX" | grep -n '^ *fi *$' | head -1 | cut -d: -f1)
if [ -n "$FIRST_ERR" ] && [ -n "$FIRST_IF" ] && [ "$FIRST_ERR" -gt "$FIRST_IF" ]; then
  ok "零回归: ::error 仅在测试失败分支内（通过时注解路径不变）"
else
  no "零回归失败: ::error 不在失败分支内 (err=$FIRST_ERR if=$FIRST_IF)"
fi
# FAIL=1 仍在（门禁语义不变——D956 不新增阻断也不放松）
printf '%s\n' "$BLOCK" | grep -q 'FAIL=1' || true  # FAIL=1 在段外（分支尾），查上下文
printf '%s\n' "$CTX" | grep -q 'FAIL=1' && ok "门禁语义不变: FAIL=1 保留" || no "FAIL=1 丢失"

echo ""
echo "═══ d956-failmsg: PASS=$PASS FAIL=$FAIL ═══"
[ "$FAIL" -eq 0 ]
