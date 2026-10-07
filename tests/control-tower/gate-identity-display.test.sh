#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gate-identity-display.test.sh — 卡 #1361 同族 · **消息层**两件（Lead 2026-10-08 批准）
#   ① 身份显示: claim 命中 ⇒ 点明**实际来源与值**（旧行 `claim → 未推断出` 会被读成推断失败）
#   ② 修复指引: **只列本分支真能用的路径**（无声明源时不消费正文豁免 ⇒ 不得把 ③ 列为可修路径）
#
# SUT: scripts/control-tower/merge_writeset_gate.py 的 `_emit`
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界 + 判别性 + 不回归）:
#   ①-a claim 命中（正向）⇒ 输出 `身份来源: claim → #9999（<claim 路径>）`
#        且**不得**出现「未推断出」（Lead 判据）
#   ①-b claim 存在但**畸形** ⇒ 走既有 `claim #9999 畸形 → fail-closed`；**不冒充**成功身份
#        （既无「未推断出」，也无 `身份来源: claim`）⇒ 与"未命中"可区分
#   ①-c 无 claim（legacy）⇒ 保留既有 `D# 推断来源: <src> → …` 形态（既有夹具钉着 explicit 形态）
#   ②-a 四源皆空 + 非文档文件 ⇒ 指引**二选一** + 显式声明「正文豁免在本分支不生效」（rc=2 不变）
#   ②-b 有声明源 + 夹带 ⇒ 指引**仍为三选一**（③ 在该分支真能用）⇒ 既有语义不回归
#   接线: 既有配对夹具 `merge_writeset_gate.test.sh` 的 `修复指引`/`D# 推断来源: explicit`
#        两条断言必须仍绿（本件不改它们的语境）
#
# 语义边界（本件**不**断言的事，防假超范围）:
#   · 不断言「让 not declared 分支真消费正文豁免」—— 属**语义变更**，须 K3→CTO 裁（待裁项）。
#   · 不断言退出码变化：① ② 两处的 status/rc 与改前逐字一致。
# 沙箱: mktemp 仓（有/无 helper 树、有/无 claim、claim 合法/畸形四态）+ 副本；零网络、零宿主写入。
# 用法: bash tests/control-tower/gate-identity-display.test.sh
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
echo "  #1361 同族消息层: 身份显示 + 修复指引（只列真能用的路径）"
echo "═══════════════════════════════════════════════════════════"

make_sb() {  # <dir> <with_helpers:1|0> <claim:writeset路径|NONE|MALFORMED>
  local d="$1" withh="$2" c="$3"
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
  case "$c" in
    NONE) : ;;
    MALFORMED) printf 'writeset:\ndone:\n  - verify: echo ok\n' > "$d/.claude/claims/9999.yaml" ;;
    *) printf 'writeset:\n  - %s\ndone:\n  - verify: bash tests/x.sh\nnote: probe\n' "$c" > "$d/.claude/claims/9999.yaml" ;;
  esac
}
run_gate() {  # <repo-root> → 输出落 $TMPD/gate.out，printf rc
  "$PYBIN" "$GATE" --repo-root "$1" --base main --head HEAD --branch feat/9999-drill --issue 9999 \
    >"$TMPD/gate.out" 2>&1
  printf '%s' "$?"
}

# ── ①-a claim 命中 ⇒ 点明实际来源与值；不得出现「未推断出」──
SB_A="$TMPD/a"; make_sb "$SB_A" 1 "scripts/a.sh"
RC_A="$(run_gate "$SB_A")"
if [ "$RC_A" = "0" ] && grep -q '身份来源: claim → #9999' "$TMPD/gate.out"; then
  ok "①-a claim 命中 ⇒ 身份行点明实际来源与值（#9999）"
else
  no "①-a 身份行未点明来源/值（rc=${RC_A}）: $(grep -m2 '来源' "$TMPD/gate.out")"
fi
if grep -q '未推断出' "$TMPD/gate.out"; then
  no "①-a 仍出现「未推断出」（claim 已给出身份，不得读成推断失败）"
else
  ok "①-a 无「未推断出」字样（Lead 判据）"
fi
if grep -q '\.claude/claims/9999.yaml' "$TMPD/gate.out"; then
  ok "①-a 身份行同时给出声明件路径（可追溯）"
else
  no "①-a 身份行未给出声明件路径"
fi

# ── ①-b claim 存在但畸形 ⇒ 既有畸形路径；不冒充成功身份 ──
SB_B="$TMPD/b"; make_sb "$SB_B" 1 "MALFORMED"
RC_B="$(run_gate "$SB_B")"
if [ "$RC_B" = "2" ] && grep -q 'claim #9999 畸形' "$TMPD/gate.out"; then
  ok "①-b 畸形 claim ⇒ 既有 claim #9999 畸形 → fail-closed 路径（rc=2 不变）"
else
  no "①-b 畸形路径异常（rc=${RC_B}）: $(tail -2 "$TMPD/gate.out")"
fi
if grep -q '未推断出' "$TMPD/gate.out" || grep -q '身份来源: claim' "$TMPD/gate.out"; then
  no "①-b 畸形场景冒充了成功身份或打出「未推断出」（与"未命中"不可区分）"
else
  ok "①-b 畸形场景**不冒充**成功身份、也无「未推断出」⇒ 与未命中可区分"
fi

# ── ①-c 无 claim（legacy）⇒ 既有形态保留（既有夹具钉 explicit 形态）──
SB_C="$TMPD/c"; make_sb "$SB_C" 1 "NONE"
RC_C="$(run_gate "$SB_C")"
if grep -q 'D# 推断来源:' "$TMPD/gate.out"; then
  ok "①-c 无 claim ⇒ 保留既有 D# 推断来源: <src> → … 形态（legacy 可诊断）"
else
  no "①-c legacy 身份行丢失（rc=${RC_C}）: $(grep -m1 '结论' "$TMPD/gate.out")"
fi

# ── ②-a 四源皆空 + 非文档文件 ⇒ 指引二选一 + 明示正文豁免不生效 ──
SB_D="$TMPD/d"; make_sb "$SB_D" 1 "NONE"
RC_D="$(run_gate "$SB_D")"
if [ "$RC_D" = "2" ] && grep -q '修复指引（二选一' "$TMPD/gate.out"; then
  ok "②-a 四源皆空 ⇒ 指引**二选一**（rc=2 不变）"
else
  no "②-a 指引未按上下文收敛（rc=${RC_D}）: $(grep -m1 '修复指引' "$TMPD/gate.out")"
fi
if grep -q '正文 `## 写集豁免` 在\*\*本分支不生效\*\*' "$TMPD/gate.out"; then
  ok "②-a 明示「正文豁免在本分支不生效」（指引与实现一致）"
else
  no "②-a 未明示正文豁免不生效"
fi
if grep -q '可直接粘贴的精确豁免行' "$TMPD/gate.out"; then
  no "②-a 仍给出不可用的「可直接粘贴豁免行」（该分支不消费正文豁免）"
else
  ok "②-a 不再给出不可用的粘贴行"
fi

# ── ②-b 有声明源 + 夹带 ⇒ 三选一保留（③ 在该分支真能用）──
SB_E="$TMPD/e"; make_sb "$SB_E" 1 "scripts/other.sh"
RC_E="$(run_gate "$SB_E")"
if [ "$RC_E" = "1" ] && grep -q '修复指引（三选一' "$TMPD/gate.out" && grep -q '可直接粘贴的精确豁免行' "$TMPD/gate.out"; then
  ok "②-b 有声明源 + 夹带 ⇒ 三选一保留（③ 真能用）⇒ 既有语义不回归"
else
  no "②-b 夹带分支指引回归（rc=${RC_E}）: $(grep -m1 '修复指引' "$TMPD/gate.out")"
fi

# ── 接线: 既有配对夹具的两条断言语境不得被本件改坏 ──
PAIRED="$REPO/tests/control-tower/merge_writeset_gate.test.sh"
if output="$(bash "$PAIRED" 2>&1)"; then
  ok "接线: 既有配对夹具 merge_writeset_gate.test.sh 全绿（$(printf '%s' "$output" | grep -oE '结果: [0-9]+ 通过, [0-9]+ 失败' | tail -1)）"
else
  no "接线: 既有配对夹具红（本件的显示改动打坏了它的语境）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
