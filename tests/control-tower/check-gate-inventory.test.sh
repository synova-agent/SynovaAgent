#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# check-gate-inventory.test.sh — #1089 / W1 配对测试（全本地沙箱，不触网络）
# #1114 Step 0 追加：run_by 建账面 ⑦ 条（缺行／非法值／M-15 两态／quota 非布尔／盘上新件／
#                   现实一致性／改坏即红）。
# 覆盖: ① 干净 ⇒ 0 ② owner 空 ⇒ 1 ③ class 非法 ⇒ 1 ④ 盘上件未入册 ⇒ 1（漂移）
#       ⑤ 在册件不在盘 ⇒ 1（幽灵）⑥ required_ci=true 未接线 ⇒ 1 ⑦ required_ci=false 却被引用 ⇒ 1
#       ⑧ 清单缺失 ⇒ 2 ⑨ 零条目 ⇒ 2 ⑩ 无 classification 段 ⇒ 2
#       ⑪ M-9 P0 低于棘轮 ⇒ 1 ⑫ 改坏必红: 把 class 校验改成恒假 ⇒ ③ 用例变绿（证明判别力）
#       ⑬ run_by 缺行 ⇒ 1（枚举面未入账）⑭ run_by 非法五值 ⇒ 1
#       ⑮ M-15 两态：删候选行 ⇒ 1 点名；补回 ⇒ 0（无主件不得静默留存）
#       ⑯ quota 非布尔 ⇒ 1 ⑰ 盘上新件未入 run_by ⇒ 1
#       ⑱ 现实一致性：run_by=pre-commit 但 pre-commit 源零命中 ⇒ 1（"名义在跑"即红）
#       ⑲ 改坏必红: 把 run_by 五值校验改成恒假 ⇒ ⑭ 用例变绿（证明判别力）
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

mkfix() { # $1=目录 [$2=额外 classification 行（可多行，已按 4 空格缩进）]
  local d="$1" extra="${2:-}"
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
  [ -z "$extra" ] || printf '%s\n' "$extra" >> "$d/docs/authority/GATE-INVENTORY.yaml"
  cat >> "$d/docs/authority/GATE-INVENTORY.yaml" <<'YAML'
# ── run_by 建账段（#1114 Step 0）──
run_by:
  - entrypoint: scripts/control-tower/check-a.sh
    run_by: gitea-ci
    quota: true
  - entrypoint: scripts/control-tower/check-b.py
    run_by: "无"
    quota: false
run_by_candidates:
  - entrypoint: scripts/control-tower/check-b.py
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
printf '%s' "$OUT" | grep -q "run_by 覆盖 2/2" && ok "① 覆盖行 2/2" || no "① 缺覆盖行（$OUT）"

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
D5="$TMPD/ghost"; mkfix "$D5" '  - id: CT-check-ghost
    class: P1
    owner: P4
    review_after: 2026-11-27
    entrypoint: scripts/control-tower/check-ghost.sh
    required_ci: false'
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

echo "── ⑬ run_by 缺行（枚举面未入账）⇒ exit 1 ──"
D13="$TMPD/rb-missing"; mkfix "$D13"
sed -i '/^  - entrypoint: scripts\/control-tower\/check-a\.sh$/,+2d' "$D13/docs/authority/GATE-INVENTORY.yaml"
run "$D13"
[ "$RC" -eq 1 ] && ok "⑬ exit 1" || no "⑬ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "run_by 缺行" && ok "⑬ 点名缺行" || no "⑬ 未点名（$OUT）"
printf '%s' "$OUT" | grep -q "check-a.sh" && ok "⑬ 点名该件" || no "⑬ 未点名该件（$OUT）"

echo "── ⑭ run_by 非法值（pre-push ∉ 五值）⇒ exit 1 ──"
D14="$TMPD/rb-illegal"; mkfix "$D14"
sed -i 's/^    run_by: gitea-ci$/    run_by: pre-push/' "$D14/docs/authority/GATE-INVENTORY.yaml"
run "$D14"
[ "$RC" -eq 1 ] && ok "⑭ exit 1" || no "⑭ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "run_by 非法" && ok "⑭ 点名非法值" || no "⑭ 未点名（$OUT）"

echo "── ⑮ M-15 两态：删候选行 ⇒ 1 点名；补回 ⇒ 0 ──"
D15="$TMPD/m15"; mkfix "$D15"
# 夹具里 run_by 段与候选段的 entrypoint 文本相同（同件两处声明）⇒ 只砍**文件末行**（候选行），
# 不能 sed -d（会把 run_by 段那行也删掉，那是 ⑬ 的用例，不是 M-15）。
head -n -1 "$D15/docs/authority/GATE-INVENTORY.yaml" > "$D15/inv.tmp" \
  && mv "$D15/inv.tmp" "$D15/docs/authority/GATE-INVENTORY.yaml"
run "$D15"
[ "$RC" -eq 1 ] && ok "⑮-a 无主件未进候选 ⇒ exit 1" || no "⑮-a 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "M-15" && ok "⑮-a 点名 M-15" || no "⑮-a 未点名（$OUT）"
printf '  - entrypoint: scripts/control-tower/check-b.py\n' >> "$D15/docs/authority/GATE-INVENTORY.yaml"
run "$D15"
[ "$RC" -eq 0 ] && ok "⑮-b 补回候选行 ⇒ exit 0（两态齐）" || no "⑮-b 期望 0 实得 $RC（$OUT）"

echo "── ⑯ quota 非布尔（yes）⇒ exit 1 ──"
D16="$TMPD/quota-bad"; mkfix "$D16"
sed -i 's/^    quota: true$/    quota: yes/' "$D16/docs/authority/GATE-INVENTORY.yaml"
run "$D16"
[ "$RC" -eq 1 ] && ok "⑯ exit 1" || no "⑯ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "quota 非布尔" && ok "⑯ 点名 quota" || no "⑯ 未点名（$OUT）"

echo "── ⑰ 盘上新件未入 run_by（根级 check-*.sh）⇒ exit 1 ──"
D17="$TMPD/rb-newfile"; mkfix "$D17"; touch "$D17/scripts/check-d.sh"
run "$D17"
[ "$RC" -eq 1 ] && ok "⑰ exit 1" || no "⑰ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "run_by 缺行" && ok "⑰ 点名未入账" || no "⑰ 未点名（$OUT）"
printf '%s' "$OUT" | grep -q "scripts/check-d.sh" && ok "⑰ 点名新件" || no "⑰ 未点名新件（$OUT）"

echo "── ⑱ 现实一致性：run_by=pre-commit 但 pre-commit 源零命中 ⇒ exit 1 ──"
D18="$TMPD/rb-unreal"; mkfix "$D18"
sed -i 's/^    run_by: gitea-ci$/    run_by: pre-commit/' "$D18/docs/authority/GATE-INVENTORY.yaml"
run "$D18"
[ "$RC" -eq 1 ] && ok "⑱ exit 1" || no "⑱ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "名义在跑" && ok "⑱ 点名名义在跑" || no "⑱ 未点名（$OUT）"

echo "── ⑲ 改坏必红：run_by 五值校验改成恒假 ⇒ ⑭ 用例变绿（判别力）──"
MUT2="$TMPD/mutant2.sh"
sed 's|if val not in RUN_BY_VALS:|if False:  # mutant-rb|' "$S" > "$MUT2"
grep -q "mutant-rb" "$MUT2" && ok "⑲ 变异点已注入" || no "⑲ 变异点未命中"
OUT="$(SYNO_P0_FLOOR=1 bash "$MUT2" --root "$D14" 2>&1)"; RC_MUT2=$?
[ "$RC_MUT2" -eq 0 ] && ok "⑲ 变异后 ⑭ 用例变绿 ⇒ 若有人如此改坏，⑭ 必红" \
  || no "⑲ 期望变异体 exit 0 实得 $RC_MUT2（$OUT）"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
