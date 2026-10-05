#!/bin/bash
# D313/D520 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# dispatch-gate.test.sh — dispatch 闸（D1163）配对测试
#
# 覆盖矩阵（四类判据各自 红/绿 对偶）:
#   ① 路径 — 不存在且未标「新建」⇒ 红 ｜ 同一行标「新建」⇒ 绿 ｜ 存在路径 ⇒ 绿
#   ② 五元组 — 外部件缺五要素 ⇒ 红 ｜ 补齐五要素 ⇒ 绿 ｜ 外部 URL 未钉版 ⇒ 红 ｜ 钉 sha ⇒ 绿
#   ③ 单流 — 正文两个前缀 ⇒ 红 ｜ 多前缀只在"实证/回执"段与代码块内 ⇒ 绿（判别性：该段确有 ≥3 前缀）
#   ④ 真伪 — 声称已合而 origin/main 无痕迹 ⇒ 红 ｜ 声称在飞而实已入 main ⇒ 红 ｜ 明确在飞且未入 ⇒ 绿
#   误拦防回归 — 非指令文本（状态汇报）⇒ 绿
#   宿主方言 — hook 模式 send_message 违规 ⇒ exit 2 ｜ 日常对话 ⇒ 0
#   fail-closed — origin/main 不可解析 ⇒ exit 2 + GATE-ERROR
# 沙箱: mktemp 内自建 git 仓库（origin/main 由 update-ref 造）+ git 身份走 -c（不落 config）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/dispatch-gate.sh"
FIX="$REPO/tests/control-tower/fixtures/gates"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== dispatch 闸 dispatch-gate（D1163）==="
[ -f "$GATE" ] && ok "闸脚本存在" || { no "闸脚本缺失: $GATE"; echo "结果: $PASS 通过, $FAIL 失败"; exit 1; }
bash -n "$GATE" 2>/dev/null && ok "bash -n 语法通过" || no "bash -n 语法失败"
# ── 平台守卫: 禁「$var 紧跟非 ASCII」形态 ──
# macOS bash 3.2 + UTF-8 下 `${rc}；` 会把多字节字节并进变量名 → unbound variable（本卡实测两次）
BAD="$(LC_ALL=C grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^[:print:][:space:]]' "$GATE" | head -3)"
[ -z "$BAD" ] && ok "平台守卫: 闸脚本无「\$var 紧跟中文」形态" || no "变量未加花括号（会 unbound）: $BAD"


# ── 沙箱仓库: 造出 main 上有/没有的路径与 PR 合并痕迹 ──
SB="$TMPD/sandbox"
mkdir -p "$SB/scripts/control-tower" "$SB/.github/workflows"
: > "$SB/scripts/control-tower/pre-dispatch-check.sh"
: > "$SB/.github/workflows/ci.yml"
cd "$SB" || { no "沙箱创建失败"; exit 1; }
git init -q .
git -c user.name=t -c user.email=t@t add -A >/dev/null 2>&1
git -c user.name=t -c user.email=t@t commit -qm "Merge pull request #1144 from synova-agent/feat/merged-sample" >/dev/null 2>&1
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m "chore: 无 PR 引用的一次提交" >/dev/null 2>&1
git update-ref refs/remotes/origin/main HEAD
MERGED_PR="$(git log --format=%s -n 50 origin/main | sed -n 's/.*Merge pull request #\([0-9]\{2,4\}\).*/\1/p' | head -1 | tr -d ' \r\n')"
UNMERGED_PR=""
i=1000
while [ "$i" -lt 1300 ]; do
  if ! git log --format=%s -n 50 origin/main | grep -qE "Merge pull request #${i}([^0-9]|$)|\(#${i}\)"; then UNMERGED_PR="$i"; break; fi
  i=$((i+1))
done
git update-ref refs/remotes/origin/feat/merged-sample HEAD
[ -n "$MERGED_PR" ] && [ -n "$UNMERGED_PR" ] && ok "沙箱就绪（已入 main 的 PR=#${MERGED_PR}；未入 main 的 PR=#${UNMERGED_PR}）" \
  || no "沙箱 PR 取样失败（merged=${MERGED_PR} unmerged=${UNMERGED_PR}）"

run_gate() { bash "$GATE" --file "$1" 2>&1; }

# ── ① 路径存在性 ──
OUT="$(run_gate "$FIX/dispatch-bad-path.txt")"; rc=$?
[ "$rc" -eq 1 ] && ok "① 红: 不存在路径且未标「新建」⇒ exit 1" || no "① 应 exit 1，实际 $rc"
echo "$OUT" | grep -q "src/l4/evidence/gate.ts" && ok "① 红: 点名该路径" || no "① 未点名路径"

OUT="$(run_gate "$FIX/dispatch-newfile-exempt.txt")"; rc=$?
[ "${rc}" -eq 0 ] && ok "① 绿: 同一行标「新建」⇒ 豁免（声明即通过）" || no "① 新建豁免失效，rc=${rc}；$OUT"

printf '## §3（GV- 线）\n改 scripts/control-tower/pre-dispatch-check.sh 的 ④ 段\nDone 标准: 夹具全绿\n' > "$TMPD/p-exist.txt"
OUT="$(run_gate "$TMPD/p-exist.txt")"; rc=$?
[ "${rc}" -eq 0 ] && ok "① 绿: 路径在 origin/main 上存在 ⇒ exit 0" || no "① 存在路径被误拦，rc=${rc}；$OUT"

# ── ② 五元组 ──
printf '## §3（GV- 线）\n外部件: DSH hooks 文档\nDone 标准: 对齐\n' > "$TMPD/p-ext-a.txt"
OUT="$(run_gate "$TMPD/p-ext-a.txt")"; rc=$?
[ "${rc}" -eq 1 ] && echo "$OUT" | grep -q "五元组" && ok "② 红: 外部件缺五元组 ⇒ exit 1 + 点名" || no "②a 未触发，rc=${rc}；$OUT"

printf '## §3（GV- 线）\n外部件: DSH hooks 断面=hook桥 形态=README 版本=v0.17 坐标=asar:/dsh 时刻=2026-10-06T03:00Z\nDone 标准: 对齐\n' > "$TMPD/p-ext-b.txt"
OUT="$(run_gate "$TMPD/p-ext-b.txt")"; rc=$?
[ "${rc}" -eq 0 ] && ok "② 绿: 外部件补齐五要素 ⇒ exit 0" || no "②a 补齐仍红，rc=${rc}；$OUT"

OUT="$(run_gate "$FIX/dispatch-external-unpinned.txt")"; rc=$?
[ "$rc" -eq 1 ] && ok "② 红: 外部 URL 未钉版且无五元组 ⇒ exit 1" || no "②b 未触发，rc=$rc"
OUT="$(run_gate "$FIX/dispatch-external-pinned.txt")"; rc=$?
[ "${rc}" -eq 0 ] && ok "② 绿: 外部 URL 钉 sha ⇒ exit 0" || no "②b 钉版被误拦，rc=${rc}；$OUT"

# ── ③ 单流（判别性: 先证明对照件真的含多前缀，再证明它在证据段内不判违规）──
N_PREFIX="$(grep -oE '(^|[^A-Za-z0-9_])(CTO|DSH|GV|IM|BT|CL|K1|K3|PL|SQ)-' "$FIX/dispatch-evidence-multi-prefix.txt" | wc -l | tr -d ' \r\n')"
[ "${N_PREFIX:-0}" -ge 3 ] && ok "③ 夹具判别性: 对照件全文确有 ${N_PREFIX} 处前缀（非空洞绿）" || no "③ 对照件前缀不足（${N_PREFIX}）——用例空洞化"

OUT="$(run_gate "$FIX/dispatch-evidence-multi-prefix.txt")"; rc=$?
[ "${rc}" -eq 0 ] && ok "③ 绿: 多前缀只在「为什么/实证」段 ⇒ 不计（防误拦 CTO 派单形态）" || no "③ 证据段未豁免，rc=${rc}；$OUT"

OUT="$(run_gate "$FIX/dispatch-two-streams.txt")"; rc=$?
[ "${rc}" -eq 1 ] && echo "$OUT" | grep -q "非单流" && ok "③ 红: 正文两个前缀 ⇒ exit 1 + 点名" || no "③ 未触发，rc=${rc}；$OUT"

printf '## §3（GV- 线）\n```\nDSH- 与 GV- 同时出现在代码块里\n```\nDone 标准: 过\n' > "$TMPD/p-fence.txt"
OUT="$(run_gate "$TMPD/p-fence.txt")"; rc=$?
[ "${rc}" -eq 0 ] && ok "③ 绿: 代码块内前缀不计" || no "③ 代码块未豁免，rc=${rc}；$OUT"

# ── ④ 分支/PR 真伪 ──
printf '## §2 前置（GV- 线）\n前置已完成：PR #%s 已合并\nDone 标准: 直接开工\n' "$UNMERGED_PR" > "$TMPD/p-pr-false.txt"
OUT="$(run_gate "$TMPD/p-pr-false.txt")"; rc=$?
[ "${rc}" -eq 1 ] && echo "$OUT" | grep -q "#${UNMERGED_PR}" && ok "④ 红: 声称已合而 main 无痕迹 ⇒ exit 1 + 点名" || no "④ 假声称未拦，rc=${rc}；$OUT"

printf '## §2 前置（GV- 线）\n坐标系同步器卡着 PR #%s 在飞\nDone 标准: 等它合\n' "$MERGED_PR" > "$TMPD/p-pr-stale.txt"
OUT="$(run_gate "$TMPD/p-pr-stale.txt")"; rc=$?
[ "${rc}" -eq 1 ] && ok "④ 红: 声称在飞而实已入 main（状态陈述过期）⇒ exit 1" || no "④ 过期声称未拦，rc=${rc}；$OUT"

printf '## §2 前置（GV- 线）\nPR #%s 已合并在 main\nDone 标准: 直接开工\n' "$MERGED_PR" > "$TMPD/p-pr-true.txt"
OUT="$(run_gate "$TMPD/p-pr-true.txt")"; rc=$?
[ "${rc}" -eq 0 ] && ok "④ 绿: 声称已合且确在 main ⇒ exit 0" || no "④ 真声称被误拦，rc=${rc}；$OUT"

printf '## §2 前置（GV- 线）\nfeat/merged-sample 已合入 main\nDone 标准: 直接开工\n' > "$TMPD/p-br-true.txt"
OUT="$(run_gate "$TMPD/p-br-true.txt")"; rc=$?
[ "${rc}" -eq 0 ] && ok "④ 绿: 分支已合入 main 且属实 ⇒ exit 0" || no "④ 分支真声称被误拦，rc=${rc}；$OUT"

# ── 误拦防回归 ──
OUT="$(run_gate "$FIX/dispatch-not-instruction.txt")"; rc=$?
[ "$rc" -eq 0 ] && ok "误拦防回归: 非指令文本（状态汇报）⇒ exit 0（不触发）" || no "非指令被误拦，rc=$rc"
OUT="$(run_gate "$FIX/dispatch-clean.txt")"; rc=$?
[ "${rc}" -eq 0 ] && ok "正常: 合规派单件 ⇒ exit 0" || no "合规件被误拦，rc=${rc}；$OUT"

# ── 宿主方言 + fail-closed ──
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
if [ -z "$PYBIN" ]; then
  echo "  ⚠️ SKIP: 无 python ⇒ hook 模式用例跳过（显式，不静默计绿）"
else
  "$PYBIN" -c 'import json,sys;print(json.dumps({"hook_event_name":"PreToolUse","tool_name":"send_message","tool_input":{"target":"gv","message":"## §3（GV- 线）\n要改 src/l4/evidence/gate.ts\nDone 标准: tsc"}}))' > "$TMPD/h-red.json"
  OUT="$(cat "$TMPD/h-red.json" | bash "$GATE" --hook 2>&1)"; rc=$?
  [ "${rc}" -eq 2 ] && ok "hook 模式: send_message 违规 ⇒ exit 2（宿主阻断位）" || no "hook 模式应 exit 2，实际 ${rc}；$OUT"

  "$PYBIN" -c 'import json;print(json.dumps({"hook_event_name":"PreToolUse","tool_name":"send_message","tool_input":{"target":"gv","message":"收到，我看一眼就回。"}}))' > "$TMPD/h-chat.json"
  OUT="$(cat "$TMPD/h-chat.json" | bash "$GATE" --hook 2>&1)"; rc=$?
  [ "${rc}" -eq 0 ] && ok "hook 模式: 日常对话 ⇒ exit 0（不触发）" || no "日常对话被误拦，rc=${rc}；$OUT"

  "$PYBIN" -c 'import json;print(json.dumps({"hook_event_name":"PreToolUse","tool_name":"write","tool_input":{"file_path":"/tmp/not-dispatch.md","content":"要改 src/l4/evidence/gate.ts"}}))' > "$TMPD/h-write.json"
  OUT="$(cat "$TMPD/h-write.json" | bash "$GATE" --hook 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && ok "hook 模式: 写非派单件 ⇒ 不适用（放行）" || no "非派单件写入被拦，rc=$rc"
fi

printf '## §3（GV- 线）\n改 scripts/control-tower/pre-dispatch-check.sh\nDone 标准: 过\n' > "$TMPD/p-nomain.txt"
OUT="$(cd "$TMPD" && bash "$GATE" --file "$TMPD/p-nomain.txt" 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && echo "$OUT" | grep -q "GATE-ERROR" && ok "fail-closed: 不在 git 仓库 ⇒ exit 2 + GATE-ERROR" || no "非 git 仓库应 fail-closed，rc=$rc"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
