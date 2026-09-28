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
#   "grep 型静态判据"（坑清单禁用），无法区分"配置写了"与"运行时真生效"。
#
# 覆盖（铁律 48：正常/降级/边界）+ 判别性夹具（拿掉修复即红）:
#   1. 正常路径   : 无外部 LOG_LEVEL          ⇒ 探针 LOG_LEVEL=warn 且 pino 生效级别=warn
#   2. 降级/边界  : 外部 LOG_LEVEL=debug      ⇒ 探针透传 debug（证伪"硬编码 warn"）
#   3. 边界护栏   : 配置不得出现 LOG_LEVEL: 'silent'
#   4. 判别性夹具 : 注释掉该行 ⇒ 探针必须变回 undefined/info（证明该行是承重的）
#   5. 生产接线   : package.json "test" 脚本确实走本 config（默认解析，非孤儿配置）
#
# 用法   : bash tests/win/vitest-log-level.test.sh
# 退出码 : 0 = 全绿 / 1 = 至少一条断言失败
# 自清理 : 临时探针文件 + 备份配置全部 trap EXIT/INT/TERM 清理
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG="$REPO_DIR/vitest.config.ts"
PROBE_REL="tests/win/zz-a4b-loglevel-probe.test.ts"
PROBE="$REPO_DIR/$PROBE_REL"
BAK="$(mktemp -t a4b-vitest-config.XXXXXX)"

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

# ── 探针生成 ──────────────────────────────────────────────────────────────────
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

# ── 工具 ──────────────────────────────────────────────────────────────────────
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

# ── 1. 正常路径 ───────────────────────────────────────────────────────────────
echo "── 1. 正常路径: 无外部 LOG_LEVEL ⇒ 应收敛到 warn ──"
OUT1="$(run_probe "")"
L1="$(extract "$OUT1" A4B_PROBE_ENV_LOG_LEVEL)"
P1="$(extract "$OUT1" A4B_PROBE_PINO_LEVEL)"
echo "     探针 env LOG_LEVEL = '${L1}'   探针 pino level = '${P1}'"
if [ "$L1" = "warn" ]; then pass "process.env.LOG_LEVEL = warn"; else fail "process.env.LOG_LEVEL 期望 warn，实得 '${L1}'"; fi
if [ "$P1" = "warn" ]; then pass "pino 生效级别 = warn（模块加载期真读到）"; else fail "pino 生效级别期望 warn，实得 '${P1}'"; fi
echo ""

# ── 2. 降级/边界: 外部显式值必须透传 ──────────────────────────────────────────
echo "── 2. 降级/边界: 外部 LOG_LEVEL=debug ⇒ 必须透传（语义：外部显式值优先）──"
OUT2="$(run_probe "debug")"
L2="$(extract "$OUT2" A4B_PROBE_ENV_LOG_LEVEL)"
P2="$(extract "$OUT2" A4B_PROBE_PINO_LEVEL)"
echo "     探针 env LOG_LEVEL = '${L2}'   探针 pino level = '${P2}'"
if [ "$L2" = "debug" ]; then pass "外部显式值透传（证明是 ?? 而非硬编码 warn）"; else fail "外部 LOG_LEVEL=debug 期望透传，实得 '${L2}'（test.env 覆盖语义把调试开关夺走了）"; fi
if [ "$P2" = "debug" ]; then pass "pino 生效级别 = debug"; else fail "pino 生效级别期望 debug，实得 '${P2}'"; fi
echo ""

# ── 3. 边界护栏: 不得 silent ──────────────────────────────────────────────────
echo "── 3. 边界护栏: 配置不得把 LOG_LEVEL 设成 'silent' ──"
if grep -qE "LOG_LEVEL:\s*'silent'" "$CONFIG"; then
  fail "vitest.config.ts 含 LOG_LEVEL: 'silent' —— fd 2 二级抑制会让失败上下文一并消失"
else
  pass "配置未设 silent（失败上下文保留）"
fi
echo ""

# ── 4. 判别性夹具: 注释掉该行 ⇒ 探针必须变回 undefined/info ───────────────────
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

# ── 5. 生产接线: 本 config 不是孤儿 ───────────────────────────────────────────
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
echo "  结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ D1040 LOG_LEVEL 契约未通过"
  echo "═══════════════════════════════════════════════════════════════"
  exit 1
fi
echo "  Status: ✅ D1040 LOG_LEVEL 契约全部通过"
echo "═══════════════════════════════════════════════════════════════"
exit 0
