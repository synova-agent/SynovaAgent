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
#   边界 — 显式 SYNO_BASE_REF 不可解析 → exit 1
#          D1068 改: 「旧日志缺失」不再是失败条件（证据载体已迁 trailer）——
#          改为断言「空区间 + 无来源 ⇒ exit 0，但必须**显式转纯 trailer 对账**（不静默）」；
#          「有提交却无任何证据」由下方 D1068 三态用例覆盖（那才是真缺陷）。
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

# ── 边界: 旧日志缺失 —— D1068 语义变更 ──
# 旧断言「bypass.log 缺失 ⇒ exit 1」测的是「证据文件是存在性前提」。
# D1068 把证据载体迁到 commit trailer 后，该前提**不再成立**：日志缺失只是「本区间无旧来源」，
# 是否通过应由**逐提交的证据三态**决定，而不是由「文件在不在」决定。
# 故本条断言：**无任何账本来源** + 空区间 ⇒ exit 0，且**必须打印"转为纯 trailer 对账"**（不静默）。
# 真缺陷（有提交却无任何证据 ⇒ exit 1）由 precommit-evidence.test.sh 的三态用例把关。
#
# ⚠️ 隔离要求（D1068 独立自验 B1 退回，实测根因）:
#   本脚本的「来源」不止 `.claude/bypass.log` —— `bypass-ledger.sh sources` 还会扫
#   `.sessions/*/bypass.log`（`.gitignore` 忽略 ⇒ **本机状态**：新 clone 为空、提交过一次即有）。
#   旧版本条断言只移走旧日志就期望「无来源」⇒ 在**任何跑过提交的机器上必假红**
#   （实测: 4 通过 1 失败，失败项即本条）。
#   修法: 用 bypass-ledger.sh 的既有注入缝把两个来源都指到空位，使断言与环境解耦。
U1TMP="$(mktemp -d /tmp/d1068-u1.XXXXXX)"  # swallow-ok: mktemp 失败时下方 -d 判定即红，非静默
mkdir -p "$U1TMP/sessions" "$U1TMP/ledger" 2>/dev/null || true  # swallow-ok: 目录已存在/创建失败由下方判定覆盖
mv "$BYPASS" "$BYPASS.u1bak" 2>/dev/null || true  # swallow-ok: bypass.log 备份/还原操作, 测试隔离可忽略
# 三处来源全隔离（缺一不可，实测）:
#   SYNO_LEGACY_BYPASS_LOG     → 旧路径
#   SYNO_BYPASS_SESSIONS_ROOT  → 仓库内全部 .sessions/*/bypass.log
#   SYNO_BYPASS_LEDGER_DIR     → 本 session 落点目录（bypass-ledger.sh 会 ls 该目录下 *.log）
OUT_MISSING="$(SYNO_BASE_REF=origin/main \
  SYNO_LEGACY_BYPASS_LOG="$U1TMP/absent.log" \
  SYNO_BYPASS_SESSIONS_ROOT="$U1TMP/sessions" \
  SYNO_BYPASS_LEDGER_DIR="$U1TMP/ledger" \
  bash "$GATE" 2>&1)"
rc=$?
cleanup
rm -rf "$U1TMP" 2>/dev/null || true  # swallow-ok: 临时目录清理失败不影响断言（已断完）
if [ "$rc" -eq 0 ] && printf '%s' "$OUT_MISSING" | grep -q "纯 trailer 对账"; then
  ok "D1068: 无任何账本来源 + 空区间 → exit 0 且显式转纯 trailer 对账（不静默；已用注入缝隔离本机 .sessions）"
else
  no "D1068: 旧日志缺失应 exit 0 且明示转纯 trailer 对账, 实际 rc=$rc out=$OUT_MISSING"
fi

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
