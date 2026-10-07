#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═════════════════════════════════════════════════════════════════════
# check-required-contexts.test.sh — 必需 context ⇄ job `name:` 展开名 一致性门禁
#
# 背景: D971 同型失效 —— job `name:` 改一个字符 ⇒ 必需 context 静默失配 ⇒
#   check-run 永不上报 ⇒ PR 永久 blocked（405 "12 of 12 required status checks are expected."）。
#
# 覆盖矩阵（铁律 48: 正常/降级/边界 + 接线）:
#   D1147（单套门禁 · 批2，2026-10-05）: ①/⑤live少一条/⑥ 三处原**写死必需集里的具体 context 名或条数**
#     （`12/12`、`npm audit`）——必需集是**会变的**（12→9→10…），写死即每次变更都要改夹具。
#     现改为**从真/夹具基线派生**金丝雀与 N（语义与判别性不变，见各条内注）；本改动随本卡送 K3/CTO 过审。
#   正常 ① — 真仓默认模式 → exit 0 且 N/N 命中（N 从真基线派生，≥5 下限）（真机自检）
#   反例 ② — 夹具把 `name: Integration Contract Check` 改一个字符 → **必红（exit 1）且点名该 context**
#            （判别性: 夹具从真 ci.yml/真基线只读复制，改坏即红）
#   边界 ③ — 矩阵展开: `Vitest (1/2)/(2/2)`、`Test-Kit …(windows-latest)`、`Control Tower …(ubuntu-latest)`、
#            对象数组 `include:`（macos (dmg + zip)）必须被还原；矩阵取值改坏 → 必红；
#            块序列 `- a` 形式（合成夹具）→ exit 0；空 workflows 目录 → exit 2
#   降级 ④ — 基线缺失 → exit 2（**不是 0，也不是 1**）；基线 0 条 → exit 2；数据行畸形 → exit 2
#   降级 ⑤ — --api-check: gh 不可用（注入缝指向不存在路径）→ exit 2 + stderr `degraded:`
#            （Unix 专属）坏 gh shim 在 PATH → exit 2；stub gh: 一致→0 / live 多一条→1 点名 /
#            live 少一条→1 点名 / 非法 JSON→2 / 缺 required_status_checks→2
#   边界 ⑥ — 基线重复登记 → exit 1 点名；--reverse 报告模式对"缺产出"**不判违规**（exit 0 + NOTE）
#   只读 ⑦ — 静态断言: 本器无写保护规则调用（无 --method/-X，无 PATCH/PUT/POST/DELETE）
#   降级 ⑤b — `--allow-degraded`（D1111 CI 降级面，CI 上 github.token 无 admin 权限读保护规则）:
#            【四场景现状（8e05643a1 修复后；本文件逐条锁住，防回退）】
#              健康静态 + 坏 gh + 旗标 → 0 ｜ 健康静态 + 坏 gh 无旗标 → 2
#              ｜ **静态违规（改坏 job name）+ 坏 gh + 旗标 → 1 且点名** ｜ 判据源不可得（基线缺失）+ 旗标 → 2
#              语义边界: 旗标**只**降「live 取数失败」；`main()` 的 except 只 exit 2（旗标不是免检开关）
#            ① 坏 gh + `--api-check --allow-degraded` ⇒ exit 0 且 stderr 同时含 `degraded:` 与 `warning:`
#            ② 同场景**不带**旗标 ⇒ exit 2（fail-closed 未削弱）
#            ③ **静态面违规在降级下仍必红**：改坏 job name + 坏 gh + 旗标 ⇒ exit 1（不是 0）——最关键
#            ④ 旗标**单独使用**（无 --api-check / 无 Degrade）⇒ 行为与不带旗标完全一致（0/1 不变）
#            ⑤ [收紧断言] 判据自身不可得（基线缺失）+ 旗标 ⇒ 仍须 exit 2（"判据拿不到 ≠ 通过"）
#            ⑥ 降级必须**可见**：stdout 出 `SKIPPED(degraded)`（铁律 11 静默降级禁止）
#   接线 ⑧ — **真接线断言**（已接线）: ci.yml 调用 check-required-contexts.py（`run:` 段，非注释）
#            + canary 清单登记本测试；另用 ci.yml **副本**做反向验证（删接线 ⇒ 断言必失效）
#
# 历史与红线（不许回退）: 首版把 Degrade 早退放在静态裁决**之前** ⇒ 带 `--allow-degraded` 时连静态违规
#   也得 exit 0；CI 上 token 读不到 protection ⇒ 该步**恒绿**（空转门禁，D328 族；由本文件 ③ 抓出）。
#   已由 8e05643a1 修复: 降级**就地**收在 live 取数点、静态裁决继续执行、`main()` 的 except 只 exit 2。
#   ③⑤ 两条断言即该修复的判别性守卫 —— 严禁改写成"接受 exit 0"（把 fail-open 包装成通过；
#   V3.9 教训: 软机制 0% 有效）。
#
# 沙箱: 全部夹具在 mktemp -d 内；真 ci.yml / 真基线只**只读复制**；网络零依赖
#   （--api-check 的 live 数据由本地 stub gh / 注入缝提供，绝不打真 API）。
#
# ── SIGPIPE 假红硬化（#1214 / A8，2026-10-07）─────────────────────────────
# 病根: 断言写成 `echo "$OUT" | grep -q …` 或 `grep -v … "$f" | grep -q …` 时，
#   右侧 `grep -q` **命中即提前退出** ⇒ 左侧收到 SIGPIPE(141) ⇒ 本文件 `set -uo pipefail`
#   把整条管道判成 141 ⇒ `&&/||` 链走错分支 ⇒ **真接线判成接线缺失**（假红）。
# 实证（旧形态留档；本文件可复跑）:
#   `set -o pipefail; for i in $(seq 1 40); do grep -v '^[[:space:]]*#' .github/workflows/ci.yml \
#      | grep -q 'check-required-contexts\.py'; printf '%s ' $?; done`
#   → 实测 4/40 为 141（K3 独立实测 20/40；CI annotation 同型 broken pipe）。
#   本文件自身 10 连跑实测 2 次「45 通过 1 失败」，失败项恒为 ⑧ 接线缺失（即 wiring_ok 的管道）。
# 修法（先例: tests/control-tower/hard-gate-convergence.test.sh 的 PC_CODE_FILE 模式）:
#   runq 把 stdout/stderr **落盘**，全部断言改为 `grep … "$OUT_FILE"`/`"$ERR_FILE"`；
#   `grep -v … | grep -q …` 一律改为「先落一份去注释文件，再 grep 该文件」。
#   回归防线: 本文件全文不再有「左写右早退」的管道（下方 ⑦/wiring_ok 亦同）。
# ═════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
C="$REPO/scripts/control-tower/check-required-contexts.py"
BASE="$REPO/scripts/control-tower/required-checks-baseline.txt"
PY="$(command -v python3 || command -v python || true)"
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

OUT=""; ERR=""; RC=0
OUT_FILE="$TMPD/stdout.txt"; ERR_FILE="$TMPD/stderr.txt"
runq() { OUT="$("$@" 2>"$ERR_FILE")"; RC=$?; printf '%s\n' "$OUT" > "$OUT_FILE"; ERR="$(cat "$ERR_FILE" 2>/dev/null || true)"; }

# 取基线首条 context 名（#1214: `grep -v … | head -1` 同族早退管道 —— head 收工即给左侧 SIGPIPE）
first_ctx_of() { # $1 = 基线文件
  local f="$1" code="$TMPD/base-code.txt"
  grep -v '^[[:space:]]*#' "$f" > "$code" || true
  head -1 "$code" | cut -d'|' -f1 | sed -e 's/[[:space:]]*$//'
}

if [ -z "$PY" ]; then echo "  ⚠️ python 不可用 — 跳过（fail-open，铁律 11 显式）"; exit 0; fi
[ -f "$C" ] || { echo "  ❌ 被测脚本缺失: $C"; exit 1; }
[ -f "$BASE" ] || { echo "  ❌ 基线缺失: $BASE"; exit 1; }

echo "=== 必需 context ⇄ job name 展开名 一致性门禁 ==="

# ── 夹具工厂: 只读复制真 ci.yml + 真基线（零网络；改动只落 mktemp 沙箱）──
mk_fixture() { # $1 = 夹具根
  mkdir -p "$1/.github/workflows" "$1/scripts/control-tower"
  cp "$REPO/.github/workflows/ci.yml" "$1/.github/workflows/ci.yml"
  cp "$BASE" "$1/scripts/control-tower/required-checks-baseline.txt"
}
# 文本替换（不用 sed -i: BSD/GNU 语法不同）——$1=文件 $2=旧 $3=新
subst() { "$PY" - "$1" "$2" "$3" <<'PYEOF'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
if old not in text:
    sys.stderr.write("fixture-miss: %r\n" % old)
    sys.exit(3)
open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
PYEOF
}

# ── ① 正常: 真机自检 N/N（N = 真基线数据行数）──
#   D1147（单套门禁 · 批2）: 原写死 `12/12`。必需集是**会变的**（12→9→10…），写死即每次变更都要改夹具
#   ⇒ 改为从真基线数出 N，断言 `${N}/${N} 命中`，并加 `N ≥ 5` 下限（防"空/残基线 ⇒ 0/0 假绿"）。
#   判别性未放松: checker 少报一条即红；"删接线必失效"仍由 ⑧ 反向验证独立把守。
echo "── ① 正常（真机自检）──"
runq "$PY" "$C"
if [ "$RC" -eq 0 ]; then ok "真仓默认模式 → exit 0"; else no "真仓默认模式应 exit 0，实际 $RC: $(echo "$OUT" | tail -2 | tr '\n' '|')"; fi
N_EXPECTED="$(grep -v '^[[:space:]]*#' "$BASE" | grep -c 'source=branch-protection API' || true)"
if [ "${N_EXPECTED:-0}" -ge 5 ]; then
  ok "真基线数据行数 N=${N_EXPECTED}（≥5 下限成立）"
else
  no "真基线数据行数异常: ${N_EXPECTED:-0}（应 ≥ 5；空/残基线不得进入 ① 的比较）"
  N_EXPECTED=0
fi
grep -q "${N_EXPECTED}/${N_EXPECTED} 命中" "$OUT_FILE" && ok "${N_EXPECTED}/${N_EXPECTED} 必需 context 全命中" || no "未打印 ${N_EXPECTED}/${N_EXPECTED} 命中: $(echo "$OUT" | tail -3 | tr '\n' '|')"
grep -q "REQUIRED-CONTEXTS: OK" "$OUT_FILE" && ok "末行判定 REQUIRED-CONTEXTS: OK" || no "末行判定异常"

# ── ③ 矩阵展开可还原（--verbose 明细；含对象数组 include）──
echo "── ③ 矩阵展开 ──"
runq "$PY" "$C" --verbose
for want in "Vitest (1/2)" "Vitest (2/2)" "Test-Kit Architecture Tests (windows-latest)" \
            "Control Tower Gate Tests (ubuntu-latest)" "macos (dmg + zip)"; do
  grep -qF -- "$want" "$OUT_FILE" && ok "展开名可还原: $want" || no "展开名缺失: $want"
done

# ③b 木块序列 / include 对象数组（合成夹具，独立基线）
FIXB="$TMPD/fix-block"
mkdir -p "$FIXB/.github/workflows" "$FIXB/scripts/control-tower"
cat > "$FIXB/.github/workflows/synthetic.yml" <<'YML'
name: synthetic
on: [pull_request]
jobs:
  a:
    name: Alpha (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os:
          - ubuntu-latest
          - windows-latest
  b:
    name: Beta (${{ matrix.kind }})
    strategy:
      matrix:
        include:
          - kind: macos (dmg + zip)
          - kind: windows (nsis)
YML
cat > "$FIXB/scripts/control-tower/required-checks-baseline.txt" <<'BL'
# 合成夹具基线（本测试专用）
Alpha (ubuntu-latest) | owner=test | source=branch-protection API | as_of=2026-10-01T00:00:00Z | evidence=fixture
Alpha (windows-latest) | owner=test | source=branch-protection API | as_of=2026-10-01T00:00:00Z | evidence=fixture
Beta (macos (dmg + zip)) | owner=test | source=branch-protection API | as_of=2026-10-01T00:00:00Z | evidence=fixture
Beta (windows (nsis)) | owner=test | source=branch-protection API | as_of=2026-10-01T00:00:00Z | evidence=fixture
BL
runq "$PY" "$C" --root "$FIXB"
[ "$RC" -eq 0 ] && ok "块序列 + include 对象数组矩阵 → exit 0" || no "合成矩阵夹具应 exit 0，实际 $RC: $(echo "$OUT" | tail -2 | tr '\n' '|')"

# ③c 矩阵取值改坏 → 必红且点名（判别性）
FIXM="$TMPD/fix-matrix"
mk_fixture "$FIXM"
if subst "$FIXM/.github/workflows/ci.yml" "shard: [1/2, 2/2]" "shard: [9/9, 2/2]"; then
  runq "$PY" "$C" --root "$FIXM"
  [ "$RC" -eq 1 ] && grep -qF "Vitest (1/2)" "$OUT_FILE" \
    && ok "矩阵取值改坏 → exit 1 且点名 Vitest (1/2)" \
    || no "矩阵改坏应 exit 1 + 点名，实际 rc=$RC: $(echo "$OUT" | tail -3 | tr '\n' '|')"
else
  no "夹具变异失败（ci.yml 结构已变，须同步本测试的变异靶）"
fi

# ── ② 反例: job name 改一个字符 → 必红且点名 ──
echo "── ② 反例（判别性）──"
FIX1="$TMPD/fix-name"
mk_fixture "$FIX1"
if subst "$FIX1/.github/workflows/ci.yml" "name: Integration Contract Check" "name: Integration Contract Chek"; then
  runq "$PY" "$C" --root "$FIX1"
  [ "$RC" -eq 1 ] && ok "job name 改一字符 → exit 1" || no "应 exit 1，实际 $RC"
  grep -qF "VIOLATION: 必需 context 无任何 workflow job 产出: Integration Contract Check" "$OUT_FILE" \
    && ok "逐条点名失配 context（Integration Contract Check）" || no "未点名失配 context: $(grep VIOLATION "$OUT_FILE" | tr '\n' '|')"
  grep -qF "REQUIRED-CONTEXTS: VIOLATION(" "$OUT_FILE" && ok "末行判定 VIOLATION(n)" || no "末行判定异常"
  # ⑥b --reverse 报告模式: 同一夹具不判违规（信息级，exit 0 + NOTE 可见）
  runq "$PY" "$C" --root "$FIX1" --reverse
  [ "$RC" -eq 0 ] && grep -q "^NOTE: " "$OUT_FILE" \
    && ok "--reverse 报告模式不判违规（exit 0 + NOTE 可见）" \
    || no "--reverse 报告模式异常: rc=$RC"
else
  no "夹具变异失败（ci.yml 结构已变，须同步本测试的变异靶）"
fi

# ── ④ 降级: 基线/目录缺失或畸形 → exit 2（不是 0，不是 1）──
echo "── ④ 降级（fail-closed）──"
FIXN="$TMPD/fix-nobaseline"
mkdir -p "$FIXN/.github/workflows"
cp "$REPO/.github/workflows/ci.yml" "$FIXN/.github/workflows/ci.yml"
runq "$PY" "$C" --root "$FIXN"
[ "$RC" -eq 2 ] && ok "基线缺失 → exit 2（非 0 非 1）" || no "基线缺失应 exit 2，实际 $RC"
grep -q "^degraded: " "$ERR_FILE" && ok "stderr 出 degraded:（显式降级）" || no "stderr 缺 degraded 行: $ERR"
grep -q "REQUIRED-CONTEXTS: DEGRADED" "$OUT_FILE" && ok "末行 DEGRADED" || no "末行应 DEGRADED"

FIXE="$TMPD/fix-emptybaseline"
mk_fixture "$FIXE"
printf '# 只有注释，零数据行\n' > "$FIXE/scripts/control-tower/required-checks-baseline.txt"
runq "$PY" "$C" --root "$FIXE"
[ "$RC" -eq 2 ] && ok "基线 0 条数据行 → exit 2" || no "空基线应 exit 2，实际 $RC"

FIXR="$TMPD/fix-badbaseline"
mk_fixture "$FIXR"
printf 'NoFieldsHere\n' >> "$FIXR/scripts/control-tower/required-checks-baseline.txt"
runq "$PY" "$C" --root "$FIXR"
[ "$RC" -eq 2 ] && ok "数据行畸形（无 key=value）→ exit 2" || no "畸形基线应 exit 2，实际 $RC"

runq "$PY" "$C" --root "$TMPD/fix-nodir" --workflows "$TMPD/no-such-workflows"
[ "$RC" -eq 2 ] && ok "workflows 目录不存在 → exit 2" || no "缺 workflows 目录应 exit 2，实际 $RC"

# ── ⑥ 基线重复登记 → exit 1 ──
#   D1147: 原用写死的 `npm audit` 当"已在册项"——该 context 已随单套门禁移出必需集 ⇒ 写死即夹具随
#   必需集变更而失效。改为**从夹具基线自身取第一条登记名**当金丝雀（语义不变: 在册者再登记一次 = 重复），
#   并把"非空"作为前置断言（防空基线把消息断言变成恒真）。判别性: 重复未被检出 ⇒ rc≠1 ⇒ 红。
FIXD="$TMPD/fix-dup"
mk_fixture "$FIXD"
DUP_CANARY="$(first_ctx_of "$FIXD/scripts/control-tower/required-checks-baseline.txt")"
[ -n "$DUP_CANARY" ] || no "⑥ 夹具退化: 未能从夹具基线取到金丝雀 context 名"
printf '%s | owner=test | source=branch-protection API | as_of=2026-10-01T00:00:00Z | evidence=fixture\n' "$DUP_CANARY" \
  >> "$FIXD/scripts/control-tower/required-checks-baseline.txt"
runq "$PY" "$C" --root "$FIXD"
[ "$RC" -eq 1 ] && grep -qF "基线重复登记必需 context: ${DUP_CANARY}" "$OUT_FILE" \
  && ok "基线重复登记 → exit 1 且点名（金丝雀=${DUP_CANARY}）" || no "重复登记应 exit 1 + 点名，实际 rc=$RC"

# ── ④b 跨平台: CRLF 基线 + CRLF workflow → 仍 exit 0（Windows 检出层第一号陷阱）──
FIXCR="$TMPD/fix-crlf"; mk_fixture "$FIXCR"
"$PY" - "$FIXCR" <<'PYEOF'
import os, sys
root = sys.argv[1]
for rel in (".github/workflows/ci.yml", "scripts/control-tower/required-checks-baseline.txt"):
    path = os.path.join(root, rel)
    with open(path, "r", encoding="utf-8", newline="") as fh:
        text = fh.read().replace("\r\n", "\n")
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text.replace("\n", "\r\n"))
PYEOF
runq "$PY" "$C" --root "$FIXCR"
[ "$RC" -eq 0 ] && ok "CRLF 基线 + CRLF workflow → exit 0（CRLF 清洗）" \
  || no "CRLF 夹具应 exit 0，实际 $RC: $(echo "$OUT" | tail -2 | tr '\n' '|')"

# ── ⑤ --api-check（只读；零网络）──
echo "── ⑤ --api-check ──"
FIXA="$TMPD/fix-api"; mk_fixture "$FIXA"
runq env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/no-such-gh-binary" "$PY" "$C" --root "$FIXA" --api-check
[ "$RC" -eq 2 ] && ok "gh 不可用（注入缝指向不存在路径）→ exit 2" || no "gh 不可用应 exit 2，实际 $RC"
grep -q "^degraded: " "$ERR_FILE" && ok "gh 不可用时 stderr 出 degraded:（绝不判绿）" || no "缺 degraded 行: $ERR"

case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*|Windows*|unknown) WINLIKE=1 ;;
  *) WINLIKE=0 ;;
esac
if [ "$WINLIKE" -eq 0 ]; then
  # PATH 里的坏 gh shim（探"可用性"不只看存在性）
  SHIM="$TMPD/shim"; mkdir -p "$SHIM"
  printf '#!/bin/sh\necho "gh: not logged in (test shim)" >&2\nexit 4\n' > "$SHIM/gh"
  chmod +x "$SHIM/gh"
  runq env PATH="$SHIM:$PATH" "$PY" "$C" --root "$FIXA" --api-check
  [ "$RC" -eq 2 ] && grep -q "rc=4" "$ERR_FILE" \
    && ok "PATH 坏 gh shim（rc=4）→ exit 2 + degraded 带 rc" \
    || no "坏 shim 应 exit 2 + degraded(rc=4)，实际 rc=$RC: $ERR"

  # stub gh: live 数据由本地夹具 JSON 提供（零网络）
  "$PY" - "$BASE" "$TMPD/live-ok.json" <<'PYEOF'
import json, sys
names = []
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#"):
        names.append(line.split("|")[0].strip())
json.dump({"required_status_checks": {"contexts": names}}, open(sys.argv[2], "w", encoding="utf-8"))
PYEOF
  STUB="$TMPD/bin/gh"; mkdir -p "$TMPD/bin"
  printf '#!/bin/sh\ncat "$STUB_JSON"\n' > "$STUB"; chmod +x "$STUB"

  runq env SYNO_REQUIRED_CONTEXTS_GH="$STUB" STUB_JSON="$TMPD/live-ok.json" "$PY" "$C" --root "$FIXA" --api-check
  [ "$RC" -eq 0 ] && grep -q "双向零差集" "$OUT_FILE" \
    && ok "stub gh: live == 基线 → exit 0（双向零差集）" || no "live==基线应 exit 0，实际 rc=$RC"

  "$PY" - "$TMPD/live-ok.json" "$TMPD/live-extra.json" extra <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
data["required_status_checks"]["contexts"].append("Extra Unregistered Check")
json.dump(data, open(sys.argv[2], "w", encoding="utf-8"))
PYEOF
  runq env SYNO_REQUIRED_CONTEXTS_GH="$STUB" STUB_JSON="$TMPD/live-extra.json" "$PY" "$C" --root "$FIXA" --api-check
  [ "$RC" -eq 1 ] && grep -qF "live 必需 context 未登记进基线（基线缺 live）: Extra Unregistered Check" "$OUT_FILE" \
    && ok "live 多一条 → exit 1 且点名（基线缺 live）" || no "live 多一条应 exit 1 + 点名，实际 rc=$RC"

  # D1147: 金丝雀同样改为**从真基线取第一条登记名**（原写死 `npm audit`，已随单套门禁移出必需集）。
  LIVE_CANARY="$(first_ctx_of "$BASE")"
  [ -n "$LIVE_CANARY" ] || no "⑤ 夹具退化: 未能从真基线取到金丝雀 context 名"
  "$PY" - "$TMPD/live-ok.json" "$TMPD/live-less.json" "$LIVE_CANARY" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
ctx = data["required_status_checks"]["contexts"]
data["required_status_checks"]["contexts"] = [c for c in ctx if c != sys.argv[3]]
json.dump(data, open(sys.argv[2], "w", encoding="utf-8"))
PYEOF
  runq env SYNO_REQUIRED_CONTEXTS_GH="$STUB" STUB_JSON="$TMPD/live-less.json" "$PY" "$C" --root "$FIXA" --api-check
  [ "$RC" -eq 1 ] && grep -qF "基线登记但 live 已不是必需 context（live 缺基线）: ${LIVE_CANARY}" "$OUT_FILE" \
    && ok "live 少一条 → exit 1 且点名（live 缺基线；金丝雀=${LIVE_CANARY}）" || no "live 少一条应 exit 1 + 点名，实际 rc=$RC"

  printf 'not-json-at-all\n' > "$TMPD/live-bad.json"
  runq env SYNO_REQUIRED_CONTEXTS_GH="$STUB" STUB_JSON="$TMPD/live-bad.json" "$PY" "$C" --root "$FIXA" --api-check
  [ "$RC" -eq 2 ] && grep -q "输出非 JSON" "$ERR_FILE" \
    && ok "gh 输出非法 JSON → exit 2（fail-closed）" || no "非法 JSON 应 exit 2，实际 rc=$RC"

  printf '{"url":"x"}\n' > "$TMPD/live-shape.json"
  runq env SYNO_REQUIRED_CONTEXTS_GH="$STUB" STUB_JSON="$TMPD/live-shape.json" "$PY" "$C" --root "$FIXA" --api-check
  [ "$RC" -eq 2 ] && grep -q "required_status_checks" "$ERR_FILE" \
    && ok "缺 required_status_checks → exit 2（形状不符 fail-closed）" || no "形状不符应 exit 2，实际 rc=$RC"
else
  echo "  ⚠️ SKIP: Windows 无 POSIX 可执行 shim — PATH 坏 shim / stub gh 用例跳过（注入缝用例已覆盖降级路径）"
fi

# ── ⑤b --allow-degraded（D1111 CI 降级面；判定期望取自旗标契约，非实测行为）──
echo "── ⑤b --allow-degraded（CI 降级面）──"
FIXAD="$TMPD/fix-allow-degraded"; mk_fixture "$FIXAD"
BADGH="$TMPD/no-such-gh-binary"

# ① 坏 gh + --api-check --allow-degraded ⇒ exit 0，且 stderr 同时可见 degraded: / warning:
runq env SYNO_REQUIRED_CONTEXTS_GH="$BADGH" "$PY" "$C" --root "$FIXAD" --api-check --allow-degraded
[ "$RC" -eq 0 ] && ok "① 坏 gh + --api-check --allow-degraded → exit 0" \
  || no "① 应 exit 0（降级转 warning），实际 $RC: $(echo "$OUT" | tail -1)"
grep -q "^degraded: " "$ERR_FILE" && ok "① stderr 含 degraded:（降级原因可见）" \
  || no "① stderr 缺 degraded: 行: $ERR"
grep -q "^warning: " "$ERR_FILE" && ok "① stderr 含 warning:（降级被显式标注）" \
  || no "① stderr 缺 warning: 行: $ERR"

# ② 同场景**不带旗标** ⇒ exit 2（fail-closed 保留，不因新增旗标而削弱默认路径）
runq env SYNO_REQUIRED_CONTEXTS_GH="$BADGH" "$PY" "$C" --root "$FIXAD" --api-check
[ "$RC" -eq 2 ] && ok "② 同场景不带旗标 → exit 2（默认仍 fail-closed）" \
  || no "② 不带旗标应 exit 2，实际 $RC"

# ③ 最重要: **静态面违规在降级下仍必红** —— 改坏 job name + 坏 gh + 旗标 ⇒ exit 1（不是 0）
runq env SYNO_REQUIRED_CONTEXTS_GH="$BADGH" "$PY" "$C" --root "$FIX1" --api-check --allow-degraded
if [ "$RC" -eq 1 ]; then
  grep -q "^VIOLATION: " "$OUT_FILE" && ok "③ 静态面违规在降级下仍必红（exit 1 + 点名）" \
    || no "③ exit 1 但未点名 VIOLATION"
else
  no "③ 静态面违规被降级吞掉: 应 exit 1，实测 ${RC}（降级 ≠ 免检；根因+补丁见回执）"
fi

# ④ 旗标**单独使用**（无 --api-check ⇒ 无 Degrade 场景）⇒ 判定与不带旗标完全一致
runq "$PY" "$C" --root "$FIXAD" --allow-degraded
[ "$RC" -eq 0 ] && ok "④ 旗标单独使用（健康夹具）→ exit 0（与不带旗标一致）" \
  || no "④ 健康夹具 + 旗标应 exit 0，实际 $RC"
runq "$PY" "$C" --root "$FIX1" --allow-degraded
[ "$RC" -eq 1 ] && ok "④ 旗标单独使用（违规夹具）→ exit 1（与不带旗标一致）" \
  || no "④ 违规夹具 + 旗标应 exit 1，实际 $RC"

# ⑤ [收紧断言] 判据自身不可得（基线缺失）+ 旗标 ⇒ 仍须 exit 2：降级旗标覆盖的是
#    「live 对账取不到数」，不是「判据文件没了也能过」——后者是门禁静默失效（D328 族）。
runq "$PY" "$C" --root "$FIXN" --allow-degraded
[ "$RC" -eq 2 ] && ok "⑤ [收紧] 基线缺失 + 旗标 → 仍 exit 2（判据不可得 ≠ 通过）" \
  || no "⑤ [收紧] 基线缺失 + 旗标应 exit 2（判据不可得不得静默通过），实测 $RC"

# ⑥ 降级必须**可见**（铁律 11 静默降级禁止）: stdout 出 SKIPPED(degraded) 标注
runq env SYNO_REQUIRED_CONTEXTS_GH="$BADGH" "$PY" "$C" --root "$FIXAD" --api-check --allow-degraded
grep -q "SKIPPED(degraded)" "$OUT_FILE" && ok "⑥ 降级对 stdout 可见（SKIPPED(degraded)，非静默）" \
  || no "⑥ 降级未在 stdout 标注（静默降级，铁律 11）: $(echo "$OUT" | tail -2 | tr '\n' '|')"

# ── ⑦ 只读红线（静态断言: 无写保护规则调用）──
echo "── ⑦ 只读红线 ──"
# 去注释后的代码面只落一次文件（禁 `grep -v … | grep -q …`：左侧 SIGPIPE 假红，见文件头 #1214）
C_CODE_FILE="$TMPD/c-code.txt"
grep -v '^[[:space:]]*#' "$C" > "$C_CODE_FILE" || true
if grep -qE -- '--method|[[:space:]]-X[[:space:]]|PATCH|PUT|POST|DELETE' "$C_CODE_FILE"; then
  no "检出写保护规则调用（红线: 只报不改）"
else
  ok "无 --method/-X + 无 PATCH/PUT/POST/DELETE（只读 branch protection）"
fi
grep -q 'gh_bin, "api"' "$C_CODE_FILE" && ok 'gh 调用形态 = gh api <path>（默认 GET，无写方法）' || no "gh 调用形态异常"

# ── 启动方式（本卡验收命令形如 `bash <file>.py`）──
echo "── 启动方式 ──"
runq "$PY" "$C" --help
[ "$RC" -eq 0 ] && grep -q "用法\|usage" "$OUT_FILE" && ok "python 直呼 --help → exit 0" || no "python 直呼 --help 异常 rc=$RC"
if bash "$C" --help >"$TMPD/bash-help.out" 2>&1; then
  ok "bash <file>.py --help → exit 0（双语法首行）"
elif ! command -v python3 >/dev/null 2>&1; then
  echo "  ⚠️ SKIP: bash 直呼需 python3 在 PATH（本机无）"
else
  no "bash <file>.py --help 失败: $(head -1 "$TMPD/bash-help.out")"
fi

# ── ⑧ 生产接线断言（已接线；D1111 线负责人接线: ci.yml gate-integrity job + canary 清单）──
echo "── ⑧ 接线（真断言 + 反向验证）──"
CIY="${SYNO_CT_WIRING_CI_YML:-$REPO/.github/workflows/ci.yml}"
wiring_ok() { # $1 = ci.yml 路径；rc 0 = 接线完整（调用 + canary 登记 + run: 段命中，非仅注释）
  local f="$1"
  local code="$TMPD/wiring-code.txt"   # #1214: 去注释面落盘再 grep（旧形态 `grep -v … | grep -q …` 会 141 假红）
  [ -f "$f" ] || return 1
  grep -q "check-required-contexts" "$f" 2>/dev/null || return 1
  grep -q "check-required-contexts\.test\.sh" "$f" 2>/dev/null || return 1
  grep -v '^[[:space:]]*#' "$f" > "$code" || true
  grep -q "check-required-contexts\.py" "$code" || return 1
  return 0
}
if wiring_ok "$CIY"; then
  ok "接线: ci.yml 调用 check-required-contexts.py（run: 段，非注释）"
  ok "接线: ci.yml canary 清单登记 check-required-contexts.test.sh"
else
  no "接线缺失（${CIY}）: 须含 run: 段调用 check-required-contexts.py + canary 登记本测试"
fi
# 反向验证（判别性；夹具 = ci.yml **副本**，绝不碰真文件）: 删掉接线行 ⇒ wiring_ok 必判否
FIXY="$TMPD/wiring-stripped-ci.yml"
grep -v 'check-required-contexts' "$CIY" > "$FIXY" 2>/dev/null || true
if [ -s "$FIXY" ] && ! wiring_ok "$FIXY"; then
  ok "反向验证: 删掉接线（副本）⇒ 断言失效（不是纸老虎）"
else
  no "反向验证失败: 去掉接线后断言仍通过（夹具 ${FIXY}）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
