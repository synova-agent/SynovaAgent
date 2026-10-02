#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-sentinel-type-net.sh — D752 哨兵类型网登记硬门禁
#
# 背景（质询 §一/欠账 D752, P1）: src/sentinel/types.ts 用静态 import type 做编译期
#   登记是**软约束**——不加也能跑，实测 8/45 未登记（cash-runway / revenue-health 等）
#   长期无人发现。本门禁把登记变硬：manifest 存在的活跃哨兵必须有对应类型登记，
#   缺失 → 非零退出 + 逐个点名（不许静默跳过）。
#
# 契约 (铁律 47):
#   @input  — 无参；读仓库真实状态（git root）。测试注入缝: SYNO_TYPE_NET_ROOT
#             覆盖仓库根（沙箱夹具用，生产忽略）。
#   @output — 逐行点名缺失登记的哨兵目录 + 总结行；全登记时输出计数 OK。
#   @exit   — 0 = 全部活跃哨兵已登记 / 1 = 存在缺失（业务阻断）/ 2 = 环境降级
#             （extensions/sentinels 或 src/sentinel/types.ts 不存在 = fail-closed）
#   @degraded — exit 2 + 显式原因（铁律 11/24：不静默当绿）
#
# 豁免规则（与 sentinel-loader.ts L71-73 加载口径**同源**——loader 跳过的一律不要求登记）:
#   1. shared/          — 工具库，不是哨兵（loader: `if (entry.name === 'shared') continue`）
#   2. _ 前缀目录        — 归档（_extinct 等；loader: `if (entry.name.startsWith('_')) continue`）。
#                          归档哨兵在 types.ts 中的存量 import 不受本门禁管辖（不要求删，也不算登记）。
#   3. 非目录条目        — manifest.json 等顶层文件不参与（loader 只扫目录）。
#   豁免的显式化要求（派单 §二-2）: 新增归档目录须以 `_` 前缀命名才被本门禁豁免——
#   归档不改名 = 门禁点名，倒逼归档动作显式化。
#
# 判定口径: types.ts 中存在 `extensions/sentinels/<name>/` 路径引用（带尾斜杠，
#   防 revenue-health 误匹配 revenue-health-2 类前缀碰撞）即视为已登记。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# macOS bash 3.2 locale 防御（windows-compat 同族坑，实测 2026-09-15）:
# 调用方传入无效 locale（ct-test-gate export LC_ALL=C.UTF-8——macOS 无此 locale）
# 会让 bash 3.2 对含中文的本脚本产生字节级解析错乱
# （实测: "SENTINELS_DIR" 变量名尾黏连坏字节 → unbound variable → 门禁假红）。
# 本脚本处理的数据全 ASCII（目录名/文件名/路径），C locale 字节级语义最稳；
# 中文仅存在于 echo 输出与注释——C locale 下原样字节透传（macOS bash 不转码）。
export LC_ALL=C
export LANG=C

ROOT="${SYNO_TYPE_NET_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

SENTINELS_DIR="$ROOT/extensions/sentinels"
TYPES_FILE="$ROOT/src/sentinel/types.ts"

# fail-closed: 输入不存在 = 环境降级（exit 2），不当作"无哨兵=绿"
if [ ! -d "$SENTINELS_DIR" ]; then
  echo "degraded: 哨兵目录不存在: ${SENTINELS_DIR}（fail-closed，不判绿）" >&2
  exit 2
fi
if [ ! -f "$TYPES_FILE" ]; then
  echo "degraded: 类型网文件不存在: ${TYPES_FILE}（fail-closed，不判绿）" >&2
  exit 2
fi

# 活跃哨兵清单（loader 同口径: 目录 + 排除 shared + 排除 _ 前缀）
ACTIVE_SENTINELS=$(cd "$SENTINELS_DIR" 2>/dev/null && ls -1 | while IFS= read -r e; do
  [ -d "$e" ] || continue          # 豁免 3: 非目录（manifest.json 等顶层文件）
  [ "$e" = "shared" ] && continue  # 豁免 1: 工具库
  case "$e" in (_*) continue ;; esac # 豁免 2: _ 前缀归档（_extinct 等；括号模式兼容 macOS bash 3.2）
  echo "$e"
done | sort -u)

if [ -z "$ACTIVE_SENTINELS" ]; then
  echo -e "${YELLOW}⚠ 无活跃哨兵目录 — 门禁空转（请确认路径）${RESET}" >&2
  exit 2
fi

MISSING=""
COUNT=0
while IFS= read -r name; do
  [ -z "$name" ] && continue
  COUNT=$((COUNT + 1))
  if ! grep -qF "extensions/sentinels/${name}/" "$TYPES_FILE"; then
    MISSING="${MISSING}  ${name}\n"
  fi
done <<< "$ACTIVE_SENTINELS"

if [ -n "$MISSING" ]; then
  echo -e "${RED}❌ D752 类型网硬门禁: 以下活跃哨兵未在 src/sentinel/types.ts 登记:${RESET}"
  echo -e "$MISSING"
  echo -e "  修法: 在 types.ts 类型网区补 import type（参考既有 _xxxCheck 模式），"
  echo -e "        或将哨兵目录归档为 _ 前缀（显式豁免）。禁止静默跳过。"
  exit 1
fi

echo -e "${GREEN}✅ D752 类型网硬门禁: ${COUNT} 个活跃哨兵全部已登记（src/sentinel/types.ts）${RESET}"
exit 0
