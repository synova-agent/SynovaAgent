#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-merge-conditions.test.sh — CT-40 强制配对测试（W2 · Issue #582 / 批次 P7-1）
#
# 被测: scripts/control-tower/check-merge-conditions.sh（W1）
# 配对规则: scripts/{control-tower,workflow,hooks}/<name>.<sh|py> ↔ tests/control-tower/<name>.test.sh
# 规格源: docs/plans/codex/implementation/SYNOVA-IMPL-582-merge-conditions-20261018.md
#         （冻结 blob a22509208b08fa6a）§4.3.0 夹具契约 / §4.3.1 12 子例 / §4.4 DS / C2 边界
#
# 🔴 接线说明（WIRE CHECK 不适用 —— 规格 §1.2 ＋ CTO 令②）:
#   本件**按规格 §1.2 不接 pre-commit/CI**（检查器只给本地/人判，不进 CI 硬阻断），
#   故"新脚本被 gate 调用"式 WIRE CHECK **不适用**。替代自证两条:
#     · `--help` 参数完备性（9 个参数逐一在帮助里出现）
#     · `--selfcheck` 12 判定点自证（判据本身可跑且改坏必红）
#
# 覆盖矩阵（12 个判定点 ＝ 逐子例独立夹具 ＋ 三态退出码）:
#   A  inner_exit=0  CAN-自合并        ③=ok(attested)（禁裸 ok）
#   B  inner_exit=1  NO: ① CI 全绿 pending=0      点名 pending 的 context
#   C  inner_exit=1  NO: ② 零写集重叠             点名 a.ts → PR#100,#101
#   D1 inner_exit=1  NO: ③ 已过独立复核           R1 缺回执
#   D2 inner_exit=1  NO: ③ 已过独立复核           R3 指纹不匹配
#   D3 inner_exit=1  NO: ③ 已过独立复核           R7 回执之后仍有代码改动
#   D4 inner_exit=1  NO: ③ 已过独立复核           R2 independence 必须为 fresh-session
#   E  inner_exit=1  NO: ④ 串行                   S1 tip … 不是 head 祖先（落后 1 commits）
#   F  inner_exit=2  degraded: CI 信号量==0       禁判绿也禁判红
#   G  inner_exit=1  NO: ④ 串行                   S2 前置就绪 PR #99 编号更小
#   H  inner_exit=0  CAN-自合并 ＋ warn: 身份未分离（R9 恒打印）
#   I  inner_exit=2  degraded: open PR 列表不可达 禁输出 CAN-自合并 / ②=ok
#   ⇒ 三态齐: exit 0（A/H）｜exit 1（B/C/D1–D4/E/G）｜exit 2（F/I）—— DS-4
#
# 边界值（C2 可离线复现者；单列计数，见下"计数口径"）:
#   K1 CI total_count=0 ⇒ exit 2 ｜ K2 statuses 同有 success 与 pending ⇒ 红并点名 context
#   K3 回执 fp 差 1 hex（且用 63 hex 前缀，证明禁前缀匹配）⇒ 红 R3
#   K4 checks 长度 = 4 ⇒ 红 R4 ｜ K5 --pr 指向取不到的 PR ⇒ exit 2
#   K6 --json 与 --selfcheck 同给 ⇒ exit 2 ｜ K7 --offline ⇒ exit 2 ｜ K8 head 取不到 ⇒ exit 2
#   注: C2 的「--pr 指向已合/已关 PR」在夹具层无 state 注入缝（fixture 的 PR 恒 open）
#       ⇒ 以 K5「PR 取不到 ⇒ exit 2」（同为 fail-closed 降级）替代并在此登记差异。
#
# 计数口径（规格 §4.1 N3：末行 N 必须 = --selfcheck 的 12 个判定点）:
#   通过 = **12 判定点**（每子例一次）；C2 边界/参数/只读断言单列（`边界:` 行），
#   两者任一失败都计入「失败」。⇒ 末行恒为 `结果: 12 通过, 0 失败`。
#
# 沙箱: 全部夹具在系统临时目录（mktemp -d ＋ trap EXIT 清理）；夹具仓 git init ＋ 本地 commit。
#       零网络：API 层经 SYNO_MERGE_COND_FIXTURE 注入（不依赖 Gitea 可达）。
# 只读: 运行前后真实仓 `git status --porcelain` 必须逐字节相同（DS-10）。
# 断言: 每子例**同时**断言 inner_exit ＋ 末行文本（只比 exit 会漏「红错条件」，§4.3.0 铁约束 ③）。
# 验收(改坏必红): SYNO_MERGE_COND_TOOL=/tmp/<改坏的副本> bash tests/control-tower/check-merge-conditions.test.sh
#   ⇒ 必须 exit 1（本件能抓出被判件被改坏，不只信它自己的 --selfcheck）
# 用法: bash tests/control-tower/check-merge-conditions.test.sh
# 退出码: 0 = 全部通过；1 = 有失败（含 W1 未交付）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# 被测件路径（默认＝仓内 W1；SYNO_MERGE_COND_TOOL 仅供"改坏必红"复核时指向 /tmp 的副本）
TOOL="${SYNO_MERGE_COND_TOOL:-$REPO_DIR/scripts/control-tower/check-merge-conditions.sh}"
REL_TOOL="scripts/control-tower/check-merge-conditions.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/synova-582-test.XXXXXX")" || { echo "❌ mktemp 失败" >&2; exit 1; }
cleanup() { rm -rf "$WORK" 2>/dev/null; }
trap cleanup EXIT INT TERM

PASS=0       # 判定点数（必须 = 12）
FAIL=0       # 任何断言失败（判定点 ＋ 边界）
EXTRA=0      # 边界/参数/只读断言通过数（单列，不计入 N）
pass()  { PASS=$((PASS + 1));  echo "  ✅ $1"; }
extra() { EXTRA=$((EXTRA + 1)); echo "  ✅ [边界] $1"; }
fail()  { FAIL=$((FAIL + 1));  echo "  ❌ $1" >&2; }

OUT=""; ERR=""; RC=0

assert_eq() { # <期望> <实际> <名称>
  if [ "$2" = "$1" ]; then return 0; fi
  fail "$3 — 期望 [$1]，实际 [$2]"
  return 1
}
assert_has() { # <文件> <字面串> <名称>
  if grep -Fq -- "$2" "$1"; then return 0; fi
  fail "$3 — 输出缺「$2」"
  return 1
}
assert_not_has() { # <文件> <字面串> <名称>
  if grep -Fq -- "$2" "$1"; then fail "$3 — 不应出现「$2」"; return 1; fi
  return 0
}

# ── 夹具构建（规格 §4.3.0：基线零重叠；子例间重建，不复用 mutation）─────────────
mk_commit() { # <repo> <msg> <author-email>
  GIT_AUTHOR_NAME="agent" GIT_AUTHOR_EMAIL="$3" \
  GIT_COMMITTER_NAME="agent" GIT_COMMITTER_EMAIL="$3" \
    git -C "$1" commit -q -m "$2"
}

fp_of() { # <repo> <mb> <head> → 64 hex（③-2.0 唯一指纹定义，测试侧独立复算）
  local R="$1"
  if ! git -C "$R" diff --no-color -M --full-index --binary "$2" "$3" \
        -- . ':(exclude)docs/synova/reviews/**' > "$WORK/fp.tmp"; then
    return 1
  fi
  python3 -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$WORK/fp.tmp"
}

write_receipt() { # <repo> <pr> <patch_fingerprint 字面值> <fp12(路径)> <independence> <email> <checks 条数>
  local R="$1" pr="$2" fpval="$3" fp12="$4" indep="$5" email="$6" nchecks="$7"
  mkdir -p "$R/docs/synova/reviews"
  python3 - "$R/docs/synova/reviews/$pr.$fp12.json" "$pr" "$fpval" "$indep" "$nchecks" <<'PY' || return 1
import datetime, json, sys
path, pr, fpval, indep, nchecks = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4], int(sys.argv[5])
base_checks = [
    {"id": "铁律38 as any", "cmd": "grep -rn 'as any' <变更文件>", "result": "pass", "evidence": "0 命中"},
    {"id": "铁律11 静默降级", "cmd": "grep -n 'degraded:' x.sh", "result": "pass", "evidence": "stderr 一行 + exit 2"},
    {"id": "铁律47 契约", "cmd": "head -40 x.sh | grep -E '@input|@output'", "result": "pass", "evidence": "六块齐"},
    {"id": "铁律48 非空壳测试", "cmd": "grep -c 'inner_exit=' t.sh", "result": "pass", "evidence": "12 判定点"},
    {"id": "三态退出码", "cmd": "bash x.sh --selfcheck; echo $?", "result": "pass", "evidence": "0/1/2 各有用例"},
]
doc = {
    "schema": "syno-review-receipt/v1",
    "pr": pr,
    "patch_fingerprint": fpval,
    "author": "enc-w1",
    "reviewer": "verifier-fresh",
    "independence": indep,
    "verdict": "PASS",
    "checks": base_checks[:nchecks],
    "findings": [],
    "issued_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
    "tool": "pr-review@v1（.dsh/skills/pr-review/SKILL.md 五步）",
}
json.dump(doc, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  git -C "$R" add "docs/synova/reviews" || return 1
  mk_commit "$R" "review-receipt(${pr})" "$email"
}

fixture_write() { # <out> <tip> <ahead> <bhead> <chead> <dhead> <ehead> <case> <mut>
  python3 - "$@" <<'PY' || return 1
import json, sys
out, tip, ahead, bhead, chead, dhead, ehead, case, mut = sys.argv[1:10]
ok = {"state": "success", "total_count": 2, "statuses": [
    {"context": "local-gates / gates (push)", "status": "success"},
    {"context": "local-gates / gates (pull_request)", "status": "success"}]}
mixed = {"state": "pending", "total_count": 2, "statuses": [
    {"context": "local-gates / gates (push)", "status": "success"},
    {"context": "local-gates / gates (pull_request)", "status": "pending"}]}
void = {"state": "pending", "total_count": 0, "statuses": None}
ci = {ahead: ok, ehead: ok}
api_errors = {}
if case == "B":
    ci[ahead] = mixed
if case == "F" or mut == "ci_void":
    ci[ahead] = void
if case == "I":
    api_errors = {"open_prs": 500}
r100 = {"path": "docs/synova/reviews/100.<fp12>.json", "in_tree": True,
        "independence": "fresh-session", "fingerprint": "correct"}
r99 = {"in_tree": False}
if case == "D1":
    r100["in_tree"] = False
if case == "D2":
    r100["fingerprint"] = "wrong"
if case == "D4":
    r100["independence"] = "same-session"
if case == "G":
    r99 = {"in_tree": True, "independence": "fresh-session", "fingerprint": "correct"}
prhead = ahead
if mut == "head_unknown":
    prhead = "0123456789abcdef0123456789abcdef01234567"
fx = {
    "tip": tip,
    "author": "synova",
    "pr": {"number": 100, "head": prhead, "branch": "A"},
    "open_prs": [
        {"number": 101, "head": bhead, "branch": "B"},
        {"number": 102, "head": chead, "branch": "C"},
        {"number": 98, "head": dhead, "branch": "D"},
        {"number": 99, "head": ehead, "branch": "E"},
    ],
    "ci": ci,
    "receipt_by_pr": {"100": r100, "99": r99},
    "receipt_commit_after_code": (case != "D3"),
    "api_errors": api_errors,
}
json.dump(fx, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
}

build_repo() { # <case> <dir> [mut] → 造夹具仓 ＋ fixture.json（规格 §4.3.0 精确照此）
  local case="$1" dir="$2" mut="${3:-}" R T1 T2 A_code B_head C_head D_head E_head
  R="$dir/repo"
  rm -rf "$dir"
  mkdir -p "$dir"
  if ! git init -q "$R"; then return 1; fi
  git -C "$R" config user.email "agent@synova.local"
  git -C "$R" config user.name "agent"
  git -C "$R" config commit.gpgsign false
  if ! git -C "$R" checkout -q -b local-main 2>/dev/null; then return 1; fi
  # 基线 local-main: T1 → T2（T2 = 当前 tip）
  printf 'base1\n' > "$R/base.ts"
  git -C "$R" add base.ts
  mk_commit "$R" "T1" "agent@synova.local" || return 1
  T1="$(git -C "$R" rev-parse HEAD)"
  printf 'base2\n' > "$R/base.ts"
  git -C "$R" add base.ts
  mk_commit "$R" "T2" "agent@synova.local" || return 1
  T2="$(git -C "$R" rev-parse HEAD)"
  # 分支 A（本 PR #100）：基于 T2 改 a.ts
  git -C "$R" checkout -q -b A "$T2" || return 1
  printf 'a\n' > "$R/a.ts"
  git -C "$R" add a.ts
  mk_commit "$R" "A_code" "agent@synova.local" || return 1
  A_code="$(git -C "$R" rev-parse HEAD)"
  # 分支 B(101) / Cb(102) / D(98,基于 T1) / E(99)
  git -C "$R" checkout -q -b B "$T2" || return 1
  printf 'b\n' > "$R/b.ts"; git -C "$R" add b.ts
  mk_commit "$R" "B_code" "agent@synova.local" || return 1
  B_head="$(git -C "$R" rev-parse HEAD)"
  git -C "$R" checkout -q -b Cb "$T2" || return 1
  printf 'c\n' > "$R/c.ts"; git -C "$R" add c.ts
  mk_commit "$R" "C_code" "agent@synova.local" || return 1
  C_head="$(git -C "$R" rev-parse HEAD)"
  git -C "$R" checkout -q -b D "$T1" || return 1
  printf 'd\n' > "$R/d.ts"; git -C "$R" add d.ts
  mk_commit "$R" "D_code" "agent@synova.local" || return 1
  D_head="$(git -C "$R" rev-parse HEAD)"
  git -C "$R" checkout -q -b E "$T2" || return 1
  printf 'e\n' > "$R/e.ts"; git -C "$R" add e.ts
  mk_commit "$R" "E_code" "agent@synova.local" || return 1
  E_head="$(git -C "$R" rev-parse HEAD)"
  # 本 PR 的回执（attested 单轨：回执必须是本分支最后一个提交）
  local fp fpval fp12 wanted nchecks
  git -C "$R" checkout -q A || return 1
  fp="$(fp_of "$R" "$T2" "$A_code")" || return 1
  fp12="${fp:0:12}"
  fpval="sha256:${fp}"
  wanted="$fpval"
  nchecks=5
  case "$mut" in
    fp_prefix) fpval="sha256:${fp:0:63}" ;;   # 差 1 hex 且是前缀 ⇒ 禁前缀匹配
    checks4)   nchecks=4 ;;
  esac
  case "$case" in
    D1) : ;;                                   # 缺回执：不写文件
    D2)
      case "$fp" in
        a*) wanted="sha256:b${fp#a}" ;;
        *)  wanted="sha256:a${fp#?}" ;;
      esac
      write_receipt "$R" 100 "$wanted" "$fp12" "fresh-session" "reviewer@synova.local" "$nchecks" || return 1
      ;;
    D4) write_receipt "$R" 100 "$fpval" "$fp12" "same-session" "reviewer@synova.local" "$nchecks" || return 1 ;;
    H)  write_receipt "$R" 100 "$fpval" "$fp12" "fresh-session" "agent@synova.local" "$nchecks" || return 1 ;;
    *)  write_receipt "$R" 100 "$fpval" "$fp12" "fresh-session" "reviewer@synova.local" "$nchecks" || return 1 ;;
  esac
  A_head="$(git -C "$R" rev-parse HEAD)"
  # D3：回执之后仍有代码改动（R7）
  if [ "$case" = "D3" ]; then
    printf 'a2\n' >> "$R/a.ts"
    git -C "$R" add a.ts
    mk_commit "$R" "A_code2" "agent@synova.local" || return 1
    A_head="$(git -C "$R" rev-parse HEAD)"
  fi
  # C：把 101 的 head 换成「改 a.ts」的新分支 ⇒ 与 A 撞 a.ts
  if [ "$case" = "C" ]; then
    git -C "$R" checkout -q -b B2 "$T2" || return 1
    printf 'a-conflict\n' > "$R/a.ts"
    git -C "$R" add a.ts
    mk_commit "$R" "B2_code" "agent@synova.local" || return 1
    B_head="$(git -C "$R" rev-parse HEAD)"
  fi
  # G：给 99 号置回执 ⇒ 它进就绪集且编号更小（S2 红）
  if [ "$case" = "G" ]; then
    local fp99
    git -C "$R" checkout -q E || return 1
    fp99="$(fp_of "$R" "$T2" "$E_head")" || return 1
    write_receipt "$R" 99 "sha256:${fp99}" "${fp99:0:12}" "fresh-session" "reviewer@synova.local" 5 || return 1
    E_head="$(git -C "$R" rev-parse HEAD)"
  fi
  # E：tip 前移到 T3（A 不含 T3 ⇒ S1 红，落后 1 commit）
  local tip="$T2"
  if [ "$case" = "E" ]; then
    git -C "$R" checkout -q local-main || return 1
    printf 't3\n' > "$R/t3.ts"
    git -C "$R" add t3.ts
    mk_commit "$R" "T3" "agent@synova.local" || return 1
    tip="$(git -C "$R" rev-parse HEAD)"
  fi
  fixture_write "$dir/fixture.json" "$tip" "$A_head" "$B_head" "$C_head" "$D_head" "$E_head" "$case" "$mut" || return 1
  return 0
}

# ── 运行（零网络：API 层由夹具替换；degraded log 也落沙箱）──────────────────────
run_case() { # <dir> [额外参数...]
  local dir="$1"; shift
  mkdir -p "$dir"
  OUT="$dir/out.txt"
  ERR="$dir/err.txt"
  SYNO_MERGE_COND_FIXTURE="$dir/fixture.json" \
  SYNO_GATE_DEGRADED_LOG="$dir/degraded.log" \
    bash "$TOOL" --pr 100 --repo-root "$dir/repo" --base local-main "$@" > "$OUT" 2> "$ERR"
  RC=$?
}

run_cli() { # <dir> [参数...]（无夹具：参数/离线类边界）
  local dir="$1"; shift
  mkdir -p "$dir"
  OUT="$dir/out.txt"
  ERR="$dir/err.txt"
  bash "$TOOL" "$@" > "$OUT" 2> "$ERR"
  RC=$?
}

last_line() { tail -n 1 "$1" 2>/dev/null; }

# ── 判定点执行器：同时断言 inner_exit ＋ 末行 ＋ 证据片段 ＋ 条件隔离 ──────────────
judgment() { # <case> <want_exit> <want_last> [needle...]
  local case="$1" want_exit="$2" want_last="$3"
  shift 3
  local dir="$WORK/j/$case" got bad=""
  if ! build_repo "$case" "$dir"; then
    fail "$case 夹具构建失败"; return
  fi
  run_case "$dir"
  got="$(last_line "$OUT")"
  if [ "$RC" != "$want_exit" ]; then
    bad="inner_exit=${RC}（期望 ${want_exit}）"
  elif [ "$got" != "$want_last" ]; then
    bad="末行=[${got}]（期望 [${want_last}]）"
  else
    while [ $# -gt 0 ]; do
      if ! grep -Fq -- "$1" "$OUT" "$ERR"; then bad="缺证据「$1」"; break; fi
      shift
    done
  fi
  if [ -z "$bad" ] && [ "$want_exit" = "1" ]; then
    if ! grep -q '^MERGE-COND:' "$OUT"; then bad="缺 MERGE-COND 机器行"; fi
  fi
  if [ -z "$bad" ] && [ "$case" = "I" ]; then
    # DS-3：降级时禁输出 CAN-自合并 / ②=ok
    if grep -Fq -- 'CAN-自合并' "$OUT" || grep -Fq -- '②=ok' "$OUT"; then
      bad="降级时不得输出 CAN-自合并 / ②=ok"
    fi
  fi
  if [ -z "$bad" ]; then
    pass "$case inner_exit=${RC} 末行=[${got}]"
    echo "     原始输出尾 3 行:"
    tail -n 3 "$OUT" | sed 's/^/       | /'
    [ -s "$ERR" ] && sed 's/^/       | stderr: /' "$ERR"
  else
    fail "$case — $bad"
    echo "      原始输出（全量，不截断）:" >&2
    sed 's/^/       | /' "$OUT" >&2
    sed 's/^/       | stderr: /' "$ERR" >&2
  fi
}

# ── 边界执行器（C2；单列 EXTRA）──────────────────────────────────────────────
boundary() { # <name> <want_exit> <want_last> <needle...>
  local name="$1" want_exit="$2" want_last="$3"
  shift 3
  local got bad=""
  got="$(last_line "$OUT")"
  if [ "$RC" != "$want_exit" ]; then
    bad="inner_exit=${RC}（期望 ${want_exit}）"
  elif [ "$want_last" != "*" ] && [ "$got" != "$want_last" ]; then
    bad="末行=[${got}]（期望 [${want_last}]）"
  else
    while [ $# -gt 0 ]; do
      if ! grep -Fq -- "$1" "$OUT" "$ERR"; then bad="缺证据「$1」"; break; fi
      shift
    done
  fi
  if [ -z "$bad" ]; then
    extra "$name inner_exit=${RC} 末行=[${got}]"
  else
    fail "[边界] $name — $bad"
    sed 's/^/       | /' "$OUT" >&2
    sed 's/^/       | stderr: /' "$ERR" >&2
  fi
}

echo "═══ #582 四条件检查器 · CT-40 配对测试（W2）═══"
echo "被测: $REL_TOOL"
echo "沙箱: $WORK"
if [ ! -f "$TOOL" ]; then
  echo "❌ 被测件不存在: $REL_TOOL（W1 未交付）" >&2
  echo "结果: 0 通过, 1 失败"
  exit 1
fi

RO_BEFORE="$(git -C "$REPO_DIR" status --porcelain)"
mkdir -p "$WORK/j" "$WORK/cli"

echo
echo "── A 12 个判定点（逐子例独立夹具 ＋ 三态退出码）──"
judgment A  0 "CAN-自合并" \
  "③=ok(attested)" "①=ok" "②=ok" "④=ok" "MERGE-COND: can"
judgment B  1 "NO: ① CI 全绿 pending=0" \
  "local-gates / gates (pull_request)=pending" "①=no"
judgment C  1 "NO: ② 零写集重叠" \
  "a.ts → PR#100,#101" "②=no"
judgment D1 1 "NO: ③ 已过独立复核" "R1 缺回执" "③=no"
judgment D2 1 "NO: ③ 已过独立复核" "R3 指纹不匹配" "③=no"
judgment D3 1 "NO: ③ 已过独立复核" "R7 回执之后仍有代码改动" "③=no"
judgment D4 1 "NO: ③ 已过独立复核" "R2 independence 必须为 fresh-session" "③=no"
judgment E  1 "NO: ④ 串行" "S1 tip" "落后 1 commits" "④=no"
judgment F  2 "degraded: CI 信号量==0（state=pending total_count=0；禁判绿也禁判红）" \
  "degraded:" "total_count=0"
judgment G  1 "NO: ④ 串行" "S2 前置就绪 PR #99 编号更小 ⇒ 先合它" "④=no"
judgment H  0 "CAN-自合并" "warn: 身份未分离" "③=ok(attested)"
judgment I  2 "degraded: open PR 列表不可达（HTTP 500 on /pulls?state=open，fail-closed）" \
  "degraded:" "MERGE-COND: degraded" "①=ok"

echo
echo "── B C2 边界值（可离线复现；单列计数）──"

# K1 CI total_count=0 ⇒ exit 2（"看不见"≠"没问题"）
if build_repo A "$WORK/cli/k1" "ci_void"; then
  run_case "$WORK/cli/k1"
  boundary "K1 CI total_count=0 ⇒ exit 2" 2 "*" "degraded:" "total_count=0"
  assert_not_has "$OUT" "CAN-自合并" "K1 降级时禁输出 CAN-自合并" && extra "K1 降级不产 CAN-自合并"
else
  fail "[边界] K1 夹具构建失败"
fi

# K2 statuses 同有 success 与 pending ⇒ 红并点名 context（子例 B 已覆盖同形态，此处置名）
if build_repo B "$WORK/cli/k2"; then
  run_case "$WORK/cli/k2"
  boundary "K2 success+pending 并存 ⇒ 红" 1 "NO: ① CI 全绿 pending=0" \
    "local-gates / gates (pull_request)=pending"
else
  fail "[边界] K2 夹具构建失败"
fi

# K3 回执 fp 差 1 hex（且为 63 hex 前缀）⇒ 红 R3（禁前缀匹配）
if build_repo A "$WORK/cli/k3" "fp_prefix"; then
  run_case "$WORK/cli/k3"
  boundary "K3 fp 差 1 hex（前缀）⇒ 红 R3" 1 "NO: ③ 已过独立复核" "R3 指纹不匹配"
else
  fail "[边界] K3 夹具构建失败"
fi

# K4 checks 长度 = 4 ⇒ 红 R4（要求 >=5）
if build_repo A "$WORK/cli/k4" "checks4"; then
  run_case "$WORK/cli/k4"
  boundary "K4 checks=4 ⇒ 红 R4" 1 "NO: ③ 已过独立复核" "R4 checks 不足 5 条"
else
  fail "[边界] K4 夹具构建失败"
fi

# K5 --pr 指向取不到的 PR ⇒ exit 2（fail-closed；对应 C2「--pr 非 open」的离线代偿）
if build_repo A "$WORK/cli/k5"; then
  OUT="$WORK/cli/k5/out.txt"; ERR="$WORK/cli/k5/err.txt"
  SYNO_MERGE_COND_FIXTURE="$WORK/cli/k5/fixture.json" SYNO_GATE_DEGRADED_LOG="$WORK/cli/k5/degraded.log" \
    bash "$TOOL" --pr 77 --repo-root "$WORK/cli/k5/repo" --base local-main > "$OUT" 2> "$ERR"
  RC=$?
  boundary "K5 PR 取不到 ⇒ exit 2" 2 "*" "degraded:" "HTTP 500 on /pulls/77"
else
  fail "[边界] K5 夹具构建失败"
fi

# K6 --json 与 --selfcheck 同给 ⇒ exit 2（互斥，fail-loud）
run_cli "$WORK/cli/k6" --json --selfcheck
boundary "K6 --json ＋ --selfcheck ⇒ exit 2" 2 "*" "互斥" "E_ARGS_MUTEX"

# K7 --offline ⇒ ① 恒 exit 2（裁 B5：不引本地 CI 缓存）
run_cli "$WORK/cli/k7" --pr 100 --offline
boundary "K7 --offline ⇒ exit 2" 2 "*" "degraded:" "--offline 无 CI 真值"

# K8 本 PR 的 head 取不到 ⇒ exit 2
if build_repo A "$WORK/cli/k8" "head_unknown"; then
  run_case "$WORK/cli/k8"
  boundary "K8 head 取不到 ⇒ exit 2" 2 "*" "degraded:" "取不到"
else
  fail "[边界] K8 夹具构建失败"
fi

echo
echo "── C 接线替代自证（规格 §1.2：不接 pre-commit/CI ⇒ 用 --help ＋ --selfcheck）──"

# C1 --help 参数完备性（9 个参数逐一出现）
run_cli "$WORK/cli/help" --help
if [ "$RC" = "0" ]; then
  missing=""
  for opt in --pr --base --repo-root --json --offline --diff-fingerprint \
             --print-receipt-template --selfcheck --help; do
    grep -Fq -- "$opt" "$OUT" || missing="${missing} ${opt}"
  done
  if [ -z "$missing" ]; then
    extra "--help 参数完备（9 个参数齐，exit 0）"
  else
    fail "[边界] --help 缺参数:${missing}"
  fi
else
  fail "[边界] --help exit=${RC}（期望 0）"
fi

# C2 --selfcheck 12 判定点（与被测件自身口径对表）
OUT="$WORK/cli/selfcheck.txt"; ERR="$WORK/cli/selfcheck.err"
bash "$TOOL" --selfcheck > "$OUT" 2> "$ERR"
RC=$?
if [ "$RC" = "0" ] && grep -Fq "SELFCHECK-OK: 12/12" "$OUT"; then
  extra "--selfcheck exit=0 末行 SELFCHECK-OK: 12/12"
else
  fail "[边界] --selfcheck exit=${RC}，末行=[$(last_line "$OUT")]"
  sed 's/^/       | /' "$OUT" >&2
fi

# C3 只读证明：真实仓 status 逐字节不变（DS-10）
RO_AFTER="$(git -C "$REPO_DIR" status --porcelain)"
if [ "$RO_BEFORE" = "$RO_AFTER" ]; then
  extra "只读证明：运行前后 git status --porcelain 无差异"
else
  fail "[边界] 只读证明失败 — 真实仓 status 变了:"
  diff <(printf '%s\n' "$RO_BEFORE") <(printf '%s\n' "$RO_AFTER") | sed 's/^/       | /' >&2
fi

echo
echo "结果: ${PASS} 通过, ${FAIL} 失败"
if [ "$FAIL" -ne 0 ]; then exit 1; fi
if [ "$PASS" -ne 12 ]; then
  echo "❌ 判定点数 ${PASS} ≠ 12（规格 §4.1 N3：N 必须 = --selfcheck 的 12 个判定点）" >&2
  exit 1
fi
if [ "$EXTRA" -eq 0 ]; then
  echo "❌ 边界断言一条都没跑（判别力自检不可为空）" >&2
  exit 1
fi
exit 0
