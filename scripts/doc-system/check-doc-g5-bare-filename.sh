#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（与 scripts/doc-system/ 同域脚本一致）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-g5-bare-filename.sh — G-DOC-5 §七 裸文件名检查（#1148 B3 批）
#
# @nature: mechanical — 纯机械判定（正则取 span ＋ 计数 ＋ 基线比对；不调 LLM、不做语义推断），
#   同一输入必得同一输出（可复现）。
#
# 设计哲学（一句）: **引用必须可定位** —— 文档里只写 `AGENTS.md` 而不给目录，读者无从
#   知道是哪一个 AGENTS.md；本器只把"反引号 inline span 内**整串**是带已知扩展名的
#   文件名、且**不含 `/`**"判为裸名，其余一律放行（不猜语义、不猜上下文、不猜意图）。
#
# 契约（铁律 47 契约优先）:
#   @input  — <root>（默认 `git rev-parse --show-toplevel`；取不到 ⇒ exit 2）
#             ＋ 扫描面 `git -C <root> ls-files '*.md'`（**基线文件自身排除**，禁自指）
#             ＋ 可选基线件（默认 <root>/gate-exemptions/2026-10-30-b3-docgate2.md；
#               `<!-- G-DOC-5-BASELINE:BEGIN -->` … `<!-- G-DOC-5-BASELINE:END -->` 块内
#               每行 `<path><TAB><count>` = 该文件允许的存量命中数）
#             ＋ 环境 SYNO_GATE_DEGRADED_LOG
#               （默认 <root>/.codex/control-tower/logs/degraded-events.log）
#   @output — 逐条新增 `❌ <path>:<line> 裸文件名: <name>（基线 <k>／本次 <m>）`
#             ＋ 收紧提示 `ℹ️ 基线可收紧: <path>（基线 <k>／本次 <m>）`
#             ＋ 无基线提示 `ℹ️ 无基线…`
#             ＋ 末行机器行 `G-DOC-5: OK（文档 <n>／存量命中 <stock> → 新增 0）`
#               ｜ `G-DOC-5: VIOLATION <m>（文档 <n>／存量命中 <stock> → 新增 <m>）`
#               ｜ `G-DOC-5: DEGRADED <CODE>`
#   @exit   — 0 = 无新增裸名（存量全在基线内）｜ 1 = 有新增裸名 ｜ 2 = 判不了
#             🔴 三态铁律：扫描文档数==0 ⇒ exit 2（信号量==0 禁当通过）；判不了绝不返回 0
#   @degraded — stderr 一行 `degraded: <CODE> — <原因>` ＋ 追加一行 JSON 到
#               SYNO_GATE_DEGRADED_LOG（字段 time/component/code/phase/retryable；
#               铁律 11/31/32，禁静默降级）
#   @error  — code ∈ {E_USAGE, E_NOT_REPO, E_NO_PYTHON, E_BASELINE_MISSING,
#                     E_UNREADABLE, E_EMPTY, E_INTERNAL}
#
# 判据（G-DOC-5 §七，逐条可 grep）:
#   逐行取反引号 inline span，其内容**整串**匹配
#   `^[A-Za-z0-9_.\-\u4e00-\u9fff]+\.(md|sh|py|ts|tsx|js|json|ya?ml)$` ⇒ 裸文件名；
#   含 `/` 的写法（如 `agents/P4-门禁/AGENTS.md`）＝绿。
#   棘轮（只减不增）：逐文件「本次命中数 > 基线数」的**超出部分**算新增，
#   点名列该文件**最后 excess 条**（行号升序）；基线数 > 本次命中数 ⇒ 收紧提示（不判红）。
#
# 授权（explicit authority · 谁能调）:
#   · P4／治理线手跑（只读；唯一落盘 = 降级日志，.codex/ 不入库）
#   · tests/doc-system/check-doc-g5-bare-filename.test.sh（夹具经 --root/--baseline 注入）
#   本批**未接** pre-commit/CI —— 接线归载体 task，禁在本件内自带接线断言。
#
# Source map（结构表 · 段 → 职责）:
#   §A 头块/契约     — 本块（UTF-8 强制 / @input / @output / @exit / @degraded / @error）
#   §B CLI           — --root / --baseline / --no-baseline / --help；未知参数 ⇒ E_USAGE
#   §C 降级出口      — degraded()：stderr 一行 ＋ JSON 落盘 ＋ exit 2（**单一格式源**）
#   §D 环境闸        — root 存在 ／ 是 git 仓 ／ python3/python/py 三级探测（D520）
#   §E 扫描面        — git ls-files '*.md'（core.quotepath=false 保 UTF-8 文件名）
#   §F 判据核心      — python heredoc：BARE_RE（@mutate-point）＋ 基线棘轮 ＋ 汇总
#   §G 退出归一      — python rc → 三态（0 透传／1 透传／2 走降级／其它 ⇒ E_INTERNAL）
#   §H 配对测试      — tests/doc-system/check-doc-g5-bare-filename.test.sh
#
# 已知限制（Known Limitations）:
#   1. 只认**反引号 inline span**；代码围栏（```）内的裸名同样会被判（不区分围栏上下文）——
#      本批有意从严：宁可多报，不给"围栏里的裸名"开漏判口子。
#   2. 只认 8 种扩展名（md/sh/py/ts/tsx/js/json/yaml/yml）；`png`/`csv`/`txt` 等裸名不判。
#   3. span 内**整串**匹配：`` ` AGENTS.md ` ``（带空格）、`` `AGENTS.MD` ``（大小写）不判；
#      含 `/` 的写法一律绿，且**不校验该目录/文件是否真存在**（存在性另有门禁）。
#   4. 基线是**每文件计数**棘轮，不记行号：同一文件内"修一处、新增一处"净计数不变 ⇒ 不判红
#      （行号级棘轮需 history，本批不做；这点与 G-DOC-3 的逐条基线不同）。
#   5. 文件名含**换行**会被 git ls-files 按行拆开 ⇒ 该情形判不准（本批不做 NUL 分隔）。
#   6. 非 UTF-8 编码的 .md 直接 E_UNREADABLE（判不了），不做编码猜测。
#   7. `--root` 指向子目录时路径按该子目录呈相对（git 语义），不做仓库根归一。
# ═══════════════════════════════════════════════════════════════════════════════
set +e

# ── §B CLI ───────────────────────────────────────────────────────────────────
usage() { awk 'NR>1 && /^set /{exit} NR>1' "$0"; }

ROOT_ARG=""; BASELINE_ARG=""; NO_BASELINE=0; USAGE_ERR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      ROOT_ARG="${2:-}"
      if [ $# -ge 2 ] && [ -n "$ROOT_ARG" ]; then shift 2; else USAGE_ERR="${USAGE_ERR:-"--root 需要一个目录参数"}"; shift; fi ;;
    --baseline)
      BASELINE_ARG="${2:-}"
      if [ $# -ge 2 ] && [ -n "$BASELINE_ARG" ]; then shift 2; else USAGE_ERR="${USAGE_ERR:-"--baseline 需要一个文件参数"}"; shift; fi ;;
    --no-baseline) NO_BASELINE=1; BASELINE_ARG=""; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             USAGE_ERR="${USAGE_ERR:-"未知参数: $1（见 --help）"}"; shift ;;
  esac
done

# ── §D 环境闸（先解 root，再定降级日志落点，再定义降级出口）──────────────────
if [ -n "$ROOT_ARG" ]; then
  ROOT="$ROOT_ARG"
else
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"  # swallow-ok: 取不到由下方 E_NOT_REPO 显式 exit 2
fi
DEG_LOG="${SYNO_GATE_DEGRADED_LOG:-${ROOT:-$PWD}/.codex/control-tower/logs/degraded-events.log}"

# ── §C 降级出口（单一格式源：stderr 一行 ＋ JSON 落盘 ＋ exit 2）──────────────
degraded() { # $1=code $2=phase $3=原因 [$4=retryable]
  echo "degraded: $1 — $3" >&2
  mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null || true  # swallow-ok: 目录不可建仍有 stderr + exit 2（不静默放行）
  printf '{"time":"%s","component":"check-doc-g5-bare-filename","code":"%s","phase":"%s","retryable":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${4:-false}" >> "$DEG_LOG" 2>/dev/null || true  # swallow-ok: 日志写失败不改变判定（stderr + exit 2 已先行给出）
  echo "G-DOC-5: DEGRADED $1"
  exit 2
}

if [ -n "$USAGE_ERR" ]; then degraded E_USAGE args "$USAGE_ERR"; fi
[ -n "$ROOT" ] || degraded E_NOT_REPO root "非 git 仓库（git rev-parse --show-toplevel 取不到根，且未给 --root）"
[ -d "$ROOT" ] || degraded E_NOT_REPO root "仓库根不存在或不可进入: $ROOT"
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || degraded E_NOT_REPO root "不是 git 仓库（--root 指向的目录不在工作树内）: $ROOT"  # swallow-ok: 探测型，失败即显式 exit 2

PYBIN=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break  # swallow-ok: 探测型，全失败由下方 E_NO_PYTHON 显式 exit 2（D520）
done
[ -n "$PYBIN" ] || degraded E_NO_PYTHON python "python3/python/py 三级探测全失败（判不了）"

echo "═══ check-doc-g5-bare-filename.sh v1.0 — G-DOC-5 裸文件名检查 (root: $ROOT) ═══"

# ── 基线解析（默认件缺失 ⇒ 空基线，不豁免；显式件缺失 ⇒ 判不了）──────────────
BASELINE_DEFAULT="$ROOT/gate-exemptions/2026-10-30-b3-docgate2.md"
BASE_MODE="none"; BASE_PATH=""
if [ "$NO_BASELINE" -eq 1 ]; then
  echo "ℹ️ 无基线（--no-baseline：不做豁免，全部命中按新增计）"
elif [ -n "$BASELINE_ARG" ]; then
  [ -f "$BASELINE_ARG" ] || degraded E_BASELINE_MISSING baseline "显式指定的基线文件不存在: $BASELINE_ARG"
  BASE_MODE="explicit"; BASE_PATH="$BASELINE_ARG"
elif [ -f "$BASELINE_DEFAULT" ]; then
  BASE_MODE="default"; BASE_PATH="$BASELINE_DEFAULT"
else
  echo "ℹ️ 无基线: $BASELINE_DEFAULT 不存在（不做豁免，全部命中按新增计）"
fi

# ── §E 扫描面（git ls-files 失败 ⇒ 判不了，不当"零命中"）───────────────────────
TMPD="$(mktemp -d 2>/dev/null)"  # swallow-ok: 失败由下方 E_INTERNAL 显式 exit 2
{ [ -n "$TMPD" ] && [ -d "$TMPD" ]; } || degraded E_INTERNAL tmp "mktemp -d 失败（无法建临时目录）"
trap 'rm -rf "$TMPD"' EXIT
LISTF="$TMPD/md-files.txt"; GITERR="$TMPD/git-err.txt"; DEGCHAN="$TMPD/degraded-channel.txt"
git -c core.quotepath=false -C "$ROOT" ls-files '*.md' >"$LISTF" 2>"$GITERR"
RC=$?
[ "$RC" -eq 0 ] || degraded E_NOT_REPO scan "git ls-files 失败（rc=$RC）: $(tail -1 "$GITERR" 2>/dev/null)"  # swallow-ok: 错误详情取不到不影响 code 判定（code 已定）

# ── §F 判据核心（单进程 python；反引号 span ＋ 整串匹配 ＋ 基线棘轮）──────────
"$PYBIN" - "$ROOT" "$LISTF" "$BASE_MODE" "$BASE_PATH" "$DEGCHAN" <<'PYEOF'
import os
import re
import sys

root, list_path, base_mode, base_path, deg_chan = sys.argv[1:6]


def degrade(code, phase, msg):
    """判不了 ⇒ 交回 bash 统一出口（stderr 一行 ＋ JSON 落盘 ＋ exit 2）。

    typed error 带 code（DSH B1）：code 必须落在 @error 集内，phase 标注失败阶段。
    """
    try:
        with open(deg_chan, "w", encoding="utf-8") as f:
            f.write("%s\t%s\t%s\n" % (code, phase, " ".join(str(msg).split())))
    except OSError:
        pass  # 通道写不出 ⇒ bash 侧按 E_INTERNAL 兜底（仍 exit 2，不静默放行）
    sys.exit(2)


BARE_RE = re.compile(r"`([A-Za-z0-9_.\-\u4e00-\u9fff]+\.(?:md|sh|py|ts|tsx|js|json|ya?ml))`")  # @mutate-point: bare-name-regex

try:
    with open(list_path, encoding="utf-8", errors="replace") as f:
        files = [ln.strip() for ln in f.read().splitlines() if ln.strip()]
except OSError as e:
    degrade("E_INTERNAL", "scan", "扫描面清单不可读: %s" % e)

# 禁自指：基线件自身不入扫描面（否则基线内容会被当成文档命中）
rel_base = ""
if base_path:
    try:
        rel_base = os.path.relpath(os.path.abspath(base_path), os.path.abspath(root)).replace(os.sep, "/")
    except (ValueError, OSError):
        rel_base = ""
    if rel_base and not rel_base.startswith("../"):
        files = [p for p in files if p != rel_base]

if not files:
    degrade("E_EMPTY", "scan", "扫描面 0 份 .md（信号量==0 ⇒ 判不了，禁当通过）")

# ── 基线块解析（BEGIN/END 之间：<path><TAB><count>）───────────────────────────
baseline, in_block, saw_begin, saw_end = {}, False, False, False
if base_path:
    try:
        with open(base_path, encoding="utf-8") as f:
            blines = f.read().splitlines()
    except OSError as e:
        degrade("E_BASELINE_MISSING", "baseline", "基线不可读: %s（%s）" % (base_path, e))
    for bl in blines:
        s = bl.strip()
        if s.startswith("<!--") and "G-DOC-5-BASELINE:BEGIN" in s:
            in_block = True
            saw_begin = True
            continue
        if s.startswith("<!--") and "G-DOC-5-BASELINE:END" in s:
            in_block = False
            saw_end = True
            continue
        if not in_block or not s or s.startswith("#"):
            continue
        parts = bl.split("\t")
        if len(parts) != 2 or not re.match(r"^\d+$", parts[1].strip()):
            degrade("E_BASELINE_MISSING", "baseline", "基线行格式非法（应为 <path><TAB><count>）: %r" % bl)
        baseline[parts[0].strip()] = baseline.get(parts[0].strip(), 0) + int(parts[1].strip())
    if saw_begin and not saw_end:
        degrade("E_BASELINE_MISSING", "baseline", "基线块缺 END 标记（判不了）: %s" % base_path)
    if not saw_begin:
        print("ℹ️ 基线无 G-DOC-5 段（按空基线处理）: %s" % base_path)

# ── 逐份扫描（不可读 ⇒ 判不了，不跳过）───────────────────────────────────────
hits = {}
docs = 0
for rel in files:
    abs_p = os.path.join(root, rel)
    try:
        with open(abs_p, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        degrade("E_UNREADABLE", "scan", "追踪文件在工作树不可读（已删？）: %s（%s）" % (rel, getattr(e, "strerror", "") or e))
    except UnicodeDecodeError:
        degrade("E_UNREADABLE", "scan", "追踪文件非 UTF-8，无法判定: %s" % rel)
    docs += 1
    for ln, line in enumerate(text.splitlines(), 1):
        for m in BARE_RE.finditer(line):
            hits.setdefault(rel, []).append((ln, m.group(1)))

# ── 基线棘轮 + 点名 ─────────────────────────────────────────────────────────
stock = sum(len(v) for v in hits.values())
new_rows = []
new_total = 0
for rel in sorted(hits):
    cur = len(hits[rel])
    base = baseline.get(rel, 0)
    if cur <= base:
        continue
    excess = cur - base
    new_total += excess
    for ln, name in hits[rel][-excess:]:
        new_rows.append("❌ %s:%d 裸文件名: %s（基线 %d／本次 %d）" % (rel, ln, name, base, cur))

for row in new_rows:
    print(row)
for rel in sorted(baseline):
    base = baseline[rel]
    cur = len(hits.get(rel, ()))
    if base > cur:
        print("ℹ️ 基线可收紧: %s（基线 %d／本次 %d）" % (rel, base, cur))

if new_total:
    print("G-DOC-5: VIOLATION %d（文档 %d／存量命中 %d → 新增 %d）" % (new_total, docs, stock, new_total))
    sys.exit(1)
print("G-DOC-5: OK（文档 %d／存量命中 %d → 新增 0）" % (docs, stock))
sys.exit(0)
PYEOF
RC=$?

# ── §G 退出归一（0/1 透传；2 走降级出口；其它码一律 E_INTERNAL）─────────────
case "$RC" in
  0) exit 0 ;;
  1) exit 1 ;;
  2)
    CODE=""; PHASE=""; MSG=""
    if [ -s "$DEGCHAN" ]; then
      IFS=$'\t' read -r CODE PHASE MSG < "$DEGCHAN" || true  # swallow-ok: 读失败由下一行兜底 E_INTERNAL
    fi
    [ -n "$CODE" ] || { CODE="E_INTERNAL"; PHASE="python"; MSG="判据进程以 2 退出但未留降级码"; }
    degraded "$CODE" "${PHASE:-python}" "${MSG:-判不了}"
    ;;
  *) degraded E_INTERNAL python "判据进程异常退出（rc=$RC；既非 0/1/2，禁当通过）" ;;
esac
exit 2  # 防御：不可达（上分支均已 exit）
