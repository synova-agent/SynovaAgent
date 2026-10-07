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
#
# 契约（铁律 47）
#   用法: sealed-tests.sh <--scan|--quarantine|--list|--face-total> [--root <仓库根>]
#   输入:
#     --root <dir>        仓库根（默认 = 本脚本上两级）
#     环境 SYNO_GATE_BASELINE  隔离台账路径（默认 <root>/scripts/control-tower/gate-integrity-baseline.txt）
#   输出（stdout，每行一条相对路径 / 或一个整数）:
#     --scan        发现面内**全部**密封面测试（未减隔离台账）
#     --quarantine  隔离台账条目（REGISTRY-BASELINE 段的数据行）
#     --list        执行集 = --scan − --quarantine（ci.yml 两个 job 消费这个）
#     --face-total  台账登记的发现面总数**下界**（缺省 0）
#   退出码（三态，控制塔模式 1）:
#     0 = 正常
#     1 = 违规（发现面扫描为空 / 隔离条目指向不存在的文件 / 发现面实况低于台账下界 = 疑似删测试）
#     2 = 降级（仓库根不可读 / 台账不可读）—— fail-closed，**绝不返回空清单当"没测试要跑"**
#   降级可见性: 违规/降级一律向 stderr 打 `SEALED-TESTS: <原因>`，调用方据此判红/全量。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SELF_DIR/../.." && pwd)"
MODE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scan|--quarantine|--list|--face-total|--slack|--slack-cap) MODE="${1#--}" ;;
    --root) shift; [ $# -gt 0 ] || { echo "SEALED-TESTS: --root 缺参数" >&2; exit 2; }; ROOT="$1" ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "SEALED-TESTS: 未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$MODE" ] || { echo "SEALED-TESTS: 必须指定 --scan/--quarantine/--list/--face-total" >&2; exit 2; }

BASELINE="${SYNO_GATE_BASELINE:-$ROOT/scripts/control-tower/gate-integrity-baseline.txt}"

# ── 发现面（唯一声明处；改面 = 只改这里）────────────────────────────────────
#   面 = 「本仓已决定在 CI 密封面执行」的目录；面内新增测试零登记自动纳入。
SEALED_FACES="tests/control-tower tests/doc-system"

[ -d "$ROOT/tests" ] || { echo "SEALED-TESTS: 仓库根无 tests/ 目录: $ROOT" >&2; exit 2; }
[ -f "$BASELINE" ] || { echo "SEALED-TESTS: 隔离台账不可读: $BASELINE" >&2; exit 2; }

scan_face() {   # 发现面内全部密封面测试（相对路径，排序去重）
  local d f
  for d in $SEALED_FACES; do
    [ -d "$ROOT/$d" ] || continue
    for f in "$ROOT/$d"/*.test.sh "$ROOT/$d"/*.test.py; do
      [ -f "$f" ] || continue
      printf '%s\n' "${f#"$ROOT"/}"
    done
  done | sort -u
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
  local ref="$1"
  [ -n "$ref" ] || return 1
  git -C "$ROOT" rev-parse -q --verify "${ref}^{commit}" >/dev/null 2>&1 || return 1
  git -C "$ROOT" ls-tree -r --name-only "$ref" 2>/dev/null \
    | grep -E '^tests/(control-tower|doc-system)/.*\.test\.(sh|py)$' | wc -l | tr -d ' \r'
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
SCAN_N=$(printf '%s\n' "$SCAN" | grep -c . || true)
QUAR="$(quarantine)"
QUAR_N=$(printf '%s\n' "$QUAR" | grep -c . || true)

case "$MODE" in
  scan) printf '%s\n' "$SCAN" | grep . || true ;;
  quarantine) printf '%s\n' "$QUAR" | grep . || true ;;
  face-total) FT="$(face_total)"; [ -n "$FT" ] || FT=0; printf '%s\n' "$FT" ;;
  slack) FT="$(face_total)"; [ -n "$FT" ] || FT=0; printf '%s\n' "$((SCAN_N - FT))" ;;
  slack-cap) SC="$(slack_cap)"; [ -n "$SC" ] || SC=0; printf '%s\n' "$SC" ;;
  list)
    LIST="$(comm -23 <(printf '%s\n' "$SCAN" | grep . | sort -u) <(printf '%s\n' "$QUAR" | grep . | sort -u))"
    LIST_N=$(printf '%s\n' "$LIST" | grep -c . || true)
    FLOOR="$(face_total)"
    # 发现面为空 ⇒ 违规（配置错误：面声明失效会让"全绿"变成"什么都没跑"）
    if [ "$SCAN_N" -eq 0 ]; then
      echo "SEALED-TESTS: 发现面扫描为空（面=$SEALED_FACES root=$ROOT）—— fail-closed，绝不当作「无测试」处理" >&2
      VIOL=1
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
