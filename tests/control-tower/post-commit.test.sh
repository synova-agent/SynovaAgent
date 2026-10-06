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

# ═══════════════════════════════════════════════════════════════════════════════
# D1157（P0 假绿根修的**写入侧**同源修正 —— CTO 第 2 版裁决并入本批）
#   病灶: `_ledger_has_hash()` 旧判据 `grep -q "$h" $srcs` **无锚** ⇒ `detected-bypass … parent=<sha>`
#         也构成"已登记" ⇒ hook **跳过写 COMMITTED 行**（证据链静默缺一条；且与对账器判据不对称）。
#   H1（判例级硬约束）: 读文件/读状态类断言一律 `git show <ref>:<path>`，**禁读工作树**
#     （主仓工作树停在 docs/D1115-b1-br5-closeout ⇒ 同一文件内容与主干不同）。
#   H2（判例级硬约束）: 夹具的"红"必须来自**断言**，不许来自脚本崩溃恰好 return 1；
#     判据 = 把被测物换成**已知正确实现** ⇒ 夹具必须绿（下方 F-fixed 即该绿对照）。
#   本组（改坏 ⇒ F2 红；夹具坏或修复不生效 ⇒ F-fixed 红；过紧 ⇒ F4 红）:
#     F1 同源断言: post-commit.sh 与 check-bypass-log.sh 的 D1157-REC-RE 块**逐字一致**
#     F2 改坏即红（**独立红例**）: 账本只有 `parent=<C>`（C 无自身记录）⇒ 旧实现**不补记**
#     F-fixed 绿对照（H2）: 同夹具 + 本支实现 ⇒ **必须补记**
#     F3 负对照: 已有 C 自身记录 ⇒ 仍跳过（幂等未破）
#     F4 负对照: 记录值是 8 位短 sha ⇒ 仍算已登记（前缀判定未过紧）
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── D1157 写入侧判据（幂等锚定 + 同源断言）──"

# 逐字同源块提取（POSIX awk：取 BEGIN 与 END 之间**首个非注释非空行** = `_REC_RE=…`）
_rec_re_of() { awk '/D1157-REC-RE-BEGIN/{f=1;next} /D1157-REC-RE-END/{f=0} f && $0 !~ /^[[:space:]]*#/ && NF {print; exit}' "$1" 2>/dev/null; }
REC_RE_HOOK="$(_rec_re_of "$HOOK_SRC")"
REC_RE_CHECK="$(_rec_re_of "$REPO/scripts/control-tower/check-bypass-log.sh")"
if [ -n "$REC_RE_HOOK" ] && [ "$REC_RE_HOOK" = "$REC_RE_CHECK" ]; then
  ok "F1 同源断言: 写入侧/读取侧 _REC_RE 逐字一致"
else
  no "F1 同源断言失败: 两侧 _REC_RE 不一致或缺失（写入侧='${REC_RE_HOOK}' 读取侧='${REC_RE_CHECK}'）"
fi

# 造沙箱并驱动「重跑 hook」场景；$1=hook 实现路径 → stdout 1=账本里补记了 C / 0=没补记
d1157_probe() {  # <hook-src>
  local hook="$1" sb tag C
  tag="$(printf '%s' "$hook" | cksum | tr -dc '0-9')"
  sb="$TMPD/d1157-$tag"
  rm -rf "$sb"; mkdir -p "$sb/.claude" "$sb/scripts/hooks" "$sb/scripts/control-tower"
  git -C "$sb" init -q >/dev/null 2>&1 || { echo "FIXTURE_FAIL init"; return 3; }
  git -C "$sb" config user.name t; git -C "$sb" config user.email t@t
  git -C "$sb" config core.hooksPath "$TMPD/empty-hooks"    # 夹具内手动驱动 hook（不让 git 自己触发）
  cp "$hook" "$sb/scripts/hooks/post-commit.sh"
  cp "$LEDGER_SRC" "$sb/scripts/control-tower/bypass-ledger.sh"
  echo seed > "$sb/seed.txt"
  git -C "$sb" add -A >/dev/null 2>&1 || { echo "FIXTURE_FAIL add"; return 3; }
  git -C "$sb" commit -qm seed >/dev/null 2>&1 || { echo "FIXTURE_FAIL commit"; return 3; }
  # ① 待补记提交 C（沙箱无 hook ⇒ 等价 --no-verify：账本里不会自动出现 C 的记录）
  echo payload > "$sb/payload.txt"
  git -C "$sb" add -A >/dev/null 2>&1
  git -C "$sb" commit -qm "feat: C" >/dev/null 2>&1 || { echo "FIXTURE_FAIL commit-C"; return 3; }
  C="$(git -C "$sb" rev-parse HEAD 2>/dev/null)"  # swallow-ok: 夹具读取；取不到即下方显式 FIXTURE_FAIL 中止
  [ -n "$C" ] || { echo "FIXTURE_FAIL rev-parse"; return 3; }
  case "${D1157_LEDGER_SHAPE:-parent-only}" in
    own-record)
      printf '%s\n' "2026-10-05T00:00:00Z | COMMITTED | pre-commit PASS (hook 层登记) | HASH=$C" > "$sb/.claude/bypass.log" ;;
    short-record)
      printf '%s\n' "2026-10-05T00:00:00Z | COMMITTED | pre-commit PASS | TASK_ID=X | AGENT=t | HASH=${C:0:8}" > "$sb/.claude/bypass.log" ;;
    *)  # parent-only（默认）：账本**只有**"提到 C 的非记录行"——旧判据的假"已登记"源
      printf '%s\n' "2026-10-05T00:00:00Z detected-bypass head-mismatch marker=0000000000000000000000000000000000000000 parent=$C" > "$sb/.claude/bypass.log" ;;
  esac
  # ② 合法 marker（pre-commit 时 HEAD = C^）⇒ 三判走 PASS_WAY=1（宁可多记一行，不丢证据）
  printf '%s|%s\n' "$(git -C "$sb" rev-parse HEAD^)" "$(date +%s)" > "$sb/.claude/last-precommit-success"
  # ③ 手动重跑 hook（HEAD 仍是 C）；沙箱内无 auditor/decide-next ⇒ 无同仓 git 副作用
  ( cd "$sb" && env SYNO_SESSION_ID=test bash "$sb/scripts/hooks/post-commit.sh" >/dev/null 2>&1 )
  # ④ 判定：镜像账本里是否出现 C 的 COMMITTED 记录（锚定口径 = 记录行 HASH= 值前缀匹配）
  REC_HIT="$(grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+[^ |]*[[:space:]]*\|?[[:space:]]*COMMITTED' "$sb/.claude/bypass.log" 2>/dev/null | grep -oE 'HASH=[0-9a-fA-F]{7,40}' | sed 's/^HASH=//' | tr 'A-F' 'a-f' | grep -c "^${C:0:8}" || true)"  # swallow-ok: 账本缺失/无记录 → 计 0（判定不省，见下方 case）
  case "${REC_HIT:-0}" in
    0) echo 0 ;;
    *) echo 1 ;;
  esac
}

# F2: 改坏即红（独立红例）—— 旧实现（**从 ref 取，H1**）在"账本只有 parent=<C>"下**不补记**
#
# 🔴 红例基线修复（2026-10-06，治理线 · W 组 G0 解锁件；改前实测 `❌ F2 **红例失效**`）。
#   病灶两处（同因：**拿 origin/main 当"旧实现"的来源**）:
#     ① main 上已无无锚实现可作红例 —— D1157(`9e29d88e0`) 已把锚定判据并进 main；
#     ② 旧 prefilter 用 `grep -q` 扫**全文（含注释）**判「是不是旧实现」，而 D1157 把旧模式串
#        **逐字写进了注释**（main 该文件:42 `#   旧判据 \`grep -q "$h" $srcs\` **无锚**`）
#        ⇒ prefilter 误判「main 仍是旧实现」⇒ 真跑锚定实现 ⇒ 得到"补记" ⇒ 红例恒失效。
#   后果（非本夹具局部）: 本测试在 CI 密封清单内 ⇒ 必需 context
#     `Control Tower Gate Tests (ubuntu-latest)` **恒红** ⇒ 一切触及 scripts/**、tests/**、
#     `.github/workflows/**`、`package.json` 的 PR 永久 blocked（本批实测 #1159/#1132 均红于此）。
#   ⇒ 修法（**保判别力，不是「改夹具迁就实现」**）:
#     · 基线改为「**引入 D1157-REC-RE 锚定判据那个提交的父提交**」= 最后的无锚实现
#       （用 `git log -S` 动态定位，不硬编码 sha；定位不到才退回 origin/main）；
#     · prefilter 只看**非注释行**（`grep -v '^[[:space:]]*#'`）—— 注释不再能冒充实现。
#   ⇒ 判别力仍成立（改坏即红）: 把该基线的 `_ledger_has_hash` 换成锚定版 ⇒ 本组立刻 F2 红；
#     下方 F-fixed 绿对照继续钉「本支实现必须补记」。
# 🔴 D1170 追账（独立复核实验③ 实测）: 必须加 `--reverse` 取**最初引入**该串的提交。
#   否则 `git log -S` 取的是**最新**改动计数的提交 —— 将来任何人在该文件注释里再提一次
#   `D1157-REC-RE`，基线就会被重定位到那个**已锚定**的提交 ⇒ 本夹具恒红
#   ⇒ 必需 context `Control Tower Gate Tests (ubuntu-latest)` 对所有后续 PR 恒红。
#   实测（复核构造的合法注释编辑）: 未加 --reverse 时 FIX_COMMIT 重定位
#   ⇒ `❌ F2 前提失败: 基线 …^ 的判据已锚定` / 32 通过 1 失败。
FIX_COMMIT="$(git -C "$REPO" log --reverse --format=%H -1 -S'D1157-REC-RE' origin/main -- scripts/hooks/post-commit.sh 2>/dev/null)"  # swallow-ok: 取不到即 FIX_COMMIT 空 ⇒ 下方显式回退 origin/main（有 fail-safe 分支，未静默）
if [ -n "$FIX_COMMIT" ]; then RED_BASE="${FIX_COMMIT}^"; else RED_BASE="origin/main"; fi
PREFIX_HOOK="$(git -C "$REPO" show "${RED_BASE}:scripts/hooks/post-commit.sh" 2>/dev/null)"  # swallow-ok: 取不到即下方显式判「F2 取数失败」
if [ -z "$PREFIX_HOOK" ]; then
  no "F2 取数失败: git show ${RED_BASE}:scripts/hooks/post-commit.sh 无输出（H1 要求读 ref，禁读工作树）"
else
  printf '%s\n' "$PREFIX_HOOK" > "$TMPD/post-commit-prefix.sh"
  # 前提：该 ref 判据确为无锚 —— **只看代码行**（注释里的同款字样不算实现；见上方病灶 ②）
  if grep -v '^[[:space:]]*#' "$TMPD/post-commit-prefix.sh" | grep -q 'grep -q "\$h" \$srcs'; then
    D1157_LEDGER_SHAPE=parent-only; OUT_P="$(d1157_probe "$TMPD/post-commit-prefix.sh")"
    case "$OUT_P" in
      0) ok "F2 改坏即红: 旧实现（无锚判据 @ ${RED_BASE}）在 parent-only 账本下**跳过补记** ⇒ 红例成立（漏记）" ;;
      1) no "F2 **红例失效**: 旧实现竟然补记了（夹具不再体现旧缺陷 ⇒ 判别性丢失，必须红）" ;;
      *) no "F2 夹具自身失败: ${OUT_P}" ;;
    esac
  else
    no "F2 前提失败: 基线 ${RED_BASE} 的 post-commit.sh 判据已锚定（本夹具需无锚实现作红例）"
  fi
  # F-fixed（H2 绿对照）: **本支实现**在同夹具下必须**补记**
  D1157_LEDGER_SHAPE=parent-only; OUT_F="$(d1157_probe "$HOOK_SRC")"
  case "$OUT_F" in
    1) ok "F-fixed 绿对照（H2）: 本支实现在同夹具下**补记** C ⇒ 红来自断言而非崩溃" ;;
    0) no "F-fixed 失败: 本支实现未补记（夹具坏或修复不生效）" ;;
    *) no "F-fixed 夹具自身失败: ${OUT_F}" ;;
  esac
fi

# F3 负对照: 已有自身记录 ⇒ 幂等保持（不重复写）
D1157_LEDGER_SHAPE=own-record; OUT_O="$(d1157_probe "$HOOK_SRC")"
case "$OUT_O" in
  1) ok "F3 负对照: 已有自身记录 ⇒ 仍算已登记（幂等未被打破）" ;;
  *) no "F3 夹具判据异常: ${OUT_O}（应 1）" ;;
esac
# F4 负对照: 8 位短 sha 记录 ⇒ 前缀判定仍算已登记（防过紧）
D1157_LEDGER_SHAPE=short-record; OUT_S="$(d1157_probe "$HOOK_SRC")"
case "$OUT_S" in
  1) ok "F4 负对照: HASH=<8 位短 sha> ⇒ 仍算已登记（前缀判定未过紧）" ;;
  *) no "F4 夹具判据异常: ${OUT_S}（应 1；过紧会让真记录被重复补记）" ;;
esac

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
