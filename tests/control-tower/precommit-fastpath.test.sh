#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# precommit-fastpath.test.sh — Issue #1417 配对测试（默认快跑集 + 全量按需）
#
# 覆盖矩阵（铁律 48 三路径）:
#   正常 — 默认模式：组 1/3/12/13 运行，组 2/4/5/6/7/8/9 跳过（横幅不出现、有跳过行）
#   正常 — 全量模式（SYNO_PRECOMMIT_FULL=1）：11 组横幅全部出现、无跳过行
#   反向 — 改坏必红抽两条：
#          ① 组 1：暂存 `as any` ⇒ ❌（默认与全量都红）
#          ② 组 2：暂存无配对测试的新 src/*.ts ⇒ ❌（仅全量红；默认跳过 = 该组确实不跑）
#   接线 — 脚本真的从环境变量/`--full` 读取开关（源码断言）
#
# 运行环境：临时 clone（hermetic），把工作树当前版本的门禁脚本覆盖进去后用 env -i 白名单跑。
# @input  scripts/pre-commit-check.sh 及被优化的 helper（工作树版本）；本地 git/bash/python3
# @output 逐条 ✅/❌ + 末尾 RESULT 行
# @exit   0=全部通过；1=断言失败；2=harness 环境不可用（判不了 ≠ 通过）
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0
FAIL=0
FAILED=""
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); FAILED="$FAILED$1; "; }
degrade() {
  echo "cannot judge: precommit-fastpath-harness: $1" >&2
  exit 2
}
for tool in git bash grep python3 mktemp cp; do
  command -v "$tool" >/dev/null 2>&1 || degrade "$tool missing"
done
[ -f "$REPO/scripts/pre-commit-check.sh" ] || degrade "scripts/pre-commit-check.sh missing"

TMP="$(mktemp -d)" || degrade "mktemp failed"
trap 'rm -rf "$TMP"' EXIT

CLONE="$TMP/repo"
git clone -q "$REPO" "$CLONE" 2>"$TMP/clone.err" || {
  cat "$TMP/clone.err" >&2
  degrade "git clone failed"
}
# 被测对象 = 工作树当前版本（未提交改动也要覆盖进去，否则测的是 HEAD 旧脚本）
for f in \
  scripts/pre-commit-check.sh \
  scripts/check-integrity-startup.sh \
  scripts/check-hardcoded.sh \
  scripts/workflow/sync-dsh-skills.sh \
  scripts/doc-system/doc-registry-gate.sh; do
  if [ -f "$REPO/$f" ]; then
    cp "$REPO/$f" "$CLONE/$f"
  fi
done

# 探针：① as any（组 1 硬红）② 无配对测试的新 impl（组 2 硬红）
PROBE1="src/__fastpath_probe__.ts"
PROBE2="src/__fastpath_probe2__.ts"
printf 'export const __fastpathProbe = (v: unknown): number => v as any;\n' >"$CLONE/$PROBE1"
printf 'export const __fastpathProbe2 = 1;\n' >"$CLONE/$PROBE2"
git -C "$CLONE" add -- "$PROBE1" "$PROBE2" >/dev/null 2>&1 || degrade "git add probe failed"

run_gate() { # <out> [<gate-env>...] → stdout: rc
  local out="$1"
  shift
  (
    cd "$CLONE" || exit 2
    env -i \
      PATH="$PATH" HOME="${HOME:-/tmp}" LANG="${LANG:-C.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" \
      SYNO_GROUP_TIMING_LOG="$TMP/groups.log" MLC_ALLOW_MAIN_TREE=1 \
      "$@" bash scripts/pre-commit-check.sh
  ) >"$out" 2>&1
  echo $?
}

has() { grep -qF -- "$2" "$1"; }        # <file> <literal>
assert_has() { if has "$1" "$2"; then ok "$3"; else no "$3"; fi; }
assert_not() { if has "$1" "$2"; then no "$3"; else ok "$3"; fi; }

echo "=== Issue #1417: pre-commit 默认快跑集 / 全量按需 ==="

# ── 接线：开关真的存在于脚本（防「文档说支持、脚本没接」）──
PC="$REPO/scripts/pre-commit-check.sh"
grep -q 'SYNO_PRECOMMIT_FULL' "$PC" && ok "接线: 脚本读取 SYNO_PRECOMMIT_FULL" || no "接线: 脚本未读取 SYNO_PRECOMMIT_FULL"
grep -q -- '--full)' "$PC" && ok "接线: 脚本支持 --full 参数" || no "接线: 脚本不支持 --full"

# ── 默认模式（改坏注入仍在）：组 2 跳过 ⇒ 配对检查不跑；组 1 as any 仍必红 ──
RC_DEF="$(run_gate "$TMP/default.out")"
echo "── 默认模式 (rc=${RC_DEF}) ──"
assert_has "$TMP/default.out" "── 组 1:" "默认: 组 1 运行"
assert_has "$TMP/default.out" "── 组 3:" "默认: 组 3 运行"
assert_has "$TMP/default.out" "── 组 12:" "默认: 组 12 运行"
assert_has "$TMP/default.out" "── 组 13:" "默认: 组 13 运行"
assert_has "$TMP/default.out" "跳过（默认快跑集" "默认: 被跳过的组有显式跳过行（非静默）"
for g in 2 4 5 6 7 8 9; do
  assert_not "$TMP/default.out" "── 组 ${g}:" "默认: 组 ${g} 确实不跑（无横幅）"
done
assert_has "$TMP/default.out" "as any" "默认[改坏必红①]: 组 1 的 as any 仍以 ❌ 暴露"
assert_not "$TMP/default.out" "新文件配对: impl 须同 commit 有 test" "默认: 组 2 配对检查未运行（跳过生效，非假绿）"
[ "$RC_DEF" = "1" ] && ok "默认: rc=1（as any 硬阻断）" || no "默认: rc=${RC_DEF}（期望 1）"

# ── 全量模式：11 组全跑；两条改坏必红同时出现 ──
RC_FULL="$(run_gate "$TMP/full.out" SYNO_PRECOMMIT_FULL=1)"
echo "── 全量模式 (rc=${RC_FULL}) ──"
for g in 1 2 3 4 5 6 7 8 9 12 13; do
  assert_has "$TMP/full.out" "── 组 ${g}:" "全量: 组 ${g} 运行"
done
assert_not "$TMP/full.out" "跳过（默认快跑集" "全量: 无跳过行"
assert_has "$TMP/full.out" "as any" "全量[改坏必红①]: 组 1 as any ❌"
assert_has "$TMP/full.out" "新文件配对: impl 须同 commit 有 test" "全量[改坏必红②]: 组 2 配对缺失 ❌"
[ "$RC_FULL" = "1" ] && ok "全量: rc=1（两条硬红）" || no "全量: rc=${RC_FULL}（期望 1）"

# ── 耗时（墙钟，附数据；不设通过阈值，避免机器差异误红）──
DEF_LOG="$TMP/groups.log"
if [ -s "$DEF_LOG" ]; then
  echo "  ℹ️  最近一次逐组耗时（秒）:"
  sed 's/^/     /' "$DEF_LOG"
fi

echo ""
echo "PRECOMMIT-FASTPATH RESULT pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ] || { echo "FAILED: $FAILED"; exit 1; }
exit 0
