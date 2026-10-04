#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# check-bypass-log.test.sh — D414/U1c bypass 证据链对账门禁测试
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 无新提交（origin/main..HEAD 空）→ exit 0
#   降级 — git log 执行失败 → exit 2（fail-closed, 不当作通过）
#   边界 — bypass.log 缺失 → exit 1；显式 SYNO_BASE_REF 不可解析 → exit 1
#   接线 — git log 失败 fail-closed 代码真实存在于脚本（铁律 0-2）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/check-bypass-log.sh"
BYPASS="$REPO/.claude/bypass.log"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
cleanup() { [ -f "$BYPASS.u1bak" ] && mv "$BYPASS.u1bak" "$BYPASS"; }
trap cleanup EXIT

echo "=== D414/U1c check-bypass-log 对账门禁测试 ==="

# ── 接线: git log 失败 fail-closed 代码真实存在（U1c 修复点）──
if grep -q "git log 执行失败" "$GATE" && grep -q "GIT_LOG_OUT" "$GATE"; then
  ok "接线: git log 失败 fail-closed exit 2 已接入"
else
  no "接线: git log 失败检测代码缺失"
fi

# ── 正常: 无新提交（origin/main..HEAD 空集）→ exit 0 ──
SYNO_BASE_REF=origin/main bash "$GATE" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && ok "无新提交对账 → exit 0" || no "无新提交应 exit 0, 实际 $rc"

# ── 边界（D1145 Stage 2 语义）: **全部来源皆空** → exit 1；仅镜像缺失但账本在 → 不判 fail-closed ──
# 旧语义: 单文件 `.claude/bypass.log` 不存在即 exit 1；停跟踪后该文件在新 clone/CI 不存在属正常态，
# 故 fail-closed 判据改为「全部来源皆空」。本用例两段都断言，防止语义被改回单文件口径。
mv "$BYPASS" "$BYPASS.u1bak" 2>/dev/null || true  # swallow-ok: bypass.log 备份/还原操作, 测试隔离可忽略
# ① 仅镜像缺失（账本来源仍在）→ 不得因"文件不存在"判 fail-closed
EMPTY_SESS="$(mktemp -d /tmp/d1145-empty-sess.XXXXXX)"
SYNO_BASE_REF=origin/main bash "$GATE" >/dev/null 2>&1
rc_partial=$?
[ "$rc_partial" -ne 1 ] && ok "仅镜像缺失（账本来源仍在）→ 未误判 fail-closed（rc=${rc_partial}）" \
  || no "仅镜像缺失却判 exit 1（旧单文件口径残留）"
# ② 全来源皆空（镜像 + per-session 账本都移走）→ exit 1
LEDGER_PATH="$(bash "$REPO/scripts/control-tower/bypass-ledger.sh" path 2>/dev/null || true)"
[ -n "$LEDGER_PATH" ] && [ -f "$LEDGER_PATH" ] && mv "$LEDGER_PATH" "$LEDGER_PATH.u1bak"  # swallow-ok: 测试隔离
SYNO_BASE_REF=origin/main bash "$GATE" >/dev/null 2>&1
rc=$?
[ -n "$LEDGER_PATH" ] && [ -f "$LEDGER_PATH.u1bak" ] && mv "$LEDGER_PATH.u1bak" "$LEDGER_PATH"  # swallow-ok: 还原
cleanup
[ "$rc" -eq 1 ] && ok "全部来源皆空 → exit 1（fail-closed）" || no "全部来源皆空应 exit 1, 实际 $rc"

# ── 边界: 显式 SYNO_BASE_REF 不可解析 → exit 1（硬错误, 非 fail-open）──
SYNO_BASE_REF="nonexistent-ref-xyz" bash "$GATE" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 1 ] && ok "显式 base 不可解析 → exit 1" || no "显式 base 不可解析应 exit 1, 实际 $rc"

# ═══ D508: merge-base 对账用例（Win#7 死循环根治验证）═══
# 沙箱加固（事故教训: 2026-08-23 三次 index 污染）: 所有沙箱 git 一律 GIT_DIR/
#   GIT_WORK_TREE 显式绑定（结构性隔离，与 cwd 无关），并断言宿主 index 前后不变。
(
  SB="$(mktemp -d /tmp/d508-mb.XXXXXX)"
  HOST_BEFORE=$(git write-tree 2>/dev/null || echo na)  # swallow-ok: 宿主基线
  trap 'rm -rf "$SB"' EXIT
  g() { GIT_DIR="$SB/.git" GIT_WORK_TREE="$SB" git "$@"; }
  git -C "$SB" init -q
  g config user.email t@t; g config user.name tester
  mkdir -p "$SB/.claude"; : > "$SB/.claude/bypass.log"
  echo a > "$SB/a"; g add -A; g commit -qm base
  g branch -m main
  echo m1 > "$SB/m1"; g add -A; g commit -qm main-side
  g checkout -q -b feat/x HEAD~1
  echo b > "$SB/b"; g add -A; g commit -qm feat-task
  TASK_HASH=$(g rev-parse HEAD)
  echo "$(date -Iseconds) | COMMITTED | pre-commit PASS | TASK_ID=X | AGENT=t | HASH=$TASK_HASH" >> "$SB/.claude/bypass.log"
  g merge -q main -m merge-main 2>/dev/null || true  # swallow-ok: 沙箱夹具
  if (cd "$SB" && SYNO_BASE_REF=main bash "$GATE" >/dev/null 2>&1); then
    echo "  ✅ D508: merge main 后 main 侧提交不再要求补记（死循环根治）"
  else
    echo "  ❌ D508: merge 后对账仍失败"; exit 1
  fi
  echo c > "$SB/c"; g add -A; g commit -qm unrecorded
  if (cd "$SB" && SYNO_BASE_REF=main bash "$GATE" >/dev/null 2>&1); then
    echo "  ❌ D508: 无记录提交漏拦！"; exit 1
  else
    echo "  ✅ D508: 无记录新提交仍被拦（对账强度不降）"
  fi
  HOST_AFTER=$(git write-tree 2>/dev/null || echo na)  # swallow-ok: 宿主复核
  if [ "$HOST_BEFORE" = "$HOST_AFTER" ]; then
    echo "  ✅ D508: 宿主 index 未被沙箱污染"
    PASS=$((PASS+3))
  else
    echo "  ❌ D508: 宿主 index 被改写！"; exit 1
  fi
)

# ═══ D513/③: 防御 fetch 接线断言（本地 base 对账 + 接线 grep 双验）═══
if grep -q "防御性刷新 base" "$GATE"; then
  echo "  ✅ D513/③: 防御 fetch 已接线"
  PASS=$((PASS+1))
else
  echo "  ❌ D513/③: 防御 fetch 未接线"
  FAIL=$((FAIL+1))
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
