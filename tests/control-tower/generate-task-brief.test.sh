#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# generate-task-brief.test.sh — 模板生成器配对测试（U7/CT-40 门禁要求）
#
# 为什么需要本件: D1241（#1308）把「Q2 条目 = 裸路径、独立成行」写进模板 ⇒
#   `scripts/workflow/generate-task-brief.py` 进入受控变更面，U7/CT-40 配对门禁要求
#   `tests/control-tower/generate-task-brief.test.sh` 存在且绿（否则 pre-commit 组 2 红）。
#
# 覆盖矩阵（铁律 48: 正常 / 边界 / 接线）:
#   A 正常  — 生成模板 → 六核心字段齐（Q0/Q1/Q2/Q3/架构层/Done）+ #CRITERIA A-D
#   B 正常  — 模板可被同源解析器解析（brief_parser --all ⇒ parseable=true）
#   C 边界  — **Q2 初始必须空态**：模板不得预置 `- ` 条目（否则每张 brief 都带假认领，
#             G12 会把无关文件判成"已声明"）
#   D 边界  — 模板的 Q2 段**不得含 HTML 注释**（`<!--`）—— pre-commit 的「模板残留检查」
#             按 `<!--` 判"未认真填"，Q2 段混注释会制造误判
#   E 契约  — 口径固化存在：Q2 段点名「裸路径」+ 正例/反例 + 自检命令（#1308 卡面 ②）
#   F 接线  — check-brief-parseable.sh 真的消费本生成器（禁第二套模板）
# 沙箱: mktemp 输出路径；零网络、零宿主写入（模板写到临时目录，不落 .claude/task-briefs/）
# 用法: bash tests/control-tower/generate-task-brief.test.sh
# 退出码: 0 = 全绿；1 = 断言失败；2 = 检查自身失败（缺 python / 缺 SUT）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$REPO/scripts/workflow/generate-task-brief.py"
PARSER="$REPO/scripts/control-tower/brief_parser.py"
PARSEABLE="$REPO/scripts/workflow/check-brief-parseable.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }
[ -f "$GEN" ] || { echo "  ❌ SUT 缺失: $GEN"; exit 2; }
[ -f "$PARSER" ] || { echo "  ❌ 解析器缺失: $PARSER"; exit 2; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
TPL="$TMPD/tpl.md"

echo "=== 模板生成器配对测试（D1241 / #1308 口径固化）==="

BRIEF_FILE="$TPL" TASK_DESC="D1241 template probe" "$PYBIN" "$GEN" >"$TMPD/gen.out" 2>&1
GEN_RC=$?
if [ "$GEN_RC" = "0" ] && [ -f "$TPL" ]; then ok "A 生成器可执行且产出文件"; else no "A 生成失败（rc=${GEN_RC}）: $(cat "$TMPD/gen.out")"; fi

for fld in '## Q0' '## Q1' '## Q2' '## Q3' '## 架构层' '## Done 标准'; do
  if grep -q "$fld" "$TPL"; then ok "A 六核心字段存在: $fld"; else no "A 缺字段: $fld"; fi
done
if grep -qE '^#CRITERIA: [A-D]$' "$TPL"; then ok "A #CRITERIA 必填位存在"; else no "A 缺 #CRITERIA 行"; fi

# ── B: 同源解析 ──
ALL_OUT="$("$PYBIN" "$PARSER" --all "$TPL" 2>"$TMPD/tpl.err" || echo '{"parseable": false}')"
if printf '%s' "$ALL_OUT" | grep -q '"parseable": true'; then ok "B 模板可被同源解析器解析"; else no "B 模板不可解析: $ALL_OUT"; fi

# ── C: Q2 初始空态（模板不得预置条目）──
INC_OUT="$("$PYBIN" "$PARSER" --q2-include "$TPL" 2>>"$TMPD/tpl.err")"
INC_N="$(printf '%s\n' "$INC_OUT" | grep -c . || true)"
case "${INC_N:-0}" in ''|*[!0-9]*) INC_N=0 ;; esac
if [ "$INC_N" = "0" ]; then ok "C Q2 初始空态（零预置条目 ⇒ 不制造假认领）"; else no "C 模板预置了 ${INC_N} 条 Q2 条目: $INC_OUT"; fi
WARN_N="$(grep -c 'Q2-PARSE-WARN:' "$TMPD/tpl.err" 2>&1 | tr -d ' \r' || true)"
case "${WARN_N:-0}" in ''|*[!0-9]*) WARN_N=0 ;; esac
if [ "$WARN_N" = "0" ]; then ok "C 模板自身零不可匹配告警"; else no "C 模板触发 Q2 告警（口径行写成了条目？）: $(grep -m1 'Q2-PARSE-WARN:' "$TMPD/tpl.err")"; fi

# ── D: Q2 段不得含 HTML 注释 ──
sed -n '/^## Q2/,/^## Q3/p' "$TPL" > "$TMPD/q2seg.txt"
if grep -q '<!--' "$TMPD/q2seg.txt"; then no "D Q2 段含 HTML 注释（「模板残留检查」按 <!-- 判未认真填）"; else ok "D Q2 段无 HTML 注释"; fi

# ── E: 口径固化（裸路径 + 正/反例 + 自检命令）──
if grep -q '裸路径' "$TMPD/q2seg.txt"; then ok "E Q2 段点名「裸路径」口径"; else no "E Q2 段无「裸路径」口径（#1308 卡面 ② 未落地）"; fi
if grep -q '正例' "$TMPD/q2seg.txt" && grep -q '反例' "$TMPD/q2seg.txt"; then ok "E 含正例/反例"; else no "E 缺正例或反例"; fi
if grep -q 'brief_parser.py --q2-include' "$TMPD/q2seg.txt"; then ok "E 含自检命令（作者可自查不可匹配条目）"; else no "E 缺自检命令提示"; fi

# ── F: 接线（禁第二套模板）──
if grep -q 'generate-task-brief.py' "$PARSEABLE"; then ok "F check-brief-parseable.sh 消费本生成器（模板同源自检）"; else no "F 校验器未消费本生成器（模板双源风险）"; fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
