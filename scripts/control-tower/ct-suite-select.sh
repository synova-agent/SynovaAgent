#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# ct-suite-select.sh — D1061/PR-A: CT 密封套件变更选择器
#
# 契约 (铁律 47):
#   @input  --changed <base>...<head>  git 三段点变更范围（merge-base 语义）
#           --platform <os>            any(默认) | ubuntu | windows | macos
#           --list                     打印映射表（域→套件 + 平台敏感集），只读不选
#           --all                      打印全量密封清单（不选）
#           --map <path>               映射文件（默认 <root>/scripts/control-tower/ct-suite-map.json）
#           --repo <path>              仓库根（默认 git rev-parse --show-toplevel）
#           --degraded-log <path>      降级日志（默认 <root>/.codex/control-tower/logs/degraded-events.log）
#   @output stdout = 一行一个测试路径（sort -u）；降级/诊断一律走 stderr（铁律 11，绝不静默）
#           末行 stderr 固定为 [D1061-SELECT] 机器可读摘要（含 selected_of_total / degraded）
#   @exit   0 = 选择成功（**可能含显式降级回退全量**）
#           1 = 业务失败（映射非法 **且** 全量兜底源亦不可用）→ fail-closed，无输出
#           2 = 执行失败（参数非法 / python 不可用 / 映射文件缺失且兜底源缺失）
#   @degraded（一律 stderr 打 [D1061-DEGRADED] + 落 degraded-events.log + 回退全量）:
#           D1 映射文件缺失      D2 映射 JSON 非法 / python 解析失败
#           D3 变更集为空        D4 无域命中（选择 0 条）
#           D5 变更范围不可解析  D6 变更路径未命中任何规则（fail-closed，绝不静默缩小）
#           语义：**任何无法安全判定影响面的情形 → 全量**；绝不返回 0 条静默通过。
#   @platform —— windows = 变更相关 ∪ platform_sensitive.windows；
#                其他平台不裁剪（ubuntu 为基线，保持全量）。
#   @fallback —— 全量兜底源 = ci.yml `control-tower-tests` job 的 for 清单（单源，不散列）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT=""
MAP=""
RANGE=""
CHANGED_FILES=""
SHARD=""
PLATFORM="any"
MODE=""
DEGLOG=""
DEG_COUNT=0

usage() {
  echo "用法: bash scripts/control-tower/ct-suite-select.sh <模式> [选项]"
  echo "  --changed <base>...<head>   变更范围（git 三段点）"
  echo "  --changed-files <file|->    直接给定变更文件清单（一行一个；- = stdin）"
  echo "                              —— 判定逻辑的**确定性注入缝**（夹具用，绕开 git 范围解析）"
  echo "  --shard <i>/<n>             只输出第 i 个分片（1<=i<=n；D1061-A3 windows 三分片）"
  echo "  --platform <any|ubuntu|windows|macos>"
  echo "  --list | --all              二选一（与 --changed/--changed-files 互斥）"
  echo "  --map <path> / --repo <path> / --degraded-log <path>"
}

while [ $# -gt 0 ]; do
  case "${1:-}" in
    --changed)      RANGE="${2:-}"; shift 2 ;;
    --changed-files) CHANGED_FILES="${2:-}"; shift 2 ;;
    --shard)        SHARD="${2:-}"; shift 2 ;;
    --platform)     PLATFORM="${2:-}"; shift 2 ;;
    --list)         MODE="list"; shift ;;
    --all)          MODE="all"; shift ;;
    --map)          MAP="${2:-}"; shift 2 ;;
    --repo)         ROOT="${2:-}"; shift 2 ;;
    --degraded-log) DEGLOG="${2:-}"; shift 2 ;;
    -h|--help)      usage; exit 0 ;;
    *) echo "❌ 未知参数: ${1:-}" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$ROOT" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
[ -z "$MAP" ] && MAP="$ROOT/scripts/control-tower/ct-suite-map.json"
[ -z "$DEGLOG" ] && DEGLOG="$ROOT/.codex/control-tower/logs/degraded-events.log"

degraded() {  # $1=code  $2=reason
  DEG_COUNT=$((DEG_COUNT + 1))
  echo "[D1061-DEGRADED] code=$1 reason=$2 → **回退全量**（fail-closed，绝不静默缩小）" >&2
  mkdir -p "${DEGLOG%/*}" 2>/dev/null || true
  printf '{"time":"%s","component":"ct-suite-select","code":"%s","reason":"%s","action":"fallback-full"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$DEGLOG" 2>/dev/null || true
}

# ── 全量兜底源：ci.yml control-tower-tests job 的 for 清单（单源，同 simulate-ci.sh 口径）──
full_list() {
  [ -f "$ROOT/.github/workflows/ci.yml" ] || return 1
  awk '/for t in \\/,/do$/' "$ROOT/.github/workflows/ci.yml" 2>/dev/null | grep -oE 'tests/[A-Za-z0-9_./-]+\.test\.(sh|py)' | sort -u || true
}

TOTAL="$(full_list | grep -c . | tr -d ' \n\r' || true)"
TOTAL="${TOTAL:-0}"

if [ "$TOTAL" -eq 0 ]; then
  echo "❌ fail-closed: ci.yml 未提取到密封清单（$ROOT/.github/workflows/ci.yml）——无全量兜底源，拒绝输出" >&2
  exit 2
fi

# ── PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）──
PYBIN=""
for _c in python3 python py; do  # D520: 三级探测 python3/python/py（见 PLATFORM-CHECKLIST.md #1）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

MAP_OK=1
MAP_TSV=""
if [ ! -f "$MAP" ]; then
  MAP_OK=0
elif [ -z "$PYBIN" ]; then
  echo "❌ 执行失败: python 不可用（python3/python/py 三级探测均失败）——无法解析映射 $MAP" >&2  # D520: 文案含字面量（非调用）
  exit 2
else
  MAP_TSV="$("$PYBIN" -c '
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    d = json.load(fh)
for dom in sorted(d.get("domains", {})):
    print("DOMDEF\t%s" % dom)
for dom, suites in sorted(d.get("domains", {}).items()):
    for s in suites:
        print("DOM\t%s\t%s" % (dom, s))
for i, r in enumerate(d.get("rules", [])):
    print("RULE\t%d\t%s\t%s" % (i, r.get("glob", ""), ",".join(r.get("domains", []))))
for plat, suites in sorted(d.get("platform_sensitive", {}).items()):
    if isinstance(suites, list):
        for s in suites:
            print("PLAT\t%s\t%s" % (plat, s))
_sh = d.get("shards", {})
if isinstance(_sh, dict) and isinstance(_sh.get("assign"), dict):
    print("SHARDKEY\tcount\t%s" % _sh.get("count", ""))
    for sid, suites in sorted(_sh["assign"].items()):
        for s in suites:
            print("SHARD\t%s\t%s" % (sid, s))
' "$MAP" 2>/dev/null)" || MAP_OK=0
  # PLATFORM-CHECKLIST #2（CRLF 清洗）: Windows 上 python 文本模式把 print 的 \n 写成 \r\n，
  #   尾 \r 会留在 IFS=tab 的**最后一个字段**（域名）⇒ DOM 查表落空 ⇒ 退化成全量回退。
  #   2026-09-29 CI windows 实证：本卡首推 ct-suite-select.test.sh 4 条断言连带红，签名
  #   「正常路径 3 条 / D4 回退」；本机用 PATH 前置 python3 shim（stdout 追加 \r）**逐字复现**。
  MAP_TSV="$(printf '%s\n' "$MAP_TSV" | tr -d '\r')"
  [ -z "$MAP_TSV" ] && MAP_OK=0
fi

# ── --list: 只读打印映射表 ──
if [ "$MODE" = "list" ]; then
  if [ "$MAP_OK" -eq 0 ]; then
    echo "❌ fail-closed: 映射缺失或非法（${MAP}）——--list 无内容可打印" >&2
    exit 1
  fi
  echo "# ct-suite-select --list | map=$MAP | total=$TOTAL"
  printf '%s\n' "$MAP_TSV" | awk -F'\t' '$1=="DOM"{print "  DOMAIN " $2 " :: " $3}'
  printf '%s\n' "$MAP_TSV" | awk -F'\t' '$1=="RULE"{print "  RULE[" $2 "] " $3 " -> " $4}'
  printf '%s\n' "$MAP_TSV" | awk -F'\t' '$1=="PLAT"{print "  PLATFORM " $2 " :: " $3}'
  printf '%s\n' "$MAP_TSV" | awk -F'\t' '$1=="SHARD"{print "  SHARD " $2 " :: " $3}'
  printf '%s\n' "$MAP_TSV" | awk -F'\t' '$1=="SHARDKEY"{print "  SHARDKEY " $2 " " $3}'
  echo "[D1061-SELECT] mode=list platform=$PLATFORM changed=0 selected_of_total=${TOTAL}/${TOTAL} degraded=$DEG_COUNT"
  exit 0
fi

# ── --all: 全量清单，不选 ──
if [ "$MODE" = "all" ]; then
  full_list
  echo "[D1061-SELECT] mode=all platform=$PLATFORM changed=0 selected_of_total=${TOTAL}/${TOTAL} degraded=$DEG_COUNT" >&2
  exit 0
fi

if [ -z "$MODE" ] && [ -z "$RANGE" ] && [ -z "$CHANGED_FILES" ]; then
  echo "❌ 参数非法: 需显式给出 --changed / --changed-files / --list / --all 之一（禁隐式默认）" >&2
  usage >&2
  exit 2
fi

# ── 选择模式 ──
# ① 变更集（两种来源：--changed-files 注入缝优先 → 全平台确定性；否则 git 三段点）
if [ -n "$CHANGED_FILES" ]; then
  if [ "$CHANGED_FILES" = "-" ]; then
    CHANGED_RAW="$(cat)"
  elif [ -f "$CHANGED_FILES" ]; then
    CHANGED_RAW="$(cat "$CHANGED_FILES")"
  else
    degraded D5 "变更文件清单不存在: ${CHANGED_FILES}（--changed-files 需指向文件或 -）"
    CHANGED_RAW="__RANGE_BAD__"
  fi
  CHANGED="$(printf '%s\n' "$CHANGED_RAW" | tr -d '\r')"
elif [ -z "$RANGE" ]; then
  CHANGED=""
else
  # PLATFORM-CHECKLIST #3: core.quotepath=false（中文文件名不被八进制转义）
  CHANGED_RAW="$(git -C "$ROOT" -c core.quotepath=false diff --name-only "$RANGE" 2>&1)"
  GIT_RC=$?
  CHANGED="$(printf '%s\n' "$CHANGED_RAW" | tr -d '\r')"
  if [ "$GIT_RC" -ne 0 ]; then
    degraded D5 "变更范围不可解析: ${RANGE} (git diff rc=${GIT_RC})"
    CHANGED="__RANGE_BAD__"
  fi
fi

if [ "$CHANGED" = "__RANGE_BAD__" ]; then
  full_list; echo "[D1061-SELECT] shard=${SHARD:-any} mode=select platform=$PLATFORM changed=0 selected_of_total=${TOTAL}/${TOTAL} degraded=$DEG_COUNT" >&2; exit 0
fi
if [ -z "$CHANGED" ]; then
  degraded D3 "变更集为空（range='${RANGE:-<未给>}'）——0 条静默通过被禁"
  full_list; echo "[D1061-SELECT] shard=${SHARD:-any} mode=select platform=$PLATFORM changed=0 selected_of_total=${TOTAL}/${TOTAL} degraded=$DEG_COUNT" >&2; exit 0
fi

CHANGED_N="$(printf '%s\n' "$CHANGED" | grep -c . | tr -d '\n\r')"
CHANGED_N="${CHANGED_N:-0}"

# ② 规则匹配（首个命中生效；__FULL__ ⇒ 全量；未命中 ⇒ D6 全量）
MATCHED=""
FORCE_FULL=0
RULE_COUNT="$(printf '%s\n' "$MAP_TSV" | grep -c '^RULE' | tr -d '\n\r')"
RULE_COUNT="${RULE_COUNT:-0}"

if [ "$MAP_OK" -eq 0 ]; then
  degraded D1 "映射缺失或非法: ${MAP}（MAP_OK=0）"
  FORCE_FULL=1
elif [ "$RULE_COUNT" -eq 0 ]; then
  degraded D2 "映射无 rules 段（${MAP}）——规则表为空，影响面不可判定"
  FORCE_FULL=1
else
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    HIT=""
    while IFS=$'\t' read -r tag idx glob doms; do
      [ "$tag" = "RULE" ] || continue
      [ -z "$glob" ] && continue
      if [[ "$path" == $glob ]]; then HIT="$doms"; break; fi
    done <<< "$MAP_TSV"
    if [ -z "$HIT" ]; then
      degraded D6 "变更路径未命中任何规则: $path"
      FORCE_FULL=1
    elif [ "$HIT" = "__FULL__" ]; then
      FORCE_FULL=1
    else
      MATCHED="${MATCHED}${HIT}"$'\n'
    fi
  done <<< "$CHANGED"
fi

if [ "$FORCE_FULL" -eq 1 ]; then
  full_list
  echo "[D1061-SELECT] shard=${SHARD:-any} mode=select platform=$PLATFORM changed=$CHANGED_N selected_of_total=${TOTAL}/${TOTAL} degraded=$DEG_COUNT" >&2
  exit 0
fi

# ③ 域 → 套件（**未定义域** ⇒ D2 fail-closed 全量；**已定义但空域** ⇒ 计 0 条，走 D4）
SEL=""
while IFS= read -r dom; do
  [ -z "$dom" ] && continue
  if ! printf '%s\n' "$MAP_TSV" | grep -qxF "DOMDEF"$'\t'"$dom"; then
    degraded D2 "规则引用了未定义域: ${dom}（${MAP}）"
    FORCE_FULL=1
    break
  fi
  SEL="${SEL}$(printf '%s\n' "$MAP_TSV" | awk -F'\t' -v d="$dom" '$1=="DOM" && $2==d {print $3}')"$'\n'
done <<< "$MATCHED"

if [ "$FORCE_FULL" -eq 1 ]; then
  full_list
  echo "[D1061-SELECT] shard=${SHARD:-any} mode=select platform=$PLATFORM changed=$CHANGED_N selected_of_total=${TOTAL}/${TOTAL} degraded=$DEG_COUNT" >&2
  exit 0
fi

# ④ 平台敏感并集（windows）
if [ "${PLATFORM:-any}" = "windows" ]; then
  PLAT_HITS="$(printf '%s\n' "$MAP_TSV" | awk -F'\t' '$1=="PLAT" && $2=="windows" {print $3}')"
  if [ -z "$PLAT_HITS" ]; then
    degraded D2 "platform_sensitive.windows 缺失（${MAP}）——windows 敏感子集不可判定"
    FORCE_FULL=1
  else
    SEL="${SEL}${PLAT_HITS}"$'\n'
  fi
fi

if [ "$FORCE_FULL" -eq 1 ]; then
  full_list
  echo "[D1061-SELECT] shard=${SHARD:-any} mode=select platform=$PLATFORM changed=$CHANGED_N selected_of_total=${TOTAL}/${TOTAL} degraded=$DEG_COUNT" >&2
  exit 0
fi

# ④b 分片过滤（D1061-A3）—— `<i>/<n>`，越界/格式错 ⇒ exit 2（fail-closed，不静默给空）
if [ -n "$SHARD" ]; then
  case "$SHARD" in
    */*) SH_I="${SHARD%%/*}"; SH_N="${SHARD##*/}" ;;
    *) echo "❌ 参数非法: --shard 需形如 <i>/<n>，收到 '${SHARD}'" >&2; exit 2 ;;
  esac
  case "$SH_I" in ''|*[!0-9]*) echo "❌ 参数非法: 分片序号非数字: '${SH_I}'" >&2; exit 2 ;; esac
  case "$SH_N" in ''|*[!0-9]*) echo "❌ 参数非法: 分片总数非数字: '${SH_N}'" >&2; exit 2 ;; esac
  if [ "$SH_N" -lt 1 ] || [ "$SH_I" -lt 1 ] || [ "$SH_I" -gt "$SH_N" ]; then
    echo "❌ 参数非法: --shard ${SHARD} 越界（要求 1<=i<=n 且 n>=1）" >&2; exit 2
  fi
  SH_MAP_N="$(printf '%s\n' "$MAP_TSV" | awk -F'\t' '$1=="SHARDKEY" && $2=="count" {print $3}' | head -1)"
  if [ -n "$SH_MAP_N" ] && [ "$SH_N" != "$SH_MAP_N" ]; then
    degraded D2 "分片总数与映射表不符: --shard n=${SH_N} vs map shards.count=${SH_MAP_N}"
    FORCE_FULL=1
  else
    SH_LIST="$(printf '%s\n' "$MAP_TSV" | awk -F'\t' -v i="$SH_I" '$1=="SHARD" && $2==i {print $3}')"
    if [ -z "$SH_LIST" ]; then
      degraded D2 "映射表无分片 ${SH_I} 的分配（${MAP}）"
      FORCE_FULL=1
    else
      SEL="$(printf '%s\n' "$SEL" | grep -xF -f <(printf '%s\n' "$SH_LIST") || true)"
      SH_SEL_N="$(printf '%s\n' "$SEL" | grep -c . || true)"
      echo "[D1061-SHARD] shard=${SH_I}/${SH_N} selected_in_shard=${SH_SEL_N:-0}" >&2
    fi
  fi
fi

# ⑤ 去重 + 存在性校验（选择集内的路径必须在仓库真实存在，否则 fail-closed）
SEL_OUT="$(printf '%s\n' "$SEL" | grep . | sort -u)"
SEL_N="$(printf '%s\n' "$SEL_OUT" | grep -c . | tr -d '\n\r')"
SEL_N="${SEL_N:-0}"

if [ "$SEL_N" -eq 0 ]; then
  degraded D4 "无域命中：选中 0 条（changed=${CHANGED_N}）——0 条静默通过被禁"
  full_list
  echo "[D1061-SELECT] shard=${SHARD:-any} mode=select platform=$PLATFORM changed=$CHANGED_N selected_of_total=${TOTAL}/${TOTAL} degraded=$DEG_COUNT" >&2
  exit 0
fi

MISSING=""
while IFS= read -r s; do
  [ -z "$s" ] && continue
  [ -f "$ROOT/$s" ] || MISSING="${MISSING} $s"
done <<< "$SEL_OUT"
if [ -n "$MISSING" ]; then
  degraded D2 "选中套件在仓库不存在:${MISSING}"
  full_list
  echo "[D1061-SELECT] shard=${SHARD:-any} mode=select platform=$PLATFORM changed=$CHANGED_N selected_of_total=${TOTAL}/${TOTAL} degraded=$DEG_COUNT" >&2
  exit 0
fi

printf '%s\n' "$SEL_OUT"
echo "[D1061-SELECT] shard=${SHARD:-any} mode=select platform=$PLATFORM changed=$CHANGED_N selected_of_total=${SEL_N}/${TOTAL} degraded=$DEG_COUNT" >&2
exit 0
