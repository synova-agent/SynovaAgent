#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-ci-empty-green.test.sh — 配对测试（CT-40/U7：「控制塔脚本须有配对测试」）
#
# 被测对象：`scripts/control-tower/check-ci-empty-green.sh`（CI step 级空绿判据 · #1095 W4）
#
# 判什么（不是"跑一遍看看"）:
#   ① 契约缝：`--summary` / `--results` 同义、`--env` 单条、缺省路径回落 —— 真被消费（行为断言）
#   ② 三态：0 通过 ／ 1 真红 ／ **2 判不了**（缺文件·0 条记录·缺 test_count ⇒ 2，禁假绿）
#   ③ **改坏即红**（纪律③）：把 `test_count>0` 判据改成 `-ge 0` ⇒ 空绿夹具**不再判红**
#      ⇒ 断言从 rc=1 变 rc=0 = 该判据确有判别力（改坏后原断言失效）
#   ④ 接线（WIRE CHECK）：`.gitea/workflows/local-gates.yml` 真调用本器且写 `$GITHUB_OUTPUT`
#   ⑤ 型 D 防误伤：全程只写 `mktemp -d` 沙箱，不改真工作流/真脚本（跑前跑后哈希一致）
#   ⑥ 判不了归 2（#1112 W6 接线）：判据出口码一律经 `gate-assert.sh` 的 `ga_run` 归一 ——
#      判据自身异常（judge_file 返回 128）⇒ 2 而非原样穿透；归一库缺失 ⇒ 2；归一里 128→0 改坏 ⇒ 断言失效
#
# 断言风格对齐 `tests/control-tower/declare-write-set.test.sh`（ok/no 计数 ＋ 末行结果行）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="$REPO/scripts/control-tower/check-ci-empty-green.sh"
WF="$REPO/.gitea/workflows/local-gates.yml"
GA="$REPO/scripts/control-tower/gate-assert.sh"

PASS=0; FAIL=0
FAILED_DIGEST=""
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); FAILED_DIGEST="${FAILED_DIGEST}${1} ; "; }
# 跑一次并把 stdout/stderr 分开（stderr 只需非空判定，不污染断言文本）
#   $1 = 夹具文件；其余 = 追加参数
run_case() {
  local f="$1"; shift
  OUT="$(bash "$S" "$@" "$f" 2>"$TMP/err.txt")"; RC=$?
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "=== check-ci-empty-green 配对测试 ==="

# ── ① 存在 / 可执行 / 语法 ──────────────────────────────────────────────────
if [ -f "$S" ]; then ok "脚本存在"; else no "脚本不存在: $S"; fi
if bash -n "$S" >/dev/null 2>&1; then ok "语法可过（bash -n）"; else no "语法错（bash -n）"; fi
if [ -f "$GA" ]; then ok "归一库存在（gate-assert.sh）"; else no "归一库不存在: $GA"; fi

# ── ⑤ 防误伤基线：真脚本 + 真工作流哈希（跑前）────────────────────────────
hash_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    cksum "$1" | awk '{print $1"-"$2}'
  fi
}
H_S_BEFORE="$(hash_of "$S")"
H_W_BEFORE="$(hash_of "$WF")"

# ── ② 正常：test_count=12 ⇒ 0（并点名计数）─────────────────────────────────
printf '%s\n' 'step=③ 增量测试 status=ran test_count=12 reason=' > "$TMP/ok.env"
run_case "$TMP/ok.env" --summary
if [ "$RC" -eq 0 ]; then ok "正常（test_count=12）⇒ rc=0"; else no "正常应 rc=0，实得 ${RC}"; fi
case "$OUT" in *"test_count=12"*) ok "正常：输出点名 test_count=12" ;; *) no "正常：输出未点名 test_count" ;; esac
case "$OUT" in *"CI-EMPTY-GREEN: PASS"*) ok "正常：汇总口径 PASS 行在场" ;; *) no "正常：缺 CI-EMPTY-GREEN: PASS 汇总行" ;; esac

# ── ③ 异常空绿：test_count=0 且未声明跳过 ⇒ 1 ───────────────────────────────
printf '%s\n' 'step=③ 增量测试 status=ran test_count=0 reason=' > "$TMP/empty.env"
run_case "$TMP/empty.env" --summary
if [ "$RC" -eq 1 ]; then ok "test_count=0（未声明跳过）⇒ rc=1"; else no "空绿应 rc=1，实得 ${RC}"; fi
case "$OUT" in *"异常空绿"*) ok "空绿：失败点具体（点名「异常空绿」）" ;; *) no "空绿：未点名「异常空绿」" ;; esac

# ── ④ 关键 step 被 skipped 且**无未运行原因** ⇒ 1（禁静默跳过）────────────
printf '%s\n' 'step=③ 增量测试 status=skipped test_count=0 reason=' > "$TMP/skip-no-reason.env"
run_case "$TMP/skip-no-reason.env" --summary
if [ "$RC" -eq 1 ]; then ok "skipped 无未运行原因 ⇒ rc=1"; else no "skipped 无原因应 rc=1，实得 ${RC}"; fi
case "$OUT" in *"未写未运行原因"*) ok "skipped 无原因：失败点具体" ;; *) no "skipped 无原因：未点名原因缺失" ;; esac

# ── ⑤ 正当跳过（带原因）⇒ 0，且**不计入通过** ──────────────────────────────
printf '%s\n' 'step=③ 增量测试 status=skipped test_count=0 reason=变更集未触及可测面（纯文档）' > "$TMP/skip-ok.env"
run_case "$TMP/skip-ok.env" --results
if [ "$RC" -eq 0 ]; then ok "正当跳过（带原因）⇒ rc=0"; else no "正当跳过应 rc=0，实得 ${RC}"; fi
case "$OUT" in *"不计入通过"*) ok "正当跳过：显式标注「不计入通过」" ;; *) no "正当跳过：未标注「不计入通过」" ;; esac
case "$OUT" in *"CI-EMPTY-GREEN: SKIP-ONLY"*) ok "正当跳过：汇总口径 SKIP-ONLY（不冒充 PASS）" ;; *) no "正当跳过：汇总口径未降为 SKIP-ONLY" ;; esac

# ── ⑥ 判不了①：记录文件不存在 ⇒ 2 ＋ stderr degraded ──────────────────────
OUT="$(bash "$S" --summary "$TMP/不存在.env" 2>"$TMP/err.txt")"; RC=$?
if [ "$RC" -eq 2 ]; then ok "无 summary（文件不存在）⇒ rc=2（判不了，非通过）"; else no "无 summary 应 rc=2，实得 ${RC}"; fi
case "$OUT" in *"UNJUDGED reason=no-input"*) ok "无 summary：汇总口径 UNJUDGED" ;; *) no "无 summary：汇总口径未标 UNJUDGED" ;; esac
if [ -s "$TMP/err.txt" ]; then ok "无 summary：stderr 有 degraded 行（不静默）"; else no "无 summary：stderr 无 degraded 行"; fi

# ── ⑦ 判不了②：0 条记录（信号量==0）⇒ 2 ──────────────────────────────────
printf '%s\n' '# 只有注释，没有记录' > "$TMP/zero.env"
run_case "$TMP/zero.env" --summary
if [ "$RC" -eq 2 ]; then ok "0 条记录 ⇒ rc=2（信号量==0 ⇒ 不冒充通过）"; else no "0 条记录应 rc=2，实得 ${RC}"; fi
case "$OUT" in *"信号量==0"*) ok "0 条记录：失败点具体" ;; *) no "0 条记录：未点名信号量" ;; esac

# ── ⑧ 判不了③：记录缺 test_count ⇒ 2（fail-closed）──────────────────────
printf '%s\n' 'step=③ 增量测试 status=ran reason=' > "$TMP/no-tc.env"
run_case "$TMP/no-tc.env" --summary
if [ "$RC" -eq 2 ]; then ok "记录缺 test_count ⇒ rc=2"; else no "缺 test_count 应 rc=2，实得 ${RC}"; fi

# ── ⑨ --env 单条模式（环境变量缝真被消费）────────────────────────────────
OUT="$(CI_TEST_COUNT=5 CI_STEP_ID=③ bash "$S" --env 2>/dev/null)"; RC=$?  # swallow-ok: 本用例只判 rc/stdout；stderr 的 degraded 行由 ⑥ 单独断言
if [ "$RC" -eq 0 ]; then ok "--env 模式：CI_TEST_COUNT=5 ⇒ rc=0"; else no "--env 模式应 rc=0，实得 ${RC}"; fi
OUT="$(CI_TEST_COUNT=0 CI_STEP_ID=③ bash "$S" --env 2>/dev/null)"; RC=$?  # swallow-ok: 同上（只判 rc/stdout）
if [ "$RC" -eq 1 ]; then ok "--env 模式：CI_TEST_COUNT=0 ⇒ rc=1（空绿仍红）"; else no "--env 模式空绿应 rc=1，实得 ${RC}"; fi

# ── ⑩ --selfcheck（判别力自检）⇒ 0 且自报场景数 ───────────────────────────
OUT="$(bash "$S" --selfcheck 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "--selfcheck ⇒ rc=0"; else no "--selfcheck 应 rc=0，实得 ${RC}"; fi
case "$OUT" in *"selfcheck: PASS 9/9"*) ok "--selfcheck 自报 9/9（场景未被悄悄删）" ;; *) no "--selfcheck 场景数不符（期望 9/9）: $(printf '%s' "$OUT" | tail -1)" ;; esac

# ── ⑪ 改坏即红（纪律③）：把 `test_count>0` 改成 `-ge 0` ⇒ 空绿夹具不再红 ──
#   判据只有一处（`if [ "$tc" -gt 0 ]; then`）⇒ 单点改坏即可验「该行真的在承重」。
#   期望：改坏版 rc 从 1 变 0（原断言失效）。若改坏后**仍** rc=1 ⇒ 该行没承重（或改坏没生效）。
#   🔴 #1112 接线后被测件依赖同目录 gate-assert.sh（归一入口）⇒ 变异体必须与归一库同目录，
#      否则「判不了(2)」会掩盖「判据被改坏」这一个变量（本用例只许变一个变量）。
cp "$GA" "$TMP/gate-assert.sh"
MUT="$TMP/mut.sh"
sed 's/\$tc" -gt 0/\$tc" -ge 0/' "$S" > "$MUT"
if cmp -s "$S" "$MUT"; then
  no "改坏即红：sed 未命中判据行（判据位置变了 ⇒ 本用例需同步）"
else
  MUT_OUT="$(bash "$MUT" --summary "$TMP/empty.env" 2>&1)"; MUT_RC=$?
  if [ "$MUT_RC" -eq 0 ]; then
    ok "改坏即红：判据改恒真 ⇒ 空绿夹具不再判红（rc 1→0，原断言失效）"
  else
    no "改坏即红：改坏后仍 rc=${MUT_RC} ⇒ test_count 判据不承重（或在别处兜底）"
  fi
  case "$MUT_OUT" in *"异常空绿"*) no "改坏即红：改坏版仍点名「异常空绿」（兜底掩盖了判据失效）" ;; *) ok "改坏即红：改坏版不再点名异常空绿（判据单点承重）" ;; esac
fi

# ── ⑫ 接线（WIRE CHECK）：workflow 真调用本器 ＋ 关键 step 写 $GITHUB_OUTPUT ──
N_CALL="$(grep -c 'check-ci-empty-green' "$WF" 2>/dev/null || true)"  # swallow-ok: WF 不可读时计数为 0 ⇒ 下面的 `-ge 1` 断言直接判红（不静默放行）
if [ "${N_CALL:-0}" -ge 1 ]; then ok "接线：local-gates.yml 调用本器（命中 ${N_CALL} 处）"; else no "接线：local-gates.yml **未**调用本器（WIRE CHECK 零结果＝未完成）"; fi
N_GHO="$(grep -c 'GITHUB_OUTPUT' "$WF" 2>/dev/null || true)"  # swallow-ok: 同上（读不到 ⇒ 计数 0 ⇒ 断言判红）
if [ "${N_GHO:-0}" -ge 1 ]; then ok "接线：关键 step 写 \$GITHUB_OUTPUT（命中 ${N_GHO} 处）"; else no "接线：关键 step 未写 \$GITHUB_OUTPUT"; fi
N_SUM="$(grep -c 'GITHUB_STEP_SUMMARY' "$WF" 2>/dev/null || true)"  # swallow-ok: 同上（读不到 ⇒ 计数 0 ⇒ 断言判红）
if [ "${N_SUM:-0}" -ge 1 ]; then ok "接线：汇总步写 \$GITHUB_STEP_SUMMARY（命中 ${N_SUM} 处）"; else no "接线：汇总步未写 \$GITHUB_STEP_SUMMARY"; fi
# 语义未变：`always()` 只允许出现在**注释**里（"不做 always"是既有步的既定语义说明），
#   可执行行出现 always() ⇒ ① 先红时后续步仍跑，与既有链语义不一致。
N_ALWAYS="$(grep -v '^[[:space:]]*#' "$WF" 2>/dev/null | grep -c 'always()' || true)"  # swallow-ok: 同上（WF 不可读 ⇒ 计数 0，而"接线"三条断言已会判红）
if [ "${N_ALWAYS:-0}" -eq 0 ]; then ok "工作流可执行行未引入 always()（① 先红后续不执行，语义未变）"; else no "工作流可执行行出现 always()（改用条件语义，禁改链语义）"; fi

# ── ⑬ 判不了归 2（#1112 W6 接线）：判据自身异常（exit 128）⇒ 2，禁原样穿透 ──
#   夹具变异体只改「judge_file 的失败出口」一处（`return 1` ⇒ `return 128`）：判据语义未变，
#   变的是**返回码**。旧版（未接线）会把 128 原样当本器退出码 ⇒ 一个非三态码冒充结论。
echo "── ⑬ 判不了归 2：判据自身异常（judge_file 返回 128）⇒ rc=2 ──"
MUT128="$TMP/mut128.sh"
sed 's/^    return 1$/    return 128/' "$S" > "$MUT128"
if grep -q 'return 128' "$MUT128"; then ok "⑬ 变异点已注入（judge_file 失败出口 ⇒ return 128）"; else no "⑬ 变异点未命中（sed 未命中唯一 return 1）"; fi
OUT="$(bash "$MUT128" --summary "$TMP/empty.env" 2>"$TMP/err.txt")"; RC=$?
if [ "$RC" -eq 2 ]; then ok "⑬ 判据自身异常(128) ⇒ rc=2（经 ga_run 归一）"; else no "⑬ 期望 2 实得 ${RC}（128 原样穿透 ⇒ 非三态退出码）"; fi
case "$(cat "$TMP/err.txt")" in *"判据故障: 128"*) ok "⑬ stderr 点名「判据故障: 128」" ;; *) no "⑬ stderr 未点名「判据故障: 128」" ;; esac

# ── ⑭ 归一库缺失 ⇒ 2（fail-closed，禁把「判不了」当通过）──────────────────
echo "── ⑭ 归一库缺失 ⇒ rc=2 ──"
NOLIB="$TMP/nolib"; mkdir -p "$NOLIB"; cp "$S" "$NOLIB/check-ci-empty-green.sh"
OUT="$(bash "$NOLIB/check-ci-empty-green.sh" --summary "$TMP/ok.env" 2>"$TMP/err.txt")"; RC=$?
if [ "$RC" -eq 2 ]; then ok "⑭ 缺 gate-assert.sh ⇒ rc=2（fail-closed）"; else no "⑭ 期望 2 实得 ${RC}"; fi
case "$OUT" in *"UNJUDGED reason=no-assert-lib"*) ok "⑭ 汇总口径 UNJUDGED（不冒充 PASS）" ;; *) no "⑭ 汇总口径未标 UNJUDGED（$OUT）" ;; esac

# ── ⑮ 改坏即红（纪律③）：归一里 128 分支改成 0（/tmp 副本）⇒ ⑬ 同一断言失效 ──
echo "── ⑮ 改坏即红：归一 128→0 ⇒ ⑬ 的 rc=2 断言失效 ──"
MUTLIB="$TMP/mutlib"; mkdir -p "$MUTLIB"
cp "$MUT128" "$MUTLIB/check-ci-empty-green.sh"
sed 's/^    128).*/    128) printf 0 ;;/' "$GA" > "$MUTLIB/gate-assert.sh"
if grep -q '128) printf 0' "$MUTLIB/gate-assert.sh"; then ok "⑮ 变异点已注入（归一 128 ⇒ 0）"; else no "⑮ 变异点未命中 128 分支"; fi
MUT_OUT="$(bash "$MUTLIB/check-ci-empty-green.sh" --summary "$TMP/empty.env" 2>&1)"; MUT_RC=$?
if [ "$MUT_RC" -eq 0 ]; then
  ok "⑮ 归一改坏后 128 被当通过（rc 2→0 ⇒ ⑬ 必红；证明归一入口承重）"
else
  no "⑮ 期望变异体 rc=0 实得 ${MUT_RC} ⇒ ⑬ 对该变异无判别力"
fi

# ── ⑤ 防误伤：真脚本/真工作流跑前跑后哈希一致（型 D）─────────────────────
H_S_AFTER="$(hash_of "$S")"
H_W_AFTER="$(hash_of "$WF")"
if [ "$H_S_BEFORE" = "$H_S_AFTER" ]; then ok "真脚本零改动（${H_S_BEFORE}）"; else no "真脚本被改写！${H_S_BEFORE} -> ${H_S_AFTER}"; fi
if [ "$H_W_BEFORE" = "$H_W_AFTER" ]; then ok "真工作流零改动（${H_W_BEFORE}）"; else no "真工作流被改写！${H_W_BEFORE} -> ${H_W_AFTER}"; fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && echo "  Status: ✅ check-ci-empty-green 配对测试通过" || echo "  Status: ❌ check-ci-empty-green 配对测试未通过"
# 失败摘要留最后一行（CI 只截 tail 进 ::error 注解）
if [ "$FAIL" -gt 0 ]; then
  echo "❌ FAILED(${FAIL}): ${FAILED_DIGEST}"
fi
exit "$FAIL"
