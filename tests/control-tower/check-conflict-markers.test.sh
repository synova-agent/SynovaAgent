#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# check-conflict-markers.test.sh — 冲突标记机检的配对测试（CT-40）
#
# 背景：2026-11-02 实证——带 `<<<<<<<` 的合并提交在 CI 上跑出 success（全仓无机检）。
# 覆盖：① 干净 ⇒ 0 ② staged 三形态（open/sep/close）⇒ 1 并逐条点名
#       ③ diff3 的 `|||||||` 形态 ⇒ 1 ④ `.md` 不在面内 ⇒ 0（防误杀文档）
#       ⑤ 同行 `conflict-marker-ok` 逐行豁免 ⇒ 0 ⑥ base 模式（`<ref>...HEAD`）⇒ 1
#       ⑦ base 不可解析 ⇒ 2 ⑧ 非 git ⇒ 2＋降级日志 ⑨ --json 单行且判定一致
#       ⑩ 改坏必红：把 open 形态从判据去掉 ⇒ ② 用例变绿（证明红来自判据，不是恒红）
#
# 口径: 三态 0/1/2；零失败 ⇒ exit 0
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$REPO/scripts/control-tower/check-conflict-markers.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
export SYNO_GATE_DEGRADED_LOG="$TMPD/degraded.log"

echo "=== 冲突标记机检夹具（check-conflict-markers.sh） ==="
if [ -f "$SUT" ]; then ok "被测件存在"; else no "被测件缺失: $SUT"; echo "结果: $PASS 通过, $FAIL 失败"; exit 1; fi

# 夹具标记用变量拼（不在本文件行首写出标记形态 ⇒ 机检不抓自己）
M_OPEN='<<<<<<< HEAD'; M_BASE='||||||| base'; M_SEP='======='; M_CLOSE='>>>>>>> main'

mk() { # <dir> → 建一个干净 git 沙箱
  local d="$1"
  mkdir -p "$d/docs" "$d/scripts"
  ( cd "$d" && git init -q . >/dev/null 2>&1 && git config user.email t@t && git config user.name t )
  printf 'a: 1\n' > "$d/docs/clean.yaml"
  printf '#!/bin/bash\necho hi\n' > "$d/scripts/clean.sh"
}
run() { OUT="$(bash "$SUT" "$@" 2>&1)"; RC=$?; }

# ① 干净
D1="$TMPD/clean"; mk "$D1"; ( cd "$D1" && git add -A >/dev/null 2>&1 )
run --root "$D1"
[ "$RC" -eq 0 ] && ok "① 干净暂存区 ⇒ exit 0" || no "① 期望 0 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q 'CONFLICT-MARKERS: OK' && ok "① 末行三态 OK" || no "① 末行不是 OK（$OUT）"

# ② 三形态
D2="$TMPD/three"; mk "$D2"
{ printf '%s\n' "$M_OPEN" 'a: 1' "$M_SEP" 'a: 2' "$M_CLOSE"; } > "$D2/docs/bad.yaml"
( cd "$D2" && git add -A >/dev/null 2>&1 )
run --root "$D2"
[ "$RC" -eq 1 ] && ok "② 三形态 ⇒ exit 1" || no "② 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q 'MARKER: docs/bad.yaml:1: open' && ok "② 点名 open 行" || no "② 未点名 open（$OUT）"
printf '%s' "$OUT" | grep -q 'MARKER: docs/bad.yaml:3: sep' && ok "② 点名 sep 行" || no "② 未点名 sep（$OUT）"
printf '%s' "$OUT" | grep -q 'MARKER: docs/bad.yaml:5: close' && ok "② 点名 close 行" || no "② 未点名 close（$OUT）"

# ③ diff3 形态
D3="$TMPD/diff3"; mk "$D3"
{ printf '%s\n' "$M_OPEN" 'a: 1' "$M_BASE" 'a: 0' "$M_SEP" 'a: 2' "$M_CLOSE"; } > "$D3/docs/bad3.yaml"
( cd "$D3" && git add -A >/dev/null 2>&1 )
run --root "$D3"
[ "$RC" -eq 1 ] && ok "③ diff3 的 ||||||| 也命中" || no "③ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q ': base$' && ok "③ 点名 base 形态" || no "③ 未点名 base（$OUT）"

# ④ .md 不在面内
D4="$TMPD/md"; mk "$D4"
{ printf '%s\n' "$M_OPEN" 'x' "$M_SEP" 'y' "$M_CLOSE"; } > "$D4/docs/note.md"
( cd "$D4" && git add -A >/dev/null 2>&1 )
run --root "$D4"
[ "$RC" -eq 0 ] && ok "④ .md 里的标记不判（防误杀文档）" || no "④ .md 被误判（$OUT）"
if printf '%s' "$OUT" | grep -q 'docs/note.md'; then
  no "④ .md 被点名（扩展名白名单失效）"
else
  ok "④ .md 未进判据面（未点名）"
fi

# ⑤ 逐行豁免
D5="$TMPD/optout"; mk "$D5"
printf '%s  # conflict-marker-ok: 夹具样例\na: 1\n' "$M_OPEN" > "$D5/docs/opt.yaml"
( cd "$D5" && git add -A >/dev/null 2>&1 )
run --root "$D5"
[ "$RC" -eq 0 ] && ok "⑤ 同行 conflict-marker-ok ⇒ 豁免" || no "⑤ 豁免失效（$OUT）"

# ⑥ base 模式
D6="$TMPD/base"; mk "$D6"
( cd "$D6" && git add -A >/dev/null 2>&1 && git commit -qm "base" >/dev/null 2>&1 )
{ printf '%s\n' "$M_OPEN" 'a: 1' "$M_SEP" 'a: 2' "$M_CLOSE"; } > "$D6/docs/late.yaml"
( cd "$D6" && git add -A >/dev/null 2>&1 && git commit -qm "带标记" >/dev/null 2>&1 )
run --root "$D6" --base HEAD~1
[ "$RC" -eq 1 ] && ok "⑥ base 模式（HEAD~1...HEAD）⇒ exit 1" || no "⑥ 期望 1 实得 $RC（$OUT）"

# ⑦ base 不可解析
run --root "$D6" --base no-such-ref-xyz
[ "$RC" -eq 2 ] && ok "⑦ base 不可解析 ⇒ exit 2（判不了≠通过）" || no "⑦ 期望 2 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q 'degraded: E_BASE' && ok "⑦ 点名 E_BASE" || no "⑦ 未点名 E_BASE（$OUT）"

# ⑧ 非 git
D8="$TMPD/nogit"; mkdir -p "$D8"
run --root "$D8"
[ "$RC" -eq 2 ] && ok "⑧ 非 git 仓库 ⇒ exit 2" || no "⑧ 期望 2 实得 $RC（$OUT）"
grep -q '"component":"check-conflict-markers"' "$TMPD/degraded.log" 2>/dev/null \
  && ok "⑧ 降级日志落 JSON（D2 契约）" || no "⑧ 降级日志未落盘"

# ⑨ --json
run --root "$D2" --json
if [ "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" -ge 1 ] && printf '%s\n' "$OUT" | head -1 | grep -q '^{.*"hits":[0-9]'; then
  ok "⑨ --json 首行为合法 JSON"
else
  no "⑨ --json 形态不对（$OUT）"
fi

# ⑩ 改坏必红：把 open 形态从判据去掉
MUT="$TMPD/mutant.sh"
sed 's|    ("open",  re.compile(r"^\\s\*<<<<<<< ")),|    # mutant: open 形态被删|' "$SUT" > "$MUT"
if grep -q 'mutant: open 形态被删' "$MUT"; then
  ok "⑩ 变异点已注入（open 形态 ⇒ 删除）"
  OUT_M="$(bash "$MUT" --root "$D2" 2>&1)"; RC_M=$?
  if printf '%s' "$OUT_M" | grep -q 'MARKER: docs/bad.yaml:1: open'; then
    no "⑩ 变异后仍点名 open（变异无效）"
  else
    ok "⑩ 变异后不再命中 open 行 ⇒ ② 的红确实来自该判据（非恒红）"
  fi
else
  no "⑩ 变异点未命中（实现改动后请同步本夹具）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
