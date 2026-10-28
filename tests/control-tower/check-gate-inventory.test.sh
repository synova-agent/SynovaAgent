#!/bin/bash
# check-gate-inventory.test.sh — #1089 / W1 配对测试（全本地沙箱，不触网络）
# 覆盖: ① 干净 ⇒ 0 ② owner 空 ⇒ 1 ③ class 非法 ⇒ 1 ④ 盘上件未入册 ⇒ 1（漂移）
#       ⑤ 在册件不在盘 ⇒ 1（幽灵）⑥ required_ci=true 未接线 ⇒ 1 ⑦ required_ci=false 却被引用 ⇒ 1
#       ⑧ 清单缺失 ⇒ 2 ⑨ 零条目 ⇒ 2 ⑩ 无 classification 段 ⇒ 2
#       ⑪ M-9 P0 低于棘轮 ⇒ 1 ⑫ 改坏必红: 把 class 校验改成恒假 ⇒ ③ 用例变绿（证明判别力）
#       ⑬ 判不了归 2（#1112 W6 接线）: 子进程异常码经 gate-assert 归一 ——
#          127（命令不存在）／128（🔴 绝不当 0、也不原样穿透）／137（SIGKILL）／126（不可执行）⇒ 均 2
#       ⑭ 归一库缺失 ⇒ 2（fail-closed，禁当通过）⑮ 改坏必红: 归一里 128→0（/tmp 副本）⇒ ⑬b 断言失效
# 口径: 三态 0/1/2；零失败 ⇒ exit 0
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="$REPO/scripts/control-tower/check-gate-inventory.sh"
GA="$REPO/scripts/control-tower/gate-assert.sh"
[ -f "$S" ] || { echo "❌ 被测件不存在: $S"; exit 2; }
[ -f "$GA" ] || { echo "❌ 归一库不存在: $GA"; exit 2; }
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
# 🔴 #1112 接线后被测件依赖同目录 gate-assert.sh（归一入口）⇒ 变异体必须与归一库同目录，
#   否则判不了（exit 2）会掩盖「class 判据被改坏」这一个变量（本用例只许变一个变量）。
cp "$GA" "$TMPD/gate-assert.sh"
grep -q "mutant" "$MUT" && ok "⑫ 变异点已注入" || no "⑫ 变异点未命中"
OUT="$(SYNO_P0_FLOOR=1 bash "$MUT" --root "$D3" 2>&1)"; RC_MUT=$?
[ "$RC_MUT" -eq 0 ] && ok "⑫ 变异后 ③ 用例变绿 ⇒ 若有人如此改坏，③ 必红" \
  || no "⑫ 期望变异体 exit 0 实得 $RC_MUT（$OUT）"

echo "── ⑬ 判不了归 2（#1112 W6 接线）：子进程异常码一律经 gate-assert 归一 ──"
# 注入缝 = PATH 前置**假 python3**（真执行路径，不 mock shell 函数）：假件自己 exec 不存在/退出异常码。
FAKE="$TMPD/fake"; mkdir -p "$FAKE/missing" "$FAKE/c126" "$FAKE/c128" "$FAKE/c137"
printf '#!/bin/sh\nexec /__synova_ga_no_such_interpreter__ "$@"\n' > "$FAKE/missing/python3"
printf '#!/bin/sh\nexit 126\n' > "$FAKE/c126/python3"
printf '#!/bin/sh\nexit 128\n' > "$FAKE/c128/python3"
printf '#!/bin/sh\nexit 137\n' > "$FAKE/c137/python3"
chmod +x "$FAKE/missing/python3" "$FAKE/c126/python3" "$FAKE/c128/python3" "$FAKE/c137/python3"
run_inject() { # <假bin目录> <夹具root> → OUT/RC（2>&1 合并，便于同时判点名行）
  OUT="$(PATH="$1:$PATH" SYNO_P0_FLOOR=1 bash "$S" --root "$2" 2>&1)"; RC=$?
}
run_inject "$FAKE/missing" "$D1"
[ "$RC" -eq 2 ] && ok "⑬a 子进程命令不存在（127）⇒ exit 2（判不了）" || no "⑬a 期望 2 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "判据故障: 127" && ok "⑬a 点名「判据故障: 127」（经 ga_run 归一）" || no "⑬a 未点名 127（$OUT）"
run_inject "$FAKE/c128" "$D1"
[ "$RC" -eq 2 ] && ok "⑬b 子进程 128 ⇒ exit 2（🔴 关键：绝不当 0，也不原样穿透 128）" || no "⑬b 期望 2 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "判据故障: 128" && ok "⑬b 点名「判据故障: 128」" || no "⑬b 未点名 128（$OUT）"
run_inject "$FAKE/c137" "$D1"
[ "$RC" -eq 2 ] && ok "⑬c 子进程 137（SIGKILL 语义码）⇒ exit 2" || no "⑬c 期望 2 实得 $RC（$OUT）"
run_inject "$FAKE/c126" "$D1"
[ "$RC" -eq 2 ] && ok "⑬d 子进程 126（不可执行/权限）⇒ exit 2" || no "⑬d 期望 2 实得 $RC（$OUT）"

echo "── ⑭ 归一库缺失 ⇒ exit 2（fail-closed，禁当通过）──"
NOLIB="$TMPD/nolib"; mkdir -p "$NOLIB"; cp "$S" "$NOLIB/check-gate-inventory.sh"
OUT="$(SYNO_P0_FLOOR=1 bash "$NOLIB/check-gate-inventory.sh" --root "$D1" 2>&1)"; RC=$?
[ "$RC" -eq 2 ] && ok "⑭ 缺 gate-assert.sh ⇒ exit 2" || no "⑭ 期望 2 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "判据归一库缺失" && ok "⑭ 点名「判据归一库缺失」" || no "⑭ 未点名（$OUT）"

echo "── ⑮ 改坏必红（纪律③）：归一里 128 分支改成 0（/tmp 副本）⇒ ⑬b 同一断言失效 ──"
MUTD="$TMPD/mutlib"; mkdir -p "$MUTD"
cp "$S" "$MUTD/check-gate-inventory.sh"
sed 's/^    128).*/    128) printf 0 ;;/' "$GA" > "$MUTD/gate-assert.sh"
grep -q '128) printf 0' "$MUTD/gate-assert.sh" && ok "⑮ 变异点已注入（归一 128 ⇒ 0）" || no "⑮ 变异点未命中 128 分支"
OUT="$(PATH="$FAKE/c128:$PATH" SYNO_P0_FLOOR=1 bash "$MUTD/check-gate-inventory.sh" --root "$D1" 2>&1)"; RC_M=$?
[ "$RC_M" -eq 0 ] && ok "⑮ 归一改坏后 128 被当通过（⇒ ⑬b 必红；证明归一入口承重）" \
  || no "⑮ 期望变异体 exit 0 实得 $RC_M（$OUT）—— ⑬b 对该变异无判别力"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
