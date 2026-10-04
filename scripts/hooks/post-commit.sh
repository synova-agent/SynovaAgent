#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# hooks/post-commit.sh — V4.5.1 提交后处理
#
# 被 .git/hooks/post-commit 调用 (通过 core.hooksPath 或委托脚本)。
# 所有 session 共用同一份，修改即同步。
# ═══════════════════════════════════════════════════════════════════════════════
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MARKER="$ROOT/.claude/last-precommit-success"

# ═══ D1145 / D735 Stage 2: bypass 账本 —— per-session 落点**权威** + 本地兼容镜像 ═══
# 契约(铁律 47):
#   @input  — stdin 一行证据文本
#   @output — 同一行追加到 ① $ROOT/.sessions/<sid>/bypass.log（**权威**；.sessions/ 已被
#               .gitignore 忽略 ⇒ 写入不产生任何 git 工作树变更）
#                           ② $ROOT/.claude/bypass.log（**本地兼容镜像**；D1145 起已停跟踪，
#               保留仅为旧读者兼容：pre-commit GATEKEEPER / 7c 审计 / check-bypass-log）
#   @degraded — ① 失败 → 仍写 ②（证据不丢）+ stderr 显式点名（铁律 11：不静默）
_bypass_append() {
  local line out rc
  line="$(cat)"
  out="$(bash "$ROOT/scripts/control-tower/bypass-ledger.sh" append "$line" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "  ⚠️  post-commit: per-session 账本写入失败 (exit=$rc): $out" >&2
    echo "      回退：仍写本地兼容镜像 .claude/bypass.log（已停跟踪，不污染工作树；证据不丢）" >&2
  fi
  printf '%s\n' "$line" >> "$ROOT/.claude/bypass.log"
}

# ═══ D1145: 幂等判据 —— 该 HASH 是否已在账本里（替代原「影子提交 message 防递归」）═══
# 契约(铁律 47):
#   @input  $1=commit HASH
#   @output exit 0=已登记 / 1=未登记（含账本不可读→按"未登记"处理，宁可多记一行不丢证据）
#   @degraded 账本解析失败 → 回退本地镜像单源
_ledger_has_hash() {
  local h="$1" srcs=""
  srcs="$(bash "$ROOT/scripts/control-tower/bypass-ledger.sh" sources 2>/dev/null)" || srcs=""
  [ -n "$srcs" ] || srcs="$ROOT/.claude/bypass.log"
  # shellcheck disable=SC2086  # 有意分词: 换行分隔的多来源列表
  grep -q "$h" $srcs 2>/dev/null
}

# ═══ --no-verify 绕过检测 (D366 head 对账 + D421 CT-29 分场景三判) ═══
# marker 格式 (install-hooks.sh pre-commit 写): <pre-commit 时 HEAD>|<epoch 秒>
# 判定 (三判, 消除 CT-29 并发/amend 误报):
#   ① marker_head == HEAD^                        → 常规 commit (pass)
#   ② marker_head^  == HEAD^                      → amend/同父兄弟 (pass)
#   ③ merge-base --is-ancestor marker_head HEAD   → 并发覆盖, marker 仍是祖先 (pass)
#   都不满足                                      → detected-bypass
# 收紧补偿: 三判统一做新鲜度校验 (marker 时间戳 vs HEAD 提交时间差 >300s → possible-bypass),
#          防真 --no-verify 停在旧 marker 时被 ③ 祖先对账误判 pass。
# legacy 纯时间戳 (旧 install-hooks 过渡期) → 旧语义, 但不 rm
# root commit (无 HEAD^) → 显式降级, 不误报
FRESHNESS_SEC=300
# ═══ CT-45: merge 提交跳过 bypass 判定 ═══
# merge 提交（HEAD 有第二 parent：本地 git merge 冲突解决后 commit / GitHub PR merge 同步拉取）不经
# 本地 pre-commit hook 或 marker 语义不同（冲突解决 + 门禁拦截时常以 --no-verify 完成 merge commit）——
# 写 detected-bypass 会污染今日计数 → Gatekeeper 熔断同日其他 session 的合法提交（D524 实证：98c5ceff 熔断 D524）。
# 判定: git rev-parse HEAD^2 存在 = 第二 parent 存在 = merge commit。
MERGE_COMMIT=0
if git rev-parse HEAD^2 >/dev/null 2>&1; then
  MERGE_COMMIT=1
fi
if [ "$MERGE_COMMIT" = "1" ]; then
  # merge 提交——合法豁免 bypass 判定（CT-45，语义同 D328 commit-msg MERGE_HEAD 豁免）
  :
else
if [ -f "$MARKER" ]; then
  RAW=$(cat "$MARKER" | tr -d '[:space:]')
  if echo "$RAW" | grep -q '|'; then
    MARKER_HEAD="${RAW%%|*}"
    MARKER_TS="${RAW##*|}"
    PARENT=$(git rev-parse HEAD^ 2>/dev/null || true)
    HEAD_CT=$(git show -s --format=%ct HEAD 2>/dev/null || echo 0)
    if [ -z "$PARENT" ]; then
      # root commit (无 parent) — 无法对账, 显式降级 (不误报)
      echo "  ⚠️  post-commit: root commit (无 HEAD^) — 跳过 bypass 判定" >&2
    elif [ -n "$MARKER_HEAD" ]; then
      PASS_WAY=0
      if [ "$MARKER_HEAD" = "$PARENT" ]; then
        PASS_WAY=1   # ① 常规
      elif [ "$(git rev-parse "${MARKER_HEAD}^" 2>/dev/null || true)" = "$PARENT" ]; then
        PASS_WAY=2   # ② amend/同父兄弟
      elif git merge-base --is-ancestor "$MARKER_HEAD" HEAD 2>/dev/null; then # swallow-ok: 非祖先=条件假(合法分支), 错误静默可接受
        PASS_WAY=3   # ③ 并发覆盖 (marker 仍是 HEAD 祖先)
      fi
      if [ "$PASS_WAY" -ne 0 ]; then
        # 新鲜度校验 (三判统一): marker 时间戳相对 HEAD 提交时间过旧 → possible-bypass
        case "$MARKER_TS" in
          ''|*[!0-9]*) : ;;   # 时间戳缺失/非数字 → 跳过新鲜度检查
          *) DIFF=$((HEAD_CT - MARKER_TS))
             if [ "$DIFF" -gt "$FRESHNESS_SEC" ]; then
               echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) possible-bypass diff=${DIFF}s" | _bypass_append
             fi ;;
        esac
        # pass — D366: 不 rm, marker 只由 pre-commit 覆盖 (并发 session 互不误删)

        # ═══ D1145 / D735 Stage 2: COMMITTED 登记（**无影子提交**）═══
        # 历史（D521 → D537 #4）: bypass.log 曾是 **git 跟踪文件** ⇒ commit 后必脏 ⇒ hook 只能
        #   立刻把它 commit 掉（"影子登记提交"）才不挡 merge ⇒ 每个提交都派生一条
        #   `chore: bypass COMMITTED 登记 (auto hook, D521)`。
        # 代价（实测）: 9 月 1199 个提交里 327 条（27%）是这种机械提交；126/136 个 open PR
        #   都改这个文件 ⇒ 两两冲突。
        # D1145 的解法: 该文件**停跟踪**（.gitignore）⇒ 写入不再产生任何 git 变更 ⇒
        #   **影子提交整段删除**（不再需要"保持树干净"这个动作）。
        # 证据链不降级: HASH 经 _bypass_append 写入 per-session 权威账本（+ 本地镜像）。
        # 幂等: D1145 用 **_ledger_has_hash** 取代原「影子提交 message 防递归」——
        #   前一版靠"上一条提交 message 是登记提交"来跳过重复登记，本质是借影子的副作用当锁；
        #   影子移除后该锁消失，同一 HASH 会被迟到/重复的 post-commit 再登记一次（实测 S6b +1 行）。
        #   现改为按 HASH 幂等：已登记即跳过（与迟到、amend、并发无关）。
        # 只在 PASS_WAY≠0（pre-commit 真跑过）时登记；--no-verify 提交不登记（不洗白绕过）。
        HASH_NOW=$(git rev-parse HEAD 2>/dev/null || true)
        if [ -n "$HASH_NOW" ] && ! _ledger_has_hash "$HASH_NOW"; then
          echo "$(date -Iseconds) | COMMITTED | pre-commit PASS (hook 层登记) | HASH=$HASH_NOW" | _bypass_append
        fi
      else
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) detected-bypass head-mismatch marker=$MARKER_HEAD parent=$PARENT" | _bypass_append
      fi
    fi
  else
    # legacy 纯时间戳格式 (旧 install-hooks 写 date +%s) — 旧语义, 但不 rm
    LAST="$RAW"
    NOW=$(date +%s)
    case "$LAST" in
      ''|*[!0-9]*) : ;;
      *) DIFF=$((NOW - LAST))
         if [ "$DIFF" -gt "$FRESHNESS_SEC" ]; then
           echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) possible-bypass diff=${DIFF}s" | _bypass_append
         fi ;;
    esac
  fi
else
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) detected-bypass no-precommit-marker" | _bypass_append
fi
fi

# V4.5.1: STATE.md 已移除。证据链由 git log 提供。
# 不再写入 STATE.md。

# ═══ D210: 外部审计器 — 提交后自动扫描 ═══
AUDITOR="$ROOT/scripts/control-tower/external-auditor.sh"
if [ -f "$AUDITOR" ]; then
  # D421: grep -oP 在 macOS BSD grep 无 -P → TASK_ID 恒 unknown (D334 双机残留)
  # 改 portable: grep -oE 'D[0-9]+' 提取 "D411" → tr 剥 D → "411"
  TASK_ID=$(git log -1 --pretty=%B | head -1 | grep -oE 'D[0-9]+' | head -1 | tr -d 'D' || true)
  [ -n "$TASK_ID" ] || TASK_ID="unknown"
  bash "$AUDITOR" --task-id "D${TASK_ID}" --diff HEAD~1..HEAD 2>&1 | tail -3
fi

# ═══ D256: 审计器统一入口 — 提交后自动 --dispatch ═══
if [ -f "$AUDITOR" ]; then
  bash "$AUDITOR" --dispatch 2>&1 | tail -3
fi

# ═══ 决策流程 ═══
bash "$ROOT/scripts/workflow/decide-next.sh" 2>/dev/null &
exit 0
