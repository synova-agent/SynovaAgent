#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# self-health.test.sh — U7/CT-40 配对测试（scripts/control-tower/self-health.py）
#
# 本件随 D1223（staging_guard.py 退役）建立 —— 该退役修改了 self-health.py 的
# CORE_COMPONENTS（原列表含已删件 ⇒ 组件完整性维度**恒定 degraded**），按 U7/CT-40
# 「控制塔脚本变更须配对测试」补建配对件。
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界）:
#   正常 — 真实仓库：组件清单内**每一项**真实存在 ⇒ check_components() == healthy
#   降级 — 注入不存在组件 ⇒ 必须 degraded（防"清单名不副实却报健康"的假绿）
#   边界 — ① 已退役件不得回到清单（否则恒定 degraded = 静默失效）
#          ② 版本一致性维度用的是**同一份清单** ⇒ 清单项缺失必出现在 mismatches
#          ③ JSON 输出契约：五维度键齐全（防维度被静默删掉）
#
# 隔离: SYNO_CT_DIR 注入缝指向 mktemp 沙箱（health.json / 日志落在沙箱，零宿主污染）；
#       python 直调模块函数，零网络、零 git、零提交。
# 用法: bash tests/control-tower/self-health.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$REPO/scripts/control-tower/self-health.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }
[ -f "$SUT" ] || { echo "  ❌ SUT 缺失: $SUT（检查自身失败）"; exit 2; }

echo "=== self-health 配对测试（U7/CT-40 · D1223 建立）==="

# ── 接线: 本件确为 ct-test-gate.sh 命名的配对件 ──
grep -q "control-tower" "$SUT" \
  && ok "接线: SUT 位于控制塔脚本区（U7/CT-40 配对规则覆盖）" || no "接线: SUT 路径异常"

# ── 结构断言 + 行为断言（沙箱 CT_DIR，隔离宿主 .codex/）──
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
# 沙箱 CT_DIR 内补齐 VERSION.md（check_version_consistency 的输入）——缺失会提前早退，
# 使「同一清单」断言无法成立（那会把测试变成检查自身失败，而非真实断言）。
cp "$REPO/.codex/control-tower/VERSION.md" "$TMPD/VERSION.md" 2>/dev/null || true
OUT=$("$PYBIN" - "$REPO" "$TMPD" <<'PY' 2>&1
import sys, json
repo, tmp = sys.argv[1], sys.argv[2]
sys.path.insert(0, repo + "/scripts/control-tower")
import importlib
import os
os.environ["SYNO_CT_DIR"] = tmp
sh = importlib.import_module("self-health")

fail = 0
def chk(cond, label, extra=""):
    global fail
    if cond:
        print("PASS|" + label)
    else:
        print("FAIL|" + label + (" | " + str(extra) if extra else ""))
        fail += 1

comps = list(sh.CORE_COMPONENTS)

# ── 边界①: 已退役件不得回到清单 ──
chk(not any("staging_guard" in c for c in comps),
    "边界: 已退役件 staging_guard.py 不在 CORE_COMPONENTS")
chk(len(comps) >= 8, "边界: 清单规模合理（>=8 项）", "实际 %d" % len(comps))

# ── 正常: 清单内每一项真实存在 ⇒ healthy（含同名件在列 = 清单自洽）──
missing = [c for c in comps if not (sh.REPO_ROOT / c).exists()]
chk(not missing, "正常: 清单内全部组件真实存在 ⇒ 组件完整性 healthy", "缺失 %r" % missing)
chk(sh.check_components() == "healthy",
    "正常: check_components() == healthy", sh.check_components())

# ── 降级: 注入不存在组件 ⇒ 必须 degraded（防假绿）──
_orig = list(sh.CORE_COMPONENTS)
sh.CORE_COMPONENTS = _orig + ["scripts/control-tower/__no_such_component__.py"]
degraded_state = sh.check_components()
vc = sh.check_version_consistency()
sh.CORE_COMPONENTS = _orig
chk(degraded_state == "degraded", "降级: 注入缺失组件 ⇒ check_components() degraded", degraded_state)
chk(any("__no_such_component__" in m for m in vc.get("mismatches", [])),
    "边界②: 版本一致性维度用同一清单 ⇒ 缺失项进 mismatches", vc)

sys.exit(2 if fail else 0)
PY
)
RC=$?

while IFS='|' read -r kind label extra; do
  case "$kind" in
    PASS) ok "$label" ;;
    FAIL) no "$label${extra:+ — $extra}" ;;
  esac
done <<< "$OUT"

if [ "$RC" -eq 2 ]; then
  no "python 断言层报告失败（见上方 ❌）"
elif [ "$RC" -ne 0 ]; then
  no "python 断言层异常退出 rc=$RC（检查自身失败）"
fi

# ── 端到端 + 边界③: 直跑契约（覆盖自身故障 / JSON 结构 / SYNO_CT_DIR 隔离）──
# 契约: ① 退出码只能 0 或 1（status red → 1；**>1 = 崩溃/检查自身失败**，判红）
#       ② JSON 五维度键齐全（防维度被静默删 = 静默缩小检查面）
#       ③ SYNO_CT_DIR 生效（health.json 与 VERSION.md 都从注入目录取）
SB_CT="$TMPD/ct"; mkdir -p "$SB_CT/logs"
for _l in runtime.log gate.log incident.log degraded-events.log version.log; do : > "$SB_CT/logs/$_l"; done
cp "$REPO/.codex/control-tower/VERSION.md" "$SB_CT/VERSION.md" 2>/dev/null || true
OUT2=$(SYNO_CT_DIR="$SB_CT" "$PYBIN" "$SUT" 2>&1); RC2=$?
if [ "$RC2" -eq 0 ] || [ "$RC2" -eq 1 ]; then
  ok "端到端: 直跑退出码 = ${RC2}（合法域 0/1；不阻断提交链）"
else
  no "端到端: 直跑 rc=${RC2} 越界（>1 视为崩溃/检查自身失败）: $(printf '%s' "$OUT2" | tail -2)"
fi
[ -f "$SB_CT/health.json" ] && ok "端到端: health.json 落在注入的 SYNO_CT_DIR（沙箱隔离生效）" \
  || no "端到端: health.json 未按 SYNO_CT_DIR 落盘"
KEYS_OK=$("$PYBIN" - "$SB_CT/health.json" <<'PYJSON' 2>/dev/null  # swallow-ok: 不可读 → 输出 UNREADABLE，由下方显式判红（非静默）
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print("UNREADABLE"); raise SystemExit(0)
dims = d.get("dimensions", {})
want = {"gates", "signals", "logs", "resource", "version"}
print("OK" if want <= set(dims) else "MISSING:" + ",".join(sorted(want - set(dims))))
PYJSON
)
[ "$KEYS_OK" = "OK" ] && ok "边界③: JSON 五维度键齐全（gates/signals/logs/resource/version）" \
  || no "边界③: 维度键缺失或 JSON 不可读 — ${KEYS_OK}"
VER_DIM=$("$PYBIN" - "$SB_CT/health.json" <<'PYVER' 2>/dev/null  # swallow-ok: 不可读 → 输出 "?"，由下方显式判红（非静默）
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(d.get("dimensions", {}).get("version", "?"))
PYVER
)
[ "$VER_DIM" = "healthy" ] && ok "边界③: version 维度读注入目录的 VERSION.md ⇒ healthy（SYNO_CT_DIR 生效）" \
  || no "边界③: version 维度 = ${VER_DIM}（期望 healthy —— 注入目录 VERSION.md 未被读取？）"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
