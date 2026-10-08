#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Loop Engineering V4.5.1 — check-verifiable-done.sh
# Done 标准可证伪性检查。pre-commit 第 6 组调用。全部 <1s。
#
# Anthropic 原则 2: 先设计验证标准，再设计实现。
# "入口可触达" 不是可证伪的验收标准。
# "verify: npx vitest run tests/acceptance/zero-code-industry" 是。
#
# 规则:
#   - Done 标准中每个 - [x] 必须包含 verify: 前缀 + 至少 10 个字符的可执行描述
#   - 或者 - [x] 后必须有一行缩进的 verify: 子项
#
# ── D-C（K3 预审 R1/R3 场景 c）: 声明双形态 + fail-closed ──
#   ① 声明载体: resolver 可返回 claim（`.claude/claims/<issue>.yaml`）——claim 的 Done
#      形如 `done:` + `  - verify: <命令>`。本脚本经 brief_parser 取 Done（**同源**，
#      不在 bash 里再写一套 YAML 解析），claim 的 done 由 claim_store 在**声明时**
#      强制含 verify:（缺 verify / done 为空 → exit 2），比提交端检查更早更强。
#   ② fail-closed（场景 c）: `SYNO_CLAIM_V2=1` 时，**暂存集非空却解析不出任何声明**
#      → exit 1（阻断），不再走"无 brief → ✅ 跳过"的 fail-open 老路。
#      默认（开关关）逐字节保持 legacy 行为 —— 回滚 = 关开关。
# ═══════════════════════════════════════════════════════════════════════════════
set +e

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RED='\033[0;31m'; GREEN='\033[0;32m'; RESET='\033[0m'

TODAY=$(date +%Y-%m-%d)
STAGED_LIST="$(git -c core.quotepath=false diff --cached --name-only 2>/dev/null || true)"
# D296 认领制: 多 session 并发时用认领本提交文件的 brief (跨 session 污染根治)
BRIEF=$(bash "$ROOT/scripts/workflow/resolve-commit-brief.sh" "$STAGED_LIST" 2>/dev/null || true)

# D-C: 单一开关判定（与 claim_store.claim_v2_enabled 同口径: 1/true/on/yes/y）
# 卡 #1423（创始人 2026-10-08「一步到位」裁决）: **默认开** ——
#   未设/真值 ⇒ 开；显式 0|false|off|no|n ⇒ 关（**唯一回滚点**）。
#   口径与单一事实源 claim_store.claim_v2_enabled 逐字对齐。
CLAIM_V2=1
case "$(printf '%s' "${SYNO_CLAIM_V2:-}" | tr '[:upper:]' '[:lower:]')" in
  1|true|on|yes|y) CLAIM_V2=1 ;;
  *) CLAIM_V2=0 ;;
esac

if [ -z "$BRIEF" ]; then
  if [ "$CLAIM_V2" = "1" ] && [ -n "$STAGED_LIST" ]; then
    # 场景 c（K3 R3）: claim 模式 + 有暂存 + 无任何可用声明 → **fail-closed**。
    # 修复前的 fail-open（✅ 跳过）正是迁移期"声明缺失静默放行"那条路径。
    echo -e "  ${RED}❌ Done 可证伪性: SYNO_CLAIM_V2=1 且暂存集非空，但解析不出任何声明（claim/brief）[硬阻断]${RESET}"
    echo "    修复: 建 .claude/claims/<issue号>.yaml（writeset + done 两字段），"
    echo "          或为在途 D# 任务保留 brief / task-state/D<#>.json"
    exit 1
  fi
  echo -e "  ${GREEN}✅ Done 可证伪性 (无 brief, 跳过)${RESET}"
  exit 0
fi

# 提取 Done 标准段落
# D-C: claim 载体 → 经 brief_parser（claim 分支）取 Done，避免在 bash 里复制 YAML 解析口径
DONE_SECTION=""
PARSE_RC=0
case "$BRIEF" in
  *.yaml)
    DONE_SECTION=$(python3 -c "
import sys
sys.path.insert(0, r'$ROOT/scripts/control-tower')
try:
    from brief_parser import parse_done
except ImportError:
    sys.exit(3)
print('\n'.join(parse_done(open(r'$BRIEF', encoding='utf-8', errors='replace').read())))
" 2>/dev/null)  # swallow-ok: rc 在下一行显式判定（非 0 → exit 2 fail-closed）
    PARSE_RC=$?
    if [ "$PARSE_RC" -ne 0 ]; then
      # 检查自身失败（三态 exit 2 语义）: 不得与"通过"混同（ctrl-tower-change 模式 1）
      echo -e "  ${RED}❌ Done 可证伪性: claim 解析器不可用（${BRIEF}）[检查自身失败，同样阻断]${RESET}"
      exit 2
    fi
    ;;
  *)
    DONE_SECTION=$(awk '/^## Done 标准/{found=1; next} found && /^## /{exit} found' "$BRIEF" 2>/dev/null)
    ;;
esac

# 统计 - [x] 项
CHECKED=$(echo "$DONE_SECTION" | grep -cE '^\s*- \[x\]' 2>/dev/null | tr -d '\r' || echo 0)
CHECKED=${CHECKED//[^0-9]/}
[ -z "$CHECKED" ] && CHECKED=0
if [ "$CHECKED" -eq 0 ]; then
  if [ "$CLAIM_V2" = "1" ]; then
    # claim 模式: Done 为空 = 无验收标准 = 不可对账（禁静默空白，对齐 claim_store 的 claim-empty-done）
    echo -e "  ${RED}❌ Done 可证伪性: 声明 $BRIEF 无 Done 条目 [硬阻断]${RESET}"
    exit 1
  fi
  echo -e "  ${GREEN}✅ Done 可证伪性 (无 checked 项)${RESET}"
  exit 0
fi

# 检查每个 - [x] 是否包含 verify:
UNVERIFIED=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  # 检查是否包含 verify: 关键字
  if ! echo "$line" | grep -qi 'verify:' 2>/dev/null; then
    UNVERIFIED="${UNVERIFIED}  ${line}\n"
  fi
done <<< "$(echo "$DONE_SECTION" | grep -E '^\s*- \[x\]')"

if [ -n "$UNVERIFIED" ]; then
  echo -e "  ${RED}❌ Done 可证伪性: ${CHECKED} 项 Done 中 $(echo -e "$UNVERIFIED" | grep -c .) 项缺 verify:  [硬阻断]${RESET}"
  echo -e "$UNVERIFIED"
  echo "    每个 - [x] 必须包含 verify: <可执行验证命令>"
  echo "    例: - [x] verify: npx vitest run tests/acceptance/zero-code-industry"
  exit 1
else
  echo -e "  ${GREEN}✅ Done 可证伪性 (${CHECKED} 项全部有 verify:)${RESET}"
  exit 0
fi
