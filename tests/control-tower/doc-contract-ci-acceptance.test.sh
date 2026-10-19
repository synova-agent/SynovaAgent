#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# doc-contract-ci-acceptance.test.sh — #598 自证：闸 3 在 Gitea CI 不再空跑
#
# 覆盖（8 项）:
#   ① resolve-ci-base.sh 存在/可执行/契约齐
#   ② workflow 步骤①：注入 SYNO_DIFF_BASE ＋ GITHUB_ACTIONS=true，且调用 resolve-ci-base.sh
#   ③ workflow 步骤①d：改用 resolve-ci-base.sh（不再内联解析）＋ --changed-base
#   ④ ①d 块内 origin 字面 = 0（#610 语义保留）
#   ⑤ pre-commit：真实 CI 无 base ⇒ fail-loud（SYNO_CI=1 ∧ GITHUB_ACTIONS=true ⇒ exit 1）
#   ⑥ 闸 3 带 base 真判：沙箱新增 docs/plans/** 文档 ⇒ check-doc-contract --base ⇒ exit 1（FAIL）
#   ⑦ 本地软提示：暂存 docs/plans 文档 ＋ 无 SYNO_CI ⇒ pre-commit exit 0（不阻断）
#   ⑧ 自证结束清理（暂存/工作树干净）
#
# 用法: bash tests/control-tower/doc-contract-ci-acceptance.test.sh → 0 = 全过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPER="$ROOT/scripts/control-tower/resolve-ci-base.sh"
WF="$ROOT/.gitea/workflows/local-gates.yml"
PCC="$ROOT/scripts/pre-commit-check.sh"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL+1)); echo "  ❌ $1" >&2; }

echo "=== #598 自证：闸 3 CI base ═══"

# ① helper
if [ -x "$HELPER" ] && grep -q "@input" "$HELPER" && grep -q "@output" "$HELPER" && grep -q "@exit" "$HELPER"; then
  ok "① resolve-ci-base.sh 可执行＋契约齐"
else
  no "① resolve-ci-base.sh 缺失/不可执行/契约不全"
fi

# ② step ① 注入
STEP1="$(awk '/① 12 组门禁/{f=1} f{print} /①d 门禁本体自检/{if(f) exit}' "$WF")"
if printf '%s' "$STEP1" | grep -q 'resolve-ci-base.sh' \
   && printf '%s' "$STEP1" | grep -q 'SYNO_DIFF_BASE="\$BASE"' \
   && printf '%s' "$STEP1" | grep -q 'GITHUB_ACTIONS=true'; then
  ok "② 步骤① 注入 SYNO_DIFF_BASE ＋ GITHUB_ACTIONS=true ＋ helper"
else
  no "② 步骤① 未注入 base/CI 标记"
fi

# ③ step ①d 用 helper
STEP1D="$(awk '/①d 门禁本体自检/{f=1} f{print} /①b 看板真值/{if(f) exit}' "$WF")"
if printf '%s' "$STEP1D" | grep -q 'resolve-ci-base.sh' \
   && printf '%s' "$STEP1D" | grep -q -- '--changed-base "\$BASE"'; then
  ok "③ 步骤①d 改用 helper ＋ 保留 --changed-base"
else
  no "③ 步骤①d 未接 helper"
fi

# ④ ①d 块 origin 字面
N_ORIGIN=$(printf '%s' "$STEP1D" | grep -cE 'origin/local-main|origin/main' || true)
[ "${N_ORIGIN:-0}" -eq 0 ] && ok "④ ①d 块 origin 字面 = 0" || no "④ ①d 块出现 origin 字面=${N_ORIGIN}"

# ⑤ fail-loud：真实 CI 无 base
if grep -q 'CI 无 base（fail-closed' "$PCC"; then
  OUT=$( cd "$ROOT" && SYNO_CI=1 GITHUB_ACTIONS=true bash scripts/pre-commit-check.sh 2>&1 ); RC=$?
  if [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -q 'CI 无 base（fail-closed'; then
    ok "⑤ 真实 CI 无 base ⇒ fail-loud exit 1（实测）"
  else
    no "⑤ fail-loud 未触发（rc=${RC}）"
  fi
else
  no "⑤ pre-commit 缺 fail-loud 段"
fi

# ⑥ 闸 3 带 base 真判（沙箱）
SBX=$(mktemp -d /tmp/dc598.XXXXXX)
trap 'rm -rf "$SBX"; cd "$ROOT" && git reset -q HEAD -- docs/plans/codex/implementation/_probe_598.md 2>/dev/null; rm -f "$ROOT/docs/plans/codex/implementation/_probe_598.md"' EXIT
mkdir -p "$SBX/scripts/control-tower" "$SBX/docs/synova" "$SBX/docs/plans/codex/implementation"
cp "$ROOT/scripts/control-tower/check-doc-contract.sh" "$SBX/scripts/control-tower/"
cp "$ROOT/scripts/control-tower/validate_doc_contract.py" "$SBX/scripts/control-tower/"
cp "$ROOT/docs/synova/DOC-CONTRACT.md" "$SBX/docs/synova/"
git -C "$SBX" init -q; git -C "$SBX" config user.email t@t; git -C "$SBX" config user.name t
git -C "$SBX" add -A; git -C "$SBX" commit -qm base; BASE598=$(git -C "$SBX" rev-parse HEAD)
printf '# probe\n' > "$SBX/docs/plans/codex/implementation/_probe_598.md"
git -C "$SBX" add -A; git -C "$SBX" commit -qm probe
bash "$SBX/scripts/control-tower/check-doc-contract.sh" --base "$BASE598" > "$SBX/o.txt" 2>&1; RC=$?
if [ "$RC" -eq 1 ] && grep -q 'FAIL' "$SBX/o.txt"; then
  ok "⑥ 沙箱：新增 docs/plans/** ＋ --base ⇒ 闸 3 FAIL（exit 1）"
else
  no "⑥ 沙箱闸 3 未判红（rc=${RC}）"; tail -3 "$SBX/o.txt" >&2
fi

# ⑦ 本地软提示（暂存 docs/plans 文档，无 SYNO_CI）
printf '# probe local\n' > "$ROOT/docs/plans/codex/implementation/_probe_598.md"
git -C "$ROOT" add docs/plans/codex/implementation/_probe_598.md 2>/dev/null
OUT=$( cd "$ROOT" && bash scripts/pre-commit-check.sh 2>&1 ); RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '文档契约三闸'; then
  ok "⑦ 本地（无 SYNO_CI）暂存 docs/plans 文档 ⇒ 软提示 exit 0"
else
  no "⑦ 本地软提示失败（rc=${RC}）"
fi
git -C "$ROOT" reset -q HEAD -- docs/plans/codex/implementation/_probe_598.md 2>/dev/null; rm -f "$ROOT/docs/plans/codex/implementation/_probe_598.md"

# ⑧ 清理核验
git -C "$ROOT" status --porcelain | grep -q '_probe_598' && no "⑧ 清理未净（残留 _probe_598）" || ok "⑧ 清理干净（无 _probe_598 残留）"

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
