#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# client-name-gate.test.sh — D1063/CN-01 门禁**接线与端到端**测试
# （扫描器单元测试在 tests/control-tower/scan-client-names.test.sh；两者互补，不重复）
#
# 覆盖矩阵（接线铁律 0-2 + 判别性）:
#   接线 ⑮ WIRE CHECK: scan-client-names.py 出现在 pre-commit-check.sh 且**两处**（主路径 + CT-34 内）
#   接线 ⑯ CT-34 接线点确实落在 `if [ "$DOC_ONLY" -eq 1 ]` 分支内（结构性抽取，非全文 grep）
#   判别 ⑦ **CT-34 段**：纯文档暂存（.md/.html）走早退分支仍被拦（证明未被 12 组豁免绕过）
#   判别 ⑧ CT-34 段夹具去掉客户名后 → 过(0)（证明不是「文档提交一律红」的假门禁）
#   正常 ⑨ 主路径（非文档暂存）同样接入（SYNO_CI=1 → ❌ 硬计数 + 整体非 0）
#   降级 ⑩b patterns 缺失时 CT-34 分支仍硬阻断（降级 ≠ 放行，铁律 11）
#
# 沙箱（PLATFORM-CHECKLIST #6）: mktemp -d + trap 清理；git 身份一律 `-c user.name=t -c user.email=t@t`；
#   🔴 不写真实仓库；且**不把复制进去的脚本自身入暂存区**（否则 doc-only 判定被破坏，
#   CT-34 段会被静默跳成主路径 —— 2026-09-29 实测踩过）。
#   沙箱另需自带 `.gitignore`（含 .env 条目）：否则 CT-34 分支内的 check-secrets.sh 会先失败，
#   我们的检查根本走不到（会把「未接线」误判成「已接线」）。
# 跨平台: 无 timeout 时显式降级（PLATFORM-CHECKLIST #8）；变量一律 `${}`（D370 全角标点）。
# 红证: fixture 由 `INJECTED-""RED` 拼接标记（本文件不含标记字面量），沙箱由 trap 删除。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCANNER_SRC="$REPO/scripts/control-tower/scan-client-names.py"
PC_SRC="$REPO/scripts/pre-commit-check.sh"
RED_MARK="INJECTED-""RED"                     # 拼接：本文件不含标记字面量
RED_NAME="CN01TEST-测试客甲"                   # 合成名（**不是**任何真实客户名），仅存在于沙箱

PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1）
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
if [ -z "$PYBIN" ]; then
  echo "SKIP→FAIL: 无可用 python —— 门禁无法运行（不静默绿）"
  exit 1
fi
for _f in "$SCANNER_SRC" "$PC_SRC"; do
  if [ ! -f "$_f" ]; then
    echo "❌ 被测文件不存在: ${_f}"
    exit 1
  fi
done

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/scripts/control-tower" "$SB/docs/synova/business" "$SB/.claude/task-briefs"
cp "$SCANNER_SRC" "$SB/scripts/control-tower/scan-client-names.py"
cp "$PC_SRC" "$SB/scripts/pre-commit-check.sh"
[ -f "$REPO/scripts/check-secrets.sh" ] && cp "$REPO/scripts/check-secrets.sh" "$SB/scripts/check-secrets.sh"
PAT="$SB/scripts/control-tower/client-name-patterns.json"
SCAN="$SB/scripts/control-tower/scan-client-names.py"
PC_SB="$SB/scripts/pre-commit-check.sh"
DOCDIR="docs/synova/business"

git -C "$SB" init -q .
GIT="git -C $SB -c user.name=t -c user.email=t@t"
$GIT commit -q --allow-empty -m "sandbox base"
printf '.env\n' > "$SB/.gitignore"

run_pc() {  # 平台无关地跑被测 pre-commit（macOS 无 timeout → 显式降级，不静默）
  local tmo=""
  for _c in timeout gtimeout; do command -v "$_c" >/dev/null 2>&1 && tmo="$_c" && break; done
  if [ -n "$tmo" ]; then (cd "$SB" && "$tmo" 180 bash "$PC_SB"); else (cd "$SB" && bash "$PC_SB"); fi
}

echo "=== D1063/CN-01 门禁接线与端到端测试 ==="

# ── ⑮ 接线 WIRE CHECK（先做：门禁没接线，后面的执行测试无意义）──
WIRE_N=$(grep -c "scan-client-names.py" "$PC_SRC" | tr -d '\n\r')
if [ "${WIRE_N:-0}" -ge 2 ]; then
  ok "接线: pre-commit-check.sh 引用 scan-client-names.py 共 ${WIRE_N} 处（≥2 = 主路径 + CT-34 两处）"
else
  no "接线: pre-commit-check.sh 仅 ${WIRE_N:-0} 处引用（需 ≥2 处）"
fi
grep -q -- "--scan-staged" "$PC_SRC" && ok "接线: 门禁调用 --scan-staged（增量口径，非全树）" || no "接线: 未调用 --scan-staged"

# ── ⑯ CT-34 接线点落在 DOC_ONLY 早退分支内（结构性抽取，防「接在分支外=纯文档仍绕过」）──
CT34_BLOCK=$(awk '/^if \[ "\$DOC_ONLY" -eq 1 \]; then$/{f=1} f{print} f&&/^fi$/{exit}' "$PC_SRC")
if echo "$CT34_BLOCK" | grep -q "scan-client-names.py"; then
  ok "接线: CT-34 早退分支内确有客户名扫描（纯文档提交不被豁免）"
else
  no "接线: CT-34 早退分支内**无**客户名扫描 —— 纯文档提交将整段绕过（本卡根因未修）"
fi
if echo "$CT34_BLOCK" | grep -q "check-secrets.sh"; then
  ok "接线: CT-34 分支结构未被破坏（Secrets 仍在原分支内）"
else
  no "接线: CT-34 分支结构异常（Secrets 调用丢失）"
fi

# ── 前置: 沙箱数据文件 ──
"$PYBIN" "$SCAN" --patterns "$PAT" --add-entry "$RED_NAME" >/dev/null 2>&1
[ -f "$PAT" ] && ok "沙箱: 数据文件已用 --add-entry 生成" || no "沙箱: 数据文件生成失败"
echo ""

echo "── ⑦/⑧ CT-34 纯文档暂存端到端（走早退分支仍被拦）──"
printf '客户方案：%s\n' "$RED_NAME" > "$SB/$DOCDIR/ct34-$RED_MARK.md"
printf '正文无敏感内容\n' > "$SB/$DOCDIR/ct34b-$RED_MARK.html"
$GIT add -f "$DOCDIR" >/dev/null 2>&1
STAGED_DOC=$($GIT diff --cached --name-only | tr '\n' ',')
RC7=0; OUT7=$(run_pc 2>&1) || RC7=$?
if echo "$OUT7" | grep -q "纯文档提交 (CT-34/D387)"; then
  ok "  ⑦-0 夹具确实走了 CT-34 早退分支（staged=${STAGED_DOC}）"
else
  no "  ⑦-0 夹具未走 CT-34 分支 —— 本段无效（staged=${STAGED_DOC}）"
fi
if [ "$RC7" -ne 0 ] && echo "$OUT7" | grep -q "客户机密名扫描"; then
  ok "  ⑦ 纯文档暂存（.md/.html）走 CT-34 路径**仍被拦**（exit=${RC7}，点名「客户机密名扫描」）"
else
  no "  ⑦ 纯文档提交未被拦（rc=${RC7}）—— 12 组豁免把机密数据扫描一起绕过了"
fi
# ⑧ 夹具去掉客户名 → CT-34 分支应放行（证明不是「文档一律红」的假门禁）
printf '客户方案：示例企业A\n' > "$SB/$DOCDIR/ct34-$RED_MARK.md"
$GIT add -f "$DOCDIR" >/dev/null 2>&1
RC8=0; OUT8=$(run_pc 2>&1) || RC8=$?
if [ "$RC8" -eq 0 ] && echo "$OUT8" | grep -q "纯文档提交豁免检查完成"; then
  ok "  ⑧ 同一夹具去掉客户名后 CT-34 放行（exit 0）—— 门禁有判别力，非恒红"
else
  no "  ⑧ CT-34 干净文档应放行 (exit 0)，实际 rc=${RC8}"
fi

echo ""
echo "── ⑨ 主路径（非文档暂存）接线生效（SYNO_CI=1 转硬）──"
printf '客户：%s\n' "$RED_NAME" > "$SB/scripts/probe.md"
$GIT add -f scripts/probe.md >/dev/null 2>&1
RC9=0; OUT9=$(SYNO_CI=1 run_pc 2>&1) || RC9=$?
if echo "$OUT9" | grep -q "客户机密名扫描"; then
  if echo "$OUT9" | grep -q "❌ 客户机密名扫描"; then
    ok "  ⑨ 主路径: SYNO_CI=1 → ❌ 硬计数（CI 权威转硬，失败可见）"
  else
    no "  ⑨ 主路径命中但未显示 ❌（CI strict 失败不可见 —— D542 缺陷同型）"
  fi
  [ "$RC9" -ne 0 ] && ok "  ⑨b 主路径命中后整体 exit != 0（${RC9}）" || no "  ⑨b 主路径命中后整体仍 exit 0"
else
  no "  ⑨ 主路径未跑到客户名扫描（rc=${RC9}）"
fi

echo ""
echo "── ⑩b 降级：patterns 缺失时 CT-34 分支仍阻断（降级 ≠ 放行）──"
$GIT reset -q
rm -f "$SB/$DOCDIR/ct34-$RED_MARK.md" "$SB/$DOCDIR/ct34b-$RED_MARK.html"
printf '正文无敏感内容\n' > "$SB/$DOCDIR/plain-note.md"
$GIT add -f "$DOCDIR" >/dev/null 2>&1
mv "$PAT" "$PAT.saved"
RC10=0; OUT10=$(run_pc 2>&1) || RC10=$?
if [ "$RC10" -ne 0 ] && echo "$OUT10" | grep -q "客户机密名扫描"; then
  ok "  ⑩b patterns 缺失时 CT-34 分支仍阻断（exit=${RC10}）—— 降级不静默放行（铁律 11）"
else
  no "  ⑩b patterns 缺失时 CT-34 分支未阻断或不点名（rc=${RC10}）—— 静默 fail-open"
fi
mv "$PAT.saved" "$PAT"

echo ""
echo "── 收尾: 红证零残留（可判定口径）──"
IN_SB=$(grep -rlF "$RED_MARK" "$SB" | wc -l | tr -d ' ')
echo "  沙箱内含红证标记的文件数=${IN_SB}（沙箱由 trap 整体删除 ⇒ 本卡零残留）"
LEAK=0
for f in scripts/control-tower/scan-client-names.py scripts/control-tower/client-name-patterns.json \
         scripts/pre-commit-check.sh .gitignore tests/control-tower/scan-client-names.test.sh \
         tests/control-tower/client-name-gate.test.sh; do
  if [ -f "$REPO/$f" ] && grep -qF "$RED_MARK" "$REPO/$f"; then
    echo "  本卡产物含红证标记: $f"; LEAK=$((LEAK + 1))
  fi
done
[ "$LEAK" -eq 0 ] && ok "本卡产物红证零残留" || no "本卡产物残留红证 ${LEAK} 件"

echo ""
echo "结果: ${PASS} 通过, ${FAIL} 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
