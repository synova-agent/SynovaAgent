#!/bin/bash
# D732 UTF-8 强制 ── Windows 控制台/子进程统一 UTF-8；中文路径与 emoji 断言跨平台一致
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# founder-truth-acceptance.test.sh — P4-B6 机械自证（6 项判据，一条命令可跑）
#
# 被测批次: P4-B6（B6 founder-truth 崩溃修复）
# 规格源: docs/plans/codex/implementation/SYNOVA-IMPL-2.1-B6-founder-truth-20261018.md
#         （§4 三路径 / §8「自证 6 项」；sha256/16 = be89850095e5fea7）
# 配对（CT-40 / dsh-code-standards B8）: 本件=批次自证脚本；判据对象 = W1
#   scripts/control-tower/founder-truth.py ＋ W2 tests/control-tower/founder-truth.test.sh
#   ＋ W3 scripts/control-tower/gate-integrity-baseline.txt（写集互斥 ⇒ 本件只读，不修改它们）。
# 设计哲学（一句）: 门禁只认「可复跑的状态」与「可复算的差分」——默认模式永远可判（不依赖 git diff），
#   --with-diff 才做一次性差分；任何"看不见"一律升为 exit 2，绝不静默当通过。
# 显式授权（谁调）: L1 收件闸 / CI 密封面（sealed-tests.sh 发现制自动纳入）/ 人工复核。
#   本件**只读仓库**（写点仅 SYNO_ACCEPTANCE_EVID_DIR 与 degraded 日志，均不入库）。
#
# 覆盖矩阵（6 项判据 · 铁律 48 三路径 ＋ 判别力自检）:
#   ①  三键齐（动态）  collect(offline=True) 的 migration 行必须带 id/title/phys；
#                      ⒝ 同一检查器对合成 legacy 行（task_id/num/claimed/hist/source/migration）必须报 missing=3
#                        ⇒ claims>0 ∧ missing_real==0 ∧ missing_syn==3 三者同时成立（缺一即红）
#   ②  :62 已收紧      founder-truth.test.sh 不含宽匹配 `grep -qE "🟢|🟡|🔴|⚪"`（grep -qF 判）
#                      且含 `grep -q "小结：🟢"` 精确断言；⒝ 伪造崩溃文本（Traceback ＋ 含 🟢 源码行 ＋
#                      KeyError: 'phys'）上新断言 rc≠0（必红）、旧宽匹配 rc=0（假绿）⇒ 两者同时成立
#   ③  隔离已解除      sealed --quarantine 输出**精确行**不存在 ∧ --list 输出**精确行**存在（grep -qx）
#                      ＋ sealed rc≠0 ⇒ exit 2（禁把"看不见"当通过）＋ baseline 缺失/不可读 ⇒ exit 2
#                      ＋ sealed 调用的 base 取 BASE 链同一个 ref 注入 SYNO_BASE_REF（D1227 越线判定需要；
#                        dev doc §5：门禁类命令不给 base 会看到"继承态红"，那不是本卡引入）
#      ③c（--with-diff）git diff --stat 含 `1 file changed` 与 `1 deletion(-)` 且不含 `insertion`
#   ④  --offline 跑通  rc∈{0,1}（不许 2）∧ `Traceback` 计数 = 0
#   ⑤  配对测试零失败  末段「结果: N 通过, M 失败」⇒ M==0 ∧ N≥14；解析不出 ⇒ exit 2
#   ⑥  judge()/main()  ast.dump 逐字相同 ⇒ PASS，否则 FAIL；默认 SKIP（--with-diff 才判）
#   ＋ 写集漂移        --with-diff：复用 scripts/workflow/check-dev-doc-write-set.sh；rc=0 ⇒ PASS；
#                      输出含「无写集表」⇒ WAIVED ＋ 回退断言（变更集合 == 声明 5 文件，双向）；
#                      其他 rc ⇒ FAIL；默认 SKIP
#
# @用法    bash tests/control-tower/founder-truth-acceptance.test.sh [--with-diff <base>]
#            默认 = **状态断言**（脚本进 tests/ 后由 sealed 发现制每次 CI 跑 ⇒ 必须永远可判、
#                   不依赖 git diff、退出 0；⑥/③c/写集漂移 显式 ⏭️ SKIP）
#            --with-diff [base] = 一次性差分模式（PR 正文证据）。base 省略时按 BASE 链取第一个
#              可解析者: SYNO_BASE_REF → GITHUB_BASE_REF → gitea/main → origin/main → HEAD^
#              （git rev-parse --verify -q "$ref^{commit}"）；全不可解析 ⇒ exit 2 ＋ degraded
# @输入    环境注入缝（生产有默认值；沙箱/测试用）:
#            SYNO_GATE_BASELINE        隔离台账（默认 scripts/control-tower/gate-integrity-baseline.txt）
#            SYNO_GATE_DEGRADED_LOG    降级日志（默认 .codex/control-tower/logs/degraded-events.log，已 gitignore）
#            SYNO_BASE_REF/GITHUB_BASE_REF  base 链前两跳（--with-diff 解析 base 与 ③ 的 sealed 越线判定共用）
#            SYNO_FOUNDER_OUT_DIR      ④ 生成物输出目录（本件缺省给 mktemp 隔离目录，绝不写仓库）
#            SYNO_DEV_DOC              写集漂移判据的 dev doc（默认本卡 doc）
#            SYNO_ACCEPTANCE_EVID_DIR  原始证据落盘目录（默认 /tmp/p4b6/gates；禁 head 截断）
# @输出    每项一行 `✅`/`❌`/`⏭️`（含实测数字）＋ 末行 `结果: N 通过, M 失败, K 跳过`；
#          每项的原始输出全量落 SYNO_ACCEPTANCE_EVID_DIR（`01-*`…`06-*`）。
# @exit    0 = 无失败（含"仅跳过"）；1 = 有判据红；2 = 检查自身失败/降级（fail-closed，2 ≠ 通过）
# @降级    依赖缺失/不可读/信号量==0/解析失败 ⇒ stderr 一行 `degraded: <原因>` ＋ 向
#          SYNO_GATE_DEGRADED_LOG 追加一行 JSON（字段 time/component/code/phase/retryable；铁律 11/32）＋ exit 2
# @已知限制
#   1) 默认模式**不做** diff 类判据（③c/⑥/写集漂移 显式 SKIP）⇒ 默认全绿**不等于**
#      "只改了声明写集"已证；后者只能由 --with-diff 或人工 diff 复核，不得把 SKIP 当 PASS。
#   2) ① 依赖仓库真数据面（.claude/claims/ 有 ≥1 条数字名 yaml）⇒ claims=0 视为**信号量==0** ⇒ exit 2，
#      **不**当"无 claim 行 ⇒ 通过"（禁把看不见当没问题）。
#   3) ② 是**文本级**收紧检测（宽 ERE 字符串消失 ＋ 精确断言出现，含注释在内）；
#      语义级"断言恒真"由 ②⒝ 判别力反例兜底（伪造崩溃文本上必须红、旧断言必须假绿）。
#   4) ⑤ 以配对测试输出**末段**「结果: N 通过, M 失败」为唯一计数真源（不数 ✅ 行）；
#      格式不可解析 ⇒ exit 2，不当 0 失败。
#   5) ⑥ 只比**模块顶层** FunctionDef `judge`/`main` 的 ast.dump；嵌套定义/装饰器已含在 dump 内，
#      但"语义等价改写"（换变量名）会判 FAIL —— 本判据刻意比字面（DS-4「判定语义未变」的硬下界）。
#   6) 迁移期结束（dev doc C3 失效条件）后本件须与 claim 行处理同批退役，否则 claims=0 ⇒ exit 2。
#   7) ③ 的 sealed 需要 base 才能区分「继承态越线」与「本 PR 越线」（D1227）：本件按 BASE 链注入
#      SYNO_BASE_REF；若连 HEAD^ 都不可解析（极浅克隆）且继承态 slack>SLACK-CAP ⇒ sealed 自身 rc=1
#      ⇒ 本件 exit 2（fail-closed；这是继承态问题，修法=显式上调台账 # FACE-TOTAL，禁在本件内自动上调）。
#   8) 本件**只读**：不 git add/commit/push/stash；不写仓库内任何 tracked/untracked 文件。
#
# 结构（Source map）: 常量 → 计数/降级 → 模式与 base 解析 → ① → ② → ③ → ③c → ④ → ⑤ → ⑥
#                    → 写集漂移 → 汇总
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

GEN="$REPO_DIR/scripts/control-tower/founder-truth.py"
FTEST="$REPO_DIR/tests/control-tower/founder-truth.test.sh"
SEALED="$REPO_DIR/scripts/control-tower/sealed-tests.sh"
WS_CHECK="$REPO_DIR/scripts/workflow/check-dev-doc-write-set.sh"
REL_BASELINE="scripts/control-tower/gate-integrity-baseline.txt"
BASELINE="${SYNO_GATE_BASELINE:-$REPO_DIR/$REL_BASELINE}"
DEV_DOC="${SYNO_DEV_DOC:-$REPO_DIR/docs/plans/codex/implementation/SYNOVA-IMPL-2.1-B6-founder-truth-20261018.md}"
DEG_LOG="${SYNO_GATE_DEGRADED_LOG:-$REPO_DIR/.codex/control-tower/logs/degraded-events.log}"
EVID_DIR="${SYNO_ACCEPTANCE_EVID_DIR:-/tmp/p4b6/gates}"

PASS=0
FAIL=0
SKIP=0
ok()   { PASS=$((PASS + 1)); echo "✅ $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "❌ $1"; }
skp()  { SKIP=$((SKIP + 1)); echo "⏭️ $1"; }

# 降级（铁律 11/32）：stderr 一行 `degraded: <原因>` ＋ JSON 行（time/component/code/phase/retryable）＋ exit 2。
#   追加日志失败**不得**掩盖 exit 2（原因已打 stderr）⇒ 显式 swallow-ok。
degrade() { # $1=code $2=phase $3=原因
  echo "degraded: $3" >&2
  mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null || true   # swallow-ok: 日志目录不可建不得掩盖 exit 2
  printf '{"time":"%s","component":"founder-truth-acceptance","code":"%s","phase":"%s","retryable":false}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$DEG_LOG" 2>/dev/null || true   # swallow-ok: 同上
  exit 2
}

is_uint() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

# BASE 链（dev doc §5 口径：门禁类命令必须给 base，否则会看到"继承态红"）：
#   SYNO_BASE_REF → GITHUB_BASE_REF → gitea/main → origin/main → HEAD^
#   输出第一个可解析 ref（空输出 + rc=1 = 全不可解析）。同一链供 --with-diff 与 ③ sealed 判定复用。
resolve_base_ref() {
  for _ref in "$@"; do
    [ -n "$_ref" ] || continue
    if git -C "$REPO_DIR" rev-parse --verify -q "$_ref^{commit}" >/dev/null 2>&1; then
      printf '%s' "$_ref"
      return 0
    fi
  done
  return 1
}

TMP_DIR="$(mktemp -d)" || { echo "degraded: mktemp -d 失败" >&2; exit 2; }
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$EVID_DIR" 2>/dev/null || true   # swallow-ok: 建不了由下一行显式 degrade 承接（不静默）
[ -d "$EVID_DIR" ] || degrade "E_EVID_DIR" "precondition" "证据目录不可建/不可写: $EVID_DIR"

MODE="state"
BASE_ARG=""
case "${1:-}" in
  "") ;;
  --with-diff)
    MODE="diff"; shift
    if [ "$#" -gt 0 ]; then BASE_ARG="$1"; shift; fi
    [ "$#" -eq 0 ] || { echo "未知参数（--with-diff 后仅接一个 base）: $*" >&2; exit 2; } ;;
  -h|--help)
    sed -n '2,120p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  *)
    echo "未知参数: $1（@用法: bash tests/control-tower/founder-truth-acceptance.test.sh [--with-diff <base>]）" >&2
    exit 2 ;;
esac

BASE=""
if [ "$MODE" = "diff" ]; then
  if [ -n "$BASE_ARG" ]; then
    git -C "$REPO_DIR" rev-parse --verify -q "$BASE_ARG^{commit}" >/dev/null \
      || degrade "E_BASE_UNRESOLVABLE" "resolve-base" "显式 base 不可解析: $BASE_ARG"
    BASE="$BASE_ARG"
  else
    BASE="$(resolve_base_ref "${SYNO_BASE_REF:-}" "${GITHUB_BASE_REF:-}" gitea/main origin/main HEAD^)" \
      || degrade "E_BASE_CHAIN_EMPTY" "resolve-base" \
        "base 链全不可解析（SYNO_BASE_REF/GITHUB_BASE_REF/gitea-main/origin-main/HEAD^）"
  fi
  echo "── 模式: --with-diff（base=${BASE}）──"
else
  echo "── 模式: 默认（状态断言；diff 类判据显式 SKIP）──"
fi

# ═════════════════════════════════════════════════════════════════════════════
# ① 三键齐（动态）＋ ⒝ 合成 legacy 行判别力（同一检查器）
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "── ① 三键齐: collect(offline=True) 的 migration 行必须带 id/title/phys ──"
[ -f "$GEN" ] || degrade "E_GEN_MISSING" "criterion-1" "被测生成器不可读: $GEN"
G1_RAW="$(python3 - "$GEN" 2>"$EVID_DIR/01-three-keys.stderr" <<'PY'
import importlib.util
import sys

_gen = sys.argv[1]
_spec = importlib.util.spec_from_file_location("founder_truth_under_test", _gen)
_mod = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _mod
_spec.loader.exec_module(_mod)

REQUIRED = ("id", "title", "phys")


def missing_count(rows):
    return sum(1 for row in rows for key in REQUIRED if key not in row)


def missing_names(rows):
    names = []
    for row in rows:
        for key in REQUIRED:
            if key not in row and key not in names:
                names.append(key)
    return ",".join(names) or "-"


rows, _git_ok = _mod.collect(offline=True)
claims = [r for r in rows if r.get("migration") is True]
# 合成 legacy 行 = 修前 claim 行的实际形状（只有 task_id/num/claimed/hist/source/migration）
synthetic_legacy = [{
    "task_id": "#9999", "num": None, "claimed": "claimed(claim)",
    "hist": False, "source": ".claude/claims/9999.yaml", "migration": True,
}]
print("claims=%d" % len(claims))
print("missing_real=%d" % missing_count(claims))
print("missing_syn=%d" % missing_count(synthetic_legacy))
print("missing_keys=%s" % missing_names(claims))
PY
)"
G1_RC=$?
[ "$G1_RC" -eq 0 ] || degrade "E_GEN_UNIMPORTABLE" "criterion-1" \
  "无法载入/执行被测生成器（rc=${G1_RC}；stderr 存 $EVID_DIR/01-three-keys.stderr）"

printf '%s\n' "$G1_RAW" > "$EVID_DIR/01-three-keys.out"
G1_CLAIMS="$(printf '%s\n' "$G1_RAW" | sed -n 's/^claims=//p')"
G1_MREAL="$(printf '%s\n' "$G1_RAW" | sed -n 's/^missing_real=//p')"
G1_MSYN="$(printf '%s\n' "$G1_RAW" | sed -n 's/^missing_syn=//p')"
G1_MKEYS="$(printf '%s\n' "$G1_RAW" | sed -n 's/^missing_keys=//p')"
is_uint "$G1_CLAIMS" && is_uint "$G1_MREAL" && is_uint "$G1_MSYN" \
  || degrade "E_GEN_OUTPUT" "criterion-1" "① 检查器输出不可解析: $(printf '%s' "$G1_RAW" | tr '\n' ' ')"
[ "$G1_CLAIMS" -gt 0 ] || degrade "E_ZERO_CLAIMS" "criterion-1" \
  "claims=0（信号量==0：.claude/claims/ 无数字名 *.yaml，本判据不可判 ⇒ 不当通过）"
if [ "$G1_MREAL" -eq 0 ] && [ "$G1_MSYN" -eq 3 ] && [ "$G1_CLAIMS" -gt 0 ]; then
  ok "① 三键齐: claims=$G1_CLAIMS missing_real=$G1_MREAL missing_syn=${G1_MSYN}（claims>0 ∧ missing_real==0 ∧ 合成 legacy 行 missing==3 三者同时成立）"
else
  bad "① 三键齐: claims=$G1_CLAIMS missing_real=${G1_MREAL}（缺键: ${G1_MKEYS}）missing_syn=$G1_MSYN — 期望 claims>0 ∧ missing_real==0 ∧ missing_syn==3"
fi

# ═════════════════════════════════════════════════════════════════════════════
# ② :62 假绿断言已收紧（状态）＋ ⒝ 判别力负例（伪造崩溃文本）
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "── ② :62 假绿断言已收紧（状态）＋ 判别力负例 ──"
[ -f "$FTEST" ] || degrade "E_FTEST_MISSING" "criterion-2" "配对测试不可读: $FTEST"
OLD_STR='grep -qE "🟢|🟡|🔴|⚪"'
NEW_ERE="grep -qF? [\"']小结：🟢"
OLD_HITS="$(grep -nF -- "$OLD_STR" "$FTEST" | cut -d: -f1 | tr '\n' ',')"
if grep -qF -- "$OLD_STR" "$FTEST"; then
  bad "②a :62 收紧未生效: founder-truth.test.sh 仍含宽匹配断言 ${OLD_STR}（命中行: ${OLD_HITS%,}）"
else
  ok "②a :62 收紧生效: 宽匹配断言 $OLD_STR 零命中（grep -qF 判定）"
fi
NEW_LINE="$(grep -nE -- "$NEW_ERE" "$FTEST" | head -1)"
if [ -n "$NEW_LINE" ]; then
  ok "②b 含「小结：🟢」精确断言（${NEW_LINE%%:*}行: $(printf '%s' "${NEW_LINE#*:}" | sed 's/^[[:space:]]*//')）"
else
  bad "②b 缺「小结：🟢」精确断言（grep -q/-qF 形式零命中）"
fi
# ⒝ 判别力: 伪造崩溃文本（Traceback ＋ 含 🟢 的源码行 ＋ KeyError: 'phys'）上，
#    新断言必红（无「小结：🟢」行）、旧宽匹配必假绿（命中源码行里的 🟢）。
BOOM="$TMP_DIR/forged-crash.txt"
{
  printf 'Traceback (most recent call last):\n'
  printf '  File "scripts/control-tower/founder-truth.py", line 92, in collect\n'
  printf '    return "🟢", "声称与物理一致"\n'
  printf "KeyError: 'phys'\n"
} > "$BOOM"
cp "$BOOM" "$EVID_DIR/02b-forged-crash.txt"
grep -q "小结：🟢" "$BOOM"; N_RC=$?
grep -qE "🟢|🟡|🔴|⚪" "$BOOM"; O_RC=$?
if [ "$N_RC" -ne 0 ] && [ "$O_RC" -eq 0 ]; then
  ok "②⒝ 判别力: 伪造崩溃文本上新断言 rc=${N_RC}（必红）∧ 旧宽匹配 rc=${O_RC}（假绿）⇒ 收紧有效"
else
  bad "②⒝ 判别力失效: 新断言 rc=${N_RC}（期望≠0）旧宽匹配 rc=${O_RC}（期望=0）—— 断言可能又变恒真"
fi

# ═════════════════════════════════════════════════════════════════════════════
# ③ 隔离已解除（sealed 发现制状态；台账不可读 ⇒ exit 2）
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "── ③ 隔离已解除: sealed --quarantine 精确行不存在 ∧ --list 精确行存在 ──"
[ -f "$BASELINE" ] && [ -r "$BASELINE" ] || degrade "E_BASELINE_UNREADABLE" "criterion-3" \
  "隔离台账缺失/不可读: $BASELINE"
[ -f "$SEALED" ] || degrade "E_SEALED_MISSING" "criterion-3" "sealed-tests.sh 不可读: $SEALED"
FT_REL="tests/control-tower/founder-truth.test.sh"
# ③ 的 sealed 调用同样要 base（D1227「越线者付账」：无 base 时继承态 slack>cap 会恒判红 ——
#   dev doc §5「门禁类命令必须给 base，否则会看到继承态红」）。base 链与 --with-diff 同源。
#   diff 模式直接用已解析 BASE；状态模式按同一链现取（取不到则不注入，交给 sealed 的"未给 base"语义 + rc 判定）。
SEALED_BASE="${BASE}"
if [ -z "$SEALED_BASE" ]; then
  SEALED_BASE="$(resolve_base_ref "${SYNO_BASE_REF:-}" "${GITHUB_BASE_REF:-}" gitea/main origin/main HEAD^)" || SEALED_BASE=""
fi
SYNO_BASE_REF="$SEALED_BASE" bash "$SEALED" --quarantine > "$EVID_DIR/03-sealed-quarantine.out" 2> "$EVID_DIR/03-sealed-quarantine.err"; Q_RC=$?
SYNO_BASE_REF="$SEALED_BASE" bash "$SEALED" --list > "$EVID_DIR/03-sealed-list.out" 2> "$EVID_DIR/03-sealed-list.err"; L_RC=$?
[ "$Q_RC" -eq 0 ] || degrade "E_SEALED_QUARANTINE_RC" "criterion-3" \
  "sealed-tests --quarantine rc=${Q_RC}（台账不可解析？stderr: $(tr '\n' ' ' < "$EVID_DIR/03-sealed-quarantine.err")）"
[ "$L_RC" -eq 0 ] || degrade "E_SEALED_LIST_RC" "criterion-3" \
  "sealed-tests --list rc=${L_RC}（stderr: $(tr '\n' ' ' < "$EVID_DIR/03-sealed-list.err")）"
if grep -qxF "$FT_REL" "$EVID_DIR/03-sealed-quarantine.out"; then
  bad "③ 隔离未解除: --quarantine 仍含精确行 ${FT_REL}（台账: ${BASELINE}）"
else
  ok "③ 隔离条目已删: --quarantine 不含精确行 ${FT_REL}（台账: ${BASELINE}）"
fi
if grep -qxF "$FT_REL" "$EVID_DIR/03-sealed-list.out"; then
  ok "③ 已进发现制: --list 含精确行 ${FT_REL}（执行集 = 发现面 − 隔离台账）"
else
  bad "③ 未进发现制: --list 不含精确行 ${FT_REL}（测试存在但不会被 CI 跑 = D526 形态）"
fi

# ═════════════════════════════════════════════════════════════════════════════
# ③c（--with-diff）baseline 只删 1 行
# ═════════════════════════════════════════════════════════════════════════════
if [ "$MODE" = "diff" ]; then
  D3_OUT="$EVID_DIR/03c-baseline-diff-stat.txt"
  git -C "$REPO_DIR" diff --stat "$BASE" -- "$REL_BASELINE" > "$D3_OUT" 2> "$EVID_DIR/03c-baseline-diff-stat.err"; D3_RC=$?
  [ "$D3_RC" -eq 0 ] || degrade "E_GIT_DIFF" "criterion-3c" \
    "git diff --stat ${BASE} -- ${REL_BASELINE} 失败（rc=${D3_RC}）"
  D3_SUM="$(tr '\n' ' ' < "$D3_OUT")"
  if printf '%s' "$D3_SUM" | grep -q '1 file changed' \
     && printf '%s' "$D3_SUM" | grep -q '1 deletion(-)' \
     && ! printf '%s' "$D3_SUM" | grep -q 'insertion'; then
    ok "③c baseline 只删 1 行: $D3_SUM"
  else
    bad "③c baseline 变更非「仅删 1 行」: ${D3_SUM:-（空 diff）} — 期望含 1 file changed/1 deletion(-) 且不含 insertion"
  fi
else
  skp "③c baseline 只删 1 行 SKIP(需 --with-diff)"
fi

# ═════════════════════════════════════════════════════════════════════════════
# ④ --offline 跑通（rc∈{0,1} ∧ Traceback=0）
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "── ④ --offline 跑通: rc∈{0,1} ∧ Traceback 计数=0 ──"
OUT_N1="$TMP_DIR/out-n1"
mkdir -p "$OUT_N1"
N1_OUT="$EVID_DIR/04-offline.out"
SYNO_FOUNDER_OUT_DIR="$OUT_N1" python3 "$GEN" --offline > "$N1_OUT" 2>&1; N1_RC=$?
TB_N="$(grep -c "Traceback" "$N1_OUT" | tr -d '\n\r' || true)"   # 模式 4 防 "0\n0"（grep -c 无命中 exit 1）
is_uint "$TB_N" || degrade "E_TRACEBACK_COUNT" "criterion-4" "Traceback 计数不可解析: [$TB_N]"
if [ "$TB_N" -eq 0 ] && { [ "$N1_RC" -eq 0 ] || [ "$N1_RC" -eq 1 ]; }; then
  ok "④ --offline: rc=${N1_RC}（∈{0,1}）Traceback=${TB_N}（输出 $(wc -l < "$N1_OUT" | tr -d ' ') 行）"
else
  bad "④ --offline: rc=${N1_RC}（期望 0/1，不许 2/崩溃）Traceback=${TB_N}（期望 0）— 原始输出: $N1_OUT"
fi

# ═════════════════════════════════════════════════════════════════════════════
# ⑤ 配对测试零失败（末段「结果: N 通过, M 失败」⇒ M==0 ∧ N≥14）
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "── ⑤ 配对测试零失败: 末段「结果: N 通过, M 失败」⇒ M==0 ∧ N≥14 ──"
FT_OUT="$EVID_DIR/05-founder-truth-test.out"
bash "$FTEST" > "$FT_OUT" 2>&1; FT_RC=$?
LAST="$(grep -E '结果: [0-9]+ 通过, [0-9]+ 失败' "$FT_OUT" | tail -1)"
[ -n "$LAST" ] || degrade "E_RESULT_UNPARSEABLE" "criterion-5" \
  "配对测试输出末段不可解析「结果: N 通过, M 失败」（rc=${FT_RC}；输出: ${FT_OUT}）"
FT_P="$(printf '%s' "$LAST" | sed -nE 's/.*结果: ([0-9]+) 通过, ([0-9]+) 失败.*/\1/p')"
FT_M="$(printf '%s' "$LAST" | sed -nE 's/.*结果: ([0-9]+) 通过, ([0-9]+) 失败.*/\2/p')"
is_uint "$FT_P" && is_uint "$FT_M" || degrade "E_RESULT_UNPARSEABLE" "criterion-5" \
  "末段计数不可解析: [$LAST]"
[ $((FT_P + FT_M)) -gt 0 ] || degrade "E_ZERO_ASSERTIONS" "criterion-5" \
  "通过+失败=0（信号量==0：配对测试没跑出断言，禁当 0 失败）"
if [ "$FT_M" -eq 0 ] && [ "$FT_P" -ge 14 ]; then
  ok "⑤ 配对测试: 末段「${LAST}」（rc=${FT_RC}，失败=0 且 通过=${FT_P}≥14）"
else
  bad "⑤ 配对测试: 末段「${LAST}」（rc=${FT_RC}）— 期望 失败=0 ∧ 通过≥14（原始输出: ${FT_OUT}）"
fi

# ═════════════════════════════════════════════════════════════════════════════
# ⑥（--with-diff）judge()/main() 零改动（ast.dump 逐字比）
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "── ⑥ judge()/main() 零改动（ast.dump 逐字比）──"
if [ "$MODE" = "diff" ]; then
  BASE_GEN="$TMP_DIR/base-founder-truth.py"
  git -C "$REPO_DIR" show "$BASE:scripts/control-tower/founder-truth.py" > "$BASE_GEN" 2> "$EVID_DIR/06-git-show.err"; GS_RC=$?
  if [ "$GS_RC" -ne 0 ] || [ ! -s "$BASE_GEN" ]; then
    degrade "E_BASE_FILE" "criterion-6" \
      "git show ${BASE}:scripts/control-tower/founder-truth.py 失败（rc=${GS_RC}；stderr 存 06-git-show.err）"
  fi
  A6_RAW="$(python3 - "$BASE_GEN" "$GEN" 2> "$EVID_DIR/06-ast.stderr" <<'PY'
import ast
import sys


def sig(path):
    with open(path, encoding="utf-8") as fh:
        tree = ast.parse(fh.read(), filename=path)
    out = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in ("judge", "main"):
            out[node.name] = ast.dump(node)
    return out


a, b = sig(sys.argv[1]), sig(sys.argv[2])
names = ("judge", "main")
missing = [n for n in names if n not in a or n not in b]
print("missing=" + (",".join(missing) or "-"))
print("judge_same=" + ("1" if ("judge" not in missing and a["judge"] == b["judge"]) else "0"))
print("main_same=" + ("1" if ("main" not in missing and a["main"] == b["main"]) else "0"))
PY
)"
  A6_RC=$?
  [ "$A6_RC" -eq 0 ] || degrade "E_AST_PARSE" "criterion-6" \
    "ast 解析失败（rc=${A6_RC}；stderr 存 06-ast.stderr）"
  printf '%s\n' "$A6_RAW" > "$EVID_DIR/06-ast.out"
  A6_MISS="$(printf '%s\n' "$A6_RAW" | sed -n 's/^missing=//p')"
  A6_J="$(printf '%s\n' "$A6_RAW" | sed -n 's/^judge_same=//p')"
  A6_M="$(printf '%s\n' "$A6_RAW" | sed -n 's/^main_same=//p')"
  if [ "$A6_J" = "1" ] && [ "$A6_M" = "1" ]; then
    ok "⑥ judge()/main() 零改动: ast.dump 逐字相同（base=${BASE}，两函数各 1 份，missing=${A6_MISS}）"
  else
    bad "⑥ judge()/main() 有改动: judge_same=$A6_J main_same=$A6_M missing=${A6_MISS}（base=${BASE}）— DS-4「判定语义未变」不成立"
  fi
else
  skp "⑥ judge()+main() 零改动 SKIP(需 --with-diff)"
fi

# ═════════════════════════════════════════════════════════════════════════════
# 写集漂移（--with-diff）：复用 check-dev-doc-write-set.sh ＋ 回退断言
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 写集漂移: 复用 check-dev-doc-write-set.sh（rc=0 直接 PASS）──"
if [ "$MODE" = "diff" ]; then
  [ -f "$WS_CHECK" ] || degrade "E_WS_CHECK_MISSING" "writeset" "check-dev-doc-write-set.sh 不可读: $WS_CHECK"
  [ -f "$DEV_DOC" ] || degrade "E_DEVDOC_MISSING" "writeset" "dev doc 不存在: $DEV_DOC"
  WS_OUT="$EVID_DIR/07-writeset-check.out"
  SYNO_DEV_DOC="$DEV_DOC" bash "$WS_CHECK" > "$WS_OUT" 2>&1; WS_RC=$?
  if [ "$WS_RC" -eq 0 ]; then
    ok "写集漂移: check-dev-doc-write-set rc=0（$(grep -E '✅|PASS' "$WS_OUT" | tail -1)）"
  elif grep -q '无写集表' "$WS_OUT"; then
    echo "WAIVED(check-dev-doc-write-set: dev doc 无写集表，不可解析)"
    DECLARED="$TMP_DIR/declared-writeset.txt"
    cat > "$DECLARED" <<'EOF'
memory/notes/proposed/2026-10-18-p4-b6-founder-truth.md
scripts/control-tower/founder-truth.py
scripts/control-tower/gate-integrity-baseline.txt
tests/control-tower/founder-truth-acceptance.test.sh
tests/control-tower/founder-truth.test.sh
EOF
    CHANGED="$TMP_DIR/changed-writeset.txt"
    {
      git -C "$REPO_DIR" diff --name-only "$BASE"
      git -C "$REPO_DIR" ls-files --others --exclude-standard
    } | sed '/^$/d' | sort -u > "$CHANGED"
    EXTRA="$TMP_DIR/writeset-extra.txt"
    MISSING="$TMP_DIR/writeset-missing.txt"
    comm -23 "$CHANGED" "$DECLARED" > "$EXTRA"
    comm -13 "$CHANGED" "$DECLARED" > "$MISSING"
    if [ ! -s "$EXTRA" ] && [ ! -s "$MISSING" ]; then
      ok "写集漂移(回退断言): 变更集合 == 声明集（5 文件全部出现，无越界；base=${BASE}）"
    else
      bad "写集漂移(回退断言): 越界=[$(tr '\n' ' ' < "$EXTRA")] 缺声明=[$(tr '\n' ' ' < "$MISSING")]（base=${BASE}）"
    fi
  else
    bad "写集漂移: check-dev-doc-write-set rc=${WS_RC}（非「无写集表」类）— $(tail -3 "$WS_OUT" | tr '\n' ' ')"
  fi
else
  skp "写集漂移 SKIP(需 --with-diff)"
fi

# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "结果: $PASS 通过, $FAIL 失败, $SKIP 跳过"
if [ "$FAIL" -eq 0 ]; then
  exit 0
fi
exit 1
