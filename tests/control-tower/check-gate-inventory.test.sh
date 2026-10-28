#!/bin/bash
# check-gate-inventory.test.sh — #1089 / W1 配对测试（全本地沙箱，不触网络）
# 覆盖: ① 干净 ⇒ 0 ② owner 空 ⇒ 1 ③ class 非法 ⇒ 1 ④ 盘上件未入册 ⇒ 1（漂移）
#       ⑤ 在册件不在盘 ⇒ 1（幽灵）⑥ required_ci=true 未接线 ⇒ 1 ⑦ required_ci=false 却被引用 ⇒ 1
#       ⑧ 清单缺失 ⇒ 2 ⑨ 零条目 ⇒ 2 ⑩ 无 classification 段 ⇒ 2
#       ⑪ M-9 P0 低于棘轮 ⇒ 1 ⑫ 改坏必红: 把 class 校验改成恒假 ⇒ ③ 用例变绿（证明判别力）
# 口径: 三态 0/1/2；零失败 ⇒ exit 0
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="$REPO/scripts/control-tower/check-gate-inventory.sh"
[ -f "$S" ] || { echo "❌ 被测件不存在: $S"; exit 2; }
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
export SYNO_GATE_DEGRADED_LOG="$TMPD/degraded.log"

mkfix() { # $1=目录
  local d="$1"
  mkdir -p "$d/docs/authority" "$d/scripts/control-tower" "$d/.gitea/workflows"
  : > "$d/scripts/pre-commit-check.sh"
  : > "$d/scripts/pre-push-check.sh"
  printf 'jobs:\n  gates:\n    steps:\n      - run: bash scripts/control-tower/check-a.sh\n' > "$d/.gitea/workflows/local-gates.yml"
  touch "$d/scripts/control-tower/check-a.sh" "$d/scripts/control-tower/check-b.py"
  cat > "$d/docs/authority/GATE-INVENTORY.yaml" <<'YAML'
schema_version: 1
meta:
  counts:
    checkers: 2
classification:
  # 夹具（仅测试用）
  - id: CT-check-a
    class: P0
    owner: P4
    review_after: 2026-11-27
    entrypoint: scripts/control-tower/check-a.sh
    required_ci: true
  - id: CT-check-b
    class: P1
    owner: P4
    review_after: 2026-11-27
    entrypoint: scripts/control-tower/check-b.py
    required_ci: false
YAML
}
run(){ # run <root> [envfloor]
  local fl="${2:-1}"
  OUT="$(SYNO_P0_FLOOR="$fl" bash "$S" --root "$1" 2>&1)"; RC=$?
}

echo "── ① 干净：2 件全合规 ⇒ exit 0 ──"
D1="$TMPD/clean"; mkfix "$D1"; run "$D1"
[ "$RC" -eq 0 ] && ok "① exit 0" || no "① 期望 0 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "GATE-INVENTORY: OK" && ok "① 机器行 OK" || no "① 缺机器行"

echo "── ② owner 为空 ⇒ exit 1 且点名 ──"
D2="$TMPD/noowner"; mkfix "$D2"
sed -i 's/^    owner: P4$/    owner: ""/' "$D2/docs/authority/GATE-INVENTORY.yaml"
run "$D2"
[ "$RC" -eq 1 ] && ok "② exit 1" || no "② 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "owner 为空" && ok "② 点名 owner" || no "② 未点名（$OUT）"

echo "── ③ class 非法（P3）⇒ exit 1 ──"
D3="$TMPD/badclass"; mkfix "$D3"
sed -i 's/^    class: P1$/    class: P3/' "$D3/docs/authority/GATE-INVENTORY.yaml"
run "$D3"
[ "$RC" -eq 1 ] && ok "③ exit 1" || no "③ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "class 非法" && ok "③ 点名 class" || no "③ 未点名（$OUT）"

echo "── ④ 盘上件未入册（漂移）⇒ exit 1 ──"
D4="$TMPD/drift"; mkfix "$D4"; touch "$D4/scripts/control-tower/check-c.sh"
run "$D4"
[ "$RC" -eq 1 ] && ok "④ exit 1" || no "④ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "check-c.sh" && ok "④ 点名漂移件" || no "④ 未点名（$OUT）"

echo "── ⑤ 在册件不在盘（幽灵）⇒ exit 1 ──"
D5="$TMPD/ghost"; mkfix "$D5"
cat >> "$D5/docs/authority/GATE-INVENTORY.yaml" <<'YAML'
  - id: CT-check-ghost
    class: P1
    owner: P4
    review_after: 2026-11-27
    entrypoint: scripts/control-tower/check-ghost.sh
    required_ci: false
YAML
run "$D5"
[ "$RC" -eq 1 ] && ok "⑤ exit 1" || no "⑤ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "幽灵行" && ok "⑤ 点名幽灵" || no "⑤ 未点名（$OUT）"

echo "── ⑥ required_ci=true 但三条腿零引用 ⇒ exit 1 ──"
D6="$TMPD/ci-true"; mkfix "$D6"
sed -i '0,/required_ci: false/s//required_ci: true/' "$D6/docs/authority/GATE-INVENTORY.yaml"
sed -i 's#bash scripts/control-tower/check-a.sh#echo noop#' "$D6/.gitea/workflows/local-gates.yml"
run "$D6"
[ "$RC" -eq 1 ] && ok "⑥ exit 1" || no "⑥ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "自相矛盾" && ok "⑥ 点名自相矛盾" || no "⑥ 未点名（$OUT）"

echo "── ⑦ required_ci=false 却被 CI 引用 ⇒ exit 1 ──"
D7="$TMPD/ci-false"; mkfix "$D7"
sed -i 's#bash scripts/control-tower/check-a.sh#bash scripts/control-tower/check-b.py#' "$D7/.gitea/workflows/local-gates.yml"
run "$D7"
[ "$RC" -eq 1 ] && ok "⑦ exit 1" || no "⑦ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "账实不符" && ok "⑦ 点名账实不符" || no "⑦ 未点名（$OUT）"

echo "── ⑧ 清单缺失 ⇒ exit 2（判不了）──"
D8="$TMPD/missing"; mkfix "$D8"; rm -f "$D8/docs/authority/GATE-INVENTORY.yaml"
run "$D8"
[ "$RC" -eq 2 ] && ok "⑧ exit 2" || no "⑧ 期望 2 实得 $RC（$OUT）"

echo "── ⑨ 零条目 ⇒ exit 2（信号量==0）──"
D9="$TMPD/empty"; mkfix "$D9"
printf 'schema_version: 1\nclassification:\n' > "$D9/docs/authority/GATE-INVENTORY.yaml"
run "$D9"
[ "$RC" -eq 2 ] && ok "⑨ exit 2" || no "⑨ 期望 2 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "E_EMPTY" && ok "⑨ 归类 E_EMPTY" || no "⑨ 未归因（$OUT）"

echo "── ⑩ 无 classification 段 ⇒ exit 2 ──"
D10="$TMPD/nosection"; mkfix "$D10"
printf 'schema_version: 1\nmeta:\n  counts: 0\n' > "$D10/docs/authority/GATE-INVENTORY.yaml"
run "$D10"
[ "$RC" -eq 2 ] && ok "⑩ exit 2" || no "⑩ 期望 2 实得 $RC（$OUT）"

echo "── ⑪ M-9：P0 低于棘轮下限 ⇒ exit 1 ──"
D11="$TMPD/p0floor"; mkfix "$D11"
sed -i '0,/class: P0/s//class: P1/' "$D11/docs/authority/GATE-INVENTORY.yaml"
run "$D11" 1
[ "$RC" -eq 1 ] && ok "⑪ exit 1（P0 计数 0 < 1）" || no "⑪ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "棘轮下限" && ok "⑪ 点名棘轮" || no "⑪ 未点名（$OUT）"

echo "── ⑫ 改坏必红：class 校验改成恒假 ⇒ ③ 用例变绿（判别力）──"
MUT="$TMPD/mutant.sh"
sed 's|if cls not in ("P0", "P1", "P2"):  # @mutate-point: class|if False:  # mutant|' "$S" > "$MUT"
grep -q "mutant" "$MUT" && ok "⑫ 变异点已注入" || no "⑫ 变异点未命中"
OUT="$(SYNO_P0_FLOOR=1 bash "$MUT" --root "$D3" 2>&1)"; RC_MUT=$?
[ "$RC_MUT" -eq 0 ] && ok "⑫ 变异后 ③ 用例变绿 ⇒ 若有人如此改坏，③ 必红" \
  || no "⑫ 期望变异体 exit 0 实得 $RC_MUT（$OUT）"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
