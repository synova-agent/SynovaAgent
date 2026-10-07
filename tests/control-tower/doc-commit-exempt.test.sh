#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# doc-commit-exempt.test.sh — CT-34 (D387) 纯文档提交豁免门禁测试
#
# 背景: 纯文档提交（dev doc / task brief / 审计报告 / memory / task-state）
# 被 13 组面向代码的 pre-commit 门禁误拦（组 6 时间戳残留 / G12b 鸡生蛋 /
# 组 1b 扫 .html / 组 7b 无条件 validate-expert-config）→ --no-verify 根因。
# 修复: pre-commit 按提交内容分流 — 纯文档仅 Secrets 扫描 (D312 保留),
#       混合提交 / 配置文件 / 技能文件 / 空暂存 → 全量 13 组 (fail-closed, D328)。
#
# 覆盖（铁律 48: 正常/降级/边界; 铁律 0-2: red→green; 12 用例 T1-T12）:
#   T1  纯 docs/ 提交端到端（注入缝跑真实脚本）→ 豁免标记
#   T2  纯 brief 提交端到端（鸡生蛋解除）→ 豁免标记
#   T3  混合提交（文档+代码）函数单测 → 0（不豁免）
#   T4  task-state 提交端到端 → 豁免标记（task-state/ 进白名单）
#   T5  根级 md 端到端 → 豁免标记
#   T6  配置文件 .claude/settings.json 函数单测 → 0（fail-closed, D312）
#   T7  文档含 secret 端到端（降级）→ Secrets 拒绝标记（Secrets 保留）
#   T8  生产接线（wire check）is_doc_only 定义 + 调用 ≥2
#   T9  GATEKEEPER bypass 阻断行号 < is_doc_only 定义行号（绕过审计先于豁免）
#   T10 空暂存集函数单测（边界）→ 0（fail-closed）
#   T11 G12c check-dev-doc-write-set.sh 保留全量路径（D383 P1-1 不回退）
#   T12 技能文件函数单测（.dsh/skills + .claude/skills）→ 0（D370 契约不被绕过）
#   附: 白名单正则正反矩阵（10 应豁免 / 10 应拒绝，含 docs/ 下 .ts 防藏代码）
#
# 测试策略（对齐双先例）:
#   - 函数单测（T3/T6/T10/T12）: today-by-name.test.sh 模式 —
#     sed 提取生产函数体 + eval 单测, 零真实 git 操作, 确定性
#   - 端到端（T1/T2/T4/T5/T7）: secrets-env-exempt.test.sh 模式 —
#     SYNO_GIT_CACHED_* 注入缝控制暂存集 + SYNO_SECRETS_ROOT 沙箱
#     跑真实 pre-commit-check.sh 早退路径（仅 secrets, 快）
#   - T1/T7 只断言输出标记, 不硬断言 exit code（D316 环境依赖陷阱:
#     GATEKEEPER 行为依赖真实 .claude/bypass.log）
#
# 隔离: mktemp 沙箱 + SYNO_SECRETS_ROOT 注入, 零真实目录零网络。
# 用法: bash tests/control-tower/doc-commit-exempt.test.sh
# 退出码: 0 = 全部通过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRECOMMIT="$REPO_DIR/scripts/pre-commit-check.sh"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
check() { # check <描述> <期望> <实际>
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (期望 [$2] 实际 [$3])"; fi
}

# ── 0. GATEKEEPER 环境提示（诊断辅助, 不阻断）──
TODAY=$(date +%Y-%m-%d)
TODAY_BYPASS=$(grep -c "${TODAY}.*detected-bypass" "$REPO_DIR/.claude/bypass.log" 2>/dev/null | tr -d '\n\r' || echo 0)
if [ "${TODAY_BYPASS:-0}" -gt 0 ]; then
  echo "⚠ 提示: 今日 ${TODAY_BYPASS} 次 detected-bypass 记录 — GATEKEEPER 将硬阻断早退路径,"
  echo "  端到端用例 (T1/T2/T4/T5/T7) 可能失败 (环境状态, 非代码缺陷)。"
fi

# ── 1. 提取生产函数体（RED: 实现前提取为空 → 本组失败）──
echo ""
echo "── 1. 生产定义提取 ──"
DOC_RE=$(grep -n '^DOC_PREFIX_RE=' "$PRECOMMIT" | head -1 | cut -d: -f2- || true)
DOC_FN=$(sed -n '/^is_doc_only()/,/^}/p' "$PRECOMMIT" || true)

if [ -n "$DOC_RE" ]; then pass "pre-commit-check.sh 定义 DOC_PREFIX_RE"; else fail "pre-commit-check.sh 未定义 DOC_PREFIX_RE (RED: 提取为空)"; fi
if [ -n "$DOC_FN" ]; then pass "pre-commit-check.sh 定义 is_doc_only"; else fail "pre-commit-check.sh 未定义 is_doc_only (RED: 提取为空)"; fi

# 语法自检: 提取的判定代码 bash -n 必须合法
SYNTAX_FILE=$(mktemp)
printf '%s\n%s\n' "$DOC_RE" "$DOC_FN" > "$SYNTAX_FILE"
if bash -n "$SYNTAX_FILE"; then pass "提取的判定代码 bash -n 语法合法"; else fail "提取的判定代码语法错误 (见上方 stderr)"; fi
rm -f "$SYNTAX_FILE"

if [ -z "$DOC_RE" ] || [ -z "$DOC_FN" ]; then
  echo ""
  echo "RED: 生产脚本尚未实现 is_doc_only/DOC_PREFIX_RE — 先实现 (dev doc §7.1 测试优先)"
  echo "结果: 通过 $PASS / 失败 $FAIL"
  exit 1
fi

eval "$DOC_RE"
eval "$DOC_FN"

# ── 2. 函数单测（T3/T6/T10/T12 — 零真实 git, 确定性）──
echo ""
echo "── 2. is_doc_only 函数单测 ──"
OUT3=$(is_doc_only "$(printf 'docs/x.md\nsrc/y.ts')")
check "T3: 混合提交(文档+代码) → 0 (不豁免)" "0" "$OUT3"

OUT6=$(is_doc_only '.claude/settings.json')
check "T6: 配置文件 .claude/settings.json → 0 (fail-closed, D312)" "0" "$OUT6"

OUT10=$(is_doc_only '')
check "T10: 空暂存集 → 0 (fail-closed, 走全量)" "0" "$OUT10"

OUT12A=$(is_doc_only '.dsh/skills/test/SKILL.md')
check "T12a: .dsh/skills → 0 (D370 同步契约不被绕过)" "0" "$OUT12A"
OUT12B=$(is_doc_only '.claude/skills/test/SKILL.md')
check "T12b: .claude/skills → 0 (技能=行为配置, 组 13 照跑)" "0" "$OUT12B"

# 白名单正则正反矩阵（增强: dev doc 自检清单 10 应豁免 + 10 应拒绝）
echo ""
echo "── 2b. 白名单正则矩阵 ──"
DOC_OK_PATHS='docs/plans/x.md
docs/report.html
docs/notes.txt
.claude/task-briefs/D387-test.md
.claude/task-briefs/sub/x.md
memory/lessons.md
task-state/D387.json
task-state/README.md
README.md
CHANGELOG.md'
DOC_NO_PATHS='docs/secret.ts
docs/code.json
src/y.ts
.claude/settings.json
.claude/skills/test/SKILL.md
.dsh/skills/test/SKILL.md
.codex/contracts/x.json
.github/workflows/ci.yml
scripts/x.sh
tests/x.test.ts'
MATRIX_OK=0
MATRIX_NO=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  R=$(is_doc_only "$p")
  if [ "$R" = "1" ]; then MATRIX_OK=$((MATRIX_OK + 1)); else fail "矩阵应豁免但拒绝: $p"; fi
done <<< "$DOC_OK_PATHS"
while IFS= read -r p; do
  [ -z "$p" ] && continue
  R=$(is_doc_only "$p")
  if [ "$R" = "0" ]; then MATRIX_NO=$((MATRIX_NO + 1)); else fail "矩阵应拒绝但豁免: $p"; fi
done <<< "$DOC_NO_PATHS"
if [ "$MATRIX_OK" -eq 10 ] && [ "$MATRIX_NO" -eq 10 ]; then
  pass "矩阵: 10/10 应豁免全匹配 + 10/10 应拒绝全拒绝"
else
  fail "矩阵: 应豁免=$MATRIX_OK/10 应拒绝=$MATRIX_NO/10"
fi

# ── 3. 端到端（T1/T2/T4/T5/T7 — 注入缝跑真实脚本早退路径）──
echo ""
echo "── 3. 端到端早退路径 ──"
SANDBOX=$(mktemp -d /tmp/doc-exempt.XXXXXX)
trap 'rm -rf "$SANDBOX"' EXIT
git -C "$SANDBOX" init -q 2>/dev/null || git init -q "$SANDBOX"
git -C "$SANDBOX" config user.email t@t
git -C "$SANDBOX" config user.name t

RUN_PRECOMMIT() { # RUN_PRECOMMIT <staged_names>
  # D390 (CT-P1-1): 武装守卫 — 注入缝需 SYNO_TEST_ARM=1 才生效（生产缝关闭）
  SYNO_TEST_ARM=1 \
  SYNO_GIT_CACHED_NAMES="$1" \
  SYNO_GIT_CACHED_ALL_NAMES="$1" \
  SYNO_GIT_CACHED_ADDED_NAMES="$1" \
  SYNO_GIT_CACHED_DIFF="$1" \
  SYNO_SECRETS_ROOT="$SANDBOX" \
  SYNO_EXEMPT_LOG="$SANDBOX/exempt.log" \
  bash "$PRECOMMIT" 2>&1
}

OUT1=$(RUN_PRECOMMIT "docs/plans/x.md")
if echo "$OUT1" | grep -q "CT-34"; then
  pass "T1: 纯 docs/ 提交 → 豁免标记 (CT-34) 输出"
else
  fail "T1: 纯 docs/ 提交无豁免标记 (早退分支未执行)"
fi
# D390 (CT-P1-1): 豁免事件审计落盘 — exempt.log 必须含 EXEMPT + staged 清单
if [ -f "$SANDBOX/exempt.log" ] && grep -q "EXEMPT" "$SANDBOX/exempt.log" && grep -q "docs/plans/x.md" "$SANDBOX/exempt.log"; then
  pass "T13: 豁免事件落盘 exempt.log (EXEMPT + staged)"
else
  fail "T13: exempt.log 无豁免记录"
fi

OUT2=$(RUN_PRECOMMIT ".claude/task-briefs/D387-test.md")
if echo "$OUT2" | grep -q "CT-34"; then
  pass "T2: 纯 brief 提交 → 豁免标记 (G12b 鸡生蛋解除)"
else
  fail "T2: 纯 brief 提交无豁免标记"
fi

OUT4=$(RUN_PRECOMMIT "task-state/D387.json")
if echo "$OUT4" | grep -q "CT-34"; then
  pass "T4: task-state 提交 → 豁免标记 (task-state/ 进白名单)"
else
  fail "T4: task-state 提交无豁免标记"
fi

OUT5=$(RUN_PRECOMMIT "README.md")
if echo "$OUT5" | grep -q "CT-34"; then
  pass "T5: 根级 md 提交 → 豁免标记"
else
  fail "T5: 根级 md 提交无豁免标记"
fi

# T7: 文档含 secret → Secrets 拒绝（D312 保留, 降级路径）
mkdir -p "$SANDBOX/leak"
printf 'sk-abcdefghijklmnopqrstuvwx\n' > "$SANDBOX/leak/leak.txt"
OUT7=$(RUN_PRECOMMIT "docs/x.md")
rm -rf "$SANDBOX/leak"
if echo "$OUT7" | grep -q "Secrets 扫描失败"; then
  pass "T7: 纯文档+secret → Secrets 拒绝标记 (Secrets 保留, D312)"
else
  fail "T7: 无 Secrets 失败标记 — 豁免放松了安全 (输出尾部: $(echo "$OUT7" | tail -3 | tr '\n' ' '))"
fi

# ── 4. 接线 / 回归（T8/T9/T11 — grep 物理断言）──
echo ""
echo "── 4. 生产接线 / 回归 ──"
CALLS=$(grep -c "is_doc_only" "$PRECOMMIT" | tr -d '\n\r' || echo 0)
if [ "${CALLS:-0}" -ge 2 ]; then
  pass "T8: is_doc_only 生产引用 ≥2 (实际 $CALLS: 定义 + 早退分支消费)"
else
  fail "T8: is_doc_only 引用不足 2 (实际 $CALLS) — 未接线"
fi

BYPASS_LINE=$(grep -n "detected-bypass" "$PRECOMMIT" | head -1 | cut -d: -f1 | tr -d ' \r')
DOC_LINE=$(grep -n "^is_doc_only()" "$PRECOMMIT" | head -1 | cut -d: -f1 | tr -d ' \r')
if [ -n "$BYPASS_LINE" ] && [ -n "$DOC_LINE" ] && [ "$BYPASS_LINE" -lt "$DOC_LINE" ]; then
  pass "T9: GATEKEEPER bypass 阻断 (L$BYPASS_LINE) < is_doc_only 定义 (L$DOC_LINE) — 绕过审计先于豁免"
else
  fail "T9: 顺序错误 (bypass L$BYPASS_LINE, is_doc_only L$DOC_LINE)"
fi

# D1219（卡 #1225 旁路清场）: G12c 本地执行点已退役（第三态清零，立法 §7.1-2）。
#   退役依据 = 同判据在 CI 有**更强**执行点。⇒ 本断言由「字面量存在」改为三段：
#     ① 代码路径**不再**调用（注意: 只筛代码行——留痕注释逐字引用旧形态，全文件 grep 会假绿）；
#     ② 留痕可核（注释层仍指向 D1219 + 脚本名，可回溯）；
#     ③ **替代真实存在**（ci.yml 含 D708 写集对账 step）——把「替代存在」做成物理断言，
#        变异体 = 从 ci.yml 删该 step ⇒ 本断言红（退役依据失效 ⇒ 退役不成立）。
if grep -vE '^[[:space:]]*#' "$PRECOMMIT" | grep -q "check-dev-doc-write-set.sh"; then
  fail "T11a: G12c 仍被代码路径调用 — 退役未落地 (D1219)"
else
  pass "T11a: G12c 本地执行点已退役（代码路径零调用, D1219）"
fi
if grep -q "check-dev-doc-write-set.sh" "$PRECOMMIT" && grep -q "D1219" "$PRECOMMIT"; then
  pass "T11b: G12c 退役留痕可核（注释指向 D1219 + 脚本名）"
else
  fail "T11b: G12c 退役未留痕（注释层缺 D1219 或脚本名）"
fi
CI_YML="$REPO_DIR/.github/workflows/ci.yml"
if grep -q "Merge write-set reconciliation (D708)" "$CI_YML"; then
  pass "T11c: 替代真实存在 — ci.yml 含 D708 写集对账 step"
else
  fail "T11c: 替代不成立 — ci.yml 缺 D708 写集对账 step（退役依据失效）"
fi

# ── 5. 汇总 ──
echo ""
echo "═══════════════════════════════════════"
echo "  结果: 通过 $PASS / 失败 $FAIL"
echo "═══════════════════════════════════════"
[ "$FAIL" -eq 0 ]
