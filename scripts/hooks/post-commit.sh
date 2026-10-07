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
#   @input  $1=commit HASH（全长 40 位）
#   @output exit 0=已登记 / 1=未登记（含账本不可读→按"未登记"处理，宁可多记一行不丢证据）
#   @degraded 账本解析失败 → 回退本地镜像单源
#
# 🔴 D1157（P0 假绿根修的**写入侧**同源修正 —— 判据与 scripts/control-tower/check-bypass-log.sh
#   的 `D1157-REC-RE` 块**逐字同源**；改一处必须改两处，漂移由
#   tests/control-tower/post-commit.test.sh 的「同源断言」夹具物理把守）:
#   旧判据 `grep -q "$h" $srcs` **无锚** ⇒ 该 sha 出现在账本**任何位置**都算"已登记"：
#   典型冒充源 = `detected-bypass … marker=<sha> parent=<sha>`（关于**别的**提交的字段）
#   ⇒ hook 误判"已登记"⇒ **跳过写 COMMITTED 行** ⇒ 证据链静默缺一条，
#     且与修复后的对账器判据**不对称**（写侧认为已记 / 读侧认为未记 ⇒ 推送时被判红）。
#   新判据 = 只认「COMMITTED 记录行的 `HASH=` 字段值」，且该值是提交 sha 的**前缀**
#   （记录可短：实测历史 10 条为 8 位短 sha；`HASH=` 值长度有界 7–40，防"两条记录挤一行"过捕）。
#   定锚依据（真实语料普查 140 份账本 / 118,077 行 / 2,501 distinct）见 brief §格式普查。
# 逐字同源块（与 check-bypass-log.sh 同；块内只允许 BEGIN/END 标记 + 一行 `_REC_RE=…`）。
# D1157-REC-RE-BEGIN
_REC_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+[^ |]*[[:space:]]*\|?[[:space:]]*COMMITTED'
# D1157-REC-RE-END
_ledger_has_hash() {
  local h="$1" srcs="" rec v
  srcs="$(bash "$ROOT/scripts/control-tower/bypass-ledger.sh" sources 2>/dev/null)" || srcs=""
  [ -n "$srcs" ] || srcs="$ROOT/.claude/bypass.log"
  # shellcheck disable=SC2086  # 有意分词: 换行分隔的多来源列表
  rec="$(grep -hE "$_REC_RE" $srcs 2>/dev/null | grep -oE 'HASH=[0-9a-fA-F]{7,40}' | sed 's/^HASH=//' | tr 'A-F' 'a-f' | sort -u)"  # swallow-ok: 来源缺失/无匹配 → 空集 ⇒ 按"未登记"（宁可多记一行，不丢证据）
  [ -n "$rec" ] || return 1
  while IFS= read -r v; do
    [ -n "$v" ] || continue
    case "$h" in "$v"*) return 0 ;; esac
  done <<< "$rec"
  return 1
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
        # ═══ #1270（2026-10-07，Lead 立案；R1 收口 verifier P2）: **区分「重写」与「真绕过」** ═══
        #   病根: rebase / cherry-pick 会重放提交，其 parent 必与 marker 里的旧 HEAD 不同
        #     ⇒ 旧逻辑一律判 detected-bypass（实测当日 8 条误报）。
        #   🔴 R1 收口（verifier P2，Lead 裁）: `in-progress` 原先**仅看目录存在** ⇒
        #     ① 陈旧残留（一次中断的 rebase 留下的目录）会把此后所有 mismatch 都降级为 suspected；
        #     ② `mkdir .git/rebase-merge` 一行即可把真 --no-verify 洗成 suspected ⇒ 阈值不触发。
        #     ⇒ 现要求**佐证**: 状态文件 `<rebase-{merge,apply}>/orig-head` 存在 **且**
        #       marker 是该 orig-head 的祖先（该会话确实在 marker 之后重放）才认 in-progress；
        #       并按类记录 + 标注 `forgeable=1`（状态文件类可被伪造 ⇒ 消费侧可见但不计确证）。
        #   三类（互斥，按强度排序）:
        #     rebase-state        : orig-head 佐证通过（forgeable=1）
        #     cherry-pick-state   : CHERRY_PICK_HEAD 佐证通过（forgeable=1）
        #     tree-subject-match  : HEAD 与 marker 提交同 subject 同 tree（**内容类，不可靠 mkdir 伪造**，forgeable=0）
        #   都不命中 ⇒ 维持 detected-bypass（**不许静默漏判**）。
        REBASE_DIR="$(git rev-parse --git-path rebase-merge 2>/dev/null || true)"
        REBASE_APPLY="$(git rev-parse --git-path rebase-apply 2>/dev/null || true)"
        CP_HEAD="$(git rev-parse --git-path CHERRY_PICK_HEAD 2>/dev/null || true)"
        REWRITE=0; REWRITE_WHY=""; REWRITE_FORGEABLE=0; REWRITE_KIND=""
        ORIG_HEAD_FILE=""
        if [ -n "$REBASE_DIR" ] && [ -f "$REBASE_DIR/orig-head" ]; then ORIG_HEAD_FILE="$REBASE_DIR/orig-head"
        elif [ -n "$REBASE_APPLY" ] && [ -f "$REBASE_APPLY/orig-head" ]; then ORIG_HEAD_FILE="$REBASE_APPLY/orig-head"
        fi
        ORIG_HEAD_SHA=""
        [ -n "$ORIG_HEAD_FILE" ] && ORIG_HEAD_SHA="$(tr -d '[:space:]' < "$ORIG_HEAD_FILE" 2>/dev/null || true)"  # swallow-ok: 读失败⇒空值⇒下一句 ancestry 判否（按"不算 in-progress"处理，宁可判 detected）
        if [ -n "$ORIG_HEAD_SHA" ] && [ -n "$MARKER_HEAD" ] \
           && git merge-base --is-ancestor "$MARKER_HEAD" "$ORIG_HEAD_SHA" 2>/dev/null; then
          REWRITE=1; REWRITE_WHY="rebase-state"; REWRITE_FORGEABLE=1; REWRITE_KIND="in-progress"
        else
          CP_SHA=""
          [ -n "$CP_HEAD" ] && [ -f "$CP_HEAD" ] && CP_SHA="$(tr -d '[:space:]' < "$CP_HEAD" 2>/dev/null || true)"  # swallow-ok: 同上
          if [ -n "$CP_SHA" ] && [ -n "$MARKER_HEAD" ] \
             && git merge-base --is-ancestor "$MARKER_HEAD" "$CP_SHA" 2>/dev/null; then
            REWRITE=1; REWRITE_WHY="cherry-pick-state"; REWRITE_FORGEABLE=1; REWRITE_KIND="in-progress"
          elif [ -n "$MARKER_HEAD" ] \
            && [ "$(git show -s --format=%s HEAD 2>/dev/null || true)" = "$(git show -s --format=%s "$MARKER_HEAD" 2>/dev/null || true)" ] \
            && [ -n "$(git rev-parse 'HEAD^{tree}' 2>/dev/null || true)" ] \
            && [ "$(git rev-parse 'HEAD^{tree}' 2>/dev/null || true)" = "$(git rev-parse "${MARKER_HEAD}^{tree}" 2>/dev/null || true)" ]; then
            REWRITE=1; REWRITE_WHY="tree-subject-match"; REWRITE_FORGEABLE=0; REWRITE_KIND="content"
          fi
        fi
        if [ "$REWRITE" -eq 1 ]; then
          echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) suspected-rewrite head-mismatch marker=$MARKER_HEAD parent=$PARENT suspect=$REWRITE_WHY kind=$REWRITE_KIND forgeable=$REWRITE_FORGEABLE" | _bypass_append
          echo "  ℹ️  post-commit: head 不一致但判定为**重写**（suspect=$REWRITE_WHY forgeable=$REWRITE_FORGEABLE）—— 记 suspected-rewrite（保留记录，不计入确证绕过阈值）" >&2
        else
          echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) detected-bypass head-mismatch marker=$MARKER_HEAD parent=$PARENT" | _bypass_append
        fi
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
