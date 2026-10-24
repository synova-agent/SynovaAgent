#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ═══════════════════════════════════════════════════════════════════════════════
# check-test-obligations.py — 测试义务闸（#913 批 2 · Q-10 · 只判变更集 ＋ 清单级棘轮）
#
# 设计哲学（一句）: **把「非平凡模块必须有 expected/snapshot」从形容词变成可查表判据** ——
#   非平凡 ⇔ 台账有行且 surface ≠ none；缺资产点名到 `module → asset_glob`，
#   存量只走「只减不增」棘轮；**看不见（空扫描集／坏清单／坏 base）一律 exit 2，绝不冒充通过**。
#
# 契约（铁律 47）:
#   @input   git 仓库（--root，默认 `.`）＋ 三件显式权威:
#              --manifest <path>  非平凡台账（默认 tests/contract/triviality-manifest.yaml）
#              --base <ref>       变更基准（默认链 $SYNO_TEST_OBLIGATIONS_BASE → gitea/local-main → local-main）
#              --json / --selfcheck / --write-baseline
#   @output  人读: 汇总行 `modules=<n> legacy=<n> untriaged=<n>` ＋ 逐条 `❌ <rule> <target>: <msg>`
#              ＋ 末行 `TEST-OBLIGATIONS: PASS|SKIP|VIOLATIONS <n>|ERROR <code>`
#             --json: stdout 仅一份合法 JSON（人读行抑制）
#   @exit    **三态**（scripts/control-tower/AGENTS.md「判据三态退出码」）:
#              0 = 通过，或「无 src/** 变更」⇒ SKIP（A1：不适用 ≠ 看不见）
#              1 = 真红（O1 义务未补／O2 新增未 triage／N1·N2 命名／M1 存量棘轮／M2 exempt 过期／T1 trailer 失效）
#              2 = 检查自身失败（E_*；fail-closed，同样阻断，禁与「通过」混同）
#   @degraded 绝不静默（铁律 11/32）：任何降级打 stderr `degraded: <code> — <原因>`；
#              若设 $SYNO_GATE_DEGRADED_LOG 追加一行 JSON（time/component/code/phase/retryable）
#   @error   code ∈ {E_USAGE, E_BAD_BASE, E_GIT, E_MANIFEST, E_SCHEMA, E_NOSRC, E_INTERNAL}
#            🔴 **故意不设 E_EXPIRED**：exempt 过期是**真红 rc=1**（规格 §2／§4-S7／§8 三处一致），
#               只有「expiry 不可解析」才归 E_SCHEMA（rc=2）—— 把业务红降级成环境红 = 判据失明。
#   @rollback `SYNO_TEST_OBLIGATIONS=off|0|false|no` ⇒ 打印回滚态并 exit 0（规格 §6；
#            本 PR **不接 CI**，所以这是唯一断面，默认开）。--selfcheck 不读该开关（自检优先）。
#
# 规则（判据源 = `.handbook/派单件/2026-10-24-规格-913-PR2-分层与快照实施.md` §2/§3）:
#   M0 清单 schema: schema_version 必须 = 1（未知版本 ⇒ E_SCHEMA）；必填字段缺 ⇒ E_SCHEMA
#   M1 存量棘轮: legacy（未登记 src/**/*.ts 数）> meta.legacy_baseline ⇒ 红（只减不增）
#   M2 exempt 过期: obligation=exempt 且 expiry < today ⇒ 红（**清单级**，不因 SKIP 而吞 —— §8）
#   O1 义务: 变更集命中 surface 模块（obligation ∈ {expected,snapshot}）却无命中 asset_glob 的
#      新增/修改文件 ⇒ 红，点名 `<module> → <asset_glob>（实际改动：…）`
#   O2 新增兜底: 变更集**新增** src/**/*.ts 且有效逻辑行 ≥100 且含 export ⇒ 必须有 triage 行
#     （surface 任意 / none＋reason），否则 `untriaged: <path>` 红
#   T1 纯重构逃生（裁 353）: commit body 有 `NoBehaviorChange: <理由 ≥10 字>` ⇒ 该提交触及的
#      surface 模块免补资产；但该提交对该模块**新增行**含 `export `/`if (`/`switch (`/`case `
#      ⇒ `trailer 失效` 红（点名 commit ＋ 命中行）
#   N1 命名: 新增路径含 `golden`（大小写不敏感）或形如 `*.snapshot.ts` ⇒ 红
#   N2 命名: `tests/expected/**` 下新增文件须 `*.expected.json|*.expected.ts` ⇒ 否则红
#
# 既有基础（**禁重复建设** —— 四条既有约定原样复用）:
#   · 三态退出码 ＋ 判别力自检（信号量==0 ⇒ exit 2）= `scripts/control-tower/AGENTS.md`
#   · `SYNO_GIT_TIMEOUT_SEC`（git 子进程超时秒；≥0 整数）——**非法值 ⇒ E_ENV_INVALID / exit 2**，
#     不在 import 期抛裸 ValueError；超时 ⇒ `E_GIT_TIMEOUT` / exit 2（含 `--selfcheck` 夹具路径）
#   · `degraded: <code> — <原因>` ＋ $SYNO_GATE_DEGRADED_LOG 的 JSON 行 = 铁律 11/32 现行约定
#   · UTF-8 强制（D732）：stdout reconfigure ＋ 一切文件读写显式 `encoding="utf-8"`
#   · 无 PyYAML 的 YAML 子集解析（同 `claim_store.py`／`check-quality-delta.py` 的理由：
#     依赖缺失会退化成「台账读不到」= 另一条静默路径）
#
# 已知限制（Known Limitations —— 禁读成「已检测」）:
#   1. **YAML 子集**：只收本台账用到的形态（顶层键／flow map `{k: v}`／block map `- k: v`／
#      标量／`#` 注释）。锚点、多行标量、列表套列表**不在视野**；超出子集 ⇒ E_SCHEMA（fail-closed）。
#   2. **T1 是文本级判据**：`if (`/`case ` 等按新增行**字面**匹配 —— 注释/字符串里的同名片段也命中
#      （宁可误红，不误绿）；反向地「行为改了但新增行一个 token 都不含」（如只改表达式常量）抓不到。
#      故 T1 只承重最粗的一档，细粒度语义归 L1 复核。
#   3. **O1 只看「有没有命中 asset_glob 的变更文件」，不看资产内容是否真覆盖该模块行为** ——
#      内容真伪/快照质量归 PR-3 ①g（本 PR 只提供判据底座）。
#   4. **判 committed 变更集**：同 §3.1 口径（`git diff <mb>...HEAD`），未提交/未暂存改动**不在视野**
#      —— 本地「改了还没 commit」时本器会 SKIP，这不是漏判而是口径（CI 侧工作树 == HEAD）。
#   5. **module 前缀匹配**按路径边界（`p == m` 或 `p.startswith(m + "/")`）；改名/软链不追。
#      登记行指向不存在的模块 ⇒ 只打 note（不红）：路径搬迁不该被当成「义务已补」。
#   6. **legacy 口径** = `git ls-files src` 里 `*.ts`（含 `.d.ts`）− 已登记模块数，可核可复现。
#   7. **纯文档/纯测试变更 ⇒ SKIP**（A1），但**命名规则与清单级规则仍判**（S5/S7/S9：清单级红
#      与 golden 命名红即便无 src 变更也照红 —— 不因 SKIP 而吞）。
#   8. 本 PR **不接 CI**（①g 归 PR-3/P4）；`--write-baseline` 是**唯一**会写文件的路径，且只写清单。
# ═══════════════════════════════════════════════════════════════════════════════
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:  # D732：UTF-8 强制
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

COMPONENT = "check-test-obligations"
DEFAULT_MANIFEST = "tests/contract/triviality-manifest.yaml"
SCHEMA_VERSION = 1
SURFACES = ("protocol", "model", "human-visible", "none")
OBLIGATIONS = ("expected", "snapshot", "exempt")
OBLIGATED = ("expected", "snapshot")
NEW_FILE_MIN_LINES = 100          # §2「有效逻辑行 ≥100」
DEFAULT_GIT_TIMEOUT_SEC = 60           # 可用 SYNO_GIT_TIMEOUT_SEC 覆盖（非法值 ⇒ E_ENV_INVALID / exit 2）
TRAILER_MIN_REASON = 10           # §3.4「理由 ≥10 字」
BEHAVIOR_TOKENS = ("export ", "if (", "switch (", "case ")
OFF_VALUES = ("0", "off", "false", "no", "n")
TOP_KEYS = ("schema_version", "meta", "entries")


class ObligationError(Exception):
    """检查自身失败（→ exit 2，fail-closed）。**不是**业务红。"""

    def __init__(self, code: str, message: str, phase: str = "scan", retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.phase = phase
        self.retryable = retryable


def git_timeout_sec() -> int:
    """git 子进程超时秒数（每次读 env）。

    非法值（非整数 / 负数）⇒ **typed error**（E_ENV_INVALID → exit 2），
    不在 import 期抛裸 ValueError（#942/#946 复核 warn c）。
    """
    raw = os.environ.get("SYNO_GIT_TIMEOUT_SEC", str(DEFAULT_GIT_TIMEOUT_SEC))
    try:
        val = int(str(raw).strip())
    except (TypeError, ValueError):
        raise ObligationError("E_ENV_INVALID",
                              f"SYNO_GIT_TIMEOUT_SEC 非法: {raw!r}（须为 ≥0 的整数秒）", "env")
    if val < 0:
        raise ObligationError("E_ENV_INVALID",
                              f"SYNO_GIT_TIMEOUT_SEC 非法: {raw!r}（须为 ≥0 的整数秒）", "env")
    return val


# ── git ───────────────────────────────────────────────────────────────────────
def _git_cmd(root: str) -> List[str]:
    # core.quotepath=false：非 ASCII/空格路径不被八进制转义（判据按真实路径匹配）
    return ["git", "-C", root, "-c", "core.quotepath=false"]


def git(root: str, *args: str) -> str:
    _to = git_timeout_sec()
    try:
        p = subprocess.run(_git_cmd(root) + list(args), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=_to)
    except subprocess.TimeoutExpired as exc:
        raise ObligationError("E_GIT_TIMEOUT",
                              f"git {' '.join(args)} 超时（>{_to}s）") from exc
    if p.returncode != 0:
        raise ObligationError("E_GIT", f"git {' '.join(args)} 失败: {(p.stderr or '').strip()[:200]}")
    return p.stdout


def git_ok(root: str, *args: str) -> Tuple[int, str, str]:
    _to = git_timeout_sec()
    try:
        p = subprocess.run(_git_cmd(root) + list(args), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=_to)
    except subprocess.TimeoutExpired as exc:
        raise ObligationError("E_GIT_TIMEOUT",
                              f"git {' '.join(args)} 超时（>{_to}s）") from exc
    return p.returncode, p.stdout, p.stderr


def resolve_base(root: str, explicit: Optional[str]) -> str:
    """--base 优先；否则链 $SYNO_TEST_OBLIGATIONS_BASE → gitea/local-main → local-main。"""
    if explicit:
        cands = [explicit]
        desc = f"显式 --base {explicit}"
    else:
        cands = [os.environ.get("SYNO_TEST_OBLIGATIONS_BASE", ""), "gitea/local-main", "local-main"]
        desc = "$SYNO_TEST_OBLIGATIONS_BASE → gitea/local-main → local-main"
    for cand in cands:
        cand = (cand or "").strip()
        if not cand:
            continue
        rc, out, _ = git_ok(root, "rev-parse", "--verify", "-q", cand + "^{commit}")
        if rc == 0 and out.strip():
            return cand
    raise ObligationError("E_BAD_BASE", f"base 不可解析（{desc}）")


def change_set(root: str, base: str) -> Tuple[List[Tuple[str, str]], str]:
    """→ ([(status, path)] with --diff-filter=ACMR, merge-base 全 sha)。"""
    rc, out, err = git_ok(root, "merge-base", base, "HEAD")
    mb = out.strip()
    if rc != 0 or not mb:
        raise ObligationError("E_BAD_BASE", f"base={base} 无法与 HEAD 求 merge-base: {err.strip()[:200]}")
    raw = git(root, "diff", "--name-status", "--diff-filter=ACMR", f"{mb}...HEAD")
    changes: List[Tuple[str, str]] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status = parts[0][:1]
        path = parts[-1].strip()          # 重命名/复制取**新路径**
        if path:
            changes.append((status, path))
    return changes, mb


def list_src(root: str) -> List[str]:
    raw = git(root, "ls-files", "src")
    return sorted(p for p in raw.splitlines() if p.startswith("src/") and p.endswith(".ts"))


def is_src_ts(path: str) -> bool:
    return path.startswith("src/") and path.endswith(".ts")


def read_content(root: str, path: str) -> str:
    """工作树优先；不在工作树则回落到 HEAD（新增文件在 CI 检出树里一定有，回落只为本地健壮）。"""
    try:
        return (Path(root) / path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        pass
    rc, out, err = git_ok(root, "show", f"HEAD:{path}")
    if rc != 0:
        raise ObligationError("E_GIT", f"新增文件内容不可读 {path}: {(err or '').strip()[:160]}")
    return out


# ── YAML 子集（**故意不引 PyYAML**；与 claim_store.py 同语义）─────────────────
def _strip_inline_comment(raw: str) -> str:
    """剥离行内 `#` 注释 —— 仅当 `#` 前是行首/空白且不在引号内（`issue: "#913"` 不被截断）。"""
    out: List[str] = []
    quote = ""
    for i, ch in enumerate(raw):
        if ch in "\"'":
            quote = "" if quote == ch else (ch if quote == "" else quote)
            out.append(ch)
            continue
        if ch == "#" and quote == "" and (i == 0 or raw[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out)


def _unquote(raw: str) -> str:
    v = raw.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def _split_flow(body: str) -> List[str]:
    parts: List[str] = []
    buf: List[str] = []
    quote = ""
    depth = 0
    for ch in body:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = ""
            continue
        if ch in "\"'":
            quote = ch
            buf.append(ch)
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    if "".join(buf).strip():
        parts.append("".join(buf))
    return parts


def _flow_map(body: str, where: str) -> Dict[str, str]:
    body = body.strip()
    if not (body.startswith("{") and body.endswith("}")):
        raise ObligationError("E_SCHEMA", f"{where}: flow map 缺花括号: {body[:80]!r}", "manifest")
    out: Dict[str, str] = {}
    for chunk in _split_flow(body[1:-1]):
        if ":" not in chunk:
            raise ObligationError("E_SCHEMA", f"{where}: flow map 项缺冒号: {chunk.strip()[:60]!r}", "manifest")
        key, val = chunk.split(":", 1)
        out[_unquote(key)] = _unquote(val)
    return out


def parse_manifest(text: str, path: str = "<manifest>") -> Dict[str, object]:
    """解析台账（YAML 子集）→ {schema_version, meta{}, entries[]}；畸形一律 E_SCHEMA。"""
    data: Dict[str, object] = {"schema_version": None, "meta": {}, "entries": []}
    meta = data["meta"]
    entries = data["entries"]
    assert isinstance(meta, dict) and isinstance(entries, list)
    section = ""
    cur: Optional[Dict[str, str]] = None
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip("\r")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        line = _strip_inline_comment(line).rstrip()
        if not line.strip():
            continue
        where = f"{path}:{lineno}"
        if len(line) == len(line.lstrip()):
            cur = None
            m = re.match(r"^([A-Za-z_]\w*)\s*:\s*(.*)$", line)
            if not m:
                raise ObligationError("E_SCHEMA", f"{where}: 非法顶层行 {line.strip()[:60]!r}", "manifest")
            key, val = m.group(1), m.group(2).strip()
            if key not in TOP_KEYS:
                raise ObligationError(
                    "E_SCHEMA", f"{where}: 未知顶层键 {key!r}（只允许 {'/'.join(TOP_KEYS)}）—— 拒绝静默丢字段",
                    "manifest")
            section = key
            if key == "schema_version":
                if not re.match(r"^\d+$", val):
                    raise ObligationError("E_SCHEMA", f"{where}: schema_version 须为整数（得 {val!r}）", "manifest")
                data["schema_version"] = int(val)
            elif key == "meta":
                if val:
                    meta.update(_flow_map(val, where))
            else:  # entries
                if val and val != "[]":
                    raise ObligationError("E_SCHEMA", f"{where}: entries 只收块形式（或 `[]`）", "manifest")
            continue
        stripped = line.strip()
        if section == "meta":
            m = re.match(r"^([A-Za-z_]\w*)\s*:\s*(.*)$", stripped)
            if not m:
                raise ObligationError("E_SCHEMA", f"{where}: meta 下非法行 {stripped[:60]!r}", "manifest")
            meta[m.group(1)] = _unquote(m.group(2))
            continue
        if section == "entries":
            if stripped.startswith("-"):
                cur = {}
                entries.append(cur)
                stripped = stripped[1:].strip()
            if cur is None:
                raise ObligationError("E_SCHEMA", f"{where}: entries 片段没有起始 `-`", "manifest")
            if not stripped:
                continue
            if stripped.startswith("{"):
                cur.update(_flow_map(stripped, where))
            else:
                if ":" not in stripped:
                    raise ObligationError("E_SCHEMA", f"{where}: entry 行缺冒号 {stripped[:60]!r}", "manifest")
                key, val = stripped.split(":", 1)
                cur[_unquote(key)] = _unquote(val)
            continue
        raise ObligationError("E_SCHEMA", f"{where}: 缩进行出现在任何 section 之前: {stripped[:60]!r}", "manifest")
    return data


def _parse_date(value: str, where: str) -> datetime.date:
    try:
        parts = [int(x) for x in value.split("-")]
        return datetime.date(*parts)
    except (ValueError, TypeError):
        raise ObligationError("E_SCHEMA", f"{where}: expiry 不可解析（须 YYYY-MM-DD，得 {value!r}）", "manifest")


def validate_manifest(data: Dict[str, object], path: str) -> Dict[str, object]:
    sv = data.get("schema_version")
    if sv is None:
        raise ObligationError("E_SCHEMA", f"{path}: 缺 schema_version（fail-closed）", "manifest")
    if sv != SCHEMA_VERSION:
        raise ObligationError(
            "E_SCHEMA", f"{path}: 未知 schema_version={sv}（本器只认 {SCHEMA_VERSION}）—— 版本提升须同 PR 改清单",
            "manifest")
    meta = data.get("meta") or {}
    baseline_raw = str(dict(meta).get("legacy_baseline", ""))
    if not re.match(r"^\d+$", baseline_raw):
        raise ObligationError(
            "E_SCHEMA", f"{path}: meta.legacy_baseline 缺失或非整数（得 {baseline_raw!r}）", "manifest")
    rows: List[Dict[str, object]] = []
    seen = set()
    for idx, raw in enumerate(data.get("entries") or [], 1):
        where = f"{path}#entries[{idx}]"
        row = {k: str(v).strip() for k, v in dict(raw).items()}
        module = row.get("module", "")
        if not module:
            raise ObligationError("E_SCHEMA", f"{where}: 缺 module", "manifest")
        if module in seen:
            raise ObligationError("E_SCHEMA", f"{where}: module 重复登记 {module!r}（同模块只许一行）", "manifest")
        seen.add(module)
        surface = row.get("surface", "")
        if surface not in SURFACES:
            raise ObligationError("E_SCHEMA", f"{where}: surface={surface!r} 非法（允许 {'/'.join(SURFACES)}）",
                                  "manifest")
        obligation = row.get("obligation", "")
        if obligation not in OBLIGATIONS:
            raise ObligationError(
                "E_SCHEMA", f"{where}: obligation={obligation!r} 非法（允许 {'/'.join(OBLIGATIONS)}）", "manifest")
        row["surface"] = surface
        row["obligation"] = obligation
        if obligation in OBLIGATED and not row.get("asset_glob"):
            raise ObligationError("E_SCHEMA", f"{where}: obligation={obligation} 必须给 asset_glob", "manifest")
        if obligation == "exempt":
            missing = [k for k in ("issue", "expiry", "reason") if not row.get(k)]
            if missing:
                raise ObligationError(
                    "E_SCHEMA", f"{where}: exempt 行必须带 issue＋expiry＋reason（缺 {', '.join(missing)}）", "manifest")
            row["expiry_date"] = _parse_date(row["expiry"], where)
        elif row.get("expiry"):
            row["expiry_date"] = _parse_date(row["expiry"], where)   # 非法日期同样 fail-closed
        if surface == "none" and not row.get("reason"):
            raise ObligationError(
                "E_SCHEMA", f"{where}: surface=none 必须带 reason（triage 是显式判断，不是省略）", "manifest")
        rows.append(row)
    return {"schema_version": sv, "meta": dict(meta), "entries": rows}


# ── 匹配 ─────────────────────────────────────────────────────────────────────
def module_match(path: str, module: str) -> bool:
    m = module.rstrip("/")
    return path == m or path.startswith(m + "/")


def _glob_to_regex(pattern: str) -> str:
    out: List[str] = []
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "*":
            if i + 1 < len(pattern) and pattern[i + 1] == "*":
                out.append(".*")
                i += 2
                if i < len(pattern) and pattern[i] == "/":
                    i += 1
                continue
            out.append("[^/]*")
            i += 1
            continue
        if ch == "?":
            out.append("[^/]")
            i += 1
            continue
        out.append(re.escape(ch))
        i += 1
    return "".join(out)


def glob_match(path: str, pattern: str) -> bool:
    return re.match(_glob_to_regex(pattern) + "$", path) is not None


def logic_lines(text: str) -> int:
    """有效逻辑行 = 去空行、去行注释/块注释行（`//` `/*` `*` `*/`）。"""
    n = 0
    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue
        if s.startswith("//") or s.startswith("/*") or s.startswith("*") or s.startswith("*/"):
            continue
        n += 1
    return n


def has_export(text: str) -> bool:
    return re.search(r"(?m)^\s*export\b", text) is not None


_TRAILER_RE = re.compile(r"(?m)^\s*NoBehaviorChange\s*:\s*(.+?)\s*$")


def trailer_reason(body: str) -> Optional[str]:
    m = _TRAILER_RE.search(body or "")
    return m.group(1).strip() if m else None


def commit_list(root: str, mb: str) -> List[str]:
    return [h for h in git(root, "log", "--no-merges", "--format=%H", f"{mb}..HEAD").split() if h]


def commit_files(root: str, sha: str) -> List[str]:
    raw = git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha)
    return [p for p in raw.splitlines() if p.strip()]


def commit_added_lines(root: str, sha: str) -> Dict[str, List[str]]:
    """该提交每个文件的新增行（`+` 行；不追重命名 —— `--no-renames` 拆成删＋增更安全）。"""
    raw = git(root, "show", "--no-color", "--no-renames", "--format=", sha)
    out: Dict[str, List[str]] = {}
    cur: Optional[str] = None
    for line in raw.splitlines():
        if line.startswith("diff --git "):
            cur = None
            continue
        if line.startswith("+++ "):
            name = line[6:].strip()
            cur = None if name == "/dev/null" else name
            continue
        if cur and line.startswith("+") and not line.startswith("+++"):
            out.setdefault(cur, []).append(line[1:])
    return out


# ── 报告 ─────────────────────────────────────────────────────────────────────
class Report(object):
    def __init__(self) -> None:
        self.manifest = DEFAULT_MANIFEST
        self.base_ref = ""
        self.base_sha = ""
        self.head = ""
        self.modules = 0
        self.legacy = 0
        self.baseline = 0
        self.untriaged = 0
        self.changed: List[str] = []
        self.changed_src = 0
        self.added: List[str] = []
        self.violations: List[Tuple[str, str, str]] = []
        self.notes: List[str] = []
        self.skip = False


def run_check(root: str, manifest_path: str, base_arg: Optional[str],
              write_baseline: bool = False) -> Report:
    rep = Report()
    rep.manifest = manifest_path.replace(os.sep, "/")
    rep.base_ref = base_arg or "（默认链）"
    base = resolve_base(root, base_arg)                       # E_BAD_BASE
    rep.base_ref = base
    rep.head = git(root, "rev-parse", "--short=12", "HEAD").strip()

    mpath = Path(root) / manifest_path
    try:
        text = mpath.read_text(encoding="utf-8")
    except OSError as exc:
        raise ObligationError("E_MANIFEST", f"台账不可读 {mpath}: {exc}", "manifest")
    manifest = validate_manifest(parse_manifest(text, manifest_path), manifest_path)   # E_SCHEMA
    entries = manifest["entries"]
    meta = manifest["meta"]
    assert isinstance(entries, list) and isinstance(meta, dict)
    rep.modules = len([e for e in entries if e["surface"] != "none"])

    src_files = list_src(root)                                # E_GIT
    if not src_files:
        raise ObligationError("E_NOSRC", f"扫描根 {os.path.abspath(root)} 下 src/**/*.ts = 0 个"
                                          f"（禁把「看不见」当「没问题」）", "scan")
    registered = [e["module"] for e in entries]
    rep.legacy = len([f for f in src_files if not any(module_match(f, m) for m in registered)])
    for e in entries:
        if e["module"].endswith(".ts") and e["module"] not in src_files:
            rep.notes.append(f"registered-missing: {e['module']}（登记行的模块不在 src/**/*.ts 扫描集"
                             f" —— 路径已搬家/删除？义务不会被这条登记兜住）")

    # M1 存量棘轮（清单级；只减不增）
    baseline = int(str(meta["legacy_baseline"]))
    rep.baseline = baseline
    ratchet_done = False
    if write_baseline:
        if rep.legacy > baseline:
            rep.violations.append(("M1", manifest_path,
                                   f"legacy={rep.legacy} > baseline={baseline}（只减不增；--write-baseline 拒绝抬高）"))
            ratchet_done = True
        elif rep.legacy < baseline:
            new_text, n = re.subn(r"(legacy_baseline\s*:\s*)(\d+)",
                                  lambda m: m.group(1) + str(rep.legacy), text, count=1)
            if n != 1:
                raise ObligationError("E_SCHEMA", f"{manifest_path}: 无 legacy_baseline 可写", "manifest")
            try:
                mpath.write_text(new_text, encoding="utf-8")
            except OSError as exc:
                raise ObligationError("E_MANIFEST", f"台账不可写 {mpath}: {exc}", "manifest")
            rep.baseline = rep.legacy
            rep.notes.append(f"BASELINE: {baseline} → {rep.legacy}（只减不增；已写 {manifest_path}）")
            baseline = rep.legacy
            ratchet_done = True
        else:
            rep.notes.append(f"BASELINE: {baseline}（已是当前值；未改）")
            ratchet_done = True
    if not ratchet_done and rep.legacy > baseline:
        rep.violations.append(("M1", manifest_path,
                               f"legacy={rep.legacy} > baseline={baseline}（存量只减不增）"))

    # M2 exempt 过期（清单级；不因 SKIP 而吞 —— 规格 §8）
    today = datetime.date.today()
    for e in entries:
        if e["obligation"] == "exempt" and e.get("expiry_date") and e["expiry_date"] < today:
            rep.violations.append(("M2", e["module"],
                                   f"expiry 已过期（{e['expiry']} < {today.isoformat()}）"
                                   f" —— exempt 行必须续期或补资产"))

    # 变更集
    changes, mb = change_set(root, base)                      # E_BAD_BASE / E_GIT
    rep.base_sha = mb[:12]
    rep.changed = [p for _, p in changes]
    rep.added = [p for st, p in changes if st == "A"]
    src_changed = [p for p in rep.changed if is_src_ts(p)]
    rep.changed_src = len(src_changed)
    rep.skip = not src_changed

    # O2 新增兜底（新增 src/**/*.ts 且 ≥100 有效逻辑行且有 export ⇒ 必须有 triage 行）
    untriaged: List[str] = []
    for p in rep.added:
        if not is_src_ts(p):
            continue
        content = read_content(root, p)
        if logic_lines(content) >= NEW_FILE_MIN_LINES and has_export(content):
            if not any(module_match(p, e["module"]) for e in entries):
                untriaged.append(p)
    rep.untriaged = len(untriaged)
    for p in untriaged:
        rep.violations.append(("O2", p,
                               f"untriaged: {p}（新增 ≥{NEW_FILE_MIN_LINES} 有效逻辑行且有 export，"
                               f"台账无 triage 行 —— 加 surface 或 surface:none＋reason）"))

    # N1/N2 命名（对**新增**文件；即便无 src 变更也判 —— S9）
    for p in rep.added:
        low = p.lower()
        if "golden" in low or low.endswith(".snapshot.ts"):
            rep.violations.append(("N1", p, "命名红：新增文件含 golden 或形如 *.snapshot.ts"
                                            "（改用 tests/expected/**/*.expected.json|*.expected.ts）"))
        elif p.startswith("tests/expected/") and not (
                low.endswith(".expected.json") or low.endswith(".expected.ts")):
            rep.violations.append(("N2", p, "命名红：tests/expected/** 下新增文件须为"
                                            " *.expected.json 或 *.expected.ts"))

    # T1 纯重构逃生（裁 353）：per-commit / per-module 判，且**全部**触及提交都有效才免
    exempt_modules = set()
    if src_changed:
        touch_state: Dict[str, List[bool]] = {}
        for sha in commit_list(root, mb):
            short = sha[:7]
            body = git(root, "show", "-s", "--format=%B", sha)
            reason = trailer_reason(body)
            files = commit_files(root, sha)
            touched = [e for e in entries
                       if e["surface"] != "none" and e["obligation"] in OBLIGATED
                       and any(module_match(f, e["module"]) for f in files)]
            if not touched:
                continue
            if reason is None:
                for e in touched:
                    touch_state.setdefault(e["module"], []).append(False)
                continue
            if len(reason) < TRAILER_MIN_REASON:
                rep.notes.append(f"trailer 理由过短（<{TRAILER_MIN_REASON} 字）不生效: commit {short}"
                                 f"「{reason}」")
                for e in touched:
                    touch_state.setdefault(e["module"], []).append(False)
                continue
            added_lines = commit_added_lines(root, sha)
            for e in touched:
                hits: List[Tuple[str, str]] = []
                for path, lines in added_lines.items():
                    if not module_match(path, e["module"]):
                        continue
                    for one in lines:
                        tok = next((t for t in BEHAVIOR_TOKENS if t in one), "")
                        if tok:
                            hits.append((path, one.strip()))
                if hits:
                    for path, one in hits[:5]:
                        rep.violations.append(
                            ("T1", path,
                             f"trailer 失效：commit {short} 声明 NoBehaviorChange「{reason}」"
                             f" 但新增行含行为变更 → +{one[:120]}"))
                    touch_state.setdefault(e["module"], []).append(False)
                else:
                    touch_state.setdefault(e["module"], []).append(True)
        exempt_modules = set(m for m, states in touch_state.items() if states and all(states))

    # O1 义务（surface 模块被改 ⇒ 变更集必须含命中 asset_glob 的新增/修改文件）
    if src_changed:
        for e in entries:
            if e["surface"] == "none" or e["obligation"] not in OBLIGATED:
                continue
            matched = [p for p in src_changed if module_match(p, e["module"])]
            if not matched:
                continue
            if e["module"] in exempt_modules:
                rep.notes.append(f"trailer 免除义务: {e['module']}（NoBehaviorChange 生效）")
                continue
            assets = [p for p in rep.changed if glob_match(p, e["asset_glob"])]
            if not assets:
                rep.violations.append(
                    ("O1", e["module"],
                     f"{e['module']} → {e['asset_glob']}（实际改动：{', '.join(matched)}）"))
    return rep


# ── 输出 ─────────────────────────────────────────────────────────────────────
def emit(rep: Report, as_json: bool) -> None:
    if as_json:
        print(json.dumps({
            "status": "violations" if rep.violations else ("skip" if rep.skip else "pass"),
            "base_ref": rep.base_ref, "base": rep.base_sha, "head": rep.head,
            "manifest": rep.manifest,
            "modules": rep.modules, "legacy": rep.legacy, "baseline": rep.baseline,
            "untriaged": rep.untriaged,
            "changed": len(rep.changed), "src_changes": rep.changed_src,
            "added": len(rep.added), "skip": rep.skip,
            "notes": rep.notes,
            "violations": [{"rule": r, "target": t, "message": m} for r, t, m in rep.violations],
        }, ensure_ascii=False))
        return
    print(f"ℹ️  base={rep.base_ref} mb={rep.base_sha} head={rep.head} manifest={rep.manifest} "
          f"baseline={rep.baseline} changes={len(rep.changed)} src_changes={rep.changed_src}")
    print(f"modules={rep.modules} legacy={rep.legacy} untriaged={rep.untriaged}")
    for n in rep.notes:
        print(f"ℹ️  {n}")
    if rep.skip and not rep.violations:
        print(f"SKIP: 无 src/** 变更（base={rep.base_sha}）")
    for rule, target, msg in rep.violations:
        print(f"❌ {rule} {target}: {msg}")
    if rep.violations:
        print(f"TEST-OBLIGATIONS: VIOLATIONS {len(rep.violations)}")
    elif rep.skip:
        print(f"TEST-OBLIGATIONS: SKIP base={rep.base_sha}")
    else:
        print(f"TEST-OBLIGATIONS: PASS changes={len(rep.changed)} src_changes={rep.changed_src} "
              f"base={rep.base_sha}")


def degraded(code: str, msg: str, phase: str = "scan", retryable: bool = False) -> None:
    """降级绝不静默（铁律 11/32）：stderr 一行 ＋ 可选 JSON 行。"""
    sys.stderr.write(f"degraded: {code} — {msg}\n")
    logp = os.environ.get("SYNO_GATE_DEGRADED_LOG", "").strip()
    if not logp:
        return
    try:
        rec = {"time": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
               "component": COMPONENT, "code": code, "phase": phase,
               "retryable": retryable, "message": msg[:300]}
        Path(logp).parent.mkdir(parents=True, exist_ok=True)
        with open(logp, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass  # 日志不可写不得掩盖主错误（stderr 已打）


# ── 判别力自检（--selfcheck；信号量==0 ⇒ exit 2）─────────────────────────────
def _sh(cwd: str, *args: str) -> str:
    _to = git_timeout_sec()
    try:
        p = subprocess.run(["git"] + list(args), cwd=cwd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=_to)
    except subprocess.TimeoutExpired as exc:
        raise ObligationError("E_GIT_TIMEOUT",
                              f"selfcheck 夹具 git {' '.join(args)} 超时（>{_to}s）", "selfcheck") from exc
    if p.returncode != 0:
        raise ObligationError("E_GIT", f"夹具 git {' '.join(args)} 失败: {(p.stderr or '').strip()[:200]}",
                              "selfcheck")
    return p.stdout


def _init_repo(d: Path) -> None:
    d.mkdir(parents=True, exist_ok=True)
    _sh(str(d), "init", "-q")
    _sh(str(d), "config", "user.email", "selfcheck@example.invalid")
    _sh(str(d), "config", "user.name", "selfcheck")
    _sh(str(d), "config", "commit.gpgsign", "false")


def _write(d: Path, rel: str, content: str) -> None:
    p = d / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def _commit(d: Path, msg: str) -> str:
    _sh(str(d), "add", "-A")
    _sh(str(d), "commit", "-q", "--no-verify", "--allow-empty", "-m", msg)
    return _sh(str(d), "rev-parse", "HEAD").strip()


def _fixture(tmp: Path, name: str, files: Dict[str, str]) -> Tuple[Path, str]:
    d = tmp / name
    _init_repo(d)
    for rel, content in files.items():
        _write(d, rel, content)
    return d, _commit(d, "base")


def _manifest_text(entries: List[str], baseline: int, schema_version: int = 1) -> str:
    lines = [f"schema_version: {schema_version}",
             f'meta: {{ as_of: "selfcheck@fixture", ruling: "selfcheck", legacy_baseline: {baseline} }}',
             "entries:"]
    lines += [f"  - {{ {e} }}" for e in entries]
    return "\n".join(lines) + "\n"


def _ts(n: int = 5, export: bool = True) -> str:
    body = ["// fixture"]
    body += [f"const v{i} = {i};" for i in range(n)]
    if export:
        body.append("export function cv(): number { return 1; }")
    return "\n".join(body) + "\n"


def _expect(rep: Report, rule: str) -> List[str]:
    return [m for r, _t, m in rep.violations if r == rule]


def _sc1(tmp: Path) -> Tuple[bool, str]:
    """s1 = S1：干净树 ⇒ 无违规 + SKIP + modules/legacy/untriaged 口径正确。"""
    d, base = _fixture(tmp, "s1", {
        "src/a/x.ts": _ts(), "src/a/y.ts": _ts(), "src/b/z.ts": _ts(),
        "src/c/w.ts": _ts(), "src/d/v.ts": _ts(),
        "tests/contract/triviality-manifest.yaml": _manifest_text([
            'module: src/a/x.ts, surface: protocol, obligation: expected, asset_glob: "tests/expected/a/**"',
            'module: src/a/y.ts, surface: model, obligation: snapshot, asset_glob: "tests/expected/a/**"',
        ], baseline=3),
    })
    rep = run_check(str(d), DEFAULT_MANIFEST, base)
    ok = (not rep.violations) and rep.skip and rep.modules == 2 and rep.legacy == 3 and rep.untriaged == 0
    return ok, (f"modules={rep.modules}(2) legacy={rep.legacy}(3) untriaged={rep.untriaged}(0) "
                f"skip={rep.skip} violations={len(rep.violations)}(0)")


def _sc2(tmp: Path) -> Tuple[bool, str]:
    """s2 = S2：改 surface 模块且无资产 ⇒ O1 点名 `module → asset_glob（实际改动：…）`。"""
    d, base = _fixture(tmp, "s2", {
        "src/agent/context-compaction.ts": _ts(),
        "tests/contract/triviality-manifest.yaml": _manifest_text([
            'module: src/agent/context-compaction.ts, surface: model, obligation: snapshot, '
            'asset_glob: "tests/expected/compaction/**"',
        ], baseline=0),
    })
    _write(d, "src/agent/context-compaction.ts", _ts() + "export const changed = 1;\n")
    _commit(d, "feat: 改模块无资产")
    rep = run_check(str(d), DEFAULT_MANIFEST, base)
    msgs = _expect(rep, "O1")
    token = "→ tests/expected/compaction/**（实际改动：src/agent/context-compaction.ts）"
    ok = bool(msgs) and any(token in m for m in msgs)
    return ok, (msgs[0] if ok else f"未点名 O1（violations={rep.violations}）")


def _sc3(tmp: Path) -> Tuple[bool, str]:
    """s3 = S3：同 s2 ＋ 补 tests/expected 资产 ⇒ 0 违规（两态的正态）。"""
    d, base = _fixture(tmp, "s3", {
        "src/agent/context-compaction.ts": _ts(),
        "tests/contract/triviality-manifest.yaml": _manifest_text([
            'module: src/agent/context-compaction.ts, surface: model, obligation: snapshot, '
            'asset_glob: "tests/expected/compaction/**"',
        ], baseline=0),
    })
    _write(d, "src/agent/context-compaction.ts", _ts() + "export const changed = 1;\n")
    _write(d, "tests/expected/compaction/x.expected.json", "{}\n")
    _commit(d, "test: 改模块＋补资产")
    rep = run_check(str(d), DEFAULT_MANIFEST, base)
    ok = not rep.violations
    return ok, (f"violations={[(r, t) for r, t, _ in rep.violations]}(期望空) src_changes={rep.changed_src}")


def _sc4(tmp: Path) -> Tuple[bool, str]:
    """s4 = S4：新增 110 有效行 src 文件且台账无行 ⇒ `untriaged: <path>`。"""
    d, base = _fixture(tmp, "s4", {
        "src/seed.ts": _ts(),
        "tests/contract/triviality-manifest.yaml": _manifest_text([], baseline=1),
    })
    _write(d, "src/x/new.ts", _ts(110))
    _commit(d, "feat: 新模块未 triage")
    rep = run_check(str(d), DEFAULT_MANIFEST, base)
    msgs = _expect(rep, "O2")
    ok = bool(msgs) and any("untriaged: src/x/new.ts" in m for m in msgs) and rep.untriaged == 1
    return ok, (msgs[0] if ok else f"未点名 O2（violations={rep.violations}）")


def _sc5(tmp: Path) -> Tuple[bool, str]:
    """s5 = S5：删台账一行 ⇒ `legacy=<n> > baseline`（清单级，SKIP 不吞）。"""
    entries = [
        'module: src/a/x.ts, surface: protocol, obligation: expected, asset_glob: "tests/expected/a/**"',
        'module: src/a/y.ts, surface: protocol, obligation: expected, asset_glob: "tests/expected/a/**"',
    ]
    d, base = _fixture(tmp, "s5", {
        "src/a/x.ts": _ts(), "src/a/y.ts": _ts(), "src/b/z.ts": _ts(), "src/c/w.ts": _ts(),
        "tests/contract/triviality-manifest.yaml": _manifest_text(entries, baseline=2),
    })
    _write(d, "tests/contract/triviality-manifest.yaml", _manifest_text(entries[:1], baseline=2))
    _commit(d, "chore: 删一行台账")
    rep = run_check(str(d), DEFAULT_MANIFEST, base)
    msgs = _expect(rep, "M1")
    ok = bool(msgs) and any("legacy=3 > baseline=2" in m for m in msgs)
    return ok, (msgs[0] if ok else f"未点名 M1（legacy={rep.legacy} violations={rep.violations}）")


def _sc6(tmp: Path) -> Tuple[bool, str]:
    """s6 = S6：NoBehaviorChange ＋ 新增行含 `export ` ⇒ trailer 失效（点名 commit）。"""
    d, base = _fixture(tmp, "s6", {
        "src/agent/context-compaction.ts": _ts(),
        "tests/contract/triviality-manifest.yaml": _manifest_text([
            'module: src/agent/context-compaction.ts, surface: model, obligation: snapshot, '
            'asset_glob: "tests/expected/compaction/**"',
        ], baseline=0),
    })
    _write(d, "src/agent/context-compaction.ts", _ts() + "export function extra(): number { return 2; }\n")
    _commit(d, "refactor: 重命名变量\n\nNoBehaviorChange: 本次只重命名局部变量")
    rep = run_check(str(d), DEFAULT_MANIFEST, base)
    msgs = _expect(rep, "T1")
    ok = bool(msgs) and any("trailer 失效" in m and "commit " in m for m in msgs)
    return ok, (msgs[0] if ok else f"未点名 T1（violations={rep.violations}）")


def _sc7(tmp: Path) -> Tuple[bool, str]:
    """s7 = S7：exempt 行 expiry 过期 ⇒ `expiry 已过期`（rc=1 清单级）。"""
    d, base = _fixture(tmp, "s7", {
        "src/legacy/x.ts": _ts(),
        "tests/contract/triviality-manifest.yaml": _manifest_text([
            'module: src/legacy/x.ts, surface: none, obligation: exempt, issue: "#913", '
            'expiry: "2020-01-01", reason: "存量豁免（夹具）"',
        ], baseline=0),
    })
    rep = run_check(str(d), DEFAULT_MANIFEST, base)
    msgs = _expect(rep, "M2")
    ok = bool(msgs) and any("expiry 已过期" in m for m in msgs)
    return ok, (msgs[0] if ok else f"未点名 M2（violations={rep.violations}）")


def _sc8(tmp: Path) -> Tuple[bool, str]:
    """s8 = S8：空变更集 ⇒ SKIP（rc0）｜坏 base ⇒ E_BAD_BASE｜扫描根 0 src ⇒ E_NOSRC。"""
    m = _manifest_text(['module: src/a/x.ts, surface: protocol, obligation: expected, '
                        'asset_glob: "tests/expected/a/**"'], baseline=0)
    d, base = _fixture(tmp, "s8a", {"src/a/x.ts": _ts(), "tests/contract/triviality-manifest.yaml": m})
    rep = run_check(str(d), DEFAULT_MANIFEST, base)
    part_a = (not rep.violations) and rep.skip
    try:
        run_check(str(d), DEFAULT_MANIFEST, "nosuchref-selfcheck")
        part_b = False
    except ObligationError as exc:
        part_b = (exc.code == "E_BAD_BASE")
    d2, _ = _fixture(tmp, "s8c", {"tests/contract/triviality-manifest.yaml": _manifest_text([], baseline=0)})
    try:
        run_check(str(d2), DEFAULT_MANIFEST, "HEAD")
        part_c = False
    except ObligationError as exc:
        part_c = (exc.code == "E_NOSRC")
    return (part_a and part_b and part_c), \
        f"空集SKIP={part_a}(期望1) 坏base={part_b}(期望1) 零src={part_c}(期望1)"


def _sc9(tmp: Path) -> Tuple[bool, str]:
    """s9 = S9：新增 golden 文件（无 src 变更）⇒ 命名红。"""
    d, base = _fixture(tmp, "s9", {
        "src/keep.ts": _ts(),
        "tests/contract/triviality-manifest.yaml": _manifest_text([], baseline=1),
    })
    _write(d, "tests/expected/x/foo.golden.json", "{}\n")
    _commit(d, "test: 新增 golden")
    rep = run_check(str(d), DEFAULT_MANIFEST, base)
    msgs = _expect(rep, "N1")
    ok = bool(msgs) and any("命名红" in m and "golden" in m for m in msgs)
    return ok, (msgs[0] if ok else f"未点名 N1（violations={rep.violations}）")


SELFCHECKS = [("s1", _sc1), ("s2", _sc2), ("s3", _sc3), ("s4", _sc4), ("s5", _sc5),
              ("s6", _sc6), ("s7", _sc7), ("s8", _sc8), ("s9", _sc9)]


def selfcheck() -> int:
    """判别力自检：每条规则必须在夹具上**真的响**；信号量==0 的子项 ⇒ exit 2（禁当通过）。"""
    tmp = Path(tempfile.mkdtemp(prefix="synova-oblig-selfcheck-"))
    results: List[Tuple[str, bool, str]] = []
    try:
        for name, fn in SELFCHECKS:
            try:
                ok, detail = fn(tmp)
            except ObligationError as exc:
                ok, detail = False, f"夹具/检查自身失败 {exc.code}: {exc}"
            except Exception as exc:  # noqa: BLE001 —— 自检里的 bug 也必须可见
                ok, detail = False, f"未预期异常 {type(exc).__name__}: {exc}"
            results.append((name, bool(ok), detail))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for name, ok, detail in results:
        print(f"{'✅' if ok else '❌'} selfcheck {name}={'1' if ok else '0'} — {detail}")
    flag = "/".join("1" if ok else "0" for _, ok, _ in results)
    zeros = [name for name, ok, _ in results if not ok]
    if zeros:
        print(f"SELFCHECK-FAIL s1..s9={flag}（信号量==0 的子项：{','.join(zeros)} ⇒ 判据失明，禁当通过）")
        return 2
    print(f"SELFCHECK-OK s1..s9={flag}")
    return 0


# ── 主流程 ───────────────────────────────────────────────────────────────────
def _rollback() -> bool:
    return os.environ.get("SYNO_TEST_OBLIGATIONS", "").strip().lower() in OFF_VALUES


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="测试义务闸（#913 · Q-10 · 只判变更集 ＋ 清单级棘轮）")
    ap.add_argument("--root", default=".", help="仓库根（默认 .；显式权威）")
    ap.add_argument("--base", default=None,
                    help="base ref（默认 $SYNO_TEST_OBLIGATIONS_BASE → gitea/local-main → local-main）")
    ap.add_argument("--manifest", default=None, help=f"非平凡台账（默认 {DEFAULT_MANIFEST}）")
    ap.add_argument("--json", action="store_true", help="stdout 仅输出一份 JSON")
    ap.add_argument("--selfcheck", action="store_true", help="判别力自检（s1..s9；信号量==0 ⇒ exit 2）")
    ap.add_argument("--write-baseline", action="store_true", dest="write_baseline",
                    help="把 legacy_baseline 降到当前值（只减不增；唯一写文件路径）")
    try:
        args = ap.parse_args(argv)
    except SystemExit:
        degraded("E_USAGE", "参数解析失败")
        return 2

    if args.selfcheck:
        try:
            return selfcheck()
        except ObligationError as exc:
            degraded(exc.code, str(exc), exc.phase, exc.retryable)
            if args.json:
                print(json.dumps({"status": "error", "code": exc.code, "message": str(exc)}, ensure_ascii=False))
            else:
                print(f"TEST-OBLIGATIONS: ERROR {exc.code}")
            return 2

    if _rollback():
        print("ℹ️  回滚态（SYNO_TEST_OBLIGATIONS=off）—— 跳过（唯一回滚点，不判红；规格 §6）")
        return 0

    root = os.path.abspath(args.root)
    if not Path(root).is_dir():
        degraded("E_USAGE", f"--root 不是目录: {root}")
        print("TEST-OBLIGATIONS: ERROR E_USAGE")
        return 2
    manifest_path = (args.manifest or DEFAULT_MANIFEST).replace(os.sep, "/")
    try:
        rep = run_check(root, manifest_path, args.base, write_baseline=args.write_baseline)
    except ObligationError as exc:
        degraded(exc.code, str(exc), exc.phase, exc.retryable)
        if args.json:
            print(json.dumps({"status": "error", "code": exc.code, "message": str(exc)}, ensure_ascii=False))
        else:
            print(f"TEST-OBLIGATIONS: ERROR {exc.code}")
        return 2
    except Exception as exc:  # noqa: BLE001 —— 宁可 exit 2 也不把 bug 当绿
        degraded("E_INTERNAL", f"未预期异常 {type(exc).__name__}: {exc}")
        if args.json:
            print(json.dumps({"status": "error", "code": "E_INTERNAL", "message": str(exc)},
                             ensure_ascii=False))
        else:
            print("TEST-OBLIGATIONS: ERROR E_INTERNAL")
        return 2

    emit(rep, args.json)
    return 1 if rep.violations else 0


if __name__ == "__main__":
    sys.exit(main())
