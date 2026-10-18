#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# doc-truth-probe.test.sh — 防线存活探针测试（铁律 48：正常/降级/边界三路径）
# 用例（K3 §7.2 收割 3 验收「区分防线绿与防线从未运行」）:
#   A run 绿: D1 绿 → 台账生成 + exit 0 + FRESH-GREEN
#   B run 红: D1 红（专家数不符）→ 台账 firstRedAt + exit 1 + FRESH-RED + ❌ 点名
#   C 红连续性: 连续两轮红 → firstRedAt 继承不重置
#   D NEVER-RUN: 无台账 → --probe-only exit 1 + NEVER-RUN（区分「从未运行」核心用例）
#   E STALE: 台账时间戳超龄 → --probe-only exit 1 + STALE
#   F FRESH-GREEN probe-only: 新鲜绿台账 → exit 0
#   G 降级: D1 缺失 → exit 2 + degraded
# 运行: bash tests/doc-system/doc-truth-probe.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/doc-system/doc-truth-probe.sh"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0

t() { # $1=用例名 $2=期望 $3=实际
  if [ "$2" = "$3" ]; then echo "  ✅ $1 (exit $3)"; PASS=$((PASS+1)); else echo "  ❌ $1 (期望 $2 实际 $3)"; FAIL=$((FAIL+1)); fi
}
tg() { # $1=用例名 $2=期望子串 $3=实际输出
  case "$3" in *"$2"*) echo "  ✅ $1 (含「$2」)"; PASS=$((PASS+1));; *) echo "  ❌ $1 (输出不含「$2」)"; FAIL=$((FAIL+1));; esac
}

FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT

# ── fixture: 最小 D1 绿仓库（AGENTS=registry 2 专家 + 版本一致 + 路径齐全）──
mkfix() {
  mkdir -p "$FIX/expert" "$FIX/scripts/doc-system" "$FIX/docs/authority" "$FIX/knowledge/shared"
  cp "$REPO/scripts/doc-system/check-doc-truth.sh" "$FIX/scripts/doc-system/"
  printf 'experts:\n  alpha:\n    enabled: true\n  beta:\n    enabled: true\n' > "$FIX/expert/expert-registry.yaml"
  # #595: C2 真值 = 组横幅数 ⇒ fixture 必须带 5 条横幅；汇总行改运行时变量（单引号=字面）
  printf 'echo "── 组 1: fixture ──"\n' > "$FIX/scripts/pre-commit-check.sh"
  printf 'echo "── 组 2: fixture ──"\n' >> "$FIX/scripts/pre-commit-check.sh"
  printf 'echo "── 组 3: fixture ──"\n' >> "$FIX/scripts/pre-commit-check.sh"
  printf 'echo "── 组 4: fixture ──"\n' >> "$FIX/scripts/pre-commit-check.sh"
  printf 'echo "── 组 5: fixture ──"\n' >> "$FIX/scripts/pre-commit-check.sh"
  printf 'echo "✅ 全部 ${GROUP_DONE} 组通过"\n' >> "$FIX/scripts/pre-commit-check.sh"
  printf '> V1.0.0 | x\n\n2位专家\n' > "$FIX/AGENTS.md"
    printf '> V1.0.0\n\npre-commit 5 组\n' > "$FIX/LOOP.md"
  printf '2位专家\n' > "$FIX/knowledge/shared/README.md"
  : > "$FIX/CHRONICLE.md"; : > "$FIX/INDEX.md"; : > "$FIX/START-HERE.md"
  : > "$FIX/docs/authority/PRD.md"; : > "$FIX/docs/authority/ARCHITECTURE.md"
  : > "$FIX/docs/authority/STATUS.md"; : > "$FIX/docs/authority/DOCS-REGISTRY.yaml"
}

mkfix
# A: run 模式 D1 全绿 → 台账生成 + FRESH-GREEN
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); RC=$?
t  "A run 绿 exit0" 0 "$RC"
tg "A1 输出 FRESH-GREEN" "FRESH-GREEN" "$OUT"
[ -f "$FIX/docs/authority/DRIFT-LEDGER.md" ]; t "A2 台账已生成" 0 $?
grep -q "lastVerifiedAt:" "$FIX/docs/authority/DRIFT-LEDGER.md"; t "A3 台账含时间戳" 0 $?
grep -q "exitCode: 0" "$FIX/docs/authority/DRIFT-LEDGER.md"; t "A4 台账含 exitCode" 0 $?

# B: 破坏专家数（替换首个 2位专家→3位专家，C1 提取 head -1）→ run → FRESH-RED + firstRedAt
python3 - "$FIX/AGENTS.md" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
open(p, 'w', encoding='utf-8').write(s.replace('2位专家', '3位专家', 1))
PYEOF
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" 2>&1); RC=$?
t  "B run 红 exit1" 1 "$RC"
tg "B1 输出 FRESH-RED" "FRESH-RED" "$OUT"
tg "B2 点名 C1 专家数" "C1 专家数" "$OUT"
grep -q "firstRedAt: 20" "$FIX/docs/authority/DRIFT-LEDGER.md"; t "B3 台账 firstRedAt 已记" 0 $?

# C: 再跑一轮红 → firstRedAt 不重置（继承）
FR1=$(grep -oE 'firstRedAt: [^ ]+' "$FIX/docs/authority/DRIFT-LEDGER.md" | head -1)
sleep 1
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1
FR2=$(grep -oE 'firstRedAt: [^ ]+' "$FIX/docs/authority/DRIFT-LEDGER.md" | head -1)
[ "$FR1" = "$FR2" ]; t "C 红连续性 firstRedAt 继承" 0 $?

# D: 无台账 → probe-only → NEVER-RUN（区分「从未运行」核心验收）
rm "$FIX/docs/authority/DRIFT-LEDGER.md"
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" --probe-only 2>&1); RC=$?
t  "D NEVER-RUN exit1" 1 "$RC"
tg "D1 输出 NEVER-RUN" "NEVER-RUN" "$OUT"

# E: 台账超龄（20 天前）→ probe-only → STALE
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1
OLD_TS=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=20)).astimezone().isoformat(timespec='seconds'))")
python3 - "$FIX/docs/authority/DRIFT-LEDGER.md" "$OLD_TS" <<'PYEOF'
import sys, re
p, ts = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
s = re.sub(r'lastVerifiedAt: [^\n]*', f'lastVerifiedAt: {ts}', s)
open(p, 'w', encoding='utf-8').write(s)
PYEOF
OUT=$(DOC_TRUTH_ROOT="$FIX" DOC_PROBE_STALE_DAYS=7 bash "$SCRIPT" --probe-only 2>&1); RC=$?
t  "E STALE exit1" 1 "$RC"
tg "E1 输出 STALE" "STALE" "$OUT"

# F: 修复回绿 + run 刷新 → probe-only → FRESH-GREEN exit 0
python3 - "$FIX/AGENTS.md" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
open(p, 'w', encoding='utf-8').write(s.replace('3位专家', '2位专家'))
PYEOF
DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" >/dev/null 2>&1
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" --probe-only 2>&1); RC=$?
t  "F probe-only 绿 exit0" 0 "$RC"
tg "F1 输出 FRESH-GREEN" "FRESH-GREEN" "$OUT"

# G: D1 缺失 → degraded exit 2
rm "$FIX/scripts/doc-system/check-doc-truth.sh"
OUT=$(DOC_TRUTH_ROOT="$FIX" bash "$SCRIPT" --probe-only 2>&1); RC=$?
t  "G D1缺失 exit2" 2 "$RC"
tg "G1 输出 degraded" "degraded" "$OUT"

echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
