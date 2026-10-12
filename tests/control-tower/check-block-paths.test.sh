#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-block-paths.test.sh — 块级 `paths` 对账门禁的**退出码层**配对测试
#   （CTO 裁定 074 步 1b ｜ U7 / CT-40：改控制塔脚本须配对测试）
#
# 与 vitest `block-paths-core.test.ts` 的分工（既有惯例：主断言在 vitest，退出码/夹具在 .test.sh）:
#   · vitest = 10 情境的**内容断言**（core 纯函数 + CLI 全链路）
#   · 本件  = ① 门禁**壳**的三态退出码 ② 负向 4 条的**原始输出** ③ **接线（WIRE CHECK）**
#
# 覆盖矩阵（铁律 48）:
#   正常 — 真源 ⇒ exit 0（且 stdout 点名"14 块逐块一致"）
#   违规 — 夹具造差异 ⇒ exit 1（N1 改 item.paths ／ N2 删块级 paths 条目）
#   降级 — 夹具缺导出 ⇒ exit 2 ／ 夹具缺块级 paths 字段 ⇒ exit 2 ／ 真源路径不存在 ⇒ exit 2
#   环境 — tsx 不可用 ⇒ exit 2（**fail-closed**，禁 `|| true` 吞崩溃）；且**不许**返回 0
#   接线 — pre-commit-check.sh 组 9 调用 ／ .gitea/workflows/local-gates.yml ① 步调用
#   反证 — 门禁**壳**内零判定逻辑（无 sort / Set / 聚合）＝"一份实现两处调用"的机器证据
#
# 沙箱：夹具来自仓内 `tests/control-tower/block-paths-fixtures/`（非真源），全部只读。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
GATE="$REPO/scripts/control-tower/check-block-paths.sh"
ENTRY="$REPO/scripts/control-tower/check-block-paths.ts"
CORE="$REPO/scripts/control-tower/block-paths-core.ts"
GEN="$REPO/scripts/control-tower/gen-block-paths.ts"
FIX="$REPO/tests/control-tower/block-paths-fixtures"
PC="$REPO/scripts/pre-commit-check.sh"
CI="$REPO/.gitea/workflows/local-gates.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# tsx 定位（与门禁壳同一条上溯规则：worktree 不共 node_modules）
TSX=""
for c in "${SYNO_TSX:-}" "$REPO/node_modules/.bin/tsx" "$(command -v tsx 2>/dev/null || true)" \
         "$(dirname "$REPO")/node_modules/.bin/tsx" "$(dirname "$(dirname "$REPO")")/node_modules/.bin/tsx"; do
  [ -n "${c}" ] && [ -x "${c}" ] && { TSX="${c}"; break; }
done
if [ -z "$TSX" ]; then echo "  ⚠️ 找不到 tsx — 跳过（显式降级，不计失败）"; exit 0; fi
export SYNO_TSX="$TSX"

# node 进 PATH（`node_modules/.bin/tsx` 是 env node 启动器）
# 🔴 node 必须真可用：`node_modules/.bin/tsx` 是 `#!/usr/bin/env node` 的 JS 启动器，
#    裸环境（DSH 会话不带 nvm）PATH 里没有 node ⇒ tsx 执行即 exit 127（本测试第一版实测踩到）。
#    探测顺序与门禁壳 §① 一致：PATH → 仓/上溯 → $HOME/.nvm/versions/node/*/bin（版本降序）。
NODE_BIN_DIR=""
if command -v node >/dev/null 2>&1 && [ "$(node -v 2>/dev/null || true)" != "" ]; then
  NODE_BIN_DIR="$(cd "$(dirname "$(command -v node)")" && pwd)"
elif [ -d "$HOME/.nvm/versions/node" ]; then
  for nb in $(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -r || true); do
    if [ -x "$nb/node" ] && [ "$("$nb/node" -v 2>/dev/null || true)" != "" ]; then NODE_BIN_DIR="$nb"; break; fi
  done
fi
if [ -z "$NODE_BIN_DIR" ]; then
  echo "  ⚠️ 找不到可用 node — 跳过（显式降级，不计失败）"; exit 0
fi
PATH="$NODE_BIN_DIR:$PATH"
echo "  ⓘ node = $("$NODE_BIN_DIR/node" -v) ｜ tsx = $TSX"

echo "=== 块级 paths 对账门禁 · 退出码层 + 负向 + 接线（CTO 裁定 074 步 1b）==="

[ -f "$GATE" ] || { echo "  ❌ 被测门禁缺失: $GATE"; exit 1; }

# ── A. 接线（WIRE CHECK，铁律 0-2：新能力零调用方 = 未接线）──
echo "── A. 接线（WIRE CHECK）──"
if grep -q "check-block-paths.sh" "$PC"; then ok "接线: pre-commit-check.sh 调用 check-block-paths.sh"
else no "接线: pre-commit-check.sh **未**调用（新门禁零调用方 = 未接线）"; fi
if grep -q "check-block-paths.sh" "$CI"; then ok "接线: local-gates.yml 调用 check-block-paths.sh"
else no "接线: local-gates.yml **未**调用"; fi
if grep -q "gen-block-paths.ts" "$REPO/scripts/control-tower/check-block-paths.ts"; then
  ok "接线: 门禁 TS 入口 import 生成器（取数链共用，禁第二份取数）"
else no "接线: 门禁未复用生成器的取数链"; fi

# ── B. 反证：门禁壳内零判定逻辑（"一份实现两处调用"的机器证据）──
echo "── B. 反证: 壳内零判定逻辑 ──"
SHELL_BODY="$(grep -vE '^\s*#|^\s*$' "$GATE" || true)"
if echo "$SHELL_BODY" | grep -qE '\.sort\(|new Set|localeCompare'; then
  no "壳内含判定逻辑（sort/Set/localeCompare）⇒ 违反'一份实现'"
else ok "壳内零判定逻辑（无 sort / Set / localeCompare）"; fi
if echo "$SHELL_BODY" | grep -qE "JSON|paths\[|compare"; then
  no "壳内出现路径比较/JSON 处理 ⇒ 判定疑似泄漏到壳里"
else ok "壳内无路径比较/JSON 处理"; fi
# 排序口径只允许出现在 core（写死码点序）
if grep -q "compareCodePoint" "$CORE"; then ok "排序口径在 core（compareCodePoint 存在）"
else no "core 缺排序口径实现"; fi
# 剥掉块注释与行注释后再判"可执行行"（否则"为什么不选它"的说明文字会自己触发误报）
strip_comments() {
  awk 'BEGIN{c=0} {
    line=$0
    while (1) {
      if (c==0) { i=index(line,"/*"); if (i==0) { j=index(line,"//"); if (j>0) line=substr(line,1,j-1); break } ; pre=substr(line,1,i-1); j=index(pre,"//"); if (j>0) { line=substr(line,1,j-1); break } ; line=substr(line,i+2); c=1 }
      else { i=index(line,"*/"); if (i==0) { line=""; break } ; line=substr(line,i+2); c=0 }
    }
    print line
  }' "$1"
}
CORE_CODE="$(strip_comments "$CORE" || true)"
if echo "$CORE_CODE" | grep -q "localeCompare"; then
  no "core 可执行行出现 localeCompare（排序口径禁改）"
else ok "core 可执行行无 localeCompare（说明文字不算）"; fi
if echo "$CORE_CODE" | grep -q "compareCodePoint"; then ok "core 可执行行含 compareCodePoint（码点序写死）"
else no "core 缺码点序比较器"; fi

# ── C. 三态：正常（真源）⇒ exit 0 ──
echo "── C. 三态 · 正常（真源）──"
OUT="$(bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "真源 ⇒ exit 0"; else no "真源 ⇒ exit ${RC}（应 0）"; echo "$OUT" | head -6 | sed 's/^/       /'; fi
if echo "$OUT" | grep -q "14 块逐块一致"; then ok "exit 0 且点名'14 块逐块一致'"
else no "exit 0 但未点名块数"; fi

# ── D. 三态：违规（N1 改 item.paths ／ N2 删块级 paths 条目）⇒ exit 1 ──
echo "── D. 三态 · 违规 ⇒ exit 1（负向 N1/N2，原始输出见下）──"
for f in mismatch-items mismatch-snapshot; do
  echo "  · 夹具 $f:"
  OUT="$(bash "$GATE" --source "$FIX/$f.ts" 2>&1)"; RC=$?
  if [ "$RC" -eq 1 ]; then ok "$f ⇒ exit 1"; else no "$f ⇒ exit ${RC}（应 1）"; fi
  echo "$OUT" | head -8 | sed 's/^/       | /'
done

# ── E. 三态：判不了 ⇒ exit 2（fail-closed）──
echo "── E. 三态 · 判不了 ⇒ exit 2（负向 N3/N3b + 真源缺失）──"
for f in no-items-export no-block-paths dangling; do
  OUT="$(bash "$GATE" --source "$FIX/$f.ts" 2>&1)"; RC=$?
  if [ "$RC" -eq 2 ]; then ok "$f ⇒ exit 2（判不了）"; else no "$f ⇒ exit ${RC}（应 2）"; fi
  echo "$OUT" | grep -m2 -E "判不了|🔴" | sed 's/^/       | /' || true
done
OUT="$(bash "$GATE" --source "$FIX/不存在的文件.ts" 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then ok "真源不存在 ⇒ exit 2"; else no "真源不存在 ⇒ exit ${RC}（应 2）"; fi

# ── F. 环境降级：tsx 不可用 ⇒ exit 2（**禁 0**）──
echo "── F. 环境降级: 找不到 tsx ⇒ exit 2 ──"
# 真验证：把门禁壳复制到"仓内无 node_modules、上溯也找不到"的沙箱，并把 PATH 收窄到不含 tsx。
# （只改 SYNO_TSX 是**测不出**的：它只是候选第①个，后续候选会补上 —— 第一版就踩了这个假绿。）
SBX="$(mktemp -d)"
mkdir -p "$SBX/scripts/control-tower"
cp "$GATE" "$SBX/scripts/control-tower/gate.sh"
cp "$ENTRY" "$SBX/scripts/control-tower/check-block-paths.ts"
OUT="$(cd "$SBX" && env -u SYNO_TSX PATH="/usr/bin:/bin:/usr/sbin:/sbin" bash "$SBX/scripts/control-tower/gate.sh" 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then ok "找不到 tsx ⇒ exit 2（fail-closed）"
elif [ "$RC" -eq 0 ]; then no "🔴 找不到 tsx 却返回 0（吞崩溃 —— 违反'禁 || true'）"
else no "找不到 tsx ⇒ exit ${RC}（应 2）"; fi
if echo "$OUT" | grep -q "fail-closed"; then ok "降级时显式打印 fail-closed 语义"
else no "降级未打印原因"; fi
rm -rf "$SBX"

# ── G. 入口缺文件 ⇒ exit 2（不是崩）──
echo "── G. 入口缺失 ⇒ exit 2 ──"
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
mkdir -p "$TMPD/scripts/control-tower"
cp "$GATE" "$TMPD/scripts/control-tower/gate-copy.sh" 2>/dev/null || true
OUT="$(bash "$TMPD/scripts/control-tower/gate-copy.sh" 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then ok "入口脚本缺失 ⇒ exit 2"; else no "入口缺失 ⇒ exit ${RC}（应 2）"; fi

# ── H. 生成器出口：--list / JSON 都可跑，且 JSON 两次逐字节相同 ──
echo "── H. 生成器可复现性（同输入两次 ⇒ 逐字节相同）──"
"$TSX" "$GEN" > "$TMPD/g1.json" 2>/dev/null; R1=$?   # swallow-ok: 生成器 stderr 是诊断信息，rc 已用 R1 断言
"$TSX" "$GEN" > "$TMPD/g2.json" 2>/dev/null; R2=$?   # swallow-ok: 同上（第二次跑，只为 cmp）
if [ "$R1" -eq 0 ] && [ "$R2" -eq 0 ]; then ok "生成器两次均 exit 0"; else no "生成器退出码异常: ${R1}/${R2}"; fi
# 🔴 判别力自检（防"假绿 cmp"）：两次都空文件时 cmp 也是"相同" ⇒ 必须同时断言非空
if [ ! -s "$TMPD/g1.json" ]; then
  no "🔴 生成器输出为空文件 —— cmp 的'相同'无意义（正是'空结果当通过'的形态）"
else
  if cmp -s "$TMPD/g1.json" "$TMPD/g2.json"; then ok "🔴 两次输出 **逐字节相同**（cmp 无差异，且非空）"
  else no "🔴 两次输出不同（判据④失败）"; diff "$TMPD/g1.json" "$TMPD/g2.json" | head -5 | sed 's/^/       /'; fi
fi
echo "       哈希: $(shasum -a 256 "$TMPD/g1.json" | cut -c1-16) / $(shasum -a 256 "$TMPD/g2.json" | cut -c1-16)"
"$TSX" "$GEN" --list > "$TMPD/list.txt" 2>/dev/null   # swallow-ok: 只取 stdout 行数，rc 不参与判定
if [ "$(wc -l < "$TMPD/list.txt" | tr -d ' ')" -eq 14 ]; then ok "--list 输出 14 块"
else no "--list 行数异常: $(wc -l < "$TMPD/list.txt" | tr -d ' ')"; fi

# ── I. 判别力自检（禁把"看不见"当"没问题"）──
echo "── I. 判别力自检 ──"
# 若门禁对不存在的夹具也返回 0 ⇒ 判别力为 0（本门禁的最大风险是"空结果当通过"）
OUT="$(bash "$GATE" --source "$FIX/ok.ts" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "夹具 ok.ts（同构小号真源）⇒ exit 0（未误拦）"
else no "夹具 ok.ts ⇒ exit ${RC}（应为一致）"; echo "$OUT" | head -5 | sed 's/^/       /'; fi

echo "  ⓘ 真源锚: $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo '?')"
echo "  ── 合计: ${PASS} 通过 / ${FAIL} 失败 ──"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
