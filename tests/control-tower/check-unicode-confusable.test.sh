#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true  # swallow-ok: 语言环境设不上不改判定（输出为 UTF-8 字面量，非本地化文本）
# ═══════════════════════════════════════════════════════════════════════════════
# check-unicode-confusable.test.sh — 配对测试（CT-40/U7：「控制塔脚本须有配对测试」）
#
# 被测对象：`scripts/control-tower/check-unicode-confusable.py`（#1108 · W10 分级门禁）
#
# 判什么（不是"跑一遍看看"）:
#   ① 分档：A（标识符同形字）／B（双向控制符）／C（U+FFFD ＋ 非 UTF-8 字节）／D（全角标点仅提醒）
#   ② 范围：**只判 diff 新增行** —— 存量里的同形字/全角标点不得阻断（M-12 语义）
#   ③ 防误伤：中文注释/文案里的全角标点不得判 A，且整体 exit 0
#   ④ 三态：0 通过/SKIP ／ 1 真红 ／ **2 判不了**（坏 base／非 git 仓库／参数互斥／未知参数）
#   ⑤ 改坏即红：把 A 档判据改成恒假 ⇒ M-11 夹具必须**不再**判红（rc 1→0）
#   ⑥ 记账一致：WIRING-REGISTRY 的 status 与"是否真接线"必须自洽（declared-only ⇔ 零接线）
#   ⑦ 自身约束：UTF-8（禁 cp1252）／纯 LF（\r=0）／禁 `$VAR（` 全角边界
#
# 沙箱隔离（判据纪律 ⑨-②）: 全部夹具在 `mktemp -d` 下自建 git repo（本地 config、空 hooksPath），
#   不读真仓、不继承外层 CI 变量、跑前跑后真脚本哈希一致。
# 危险字符一律用 `printf` 字节转义生成（**本文件不落任何 A/B/C 字面字符** ⇒ 本 PR 自身可被本器扫）。
# 断言风格对齐 `tests/control-tower/check-ci-empty-green.test.sh`（ok/no 计数 ＋ 末行结果行）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="$REPO/scripts/control-tower/check-unicode-confusable.py"
WR="$REPO/docs/authority/WIRING-REGISTRY.yaml"
PC="$REPO/scripts/pre-commit-check.sh"
WF="$REPO/.gitea/workflows/local-gates.yml"
PYBIN="$(command -v python3 2>/dev/null)"  # swallow-ok: python3 缺失由下方 T0 显式判红（禁裸 python3，D520）

PASS=0; FAIL=0; FAILED_DIGEST=""
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); FAILED_DIGEST="${FAILED_DIGEST}${1} ; "; }

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
mkdir -p "$TMPD/nohooks"

# 危险字符（字节转义生成；本文件自身不含这些字面字符）
CYR_A="$(printf '\xd0\xb0')"        # U+0430 CYRILLIC SMALL LETTER A（形似 a）
RLO="$(printf '\xe2\x80\xae')"      # U+202E RIGHT-TO-LEFT OVERRIDE（B 档）
FFFD="$(printf '\xef\xbf\xbd')"     # U+FFFD REPLACEMENT CHARACTER（C 档）
FW_COMMA="$(printf '\xef\xbc\x8c')" # U+FF0C FULLWIDTH COMMA（D 档）
FW_LPAREN="$(printf '\xef\xbc\x88')" # U+FF08 FULLWIDTH LEFT PARENTHESIS（D 档）

echo "=== check-unicode-confusable 配对测试（#1108 W10）==="

# ── 夹具工具 ────────────────────────────────────────────────────────────────
new_fixture() {  # $1 = 夹具名；stdout = repo 绝对路径
  local d="$TMPD/$1"
  mkdir -p "$d"
  git -C "$d" init -q 2>/dev/null || true  # swallow-ok: init 失败会在下方 add/commit 上暴露（不静默放行）
  git -C "$d" config user.email "fixture@example.invalid"
  git -C "$d" config user.name "fixture"
  git -C "$d" config commit.gpgsign false
  git -C "$d" config core.hooksPath "$TMPD/nohooks"
  printf 'seed\n' > "$d/seed.txt"
  git -C "$d" add -A >/dev/null 2>&1
  git -C "$d" commit -q -m "seed" >/dev/null 2>&1
  echo "$d"
}
commit_all() {  # $1 = repo；$2 = 提交信息
  git -C "$1" add -A >/dev/null 2>&1
  git -C "$1" commit -q -m "$2" >/dev/null 2>&1
}
head_sha() { git -C "$1" rev-parse HEAD; }

# 跑一次被测器（stdout 进 OUT、stderr 进 err.txt、rc 进 RC）
run_scan() {
  local root="$1"; shift
  OUT="$("$PYBIN" "$S" --root "$root" "$@" 2>"$TMPD/err.txt")"; RC=$?
}
err_txt() { cat "$TMPD/err.txt" 2>/dev/null || true; }  # swallow-ok: stderr 缺失时断言按"无降级"判

hash_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    cksum "$1" | awk '{print $1"-"$2}'
  fi
}

# ── T0 前置：解释器 / 被测件 / 语法 ────────────────────────────────────────
if [ -n "$PYBIN" ]; then ok "T0 python3 可用（$PYBIN）"; else no "T0 python3 不可用 —— 夹具无法判定"; fi
if [ -f "$S" ]; then ok "T0 被测脚本存在"; else no "T0 被测脚本不存在: $S"; fi
if [ -n "$PYBIN" ] && [ -f "$S" ]; then
  if "$PYBIN" -c 'import sys; p=sys.argv[1]; compile(open(p, encoding="utf-8").read(), p, "exec")' "$S" >/dev/null 2>&1; then
    ok "T0 语法可过（compile，不落 pyc）"
  else
    no "T0 语法错（compile 失败）"
  fi
else
  no "T0 无法做语法检查（前置缺失）"
fi
if [ -n "$PYBIN" ] && [ -f "$S" ]; then
  OUT="$("$PYBIN" "$S" --help 2>&1)"; RC=$?
  if [ "$RC" -eq 0 ]; then ok "T0 --help ⇒ rc=0"; else no "T0 --help 应 rc=0，实得 ${RC}"; fi
  case "$OUT" in *"--base"*) ok "T0 --help 点名 --base（用法可读）" ;; *) no "T0 --help 未点名 --base" ;; esac
else
  no "T0 无法跑 --help（前置缺失）"
fi

H_S_BEFORE="$(hash_of "$S")"

# ── T1 M-11：变量名混入西里尔 а（U+0430）⇒ A 档阻断 rc=1 ──────────────────
R1="$(new_fixture m11)"; B1="$(head_sha "$R1")"
mkdir -p "$R1/src"
printf 'export const p%sassword = "x";\n' "$CYR_A" > "$R1/src/auth.ts"
commit_all "$R1" "m11"
run_scan "$R1" --base "$B1"
if [ "$RC" -eq 1 ]; then ok "T1 M-11 西里尔 а 冒充标识符 ⇒ rc=1（A 档阻断）"; else no "T1 M-11 应 rc=1，实得 ${RC}"; fi
case "$OUT" in *"❌ [A]"*) ok "T1 命中点名 A 档" ;; *) no "T1 未点名 A 档" ;; esac
case "$OUT" in *"U+0430"*) ok "T1 命中给出码位 U+0430" ;; *) no "T1 未给出码位 U+0430" ;; esac
case "$OUT" in *"auth.ts:1"*) ok "T1 命中给出 path:line（auth.ts:1）" ;; *) no "T1 未给出 path:line" ;; esac
case "$OUT" in *"a=1"*) ok "T1 汇总口径 a=1" ;; *) no "T1 汇总口径未记 a=1" ;; esac

# ── T2 中文注释：全角标点不得判 A（禁误伤），且 D 档只提醒 rc=0 ────────────
R2="$(new_fixture zh)"; B2="$(head_sha "$R2")"
mkdir -p "$R2/src"
{
  printf '// 中文注释：全角标点%s例如%s不阻断\n' "$FW_COMMA" "$FW_LPAREN"
  printf 'export const ok = 1;\n'
} > "$R2/src/zh.ts"
commit_all "$R2" "zh comment"
run_scan "$R2" --base "$B2"
if [ "$RC" -eq 0 ]; then ok "T2 中文注释含全角标点 ⇒ rc=0（不阻断）"; else no "T2 中文注释应 rc=0，实得 ${RC}"; fi
case "$OUT" in *"❌ [A]"*) no "T2 把中文注释判成 A（误伤）" ;; *) ok "T2 中文注释未判 A（无同形字误伤）" ;; esac
case "$OUT" in *"⚠️  [D]"*) ok "T2 D 档有提醒（仅提醒）" ;; *) no "T2 D 档未提醒" ;; esac
case "$OUT" in *"zh.ts:1"*) ok "T2 D 档清单给出行号（zh.ts:1）" ;; *) no "T2 D 档清单未给行号" ;; esac
case "$OUT" in *"a=0"*) ok "T2 汇总口径 a=0" ;; *) no "T2 汇总口径未记 a=0" ;; esac

# ── T3 B 档：任意位置双向控制符 U+202E ⇒ rc=1 ─────────────────────────────
R3="$(new_fixture bidi)"; B3="$(head_sha "$R3")"
mkdir -p "$R3/src"
printf '/* x %s */\nexport const y = 2;\n' "$RLO" > "$R3/src/b.ts"
commit_all "$R3" "bidi"
run_scan "$R3" --base "$B3"
if [ "$RC" -eq 1 ]; then ok "T3 双向控制符 ⇒ rc=1（B 档阻断）"; else no "T3 B 档应 rc=1，实得 ${RC}"; fi
case "$OUT" in *"❌ [B]"*) ok "T3 命中点名 B 档" ;; *) no "T3 未点名 B 档" ;; esac
case "$OUT" in *"U+202E"*) ok "T3 命中给出码位 U+202E" ;; *) no "T3 未给出码位 U+202E" ;; esac

# ── T4 C 档：U+FFFD 替换字符 ⇒ rc=1 ────────────────────────────────────────
R4="$(new_fixture fffd)"; B4="$(head_sha "$R4")"
mkdir -p "$R4/src"
printf 'export const z = 3; %s\n' "$FFFD" > "$R4/src/c.ts"
commit_all "$R4" "fffd"
run_scan "$R4" --base "$B4"
if [ "$RC" -eq 1 ]; then ok "T4 U+FFFD ⇒ rc=1（C 档阻断）"; else no "T4 C 档应 rc=1，实得 ${RC}"; fi
case "$OUT" in *"❌ [C]"*) ok "T4 命中点名 C 档" ;; *) no "T4 未点名 C 档" ;; esac
case "$OUT" in *"U+FFFD"*) ok "T4 命中给出码位 U+FFFD" ;; *) no "T4 未给出码位 U+FFFD" ;; esac

# ── T5 C 档解码边界：一行含非 UTF-8 字节（0xFF）⇒ 判红 rc=1（不归 0、不归 2）──
R5="$(new_fixture bytes)"; B5="$(head_sha "$R5")"
mkdir -p "$R5/src"
printf 'export const bad = 4;\xff\n' > "$R5/src/inv.ts"
commit_all "$R5" "invalid utf8"
run_scan "$R5" --base "$B5"
if [ "$RC" -eq 1 ]; then ok "T5 非 UTF-8 字节 ⇒ rc=1（C 档；禁 cp1252 猜编码）"; else no "T5 非 UTF-8 字节应 rc=1，实得 ${RC}"; fi
case "$OUT" in *"byte 0xFF"*) ok "T5 点名坏字节 byte 0xFF" ;; *) no "T5 未点名坏字节" ;; esac
case "$OUT" in *"c=1"*) ok "T5 汇总口径 c=1" ;; *) no "T5 汇总口径未记 c=1" ;; esac

# ── T6 范围：存量含同形字，但 diff 只新增干净行 ⇒ rc=0（绝不判存量）────────
R6="$(new_fixture legacy-a)"; 
mkdir -p "$R6/src"
printf 'export const p%sst = 1;\n' "$CYR_A" > "$R6/src/old.ts"
commit_all "$R6" "legacy homoglyph in base"
B6="$(head_sha "$R6")"
printf 'export const clean = 2;\n' > "$R6/src/old.ts"
commit_all "$R6" "clean rewrite"
run_scan "$R6" --base "$B6"
if [ "$RC" -eq 0 ]; then ok "T6 存量同形字不在 diff 内 ⇒ rc=0（范围=新增行）"; else no "T6 误判存量 ⇒ rc=${RC}" ; fi
case "$OUT" in *"a=0"*) ok "T6 汇总口径 a=0（未把存量算新增）" ;; *) no "T6 汇总口径 a≠0（把存量算成新增）" ;; esac

# ── T7 M-12：仅存量含全角标点 ⇒ 不阻断；--list-legacy 列遗留清单 ──────────
R7="$(new_fixture legacy-d)"
mkdir -p "$R7/src"
printf '// 存量全角标点%s不阻断\n' "$FW_COMMA" > "$R7/src/legacy.ts"
commit_all "$R7" "legacy fullwidth in base"
B7="$(head_sha "$R7")"
printf 'export const n = 1;\n' > "$R7/src/new.ts"
commit_all "$R7" "clean diff"
run_scan "$R7" --base "$B7"
if [ "$RC" -eq 0 ]; then ok "T7 M-12 仅存量含全角、diff 干净 ⇒ rc=0（不阻断）"; else no "T7 M-12 应 rc=0，实得 ${RC}"; fi
case "$OUT" in *"legacy.ts"*) no "T7 未加 --list-legacy 却输出存量条目（范围越界）" ;; *) ok "T7 未加 --list-legacy 时零存量输出（范围=diff）" ;; esac
run_scan "$R7" --base "$B7" --list-legacy
if [ "$RC" -eq 0 ]; then ok "T7 --list-legacy 仍 rc=0（清单不判红）"; else no "T7 --list-legacy 应 rc=0，实得 ${RC}"; fi
case "$OUT" in *"存量遗留清单"*) ok "T7 --list-legacy 打出遗留清单段" ;; *) no "T7 缺遗留清单段" ;; esac
case "$OUT" in *"legacy.ts"*) ok "T7 遗留清单点名 legacy.ts" ;; *) no "T7 遗留清单未点名 legacy.ts" ;; esac

# ── T8 空变更集 ⇒ rc=0 ＋ SKIP（SKIP 不是 PASS）───────────────────────────
R8="$(new_fixture empty)"; B8="$(head_sha "$R8")"
run_scan "$R8" --base "$B8"
if [ "$RC" -eq 0 ]; then ok "T8 空变更集 ⇒ rc=0"; else no "T8 空变更集应 rc=0，实得 ${RC}"; fi
case "$OUT" in *"SKIP"*) ok "T8 汇总口径 SKIP（不冒充 PASS）" ;; *) no "T8 汇总口径未降为 SKIP" ;; esac
case "$OUT" in *"无判据对象"*) ok "T8 显式说明无判据对象" ;; *) no "T8 未说明无判据对象" ;; esac

# ── T9 判不了①：坏 base ⇒ rc=2 ＋ degraded（绝不归 0）────────────────────
R9="$(new_fixture badbase)"
run_scan "$R9" --base "no-such-ref-deadbeef"
E9="$(err_txt)"
if [ "$RC" -eq 2 ]; then ok "T9 坏 base ⇒ rc=2（判不了）"; else no "T9 坏 base 应 rc=2，实得 ${RC}"; fi
case "$E9" in *"degraded: E_BAD_BASE"*) ok "T9 stderr 点名 E_BAD_BASE" ;; *) no "T9 stderr 未点名 E_BAD_BASE" ;; esac

# ── T10 判不了②：非 git 目录 ⇒ rc=2 ──────────────────────────────────────
mkdir -p "$TMPD/notrepo"
run_scan "$TMPD/notrepo"
E10="$(err_txt)"
if [ "$RC" -eq 2 ]; then ok "T10 非 git 目录 ⇒ rc=2"; else no "T10 非 git 目录应 rc=2，实得 ${RC}"; fi
case "$E10" in *"degraded: E_GIT"*) ok "T10 stderr 点名 E_GIT" ;; *) no "T10 stderr 未点名 E_GIT" ;; esac

# ── T11 判不了③：参数互斥 / 未知参数 ⇒ rc=2（E_USAGE）──────────────────
run_scan "$R9" --base HEAD --staged
if [ "$RC" -eq 2 ]; then ok "T11 --base 与 --staged 互斥 ⇒ rc=2"; else no "T11 参数互斥应 rc=2，实得 ${RC}"; fi
case "$(err_txt)" in *"E_USAGE"*) ok "T11 stderr 点名 E_USAGE" ;; *) no "T11 stderr 未点名 E_USAGE" ;; esac
run_scan "$R9" --nonsense-flag
if [ "$RC" -eq 2 ]; then ok "T11 未知参数 ⇒ rc=2"; else no "T11 未知参数应 rc=2，实得 ${RC}"; fi

# ── T12 pre-commit 模式：无 --base ⇒ git diff --cached ───────────────────
R12="$(new_fixture staged)"
mkdir -p "$R12/src"
printf 'export const q%sss = 1;\n' "$CYR_A" > "$R12/src/st.ts"
git -C "$R12" add -A >/dev/null 2>&1
run_scan "$R12" --staged
if [ "$RC" -eq 1 ]; then ok "T12 --staged 抓到暂存的 A 档 ⇒ rc=1"; else no "T12 --staged 应 rc=1，实得 ${RC}"; fi
case "$OUT" in *"git diff --cached"*) ok "T12 范围口径点名 --cached（pre-commit 用）" ;; *) no "T12 范围口径未点名 --cached" ;; esac

# ── T13 --json：stdout 仅一份合法 JSON，字段可机读 ───────────────────────
R13="$(new_fixture json)"; B13="$(head_sha "$R13")"
mkdir -p "$R13/src"
printf 'export const p%sass = 1;\n' "$CYR_A" > "$R13/src/j.ts"
commit_all "$R13" "json"
run_scan "$R13" --base "$B13" --json
if [ "$RC" -eq 1 ]; then ok "T13 --json 下 rc 仍为 1（JSON 不改判定）"; else no "T13 --json 应 rc=1，实得 ${RC}"; fi
printf '%s' "$OUT" > "$TMPD/json.out"
if "$PYBIN" - "$TMPD/json.out" <<'PYEOF' >/dev/null 2>&1
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    data = json.load(fh)
assert data["verdict"] == "VIOLATION", data.get("verdict")
assert data["exit"] == 1
assert data["findings"] and data["findings"][0]["class"] == "A"
assert data["findings"][0]["codepoint"] == "U+0430"
assert "advisory" in data and data["advisory"]["class"] == "D"
PYEOF
then
  ok "T13 --json 为合法 JSON 且字段齐（verdict/findings/advisory）"
else
  no "T13 --json 非法或缺字段"
fi

# ── T14 --selfcheck：内置判别力自检必须过 ────────────────────────────────
OUT="$("$PYBIN" "$S" --selfcheck 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "T14 --selfcheck ⇒ rc=0"; else no "T14 --selfcheck 应 rc=0，实得 ${RC}"; fi
case "$OUT" in *"UNICODE-CONFUSABLE-SELFCHECK: PASS cases=6"*) ok "T14 自检 6 夹具全过" ;; *) no "T14 自检夹具数/结论不符" ;; esac
case "$OUT" in *"M-12-legacy-not-blocking"*) ok "T14 自检覆盖 M-12（存量不阻断）" ;; *) no "T14 自检未覆盖 M-12" ;; esac

# ── T15 改坏即红：把 A 档判据改成恒假 ⇒ M-11 夹具不再判红 ────────────────
MUT="$TMPD/mut.py"
sed 's/look = HOMOGLYPH.get(ch) or _nfkc_lookalike(ch)/look = None/' "$S" > "$MUT"
if cmp -s "$S" "$MUT"; then
  no "T15 改坏即红：sed 未命中 A 档判据行（判据位置变了 ⇒ 本用例需同步）"
else
  OUT="$("$PYBIN" "$MUT" --root "$R1" --base "$B1" 2>&1)"; MUT_RC=$?
  if [ "$MUT_RC" -eq 0 ]; then
    ok "T15 改坏即红：A 档判据恒假 ⇒ M-11 不再判红（rc 1→0，原断言失效）"
  else
    no "T15 改坏即红：改坏后仍 rc=${MUT_RC} ⇒ A 档判据不承重（或在别处兜底）"
  fi
  case "$OUT" in *"❌ [A]"*) no "T15 改坏版仍报 A（兜底掩盖了判据失效）" ;; *) ok "T15 改坏版不再报 A（判据单点承重）" ;; esac
  # 原脚本必须仍判红（改坏只发生在副本上）
  run_scan "$R1" --base "$B1"
  if [ "$RC" -eq 1 ]; then ok "T15 真脚本未受影响（仍 rc=1）"; else no "T15 真脚本被改写！实得 rc=${RC}"; fi
fi

# ── T16 记账一致：WIRING 的 status 与"是否真接线"必须自洽（禁假装已接线）──
if [ -f "$WR" ]; then ok "T16 WIRING-REGISTRY 在场"; else no "T16 WIRING-REGISTRY 缺失"; fi
ST="$(grep -A6 'capability: gate.unicodeConfusable' "$WR" 2>/dev/null | grep -m1 'status:' | sed 's/.*status:[[:space:]]*//' | tr -d '[:space:]')"  # swallow-ok: 取不到 status 时 ST 为空 ⇒ 下方直接判红
case "${ST:-}" in
  wired)
    N_PC="$(grep -c 'check-unicode-confusable' "$PC" 2>/dev/null || true)"  # swallow-ok: 读不到 ⇒ 0 ⇒ 判红（不静默）
    N_WF="$(grep -c 'check-unicode-confusable' "$WF" 2>/dev/null || true)"  # swallow-ok: 同上
    if [ "${N_PC:-0}" -ge 1 ] && [ "${N_WF:-0}" -ge 1 ]; then
      ok "T16 status=wired 且 pre-commit/CI 均有调用（${N_PC}/${N_WF}）"
    else
      no "T16 status=wired 但接线缺失（pre-commit=${N_PC:-0} CI=${N_WF:-0}）"
    fi
    ;;
  declared-only)
    N_PC="$(grep -c 'check-unicode-confusable' "$PC" 2>/dev/null || true)"  # swallow-ok: 读不到 ⇒ 0（与 declared-only 自洽）
    N_WF="$(grep -c 'check-unicode-confusable' "$WF" 2>/dev/null || true)"  # swallow-ok: 同上
    if [ "${N_PC:-0}" -eq 0 ] && [ "${N_WF:-0}" -eq 0 ]; then
      ok "T16 status=declared-only 且零接线（如实记账，未假装接线）"
    else
      no "T16 status=declared-only 却有接线（pre-commit=${N_PC:-0} CI=${N_WF:-0}）"
    fi
    ok "T16 本批接线状态 = declared-only（等待 W1/#1090、W5/#1088 合入后接线）"
    ;;
  *)
    no "T16 WIRING 未登记 gate.unicodeConfusable 或 status 非 {wired,declared-only}（实得 '${ST:-}'）"
    ;;
esac
case "$(grep -A6 'capability: gate.unicodeConfusable' "$WR" 2>/dev/null)" in  # swallow-ok: 无匹配 ⇒ 上一断言已判红
  *"check-unicode-confusable.py:1"*) ok "T16 defined_at 指向新脚本 :1" ;;
  *) no "T16 defined_at 未指向新脚本 :1" ;;
esac

# ── T17 自身约束：UTF-8（禁 cp1252）／纯 LF／禁 `$VAR（` 全角边界 ─────────
# 注：三项都只看**非注释行**（注释里可以讲这几条规则本身，不算违规）
N_CP="$(grep -hv '^[[:space:]]*#' "$S" 2>/dev/null | grep -c 'cp1252' || true)"  # swallow-ok: 无匹配即 rc=1、输出 0；脚本存在性已在 T0 判
if [ "${N_CP:-0}" -eq 0 ]; then ok "T17 脚本代码面无 cp1252 回退（禁猜编码）"; else no "T17 脚本代码面出现 cp1252"; fi
N_SUR="$(grep -c 'surrogateescape' "$S" 2>/dev/null || true)"  # swallow-ok: 同上
if [ "${N_SUR:-0}" -ge 1 ]; then ok "T17 显式 surrogateescape（结构保留 ＋ 逐行验 UTF-8）"; else no "T17 缺 surrogateescape 解码路径"; fi
N_CR_S="$(tr -cd '\r' < "$S" 2>/dev/null | wc -c | tr -d ' ')"  # swallow-ok: 读不到 ⇒ 0 ⇒ 断言放行（T0 已判存在性）
N_CR_T="$(tr -cd '\r' < "$0" 2>/dev/null | wc -c | tr -d ' ')"  # swallow-ok: 同上
if [ "${N_CR_S:-0}" -eq 0 ] && [ "${N_CR_T:-0}" -eq 0 ]; then
  ok "T17 脚本与测试均为纯 LF（CR 字符数 0）"
else
  no "T17 出现 CR（脚本 ${N_CR_S:-0} 个 / 测试 ${N_CR_T:-0} 个）"
fi
N_FWB="$({ grep -hv '^[[:space:]]*#' "$S"; grep -hv '^[[:space:]]*#' "$0"; } 2>/dev/null | grep -hE '\$[A-Za-z_][A-Za-z0-9_]*（' | wc -l | tr -d ' ')"  # swallow-ok: 无匹配 ⇒ 0 ⇒ 断言放行
if [ "${N_FWB:-0}" -eq 0 ]; then ok "T17 代码面无「美元变量名紧接全角括号」边界（D738 教训）"; else no "T17 出现「美元变量名紧接全角括号」边界"; fi

# ── T18 沙箱隔离：真脚本跑前跑后哈希一致（型 D 防误伤）──────────────────
H_S_AFTER="$(hash_of "$S")"
if [ "$H_S_BEFORE" = "$H_S_AFTER" ]; then ok "T18 真脚本零改动（${H_S_BEFORE}）"; else no "T18 真脚本被改写！${H_S_BEFORE} -> ${H_S_AFTER}"; fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && echo "  Status: ✅ check-unicode-confusable 配对测试通过" || echo "  Status: ❌ check-unicode-confusable 配对测试未通过"
if [ "$FAIL" -gt 0 ]; then
  echo "❌ FAILED(${FAIL}): ${FAILED_DIGEST}"
fi
exit "$FAIL"
