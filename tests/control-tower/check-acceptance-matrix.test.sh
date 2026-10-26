#!/bin/bash
# @requires python3
# ═══════════════════════════════════════════════════════════════════════════════
# check-acceptance-matrix.test.sh — #1054 验收矩阵校验器配对测试（CT-40；只读脚本 + mktemp 沙箱）
#
# 覆盖矩阵（铁律 48: 正常/降级/边界 + 改坏必红；ctrl-tower-change 模式 1: 三态 0/1/2）:
#   正常 — G0 自洽绿基线 ⇒ exit 0 ＋ 末行 `MATRIX: PASS 23/23`
#          A2 同夹具 `--verify` ⇒ exit 0 ＋ `VERIFY: mach 11/11 consistent`
#          A3 同夹具 `--json`   ⇒ exit 0 ＋ 可被 json 解析（items[].id/status/verdict ＋ summary）
#   改坏必红 — M1 删 Q-7 行 ⇒ exit 1 ＋ `E_MATRIX_ITEM_MISSING`
#              M2 n/a 项去掉 evidence.cmd ⇒ exit 1 ＋ `E_N/A_NO_EVIDENCE`
#              M3 pass 项 evidence.out 指向不存在文件 ⇒ exit 1 ＋ `E_EVIDENCE_UNRESOLVED`
#              M4 矩阵 anchor ≠ --anchor（两值皆可解析）⇒ exit 1 ＋ `E_ANCHOR_MISMATCH`
#              M5 含 src/**.ts 但覆盖率未武装 ⇒ exit 1 ＋ `E_COV_UNJUDGED`
#   边界 — E1 声明与机械事实矛盾（源文件缺 @exit 却声明 T-1 pass）⇒ exit 1 ＋ `E_MATRIX_SCHEMA`
#   降级 — D1 --anchor 指向不存在 commit ⇒ exit 2 ＋ `E_ANCHOR_MISMATCH` ＋ 降级日志恰 1 行 JSON
#              （字段 time/component/code/phase/retryable）
#          D2 --repo 指向不存在路径 ⇒ exit 2 ＋ 降级日志非空（**绝不 exit 0**）
#   判别力自证 — 变异体：SUT 改成"假绿"（恒 exit 0）后 M1 场景翻绿 ⇒ 证明 M1–M5 断言承重
#
# 隔离: 每个用例独立 mktemp 仓（git init ＋ 本地身份 ＋ 自造 anchor = 该仓 HEAD），
#       零网络、零宿主写入；**不依赖真实仓历史、不引用真实 anchor 5553bb95c**。
# 依赖: python3（与生产同契约；缺 ⇒ exit 2 —— 不静默当通过）；被测件缺失 ⇒ exit 2。
# WIRE CHECK 说明: P0 按规格 §3 明确**不接** pre-commit/CI（P2 起才接），故本测试
#       **不做**"生产接线 grep"断言 —— 这是规格决定，不是漏项（README 亦如此声明）。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$REPO/scripts/control-tower/check-acceptance-matrix.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
assert_rc() { if [ "$1" -eq "$2" ]; then ok "$3 (exit=$1)"; else no "$3 — exit=$1 期望 $2"; fi; }
contains() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

PYBIN=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null || continue
  if "$_c" -c 'import sys' >/dev/null 2>&1; then PYBIN="$_c"; break; fi  # swallow-ok: 探测型（试运行确认可用性，坏 shim 不算可用）
done
[ -n "$PYBIN" ] || { echo "❌ 缺 python3（检查自身失败）"; exit 2; }
[ -f "$SUT" ] || { echo "❌ 缺被测件: $SUT（检查自身失败）"; exit 2; }

TMPROOT="$(mktemp -d)"; trap 'rm -rf "$TMPROOT"' EXIT

# ── 夹具：每个用例独立 git 仓（base 提交 ＋ 变更提交 ⇒ HEAD~1 可用于 M4）──────────
# <dir> [green|noexit]；noexit = 去掉 @exit 行（制造"头部契约缺标签"的机械事实，供 E1）
mk_repo() {
  local d="$1" mode="${2:-green}"
  mkdir -p "$d/src"
  ( cd "$d"
    git init -q
    git config user.email t@t
    git config user.name t
    printf 'fixture baseline\n' > README.md
    git add -A
    git commit -q -m base
    cat > src/a.ts <<'TS'
/**
 * src/a.ts — 夹具源文件（非产品代码）
 * @input   无
 * @output  无
 * @exit    不退出
 * @degraded 不适用
 */
export function pick(x: 1 | 2): string {
  switch (x) {
    case 1: return 'one';
    case 2: return 'two';
    default: return assertNever(x);
  }
}

function assertNever(_x: never): never {
  throw new Error('unreachable');
}
TS
    if [ "$mode" = "noexit" ]; then
      grep -v '@exit' src/a.ts > src/a.tmp && mv src/a.tmp src/a.ts
    fi
    git add -A
    git commit -q -m change )
}

# ── 绿基线矩阵（23 行固定；机械项按 README F12 的口径声明）──────────────────────
# <dir> <anchor>；changed_files=[src/a.ts]、assertNever 在、四段头注释在、coverage_judged: true
emit_matrix() {
  cat > "$1/matrix.yaml" <<YAML
schema: acceptance-matrix/v1
issue: 1054
batch: G0-baseline
anchor: $2
changed_files: [src/a.ts]
coverage_judged: true
items:
  Q-1: {status: n/a, reason: "夹具：无工具 execute 面", evidence: {cmd: "git grep -c 'safeParse' HEAD -- src/a.ts"}}
  Q-2: {status: n/a, reason: "夹具：变更集无 UI 渲染产物", evidence: {cmd: "git grep -c 'secret' HEAD -- src/a.ts"}}
  Q-3: {status: partial, reason: "夹具：错误基类待补（语义槽位）", evidence: {cmd: "git show HEAD:src/a.ts", out: "src/a.ts"}}
  Q-4: {status: pass, evidence: {cmd: "git grep -c 'assertNever' HEAD -- src/a.ts", out: "src/a.ts"}}
  Q-5: {status: n/a, reason: "夹具：无取消面", evidence: {cmd: "git grep -c 'throwIfAborted' HEAD -- src/a.ts"}}
  Q-6: {status: n/a, reason: "夹具：变更集无测试或组件文件", evidence: {cmd: "git grep -c 'Date.now()' HEAD -- src/a.ts"}}
  Q-7: {status: n/a, reason: "夹具：无事件词表面", evidence: {cmd: "git grep -c 'eventCatalog' HEAD -- src/a.ts"}}
  Q-8: {status: n/a, reason: "夹具：路径不属版本或契约面", evidence: {cmd: "git grep -c 'VERSION' HEAD -- src/a.ts"}}
  Q-9: {status: n/a, reason: "夹具：无契约测试面", evidence: {cmd: "git grep -c 'contract' HEAD -- src/a.ts"}}
  Q-10: {status: n/a, reason: "夹具：无 expected 或 snapshot 配对物", evidence: {cmd: "git diff --name-only HEAD~1..HEAD"}}
  Q-11: {status: pass, evidence: {cmd: "git diff --name-only HEAD~1..HEAD", out: "src/a.ts"}}
  Q-12: {status: n/a, reason: "夹具：无并发上限面", evidence: {cmd: "git grep -c 'p-limit' HEAD -- src/a.ts"}}
  Q-13: {status: n/a, alias_of: "Q-2", reason: "Q-2 别名（同判据）", evidence: {cmd: "git grep -c 'secret' HEAD -- src/a.ts"}}
  Q-14: {status: deferred, reason: "夹具：遥测暂缓（挂真实台账号）", known_issue: 918}
  Q-15: {status: pass, evidence: {cmd: "git show HEAD:src/a.ts", out: "src/a.ts"}}
  T-1: {status: pass, evidence: {cmd: "git show HEAD:src/a.ts", out: "src/a.ts"}}
  T-2: {status: n/a, reason: "夹具：语义槽位", evidence: {cmd: "git grep -c 'typed' HEAD -- src/a.ts"}}
  T-3: {status: n/a, reason: "夹具：语义槽位", evidence: {cmd: "git grep -c 'fail loud' HEAD -- src/a.ts"}}
  T-4: {status: n/a, reason: "夹具：语义槽位", evidence: {cmd: "git grep -c '@authority' HEAD -- src/a.ts"}}
  T-5: {status: n/a, reason: "夹具：无 UI 或长期文档件", evidence: {cmd: "git grep -c 'Known Limitations' HEAD -- src/a.ts"}}
  T-6: {status: n/a, reason: "夹具：语义槽位", evidence: {cmd: "git grep -c '设计哲学' HEAD -- src/a.ts"}}
  T-7: {status: partial, reason: "夹具：无 committed 测试入变更集", evidence: {cmd: "git diff --name-only HEAD~1..HEAD", out: "src/a.ts"}}
  T-8: {status: n/a, reason: "夹具：无同父目录 ≥2 变更件", evidence: {cmd: "git diff --name-only HEAD~1..HEAD"}}
YAML
}

# ── 一组夹具（仓 ＋ 绿基线矩阵）⇒ FIX / ANCHOR_SHA / BASE_SHA ────────────────────
new_fixture() { # <name> [green|noexit]
  FIX="$TMPROOT/$1"
  mk_repo "$FIX" "${2:-green}"
  ANCHOR_SHA="$( cd "$FIX" && git rev-parse HEAD )"
  BASE_SHA="$( cd "$FIX" && git rev-parse HEAD~1 )"
  emit_matrix "$FIX" "$ANCHOR_SHA"
}

run_sut() { # <dir> <args...> → RUN_OUT / RUN_RC（cwd=该夹具仓；零宿主写入）
  local d="$1"; shift
  RUN_OUT="$( cd "$d" && "$PYBIN" "$SUT" "$@" 2>&1 )"; RUN_RC=$?
}
run_sut_logged() { # 同 run_sut，但降级日志写到 cwd 下相对文件（避免 MSYS/原生 python 路径错位）
  local d="$1"; shift
  RUN_OUT="$( cd "$d" && SYNO_GATE_DEGRADED_LOG=degraded.log "$PYBIN" "$SUT" "$@" 2>&1 )"; RUN_RC=$?
}
json_probe() { # <dir> <rel-json> → "OK <n> <keys> <all-items-ok> <pass> <mach_ok>/<mach_total>"
  ( cd "$1" && "$PYBIN" -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as exc:
    print("ERR", type(exc).__name__, exc)
    raise SystemExit(0)
items = d.get("items") or []
summary = d.get("summary") or {}
allk = all(("id" in i and "status" in i and "verdict" in i) for i in items)
print("OK", len(items), sorted(d.keys()), allk, summary.get("pass"),
      "%s/%s" % (summary.get("mach_ok"), summary.get("mach_total")))
' "$2" )
}
log_probe() { # <dir> <rel-log> → "LINES=<n>" / "MISSING=[...]" / "CODE=... PHASE=... COMPONENT=..."
  ( cd "$1" && "$PYBIN" -c '
import json, sys
lines = [l for l in open(sys.argv[1], encoding="utf-8").read().splitlines() if l.strip()]
print("LINES=%d" % len(lines))
if not lines:
    raise SystemExit(0)
try:
    d = json.loads(lines[0])
except Exception as exc:
    print("PARSE_ERR", exc)
    raise SystemExit(0)
need = ("time", "component", "code", "phase", "retryable")
print("MISSING=%s" % [k for k in need if k not in d])
print("CODE=%s PHASE=%s COMPONENT=%s RETRYABLE=%s" % (
    d.get("code"), d.get("phase"), d.get("component"), d.get("retryable")))
' "$2" )
}

echo "═══════════════════════════════════════════════════════════"
echo "  #1054 · check-acceptance-matrix（三态 ＋ 机械 11 项 ＋ 改坏必红）"
echo "═══════════════════════════════════════════════════════════"

# ── G0 绿基线 ⇒ exit 0（先证夹具本身是绿的，否则变异无判别力）──
new_fixture g0 green
run_sut "$FIX" matrix.yaml --repo .
assert_rc "$RUN_RC" 0 "G0 自洽绿基线 ⇒ exit 0"
contains "$RUN_OUT" "MATRIX: PASS 23/23" && ok "G0 末行 MATRIX: PASS 23/23" || no "G0 末行不合约: $RUN_OUT"
COUNT="$(printf '%s\n' "$RUN_OUT" | grep -cE '^(Q-[0-9]+|T-[0-9]+) ' || true)"
[ "$COUNT" = "23" ] && ok "G0 逐项行 23 行（实际 $COUNT）" || no "G0 逐项行数 $COUNT 期望 23"
G0_DIR="$FIX"

# ── A2 --verify / A3 --json（同夹具；支撑 README A2/A3）──
run_sut "$FIX" matrix.yaml --repo . --verify
assert_rc "$RUN_RC" 0 "A2 --verify 全一致 ⇒ exit 0"
contains "$RUN_OUT" "VERIFY: mach 11/11 consistent" && ok "A2 末行 VERIFY: mach 11/11 consistent" || no "A2 末行不合约: $RUN_OUT"
VCONS="$(printf '%s\n' "$RUN_OUT" | grep -c 'consistent=yes' || true)"
[ "$VCONS" = "11" ] && ok "A2 逐项 consistent=yes 恰 11 行" || no "A2 consistent=yes 行数 $VCONS 期望 11"
run_sut "$FIX" matrix.yaml --repo . --json
assert_rc "$RUN_RC" 0 "A3 --json ⇒ exit 0"
printf '%s\n' "$RUN_OUT" > "$FIX/a3.json"
JLINE="$(printf '%s\n' "$RUN_OUT" | grep -c . || true)"
[ "$JLINE" = "1" ] && ok "A3 stdout 恰 1 行 JSON（实际 $JLINE）" || no "A3 stdout 行数 $JLINE 期望 1"
J="$(json_probe "$FIX" a3.json)"
contains "$J" "OK 23 " && ok "A3 JSON items=23（$J）" || no "A3 JSON 不符: $J"
contains "$J" " True " && ok "A3 summary.pass=True（$J）" || no "A3 summary.pass 非 True: $J"
contains "$J" " 11/11" && ok "A3 summary mach_ok=11/11" || no "A3 mach 计数不符: $J"

# ── M1 删 Q-7 行 ⇒ exit 1 E_MATRIX_ITEM_MISSING ──
new_fixture m1 green
echo "  变异: sed '/^  Q-7: /d' matrix.yaml > m1.yaml"
sed '/^  Q-7: /d' "$FIX/matrix.yaml" > "$FIX/m1.yaml"
run_sut "$FIX" m1.yaml --repo .
assert_rc "$RUN_RC" 1 "M1 删 Q-7 行 ⇒ exit 1"
contains "$RUN_OUT" "E_MATRIX_ITEM_MISSING" && ok "M1 点名 E_MATRIX_ITEM_MISSING" || no "M1 未点名错误码: $RUN_OUT"
contains "$RUN_OUT" "Q-7" && ok "M1 detail 点名缺失项 Q-7" || no "M1 未点名 Q-7: $RUN_OUT"
M1_DIR="$FIX"

# ── M2 n/a 项去掉 evidence.cmd ⇒ exit 1 E_N/A_NO_EVIDENCE ──
new_fixture m2 green
echo "  变异: sed 替换 Q-2 行（去掉 evidence.cmd）> m2.yaml"
sed 's#^  Q-2: .*$#  Q-2: {status: n/a, reason: "M2 变异：n/a 无负证据命令"}#' "$FIX/matrix.yaml" > "$FIX/m2.yaml"
run_sut "$FIX" m2.yaml --repo .
assert_rc "$RUN_RC" 1 "M2 n/a 去 evidence.cmd ⇒ exit 1"
contains "$RUN_OUT" "E_N/A_NO_EVIDENCE" && ok "M2 点名 E_N/A_NO_EVIDENCE" || no "M2 未点名错误码: $RUN_OUT"

# ── M3 pass 项 out 指向不存在文件 ⇒ exit 1 E_EVIDENCE_UNRESOLVED ──
new_fixture m3 green
echo "  变异: sed 替换 Q-4 行（out=src/nope.ts）> m3.yaml"
sed 's#^  Q-4: .*$#  Q-4: {status: pass, evidence: {cmd: "grep assertNever src/a.ts", out: "src/nope.ts"}}#' "$FIX/matrix.yaml" > "$FIX/m3.yaml"
run_sut "$FIX" m3.yaml --repo .
assert_rc "$RUN_RC" 1 "M3 out 不存在 ⇒ exit 1"
contains "$RUN_OUT" "E_EVIDENCE_UNRESOLVED" && ok "M3 点名 E_EVIDENCE_UNRESOLVED" || no "M3 未点名错误码: $RUN_OUT"

# ── M4 矩阵 anchor ≠ --anchor（两者皆可解析）⇒ exit 1 E_ANCHOR_MISMATCH ──
new_fixture m4 green
echo "  变异: 矩阵 anchor 改 HEAD~1（$BASE_SHA），--anchor 传 HEAD（$ANCHOR_SHA）"
sed "s#^anchor: .*#anchor: $BASE_SHA#" "$FIX/matrix.yaml" > "$FIX/m4.yaml"
run_sut "$FIX" m4.yaml --repo . --anchor "$ANCHOR_SHA"
assert_rc "$RUN_RC" 1 "M4 anchor 不一致（皆可解析）⇒ exit 1"
contains "$RUN_OUT" "E_ANCHOR_MISMATCH" && ok "M4 点名 E_ANCHOR_MISMATCH" || no "M4 未点名错误码: $RUN_OUT"

# ── M5 含 src/**.ts 但覆盖率未武装 ⇒ exit 1 E_COV_UNJUDGED ──
new_fixture m5 green
echo "  变异: coverage_judged: true → false（且无 known_issues/known_issue）"
sed 's#^coverage_judged: .*#coverage_judged: false#' "$FIX/matrix.yaml" > "$FIX/m5.yaml"
run_sut "$FIX" m5.yaml --repo .
assert_rc "$RUN_RC" 1 "M5 覆盖率未武装 ⇒ exit 1"
contains "$RUN_OUT" "E_COV_UNJUDGED" && ok "M5 点名 E_COV_UNJUDGED" || no "M5 未点名错误码: $RUN_OUT"

# ── E1 声明与机械事实矛盾（源文件缺 @exit 却声明 T-1 pass）⇒ exit 1 E_MATRIX_SCHEMA ──
new_fixture e1 noexit
run_sut "$FIX" matrix.yaml --repo .
assert_rc "$RUN_RC" 1 "E1 T-1 声明 pass 但缺 @exit ⇒ exit 1"
contains "$RUN_OUT" "E_MATRIX_SCHEMA" && ok "E1 点名 E_MATRIX_SCHEMA（矛盾归口）" || no "E1 未点名错误码: $RUN_OUT"
contains "$RUN_OUT" "@exit" && ok "E1 detail 点名缺的标签 @exit" || no "E1 未点名 @exit: $RUN_OUT"

# ── D1 --anchor 指向不存在 commit ⇒ exit 2 ＋ 降级日志恰 1 行 JSON ──
new_fixture d1 green
rm -f "$FIX/degraded.log"
run_sut_logged "$FIX" matrix.yaml --repo . --anchor 0123456789012345678901234567890123456789
assert_rc "$RUN_RC" 2 "D1 anchor 不存在 ⇒ exit 2（判不了 ≠ 通过）"
contains "$RUN_OUT" "E_ANCHOR_MISMATCH" && ok "D1 点名 E_ANCHOR_MISMATCH" || no "D1 未点名错误码: $RUN_OUT"
contains "$RUN_OUT" "MATRIX: UNJUDGED" && ok "D1 末行 MATRIX: UNJUDGED" || no "D1 末行不合约: $RUN_OUT"
L="$(log_probe "$FIX" degraded.log)"
contains "$L" "LINES=1" && ok "D1 降级日志恰 1 行（$L）" || no "D1 降级日志行数不符: $L"
contains "$L" "MISSING=[]" && ok "D1 日志 5 字段齐（time/component/code/phase/retryable）" || no "D1 日志缺字段: $L"
contains "$L" "CODE=E_ANCHOR_MISMATCH" && ok "D1 日志 code=E_ANCHOR_MISMATCH" || no "D1 日志 code 不符: $L"

# ── D2 --repo 指向不存在路径 ⇒ exit 2 ＋ 降级日志非空（不 exit 0）──
new_fixture d2 green
rm -f "$FIX/degraded.log"
run_sut_logged "$FIX" matrix.yaml --repo "$TMPROOT/definitely-not-a-repo"
assert_rc "$RUN_RC" 2 "D2 仓不可读 ⇒ exit 2（不 exit 0）"
contains "$RUN_OUT" "E_ANCHOR_MISMATCH" && ok "D2 点名 E_ANCHOR_MISMATCH（phase=repo 归口）" || no "D2 未点名错误码: $RUN_OUT"
L2="$(log_probe "$FIX" degraded.log)"
contains "$L2" "LINES=1" && ok "D2 降级日志非空（$L2）" || no "D2 降级日志为空: $L2"
contains "$L2" "PHASE=repo" && ok "D2 日志 phase=repo（环境类归口）" || no "D2 日志 phase 不符: $L2"

# ── 判别力自证：SUT 变异为"假绿"（恒 exit 0）⇒ M1 场景翻绿 ⇒ M1–M5 断言承重 ──
FAKE="$TMPROOT/fake-green.py"
sed 's/^    sys\.exit(main())$/    sys.exit(0)/' "$SUT" > "$FAKE"
if cmp -s "$SUT" "$FAKE"; then
  no "判别力自证：变异锚点漂移（SUT 末尾不再是 sys.exit(main())，须重核）"
else
  FAKE_OUT="$( cd "$M1_DIR" && "$PYBIN" "$FAKE" m1.yaml --repo . 2>&1 )"; FAKE_RC=$?
  assert_rc "$FAKE_RC" 0 "判别力自证：SUT 变异为假绿后对 M1 输入 exit 0（真 SUT 为 1）⇒ M1 断言承重"
  contains "$FAKE_OUT" "E_MATRIX_ITEM_MISSING" && no "判别力自证：变异体仍点名 E_MATRIX_ITEM_MISSING（变异未生效）" || ok "判别力自证：变异体不再点名错误码（假绿无痕，真 SUT 必点名）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
