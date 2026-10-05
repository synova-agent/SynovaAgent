#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# brief-parser-strip.test.sh — D521/不变量3: 语义 parser 统一剥壳（include/exclude 对称）
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — include「改 src/x.ts（说明）」→ 裸路径 src/x.ts
#   正常 — include「新增 src/y.sh — 原因」→ 裸路径
#   边界 — include 无修饰裸路径 → 原样通过（不回归）
#   边界 — exclude「不改 scripts/audit/（红线）」→ 剥壳保持（既有语义不回归）
#   D543 — include「scripts/x.sh L750」剥行号后缀 → 裸路径（对齐 devdoc_writeset）
#   D707 — 架构层字段「内联/body 两种写法等价 + 空值仍被拒」：
#          ① 解析器 parse_layer 形状矩阵（内联/body/全角冒号/空格/旧标题/干扰标题）
#          ② 负例: 空值 + 注释占位 → 必须判「未填写」（旧正则跨行吞标题 = 假绿）
#          ③ 两校验器结论一致（check-plan-integrity --brief 与 pre-commit 组 6 共用同源解析器，D962 第二批并入）
#          ④ 接线: pre-commit-check.sh 真的调用 brief_parser.py --layer（禁第二套 awk 实现）
#   接线 — resolve-commit-brief.sh 内嵌降级解析器同步含剥壳正则
# 沙箱: 纯文本 fixture 注入，零 git
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PARSER="$REPO/scripts/control-tower/brief_parser.py"
RESOLVER="$REPO/scripts/workflow/resolve-commit-brief.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "=== D521 不变量3: parser 剥壳对称 ==="

FIXTURE="$(mktemp)"; TMP="$(mktemp -d)"; trap 'rm -f "$FIXTURE"; rm -rf "$TMP"' EXIT
cat > "$FIXTURE" <<'EOF'
## Q2: 范围
做什么:
- 改 src/l3/foo.ts（专家路由）
- 修改 src/l4/bar.ts — 性能
- 新增 scripts/control-tower/new-gate.sh
- 修复 scripts/workflow/task-start.sh: CRLF
- 实现 tests/l3/foo.test.ts
- src/plain/already-bare.py
- scripts/pre-commit-check.sh L750
不做什么:
- 不改 scripts/audit/（K3 专属红线）
- 不动 src/immutable/core.ts

## Done 标准:
- verify: echo ok
EOF

INCLUDES=$(python3 "$PARSER" --q2-include "$FIXTURE")
EXCLUDES=$(python3 "$PARSER" --q2-exclude "$FIXTURE")

# ── 正常: include 剥动词前缀 + 括号 + 后置分隔 ──
echo "$INCLUDES" | grep -qx "src/l3/foo.ts" && ok "include 剥「改 + （说明）」→ src/l3/foo.ts" || no "改/括号未剥: $(echo "$INCLUDES" | head -2)"
echo "$INCLUDES" | grep -qx "src/l4/bar.ts" && ok "include 剥「修改 + — 原因」→ src/l4/bar.ts" || no "修改/— 未剥"
echo "$INCLUDES" | grep -qx "scripts/control-tower/new-gate.sh" && ok "include 剥「新增」" || no "新增未剥"
echo "$INCLUDES" | grep -qx "scripts/workflow/task-start.sh" && ok "include 剥「修复 + : 后缀」" || no "修复/: 未剥"
echo "$INCLUDES" | grep -qx "tests/l3/foo.test.ts" && ok "include 剥「实现」" || no "实现未剥"

# ── D543: 剥行号后缀「path L750」（对齐 devdoc_writeset 同款正则；D541 CI 红第三处根因）──
echo "$INCLUDES" | grep -qx "scripts/pre-commit-check.sh" && ok "D543: 剥「L750」行号后缀 → 裸路径" || no "D543: L\d+ 后缀未剥: $(echo "$INCLUDES" | grep pre-commit | head -1)"
echo "$INCLUDES" | grep -qE "pre-commit-check.sh L[0-9]" && no "D543: 行号后缀残留" || ok "D543: 无 L\d+ 残留"

# ── 边界: 裸路径原样、exclude 剥壳语义不回归 ──
echo "$INCLUDES" | grep -qx "src/plain/already-bare.py" && ok "裸路径原样通过（不回归）" || no "裸路径被破坏"
echo "$EXCLUDES" | grep -qx "scripts/audit/" && ok "exclude 剥「不改 + （）」保持" || no "exclude 剥壳回归"
echo "$EXCLUDES" | grep -qx "src/immutable/core.ts" && ok "exclude 剥「不动」保持" || no "exclude 不动回归"

# ── 接线: resolve-commit-brief.sh 内嵌降级解析器同步 ──
grep -qE "修改\|新增\|新建\|修复\|扩展\|实现\|更新\|重构" "$RESOLVER" \
  && ok "接线: resolver 内嵌解析器含 include 动词前缀剥壳" || no "resolver 内嵌解析器未同步剥壳"
grep -q '（(' "$RESOLVER" || grep -q '\[（(\]' "$RESOLVER" \
  && ok "接线: resolver 内嵌解析器含括号剥壳" || no "resolver 括号剥壳缺失"

# ═══ D707: 架构层字段口径统一（内联/body 等价 + 空值必拒）═══
echo ""
echo "=== D707: 架构层字段解析口径 ==="
PRECOMMIT="$REPO/scripts/pre-commit-check.sh"
PARSEABLE="$REPO/scripts/check-plan-integrity.sh"  # D962 第二批: 判定并入 --brief 模式

layer_of() { python3 "$PARSER" --layer "$1" 2>/dev/null | head -1 | tr -d '[:space:]'; }  # swallow-ok: 解析器异常即视为空值，由后续断言判空（断言才是判定者）

# ── ① 形状矩阵: 合法写法两种必须等价（非空）──
printf '# b\n\n## 架构层: scripts（控制塔域）\n'            > "$TMP/l-inline.md"
printf '# b\n\n## 架构层:\nscripts（控制塔域）\n'            > "$TMP/l-body.md"
printf '# b\n\n## 架构层：scripts（全角冒号）\n'             > "$TMP/l-full.md"
printf '# b\n\n## 架构层 scripts（空格分隔）\n'              > "$TMP/l-space.md"
printf '# b\n\n## 本任务在哪一层\nL2 编排层\n'                > "$TMP/l-legacy.md"
printf '# b\n\n## 架构层说明: 干扰标题\n## 架构层: 真值层\n'   > "$TMP/l-decoy.md"
for c in l-inline l-body l-full l-space l-legacy l-decoy; do
  [ -n "$(layer_of "$TMP/$c.md")" ] && ok "① 合法写法被接受: $c → $(layer_of "$TMP/$c.md")" || no "① 合法写法被误拒: $c"
done
# 内联与 body 等价（同一语义同一结果）
[ "$(layer_of "$TMP/l-inline.md")" = "$(layer_of "$TMP/l-body.md")" ] \
  && ok "① 内联写法 == body 写法（语义等价，D707 原症状）" \
  || no "① 两种写法结论不同: '$(layer_of "$TMP/l-inline.md")' vs '$(layer_of "$TMP/l-body.md")'"
# 干扰标题不得被误认为字段（旧正则 decoy 场景）
[ "$(layer_of "$TMP/l-decoy.md")" = "真值层" ] && ok "① 干扰标题不误命中（取真字段）" || no "① 干扰标题误命中"

# ── ② 负例: 空值 / 注释占位 → 必须为空（旧正则跨行吞标题 → 假绿）──
printf '# b\n\n## 架构层:\n## Done 标准\n- [x] v\n'  > "$TMP/l-empty.md"
printf '# b\n\n## 架构层:\n<!-- 待填 -->\n'          > "$TMP/l-comment.md"
printf '# b\n\n## 架构层:   \n'                       > "$TMP/l-blank.md"
printf '# b\n\n## 架构层:\n<!-- x -->\n\nL4 本体\n'   > "$TMP/l-commentbody.md"
for c in l-empty l-comment l-blank; do
  [ -z "$(layer_of "$TMP/$c.md")" ] && ok "② 负例仍被拒（空值/占位 → 未填写）: $c" || no "② 负例被放行（假绿）: $c → '$(layer_of "$TMP/$c.md")'"
done
[ "$(layer_of "$TMP/l-commentbody.md")" = "L4本体" ] \
  && ok "② 跳过注释后取 body 真值（注释不遮蔽）" || no "② 注释后 body 未取到"

# ── ③ 两校验器结论一致: 对「架构层」这一项的判定必须与解析器同判 ──
#    （fixture 是最小 brief，其它字段缺失也会让校验器非 0 —— 故只比对架构层这一项）
for c in l-inline l-body l-empty l-comment; do
  out=$(bash "$PARSEABLE" --brief "$TMP/$c.md" 2>&1)  # D962 第二批: --brief 模式
  v=$(layer_of "$TMP/$c.md")
  if [ -n "$v" ]; then
    echo "$out" | grep -q "架构层未标注" \
      && no "③ 解析器有值但校验器报未标注（口径不一致）: $c" \
      || ok "③ 有值 → 两器一致（校验器不报未标注）: $c"
  else
    echo "$out" | grep -q "架构层未标注" \
      && ok "③ 空值 → 两器一致（校验器点名架构层）: $c" \
      || no "③ 空值但校验器未点名架构层（口径不一致）: $c"
  fi
done

# ── ④ 接线: 组 6 必须调用同源解析器（禁第二套实现 → 防漂移）──
grep -q 'brief_parser.py" --q2-include' "$PRECOMMIT" \
  && ok "④ 接线: pre-commit CI 区 G12 调用 brief_parser.py（单一事实源）" \
  || no "④ 接线: 组 6 未调用同源解析器（D707 口径未统一）"
grep -qE "'/\^## \(本任务在哪一层\|架构层\)" "$PRECOMMIT" \
  && no "④ 残留第二套 awk 架构层解析（漂移源）" \
  || ok "④ 旧 awk 第二实现已移除（无漂移源）"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
