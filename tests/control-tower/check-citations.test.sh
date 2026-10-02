#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# check-citations.test.sh — D919 引用可核验门禁（创始人必修项机制化）
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 仓内 file:line + 仓外根（伪 DSH 布局 node_modules/@deepseek-ai/）→ exit 0
#   违规 — 文件不存在 / 行号越界 / 区间倒置 / **中文名文档不存在**（原 ASCII 字符集静默漏检）
#          / 伪造外部权威（dsh- 前缀但仓外根无此包）→ exit 1 且错误码点名
#   降级 — artifact 不存在 → exit 2（fail-closed，绝不当作通过）
#   边界 — 无引用 → exit 0；`## 引用豁免` 带理由放行 / 无理由仍违规；**>25 条不截断**（原 head -25 漏洞）
#   接线 — pre-dispatch-check.sh ⑥ 调用 check-citations.py（WIRE CHECK，铁律 0-2）
# 沙箱: 全部夹具在 mktemp -d 内；仓外根为伪 DSH 布局（不依赖真实安装）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
C="$REPO/scripts/control-tower/check-citations.py"
PD="$REPO/scripts/control-tower/pre-dispatch-check.sh"
PY="$(command -v python3 || command -v python || true)"
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

if [ -z "$PY" ]; then echo "  ⚠️ python 不可用 — 跳过（fail-open，铁律 11 显式）"; exit 0; fi
[ -f "$C" ] || { echo "  ❌ 被测脚本缺失: $C"; exit 1; }

echo "=== D919 引用可核验门禁 ==="

# ── 接线（WIRE CHECK）──
echo "── 接线 ──"
if grep -q "check-citations.py" "$PD"; then ok "接线: pre-dispatch-check.sh ⑥ 调用 check-citations.py"
else no "接线: pre-dispatch-check.sh 未调用（新能力零调用方 = 未接线）"; fi
grep -q "check-citations" "$REPO/.github/workflows/ci.yml" \
  && ok "接线: CI canary 清单含本测试" || no "接线: CI canary 清单缺本测试"

# ── 伪 DSH 仓外根（确定性，不依赖真实安装）──
ROOT="$TMPD/extroot"
mkdir -p "$ROOT/node_modules/@deepseek-ai/dsh-subprocess-local/lib"
printf 'line1\nline2\n' > "$ROOT/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js"
for i in $(seq 1 800); do echo "// $i" >> "$ROOT/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js"; done

# ── 正常 ──
echo "── 正常 ──"
cat > "$TMPD/ok.md" <<MD
依据 scripts/control-tower/pre-dispatch-check.sh:10 与 docs/synova/coordination/DECISION-REFERENCE.md:19。
外部权威: dsh-subprocess-local/lib/index.js:757
MD
if "$PY" "$C" "$TMPD/ok.md" --repo "$REPO" --external-root "$ROOT" --owner test > "$TMPD/ok.out" 2>&1; then
  ok "正常: 仓内 file:line + 仓外根引用 → exit 0"
else no "正常: 应 exit 0（输出: $(tail -2 "$TMPD/ok.out" | tr '\n' '|')）"; fi

# ── 违规 ──
echo "── 违规（错误码可归因）──"
cat > "$TMPD/v1.md" <<'MD'
权威来源: docs/synova/coordination/不存在-的-裁定书.md:3
MD
"$PY" "$C" "$TMPD/v1.md" --repo "$REPO" --owner test > "$TMPD/v1.out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "CITE_FILE_NOT_FOUND" "$TMPD/v1.out" \
  && ok "违规: 中文名文档不存在 → exit 1 + CITE_FILE_NOT_FOUND（原 ASCII 字符集静默漏检）" \
  || no "违规: 中文名文档不存在未被抓（rc=$rc）"

cat > "$TMPD/v2.md" <<'MD'
scripts/control-tower/pre-dispatch-check.sh:99999
MD
"$PY" "$C" "$TMPD/v2.md" --repo "$REPO" --owner test > "$TMPD/v2.out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "CITE_LINE_OUT_OF_RANGE" "$TMPD/v2.out" \
  && ok "违规: 行号越界 → exit 1 + CITE_LINE_OUT_OF_RANGE" || no "违规: 行号越界未被抓（rc=$rc）"

cat > "$TMPD/v3.md" <<'MD'
docs/synova/coordination/DECISION-REFERENCE.md:40-12
MD
"$PY" "$C" "$TMPD/v3.md" --repo "$REPO" --owner test > "$TMPD/v3.out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "CITE_BAD_RANGE" "$TMPD/v3.out" \
  && ok "违规: 区间倒置 → exit 1 + CITE_BAD_RANGE" || no "违规: 区间倒置未被抓（rc=$rc）"

cat > "$TMPD/v4.md" <<'MD'
外部权威: dsh-不存在包/lib/index.js:12
MD
"$PY" "$C" "$TMPD/v4.md" --repo "$REPO" --external-root "$ROOT" --owner test > "$TMPD/v4.out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "CITE_FILE_NOT_FOUND" "$TMPD/v4.out" \
  && ok "违规: 伪造外部权威（dsh- 前缀但仓外根无此包）→ exit 1" || no "违规: 伪造外部权威未被抓（rc=$rc）"

# 归因字段（违规从不匿名）
grep -q "owner=test" "$TMPD/v1.out" && ok "可归因: 违规记录含 owner" || no "可归因: 违规记录缺 owner"

# ── 降级 ──
echo "── 降级（fail-closed）──"
"$PY" "$C" "$TMPD/不存在.md" --repo "$REPO" > "$TMPD/d.out" 2>&1; rc=$?
[ "$rc" -eq 2 ] && grep -q "degraded" "$TMPD/d.out" \
  && ok "降级: artifact 不存在 → exit 2 + degraded（不当作通过）" || no "降级: 期望 exit 2 实得 $rc"

# ── 边界 ──
echo "── 边界 ──"
printf '本文无任何引用。\n' > "$TMPD/e1.md"
if "$PY" "$C" "$TMPD/e1.md" --repo "$REPO" >/dev/null 2>&1; then ok "边界: 无引用 → exit 0"; else no "边界: 无引用应 exit 0"; fi

cat > "$TMPD/e2.md" <<'MD'
引用 docs/synova/coordination/不存在-豁免测试.md:1

## 引用豁免
- docs/synova/coordination/不存在-豁免测试.md:1 — 该裁定书由创始人口头下达，尚未落盘（示例理由）
MD
if "$PY" "$C" "$TMPD/e2.md" --repo "$REPO" >/dev/null 2>&1; then ok "边界: 引用豁免（带理由）→ 放行"; else no "边界: 带理由的豁免被误拦"; fi

cat > "$TMPD/e3.md" <<'MD'
引用 docs/synova/coordination/不存在-豁免测试.md:1

## 引用豁免
- docs/synova/coordination/不存在-豁免测试.md:1
MD
"$PY" "$C" "$TMPD/e3.md" --repo "$REPO" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "边界: 豁免无理由 → 仍违规（无理由不生效）" || no "边界: 无理由豁免被放行（rc=$rc）"

# 不截断（原 head -25 漏洞回归防线）
: > "$TMPD/e4.md"
for i in $(seq 1 40); do echo "假引用 docs/synova/coordination/不存在-$i.md:1" >> "$TMPD/e4.md"; done
# 注意: 本测试 set -o pipefail → 不可用 `cmd | py || echo 0`（首命令 exit 1 会让 || 追加第二行 → "40\n0"）
"$PY" "$C" "$TMPD/e4.md" --repo "$REPO" --json > "$TMPD/e4.json" 2>/dev/null  # swallow-ok: 该次调用预期 exit 1（40 条违规），stdout 已重定向留档，stderr 无语义
N=$("$PY" -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8'))['summary']['violations'])" "$TMPD/e4.json" 2>/dev/null) || N=0
[ "${N:-0}" -eq 40 ] && ok "边界: 40 条违规全量报出（不截断，原 head -25 漏洞）" || no "边界: 违规数 ${N:-0} ≠ 40（截断回归）"

# D919 自测修正回归：行内标注「新建」的交付物 = 声明，非违规（防合法派单件被误拦）
cat > "$TMPD/e5.md" <<'MD'
待建交付物: `docs/synova/audit-reports/2026-09-23-K3-示例.md`（新建）
MD
OUT=$("$PY" "$C" "$TMPD/e5.md" --repo "$REPO" 2>&1); RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q "待建声明 1"; then ok "边界: 行内「新建」→ 待建声明（不计违规，防误拦合法派单件）"
else no "边界: 「新建」未识别为声明（rc=${RC}, out=${OUT}）"; fi

echo ""
echo "=== D964: archive/** 豁免根（文档减负归档）==="
# 归档件引用的是「移动前」路径 ⇒ 豁免；同内容放非 archive 路径 ⇒ 必须红（改坏即红）
mkdir -p "$TMPD/archive" "$TMPD/docs964"
printf '见 `src/nonexistent-964.ts:99`\n' > "$TMPD/archive/old-964.md"
OUT=$("$PY" "$C" "$TMPD/archive/old-964.md" --repo "$REPO" 2>&1); RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q "archive/\*\* 豁免根"; then ok "⑨ archive/** 豁免根生效 → exit 0 且显式打印跳过（不静默）"
else no "⑨ archive 豁免未生效（rc=${RC}, out=${OUT}）"; fi
cp "$TMPD/archive/old-964.md" "$TMPD/docs964/broken-964.md"
OUT=$("$PY" "$C" "$TMPD/docs964/broken-964.md" --repo "$REPO" 2>&1); RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CITE_FILE_NOT_FOUND"; then ok "⑨ 改坏即红: 同内容非 archive 路径必须报违规 → exit 1"
else no "⑨ 改坏即红失败（rc=${RC}, out=${OUT}）"; fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
