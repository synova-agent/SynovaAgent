#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/quality-baseline.py — #841 P0 质量基线扫描器（只测量，不阻断）

设计哲学（一句话）：把"质量"从一次性人工判断变成可复跑的计数，只产数、只棘轮、绝不接线成阻断门禁。

──────────────────────────────────────────────────────────────────────────────
契约（铁律 47）:
  @input  — CLI（显式 authority）:
              --root <dir>        扫哪棵树（默认 cwd 的 git 仓根；不存在 ⇒ exit 2）
              --ref <git-ref>     基线记录的 ref（默认 HEAD；解析到 40 hex sha）
              --out <path>        基线产物路径（默认相对 --root 的
                                  scripts/control-tower/quality-baseline.json）
              --baseline <path>   对比用的既有基线（默认相对 --root 的同一路径）
              --write-baseline    写基线（BOOTSTRAP 首跑／RATCHET 覆盖）
              --reason "<issue> <why>"  覆盖既有基线且 totals 上升时必填
              --strict            默认模式下 totals[Tn]>0 即红（1）
              --selfcheck         判别力自检（mktemp 沙箱 6 模块，不碰真实 src/**）
              --orphans-only      只跑 E5＋C10 复算，逐检查器打印 wired_to，末行 orphans=<n>/<total>
              --check-registry <yaml>   校验接线登记表（R1–R7）
              --check-inventory <yaml>  校验门禁盘点表（C1–C10b，E1–E7 同一实现）
              --json              stdout 只输出基线 JSON（诊断走 stderr）
            路径语义：--root 只影响"扫哪棵树"；--baseline／--out 相对 --root；
            YAML 子集解析器按【脚本自身仓根】定位（scripts/product-lines/），不随 --root。
  @output — 默认: 扫描摘要 + RESULT=PASS|RED（rc=0/1）；--json: 基线 JSON（stdout）
            --write-baseline: 写 JSON + BOOTSTRAP|RATCHET 行
            --selfcheck: SELFCHECK-OK t1..t5=1/1/1/1/1 clean=0
            --check-registry: 逐条 ✅/❌ + REGISTRY-OK rows=<n>
            --check-inventory: 逐条 ✅/❌ + 末行 covered=G../.. B../.. X../.. S../.. K../.. R../..
            --orphans-only: 逐检查器 wired_to + 末行 orphans=<n>/<total>
  @exit   — 0 = 通过／无回退；1 = 真红（棘轮回退／--strict 有存量／子命令有违规／判别力不足）；
            2 = 环境或检查自身失败（扫描 0 文件／基线不可读或损坏／YAML 子集不支持／
                解析器缺失／枚举器 0 项／参数互斥违例／python 异常）——信号量==0 ⇒ 2
  @degraded — 上述 exit 2 路径一律 stderr 打印 "degraded:" 前缀（fail loud，禁静默当通过）

已知限制（与 JSON `limitations[]` 逐条同步；改一处必须改两处）:
  L1 T2 启发式窗口=12 行：语句跨 12 行以外的 timeout/signal 看不见
  L2 T1 看不见动态引用/外部插件：字符串内符号、DI 容器、运行时注册、barrel 再导出不计消费者
  L3 T5 不含 tests/**/*.test.sh（P0 口径未定）
  L4 T3 启发式：同行/同语句出现 req.body/query/params（或 agent 工具的 args./input.）且
     语句内无 parse/safeParse/validate/assert 即记，未分辨真实参数位
  L5 T4 正则+括号匹配（非 AST）：catch 以注释占位（去注释后为空）也按规则计入违规
  L6 T5 正则+括号匹配（非 AST）：字符串内 it(/test( 文本不参与判定；嵌套用例计入外层块
  L7 C10 引用行位于 pre-commit 首个门禁位之前（无 owner）时记 script:scripts/pre-commit-check.sh
  L8 R4 capability pattern 取自 registry schema；规格 §2.3-D2 示例 pattern 为纯小写，
     与其自身 camelCase 样例不符 ⇒ 本仓 schema 用 [A-Za-z] 起始（规则本身不变）
  L9 T2 exec*/spawn* 只认外部进程调用形态（裸调用或 child_process.<fn>）：db.exec(／
     正则 .exec(／方法签名不计（规格字面 exec* 会把大量 SQL/正则 .exec( 误报）
  L10 E1–E7/E5 从 --root 工作树读取（干净树上等价于锚上 git show／git ls-tree；
      未跟踪的 check-*/verify-* 文件也计入 E5，不跟随 --ref）
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):  # 老 Python / 非 tty（不阻断）
    pass

# ── 三态返回码（scripts/control-tower/AGENTS.md 同口径）─────────────────────
EXIT_OK = 0
EXIT_RED = 1
EXIT_DEGRADED = 2

RULES = ("T1", "T2", "T3", "T4", "T5")
SCANNER_NAME = "quality-baseline"
SCANNER_VERSION = "1.0.0"
SCHEMA_VERSION = 1
SCOPE = ["src", "tests", "extensions"]
TS_EXTS = (".ts", ".tsx")

PRECOMMIT_PATH = "scripts/pre-commit-check.sh"
WORKFLOW_PATH = ".gitea/workflows/local-gates.yml"
CONTROL_TOWER_DIR = "scripts/control-tower"
BASELINE_REL = "scripts/control-tower/quality-baseline.json"
CHECKER_RE = re.compile(r"^(check|verify)-[^/]+\.(sh|py|ts)$")
REGISTRY_TOP_KEYS = {"schema_version", "row_key", "fields", "entries"}
DEFAULT_CAPABILITY_PATTERN = r"^[A-Za-z][A-Za-z0-9._-]{2,63}$"

# T4：仅这些「吞错式」返回语句视为违规（J8 反向判据依赖本行的字面形态）
T4_RETURN_FORMS = ("return", "returnnull", "return[]", "returnfalse")

LIMITATIONS = [
    "L1 T2 启发式窗口=12 行：语句跨 12 行以外的 timeout/signal 看不见",
    "L2 T1 看不见动态引用/外部插件：字符串内符号、DI 容器、运行时注册、barrel 再导出不计消费者",
    "L3 T5 不含 tests/**/*.test.sh（P0 口径未定）",
    "L4 T3 启发式：同行/同语句出现 req.body/query/params（或 agent 工具的 args./input.）"
    "且语句内无 parse/safeParse/validate/assert 即记，未分辨真实参数位",
    "L5 T4 正则+括号匹配（非 AST）：catch 以注释占位（去注释后为空）也按规则计入违规",
    "L6 T5 正则+括号匹配（非 AST）：字符串内 it(/test( 文本不参与判定；嵌套用例计入外层块",
    "L7 C10 引用行位于 pre-commit 首个门禁位之前（无 owner）时记 script:scripts/pre-commit-check.sh",
    "L8 R4 capability pattern 取自 registry schema；规格 §2.3-D2 示例 pattern 为纯小写，"
    "与其自身 camelCase 样例不符 ⇒ 本仓 schema 用 [A-Za-z] 起始（规则本身不变）",
    "L9 T2 exec*/spawn* 只认外部进程调用形态（裸调用或 child_process.<fn>）："
    "db.exec(／正则 .exec(／方法签名不计（规格字面 exec* 会把大量 SQL/正则 .exec( 误报）",
    "L10 E1–E7/E5 从 --root 工作树读取（干净树上等价于锚上 git show／git ls-tree；"
    "未跟踪的 check-*/verify-* 文件也计入 E5，不跟随 --ref）",
]


class QualityBaselineError(Exception):
    """typed error（`.code` 机器可读；`degraded=True` 表示环境/检查自身失败 ⇒ rc=2）。"""

    def __init__(self, code: str, message: str, degraded: bool = True):
        self.code = code
        self.message = message
        self.degraded = degraded
        self.retryable = False
        super().__init__("[%s] %s" % (code, message))


# ═══════════════════════════════════════════════════════════════════════════════
# 通用工具：路径／读文件／git／label_hash
# ═══════════════════════════════════════════════════════════════════════════════
def _norm_rel(path: str) -> str:
    return path.replace(os.sep, "/")


def resolve_root(arg_root: Optional[str]) -> str:
    """--root 默认 = cwd 的 git 仓根（显式 authority：只影响扫哪棵树）。"""
    if arg_root:
        root = os.path.abspath(arg_root)
        if not os.path.isdir(root):
            raise QualityBaselineError("E_ROOT", "根目录不存在或不是目录: %s" % arg_root)
        return root
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", errors="replace",
        )
    except OSError as exc:
        raise QualityBaselineError("E_GIT", "git 不可用，且未显式 --root: %s" % exc)
    if proc.returncode != 0:
        raise QualityBaselineError("E_ROOT", "不在 git 仓内且未显式 --root（免猜测）: %s"
                                   % (proc.stderr or "").strip()[:200])
    root = proc.stdout.strip()
    if not root:
        raise QualityBaselineError("E_ROOT", "git rev-parse --show-toplevel 输出为空")
    return root


def resolve_under_root(root: str, path: str) -> str:
    """--baseline／--out 相对 --root；绝对路径原样。"""
    if os.path.isabs(path):
        return path
    return os.path.normpath(os.path.join(root, path))


def read_text(root: str, rel: str) -> str:
    try:
        with open(os.path.join(root, rel), "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError as exc:
        raise QualityBaselineError("E_IO", "读取失败: %s (%s)" % (rel, exc))


def git_sha(root: str, ref: str) -> str:
    """解析 ref → 40 hex sha。失败 ⇒ 环境失败（rc=2，禁编造 sha）。"""
    try:
        proc = subprocess.run(
            ["git", "-C", root, "rev-parse", "--verify", "--quiet", ref + "^{commit}"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", errors="replace",
        )
    except OSError as exc:
        raise QualityBaselineError("E_GIT", "git 不可用，无法解析 --ref %s: %s" % (ref, exc))
    sha = proc.stdout.strip()
    if proc.returncode != 0 or not re.match(r"^[0-9a-f]{40}$", sha):
        raise QualityBaselineError(
            "E_GIT", "无法把 --ref %s 解析为 40 hex sha（树不是 git 仓或缺该 ref）: %s"
            % (ref, (proc.stderr or "").strip()[:200]))
    return sha


def normalize_label(line: str) -> str:
    """§2.1 label normalize（label_hash 的输入；规格样例已逐字命中）。"""
    s = line.replace("${CYAN}", "").replace("${RESET}", "").replace("echo -e ", "")
    s = s.strip()
    s = re.sub(r"^#+\s*", "", s).strip()
    s = s.strip("\"' \t")
    s = s.strip("─═ \t")
    return s


def label_hash(line: str) -> str:
    return hashlib.sha1(normalize_label(line).encode("utf-8")).hexdigest()[:12]


def module_of(rel: str) -> str:
    """module = 路径前两段；<dir>/<file> ⇒ <dir>/_root（规格 §2.3-D3）。"""
    parts = rel.split("/")
    if len(parts) >= 3:
        return "/".join(parts[:2])
    if len(parts) == 2:
        return parts[0] + "/_root"
    return "_root"


def is_test_path(rel: str) -> bool:
    base = rel.rsplit("/", 1)[-1]
    return (".test." in base or ".spec." in base
            or "/__tests__/" in "/" + rel or "/__mocks__/" in "/" + rel)


def iter_ts(root: str, rel_dir: str, exclude_test: bool = False) -> List[str]:
    """确定性遍历（目录/文件排序）。"""
    base = os.path.join(root, rel_dir)
    out: List[str] = []
    if not os.path.isdir(base):
        return out
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames.sort()
        for fn in sorted(filenames):
            if not fn.endswith(TS_EXTS):
                continue
            rel = _norm_rel(os.path.relpath(os.path.join(dirpath, fn), root))
            if exclude_test and is_test_path(rel):
                continue
            out.append(rel)
    return out


def iter_files(root: str, rel_dir: str, exts: Tuple[str, ...]) -> List[str]:
    base = os.path.join(root, rel_dir)
    out: List[str] = []
    if not os.path.isdir(base):
        return out
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames.sort()
        for fn in sorted(filenames):
            if not fn.endswith(exts):
                continue
            out.append(_norm_rel(os.path.relpath(os.path.join(dirpath, fn), root)))
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# 词法辅助：注释遮罩 / 括号匹配 / 字符串跳过
# ═══════════════════════════════════════════════════════════════════════════════
def mask_comments(text: str) -> str:
    """把注释字符替换为空格（保持长度/行号），字符串内不误判注释。"""
    out = list(text)
    i = 0
    n = len(text)
    block = False
    quote: Optional[str] = None
    while i < n:
        ch = text[i]
        if block:
            if text.startswith("*/", i):
                out[i] = " "
                if i + 1 < n:
                    out[i + 1] = " "
                block = False
                i += 2
            else:
                if ch != "\n":
                    out[i] = " "
                i += 1
            continue
        if quote is not None:
            if ch == "\\" and i + 1 < n:
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if text.startswith("//", i):
            while i < n and text[i] != "\n":
                out[i] = " "
                i += 1
            continue
        if text.startswith("/*", i):
            out[i] = " "
            if i + 1 < n:
                out[i + 1] = " "
            block = True
            i += 2
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            i += 1
            continue
        i += 1
    return "".join(out)


def match_pair(masked: str, open_idx: int, open_ch: str, close_ch: str) -> Optional[int]:
    """从 open_idx（指向 open_ch）起做括号匹配；跳过字符串字面量。"""
    depth = 0
    i = open_idx
    n = len(masked)
    quote: Optional[str] = None
    while i < n:
        ch = masked[i]
        if quote is not None:
            if ch == "\\" and i + 1 < n:
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            i += 1
            continue
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def find_expect_calls(masked: str, start: int, end: int) -> List[Dict[str, str]]:
    """在 [start,end) 内找 `expect(` 调用（跳过字符串），返回 arg 与 matcher 链文本。"""
    calls: List[Dict[str, str]] = []
    i = start
    while i < end:
        ch = masked[i]
        if ch in ("'", '"', "`"):
            i = skip_string(masked, i)
            continue
        if masked.startswith("expect", i):
            prev_ok = i == 0 or not (masked[i - 1].isalnum() or masked[i - 1] in "_$")
            j = i + len("expect")
            while j < end and masked[j] in " \t":
                j += 1
            if prev_ok and j < end and masked[j] == "(":
                close = match_pair(masked, j, "(", ")")
                if close is not None and close <= end:
                    calls.append({
                        "arg": masked[j + 1:close],
                        "rest": masked[close + 1:min(end, close + 160)],
                    })
                    i = close + 1
                    continue
        i += 1
    return calls


def skip_string(text: str, idx: int) -> int:
    quote = text[idx]
    i = idx + 1
    n = len(text)
    while i < n:
        if text[i] == "\\" and i + 1 < n:
            i += 2
            continue
        if text[i] == quote:
            return i + 1
        i += 1
    return n


def mask_strings(text: str) -> str:
    """把字符串字面量内容替换为空格（保持长度/行号）：用于「只认真实代码 token」的规则（T2/T3）。"""
    out = list(text)
    i = 0
    n = len(text)
    while i < n:
        if text[i] in ("'", '"', "`"):
            end = skip_string(text, i)
            for k in range(i, min(end, n)):
                if out[k] != "\n":
                    out[k] = " "
            i = end
            continue
        i += 1
    return "".join(out)


_LITERAL_NUM_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
_LITERAL_STR_RE = re.compile(r"^(?:'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")$")
_MATCHER_RE = re.compile(r"^(\.not)?\.([A-Za-z]+)\s*\(([^)]*)\)")


def literal_value(expr: str) -> Optional[str]:
    e = expr.strip()
    if e in ("true", "false"):
        return e
    if _LITERAL_NUM_RE.match(e):
        return e
    if _LITERAL_STR_RE.match(e):
        return e
    return None


def expect_is_tautology(call: Dict[str, str]) -> bool:
    lit = literal_value(call["arg"])
    if lit is None:
        return False
    rest = call["rest"].strip()
    m = _MATCHER_RE.match(rest)
    if not m:
        return True  # 裸 expect(true)：静态恒真
    if m.group(1):
        return False
    if m.group(2) in ("toBe", "toEqual"):
        return literal_value(m.group(3)) == lit
    return False


def expect_is_weak(call: Dict[str, str]) -> bool:
    m = _MATCHER_RE.match(call["rest"].strip())
    if not m:
        return False
    neg, name, arg = m.group(1), m.group(2), m.group(3).strip()
    if not neg and name in ("toBeDefined", "toBeTruthy") and arg == "":
        return True
    if neg and name == "toBeNull" and arg == "":
        return True
    return False


# ═══════════════════════════════════════════════════════════════════════════════
# 5 类检查（T1–T5）；语义不得变，细化正则允许
# ═══════════════════════════════════════════════════════════════════════════════
_DECL_RE = re.compile(
    r"\bexport\s+(?:async\s+)?(function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)")
_IDENT_RE = re.compile(r"[A-Za-z_$][\w$]*")
_IMPORTISH_RE = re.compile(
    r"^\s*(?:import\b|export\s+\{[^}]*\}\s+from\b|export\s+\*\s+from\b"
    r"|export\s+type\s+\{[^}]*\}\s+from\b)")
_KEYWORDS = {"function", "class", "const", "let", "interface", "type", "enum", "async", "export"}

_FETCH_RE = re.compile(r"\bfetch\s*\(")
# exec/spawn 只认「外部进程」调用形态：裸标识符调用或 child_process.<fn>；
# 排除 db.exec( / 正则 .exec( / 关键字字符串表（字符串先 mask 掉）
_TIMEOUT_CALL_RE = re.compile(
    r"(?:\baxios(?:\.\w+)?\s*\(|\bhttps?\.request\s*\("
    r"|(?:(?<![\w$.])(?:execFileSync|execFile|execSync|spawnSync|exec|spawn)"
    r"|child_process\.(?:exec\w*|spawn\w*))\s*\()")
_FETCH_GUARD_RE = re.compile(r"\bsignal\s*:|AbortSignal\.timeout|\btimeout\b")
_TIMEOUT_GUARD_RE = re.compile(r"\btimeout\b")

_REQ_RE = re.compile(r"\breq\.(?:body|query|params)\b")
_TOOL_INPUT_RE = re.compile(r"(?<![\w$.])(?:args|input)\.")
_VALIDATE_RE = re.compile(r"\b(?:parse|safeParse|validate|assert)\s*\(")
_ASSIGN_REQ_RE = re.compile(
    r"^\s*(?:const|let|var)\b[^=]*=\s*(?:req\.(?:body|query|params)|(?:args|input))\b")

_CATCH_RE = re.compile(r"(?<![\w$.])catch\s*(?:\([^)\n]*\))?\s*\{")
_SWALLOW_OK = "swallow-ok"
_LOG_TOKEN_RE = re.compile(r"\b(?:log|logger|console)\.|degraded|throw\b")


def scan_t1(root: str, violations: List[Dict[str, Any]]) -> int:
    files = [f for f in iter_ts(root, "src") if not is_test_path(f)]
    decls: List[Tuple[str, str, int]] = []
    real: Dict[Tuple[str, str], int] = {}
    imported: Dict[Tuple[str, str], int] = {}
    for rel in files:
        masked = mask_comments(read_text(root, rel))
        for lineno, line in enumerate(masked.split("\n"), 1):
            if not line.strip():
                continue
            if _IMPORTISH_RE.match(line):
                for m in _IDENT_RE.finditer(line):
                    key = (rel, m.group(0))
                    imported[key] = imported.get(key, 0) + 1
                continue
            for m in _DECL_RE.finditer(line):
                name = m.group(2)
                if name in _KEYWORDS:
                    continue
                decls.append((name, rel, lineno))
            for m in _IDENT_RE.finditer(line):
                key = (rel, m.group(0))
                real[key] = real.get(key, 0) + 1

    per_name: Dict[str, int] = {}
    for (rel, name), cnt in real.items():
        per_name[name] = per_name.get(name, 0) + cnt
    per_name_import: Dict[str, int] = {}
    for (rel, name), cnt in imported.items():
        per_name_import[name] = per_name_import.get(name, 0) + cnt

    seen: Set[Tuple[str, str]] = set()
    for name, rel, lineno in decls:
        if (name, rel) in seen:
            continue
        seen.add((name, rel))
        own = real.get((rel, name), 0)
        external_real = per_name.get(name, 0) - own
        if external_real > 0:
            continue
        external_import = per_name_import.get(name, 0) - imported.get((rel, name), 0)
        bucket = "import-only" if external_import > 0 else "no-consumer"
        violations.append({
            "check": "T1", "path": rel, "line": lineno,
            "detail": "%s %s（定义文件外生产消费者=0）" % (name, bucket),
        })
    return len(files)


def scan_t2(root: str, violations: List[Dict[str, Any]]) -> int:
    files = [f for f in iter_ts(root, "src") if not is_test_path(f)]
    for rel in files:
        lines = mask_strings(mask_comments(read_text(root, rel))).split("\n")
        for i, line in enumerate(lines):
            if _FETCH_RE.search(line):
                window = "\n".join(lines[i:i + 12])
                if not _FETCH_GUARD_RE.search(window):
                    violations.append({
                        "check": "T2", "path": rel, "line": i + 1,
                        "detail": "fetch 12 行窗口内无 signal:/AbortSignal.timeout/timeout",
                    })
            elif _TIMEOUT_CALL_RE.search(line):
                window = "\n".join(lines[i:i + 12])
                call_match = _TIMEOUT_CALL_RE.search(line)
                open_idx = call_match.end() - 1
                close_idx = match_pair(window, open_idx, "(", ")")
                if close_idx is not None and window[close_idx + 1:].lstrip().startswith(":"):
                    continue  # 方法签名/类型字面量（exec(sql: string): void），不是调用
                if not _TIMEOUT_GUARD_RE.search(window):
                    violations.append({
                        "check": "T2", "path": rel, "line": i + 1,
                        "detail": "axios/exec/spawn/http.request 12 行窗口内无 timeout",
                    })
    return len(files)


def scan_t3(root: str, violations: List[Dict[str, Any]]) -> int:
    files: List[str] = []
    for sub in ("src/routes", "src/mcp"):
        files.extend([f for f in iter_ts(root, sub) if not is_test_path(f)])
    for extra in ("src/agent/tools.ts", "src/agent/builtin-tools.ts"):
        if os.path.isfile(os.path.join(root, extra)):
            files.append(extra)
    files = sorted(set(files))
    for rel in files:
        lines = mask_strings(mask_comments(read_text(root, rel))).split("\n")
        tool_scope = rel in ("src/agent/tools.ts", "src/agent/builtin-tools.ts")
        pattern = _TOOL_INPUT_RE if tool_scope else _REQ_RE
        for i, line in enumerate(lines):
            if not pattern.search(line):
                continue
            if _ASSIGN_REQ_RE.match(line):
                continue
            stmt = [line]
            j = i
            while j + 1 < len(lines) and not lines[j].rstrip().endswith(";") and len(stmt) < 6:
                j += 1
                stmt.append(lines[j])
            joined = "\n".join(stmt)
            if _VALIDATE_RE.search(joined):
                continue
            detail = ("工具入参 args./input. 直传且语句内无 parse/safeParse/validate/assert"
                      if tool_scope else
                      "req.body/query/params 直传且语句内无 parse/safeParse/validate/assert")
            violations.append({"check": "T3", "path": rel, "line": i + 1, "detail": detail})
    return len(files)


def scan_t4(root: str, violations: List[Dict[str, Any]],
            exemptions: List[Dict[str, Any]]) -> int:
    files: List[str] = []
    for sub in ("src", "extensions"):
        files.extend([f for f in iter_ts(root, sub) if not is_test_path(f)])
    files = sorted(set(files))
    for rel in files:
        text = read_text(root, rel)
        masked = mask_comments(text)
        for m in _CATCH_RE.finditer(masked):
            open_idx = masked.find("{", m.start(), m.end())
            if open_idx < 0:
                continue
            close_idx = match_pair(masked, open_idx, "{", "}")
            if close_idx is None:
                continue
            line = masked.count("\n", 0, m.start()) + 1
            if _SWALLOW_OK in text[m.start():close_idx + 1]:
                exemptions.append({"check": "T4", "path": rel, "line": line,
                                   "reason": "swallow-ok"})
                continue
            body = masked[open_idx + 1:close_idx]
            if _LOG_TOKEN_RE.search(body):
                continue
            compact = re.sub(r"\s+", "", body)
            if compact == "":
                violations.append({"check": "T4", "path": rel, "line": line,
                                   "detail": "空 catch 且无 log/logger/console/degraded/throw"})
                continue
            stmts = [s for s in compact.split(";") if s]
            if stmts and all(s in T4_RETURN_FORMS for s in stmts):
                violations.append({
                    "check": "T4", "path": rel, "line": line,
                    "detail": "catch 仅 return/return null/return []/return false 且无 log/throw",
                })
    return len(files)


_CASE_RE = re.compile(r"(?<![\w$.])(it|test)(\.[A-Za-z]+)?\s*\(")


def scan_t5(root: str, violations: List[Dict[str, Any]]) -> int:
    files = [f for f in iter_ts(root, "tests") if ".test." in f.rsplit("/", 1)[-1]]
    files = sorted(set(files))
    for rel in files:
        masked = mask_comments(read_text(root, rel))
        cases: List[Dict[str, Any]] = []
        for m in _CASE_RE.finditer(masked):
            mod = m.group(2) or ""
            open_idx = m.end() - 1
            close_idx = match_pair(masked, open_idx, "(", ")")
            if close_idx is None:
                continue
            if mod in (".each", ".skipIf"):
                j = close_idx + 1
                while j < len(masked) and masked[j] in " \t\r\n":
                    j += 1
                if j < len(masked) and masked[j] == "<":
                    gt = masked.find(">", j)
                    if gt != -1:
                        j = gt + 1
                        while j < len(masked) and masked[j] in " \t\r\n":
                            j += 1
                if j < len(masked) and masked[j] == "(":
                    open_idx = j
                    close_idx = match_pair(masked, j, "(", ")")
                    if close_idx is None:
                        continue
            cases.append({
                "line": masked.count("\n", 0, open_idx) + 1,
                "mod": mod, "open": open_idx, "close": close_idx,
            })
        enabled = 0
        for case in cases:
            if case["mod"] in (".skip", ".todo"):
                continue
            enabled += 1
            calls = find_expect_calls(masked, case["open"] + 1, case["close"])
            if not calls:
                violations.append({"check": "T5", "path": rel, "line": case["line"],
                                   "detail": "用例块内 expect( 数=0"})
                continue
            if all(expect_is_tautology(c) for c in calls):
                violations.append({"check": "T5", "path": rel, "line": case["line"],
                                   "detail": "恒真断言且无其他断言"})
                continue
            if len(calls) == 1 and expect_is_weak(calls[0]):
                violations.append({"check": "T5", "path": rel, "line": case["line"],
                                   "detail": "唯一断言是 toBeDefined/toBeTruthy/not.toBeNull"})
        if cases and enabled == 0:
            violations.append({"check": "T5", "path": rel, "line": cases[0]["line"],
                               "detail": "全文件仅 skip/todo，零启用用例"})
    return len(files)


def scan_tree(root: str) -> Dict[str, Any]:
    """扫 src/tests/extensions，返回 totals/modules/violations/exemptions。"""
    violations: List[Dict[str, Any]] = []
    exemptions: List[Dict[str, Any]] = []
    scanned: List[str] = []
    for sub in SCOPE:
        scanned.extend(iter_ts(root, sub))
    scanned = sorted(set(scanned))
    scan_t1(root, violations)
    scan_t2(root, violations)
    scan_t3(root, violations)
    scan_t4(root, violations, exemptions)
    scan_t5(root, violations)

    violations.sort(key=lambda v: (v["check"], v["path"], v["line"], v["detail"]))
    exemptions.sort(key=lambda v: (v["check"], v["path"], v["line"], v["reason"]))

    modules: Dict[str, Dict[str, Any]] = {}
    for rel in scanned:
        mod = module_of(rel)
        if mod not in modules:
            modules[mod] = {
                "module": mod, "files_scanned": 0,
                "violations": {rule: 0 for rule in RULES}, "total": 0,
            }
        modules[mod]["files_scanned"] += 1
    for viol in violations:
        mod = module_of(viol["path"])
        if mod not in modules:  # 规则可能扫到未计入 scanned 的路径（正常不出现）
            modules[mod] = {
                "module": mod, "files_scanned": 0,
                "violations": {rule: 0 for rule in RULES}, "total": 0,
            }
        modules[mod]["violations"][viol["check"]] += 1
        modules[mod]["total"] += 1

    totals = {rule: 0 for rule in RULES}
    for viol in violations:
        totals[viol["check"]] += 1

    return {
        "totals": totals,
        "modules": [modules[m] for m in sorted(modules)],
        "violations": violations,
        "exemptions": exemptions,
        "files_scanned": len(scanned),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 基线 JSON ＋ 默认对比 ＋ --write-baseline
# ═══════════════════════════════════════════════════════════════════════════════
def build_json(scan: Dict[str, Any], ref: str, sha: str, reason: Optional[str]) -> Dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "scanner": {
            "name": SCANNER_NAME,
            "version": SCANNER_VERSION,
            "rules": list(RULES),
            "ratchet_reason": reason,
        },
        "as_of": {"ref": ref, "sha": sha},
        "scope": list(SCOPE),
        "totals": scan["totals"],
        "modules": scan["modules"],
        "violations": scan["violations"],
        "exemptions": scan["exemptions"],
        "limitations": list(LIMITATIONS),
    }


def dump_json(obj: Dict[str, Any]) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def load_baseline(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except OSError as exc:
        raise QualityBaselineError("E_BASELINE", "基线不可读: %s (%s)" % (path, exc))
    except ValueError as exc:
        raise QualityBaselineError("E_BASELINE", "基线损坏（JSON 解析失败）: %s (%s)" % (path, exc))
    if not isinstance(data, dict):
        raise QualityBaselineError("E_BASELINE", "基线损坏（顶层不是对象）: %s" % path)
    totals = data.get("totals")
    if not isinstance(totals, dict) or any(
            not isinstance(totals.get(rule), int) for rule in RULES):
        raise QualityBaselineError("E_BASELINE", "基线损坏（totals 缺 T1–T5 整数）: %s" % path)
    modules = data.get("modules")
    if not isinstance(modules, list):
        raise QualityBaselineError("E_BASELINE", "基线损坏（modules 不是列表）: %s" % path)
    for mod in modules:
        if not isinstance(mod, dict) or not isinstance(mod.get("module"), str) \
                or not isinstance(mod.get("total"), int):
            raise QualityBaselineError("E_BASELINE", "基线损坏（modules 行缺 module/total）: %s" % path)
    return data


def write_baseline_file(path: str, payload: str) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    try:
        os.makedirs(parent, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".quality-baseline-", dir=parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(payload)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    except OSError as exc:
        raise QualityBaselineError("E_IO", "写基线失败: %s (%s)" % (path, exc))


def _violations_for_check(scan: Dict[str, Any], check: str) -> List[Dict[str, Any]]:
    return [v for v in scan["violations"] if v["check"] == check]


def _print_violations(items: List[Dict[str, Any]], limit: int = 200) -> None:
    for viol in items[:limit]:
        print("  - %s %s:%d %s" % (viol["check"], viol["path"], viol["line"], viol["detail"]))
    if len(items) > limit:
        print("  … 其余 %d 条省略（见 --write-baseline 产物）" % (len(items) - limit))


def cmd_scan_compare(root: str, baseline_path: str, strict: bool, as_json: bool) -> int:
    baseline = load_baseline(baseline_path)
    scan = scan_tree(root)
    if scan["files_scanned"] == 0:
        raise QualityBaselineError("E_EMPTY", "扫描到 0 个文件（信号量==0 ⇒ 不是通过）: %s" % root)
    if not scan["modules"]:
        raise QualityBaselineError("E_EMPTY", "扫描到 0 个模块（信号量==0 ⇒ 不是通过）: %s" % root)

    cur_totals = scan["totals"]
    base_totals = baseline["totals"]
    total_regressions = [rule for rule in RULES if cur_totals[rule] > base_totals[rule]]

    base_modules = {m["module"]: m["total"] for m in baseline["modules"]}
    module_regressions: List[Tuple[str, int, int]] = []
    for mod in scan["modules"]:
        base_total = base_modules.get(mod["module"], 0)
        if mod["total"] > base_total:
            module_regressions.append((mod["module"], mod["total"], base_total))

    red = bool(total_regressions or module_regressions)
    if strict and not red and any(cur_totals[rule] > 0 for rule in RULES):
        red = True

    if as_json:
        sha = git_sha(root, "HEAD")
        print(dump_json(build_json(scan, "HEAD", sha, None)), end="")
        return EXIT_RED if red else EXIT_OK

    print("QUALITY-BASELINE files=%d modules=%d" % (scan["files_scanned"], len(scan["modules"])))
    print("totals T1=%d T2=%d T3=%d T4=%d T5=%d"
          % tuple(cur_totals[rule] for rule in RULES))
    print("baseline=%s" % baseline_path)
    if red:
        if total_regressions:
            print("RATCHET-RED totals: %s" % ", ".join(
                "%s %d > %d" % (rule, cur_totals[rule], base_totals[rule])
                for rule in total_regressions))
        if module_regressions:
            print("RATCHET-RED modules: %s" % ", ".join(
                "%s %d > %d" % item for item in module_regressions))
        shown: List[Dict[str, Any]] = []
        for rule in total_regressions:
            shown.extend(_violations_for_check(scan, rule))
        regressed = {item[0] for item in module_regressions}
        shown.extend([v for v in scan["violations"] if module_of(v["path"]) in regressed])
        dedup: List[Dict[str, Any]] = []
        seen_keys: Set[Tuple[str, str, int]] = set()
        for viol in shown:
            key = (viol["check"], viol["path"], viol["line"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            dedup.append(viol)
        _print_violations(dedup)
        if strict and not total_regressions and not module_regressions:
            print("STRICT-RED 存量 totals: %s" % ", ".join(
                "%s=%d" % (rule, cur_totals[rule]) for rule in RULES if cur_totals[rule] > 0))
        print("RESULT=RED")
        return EXIT_RED
    print("RESULT=PASS")
    return EXIT_OK


def cmd_write_baseline(root: str, out_path: str, reason: Optional[str]) -> int:
    scan = scan_tree(root)
    if scan["files_scanned"] == 0 or not scan["modules"]:
        raise QualityBaselineError("E_EMPTY", "扫描到 0 文件/0 模块（信号量==0 ⇒ 不写基线）: %s" % root)
    sha = git_sha(root, "HEAD")
    first_run = not os.path.exists(out_path)
    up: List[Tuple[str, int, int]] = []
    if not first_run:
        existing = load_baseline(out_path)
        old = existing["totals"]
        up = [(rule, scan["totals"][rule], old[rule]) for rule in RULES
              if scan["totals"][rule] > old[rule]]
        if up and not reason:
            raise QualityBaselineError(
                "E_REASON", "覆盖既有基线且 totals 上升但缺 --reason: %s"
                % ", ".join("%s %d > %d" % item for item in up), degraded=False)
    payload = dump_json(build_json(scan, "HEAD", sha, reason))
    write_baseline_file(out_path, payload)
    totals_text = "T1=%d T2=%d T3=%d T4=%d T5=%d" % tuple(
        scan["totals"][rule] for rule in RULES)
    if first_run:
        print("BOOTSTRAP ref=HEAD sha=%s %s files=%d modules=%d"
              % (sha, totals_text, scan["files_scanned"], len(scan["modules"])))
    else:
        print("RATCHET ref=HEAD sha=%s %s" % (sha, totals_text))
        if up:
            print("RATCHET-UP %s reason=%s" % (
                ", ".join("%s %d > %d" % item for item in up), reason))
    print("out=%s" % out_path)
    return EXIT_OK


# ═══════════════════════════════════════════════════════════════════════════════
# --selfcheck（判别力自检：6 模块沙箱，不读写真实 src/**）
# ═══════════════════════════════════════════════════════════════════════════════
_SELF_CLEAN_A = "export function cleanFn() {\n  return 1;\n}\n"
_SELF_CLEAN_B = "import { cleanFn } from './a';\n\ncleanFn();\n"
_SELF_T1_A = "export function orphanAlpha() {\n  return 1;\n}\n"
_SELF_T2_A = "async function loadData() {\n  return fetch('/x');\n}\n"
_SELF_T3_A = "function handler(req: any, res: any) {\n  res.json(req.body.user);\n}\n"
_SELF_T4_A = "function swallow() {\n  try {\n    risky();\n  } catch (e) {\n    return [];\n  }\n}\n"
_SELF_T5_A = "it('x', () => {\n  expect(true).toBe(true);\n});\n"

_SELF_FIX_T1_B = "import { orphanAlpha } from './a';\n\norphanAlpha();\n"
_SELF_FIX_T2_A = "async function loadData() {\n  return fetch('/x', { signal: AbortSignal.timeout(1000) });\n}\n"
_SELF_FIX_T3_A = "function handler(req: any, res: any) {\n  res.json(schema.parse(req.body).data);\n}\n"
_SELF_FIX_T4_A = "function swallow() {\n  try {\n    risky();\n  } catch (e) {\n    console.warn('e', e);\n  }\n}\n"
_SELF_FIX_T5_A = "it('x', () => {\n  expect(add(1, 2)).toBe(3);\n});\n"


def _write_fixture(base: str, rel: str, content: str) -> None:
    path = os.path.join(base, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)


def cmd_selfcheck() -> int:
    try:
        sandbox = tempfile.mkdtemp(prefix="quality-baseline-selfcheck-")
    except OSError as exc:
        raise QualityBaselineError("E_SANDBOX", "自检沙箱不可建: %s" % exc)
    try:
        files = {
            "src/clean/a.ts": _SELF_CLEAN_A,
            "src/clean/b.ts": _SELF_CLEAN_B,
            "src/t1/a.ts": _SELF_T1_A,
            "src/t2/a.ts": _SELF_T2_A,
            "src/routes/a.ts": _SELF_T3_A,
            "src/t4/a.ts": _SELF_T4_A,
            "tests/t5/a.test.ts": _SELF_T5_A,
        }
        for rel, content in files.items():
            _write_fixture(sandbox, rel, content)
        scan = scan_tree(sandbox)
        if scan["files_scanned"] == 0 or not scan["modules"]:
            raise QualityBaselineError("E_SANDBOX", "自检沙箱模块数==0（信号量==0 ⇒ exit 2）")
        totals = scan["totals"]
        clean_total = 0
        for mod in scan["modules"]:
            if mod["module"] == "src/clean":
                clean_total = mod["total"]
        broken = [rule for rule in RULES if totals[rule] != 1]
        if broken or sum(totals.values()) != 5 or clean_total != 0:
            print("SELFCHECK-FAIL 改坏前 t1..t5=%s total=%d clean=%d 期望=1/1/1/1/1 total=5 clean=0"
                  % ("/".join(str(totals[r]) for r in RULES), sum(totals.values()), clean_total))
            return EXIT_RED

        fixed = {
            "src/t1/a.ts": _SELF_T1_A,
            "src/t1/b.ts": _SELF_FIX_T1_B,
            "src/t2/a.ts": _SELF_FIX_T2_A,
            "src/routes/a.ts": _SELF_FIX_T3_A,
            "src/t4/a.ts": _SELF_FIX_T4_A,
            "tests/t5/a.test.ts": _SELF_FIX_T5_A,
        }
        for rel, content in fixed.items():
            _write_fixture(sandbox, rel, content)
        scan_fixed = scan_tree(sandbox)
        totals_fixed = scan_fixed["totals"]
        if any(totals_fixed[rule] != 0 for rule in RULES):
            print("SELFCHECK-FAIL 改好后 t1..t5=%s（期望全 0 ⇒ 判别力不足）"
                  % "/".join(str(totals_fixed[r]) for r in RULES))
            return EXIT_RED
        print("SELFCHECK-OK t1..t5=1/1/1/1/1 clean=0")
        return EXIT_OK
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════════════════
# YAML 子集解析器定位（脚本自身仓根；不随 --root）＋ --check-registry
# ═══════════════════════════════════════════════════════════════════════════════
def load_productline_yaml(script_path: str) -> Any:
    """按脚本自身仓根定位 scripts/product-lines/productline_yaml.py（禁自写解析器）。"""
    script_dir = os.path.dirname(os.path.abspath(script_path))
    candidates = [
        os.path.normpath(os.path.join(script_dir, "..", "product-lines", "productline_yaml.py")),
        os.path.normpath(os.path.join(script_dir, "..", "..", "product-lines",
                                      "productline_yaml.py")),
    ]
    try:
        proc = subprocess.run(
            ["git", "-C", script_dir, "rev-parse", "--show-toplevel"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", errors="replace",
        )
        if proc.returncode == 0 and proc.stdout.strip():
            candidates.append(os.path.join(proc.stdout.strip(), "scripts", "product-lines",
                                           "productline_yaml.py"))
    except OSError:
        pass
    selected = next((c for c in candidates if os.path.isfile(c)), None)
    if not selected:
        raise QualityBaselineError(
            "E_PARSER", "YAML 子集解析器缺失（脚本自身仓根 scripts/product-lines/），"
                        "禁自写解析器: %s" % "; ".join(candidates[:2]))
    import importlib.util
    spec = importlib.util.spec_from_file_location("productline_yaml_841", selected)
    if spec is None or spec.loader is None:
        raise QualityBaselineError("E_PARSER", "解析器无法加载: %s" % selected)
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as exc:  # 解析器自身故障 ⇒ 检查自身失败
        raise QualityBaselineError("E_PARSER", "解析器加载异常: %s (%s)" % (selected, exc))
    return module


def load_yaml_file(script_path: str, yaml_path: str) -> Dict[str, Any]:
    module = load_productline_yaml(script_path)
    try:
        data = module.load_file(yaml_path)
    except Exception as exc:
        raise QualityBaselineError("E_YAML", "YAML 子集解析失败: %s (%s)" % (yaml_path, exc))
    if not isinstance(data, dict):
        raise QualityBaselineError("E_YAML", "YAML 顶层不是映射: %s" % yaml_path)
    return data


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return str(value).strip()


def _check_path_line(root: str, raw: str) -> Optional[str]:
    """R5: `path:line` 文件存在、行号 ≤ 行数（无行号则只要文件存在）。"""
    text = _as_text(raw)
    if not text:
        return None
    path_part, line_part = text, ""
    if ":" in text:
        path_part, line_part = text.rsplit(":", 1)
    if not path_part:
        return "%s 不是 path:line" % text
    full = path_part if os.path.isabs(path_part) else os.path.join(root, _norm_rel(path_part))
    if not os.path.isfile(full):
        return "%s 文件不存在" % path_part
    if line_part:
        if not re.match(r"^\d+$", line_part):
            return "%s 行号不是整数" % text
        lineno = int(line_part)
        if lineno < 1:
            return "%s 行号 < 1" % text
        try:
            with open(full, "r", encoding="utf-8", errors="replace") as fh:
                total = sum(1 for _ in fh)
        except OSError as exc:
            return "%s 不可读 (%s)" % (path_part, exc)
        if lineno > total:
            return "%s 行号 %d > 文件行数 %d" % (path_part, lineno, total)
    return None


def cmd_check_registry(root: str, script_path: str, yaml_path: str) -> int:
    data = load_yaml_file(script_path, yaml_path)
    failures: List[str] = []
    print("REGISTRY %s" % yaml_path)

    extra_top = sorted(set(data.keys()) - REGISTRY_TOP_KEYS)
    ok = not extra_top
    print("  %s R1 顶层键 ⊆ {schema_version, row_key, fields, entries}%s"
          % ("✅" if ok else "❌", "" if ok else "  多余键: %s" % ", ".join(extra_top)))
    if not ok:
        failures.append("R1 顶层键多余: %s" % ", ".join(extra_top))

    fields_def = data.get("fields")
    field_names: List[str] = []
    field_defs: Dict[str, Dict[str, Any]] = {}
    if isinstance(fields_def, list):
        for item in fields_def:
            if isinstance(item, dict) and isinstance(item.get("name"), str):
                field_names.append(item["name"])
                field_defs[item["name"]] = item
    entries = data.get("entries")
    rows: List[Dict[str, Any]] = [e for e in entries if isinstance(e, dict)] \
        if isinstance(entries, list) else []

    # R2 行键 ⊆ fields.name（禁静默忽略多余键）
    bad_keys: List[str] = []
    for idx, row in enumerate(rows):
        for key in row.keys():
            if key not in field_names:
                bad_keys.append("entries[%d].%s" % (idx, key))
    ok = not bad_keys
    print("  %s R2 行键 ⊆ fields.name（%d 行）%s"
          % ("✅" if ok else "❌", len(rows), "" if ok else "  多余: %s" % ", ".join(bad_keys)))
    if not ok:
        failures.append("R2 %s" % ", ".join(bad_keys))

    # R3 required 字段非空
    missing_required: List[str] = []
    for idx, row in enumerate(rows):
        for name in field_names:
            if field_defs[name].get("required") is True and not _as_text(row.get(name)):
                missing_required.append("entries[%d].%s" % (idx, name))
    ok = not missing_required
    print("  %s R3 required 字段非空%s"
          % ("✅" if ok else "❌", "" if ok else "  缺: %s" % ", ".join(missing_required)))
    if not ok:
        failures.append("R3 %s" % ", ".join(missing_required))

    # R4 capability 唯一 + pattern（pattern 来自 schema）
    pattern_text = _as_text((field_defs.get("capability") or {}).get("pattern")) \
        or DEFAULT_CAPABILITY_PATTERN
    try:
        cap_re = re.compile(pattern_text)
    except re.error as exc:
        raise QualityBaselineError("E_YAML", "capability pattern 非法: %s (%s)"
                                   % (pattern_text, exc))
    caps: List[str] = []
    cap_problems: List[str] = []
    for idx, row in enumerate(rows):
        cap = _as_text(row.get("capability"))
        if not cap_re.match(cap):
            cap_problems.append("entries[%d].capability=%r 不匹配 %s" % (idx, cap, pattern_text))
        if cap in caps:
            cap_problems.append("entries[%d].capability=%r 重复" % (idx, cap))
        caps.append(cap)
    ok = not cap_problems
    print("  %s R4 capability 唯一且匹配 pattern%s"
          % ("✅" if ok else "❌", "" if ok else "  %s" % "; ".join(cap_problems)))
    if not ok:
        failures.append("R4 %s" % "; ".join(cap_problems))

    # R5 path:line 存在且行号在界内
    path_problems: List[str] = []
    loc_fields = [name for name in ("defined_at", "provider", "consumer", "test")
                  if name in field_names or any(name in r for r in rows)]
    for idx, row in enumerate(rows):
        for name in loc_fields:
            raw = row.get(name)
            if raw is None or _as_text(raw) == "":
                continue
            problem = _check_path_line(root, _as_text(raw))
            if problem:
                path_problems.append("entries[%d].%s %s" % (idx, name, problem))
    ok = not path_problems
    print("  %s R5 path:line 文件存在且行号在界内%s"
          % ("✅" if ok else "❌", "" if ok else "  %s" % "; ".join(path_problems)))
    if not ok:
        failures.append("R5 %s" % "; ".join(path_problems))

    # R6 status ↔ 字段一致
    status_problems: List[str] = []
    for idx, row in enumerate(rows):
        status = _as_text(row.get("status"))
        consumer = _as_text(row.get("consumer"))
        test = _as_text(row.get("test"))
        retired_reason = _as_text(row.get("retired_reason"))
        if status == "wired":
            if not consumer:
                status_problems.append("entries[%d].consumer：status=wired 需非空" % idx)
            if not test:
                status_problems.append("entries[%d].test：status=wired 需非空" % idx)
        elif status == "declared-only":
            if consumer:
                status_problems.append(
                    "entries[%d].consumer：status=declared-only 需为空（实为 %r）" % (idx, consumer))
        elif status == "retired":
            if not retired_reason:
                status_problems.append(
                    "entries[%d].retired_reason：status=retired 需非空" % idx)
        elif status not in ("partial", "wired", "declared-only", "retired"):
            status_problems.append("entries[%d].status=%r 不在枚举内" % (idx, status))
    ok = not status_problems
    print("  %s R6 status↔字段一致%s"
          % ("✅" if ok else "❌", "" if ok else "  %s" % "; ".join(status_problems)))
    if not ok:
        failures.append("R6 %s" % "; ".join(status_problems))

    # R7 条目数 ≥1（0 行 ⇒ rc=2，信号量）
    rows_count = len(rows)
    ok = rows_count >= 1
    print("  %s R7 条目数 ≥1（rows=%d）" % ("✅" if ok else "❌", rows_count))
    if not ok:
        raise QualityBaselineError(
            "E_EMPTY", "登记表 0 行（信号量==0，不是通过）: %s" % yaml_path)
    for item in failures:
        print("  - %s" % item)
    if failures:
        print("REGISTRY-FAIL rows=%d violations=%d" % (rows_count, len(failures)))
        return EXIT_RED
    print("REGISTRY-OK rows=%d" % rows_count)
    return EXIT_OK


# ═══════════════════════════════════════════════════════════════════════════════
# 枚举器 E1–E7 ＋ 门禁位/归属模型（C1–C10b 的同一实现）
# ═══════════════════════════════════════════════════════════════════════════════
_GROUP_BANNER_RE = re.compile(r"── 组 ([0-9]+):")
_ANY_BANNER_RE = re.compile(r"── [^─]*──")
_HEADER_RE = re.compile(r"^# ═+ +\S.*═+[ \t]*$")
_CP_CALL_RE = re.compile(
    r"^[ \t]*(?:QUIET_SUCCESS=[0-9]+ )?(hard_check|soft_check|v5_soft|decl_check)[ \t]+\"([^\"]*)\"")
_CI_NAME_RE = re.compile(r"^[ \t]*- name:[ \t]*(.*)$")


def _owner_of_line(slots: List[Tuple[int, str, str, str]], line: int) -> Optional[Tuple[int, str, str, str]]:
    owner = None
    for slot in slots:
        if slot[0] < line:
            owner = slot
        else:
            break
    return owner


def _owner_of_line_inclusive(slots: List[Tuple[int, str, str, str]],
                             line: int) -> Optional[Tuple[int, str, str, str]]:
    owner = None
    for slot in slots:
        if slot[0] <= line:
            owner = slot
        else:
            break
    return owner


def enumerate_precommit(root: str) -> Dict[str, Any]:
    text = read_text(root, PRECOMMIT_PATH)
    lines = text.split("\n")
    groups: Dict[int, Dict[str, Any]] = {}
    banners: Dict[str, Dict[str, Any]] = {}
    headers: List[Dict[str, Any]] = []
    slots: List[Tuple[int, str, str, str]] = []
    checkpoints: Dict[str, int] = {}
    for lineno, line in enumerate(lines, 1):
        m = _GROUP_BANNER_RE.search(line)
        if m:
            num = int(m.group(1))
            digest = label_hash(line)
            group = groups.get(num)
            if group is None:
                group = {"id": "PC-G%d" % num, "label_hash": digest,
                         "label": normalize_label(line), "occurrences": []}
                groups[num] = group
            group["occurrences"].append(lineno)
            slots.append((lineno, group["id"], "group", digest))
            continue
        if _ANY_BANNER_RE.search(line) and not re.search(r"── 组 [0-9]+", line):
            digest = label_hash(line)
            banner = banners.get(digest)
            if banner is None:
                banner = {"id": "PC-B-" + digest[:6], "label_hash": digest,
                          "label": normalize_label(line), "occurrences": []}
                banners[digest] = banner
            banner["occurrences"].append(lineno)
            slots.append((lineno, banner["id"], "banner", digest))
            continue
        if _HEADER_RE.match(line):
            digest = label_hash(line)
            headers.append({"id": "PC-X-" + digest[:6], "label_hash": digest,
                            "label": normalize_label(line), "line": lineno})
            slots.append((lineno, "PC-X-" + digest[:6], "header", digest))
            continue
        cp = _CP_CALL_RE.match(line)
        if cp:
            name = cp.group(2)
            if "$" in name:
                continue
            if name not in checkpoints:
                checkpoints[name] = lineno
    slots.sort(key=lambda item: item[0])
    owners: Dict[str, Optional[Tuple[int, str, str, str]]] = {}
    for name, line in checkpoints.items():
        owners[name] = _owner_of_line(slots, line)
    return {
        "groups": [groups[k] for k in sorted(groups)],
        "banners": [banners[k] for k in banners],
        "headers": headers,
        "slots": slots,
        "checkpoints": checkpoints,
        "owners": owners,
    }


def enumerate_ci(root: str) -> List[Dict[str, Any]]:
    text = read_text(root, WORKFLOW_PATH)
    steps: List[Dict[str, Any]] = []
    for lineno, line in enumerate(text.split("\n"), 1):
        m = _CI_NAME_RE.match(line)
        if m:
            steps.append({"id": "CI-S%d" % (len(steps) + 1), "line": lineno,
                          "label": m.group(1).strip()})
    return steps


def enumerate_checkers(root: str) -> List[str]:
    directory = os.path.join(root, CONTROL_TOWER_DIR)
    if not os.path.isdir(directory):
        return []
    names = [fn for fn in sorted(os.listdir(directory))
             if CHECKER_RE.match(fn) and os.path.isfile(os.path.join(directory, fn))]
    return names


def compute_wiring(root: str, checkers: List[str],
                   precommit: Optional[Dict[str, Any]],
                   steps: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """C10：每个检查器 basename 的门禁位引用复算（排除自身文件）。"""
    ref_files: List[str] = []
    ref_files.extend(iter_files(root, "scripts", (".sh", ".py", ".ts")))
    ref_files.extend(iter_files(root, ".gitea/workflows", (".yml", ".yaml", ".sh", "")))
    ref_files.extend(iter_files(root, ".github/workflows", (".yml", ".yaml", ".sh", "")))
    ref_files = sorted(set(ref_files))
    step_lines = [step["line"] for step in steps]
    slots = precommit["slots"] if precommit else []
    wired: Dict[str, Set[str]] = {name: set() for name in checkers}
    for rel in ref_files:
        try:
            with open(os.path.join(root, rel), "r", encoding="utf-8", errors="replace") as fh:
                lines = fh.read().split("\n")
        except OSError as exc:
            raise QualityBaselineError("E_IO", "读取引用文件失败: %s (%s)" % (rel, exc))
        is_workflow = rel.startswith(".gitea/workflows/") or rel.startswith(".github/workflows/")
        for lineno, line in enumerate(lines, 1):
            for name in checkers:
                if name not in line:
                    continue
                if rel == _norm_rel(os.path.join(CONTROL_TOWER_DIR, name)):
                    continue
                if rel == PRECOMMIT_PATH:
                    owner = _owner_of_line_inclusive(slots, lineno)
                    wired[name].add(owner[1] if owner else "script:" + PRECOMMIT_PATH)
                elif is_workflow:
                    idx = sum(1 for step_line in step_lines if step_line <= lineno)
                    if idx:
                        wired[name].add("CI-S%d" % idx)
                    else:
                        wired[name].add("script:" + rel)
                else:
                    wired[name].add("script:" + rel)
    return {name: sorted(values) for name, values in wired.items()}


def _flatten_strings(value: Any) -> List[str]:
    out: List[str] = []
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, dict):
        for key in value:
            out.extend(_flatten_strings(value[key]))
    elif isinstance(value, list):
        for item in value:
            out.extend(_flatten_strings(item))
    return out


def cmd_check_inventory(root: str, script_path: str, yaml_path: str) -> int:
    data = load_yaml_file(script_path, yaml_path)
    precommit = enumerate_precommit(root)
    steps = enumerate_ci(root)
    checkers = enumerate_checkers(root)
    groups = precommit["groups"]
    banners = precommit["banners"]
    headers = precommit["headers"]
    checkpoints = precommit["checkpoints"]
    owners = precommit["owners"]
    slots = precommit["slots"]

    if not groups:
        raise QualityBaselineError("E_EMPTY", "E1 组横幅枚举器产出 0 项（信号量==0）")
    if not checkpoints:
        raise QualityBaselineError("E_EMPTY", "E2 检查点枚举器产出 0 项（信号量==0）")
    if not banners:
        raise QualityBaselineError("E_EMPTY", "E3 非编号块枚举器产出 0 项（信号量==0）")
    if not steps:
        raise QualityBaselineError("E_EMPTY", "E4 CI 步枚举器产出 0 项（信号量==0）")
    if not checkers:
        raise QualityBaselineError("E_EMPTY", "E5 检查器枚举器产出 0 项（信号量==0）")
    if not headers:
        raise QualityBaselineError("E_EMPTY", "E7 注释头枚举器产出 0 项（信号量==0）")

    k12_banners = [b for b in banners if "K12-13" in b["label"]]
    normal_banners = [b for b in banners if b not in k12_banners]
    owner_ids = {owners[name][1] for name in owners if owners[name] is not None}
    x_headers = [h for h in headers if h["id"] in owner_ids]
    excluded_headers = [h for h in headers if h["id"] not in owner_ids]
    expected_gate_kinds: Dict[str, str] = {}
    for group in groups:
        expected_gate_kinds[group["id"]] = "group"
    for banner in normal_banners:
        expected_gate_kinds[banner["id"]] = "banner"
    for header in x_headers:
        expected_gate_kinds[header["id"]] = "header"
    for step in steps:
        expected_gate_kinds[step["id"]] = "step"
    expected_rows = len(groups) + len(normal_banners) + len(x_headers) + len(steps)

    gates = data.get("gates")
    gates_rows = [g for g in gates if isinstance(g, dict)] if isinstance(gates, list) else []
    checkers_rows = [c for c in data.get("checkers") if isinstance(c, dict)] \
        if isinstance(data.get("checkers"), list) else []
    pairing_rows = [p for p in data.get("pairing") if isinstance(p, dict)] \
        if isinstance(data.get("pairing"), list) else []
    excluded_rows = [e for e in data.get("excluded_headers") if isinstance(e, dict)] \
        if isinstance(data.get("excluded_headers"), list) else []
    findings_text = "\n".join(_flatten_strings(data.get("findings")))
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    zero_hit_candidates = meta.get("zero_hit_candidates") \
        if isinstance(meta.get("zero_hit_candidates"), list) else []

    def rows_by_hash(digest: str) -> List[Dict[str, Any]]:
        return [row for row in gates_rows if _as_text(row.get("label_hash")) == digest]

    print("INVENTORY %s" % yaml_path)
    counters = {"G": 0, "B": 0, "X": 0, "S": 0, "K": 0}
    failures: List[str] = []

    # C1 组横幅：每个 label_hash 恰好一行（kind group，id = PC-G<n>）
    c1_bad: List[str] = []
    for group in groups:
        matched = rows_by_hash(group["label_hash"])
        if len(matched) != 1:
            c1_bad.append("%s 期望 1 行，实际 %d 行" % (group["id"], len(matched)))
            continue
        row = matched[0]
        if _as_text(row.get("kind")) != "group" or _as_text(row.get("id")) != group["id"]:
            c1_bad.append("%s 行 kind/id 不符（kind=%s id=%s）"
                          % (group["id"], _as_text(row.get("kind")), _as_text(row.get("id"))))
            continue
        counters["G"] += 1
    print("  %s C1 组横幅 %d/%d%s"
          % ("✅" if not c1_bad else "❌", counters["G"], len(groups),
             "" if not c1_bad else "  %s" % "; ".join(c1_bad[:10])))
    failures.extend(c1_bad)

    # C2 banner：K12-13 之外 9 条各一行；K12-13 入 findings；CI ①c 步有行
    c2_bad: List[str] = []
    for banner in normal_banners:
        matched = rows_by_hash(banner["label_hash"])
        if len(matched) != 1:
            c2_bad.append("%s 期望 1 行，实际 %d 行" % (banner["id"], len(matched)))
            continue
        row = matched[0]
        if _as_text(row.get("kind")) != "banner" or _as_text(row.get("id")) != banner["id"]:
            c2_bad.append("%s 行 kind/id 不符" % banner["id"])
            continue
        counters["B"] += 1
    if len(k12_banners) != 1:
        c2_bad.append("E3 中 K12-13 banner 数量=%d（期望 1）" % len(k12_banners))
    if "K12-13" not in findings_text:
        c2_bad.append("findings 未见 K12-13 条目")
    ci_c_steps = [s for s in steps if "①c" in s["label"]]
    if not ci_c_steps:
        c2_bad.append("E4 无 ①c CI 步")
    ci_c_ids = {row_id[0] for row_id in
                [(s["id"], row) for s in ci_c_steps for row in gates_rows
                 if _as_text(row.get("id")) == s["id"]]}
    for step in ci_c_steps:
        if step["id"] not in ci_c_ids:
            c2_bad.append("CI ①c 步 %s 无盘点行" % step["id"])
    print("  %s C2 banner %d/%d ＋ K12-13/findings/CI①c%s"
          % ("✅" if not c2_bad else "❌", counters["B"], len(normal_banners),
             "" if not c2_bad else "  %s" % "; ".join(c2_bad[:10])))
    failures.extend(c2_bad)

    # C3 X 注释头：owner 数那些各一行；其余必须进 excluded_headers
    c3_bad: List[str] = []
    for header in x_headers:
        matched = rows_by_hash(header["label_hash"])
        if len(matched) != 1:
            c3_bad.append("%s 期望 1 行，实际 %d 行" % (header["id"], len(matched)))
            continue
        row = matched[0]
        if _as_text(row.get("kind")) != "header" or _as_text(row.get("id")) != header["id"]:
            c3_bad.append("%s 行 kind/id 不符" % header["id"])
            continue
        counters["X"] += 1
    excluded_expected = {h["label_hash"]: h["id"] for h in excluded_headers}
    excluded_actual = {_as_text(row.get("label_hash")): _as_text(row.get("id"))
                       for row in excluded_rows}
    for digest, ident in excluded_expected.items():
        if digest not in excluded_actual:
            c3_bad.append("excluded_headers 缺 %s" % ident)
        elif excluded_actual[digest] != ident:
            c3_bad.append("excluded_headers %s id 不符（实为 %s）"
                          % (ident, excluded_actual[digest]))
    for digest, ident in excluded_actual.items():
        if digest not in excluded_expected:
            c3_bad.append("excluded_headers 多出 %s" % ident)
    for row in excluded_rows:
        if _as_text(row.get("reason")) != "no_named_checkpoint":
            c3_bad.append("%s reason=%r（期望 no_named_checkpoint）"
                          % (_as_text(row.get("id")), _as_text(row.get("reason"))))
    print("  %s C3 注释头 %d/%d ＋ excluded_headers=%d/%d%s"
          % ("✅" if not c3_bad else "❌", counters["X"], len(x_headers),
             len(excluded_rows), len(excluded_headers),
             "" if not c3_bad else "  %s" % "; ".join(c3_bad[:10])))
    failures.extend(c3_bad)

    # C4 检查点归属：每个检查点恰好一行 且 该行 label_hash = owner slot hash
    c4_bad: List[str] = []
    for name, line in sorted(checkpoints.items(), key=lambda kv: kv[1]):
        owner = owners.get(name)
        placed = [row for row in gates_rows
                  if isinstance(row.get("checkpoints"), list)
                  and name in [str(x) for x in row["checkpoints"]]]
        expected_owner = owner[1] if owner else "（无 owner）"
        expected_hash = owner[3] if owner else ""
        if len(placed) != 1:
            c4_bad.append("%s 出现在 %d 行（期望 1；期望 owner=%s）"
                          % (name, len(placed), expected_owner))
            continue
        row = placed[0]
        if _as_text(row.get("label_hash")) != expected_hash:
            c4_bad.append("%s 期望 owner=%s 实际所在行=%s"
                          % (name, expected_owner, _as_text(row.get("id"))))
            continue
        counters["K"] += 1
    print("  %s C4 检查点归属 %d/%d%s"
          % ("✅" if not c4_bad else "❌", counters["K"], len(checkpoints),
             "" if not c4_bad else "  %s" % "; ".join(c4_bad[:10])))
    failures.extend(c4_bad)

    # C5 CI 步：9 个各一行（kind step）
    c5_bad: List[str] = []
    for step in steps:
        matched = [row for row in gates_rows if _as_text(row.get("id")) == step["id"]]
        if len(matched) != 1:
            c5_bad.append("%s 期望 1 行，实际 %d 行" % (step["id"], len(matched)))
            continue
        if _as_text(matched[0].get("kind")) != "step":
            c5_bad.append("%s kind 不符" % step["id"])
            continue
        counters["S"] += 1
    print("  %s C5 CI 步 %d/%d%s"
          % ("✅" if not c5_bad else "❌", counters["S"], len(steps),
             "" if not c5_bad else "  %s" % "; ".join(c5_bad[:10])))
    failures.extend(c5_bad)

    # C6 反向：每行来自枚举器（禁手写 id）＋ 行总数
    c6_bad: List[str] = []
    for row in gates_rows:
        ident = _as_text(row.get("id"))
        if ident not in expected_gate_kinds:
            c6_bad.append("gates 行 %s 不是枚举器产出（禁手写 id）" % ident)
        elif _as_text(row.get("kind")) != expected_gate_kinds[ident]:
            c6_bad.append("gates 行 %s kind=%s（期望 %s）"
                          % (ident, _as_text(row.get("kind")), expected_gate_kinds[ident]))
    if len(gates_rows) != expected_rows:
        c6_bad.append("gates 行总数 %d ≠ 期望 %d" % (len(gates_rows), expected_rows))
    checker_paths = [_as_text(row.get("path")) for row in checkers_rows]
    checker_bases = [p.rsplit("/", 1)[-1] for p in checker_paths if p]
    for base in checker_bases:
        if base not in checkers:
            c6_bad.append("checkers 行 path=%s 不是 E5 枚举器产出" % base)
    if len(checker_bases) != len(set(checker_bases)):
        c6_bad.append("checkers 存在重复 path")
    missing_checkers = sorted(set(checkers) - set(checker_bases))
    for base in missing_checkers:
        c6_bad.append("checkers 缺 %s" % base)
    print("  %s C6 反向枚举 gates=%d/%d checkers=%d/%d%s"
          % ("✅" if not c6_bad else "❌", len(gates_rows), expected_rows,
             len(set(checker_bases) & set(checkers)), len(checkers),
             "" if not c6_bad else "  %s" % "; ".join(c6_bad[:10])))
    failures.extend(c6_bad)

    # C7 decision 枚举 + replace/retire ⇒ replacement 非空
    c7_bad: List[str] = []
    for label, rows in (("gates", gates_rows), ("checkers", checkers_rows)):
        for row in rows:
            decision = _as_text(row.get("decision"))
            if decision not in ("keep", "replace", "retire"):
                c7_bad.append("%s[%s].decision=%r 不在枚举内"
                              % (label, _as_text(row.get("id")), decision))
            elif decision in ("replace", "retire") and not _as_text(row.get("replacement")):
                c7_bad.append("%s[%s].replacement 为空（decision=%s）"
                              % (label, _as_text(row.get("id")), decision))
    print("  %s C7 decision/replacement%s"
          % ("✅" if not c7_bad else "❌", "" if not c7_bad else "  %s" % "; ".join(c7_bad[:10])))
    failures.extend(c7_bad)

    # C9 pairing 恰 5 行覆盖 T1–T5；action ∈ {replace,retire}；target 命中 gates/checkers id
    c9_bad: List[str] = []
    if len(pairing_rows) != 5:
        c9_bad.append("pairing 行数 %d ≠ 5" % len(pairing_rows))
    scan_set = {_as_text(row.get("scan")) for row in pairing_rows}
    for rule in RULES:
        if rule not in scan_set:
            c9_bad.append("pairing 缺扫描 %s" % rule)
    for extra in sorted(scan_set - set(RULES)):
        c9_bad.append("pairing 多出非 T1–T5 扫描 %r" % extra)
    known_ids = {_as_text(row.get("id")) for row in gates_rows} | \
                {_as_text(row.get("id")) for row in checkers_rows}
    for idx, row in enumerate(pairing_rows):
        action = _as_text(row.get("action"))
        target = _as_text(row.get("target"))
        if action not in ("replace", "retire"):
            c9_bad.append("pairing[%d].action=%r 不在 {replace,retire}" % (idx, action))
        if not target or target not in known_ids:
            c9_bad.append("pairing[%d].target=%r 未命中 gates/checkers id" % (idx, target))
    pairing_ok = not c9_bad
    print("  %s C9 pairing 5 行覆盖 T1–T5%s"
          % ("✅" if pairing_ok else "❌", "" if pairing_ok else "  %s" % "; ".join(c9_bad[:10])))
    failures.extend(c9_bad)

    # C10 复算 wiring ＋ C10b（引用集合为空 ⇒ wired_to [] ＋ orphan true）
    wired = compute_wiring(root, checkers, precommit, steps)
    c10_bad: List[str] = []
    row_by_base = {_as_text(row.get("path")).rsplit("/", 1)[-1]: row for row in checkers_rows}
    for base, computed in sorted(wired.items()):
        row = row_by_base.get(base)
        if row is None:
            continue
        row_wired = row.get("wired_to")
        row_wired_list = [str(x) for x in row_wired] if isinstance(row_wired, list) else []
        if sorted(row_wired_list) != sorted(computed):
            c10_bad.append("%s wired_to 不一致（表=%s 复算=%s）"
                           % (base, sorted(row_wired_list), sorted(computed)))
        expect_orphan = len(computed) == 0
        if bool(row.get("orphan")) != expect_orphan:
            c10_bad.append("%s orphan=%r（复算 %r）" % (base, row.get("orphan"), expect_orphan))
    orphan_bases = sorted(base for base, values in wired.items() if not values)
    print("  %s C10/C10b wiring 复算（orphans=%d/%d）%s"
          % ("✅" if not c10_bad else "❌", len(orphan_bases), len(checkers),
             "" if not c10_bad else "  %s" % "; ".join(c10_bad[:10])))
    failures.extend(c10_bad)

    # C9b retire target 必须 ∈ 孤儿集合 ∪ zero_hit_candidates
    c9b_bad: List[str] = []
    zero_hit = {_as_text(item) for item in zero_hit_candidates}
    for row in pairing_rows:
        if _as_text(row.get("action")) != "retire":
            continue
        target = _as_text(row.get("target"))
        checker_row = next((r for r in checkers_rows if _as_text(r.get("id")) == target), None)
        if checker_row is not None:
            base = _as_text(checker_row.get("path")).rsplit("/", 1)[-1]
            if base in orphan_bases or target in zero_hit:
                continue
            c9b_bad.append("%s（scan=%s）不是孤儿（复算 wired_to=%s）且不在 zero_hit_candidates"
                           % (target, _as_text(row.get("scan")),
                              wired.get(base, [])))
        elif target in known_ids:
            if target in zero_hit:
                continue
            c9b_bad.append("%s（scan=%s）是门禁位而非孤儿/零命中候选"
                           % (target, _as_text(row.get("scan"))))
        else:
            c9b_bad.append("%s（scan=%s）不是孤儿/零命中候选"
                           % (target, _as_text(row.get("scan"))))
    print("  %s C9b retire target ∈ 孤儿集合 ∪ zero_hit_candidates%s"
          % ("✅" if not c9b_bad else "❌", "" if not c9b_bad else "  %s" % "; ".join(c9b_bad[:10])))
    failures.extend(c9b_bad)

    if failures:
        print("INVENTORY-FAIL violations=%d" % len(failures))
    pairing_line_ok = pairing_ok and not c9b_bad
    if pairing_line_ok:
        print("PAIRING-OK t1..t5=5/5 excluded_headers=%d orphans=%d/%d"
              % (len(excluded_headers), len(orphan_bases), len(checkers)))
    else:
        print("PAIRING-FAIL excluded_headers=%d orphans=%d/%d"
              % (len(excluded_headers), len(orphan_bases), len(checkers)))
    print("covered=G%d/%d B%d/%d X%d/%d S%d/%d K%d/%d R%d/%d"
          % (counters["G"], len(groups), counters["B"], len(normal_banners),
             counters["X"], len(x_headers), counters["S"], len(steps),
             counters["K"], len(checkpoints), len(gates_rows), expected_rows))
    return EXIT_RED if failures else EXIT_OK


def cmd_orphans_only(root: str) -> int:
    checkers = enumerate_checkers(root)
    if not checkers:
        raise QualityBaselineError("E_EMPTY", "E5 检查器枚举器产出 0 项（信号量==0）")
    precommit: Optional[Dict[str, Any]]
    try:
        precommit = enumerate_precommit(root)
    except QualityBaselineError:
        precommit = None
    try:
        steps = enumerate_ci(root)
    except QualityBaselineError:
        steps = []
    wired = compute_wiring(root, checkers, precommit, steps)
    for base in checkers:
        print("  %s -> %s" % (base, json.dumps(wired[base], ensure_ascii=False)))
    orphan_count = sum(1 for values in wired.values() if not values)
    print("orphans=%d/%d" % (orphan_count, len(checkers)))
    return EXIT_OK


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════
class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise QualityBaselineError("E_ARGS", message, degraded=False)


def build_parser() -> argparse.ArgumentParser:
    parser = _ArgumentParser(
        prog="quality-baseline.py",
        description="P4-841 P0 质量基线扫描器（只测量，不阻断；三态返回码）",
        allow_abbrev=False,
    )
    parser.add_argument("--root", default=None, help="扫哪棵树（默认 cwd 的 git 仓根）")
    parser.add_argument("--ref", default="HEAD", help="基线记录的 git ref（默认 HEAD）")
    parser.add_argument("--out", default=None, help="基线产物路径（默认相对 --root）")
    parser.add_argument("--baseline", default=None, help="对比用的既有基线（默认相对 --root）")
    parser.add_argument("--write-baseline", action="store_true", help="写基线（BOOTSTRAP/RATCHET）")
    parser.add_argument("--reason", default=None, help="覆盖既有基线且 totals 上升时必填")
    parser.add_argument("--strict", action="store_true", help="totals[Tn]>0 即红")
    parser.add_argument("--selfcheck", action="store_true", help="判别力自检（mktemp 沙箱）")
    parser.add_argument("--orphans-only", action="store_true", help="只复算 E5＋C10 孤儿")
    parser.add_argument("--check-registry", default=None, metavar="YAML", help="校验接线登记表")
    parser.add_argument("--check-inventory", default=None, metavar="YAML", help="校验门禁盘点表")
    parser.add_argument("--json", action="store_true", help="stdout 只输出基线 JSON")
    return parser


def _validate_args(args: argparse.Namespace) -> None:
    modes = [bool(args.selfcheck), bool(args.orphans_only),
             bool(args.check_registry), bool(args.check_inventory)]
    if sum(modes) > 1:
        raise QualityBaselineError("E_ARGS", "互斥模式重复指定（--selfcheck/--orphans-only/"
                                              "--check-registry/--check-inventory）", degraded=False)
    subcommand = any(modes)
    if subcommand and (args.write_baseline or args.strict or args.json or args.reason
                       or args.baseline or args.out):
        raise QualityBaselineError(
            "E_ARGS", "子命令模式与 --write-baseline/--strict/--json/--reason/--baseline/--out 互斥",
            degraded=False)
    if args.orphans_only and (args.write_baseline or args.strict or args.json or args.reason
                              or args.baseline or args.out):
        raise QualityBaselineError(
            "E_ARGS", "--orphans-only 不读写基线、不产 JSON（与基线/JSON 参数互斥）", degraded=False)
    if args.reason is not None and not args.write_baseline:
        raise QualityBaselineError("E_ARGS", "--reason 仅与 --write-baseline 同用", degraded=False)
    if args.write_baseline and args.strict:
        raise QualityBaselineError("E_ARGS", "--strict 仅用于默认对比模式", degraded=False)
    if args.reason is not None and not args.reason.strip():
        raise QualityBaselineError("E_ARGS", "--reason 不能为空", degraded=False)


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
        _validate_args(args)
        script_path = os.path.abspath(__file__)
        if args.selfcheck:
            return cmd_selfcheck()
        root = resolve_root(args.root)
        if args.check_registry:
            return cmd_check_registry(root, script_path, args.check_registry)
        if args.check_inventory:
            return cmd_check_inventory(root, script_path, args.check_inventory)
        if args.orphans_only:
            return cmd_orphans_only(root)
        out_path = resolve_under_root(root, args.out or BASELINE_REL)
        baseline_path = resolve_under_root(root, args.baseline or BASELINE_REL)
        if args.write_baseline:
            return cmd_write_baseline(root, out_path, args.reason)
        return cmd_scan_compare(root, baseline_path, args.strict, args.json)
    except QualityBaselineError as exc:
        prefix = "degraded" if exc.degraded else "ERROR"
        print("%s: %s" % (prefix, exc), file=sys.stderr)
        return EXIT_DEGRADED
    except KeyboardInterrupt:
        print("degraded: 被中断（KeyboardInterrupt）", file=sys.stderr)
        return EXIT_DEGRADED
    except Exception as exc:  # python 异常 ⇒ 检查自身失败（fail loud，不静默）
        print("degraded: [E_UNEXPECTED] %s: %s" % (type(exc).__name__, exc), file=sys.stderr)
        return EXIT_DEGRADED


if __name__ == "__main__":
    sys.exit(main())
