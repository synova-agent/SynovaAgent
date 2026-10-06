#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# verify-doc.sh — D703 证据命令机器化（K3 W-1）：dev-doc DS 证据命令通用回放执行器
#
# 背景: dev doc 的 DS 证据命令（grep/git/vitest/tsc）停留在「文档字符串」——
#       W2 引用了不存在的测试文件、W4 声称 0 命中实测 2 命中，根因都是没人原样跑过。
#
# 契约 (铁律 47):
#   @input  — $1 = dev-doc 路径（markdown）
#   @output — 提取 §6/§8 的反引号 DS 命令 → 安全闸 → 逐条原样回放，逐条打印
#             [REPLAY]/[OK]/[FAIL]/[SKIP]/[REJECT]；末行汇总
#   @exit   — 0 = 全部回放通过或显式 skip；1 = 任一失败或被拒绝（fail-closed）
#   @degraded — doc 无 §6/§8 或无可回放命令 → 显式 skip 理由（不静默，铁律 11）
#
# 安全闸（fail-closed，spec §3.1 / 决策点 1）:
#   1. <占位符> 参数化命令（如 `bash scripts/ci/verify-doc.sh <坏 doc>`）→ 显式 skip
#   2. 危险元字符 `;` `&` `` ` `` `$` 重定向 `>` `<` → 拒绝执行 exit 1
#   3. 只读首 token 白名单: grep / ls / rg / sed（禁 -i）/ git(只读子命令) /
#      npx vitest / npx tsc / bash(仅限 scripts/ci/verify-*.sh 与 tests/control-tower/*.test.sh)
#   4. npx vitest 的路径参数预检（引用不存在测试文件 → exit 1，W2 事故形态，
#      不进入 vitest 即快速失败——密封测试无 node_modules 也密封可跑）
#
# grep 语义: exit 1 = 零命中（命令本身执行成功，缺失类断言的合法结果）；
#            exit ≥2 = 引用错误（文件不存在等）→ 失败。W4 型「声称 0 命中实测 N 命中」
#            的预期数值判读归各 verify-dXXX.sh curation 脚本，通用引擎只判命令本身成败。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export LC_ALL=C.UTF-8 2>/dev/null || true

if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
  echo "用法: bash scripts/ci/verify-doc.sh <dev-doc路径>"
  echo "  提取 dev-doc §6/§8 的 DS 证据命令逐条回放；任一失败/拒绝 exit 1"
  exit 1
fi

DOC_ARG="$1"
if [ ! -f "$DOC_ARG" ]; then
  echo "FAIL: dev-doc 不存在: $DOC_ARG"
  exit 1
fi
# 先解析绝对路径（执行阶段会 cd 到仓库根，spec 内命令均为仓库根相对路径）
DOC_DIR="$(cd "$(dirname "$DOC_ARG")" && pwd)"
DOC="$DOC_DIR/$(basename "$DOC_ARG")"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ── 提取 §6 + §8（区间未闭合则到 EOF）──
SECTIONS=$(sed -n '/^## 6\./,/^## 7\./p; /^## 8\./,/^## 9\./p' "$DOC" 2>/dev/null) # swallow-ok: doc 无该节 → SECTIONS 空 → 下方「-z $CMDS」显式 skip 输出理由（铁律 11）
CMDS=$(printf '%s\n' "$SECTIONS" | grep -oE '`[^`]+`' | sed 's/^`//; s/`$//' | awk '!seen[$0]++')

if [ -z "$CMDS" ]; then
  echo "SKIP: $DOC_ARG 无 §6/§8 或无可回放的 DS 命令（显式 skip，不静默）"
  exit 0
fi

echo "verify-doc: 回放 ${DOC_ARG}（共 $(printf '%s\n' "$CMDS" | wc -l | tr -d ' ') 条命令）"
cd "$ROOT" || exit 1

N_OK=0; N_FAIL=0; N_SKIP=0; N_REJECT=0

reject_cmd() {
  echo "  [REJECT] $1"
  echo "          理由: $2"
  N_REJECT=$((N_REJECT+1))
}

while IFS= read -r cmd; do
  [ -z "$cmd" ] && continue
  echo "  [REPLAY] $cmd"

  # ── 安全闸 1: <占位符> 参数化命令 → 显式 skip ──
  if printf '%s' "$cmd" | grep -qE '<[^<>]*>'; then
    echo "  [SKIP] 含 <占位符> 的参数化命令无法原样回放（人工/上游脚本实例化后回放）"
    N_SKIP=$((N_SKIP+1))
    continue
  fi

  # ── 安全闸 2: 危险元字符 → 拒绝 ──
  case "$cmd" in
    *";"*|*"&"*|*"\`"*|*"\$"*|*">"*|*"<"*)
      reject_cmd "$cmd" "含危险元字符（; & 反引号 美元 重定向）——拒绝执行（fail-closed）"
      continue
      ;;
  esac

  # ── 安全闸 3: 只读首 token 白名单 ──
  FIRST=$(printf '%s' "$cmd" | awk '{print $1}')
  SECOND=$(printf '%s' "$cmd" | awk '{print $2}')
  case "$FIRST" in
    grep|ls|rg)
      :  # 只读，放行
      ;;
    sed)
      case "$cmd" in
        *"-i"*|*"--in-place"*)
          reject_cmd "$cmd" "sed -i 会写文件，非只读——拒绝"
          continue
          ;;
      esac
      ;;
    git)
      case "$SECOND" in
        diff|log|show|status|rev-parse|ls-files)
          :  # 只读子命令
          ;;
        *)
          reject_cmd "$cmd" "git $SECOND 非只读子命令（白名单: diff/log/show/status/rev-parse/ls-files）"
          continue
          ;;
      esac
      ;;
    npx)
      case "$SECOND" in
        vitest|tsc)
          :  # 测试/类型检查
          ;;
        *)
          reject_cmd "$cmd" "npx $SECOND 非白名单（仅 vitest/tsc）"
          continue
          ;;
      esac
      ;;
    bash)
      case "$cmd" in
        *"scripts/ci/verify-"*".sh"*|*"tests/control-tower/"*".test.sh"*)
          :  # 仅限本机制 verify 脚本与控制塔密封测试
          ;;
        *)
          reject_cmd "$cmd" "bash 仅限 scripts/ci/verify-*.sh 与 tests/control-tower/*.test.sh"
          continue
          ;;
      esac
      ;;
    *)
      reject_cmd "$cmd" "首 token「$FIRST」非白名单（grep/ls/rg/sed/git/npx vitest|tsc/bash verify·test 脚本）"
      continue
      ;;
  esac

  # ── 安全闸 4: npx vitest 路径预检（W2 事故形态：引用不存在测试文件）──
  if [ "$FIRST" = "npx" ] && [ "$SECOND" = "vitest" ]; then
    BAD_PATH=""
    for tok in $cmd; do
      case "$tok" in
        -*|"vitest"|"run") continue ;;
      esac
      case "$tok" in
        *.ts|*.tsx|*/*)
          if [ ! -e "$tok" ]; then
            BAD_PATH="$tok"
            break
          fi
          ;;
      esac
    done
    if [ -n "$BAD_PATH" ]; then
      echo "  [FAIL] 引用不存在的测试文件/路径: ${BAD_PATH}（W2 事故形态，快速失败不进入 vitest）"
      N_FAIL=$((N_FAIL+1))
      continue
    fi
  fi

  # ── 回放 ──
  RC=0
  OUT=$(bash -c "$cmd" 2>&1) || RC=$?
  if [ "$FIRST" = "grep" ]; then
    # grep exit 1 = 零命中 = 命令执行成功（缺失类断言的合法结果）；exit ≥2 = 引用错误
    if [ "$RC" -le 1 ]; then
      echo "  [OK] exit ${RC}（grep 零命中属合法结果）"
      N_OK=$((N_OK+1))
    else
      echo "  [FAIL] exit ${RC}（grep 引用错误，如文件不存在）— $(printf '%s' "$OUT" | head -2 | tr '\n' ' ')"
      N_FAIL=$((N_FAIL+1))
    fi
  else
    if [ "$RC" -eq 0 ]; then
      echo "  [OK] exit 0"
      N_OK=$((N_OK+1))
    else
      echo "  [FAIL] exit $RC — $(printf '%s' "$OUT" | head -2 | tr '\n' ' ')"
      N_FAIL=$((N_FAIL+1))
    fi
  fi
done <<< "$CMDS"

echo ""
echo "verify-doc 汇总: OK=$N_OK FAIL=$N_FAIL SKIP=$N_SKIP REJECT=$N_REJECT"
if [ "$N_FAIL" -gt 0 ] || [ "$N_REJECT" -gt 0 ]; then
  echo "verify-doc: FAIL（回放失败或命令被拒绝，exit 1）"
  exit 1
fi
echo "verify-doc: PASS（全部通过或显式 skip）"
exit 0
