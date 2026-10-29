#!/bin/bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true  # swallow-ok: 语言环境设不上不改判定（输出为 UTF-8 字面量，非本地化文本）
# ═══════════════════════════════════════════════════════════════════════════════
# verify-governance.test.sh — 配对测试（CT-40/U7：「控制塔脚本须有配对测试」）
#
# 被测对象：`scripts/control-tower/verify-governance.sh`（#1122 · Step 1 总闸最小可跑版）
#
# 判什么（不是"跑一遍看看"）:
#   T0  自身约束：UTF-8／纯 LF（\r=0）／无「组 N」横幅／`2>/dev/null`·`|| true` 必带 `# swallow-ok:`／
#       python 一律经 PYBIN（禁裸 python3）
#   T1  干净夹具 ⇒ `GOVERNANCE: 3/3 PASS` ＋ exit 0（规格 §4 判据①）
#   T2  遥测日志缺失 ⇒ G2=SKIP（**不得显示 PASS**）＋ 末行不计它 ＋ exit 1（判据②）
#   T3  遥测日志为空 ⇒ 同 T2
#   T4  注入 exit 128（沙箱）⇒ G6=FAIL ＋ 整体非 0（判据③／规格 M-6）
#   T5  0/1/2 透传：注入 0 ⇒ 结论 0 且 G6=PASS；注入 1 ⇒ 结论 1；注入 2 由 T4（128 ⇒ 结论 2）覆盖
#      （禁"一律归 2"的假归一：若本件把一切归 2，注入 0/1 的用例立刻红）
#   T6  改坏即红：把 gate-assert 的 `128) printf '2'` 改成 `'0'` ⇒ T4 的断言必须失效
#      （即"128 被洗成通过"确实可被本套用例抓到；原脚本仍判红）
#   T7  G10 甲态错（扫描器 A 档判据恒假）⇒ G10=FAIL ＋ 整体非 0（判据④）
#   T8  G10 乙态错（扫描器把所有变更判红）⇒ G10=FAIL（两态都对才 PASS）
#   T9  `--days` 边界：8 天前记录在 7 天窗口外（G2 红）、在 10 天窗口内（G2 绿）
#   T10 日志坏行：跳过并计数，不崩、不改判定
#   T11 日志全坏行：SKIP ＋ 报「损坏行」，不得当 PASS
#   T12 判不了 ⇒ exit 2：清单缺失／无 classification 段／required 集合为空
#   T13 判不了 ⇒ exit 2：子判据缺失（gate-assert.sh／check-unicode-confusable.py）
#   T14 判不了 ⇒ exit 2：参数错（未知参数／--days 非数字／--days 0／--telemetry 缺值）
#   T15 只读＋注入缝边界：跑前跑后三件真件 sha256 不变；非沙箱下 `SYNO_GOV_G6_RC=1` **不生效**
#   T16 记账自洽：WIRING-REGISTRY 的 `governance.verifyGovernance` 与"零生产调用点"一致（declared-only）
#
# 沙箱隔离（判据纪律 ⑨-②）: 全部夹具在 `mktemp -d` 下自建（复制真件 ＋ 临时清单），
#   不写仓库、不改真件、不依赖真仓的 `.claude/gate-hits.log`。
# 危险字符一律用 `printf` 字节转义生成（**本文件不落同形字/全角字面**）。
# 断言风格对齐 `tests/control-tower/check-unicode-confusable.test.sh`（ok/no 计数 ＋ 末行结果行）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="$REPO/scripts/control-tower/verify-governance.sh"
GA_SRC="$REPO/scripts/control-tower/gate-assert.sh"
UNI_SRC="$REPO/scripts/control-tower/check-unicode-confusable.py"
WR="$REPO/docs/authority/WIRING-REGISTRY.yaml"
PC="$REPO/scripts/pre-commit-check.sh"
WFL="$REPO/.gitea/workflows/local-gates.yml"
PYBIN="$(command -v python3 2>/dev/null)"  # swallow-ok: python3 缺失由 T0 显式判红（禁裸 python3，D520）

PASS=0; FAIL=0; FAILED_DIGEST=""
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); FAILED_DIGEST="${FAILED_DIGEST}${1} ; "; }

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
mkdir -p "$TMPD"

echo "=== verify-governance 配对测试（#1122 · Step 1 总闸最小可跑版）==="

# ── 夹具工具 ────────────────────────────────────────────────────────────────
iso_ago() { # $1 = 距今天数（可负）
  "$PYBIN" -c 'import datetime,sys
print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=int(sys.argv[1]))).strftime("%Y-%m-%dT%H:%M:%SZ"))' "$1"
}
# 时间戳只算两次（Windows 上每次 python spawn 数十毫秒，逐行算会把用例拖成分钟级）
TS_NOW="$(iso_ago 0)"
TS_8D="$(iso_ago 8)"

write_inventory() { # $1 = root 目录；内容固定为 2 个 required ＋ 1 个非 required
  cat > "$1/docs/authority/GATE-INVENTORY.yaml" <<'YAML'
# fixture inventory（本测试专用；不改真清单）
classification:
  - id: CT-alpha
    class: P0
    owner: P4
    review_after: 2026-11-27
    entrypoint: scripts/control-tower/check-alpha.sh
    required_ci: true
  - id: CT-beta
    class: P1
    owner: P4
    review_after: 2026-11-27
    entrypoint: scripts/control-tower/check-beta.py
    required_ci: true
  - id: CT-gamma
    class: P2
    owner: P4
    review_after: 2026-11-27
    entrypoint: scripts/control-tower/check-gamma.sh
    required_ci: false
YAML
}

mkroot() { # $1 = root 目录；GA_FOR_ROOT / UNI_FOR_ROOT 可覆盖被复制的子判据（改坏用）
  local d="$1"
  mkdir -p "$d/scripts/control-tower" "$d/docs/authority"
  cp "${GA_FOR_ROOT:-$GA_SRC}" "$d/scripts/control-tower/gate-assert.sh"
  cp "${UNI_FOR_ROOT:-$UNI_SRC}" "$d/scripts/control-tower/check-unicode-confusable.py"
  write_inventory "$d"
}

write_log() { # $1 = 日志路径；其余 "gate|result|ISO时间戳"
  local p="$1"; shift
  : > "$p"
  local spec
  for spec in "$@"; do
    printf '{"time":"%s","gate":"%s","result":"%s","branch":"main","duration_ms":1,"hits":0}\n' \
      "$(printf '%s' "$spec" | cut -d'|' -f3)" \
      "$(printf '%s' "$spec" | cut -d'|' -f1)" \
      "$(printf '%s' "$spec" | cut -d'|' -f2)" >> "$p"
  done
}

OUT=""; RC=0
run_gov() { # 所有参数原样传给被测脚本；stdout+stderr 合流进 OUT，退出码进 RC
  OUT="$(bash "$S" "$@" 2>&1)"
  RC=$?
}
last_line() { printf '%s\n' "$OUT" | tail -1; }
has() { case "$OUT" in *"$1"*) return 0 ;; *) return 1 ;; esac; }

# ── T0 自身约束 ─────────────────────────────────────────────────────────────
echo "── T0 自身约束（UTF-8／LF／swallow-ok／PYBIN／无组横幅）"
if [ -f "$S" ]; then ok "T0 被测脚本存在"; else no "T0 被测脚本不存在: $S"; fi
if [ -z "$PYBIN" ]; then
  no "T0 python3 不可用（G2/G10 无法判定）"
else
  if "$PYBIN" -c 'import sys;open(sys.argv[1],encoding="utf-8",errors="strict").read()' "$S" 2>/dev/null; then  # swallow-ok: 解码失败由下方 else 分支显式判红，不静默放行
    ok "T0 脚本可按 UTF-8 严格解码"
  else
    no "T0 脚本非 UTF-8 严格可解码"
  fi
fi
CR_N="$(awk '/\r/{n++} END{print n+0}' "$S")"
if [ "$CR_N" -eq 0 ]; then ok "T0 纯 LF（含 CR 的行数=0）"; else no "T0 含 CR 的行数=${CR_N}（禁 CRLF）"; fi
BANNER_N="$(grep -cE '组 [0-9]+' "$S" || true)"
if [ "$BANNER_N" -eq 0 ]; then ok "T0 无「组 N」横幅"; else no "T0 出现「组 N」横幅 ${BANNER_N} 处（禁新增）"; fi
SW_N="$(awk '(/2>\/dev\/null/ || /\|\| true/) && !/swallow-ok/ {n++} END{print n+0}' "$S")"
if [ "$SW_N" -eq 0 ]; then
  ok "T0 每处 2>/dev/null 与 || true 均带 # swallow-ok:"
else
  no "T0 有 ${SW_N} 行静默吞错缺 # swallow-ok:"
fi
if grep -q '"\$PYBIN" -' "$S" && ! grep -qE '(^|[^_A-Za-z])python3[[:space:]]+(-|scripts/)' "$S"; then
  ok "T0 python 走 PYBIN（无裸 python3 调用）"
else
  no "T0 存在裸 python3 调用或未用 PYBIN"
fi

# ── T1 干净夹具 ⇒ 3/3 PASS ＋ exit 0 ────────────────────────────────────────
echo "── T1 干净夹具"
R="$TMPD/root-clean"; mkroot "$R"
L="$TMPD/clean.log"; write_log "$L" "check-alpha.sh|hit|${TS_NOW}" "check-beta|miss|${TS_NOW}"
run_gov --root "$R" --telemetry "$L" --days 7
if [ "$RC" -eq 0 ]; then ok "T1 exit=0"; else no "T1 exit=${RC}（期望 0）"; fi
if [ "$(last_line)" = "GOVERNANCE: 3/3 PASS" ]; then
  ok "T1 末行 'GOVERNANCE: 3/3 PASS'"
else
  no "T1 末行=$(last_line)（期望 'GOVERNANCE: 3/3 PASS'）"
fi
if has "G2 遥测 ran=true: PASS"; then ok "T1 G2 PASS"; else no "T1 G2 未 PASS"; fi
if has "G6 退出码归一: PASS"; then ok "T1 G6 PASS"; else no "T1 G6 未 PASS"; fi
if has "G10 同形字两态: PASS"; then ok "T1 G10 PASS"; else no "T1 G10 未 PASS"; fi

# ── T2 遥测缺失 ⇒ G2 SKIP（不得 PASS）＋ 末行不计它 ＋ exit 1 ────────────────
echo "── T2 遥测日志缺失"
R2="$TMPD/root-notel"; mkroot "$R2"
run_gov --root "$R2" --telemetry "$TMPD/does-not-exist.log" --days 7
if [ "$RC" -eq 1 ]; then ok "T2 exit=1（非全 PASS）"; else no "T2 exit=${RC}（期望 1）"; fi
if has "G2 遥测 ran=true: SKIP"; then ok "T2 G2=SKIP"; else no "T2 G2 未标 SKIP"; fi
if [ "$(last_line)" = "GOVERNANCE: 2/3 PASS" ]; then
  ok "T2 末行 'GOVERNANCE: 2/3 PASS'（SKIP 不计入 x）"
else
  no "T2 末行=$(last_line)（期望 'GOVERNANCE: 2/3 PASS'）"
fi
if has "CT-alpha scripts/control-tower/check-alpha.sh（未运行）"; then ok "T2 逐条点名未运行"; else no "T2 未点名未运行项"; fi

# ── T3 遥测为空 ⇒ 同 T2 ────────────────────────────────────────────────────
echo "── T3 遥测日志为空"
R3="$TMPD/root-emptytel"; mkroot "$R3"
: > "$TMPD/empty.log"
run_gov --root "$R3" --telemetry "$TMPD/empty.log" --days 7
if [ "$RC" -eq 1 ] && has "G2 遥测 ran=true: SKIP"; then
  ok "T3 空日志 ⇒ G2=SKIP ＋ exit 1"
else
  no "T3 空日志应为 SKIP ＋ exit 1（实得 exit=${RC}）"
fi

# ── T4 注入 exit 128（沙箱）⇒ G6=FAIL ＋ 整体非 0 ───────────────────────────
echo "── T4 注入 exit 128 ⇒ 判据故障(2) 计 FAIL"
R4="$TMPD/root-128"; mkroot "$R4"
L4="$TMPD/clean4.log"; write_log "$L4" "check-alpha.sh|hit|${TS_NOW}" "check-beta|miss|${TS_NOW}"
OUT="$(SYNO_TEST_ARM=1 SYNO_GOV_G6_RC=128 bash "$S" --root "$R4" --telemetry "$L4" --days 7 2>&1)"; RC=$?
if [ "$RC" -eq 1 ]; then ok "T4 exit=1（整体非 0）"; else no "T4 exit=${RC}（期望 1）"; fi
if has "G6 退出码归一: FAIL"; then ok "T4 G6=FAIL"; else no "T4 G6 未 FAIL"; fi
if has "结论 2（判据故障"; then ok "T4 归为判据故障(2)"; else no "T4 未归判据故障(2)"; fi
if has "判据故障: 128"; then ok "T4 有 ga_run 点名行 '判据故障: 128'"; else no "T4 缺 ga_run 点名行"; fi
if [ "$(last_line)" = "GOVERNANCE: 2/3 PASS" ]; then
  ok "T4 末行 'GOVERNANCE: 2/3 PASS'"
else
  no "T4 末行=$(last_line)（期望 'GOVERNANCE: 2/3 PASS'）"
fi
T4_OUT="$OUT"   # 供 T6 复用（避免重跑一次真脚本，Windows 上单次约 3 秒）

# ── T5 0/1/2 透传（禁"一律归 2"的假归一）────────────────────────────────────
echo "── T5 0/1/2 透传"
for spec in "0|PASS|结论 0（通过）" "1|FAIL|结论 1（真红）"; do
  code="$(printf '%s' "$spec" | cut -d'|' -f1)"
  want="$(printf '%s' "$spec" | cut -d'|' -f2)"
  frag="$(printf '%s' "$spec" | cut -d'|' -f3)"
  OUT="$(SYNO_TEST_ARM=1 SYNO_GOV_G6_RC="$code" bash "$S" --root "$R4" --telemetry "$L4" --days 7 2>&1)"; RC=$?
  if has "G6 退出码归一: ${want}"; then ok "T5 注入 ${code} ⇒ G6=${want}"; else no "T5 注入 ${code} ⇒ G6≠${want}"; fi
  if has "$frag"; then ok "T5 注入 ${code} ⇒ 输出含 '${frag}'（码透传）"; else no "T5 注入 ${code} ⇒ 输出缺 '${frag}'"; fi
  # 注入 0 时整体应回到 3/3（证明 G6 绿不是因为"什么都红"，也证明默认干净路径可跑）
  if [ "$code" = "0" ]; then
    if [ "$RC" -eq 0 ] && [ "$(last_line)" = "GOVERNANCE: 3/3 PASS" ]; then
      ok "T5 注入 0 ⇒ 3/3 PASS ＋ exit 0"
    else
      no "T5 注入 0 应为 3/3 PASS（实得 exit=${RC}／$(last_line)）"
    fi
  fi
done

# ── T6 改坏即红：gate-assert 的 128 归 0 ⇒ T4 的断言必须失效 ────────────────
echo "── T6 改坏即红（128→0）"
GA_MUT="$TMPD/gate-assert-mut.sh"
# 变异 = 只把 128 分支的归一二态由 2 改成 0（用 python 精确替换，禁 sed 误伤 "128" 里的 2）
"$PYBIN" - "$GA_SRC" "$GA_MUT" <<'PYEOF'
import sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
needle = "    128) printf '2\\n' ;;"
if needle not in text:
    sys.exit(3)
open(dst, "w", encoding="utf-8", newline="\n").write(text.replace(needle, "    128) printf '0\\n' ;;", 1))
PYEOF
MUT_RC=$?
if [ "$MUT_RC" -ne 0 ] || cmp -s "$GA_SRC" "$GA_MUT"; then
  no "T6 改坏即红：变异未命中 128 分支（归一表位置变了 ⇒ 本用例需同步）"
else
  ok "T6 改坏即红：变异体已生成（128 分支 2→0）"
  R6="$TMPD/root-mut-ga"
  GA_FOR_ROOT="$GA_MUT" mkroot "$R6"
  OUT="$(SYNO_TEST_ARM=1 SYNO_GOV_G6_RC=128 bash "$S" --root "$R6" --telemetry "$L4" --days 7 2>&1)"; RC=$?
  if has "G6 退出码归一: PASS"; then
    ok "T6 变异体下注入 128 ⇒ G6=PASS（T4 的 FAIL 断言必红 ⇒ 改坏即红成立）"
  else
    no "T6 变异体下注入 128 仍 FAIL ⇒ 128 归类不由 gate-assert 承重（判据可疑）"
  fi
  if has "判据故障: 128"; then
    no "T6 变异体仍打 '判据故障: 128'（改坏未生效，本用例失去判别力）"
  else
    ok "T6 变异体不再打 '判据故障: 128'（128 被洗成通过）"
  fi
  # 原脚本必须仍判红（改坏只发生在副本上）：复用 T4 的原始输出，不重跑
  case "$T4_OUT" in
    *"G6 退出码归一: FAIL"*) ok "T6 原 gate-assert 仍判 128 为 FAIL（改坏只在副本）" ;;
    *) no "T6 原 gate-assert 对 128 不再 FAIL ⇒ 真件已被污染" ;;
  esac
fi

# ── T7 G10 甲态错（A 档判据恒假）⇒ G10=FAIL ─────────────────────────────────
echo "── T7 G10 甲态错"
UNI_MUT="$TMPD/unicode-mut.py"
sed 's/look = HOMOGLYPH.get(ch) or _nfkc_lookalike(ch)/look = None/' "$UNI_SRC" > "$UNI_MUT"
if cmp -s "$UNI_SRC" "$UNI_MUT"; then
  no "T7 改坏即红：sed 未命中 A 档判据行（判据位置变了 ⇒ 本用例需同步）"
else
  R7="$TMPD/root-mut-uni"
  UNI_FOR_ROOT="$UNI_MUT" mkroot "$R7"
  run_gov --root "$R7" --telemetry "$L4" --days 7
  if has "G10 同形字两态: FAIL"; then ok "T7 A 档恒假 ⇒ G10=FAIL"; else no "T7 A 档恒假但 G10 未 FAIL"; fi
  if [ "$RC" -eq 1 ]; then ok "T7 exit=1"; else no "T7 exit=${RC}（期望 1）"; fi
  if has "甲 西里尔标识符夹具: rc=0"; then
    ok "T7 甲夹具不再判红（rc=0）"
  else
    no "T7 甲夹具原始 rc 非 0（夹具/扫描器口径变了）"
  fi
fi

# ── T8 G10 乙态错（扫描器把所有变更判红）⇒ G10=FAIL ─────────────────────────
echo "── T8 G10 乙态错"
STUB="$TMPD/uni-stub.py"
printf '%s\n' 'import sys' 'print("UNICODE-CONFUSABLE: VIOLATION files=1 added=1 a=1 b=0 c=0 d=0")' 'sys.exit(1)' > "$STUB"
R8="$TMPD/root-stub-uni"
UNI_FOR_ROOT="$STUB" mkroot "$R8"
run_gov --root "$R8" --telemetry "$L4" --days 7
if has "G10 同形字两态: FAIL"; then ok "T8 乙态被误判红 ⇒ G10=FAIL（两态都对才 PASS）"; else no "T8 乙态错但 G10 未 FAIL"; fi

# ── T9 --days 边界 ─────────────────────────────────────────────────────────
echo "── T9 --days 边界"
R9="$TMPD/root-days"; mkroot "$R9"
L9="$TMPD/days.log"; write_log "$L9" "check-alpha.sh|hit|${TS_8D}" "check-beta|miss|${TS_8D}"
run_gov --root "$R9" --telemetry "$L9" --days 7
if has "G2 遥测 ran=true: FAIL"; then ok "T9 8 天前记录在 7 天窗口外 ⇒ G2=FAIL"; else no "T9 7 天窗口未判红"; fi
run_gov --root "$R9" --telemetry "$L9" --days 10
if has "G2 遥测 ran=true: PASS"; then ok "T9 同记录在 10 天窗口内 ⇒ G2=PASS"; else no "T9 10 天窗口未判绿"; fi

# ── T10 坏行不崩 ＋ 计数 ───────────────────────────────────────────────────
echo "── T10 日志坏行"
L10="$TMPD/badline.log"
{ cat "$L4"; printf '%s\n' '{"time": this-is-not-json'; printf '%s\n' '{"gate":"x","result":"hit"}'; } > "$L10"
run_gov --root "$R4" --telemetry "$L10" --days 7
if [ "$RC" -eq 0 ] && [ "$(last_line)" = "GOVERNANCE: 3/3 PASS" ]; then
  ok "T10 坏行不影响判决（仍 3/3 PASS）"
else
  no "T10 坏行改变了判决（exit=${RC}／$(last_line)）"
fi
if has "坏行 2 条已跳过"; then ok "T10 坏行计数=2 并上屏"; else no "T10 未报告坏行计数"; fi

# ── T11 全坏行 ⇒ SKIP（不得当 PASS）─────────────────────────────────────────
echo "── T11 日志全坏行"
L11="$TMPD/allbad.log"
printf '%s\n' 'garbage-line' '{"time": 0' > "$L11"
run_gov --root "$R4" --telemetry "$L11" --days 7
if has "G2 遥测 ran=true: SKIP" && has "损坏行 2"; then
  ok "T11 全坏行 ⇒ G2=SKIP ＋ 报损坏行 2"
else
  no "T11 全坏行未按 SKIP 处理"
fi

# ── T12 判不了 ⇒ exit 2（清单侧）───────────────────────────────────────────
echo "── T12 判不了：清单缺失／无段／required 为空"
R12="$TMPD/root-noinv"; mkroot "$R12"; rm -f "$R12/docs/authority/GATE-INVENTORY.yaml"
run_gov --root "$R12" --telemetry "$L4" --days 7
if [ "$RC" -eq 2 ] && has "degraded: E_INV_MISSING"; then ok "T12 清单缺失 ⇒ exit 2（E_INV_MISSING）"; else no "T12 清单缺失未 exit 2"; fi

R12b="$TMPD/root-nosec"; mkroot "$R12b"
printf '%s\n' 'schema_version: 1' 'meta:' '  counts: 0' > "$R12b/docs/authority/GATE-INVENTORY.yaml"
run_gov --root "$R12b" --telemetry "$L4" --days 7
if [ "$RC" -eq 2 ] && has "E_INV_SECTION"; then ok "T12 无 classification 段 ⇒ exit 2（E_INV_SECTION）"; else no "T12 无 classification 段未 exit 2"; fi

R12c="$TMPD/root-noreq"; mkroot "$R12c"
printf '%s\n' 'classification:' '  - id: CT-only' '    class: P2' '    entrypoint: scripts/control-tower/check-alpha.sh' '    required_ci: false' > "$R12c/docs/authority/GATE-INVENTORY.yaml"
run_gov --root "$R12c" --telemetry "$L4" --days 7
if [ "$RC" -eq 2 ] && has "E_NO_REQUIRED"; then ok "T12 required 集合为空 ⇒ exit 2（信号量 0）"; else no "T12 required 集合为空未 exit 2"; fi

# ── T13 判不了 ⇒ exit 2（子判据缺失）───────────────────────────────────────
echo "── T13 判不了：子判据缺失"
R13="$TMPD/root-noga"; mkroot "$R13"; rm -f "$R13/scripts/control-tower/gate-assert.sh"
run_gov --root "$R13" --telemetry "$L4" --days 7
if [ "$RC" -eq 2 ] && has "E_GA_MISSING"; then ok "T13 缺 gate-assert.sh ⇒ exit 2（E_GA_MISSING）"; else no "T13 缺 gate-assert.sh 未 exit 2"; fi

R13b="$TMPD/root-nouni"; mkroot "$R13b"; rm -f "$R13b/scripts/control-tower/check-unicode-confusable.py"
run_gov --root "$R13b" --telemetry "$L4" --days 7
if [ "$RC" -eq 2 ] && has "E_UNI_MISSING"; then ok "T13 缺扫描器 ⇒ exit 2（E_UNI_MISSING）"; else no "T13 缺扫描器未 exit 2"; fi

# ── T14 判不了 ⇒ exit 2（参数错）───────────────────────────────────────────
echo "── T14 判不了：参数错"
run_gov --root "$R4" --nonsense
if [ "$RC" -eq 2 ] && has "E_USAGE"; then ok "T14 未知参数 ⇒ exit 2"; else no "T14 未知参数未 exit 2"; fi
run_gov --root "$R4" --days abc
if [ "$RC" -eq 2 ] && has "E_USAGE"; then ok "T14 --days abc ⇒ exit 2"; else no "T14 --days abc 未 exit 2"; fi
run_gov --root "$R4" --days 0
if [ "$RC" -eq 2 ] && has "E_USAGE"; then ok "T14 --days 0 ⇒ exit 2"; else no "T14 --days 0 未 exit 2"; fi
run_gov --root "$R4" --telemetry
if [ "$RC" -eq 2 ] && has "E_USAGE"; then ok "T14 --telemetry 缺值 ⇒ exit 2"; else no "T14 --telemetry 缺值未 exit 2"; fi

# ── T15 只读 ＋ 注入缝边界 ─────────────────────────────────────────────────
echo "── T15 只读／注入缝"
sha_of() { "$PYBIN" -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }
H_GA_BEFORE="$(sha_of "$GA_SRC")"; H_UNI_BEFORE="$(sha_of "$UNI_SRC")"; H_S_BEFORE="$(sha_of "$S")"
# 非沙箱下注入缝不生效：SYNO_GOV_G6_RC=1 必须被忽略（仍按 0 注入 ⇒ G6=PASS）
OUT="$(SYNO_GOV_G6_RC=1 bash "$S" --root "$R4" --telemetry "$L4" --days 7 2>&1)"; RC=$?
if has "注入 exit 0" && has "G6 退出码归一: PASS"; then
  ok "T15 非沙箱忽略 SYNO_GOV_G6_RC（仍按 0 注入）"
else
  no "T15 非沙箱仍接受注入（后门）"
fi
H_GA_AFTER="$(sha_of "$GA_SRC")"; H_UNI_AFTER="$(sha_of "$UNI_SRC")"; H_S_AFTER="$(sha_of "$S")"
if [ "$H_GA_BEFORE" = "$H_GA_AFTER" ] && [ "$H_UNI_BEFORE" = "$H_UNI_AFTER" ] && [ "$H_S_BEFORE" = "$H_S_AFTER" ]; then
  ok "T15 三件真件 sha256 跑前跑后一致（只读，不写仓库）"
else
  no "T15 真件被改动（只读承诺破了）"
fi

# ── T16 记账自洽（WIRING declared-only ⇔ 零生产调用点）──────────────────────
echo "── T16 WIRING 记账自洽"
if [ -f "$WR" ]; then
  if grep -q 'capability: governance.verifyGovernance' "$WR"; then
    ok "T16 WIRING 有 governance.verifyGovernance 行"
  else
    no "T16 WIRING 缺 governance.verifyGovernance 行"
  fi
  if "$PYBIN" - "$WR" <<'PYEOF'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
block = None
for chunk in text.split("\n  - capability: "):
    if chunk.startswith("governance.verifyGovernance"):
        block = chunk
        break
if block is None:
    sys.exit(2)
consumer = re.search(r"\n    consumer: (.*)", block)
status = re.search(r"\n    status: (.*)", block)
if status is None or status.group(1).strip() != "declared-only":
    sys.exit(3)
if consumer is None or consumer.group(1).strip() not in ("null", ""):
    sys.exit(4)
sys.exit(0)
PYEOF
  then
    ok "T16 status=declared-only 且 consumer 为空（不编造消费者）"
  else
    no "T16 WIRING 状态与零调用点不自洽"
  fi
else
  no "T16 WIRING-REGISTRY 不存在"
fi
CONSUMERS=0
for f in "$PC" "$REPO/scripts/pre-push-check.sh" "$WFL"; do
  [ -f "$f" ] || continue
  n="$(grep -c 'verify-governance' "$f" || true)"
  CONSUMERS=$((CONSUMERS + n))
done
if [ "$CONSUMERS" -eq 0 ]; then
  ok "T16 生产调用点 0 处（与 declared-only 一致）"
else
  no "T16 已有 ${CONSUMERS} 处生产调用点 ⇒ WIRING 应改 wired"
fi

# ── 结果 ───────────────────────────────────────────────────────────────────
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "结果: ${PASS} 通过, 0 失败"
  echo "VERIFY-GOVERNANCE-TEST: PASS"
  exit 0
fi
echo "失败摘要: ${FAILED_DIGEST}"
echo "结果: ${PASS} 通过, ${FAIL} 失败"
echo "VERIFY-GOVERNANCE-TEST: FAIL"
exit 1
