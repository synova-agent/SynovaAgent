#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# d708-pr-body-wiring.test.sh — #1284：D708「写集豁免」的 --pr-body **真接线**判别夹具
#
# 病根（#1284）: `merge_writeset_gate.py` 取 PR 正文只有两条路（--pr-body / GITHUB_EVENT_PATH），
#   而 ci.yml **从不传 --pr-body**（`grep -c 'pr-body' ci.yml` = 0）⇒ 只能读事件体快照；
#   GitHub **re-run 重放原事件快照、不重抓正文** ⇒ 「改正文 → 重跑」永远无效（#1273 实证）。
#
# 判据（本卡核心，「机制存在」不得以「代码里有该分支」证明）:
#   从 ci.yml **提取 D708 step 正文真执行**，断言该分支在**真实运行路径上被喂到输入**：
#     ① PR 事件（有 PR 号）⇒ 真取当前正文 ⇒ `--pr-body <file>` **真被传进** python 调用（argv 记录）
#     ② 正文含「写集豁免」⇒ 日志出现**解析到的豁免行**（不是模板文案）
#     ③ gh 取数失败 ⇒ **显式** ::warning（禁静默），且不传 --pr-body（回退快照）
#     ④ merge_group/push（无 PR 号）⇒ **显式** ::notice 说明该路径不适用（非静默跳过）
#   沙箱用 `gh`/`python3` 双桩（录制 argv + 输出）——被测对象 = ci.yml 的**接线**，不是 gate 本体。
#
# 覆盖矩阵（铁律 48 三路径 + 判别性）:
#   正常 — ① ②   边界 — ④   降级 — ③
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI="$REPO/.github/workflows/ci.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== #1284: D708 --pr-body 真接线夹具 ==="

# ── 提取 D708 step 正文（真 step，非副本）──
awk '
  !found { if ($0 == "      - name: Merge write-set reconciliation (D708)") { found=1 } ; next }
  found && !inrun { if ($0 ~ /^        run: \|/) { inrun=1 } ; next }
  inrun && $0 ~ /^[ ]{0,9}[^ ]/ { exit }
  inrun { sub(/^ {10}/, ""); print }
' "$CI" > "$TMPD/step.sh"
if grep -q -- '--pr-body' "$TMPD/step.sh"; then
  ok "提取: D708 step 正文含 --pr-body 接线（$(wc -l < "$TMPD/step.sh" | tr -d ' ') 行）"
else
  no "提取: D708 step 未接 --pr-body（#1284 未修）"
fi

# ── 桩: gh（输出正文 / 失败两态）+ python3（录 argv）──
mkdir -p "$TMPD/bin"
cat > "$TMPD/bin/gh" <<'EOG'
#!/bin/bash
if [ "${GH_STUB_FAIL:-0}" = "1" ]; then echo "gh: not authenticated" >&2; exit 1; fi
# 真实调用形态: gh pr view <num> --json body --jq .body
cat "${GH_STUB_BODY:-/dev/null}"
EOG
cat > "$TMPD/bin/python3" <<'EOP'
#!/bin/bash
printf '%s\n' "$@" > "${ARGV_RECORD:-/tmp/d708-argv.txt}"
exit "${PY_STUB_RC:-0}"
EOP
chmod +x "$TMPD/bin/gh" "$TMPD/bin/python3"

BODY_OK="$TMPD/body-ok.md"
cat > "$BODY_OK" <<'EOB'
正文前言（无关内容）。

## 写集豁免

- src/undeclared.ts — 并行线只读引用：#1284 接线演示（需真被喂到 gate）
- docs/foo.md — 文档随附件
EOB

run_step() {   # $1=PR_NUMBER 值（可空） $2=GH_STUB_FAIL(0/1) $3=BODY 文件
  local rec="$TMPD/argv-$RANDOM.txt"
  ( cd "$REPO" \
    && PATH="$TMPD/bin:$PATH" PR_NUMBER="$1" GH_STUB_FAIL="$2" GH_STUB_BODY="$3" \
       ARGV_RECORD="$rec" GITHUB_HEAD_REF="fix/demo" RUNNER_TEMP="$TMPD" \
       bash "$TMPD/step.sh" ) > "$TMPD/out.txt" 2>&1
  echo "$rec"
}

# ── ① 正常: PR 事件 ⇒ --pr-body 真被传进 python 调用（argv 记录为证）──
REC="$(run_step 42 0 "$BODY_OK")"; rc=$?
if [ "$rc" -eq 0 ] && grep -q -- '--pr-body' "$REC" 2>/dev/null; then
  ok "① PR 事件 ⇒ python 调用**真收到** --pr-body（argv: $(tr '\n' ' ' < "$REC" | head -c 90)…）"
elif [ "$rc" -ne 0 ]; then
  no "① step 非零退出（rc=${rc}）：$(tail -2 "$TMPD/out.txt" | tr '\n' ' ')"
else
  no "① --pr-body 未进 python 调用（接线未生效，仅"代码里有该分支"）"
fi
BODY_ARG_PATH="$(awk '/^--pr-body$/{getline; print; exit}' "$REC" 2>/dev/null)"
if [ -n "$BODY_ARG_PATH" ] && [ -s "$BODY_ARG_PATH" ] && grep -q '写集豁免' "$BODY_ARG_PATH"; then
  ok "① 传参文件内容是**当前正文**（含「写集豁免」段）：$BODY_ARG_PATH"
else
  no "① 传参文件缺失或内容异常（path='${BODY_ARG_PATH}'）"
fi

# ── ② 正常: 日志出现**解析到的豁免行**（不是只有模板文案）──
if grep -q -- '- src/undeclared.ts' "$TMPD/out.txt"; then
  ok "② 日志逐条打印**解析到的豁免行**（- src/undeclared.ts …）"
else
  no "② 日志未打印解析到的豁免行（旧形态只有模板文案）：$(grep -c '豁免' "$TMPD/out.txt") 处命中"
fi

# ── ③ 降级: gh 取正文失败 ⇒ 显式 ::warning 且不传 --pr-body（回退快照，可见）──
REC="$(run_step 42 1 "$BODY_OK")"
if grep -q '::warning title=d708-pr-body' "$TMPD/out.txt" && ! grep -q -- '--pr-body' "$REC" 2>/dev/null; then
  ok "③ 取正文失败 ⇒ 显式 ::warning + 不传 --pr-body（回退事件体快照；禁静默）"
else
  no "③ 取数失败未显式降级或仍传了空 --pr-body（warn=$(grep -c '::warning title=d708-pr-body' "$TMPD/out.txt") argv=$(tr '\n' ' ' < "$REC" 2>/dev/null | head -c 60)）"
fi

# ── ④ 边界: merge_group/push（无 PR 号）⇒ 显式 ::notice 说明该路径不适用 ──
REC="$(run_step "" 0 "$BODY_OK")"
if grep -q '::notice title=d708-pr-body' "$TMPD/out.txt" && ! grep -q -- '--pr-body' "$REC" 2>/dev/null; then
  ok "④ 无 PR 号（merge_group/push）⇒ 显式 ::notice 说明「正文豁免段不适用」（非静默跳过）"
else
  no "④ 无 PR 号路径未显式说明（notice=$(grep -c '::notice title=d708-pr-body' "$TMPD/out.txt")）"
fi

# ── ⑤ 判别性（变异体）: 把接线去掉（回退旧形态: 只传 base/head/branch）⇒ ① 必红 ──
sed 's/ ${BODY_ARGS\[@\]+"${BODY_ARGS\[@\]}"}//' "$TMPD/step.sh" > "$TMPD/step-mutant.sh"
cp "$TMPD/step.sh" "$TMPD/step-real.sh"; cp "$TMPD/step-mutant.sh" "$TMPD/step.sh"
REC="$(run_step 42 0 "$BODY_OK")"
cp "$TMPD/step-real.sh" "$TMPD/step.sh"
if ! grep -q -- '--pr-body' "$REC" 2>/dev/null; then
  ok "⑤ 变异体: 去掉接线（旧形态）⇒ ① 断言必红（夹具对"半接线"有判别力）"
else
  no "⑤ 变异体未生效（去掉接线后仍见 --pr-body）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
