#!/bin/bash
# check-fde-terms.sh — FDE 术语退役防回归门禁 (D573)
#
# 契约（铁律 47）:
#   @input  无参数；扫描仓库工作区，大小写敏感匹配 "FDE"（避免 sha512/#fffde7 等十六进制小写误报）
#   @output stdout = 违规文件:行 清单
#   @exit   0 = 白名单外零 FDE（通过）
#           1 = 白名单外发现 FDE 残留（业务阻断，逐条列出）
#           2 = 检查自身执行失败（同样阻断，绝不与通过混同，D328 三态）
#   @白名单 历史档案（docs/ 全部、task-state、memory、WORKLOG/CHANGELOG/LOOP*、evidence、
#            _deprecated 专家、mvp-server.cjs 删除候选）+ 运行时产物（reference-map、task-briefs）
#            + 守卫自引用（capability.test.ts 的 not.toMatch(/FDE/)、dataflow 门禁的 ^FDE$ 兼容词）
#   @降级   grep 不可用 → exit 2；grep 内部错误（exit≥2）→ exit 2
# 用法: bash scripts/check-fde-terms.sh    （npm run check:terms）
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

command -v grep >/dev/null 2>&1 || { echo "[check-fde-terms] grep 不可用 — 检查无法执行（exit 2 降级阻断）" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 2

GREP_EXIT=0
RAW=$(grep -rIn 'FDE' . \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=release \
  --exclude-dir=dist --exclude-dir=tmp --exclude-dir=.sessions \
  --exclude-dir=novis-backup-20260526 --exclude-dir=.audit-clone-d572 \
  --exclude-dir=.venv-llmverifier \
  2>/dev/null) || GREP_EXIT=$?
# grep 语义: 0=有匹配 1=无匹配 2+=自身出错（三态，D328）
if [ "$GREP_EXIT" -ge 2 ]; then
  echo "[check-fde-terms] grep 执行异常（exit=$GREP_EXIT）— 检查失败按阻断处理" >&2
  exit 2
fi

is_allowed() {
  case "$1" in
    ./docs/*) return 0 ;;                              # 历史文档/审计报告/带日期档案（GLOSSARY 退役说明行在此）
    ./expert/_deprecated/*) return 0 ;;                # 已废弃专家目录
    ./task-state/*|./memory/*) return 0 ;;             # 台账与四态 Note 历史记录
    ./WORKLOG-*|./CHANGELOG.md|./LOOP*) return 0 ;;    # 工作日志/变更史
    ./evidence/*) return 0 ;;                          # 验收证据快照（带日期，不可改）
    ./.claude/task-briefs/*|./.claude/reference-map.md|./.claude/loop-state.json|./.claude/pre-commit-failures.log|./.claude/bypass.log|./.synova/logs/*) return 0 ;; # 历史派单 brief 与运行时产物
    ./scripts/workflow/check-dataflow-alignment.sh|./scripts/control-tower/founder-truth.py|./scripts/check-fde-terms.sh) return 0 ;; # 含 ^FDE$ 兼容词（旧 brief 关键词对账）
    ./mvp-server.cjs) return 0 ;;                      # Stage 0 删除候选，不投资
    ./tests/electron/capability.test.ts) return 0 ;;   # 守卫自引用: not.toMatch(/FDE/)
    ./prototypes/*|./vendor/*|./synthesis/*) return 0 ;; # 原型/第三方 vendored/合成物
    *) return 1 ;;
  esac
}

OFFENDERS=""
TOTAL=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  FILE="${line%%:*}"
  if ! is_allowed "$FILE"; then
    OFFENDERS="${OFFENDERS}${line}\n"
    TOTAL=$((TOTAL + 1))
  fi
done <<< "$RAW"

if [ "$TOTAL" -gt 0 ]; then
  echo -e "[check-fde-terms] ❌ 发现 ${TOTAL} 处 FDE 残留（白名单外）— 术语统一 GA（Growth Advisor，增长顾问）：\n${OFFENDERS}"
  echo "[check-fde-terms] 修复: FDE → GA；历史档案（docs/、task-state、audit-reports 等）在白名单内不动。"
  exit 1
fi

echo "[check-fde-terms] ✅ 白名单外零 FDE（GA = Growth Advisor 术语统一保持）"
exit 0
