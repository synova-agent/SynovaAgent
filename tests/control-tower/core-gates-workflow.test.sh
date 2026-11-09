#!/usr/bin/env bash
# @input .gitea/workflows/core-gates.yml 与真实本地 Git/Node 工具；测试仅在临时目录执行抽取的 step。
# @output 逐步骤原始日志、rc、token 脱敏和 degraded JSON 断言。
# @exit 0=全部场景通过；1=工作流行为或反例失败；2=harness 环境不可用。
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WF="$REPO/.gitea/workflows/core-gates.yml"
PASS=0
FAIL=0
FAILED_NAMES=""
ok() { printf 'PASS %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf 'FAIL %s\n' "$1"; FAIL=$((FAIL + 1)); FAILED_NAMES="$FAILED_NAMES$1; "; }
harness_degrade() {
  printf 'cannot judge: core-gates-workflow-harness: %s\n' "$1" >&2
  if [ -n "${SYNO_GATE_DEGRADED_LOG:-}" ]; then
    mkdir -p "$(dirname "$SYNO_GATE_DEGRADED_LOG")"
    printf '{"time":"%s","component":"core-gates-workflow-harness","code":"harness-environment","phase":"setup","retryable":false}\n' \
      "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >> "$SYNO_GATE_DEGRADED_LOG"
  fi
  exit 2
}
for tool in git node python3 bash mktemp; do command -v "$tool" >/dev/null 2>&1 || harness_degrade "$tool missing"; done
[ -f "$WF" ] || harness_degrade "$WF missing"
[ -x "$REPO/node_modules/.bin/vitest" ] || harness_degrade "installed toolchain missing; run npm ci first"
TMP="$(mktemp -d)" || harness_degrade "mktemp failed"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/steps"

validate_workflow() {
  python3 - "$1" <<'PY'
import sys
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
required=['name: core-gates','  core:','runs-on: win-ci','timeout-minutes: 15','contents: read','pull_request:','push:','workflow_dispatch:','if: always()','CORE-WORKFLOW-MARKER=T1-r4-base']
missing=[x for x in required if x not in s]
forbidden=['continue-on-error','scripts/pre-commit-check.sh','/Users/wane','|| true','FETCH_HEAD fallback']
# The final phrase is allowed only in the explicit no-fallback diagnostic.
body=s.replace('unavailable; no FETCH_HEAD fallback','')
forbidden=forbidden[:-1]+(['FETCH_HEAD'] if 'FETCH_HEAD' in body else [])
bad=[x for x in forbidden if x and x in s]
if missing or bad:
    print(f'missing={missing} forbidden={bad}')
    sys.exit(1)
PY
}

printf '=== core-gates workflow paired harness ===\n'
if validate_workflow "$WF"; then ok "workflow identity permissions triggers and boundaries"; else no "workflow static contract"; fi
cp "$WF" "$TMP/bad.yml"
printf '\n      continue-on-error: true\n' >> "$TMP/bad.yml"
if validate_workflow "$TMP/bad.yml" >/dev/null 2>&1; then no "constant-green workflow mutation rejected"; else ok "constant-green workflow mutation rejected"; fi

python3 - "$WF" "$TMP/steps" <<'PY'
import os,sys
wf,out=sys.argv[1:]
names={
'工作区（独立临时树与 askpass）':'checkout',
'事件映射与安装前受信预检':'event',
'依赖（npm ci）':'deps',
'安装后工具链核验':'postinstall',
'类型':'lint',
'构建':'build',
'Secrets':'secrets',
'实际核心测试':'actual',
'清理（凭据与临时工作区 · always）':'cleanup',
}
lines=open(wf,encoding='utf-8').read().splitlines()
for title,slug in names.items():
    marker='      - name: '+title
    try: start=lines.index(marker)
    except ValueError: raise SystemExit('missing step '+title)
    try: run=next(i for i in range(start+1,len(lines)) if lines[i]=='        run: |')
    except StopIteration: raise SystemExit('missing run '+title)
    body=[]
    for line in lines[run+1:]:
        if line.startswith('      - name: '): break
        if line and not line.startswith('          '): break
        body.append(line[10:] if line else '')
    path=os.path.join(out,slug+'.sh')
    open(path,'w',encoding='utf-8',newline='\n').write('\n'.join(body)+'\n')
    if not body: raise SystemExit('empty step '+title)
PY
[ $? -eq 0 ] || harness_degrade "step extraction failed"
for script in "$TMP/steps"/*.sh; do bash -n "$script" || harness_degrade "syntax invalid: $script"; done
ok "all workflow run blocks extracted and syntax checked"

check_degraded() {
  python3 - "$1" "$2" <<'PY'
import json,sys
lines=open(sys.argv[1],encoding='utf-8').read().splitlines()
assert len(lines)==1,lines
v=json.loads(lines[0])
assert set(v)=={'time','component','code','phase','retryable'},v
assert v['component']==sys.argv[2],v
PY
}

ORIGIN="$TMP/origin"
mkdir -p "$ORIGIN/scripts/ci" "$ORIGIN/tests/contract"
git -C "$ORIGIN" init -q -b main
git -C "$ORIGIN" config user.name 'Workflow Fixture'
git -C "$ORIGIN" config user.email 'workflow@example.invalid'
cp "$REPO/scripts/ci/core-tests.sh" "$ORIGIN/scripts/ci/core-tests.sh"
cp "$REPO/package.json" "$REPO/package-lock.json" "$REPO/vitest.config.ts" "$ORIGIN/"
printf "import { expect, test } from 'vitest';\ntest('contract', () => { expect(['contract']).toContain('contract'); });\n" > "$ORIGIN/tests/contract/basic.test.ts"
printf 'node_modules/\n' > "$ORIGIN/.gitignore"
git -C "$ORIGIN" add -A
git -C "$ORIGIN" commit -q -m 'fixture base'
ORIGIN_HEAD="$(git -C "$ORIGIN" rev-parse HEAD)"
FAKE_TOKEN='FAKE_CORE_GATE_TOKEN_NOT_A_SECRET'
CHECKOUT_TMP="$TMP/checkout"
mkdir -p "$CHECKOUT_TMP"
CHECKOUT_ENV="$TMP/checkout.env"
: > "$CHECKOUT_ENV"
set +e
OUT="$(env RUNNER_TEMP="$CHECKOUT_TMP" GITHUB_ENV="$CHECKOUT_ENV" CORE_HEAD_SHA="$ORIGIN_HEAD" \
  CORE_EVENT_BEFORE='' CORE_REPOSITORY_URL="$ORIGIN" CORE_GITEA_TOKEN="$FAKE_TOKEN" \
  bash -e "$TMP/steps/checkout.sh" 2>&1)"
RC=$?
set -e
printf '\n--- checkout normal ---\n%s\n' "$OUT"
# shellcheck disable=SC1090
. "$CHECKOUT_ENV"
if [ "$RC" -eq 0 ] && [ "$(git -C "$CORE_WORKSPACE" rev-parse HEAD)" = "$ORIGIN_HEAD" ] && \
   ! grep -q "$FAKE_TOKEN" "$CORE_WORKSPACE/.git/config" && ! printf '%s\n' "$OUT" | grep -q "$FAKE_TOKEN" && \
   [ -x "$CORE_ASKPASS" ]; then ok "checkout real SHA and token not persisted"; else no "checkout real SHA and token not persisted"; fi

EVENT_ENV="$TMP/event.env"
: > "$EVENT_ENV"
set +e
EVENT_OUT="$(env RUNNER_TEMP="$CHECKOUT_TMP" GITHUB_ENV="$EVENT_ENV" CORE_WORKSPACE="$CORE_WORKSPACE" \
  CORE_HEAD_SHA="$ORIGIN_HEAD" CORE_EVENT_BEFORE='' CI=1 GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=main \
  bash -e "$TMP/steps/event.sh" 2>&1)"
EVENT_RC=$?
set -e
printf '\n--- pull_request preflight ---\n%s\n' "$EVENT_OUT"
if [ "$EVENT_RC" -eq 0 ] && grep -q '^CORE_EVENT=pull-request$' "$EVENT_ENV" && grep -q "^CORE_BASE=$ORIGIN_HEAD$" "$EVENT_ENV"; then
  ok "pull_request event resolves merge-base and preflight"
else
  no "pull_request event resolves merge-base and preflight"
fi

for kind in unknown missing-before; do
  EVENT_CASE_TMP="$TMP/event-$kind"; mkdir -p "$EVENT_CASE_TMP"
  EVENT_NAME='unexpected'; BEFORE=''
  [ "$kind" = missing-before ] && EVENT_NAME='push'
  set +e
  CASE_OUT="$(env RUNNER_TEMP="$EVENT_CASE_TMP" GITHUB_ENV="$TMP/$kind.env" CORE_WORKSPACE="$CORE_WORKSPACE" \
    CORE_HEAD_SHA="$ORIGIN_HEAD" CORE_EVENT_BEFORE="$BEFORE" CI=1 GITHUB_EVENT_NAME="$EVENT_NAME" GITHUB_BASE_REF=main \
    bash -e "$TMP/steps/event.sh" 2>&1)"
  CASE_RC=$?
  set -e
  printf '\n--- event %s ---\n%s\n' "$kind" "$CASE_OUT"
  if [ "$CASE_RC" -eq 2 ] && check_degraded "$EVENT_CASE_TMP/core-gates-degraded.jsonl" core-gates-event; then
    ok "event failure $kind is cannot judge with JSON"
  else
    no "event failure $kind"
  fi
done

set +e
CLEAN_OUT="$(env RUNNER_TEMP="$CHECKOUT_TMP" CORE_WORKSPACE="$CORE_WORKSPACE" CORE_ASKPASS="$CORE_ASKPASS" bash -e "$TMP/steps/cleanup.sh" 2>&1)"
CLEAN_RC=$?
set -e
if [ "$CLEAN_RC" -eq 0 ] && [ ! -e "$CORE_WORKSPACE" ] && [ ! -e "$CORE_ASKPASS" ]; then ok "always cleanup removes workspace and askpass"; else no "always cleanup"; fi

WRONG_TMP="$TMP/wrong-head"; mkdir -p "$WRONG_TMP"
set +e
WRONG_OUT="$(env RUNNER_TEMP="$WRONG_TMP" GITHUB_ENV="$TMP/wrong.env" \
  CORE_HEAD_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb CORE_EVENT_BEFORE='' CORE_REPOSITORY_URL="$ORIGIN" \
  CORE_GITEA_TOKEN="$FAKE_TOKEN" bash -e "$TMP/steps/checkout.sh" 2>&1)"
WRONG_RC=$?
set -e
printf '\n--- wrong HEAD checkout ---\n%s\n' "$WRONG_OUT"
if [ "$WRONG_RC" -eq 2 ] && ! printf '%s\n' "$WRONG_OUT" | grep -q "$FAKE_TOKEN" && \
   check_degraded "$WRONG_TMP/core-gates-degraded.jsonl" core-gates-checkout; then
  ok "wrong HEAD fails closed and failure log redacts token"
else
  no "wrong HEAD and token redaction"
fi
# Clean the failed checkout without relying on its partially written env.
rm -rf "$WRONG_TMP/core-gates-workspace" "$WRONG_TMP/core-gates-askpass.sh"

POST_TMP="$TMP/postinstall"; mkdir -p "$POST_TMP"
set +e
POST_OUT="$(env RUNNER_TEMP="$POST_TMP" CORE_WORKSPACE="$REPO" bash -e "$TMP/steps/postinstall.sh" 2>&1)"
POST_RC=$?
set -e
printf '\n--- real installed toolchain ---\n%s\n' "$POST_OUT"
if [ "$POST_RC" -eq 0 ] && printf '%s\n' "$POST_OUT" | grep -q 'CORE-TOOL-VERSION vitest=5.0.2'; then
  ok "real installed tools exactly match package-lock"
else
  no "real installed tools exactly match package-lock"
fi

STUB_BIN="$TMP/stub-bin"; mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${STUB_OUTPUT:-}"
if [ "$1" = ci ]; then exit "${STUB_RC:-0}"; fi
if [ "$1 $2" = 'run build' ] && [ "${STUB_MAKE_ARTIFACT:-0}" = 1 ]; then mkdir -p dist; printf 'fixture\n' > dist/backend.mjs; fi
exit "${STUB_RC:-0}"
EOF
chmod +x "$STUB_BIN/npm"

run_stub() {
  local name="$1" script="$2" expected_rc="$3" expected_text="$4" output="$5" rc="$6" artifact="${7:-0}"
  WS="$TMP/ws-$name"; CASE_TMP="$TMP/case-$name"; mkdir -p "$WS" "$CASE_TMP"
  set +e
  STUB_OUT="$(env PATH="$STUB_BIN:$PATH" RUNNER_TEMP="$CASE_TMP" CORE_WORKSPACE="$WS" \
    STUB_OUTPUT="$output" STUB_RC="$rc" STUB_MAKE_ARTIFACT="$artifact" bash -e "$TMP/steps/$script.sh" 2>&1)"
  STUB_RC_ACTUAL=$?
  set -e
  printf '\n--- %s ---\n%s\n' "$name" "$STUB_OUT"
  if [ "$STUB_RC_ACTUAL" -ne "$expected_rc" ] || ! printf '%s\n' "$STUB_OUT" | grep -q "$expected_text"; then
    no "$name rc/raw output"
    return
  fi
  if [ "$expected_rc" -eq 2 ]; then
    local component
    case "$script" in deps) component=core-gates-dependencies ;; secrets) component=core-gates-secrets ;; *) component=core-gates-toolchain ;; esac
    check_degraded "$CASE_TMP/core-gates-degraded.jsonl" "$component" || { no "$name degraded JSON"; return; }
  elif [ -s "$CASE_TMP/core-gates-degraded.jsonl" ]; then
    no "$name unexpected degraded log"
    return
  fi
  ok "$name"
}

run_stub dependency-failure deps 2 'DELIBERATE_NPM_CI_FAILURE' 'DELIBERATE_NPM_CI_FAILURE' 26
run_stub lint-failure lint 1 'src/probe.ts(1,1): error TS9999' 'src/probe.ts(1,1): error TS9999: deliberate' 2
run_stub build-command-failure build 1 'DELIBERATE_BUILD_FAILURE' 'DELIBERATE_BUILD_FAILURE' 17
run_stub build-artifact-missing build 1 'build artifact missing' '' 0
run_stub build-normal build 0 'dist/backend.mjs' '' 0 1
run_stub secrets-violation secrets 1 'DELIBERATE_SECRET_MATCH' 'DELIBERATE_SECRET_MATCH' 1
run_stub secrets-cannot-judge secrets 2 'DELIBERATE_SECRETS_CANNOT_JUDGE' 'DELIBERATE_SECRETS_CANNOT_JUDGE' 2

RAW_WS="$TMP/ws-raw"; RAW_TMP="$TMP/raw"; mkdir -p "$RAW_WS/scripts/ci" "$RAW_TMP"
cat > "$RAW_WS/scripts/ci/core-tests.sh" <<'EOF'
#!/usr/bin/env bash
printf 'FAIL tests/gate-probes/example.test.ts\nAssertionError: expected actual-value to be expected-value\n'
exit 1
EOF
set +e
RAW_OUT="$(env RUNNER_TEMP="$RAW_TMP" CORE_WORKSPACE="$RAW_WS" CORE_EVENT=manual CORE_BASE='' bash -e "$TMP/steps/actual.sh" 2>&1)"
RAW_RC=$?
set -e
printf '\n--- bash -e raw test failure ---\n%s\n' "$RAW_OUT"
if [ "$RAW_RC" -eq 1 ] && printf '%s\n' "$RAW_OUT" | grep -q 'AssertionError: expected actual-value to be expected-value'; then
  ok "bash -e preserves original test file and assertion"
else
  no "bash -e raw failure preservation"
fi

printf '\nCORE-GATES-WORKFLOW-HARNESS RESULT pass=%s fail=%s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then printf 'FAILED: %s\n' "$FAILED_NAMES"; exit 1; fi
exit 0
