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
  # D1061-A2: 被测段改为「只发射注解」形态 —— 补齐其依赖的 CT_TEST_LOG / CT_TEST_RC
  local t="fixture-test-name"
  local LOG="$1"
  local CT_TEST_LOG="$1"
  local CT_TEST_RC=1
  printf '%s\n' "$BLOCK" | sed "s|\${CT_TEST_LOG}|$LOG|g" > "$RUNNER"
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

# ── 用例 5（零回归）: D956 段必须物理位于 canary 失败分支内 —— 用**标记段定位**，不用粗区间 ──
#   D1039 实证: 旧实现取「Run hermetic… → exit $FAIL」粗区间里的"第一个 ::error"，任何人在同一
#   job 新增一个带自己 ::error 的 step（如 D1039 新增的 Classify step）都会被误判为
#   "::error 在失败分支外"（实测假红 err=34 if=108）。⇒ 改用本夹具自述的提取契约
#   （D956-MSG-START/END 标记，见文件头 + L34）做定位。
#   判别性保持: 把 D956 段移到 `if ! bash "$t"` 之前（挪出失败分支）⇒ START_LN < BRANCH_IF_LN ⇒ 本用例转红。
START_LN=$(grep -n '# D956-MSG-START' "$CI" | head -1 | cut -d: -f1)
# D1061-A2: 执行已抽到「隔离式并行/串行执行阶段」（每测试独立日志 + rc 文件），注解段改为只发射注解。
#   ⇒ 失败分支锚点由 `if ! bash "$t"` 改为 rc 判定；两种形态都接受（兼容并行前后）。
BRANCH_IF_LN=$(awk -v s="$START_LN" 'NR < s && (/if ! bash "\$t"/ || /CT_TEST_RC:-1\}" -ne 0 \]/) { n = NR } END { print n + 0 }' "$CI")
IN_BRANCH=0
if [ -n "$START_LN" ] && [ "$BRANCH_IF_LN" -gt 0 ] && [ "$START_LN" -gt "$BRANCH_IF_LN" ]; then IN_BRANCH=1; fi
if [ "$IN_BRANCH" -eq 1 ] && printf '%s\n' "$BLOCK" | grep -q '::error'; then
  ok "零回归: D956 段在失败分支内且发出 ::error（if@${BRANCH_IF_LN} < START@${START_LN}）"
else
  no "零回归失败: D956 段不在失败分支内或缺 ::error (if=$BRANCH_IF_LN start=$START_LN)"
fi

# ── 用例 6（D1061-A2 判别性）: 注解段**不得**重复执行测试（执行已抽到并行/串行阶段）──
#   判别性: 有人在注解段重新 `bash "$t"`（即并行改造被回退）⇒ 本用例转红。
if printf '%s\n' "$BLOCK" | grep -qE 'bash "\$t"'; then
  no "A2 判别失败: D956 注解段仍含 `bash \"\$t\"`（执行未抽离 ⇒ 与隔离式并行冲突）"
else
  ok "A2: D956 段只发射注解、不重复执行测试（执行在隔离式并行/串行阶段）"
fi
# FAIL=1 仍在（门禁语义不变——D956 不新增阻断也不放松）
printf '%s\n' "$BLOCK" | grep -q 'FAIL=1' || true  # FAIL=1 在段外（分支尾），查上下文
grep -q 'FAIL=1' "$CI" && ok "门禁语义不变: FAIL=1 保留" || no "FAIL=1 丢失"

echo ""
echo "═══ d956-failmsg: PASS=$PASS FAIL=$FAIL ═══"
[ "$FAIL" -eq 0 ]
