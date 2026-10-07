#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-project-coordinates.sh — D1175 (#991): 坐标系防漂移校验器
#
# 背景: Project #1 的 7 字段坐标系（执行态/施工批次/服务承重件/总闸/命名空间/
#   验证级别/阻塞源）此前靠手工灌值；卡 #991 要求防漂移校验器（三态、禁降级放行），
#   且「先出预演报告再谈进 CI」。
#
# 契约（铁律 47）:
#   @input  — 模式二选一:
#               （默认）live: gh 列 open issues → 逐张解析【坐标系】块
#               --from-file <list.txt>（注入缝/单测）: 逐行 "<issue号><TAB><正文>"
#               （正文换行用 ⏎ 占位，与 gh --jq gsub 同协议）
#             选项: --enforce 发现漂移 ⇒ exit 1（默认预演模式只报告恒 exit 0）
#   @output — 逐 issue 一行: ✅ 七字段齐全 / ⚠️ 缺字段点名 / ❌ 无【坐标系】块;
#             结尾汇总「检查 N / 齐全 X / 缺字段 Y / 无块 Z」
#   @exit   — 0 = 预演完成（不论漂移）或全齐全
#             1 = --enforce 且存在漂移（缺字段或无坐标系块）
#             2 = 检查自身失败（--from-file 不可读 / python 或 gh 不可用 /
#                 gh issue list 失败 / 解析器异常）—— fail-closed，**禁降级放行**
#                 （工具坏了 ≠ 全部齐全，卡 #991 明令）
#   @degraded — 无
#
# 红线（卡 #991）: 列 issue 显式 --limit 500（防默认截断）; 板侧对账走 GraphQL
#   totalCount（另卡接）——本卡先落 issue 正文侧漂移检测（预演报告）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

FIELDS="执行态 施工批次 服务承重件 总闸 命名空间 验证级别 阻塞源"

FROM_FILE=""
ENFORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from-file) shift; FROM_FILE="${1:-}" ;;
    --enforce)   ENFORCE=1 ;;
    *) echo "❌ check-project-coordinates: 未知参数 ${1}（exit 2）" >&2; exit 2 ;;
  esac
  shift
done

# PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3）
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -z "$PYBIN" ] && { echo "❌ 检查执行失败: python 不可用（exit 2，禁降级放行）" >&2; exit 2; }

INPUT="$(mktemp)"; DRIFT_FILE="$(mktemp)"
trap 'rm -f "$INPUT" "$DRIFT_FILE"' EXIT

if [ -n "$FROM_FILE" ]; then
  [ -r "$FROM_FILE" ] || { echo "❌ 检查执行失败: --from-file 不可读: ${FROM_FILE}（exit 2）" >&2; exit 2; }
  cp "$FROM_FILE" "$INPUT"
else
  command -v gh >/dev/null 2>&1 || { echo "❌ 检查执行失败: gh 不可用（exit 2，禁降级放行）" >&2; exit 2; }
  gh issue list -R synova-agent/SynovaAgent --state open --limit 500 \
    --json number,body --jq '.[] | "\(.number)\t\(.body | gsub("\n";"⏎"))"' > "$INPUT" 2>/dev/null \
    || { echo "❌ 检查执行失败: gh issue list 失败（exit 2，禁降级放行——含未登录/网络）" >&2; exit 2; }
fi

"$PYBIN" - "$INPUT" "$DRIFT_FILE" $FIELDS <<'PYEOF'
import re
import sys

inp, drift_out, fields = sys.argv[1], sys.argv[2], sys.argv[3:]
n_all = n_ok = n_miss = n_noblock = 0

for line in open(inp, encoding="utf-8"):
    line = line.rstrip("\n")
    if not line.strip():
        continue
    num, _, body = line.partition("\t")
    body = body.replace("⏎", "\n")
    n_all += 1
    m = re.search(r"【坐标系】(.*?)(?:\n\s*\n|\Z)", body, re.S)
    if not m:
        n_noblock += 1
        print(f"❌ #{num}: 无【坐标系】块")
        continue
    got = set()
    for ln in m.group(1).splitlines():
        mm = re.match(r"\s*(" + "|".join(map(re.escape, fields)) + r")\s*[:：]\s*\S", ln)
        if mm:
            got.add(mm.group(1))
    missing = [f for f in fields if f not in got]
    if missing:
        n_miss += 1
        print(f"⚠️ #{num}: 缺字段 {'、'.join(missing)}")
    else:
        n_ok += 1
        print(f"✅ #{num}: 七字段齐全")

print(f"── 汇总: 检查 {n_all} / 齐全 {n_ok} / 缺字段 {n_miss} / 无块 {n_noblock}")
open(drift_out, "w", encoding="utf-8").write(str(n_miss + n_noblock))
PYEOF
PY_RC=$?
[ "$PY_RC" -ne 0 ] && { echo "❌ 检查执行失败: 解析器异常 rc=${PY_RC}（exit 2，禁降级放行）" >&2; exit 2; }

DRIFT_N="$(tr -d '[:space:]' < "$DRIFT_FILE")"; DRIFT_N="${DRIFT_N:-0}"

if [ "$ENFORCE" -eq 1 ]; then
  if [ "$DRIFT_N" -gt 0 ] 2>/dev/null; then
    echo "❌ enforce: 存在 ${DRIFT_N} 张漂移（缺字段/无坐标系块）——exit 1"
    exit 1
  fi
  echo "✅ enforce: 全部齐全"
  exit 0
fi
echo "（预演模式: 只报告不判红; --enforce 转阻断——进 CI 前先经 CTO 批（卡 #991））"
exit 0
