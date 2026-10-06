#!/usr/bin/env bash
# check-issue-policy 判别夹具（P3 · Issue 作为工作单元）
#
# 判别力设计（V-08 改坏即红）:
#   · 正例: 合规 PR ⇒ exit 0
#   · 反例(4): 无 Issue / kind 多 / 缺 area / p 多 / Priority 不一致 ⇒ 各自 exit 1 且**点名**对应判据
#   · 降级(3): 无来源 / 文件不存在 / 载荷非对象 ⇒ exit 2（fail-closed，2 ≠ 通过，M-02）
#   · 🔴 关键负对照: **R3 的 SKIP 不得被算成通过** ——
#     同一份"无 p* 标签"的载荷: 不带 --project-json ⇒ OK（但 R3=skipped）；
#     带 --project-json 且 Priority 不一致 ⇒ 必须 VIOLATION。⇒ 证明 R3 不是恒绿。
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

SUT="scripts/control-tower/check-issue-policy.py"
FX="tests/fixtures/issue-policy"
NP=0; NF=0
ok() { echo "  ✅ $1"; NP=$((NP + 1)); }
no() { echo "  ❌ $1"; NF=$((NF + 1)); }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1 expect=$3 got=$2"; fi; }

run() { bash -c "python3 $SUT $1" 2>&1; }

echo "── P3 · check-issue-policy 判别夹具 ──"

# ── 正例 ──
OUT=$(run "--from-json $FX/pr-ok.json"); RC=$?
chk "正例: 合规载荷 exit 0" "$RC" "0"
echo "$OUT" | grep -q "ISSUE-POLICY: OK" && ok "正例: 末行为 OK" || no "正例: 末行非 OK — $(printf '%s' "$OUT" | tail -1)"
echo "$OUT" | grep -q "✅ R3" && ok "正例: R3 已实际校验（带 Priority 快照）" || no "正例: R3 未校验"

# ── 反例 1: 无 Issue 关联 ⇒ R1 必红 ──
OUT=$(run "--from-json $FX/pr-no-issue.json"); RC=$?
chk "反例: 无 Issue 关联 exit 1" "$RC" "1"
echo "$OUT" | grep -q "R1" && ok "反例: 点名 R1" || no "反例: 未点名 R1"

# ── 反例 2: 标签契约违例（kind×2 / 无 area / p×2）⇒ R2 必红 ──
OUT=$(run "--from-json $FX/pr-bad-labels.json"); RC=$?
chk "反例: 标签违例 exit 1" "$RC" "1"
echo "$OUT" | grep -q "应.*恰好 1 个" && ok "反例: 抓到 kind/* 数量错" || no "反例: 未抓 kind 数量"
echo "$OUT" | grep -q "缺 \`area/\*\`" && ok "反例: 抓到缺 area/*" || no "反例: 未抓缺 area"
echo "$OUT" | grep -q "应 ≤1 个" && ok "反例: 抓到 p* 超 1" || no "反例: 未抓 p* 超 1"

# ── 反例 3: Priority 不一致（PR=p3，最高关联 Issue=p0）⇒ R3 必红 ──
OUT=$(run "--from-json $FX/pr-prio-mismatch.json"); RC=$?
chk "反例: Priority 不一致 exit 1" "$RC" "1"
echo "$OUT" | grep -q "R3" && ok "反例: 点名 R3" || no "反例: 未点名 R3"

# ── 🔴 负对照: R3 的 SKIP 不是"恒绿" ──
cat > /tmp/ip-noprio.json <<'JSON'
{"closing_issues":[{"number":9004,"title":"无优先级","labels":["kind/feature","area/ci"]}],"pr_priority":null}
JSON
OUT=$(run "--from-json /tmp/ip-noprio.json"); RC=$?
chk "负对照: 无 p* 标签 ⇒ R2/R1 过、exit 0" "$RC" "0"
echo "$OUT" | grep -q "R3: SKIP" && ok "负对照: R3 显式 SKIP（不冒充通过）" || no "负对照: R3 未显式 SKIP"
# 同一载荷 + 一个不一致的 PR Priority ⇒ 必须转红（证明 R3 真的在判）
echo '{"Priority":"p0"}' > /tmp/ip-proj.json
OUT=$(run "--from-json /tmp/ip-noprio.json --project-json /tmp/ip-proj.json"); RC=$?
chk "负对照: 同载荷 + PR Priority=p0 ⇒ R3 转红 exit 1" "$RC" "1"

# ── 降级（三态 fail-closed，M-02）──
OUT=$(run ""); RC=$?
chk "降级: 无任何来源 ⇒ exit 2" "$RC" "2"
echo "$OUT" | grep -q "DEGRADED" && ok "降级: 末行为 DEGRADED" || no "降级: 末行非 DEGRADED"
OUT=$(run "--from-json /tmp/ip-does-not-exist.json"); RC=$?
chk "降级: 载荷文件不存在 ⇒ exit 2" "$RC" "2"
echo '[]' > /tmp/ip-arr.json
OUT=$(run "--from-json /tmp/ip-arr.json"); RC=$?
chk "降级: 载荷非对象（数组）⇒ exit 2" "$RC" "2"

echo "RESULT: $NP PASS / $NF FAIL"
[ "$NF" -eq 0 ] || exit 1
exit 0
