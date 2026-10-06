#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# k3-merge-gate.test.sh — D923 门禁夹具（三路径 + 变异体判别 + 多结论形态）
#
# 契约:
#   @input   — 无（密封：mktemp -d 沙箱；沙箱内自建 git 仓 + 假 task-state）
#   @output  — 逐条 PASS/FAIL + 末行 "D923-FIXTURE: PASS(n)/TOTAL(m)"
#   @exit    — 0 = 全过；1 = 有失败
#   @degraded— 无（夹具自身不降级；被测门禁的降级路径在用例 9/10 断言）
#
# 覆盖矩阵:
#   1  正常        — 非三类路径 + 未抽中 → 0
#   2  抽样        — 非三类 + pr%5==0 → 0 且打 ::notice（**永不阻断**，裁定 3）
#   3  反例        — 三类命中 + NO_VERDICT → **1**（K3 排队中）
#   4  三类 + PASS — 沙箱假卡 → **0**（PASS 分支可达；**不向仓库写假 verdict**，裁定 4）
#   5  有条件通过  — CONDITIONAL PASS → 1（"有条件通过 = 未通过"）
#   6  不可审计    — NOT-AUDITABLE → 1 且理由含「不可审计 ≠ 通过」（裁定 1）
#   7  非 K3 结论  — NOT_K3（tag 锚点）→ 1 且理由给出「补结论 / CTO 具名豁免」出口（裁定 2）
#   8  小写 pass   — pass → 0（归一为 PASS，裁定 1）
#   9  降级        — 扫描器不可用 → **2**（fail-closed）
#  10  降级+三类   — **三类命中场景下非 0**（裁定 3：不得静默放行；policy 附加条件 4）
#  11  无卡号      — 三类命中 + 三路均无 D# → 1（NO_CARD_ID，fail-closed）
#  12  多 D#       — 两卡，任一非 PASS → 1
#  13  报告兜底    — 无 verdict 但有报告正文 PASS → 0
#  14  变异体判别  — 把三类匹配改成恒不命中 → 同一红样例**必须漏判**（证明判据承重）
#  15  缺陷A回归  — 门禁自身产物(k3-*)含 DDL 字面量 → **不自命中**（去掉 policy exclude_globs 即失败）
#  16  缺陷B回归  — pickaxe 命中**可归因**：出现在「三类命中清单」并标明规则名
#  17  L9 回归    — 规则级 `exclude:` **真被消费**（宽 glob 沙箱下，_extinct 不命中 / 子域命中）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GATE="$REPO_ROOT/scripts/control-tower/k3-merge-gate.sh"

PASS=0; FAIL=0; TOTAL=0
check() { local d="$1" w="$2" g="$3"; TOTAL=$((TOTAL+1)); if [ "$w" = "$g" ]; then echo "  PASS  $d (=$g)"; PASS=$((PASS+1)); else echo "  FAIL  $d: 期望 $w 实际 $g"; FAIL=$((FAIL+1)); fi; }
gcheck() { local d="$1" f="$2" p="$3" w="$4" g; TOTAL=$((TOTAL+1)); if grep -qE "$p" "$f" 2>/dev/null; then g=yes; else g=no; fi
  if [ "$w" = "$g" ]; then echo "  PASS  $d (hit=$g)"; PASS=$((PASS+1)); else echo "  FAIL  $d: 期望 $w 实际 $g"; FAIL=$((FAIL+1)); fi; }

SB="$(mktemp -d)"; trap 'rm -rf "$SB"' EXIT

# 造沙箱仓：<名> <分支名> <变更文件相对路径…>
mk_repo() {
  local name="$1" br="$2"; shift 2
  local root="$SB/$name"
  mkdir -p "$root/task-state" "$root/docs/synova/audit-reports"
  ( cd "$root" && git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base )
  for f in "$@"; do mkdir -p "$root/$(dirname "$f")"; echo "// stub" > "$root/$f"; done
  ( cd "$root" && git checkout -q -b "$br" 2>/dev/null; git add -A && git -c user.email=t@t -c user.name=t commit -q -m head )
  echo "$root"
}
# 写假卡：<root> <D#> <verdict json 字面量 或 __NULL__>
mk_card() {
  local root="$1" did="$2" v="$3"
  if [ "$v" = "__NULL__" ]; then
    printf '{"task_id":"%s","audit":null}' "$did" > "$root/task-state/$did.json"
  else
    printf '{"task_id":"%s","audit":{"verdict":"%s"}}' "$did" "$v" > "$root/task-state/$did.json"
  fi
}

# ── 1 正常（非三类 + 未抽中）──────────────────────────────────────────────
R1="$(mk_repo r1 feat/d101-normal docs/readme.md)"
mk_card "$R1" D101 PASS
bash "$GATE" --dir "$R1" --state-dir "$R1" --pr 3 > "$SB/o1" 2>&1
RC=$?
echo "[1] 正常: 非三类路径 + 未抽中"; check "exit" 0 "$RC"; gcheck "输出 PASS" "$SB/o1" 'K3-GATE: PASS' yes

# ── 2 抽样（非三类 + pr%5==0 → 只记录）────────────────────────────────────
bash "$GATE" --dir "$R1" --state-dir "$R1" --pr 1000 > "$SB/o2" 2>&1
RC=$?
echo "[2] 抽样: 非三类 + pr%5==0 → 只记录不阻断"; check "exit" 0 "$RC"; gcheck "打 ::notice" "$SB/o2" '^::notice' yes

# ── 3 反例：三类命中 + NO_VERDICT → 1 ─────────────────────────────────────
R3="$(mk_repo r3 feat/d103-red src/security/x.ts)"
mk_card "$R3" D103 __NULL__
bash "$GATE" --dir "$R3" --state-dir "$R3" --pr 7 > "$SB/o3" 2>&1
RC=$?
echo "[3] 反例: 三类命中 + 无结论 → 红"; check "exit" 1 "$RC"; gcheck "理由含排队中" "$SB/o3" '排队中' yes

# ── 4 三类 + PASS（沙箱假卡）→ 0 ──────────────────────────────────────────
R4="$(mk_repo r4 feat/d104-pass src/security/x.ts)"
mk_card "$R4" D104 PASS
bash "$GATE" --dir "$R4" --state-dir "$R4" --pr 7 > "$SB/o4" 2>&1
RC=$?
echo "[4] 三类 + PASS → 绿（PASS 分支可达，假卡在沙箱）"; check "exit" 0 "$RC"

# ── 5 CONDITIONAL PASS → 1 ────────────────────────────────────────────────
R5="$(mk_repo r5 feat/d105-cond src/security/x.ts)"; mk_card "$R5" D105 "CONDITIONAL PASS"
bash "$GATE" --dir "$R5" --state-dir "$R5" > "$SB/o5" 2>&1
RC=$?
echo "[5] 有条件通过 → 红"; check "exit" 1 "$RC"; gcheck "理由含『有条件通过 = 未通过』" "$SB/o5" '有条件通过 = 未通过' yes

# ── 6 NOT-AUDITABLE → 1 ───────────────────────────────────────────────────
R6="$(mk_repo r6 feat/d106-na src/security/x.ts)"; mk_card "$R6" D106 "NOT-AUDITABLE"
bash "$GATE" --dir "$R6" --state-dir "$R6" > "$SB/o6" 2>&1
RC=$?
echo "[6] 不可审计 → 红"; check "exit" 1 "$RC"; gcheck "理由含『不可审计 ≠ 通过』" "$SB/o6" '不可审计 ≠ 通过' yes

# ── 7 NOT_K3 → 1 ──────────────────────────────────────────────────────────
R7="$(mk_repo r7 feat/d107-notk3 src/security/x.ts)"; mk_card "$R7" D107 "无 K3（V5.1.3 tag 锚点闭环）"
bash "$GATE" --dir "$R7" --state-dir "$R7" > "$SB/o7" 2>&1
RC=$?
echo "[7] 非 K3 结论 → 红"; check "exit" 1 "$RC"; gcheck "理由给出 CTO 具名豁免出口" "$SB/o7" 'CTO 具名豁免' yes

# ── 8 小写 pass → 0 ───────────────────────────────────────────────────────
R8="$(mk_repo r8 feat/d108-lower src/security/x.ts)"; mk_card "$R8" D108 "pass"
bash "$GATE" --dir "$R8" --state-dir "$R8" > "$SB/o8" 2>&1
RC=$?
echo "[8] 小写 pass → 归一为 PASS（绿）"; check "exit" 0 "$RC"

# ── 9 降级 → 2 ────────────────────────────────────────────────────────────
bash "$GATE" --dir "$R1" --state-dir "$R1" >/dev/null 2>&1
SYNO_K3_GREP="$SB/no-grep" bash "$GATE" --dir "$R1" --state-dir "$R1" > "$SB/o9" 2> "$SB/e9"
RC=$?
echo "[9] 降级: 扫描器不可用 → exit 2 + degraded"; check "exit" 2 "$RC"
gcheck "stderr degraded" "$SB/e9" 'degraded: ' yes

# ── 10 降级 + 三类命中 → 非 0（裁定 3 附加条件 4）────────────────────────
SYNO_K3_GREP="$SB/no-grep" bash "$GATE" --dir "$R3" --state-dir "$R3" >/dev/null 2>&1
RC10=$?
TOTAL=$((TOTAL+1))
echo "[10] 降级 + 三类命中场景 → 必须非 0（不得静默放行）"
if [ "$RC10" -ne 0 ]; then echo "  PASS  非 0 (= $RC10)"; PASS=$((PASS+1)); else echo "  FAIL  期望非 0 实际 0"; FAIL=$((FAIL+1)); fi

# ── 11 三路无 D# → 1 ──────────────────────────────────────────────────────
R11="$(mk_repo r11 feat/no-card-here src/security/x.ts)"; mk_card "$R11" D111 PASS
bash "$GATE" --dir "$R11" --state-dir "$R11" > "$SB/o11" 2>&1
RC=$?
echo "[11] 三类命中 + 三路无卡号 → 红(NO_CARD_ID)"; check "exit" 1 "$RC"
gcheck "归因三路均打点" "$SB/o11" '①分支名.*②brief 文件名.*③PR 正文' yes

# ── 12 多 D#：任一非 PASS → 1 ─────────────────────────────────────────────
# 多 D# 的发现路径：D112 走分支名，D113 走变更集里的 brief 文件名（裁定 3 第三路之外的两路）
R12="$(mk_repo r12 feat/d112-multi src/security/x.ts .claude/task-briefs/2026-09-23-D113-other.md)"
mk_card "$R12" D112 PASS; mk_card "$R12" D113 FAIL
bash "$GATE" --dir "$R12" --state-dir "$R12" > "$SB/o12" 2>&1
RC=$?
echo "[12] 多 D#：D113=FAIL → 红"; check "exit" 1 "$RC"; gcheck "点名 D113" "$SB/o12" 'D113' yes

# ── 13 报告正文兜底 → 0 ───────────────────────────────────────────────────
R13="$(mk_repo r13 feat/d114-fallback src/security/x.ts)"
printf '{"task_id":"D114"}' > "$R13/task-state/D114.json"
printf '# K3 报告\n\n结论: PASS\n' > "$R13/docs/synova/audit-reports/2026-09-23-K3-D114.md"
bash "$GATE" --dir "$R13" --state-dir "$R13" > "$SB/o13" 2>&1
RC=$?
echo "[13] 无 verdict 但有报告正文 PASS → 绿（既有兜底约定）"; check "exit" 0 "$RC"

# ── 14 变异体判别：把三类匹配改成恒不命中 → 红样例必须漏判 ────────────────
sed 's|^  while IFS= read -r pat; do|  return 1; while IFS= read -r pat; do|' "$GATE" > "$SB/mutant-nomatch.sh"
bash "$SB/mutant-nomatch.sh" --dir "$R3" --state-dir "$R3" >/dev/null 2>&1
echo "[14] 变异体判别: 坏三类匹配 → 同一红样例必须漏判"; check "坏判据体必须漏判" 0 "$?"

# ── 15 缺陷 A 回归（D923 收尾任务 0）: 门禁自身产物含 DDL 字面量 → 不得自命中 ──
# diff 模式沙箱：判定器 + policy 复制进沙箱仓（diff 模式扫的是 SCRIPT_DIR 所在的仓）。
# 判别性：去掉 policy 的 exclude_globs 后同一 diff 必红（本用例即失败）——排除是承重的，不是装饰。
R15="$SB/r15"; mkdir -p "$R15/scripts/control-tower" "$R15/task-state"
cp "$GATE" "$R15/scripts/control-tower/"
cp "$REPO_ROOT/scripts/control-tower/k3-gate-policy.yaml" "$R15/scripts/control-tower/"
( cd "$R15" && git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base )
printf '{"task_id":"D115","audit":{"verdict":"PASS"}}' > "$R15/task-state/D115.json"
printf '\n# 注释里出现 CREATE TABLE 字面量（模拟门禁自身产物）\n' >> "$R15/scripts/control-tower/k3-gate-policy.yaml"
( cd "$R15" && git add -A && git -c user.email=t@t -c user.name=t commit -q -m head )
bash "$R15/scripts/control-tower/k3-merge-gate.sh" --base HEAD~1 --head HEAD --pr 3 --state-dir "$R15" > "$SB/o15" 2>&1
RC=$?
echo "[15] 缺陷A回归: k3-* 自身含 DDL 字面量 → 不自命中"; check "exit" 0 "$RC"

# ── 16 缺陷 B 回归: pickaxe 命中必须**出现在清单里并标明规则**（红可归因）────────
R16="$SB/r16"; mkdir -p "$R16/src/adapters" "$R16/task-state" "$R16/scripts/control-tower"
cp "$GATE" "$R16/scripts/control-tower/"
cp "$REPO_ROOT/scripts/control-tower/k3-gate-policy.yaml" "$R16/scripts/control-tower/"
( cd "$R16" && git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base )
printf '{"task_id":"D116","audit":{"verdict":"PASS"}}' > "$R16/task-state/D116.json"
printf '// stub\n' > "$R16/src/adapters/real-ddl.ts"
( cd "$R16" && git add -A && git -c user.email=t@t -c user.name=t commit -q -m base2 )
printf '// stub\nCREATE TABLE t16 (id INT);\n' > "$R16/src/adapters/real-ddl.ts"
( cd "$R16" && git add -A && git -c user.email=t@t -c user.name=t commit -q -m head )
bash "$R16/scripts/control-tower/k3-merge-gate.sh" --base HEAD~1 --head HEAD --pr 7 --state-dir "$R16" > "$SB/o16" 2>&1
RC=$?
echo "[16] 缺陷B回归: pickaxe 命中可归因（清单逐条 + 规则名）"; check "exit" 1 "$RC"
gcheck "清单含 pickaxe 逐条 + 规则名" "$SB/o16" '\(pickaxe\).*src/adapters/real-ddl\.ts.*规则 C_storage\.pickaxe' yes

# ── 17 L9 回归: 规则级 `exclude:` 必须**真被消费**（声明即生效）────────────────
# 判别点：把 B 的五条子域 glob 换成一条**宽 glob**（`extensions/sentinels/**`），
#   使 `exclude: extensions/sentinels/_extinct/**` 成为唯一判别点。
#   未实现 exclude 时：c1 的 _extinct 变更仍会命中 → exit 1 ⇒ 本用例失败（删掉即报红）。
R17="$SB/r17"; mkdir -p "$R17/extensions/sentinels" "$R17/task-state" "$R17/scripts/control-tower"
cp "$GATE" "$R17/scripts/control-tower/"
cp "$REPO_ROOT/scripts/control-tower/k3-gate-policy.yaml" "$R17/scripts/control-tower/"
python3 - "$R17/scripts/control-tower/k3-gate-policy.yaml" <<'PYX'
import re, sys
p = sys.argv[1]; t = open(p, encoding='utf-8').read()
# 只替换 B_finance 的 globs 列表（逐行匹配，禁用 DOTALL 贪婪——否则会把 policy 后半截吃掉）
t2 = re.sub(r'(^  B_finance:(?:[^\n]*\n)*?    globs:\n)(?:      - [^\n]*\n)+',
            lambda m: m.group(1) + '      - "extensions/sentinels/**"\n', t, flags=re.M)
assert t2 != t, "B_finance.globs 未替换（夹具前置失败）"
assert '    exclude:\n      - "extensions/sentinels/_extinct/**"' in t2, "exclude 段被误删"
assert t2.rstrip().endswith('backlog:') or 'backlog:' in t2, "policy 被截断"
open(p, 'w', encoding='utf-8').write(t2)
PYX
( cd "$R17" && git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base )
printf '{"task_id":"D117","audit":{"verdict":"PASS"}}' > "$R17/task-state/D117.json"
mkdir -p "$R17/extensions/sentinels/_extinct/demo/computes"
printf '// stub\n' > "$R17/extensions/sentinels/_extinct/demo/computes/x.ts"
( cd "$R17" && git add -A && git -c user.email=t@t -c user.name=t commit -q -m c1 )
bash "$R17/scripts/control-tower/k3-merge-gate.sh" --base HEAD~1 --head HEAD --pr 3 --state-dir "$R17" > "$SB/o17a" 2>&1
RC17A=$?
echo "[17] L9回归: exclude 内(_extinct)的变更不得命中"; check "exit" 0 "$RC17A"
mkdir -p "$R17/extensions/sentinels/capital-health/computes"
printf '// stub\n' > "$R17/extensions/sentinels/capital-health/computes/z.ts"
( cd "$R17" && git add -A && git -c user.email=t@t -c user.name=t commit -q -m c2 )
bash "$R17/scripts/control-tower/k3-merge-gate.sh" --base HEAD~2 --head HEAD --pr 3 --state-dir "$R17" > "$SB/o17b" 2>&1
RC17B=$?
echo "[17b] 对照: exclude 外的 B 子域变更仍须命中"; check "exit" 1 "$RC17B"
gcheck "17b 命中带规则名" "$SB/o17b" '\(glob\).*capital-health.*规则 B_finance\.globs' yes

echo ""
if [ "$FAIL" -gt 0 ]; then echo "D923-FIXTURE: FAIL ($PASS/$TOTAL 通过)"; exit 1; fi
echo "D923-FIXTURE: PASS($PASS/$TOTAL)"
exit 0
