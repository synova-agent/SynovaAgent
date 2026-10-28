#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# gate-telemetry.test.sh — D1094（W2 运行遥测）: gate-hits JSONL 单写入器
#
# 覆盖矩阵（铁律 48 三路径 + 接线 + 改坏必红）:
#   正常 — emit hit/miss 落行；字段齐全且可被 json 解析；续写不覆盖旧行
#   降级 — 写失败（--log 是目录 / 父目录不可建）⇒ exit 2 + stderr degraded + degraded 日志；
#          gate 含引号/反斜杠 ⇒ 仍产出合法 JSON（转义）
#   边界 — 信号量 0（缺参）⇒ exit 2；result 枚举外 ⇒ exit 1（拒绝写入）；duration 非整数 ⇒ exit 2
#   接线 — pre-commit 的 log_gate 调用本工具；本工具与产出行为 LF（无 \r）
#   改坏必红 — 变异体（write-failure 的 exit 2 → exit 0）⇒ 三态断言必须红
# 沙箱: --log / SYNO_GATE_DEGRADED_LOG 全部指向 mktemp，零真仓写入。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEL="$REPO/scripts/control-tower/gate-telemetry.sh"
PC="$REPO/scripts/pre-commit-check.sh"
PYBIN="$(command -v python3 2>/dev/null)"  # swallow-ok: python3 缺失由下方 T0 显式判红（禁裸 python3，D520）
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
LOG="$TMPD/gate-hits.log"
DEG="$TMPD/degraded-events.log"

echo "=== D1094 W2: gate-telemetry（gate-hits JSONL 单写入器） ==="

# ── T0 前置: python3 可用（缺 ⇒ 本测试判不了，直接红）──
[ -n "$PYBIN" ] && ok "T0 python3 可用（夹具依赖 json 解析）" || no "T0 python3 不可用 —— 夹具无法判定"

# ── 接线: log_gate 调本工具（WIRE CHECK）──
grep -q "gate-telemetry.sh" "$PC" && ok "T1 接线: pre-commit log_gate 调用 gate-telemetry.sh" || no "T1 未接线（pre-commit 无 gate-telemetry.sh）"
grep -q -- "--emit" "$TEL" && grep -q "duration_ms" "$TEL" && grep -q "hits" "$TEL" && ok "T1b 契约: --emit 与 duration_ms/hits 字段在实现内" || no "T1b 契约字段缺失"

# ── T2 正常: emit hit → exit 0 + 字段正确 ──
OUT="$(bash "$TEL" --emit "组 6: Task Brief" hit 12 3 --log "$LOG" --branch feat/x 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$OUT" ] && ok "T2 hit: exit 0 且 stdout 静默" || no "T2 hit 应 exit 0/静默，实际 rc=$rc out=${OUT:-<空>}"
LINE1=""
[ -f "$LOG" ] && LINE1="$(head -1 "$LOG")"
if printf '%s' "$LINE1" | "$PYBIN" -c 'import json,sys
d=json.load(sys.stdin)
assert d["gate"]=="组 6: Task Brief", d
assert d["result"]=="hit"
assert d["duration_ms"]==12
assert d["hits"]==3
assert d["branch"]=="feat/x"
assert d["time"].endswith("Z")
print("OK")' >/dev/null 2>&1; then ok "T2b 字段齐全且 JSON 合法（time/gate/result/branch/duration_ms/hits）"; else no "T2b JSON 字段不符: ${LINE1:-<空>}"; fi

# ── T3 正常: 续写（第二行追加，首行不动）──
bash "$TEL" --emit "第二闸" miss 40 0 --log "$LOG" --branch feat/x; rc=$?
LINES=0
[ -f "$LOG" ] && LINES="$(wc -l < "$LOG" | tr -d ' ')"
[ "$rc" -eq 0 ] && [ "$LINES" -eq 2 ] && [ "$(head -1 "$LOG")" = "$LINE1" ] && ok "T3 续写: 2 行且首行未变" || no "T3 续写异常 rc=$rc lines=${LINES}"

# ── T4 边界: result 枚举外 → exit 1（拒绝写入）──
BEFORE="$(wc -l < "$LOG" | tr -d ' ')"
ERR="$(bash "$TEL" --emit g bogus 1 1 --log "$LOG" --branch b 2>&1 >/dev/null)"; rc=$?
AFTER="$(wc -l < "$LOG" | tr -d ' ')"
[ "$rc" -eq 1 ] && [ "$BEFORE" = "$AFTER" ] && printf '%s' "$ERR" | grep -q "输入不合规" && ok "T4 result 枚举外: exit 1 且不写入（行数不变）" || no "T4 枚举外应 exit 1/不写入，实际 rc=$rc ${BEFORE}→${AFTER}"

# ── T5 边界: 信号量 0（缺参）→ exit 2 + degraded ──
ERR="$(SYNO_GATE_DEGRADED_LOG="$DEG" bash "$TEL" --emit g hit 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && printf '%s' "$ERR" | grep -q "degraded:" && ok "T5 缺参: exit 2 + stderr degraded（信号量 0 ⇒ 2）" || no "T5 缺参应 exit 2，实际 rc=$rc err=${ERR:-<空>}"

# ── T6 边界: duration_ms 非整数 → exit 2 ──
ERR="$(SYNO_GATE_DEGRADED_LOG="$DEG" bash "$TEL" --emit g hit abc 1 --log "$LOG" 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && printf '%s' "$ERR" | grep -q "duration_ms" && ok "T6 非整数 duration: exit 2（判不了）" || no "T6 应 exit 2，实际 rc=$rc"

# ── T7 降级: 写失败（--log 是目录）→ exit 2 + degraded 日志 ──
mkdir -p "$TMPD/isdir"
ERR="$(SYNO_GATE_DEGRADED_LOG="$TMPD/deg-write.log" bash "$TEL" --emit g hit 1 1 --log "$TMPD/isdir" --branch b 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && printf '%s' "$ERR" | grep -q "degraded:" && ok "T7 写失败: exit 2 + stderr degraded" || no "T7 写失败应 exit 2，实际 rc=$rc"
if [ -f "$TMPD/deg-write.log" ] && head -1 "$TMPD/deg-write.log" | "$PYBIN" -c 'import json,sys
d=json.load(sys.stdin)
assert d["component"]=="gate-telemetry"
assert d["code"]=="E_TELEMETRY_DEGRADED"
print("OK")' >/dev/null 2>&1; then
  ok "T7b degraded 日志为合法 JSON（component/code 正确）"
else
  no "T7b degraded 日志缺失/不合法"
fi

# ── T8 降级: 父目录不可建（父路径是普通文件）→ exit 2 ──
printf 'x' > "$TMPD/afile"
ERR="$(SYNO_GATE_DEGRADED_LOG="$DEG" bash "$TEL" --emit g hit 1 1 --log "$TMPD/afile/sub/g.log" 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && printf '%s' "$ERR" | grep -q "父目录不可建" && ok "T8 父目录不可建: exit 2（fail-closed）" || no "T8 应 exit 2，实际 rc=$rc err=${ERR:-<空>}"

# ── T9 边界: gate 含引号/反斜杠 → 仍为合法 JSON（转义）──
bash "$TEL" --emit 'A"B\C' hit 7 2 --log "$TMPD/esc.log" --branch 'b"1' >/dev/null 2>&1
if [ -f "$TMPD/esc.log" ] && head -1 "$TMPD/esc.log" | "$PYBIN" -c 'import json,sys
d=json.load(sys.stdin)
assert d["gate"].startswith("A")
assert d["branch"]=="b\"1", d["branch"]
print("OK")' >/dev/null 2>&1; then
  ok "T9 转义: 引号/反斜杠仍产出合法 JSON"
else
  no "T9 转义失败（JSON 不合法）"
fi

# ── T10 边界: 未知参数 → exit 2 ──
bash "$TEL" --nope >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "T10 未知参数: exit 2" || no "T10 未知参数应 exit 2，实际 rc=$rc"

# ── T11 平台: 脚本 LF（无 \r），产出行也不含 \r ──
CRS="$("$PYBIN" -c 'import sys; print(open(sys.argv[1],"rb").read().count(b"\r"))' "$TEL")"
[ "$CRS" = "0" ] && ok "T11 脚本为 LF（\\r 计数 0）" || no "T11 脚本含 CRLF（\\r=$CRS）"
"$PYBIN" -c 'import sys; raise SystemExit(0 if open(sys.argv[1],"rb").read().count(b"\r")==0 else 1)' "$LOG" && ok "T11b 产出行无 \\r" || no "T11b 产出行含 \\r"

# ── T12 改坏必红: 变异体把「写失败 ⇒ exit 2」改成 exit 0 ⇒ 三态断言必须红 ──
MUT="$TMPD/tel-mut.sh"
"$PYBIN" -c 'import sys
src=open(sys.argv[1],encoding="utf-8").read()
mut=src.replace("\n  exit 2\n", "\n  exit 0\n", 1)
open(sys.argv[2],"w",encoding="utf-8",newline="\n").write(mut)' "$TEL" "$MUT"
if cmp -s "$TEL" "$MUT"; then
  no "T12 变异未生效（未找到可变异点）—— 改坏必红不可自证"
else
  bash "$MUT" --emit g hit 1 1 --log "$TMPD/isdir" --branch b >/dev/null 2>&1; mrc=$?
  [ "$mrc" -ne 2 ] && ok "T12 改坏必红: 变异体写失败 rc=${mrc}≠2（T7 断言会红 ⇒ 判别力成立）" || no "T12 变异体仍 exit 2（断言无判别力）"
fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
