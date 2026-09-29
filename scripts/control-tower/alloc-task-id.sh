#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# alloc-task-id.sh — D# 统一分配器（CT-36, 2026-08-16, D384 折入）
#
# 背景: D382 编号撞车 + D339 教训 — 分散取号 + 零检查 = 必然撞车。
#       本脚本是 D# 分配的唯一入口：查 task-state/ 占用表 → 分配下一个号 →
#       自动建空壳登记（先登记后使用）。任何角色（CTO 派活 / dev-doc / 编码）
#       取号必须调它，物理上防撞车。
#
# 契约:
#   @input  — 任务名（必填，--check-id 模式免）; --dry-run 只打印不写; --prefix <P> 命名前缀（D940 ④）
#             --check-id <D###> 只读校验：只答"该号是否被占"，不拿锁/不写盘/不算 MAX（D940 ③ 复用面）
#   @output — stdout: 分配到的 D#（如 D384）; 空壳 task-state/D384.json 已建
#   @degraded — task-state/ 不可读 → exit 1 + 提示（fail-closed，不盲发号）
#   @exit   — 0 = 分配成功（空壳已登记）; 非 0 = 失败。D938 成功哨兵：任何没走到
#             「显式成功退出点」的终止一律非 0（EXIT trap 不再把失败洗成 rc=0）；
#             骨架生成失败 → 回滚登记（不烧号）后非 0。
#   @seam   — 三处注入缝（测试沙箱隔离用；**生产不设 = 行为完全不变**）:
#             SYNO_TASK_STATE_DIR（占用表）/ SYNO_BRIEF_DIR（骨架落点）/
#             SYNO_LOCK_DIR（D938 新增：锁目录，默认 $ROOT/.alloc-task-id.lock — 取仓库根，
#             同工作树的并行进程共享同一把锁；设成各自唯一目录后，并行测试运行器互不等锁，
#             消除「等锁超时」型假红）。
#   @error  — 冲突位置逐行点名，标签 ∈ {task-state, origin-main, remote-branch, local-branch, worktree-name}
#             D940: 1 = 拒绝发号（号已在任一位置被占 / 跨位置校验失败 / task-state 不可读）；
#             ls-remote 不可达 → stderr `degraded: …` 显式可见 + 仍按可判定位置发号
#               ls-remote 不可达 → stderr `degraded: …` 显式可见 + 仍按可判定位置发号
#   @exit   — 0 = 发号成功（或 dry-run 预览且无冲突）
#             1 = 拒绝发号（号已在任一位置被占 / 跨位置校验失败 / task-state 不可读）
#   @error  — 冲突位置逐行点名，标签 ∈ {task-state, origin-main, remote-branch, local-branch, worktree-name}
#
# D940 变更（跨位置拒绝重号，**补缺口非造轮子**）:
#   现存能力（不在本卡内）：本地 task-state(:83) ∪ origin/main(:89-91) ∪ worktree task-state(:101-129)
#     ∪ `git branch -r` 远端分支(:141)；撞车拒绝(:164-168) **仅查本 task-state 目录**。
#   本卡补 4 条:
#     ① 远端占用改由 `git ls-remote --heads origin` 权威查询（`branch -r` 依赖本地 tracking ref，
#        未 fetch 即漏号——D736 撞号 / D730 登记项现场复现）。
#        ⚠ 设计决定: ls-remote 只喂**发号前校验**，不喂"下一个号"计算表 —— 二者若都喂，
#        NEXT 会直接跳过已被远端占用的号，"拒绝并点名"永不触发（与卡面验收 1 互斥）。
#        校验在决策点 fail-closed，正是卡面"绝不发放"的实质。
#     ② 号确定后跨位置二次校验：task-state ∪ origin/main ∪ remote-branch(local+remote) ∪ worktree 名/分支名
#     ③ 任一位置命中 → 拒绝并逐行点名冲突位置（fail-closed），不自动跳号
#     ④ --prefix <P> 命名前缀参数化（默认空），供 worktree/分支命名复用
#   性能: 真仓 ls-remote 实测 6.08s/666 分支 → 快照**在拿锁前**取，避免临界区被网络串行化
#        （锁等待上限 30s，见 L41）。超时可用 SYNO_ALLOC_LSREMOTE_TIMEOUT 调（默认 20s）。
#   注入缝（测试隔离，均沿用既有命名）:
#     SYNO_TASK_STATE_DIR / SYNO_BRIEF_DIR / SYNO_ALLOC_NO_REMOTE（仅 origin/main）
#     SYNO_ALLOC_NO_WORKTREE（worktree task-state + worktree 目录名）
#     SYNO_ALLOC_NO_BRANCH（整族分支名: `branch -r` 表源 + ls-remote 校验 + 本地分支名）
#   降级**不吃缝**: `degraded:` 表示"尝试了但不可达"，由夹具物理构造（origin 指向坏路径）。
#
# 用法:
#   bash alloc-task-id.sh "path-dependency 空壳补实现"      # 分配 + 建壳
#   bash alloc-task-id.sh "task-name" --dry-run             # 只预览下一个号
#   bash alloc-task-id.sh "task-name" --prefix squad-       # 带命名前缀
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# 项目标准定位: 脚本自身路径 → 仓库根（不依赖 git rev-parse, 兼容 worktree/沙箱）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# 注入缝 (测试隔离): SYNO_TASK_STATE_DIR 覆盖真实 task-state/
TASK_STATE_DIR="${SYNO_TASK_STATE_DIR:-$ROOT/task-state}"
TEMPLATE="$TASK_STATE_DIR/TEMPLATE.json"

DRY_RUN=false
PREFIX="${SYNO_ALLOC_PREFIX:-}"          # D940 ④: 命名前缀参数化（默认空 = 现状行为不变）
CHECK_ID=""                              # D940: --check-id 只读校验模式（不取号/不写盘/不拿锁）
_POS=()
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --dry-run)  DRY_RUN=true ;;
    --prefix)   shift; PREFIX="${1:-}" ;;
    --prefix=*) PREFIX="${1#--prefix=}" ;;
    --check-id) shift; CHECK_ID="${1:-}" ;;
    --check-id=*) CHECK_ID="${1#--check-id=}" ;;
    *)          _POS+=("$1") ;;
  esac
  shift
done
TITLE="${_POS[0]:-}"
# --check-id 免任务名（只读校验）；其余路径任务名必填
if [ -z "$CHECK_ID" ] && [ -z "$TITLE" ]; then
  echo "用法: alloc-task-id.sh <任务名> [--dry-run] [--prefix <P>] | alloc-task-id.sh --check-id <D###>" >&2
  exit 1
fi

# ═══ D456: 并发原子锁 — 撞号根治 ═══
# 背景: 同一 Mac 两个并发 DSH session 各自从陈旧 task-state 读 max，都拿到同一号
#       → D454/D455 撞车（D382 教训第二次复发）。根因 = 读 max→写 max+1 无原子性。
# 修法: mkdir 原子锁（跨平台零依赖，macOS 无 flock）包住"读占用表→分配→建壳"临界区。
#       两个进程同时 mkdir 同一锁目录，只有一个成功；另一个重试等待。
# 降级: 锁目录无法创建（权限/磁盘）→ 显式告警 + 继续（fail-open 不静默，铁律 11）。
# D938 增量: 锁目录也做成注入缝（同 SYNO_TASK_STATE_DIR / SYNO_BRIEF_DIR 模式）。
#   动机（c2 实测复现的假红源）: LOCK_DIR 固定取仓库根 → 同工作树内两个 alloc 测试/并行
#   运行器共享一把锁，互相等锁到 LOCK_WAIT_SEC 超时 → 假红（非产品缺陷）。生产不设该缝
#   时取值与改前逐字节相同 = 零行为变化。
LOCK_DIR="${SYNO_LOCK_DIR:-$ROOT/.alloc-task-id.lock}"
LOCK_WAIT_SEC=30
LOCK_POLL=0.2
# D938 成功哨兵: 只有走过「合法成功退出点」才置 DONE=1（见 _lock_release）。
#   动机: EXIT trap 退出码 = trap 内最后一条命令的退出码（实测 _lock_release 末句
#   `rmdir … || true` → 恒 0），且 set -e/set -u 中止时 trap 内 $? 读到 0、ERR trap
#   不触发 → 脚本报错却 rc=0（fail-open）。哨兵把「没成功」一律判成非 0。
DONE=0

_lock_acquire() {
  local waited=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do  # swallow-ok: mkdir 失败=锁已被占用，循环重试，非错误吞掉
    if [ -d "$LOCK_DIR" ]; then
      local lock_age
      lock_age=$(python3 -c "import os,time; print(int(time.time()-os.path.getmtime('$LOCK_DIR')))" 2>/dev/null || echo 0)  # swallow-ok: 拿锁龄失败=按 0 处理，非错误
      if [ "$lock_age" -gt 60 ] 2>/dev/null; then  # swallow-ok: 数值比较失败=lock_age 非数字，按不超时处理
        echo "⚠ 检测到陈旧锁（${lock_age}s），强制清理" >&2
        rmdir "$LOCK_DIR" 2>/dev/null || true  # swallow-ok: 锁清理失败=已释放，继续
        continue
      fi
    fi
    waited=$(python3 -c "print($waited + $LOCK_POLL)" 2>/dev/null || echo 30)  # swallow-ok: 计算失败=按超时处理
    if [ "$(python3 -c "print(1 if $waited > $LOCK_WAIT_SEC else 0)" 2>/dev/null || echo 1)" = "1" ]; then  # swallow-ok: 比较失败=按超时处理
      echo "❌ 获取分配锁超时（${LOCK_WAIT_SEC}s）— 可能有并发 session 卡住" >&2
      return 1
    fi
    sleep "$LOCK_POLL"
  done
  return 0
}

_lock_release() {
  local rc=$?  # 必须首句捕获：任何命令都会覆盖 $?
  # D938 fail-closed: 未走到显式成功退出点（DONE≠1）而 rc=0 → 判定失败。
  #   覆盖两种实测场景: (a) 末条命令决定 trap 退出码; (b) set -e/set -u 中止时 $? 读到 0。
  if [ "$rc" -eq 0 ] && [ "${DONE:-0}" != "1" ]; then
    rc=1
  fi
  rmdir "$LOCK_DIR" 2>/dev/null || true  # swallow-ok: 释放锁失败=已释放
  exit "$rc"  # 显式导出退出码（EXIT trap 内 exit 不回递归触发 trap）
}

# ═══ D940: 远端分支权威快照 — **拿锁前**取 ═══
# 为什么在锁外: 真仓 `git ls-remote --heads origin` 实测 6.08s / 666 分支。放进临界区会把
#   并发分配串行成 6s/次，撞 LOCK_WAIT_SEC=30 上限（并发锁失效）。快照只用于发号前校验。
# 读法: git -C "$TS_TOP" ls-remote --heads origin —— 走 repo 自身 remote 配置（不写死 URL/remote 名）
# D940返工(#743 K3 P0): TS_TOP 在此统算一次，后续全源（origin-main 合并/worktree/branch）沿用——
#   占用表任何源都不得混入 CWD 所在仓（原 origin/main 合并无 -C → 夹具/CI 读真仓 main，K3 实测发 D944）。
TS_TOP="$(git -C "$TASK_STATE_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")"
REMOTE_BRANCH_REFS=""
if [ "${SYNO_ALLOC_NO_BRANCH:-0}" = "1" ]; then
  :  # 注入缝: 关整族分支名检查（branch -r 表源 + 本快照 + 本地分支名）
elif [ -z "$TS_TOP" ]; then
  :  # task-state 不在 git 仓库内（测试沙箱/非常规布局）→ 无远端语义，跳过
else
  _LSR_TO="$(command -v timeout || command -v gtimeout || true)"
  _LSR_OUT=""
  _LSR_RC=0
  if [ -n "$_LSR_TO" ]; then
    _LSR_OUT="$("$_LSR_TO" "${SYNO_ALLOC_LSREMOTE_TIMEOUT:-20}" git -C "$TS_TOP" ls-remote --heads origin 2>/dev/null)" || _LSR_RC=$?
  else
    _LSR_OUT="$(git -C "$TS_TOP" ls-remote --heads origin 2>/dev/null)" || _LSR_RC=$?
  fi
  if [ "$_LSR_RC" -ne 0 ]; then
    # 降级: 显式可见（铁律 11），不静默；仍按可判定位置继续（卡面: 仍可用）
    echo "degraded: 远端分支不可达 (origin 未配置/网络不可达, rc=${_LSR_RC}) — 仅按可判定位置校验" >&2
  else
    REMOTE_BRANCH_REFS="$_LSR_OUT"
  fi
fi

# ── D940 ②③: 跨位置占用校验 — 打印该号已被占用的位置（每行一处；空 = 未占）──
# 标签固定 5 个: task-state / origin-main / remote-branch / local-branch / worktree-name
_occupy_locations() {
  local num="$1" ref ref_name short br base wt
  # ① 本地 task-state（本目录）
  if [ -f "$TASK_STATE_DIR/D${num}.json" ]; then
    printf 'task-state  %s\n' "$TASK_STATE_DIR/D${num}.json"
  fi
  # ② origin/main 的 task-state
  if [ "${SYNO_ALLOC_NO_REMOTE:-0}" != "1" ] && [ -n "$TS_TOP" ]; then
    if git -C "$TS_TOP" ls-tree --name-only origin/main task-state/ 2>/dev/null | grep -qx "task-state/D${num}.json"; then
      printf 'origin-main  origin/main:task-state/D%s.json\n' "$num"
    fi
  fi
  # ③ 远端分支（权威 ls-remote 快照；degraded 时该快照为空 = 此项不可判定）
  if [ -n "$REMOTE_BRANCH_REFS" ]; then
    while IFS= read -r ref; do
      [ -z "$ref" ] && continue
      # ls-remote 行格式 = <sha><TAB><ref> —— 必须取第 2 字段，否则会把 sha 带进输出
      # （D940 返工: 曾漏此步 → 点名行含 sha+tab 且括号内重复原文；匹配因"原含短名"而侥幸通过）
      ref_name="$(printf '%s' "$ref" | awk '{print $2}')"
      [ -z "$ref_name" ] && ref_name="$ref"   # 容错: 仅一字段时按整行当 ref
      short="${ref_name#refs/heads/}"
      if printf '%s' "$short" | grep -qiE "(^|[^0-9a-z])d${num}([^0-9]|\$)"; then
        printf 'remote-branch  %s (%s)\n' "$short" "$ref_name"
      fi
    done <<< "$REMOTE_BRANCH_REFS"
  fi
  # ④ 本地分支名
  if [ "${SYNO_ALLOC_NO_BRANCH:-0}" != "1" ] && [ -n "$TS_TOP" ]; then
    while IFS= read -r br; do
      [ -z "$br" ] && continue
      if printf '%s' "$br" | grep -qiE "(^|[^0-9a-z])d${num}([^0-9]|\$)"; then
        printf 'local-branch  %s\n' "$br"
      fi
    done <<< "$(git -C "$TS_TOP" for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null || true)"
  fi
  # ⑤ worktree 目录名（仅约定前缀 synova-wt-*，避免把任意临时目录当占用）
  if [ "${SYNO_ALLOC_NO_WORKTREE:-0}" != "1" ] && [ -n "$TS_TOP" ]; then
    while IFS= read -r wt; do
      [ -z "$wt" ] && continue
      base="${wt##*/}"
      case "$base" in
        .synova-wt-*|synova-wt-*) ;;
        *) continue ;;
      esac
      if printf '%s' "$base" | grep -qiE "(^|[^0-9a-z])d${num}([^0-9]|\$)"; then
        printf 'worktree-name  %s\n' "$base"
      fi
    done <<< "$(git -C "$TS_TOP" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}' || true)"
  fi
  return 0
}

# ── D940: --check-id 只读校验模式 ──
# 用途: 供 check-name-allocation.sh 复用**同一份**占用判定（避免第二副本 → 必然漂移）。
# 不拿锁、不写盘、不建壳、不算 MAX（故不受 §一 的表格扫描慢路径影响），只回答"这个号被占了吗"。
# @exit 0=未占 / 1=已占（逐行输出冲突位置） / 2=输入非法
if [ -n "$CHECK_ID" ]; then
  _CN="${CHECK_ID#[Dd]}"
  case "$_CN" in
    ''|*[!0-9]*) echo "非法卡号 '${CHECK_ID}'（应形如 D942 或 942）" >&2; exit 2 ;;
  esac
  _CK_CONFLICTS="$(_occupy_locations "$_CN")"
  if [ -n "$_CK_CONFLICTS" ]; then
    printf '%s\n' "$_CK_CONFLICTS"
    exit 1
  fi
  exit 0
fi

if ! _lock_acquire; then
  echo "❌ 无法获取分配锁 — 分配号中止（fail-closed，防撞号）" >&2
  exit 1
fi
trap _lock_release EXIT

# ── 读取已占用号（task-state/D*.json）──
if [ ! -d "$TASK_STATE_DIR" ]; then
  echo "❌ task-state/ 目录不存在: $TASK_STATE_DIR (fail-closed)" >&2
  exit 1
fi

# 提取已用 D 号: 唯一占用表 = task-state/D*.json（先登记后使用；brief 不参与发号）
USED=$(ls "$TASK_STATE_DIR"/D*.json 2>/dev/null | sed 's/.*\/D\([0-9]*\)\.json/\1/' | grep -E '^[0-9]+$' || true)  # swallow-ok: 空目录 ls 无匹配=正常（D# 从 1 开始）
# D940返工(#743 K3 P0): 占用表全源必须跟随 task-state 所属仓库（TS_TOP，已在远端快照段统算），
#   不得混入 CWD 所在仓。原实现 `git ls-tree origin/main`（无 -C）在夹具/CI 下读的是
#   **CWD 真仓**的 main → 真仓大号混入 MAX → NEXT≠夹具期望号 → D940 跨位置拒绝永不触发
#   （K3 实测"发 D944"即此）。生产环境 CWD=本仓时 `-C "$TS_TOP"` 行为不变。
REMOTE_USED=""
if [ "${SYNO_ALLOC_NO_REMOTE:-0}" = "1" ]; then
  :  # 测试注入缝: 禁用 remote 合并（隔离 origin/main 依赖，测本地发号语义）
elif [ -n "$TS_TOP" ] && git -C "$TS_TOP" ls-tree --name-only origin/main task-state/ >/dev/null 2>&1; then
  REMOTE_USED=$(git -C "$TS_TOP" ls-tree --name-only origin/main task-state/ 2>/dev/null | sed 's/.*\/D\([0-9]*\)\.json/\1/' | grep -E '^[0-9]+$' || true)
else
  echo "⚠ alloc-task-id: origin/main 不可读——仅按本地 task-state 发号（可能漏号，建议先 git fetch）" >&2
fi
USED="$(printf '%s\n%s\n' "$USED" "$REMOTE_USED" | grep -E '^[0-9]+$' || true)"

# D576（CT-54）: 在途分支/worktree 盲区修复——alloc 只看 origin/main + 本地主 task-state，
# 看不到其他 worktree / 本地分支 task-state 里「先登记后使用」的壳（D575 撞 D573 在途分支实证：
# alloc 发了 D573 而 chore/d573-* 分支已占用）。扫 git worktree list 的每个 worktree 的
# task-state/D*.json 合入占用表。语义：扫描跟随 TASK_STATE_DIR 所属仓库（测试注入临时目录
# = 非 git → 自动跳过）；SYNO_ALLOC_NO_WORKTREE=1 测试注入缝；降级显式提示（不静默）。
WORKTREE_USED=""
if [ "${SYNO_ALLOC_NO_WORKTREE:-0}" = "1" ]; then
  :  # 测试注入缝: 禁用 worktree 扫描
else
  # D940返工: TS_TOP 已在远端快照段统算，此处沿用（同归属，不重算）
  if [ -z "$TS_TOP" ]; then
    :  # task-state 目录不在 git 仓库内（测试沙箱/非常规布局）→ 无 worktree 语义，跳过
  elif WORKTREE_LIST=$(git -C "$TS_TOP" worktree list --porcelain 2>/dev/null); then
    WT_DIRS=$(printf '%s\n' "$WORKTREE_LIST" | awk '/^worktree /{print $2}')
    for wt in $WT_DIRS; do
      [ "$wt" = "$TS_TOP" ] && continue  # 主工作区已读（TASK_STATE_DIR）
      for f in "$wt"/task-state/D*.json; do
        [ -e "$f" ] || continue
        # D940（卡面范围外的必要前提修复，lead 2026-09-24 授权 A）:
        #   原为 `bn=$(basename "$f")` —— 每文件一次子进程。本机 200 个 worktree × 50,788 个
        #   task-state 文件 = 50,788 次 fork → 该循环实测 258s，使取号入口 ≈4.3 分钟（≫ LOCK_WAIT_SEC=30）。
        #   改纯参数展开：同字符串、零子进程、语义等价（见 D940 证据件「等价性 + 耗时」双证据）。
        #   仅此一处；WORKTREE_USED 累计展开等其它噪音不在本卡。
        bn="${f##*/}"
        case "$bn" in
          D[0-9]*.json)
            n=${bn#D}; n=${n%.json}
            case "$n" in ''|*[!0-9]*) continue ;; esac
            WORKTREE_USED="${WORKTREE_USED}${n}
"
            ;;
        esac
      done
    done
  else
    echo "⚠ alloc-task-id: git worktree list 失败——在途 worktree 占用检查跳过（可能漏号）" >&2
  fi
fi
USED="$(printf '%s\n%s\n' "$USED" "$WORKTREE_USED" | grep -E '^[0-9]+$' || true)"

# CT-63: 远端分支名 D# 扫描——Win/Claude 线自编号不走 alloc，分支名是唯一在途信号
#   （D593/D594 撞号实证：Win 用 D593 做 B-02/B-06，Mac 同时用 D593 做报告落盘）
#   扫描: git branch -r 全远端分支名中的 D[0-9]+（大小写不敏感）→ 合入占用表
#   注入缝: SYNO_ALLOC_NO_BRANCH=1（测试隔离）
BRANCH_USED=""
if [ "${SYNO_ALLOC_NO_BRANCH:-0}" = "1" ]; then
  :  # 测试注入缝
else
  # D940返工: TS_TOP 已在远端快照段统算，此处沿用（同归属，不重算）
  if [ -n "$TS_TOP" ]; then
    BRANCH_IDS=$(git -C "$TS_TOP" branch -r --format='%(refname:short)' 2>/dev/null | grep -ioE 'D[0-9]+' | tr '[:lower:]' '[:upper:]' | sed 's/D//' | grep -E '^[0-9]+$' || true)
    [ -n "$BRANCH_IDS" ] && BRANCH_USED="$BRANCH_IDS"
  fi
fi
USED="$(printf '%s\n%s\n' "$USED" "$BRANCH_USED" | grep -E '^[0-9]+$' || true)"

ALL_USED=$(printf "%s\n" "$USED" | grep -E '^[0-9]+$' | sort -n | uniq || true)
MAX=$(printf "%s\n" "$ALL_USED" | tail -1 | grep -E '^[0-9]+$' || echo "0")
# D456: pipefail 下空 task-state 时 tail/grep 非零导致静默退出，显式兜底
MAX="${MAX:-0}"
[ -z "$MAX" ] && MAX="0"
NEXT=$((10#$MAX + 1))
# D500 起步（2026-08-22 创始人定）：Mac/DSH 线编号与 Win 段撞车（D471 冲突），
# 500 起避开 Win 段。Win 继续用 <500 段，两线互不干扰。
[ "$NEXT" -lt 500 ] && NEXT=500
NEW_ID="D${NEXT}"

# ═══ D940 ③: 号确定后跨位置二次校验 — 任一位置已占 → 拒绝发号（fail-closed，绝不发放）═══
_CONFLICTS="$(_occupy_locations "$NEXT")"
_ID_LOWER="$(printf '%s' "$NEW_ID" | tr '[:upper:]' '[:lower:]')"

if [ "$DRY_RUN" = true ]; then
  echo "$NEW_ID (dry-run, 未建壳)"        # stdout 首行 = 预览（既有测试 head -1 依赖，勿前置其它输出）
  [ -n "$PREFIX" ] && echo "worktree 名: .synova-wt-${PREFIX}${_ID_LOWER}"
  if [ -n "$_CONFLICTS" ]; then
    echo "❌ 撞车: $NEW_ID 已被占用 — 拒绝发号（fail-closed）" >&2
    printf '%s\n' "$_CONFLICTS" | sed 's/^/   冲突位置: /' >&2
    exit 1
  fi
  DONE=1  # D938: 合法成功退出点
  exit 0
fi

# ── D938: 骨架路径先算好（纯计算，零副作用）——必须在登记 task-state **之前** ──
# D521: SYNO_BRIEF_DIR 注入缝（测试隔离，同 SYNO_TASK_STATE_DIR 模式）——
#   修测试污染: alloc-task-id.test.sh 曾在真实 brief 目录生成占位 brief（含模板排除项
#   占位文本，CI strict 下 plan-integrity 硬炸）
BRIEF_DIR="${SYNO_BRIEF_DIR:-$ROOT/.claude/task-briefs}"
# D938 缺陷③: title 含路径分隔符（如 "M1/ownership 域修正"）→ 骨架路径裂成子目录
#   → 生成失败，但 D# 已登记 = **孤儿号**（号烧掉、无人认领；实测 D500 已登记 + 骨架 0 个）。
#   修法: 路径分隔符（`/`、Windows `\`）与空格统一转 `-`，保持可读。
SAFE_TITLE="$(printf '%s' "$TITLE" | tr ' /' '--' | tr '\\' '-')"
BRIEF_FILE="$BRIEF_DIR/$(date +%Y-%m-%d)-${NEW_ID}-${SAFE_TITLE}.md"

if [ -n "$_CONFLICTS" ]; then
  echo "❌ 撞车: $NEW_ID 已被占用 — 拒绝发号（fail-closed，不自动跳号）" >&2
  printf '%s\n' "$_CONFLICTS" | sed 's/^/   冲突位置: /' >&2
  echo "   💡 先 git fetch --all 同步远端占用后重试；或核对上述位置是否应清理" >&2
  exit 1
fi

# ── 建空壳登记（先登记后使用）──
STATE_FILE="$TASK_STATE_DIR/$NEW_ID.json"
if [ -f "$STATE_FILE" ]; then
  echo "❌ 撞车: $NEW_ID 已存在 ($STATE_FILE) — 手工清理后重试" >&2
  exit 1
fi

cat > "$STATE_FILE" <<EOF
{
  "task_id": "$NEW_ID",
  "title": "$TITLE",
  "status": "claimed",
  "spec": null,
  "impl": null,
  "audit": null,
  "fix_task_id": null,
  "updated_at": "$(date +%Y-%m-%d)",
  "updated_by": "alloc-task-id"
}
EOF

echo "$NEW_ID"
echo "已登记: $STATE_FILE (status=claimed)"
# D940 ④: 命名前缀参数化 — 默认空则不输出（既有行为逐字节不变）；给前缀则输出复用名
[ -n "$PREFIX" ] && echo "worktree 名: .synova-wt-${PREFIX}${_ID_LOWER}"
# D508: 生成 brief 骨架（六字段模板接线——认领即有模板，格式错误不靠提交失败发现）
# D718 机制级防线（同类第二次复发）: D521 已给 alloc-task-id.test.sh 补 SYNO_BRIEF_DIR 注入缝，
#   但 alloc-task-id-lock.test.sh 漏设 → 每次运行把 20 份骨架 brief 写进**真实仓库**
#   （实测泄漏 56 份）。逐测试打补丁无效（同类第 2 次）→ 在源头 fail-closed：
#   task-state 被注入（= 测试沙箱）而 brief 目录未注入时，拒绝生成骨架，显式告警不静默。
#   生产路径不受影响（不设 SYNO_TASK_STATE_DIR 时该分支不触发）。
if [ -n "${SYNO_TASK_STATE_DIR:-}" ] && [ -z "${SYNO_BRIEF_DIR:-}" ]; then
  echo "⚠ alloc-task-id: task-state 已注入（${TASK_STATE_DIR}）但未注入 SYNO_BRIEF_DIR" >&2
  echo "  → 跳过 brief 骨架生成，防污染真实仓库（测试请同时设 SYNO_BRIEF_DIR）" >&2
  DONE=1  # D938: 合法提前退出（D718 守卫），非失败 —— 不得被成功哨兵误判
  exit 0
fi

# D938 同成同败: 骨架是「认领即完成」的一半，生成失败必须回滚刚登记的空壳 ——
#   否则留下孤儿号（号已烧、骨架 0 个，实测 D500）。回滚点安全：登记前已确认该文件不存在。
_brief_generation_failed() {
  rm -f "$STATE_FILE" 2>/dev/null || true  # swallow-ok: 回滚失败不掩盖主错误（下一句即非零退出）
  echo "❌ brief 骨架生成失败（$1）→ 已回滚 $NEW_ID 登记（防空烧号，fail-closed）" >&2
  exit 1
}
if [ -n "${NEW_ID:-}" ] && [ ! -f "$BRIEF_FILE" ]; then
  mkdir -p "$BRIEF_DIR" || _brief_generation_failed "目录创建失败: $BRIEF_DIR"
  cat > "$BRIEF_FILE" <<SKEL || _brief_generation_failed "写入失败: $BRIEF_FILE"
# Task Brief: ${NEW_ID} ${TITLE}

> 生成: $(date +%Y-%m-%d) | 任务: ${NEW_ID} | 认领: <agent>
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
<本任务在哪一层？该层现有模块？>
### b) 文件审计
<grep 关键文件，file:line 引用>
### c) 决策
<复用/新建/取消 及理由>

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
<引用铁律编号 + memory/ 教训；多选项必填决策参考小节>
参考：<参考系 + 结论>

## Q2: 范围 — 正确的最简方案
做什么：
- <path/to/file.ts — 改什么>
不做什么：
- 不改 scripts/audit/（K3 红线）
- 不改 <具体文件路径，排除项必须含文件名>

## Q3: 验收 — 入口 → 交互 → 结果
入口：<从哪触发>
处理：<中间步骤>
结果：<最终可验证输出>

## 架构层:
<L1-L5 或 scripts（控制塔）>

## Done 标准
- [ ] verify: <可执行命令> <预期>
SKEL
  echo "brief 骨架已生成: ${BRIEF_FILE}（填写后开工）"
fi
DONE=1  # D938: 合法成功退出点（空壳 + 骨架均已落盘）
exit 0
