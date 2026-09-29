#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# simulate-ci.test.sh — D521/工具2: push 前 CI 等价模拟脚本
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 注入全绿桩 → exit 0
#   失败 — 注入失败桩（模拟"本地绿 CI 红"的环境差异类错误）→ exit 1 + 点名
#   降级 — pre-commit 缺失 → exit 2（D328 fail-closed，不当作通过）
#   接线 — CI 等价环境变量（SYNO_CI/SYNO_DIFF_BASE/GITHUB_ACTIONS）+ ci.yml 清单单源提取
#   透传 — 内层失败输出 >400 字符且**不含 ❌/FAIL** ⇒ 断言信息必须仍见真实内层输出
#          （改坏即红: 把 inner_detail 还原为 `grep -E "❌|FAIL" | cut -c1-400` → 本节红）
# 沙箱: SYNO_SIM_PRECOMMIT 注入桩脚本（零真实仓库门禁执行）
#   SYNO_SIM_GREEN_STUB 覆盖"全绿桩"内容（子进程端到端验证失败断言信息用）
#   SYNO_SIM_INNER_MAX 内层输出透传上限（默认 20000 字符）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SIM="$REPO/scripts/control-tower/simulate-ci.sh"
SELF="$REPO/tests/control-tower/simulate-ci.test.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

# ── 内层输出透传（诊断黑洞根治）──
# 契约: @input 内层完整输出（stdout+stderr 合并） @output 原样透传；仅超上限才截断且显式标注
# 历史: 原实现 `grep -E "❌|FAIL" | cut -c1-400` 双重丢失——(a) 不含 ❌/FAIL 字样的失败信息
#   全灭（只剩"（无 ❌ 行）"），(b) 含标记的也被截到 400 字符。诊断黑洞 = 失败不可定位。
inner_detail() { # <inner_output>
  local out="$1" max="${SYNO_SIM_INNER_MAX:-20000}"
  if [ "${#out}" -gt "$max" ]; then
    printf '%s\n…[内层输出共 %s 字符，按 SYNO_SIM_INNER_MAX=%s 截断]\n' "${out:0:$max}" "${#out}" "$max"
  else
    printf '%s\n' "$out"
  fi
}

echo "=== D521 工具2: simulate-ci ==="

# ── 接线 ──
[ -x "$SIM" ] && ok "simulate-ci.sh 存在且可执行" || no "脚本缺失/不可执行"
grep -q "SYNO_CI=1" "$SIM" && grep -q "SYNO_DIFF_BASE=origin/main" "$SIM" && grep -q "GITHUB_ACTIONS=true" "$SIM" \
  && ok "接线: CI 等价环境三件套（SYNO_CI/SYNO_DIFF_BASE/GITHUB_ACTIONS）" || no "CI 环境变量缺失"
grep -q "grep -oE 'tests/control-tower" "$SIM" \
  && ok "接线: 测试清单从 ci.yml 单源提取（不散列防漂移）" || no "清单硬编码（漂移风险）"

# ── 正常: 全绿桩 → exit 0 ──
# D563/D564 验收（2026-08-31）: 原实现把内层输出丢 /dev/null —— Windows simulate-ci 红时
#   内层失败测试名不可诊断（诊断黑洞）。改为捕获输出，失败时把内层输出**完整**拼进断言信息
#   （2026-09-27 二修: 原实现 grep ❌|FAIL + cut -c1-400 仍会丢失——见下方"透传"节），
#   CI ::error annotation 直接给出失败测试名。
GREEN_STUB="${SYNO_SIM_GREEN_STUB:-$TMPD/green.sh}"
if [ -z "${SYNO_SIM_GREEN_STUB:-}" ]; then printf '#!/bin/bash\nexit 0\n' > "$GREEN_STUB"; fi
OUT=$(SYNO_SIM_PRECOMMIT="$GREEN_STUB" bash "$SIM" 2>&1); rc=$?
if [ "$rc" -eq 0 ]; then
  ok "全绿桩 → exit 0"
else
  no "应 exit 0, 实际 $rc :: 内层完整输出:
$(inner_detail "$OUT")"
fi

# ── 失败: 红桩 → exit 1 + 报告（环境差异类错误本地可抓）──
RED_STUB="$TMPD/red.sh"; printf '#!/bin/bash\necho "❌ 模拟 CI 差异错误 (GNU sed 类)"\nexit 1\n' > "$RED_STUB"
OUT=$(SYNO_SIM_PRECOMMIT="$RED_STUB" bash "$SIM" 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "红桩 → exit 1（本地抓 CI 差异类错误）" || no "应 exit 1, 实际 $rc :: 内层完整输出:
$(inner_detail "$OUT")"
echo "$OUT" | grep -q "模拟失败" && ok "失败报告含修复指引" || no "缺失败报告 :: 内层完整输出:
$(inner_detail "$OUT")"

# ── 降级: pre-commit 缺失 → exit 2 ──
OUT2=$(SYNO_SIM_PRECOMMIT="$TMPD/missing.sh" bash "$SIM" 2>&1); rc=$?
[ "$rc" -eq 2 ] && echo "$OUT2" | grep -q "degraded" && ok "pre-commit 缺失 → exit 2 显式降级" || no "应 exit 2+degraded, 实际 $rc :: 内层完整输出:
$(inner_detail "$OUT2")"

# ── 透传: 内层失败输出 >400 字符且不含 ❌/FAIL → 断言信息必须仍见真实内层输出 ──
# 判据（改坏即红）: 把 inner_detail 还原成 `grep -E "❌|FAIL" | cut -c1-400` → 本节的
#   标记行断言与长度断言必须变红（内层 40 行无 ❌/FAIL → 旧实现只剩模拟器自身摘要行）。
# 沙箱 cwd: simulate-ci.sh 的 ROOT = git 顶层；沙箱 ci.yml 无测试清单 → 2/2 段跳过，
#   只跑 Iron Laws 段（内层桩），夹具轻量（不在真仓跑 45 个 CT 测试——重型验证不叠加）。
SBX="$TMPD/sb-ci"; git init -q "$SBX"
git -C "$SBX" config user.email "test@test.local"; git -C "$SBX" config user.name "test"
mkdir -p "$SBX/.github/workflows" "$SBX/.claude"
printf 'name: ci\njobs:\n  control-tower-tests:\n    steps:\n      - run: echo no-test-list-here\n' \
  > "$SBX/.github/workflows/ci.yml"
echo seed > "$SBX/seed.txt"
git -C "$SBX" add -A; git -C "$SBX" commit -q -m "init: simulate-ci 夹具沙箱"
git -C "$SBX" update-ref refs/remotes/origin/main HEAD   # origin/main 可解析 → Iron Laws 段不降级跳过

LONG_MARKER="inner-detail-tail-marker-不受过滤影响"
LONG_STUB="$TMPD/long.sh"
{
  echo '#!/bin/bash'
  echo 'i=0'
  echo 'while [ $i -lt 40 ]; do echo "inner-detail-line-${i}-no-verdict-marker"; i=$((i+1)); done'
  echo "echo \"$LONG_MARKER\""
  echo 'exit 1'
} > "$LONG_STUB"
# 前置自校验（构造失败 → 后续断言无意义）: 内层桩自身的输出确实不含 ❌/FAIL 且 >400 字符
STUB_RAW="$(bash "$LONG_STUB" 2>&1 || true)"
printf '%s' "$STUB_RAW" | grep -qE "❌|FAIL" && no "前置不成立: 内层桩输出含 ❌/FAIL（夹具失效）" \
  || ok "前置: 内层桩输出不含 ❌/FAIL（旧 grep 过滤会全灭）"
[ "${#STUB_RAW}" -gt 400 ] && ok "前置: 内层桩输出 ${#STUB_RAW} 字符 > 400" \
  || no "前置不成立: 内层桩输出仅 ${#STUB_RAW} 字符"

OUT_LONG=$(cd "$SBX" && SYNO_SIM_PRECOMMIT="$LONG_STUB" bash "$SIM" 2>&1); rc_long=$?
DETAIL="$(inner_detail "$OUT_LONG")"
DETAIL_LEN=${#DETAIL}
[ "$rc_long" -eq 1 ] && ok "沙箱红桩 → simulate-ci exit 1（内层失败已捕获）" \
  || no "沙箱红桩应 exit 1，实际 rc=${rc_long}"
[ "$DETAIL_LEN" -gt 400 ] && ok "断言信息透传内层真实输出（${DETAIL_LEN} 字符 > 400，未被 cut 截断）" \
  || no "透传后仅 ${DETAIL_LEN} 字符（≤400 = 仍在截断）"
printf '%s' "$DETAIL" | grep -qF "$LONG_MARKER" && ok "内层末行标记可见（诊断不丢尾部）" \
  || no "内层末行标记丢失: 期望 $LONG_MARKER"
printf '%s' "$DETAIL" | grep -qF "inner-detail-line-39-no-verdict-marker" && ok "内层尾部行可见（非仅首 400 字符）" \
  || no "内层尾部行丢失"
# 上限可配置且显式标注（超上限时不得静默截断）
MAXOUT="$(SYNO_SIM_INNER_MAX=120 inner_detail "$OUT_LONG")"
printf '%s' "$MAXOUT" | grep -q "SYNO_SIM_INNER_MAX=120" && ok "超上限截断显式标注原因与上限值" \
  || no "超上限截断未标注（静默截断）"

# ── 端到端: 子进程以「失败绿桩」运行本测试 → 其失败断言信息必须含内层真实输出 ──
# 证明 inner_detail 真被断言分支使用（非死代码）: 父进程只看子进程的失败输出。
# 子进程 cwd=沙箱 → 其内部 simulate-ci 调用同样只跑 Iron Laws 段（轻量，不递归重型路径）。
if [ -n "${SYNO_SIM_GREEN_STUB:-}" ]; then
  : # 子进程（由本节的父夹具注入失败绿桩启动）——不再递归
else
  CHILD_OUT=$(cd "$SBX" && SYNO_SIM_GREEN_STUB="$LONG_STUB" bash "$SELF" 2>&1); child_rc=$?
  [ "$child_rc" -ne 0 ] && ok "子进程注入失败绿桩 → 整测试 exit≠0（rc=${child_rc}）" \
    || no "子进程应失败，实际 rc=${child_rc}"
  printf '%s' "$CHILD_OUT" | grep -qF "$LONG_MARKER" \
    && ok "子进程失败断言信息含内层末行标记（端到端透传成立）" \
    || no "子进程失败断言信息丢失内层输出（inner_detail 未接线或仍被过滤）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
