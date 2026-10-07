#!/usr/bin/env bash
# 声明↔实现一致性判据 · 判别夹具
# 判别力（V-08 两个方向都测）:
#   · 盘点模式（--changed 为空）**永不判红**（棘轮式）
#   · --changed 干净脚本 ⇒ exit 0（不误红）
#   · --changed 造一个"死参数"脚本 ⇒ exit 1 且点名
#   · --changed 造一个 action="version" 的脚本 ⇒ **不误报**（假阳性修正①）
#   · --changed 造一个 dest="x" 的脚本 ⇒ **不误报**（属性名以 dest 为准）
#   · 降级：根不存在 ⇒ exit 2
# 🔴 安全性：全部在临时根里**新建**脚本，不软链真实仓库（承接 D1177 事故教训）。
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
SUT="scripts/control-tower/check-decl-vs-impl.py"
NP=0; NF=0
ok() { echo "  ✅ $1"; NP=$((NP + 1)); }
no() { echo "  ❌ $1"; NF=$((NF + 1)); }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1 expect=$3 got=$2"; fi; }
echo "── 声明↔实现 判别夹具 ──"
T=$(mktemp -d); mkdir -p "$T/scripts"
cat > "$T/scripts/dead.py" <<'PY'
import argparse
ap = argparse.ArgumentParser()
ap.add_argument("--used")
ap.add_argument("--never-read")
a = ap.parse_args()
print(a.used)
PY
cat > "$T/scripts/versioned.py" <<'PY'
import argparse
ap = argparse.ArgumentParser()
ap.add_argument("--version", action="version", version="1.0")
ap.add_argument("--flag", dest="mode")
a = ap.parse_args()
print(a.mode)
PY
run() { python3 "$SUT" --root "$T" "$@" 2>&1; }

OUT=$(run); RC=$?
chk "盘点模式: exit 0（棘轮式不红存量）" "$RC" "0"
echo "$OUT" | grep -q "存量盘点" && ok "盘点: 打印存量数字" || no "盘点: 未打印"

OUT=$(run --changed "$T/scripts/versioned.py"); RC=$?
chk "action=version + dest= ⇒ exit 0（假阳性修正生效）" "$RC" "0"

OUT=$(run --changed "$T/scripts/dead.py"); RC=$?
chk "死参数 ⇒ exit 1" "$RC" "1"
echo "$OUT" | grep -q "R1 死参数:.*--never-read" && ok "死参数: 点名 --never-read" || no "死参数: 未点名"

OUT=$(python3 "$SUT" --root /tmp/definitely-not-$$ 2>&1); RC=$?
chk "降级: 根不存在 ⇒ exit 2" "$RC" "2"
echo "$OUT" | grep -q "DEGRADED" && ok "降级: 末行 DEGRADED" || no "降级: 末行非 DEGRADED"

rm -rf "$T"
echo "RESULT: $NP PASS / $NF FAIL"
[ "$NF" -eq 0 ] || exit 1
exit 0
