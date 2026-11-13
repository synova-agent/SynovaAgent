#!/bin/bash
# @requires bash grep awk mktemp python
# @input 无参数；对象为本工作树 pre-commit 的真实组 4a/4b 代码块。
# @output 两个行为场景及末行 PASS=2；0=通过，1=判据失败，2=夹具自身失败。
# @degraded 代码块抽取或隔离夹具失败时显式 exit 2，不把不可判当通过。
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PC="$REPO/scripts/pre-commit-check.sh"
IMPL="extensions/sentinels/revenue-health/computes/compute-sales-four-totals.ts"
PASS=0
TMP="$(mktemp -d)" || { echo "degraded: 无法建立隔离目录" >&2; exit 2; }
trap 'rm -rf "$TMP"' EXIT INT TERM
[ -f "$PC" ] && [ -f "$REPO/$IMPL" ] || { echo "degraded: 被测脚本或 compute 不存在" >&2; exit 2; }

# 抽取并执行生产脚本的原始组 4 代码，不复制一份判据，也不运行无关组。
BLOCK="$TMP/group4.sh"
awk '/^# 4a\./{on=1} on{print} on && /^hard_check "接线深度:/{exit}' "$PC" >"$BLOCK"
grep -q '^# 4a\.' "$BLOCK" && grep -q '^hard_check "接线深度:' "$BLOCK" || {
  echo "degraded: 组 4a/4b 代码块抽取失败" >&2; exit 2;
}
HARNESS="$TMP/harness.sh"
cat >"$HARNESS" <<'SH'
NEW_IMPL="$1"
PLAN_ACTIVE=0
DEFERRED_WIRING_FILES=""
hard_check() {
  local name="$1" matches="$2"
  if [ -n "$matches" ]; then printf '❌ %s\n%b' "$name" "$matches"; fi
}
plan_aware_check() { hard_check "$@"; }
SH
cat "$BLOCK" >>"$HARNESS"

run_group4() { # <directory> <output>
  (cd "$1" && bash "$HARNESS" "$IMPL") >"$2" 2>&1
}

# 正常：真实扩展 import + 调用不得再被要求伪造 src/ re-export。
OUT="$TMP/wired.log"
run_group4 "$REPO" "$OUT"
if [ ! -s "$OUT" ]; then
  echo "✅ 真实 extensions import+call 通过组 4a/4b"
  PASS=$((PASS + 1))
else
  echo "❌ 真实 extensions import+call 被误拦"
  cat "$OUT"
fi

# 负例：同一真实路径仅 import 不调用，4b 必须点名，禁止放行空接线。
FIXTURE="$TMP/import-only"
mkdir -p "$FIXTURE/$(dirname "$IMPL")"
cp "$REPO/$IMPL" "$FIXTURE/$IMPL"
cp "$REPO/extensions/sentinels/revenue-health/aggregate.ts" "$FIXTURE/extensions/sentinels/revenue-health/aggregate.ts"
AGG="$FIXTURE/extensions/sentinels/revenue-health/aggregate.ts"
python - "$AGG" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')
old = 'const salesResult = computeSalesFourTotals({'
if old not in s:
    raise SystemExit(2)
p.write_text(s.replace(old, 'const salesResult = null; void ({', 1), encoding='utf-8')
PY
[ $? -eq 0 ] || { echo "degraded: 无法构造 import-only 夹具" >&2; exit 2; }
OUT="$TMP/import-only.log"
run_group4 "$FIXTURE" "$OUT"
if grep -q '已 import 但从未调用' "$OUT"; then
  echo "✅ 扩展 import-only 被组 4b 判红"
  PASS=$((PASS + 1))
else
  echo "❌ 扩展 import-only 未被组 4b 捕获"
  cat "$OUT"
fi

echo "PASS=$PASS"
[ "$PASS" -eq 2 ] && exit 0 || exit 1
