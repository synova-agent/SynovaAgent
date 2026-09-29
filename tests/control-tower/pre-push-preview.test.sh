#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# pre-push-preview.test.sh — D1061 任务 4: 推前四件套（本地秒级预演）
#
# 覆盖矩阵（铁律 48 三路径 + 接线 + 计时）:
#   正常 — 合规 brief → --fast rc=0（三项全绿）
#   正常 — 无绑定 brief → **显式 SKIP**（可见，不计通过也不计红）rc=0
#   降级 — brief 绑定不到 + ② D708 可跳过（SYNO_PREVIEW_SKIP_D708）→ 显式降级行
#   边界 — 坏 brief（Done 非 checkbox）→ rc=1（**本地即拦**，红因 D）
#   边界 — 坏 brief（缺 #CRITERIA）→ rc=1
#   边界 — 三面残留（a 面注入真 MARK）→ rc=1
#   契约 — --fast 全程 ≤10s（卡面硬指标，实测取数）
#   接线 — pre-push-check.sh 真的调用 preview（铁律 0-2 WIRE CHECK，打 file:line）
#   变异体 — 移除 ① brief 解析 → 坏 brief 时 rc=0 → 本文件「坏 brief 必红」断言必红
#
# 沙箱: /tmp fixture + SYNO_* 注入，零网络、零真实 task-state 写入
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREVIEW="$REPO/scripts/workflow/pre-push-preview.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

mktmp_brief() { # $1=done 行文案 $2=是否写 #CRITERIA(1/0)
  local f="$TMPD/b-$RANDOM$RANDOM.md"
  { [ "$2" = "1" ] && printf '#CRITERIA: C\n\n'
    printf '## Q0: 定位\n控制塔。\n\n## Q2: 范围\n做什么:\n- scripts/pre-push-check.sh\n不做什么:\n- 不改 scripts/audit/x.sh\n\n'
    printf '## Q3: 验收\n入口: x。\n\n## 架构层:\nscripts（控制塔域）\n\n## Done 标准\n%s\n' "$1"
  } > "$f"
  echo "$f"
}

echo "=== D1061 任务 4: 推前四件套 ==="

GOOD="$(mktmp_brief '- [ ] verify: bash tests/x.test.sh → 0' 1)"
BAD_DONE="$(mktmp_brief '- 纯 bullet 无 checkbox（红因 D）' 1)"
BAD_CRIT="$(mktmp_brief '- [ ] verify: x → 0' 0)"

# ── 正常: 合规 brief → rc=0 ──
OUT="$(SYNO_PREVIEW_SKIP_D708=1 bash "$PREVIEW" --fast --brief "$GOOD" 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "正常: 合规 brief → --fast rc=0" || no "正常: rc=${RC}（期望 0）"
printf '%s' "$OUT" | grep -q "criteria=C done_count=1" && ok "正常: ① 显式回显三条判据（criteria/Done count）" || no "正常: 未回显三判据"

# ── 正常: 无绑定 brief → 显式 SKIP（不静默）──
OUT="$(SYNO_PREVIEW_SKIP_D708=1 SYNO_PREVIEW_BRIEF="" bash "$PREVIEW" --fast 2>&1)"; RC=$?
if [ -n "${DSH_SESSION_ID:-}" ] && [ -f "$REPO/.claude/current-brief.$DSH_SESSION_ID" ]; then
  ok "正常: （本 session 有 current-brief → 跳过该断言，环境相关）"
elif [ -f "$REPO/.claude/current-brief" ]; then
  ok "正常: （仓库有全局 current-brief → 跳过该断言，环境相关）"
else
  printf '%s' "$OUT" | grep -q "绑定不到 brief" && ok "正常: 无绑定 brief → 显式 SKIP 行（可见）" || no "正常: 无绑定 brief 时未显式标注"
  [ "$RC" -eq 0 ] && ok "正常: SKIP 不计红（rc=0）" || no "正常: SKIP 却 rc=$RC"
fi

# ── 边界: 坏 brief（Done 非 checkbox）→ 必红且点名 ──
OUT="$(SYNO_PREVIEW_SKIP_D708=1 bash "$PREVIEW" --fast --brief "$BAD_DONE" 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "边界: 坏 brief（Done 无 checkbox）→ rc=1（本地即拦）" || no "边界: rc=${RC}（期望 1）"
printf '%s' "$OUT" | grep -q "Done 标准无条目" && ok "边界: 点名根因（Done 标准无条目）" || no "边界: 未点名根因"
printf '%s' "$OUT" | grep -q "done_count=0" && ok "边界: 回显 done_count=0（可核）" || no "边界: 未回显 done_count"

# ── 边界: 缺 #CRITERIA → 必红 ──
OUT="$(SYNO_PREVIEW_SKIP_D708=1 bash "$PREVIEW" --fast --brief "$BAD_CRIT" 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "边界: 缺 #CRITERIA → rc=1" || no "边界: 缺 #CRITERIA rc=${RC}（期望 1）"
printf '%s' "$OUT" | grep -q "#CRITERIA" && ok "边界: 点名 #CRITERIA 缺失" || no "边界: 未点名 #CRITERIA"

# ── 边界: 三面残留 a 面 → 必红 ──
D1="$TMPD/roots"; mkdir -p "$D1/src"
printf 'MARK=%s\n' "INJECTED""-RED" > "$D1/src/leak.ts"
OUT="$(SYNO_PREVIEW_SKIP_D708=1 SYNO_PREVIEW_ROOTS="$D1/src" bash "$PREVIEW" --fast --brief "$GOOD" 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "边界: a 面残留 → rc=1" || no "边界: a 面残留 rc=${RC}（期望 1）"
printf '%s' "$OUT" | grep -q "a=1" && ok "边界: 三面计数可核（a=1）" || no "边界: 未输出三面计数"
# 反向判别必须非零（探针有效）
printf '%s' "$OUT" | grep -qE "c\) 反向判别.*: [1-9]" && ok "边界: c 面反向判别命中（探针非失效＝非假绿）" || no "边界: c 面未命中（探针可能失效）"

# ── 契约: --fast ≤10s（卡面硬指标）──
S=$(date +%s); CY=$("$REPO/scripts/control-tower/gate-circuit-breaker.sh" --health-line >/dev/null 2>&1; echo 0)  # 预热
bash "$PREVIEW" --fast --brief "$GOOD" >/dev/null 2>&1
E=$(date +%s); DUR=$((E - S))
[ "$DUR" -le 10 ] && ok "契约: --fast 实测 ${DUR}s ≤ 10s" || no "契约: --fast 实测 ${DUR}s > 10s"

# ── 接线（**判别子：行为层**，非 grep）——坑清单第 7 条：禁 grep 型静态判据当验收 ──
# 背景（verifier 复核暴露）: 纯 grep 断言在"删掉 preview 文件"时**永不红** ——
#   `pre-push-check.sh` 的缺件 fail-open 告警行也含同名串，grep 照样命中。
# 故并列两条行为判别子（隔离缝 `SYNO_PREVIEW_ONLY=1` 只跑门禁 8，镜像既有 `SYNO_SYNC_ONLY` 惯例）：
STUB_FAIL='echo "STUB: 强制 preview 失败"; exit 1'
STUB_OK='echo "STUB: 强制 preview 通过"; exit 0'
OUT="$(SYNO_PREVIEW_ONLY=1 SYNO_PREVIEW_CMD="$STUB_FAIL" bash "$REPO/scripts/pre-push-check.sh" 2>&1)"; RC=$?
[ "$RC" -ne 0 ] && ok "判别子A: preview 桩失败 → pre-push-check.sh rc=${RC}≠0（行为层接线成立）" \
  || no "判别子A: preview 失败但 rc=0（门禁 8 未真正判定）"
printf '%s' "$OUT" | grep -q "门禁 8: 推前预演未通过" && ok "判别子A: 报文点名门禁 8（可定位）" || no "判别子A: 未点名门禁 8"
OUT="$(SYNO_PREVIEW_ONLY=1 SYNO_PREVIEW_CMD="$STUB_OK" bash "$REPO/scripts/pre-push-check.sh" 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "判别子B: preview 桩通过 → rc=0（正向对照，排除恒红）" || no "判别子B: 桩通过却 rc=$RC（恒红）"
grep -q "run_gate8_preview" "$REPO/scripts/pre-push-check.sh" \
  && ok "反向判别: 门禁 8 以函数形式存在（摘掉它则判别子A 必失红）" \
  || no "反向判别: 找不到门禁 8 函数定义"
# ── 调用点判别（**定位式**，非"串出现即算"）──
# 为什么不能只 grep 全文件: 缺件 fail-open 分支里也有同名串 ⇒ 全文件 grep 恒真（不判别）。
# 这里把判据**限定在生产尾部区间**（自调用点注释起至文件末），
#   ⇒ 删掉尾部调用/删掉 exit 1 → 本条必红（实测见 B 证据）。
TAIL="$(sed -n '/门禁 8: 推前预演（函数体见上方定义；此处调用）/,$p' "$REPO/scripts/pre-push-check.sh")"
[ -n "$TAIL" ] && ok "调用点判别: 定位到生产尾部区间（${#TAIL} 字节）" || no "调用点判别: 找不到生产尾部区间"
printf '%s' "$TAIL" | grep -q 'if ! run_gate8_preview; then' \
  && ok "调用点判别: 生产尾部**实际调用** run_gate8_preview" || no "调用点判别: 生产尾部未调用门禁 8（接线断裂）"
printf '%s' "$TAIL" | grep -q '门禁 8: 推前预演未通过 — 推送已拒绝' \
  && ok "调用点判别: 失败路径报文点名门禁 8" || no "调用点判别: 失败路径报文缺失"
printf '%s' "$TAIL" | grep -qE '^[[:space:]]*exit 1[[:space:]]*$' \
  && ok "调用点判别: 失败路径确有 exit 1（硬阻断）" || no "调用点判别: 失败路径无 exit 1"
# ── **弱判据**（保留但降级标注: 只证"声明在场"，**不证**"被调用"）──
WIRE="$(grep -n "pre-push-preview.sh" "$REPO/scripts/pre-push-check.sh" 2>/dev/null | head -3)"
if [ -n "$WIRE" ]; then ok "弱判据(仅声明在场，非执行): pre-push-preview.sh 出现于 $(printf '%s' "$WIRE" | head -1)"; else no "弱判据: pre-push-check.sh 未见 preview 声明"; fi
grep -q "SYNO_PREVIEW_SKIP" "$REPO/scripts/pre-push-check.sh" && ok "接线: 逃生舱 SYNO_PREVIEW_SKIP 存在（须有测试）" || no "接线: 逃生舱缺失"
# 原门禁 0-7 一条不删（逐条点名，防"接线=删旧门"）
KEPT=0
for g in "门禁 0" "门禁 1" "门禁 2" "门禁 3" "门禁 4" "门禁 5" "门禁 6" "门禁 7"; do
  grep -q "$g" "$REPO/scripts/pre-push-check.sh" && KEPT=$((KEPT+1))
done
[ "$KEPT" -ge 8 ] && ok "接线: 原门禁 0-7 全部仍在（命中 ${KEPT}/8）" || no "接线: 原门禁被删（仅命中 ${KEPT}/8）"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
# 变异体（改坏即红，本卡实测贴于 B 证据）:
#   把 ① 的 `bash "$CHECK_BRIEF" "$BRIEF_FILE"` 调用删掉（改为恒通过）
#   → 上方「坏 brief（Done 无 checkbox）→ rc=1」「缺 #CRITERIA → rc=1」必红。
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
