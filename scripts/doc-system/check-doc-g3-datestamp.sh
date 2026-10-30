#!/usr/bin/env bash
# D313/D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-g3-datestamp.sh — G-DOC-3 §一 日期戳判据（#1148 / B3 批）
#
# @nature: mechanical
#
# 设计哲学（一句）: 文档头部声明的日期必须是"它第一次进仓库那一天"的日期——
#   判据只认 git 的物理历史（首次 add 的 %aI）与文档前 12 行的字面日期，
#   不认文件名、不认作者口述；查不到就 exit 2，绝不把"判不了"当"没问题"。
#
# 契约（铁律 47）:
#   @usage   bash scripts/doc-system/check-doc-g3-datestamp.sh [--root <dir>]
#              [--baseline <file>] [--no-baseline] [--help]
#   @input   · root = `--root`（归一到 git toplevel）或 `git rev-parse --show-toplevel`；
#            · 扫描面 = `git -C <root> ls-files -- '*.md'`（相对路径；排除基线文件自身，禁自指）；
#            · 头部日期 = 每份文档**前 12 行**中，行首（可含空白）为 `>` 的引用行，
#              或匹配 `^\s*(日期|date|更新时间|updated)\s*[:：]` 的字段行；
#              取该行第一个 `20\d{2}-\d{2}-\d{2}`，记 file:line；
#            · 首次提交 = **一次** `git log --diff-filter=A --format=__C__%aI --name-only
#              -- '*.md'`（新→老；同一路径最后一次出现 = 最早 add），取 %aI 前 10 位；
#            · 基线 = 文件内 `<!-- G-DOC-3-BASELINE:BEGIN -->` … `:END -->` 块中的
#              非空非 `#` 行（每行一个豁免路径）；默认路径
#              `<root>/gate-exemptions/2026-10-30-b3-docgate2.md`（不存在 ⇒ 空基线）；
#              `--baseline <path>` 显式指定（不存在 ⇒ E_BASELINE_MISSING）；`--no-baseline` 置空。
#   @output  · 违规逐条 `❌ <path>:<line> 头部声明 <YYYY-MM-DD> ≠ 首次提交 <YYYY-MM-DD>`
#            · 存量逐条 `ℹ️ 存量豁免: <path>:<line> …（基线内）`
#            · 可收紧 `ℹ️ 基线可收紧: <path>`
#            · 汇总 `G-DOC-3: OK <pass>/<total>` | `G-DOC-3: VIOLATION <m>`
#              ＋单列 `存量基线: <k> 条`（total = 检出头部日期的文档数；pass = total − 新增）
#   @exit    0 = 无新增违规（存量基线不阻断）｜1 = 有新增违规｜2 = 判不了
#            （非 git 仓／git ls-files|git log 失败／追踪文件在工作树不可读／
#              检出头部日期的文档数==0（信号量==0）／显式基线缺失／python 缺失／内部异常）
#   @degraded stderr `degraded: <CODE> — <原因>` ＋ 追加一行 JSON 到
#            `$SYNO_GATE_DEGRADED_LOG`（默认 `<root>/.codex/control-tower/logs/degraded-events.log`；
#            字段 time/component/code/phase/retryable；铁律 11/31/32；禁静默降级）
#   @error   code ∈ {E_USAGE, E_NOT_REPO, E_GIT_LOG, E_NO_PYTHON, E_BASELINE_MISSING,
#            E_UNREADABLE, E_EMPTY, E_INTERNAL}
#
# 判据语义（G-DOC-3 §一）:
#   |声明日 − 首次提交日| ≤ 1 天 ⇒ 过（±1 天容忍覆盖跨时区/跨日提交）；否则违规。
#   基线只减不增：基线内的存量违规放行（exit 仍 0）；基线路径已修好 ⇒ 提示可收紧，不判红。
#
# Explicit authority（谁能调）:
#   · 本批（#1148 B3）**不接** pre-commit／CI —— 仅 L1/L2 手跑与配对测试
#     `tests/doc-system/check-doc-g3-datestamp.test.sh` 调用；
#   · 接线（进 pre-commit 组／CI 腿）属后续 task，须走 A 类判据变更（提案 + 独立送审）；
#   · 任何人可手工只读运行：不写任何被检文件；唯一落盘 = 降级日志（.codex/，不入库）。
#
# 已知限制（Known Limitations）:
#   1. 头部日期只取"前 12 行里第一条含日期的引用行/字段行"——同一文档多个日期头
#      （CHANGELOG 式）只认第一条；第 13 行及以后不判。
#   2. 首次提交取 `--diff-filter=A`：被纯 rename 搬过家的文档，其原 add 记录只挂在旧路径上
#      ⇒ 新路径查不到首次提交 ⇒ 本器判不了（E_GIT_LOG 点名），不猜 rename 前历史。
#   3. 路径按行解析（`git ls-files` / `git log`）：含换行的文件名不支持；含非 UTF-8 字节的
#      路径以 surrogateescape 读入，输出可能显示为替换符。
#   4. 基线文件存在但没有 G-DOC-3 标记块 ⇒ 按空基线处理（该文件可能只服务别的门禁），
#      不判红、不告警；基线文件本身不参与扫描（禁自指）。
#   5. 不判"声明日是未来日期"：只要与首次提交日相差 ≤1 天即通过；未来日期属 G-DOC-3
#      其余子项，不在本批范围。
#
# Source map（段锚点 → 职责；在本文件内 grep 锚点即可定位）:
#   | 段锚点 | 职责 |
#   |---|---|
#   | `degraded()` | stderr 一行 + JSON 一行到 SYNO_GATE_DEGRADED_LOG（唯一降级出口）|
#   | `# ── ① 参数解析` | --root/--baseline/--no-baseline/--help；未知参数 ⇒ E_USAGE |
#   | `# ── ② 环境探测` | git 仓库归一／python 三级探测／mktemp+trap 清理 |
#   | `# ── ③ 真值采集` | git ls-files（扫描面）＋ git log（首次提交，一次）＋ 基线块解析 |
#   | `# ── ④ 分析` | 内嵌 python：头部日期提取／日期比较（@mutate-point）／基线豁免／汇总 |
#   | `# ── ⑤ 出口` | 打印 python 输出；rc==2 走 degraded；否则透传 0/1 |
# ═══════════════════════════════════════════════════════════════════════════════
set +e

COMPONENT="check-doc-g3-datestamp"
ROOT=""
EXPLICIT_BASELINE=""
NO_BASELINE=0
DEG_LOG=""
DEG_LOG_OVERRIDE="${SYNO_GATE_DEGRADED_LOG:-}"

# degraded <CODE> <原因> [phase] —— 唯一降级出口：先 stderr 可见，再落 JSON 一行，最后 exit 2
degraded() {
  local code="$1" reason="$2" phase="${3:-resolve}"
  if [ -z "$DEG_LOG" ]; then
    DEG_LOG="${DEG_LOG_OVERRIDE:-${ROOT:-$PWD}/.codex/control-tower/logs/degraded-events.log}"
  fi
  echo "degraded: ${code} — ${reason}" >&2
  if mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null; then  # swallow-ok: 目录不可建走 else 显式提示（不吞）
    printf '{"time":"%s","component":"%s","code":"%s","phase":"%s","retryable":true}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$COMPONENT" "$code" "$phase" >> "$DEG_LOG" 2>/dev/null || true  # swallow-ok: 日志写失败不改判定（stderr 已可见）
  else
    echo "degraded: 降级日志目录不可建（$DEG_LOG）—— 判定仍为 2" >&2
  fi
  exit 2
}

winpath() { # $1=目录 → 交给 python 的可访问路径（MSYS 用 pwd -W；非 MSYS 退回 pwd）
  ( cd "$1" 2>/dev/null && { pwd -W 2>/dev/null || pwd; } )  # swallow-ok: 目录不可进/无 -W 时退回 pwd，空值由调用方显式判
}

# ── ① 参数解析 ─────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      [ $# -ge 2 ] || degraded E_USAGE "--root 缺参数值" usage
      ROOT="$2"; shift 2 ;;
    --baseline)
      [ $# -ge 2 ] || degraded E_USAGE "--baseline 缺参数值" usage
      EXPLICIT_BASELINE="$2"; shift 2 ;;
    --no-baseline)
      NO_BASELINE=1; shift ;;
    -h|--help)
      awk 'NR>1 && /^set \+e$/{exit} NR>1' "$0"; exit 0 ;;
    *)
      degraded E_USAGE "未知参数: $1（支持 --root/--baseline/--no-baseline/--help）" usage ;;
  esac
done

# ── ② 环境探测 ─────────────────────────────────────────────────────────────
if [ -z "$ROOT" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"  # swallow-ok: 失败由下一行显式 degraded E_NOT_REPO
  [ -n "$ROOT" ] || degraded E_NOT_REPO "不在 git 仓库内且未给 --root（git rev-parse --show-toplevel 失败）"
else
  [ -d "$ROOT" ] || degraded E_USAGE "--root 目录不存在: $ROOT" usage
fi
GIT_TOP="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)"  # swallow-ok: 失败由下一行显式 degraded E_NOT_REPO
[ -n "$GIT_TOP" ] || degraded E_NOT_REPO "不是 git 仓库: $ROOT"
ROOT="$(cd "$GIT_TOP" && pwd)"  # swallow-ok: toplevel 必存在（上一行已验），cd 失败概率=路径被并发删
ROOT_WIN="$(winpath "$ROOT")"
[ -n "$ROOT_WIN" ] || degraded E_INTERNAL "无法解析 root 的可访问路径: $ROOT" env

PYBIN=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
[ -n "$PYBIN" ] || degraded E_NO_PYTHON "python3/python/py 三级探测全失败（D520 清单1）" env

TMPD="$(mktemp -d 2>/dev/null)"  # swallow-ok: 失败由下一行显式 degraded
{ [ -n "$TMPD" ] && [ -d "$TMPD" ]; } || degraded E_INTERNAL "mktemp -d 失败（无法建临时目录）" env
trap 'rm -rf "$TMPD"' EXIT
TMPD_WIN="$(winpath "$TMPD")"
[ -n "$TMPD_WIN" ] || degraded E_INTERNAL "无法解析临时目录的可访问路径: $TMPD" env

# ── ③ 真值采集（git 是唯一真值源；对 git 的调用各一次）──────────────────────
git -C "$ROOT" -c core.quotepath=false ls-files -- '*.md' > "$TMPD/files.txt" 2> "$TMPD/ls.err"
LS_RC=$?
[ "$LS_RC" -eq 0 ] || degraded E_GIT_LOG "git ls-files 失败（rc=$LS_RC）: $(head -3 "$TMPD/ls.err" | tr '\n' ' ')" scan

git -C "$ROOT" -c core.quotepath=false log --diff-filter=A --format='__C__%aI' --name-only -- '*.md' \
  > "$TMPD/log.txt" 2> "$TMPD/log.err"
LOG_RC=$?
[ "$LOG_RC" -eq 0 ] || degraded E_GIT_LOG "git log 失败（rc=$LOG_RC）: $(head -3 "$TMPD/log.err" | tr '\n' ' ')" scan

# 基线：存在性判定 + 标记块解析（bash 侧抽成"路径清单"，python 只吃已抽好的清单）
BASE_FILE=""
if [ "$NO_BASELINE" -eq 1 ]; then
  echo "ℹ️ 无基线（--no-baseline）"
elif [ -n "$EXPLICIT_BASELINE" ]; then
  [ -f "$EXPLICIT_BASELINE" ] || degraded E_BASELINE_MISSING "显式基线不存在: $EXPLICIT_BASELINE" baseline
  [ -r "$EXPLICIT_BASELINE" ] || degraded E_BASELINE_MISSING "显式基线不可读: $EXPLICIT_BASELINE" baseline
  BASE_FILE="$(cd "$(dirname "$EXPLICIT_BASELINE")" && pwd)/$(basename "$EXPLICIT_BASELINE")"  # swallow-ok: 存在性/可读性已上行显式判过
else
  DEF_BASELINE="$ROOT/gate-exemptions/2026-10-30-b3-docgate2.md"
  if [ -f "$DEF_BASELINE" ]; then
    BASE_FILE="$DEF_BASELINE"
  else
    echo "ℹ️ 无基线（默认基线不存在: gate-exemptions/2026-10-30-b3-docgate2.md）"
  fi
fi

BASE_WIN=""
: > "$TMPD/baseline.txt"
if [ -n "$BASE_FILE" ]; then
  # 交给 python 的基线路径必须与其 root 同形态（MSYS pwd 与 git toplevel 形态不同 ⇒ 统一走 winpath）
  BASE_WIN="$(winpath "$(dirname "$BASE_FILE")")/$(basename "$BASE_FILE")"
  # 只取标记块内的行；剥首尾空白；丢空行与 # 注释（CRLF 一并剥）
  awk '
    /G-DOC-3-BASELINE:END/   { inblk = 0; next }
    inblk {
      sub(/^[ \t]+/, ""); sub(/[ \t\r]+$/, "")
      if ($0 != "" && $0 !~ /^#/) print
    }
    /G-DOC-3-BASELINE:BEGIN/ { inblk = 1 }
  ' "$BASE_FILE" > "$TMPD/baseline.txt"
fi

# ── ④ 分析（内嵌 python；全部判定在一个进程内完成）──────────────────────────
OUT="$("$PYBIN" - "$ROOT_WIN" "$TMPD_WIN/files.txt" "$TMPD_WIN/log.txt" "$TMPD_WIN/baseline.txt" "$BASE_WIN" <<'PYEOF'
import datetime
import os
import re
import sys
from itertools import islice

HEAD_LINES = 12  # G-DOC-3 §一：只读每份文档前 12 行
CAND_QUOTE = re.compile(r"^\s*>")
CAND_FIELD = re.compile(r"^\s*(?:日期|date|更新时间|updated)\s*[:：]", re.IGNORECASE)
DATE_RE = re.compile(r"20\d{2}-\d{2}-\d{2}")


def read_lines(path):
    with open(path, encoding="utf-8", errors="surrogateescape") as f:
        return f.read().splitlines()


def is_violation(declared, first):
    # 判据点：与首次提交日相差是否超过 ±1 天容忍。测试用 sed 把它改成恒假验证"改坏即红"。
    MUTATE_TARGET = abs((declared - first).days) > 1  # @mutate-point: date-compare
    return MUTATE_TARGET


def main():
    root = sys.argv[1]
    files = [x for x in read_lines(sys.argv[2]) if x.strip()]
    log_lines = read_lines(sys.argv[3])
    base_lines = read_lines(sys.argv[4])
    base_arg = sys.argv[5] if len(sys.argv) > 5 else ""
    if base_arg:
        # 禁自指：基线文件自身不参与扫描。root 与基线统一 realpath 后取相对路径，
        # 避免 MSYS 路径（/tmp/…）与 git toplevel（C:/…）两种形态字符串比较失配。
        try:
            base_rel = os.path.relpath(os.path.realpath(base_arg), os.path.realpath(root))
        except ValueError:
            base_rel = ""
        if base_rel and base_rel != ".." and not base_rel.startswith(".." + os.sep):
            base_rel = base_rel.replace(os.sep, "/")
            files = [x for x in files if x != base_rel]

    # 首次提交：新→老遍历，同一路径最后出现 = 最早 add ⇒ cur 记该提交的 %aI 前 10 位
    first = {}
    cur = None
    for ln in log_lines:
        if ln.startswith("__C__"):
            cur = ln[5:15]
            continue
        if not ln.strip():
            continue
        if cur:
            first[ln.strip()] = cur

    exempt = set()
    for ln in base_lines:
        p = ln.strip()
        if p and not p.startswith("#"):
            exempt.add(p)

    total = 0
    unread = []
    nofirst = []
    violations = []
    for rel in files:
        try:
            with open(os.path.join(root, rel), encoding="utf-8", errors="replace") as f:
                head = list(islice(f, HEAD_LINES))
        except OSError as exc:
            unread.append((rel, str(exc)))
            continue
        hit = None
        for idx, line in enumerate(head, 1):
            if CAND_QUOTE.match(line) or CAND_FIELD.match(line):
                m = DATE_RE.search(line)
                if m:
                    hit = (m.group(0), idx)
                    break
        if hit is None:
            continue
        total += 1
        declared_s, line_no = hit
        first_s = first.get(rel)
        if not first_s:
            nofirst.append(rel)
            continue
        try:
            declared = datetime.date.fromisoformat(declared_s)
            first_date = datetime.date.fromisoformat(first_s)
        except ValueError as exc:
            print("E_INTERNAL: 日期不可解析（%s:%d 声明=%r 首次=%r）: %s"
                  % (rel, line_no, declared_s, first_s, exc))
            return 2
        if is_violation(declared, first_date):
            violations.append((rel, line_no, declared_s, first_s))

    if unread:
        for rel, err in unread[:10]:
            print("E_UNREADABLE: 追踪文件在工作树不可读: %s（%s）" % (rel, err))
        print("E_UNREADABLE: 共 %d 件不可读（判不了 ⇒ exit 2，禁当通过）" % len(unread))
        return 2
    if total == 0:
        print("E_EMPTY: 检出头部日期的文档数=0（信号量==0 ⇒ 判不了，禁当通过）")
        return 2
    if nofirst:
        for rel in nofirst[:10]:
            print("E_GIT_LOG: 缺首次提交记录（git log --diff-filter=A 无此路径，疑 rename）: %s" % rel)
        print("E_GIT_LOG: 共 %d 件无法确定首次提交日（判不了 ⇒ exit 2）" % len(nofirst))
        return 2

    new = [v for v in violations if v[0] not in exempt]
    stock = [v for v in violations if v[0] in exempt]

    print("── G-DOC-3 日期戳检查（#1148 B3）──")
    print("root: %s" % root)
    print("扫描 %d 份 .md ／ 检出头部日期 %d ／ 违规 %d（新增 %d ／ 存量基线 %d）"
          % (len(files), total, len(violations), len(new), len(stock)))
    for rel, line_no, declared_s, first_s in violations:
        if rel in exempt:
            print("ℹ️ 存量豁免: %s:%d 头部声明 %s ≠ 首次提交 %s（基线内）"
                  % (rel, line_no, declared_s, first_s))
        else:
            print("❌ %s:%d 头部声明 %s ≠ 首次提交 %s" % (rel, line_no, declared_s, first_s))
    violating = {v[0] for v in violations}
    for p in sorted(p for p in exempt if p not in violating):
        print("ℹ️ 基线可收紧: %s" % p)
    if new:
        print("G-DOC-3: VIOLATION %d" % len(new))
    else:
        print("G-DOC-3: OK %d/%d" % (total - len(new), total))
    print("存量基线: %d 条" % len(stock))
    return 1 if new else 0


try:
    sys.exit(main())
except SystemExit:
    raise
except Exception as exc:  # noqa: BLE001 — 未预期异常一律归 2（判不了 ≠ 通过），且 traceback 可见
    import traceback
    traceback.print_exc()
    print("E_INTERNAL: 未预期异常: %s" % exc)
    sys.exit(2)
PYEOF
)"
RC=$?
printf '%s\n' "$OUT"

# ── ⑤ 出口 ─────────────────────────────────────────────────────────────────
if [ "$RC" -eq 2 ]; then
  CODE="$(printf '%s\n' "$OUT" | grep -oE 'E_[A-Z_]+' | head -1)"
  degraded "${CODE:-E_INTERNAL}" "见上（判不了 ≠ 通过；三态=${RC}）" scan
fi
exit "$RC"
