#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# precommit-claim-wiring.test.sh — D-A2/① 组 6/12 改接 claim 的夹具（K3 R6 合并核验）
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界 + 改坏即红）:
#   正常 — SYNO_CLAIM_V2=1 + resolver 返回 claim ⇒ 组 6 走 claim 分支，
#          显式打印「Q0/Q1/Q2/Q3 散文检查按设计不适用」，**不**报 4×「未填写」
#   降级 — claim 畸形（缺 done/verify）⇒ 组 6 硬红（rc≠0），**不静默放行**
#   边界 — SYNO_CLAIM_V2 默认关 ⇒ 逐字节走 legacy 散文路径（claim 分支不参与）
#   改坏即红 — 删掉开关门控 / 删掉显式打印 ⇒ 本夹具对应断言必红
#
# 🔴 两处**环境耦合**修复（2026-10-07，卡 #1305 / Lead 派单）:
#   ① 分支名耦合: resolver 先按**分支名**推断 issue（feat/D1220-* → 1220）再去 claim 库找 <issue>.yaml；
#      而本夹具注入的是 1217.yaml ⇒ 在**任何别的卡的分支**上必然命中失败 → 回落 legacy → 证据消失（假红）。
#      修法: 探针显式注入 **SYNO_ISSUE_HINT=1217**（resolver:123 的优先锚，实测 `--issue-of 1217` ⇒ 1217），
#      并**断言**"当前分支名不含 1217 时证据仍在" ⇒ 解耦本身成为判据。
#   ② 宿主 bypass.log 泄漏: local pre-commit 的 gatekeeper 段读 `$ROOT/.claude/bypass.log`（**硬编码，无注入缝**）
#      ⇒ 宿主当日有绕过记录时探针在**组 6 之前**就被拦 ⇒ 证据不可能出现（本仓 2026-10-07 实测 8 条）。
#      修法: 探针置 `GITHUB_ACTIONS=true` —— 该段**按设计在 CI 跳过**（本地专属），本夹具断言的正是 CI 语义 ⇒ 无泄漏、不引入任何 bypass 逃生舱。
#
# 隔离: mktemp 沙箱仓 + SYNO_CLAIM_V2 / SYNO_STAGED_FILES 注入缝；零真实仓写入。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PC="$REPO/scripts/pre-commit-check.sh"
CS="$REPO/scripts/control-tower/claim_store.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

echo "=== 组 6/12 改接 claim（D-A2/① · K3 R6 合并核验）==="

# ── 接线断言（生产接线，非自证）──
grep -q 'SYNO_CLAIM_V2' "$PC" && ok "接线: pre-commit-check.sh 读 SYNO_CLAIM_V2 开关" \
  || no "接线: 开关未接线"
grep -q 'IS_CLAIM_DECL' "$PC" && ok "接线: 声明载体双形态判定存在" || no "接线: 载体判定缺失"
grep -q '散文检查按设计不适用' "$PC" && ok "接线: 含显式打印（禁静默空白）" \
  || no "接线: 缺显式打印（=静默空白）"

# ── 边界: 默认关（回滚语义）──
FLAG=$(env -u SYNO_CLAIM_V2 python3 "$CS" --flag 2>/dev/null)  # swallow-ok: 失败即空 → 下方断言直接判红（不静默放行）
[ "$FLAG" = "off" ] && ok "边界: SYNO_CLAIM_V2 默认关（回滚=关开关）" || no "边界: 默认应为 off，实得 $FLAG"

# ── 正常: 合法 claim ⇒ --check exit 0 ──
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/.claude/claims"
printf 'writeset:\n  - scripts/a.sh\ndone:\n  - verify: bash tests/x.sh\n' > "$TMP/.claude/claims/1217.yaml"
SYNO_CLAIM_DIR="$TMP/.claude/claims" python3 "$CS" --check 1217 --root "$TMP" >/dev/null 2>&1
[ $? -eq 0 ] && ok "正常: 合法 claim --check exit 0" || no "正常: 合法 claim 未通过"

# ── 降级: 畸形 claim（done 缺 verify）⇒ exit 2（改坏即红）──
printf 'writeset:\n  - scripts/a.sh\ndone:\n  - 跑一下测试\n' > "$TMP/.claude/claims/1218.yaml"
OUT=$(SYNO_CLAIM_DIR="$TMP/.claude/claims" python3 "$CS" --check 1218 --root "$TMP" 2>&1); RC=$?
[ "$RC" -eq 2 ] && ok "降级: 畸形 claim → exit 2（fail-closed）" || no "降级: 畸形 claim rc=$RC 期望 2"
echo "$OUT" | grep -q 'claim-done-without-verify' && ok "降级: 点名错误码（铁律 32）" || no "降级: 未点名错误码"

# ══════════════════════════════════════════════════════════════════════════════
# 行为判定（verifier P2 修复）：**真跑判据**，不看源码文本
#
# 病根：原实现用 awk 文本区段 + grep 存在性做「接线断言」，并自造 sed 变异体后只断言
#   「sed 生效了」= **自指检查**，从未把变异体喂给判据 ⇒ verifier 自造 3 种门控短路全部漏抓。
# 修法：在真实临时 claim 目录 + 注入缝下**执行 pre-commit-check.sh**，断言其**输出中
#   出现 claim 分支的行为证据**（散文检查被跳过 + 显式打印）；三种门控短路 ⇒ 证据消失。
#
# 注入缝：SYNO_GIT_CACHED_ALL_NAMES / SYNO_GIT_CACHED_NAMES（暂存集）+ SYNO_CLAIM_DIR（claim 库）
#   + SYNO_TEST_ARM=1（沙箱降软，避免夹具被其它组硬阻断）；零真实仓写入。
# ══════════════════════════════════════════════════════════════════════════════
CLAIM_DIR="$(mktemp -d)"; trap 'rm -rf "$CLAIM_DIR"' EXIT
printf 'writeset:\n  - src/foo.ts\ndone:\n  - verify: bash x.sh\n' > "$CLAIM_DIR/1217.yaml"
STAGED="src/foo.ts"
CLAIM_FILE_NAME="1217.yaml"

# 行为探针：跑 <脚本> 并返回其输出（注入 claim 载体 + 暂存集 + 沙箱）
# probe <script> [v2] → stdout；$2=0 时走 legacy（边界负例）
probe() { # <script> [v2=1]
  GITHUB_ACTIONS=true SYNO_TEST_ARM=1 SYNO_CLAIM_V2="${2:-1}" SYNO_CLAIM_DIR="$CLAIM_DIR" \
  SYNO_ISSUE_HINT="1217" \
  SYNO_GIT_CACHED_ALL_NAMES="$STAGED" SYNO_GIT_CACHED_NAMES="$STAGED" \
  bash "$1" 2>&1 || true
}
# 行为证据 = claim 分支**确实执行**的**不可替代**信号（Lead/verifier 要求，替代已退役的 `Q0: 未填写` 信号）：
#   ① `声明载体 = claim（1217.yaml）` —— **带 claim 文件名** ⇒ legacy 散文路径**不可能**打印（不可替代）
#   ② `散文检查按设计不适用` —— claim 载体专属结论
#   （注意：此处**不再**依赖 `Q0: 未填写` 的缺席 —— #1287 退役该信号后，"缺席"类断言会假绿。）
evidence() {
  printf '%s' "$1" | grep -q "声明载体 = claim（${CLAIM_FILE_NAME}）" \
    && printf '%s' "$1" | grep -q '散文检查按设计不适用'
}

OUT_PROD="$(probe "$PC")"
if evidence "$OUT_PROD"; then
  ok "行为: 生产脚本在 claim 载体下**实际执行** claim 分支（输出含不可替代信号：声明载体 = claim（${CLAIM_FILE_NAME}）+ 散文检查按设计不适用）"
else
  no "行为: 生产脚本未出现 claim 分支证据 —— 输出片段: $(printf '%s' "$OUT_PROD" | grep -aE '声明载体|未填写|GATEKEEPER' | head -2)"
fi
# 解耦断言（本卡核心之一）: 当前分支名**不含** 1217 时证据仍须在 ⇒ 证明探针不依赖宿主分支名
BR_NOW="$(git -C "$REPO" branch --show-current 2>/dev/null || true)"
case "$BR_NOW" in
  *1217*) ok "解耦: 当前分支含 1217（${BR_NOW}）—— 该形态下证据成立不构成解耦证明（附注，不计失败）" ;;
  *) if evidence "$OUT_PROD"; then
       ok "解耦: 当前分支 ${BR_NOW} 不含 1217，claim 证据仍在 ⇒ 探针经 SYNO_ISSUE_HINT 显式注入，与宿主分支名解耦"
     else
       no "解耦失败: 分支 ${BR_NOW} 下 claim 证据消失（仍在靠分支名推断 issue）"
     fi ;;
esac
# 差分负例（替代原靠 `Q0: 未填写` 缺席的**空断言**）：legacy 边界下不得出现 claim 载体信号
OUT_LEGACY="$(probe "$PC" 0)"
if printf '%s' "$OUT_LEGACY" | grep -q '声明载体 = claim'; then
  no "边界: SYNO_CLAIM_V2=0 仍打印 claim 载体信号（开关门控失效）"
else
  ok "边界: SYNO_CLAIM_V2=0 ⇒ 不出现 claim 载体信号（差分负例，替代已退役的 Q0 缺席断言）"
fi
# legacy 侧确有可观察信号时，claim 侧须无（条件化断言，防 #1287 类退役造成假绿）
if printf '%s' "$OUT_LEGACY" | grep -q 'Q0: 未填写'; then
  if printf '%s' "$OUT_PROD" | grep -q 'Q0: 未填写'; then
    no "行为: claim 载体下仍走散文检查（报「Q0: 未填写」）"
  else
    ok "行为: claim 载体下散文检查确实被跳过（legacy 侧有该信号 / claim 侧无）"
  fi
else
  ok "附注: legacy 侧未出现「Q0: 未填写」（#1287 退役该信号）⇒ 本条降为条件化断言，主判据改由不可替代信号承担"
fi

# ── 改坏即红：3 种门控短路 ⇒ 行为证据必须消失（变异体**喂进判据**）──
MUT_DIR="$(mktemp -d)"
declare -a MUT_NAMES=("M1: IS_CLAIM_DECL 恒 0" "M2: 载体误判 (*.yamx)" "M3: 门控恒假 (elif false)" "M4: 证据抹掉 claim 文件名（断言须绑定真实打印）")
CAUGHT=0; TOTAL=4
mutate_and_probe() { # <idx> → 设置 MUT_RC: 0=证据消失(抓到) 1=证据仍在(漏抓)
  local i="$1" dst="$MUT_DIR/mut$1.sh"
  case "$i" in
    1) sed 's/IS_CLAIM_DECL=1 ;;/IS_CLAIM_DECL=0 ;;/' "$PC" > "$dst" ;;
    2) sed 's/case "${BRIEF:-}" in \*.yaml)/case "${BRIEF:-}" in *.yamx)/' "$PC" > "$dst" ;;
    3) sed 's/elif \[ "\$CLAIM_V2" = "1" \] && \[ "\$IS_CLAIM_DECL" = "1" \]; then/elif false; then/' "$PC" > "$dst" ;;
    4) sed 's/声明载体 = claim（/声明载体 = claim/' "$PC" > "$dst" ;;
  esac
  local out; out="$(probe "$dst")"
  if evidence "$out"; then MUT_RC=1; else MUT_RC=0; fi
}
for i in 1 2 3 4; do
  MUT_RC=1; mutate_and_probe "$i"
  if [ "$MUT_RC" -eq 0 ]; then
    CAUGHT=$((CAUGHT + 1)); ok "改坏即红: ${MUT_NAMES[$((i-1))]} ⇒ 行为证据消失（夹具抓到）"
  else
    no "改坏即红: ${MUT_NAMES[$((i-1))]} ⇒ 证据仍在（**漏抓**，夹具无判别力）"
  fi
done
rm -rf "$MUT_DIR"
[ "$CAUGHT" -eq "$TOTAL" ] && ok "改坏即红: ${TOTAL}/${TOTAL} 变异全部被抓（行为判定，非自指）" \
  || no "改坏即红: 仅 ${CAUGHT}/${TOTAL} 被抓"

# ═══ D1220（卡 #1222 D-A2）: 组 12 claim 载体覆盖判定 ═══
#   本卡修的假绿: claim 载体下 ALL_TODAY_BRIEFS 为空 ⇒ 组 12 整段跳过 ⇒ 静默放行。
echo ""
echo "── D1220: 组 12 claim 载体覆盖（并集语义 + 假绿封堵）──"
grep -q '_G12_CLAIM_STATUS' "$PC" && ok "接线[组12]: claim 覆盖判定分支存在" \
  || no "接线[组12]: claim 分支缺失（假绿未修）"
grep -q -- '--coverage' "$PC" && ok "接线[组12]: 消费 claim_store --coverage（并集原语，非最佳单 claim）" \
  || no "接线[组12]: 未消费 --coverage"
grep -q "staged = '''\$_G12_JUDGE_SET'''" "$PC" && ok "接线[组12]: 判定集合改用余量集（未覆盖文件回落 legacy）" \
  || no "接线[组12]: 判定集合未改（余量不回落 legacy ⇒ 覆盖不完整）"
if grep -qF "staged = '''\$STAGED_ALL'''" "$PC"; then
  no "回退防护[组12]: 判定集合退回 \$STAGED_ALL（claim 覆盖会与 legacy 重复计红）"
else
  ok "回退防护[组12]: 旧判定集合 \$STAGED_ALL 已不存在"
fi
grep -q '未被任何 claim 声明覆盖' "$PC" && ok "假绿封堵[组12]: 无 legacy 载体 + 未覆盖 ⇒ 显式判红" \
  || no "假绿封堵[组12]: 缺「无载体即判红」分支 ⇒ claim 模式仍静默放行"
# 「显式空集」文案的真源在 claim_store（reason），shell 侧只许**原样打印**不得自造说明 ⇒
#   断言 = shell 打印原语 reason（`_G12_C_REASON`）+ 原语自身有显式空集语义（下方契约断言）。
grep -q '_G12_C_REASON' "$PC" && ok "显式语义[组12]: 原样打印覆盖原语 reason（含空集语义，禁静默/禁自造）" \
  || no "显式语义[组12]: 未打印原语 reason（claim 数与覆盖情况不可见）"

# 覆盖原语契约（空集 / 并集 / 自身失败）——直接对 claim_store 断言
COV_TMP="$(mktemp -d)"; mkdir -p "$COV_TMP/empty" "$COV_TMP/two" "$COV_TMP/bad"
OUT_EMPTY="$(SYNO_CLAIM_DIR="$COV_TMP/empty" python3 "$CS" --coverage scripts/a.sh 2>/dev/null)"  # swallow-ok: 原语失败即空 JSON → 下方断言直接判红（不静默放行）
if printf '%s' "$OUT_EMPTY" | grep -q '"claims": 0' && printf '%s' "$OUT_EMPTY" | grep -q '显式空集'; then
  ok "契约[coverage]: 0 条 claim ⇒ 显式空集（uncovered=全部，非静默）"
else
  no "契约[coverage]: 空集语义不清（禁静默）"
fi
printf 'writeset:\n  - scripts/a.sh\ndone:\n  - verify: echo a\n' > "$COV_TMP/two/100.yaml"
printf 'writeset:\n  - src/b.ts\ndone:\n  - verify: echo b\n' > "$COV_TMP/two/200.yaml"
OUT_TWO="$(SYNO_CLAIM_DIR="$COV_TMP/two" python3 "$CS" --coverage scripts/a.sh src/b.ts scripts/c.sh 2>/dev/null)"  # swallow-ok: 同上
if printf '%s' "$OUT_TWO" | grep -q '"claims": 2' && printf '%s' "$OUT_TWO" | grep -q '"uncovered": \["scripts/c.sh"\]'; then
  ok "契约[coverage]: 多 claim **并集**覆盖（多线并发不假红）"
else
  no "契约[coverage]: 并集语义错（多线并发会假红）"
fi
printf 'writeset: []\ndone: []\n' > "$COV_TMP/bad/300.yaml"
SYNO_CLAIM_DIR="$COV_TMP/bad" python3 "$CS" --coverage scripts/a.sh >/dev/null 2>&1
COV_BAD_RC=$?
[ "$COV_BAD_RC" -eq 2 ] && ok "契约[coverage]: 畸形 claim ⇒ exit 2（检查自身失败，fail-closed）" \
  || no "契约[coverage]: 畸形 claim 未 exit 2（实得 $COV_BAD_RC ⇒ 会判『无声明』）"
rm -rf "$COV_TMP"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
