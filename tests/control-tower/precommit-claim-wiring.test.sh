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
#   ── 卡 #1423（D-C 最后一刀）: SYNO_CLAIM_V2 **默认翻「开」** + 存量 D# 反例守护 ──
#   默认翻面 — 未设 ⇒ on（新任务走 issue 号身份）；显式 0/off ⇒ off（**唯一回滚点**）
#   判据③   — **带 D# 的在飞分支**（有 brief、无 claim、brief 在 ±1 天窗口外）⇒ 组 12 **不得硬阻断**
#              （"保存量 D#" = 创始人原话的机器判据）；其变异体（中和守护段）⇒ 误拦复现 ⇒ 必红
#   判据④   — claim 新格式端到端（开关未设）⇒ resolver 返回 claim + 组 6 走 claim 分支
#              其变异体（显式回滚 `SYNO_CLAIM_V2=0`）⇒ 新格式不可提交 ⇒ 默认开是承重点
#   回滚语义 — 显式 0 ⇒ 组 12 逐字节 legacy（#1423 守护段不可达）
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

# ── 边界（**卡 #1423 翻面**）: 默认开 + 回滚=显式关 ──
FLAG=$(env -u SYNO_CLAIM_V2 python3 "$CS" --flag 2>/dev/null)  # swallow-ok: 失败即空 → 下方断言直接判红（不静默放行）
[ "$FLAG" = "on" ] && ok "边界: SYNO_CLAIM_V2 **默认开**（#1423: 新任务走 issue 号身份）" || no "边界: 默认应为 on，实得 $FLAG"
FLAG_OFF=$(SYNO_CLAIM_V2=0 python3 "$CS" --flag 2>/dev/null)  # swallow-ok: 同上
[ "$FLAG_OFF" = "off" ] && ok "边界: 显式 0 ⇒ 关（**唯一回滚点**，回滚语义保留）" || no "边界: 显式 0 应为 off，实得 $FLAG_OFF"

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
# probe <script> [v2] [staged] → stdout；$2=0 走 legacy（边界负例）；$3 覆盖暂存集（缺省 $STAGED）
probe() { # <script> [v2=1] [staged]
  local _st="${3:-$STAGED}"
  GITHUB_ACTIONS=true SYNO_TEST_ARM=1 SYNO_CLAIM_V2="${2:-1}" SYNO_CLAIM_DIR="$CLAIM_DIR" \
  SYNO_ISSUE_HINT="1217" \
  SYNO_GIT_CACHED_ALL_NAMES="$_st" SYNO_GIT_CACHED_NAMES="$_st" \
  bash "$1" 2>&1 || true
}
# 诊断（失败时打印真正原因，免得下次又只看到"证据为空"）
diag() { # $1=script → BRIEF 解析结果 + 组 6 片段
  local b
  b="$(GITHUB_ACTIONS=true SYNO_TEST_ARM=1 SYNO_CLAIM_V2=1 SYNO_CLAIM_DIR="$CLAIM_DIR" \
       SYNO_ISSUE_HINT=1217 SYNO_GIT_CACHED_ALL_NAMES="${3:-$STAGED}" SYNO_GIT_CACHED_NAMES="${3:-$STAGED}" \
       bash "$REPO/scripts/workflow/resolve-commit-brief.sh" "${3:-$STAGED}" 2>&1 | head -1)"
  printf 'resolver_BRIEF=%s ; 分支=%s ; claim_dir=%s' "${b:-<空>}" "$(git -C "$REPO" branch --show-current 2>/dev/null)" "$CLAIM_DIR"
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
# 前置: 组 6 必须**真的运行**（`DECL_SRC` 空 ⇒ 闸① 无对象 ⇒ 组 6 整段不出，会伪装成"证据为空"）
case "$OUT_PROD" in
  *"组 6"*) ok "前置: 组 6 实际运行（探针的暂存集过了 src 前缀过滤 ⇒ DECL_SRC 非空）" ;;
  *) no "前置失败: 组 6 未运行 —— DECL_SRC 为空（闸① 无对象）。暂存集须含 src/|tests/|packages/|scripts/ 前缀文件；$(diag "$PC")" ;;
esac
# 🔴 补漏测态（Lead 2026-10-08 派单）—— verifier 当时只用「无 D# 的分支名」验证，未覆盖:
#   ⓐ 宿主分支名**含 D# 但不是 claim 的 issue**（如 feat/D1220-*）ⓑ 暂存写集**不命中**任何 claim 的 writeset。
#   该态下 claim-first ① 只能靠 `SYNO_ISSUE_HINT` 命中 ⇒ 这正是"与分支名解耦"的真正承重点。
OUT_STATE="$(probe "$PC" 1 "scripts/no-claim-writeset.sh")"
if evidence "$OUT_STATE"; then
  ok "漏测态（分支含 D# + 暂存写集不命中 claim）：claim 证据仍在 ⇒ 解耦承重点 = SYNO_ISSUE_HINT（非分支名/非 writeset 兜底）"
else
  no "漏测态失败：claim 证据消失 —— $(diag "$PC" 1 "scripts/no-claim-writeset.sh")"
fi
# ⓑ 判别力: 同一态下**不给 HINT** ⇒ 证据应消失（证明 HINT 是承重点，而非别处顺手成立）
OUT_NOHINT="$(GITHUB_ACTIONS=true SYNO_TEST_ARM=1 SYNO_CLAIM_V2=1 SYNO_CLAIM_DIR="$CLAIM_DIR" \
  SYNO_GIT_CACHED_ALL_NAMES="scripts/no-claim-writeset.sh" SYNO_GIT_CACHED_NAMES="scripts/no-claim-writeset.sh" \
  bash "$PC" 2>&1 || true)"
if evidence "$OUT_NOHINT"; then
  ok "承重点判别: 不给 HINT 时证据仍在（分支名/writeset 也能命中）—— 附注，不计失败"
else
  ok "承重点判别: 不给 HINT ⇒ 证据消失（该态下确由 SYNO_ISSUE_HINT 承载解耦）"
fi
# ⓒ 宿主分支本就带 D# 时，主判据仍须成立（覆盖 verifier 未测态）
case "$BR_NOW" in
  *D[0-9]*) if evidence "$OUT_PROD"; then
              ok "状态矩阵: 宿主分支 ${BR_NOW} 带 D# ⇒ 主判据（claim 证据）仍成立"
            else
              no "状态矩阵: 分支 ${BR_NOW} 带 D# ⇒ claim 证据消失 —— $(diag "$PC")"
            fi ;;
  *) ok "状态矩阵: 宿主分支 ${BR_NOW} 不含 D#（另一态由 CI 的 PR 分支覆盖；本条为附注）" ;;
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







# ══════════════════════════════════════════════════════════════════════════════
# 卡 #1423（D-C 最后一刀）: SYNO_CLAIM_V2 默认翻「开」+ 存量 D# 反例守护
#   创始人 2026-10-08：「**一步到位**，但是**现在还带 D 的任务也不要影响他们合并**」
#   ⇒ 两条同时满足: 禁"新建 D#"（默认开 ⇒ 新任务走 issue 号）＋ 保"存量 D#"（只读兼容）
#   判据来源: 卡 #1423 判据③（反例）④（新格式 + 变异体）；本段融合进本夹具是为守 D734 的
#   12 文件 PR 预算（Lead 今日反复强调"PR 体积不搅混判据面"），不新开文件。
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 卡 #1423: 默认开三态 + 判据③反例 + 判据④新格式（含两处变异体）──"
PYBIN="${PYBIN:-}"
if [ -z "$PYBIN" ]; then
  for _c in python3 python py; do
    if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
  done
fi
if [ -z "$PYBIN" ]; then
  no "卡 #1423 §环境: 无可用 python（本条判红，不静默跳过）"
else
  # ── §1 单一事实源三态 ──
  F_UNSET="$(env -u SYNO_CLAIM_V2 "$PYBIN" -B "$CS" --flag 2>/dev/null || true)"  # swallow-ok: 失败即空 → 断言判红
  F_OFF="$(SYNO_CLAIM_V2=0 "$PYBIN" -B "$CS" --flag 2>/dev/null || true)"        # swallow-ok: 同上
  F_ON="$(SYNO_CLAIM_V2=1 "$PYBIN" -B "$CS" --flag 2>/dev/null || true)"         # swallow-ok: 同上
  [ "$F_UNSET" = "on" ] && ok "#1423 §1 未设 ⇒ on（默认开: 新任务走 issue 号身份）" || no "#1423 §1 未设应为 on，实得 '${F_UNSET}'"
  [ "$F_OFF" = "off" ] && ok "#1423 §1 显式 0 ⇒ off（唯一回滚点）" || no "#1423 §1 显式 0 应为 off，实得 '${F_OFF}'"
  [ "$F_ON" = "on" ] && ok "#1423 §1 显式 1 ⇒ on（兼容旧写法）" || no "#1423 §1 显式 1 应为 on，实得 '${F_ON}'"
  # ── §2 四处 bash 解析点口径一致（防漏改漂移）──
  for _f in scripts/workflow/resolve-commit-brief.sh scripts/check-verifiable-done.sh scripts/pre-commit-check.sh; do
    if grep -q "''|1|true|on|yes|y) CLAIM_V2=1" "$REPO/$_f"; then
      ok "#1423 §2 口径已翻（未设⇒开）: $(basename "$_f")"
    else
      no "#1423 §2 口径未翻（仍默认关）: $_f"
    fi
  done
  if grep -q "_BCV_V2=1" "$REPO/scripts/check-brief-vs-code.sh"; then
    ok "#1423 §2 口径已翻（未设⇒开）: check-brief-vs-code.sh"
  else
    no "#1423 §2 口径未翻（仍默认关）: scripts/check-brief-vs-code.sh"
  fi

  # ── 沙箱工厂（带 D# 在飞形态 / claim 新格式形态）──
  T1423="$(mktemp -d)"; trap 'rm -rf "$T1423"' EXIT
  D3="$(date -v-3d +%Y-%m-%d 2>/dev/null || date -d '3 days ago' +%Y-%m-%d)"
  mk1423() {  # <dir> <kind: dinflight|claimnew>
    local d="$1" kind="$2"
    mkdir -p "$d/.claude/task-briefs" "$d/.claude/claims" "$d/src"
    cp -R "$REPO/scripts" "$d/scripts"
    printf 'node_modules/\n.env\n' > "$d/.gitignore"
    git -C "$d" init -q -b main >/dev/null 2>&1
    echo x > "$d/src/test.sh"; git -C "$d" add -A >/dev/null 2>&1
    git -C "$d" -c user.name=t -c user.email=t@t commit -qm "chore: base" >/dev/null 2>&1
    case "$kind" in
      dinflight)
        git -C "$d" checkout -qb feat/D9999-inflight >/dev/null 2>&1
        cat > "$d/.claude/task-briefs/${D3}-D9999-inflight.md" <<'BEOF'
## Q2: 范围
做什么:
- src/test.sh
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] verify: echo 1
BEOF
        ;;
      claimnew)
        git -C "$d" checkout -qb feat/9999-newformat >/dev/null 2>&1
        printf 'writeset:\n  - src/test.sh\ndone:\n  - verify: bash tests/x.sh\nnote: 卡 #1423 新格式探针\n' > "$d/.claude/claims/9999.yaml"
        ;;
    esac
  }
  p1423() {  # <sb> [v2模式: unset|0|1] [staged] → stdout
    local sb="$1" mode="${2:-unset}" st="${3:-src/test.sh}"
    local envs=(GITHUB_ACTIONS=true SYNO_TEST_ARM=1 SYNO_CLAIM_DIR="$sb/.claude/claims"
                SYNO_GIT_CACHED_ALL_NAMES="$st" SYNO_GIT_CACHED_NAMES="$st")
    case "$mode" in
      0) envs+=(SYNO_CLAIM_V2=0) ;;
      1) envs+=(SYNO_CLAIM_V2=1) ;;
      *) : ;;
    esac
    ( cd "$sb" && env "${envs[@]}" bash scripts/pre-commit-check.sh 2>&1 || true )
  }

  # ── 判据③ 反例: 窗口外 D# brief + 开关未设（=默认开）⇒ 组 12 不得硬阻断 ──
  SB_D="$T1423/dinflight"; mk1423 "$SB_D" dinflight
  OUT_INFLIGHT="$(p1423 "$SB_D" unset)"
  if printf '%s' "$OUT_INFLIGHT" | grep -q '并入 resolver 定位的 legacy 声明'; then
    ok "#1423 判据③: 窗口外 D# brief 被并入 legacy 判定（存量 D# 只读兼容）"
  else
    no "#1423 判据③ 守护未生效: $(printf '%s' "$OUT_INFLIGHT" | grep -aE '组 12' | head -2)"
  fi
  if printf '%s' "$OUT_INFLIGHT" | grep -q '未被任何 claim 声明覆盖；且本提交无 legacy brief 载体'; then
    no "#1423 判据③: 在飞 D# 被判「无 legacy 载体」= 误拦（创始人明令禁止的后果）"
  else
    ok "#1423 判据③: 未出现「无 legacy brief 载体」误判"
  fi
  printf '%s' "$OUT_INFLIGHT" | grep -q '✅ 声明闸② brief↔代码一致性' \
    && ok "#1423 判据③: 组 12 / 声明闸② 判绿（在飞 D# 分支可继续提交）" \
    || no "#1423 判据③: 声明闸② 未判绿: $(printf '%s' "$OUT_INFLIGHT" | grep -aE '声明闸②' | head -1)"

  # ── 判据③ 变异体: 中和守护段 ⇒ 误拦复现（承重点证明）──
  SB_DM="$T1423/dinflight-mut"; cp -R "$SB_D" "$SB_DM"
  "$PYBIN" - "$SB_DM/scripts/pre-commit-check.sh" >"$T1423/mut3.log" 2>&1 <<'PYM3'
import sys
from pathlib import Path
p = Path(sys.argv[1]); t = p.read_text(encoding='utf-8')
anchor = 'if [ "${CLAIM_V2:-0}" = "1" ] && [ -n "${BRIEF:-}" ] && [ "${IS_CLAIM_DECL:-0}" != "1" ] && [ -f "$BRIEF" ]; then'
assert anchor in t, '夹具写集漂移：未找到 #1423 守护段锚点'
p.write_text(t.replace(anchor, 'if false; then  # MUTANT: 守护段被中和', 1), encoding='utf-8')
print('判据③变异注入: 守护段中和')
PYM3
  OUT_MUT3="$(p1423 "$SB_DM" unset)"
  printf '%s' "$OUT_MUT3" | grep -q '未被任何 claim 声明覆盖；且本提交无 legacy brief 载体' \
    && ok "#1423 判据③变异体: 中和守护 ⇒ 误拦复现 ⇒ §③ 必红（守护是承重点）" \
    || no "#1423 判据③变异体: 中和守护后误拦未复现 —— 判别力失效"

  # ── 卡 #1423④ 端到端之**CI 面**: 分离头检出下 claim 仍须可达（否则"新格式只在本机成立"）──
  SB_H="$T1423/cihint"; mk1423 "$SB_H" claimnew
  git -C "$SB_H" checkout -q --detach HEAD 2>/dev/null || true   # 模拟 CI PR 检出（分离头 ⇒ 无常驻分支名）
  R_NO_HINT="$(cd "$SB_H" && bash scripts/workflow/resolve-commit-brief.sh "" 2>/dev/null | head -1 || true)"
  case "$R_NO_HINT" in
    *.yaml) ok "#1423 CI 面判别: 无 hint 时也可能命中 claim（附注，不计失败）" ;;
    *) ok "#1423 CI 面判别: 分离头 + **无 hint** ⇒ 取不到 claim（实得 ${R_NO_HINT##*/}）—— 这正是 CI 红机制" ;;
  esac
  R_HINT="$(cd "$SB_H" && GITHUB_HEAD_REF=feat/9999-newformat bash scripts/workflow/resolve-commit-brief.sh "" 2>/dev/null | head -1 || true)"
  case "$R_HINT" in
    *.yaml) ok "#1423 CI 面修复: GITHUB_HEAD_REF（PR 源分支）作 hint ⇒ 分离头下仍返回 claim ⇒ 新格式在 CI 端到端成立" ;;
    *) no "#1423 CI 面修复: 带 GITHUB_HEAD_REF 仍未取到 claim（实得 '${R_HINT}'）" ;;
  esac
  # 刻意不用 GITHUB_REF_NAME（PR 下 = `<PR号>/merge`，PR 号 ≠ issue 号 ⇒ 指向错 claim）
  # 只查**代码行**（注释里出现该字面量是"刻意不用"的说明，属正常）
  if grep -v '^[[:space:]]*#' "$REPO/scripts/workflow/resolve-commit-brief.sh" | grep -q 'GITHUB_REF_NAME'; then
    no "#1423 误用 GITHUB_REF_NAME（PR 号 ≠ issue 号 ⇒ 身份错）"
  else
    ok "#1423 未误用 GITHUB_REF_NAME（只用 PR 源分支 GITHUB_HEAD_REF）"
  fi

  # ── 判据④ 正向: claim 新格式端到端（开关未设）──
  SB_C="$T1423/claimnew"; mk1423 "$SB_C" claimnew
  RESOLVED="$(cd "$SB_C" && SYNO_ISSUE_HINT=9999 bash scripts/workflow/resolve-commit-brief.sh "src/test.sh" 2>/dev/null | head -1 || true)"  # swallow-ok: 失败即空 → 断言判红
  case "$RESOLVED" in
    *.yaml) ok "#1423 判据④: 开关未设下 resolver 返回 claim 载体 ⇒ 新格式身份生效" ;;
    *) no "#1423 判据④: 开关未设下 resolver 未返回 claim（实得 '${RESOLVED}'）" ;;
  esac
  OUT_NEW="$(cd "$SB_C" && env GITHUB_ACTIONS=true SYNO_TEST_ARM=1 SYNO_ISSUE_HINT=9999 \
    SYNO_CLAIM_DIR="$SB_C/.claude/claims" SYNO_GIT_CACHED_ALL_NAMES="src/test.sh" SYNO_GIT_CACHED_NAMES="src/test.sh" \
    bash scripts/pre-commit-check.sh 2>&1 || true)"
  printf '%s' "$OUT_NEW" | grep -q '声明载体 = claim' \
    && ok "#1423 判据④: 组 6 走 claim 分支（新格式端到端成立）" \
    || no "#1423 判据④: 组 6 未走 claim 分支: $(printf '%s' "$OUT_NEW" | grep -aE '组 6|task brief' | head -2)"

  # ── 判据④ 变异体（回滚态 = 显式关）⇒ 新格式不可提交 ──
  OUT_NEW_OFF="$(cd "$SB_C" && env GITHUB_ACTIONS=true SYNO_TEST_ARM=1 SYNO_CLAIM_V2=0 SYNO_ISSUE_HINT=9999 \
    SYNO_CLAIM_DIR="$SB_C/.claude/claims" SYNO_GIT_CACHED_ALL_NAMES="src/test.sh" SYNO_GIT_CACHED_NAMES="src/test.sh" \
    bash scripts/pre-commit-check.sh 2>&1 || true)"
  printf '%s' "$OUT_NEW_OFF" | grep -q '今日无 task brief' \
    && ok "#1423 判据④变异体: 显式回滚 ⇒ 新格式报「今日无 task brief」不可提交 ⇒ 默认开是承重点" \
    || no "#1423 判据④变异体: 回滚态未使新格式失败 —— 判别力失效: $(printf '%s' "$OUT_NEW_OFF" | grep -aE '组 6|task brief' | head -2)"
  printf '%s' "$OUT_NEW_OFF" | grep -q '声明载体 = claim' \
    && no "#1423 判据④变异体: 回滚态仍走 claim 分支（开关未真正门控）" \
    || ok "#1423 判据④变异体: 回滚态不走 claim 分支（门控真实）"

  # ── 回滚语义: 显式 0 ⇒ 组 12 逐字节 legacy（#1423 守护段不可达）──
  OUT_ROLLBACK="$(p1423 "$SB_D" 0)"
  printf '%s' "$OUT_ROLLBACK" | grep -q '并入 resolver 定位的 legacy 声明' \
    && no "#1423 回滚态出现守护行（回滚应与改前逐字节一致）" \
    || ok "#1423 回滚语义: 显式 0 ⇒ 组 12 逐字节 legacy（守护段不可达）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
