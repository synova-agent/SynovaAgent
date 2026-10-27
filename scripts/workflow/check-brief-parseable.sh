#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-brief-parseable.sh — D313 M3 brief 契约检查
#
# 填完 task brief 立即用同源解析器（brief_parser.py）验证，格式问题提交前 5 秒暴露。
#
# 检查项:
#   ① Q2 可解析（include/exclude 提取有结果或明确空态）
#   ② #CRITERIA 必填 A-D
#   ③ 架构层 L1-5 标注
#   ④ Done 标准 ≥1 条
#   ⑤ 模板-解析器同源自检（generate-task-brief.py 输出 → 同源解析 → 通过）
#
# 设计哲学（一句）: 同一个输入位置只允许一种语义 —— 「未传参」（CLI 正常用法，回退解析）
#   与「显式传空参」（调用方 bug）必须可区分。混同则：回退会把调用方 bug 掩盖成
#   「解析到别的 brief」= 判错对象（假绿）；一刀切 fail-closed 又会误拦裸调（pre-push-preview.sh:90）。
#
# @input  $1 = brief 路径（可省略）
#           · 省略（$# = 0）           → 回退 resolve-commit-brief.sh（认领制解析）
#           · 非空路径                 → 直接检查该文件
#           · 显式空串（$#≥1 ∧ $1 空）→ 调用方 bug ⇒ 立即 rc=2（code BRIEF_ARG_EMPTY）
# @output stdout: 一行结论（✅ 可解析: <path> … ／ ❌ 不可解析: <path> ＋缺失项 ／ ⚠️ 跳过 (fail-open)）
# @exit   0 = 通过，或 fail-open 跳过（brief 不存在 / python 不可用）
#         1 = 契约失败（含具体缺失项）
#         2 = 调用方传空参（BRIEF_ARG_EMPTY）—— 检查自身/调用方失败，非业务红
# @degraded brief 不存在 / python 不可用 → fail-open 跳过 ＋ degraded 记录（不静默）
#           显式空参 → rc=2 ＋ degraded 记录（码字段口径 time/component/code/phase/retryable）
#
# 退出码: 0 = 通过 / 1 = 失败（含具体缺失项）/ 2 = 调用方传空参（BRIEF_ARG_EMPTY）
#         / 0+degraded（brief 不存在 / python 不可用 → skip，fail-open）
#
# 用法: check-brief-parseable.sh [brief-path]   （缺省 = resolve-commit-brief.sh 结果）
#
# 已知限制:
#   ① fail-open 的两条路径（brief 不存在 / python 不可用）刻意**不**升 rc=2：它们不是调用方
#      bug，是输入/环境缺失（沿用 #1072 前的既有契约；改动会误拦裸调调用点）。
#   ② 「显式空参」与「未传参」只凭位置参数量判别（$# 与 $1）：`" "`（空白串）按非空路径处理
#      ⇒ 落 fail-open，不报 BRIEF_ARG_EMPTY（传空白 ≠ 传空串，属已知边界）。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PARSER="$REPO_DIR/scripts/control-tower/brief_parser.py"
DEGRADED_LOG="$REPO_DIR/.codex/control-tower/logs/degraded-events.log"

# ── 显式传空参（$#≥1 ∧ $1 空）= 调用方 bug ⇒ fail-closed（rc=2）──────────────────
#   与「未传参」（$#=0，走下方 resolve-commit-brief.sh 回退）严格区分：#1072 前两者混同，
#   调用方 bug 被回退掩盖 ⇒ 解析到「别的 brief」= 判错对象（假绿，E8）。
#   放在 PYBIN 探测**之前**：调用方 bug 不得被「环境缺 python」这条降级路径盖住。
#   三态口径: rc=2 = 检查自身/调用方失败，不是业务红（0 通过／1 真红）。
if [ "$#" -ge 1 ] && [ -z "${1:-}" ]; then
  mkdir -p "$(dirname "$DEGRADED_LOG")"
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"check-brief-parseable\", \"code\": \"BRIEF_ARG_EMPTY\", \"phase\": \"arg-parse\", \"retryable\": false, \"reason\": \"调用方传了空参（应不传参走回退，或传具体 brief 路径）\"}" >> "$DEGRADED_LOG" 2>/dev/null || true  # swallow-ok: 日志写失败不改判定——失败已由 stdout 点名＋rc=2 承载，不静默
  echo "[check-brief-parseable] ❌ BRIEF_ARG_EMPTY: 调用方传了空参（未传参请直接省略参数；rc=2 = 检查自身/调用方失败，非业务红）"
  exit 2
fi

# D317: Windows 部分机器无 python3.exe（仅 python / py -3）→ 回退；全无 → fail-open 跳过
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then
  mkdir -p "$(dirname "$DEGRADED_LOG")"
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"check-brief-parseable\", \"reason\": \"python 不可用 — 跳过 (fail-open)\"}" >> "$DEGRADED_LOG" 2>/dev/null || true
  echo "[check-brief-parseable] ⚠️  python 不可用 — 跳过 (fail-open)"
  exit 0
fi

BRIEF="${1:-}"
if [ -z "$BRIEF" ]; then
  BRIEF=$(bash "$REPO_DIR/scripts/workflow/resolve-commit-brief.sh" "" 2>/dev/null | head -1 || true)
fi

if [ -z "$BRIEF" ] || [ ! -f "$BRIEF" ]; then
  # fail-open: brief 不存在 → skip + degraded 记录（绝不静默）
  mkdir -p "$(dirname "$DEGRADED_LOG")"
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"check-brief-parseable\", \"reason\": \"brief 不存在: ${BRIEF:-none}\"}" >> "$DEGRADED_LOG" 2>/dev/null || true
  echo "[check-brief-parseable] ⚠️  brief 不存在 — 跳过 (fail-open)"
  exit 0
fi

FAILURES=""

# ① Q2 可解析
Q2_OUT=$("$PYBIN" "$PARSER" --all "$BRIEF" 2>/dev/null || echo '{"parseable": false}')
if echo "$Q2_OUT" | grep -q '"parseable": false'; then
  FAILURES="${FAILURES}  Q2 不可解析（brief_parser 失败）\n"
else
  INCLUDE_N=$(echo "$Q2_OUT" | "$PYBIN" -c "import json,sys; print(len(json.load(sys.stdin).get('q2_include', [])))" 2>/dev/null || echo 0)
  if [ "${INCLUDE_N:-0}" -eq 0 ]; then
    FAILURES="${FAILURES}  Q2 做什么 无路径条目（至少 1 条）\n"
  fi
fi

# ② #CRITERIA 必填
CRITERIA=$(echo "$Q2_OUT" | "$PYBIN" -c "import json,sys; print(json.load(sys.stdin).get('criteria') or '')" 2>/dev/null || echo "")
if [ -z "$CRITERIA" ]; then
  FAILURES="${FAILURES}  #CRITERIA 缺失（必填 A-D）\n"
fi

# ③ 架构层（有值即通过 — 基础设施类任务无 L1-5；代码任务应标 L1-5）
LAYER=$(echo "$Q2_OUT" | "$PYBIN" -c "import json,sys; print(json.load(sys.stdin).get('layer') or '')" 2>/dev/null || echo "")
if [ -z "$LAYER" ]; then
  FAILURES="${FAILURES}  架构层未标注（当前: 空）\n"
fi

# ④ Done ≥1
DONE_N=$(echo "$Q2_OUT" | "$PYBIN" -c "import json,sys; print(json.load(sys.stdin).get('done_count', 0))" 2>/dev/null || echo 0)
if [ "${DONE_N:-0}" -eq 0 ]; then
  FAILURES="${FAILURES}  Done 标准无条目（至少 1 条）\n"
fi

# ⑤ 模板同源自检（模板输出应能被同源解析）
TMP_BRIEF="$REPO_DIR/.codex/control-tower/tmp/bp-template-check.md"
if BRIEF_FILE="$TMP_BRIEF" TASK_DESC="self-check" "$PYBIN" "$REPO_DIR/scripts/workflow/generate-task-brief.py" > /dev/null 2>&1; then
  TMP_OUT=$("$PYBIN" "$PARSER" --all "$TMP_BRIEF" 2>/dev/null || echo '{"parseable": false}')
  if echo "$TMP_OUT" | grep -q '"parseable": false'; then
    FAILURES="${FAILURES}  模板输出不可被同源解析器解析（模板-解析器漂移）\n"
  fi
  rm -f "$TMP_BRIEF"
fi

if [ -n "$FAILURES" ]; then
  echo "[check-brief-parseable] ❌ brief 不可解析: $BRIEF"
  echo -e "$FAILURES"
  exit 1
fi

echo "[check-brief-parseable] ✅ brief 可解析: $BRIEF (Q2 ✓ #CRITERIA=$CRITERIA 架构层=$LAYER Done=$DONE_N)"
exit 0
