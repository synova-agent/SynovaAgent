#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gate-helper-precondition.test.sh — 卡 #1361（D1245）**候选 B**：helper 前提缺失 ⇒ 显式点名
#
# SUT: scripts/control-tower/merge_writeset_gate.py 的 `collect_declared` / `_helper_precondition`
#      （**仅消息层**：helper 定位策略**未改**；判定/退出码/正向行为逐字不变）
#
# 病灶（#1353 唯一变量对照已锁死）: helper 脚本按 `<repo-root>/scripts/control-tower/` 定位，
#   该树缺失时 `python3 <缺失路径>` 退出码 2（Python "can't open file"）⇒ S0 记「解析失败」
#   ⇒ 四源皆空 ⇒ fail-closed ⇒ 报错**观感**是"claim 读不到"（真因 = 前提缺失）。
#
# 覆盖矩阵（卡 #1361 四条判据 + 铁律 48 正常/降级/边界）:
#   ① 裸沙箱（无 helper 树）⇒ 必须**点名 helper 缺失**（不得表现为"claim 读不到"）
#   ② 真仓等价前提（带 helper 树）⇒ 行为**不变**（无前提告警 + 结论 pass）
#   ③ 变异体 = **候选 A 生效形态**（helper 定位改脚本相对）⇒ 裸沙箱**能解析**（rc 0、零前提告警）
#      ⇒ 本件 ① 与 **#1353 的 D 断言**（去 helper 树 ⇒ 必须 rc=2 + 点名）同时必红
#      ⇒ 证明「候选 A 一旦落地而两支夹具未同步改 = 红」（改坏即红回路成立）
#   ④ 反例（不误报）: helper 在 + claim 畸形 ⇒ 走既有「解析失败」路径，**不得**出现 helper 缺失字样
#   接线: 保留 `S0 claim 解析失败` 稳定串 ⇒ #1353 夹具零 churn（跨 PR 不互相打断）
#
# 语义边界（本件**不**断言的事）:
#   · 不断言定位策略本身（候选 A/C 属**行为变更**，须 K3→CTO 裁；本件只测"候选 B 的消息层"）。
#   · 不断言退出码变化（① 与 ② 的 rc 与改前逐字一致）。
# 沙箱: mktemp 仓（有/无 helper 树两态）+ 副本变异；零网络、零宿主写入。
# 用法: bash tests/control-tower/gate-helper-precondition.test.sh
# 退出码: 0 = 全绿；1 = 断言失败；2 = 检查自身失败
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
echo "  #1361 候选 B: helper 前提缺失 ⇒ 显式点名（仅消息层）"
echo "═══════════════════════════════════════════════════════════"

make_sb() {  # <dir> <with_helpers:1|0>
  local d="$1" withh="$2"
  mkdir -p "$d/.claude/claims" "$d/scripts"
  if [ "$withh" = "1" ]; then cp -R "$REPO/scripts/." "$d/scripts/"; fi
  git -C "$d" init -q -b main >/dev/null 2>&1
  echo base > "$d/README.md"
  git -C "$d" add README.md >/dev/null 2>&1
  git -C "$d" -c user.name=t -c user.email=t@t commit -qm "chore: base" >/dev/null 2>&1
  git -C "$d" checkout -qb feat/9999-drill >/dev/null 2>&1
  echo y > "$d/scripts/a.sh"
  git -C "$d" add scripts/a.sh >/dev/null 2>&1
  git -C "$d" -c user.name=t -c user.email=t@t commit -qm "feat(#9999): change" >/dev/null 2>&1
  printf 'writeset:\n  - scripts/a.sh\ndone:\n  - verify: bash tests/x.sh\nnote: probe\n' > "$d/.claude/claims/9999.yaml"
}
run_gate() {  # <gate-path> <repo-root> → 输出落 $TMPD/gate.out，printf rc
  "$PYBIN" "$1" --repo-root "$2" --base main --head HEAD --branch feat/9999-drill --issue 9999 \
    >"$TMPD/gate.out" 2>&1
  printf '%s' "$?"
}

# ── ① 裸沙箱（无 helper 树）⇒ 点名 helper 缺失 ──
SB_BARE="$TMPD/bare"; make_sb "$SB_BARE" 0
RC1="$(run_gate "$GATE" "$SB_BARE")"
if [ "$RC1" = "2" ] && grep -q 'helper 脚本缺失' "$TMPD/gate.out"; then
  ok "① 裸沙箱 ⇒ rc=2（行为不变）+ 点名「helper 脚本缺失」（判据①）"
else
  no "① 裸沙箱未点名 helper 缺失（rc=${RC1}）: $(tail -3 "$TMPD/gate.out")"
fi
if grep -q '真因: helper 脚本缺失' "$TMPD/gate.out"; then
  ok "① fail-closed 报文里**指认真因**（不再让人读成「claim 读不到」）"
else
  no "① 报文未指认真因: $(grep -m1 '结论' "$TMPD/gate.out")"
fi
if grep -q '不是「claim 读不到」' "$TMPD/gate.out"; then
  ok "① 显式否定误导读法（「不是 claim 读不到」）"
else
  no "① 未显式否定误导读法"
fi
if grep -q 'S0 claim 解析失败' "$TMPD/gate.out"; then
  ok "① 稳定串仍在（S0 claim 解析失败）⇒ #1353 夹具零 churn（跨 PR 不互相打断）"
else
  no "① 稳定串丢失 ⇒ #1353 的 D 断言会红（跨 PR churn）"
fi

# ── ② 真仓等价前提（带 helper 树）⇒ 行为不变 ──
SB_OK="$TMPD/ok"; make_sb "$SB_OK" 1
RC2="$(run_gate "$GATE" "$SB_OK")"
if [ "$RC2" = "0" ] && grep -q '结论: pass' "$TMPD/gate.out"; then
  ok "② 真仓等价前提 ⇒ pass rc=0（正向未被改坏，判据②）"
else
  no "② 正向被改坏（rc=${RC2}）: $(tail -3 "$TMPD/gate.out")"
fi
if grep -q 'helper 脚本缺失' "$TMPD/gate.out"; then
  no "② helper 树在场却报「helper 缺失」= 误报"
else
  ok "② helper 树在场 ⇒ 零前提告警（不误报）"
fi

# ── ④ 反例（不误报）: helper 在 + claim 畸形 ⇒ 既有路径，无 helper 缺失字样 ──
SB_BAD="$TMPD/bad"; make_sb "$SB_BAD" 1
printf 'writeset:\ndone:\n  - verify: echo ok\n' > "$SB_BAD/.claude/claims/9999.yaml"
RC4="$(run_gate "$GATE" "$SB_BAD")"
if [ "$RC4" = "2" ] && grep -q 'claim #9999 畸形' "$TMPD/gate.out" && ! grep -q 'helper 脚本缺失' "$TMPD/gate.out"; then
  ok "④ claim 畸形（helper 在场）⇒ 走既有畸形路径，未误报 helper 缺失"
else
  no "④ 畸形路径异常（rc=${RC4}）: $(tail -3 "$TMPD/gate.out")"
fi

# ── ③ 变异体 = 候选 A 生效形态（定位改脚本相对）⇒ 裸沙箱能解析 ⇒ ①② 与 #1353 D 必红 ──
MUT="$TMPD/mutgate"; mkdir -p "$MUT"
cp "$REPO/scripts/control-tower/merge_writeset_gate.py" "$MUT/"
cp "$REPO/scripts/control-tower/brief_parser.py" "$REPO/scripts/control-tower/claim_store.py" \
   "$REPO/scripts/control-tower/devdoc_writeset.py" "$MUT/" 2>/dev/null || true
"$PYBIN" - "$MUT/merge_writeset_gate.py" >"$TMPD/mut.log" 2>&1 <<'PYMUT'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text(encoding='utf-8')
anchor = 'bp = Path(repo) / "scripts" / "control-tower" / "brief_parser.py"'
assert anchor in t, '夹具写集漂移：未找到 helper 定位锚点（判据锚点已改名/已重构）'
# 候选 A 的等价形态：helper 定位改**脚本相对**（本处仅用于演示"候选 A 落地后"的判据回路）
p.write_text(t.replace(anchor, 'bp = Path(__file__).resolve().parent / "brief_parser.py"', 1),
             encoding='utf-8')
print('M 注入: helper 定位 → 脚本相对（候选 A 形态）')
PYMUT
RC3="$(run_gate "$MUT/merge_writeset_gate.py" "$SB_BARE")"
if [ "$RC3" = "0" ] && ! grep -q 'helper 脚本缺失' "$TMPD/gate.out"; then
  ok "③ 变异体（候选 A 定位）: 裸沙箱**能解析** ⇒ 本件 ① 与 #1353 的 D 断言（去 helper 树 ⇒ 必须 rc=2+点名）同时必红 ⇒ 改坏即红回路成立"
else
  no "③ 变异体未复现（rc=${RC3}）—— 判据回路失效: $(tail -3 "$TMPD/gate.out")"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
