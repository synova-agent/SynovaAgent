#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-g5-bare-filename.test.sh — G-DOC-5 §七 裸文件名检查器的**配对测试**
#   （#1148 B3 批；被测件: scripts/doc-system/check-doc-g5-bare-filename.sh）
#
# 覆盖矩阵（逐条对应派单验收项）:
#   0 语法        — bash -n（被测件不能带语法错误出场）
#   1 正常        — 只写带路径引用 `agents/P4-门禁/AGENTS.md` ⇒ exit 0 ＋ `G-DOC-5: OK（文档 1／存量命中 0 → 新增 0）`
#   2 判据两态    — 裸 `AGENTS.md` ⇒ exit 1 ＋ 点名 `doc.md:3`（基线 0／本次 1）；改成带路径 ⇒ exit 0
#   3 多文件/多行 — 2 份文档 4 条裸名：逐条点名、行号正确、`文档 2／存量命中 4`
#   4 基线棘轮    — 存量入基线（`doc.md<TAB>1`）⇒ OK 且 `存量命中 1 → 新增 0`；
#                   再新增 1 条 ⇒ exit 1 只点新增；基线 3 > 本次 1 ⇒ 只提示收紧不判红；
#                   `--no-baseline` ⇒ 默认基线不再豁免（防「有基线文件=自动全绿」）
#                   ＋ 禁自指：基线件自身不入扫描面（文档数=1 而非 2）
#   5 三态        — 非 git 仓 ⇒ 2（E_NOT_REPO）／扫描面 0 份 .md ⇒ 2（E_EMPTY）／
#                   追踪文件在工作树被删 ⇒ 2（E_UNREADABLE）＋ 降级 JSON 五字段（json.loads 校验）
#   6 改坏即红    — 复制被测件、sed 把变异靶整行改成永不匹配 ⇒ **裸名夹具必须逃逸为 exit 0**；
#                   若变异体仍 exit 1 ⇒ 本测试判红（监听点失效）
#   7 CLI 边界    — --help ⇒ 0；未知参数 ⇒ 2（E_USAGE）；显式 --baseline 不存在 ⇒ 2（E_BASELINE_MISSING）；
#                   默认 root（不传 --root ＝ git rev-parse --show-toplevel）与 --root 同判（含取不到根 ⇒ 2）
#   （8 生产接线：本批**不接** pre-commit/CI，故**不写**接线断言 —— 派单明确要求）
#
# 沙箱与环境隔离:
#   全部夹具在 mktemp -d 内（真仓只读，零写入）；git commit 固定日期 ⇒ 夹具确定；
#   SYNO_GATE_DEGRADED_LOG 指向夹具内文件 ⇒ 真实仓 `.codex/` 不落盘（AGENTS 8.1 ② 环境隔离）。
# 依赖: bash ＋ git（夹具仓库）＋ python（被测件本身要求；三级探测失败 ⇒ 本测试报红，不 SKIP）。
# 运行: bash tests/doc-system/check-doc-g5-bare-filename.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
S="$REPO/scripts/doc-system/check-doc-g5-bare-filename.sh"
PASS=0; FAIL=0

ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
t()  { if [ "$2" = "$3" ]; then ok "$1 (=$3)"; else no "$1 (期望 $2 实际 $3)"; fi; }

has() { # $1=标签 $2=期望包含的固定串（$OUT 内）
  if printf '%s' "$OUT" | grep -qF "$2"; then ok "$1"; else no "$1 —— 期望包含【$2】，实际输出: $OUT"; fi
}

echo "═══ G-DOC-5 裸文件名检查器配对测试（#1148 B3）═══"

# ── 前置（缺件/缺工具 = 判不了，不 SKIP 冒充通过）──────────────────────────
[ -f "$S" ] || { echo "  ❌ 被测执行体缺失: $S"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "  ❌ git 不可用 —— 夹具无法搭建（判不了，不是通过）"; exit 1; }
PYBIN=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break  # swallow-ok: 探测型，全失败由下一行显式判红
done
[ -n "$PYBIN" ] || { echo "  ❌ python 三级探测全失败（被测件要求 python，E_NO_PYTHON）—— 判不了，不是通过"; exit 1; }

TMPD="$(mktemp -d)"  # swallow-ok: 失败由下一行显式判红
[ -n "$TMPD" ] && [ -d "$TMPD" ] || { echo "  ❌ mktemp -d 失败 —— 无法建沙箱"; exit 1; }
trap 'rm -rf "$TMPD"' EXIT
export SYNO_GATE_DEGRADED_LOG="$TMPD/degraded.log"   # 环境隔离：真实仓 .codex/ 不落盘
unset DOC_TRUTH_ROOT SYNO_P0_FLOOR SYNO_CI

# ── 夹具工厂 ────────────────────────────────────────────────────────────────
mk_repo() { # $1=夹具根
  mkdir -p "$1" || { echo "  ❌ 夹具目录建不出: $1"; FAIL=$((FAIL + 1)); return 1; }
  ( cd "$1" && git init -q . && git config user.email t@t.local && git config user.name t \
    && git config commit.gpgsign false ) >/dev/null 2>&1 \
    || { echo "  ❌ git init 失败: $1"; FAIL=$((FAIL + 1)); return 1; }
  return 0
}
commit_all() { # $1=夹具根（固定日期 ⇒ 夹具确定）
  ( cd "$1" && git add -A && GIT_AUTHOR_DATE="2026-01-01T00:00:00+0000" \
    GIT_COMMITTER_DATE="2026-01-01T00:00:00+0000" git commit -qm fixture ) >/dev/null 2>&1
}
run_s() { # $1=夹具根；其余=参数 → OUT/RC（CR 已剥，防 CRLF 干扰精确比较）
  OUT="$(bash "$S" --root "$1" "${@:2}" 2>&1)"; RC=$?
  OUT="$(printf '%s' "$OUT" | tr -d '\r')"
}
bad_rows() { printf '%s\n' "$OUT" | grep -c '裸文件名:'; }

# ── 0 语法 ──────────────────────────────────────────────────────────────────
echo "── 0 语法 ──"
bash -n "$S"; t "0.1 bash -n 被测件 ⇒ 0" 0 "$?"

# ── 1 正常: 带路径引用 ⇒ 绿 ─────────────────────────────────────────────────
echo "── 1 正常（带路径引用）──"
D="$TMPD/t1"; mk_repo "$D"
mkdir -p "$D/agents/P4-门禁"
printf '# doc\n\n见 `agents/P4-门禁/AGENTS.md` 与 `scripts/x.sh`。\n' > "$D/doc.md"
commit_all "$D"
run_s "$D"
t "1.1 带路径引用 ⇒ exit 0" 0 "$RC"
has "1.2 机器行两数为 0 → 0（文档 1）" "G-DOC-5: OK（文档 1／存量命中 0 → 新增 0）"
if [ "$(bad_rows)" -eq 0 ]; then ok "1.3 零 ❌ 行"; else no "1.3 出现 ❌ 行: $OUT"; fi

# ── 2 判据两态: 裸名 ⇒ 红；修好 ⇒ 绿 ────────────────────────────────────────
echo "── 2 判据两态（裸名 / 带路径）──"
D="$TMPD/t2"; mk_repo "$D"
printf '# doc\n\n见 `AGENTS.md`。\n' > "$D/doc.md"
commit_all "$D"
run_s "$D"
t '2.1 裸 `AGENTS.md` ⇒ exit 1' 1 "$RC"
has "2.2 点名 doc.md:3 ＋ 基线/本次两数" "❌ doc.md:3 裸文件名: AGENTS.md（基线 0／本次 1）"
has "2.3 汇总为 VIOLATION 1（文档 1／存量命中 1 → 新增 1）" "G-DOC-5: VIOLATION 1（文档 1／存量命中 1 → 新增 1）"
printf '# doc\n\n见 `agents/P4-门禁/AGENTS.md`。\n' > "$D/doc.md"
commit_all "$D"
run_s "$D"
t "2.4 改成带路径 ⇒ exit 0" 0 "$RC"
has "2.5 机器行 G-DOC-5: OK" "G-DOC-5: OK（文档 1／存量命中 0 → 新增 0）"

# ── 3 多文件/多行 ───────────────────────────────────────────────────────────
echo "── 3 多文件/多行 ──"
D="$TMPD/t3"; mk_repo "$D"; mkdir -p "$D/docs"
printf '# a\n\n`README.md`\n\n`package.json` 和 `yaml.yml`\n' > "$D/a.md"
printf '# b\n\nx\n`SKILL.md`\n' > "$D/docs/b.md"
commit_all "$D"
run_s "$D"
t "3.1 多文件多裸名 ⇒ exit 1" 1 "$RC"
t "3.2 ❌ 行数 = 4" 4 "$(bad_rows)"
has "3.3 a.md:3 / README.md" "❌ a.md:3 裸文件名: README.md"
has "3.4 a.md:5 / package.json" "❌ a.md:5 裸文件名: package.json"
has "3.5 a.md:5 同一行第二个 span / yaml.yml" "❌ a.md:5 裸文件名: yaml.yml"
has "3.6 docs/b.md:4 / SKILL.md（行号按各自文件）" "❌ docs/b.md:4 裸文件名: SKILL.md"
has "3.7 汇总文档数=2 命中=4" "（文档 2／存量命中 4 → 新增 4）"

# ── 4 基线棘轮（只减不增）──────────────────────────────────────────────────
echo "── 4 基线棘轮 ──"
D="$TMPD/t4"; mk_repo "$D"
printf '# doc\n\n`AGENTS.md`\n' > "$D/doc.md"
mkdir -p "$D/gate-exemptions"
{ echo '# 夹具基线'; echo '<!-- G-DOC-5-BASELINE:BEGIN -->'; printf 'doc.md\t1\n'; echo '<!-- G-DOC-5-BASELINE:END -->'; } \
  > "$D/gate-exemptions/2026-10-30-b3-docgate2.md"
commit_all "$D"
run_s "$D"
t "4.1 存量入默认基线 ⇒ exit 0" 0 "$RC"
has "4.2 存量命中 1 → 新增 0（且基线件禁自指 ⇒ 文档=1 而非 2）" "G-DOC-5: OK（文档 1／存量命中 1 → 新增 0）"
printf '# doc\n\n`AGENTS.md`\n\n`SKILL.md`\n' > "$D/doc.md"
commit_all "$D"
run_s "$D"
t "4.3 再新增 1 条裸名 ⇒ exit 1" 1 "$RC"
t "4.4 只点新增（❌ 行数 = 1）" 1 "$(bad_rows)"
has "4.5 点名新增行 doc.md:5（基线 1／本次 2）" "❌ doc.md:5 裸文件名: SKILL.md（基线 1／本次 2）"
D="$TMPD/t4b"; mk_repo "$D"
printf '# doc\n\n`AGENTS.md`\n' > "$D/doc.md"
mkdir -p "$D/gate-exemptions"
{ echo '<!-- G-DOC-5-BASELINE:BEGIN -->'; printf 'doc.md\t3\n'; echo '<!-- G-DOC-5-BASELINE:END -->'; } \
  > "$D/gate-exemptions/2026-10-30-b3-docgate2.md"
commit_all "$D"
run_s "$D"
t "4.6 基线 3 > 本次 1 ⇒ exit 0（只提示收紧，不判红）" 0 "$RC"
has "4.7 收紧提示点名 doc.md" "ℹ️ 基线可收紧: doc.md（基线 3／本次 1）"
run_s "$D" --no-baseline
t "4.8 --no-baseline ⇒ 默认基线不再豁免（存量重算为新增）" 1 "$RC"
has "4.9 --no-baseline 提示可见" "ℹ️ 无基线（--no-baseline"

# ── 5 三态（判不了 ≠ 通过）─────────────────────────────────────────────────
echo "── 5 三态 ──"
D="$TMPD/t5a"; mkdir -p "$D"; printf '# doc\n\n`AGENTS.md`\n' > "$D/doc.md"
if git -C "$D" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  no "5.0 非 git 夹具不成立（mktemp 目录落在某个工作树内 —— 环境异常，请换 TMPDIR）"
else
  ok "5.0 非 git 夹具成立（mktemp 目录不在任何工作树内）"
  run_s "$D"
  t "5.1 非 git 仓 ⇒ exit 2" 2 "$RC"
  has "5.1b stderr 带 code（E_NOT_REPO）" "degraded: E_NOT_REPO —"
  # 5.1c/5.1d 默认 root 路径（不传 --root）：取不到根也必须 2，且点名非空原因
  ( cd "$D" && bash "$S" > "$TMPD/nogit-default.out" 2>&1 ); DRC=$?
  t "5.1c 默认 root（非 git 仓，取不到根）⇒ exit 2" 2 "$DRC"
  if grep -qF "非 git 仓库" "$TMPD/nogit-default.out"; then
    ok "5.1d 默认 root 失败原因非空（不是空 root 的空消息）"
  else
    no "5.1d 默认 root 失败原因缺字: $(cat "$TMPD/nogit-default.out")"
  fi
fi
D="$TMPD/t5b"; mk_repo "$D"; printf 'x\n' > "$D/notes.txt"; commit_all "$D"
run_s "$D"
t "5.2 扫描面 0 份 .md ⇒ exit 2（信号量==0 禁当通过）" 2 "$RC"
has "5.2b 降级码 E_EMPTY" "degraded: E_EMPTY —"
D="$TMPD/t5c"; mk_repo "$D"; printf '# doc\n\n`AGENTS.md`\n' > "$D/doc.md"; commit_all "$D"; rm -f "$D/doc.md"
run_s "$D"
t "5.3 追踪文件在工作树被删 ⇒ exit 2" 2 "$RC"
has "5.3b 降级码 E_UNREADABLE" "degraded: E_UNREADABLE —"
LAST="$(grep -F '"code":"E_UNREADABLE"' "$SYNO_GATE_DEGRADED_LOG" | tail -1)"
cat > "$TMPD/jsoncheck.py" <<'PYEOF'
import json
import sys

d = json.loads(sys.stdin.read().strip())
need = {"time", "component", "code", "phase", "retryable"}
missing = sorted(need - set(d))
if missing:
    print("MISSING:" + ",".join(missing))
    sys.exit(1)
if d["component"] != "check-doc-g5-bare-filename":
    print("BAD_COMPONENT:" + str(d["component"]))
    sys.exit(1)
print("OK:" + d["code"])
PYEOF
GOT="$(printf '%s' "$LAST" | "$PYBIN" "$TMPD/jsoncheck.py" 2>/dev/null)"  # swallow-ok: 解析失败由下面 t 显式判红
t "5.4 降级 JSON 五字段齐（json.loads ＋ component/code 校验）" "OK:E_UNREADABLE" "$GOT"

# ── 6 改坏即红（变异靶 = BARE_RE 单行）─────────────────────────────────────
echo "── 6 改坏即红（变异体必须逃逸为 0）──"
MUT="$TMPD/mutant-never-match.sh"
sed 's|^BARE_RE = re.compile.*$|BARE_RE = re.compile(r"NEVER_MATCH_XYZ")|' "$S" > "$MUT"
if grep -qF 'NEVER_MATCH_XYZ' "$MUT"; then
  ok "6.1 变异靶命中（sed 已整行替换 @mutate-point: bare-name-regex）"
else
  no "6.1 变异未生效 —— 变异靶结构变了（BARE_RE 必须单独一行且带 @mutate-point 标记）"
fi
D="$TMPD/t6"; mk_repo "$D"
printf '# doc\n\n`AGENTS.md`\n' > "$D/doc.md"
commit_all "$D"
run_s "$D"
t "6.2 原脚本在裸名夹具 ⇒ exit 1（同一夹具的对照）" 1 "$RC"
OUT="$(bash "$MUT" --root "$D" 2>&1)"; MRC=$?
OUT="$(printf '%s' "$OUT" | tr -d '\r')"
t "6.3 变异体（永不匹配）⇒ exit 0（监听点真实生效）" 0 "$MRC"
has "6.4 变异体机器行 G-DOC-5: OK（逃逸复现）" "G-DOC-5: OK（文档 1／存量命中 0 → 新增 0）"

# ── 7 CLI 边界 ─────────────────────────────────────────────────────────────
echo "── 7 CLI 边界 ──"
bash "$S" --help > "$TMPD/help.out" 2>&1; HRC=$?
t "7.1 --help ⇒ exit 0" 0 "$HRC"
if grep -qF -- "--baseline" "$TMPD/help.out"; then ok "7.2 --help 列出 --baseline 契约"; else no "7.2 --help 未列出 --baseline"; fi
run_s "$TMPD/t1" --bogus
t "7.3 未知参数 ⇒ exit 2" 2 "$RC"
has "7.3b 降级码 E_USAGE" "degraded: E_USAGE —"
run_s "$TMPD/t1" --baseline "$TMPD/no-such-baseline.md"
t "7.4 显式 --baseline 不存在 ⇒ exit 2" 2 "$RC"
has "7.4b 降级码 E_BASELINE_MISSING" "degraded: E_BASELINE_MISSING —"
# 7.5 默认 root 契约（不传 --root ⇒ git rev-parse --show-toplevel）：在绿夹具内跑 ⇒ 与 --root 同判
( cd "$TMPD/t1" && bash "$S" > "$TMPD/default-root.out" 2>&1 ); DRC=$?
t "7.5 默认 root（干净夹具内）⇒ exit 0" 0 "$DRC"
if grep -qF "G-DOC-5: OK（文档 1／存量命中 0 → 新增 0）" "$TMPD/default-root.out"; then
  ok "7.5b 默认 root 取到夹具根（机器行与 --root 一致）"
else
  no "7.5b 默认 root 输出不符: $(cat "$TMPD/default-root.out")"
fi

# ── 汇总 ───────────────────────────────────────────────────────────────────
echo ""
echo "── 汇总: $PASS 通过 / $FAIL 失败 ──"
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
