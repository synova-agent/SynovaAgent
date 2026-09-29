#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# simulate-ci.sh — D521/工具2: push 前 CI 等价模拟（本地能抓的错不送 CI）
#
# 契约 (铁律 47):
#   @input  — 无参（读当前仓库状态）
#             测试注入: SYNO_SIM_PRECOMMIT（替代 pre-commit 路径）
#                       SYNO_SIM_NESTED（auto|full|skip，段 2/2 覆盖缝）
#                       SYNO_SIM_DEGRADED_LOG（降级日志路径覆盖缝）
#   @output — 与 CI 一致的失败报告（Iron Laws + 密封 gate 测试清单）
#   @exit   — 0=模拟通过 / 1=模拟失败（业务，同 CI 红）/ 2=模拟执行失败（降级，D328 三态）
#   @degraded — pre-commit 缺失 → exit 2 显式降级（不静默当真）
#               N1（D1061）CI 环境内嵌全量重跑 → **显式跳过** + 打原因 + 落 degraded-events.log
# 用法: bash scripts/control-tower/simulate-ci.sh
# 模拟内容（与 ci.yml 同源）:
#   ① Iron Laws: GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main
#   ② 密封 gate 测试: 从 ci.yml control-tower-tests job 提取清单（单源，不散列）
#      —— 语义分层（D1061/N1）:
#         · **本地**（无 GITHUB_ACTIONS/CI 标记）= 全量跑（本工具作为「push 前 CI 等价模拟」的价值所在）
#         · **CI 环境内**被调用 = 显式跳过（外层 job 已逐条跑同源清单，内层重跑纯重复）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
PRE_COMMIT="${SYNO_SIM_PRECOMMIT:-$ROOT/scripts/pre-commit-check.sh}"
DEGRADED_LOG="${SYNO_SIM_DEGRADED_LOG:-$ROOT/.codex/control-tower/logs/degraded-events.log}"
FAIL=0

echo "═══════════════════════════════════════════════════════════"
echo "  simulate-ci — push 前 CI 等价模拟 (D521)"
echo "═══════════════════════════════════════════════════════════"

if [ ! -f "$PRE_COMMIT" ]; then
  echo -e "${RED}degraded: pre-commit 不存在: ${PRE_COMMIT}（不当作通过，D328 fail-closed）${RESET}" >&2
  exit 2
fi

# ① Iron Laws 等价
echo ""
echo -e "${CYAN}── 1/2: Iron Laws（CI strict: SYNO_CI=1, SYNO_DIFF_BASE=origin/main）──${RESET}"
if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  echo -e "${YELLOW}⚠ origin/main 不可解析 — Iron Laws 段降级跳过（离线语义，铁律 11 显式）${RESET}"
else
  GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main SYNO_GATEKEEPER_ACK=1 \
    bash "$PRE_COMMIT"
  [ $? -ne 0 ] && FAIL=1
fi

# ② 密封 gate 测试（清单从 ci.yml 单源提取——不散列、不漂移）
echo ""
echo -e "${CYAN}── 2/2: 密封 gate 测试（ci.yml CT job 同款清单）──${RESET}"

# ── N1 消解（D1061）: CI 环境内的内嵌全量重跑 ─────────────────────────────────
# 实测依据（D1061 前提实测 N1 段）: CI windows CT 腿 1619s 中 simulate-ci.test.sh 占 1051s（65%）。
#   机制 = 该测试调本脚本 3 次 × 本脚本每次重跑 ci.yml 提取的 44 条密封测试
#        = 每轮嵌套 132 次内层执行；而外层 CI job 早已逐条跑同一份 ci.yml 清单 → 纯重复。
# 修法 = **在本脚本侧做环境判定**（对"调用方数量"不敏感：调用 3 次或 30 次，内层执行数恒为 0），
#   而不是在调用方侧数调用次数（#868 正在给调用方加场景，数法必漂移）。
# 语义分层: 本地（无 GITHUB_ACTIONS/CI 标记）**全量语义零损** —— 本工具的核心价值即在本地全量。
# 显式性（铁律 11）: 跳过必须打印原因 + 落 degraded-events.log，**绝不静默**。
# 覆盖缝: SYNO_SIM_NESTED=auto|full|skip（夹具用）；非法值 → fail-closed 按 full 执行并点名。
IS_CI=0
if [ "${GITHUB_ACTIONS:-}" = "true" ] || [ "${CI:-}" = "true" ]; then IS_CI=1; fi
NESTED_MODE="${SYNO_SIM_NESTED:-auto}"
SKIP_NESTED=0
case "$NESTED_MODE" in
  auto) [ "$IS_CI" -eq 1 ] && SKIP_NESTED=1 ;;
  full) SKIP_NESTED=0 ;;
  skip) SKIP_NESTED=1 ;;
  *) echo -e "${YELLOW}⚠ SYNO_SIM_NESTED='${NESTED_MODE}' 非法（期望 auto|full|skip）— fail-closed 按 full 执行${RESET}" >&2; SKIP_NESTED=0 ;;
esac

if [ "$SKIP_NESTED" -eq 1 ]; then
  echo -e "${YELLOW}⏭ 段 2/2 显式跳过（D1061/N1）: 本脚本在 CI 环境内被调用${RESET}"
  echo -e "${YELLOW}   原因: 外层 CI job 已逐条跑同一份 ci.yml 密封清单（control-tower-tests for 清单）——${RESET}"
  echo -e "${YELLOW}         内层再跑 44 条 = 每轮 132 次重复；windows 腿实测因此多耗 1051s。${RESET}"
  echo -e "${YELLOW}   本地全量语义未变: 不带 GITHUB_ACTIONS/CI 即全量；或 SYNO_SIM_NESTED=full 强制全量。${RESET}"
  mkdir -p "$(dirname "$DEGRADED_LOG")" 2>/dev/null || true
  printf '{"time":"%s","component":"simulate-ci","code":"N1-ci-nested-full-suite-skipped","reason":"CI 环境内嵌全量重跑消解：外层 job 已跑同源 ci.yml 清单，内层重跑为纯重复；本地全量语义保留","ci_env":"GITHUB_ACTIONS=%s CI=%s","mode":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${GITHUB_ACTIONS:-}" "${CI:-}" "$NESTED_MODE" >> "$DEGRADED_LOG" 2>/dev/null || true
  echo ""
  if [ "$FAIL" -ne 0 ]; then
    echo -e "${RED}❌ 模拟失败 — 本地能抓的错别送 CI（修复后重跑本脚本再 push）${RESET}"
    exit 1
  fi
  echo -e "${GREEN}✅ CI 等价模拟通过（段 1/2 已跑；段 2/2 在 CI 环境显式跳过）— 可以 push${RESET}"
  exit 0
fi

# 防递归: 清单必须排除 simulate-ci.test.sh 自身——它调用本脚本，进清单则无限递归
# （D521-3 实证: ct-test-gate 跑它 → 它跑本脚本 → 本脚本跑它 → 提交挂死 600s 超时）
TESTS=$(grep -oE 'tests/control-tower/[a-z0-9-]+\.test\.sh' "$ROOT/.github/workflows/ci.yml" 2>/dev/null | grep -v 'simulate-ci\.test\.sh' | sort -u || true)
if [ -z "$TESTS" ]; then
  echo -e "${YELLOW}⚠ ci.yml 未提取到测试清单 — 段降级跳过${RESET}"
else
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    if [ ! -f "$ROOT/$t" ]; then
      echo -e "  ${RED}❌ $t — 文件缺失${RESET}"; FAIL=1; continue
    fi
    if GITHUB_ACTIONS=true bash "$ROOT/$t" > /dev/null 2>&1; then
      echo -e "  ${GREEN}✅ $t${RESET}"
    else
      echo -e "  ${RED}❌ $t — 模拟红（与 CI 一致）${RESET}"
      FAIL=1
    fi
  done <<< "$TESTS"
fi

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo -e "${RED}❌ 模拟失败 — 本地能抓的错别送 CI（修复后重跑本脚本再 push）${RESET}"
  exit 1
fi
echo -e "${GREEN}✅ CI 等价模拟通过 — 可以 push${RESET}"
exit 0
