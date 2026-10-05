#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-required-contexts-order.test.sh — 必需 context 变更**顺序**检查（D1159）
#
# 判据源: K3 门禁治理波次审计（2026-10-05）§三 防线缺口收割第 4 行 +
#         "branch protection 先于 PR 被 PATCH 到 9" 的顺序风险（Q7 恢复面同条）。
#   语义（唯一判定轴）: **放宽允许先行**（移除必需永不阻断）/ **收紧必须等 PR 合并后**
#   （加必需 ⇒ 未含该 job 的在飞 PR 永不上报 ⇒ 永久 blocked，D971 同型 405）。
#
# 覆盖矩阵（铁律 48: 正常/反例/降级/边界 + 接线）:
#   正常 ① — live == base-ref 登记表 → exit 0（零差集）
#   差异 ② — **放宽在途**（live ⊂ M）→ 本器 **exit 0** 且逐条点名「放宽在途（合法）」；
#            同一份数据喂 peer（`check-required-contexts.py --api-check`，双向判据）→ **exit 1**
#            ⇒ 本条即"本器存在理由"的判别性证明（差异点被物理锁住，不是注释声称）
#   反例 ③ — **收紧先行**（live ⊃ M）→ **必 exit 1** 且点名 + 处置文字（"先…合并…再 PATCH live"）
#   边界 ⑥ — 候选登记表（工作树）变更 = **信息级**（不判违规）: 加登记须等合并 / 移除登记可先行
#   降级 ④ — gh 不可用（注入缝指向不存在路径）→ exit 2 + stderr `degraded:`（**不是 0，也不是 1**）
#   降级 ⑤ — `--base-ref` 不可解析 → exit 2 + `degraded:`（判据源拿不到 ⇒ 不判绿）
#   降级 ⑧ — 复用面（peer）缺失 → exit 2（不复制实现、不猜语义）
#   降级 ⑨ — 登记表 0 条 → exit 2
#   只读 ⑦ — 静态断言: 无写保护规则调用（无 --method/-X，无 PATCH/PUT/POST/DELETE）
#   接线 ⑩ — 文件名配对符合 ct-test-gate.sh 规则（scripts/control-tower/<n>.py ↔ tests/control-tower/<n>.test.sh）
#            + `bash <script>` 与 `python3 <script>` 双语法同判定（PLATFORM-CHECKLIST #1）
#
# 沙箱: 全部夹具在 mktemp -d 内（真脚本只**只读调用**，夹具登记表只读复制）；网络零依赖
#   （live 数据由本地 stub gh 经 `SYNO_REQUIRED_CONTEXTS_GH` 注入，绝不打真 API）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
C="$REPO/scripts/control-tower/check-required-contexts-order.py"
PEER="$REPO/scripts/control-tower/check-required-contexts.py"
PY="$(command -v python3 || command -v python || true)"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d "${TMPDIR:-/tmp}/d1159-order.XXXXXX")"
[ -d "$TMPD" ] || { echo "❌ fixture: mktemp 沙箱不可用"; exit 3; }
trap 'rm -rf "${TMPD:?}" 2>/dev/null || true' EXIT
mkdir -p "$TMPD/empty-hooks"

OUT=""; ERR=""; RC=0
# 沙箱存活守门: bash 3.2 实测 —— 管道里的「未绑定变量」错误会让 EXIT trap 中途开火（本文件首版踩中：
#   全角紧贴变量 `$W「` ⇒ unbound ⇒ trap 删沙箱）。沙箱一旦消失，后续 runq 的 `2>` 重定向失败、
#   RC 变成 1 ⇒ 恰好满足"应为 1"的断言 ⇒ **假绿**。故先验沙箱存在，缺失即报夹具失败并中止，
#   绝不产出任何指控被测脚本的结论。
runq() {
  if [ ! -d "$TMPD" ]; then
    echo "  ❌ fixture: 沙箱中途丢失 ${TMPD}（夹具自身失败，非被测缺陷）"
    echo ""; echo "结果: $PASS 通过, $((FAIL+1)) 失败"; exit 3
  fi
  OUT="$("$@" 2>"$TMPD/stderr.txt")"; RC=$?
  ERR="$(cat "$TMPD/stderr.txt" 2>/dev/null || true)"
}

if [ -z "$PY" ]; then echo "  ⚠️ python 不可用 — 跳过（fail-open，铁律 11 显式）"; exit 0; fi
[ -f "$C" ] || { echo "  ❌ 被测脚本缺失: $C"; exit 1; }
[ -f "$PEER" ] || { echo "  ❌ 复用面缺失: $PEER"; exit 1; }

echo "=== 必需 context 变更顺序检查（D1159）==="

# ── 夹具工具 ──────────────────────────────────────────────────────────────
# 登记表内容: `<CONTEXT> | owner=… | source=branch-protection API | as_of=… | evidence=…`（peer schema）
mk_baseline() { # $1=输出文件 $2..=context 名
  local out="$1"; shift
  : > "$out"
  local name
  for name in "$@"; do
    printf '%s | owner=UNASSIGNED | source=branch-protection API | as_of=2026-10-05T00:00:00Z | evidence=fixture\n' "$name" >> "$out"
  done
}
mk_livejson() { # $1=输出文件 $2..=live contexts
  local out="$1"; shift
  "$PY" - "$out" "$@" <<'PYEOF'
import json, sys
out, names = sys.argv[1], sys.argv[2:]
open(out, "w", encoding="utf-8").write(json.dumps({"required_status_checks": {"contexts": list(names)}}))
PYEOF
}
mk_gh() { # $1=stub gh 路径 $2=json 文件
  printf '#!/bin/sh\ncat "%s"\n' "$2" > "$1"
  chmod +x "$1"
}
mk_ci() { # $1=夹具根 $2..=job name（让 peer 静态面 required⊆produced 成立）
  local root="$1"; shift
  mkdir -p "$root/.github/workflows"
  {
    echo "name: fixture"
    echo "on: [pull_request]"
    echo "jobs:"
    local i=0 name
    for name in "$@"; do
      i=$((i+1))
      echo "  j$i:"
      echo "    name: $name"
    done
  } > "$root/.github/workflows/ci.yml"
}
mk_fixture() { # $1=夹具根 $2=M（已提交=base-ref 侧）内容文件 $3=C（工作树）内容文件 $4=ci.yml job 名列表文件
  local root="$1"
  mkdir -p "$root/scripts/control-tower"
  git init -q -b main "$root" >/dev/null 2>&1 || return 3
  git -C "$root" config user.name t
  git -C "$root" config user.email t@t
  git -C "$root" config core.hooksPath "$TMPD/empty-hooks"
  cp "$2" "$root/scripts/control-tower/required-checks-baseline.txt"
  if [ -s "$4" ]; then
    local names=() ln                      # 逐行读（context 名含空格，禁 `$(cat)` 分词）
    while IFS= read -r ln; do [ -n "$ln" ] && names+=("$ln"); done < "$4"
    mk_ci "$root" "${names[@]}"
  fi
  git -C "$root" add -A >/dev/null 2>&1
  git -C "$root" commit -qm seed >/dev/null 2>&1 || return 3
  git -C "$root" update-ref refs/remotes/origin/main HEAD     # M 侧 = 已提交版本
  cp "$3" "$root/scripts/control-tower/required-checks-baseline.txt"   # C 侧 = 工作树（未提交）
  return 0
}

A="Control Tower Gate Tests (ubuntu-latest)"
B="Vitest (1/2)"
W="Test-Kit Architecture Tests (windows-latest)"
mk_baseline "$TMPD/names-ab.txt" "$A" "$B"
mk_baseline "$TMPD/names-abw.txt" "$A" "$B" "$W"
printf '%s\n%s\n' "$A" "$B" > "$TMPD/jobs-ab.txt"
printf '%s\n%s\n%s\n' "$A" "$B" "$W" > "$TMPD/jobs-abw.txt"
mk_livejson "$TMPD/live-ab.json" "$A" "$B"
mk_livejson "$TMPD/live-abw.json" "$A" "$B" "$W"
mk_gh "$TMPD/gh-good-ab" "$TMPD/live-ab.json"
mk_gh "$TMPD/gh-good-abw" "$TMPD/live-abw.json"

# ── ① 正常: live == M == C ──
echo "── ① 正常（live == base-ref 登记表）──"
F1="$TMPD/fix-consistent"
mk_fixture "$F1" "$TMPD/names-ab.txt" "$TMPD/names-ab.txt" "$TMPD/jobs-ab.txt" || no "夹具① 构造失败"
runq env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/gh-good-ab" "$PY" "$C" --root "$F1"
[ "$RC" -eq 0 ] && ok "一致态 → exit 0" || no "一致态应 exit 0，实际 $RC: $(echo "$OUT" | tail -2 | tr '\n' '|')"
echo "$OUT" | grep -q "REQUIRED-CONTEXTS-ORDER: OK" && ok "末行固定三态: OK" || no "末行判定异常: $(echo "$OUT" | tail -1)"
echo "$OUT" | grep -q "逐字一致" && ok "输出说明零差集" || no "输出未说明零差集"

# ── ② 判决差异点: 放宽在途（live ⊂ M）→ 本器 0；同数据 peer 双向判据 → 1 ──
echo "── ② 放宽在途（本器的存在理由；与 peer 双向判据的差异点）──"
F2="$TMPD/fix-relax"; mk_fixture "$F2" "$TMPD/names-abw.txt" "$TMPD/names-ab.txt" "$TMPD/jobs-ab.txt" || no "夹具② 构造失败"
runq env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/gh-good-ab" "$PY" "$C" --root "$F2"
[ "$RC" -eq 0 ] && ok "放宽在途 → **exit 0**（移除必需永不阻断）" \
  || no "放宽在途被误判违规 → exit ${RC}（应与 peer 双向判据有别）: $(echo "$OUT" | tail -2 | tr '\n' '|')"
echo "$OUT" | grep -qF "放宽在途（合法）: live 已不再要求「${W}」" && ok "逐条点名被放宽的 context（可见性不省）" \
  || no "未点名被放宽的 context：$W"
echo "$OUT" | grep -q "放宽允许先行\|放宽在途\|放宽登记" && ok "输出写明「放宽允许先行」语义" || no "输出缺方向性说明"
# 对照: 同一份数据（live=[A,B]，基线侧=M=[A,B,W]）喂 peer 双向判据 —— 期望 exit 1
cp "$TMPD/names-abw.txt" "$TMPD/peer-baseline-abw.txt"
runq env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/gh-good-ab" "$PY" "$PEER" --root "$TMPD/fix-relax" \
     --baseline "$TMPD/peer-baseline-abw.txt" --api-check
[ "$RC" -eq 1 ] && ok "对照: peer 双向判据对同一数据判 **exit 1**（差异点物理锁住: 本器 0 / peer 1）" \
  || no "对照失败: peer 应对放宽在途判 1，实际 ${RC}（则本器与 peer 无差异 = 无存在理由）"

# ── ③ 反例: 收紧先行（live ⊃ M）→ 必红 ──
echo "── ③ 反例（收紧先行 → 必 exit 1）──"
F3="$TMPD/fix-tighten"; mk_fixture "$F3" "$TMPD/names-ab.txt" "$TMPD/names-ab.txt" "$TMPD/jobs-ab.txt" || no "夹具③ 构造失败"
runq env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/gh-good-abw" "$PY" "$C" --root "$F3"
[ "$RC" -eq 1 ] && ok "live 多出 1 条（main 登记表没有）→ exit 1" \
  || no "收紧先行未判红 → exit ${RC}（假绿: 在飞 PR 会被永久 blocked 却无人知）"
echo "$OUT" | grep -q "REQUIRED-CONTEXTS-ORDER: VIOLATION(1)" && ok "末行固定三态: VIOLATION(1)" || no "末行判定异常: $(echo "$OUT" | tail -1)"
echo "$OUT" | grep -qF "收紧先行: live 必需 context「${W}」" && ok "逐条点名该 context" || no "未点名该 context"
echo "$OUT" | grep -q "先.*合并.*再.*PATCH live" && ok "输出给出处置（先合并再 PATCH）" || no "输出缺处置指引"
echo "$OUT" | grep -q "永久 blocked" && ok "输出写明危害（在飞 PR 永久 blocked / D971 同型）" || no "输出缺危害说明"

# ── ⑥ 边界: 候选登记表变更 = 信息级（不判违规）──
echo "── ⑥ 边界（候选登记表变更仅信息级）──"
F6="$TMPD/fix-cand"; mk_fixture "$F6" "$TMPD/names-ab.txt" "$TMPD/names-abw.txt" "$TMPD/jobs-abw.txt" || no "夹具⑥ 构造失败"
runq env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/gh-good-ab" "$PY" "$C" --root "$F6"
[ "$RC" -eq 0 ] && ok "候选要加登记（live 未收紧）→ exit 0（意图不判违规，判事实）" \
  || no "候选登记变更被误判违规 → exit $RC"
echo "$OUT" | grep -qF "+ 收紧登记: $W" && ok "打印候选将做的收紧（信息级）" || no "未打印候选收紧项"
echo "$OUT" | grep -q "再.*PATCH live\|必须先合并本分支" && ok "打印顺序约束（先合并再 PATCH）" || no "候选段缺顺序约束"

# ── ④ 降级: gh 不可用 ──
echo "── ④ 降级（gh 不可用）──"
runq env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/gh-does-not-exist" "$PY" "$C" --root "$F1"
[ "$RC" -eq 2 ] && ok "gh 不可用 → exit 2（不是 0，也不是 1）" || no "gh 不可用应 exit 2，实际 $RC"
echo "$ERR" | grep -q "^degraded: " && ok "stderr 显式 degraded:（铁律 11 不静默）" || no "缺 degraded: 行"
echo "$OUT" | grep -q "REQUIRED-CONTEXTS-ORDER: DEGRADED" && ok "末行固定三态: DEGRADED" || no "末行未标 DEGRADED"

# ── ⑤ 降级: base-ref 不可解析 ──
echo "── ⑤ 降级（base-ref 不可解析）──"
runq env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/gh-good-ab" "$PY" "$C" --root "$F1" --base-ref origin/no-such-ref
[ "$RC" -eq 2 ] && ok "base-ref 不可解析 → exit 2（判据源拿不到 ≠ 通过）" || no "应 exit 2，实际 $RC"
echo "$ERR" | grep -q "登记表取不到" && ok "stderr 点名原因（侧别+rc）" || no "degraded 原因不具体: $ERR"

# ── ⑨ 降级: 登记表 0 条 ──
echo "── ⑨ 降级（登记表 0 条）──"
F9="$TMPD/fix-empty"; mk_baseline "$TMPD/names-empty.txt"
mk_fixture "$F9" "$TMPD/names-empty.txt" "$TMPD/names-empty.txt" "$TMPD/jobs-ab.txt" >/dev/null 2>&1
runq env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/gh-good-ab" "$PY" "$C" --root "$F9"
[ "$RC" -eq 2 ] && ok "空登记簿 → exit 2（比对无意义，fail-closed）" || no "空登记簿应 exit 2，实际 $RC"

# ── ⑧ 降级: 复用面（peer）缺失 ──
echo "── ⑧ 降级（复用面缺失）──"
X="$TMPD/fix-nopeer"; mkdir -p "$X/scripts/control-tower" "$X/.github/workflows"
cp "$C" "$X/scripts/control-tower/"           # 只拷被测脚本，不拷 peer
runq env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/gh-good-ab" "$PY" "$X/scripts/control-tower/$(basename "$C")" --root "$X"
[ "$RC" -eq 2 ] && ok "peer 不在（两处都找不到）→ exit 2（不复制实现、不猜语义）" || no "peer 缺失应 exit 2，实际 $RC"
echo "$ERR" | grep -q "复用面缺失" && ok "stderr 点名「复用面缺失」" || no "degraded 原因未点名复用面: $ERR"

# ── ⑦ 只读静态断言 ──
#   口径修正（首版踩中假红，记此）: 直接 grep 全文会把**提示文本里的词**当调用（本文件首版：
#   处置文案里有「再 PATCH live」⇒ 词法检查误判"源码有写方法"）。故先做**词法剥离**
#   （去注释 + 去字符串/三引号字面量）再 grep ⇒ 只判真代码，不判文案。
echo "── ⑦ 只读（红线: 不改 branch protection）──"
SRC_LEX="$("$PY" - "$C" <<'PYEOF'
import io, re, sys
src = io.open(sys.argv[1], encoding="utf-8").read()
src = re.sub(r'"""(?:.|\n)*?"""', '""', src)      # 三引号
src = re.sub(r"'''(?:.|\n)*?'''", "''", src)
src = re.sub(r'"(?:\\.|[^"\\])*"', '""', src)      # 双引号字面量
src = re.sub(r"'(?:\\.|[^'\\])*'", "''", src)      # 单引号字面量
sys.stdout.write("\n".join(l for l in src.splitlines() if not l.lstrip().startswith('#')))
PYEOF
)"
echo "$SRC_LEX" | grep -qE '\-\-method|(^|[[:space:]])-X([[:space:]]|$)' \
  && no "源码出现 REST 写方法开关（--method/-X）（只读红线）" || ok "无 --method/-X（无写方法的开关）"
echo "$SRC_LEX" | grep -qE '\b(PATCH|PUT|POST|DELETE)\b' \
  && no "源码出现 REST 写方法名（PATCH/PUT/POST/DELETE）（只读红线）" || ok "无 PATCH/PUT/POST/DELETE（去注释/字面量后）"
N_SP="$(echo "$SRC_LEX" | grep -c 'subprocess\.run' || true)"
[ "${N_SP:-0}" -eq 1 ] && ok "只有 1 处 subprocess（无自建 gh 子进程调用）" \
  || no "subprocess.run 处数异常: ${N_SP:-0}（应恰 1 处 = git show）"
# 参数表断言须用**保留字面量**的版本（词法剥离把字符串换成 "" ⇒ 参数看不见），故此处另取 SRC_NC
SRC_NC="$(grep -v '^[[:space:]]*#' "$C" | grep -v '^[[:space:]]*$' || true)"
echo "$SRC_NC" | grep -q '\["git", "-C", root, "show"' && ok "该处为 git show（读 base-ref 登记表）" \
  || no "唯一 subprocess 不是 git show（疑似自建网络调用）"
echo "$SRC_LEX" | grep -q "fetch_live_contexts" && ok "接线: live 取数复用 peer.fetch_live_contexts" \
  || no "未复用以有取数实现（重造）"

# ── ⑩ 接线 + 双语法 ──
echo "── ⑩ 接线 / 双语法 ──"
"$PY" "$C" --version >/dev/null 2>&1 && ok "--version 可用" || no "--version 不可用"
[ "$(basename "$C" .py)" = "$(basename "${BASH_SOURCE[0]}" .test.sh)" ] \
  && ok "配对名符合 ct-test-gate 规则（$(basename "$C" .py) ↔ 本测试）" \
  || no "配对名不符 ct-test-gate 规则（提交时会被 U7/CT-40 拦）"
OUT_B="$(env SYNO_REQUIRED_CONTEXTS_GH="$TMPD/gh-good-ab" bash "$C" --root "$F1" 2>&1)"; RC_B=$?
[ "$RC_B" -eq 0 ] && ok "bash 双语法可用（sh 侧 exec 到 python，与 python 路径同判定: exit ${RC_B}）" \
  || no "bash 双语法判定异常: exit ${RC_B}（夹具① 期望 0）"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
