#!/usr/bin/env bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-conflict-markers.sh — 冲突标记机检（把"人规"变成"机检"）
#
# 背景（2026-11-02 实证，不是假想）:
#   两个 forward-merge 提交（2d70f7e2b / b0edc5c92）把 `<<<<<<< HEAD … ======= … >>>>>>>`
#   原样带进了 `docs/authority/DOCS-REGISTRY.yaml` 并推送；**CI 两条腿都判 success**。
#   ⇒ 全仓没有一处判据在看"文件里有没有留下两个版本互相打架的痕迹"，
#   而这类文件**解析不了**：门禁读垃圾 → 给出"绿" → 最坏的一类假绿。
#
# 设计哲学（一句）: **只认"行首标记形态 ＋ 机器可解析的扩展名"，宁窄不宽** ——
#   冲突标记是**行首语法现象**（open/base/sep/close 四形态）；而 .md/.txt 里合法引用它
#   （文档、测试夹具）⇒ 用**扩展名白名单**而不是"全仓 grep"，把误杀压到 0；
#   确需放宽时用同行 `conflict-marker-ok` 逐行豁免（可见、可审计）。
#
# 契约（铁律 47）:
#   @usage  bash scripts/control-tower/check-conflict-markers.sh [--root <dir>]
#             [--base <ref> | --all | --staged] [--json] [--help]
#   @input  ① 默认 **--staged**：只看暂存区新增/修改的文件（pre-commit 腿）；
#           ② `--base <ref>`：看 `<ref>...HEAD` 变更集（CI 腿，与其它门禁同口径）；
#           ③ `--all`：扫全部被 git 跟踪的文件（人工抽查／首次接入用）。
#           文件面 = **扩展名白名单**（KNOWN_EXTS）；其它扩展名与二进制一律跳过。
#   @output 首行恒为 `CONFLICT-MARKERS: scanned=<n> hits=<n> mode=<staged|base|all>`
#           逐条 `MARKER: <path>:<line>: <form>`（form ∈ open|base|sep|close）
#           末行固定三态之一：`CONFLICT-MARKERS: OK | VIOLATION(n) | DEGRADED`
#           `--json`：stdout 只一行合法 JSON（人读说明走 stderr）
#   @exit   0=干净 ｜ 1=命中（阻断）｜ 2=判不了（无 git／无 python／base 不可解析／核心异常）
#           🔴 三态铁律：2 绝不等于通过（信号量==0 ⇒ 2，fail-closed）
#   @degraded stderr `degraded: <CODE> — <原因>` ＋ 追加 JSON 到 SYNO_GATE_DEGRADED_LOG
#           （time/component/code/phase/retryable；铁律 11/32）＋ exit 2
#           code ∈ {E_USAGE, E_NO_GIT, E_NO_PYTHON, E_BASE, E_INTERNAL}
#   @authority explicit authority: `scripts/pre-commit-check.sh`（组 1 · staged）、
#           CI job（base 模式，与 ① 组同一变更集口径）、人工复核 均可调用。
#           **只读**：不写仓库任何文件；唯一落盘是 degraded 日志（ignored 的 .codex/ 下）。
#
# 已复用的既有约定（禁重复实现）:
#   D1 三态退出码 0/1/2（scripts/control-tower/AGENTS.md）
#   D2 `@降级` ＋ SYNO_GATE_DEGRADED_LOG JSON（写法与 check-gate-budget.sh 同形）
#   D3 UTF-8 强制（D732 / D313 M5；本文件首两行）
#   D4 判别力自检 = 配对测试 tests/control-tower/check-conflict-markers.test.sh 的
#      「改坏必红」用例：把 open 形态从判据里去掉 ⇒ 对应用例必须由 1 变 0（证明不是恒红）
#
# 结构（Source map）:
#   段                       职责
#   ──────────────────────   ────────────────────────────────────────────────
#   参数与降级出口           四旗标 ＋ E_* 三态归一
#   文件面                   按模式取清单（staged／base／all）＋ 扩展名白名单
#   判据核心（内嵌 Python）   单进程逐行扫四形态，跳过 `conflict-marker-ok` 行
#   输出与退出               首行摘要 ＋ 逐条 MARKER ＋ 0/1/2
#
# 已知限制（Known Limitations — 做不到什么）:
#   1. **只看行首**：行内出现的 `<<<<<<<`（如本文件头、测试夹具）不算 → 故意如此，
#      否则会误杀所有"讲这件事"的文档。代价：被缩进/引用过的真标记会漏判。
#   2. **扩展名白名单**：`.md`／`.txt`／无扩展名文件不在面内。代价：`.md` 里的标记不红
#      （.md 不做机器解析，风险低）；要覆盖须显式加白名单。
#   3. **不判语义级合并损坏**（两边都对、合起来逻辑错）——那不是本件的职责。
#   4. **只判当前工作树/变更集**；历史上曾带过、后被修掉的不算（那是 git 历史事实）。
#   5. 非 UTF-8 文件按 errors=replace 读，理论上可能误命中（命中会点名到行，可人工判）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT=""; BASE=""; MODE="staged"; JSON=0
DEG_LOG=""

deg() { # <CODE> <phase> <原因>
  printf 'degraded: %s — %s\n' "$1" "$3" >&2
  local _dl="${SYNO_GATE_DEGRADED_LOG:-${DEG_LOG:-.codex/control-tower/logs/degraded-events.log}}"
  mkdir -p "$(dirname "$_dl")" 2>/dev/null || true                               # swallow-ok: 日志目录不可建不阻断降级
  printf '{"time":"%s","component":"check-conflict-markers","code":"%s","phase":"%s","retryable":false}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$_dl" 2>/dev/null || true     # swallow-ok: 落盘失败不改变 exit 2
  exit 2
}

usage() { sed -n '4,78p' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --root)   [ $# -ge 2 ] || deg E_USAGE argv "--root 缺参数"; ROOT="$2"; shift 2 ;;
    --root=*) ROOT="${1#--root=}"; shift ;;
    --base)   [ $# -ge 2 ] || deg E_USAGE argv "--base 缺参数"; BASE="$2"; MODE="base"; shift 2 ;;
    --base=*) BASE="${1#--base=}"; MODE="base"; shift ;;
    --all)    MODE="all"; shift ;;
    --staged) MODE="staged"; shift ;;
    --json)   JSON=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) deg E_USAGE argv "未知参数: $1" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "$ROOT" ]; then
  ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || \
    deg E_NO_GIT root "无法定位 git 仓库根（未给 --root 且不在 git 仓库内）"
fi
[ -n "$ROOT" ] && [ -d "$ROOT" ] || deg E_NO_GIT root "仓库根不存在: ${ROOT}"
DEG_LOG="${SYNO_GATE_DEGRADED_LOG:-$ROOT/.codex/control-tower/logs/degraded-events.log}"

PYBIN=""
for _c in python3 python py; do   # PYBIN 三级探测（D520：禁裸 python3；探可用性而非仅存在性）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || deg E_NO_PYTHON py "python3/python/py 均不可用 —— 判不了（禁当通过）"

# ── 文件清单（按模式）──
LIST=""
case "$MODE" in
  staged)
    LIST="$(git -C "$ROOT" -c core.quotepath=false diff --cached --name-only --diff-filter=ACM 2>/dev/null)" || \
      deg E_NO_GIT staged "git diff --cached 失败（非 git 仓库？）"
    ;;
  base)
    git -C "$ROOT" rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null 2>&1 || \
      deg E_BASE base "base 不可解析: ${BASE}"
    LIST="$(git -C "$ROOT" -c core.quotepath=false diff --name-only --diff-filter=ACM "${BASE}...HEAD" 2>/dev/null)" || \
      deg E_BASE base "git diff ${BASE}...HEAD 失败"
    ;;
  all)
    LIST="$(git -C "$ROOT" -c core.quotepath=false ls-files 2>/dev/null)" || \
      deg E_NO_GIT all "git ls-files 失败"
    ;;
esac

# ── 判据核心（内嵌 Python，单进程；代码放变量，文件清单走 stdin）──
read -r -d '' PYCORE <<'PYCORE' || true
import io, os, re, sys

root, mode = sys.argv[1], sys.argv[2]

# 扩展名白名单：只扫**机器可解析**的文件（.md/.txt 等合法引用标记的载体一律不在面内）
KNOWN_EXTS = {
    ".sh", ".bash", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm", ".css",
    ".go", ".rs", ".java", ".kt", ".rb", ".php", ".sql", ".ini", ".cfg", ".conf",
}

# 四形态（行首，允许前导空白）：open / diff3-base / sep / close
FORMS = (
    ("open",  re.compile(r"^\s*<<<<<<< ")),
    ("base",  re.compile(r"^\s*\|\|\|\|\|\|\| ")),
    ("sep",   re.compile(r"^\s*=======\s*$")),
    ("close", re.compile(r"^\s*>>>>>>> ")),
)

files = [ln.strip() for ln in sys.stdin.read().splitlines() if ln.strip()]
hits, scanned = [], 0
for rel in files:
    if os.path.splitext(rel)[1].lower() not in KNOWN_EXTS:
        continue
    p = os.path.join(root, rel)
    if not os.path.isfile(p):
        continue
    scanned += 1
    try:
        with io.open(p, encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f, 1):
                if "conflict-marker-ok" in line:
                    continue
                for name, rx in FORMS:
                    if rx.match(line):
                        hits.append((rel, i, name))
                        break
    except OSError:
        continue

print("CONFLICT-MARKERS: scanned=%d hits=%d mode=%s" % (scanned, len(hits), mode))
for rel, i, name in hits:
    print("MARKER: %s:%d: %s" % (rel, i, name))
if hits:
    print("CONFLICT-MARKERS: VIOLATION(%d)" % len(hits))
    sys.exit(1)
print("CONFLICT-MARKERS: OK")
sys.exit(0)
PYCORE

OUT="$("$PYBIN" -c "$PYCORE" "$ROOT" "$MODE" <<< "$LIST")"
RC=$?

if [ "$JSON" = 1 ]; then
  FIRST="$(printf '%s\n' "$OUT" | head -1)"
  SCANNED="$(printf '%s' "$FIRST" | sed -n 's/.*scanned=\([0-9]*\).*/\1/p')"
  HITS="$(printf '%s' "$FIRST" | sed -n 's/.*hits=\([0-9]*\).*/\1/p')"
  printf '{"scanned":%s,"hits":%s,"mode":"%s","verdict":"%s"}\n' \
    "${SCANNED:-0}" "${HITS:-0}" "$MODE" "$([ "$RC" = 0 ] && echo OK || echo VIOLATION)"
  [ "$RC" = 0 ] || printf '%s\n' "$OUT" >&2
else
  printf '%s\n' "$OUT"
fi

case "$RC" in
  0|1) exit "$RC" ;;
  *)   deg E_INTERNAL core "判据核心异常退出（rc=$RC）" ;;
esac
