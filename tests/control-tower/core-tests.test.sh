#!/usr/bin/env bash
# @input scripts/ci/core-tests.sh 与已安装的仓内 Vitest；所有变更仅发生在 mktemp 临时仓库。
# @output 每个正常/反例的原始输出、rc、degraded JSON 断言和最终 PASS/FAIL 数。
# @exit 0=全部配对场景通过；1=至少一个判据失败；2=harness 自身环境不可用。
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="$REPO/scripts/ci/core-tests.sh"
PASS=0
FAIL=0
FAILED_NAMES=""

harness_degrade() {
  printf 'cannot judge: core-tests-harness: %s\n' "$1" >&2
  if [ -n "${SYNO_GATE_DEGRADED_LOG:-}" ]; then
    mkdir -p "$(dirname "$SYNO_GATE_DEGRADED_LOG")"
    printf '{"time":"%s","component":"core-tests-harness","code":"harness-environment","phase":"setup","retryable":false}\n' \
      "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >> "$SYNO_GATE_DEGRADED_LOG"
  fi
  exit 2
}
for tool in git node python3 bash mktemp; do
  command -v "$tool" >/dev/null 2>&1 || harness_degrade "$tool missing"
done
[ -f "$RUNNER" ] || harness_degrade "$RUNNER missing"
[ -x "$REPO/node_modules/.bin/vitest" ] || harness_degrade "real Vitest missing; run npm ci first"
bash -n "$RUNNER" || harness_degrade "runner syntax invalid"

TMP="$(mktemp -d)" || harness_degrade "mktemp failed"
trap 'node -e "require(\"node:fs\").rmSync(process.argv[1], { recursive: true, force: true })" "$TMP"' EXIT

ok() { printf 'PASS %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf 'FAIL %s\n' "$1"; FAIL=$((FAIL + 1)); FAILED_NAMES="$FAILED_NAMES$1; "; }

commit_all() {
  git -C "$FIX" add -A || return 2
  git -C "$FIX" commit -q -m "$1" || return 2
  HEAD="$(git -C "$FIX" rev-parse HEAD)"
}

new_fixture() {
  FIX="$TMP/fixture-$1"
  mkdir -p "$FIX"/{scripts/ci,scripts/desktop,.gitea/workflows,tests/control-tower,tests/contract,tests/unit,tests/e2e,src,app/js,patches}
  git -C "$FIX" init -q || harness_degrade "git init failed"
  git -C "$FIX" config user.name "Core Tests Fixture"
  git -C "$FIX" config user.email "fixture@example.invalid"
  cp "$RUNNER" "$FIX/scripts/ci/core-tests.sh"
  cp "$REPO/.gitea/workflows/core-gates.yml" "$FIX/.gitea/workflows/core-gates.yml" 2>/dev/null || printf 'name: fixture\n' > "$FIX/.gitea/workflows/core-gates.yml"
  cp "$REPO/tests/control-tower/core-tests.test.sh" "$FIX/tests/control-tower/core-tests.test.sh"
  cp "$REPO/tests/control-tower/core-gates-workflow.test.sh" "$FIX/tests/control-tower/core-gates-workflow.test.sh" 2>/dev/null || printf 'fixture\n' > "$FIX/tests/control-tower/core-gates-workflow.test.sh"
  cp "$REPO/scripts/check-secrets.sh" "$FIX/scripts/check-secrets.sh"
  cp "$REPO/scripts/desktop/build-backend.sh" "$FIX/scripts/desktop/build-backend.sh"
  cp "$REPO/package.json" "$REPO/package-lock.json" "$REPO/vitest.config.ts" "$FIX/"
  cp "$REPO/app/js/chat-sse.js" "$FIX/app/js/chat-sse.js"
  printf 'node_modules/\nrunner-temp/\n' > "$FIX/.gitignore"
  node -e "require('node:fs').symlinkSync(process.argv[1], process.argv[2], 'junction')" "$REPO/node_modules" "$FIX/node_modules" || harness_degrade "node_modules junction failed"
  cat > "$FIX/tests/contract/basic.test.ts" <<'EOF'
import { describe, expect, test } from 'vitest';
describe('contract', () => { test('real assertion', () => { expect(1 + 1).toBe(2); }); });
EOF
  cat > "$FIX/src/value.ts" <<'EOF'
export const value = 1;
EOF
  cat > "$FIX/tests/unit/value.test.ts" <<'EOF'
import { expect, test } from 'vitest';
import { value } from '../../src/value.js';
test('value', () => { expect(value).toBe(1); });
EOF
  commit_all "fixture base" || harness_degrade "fixture base commit failed"
  BASE="$HEAD"
  git -C "$FIX" update-ref refs/remotes/origin/main "$BASE" || harness_degrade "origin/main fixture failed"
}

run_current() {
  local name="$1" expected_rc="$2" expected_text="$3" expected_degraded="${4:-yes}" forbidden_text="${5:-}"
  local event="${EVENT:-manual}" base_arg="${BASE_ARG:-}"
  local args=(--event "$event")
  [ -z "$base_arg" ] || args+=(--base "$base_arg")
  [ "$PREFLIGHT_MODE" = "1" ] && args+=(--preflight)
  mkdir -p "$FIX/runner-temp"
  local log="$FIX/degraded.jsonl"
  rm -f "$log"
  set +e
  OUT="$(cd "$FIX" && env CI="$RUN_CI" GITHUB_EVENT_NAME="$RUN_EVENT" GITHUB_BASE_REF="$RUN_BASE_REF" \
    CORE_EVENT_BEFORE="$RUN_BEFORE" CORE_HEAD_SHA="$RUN_HEAD" RUNNER_TEMP="$FIX/runner-temp" \
    SYNO_GATE_DEGRADED_LOG="$log" bash scripts/ci/core-tests.sh "${args[@]}" 2>&1)"
  RC=$?
  set -e
  printf '\n--- %s (expected rc=%s, actual rc=%s) ---\n%s\n' "$name" "$expected_rc" "$RC" "$OUT"
  if [ "$RC" -ne "$expected_rc" ] || ! printf '%s\n' "$OUT" | grep -Eq "$expected_text"; then
    no "$name rc/output"
    return
  fi
  if [ -n "$forbidden_text" ] && printf '%s\n' "$OUT" | grep -Eq "$forbidden_text"; then
    no "$name forbidden output"
    return
  fi
  if [ "$expected_rc" -eq 2 ] && [ "$expected_degraded" = "yes" ]; then
    python3 - "$log" <<'PY'
import json,sys
lines=open(sys.argv[1],encoding='utf-8').read().splitlines()
assert len(lines)==1, lines
value=json.loads(lines[0])
assert set(value)=={'time','component','code','phase','retryable'}, value
assert value['component']=='core-tests' and value['retryable'] is False, value
PY
    if [ $? -ne 0 ]; then no "$name degraded JSON"; return; fi
  elif [ -s "$log" ]; then
    no "$name unexpected degraded log"
    return
  fi
  ok "$name"
}

reset_run() {
  EVENT="manual"
  BASE_ARG=""
  PREFLIGHT_MODE=0
  RUN_CI=1
  RUN_EVENT="workflow_dispatch"
  RUN_BASE_REF=""
  RUN_BEFORE=""
  RUN_HEAD="$HEAD"
}

printf '=== core-tests real Vitest paired harness ===\n'

new_fixture normal-manual
reset_run
run_current "normal manual contract and explicit skip" 0 'CORE-TESTS RESULT rc=0.*reason=manual-no-base' no

new_fixture normal-pr
printf 'export const value = 2;\n' > "$FIX/src/value.ts"
cat > "$FIX/tests/unit/value.test.ts" <<'EOF'
import { expect, test } from 'vitest';
import { value } from '../../src/value.js';
test('value', () => { expect(value).toBe(2); });
EOF
commit_all "source and affected test"
reset_run
EVENT="pull-request"; RUN_EVENT="pull_request"; RUN_BASE_REF="main"; BASE_ARG="$BASE"
run_current "source change runs real affected test" 0 'CORE-TESTS RESULT rc=0.*affected=ran.*reason=affected-passed' no

new_fixture preflight
reset_run
EVENT="pull-request"; RUN_EVENT="pull_request_target"; RUN_BASE_REF="main"; BASE_ARG="$BASE"; PREFLIGHT_MODE=1
run_current "pull_request_target clean preflight before installation" 0 'CORE-PREFLIGHT RESULT rc=0' no

new_fixture docs-only
printf 'documentation only\n' > "$FIX/README.md"
commit_all "docs only"
reset_run
EVENT="pull-request"; RUN_EVENT="pull_request"; RUN_BASE_REF="main"; BASE_ARG="$BASE"
run_current "no relevant change legal skip" 0 'CORE-TESTS SKIP affected reason=no-relevant-change' no

new_fixture production-js
printf '\n// deliberate production change\n' >> "$FIX/app/js/chat-sse.js"
commit_all "tracked production JS change"
reset_run
EVENT="pull-request"; RUN_EVENT="pull_request"; RUN_BASE_REF="main"; BASE_ARG="$BASE"
run_current "tracked app production JS enters affected collection" 1 'CORE-TESTS RUN affected|affected-no-tests|affected-no-passed-tests' no 'CORE-TESTS SKIP affected reason=no-relevant-change'

new_fixture e2e-only
cat > "$FIX/tests/e2e/only.e2e.test.ts" <<'EOF'
import { expect, test } from 'vitest';
test('e2e only', () => { expect(['e2e']).toContain('e2e'); });
EOF
commit_all "e2e only"
reset_run
EVENT="pull-request"; RUN_EVENT="pull_request"; RUN_BASE_REF="main"; BASE_ARG="$BASE"
run_current "CI-excluded-only derived by real collection" 0 'CORE-TESTS SKIP affected reason=ci-excluded-only' no

new_fixture source-e2e
printf 'export const orphan = 1;\n' > "$FIX/src/orphan.ts"
cat > "$FIX/tests/e2e/orphan.e2e.test.ts" <<'EOF'
import { expect, test } from 'vitest';
test('orphan e2e', () => { expect(['e2e']).toContain('e2e'); });
EOF
commit_all "source with only e2e"
reset_run
EVENT="pull-request"; RUN_EVENT="pull_request"; RUN_BASE_REF="main"; BASE_ARG="$BASE"
run_current "source plus only excluded test is not a pass" 1 'affected-no-tests|affected-no-passed-tests' no

new_fixture deterministic-failure
cat > "$FIX/tests/contract/basic.test.ts" <<'EOF'
import { expect, test } from 'vitest';
test('deterministic original failure', () => { expect('actual-value').toBe('expected-value'); });
EOF
commit_all "deterministic failure"
reset_run
run_current "deterministic failure retains assertion output" 1 'expected-value' no

new_fixture zero-contract
cat > "$FIX/tests/contract/basic.test.ts" <<'EOF'
import { test } from 'vitest';
test('comment only', () => { /* expect(1).toBe(2) */ });
test('string only', () => { const text = 'expect(1).toBe(2)'; void text; });
test('dead branch', () => { const unreachable = 1; if (false) { expect(unreachable).toBe(unreachable); } });
function uncalled() { const unreachable = 1; expect(unreachable).toBe(unreachable); }
test('uncalled helper', () => { void uncalled; });
EOF
commit_all "zero assertions"
reset_run
run_current "comment string dead branch and uncalled helper are zero assertions" 1 'CORE_ZERO_ASSERTIONS' no

new_fixture zero-affected
cat > "$FIX/src/empty.ts" <<'EOF'
export const empty = 1;
EOF
cat > "$FIX/tests/unit/empty.test.ts" <<'EOF'
import { test } from 'vitest';
import { empty } from '../../src/empty.js';
test('existing empty affected test', () => { void empty; });
EOF
commit_all "add empty affected fixture"
BASE="$HEAD"
git -C "$FIX" update-ref refs/remotes/origin/main "$BASE"
printf 'export const empty = 2;\n' > "$FIX/src/empty.ts"
commit_all "change source with existing empty test"
reset_run
EVENT="pull-request"; RUN_EVENT="pull_request"; RUN_BASE_REF="main"; BASE_ARG="$BASE"
run_current "source change reaches existing empty affected test" 1 'CORE_ZERO_ASSERTIONS' no

new_fixture no-objects
rm "$FIX/tests/contract/basic.test.ts"
commit_all "remove contracts"
reset_run
run_current "zero required objects" 2 'no-contract-objects'

new_fixture all-skipped
cat > "$FIX/tests/contract/basic.test.ts" <<'EOF'
import { test } from 'vitest';
test['skip']('skipped', () => { expect(['skipped']).toContain('skipped'); });
EOF
commit_all "all skipped"
reset_run
run_current "all skipped contract is cannot judge" 2 'contract-no-passed-tests'

new_fixture missing-tool
rm "$FIX/node_modules"
reset_run
run_current "missing installed Vitest fails closed" 2 'missing-tool'

new_fixture missing-json
rm "$FIX/node_modules"
mkdir -p "$FIX/node_modules/.bin"
node -e "require('node:fs').symlinkSync(process.argv[1], process.argv[2], 'junction')" "$REPO/node_modules/vitest" "$FIX/node_modules/vitest"
cat > "$FIX/node_modules/.bin/vitest" <<EOF
#!/usr/bin/env bash
json=""
for arg in "\$@"; do case "\$arg" in --outputFile.json=*) json="\${arg#*=}" ;; esac; done
"$REPO/node_modules/.bin/vitest" "\$@"
rc=\$?
[ -z "\$json" ] || rm -f "\$json"
exit "\$rc"
EOF
chmod +x "$FIX/node_modules/.bin/vitest"
reset_run
run_current "missing JSON reporter output" 2 'contract-json-missing'

new_fixture bad-base
reset_run
EVENT="pull-request"; RUN_EVENT="pull_request"; RUN_BASE_REF="main"; BASE_ARG="1111111111111111111111111111111111111111"
run_current "bad base" 2 'bad-base'

new_fixture missing-base
reset_run
EVENT="pull-request"; RUN_EVENT="pull_request"; RUN_BASE_REF="main"
run_current "missing base argument" 2 'missing-base'

new_fixture missing-base-env
reset_run
EVENT="pull-request"; RUN_EVENT="pull_request"; RUN_BASE_REF=""; BASE_ARG="$BASE"
run_current "missing GITHUB_BASE_REF" 2 'missing-base-env'

new_fixture wrong-head
reset_run
RUN_HEAD="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
run_current "wrong HEAD" 2 'wrong-head'

new_fixture unknown-event
reset_run
EVENT="unexpected"; RUN_EVENT="unexpected"
run_current "unknown event" 2 'unknown-event'

new_fixture missing-ci
reset_run
RUN_CI=0
run_current "missing CI" 2 'missing-ci'

new_fixture missing-log
reset_run
mkdir -p "$FIX/runner-temp"
set +e
OUT="$(cd "$FIX" && env -u SYNO_GATE_DEGRADED_LOG CI=1 GITHUB_EVENT_NAME=workflow_dispatch \
  CORE_HEAD_SHA="$HEAD" RUNNER_TEMP="$FIX/runner-temp" bash scripts/ci/core-tests.sh --event manual 2>&1)"
RC=$?
set -e
printf '\n--- missing log env ---\n%s\n' "$OUT"
if [ "$RC" -eq 2 ] && printf '%s\n' "$OUT" | grep -q 'SYNO_GATE_DEGRADED_LOG missing'; then ok "missing log env"; else no "missing log env"; fi

new_fixture push-missing-before
reset_run
EVENT="push"; RUN_EVENT="push"; BASE_ARG="$BASE"
run_current "push missing before" 2 'missing-base-env'

new_fixture push-bad-before
reset_run
EVENT="push"; RUN_EVENT="push"; BASE_ARG="$BASE"; RUN_BEFORE="0000000000000000000000000000000000000000"
run_current "push all-zero before" 2 'bad-base'

for kind in patched-vitest fake-tsc fake-esbuild lock patch rename; do
  new_fixture "trusted-$kind"
  case "$kind" in
    patched-vitest) printf 'fixture patch for vitest\n' > "$FIX/patches/vitest+5.0.2.patch" ;;
    fake-tsc) node -e "const fs=require('fs');const file=process.argv[1];const p=JSON.parse(fs.readFileSync(file));p.scripts.lint='fake-tsc';fs.writeFileSync(file,JSON.stringify(p,null,2))" "$FIX/package.json" ;;
    fake-esbuild) printf '\necho fake-esbuild\n' >> "$FIX/scripts/desktop/build-backend.sh" ;;
    lock) printf '\n' >> "$FIX/package-lock.json" ;;
    patch) printf 'fixture dependency patch\n' > "$FIX/patches/dependency.patch" ;;
    rename) mkdir -p "$FIX/moved"; git -C "$FIX" mv tests/contract/basic.test.ts moved/basic.test.ts ;;
  esac
  commit_all "tamper $kind"
  reset_run
  EVENT="pull-request"; RUN_EVENT="pull_request"; RUN_BASE_REF="main"; BASE_ARG="$BASE"; PREFLIGHT_MODE=1
  run_current "trusted input tamper: $kind" 2 'core-trusted-input-changed'
done

printf '\nCORE-TESTS-HARNESS RESULT pass=%s fail=%s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'FAILED: %s\n' "$FAILED_NAMES"
  exit 1
fi
exit 0
