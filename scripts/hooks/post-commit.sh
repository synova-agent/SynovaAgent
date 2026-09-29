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

# ═══ D735 Stage 1: bypass 账本双写（旧路径权威 + per-session 并存）═══
# 契约(铁律 47):
#   @input  — stdin 一行证据文本
#   @output — 同一行追加到 ① $ROOT/.claude/bypass.log（旧路径；Stage 1 仍是权威，行为不变）
#                           ② $ROOT/.sessions/<sid>/bypass.log（新落点；.gitignore:83 已忽略）
#   @degraded — 新落点写入失败 → stderr 显式点名 + 不阻断（旧路径已登记，证据不丢；铁律 11 不静默）
_bypass_append() {
  local line out rc
  line="$(cat)"
  printf '%s\n' "$line" >> "$ROOT/.claude/bypass.log"
  out="$(bash "$ROOT/scripts/control-tower/bypass-ledger.sh" append "$line" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "  ⚠️  post-commit: per-session 账本写入失败 (exit=$rc): $out" >&2
    echo "      旧路径已登记（证据不丢）——新落点未写属 Stage 1 并存降级" >&2
  fi
}

# ═══ CT-2 (D1023 批次): 软失败被放行 ⇒ 账本记真实状态（不记纯 PASS）═══
# 缺口（改前实测，原始输出见 docs/synova/product-lines/evidence/CT2-*）:
#   pre-commit 硬失败被 .git/hooks/pre-commit wrapper（install-hooks.sh 生成）**软化放行**后，
#   本 hook 仍写 `COMMITTED | pre-commit PASS (hook 层登记)` —— 而真实状态在
#   .claude/gate-soft-warnings.log = `<ts> | GATE_FAIL_SOFT | exit=1 | branch=…`。
#   同一提交两处记录互相矛盾：账本把「门禁失败但放行」记成纯 PASS（审计无法复算门禁健康度）。
# 契约(铁律 47):
#   @input  — 无参；读 ① $ROOT/.claude/gate-soft-warnings.log（wrapper 先 append）
#                      ② marker 文件 mtime（wrapper 后写，同一轮 pre-commit 内）
#   @output — 空 = 本次提交与「软失败放行」无关联 → 上层写**原 PASS 行，文本一字不动**；
#             非空 = "DEGRADED-PASS (soft-fail allowed ts=<证据行 ts> exit=<n>)" → 上层写真实状态
#   @degraded — 日志/marker 缺失或 stat 不可用 → 返回空（退回原行为，不臆造 DEGRADED；宁少标不误标。
#             真实状态本身已由 wrapper 的 gate-soft-warnings.log / pre-commit-failures.log 双留痕）
# 配对依据（不解析时间戳，纯文件写入序——跨平台零 date 方言依赖）:
#   wrapper 顺序 = append 软失败行 → 写 marker ⇒ 同一轮两次写入 mtime 相差 <1s；
#   下一轮干净提交会**重写 marker**（mtime 前移）而日志不变 ⇒「marker 比日志新」= 该软失败行
#   已过时，不再标注（防把后续干净提交误标为 DEGRADED）。
#   窗口 SYNO_SOFT_FAIL_WINDOW（秒，默认 5）可调；实测同一轮差值 = 0s。
_mtime_sec() { # <file> → mtime 秒（BSD stat → GNU stat 回退；都不可用 → 空）
  local f="$1" v=""
  v="$(stat -f %m "$f" 2>/dev/null || true)"
  [ -n "$v" ] || v="$(stat -c %Y "$f" 2>/dev/null || true)"
  printf '%s' "$v"
}
_softfail_state() {
  local log="$ROOT/.claude/gate-soft-warnings.log" row lm mm win ts ex
  [ -f "$log" ] || return 0
  row="$(grep 'GATE_FAIL_SOFT' "$log" 2>/dev/null | tail -1 || true)"
  [ -n "$row" ] || return 0
  lm="$(_mtime_sec "$log")"; mm="$(_mtime_sec "$MARKER")"
  [ -n "$lm" ] && [ -n "$mm" ] || return 0
  win="${SYNO_SOFT_FAIL_WINDOW:-5}"
  [ "$((mm - lm))" -le "$win" ] || return 0   # marker 比日志新 → 软失败行属更早一轮（已过时）
  [ "$((lm - mm))" -le "$win" ] || return 0
  ts="$(printf '%s' "$row" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/,"",$1); print $1}')"
  ex="$(printf '%s' "$row" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/,"",$3); print $3}')"
  # 消费判定（决定性，补 mtime 窗口在同一秒内的盲区）: 该证据行 ts 已被账本标注过 → 不重复标注
  # （同一软失败事件只对第一个提交生效；后续提交即使落在窗口内也恢复纯 PASS）
  if grep -qF "soft-fail allowed ts=${ts}" "$ROOT/.claude/bypass.log" 2>/dev/null; then return 0; fi
  printf 'DEGRADED-PASS (soft-fail allowed ts=%s %s)' "$ts" "$ex"
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

        # ═══ D521/不变量2: COMMITTED 登记（hook 层——commit 后立即成对登记，树永干净）═══
        # 病根（D537 #4 恢复）: D508 登记只在 synova-commit 路径且在 commit 后追加 →
        #   bypass.log 永脏 → 挡 merge → 逼裸 git → 对账失败 → D451 补记循环（D520 复盘病根 2）。
        #   该段在 D530（734ab32e CT-45 merge 豁免）重写 post-commit.sh 时被覆盖丢失——
        #   post-commit.test.sh 红态（登记段缺失/HASH 未登记/仍脏/影子提交缺失）。
        # 解法: 任何 commit（裸 git / synova-commit）过检后，hook 立即把本提交 HASH 的
        #   COMMITTED 行追加 + 成对登记提交（marker message 防递归）——bypass.log 永不脏。
        # 只在 PASS_WAY≠0（pre-commit 真跑过）时登记；--no-verify 提交不登记（不洗白绕过）。
        LAST_MSG=$(git log -1 --format=%s 2>/dev/null || true)
        case "$LAST_MSG" in
          *"bypass COMMITTED 登记"*) : ;;  # 登记提交自身 → 跳过（防递归）
          *)
            HASH_NOW=$(git rev-parse HEAD 2>/dev/null || true)
            if [ -n "$HASH_NOW" ]; then
              # CT-2: 软失败被放行 ⇒ 记真实状态；正常路径行文本一字不动（既有硬断言保持绿）
              _COMMITTED_STATE="pre-commit PASS (hook 层登记)"
              _SOFT_STATE="$(_softfail_state)"
              [ -n "$_SOFT_STATE" ] && _COMMITTED_STATE="pre-commit ${_SOFT_STATE}"
              echo "$(date -Iseconds) | COMMITTED | ${_COMMITTED_STATE} | HASH=$HASH_NOW" | _bypass_append
              # CT-43（D554）: `-o -m ... -- <path>` 限定登记提交只含 bypass.log——不卷走暂存区遗留文件
              # （D552 实证: D311 guard 阻断后遗留 staged 文件被本提交整体卷入 8b6deaf4，M8 变体；
              #   注意 -m 必须在 -- 之前，否则被当 pathspec）
              if git add "$ROOT/.claude/bypass.log" 2>/dev/null && git commit --no-verify -q -o -m "chore: bypass COMMITTED 登记 (auto hook, D521)" -- "$ROOT/.claude/bypass.log" 2>/dev/null; then
                :  # 登记提交完成——bypass.log 保持干净
              else
                echo "  ⚠️  post-commit: bypass 登记提交失败（identity 未配置?）— 降级，对账时按 D451 补记" >&2
              fi
            fi
            ;;
        esac
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
