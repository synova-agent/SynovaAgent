#!/usr/bin/env bash
# D313/D520 UTF-8 强制（PLATFORM-CHECKLIST 第 4 条）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# dispatch-gate.sh — dispatch 闸（D1163，CTO 2026-10-06 派单「闸 2」）
#
# 目的: CTO 发任何指令前，强制先跑引用核验（替代"我记得要核"）。
# 载体: DSH hooks 桥（@deepseek-ai/dsh-hooks-claude-code）PreToolUse 事件。
# 判据: **只查今天真实错过的四类**（CTO 明令：不许再加更多，防膨胀）——
#   ① 指令里引的仓库内路径是否存在（origin/main 或工作区；不存在须同行标「新建」）
#   ② 引的外部件是否有五元组（断面/形态/版本/坐标/时刻）
#   ③ 指令是否单流（一条指令只许一个前缀；证据/回执段与代码块、引号内不计）
#   ④ 指令点名的分支/PR 的真伪（声称"已合/在飞"与 origin/main 事实不符即违规）
#
# 契约（铁律 47）:
#   @input  — 三选一：
#             --hook            stdin = Claude Code 事件 JSON（PreToolUse）
#             --file <path>     指令文本来自文件
#             （缺省）           stdin = 纯文本
#   @output — 逐条违规点名到 stderr（检查号 + 坐标 + 事实 + 修法）
#   @exit   — 三态（ctrl-tower-change 模式 1）:
#             0 = 四类全过（或文本不是"指令形态"⇒ 不适用）
#             1 = 违规（至少一类不过）
#             2 = 检查自身失败（payload 不可解析 / 无 git 仓库 / origin/main 不可解析）
#   @hook 映射（宿主方言: 只有 exit 2 才阻断）:
#             通过 → 0 ｜ 违规 → 2（stderr = 违规清单）｜ 自身失败 → 2（前缀 GATE-ERROR）
#             advise 模式（SYNO_GATE_MODE=advise）→ 违规降为 0 + 前缀 ADVISORY
#   @degraded — 无 python3（hook 模式）/ 无 git / origin/main 不可解析 ⇒ GATE-ERROR + exit 2
#             （fail-closed: 判据不可判定 ⇒ 不派单。安装前置校验见 install 脚本）
#   @seam   — SYNO_GATE_MODE / SYNO_GATE_LOG_DIR / SYNO_GATE_PREFIXES（流前缀词表路径）
#             / SYNO_GATE_URL_ALLOW（放行主机前缀，逗号分隔）
#   @side   — 只读；只在 SYNO_GATE_LOG_DIR 追加一行 jsonl
#
# 判据来源: CTO 派单 §2（四类）。本卡细化的三处（判据件 D1163 §3 明写，可被 CTO 覆盖）:
#   ① 触发面 = "指令形态"（含 D#/#PR 任务号 或 派单/写集/红线/Done 等指令词），
#      常规对话与状态汇报不触发 —— 防误拦（误拦 = 指令发不出去，代价最大）
#   ② ④ 的判定对象是"**声称**"：声称已合 → 必须在 origin/main；声称在飞 → 必须不在；
#      只提及不声称 ⇒ 打印事实行、不阻断（严格按字面"点名即在 main"会拦掉一切在飞引用，
#      而派单正文引用在飞 PR 是常态 —— 见判据件 §3.4 的代价说明）
#   ③ ① 的「新建」豁免锚在**同一行**（路径与该标注同行才算声明）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK=0
FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --hook) HOOK=1; shift ;;
    --file) FILE="${2:-}"; shift 2 ;;
    -h|--help) echo "用法: $0 [--hook|--file <path>]  （缺省: stdin 纯文本）"; exit 0 ;;
    *) echo "❌ 未知参数: $1" >&2; exit 2 ;;
  esac
done

GATE_MODE="${SYNO_GATE_MODE:-enforce}"
TMPD="$(mktemp -d)" || { echo "GATE-ERROR: mktemp 失败" >&2; exit 2; }
trap 'rm -rf "$TMPD"' EXIT
TXT="$TMPD/text"; : > "$TXT"
TOOL="(cli)"

# ── 输入收集 ──────────────────────────────────────────────────
if [ "$HOOK" -eq 1 ]; then
  cat > "$TMPD/payload.json" || { echo "GATE-ERROR: payload 读取失败" >&2; exit 2; }
  PYBIN=""
  for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
    command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
  done
  if [ -z "$PYBIN" ]; then
    echo "GATE-ERROR: 无可用 python（PYBIN 三级探测 python3/python/py 全不可用）→ 无法解析 hook payload（fail-closed）" >&2
    exit 2
  fi
  if ! "$PYBIN" - "$TMPD/payload.json" "$TXT" "$TMPD/tool" <<'PY' 2>"$TMPD/py.err"
import json, re, sys
src, dst, dst_tool = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    payload = json.loads(open(src, encoding="utf-8", errors="replace").read())
except Exception as exc:                      # noqa: BLE001 - 显式降级
    sys.stderr.write("json 解析失败: %s\n" % exc); sys.exit(3)
if not isinstance(payload, dict):
    sys.stderr.write("payload 不是对象\n"); sys.exit(3)
name = payload.get("tool_name")
if not isinstance(name, str) or not name:
    sys.stderr.write("payload 无 .tool_name\n"); sys.exit(3)
ti = payload.get("tool_input")
if not isinstance(ti, dict):
    ti = {}
def g(key):
    v = ti.get(key)
    return v if isinstance(v, str) else ""
text = ""
if name == "send_message":
    text = g("message")
elif name == "team_task_create":
    text = (g("subject") + "\n" + g("description")).strip()
elif name == "spawn_teammate":
    text = g("prompt")
elif name in ("write", "edit"):
    fp = g("file_path")
    if ("派单" in fp) or ("/coordination/" in fp) or ("/gates/" in fp) or ("/dispatch" in fp):
        text = g("content") or g("new_string")
elif name == "bash":
    cmd = g("command")
    if re.search(r"(^|[^A-Za-z])gh[ \t]+(issue|pr)[ \t]+(create|comment|edit)", cmd):
        text = cmd
open(dst, "w", encoding="utf-8").write(text)
open(dst_tool, "w", encoding="utf-8").write(name)
PY
  then
    echo "GATE-ERROR: hook payload 不可解析（$(tr -d '\r\n' < "$TMPD/py.err" | head -c 200)）→ fail-closed" >&2
    exit 2
  fi
  TOOL="$(cat "$TMPD/tool" 2>/dev/null || echo '?')"
else
  if [ -n "$FILE" ]; then
    [ -f "$FILE" ] || { echo "❌ 文本源不可读: $FILE" >&2; exit 2; }
    cp "$FILE" "$TXT" || { echo "❌ 复制失败: $FILE" >&2; exit 2; }
    TOOL="(file)"
  else
    cat > "$TXT" || { echo "GATE-ERROR: stdin 读取失败" >&2; exit 2; }
  fi
fi

# ── 触发面：这是"指令形态"吗？（否则不适用，直接放行）────────
NORM="$TMPD/norm.txt"
# 只去缩进/列表符/粗体/行内代码，**保留 `#` 标题符与 `>` 引用符**（③ 的段域判定要用标题；
# 且 `#1017` 这类 PR 引用不能被当成标题符剥掉 —— 见判据件 §3.3）
# ⚠ 不剥反引号：③ 的围栏（```）判定要用原始行；行内代码由 body-clean 单独剥
sed -E 's/^[[:space:]]*//; s/^[-*+][[:space:]]+//; s/\*\*//g; s/__//g; s/[[:space:]]+$//' "$TXT" > "$NORM"
TEXT_BYTES="$(wc -c < "$NORM" | tr -d ' \r\n')"
TEXT_BYTES="${TEXT_BYTES//[^0-9]/}"
[ -z "$TEXT_BYTES" ] && TEXT_BYTES=0

TRIGGER=""
if [ "$TEXT_BYTES" -gt 0 ]; then
  if grep -qE '(^|[^A-Za-z0-9_])#[0-9]{2,4}([^0-9]|$)' "$NORM"; then TRIGGER="含 #编号"; fi
  if [ -z "$TRIGGER" ] && grep -qE 'D[0-9]{3,4}' "$NORM"; then TRIGGER="含 D# 任务号"; fi
  if [ -z "$TRIGGER" ] && grep -qE '派单|派活|写集|红线|Done 标准|验收命令|执行以下|接单|开工' "$NORM"; then TRIGGER="含指令词"; fi
fi

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
LOGDIR="${SYNO_GATE_LOG_DIR:-${TMPDIR:-/tmp}/synova-gates}"
log_line() {
  mkdir -p "$LOGDIR" 2>/dev/null || return 0
  printf '{"ts":"%s","gate":"dispatch","tool":"%s","trigger":"%s","violations":%s,"result":"%s"}\n' \
    "$TS" "$TOOL" "${TRIGGER:-none}" "${#VIOL[@]}" "$1" >> "$LOGDIR/dispatch-gate.log" 2>/dev/null || true
}
VIOL=()

if [ -z "$TRIGGER" ]; then
  log_line "pass:not-instruction"
  exit 0
fi

# ── 事实源（fail-closed：不可判定 ⇒ GATE-ERROR）──────────────
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "GATE-ERROR: 不在 git 仓库内 → ①④ 不可判定（fail-closed，不静默放行）" >&2; exit 2; }
MAIN="origin/main"
git rev-parse --verify -q "$MAIN" >/dev/null 2>&1 || {
  echo "GATE-ERROR: $MAIN 不可解析（须 git fetch）→ ①④ 不可判定（fail-closed）" >&2; exit 2; }
git log --format=%s -n 5000 "$MAIN" > "$TMPD/main-subjects.txt" 2>/dev/null || : > "$TMPD/main-subjects.txt"

# ═══ ① 仓库内路径存在性 ═══════════════════════════════════════
ROOTS='src|scripts|tests|docs|packages|extensions|electron|electron-renderer|task-state|memory|\.github|hooks'
grep -oE "(^|[^A-Za-z0-9_/.-])(${ROOTS})/[A-Za-z0-9_./*+-]+" "$NORM" 2>/dev/null \
  | sed -E "s/^[^A-Za-z./]*//" | sed -E 's/[.,，。；、）)]+$//' | sort -u > "$TMPD/paths.txt" 2>/dev/null || : > "$TMPD/paths.txt"
while IFS= read -r p; do
  [ -z "$p" ] && continue
  case "$p" in *\**) base="${p%/**}";; *) base="$p";; esac
  hit=0
  if git cat-file -e "$MAIN:$base" 2>/dev/null; then hit=1  # swallow-ok: 路径不存在=预期判定分支（else 走工作区回退）
  elif [ -e "$ROOT/$base" ]; then hit=1; fi
  if [ "$hit" -eq 0 ]; then
    # 同行「新建」标注 = 显式声明（不算违规）
    line="$(grep -nF -- "$p" "$NORM" | head -1)"
    if printf '%s' "$line" | grep -qE '新建|尚未存在|待创建'; then
      continue
    fi
    VIOL+=("① 路径不存在且未标「新建」: ${p}（origin/main 与工作区皆无）")
  fi
done < "$TMPD/paths.txt"

# ═══ ② 外部件五元组 ═══════════════════════════════════════════
five_complete() {  # $1 = 文本块 → 五个标签全在
  local blk="$1" k
  for k in 断面 形态 版本 坐标 时刻; do
    printf '%s' "$blk" | grep -qE "$k[[:space:]]*[:=]" || return 1
  done
  return 0
}
# ②a: 「外部件」标记行必须自带五元组
n=0
while IFS= read -r line; do
  n=$((n+1))
  case "$line" in *外部件*) ;; *) continue ;; esac
  if ! five_complete "$line"; then
    VIOL+=("② 外部件缺五元组（行 ${n}「${line:0:50}」）——须含 断面/形态/版本/坐标/时刻")
  fi
done < "$NORM"
# ②b: 外部主机 URL 须钉版本或就近五元组（代码块内不计；本仓/localhost 放行）
ALLOW="${SYNO_GATE_URL_ALLOW:-github.com/synova-agent,github.com/orgs/synova-agent,api.github.com,127.0.0.1,localhost}"
awk 'BEGIN{f=0} /^```/{f=1-f; next} f==0{printf "%d\t%s\n", NR, $0}' "$NORM" > "$TMPD/nofence.txt"
grep -oE 'https?://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+' "$TMPD/nofence.txt" 2>/dev/null | sort -u > "$TMPD/urls.txt" 2>/dev/null || : > "$TMPD/urls.txt"
while IFS= read -r u; do
  [ -z "$u" ] && continue
  skip=0
  IFS=',' read -r -a hosts <<< "$ALLOW"
  for h in "${hosts[@]}"; do [ -n "$h" ] && case "$u" in *"$h"*) skip=1;; esac; done
  [ "$skip" -eq 1 ] && continue
  # 钉版：URL 内含 7-40 位 sha 或语义版本段
  if printf '%s' "$u" | grep -qE '(/|@|=)[0-9a-f]{7,40}([^0-9a-f]|$)|/v?[0-9]+\.[0-9]+\.[0-9]+'; then continue; fi
  ln="$(grep -nF -- "$u" "$TMPD/nofence.txt" | head -1 | cut -d: -f1)"
  [ -z "$ln" ] && ln=1
  lo=$((ln-3)); [ "$lo" -lt 1 ] && lo=1
  blk="$(sed -n "${lo},$((ln+3))p" "$NORM")"
  if ! five_complete "$blk"; then
    VIOL+=("② 外部引用未钉版且无五元组: ${u:0:70}（行 ${ln}；须 URL 内钉 sha/版本，或就近给 断面/形态/版本/坐标/时刻）")
  fi
done < "$TMPD/urls.txt"

# ═══ ③ 单流（一条指令只许一个前缀）═══════════════════════════
PREFIX_FILE="${SYNO_GATE_PREFIXES:-$SELF_DIR/stream-prefixes.txt}"
PREFIXES=()
if [ -f "$PREFIX_FILE" ]; then
  while IFS= read -r pf; do
    pf="${pf%%#*}"; pf="$(printf '%s' "$pf" | tr -d ' \r\n\t')"
    [ -n "$pf" ] && PREFIXES+=("$pf")
  done < "$PREFIX_FILE"
fi
[ "${#PREFIXES[@]}" -eq 0 ] && PREFIXES=(CTO DSH GV IM BT CL K1 K3 PL SQ)

# 证据/回执段与代码块、引号内不计入（防误拦：派单正文引用他人回执是常态）
awk '
  BEGIN { fence=0; ev=0 }
  /^```/ { fence=1-fence; next }
  fence==1 { next }
  /^#{1,6}[[:space:]]/ || /^§/ {
    if ($0 ~ /回执|证据|复现|现状|为什么|背景|实测|实证|输入|症状|根因|验收记录/) ev=1; else ev=0
    if (ev==0) print
    next
  }
  ev==1 { next }
  { print }
' "$NORM" > "$TMPD/body.txt"
sed -E 's/「[^」]*」//g; s/"[^"]*"//g; s/`[^`]*`//g' "$TMPD/body.txt" > "$TMPD/body-clean.txt"
FOUND_PREFIXES=()
for p in "${PREFIXES[@]}"; do
  if grep -qE "(^|[^A-Za-z0-9_])${p}-" "$TMPD/body-clean.txt" 2>/dev/null; then FOUND_PREFIXES+=("$p"); fi
done
if [ "${#FOUND_PREFIXES[@]}" -gt 1 ]; then
  VIOL+=("③ 非单流: 指令正文出现 ${#FOUND_PREFIXES[@]} 个前缀（${FOUND_PREFIXES[*]}）——一条指令只许一个流前缀")
fi

# ═══ ④ 点名分支/PR 的真伪 ════════════════════════════════════
fact_pr_in_main() { grep -qE "(Merge pull request #$1([^0-9]|$)|\(#$1\))" "$TMPD/main-subjects.txt"; }
fact_branch_in_main() { git merge-base --is-ancestor "origin/$1" "$MAIN" 2>/dev/null || return 1; }  # swallow-ok: 非祖先=预期判定（return 1 即"不在 main"）
n=0
while IFS= read -r line; do
  n=$((n+1))
  [ -z "$line" ] && continue
  # 分支名
  for b in $(printf '%s' "$line" | grep -oE '(feat|fix|docs|chore|session|review|verify|refactor|test)/[A-Za-z0-9._/-]+' | sort -u); do
    if git rev-parse --verify -q "origin/$b" >/dev/null 2>&1; then
      if fact_branch_in_main "$b"; then state="in-main"; else state="not-in-main"; fi
    else
      state="unknown-ref"
    fi
    if printf '%s' "$line" | grep -qE '已合|已合并|已在 ?main|已入 ?main|已落地' && [ "$state" != "in-main" ]; then
      VIOL+=("④ 声称分支已入 main，实为 ${state}: ${b}（行 ${n}）")
    elif printf '%s' "$line" | grep -qE '在飞|未合|待合|未入 ?main|未合并' && [ "$state" = "in-main" ]; then
      VIOL+=("④ 声称分支在飞，实已入 main（状态陈述过期）: ${b}（行 ${n}）")
    fi
  done
  # PR 号（只在同行情境涉及 PR/合并时判定，避免把 issue 号误当 PR）
  if printf '%s' "$line" | grep -qE 'PR|pr[[:space:]]*#|合并|已合|在飞'; then
    for pr in $(printf '%s' "$line" | grep -oE '#[0-9]{2,4}' | tr -d '#' | sort -u); do
      if fact_pr_in_main "$pr"; then state="in-main"; else state="not-in-main"; fi
      if printf '%s' "$line" | grep -qE '已合|已合并|已在 ?main|已入 ?main|已落地' && [ "$state" != "in-main" ]; then
        VIOL+=("④ 声称 PR #${pr} 已合，origin/main 无合并痕迹（行 ${n}）")
      elif printf '%s' "$line" | grep -qE '在飞|未合|待合|未入 ?main|未合并' && [ "$state" = "in-main" ]; then
        VIOL+=("④ 声称 PR #${pr} 在飞，实已入 main（状态陈述过期，行 ${n}）")
      fi
    done
  fi
done < "$NORM"

# ── 结论 ─────────────────────────────────────────────────────
if [ "${#VIOL[@]}" -eq 0 ]; then
  log_line "pass:four-checks"
  exit 0
fi

{
  echo "🔴 dispatch 闸（dispatch-gate）：指令未过引用核验（工具=${TOOL}，触发=${TRIGGER}）"
  for v in "${VIOL[@]}"; do echo "   · $v"; done
  echo "   修法: 逐条修正后重发；确实不存在的路径写「新建」，在飞引用勿写成「已合」。"
  if [ "$HOOK" -eq 1 ] && [ "$GATE_MODE" = "advise" ]; then
    echo "   ADVISORY: 当前为 advise 模式——本轮不阻断（已留痕 $LOGDIR/dispatch-gate.log）"
  fi
} >&2
log_line "violation:${#VIOL[@]}"

if [ "$HOOK" -eq 1 ]; then
  if [ "$GATE_MODE" = "advise" ]; then exit 0; fi
  exit 2
fi
exit 1
