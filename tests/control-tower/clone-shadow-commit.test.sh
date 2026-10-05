#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# clone-shadow-commit.test.sh — **文件名保留（CI 登记名不可漂移）**；被测语义已随 D1145 更新
#
# 🔴 D1145 / D735 Stage 2 变更（原 D540 主题「影子提交」已退役，退役判据 b「使命已完成」）:
#   原: clone 环境须配 identity，否则 post-commit 的**影子登记提交**失败（L87 降级）；
#       且须防「影子登记影子」的递归。
#   现: `.claude/bypass.log` **停跟踪** ⇒ 写入不产生 git 变更 ⇒ 影子提交整段删除 ⇒
#       ① hook **不再需要任何 git identity** ② 递归问题消失，改为**按 HASH 幂等**。
#
# 覆盖矩阵（铁律 48 正常/降级/边界 + 隔离）:
#   C1 正常  — clone 沙箱 + identity → 真实 commit → per-session 账本含本提交 HASH；
#              **无影子提交**（HEAD 即真实提交）；工作树对该文件零变更
#   C2 降级  — clone **无任何 identity**（useConfigOnly=true + 清空环境）→ 手动触发 post-commit
#              → **仍成功登记**（新不变量：hook 不再依赖 identity）；无影子提交
#   C3 幂等  — 同一 HEAD 重跑 post-commit → 账本行数不变（D1145 由「防递归」升级为「按 HASH 幂等」）
#   C4 隔离  — 双独立 clone，A commit → B 的 HEAD/index 零变化（sha256 指纹，BSD/GNU 可移植）
#
# 沙箱: mktemp git 仓库 + 委托 hook 指向真实 post-commit.sh；scripts/ 用符号链接复现真实布局
#       （账本解析依赖 $ROOT/scripts/control-tower/bypass-ledger.sh）
# 退出码: 0 = 全部通过
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
# M13/D521: hook 上下文会导出 GIT_DIR/GIT_WORK_TREE——沙箱 git 命令必须剥掉
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
# D1145: 账本 sid 解析优先级 = SYNO_SESSION_ID > DSH_SESSION_ID > 分支名 …
# 夹具显式注入，保证落点可预期（不随宿主环境漂移）
export SYNO_SESSION_ID=clone-test
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK_SRC="$REPO/scripts/hooks/post-commit.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD" 2>/dev/null || true' EXIT

# 可移植 sha256（macOS/BSD 无 sha256sum；ctrl-tower 模式 5：平台差异显式兜底）
_sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

echo "=== D1145 Stage 2: clone 环境 bypass 账本登记（无影子提交）==="

# ── 接线 ──
grep -q -- '--no-verify -q -o -m' "$HOOK_SRC" && no "接线: 影子提交段仍在" || ok "接线: 影子提交段已移除（D1145）"
grep -q 'bypass-ledger.sh" append' "$HOOK_SRC" && ok "接线: per-session 账本 append 在位" || no "接线: 账本 append 缺失"
grep -q "_ledger_has_hash" "$HOOK_SRC" && ok "接线: 按 HASH 幂等判据在位" || no "接线: 幂等判据缺失"

# 帮助: 建 sandbox git 仓库 + 委托 post-commit hook + scripts 符号链接
make_sandbox() { # make_sandbox <dest>
  local d="$1"
  mkdir -p "$d/.claude" "$d/.git/hooks"
  git -C "$d" init -q -b main 2>/dev/null || git -C "$d" init -q
  ln -s "$REPO/scripts" "$d/scripts"
  printf '.claude/bypass.log\n.claude/last-precommit-success\n.sessions/\n' > "$d/.gitignore"
  printf '#!/bin/bash\nexec bash "%s"\n' "$HOOK_SRC" > "$d/.git/hooks/post-commit"
  chmod +x "$d/.git/hooks/post-commit"
}
_seed() { # _seed <dest>  建 seed 提交
  local d="$1"
  git -C "$d" add .gitignore 2>/dev/null || true
  echo "seed" > "$d/seed.txt"; git -C "$d" add seed.txt
  git -C "$d" -c user.name=t -c user.email=t@t commit -q --no-verify -m "chore: seed"
}

# ═══ C1 正常: identity 配置 → 真实 commit → 账本登记 + 无影子提交 ═══
echo ""
echo "── C1 正常（identity 配置 → 账本登记）──"
SB="$TMPD/c1"; make_sandbox "$SB"
git -C "$SB" config --local user.name "synova-mac"
git -C "$SB" config --local user.email "claworg@users.noreply.github.com"
_seed "$SB"
echo "feature" > "$SB/feature.txt"; git -C "$SB" add feature.txt
echo "$(git -C "$SB" rev-parse HEAD)|$(date +%s)" > "$SB/.claude/last-precommit-success"
git -C "$SB" commit -q -m "feat: real commit C1"
REAL_HASH=$(git -C "$SB" rev-parse HEAD)
LEDGER="$SB/.sessions/clone-test/bypass.log"
grep -q "HASH=$REAL_HASH" "$LEDGER" 2>/dev/null && ok "C1 per-session 账本含本提交 HASH" || no "C1 账本未登记（查 ${LEDGER}）"
grep -q "HASH=$REAL_HASH" "$SB/.claude/bypass.log" 2>/dev/null && ok "C1 本地镜像含本提交 HASH" || no "C1 镜像未登记"
SUBJ=$(git -C "$SB" log -1 --format=%s)
[ "$SUBJ" = "feat: real commit C1" ] && ok "C1 无影子提交（HEAD 即真实提交）" || no "C1 HEAD 非真实提交: $SUBJ"
SHADOW_N=$(git -C "$SB" log --oneline --format=%s | grep -c "bypass COMMITTED 登记" | tr -d '\n\r' || true)
[ "$SHADOW_N" -eq 0 ] && ok "C1 提交链无影子提交（count=0）" || no "C1 影子提交残留: count=$SHADOW_N"
# 断言目标收窄到"证据文件本身"（hook 尾部审计器会写 .codex/ 沙箱产物，与本卡无关）
DIRTY=$(git -C "$SB" status --porcelain | grep -E 'bypass\.log' || true)
[ -z "$DIRTY" ] && ok "C1 证据文件零变更（停跟踪生效）" || no "C1 该文件仍脏: $DIRTY"

# ═══ C2 降级: clone 无任何 identity → hook 仍能登记（不再依赖 identity）═══
echo ""
echo "── C2 降级（无 identity → 仍登记）──"
SB2="$TMPD/c2"; make_sandbox "$SB2"
git -C "$SB2" config --local user.useConfigOnly true   # 禁止 OS 派生身份
_seed "$SB2"
echo "feature" > "$SB2/feature.txt"; git -C "$SB2" add feature.txt
echo "$(git -C "$SB2" rev-parse HEAD)|$(date +%s)" > "$SB2/.claude/last-precommit-success"
git -C "$SB2" -c user.name=t -c user.email=t@t commit -q --no-verify -m "feat: real commit C2"
C2_HASH=$(git -C "$SB2" rev-parse HEAD)
C2_OUT=$(cd "$SB2" && env -u GIT_CONFIG_PARAMETERS -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL \
      -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL bash "$SB2/.git/hooks/post-commit" 2>&1)
LEDGER2="$SB2/.sessions/clone-test/bypass.log"
grep -q "HASH=$C2_HASH" "$LEDGER2" 2>/dev/null && ok "C2 无 identity 仍登记（新不变量：hook 不依赖 identity）" || no "C2 未登记: [$C2_OUT]"
printf '%s' "$C2_OUT" | grep -q "identity 未配置" && no "C2 仍出现 identity 依赖消息（影子语义残留）" || ok "C2 无 identity 依赖消息"

# ═══ C3 幂等: 同一 HEAD 重跑 → 账本行数不变 ═══
echo ""
echo "── C3 幂等（按 HASH，不重复登记）──"
SB3="$TMPD/c3"; make_sandbox "$SB3"
git -C "$SB3" config --local user.name t; git -C "$SB3" config --local user.email t@t
_seed "$SB3"
echo "b" > "$SB3/b.txt"; git -C "$SB3" add b.txt
echo "$(git -C "$SB3" rev-parse HEAD)|$(date +%s)" > "$SB3/.claude/last-precommit-success"
git -C "$SB3" commit -q -m "feat: real commit B"
L3="$SB3/.claude/bypass.log"
BEFORE3=$(grep -c . "$L3" 2>/dev/null || echo 0)
(cd "$SB3" && bash "$SB3/.git/hooks/post-commit" >/dev/null 2>&1)
AFTER3=$(grep -c . "$L3" 2>/dev/null || echo 0)
[ "$BEFORE3" = "$AFTER3" ] && ok "C3 幂等: 重跑不重复登记（行数 ${BEFORE3} 保持）" || no "C3 重复登记: ${BEFORE3} → ${AFTER3}"

# ═══ C4 隔离: 双独立 clone，A commit → B 的 HEAD/index 零变化 ═══
echo ""
echo "── C4 隔离（双 clone 互不污染 index/HEAD）──"
BASE="$TMPD/base"; make_sandbox "$BASE"
git -C "$BASE" config --local user.name t; git -C "$BASE" config --local user.email t@t
echo "base" > "$BASE/base.txt"; git -C "$BASE" add base.txt
git -C "$BASE" commit -q --no-verify -m "chore: base"
git clone -q "file://$BASE" "$TMPD/cloneA" 2>/dev/null || no "clone A 失败"
git clone -q "file://$BASE" "$TMPD/cloneB" 2>/dev/null || no "clone B 失败"
if [ -d "$TMPD/cloneA/.git" ] && [ -d "$TMPD/cloneB/.git" ]; then
  B_HEAD_BEFORE=$(git -C "$TMPD/cloneB" rev-parse HEAD)
  B_INDEX_BEFORE=$(_sha "$TMPD/cloneB/.git/index")
  git -C "$TMPD/cloneA" config --local user.name t
  git -C "$TMPD/cloneA" config --local user.email t@t
  echo "a" > "$TMPD/cloneA/a.txt"; git -C "$TMPD/cloneA" add a.txt
  git -C "$TMPD/cloneA" commit -q -m "feat: A-only change"
  B_HEAD_AFTER=$(git -C "$TMPD/cloneB" rev-parse HEAD)
  B_INDEX_AFTER=$(_sha "$TMPD/cloneB/.git/index")
  [ "$B_HEAD_BEFORE" = "$B_HEAD_AFTER" ] && ok "C4 隔离: B 的 HEAD 零变化" || no "C4 B 的 HEAD 被污染"
  [ "$B_INDEX_BEFORE" = "$B_INDEX_AFTER" ] && ok "C4 隔离: B 的 index 零变化 (sha256)" || no "C4 B 的 index 被污染"
else
  no "C4 双 clone 建立失败"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
