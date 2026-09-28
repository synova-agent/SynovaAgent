#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# doc-dup-rule.test.sh — D964 同类文档唯一性（并入 doc-registry-gate.sh）
#
# 覆盖矩阵（铁律 48 三路径 + 改坏即红）:
#   ① 正常放行 — 新增文档归一化名不撞名 → exit 0
#   ② 重复必红 — 新增与既有文档归一化名撞名（去日期/版本/D#）且无取代声明 → exit 1
#   ③ 声明放行 — 撞名但新文件头部写「取代: <路径>」 → exit 0
#   ④ 内容重复 — 归一化名不同但内容完全相同 → exit 1
#   ⑤ 排除生效 — /archive/ 下撞名不计（归档区只读）
#   ⑥ 无新增    — 无新增文档 → 不误报（exit 0）
# 运行: bash tests/doc-system/doc-dup-rule.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/doc-system/doc-registry-gate.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

mkfix() { # 建沙箱 git 仓（登记门禁需 git 模式才能只查新增）
  FIX=$(mktemp -d)
  mkdir -p "$FIX/docs/authority" "$FIX/docs/synova" "$FIX/docs/archive"
  git -C "$FIX" init -q; git -C "$FIX" config user.email t@t.local; git -C "$FIX" config user.name t
  printf 'documents:\n  - id: T1\n    type: prd\n    path: docs/synova/RULES.md\n  - id: T2\n    type: prd\n    path: docs/synova/RULES-20260101.md\n' > "$FIX/docs/authority/DOCS-REGISTRY.yaml"
  printf '# 规则\n' > "$FIX/docs/synova/RULES.md"
  printf '# 规则旧版 20260101\n' > "$FIX/docs/synova/RULES-20260101.md"
  printf '# 归档\n' > "$FIX/docs/archive/OLD-20260101.md"
  git -C "$FIX" add -A >/dev/null 2>&1; git -C "$FIX" commit -q -m base
}

echo "=== D964: 同类文档唯一性（doc-registry-gate）==="

# 接线: 规则必须在既有检查脚本里（不新建门禁脚本）
grep -q '疑似重复文档' "$SCRIPT" && ok "接线: 规则并入 doc-registry-gate.sh" || no "接线: 规则未并入"
ls "$(dirname "$SCRIPT")" | grep -qi 'dup' && no "存在独立重复检查脚本（应并入既有）" || ok "未新建独立脚本"

# ① 正常放行: 新文档名不撞
mkfix
printf 'path: docs/synova/NEWTOPIC.md\n' >> "$FIX/docs/authority/DOCS-REGISTRY.yaml"
printf '# 新主题\n' > "$FIX/docs/synova/NEWTOPIC.md"
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "① 不撞名放行 → exit 0" || { no "① 误拦不撞名文档 (rc=$rc)"; echo "$OUT" | tail -3; }
rm -rf "$FIX"

# ② 重复必红: 既有 RULES-20260101.md，新增 RULES-20260202.md（归一化都 = rules）且无取代声明
mkfix
printf 'path: docs/synova/RULES-20260202.md\n' >> "$FIX/docs/authority/DOCS-REGISTRY.yaml"
printf '# 规则新版\n' > "$FIX/docs/synova/RULES-20260202.md"
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "② 归一化撞名（去日期）→ exit 1（红）" || no "② 重复文档未红 (rc=$rc)"
echo "$OUT" | grep -q '疑似重复文档' && ok "② 输出点名「疑似重复文档」" || no "② 未点名"
echo "$OUT" | grep -q '取代:' && ok "② 输出给出修法（取代/合并声明）" || no "② 未给修法"
# ④ 内容重复（与**既有已跟踪**文档内容完全相同、但归一化名不同）
printf '# 规则\n' > "$FIX/docs/synova/UNRELATED-NAME.md"   # 与既有 RULES.md 同内容
printf 'path: docs/synova/UNRELATED-NAME.md\n' >> "$FIX/docs/authority/DOCS-REGISTRY.yaml"
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "④ 内容指纹相同 → exit 1" || no "④ 内容重复未红 (rc=$rc)"
echo "$OUT" | grep -q '内容完全相同' && ok "④ 输出点名「内容完全相同」" || no "④ 未点名内容重复"
# ③ 声明放行: 两份新增都写「取代:」，且不再与既有内容撞车
printf '取代: docs/synova/RULES-20260101.md\n\n# 规则新版\n' > "$FIX/docs/synova/RULES-20260202.md"
printf '取代: docs/synova/RULES.md\n\n# 规则同名重写\n' > "$FIX/docs/synova/UNRELATED-NAME.md"
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "③ 写明「取代:」后放行 → exit 0" || { no "③ 声明后仍红 (rc=$rc)"; echo "$OUT" | tail -4; }
echo "$OUT" | grep -q '已声明取代/合并' && ok "③ 输出标注已声明取代/合并" || no "③ 未标注声明"
rm -rf "$FIX"

# ⑥ 无新增 → 不误报
mkfix
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "⑥ 无新增文档 → exit 0" || no "⑥ 无新增误报 (rc=$rc)"
echo "$OUT" | grep -q '0 个疑似重复' && ok "⑥ 汇总含疑似重复计数" || no "⑥ 汇总缺计数"
# ⑤ 归档区排除: archive/ 下同名不计
printf '# 归档同名\n' > "$FIX/docs/archive/RULES-20260101.md"
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "⑤ /archive/ 排除生效 → exit 0" || no "⑤ 归档区被误判 (rc=$rc)"
rm -rf "$FIX"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
