#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
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
#
# 隔离（D1152 复核席 P1 修复 —— 原夹具实测 6% 假红）:
#   **沙箱不得委托真实 hook**。旧版 `ln -s "$REPO/scripts" "$SB/scripts"` + 委托整 hook ⇒
#   hook 尾部 `external-auditor --dispatch` 与 `decide-next.sh &`（在沙箱内**真实存在**）
#   于同一仓跑 git（decide-next.sh:57 `git status --porcelain` 会刷新并重写 index）⇒
#   与夹具下一次 add/commit 抢 `$SB/.git/index.lock` ⇒ **假红方向是"指控门禁"**
#   （"marker 缺失仍登记/洗白绕过"、"证据丢失"），维护者会照着错断言去"修"被测代码。
#   现改为 **只投放被驱动脚本**（post-commit.sh + 它唯一调用的 bypass-ledger.sh，
#   运行时拷贝，非桩），沙箱内无 auditor/decide-next ⇒ 无同仓 git 副作用。
#   每个「应当是提交」的动作 **fail-fast**: 断言 rc=0 且 HEAD 前进；失败报
#   `fixture: commit did not happen` 并 exit 3（夹具自身失败 ≠ 产品缺陷）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# M13/D521: hook 上下文会导出 GIT_DIR/GIT_WORK_TREE——沙箱 git 命令必须剥掉
# （git -C 不覆盖 GIT_DIR env；D521-3 实证沙箱提交落到宿主分支）
# D554 补充: GIT_INDEX_FILE 同样会被 git hook 上下文导出（pre-commit hook 运行时
# 指向宿主 index）——ct-test-gate 只剥 GIT_DIR/GIT_WORK_TREE（D521-3 未根治泄漏），
# 测试内再剥 GIT_INDEX_FILE 防沙箱 commit 误用宿主 index。
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK_SRC="$REPO/scripts/hooks/post-commit.sh"
LEDGER_SRC="$REPO/scripts/control-tower/bypass-ledger.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
mkdir -p "$TMPD/empty-hooks"   # hermetic: 需要"无 hook"的沙箱时指向它（不受本机全局 core.hooksPath 影响）

# 夹具自身失败（rc≠0 / HEAD 未前进）⇒ 报夹具，不指控被测门禁（exit 3 ≠ 0/1 产品判定）
fixture_fail() {  # <阶段> <rc> <描述>
  echo "  ❌ fixture: commit did not happen (rc=$2) — $3 [stage=$1]"
  echo "     判据: 夹具自身失败（不是门禁缺陷，禁止据此改被测代码）；后续断言不具可解释性 ⇒ 中止（exit 3）"
  exit 3
}

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

# ═══ 沙箱: 只投放被驱动脚本（不委托真实 hook、不链真实仓 scripts/）═══
SB="$TMPD/sb"
mkdir -p "$SB/.claude" "$SB/.git/hooks" "$SB/scripts/hooks" "$SB/scripts/control-tower"
git -C "$SB" init -q || { echo "  ❌ fixture: 沙箱 git init 不可用（夹具自身失败）"; exit 3; }
git -C "$SB" config user.name t
git -C "$SB" config user.email t@t
# hermetic: 显式绑定 hooksPath=沙箱自带 hooks（不受开发者本机全局 core.hooksPath 影响）
git -C "$SB" config core.hooksPath "$SB/.git/hooks"
cp "$HOOK_SRC" "$SB/scripts/hooks/post-commit.sh"                                  # 被驱动脚本（被测物）
cp "$LEDGER_SRC" "$SB/scripts/control-tower/bypass-ledger.sh"                     # 它唯一调用的依赖
printf '#!/bin/bash\nexec bash "%s"\n' "$SB/scripts/hooks/post-commit.sh" > "$SB/.git/hooks/post-commit"
chmod +x "$SB/.git/hooks/post-commit"
# 沙箱镜像该文件的忽略状态（真实实现由仓库根 .gitignore 承担；沙箱自带一份以复现 Stage 2 语义）
printf '.claude/bypass.log\n.sessions/\n' > "$SB/.gitignore"
echo "seed" > "$SB/seed.txt"
LEDGER="$SB/.sessions/test/bypass.log"          # SYNO_SESSION_ID=test ⇒ 落点确定
MIRROR="$SB/.claude/bypass.log"
SB_OUT=""; SB_ENV=""

# ── hermetic 断言（改坏即红: 恢复整树委托 ⇒ 立刻报）──
[ -L "$SB/scripts" ] && no "沙箱 scripts 仍是真实仓符号链接（hermetic 失效，同仓 git 竞态回来了）" \
  || ok "沙箱 scripts 为独立投放（非真实仓符号链接）"
DEPLOYED="$(find "$SB/scripts" -type f 2>/dev/null | wc -l | tr -d ' ')"  # swallow-ok: 探测型（空目录即 0）
[ "$DEPLOYED" = "2" ] && ok "沙箱只投放 2 个被驱动脚本（post-commit.sh + bypass-ledger.sh）" \
  || no "沙箱投放文件数=$DEPLOYED（应 2 —— 只投放被驱动脚本）"
[ -e "$SB/scripts/control-tower/external-auditor.sh" ] && no "沙箱内存在 external-auditor（--dispatch 会在同仓跑 git）" \
  || ok "沙箱无 external-auditor（不触发 --dispatch 同仓 git）"
[ -e "$SB/scripts/workflow/decide-next.sh" ] && no "沙箱内存在 decide-next（后台 git status 会抢 index.lock）" \
  || ok "沙箱无 decide-next（无后台同仓 git）"
if cmp -s "$SB/scripts/hooks/post-commit.sh" "$HOOK_SRC"; then
  ok "沙箱投放的是真实 hook 内容（运行时拷贝，非桩，被测物无漂移）"
else
  no "沙箱 hook 与真实 hook 内容不一致（测试被测物漂移）"
fi

# 夹具动作封装（fail-fast: 见 header「隔离」段）
sb_git_env() { env SYNO_SESSION_ID=test $SB_ENV git -C "$SB" "$@"; }
sb_add() {  # <描述> <路径...>
  local desc="$1"; shift; local rc
  git -C "$SB" add -- "$@" >/dev/null 2>&1; rc=$?
  [ "$rc" -eq 0 ] || fixture_fail add "$rc" "$desc"
}
sb_commit() {  # <描述> <提交信息>  ⇒ add -A + commit（输出落 SB_OUT）
  local desc="$1" msg="$2" before after rc add_rc
  before="$(git -C "$SB" rev-parse HEAD 2>/dev/null || echo none)"  # swallow-ok: 夹具基线（失败即 none）
  SB_OUT="$(sb_git_env add -A 2>&1)"; add_rc=$?
  [ "$add_rc" -eq 0 ] || fixture_fail add "$add_rc" "$desc"
  SB_OUT="${SB_OUT}$(sb_git_env commit -q -m "$msg" 2>&1)"
  rc=$?
  after="$(git -C "$SB" rev-parse HEAD 2>/dev/null || echo none)"   # swallow-ok: 夹具复核（失败即 none ⇒ 判定异常）
  if [ "$rc" -ne 0 ] || [ "$before" = "$after" ]; then fixture_fail commit "$rc" "$desc"; fi
}
sb_head() { git -C "$SB" rev-parse HEAD 2>/dev/null || echo none; }  # swallow-ok: 夹具读取（失败即 none）

sb_commit "夹具 seed 提交" "seed"
MARKER="$SB/.claude/last-precommit-success"

# 场景A: marker 新鲜（模拟 pre-commit 跑过）→ 裸 git commit → 应自动登记到账本 + 镜像，且无影子提交
echo "feature-a" > "$SB/a.txt"
echo "$(git -C "$SB" rev-parse HEAD)|$(date +%s)" > "$MARKER"
sb_commit "场景A 提交" "feat: real commit A"
REAL_HASH=$(sb_head)
grep -q "$REAL_HASH" "$LEDGER" 2>/dev/null && ok "账本（权威落点）含本提交 HASH" || no "账本未登记 HASH: $LEDGER"
grep -q "$REAL_HASH" "$MIRROR" 2>/dev/null && ok "本地兼容镜像含本提交 HASH" || no "镜像未登记 HASH"
SUBJ=$(git -C "$SB" log -1 --format=%s)
[ "$SUBJ" = "feat: real commit A" ] && ok "HEAD 即真实提交（无影子提交）" || no "HEAD 非真实提交: $SUBJ"
git -C "$SB" status --porcelain | grep -q 'bypass.log' && no "工作树出现该文件变更（忽略失效）" || ok "工作树对该文件零变更（停跟踪生效）"

# 场景A2: 幂等 — 同一 HEAD 再跑一次 post-commit ⇒ 不重复登记（D1145 由「影子提交防递归」改为「按 HASH 幂等」）
LINES_BEFORE=$(grep -c . "$LEDGER" 2>/dev/null || echo 0)
(cd "$SB" && SYNO_SESSION_ID=test bash "$SB/scripts/hooks/post-commit.sh" >/dev/null 2>&1) || no "场景A2: 沙箱 hook 直接调用非零退出"
LINES_AFTER=$(grep -c . "$LEDGER" 2>/dev/null || echo 0)
[ "$LINES_BEFORE" = "$LINES_AFTER" ] \
  && ok "幂等: 同一 HEAD 重跑不重复登记（${LINES_BEFORE} 行）" \
  || no "重复登记: ${LINES_BEFORE} → ${LINES_AFTER}"

# 场景B: 再做一个 commit → 每次只 +1（旧行为 +2 = 影子）
BEFORE=$(git -C "$SB" rev-list --count HEAD)
echo "feature-b" > "$SB/b.txt"
echo "$(git -C "$SB" rev-parse HEAD)|$(date +%s)" > "$MARKER"
sb_commit "场景B 提交" "feat: real commit B"
AFTER=$(git -C "$SB" rev-list --count HEAD)
DELTA=$((AFTER - BEFORE))
[ "$DELTA" -eq 1 ] && ok "第二个 commit 只 +1（链长无膨胀；旧行为为 +2）" || no "提交数异常: +$DELTA（期望 +1）"

# 场景C: marker 缺失（--no-verify 等价）→ 不登记
rm -f "$MARKER"
echo "feature-c" > "$SB/c.txt"
sb_commit "场景C 提交（marker 缺失）" "feat: bypassed commit C"
C_HASH=$(sb_head)
if grep -q "$C_HASH" "$LEDGER" 2>/dev/null; then
  no "marker 缺失仍登记（洗白绕过）"
else
  ok "marker 缺失（绕过）→ 不登记（证据诚实）"
fi

# 场景D（降级）: 账本落点不可写（父路径被文件占位）→ 仍写镜像 + stderr 显式点名
rm -rf "$SB/.sessions"; : > "$SB/.sessions"          # 用「文件」占位，使 mkdir -p 必败
echo "feature-d" > "$SB/d.txt"
echo "$(git -C "$SB" rev-parse HEAD)|$(date +%s)" > "$MARKER"
SB_ENV="SYNO_BYPASS_LEDGER_DIR=$SB/.sessions/test"
sb_commit "场景D 提交（账本降级）" "feat: real commit D"
SB_ENV=""
D_OUT="$SB_OUT"; D_HASH=$(sb_head)
if grep -q "$D_HASH" "$MIRROR" 2>/dev/null; then
  ok "降级: 账本不可写 → 仍写本地镜像（证据不丢）"
else
  no "降级: 镜像也未写（证据丢失）"
fi
printf '%s' "$D_OUT" | grep -q "账本写入失败" && ok "降级: stderr 显式点名（铁律 11 不静默）" || no "降级未显式提示"

# 场景E: 真实提交本身失败（identity 清空）→ hook 不触发、沙箱可继续操作
#   注意: 本场景**期望失败**，故断言方向相反（提交成功 = 夹具前提不成立，报夹具自身失败）
echo "feature-e" > "$SB/e.txt"
echo "$(git -C "$SB" rev-parse HEAD)|$(date +%s)" > "$MARKER"
sb_add "场景E staged（identity 清空用例前置）" e.txt
E_BEFORE=$(sb_head)
git -C "$SB" -c user.name='' -c user.email='' commit --no-verify -m "feat: no-identity commit E" -- e.txt >/dev/null 2>&1; E_RC=$?
E_AFTER=$(sb_head)
if [ "$E_RC" -eq 0 ] || [ "$E_BEFORE" != "$E_AFTER" ]; then
  echo "  ❌ fixture: 场景E 前提不成立 — identity 清空的提交竟然成功（rc=$E_RC）"
  echo "     判据: 夹具自身失败（不是门禁缺陷）⇒ 中止（exit 3）"
  exit 3
fi
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
# 夹具动作（$MB 沙箱）: fail-fast（同上，报夹具不指控产品）
mb_commit() {  # <描述> <提交信息>  ⇒ add -A + commit（提交动作必须成功）
  local desc="$1" msg="$2" before after rc
  before="$(git -C "$MB" rev-parse HEAD 2>/dev/null || echo none)"  # swallow-ok: 夹具基线（失败即 none）
  git -C "$MB" add -A >/dev/null 2>&1; rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "  ❌ fixture: commit did not happen (rc=$rc) — ${desc} [stage=add][D1145 判别性沙箱]"
    echo "     判据: 夹具自身失败（不是门禁缺陷）⇒ 中止（exit 3）"
    exit 3
  fi
  git -C "$MB" commit -q -m "$msg" >/dev/null 2>&1; rc=$?
  after="$(git -C "$MB" rev-parse HEAD 2>/dev/null || echo none)"   # swallow-ok: 夹具复核（同上）
  if [ "$rc" -ne 0 ] || [ "$before" = "$after" ]; then
    echo "  ❌ fixture: commit did not happen (rc=$rc) — ${desc} [D1145 判别性沙箱]"
    echo "     判据: 夹具自身失败（不是门禁缺陷）⇒ 中止（exit 3）"
    exit 3
  fi
}
if ! git -C "$MB" init -q -b main 2>/dev/null; then  # swallow-ok: 失败即沙箱不可用 → 下方显式点名
  no "D1145 夹具自身失败: 沙箱 git init 不可用"
else
  git -C "$MB" config user.name t; git -C "$MB" config user.email t@t
  git -C "$MB" config core.hooksPath "$TMPD/empty-hooks"   # hermetic: 本段不挂任何 hook（含沙箱 hook）
  mkdir -p "$MB/.claude"; echo "seed" > "$MB/.claude/bypass.log"; echo "seed" > "$MB/seed.txt"
  mb_commit "D1145 夹具 seed" "seed (tracked)"
  # ② 重新跟踪（= 回退停跟踪）⇒ 必冲突
  git -C "$MB" checkout -q -b brA
  echo "A-entry" >> "$MB/.claude/bypass.log"; mb_commit "D1145 brA 追加" "A append"
  git -C "$MB" checkout -q main; git -C "$MB" checkout -q -b brB
  echo "B-entry" >> "$MB/.claude/bypass.log"; mb_commit "D1145 brB 追加" "B append"
  git -C "$MB" checkout -q brA
  git -C "$MB" merge brB >/dev/null 2>&1; RC_T=$?
  [ "$RC_T" -ne 0 ] && ok "D1145② 病因重现: 重新跟踪 ⇒ merge 冲突（rc=${RC_T}）" \
    || no "D1145② 夹具失效: 重新跟踪却不冲突（判别性丢失，必须红）"
  git -C "$MB" status --porcelain | grep -qE '^(UU|AA|U|DD)' && ok "D1145② 冲突标记存在（UU/AA）" || no "D1145② 无冲突标记"
  git -C "$MB" merge --abort >/dev/null 2>&1 || true
  # ③ 停跟踪 + 忽略 ⇒ merge 干净
  git -C "$MB" checkout -q main
  git -C "$MB" rm --cached -q .claude/bypass.log
  printf '.claude/bypass.log\n' >> "$MB/.gitignore"
  mb_commit "D1145 停跟踪提交" "untrack + ignore (D1145)"
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
