#!/usr/bin/env bash
# capture-980-probe.sh — #980 / 施工项 0-6 判据 V1 的**复跑包装**
#
# 干什么（一条命令拿到 V1 全部原始证据）：
#   1) 跑前记基线：git status --porcelain（原文）+ 6 个 extensions/industries/*/thresholds.json 的 sha256
#   2) 跑探针 probe-diagnosis.ts（真 SQLite，库落 %TEMP% // /tmp，跑完删；仓库内零建库）
#      再跑一次 --json（判据 V2 的交叉核对形态）
#   3) 跑后再记同一组基线，并**逐字比对**（R28 地雷纪律）
#   4) 把探针 stdout+stderr 原文存盘（仓库外，不污染 git status）+ 打印
#
# 搬移说明（同 probe-diagnosis.ts）：本脚本与探针同目录；搬到 scripts/control-tower/ 后
#   无需改任何路径 —— 仓库根走 `git rev-parse --show-toplevel`，探针走 `BASH_SOURCE` 同目录。
#
# 契约（铁律 47）
#   @input    — 环境变量 SYNO_980_OUT（输出目录，默认 ${TMPDIR:-/tmp}/synova-980-probe-out）
#   @output   — stdout：基线前后原文 + 比对结论 + 探针完整原文 + 输出落点
#   @degraded — git 根/探针缺失 → FATAL + exit 2；thresholds.json 命中数 ≠ 6 → 显式 WARN（不静默）
#   @exit     — 探针退出码原样透传（0 = 探针跑通；2 = 真库不可用；3 = 读回/nodeId 形态失败）
#
# 本脚本不产生「通过/不通过」结论：它只搬运原始证据。判定权归收件闸 + K3。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"
if [ -z "${REPO_ROOT:-}" ]; then
  echo "FATAL: 无法解析仓库根（git rev-parse --show-toplevel 失败）" >&2
  exit 2
fi

PROBE="$SCRIPT_DIR/probe-diagnosis.ts"
if [ ! -f "$PROBE" ]; then
  echo "FATAL: 探针不存在: $PROBE" >&2
  exit 2
fi

OUT_ROOT="${SYNO_980_OUT:-${TMPDIR:-/tmp}/synova-980-probe-out}"
RUN_DIR="$OUT_ROOT/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN_DIR" || { echo "FATAL: 无法创建输出目录 $RUN_DIR" >&2; exit 2; }

THRESHOLD_GLOB='extensions/industries/*/thresholds.json'
EXPECTED_THRESHOLDS=6

echo "探针        : $PROBE"
echo "仓库根      : $REPO_ROOT"
echo "输出落点    : $RUN_DIR  （仓库外，避免污染 git status）"
echo "时间        : $(date '+%Y-%m-%d %H:%M:%S')"

snapshot() {
  local tag="$1"
  local stfile="$RUN_DIR/status-$tag.txt"
  local hfile="$RUN_DIR/hashes-$tag.txt"
  local n

  echo
  echo "════════ [$tag] git status --porcelain（原文） ════════"
  git -C "$REPO_ROOT" status --porcelain > "$stfile" 2>&1
  if [ -s "$stfile" ]; then cat "$stfile"; else echo "(空 — 工作树干净)"; fi

  echo "════════ [$tag] ${EXPECTED_THRESHOLDS} x thresholds.json sha256（原文） ════════"
  ( cd "$REPO_ROOT" && sha256sum $THRESHOLD_GLOB ) > "$hfile" 2>&1
  cat "$hfile"
  n="$(wc -l < "$hfile" | tr -d ' \r')"
  if [ "$n" -ne "$EXPECTED_THRESHOLDS" ]; then
    echo "WARN: thresholds.json 命中 $n 个（期望 $EXPECTED_THRESHOLDS）— 基线口径变化，须人工确认（不静默）"
  fi
}

snapshot before

echo
echo "════════ 探针运行 1/2：人读形态（npx tsx，临时 SQLite 落 %TEMP%）════════"
( cd "$REPO_ROOT" && npx tsx "$PROBE" ) 2>&1 | tee "$RUN_DIR/probe-output.txt"
PROBE_EXIT="${PIPESTATUS[0]}"
echo "── 探针退出码 = $PROBE_EXIT"

echo
echo "════════ 探针运行 2/2：--json 形态（判据 V2 交叉核对）════════"
( cd "$REPO_ROOT" && npx tsx "$PROBE" --json ) > "$RUN_DIR/probe-output.json" 2>&1
JSON_EXIT=$?
cat "$RUN_DIR/probe-output.json"
echo "── 探针 --json 退出码 = $JSON_EXIT"

snapshot after

echo
echo "════════ R28 地雷基线：跑前 / 跑后逐字比对 ════════"
if diff -u "$RUN_DIR/status-before.txt" "$RUN_DIR/status-after.txt" > "$RUN_DIR/status-diff.txt"; then
  echo "git status 前后：逐字一致（0 差异）"
else
  echo "git status 前后：**不一致** — diff 原文如下："
  cat "$RUN_DIR/status-diff.txt"
fi
if diff -u "$RUN_DIR/hashes-before.txt" "$RUN_DIR/hashes-after.txt" > "$RUN_DIR/hashes-diff.txt"; then
  echo "${EXPECTED_THRESHOLDS} 个 thresholds.json sha256 前后：逐字一致（${EXPECTED_THRESHOLDS}/${EXPECTED_THRESHOLDS}）"
else
  echo "${EXPECTED_THRESHOLDS} 个 thresholds.json sha256 前后：**不一致** — diff 原文如下："
  cat "$RUN_DIR/hashes-diff.txt"
fi

echo
echo "════════ 判据 V1 的 grep 形态跑在**本次原文**上（辅助证据，非结论）════════"
if grep -q '未覆盖类型' "$RUN_DIR/probe-output.txt"; then
  echo "V1-登记原文 grep -q '未覆盖类型'            : 命中（exit 0）"
else
  echo "V1-登记原文 grep -q '未覆盖类型'            : 未命中（exit 1）"
fi
if grep -qE '未覆盖类型 [1-9]' "$RUN_DIR/probe-output.txt"; then
  echo "V1-加固     grep -qE '未覆盖类型 [1-9]'      : 命中（exit 0）"
else
  echo "V1-加固     grep -qE '未覆盖类型 [1-9]'      : 未命中（exit 1）"
fi

echo
echo "════════ 留痕 ════════"
echo "RUN_DIR                 = $RUN_DIR"
echo "探针原文（含 stderr）   = $RUN_DIR/probe-output.txt"
echo "探针 --json 原文        = $RUN_DIR/probe-output.json"
echo "git status 前/后        = $RUN_DIR/status-before.txt / $RUN_DIR/status-after.txt"
echo "thresholds 哈希前/后    = $RUN_DIR/hashes-before.txt / $RUN_DIR/hashes-after.txt"
echo "退出码（透传探针）      = $PROBE_EXIT"

exit "$PROBE_EXIT"
