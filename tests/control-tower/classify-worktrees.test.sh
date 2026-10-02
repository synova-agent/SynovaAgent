#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# classify-worktrees.test.sh — 工作树三分类脚本测试（铁律 48：正常/边界/降级）
# 用例: A 可合（实质独有提交+干净）| B 作废（无独有提交+干净）| C 需改（脏）
#       D 只读红线（脚本运行不删任何工作树）| E 非 git 根 → exit 1
# 运行: bash tests/control-tower/classify-worktrees.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/control-tower/classify-worktrees.py"
PASS=0; FAIL=0
t() { if [ "$2" = "$3" ]; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1 (期望 $2 实际 $3)"; FAIL=$((FAIL+1)); fi; }

FIX=$(mktemp -d); trap 'rm -rf "$FIX"' EXIT
R="$FIX/repo"; mkdir -p "$R"; cd "$R" || exit 1
git init -q -b main . && git config user.email t@t && git config user.name t
echo base > f.txt && git add . && git commit -qm "chore: base"
git branch -q -c origin/main 2>/dev/null || git update-ref refs/remotes/origin/main HEAD

# A: 可合 —— 有实质独有提交、工作区干净
git worktree add -q -b feat/ok "$R/.synova-wt-ok" main
( cd "$R/.synova-wt-ok" && echo x > a.txt && git add . && git commit -qm "feat: real work" )

# B: 作废 —— 无独有提交、干净
git worktree add -q -b chore/none "$R/.synova-wt-none" main

# C: 需改 —— 有实质独有提交 + 未提交改动
git worktree add -q -b feat/dirty "$R/.synova-wt-dirty" main
( cd "$R/.synova-wt-dirty" && echo y > b.txt && git add . && git commit -qm "feat: pending" && echo z >> b.txt )

OUT="$FIX/out.md"
python3 "$SCRIPT" --root "$R" --out "$OUT" >/dev/null 2>&1; RC=$?
t "A 脚本 exit=0" 0 "$RC"
t "A 可合判定" 1 "$(grep -c '^| [0-9]* | `.synova-wt-ok` | 可合' "$OUT")"
t "B 作废判定" 1 "$(grep -c '^| [0-9]* | `.synova-wt-none` | 作废' "$OUT")"
t "C 需改判定" 1 "$(grep -c '^| [0-9]* | `.synova-wt-dirty` | 需改' "$OUT")"
t "A 三树全录" 3 "$(grep -c '^| [0-9]' "$OUT")"

# D: 只读红线 —— 跑完后工作树数与分支数不变
BEFORE_WT=$(git worktree list | wc -l | tr -d ' '); BEFORE_BR=$(git branch | wc -l | tr -d ' ')
python3 "$SCRIPT" --root "$R" --out "$OUT" >/dev/null 2>&1
t "D 工作树未被删" "$BEFORE_WT" "$(git worktree list | wc -l | tr -d ' ')"
t "D 分支未被删" "$BEFORE_BR" "$(git branch | wc -l | tr -d ' ')"

# E: 降级/错误路径 —— 非 git 根
NOTGIT="$FIX/notgit"; mkdir -p "$NOTGIT"
python3 "$SCRIPT" --root "$NOTGIT" >/dev/null 2>&1; t "E 非 git 根 exit=1" 1 $?

echo
echo "══ 结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
