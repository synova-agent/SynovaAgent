#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# fastlane-extended.test.sh — D537 #3: fastlane 扩展（merge commit + 补记组合）
#
# 覆盖矩阵:
#   补记单文件   — [.claude/bypass.log] → fastlane（原 D515）
#   补记组合     — [bypass.log + task-state + docs] → fastlane（D537 扩展）
#   merge commit — MERGE_HEAD 存在 → fastlane（D537 扩展，同 D328 豁免）
#   普通提交     — [src/xxx.ts] → 全量（防误放行）
#   防绕过       — .synova/skills/（行为配置，非证据）→ 全量
# 接线: synova-commit FASTLANE_TRIGGER 三态 + 证据白名单 regex
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SC="$REPO/scripts/control-tower/synova-commit"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "=== D537 #3: fastlane 扩展（merge + 补记组合）==="

# ── 接线 ──
grep -q 'FASTLANE_TRIGGER' "$SC" && ok "接线: FASTLANE_TRIGGER 判定存在" || no "接线: FASTLANE_TRIGGER 缺失"
grep -q 'MERGE_HEAD' "$SC" && ok "接线: merge commit（MERGE_HEAD）检测存在" || no "接线: MERGE_HEAD 检测缺失"
grep -q '_EVIDENCE_RE' "$SC" && ok "接线: 补记组合证据白名单 regex 存在" || no "接线: 证据白名单缺失"
grep -q 'FASTLANE_TRIGGER" -eq 1' "$SC" && grep -q 'export SYNO_FASTLANE=1' "$SC" && ok "接线: 触发后 export SYNO_FASTLANE=1" || no "接线: export 缺失"

# ── 证据白名单判定（隔离验证——复现 fastlane 三态判定核心）──
# 提取 synova-commit 里的证据白名单 regex（单源，避免测试与实现漂移）
_EVIDENCE_RE="$(grep -oE "_EVIDENCE_RE='[^']+'" "$SC" | head -1 | sed "s/^_EVIDENCE_RE='//; s/'$//")"
if [ -z "$_EVIDENCE_RE" ]; then no "提取证据白名单 regex 失败"; exit 1; fi
is_evidence_only() {
  # $@ = 文件列表；stdout = 1（全部证据→fastlane）| 0（含代码→全量）
  local non
  non=$(printf '%s\n' "$@" | grep -vE "$_EVIDENCE_RE" || true)
  [ -z "$non" ] && echo 1 || echo 0
}

# ① 纯补记单文件
[ "$(is_evidence_only '.claude/bypass.log')" = "1" ] && ok "纯 bypass.log → fastlane" || no "纯 bypass.log 应 fastlane"
# ② 补记组合（bypass.log + task-state + docs + memory）
[ "$(is_evidence_only '.claude/bypass.log' 'task-state/D537.json' 'docs/foo.md' 'memory/notes/x.md')" = "1" ] \
  && ok "补记组合（bypass+task-state+docs+memory）→ fastlane" || no "补记组合应 fastlane"
# ③ 普通提交（src/ 代码）
[ "$(is_evidence_only 'src/server.ts')" = "0" ] && ok "普通提交（src/server.ts）→ 全量（防误放行）" || no "src 代码应全量"
# ④ 防绕过（.synova/skills/ 行为配置，非证据）
[ "$(is_evidence_only '.synova/skills/foo/SKILL.md')" = "0" ] && ok "技能文件（行为配置）→ 全量（非证据，防借道）" || no "技能文件应全量"
# ⑤ 混合（补记 + 代码）→ 全量
[ "$(is_evidence_only '.claude/bypass.log' 'src/server.ts')" = "0" ] && ok "混合（补记+代码）→ 全量" || no "混合应全量"

# ── merge commit 判定（MERGE_HEAD 存在 → fastlane）——结构断言 ──
grep -q 'MERGE_HEAD" ]]; then' "$SC" && grep -q 'FASTLANE_TRIGGER=1' "$SC" \
  && ok "merge commit 分支: MERGE_HEAD → FASTLANE_TRIGGER=1" || no "merge 分支判定缺失"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
