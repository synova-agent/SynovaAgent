#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# external-auditor-empty.test.sh — D661 external-auditor 崩溃修复 + 检测语义回归
#
# 覆盖矩阵（铁律 48）:
#   正常   — 无发现 diff → exit 0、P0/P1/P2=0、报告正常（空 FINDINGS 不崩）
#   正常   — 含 as any/空 catch/TODO diff → 检测命中（P0 TYPES + P0 EXCEPTION + P2 CONTRACT）
#            （覆盖 grep -oP→-oE 的 PCRE→ERE 重写语义等价，防检测收窄）
#   降级/边界 — 空 FINDINGS 在 set -u 下不 unbound variable 崩溃（bash 3.2 实测崩溃）；
#            file_line 提取无匹配在 set -e 下不崩（|| true 防御）
#
# 隔离: mktemp -d + git init 临时 repo；干净 src+test 文件 → 零发现 → 空 FINDINGS
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
AUDITOR="$REPO_DIR/scripts/control-tower/external-auditor.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

make_repo() { # <dir> <src_content> <test_content>
  local d="$1" s="$2" t="$3"
  git -C "$d" init -q 2>/dev/null || true
  git -C "$d" config user.email test@test
  git -C "$d" config user.name test
  mkdir -p "$d/src" "$d/tests"
  echo "" > "$d/src/.gitkeep"
  git -C "$d" add -A >/dev/null 2>&1 && git -C "$d" commit -qm "base" 2>/dev/null || true
  cat > "$d/src/clean.ts" <<EOF
$s
EOF
  cat > "$d/tests/clean.test.ts" <<EOF
$t
EOF
  git -C "$d" add -A >/dev/null 2>&1 && git -C "$d" commit -qm "change" 2>/dev/null || true
}

echo "=== D661: external-auditor 崩溃修复 + 检测语义回归 ==="

# ═══ 场景 1: 空 FINDINGS 不崩 ═══
D1=$(mktemp -d)
make_repo "$D1" "export function cleanFn(): number { return 1; }" "import { cleanFn } from '../src/clean';"
set +e
OUT1=$(cd "$D1" && bash "$AUDITOR" --task-id D661-empty --diff HEAD~1..HEAD 2>&1)
EC1=$?
set -e
if [ "$EC1" -eq 0 ]; then ok "场景1 空 FINDINGS: exit 0（不崩）"; else no "场景1 exit=${EC1}（期望 0）"; fi
if echo "$OUT1" | grep -q "unbound variable"; then no "场景1 输出含 unbound variable"; else ok "场景1 无 unbound variable"; fi
if echo "$OUT1" | grep -qE 'P0: 0 \| P1: 0 \| P2: 0'; then ok "场景1 计数全 0"; else no "场景1 计数非全 0"; fi
if echo "$OUT1" | grep -q '报告:'; then ok "场景1 报告输出正常（全链路走通）"; else no "场景1 无「报告:」行"; fi

# ═══ 场景 2: 检测语义（as any + 空 catch + TODO）═══
D2=$(mktemp -d)
make_repo "$D2" 'export function bad(x: unknown) {
  const y = x as any;
  try { y(); } catch (e) {}
  // TODO: fix later
  return 1;
}' "import { bad } from '../src/bad';"
set +e
OUT2=$(cd "$D2" && bash "$AUDITOR" --task-id D661-detect --diff HEAD~1..HEAD 2>&1)
EC2=$?
set -e
if [ "$EC2" -eq 0 ]; then ok "场景2 检测: exit 0（file_line 无匹配不崩）"; else no "场景2 exit=${EC2}（期望 0，疑似 file_line set -e 崩溃）"; fi
if echo "$OUT2" | grep -qE 'P0: 2 \| P1: 0 \| P2: 1'; then ok "场景2 检测计数 P0:2 P2:1（as any+空 catch+ TODO）"; else no "场景2 计数异常: $(echo "$OUT2" | grep -oE 'P0: [0-9]+ \| P1: [0-9]+ \| P2: [0-9]+' | head -1)"; fi

# 检测详情在报告文件（auditor PROJECT_ROOT 由 SCRIPT_DIR 固定 → 写真实 repo），非 stdout
REPORT2="$REPO_DIR/.codex/audit-reports/D661-detect.md"
if [ -f "$REPORT2" ]; then
  if grep -q "as any 在生产代码中" "$REPORT2"; then ok "场景2 检测 as any"; else no "场景2 未检测 as any（ERE 重写语义收窄？）"; fi
  if grep -q "空 catch 块" "$REPORT2"; then ok "场景2 检测空 catch"; else no "场景2 未检测空 catch"; fi
  if grep -q "TODO/FIXME 残留" "$REPORT2"; then ok "场景2 检测 TODO"; else no "场景2 未检测 TODO"; fi
else
  no "场景2 报告文件未生成"
fi

rm -rf "$D1" "$D2"
rm -f "$REPO_DIR/.codex/audit-reports/D661-empty".* "$REPO_DIR/.codex/audit-reports/D661-detect".*

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ external-auditor 测试未通过"
  exit 1
fi
echo "  Status: ✅ external-auditor 测试全部通过"
exit 0
