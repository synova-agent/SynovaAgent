#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# brief-parser-cjk-path.test.sh — D1061 任务 5④: 路径尾括号根因（含括号的真实文件名不得被截断）
#
# 背景（实测）: `brief_parser.py` 的 parse_q2 原实现无条件
#   `path = re.split(r"[（(]", path, 1)[0].strip()` —— 把**路径自带的括号**当"括号描述"剥掉。
#   #878 实证: `.claude/task-briefs/2026-09-28-D1052-…-docs（系统性假红修复）.md`
#   → 截成 `…-docs` → D708 判「夹带 1 个」→ TypeScript+Lint 红（rc=2）。
#
# 覆盖矩阵（铁律 48 三路径）:
#   正常 — 含全角括号的真实文件名 → **完整保留**（本卡修复目标）
#   正常 — 含半角括号的真实文件名 → 完整保留
#   正常 — 「路径 + 括号描述」→ 仍剥掉描述（既有语义不回归）
#   降级 — 无括号路径 → 原样（不回归）
#   边界 — 「path L750」行号后缀仍被剥（D543 语义不回归）
#   边界 — 括号在**扩展名之后**（`x.ts（说明）`）不得被当成路径保留
#   变异体 — 把逻辑改回"先剥括号"→ 本测试必红（见文件末尾说明）
#
# 沙箱: 纯文本 fixture 注入，零 git、零网络
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PARSER="$REPO/scripts/control-tower/brief_parser.py"
PYBIN="$(command -v python3 || command -v python)"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

FIXTURE="$(mktemp)"; trap 'rm -f "$FIXTURE"' EXIT
cat > "$FIXTURE" <<'EOF'
#CRITERIA: D

## Q2: 范围
做什么:
- 改 src/l3/foo.ts（专家路由）
- 新增 scripts/control-tower/new-gate.sh
- .claude/task-briefs/x-docs（系统性假红修复）.md
- .claude/task-briefs/y-docs(ascii-paren).md
- .claude/task-briefs/2026-09-29-D1058-派单闸门落地：R8-修复-+-§〇-归属-回执-点-id-三项检查.md
- scripts/x.sh L750
不做什么（含文件路径）:
- 不改 scripts/audit/（K3 专属红线）
- 不改 src/l4/bar.ts

## 架构层:
scripts（控制塔域）
EOF

OUT="$("$PYBIN" "$PARSER" --all "$FIXTURE" 2>&1)"
q() { printf '%s' "$OUT" | "$PYBIN" -c "
import json,sys
d=json.load(sys.stdin)
print(json.dumps(d.get(sys.argv[1]), ensure_ascii=False))" "$1" 2>/dev/null || echo "PARSE-ERR"; }

echo "=== D1061 5④: 路径形状优先（含括号真实文件名不被截断）==="

INC="$(q q2_include)"
EXC="$(q q2_exclude)"

# ── 正常路径 ──
printf '%s' "$INC" | grep -qF '.claude/task-briefs/x-docs（系统性假红修复）.md' \
  && ok "正常: 全角括号真实文件名 **完整保留**（修复目标）" \
  || no "正常: 全角括号文件名被截断 → $INC"
printf '%s' "$INC" | grep -qF '.claude/task-briefs/y-docs(ascii-paren).md' \
  && ok "正常: 半角括号真实文件名 完整保留" \
  || no "正常: 半角括号文件名被截断 → $INC"
printf '%s' "$INC" | grep -qF '.claude/task-briefs/2026-09-29-D1058-派单闸门落地：R8-修复-+-§〇-归属-回执-点-id-三项检查.md' \
  && ok "正常: **全角冒号**真实文件名 完整保留（D1058 实战样本；形状优先须在冒号切分之前）" \
  || no "正常: 全角冒号文件名被截断 → $INC"
printf '%s' "$INC" | grep -qF 'src/l3/foo.ts' \
  && ok "正常: 「路径 + 括号描述」仍剥描述 → src/l3/foo.ts" \
  || no "正常: src/l3/foo.ts 未正确剥描述 → $INC"
printf '%s' "$INC" | grep -qF 'scripts/control-tower/new-gate.sh' \
  && ok "正常: 无括号路径 原样通过（不回归）" \
  || no "正常: new-gate.sh 丢失 → $INC"

# ── 边界/降级 ──
printf '%s' "$INC" | grep -qF 'scripts/x.sh' \
  && ok "边界: 「path L750」行号后缀仍被剥（D543 不回归）" \
  || no "边界: scripts/x.sh 未剥 L750 → $INC"
# 「路径（描述）」中括号在扩展名之后 → 不应把整条当路径
if printf '%s' "$INC" | grep -qF 'src/l3/foo.ts（专家路由）'; then
  no "边界: 「x.ts（说明）」被整体保留（说明未被剥）→ $INC"
else
  ok "边界: 括号在扩展名之后 → 说明被剥（形状判定未过度放宽）"
fi
printf '%s' "$EXC" | grep -qF 'scripts/audit/' \
  && ok "降级: exclude「不改 scripts/audit/（K3 专属红线）」→ scripts/audit/" \
  || no "降级: exclude 剥壳语义回归 → $EXC"
printf '%s' "$EXC" | grep -qF 'src/l4/bar.ts' \
  && ok "降级: exclude 无括号路径 原样" \
  || no "降级: exclude bar.ts 丢失 → $EXC"

# ── 判据计数（防"只看命中不看总数"）──
N_INC="$(printf '%s' "$INC" | "$PYBIN" -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null || echo -1)"
N_EXC="$(printf '%s' "$EXC" | "$PYBIN" -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null || echo -1)"
[ "$N_INC" -eq 6 ] && ok "边界: include 条数 = 6（无重复/无丢失）" || no "边界: include 条数 = ${N_INC}（期望 6）"
[ "$N_EXC" -eq 2 ] && ok "边界: exclude 条数 = 2" || no "边界: exclude 条数 = ${N_EXC}（期望 2）"

echo ""
echo "  ── 回归: 钉住语义文件（本卡不改它，但必须仍绿）──"
STRIP="$REPO/tests/control-tower/brief-parser-strip.test.sh"
if [ -f "$STRIP" ]; then
  if bash "$STRIP" >/tmp/d1061-cjk-strip.log 2>&1; then
    ok "brief-parser-strip.test.sh（#803 占用）仍全绿"
  else
    no "brief-parser-strip.test.sh 回归失败（见 /tmp/d1061-cjk-strip.log）"
  fi
else
  no "brief-parser-strip.test.sh 缺失（回归面不可用）"
fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
# 变异体（改坏即红，本卡实测贴于 B 证据）:
# 变异体（改坏即红，本卡实测贴于 B 证据）:
#   ① 把形状优先判据**挪回两个切分之后**（即恢复 `[:：]` 先切）
#      → 「全角冒号文件名完整保留」必红；
#   ② 删掉形状判定（恢复无条件剥括号）→ 「全角/半角括号文件名完整保留」必红。
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
