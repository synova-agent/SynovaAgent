#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-tool-args-delta.test.sh — #915 Q-1 配对判据测试（只读脚本 ＋ mktemp 沙箱夹具仓）
#                        ＋ #915 Q-5 扩展（R4/R5/R6 · T14–T22 · 裁 365）
#
# 覆盖矩阵（铁律 48 三路径 ＋ 改坏必红；ctrl-tower-change 模式 1 三态 0/1/2）:
#   正常  — T1 合规工具变更 ⇒ rc0 PASS changes=1 ｜T-neg 真 nullary ⇒ rc0
#   降级  — T2/T2b/T2c 空 schema 有新工具（含 `(params`／`({`／`src/tools/` 前缀）⇒ rc1 点名 R1
#           T3a/T3b 绕过 execute 调工具 handler（含 vendor 前缀）⇒ rc1 点名 R2
#           T4 基线少一名（修好未删登记的反向）⇒ rc1 点名 R3
#   边界  — T5 纯文档变更 ⇒ rc0 + SKIP ｜T5b `--files ""` ⇒ rc0 + SKIP（整体替换语义）
#           T6 坏 base ⇒ rc2 + E_BAD_BASE ｜T11 非扫描面文件 ⇒ SKIP（不误红 job.handler/command.handler）
#   自检  — T7 `--selfcheck` ⇒ 末行精确 SELFCHECK-OK f1=1 f2=1 f3=1 f4=1 f5=1 clean=0（判别力）
#   改坏  — T8 变异体两臂（R1 恒空 ⇒ T2 场景翻绿＋selfcheck 失败）｜T8b（R2 恒空 ⇒ T3a 翻绿）
#           T21 变异体两臂（R4 恒空 ⇒ T14 场景翻绿＋selfcheck f4 失败）
#   Q-5 扩 — T14 mutating 工具无 ctx/检查 ⇒ rc1 点名 R4 ｜T15 同上但有 ctx＋检查 ⇒ rc0（防一律红）
#           T16 信号基线少一行（修好未删登记）⇒ rc1 点名 R5 ｜T17 多一行（未登记新副作用）⇒ rc1 R5
#           T18 src/agent 内 execute 2 参 ⇒ rc1 点名 R6 ｜T19 3 参 ⇒ rc0
#           T20 selfcheck 末行精确（Q-5 新口径）｜T22 生产接线三条（复用既有，不新增 CI 步）
#   接线  — T9 七条（pre-commit 块真调用/--staged/hard_check 无 v5_soft/CI ①i 落位与三态/
#           rc1 无 ❌ 仍阻断/rc2 无 ERROR 仍阻断/脚本缺失仍阻断/CI ①i 真逃生舱）
#           T13 pre-commit 块真逃生舱（SYNO_TOOL_ARGS_DELTA=0 ⇒ ℹ️ ＋ rc0）
#   交叉  — T12 闸自带的 R3 取数口 vs 基线登记集合（独立派生互校）⇒ 改错一行即 rc1
#   夹具不变式 — 每个夹具仓的「空 schema 名集合 ≡ 该仓 baseline」（否则 R3 替 R1 顶红，T-neg/T8 不可达）
#
# 隔离: 每个用例独立 mktemp 仓（git init ＋ 本地身份），零网络、零宿主写入、不触真实仓库；
#       GATE_HITS_LOG 指向 TMPROOT（不污染仓库 .claude/）。
# 依赖: python3（与生产同契约；缺 ⇒ exit 2 —— 不静默当通过）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$REPO/scripts/control-tower/check-tool-args-delta.py"
PC="$REPO/scripts/pre-commit-check.sh"
WF="$REPO/.gitea/workflows/local-gates.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
assert_rc() { if [ "$1" -eq "$2" ]; then ok "$3 (exit=$1)"; else no "$3 — exit=$1 期望 $2"; fi; }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "❌ 缺 python3（检查自身失败）"; exit 2; }
[ -f "$SUT" ] || { echo "❌ 缺被测件: $SUT"; exit 2; }
[ -f "$PC" ] || { echo "❌ 缺接线件: $PC"; exit 2; }
[ -f "$WF" ] || { echo "❌ 缺 CI 件: $WF"; exit 2; }

TMPROOT="$(mktemp -d)"; trap 'rm -rf "$TMPROOT"' EXIT
export GATE_HITS_LOG="$TMPROOT/gate-hits.log"   # 门禁统计落沙箱，不污染仓库

# ── 夹具仓: 最小工具面（2 nullary ＋ 1 合规 ＋ 1 ToolDefinition 数组形态 ＋ vendor pandoc 1）──
# 🔴 夹具不变式: 树内空 schema 名集合 = {diag_progress, list_jobs} ≡ 本仓 baseline（下方手写一致）
mk_repo() { # <dir>
  local d="$1"
  mkdir -p "$d/src/agent" "$d/src/tools" "$d/vendor/pandoc-skill" "$d/scripts/control-tower"
  cat > "$d/src/agent/builtin-tools.ts" <<'TS'
import type { ToolRegistry } from './tools';

export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register({
    name: 'diag_progress',
    description: '诊断进度（真 nullary：handler 零形参）',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ phase: 1 }),
  });

  registry.register({
    name: 'list_jobs',
    description: '列出定时任务（真 nullary）',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ jobs: [] }),
  });

  registry.register({
    name: 'query_org',
    description: '合规工具（有 properties ＋ 有参 handler）',
    parameters: { type: 'object', properties: { orgId: { type: 'string' } }, required: ['orgId'] },
    handler: async (params) => ({ orgId: params.orgId }),
  });
}
TS
  cat > "$d/src/tools/demo-tools.ts" <<'TS'
import type { ToolDefinition } from '../agent/tools';

export const demoSearchTool: ToolDefinition = {
  name: 'demo_search',
  description: '数组形态（引用聚合不算定义 ⇒ 不重复计数）',
  parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  handler: async (p) => ({ q: p.q }),
};

export const DEMO_TOOLS: ToolDefinition[] = [demoSearchTool];
TS
  cat > "$d/vendor/pandoc-skill/synova-tools.ts" <<'TS'
import type { ToolRegistry } from '../../src/agent/tools';

export function registerPandocTools(registry: ToolRegistry): void {
  registry.register({
    name: 'convert_md_to_docx',
    description: '合规工具（vendor 前缀；T3b 证明该前缀没被过滤根漏掉）',
    parameters: {
      type: 'object',
      properties: { inputPath: { type: 'string' }, outputPath: { type: 'string' } },
      required: ['inputPath', 'outputPath'],
      additionalProperties: false,
    },
    handler: async (params) => ({ outputPath: params.outputPath }),
  });
}
TS
  cat > "$d/scripts/control-tower/tool-args-baseline.txt" <<'BASE'
# 夹具基线（按 mk_repo 夹具树生成；夹具不变式：树内空 schema 名集合 ≡ 本清单）
diag_progress | nullary：handler 零形参
list_jobs | nullary：handler 零形参
BASE
  # Q-5：夹具树无「缺取消检查的副作用工具」⇒ 信号基线为空（注释行）
  printf '# 夹具信号基线（夹具树无缺取消检查的副作用工具）\n' \
    > "$d/scripts/control-tower/tool-signal-baseline.txt"
  printf '__pycache__/\n' > "$d/.gitignore"
  ( cd "$d" && git init -q && git config user.email t@t && git config user.name t \
      && git add -A && git commit -q -m base )
}

runq() { # <dir> <args...> → RUN_OUT（stdout+stderr）／RUN_RC
  local d="$1"; shift
  RUN_OUT="$( cd "$d" && "$PYBIN" "$SUT" --root . "$@" 2>&1 )"; RUN_RC=$?
}

append_baseline() { # <dir> <name> <reason>
  printf '%s | %s\n' "$2" "$3" >> "$1/scripts/control-tower/tool-args-baseline.txt"
}

append_signal_baseline() { # <dir> <name> <reason>（Q-5：R5 信号基线）
  printf '%s | %s\n' "$2" "$3" >> "$1/scripts/control-tower/tool-signal-baseline.txt"
}

# ── 夹具不变式检查器（用闸自身的取数口 + 基线解析，独立于主流程输出）──
cat > "$TMPROOT/invariant.py" <<'PY'
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("sut_under_test", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
root = sys.argv[2]
defs = m.scan_tree_defs(root)
tree = sorted(d["name"] for d in defs if d["empty_schema"])
base = sorted(m.load_baseline(root + "/scripts/control-tower/tool-args-baseline.txt"))
print("TREE=%s BASE=%s" % (",".join(tree), ",".join(base)))
sys.exit(0 if tree == base else 1)
PY

fixture_invariant() { # <dir> <label>
  local d="$1" label="$2" outp rc
  outp="$("$PYBIN" "$TMPROOT/invariant.py" "$SUT" "$d" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then ok "$label 夹具不变式: 空 schema 集合 ≡ 基线 [$outp]";
  else no "$label 夹具不变式被破坏（R3 会替 R1 顶红）: $outp"; fi
}

echo "═══════════════════════════════════════════════════════════════════════════"
echo "  #915 Q-1 · check-tool-args-delta（R1/R2/R3 · 只判变更集 ＋ 全树棘轮）"
echo "═══════════════════════════════════════════════════════════════════════════"

# ── T1 1 个合规工具变更 ⇒ rc0 + PASS changes=1 ──
D="$TMPROOT/t1"; mk_repo "$D"
cat >> "$D/src/agent/builtin-tools.ts" <<'TS'

export function registerT1(registry: ToolRegistry): void {
  registry.register({
    name: 't1_compliant_tool',
    description: '合规新工具（有 properties ＋ 有参 handler）',
    parameters: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
    handler: async (params) => ({ userId: params.userId }),
  });
}
TS
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 0 "T1 合规工具变更 ⇒ exit 0"
printf '%s' "$RUN_OUT" | grep -q 'TOOL-ARGS-DELTA: PASS changes=1' \
  && ok "T1 末行含 PASS changes=1" || no "T1 末行不合约: $RUN_OUT"
fixture_invariant "$D" "T1"

# ── T2 造空 schema 新工具（properties: {} ＋ `(params` handler）＋ 名写进夹具基线 ⇒ rc1 点名 R1 ──
D="$TMPROOT/t2"; mk_repo "$D"
cat >> "$D/src/agent/builtin-tools.ts" <<'TS'

export function registerT2(registry: ToolRegistry): void {
  registry.register({
    name: 't2_blank_tool',
    description: '空 schema ＋ 有形参 handler ⇒ R1 必红',
    parameters: { type: 'object', properties: {} },
    handler: async (params) => ({ ok: params }),
  });
}
TS
append_baseline "$D" 't2_blank_tool' '夹具：R1 判据用（空 schema ＋ 有形参 handler）'
( cd "$D" && git add -A )
runq "$D" --staged
echo "  ── T2 原始输出（CTO 红线②必贴证据）──"
printf '%s\n' "$RUN_OUT" | sed 's/^/     /'
assert_rc "$RUN_RC" 1 "T2 空 schema 新工具 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R1:' && ok "T2 输出含 ❌ R1:" || no "T2 未点名 R1: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -qE 'src/agent/builtin-tools\.ts:[0-9]+' \
  && ok "T2 点名 path:line" || no "T2 未点名 path:line: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 't2_blank_tool' && ok "T2 点名工具名" || no "T2 未点名工具名: $RUN_OUT"
fixture_invariant "$D" "T2"

# ── T2b 解构形参 `handler: async ({a})` ⇒ rc1 点名 R1（识别锚的 `({` 分支）──
D="$TMPROOT/t2b"; mk_repo "$D"
cat >> "$D/src/agent/builtin-tools.ts" <<'TS'

export function registerT2b(registry: ToolRegistry): void {
  registry.register({
    name: 't2b_blank_tool',
    description: '空 schema ＋ 解构形参 handler ⇒ R1 必红',
    parameters: { type: 'object', properties: {} },
    handler: async ({ mode }) => ({ mode }),
  });
}
TS
append_baseline "$D" 't2b_blank_tool' '夹具：R1 解构形参识别锚'
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T2b 解构形参 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R1:' && ok "T2b 输出含 ❌ R1:（({ 分支有效）" || no "T2b 未点名 R1: $RUN_OUT"
fixture_invariant "$D" "T2b"

# ── T2c 新工具落 src/tools/<x>-tools.ts ⇒ rc1 且点名该路径（证明过滤根含 src/tools/）──
D="$TMPROOT/t2c"; mk_repo "$D"
cat > "$D/src/tools/extra-tools.ts" <<'TS'
import type { ToolDefinition } from '../agent/tools';

export const t2cScanTool: ToolDefinition = {
  name: 't2c_blank_tool',
  description: '空 schema ＋ 有形参 handler（src/tools/ 前缀证明）',
  parameters: { type: 'object', properties: {} },
  handler: async (params) => ({ ok: params }),
};
TS
append_baseline "$D" 't2c_blank_tool' '夹具：src/tools/ 前缀证明用'
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T2c src/tools/ 前缀新工具 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R1: src/tools/extra-tools\.ts:' \
  && ok "T2c 点名 src/tools/extra-tools.ts:<行>" || no "T2c 未点名 src/tools/ 前缀: $RUN_OUT"
fixture_invariant "$D" "T2c"

# ── T3a builtin-tools.ts 里 `tool.handler(p)` 绕过 ⇒ rc1 点名 R2 ──
D="$TMPROOT/t3a"; mk_repo "$D"
cat >> "$D/src/agent/builtin-tools.ts" <<'TS'

export function t3aBypass(tool: { handler: (p: unknown) => unknown }, p: unknown): unknown {
  return tool.handler(p);
}
TS
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T3a 绕过 execute 调工具 handler ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R2:' && ok "T3a 输出含 ❌ R2:" || no "T3a 未点名 R2: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -qE '❌ R2: src/agent/builtin-tools\.ts:[0-9]+' \
  && ok "T3a 点名 src/agent/builtin-tools.ts:<行>" || no "T3a 未点名路径: $RUN_OUT"
fixture_invariant "$D" "T3a"

# ── T3b 单独 `--files vendor/…` ⇒ 该前缀的绕过也必红（证明 vendor 没被过滤根漏掉）──
D="$TMPROOT/t3b"; mk_repo "$D"
cat >> "$D/vendor/pandoc-skill/synova-tools.ts" <<'TS'

export function t3bBypass(tool: { handler: (p: unknown) => unknown }, p: unknown): unknown {
  return tool.handler(p);
}
TS
runq "$D" --files "vendor/pandoc-skill/synova-tools.ts"
assert_rc "$RUN_RC" 1 "T3b --files vendor/ 前缀 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R2: vendor/pandoc-skill/synova-tools\.ts:' \
  && ok "T3b 点名 vendor/pandoc-skill/synova-tools.ts:<行>" || no "T3b 未点名 vendor 前缀: $RUN_OUT"
fixture_invariant "$D" "T3b"

# ── T4 基线删掉一行（集合 ≠ 基线）⇒ rc1 点名 R3 ──
D="$TMPROOT/t4"; mk_repo "$D"
grep -v '^list_jobs |' "$D/scripts/control-tower/tool-args-baseline.txt" > "$TMPROOT/t4-base.txt"
mv "$TMPROOT/t4-base.txt" "$D/scripts/control-tower/tool-args-baseline.txt"
printf '\n// T4: 仅触达扫描面，不改任何工具定义\n' >> "$D/src/agent/builtin-tools.ts"
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T4 基线少一名 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R3:' && ok "T4 输出含 ❌ R3:" || no "T4 未点名 R3: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'list_jobs' && ok "T4 点名差异名单（list_jobs）" || no "T4 未点名差异: $RUN_OUT"

# ── T5 空变更集（只改 .md）⇒ rc0 ＋ SKIP ──
D="$TMPROOT/t5"; mk_repo "$D"
mkdir -p "$D/docs"; echo "# 文档" > "$D/docs/x.md"
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 0 "T5 纯文档变更 ⇒ exit 0（不适用 ≠ 看不见）"
printf '%s' "$RUN_OUT" | grep -q 'SKIP' && ok "T5 打印 SKIP" || no "T5 缺 SKIP 文案: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'TOOL-ARGS-DELTA: SKIP base=' && ok "T5 末行 TOOL-ARGS-DELTA: SKIP" || no "T5 末行不合约: $RUN_OUT"

# ── T5b `--files ""` ⇒ SKIP（**整体替换**语义；前提＝夹具仓自身有非空变更集）──
D="$TMPROOT/t5b"; mk_repo "$D"
cat >> "$D/src/agent/builtin-tools.ts" <<'TS'

export function registerT5b(registry: ToolRegistry): void {
  registry.register({
    name: 't5b_compliant_tool',
    description: '非空默认变更集（若 --files 实现成 append，本用例立刻红）',
    parameters: { type: 'object', properties: { orgId: { type: 'string' } }, required: ['orgId'] },
    handler: async (params) => ({ orgId: params.orgId }),
  });
}
TS
( cd "$D" && git add -A )
runq "$D" --files ""
assert_rc "$RUN_RC" 0 "T5b --files \"\" ⇒ exit 0"
printf '%s' "$RUN_OUT" | grep -q 'TOOL-ARGS-DELTA: SKIP' && ok "T5b 末行 SKIP（--files 是整体替换）" || no "T5b 未 SKIP（疑似 append）: $RUN_OUT"
# 反向锚：同一夹具仓用 --staged 必须非 SKIP（证明"有非空变更集"这个前提是真的）
runq "$D" --staged
printf '%s' "$RUN_OUT" | grep -q 'TOOL-ARGS-DELTA: PASS changes=1' \
  && ok "T5b 反向锚：同仓 --staged ⇒ PASS changes=1（前提成立）" || no "T5b 前提不成立: $RUN_OUT"

# ── T-neg 空 schema ＋ 真 zero-param handler ⇒ rc0（R1 不是"空 schema 一律红"的窄实现）──
D="$TMPROOT/tneg"; mk_repo "$D"
cat >> "$D/src/agent/builtin-tools.ts" <<'TS'

export function registerTNeg(registry: ToolRegistry): void {
  registry.register({
    name: 'tneg_nullary_tool',
    description: '真 nullary（handler 零形参）⇒ R1 不判',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ ok: true }),
  });
}
TS
append_baseline "$D" 'tneg_nullary_tool' '夹具：真 nullary 反例（R1 不得误红）'
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 0 "T-neg 空 schema ＋ 零形参 handler ⇒ exit 0"
printf '%s' "$RUN_OUT" | grep -q 'TOOL-ARGS-DELTA: PASS changes=1' \
  && ok "T-neg 末行 PASS changes=1" || no "T-neg 末行不合约: $RUN_OUT"
fixture_invariant "$D" "T-neg"

# ── T6 坏 base ⇒ rc2 ＋ E_BAD_BASE（不是泛化 E_USAGE）──
D="$TMPROOT/t6"; mk_repo "$D"
runq "$D" --base no-such-ref-xyz
assert_rc "$RUN_RC" 2 "T6 坏 base ⇒ exit 2（fail-closed）"
printf '%s' "$RUN_OUT" | grep -q 'E_BAD_BASE' && ok "T6 点名 E_BAD_BASE" || no "T6 未点名 E_BAD_BASE: $RUN_OUT"

# ── T7 --selfcheck ⇒ 末行精确 SELFCHECK-OK f1=1 f2=1 f3=1 f4=1 f5=1 clean=0（Q-5 新口径）──
D="$TMPROOT/t7"; mk_repo "$D"
runq "$D" --selfcheck
assert_rc "$RUN_RC" 0 "T7 --selfcheck ⇒ exit 0"
T7_LAST="$(printf '%s\n' "$RUN_OUT" | tail -1)"
[ "$T7_LAST" = "SELFCHECK-OK f1=1 f2=1 f3=1 f4=1 f5=1 clean=0" ] \
  && ok "T7 末行精确 SELFCHECK-OK f1=1 f2=1 f3=1 f4=1 f5=1 clean=0" || no "T7 末行实得: $T7_LAST"

md5of() { # <file> → md5 hex（跨平台: 用 python 算，禁依赖 md5/md5sum 差异）
  "$PYBIN" -c 'import hashlib,sys;print(hashlib.md5(open(sys.argv[1],"rb").read()).hexdigest())' "$1"
}

# ── T8 变异体（两臂）：R1 判据改恒空 ⇒ ① T2 场景翻绿 ② selfcheck 必须失败 ──
MUT="$TMPROOT/mut-r1.py"
"$PYBIN" - "$SUT" "$MUT" <<'PY'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
old = 'RE_HANDLER_PARAMS = re.compile(r"handler:\\s*(?:async\\s+)?\\(\\s*(?:\\{|[A-Za-z_$])")'
new = 'RE_HANDLER_PARAMS = re.compile(r"handler:\\s*__NEVER_MATCH__\\(\\s*(?:\\{|[A-Za-z_$])")'
assert old in src, "T8 变异锚缺失（R1 识别锚被改名 ⇒ 用例自身失准）"
open(sys.argv[2], "w", encoding="utf-8").write(src.replace(old, new))
PY
if [ "$(md5of "$SUT")" != "$(md5of "$MUT")" ]; then
  ok "T8 副本与原件 md5 不同（变异真的落地）"
else
  no "T8 副本与原件 md5 相同 ⇒ 变异未生效"
fi
( cd "$TMPROOT/t2" && "$PYBIN" "$MUT" --root . --staged > "$TMPROOT/t8a.out" 2>&1 ); T8A_RC=$?
[ "$T8A_RC" -eq 0 ] && ok "T8① 副本（R1 恒空）上 T2 场景 rc=0 ⇒ T2 的红由 R1 承重" \
  || no "T8① 副本上仍 rc=${T8A_RC}（期望 0）⇒ R1 未承重: $(tail -2 "$TMPROOT/t8a.out")"
( cd "$TMPROOT/t2" && "$PYBIN" "$MUT" --root . --selfcheck > "$TMPROOT/t8b.out" 2>&1 ); T8B_RC=$?
printf '%s' "$(cat "$TMPROOT/t8b.out")" | grep -q 'SELFCHECK-FAIL' \
  && ok "T8② 副本 --selfcheck 报 SELFCHECK-FAIL（'同一函数'成为判据）" \
  || no "T8② 副本 selfcheck 未失败: $(cat "$TMPROOT/t8b.out")"
[ "$T8B_RC" -ne 0 ] && ok "T8② 副本 --selfcheck 非 0（rc=${T8B_RC}）" || no "T8② 副本 selfcheck rc=0"

# ── T8b 变异体（R2 恒空）⇒ T3a 场景翻绿 ⇒ R2 承重（M3 的常驻化）──
MUT2="$TMPROOT/mut-r2.py"
"$PYBIN" - "$SUT" "$MUT2" <<'PY'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
old = 'RE_HANDLER_CALL = re.compile(r"\\.handler\\s*\\(")'
new = 'RE_HANDLER_CALL = re.compile(r"\\.__NEVER_MATCH__handler\\s*\\(")'
assert old in src, "T8b 变异锚缺失（R2 识别锚被改名 ⇒ 用例自身失准）"
open(sys.argv[2], "w", encoding="utf-8").write(src.replace(old, new))
PY
if [ "$(md5of "$SUT")" != "$(md5of "$MUT2")" ]; then
  ok "T8b 副本与原件 md5 不同"
else
  no "T8b 副本与原件 md5 相同 ⇒ 变异未生效"
fi
( cd "$TMPROOT/t3a" && "$PYBIN" "$MUT2" --root . --staged > "$TMPROOT/t8c.out" 2>&1 ); T8C_RC=$?
[ "$T8C_RC" -eq 0 ] && ok "T8b 副本（R2 恒空）上 T3a 场景 rc=0 ⇒ T3a 的红由 R2 承重" \
  || no "T8b 副本上仍 rc=${T8C_RC}（期望 0）⇒ R2 未承重: $(tail -2 "$TMPROOT/t8c.out")"

# ═══ T9 生产接线（七条）═══════════════════════════════════════════════════════
# ① 剥注释后 pre-commit 真调用本脚本
T9_N="$(grep -vE '^[[:space:]]*#' "$PC" | grep -c 'check-tool-args-delta')"; T9_N="${T9_N:-0}"
[ "$T9_N" -ge 1 ] && ok "T9① pre-commit 剥注释后真调用 check-tool-args-delta（$T9_N 处）" \
  || no "T9① pre-commit 未调用（剥注释后 0 处）"

# 提取附加块（到顶层 `fi` 收口）+ pre-commit 的真 helper（禁复制粘贴语义）
sed -n '/^# ═══ #915 Q-1: 工具入参校验增量闸/,/^fi$/p' "$PC" > "$TMPROOT/tad-block.sh"
[ "$(grep -c . "$TMPROOT/tad-block.sh")" -ge 10 ] && ok "T9 附加块提取成功（$(grep -c . "$TMPROOT/tad-block.sh") 行）" \
  || no "T9 附加块提取失败/过短"

# ② 该块调用含 --staged
grep -q -- '--staged' "$TMPROOT/tad-block.sh" && ok "T9② 该块调用含 --staged（本地判暂存区）" \
  || no "T9② 该块缺 --staged"
# ③ 失败路径 hard_check、不含 v5_soft
if grep -q 'hard_check' "$TMPROOT/tad-block.sh" && ! grep -q 'v5_soft' "$TMPROOT/tad-block.sh"; then
  ok "T9③ 失败路径用 hard_check 且无 v5_soft"
else
  no "T9③ 失败路径不合规（hard_check 缺失或误用 v5_soft）"
fi

# ④ CI 步 ①i：跑块含 resolve-ci-base.sh ＋ `|| exit $?`；落位 > ①f 末行且两者之间无 job 头
"$PYBIN" - "$WF" "$TMPROOT/ci-1i-run.sh" <<'PY'
import re
import sys

lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
JOB = re.compile(r"^  [a-z0-9_-]+:$")
STEP = re.compile(r"^      - name:")
i = next((k for k, l in enumerate(lines) if l.strip().startswith("- name: ①i")), -1)
f = next((k for k, l in enumerate(lines) if l.strip().startswith("- name: ①f")), -1)
assert i >= 0, "缺 ①i 步"
assert f >= 0, "缺 ①f 步"
j = f + 1
while j < len(lines) and not (STEP.match(lines[j]) or JOB.match(lines[j])):
    j += 1
f_last = j - 1
assert i > f_last, "①i 落位不在 ①f 之后（①i=%d ①f末行=%d）" % (i + 1, f_last + 1)
assert not any(JOB.match(lines[k]) for k in range(f_last + 1, i)), "①f 与 ①i 之间夹着 job 头"
k = i + 1
while k < len(lines) and not (STEP.match(lines[k]) or JOB.match(lines[k])):
    k += 1
run = "\n".join(lines[i:k])
assert "resolve-ci-base.sh" in run, "①i run 块缺 resolve-ci-base.sh"
assert "|| exit $?" in run, "①i run 块缺 `|| exit $?`（三态原样透传）"
open(sys.argv[2], "w", encoding="utf-8").write(run + "\n")
print("①i=第%d行 ①f末行=第%d行" % (i + 1, f_last + 1))
PY
if [ $? -eq 0 ]; then ok "T9④ CI ①i 落位（①f 之后、无 job 头）＋ resolve-ci-base.sh ＋ || exit \$?"; \
else no "T9④ CI ①i 落位/三态透传不合规"; fi

# ⑤/⑥ 桩：rc1 无 ❌ / rc2 无 ERROR / 脚本缺失 ⇒ pre-commit 块都必须硬阻断
extract_helpers() {
  sed -n '/^hard_check()/,/^}/p' "$PC"
  sed -n '/^soft_pass()/,/^}/p' "$PC"
  sed -n '/^log_gate()/,/^}/p' "$PC"
  sed -n '/^self_fail_missing_script()/,/^}/p' "$PC"
  echo 'HARD_FAIL=0; SOFT_COUNT=0; WARN_COUNT=0; QUIET_SUCCESS=0'
  echo "RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'"
}

run_pc_block() { # <repo_dir> [ENV=VAL ...] → PC_OUT / PC_RC（模拟 pre-commit 末尾：任一硬红 ⇒ exit 1）
  local d="$1"; shift
  local body
  body="$(extract_helpers)
$(cat "$TMPROOT/tad-block.sh")
if [ \"\${HARD_FAIL:-0}\" -eq 0 ]; then exit 0; else exit 1; fi"
  PC_OUT="$( cd "$d" && env ROOT="$d" GATE_HITS_LOG="$GATE_HITS_LOG" _GATE_BRANCH=test "$@" \
      bash -c "$body" 2>&1 )"; PC_RC=$?
}

mk_stub() { # <dir> <exit_code> <msg>
  local d="$1" code="$2" msg="$3"
  mkdir -p "$d/scripts/control-tower"
  { echo 'import sys'; printf 'print("%s")\n' "$msg"; printf 'sys.exit(%s)\n' "$code"; } \
    > "$d/scripts/control-tower/check-tool-args-delta.py"
}

S5="$TMPROOT/stub5"; mk_stub "$S5" 1 "stub rc=1 without cross marker"
run_pc_block "$S5"
assert_rc "$PC_RC" 1 "T9⑤ 闸 rc=1 但无 ❌ 行 ⇒ pre-commit 仍硬阻断"
printf '%s' "$PC_OUT" | grep -q '输出格式违约' && ok "T9⑤ 打出非空兜底消息（防 hard_check 空消息打绿）" \
  || no "T9⑤ 未走兜底: $PC_OUT"

S6="$TMPROOT/stub6"; mk_stub "$S6" 2 "stub rc=2 without error marker"
run_pc_block "$S6"
assert_rc "$PC_RC" 1 "T9⑥a 闸 rc=2 但无 ERROR/degraded ⇒ 仍硬阻断（fail-closed）"
printf '%s' "$PC_OUT" | grep -q '按检查自身失败阻断' && ok "T9⑥a 打出 rc≥2 兜底消息" \
  || no "T9⑥a 未走兜底: $PC_OUT"

S6B="$TMPROOT/stub6b"; mkdir -p "$S6B/scripts/control-tower"
run_pc_block "$S6B"
assert_rc "$PC_RC" 1 "T9⑥b 闸脚本不存在 ⇒ 仍硬阻断"
printf '%s' "$PC_OUT" | grep -q '检查自身失败（脚本缺失' && ok "T9⑥b 点名脚本缺失（self_fail_missing_script）" \
  || no "T9⑥b 未点名脚本缺失: $PC_OUT"

# ⑦ CI ①i 真逃生舱：置 0 ⇒ rc=0 且打 ℹ️ 行；且判断在 resolve-ci-base.sh 之前
"$PYBIN" - "$TMPROOT/ci-1i-run.sh" "$TMPROOT/ci-1i-escape.sh" <<'PY'
import sys

lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
start = next((k for k, l in enumerate(lines)
              if "SYNO_TOOL_ARGS_DELTA" in l and l.lstrip().startswith("if ")), -1)
assert start >= 0, "①i run 块缺 SYNO_TOOL_ARGS_DELTA 逃生舱判断"
end = next((k for k in range(start + 1, len(lines)) if lines[k].strip() == "fi"), -1)
assert end > start, "逃生舱 if 未闭合"
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(lines[start:end + 1]) + "\n")
PY
if [ $? -eq 0 ]; then ok "T9⑦a CI ①i run 块有 SYNO_TOOL_ARGS_DELTA 逃生舱 if 段"; \
else no "T9⑦a CI ①i 缺逃生舱"; fi
ESC_OUT="$(SYNO_TOOL_ARGS_DELTA=0 bash "$TMPROOT/ci-1i-escape.sh" 2>&1)"; ESC_RC=$?
assert_rc "$ESC_RC" 0 "T9⑦b 置 SYNO_TOOL_ARGS_DELTA=0 跑逃生舱段 ⇒ exit 0"
printf '%s' "$ESC_OUT" | grep -q 'ℹ️' && ok "T9⑦b 打 ℹ️ 回滚行: $ESC_OUT" || no "T9⑦b 缺 ℹ️ 行: $ESC_OUT"
if grep -q 'resolve-ci-base.sh' "$TMPROOT/ci-1i-escape.sh"; then
  no "T9⑦c 逃生舱段内含 resolve-ci-base.sh（应先判断再解析 base）"
else
  # 🔴 只看**命令行**（注释里提到 resolve-ci-base.sh 不算执行时机）
  ESC_POS="$("$PYBIN" - "$TMPROOT/ci-1i-run.sh" <<'PYX'
import sys

lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
esc = next(k for k, l in enumerate(lines)
           if "SYNO_TOOL_ARGS_DELTA" in l and l.lstrip().startswith("if "))
base = next(k for k, l in enumerate(lines)
            if l.strip().startswith("BASE=") and "resolve-ci-base.sh" in l)
print("True" if esc < base else "False")
PYX
)"
  [ "$ESC_POS" = "True" ] && ok "T9⑦c 逃生舱判断位于 resolve-ci-base.sh 之前" \
    || no "T9⑦c 顺序不合规（逃生舱应在 base 解析之前）"
fi

# ── T10 --json：stdout 仅一份合法 JSON；status/changed/violations 与文本路径一致；违规亦 rc1 ──
D="$TMPROOT/t10"; mk_repo "$D"
cat >> "$D/src/agent/builtin-tools.ts" <<'TS'

export function registerT10(registry: ToolRegistry): void {
  registry.register({
    name: 't10_compliant_tool',
    description: '合规（--json 一致性用）',
    parameters: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
    handler: async (params) => ({ userId: params.userId }),
  });
}
TS
( cd "$D" && git add -A )
runq "$D" --staged; T10_TXT="$RUN_OUT"; T10_RC_TXT=$RUN_RC
printf '%s\n' "$T10_TXT" > "$TMPROOT/t10-text.out"
runq "$D" --staged --json; T10_RC=$?
printf '%s\n' "$RUN_OUT" > "$TMPROOT/t10-json.out"
assert_rc "$T10_RC_TXT" 0 "T10 文本路径 exit 0"
assert_rc "$T10_RC" 0 "T10 --json exit 0"
if "$PYBIN" - "$TMPROOT/t10-json.out" "$TMPROOT/t10-text.out" <<'PY'
import json
import re
import sys

raw = open(sys.argv[1], encoding="utf-8").read().strip()
obj = json.loads(raw)          # 必须是**一份**合法 JSON（多份会在这里炸）
assert set(obj) == {"status", "base", "changed", "violations", "rules"}, sorted(obj)
text = open(sys.argv[2], encoding="utf-8").read()
m = re.search(r"TOOL-ARGS-DELTA: PASS changes=(\d+) rules=R1,R2,R3,R4,R5,R6", text)
assert m, "文本路径末行不合约"
assert obj["status"] == "PASS", obj["status"]
assert obj["changed"] == int(m.group(1)), (obj["changed"], m.group(1))
assert obj["violations"] == [], obj["violations"]
assert obj["rules"] == ["R1", "R2", "R3", "R4", "R5", "R6"], obj["rules"]
PY
then ok "T10 JSON 键固定/合法且 status·changed·violations 与文本一致"; else no "T10 JSON 与文本不一致"; fi
runq "$TMPROOT/t2" --staged --json; T10V_RC=$RUN_RC
printf '%s\n' "$RUN_OUT" > "$TMPROOT/t10-json-bad.out"
assert_rc "$T10V_RC" 1 "T10 违规场景 --json 也 rc=1"
if "$PYBIN" - "$TMPROOT/t10-json-bad.out" <<'PY'
import json
import sys

obj = json.loads(open(sys.argv[1], encoding="utf-8").read().strip())
assert obj["status"] == "VIOLATIONS", obj["status"]
assert any(v["rule"] == "R1" for v in obj["violations"]), obj["violations"]
PY
then ok "T10 违规场景 JSON status=VIOLATIONS＋R1 逐条"; else no "T10 违规场景 JSON 不合约"; fi

# ── T11 非扫描面文件（job.handler/command.handler）⇒ SKIP（不误红）──
D="$TMPROOT/t11"; mk_repo "$D"
runq "$D" --files "src/cron/scheduler.ts src/cli-manager.ts"
assert_rc "$RUN_RC" 0 "T11 非三前缀文件 ⇒ exit 0（不误红）"
printf '%s' "$RUN_OUT" | grep -q 'TOOL-ARGS-DELTA: SKIP' && ok "T11 末行 SKIP（非 R1/R2/R3 判绿）" \
  || no "T11 末行非 SKIP: $RUN_OUT"

# ── T12 交叉对账：闸自带 R3 取数口 vs 基线登记集合；改错一行 ⇒ rc1 ──
D="$TMPROOT/t12"; mk_repo "$D"
if "$PYBIN" "$TMPROOT/invariant.py" "$SUT" "$D" > "$TMPROOT/t12-eq.out" 2>&1; then
  ok "T12 交叉对账：R3 取数口集合 == 基线登记集合 [$("$PYBIN" -c 'print(open("'"$TMPROOT"'/t12-eq.out",encoding="utf-8").read().strip())')]"
else
  no "T12 交叉对账不相等: $(cat "$TMPROOT/t12-eq.out")"
fi
append_baseline "$D" 'no_such_tool' '夹具：基线改错一行'
printf '\n// T12: 触达扫描面\n' >> "$D/src/agent/builtin-tools.ts"
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T12 基线改错一行 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q 'no_such_tool' && ok "T12 点名错行（no_such_tool）" || no "T12 未点名错行: $RUN_OUT"

# ── T13 pre-commit 块真逃生舱：SYNO_TOOL_ARGS_DELTA=0 ⇒ ℹ️ ＋ rc0 ──
run_pc_block "$S5" SYNO_TOOL_ARGS_DELTA=0
assert_rc "$PC_RC" 0 "T13 置 SYNO_TOOL_ARGS_DELTA=0 跑 pre-commit 块 ⇒ exit 0"
printf '%s' "$PC_OUT" | grep -q '回滚态（SYNO_TOOL_ARGS_DELTA=0）' && ok "T13 打回滚 ℹ️ 行" \
  || no "T13 缺回滚 ℹ️ 行: $PC_OUT"
# 反向锚：不置 0 时同一桩必须阻断（证明 T13 的 rc0 是逃生舱给的，不是桩失效）
run_pc_block "$S5"
assert_rc "$PC_RC" 1 "T13 反向锚：不置 0 ⇒ 同一桩仍阻断"

# ═══ #915 Q-5 扩展（R4/R5/R6 · 规格 §5.2 T14–T22 · 裁 365）════════════════════

# ── T14 新增 mutating 工具、handler 无 ctx/无检查 ⇒ rc1 点名 R4（登记进信号基线 ⇒ R5 不顶红）──
D="$TMPROOT/t14"; mk_repo "$D"
cat >> "$D/src/agent/builtin-tools.ts" <<'TS'

export function registerT14(registry: ToolRegistry): void {
  registry.register({
    name: 't14_mutating_tool',
    description: 'mutating 工具无 ctx/无取消检查 ⇒ R4 必红',
    parameters: { type: 'object', properties: { job: { type: 'string' } }, required: ['job'] },
    operationType: 'write',
    sideEffects: 'mutating',
    handler: async (params) => ({ job: params.job }),
  });
}
TS
# 不登记进信号基线：R4 与 R5 共用同一副作用谓词 —— T21 变异体（谓词恒空）下
# 两条规则同静默 ⇒ 副本 rc=0（若登记，R5「少」臂会在副本上顶红，T21① 不可达）
( cd "$D" && git add -A )
runq "$D" --staged
echo "  ── T14 原始输出（CTO 红线②必贴证据）──"
printf '%s\n' "$RUN_OUT" | sed 's/^/     /'
assert_rc "$RUN_RC" 1 "T14 mutating 工具无 ctx/检查 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R4:' && ok "T14 输出含 ❌ R4:" || no "T14 未点名 R4: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -qE '❌ R4: src/agent/builtin-tools\.ts:[0-9]+' \
  && ok "T14 点名 path:line" || no "T14 未点名 path:line: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 't14_mutating_tool' && ok "T14 点名工具名" || no "T14 未点名工具名: $RUN_OUT"
fixture_invariant "$D" "T14"

# ── T15 同上但 handler 有 ctx 且 ctx?.signal?.throwIfAborted() ⇒ rc0（正例；防"一律红"）──
D="$TMPROOT/t15"; mk_repo "$D"
cat >> "$D/src/agent/builtin-tools.ts" <<'TS'

export function registerT15(registry: ToolRegistry): void {
  registry.register({
    name: 't15_mutating_ok',
    description: 'mutating 工具有 ctx ＋ throwIfAborted ⇒ R4 不红（正例）',
    parameters: { type: 'object', properties: { job: { type: 'string' } }, required: ['job'] },
    operationType: 'write',
    sideEffects: 'mutating',
    handler: async (params, ctx) => {
      ctx?.signal?.throwIfAborted();
      return { job: params.job };
    },
  });
}
TS
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 0 "T15 mutating 工具有 ctx＋检查 ⇒ exit 0"
printf '%s' "$RUN_OUT" | grep -q 'TOOL-ARGS-DELTA: PASS changes=1' \
  && ok "T15 末行 PASS changes=1（R4 不是一律红）" || no "T15 末行不合约: $RUN_OUT"
fixture_invariant "$D" "T15"

# ── T16 信号基线少一行（修好未删登记）⇒ rc1 点名 R5（双向棘轮的"少"臂）──
D="$TMPROOT/t16"; mk_repo "$D"
append_signal_baseline "$D" 'ghost_fixed_tool' '夹具：信号基线登记树中已无者（修好未删登记）'
printf '\n// T16: 触达扫描面，不改任何工具定义\n' >> "$D/src/agent/builtin-tools.ts"
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T16 信号基线少一行 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R5:' && ok "T16 输出含 ❌ R5:" || no "T16 未点名 R5: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 'ghost_fixed_tool' && ok "T16 点名差异名单（ghost_fixed_tool）" \
  || no "T16 未点名差异: $RUN_OUT"

# ── T17 信号基线多一行（未登记的新副作用工具）⇒ rc1 点名 R5（双向棘轮的"多"臂）──
D="$TMPROOT/t17"; mk_repo "$D"
cat >> "$D/src/agent/builtin-tools.ts" <<'TS'

export function registerT17(registry: ToolRegistry): void {
  registry.register({
    name: 't17_unregistered_side_tool',
    description: 'mutating 工具无检查且未登记 ⇒ R5 必红（集合多一名）',
    parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
    operationType: 'write',
    handler: async (params) => ({ x: params.x }),
  });
}
TS
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T17 未登记的新副作用工具 ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -q '❌ R5:' && ok "T17 输出含 ❌ R5:" || no "T17 未点名 R5: $RUN_OUT"
printf '%s' "$RUN_OUT" | grep -q 't17_unregistered_side_tool' \
  && ok "T17 点名差异名单（t17_unregistered_side_tool）" || no "T17 未点名差异: $RUN_OUT"

# ── T18 src/agent/<夹具>.ts 里 2 参 execute 调用 ⇒ rc1 点名 R6 path:line ──
D="$TMPROOT/t18"; mk_repo "$D"
cat > "$D/src/agent/executor-fixture.ts" <<'TS'
export async function t18Call(
  registry: { execute: (a: string, b: unknown) => Promise<unknown> },
  name: string,
  params: unknown,
): Promise<unknown> {
  return registry.execute(name, params);
}
TS
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 1 "T18 src/agent 内 2 参 execute ⇒ exit 1"
printf '%s' "$RUN_OUT" | grep -qE '❌ R6: src/agent/executor-fixture\.ts:[0-9]+' \
  && ok "T18 点名 ❌ R6: src/agent/executor-fixture.ts:<行>" || no "T18 未点名 R6: $RUN_OUT"

# ── T19 3 参调用（{signal}）⇒ rc0 ──
D="$TMPROOT/t19"; mk_repo "$D"
cat > "$D/src/agent/executor-fixture.ts" <<'TS'
export async function t19Call(
  registry: {
    execute: (a: string, b: unknown, c?: { signal?: AbortSignal }) => Promise<unknown>;
  },
  name: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return registry.execute(name, params, { signal });
}
TS
( cd "$D" && git add -A )
runq "$D" --staged
assert_rc "$RUN_RC" 0 "T19 3 参 execute 调用 ⇒ exit 0"
printf '%s' "$RUN_OUT" | grep -q 'TOOL-ARGS-DELTA: PASS changes=1' \
  && ok "T19 末行 PASS changes=1" || no "T19 末行不合约: $RUN_OUT"

# ── T20 --selfcheck ⇒ 末行精确 SELFCHECK-OK f1=1 f2=1 f3=1 f4=1 f5=1 clean=0 ──
D="$TMPROOT/t20"; mk_repo "$D"
runq "$D" --selfcheck
assert_rc "$RUN_RC" 0 "T20 --selfcheck ⇒ exit 0"
T20_LAST="$(printf '%s\n' "$RUN_OUT" | tail -1)"
[ "$T20_LAST" = "SELFCHECK-OK f1=1 f2=1 f3=1 f4=1 f5=1 clean=0" ] \
  && ok "T20 末行精确 SELFCHECK-OK f1=1 f2=1 f3=1 f4=1 f5=1 clean=0" || no "T20 末行实得: $T20_LAST"

# ── T21 变异体（两臂）：R4 判据恒空 ⇒ ① T14 场景翻绿（-eq 0，不收 rc=2）② selfcheck f4 必失败 ──
MUT4="$TMPROOT/mut-r4.py"
"$PYBIN" - "$SUT" "$MUT4" <<'PY'
import sys

src = open(sys.argv[1], encoding="utf-8").read()
lines = src.splitlines(True)
hit = 0
for i, l in enumerate(lines):
    if l.startswith("RE_SIDE_EFFECT = re.compile("):
        lines[i] = 'RE_SIDE_EFFECT = re.compile(r"__NEVER_MATCH__")\n'
        hit += 1
assert hit == 1, "T21 变异锚缺失或多处（RE_SIDE_EFFECT 命中 %d 处）" % hit
open(sys.argv[2], "w", encoding="utf-8").write("".join(lines))
PY
if [ "$(md5of "$SUT")" != "$(md5of "$MUT4")" ]; then
  ok "T21 副本与原件 md5 不同（变异真的落地）"
else
  no "T21 副本与原件 md5 相同 ⇒ 变异未生效"
fi
( cd "$TMPROOT/t14" && "$PYBIN" "$MUT4" --root . --staged > "$TMPROOT/t21a.out" 2>&1 ); T21A_RC=$?
[ "$T21A_RC" -eq 0 ] && ok "T21① 副本（R4 恒空）上 T14 场景 rc=0 ⇒ T14 的红由 R4 承重" \
  || no "T21① 副本上仍 rc=${T21A_RC}（期望 0）⇒ R4 未承重: $(tail -2 "$TMPROOT/t21a.out")"
( cd "$TMPROOT/t14" && "$PYBIN" "$MUT4" --root . --selfcheck > "$TMPROOT/t21b.out" 2>&1 ); T21B_RC=$?
printf '%s' "$(cat "$TMPROOT/t21b.out")" | grep -q 'SELFCHECK-FAIL' \
  && ok "T21② 副本 --selfcheck 报 SELFCHECK-FAIL（f4 失败：'同一函数'成为判据）" \
  || no "T21② 副本 selfcheck 未失败: $(cat "$TMPROOT/t21b.out")"
[ "$T21B_RC" -ne 0 ] && ok "T21② 副本 --selfcheck 非 0（rc=${T21B_RC}）" || no "T21② 副本 selfcheck rc=0"

# ═══ T22 生产接线（复用既有，三条；不新增 CI 步/PC 块）════════════════════════
# ① 剥注释后 pre-commit 真调用本脚本（同 T9① 口径的独立复查）
T22_N="$(grep -vE '^[[:space:]]*#' "$PC" | grep -c 'check-tool-args-delta')"; T22_N="${T22_N:-0}"
[ "$T22_N" -ge 1 ] && ok "T22① pre-commit 剥注释后真调用 check-tool-args-delta（$T22_N 处）" \
  || no "T22① pre-commit 未调用（剥注释后 0 处）"
# ② CI 步 ①i run 块含该脚本
sed -n '/- name: ①i/,/- name:/p' "$WF" > "$TMPROOT/t22-1i.txt"
if grep -q 'check-tool-args-delta' "$TMPROOT/t22-1i.txt"; then
  ok "T22② CI ①i run 块含 check-tool-args-delta"
else
  no "T22② CI ①i run 块缺 check-tool-args-delta"
fi
# ③ 不新增 CI 步：workflow 中出现次数与 gitea/local-main 版本相同
T22_CUR="$(grep -c 'check-tool-args-delta' "$WF")"
T22_OLD="$(git -C "$REPO" show gitea/local-main:.gitea/workflows/local-gates.yml 2>/dev/null | grep -c 'check-tool-args-delta')"
[ "$T22_CUR" = "$T22_OLD" ] \
  && ok "T22③ workflow 出现次数未变（$T22_CUR == $T22_OLD ⇒ 无新 CI 步）" \
  || no "T22③ workflow 出现次数变了（${T22_CUR} != ${T22_OLD}）⇒ 疑似新增 CI 步"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
