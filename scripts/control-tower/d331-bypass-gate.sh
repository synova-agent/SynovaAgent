#!/bin/bash
# D313 M5 / D732 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# d331-bypass-gate.sh — D331 (L4-2) bypass.log 对账判定体（#1134）
#
# 设计哲学（一句）: **对账基只认 resolver 的输出，不认任何写死的 trunk 字面**；
#   **缺件一律 fail-closed** —— 防绕过的门禁不能因为"脚本被删/改名"就整条跳过。
#
# 背景（#1134 裁定）:
#   `pre-push-check.sh` 曾用 5 级 fallback 链（gitea/local-main → local-main →
#   origin/local-main → origin/main → $PUSH_REMOTE/$PUSH_BRANCH）自行算对账基，
#   trunk 一切换（local-main→main）①位就冻结在旧 trunk ⇒ 任何 merge main 的分支
#   都被索要他人已过闸提交的记录 ⇒ 推送整体被拒（#1118/#1112/#1114 三次实证）。
#   裁定：基一律走 `scripts/control-tower/resolve-ci-base.sh`；同批把
#   "脚本缺失 ⇒ 跳过（fail-open）"改为阻断。
#
# 契约（铁律 47）:
#   @input   $1 = resolve-ci-base.sh 路径；$2 = check-bypass-log.sh 路径；
#            环境 SYNO_BASE_REF 透传给 resolver（测试注入用）
#   @output  stdout: 对账基与对账结果（交调用方打印）；不写仓库
#   @exit    0 = 通过；1 = 阻断（缺件 / 基不可解析 / 对账失败 —— 均 fail-closed）
#   @degraded 无独立降级：任何"判不了"都归 1（推送侧硬阻断，绝不放过）
#   @error   code ∈ {E_NO_CHECK, E_NO_RESOLVER, E_BASE_UNRESOLVED, E_RECONCILE}
#
# 授权（explicit authority）: 唯一调用方 = `scripts/pre-push-check.sh` 门禁 7（本地推送腿）。
# 已知限制（Known Limitations）:
#   1. 证据源 `.claude/bypass.log` 本机自写、K3 异机不可核 ⇒ 本件是 P1 而非 P0
#      （手写一行 COMMITTED 即可通过；F4 夹具把该缺陷显式化）。
#   2. 退役触发条件 = W9 分支保护落地后（服务端 CI 有真证据 ⇒ 本地账本冗余）。
# ═══════════════════════════════════════════════════════════════════════════════

d331_gate() {
  local resolver="${1:-}" check="${2:-}" base="" rc=0
  if [[ -z "$check" || ! -f "$check" ]]; then
    echo "  ❌ D331: check-bypass-log.sh 缺失（fail-closed，不跳过）: ${check:-<未提供>}  [E_NO_CHECK]"
    return 1
  fi
  if [[ -z "$resolver" || ! -f "$resolver" ]]; then
    echo "  ❌ D331: resolve-ci-base.sh 缺失（fail-closed）: ${resolver:-<未提供>}  [E_NO_RESOLVER]"
    return 1
  fi
  base="$(bash "$resolver" 2>/dev/null)"
  rc=$?
  if [[ "$rc" -ne 0 || -z "$base" ]]; then
    echo "  ❌ D331: 对账基解析失败（resolver rc=$rc）—— fail-closed，不当作通过  [E_BASE_UNRESOLVED]"
    return 1
  fi
  echo "  对账基（resolver）= $base"
  if ! bash "$check" "$base"; then
    echo "  ❌ D331: 对账失败  [E_RECONCILE]"
    return 1
  fi
  return 0
}
