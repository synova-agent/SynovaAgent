#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# ci-docsonly-push-guard.test.sh — W2/D1165 判别夹具
#
# 治的病（实测 as_of 2026-10-06）: docs-only 早退在 **push 事件**上恒成立 ——
#   main push 时 `git diff --name-only origin/main...HEAD` 恒为空 ⇒ `grep -qvE` 无命中（返 1）
#   ⇒ 恒判 `docs_only=true` ⇒ 该 run 内所有 job 的 `npm ci` / tsc / vitest / hermetic 全部 skip，
#   而 job 仍以 success 上报必需 context。实证: 最近 8 个 main push run 的 `npm ci` 全 skipped，
#   同期 main 的 lock 实际必红于 ERESOLVE ⇒ **main 的「绿」是跳过型绿**。
#
# 契约（铁律 47）
#   @input  env SYNO_CI_YML  被测 ci.yml 路径（默认 .github/workflows/ci.yml）
#           env SYNO_CI      "1" = HARD（任一 FAIL ⇒ exit 1）；其它/未设 = SOFT（照常打印，exit 0）
#   @output 逐条 `PASS/FAIL <name> expect=<v> got=<v>` + 末行 `RESULT: <n> PASS / <m> FAIL`
#   @exit   0 = 全 PASS（或 SOFT 下有 FAIL）；1 = HARD 下有 FAIL；2 = 调用错误/夹具自身失败
#   @degraded 被测 ci.yml 缺失 ⇒ 显式 ERROR + exit 2（两种模式都退 2，绝不静默当 PASS）
#
# 判别性设计（V-08「改坏即红」，含**反例**）:
#   · 正例: push + 纯文档变更 ⇒ 必须 docs_only=**false**（守卫生效）
#   · 对照: pull_request + 纯文档变更 ⇒ 必须 docs_only=**true**（白名单语义未被本条改坏）
#   · 反例（判别力来源）: 把 ci.yml 里守卫那 4 行**剥掉**再跑同一 push 用例
#     ⇒ 必须得到 docs_only=**true**（否则说明本夹具的 push 用例根本没有判别力 = 纸老虎）
#
# 单一真值源: 被测脚本**从 ci.yml 提取**（10 个 `Detect docs-only change (D515)` step 的 run 体），
#   绝不抄死在夹具里（抄死 = 夹具与真值漂移，夹具就失去判别力）。
#
# 隔离: 全部在 mktemp 沙箱内建独立 git 仓（含 refs/remotes/origin/main），不碰真实仓库。
# 兼容性: macOS bash 3.2（禁 mapfile / 禁关联数组）；故意不用 set -e（要跑完全部用例再汇总）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

CI_YML="${SYNO_CI_YML:-.github/workflows/ci.yml}"
PASS_N=0; FAIL_N=0
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

if [ ! -f "$CI_YML" ]; then
  echo "ERROR: 被测 ci.yml 不存在: $CI_YML" >&2
  exit 2
fi
if [ "${SYNO_CI:-}" = "1" ]; then MODE_LABEL="HARD"; else MODE_LABEL="SOFT"; fi

report() { # <name> <expect> <got>
  if [ "$2" = "$3" ]; then echo "PASS $1 expect=$2 got=$3"; PASS_N=$((PASS_N+1));
  else echo "FAIL $1 expect=$2 got=$3"; FAIL_N=$((FAIL_N+1)); fi
}

echo "=== W2/D1165 docs-only push 守卫判别夹具 ==="
echo "ci.yml       : $CI_YML"
echo "SOFT/HARD mode: $MODE_LABEL"
echo

# ── 单一真值源: 提取 10 个 Detect docs-only step 的 run 体 ──────────────────────
python3 - "$CI_YML" "$TMPD" <<'PY'
import io, os, sys
ci, tmpd = sys.argv[1], sys.argv[2]
lines = io.open(ci, encoding="utf-8").read().split("\n")
STEP = "      - name: Detect docs-only change (D515)"
bodies = []; i = 0
while i < len(lines):
    if lines[i] == STEP:
        j = i + 1
        while j < len(lines) and lines[j] != "        run: |":
            j += 1
        k = j + 1; body = []
        while k < len(lines) and (lines[k].startswith("          ") or lines[k].strip() == ""):
            body.append(lines[k]); k += 1
        while body and body[-1].strip() == "": body.pop()
        bodies.append("\n".join(body)); i = k; continue
    i += 1
os.makedirs(tmpd, exist_ok=True)
for n, b in enumerate(bodies):
    io.open(os.path.join(tmpd, "detect-%d.sh" % n), "w", encoding="utf-8").write(b + "\n")
# 反例载体: 剥掉守卫那 4 行（`if [ "${GITHUB_EVENT_NAME:-}" = "push" ]` … `fi`）
stripped = []
for b in bodies:
    out = []; skip = False
    for ln in b.split("\n"):
        if ln.strip().startswith('if [ "${GITHUB_EVENT_NAME:-}" = "push" ]'):
            skip = True; continue
        if skip:
            if ln.strip() == "fi": skip = False
            continue
        out.append(ln)
    stripped.append("\n".join(out))
for n, b in enumerate(stripped):
    io.open(os.path.join(tmpd, "nostrip-%d.sh" % n), "w", encoding="utf-8").write(b + "\n")
print("提取到 %d 个 detect 体" % len(bodies))
PY
DETECT_N=$(ls "$TMPD"/detect-*.sh 2>/dev/null | wc -l | tr -d ' ')  # swallow-ok: 下方紧接 DETECT_N != 10 的显式 fail-closed（exit 2），未静默
if [ "$DETECT_N" != "10" ]; then echo "ERROR: 期望 10 个 detect 体，实得 $DETECT_N（提取失败）" >&2; exit 2; fi

# ③ 结构断言: 每个 detect 体都含守卫（10/10 同源）
GUARD_N=$(grep -l 'GITHUB_EVENT_NAME:-}" = "push"' "$TMPD"/detect-*.sh 2>/dev/null | wc -l | tr -d ' ')  # swallow-ok: 结果直接进下方 report 断言（计数不符即 FAIL），未静默
report "struct-guard-in-all-10-detects" "10" "$GUARD_N"

# ── 沙箱仓: 建 refs/remotes/origin/main，再做一个**纯文档**变更 ────────────────
SB="$TMPD/repo"; mkdir -p "$SB"; cd "$SB" || exit 2
git init -q . >/dev/null 2>&1 || { echo "ERROR: 沙箱 git init 失败" >&2; exit 2; }
git config user.name t; git config user.email t@t
git config commit.gpgsign false
mkdir -p docs
echo base > docs/x.md
git add -A >/dev/null 2>&1 && git commit -qm base >/dev/null 2>&1 || { echo "ERROR: 沙箱 base 提交失败" >&2; exit 2; }
BASE_SHA="$(git rev-parse HEAD)"
git update-ref refs/remotes/origin/main "$BASE_SHA" || { echo "ERROR: 建 origin/main 失败" >&2; exit 2; }
# 纯文档变更（白名单内: docs/**.md）
echo more >> docs/x.md
git add -A >/dev/null 2>&1 && git commit -qm "docs-only change" >/dev/null 2>&1 || { echo "ERROR: 沙箱 docs 提交失败" >&2; exit 2; }
cd - >/dev/null || exit 2

# run_detect <script> <event> → 打印 docs_only 值
run_detect() {
  _s="$1"; _ev="$2"
  : > "$TMPD/out.txt"
  ( cd "$SB" && env GITHUB_EVENT_NAME="$_ev" GITHUB_OUTPUT="$TMPD/out.txt" bash "$_s" >/dev/null 2>&1 )
  grep -m1 '^docs_only=' "$TMPD/out.txt" 2>/dev/null | sed 's/^docs_only=//' | tr -d '\r\n'  # swallow-ok: 取不到即输出空串，由调用处 report 与期望值比对判 FAIL，未静默
}

# ① 正例: push ⇒ docs_only=false（守卫生效）
PUSH_GOT="$(run_detect "$TMPD/detect-0.sh" push)"
report "push-goes-full" "false" "$PUSH_GOT"

# ② 对照: pull_request ⇒ docs_only=true（白名单语义未被本条改坏）
PR_GOT="$(run_detect "$TMPD/detect-0.sh" pull_request)"
report "pull-request-docsonly-still-skips" "true" "$PR_GOT"

# ③ 反例（判别力来源）: 剥掉守卫再跑同一 push 用例 ⇒ 必须 true，否则用例无判别力
NOSTRIP_GOT="$(run_detect "$TMPD/nostrip-0.sh" push)"
report "negative-control-guard-stripped-push-skips" "true" "$NOSTRIP_GOT"

echo
echo "RESULT: $PASS_N PASS / $FAIL_N FAIL"
echo "SOFT/HARD mode: $MODE_LABEL"
if [ "$FAIL_N" -gt 0 ] && [ "$MODE_LABEL" = "HARD" ]; then exit 1; fi
exit 0
