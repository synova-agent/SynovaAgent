#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

# D520/V5 平台敏感命令规避（PLATFORM-CHECKLIST.md #1）：**禁裸 python3** —— Windows 部分机器
#   无 python3.exe（仅 python / py -3）；损坏 shim 只探存在性会静默漏拦（D328/D513）。
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（本行含 PYBIN 标记供 D520 平台扫描识别）
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
[ -z "$PYBIN" ] && { echo "⚠ log-snapshot: python 不可用（python3/python/py 均不可用）— 显式降级" >&2; exit 2; }  # D520 铁律 11：不静默
# ═══════════════════════════════════════════════════════════════════════════════
# log-snapshot.sh — 门禁日志「有界快照 + 轮转」归档（D1070 / X30 M0②）
#
# 背景（X30落地启动令 §二 T2）: 三件门禁日志是 K3 审计可复跑的证据输入，但当前
#   ① 三件全部被 .gitignore 有意忽略（`*.log` + `.claude/gate-hits.log`），
#   ② 它们是 append-only（每次 commit 追加），一旦入 git 即复现 D1065 的合并瓶颈
#      ——GitHub 可合并性计算不尊重 merge=union，每个 PR 必须贴最新 main，单轮 CI ≈40 分钟。
#
# 创始人 2026-09-30 裁定: **有界快照 + 轮转，不进 git 主路径**。
#   本脚本＝该裁定的物理载体：快照落 `.codex/snapshots/`（`.gitignore:41` 已忽略，
#   写入不产生任何 git status 变更），保留份数有上限，单份有字节上限。
#
# 令中路径勘误（实测 2026-09-30）: 令点名 `.claude/degraded-events.log` 是**死文件**
#   （105 B，2026-08-21 后未再写）；活账本是 `.codex/control-tower/logs/degraded-events.log`
#   （2.4 MB，scripts/ 下 10 处写入）。本脚本默认取活账本，并把死文件作为独立一行显式标出。
#
# 契约（铁律 47）:
#   @input  — 子命令: snapshot（默认）| resolve
#             选项: --dry-run | --max-bytes <N> | --keep <N> | --rotate
#             环境变量（测试注入缝）:
#               SYNO_LOG_SNAPSHOT_DIR        快照根（默认 $ROOT/.codex/snapshots/log-archive）
#               SYNO_LOG_GATE_HITS           默认 $ROOT/.claude/gate-hits.log
#               SYNO_LOG_PRECOMMIT_FAILURES  默认 $ROOT/.claude/pre-commit-failures.log
#               SYNO_LOG_DEGRADED            默认 $ROOT/.codex/control-tower/logs/degraded-events.log
#               SYNO_LOG_DEAD_DEGRADED       默认 $ROOT/.claude/degraded-events.log（死文件检测位）
#   @output — stdout 每件一行 TSV: name<TAB>state<TAB>bytes<TAB>lines<TAB>snapshot<TSV>note
#             state ∈ ok|empty|missing|truncated|rotated|dead|dry-run
#             snapshot 子命令另写 <快照根>/index.json（全量重建的快照索引）
#   @degraded — 日志缺失/为空/超上限被截断/轮转因并发写被跳过 → stderr 显式告警，
#             stdout 行内 state 标记，**不静默**（铁律 11）
#   @error  — 用法错误 exit 1；快照目录不可写 exit 1；否则 0
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" && [[ -n "$ROOT" ]]; then
  :  # git 仓内 → 用该工作区根（注意: worktree 返回自身根；门禁日志按工作区分片）
else
  ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  echo "⚠ degraded: git 解析失败，ROOT 回退为 $ROOT" >&2
fi

CMD="snapshot"; DRY_RUN=0; ROTATE=0; MAX_BYTES=$((5 * 1024 * 1024)); KEEP=7
while [[ $# -gt 0 ]]; do
  case "$1" in
    snapshot|resolve) CMD="$1"; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --rotate)    ROTATE=1; shift ;;
    --root)      ROOT="${2:-}"; [[ -n "$ROOT" && -d "$ROOT" ]] || { echo "❌ --root 目录不存在: ${2:-}" >&2; exit 1; }; shift 2 ;;
    --max-bytes) MAX_BYTES="${2:-}"; shift 2 ;;
    --keep)      KEEP="${2:-}"; shift 2 ;;
    -h|--help)   sed -n '6,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "❌ 未知参数: $1" >&2; exit 1 ;;
  esac
done
[[ "$MAX_BYTES" =~ ^[0-9]+$ ]] || { echo "❌ --max-bytes 需为非负整数，得到: $MAX_BYTES" >&2; exit 1; }
[[ "$KEEP" =~ ^[0-9]+$ ]] || { echo "❌ --keep 需为非负整数，得到: $KEEP" >&2; exit 1; }

SNAPSHOT_DIR="${SYNO_LOG_SNAPSHOT_DIR:-$ROOT/.codex/snapshots/log-archive}"
GATE_HITS="${SYNO_LOG_GATE_HITS:-$ROOT/.claude/gate-hits.log}"
PRECOMMIT_FAILURES="${SYNO_LOG_PRECOMMIT_FAILURES:-$ROOT/.claude/pre-commit-failures.log}"
DEGRADED_LIVE="${SYNO_LOG_DEGRADED:-$ROOT/.codex/control-tower/logs/degraded-events.log}"
DEGRADED_DEAD="${SYNO_LOG_DEAD_DEGRADED:-$ROOT/.claude/degraded-events.log}"

# 三件归档对象（name 用于快照文件前缀；dead 位单独一行，不参与归档）
NAMES=(gate-hits pre-commit-failures degraded-events)
PATHS=("$GATE_HITS" "$PRECOMMIT_FAILURES" "$DEGRADED_LIVE")

_size()  { [[ -f "$1" ]] && wc -c < "$1" | tr -d ' ' || echo 0; }
_lines() { [[ -f "$1" ]] && wc -l < "$1" | tr -d ' ' || echo 0; }
_sha()   { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}';
           else sha256sum "$1" | awk '{print $1}'; fi; }
_now()   { date -u +%Y%m%dT%H%M%SZ; }

row() { printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" "$6"; }

# ── resolve / dry-run：只报现状，不写盘 ────────────────────────────────────────
if [[ "$CMD" == "resolve" || "$DRY_RUN" == "1" ]]; then
  echo "# 快照根: $SNAPSHOT_DIR"
  echo -e "# name\tstate\tbytes\tlines\tsnapshot\tnote"
  for i in "${!NAMES[@]}"; do
    f="${PATHS[$i]}"
    if [[ ! -f "$f" ]]; then
      echo "⚠ degraded: 日志缺失 ${NAMES[$i]} → $f" >&2
      row "${NAMES[$i]}" missing 0 0 "-" "路径不存在"
      continue
    fi
    b="$(_size "$f")"; l="$(_lines "$f")"
    if [[ "$b" -eq 0 ]]; then
      echo "⚠ degraded: 日志为空 ${NAMES[$i]} → $f" >&2
      row "${NAMES[$i]}" empty 0 0 "-" "0 字节"
    elif [[ "$b" -gt "$MAX_BYTES" ]]; then
      echo "⚠ degraded: 超上限将截尾 ${NAMES[$i]} ${b}B > ${MAX_BYTES}B" >&2
      row "${NAMES[$i]}" truncated "$b" "$l" "-" "将保留末 ${MAX_BYTES}B"
    else
      row "${NAMES[$i]}" dry-run "$b" "$l" "-" "计划快照"
    fi
  done
  if [[ -f "$DEGRADED_DEAD" ]]; then
    db="$(_size "$DEGRADED_DEAD")"
    row "degraded-events(旧路径/死文件)" dead "$db" "$(_lines "$DEGRADED_DEAD")" "-" "令中点名路径；活账本见上行"
  fi
  [[ "$DRY_RUN" == "1" || "$CMD" == "resolve" ]] && exit 0
fi

mkdir -p "$SNAPSHOT_DIR" || { echo "❌ 快照目录不可写: $SNAPSHOT_DIR" >&2; exit 1; }
TS="$(_now)"

for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"; f="${PATHS[$i]}"
  if [[ ! -f "$f" ]]; then
    echo "⚠ degraded: 跳过缺失日志 $name → $f" >&2
    row "$name" missing 0 0 "-" "路径不存在"; continue
  fi
  b="$(_size "$f")"; l="$(_lines "$f")"
  if [[ "$b" -eq 0 ]]; then
    echo "⚠ degraded: 跳过空日志 $name" >&2
    row "$name" empty 0 0 "-" "0 字节"; continue
  fi

  snap="$SNAPSHOT_DIR/${name}-${TS}.log"
  n=1; while [[ -e "$snap" ]]; do snap="$SNAPSHOT_DIR/${name}-${TS}-${n}.log"; n=$((n + 1)); done
  state="ok"; note=""
  if [[ "$b" -gt "$MAX_BYTES" ]]; then
    tail -c "$MAX_BYTES" "$f" > "$snap"
    state="truncated"; note="原 ${b}B → 末 ${MAX_BYTES}B（有界）"
    echo "⚠ degraded: $name 超上限截尾归档（原 ${b}B）" >&2
  else
    cp "$f" "$snap"
  fi
  sb="$(_size "$snap")"

  if [[ "$ROTATE" == "1" ]]; then
    if [[ "$(_size "$f")" == "$b" ]]; then
      : > "$f"
      state="rotated"; note="${note:+$note; }轮转: 快照后原文件清零"
    else
      echo "⚠ degraded: $name 轮转跳过——快照期间被并发写入（保护在途证据）" >&2
      note="${note:+$note; }轮转跳过: 并发写"
    fi
  fi
  row "$name" "$state" "$b" "$l" "$snap" "$note"
done

# ── 保留份数（每件只留最新 KEEP 份；仅删本机制产物）────────────────────────────
# 注 1: 用 while-read 而非 mapfile —— macOS 自带 bash 3.2 无 mapfile（可移植性）
# 注 2: 管道尾 `|| true` —— 目录为空时 `ls` 非零，pipefail 会把整个 for 循环判失败（实测踩到）
for name in "${NAMES[@]}"; do
  ls -1t "$SNAPSHOT_DIR/${name}-"*.log 2>/dev/null | tail -n "+$((KEEP + 1))" | while IFS= read -r o; do
    [[ -n "$o" && -f "$o" ]] && rm -f "$o"
  done || true
done

# ── 索引全量重建（K3 消费入口）────────────────────────────────────────────────
"$PYBIN" - "$SNAPSHOT_DIR" "$TS" "$KEEP" "$MAX_BYTES" <<'PY'
import json, os, sys, hashlib, glob
snap_dir, ts, keep, max_bytes = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
items = []
for p in sorted(glob.glob(os.path.join(snap_dir, "*.log"))):
    with open(p, "rb") as fh:
        data = fh.read()
    items.append({
        "file": os.path.basename(p),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "taken_at": os.path.basename(p).rsplit("-", 1)[-1].replace(".log", ""),
    })
index = {"generated_at": ts, "snapshot_dir": snap_dir, "retention_per_log": keep,
         "max_bytes_per_snapshot": max_bytes, "count": len(items), "snapshots": items}
with open(os.path.join(snap_dir, "index.json"), "w", encoding="utf-8") as fh:
    json.dump(index, fh, ensure_ascii=False, indent=2)
print(f"# 索引已写: {os.path.join(snap_dir, 'index.json')}（{len(items)} 份快照）")
PY

echo "# 提示: 本目录已被 .gitignore 忽略（.codex/snapshots/），不产生 git 变更——创始人 2026-09-30 裁定"
