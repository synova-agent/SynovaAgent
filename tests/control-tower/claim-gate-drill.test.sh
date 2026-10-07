#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# claim-gate-drill.test.sh — D1241/D-C③: claim 身份通道「仓内可跑」演练（新格式改坏即红的地基）
#
# 背景（2026-10-08，Lead 受控沙箱实测 → 本夹具定性）:
#   沙箱仓 + 合法 claim(#9999) + 分支名带 9999 + `--issue 9999` + `--repo-root <沙箱>`
#     ⇒ gate 输出「⚠️ degraded — 四源皆空 → fail-closed」，看似"身份通道在异 root 读不到"。
#   实测真因（本夹具 A/D 两组对照证明）: gate 的 `collect_declared` 把 **helper 脚本**
#     （`brief_parser.py` / `devdoc_writeset.py`）定位在 `<repo-root>/scripts/control-tower/` 下，
#     **不是**脚本自身所在仓。沙箱里没有这棵 helper 树 ⇒ `python3 <缺失路径>` 退出码 **2**
#     （Python "can't open file"）⇒ 该源被记为"解析失败" ⇒ S0 空 ⇒ 四源皆空 ⇒ fail-closed。
#   ⇒ **不是**"claim 在异 root 读不到"（claim_store 自己读得到，变更集/merge-base 也正确指向沙箱）。
#
# 前提（本夹具钉死的那一条）: `--repo-root` 指向的树**必须带本仓 scripts/ 树**
#   —— 真仓 worktree 天然满足；裸沙箱须先 `cp -R <repo>/scripts <sandbox>/`（既有
#   merge_writeset_gate.test.sh 一直这么做，即此前提的既有隐性约定）。
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界 + 判别性 + 因果对照）:
#   A 正常  — helper 树在 repo-root 内 + 合法 claim + 分支名带 issue + `--issue`
#             ⇒ **pass（rc=0）且声明来源 = `S0:claim.writeset`**（= D-C Done ③ 的"新格式"正向）
#   D 因果  — **唯一变量对照**：同 claim、同变更集、只去掉 helper 树 ⇒ degraded（rc=2）
#             且告警点名 `S0 claim 解析失败` ⇒ 证明上面那条机制的**因果**（而非"异 root 读不到"）
#   B 降级  — claim 畸形（writeset 为空）⇒ `claim-invalid` ⇒ degraded rc=2（fail-closed，拒半套声明）
#   C 边界  — claim 合法但写集不含变更文件 ⇒ rc=1 夹带（既有对账语义不回归）
#   A(ii) 身份— 身份字段断言: `task_id_source == claim`（卡 #1224 Done③ 判据 · 正向）
#   M 变异  — 把 claim 优先降级为 D# 优先（`if claim_path_found:` 中和）⇒ 身份来源必变
#             ⇒ A(ii) 断言必红（卡 #1224 Done③ 判据 · 判别性）
#   E 接线  — A 组必须真的走 claim 源（断言 `S0:claim.writeset`），防夹具自己退回 D# legacy 而假绿
# 语义边界（本件**不**断言的事）:
#   · 不改判据、不修 helper 定位策略 —— 只把现状与因果钉成可执行断言（返工与否由 Lead/K3 裁）。
#   · 不断言 CI 路径（CI 的 root 恒为真仓 ⇒ 前提天然满足）。
# 沙箱: mktemp 仓 + 复制本仓 scripts（前提显式化）；零网络、零宿主写入。
# 用法: bash tests/control-tower/claim-gate-drill.test.sh
# 退出码: 0 = 全绿；1 = 断言失败；2 = 检查自身失败（缺 python / 缺 SUT）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/merge_writeset_gate.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }
[ -f "$GATE" ] || { echo "  ❌ SUT 缺失: $GATE"; exit 2; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "═══════════════════════════════════════════════════════════"
echo "  claim 身份通道仓内演练（D-C③ / #1224 · 起点 = Lead 沙箱实测）"
echo "═══════════════════════════════════════════════════════════"

# ── 沙箱构造: 真仓 worktree 的等价前提 = 仓内带 scripts/ 树 ──────────────────
build_sb() {  # <dir> <with_helpers:1|0>
  local d="$1" withh="$2"
  mkdir -p "$d/.claude/claims"
  git -C "$d" init -q -b main >/dev/null 2>&1
  echo base > "$d/README.md"
  git -C "$d" add README.md >/dev/null 2>&1
  git -C "$d" -c user.name=t -c user.email=t@t commit -qm "chore: base" >/dev/null 2>&1
  git -C "$d" checkout -qb feat/9999-drill >/dev/null 2>&1
  if [ "$withh" = "1" ]; then cp -R "$REPO/scripts" "$d/scripts"; fi
  mkdir -p "$d/scripts"
  echo "drill" > "$d/scripts/drill-target.sh"
  git -C "$d" add scripts/drill-target.sh >/dev/null 2>&1
  git -C "$d" -c user.name=t -c user.email=t@t commit -qm "feat(#9999): drill target" >/dev/null 2>&1
}

write_claim() {  # <dir> <writeset-entry>
  cat > "$1/.claude/claims/9999.yaml" <<CLAIMEOF
writeset:
  - $2
done:
  - verify: bash tests/control-tower/claim-gate-drill.test.sh
CLAIMEOF
}

run_gate() {  # <dir> → 输出落 $TMPD/gate.out，printf rc
  "$PYBIN" "$GATE" --repo-root "$1" --base main --head HEAD \
    --branch feat/9999-drill --issue 9999 >"$TMPD/gate.out" 2>&1
  printf '%s' "$?"
}
run_gate_json() {  # <dir> <gate-path> → JSON 落 $TMPD/gate.json，printf rc（<gate-path> 供变异体用沙箱副本）
  "$PYBIN" "$2" --repo-root "$1" --base main --head HEAD \
    --branch feat/9999-drill --issue 9999 --json >"$TMPD/gate.json" 2>&1
  printf '%s' "$?"
}
jq_field() {  # <field> → $TMPD/gate.json 里的取值（不引入 jq 依赖）
  "$PYBIN" -c "import json,sys; d=json.load(open(sys.argv[1],encoding='utf-8',errors='replace')); print(d.get(sys.argv[2]))" \
    "$TMPD/gate.json" "$1" 2>/dev/null || true  # swallow-ok: JSON 不可解析 → 空串，由断言判红（不静默当通过）
}

# ── A 正常: helper 树在 repo-root 内（真仓 worktree 等价前提）⇒ pass + S0 claim ──
SB_A="$TMPD/sb-a"; build_sb "$SB_A" 1; write_claim "$SB_A" "scripts/drill-target.sh"
if [ -f "$SB_A/scripts/control-tower/claim_store.py" ] && [ -f "$SB_A/scripts/control-tower/brief_parser.py" ]; then
  ok "A 前提就位: repo-root 内带 helper 树（真仓 worktree 天然如此）"
else
  no "A 前提缺失: 复制后的 scripts 树不完整（夹具自身构造失败）"
fi
RC_A="$(run_gate "$SB_A")"
if [ "$RC_A" = "0" ] && grep -q 'S0:claim.writeset' "$TMPD/gate.out"; then
  ok "A 合法 claim + 分支名带 issue ⇒ pass，声明来源 = S0:claim.writeset（D-C Done ③ 正向）"
else
  no "A claim 通道未生效（rc=${RC_A}）: $(tail -4 "$TMPD/gate.out")"
fi
if grep -q '结论: pass' "$TMPD/gate.out"; then ok "A 结论行 pass（无夹带）"; else no "A 结论非 pass"; fi

# ── A(ii) 身份字段（卡 #1224 Done③ 判据 · 正向）: 身份来源必须是 claim ──
RC_AJ="$(run_gate_json "$SB_A" "$GATE")"
TID_SRC="$(jq_field task_id_source)"
ISS_SRC="$(jq_field issue_source)"
if [ "$RC_AJ" = "0" ] && [ "$TID_SRC" = "claim" ]; then
  ok "A(ii) 身份来源 = claim（issue_source=${ISS_SRC}）⇒ 新格式身份成立"
else
  no "A(ii) 身份来源非 claim（rc=${RC_AJ} task_id_source=${TID_SRC}）"
fi

# ── M 变异体（卡 #1224 Done③ 判据 · 判别性）: claim 优先降级为 D# 优先 ⇒ 身份必变 ──
SB_M="$TMPD/sb-m"; build_sb "$SB_M" 1; write_claim "$SB_M" "scripts/drill-target.sh"
"$PYBIN" - "$SB_M/scripts/control-tower/merge_writeset_gate.py" >"$TMPD/mut-m.log" 2>&1 <<'PYMUTM'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text(encoding='utf-8')
anchor = '    if claim_path_found:'
assert anchor in t, '夹具写集漂移：未找到 claim 优先分支锚点（判据锚点已改名/已重构）'
p.write_text(t.replace(anchor, '    if False:  # MUTANT: claim 优先被降级为 D# 优先', 1), encoding='utf-8')
print('M 注入: claim 优先分支已中和')
PYMUTM
RC_M="$(run_gate_json "$SB_M" "$SB_M/scripts/control-tower/merge_writeset_gate.py")"
MUT_SRC="$(jq_field task_id_source)"
if [ "$MUT_SRC" != "claim" ]; then
  ok "M 变异体: claim 优先被降级 ⇒ 身份来源变为 ${MUT_SRC} ⇒ A(ii) 断言必红（对 claim 优先被拆有判别力）"
else
  no "M 变异体: 身份来源仍为 claim —— 判别力失效（A(ii) 未绑到 claim 优先）"
fi

# ── E 接线: A 组必须真走 claim 源（若退回 D# legacy，上面那条会红 ⇒ 此处复述口径）──
if grep -q 'S0:claim.writeset' "$TMPD/gate.out" && ! grep -q 'S3:brief.Q2-include' "$TMPD/gate.out"; then
  ok "E 接线: 命中 claim 源且**未**回落 brief/D# 链（防夹具假绿）"
else
  no "E 接线异常（命中来源与预期不符）: $(grep -E 'S[0-3]:' "$TMPD/gate.out" | head -3)"
fi

# ── D 因果对照: 同 claim / 同变更集，只去掉 helper 树 ⇒ degraded（唯一变量）──
SB_D="$TMPD/sb-d"; build_sb "$SB_D" 0; write_claim "$SB_D" "scripts/drill-target.sh"
RC_D="$(run_gate "$SB_D")"
if [ "$RC_D" = "2" ] && grep -q 'S0 claim 解析失败' "$TMPD/gate.out"; then
  ok "D 唯一变量（去 helper 树）⇒ rc=2 且点名 S0 解析失败 ⇒ 机制因果成立（非'异 root 读不到 claim'）"
else
  no "D 对照未复现（rc=${RC_D}）: $(tail -4 "$TMPD/gate.out")"
fi
if grep -q '四源皆空' "$TMPD/gate.out"; then
  ok "D 复现 Lead 沙箱观感「四源皆空」⇒ 该措辞是**误诊面**（真因=helper 树缺失）"
else
  no "D 未复现「四源皆空」措辞（Lead 观感不可复现 ⇒ 判据漂移）"
fi

# ── B 降级: claim 畸形（writeset 空）⇒ claim-invalid ⇒ fail-closed ──
SB_B="$TMPD/sb-b"; build_sb "$SB_B" 1
cat > "$SB_B/.claude/claims/9999.yaml" <<'BADEOF'
writeset:
done:
  - verify: echo ok
BADEOF
RC_B="$(run_gate "$SB_B")"
if [ "$RC_B" = "2" ] && grep -q 'claim #9999 畸形' "$TMPD/gate.out" && grep -q 'fail-closed' "$TMPD/gate.out"; then
  ok "B 畸形 claim（writeset 空）⇒ claim-invalid 口径 ⇒ degraded rc=2（拒半套声明，fail-closed）"
else
  no "B 畸形 claim 未 fail-closed（rc=${RC_B}）: $(tail -4 "$TMPD/gate.out")"
fi

# ── C 边界: claim 合法但写集不含变更文件 ⇒ 夹带 exit 1 ──
SB_C="$TMPD/sb-c"; build_sb "$SB_C" 1; write_claim "$SB_C" "scripts/other-file.sh"
RC_C="$(run_gate "$SB_C")"
if [ "$RC_C" = "1" ] && grep -q '夹带' "$TMPD/gate.out"; then
  ok "C 写集不含变更文件 ⇒ exit 1 夹带（既有对账语义不回归）"
else
  no "C 夹带判定异常（rc=${RC_C}）: $(tail -4 "$TMPD/gate.out")"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
