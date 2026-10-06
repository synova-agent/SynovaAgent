#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-ontology-fields.sh — D1174 (#1015 G-1): ontology 边类型关键字段回归防线
#
# 背景: #987/#988 给 extensions/ontology/edge-types/** 补齐 action_effect_lag 与
#   transfer_function（55/55），但当时判据脚本只能落在 /tmp（落区外）⇒ **无仓库内
#   回归防线**——这 110 个字段值可被任何后续 PR 静默改坏（卡 #1015 G-1，CTO 复核为真）。
#
# 契约（铁律 47）:
#   @input  — 扫描目录（默认 $ROOT/extensions/ontology/edge-types，SYNO_EDGE_TYPES_DIR
#             注入缝覆盖，测试沙箱隔离用；生产不设 = 行为不变）
#             必查字段集（冻结）: action_effect_lag, transfer_function
#             （新增必查字段 = 判据变更 ⇒ 提案 → K3 → CTO）
#   @output — stdout 逐项: ✅ 每文件两字段存在且值非空 / ❌ 逐文件逐字段点名
#             （缺字段 vs 值为空串分开点名）；结尾汇总「检查 N 件 / 违规 M 件」
#   @exit   — 0 = 全部通过
#             1 = 存在违规（字段缺失或值为空串）
#             2 = 检查自身失败（目录不存在 / 无 *.json / python 不可用）—— fail-closed
#   @degraded — 无（本检查纯本地文件扫描，无网络/无 git 依赖；任何环境失败即 exit 2）
#
# 判别性（改坏即红，卡 #1015 G-1 Done 原文）:
#   删任一 edge-type 的 action_effect_lag ⇒ exit 1；改回 ⇒ exit 0。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EDGE_DIR="${SYNO_EDGE_TYPES_DIR:-$ROOT/extensions/ontology/edge-types}"

FIELDS="action_effect_lag transfer_function"

# PLATFORM-CHECKLIST #1: PYBIN 三级探测（禁裸 python3）
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then
  echo "❌ 检查执行失败: python 不可用（fail-closed，不与通过混同）" >&2
  exit 2
fi
if [ ! -d "$EDGE_DIR" ]; then
  echo "❌ 检查执行失败: 目录不存在: ${EDGE_DIR}（fail-closed）" >&2
  exit 2
fi

"$PYBIN" - "$EDGE_DIR" $FIELDS <<'PYEOF'
import json, os, sys

edge_dir, fields = sys.argv[1], sys.argv[2:]
try:
    names = sorted(n for n in os.listdir(edge_dir) if n.endswith(".json"))
except OSError as e:
    print(f"❌ 检查执行失败: 无法列出目录: {e}（fail-closed）")
    sys.exit(2)
if not names:
    print(f"❌ 检查执行失败: {edge_dir} 下零 *.json（fail-closed——目录搬走/挂载失败不是通过）")
    sys.exit(2)

bad = 0
for n in names:
    p = os.path.join(edge_dir, n)
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"❌ {n}: JSON 解析失败: {e}")
        bad += 1
        continue
    if not isinstance(d, dict):
        print(f"❌ {n}: 顶层不是 JSON 对象")
        bad += 1
        continue
    for fld in fields:
        if fld not in d:
            print(f"❌ {n}: 缺字段 {fld}")
            bad += 1
        elif not isinstance(d[fld], str) or not d[fld].strip():
            print(f"❌ {n}: 字段 {fld} 值为空")
            bad += 1

total = len(names)
if bad:
    print(f"── 汇总: 检查 {total} 件，违规 {bad} 处（字段集: {', '.join(fields)}）")
    sys.exit(1)
print(f"✅ 全部 {total} 件边类型关键字段齐全（{', '.join(fields)}）")
sys.exit(0)
PYEOF
rc=$?
exit $rc
