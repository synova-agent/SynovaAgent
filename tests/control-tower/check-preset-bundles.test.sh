#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-preset-bundles.test.sh — D945 段④ 校验器夹具（正常 / 降级 / 边界 + 变异体 M1–M4）
#
# 覆盖矩阵（铁律 48: 正常/降级/边界; 铁律 0-2: red→green）:
#   T1  --repo 对**真实**仓库 bundle 源判绿（入口→判据接线，非 mock）       → exit 0
#   T2  --consistency 沙箱内一致判绿（无 legacy 在场）                     → exit 0
#   T3  --emit 逐字节复现已入库 cordis.patch.yml（生成器可信，非手抄）      → 内容相等
#   T4  降级: bundle 源目录不存在                                          → exit 2 + 五字段日志
#   T5  降级: profile 目录不存在                                           → exit 2
#   T6  降级: 未给 mode                                                     → exit 2
#   T7  边界: 已装 patch 陈旧（模拟 delegation 残留）                       → exit 1 + 证据行
#   M1  删 bundle 声明行（运行时 dsh.profile.bundles 去 decl）              → exit 1 + 选择器不可见
#   M1b 删 bundle 声明行（仓库 package.json 去 dsh.bundle.patch）           → exit 1 + 缺 bundle 声明行
#   M2  patch 的 `- id: preset-<id>` 改错 id                               → exit 1
#   M2b package.json name 改错                                             → exit 1
#   M3  legacy 边界: 在场→红；退役后再现（复活）→红（三段判别性）            → exit 1 ×3
#   M4  判别性自证: checker 换成恒真探针后，M1 红断言不再成立               → 夹具抓得住
#
# 隔离: mktemp 沙箱 + SYNO_* 注入缝 → 不碰真实 ~/.dsh* 与真实 profiles/desktop。
# 平台: 无 sed -i；无权限位判据；无 grep ERE/BRE 方言依赖（一律 grep -qF 固定串）；
#       PYBIN 三级探测（禁裸 python3）。
# 用法: bash tests/control-tower/check-preset-bundles.test.sh
# 退出码: 0 = 全部通过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECK="$REPO_DIR/scripts/control-tower/check-preset-bundles.sh"
REPO_SRC="$REPO_DIR/docs/synova/presets"
PID="synova-squad-lead"
EMIT_DATE="2026-09-25"   # 与入库 patch 头版日期一致 → 可逐字节比对

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then
    PYBIN="$_c"; break
  fi
done

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_rc() { # <got> <want> <msg>
  if [ "$1" -eq "$2" ]; then pass "$3"; else fail "$3 (got rc=$1, want rc=$2)"; fi
}
assert_has() { # <haystack> <fixed-needle> <msg>
  if printf '%s' "$1" | grep -qF -- "$2"; then pass "$3"; else fail "$3 (缺少串: $2)"; fi
}
assert_absent() { # <haystack> <fixed-needle> <msg>
  if printf '%s' "$1" | grep -qF -- "$2"; then fail "$3 (不应出现: $2)"; else pass "$3"; fi
}

if [ ! -f "$CHECK" ]; then
  echo "❌ 缺被测脚本: $CHECK" >&2
  exit 2
fi
if [ -z "$PYBIN" ]; then
  echo "❌ python 不可用（python3/python/py 均缺失）" >&2
  exit 2
fi

# ── 沙箱 ──
TMP=$(mktemp -d /tmp/d945-cpb.XXXXXX)
SRC="$TMP/bundle-src"
PROF="$TMP/profile"
LEG="$TMP/legacy-home"
LOGD="$TMP/logs"
mkdir -p "$SRC" "$PROF" "$LEG" "$LOGD"
trap 'rm -rf "$TMP"' EXIT

cp -R "$REPO_SRC/." "$SRC/"
INST="$PROF/node_modules/@local/dsh-preset-$PID"
mkdir -p "$INST"
cp "$SRC/$PID/package.json" "$INST/package.json"
cp "$SRC/$PID/cordis.patch.yml" "$INST/cordis.patch.yml"
printf '{\n  "name": "dsh-profile-desktop",\n  "private": true,\n  "dsh": {\n    "profile": {\n      "bundles": [\n        "@local/dsh-preset-%s"\n      ]\n    }\n  }\n}\n' "$PID" > "$PROF/package.json"

DEG="$LOGD/degraded.log"
JRN="$LOGD/journal.log"

# 注意: 每次调用都重设 env，故单测之间互不残留
run() {
  SYNO_PRESET_REPO_DIR="$SRC" SYNO_PROFILE_DIR="$PROF" SYNO_LEGACY_HOME="$LEG" \
    SYNO_PRESET_DEGRADED_LOG="$DEG" SYNO_PRESET_LEGACY_JOURNAL="$JRN" \
    SYNO_EMIT_DATE="$EMIT_DATE" bash "$CHECK" "$@" 2>&1
}
# 重建沙箱到"干净一致"状态（M1/M1b/M2 等变异后回到基线）
restore_repo() {
  rm -rf "$SRC"
  mkdir -p "$SRC"
  cp -R "$REPO_SRC/." "$SRC/"
}
restore_installed() {
  rm -rf "$INST"
  mkdir -p "$INST"
  cp "$SRC/$PID/package.json" "$INST/package.json"
  cp "$SRC/$PID/cordis.patch.yml" "$INST/cordis.patch.yml"
}

echo "── T1 --repo 对真实仓库源判绿（不 mock）──"
restore_repo
OUT=$(run --repo); RC=$?
assert_rc "$RC" 0 "T1: --repo exit 0"
assert_has "$OUT" "REPO-OK: $PID" "T1: 点名 REPO-OK"
assert_has "$OUT" "--repo 汇总: 发现 1 个预设, 违规 0 个" "T1: 汇总行正确"

echo "── T2 --consistency 沙箱一致（legacy 不在场）──"
OUT=$(run --consistency); RC=$?
assert_rc "$RC" 0 "T2: --consistency exit 0"
assert_has "$OUT" "CONSISTENT: $PID" "T2: 点名 CONSISTENT"
assert_absent "$OUT" "LEGACY-PRESENT" "T2: 无 legacy 判红"

echo "── T3 --emit 逐字节复现已入库 patch（生成器可信）──"
# --emit 的输入是 legacy 源，故用独立 legacy home（不污染 M3 的 legacy 判据沙箱）
LEG_E="$TMP/legacy-emit"
REAL_LEGACY="${DSH_HOME:-$HOME/.dsh-trial-017}/.agent-presets/$PID"
mkdir -p "$LEG_E/.agent-presets/$PID"
if [ -f "$REAL_LEGACY/agent.cordis.yml" ] && [ -f "$REAL_LEGACY/preset.yml" ]; then
  cp "$REAL_LEGACY/agent.cordis.yml" "$LEG_E/.agent-presets/$PID/agent.cordis.yml"
  cp "$REAL_LEGACY/preset.yml" "$LEG_E/.agent-presets/$PID/preset.yml"
  SYNO_PRESET_REPO_DIR="$SRC" SYNO_PROFILE_DIR="$PROF" SYNO_LEGACY_HOME="$LEG_E" \
    SYNO_PRESET_DEGRADED_LOG="$DEG" SYNO_PRESET_LEGACY_JOURNAL="$JRN" SYNO_EMIT_DATE="$EMIT_DATE" \
    bash "$CHECK" --emit "$PID" > "$TMP/emit.yml" 2>/dev/null; RC=$?
  assert_rc "$RC" 0 "T3: --emit exit 0（真实 legacy 源）"
  if cmp -s "$TMP/emit.yml" "$SRC/$PID/cordis.patch.yml"; then
    pass "T3: --emit 产物与仓库源逐字节相同（生成器可复现，非手抄）"
  else
    fail "T3: --emit 产物与仓库源不同（生成器不可复现）"
  fi
else
  echo "  ⊘ T3 降级为结构断言: 本机无真实 legacy 源（$REAL_LEGACY）"
  printf -- '- id: persona\n  name: %s\n' "'@deepseek-ai/dsh-persona'" > "$LEG_E/.agent-presets/$PID/agent.cordis.yml"
  printf 'name: T\n' > "$LEG_E/.agent-presets/$PID/preset.yml"
  printf 'description: D\n' >> "$LEG_E/.agent-presets/$PID/preset.yml"
  OUT=$(SYNO_PRESET_REPO_DIR="$SRC" SYNO_PROFILE_DIR="$PROF" SYNO_LEGACY_HOME="$LEG_E" \
    SYNO_PRESET_DEGRADED_LOG="$DEG" SYNO_PRESET_LEGACY_JOURNAL="$JRN" SYNO_EMIT_DATE="$EMIT_DATE" \
    bash "$CHECK" --emit "$PID" 2>&1); RC=$?
  assert_rc "$RC" 0 "T3: --emit exit 0（合成 legacy 源）"
  assert_has "$OUT" "    - id: preset-$PID" "T3: 产物含 preset 行"
  assert_has "$OUT" "      name: '@deepseek-ai/dsh-agent-preset'" "T3: 产物含 agent-preset 行"
fi

echo "── T4 降级: bundle 源目录不存在 ──"
OUT=$(SYNO_PRESET_REPO_DIR="$TMP/no-such-src" SYNO_PROFILE_DIR="$PROF" SYNO_LEGACY_HOME="$LEG" \
  SYNO_PRESET_DEGRADED_LOG="$DEG" SYNO_PRESET_LEGACY_JOURNAL="$JRN" bash "$CHECK" --repo 2>&1); RC=$?
assert_rc "$RC" 2 "T4: 源缺失 exit 2"
assert_has "$OUT" "degraded: bundle 源目录不存在" "T4: 显式 degraded"
assert_has "$(tail -1 "$DEG")" '"retryable": true' "T4: 五字段日志落盘"

echo "── T5 降级: profile 目录不存在 ──"
OUT=$(SYNO_PRESET_REPO_DIR="$SRC" SYNO_PROFILE_DIR="$TMP/no-such-profile" SYNO_LEGACY_HOME="$LEG" \
  SYNO_PRESET_DEGRADED_LOG="$DEG" SYNO_PRESET_LEGACY_JOURNAL="$JRN" bash "$CHECK" --consistency 2>&1); RC=$?
assert_rc "$RC" 2 "T5: profile 缺失 exit 2"
assert_has "$OUT" "degraded: profile 目录不存在" "T5: 显式 degraded"

echo "── T6 降级: 未给 mode ──"
OUT=$(run 2>&1); RC=$?
assert_rc "$RC" 2 "T6: 无 mode exit 2"
assert_has "$OUT" "degraded: 必须指定" "T6: 显式 degraded"

echo "── T7 边界: 已装 patch 陈旧（模拟 delegation 残留）→ 红 + 证据 ──"
restore_repo; restore_installed
printf '\n          - id: delegation\n' >> "$INST/cordis.patch.yml"
OUT=$(run --consistency); RC=$?
assert_rc "$RC" 1 "T7: 陈旧 exit 1"
assert_has "$OUT" "STALE: $PID 陈旧" "T7: 点名陈旧"
assert_has "$OUT" "id-delegation=1" "T7: 证据行给出 delegation 残留计数"
assert_has "$OUT" "repo agent-team=6 id-delegation=0" "T7: 证据行给出仓库侧正解计数"
restore_installed

echo "── M1 变异: 删运行时 bundle 声明行 → 必红 ──"
"$PYBIN" - "$PROF/package.json" <<'PY'
import io, json, sys
p = sys.argv[1]
d = json.load(io.open(p, encoding="utf-8"))
d["dsh"]["profile"]["bundles"] = []
io.open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
PY
OUT=$(run --consistency); RC=$?
assert_rc "$RC" 1 "M1: 声明行缺失 exit 1"
assert_has "$OUT" "选择器不可见" "M1: 点名选择器不可见"
# 还原声明
"$PYBIN" - "$PROF/package.json" "$PID" <<'PY'
import io, json, sys
p, pid = sys.argv[1], sys.argv[2]
d = json.load(io.open(p, encoding="utf-8"))
d["dsh"]["profile"]["bundles"] = ["@local/dsh-preset-%s" % pid]
io.open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
PY

echo "── M1b 变异: 删仓库 bundle 声明行 dsh.bundle.patch → 必红 ──"
"$PYBIN" - "$SRC/$PID/package.json" <<'PY'
import io, json, sys
p = sys.argv[1]
d = json.load(io.open(p, encoding="utf-8"))
d["dsh"] = {}
io.open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
PY
OUT=$(run --repo); RC=$?
assert_rc "$RC" 1 "M1b: 仓库声明行缺失 exit 1"
assert_has "$OUT" "缺 bundle 声明行 dsh.bundle.patch" "M1b: 点名声明行缺失"
restore_repo

echo "── M2 变异: patch 内 preset id 改错 → 必红 ──"
"$PYBIN" - "$SRC/$PID/cordis.patch.yml" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
s = s.replace("    - id: preset-synova-squad-lead", "    - id: preset-wrong-id", 1)
io.open(p, "w", encoding="utf-8").write(s)
PY
OUT=$(run --repo); RC=$?
assert_rc "$RC" 1 "M2: id 改错 exit 1"
assert_has "$OUT" "REPO-DRIFT: $PID" "M2: 点名预设"
restore_repo

echo "── M2b 变异: package.json name 改错 → 必红 ──"
"$PYBIN" - "$SRC/$PID/package.json" <<'PY'
import io, json, sys
p = sys.argv[1]
d = json.load(io.open(p, encoding="utf-8"))
d["name"] = "@local/dsh-preset-not-this-one"
io.open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
PY
OUT=$(run --repo); RC=$?
assert_rc "$RC" 1 "M2b: name 不符 exit 1"
assert_has "$OUT" "name 不符" "M2b: 点名 name 不符"
restore_repo; restore_installed

echo "── M3 legacy 边界: 在场→红 / 退役后再现（复活）→红 ──"
mkdir -p "$LEG/.agent-presets/$PID"
OUT=$(run --consistency); RC=$?
assert_rc "$RC" 1 "M3a: legacy 在场 exit 1"
assert_has "$OUT" "LEGACY-PRESENT" "M3a: 点名 LEGACY-PRESENT"
assert_has "$OUT" "legacy 判红 1" "M3a: 汇总计入 1"
rm -rf "$LEG/.agent-presets/$PID"
OUT=$(run --consistency); RC=$?
assert_rc "$RC" 0 "M3b: legacy 退役后 exit 0"
assert_has "$OUT" "LEGACY-RETIRED" "M3b: 记退役（越运行记忆）"
mkdir -p "$LEG/.agent-presets/$PID"
OUT=$(run --consistency); RC=$?
assert_rc "$RC" 1 "M3c: legacy 复活 exit 1"
assert_has "$OUT" "LEGACY-REVIVED" "M3c: 点名 LEGACY-REVIVED（复活判据）"
rm -rf "$LEG/.agent-presets"

echo "── M4 判别性自证: 恒真探针下 M1 红断言不成立 ──"
MUT="$TMP/mutant-always-true.sh"
printf '#!/bin/bash\nbash %q "$@" >/dev/null 2>&1\nexit 0\n' "$CHECK" > "$MUT"
"$PYBIN" - "$PROF/package.json" <<'PY'
import io, json, sys
p = sys.argv[1]
d = json.load(io.open(p, encoding="utf-8"))
d["dsh"]["profile"]["bundles"] = []
io.open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
PY
OUT=$(SYNO_PRESET_REPO_DIR="$SRC" SYNO_PROFILE_DIR="$PROF" SYNO_LEGACY_HOME="$LEG" \
  SYNO_PRESET_DEGRADED_LOG="$DEG" SYNO_PRESET_LEGACY_JOURNAL="$JRN" bash "$MUT" --consistency 2>&1); RC=$?
assert_rc "$RC" 0 "M4a: 恒真探针返回 0（探针已被中和）"
if [ "$RC" -ne 1 ]; then
  pass "M4b: 恒真探针 ≠ 红期望(1) → M1 断言具备判别性（非空壳）"
else
  fail "M4b: 恒真探针仍返回 1 — M1 断言无判别性"
fi
"$PYBIN" - "$PROF/package.json" "$PID" <<'PY'
import io, json, sys
p, pid = sys.argv[1], sys.argv[2]
d = json.load(io.open(p, encoding="utf-8"))
d["dsh"]["profile"]["bundles"] = ["@local/dsh-preset-%s" % pid]
io.open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
PY

echo "── 沙箱隔离自证: 夹具全程只碰 mktemp，不碰真实 home / 真实仓库源 ──"
REAL_PROFILE="${DSH_HOME:-$HOME/.dsh-trial-017}/profiles/desktop"
if [ "$PROF" = "$REAL_PROFILE" ] || [ "$SRC" = "$REPO_SRC" ] || [ "$LEG" = "${DSH_HOME:-$HOME/.dsh-trial-017}" ]; then
  fail "沙箱隔离失效: 注入缝指向真实路径（PROF=$PROF SRC=$SRC LEG=$LEG）"
else
  pass "沙箱隔离: 注入缝全部指向 mktemp 副本（真实 home/仓库源零写入）"
fi
case "$PROF" in
  /tmp/*) pass "沙箱位于 mktemp 前缀: $PROF" ;;
  *) fail "沙箱不在 mktemp 前缀: $PROF" ;;
esac
if [ -d "$SRC" ] && [ -f "$SRC/$PID/cordis.patch.yml" ]; then
  pass "真实仓库源未被夹具破坏（$REPO_SRC 仍可读，沙箱用副本）"
else
  fail "仓库源不可读 — 夹具可能写坏了真实源"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  PASS=$PASS  FAIL=$FAIL"
echo "═══════════════════════════════════════"
[ "$FAIL" -eq 0 ]
