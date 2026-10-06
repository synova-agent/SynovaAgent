#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# w6-gate-restore.test.sh — W6/D1166 判别夹具（含**反例**）
#
# 治的病（CTO 2026-10-06 A 槽 W6）: D1148 把三条门禁从 soft 转成 `bypass_run`
#   —— **只打印、不判红、连 CI strict 也不转硬** ⇒ 「写着阻断、实际旁路」。
#   三个原调用点（本夹具按**语义**核，不钉死行号）:
#     · scripts/doc-system/check-doc-truth.sh          （D782 D1 文档真相）
#     · scripts/doc-system/doc-registry-gate.sh        （D782 D2 登记门禁）
#     · scripts/control-tower/check-pr-budget.sh       （D734 PR 预算）
#
# W6 的判据（CTO 原文）: 制造一次 D2 违规 ⇒ **提交被拒**。
#   本项目口径 = 「本地软提示 + CI 权威（`SYNO_CI=1` 转硬）」⇒「被拒」发生在 CI 侧。
#   故本夹具同时钉**两支**：CI 支必被拒（HARD_FAIL+1），本地支不阻断（SOFT_COUNT+1，符合 D515）。
#
# 契据（铁律 47）
#   @input  env PCH  被测脚本路径（默认 scripts/pre-commit-check.sh）
#   @output 逐条 `PASS/FAIL` + 末行 `RESULT: <n> PASS / <m> FAIL`
#   @exit   0 = 全 PASS；1 = 有 FAIL；2 = 调用错误（被测脚本缺失 / 标记缺失）
#
# 判别性设计（V-08「改坏即红」，含反例）:
#   · 正例 A: SYNO_CI=1 + 门禁返回非 0 ⇒ HARD_FAIL ≥ 1（**提交会被拒**）
#   · 对照 B: 无 SYNO_CI + 门禁返回非 0 ⇒ SOFT_COUNT ≥ 1 且 HARD_FAIL = 0（本地不阻断，符合 D515）
#   · 对照 C: 门禁返回 0 ⇒ 两者皆 0（不误伤）
#   · 🔴 反例 D（判别力来源）: 用**旧的 `bypass_run` 形态**跑同一失败用例 ⇒ HARD_FAIL=0 **且** SOFT_COUNT=0
#      ⇒ 证明"阻断力"确实由本卡引入，而非夹具根本没看计数
#   · 结构 E: 三个调用点**不再**是 `bypass_run`（按内容核，不按行号）
#
# 单一真值源: 被测函数（`v5_soft` / `_run_gate`）**从被测脚本提取**（标记 + 花括号配对），
#   绝不抄死在夹具里（抄死 = 夹具与真值漂移，夹具就失去判别力）。
# 兼容性: macOS bash 3.2（禁 mapfile / 禁关联数组）；故意不用 set -e。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

PCH="${PCH:-scripts/pre-commit-check.sh}"
[ -f "$PCH" ] || { echo "ERROR: 被测脚本不存在: $PCH" >&2; exit 2; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
PASS_N=0; FAIL_N=0
ok() { echo "  ✅ $1"; PASS_N=$((PASS_N+1)); }
no() { echo "  ❌ $1"; FAIL_N=$((FAIL_N+1)); }
chk() { # chk <name> <expect> <got>
  if [ "$2" = "$3" ]; then ok "$1 (=$3)"; else no "$1 expect=$2 got=$3"; fi
}

echo "=== W6 门禁恢复判别夹具 ==="
echo "被测: $PCH"; echo

# ── 单一真值源: 从被测脚本提取 v5_soft + _run_gate ───────────────────────────
python3 - "$PCH" "$TMPD/frag.sh" <<'PY'
import io, sys, os
src, out = sys.argv[1], sys.argv[2]
lines = io.open(src, encoding="utf-8").read().split("\n")

def extract_by_markers(begin, end):
    try:
        b = lines.index(begin); e = lines.index(end)
    except ValueError:
        return None
    return "\n".join(lines[b:e+1])

def extract_by_brace(start_prefix):
    for i, ln in enumerate(lines):
        if ln.startswith(start_prefix):
            depth = 0; body = []
            for j in range(i, len(lines)):
                body.append(lines[j]); depth += lines[j].count("{") - lines[j].count("}")
                if depth == 0 and j > i:
                    return "\n".join(body)
            return None
    return None

frag = []
rg = extract_by_markers("# W6-RUN-GATE-BEGIN", "# W6-RUN-GATE-END")
if rg: frag.append(rg)
vs = extract_by_brace("v5_soft() {")
if vs: frag.append(vs)
io.open(out, "w", encoding="utf-8").write("\n".join(frag) + "\n")
print("extracted v5_soft=%s _run_gate=%s" % (bool(vs), bool(rg)))
PY
if ! grep -q '^_run_gate() {' "$TMPD/frag.sh" || ! grep -q '^v5_soft() {' "$TMPD/frag.sh"; then
  echo "ERROR: 未能从 $PCH 提取 v5_soft/_run_gate（标记缺失或签名变更）" >&2; exit 2
fi

# ── 沙箱: 造一个「门禁失败」的桩 + 一个「门禁通过」的桩 ─────────────────────
cat > "$TMPD/gate-fail.sh" <<'EOS'
#!/usr/bin/env bash
echo "D2 违规：新增 doc 未登记 DOCS-REGISTRY.yaml"
exit 1
EOS
cat > "$TMPD/gate-pass.sh" <<'EOS'
#!/usr/bin/env bash
exit 0
EOS
chmod +x "$TMPD/gate-fail.sh" "$TMPD/gate-pass.sh"

# 驱动一次 _run_gate；输出 "HARD=<n> SOFT=<n>"
drive() { # drive <cid> <gate-script> [--bypass]
  local ci="$1" gate="$2" mode="${3:-}"
  ( set +e
    HARD_FAIL=0; SOFT_COUNT=0
    RED=''; YELLOW=''; RESET=''
    CYAN=''; GREEN=''
    note_check() { :; }
    log_gate() { :; }
    . "$TMPD/frag.sh" >/dev/null 2>&1
    if [ "$mode" = "--bypass" ]; then
      # 🔴 反例载体: 复刻 D1148 的 bypass_run 形态（只打印、不判红）
      bypass_run() { local _bn="$1"; shift; "$@" >/dev/null 2>&1; return 0; }
      bypass_run "TEST" bash "$gate" 1>&2   # 产物入 stderr ⇒ `$()` 只取末行标记
    else
      _run_gate "TEST" bash "$gate" 1>&2    # 同上：门禁输出与 v5_soft 提示都入 stderr
    fi
    printf 'HARD=%s SOFT=%s' "$HARD_FAIL" "$SOFT_COUNT"
  )
}

# A 正例: CI strict + 失败 ⇒ 必被拒
A="$(env SYNO_CI=1 bash -c "$(declare -f drive); TMPD='$TMPD'; drive x '$TMPD/gate-fail.sh'" 2>/dev/null)"  # swallow-ok: 门禁产物已重定向入 stderr；此处只取末行标记，紧随其后的 chk 逐条断言
chk "A CI strict 失败⇒HARD_FAIL=1" "HARD=1 SOFT=0" "$A"

# B 对照: 无 SYNO_CI + 失败 ⇒ 本地软（不阻断）
B="$(env -u SYNO_CI bash -c "$(declare -f drive); TMPD='$TMPD'; drive x '$TMPD/gate-fail.sh'" 2>/dev/null)"  # swallow-ok: 门禁产物已重定向入 stderr；此处只取末行标记，紧随其后的 chk 逐条断言
chk "B 本地 失败⇒SOFT_COUNT=1 不阻断" "HARD=0 SOFT=1" "$B"

# C 对照: 通过 ⇒ 两者皆 0
C="$(env SYNO_CI=1 bash -c "$(declare -f drive); TMPD='$TMPD'; drive x '$TMPD/gate-pass.sh'" 2>/dev/null)"  # swallow-ok: 门禁产物已重定向入 stderr；此处只取末行标记，紧随其后的 chk 逐条断言
chk "C 通过⇒零计数" "HARD=0 SOFT=0" "$C"

# D 🔴 反例（判别力）: 旧 bypass_run 形态 + CI strict + 失败 ⇒ 两者皆 0（旁路仍在）
D="$(env SYNO_CI=1 bash -c "$(declare -f drive); TMPD='$TMPD'; drive x '$TMPD/gate-fail.sh' --bypass" 2>/dev/null)"  # swallow-ok: 同上（反例支）
chk "D 反例 旧 bypass_run⇒零计数（证明阻断力由本卡引入）" "HARD=0 SOFT=0" "$D"

# E 结构: 三个原调用点不再走 bypass_run
for g in check-doc-truth.sh doc-registry-gate.sh check-pr-budget.sh; do
  if grep -q "bypass_run .*$g" "$PCH"; then no "E $g 仍走 bypass_run"; else ok "E $g 已脱离 bypass_run"; fi
  if grep -q "_run_gate .*$g" "$PCH"; then ok "E $g 已接 _run_gate"; else no "E $g 未接 _run_gate"; fi
done

echo
echo "RESULT: $PASS_N PASS / $FAIL_N FAIL"
[ "$FAIL_N" -gt 0 ] && exit 1
exit 0
