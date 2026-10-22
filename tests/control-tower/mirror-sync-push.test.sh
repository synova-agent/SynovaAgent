#!/usr/bin/env bash
# D732 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null   # swallow-ok: locale 不可用时回退默认 locale（非错误路径）
# ═══════════════════════════════════════════════════════════════════════════════
# mirror-sync-push.test.sh — 执行器六条判据 ＋ 判别力自检（任务 #740）
#
# 覆盖（全部零网络：本地 bare 仓当「Gitea」和「GitHub」，信号走注入命令）:
#   ① 落后=0        ⇒ exit 0 / verdict=NOOP / 远端 main 不变 / 不发失败信号
#   ② 落后>0 且 ff  ⇒ exit 0 / verdict=PUSHED / 远端 main == 被推 sha / 门禁有 ALLOW 留痕
#   ③ 分叉 non-ff   ⇒ exit 1 / verdict=FORK / 远端 main 不变 / 无新 merge 提交
#   ④ 推后核 SHA    ⇒ 远端停旧 sha ⇒ exit 2 / verdict=VERIFY_MISMATCH / degraded=true
#   ⑤ 失败必出声    ⇒ ③④⑧ 失败时信号记录 ≥1 条且含 verdict（不许只写 log）
#   ⑥ 触发器        ⇒ 本测试只核脚本侧；launchd 侧由现场命令核（不在此假绿）
#   ⑦ 红线自检      ⇒ 可执行行内 0 命中 SYNO_ALLOW_MAIN_PUSH / --force / --no-verify / git merge
#   ⑧ 判别力        ⇒ 注入非法 sha ⇒ exit 2（禁把「看不见」当「没问题」）
#   ⑨ 改坏必红      ⇒ 五个变异体各跑**同一套断言**且必须被判红（每个变异体在独立沙箱里，
#                      带探针/门禁符号链接 ⇒ 变异体失败只能来自被改坏，不会因找不到依赖误红）
#
# 隔离: mktemp -d ＋ 本地 bare 仓（file 协议）；不碰真实远端、不写产品仓、不发网络请求。
# 用法: bash tests/control-tower/mirror-sync-push.test.sh
# 退出码: 0 = 全绿 ｜ 1 = 有失败 ｜ 2 = 测试自身失败（缺依赖/夹具建不起来）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SUT="$REPO_DIR/scripts/control-tower/mirror-sync-push.sh"

[ -f "$SUT" ] || { echo "❌ 被测脚本不存在: $SUT" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "❌ degraded: 缺 python3（脚本契约要求）" >&2; exit 2; }
command -v git >/dev/null 2>&1 || { echo "❌ degraded: 缺 git" >&2; exit 2; }

PASS=0; FAIL=0; CASE_FAIL=0; CHK_N=0   # CHK_N = 本用例实际执行的断言数（信号量==0 ⇒ 判红）
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
chk()  { CHK_N=$((CHK_N + 1)); if eval "$1"; then echo "      · ok: $2"; else echo "      · RED: $2"; CASE_FAIL=$((CASE_FAIL + 1)); fi; }

TMPROOT="$(mktemp -d)"; trap 'rm -rf "$TMPROOT"' EXIT
CI_DEFAULT='echo "1|success|http://x"'   # 默认注入"CI 绿"；CI_CMD 前缀可覆盖（空串=回落默认）
FX=""; WORK=""; GITEA=""; MIRROR=""; SIG=""; ST=""; HIST=""; OUT=""; A1=""; A2=""; RC=""; RC1=""; RC2=""; RC9=""; RC10=""; RC11=""; RC12a=""; RC12b=""; VERDICT=""; O1=""; BASE_N=""

# ── 夹具：work（工作仓）+ gitea.git + mirror.git；产 A1/A2 两提交 ────────────────
new_fixture() {  # $1=名字；默认 Gitea local-main=A1、GitHub main=A1（一致）
  local n="$1"
  FX="$(mktemp -d "$TMPROOT/${n}.XXXXXX")"
  WORK="$FX/work"; GITEA="$FX/gitea.git"; MIRROR="$FX/mirror.git"; SIG="$FX/signals.log"; ST="$FX/status.log"; HIST="$FX/hist.jsonl"; OUT="$FX/out.json"
  git init -q --bare "$GITEA"; git init -q --bare "$MIRROR"; git init -q "$WORK"
  git -C "$WORK" config user.email "t@local"; git -C "$WORK" config user.name "t"
  git -C "$WORK" config commit.gpgsign false
  printf 'a\n' > "$WORK/f"; git -C "$WORK" add f; git -C "$WORK" commit -qm "A1"; A1="$(git -C "$WORK" rev-parse HEAD)"
  printf 'b\n' >> "$WORK/f"; git -C "$WORK" add f; git -C "$WORK" commit -qm "A2"; A2="$(git -C "$WORK" rev-parse HEAD)"
  git -C "$WORK" remote add gitea "$GITEA"; git -C "$WORK" remote add mirror "$MIRROR"
  git -C "$WORK" push -q gitea "$A1:refs/heads/local-main"
  git -C "$WORK" push -q mirror "$A1:refs/heads/main"
  : > "$SIG"; : > "$ST"
}

# 统一跑法：信号走注入命令（零网络）；其余全用夹具
run_sut() {  # $1=github_sha  [$2..=额外环境赋值]  → stdout: 退出码
  local gh="$1"; shift || true
  ( cd "$WORK" && env SYNO_PUSH_REPO="$WORK" SYNO_PUSH_GITEA_URL="$GITEA" \
      SYNO_PUSH_GITHUB_SHA="$gh" SYNO_PUSH_SIGNAL_CMD="cat >> $SIG" SYNO_PUSH_STATUS_CMD="cat >> $ST" SYNO_PUSH_STATUS_HIST="$HIST" \
      SYNO_PUSH_VERIFY_TRIES=1 SYNO_PUSH_VERIFY_INTERVAL=0 SYNO_PUSH_OUT="$OUT" \
      SYNO_PUSH_WATCH_CI="${CI_MODE:-auto}" SYNO_PUSH_CI_TIMEOUT="${CI_TIMEOUT:-5}" \
      SYNO_PUSH_CI_CMD="${CI_CMD:-$CI_DEFAULT}" SYNO_PUSH_CI_INTERVAL=1 "$@" \
      bash "$SUT" --json ) >"$FX/stdout.txt" 2>"$FX/stderr.txt"
  echo $?
}

verdict_of()  { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("verdict"))' "$1" 2>/dev/null || true; }   # swallow-ok: 夹具解析失败 ⇒ 空 ⇒ 断言必红
field_of()    { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2]))' "$1" "$2" 2>/dev/null || true; }   # swallow-ok: 同上
mirror_main() { git -C "$MIRROR" rev-parse refs/heads/main 2>/dev/null || true; }   # swallow-ok: 远端不存在 ⇒ 空 ⇒ 断言必红
sig_has()     { grep -q "\"verdict\": \"$1\"" "$SIG" 2>/dev/null; }   # grep -q 探测型（不匹配即假）
sig_fail_n()  { grep -c '"kind": "failure"' "$SIG" 2>/dev/null || true; }

# ── 每条的断言（变异体复用同一套 ⇒ 改坏必红有判别力）──────────────────────────
c1() { chk '[ "$RC" = 0 ]' 'exit 0'; chk '[ "$VERDICT" = NOOP ]' 'verdict=NOOP'
       chk '[ "$(mirror_main)" = "$A1" ]' '远端 main 未被改动'
       chk '[ "$(sig_fail_n)" = 0 ]' '无失败信号（允许 recovery 关单）'
       chk 'grep -q "\"verdict\": \"NOOP\"" "$ST" 2>/dev/null' '状态单已留一行（B 层，verdict=NOOP）'; }
c2() { chk '[ "$RC" = 0 ]' 'exit 0'; chk '[ "$VERDICT" = PUSHED ]' 'verdict=PUSHED'
       chk '[ "$(mirror_main)" = "$A2" ]' '远端 main == 被推 sha'
       chk 'grep -q ALLOW "$WORK/.claude/mirror-sync.log" 2>/dev/null' '门禁 0-2 留痕 ALLOW'
       chk '[ "$(field_of "$OUT" lag)" = 1 ]' 'JSON lag=1'
       chk 'grep -q "\"verdict\": \"PUSHED\"" "$ST" 2>/dev/null' '状态单已留一行（verdict=PUSHED）'
       chk '[ "$(field_of "$OUT" ci)" = green ]' 'GitHub CI 绿（注入）'; }
c3() { chk '[ "$RC" = 1 ]' 'exit 1'; chk '[ "$VERDICT" = FORK ]' 'verdict=FORK'
       chk '[ "$(mirror_main)" = "$O1" ]' '远端 main 未被覆盖'
       chk '[ "$(git -C "$WORK" rev-list --count --all)" = "$BASE_N" ]' '未新增 merge 提交'
       chk 'sig_has FORK' '失败已出信号（判据⑤）'; }
c4() { chk '[ "$RC" = 2 ]' 'exit 2（降级 ≠ 通过）'; chk '[ "$VERDICT" = VERIFY_MISMATCH ]' 'verdict=VERIFY_MISMATCH'
       chk '[ "$(field_of "$OUT" degraded)" = True ]' 'JSON degraded=true'
       chk 'sig_has VERIFY_MISMATCH' '降级已出信号（判据⑤）'; }
c5() { chk '[ "$RC1" = 2 ]' '失败那次 exit 2'; chk '[ "$RC2" = 0 ]' '恢复那次 exit 0'
       chk 'grep -q "\"kind\": \"failure\"" "$SIG" 2>/dev/null' '失败已出声'
       chk 'grep -q "\"kind\": \"recovery\"" "$SIG" 2>/dev/null' '恢复已出声（能关单）'; }
c10() { chk '[ "$RC" = 2 ]' 'CI 红 ⇒ exit 2（降级≠通过）'
        chk '[ "$VERDICT" = CI_RED ]' 'verdict=CI_RED'
        chk '[ "$(field_of "$OUT" ci)" = red ]' 'JSON ci=red'
        chk 'sig_has CI_RED' 'CI 红已出信号'; }
c11() { chk '[ "$RC" = 2 ]' 'CI 等不出结论 ⇒ exit 2'
        chk '[ "$VERDICT" = CI_UNKNOWN ]' 'verdict=CI_UNKNOWN'
        chk 'sig_has CI_UNKNOWN' '未知已出信号（禁当通过）'; }
c12() { local n; n="$(grep -c '\"kind\": \"failure\"' "$SIG" 2>/dev/null || true)"
        chk '[ "$n" = 1 ]' '同一阶段连跑两次 ⇒ 只发一次失败信号（实发 '"'"'"$n"'"'"
        chk 'grep -q "deduped" "$FX/stdout.txt" 2>/dev/null' '第二趟 signal=deduped（可见，不静默）'; }
c9() { chk '[ "$RC9" = 0 ]' '状态单写失败不改结论（仍 exit 0）'
       chk 'grep -q "STATUS-UNREACHABLE" "$FX/stderr.txt" 2>/dev/null' '写失败有显式 STATUS-UNREACHABLE 行（不静默）'; }
c8() { chk '[ "$RC" = 2 ]' 'exit 2'; chk '[ "$VERDICT" = DEGRADED ]' 'verdict=DEGRADED'
       chk '[ "$(field_of "$OUT" degraded)" = True ]' 'JSON degraded=true'
       chk 'sig_has DEGRADED' '降级已出信号'; }

assert_case() {  # $1=checker $2=label $3=green|red
  local out file n; CASE_FAIL=0; CHK_N=0; file="$TMPROOT/case.out"
  # 🔴 守卫（复核实测：checker 未定义时 command not found 被重定向吞掉 ⇒ 假绿）
  if ! declare -F "$1" >/dev/null 2>&1; then
    fail "$2（checker \`$1\` 未定义 ⇒ 用例无效，按红计）"; return
  fi
  # 🔴 不用 $(...) 捕获：命令替换会进子 shell，CASE_FAIL 的累加会丢（假绿陷阱）
  "$1" >"$file" 2>&1
  n="$CASE_FAIL"
  # 🔴 A-1（第三轮复核）：断言数==0 ⇒ 该用例无效，按红计（禁把"没跑断言"当"全过"）
  if [ "$CHK_N" = 0 ]; then
    fail "$2（checker \`$1\` 实际执行断言数=0 ⇒ 空转，按红计）"; return
  fi
  if [ "${3:-green}" = "green" ]; then
    if [ "$n" = 0 ]; then pass "$2"; else fail "$2"; grep 'RED' "$file" | sed 's/^/    /' >&2; fi
  else
    if [ "$n" != 0 ]; then pass "$2（变异体被这套断言判红：$n 项）"; else fail "$2（变异体竟然全绿 ⇒ 该条判据没有判别力）"; fi
  fi
}

# ── 场景构造（正向与变异体共用）────────────────────────────────────────────────
setup1() { new_fixture "c1"; RC="$(run_sut "$A1")"; VERDICT="$(verdict_of "$OUT")"; }
setup2() { new_fixture "c2"; git -C "$WORK" push -q gitea "$A2:refs/heads/local-main"
           RC="$(run_sut "$A1")"; VERDICT="$(verdict_of "$OUT")"; }
setup3() { new_fixture "c3"
           git -C "$WORK" checkout -q -b other "$A1"
           printf 'x\n' > "$WORK/g"; git -C "$WORK" add g; git -C "$WORK" commit -qm "O1"; O1="$(git -C "$WORK" rev-parse HEAD)"
           git -C "$WORK" checkout -q master 2>/dev/null || git -C "$WORK" checkout -q -
           git -C "$WORK" push -q mirror "$O1:refs/heads/main"
           git -C "$WORK" push -q gitea "$A2:refs/heads/local-main"
           BASE_N="$(git -C "$WORK" rev-list --count --all)"
           RC="$(run_sut "$O1")"; VERDICT="$(verdict_of "$OUT")"; }
setup4() { new_fixture "c4"; git -C "$WORK" push -q gitea "$A2:refs/heads/local-main"
           RC="$(run_sut "$A1" SYNO_PUSH_TEST_AFTER_PUSH="git -C $MIRROR update-ref refs/heads/main $A1")"
           VERDICT="$(verdict_of "$OUT")"; }
setup5() { new_fixture "c5"; RC1="$(run_sut "deadbeef")"; RC2="$(run_sut "$A1")"; }
setup10() { new_fixture "c10"; git -C "$WORK" push -q gitea "$A2:refs/heads/local-main"
            CI_CMD='echo "9|failure|http://x/run/9|All Checks Passed / Gate Integrity"' \
            RC10="$(run_sut "$A1")"; CI_CMD=""
            VERDICT="$(verdict_of "$OUT")"; }
setup11() { new_fixture "c11"; git -C "$WORK" push -q gitea "$A2:refs/heads/local-main"
            CI_CMD='echo ""' RC11="$(run_sut "$A1")"; CI_CMD=""; VERDICT="$(verdict_of "$OUT")"; }
setup12() { new_fixture "c12"
            RC12a="$(run_sut "deadbeef")"; RC12b="$(run_sut "deadbeef")"; }
setup13() { new_fixture "c13"
            printf '{"as_of":"2026-01-01T00:00:00Z","verdict":"PUSHED","reason":"","lag":1,"gitea":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef","github":"","pushed":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef","exit":0}\n' > "$HIST"
            RC="$(run_sut "$A1")"; VERDICT="$(verdict_of "$OUT")"; }
setup14() { new_fixture "c14"
            local sb="$TMPROOT/sb14"; mkdir -p "$sb/scripts/control-tower"
            cp "$REPO_DIR/scripts/control-tower/mirror-sync-push.sh" "$sb/scripts/control-tower/"
            ln -sf "$REPO_DIR/scripts/pre-push-check.sh" "$sb/scripts/pre-push-check.sh"
            cat > "$sb/scripts/control-tower/check-dual-repo-sync.sh" <<EOS
#!/usr/bin/env bash
echo '{"schema":"x","as_of":"x","gitea":{"sha":"$A1"},"github":{"sha":"$A1"},"lag":1,"ancestor":null,"verdict":"LAG","exit":1}'
exit 1
EOS
            chmod +x "$sb/scripts/control-tower/check-dual-repo-sync.sh"
            local old="$SUT"; SUT="$sb/scripts/control-tower/mirror-sync-push.sh"
            RC="$(run_sut "$A1")"; SUT="$old"; VERDICT="$(verdict_of "$OUT")"; }
c13() { chk '[ "$RC" = 0 ]' 'NOOP 不因旁路而改结论'
        chk 'grep -q "MIRROR-ADVANCED-ELSEWHERE" "$FX/stderr.txt" 2>/dev/null' '旁路推送被显式点名'
        chk '[ "$(field_of "$OUT" source)" = external ]' 'JSON source=external（结构化，不只在字符串里）'; }
c14() { chk '[ "$RC" = 2 ]' 'ancestor 判不出 ⇒ exit 2（三态纪律）'
        chk '[ "$VERDICT" = DEGRADED ]' 'verdict=DEGRADED（不是 FORK）'; }
setup9() { new_fixture "c9"; RC9="$(run_sut "$A1" SYNO_PUSH_STATUS_CMD=false)"; }
setup8() { new_fixture "c8"; RC="$(run_sut "deadbeef")"; VERDICT="$(verdict_of "$OUT")"; }

echo "── ① 落后=0 ⇒ 不推、exit 0 ──"
setup1; assert_case c1 "① 一致 ⇒ 不推（exit 0 / NOOP / 远端不变 / 无失败信号）"

echo "── ② 落后>0 且 ff ⇒ 自动推 ──"
setup2; assert_case c2 "② ff ⇒ 自动推 且 门禁留痕 ALLOW"

echo "── ③ 分叉（non-ff）⇒ 拒推 exit 1，不自作主张 merge ──"
setup3; assert_case c3 "③ 分叉 ⇒ 拒推（exit 1 / FORK / 远端不变 / 无 merge / 有信号）"

echo "── ④ 推后核 SHA：不等 ⇒ exit 2（降级 ≠ 通过）──"
setup4; assert_case c4 "④ 核 SHA 不等 ⇒ exit 2 且出信号"

echo "── ⑤ 失败必出声 ＋ 恢复要关单（同一夹具：先降级再恢复）──"
setup5; assert_case c5 "⑤ 降级必出声、恢复必出声（否则历史单永不关闭）"

echo "── 同结论去重（防每天刷同一张单）──"
setup12; assert_case c12 "同一根因连跑两次 ⇒ 只发一次信号"

echo "── 旁路推送可见化（复核阻断②的回归位）──"
setup13; assert_case c13 "镜像被别处推过 ⇒ 显式点名且不改结论"

echo "── ancestor 三态（复核建议③的回归位）──"
setup14; assert_case c14 "ancestor 判不出 ⇒ DEGRADED exit 2（旧码会误判 FORK exit 1）"

echo "── 状态单容错（B 层写不出去，也不许污染结论、不许静默）──"
setup9; assert_case c9 "状态单写失败 ⇒ 仍 exit 0，且有 STATUS-UNREACHABLE 显式行"

echo "── GitHub 集成测试观察（推完不只看 sha，还要看测试跑没跑绿）──"
setup10; assert_case c10 "CI 红 ⇒ exit 2 ＋ 点名失败 job ＋ 出信号"
setup11; assert_case c11 "CI 等不出结论 ⇒ exit 2（禁当通过）＋ 出信号"

echo "── ⑥ 触发器（本测试只核脚本侧；launchd 侧见现场命令）──"
grep -q "SYNO_PUSH_VERIFY_TRIES" "$SUT" && pass "⑥ 执行器可被每日任务直接调用（无可交互等待）" || fail "⑥ 执行器缺可调用契约"
echo "  ℹ️  launchd 真跑证据（现场跑）: launchctl print gui/\$(id -u)/com.synova.mirror-sync ＋ ~/Library/Logs/synova-mirror-sync.launchd.log"

echo "── ⑦ 红线自检：可执行行 0 命中逃生舱／强推／绕过 ──"
HITS="$(grep -vE '^[[:space:]]*#' "$SUT" | grep -cE 'SYNO_ALLOW_MAIN_PUSH|--force|--no-verify|git[[:space:]]+merge' || true)"
[ "$HITS" = "0" ] && pass "⑦ 红线命中数 0" || fail "⑦ 红线命中数 $HITS（须 0）"

echo "── ⑧ 判别力自检：非法 sha ⇒ exit 2（禁把「看不见」当「没问题」）──"
setup8; assert_case c8 "⑧ 读不到合法 sha ⇒ 降级且出信号"

echo "── ⑨ 改坏必红（五个变异体各跑同一套断言，必须全被判红）──"
mutant() {  # $1=名字 $2=sed 表达式 $3=checker $4=setup
  local name="$1" expr="$2" checker="$3" setup="$4"
  local root="$TMPROOT/mut-$name/scripts"
  mkdir -p "$root/control-tower"
  ln -sf "$REPO_DIR/scripts/control-tower/check-dual-repo-sync.sh" "$root/control-tower/check-dual-repo-sync.sh"
  ln -sf "$REPO_DIR/scripts/pre-push-check.sh" "$root/pre-push-check.sh"
  sed "$expr" "$SUT" > "$root/control-tower/mirror-sync-push.sh"
  if cmp -s "$SUT" "$root/control-tower/mirror-sync-push.sh"; then
    fail "⑨ 变异体 $name 未生效（sed 未命中 ⇒ 自检空转）"; return
  fi
  local old="$SUT"; SUT="$root/control-tower/mirror-sync-push.sh"
  "$setup"
  SUT="$old"
  assert_case "$checker" "⑨ 变异体 $name" red
}
mutant m1_noop_push   's/finish 0 NOOP "" recover/finish 0 PUSHED "" ""/' c1 setup1
mutant m2_skip_push   's|git -C "$REPO" push "$MIRROR" "$GITEA_SHA:refs/heads/main"|true|' c2 setup2
mutant m3_fork_allow  's/finish 1 FORK E_FORK fail/finish 0 NOOP "" ""/' c3 setup3
mutant m4_verify_pass 's/\[ "\$VERIFY_OK" = "1" \] || finish 2 VERIFY_MISMATCH E_VERIFY_MISMATCH fail/VERIFY_OK=1/' c4 setup4
mutant m5_log_only    's#signal_fail "E_\${verdict}" "\$verdict" "\$reason" || rc=2#:#' c4 setup4

echo
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" = "0" ] || exit 1
exit 0
