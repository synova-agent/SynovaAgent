#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# ci-ratchet-base.test.sh — D721 CI 存量失败棘轮「变更集基准」的密封测试
#
# 背景: #513 永红复盘。ci.yml 的 Vitest 作业有一层存量失败棘轮——失败用例若不在
# 「本次改动」集合内即放行。判据原为 `CHANGED=$(git diff --name-only HEAD~1..HEAD)`，
# 在**合并提交**（刷新分支时 git merge origin/main）上 HEAD~1 = 分支尖端，
# 于是「被并入的 main 全部改动」被算成本 PR 改动 → 存量红被误判为新增红 → PR 永红。
# 实证: #513 head bf6ac999 与当时 main 5aae38fc `git diff` 为 0 个文件，却判 3 个新增失败，重跑两次复现。
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   ① 反例固化 — 旧判据 HEAD~1..HEAD 在合并提交上**确实**纳入 main 并入的文件（证明修的是真缺陷）
#   ② 正常路径 — 新判据 merge-base(origin/main,HEAD)..HEAD **排除** main 并入的文件
#   ③ 边界     — 新判据仍**保留**本分支自己的改动（不能把变更集算空，否则棘轮永远放行）
#   ④ 无合并   — 普通单提交分支上新旧判据等价（防修复引入行为漂移）
#   ⑤ 判据降级 — origin/main 缺失时回退旧判据**且**打 ::warning::（铁律 11：降级可见）
#   ⑥ 放行可见 — 存量红放行分支必打 ::warning:: + 列出文件名（不再静默）
#   接线       — ci.yml 真的调用本测试（防「机制建成未接线」M3）
# 沙箱: mktemp git 仓库，零网络零真实仓库历史依赖
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI="$REPO/.github/workflows/ci.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# ── 沙箱：main 前进 + 分支合并 main 的合并提交 ─────────────────
SB="$TMPD/repo"
mkdir -p "$SB/src"
(
  cd "$SB" || exit 1
  git init -q -b main .
  git config user.email t@example.com
  git config user.name t
  git config commit.gpgsign false
  echo a > src/foo.ts; echo a > README.md
  git add -A; git commit -qm "init"
  git checkout -qb feature
  echo b > src/bar.ts
  git add -A; git commit -qm "feat: bar"
  # main 前进（模拟「main 改了 foo.ts」= 存量红的来源文件）
  git checkout -q main
  echo c > src/foo.ts; echo d > src/baz.ts
  git add -A; git commit -qm "main: foo+baz"
  git update-ref refs/remotes/origin/main main
  # 回到分支并合并 main → 产生合并提交（= CTO 刷新分支的动作）
  git checkout -q feature
  git merge -q --no-edit main
) >/dev/null 2>&1

cd "$SB" || exit 1
OLD=$(git diff --name-only HEAD~1..HEAD 2>/dev/null || echo "")
BASE=$(git merge-base refs/remotes/origin/main HEAD 2>/dev/null || echo "")
NEW=$([ -n "$BASE" ] && git diff --name-only "$BASE"..HEAD 2>/dev/null || echo "")

# ① 反例固化：旧判据在合并提交上纳入 main 并入的文件
echo "$OLD" | grep -q '^src/foo.ts$' \
  && ok "① 旧判据 HEAD~1..HEAD 确实纳入 main 并入的 src/foo.ts（缺陷可复现）" \
  || no "① 旧判据未纳入 src/foo.ts（沙箱构建有误）: [$OLD]"
echo "$OLD" | grep -q '^src/baz.ts$' \
  && ok "① 旧判据同样纳入 src/baz.ts（整批 main 改动被误算）" \
  || no "① 旧判据未纳入 src/baz.ts: [$OLD]"

# ② 新判据排除 main 并入的文件
[ -n "$BASE" ] \
  && ok "② 新判据基准可算: merge-base(origin/main, HEAD)=${BASE:0:8}" \
  || no "② merge-base 取不到（降级路径，失败）"
echo "$NEW" | grep -q '^src/foo.ts$' \
  && no "② 新判据仍纳入 src/foo.ts（修复无效）: [$NEW]" \
  || ok "② 新判据排除 main 并入的 src/foo.ts（存量红不再被误判为新增）"

# ③ 边界：本分支自己的改动必须仍在变更集内
echo "$NEW" | grep -q '^src/bar.ts$' \
  && ok "③ 新判据保留本分支改动 src/bar.ts（变更集未算空，棘轮不会永远放行）" \
  || no "③ 新判据丢失本分支改动 src/bar.ts: [$NEW]"

# ④ 普通单提交分支上新旧等价
git checkout -q -b plain "$BASE" 2>/dev/null
( echo e > src/plain.ts; git add -A; git commit -qm "plain: e" ) >/dev/null 2>&1
P_OLD=$(git diff --name-only HEAD~1..HEAD 2>/dev/null || echo "")
P_BASE=$(git merge-base refs/remotes/origin/main HEAD 2>/dev/null || echo "")
P_NEW=$(git diff --name-only "$P_BASE"..HEAD 2>/dev/null || echo "")
[ "$P_OLD" = "$P_NEW" ] && [ "$P_OLD" = "src/plain.ts" ] \
  && ok "④ 无合并分支上判据不变（新旧等价: ${P_OLD}）" \
  || no "④ 判据在无合并分支上发生行为漂移: old=[$P_OLD] new=[$P_NEW]"

# ⑤ 判据降级必须可见（origin/main 缺失 → 回退 + ::warning::）
NOBASE_RC=$(grep -c 'origin/main 不可用，回退' "$CI" 2>/dev/null | tr -d '\n\r')
[ "${NOBASE_RC:-0}" -ge 1 ] \
  && ok "⑤ 无 origin/main 时回退路径带告警文案（降级不静默）" \
  || no "⑤ 缺少 origin/main 回退告警"

# ⑥ 放行可见 + 接线
WARNS=$(grep -c '::warning::' "$CI" 2>/dev/null | tr -d '\n\r')
[ "${WARNS:-0}" -ge 2 ] \
  && ok "⑥ 放行/降级带 ::warning::（计数=$WARNS ≥2）" \
  || no "⑥ ::warning:: 不足（计数=${WARNS:-0}）"
grep -q 'PREEXISTING_RED_FILES' "$CI" \
  && ok "⑥ 存量红放行时列出文件名（可定位，不再一句话带过）" \
  || no "⑥ 放行列不出文件名"

# ⑦ 接线：本测试被执行（ci.yml 白名单含本文件名）
grep -q 'ci-ratchet-base.test.sh' "$CI" \
  && ok "⑦ 本测试已接线进 CI 白名单（防机制建成未接线 M3）" \
  || no "⑦ 本测试未接线进 ci.yml 白名单（永不执行）"

# ⑧ 反接线：主判据必须是 merge-base 三点差（回退分支的 HEAD~1 属已声明的降级，不算违规）
grep -q 'CHANGED=$(git diff --name-only "$BASE"\.\.HEAD' "$CI" \
  && ok "⑧ 主判据为 merge-base 三点差（\"$BASE\"..HEAD）" \
  || no "⑧ 主判据不是三点差（修复被回退）"
grep -q 'BASE=$(git merge-base refs/remotes/origin/main HEAD' "$CI" \
  && ok "⑧ 基准取自 refs/remotes/origin/main（与 D708 gate 同源）" \
  || no "⑧ 基准未取自 origin/main"

# ⑨ 同族第二处：G12（workflow/check-brief-vs-code.sh 真身）的 diff 基准也必须是 merge-base
# （D962-B2：根目录死副本删除，merge-base 修复移植进 workflow 真身后改指此文件）
G12="$REPO/scripts/workflow/check-brief-vs-code.sh"
grep -q 'merge-base refs/remotes/origin/main HEAD' "$G12" \
  && ok "⑨ G12 基准取自 merge-base（合并提交不再误判越界）" \
  || no "⑨ G12 仍用裸 HEAD~1 基准（合并提交下会误报越界）"
grep -q 'origin/main 不可用' "$G12" \
  && ok "⑨ G12 回退路径带可见提示" \
  || no "⑨ G12 回退路径静默"
grep -q 'DIFF_ALL=$(git diff --name-only "$DIFF_BASE"\.\.HEAD' "$G12" \
  && ok "⑨ G12 主路径已改为三点差（基准变量..HEAD）" \
  || no "⑨ G12 主路径不是三点差（修复被回退）"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
