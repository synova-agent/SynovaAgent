#!/usr/bin/env bash
# D313/D520 UTF-8 强制（PLATFORM-CHECKLIST 第 4 条）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# receipt-gate.sh — 收件闸（D1163，CTO 2026-10-06 派单「闸 1」）
#
# 目的: CTO 收件时，**信封不全 ⇒ 根本收不了**（替代"我记得要信封"）。
# 载体: DSH hooks 桥（@deepseek-ai/dsh-hooks-claude-code）UserPromptSubmit 事件。
#
# 契约（铁律 47）:
#   @input  — 三选一：
#             --hook            stdin = Claude Code 事件 JSON（UserPromptSubmit），取 .prompt
#             --file <path>     文本来自文件
#             （缺省）           stdin = 纯文本
#   @output — 逐项点名到 stderr（hook 模式）：缺哪几行 + 触发依据 + 修法
#   @exit   — 三态（ctrl-tower-change 模式 1）:
#             0 = 通过（非回执文本一律通过；回执六行齐全且值非空）
#             1 = 违规（声称是回执但信封不全）
#             2 = 检查自身失败（payload 不可解析 / 文本源不可读）
#   @hook 映射（宿主方言: 只有 exit 2 才阻断）:
#             通过 → 0 ｜ 违规 → 2（stderr = 缺项清单，喂给收件方）
#             自身失败 → 2（stderr 前缀 GATE-ERROR，同样阻断，禁静默放行）
#             advise 模式（SYNO_GATE_MODE=advise）→ 违规降为 0 + stderr 前缀 ADVISORY
#   @degraded — 无 python3 ⇒ hook 模式无法解析 payload ⇒ 显式 GATE-ERROR + exit 2
#             （安装前置条件已在安装脚本里校验；本脚本不静默降级）
#   @seam   — SYNO_GATE_LOG_DIR（落痕目录，默认 ${TMPDIR:-/tmp}/synova-gates）
#             SYNO_GATE_MODE=advise|enforce（默认 enforce）
#   @side   — 只读输入；只在 SYNO_GATE_LOG_DIR 追加一行 jsonl（失败亦不影响退出码判定）
#
# 判据来源: CTO 派单 §1（必填六行：流前缀 / 基线 ref / 项清单 / 状态 / 例外清单 / 在飞-卡数）
#   本卡细化的两处（已在判据件 D1163 §2 明写，可被 CTO 覆盖）:
#     ① 触发面 = 「声称是回执」（行首=回执 / 行尾=回执且短行 / 六行标签命中 ≥2）
#        —— 防误拦：正文里提到"回执"二字不算声称（误拦 = 收件方直接收不到，代价最大）
#     ② 值非空 —— 六个标签后面必须有非空值；空值等于没填（无则写「无」）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

MODE_SRC="stdin-text"
FILE=""
HOOK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --hook) HOOK=1; shift ;;
    --file) FILE="${2:-}"; shift 2 ;;
    -h|--help) echo "用法: $0 [--hook|--file <path>]  （缺省: stdin 纯文本）"; exit 0 ;;
    *) echo "❌ 未知参数: $1" >&2; exit 2 ;;
  esac
done

GATE_MODE="${SYNO_GATE_MODE:-enforce}"

# ── 输入收集 ──────────────────────────────────────────────────
TMPD="$(mktemp -d)" || { echo "GATE-ERROR: mktemp 失败" >&2; exit 2; }
trap 'rm -rf "$TMPD"' EXIT
TXT_FILE="$TMPD/text"

if [ "$HOOK" -eq 1 ]; then
  MODE_SRC="hook:UserPromptSubmit"
  cat > "$TMPD/payload.json" || { echo "GATE-ERROR: payload 读取失败" >&2; exit 2; }
  PYBIN=""
  for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
    command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
  done
  if [ -z "$PYBIN" ]; then
    echo "GATE-ERROR: 无可用 python（PYBIN 三级探测 python3/python/py 全不可用）→ 无法解析 hook payload（fail-closed，不静默放行）" >&2
    exit 2
  fi
  if ! "$PYBIN" - "$TMPD/payload.json" "$TXT_FILE" <<'PY' 2>"$TMPD/py.err"
import json, sys
src, dst = sys.argv[1], sys.argv[2]
raw = open(src, encoding="utf-8", errors="replace").read()
try:
    payload = json.loads(raw)
except Exception as exc:                     # noqa: BLE001 - 显式降级，不静默
    sys.stderr.write("json 解析失败: %s\n" % exc)
    sys.exit(3)
if not isinstance(payload, dict):
    sys.stderr.write("payload 不是对象\n")
    sys.exit(3)
prompt = payload.get("prompt")
if not isinstance(prompt, str):
    sys.stderr.write("payload 无 .prompt 字段（事件=%r）\n" % payload.get("hook_event_name"))
    sys.exit(3)
open(dst, "w", encoding="utf-8").write(prompt)
PY
  then
    echo "GATE-ERROR: hook payload 不可解析（$(tr -d '\r\n' < "$TMPD/py.err" | head -c 200)）→ fail-closed" >&2
    exit 2
  fi
else
  if [ -n "$FILE" ]; then
    MODE_SRC="file:$FILE"
    [ -f "$FILE" ] || { echo "❌ 文本源不可读: $FILE" >&2; exit 2; }
    cp "$FILE" "$TXT_FILE" || { echo "❌ 复制失败: $FILE" >&2; exit 2; }
  else
    cat > "$TXT_FILE" || { echo "GATE-ERROR: stdin 读取失败" >&2; exit 2; }
  fi
fi

# ── 六行信封判据 ──────────────────────────────────────────────
# normalize: 去行首空白 / markdown 标题符（`##`+ 或 `# `，**不吞 `#1234` 这类编号**）/
# 引用符 / 列表符 / 粗体与行内代码包裹
NORM="$TMPD/norm.txt"
sed -E 's/^[[:space:]]*//; s/^#{2,}[[:space:]]*//; s/^#[[:space:]]+//; s/^>[[:space:]]*//; s/^[-*+][[:space:]]+//; s/\*\*//g; s/__//g; s/`//g; s/[[:space:]]+$//' "$TXT_FILE" > "$NORM" 2>/dev/null || : > "$NORM"

L_STRM='^流前缀[[:space:]]*[:：][[:space:]]*(.+)$'
L_BASE='^基线[[:space:]]*ref[[:space:]]*[:：][[:space:]]*(.+)$'
L_ITEM='^项清单[[:space:]]*[:：][[:space:]]*(.+)$'
L_STAT='^状态[[:space:]]*[:：][[:space:]]*(.+)$'
L_EXCP='^例外清单[[:space:]]*[:：][[:space:]]*(.+)$'
L_FLGT='^在飞[-－—]?卡数[[:space:]]*[:：][[:space:]]*(.+)$'
# ⚠ 六个标签一律**锚定行首**（归一化后）——这是触发面的第一道闸：
#   正文里"提到"六个字段名（如派单件写「必备六行：流前缀: / 基线 ref: …」）不算信封。
FIELDS=("流前缀|$L_STRM" "基线 ref|$L_BASE" "项清单|$L_ITEM" "状态|$L_STAT" "例外清单|$L_EXCP" "在飞-卡数|$L_FLGT")

# 值是否为"空"（只有分隔符/占位符：/、—、-、空格、无）
# 值是否为"空"（只有分隔符/占位符：/、—、-、|、空白）
# BSD tr 在多字节字符集下对 `tr -d` 的集合报 Illegal byte sequence（macOS 实测），
# 故用 bash 参数展开做纯内建清洗（PLATFORM-CHECKLIST 第 7/9 条同族：避开平台方言）
value_is_empty() {
  local v="$1"
  v="${v//[[:space:]]/}"; v="${v//\//}"; v="${v//-/}"; v="${v//—/}"; v="${v//－/}"; v="${v//|/}"
  [ -z "$v" ]
}

PRESENT=0; MISSING=(); FILLED=0
for f in "${FIELDS[@]}"; do
  label="${f%%|*}"; re="${f#*|}"
  found=0
  while IFS= read -r line; do
    if [[ "$line" =~ $re ]]; then
      val="${BASH_REMATCH[1]}"
      if value_is_empty "$val"; then found=2; else found=1; fi
      break
    fi
  done < "$NORM"
  case "$found" in
    1) PRESENT=$((PRESENT+1)); FILLED=$((FILLED+1)) ;;
    2) PRESENT=$((PRESENT+1)); MISSING+=("${label}（有标签但值为空——无则写「无」）") ;;
    0) MISSING+=("${label}（整行缺失）") ;;
  esac
done

# ── 触发面：这份文本"声称是回执"吗 ────────────────────────────
CLAIM=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  if [[ "$line" =~ ^回执 ]]; then CLAIM="行首=回执"; break; fi
  if [ "${#line}" -le 80 ] && [[ "$line" =~ 回执】?$ ]]; then CLAIM="短行行尾=回执"; break; fi
done < "$NORM"
if [ -z "$CLAIM" ] && [ "$PRESENT" -ge 2 ]; then CLAIM="六行标签命中 ${PRESENT}/6"; fi

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
LOGDIR="${SYNO_GATE_LOG_DIR:-${TMPDIR:-/tmp}/synova-gates}"
log_line() {
  mkdir -p "$LOGDIR" 2>/dev/null || return 0
  printf '{"ts":"%s","gate":"receipt","src":"%s","claim":"%s","present":%s,"missing":"%s","result":"%s"}\n' \
    "$TS" "$MODE_SRC" "${CLAIM:-none}" "$PRESENT" "$(printf '%s;' "${MISSING[@]:-}" 2>/dev/null)" "$1" >> "$LOGDIR/receipt-gate.jsonl" 2>/dev/null || true
}

if [ -z "$CLAIM" ]; then
  log_line "pass:not-claimed"
  exit 0
fi

if [ "${#MISSING[@]}" -eq 0 ]; then
  log_line "pass:complete"
  exit 0
fi

# ── 违规输出 ──────────────────────────────────────────────────
{
  echo "🔴 收件闸（receipt-gate）：这封回执的信封不全 —— 收不了。"
  echo "   触发依据: 文本声称是回执（${CLAIM}）"
  echo "   缺项:"
  for m in "${MISSING[@]}"; do echo "     · $m"; done
  echo "   必备六行（缺任一即拒收）: 流前缀: / 基线 ref: / 项清单: / 状态: / 例外清单: / 在飞-卡数:"
  echo "   修法: 补齐上列各行后重发；空值写「无」，不要留空。"
  if [ "$HOOK" -eq 1 ] && [ "$GATE_MODE" = "advise" ]; then
    echo "   ADVISORY: 当前为 advise 模式——本轮不阻断（已留痕 $LOGDIR/receipt-gate.jsonl）"
  fi
} >&2
log_line "violation:missing-${#MISSING[@]}"

if [ "$HOOK" -eq 1 ]; then
  if [ "$GATE_MODE" = "advise" ]; then exit 0; fi
  exit 2
fi
exit 1
