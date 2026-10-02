#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# simulate-ci.sh — D521/工具2: push 前 CI 等价模拟（本地能抓的错不送 CI）
#
# 契约 (铁律 47):
#   @input  — 无参（读当前仓库状态）；测试注入: SYNO_SIM_PRECOMMIT（替代 pre-commit 路径）
#             D1099: SYNO_SIM_SCOPE=smoke（② 只真跑 SYNO_SIM_SMOKE_TESTS 代表样本；
#             清单仍单源提取 + 逐条存在性全检，仅"真跑"这一步缩量。默认 full = 历史行为不变）
#   @output — 与 CI 一致的失败报告（Iron Laws + 密封 gate 测试清单）
#   @exit   — 0=模拟通过 / 1=模拟失败（业务，同 CI 红）/ 2=模拟执行失败（降级，D328 三态）
#   @degraded — pre-commit 缺失 → exit 2 显式降级（不静默当真）
# 用法: bash scripts/control-tower/simulate-ci.sh
# 模拟内容（与 ci.yml 同源）:
#   ① Iron Laws: GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main
#   ② 密封 gate 测试: 从 ci.yml control-tower-tests job 提取清单（单源，不散列）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
PRE_COMMIT="${SYNO_SIM_PRECOMMIT:-$ROOT/scripts/pre-commit-check.sh}"
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
# 防递归: 清单必须排除 simulate-ci.test.sh 自身——它调用本脚本，进清单则无限递归
# （D521-3 实证: ct-test-gate 跑它 → 它跑本脚本 → 本脚本跑它 → 提交挂死 600s 超时）
TESTS=$(grep -oE 'tests/control-tower/[a-z0-9-]+\.test\.sh' "$ROOT/.github/workflows/ci.yml" 2>/dev/null | grep -v 'simulate-ci\.test\.sh' | sort -u || true)
# D1099 CI 关键路径瘦身（选项 B）: SYNO_SIM_SCOPE=smoke ⇒ ② 只真跑代表样本。
#   保值点（smoke 不减这三条验证力）:
#     ① 清单仍从 ci.yml **单源提取**（不散列、不硬编码）
#     ② 清单**每条**仍逐条校验"文件存在"（缺文件照旧红，不因 smoke 豁免）
#     ③ 打印 SIM_MANIFEST_TOTAL / SIM_RUN，供调用方断言"清单没被悄悄改小"
#   为什么可以只跑样本: ③ 所在 CT job 本体已把同一份清单**逐条真跑**一遍；嵌套场景
#     （simulate-ci.test.sh 自身就在 CT job 清单里）再全跑一遍是重复劳动——实测占
#     windows 腿墙钟 96%（D1099 证据: 3474s/3607s）。
#   默认（未设/非 smoke）= 与历史逐字节等价：清单全跑。
SCOPE="${SYNO_SIM_SCOPE:-full}"
SMOKE_TESTS="${SYNO_SIM_SMOKE_TESTS:-tests/control-tower/q2-error-locating.test.sh}"
if [ -z "$TESTS" ]; then
  echo -e "${YELLOW}⚠ ci.yml 未提取到测试清单 — 段降级跳过${RESET}"
  echo "SIM_MANIFEST_TOTAL=0 SIM_RUN=0 SIM_SCOPE=$SCOPE"
else
  MANIFEST_TOTAL=$(printf '%s\n' "$TESTS" | grep -c . || true)
  # ②-b 全清单存在性校验（两条 scope 共用；缺文件即红，不因 smoke 豁免）
  MISSING="$(printf '%s\n' "$TESTS" | while IFS= read -r t; do
    [ -z "$t" ] && continue
    [ -f "$ROOT/$t" ] || printf '%s\n' "$t"
  done)"
  if [ -n "$MISSING" ]; then
    while IFS= read -r m; do
      [ -z "$m" ] && continue
      echo -e "  ${RED}❌ $m — 文件缺失${RESET}"
    done <<< "$MISSING"
    FAIL=1
  fi
  if [ "$SCOPE" = "smoke" ]; then
    RUN_LIST=""
    for st in $SMOKE_TESTS; do
      if printf '%s\n' "$TESTS" | grep -qxF "$st"; then
        RUN_LIST="${RUN_LIST}${st}
"
      else
        echo -e "  ${RED}❌ smoke 代表样本 $st 不在 ci.yml 密封清单内（fail-closed）${RESET}"
        FAIL=1
      fi
    done
    echo -e "  ${CYAN}ℹ smoke 模式: 清单 ${MANIFEST_TOTAL} 条（已全数校验存在性），真跑代表样本（其余由 CT job 本体覆盖）${RESET}"
  else
    RUN_LIST="$TESTS"
  fi
  RUN_N=0
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    [ -f "$ROOT/$t" ] || continue
    RUN_N=$((RUN_N + 1))
    if GITHUB_ACTIONS=true bash "$ROOT/$t" > /dev/null 2>&1; then
      echo -e "  ${GREEN}✅ $t${RESET}"
    else
      echo -e "  ${RED}❌ $t — 模拟红（与 CI 一致）${RESET}"
      FAIL=1
    fi
  done <<< "$RUN_LIST"
  echo "SIM_MANIFEST_TOTAL=$MANIFEST_TOTAL SIM_RUN=$RUN_N SIM_SCOPE=$SCOPE"
fi

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo -e "${RED}❌ 模拟失败 — 本地能抓的错别送 CI（修复后重跑本脚本再 push）${RESET}"
  exit 1
fi
echo -e "${GREEN}✅ CI 等价模拟通过 — 可以 push${RESET}"
exit 0
