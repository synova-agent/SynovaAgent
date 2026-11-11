#!/usr/bin/env bash
# @input scripts/ci/core-tests.sh、真实 Vitest 与最小临时仓库。
# @output user-visible 正常/失败/零对象/受信预检的原始输出与 PASS/FAIL 计数。
# @exit 0=全部配对场景通过；1=至少一个判据失败；2=harness 自身环境不可用。
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="$REPO/scripts/ci/core-tests.sh"
PASS=0
FAIL=0

for tool in git node python3 bash mktemp; do
  command -v "$tool" >/dev/null 2>&1 || { printf 'cannot judge: %s missing\n' "$tool" >&2; exit 2; }
done
[ -x "$REPO/node_modules/.bin/vitest" ] || { printf 'cannot judge: real Vitest missing\n' >&2; exit 2; }
bash -n "$RUNNER" || exit 2
TMP="$(mktemp -d)" || exit 2
trap 'node -e "require(\"node:fs\").rmSync(process.argv[1], { recursive: true, force: true })" "$TMP"' EXIT

new_fixture() {
  FIX="$TMP/fixture-$1"
  mkdir -p "$FIX"/{scripts/ci,tests/contract,tests/user-visible}
  git -C "$FIX" init -q
  git -C "$FIX" config user.name "Core User Visible Fixture"
  git -C "$FIX" config user.email "fixture@example.invalid"
  cp "$RUNNER" "$FIX/scripts/ci/core-tests.sh"
  cp "$REPO/package.json" "$REPO/package-lock.json" "$REPO/vitest.config.ts" "$FIX/"
  printf 'node_modules/\nrunner-temp/\n' > "$FIX/.gitignore"
  node -e "require('node:fs').symlinkSync(process.argv[1], process.argv[2], 'junction')" "$REPO/node_modules" "$FIX/node_modules"
  cat > "$FIX/tests/contract/basic.test.ts" <<'EOF'
import { expect, test } from 'vitest';
test('contract', () => { expect(1 + 1).toBe(2); });
EOF
  cat > "$FIX/tests/user-visible/behavior.test.ts" <<'EOF'
import { expect, test } from 'vitest';
test('user visible behavior', () => { expect('visible').toBe('visible'); });
EOF
  git -C "$FIX" add -A
  git -C "$FIX" commit -q -m 'fixture base'
  BASE="$(git -C "$FIX" rev-parse HEAD)"
  HEAD="$BASE"
  git -C "$FIX" update-ref refs/remotes/origin/main "$BASE"
  EVENT="manual"
  PREFLIGHT=0
}

run_current() {
  local name="$1" expected_rc="$2" expected_text="$3"
  local args=(--event "$EVENT")
  if [ "$EVENT" = "pull-request" ]; then args+=(--base "$BASE"); fi
  [ "$PREFLIGHT" -eq 0 ] || args+=(--preflight)
  mkdir -p "$FIX/runner-temp"
  local log="$FIX/degraded.jsonl"
  rm -f "$log"
  local event_name="workflow_dispatch"
  [ "$EVENT" = "manual" ] || event_name="pull_request"
  set +e
  OUT="$(cd "$FIX" && env CI=1 GITHUB_EVENT_NAME="$event_name" GITHUB_BASE_REF=main \
    CORE_HEAD_SHA="$HEAD" RUNNER_TEMP="$FIX/runner-temp" SYNO_GATE_DEGRADED_LOG="$log" \
    bash scripts/ci/core-tests.sh "${args[@]}" 2>&1)"
  RC=$?
  set -e
  printf '\n--- %s (expected rc=%s, actual rc=%s) ---\n%s\n' "$name" "$expected_rc" "$RC" "$OUT"
  if [ "$RC" -ne "$expected_rc" ] || ! printf '%s\n' "$OUT" | grep -Eq "$expected_text"; then
    printf 'FAIL %s\n' "$name"
    FAIL=$((FAIL + 1))
    return
  fi
  if [ "$expected_rc" -eq 2 ]; then
    python3 - "$log" <<'PY'
import json,sys
lines=open(sys.argv[1],encoding='utf-8').read().splitlines()
assert len(lines)==1,lines
value=json.loads(lines[0])
assert value['component']=='core-tests' and value['retryable'] is False,value
PY
    if [ $? -ne 0 ]; then printf 'FAIL %s degraded JSON\n' "$name"; FAIL=$((FAIL + 1)); return; fi
  elif [ -s "$log" ]; then
    printf 'FAIL %s unexpected degraded log\n' "$name"
    FAIL=$((FAIL + 1))
    return
  fi
  printf 'PASS %s\n' "$name"
  PASS=$((PASS + 1))
}

printf '=== core user-visible paired harness ===\n'
new_fixture normal
run_current 'manual always runs user-visible' 0 'CORE-TESTS RESULT rc=0.*user_visible_passed=1.*reason=manual-no-base'

new_fixture failure
cat > "$FIX/tests/user-visible/behavior.test.ts" <<'EOF'
import { expect, test } from 'vitest';
test('original visible assertion', () => { expect('broken-A').toBe('expected-A'); });
EOF
git -C "$FIX" add -A && git -C "$FIX" commit -q -m 'break visible behavior'
HEAD="$(git -C "$FIX" rev-parse HEAD)"
run_current 'visible failure retains original assertion' 1 'expected-A'

new_fixture zero-objects
rm "$FIX/tests/user-visible/behavior.test.ts"
git -C "$FIX" add -A && git -C "$FIX" commit -q -m 'remove visible objects'
HEAD="$(git -C "$FIX" rev-parse HEAD)"
run_current 'zero visible objects is cannot judge' 2 'no-user-visible-objects'

new_fixture zero-assertions
cat > "$FIX/tests/user-visible/behavior.test.ts" <<'EOF'
import { test } from 'vitest';
test('empty visible behavior', () => { const value = 1; void value; });
EOF
git -C "$FIX" add -A && git -C "$FIX" commit -q -m 'empty visible test'
HEAD="$(git -C "$FIX" rev-parse HEAD)"
run_current 'visible zero assertions fails' 1 'user-visible-zero-assertions'

new_fixture daily-change
cat >> "$FIX/tests/user-visible/behavior.test.ts" <<'EOF'
test('daily visible addition', () => { expect(2 + 2).toBe(4); });
EOF
git -C "$FIX" add -A && git -C "$FIX" commit -q -m 'daily visible test change'
HEAD="$(git -C "$FIX" rev-parse HEAD)"
EVENT="pull-request"
PREFLIGHT=1
run_current 'daily visible change is not trusted input' 0 'CORE-PREFLIGHT RESULT rc=0'

printf '\nCORE-USER-VISIBLE-HARNESS RESULT pass=%s fail=%s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
