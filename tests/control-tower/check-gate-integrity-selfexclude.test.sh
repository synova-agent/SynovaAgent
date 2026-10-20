#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-gate-integrity-selfexclude.test.sh — #662 自指死锁修复（裁 223）
#
# 根因: 检查器把「自己的红」算成「未登记 CI 失败」⇒ 判自己违规 ⇒ 红一次永远红。
# 修法: --exclude-check <name>（可重复）→ 对账时排除；非自身未登记红仍必红。
#
# 覆盖（六判据 + 四反例）:
#   正  自身红 ＋ --exclude-check 自身 ⇒ exit 0 / GATE-INTEGRITY: OK
#   反1 去掉 --exclude-check ⇒ exit 1（复现原 bug）
#   反2 排除名写成不存在串 ⇒ exit 1（精确匹配，非瞎排除）
#   反3 非自身未登记红 ＋ 排除自身 ⇒ exit 1（安全阀：纪律未被一起排除）
#   反4 ci.yml 的 job name 与 --exclude-check 传参**逐字相等**（改名忘改排除 ⇒ 本断言必红）
#   重  可重复: 两个 --exclude-check 同时生效
#
# 隔离: mktemp 沙箱（脚本/测试/ci.yml/基线全部注入）；--root 指真实仓（git 解析 base-ref）。
# 用法: bash tests/control-tower/check-gate-integrity-selfexclude.test.sh → 0 = 全过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
GATE="$REPO/scripts/control-tower/check-gate-integrity.sh"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL+1)); echo "  ❌ $1" >&2; }
SB=$(mktemp -d /tmp/gi662.XXXXXX)
trap 'rm -rf "$SB"' EXIT
BASE_REF_FIX="$(git -C "$REPO" rev-parse HEAD)"
SELF_NAME="Gate Integrity (pattern sentinel + injection fixture + ci-reds)"
OTHER_NAME="Golden Case F1 Gate"

RUN() { # 其后 = 检查器参数
  SYNO_GATE_SCAN_SCRIPTS="$SB/scripts/scan.sh" \
  SYNO_TESTS_DIR="$SB/tests" \
  SYNO_CI_YML="$SB/ci.yml" \
  SYNO_GATE_BASELINE="$SB/baseline.txt" \
  SYNO_CI_RED_BASELINE="$SB/red-baseline.txt" \
  SYNO_GATE_DEGRADED_LOG="$SB/logs/d.log" \
  bash "$GATE" --root "$REPO" --base-ref "$BASE_REF_FIX" "$@"
}

# ── 沙箱（hermetic）──────────────────────────────────────────────────────────
mkdir -p "$SB/scripts" "$SB/tests/control-tower" "$SB/logs"
cat > "$SB/scripts/scan.sh" <<'EOS'
#!/bin/bash
echo a | grep -E '^alpha'
grep -v '^+++' "$1"
EOS
printf '#!/bin/bash\n' > "$SB/tests/control-tower/alpha.test.sh"
cat > "$SB/ci.yml" <<'EOY'
name: ci
jobs:
  control-tower-tests:
    name: Control Tower Gate Tests (ubuntu-latest)
    steps:
      - run: |
          for t in \
            tests/control-tower/alpha.test.sh; do
            bash "$t"
          done
  gate-integrity:
    name: Gate Integrity (pattern sentinel + injection fixture + ci-reds)
    steps:
      - run: 'true'
  golden-case:
    name: Golden Case F1 Gate
    steps:
      - run: 'true'
  all-checks-passed:
    name: all checks passed
    needs: [control-tower-tests, gate-integrity, golden-case]
    steps:
      - run: 'true'
EOY
cat > "$SB/baseline.txt" <<'EOB'
# 夹具基线（双段）
# ═══ REGISTRY-BASELINE（夹具：无存量）═══
# ═══ PATTERN-BASELINE（夹具：无存量）═══
EOB
: > "$SB/red-baseline.txt"
printf '{"check_runs":[{"name":"%s","conclusion":"failure"},{"name":"Control Tower Gate Tests (ubuntu-latest)","conclusion":"success"}]}\n' "$SELF_NAME" > "$SB/self.json"
printf '{"check_runs":[{"name":"%s","conclusion":"failure"},{"name":"%s","conclusion":"failure"}]}\n' "$SELF_NAME" "$OTHER_NAME" > "$SB/self-other.json"

echo "=== #662 Gate Integrity 自指排除 ==="

# 正：排除自身 ⇒ exit 0
OUT="$(RUN --ci-reds "$SB/self.json" --exclude-check "$SELF_NAME" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "正: 自身红＋排除自身 ⇒ 0" || no "正: 期望 0，实际 ${rc}"
printf '%s' "$OUT" | grep -q 'GATE-INTEGRITY: OK' && ok "正: 末行 OK" || no "正: 末行非 OK"
printf '%s' "$OUT" | grep -q 'CI-RED-EXCLUDE: 对账时排除 1 个检查' && ok "正: 排除可见（CI-RED-EXCLUDE）" || no "正: 排除不可见"

# 反1：不加排除 ⇒ exit 1（复现原 bug）
OUT="$(RUN --ci-reds "$SB/self.json" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "反1: 不排除 ⇒ 1（复现原 bug）" || no "反1: 期望 1，实际 ${rc}"
printf '%s' "$OUT" | grep -q "VIOLATION: 未登记 CI 失败: ${SELF_NAME}" && ok "反1: 点名自身" || no "反1: 未点名自身"

# 反2：排除名不存在 ⇒ exit 1（精确匹配）
OUT="$(RUN --ci-reds "$SB/self.json" --exclude-check "No Such Check" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "反2: 排除名不存在 ⇒ 1（精确匹配）" || no "反2: 期望 1，实际 ${rc}"

# 反3：非自身未登记红 ＋ 排除自身 ⇒ exit 1（安全阀）
OUT="$(RUN --ci-reds "$SB/self-other.json" --exclude-check "$SELF_NAME" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "反3: 非自身未登记红仍红 ⇒ 1（安全阀）" || no "反3: 期望 1，实际 ${rc}"
printf '%s' "$OUT" | grep -q "VIOLATION: 未登记 CI 失败: ${OTHER_NAME}" && ok "反3: 点名的是别家的红" || no "反3: 未点名别家红"

# 重：可重复（两个排除同时生效）
OUT="$(RUN --ci-reds "$SB/self-other.json" --exclude-check "$SELF_NAME" --exclude-check "$OTHER_NAME" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "重: 两个 --exclude-check 同时生效 ⇒ 0" || no "重: 期望 0，实际 ${rc}"

# 反4：ci.yml job name 与传参逐字相等（真实仓）
CI="$REPO/.github/workflows/ci.yml"
NAME_LINE="$(grep -m1 -E '^    name: Gate Integrity \(' "$CI" | sed -E 's/^    name:[[:space:]]*//')"
FLAG_LINE="$(grep -m1 -oE -- '--exclude-check "[^"]+"' "$CI" | sed -E 's/^--exclude-check "//; s/"$//')"
[ -n "$NAME_LINE" ] && [ -n "$FLAG_LINE" ] && ok "反4a: 两处均解析到（name / --exclude-check）" || no "反4a: 解析失败（name=[${NAME_LINE}] flag=[${FLAG_LINE}]）"
[ "$NAME_LINE" = "$FLAG_LINE" ] && ok "反4b: ci.yml job name == --exclude-check 传参（逐字）" || no "反4b: 不一致（name=[${NAME_LINE}] flag=[${FLAG_LINE}]）⇒ 改名忘改排除必红"
# 变异：把副本里的 job name 改名 ⇒ 同一断言必须检出不等（证明反4b 有判别力）
MUT="$SB/ci-mut.yml"
sed 's/^    name: Gate Integrity (pattern sentinel + injection fixture + ci-reds)$/    name: Gate Integrity RENAMED/' "$CI" > "$MUT"
MUT_NAME="$(grep -m1 -E '^    name: Gate Integrity ' "$MUT" | sed -E 's/^    name:[[:space:]]*//')"
[ "$MUT_NAME" != "$FLAG_LINE" ] && ok "反4c: 改名变异能被检出（判别力）" || no "反4c: 改名变异未检出"

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
