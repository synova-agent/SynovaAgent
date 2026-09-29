#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# vitest-log-level.test.sh — D1040 (A4-b) 测试期 LOG_LEVEL 收敛
#
# 被测契约（vitest.config.ts → test.env.LOG_LEVEL）:
#   输入 : 外部环境变量 LOG_LEVEL（可缺省）
#   输出 : 测试 worker 内 process.env.LOG_LEVEL = （外部值 ?? 'warn'），pino 生效级别同值
#   降级 : 外部显式设值 ⇒ 原样透传（不得被 test.env 的覆盖语义静默夺走）
#   边界 : 不得为 'silent' —— packages/logger/src/index.ts:44 的二级抑制开关会让 fd 2
#          彻底静音，失败上下文一并消失，与本卡"失败时仍能出上下文"目标相悖
#
# 为什么断言在"探针进程内"而不是只读配置文件:
#   logger 在**模块加载期**固化级别（packages/logger/src/index.ts:12
#   `const level = process.env.LOG_LEVEL || 'info'`）。只 grep 配置文本属
#   "grep 型静态判据当验收"（坑清单禁用），无法区分"配置写了"与"运行时真生效"。
#
# ── 时序守卫（D1040 队长裁定，2026-09-28）────────────────────────────────────
# 本测试会被登记进 ci.yml 密封清单（由 A4-c/D1039 承接），而 A4-c 分支**不含**本卡的
# vitest.config.ts 修复 ⇒ 若无条件硬断言，A4-c 分支必红。但判别性又不能丢。
# 二者靠**分支历史**区分（三个模式，互斥且穷尽）：
#
#   契约行在配置里 | 本分支历史曾引入契约行 | 模式        | 行为
#   ──────────────┼──────────────────────┼────────────┼──────────────────────
#        是        |          是           | ASSERT      | 硬断言（正常路径）
#        否        |          是           | REGRESSION  | **红**（引入过又丢了）
#        否        |          否           | SKIP        | 跳过留痕，不判红
#        否        |      **不可判定**     | **ASSERT**  | **fail-safe：宁可误红，不静默放行**
#
#   ⚠️ **不可判定条件**（任一命中 ⇒ 走 fail-safe，不判 SKIP）：
#      · `git rev-parse --absolute-git-dir` / `--git-common-dir` 失败或为空
#      · 存在 `shallow` 文件（浅克隆 ⇒ 历史被截断 ⇒ "查不到" ≠ "没有"）
#      · `git log -S` 非零退出（git 不可用等）
#      理由：判据③（判别性）是**安全侧**，SKIP 是**松侧**；历史信号在 CI 可能因
#      shallow clone / fetch-depth 不足失效（ci.yml:312 的 D520 先例：depth=1 时
#      origin/main 缺失）—— 那时若静默 SKIP，判别性会**静默消失**。
#      实测：本仓 CT job 用 `fetch-depth: 0`（ci.yml:312）⇒ 正常 CI 走 ASSERT/SKIP，
#      fail-safe 只在病态环境触发。
#   ⇒ 判据① 未含修复的分支（如 A4-c，全历史）跑它 ⇒ SKIP ⇒ 不红
#   ⇒ 判据② 本分支跑它 ⇒ ASSERT ⇒ 硬断言通过
#   ⇒ 判据③ 本分支删掉契约行 ⇒ REGRESSION（历史有、配置无）⇒ **红**（判别性保持）
#   ⇒ 判据④ 历史不可判定（浅克隆）⇒ **ASSERT**（非 SKIP）⇒ 安全侧
#   「历史曾引入」= `git log -S<契约行> -- vitest.config.ts` 有命中（已实测：
#   本分支命中 1 条 5e8031ab；origin/main 命中 0 条）。
#
# 覆盖（铁律 48：正常/降级/边界）:
#   1. 正常路径   : 无外部 LOG_LEVEL          ⇒ 探针 LOG_LEVEL=warn 且 pino 生效级别=warn
#   2. 降级/边界  : 外部 LOG_LEVEL=debug      ⇒ 探针透传 debug（证伪"硬编码 warn"）
#   3. 边界护栏   : 配置不得出现 LOG_LEVEL: 'silent'（**不依赖修复，任何模式都跑**）
#   4. 判别性夹具 : 注释掉该行 ⇒ 探针必须变回 undefined/info（证明该行是承重的）
#   5. 生产接线   : package.json "test" 脚本确实走本 config（**不依赖修复，任何模式都跑**）
#
# 用法   : bash tests/win/vitest-log-level.test.sh
# 退出码 : 0 = 全绿或 SKIP；1 = 至少一条断言失败 / REGRESSION
# 自清理 : 临时探针文件 + 备份配置全部 trap EXIT/INT/TERM 清理
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG="$REPO_DIR/vitest.config.ts"
PROBE_REL="tests/win/zz-a4b-loglevel-probe.test.ts"
PROBE="$REPO_DIR/$PROBE_REL"
BAK="$(mktemp -t a4b-vitest-config.XXXXXX)"
CONTRACT_KEY="LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

cleanup() {
  rm -f "$PROBE" 2>/dev/null || true
  # 若配置被夹具改动，无条件从备份复原（防夹具把仓库留在坏状态）
  if [ -f "$BAK" ] && [ -f "$CONFIG" ]; then
    if ! cmp -s "$BAK" "$CONFIG"; then
      cp "$BAK" "$CONFIG"
      echo "  ⚠ cleanup: vitest.config.ts 已从备份复原" >&2
    fi
  fi
  rm -f "$BAK" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cp "$CONFIG" "$BAK"

# 跑探针；$1 = 该次注入的外部 LOG_LEVEL（空串 = 不注入）
run_probe() {
  local ext="$1" out=""
  if [ -n "$ext" ]; then
    out="$(cd "$REPO_DIR" && LOG_LEVEL="$ext" npx vitest run "$PROBE_REL" --reporter=verbose 2>&1 || true)"
  else
    out="$(cd "$REPO_DIR" && npx vitest run "$PROBE_REL" --reporter=verbose 2>&1 || true)"
  fi
  printf '%s' "$out"
}

# 从探针输出取 token 值（token 名单独一行，取最后一次出现）
extract() {
  local out="$1" tok="$2" v=""
  v="$(printf '%s\n' "$out" | grep -E "^${tok}=" | tail -n 1 | sed -e "s/^${tok}=//" | tr -d '\r' || true)"
  printf '%s' "$v"
}

echo "═══════════════════════════════════════════════════════════════"
echo "  D1040 · 测试期 LOG_LEVEL 契约（vitest.config.ts test.env）"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── 0. 时序守卫：模式判定（总是打印，可核）────────────────────────────────────
echo "── 0. 时序守卫模式判定 ──"
FIX_IN_CONFIG=0
grep -qF "$CONTRACT_KEY" "$CONFIG" 2>/dev/null && FIX_IN_CONFIG=1

# 历史信号**三值**：0 = 确证曾引入 / 1 = 确证从未引入 / 2 = **不可判定**
# 🔴 fail-safe（队长 2026-09-28 追加，硬要求）:
#     不可判定 ⇒ 降级 **ASSERT**，**绝不降级 SKIP**。
#     理由：判据③（判别性）是**安全侧**，SKIP 是**松侧**。历史信号会因 shallow clone /
#     fetch-depth 不足在 CI 失效（ci.yml:312 的 D520 先例：depth=1 时 origin/main 缺失）
#     —— 那时若静默 SKIP，判别性会**静默消失**（正是本仓 M3「机制建成未接线」家族）。
#     ⇒ 宁可误红，不可静默放行。
hist_signal() {
  local gitdir common out
  gitdir="$(git -C "$REPO_DIR" rev-parse --absolute-git-dir 2>/dev/null)" || return 2
  common="$(git -C "$REPO_DIR" rev-parse --git-common-dir 2>/dev/null)" || return 2
  [ -n "$gitdir" ] || return 2
  [ -n "$common" ] || return 2
  case "$common" in /*) ;; *) common="$REPO_DIR/$common" ;; esac   # 相对路径归一
  # 浅克隆 ⇒ 历史被截断 ⇒ "查不到" ≠ "没有"（两个位置都查：worktree gitdir + common gitdir）
  if [ -f "$gitdir/shallow" ] || [ -f "$common/shallow" ]; then return 2; fi
  out="$(git -C "$REPO_DIR" log --format=%H -S"$CONTRACT_KEY" -- vitest.config.ts 2>/dev/null)" || return 2
  if printf '%s' "$out" | grep -q .; then return 0; fi
  return 1
}
HIST_RC=0
hist_signal || HIST_RC=$?
case "$HIST_RC" in
  0) FIX_IN_HISTORY=1; HIST_DETERMINATE=1 ;;
  1) FIX_IN_HISTORY=0; HIST_DETERMINATE=1 ;;
  *) FIX_IN_HISTORY=0; HIST_DETERMINATE=0 ;;
esac
echo "     契约行在 vitest.config.ts 中  : $FIX_IN_CONFIG"
echo "     本分支历史曾引入该契约行      : $FIX_IN_HISTORY   (可判定=$HIST_DETERMINATE rc=$HIST_RC)"
if [ "$FIX_IN_CONFIG" = "1" ]; then
  MODE="ASSERT"
elif [ "$HIST_DETERMINATE" = "0" ]; then
  # fail-safe：不可判定 ⇒ 安全侧
  MODE="ASSERT"
  echo "     ⚠️  FAIL-SAFE: 历史信号不可判定 (rc=$HIST_RC) ⇒ 降级 ASSERT，**不降级 SKIP**" >&2
  echo "     ⚠️  FAIL-SAFE: 可能原因 = shallow clone (fetch-depth<0) / git 不可用 / gitdir 不可解析" >&2
  echo "     ⚠️  FAIL-SAFE: 取舍 = 宁可误红（安全侧），不可静默放行（松侧）" >&2
elif [ "$FIX_IN_HISTORY" = "1" ]; then
  MODE="REGRESSION"
else
  MODE="SKIP"
fi
echo "     ⇒ 模式 = $MODE"
echo ""

if [ "$MODE" = "SKIP" ]; then
  # A4-c 类分支：本卡修复不在此分支，硬断言会误红 ⇒ 跳过并留痕（判据①）
  echo "── 1/2/4. 跳过（本分支不含 D1040 修复，硬断言会误红）──"
  echo "     ⏭️  SKIP: vitest.config.ts 无 LOG_LEVEL 契约行，且本分支历史从未引入过它。"
  echo "     ⏭️  SKIP: 原因 = 本测试由 A4-c/D1039 登记进 ci.yml 密封清单，而该分支不含本卡修复。"
  echo "     ⏭️  SKIP: 判别性未丢 = 在含修复的分支上仍是硬断言；删掉契约行即转 REGRESSION 红（判据③）。"
  echo "     ⏭️  SKIP: 应然状态 = 合并顺序 A4-c 先、A4-b 后；A4-b 合入 main 后即转为 ASSERT。"
  echo ""
else
  if [ "$MODE" = "REGRESSION" ]; then
    fail "REGRESSION: 本分支历史曾引入 '$CONTRACT_KEY'，但当前 vitest.config.ts 已无此行 ⇒ 修复被回退"
    echo "     （这正是判别性判据③：拿掉修复 ⇒ 本测试必须红）"
  fi

  # ── 探针生成 ────────────────────────────────────────────────────────────────
  cat > "$PROBE" <<'PROBE_EOF'
import { describe, it } from 'vitest';

// 临时探针 — 由 tests/win/vitest-log-level.test.sh 生成，trap 清理，不入库。
describe('A4-b LOG_LEVEL 探针', () => {
  it('回显 process.env.LOG_LEVEL 与 pino 生效级别', async () => {
    console.log('A4B_PROBE_ENV_LOG_LEVEL=' + String(process.env.LOG_LEVEL));
    const { logger } = await import('@synova/logger');
    console.log('A4B_PROBE_PINO_LEVEL=' + String(logger.level));
  });
});
PROBE_EOF

  # ── 1. 正常路径 ─────────────────────────────────────────────────────────────
  echo "── 1. 正常路径: 无外部 LOG_LEVEL ⇒ 应收敛到 warn ──"
  OUT1="$(run_probe "")"
  L1="$(extract "$OUT1" A4B_PROBE_ENV_LOG_LEVEL)"
  P1="$(extract "$OUT1" A4B_PROBE_PINO_LEVEL)"
  echo "     探针 env LOG_LEVEL = '${L1}'   探针 pino level = '${P1}'"
  if [ "$L1" = "warn" ]; then pass "process.env.LOG_LEVEL = warn"; else fail "process.env.LOG_LEVEL 期望 warn，实得 '${L1}'"; fi
  if [ "$P1" = "warn" ]; then pass "pino 生效级别 = warn（模块加载期真读到）"; else fail "pino 生效级别期望 warn，实得 '${P1}'"; fi
  echo ""

  # ── 2. 降级/边界: 外部显式值必须透传 ────────────────────────────────────────
  echo "── 2. 降级/边界: 外部 LOG_LEVEL=debug ⇒ 必须透传（语义：外部显式值优先）──"
  OUT2="$(run_probe "debug")"
  L2="$(extract "$OUT2" A4B_PROBE_ENV_LOG_LEVEL)"
  P2="$(extract "$OUT2" A4B_PROBE_PINO_LEVEL)"
  echo "     探针 env LOG_LEVEL = '${L2}'   探针 pino level = '${P2}'"
  if [ "$L2" = "debug" ]; then pass "外部显式值透传（证明是 ?? 而非硬编码 warn）"; else fail "外部 LOG_LEVEL=debug 期望透传，实得 '${L2}'（test.env 覆盖语义把调试开关夺走了）"; fi
  if [ "$P2" = "debug" ]; then pass "pino 生效级别 = debug"; else fail "pino 生效级别期望 debug，实得 '${P2}'"; fi
  echo ""

  # ── 4. 判别性夹具: 注释掉该行 ⇒ 探针必须变回 undefined/info ─────────────────
  echo "── 4. 判别性夹具: 注释掉配置行 ⇒ 探针必须转红（该行承重）──"
  if python3 - "$CONFIG" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
key = "      LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',"
if key not in s:
    sys.exit(3)
open(p, 'w', encoding='utf-8').write(s.replace(key, "      // " + key.strip(), 1))
PY
  then
    OUT4="$(run_probe "")"
    L4="$(extract "$OUT4" A4B_PROBE_ENV_LOG_LEVEL)"
    P4="$(extract "$OUT4" A4B_PROBE_PINO_LEVEL)"
    echo "     注释后 探针 env LOG_LEVEL = '${L4}'   探针 pino level = '${P4}'"
    if [ "$L4" != "warn" ] && [ "$P4" != "warn" ]; then
      pass "拿掉修复 ⇒ 探针退化为 '${L4}'/'${P4}'（第 1 步断言随之转红 ⇒ 判别性成立）"
    else
      fail "注释掉配置行后探针仍为 '${L4}'/'${P4}' ⇒ 该行不承重，第 1 步是假绿"
    fi
    cp "$BAK" "$CONFIG"   # 立即复原，不等 trap
    if cmp -s "$BAK" "$CONFIG"; then pass "配置已立即复原（cmp 相等）"; else fail "配置复原失败"; fi
  else
    fail "无法注释配置行（LOG_LEVEL 契约行缺失 ⇒ 修复已被拿掉 ⇒ 本测试即红）"
  fi
  echo ""
fi

# ── 3. 边界护栏: 不得 silent（不依赖修复，任何模式都跑）──────────────────────
echo "── 3. 边界护栏: 配置不得把 LOG_LEVEL 设成 'silent' ──"
if grep -qE "LOG_LEVEL:\s*'silent'" "$CONFIG"; then
  fail "vitest.config.ts 含 LOG_LEVEL: 'silent' —— fd 2 二级抑制会让失败上下文一并消失"
else
  pass "配置未设 silent（失败上下文保留）"
fi
echo ""

# ── 5. 生产接线: 本 config 不是孤儿（不依赖修复，任何模式都跑）───────────────
echo "── 5. 生产接线: package.json 的 test 脚本走默认 config 解析 ──"
TEST_SCRIPT="$(python3 -c "
import json
print(json.load(open('$REPO_DIR/package.json'))['scripts'].get('test',''))
" 2>/dev/null || true)"
echo "     npm test = '${TEST_SCRIPT}'"
if printf '%s' "$TEST_SCRIPT" | grep -q "vitest run"; then
  pass "npm test 走 'vitest run' ⇒ 默认解析 vitest.config.ts（非孤儿配置）"
else
  fail "npm test 未走 vitest run（实得 '${TEST_SCRIPT}'）"
fi
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "  模式: $MODE   结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ D1040 LOG_LEVEL 契约未通过"
  echo "═══════════════════════════════════════════════════════════════"
  exit 1
fi
if [ "$MODE" = "SKIP" ]; then
  echo "  Status: ⏭️  SKIP（本分支不含 D1040 修复；已留痕，不判红）"
else
  echo "  Status: ✅ D1040 LOG_LEVEL 契约全部通过"
fi
echo "═══════════════════════════════════════════════════════════════"
exit 0
