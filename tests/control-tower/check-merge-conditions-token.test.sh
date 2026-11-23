#!/usr/bin/env bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null   # swallow-ok: locale 不可用时回退默认 locale（非错误路径）
# ═══════════════════════════════════════════════════════════════════════════════
# check-merge-conditions-token.test.sh — 凭据链第 4 级（git credential fill）配对测试
#
# 被测: scripts/control-tower/check-merge-conditions.sh 的
#        cred_api_host / cred_api_proto / cred_fill_secs / cred_fill_run /
#        credential_token / resolve_token（白盒＝直接 source 被测件的**真函数文本**，不复制逻辑）
# 任务: #1463 合并凭证链路（甲类＝B 类直做；乙类 ②/`E_NO_TOKEN` 另走 A 类送审）
#       三层根因之一：本机真 token 在 Windows GCM，脚本原先只认 3 个来源
#
# 契约（铁律 47）
#   @input   无参；被测件路径注入缝 SYNO_MERGE_COND_TOOL（与主配对测试同缝）
#   @output  逐判定点 ✅/❌/⏭ 行 ＋ 末行 `结果: N 通过, M 失败`（或含 `, K 跳过`）
#   @exit    0 = 全部判定点通过（跳过项显式声明）；1 = 有失败
#   @degraded 无（零网络、零系统凭据：假 git / 假 curl 全部来自夹具沙箱）
#
# 覆盖矩阵（6 判定点）
#   T1 有值（白盒）   假 helper 返回 password=<运行时哨兵> ⇒ resolve_token rc=0 且值一致（比 sha，不打印）
#   T2 空值（白盒）   helper rc=0 但**无 password 行** ⇒ rc≠0 且输出空（fail-closed，禁静默空 token）
#   T3 超时（白盒）   helper 挂死 ⇒ SYNO_MERGE_COND_CRED_TIMEOUT 墙钟上限内 rc≠0
#                     （无 coreutils `timeout` 的平台显式 SKIP，不冒充通过）
#   T4 host 推导      SYNO_GITEA_API=http(s)://<假 host>/api/v1 ⇒ 请求体 host/protocol 取自 $API
#                     🔴 抓「写死 127.0.0.1:3000」：假 host 与本机 Gitea 不同，且请求体禁出现本机 host
#   T5 优先级回归     GITEA_TOKEN 存在 ⇒ 用环境变量且**根本不调用** helper（原来三级链不被破坏）
#   T6 接线（黑盒）   真跑被测件（假 git 有值 ＋ 假 curl）⇒ Authorization 头带该 token，API 403 ⇒ exit 2
#
# 判别力（改坏必红）:
#   去掉第 4 级 ⇒ T1/T4/T6 红｜helper 取不到却返回 0 ⇒ T2 红｜超时无上限 ⇒ T3 红
#   host 写死 127.0.0.1:3000 ⇒ T4 红｜前三级顺序/归属被破坏 ⇒ T5 红
# 沙箱: mktemp -d ＋ trap 清理；零网络（假 curl 不出网）；HOME 指向沙箱空目录（隔离第 3 级 token 文件）。
# 令牌纪律: 夹具 token 是**运行时随机哨兵**，不打印、不落盘；断言只比 sha256 前 12 hex；
#           任何输出里出现该哨兵即判红（不泄漏）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="${SYNO_MERGE_COND_TOOL:-$REPO_DIR/scripts/control-tower/check-merge-conditions.sh}"
if [ ! -f "$TOOL" ]; then
  echo "❌ 被测件不存在: $TOOL" >&2
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/synova-mergecred.XXXXXX")" || { echo "❌ mktemp 失败" >&2; exit 1; }
cleanup() { rm -rf "$WORK" 2>/dev/null; }   # swallow-ok: 清理失败不影响判定结论（临时目录）
trap cleanup EXIT INT TERM

PASS=0
FAIL=0
SKIP=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
skip() { SKIP=$((SKIP + 1)); echo "  ⏭  SKIP $1"; }

REAL_GIT="$(command -v git)"
REAL_PATH="$PATH"
# 运行时哨兵（每次运行不同；不写进仓库、不打印）
TOKEN_SENTINEL="ct-$(date +%s)-$$-$RANDOM"
FAKE_HOST="gitea.example.test:9999"
HAVE_TIMEOUT=0
command -v timeout >/dev/null 2>&1 && HAVE_TIMEOUT=1

sha12() { python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest()[:12])'; }
field() { sed -n "s/^$1=//p" ; }   # 从报告里取一个字段（不打印原值以外的东西）

mkdir -p "$WORK/home" "$WORK/bin" "$WORK/repo"
"$REAL_GIT" init -q "$WORK/repo" || { echo "❌ 夹具仓 git init 失败" >&2; exit 1; }

# ── 夹具：假 git（只劫持 credential fill；其余原样交给真 git）───────────────────
cat > "$WORK/bin/git" <<'SH'
#!/usr/bin/env bash
set -u
if [ "${1:-}" = "credential" ] && [ "${2:-}" = "fill" ]; then
  : > "${CRED_CALLED:?}"
  cat > "${CRED_REQ:?}" || true
  case "${FAKE_MODE:-}" in
    value) printf 'username=agent\npassword=%s\n' "${FAKE_TOKEN:?}" ;;
    empty) printf 'username=agent\n' ;;
    hang)  exec sleep 30 ;;
    *)     exit 1 ;;
  esac
  exit 0
fi
exec "${REAL_GIT:?}" "$@"
SH
chmod +x "$WORK/bin/git" || { echo "❌ 夹具 chmod 失败" >&2; exit 1; }

# ── 夹具：假 curl（只记录 Authorization 头是否等于夹具 token；恒 403，不出网）────
cat > "$WORK/bin/curl" <<'SH'
#!/usr/bin/env bash
set -u
out=""; hdr=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="${2:-}"; shift 2 ;;
    -H) hdr="${2:-}"; shift 2 ;;
    -m|-w) shift 2 ;;
    *) url="$1"; shift ;;
  esac
done
printf 'URL=%s\n' "$url" >> "${CURL_MARK:?}"
if [ "$hdr" = "Authorization: token ${FAKE_TOKEN:-}" ]; then
  printf 'AUTH=MATCH\n' >> "${CURL_MARK:?}"
elif [ -n "$hdr" ]; then
  printf 'AUTH=MISMATCH\n' >> "${CURL_MARK:?}"
else
  printf 'AUTH=ABSENT\n' >> "${CURL_MARK:?}"
fi
if [ -n "$out" ]; then
  printf '%s' '{"message":"Only signed in user is allowed to call APIs."}' > "$out"
fi
printf '403'
SH
chmod +x "$WORK/bin/curl" || { echo "❌ 夹具 chmod 失败" >&2; exit 1; }

# ── 白盒夹具：抽取被测件真函数文本（函数体闭合花括号在行首＝本仓控制塔脚本风格）──
extract_fns() {
  sed -n \
    -e '/^cred_api_host() {/,/^}/p' \
    -e '/^cred_api_proto() {/,/^}/p' \
    -e '/^cred_fill_secs() {/,/^}/p' \
    -e '/^cred_fill_run() {/,/^}/p' \
    -e '/^credential_token() {/,/^}/p' \
    -e '/^resolve_token() {/,/^}/p' "$TOOL"
}
extract_fns > "$WORK/fns.sh"
for fn in cred_api_host cred_api_proto cred_fill_secs cred_fill_run credential_token resolve_token; do
  if ! grep -q "^${fn}() {" "$WORK/fns.sh"; then
    fail "抽取失败：被测件缺 ${fn}()（函数改名/删除 ⇒ 本件必须同步）"
  fi
done

cat > "$WORK/probe.sh" <<'SH'
#!/usr/bin/env bash
set -u
API="$1"
# shellcheck source=/dev/null
. "$2"
raw="$(resolve_token)"
rc=$?
printf 'RC=%s\n' "$rc"
printf 'LEN=%s\n' "${#raw}"
printf '%s' "$raw" | python3 -c 'import hashlib,sys; print("SHA=" + hashlib.sha256(sys.stdin.buffer.read()).hexdigest()[:12])'
SH

probe() { # <api> [额外 env 赋值...] ⇒ stdout=RC/LEN/SHA 报告（token 本身不出现）
  local api="$1"
  shift
  env -u GITEA_TOKEN -u SYNO_GITEA_TOKEN "$@" \
    PATH="$WORK/bin:$REAL_PATH" HOME="$WORK/home" REAL_GIT="$REAL_GIT" \
    CRED_CALLED="$WORK/cred.called" CRED_REQ="$WORK/cred.req" \
    bash "$WORK/probe.sh" "$api" "$WORK/fns.sh"
}

want_sha="$(printf '%s' "$TOKEN_SENTINEL" | sha12)"
empty_sha="$(printf '' | sha12)"
API_LOCAL="http://127.0.0.1:3000/api/v1"

echo "── T1 有值（第 4 级命中）──"
rm -f "$WORK/cred.called" "$WORK/cred.req"
REP="$(probe "$API_LOCAL" FAKE_MODE=value FAKE_TOKEN="$TOKEN_SENTINEL")"
RC="$(printf '%s\n' "$REP" | field RC)"
LEN="$(printf '%s\n' "$REP" | field LEN)"
SHA="$(printf '%s\n' "$REP" | field SHA)"
if [ "$RC" = "0" ] && [ "$SHA" = "$want_sha" ] && [ "$LEN" -gt 0 ] && [ -f "$WORK/cred.called" ]; then
  pass "T1 helper 有值 ⇒ rc=0，token 与 helper 返回值一致（sha 匹配，len=${LEN}）"
else
  fail "T1 期望 rc=0 ＋ sha=${want_sha} ＋ helper 被调用；实得 rc=${RC:-?} sha=${SHA:-?} len=${LEN:-?} called=$([ -f "$WORK/cred.called" ] && echo yes || echo no)"
fi

echo "── T2 空值（helper 成功但无 password）──"
rm -f "$WORK/cred.called" "$WORK/cred.req"
REP="$(probe "$API_LOCAL" FAKE_MODE=empty FAKE_TOKEN="$TOKEN_SENTINEL")"
RC="$(printf '%s\n' "$REP" | field RC)"
LEN="$(printf '%s\n' "$REP" | field LEN)"
SHA="$(printf '%s\n' "$REP" | field SHA)"
if [ "$RC" != "0" ] && [ "$LEN" = "0" ] && [ "$SHA" = "$empty_sha" ] && [ -f "$WORK/cred.called" ]; then
  pass "T2 helper 无 password ⇒ resolve_token rc=${RC}（≠0），输出为空（fail-closed，未静默返回空 token）"
else
  fail "T2 期望 rc≠0 且输出空；实得 rc=${RC:-?} len=${LEN:-?} sha=${SHA:-?}"
fi

echo "── T3 超时（helper 挂死）──"
if [ "$HAVE_TIMEOUT" = "1" ]; then
  rm -f "$WORK/cred.called" "$WORK/cred.req"
  T3_BEGIN="$(date +%s)"
  REP="$(probe "$API_LOCAL" FAKE_MODE=hang FAKE_TOKEN="$TOKEN_SENTINEL" SYNO_MERGE_COND_CRED_TIMEOUT=2)"
  T3_ELAPSED=$(( $(date +%s) - T3_BEGIN ))
  RC="$(printf '%s\n' "$REP" | field RC)"
  LEN="$(printf '%s\n' "$REP" | field LEN)"
  if [ "$RC" != "0" ] && [ "$LEN" = "0" ] && [ "$T3_ELAPSED" -lt 20 ]; then
    pass "T3 helper 挂死 ⇒ ${T3_ELAPSED}s 内 rc=${RC}（≠0），未挂死、未静默成功（上限 SYNO_MERGE_COND_CRED_TIMEOUT=2）"
  else
    fail "T3 期望 ${T3_ELAPSED}s 内 rc≠0 且输出空；实得 rc=${RC:-?} len=${LEN:-?} elapsed=${T3_ELAPSED}s"
  fi
else
  skip "T3 环境无 coreutils \`timeout\`（见脚本 @cross_platform：无 timeout 平台直跑）——本判定点未执行，不计通过"
fi

echo "── T4 host/protocol 从 \$API 推导（禁写死 127.0.0.1:3000）──"
rm -f "$WORK/cred.called" "$WORK/cred.req"
REP="$(probe "http://${FAKE_HOST}/api/v1" FAKE_MODE=value FAKE_TOKEN="$TOKEN_SENTINEL")"
RC="$(printf '%s\n' "$REP" | field RC)"
T4_BAD=""
[ "$RC" = "0" ] || T4_BAD="${T4_BAD} rc=${RC:-?}"
grep -Fxq "host=${FAKE_HOST}" "$WORK/cred.req" || T4_BAD="${T4_BAD} 请求体缺 host=${FAKE_HOST}"
grep -Fxq "protocol=http" "$WORK/cred.req" || T4_BAD="${T4_BAD} 请求体缺 protocol=http"
if grep -Fq "127.0.0.1:3000" "$WORK/cred.req"; then T4_BAD="${T4_BAD} 请求体出现写死的本机 host"; fi
rm -f "$WORK/cred.req"
REP="$(probe "https://${FAKE_HOST}/api/v1" FAKE_MODE=value FAKE_TOKEN="$TOKEN_SENTINEL")"
grep -Fxq "protocol=https" "$WORK/cred.req" || T4_BAD="${T4_BAD} https 未映射为 protocol=https"
if [ -z "$T4_BAD" ]; then
  pass "T4 host/protocol 取自 \$API（http/https 两态；无写死 127.0.0.1:3000）"
else
  fail "T4 ${T4_BAD# }"
fi

echo "── T5 优先级回归（GITEA_TOKEN 在 ⇒ 不调用 helper）──"
rm -f "$WORK/cred.called" "$WORK/cred.req"
REP="$(probe "$API_LOCAL" GITEA_TOKEN="$TOKEN_SENTINEL" FAKE_MODE=hang)"
RC="$(printf '%s\n' "$REP" | field RC)"
SHA="$(printf '%s\n' "$REP" | field SHA)"
if [ "$RC" = "0" ] && [ "$SHA" = "$want_sha" ] && [ ! -f "$WORK/cred.called" ]; then
  pass "T5 GITEA_TOKEN 命中 ⇒ rc=0 且 helper 零调用（原三级链语义不变）"
else
  fail "T5 期望 rc=0 ＋ sha匹配 ＋ helper 零调用；实得 rc=${RC:-?} sha=${SHA:-?} called=$([ -f "$WORK/cred.called" ] && echo yes || echo no)"
fi

echo "── T6 接线（真跑被测件：token 进 Authorization 头）──"
rm -f "$WORK/cred.called" "$WORK/cred.req" "$WORK/curl.mark" "$WORK/deg.log"
env -u GITEA_TOKEN -u SYNO_GITEA_TOKEN \
  PATH="$WORK/bin:$REAL_PATH" HOME="$WORK/home" REAL_GIT="$REAL_GIT" \
  FAKE_MODE=value FAKE_TOKEN="$TOKEN_SENTINEL" \
  CRED_CALLED="$WORK/cred.called" CRED_REQ="$WORK/cred.req" CURL_MARK="$WORK/curl.mark" \
  SYNO_GATE_DEGRADED_LOG="$WORK/deg.log" \
  bash "$TOOL" --pr 100 --repo-root "$WORK/repo" > "$WORK/e2e.out" 2> "$WORK/e2e.err"
T6_RC=$?
T6_BAD=""
[ "$T6_RC" = "2" ] || T6_BAD="${T6_BAD} exit=${T6_RC}（期望 2：无 token 时 API 403 = fail-closed）"
grep -Fxq "AUTH=MATCH" "$WORK/curl.mark" || T6_BAD="${T6_BAD} Authorization 头未带 helper 取到的 token"
grep -Fq "HTTP 403 on /pulls/100" "$WORK/e2e.err" || T6_BAD="${T6_BAD} 未走 E_API_HTTP 403 路径"
if grep -Fq -- "$TOKEN_SENTINEL" "$WORK/e2e.out" "$WORK/e2e.err" "$WORK/deg.log"; then
  T6_BAD="${T6_BAD} token 值出现在输出/降级日志（泄漏）"
fi
if [ -z "$T6_BAD" ]; then
  pass "T6 第 4 级 token 已进入 API 请求头（AUTH=MATCH）；API 403 ⇒ exit 2（fail-closed）且输出零泄漏"
else
  fail "T6 ${T6_BAD# }"
fi

echo
echo "结果: ${PASS} 通过, ${FAIL} 失败$( [ "$SKIP" -gt 0 ] && printf ', %s 跳过' "$SKIP" )"
if [ "$FAIL" -ne 0 ]; then exit 1; fi
if [ "$PASS" -eq 0 ]; then
  echo "❌ 判定点一条都没跑（判别力自检不可为空）" >&2
  exit 1
fi
exit 0
