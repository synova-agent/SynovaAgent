#!/bin/bash
# D313 M5 UTF-8 强制（与 scripts/ 同口径）: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# precommit-trailer.test.sh — D1068: 门禁证据载体 = commit trailer
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界；铁律 0-2: 接线 WIRE CHECK）:
#   1. 契约 path   — 默认落点 = <git-dir>/synova-evidence/precommit-pass，且落在**沙箱仓内**
#   2. 契约 write  — 4 行（version=1 / tree= / head= / epoch=<数字>），exit 0
#   3. 契约 hash   — 一行 64 位十六进制
#   4. 边界 hash   — 标记不存在 ⇒ exit 1（未跑门禁不得产出 trailer）
#   5. 边界 hash   — write→hash 后改标记内容 ⇒ 哈希变化（哈希绑定内容，不是恒定串）
#   6. 降级 hash   — 无 sha256 工具（sha256sum/shasum/certutil 皆不可用）⇒ exit 2，
#                    **不降级为弱哈希**（fail-closed；铁律 11 不静默）
#   7. 契约 verify — 正确哈希 ⇒ match(0) / 错哈希 ⇒ mismatch(1) / 标记缺失 ⇒ unverifiable(3)
#   8. 正常 态1    — 真实 git 仓 + 真实提交（消息含 `PreCommit-PASS:` trailer）⇒ 对账 exit 0
#   9. 降级 态2    — 无 trailer 但旧账本 `.claude/bypass.log` 含该提交 SHA ⇒ 对账仍 exit 0
#                    （过渡期兼容；本批 union 与旧日志写入都还在，此态是**必守**的）
#  10. 边界 态3    — 既无 trailer 也无账本记录 ⇒ 对账 exit 1，输出**点名该提交短 SHA**，
#                    且不误伤同区间内已有证据的提交（范围口径 `--no-merges`）
#  11. 判别性      — 同一沙箱内: 两提交皆有 trailer ⇒ exit 0；把**第 2 个提交** amend 成
#                    剥掉 trailer 的提交（树不变，仅消息变）⇒ exit 1 且只点第 2 个。
#                    判别对象 = trailer 本身，**不是**「仓库里存在某个标志」——
#                    历史实测: grep 型静态判据 3/5 = 60% 假绿，故此处全部用真提交 + 真改写。
#  12. 接线        — synova-commit / install-hooks.sh(pre-commit 包装器) 真调用
#                    precommit-evidence.sh；对账器用 `%(trailers:key=PreCommit-PASS)` 解析
#                    （非 grep 消息正文 —— 正文里恰好出现同串不得算通过）。
#                    判据 8/9/10/11 同时是「接线了 ≠ 被执行」的反证: 真仓库真提交跑通，
#                    而非 grep 源码。
#  13. 不变量      — 零副作用: 主仓/worktree 的默认证据标记位在本用例前后不变；
#                    沙箱在主仓树外且 core.hooksPath 指向空目录。
#
# 零副作用（三条注入缝，缺一不可）:
#   ① 全部 git 操作在 mktemp 沙箱仓内，且沙箱 `core.hooksPath` 指向空目录 ⇒ 不会触发
#      任何项目 hook（因此不会往主仓/主树写任何东西）；
#   ② `SYNO_EVIDENCE_MARKER` 覆盖标记落点 ⇒ 不写主仓 .git；
#   ③ `SYNO_BASE_REF` 显式给沙箱基线 SHA ⇒ 对账器不做任何 `git fetch`（零网络）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/control-tower/precommit-evidence.sh"
CHECKER="$REPO_DIR/scripts/control-tower/check-bypass-log.sh"
COMMITTER="$REPO_DIR/scripts/control-tower/synova-commit"
INSTALLER="$REPO_DIR/scripts/install-hooks.sh"
BASH_BIN="$(command -v bash)"

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

# ── 零副作用基线（末尾判据 13 复检）: 主仓/worktree 的默认证据标记位存在性 ──────────
REPO_MARKER="$(cd "$REPO_DIR" && bash "$TOOL" path 2>/dev/null || true)"
case "${REPO_MARKER:-}" in
  */synova-evidence/precommit-pass) ;;
  *) REPO_MARKER="" ;;
esac
if [ -n "$REPO_MARKER" ]; then
  if [ -e "$REPO_MARKER" ]; then REPO_MARKER_BEFORE=present; else REPO_MARKER_BEFORE=absent; fi
else
  REPO_MARKER_BEFORE=unknown
fi

PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
OUT=""; RC=0
run() { OUT="$( "$@" 2>&1 )"; RC=$?; }

# ── 沙箱 git 仓（core.hooksPath → 空目录: 保证项目 hook 一律不触发）──────────────
_mkrepo() { # $1=目录; stdout=base SHA
  local d="$1"
  mkdir -p "$d/.nohooks"
  git -C "$d" init -q
  git -C "$d" symbolic-ref HEAD refs/heads/main
  git -C "$d" config user.name "D1068-test"
  git -C "$d" config user.email "d1068@test.local"
  git -C "$d" config commit.gpgsign false
  git -C "$d" config core.hooksPath .nohooks
  printf 'seed\n' > "$d/seed.txt"
  git -C "$d" add -A
  git -C "$d" commit -qm "chore: sandbox base"
  git -C "$d" rev-parse HEAD
}

_cmt() { # $1=目录 $2=文件 $3=内容 $4=subject $5=trailer 值（空=不写 trailer）; stdout=新 SHA
  local d="$1"
  printf '%s\n' "$3" > "$d/$2"
  git -C "$d" add -A
  if [ -n "${5:-}" ]; then
    git -C "$d" commit -qm "$4" -m "PreCommit-PASS: $5"
  else
    git -C "$d" commit -qm "$4"
  fi
  git -C "$d" rev-parse HEAD
}

_ledger_reg() { # $1=目录 $2=提交 SHA —— 复刻 post-commit.sh 的「成对登记提交」(只碰 bypass.log)
  local d="$1"
  mkdir -p "$d/.claude"
  printf '%s | COMMITTED | pre-commit PASS (hook 层登记) | HASH=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" >> "$d/.claude/bypass.log"
  git -C "$d" add -- .claude/bypass.log
  git -C "$d" commit -qm "chore: bypass COMMITTED 登记 (auto hook, D521)" -- .claude/bypass.log
  git -C "$d" rev-parse HEAD
}

_check() { # $1=沙箱目录 $2=base ref; 在沙箱内跑对账器 → OUT/RC
  OUT="$(cd "$1" && SYNO_BASE_REF="$2" bash "$CHECKER" 2>&1)"
  RC=$?
}

_short() { printf '%s' "${1:0:8}"; }

echo "═══════════════════════════════════════════════════════════"
echo "  D1068 — 门禁证据载体 = commit trailer"
echo "═══════════════════════════════════════════════════════════"

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 1. 契约: path 默认落点（沙箱仓内 ⇒ 零主仓污染）──"
CSA="$TMPD/sb-contract"
C0_CONTRACT="$(_mkrepo "$CSA")"
CSA_PHYS="$(cd "$CSA" && pwd -P)"   # macOS: /var → /private/var，git 返回物理路径
CSA_GITD="$(cd "$CSA" && git rev-parse --absolute-git-dir 2>/dev/null)"   # 跨平台归一形式
OUT="$(cd "$CSA" && bash "$TOOL" path 2>&1)"; RC=$?
echo "    path = $OUT (exit=$RC)"
case "$OUT" in
  "$CSA_GITD"/synova-evidence/precommit-pass|"$CSA_PHYS"/.git/synova-evidence/precommit-pass|"$CSA"/.git/synova-evidence/precommit-pass)
    ok "默认落点 = <sandbox-git-dir>/synova-evidence/precommit-pass（在 .git 内 ⇒ 不被 git 跟踪）" ;;
  *) no "默认落点异常: [$OUT]（期望 <sandbox-git-dir>/synova-evidence/precommit-pass；沙箱 git-dir=${CSA_GITD}）" ;;
esac
[ "$RC" = 0 ] && ok "path exit 0（只解析，不写）" || no "path exit=$RC"

echo ""
echo "── 2. 契约: write 内容（4 行）+ hash 形状 ──"
M="$TMPD/marker/one"
OUT="$(cd "$CSA" && SYNO_EVIDENCE_MARKER="$M" bash "$TOOL" write 2>&1)"; RC=$?
echo "    write exit=${RC}（stdout 应为空）; stdout=[$OUT]"
[ "$RC" = 0 ] && [ -z "$OUT" ] && ok "write exit 0 且无 stdout" || no "write exit=$RC out=$OUT"
if [ -f "$M" ]; then ok "标记文件已落盘: $M"; else no "标记文件未生成: $M"; fi
NL="$(wc -l < "$M" 2>/dev/null | tr -d ' \r\n')"   # swallow-ok: 紧随形状断言，失败即 FAIL
[ "$NL" = "4" ] && ok "标记 4 行" || no "标记行数 = ${NL}（应 4）"
echo "    标记原文:"; sed 's/^/      /' "$M"
grep -q '^version=1$' "$M" && ok "version=1" || no "缺 version=1"
grep -qE '^tree=[0-9a-f]{4,}$' "$M" && ok "tree=<write-tree 非空>" || no "tree 行异常"
grep -q "^head=${C0_CONTRACT}$" "$M" && ok "head=<当前 HEAD>" || no "head 行与 HEAD 不符"
grep -qE '^epoch=[0-9]+$' "$M" && ok "epoch=<秒级时间戳数字>" || no "epoch 行异常"
H1="$(cd "$CSA" && SYNO_EVIDENCE_MARKER="$M" bash "$TOOL" hash 2>/dev/null)"
printf '%s' "$H1" | grep -qE '^[0-9a-f]{64}$' && ok "hash = 64 位十六进制（${H1:0:12}…）" || no "hash 形状异常: [$H1]"

echo ""
echo "── 3. 边界: hash 无标记 ⇒ exit 1（未跑门禁不得产出 trailer）──"
run env SYNO_EVIDENCE_MARKER="$TMPD/marker/absent" bash "$TOOL" hash
[ "$RC" = 1 ] && ok "标记不存在 ⇒ exit 1" || no "标记不存在却 exit=${RC}（应 1）"
printf '%s' "$OUT" | grep -q "标记不存在" && ok "降级/拦截信息点名「标记不存在」" || no "信息未点名: $OUT"

echo ""
echo "── 4. 边界: 改标记内容 ⇒ 哈希变化（哈希绑定内容）──"
printf 'tampered=1\n' >> "$M"
H2="$(cd "$CSA" && SYNO_EVIDENCE_MARKER="$M" bash "$TOOL" hash 2>/dev/null)"
echo "    改前 hash=${H1:0:12}… / 改后 hash=${H2:0:12}…"
if [ -n "$H1" ] && [ -n "$H2" ] && [ "$H1" != "$H2" ]; then
  ok "内容变 ⇒ 哈希变（非恒定串）"
else
  no "哈希未随内容变化: H1=[$H1] H2=[$H2]"
fi

echo ""
echo "── 5. 降级: 无 sha256 工具 ⇒ exit 2（不降级为弱哈希）──"
EMPTYBIN="$TMPD/nobin"; mkdir -p "$EMPTYBIN"
run env PATH="$EMPTYBIN" SYNO_EVIDENCE_MARKER="$M" "$BASH_BIN" "$TOOL" hash
[ "$RC" = 2 ] && ok "无 sha256 工具 ⇒ exit 2（fail-closed）" || no "无工具却 exit=${RC}（应 2，不得降级弱哈希）"
printf '%s' "$OUT" | grep -q "无 sha256 工具" && ok "降级信息明示「无 sha256 工具 … 不降级为弱哈希」" || no "降级信息缺: $OUT"

echo ""
echo "── 6. 契约: verify 三态 ──"
run env SYNO_EVIDENCE_MARKER="$M" bash "$TOOL" verify "$H2"
{ [ "$RC" = 0 ] && [ "$OUT" = "match" ]; } && ok "verify 正确哈希 ⇒ match/0" || no "verify 正确哈希: exit=$RC out=$OUT"
run env SYNO_EVIDENCE_MARKER="$M" bash "$TOOL" verify "0000000000000000000000000000000000000000000000000000000000000000"
{ [ "$RC" = 1 ] && [ "$OUT" = "mismatch" ]; } && ok "verify 错哈希 ⇒ mismatch/1" || no "verify 错哈希: exit=$RC out=$OUT"
run env SYNO_EVIDENCE_MARKER="$TMPD/marker/absent" bash "$TOOL" verify "$H2"
{ [ "$RC" = 3 ] && [ "$OUT" = "unverifiable" ]; } && ok "verify 标记缺失 ⇒ unverifiable/3（与 mismatch 显式区分）" || no "verify 标记缺失: exit=$RC out=$OUT"
run bash "$TOOL" verify
[ "$RC" = 1 ] && ok "verify 缺参数 ⇒ exit 1 + 用法" || no "verify 缺参数 exit=${RC}"

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 7. 三态对账（真实 git 仓 + 真实提交）──"
A="$TMPD/sb-states"
C0_A="$(_mkrepo "$A")"
# 态3 提交排最前: 之后用 base=它 隔离出「只有 态1+态2」的绿区间（同一仓两读）
A_BAD="$(_cmt "$A" a.txt "no-evidence" "feat: 态3 无 trailer 无账本" "")"
A_TRAILER="$(_cmt "$A" b.txt "trailered" "feat: 态1 有 trailer" \
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")"
A_LEGACY="$(_cmt "$A" c.txt "legacy" "feat: 态2 无 trailer（靠旧账本兜底）" "")"
A_REG="$(_ledger_reg "$A" "$A_LEGACY")"
echo "    base=$(_short "$C0_A") 态3=$(_short "$A_BAD") 态1=$(_short "$A_TRAILER") 态2=$(_short "$A_LEGACY") 登记=$(_short "$A_REG")"

echo ""
echo "  ▸ 8. 态1+态2 区间（base=态3 提交）⇒ exit 0"
_check "$A" "$A_BAD"; R12=$RC; O12="$OUT"
echo "    exit=$R12"
printf '%s\n' "$O12" | sed 's/^/      /'
[ "$R12" = 0 ] && ok "态1（trailer）+ 态2（旧账本）均通过 ⇒ exit 0" || no "应有证据区间却 exit=$R12"
printf '%s' "$O12" | grep -q "trailer=1" && ok "证据形态分布点名 trailer=1 笔（态1 真被执行）" || no "分布未显示 trailer=1: $O12"
printf '%s' "$O12" | grep -q "旧账本（兼容）=1" && ok "证据形态分布点名 旧账本（兼容）=1 笔（态2 兼容过渡仍生效）" \
  || no "分布未显示 旧账本（兼容）=1: $O12"

echo ""
echo "  ▸ 9. 全区间（base=沙箱基线）⇒ exit 1，且点名态3 提交"
_check "$A" "$C0_A"; R3=$RC; O3="$OUT"
echo "    exit=$R3"
printf '%s\n' "$O3" | sed 's/^/      /'
[ "$R3" = 1 ] && ok "两者皆无 ⇒ exit 1（态3 硬拦）" || no "态3 却 exit=${R3}（应 1）"
printf '%s' "$O3" | grep -q "$(_short "$A_BAD")" && ok "输出点名态3 提交短 SHA $(_short "$A_BAD")" || no "未点名态3 提交"
printf '%s' "$O3" | grep -q "$(_short "$A_TRAILER")" && no "误伤态1 提交（有 trailer 也报）" || ok "未误伤态1 提交（有 trailer 不报）"
printf '%s' "$O3" | grep -q "$(_short "$A_LEGACY")" && no "误伤态2 提交（旧账本有记录也报）" || ok "未误伤态2 提交（旧账本有记录即通过）"
printf '%s' "$O3" | grep -q "$(_short "$A_REG")" && no "误伤纯补记提交（D451 豁免失效）" || ok "纯补记提交（只改 bypass.log）被 D451 豁免"

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 10. 判别性（本卡核心）: 剥掉 trailer ⇒ 对账由 exit 0 变 exit 1 ──"
D="$TMPD/sb-discrim"
C0_D="$(_mkrepo "$D")"
DM="$TMPD/marker/discrim"
# 第 1 提交: 按正常路径产出（trailer 值 = 真实 precommit-evidence.sh hash 输出）
printf 'one\n' > "$D/d1.txt"; git -C "$D" add -A
D_W1="$(cd "$D" && SYNO_EVIDENCE_MARKER="$DM" bash "$TOOL" write 2>&1)"; D_RW1=$?
D_H1="$(cd "$D" && SYNO_EVIDENCE_MARKER="$DM" bash "$TOOL" hash 2>/dev/null)"
git -C "$D" commit -qm "feat: discrim c1" -m "PreCommit-PASS: $D_H1"
D_C1="$(git -C "$D" rev-parse HEAD)"
# 第 2 提交: 同样走正常路径（标记被覆盖 ⇒ 树/时间戳变 ⇒ 哈希应不同）
printf 'two\n' > "$D/d2.txt"; git -C "$D" add -A
D_W2="$(cd "$D" && SYNO_EVIDENCE_MARKER="$DM" bash "$TOOL" write 2>&1)"; D_RW2=$?
D_H2="$(cd "$D" && SYNO_EVIDENCE_MARKER="$DM" bash "$TOOL" hash 2>/dev/null)"
git -C "$D" commit -qm "feat: discrim c2" -m "PreCommit-PASS: $D_H2"
D_C2="$(git -C "$D" rev-parse HEAD)"
D_TREE_BEFORE="$(git -C "$D" rev-parse 'HEAD^{tree}')"
echo "    write exit=${D_RW1}/${D_RW2}（stderr+stdout 均应为空）"
echo "    c1 trailer=$D_H1"
echo "    c2 trailer=$D_H2"
[ "$D_H1" != "$D_H2" ] && ok "两次 write→hash 得到不同 trailer（标记随树/时间变化）" \
  || no "两次 trailer 相同（哈希未绑定 write 内容）"

_check "$D" "$C0_D"; R_GREEN=$RC; O_GREEN="$OUT"
echo ""
echo "  ▸ 11a. 剥除前（c1、c2 皆有 trailer）⇒ exit ${R_GREEN}"
printf '%s\n' "$O_GREEN" | sed 's/^/      /'
[ "$R_GREEN" = 0 ] && ok "有 trailer ⇒ 对账 exit 0（前置绿成立）" || no "前置应有 trailer 却 exit=$R_GREEN"

# 「静默剥掉 trailer」= 模拟 synova-commit 不再追加 —— 只改消息，不改树
git -C "$D" commit --amend -qm "feat: discrim c2（剥掉 trailer）"
D_C2B="$(git -C "$D" rev-parse HEAD)"
D_TREE_AFTER="$(git -C "$D" rev-parse 'HEAD^{tree}')"
D_TRAILER_AFTER="$(git -C "$D" log -1 --format='%(trailers:key=PreCommit-PASS,valueonly)' 2>/dev/null | tr -d ' \r\n')"  # swallow-ok: 紧随判别性断言，失败即 FAIL
echo ""
echo "    amend 前树=$D_TREE_BEFORE / amend 后树=$D_TREE_AFTER"
echo "    改写后 c2 短 SHA=$(_short "$D_C2B")，其 trailer 值=[$D_TRAILER_AFTER]（空 = 已剥净）"
[ "$D_TREE_BEFORE" = "$D_TREE_AFTER" ] && ok "树未变（唯一差异 = 消息里的 trailer ⇒ 判别对象就是 trailer 本身）" \
  || no "树变了（判别性被污染: 无法排除是内容变化导致）"
[ -z "$D_TRAILER_AFTER" ] && ok "改写后该提交已无 PreCommit-PASS trailer（剥除动作成立）" \
  || no "剥离失败，trailer 仍在: [$D_TRAILER_AFTER]"

_check "$D" "$C0_D"; R_RED=$RC; O_RED="$OUT"
echo ""
echo "  ▸ 11b. 剥除后（c2 无 trailer，且无旧账本）⇒ exit ${R_RED}"
printf '%s\n' "$O_RED" | sed 's/^/      /'
[ "$R_RED" = 1 ] && ok "剥掉 trailer ⇒ 对账变红 exit 1（改坏即红，物理成立）" || no "剥掉 trailer 却 exit=${R_RED}（应 1）"
printf '%s' "$O_RED" | grep -q "$(_short "$D_C2B")" && ok "点名被剥的提交 $(_short "$D_C2B")" || no "未点名被剥提交"
printf '%s' "$O_RED" | grep -q "$(_short "$D_C1")" && no "误伤未被改动的 c1（判别未落在被改提交上）" \
  || ok "未误伤未改动的 c1（判别精确到被剥提交）"

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 12. 接线（铁律 0-2 WIRE CHECK）──"
grep -qE 'EVIDENCE_SH="\$SCRIPT_DIR/precommit-evidence\.sh"' "$COMMITTER" \
  && ok "synova-commit 绑定证据脚本路径（EVIDENCE_SH）" || no "synova-commit 未绑定 precommit-evidence.sh"
grep -qE 'bash "\$EVIDENCE_SH" write' "$COMMITTER" \
  && ok "synova-commit 真调用 write（非注释/非仅提及）" || no "synova-commit 未真调用 write"
grep -qE 'bash "\$EVIDENCE_SH" hash' "$COMMITTER" \
  && ok "synova-commit 真调用 hash（trailer 取值来源）" || no "synova-commit 未真调用 hash"
grep -q 'PreCommit-PASS' "$COMMITTER" \
  && ok "synova-commit 写入 PreCommit-PASS trailer" || no "synova-commit 未写 trailer 键"
grep -qE 'precommit-evidence\.sh" write' "$INSTALLER" \
  && ok "install-hooks.sh 的 pre-commit 包装器真调用 write（hook 层接线）" \
  || no "install-hooks.sh 未调用 precommit-evidence.sh write"
grep -q 'trailers:key=PreCommit-PASS' "$CHECKER" \
  && ok "对账器用 git trailer 解析（非 grep 消息正文 ⇒ 正文同串不误判通过）" \
  || no "对账器未用 %(trailers:key=PreCommit-PASS)"
grep -q '态 3' "$CHECKER" \
  && ok "对账器保留态3 硬拦（三态齐备）" || no "对账器缺态3"

echo ""
echo "── 13. 零副作用不变量（沙箱外零写入）──"
case "$TMPD" in
  "$REPO_DIR"/*) no "沙箱落在主仓树内（可能触发项目 hook）: $TMPD" ;;
  *) ok "沙箱在主仓树外（${TMPD}）+ 沙箱 core.hooksPath=空目录 ⇒ 项目 hook 零触发" ;;
esac
if [ "$REPO_MARKER_BEFORE" = "unknown" ]; then
  no "无法解析主仓证据标记位（path 子命令异常）"
else
  if [ -e "$REPO_MARKER" ]; then REPO_MARKER_NOW=present; else REPO_MARKER_NOW=absent; fi
  [ "$REPO_MARKER_NOW" = "$REPO_MARKER_BEFORE" ] \
    && ok "主仓标记位 ${REPO_MARKER} 本用例前后不变（${REPO_MARKER_NOW}）" \
    || no "主仓标记位被本用例改变: ${REPO_MARKER_BEFORE} → ${REPO_MARKER_NOW}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ 全部通过: $PASS 项"
  echo "═══════════════════════════════════════════════════════════"
  exit 0
else
  echo "  ❌ $FAIL 项失败 / $PASS 项通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
