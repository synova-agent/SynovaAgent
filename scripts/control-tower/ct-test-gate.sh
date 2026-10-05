#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# ct-test-gate.sh — U7/CT-40 控制塔脚本测试配对门禁
#
# 背景: 控制塔脚本是最高风险变更（D328-D335 一半 P0 在这），但 tests/control-tower/
#       的测试从不跑在 pre-commit/CI → D393 交付态红灯无物理拦截。本门禁补上这道防线。
#
# 契约 (铁律 47):
#   @input  — 无参（读 git 暂存区）；测试注入 SYNO_TEST_ARM=1 + SYNO_CT_STAGED（换行分隔文件列表）
#   @output — 配对报告（缺配对/测试红逐行点名）；SYNC-OK 标记
#   @exit   — 0 = 全部配对且测试绿 / 无控制塔脚本变更（跳过）；
#             1 = 缺配对测试 或 配对测试红（业务阻断）；
#             2 = 检查执行失败/降级（git 不可用等）
#   @degraded — exit 2 + stderr "degraded: <原因>"（铁律 11 显式降级，不静默当真）
# 配对规则: scripts/{control-tower,workflow,hooks}/<name>.<sh|py> ↔ tests/control-tower/<name>.test.sh
# 性能: 无控制塔脚本变更 → <1s 跳过；只跑变更脚本配对的测试（非全量，V4.5.1 教训）。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# 注入缝（测试）: SYNO_TEST_ARM=1 + SYNO_CT_STAGED 覆盖暂存区文件列表（武装守卫, 生产忽略）
# 生产 diff 基缝（task-28 裁定④）: CI runner 无暂存区 ⇒ 用 SYNO_CT_DIFF_BASE...HEAD 变更集
#   （与 pre-commit 的 SYNO_DIFF_BASE 同口径；仅在 GITHUB_ACTIONS=true 时生效，本地恒走暂存区）
if [ "${SYNO_TEST_ARM:-0}" = "1" ]; then
  STAGED_ALL="${SYNO_CT_STAGED:-}"
elif [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "${SYNO_CT_DIFF_BASE:-}" ]; then
  if ! STAGED_ALL="$(git -c core.quotepath=false diff --name-only --diff-filter=ACMR "${SYNO_CT_DIFF_BASE}...HEAD" 2>/dev/null)"; then
    echo "degraded: git diff ${SYNO_CT_DIFF_BASE}...HEAD 失败（fail-closed，不当作无变更）" >&2
    exit 2
  fi
else
  if ! STAGED_ALL="$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null)"; then
    echo "degraded: git 不可用，无法读取暂存区（fail-closed，不当作无变更）" >&2
    exit 2
  fi
fi

CT_SCRIPTS=$(echo "$STAGED_ALL" | grep -E '^scripts/(control-tower|workflow|hooks)/.*\.(sh|py)$' || true)
if [ -z "$CT_SCRIPTS" ]; then
  echo "SYNC-OK: 无控制塔脚本变更(跳过)"
  exit 0
fi

MISSING=""
RED=""
while IFS= read -r sf; do
  [ -z "$sf" ] && continue; [ ! -f "$ROOT/$sf" ] && continue
  bn=$(basename "$sf"); bn="${bn%.*}"  # foo.sh/foo.py → foo
  t="$ROOT/tests/control-tower/${bn}.test.sh"
  if [ ! -f "$t" ]; then
    MISSING="${MISSING}  ${sf} → 缺配对测试 tests/control-tower/${bn}.test.sh\n"
  # D521/M13: 剥 GIT_DIR/GIT_WORK_TREE——hook 上下文（pre-commit→本门禁）会导出它们，
  #   测试内沙箱 git commit（git -C 不覆盖 GIT_DIR env）会污染宿主分支（D521-3 实证:
  #   bypass-precommit/post-commit-marker 沙箱提交落到执行分支，branch ref 被覆写）。
  # D555: 同源剥 GIT_INDEX_FILE——git 触发 pre-commit hook 时导出宿主 index 路径，
  #   GIT_INDEX_FILE 优先级高于仓库默认 index，沙箱 git add/commit 会把沙箱条目
  #   写进宿主 index（D555 实证: verify-parallel.test.sh 沙箱 src/middleware/merged.ts
  #   入宿主 index，blob 不在宿主 odb → git commit「invalid object」失败）。根治于此。
  elif ! ( cd "$ROOT" && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE bash "$t" >/dev/null 2>&1 ); then
    RED="${RED}  ${sf} 配对测试红: tests/control-tower/${bn}.test.sh\n"
  fi
done <<< "$CT_SCRIPTS"

if [ -n "$MISSING" ] || [ -n "$RED" ]; then
  echo "❌ 控制塔脚本测试门禁 (U7/CT-40):"
  printf "%b" "${MISSING}${RED}"
  exit 1
fi
echo "SYNC-OK: 控制塔脚本配对测试全绿 ($(echo "$CT_SCRIPTS" | grep -c . | tr -d '\n\r') 个脚本)"
exit 0
