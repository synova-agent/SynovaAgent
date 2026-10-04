#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# bypass-untracked.test.sh — D1145「改坏即红」判别性夹具
#
# 判据（本卡 #1073 Done ⑤）: **把停跟踪回退 ⇒ 两分支必冲突重现**。
# 三路径:
#   ① 现状断言 — .claude/bypass.log 不被跟踪 + .gitignore 覆盖 + .gitattributes 无 union 声明
#   ② 病因重现 — 沙箱里【重新跟踪】该文件（= 回退本卡）⇒ 两分支各追加一行 ⇒ **merge 必冲突**
#                 （若这里不冲突 = 夹具失效，本测试必须红 —— 否则"停跟踪"的判别性不成立）
#   ③ 解药验证 — 同一沙箱改为【停跟踪 + 忽略】⇒ 两分支各追加一行 ⇒ merge 干净且两份内容都在
#
# 退出码（三态，M-02）: 0=三条全过；1=任一路径不符预期；2=夹具自身执行失败（沙箱/degraded）
# 沙箱: mktemp -d，零网络，不写宿主工作树
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D1145: bypass.log 停跟踪 —— 改坏即红判别性 ==="

# ── ① 现状断言 ──
if git -C "$REPO" ls-files --error-unmatch .claude/bypass.log >/dev/null 2>&1; then
  no "① 仍被跟踪（停跟踪未生效）"
else
  ok "① .claude/bypass.log 不被跟踪"
fi
grep -qE '^\.claude/bypass\.log$' "$REPO/.gitignore" && ok "① .gitignore 覆盖该路径" || no "① .gitignore 缺条目"
grep -q '^\.claude/bypass\.log merge=union' "$REPO/.gitattributes" \
  && no "① .gitattributes 仍声明 merge=union（应随停跟踪移除）" \
  || ok "① .gitattributes 无 union 声明（不再依赖合并策略兜冲突）"

# ── 沙箱初始化（夹具自身失败 → exit 2）──
SB="$TMPD/sb"; mkdir -p "$SB"
if ! git -C "$SB" init -q -b main 2>/dev/null; then  # swallow-ok: 失败即沙箱不可用 → 下方 exit 2 显式降级
  echo "degraded: 沙箱 git init 失败" >&2; exit 2
fi
git -C "$SB" config user.name t; git -C "$SB" config user.email t@t
mkdir -p "$SB/.claude"
echo "seed" > "$SB/seed.txt"

# ── ② 病因重现：重新跟踪（= 回退本卡）──
echo "seed" > "$SB/.claude/bypass.log"
git -C "$SB" add -A >/dev/null 2>&1
git -C "$SB" commit -q -m "seed (tracked)" >/dev/null 2>&1 || { echo "degraded: 沙箱初始提交失败" >&2; exit 2; }
git -C "$SB" checkout -q -b brA
echo "A-entry" >> "$SB/.claude/bypass.log"
git -C "$SB" commit -qam "A append" >/dev/null 2>&1
git -C "$SB" checkout -q main
git -C "$SB" checkout -q -b brB
echo "B-entry" >> "$SB/.claude/bypass.log"
git -C "$SB" commit -qam "B append" >/dev/null 2>&1
git -C "$SB" checkout -q brA
git -C "$SB" merge brB >/dev/null 2>&1; RC_TRACKED=$?
if [ "$RC_TRACKED" -ne 0 ]; then
  ok "② 病因重现: 重新跟踪 ⇒ merge 冲突（rc=${RC_TRACKED}）"
else
  no "② 夹具失效: 重新跟踪却不冲突（本夹具失去判别性，必须红）"
fi
git -C "$SB" status --porcelain | grep -qE '^(UU|AA|U|DD)' \
  && ok "② 冲突标记存在（UU/AA）" \
  || no "② 无冲突标记（$(git -C "$SB" status --porcelain | head -3 | tr '\n' ' ')）"
git -C "$SB" merge --abort >/dev/null 2>&1 || true

# ── ③ 解药验证：停跟踪 + 忽略（在 main 上做一次「停跟踪提交」，再分两分支写文件）──
git -C "$SB" checkout -q main
git -C "$SB" rm --cached -q .claude/bypass.log
printf '.claude/bypass.log\n' >> "$SB/.gitignore"
git -C "$SB" add .gitignore >/dev/null 2>&1
git -C "$SB" commit -q -m "untrack + ignore bypass.log (D1145)" >/dev/null 2>&1
if git -C "$SB" status --porcelain | grep -q 'bypass.log'; then
  no "③ 停跟踪提交后工作树仍出现该文件（$(git -C "$SB" status --porcelain | head -2 | tr '\n' ' ')）"
else
  ok "③ 停跟踪后工作树对该文件零变更"
fi
git -C "$SB" checkout -q -b brC
echo "C-entry" >> "$SB/.claude/bypass.log"
git -C "$SB" checkout -q main
git -C "$SB" checkout -q -b brD
echo "D-entry" >> "$SB/.claude/bypass.log"
git -C "$SB" checkout -q brC
git -C "$SB" merge brD >/dev/null 2>&1; RC_UNTRACKED=$?
[ "$RC_UNTRACKED" -eq 0 ] && ok "③ 解药: 停跟踪 ⇒ merge 干净（rc=0）" || no "③ 停跟踪后仍冲突（rc=${RC_UNTRACKED}）"
grep -q "^C-entry$" "$SB/.claude/bypass.log" && grep -q "^D-entry$" "$SB/.claude/bypass.log" \
  && ok "③ 两份本地内容都在（git 不再介入该文件）" \
  || no "③ 本地内容丢失（$(tail -3 "$SB/.claude/bypass.log" | tr '\n' ' ')）"
git -C "$SB" status --porcelain | grep -q 'bypass.log' \
  && no "③ 忽略失效: git status 仍出现该文件" \
  || ok "③ 忽略生效: git status 零变更"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
