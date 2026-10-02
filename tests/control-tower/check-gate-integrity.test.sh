#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-gate-integrity.test.sh — M9 夹具: 门禁完整性检查器（模式哨兵 + 登记 gate + 红对账）
#
# 被测: scripts/control-tower/check-gate-integrity.sh（M9 唯一新脚本）
# 沙箱: 全部 hermetic —— 六个注入缝（SYNO_GATE_SCAN_SCRIPTS / SYNO_TESTS_DIR / SYNO_CI_YML /
#       SYNO_GATE_BASELINE / SYNO_CI_RED_BASELINE / SYNO_GATE_DEGRADED_LOG）全部指向 mktemp 目录，
#       仓库工作区零写入；红证样本只存在于 /tmp 副本（收尾有断言）。
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界 + 判别性）:
#   正常 — 干净沙箱（脚本+清单+双段基线自洽）→ exit 0 + 末行 `GATE-INTEGRITY: OK`
#   正常 — C 模式: 冻结格式 `NAME | first_seen=… | owner=… | expires=…` 命中 → exit 0（C1 回归）
#   正常 — C 模式: 端到端复现（自造 JSON 含两条已登记红，其中一条含中文/全角括号/点号）→ exit 0
#   正常 — C 模式: 无空格旧格式 `NAME|first_seen=…|expires=…` → exit 0（向后兼容）
#   边界 — C 模式: expires 已过期 → exit 1 且必须命中「CI 红基线过期」（C2 回归，不得只因别的文案而绿）
#   降级 — C 模式: 条目缺 expires 键 → exit 2（malformed 不静默当 0 = fail-open）
#   降级 — ci.yml 缺失 / 基线缺失 / --ci-reds 非法 JSON → 各自 exit 2 + stderr `degraded:` + 日志 JSON 五字段
#   边界 — 基线条目过期（幽灵条目）→ exit 1；扫描脚本解析到 0 个模式 → exit 2
#   边界 — 模式隔离: --patterns-only 不因 registry 面缺失而降级
#   棘轮 — PATTERN-BASELINE: 真仓库 --patterns-only → exit 0（:991 已登记；本平台/GNU STALE 亦不影响退出码）
#   棘轮 — PATTERN 条目 expires 过期 → exit 1（硬门，registered / STALE 皆不放行）
#   棘轮 — ① 修好副本（坐标不再违规）→ STALE(方言) + exit 0；③ STALE 且过期 → 仍 exit 1（反"拔牙"）；⑩ 混合计数
#   棘轮 — ④ step summary: GITHUB_STEP_SUMMARY 可写 → 落 `## Gate Integrity` 块；存在但不可写 → 显式 degrade
#   棘轮 — 跨方言陷阱: :991 在 BSD rc=2(违规) / GNU 合法(不违规) → "已不再违规"不得判红（CTO 裁定 A）
#   跨方言 — **"非法 ERE"夹具一律用方言无关构造 `a(b`**（括号不平衡，BSD/GNU 均 rc=2）；
#            `^+++` 只作 PROBE_RE 探针与 :991 的 STALE 双分支，**不参与 pass/fail**。
#            （#768 CI 实测: 旧夹具拿 ^+++ 当非法 ERE → GNU 下合法 → 该坐标落 STALE 而非"待修违规"
#             → 5 条断言连锁红 PASS=50 FAIL=5；本机 GNU 仿真 shim 可逐字复现同一组）
#   健壮 — 失败路径必须能播报: no()/ok() 文案里 `${VAR}` **必须加花括号** —— 全角标点紧贴变量
#            （`$rc（…）`）在 macOS/bash 3.2 + UTF-8 locale 下被解析成变量名 `rc（` → set -u 下
#            unbound variable → **夹具整体崩在断言处、结果行永不产出**（比截断更糟）。11 处已修。
#   分段 — 双段互不串行: [R] 段 key 不给 A 模式豁免；[P] 段条目不进 registry 面
#   判别性 — M1 未登记的新非法 ERE（临时脚本）→ 必红（exit 1 + 点名 file:line + 模式原文）
#   判别性 — M2 从基线删 1 条仍存在的未登记项 → 必红
#   判别性 — M4 把检查器副本的哨兵核心置为 return 0 → M1 场景必须不再红（证明夹具依赖真哨兵）
#   判别性 — M5 伪造 check-runs JSON 多加一条未登记 failure → 必红
#   回归 — M6 相邻引号段拼接模式（`'a'\"b\"'c'`）不得被截断成假违规（dev-doc-gatekeeper.sh:109 形态）
#
# B 模式分面口径（CTO 冻结 2026-09-24，实测于 base 416b4667）:
#   违规面 = CI 密封面（*.test.sh / *.test.py；只有被显式登记才会在 CI 执行）；
#   登记判定 = 路径出现在 .github/workflows/ci.yml 全文（密封 for t in 或任意 job 的 run: 步骤）；
#   *.test.ts 只统计 + NOTE（vitest glob 自动覆盖），不计违规。
#   实测: sh|py 122 文件 / 命中 43 / 未登记 79；ts 610 / 命中 1（且该 ts 文件不在盘上）。
#
# 基线取值铁律（C1/C2 缺陷教训，2026-09-24 独立自验复现）:
#   · name 匹配容忍 `|` 前空格；name 内 ERE 元字符整体转义（检查名可能含中文/全角括号/点号）
#   · expires/owner **按键取值**，绝不按字段序号（冻结格式 $2 = first_seen，不是 expires）
#   · 缺 expires 键 → exit 2 degrade（静默当 0 = fail-open）
#
# 平台方言（CTO 裁定 A，2026-09-24）: 同一坐标跨方言判定不同 ——
#   `scripts/pre-commit-check.sh:991` 的 `^+++` 在 BSD grep rc=2（非法=违规）、GNU grep 合法（不违规）。
#   故"条目已不再违规"记 STALE（可见/计数/标注平台）而**不判违规**；expires 仍是硬门（缺键 exit 2 / 过期 exit 1）。
#   本地夹具用 `sed '/grep -Ev/ …'` 造出"修好副本"作为 CI(GNU) 情形的等价物（只改 ERE 那条，避免把 :492 的 BRE 也改坏）。
#
# 已知边界（与本器头注释一致）: 整行注释不扫；变量/命令替换模式与 -P PCRE 计"不可校验"。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/check-gate-integrity.sh"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

SB="$TMPD/sb"
mkdir -p "$SB/scripts" "$SB/tests/control-tower" "$SB/logs"
MARK="INJECTED""-RED"      # 拼接构造：本文件源码内不出现该字面量（收尾断言仓库零命中）
# 方言无关的"非法 ERE"夹具: **括号不平衡 a(b** —— BSD 与 GNU 均判 rc=2（POSIX ERE 未闭合括号 = 语法错误）。
#   历史（#768 CI 实测）: 旧夹具拿 ^+++ 当"非法 ERE"，但 BSD rc=2 / **GNU 合法 rc=1** → 方言敏感：
#   GNU 上该坐标不再是违规 → 条目落 STALE 而非"待修违规" → 5 条断言连锁红
#   （CI: PASS=50 FAIL=5 FIRST_FAIL=PATTERN 过期未触发；本机 GNU 仿真 shim 逐字复现同一组）。
#   ^+++ 现仅保留给 PROBE_RE（方言探针）与真仓库 :991 的 STALE 双分支场景，**不参与 pass/fail**。
BAD_RE='['"a"               # 拼接构造（未闭合方括号表达式 = POSIX 明确非法）: 本文件/扫描面内不出现该字面量
PROBE_RE='^+'"++"           # 拼接构造方言探针模式（= ^+++；BSD rc=2 / GNU rc 0-1）——只作探针，不判 pass/fail
# BAD_RE 本平台实测 rc（#774 windows 断案用）: 2 = 按预期非法 → 走「违规 + 过期」路径；
#   0/1 = 本平台连未闭合方括号都容忍 → 条目落 STALE 路径，断言消息随之不同（见各断言载荷）。
printf 'test\n' | grep -Ev -- "$BAD_RE" >/dev/null 2>&1; BADRE_RC=$?
NAME_CN='门禁完整性（gate-integrity）检查 v1.2'   # 含中文/全角括号/点号 → 转义回归

PASS=0; FAIL=0
FIRST_FAIL=""
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
# D938-CI-2(可见性): FIRST_FAIL 压进结果行——ci.yml 注解 tail-8|cut -c1-450 会截掉散落的 ❌
#   （本测试 55+ 断言，#741 CI 注解盲区实证）。no() 会紧跟打印原始输出块，失败名更易被顶出窗口。
no() {
  echo "  ❌ $1"
  FAIL=$((FAIL + 1))
  if [ -z "$FIRST_FAIL" ]; then FIRST_FAIL="$1"; fi
  echo "  ----- 原始输出 -----"
  printf '%s\n' "${OUT:-（空）}"
  echo "  --------------------"
}
last_line() { printf '%s\n' "$1" | tail -1; }
# ── 紧凑诊断载荷（#774 windows 红1）─────────────────────────────────────────
#   为何需要: ci.yml 注解只取 `tail -8 | cut -c1-450`，而失败多发生在输出中段 →
#   注解里看不到现场。故把「路径判别」短字段压进断言名：断言名会进 FIRST_FAIL →
#   结果行 → 注解，等于把现场搬到末尾 8 行内。
#   预算: 载荷一律 ≤120B，且只用 grep -oE 摘**定长片段**（绝不 head -c/cut -b 切多字节字符）。
d_viol()   { printf '%s' "${OUT:-}" | grep -c 'VIOLATION' || true; }
d_stale()  { printf '%s' "${OUT:-}" | grep -oE 'STALE\([a-z]+\)' | head -1; }
d_counts() { printf '%s' "${OUT:-}" | grep -oE 'registered [0-9]+；STALE\([0-9]+\)' | head -1; }
d_pt()     { printf '%s' "${OUT:-}" | grep -oE 'm1-scan\.sh:[0-9]+' | wc -l | tr -d ' '; }
# 检查器**自报**的坐标原文（ASCII 定长摘取；绝不用 {} 量词/cut -b/'head -c' ——
#   实测 BSD grep 的 `.{0,N}` 按**字节**截，会把中文切成坏 UTF-8，故一律摘 ASCII 片段）。
d_coord()  { printf '%s' "${OUT:-}" | grep -oE '[^ 	]*m1-scan\.sh:[0-9]+' | head -1; }

RUN() { # $1=scan $2=tests_dir $3=ci_yml $4=baseline $5=red_baseline $6=degraded_log ；其后 = 检查器参数
  local scan="$1" tests="$2" ciyml="$3" base="$4" redbase="$5" dlog="$6"
  shift 6
  SYNO_GATE_SCAN_SCRIPTS="$scan" \
  SYNO_TESTS_DIR="$tests" \
  SYNO_CI_YML="$ciyml" \
  SYNO_GATE_BASELINE="$base" \
  SYNO_CI_RED_BASELINE="$redbase" \
  SYNO_GATE_DEGRADED_LOG="$dlog" \
  bash "$GATE" --root "$REPO" "$@"
}

echo "=== M9: check-gate-integrity.sh 夹具（hermetic）==="
[ -f "$GATE" ] && ok "被测脚本存在: scripts/control-tower/check-gate-integrity.sh" || no "被测脚本缺失: $GATE"

# ── 沙箱: 干净仓库（脚本 + ci.yml + 双段基线自洽）────────────────────────────
SCAN_OK="$SB/scripts/scan.sh"
cat > "$SCAN_OK" <<'EOS'
#!/bin/bash
echo a | grep -E '^alpha'
grep -v '^+++' "$1"
EOS
printf '#!/bin/bash\n' > "$SB/tests/control-tower/alpha.test.sh"
printf '#!/bin/bash\n' > "$SB/tests/control-tower/beta.test.sh"
cat > "$SB/ci.yml" <<'EOY'
name: ci
jobs:
  control-tower-tests:
    steps:
      - run: |
          for t in \
            tests/control-tower/alpha.test.sh; do
            bash "$t"
          done
EOY
cat > "$SB/baseline.txt" <<'EOB'
# 夹具基线（双段）
# ═══ REGISTRY-BASELINE（夹具：beta 为未登记存量）═══
tests/control-tower/beta.test.sh
# ═══ PATTERN-BASELINE（夹具：无存量登记）═══
# 格式：<路径>:<行号> | owner=<D#> | expires=YYYY-MM-DD | evidence=<引用>
EOB
# C 模式冻结格式（C1: `NAME | first_seen=…`，`|` 前有空格）
printf 'ci-unit | first_seen=2026-09-24 | owner=D-M9-test | expires=2099-12-31 | evidence=夹具\n' > "$SB/red-baseline.txt"

# ── D954 前置: PYBIN（禁裸 python3，变异体改写用）+ 对账对象锚 ──
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
# C 段对账对象: 夹具用 HEAD（恒可解析）；判定只取决于 JSON 内容与基线，与真仓库历史无关。
#   同时钉住 sha → 可对「对账对象 = <ref> @ <sha>」做**逐字**断言。
BASE_REF_FIX="HEAD"
BASE_SHA_FIX="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"
printf '{"check_runs":[{"name":"ci-unit","conclusion":"failure"},{"name":"ci-lint","conclusion":"success"}]}\n' > "$SB/red-ok.json"
LOG_DEF="$SB/logs/default.log"

# ── 正常: A+B 全绿 → exit 0 + 末行 OK ──
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-baseline.txt" "$LOG_DEF" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(last_line "$OUT")" = "GATE-INTEGRITY: OK" ]; then
  ok "正常: A+B 自洽 → exit 0 + 末行 GATE-INTEGRITY: OK"
else
  no "正常路径异常: rc=$rc 末行='$(last_line "$OUT")'"
fi
printf '%s\n' "$OUT" | grep -q "PATTERN-SENTINEL: 解析 2 个模式" \
  && ok "正常: 解析到 2 个模式（ERE 1 / BRE 1，方言分判生效）" \
  || no "模式统计异常（应为 解析 2 个模式）"
printf '%s\n' "$OUT" | grep -q "PATTERN-BASELINE: registered 0；STALE(0)" \
  && ok "正常: PATTERN-BASELINE 空段 → registered 0 / STALE(0)" \
  || no "PATTERN-BASELINE 空段统计异常"
printf '%s\n' "$OUT" | grep -q "CI-REGISTRY: 测试文件 2（密封面 sh/py 2；ts 面 0）" \
  && ok "正常: 密封面 2 文件 / 登记 1 / 未登记 1（[R] 段内）" \
  || no "登记统计异常"
printf '%s\n' "$OUT" | grep -q "CI-RED-CHECK: SKIPPED (no --ci-reds；CI job 提供)" \
  && ok "正常: 未给 --ci-reds → C 显式 SKIPPED（不参与判定）" \
  || no "C 未显式跳过"

# ── C1 回归: 冻结格式（`|` 前带空格）已登记红 → exit 0（旧实现此处误判"未登记"）──
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-baseline.txt" "$SB/logs/c1.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/red-ok.json" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q "CI-RED-CHECK: 失败检查 1 项；基线命中 1 项"; then
  ok "C1 回归: 冻结格式（NAME 后空格）→ 命中基线 → exit 0"
else
  no "C1 回归失败: rc=${rc}（空格格式被判未登记）"
fi

# ── 端到端复现: 自造 JSON 含两条已登记红（其一含中文/全角括号/点号）→ exit 0 ──
{
  printf '%s | first_seen=2026-09-24 | owner=D-M9-test | expires=2099-12-31 | evidence=夹具\n' "$NAME_CN"
  printf 'ci-unit | first_seen=2026-09-24 | owner=D-M9-test | expires=2099-12-31 | evidence=夹具\n'
} > "$SB/red-two.txt"
printf '{"check_runs":[{"name":"%s","conclusion":"failure"},{"name":"ci-unit","conclusion":"failure"},{"name":"ci-ok","conclusion":"success"}]}\n' "$NAME_CN" > "$SB/red-two.json"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-two.txt" "$SB/logs/c2e2e.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/red-two.json" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q "CI-RED-CHECK: 失败检查 2 项；基线命中 2 项"; then
  ok "端到端复现: 两条已登记红（含中文/全角括号/点号名）→ exit 0"
else
  no "端到端复现失败: rc=${rc}（应 2 项全命中）"
fi

# ── 向后兼容: 无空格旧格式 `NAME|first_seen=…|expires=…` → exit 0 ──
printf 'ci-unit|first_seen=2026-09-24|owner=D-M9-test|expires=2099-12-31|evidence=夹具\n' > "$SB/red-nospace.txt"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-nospace.txt" "$SB/logs/c3.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/red-ok.json" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "向后兼容: 无空格旧格式 → 命中基线 → exit 0" || no "无空格格式回归失败: rc=$rc"

# ── C2 回归: expires 已过期 → exit 1 且必须命中具体原因「CI 红基线过期」──
printf 'ci-old | first_seen=2026-01-01 | owner=D-M9-expired | expires=2020-01-01 | evidence=夹具\n' > "$SB/red-expired.txt"
printf '{"check_runs":[{"name":"ci-old","conclusion":"failure"}]}\n' > "$SB/red-old.json"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-expired.txt" "$SB/logs/c4.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/red-old.json" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q "VIOLATION: CI 红基线过期"; then
  ok "C2 回归: expires 过期 → exit 1 + 命中「CI 红基线过期」（按键取值生效）"
else
  no "C2 回归失败: rc=${rc}（过期未被触发 = fail-open）"
fi

# ── 降级: 条目缺 expires 键 → exit 2（malformed 不静默当 0）──
printf 'ci-unit | first_seen=2026-09-24 | owner=D-M9-test | evidence=夹具（缺 expires）\n' > "$SB/red-nokey.txt"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-nokey.txt" "$SB/logs/c5.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/red-ok.json" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q "degraded: CI 红基线条目缺 expires 键"; then
  ok "降级: 红基线条目缺 expires 键 → exit 2 + degraded（不静默当 0）"
else
  no "缺 expires 键未降级: rc=$rc"
fi

# ── 降级: ci.yml 缺失 → exit 2 + degraded + 日志 JSON 五字段 ──
LOG_D1="$SB/logs/d1.log"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/missing-ci.yml" "$SB/baseline.txt" "$SB/red-baseline.txt" "$LOG_D1" --registry-only 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q "degraded: CI 清单缺失" && [ "$(last_line "$OUT")" = "GATE-INTEGRITY: DEGRADED" ]; then
  ok "降级: ci.yml 缺失 → exit 2 + degraded + 末行 DEGRADED"
else
  no "降级(ci.yml 缺失)异常: rc=$rc"
fi
if [ -f "$LOG_D1" ] \
  && grep -q '"time":"' "$LOG_D1" && grep -q '"component":"check-gate-integrity"' "$LOG_D1" \
  && grep -q '"code":"B_CI_YML_MISSING"' "$LOG_D1" && grep -q '"phase":"registry"' "$LOG_D1" \
  && grep -q '"retryable":false' "$LOG_D1"; then
  ok "降级: 日志 JSON 五字段齐（time/component/code/phase/retryable）"
else
  no "降级日志 JSON 字段缺失: $(cat "$LOG_D1" 2>/dev/null)"   # swallow-ok: 仅失败诊断文本；读不到=空串，断言本身已判 FAIL（非放行）
fi

# ── 降级: 基线缺失 → exit 2 ──
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/missing-base.txt" "$SB/red-baseline.txt" "$SB/logs/d2.log" --registry-only 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q "degraded: ratchet 基线缺失"; then
  ok "降级: 基线文件缺失 → exit 2 + degraded"
else
  no "降级(基线缺失)异常: rc=$rc"
fi

# ── 降级: --ci-reds 指向非法 JSON → exit 2 ──
printf 'not-json{' > "$SB/bad.json"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-baseline.txt" "$SB/logs/d3.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/bad.json" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q "degraded: check-runs JSON 非法"; then
  ok "降级: 非法 check-runs JSON → exit 2 + degraded"
else
  no "降级(非法 JSON)异常: rc=$rc"
fi

# ── 边界: 模式隔离（--patterns-only 不因 registry 面缺失而降级）──
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/missing-ci.yml" "$SB/baseline.txt" "$SB/red-baseline.txt" "$SB/logs/e1.log" --patterns-only 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "边界: --patterns-only 不触发 registry 降级（模式隔离）" || no "模式隔离异常: rc=$rc"

# ── 边界: 解析到 0 个模式 → exit 2（CTO 明令保留）──
printf '#!/bin/bash\ntrue\n' > "$SB/scripts/empty.sh"
OUT="$(RUN "$SB/scripts/empty.sh" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-baseline.txt" "$SB/logs/e2.log" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q "degraded: 可校验 grep 模式数=0"; then
  ok "边界: 空扫描脚本（0 模式）→ exit 2 + degraded（fail-closed，不报绿）"
else
  no "0 模式边界异常: rc=$rc"
fi

# ── 边界: 基线过期（幽灵条目）→ exit 1 ──
printf '# 基线\ntests/control-tower/beta.test.sh\ntests/control-tower/ghost.test.sh\n' > "$SB/baseline-stale.txt"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline-stale.txt" "$SB/red-baseline.txt" "$SB/logs/e3.log" --registry-only 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q "VIOLATION: 基线过期，须删条目: tests/control-tower/ghost.test.sh"; then
  ok "边界: 基线幽灵条目 → exit 1（基线过期）"
else
  no "基线过期边界异常: rc=$rc"
fi

# ── 棘轮 R1: 真仓库 --patterns-only → exit 0（:991 已登记；STALE 语义随平台自适应）──
OUT="$(SYNO_GATE_DEGRADED_LOG="$SB/logs/real.log" bash "$GATE" --root "$REPO" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q "PATTERN-BASELINE: registered 1；STALE(0)"; then
  ok "棘轮: 真仓库 --patterns-only → exit 0（:991 在本平台违规且已登记，registered 1 / STALE 0）"
elif [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q "PATTERN-BASELINE: STALE("; then
  ok "棘轮: 真仓库 --patterns-only → exit 0 且 :991 记 STALE（= 本平台/GNU 已不再违规；STALE 不影响退出码，按新契约正确）"
else
  no "棘轮: 真仓库 --patterns-only 非预期: rc=$rc"
fi

# ── 棘轮: PATTERN 条目 expires 过期 → exit 1 ──
SCAN_M1="$SB/scripts/m1-scan.sh"
{
  printf '#!/bin/bash\n'
  printf 'echo a | grep -E %s\n' "'^alpha'"
  printf 'X=$(echo a | grep -Ev "%s")  # %s M1\n' "$BAD_RE" "$MARK"
} > "$SCAN_M1"
# ── 坐标自洽（#774 windows 红1 治本）──────────────────────────────────────────
#   夹具原先**自己拼**坐标 `$SCAN_M1:3` 写进基线；但检查器的匹配键是
#     key="${p_file#"$ROOT"/}:${p_line}"      （check-gate-integrity.sh:551）
#   路径形态或行号任一处与检查器自算的不同，条目就匹配不上 → 该条判 **STALE** 而非
#   "过期违规" → 断言在"消息不匹配"上红（windows 实测: rc=1 但 stale=STALE(gnu)）。
#   修法（方言无关、不猜形态）: 先用**空 [P] 段**基线跑一次，让检查器把非法模式坐标
#   **自己报出来**，再取它报的原文写回夹具基线 → 坐标必然自洽，不再依赖平台路径形态。
cat > "$SB/baseline-nopat.txt" <<'EOBNOPAT'
# 夹具基线（[P] 段故意留空 → 非法模式均为"未登记"，检查器会在 VIOLATION 行报出坐标）
# ═══ REGISTRY-BASELINE（夹具）═══
tests/control-tower/beta.test.sh
# ═══ PATTERN-BASELINE（夹具：空）═══
# 格式：<路径>:<行号> | owner=<D#> | expires=YYYY-MM-DD | evidence=<引用>
EOBNOPAT
OUT_C="$(RUN "$SCAN_M1" "$SB/tests" "$SB/ci.yml" "$SB/baseline-nopat.txt" "$SB/red-baseline.txt" "$SB/logs/coord.log" --patterns-only 2>&1)"
M1_COORD="$(printf '%s\n' "$OUT_C" | grep -oE '[^ 	]*m1-scan\.sh:[0-9]+' | head -1)"   # swallow-ok: 探测型摘取；取不到由下一行退路兜住并在载荷里可见
[ -n "$M1_COORD" ] || M1_COORD="$SCAN_M1:3"   # 退路: 取不到坐标则沿用旧形态（断言载荷会把它报出来）
cat > "$SB/baseline-pat-expired.txt" <<EOB
# 夹具基线
# ═══ REGISTRY-BASELINE（夹具）═══
tests/control-tower/beta.test.sh
# ═══ PATTERN-BASELINE（夹具：过期条目）═══
# 格式：<路径>:<行号> | owner=<D#> | expires=YYYY-MM-DD | evidence=<引用>
$M1_COORD | owner=fixture | expires=2020-01-01 | evidence=夹具-过期
EOB
OUT="$(RUN "$SCAN_M1" "$SB/tests" "$SB/ci.yml" "$SB/baseline-pat-expired.txt" "$SB/red-baseline.txt" "$SB/logs/r2.log" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q "VIOLATION: PATTERN 基线过期（须修或延期）"; then
  ok "棘轮: PATTERN 条目 expires 过期 → exit 1"
else
  no "PATTERN 过期未触发: rc=$rc [badre_rc=$BADRE_RC stale=$(d_stale) viol=$(d_viol) coord=$(d_coord)]"
fi

# ── 判别性 ① STALE 去平台陷阱: 修好副本（^\+\+\+ = GNU 下 :991 的等价合法形态）→ rc=0 + STALE(方言) ──
#    CI(C) 情形: GNU 上 :991 本来合法 → 坐标不再违规 → 旧实现误判"基线过期 exit 1"；新契约记 STALE 且不影响退出码。
#    夹具只改 ERE 那条（sed 限定 `grep -Ev` 行）——若整文件替换会把 :492 的 BRE 也改成 BSD 非法形态（假修复）。
sed '/grep -Ev/ s/\^+++/^\\+\\+\\+/' "$REPO/scripts/pre-commit-check.sh" > "$SB/scripts/fixed-precommit.sh"
FIXED_LINE="$(grep -n 'grep -Ev' "$SB/scripts/fixed-precommit.sh" | grep -F '^\\+\\+\\+' | head -1 | cut -d: -f1)"
printf 'test\n' | grep -Ev "$PROBE_RE" >/dev/null 2>&1   # 夹具独立跑同款行为探针（不读被测实现）
if [ $? -eq 2 ]; then EXPECT_DIALECT="bsd"; else EXPECT_DIALECT="gnu"; fi
cat > "$SB/baseline-fixed.txt" <<EOB
# 夹具基线
# ═══ REGISTRY-BASELINE（夹具）═══
tests/control-tower/beta.test.sh
# ═══ PATTERN-BASELINE（夹具：条目坐标在副本里已不再违规 = STALE）═══
# 格式：<路径>:<行号> | owner=<D#> | expires=YYYY-MM-DD | evidence=<引用>
$SB/scripts/fixed-precommit.sh:$FIXED_LINE | owner=fixture | expires=2099-12-31 | evidence=夹具-修好副本（STALE）
EOB
OUT="$(RUN "$SB/scripts/fixed-precommit.sh" "$SB/tests" "$SB/ci.yml" "$SB/baseline-fixed.txt" "$SB/red-baseline.txt" "$SB/logs/r3.log" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q "PATTERN-BASELINE: STALE(${EXPECT_DIALECT})" \
  && printf '%s\n' "$OUT" | grep -q "PATTERN-BASELINE: registered 0；STALE(1)" \
  && ! printf '%s\n' "$OUT" | grep -q "VIOLATION"; then
  ok "① STALE: 修好副本 → rc=0 + STALE(${EXPECT_DIALECT}) + registered 0/STALE 1（不再是 exit 1）"
else
  no "① STALE 断言失败: rc=${rc}（期望 rc=0 + STALE(${EXPECT_DIALECT})，实际见下）"
fi

# ── 判别性 ③ 反"拔牙": STALE 且 expires 已过 → 仍须 exit 1 ──
cat > "$SB/baseline-stale-expired.txt" <<EOB
# 夹具基线
# ═══ REGISTRY-BASELINE（夹具）═══
tests/control-tower/beta.test.sh
# ═══ PATTERN-BASELINE（夹具：STALE + 过期）═══
# 格式：<路径>:<行号> | owner=<D#> | expires=YYYY-MM-DD | evidence=<引用>
$SCAN_OK:2 | owner=fixture | expires=2020-01-01 | evidence=夹具-STALE且过期
EOB
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline-stale-expired.txt" "$SB/red-baseline.txt" "$SB/logs/r4.log" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q "VIOLATION: PATTERN 基线过期（须修或延期；条目本平台已 STALE(" ; then
  ok "③ 反拔牙: STALE 且 expires 已过 → exit 1（放宽 STALE 未连带跳过 expires 硬门）"
else
  no "③ 反拔牙断言失败: rc=${rc}（STALE 把 expires 一起放行了 = fail-open）"
fi

# ── 判别性 ⑩ STALE 与 registered 同时存在 → 计数各自准确，退出码不受 STALE 影响 ──
cat > "$SB/baseline-mixed.txt" <<EOB
# 夹具基线
# ═══ REGISTRY-BASELINE（夹具）═══
tests/control-tower/beta.test.sh
# ═══ PATTERN-BASELINE（夹具：1 条命中违规 + 1 条 STALE）═══
# 格式：<路径>:<行号> | owner=<D#> | expires=YYYY-MM-DD | evidence=<引用>
$M1_COORD | owner=fixture | expires=2099-12-31 | evidence=夹具-registered
$SCAN_OK:2 | owner=fixture | expires=2099-12-31 | evidence=夹具-STALE
EOB
OUT="$(RUN "$SCAN_M1" "$SB/tests" "$SB/ci.yml" "$SB/baseline-mixed.txt" "$SB/red-baseline.txt" "$SB/logs/r5.log" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q "PATTERN-BASELINE: registered 1；STALE(1)"; then
  ok "⑩ 混合: registered 1 + STALE 1 → rc=0（计数准确且 STALE 不入违规）"
else
  no "⑩ 混合计数断言失败: rc=$rc [badre_rc=$BADRE_RC $(d_counts) coord=$(d_coord)]"
fi

# ── 分段隔离 A: [R] 段里的 key 不给 [P] 面生效（新非法模式仍必红）──
cat > "$SB/baseline-cross.txt" <<EOB
# 夹具基线
# ═══ REGISTRY-BASELINE（夹具：把 M1 的 key 错放在 [R] 段）═══
tests/control-tower/beta.test.sh
$M1_COORD
# ═══ PATTERN-BASELINE（夹具：空）═══
# 格式：<路径>:<行号> | owner=<D#> | expires=YYYY-MM-DD | evidence=<引用>
EOB
OUT="$(RUN "$SCAN_M1" "$SB/tests" "$SB/ci.yml" "$SB/baseline-cross.txt" "$SB/red-baseline.txt" "$SB/logs/r4.log" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q "VIOLATION: 非法 ERE 模式"; then
  ok "分段隔离: [R] 段条目不给 A 模式豁免 → 新非法模式仍必红（exit 1）"
else
  no "分段隔离 A 失败: rc=${rc} [badre_rc=$BADRE_RC viol=$(d_viol) stale=$(d_stale)]"
fi

# ── 分段隔离 B: [P] 段条目不给 registry 面生效（registry 仍按 [R] 判 → exit 0）──
cat > "$SB/baseline-both.txt" <<EOB
# 夹具基线
# ═══ REGISTRY-BASELINE（夹具：beta 存量）═══
tests/control-tower/beta.test.sh
# ═══ PATTERN-BASELINE（夹具：M1 的 key 正确放在 [P] 段）═══
# 格式：<路径>:<行号> | owner=<D#> | expires=YYYY-MM-DD | evidence=<引用>
$M1_COORD | owner=fixture | expires=2099-12-31 | evidence=夹具-M1
EOB
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline-both.txt" "$SB/red-baseline.txt" "$SB/logs/r5.log" --registry-only 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "分段隔离: [P] 段条目不进 registry 面 → exit 0（无跨段串行）" || no "分段隔离 B 失败: rc=$rc"
OUT="$(RUN "$SCAN_M1" "$SB/tests" "$SB/ci.yml" "$SB/baseline-both.txt" "$SB/red-baseline.txt" "$SB/logs/r6.log" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q "PATTERN-BASELINE: registered 1；STALE(0)"; then
  ok "分段隔离: [P] 段条目正确豁免既有非法模式 → exit 0（registered 1 / STALE 0）"
else
  no "分段隔离([P] 豁免)失败: rc=$rc [badre_rc=$BADRE_RC $(d_counts) coord=$(d_coord)]"
fi

# ── 判别性 M1: 未登记的新非法 ERE（临时脚本）→ 必红 + 点名 file:line ──
OUT="$(RUN "$SCAN_M1" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-baseline.txt" "$SB/logs/m1.log" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q "VIOLATION: 非法 ERE 模式" \
  && printf '%s\n' "$OUT" | grep -q -F "$M1_COORD" && printf '%s\n' "$OUT" | grep -q -F "$BAD_RE"; then
  ok "M1: 新注入非法 ERE（未登记）→ exit 1 + 点名检查器自报坐标 + 模式原文"
else
  no "M1 判别性失败: rc=${rc} [badre_rc=$BADRE_RC viol=$(d_viol) pts=$(d_pt)]"
fi

# ── 判别性 M4: 哨兵核心置 return 0 → M1 场景必须不再红（证明夹具依赖真哨兵）──
MUT="$TMPD/mutated-gate.sh"
sed 's|^  _sentinel_grep .*M9-SENTINEL-CORE.*$|  _rc=0|' "$GATE" > "$MUT"
if cmp -s "$GATE" "$MUT"; then
  no "M4 变异未生效（sed 未命中 M9-SENTINEL-CORE 标记行）"
else
  ok "M4: 变异体已生成（哨兵核心行被替换）"
fi
OUT="$(SYNO_GATE_SCAN_SCRIPTS="$SCAN_M1" SYNO_TESTS_DIR="$SB/tests" SYNO_CI_YML="$SB/ci.yml" \
  SYNO_GATE_BASELINE="$SB/baseline.txt" SYNO_CI_RED_BASELINE="$SB/red-baseline.txt" \
  SYNO_GATE_DEGRADED_LOG="$SB/logs/m4.log" bash "$MUT" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && ! printf '%s\n' "$OUT" | grep -q "VIOLATION"; then
  ok "M4: 变异体下 M1 场景不再红（exit 0）→ 夹具依赖真哨兵，判别性成立"
else
  no "M4 判别性失败: rc=${rc}（哨兵失效后 M1 仍报红 = M1 未依赖哨兵）"
fi

# ── 判别性 M5: 伪造 check-runs JSON 多加一条未登记 failure → 必红 ──
printf '{"check_runs":[{"name":"ci-unit","conclusion":"failure"},{"name":"ci-rogue","conclusion":"failure"}]}\n' > "$SB/red-rogue.json"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-baseline.txt" "$SB/logs/m5.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/red-rogue.json" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q "VIOLATION: 未登记 CI 失败: ci-rogue"; then
  ok "M5: 未登记 failure → exit 1（点名 ci-rogue）"
else
  no "M5 判别性失败: rc=$rc"
fi

# ── 判别性 M2: 从基线删 1 条仍存在的未登记项 → 必红 ──
printf '# 基线\n' > "$SB/baseline-m2.txt"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline-m2.txt" "$SB/red-baseline.txt" "$SB/logs/m2.log" --registry-only 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q "VIOLATION: 新增测试未登记 CI 密封清单: tests/control-tower/beta.test.sh"; then
  ok "M2: 基线删条 → exit 1（原基线内未登记项被点名为新增）"
else
  no "M2 判别性失败: rc=$rc"
fi

# ── 回归 M6: 相邻引号段拼接模式不得被截断成假违规（真实形态，逐字节复刻 dev-doc-gatekeeper.sh:109）──
cat > "$SB/scripts/m6-scan.sh" <<'EOM'
#!/bin/bash
echo a | grep -E '^alpha'
grep -oE '(^|[^a-zA-Z0-9_])(src|packages)/[^][:space:])\"'\'',;]+' "$1"
EOM
OUT="$(RUN "$SB/scripts/m6-scan.sh" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/red-baseline.txt" "$SB/logs/m6.log" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -q "GATE-INTEGRITY: OK"; then
  ok "M6: 引号段拼接模式整体拼接后验证 → 不误报（回归守住 dev-doc-gatekeeper.sh:109 形态）"
else
  no "M6 回归失败（拼接模式被截断成假违规）: rc=$rc"
fi

# ── 判别性 ④a step summary 注入缝: GITHUB_STEP_SUMMARY=<tmpfile> → 摘要含关键行 ──
SUM_OK="$SB/logs/summary-ok.md"
OUT="$(SYNO_GATE_SCAN_SCRIPTS="$SCAN_OK" SYNO_TESTS_DIR="$SB/tests" SYNO_CI_YML="$SB/ci.yml" \
  SYNO_GATE_BASELINE="$SB/baseline.txt" SYNO_CI_RED_BASELINE="$SB/red-baseline.txt" \
  SYNO_GATE_DEGRADED_LOG="$SB/logs/s4a.log" GITHUB_STEP_SUMMARY="$SUM_OK" \
  bash "$GATE" --root "$REPO" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -f "$SUM_OK" ] \
  && grep -q '^## Gate Integrity$' "$SUM_OK" \
  && grep -q 'PATTERN-BASELINE: registered=' "$SUM_OK" \
  && grep -q 'GATE-INTEGRITY: ' "$SUM_OK"; then
  ok "④a step summary: GITHUB_STEP_SUMMARY 已写（## Gate Integrity + registered= + GATE-INTEGRITY:）"
else
  no "④a step summary 未落地: rc=$rc file=$([ -f "$SUM_OK" ] && echo yes || echo no)"
fi

# ── 判别性 ④b step summary 不可写 → 显式 degrade（不得静默）──
SUM_RO="$SB/logs/summary-readonly.md"
printf 'x\n' > "$SUM_RO"; chmod 444 "$SUM_RO"
OUT="$(SYNO_GATE_SCAN_SCRIPTS="$SCAN_OK" SYNO_TESTS_DIR="$SB/tests" SYNO_CI_YML="$SB/ci.yml" \
  SYNO_GATE_BASELINE="$SB/baseline.txt" SYNO_CI_RED_BASELINE="$SB/red-baseline.txt" \
  SYNO_GATE_DEGRADED_LOG="$SB/logs/s4b.log" GITHUB_STEP_SUMMARY="$SUM_RO" \
  bash "$GATE" --root "$REPO" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q "degraded: GITHUB_STEP_SUMMARY 存在但不可写"; then
  ok "④b step summary 不可写 → exit 2 + 显式 degraded（不静默跳过）"
else
  no "④b 不可写摘要未显式降级: rc=$rc"
fi
chmod 644 "$SUM_RO" 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════════
# D954（2026-09-25）: C 段「对账对象」锚 + base JSON 判别靶 + disposition_due + --root 护栏
#   K3 定罪: C 段取**当前提交**的 check-runs → 同 SHA 多数 job 仍 in_progress（conclusion≠failure）
#   → `失败检查 0 项` → **棘轮从未被行使**（同 SHA 终局实有 3 个 failure）。本节断言修复后的口径。
# ═══════════════════════════════════════════════════════════════════════════════

# ── D1（正常 + 身份锚）: 已登记红命中基线 → rc=0，且必打印「对账对象 = HEAD @ <sha>」──
#   判红口径(③): 仅 conclusion==failure 计入 —— 构造里另放 skipped/cancelled 各一，计数须仍为 1。
printf '{"check_runs":[{"name":"Vitest (2/2)","conclusion":"failure"},{"name":"Checker Review","conclusion":"skipped"},{"name":"Vitest (1/2)","conclusion":"cancelled"},{"name":"Golden Case F1 Gate","conclusion":null}]}\n' > "$SB/d954-reg.json"
printf 'Vitest (2/2) | first_seen=2026-09-24 | owner=UNASSIGNED | expires=2099-12-31 | evidence=夹具已登记红\n' > "$SB/d954-red.txt"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/d954-red.txt" "$SB/logs/d954-1.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/d954-reg.json" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -qF "对账对象 = ${BASE_REF_FIX} @ ${BASE_SHA_FIX}" \
   && printf '%s\n' "$OUT" | grep -q "CI-RED-CHECK: 失败检查 1 项；基线命中 1 项"; then
  ok "D1: 已登记红命中基线 → rc=0 + 对账对象行（ref @ sha 逐字）+ 失败 1/命中 1（不再恒 0）"
else
  no "D1 异常: rc=${rc}（对账对象行或计数不符）"
fi
printf '%s\n' "$OUT" | grep -q "CI-RED-CHECK: 失败检查 1 项" \
  && ok "D1: 判红口径 = 仅 conclusion==failure（skipped/cancelled/null 均不计）" \
  || no "D1: 非 failure 态被误计"
printf '%s\n' "$OUT" | grep -q "未登记 CI 失败" \
  && no "D1: 已登记项被误报为未登记（假红）" \
  || ok "D1: 已登记项未被误报为未登记（无误报）"

# ── M1（K3 判别靶）: base JSON「有红且未登记」→ **必红**（空转修复的核心判别点）──
printf '{"check_runs":[{"name":"Vitest (2/2)","conclusion":"failure"},{"name":"brand-new-red (x/y)","conclusion":"failure"}]}\n' > "$SB/d954-rogue.json"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/d954-red.txt" "$SB/logs/d954-m1.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/d954-rogue.json" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -qF "VIOLATION: 未登记 CI 失败: brand-new-red (x/y)" \
   && printf '%s\n' "$OUT" | grep -qF "对账对象 = ${BASE_REF_FIX} @ ${BASE_SHA_FIX}"; then
  ok "M1: base 有红且未登记 → exit 1 + 点名未登记项（棘轮真被行使）"
else
  no "M1 判别靶失败: rc=${rc}（base 有未登记红却未判红 = 空转复发）"
fi
# M1 负控: 同一 JSON，该红登记后 → 不判红（防"一律判红"的错修法）
printf 'brand-new-red (x/y) | first_seen=2026-09-24 | owner=UNASSIGNED | expires=2099-12-31 | evidence=夹具\n' >> "$SB/d954-red.txt"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/d954-red.txt" "$SB/logs/d954-m1n.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/d954-rogue.json" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "M1 负控: 该红登记后 → rc=0（不得一律判红）" || no "M1 负控失败: rc=$rc"

# ── M2: --base-ref 不可解析 → exit 2 + degraded（绝不判绿）──
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/d954-red.txt" "$SB/logs/d954-m2.log" --base-ref refs/heads/definitely-not-a-ref-954 --ci-reds "$SB/d954-reg.json" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$OUT" | grep -q "degraded: base-ref 不可解析" && [ "$(last_line "$OUT")" = "GATE-INTEGRITY: DEGRADED" ]; then
  ok "M2: --base-ref 不可解析 → exit 2 + degraded + 末行 DEGRADED（fail-closed）"
else
  no "M2 异常: rc=$rc"
fi
if [ -f "$SB/logs/d954-m2.log" ] && grep -q '"code":"C_BASE_REF_UNRESOLVED"' "$SB/logs/d954-m2.log" \
   && grep -q '"phase":"ci-reds"' "$SB/logs/d954-m2.log" && grep -q '"retryable":false' "$SB/logs/d954-m2.log"; then
  ok "M2: 降级日志五字段齐（code=C_BASE_REF_UNRESOLVED / phase=ci-reds）"
else
  no "M2 降级日志字段缺失"
fi
# M2b: JSON 缺 check_runs → exit 2（"无 check-runs" ≠ "无红"）
printf '{"total_count":0}\n' > "$SB/d954-noruns.json"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/d954-red.txt" "$SB/logs/d954-m2b.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/d954-noruns.json" 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && ok "M2b: JSON 缺 check_runs → exit 2（不判绿）" || no "M2b 异常: rc=$rc"

# ── M4: disposition_due 逾期 → 必红（新增判据的变异体）──
printf 'Vitest (2/2) | first_seen=2026-09-24 | owner=UNASSIGNED | expires=2099-12-31 | disposition_due=2020-01-01 | evidence=夹具逾期\n' > "$SB/d954-due.txt"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/d954-due.txt" "$SB/logs/d954-m4.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/d954-reg.json" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s\n' "$OUT" | grep -q "VIOLATION: CI 红处置逾期" \
   && printf '%s\n' "$OUT" | grep -q "处置逾期 1 项"; then
  ok "M4: disposition_due 逾期 → exit 1 + 点名「CI 红处置逾期」（与 expires 同级硬门）"
else
  no "M4 异常: rc=${rc}（disposition_due 逾期未判红）"
fi
printf 'Vitest (2/2) | first_seen=2026-09-24 | owner=UNASSIGNED | expires=2099-12-31 | disposition_due=2099-12-31 | evidence=夹具未到期\n' > "$SB/d954-due-ok.txt"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/d954-due-ok.txt" "$SB/logs/d954-m4n1.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/d954-reg.json" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "M4 负控1: disposition_due 未到期 → rc=0（不误判）" || no "M4 负控1 失败: rc=$rc"
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/d954-red.txt" "$SB/logs/d954-m4n2.log" --base-ref "$BASE_REF_FIX" --ci-reds "$SB/d954-reg.json" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "M4 负控2: 无 disposition_due 键 → 不判（存量条目不回溯，向后兼容）" || no "M4 负控2 失败: rc=$rc"

# ── SKIP: 缺 --base-ref → 显式 SKIPPED，不伪造判定（有未登记红也不判/不放行）──
OUT="$(RUN "$SCAN_OK" "$SB/tests" "$SB/ci.yml" "$SB/baseline.txt" "$SB/d954-red.txt" "$SB/logs/d954-skip.log" --ci-reds "$SB/d954-rogue.json" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -qF "SKIPPED (--ci-reds 已给但缺 --base-ref" \
   && ! printf '%s\n' "$OUT" | grep -q "VIOLATION: 未登记 CI 失败"; then
  ok "SKIP: 缺 --base-ref → 显式 SKIPPED 且不伪造判定（可见，不静默放行）"
else
  no "SKIP 异常: rc=$rc"
fi

# ── M3（判别性自证）: 删「对账对象」打印行 → 变异体不再输出该行（夹具断言具备判别性）──
# M9-P1 返修(#741 K3 实证): 旧实现两缺陷叠加 = 空跑假绿——
#   ① 锚用子串「对账对象 = 」：门禁脚本里该子串出现 3 次（2 处注释 + 1 处真打印行）→
#      `assert len(src)-1` 必炸（Traceback），变异体根本没生成；
#   ② PYBIN 的 rc/产物完全没查 → `bash <缺失文件>` 的报错被 `|| true` 吞 →
#      输出里自然没有「对账对象」→ 反向断言空跑判 ✅（K3: Traceback 与 ✅ 同屏实锤）。
# 修法: ① 锚精确到唯一真打印行（含 'info "对账对象 = ' 的行——注释行不含此串）；
#       ② 施加硬校验: rc≠0 / 产物缺失或为空 / 与原文件逐字节相同 → MUTATION_NOT_APPLIED 响亮红。
if [ -n "$PYBIN" ] && [ -n "$BASE_SHA_FIX" ]; then
  MUT_G="$TMPD/gate-no-account-line.sh"
  rm -f "$MUT_G"
  M3_PY_RC=0
  "$PYBIN" - "$GATE" "$MUT_G" <<'PYD954' || M3_PY_RC=$?
import io
import sys

src = io.open(sys.argv[1], encoding="utf-8").read().splitlines(True)
anchor = 'info "对账对象 = '
out = [ln for ln in src if anchor not in ln]
assert len(out) == len(src) - 1, "变异失败：真打印行（%s）未恰好命中 1 行（实际 %d 行）" % (
    anchor, len(src) - len(out))
io.open(sys.argv[2], "w", encoding="utf-8").write("".join(out))
PYD954
  if [ "$M3_PY_RC" -ne 0 ]; then
    no "M3: MUTATION_NOT_APPLIED（变异器 rc=${M3_PY_RC}: 锚未命中/多命中——判别性自证无效，禁止空跑判绿）"
  elif [ ! -s "$MUT_G" ]; then
    no "M3: MUTATION_NOT_APPLIED（变异产物缺失或为空——变异器静默失败，禁止空跑判绿）"
  elif cmp -s "$GATE" "$MUT_G"; then
    no "M3: MUTATION_NOT_APPLIED（变异产物与原文件逐字节相同——变异未施加，禁止空跑判绿）"
  else
    OUT_M="$(bash "$MUT_G" --root "$REPO" --patterns-only --base-ref "$BASE_REF_FIX" --ci-reds "$SB/d954-rogue.json" 2>&1 || true)"
    if printf '%s\n' "$OUT_M" | grep -qF "对账对象 = "; then
      no "M3: 删行变异体仍输出该行（变异无效）"
    else
      ok "M3: 删「对账对象」打印行（真施加，cmp 验异）→ 变异体无该行 ⇒ D1 断言有判别性（非空壳）"
    fi
  fi
else
  no "M3: PYBIN 或对账对象 sha 不可用，无法构造变异体"
fi

# ── 接线（铁律 0-2）: ci.yml 必须传 --base-ref 且 REF 取 base（防生产退回空转）──
CIY="$REPO/.github/workflows/ci.yml"
grep -q -- "--base-ref" "$CIY" \
  && ok "接线: ci.yml 已传 --base-ref（对账对象由生产侧给定）" \
  || no "接线缺失: ci.yml 未传 --base-ref → 生产侧 C 段将 SKIPPED（棘轮空转）"
grep -qF "pull_request.base.sha" "$CIY" \
  && ok "接线: ci.yml REF 取 PR base.sha（不再取当前提交）" \
  || no "接线缺失: ci.yml 未取 pull_request.base.sha"
grep -qF "pull_request.head.sha" "$CIY" \
  && no "接线回退: ci.yml 仍用 pull_request.head.sha（K3 定罪的空转取数形态）" \
  || ok "接线: 无 head.sha"

# ⚠️ 可见性预算（#768 红2 / #774 红1）: 本文件末尾 6 条 ✅ 文案受 ci.yml:278
#   `tail -8 | tr '\n' '|' | cut -c1-450` 约束——超 450B 则**含 FIRST_FAIL 的结果行被挤出注解**，
#   CI 上只见 ❌ 名不到（实测：原长 530B 被截）。#774 为给断言载荷腾预算，这 6 条已二次压缩。
#   实测 tail-8 合并 = **200B**（全绿）/ **372B**（最坏 = 载荷最长那条，含 `coord=<检查器自报坐标>`）。
#   **改这些话务必保持合计 < 450B**，否则可见性回退（建议后续卡加"预算自检"断言，非本卡范围）。
# ── J6a/J6b/J6c: --root 护栏（ROOT 随 cwd 漂移 → 会读错树的基线）──
OUT="$(bash "$GATE" --root "$REPO" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -qF "root=$REPO"; then
  ok "J6a: --root 定根"
else
  no "J6a 异常: rc=$rc"
fi
mkdir -p "$TMPD/non-git"
OUT="$(cd "$TMPD/non-git" && bash "$GATE" --root "$REPO" --patterns-only 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$OUT" | grep -qF "root=$REPO"; then
  ok "J6b: 非 git 定根"
else
  no "J6b 异常: rc=$rc"
fi
OTHER="$TMPD/other-repo"
mkdir -p "$OTHER"
if git -C "$OTHER" init -q 2>/dev/null; then
  OUT_NO="$(cd "$OTHER" && bash "$GATE" --registry-only 2>&1 || true)"
  OUT_YES="$(cd "$OTHER" && bash "$GATE" --registry-only --root "$REPO" 2>&1 || true)"
  if printf '%s\n' "$OUT_YES" | grep -qF "root=$REPO" && ! printf '%s\n' "$OUT_NO" | grep -qF "root=$REPO"; then
    ok "J6c: --root 判别"
  else
    no "J6c: --root 未改变定根结果（护栏可能失效）"
  fi
else
  no "J6c: git init 不可用，无法构造漂移场景"
fi

# ── 收尾: 红证不残留（仓库内零命中）──
HITS="$(grep -rl -- "$MARK" "$REPO/scripts" "$REPO/tests" 2>/dev/null | wc -l | tr -d ' ')"   # swallow-ok: 探测型 grep（红证残留检查）；无命中=期望结果 0，grep rc=1 不是错误
[ "$HITS" = "0" ] && ok "红证不残留 scripts+tests:0" \
  || no "红证残留: scripts/ + tests/ 内命中 ${HITS} 个文件"
TMP_HITS="$(grep -rl -- "$MARK" "$TMPD" 2>/dev/null | wc -l | tr -d ' ')"   # swallow-ok: 探测型 grep（/tmp 副本存在性）；无命中即判 FAIL，非放行
[ "$TMP_HITS" -ge 1 ] && ok "红证只在 /tmp: ${TMP_HITS}" || no "红证样本未落在 /tmp 副本"

echo ""
if [ "$FAIL" -gt 0 ] && [ -z "$FIRST_FAIL" ]; then
  echo "  ❌ SELF-CHECK: FAIL=$FAIL 但 FIRST_FAIL 为空（no() 记名机制缺陷）"
  exit 2
fi
echo "=== 结果: PASS=${PASS} FAIL=${FAIL}${FIRST_FAIL:+ FIRST_FAIL=${FIRST_FAIL}} ==="
[ "$FAIL" -eq 0 ] || exit 1
exit 0
