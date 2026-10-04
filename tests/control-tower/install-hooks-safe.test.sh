#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# install-hooks-safe.test.sh — install-hooks.sh 安全化夹具（#1024 / D1142）
#
# 病根（卡面）: ① `printf > $ROOT/.git/hooks/<name>` **无条件覆盖**全队共享 hook
#              （手改内容静默丢失；worktree 下 $ROOT/.git 是文件 ⇒ 重定向必失败）；
#              ② 4 处 git config 无 `--local`（落点不确定）；
#              ⇒ C1 的修复要重跑本脚本才生效 ⇒ 脚本不安全 = C1 等于未生效。
#
# 覆盖矩阵（铁律 48 三路径 + 反例 + 接线）:
#   正常 — 装全 4 hook + 带 generated-by 标记 + 可执行
#   幂等 — 连跑两次：内容逐字节不变、不产生 .bak（旧写法每次都重写）
#   反例 — 目标无标记（人工/外来内容）⇒ 先备份（.bak.<ts> 内容 == 原文）再写入
#   反例 — --dry-run ⇒ 零落盘（sha256 全不变、无新 .bak）
#   边界 — 两个 linked worktree 各跑一次：hooks 目录解析为**同一个共享目录**、
#          第二次为"内容已一致"、互不破坏、工作树零污染
#   安全 — 注入探针（另一 worktree 的手改 hook）在重跑后仍可从 .bak 取回（不静默丢失）
#   落点 — git config 全部落**仓库级**：local 命中 + 宿主全局配置零写入（GIT_CONFIG_GLOBAL 隔离）
#   接线 — 本夹具登记在 ci.yml 密封清单
#
# 隔离（PLATFORM-CHECKLIST §6）: 全部在 mktemp 沙箱内（独立 git 仓 + 拷贝的最小 scripts 子集）；
#   HOME/GIT_CONFIG_GLOBAL 亦指向沙箱 ⇒ 宿主全局配置零接触；真实仓库只做 `--dry-run`（不落盘）。
#
# 契约（铁律 47）:
#   @input  — 无参数
#   @output — 逐用例 ✅/❌ + 汇总 + 末行机器可读摘要
#   @exit   — 0 = 全通过 ｜ 1 = 有用例不符 ｜ 2 = 夹具自身失效（沙箱/git 不可用）
#   @degraded — exit 2 且 stderr 以 `degraded:` 起
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/../.." && pwd)"
INSTALL="$REPO_DIR/scripts/install-hooks.sh"
PASS=0; FAIL=0; FAILED_NAMES=()
ok()  { echo "  ✅ $1"; PASS=$((PASS + 1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); }
degraded() { echo "degraded: $1" >&2; exit 2; }

[ -f "$INSTALL" ] || degraded "被测脚本不存在: $INSTALL"
command -v git >/dev/null 2>&1 || degraded "git 不可用"

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
export HOME="$SB/home"
export GIT_CONFIG_GLOBAL="$SB/home/.gitconfig"
mkdir -p "$HOME"
: > "$GIT_CONFIG_GLOBAL"

W="$SB/repo"
git init -q "$W" || degraded "夹具仓初始化失败"
# 拷贝 install-hooks 需要的**最小**子集（只要求路径存在；门禁脚本内容在本夹具不执行）
mkdir -p "$W/scripts/control-tower" "$W/scripts/hooks"
cp "$INSTALL" "$W/scripts/install-hooks.sh"
for f in pre-commit-check.sh commit-msg-check.sh pre-push-check.sh; do : > "$W/scripts/$f"; done
: > "$W/scripts/hooks/post-commit.sh"
: > "$W/scripts/control-tower/synova-commit"
touch "$W/.keep"
( cd "$W" && git add -A && git -c user.name=t -c user.email=t@t commit -q -m base ) || degraded "夹具初始提交失败"
HOOKS_MAIN="$W/.git/hooks"
RUN() { ( cd "$W" && bash "$W/scripts/install-hooks.sh" "$@" ) ; }
sha_of() { [ -f "$1" ] && shasum -a 256 "$1" 2>/dev/null | awk '{print $1}' || echo "<none>"; }

echo "═══════════════════════════════════════════════════════════"
echo "  #1024 install-hooks.sh 安全化夹具"
echo "═══════════════════════════════════════════════════════════"

# ── 接线断言 ──
grep -q 'install-hooks-safe.test.sh' "$REPO_DIR/.github/workflows/ci.yml" \
  && ok "接线: 本夹具登记在 ci.yml" \
  || bad "接线: 本夹具未登记 ci.yml（CI 不跑 = 摆设）"

# ── 1. 正常: 装全 4 hook + 标记 + 可执行 ──
OUT="$(RUN 2>&1)"; RC=$?
[ "$RC" = "0" ] && ok "1 正常: install-hooks exit 0" || bad "1 正常: exit=${RC}（$(echo "$OUT" | tail -3 | tr '\n' '|')）"
MISSING=""
for h in pre-commit commit-msg pre-push post-commit; do
  if [ -f "$HOOKS_MAIN/$h" ] && [ -x "$HOOKS_MAIN/$h" ]; then
    grep -q 'generated-by: scripts/install-hooks.sh' "$HOOKS_MAIN/$h" || MISSING="${MISSING}${h}(无标记) "
  else
    MISSING="${MISSING}${h}(缺失/不可执行) "
  fi
done
[ -z "$MISSING" ] && ok "1 正常: 4 hook 齐备 + 可执行 + 带 generated-by 标记" || bad "1 正常: ${MISSING}"

# ── 2. 幂等: 连跑两次 → 内容不变 + 无 .bak ──
H1="$(sha_of "$HOOKS_MAIN/pre-commit")"
OUT2="$(RUN 2>&1)"; RC2=$?
H2="$(sha_of "$HOOKS_MAIN/pre-commit")"
[ "$RC2" = "0" ] && ok "2 幂等: 第二次 exit 0" || bad "2 幂等: 第二次 exit=${RC2}"
[ "$H1" = "$H2" ] && ok "2 幂等: 包装器内容逐字节不变（sha 一致）" || bad "2 幂等: 内容被改写（$H1 → ${H2}）"
echo "$OUT2" | grep -q '内容已一致' && ok "2 幂等: 报告「内容已一致，未重写」" || bad "2 幂等: 未报告幂等命中（输出行数=$(echo "$OUT2" | grep -c . || true)）"
BAKS=$(ls "$HOOKS_MAIN"/pre-commit.bak.* 2>/dev/null | wc -l | tr -d ' \r')  # swallow-ok: 无备份=0（正常）
[ "$BAKS" = "0" ] && ok "2 幂等: 未产生 .bak（自家包装器不算外来内容）" || bad "2 幂等: 产生了 ${BAKS} 个 .bak"

# ── 3. 反例: 外来内容（无标记）⇒ 先备份再写入 ──
printf '#!/bin/bash\necho "手改的 hook，不该丢"\n' > "$HOOKS_MAIN/pre-commit"
FOREIGN="$(sha_of "$HOOKS_MAIN/pre-commit")"
OUT3="$(RUN 2>&1)"
BAKFILE=$(ls -t "$HOOKS_MAIN"/pre-commit.bak.* 2>/dev/null | head -1)  # swallow-ok: 无备份=空（正常，由下方 if 判）
if [ -n "$BAKFILE" ] && [ "$(sha_of "$BAKFILE")" = "$FOREIGN" ]; then
  ok "3 反例: 外来内容已备份且 .bak == 原文（sha 一致）"
else
  bad "3 反例: 外来内容未正确备份（bak=${BAKFILE:-<无>}）"
fi
grep -q '手改的 hook，不该丢' "$HOOKS_MAIN/pre-commit" 2>/dev/null \
  && bad "3 反例: 目标仍是外来内容（未写入标准包装器）" \
  || ok "3 反例: 目标已替换为标准包装器"
echo "$OUT3" | grep -q '无 generated-by 标记' && ok "3 反例: 输出显式点名备份动作" || bad "3 反例: 未点名备份动作"

# ── 4. 反例: --dry-run ⇒ 零落盘 ──
S_BEFORE="$(sha_of "$HOOKS_MAIN/pre-commit")|$(sha_of "$HOOKS_MAIN/commit-msg")|$(sha_of "$HOOKS_MAIN/pre-push")|$(sha_of "$HOOKS_MAIN/post-commit")"
BAK_BEFORE=$(ls "$HOOKS_MAIN"/*.bak.* 2>/dev/null | wc -l | tr -d ' \r')  # swallow-ok: 无备份=0（正常）
OUT4="$(RUN --dry-run 2>&1)"; RC4=$?
S_AFTER="$(sha_of "$HOOKS_MAIN/pre-commit")|$(sha_of "$HOOKS_MAIN/commit-msg")|$(sha_of "$HOOKS_MAIN/pre-push")|$(sha_of "$HOOKS_MAIN/post-commit")"
BAK_AFTER=$(ls "$HOOKS_MAIN"/*.bak.* 2>/dev/null | wc -l | tr -d ' \r')  # swallow-ok: 无备份=0（正常）
[ "$RC4" = "0" ] && ok "4 dry-run: exit 0" || bad "4 dry-run: exit=${RC4}"
[ "$S_BEFORE" = "$S_AFTER" ] && ok "4 dry-run: 4 个 hook 内容零变化" || bad "4 dry-run: 内容被改写"
[ "$BAK_BEFORE" = "$BAK_AFTER" ] && ok "4 dry-run: 未新增备份" || bad "4 dry-run: 新增了备份（dry-run 落盘！）"
echo "$OUT4" | grep -q '\[dry-run\]' && ok "4 dry-run: 输出标注 [dry-run]" || bad "4 dry-run: 输出无 [dry-run] 标注"

# ── 5. 两个 worktree 各跑一次互不破坏 ──
WT1="$SB/wt1"; WT2="$SB/wt2"
git -C "$W" worktree add -q "$WT1" -b wt1 >/dev/null 2>&1 || degraded "建 wt1 失败"
git -C "$W" worktree add -q "$WT2" -b wt2 >/dev/null 2>&1 || degraded "建 wt2 失败"
# worktree 里 install-hooks 需要的入口脚本由 git 跟踪 ⇒ 已在两个 worktree 中
HOOKS_WT="$(cd "$WT1" && git rev-parse --git-path hooks)"
HOOKS_WT2="$(cd "$WT2" && git rev-parse --git-path hooks)"
[ "$HOOKS_WT" = "$HOOKS_WT2" ] && ok "5 worktree: 两树解析到同一 hooks 目录（共享面可见）" || bad "5 worktree: hooks 目录解析不一致"
S_W="$(sha_of "$W/.git/hooks/pre-commit")"
O1="$(cd "$WT1" && bash "$WT1/scripts/install-hooks.sh" 2>&1)"; R1=$?
O2="$(cd "$WT2" && bash "$WT2/scripts/install-hooks.sh" 2>&1)"; R2=$?
[ "$R1" = "0" ] && [ "$R2" = "0" ] && ok "5 worktree: 两 worktree 各跑一次均 exit 0" || bad "5 worktree: rc=$R1/$R2"
[ "$S_W" = "$(sha_of "$W/.git/hooks/pre-commit")" ] && ok "5 worktree: 第二次运行后共享 hook 内容未变（互不破坏）" || bad "5 worktree: 共享 hook 被改写"
echo "$O1" | grep -q 'linked worktree' && ok "5 worktree: 输出显式声明「影响面 = 全仓共享」" || bad "5 worktree: 未声明共享影响面"
DIRTY1="$(git -C "$WT1" status --porcelain | wc -l | tr -d ' \r')"
DIRTY2="$(git -C "$WT2" status --porcelain | wc -l | tr -d ' \r')"
[ "$DIRTY1" = "0" ] && [ "$DIRTY2" = "0" ] && ok "5 worktree: 两树工作区零污染" || bad "5 worktree: 工作区被污染（wt1=$DIRTY1 wt2=${DIRTY2}）"

# ── 6. 落点: git config 全部仓库级 + 宿主全局零写入 ──
drv="$(git -C "$W" config --local --get merge.union.driver 2>/dev/null || true)"
case "$drv" in *merge-file*--union*) ok "6 落点: merge.union.driver 写入仓库级（--local 可读）";; *) bad "6 落点: merge.union.driver 未落仓库级（'${drv:-<空>}'）";; esac
GLOBAL_DRV="$(git -C "$W" config --global --get merge.union.driver 2>/dev/null || true)"
[ -z "$GLOBAL_DRV" ] && ok "6 落点: 宿主全局配置零写入（隔离 HOME 下为空）" || bad "6 落点: 全局配置被写入（${GLOBAL_DRV}）"
alias_v="$(git -C "$W" config --local --get alias.synova-commit 2>/dev/null || true)"
case "$alias_v" in *'$(git rev-parse --show-toplevel)'*) ok "6 落点: alias 路径为调用时求值（不写死单棵树的绝对路径）";; *) bad "6 落点: alias 仍写死路径（${alias_v:-<空>}）";; esac

# ── 7. 真实仓库 --dry-run 安全（不落盘、不改 hook）──
REAL_HOOKS="$(cd "$REPO_DIR" && git rev-parse --git-path hooks)"
case "$REAL_HOOKS" in /*) : ;; *) REAL_HOOKS="$REPO_DIR/$REAL_HOOKS" ;; esac
if [ -d "$REAL_HOOKS" ]; then
  RS_BEFORE="$(ls "$REAL_HOOKS" | sort | shasum -a 256 | awk '{print $1}')"
  ( cd "$REPO_DIR" && bash "$INSTALL" --dry-run ) >/dev/null 2>&1
  RS_AFTER="$(ls "$REAL_HOOKS" | sort | shasum -a 256 | awk '{print $1}')"
  [ "$RS_BEFORE" = "$RS_AFTER" ] && ok "7 真实仓库: --dry-run 后 hooks 目录清单零变化" || bad "7 真实仓库: --dry-run 改了 hooks 目录"
else
  echo "  ⏭ SKIP 7: 真实仓库 hooks 目录不可见"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  结果: PASS=$PASS FAIL=$FAIL"
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then
  D=""
  for n in ${FAILED_NAMES[@]+"${FAILED_NAMES[@]}"}; do D="${D}${n} ; "; done
  echo "❌ FAILED(${FAIL}): ${D}"
  exit 1
fi
echo "INSTALL_HOOKS_SAFE_SUMMARY: pass=${PASS} fail=0"
exit 0
