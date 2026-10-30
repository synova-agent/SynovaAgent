#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# sealed-tests.sh — 密封面「发现制」清单提供者（D-F/② · 卡 #1227 · 父卡 #1221）
#
# 病根（登记制）: 密封面测试（tests/**/*.test.sh|py）此前必须**逐条**出现在
#   `.github/workflows/ci.yml` 全文里才算"被 CI 执行"——新增测试零登记 = 永不执行
#   （D526 定罪形态），且同一份 65 条清单在 ci.yml 内被复制两份（ubuntu 腿 + windows 顾问腿），
#   "改一处漏一处"即两条腿跑不同集合而无人可见。
#
# 发现制（本脚本 = 唯一清单权威）:
#   · 发现面（FACES）在**本脚本内**声明一次；ci.yml 两个 job 与
#     `scripts/control-tower/check-gate-integrity.sh` B 段全部向本脚本取数 ⇒ 零副本。
#   · 执行集 = 发现面扫描集 − 隔离台账（`gate-integrity-baseline.txt` 的 REGISTRY-BASELINE 段）。
#     新增测试**零登记即自动纳入执行集**；要把它排除，必须显式写进隔离台账（留痕 + 棘轮）。
#   · W0 扩面（#1210）: 发现面 ＋ `.test.ts` 纳入**发现**（含 `.integration.test.ts` /
#     `.e2e.test.ts`，glob 自然覆盖）；`.ts` **不进 `--list`（CI bash 执行集）** ——
#     CI 执行器按扩展名分派（*.py → python，其余 → bash），.ts 混入必红；`.ts` 的
#     runner = vitest，由 `--list-ts` 单列（待 W6 接线）。
#
# 契约（铁律 47）
#   用法: sealed-tests.sh <--scan|--quarantine|--list|--list-ts|--face-total|--slack|--slack-cap>
#             [--root <仓库根>]
#   输入:
#     --root <dir>        仓库根（默认 = 本脚本上两级）
#     环境 SYNO_GATE_BASELINE  隔离台账路径（默认 <root>/scripts/control-tower/gate-integrity-baseline.txt）
#     环境 SYNO_VITEST_BIN      vitest 可执行文件（默认 <root>/node_modules/.bin/vitest）
#   输出（stdout，每行一条相对路径 / 一个整数 / 一条逐面统计行）:
#     --scan        发现面内**全部**密封面测试（三扩展名 .sh/.py/.ts；未减隔离台账）
#     --quarantine  隔离台账条目（REGISTRY-BASELINE 段的数据行）
#     --list        执行集 =（--scan 中 .sh/.py）− --quarantine（ci.yml 两腿消费；**不含 .ts**）
#     --list-ts     --scan 中的 `.ts` 项（stderr 声明 runner=vitest；缺 runner ⇒ exit 2）
#     --face-total  逐面一行 `face=<dir> count=<n> runner=<bash|python|vitest|mixed|none>`
#                   （计数**含** .ts；某面 count=0 ⇒ exit 1；面目录不存在 ⇒ exit 2）
#     --slack       余量 = 执行集口径扫描数 − FACE-TOTAL 下界（单整数，向后兼容）
#     --slack-cap   余量上限（单整数）
#   退出码（三态，控制塔模式 1）:
#     0 = 正常
#     1 = 违规（发现面扫描为空 / 隔离条目指向不存在的文件 / 执行集实况低于台账下界 = 疑似删测试 /
#         某发现面 count=0 = 恒 0 发现）
#     2 = 降级（仓库根不可读 / 台账不可读 / 面目录不存在 / 发现 0 个 .ts / 无 vitest runner /
#         未指定模式）—— fail-closed，**绝不返回空清单当"没测试要跑"**
#   降级可见性: 违规/降级一律向 stderr 打 `SEALED-TESTS: <原因>`；降级另打
#     `degraded: <CODE> — <原因>` 并追加 JSON 到 SYNO_GATE_DEGRADED_LOG（D2 同形）。
#
# 棘轮口径（#1210 明示，勿读成"棘轮已覆盖 .ts"）:
#   `# FACE-TOTAL=` 下界与 `--slack` 仍按**执行集口径（.sh/.py）**计数 —— 台账 204 的语义是
#   「CI 真正会跑的密封面测试数」；`.ts` 尚无 CI runner ⇒ 计入会把余量从 8 抬到 35 并撞
#   SLACK-CAP=10（假红），且台账不在本卡写集内。`.ts` 的可见性由 `--face-total` 逐面行与
#   `--list` 的 stderr 提示承担。`scan_face_at` 同此口径（base 对比必须与棘轮同尺度）。
#
# 已知限制（做不到什么 —— 禁读成"已检测"）:
#   1. **.ts 尚无 CI 执行**：`--list-ts` 只**列出**并声明 runner=vitest；本仓工作树无 node_modules
#      时恒 exit 2。真正跑 vitest 的接线（W6/后续卡）不在本件。
#   2. **FACE-TOTAL 不覆盖 .ts**（见上「棘轮口径」）：.ts 被删不会被棘轮判红，只在
#      `--face-total` 的 count 变化里可见；vitest 进 CI 后须同批上调台账再改口径。
#   3. **`--face-total` 输出形状已变（#1210）**：不再是单个整数。消费方若把它当整数用
#      （如 `check-gate-integrity.sh` 展示行的 `floor_n`）会出现多行文本 —— 只影响显示，
#      不影响该器退出码；整数下界仍可由 `--slack`（= 执行集扫描数 − floor）反推。
#   4. **面目录缺失即 exit 2**：`SEALED_FACES` 三项都必须实存（删目录 = 配置错误，不是"没有测试"）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SELF_DIR/../.." && pwd)"
MODE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scan|--quarantine|--list|--list-ts|--face-total|--slack|--slack-cap) MODE="${1#--}" ;;
    --root) shift; [ $# -gt 0 ] || { echo "SEALED-TESTS: --root 缺参数" >&2; exit 2; }; ROOT="$1" ;;
    -h|--help)
      # 头注释即用法文档（单源：改契约只改头部，不留第二份会漂移的用法文本）。
      # 动态取界（原 `sed -n '2,30p'` 写死行号：头部一加行就截掉契约末尾 ⇒ 文档失真）。
      awk 'NR > 2 { if ($0 ~ /^# ═/) exit; print }' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "SEALED-TESTS: 未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$MODE" ] || { echo "SEALED-TESTS: 必须指定 --scan/--quarantine/--list/--list-ts/--face-total" >&2; exit 2; }

BASELINE="${SYNO_GATE_BASELINE:-$ROOT/scripts/control-tower/gate-integrity-baseline.txt}"
DEG_LOG="${SYNO_GATE_DEGRADED_LOG:-$ROOT/.codex/control-tower/logs/degraded-events.log}"

# ── 发现面（唯一声明处；改面 = 只改这里）────────────────────────────────────
#   面 = 「本仓已决定在密封面执行」的目录；面内新增测试零登记自动纳入。
#   W0（#1210）扩为三面：tests/security 是 .ts-only 面（用于「删 .ts 支持 ⇒ 该面归零」两态）。
SEALED_FACES="tests/control-tower tests/doc-system tests/security"

# 降级出口（D2：stderr 一行 ＋ JSON 追加 ＋ exit 2；禁静默 0）
degrade() { # $1=code $2=phase $3=原因
  printf 'degraded: %s — %s\n' "$1" "$3" >&2
  mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null || true
  printf '{"time":"%s","component":"sealed-tests","code":"%s","phase":"%s","retryable":false}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$DEG_LOG" 2>/dev/null || true
  exit 2
}

[ -d "$ROOT/tests" ] || { echo "SEALED-TESTS: 仓库根无 tests/ 目录: $ROOT" >&2; exit 2; }
[ -f "$BASELINE" ] || { echo "SEALED-TESTS: 隔离台账不可读: $BASELINE" >&2; exit 2; }

scan_face_one() {   # $1=<面目录，相对仓库根> → 该面全部密封面测试（相对路径）
  local d="$1" f pat
  [ -d "$ROOT/$d" ] || return 0
  # 🔴 扩展名唯一声明处（W0/#1210）: 新增扩展名只改这一行；两态夹具通过替换本行
  #    模拟「删 .test.ts 支持」⇒ tests/security 面归零 ⇒ --face-total exit 1。
  #    `.integration.test.ts` / `.e2e.test.ts` 由 `*.test.ts` glob 自然覆盖。
  SEALED_EXTS="*.test.sh *.test.py *.test.ts"
  for pat in $SEALED_EXTS; do
    for f in "$ROOT/$d"/$pat; do
      [ -f "$f" ] || continue
      printf '%s\n' "${f#"$ROOT"/}"
    done
  done
}

scan_face() {   # 发现面内全部密封面测试（含 .test.ts；相对路径，排序去重）
  local d
  for d in $SEALED_FACES; do
    scan_face_one "$d"
  done | sort -u
}

face_counts() {  # $1=<面目录> → "sh py ts" 三扩展名计数（由 scan_face_one 单源派生）
  local d="$1" f sh_n=0 py_n=0 ts_n=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      *.test.ts) ts_n=$((ts_n+1)) ;;
      *.test.py) py_n=$((py_n+1)) ;;
      *.test.sh) sh_n=$((sh_n+1)) ;;
    esac
  done <<< "$(scan_face_one "$d")"
  printf '%s %s %s' "$sh_n" "$py_n" "$ts_n"
}

face_runner() {  # $1=sh $2=py $3=ts → bash|python|vitest|mixed|none（该面需要哪些 runner）
  local kinds=0
  [ "$1" -gt 0 ] && kinds=$((kinds+1))
  [ "$2" -gt 0 ] && kinds=$((kinds+1))
  [ "$3" -gt 0 ] && kinds=$((kinds+1))
  if [ "$kinds" -eq 0 ]; then printf 'none'
  elif [ "$kinds" -gt 1 ]; then printf 'mixed'
  elif [ "$1" -gt 0 ]; then printf 'bash'
  elif [ "$2" -gt 0 ]; then printf 'python'
  else printf 'vitest'; fi
}

quarantine() {  # 隔离台账 = REGISTRY-BASELINE 段的数据行（跳过注释/空行）
  awk '
    BEGIN { sec = "R" }
    /^[[:space:]]*#/ {
      line = $0
      sub(/^[[:space:]]*#[[:space:]]*/, "", line)
      if (line ~ /^═+[[:space:]]*PATTERN-BASELINE/)  { sec = "P"; next }
      if (line ~ /^═+[[:space:]]*REGISTRY-BASELINE/) { sec = "R"; next }
      next
    }
    /^[[:space:]]*$/ { next }
    sec == "R" { print }
  ' "$BASELINE" 2>/dev/null | tr -d '\r' | sed 's/[[:space:]]*$//' | sort -u   # swallow-ok: 台账不可读已在上游 -f 校验；无行=空隔离集（不静默放行，见下双棘轮判定）
}

face_total() {  # 台账登记的发现面总数下界（`# FACE-TOTAL=<n>`，缺省 0 = 不设下界）
  awk '
    /^[[:space:]]*#[[:space:]]*FACE-TOTAL=/ {
      line = $0
      sub(/^[[:space:]]*#[[:space:]]*FACE-TOTAL=/, "", line)
      if (match(line, /[0-9]+/)) { seen = 1; n = substr(line, RSTART, RLENGTH) + 0; if (n > best) best = n }
    }
    END { if (seen) printf "%d", best; else printf "" }
  ' "$BASELINE" 2>/dev/null | tr -d '[:space:]'   # swallow-ok: 台账不可读已在上游 -f 校验；空=未设下界（不设即不判）
}

_days_since() {   # $1=<YYYY-MM-DD> → 距今天数（BSD `date -j -f` / GNU `date -d` 双形态；都不可用 ⇒ 打印 -1）
  local d="$1" then_s="" now_s=""
  now_s="$(date -u +%s 2>/dev/null || echo "")"
  then_s="$(date -u -j -f "%Y-%m-%d" "$d" +%s 2>/dev/null || true)"      # swallow-ok: BSD 形态；失败走 GNU 形态
  [ -n "$then_s" ] || then_s="$(date -u -d "$d" +%s 2>/dev/null || echo "")"   # swallow-ok: GNU 形态；失败交下一行显式报 -1
  if [ -z "$then_s" ] || [ -z "$now_s" ]; then printf '%s' "-1"; return 0; fi
  printf '%s' "$(( (now_s - then_s) / 86400 ))"
}

scan_face_at() {   # $1=<git ref>；在**同一树尺度**下数发现面内测试（不 checkout ⇒ 与工作树测量同口径）
  #   #1227/D1227（卡 #1300）: 「越线者付账」判据要求 scan(base) 与 scan(PR) **同一次运行内测量**——
  #   跨运行比较会假红（实测: CI 面 152 vs 本地 150）。此处纯 tree 计数 ⇒ 与 scan_face 同尺度。
  #   🔴 #1210 口径明示: 只计**执行集口径（.sh/.py）**，与 `--slack`/`# FACE-TOTAL=` 同尺度；
  #     若把 .ts 计入而棘轮仍按 .sh/.py（台账不在本卡写集，无法同步上调），base 侧会被放大
  #     ⇒ 越线判定被永久洗成「纯继承」（假绿）。故**不**扩 .ts（见头部「棘轮口径」）。
  local ref="$1"
  [ -n "$ref" ] || return 1
  git -C "$ROOT" rev-parse -q --verify "${ref}^{commit}" >/dev/null 2>&1 || return 1
  git -C "$ROOT" ls-tree -r --name-only "$ref" 2>/dev/null \
    | grep -E '^tests/(control-tower|doc-system|security)/.*\.test\.(sh|py)$' | wc -l | tr -d ' \r'
}

inherited_since() {   # 台账单行载体 `# INHERITED-OVER-CAP-SINCE=<YYYY-MM-DD>`（缺省空 = 未登记继承态）
  awk '
    /^[[:space:]]*#[[:space:]]*INHERITED-OVER-CAP-SINCE=/ {
      line = $0
      sub(/^[[:space:]]*#[[:space:]]*INHERITED-OVER-CAP-SINCE=/, "", line)
      if (match(line, /[0-9]{4}-[0-9]{2}-[0-9]{2}/)) { seen = 1; v = substr(line, RSTART, RLENGTH) }
    }
    END { if (seen) printf "%s", v; else printf "" }
  ' "$BASELINE" 2>/dev/null | tr -d '[:space:]'   # swallow-ok: 台账不可读已在上游 -f 校验；空=未登记
}

slack_cap() {   # 余量上限（`# SLACK-CAP=<n>`，缺省空 = 不设上限）——#1227 跟进件（Lead 裁 N=10）
  awk '
    /^[[:space:]]*#[[:space:]]*SLACK-CAP=/ {
      line = $0
      sub(/^[[:space:]]*#[[:space:]]*SLACK-CAP=/, "", line)
      if (match(line, /[0-9]+/)) { seen = 1; n = substr(line, RSTART, RLENGTH) + 0; if (n > best) best = n }
    }
    END { if (seen) printf "%d", best; else printf "" }
  ' "$BASELINE" 2>/dev/null | tr -d '[:space:]'
}

quarantine_total() {  # 隔离条目数上界（`# QUARANTINE-TOTAL=<n>`，缺省 0 = 不设上界）
  awk '
    /^[[:space:]]*#[[:space:]]*QUARANTINE-TOTAL=/ {
      line = $0
      sub(/^[[:space:]]*#[[:space:]]*QUARANTINE-TOTAL=/, "", line)
      if (match(line, /[0-9]+/)) { seen = 1; n = substr(line, RSTART, RLENGTH) + 0; if (n > best) best = n }
    }
    END { if (seen) printf "%d", best; else printf "" }
  ' "$BASELINE" 2>/dev/null | tr -d '[:space:]'   # swallow-ok: 同上；空=未设上界（不设即不判）
}

VIOL=0
SCAN="$(scan_face)"
ALL_N=$(printf '%s\n' "$SCAN" | grep -c . || true)                      # 发现面口径（含 .ts）
SCAN_EXEC="$(printf '%s\n' "$SCAN" | grep -E '\.test\.(sh|py)$' | grep . || true)"
SCAN_N=$(printf '%s\n' "$SCAN_EXEC" | grep -c . || true)                # 执行集口径（.sh/.py；棘轮/--slack 用）
TS_N=$(printf '%s\n' "$SCAN" | grep -cE '\.test\.ts$' || true)           # 发现到但 CI 未接线的 .ts 数
QUAR="$(quarantine)"
QUAR_N=$(printf '%s\n' "$QUAR" | grep -c . || true)

case "$MODE" in
  scan) printf '%s\n' "$SCAN" | grep . || true ;;
  quarantine) printf '%s\n' "$QUAR" | grep . || true ;;
  face-total)
    # W0（#1210）: 逐面一行，计数**含 .ts**；某面 0 ⇒ exit 1（禁恒 0 发现）；面目录缺失 ⇒ exit 2
    FACE_MISSING=0; FACE_ZERO=0
    for _d in $SEALED_FACES; do
      if [ ! -d "$ROOT/$_d" ]; then
        echo "SEALED-TESTS: 发现面目录不存在: $_d —— 信号量==0，判不了（exit 2）" >&2
        FACE_MISSING=1
        continue
      fi
      read -r _sh _py _ts <<< "$(face_counts "$_d")"
      _n=$((_sh + _py + _ts))
      printf 'face=%s count=%s runner=%s\n' "$_d" "$_n" "$(face_runner "$_sh" "$_py" "$_ts")"
      if [ "$_n" -eq 0 ]; then
        echo "SEALED-TESTS: 发现面 $_d 计数为 0 —— 禁恒 0 发现（exit 1；先核面声明与 glob 扩展名）" >&2
        FACE_ZERO=1
      fi
    done
    [ "$FACE_MISSING" -eq 0 ] || exit 2
    [ "$FACE_ZERO" -eq 0 ] || exit 1
    ;;
  slack) FT="$(face_total)"; [ -n "$FT" ] || FT=0; printf '%s\n' "$((SCAN_N - FT))" ;;
  slack-cap) SC="$(slack_cap)"; [ -n "$SC" ] || SC=0; printf '%s\n' "$SC" ;;
  list-ts)
    # W0（#1210）: .ts 项单列（runner=vitest）；缺 runner 或 0 发现 ⇒ exit 2（判不了 ≠ 通过）
    printf 'runner=vitest\n' >&2
    TS_LIST="$(printf '%s\n' "$SCAN" | grep -E '\.test\.ts$' | grep . || true)"
    TS_LIST_N=$(printf '%s\n' "$TS_LIST" | grep -c . || true)
    if [ "$TS_LIST_N" -eq 0 ]; then
      degrade E_NO_TS runner "--list-ts 发现 0 个 .test.ts（面=$SEALED_FACES）—— 禁静默 0 发现（exit 2）"
    fi
    RUNNER="${SYNO_VITEST_BIN:-$ROOT/node_modules/.bin/vitest}"
    if [ ! -x "$RUNNER" ]; then
      degrade E_NO_RUNNER runner "runner 不可执行: $RUNNER（判不了 ≠ 通过；可用 SYNO_VITEST_BIN 指定 vitest）"
    fi
    printf '%s\n' "$TS_LIST"
    ;;
  list)
    LIST="$(comm -23 <(printf '%s\n' "$SCAN_EXEC" | grep . | sort -u) <(printf '%s\n' "$QUAR" | grep . | sort -u))"
    LIST_N=$(printf '%s\n' "$LIST" | grep -c . || true)
    FLOOR="$(face_total)"
    # 发现面为空 ⇒ 违规（配置错误：面声明失效会让"全绿"变成"什么都没跑"）
    if [ "$ALL_N" -eq 0 ]; then
      echo "SEALED-TESTS: 发现面扫描为空（面=$SEALED_FACES root=$ROOT）—— fail-closed，绝不当作「无测试」处理" >&2
      VIOL=1
    elif [ "$SCAN_N" -eq 0 ]; then
      # 发现到 .ts 但无 .sh/.py ⇒ bash 执行集为空：可见但不判违规（合法 ts-only 面），禁静默
      echo "SEALED-TESTS: 执行集口径为 0（发现面只有 .ts，共 ${TS_N} 个）—— CI bash 执行集为空；runner=vitest 待接线" >&2
    fi
    # .ts 存在时给可见提示（不进 bash 执行集；不静默，也不改 workflow 行为）
    if [ "$TS_N" -gt 0 ]; then
      echo "SEALED-TESTS: 发现 ${TS_N} 个 .test.ts 未进 bash 执行集（runner=vitest 待接线；用 --list-ts 查看）" >&2
    fi
    # 发现面实况 < 台账下界 ⇒ 疑似删测试（必须同批显式下调 FACE-TOTAL）
    if [ -n "$FLOOR" ] && [ "$SCAN_N" -lt "$FLOOR" ]; then
      echo "SEALED-TESTS: 发现面 ${SCAN_N} < 台账下界 ${FLOOR} —— 删测试必须同批显式下调 # FACE-TOTAL（不得静默缩小执行集）" >&2
      VIOL=1
    fi
    # 🔴 #1227 跟进件（Lead 裁 2026-10-07）: 动态打印**余量** slack = scan − FACE-TOTAL
    #   = 「可被静默删除而仍判绿的测试数」（下界语义的必然代价面），并对其设**上限**：
    #   余量 > SLACK-CAP ⇒ 红（逼周期性**显式上调 floor**——一行、低频，不进每 PR 的中央写集）。
    #   禁止自动上调（那会让棘轮失效）；上调必须是显式提交 + 理由。
    if [ -n "$FLOOR" ]; then
      SLACK=$((SCAN_N - FLOOR))
      echo "SEALED-TESTS: 余量 slack=${SLACK}（scan=${SCAN_N} − FACE-TOTAL=${FLOOR}）—— **≤ 该余量的净删除不可检测**（已知代价，见契约）" >&2
      CAP="$(slack_cap)"
      if [ -n "$CAP" ] && [ "$SLACK" -gt "$CAP" ]; then
        # 🔴 D1227（卡 #1300，Lead 2026-10-07 改版）**越线者付账**:
        #   slack_before ≤ CAP ∧ slack_after > CAP ⇒ **红**（本 PR 让余量越线 = 增长的唯一来源）
        #   否则 slack_after > CAP ⇒ **warning**（纯继承态；登记载体 `# INHERITED-OVER-CAP-SINCE=`）
        #   —— 旧口径（纯继承也红）会让**一张无关 PR 承担全批解阻塞**，合并序被棘轮绑架（本轮实测三张同冲突）。
        BASE_REF_SEAM="${SYNO_BASE_REF:-}"
        if [ -z "$BASE_REF_SEAM" ]; then
          # 禁静默：未给 base ⇒ 不判越线（退化现状语义），但**显式打印**
          echo "SEALED-TESTS: 未给 base（SYNO_BASE_REF 空）⇒ 不判『越线』，按现状语义处理（余量 > 上限即红）" >&2
          echo "SEALED-TESTS: 余量 ${SLACK} > 上限 SLACK-CAP=${CAP} —— 请显式上调 # FACE-TOTAL；禁止自动上调（会使棘轮失效）" >&2
          VIOL=1
        else
          BASE_N="$(scan_face_at "$BASE_REF_SEAM" 2>/dev/null || echo "")"
          if [ -z "$BASE_N" ]; then
            echo "SEALED-TESTS: base ref 不可解析（SYNO_BASE_REF=${BASE_REF_SEAM}）⇒ 不判『越线』；按现状语义处理（禁静默降级）" >&2
            echo "SEALED-TESTS: 余量 ${SLACK} > 上限 SLACK-CAP=${CAP} —— 请显式上调 # FACE-TOTAL" >&2
            VIOL=1
          else
            SLACK_BEFORE=$((BASE_N - FLOOR))
            echo "SEALED-TESTS: 越线判定 base=${BASE_REF_SEAM} base_scan=${BASE_N} base_slack=${SLACK_BEFORE} ／ pr_scan=${SCAN_N} pr_slack=${SLACK}（同一运行内测量）" >&2
            if [ "$SLACK_BEFORE" -le "$CAP" ]; then
              echo "SEALED-TESTS: 余量 ${SLACK} > 上限 SLACK-CAP=${CAP} 且 **本 PR 使余量越线**（base_slack=${SLACK_BEFORE} ≤ ${CAP}）—— 请显式上调 # FACE-TOTAL（一行、低频）；禁止自动上调（会使棘轮失效）" >&2
              VIOL=1
            else
              # 纯继承态: warning + 载体；载体缺失 ⇒ 打印可粘贴行；载体超期 ⇒ 升级为红（N=14 天，Lead 裁）
              SINCE="$(inherited_since)"
              if [ -z "$SINCE" ]; then
                echo "::warning title=sealed-ratchet::继承 over-cap main（base_slack=${SLACK_BEFORE} > SLACK-CAP=${CAP}，本 PR 未越线）—— 请补登记行: # INHERITED-OVER-CAP-SINCE=$(date -u +%Y-%m-%d)（可直接粘贴到台账）" >&2
                echo "SEALED-TESTS: 继承态未登记载体 ⇒ 打印可粘贴行（**不自动写台账**，防削弱棘轮）: # INHERITED-OVER-CAP-SINCE=$(date -u +%Y-%m-%d)" >&2
              else
                _age_days="$(_days_since "$SINCE")"
                echo "::warning title=sealed-ratchet::继承 over-cap main 已登记（since=${SINCE}，本 PR 未越线）—— 余量继续增长将升级为红" >&2
                echo "SEALED-TESTS: 继承态登记 since=${SINCE}（年龄以天计，升级阈值 INHERITED-OVER-CAP-DAYS=${INHERITED_CAP_DAYS}）" >&2
                if [ "$_age_days" = "-1" ]; then
                  echo "SEALED-TESTS: 继承态年龄不可计算（date 形态不支持）⇒ 不升级为红；登记 since=${SINCE} 须人工核" >&2
                elif [ "$_age_days" -gt "${INHERITED_CAP_DAYS:-14}" ]; then
                  echo "SEALED-TESTS: 继承态已超期 ${_age_days} 天 > ${INHERITED_CAP_DAYS:-14} 天 ⇒ **升级为红**（请显式上调 # FACE-TOTAL 并删除该登记行）" >&2
                  VIOL=1
                fi
              fi
            fi
          fi
        fi
      fi
    fi
    # 隔离台账条目必须仍存在（条目失效 = 台账撒谎）
    while IFS= read -r q; do
      [ -n "$q" ] || continue
      [ -f "$ROOT/$q" ] || { echo "SEALED-TESTS: 隔离台账条目指向不存在的文件: $q —— 须删条目" >&2; VIOL=1; }
    done <<< "$QUAR"
    # 隔离条目数 > 台账上界 ⇒ 新增隔离未留痕（必须同批显式上调 QUARANTINE-TOTAL）
    CEILING="$(quarantine_total)"
    if [ -n "$CEILING" ] && [ "$QUAR_N" -gt "$CEILING" ]; then
      echo "SEALED-TESTS: 隔离条目 ${QUAR_N} > 台账上界 ${CEILING} —— 新增隔离必须同批显式上调 # QUARANTINE-TOTAL（不得静默排除测试）" >&2
      VIOL=1
    fi
    printf '%s\n' "$LIST" | grep . || true
    [ "$VIOL" -eq 0 ] || exit 1
    ;;
esac
exit 0
