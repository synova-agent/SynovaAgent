#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-naming-authority.sh — 命名权威门禁（#990 / D1142）· **先软后硬**
#
# 输入规格（院方《命名权威登记册》§五，本线只落地执法；规格本体见
#   ~/山河研究院/04-技术研究/专题研究/CTO委托-基座治理/命名权威登记册.md §五）:
#   C1 循环配置 edgeRefs/edgeId 值 ∈ 本体边 $id ∪ label ∪ 映射表
#   C2 哨兵 *-sentinel.ts 的导出必须能被装载器取到（**不许靠推导键**）
#   C3 新增业务表必须有租户列（白名单除外，白名单须注明理由）
#   C4 本体类型无 schema 时必须进「未覆盖类型」显式清单（不得静默放行）
#   C5 feedback_log 信号键与阈值配置键必须同源
#
# 🔴 上线纪律（卡面红线）: **不许一步到位设必过**（会同时卡所有在飞 PR）⇒
#   默认 = **informational**（打印违规 + 计数，**恒 exit 0**）；转阻断须 CTO 裁
#   （`--blocking` 或 `SYNO_NAMING_BLOCK=1` 才 exit 1）。CI 侧先只跑夹具，不设必过 step。
#
# 契约（铁律 47）:
#   @input  — --root <dir>（仓库根；测试注入缝 SYNO_NAMING_ROOT 同义）
#             --blocking（违规 ⇒ exit 1）｜ --quiet（只打汇总行）
#   @output — 逐条 `C<n> file:line:内容` + 每检查计数 + 末行机器可读汇总:
#               NAMING_AUTHORITY_SUMMARY: c1=<唯一违规数> c1_occ=<出现次数> c2=<违规文件数>
#                                        c3_zero_tenant=<零租户表数>/<表数> c4_uncovered=<未覆盖类型数>
#                                        c5=<违规处数> mode=<informational|blocking>
#   @exit   — 0 = 通过（或 informational 模式恒 0）｜ 1 = 有违规（仅 blocking 模式）
#             2 = **检查自身失败**（扫描源缺失 / git 不可用等，fail-closed，不与通过混同）
#   @degraded — 命名检查**不允许降级放行**：判不了 ⇒ exit 2（规格明文）
#
# 平台（PLATFORM-CHECKLIST 9 条）: 纯 git + grep -E + awk + 纯 bash；无 python、无 grep -P、
#   无 sed -i、无 date -d；所有临时文件走 mktemp。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT_OVERRIDE=""
BLOCKING=0
QUIET=0
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --root)     shift; ROOT_OVERRIDE="${1:-}" ;;
    --root=*)   ROOT_OVERRIDE="${1#--root=}" ;;
    --blocking) BLOCKING=1 ;;
    --quiet|-q) QUIET=1 ;;
    -h|--help)
      echo "用法: bash check-naming-authority.sh [--root <dir>] [--blocking] [--quiet]"
      echo "默认 informational（恒 exit 0，只报告）；--blocking 才有违规即 exit 1。"
      exit 0 ;;
    *) echo "未知参数: ${1:-}" >&2; exit 2 ;;
  esac
  shift
done
[ "${SYNO_NAMING_BLOCK:-0}" = "1" ] && BLOCKING=1

if [ -n "$ROOT_OVERRIDE" ]; then ROOT="$(cd "$ROOT_OVERRIDE" && pwd)"; else
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; fi
[ -d "$ROOT" ] || { echo "degraded: root 不存在: $ROOT (code=NAM_ROOT)" >&2; exit 2; }

# 扫描源（缺任一 ⇒ exit 2：命名检查不允许降级放行）
CYCLES_DIR="$ROOT/cycles"
ONTOLOGY_DIR="$ROOT/extensions/ontology"
SRC_DIR="$ROOT/src"
for d in "$CYCLES_DIR" "$ONTOLOGY_DIR" "$SRC_DIR"; do
  [ -d "$d" ] || { echo "degraded: 扫描源缺失: $d (code=NAM_SRC, phase=locate)" >&2; exit 2; }
done

say() { [ "$QUIET" = "1" ] || echo "$1"; }

# ═══ 权威集：本体边 $id（edge/snake）∪ label（UPPER）∪ 映射表键 ═══
AUTH="$ROOT/.claude/.naming-authority.tmp"
mkdir -p "$(dirname "$AUTH")" 2>/dev/null || true
{
  grep -rhoE '"\$id"[[:space:]]*:[[:space:]]*"edge/[a-z0-9_]+"' "$ONTOLOGY_DIR" 2>/dev/null | sed 's/.*"edge\//edge\//; s/"$//'  # swallow-ok: 无匹配=正常空集（#1023 ①）
  grep -rhoE '"label"[[:space:]]*:[[:space:]]*"[A-Z0-9_]+"' "$ONTOLOGY_DIR" 2>/dev/null | sed 's/.*:[[:space:]]*"//; s/"$//'  # swallow-ok: 无匹配=正常空集（#1023 ①）
  # 映射表（edge-consumption-map.json）：键与值都算权威（label 形态）
  if [ -f "$ONTOLOGY_DIR/edge-consumption-map.json" ]; then
    grep -oE '"[A-Z][A-Z0-9_]{2,}"' "$ONTOLOGY_DIR/edge-consumption-map.json" | tr -d '"'
  fi
} | grep -v '^$' | sort -u > "$AUTH" || true
AUTH_N=$(wc -l < "$AUTH" | tr -d ' ')
[ "$AUTH_N" -gt 0 ] || { echo "degraded: 权威集为空（本体边未解析到 $id/label）(code=NAM_AUTH)" >&2; exit 2; }
say "命名权威集: ${AUTH_N} 项（\$id ∪ label ∪ 映射表）"

FAILS=0; REPORT=""

# ═══ C1: 循环配置的 edgeRefs/edgeId ∈ 权威集 ═══
# 口径（与院方基线对齐）: **唯一取值**数 = 违规数（c1）｜出现次数 = c1_occ。
#   仅取 edgeRefs 数组内字符串 与 edgeId 标量值（同行其它引号串如 "unit": "NPS" 不算）。
C1_UNIQ=0; C1_OCC=0; C1_LINES=""
C1_SEEN="$(mktemp)"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    ln="${hit%%:*}"
    vals=""
    case "$hit" in
      *'"edgeRefs"'*)
        vals="$(printf '%s' "$hit" | sed -nE 's/.*"edgeRefs"[[:space:]]*:[[:space:]]*\[([^]]*)\].*/\1/p' | grep -oE '"[^"]+"' | tr -d '"')" ;;
    esac
    if printf '%s' "$hit" | grep -q '"edgeId"'; then
      vals="${vals} $(printf '%s' "$hit" | sed -nE 's/.*"edgeId"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p')"
    fi
    for v in $vals; do
      [ -n "$v" ] || continue
      C1_OCC=$((C1_OCC + 1))
      if ! grep -qxF "$v" "$AUTH"; then
        if ! grep -qxF "$v" "$C1_SEEN"; then
          C1_UNIQ=$((C1_UNIQ + 1))
          printf '%s\n' "$v" >> "$C1_SEEN"
        fi
        C1_LINES="${C1_LINES}    C1 ${f#"$ROOT"/}:${ln}: ${v}（不在本体 \$id/label/映射表内）\n"
      fi
    done
  done <<< "$(grep -nE '"edgeRefs"|"edgeId"' "$f" 2>/dev/null || true)"
done <<< "$(find "$CYCLES_DIR" -name '*.cycle.json' 2>/dev/null | sort)"  # swallow-ok: 无 cycle 文件=正常空集
rm -f "$C1_SEEN" 2>/dev/null || true
if [ "$C1_UNIQ" -gt 0 ]; then
  say "❌ C1 循环因果边引用无效: ${C1_UNIQ} 个唯一取值（出现 ${C1_OCC} 次；院方基线 = 17 个唯一值）"
  [ "$QUIET" = "1" ] || printf '%b' "$C1_LINES" | head -20
  FAILS=$((FAILS + 1))
else
  say "✅ C1 循环因果边引用全部 ∈ 权威集（出现 ${C1_OCC} 次）"
fi
REPORT="${REPORT} c1=${C1_UNIQ} c1_occ=${C1_OCC}"

# ═══ C2: 哨兵导出必须能被装载器取到（不许靠推导键）═══
# 推导规则**照抄**装载器 src/sentinel/builtins.ts `filenameToExportKey`:
#   base = 文件名去掉 `-sentinel.ts`；key = base.replace(/-([a-z])/g, 大写)
#   ⇒ 装载器取 `mod[key]`；key 不存在 = 该哨兵**永远注册不上**（只 log.error）。
ADAPTERS_DIR="$SRC_DIR/sentinel/adapters"
C2_BAD=0; C2_LINES=""; C2_TOTAL=0
if [ -d "$ADAPTERS_DIR" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    C2_TOTAL=$((C2_TOTAL + 1))
    base="$(basename "$f" -sentinel.ts)"
    key="$(printf '%s' "$base" | awk -F- '{printf "%s", $1; for(i=2;i<=NF;i++){printf "%s%s", toupper(substr($i,1,1)), substr($i,2)}}')"
    if ! grep -qE "export[[:space:]]+(const|let|var|async function|function)[[:space:]]+${key}\b" "$f"; then
      C2_BAD=$((C2_BAD + 1))
      exports="$(grep -oE 'export[[:space:]]+(const|let|var|async function|function)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' "$f" | awk '{print $NF}' | tr '\n' ' ')"
      C2_LINES="${C2_LINES}    C2 ${f#"$ROOT"/}: 装载器推导键 '${key}' 未导出（实际: ${exports:-无}）\n"
    fi
  done <<< "$(find "$ADAPTERS_DIR" -maxdepth 1 -name '*-sentinel.ts' 2>/dev/null | sort)"  # swallow-ok: 无哨兵文件=正常空集
else
  say "⚠ C2 跳过: $ADAPTERS_DIR 不存在"
fi
if [ "$C2_BAD" -gt 0 ]; then
  say "❌ C2 哨兵导出与装载器推导键不一致: ${C2_BAD}/${C2_TOTAL} 个内建哨兵永远注册不上（院方基线 = 4）"
  [ "$QUIET" = "1" ] || printf '%b' "$C2_LINES"
  FAILS=$((FAILS + 1))
else
  say "✅ C2 哨兵导出与装载器推导键一致（${C2_TOTAL} 个内建）"
fi
REPORT="${REPORT} c2=${C2_BAD}"

# ═══ C3: 表必须有租户列（白名单除外）═══
C3_T=0; C3_ZERO=0; C3_LINES=""
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  f="${hit%%:*}"; rest="${hit#*:}"; ln="${rest%%:*}"
  tname="$(printf '%s' "$rest" | sed -nE 's/.*CREATE TABLE[[:space:]]+(IF NOT EXISTS[[:space:]]+)?[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?.*/\2/p')"
  [ -n "$tname" ] || continue
  C3_T=$((C3_T + 1))
  # 该表语句块（到该行起 40 行内）是否含租户列
  blk="$(sed -n "${ln},$((ln + 40))p" "$f" 2>/dev/null)"  # swallow-ok: 文件不可读=空块（下方按缺列计）
  case "$blk" in
    *org_id*|*enterprise_id*|*tenant_id*) : ;;
    *) C3_ZERO=$((C3_ZERO + 1)); C3_LINES="${C3_LINES}    C3 ${f#"$ROOT"/}:${ln}: 表 '${tname}' 未见租户列（org_id/enterprise_id/tenant_id）\n" ;;
  esac
done <<< "$(grep -rnE 'CREATE TABLE' "$SRC_DIR" "$ROOT/packages" 2>/dev/null | head -200)"  # swallow-ok: 无 CREATE TABLE=正常空集
if [ "$C3_ZERO" -gt 0 ]; then
  say "⚠ C3 疑似零租户列表: ${C3_ZERO}/${C3_T}（**信息性**：院方基线口径 = 26/32，取自我方未见清单 ⇒ 数字对齐须 CTO/K3 复核后转硬）"
  [ "$QUIET" = "1" ] || printf '%b' "$C3_LINES" | head -12
else
  say "✅ C3 扫描到的 ${C3_T} 张表均见租户列（与院方基线口径不同源，仅供参考）"
fi
REPORT="${REPORT} c3_zero_tenant=${C3_ZERO}/${C3_T}"

# ═══ C4: 无 schema 的本体类型必须显式可见（不得静默放行）═══
VALIDATOR="$SRC_DIR/l4/sog-schema-validator.ts"
C4_UNCOVERED=0; C4_HITS=0
if [ -f "$VALIDATOR" ]; then
  # 类型全集 = 三个本体类型目录下的 json（dir/name 形态）
  TYPES="$(find "$ONTOLOGY_DIR/activity" "$ONTOLOGY_DIR/outcome" "$ONTOLOGY_DIR/resource" -name '*.json' 2>/dev/null | sed -nE 's|.*/ontology/([a-z]+)/([a-z0-9_]+)\.json|\1/\2|p' | sort -u)"  # swallow-ok: 目录缺失=空集
  C4_ALL=$(printf '%s\n' "$TYPES" | grep -c . || true)
  SCHEMAS=$(grep -oE "^[[:space:]]{2}[A-Z][A-Z0-9_]{2,}[[:space:]]*:" "$VALIDATOR" 2>/dev/null | tr -d ' :' | sort -u | wc -l | tr -d ' ')  # swallow-ok: 无匹配=正常空集
  C4_UNCOVERED=$((C4_ALL))   # 斜杠类型与遗留大写 schema 不同命名空间 ⇒ 今日全部未覆盖
  C4_HITS=$(grep -cE 'if \(!schema\) return \[\]|return \[\]' "$VALIDATOR" 2>/dev/null | tr -d ' \r')
  say "⚠ C4 斜杠本体类型 ${C4_ALL} 个 ｜ 遗留大写 schema ${SCHEMAS} 个 ｜ 显式放行点（return []）= ${C4_HITS} 处"
  if [ "${C4_HITS:-0}" -gt 0 ]; then
    say "❌ C4 无 schema 类型被**静默放行**（$(grep -nE 'if \(!schema\) return \[\]' "$VALIDATOR" | head -1 | cut -c1-80)…）——应返回 degraded + log.warn，并进「未覆盖类型」显式清单"
    FAILS=$((FAILS + 1))
  fi
else
  say "⚠ C4 跳过: $VALIDATOR 不存在"
fi
REPORT="${REPORT} c4_uncovered=${C4_UNCOVERED} c4_silent_allow=${C4_HITS:-0}"

# ═══ C5: feedback_log 信号键 与 阈值配置键 同源 ═══
FBC="$SRC_DIR/growth/feedback-collector.ts"
C5=0; C5_LINES=""
if [ -f "$FBC" ]; then
  C5_HIT=$(grep -nE 'key: `\$\{[^}]+\}:\$\{[^}]+\}' "$FBC" 2>/dev/null | head -3)
  if [ -n "$C5_HIT" ]; then
    C5=$(printf '%s\n' "$C5_HIT" | grep -c . || true)
    C5_LINES="$(printf '%s\n' "$C5_HIT" | sed "s|^|    C5 ${FBC#"$ROOT"/}:|")"
  fi
fi
if [ "${C5:-0}" -gt 0 ]; then
  say "❌ C5 反馈信号键为**复合键**（阈值配置侧是哨兵 ID ⇒ 回写恒 miss）: ${C5} 处"
  [ "$QUIET" = "1" ] || printf '%s\n' "$C5_LINES"
  FAILS=$((FAILS + 1))
else
  say "✅ C5 未检出复合信号键"
fi
REPORT="${REPORT} c5=${C5:-0}"

MODE="informational"; [ "$BLOCKING" = "1" ] && MODE="blocking"
echo "NAMING_AUTHORITY_SUMMARY:${REPORT} mode=${MODE}"
rm -f "$AUTH" 2>/dev/null || true
if [ "$BLOCKING" = "1" ] && [ "$FAILS" -gt 0 ]; then exit 1; fi
exit 0
