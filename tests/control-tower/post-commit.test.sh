#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# post-commit.test.sh — D1145 / D735 Stage 2: hook 层 COMMITTED 登记（**无影子提交**）
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 裸 git commit（marker 新鲜=pre-commit 跑过）→
#          ① per-session 权威账本（.sessions/<sid>/bypass.log）含本提交 HASH
#          ② 本地兼容镜像（.claude/bypass.log）同含该 HASH
#          ③ **不派生影子提交**（HEAD 就是真实提交）；工作树对该文件零变更
#   边界 — 连续两次 commit ⇒ 每次只 +1 个提交（链长无膨胀，旧行为为 +2）
#   边界 — marker 缺失（--no-verify 等价场景）→ 不登记（不洗白绕过）
#   降级 — 账本落点不可写（落点父路径被文件占位）→ 仍写本地镜像 + stderr 显式点名（铁律 11）
#   接线 — post-commit.sh 不含影子提交段；含 bypass-ledger append；.gitignore 覆盖该文件
# 沙箱: mktemp git 仓库 + 指向真实 hook 的委托（M13: git -c 一次性身份参数）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
# M13/D521: hook 上下文会导出 GIT_DIR/GIT_WORK_TREE——沙箱 git 命令必须剥掉
# （git -C 不覆盖 GIT_DIR env；D521-3 实证沙箱提交落到宿主分支）
# D554 补充: GIT_INDEX_FILE 同样会被 git hook 上下文导出（pre-commit hook 运行时
# 指向宿主 index）——ct-test-gate 只剥 GIT_DIR/GIT_WORK_TREE（D521-3 未根治泄漏），
# 测试内再剥 GIT_INDEX_FILE 防沙箱 commit 误用宿主 index。
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK_SRC="$REPO/scripts/hooks/post-commit.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D1145 Stage 2: bypass hook 层登记（无影子提交）==="

# ── 接线 ──
if grep -q -- '--no-verify -q -o -m' "$HOOK_SRC"; then
  no "接线: 影子登记提交段仍在（D1145 要求移除）"
else
  ok "接线: 影子登记提交段已移除（D1145）"
fi
grep -q 'bypass-ledger.sh" append' "$HOOK_SRC" && ok "接线: per-session 账本 append 在位" || no "账本 append 未接线"
grep -qE '^\.claude/bypass\.log$' "$REPO/.gitignore" && ok "接线: .gitignore 覆盖 .claude/bypass.log（停跟踪）" || no ".gitignore 缺停跟踪条目"
if git -C "$REPO" ls-files --error-unmatch .claude/bypass.log >/dev/null 2>&1; then
  no "接线: .claude/bypass.log 仍被 git 跟踪（停跟踪未生效）"
else
  ok "接线: .claude/bypass.log 已停跟踪（ls-files 无输出）"
fi
if grep -q 'echo "$(date -Iseconds) | COMMITTED | pre-commit PASS | TASK_ID=\$TASK_ID' "$REPO/scripts/control-tower/synova-commit"; then
  no "synova-commit D508 追加未去重（会与 hook 双写留脏）"
else
  ok "接线: synova-commit D508 追加已去重"
fi

# ── 沙箱: git init + 委托 hook 指向真实脚本 ──
SB="$TMPD/sb"; mkdir -p "$SB/.claude" "$SB/.git/hooks"
git -C "$SB" init -q
git -C "$SB" config user.name t
git -C "$SB" config user.email t@t
# 沙箱需具备真实仓的 scripts/ 布局（hook 经 $ROOT 解析 bypass-ledger.sh）——用符号链接复现，
# 不复制（D1145: 账本落点解析依赖 $ROOT/scripts/control-tower/bypass-ledger.sh）
ln -s "$REPO/scripts" "$SB/scripts"
printf '#!/bin/bash\nexec bash "%s"\n' "$HOOK_SRC" > "$SB/.git/hooks/post-commit"
chmod +x "$SB/.git/hooks/post-commit"
# 沙箱镜像该文件的忽略状态（真实实现由仓库根 .gitignore 承担；沙箱自带一份以复现 Stage 2 语义）
printf '.claude/bypass.log\n.sessions/\n' > "$SB/.gitignore"
echo "seed" > "$SB/seed.txt"
git -C "$SB" add .gitignore seed.txt
git -C "$SB" -c user.name=t -c user.email=t@t commit -q --no-verify -m "seed"
LEDGER="$SB/.sessions/test/bypass.log"          # SYNO_SESSION_ID=test ⇒ 落点确定
MIRROR="$SB/.claude/bypass.log"

# 场景A: marker 新鲜（模拟 pre-commit 跑过）→ 裸 git commit → 应自动登记到账本 + 镜像，且无影子提交
echo "feature-a" > "$SB/a.txt"
git -C "$SB" add a.txt
echo "$(git -C "$SB" rev-parse HEAD)|$(date +%s)" > "$SB/.claude/last-precommit-success"
SYNO_SESSION_ID=test git -C "$SB" -c user.name=t -c user.email=t@t commit -q --no-verify -m "feat: real commit A"
REAL_HASH=$(git -C "$SB" rev-parse HEAD)
grep -q "$REAL_HASH" "$LEDGER" 2>/dev/null && ok "账本（权威落点）含本提交 HASH" || no "账本未登记 HASH: $LEDGER"
grep -q "$REAL_HASH" "$MIRROR" 2>/dev/null && ok "本地兼容镜像含本提交 HASH" || no "镜像未登记 HASH"
SUBJ=$(git -C "$SB" log -1 --format=%s)
[ "$SUBJ" = "feat: real commit A" ] && ok "HEAD 即真实提交（无影子提交）" || no "HEAD 非真实提交: $SUBJ"
git -C "$SB" status --porcelain | grep -q 'bypass.log' && no "工作树出现该文件变更（忽略失效）" || ok "工作树对该文件零变更（停跟踪生效）"

# 场景A2: 幂等 — 同一 HEAD 再跑一次 post-commit ⇒ 不重复登记（D1145 由「影子提交防递归」改为「按 HASH 幂等」）
LINES_BEFORE=$(grep -c . "$LEDGER" 2>/dev/null || echo 0)
(cd "$SB" && SYNO_SESSION_ID=test bash "$HOOK_SRC" >/dev/null 2>&1)
LINES_AFTER=$(grep -c . "$LEDGER" 2>/dev/null || echo 0)
[ "$LINES_BEFORE" = "$LINES_AFTER" ] \
  && ok "幂等: 同一 HEAD 重跑不重复登记（${LINES_BEFORE} 行）" \
  || no "重复登记: ${LINES_BEFORE} → ${LINES_AFTER}"

# 场景B: 再做一个 commit → 每次只 +1（旧行为 +2 = 影子）
BEFORE=$(git -C "$SB" rev-list --count HEAD)
echo "feature-b" > "$SB/b.txt"
git -C "$SB" add b.txt
echo "$(git -C "$SB" rev-parse HEAD)|$(date +%s)" > "$SB/.claude/last-precommit-success"
SYNO_SESSION_ID=test git -C "$SB" -c user.name=t -c user.email=t@t commit -q --no-verify -m "feat: real commit B"
AFTER=$(git -C "$SB" rev-list --count HEAD)
DELTA=$((AFTER - BEFORE))
[ "$DELTA" -eq 1 ] && ok "第二个 commit 只 +1（链长无膨胀；旧行为为 +2）" || no "提交数异常: +$DELTA（期望 +1）"

# 场景C: marker 缺失（--no-verify 等价）→ 不登记
rm -f "$SB/.claude/last-precommit-success"
echo "feature-c" > "$SB/c.txt"
git -C "$SB" add c.txt
SYNO_SESSION_ID=test git -C "$SB" -c user.name=t -c user.email=t@t commit -q --no-verify -m "feat: bypassed commit C"
C_HASH=$(git -C "$SB" rev-parse HEAD)
if grep -q "$C_HASH" "$LEDGER" 2>/dev/null; then
  no "marker 缺失仍登记（洗白绕过）"
else
  ok "marker 缺失（绕过）→ 不登记（证据诚实）"
fi

# 场景D（降级）: 账本落点不可写（父路径被文件占位）→ 仍写镜像 + stderr 显式点名
rm -rf "$SB/.sessions"; : > "$SB/.sessions"          # 用「文件」占位，使 mkdir -p 必败
echo "feature-d" > "$SB/d.txt"
git -C "$SB" add d.txt
echo "$(git -C "$SB" rev-parse HEAD)|$(date +%s)" > "$SB/.claude/last-precommit-success"
D_OUT=$(SYNO_SESSION_ID=test SYNO_BYPASS_LEDGER_DIR="$SB/.sessions/test" \
        git -C "$SB" -c user.name=t -c user.email=t@t commit -q --no-verify -m "feat: real commit D" 2>&1)
D_HASH=$(git -C "$SB" rev-parse HEAD)
if grep -q "$D_HASH" "$MIRROR" 2>/dev/null; then
  ok "降级: 账本不可写 → 仍写本地镜像（证据不丢）"
else
  no "降级: 镜像也未写（证据丢失）"
fi
printf '%s' "$D_OUT" | grep -q "账本写入失败" && ok "降级: stderr 显式点名（铁律 11 不静默）" || no "降级未显式提示"

# 场景E: 真实提交本身失败（identity 清空）→ hook 不触发、沙箱可继续操作
echo "feature-e" > "$SB/e.txt"
echo "$(git -C "$SB" rev-parse HEAD)|$(date +%s)" > "$SB/.claude/last-precommit-success"
git -C "$SB" add e.txt
git -C "$SB" -c user.name='' -c user.email='' commit --no-verify -m "feat: no-identity commit E" -- e.txt >/dev/null 2>&1 || true
git -C "$SB" status --porcelain -- e.txt | grep -q '^A' && ok "降级: 真实提交失败后沙箱状态可继续（e.txt 仍 staged）" || no "沙箱状态被破坏"


# ═══════════════════════════════════════════════════════════════
# D1145: 停跟踪判别性（原独立夹具 bypass-untracked.test.sh 于 D1145 合并至此）
#   判据（卡 #1073 Done ⑤）: **把停跟踪回退 ⇒ 两分支必冲突重现**。
#   ① 现状: 不被跟踪 + .gitignore 覆盖 + .gitattributes 无 union 声明
#   ② 病因重现: 沙箱里【重新跟踪】⇒ 两分支各追加一行 ⇒ merge 必冲突（不冲突=夹具失效，本测试必须红）
#   ③ 解药: 同沙箱【停跟踪+忽略】⇒ 两分支各追加一行 ⇒ merge 干净且两份内容都在
# ═══════════════════════════════════════════════════════════════
echo ""
echo "── D1145: 停跟踪判别性（改坏即红）──"
git -C "$REPO" ls-files --error-unmatch .claude/bypass.log >/dev/null 2>&1 \
  && no "D1145① 仍被跟踪（停跟踪未生效）" || ok "D1145① .claude/bypass.log 不被跟踪"
grep -qE '^\.claude/bypass\.log$' "$REPO/.gitignore" && ok "D1145① .gitignore 覆盖该路径" || no "D1145① .gitignore 缺条目"
grep -q '^\.claude/bypass\.log merge=union' "$REPO/.gitattributes" \
  && no "D1145① .gitattributes 仍声明 merge=union" || ok "D1145① .gitattributes 无 union 声明"

MB="$TMPD/mb"; mkdir -p "$MB"
if ! git -C "$MB" init -q -b main 2>/dev/null; then  # swallow-ok: 失败即沙箱不可用 → 下方显式点名
  no "D1145 夹具自身失败: 沙箱 git init 不可用"
else
  git -C "$MB" config user.name t; git -C "$MB" config user.email t@t
  mkdir -p "$MB/.claude"; echo "seed" > "$MB/.claude/bypass.log"; echo "seed" > "$MB/seed.txt"
  git -C "$MB" add -A >/dev/null 2>&1; git -C "$MB" commit -q -m "seed (tracked)" >/dev/null 2>&1
  # ② 重新跟踪（= 回退停跟踪）⇒ 必冲突
  git -C "$MB" checkout -q -b brA
  echo "A-entry" >> "$MB/.claude/bypass.log"; git -C "$MB" commit -qam "A append" >/dev/null 2>&1
  git -C "$MB" checkout -q main; git -C "$MB" checkout -q -b brB
  echo "B-entry" >> "$MB/.claude/bypass.log"; git -C "$MB" commit -qam "B append" >/dev/null 2>&1
  git -C "$MB" checkout -q brA
  git -C "$MB" merge brB >/dev/null 2>&1; RC_T=$?
  [ "$RC_T" -ne 0 ] && ok "D1145② 病因重现: 重新跟踪 ⇒ merge 冲突（rc=${RC_T}）" \
    || no "D1145② 夹具失效: 重新跟踪却不冲突（判别性丢失，必须红）"
  git -C "$MB" status --porcelain | grep -qE '^(UU|AA|U|DD)' && ok "D1145② 冲突标记存在（UU/AA）" || no "D1145② 无冲突标记"
  git -C "$MB" merge --abort >/dev/null 2>&1 || true
  # ③ 停跟踪 + 忽略 ⇒ merge 干净
  git -C "$MB" checkout -q main
  git -C "$MB" rm --cached -q .claude/bypass.log
  printf '.claude/bypass.log\n' >> "$MB/.gitignore"; git -C "$MB" add .gitignore >/dev/null 2>&1
  git -C "$MB" commit -q -m "untrack + ignore (D1145)" >/dev/null 2>&1
  git -C "$MB" status --porcelain | grep -q 'bypass.log' && no "D1145③ 停跟踪后工作树仍出现该文件" || ok "D1145③ 停跟踪后工作树零变更"
  git -C "$MB" checkout -q -b brC; echo "C-entry" >> "$MB/.claude/bypass.log"
  git -C "$MB" checkout -q main; git -C "$MB" checkout -q -b brD; echo "D-entry" >> "$MB/.claude/bypass.log"
  git -C "$MB" checkout -q brC
  git -C "$MB" merge brD >/dev/null 2>&1; RC_U=$?
  [ "$RC_U" -eq 0 ] && ok "D1145③ 解药: 停跟踪 ⇒ merge 干净（rc=0）" || no "D1145③ 停跟踪后仍冲突（rc=${RC_U}）"
  grep -q "^C-entry$" "$MB/.claude/bypass.log" && grep -q "^D-entry$" "$MB/.claude/bypass.log" \
    && ok "D1145③ 两份本地内容都在（git 不再介入该文件）" || no "D1145③ 本地内容丢失"
fi
echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
