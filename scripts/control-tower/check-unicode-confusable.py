#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ═══════════════════════════════════════════════════════════════════════════════
# check-unicode-confusable.py — Unicode 同形字分级门禁（#1108 · W10）
#
# 设计哲学（一句）: **只判「本次 diff 新增的行」，把真危险拦死、把观感噪音只报不拦** ——
#   真危险＝同形字冒充标识符（Trojan Source 变体 / 变量名视觉冒充）、双向控制符、编码损坏；
#   观感噪音＝中文注释/文案里的全角标点（本仓属正常）。若"全仓禁非 ASCII"，
#   22k 历史全角字符会把每一个 PR 判红（规格 §3 W10「范围（关键约束）」）⇒ 本器**不扫全仓**，
#   存量只作「遗留清单」单列，不阻断、不要求即时清理（M-12）。
#
# 契约（铁律 47）:
#   @usage   python3 scripts/control-tower/check-unicode-confusable.py [--base <ref> | --staged]
#              [--json] [--list-legacy] [--selfcheck] [--root <dir>] [--help]
#   @input   git 仓库（--root，默认 cwd）＋ 变更集来源（**二选一**；两个都给 ⇒ E_USAGE）:
#              --base <ref>   `git diff --unified=0 --no-color <ref>...HEAD`（CI／非暂存态用）
#              --staged｜缺省   `git diff --cached --unified=0 --no-color`（pre-commit 用）
#            --list-legacy  额外扫**存量登记件**（`git ls-files` 后缀白名单；只报不判，永不进 rc）
#            --selfcheck    内置夹具的判别力自检（六夹具；任一不符 ⇒ exit 2）
#   判定分档（规格 §3 W10 判定分层；全部只对**新增行**）:
#     A 档（P0 阻断）  标识符／裸代码位的同形字 —— 骨架（注释与字符串字面量置空后的部分）内
#                      出现「形似 ASCII 的非 ASCII 字母/数字」：西里尔/希腊同形表 ＋ NFKC 归一
#                      后仍落在 ASCII 字母数字的全角/兼容形。**中文注释不判 A**（骨架里没有它）。
#     B 档（P0 阻断）  任意位置双向控制符 U+202A–U+202E、U+2066–U+2069（经典 Trojan Source 向量）
#     C 档（P0 阻断）  任意位置 U+FFFD 替换字符 ／ 该行含**无法按 UTF-8 严格解码的字节**（编码损坏证据）
#     D 档（P2 仅提醒）全角标点 U+FF01–U+FF5E（剔除全角字母数字）⇒ 只列行号/字符，**exit 0**
#   @output  stdout 逐条命中（❌ A/B/C 带 path:line:col ＋ 码位；⚠️ D 只列行号清单）
#            ＋ 末行汇总口径 `UNICODE-CONFUSABLE: PASS|VIOLATION|SKIP files=<n> added=<n> a=<n> b=<n> c=<n> d=<n>`
#            --json 时 stdout 仅一份**合法 JSON**（人读行抑制；degraded 仍走 stderr）
#   @exit    **三态**（scripts/control-tower/AGENTS.md「probe 三态退出码」）:
#              0 = 通过（A/B/C 零命中；D 命中仍 0；空变更集 ⇒ SKIP，**SKIP 不是 PASS**）
#              1 = 真红（A/B/C ≥1 命中）
#              2 = **判不了／自身失败**（git 不可用／--base 不可解析／diff 失败／diff 有 @@ 但解析
#                  不出任何 hunk／参数非法／自检判别力失效）—— 🔴 **绝不可归 0（假绿）**
#   @degraded 任何 exit 2 ⇒ stderr 一行 `degraded: <code> — <原因>`；设 SYNO_GATE_DEGRADED_LOG 时
#            另追加一行 JSON（time/component/code/phase/retryable；铁律 11/32，不静默降级）
#   @error   code ∈ {E_USAGE, E_GIT, E_BAD_BASE, E_DIFF, E_PARSE, E_SELFCHECK, E_INTERNAL}（均 ⇒ exit 2）
#
# 判据纪律 ⑨ 三问（本器自答，见 #1108 的 Q1/Q3）:
#   ① 对象  只判 `--base <ref>...HEAD` 或 `--cached` 的**新增行**；不判存量、不判工作树未暂存内容
#            （禁"恰好出现的状态"：不读 remote、不读工作树）。存量只由 `--list-legacy` 显式列。
#   ② 环境  依赖只有 git ＋ 本机 python3；夹具全在 mktemp 沙箱 repo（不继承外层 CI 变量、不写真仓）。
#            解码固定 UTF-8（`surrogateescape` 仅为保留 diff 结构，逐行再验；**永不退 cp1252**）。
#   ③ 证据  失败点给 path:line:col ＋ 码位 ＋ 形似字符；`--json` 可机读；`--selfcheck` 可复跑；
#            改坏即红见 tests/control-tower/check-unicode-confusable.test.sh 的 T13。
#
# 已知限制（Known Limitations —— 禁读成"已检测"）:
#   1. **A 档靠启发式骨架，不是 AST**：`#` 注释判定要求 `#` 在行首/空白后（`this.#x` 不算注释）；
#      跨行块注释 `/* */` 与三引号保持状态。模板字符串里 `${...}` 的代码位会被当字符串置空 ⇒
#      **漏判**（`${pаssword}` 这种形态本器看不见）。
#   2. **只在 diff 新增行**：把危险字符从别处"搬"进来（删除旧行＋新增旧内容）仍会被抓到；
#      但**存量**同形字不判（M-12 语义：不许一次 PR 卡死 22k 历史）。
#   3. **同形表是枚举**：西里尔/希腊常见同形 ＋ NFKC 兼容形；亚美尼亚文、切罗基文等未入表 ⇒ 漏判。
#   4. **NFKC 会把全角字母数字判 A（在代码位）**：这是有意（`ｐassword` 在代码位必是事故），
#      但它对"字符串里的全角字母"不触发（被骨架置空）⇒ 全角字母/数字**在注释/字符串内完全不报**
#      （D 档只收全角标点）—— 这是与规格 D 定义一致的边界，不是遗漏。
#   5. **"乱码标记"只实现两种**：U+FFFD 替换字符 ＋ 无法严格 UTF-8 解码的字节；`\u00c3\u00a9`
#      这类"已被错误解码的 mojibake 文本"本器判不了（需要语义/词典，不做）。
#   6. **不做豁免通道**：A/B/C 若要豁免，走 W3 双人复核 ＋ 日落（P0 永不自动退役，规格 §3 W10 豁免段）；
#      本器不提供 inline 忽略注释（`# swallow-ok:` 对本器无效）—— 这是有意的"无后门"。
#   7. **--list-legacy 读工作树**：只作清单（永不进 rc），故不引入"索引 vs 工作树"歧义成本；
#      上限 `--legacy-max-files`（默认 6000）/ `--legacy-max-bytes`（默认 2 MiB/件），超限显式标 `truncated`。
#   8. **不含 cp1252 回退**：Windows 下非 UTF-8 字节一律按"编码损坏"（C 档）处理，不做"猜编码"
#      （D370/D738 教训：猜编码会把损坏静默成通过）。
#
# 既有基础（禁重复建设）:
#   · 三态退出码 / UTF-8 强制 / SYNO_GATE_DEGRADED_LOG 降级日志 = scripts/control-tower/AGENTS.md 四条既有约定
#   · diff 变更集口径与 check-quality-delta.py 同源（`git diff --unified=0`）
#   · `--selfcheck` 判别力自检范式对齐 check-tool-args-delta.py（#915）
#   · 本器**不自造**豁免通道，也不改 D738/PR #544 的既有 bash 扫描（意图并入本器，规格 §3 W10 非目标）
#
# 结构（Source map）:
#   ① 常量与同形表   ② 输出/降级   ③ git 与 base 解析   ④ diff 解析（--unified=0，逐 hunk 计数定界）
#   ⑤ 骨架抽取（注释/字符串置空）   ⑥ 分档判定   ⑦ 存量清单   ⑧ 自检   ⑨ main
# ═══════════════════════════════════════════════════════════════════════════════

import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from datetime import datetime, timezone

RC_OK = 0
RC_RED = 1
RC_UNJUDGED = 2

COMPONENT = "check-unicode-confusable"
ISSUE = "#1108"
SCHEMA_VERSION = 1
TOOL_VERSION = "1.0.0"

# ── ① 常量与同形表 ────────────────────────────────────────────────────────────
# Cyrillic → ASCII（视觉同形；U+0430 等一律用转义写，禁把危险字面字符落进本文件自身）
HOMOGLYPH = {
    "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c",
    "\u0443": "y", "\u0445": "x", "\u0456": "i", "\u0455": "s", "\u0458": "j",
    "\u0501": "d", "\u04bb": "h", "\u04cf": "l",
    "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041a": "K", "\u041c": "M",
    "\u041d": "H", "\u041e": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T",
    "\u0423": "Y", "\u0425": "X",
    # Greek → ASCII（视觉同形）
    "\u03b1": "a", "\u03bf": "o", "\u03b5": "e", "\u03b9": "i", "\u03ba": "k",
    "\u03bd": "v", "\u03c1": "p", "\u03c4": "t", "\u03c5": "u", "\u03c7": "x",
    "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H",
    "\u0399": "I", "\u039a": "K", "\u039c": "M", "\u039d": "N", "\u039f": "O",
    "\u03a1": "P", "\u03a4": "T", "\u03a5": "Y", "\u03a7": "X", "\u03f9": "C",
}

# B 档：双向控制符（Trojan Source 向量）
BIDI_CODEPOINTS = frozenset(
    list(range(0x202A, 0x202F)) + list(range(0x2066, 0x206A))
)

# C 档：替换字符
REPLACEMENT = "\ufffd"
SURROGATE_LO = 0xDC80  # surrogateescape 把无效字节 b 映射到 0xDC00+b；0xDC80..0xDCFF = 无效 UTF-8
SURROGATE_HI = 0xDCFF

# D 档：全角标点 = U+FF01–U+FF5E 剔除全角字母与全角数字（后者在代码位归 A 档，文案位属正常）
_FULLWIDTH_LETTER_DIGIT = frozenset(
    [chr(cp) for cp in range(0xFF10, 0xFF1A)]
    + [chr(cp) for cp in range(0xFF21, 0xFF3B)]
    + [chr(cp) for cp in range(0xFF41, 0xFF5B)]
)
FULLWIDTH_PUNCT = frozenset(
    chr(cp) for cp in range(0xFF01, 0xFF5F) if chr(cp) not in _FULLWIDTH_LETTER_DIGIT
)

_LEGACY_SUFFIXES = (
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".py",
    ".md", ".yml", ".yaml", ".json", ".tmpl",
)

_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


class GateError(Exception):
    """判不了（exit 2）：带 code 的 typed error（铁律 32）。"""

    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


# ── ② 输出 / 降级 ────────────────────────────────────────────────────────────
def _force_utf8_streams():
    """Windows 控制台/重定向下统一 UTF-8（D313 M5 / D732）。失败不改判定。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except (AttributeError, ValueError):  # swallow-ok: 流被替换（如测试捕获）时保持原样，不影响判定
            pass


def degraded(code, msg):
    """exit 2 的降级通道：stderr 一行 ＋（可配）遥测日志一行 JSON。"""
    sys.stderr.write("degraded: %s — %s\n" % (code, msg))
    sys.stderr.flush()
    log_path = os.environ.get("SYNO_GATE_DEGRADED_LOG")
    if not log_path:
        return
    row = {
        "time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "component": COMPONENT,
        "code": code,
        "phase": "scan",
        "retryable": False,
        "message": msg,
    }
    try:
        parent = os.path.dirname(os.path.abspath(log_path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError:  # swallow-ok: 遥测写失败不改变本器判定（判定已在 stdout/stderr 给全，铁律 11 只禁静默降级）
        pass


def _safe(text):
    """把 surrogateescape 来的代理字符转成可见转义，避免输出编码二次炸。"""
    if text is None:
        return None
    return "".join(
        "\\x%02x" % (ord(ch) - 0xDC00) if SURROGATE_LO <= ord(ch) <= SURROGATE_HI else ch
        for ch in text
    )


def _cp(ch):
    return "U+%04X" % ord(ch)


# ── ③ git 与 base 解析 ───────────────────────────────────────────────────────
def _run_git(root, args):
    try:
        return subprocess.run(
            ["git", "-C", root] + list(args),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:  # git 不存在 / 不可执行
        raise GateError("E_GIT", "git 不可用: %s" % exc)


def _git_out(root, args):
    proc = _run_git(root, args)
    if proc.returncode != 0:
        tail = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        raise GateError(
            "E_GIT",
            "git %s 失败（rc=%d）: %s" % (" ".join(args), proc.returncode, tail[-1] if tail else ""),
        )
    return proc.stdout


def _ensure_repo(root):
    if not os.path.isdir(root):
        raise GateError("E_GIT", "root 不是目录: %s" % root)
    proc = _run_git(root, ["rev-parse", "--show-toplevel"])
    if proc.returncode != 0:
        raise GateError("E_GIT", "不是 git 仓库: %s" % root)


def resolve_base(root, base):
    proc = _run_git(root, ["rev-parse", "--verify", "--quiet", base + "^{commit}"])
    if proc.returncode != 0:
        raise GateError("E_BAD_BASE", "base 不可解析: %s" % base)
    return proc.stdout.decode("utf-8", "replace").strip()


# ── ④ diff 解析（--unified=0）─────────────────────────────────────────────────
def parse_added_lines(diff_text):
    """从 `--unified=0` 的 diff 文本里取**新增行**。

    用 hunk 头的 old/new 计数定界（而非"看行首字符"）—— 因为新增内容自己可能以 `+++ `/`--- `
    开头，靠前缀会误判成文件头（真实存在）。
    返回 (files, added, stats)；added = [(path, new_line_no, text)]。
    """
    files = []
    seen = set()
    added = []
    stats = {"hunks": 0, "removed": 0, "binary": 0, "deleted": 0, "renamed": 0}
    cur_path = None
    new_no = 0
    rem_old = 0
    rem_new = 0
    in_hunk = False

    for raw in diff_text.split("\n"):
        line = raw[:-1] if raw.endswith("\r") else raw
        if in_hunk:
            if rem_old > 0 or rem_new > 0:
                if not line:
                    # 空行在 hunk 内是"上下文空行"（前缀被吃掉）—— --unified=0 下只可能是新增/删除空行
                    # 的极端形态；无法区分时按上下文消化，保守不判（下面由 hunk 计数兜底）
                    rem_old -= 1 if rem_old > 0 else 0
                    rem_new -= 1 if rem_new > 0 else 0
                    continue
                lead = line[0]
                body = line[1:]
                if lead == "+":
                    if cur_path is not None:
                        added.append((cur_path, new_no, body))
                    new_no += 1
                    rem_new -= 1
                    continue
                if lead == "-":
                    stats["removed"] += 1
                    rem_old -= 1
                    continue
                if lead == " ":
                    rem_old -= 1
                    rem_new -= 1
                    new_no += 1
                    continue
                if lead == "\\":  # \ No newline at end of file
                    continue
                # 无法识别的 hunk 内行 ⇒ 后置兜底（hunk 计数与解析条数不符时 E_PARSE）
                continue
            in_hunk = False

        if line.startswith("diff --git "):
            cur_path = None
            continue
        if line.startswith("Binary files ") or line.startswith("GIT binary patch"):
            stats["binary"] += 1
            continue
        if line.startswith("deleted file mode "):
            stats["deleted"] += 1
            continue
        if line.startswith("rename from ") or line.startswith("rename to "):
            stats["renamed"] += 1
            continue
        if line.startswith("--- "):
            continue
        if line.startswith("+++ "):
            path = line[4:]
            if path.startswith("b/"):
                path = path[2:]
            elif path == "/dev/null":
                path = None
            else:
                path = path.strip()
            cur_path = path
            if path is not None and path not in seen:
                seen.add(path)
                files.append(path)
            continue
        match = _HUNK_RE.match(line)
        if match:
            stats["hunks"] += 1
            rem_old = int(match.group(2)) if match.group(2) is not None else 1
            rem_new = int(match.group(4)) if match.group(4) is not None else 1
            new_no = int(match.group(3))
            in_hunk = True
            continue

    return files, added, stats


# ── ⑤ 骨架抽取（注释 / 字符串置空）────────────────────────────────────────────
def strip_code(line, state):
    """返回「标识符/裸代码位」的骨架：注释与字符串字面量置空。

    state 为跨行状态字典（块注释 / 三引号），由调用方按文件新建。
    行注释规则（防误伤/防漏判）:
      · `#` 只在**行首或空白后**起注释（`this.#x`、`a#b` 不算）——与 shell/python 一致
      · `//` 在代码态直接起注释（字符串内的 `//` 已被字符串态保护）
    """
    out = []
    i = 0
    n = len(line)
    while i < n:
        mode = state.get("mode")
        if mode == "block":
            if line.startswith("*/", i):
                state["mode"] = None
                i += 2
            else:
                i += 1
            continue
        if mode in ('"""', "'''"):
            if line.startswith(mode, i):
                state["mode"] = None
                i += len(mode)
            else:
                i += 1
            continue
        if mode in ("'", '"', "`"):
            ch = line[i]
            if ch == "\\":
                i += 2
                continue
            if ch == mode:
                state["mode"] = None
                i += 1
                continue
            i += 1
            continue

        # 代码态
        if line.startswith("/*", i):
            state["mode"] = "block"
            i += 2
            continue
        if line.startswith('"""', i):
            state["mode"] = '"""'
            i += 3
            continue
        if line.startswith("'''", i):
            state["mode"] = "'''"
            i += 3
            continue
        if line.startswith("//", i):
            break
        ch = line[i]
        if ch == "#":
            prev = line[i - 1] if i > 0 else ""
            if i == 0 or prev in " \t;":
                break
        if ch in ("'", '"', "`"):
            state["mode"] = ch
            i += 1
            continue
        out.append(ch)
        i += 1

    if state.get("mode") in ("'", '"', "`"):
        state["mode"] = None  # 单行字符串不跨行（未闭合视为到行尾结束）
    return "".join(out)


def _nfkc_lookalike(ch):
    """NFKC 归一后落到 ASCII 字母数字 ⇒ 兼容形同形字（全角字母/数字、半角片假名等）。"""
    if ch.isascii():
        return None
    norm = unicodedata.normalize("NFKC", ch)
    if len(norm) == 1 and norm.isascii() and norm.isalnum():
        return norm
    return None


# ── ⑥ 分档判定 ───────────────────────────────────────────────────────────────
def classify_line(path, lineno, text, state):
    """对一行（新增行）分档。返回 (a, b, c, d)；a/b/c 为 finding dict 列表，d 为字符列表。"""
    a_hits = []
    b_hits = []
    c_hits = []
    d_hits = []

    for ch in text:
        cp = ord(ch)
        if cp in BIDI_CODEPOINTS:
            b_hits.append(
                {
                    "class": "B",
                    "code": "B-BIDI-CONTROL",
                    "path": path,
                    "line": lineno,
                    "col": text.index(ch) + 1,
                    "char": _safe(ch),
                    "codepoint": _cp(ch),
                    "looks_like": None,
                    "where": "any",
                }
            )
        elif ch == REPLACEMENT:
            c_hits.append(
                {
                    "class": "C",
                    "code": "C-REPLACEMENT-CHAR",
                    "path": path,
                    "line": lineno,
                    "col": text.index(ch) + 1,
                    "char": _safe(ch),
                    "codepoint": _cp(ch),
                    "looks_like": None,
                    "where": "any",
                }
            )
        elif SURROGATE_LO <= cp <= SURROGATE_HI:
            c_hits.append(
                {
                    "class": "C",
                    "code": "C-UNDECODABLE-UTF8",
                    "path": path,
                    "line": lineno,
                    "col": text.index(ch) + 1,
                    "char": _safe(ch),
                    "codepoint": "byte 0x%02X" % (cp - 0xDC00),
                    "looks_like": None,
                    "where": "any",
                }
            )

    skeleton = strip_code(text, state)

    # A 档：只看骨架里的非 ASCII 字符；同类字符每行只报一次（阻断力相同，降噪）
    reported = set()
    for ch in skeleton:
        if ch.isascii() or ch in reported:
            continue
        look = HOMOGLYPH.get(ch) or _nfkc_lookalike(ch)
        if not look:
            continue
        reported.add(ch)
        a_hits.append(
            {
                "class": "A",
                "code": "A-HOMOGLYPH",
                "path": path,
                "line": lineno,
                "col": skeleton.index(ch) + 1,
                "char": _safe(ch),
                "codepoint": _cp(ch),
                "looks_like": look,
                "where": "code",
            }
        )

    # D 档：全角标点（剔除全角字母数字）；标注落在代码位还是注释/字符串内
    for ch in text:
        if ch in FULLWIDTH_PUNCT and ch not in d_hits:
            d_hits.append(ch)

    return a_hits, b_hits, c_hits, d_hits


def scan_diff(root, base, staged):
    """跑 git diff ＋ 逐行分档。返回 result dict（含 rc）。"""
    _ensure_repo(root)
    if staged:
        diff_args = ["diff", "--cached", "--unified=0", "--no-color", "--no-ext-diff"]
        mode = "staged"
        base_sha = None
    else:
        base_sha = resolve_base(root, base)
        diff_args = ["diff", "--unified=0", "--no-color", "--no-ext-diff", base_sha + "...HEAD"]
        mode = "base"

    proc = _run_git(root, diff_args)
    if proc.returncode != 0:
        tail = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        raise GateError(
            "E_DIFF",
            "git diff 失败（rc=%d）: %s" % (proc.returncode, tail[-1] if tail else ""),
        )

    # 结构解析用 surrogateescape：既不丢字节，也不猜编码（逐行再判"能否严格 UTF-8 解码"）
    diff_text = proc.stdout.decode("utf-8", "surrogateescape")
    files, added, stats = parse_added_lines(diff_text)

    # 判据故障兜底（禁"看不见当没问题"）：diff 里有 @@ 却解析不出 hunk ⇒ 解析器失效
    if "@@" in diff_text and stats["hunks"] == 0:
        raise GateError("E_PARSE", "diff 含 @@ 但未解析出任何 hunk（解析器失效）")

    findings = {"A": [], "B": [], "C": []}
    advisory = []  # [{"path","line","count","chars":[...],"where"}]
    by_file_state = {}

    for path, lineno, text in added:
        state = by_file_state.setdefault(path, {"mode": None})
        a_hits, b_hits, c_hits, d_chars = classify_line(path, lineno, text, state)
        findings["A"].extend(a_hits)
        findings["B"].extend(b_hits)
        findings["C"].extend(c_hits)
        if d_chars:
            advisory.append(
                {
                    "path": path,
                    "line": lineno,
                    "count": len(d_chars),
                    "chars": [_safe(ch) for ch in d_chars],
                }
            )

    blocking = len(findings["A"]) + len(findings["B"]) + len(findings["C"])
    rc = RC_RED if blocking else RC_OK
    if not added:
        verdict = "SKIP"
    elif blocking:
        verdict = "VIOLATION"
    else:
        verdict = "PASS"

    return {
        "tool": COMPONENT,
        "schema_version": SCHEMA_VERSION,
        "tool_version": TOOL_VERSION,
        "issue": ISSUE,
        "mode": mode,
        "base": base_sha,
        "files": len(files),
        "added_lines": len(added),
        "hunks": stats["hunks"],
        "binary_files": stats["binary"],
        "findings": findings["A"] + findings["B"] + findings["C"],
        "advisory": {"class": "D", "code": "D-FULLWIDTH-PUNCT", "items": advisory},
        "verdict": verdict,
        "exit": rc,
    }


# ── ⑦ 存量清单（只报不判）────────────────────────────────────────────────────
def scan_legacy(root, max_files, max_bytes):
    """扫存量登记件（`git ls-files` 后缀白名单）里的全角标点 / 同形字 / 替换字符。

    🔴 只作清单：本函数结果**永不参与 rc**（M-12：存量不阻断）。读工作树，
       因为本清单不承担判据职责（不引入"索引 vs 工作树"歧义成本），且 `git show` 逐件太慢。
    """
    _ensure_repo(root)
    raw = _git_out(root, ["ls-files", "-z"])
    paths = [p for p in raw.decode("utf-8", "surrogateescape").split("\0") if p]
    candidates = sorted(p for p in paths if p.endswith(_LEGACY_SUFFIXES))
    truncated = len(candidates) > max_files
    scanned = 0
    skipped = 0
    files_with_punct = 0
    punct_total = 0
    homoglyph_files = 0
    replacement_files = 0
    top = []

    for rel in candidates:
        if scanned >= max_files:
            break
        abs_path = os.path.join(root, rel)
        try:
            size = os.path.getsize(abs_path)
        except OSError:
            skipped += 1
            continue
        if size > max_bytes:
            skipped += 1
            continue
        try:
            with open(abs_path, "rb") as fh:
                data = fh.read()
        except OSError:
            skipped += 1
            continue
        scanned += 1
        text = data.decode("utf-8", "replace")
        if REPLACEMENT in text:
            replacement_files += 1
        counts = {}
        for ch in text:
            if ch in FULLWIDTH_PUNCT:
                counts[ch] = counts.get(ch, 0) + 1
        if any(not ch.isascii() and (ch in HOMOGLYPH or _nfkc_lookalike(ch)) for ch in text):
            homoglyph_files += 1
        if counts:
            files_with_punct += 1
            subtotal = sum(counts.values())
            punct_total += subtotal
            if len(top) < 20:
                top.append(
                    {
                        "path": rel,
                        "count": subtotal,
                        "chars": [_safe(ch) for ch in sorted(counts)[:6]],
                    }
                )

    return {
        "scanned": scanned,
        "skipped": skipped,
        "candidates": len(candidates),
        "truncated": truncated,
        "files_with_fullwidth_punct": files_with_punct,
        "fullwidth_punct_occurrences": punct_total,
        "files_with_homoglyph": homoglyph_files,
        "files_with_replacement_char": replacement_files,
        "top": top,
    }


# ── ⑧ 自检（判别力；改坏即红）────────────────────────────────────────────────
_SELFCHECK_CASES = (
    # (名字, 文件名, 内容(byte 字面), 期望 rc, 期望命中的档)
    ("clean-ascii", "src/ok.ts", b"export const ok = 1;\n", 0, None),
    ("chinese-comment", "src/zh.ts", "// 中文注释：全角标点（，）；ok\n".encode("utf-8"), 0, "D"),
    ("A-homoglyph", "src/a.ts", b"const p\xd0\xb0ssword = 1;\n", 1, "A"),
    ("B-bidi", "src/b.ts", b"/* x \xe2\x80\xae */\n", 1, "B"),
    ("C-replacement", "src/c.ts", b"const x = 1;\xef\xbf\xbd\n", 1, "C"),
)


def selfcheck():
    """在 mktemp 沙箱 repo 里跑六夹具；任一不符 ⇒ E_SELFCHECK（exit 2）。"""
    checks = []
    tmp = tempfile.mkdtemp(prefix="syno-unicode-selfcheck-")
    try:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        env = dict(os.environ)
        env["GIT_AUTHOR_NAME"] = "selfcheck"
        env["GIT_AUTHOR_EMAIL"] = "selfcheck@example.invalid"
        env["GIT_COMMITTER_NAME"] = "selfcheck"
        env["GIT_COMMITTER_EMAIL"] = "selfcheck@example.invalid"

        def run(args):
            proc = subprocess.run(
                ["git", "-C", repo] + list(args),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
            )
            if proc.returncode != 0:
                raise GateError(
                    "E_SELFCHECK",
                    "自检 git %s 失败: %s"
                    % (" ".join(args), proc.stderr.decode("utf-8", "replace").strip()),
                )
            return proc.stdout

        run(["init", "-q"])
        with open(os.path.join(repo, "seed.txt"), "wb") as fh:
            fh.write(b"seed\n")
        run(["add", "-A"])
        run(["commit", "-q", "-m", "seed"])
        base = run(["rev-parse", "HEAD"]).decode().strip()

        for name, rel, payload, want_rc, want_class in _SELFCHECK_CASES:
            abs_path = os.path.join(repo, rel)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(abs_path, "wb") as fh:
                fh.write(payload)
            run(["add", "-A"])
            run(["commit", "-q", "-m", "case " + name])
            result = scan_diff(repo, base, False)
            hit_classes = {item["class"] for item in result["findings"]}
            ok_rc = result["exit"] == want_rc
            ok_class = True
            if want_class in ("A", "B", "C"):
                ok_class = want_class in hit_classes
            elif want_class == "D":
                ok_class = bool(result["advisory"]["items"]) and not hit_classes
            checks.append(
                {
                    "case": name,
                    "expected_rc": want_rc,
                    "actual_rc": result["exit"],
                    "expected_class": want_class,
                    "hit_classes": sorted(hit_classes),
                    "ok": bool(ok_rc and ok_class),
                }
            )
            run(["reset", "-q", "--hard", base])  # 每夹具从同一 base 起（互不污染）

        # ⑥ 存量夹具：全角只在**已提交的存量**里（不在 diff 内）⇒ 必须 0 且清单列得到（M-12）
        legacy_rel = "src/legacy.ts"
        os.makedirs(os.path.dirname(os.path.join(repo, legacy_rel)), exist_ok=True)
        with open(os.path.join(repo, legacy_rel), "wb") as fh:
            fh.write("// 存量全角（，）\n".encode("utf-8"))
        run(["add", "-A"])
        run(["commit", "-q", "-m", "legacy seed"])
        clean_base = run(["rev-parse", "HEAD"]).decode().strip()
        with open(os.path.join(repo, "src", "new.ts"), "wb") as fh:
            fh.write(b"export const n = 1;\n")
        run(["add", "-A"])
        run(["commit", "-q", "-m", "clean diff"])
        result = scan_diff(repo, clean_base, False)
        legacy = scan_legacy(repo, 200, 2 * 1024 * 1024)
        ok_legacy = (
            result["exit"] == 0
            and not result["findings"]
            and legacy["files_with_fullwidth_punct"] >= 1
            and any(item["path"] == legacy_rel for item in legacy["top"])
        )
        checks.append(
            {
                "case": "M-12-legacy-not-blocking",
                "expected_rc": 0,
                "actual_rc": result["exit"],
                "expected_class": None,
                "hit_classes": sorted({item["class"] for item in result["findings"]}),
                "ok": bool(ok_legacy),
            }
        )
    except GateError as exc:
        degraded(exc.code, exc.msg)
        return RC_UNJUDGED, []
    finally:
        try:
            for root_dir, dirs, files in os.walk(tmp, topdown=False):
                for f in files:
                    os.remove(os.path.join(root_dir, f))
                for d in dirs:
                    os.rmdir(os.path.join(root_dir, d))
            os.rmdir(tmp)
        except OSError:  # swallow-ok: 临时目录清理失败不影响自检结论（已在上方算完）
            pass

    bad = [c for c in checks if not c["ok"]]
    if bad:
        degraded("E_SELFCHECK", "判别力自检失败: %s" % ", ".join(c["case"] for c in bad))
        return RC_UNJUDGED, checks
    return RC_OK, checks


# ── ⑨ 输出 / main ────────────────────────────────────────────────────────────
_USAGE = """用法: <py 解释器≥3.8> check-unicode-confusable.py [选项]
（本文件为 python 脚本，直接以解释器跑；bash 侧调用请走 PYBIN 探测，见 PLATFORM-CHECKLIST #1）

分档（规格 §3 W10；均只判 diff 新增行）:
  A P0 阻断  标识符/裸代码位的同形字（西里尔/希腊同形、全角字母数字）
  B P0 阻断  任意位置双向控制符 U+202A–U+202E / U+2066–U+2069
  C P0 阻断  任意位置 U+FFFD / 无法按 UTF-8 严格解码的字节
  D P2 提醒  全角标点 U+FF01–U+FF5E（剔除全角字母数字），只列清单，exit 0

选项:
  --base <ref>             对比 <ref>...HEAD 的新增行（CI 用）
  --staged                 对比暂存区（pre-commit 用；缺省即此模式）
  --json                   只输出一份合法 JSON
  --list-legacy            额外列存量（只报不判，永不进退出码）
  --legacy-max-files <n>   存量扫描文件上限（默认 6000）
  --legacy-max-bytes <n>   单件字节上限（默认 2097152）
  --selfcheck              内置六夹具判别力自检（失败 ⇒ exit 2）
  --root <dir>             仓库根（默认当前目录）
  -h, --help               本帮助

退出码: 0 通过/SKIP ｜ 1 A/B/C 命中 ｜ 2 判不了或自身失败（绝不可归 0）
"""


def print_human(result, legacy, d_limit):
    files_n = result["files"]
    added_n = result["added_lines"]
    if result["mode"] == "base":
        scope = "base=%s（diff --unified=0 base...HEAD）" % (result["base"] or "")[:12]
    else:
        scope = "git diff --cached（pre-commit 模式）"
    print("🔍 范围: %s  files=%d added=%d hunks=%d" % (scope, files_n, added_n, result["hunks"]))

    for item in result["findings"]:
        where = "标识符/裸代码位" if item["class"] == "A" else "任意位置"
        extra = ""
        if item["looks_like"]:
            extra = " 形似 '%s'" % item["looks_like"]
        print(
            "❌ [%s] %s:%d:%d %s '%s'%s —— %s（P0 阻断）"
            % (
                item["class"],
                item["path"],
                item["line"],
                item["col"],
                item["codepoint"],
                item["char"],
                extra,
                where,
            )
        )

    advisory = result["advisory"]["items"]
    if advisory:
        shown = advisory[:d_limit]
        print(
            "⚠️  [D] 全角标点（P2 仅提醒，不阻断）: %d 行%s"
            % (len(advisory), "" if len(advisory) <= d_limit else "（仅列前 %d 行）" % d_limit)
        )
        for item in shown:
            print(
                "      %s:%d  %d 处  %s"
                % (item["path"], item["line"], item["count"], "".join(item["chars"]))
            )

    if result["verdict"] == "SKIP":
        print("ℹ️  无新增行 ⇒ 无判据对象（SKIP 不是 PASS；本器不扫全仓，见 --list-legacy）")

    if legacy is not None:
        print(
            "🧾 存量遗留清单（--list-legacy；只报不判）: 扫描 %d 件（候选 %d%s），"
            "含全角标点 %d 件 / %d 处；含同形字 %d 件；含替换字符 %d 件"
            % (
                legacy["scanned"],
                legacy["candidates"],
                "，已截断" if legacy["truncated"] else "",
                legacy["files_with_fullwidth_punct"],
                legacy["fullwidth_punct_occurrences"],
                legacy["files_with_homoglyph"],
                legacy["files_with_replacement_char"],
            )
        )
        for item in legacy["top"][:5]:
            print("      %s  %d 处  %s" % (item["path"], item["count"], "".join(item["chars"])))

    counts = {"A": 0, "B": 0, "C": 0}
    for item in result["findings"]:
        counts[item["class"]] += 1
    print(
        "UNICODE-CONFUSABLE: %s files=%d added=%d a=%d b=%d c=%d d=%d"
        % (
            result["verdict"],
            files_n,
            added_n,
            counts["A"],
            counts["B"],
            counts["C"],
            len(advisory),
        )
    )


def parse_args(argv):
    opts = {
        "base": None,
        "staged": False,
        "json": False,
        "list_legacy": False,
        "legacy_max_files": 6000,
        "legacy_max_bytes": 2097152,
        "selfcheck": False,
        "root": os.getcwd(),
        "help": False,
    }
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("-h", "--help"):
            opts["help"] = True
            i += 1
        elif arg == "--base":
            if i + 1 >= len(argv):
                raise GateError("E_USAGE", "--base 缺少 <ref>")
            opts["base"] = argv[i + 1]
            i += 2
        elif arg.startswith("--base="):
            opts["base"] = arg.split("=", 1)[1]
            i += 1
        elif arg == "--staged":
            opts["staged"] = True
            i += 1
        elif arg == "--json":
            opts["json"] = True
            i += 1
        elif arg == "--list-legacy":
            opts["list_legacy"] = True
            i += 1
        elif arg in ("--legacy-max-files", "--legacy-max-bytes"):
            if i + 1 >= len(argv):
                raise GateError("E_USAGE", "%s 缺少数值" % arg)
            try:
                value = int(argv[i + 1])
            except ValueError:
                raise GateError("E_USAGE", "%s 需要整数，实得 %r" % (arg, argv[i + 1]))
            if value <= 0:
                raise GateError("E_USAGE", "%s 需为正整数" % arg)
            opts["legacy_max_files" if arg.endswith("files") else "legacy_max_bytes"] = value
            i += 2
        elif arg == "--selfcheck":
            opts["selfcheck"] = True
            i += 1
        elif arg == "--root":
            if i + 1 >= len(argv):
                raise GateError("E_USAGE", "--root 缺少 <dir>")
            opts["root"] = argv[i + 1]
            i += 2
        elif arg.startswith("--root="):
            opts["root"] = arg.split("=", 1)[1]
            i += 1
        else:
            raise GateError("E_USAGE", "未知参数: %s" % arg)
    if opts["base"] and opts["staged"]:
        raise GateError("E_USAGE", "--base 与 --staged 互斥（变更集来源只能一个）")
    return opts


def main(argv=None):
    _force_utf8_streams()
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        opts = parse_args(argv)
    except GateError as exc:
        degraded(exc.code, exc.msg)
        return RC_UNJUDGED

    if opts["help"]:
        print(_USAGE)
        return RC_OK

    if opts["selfcheck"]:
        rc, checks = selfcheck()
        if rc == RC_OK:
            print("✅ 判别力自检通过（%d 夹具）" % len(checks))
            for item in checks:
                print(
                    "   ✅ %-24s rc=%d 命中=%s（期望 rc=%d%s）"
                    % (
                        item["case"],
                        item["actual_rc"],
                        ",".join(item["hit_classes"]) or "-",
                        item["expected_rc"],
                        "" if not item["expected_class"] else "，期望档 " + item["expected_class"],
                    )
                )
        else:
            for item in checks:
                if not item["ok"]:
                    print(
                        "   ❌ %s: 实际 rc=%d 命中=%s（期望 rc=%d）"
                        % (item["case"], item["actual_rc"], item["hit_classes"], item["expected_rc"])
                    )
        print("UNICODE-CONFUSABLE-SELFCHECK: %s cases=%d" % ("PASS" if rc == RC_OK else "FAIL", len(checks)))
        return rc

    try:
        result = scan_diff(opts["root"], opts["base"], opts["staged"])
        legacy = None
        if opts["list_legacy"]:
            legacy = scan_legacy(
                opts["root"], opts["legacy_max_files"], opts["legacy_max_bytes"]
            )
    except GateError as exc:
        degraded(exc.code, exc.msg)
        if opts["json"]:
            payload = {
                "tool": COMPONENT,
                "schema_version": SCHEMA_VERSION,
                "tool_version": TOOL_VERSION,
                "issue": ISSUE,
                "verdict": "UNJUDGED",
                "exit": RC_UNJUDGED,
                "error": {"code": exc.code, "message": exc.msg},
            }
            sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        return RC_UNJUDGED
    except Exception as exc:  # noqa: BLE001 — 兜底：宁可 exit 2 也不许把 bug 当绿
        degraded("E_INTERNAL", "%s: %s" % (type(exc).__name__, exc))
        return RC_UNJUDGED

    if opts["json"]:
        payload = dict(result)
        if legacy is not None:
            payload["legacy"] = legacy
        sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    else:
        print_human(result, legacy, 20)
    return result["exit"]


if __name__ == "__main__":
    sys.exit(main())
