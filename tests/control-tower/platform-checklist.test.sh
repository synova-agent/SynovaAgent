#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# platform-checklist.test.sh — D520 任务3: PLATFORM-CHECKLIST.md + pre-commit 软检查接线
#
# 覆盖矩阵:
#   正常 — checklist 文件存在且 8 条全齐（逐条 grep 关键字）
#   行为 — 构造含裸 python3 的新增脚本（SYNO_TEST_ARM 注入缝）→ 软提示点名 checklist
#   通过 — 无平台敏感命令的新脚本 → 无点名
#   接线 — pre-commit 检查块存在（D520 标记 + PLATFORM-CHECKLIST 引用）
# 沙箱: SYNO_TEST_ARM=1 + SYNO_GIT_CACHED_ADDED_NAMES 注入（零真实暂存）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PC="$REPO/scripts/pre-commit-check.sh"
CK="$REPO/scripts/control-tower/PLATFORM-CHECKLIST.md"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "=== D520 任务3: PLATFORM-CHECKLIST + 接线 ==="

# ── 正常: checklist 存在 + 8 条全齐 ──
[ -f "$CK" ] && ok "PLATFORM-CHECKLIST.md 存在" || no "checklist 文件缺失"
ITEMS=("PYBIN 三级探测" "CRLF 清洗" "core.quotepath=false" "PYTHONIOENCODING=utf-8" "date 兼容" "mktemp 沙箱" "grep -P 不可用" "timeout 缺失")
for item in "${ITEMS[@]}"; do
  grep -q "$item" "$CK" 2>/dev/null && ok "条目[$item]" || no "条目缺失: $item"
done

# ── 接线: pre-commit 检查块存在 ──
grep -q "D520/任务3" "$PC" && grep -q "PLATFORM-CHECKLIST.md" "$PC" \
  && ok "接线: pre-commit 含平台敏感命令软检查（D520）" || no "pre-commit 接线缺失"

# ── 行为: 裸 python3 新脚本 → 软提示点名（注入缝，零真实暂存）──
OUT=$(cd "$REPO" && SYNO_TEST_ARM=1 SYNO_CI=0 \
  SYNO_GIT_CACHED_NAMES="scripts/control-tower/tmp-bare-probe.sh" \
  SYNO_GIT_CACHED_ALL_NAMES="scripts/control-tower/tmp-bare-probe.sh" \
  SYNO_GIT_CACHED_ADDED_NAMES="scripts/control-tower/tmp-bare-probe.sh" \
  SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 SYNO_MAIN_TREE="$(mktemp -d)" SYNO_GATE_HITS_LOG="$(mktemp)" \
  bash scripts/pre-commit-check.sh 2>&1); rc=$?
# 探针文件不存在 → 检查内 [ ! -f ] 跳过；需真实文件（放 tests 临时，不动 scripts/）
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
mkdir -p "$REPO/scripts/control-tower"
PROBE="$REPO/scripts/control-tower/tmp-d520-plat-probe.sh"
# D564r7: 检查块锚定 ^scripts/ 相对路径（与 git diff --cached 输出一致）——原传
# 绝对路径永不匹配 → 检查空转（软/strict 双空转）。探针以相对名注入，实体仍按 $PROBE 读写
PROBE_REL="scripts/control-tower/tmp-d520-plat-probe.sh"
printf '#!/bin/bash\npython3 -c "print(1)"\ndate +%%s\ngrep -P x f\n' > "$PROBE"
OUT=$(cd "$REPO" && SYNO_TEST_ARM=1 SYNO_CI=0 \
  SYNO_GIT_CACHED_NAMES="$PROBE_REL" \
  SYNO_GIT_CACHED_ALL_NAMES="$PROBE_REL" \
  SYNO_GIT_CACHED_ADDED_NAMES="$PROBE_REL" \
  SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 SYNO_MAIN_TREE="$(mktemp -d)" SYNO_GATE_HITS_LOG="$(mktemp)" \
  bash scripts/pre-commit-check.sh 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "行为: 软提示不阻断本地 (exit 0)" || no "应 exit 0, 实际 $rc"
# D564r7: 点名断言非空洞化——原双关键词 grep 被 ✅ 头行（恒含两关键词）空洞满足；
# 须命中探针文件名（仅 hit 行含文件名）
echo "$OUT" | grep -q "tmp-d520-plat-probe" \
  && ok "行为: 裸 python3/date +%s/grep -P 被点名 checklist" || no "未点名: $(echo "$OUT" | grep 平台 | head -2)"
# CI strict: SYNO_CI=1 时同一检查转硬
OUT2=$(cd "$REPO" && SYNO_TEST_ARM=1 SYNO_CI=1 \
  SYNO_GIT_CACHED_NAMES="$PROBE_REL" SYNO_GIT_CACHED_ALL_NAMES="$PROBE_REL" SYNO_GIT_CACHED_ADDED_NAMES="$PROBE_REL" \
  SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 SYNO_MAIN_TREE="$(mktemp -d)" SYNO_GATE_HITS_LOG="$(mktemp)" \
  bash scripts/pre-commit-check.sh 2>&1); rc2=$?
# D564r7: 探针清理移到 strict 复用之后（原 rm 先于 strict → strict 恒空转 rc2=0）
rm -f "$PROBE"
[ "$rc2" -eq 1 ] && ok "CI strict: SYNO_CI=1 同检查转硬阻断 (exit 1)" || no "CI strict 未生效: $rc2"

# ── 通过: 干净脚本 → 无点名 ──
CLEAN="$REPO/scripts/control-tower/tmp-d520-clean-probe.sh"
# D564r7: 同 PROBE——相对名注入（原绝对路径致检查空转、零误报断言空洞绿）
CLEAN_REL="scripts/control-tower/tmp-d520-clean-probe.sh"
printf '#!/bin/bash\nPYBIN=""\nfor _c in python3 python py; do command -v "$_c" >/dev/null 2>&1 && PYBIN="$_c" && break; done\necho ok\n' > "$CLEAN"
OUT3=$(cd "$REPO" && SYNO_TEST_ARM=1 SYNO_CI=0 \
  SYNO_GIT_CACHED_NAMES="$CLEAN_REL" SYNO_GIT_CACHED_ALL_NAMES="$CLEAN_REL" SYNO_GIT_CACHED_ADDED_NAMES="$CLEAN_REL" \
  SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 SYNO_MAIN_TREE="$(mktemp -d)" SYNO_GATE_HITS_LOG="$(mktemp)" \
  bash scripts/pre-commit-check.sh 2>&1); rc3=$?
rm -f "$CLEAN"
# 只看平台检查行（G12 范围提示与本检查无关）
if echo "$OUT3" | grep -A1 "平台敏感命令" | grep -q "tmp-d520-clean-probe"; then
  no "干净脚本被平台检查误点名"
else
  ok "PYBIN 模式脚本不被平台检查点名（零误报）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
