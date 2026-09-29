#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""scan-client-names.py — 客户机密名「防再泄露」扫描门禁（D1063 / CN-01）

背景（D1063 实测根因）:
  公开仓库（private: false）当前树同时以**文件名**与**内容**发布客户名，并集 172 件。
  一次清（删除/改写）是治标；**本次泄露正是文档形态**，且 `scripts/pre-commit-check.sh`
  的 CT-34 纯文档早退分支（:319-352）只保留 Secrets 扫描、豁免其余 12 组 —— 若新门禁只接在
  13 组里，纯 .md/.html 提交会**整段绕过**它（实测 `docs/synova/business/某客户方案.html`
  在 DOC_PREFIX_RE 白名单内，非文档计数 = 0 ⇒ 走早退分支）。故本门禁接线两处（见 pre-commit）。

设计取舍（D333 四步，结论落 decisions/process/2026-09-29-cn01-client-data-outbound-gate.md）:
  - **不存明文**：数据文件只存 `{id, len, sha256}`，sha256 = SHA-256(salt_bytes || 名称 UTF-8 字节)。
    为什么不用明文清单：本文件本身入库 —— 明文清单 = 把要清除的东西再写进仓库一次。
  - **不用倒排索引/DFA**（Aho-Corasick 更快但必须持有明文）⇒ 滑动窗口哈希，代价是逐窗口计算。
  - **二进制不内容扫描**（CTO ③）：仅路径扫描 + 查 `binaryPolicy.allowlist`；
    **未登记二进制 fail-closed**，绝不静默放行（铁律 11）—— 明文藏在 docx/pdf 里正是
    文本扫描的盲区（实测：`docs/plans/codex/20260815-*.docx` 路径干净但 OOXML 内含目标名 5 处）。

契约（铁律 47）:
  @input  — 模式（互斥择一，缺省 `--scan-staged`）:
              --scan-staged              读**暂存区**（提交前门禁用；增量、只读一次、<1s）
              --scan-filenames [PATH...] 仅路径扫描；无 PATH ⇒ 全树（git ls-files）
              --scan-content   [PATH...] 仅内容扫描；无 PATH ⇒ 全树**全文**
                                         （有 PATH ⇒ 读工作区文件，缺则回退暂存 blob）
              --scan-all-tree            全树：路径 + 全文
              --add-entry <明文>         管理动作：算 hash 追加进数据文件（**明文不落盘**）
            选项:
              --patterns <path>   数据文件（默认 <本脚本目录>/client-name-patterns.json；
                                  **门禁接线不传此参**，仅供运维显式覆盖）
              --repo <path>       仓库根（默认 git rev-parse --show-toplevel）
              --max-file-bytes N  全树/显式路径模式下单文件上限（默认 4194304；超限计入降级）
              --json              机器可读输出
              --quiet             仅输出汇总行
  @output — stdout 逐条点名:
              路径命中   `<path>  [路径命中 <id>]`
              内容命中   `<path>:<行号>  [内容命中 <id>]`
              二进制缺口 `<path>  [未内容扫描（binary）—— 未登记 binaryPolicy.allowlist]`
            汇总行      `检查 N 件 / 命中 M 件`（内容模式追加 `（内容扫描 X 件）`；另有二进制缺口
                        追加 `未内容扫描（binary）K 件`）
            🔴 **空集口径（假绿防线，D1046 L-2/L-3 家族）**: 扫描集为空或内容维度零覆盖时
                **不打印**上述同形汇总，改打
                `ℹ️ 本次无文本件可扫（N=0）—— 未覆盖任何文件`（+ 原因限定）
                —— 纯删除提交（ACMR 集为空）不得再以「检查 0 件 / 命中 0 件 / exit 0」冒充通过。
                JSON 输出带 `"coverage": "full"|"no-content"|"empty"` 与 `"textScanned"`。
  @exit   — 0 = 通过**且扫描覆盖完整**；1 = 命中（业务阻断，**含任何未登记二进制**，见 @binary）；
            2 = 扫描器自身失败或**降级**（数据文件缺失/损坏、git 不可用、读取失败/超限）
            —— 三态绝不互相混同（D328）
  @degraded — 所有降级路径都写 stderr `degraded: ...` 并在 stdout 注明，**绝不当作通过**（铁律 11）
  @error  — code ∈ {CN_PATTERNS_MISSING, CN_PATTERNS_INVALID, CN_GIT_UNAVAILABLE,
                    CN_MODE_CONFLICT, CN_READ_FAILED, CN_BINARY_UNREGISTERED}
            每条带 code + phase + retryable（铁律 32，DSH InvariantError 形态）
  @binary — 未登记二进制 (= `binaryPolicy.default:"block"` 且不在 allowlist) **一律 exit 1**，
            无论扫描集是变更集（--scan-staged / 显式 PATH）还是全树清点（--scan-all-tree）。
            理由: 二进制不做内容扫描 ⇒ 内容维度零覆盖；返回 0 等于用二进制盲区给 C2「全树清零」造假绿。
            （CTO ③ 原文只写「未登记二进制 ⇒ exit 1」，未区分扫描集；fail-closed 是唯一不产生假绿的读法，
             队长 2026-09-29 裁定采纳。严格按 D328，「结论不完整」亦可读作 exit 2 —— 两者都非 0，
             取 1 的差别只在「阻断」vs「降级」的语义标签，如需改回 2 是单点改动。）
  @limits — 已声明覆盖缺口（如实记录，不假称全知）:
            ① 窗口不跨行 —— 名称被换行拆开时漏检（门禁是防再生，不是历史取证）；
            ② 名称被路径分隔符拆开（`<A>/<B>` 两段各半个名）时漏检（路径按各段独立滑窗）；
            ③ PDF 正文可能以字体子集 CID 编码 → 二进制不做内容扫描（见 @binary，靠 fail-closed 兜）；
            ④ 加盐哈希不可枚举 ⇒ 无「列出所有已知名」能力（有意为之）。
  @cross_platform — D520: 纯标准库；UTF-8 强制；路径经 `-c core.quotepath=false` + `-z` 读取；
                    无 bash 依赖；`sys.stdout` 显式 reconfigure(utf-8)。见 PLATFORM-CHECKLIST.md
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys

# ── D313 M5: Windows 控制台/子进程统一 UTF-8（PLATFORM-CHECKLIST #4）──
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:  # swallow-ok: 老 Python/已被重定向的流无法 reconfigure，不影响扫描结果
        pass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PATTERNS = os.path.join(SCRIPT_DIR, "client-name-patterns.json")
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"  # git 空树（无 HEAD 时的 diff 基）
DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024
BINARY_SNIFF = 8000


class ScanError(Exception):
    """扫描器自身失败/降级（铁律 32：code + phase + retryable）。"""

    def __init__(self, code: str, message: str, phase: str = "scan", retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.phase = phase
        self.retryable = retryable

    def render(self) -> str:
        return (f"degraded: {self.message} "
                f"(code={self.code}, phase={self.phase}, retryable={str(self.retryable).lower()})")


class Entry:
    """一条被禁客户名 —— 只持 hash，不持明文。"""

    __slots__ = ("id", "length", "sha256", "non_ascii")

    def __init__(self, id_: str, length: int, sha256: str, non_ascii: bool = False):
        self.id = id_
        self.length = length
        self.sha256 = sha256.lower()
        self.non_ascii = non_ascii

    def __repr__(self) -> str:  # pragma: no cover - 便于排障
        return f"Entry({self.id}, len={self.length}, non_ascii={self.non_ascii})"


def _require(cond: bool, code: str, message: str, retryable: bool = False) -> None:
    if not cond:
        raise ScanError(code, message, retryable=retryable)


# ═══════════════════════════════════════════════════════════════
# 数据文件加载
# ═══════════════════════════════════════════════════════════════
class Patterns:
    """client-name-patterns.json 的内存视图。

    schema:
      { "version": 1,
        "salt": "<hex>",
        "entries":     [ {"id","len","sha256"[,"nonAscii"]} ],   # 内容扫描用
        "pathEntries": [ ... 同上 ... ],                          # 路径扫描用
        "binaryPolicy": { "allowlist": [ {"path","method"} | "<path>" ],
                          "default": "block" } }
    """

    def __init__(self, path: str, raw: str):
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise ScanError("CN_PATTERNS_INVALID", f"数据文件 JSON 解析失败: {path} ({exc})") from exc
        _require(isinstance(data, dict), "CN_PATTERNS_INVALID", f"数据文件顶层不是对象: {path}")
        salt_hex = data.get("salt", "")
        _require(isinstance(salt_hex, str) and salt_hex != "" and len(salt_hex) % 2 == 0,
                 "CN_PATTERNS_INVALID", f"salt 缺失或非偶数长度 hex: {path}")
        try:
            self.salt = bytes.fromhex(salt_hex)
        except ValueError as exc:
            raise ScanError("CN_PATTERNS_INVALID", f"salt 非合法 hex: {path}") from exc
        self.path = path
        self.entries = self._parse_entries(data.get("entries", []), "entries")
        self.path_entries = self._parse_entries(data.get("pathEntries", data.get("entries", [])),
                                                "pathEntries")
        policy = data.get("binaryPolicy") or {}
        self.binary_default = str(policy.get("default", "block")).lower()
        self.binary_allowlist: set[str] = set()
        for item in policy.get("allowlist") or []:
            if isinstance(item, str):
                self.binary_allowlist.add(item)
            elif isinstance(item, dict) and isinstance(item.get("path"), str):
                self.binary_allowlist.add(item["path"])
        self.binary_refused: set[str] = set()
        for item in policy.get("refused") or []:
            if isinstance(item, str):
                self.binary_refused.add(item)
            elif isinstance(item, dict) and isinstance(item.get("path"), str):
                self.binary_refused.add(item["path"])
        # 数据文件自洽性：同一路径既「已登记」又「复核命中被拒」⇒ 数据文件被改坏，fail-closed（铁律 11）
        conflict = self.binary_allowlist & self.binary_refused
        if conflict:
            raise ScanError("CN_PATTERNS_INVALID",
                            f"binaryPolicy 自相矛盾（allowlist ∩ refused）: {sorted(conflict)}")

    @staticmethod
    def _parse_entries(items, label: str) -> list[Entry]:
        _require(isinstance(items, list), "CN_PATTERNS_INVALID", f"{label} 不是数组")
        out: list[Entry] = []
        for it in items:
            _require(isinstance(it, dict), "CN_PATTERNS_INVALID", f"{label} 元素不是对象")
            try:
                eid = str(it["id"])
                length = int(it["len"])
                digest = str(it["sha256"]).lower()
            except (KeyError, TypeError, ValueError) as exc:
                raise ScanError("CN_PATTERNS_INVALID",
                                f"{label} 元素缺 id/len/sha256 或类型错误: {it!r}") from exc
            _require(length > 0, "CN_PATTERNS_INVALID", f"{label} len 必须 > 0: {it!r}")
            _require(len(digest) == 64, "CN_PATTERNS_INVALID", f"{label} sha256 长度非 64: {it!r}")
            out.append(Entry(eid, length, digest, bool(it.get("nonAscii", False))))
        return out

    def groups(self, entries: list[Entry]):
        """按窗口长度分组 → 扫描热路径。

        优化（结果不变、仅省算力）: 若某长度下**全部**条目都标记 nonAscii，
        则纯 ASCII 窗口不可能命中 ⇒ 直接跳过（isascii() 是 C 级实现，比 sha256 便宜 ~8x）。
        标记缺失时按 nonAscii=False 处理 ⇒ **正确性不依赖该优化字段**。
        """
        by_len: dict[int, dict] = {}
        for e in entries:
            slot = by_len.setdefault(e.length, {"need_all": {}, "need_nonascii": {}})
            slot["need_all" if not e.non_ascii else "need_nonascii"][e.sha256] = e
        return sorted(by_len.items())


# ═══════════════════════════════════════════════════════════════
# 滑窗哈希
# ═══════════════════════════════════════════════════════════════
def hash_name(salt: bytes, text: str) -> str:
    """salted-n-gram 指纹：SHA-256(salt_bytes || text.encode('utf-8'))。（@add-entry 与扫描同源）"""
    h = hashlib.sha256()
    h.update(salt)
    h.update(text.encode("utf-8"))
    return h.hexdigest()


def normalize_line(line: str) -> str:
    """剥 UTF-8 BOM + 去 CRLF 残留（基线实测仓内存在带 BOM 的 .html，D1063 验收硬要求）。"""
    if line.startswith("\ufeff"):
        line = line[1:]
    return line.rstrip("\r")


def find_hits(salt: bytes, groups, text: str) -> list[Entry]:
    """在 text 内滑窗找命中（**不跨行**：调用方按行喂入）。"""
    hits: list[Entry] = []
    n = len(text)
    for length, slot in groups:
        if length > n:
            continue
        need_all = slot["need_all"]
        need_na = slot["need_nonascii"]
        skip_ascii = not need_all  # 该长度下无「ASCII 也可能命中」的条目
        for i in range(n - length + 1):
            window = text[i:i + length]
            if skip_ascii and window.isascii():
                continue
            digest = hash_name(salt, window)
            entry = need_all.get(digest) or need_na.get(digest)
            if entry is not None:
                hits.append(entry)
    return hits


def scan_path_text(salt: bytes, groups, path: str) -> list[Entry]:
    """路径扫描：对**各段**分别滑窗（支持 `前缀-<名>-后缀.ext` 形态；段间不跨接，见 @limits ②）。"""
    hits: list[Entry] = []
    for segment in path.replace("\\", "/").split("/"):
        if not segment:
            continue
        hits.extend(find_hits(salt, groups, segment))
    return hits


# ═══════════════════════════════════════════════════════════════
# git 读取
# ═══════════════════════════════════════════════════════════════
class Git:
    def __init__(self, repo: str):
        self.repo = repo
        probe = subprocess.run(["git", "rev-parse", "--git-dir"], cwd=repo,
                               capture_output=True)
        _require(probe.returncode == 0, "CN_GIT_UNAVAILABLE",
                 f"git 不可用或 {repo} 不是仓库（fail-closed，不静默跳过）", retryable=True)
        self._base = self._resolve_base()

    def _resolve_base(self) -> str:
        head = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=self.repo,
                              capture_output=True)
        return "HEAD" if head.returncode == 0 else EMPTY_TREE

    def run(self, args: list[str]) -> bytes:
        proc = subprocess.run(["git", "-c", "core.quotepath=false"] + args, cwd=self.repo,
                              capture_output=True)
        return proc.stdout if proc.returncode == 0 else b""

    def staged_paths(self) -> list[str]:
        raw = self.run(["diff", "--cached", "--name-only", "--diff-filter=ACMR",
                        "--no-renames", "-z", self._base])
        return [p for p in raw.decode("utf-8", "surrogateescape").split("\0") if p]

    def staged_binary(self) -> set[str]:
        """二进制 = 暂存差异里 numstat 为 `-\\t-\\t` 的路径（一次 git 调用，不逐件读 blob）。"""
        raw = self.run(["diff", "--cached", "--numstat", "--no-renames", "-z", self._base])
        out: set[str] = set()
        for record in raw.decode("utf-8", "surrogateescape").split("\0"):
            if not record:
                continue
            parts = record.split("\t", 2)
            if len(parts) == 3 and parts[0] == "-" and parts[1] == "-":
                out.add(parts[2])
        return out

    def staged_added_lines(self, paths: list[str]) -> list[tuple[str, int, str]]:
        """暂存区**新增/修改行**（`-U0` 增量口径）→ [(path, 行号, 行内容)]。"""
        out: list[tuple[str, int, str]] = []
        for chunk_start in range(0, len(paths), 200):
            chunk = paths[chunk_start:chunk_start + 200]
            raw = self.run(["diff", "--cached", "-U0", "--no-color", "--no-ext-diff",
                            "--no-renames", self._base, "--"] + chunk)
            current: str | None = None
            lineno = 0
            for line in raw.decode("utf-8", "surrogateescape").split("\n"):
                if line.startswith("+++ "):
                    current = _diff_path(line[4:])
                    continue
                if line.startswith("--- ") or line.startswith("diff --git"):
                    if line.startswith("diff --git"):
                        current = None
                    continue
                if line.startswith("@@"):
                    lineno = _hunk_new_start(line)
                    continue
                if not line or line[0] == "\\" or current is None:
                    continue
                if line[0] == "+":
                    out.append((current, lineno, normalize_line(line[1:])))
                    lineno += 1
                elif line[0] == "-":
                    continue
        return out

    def tracked_paths(self) -> list[str]:
        raw = self.run(["ls-files", "-z"])
        return [p for p in raw.decode("utf-8", "surrogateescape").split("\0") if p]

    def show_index_blob(self, path: str) -> bytes | None:
        proc = subprocess.run(["git", "-c", "core.quotepath=false", "show", f":{path}"],
                              cwd=self.repo, capture_output=True)
        return proc.stdout if proc.returncode == 0 else None


def _diff_path(tail: str) -> str:
    tail = tail.split("\t", 1)[0]
    if tail.startswith("b/"):
        tail = tail[2:]
    if len(tail) >= 2 and tail.startswith('"') and tail.endswith('"'):
        tail = tail[1:-1]
        try:  # git C-style 转义（含八进制字节）→ 还原为 UTF-8 文本
            tail = tail.encode("utf-8", "surrogateescape").decode("unicode_escape")
            tail = tail.encode("latin-1", "ignore").decode("utf-8", "replace")
        except Exception:  # swallow-ok: 还原失败则用原串（最坏=漏报该行，不产生假命中）
            pass
    return tail


def _hunk_new_start(line: str) -> int:
    try:
        plus = line.split("+", 1)[1].split(" ", 1)[0]
        return int(plus.split(",", 1)[0])
    except (IndexError, ValueError):
        return 0


def is_binary(data: bytes) -> bool:
    return b"\x00" in data[:BINARY_SNIFF]


def text_candidates(data: bytes, path: str):
    """把「不可文本扫描」的字节展开成可哈希文本候选（**仅复核模式用**）。

    覆盖: ① 原始字节按 utf-8/utf-16-le/gbk 解码；② OOXML（docx/pptx/xlsx，zip）逐 member；
    ③ PDF 的 FlateDecode 流。
    为什么必须做: 实测 `docs/plans/codex/20260815-*.docx` **路径干净但 word/document.xml 内含目标名 3 处** ——
    若 allowlist 只按「扫描器是否命中」自动生成，它会被**误登记**成"已审干净"，泄露即被掩盖。
    ⇒ 登记二进制前必须跑本模式逐件复核（allowlist 是**证据**，不是默认值）。
    """
    low = path.lower()
    if low.endswith((".docx", ".pptx", ".xlsx")):
        try:
            import io
            import zipfile
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                for name in zf.namelist():
                    try:
                        member = zf.read(name)
                    except Exception:  # swallow-ok: 单个坏 member 不阻断其余 member 复核
                        continue
                    yield f"{path}!{name}", member
        except Exception:  # swallow-ok: 非标准 zip 时退回原始字节路径（仍会复核）
            pass
    elif low.endswith(".pdf"):
        yield path, data
        try:
            import re
            import zlib
            for m in re.finditer(rb"stream\r?\n", data):
                start = m.end()
                end = data.find(b"endstream", start)
                if end < 0:
                    continue
                try:
                    yield f"{path}#stream@{start}", zlib.decompress(data[start:end])
                except Exception:  # swallow-ok: 非 flate 流跳过（该流内容仍由原始字节候选覆盖）
                    continue
        except Exception:  # swallow-ok: 解压不可用 → 原始字节候选已在上面产出
            pass
    else:
        yield path, data


def review_binary(pat: Patterns, repo: str, paths: list[str], quiet: bool) -> int:
    """复核二进制是否内含任何已登记名（登记 allowlist 前的必做步骤）。"""
    git = Git(repo)
    groups = pat.groups(pat.entries)
    dirty: list[str] = []
    unreadable: list[str] = []
    for path in paths:
        full = os.path.join(repo, path)
        try:
            with open(full, "rb") as fh:
                data = fh.read()
        except OSError:
            blob = git.show_index_blob(path)
            if blob is None:
                unreadable.append(path)
                print(f"{path}  [读取失败 —— 未复核]")
                continue
            data = blob
        hit_labels: list[str] = []
        for label, raw in text_candidates(data, path):
            found = False
            for enc in ("utf-8", "utf-16-le", "gbk"):
                try:
                    text = raw.decode(enc, "ignore")
                except Exception:  # swallow-ok: 某编码解码失败不影响其他编码候选
                    continue
                for line in text.split("\n"):
                    if find_hits(pat.salt, groups, normalize_line(line)):
                        hit_labels.append(f"{label}[{enc}]")
                        found = True
                        break
                if found:
                    break
        if hit_labels:
            dirty.append(path)
            print(f"{path}  [复核命中 —— 禁止登记] {' '.join(sorted(set(hit_labels))[:3])}")
        elif not quiet:
            print(f"{path}  [复核干净 —— 可登记]")
    print(f"复核 {len(paths)} 件 / 命中 {len(dirty)} 件 / 未复核 {len(unreadable)} 件")
    if dirty:
        return 1
    if unreadable:
        print(f"degraded: {len(unreadable)} 件未复核 —— 结论不完整"
              f"(code=CN_READ_FAILED, phase=review, retryable=true)", file=sys.stderr)
        return 2
    return 0


# ═══════════════════════════════════════════════════════════════
# 扫描主体
# ═══════════════════════════════════════════════════════════════
class Report:
    def __init__(self) -> None:
        self.checked = 0
        self.text_scanned = 0      # **实际做了内容扫描**的文件数（假绿防线，见 @output 空集口径）
        self.path_hits: list[tuple[str, Entry]] = []
        self.content_hits: list[tuple[str, int, Entry]] = []
        self.binary_gaps: list[str] = []
        self.degraded: list[str] = []

    @property
    def hit_count(self) -> int:
        return len(self.path_hits) + len(self.content_hits)


class Scanner:
    def __init__(self, pat: Patterns, git: Git, max_file_bytes: int):
        self.pat = pat
        self.git = git
        self.max_file_bytes = max_file_bytes
        self.content_groups = pat.groups(pat.entries)
        self.path_groups = pat.groups(pat.path_entries or pat.entries)

    # ── 路径 ──
    def check_path(self, path: str, rep: Report) -> None:
        for entry in scan_path_text(self.pat.salt, self.path_groups, path):
            rep.path_hits.append((path, entry))

    def binary_gap(self, path: str) -> bool:
        """未登记二进制 ⇒ 缺口（allowlist 是**内容缺口**的登记点，不掩路径命中）。"""
        if path in self.pat.binary_allowlist:
            return False
        return self.pat.binary_default == "block"

    def scan_lines(self, path: str, lines, rep: Report) -> None:
        for lineno, line in lines:
            text = normalize_line(line)
            if not text:
                continue
            for entry in find_hits(self.pat.salt, self.content_groups, text):
                rep.content_hits.append((path, lineno, entry))

    # ── 模式 1: 暂存区（门禁热路径）──
    def scan_staged(self) -> Report:
        rep = Report()
        staged = self.git.staged_paths()
        binaries = self.git.staged_binary()
        rep.checked = len(staged)
        text_paths: list[str] = []
        for path in staged:
            self.check_path(path, rep)
            if path in binaries:
                if self.binary_gap(path):
                    rep.binary_gaps.append(path)
            else:
                text_paths.append(path)
        for path, lineno, line in self.git.staged_added_lines(text_paths):
            self.scan_lines(path, [(lineno, line)], rep)
        rep.text_scanned = len(text_paths)
        return rep

    # ── 模式 2/3: 显式路径 ──
    def scan_explicit(self, paths: list[str], do_names: bool, do_content: bool) -> Report:
        rep = Report()
        rep.checked = len(paths)
        for path in paths:
            if do_names:
                self.check_path(path, rep)
            if not do_content:
                continue
            data = _read_any(self, path)
            if data is None:
                rep.degraded.append(path)
                continue
            if is_binary(data):
                if self.binary_gap(path):
                    rep.binary_gaps.append(path)
                continue
            if len(data) > self.max_file_bytes:
                rep.degraded.append(path)
                continue
            text = data.decode("utf-8", "replace")
            self.scan_lines(path, list(enumerate(text.split("\n"), start=1)), rep)
            rep.text_scanned += 1
        return rep

    # ── 模式 4: 全树 ──
    def scan_tree_names_only(self) -> Report:
        """仅全树路径扫描（不读文件内容 —— 不假装做了内容扫描，见 @limits）。"""
        rep = Report()
        paths = self.git.tracked_paths()
        rep.checked = len(paths)
        for path in paths:
            self.check_path(path, rep)
        return rep

    def scan_tree(self) -> Report:
        rep = Report()
        paths = self.git.tracked_paths()
        rep.checked = len(paths)
        for path in paths:
            self.check_path(path, rep)
            data = _read_any(self, path)
            if data is None:
                rep.degraded.append(path)
                continue
            if is_binary(data):
                if self.binary_gap(path):
                    rep.binary_gaps.append(path)
                continue
            if len(data) > self.max_file_bytes:
                rep.degraded.append(path)
                continue
            text = data.decode("utf-8", "replace")
            self.scan_lines(path, list(enumerate(text.split("\n"), start=1)), rep)
            rep.text_scanned += 1
        return rep


def _read_any(scanner: Scanner, path: str) -> bytes | None:
    """工作区优先，缺则回退暂存 blob（两者都不可读 ⇒ None = 降级，不算通过）。

    路径按**仓库根**拼接而非进程 cwd —— `--repo <别处>` 时 cwd 与 repo 不同（否则读到 cwd 下
    同名文件或 ENOENT 假降级）。
    """
    try:
        with open(os.path.join(scanner.git.repo, path), "rb") as fh:
            return fh.read()
    except OSError:
        return scanner.git.show_index_blob(path)


# ═══════════════════════════════════════════════════════════════
# 输出
# ═══════════════════════════════════════════════════════════════
def emit(rep: Report, quiet: bool, as_json: bool, mode: str, content_expected: bool) -> None:
    """输出。**空集口径（假绿防线，D1046 L-2/L-3 家族）**:

    扫描集为空 / 无文本件可扫时 **不得** 打印 `检查 N 件 / 命中 0 件` 那种「看着绿」的同形汇总——
    纯删除提交（ACMR 集为空）会让门禁打印 `检查 0 件 / 命中 0 件 / exit 0`，
    而它**一件都没扫**。故覆盖率为零时改打 `ℹ️ 本次无文本件可扫（N=0）—— 未覆盖任何文件`，
    与「扫了 N 件、0 命中」在**输出形态上可区分**（测试 `scan-client-names.test.sh` 有空集断言）。
    """
    if as_json:
        print(json.dumps({
            "mode": mode,
            "checked": rep.checked,
            "textScanned": rep.text_scanned,
            "coverage": coverage_of(rep, content_expected),
            "hits": rep.hit_count,
            "pathHits": [{"path": p, "entry": e.id} for p, e in rep.path_hits],
            "contentHits": [{"path": p, "line": n, "entry": e.id} for p, n, e in rep.content_hits],
            "binaryGaps": rep.binary_gaps,
            "degraded": rep.degraded,
        }, ensure_ascii=False, indent=2))
        return
    if not quiet:
        for path, entry in rep.path_hits:
            print(f"{path}  [路径命中 {entry.id}]")
        for path, lineno, entry in rep.content_hits:
            print(f"{path}:{lineno}  [内容命中 {entry.id}]")
        for path in rep.binary_gaps:
            print(f"{path}  [未内容扫描（binary）—— 未登记 binaryPolicy.allowlist]")
        for path in rep.degraded:
            print(f"{path}  [读取失败/超限 —— 未扫描（未计为通过）]")
    coverage = coverage_of(rep, content_expected)
    if coverage == "empty":
        print("ℹ️ 本次无文本件可扫（N=0）—— 未覆盖任何文件（扫描集为空：纯删除/无暂存变更不引入内容）")
        return
    if coverage == "no-content":
        print(f"ℹ️ 本次无文本件可扫（N=0）—— 未覆盖任何文件"
              f"（共 {rep.checked} 件：全为二进制/超限/读取失败，已逐条点名；内容维度无覆盖）")
        return
    summary = f"检查 {rep.checked} 件 / 命中 {rep.hit_count} 件"
    if content_expected:
        summary += f"（内容扫描 {rep.text_scanned} 件）"
    if rep.binary_gaps:
        summary += f" / 未内容扫描（binary）{len(rep.binary_gaps)} 件"
    if rep.degraded:
        summary += f" / 未扫描 {len(rep.degraded)} 件（降级）"
    print(summary)


def coverage_of(rep: Report, content_expected: bool) -> str:
    """full = 该模式承诺的维度都有覆盖；empty = 一件都没扫；no-content = 有件但内容维度零覆盖。"""
    if rep.checked == 0:
        return "empty"
    if content_expected and rep.text_scanned == 0:
        return "no-content"
    return "full"


# ═══════════════════════════════════════════════════════════════
# --add-entry
# ═══════════════════════════════════════════════════════════════
def add_entry(patterns_path: str, plaintext: str) -> int:
    """把明文换算成指纹后落盘；**明文不写任何文件、不回显**。"""
    _require(bool(plaintext), "CN_PATTERNS_INVALID", "--add-entry 需要非空明文")
    if os.path.exists(patterns_path):
        with open(patterns_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        data = {"version": 1, "salt": os.urandom(16).hex(), "entries": [],
                "pathEntries": [], "binaryPolicy": {"allowlist": [], "default": "block"}}
    salt_hex = str(data.get("salt", ""))
    _require(len(salt_hex) % 2 == 0 and salt_hex != "", "CN_PATTERNS_INVALID", "salt 非法")
    salt = bytes.fromhex(salt_hex)
    digest = hash_name(salt, plaintext)
    length = len(plaintext)
    non_ascii = not plaintext.isascii()
    existing = {str(e.get("sha256", "")).lower() for e in data.get("entries", [])}
    if digest in existing:
        print(f"已存在: len={length} sha256={digest}（未新增）")
        return 0
    used = {str(e.get("id", "")) for e in data.get("entries", [])}
    n = 1
    while f"CN-{n:02d}" in used:
        n += 1
    new = {"id": f"CN-{n:02d}", "len": length, "sha256": digest, "nonAscii": non_ascii}
    data.setdefault("entries", []).append(dict(new))
    data.setdefault("pathEntries", []).append(dict(new))
    data.setdefault("binaryPolicy", {"allowlist": [], "default": "block"})
    tmp = patterns_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.replace(tmp, patterns_path)
    print(f"已登记 {new['id']}: len={length} sha256={digest} 文件={patterns_path}")
    return 0


# ═══════════════════════════════════════════════════════════════
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="scan-client-names.py",
        description="客户机密名滑窗哈希扫描门禁（D1063/CN-01）—— 三态退出码 0 通过 / 1 命中 / 2 降级")
    p.add_argument("--scan-staged", action="store_true", help="扫描暂存区（默认）")
    p.add_argument("--scan-filenames", nargs="*", default=None, metavar="PATH",
                   help="仅路径扫描；无 PATH ⇒ 全树")
    p.add_argument("--scan-content", nargs="*", default=None, metavar="PATH",
                   help="仅内容扫描；无 PATH ⇒ 全树全文")
    p.add_argument("--scan-all-tree", action="store_true", help="全树：路径 + 全文")
    p.add_argument("--add-entry", metavar="PLAINTEXT", default=None,
                   help="登记一个名称（只落 hash，明文不落盘）")
    p.add_argument("--review-binary", nargs="*", default=None, metavar="PATH",
                   help="复核二进制是否内含已登记名（登记 binaryPolicy.allowlist 前的必做步骤）；"
                        "无 PATH ⇒ 复核数据文件中已登记的全部 allowlist 条目")
    p.add_argument("--patterns", default=None, help="数据文件路径（运维显式覆盖；门禁不传）")
    p.add_argument("--repo", default=None, help="仓库根（默认 git toplevel）")
    p.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE_BYTES)
    p.add_argument("--json", action="store_true")
    p.add_argument("--quiet", action="store_true")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    patterns_path = args.patterns or DEFAULT_PATTERNS

    if args.add_entry is not None:
        try:
            return add_entry(patterns_path, args.add_entry)
        except ScanError as exc:
            print(exc.render(), file=sys.stderr)
            return 2
        except OSError as exc:
            print(f"degraded: 无法写入 {patterns_path}: {exc} "
                  f"(code=CN_PATTERNS_INVALID, phase=write, retryable=false)", file=sys.stderr)
            return 2

    modes = [bool(args.scan_staged), args.scan_filenames is not None,
             args.scan_content is not None, bool(args.scan_all_tree)]
    if sum(1 for m in modes if m) > 1:
        exclusive = sum(1 for m in (bool(args.scan_staged), bool(args.scan_all_tree)) if m)
        both_aspects = args.scan_filenames is not None and args.scan_content is not None
        if not (exclusive == 0 and both_aspects):
            print("degraded: 模式冲突（--scan-staged/--scan-all-tree 不可与其他模式并用）"
                  "(code=CN_MODE_CONFLICT, phase=argparse, retryable=false)", file=sys.stderr)
            return 2

    if not os.path.exists(patterns_path):
        print(f"degraded: 数据文件不存在 {patterns_path} —— 门禁无法判定，绝不视为通过 "
              f"(code=CN_PATTERNS_MISSING, phase=load, retryable=false)", file=sys.stderr)
        return 2
    try:
        with open(patterns_path, "r", encoding="utf-8") as fh:
            pat = Patterns(patterns_path, fh.read())
    except ScanError as exc:
        print(exc.render(), file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"degraded: 无法读取 {patterns_path}: {exc} "
              f"(code=CN_PATTERNS_MISSING, phase=load, retryable=true)", file=sys.stderr)
        return 2

    repo = args.repo
    if repo is None:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True)
        repo = top.stdout.decode("utf-8", "surrogateescape").strip() or os.getcwd()

    if args.review_binary is not None:
        targets = args.review_binary or sorted(pat.binary_allowlist)
        if not targets:
            print("degraded: --review-binary 未给 PATH 且 allowlist 为空 —— 无可复核对象 "
                  "(code=CN_PATTERNS_INVALID, phase=review, retryable=false)", file=sys.stderr)
            return 2
        try:
            return review_binary(pat, repo, targets, args.quiet)
        except ScanError as exc:
            print(exc.render(), file=sys.stderr)
            return 2

    try:
        git = Git(repo)
        scanner = Scanner(pat, git, args.max_file_bytes)

        if args.scan_all_tree:
            mode, rep = "all-tree", scanner.scan_tree()
            content_expected = True
        elif args.scan_filenames is None and args.scan_content is None:
            mode, rep = "staged", scanner.scan_staged()
            content_expected = False, True
        else:
            do_names = args.scan_filenames is not None
            do_content = args.scan_content is not None
            explicit = (args.scan_filenames if do_names else []) + (args.scan_content if do_content else [])
            if explicit:
                mode, rep = "explicit", scanner.scan_explicit(explicit, do_names, do_content)
                content_expected = do_content
            elif do_content:
                mode, rep = "tree", scanner.scan_tree()
                content_expected = True
            else:
                mode, rep = "tree-names", scanner.scan_tree_names_only()
                content_expected = False
    except ScanError as exc:
        print(exc.render(), file=sys.stderr)
        return 2

    emit(rep, args.quiet, args.json, mode, content_expected)

    if rep.hit_count > 0:
        return 1
    if rep.degraded:
        print(f"degraded: {len(rep.degraded)} 件未能扫描（读取失败/超限）—— 结论不完整"
              f"(code=CN_READ_FAILED, phase=scan, retryable=true)", file=sys.stderr)
        return 2
    if rep.binary_gaps:
        # CTO ③ fail-closed 读法（队长 2026-09-29 裁定采纳，见文件头 @binary）:
        #   变更集与全树清点**一律 exit 1** —— 未登记二进制 = 内容维度未覆盖，
        #   绝不能返回 0（否则 C2「全树清零」会靠二进制盲区假绿）。
        #   注: 严格按 D328 三态，「结论不完整」也可读作 exit 2；此处按裁定取 1（同样非 0，绝不假绿）。
        print(f"degraded: 未内容扫描（binary）{len(rep.binary_gaps)} 件 —— 二进制不做内容扫描，"
              f"须登记 binaryPolicy.allowlist 或移除"
              f"(code=CN_BINARY_UNREGISTERED, phase=scan, retryable=false)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
