#!/usr/bin/env bash
# D6/D7 判别夹具：协调文件卫生（R1 禁 INDEX.md / R2 篇幅上限 / R3 近重复）
#
# 判别力设计（V-08 改坏即红）+ **两个方向都测**：
#   · 盘点模式（--all）**永不判红** —— 这是 D734 教训的落点，必须有用例钉住（防有人"顺手"改成判红）
#   · --changed 正常文件 ⇒ exit 0（不误红）
#   · --changed 超篇幅 / INDEX.md / 近重复 ⇒ 各自 exit 1 且**点名**
#   · 降级：根不存在 ⇒ exit 2（fail-closed）
# 🔴 安全性：本夹具**不软链真实仓库**，全部在临时根里**新建**文件 ⇒ 结构上不可能污染真树。
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

SUT="scripts/control-tower/check-coordination-hygiene.py"
NP=0; NF=0
ok() { echo "  ✅ $1"; NP=$((NP + 1)); }
no() { echo "  ❌ $1"; NF=$((NF + 1)); }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1 expect=$3 got=$2"; fi; }

echo "── D6/D7 · 协调文件卫生判别夹具 ──"

mk() { # $1 = 根；造一个最小 coordination 树
  rm -rf "$1"; mkdir -p "$1/docs/synova/coordination"
  # 一篇"既有文档"（给 R3 当比对对象）
  python3 - "$1" <<'PY'
import io,sys,os
r=sys.argv[1]+"/docs/synova/coordination"
io.open(os.path.join(r,"existing.md"),"w",encoding="utf-8").write(
  " ".join(["组织诊断增长导航哨兵测量器专家路由 "
                "token%sa%s" % (chr(97 + i // 26), chr(97 + i % 26)) for i in range(60)]))
PY
}
run() { python3 "$SUT" --root "$1" "${@:2}" 2>&1; }

T=$(mktemp -d); mk "$T"

# ── 1. 盘点模式：存量超限/近重复**只报数不判红** ──
python3 - "$T" <<'PY'
import io,sys,os
r=sys.argv[1]+"/docs/synova/coordination"
io.open(os.path.join(r,"huge.md"),"w",encoding="utf-8").write("x"*30000)
io.open(os.path.join(r,"INDEX.md"),"w",encoding="utf-8").write("# index\n")
PY
OUT=$(run "$T" --all); RC=$?
chk "盘点模式: 有超限/INDEX 也 exit 0（棘轮式不红存量）" "$RC" "0"
echo "$OUT" | grep -q "存量超上限 1 篇" && ok "盘点: 报出超限篇数" || no "盘点: 未报超限篇数"
echo "$OUT" | grep -q "存量含 INDEX.md" && ok "盘点: 报出 INDEX 存量" || no "盘点: 未报 INDEX"

# ── 2. --changed 正常文件 ⇒ 不误红 ──
python3 - "$T" <<'PY'
import io,sys,os
r=sys.argv[1]+"/docs/synova/coordination"
io.open(os.path.join(r,"small.md"),"w",encoding="utf-8").write("正常一篇短文档。"*40)
PY
OUT=$(run "$T" --changed docs/synova/coordination/small.md); RC=$?
chk "正常文件 --changed: exit 0" "$RC" "0"

# ── 3. 超篇幅 ⇒ 必红且点名 ──
OUT=$(run "$T" --changed docs/synova/coordination/huge.md); RC=$?
chk "超篇幅 --changed: exit 1" "$RC" "1"
echo "$OUT" | grep -q "huge.md = 30[0-9]* 字符 > 上限" && ok "超篇幅: 点名并给数字" || no "超篇幅: 未点名"

# ── 4. INDEX.md ⇒ 必红且点名（R1）──
OUT=$(run "$T" --changed docs/synova/coordination/INDEX.md); RC=$?
chk "INDEX.md --changed: exit 1" "$RC" "1"
echo "$OUT" | grep -q "R1: 出现 INDEX.md" && ok "INDEX: 点名 R1" || no "INDEX: 未点名 R1"

# ── 5. 近重复 ⇒ 必红且点名（R3）──
python3 - "$T" <<'PY'
import io,sys,os
r=sys.argv[1]+"/docs/synova/coordination"
# 与 existing.md 近乎逐字相同（Jaccard → 1.0）
io.open(os.path.join(r,"dup.md"),"w",encoding="utf-8").write(
  " ".join(["组织诊断增长导航哨兵测量器专家路由 "
                "token%sa%s" % (chr(97 + i // 26), chr(97 + i % 26)) for i in range(60)]))
PY
OUT=$(run "$T" --changed docs/synova/coordination/dup.md); RC=$?
chk "近重复 --changed: exit 1" "$RC" "1"
echo "$OUT" | grep -q "R3: .*dup.md ≈ .*existing.md" && ok "近重复: 点名两个文件" || no "近重复: 未点名"

# ── 6. 降级：根不存在 ⇒ exit 2（fail-closed）──
OUT=$(run /tmp/definitely-not-a-root-$$ --all); RC=$?
chk "降级: 根不存在 ⇒ exit 2" "$RC" "2"
echo "$OUT" | grep -q "DEGRADED" && ok "降级: 末行 DEGRADED" || no "降级: 末行非 DEGRADED"

rm -rf "$T"
echo "RESULT: $NP PASS / $NF FAIL"
[ "$NF" -eq 0 ] || exit 1
exit 0
