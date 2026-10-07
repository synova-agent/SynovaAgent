#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# b-followers-claim-consistency.test.sh — D-C 退场口径 · **B 类跟随面一致性断言**
#   （卡 #1224：B 类「不改，但须加一致性断言：A 类切完后 B 类输出不得出现 D# 专属形态」）
#
# B 类定义（卡 #1224 口径）: 经 `resolve-commit-brief.sh` **间接**消费声明、
#   自身**不判身份**的消费者。它们的风险 = **跟随者漏改**：A 类（身份判定核心）切到
#   claim 格式后，B 类仍按「声明件文件名里的 D#」派生身份 ⇒ 输出空身份/空转而不报错。
#
# 覆盖矩阵（铁律 48: 正常 / 边界 + 判别性 + 接线）:
#   §1 枚举闭包 — 「经 resolver 间接」的消费点集合 == 已分类白名单（A 类 5 ∪ B 类 6）
#                 ⇒ 出现**新 follower** 即红（必须先分类，防悄悄新增）
#   §2 形态网   — B 类成员命中「D#-专属身份派生」且**无** claim/issue 容错 ⇒ 必须登记
#                 `tests/control-tower/b-followers-baseline.txt`（owner/expires/reason；
#                 条目失效或到期 ⇒ 红 = 棘轮只减不增）
#   §3 行为网   — **claim 载体可消费**（开关只在沙箱内注入）: 分支带 issue + claim + `SYNO_CLAIM_V2=1`
#                 ⇒ B 类消费者输出**不是空转**（断言正向输出与 rc）；对照组（分支不带 issue）
#                 ⇒ 显式 fail-closed（不是静默跳过）
#   §4 接线     — baseline 条目格式合规（owner=/expires=/reason= 齐全；文件真实存在）
#
# 语义边界（本件**不**断言的事，防假绿）:
#   · **不改** B 类任何文件（卡口径：B 类不改，只加断言）；本件是纯夹具 + 台账。
#   · 不判「A 类切换时点」（那是 CTO 裁决项）；本件只保证**跟随面在切换那天不会静默**。
#   · 不测 A 类（身份核心）行为 —— 那是 claim-identity-v2 / claim-gate-drill 的职责。
# 沙箱: mktemp 仓 + 复制本仓 scripts；零网络、零宿主写入；`SYNO_CLAIM_V2=1` **仅**在沙箱注入。
# 用法: bash tests/control-tower/b-followers-claim-consistency.test.sh
# 退出码: 0 = 全绿；1 = 断言失败；2 = 检查自身失败（缺 SUT / 缺 python）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="$REPO/tests/control-tower/b-followers-baseline.txt"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

# ── 分类白名单（卡 #1224 口径；新增成员必须先在此分类，否则 §1 红）──────────────
A_CLASS="scripts/commit-msg-check.sh
scripts/pre-commit-check.sh
scripts/control-tower/merge_writeset_gate.py
scripts/workflow/resolve-commit-brief.sh
scripts/control-tower/brief_parser.py"
B_CLASS="scripts/check-plan-integrity.sh
scripts/project/pr-queue-scan.py
scripts/workflow/check-brief-parseable.sh
scripts/workflow/check-brief-vs-code.sh
scripts/check-brief-vs-code.sh
scripts/check-verifiable-done.sh"

[ -f "$BASE" ] || { echo "  ❌ 台账缺失: ${BASE}（检查自身失败）"; exit 2; }

echo "═══════════════════════════════════════════════════════════"
echo "  B 类跟随面一致性断言（D-C 退场口径 · 卡 #1224）"
echo "═══════════════════════════════════════════════════════════"

# ── §1 枚举闭包: 消费点集合必须已被分类（防新 follower 悄悄出现）──
DISCOVERED="$(grep -rl 'resolve-commit-brief' --include='*.sh' --include='*.py' "$REPO/scripts" \
  | sed "s|^$REPO/||" | sort -u)"
DECLARED="$(printf '%s\n%s\n' "$A_CLASS" "$B_CLASS" | grep -v '^$' | sort -u)"
if [ "$DISCOVERED" = "$DECLARED" ]; then
  ok "§1 枚举闭包: resolver 消费点 $(printf '%s\n' "$DECLARED" | grep -c .) 个，全部已分类（A∪B）"
else
  no "§1 出现未分类消费点（新 follower 必须先分类）:"
  diff <(printf '%s\n' "$DECLARED") <(printf '%s\n' "$DISCOVERED") | sed 's/^/     /' | head -8
fi
for _f in $A_CLASS $B_CLASS; do
  [ -f "$REPO/$_f" ] || no "§1 白名单成员不存在（分类漂移）: $_f"
done

# ── §2 形态网: B 类的「D#-专属身份派生」必须带 claim 容错，或**可见登记**台账 ──
echo ""
B_D_ONLY=""
for _f in $B_CLASS; do
  [ -f "$REPO/$_f" ] || continue
  _n="$(grep -cE 'D\[0-9\]|D#|parse_did|DID_RE' "$REPO/$_f" 2>/dev/null || true)"
  case "${_n:-0}" in ''|*[!0-9]*) _n=0 ;; esac
  [ "$_n" -gt 0 ] || continue
  if grep -qE '\*\.yaml\)|claim_store|claim_path' "$REPO/$_f" 2>/dev/null; then
    ok "§2 $(basename "$_f"): 有 D# 形态但同存 claim 容错（可跟随）"
  elif grep -qF "$_f" "$BASE" 2>/dev/null; then
    B_D_ONLY="${B_D_ONLY}${_f} "
    ok "§2 $(basename "$_f"): 有 D# 形态、无 claim 容错 ⇒ **已可见登记台账**（待改面，非隐藏）"
  else
    no "§2 $(basename "$_f"): 有 D# 形态、无 claim 容错、**未登记台账**（跟随者漏改面被静默）"
  fi
done
# 台账: 每个无容错者必须在 baseline 登记（否则上面已红；此处校验登记质量）
while IFS= read -r _line; do
  case "$_line" in ''|'#'*) continue ;; esac
  _path="${_line%%:*}"
  if [ -f "$REPO/$_path" ]; then ok "§4 台账条目文件存在: $_path"; else no "§4 台账条目文件不存在（失效条目）: $_path"; fi
  for _k in owner= expires= reason=; do
    case "$_line" in *"$_k"*) ;; *) no "§4 台账条目缺 $_k: $_line" ;; esac
  done
  # expires 到期即红（棘轮）
  _exp="$(printf '%s' "$_line" | sed -n 's/.*expires=\([0-9-]\{10\}\).*/\1/p')"
  if [ -n "$_exp" ]; then
    if [ "$(date +%Y-%m-%d)" \> "$_exp" ]; then no "§4 台账条目已过期（须续期或修掉）: $_exp"; else ok "§4 台账条目未过期: $_exp"; fi
  fi
done < "$BASE"
if [ -n "$B_D_ONLY" ]; then
  echo "  ℹ §2 待改面清单（已登记台账、可见不隐藏）: ${B_D_ONLY}"
fi

# ── §3 行为网: claim 载体可消费（开关仅沙箱注入）──
echo ""
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
make_sb() {  # <dir> <branch>
  local d="$1" b="$2"
  mkdir -p "$d/.claude/claims"
  cp -R "$REPO/scripts" "$d/scripts"
  git -C "$d" init -q -b main >/dev/null 2>&1
  echo x > "$d/scripts/target.sh"
  git -C "$d" add scripts/target.sh >/dev/null 2>&1
  git -C "$d" -c user.name=t -c user.email=t@t commit -qm "feat(#9999): base" >/dev/null 2>&1
  printf 'writeset:\n  - scripts/target.sh\ndone:\n  - verify: bash tests/x.sh\nnote: probe\n' > "$d/.claude/claims/9999.yaml"
  git -C "$d" add .claude/claims/9999.yaml >/dev/null 2>&1
  git -C "$d" -c user.name=t -c user.email=t@t commit -qm "feat(#9999): claim" >/dev/null 2>&1
  git -C "$d" checkout -qb "$b" >/dev/null 2>&1
}
SB1="$TMPD/sb-ok"; make_sb "$SB1" "feat/9999-drill"
OUT1="$(cd "$SB1" && SYNO_CLAIM_V2=1 bash scripts/check-verifiable-done.sh 2>&1)"; RC1=$?
if [ "$RC1" = "0" ] && printf '%s' "$OUT1" | grep -q '全部有 verify'; then
  ok "§3 claim 载体可消费: check-verifiable-done.sh 读到 claim.done ⇒ rc=0（跟随面在新格式下工作）"
else
  no "§3 claim 载体消费失败（rc=${RC1}）: $(printf '%s' "$OUT1" | tail -3)"
fi
if printf '%s' "$OUT1" | grep -qE '解析不出任何声明|无 task brief|跳过'; then
  no "§3 正向场景出现空转文案（载体未被识别）"
else
  ok "§3 正向场景无空转文案（claim 被当成声明件）"
fi
SB2="$TMPD/sb-nobranch"; make_sb "$SB2" "feat/drill-without-issue"
echo y > "$SB2/scripts/target2.sh"
git -C "$SB2" add scripts/target2.sh >/dev/null 2>&1   # 非空暂存集 = 触发声明解析（空集走 fail-open 跳过，非本断言对象）
OUT2="$(cd "$SB2" && SYNO_CLAIM_V2=1 bash scripts/check-verifiable-done.sh 2>&1)"; RC2=$?
if [ "$RC2" = "1" ] && printf '%s' "$OUT2" | grep -q '解析不出任何声明'; then
  ok "§3 对照（分支不带 issue）⇒ 显式 fail-closed rc=1 ⇒ 身份来源口径差异可见、不静默"
else
  no "§3 对照未显式失败（rc=${RC2}）: $(printf '%s' "$OUT2" | head -2)"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
