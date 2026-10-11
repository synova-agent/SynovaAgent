#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# ci-emptygreen-sim.sh — 复跑 `.gitea/workflows/local-gates.yml` 的「③ 增量测试」步
#                         （验创始人裁决②：空绿必须**分类**）
#
# 为什么需要它（纪律③「改坏即红」＋ 纪律④「反例必红本身要被验」）:
#   CI 语义变更无法在本地单测 ⇒ 把该 step 的 bash 正文**逐字抽出**（不复制、不重写），
#   配一个 **vitest 桩** 控制"是否 No test files found"，用**真 git diff** 控变更集 ⇒ 逐场景判。
#
# 契约（铁律 47）:
#   @input  SYNO_EG_WF  被测工作流路径（默认 = 仓内 `.gitea/workflows/local-gates.yml`）
#                       ⇒ 测试可指向**副本**做改坏差分，**不碰真文件**
#   @input  SYNO_EG_WS  沙箱工作区（默认 $TMPDIR/ci-emptygreen-sim）
#   @output 每场景：step 原始 stdout ＋ `✅|❌ [甲|乙|丙|丙2|丁|戊] …`
#   @exit   0 = 全 PASS；1 = 有 FAIL；2 = harness 自身失败
#           （抽不出该步 / 沙箱不可建 / **桩未被执行** —— 禁把「看不见」当「没问题」）
#
# 被测语义（创始人裁决②）:
#   变更集**空**            ⇒ 合法跳过（绿 + 显式标注）
#   变更集**非空且全非代码面** ⇒ 合法跳过·纯文档（绿 + 显式标注）
#   变更集**含代码面** 但 vitest 报 No test files found ⇒ 🔴 **异常 ⇒ exit 1**
#   vitest 真失败（非空绿） ⇒ 照旧 exit 1
#
# ⚠️ 只写 $SYNO_EG_WS，不碰 /Users/wane/.ci-work/**（真 CI 工作区）。
# 用法: bash scripts/control-tower/ci-emptygreen-sim.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# 被测文件默认 = 仓内工作流；测试可用 `SYNO_EG_WF` 指向**副本**做「改坏即红」，
# 从而**不必碰真文件**（型 D：误伤他物）。
WF="${SYNO_EG_WF:-$ROOT/.gitea/workflows/local-gates.yml}"
WS="${SYNO_EG_WS:-${TMPDIR:-/tmp}/ci-emptygreen-sim}"
[ -f "$WF" ] || { echo "harness: workflow 不存在: $WF" >&2; exit 2; }

STEP_BODY="$(awk '
  /^      - name: ③ 增量测试/ { inb=1; next }
  inb && /^      - name: /   { exit }
  inb && /^        run: \|/  { y=1; next }
  y                          { if ($0 ~ /^          /) { sub(/^          /,""); print } else exit }
' "$WF")"
[ -n "$STEP_BODY" ] || { echo "harness: 抽不出「③ 增量测试」步正文" >&2; exit 2; }
echo "═══ 抽出的 step 正文 $(printf '%s\n' "$STEP_BODY" | grep -c .) 行 ═══"

# ── 沙箱：真 git 仓（控变更集）＋ vitest 桩（控空绿）──
rm -rf "$WS"; mkdir -p "$WS/bin" "$WS/repo" || { echo "harness: 沙箱不可建" >&2; exit 2; }
REPO="$WS/repo"
git -C "$REPO" init -q -b local-main
git -C "$REPO" -c user.email=a@b -c user.name=h commit -q --allow-empty -m "base"
git -C "$REPO" branch -M local-main
git -C "$REPO" checkout -q -b feat
# origin/local-main 指向 base（CI 里 origin=本机 Gitea）
git -C "$REPO" update-ref refs/remotes/origin/local-main refs/heads/local-main

# ── vitest 桩：🔴 必须放在 `$REPO/node_modules/.bin/vitest` ──
#   【第三版 · 2026-10-11 实测定案】前两版的桩**从未被执行过**（幻影可跑性 —— 型 B/C）：
#     · 第一版：桩名 `npx` 放 PATH 首 ⇒ 被 step 正文的 `PATH="…/nvm/…/bin:$PATH"` **前置覆盖**
#       ⇒ 解析到真 npx（实测：`npm error code EPERM` / 真 vitest 在 node_modules 上跑）
#     · 第二版：同名 `npx` 垫片 ⇒ **同样被那行 PATH 前置绕过**（实测 `STUB-WAS-CALLED` 从未出现）
#     · 正解：真 `npx` 的解析优先级是 **`$PWD/node_modules/.bin` 先于 PATH**
#       （实测：桩放 PATH 尾 ⇒ 真 npx 接管；桩放 `node_modules/.bin` ⇒ `STUB2-CALLED`）
#       ⇒ 桩位必须**与真 CI 的解析路径一致**（CI 里 `node_modules/vitest` 存在，走的正是这条）
#   ⚠️ 桩只作用于 `$REPO`（沙箱）内的 `node_modules/.bin`，**不动真工作区**。
#   ⚠️ 必须在 `clean -qfdx` **之后**重建（node_modules 是未跟踪目录，会被 clean 清掉）
install_stub() {  # $1 = 桩模式（empty|ok|fail）
  mkdir -p "$REPO/node_modules/.bin"
  # ⚠️ heredoc 定界符**必须带引号**（`<<'STUB'`）：不带引号会在**安装期**把 `$0`/`$REPO`
  #    展开成 harness 自己的路径 ⇒ 桩取到默认模式（实测踩过：丁/戊 恒空绿）。
  cat > "$REPO/node_modules/.bin/vitest" <<'STUB'
#!/usr/bin/env bash
echo "SYNO_EG_STUB_RAN"          # 判别力哨兵：harness 据此断言"桩确实被执行"
case "${SYNO_EG_STUB_MODE:-empty}" in
  ok)     echo " Test Files  1 passed (1)"; echo "      Tests  3 passed (3)"; exit 0 ;;
  fail)   echo " Test Files  1 failed (1)"; echo "      Tests  1 failed | 2 passed (3)"; exit 1 ;;
  *)      echo "No test files found, exiting with code 0"; exit 0 ;;
esac
STUB
  chmod +x "$REPO/node_modules/.bin/vitest"
}

STEP_RUN="$(printf '%s\n' "$STEP_BODY" | sed "s#/Users/wane/.ci-work/SynovaAgent#${REPO}#g")"

FAILS=0
HARNESS_BROKEN=0
run_case() {  # $1=tag $2=stub $3=expect(rc) $4=expect_stdout_substr $5=label $6..=files_to_create
  local tag="$1" stub="$2" want_rc="$3" want_out="$4" label="$5"; shift 5
  # 重置到 base，然后按参数造变更
  git -C "$REPO" checkout -q feat; git -C "$REPO" reset -q --hard local-main
  # 🔴 harness 自纠：`reset --hard` **清不掉未跟踪文件** ⇒ 上一场景的 tests/ 会污染下一场景
  #   （实测症状：丙 走了"真失败"分支而非"异常空绿"；戊 直接失败）。必须 `clean`。
  #   ⚠️ 只 clean **沙箱仓**（$REPO），绝不碰真仓库 —— 创始人边界禁 `clean` 是指工作仓。
  git -C "$REPO" clean -qfdx
  install_stub "$stub"                       # ← clean 之后重建桩（否则桩被清掉 ⇒ 真 vitest 接管）
  local made=0
  for f in "$@"; do mkdir -p "$REPO/$(dirname "$f")"; echo "x" > "$REPO/$f"; made=1; done
  if [ "$made" = "1" ]; then git -C "$REPO" add -A >/dev/null && git -C "$REPO" -c user.email=a@b -c user.name=h commit -q -m "$tag"; fi
  local out rc
  out="$(cd "$REPO" && SYNO_EG_STUB_MODE="$stub" PATH="$WS/bin:$PATH" bash -c "$STEP_RUN" 2>&1)"
  rc=$?
  printf '──── 场景%s（%s）rc=%s（期望 %s）────\n%s\n' "$tag" "$label" "$rc" "$want_rc" "$out"
  # ── 判别力自检（纪律④：「反例必红」本身要被验）──
  #   桩没被执行 ⇒ 本场景在验真 vitest 的行为（与本次改动零相关）⇒ 全部结论作废 ⇒ exit 2
  if ! printf '%s' "$out" | grep -q "SYNO_EG_STUB_RAN"; then
    echo "  ⛔ [${tag}] HARNESS-BROKEN — 桩未被执行（真 vitest/npx 接管）⇒ 该场景结论不可信"
    HARNESS_BROKEN=1; FAILS=$((FAILS+1)); return
  fi
  #   真 npx 的痕迹（EPERM / 真 vitest 版本头）⇒ 说明解析路径又漂了 ⇒ 同上作废
  if printf '%s' "$out" | grep -qE "npm error code|RUN  v[0-9]"; then
    echo "  ⛔ [${tag}] HARNESS-BROKEN — 出现真 npx/vitest 痕迹（桩位失效）⇒ 该场景结论不可信"
    HARNESS_BROKEN=1; FAILS=$((FAILS+1)); return
  fi
  local v="PASS"
  if [ "$rc" != "$want_rc" ]; then v="FAIL(rc_mismatch)"; fi
  [ "$v" = "PASS" ] && { printf '%s' "$out" | grep -q "$want_out" || v="FAIL(未出现期望字样: $want_out)"; }
  if [ "$v" = "PASS" ]; then echo "  ✅ [${tag}] PASS — ${label}"; else echo "  ❌ [${tag}] ${v} — ${label}"; FAILS=$((FAILS+1)); fi
}

# 甲：变更集为空（HEAD == 基线）⇒ 合法跳过·空
git -C "$REPO" checkout -q feat; git -C "$REPO" reset -q --hard local-main
run_case 甲 empty 0 "合法跳过：变更集为空" "变更集空 ⇒ 合法跳过（绿 + 显式标注）"

# 乙：变更集非空但全非代码面（纯文档）⇒ 合法跳过·纯文档
run_case 乙 empty 0 "合法跳过（纯文档）" "纯 docs/ 变更 ⇒ 合法跳过且标注" docs/a.md docs/b.md

# 丙：变更集含代码面（tests/）却空绿 ⇒ 🔴 必须 exit 1
run_case 丙 empty 1 "异常空绿" "含 tests/ 改动却零测试 ⇒ 异常 ⇒ exit 1" tests/x.test.ts

# 丙2：含 src/ 改动却空绿 ⇒ 同样必须 exit 1
run_case 丙2 empty 1 "异常空绿" "含 src/ 改动却零测试 ⇒ 异常 ⇒ exit 1" src/a.ts

# 丁：vitest 真失败 ⇒ 照旧 exit 1（分类不得把真红吃掉）
run_case 丁 fail 1 "增量测试失败" "vitest 真失败 ⇒ exit 1（分类不吞真红）" tests/y.test.ts

# 戊：vitest 真通过 ⇒ exit 0（并须见"真通过"字样 —— 原判据 `exit 0` 是**弱判据**：
#     真 vitest 输出里也有 "exiting with code 0"，无法区分"真跑过"与"空绿"⇒ 收紧）
run_case 戊 ok 0 "1 passed" "vitest 真通过 ⇒ exit 0（不误伤）" tests/z.test.ts

echo
if [ "$HARNESS_BROKEN" -ne 0 ]; then
  echo "CI-EMPTYGREEN-SIM: HARNESS-BROKEN（桩未被执行 ⇒ 场景结论不可信；禁把「看不见」当「没问题」）failures=$FAILS"
  exit 2
fi
if [ "$FAILS" -eq 0 ]; then echo "CI-EMPTYGREEN-SIM: OK（6 场景全 PASS）"; exit 0; fi
echo "CI-EMPTYGREEN-SIM: VIOLATION failures=$FAILS"; exit 1
