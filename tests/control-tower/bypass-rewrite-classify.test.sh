#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# bypass-rewrite-classify.test.sh — #1270「重写 vs 真绕过」分类判别夹具
#
# 背景（#1270，Lead 2026-10-07 立案）: gatekeeper 把 `git rebase` 重放的提交误判为 `--no-verify`
#   （实测当日 8 条 `head-mismatch` 误报，需人工 ACK 放行两次）。要求: 能区分则区分；
#   不能区分就保留误报但台账显式标注 suspect（把"疑似"与"确证"分开，**不许静默漏判**）。
#
# 判别方式（真执行，非 grep 静态判据）:
#   ① 在合成 git 仓里**真跑** scripts/hooks/post-commit.sh，断言它写出的记录类型；
#   ② 从 scripts/pre-commit-check.sh 提取 GATEKEEPER-COUNT 段**真执行**，断言语义分离。
#
# 覆盖矩阵（铁律 48 三路径 + 判别性）:
#   正常 — 真绕过（无重写信号）⇒ `detected-bypass head-mismatch`（不许因新增分类而漏判）
#   正常 — 重写·同 tree 同 subject（rebase 重放形态）⇒ `suspected-rewrite … suspect=same-tree-subject`
#   边界 — rebase 进行中（.git/rebase-merge 存在）⇒ `suspected-rewrite … suspect=in-progress`
#   降级 — 只有 suspected 行 ⇒ gatekeeper **不阻断**且打印可见计数；有确证行 ⇒ 阻断（ACK 可放行）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$REPO/scripts/hooks/post-commit.sh"
PRECOMMIT="$REPO/scripts/pre-commit-check.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== #1270: 重写 vs 真绕过 分类夹具 ==="

# ── 合成仓 ──
SB="$TMPD/repo"
mkdir -p "$SB/.claude"
( cd "$SB" && git init -q && git config user.email t@example.com && git config user.name t \
    && printf '.claude/\n' > .gitignore \
    && echo one > f.txt && git add -A && git commit -qm "s" ) >/dev/null 2>&1
A="$(git -C "$SB" rev-parse HEAD)"
TREE_A="$(git -C "$SB" rev-parse 'HEAD^{tree}')"
# marker = A（pre-commit 通过时刻的 HEAD）
printf '%s|%s\n' "$A" "$(git -C "$SB" show -s --format=%ct HEAD)" > "$SB/.claude/last-precommit-success"

run_hook() {   # 在合成仓里真跑 post-commit 钩子
  ( cd "$SB" && bash "$HOOK" ) >/dev/null 2>&1
}
mirror() { sed -n '1,200p' "$SB/.claude/bypass.log" 2>/dev/null || true; }

# ── 工具: 在合成仓造一个「marker 非祖先」的提交（旧逻辑的 mismatch 形态）──
#   $1 = 用作新提交的 tree（缺省 = 当前 HEAD 的 tree）;  $2 = 新提交 subject
make_nonancestor() {
  local tree="$1" subj="$2" p new
  ( cd "$SB" && git checkout -q --orphan "root-$RANDOM" && git rm -rq --cached . >/dev/null 2>&1; \
    echo "r$RANDOM" > "root-$RANDOM.txt" && git add -A && git commit -qm "root-scaffold" ) >/dev/null 2>&1
  p="$(git -C "$SB" rev-parse HEAD)"
  new="$(cd "$SB" && printf '%s' "$subj" | git commit-tree "$tree" -p "$p")"
  ( cd "$SB" && git checkout -q -B main "$new" ) >/dev/null 2>&1
  printf '%s' "$new"
}

# ── 用例 ①（正常）: 真绕过 —— marker 非祖先 ∧ 无任何重写信号 ⇒ 必须 detected-bypass（不漏判）──
: > "$SB/.claude/bypass.log"
TREE_OTHER="$(git -C "$SB" rev-parse 'HEAD^{tree}')"
make_nonancestor "$TREE_OTHER" "unrelated-subject" >/dev/null
printf '%s|%s\n' "$A" "$(git -C "$SB" show -s --format=%ct "$A")" > "$SB/.claude/last-precommit-success"
run_hook
if mirror | grep -q 'detected-bypass head-mismatch'; then
  ok "① 真绕过（marker 非祖先、无重写信号）⇒ detected-bypass head-mismatch（分类未吞掉真信号）"
else
  no "① 真绕过未被判 detected-bypass：$(mirror | tail -1)"
fi

# ── 用例 ②（正常）: 重写·同 tree 同 subject（rebase 重放形态）⇒ suspected-rewrite ──
: > "$SB/.claude/bypass.log"
make_nonancestor "$TREE_A" "s" >/dev/null
printf '%s|%s\n' "$A" "$(git -C "$SB" show -s --format=%ct "$A")" > "$SB/.claude/last-precommit-success"
run_hook
if mirror | grep -q 'suspected-rewrite head-mismatch' && mirror | grep -q 'suspect=tree-subject-match' && mirror | grep -q 'forgeable=0'; then
  ok "② 重写·同 tree 同 subject ⇒ suspected-rewrite（suspect=tree-subject-match，**内容类 forgeable=0**）"
elif mirror | grep -q 'detected-bypass'; then
  no "② 判成真绕过（误报未消）：$(mirror | tail -1)"
else
  no "② 无记录写出（静默漏判）：$(mirror | tail -1)"
fi

# ── 用例 ③（边界）: rebase 进行中 + **佐证通过** ⇒ suspected-rewrite … suspect=rebase-state ──
#   R1 收口（verifier P2）: 仅「目录存在」不算 —— 须 orig-head 存在且 marker 是其祖先。
: > "$SB/.claude/bypass.log"
mkdir -p "$SB/.git/rebase-merge"
# orig-head = 重写前的分支头（A 的后代 ⇒ marker A 是它的祖先）✓ 佐证通过
ORIG="$(cd "$SB" && git commit-tree "$TREE_OTHER" -p "$A" -m "pre-rewrite-head")"
printf '%s\n' "$ORIG" > "$SB/.git/rebase-merge/orig-head"
make_nonancestor "$TREE_OTHER" "yet-another-subject" >/dev/null
run_hook
rm -rf "$SB/.git/rebase-merge"
if mirror | grep -q 'suspected-rewrite head-mismatch' && mirror | grep -q 'suspect=rebase-state' && mirror | grep -q 'kind=in-progress' && mirror | grep -q 'forgeable=1'; then
  ok "③ rebase 进行中（orig-head 佐证通过）⇒ suspected-rewrite（suspect=rebase-state，forgeable=1）"
elif mirror | grep -q 'detected-bypass'; then
  no "③ 佐证通过的 in-progress 被判 detected（漏判重写）：$(mirror | tail -1)"
else
  no "③ 无记录写出：$(mirror | tail -1)"
fi

# ── 用例 ⑤（R1 核心反例）: **陈旧** .git/rebase-merge 残留（无 orig-head）+ 真绕过 ⇒ 必须 detected ──
#   旧实现只看目录存在 ⇒ 一条中断的 rebase 会把此后所有 mismatch 洗成 suspected（verifier 实测污染）。
: > "$SB/.claude/bypass.log"
mkdir -p "$SB/.git/rebase-merge"          # 残留目录（无 orig-head）
make_nonancestor "$TREE_OTHER" "stale-dir-true-bypass" >/dev/null
run_hook
rm -rf "$SB/.git/rebase-merge"
if mirror | grep -q 'detected-bypass head-mismatch'; then
  ok "⑤ 陈旧 rebase-merge 残留（无佐证）+ 真绕过 ⇒ **detected-bypass**（不得降级为 suspected）"
else
  no "⑤ 陈旧残留把真绕过洗成 suspected（R1 未收口）：$(mirror | tail -1)"
fi

# ── 用例 ⑥（R1 核心反例）: 伪造佐证（orig-head 与 marker 无祖先关系）+ 真绕过 ⇒ 必须 detected ──
: > "$SB/.claude/bypass.log"
mkdir -p "$SB/.git/rebase-merge"
( cd "$SB" && git checkout -q --orphan "fake-$RANDOM" && git rm -rq --cached . >/dev/null 2>&1; \
  echo f > "fake-$RANDOM.txt" && git add -A && git commit -qm "unrelated-orig" ) >/dev/null 2>&1
UNREL="$(git -C "$SB" rev-parse HEAD)"
printf '%s\n' "$UNREL" > "$SB/.git/rebase-merge/orig-head"     # 佐证不成立: A 非 UNREL 祖先
make_nonancestor "$TREE_OTHER" "forged-state-true-bypass" >/dev/null
run_hook
rm -rf "$SB/.git/rebase-merge"
if mirror | grep -q 'detected-bypass head-mismatch'; then
  ok "⑥ 伪造佐证（orig-head 与 marker 无祖先关系）+ 真绕过 ⇒ **detected-bypass**（不可用 mkdir 洗白）"
else
  no "⑥ 伪造佐证即把真绕过洗成 suspected（可绕过）：$(mirror | tail -1)"
fi

# ── 用例 ④（降级/分离）: gatekeeper 计数段 —— 只有 suspected ⇒ 不阻断；有确证 ⇒ 阻断 ──
awk '/^# GATEKEEPER-COUNT-BEGIN/,/^# GATEKEEPER-COUNT-END/' "$PRECOMMIT" | sed 's/^# GATEKEEPER-COUNT-.*$//' > "$TMPD/gk.sh"
if [ -s "$TMPD/gk.sh" ] && grep -q 'suspected-rewrite' "$TMPD/gk.sh"; then
  ok "④ 提取: gatekeeper 计数段含 suspected/确证 双计数（${TMPD}/gk.sh）"
else
  no "④ 提取失败: gatekeeper 计数段无 suspected 计数（语义分离未落地）"
fi
TODAY="$(date +%Y-%m-%d)"
run_gk() {   # $1 = bypass.log 内容 ; 输出 rc + stdout（$2=github|local，缺省 local）
  # 🔴 夹具构造修正（CI 首轮实测 ④a/④b 落空）: 该段本身是**本地专属**——
  #   条件含 `[ "${GITHUB_ACTIONS:-}" != "true" ]` ⇒ 在 CI runner 上（GITHUB_ACTIONS=true）**整段按设计跳过**。
  #   故夹具必须显式声明语境：local（置空 GITHUB_ACTIONS）行使本地语义；github 用于钉住"CI 上跳过"这条语义本身。
  local logf="$TMPD/bl.txt" mode="${2:-local}"; printf '%s\n' "$1" > "$logf"
  if [ "$mode" = "github" ]; then
    ( ROOT="$SB"; BYPASS_LOG="$logf"; TODAY="$TODAY"; GITHUB_ACTIONS=true; unset SYNO_GATEKEEPER_ACK; . "$TMPD/gk.sh" ) 2>&1
  else
    ( ROOT="$SB"; BYPASS_LOG="$logf"; TODAY="$TODAY"; GITHUB_ACTIONS=""; unset SYNO_GATEKEEPER_ACK; . "$TMPD/gk.sh" ) 2>&1
  fi
  return $?
}
OUT="$(run_gk "${TODAY}T00:00:00Z suspected-rewrite head-mismatch marker=aaa parent=bbb suspect=rebase-state kind=in-progress forgeable=1")"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$OUT" | grep -q 'suspected-rewrite（重写误报' \
   && printf '%s' "$OUT" | grep -q 'rebase-state=1' && printf '%s' "$OUT" | grep -q '可伪造类(forgeable=1)=1'; then
  ok "④a 只有 suspected ⇒ **不阻断**（rc=0）且**按类可见**（rebase-state=1 / 可伪造类=1）"
else
  no "④a suspected 仍阻断或无可见计数（rc=${rc}）：$(printf '%s' "$OUT" | tail -1)"
fi
OUT="$(run_gk "${TODAY}T00:00:00Z detected-bypass head-mismatch marker=aaa parent=bbb")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$OUT" | grep -q '检测到今日 1 次'; then
  ok "④b 有确证行 ⇒ 仍硬阻断（rc=${rc}）—— 分离未放过真绕过"
else
  no "④b 确证行未阻断（rc=${rc}）"
fi

OUT="$(run_gk "${TODAY}T00:00:00Z detected-bypass head-mismatch marker=aaa parent=bbb" github)"; rc=$?
if [ "$rc" -eq 0 ]; then
  ok "④c CI 语境（GITHUB_ACTIONS=true）⇒ gatekeeper 段**按设计跳过**（rc=0；本地专属语义被钉住）"
else
  no "④c CI 语境未按设计跳过（rc=${rc}）—— 若有意改成 CI 也阻断，须同步改判据与注释"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
