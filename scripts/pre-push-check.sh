#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# Loop Engineering v2.0-D-A — pre-push (D334 同步检查 + secrets + 快检；golden/vitest 归 CI)
#
# 设计原则:
#   - pre-commit 已跑 12 组物理阻断 + 格式检查 → 不重复
#   - PostToolUse 已跑 tsc --incremental + vitest --related → 不重复
#   - push 的独特风险: API key 泄露到 GitHub + 全量回归遗漏 + 黄金诊断无声退化
#     + 并行 session 中间态污染 (D311 改基: vitest 只测本次推送提交)
#   - V4.5.1 新增: vitest --changed 作为 push 时的增量回归检查
#   - D300 新增: golden-case F1 门禁 (权威文档09 §5.2 + A线 C-G1 修复)
#   - D311 新增: 门禁 3 改基 + 门禁 4 工作区中间态警告 + 门禁 5 并行声明物理验证
#   - D334 新增: 门禁 0 多机同步检查 (push 前强制 fetch + 落后/分叉阻断 + main 保护)。
#     事故: 2026-08-11~13 双机同一分支交替 push，Mac tracking ref 过期 4 天，
#     git status 误报 ahead 实际落后 11 commit——双机互不知情险些互相覆盖。
#     (详见 docs/synova/coordination/MULTI-MACHINE-PR-WORKFLOW.md)
#   - D334 修复: 门禁 3 改基从硬编码 origin/feat/prompt-architecture 改为动态
#     $PUSH_REMOTE/<被 push 分支>——PR 工作流下每台机器分支名不同，硬编码失效。
#   - secrets 终扫是最后防线 — 一旦 key 推到 GitHub, 轮换成本极高
#
# 删除的 5 道门去哪了:
#   决策树 → task-start.sh Q1 已覆盖
#   tsc → PostToolUse verify-incremental.sh 已跑
#   vitest → PostToolUse verify-incremental.sh 已跑
#   铁律/接线/架构 → agent 自检 + pre-commit 5 项已覆盖
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ═══ D334: push 上下文解析 (hook 传参 + stdin refs) ═══
# pre-push hook 调用: bash pre-push-check.sh <remote-name> <remote-url>
# stdin: 每行 "<local_ref> <local_sha> <remote_ref> <remote_sha>"
# 兼容: 无参调用(测试/手动)时 REFS_INPUT 为空 → 同步检查 fail-open 显式提示。
PUSH_REMOTE="${1:-}"
PUSH_URL="${2:-}"
REFS_INPUT="$(cat 2>/dev/null || true)"
# 取第一个 refs/heads/* 作为本次 push 的目标分支（多 ref push 时逐个由 hook 层保证；
# 本脚本取首个分支 ref 用于门禁 0/3 的动态改基）
PUSH_BRANCH_REF="$(printf '%s\n' "$REFS_INPUT" | awk '$3 ~ /^refs\/heads\// {print $3; exit}')"
PUSH_BRANCH="${PUSH_BRANCH_REF#refs/heads/}"
# D457: 删除操作检测 — local_sha 全零 = git push --delete（门禁 0-1 不应做 behind/ahead 检查）
PUSH_LOCAL_SHA="$(printf '%s\n' "$REFS_INPUT" | awk '$3 ~ /^refs\/heads\// {print $2; exit}' | tr -d '\n\r')"
IS_DELETE=""
if [[ -n "$PUSH_LOCAL_SHA" && "$PUSH_LOCAL_SHA" =~ ^0+$ ]]; then
  IS_DELETE=1
fi
if [[ -z "$PUSH_REMOTE" ]]; then
  # hook 未传参（旧 hook 格式/手动运行）→ 从本地 remote 兜底
  PUSH_REMOTE="$(git remote 2>/dev/null | head -1 || echo '')"
fi

# ═══ D334: 门禁 0 多机同步检查 (push 前强制 fetch + 落后/分叉阻断 + main 保护) ═══
# 规则:
#   0-1 push 前强制 fetch 目标分支:
#       落后(远端有新 commit) → 🔴 硬阻断 (提示 pull/rebase)
#       分叉(双向都有新 commit) → 🔴 硬阻断 (提示 rebase, 禁 force push)
#       仅本地领先 → 放行
#   0-2 refs/heads/main 直接 push → 🔴 硬阻断 (main 只进 PR)。
#       紧急逃生舱: SYNO_ALLOW_MAIN_PUSH=1 (需创始人批准, 记 bypass.log)
# 降级: fetch 失败(离线/bare/无权限) → fail-open 显式提示 (不静默跳过; 铁律 11)
# 测试注入: SYNO_SYNC_ONLY=1 只跑本检查 (push-sync-guard.test.sh 隔离单测)

check_push_sync() {
  local behind="0" ahead="0" fremote="$1" fbranch="$2"
  [[ -z "$fbranch" ]] && fbranch="$PUSH_BRANCH"

  # 0-2: main 保护 (本地判定零成本, 先于网络操作)
  if [[ "$PUSH_BRANCH_REF" == "refs/heads/main" ]] || [[ "$fbranch" == "main" ]]; then
    if [[ "${SYNO_ALLOW_MAIN_PUSH:-}" != "1" ]]; then
      echo -e "  ${RED}❌ 门禁 0-2: 禁止直接 push main — main 只进 PR${RESET}"
      echo "  正确流程: push 自己的 feat/ 分支 → 开 PR → GitHub PR 机制合并（CTO 用 API token 执行）。"
      echo "  紧急逃生舱(需创始人批准, 禁止用于常规合并): SYNO_ALLOW_MAIN_PUSH=1 git push ... (记 bypass.log)"
      return 1
    fi
    # D571: 真实写 bypass.log——此前只 echo 声称「已记」未实现写入（M2 审计链断裂，2026-09-03 复盘发现）
    _escape_repo_root="$(cd "$SCRIPT_DIR/.." && pwd)"
    _escape_bypass_log="${SYNO_BYPASS_LOG:-${_escape_repo_root}/.claude/bypass.log}"  # 测试注入缝: 沙箱覆盖路径
    _escape_ts="$(date +%Y-%m-%dT%H:%M:%S%z 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)" # swallow-ok: 无 %z 的 date 用 UTC 兜底
    _escape_user="$(whoami 2>/dev/null || echo unknown)" # swallow-ok: 身份获取失败不阻断逃生舱，unknown 留痕
    printf '%s\n' "${_escape_ts} | ALLOW_MAIN_PUSH | SYNO_ALLOW_MAIN_PUSH=1 逃生舱直推 main（需创始人批准）| BRANCH=${PUSH_BRANCH:-main} | USER=${_escape_user}" \
      >> "${_escape_bypass_log}" 2>/dev/null || echo -e "  ${RED}⚠️  逃生舱 bypass.log 写入失败 — 审计链断裂${RESET}" >&2
    echo -e "  ${YELLOW}⚠️  门禁 0-2: SYNO_ALLOW_MAIN_PUSH=1 逃生舱生效 — 直推 main (已记 bypass.log)${RESET}"
  fi

  # D457: 删除操作 (git push --delete) 无 behind/ahead 语义，跳过同步检查
  if [[ -n "$IS_DELETE" ]]; then
    echo -e "  ${GREEN}✅ 门禁 0-1: 删除操作 $fbranch — 跳过同步检查（删除无 behind/ahead 语义）${RESET}"
    return 0
  fi

  # 0-1: fetch 目标分支对比同步状态
  if [[ -z "$fremote" || -z "$fbranch" || -z "$PUSH_BRANCH_REF" ]]; then
    echo -e "  ${YELLOW}⚠️  门禁 0-1: 无法确定 push 目标 (remote=$fremote branch=$fbranch) — 跳过 (fail-open)${RESET}"
    return 0
  fi
  if ! git fetch "$fremote" "$fbranch" --quiet 2>/dev/null; then # swallow-ok: fetch 失败走 fail-open 显式提示降级 (铁律 11)
    echo -e "  ${YELLOW}⚠️  门禁 0-1: fetch $fremote $fbranch 失败 — 同步检查跳过 (fail-open)${RESET}"
    return 0
  fi
  behind="$(git rev-list --count HEAD..FETCH_HEAD 2>/dev/null | tr -d '\n\r' || echo "0")"
  ahead="$(git rev-list --count FETCH_HEAD..HEAD 2>/dev/null | tr -d '\n\r' || echo "0")"
  [[ -z "$behind" ]] && behind="0"
  [[ -z "$ahead" ]] && ahead="0"
  if [[ "$behind" -gt 0 && "$ahead" -gt 0 ]]; then
    echo -e "  ${RED}❌ 门禁 0-1: 本地与远端分叉 — 本地领先 $ahead / 落后 $behind${RESET}"
    echo "  禁止直接 push (会覆盖对方工作) 也禁止 force push。先集成远端:"
    echo "    git merge $fremote/$fbranch   # 推荐（不改 hash，bypass 对账不裂）"
    echo "    # 或 git rebase $fremote/${fbranch}（会改 hash → bypass 对账断裂，需按 D451 补记）"
    return 1
  fi
  if [[ "$behind" -gt 0 ]]; then
    echo -e "  ${RED}❌ 门禁 0-1: 远端有 $behind 个本机没有的 commit — 本地已过期${RESET}"
    echo "  注意: git status 的 ahead 是相对本机缓存的远端引用, 不是远端真身。"
    echo "  先拉平再 push:"
    echo "    git pull --ff-only   # 推荐（不改 hash，bypass 对账不裂）"
    echo "    # 或 git rebase $fremote/${fbranch}（会改 hash → 需按 D451 补记 bypass.log）"
    return 1
  fi
  echo -e "  ${GREEN}✅ 门禁 0-1: 与远端同步 (本地领先 $ahead)${RESET}"
  return 0
}

# 测试注入: 只跑同步检查 (push-sync-guard.test.sh 隔离单测)
if [[ "${SYNO_SYNC_ONLY:-}" == "1" ]]; then
  set +e
  check_push_sync "$PUSH_REMOTE" "$PUSH_BRANCH"
  EC=$?
  set -e
  exit "$EC"
fi

# ═══ D319: VERSION.md 最新版本必须有对应 tag ═══
# 版本事实与 git 对齐: bump 与代码同 commit（VERSION.md 规则），tag 由
# synova-commit 提交成功后自动创建（annotated）。push 前校验: 最新版本无
# tag → 硬阻断（提示先 synova-commit）。VERSION.md 缺失/无版本标题 → fail-open。
# SYNO_TAG_ONLY=1 测试注入: 只跑本检查（tag-consistency.test.sh 隔离单测）。

check_tag_consistency() {
  # VERSION.md 跟随 cwd 仓库（git rev-parse --show-toplevel）——测试隔离需要，
  # 真实运行 cwd 即仓库根，与固定路径等价
  local REPO_ROOT=""
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/..")
  local VERSION_MD="${SYNO_VERSION_MD:-$REPO_ROOT/.codex/control-tower/VERSION.md}"
  local ver=""
  echo -e "${CYAN}── D319: 版本 tag 一致性 ─────────────────────────────${RESET}"
  if [[ ! -f "$VERSION_MD" ]]; then
    echo -e "  ${YELLOW}⚠️  VERSION.md 缺失 — tag 检查跳过 (fail-open)${RESET}"
    return 0
  fi
  ver=$(grep -oE '^## V[0-9]+\.[0-9]+\.[0-9]+' "$VERSION_MD" | head -1 | awk '{print $2}')
  if [[ -z "$ver" ]]; then
    echo -e "  ${YELLOW}⚠️  VERSION.md 无版本标题 — tag 检查跳过 (fail-open)${RESET}"
    return 0
  fi
  if git tag -l "$ver" | grep -q "$ver"; then
    echo -e "  ${GREEN}✅ D319: VERSION.md 最新版本 $ver 已有对应 tag${RESET}"
    return 0
  fi
  # D521/§6 纪律: tag 只在 main 合并后打——feature 分支推送时最新版本无 tag 是
  #   合法中间态（合并方负责打 tag；D331 仍校验已存在 tag 的锚点，门禁 0-2 仍拦直推 main）。
  if [[ -n "${PUSH_BRANCH:-}" && "$PUSH_BRANCH" != "main" ]]; then
    echo -e "  ${YELLOW}⚠️  D319: $ver 尚无 tag — feature 分支推送合法（§6: tag 在 main 合并后打）${RESET}"
    return 0
  fi
  echo -e "  ${RED}❌ D319: VERSION.md 最新版本 $ver 缺少对应 tag${RESET}"
  echo -e "  ${RED}    请先运行 synova-commit（提交成功后自动打 tag）或手动: git tag -a $ver -m \"bump $ver\"${RESET}"
  return 1
}

# ═══ D331 (L4-1): 版本 tag 必须是 HEAD 祖先 ═══
# 背景: D329 amend 重提交让自动 tag V4.7.1 指向孤儿提交 f685fa0 — 版本锚点与
# 分支内容物理断裂（拉取 V4.7.1 缺 current-brief 去跟踪），D319 一致性检查只
# 验证"tag 存在"，不验证"tag 指向 HEAD 可达的提交"。
# 规则: 所有 V\d+\.\d+\.\d+ tag 须为 HEAD 祖先（git merge-base --is-ancestor）；
#       VERSION.md 最新版本的 tag 存在且为祖先；违反 → 硬阻断（提示重指/删除）。
# VERSION.md 缺失/无版本标题 → fail-open（对齐 D319）。

check_tag_ancestry() {
  local REPO_ROOT="" VERSION_MD="" ver="" TAG_FAIL=""
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/..")
  VERSION_MD="${SYNO_VERSION_MD:-$REPO_ROOT/.codex/control-tower/VERSION.md}"
  TAG_FAIL=""
  echo -e "${CYAN}── D331: 版本 tag 锚点校验 ─────────────────────────────${RESET}"
  # D521/不变量1: 校验范围收窄——孤儿 tag（非 HEAD 祖先，属其他分支或历史事故）
  #   与本次推送无关 → 跳过不拦（D520 实证: V4.7.1 孤儿 tag 拦死无关分支推送×3）；
  #   属于本分支（HEAD 祖先）的 tag 必须同时是 origin/main 祖先——tag 只在 main
  #   可达时合法（版本纪律: 合并后才打 tag；submit 第①步会提前黄色警告同一件事）。
  _HAS_MAIN_REF=1
  if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
    _HAS_MAIN_REF=0
    echo -e "  ${YELLOW}⚠️  origin/main 不可解析 — tag/main 锚点段降级跳过（沙箱/离线语义，铁律 11 显式）${RESET}"
  fi
  for t in $(git tag -l 'V[0-9]*.[0-9]*.[0-9]*'); do
    git merge-base --is-ancestor "$t" HEAD 2>/dev/null || continue # swallow-ok: 非 HEAD 祖先的 tag 与本推送无关，跳过
    if [[ "$_HAS_MAIN_REF" == "1" ]] && ! git merge-base --is-ancestor "$t" origin/main 2>/dev/null; then # swallow-ok: if 条件消费 rc（锚点判断）
      TAG_FAIL="${TAG_FAIL}  $t 是 HEAD 祖先但不在 origin/main 上（未合并分支 tag——合并后再打，或删除）\n"
    fi
  done
  # ── D331/D1243（卡 #1312）: 第二段补「孤儿豁免」+ 判定改读**共享真值** ────────────────────
  # 病根（与第一段同一个 D520，当年只治了一半）: 第一段对「非 HEAD 祖先的 tag」有 `|| continue`
  #   孤儿豁免，第二段（VERSION.md 最新版本）**没有** ⇒ VERSION.md 的版本号**全局唯一** ⇒ 本机
  #   任何一个同名孤儿 tag ⇒ **全机、全分支、任何 push 全红**（D520 实证 ×3，全队 4 人分别删过本地 tag）。
  # 共享真值 vs 本机残留（CTO 类级洞察 R26/R28/R32 的上位根因）:
  #   「本地有这个 tag」= **本机私有状态**；「远端有 / 是 HEAD 祖先」= **共享真值**。
  #   判定不得把本机残留当成对**他人**的阻断理由 ⇒ 远端权威查询用 `ls-remote`（范式同 D1219 发号器）。
  # 方向: feature ⇒ 孤儿与「tag 未打」同判（**黄色中间态**，不阻断）；main ⇒ 仍硬阻断（锚点断裂客观存在）。
  _tag_remote_zh() {
    case "$1" in
      present)     printf '远端**存在**（共享 tag）' ;;
      absent)      printf '远端**不存在** ⇒ 本机独有（残留）' ;;
      *)           printf '远端**不可查**（无 origin/离线）⇒ 无法证明共享态' ;;
    esac
  }
  if [[ -f "$VERSION_MD" ]]; then
    ver=$(grep -oE '^## V[0-9]+\.[0-9]+\.[0-9]+' "$VERSION_MD" | head -1 | awk '{print $2}')
    if [[ -n "$ver" ]]; then
  # ⚠️ 必须在 `ver` **赋值之后**执行: 本函数开头 `local … ver=` 会把外层同名变量清空 ⇒
  #   放前面会查成空 pattern（refs/tags/）⇒ ls-remote 恒返 2 ⇒ 永远误判「本机独有」（本卡夹具 G′ 当场抓住）。
  _TAG_REMOTE_STATE="unknown"
  _LSR_RC=0
  git ls-remote --exit-code --tags origin "refs/tags/$ver" >/dev/null 2>&1 || _LSR_RC=$?   # 显式捕获 rc（不依赖控制结构里的隐式 $?）
  case "$_LSR_RC" in
    0) _TAG_REMOTE_STATE="present" ;;        # 远端确有 → 共享态
    2) _TAG_REMOTE_STATE="absent" ;;         # ls-remote --exit-code: 2 = 查询成功但无匹配 ⇒ 远端确无
    *) _TAG_REMOTE_STATE="unqueryable" ;;    # 其余 rc（无 origin / 离线 / 认证失败）⇒ **不可判**，显式降级
  esac
  _ORPHAN_SEEN=""
      if ! git tag -l "$ver" | grep -q .; then
        # D521/§6: tag 不存在且推送目标非 main = 合法中间态（tag 在 main 合并后打）
        if [[ -n "${PUSH_BRANCH:-}" && "$PUSH_BRANCH" != "main" ]]; then
          echo -e "  ${YELLOW}⚠️  D331: $ver tag 未打 — feature 推送合法（§6: 合并后补打）${RESET}"
        else
          TAG_FAIL="${TAG_FAIL}  $ver 缺失（VERSION.md 最新版本无 tag）｜已推送=$( [[ $_TAG_REMOTE_STATE == present ]] && echo 是 || echo 否 )｜HEAD 祖先=否｜本机独有=$( [[ $_TAG_REMOTE_STATE == absent ]] && echo 是 || echo 未知 )\n"
        fi
      elif ! git merge-base --is-ancestor "$ver" HEAD 2>/dev/null; then # swallow-ok: if 条件消费 rc（锚点断裂判断）
        # 🔴 孤儿（tag 存在但非 HEAD 祖先）: 与第一段对齐 —— feature 侧**不构成阻断理由**
        if [[ -n "${PUSH_BRANCH:-}" && "$PUSH_BRANCH" != "main" ]]; then
          echo -e "  ${YELLOW}⚠️  D331: $ver 是本机孤儿 tag（非 HEAD 祖先）— feature 推送不阻断${RESET}"
          echo -e "  ${YELLOW}      自证: 已推送=$([[ $_TAG_REMOTE_STATE == present ]] && echo 是 || echo 否)｜HEAD 祖先=否｜$(  _tag_remote_zh "$_TAG_REMOTE_STATE")${RESET}"
          echo -e "  ${YELLOW}      解除: git tag -d $ver    （若确为正式版本: 在真实提交上重指 git tag -f -a $ver -m \"retag $ver\" <真实提交>）${RESET}"
          _ORPHAN_SEEN="${_ORPHAN_SEEN} $ver"
        else
          TAG_FAIL="${TAG_FAIL}  $ver 非 HEAD 祖先（VERSION.md 最新版本锚点断裂）｜已推送=$( [[ $_TAG_REMOTE_STATE == present ]] && echo 是 || echo 否 )｜HEAD 祖先=否｜本机独有=$( [[ $_TAG_REMOTE_STATE == absent ]] && echo 是 || echo 未知 )\n"
        fi
      fi
    fi
  fi
  if [[ -n "$TAG_FAIL" ]]; then
    echo -e "  ${RED}❌ D331: 版本 tag 锚点断裂:${RESET}"
    printf '%b' "$TAG_FAIL"
    echo -e "  ${RED}    解除（择一）:${RESET}"
    echo -e "  ${RED}      ① 该 tag 属本机残留/误打 ⇒ git tag -d $ver${RESET}"
    echo -e "  ${RED}      ② 该 tag 确为正式版本 ⇒ 在真实提交上重指: git tag -f -a $ver -m \"retag $ver (D331)\" <真实提交>${RESET}"
    echo -e "  ${RED}    ⚠️ main 上不做孤儿豁免: 版本锚点断裂是**客观事实**，必须修好再推（勿删他人 tag——先确认上面「本机独有」栏）${RESET}"
    return 1
  fi
  # 成功文案必须**名副其实**（D1243 修）: 否则它会让人以为已修好而放弃追查（卡 #1312 现场: 撞了 4 次
  #   都当副作用，因为没人去读第二段）。⇒ 分两种写法，且点名被豁免的孤儿。
  # 文案兼容性（D1243）: 保留子串「孤儿 tag 已豁免」—— `tag-bypass-wiring.test.sh`（他线夹具）
  #   按该字面量断言「输出明示豁免（不静默放过）」。⚠️ 旧文案**本身就是自相矛盾的**（第二段并未豁免），
  #   但那不是该断言要测的东西（它测"豁免要说出来"）⇒ 本卡**改真行为、并保留该措辞**，
  #   再补上"豁免范围/清单"使其**名副其实**，从而**零跨线改动**地同时满足两边。
  if [[ -n "${_ORPHAN_SEEN:-}" ]]; then
    echo -e "  ${GREEN}✅ D331: HEAD 祖先 tag 均为 main 可达（孤儿 tag 已豁免: 第一段 + VERSION.md 段；清单${_ORPHAN_SEEN}）${RESET}"
    echo -e "  ${GREEN}     清单内为**本机孤儿**，不阻断 feature 推送；解除命令见上方黄色段${RESET}"
  else
    echo -e "  ${GREEN}✅ D331: 全部版本 tag 锚点合法（孤儿 tag 已豁免: 本次未出现孤儿）${RESET}"
  fi
  return 0
}

# 测试注入: 只跑 tag 检查（D319 一致性 + D331 祖先 — tag-consistency.test.sh /
# tag-bypass-wiring.test.sh 用）
if [[ "${SYNO_TAG_ONLY:-}" == "1" ]]; then
  set +e
  EC=0
  check_tag_consistency || EC=1
  check_tag_ancestry || EC=1
  set -e
  exit "$EC"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Loop Engineering v2.0-D-A — pre-push (D334 同步 + secrets + 快检)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ═══ 门禁 0: 多机同步检查 (D334 — push 前强制 fetch + 落后/分叉检测 + main 保护) ═══
echo -e "${CYAN}── 多机同步检查 (D334) ─────────────────────────────${RESET}"
if ! check_push_sync "$PUSH_REMOTE" "$PUSH_BRANCH"; then
  echo ""
  echo -e "  ${RED}❌ 多机同步检查未通过 — 推送已拒绝 (D334)${RESET}"
  exit 1
fi

# D457: 删除操作 (git push --delete) — 同步检查通过后跳过其余门禁（删除分支无新提交/新代码）
if [[ -n "$IS_DELETE" ]]; then
  echo -e "  ${GREEN}✅ 删除操作 — 跳过 secrets/golden/vitest/对账等门禁（删除分支无新提交）${RESET}"
  exit 0
fi

# ═══ 门禁 1: secrets 终扫 ═══
echo -e "${CYAN}── secrets 终扫 (最后防线) ───────────────────────────${RESET}"
bash "$SCRIPT_DIR/check-secrets.sh" || {
  echo ""
  echo -e "  ${RED}❌ secrets 扫描未通过 — 推送已拒绝${RESET}"
  echo "  API key 一旦推到 GitHub, 轮换成本极高。请修复后重试。"
  exit 1
}

# ═══ D-A（v2.0 方案三，创始人 2026-10-07 批准）: 门禁 2/3 退役 ═══
# 退役对象: 门禁 2（golden-case F1 + checksum + 诊断结构质量，实测 60s+）
#          门禁 3（vitest 改基增量回归，实测可变 30-120s）
# 依据: 两者在 CI 均已权威执行——
#   · golden 三件: ci.yml `golden-case` job（9 必需 context 之一，合并级硬拦）
#   · vitest:      ci.yml `Vitest (1/2)(2/2)`（必需 context）
#   本地重复跑 = 每次 push 多 1-3 分钟 + npx 环境依赖（今晚实测 npx 缺失造成的假红一次）。
#   保留: 门禁 0（多机同步/防覆盖 D334）+ 1（secrets）+ 4/5/6/tag/7（全部 <5s 或仅告警）。
#   门禁 7（bypass 账本对账）**特意保留**——它今晚真实拦下一次 `--no-verify` 污染，
#   且为纯 grep、零耗时（偏离"只留 D334+secrets"的字面口径，理由与代价已在此留痕）。
# 回滚: 从 git 历史取回本块即恢复（判据脚本零改动）。

# ═══ 门禁 4: 工作区中间态保护 (D311 M1 — 警告不阻断) ═══
# push 只推已提交内容（改基已消除污染），但未提交的他人 src/ 改动需显式提示。
echo ""
echo -e "${CYAN}── 工作区中间态检查 (D311) ───────────────────────────${RESET}"
SESSION_REGISTRY="$SCRIPT_DIR/control-tower/session_registry.py"
if [[ -f "$SESSION_REGISTRY" ]]; then
  UNCOMMITTED_SRC=$(git status --porcelain 2>/dev/null | grep -E '^\s*[MAD?]' | awk '{print $2}' | grep -E '^src/' | head -10 || true)
  if [[ -n "$UNCOMMITTED_SRC" ]]; then
    ATTR_OUT=$(python3 "$SESSION_REGISTRY" attribution $UNCOMMITTED_SRC 2>/dev/null || echo '{"attribution":[]}')
    FOREIGN=$(echo "$ATTR_OUT" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    for a in d.get('attribution',[]):
        if a.get('owner'):
            print(f\"  ⚠️  {a['file']} 属于 {a['owner']}（未提交）— 工作区中间态; push 不包含它, 请协调提交顺序\")
except Exception:
    pass
" 2>/dev/null || true)
    if [[ -n "$FOREIGN" ]]; then
      echo -e "  ${YELLOW}${FOREIGN}${RESET}"
    fi
    NODECLARED=$(echo "$ATTR_OUT" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    no = [a['file'] for a in d.get('attribution',[]) if not a.get('owner')]
    if no: print(f\"  ℹ️  另有 {len(no)} 个 src/ 改动无写集登记（可能来自未注册 session）\")
except Exception:
    pass
" 2>/dev/null || true)
    if [[ -n "$NODECLARED" ]]; then
      echo -e "  ${CYAN}${NODECLARED}${RESET}"
    fi
  else
    echo -e "  ${GREEN}✅ 无未提交 src/ 改动${RESET}"
  fi
else
  echo -e "  ${YELLOW}⚠️  session_registry.py 缺失 — 中间态检查跳过 (fail-open)${RESET}"
fi

# ═══ 门禁 5: 并行声明物理验证 (D311 M1 — verify-parallel) ═══
# D540: verify-parallel 已移 CI/PR —— 本地不再强制 --scan-today（单机多 session 场景语义不准）。
# CI/PR 由 ci.yml 调 verify-parallel --ci-pr 做 base..head × 已合写集比对（权威物理拦截）。
echo ""
echo -e "${CYAN}── 并行声明物理验证 (D311) ───────────────────────────${RESET}"
VERIFY_PARALLEL="$SCRIPT_DIR/control-tower/verify-parallel.sh"
if [[ -f "$VERIFY_PARALLEL" ]]; then
  echo -e "  ${YELLOW}ℹ️  并行声明验证已移 CI/PR（D540）— 本地不再强制 --scan-today${RESET}"
  # 保留脚本可用性探针（fail-closed：脚本缺失 = CI 降级信号）；本地不再 exit 1 拦推送
else
  echo -e "  ${YELLOW}⚠️  verify-parallel.sh 缺失 — CI 并行声明验证将降级 (fail-open)${RESET}"
fi

# ═══ 门禁 6: 基线展示 (D312 M2 — baseline-check, 警告不阻断) ═══
# 展示 tsc 基线"存量 vs 新增"（豁免阻断归 D314 M4）；新增>0 → YELLOW 警告。
echo ""
echo -e "${CYAN}── 基线展示 (D312 baseline-check) ────────────────────${RESET}"
BASELINE_CHECK="$SCRIPT_DIR/control-tower/baseline-check.sh"
if [[ -f "$BASELINE_CHECK" ]]; then
  if ! bash "$BASELINE_CHECK" --tsc; then
    echo ""
    echo -e "  ${YELLOW}⚠️  存在新增 tsc 错误 — 请检查（基线豁免阻断归 D314）${RESET}"
  fi
else
  echo -e "  ${YELLOW}⚠️  baseline-check.sh 缺失 — 基线展示跳过 (fail-open)${RESET}"
fi

# ═══ 门禁 6 附挂: 版本 tag 一致性 (D319) + tag 锚点 (D331) — 硬阻断 ═══
echo ""
if ! check_tag_consistency; then
  echo ""
  echo -e "  ${RED}❌ 版本 tag 一致性未通过 — 推送已拒绝 (D319)${RESET}"
  exit 1
fi
if ! check_tag_ancestry; then
  echo ""
  echo -e "  ${RED}❌ 版本 tag 锚点校验未通过 — 推送已拒绝 (D331)${RESET}"
  exit 1
fi

# ═══ 门禁 7: bypass.log 执行证据链对账 (D331 L4-2 — 硬阻断) ═══
# 对比 origin..HEAD 提交与 .claude/bypass.log 的 HASH 条目；缺失 → 列出 + 拒绝。
# 历史提交已一次性补记（ea1cb71/dc369fd）；对账从 D331 起的新提交强制。
echo ""
echo -e "${CYAN}── bypass.log 对账 (D331) ───────────────────────────────${RESET}"
CHECK_BYPASS="$SCRIPT_DIR/control-tower/check-bypass-log.sh"
if [[ -f "$CHECK_BYPASS" ]]; then
  # D334: 对账 base 动态化 — PR 工作流下分支名每机器不同, 硬编码旧分支失效。
  # 优先 $PUSH_REMOTE/$PUSH_BRANCH（存在时），fallback origin/main（main 是唯一真相）。
  BYPASS_BASE=""
  # D521: 对账基永远取 origin/main——D508 merge-base 语义的前提（main 引入提交天然排除）。
  #   分支 ref 为基时，merge main 后 main 侧新提交落入分支范围 → 它们没有也不该有本分支
  #   登记 → 误拦（本批实证: merge 今日 main 后 8 个 main 提交被索登记）。
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    BYPASS_BASE="origin/main"
  elif [[ -n "$PUSH_REMOTE" && -n "$PUSH_BRANCH" ]] && git rev-parse --verify "$PUSH_REMOTE/$PUSH_BRANCH" >/dev/null 2>&1; then
    BYPASS_BASE="$PUSH_REMOTE/$PUSH_BRANCH"
  fi
  if ! bash "$CHECK_BYPASS" "$BYPASS_BASE"; then
    echo ""
    echo -e "  ${RED}❌ bypass.log 对账未通过 — 推送已拒绝 (D331)${RESET}"
    exit 1
  fi
else
  echo -e "  ${YELLOW}⚠️  check-bypass-log.sh 缺失 — 对账跳过 (fail-open)${RESET}"
fi

echo ""
echo -e "  ${GREEN}✅ 全部门禁通过 — 允许推送${RESET}"
echo ""
