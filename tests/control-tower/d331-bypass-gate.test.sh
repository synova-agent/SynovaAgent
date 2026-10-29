#!/bin/bash
# D313 M5 / D732 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# d331-bypass-gate.test.sh — #1134 夹具（F1–F4 裁定夹具 ＋ fail-closed 两态 ＋ 改坏即红）
#   F1 本地新提交无记录          ⇒ 阻断（核心判别力不得丢）
#   F2 trunk 已有提交（基=HEAD） ⇒ 通过
#   F3 check-bypass-log.sh 缺失  ⇒ 阻断（fail-closed）
#   F4 手工伪造 COMMITTED 一行   ⇒ 通过（把"自证性"缺陷显式化，坐实 P1 定性）
#   F5 resolver 不可用/exit 2    ⇒ 阻断（fail-closed）
#   F6 resolver 输出被真正采信   ⇒ 输出含该基（接线断言）
#   F7 改坏即红：删 F3 守卫       ⇒ F3 变绿（证明守卫承重）
# 隔离：全部 mktemp 沙箱；不读不写真实仓账本；剥离 hook 与 GIT_* 注入。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$REPO/scripts/control-tower/d331-bypass-gate.sh"
CHECK="$REPO/scripts/control-tower/check-bypass-log.sh"
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

mkrepo() { # $1=目录：base 提交 + 一个未登记的新提交
  local d="$1"
  mkdir -p "$d" && cd "$d" || return 1
  git init -q . && git config user.email t@e.com && git config user.name t
  git config commit.gpgsign false && git config core.hooksPath /dev/null
  mkdir -p .claude && : > .claude/bypass.log
  echo a > a.txt && git add -A && git commit -qm base
  echo b > b.txt && git add -A && git commit -qm new
}
stub() { # $1=输出 $2=名字 $3=exit code(默认0)
  local f="$TMPD/res-$2.sh"
  printf '#!/bin/bash\nprintf "%%s\\n" "%s"\nexit %s\n' "$1" "${3:-0}" > "$f"
  chmod +x "$f"; printf '%s' "$f"
}
gate() { ( . "$LIB"; d331_gate "$1" "$2" ); }

echo "── F1 本地新提交无记录 ⇒ 阻断 ──"
D1="$TMPD/f1"; mkrepo "$D1"
R1="$(stub "HEAD~1" f1)"
OUT="$(gate "$R1" "$CHECK" 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "F1 阻断 (exit 1)" || no "F1 期望 1 实得 $RC"
printf '%s' "$OUT" | grep -q '对账基（resolver）= HEAD~1' && ok "F1 基被采信" || no "F1 未打印基"

echo "── F2 trunk 已有提交（基=HEAD） ⇒ 通过 ──"
R2="$(stub "HEAD" f2)"
OUT="$(gate "$R2" "$CHECK" 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "F2 通过 (exit 0)" || no "F2 期望 0 实得 $RC（$OUT）"

echo "── F3 check-bypass-log.sh 缺失 ⇒ 阻断（fail-closed） ──"
OUT="$(gate "$R2" "$TMPD/no-such-check.sh" 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "F3 阻断 (exit 1)" || no "F3 期望 1 实得 $RC"
printf '%s' "$OUT" | grep -q 'E_NO_CHECK' && ok "F3 点名 E_NO_CHECK" || no "F3 未点名（$OUT）"

echo "── F4 手工伪造 COMMITTED ⇒ 通过（P1 定性显式化） ──"
D4="$TMPD/f4"; mkrepo "$D4"
H="$(git rev-parse HEAD)"
printf '2026-10-29T00:00:00Z | COMMITTED | forged | HASH=%s\n' "$H" >> .claude/bypass.log
R4="$(stub "HEAD~1" f4)"
OUT="$(gate "$R4" "$CHECK" 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "F4 伪造即通过（证实非安全控制，P1）" || no "F4 期望 0 实得 $RC（$OUT）"

echo "── F5 resolver 不可用 ⇒ 阻断 ──"
D5="$TMPD/f5"; mkrepo "$D5"
R5="$(stub "" f5 2)"
OUT="$(gate "$R5" "$CHECK" 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "F5 阻断 (exit 1)" || no "F5 期望 1 实得 $RC"
printf '%s' "$OUT" | grep -q 'E_BASE_UNRESOLVED' && ok "F5 点名 E_BASE_UNRESOLVED" || no "F5 未点名（$OUT）"

echo "── F6 resolver 路径缺失 ⇒ 阻断 ──"
OUT="$(gate "$TMPD/no-resolver.sh" "$CHECK" 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "F6 阻断 (exit 1)" || no "F6 期望 1 实得 $RC"
printf '%s' "$OUT" | grep -q 'E_NO_RESOLVER' && ok "F6 点名 E_NO_RESOLVER" || no "F6 未点名（$OUT）"

echo "── F7 改坏即红：删 F3 守卫 ⇒ 本用例变绿（证明守卫承重） ──"
MUT="$TMPD/mut-lib.sh"
# 变异语义: 把 E_NO_CHECK 分支从"阻断(return 1)"改回旧 fail-open("return 0")，
#   再跑 F3 场景 —— 若变异体返回 0，说明 F3 的阻断断言确实由该守卫承重。
if python3 - "$LIB" "$MUT" <<'PY'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
old = '[E_NO_CHECK]"\n    return 1'
if old not in src:
    sys.exit(3)
open(sys.argv[2], "w", encoding="utf-8", newline="\n").write(src.replace(old, '[E_NO_CHECK]"\n    return 0', 1))
PY
then
  OUT="$( . "$MUT"; d331_gate "$R2" "$TMPD/no-such-check.sh" 2>&1 )"; RCM=$?
  [ "$RCM" -eq 0 ] && ok "F7 变异体变 fail-open(0) ⇒ 原守卫(阻断)承重" || no "F7 变异体仍非 0（rc=$RCM）"
else
  no "F7 变异点未命中（锚点漂移）"
fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
