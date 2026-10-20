#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-fixture-requires.sh — 夹具依赖声明核对（卡 #739 ④ · 裁 223）
#
# 目的: 夹具"要什么依赖"必须可声明、可核、可报名字；工具链只有**一个来源**。
#   ① 夹具头部 `# @requires <bin> [<bin>...]`（可多行）声明依赖
#   ② 声明项必须在 fixture-toolchain.txt（单一来源）；不在 ⇒ MANIFEST_GAP（exit 1）
#   ③ 声明项在当前环境不可执行 ⇒ exit 2 且**写明缺哪个 bin**（不是笼统"门禁判不了"）
#   ④ 未声明却使用了清单里的外部 bin（非注释行）⇒ exit 1（存量按基线放行，棘轮只减不增）
#
# 契约（铁律 47）:
#   @input  — [--fixtures <dir>] [--list <manifest>] [--baseline <file>]
#             [--write-baseline] [--quiet]
#             默认: tests/control-tower ｜ 同目录 fixture-toolchain.txt ｜ 同目录 fixture-requires-baseline.txt
#   @output — 逐项结果；末行 `FIXTURE-REQUIRES: OK|VIOLATION(n)|MISSING(n)|DEGRADED`
#   @exit   — 0 通过｜1 违规（MANIFEST_GAP / 未声明使用）｜2 依赖缺失或自身异常（fail-closed）
#   @degraded — exit 2 + stderr `degraded:`（清单缺失/目录缺失）
#   兼容: macOS bash 3.2（无关联数组；用临时 TSV＋awk/grep）
#   测试注入: 上述参数 + SYNO_FIXTURE_TOOLCHAIN / SYNO_FIXTURE_REQUIRES_BASELINE
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MAIN_ROOT="$(dirname "$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || echo "$ROOT/.git")")"
FIX_DIR="$ROOT/tests/control-tower"
LIST="${SYNO_FIXTURE_TOOLCHAIN:-$SCRIPT_DIR/fixture-toolchain.txt}"
BASELINE="${SYNO_FIXTURE_REQUIRES_BASELINE:-$SCRIPT_DIR/fixture-requires-baseline.txt}"
WRITE_BASELINE=0; QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --fixtures) FIX_DIR="${2:-}"; shift ;;
    --fixtures=*) FIX_DIR="${1#--fixtures=}" ;;
    --list) LIST="${2:-}"; shift ;;
    --list=*) LIST="${1#--list=}" ;;
    --baseline) BASELINE="${2:-}"; shift ;;
    --baseline=*) BASELINE="${1#--baseline=}" ;;
    --write-baseline) WRITE_BASELINE=1 ;;
    --quiet) QUIET=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
die2() { printf 'degraded: %s\n' "$*" >&2; echo "FIXTURE-REQUIRES: DEGRADED"; exit 2; }

[ -f "$LIST" ] || die2 "工具链清单不可读: $LIST"
[ -d "$FIX_DIR" ] || die2 "夹具目录不存在: $FIX_DIR"

TMPD="$(mktemp -d /tmp/fixreq.XXXXXX)" || die2 "mktemp 失败"
trap 'rm -rf "$TMPD"' EXIT
LIST_TSV="$TMPD/list.tsv"
awk -F'|' '
  { bin=$1; kind=$2; spec=$3;
    gsub(/^[[:space:]]+|[[:space:]]+$/,"",bin);
    gsub(/^[[:space:]]+|[[:space:]]+$/,"",kind);
    gsub(/^[[:space:]]+|[[:space:]]+$/,"",spec);
    if (bin=="" || bin ~ /^#/) next;
    print bin "\t" kind "\t" spec }
' "$LIST" > "$LIST_TSV"
[ -s "$LIST_TSV" ] || die2 "工具链清单解析出 0 项: $LIST"

MISSING=0; VIOL=0; BASELINED=0; CHECKED=0
FAIL_FILE="$TMPD/fails.txt"; : > "$FAIL_FILE"
NEWBASE_FILE="$TMPD/newbase.txt"; : > "$NEWBASE_FILE"

manifest_kind() { awk -F'\t' -v b="$1" '$1==b{print $2; exit}' "$LIST_TSV"; }
in_baseline() { [ -f "$BASELINE" ] && grep -qxF -- "$1" <(grep -vE '^[[:space:]]*#' "$BASELINE" 2>/dev/null) 2>/dev/null; }
uses_bin() { # <file> <bin>
  grep -vE '^[[:space:]]*#' "$1" 2>/dev/null \
    | grep -qE "(^|[;&|(]|[[:space:]])(command[[:space:]]+-v[[:space:]]+)?$2([[:space:]]|\$|\)|;|&|\|)" 2>/dev/null
}

while IFS= read -r f; do
  [ -z "$f" ] && continue
  CHECKED=$((CHECKED + 1))
  rel="${f#$ROOT/}"
  # 只解析**头部注释块**（shebang 后、首个非注释/非空行之前）——避免把 heredoc 里的 @requires 样本当成本文件声明
  awk '
    NR==1 && /^#!/ {next}
    /^[[:space:]]*#/ { if ($0 ~ /@requires/) print $0; next }
    /^[[:space:]]*$/ { next }
    { exit }
  ' "$f" 2>/dev/null \
    | sed -E 's/^[[:space:]]*#[[:space:]]*@requires[[:space:]]*//' \
    | tr ' ,' '\n\n' | sed '/^[[:space:]]*$/d' | sort -u > "$TMPD/decl.txt"
  # ② 清单缺口 ＋ ③ 缺依赖（报名字）
  while IFS= read -r b; do
    [ -z "$b" ] && continue
    kind="$(manifest_kind "$b")"
    if [ -z "$kind" ]; then
      VIOL=$((VIOL + 1)); printf '  ❌ MANIFEST_GAP: %s 声明了 %s，但工具链清单没有它（先改 fixture-toolchain.txt）\n' "$rel" "$b" >> "$FAIL_FILE"
      continue
    fi
    if ! command -v "$b" >/dev/null 2>&1 \
       && [ ! -x "$ROOT/node_modules/.bin/$b" ] \
       && [ ! -x "$MAIN_ROOT/node_modules/.bin/$b" ]; then
      MISSING=$((MISSING + 1)); printf '  ❌ MISSING: %s 需要 %s（kind=%s）— 当前环境不可执行\n' "$rel" "$b" "$kind" >> "$FAIL_FILE"
    fi
  done < "$TMPD/decl.txt"
  # ④ 未声明使用（清单内、非 bash/git）
  cut -f1 "$LIST_TSV" | grep -vE '^(bash|git)$' | while IFS= read -r b; do
    [ -z "$b" ] && continue
    if uses_bin "$f" "$b"; then
      if ! grep -qxF -- "$b" "$TMPD/decl.txt" 2>/dev/null; then
        if [ "$WRITE_BASELINE" = 1 ] || in_baseline "$rel"; then
          printf '%s\n' "$rel" >> "$NEWBASE_FILE"
        else
          printf '  ❌ UNDECLARED: %s 使用了 %s 但未 # @requires 声明\n' "$rel" "$b" >> "$FAIL_FILE"
          printf '%s\n' "V" >> "$TMPD/viol_marker"
        fi
      fi
    fi
  done
  if [ -f "$TMPD/viol_marker" ]; then VIOL=$((VIOL + $(wc -l < "$TMPD/viol_marker" | tr -d ' '))); rm -f "$TMPD/viol_marker"; fi
done < <(find "$FIX_DIR" -maxdepth 2 -type f \( -name '*.test.sh' -o -name '*.test.py' \) 2>/dev/null | sort)

if [ "$WRITE_BASELINE" = 1 ]; then
  { echo "# fixture-requires-baseline.txt — 存量未声明使用（卡 #739 ④ · 棘轮只减不增）"
    echo "# 格式：<仓库相对路径>；新夹具/改动夹具必须改用 # @requires 声明，不得加进本文件。"
    sort -u "$NEWBASE_FILE" | grep -v '^$'
  } > "$BASELINE"
  say "已写入基线: ${BASELINE}（$(grep -vcE '^#' "$BASELINE" 2>/dev/null || echo 0) 条）"
fi

for line in "$FAIL_FILE"; do :; done
cat "$FAIL_FILE"
BASELINED="$(sort -u "$NEWBASE_FILE" 2>/dev/null | grep -vc '^$' || true)"
say "FIXTURE-REQUIRES: checked=$CHECKED missing=$MISSING viol=$VIOL baselined=$BASELINED"
if [ "$MISSING" -gt 0 ]; then
  echo "FIXTURE-REQUIRES: MISSING($MISSING)"
  exit 2
fi
if [ "$VIOL" -gt 0 ]; then
  echo "FIXTURE-REQUIRES: VIOLATION($VIOL)"
  exit 1
fi
echo "FIXTURE-REQUIRES: OK"
exit 0
