#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ═══════════════════════════════════════════════════════════════════════════════
# check-acceptance-matrix.py — 验收矩阵校验器（#1054 · `acceptance-matrix/v1` · P0）
#
# 设计哲学（一句）: **把「声明」与「事实」分开存、再对账** —— 矩阵只携带声明，
#   机械 11 项由本器在 anchor 上复算；**判不了就 exit 2，绝不当通过**。
#
# 契约（铁律 47；与 `docs/synova/acceptance/README.md` §0 同文）:
#   @input   <matrix.yaml> [--repo R] [--anchor SHA] [--verify] [--json]
#            --repo 缺省 "."；--anchor 缺省 = 矩阵的 anchor 字段
#   @output  逐项一行 `<id> <status> <verdict> <detail>`（23 行，顺序固定：Q-1…Q-15、T-1…T-8）；
#            失败追加 `ISSUE <code> <item|-> <detail>` 行；
#            stderr 可含 T-8 scope 提示（每个被跳过的候选目录恰一行；**stdout 行数契约不变**）：
#              `T-8 scope: skip record-only dir <dir>` ｜ `T-8 scope: skip out-of-scope dir <dir>`
#            末行 ∈ { MATRIX: PASS 23/23 (mach 11/11, sem 12 attested)
#                   | MATRIX: FAIL <n> issue(s)
#                   | MATRIX: UNJUDGED <code>            ← exit 2（判不了）
#                   | VERIFY: mach <ok>/11 consistent }  ← 仅 --verify 且全一致
#   @exit    **三态**（ctrl-tower-change 模式 1）:
#              0 = 通过（含 --verify 全一致）
#              1 = 真红（矩阵结构/字段、声明与机械事实矛盾、机械硬违反）
#              2 = 判不了（用法错／矩阵文件不可读／仓不可读／anchor 不可解析／git 不可用）—— 同样阻断
#   @degraded 绝不静默（铁律 11/32）: exit 2 时 stderr 一行
#              `degraded: <code> phase=<phase> — <原因>`
#              ＋ stdout 一行 `UNJUDGED <code> phase=<phase> — <原因>`
#              ＋（若设 `SYNO_GATE_DEGRADED_LOG`）追加一行 JSON: time/component/code/phase/retryable
#              日志写失败**不静默**：stderr 追加 `degraded: 写降级日志失败 — <原因>`，仍 exit 2
#   @error   code 仅 10 个（闭包，禁自增第 11 个）:
#              E_MATRIX_SCHEMA / E_MATRIX_ITEM_MISSING / E_MATRIX_ITEM_UNKNOWN /
#              E_STATUS_INVALID / E_N/A_NO_EVIDENCE / E_DEFERRED_NO_ISSUE /
#              E_EVIDENCE_UNRESOLVED / E_ANCHOR_MISMATCH / E_COV_UNJUDGED / E_VERIFY_FAILED
#            exit 2 的环境/用法类统一复用 E_ANCHOR_MISMATCH，靠 phase ∈ {usage,matrix,repo,anchor,git} 区分
#   @authority 只读；任何人可跑（不要求写权限、不要求网络）；**不写仓内文件**
#              （唯一可能写盘 = 环境变量 SYNO_GATE_DEGRADED_LOG 指定的文件）
#   @not-here  不判质量语义 ｜ 不替代 K3 审计 ｜ **不接 CI/pre-commit**（P0 为规格 §3 非目标，
#              本批不新增任何调用点）｜ 不执行矩阵里的 evidence.cmd（安全边界：矩阵来自 PR，
#              执行其中任意命令＝任意代码执行）
#
# 判定顺序（README F5；顺序即语义，先到先判）:
#   ① usage → ② repo 可读 → ③ 矩阵解析 → ④ --anchor 解析 → ⑤ anchor 一致性 →
#   ⑥ 23 行 → ⑦ 状态/字段 → ⑧ evidence 解析 → ⑨ Q-11 武装 → ⑩ 机械 11 项 → ⑪ 汇总
#
# 复用既有约定（禁重复建设）:
#   · 三态退出码 = ctrl-tower-change 模式 1 / scripts/control-tower/AGENTS.md
#   · @降级 ＋ SYNO_GATE_DEGRADED_LOG 字段 = check-gate-integrity.sh 头部（D2）
#   · UTF-8 强制 = D732 / windows-compat 模式 3（`sys.stdout.reconfigure`）
#   · 判别力（改坏必红）= 配对测试 tests/control-tower/check-acceptance-matrix.test.sh 覆盖
#   · 子集 YAML 不用 PyYAML = 同 check-quality-delta.py:93 / claim_store.py 先例
#     （CI runner 无 PyYAML ⇒ import 失败会退化成"读不到声明"的静默路径）
#
# 已知限制（Known Limitations —— 禁把本件读成"已检测/已完成"）:
#   1. **changed_files 是自报的，不与 git 对账**：本器不跑 `git diff --name-only` 校验变更集
#      真伪 ⇒ "漏报文件"检测不到（信任边界，与 check-quality-delta.py 的"只判变更集"同型）。
#   2. **机械项只判存在性/负证据，不判语义**：`assertNever` 出现 ≠ 穷尽性正确；`passed`
#      子串 ≠ 测试真通过；`已知限制` 出现 ≠ 内容切题；`^## ` 小节数 ≥5 ≠ 小节合格。
#   3. **n/a 的负证据命令只记录、不执行**：本器**不跑** evidence.cmd（见 @not-here 的安全边界）
#      ⇒ "期望 0 命中"是**声明**，不是本器验证的结果。
#   4. **P0 不接 CI/pre-commit**：本批不新增任何调用点；"绿"只代表有人手动跑了它。
#   5. **--verify 与 plain 共用同一实现**（承诺 4）⇒ 实现错则两者同错；它抓的是"矩阵声明
#      与机械事实不一致"，**不是**"校验器算错了"。
#   6. **错误码粒度不足**：机械硬违反与声明矛盾同码 E_MATRIX_SCHEMA；exit 2 五类统一
#      E_ANCHOR_MISMATCH 靠 phase 区分 —— 10 码闭包的有意取舍，归因靠 detail/phase。
#   7. **URL 类 evidence 不联网**：只检查"含 anchor 前 7 位 hex"这一字符串条件 ⇒ 不验可达性/
#      状态码；7 位前缀可被伪造或碰撞（有意：P0 不允许校验器发网络请求）。
#   8. **T-8 只对代码目录数小节数**：`^## ` ≥5 是结构计数；AGENTS.md 存在但内容空洞照样绿。
#      记录面（.claude/**、memory/**、docs/**）与域外目录**跳过**并打印 scope 提示 ⇒
#      **跳过≠已验证**（该目录有无域守则，本器不判）。
#   9. **子集 YAML 不支持**多行字符串/块序列/锚点别名/跨行流式/嵌套超两层：超出子集一律
#      E_MATRIX_SCHEMA（有意 fail-closed，不猜）。
#   10. **anchor 内容读取依赖本仓对象库**：anchor 指向未 fetch 的远端对象 ⇒ exit 2（判不了），
#       此时**不是**矩阵写错。
#   11. **文件在 anchor 不存在时按"无内容"处理**（如 deleted 文件）：内容型规则据此判定，
#       detail 里以 `absent=<n>` 显式记录，不静默当空文件。
#   12. **不判 `anchor` 是否已并入主线**：只要求在本仓可解析且内容可读。
# ═══════════════════════════════════════════════════════════════════════════════
from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

# ── D732 UTF-8 强制（windows-compat 模式 3）：控制台/子进程统一 UTF-8 ──────────
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

SCHEMA_ID = "acceptance-matrix/v1"
COMPONENT = "check-acceptance-matrix"

# ── 固定 23 行（顺序即契约，README F1.2）──────────────────────────────────────
ITEM_ORDER: List[str] = [f"Q-{n}" for n in range(1, 16)] + [f"T-{n}" for n in range(1, 9)]

# ── 机械 11 项 vs 语义 12 项（README F4）──────────────────────────────────────
MECH_ITEMS: List[str] = [
    "Q-2", "Q-4", "Q-6", "Q-8", "Q-10", "Q-11", "Q-13",
    "T-1", "T-5", "T-7", "T-8",
]
SEM_ITEMS: List[str] = [item for item in ITEM_ORDER if item not in MECH_ITEMS]

STATUSES: Tuple[str, ...] = ("pass", "n/a", "deferred", "partial")

TOP_REQUIRED: Tuple[str, ...] = (
    "schema", "issue", "batch", "anchor", "changed_files", "items",
)
TOP_OPTIONAL: Tuple[str, ...] = ("coverage_judged", "known_issues")
TOP_ALLOWED = set(TOP_REQUIRED) | set(TOP_OPTIONAL)
ITEM_ALLOWED = {"status", "reason", "variance", "known_issue", "alias_of", "evidence"}
EVIDENCE_ALLOWED = {"cmd", "out"}

SENSITIVE_PATTERNS: Tuple[str, ...] = ("token=", "secret", "apiKey", "Bearer ")
T1_TAGS: Tuple[str, ...] = ("@input", "@output", "@exit", "@degraded")
SECTION_PATTERN = re.compile(r"(?m)^## ")
# ── T-8 作用域（P0.6）：只有代码目录要求域守则；记录面/域外目录跳过并打印 scope 提示 ──
T8_SCOPE_RE = re.compile(
    r"^(src|electron-renderer|extensions|scripts|expert|knowledge|theory|tests)/"
)
T8_RECORD_ONLY_RE = re.compile(r"^(\.claude|memory|docs)/")
ANCHOR_HEX = re.compile(r"^[0-9a-fA-F]{7,40}$")
INT_RE = re.compile(r"^[+-]?\d+$")
KEY_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
TOP_LINE_RE = re.compile(r"^([A-Za-z0-9_.-]+):(.*)$")
ITEM_LINE_RE = re.compile(r"^([A-Za-z0-9_.-]+):(.*)$")

MECH_TOP = "mach"
SEM_TOP = "sem"


# ═════════════════════════════════════════════════════════════════════════════
# B1 Typed error：判据失败/不可判都带 code（禁裸 raise Exception 表达判据失败）
# ═════════════════════════════════════════════════════════════════════════════
class MatrixError(Exception):
    """带 code 的类型化错误（B1）。

    @param code - 10 个冻结错误码之一（README F7）
    @param detail - 人读原因（必须具体：文件/字段/命中数，禁笼统）
    @param phase - exit 2 的归口阶段：usage|matrix|repo|anchor|git（exit 1 时为 schema）
    @param exit_code - 1=真红，2=判不了
    @param retryable - 环境恢复后值得重试？
    """

    def __init__(
        self,
        code: str,
        detail: str,
        *,
        phase: str = "schema",
        exit_code: int = 1,
        retryable: bool = False,
    ) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail
        self.phase = phase
        self.exit_code = exit_code
        self.retryable = retryable


@dataclass
class Issue:
    """一条可归因的缺口（输出为 `ISSUE <code> <item|-> <detail>`）。"""

    code: str
    detail: str
    item: Optional[str] = None


@dataclass
class ItemResult:
    """一项的判定结果（F8 的逐项行 + F10 的 JSON item）。"""

    item: str
    status: str
    verdict: str
    detail: str
    mech: Optional[str] = None
    reason: Optional[str] = None
    evidence: Optional[Dict[str, str]] = None
    issues: List[Issue] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.issues is None:
            self.issues = []


# ═════════════════════════════════════════════════════════════════════════════
# 降级（D2 既有约定）：stderr 一行 + 可选 JSON 一行
# ═════════════════════════════════════════════════════════════════════════════
def _now_iso() -> str:
    """当前本地时刻的 ISO-8601 串（带时区；降级日志 time 字段）。"""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _append_degraded_log(err: MatrixError) -> None:
    """按 D2 契约向 `SYNO_GATE_DEGRADED_LOG` 追加一行 JSON；写失败不静默。"""
    log_path = os.environ.get("SYNO_GATE_DEGRADED_LOG", "").strip()
    if not log_path:
        return
    record = {
        "time": _now_iso(),
        "component": COMPONENT,
        "code": err.code,
        "phase": err.phase,
        "retryable": bool(err.retryable),
    }
    try:
        with open(log_path, "a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as exc:  # fail loud：日志写失败也不静默
        sys.stderr.write(f"degraded: 写降级日志失败 — {exc}\n")


def _emit_unjudged(err: MatrixError, json_mode: bool, ctx: "Context") -> int:
    """exit 2 的输出（README F6）：stderr degraded ＋ stdout UNJUDGED ＋ 末行 MATRIX: UNJUDGED。"""
    sys.stderr.write(f"degraded: {err.code} phase={err.phase} — {err.detail}\n")
    _append_degraded_log(err)
    errors = [Issue(err.code, f"phase={err.phase} {err.detail}")]
    if json_mode:
        _print_json(
            ctx,
            items=[],
            summary=_blank_summary(),
            errors=errors,
        )
    else:
        print(f"UNJUDGED {err.code} phase={err.phase} — {err.detail}")
        print(f"MATRIX: UNJUDGED {err.code}")
    return 2


# ═════════════════════════════════════════════════════════════════════════════
# 子集 YAML 解析（只认 README F1.4 的子集；超出 ⇒ E_MATRIX_SCHEMA，fail loud 不猜）
# ═════════════════════════════════════════════════════════════════════════════
def _schema_error(detail: str) -> MatrixError:
    """矩阵结构/字段错误（exit 1）。"""
    return MatrixError("E_MATRIX_SCHEMA", detail, phase="schema", exit_code=1)


def _split_top_level(text: str, where: str) -> List[str]:
    """按顶层 `,` 切分（尊重双引号与 `{}`/`[]` 深度）；引号或括号不闭合 ⇒ 结构错。"""
    parts: List[str] = []
    buf: List[str] = []
    depth = 0
    in_quote = False
    escaped = False
    for ch in text:
        if in_quote:
            buf.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_quote = False
            continue
        if ch == '"':
            in_quote = True
            buf.append(ch)
            continue
        if ch in "{[":
            depth += 1
            buf.append(ch)
            continue
        if ch in "}]":
            depth -= 1
            if depth < 0:
                raise _schema_error(f"{where}: 括号不配平（多余的 `{ch}`）")
            buf.append(ch)
            continue
        if ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    if in_quote:
        raise _schema_error(f"{where}: 双引号未闭合")
    if depth != 0:
        raise _schema_error(f"{where}: 括号不配平")
    parts.append("".join(buf))
    return parts


def _parse_quoted(text: str, where: str) -> str:
    """解析整段双引号字符串（只支持 `\\"` 与 `\\\\` 两个转义）。"""
    if len(text) < 2 or not text.endswith('"'):
        raise _schema_error(f"{where}: 双引号字符串未闭合")
    body = text[1:-1]
    out: List[str] = []
    index = 0
    while index < len(body):
        ch = body[index]
        if ch == "\\":
            if index + 1 >= len(body):
                raise _schema_error(f"{where}: 转义符悬空")
            nxt = body[index + 1]
            if nxt not in ('"', "\\"):
                raise _schema_error(
                    f"{where}: 不支持的转义 `\\{nxt}`（子集只允许 \\\" 与 \\\\，fail loud 不猜）"
                )
            out.append(nxt)
            index += 2
            continue
        if ch == '"':
            raise _schema_error(f"{where}: 双引号字符串内出现未转义的 `\"`")
        out.append(ch)
        index += 1
    return "".join(out)


def _parse_scalar(text: str, where: str, *, depth: int) -> Any:
    """解析一个标量/内联列表/内联映射；`depth` = 已嵌套的映射层数。"""
    raw = text.strip()
    if raw == "":
        raise _schema_error(f"{where}: 值为空")
    if raw.startswith('"'):
        return _parse_quoted(raw, where)
    if raw.startswith("["):
        if not raw.endswith("]"):
            raise _schema_error(f"{where}: 内联列表未闭合")
        inner = raw[1:-1].strip()
        if inner == "":
            return []
        values: List[Any] = []
        for piece in _split_top_level(inner, where):
            item_where = f"{where}[{len(values)}]"
            if piece.strip().startswith("{") or piece.strip().startswith("["):
                raise _schema_error(f"{where}: 内联列表元素只能是标量")
            values.append(_parse_scalar(piece, item_where, depth=depth))
        return values
    if raw.startswith("{"):
        if not raw.endswith("}"):
            raise _schema_error(f"{where}: 内联映射未闭合")
        if depth >= 2:
            raise _schema_error(f"{where}: 内联映射最多两层（README F1.4）")
        inner = raw[1:-1].strip()
        mapping: Dict[str, Any] = {}
        if inner == "":
            return mapping
        for piece in _split_top_level(inner, where):
            key, sep, rest = piece.partition(":")
            if not sep:
                raise _schema_error(f"{where}: 内联映射项缺 `:`（{piece.strip()[:40]}）")
            key_name = key.strip()
            if not KEY_RE.match(key_name):
                raise _schema_error(f"{where}: 非法键名 `{key_name}`")
            if key_name in mapping:
                raise _schema_error(f"{where}: 重复键 `{key_name}`")
            mapping[key_name] = _parse_scalar(rest, f"{where}.{key_name}", depth=depth + 1)
        return mapping
    if raw[0] in "|>":
        raise _schema_error(f"{where}: 不支持块标量（`{raw[0]}`；READMe F1.4 子集外）")
    if raw[0] in ",{}[]":
        raise _schema_error(f"{where}: 标量以保留字符开头，必须加双引号")
    for ch in (',', '"', "{", "}", "[", "]"):
        if ch in raw:
            raise _schema_error(
                f"{where}: 不加引号的标量不得含 `{ch}`（含特殊字符请用双引号包裹）"
            )
    if INT_RE.match(raw):
        return int(raw)
    if raw == "true":
        return True
    if raw == "false":
        return False
    return raw


@dataclass
class Matrix:
    """解析后的矩阵（字段已过 F1 结构校验）。"""

    schema: str
    issue: int
    batch: str
    anchor_raw: str
    changed_files: List[str]
    coverage_judged: Optional[bool]
    known_issues: List[int]
    items: Dict[str, Dict[str, Any]]
    source_order: List[str]


def parse_matrix(text: str) -> Dict[str, Any]:
    """把矩阵文本解析成"顶层键 → 值"的原始字典（结构错误 ⇒ E_MATRIX_SCHEMA，exit 1）。

    @param text - 矩阵文件全文（UTF-8 已解码）
    @returns 顶层键的值字典（items 为 {id: item_map}，保持源文件顺序）
    """
    raw: Dict[str, Any] = {}
    order: List[str] = []
    in_items = False
    lines = text.splitlines()
    for line_number, line in enumerate(lines, start=1):
        if line_number == 1 and line.startswith("\ufeff"):
            line = line[1:]
        if line.endswith("\r"):
            line = line[:-1]
        if line.strip() == "":
            continue
        if line.lstrip().startswith("#"):
            continue
        if line[0] in " \t":
            if not in_items:
                raise _schema_error(f"第 {line_number} 行：缩进块但当前不在 `items:` 下")
            if line.startswith("\t"):
                raise _schema_error(f"第 {line_number} 行：不支持制表符缩进")
            stripped = line[2:]
            if stripped.startswith(" ") or stripped.startswith("\t"):
                raise _schema_error(
                    f"第 {line_number} 行：items 的项必须恰好 2 个空格缩进"
                )
            match = ITEM_LINE_RE.match(stripped)
            if not match:
                raise _schema_error(
                    f"第 {line_number} 行：items 行格式非法（应为 `  <ID>: {{...}}`）"
                )
            item_id = match.group(1)
            if not KEY_RE.match(item_id):
                raise _schema_error(f"第 {line_number} 行：非法 item id `{item_id}`")
            if item_id in raw["items"]:
                raise _schema_error(f"{item_id}: 重复行（同一 id 只能出现一次）")
            raw["items"][item_id] = _parse_scalar(
                match.group(2), f"items.{item_id} 第 {line_number} 行", depth=0
            )
            continue
        # 列 0：顶层键
        match = TOP_LINE_RE.match(line)
        if not match:
            raise _schema_error(f"第 {line_number} 行：不是 `key: value` 形式")
        key = match.group(1)
        rest = match.group(2)
        if key not in TOP_ALLOWED:
            raise _schema_error(f"第 {line_number} 行：未知顶层键 `{key}`（防 typo 静默丢字段）")
        if key in raw:
            raise _schema_error(f"第 {line_number} 行：重复顶层键 `{key}`")
        order.append(key)
        if key == "items":
            if rest.strip() != "":
                raise _schema_error(
                    f"第 {line_number} 行：`items` 必须是块映射（换行 + 2 空格缩进一行一项），"
                    "inline 形式即使语法合法也不接受"
                )
            raw["items"] = {}
            in_items = True
            continue
        in_items = False
        raw[key] = _parse_scalar(rest, f"第 {line_number} 行 `{key}`", depth=0)
    raw["__order__"] = order
    return raw


def build_matrix(raw: Dict[str, Any]) -> Matrix:
    """把原始字典校验成 `Matrix`（F1；结构与字段错误 ⇒ exit 1）。"""
    # schema / issue / batch
    if "schema" not in raw:
        raise _schema_error("缺 `schema`")
    if raw["schema"] != SCHEMA_ID:
        raise _schema_error(f"`schema` 必须等于 `{SCHEMA_ID}`，实为 `{raw['schema']}`")
    if "issue" not in raw:
        raise _schema_error("缺 `issue`")
    if not isinstance(raw["issue"], int) or isinstance(raw["issue"], bool):
        raise _schema_error(f"`issue` 必须是整数，实为 `{raw['issue']!r}`")
    if "batch" not in raw:
        raise _schema_error("缺 `batch`")
    if not isinstance(raw["batch"], str) or not raw["batch"].strip():
        raise _schema_error("`batch` 必须是非空字符串")
    # anchor：缺/非串 ⇒ 结构错（§6）；格式非法 ⇒ exit 2（F6，phase=anchor）
    if "anchor" not in raw:
        raise _schema_error("缺 `anchor`")
    anchor_raw = raw["anchor"]
    if not isinstance(anchor_raw, str) or not anchor_raw.strip():
        raise _schema_error("`anchor` 必须是非空字符串")
    anchor_raw = anchor_raw.strip()
    if not ANCHOR_HEX.match(anchor_raw):
        raise MatrixError(
            "E_ANCHOR_MISMATCH",
            f"矩阵 anchor 格式非法（要求 7-40 位 hex）：`{anchor_raw}`",
            phase="anchor",
            exit_code=2,
            retryable=True,
        )
    # changed_files
    if "changed_files" not in raw:
        raise _schema_error("缺 `changed_files`")
    changed = raw["changed_files"]
    if not isinstance(changed, list):
        raise _schema_error("`changed_files` 必须是内联列表")
    seen = set()
    changed_files: List[str] = []
    for path in changed:
        if not isinstance(path, str) or not path.strip():
            raise _schema_error(f"`changed_files` 元素必须是非空字符串，实为 `{path!r}`")
        normalized = path.strip().replace("\\", "/")
        if normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized):
            raise _schema_error(f"`changed_files` 不接受绝对路径：`{normalized}`")
        if ".." in normalized.split("/"):
            raise _schema_error(f"`changed_files` 不接受含 `..` 的路径：`{normalized}`")
        if normalized not in seen:
            seen.add(normalized)
            changed_files.append(normalized)
    # coverage_judged
    coverage_judged: Optional[bool] = None
    if "coverage_judged" in raw:
        value = raw["coverage_judged"]
        if not isinstance(value, bool):
            raise _schema_error(f"`coverage_judged` 必须是布尔，实为 `{value!r}`")
        coverage_judged = value
    # known_issues
    known_issues: List[int] = []
    if "known_issues" in raw:
        value = raw["known_issues"]
        if not isinstance(value, list):
            raise _schema_error("`known_issues` 必须是内联列表")
        for entry in value:
            if not isinstance(entry, int) or isinstance(entry, bool) or entry <= 0:
                raise _schema_error(f"`known_issues` 元素必须是正整数，实为 `{entry!r}`")
            known_issues.append(entry)
    # items
    if "items" not in raw:
        raise MatrixError(
            "E_MATRIX_ITEM_MISSING",
            f"缺 `items`（应含固定 23 行：{' '.join(ITEM_ORDER)}）",
            phase="schema",
            exit_code=1,
        )
    if not isinstance(raw["items"], dict):
        raise _schema_error("`items` 必须是块映射")
    return Matrix(
        schema=raw["schema"],
        issue=raw["issue"],
        batch=raw["batch"],
        anchor_raw=anchor_raw,
        changed_files=changed_files,
        coverage_judged=coverage_judged,
        known_issues=known_issues,
        items=raw["items"],
        source_order=list(raw["items"].keys()),
    )


# ═════════════════════════════════════════════════════════════════════════════
# git 只读访问（anchor 内容 / 对象类型）
# ═════════════════════════════════════════════════════════════════════════════
def _git(repo: str, argv: List[str]) -> Tuple[int, bytes, bytes]:
    """跑只读 git 命令；git 不可用 ⇒ MatrixError(phase=git, exit 2)。

    @param repo - 仓路径（`git -C`）
    @param argv - 子命令参数（不含 `git -C`）
    @returns (returncode, stdout bytes, stderr bytes)
    """
    command = ["git", "-C", repo] + argv
    try:
        completed = subprocess.run(command, capture_output=True, check=False)
    except (OSError, ValueError) as exc:
        raise MatrixError(
            "E_ANCHOR_MISMATCH",
            f"无法执行 git（{exc}）",
            phase="git",
            exit_code=2,
            retryable=True,
        ) from exc
    return completed.returncode, completed.stdout, completed.stderr


class AnchorView:
    """anchor 视图：按路径读内容/判类型（带缓存，只读）。"""

    def __init__(self, repo: str, anchor: str) -> None:
        self.repo = repo
        self.anchor = anchor
        self._kind_cache: Dict[str, Optional[str]] = {}
        self._content_cache: Dict[str, Optional[str]] = {}

    def kind(self, path: str) -> Optional[str]:
        """返回 `blob`/`tree`/None（None = anchor 下不可解析）。"""
        if path in self._kind_cache:
            return self._kind_cache[path]
        code, out, _err = _git(self.repo, ["cat-file", "-t", f"{self.anchor}:{path}"])
        value = out.decode("utf-8", "replace").strip() if code == 0 else None
        self._kind_cache[path] = value
        return value

    def read(self, path: str) -> Optional[str]:
        """返回 anchor 下该文件内容（None = 不可解析，调用方按"无内容"处理并记 absent）。"""
        if path in self._content_cache:
            return self._content_cache[path]
        code, out, _err = _git(self.repo, ["cat-file", "-p", f"{self.anchor}:{path}"])
        value = out.decode("utf-8", "replace") if code == 0 else None
        self._content_cache[path] = value
        return value


# ═════════════════════════════════════════════════════════════════════════════
# F11 谓词（纯路径字符串判定，不看工作树）
# ═════════════════════════════════════════════════════════════════════════════
def is_src_ts(path: str) -> bool:
    """`^src/.*\\.ts$`。"""
    return re.match(r"^src/.*\.ts$", path) is not None


def is_ui(path: str) -> bool:
    """UI/渲染产物：前缀三选一 ∪ 扩展名 ∈ {.tsx,.jsx,.vue,.html,.css}。"""
    if re.match(r"^(electron-renderer/|src/tui/|apps/web/)", path):
        return True
    return posixpath.splitext(path)[1].lower() in {".tsx", ".jsx", ".vue", ".html", ".css"}


def is_test(path: str) -> bool:
    """测试件：`^tests/` ∪ 文件名含 `.test.`/`.spec.`。"""
    if path.startswith("tests/"):
        return True
    base = posixpath.basename(path)
    return ".test." in base or ".spec." in base


def is_version_contract(path: str) -> bool:
    """版本/契约路径（大小写不敏感）：含 version/package.json/contract/schema。"""
    lowered = path.lower()
    return any(token in lowered for token in ("version", "package.json", "contract", "schema"))


def is_longlived_doc(path: str) -> bool:
    """长期件：`^(docs|memory)/.*\\.md$` ∪ basename ∈ {AGENTS.md,README.md}。"""
    if re.match(r"^(docs|memory)/.*\.md$", path):
        return True
    return posixpath.basename(path) in {"AGENTS.md", "README.md"}


# ═════════════════════════════════════════════════════════════════════════════
# F2/F1.3 字段校验
# ═════════════════════════════════════════════════════════════════════════════
def _text(value: Any) -> str:
    """把可选字段压成单行字符串（None → ""；换行压空格）。"""
    if value is None:
        return ""
    return str(value).replace("\r", " ").replace("\n", " ").strip()


def evidence_of(item: Dict[str, Any]) -> Dict[str, str]:
    """取 item.evidence（缺/非映射 → 空映射；结构错误已在字段校验拦下）。"""
    value = item.get("evidence")
    return value if isinstance(value, dict) else {}


def check_item_fields(matrix: Matrix) -> List[Issue]:
    """F1.3 + F2：逐项字段与状态合法性；返回全部缺口（不早退）。"""
    issues: List[Issue] = []
    for item_id in ITEM_ORDER:
        if item_id not in matrix.items:
            continue
        item = matrix.items[item_id]
        where = item_id
        if not isinstance(item, dict):
            issues.append(Issue("E_MATRIX_SCHEMA", f"{where}: item 必须是 inline map", where))
            continue
        unknown = sorted(set(item.keys()) - ITEM_ALLOWED)
        if unknown:
            issues.append(
                Issue(
                    "E_MATRIX_SCHEMA",
                    f"{where}: 未知字段 {unknown}（防 typo 静默丢字段）",
                    where,
                )
            )
        status = item.get("status")
        if not isinstance(status, str) or status not in STATUSES:
            issues.append(
                Issue(
                    "E_STATUS_INVALID",
                    f"{where}: status 必须是 {'/'.join(STATUSES)} 之一，实为 `{status!r}`",
                    where,
                )
            )
            continue
        reason = item.get("reason")
        if reason is not None and not isinstance(reason, str):
            issues.append(Issue("E_MATRIX_SCHEMA", f"{where}: reason 必须是字符串", where))
        if "variance" in item and not isinstance(item["variance"], bool):
            issues.append(Issue("E_MATRIX_SCHEMA", f"{where}: variance 必须是布尔", where))
        known_issue = item.get("known_issue")
        if known_issue is not None and (
            not isinstance(known_issue, int) or isinstance(known_issue, bool)
        ):
            issues.append(Issue("E_MATRIX_SCHEMA", f"{where}: known_issue 必须是整数", where))
        alias_of = item.get("alias_of")
        if "alias_of" in item:
            if item_id != "Q-13":
                issues.append(
                    Issue(
                        "E_MATRIX_SCHEMA",
                        f"{where}: alias_of 只允许出现在 Q-13",
                        where,
                    )
                )
            elif alias_of != "Q-2":
                issues.append(
                    Issue(
                        "E_MATRIX_SCHEMA",
                        f"{where}: Q-13 的 alias_of 必须是 \"Q-2\"，实为 `{alias_of!r}`",
                        where,
                    )
                )
        evidence = item.get("evidence")
        if evidence is not None:
            if not isinstance(evidence, dict):
                issues.append(
                    Issue("E_MATRIX_SCHEMA", f"{where}: evidence 必须是 inline map", where)
                )
                evidence = {}
            else:
                unknown_ev = sorted(set(evidence.keys()) - EVIDENCE_ALLOWED)
                if unknown_ev:
                    issues.append(
                        Issue(
                            "E_MATRIX_SCHEMA",
                            f"{where}: evidence 未知键 {unknown_ev}（只允许 cmd/out）",
                            where,
                        )
                    )
                for key, value in evidence.items():
                    if key in EVIDENCE_ALLOWED and not isinstance(value, str):
                        issues.append(
                            Issue(
                                "E_MATRIX_SCHEMA",
                                f"{where}: evidence.{key} 必须是字符串",
                                where,
                            )
                        )
        cmd = _text(evidence.get("cmd")) if isinstance(evidence, dict) else ""
        out = _text(evidence.get("out")) if isinstance(evidence, dict) else ""
        reason_text = _text(reason)
        # F2：按 status 校验必填字段
        if status == "pass":
            if not cmd or not out:
                issues.append(
                    Issue(
                        "E_MATRIX_SCHEMA",
                        f"{where}: status=pass 要求 evidence.cmd 与 evidence.out 均非空",
                        where,
                    )
                )
        elif status == "partial":
            if not cmd or not out:
                issues.append(
                    Issue(
                        "E_MATRIX_SCHEMA",
                        f"{where}: status=partial 要求 evidence.cmd 与 evidence.out 均非空",
                        where,
                    )
                )
            if not reason_text:
                issues.append(
                    Issue("E_MATRIX_SCHEMA", f"{where}: status=partial 要求 reason 非空", where)
                )
        elif status == "n/a":
            if not reason_text:
                issues.append(
                    Issue("E_MATRIX_SCHEMA", f"{where}: status=n/a 要求 reason 非空", where)
                )
            if not cmd:
                issues.append(
                    Issue(
                        "E_N/A_NO_EVIDENCE",
                        f"{where}: status=n/a 要求 evidence.cmd（负证据，期望 0 命中）",
                        where,
                    )
                )
        elif status == "deferred":
            if not reason_text:
                issues.append(
                    Issue(
                        "E_MATRIX_SCHEMA", f"{where}: status=deferred 要求 reason 非空", where
                    )
                )
            if not isinstance(known_issue, int) or isinstance(known_issue, bool) or known_issue <= 0:
                issues.append(
                    Issue(
                        "E_DEFERRED_NO_ISSUE",
                        f"{where}: status=deferred 要求 known_issue 为正整数（0/负视为缺）",
                        where,
                    )
                )
    return issues


# ═════════════════════════════════════════════════════════════════════════════
# F3 evidence.out 可核性
# ═════════════════════════════════════════════════════════════════════════════
def normalize_repo_path(raw: str) -> Optional[str]:
    """把 evidence.out 归一成仓相对路径；绝对路径/盘符/`..` ⇒ None（不可核）。"""
    value = raw.strip().replace("\\", "/")
    while value.startswith("./"):
        value = value[2:]
    if value == "" or value.startswith("/") or re.match(r"^[A-Za-z]:", value):
        return None
    if ".." in value.split("/"):
        return None
    return value


def check_evidence(matrix: Matrix, view: AnchorView) -> List[Issue]:
    """F3：`out` 一旦出现即必须可核（http(s) 含 anchor 前 7 位；否则仓内 blob）。"""
    issues: List[Issue] = []
    anchor_prefix = view.anchor[:7].lower()
    for item_id in ITEM_ORDER:
        item = matrix.items.get(item_id)
        if not isinstance(item, dict):
            continue
        out = _text(evidence_of(item).get("out"))
        if not out:
            continue
        lowered = out.lower()
        if lowered.startswith("http://") or lowered.startswith("https://"):
            if anchor_prefix not in lowered:
                issues.append(
                    Issue(
                        "E_EVIDENCE_UNRESOLVED",
                        f"{item_id}: URL 证据不含 anchor 前 7 位（{view.anchor[:7]}），视为不可核：{out}",
                        item_id,
                    )
                )
            continue
        path = normalize_repo_path(out)
        if path is None:
            issues.append(
                Issue(
                    "E_EVIDENCE_UNRESOLVED",
                    f"{item_id}: evidence.out 不是合法仓内路径：`{out}`",
                    item_id,
                )
            )
            continue
        kind = view.kind(path)
        if kind != "blob":
            issues.append(
                Issue(
                    "E_EVIDENCE_UNRESOLVED",
                    f"{item_id}: evidence.out 在 anchor 下不可解析或不是文件（kind={kind}）：{path}",
                    item_id,
                )
            )
    return issues


# ═════════════════════════════════════════════════════════════════════════════
# F12 机械 11 项（只判存在性/负证据）
# ═════════════════════════════════════════════════════════════════════════════
class OrderedSet:
    """保序去重（changed_files 的重复项不重复计数）。"""

    @staticmethod
    def unique(paths: List[str]) -> List[str]:
        """按首次出现顺序去重。"""
        seen = set()
        result: List[str] = []
        for path in paths:
            if path not in seen:
                seen.add(path)
                result.append(path)
        return result


def _content(view: AnchorView, path: str) -> Tuple[str, bool]:
    """返回 (内容, 是否在 anchor 存在)；不存在按空内容处理（detail 里记 absent）。"""
    value = view.read(path)
    if value is None:
        return "", False
    return value, True


def _mk(
    item_id: str,
    declared: str,
    verdict: str,
    detail: str,
    reasons: Optional[List[str]] = None,
) -> ItemResult:
    """构造一个机械项结果；`reasons` 非空 ⇒ 该项为 fail/矛盾。"""
    result = ItemResult(
        item=item_id,
        status=declared,
        verdict=verdict,
        detail=detail,
        mech=verdict,
    )
    for reason in reasons or []:
        result.issues.append(Issue("E_MATRIX_SCHEMA", reason, item_id))
    return result


def _expect(
    item_id: str,
    declared: str,
    verdict: str,
    detail: str,
    allowed: Tuple[str, ...],
) -> ItemResult:
    """通用一致性：声明必须落在 `allowed`，否则记 E_MATRIX_SCHEMA 矛盾。"""
    reasons: List[str] = []
    if declared not in allowed:
        reasons.append(
            f"{item_id}: 声明 status={declared} 与机械事实 verdict={verdict} 不一致"
            f"（允许 {list(allowed)}）"
        )
    return _mk(item_id, declared, verdict, detail, reasons)


def rule_q2_13(
    item_id: str, declared: str, matrix: Matrix, view: AnchorView
) -> ItemResult:
    """Q-2/Q-13：UI 文件内容不得含敏感模式（4 个字面量）。"""
    files = [path for path in matrix.changed_files if is_ui(path)]
    hits: List[Tuple[str, str]] = []
    absent = 0
    for path in files:
        content, present = _content(view, path)
        if not present:
            absent += 1
        for pattern in SENSITIVE_PATTERNS:
            if content.count(pattern):
                hits.append((path, pattern))
    detail = f"ui_files={len(files)} hits={len(hits)}"
    if absent:
        detail += f" absent={absent}"
    if not files:
        return _expect(item_id, declared, "na_ok", detail, ("n/a",))
    if hits:
        detail += f" first={hits[0][0]}:{hits[0][1]}"
        return _mk(
            item_id,
            declared,
            "fail",
            detail,
            [f"{item_id}: UI 文件命中敏感模式（{hits[0][0]} 含 `{hits[0][1]}`）"],
        )
    return _expect(item_id, declared, "ok", detail, ("pass",))


def rule_q4(declared: str, matrix: Matrix, view: AnchorView) -> ItemResult:
    """Q-4：任一 `src/**.ts` 含 assertNever ⇒ ok；否则 na_ok（README 的"任一"口径）。"""
    files = [path for path in matrix.changed_files if is_src_ts(path)]
    hits = 0
    absent = 0
    for path in files:
        content, present = _content(view, path)
        if not present:
            absent += 1
        if "assertNever" in content:
            hits += 1
    detail = f"src_files={len(files)} hits={hits}"
    if absent:
        detail += f" absent={absent}"
    verdict = "ok" if hits else "na_ok"
    return _expect("Q-4", declared, verdict, detail, ("pass",) if hits else ("n/a",))


def rule_q6(declared: str, matrix: Matrix, view: AnchorView) -> ItemResult:
    """Q-6：测试/UI 件内 `Date.now()` 合计命中 0 ⇒ ok；>0 ⇒ fail。"""
    files = OrderedSet.unique(
        [path for path in matrix.changed_files if is_test(path) or is_ui(path)]
    )
    hits = 0
    absent = 0
    for path in files:
        content, present = _content(view, path)
        if not present:
            absent += 1
        hits += content.count("Date.now()")
    detail = f"files={len(files)} hits={hits}"
    if absent:
        detail += f" absent={absent}"
    if not files:
        return _expect("Q-6", declared, "na_ok", detail, ("n/a",))
    if hits:
        return _mk(
            "Q-6",
            declared,
            "fail",
            detail,
            [f"Q-6: 测试/UI 件直取 Date.now()（hits={hits}，应用注入 now）"],
        )
    return _expect("Q-6", declared, "ok", detail, ("pass",))


def rule_q8(declared: str, matrix: Matrix, view: AnchorView) -> ItemResult:
    """Q-8：版本/契约路径任一含 VERSION ⇒ ok；有该域路径但全不含 ⇒ fail。"""
    files = [path for path in matrix.changed_files if is_version_contract(path)]
    hits = 0
    absent = 0
    for path in files:
        content, present = _content(view, path)
        if not present:
            absent += 1
        if "VERSION" in content:
            hits += 1
    detail = f"vc_files={len(files)} hits={hits}"
    if absent:
        detail += f" absent={absent}"
    if not files:
        return _expect("Q-8", declared, "na_ok", detail, ("n/a",))
    if not hits:
        return _mk(
            "Q-8",
            declared,
            "fail",
            detail,
            [f"Q-8: 版本/契约路径不含 VERSION 常量（vc_files={len(files)}）"],
        )
    return _expect("Q-8", declared, "ok", detail, ("pass",))


def rule_q10(declared: str, matrix: Matrix) -> ItemResult:
    """Q-10：变更集含 `*.expected.*`/`*.snapshot.*` ⇒ ok；否则 na_ok（允许 partial+reason）。"""
    files = [
        path
        for path in matrix.changed_files
        if re.search(r"\.expected\.", path) or re.search(r"\.snapshot\.", path)
    ]
    detail = f"files={len(files)} hits={len(files)}"
    if not files:
        return _expect("Q-10", declared, "na_ok", detail, ("n/a", "partial"))
    return _expect("Q-10", declared, "ok", detail, ("pass",))


def rule_q11(declared: str, matrix: Matrix, item: Dict[str, Any]) -> ItemResult:
    """Q-11：变更集含 `src/**.ts` ⇒ 必须已武装覆盖率判定，否则 E_COV_UNJUDGED。"""
    src = [path for path in matrix.changed_files if is_src_ts(path)]
    detail = f"src_files={len(src)}"
    if not src:
        detail += " armed=n/a"
        return _expect("Q-11", declared, "na_ok", detail, ("n/a",))
    known_issue = item.get("known_issue")
    armed = (
        matrix.coverage_judged is True
        or bool(matrix.known_issues)
        or (isinstance(known_issue, int) and not isinstance(known_issue, bool) and known_issue > 0)
    )
    detail += f" armed={'yes' if armed else 'no'}"
    if not armed:
        result = _mk(
            "Q-11",
            declared,
            "fail",
            detail,
            [
                "Q-11: 变更集含 src/**.ts 但覆盖率未判"
                "（需 coverage_judged: true 或 known_issues 非空 或该项 known_issue）"
            ],
        )
        # Q-11 的专属码：武装门自身在 plain/verify 两模式都归 E_COV_UNJUDGED
        for issue in result.issues:
            issue.code = "E_COV_UNJUDGED"
        return result
    if declared == "partial":
        return _mk("Q-11", declared, "ok", detail)
    return _expect("Q-11", declared, "ok", detail, ("pass", "partial"))


def rule_t1(declared: str, item: Dict[str, Any], matrix: Matrix, view: AnchorView) -> ItemResult:
    """T-1：每个 `src/**.ts` 都含 @input/@output/@exit/@degraded；否则必须 partial+variance。"""
    files = OrderedSet.unique([path for path in matrix.changed_files if is_src_ts(path)])
    missing: List[str] = []
    absent = 0
    for path in files:
        content, present = _content(view, path)
        if not present:
            absent += 1
        lacks = [tag for tag in T1_TAGS if tag not in content]
        if lacks:
            missing.append(f"{path}({'/'.join(lacks)})")
    detail = f"src_files={len(files)} miss={len(missing)}"
    if absent:
        detail += f" absent={absent}"
    if not files:
        return _expect("T-1", declared, "na_ok", detail, ("n/a",))
    variance = item.get("variance")
    reason = _text(item.get("reason"))
    if not missing:
        return _expect("T-1", declared, "ok", detail, ("pass",))
    detail += f" first={missing[0]}"
    if declared == "partial" and variance is True and reason:
        return _mk("T-1", declared, "ok", detail)
    return _mk(
        "T-1",
        declared,
        "fail",
        detail,
        [
            "T-1: 源文件缺头部契约标签，声明必须是 partial + variance: true + reason"
            f"（首个：{missing[0]}）"
        ],
    )


def rule_t5(declared: str, item: Dict[str, Any], matrix: Matrix, view: AnchorView) -> ItemResult:
    """T-5：UI/长期件含 `已知限制`/`Known Limitations`；否则必须 partial+reason。"""
    files = OrderedSet.unique(
        [path for path in matrix.changed_files if is_ui(path) or is_longlived_doc(path)]
    )
    missing: List[str] = []
    absent = 0
    for path in files:
        content, present = _content(view, path)
        if not present:
            absent += 1
        if "已知限制" not in content and "Known Limitations" not in content:
            missing.append(path)
    detail = f"files={len(files)} miss={len(missing)}"
    if absent:
        detail += f" absent={absent}"
    if not files:
        return _expect("T-5", declared, "na_ok", detail, ("n/a",))
    if not missing:
        return _expect("T-5", declared, "ok", detail, ("pass",))
    detail += f" first={missing[0]}"
    reason = _text(item.get("reason"))
    if declared == "partial" and reason:
        return _mk("T-5", declared, "ok", detail)
    return _mk(
        "T-5",
        declared,
        "fail",
        detail,
        [f"T-5: 文件缺「已知限制」节，声明必须是 partial + reason（首个：{missing[0]}）"],
    )


def rule_t7(
    declared: str, item: Dict[str, Any], matrix: Matrix, view: AnchorView
) -> ItemResult:
    """T-7：变更集含测试件，或 evidence.out 串/其 anchor 内容含 `passed`；否则 partial/deferred。"""
    test_files = OrderedSet.unique([path for path in matrix.changed_files if is_test(path)])
    out = _text(evidence_of(item).get("out"))
    passed = False
    passed_source = "none"
    if out:
        if "passed" in out:
            passed = True
            passed_source = "out-string"
        else:
            lowered = out.lower()
            if not (lowered.startswith("http://") or lowered.startswith("https://")):
                path = normalize_repo_path(out)
                if path is not None and view.kind(path) == "blob":
                    content, _present = _content(view, path)
                    if "passed" in content:
                        passed = True
                        passed_source = "out-content"
    detail = f"test_files={len(test_files)} passed={'yes' if passed else 'no'}"
    if not test_files and passed:
        detail += f" src={passed_source}"
    if test_files or passed:
        return _expect("T-7", declared, "ok", detail, ("pass",))
    if declared in ("partial", "deferred"):
        return _mk("T-7", declared, "ok", detail)
    return _mk(
        "T-7",
        declared,
        "fail",
        detail,
        ["T-7: 无 committed 测试入变更集且无 `passed` 证据，声明必须是 partial 或 deferred"],
    )


def rule_t8(declared: str, matrix: Matrix, view: AnchorView) -> ItemResult:
    """T-8：同一父目录下 ≥2 变更文件 ⇒ **代码目录**的 AGENTS.md 存在且 `^## ` 小节 ≥5。

    作用域（P0.6）：只有父目录命中 `T8_SCOPE_RE` 的候选进判定；命中 `T8_RECORD_ONLY_RE`
    的记录面与其它域外目录一律跳过 —— 每个恰一行 scope 提示写到 stderr，不改变 stdout
    行数契约。**跳过 ≠ 已验证**：被跳过目录有无域守则，本器不判。
    """
    counts: Dict[str, int] = {}
    for path in matrix.changed_files:
        parent = posixpath.dirname(path)
        counts[parent] = counts.get(parent, 0) + 1
    candidates = sorted([parent for parent, count in counts.items() if count >= 2])
    in_scope: List[str] = []
    skipped = 0
    for parent in candidates:
        if T8_SCOPE_RE.match(parent):
            in_scope.append(parent)
            continue
        skipped += 1
        kind = "record-only" if T8_RECORD_ONLY_RE.match(parent) else "out-of-scope"
        sys.stderr.write(f"T-8 scope: skip {kind} dir {parent or '.'}\n")
    bad: List[str] = []
    for parent in in_scope:
        agents_path = f"{parent}/AGENTS.md" if parent else "AGENTS.md"
        if view.kind(agents_path) != "blob":
            bad.append(f"{agents_path}(missing)")
            continue
        content, _present = _content(view, agents_path)
        sections = len(SECTION_PATTERN.findall(content))
        if sections < 5:
            bad.append(f"{agents_path}(sections={sections})")
    detail = f"dirs={len(in_scope)} bad={len(bad)} skipped={skipped}"
    if bad:
        detail += f" first={bad[0]}"
    if not in_scope:
        return _expect("T-8", declared, "na_ok", detail, ("n/a",))
    if bad:
        return _mk(
            "T-8",
            declared,
            "fail",
            detail,
            [f"T-8: 代码目录的 AGENTS.md 缺失或 `^## ` 小节 <5（首个：{bad[0]}）"],
        )
    return _expect("T-8", declared, "ok", detail, ("pass",))


def evaluate_mechanical(matrix: Matrix, view: AnchorView) -> List[ItemResult]:
    """跑机械 11 项（返回固定顺序的结果列表；--verify 与 plain 共用本函数）。"""
    results: List[ItemResult] = []
    for item_id in MECH_ITEMS:
        item = matrix.items.get(item_id, {})
        declared = item.get("status") if isinstance(item, dict) else None
        declared = declared if isinstance(declared, str) else "(invalid)"
        if item_id in ("Q-2", "Q-13"):
            results.append(rule_q2_13(item_id, declared, matrix, view))
        elif item_id == "Q-4":
            results.append(rule_q4(declared, matrix, view))
        elif item_id == "Q-6":
            results.append(rule_q6(declared, matrix, view))
        elif item_id == "Q-8":
            results.append(rule_q8(declared, matrix, view))
        elif item_id == "Q-10":
            results.append(rule_q10(declared, matrix))
        elif item_id == "Q-11":
            results.append(rule_q11(declared, matrix, item))
        elif item_id == "T-1":
            results.append(rule_t1(declared, item, matrix, view))
        elif item_id == "T-5":
            results.append(rule_t5(declared, item, matrix, view))
        elif item_id == "T-7":
            results.append(rule_t7(declared, item, matrix, view))
        elif item_id == "T-8":
            results.append(rule_t8(declared, matrix, view))
    return results


def semantic_results(matrix: Matrix) -> List[ItemResult]:
    """语义 12 项：字段合法即 attested（不判语义好坏）。"""
    results: List[ItemResult] = []
    for item_id in SEM_ITEMS:
        item = matrix.items.get(item_id, {})
        reason = _text(item.get("reason")) if isinstance(item, dict) else ""
        results.append(
            ItemResult(
                item=item_id,
                status=item.get("status", "(invalid)") if isinstance(item, dict) else "(invalid)",
                verdict="attested",
                detail=reason or "slot",
                mech=None,
                reason=reason or None,
                evidence=evidence_of(item) if isinstance(item, dict) else None,
            )
        )
    return results


# ═════════════════════════════════════════════════════════════════════════════
# 输出（F8/F9/F10）
# ═════════════════════════════════════════════════════════════════════════════
@dataclass
class Context:
    """--json 输出用的矩阵元信息（解析失败时为 None）。"""

    schema: Optional[str] = None
    issue: Optional[int] = None
    anchor: Optional[str] = None


def _blank_summary() -> Dict[str, Any]:
    """全零 summary（exit 2 时用；`pass` 恒 False）。"""
    return {
        "total": 0,
        "mach_total": 0,
        "mach_ok": 0,
        "sem_total": 0,
        "sem_attested": 0,
        "pass": False,
    }


def _issue_json(issue: Issue) -> Dict[str, Any]:
    """Issue → JSON 对象（item 可选）。"""
    payload: Dict[str, Any] = {"code": issue.code, "detail": issue.detail}
    if issue.item:
        payload["item"] = issue.item
    return payload


def _item_json(result: ItemResult) -> Dict[str, Any]:
    """ItemResult → F10 的 JSON item。"""
    payload: Dict[str, Any] = {
        "id": result.item,
        "status": result.status,
        "verdict": result.verdict,
        "mech": result.mech,
    }
    if result.reason:
        payload["reason"] = result.reason
    if result.evidence:
        payload["evidence"] = result.evidence
    return payload


def _print_json(
    ctx: Context,
    *,
    items: List[ItemResult],
    summary: Dict[str, Any],
    errors: List[Issue],
) -> None:
    """stdout 仅一份 JSON（人读行全部抑制；F10）。"""
    payload = {
        "schema": ctx.schema,
        "issue": ctx.issue,
        "anchor": ctx.anchor,
        "items": [_item_json(result) for result in items],
        "summary": summary,
        "errors": [_issue_json(issue) for issue in errors],
    }
    # ensure_ascii=True：stdout 字节纯 ASCII ⇒ 任意 locale 的 json.load 都能解析
    # （Windows 控制台/管道编码差异下不因中文炸；解析后中文原样）
    print(json.dumps(payload, ensure_ascii=True, sort_keys=False))


def _build_summary(results: List[ItemResult], errors: List[Issue]) -> Dict[str, Any]:
    """汇总计数（F10）。"""
    mach_results = [result for result in results if result.mech is not None]
    sem_results = [result for result in results if result.mech is None]
    mach_ok = len([result for result in mach_results if result.verdict in ("ok", "na_ok")])
    sem_attested = len([result for result in sem_results if result.verdict == "attested"])
    return {
        "total": len(results) if results else 0,
        "mach_total": len(mach_results),
        "mach_ok": mach_ok,
        "sem_total": len(sem_results),
        "sem_attested": sem_attested,
        "pass": bool(not errors and mach_ok == len(mach_results) == 11 and sem_attested == 12),
    }


def _emit_red(
    ctx: Context,
    issues: List[Issue],
    *,
    json_mode: bool,
    items: Optional[List[ItemResult]] = None,
    print_items: bool = True,
    remap_verify: bool = False,
) -> int:
    """exit 1 输出：逐项行（可选）＋ ISSUE 行 ＋ 末行 MATRIX: FAIL。"""
    rendered = list(items or [])
    for issue in issues:
        if remap_verify and issue.code != "E_COV_UNJUDGED":
            issue.code = "E_VERIFY_FAILED"
    if json_mode:
        _print_json(
            ctx,
            items=rendered,
            summary=_build_summary(rendered, issues),
            errors=issues,
        )
        return 1
    if print_items:
        for result in rendered:
            print(f"{result.item} {result.status} {result.verdict} {result.detail}")
    for issue in issues:
        print(f"ISSUE {issue.code} {issue.item or '-'} {issue.detail}")
    print(f"MATRIX: FAIL {len(issues)} issue(s)")
    return 1


# ═════════════════════════════════════════════════════════════════════════════
# 主流程（F5 判定顺序）
# ═════════════════════════════════════════════════════════════════════════════
def _resolve_commit(repo: str, ref: str, phase: str, label: str) -> str:
    """把 ref 解析成 40 位 commit sha；不可解析 ⇒ exit 2（E_ANCHOR_MISMATCH）。"""
    code, out, err = _git(repo, ["rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"])
    if code != 0:
        detail = err.decode("utf-8", "replace").strip() or "rev-parse 非零退出"
        raise MatrixError(
            "E_ANCHOR_MISMATCH",
            f"{label} 不可解析（`{ref}`）：{detail}",
            phase=phase,
            exit_code=2,
            retryable=True,
        )
    sha = out.decode("utf-8", "replace").strip()
    if not re.match(r"^[0-9a-f]{40}$", sha):
        raise MatrixError(
            "E_ANCHOR_MISMATCH",
            f"{label} 解析结果不是 40 位 sha：`{sha}`",
            phase=phase,
            exit_code=2,
            retryable=True,
        )
    return sha


def _check_rows(matrix: Matrix) -> List[Issue]:
    """⑥ 23 行齐全 ＋ 顺序（缺 ⇒ ITEM_MISSING；多/未知 ⇒ ITEM_UNKNOWN；顺序 ⇒ SCHEMA）。"""
    issues: List[Issue] = []
    missing = [item_id for item_id in ITEM_ORDER if item_id not in matrix.items]
    unknown = [key for key in matrix.source_order if key not in ITEM_ORDER]
    if missing:
        issues.append(
            Issue(
                "E_MATRIX_ITEM_MISSING",
                f"items 缺 {len(missing)} 行：{' '.join(missing)}",
                None,
            )
        )
    if unknown:
        issues.append(
            Issue(
                "E_MATRIX_ITEM_UNKNOWN",
                f"items 含未知 id：{' '.join(unknown)}（固定 23 行，多一行都不行）",
                None,
            )
        )
    present_order = [key for key in matrix.source_order if key in ITEM_ORDER]
    expected = [item_id for item_id in ITEM_ORDER if item_id in matrix.items]
    if not missing and not unknown and present_order != expected:
        first_bad = next(
            (
                (index, got, want)
                for index, (got, want) in enumerate(zip(present_order, expected))
                if got != want
            ),
            None,
        )
        detail = "items 顺序不符（固定顺序 Q-1…Q-15、T-1…T-8）"
        if first_bad:
            detail += f"：第 {first_bad[0] + 1} 位应为 {first_bad[2]}，实为 {first_bad[1]}"
        issues.append(Issue("E_MATRIX_SCHEMA", detail, None))
    return issues


def run(args: argparse.Namespace) -> int:
    """主流程：按 F5 顺序判定；返回三态退出码。"""
    ctx = Context()
    json_mode = bool(args.json_mode)
    # ② 仓可读
    code, _out, err = _git(args.repo, ["rev-parse", "--git-dir"])
    if code != 0:
        detail = err.decode("utf-8", "replace").strip() or "rev-parse --git-dir 非零退出"
        raise MatrixError(
            "E_ANCHOR_MISMATCH",
            f"仓不可读（`{args.repo}`）：{detail}",
            phase="repo",
            exit_code=2,
            retryable=True,
        )
    # ③ 矩阵可读 ＋ 解析
    try:
        with open(args.matrix, "r", encoding="utf-8", errors="strict") as handle:
            text = handle.read()
    except OSError as exc:
        raise MatrixError(
            "E_ANCHOR_MISMATCH",
            f"矩阵文件不可读（`{args.matrix}`）：{exc}",
            phase="matrix",
            exit_code=2,
            retryable=True,
        ) from exc
    except UnicodeDecodeError as exc:
        raise _schema_error(f"矩阵文件不是合法 UTF-8：{exc}") from exc
    raw = parse_matrix(text)
    matrix = build_matrix(raw)
    ctx.schema = matrix.schema
    ctx.issue = matrix.issue
    ctx.anchor = matrix.anchor_raw
    # ④ --anchor 解析（缺省 = 矩阵 anchor）＋ ⑤ 一致性
    matrix_sha = _resolve_commit(args.repo, matrix.anchor_raw, "anchor", "矩阵 anchor")
    target_raw = args.anchor.strip() if isinstance(args.anchor, str) and args.anchor.strip() else None
    if target_raw is None:
        target_sha = matrix_sha
    else:
        if not ANCHOR_HEX.match(target_raw):
            raise MatrixError(
                "E_ANCHOR_MISMATCH",
                f"--anchor 格式非法（要求 7-40 位 hex）：`{target_raw}`",
                phase="anchor",
                exit_code=2,
                retryable=True,
            )
        target_sha = _resolve_commit(args.repo, target_raw, "anchor", "--anchor")
    if matrix_sha != target_sha:
        issue = Issue(
            "E_ANCHOR_MISMATCH",
            f"矩阵 anchor（{matrix.anchor_raw} → {matrix_sha[:12]}）与 --anchor"
            f"（{target_raw} → {target_sha[:12]}）不一致（两者皆可解析 ⇒ 真红）",
            None,
        )
        return _emit_red(ctx, [issue], json_mode=json_mode, print_items=False)
    # ⑥ 23 行
    row_issues = _check_rows(matrix)
    if row_issues:
        return _emit_red(ctx, row_issues, json_mode=json_mode, print_items=False)
    # ⑦ 状态/字段
    field_issues = check_item_fields(matrix)
    if field_issues:
        return _emit_red(ctx, field_issues, json_mode=json_mode, print_items=False)
    # ⑧ evidence 解析
    view = AnchorView(args.repo, target_sha)
    evidence_issues = check_evidence(matrix, view)
    if evidence_issues:
        return _emit_red(ctx, evidence_issues, json_mode=json_mode, print_items=False)
    # ⑨⑩ 机械 11 项（含 Q-11 武装门）＋ 语义 12 项
    mech_results = evaluate_mechanical(matrix, view)
    sem_results = semantic_results(matrix)
    results = mech_results + sem_results
    # 顺序：按 ITEM_ORDER 输出（语义项夹在中间，与矩阵行序一致）
    by_id = {result.item: result for result in results}
    ordered_results = [by_id[item_id] for item_id in ITEM_ORDER if item_id in by_id]
    issues: List[Issue] = []
    for result in mech_results:
        issues.extend(result.issues)
    # --verify：只重跑机械 11 项并判一致性
    if args.verify:
        if json_mode:
            return _emit_red(
                ctx,
                issues,
                json_mode=True,
                items=ordered_results,
                remap_verify=True,
            )
        consistent = 0
        for result in mech_results:
            is_consistent = not result.issues
            if is_consistent:
                consistent += 1
            print(
                f"VERIFY {result.item} declared={result.status} mech={result.verdict}"
                f" consistent={'yes' if is_consistent else 'no'}"
            )
        if issues:
            return _emit_red(
                ctx,
                issues,
                json_mode=False,
                items=ordered_results,
                print_items=False,
                remap_verify=True,
            )
        print(f"VERIFY: mach {consistent}/11 consistent")
        return 0
    # ⑪ 汇总（plain / --json）
    if json_mode:
        _print_json(
            ctx,
            items=ordered_results,
            summary=_build_summary(ordered_results, issues),
            errors=issues,
        )
        return 0 if not issues else 1
    for result in ordered_results:
        print(f"{result.item} {result.status} {result.verdict} {result.detail}")
    for issue in issues:
        print(f"ISSUE {issue.code} {issue.item or '-'} {issue.detail}")
    if issues:
        print(f"MATRIX: FAIL {len(issues)} issue(s)")
        return 1
    mach_ok = len([result for result in mech_results if result.verdict in ("ok", "na_ok")])
    print(
        f"MATRIX: PASS {len(ordered_results)}/23 (mach {mach_ok}/11,"
        f" sem {len(sem_results)} attested)"
    )
    return 0


# ═════════════════════════════════════════════════════════════════════════════
# CLI
# ═════════════════════════════════════════════════════════════════════════════
class _Parser(argparse.ArgumentParser):
    """参数错误 ⇒ MatrixError(phase=usage, exit 2)（禁 argparse 自杀式 exit 2 无降级行）。"""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise MatrixError(
            "E_ANCHOR_MISMATCH",
            f"用法错：{message}",
            phase="usage",
            exit_code=2,
            retryable=False,
        )


def build_parser() -> argparse.ArgumentParser:
    """构造 CLI（README F1 的 CLI 契约）。"""
    parser = _Parser(
        prog="check-acceptance-matrix.py",
        description="acceptance-matrix/v1 三态校验器（#1054 P0）",
    )
    parser.add_argument("matrix", help="矩阵文件路径（acceptance-matrix/v1 YAML 子集）")
    parser.add_argument("--repo", default=".", help="仓路径（默认 .）")
    parser.add_argument("--anchor", default=None, help="被验收 commit（默认取矩阵 anchor）")
    parser.add_argument("--verify", action="store_true", help="只重跑机械 11 项并判一致性")
    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_mode",
        help="stdout 仅输出一份 JSON（F10）",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    """入口：解析参数 → 跑主流程 → 三态退出码（0/1/2）。"""
    ctx = Context()
    json_mode = "--json" in (argv if argv is not None else sys.argv[1:])
    try:
        args = build_parser().parse_args(argv)
        json_mode = bool(args.json_mode)
        return run(args)
    except MatrixError as exc:
        if exc.exit_code == 2:
            return _emit_unjudged(exc, json_mode, ctx)
        return _emit_red(
            ctx,
            [Issue(exc.code, exc.detail, None)],
            json_mode=json_mode,
            print_items=False,
        )
    except KeyboardInterrupt:  # 显式中断：不伪装成通过
        sys.stderr.write("degraded: 用户中断\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
