#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# gate-stats.test.sh — D515 项4 ＋ D1094（W2）: 门禁命中统计 / 运行状态区分
#
# 覆盖矩阵（铁律 48 三路径 + 接线 + 改坏必红）:
#   正常 — 已知数据 → 触发/命中/通过/中位耗时/误报代理逐列正确；旧 4 字段行兼容
#   降级 — 损坏 JSON 行跳过并计数；窗口外数据被排除（D918: 夹具时间相对 now，无日期定时炸弹）
#   边界 — 日志不存在/为空 ⇒ 『未运行』且**不出现**「零命中可退役」（M-8）；
#          已运行但 0 命中 ⇒ 归「零命中（已运行）」而不是「未运行」
#   接线 — pre-commit 的 log_gate/GATE_HITS_LOG；.gitignore 保留 gate-hits.log（运行态不入库）
#   改坏必红 — 变异体（空日志走"零命中"分支）⇒ M-8 断言必须红
# 沙箱: SYNO_GATE_HITS_LOG / SYNO_PRECOMMIT 注入 mktemp，零真仓写入。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GS="$REPO/scripts/control-tower/gate-stats.sh"
PC="$REPO/scripts/pre-commit-check.sh"
PYBIN="$(command -v python3 2>/dev/null)"  # swallow-ok: python3 缺失由下方 T0 显式判红（禁裸 python3，D520）
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D515 项4 ＋ D1094 W2: gate-stats 命中统计 / 未运行区分 ==="

# ── T0 前置 + 接线 ──
[ -n "$PYBIN" ] && ok "T0 python3 可用（夹具依赖 json 解析）" || no "T0 python3 不可用 —— 夹具无法判定"
grep -q "log_gate()" "$PC" && grep -q "GATE_HITS_LOG" "$PC" && ok "T1 接线: pre-commit log_gate + GATE_HITS_LOG 存在" || no "T1 pre-commit 命中统计未接线"
grep -q "gate-hits.log" "$REPO/.gitignore" && ok "T1b 接线: .gitignore 保留 gate-hits.log（运行态不入库）" || no "T1b .gitignore 缺 gate-hits.log"
grep -q "gate-telemetry.sh" "$PC" && ok "T1c 接线: log_gate 经 gate-telemetry.sh 单点写入" || no "T1c log_gate 未接 gate-telemetry.sh"

# ── 夹具: 假 pre-commit（声明检查点全集）──
PCF="$TMPD/pc.sh"
cat > "$PCF" <<'EOF'
hard_check "闸A" "$m1"
soft_check "闸B" "$m2"
log_gate "闸C" hit
decl_check "闸D" "$m4"
EOF

# ── T2 正常: 已知数据 → 逐列正确（D918: 时间相对 now 生成）──
LOG="$TMPD/gate-hits.log"
"$PYBIN" - "$LOG" <<'PY'
import datetime
import json
import sys

now = datetime.datetime.now(datetime.timezone.utc)


def iso(days_ago, minutes=0):
    t = now - datetime.timedelta(days=days_ago) + datetime.timedelta(minutes=minutes)
    return t.isoformat().replace("+00:00", "Z")


rows = [
    # as any: hit→miss 2 分钟内 ⇒ 误报代理 1；耗时 [120,80] ⇒ 中位 100
    {"time": iso(10), "gate": "as any 零容忍（新增，铁律 38）", "result": "hit", "branch": "feat/a", "duration_ms": 120, "hits": 1},
    {"time": iso(10, 2), "gate": "as any 零容忍（新增，铁律 38）", "result": "miss", "branch": "feat/a", "duration_ms": 80, "hits": 0},
    # 旧 4 字段行（无 duration_ms/hits）⇒ 命中/耗时回退 0/-
    {"time": iso(9), "gate": "契约门禁: 声明产出须在暂存区", "result": "miss", "branch": "feat/a"},
    # 耗时闸: 两次 hit，hits=3+2 ⇒ 5；耗时 [300,500] ⇒ 中位 400
    {"time": iso(8), "gate": "耗时闸", "result": "hit", "branch": "feat/a", "duration_ms": 300, "hits": 3},
    {"time": iso(7), "gate": "耗时闸", "result": "hit", "branch": "feat/a", "duration_ms": 500, "hits": 2},
    # 窗口外（40 天前）⇒ 任何列都不应出现
    {"time": iso(40), "gate": "旧数据应被过滤", "result": "hit", "branch": "feat/b"},
]
with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as fh:
    for rec in rows:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
PY
OUT="$(SYNO_GATE_HITS_LOG="$LOG" SYNO_PRECOMMIT="$PCF" bash "$GS" 30 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "T2 正常: exit 0" || no "T2 正常应 exit 0，实际 rc=$rc"
printf '%s\n' "$OUT" | grep -q "| 检查点 |" && ok "T2b 输出含 Markdown 表头" || no "T2b 缺 Markdown 表头"
printf '%s\n' "$OUT" | grep -q "误报代理(5min内hit→miss)" && ok "T2c 误报代理列表头存在" || no "T2c 缺误报代理列表头"
printf '%s\n' "$OUT" | grep -q "| 2 | 1 | 1 | 100 | 1 |" && ok "T2d as any 行: 触发2/命中1/通过1/中位100/代理1" || no "T2d as any 行计数错误: $(printf '%s\n' "$OUT" | grep 'as any' | head -1)"
printf '%s\n' "$OUT" | grep -q "| 2 | 5 | 0 | 400 | 0 |" && ok "T2e 耗时闸 行: 触发2/命中5(hits求和)/中位400" || no "T2e 耗时闸行错误: $(printf '%s\n' "$OUT" | grep '耗时闸' | head -1)"
printf '%s\n' "$OUT" | grep -q "| 1 | 0 | 1 | - | 0 |" && ok "T2f 旧 4 字段行: 命中回退 0、中位无样本为「-」" || no "T2f 旧行兼容错误: $(printf '%s\n' "$OUT" | grep '契约门禁' | head -1)"
printf '%s\n' "$OUT" | grep -q "旧数据应被过滤" && no "T2g 窗口过滤失效（40 天前行未被排除）" || ok "T2g 窗口: 30 天外数据被排除"

# ── T3 已运行但 0 命中 ⇒ 「零命中（已运行）」，不是「未运行」──
if printf '%s\n' "$OUT" | grep -q "零命中候选"; then
  if printf '%s\n' "$OUT" | grep "零命中候选" | grep -q "契约门禁"; then
    ok "T3 零命中: 已运行且 0 命中的检查点进「零命中候选」"
  else
    no "T3 已运行 0 命中项未进零命中候选"
  fi
  if printf '%s\n' "$OUT" | grep "零命中候选" | grep -q "闸B"; then
    no "T3b 未运行的闸B 被误列「零命中」"
  else
    ok "T3b 未运行项不混入「零命中」"
  fi
else
  no "T3 缺「零命中候选（已运行）」段"
fi

# ── T4 未运行段: 声明了但 0 记录的检查点逐条点名 ──
if printf '%s\n' "$OUT" | grep -q "## 未运行"; then
  ok "T4 未运行段存在"
  for _g in 闸A 闸B 闸D; do
    printf '%s\n' "$OUT" | grep -q "^- \`${_g}\` — 未运行" && ok "T4b 未运行点名: ${_g}" || no "T4b 未运行段漏点名: ${_g}"
  done
  printf '%s\n' "$OUT" | grep -q "^- \`as any 零容忍" && no "T4c 已运行的 as any 被误列未运行" || ok "T4c 已运行项未误列未运行"
else
  no "T4 缺「未运行」段（声明检查点全集）"
fi

# ── T5 M-8 边界: 空日志 ⇒ 「未运行」＋**不得**出现「零命中可退役」──
: > "$TMPD/empty.log"
OUT2="$(SYNO_GATE_HITS_LOG="$TMPD/empty.log" SYNO_PRECOMMIT="$PCF" bash "$GS" 2>&1)"; rc2=$?
[ "$rc2" -eq 0 ] && ok "T5 M-8 空日志: exit 0（无数据≠错误）" || no "T5 M-8 空日志应 exit 0，实际 rc=$rc2"
printf '%s\n' "$OUT2" | grep -q "未运行" && ok "T5b M-8 空日志: 输出含「未运行」" || no "T5b M-8 空日志未报「未运行」"
if printf '%s\n' "$OUT2" | grep -q "零命中可退役"; then
  no "T5c M-8 违规: 空日志出现「零命中可退役」"
else
  ok "T5c M-8 空日志: 不出现「零命中可退役」"
fi
if printf '%s\n' "$OUT2" | grep -q "零命中候选"; then
  no "T5d M-8 违规: 空日志仍产出零命中候选列表"
else
  ok "T5d M-8 空日志: 不产出零命中候选"
fi

# ── T6 M-8 边界: 日志不存在 ⇒ 同 T5 ──
OUT3="$(SYNO_GATE_HITS_LOG="$TMPD/nonexistent.log" SYNO_PRECOMMIT="$PCF" bash "$GS" 2>&1)"; rc3=$?
[ "$rc3" -eq 0 ] && printf '%s\n' "$OUT3" | grep -q "未运行" && printf '%s\n' "$OUT3" | grep -q "日志不存在" && ok "T6 M-8 日志不存在: exit 0 + 「未运行（日志不存在）」" || no "T6 M-8 日志不存在异常 rc=$rc3"
if printf '%s\n' "$OUT3" | grep -q "零命中可退役"; then
  no "T6b M-8 违规: 日志不存在出现「零命中可退役」"
else
  ok "T6b M-8 日志不存在: 不出现「零命中可退役」"
fi

# ── T7 边界: 损坏 JSON 行跳过并注明 ──
printf 'not-json\n' >> "$LOG"
OUT4="$(SYNO_GATE_HITS_LOG="$LOG" SYNO_PRECOMMIT="$PCF" bash "$GS" 2>&1)"
printf '%s\n' "$OUT4" | grep -q "1 行损坏" && ok "T7 损坏行跳过并注明" || no "T7 损坏行未注明"

# ── T8 平台: gate-stats.sh 为 LF ──
CRS="$("$PYBIN" -c 'import sys; print(open(sys.argv[1],"rb").read().count(b"\r"))' "$GS")"
[ "$CRS" = "0" ] && ok "T8 gate-stats.sh 为 LF（\\r 计数 0）" || no "T8 gate-stats.sh 含 CRLF（\\r=$CRS）"

# ── T9 改坏必红: 变异体把「未运行」误判成「零命中」（旧缺陷形态）⇒ M-8/T5d 断言必须红 ──
MUT="$TMPD/gs-mut.sh"
"$PYBIN" -c 'import sys
src=open(sys.argv[1],encoding="utf-8").read()
old="zero = sorted(g for g in stats if stats[g][\"hit\"] == 0 and stats[g][\"other\"] == 0)"
new="zero = sorted(g for g in declared if stats.get(g, {\"hit\": 0})[\"hit\"] == 0)  # MUTANT: 未运行被误判为 0 命中"
mut=src.replace(old, new, 1)
open(sys.argv[2],"w",encoding="utf-8",newline="\n").write(mut)' "$GS" "$MUT"
if cmp -s "$GS" "$MUT"; then
  no "T9 变异未生效（未找到可变异点）—— 改坏必红不可自证"
else
  MOUT="$(SYNO_GATE_HITS_LOG="$LOG" SYNO_PRECOMMIT="$PCF" bash "$MUT" 2>&1)"
  if printf '%s\n' "$MOUT" | grep "零命中候选" | grep -q "闸B"; then
    ok "T9 改坏必红: 变异体把未运行的闸B 误列零命中（T3b 断言会红 ⇒ 判别力成立）"
  else
    no "T9 变异体未复现旧缺陷（断言无判别力）"
  fi
fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
