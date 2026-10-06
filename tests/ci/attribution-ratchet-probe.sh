#!/usr/bin/env bash
# tests/ci/attribution-ratchet-probe.sh
#
# V7（#1032）判据：**归因外失败 ⇒ CI 必红**（归因外放行只允许"台账登记 + 未过期"）。
#
# 背景（S5 尽调 §10 + 本卡实测）：
#   `.github/workflows/ci.yml` 的 `Run tests` step 在 vitest 失败后，只把"能归因到本 PR 改动集"的
#   失败算作阻断；**归因不到任何改动文件**的失败一律 `::warning::` + `exit 0` 放行
#   ⇒ 存量红只增不减，铁律 36（零失败才合并）在 CI 的 PR 面不成立。
#   另有两条结构性缺陷（本探针用场景固定住）：
#     · 失败清单用 `grep -oP 'tests/\S+\.test\.ts'` 提取 ⇒ **路径不含 "tests/" 子串的失败被整条丢掉**
#       （`extensions/**`、`scripts/**`…），而 `packages/x/tests/**` 会被**截断前缀**造成错归因。
#     · PR 面（CHANGED 非空）与 main push 面（CHANGED 为空）行为不同 —— 两者都必须在判据里固定。
#
# 本探针做什么：
#   1. **逐字提取** `.github/workflows/ci.yml` 里 `Run tests` step 的 `run:` 正文（唯一真值源；
#      不重写判据逻辑 ⇒ 不做"判据的影子实现"）。换 ci.yml 只要换 `--ci-yml`。
#   2. 在 **scratch 仓**里构造受控的 `CHANGED`（三点差 origin/main...HEAD），可切 PR / main-push 两种姿态。
#   3. 用 PATH 上的 `npx` shim 喂入**受控的 vitest 失败输出**（真实 vitest 无法按场景造失败集合）。
#   4. 跑「提取出来的真实 step 正文」，读它的 **exit code**，对照 V7 要求判红/绿。
#
# 🔴 环境归一（**显式声明，不静默**；两者都是"还原 CI 真值"，不是改判据）：
#   ① `${{ matrix.shard }}` → `1/2`：GitHub 表达式在 bash 里非法，必须展开。
#   ② `grep -oP` → 本机无 GNU grep（BSD grep 2.6.0 无 -P）⇒ shim 用 python3 实现 `-oP` 语义。
#      这是**平台能力补足**；CI 上跑的是真 GNU grep。
#
# 退出码（判例 M-02 三态）：
#   0 = 全部必备语义成立（判据绿：修好之后应得 0）
#   1 = 有必备语义被违反（判据红 —— 在**未修复**的 ci.yml 上**应当**得 1）
#   2 = 探针自身失败（提取不到 step 正文 / 环境缺失 / scratch 仓构造失败）
#
# 用法：
#   bash tests/ci/attribution-ratchet-probe.sh                                # 跑仓内 ci.yml
#   bash tests/ci/attribution-ratchet-probe.sh --ci-yml /tmp/patched-ci.yml    # 跑打补丁的副本
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
STEP_NAME="Run tests"
LEDGER_REL="scripts/control-tower/vitest-red-exempt.txt"
KEEP=0
VERBOSE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --ci-yml) CI_YML="$2"; shift 2 ;;
    --step)   STEP_NAME="$2"; shift 2 ;;
    --keep)   KEEP=1; shift ;;
    --verbose) VERBOSE=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

note() { printf '[probe] %s\n' "$*"; }
die()  { printf '[probe][FATAL] %s\n' "$*" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/v7-probe.XXXXXX")"
cleanup() { [ "$KEEP" = "1" ] || rm -rf "$WORK"; }
trap cleanup EXIT

[ -f "$CI_YML" ] || die "ci.yml 不存在: $CI_YML"
command -v python3 >/dev/null 2>&1 || die "缺 python3（提取 step 正文 + 实现 grep -oP）"
command -v git >/dev/null 2>&1 || die "缺 git"

note "ci.yml = $CI_YML"
note "step   = $STEP_NAME (逐字提取)"
note "work   = $WORK"

# ── 1. 逐字提取 step 的 run: 正文 ────────────────────────────────────────────────
python3 - "$CI_YML" "$STEP_NAME" > "$WORK/step.raw" <<'PY'
import sys, re
yml, want = sys.argv[1], sys.argv[2]
lines = open(yml, encoding='utf-8').read().split('\n')
start = None
for i, ln in enumerate(lines):
    m = re.match(r'^(\s*)-\s+name:\s*(.*?)\s*$', ln)
    if m and m.group(2) == want:
        start = i
        break
if start is None:
    sys.stderr.write('step not found: %r\n' % want); sys.exit(2)
run_i = indent = None
for j in range(start + 1, len(lines)):
    if re.match(r'^\s*-\s+name:', lines[j]):
        break
    m = re.match(r'^(\s*)run:\s*\|\s*$', lines[j])
    if m:
        run_i, indent = j, len(m.group(1)); break
if run_i is None:
    sys.stderr.write('run: | block not found under step %r\n' % want); sys.exit(2)
body = []
for k in range(run_i + 1, len(lines)):
    ln = lines[k]
    if ln.strip() == '':
        body.append(''); continue
    cur = len(ln) - len(ln.lstrip())
    if cur <= indent:
        break
    body.append(ln[indent + 2:] if len(ln) >= indent + 2 else ln.strip())
sys.stdout.write('\n'.join(body).rstrip('\n') + '\n')
PY
[ $? -eq 0 ] || die "提取 step 正文失败"
[ -s "$WORK/step.raw" ] || die "提取到的 step 正文为空"
note "extracted step body: $(wc -l < "$WORK/step.raw" | tr -d ' ') lines"

# ── 2. 环境归一 ①：展开 GitHub 表达式 ───────────────────────────────────────────
sed 's|\${{ matrix\.shard }}|1/2|g' "$WORK/step.raw" > "$WORK/step.sh"
grep -q '\${{' "$WORK/step.sh" && note "WARN: step 正文仍有未展开的 \${{ ... }}，执行可能失败"

# ── 3. 环境归一 ②：grep shim（补 -oP）+ npx shim（喂受控输出）───────────────────
mkdir -p "$WORK/shim"
cat > "$WORK/shim/grep" <<'SH'
#!/usr/bin/env bash
# 只拦 `-oP`（本机 BSD grep 无 -P），其余全部透传真 grep。
if [ "${1:-}" = "-oP" ]; then
  shift
  exec python3 -c '
import re,sys
pat=sys.argv[1]
data=sys.stdin.read()
hits=[m.group(0) for line in data.split("\n") for m in re.finditer(pat,line)]
if hits: sys.stdout.write("\n".join(hits)+"\n")
sys.exit(0 if hits else 1)
' "$@"
fi
exec /usr/bin/grep "$@"
SH
chmod +x "$WORK/shim/grep"

cat > "$WORK/shim/npx" <<'SH'
#!/usr/bin/env bash
# 喂受控 vitest 输出后以 $CANNED_EXIT 结束（step 里 `echo "EXIT:$?"` 会把它写进 OUTPUT 自解析）。
cat "$CANNED_OUTPUT"
exit "${CANNED_EXIT:-1}"
SH
chmod +x "$WORK/shim/npx"

# ── 4. 场景执行器 ───────────────────────────────────────────────────────────────
#   run_scenario <id> <desc> <required_exit> <posture> <canned_exit> <ledger_body> <canned_output>
#     posture: pr   = HEAD 领先 origin/main 一个 commit（CHANGED 非空 = docs/note.md src/smoke.ts tests/smoke.test.ts）
#              main = HEAD == origin/main（CHANGED 为空，模拟 main push 姿态）
#     ledger_body: 写入 <scratch>/scripts/control-tower/vitest-red-exempt.txt 的内容（可空）
run_scenario() {
  local id="$1" desc="$2" required="$3" posture="$4" vitest_exit="$5" ledger="$6" canned="$7"
  local R="$WORK/repo-$id"
  printf '\n── %s: %s\n' "$id" "$desc"
  printf '   posture=%s  required_exit%s0\n' "$posture" "$([ "$required" = 0 ] && echo '==' || echo '!=')"

  # scratch 仓
  rm -rf "$R"; mkdir -p "$R/src" "$R/tests" "$R/docs" "$R/scripts/control-tower"
  git -C "$R" init -q 2>/dev/null || die "git init 失败 ($id)"
  git -C "$R" -c user.email=p@x -c user.name=p commit -q --allow-empty -m base || die "base commit 失败 ($id)"
  local BASE_SHA; BASE_SHA="$(git -C "$R" rev-parse HEAD)"
  git -C "$R" update-ref refs/remotes/origin/main "$BASE_SHA" || die "update-ref 失败 ($id)"
  printf 'export const smoke = 1;\n' > "$R/src/smoke.ts"
  printf '// smoke\n'              > "$R/tests/smoke.test.ts"
  printf '# doc\n'                 > "$R/docs/note.md"
  git -C "$R" add -A
  git -C "$R" -c user.email=p@x -c user.name=p commit -q -m "feat: touch smoke" || die "head commit 失败 ($id)"
  if [ "$posture" = "main" ]; then
    # HEAD == origin/main ⇒ 三点差为空
    git -C "$R" update-ref refs/remotes/origin/main "$(git -C "$R" rev-parse HEAD)"
  fi
  printf '%s' "$ledger" > "$R/$LEDGER_REL"

  export CANNED_OUTPUT="$WORK/canned-$id.txt" CANNED_EXIT="$vitest_exit"
  printf '%s\n' "$canned" > "$CANNED_OUTPUT"

  ( cd "$R" && PATH="$WORK/shim:$PATH" bash "$WORK/step.sh" ) > "$WORK/out-$id.log" 2>&1
  local rc=$?
  printf '   observed_exit=%s\n' "$rc"
  local ok=0
  if [ "$required" = 0 ]; then [ "$rc" -eq 0 ] || ok=1; else [ "$rc" -ne 0 ] || ok=1; fi
  [ "$ok" = 0 ] && printf '   ✅ 符合必备语义\n' || printf '   ❌ 违反必备语义\n'
  if [ "$VERBOSE" = 1 ]; then sed 's/^/   | /' "$WORK/out-$id.log" | head -14; fi
  return $ok
}

VIOLATED=0; TOTAL=0; VIOLATION_IDS=""
sc() { # sc <id> ... ; 累计
  TOTAL=$((TOTAL+1))
  run_scenario "$@" || { VIOLATED=$((VIOLATED+1)); VIOLATION_IDS="$VIOLATION_IDS $1"; }
}

NOFAIL='Test Files  100 passed (100)
Tests  100 passed (100)'

# ── S0 对照组：无失败 ⇒ 绿 ─────────────────────────────────────────────────────
sc S0 "无失败（对照组）" 0 pr 0 "" "$NOFAIL"

# ── S1 ★核心：PR 面 + 归因外失败（tests/ 内，PR 未改）⇒ 必须红 ──────────────────
sc S1 "PR 面 归因外失败：tests/ 内、PR 未改该文件" 1 pr 1 "" \
' FAIL  tests/l3/graphbridge-wiring.test.ts > GraphBridge > case
AssertionError: expected +0 to be 1
 FAIL  tests/other-unrelated.test.ts > x > y
AssertionError: boom'

# ── S2 ★核心：PR 面 + 归因外失败（路径不含 "tests/" 子串）⇒ 必须红 ──────────────
sc S2 "PR 面 归因外失败：extensions/ 下（路径不含 tests/）" 1 pr 1 "" \
' FAIL  extensions/sentinels/_extinct/capital-turnover/computes/cash-conversion-cycle.test.ts > c > d
AssertionError: expected critical to be warning'

# ── S3 ★核心：PR 面 + 归因外失败（packages/*/tests/，前缀可能被截断）⇒ 必须红 ────
sc S3 "PR 面 归因外失败：packages/test-kit/tests/ 下" 1 pr 1 "" \
' FAIL  packages/test-kit/tests/architecture/01-layer-boundaries.test.ts > a > b
AssertionError: layer violation'

# ── S4 对照组：可归因失败（PR 确实改了 src/smoke.ts）⇒ 必须红 ────────────────────
sc S4 "PR 面 可归因失败（对照组，PR 改了 src/smoke.ts）" 1 pr 1 "" \
' FAIL  tests/smoke.test.ts > smoke > works
AssertionError: boom'

# ── S5 姿态对照：main push（CHANGED 空）+ 归因外失败 ⇒ 必须红 ────────────────────
sc S5 "main push 姿态（CHANGED 空）归因外失败" 1 main 1 "" \
' FAIL  tests/l3/graphbridge-wiring.test.ts > GraphBridge > case
AssertionError: expected +0 to be 1'

# ── S6 ★白名单路径：归因外失败 + 台账登记且**未过期** ⇒ 允许绿 ───────────────────
LEDGER_OK="tests/l3/graphbridge-wiring.test.ts | owner=tester | expires=2099-01-01
"
sc S6 "归因外失败 + 台账未过期 ⇒ 允许放行" 0 pr 1 "$LEDGER_OK" \
' FAIL  tests/l3/graphbridge-wiring.test.ts > GraphBridge > case
AssertionError: expected +0 to be 1'

# ── S7 ★棘轮到期：归因外失败 + 台账**已过期** ⇒ 必须红（判例 M-03）────────────────
LEDGER_EXPIRED="tests/l3/graphbridge-wiring.test.ts | owner=tester | expires=2000-01-01
"
sc S7 "归因外失败 + 台账已过期 ⇒ 必须红（M-03）" 1 pr 1 "$LEDGER_EXPIRED" \
' FAIL  tests/l3/graphbridge-wiring.test.ts > GraphBridge > case
AssertionError: expected +0 to be 1'

printf '\n══ 探针结论 ══\n'
printf '  必备语义: %s/%s 成立；违反 %s\n' "$((TOTAL-VIOLATED))" "$TOTAL" "$VIOLATED"
if [ "$VIOLATED" -eq 0 ]; then
  printf '  ⇒ 判据绿：归因外失败会红（放行只走"台账 + 未过期"这一条路）\n'
  exit 0
fi
printf '  违反项:%s\n' "$VIOLATION_IDS"
printf '  ⇒ 判据红：存在被静默放行的归因外失败（正是 V7 要消灭的形态）\n'
[ "$KEEP" = "1" ] && printf '  （--keep: 中间产物在 %s）\n' "$WORK"
exit 1
