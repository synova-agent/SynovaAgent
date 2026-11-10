#!/usr/bin/env bash
# @input --event pull-request|push|manual [--base <commit>] [--preflight]；CI、事件 payload 与 SYNO_GATE_DEGRADED_LOG。
# @output 原始 Vitest 输出、真实 JSON 计数、collection 分类与 CORE-TESTS RESULT；--preflight 只检受信输入和环境。
# @exit 0=测试通过或合法跳过；1=确定性测试失败/零有效回归；2=环境、受信输入或结果不可判。
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

EVENT=""
BASE=""
PREFLIGHT=0
CONTRACT_PASSED=0
AFFECTED="skipped"
AFFECTED_PASSED=0
COMPONENT="core-tests"

result() {
  printf 'CORE-TESTS RESULT rc=%s contract_passed=%s affected=%s affected_passed=%s reason=%s\n' \
    "$1" "$CONTRACT_PASSED" "$AFFECTED" "$AFFECTED_PASSED" "$2"
}

degrade() {
  local code="$1" phase="$2" message="$3" retryable="${4:-false}"
  printf 'cannot judge: %s: %s\n' "$code" "$message" >&2
  printf '{"time":"%s","component":"%s","code":"%s","phase":"%s","retryable":%s}\n' \
    "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$COMPONENT" "$code" "$phase" "$retryable" >> "$SYNO_GATE_DEGRADED_LOG"
  result 2 "$code"
  exit 2
}

fail_test() {
  printf '%s\n' "$1" >&2
  result 1 "$2"
  exit 1
}

require_value() {
  local name="$1" code="$2" phase="$3"
  if [ -z "${!name:-}" ]; then
    degrade "$code" "$phase" "$name missing"
  fi
}

ARG_ERROR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --event)
      if [ $# -lt 2 ]; then ARG_ERROR="--event requires a value"; break; fi
      EVENT="$2"; shift 2 ;;
    --base)
      if [ $# -lt 2 ]; then ARG_ERROR="--base requires a value"; break; fi
      BASE="$2"; shift 2 ;;
    --preflight)
      PREFLIGHT=1; shift ;;
    *)
      ARG_ERROR="unknown argument: $1"
      break ;;
  esac
done

if [ -z "${SYNO_GATE_DEGRADED_LOG:-}" ]; then
  printf 'cannot judge: SYNO_GATE_DEGRADED_LOG missing\n' >&2
  result 2 "missing-log-env"
  exit 2
fi
mkdir -p "$(dirname "$SYNO_GATE_DEGRADED_LOG")"
[ -z "$ARG_ERROR" ] || degrade "invalid-arguments" "arguments" "$ARG_ERROR"

if [ "${CI:-}" != "1" ]; then
  degrade "missing-ci" "environment" "CI must equal 1"
fi
case "$EVENT" in
  pull-request) EXPECTED_EVENT="pull_request" ;;
  push) EXPECTED_EVENT="push" ;;
  manual) EXPECTED_EVENT="workflow_dispatch" ;;
  *) degrade "unknown-event" "arguments" "unsupported --event '$EVENT'" ;;
esac
require_value "GITHUB_EVENT_NAME" "missing-event-env" "environment"
if [ "$EVENT" = "pull-request" ]; then
  [ "$GITHUB_EVENT_NAME" = "pull_request" ] || [ "$GITHUB_EVENT_NAME" = "pull_request_target" ] || \
    degrade "event-mismatch" "environment" "GITHUB_EVENT_NAME=$GITHUB_EVENT_NAME does not match --event $EVENT"
else
  [ "$GITHUB_EVENT_NAME" = "$EXPECTED_EVENT" ] || degrade "event-mismatch" "environment" "GITHUB_EVENT_NAME=$GITHUB_EVENT_NAME does not match --event $EVENT"
fi
require_value "CORE_HEAD_SHA" "missing-head-env" "environment"

for tool in git node npm bash; do
  command -v "$tool" >/dev/null 2>&1 || degrade "missing-tool" "preflight" "$tool not executable"
done
[ -f package.json ] && [ -f package-lock.json ] && [ -f vitest.config.ts ] || degrade "repository-root" "preflight" "run from the repository root"
[ -z "$(git rev-parse --show-prefix 2>/dev/null)" ] || degrade "repository-root" "preflight" "current directory is not the repository root"

HEAD="$(git rev-parse HEAD 2>/dev/null)" || degrade "head-unreadable" "checkout" "git rev-parse HEAD failed"
[ "$HEAD" = "$CORE_HEAD_SHA" ] || degrade "wrong-head" "checkout" "HEAD=$HEAD expected=$CORE_HEAD_SHA"
git cat-file -e "$CORE_HEAD_SHA^{commit}" 2>/dev/null || degrade "wrong-head" "checkout" "CORE_HEAD_SHA is not a commit"

case "$EVENT" in
  pull-request)
    require_value "GITHUB_BASE_REF" "missing-base-env" "base"
    [ -n "$BASE" ] || degrade "missing-base" "base" "pull-request requires --base"
    git rev-parse --verify "origin/$GITHUB_BASE_REF^{commit}" >/dev/null 2>&1 || degrade "bad-base" "base" "origin/$GITHUB_BASE_REF is unavailable"
    RESOLVED_BASE="$(git merge-base "origin/$GITHUB_BASE_REF" HEAD 2>/dev/null)" || degrade "bad-base" "base" "merge-base failed"
    [ "$RESOLVED_BASE" = "$BASE" ] || degrade "bad-base" "base" "provided base=$BASE resolved=$RESOLVED_BASE"
    ;;
  push)
    require_value "CORE_EVENT_BEFORE" "missing-base-env" "base"
    [ -n "$BASE" ] || degrade "missing-base" "base" "push requires --base"
    printf '%s' "$CORE_EVENT_BEFORE" | grep -qE '^[0-9a-fA-F]{40}$' || degrade "bad-base" "base" "CORE_EVENT_BEFORE is not a full SHA"
    [ "$CORE_EVENT_BEFORE" != "0000000000000000000000000000000000000000" ] || degrade "bad-base" "base" "CORE_EVENT_BEFORE is all zero"
    RESOLVED_BASE="$(git rev-parse --verify "$CORE_EVENT_BEFORE^{commit}" 2>/dev/null)" || degrade "bad-base" "base" "CORE_EVENT_BEFORE is unavailable"
    [ "$RESOLVED_BASE" = "$BASE" ] || degrade "bad-base" "base" "provided base=$BASE before=$RESOLVED_BASE"
    ;;
  manual)
    [ -z "$BASE" ] || degrade "unexpected-base" "base" "manual does not accept --base"
    ;;
esac

if [ "$EVENT" != "manual" ]; then
  BASE="$(git rev-parse --verify "$BASE^{commit}" 2>/dev/null)" || degrade "bad-base" "base" "base commit is unreadable"
  CHANGED_FILES="$(git diff --no-renames --name-only --diff-filter=ACDMRTUXB "$BASE"...HEAD 2>&1)"
  DIFF_RC=$?
  [ "$DIFF_RC" -eq 0 ] || degrade "diff-failed" "base" "$CHANGED_FILES"
  TRUSTED_CHANGES="$(printf '%s\n' "$CHANGED_FILES" | grep -E '(^\.gitea/workflows/core-gates\.yml$|^scripts/ci/core-tests\.sh$|^tests/control-tower/core-tests\.test\.sh$|^tests/control-tower/core-gates-workflow\.test\.sh$|^scripts/check-secrets\.sh$|^scripts/desktop/build-backend\.sh$|^tsconfig\.json$|^tsconfig\..*\.json$|^vitest\.config\.ts$|^tests/contract/|^package\.json$|^package-lock\.json$|^patches/|(^|/)\.npmrc$)' || :)"
  if [ -n "$TRUSTED_CHANGES" ]; then
    printf 'CORE-TRUSTED-INPUT-CHANGED\n%s\n' "$TRUSTED_CHANGES" >&2
    degrade "core-trusted-input-changed" "trusted-input" "core inputs changed in base...HEAD"
  fi
else
  printf 'CORE-TRUSTED-INPUT SKIP reason=manual-no-base\n'
fi

CONTRACT_SOURCES="$(git ls-files 'tests/contract/*.test.ts' 'tests/contract/**/*.test.ts')"
[ -n "$CONTRACT_SOURCES" ] || degrade "no-contract-objects" "preflight" "tests/contract/**/*.test.ts is empty"
printf 'CORE-ENV event=%s HEAD=%s BASE=%s\n' "$EVENT" "$HEAD" "${BASE:-<none>}"
node --version || degrade "missing-tool" "preflight" "node --version failed"
npm --version || degrade "missing-tool" "preflight" "npm --version failed"
printf 'CORE-CONTRACT-OBJECTS count=%s\n' "$(printf '%s\n' "$CONTRACT_SOURCES" | grep -c .)"

if [ "$PREFLIGHT" -eq 1 ]; then
  printf 'CORE-PREFLIGHT RESULT rc=0 event=%s base=%s\n' "$EVENT" "${BASE:-<none>}"
  exit 0
fi

VITEST="node_modules/.bin/vitest"
[ -f "$VITEST" ] && [ -x "$VITEST" ] || degrade "missing-tool" "installed-preflight" "$VITEST is not executable; npx download is forbidden"
[ -n "${RUNNER_TEMP:-}" ] || degrade "missing-runner-temp" "environment" "RUNNER_TEMP missing"
command -v mktemp >/dev/null 2>&1 || degrade "missing-tool" "installed-preflight" "mktemp not executable"
TMP="$(mktemp -d "$RUNNER_TEMP/core-tests.XXXXXX")" || degrade "temp-workspace" "installed-preflight" "mktemp failed"
trap 'rm -rf "$TMP"' EXIT

CONFIG_URL="$(node -e "console.log(require('node:url').pathToFileURL(process.argv[1]).href)" "$PWD/vitest.config.ts")"
SETUP="$TMP/assertions.mjs"
CONFIG="$TMP/vitest.config.mts"
cat > "$SETUP" <<'SETUP_EOF'
let assertionCallsBefore = -1;
const assertionState = () => {
  const state = globalThis.expect?.getState?.();
  if (!state || typeof state.assertionCalls !== 'number') {
    throw new Error('CORE_ASSERTION_API_UNAVAILABLE');
  }
  return state;
};
globalThis.beforeEach(() => {
  assertionCallsBefore = assertionState().assertionCalls;
});
globalThis.afterEach((context) => {
  const after = assertionState().assertionCalls;
  if (after <= assertionCallsBefore) {
    const name = context?.task?.name || '<unknown>';
    console.error(`CORE_ZERO_ASSERTIONS ${name}`);
    throw new Error(`CORE_ZERO_ASSERTIONS ${name}`);
  }
});
SETUP_EOF
cat > "$CONFIG" <<CONFIG_EOF
import baseConfig from '$CONFIG_URL';
export default async (env) => {
  const base = typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
  const test = base.test || {};
  const setupFiles = test.setupFiles || [];
  return {
    ...base,
    root: process.env.CORE_TEST_ROOT,
    test: {
      ...test,
      setupFiles: [...setupFiles, process.env.CORE_ASSERT_SETUP],
    },
  };
};
CONFIG_EOF
export CORE_TEST_ROOT="$PWD"
export CORE_ASSERT_SETUP="$SETUP"
export NO_COLOR=1

parse_results() {
  node - "$1" <<'NODE_EOF'
const fs = require('node:fs');
const file = process.argv[2];
try {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  const names = ['numTotalTests', 'numPassedTests', 'numPendingTests', 'numTodoTests', 'numFailedTests', 'numTotalTestSuites'];
  for (const name of names) {
    if (!Number.isInteger(value[name]) || value[name] < 0) throw new Error(`invalid ${name}`);
  }
  if (!Array.isArray(value.testResults) || value.testResults.length === 0 || value.numTotalTestSuites === 0) {
    throw new Error('no executed test suites in JSON');
  }
  const total = value.numPassedTests + value.numPendingTests + value.numTodoTests + value.numFailedTests;
  if (total !== value.numTotalTests) throw new Error(`contradictory totals ${total} != ${value.numTotalTests}`);
  console.log(`${value.numTotalTests} ${value.numPassedTests} ${value.numPendingTests + value.numTodoTests} ${value.numFailedTests} ${value.numTotalTestSuites}`);
} catch (error) {
  console.error(`cannot parse Vitest JSON: ${error.message}`);
  process.exit(2);
}
NODE_EOF
}

printf 'CORE-TESTS RUN contract command=%s run tests/contract/ --reporter=default --reporter=json\n' "$VITEST"
set +e
CONTRACT_OUT="$(CI=1 "$VITEST" run tests/contract/ --config "$CONFIG" --reporter=default --reporter=json --outputFile.json="$TMP/contract.json" 2>&1)"
CONTRACT_RC=$?
set -e
printf '%s\n' "$CONTRACT_OUT"
if printf '%s\n' "$CONTRACT_OUT" | grep -q 'CORE_ASSERTION_API_UNAVAILABLE'; then
  degrade "assertion-api-unavailable" "contract" "expect.getState().assertionCalls is unavailable"
fi
[ -f "$TMP/contract.json" ] || degrade "contract-json-missing" "contract" "JSON reporter produced no file"
CONTRACT_STATS="$(parse_results "$TMP/contract.json")" || degrade "contract-json-invalid" "contract" "$CONTRACT_STATS"
read -r CONTRACT_TOTAL CONTRACT_PASSED CONTRACT_SKIPPED CONTRACT_FAILED CONTRACT_SUITES <<< "$CONTRACT_STATS"
printf 'CORE-CONTRACT-COUNTS total=%s passed=%s skipped=%s failed=%s suites=%s\n' \
  "$CONTRACT_TOTAL" "$CONTRACT_PASSED" "$CONTRACT_SKIPPED" "$CONTRACT_FAILED" "$CONTRACT_SUITES"
if printf '%s\n' "$CONTRACT_OUT" | grep -q 'CORE_ZERO_ASSERTIONS'; then
  fail_test "contract contains executed tests without runtime assertions" "contract-zero-assertions"
fi
if [ "$CONTRACT_RC" -ne 0 ]; then
  [ "$CONTRACT_FAILED" -gt 0 ] || degrade "contract-result-invalid" "contract" "Vitest rc=$CONTRACT_RC without failed tests"
  fail_test "contract tests failed rc=$CONTRACT_RC" "contract-failed"
fi
[ "$CONTRACT_FAILED" -eq 0 ] || degrade "contract-result-invalid" "contract" "rc=0 with failed tests"
[ "$CONTRACT_TOTAL" -gt 0 ] && [ "$CONTRACT_PASSED" -gt 0 ] || degrade "contract-no-passed-tests" "contract" "total=$CONTRACT_TOTAL passed=$CONTRACT_PASSED skipped=$CONTRACT_SKIPPED"

if [ "$EVENT" = "manual" ]; then
  AFFECTED="skipped"
  AFFECTED_PASSED=0
  printf 'CORE-TESTS SKIP affected reason=manual-no-base\n'
  result 0 "manual-no-base"
  exit 0
fi

printf '%s\n' "$CHANGED_FILES" > "$TMP/changed-files.txt"
set +e
COLLECTION_OUT="$(CI=1 "$VITEST" list --config "$CONFIG" --json="$TMP/collection.json" --filesOnly 2>&1)"
COLLECTION_RC=$?
set -e
printf '%s\n' "$COLLECTION_OUT"
[ "$COLLECTION_RC" -eq 0 ] || degrade "collection-failed" "collection" "Vitest list rc=$COLLECTION_RC"
[ -f "$TMP/collection.json" ] || degrade "collection-json-missing" "collection" "Vitest list produced no JSON"
CLASSIFICATION="$(node - "$TMP/collection.json" "$TMP/changed-files.txt" "$PWD" <<'NODE_EOF'
const fs = require('node:fs');
const path = require('node:path');
const [collectionFile, changedFile, root] = process.argv.slice(2);
try {
  const collection = JSON.parse(fs.readFileSync(collectionFile, 'utf8'));
  if (!Array.isArray(collection) || collection.length === 0) throw new Error('empty collection');
  const collectible = new Set(collection.map((entry) => {
    if (!entry || typeof entry.file !== 'string') throw new Error('invalid collection entry');
    return path.relative(root, entry.file).replaceAll(path.sep, '/');
  }));
  const changed = fs.readFileSync(changedFile, 'utf8').split(/\r?\n/).filter(Boolean);
  let sourceChanges = 0;
  let collectibleTestChanges = 0;
  let excludedTestChanges = 0;
  for (const file of changed) {
    const testChange = /^tests\/.*\.(?:test|spec)\.tsx?$/.test(file) || /^tests\/.*\.integration\.test\.tsx?$/.test(file);
    const sourceChange = /^(?:src|packages|scripts)\/.*\.tsx?$/.test(file) || /^(?:app|electron|electron-renderer)\/.*\.(?:[cm]?js|tsx?)$/.test(file) || /^[^/]+\.(?:[cm]?js|ts)$/.test(file) || /^(?:package\.json|package-lock\.json|tsconfig\.json|tsconfig\..*\.json|vitest\.config\.ts)$/.test(file);
    if (testChange) {
      if (fs.existsSync(path.join(root, file)) && !collectible.has(file)) excludedTestChanges += 1;
      else collectibleTestChanges += 1;
    } else if (sourceChange) {
      sourceChanges += 1;
    }
  }
  console.log(`CORE-COLLECTION count=${collectible.size} source_changes=${sourceChanges} collectible_test_changes=${collectibleTestChanges} excluded_test_changes=${excludedTestChanges}`);
  if (sourceChanges > 0 || collectibleTestChanges > 0) console.log('run');
  else if (excludedTestChanges > 0) console.log('ci-excluded-only');
  else console.log('no-relevant-change');
} catch (error) {
  console.error(`cannot parse collection: ${error.message}`);
  process.exit(2);
}
NODE_EOF
)" || degrade "collection-json-invalid" "collection" "$CLASSIFICATION"
printf '%s\n' "$CLASSIFICATION" | sed '$d'
DECISION="$(printf '%s\n' "$CLASSIFICATION" | tail -1)"
case "$DECISION" in
  no-relevant-change)
    AFFECTED="skipped"
    printf 'CORE-TESTS SKIP affected reason=no-relevant-change\n'
    result 0 "no-relevant-change"
    exit 0 ;;
  ci-excluded-only)
    AFFECTED="skipped"
    printf 'CORE-TESTS SKIP affected reason=ci-excluded-only\n'
    result 0 "ci-excluded-only"
    exit 0 ;;
  run) ;;
  *) degrade "collection-json-invalid" "collection" "unknown decision $DECISION" ;;
esac

printf 'CORE-TESTS RUN affected command=%s run --changed %s\n' "$VITEST" "$BASE"
set +e
AFFECTED_OUT="$(CI=1 "$VITEST" run --changed "$BASE" --config "$CONFIG" --reporter=default --reporter=json --outputFile.json="$TMP/affected.json" 2>&1)"
AFFECTED_RC=$?
set -e
printf '%s\n' "$AFFECTED_OUT"
AFFECTED="ran"
if printf '%s\n' "$AFFECTED_OUT" | grep -q 'CORE_ASSERTION_API_UNAVAILABLE'; then
  degrade "assertion-api-unavailable" "affected" "expect.getState().assertionCalls is unavailable"
fi
if printf '%s\n' "$AFFECTED_OUT" | grep -q 'No test files found'; then
  fail_test "relevant changes produced no affected test files" "affected-no-tests"
fi
[ -f "$TMP/affected.json" ] || degrade "affected-json-missing" "affected" "JSON reporter produced no file"
AFFECTED_STATS="$(parse_results "$TMP/affected.json")" || degrade "affected-json-invalid" "affected" "$AFFECTED_STATS"
read -r AFFECTED_TOTAL AFFECTED_PASSED AFFECTED_SKIPPED AFFECTED_FAILED AFFECTED_SUITES <<< "$AFFECTED_STATS"
printf 'CORE-AFFECTED-COUNTS total=%s passed=%s skipped=%s failed=%s suites=%s\n' \
  "$AFFECTED_TOTAL" "$AFFECTED_PASSED" "$AFFECTED_SKIPPED" "$AFFECTED_FAILED" "$AFFECTED_SUITES"
if printf '%s\n' "$AFFECTED_OUT" | grep -q 'CORE_ZERO_ASSERTIONS'; then
  fail_test "affected tests contain executed tests without runtime assertions" "affected-zero-assertions"
fi
if [ "$AFFECTED_RC" -ne 0 ]; then
  [ "$AFFECTED_FAILED" -gt 0 ] || fail_test "relevant changes produced no executable affected tests rc=$AFFECTED_RC" "affected-no-tests"
  fail_test "affected tests failed rc=$AFFECTED_RC" "affected-failed"
fi
[ "$AFFECTED_FAILED" -eq 0 ] || degrade "affected-result-invalid" "affected" "rc=0 with failed tests"
[ "$AFFECTED_TOTAL" -gt 0 ] && [ "$AFFECTED_PASSED" -gt 0 ] || fail_test "relevant changes produced zero passed affected tests total=$AFFECTED_TOTAL skipped=$AFFECTED_SKIPPED" "affected-no-passed-tests"
result 0 "affected-passed"
exit 0
