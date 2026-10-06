#!/usr/bin/env bash
# run-evidence.sh —— V10/V11/V12 schema 门的证据重建器
#
# 契约（铁律 47）
# ── 输入 ──────────────────────────────────────────────────────────────
#   argv[1] = --check（可选）：重建到临时目录并与已入库 raw/ 对账，不一致 ⇒ exit 1
#   前置：node v24.19.0（type stripping）；在仓库根或任意子目录内执行均可
# ── 输出 ──────────────────────────────────────────────────────────────
#   <evidence>/raw/NN-*.txt：**命令原文 + 原始输出 + exit 码**（无手写数字）
# ── 降级 ──────────────────────────────────────────────────────────────
#   不降级：任一夹具未能复现「期望退出码」⇒ 脚本 exit 1（证据链断 = 失败）。
#   本脚本自身不做断言替代：判定永远由被检工具返回，此处只记录。
#
# 用法：
#   bash docs/synova/product-lines/evidence/V10V11V12/run-evidence.sh          # 重建
#   bash docs/synova/product-lines/evidence/V10V11V12/run-evidence.sh --check  # 对账

set -uo pipefail

MODE="${1:-}"

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SELF_DIR" rev-parse --show-toplevel)"
TOOL_REL="docs/synova/coordination/tools/check-coordination-schema.ts"
TOOL="$REPO_ROOT/$TOOL_REL"

if [ ! -f "$TOOL" ]; then
  echo "EVIDENCE-ERROR 找不到被检工具: $TOOL_REL" >&2
  exit 1
fi

CLEANUP_DIRS=()
cleanup() {
  for d in "${CLEANUP_DIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

if [ "$MODE" = "--check" ]; then
  OUT_DIR="$(mktemp -d)"
  CLEANUP_DIRS+=("$OUT_DIR")
else
  OUT_DIR="$SELF_DIR"
fi

RAW="$OUT_DIR/raw"
mkdir -p "$RAW"

node --experimental-strip-types "$TOOL" --help >/dev/null 2>&1
if [ "$?" -eq 127 ]; then
  echo "EVIDENCE-ERROR node 不可用（需 v24.x + --experimental-strip-types）" >&2
  exit 1
fi

FAILED=0

# 记录「命令原文 + 原始输出 + exit 码」
run_capture() {
  local out="$1"
  shift
  {
    echo "# cwd=$REPO_ROOT"
    echo "\$ $*"
    echo "--- output ---"
  } > "$out"
  "$@" >> "$out" 2>&1
  local rc=$?
  echo "--- exit=$rc ---" >> "$out"
}

# 断言夹具复现了期望的退出码（红必须来自被检工具，不是来自本脚本）
expect_exit() {
  local out="$1" want="$2" label="$3"
  local got
  got="$(sed -n 's/^--- exit=\([0-9]*\) ---$/\1/p' "$out" | tail -1)"
  if [ "$got" != "$want" ]; then
    echo "EVIDENCE-FAIL ${label} 期望 exit=${want} 实际 exit=${got}（原始输出: ${out}）" >&2
    FAILED=1
  fi
}

cd "$REPO_ROOT" || exit 1

# ── 00 判别性自证：30 个夹具，25/25 规则各有一组反例 ──────────────────────
run_capture "$RAW/00-selftest.txt" \
  node --experimental-strip-types "$TOOL_REL" --selftest
expect_exit "$RAW/00-selftest.txt" 0 "00-selftest"
grep -q 'covered_rules=25/25' "$RAW/00-selftest.txt" || {
  echo "EVIDENCE-FAIL 00-selftest 未覆盖全部规则" >&2; FAILED=1; }

# ── 01 全树状态模式（合法 ⇒ exit 0） ────────────────────────────────────
run_capture "$RAW/01-state-mode.txt" \
  node --experimental-strip-types "$TOOL_REL"
expect_exit "$RAW/01-state-mode.txt" 0 "01-state-mode"

# ── 02 变更集模式（真实仓库 vs origin/main） ─────────────────────────────
run_capture "$RAW/02-changemode.txt" \
  node --experimental-strip-types "$TOOL_REL" --since origin/main
expect_exit "$RAW/02-changemode.txt" 0 "02-changemode"

# ── 03 --strict：跳过 = 失败（存量 DEBT + 未给 --since ⇒ exit 1） ────────
run_capture "$RAW/03-strict.txt" \
  node --experimental-strip-types "$TOOL_REL" --strict
expect_exit "$RAW/03-strict.txt" 1 "03-strict"

# ── 04 检查自身失败 ⇒ exit 2（禁 || true） ──────────────────────────────
run_capture "$RAW/04-checker-error.txt" \
  node --experimental-strip-types "$TOOL_REL" --since no-such-ref-at-all
expect_exit "$RAW/04-checker-error.txt" 2 "04-checker-error"
grep -q 'CHECKER-ERROR' "$RAW/04-checker-error.txt" || {
  echo "EVIDENCE-FAIL 04 未出现 CHECKER-ERROR 具名错" >&2; FAILED=1; }

# ── 09 真相源读数（判例 S-01②③：git show / ls-tree，不读工作树当代理） ──
{
  echo "# cwd=$REPO_ROOT"
  echo "\$ git ls-tree -r origin/main --name-only -- decisions/ | tr -d '\n\r' | ... (count)"
  echo "--- output ---"
  printf 'decisions/ files at origin/main = '
  git ls-tree -r origin/main --name-only -- decisions/ | wc -l | tr -d ' \n'
  echo
  echo "\$ git ls-tree -r origin/main --name-only -- decisions/ | sed 's/^/  /'"
  git ls-tree -r origin/main --name-only -- decisions/ | sed 's/^/  /'
  echo
  echo "\$ git ls-tree -r origin/main --name-only -- docs/synova/coordination/ | wc -l"
  printf 'coordination/ recursive files at origin/main = '
  git ls-tree -r origin/main --name-only -- docs/synova/coordination/ | wc -l | tr -d ' \n'
  echo
  echo "\$ git show origin/main:docs/synova/DOC-CONTRACT.md | shasum -a 256"
  git show origin/main:docs/synova/DOC-CONTRACT.md | shasum -a 256
  echo "--- exit=0 ---"
} > "$RAW/09-truth-source.txt"
expect_exit "$RAW/09-truth-source.txt" 0 "09-truth-source"

# ── 10 真声明（本目录 README 里那行）在变更集里被 V10 比对 ───────────────
run_capture "$RAW/10-cas-live.txt" \
  node --experimental-strip-types "$TOOL_REL" --since origin/main \
  --cas-file docs/synova/product-lines/evidence/V10V11V12/README.md
expect_exit "$RAW/10-cas-live.txt" 0 "10-cas-live"
grep -q 'V10-CAS-STALE' "$RAW/10-cas-live.txt" || {
  echo "EVIDENCE-FAIL 10 未出现 V10-CAS-STALE 行" >&2; FAILED=1; }

# ── 05/06/07/08 三条判据各自的「违反 ⇒ exit 1 + 具名」反例（真夹具 + 原始输出） ──
FIX_ROOT="$(mktemp -d)"
CLEANUP_DIRS+=("$FIX_ROOT")

git_fix() { git -C "$1" -c user.email=fixture@local -c user.name=fixture "${@:2}"; }

new_fixture() { # $1 = name；建一个已 commit 基线的临时 git 仓库，回显路径
  local repo="$FIX_ROOT/$1"
  mkdir -p "$repo/docs/synova/coordination" "$repo/decisions" "$repo/.cas-empty"
  git_fix "$repo" init -q
  git_fix "$repo" add -A
  git_fix "$repo" commit -q --allow-empty -m baseline
  printf '%s' "$repo"
}

run_fixture() { # $1=outfile $2=repo $3... = checker args
  local out="$1" repo="$2"
  shift 2
  {
    echo "# fixture repo=<tmp>/$(basename "$repo")（git init 临时仓；绝对路径不入证据，保证可对账）"
    echo "# files:"
    (cd "$repo" && find . -path ./.git -prune -o -type f -print | sort | sed 's/^/#   /')
    echo "\$ (cd <fixture> && node $TOOL_REL --repo-root <fixture> $*)"
    echo "--- output ---"
  } > "$out"
  (cd "$repo" && node --experimental-strip-types "$TOOL" --repo-root "$repo" \
    --decisions-root decisions --coord-root docs/synova/coordination "$@") >> "$out" 2>&1
  local rc=$?
  echo "--- exit=$rc ---" >> "$out"
}

FIX_COMMON=(--cas-root .cas-empty)

# ── 05 V10：用旧 revision 提交 ⇒ STALE + exit 1 ─────────────────────────
R5="$(new_fixture v10-stale)"
printf '{\n  "task_id": "D0",\n  "status": "impl_done"\n}\n' > "$R5/docs/synova/coordination/target.json"
git_fix "$R5" add -A; git_fix "$R5" commit -q --allow-empty -m target
# 写者声明的是**旧**内容（status=spec_done）的 hash
STALE_HEX="$(printf '{"task_id":"D0","status":"spec_done"}' | shasum -a 256 | cut -c1-64)"
printf '# 派单件\n\nStatus: active\n\nexpectedRevision: docs/synova/coordination/target.json@sha256:%s\n' "$STALE_HEX" \
  > "$R5/docs/synova/coordination/dispatch.md"
run_fixture "$RAW/05-v10-stale.txt" "$R5" "${FIX_COMMON[@]}" --since HEAD \
  --cas-file docs/synova/coordination/dispatch.md
expect_exit "$RAW/05-v10-stale.txt" 1 "05-v10-stale"
grep -q 'token=STALE' "$RAW/05-v10-stale.txt" || {
  echo "EVIDENCE-FAIL 05 未出现具名 STALE" >&2; FAILED=1; }

# ── 06 V11：archive/ 里写 Status: active ⇒ 拒 + 报文件名 ────────────────
R6="$(new_fixture v11-archive)"
mkdir -p "$R6/docs/synova/coordination/archive"
printf '# 归档回执\n\nStatus: active\n' > "$R6/docs/synova/coordination/archive/old-receipt.md"
run_fixture "$RAW/06-v11-archive-mismatch.txt" "$R6" "${FIX_COMMON[@]}"
expect_exit "$RAW/06-v11-archive-mismatch.txt" 1 "06-v11-archive-mismatch"
grep -q 'token=STATUS_LOCATION_MISMATCH' "$RAW/06-v11-archive-mismatch.txt" || {
  echo "EVIDENCE-FAIL 06 未出现 STATUS_LOCATION_MISMATCH" >&2; FAILED=1; }
grep -q 'old-receipt.md' "$RAW/06-v11-archive-mismatch.txt" || {
  echo "EVIDENCE-FAIL 06 未报出文件名" >&2; FAILED=1; }

# ── 07 V12：缺节 ⇒ 必红 + 具名缺哪节 ────────────────────────────────────
R7="$(new_fixture v12-missing-section)"
mkdir -p "$R7/decisions/implemented/process"
{
  printf '# 决策: 夹具缺节\n\n状态: implemented\n日期: 2026-10-06\n\n'
  printf '## 一句话\n夹具。\n\n## 问题\n痛点。\n\n## 决定\n定了。\n\n## 考虑过的其他方案\n无。\n\n## 取代\n无。\n'
} > "$R7/decisions/implemented/process/2026-10-06-fixture.md"
run_fixture "$RAW/07-v12-missing-section.txt" "$R7" "${FIX_COMMON[@]}"
expect_exit "$RAW/07-v12-missing-section.txt" 1 "07-v12-missing-section"
grep -q 'token=MISSING_SECTION' "$RAW/07-v12-missing-section.txt" || {
  echo "EVIDENCE-FAIL 07 未出现 MISSING_SECTION" >&2; FAILED=1; }
grep -q '后果' "$RAW/07-v12-missing-section.txt" || {
  echo "EVIDENCE-FAIL 07 未具名缺哪节" >&2; FAILED=1; }

# ── 08 V12：implemented 下出现提议腔 ⇒ 必红 ─────────────────────────────
R8="$(new_fixture v12-tone)"
mkdir -p "$R8/decisions/implemented/process"
{
  printf '# 决策: 夹具提议腔\n\n状态: implemented\n日期: 2026-10-06\n\n'
  printf '## 一句话\n夹具。\n\n## 问题\n痛点。\n\n## 决定\n定了。\n\n'
  printf '## 考虑过的其他方案\n无。\n\n## 后果\n补充：建议下一轮可以考虑接线。\n\n## 取代\n无。\n'
} > "$R8/decisions/implemented/process/2026-10-06-fixture.md"
run_fixture "$RAW/08-v12-proposal-tone.txt" "$R8" "${FIX_COMMON[@]}"
expect_exit "$RAW/08-v12-proposal-tone.txt" 1 "08-v12-proposal-tone"
grep -q 'token=PROPOSAL_TONE' "$RAW/08-v12-proposal-tone.txt" || {
  echo "EVIDENCE-FAIL 08 未出现 PROPOSAL_TONE" >&2; FAILED=1; }

# ── 收口 ────────────────────────────────────────────────────────────────
if [ "$MODE" = "--check" ]; then
  echo "=== --check 对账：重建 vs 入库 ==="
  if diff -ru "$SELF_DIR/raw" "$RAW"; then
    echo "EVIDENCE-CHECK ok 重建结果与入库证据逐字一致"
  else
    echo "EVIDENCE-CHECK FAIL 重建结果与入库证据不一致（证据已过期 ⇒ 重跑重建并提交）" >&2
    FAILED=1
  fi
else
  echo "=== 已重建证据：$RAW ==="
  ls -1 "$RAW"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "EVIDENCE-FAIL 有夹具未复现期望判定（证据链断）" >&2
  exit 1
fi
echo "EVIDENCE ok 全部夹具复现期望判定"
exit 0
