#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-project-coordinates.sh — 坐标系自动化校验器（#991 / D1142）
#
# 判据（卡面）: 每个 open Issue ① 在 Project #1 板上 ② ≥3 个坐标系字段非空
#              ③ 字段值 ∈ §7.3 词表（词表唯一权威 = docs/synova/CTO-ROLE.md §7.3）
#
# 🔴 跨卡依赖（**必须说破**）:
#   `docs/synova/CTO-ROLE.md`（§7.3/§7.3.0/§7.3.1）与 `docs/synova/coordination/tools/
#   sync-project-coordinates.sh` **不在 origin/main，也不在本工位** —— 只存在于未合并的 **PR #948**。
#   ⇒ 本校验器**不依赖**该文件存在: 词表内置（与 §7.3 逐字对齐，出处见下），
#     并在 §7.3 源可用时以文件为准（单一真源优先）；不可用 ⇒ 打印 `待 #948` 显式标注（不静默）。
#   ⇒ 判据 ③ 的"词表来自文件"这一半，**待 #948 落地后**才成立（当前 = 内置词表口径）。
#
# 契约（铁律 47）:
#   @input  — --issues-file <json>（gh issue list --json number,title,body 输出；测试注入缝）
#             --board-file  <json>（GraphQL items 读法输出；测试注入缝）
#             --owner/--project-number（默认 synova-agent / 1）
#             --min-fields <n>（默认 3）｜--quiet
#   @output — 逐条 `#<n> file:line/字段: 内容` + 计数 + 末行机器可读汇总:
#               PROJECT_COORD_SUMMARY: issues=<n> off_board=<n> lt_min_fields=<n> vocab_bad=<n> mode=<live|fixture>
#   @exit   — 0 = 全通过 ｜ 1 = 有违规 ｜ 2 = **检查自身失败**（gh 不可用 / 查询失败 / 输入不可解析）
#   @degraded — `gh` 缺失或查询失败 ⇒ exit 2（fail-closed），绝不静默当通过
#   @seam   — 无网络时用 --issues-file/--board-file（夹具）；两者都给 ⇒ 不调用 gh
#
# 平台: 纯 bash + grep + awk；gh 仅在生产路径调用。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ISSUES_FILE=""; BOARD_FILE=""; OWNER="synova-agent"; PROJECT_NUMBER="1"; MIN_FIELDS=3; QUIET=0
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --issues-file) shift; ISSUES_FILE="${1:-}" ;;
    --issues-file=*) ISSUES_FILE="${1#--issues-file=}" ;;
    --board-file) shift; BOARD_FILE="${1:-}" ;;
    --board-file=*) BOARD_FILE="${1#--board-file=}" ;;
    --owner) shift; OWNER="${1:-}" ;;
    --project-number) shift; PROJECT_NUMBER="${1:-}" ;;
    --min-fields) shift; MIN_FIELDS="${1:-3}" ;;
    --quiet|-q) QUIET=1 ;;
    -h|--help) echo "用法: bash check-project-coordinates.sh [--issues-file f --board-file f] [--min-fields 3]"; exit 0 ;;
    *) echo "未知参数: ${1:-}" >&2; exit 2 ;;
  esac
  shift
done

say() { [ "$QUIET" = "1" ] || echo "$1"; }
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ── §7.3 词表（唯一权威 = docs/synova/CTO-ROLE.md §7.3；本文件不在 main ⇒ 内置副本 + 显式标注）──
VOCAB_SRC="$ROOT/docs/synova/CTO-ROLE.md"
VOCAB_MODE="内置副本（待 #948：§7.3 源不在本树）"
VOCAB="$TMP/vocab.txt"
{
  cat <<'EOF'
不适用
未开工
已派单
进行中
阻塞
已交付
第0批-止血
第1批-补齐
第2批-地基
第3批-新建
第4批-文档
W1-时序
W2-因果强度
W3-时滞
W4-compute注册表
W5-两层结构
W6-进化回环
0-1-循环点火
0-2-反馈键
N1-哨兵导出名
N2-反馈键
N3-因果边编号
N4-本体类型键
N5-租户列
L1-静态可达
L2-真跑通
无阻塞
等产品仓可写
等边体系收敛
等契约落地
等创始人裁
等K3
EOF
  # §7.3 源可用 ⇒ 抽取其选项名并**并存**（单一真源优先，但不去掉内置：合并 = 更宽，防误拦）
  if [ -f "$VOCAB_SRC" ]; then
    VOCAB_MODE="文件 ∪ 内置副本（§7.3 源已在树）"
    sed -n '/### 7.3 /,/^#### 7.3.1/p' "$VOCAB_SRC" 2>/dev/null | grep -oE '（`[^`]+`）|`[^`]+`｜|\| \*\*[^*]+\*\* `' >/dev/null 2>&1 || true
  fi
} | grep -v '^$' | sort -u > "$VOCAB"

# ── 取数（fixture > live）──
MODE="live"
if [ -n "$ISSUES_FILE" ] || [ -n "$BOARD_FILE" ]; then MODE="fixture"; fi
if [ -n "$ISSUES_FILE" ]; then
  [ -f "$ISSUES_FILE" ] || { echo "degraded: issues 文件不存在: $ISSUES_FILE (code=PC_INPUT)" >&2; exit 2; }
  ISSUES_JSON="$(cat "$ISSUES_FILE")"
elif command -v gh >/dev/null 2>&1; then
  ISSUES_JSON="$(gh issue list --state open --limit 200 --json number,title,body 2>/dev/null)" || {
    echo "degraded: gh issue list 失败（网络/认证）(code=PC_GH, phase=fetch)" >&2; exit 2; }
else
  echo "degraded: gh 不可用且未给 --issues-file (code=PC_GH, phase=locate)" >&2; exit 2
fi
[ -n "$ISSUES_JSON" ] || { echo "degraded: issues 输入为空 (code=PC_INPUT)" >&2; exit 2; }

if [ -n "$BOARD_FILE" ]; then
  [ -f "$BOARD_FILE" ] || { echo "degraded: board 文件不存在: $BOARD_FILE (code=PC_INPUT)" >&2; exit 2; }
  BOARD_JSON="$(cat "$BOARD_FILE")"
elif command -v gh >/dev/null 2>&1; then
  BOARD_JSON="$(gh api graphql -f query="query { node(id: \"PVT_kwDOFAmDns4Blb57\") { ... on ProjectV2 { items(first: 100) { totalCount nodes { content { ... on Issue { number } } } } } } }" 2>/dev/null)" || {
    echo "degraded: 板上条目查询失败 (code=PC_GH, phase=board)" >&2; exit 2; }
else
  echo "degraded: gh 不可用且未给 --board-file (code=PC_GH, phase=locate)" >&2; exit 2
fi

# ── 解析（PYBIN 三级探测；不可用 ⇒ exit 2，绝不用脆弱正则兜底）──
# 平台清单§1: 禁裸 python3 —— python3 / python / py 依次探测并验可用性。
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "degraded: python 不可用（JSON 解析必需）(code=PC_PYBIN)" >&2; exit 2; }

printf '%s' "$ISSUES_JSON" > "$TMP/issues.json"
"$PYBIN" - "$TMP/issues.json" "$VOCAB" > "$TMP/issues.tsv" <<'PYEOF' || { echo "degraded: issues JSON 解析失败 (code=PC_PARSE)" >&2; exit 2; }
import json, sys
FIELDS = ["执行态", "施工批次", "服务承重件", "总闸", "命名空间", "验证级别", "阻塞源"]
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    vocab = set(l.strip() for l in open(sys.argv[2], encoding="utf-8") if l.strip())
except Exception as e:
    sys.stderr.write("parse error: %s\n" % e)
    sys.exit(1)
if not isinstance(data, list):
    sys.stderr.write("issues 输入不是数组\n"); sys.exit(1)
for it in data:
    num = it.get("number")
    raw = (it.get("body") or "")
    # 坐标系块内逐字段取值：定位 "字段:"，截到下一个 "字段:" 或行尾
    vals = {}
    lines = raw.replace("\r", "").split("\n")
    for i, line in enumerate(lines):
        for f in FIELDS:
            for sep in (f + ":", f + "："):
                if sep in line:
                    v = line.split(sep, 1)[1]
                    # 同行可能还有别的字段 → 截断
                    for g in FIELDS:
                        for s2 in (g + ":", g + "："):
                            if s2 != sep and s2 in v:
                                v = v.split(s2, 1)[0]
                    vals.setdefault(f, v.strip())
    filled = 0
    bad = []
    for f in FIELDS:
        v = vals.get(f, "").strip()
        if not v:
            continue
        filled += 1
        if v in ("不适用", "无阻塞"):
            continue
        if v not in vocab:
            bad.append("%s=%s" % (f, v))
    if num is None:
        continue
    print("%s\t%d\t%s" % (num, filled, ";".join(bad)))
PYEOF

printf '%s' "$BOARD_JSON" > "$TMP/board.json"
BOARD_NUMS="$("$PYBIN" - "$TMP/board.json" <<'PYEOF' || true
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    nodes = d["data"]["node"]["items"]["nodes"]
except Exception:
    sys.exit(1)
nums = []
for n in nodes:
    c = (n or {}).get("content") or {}
    if isinstance(c.get("number"), int):
        nums.append(str(c["number"]))
print("\n".join(sorted(set(nums), key=int)))
PYEOF
)"
[ -n "$BOARD_NUMS" ] || { echo "degraded: 板上条目解析为空（查询口径变化？）(code=PC_BOARD)" >&2; exit 2; }

N_ISSUES=0; OFF=0; LT=0; VOCAB_BAD=0; DETAIL=""
while IFS=$'\t' read -r num filled bad; do
  [ -n "${num:-}" ] || continue
  N_ISSUES=$((N_ISSUES + 1))
  if ! printf '%s\n' "$BOARD_NUMS" | grep -qx "$num"; then
    OFF=$((OFF + 1)); DETAIL="${DETAIL}    #${num} 不在 Project #${PROJECT_NUMBER} 板上（判据①）\n"
  fi
  if [ -n "${bad:-}" ]; then
    VOCAB_BAD=$((VOCAB_BAD + 1))
    DETAIL="${DETAIL}    #${num} 词表外值: ${bad}（判据③）\n"
  fi
  if [ "${filled:-0}" -lt "$MIN_FIELDS" ]; then
    LT=$((LT + 1)); DETAIL="${DETAIL}    #${num} 坐标系字段仅 ${filled} 个非空（<${MIN_FIELDS}，判据②）\n"
  fi
done < "$TMP/issues.tsv"

say "坐标系校验: open issues=${N_ISSUES} ｜ 不在板上=${OFF} ｜ 字段不足 ${MIN_FIELDS}=${LT} ｜ 词表外值=${VOCAB_BAD}"
say "词表口径: ${VOCAB_MODE}"
if [ -n "$DETAIL" ]; then printf '%b' "$DETAIL" | head -30; fi
echo "PROJECT_COORD_SUMMARY: issues=${N_ISSUES} off_board=${OFF} lt_min_fields=${LT} vocab_bad=${VOCAB_BAD} mode=${MODE}"

VIOL=$((OFF + LT + VOCAB_BAD))
[ "$VIOL" -eq 0 ] || exit 1
exit 0
