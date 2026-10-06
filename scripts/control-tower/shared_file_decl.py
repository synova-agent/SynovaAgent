#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""scripts/control-tower/shared_file_decl.py — D979 FIX-011 共享治理文件声明解析器。

背景（D979 / FIX-011）: 共享治理文件天然被多张卡反复修改，resolver 只解析出**一张**
brief（认领数最多 + 锚点 + 日期回退）⇒ 共享件的历史归属会顶掉本卡的 brief ⇒
`commit-msg-check.sh` 的 D328 判定把**授权修改**误判为「疑似并行劫持」（24h 拦 3 次）。
本模块提供**显式多卡共享声明**的解析与双向校验：只有被改文件**自己**声明了
`MSG_DID` 与 `CLAIM_DID` 双方时，D328 才放行（逐文件可审、diff 可见、禁 blanket 豁免）。

【过渡机制】CTO 2026-09-26 裁定二（D979）：本模块（⒝ 显式共享声明解析器）批为**过渡机制**，
非终态 —— 阶段 3 由行级 blame 取代（届时本模块与 commit-msg-check.sh 的 ⒝ 放行分支一并退役；
本次仅三处标注，不改任何函数签名/正则/退出码）。

契约（铁律 47）:
  @input  纯解析: (text, path) → 声明集合；I/O 解析: root + 仓库内相对路径 → 声明集合
          读取顺序 SHARED(F) = 暂存 index（`git show :F`）→ 工作区 → HEAD
  @output (ids: set[str], evidence: list[str]) — ids 为归一化大写 D#；evidence 为声明原文行
  @degraded 三处皆不可读 → (set(), []) + source="missing"；调用方按「未声明」处理
          （fail-closed：维持原劫持阻断，绝不静默放行）

声明载体（规格 ⒝，任一即生效）:
  (a) 文本（.md/.yml/.yaml/.sh/.txt）: 文件内任意行匹配
      `共享声明\\s*[:：]\\s*D\\d+(\\s*[,，]\\s*D\\d+)*`（大小写兼容，归一为大写）
  (b) 结构化（.json/.yml/.yaml）: 键 `shared_with` 或 `共享声明`，值为 D# 字符串数组
      （json 为 JSON 数组；yml 支持 `[D1, D2]` 与 `["D1","D2"]`）

CLI（bash 侧单次进程调用）:
  shared_file_decl.py --msg-did D979 --claim-did D582 --root <repo> --files-from <file|->
  退出码（ctrl-tower-change 模式 1 三态）:
    0 = 允许（被校验文件**每一个**都双向命中声明）
    1 = 不允许（业务阻断：未声明 / 缺任一侧 D# / 文件三处皆不可读）
    2 = 调用错误（缺参数 / 文件列表为空）——调用方须按「未声明」处理，不得放行
"""
import argparse
import json
import os
import re
import subprocess
import sys
from typing import Dict, List, Optional, Sequence, Set, Tuple

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

# 文本载体扩展名（规格 ⒝(a)）与结构化载体扩展名（规格 ⒝(b)）
TEXT_EXTS = (".md", ".yml", ".yaml", ".sh", ".txt")
STRUCTURED_EXTS = (".json", ".yml", ".yaml")

# 结构化键（spec: shared_with 或 共享声明）
SHARED_KEYS = ("shared_with", "共享声明")

# 文本载体（a）: 共享声明<冒号> D###[, D###]*（紧邻列表，不含列表之后的散落 D#）
_TEXT_MARKER_RE = re.compile(r"共享声明\s*[:：]\s*([Dd]\d+(?:\s*[,，]\s*[Dd]\d+)*)")
_DID_TOKEN_RE = re.compile(r"[Dd]\d+")
# yml flow 数组（b）: shared_with: [D1, D2] / 共享声明: ["D1","D2"]
_YML_FLOW_RE = re.compile(
    r"""^\s*["']?(shared_with|共享声明)["']?\s*:\s*\[(.*)\]\s*(?:#.*)?$"""
)
_DID_ONLY_RE = re.compile(r"^[Dd]\d+$")


def normalize_did(value: str) -> str:
    """D# 归一化: 去空白 + 大写（brief 文件名恒为大写 D###，CT-60 大小写兼容同口径）。"""
    return value.strip().upper()


def _dids_in_list(raw: str) -> Set[str]:
    """逗号/全角逗号分隔的 D# 列表 → 归一化集合（仅收 D# token，其余忽略）。"""
    out: Set[str] = set()
    for part in re.split(r"[,，]", raw):
        tok = part.strip().strip("\"'").strip()
        if _DID_ONLY_RE.match(tok):
            out.add(normalize_did(tok))
    return out


def parse_text_decl(text: str) -> Tuple[Set[str], List[str]]:
    """载体（a）文本声明解析（纯函数）。返回 (D# 集合, 声明原文行列表)。"""
    ids: Set[str] = set()
    evidence: List[str] = []
    for line in text.splitlines():
        m = _TEXT_MARKER_RE.search(line)
        if not m:
            continue
        hits = {normalize_did(tok) for tok in _DID_TOKEN_RE.findall(m.group(1))}
        if not hits:
            continue
        ids |= hits
        evidence.append(line.strip())
    return ids, evidence


def parse_json_decl(text: str) -> Tuple[Set[str], List[str]]:
    """载体（b）json 声明解析（纯函数）。非法 JSON → 空集（不抛异常，调用方按未声明处理）。"""
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return set(), []
    ids: Set[str] = set()
    evidence: List[str] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if isinstance(key, str) and key.strip() in SHARED_KEYS and isinstance(value, list):
                    hits: Set[str] = set()
                    for item in value:
                        if isinstance(item, str) and _DID_ONLY_RE.match(item.strip()):
                            hits.add(normalize_did(item))
                    if hits:
                        ids.update(hits)
                        evidence.append(
                            "{}: {}".format(key.strip(), json.dumps(value, ensure_ascii=False))
                        )
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    return ids, evidence


def parse_yml_decl(text: str) -> Tuple[Set[str], List[str]]:
    """载体（b）yml flow 数组解析（纯函数）。按行解析，不引入 PyYAML 依赖。"""
    ids: Set[str] = set()
    evidence: List[str] = []
    for line in text.splitlines():
        m = _YML_FLOW_RE.match(line.rstrip("\r"))
        if not m:
            continue
        hits = _dids_in_list(m.group(2))
        if not hits:
            continue
        ids |= hits
        evidence.append(line.strip())
    return ids, evidence


def parse_shared_decl(text: str, path: str = "") -> Tuple[Set[str], List[str]]:
    """纯函数: (文件文本, 路径) → (授权集 SHARED(F), 声明原文列表)。

    载体按扩展名分派: 文本载体仅 .md/.yml/.yaml/.sh/.txt；结构化载体仅 .json/.yml/.yaml。
    未知扩展名 → 空集（未声明 ⇒ 调用方 fail-closed）。
    """
    ext = os.path.splitext(path)[1].lower()
    ids: Set[str] = set()
    evidence: List[str] = []
    if ext in TEXT_EXTS:
        t_ids, t_ev = parse_text_decl(text)
        ids |= t_ids
        evidence += t_ev
    if ext in STRUCTURED_EXTS:
        s_ids, s_ev = parse_json_decl(text) if ext == ".json" else parse_yml_decl(text)
        ids |= s_ids
        evidence += s_ev
    return ids, evidence


def _git_show(root: str, rev_path: str) -> Tuple[int, str]:
    """`git -C <root> show <rev_path>`；失败/超时 → (128, "")（不抛异常）。"""
    try:
        proc = subprocess.run(
            ["git", "-C", root, "show", rev_path],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return 128, ""
    return proc.returncode, proc.stdout


def read_decl_source(root: str, path: str) -> Tuple[Optional[str], str]:
    """授权集读取顺序: 暂存 index（`git show :F`）→ 工作区 → HEAD。

    返回 (文本 或 None, 来源标签 index|worktree|HEAD|missing)。
    """
    rc, out = _git_show(root, ":" + path)
    if rc == 0:
        return out, "index"
    full = os.path.join(root, path)
    if os.path.isfile(full):
        try:
            with open(full, encoding="utf-8", errors="replace") as fh:
                return fh.read(), "worktree"
        except OSError:
            pass
    rc, out = _git_show(root, "HEAD:" + path)
    if rc == 0:
        return out, "HEAD"
    return None, "missing"


def check_files(
    root: str, files: Sequence[str], msg_did: str, claim_did: str
) -> Tuple[bool, List[str]]:
    """逐文件双向校验（规格 ⒝ 判定）。

    返回 (allowed, lines)。allowed=True ⇔ **每一个** F 的 SHARED(F) 同时含
    MSG_DID 与 CLAIM_DID；否则 False + 逐文件原因行（含缺哪个 D# 与声明原文）。
    """
    msg_did = normalize_did(msg_did)
    claim_did = normalize_did(claim_did)
    needed = {msg_did, claim_did}
    all_ok = True
    lines: List[str] = []
    for raw_path in files:
        path = raw_path.strip()
        if not path:
            continue
        text, source = read_decl_source(root, path)
        if text is None:
            all_ok = False
            lines.append(
                "FILE={} SOURCE=missing DECL=(无) HIT=(无) MISSING={} — 三处皆不可读".format(
                    path, ",".join(sorted(needed))
                )
            )
            continue
        ids, evidence = parse_shared_decl(text, path)
        missing = sorted(needed - ids)
        decl = " / ".join(evidence) if evidence else "(无)"
        line = "FILE={} SOURCE={} DECL={} HIT={} MISSING={}".format(
            path,
            source,
            decl,
            ",".join(sorted(ids)) if ids else "(无)",
            ",".join(missing) if missing else "(无)",
        )
        if missing:
            all_ok = False
        lines.append(line)
    return all_ok, lines


def _read_file_list(src: str) -> List[str]:
    """文件列表来源: `-` = stdin，否则读文件路径。"""
    if src == "-":
        data = sys.stdin.read()
    else:
        try:
            with open(src, encoding="utf-8", errors="replace") as fh:
                data = fh.read()
        except OSError:
            return []
    return [line.strip() for line in data.splitlines() if line.strip()]


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="D979 FIX-011 共享治理文件声明解析器")
    parser.add_argument("--msg-did", required=True, help="commit message 声明的 D#（如 D979）")
    parser.add_argument("--claim-did", required=True, help="被认领 brief 的 D#（如 D582）")
    parser.add_argument("--root", required=True, help="仓库根（git -C 定位 index/HEAD）")
    parser.add_argument("--files-from", required=True, help="待校验文件列表（`-` = stdin）")
    args = parser.parse_args(argv)

    msg_did = normalize_did(args.msg_did or "")
    claim_did = normalize_did(args.claim_did or "")
    if not _DID_ONLY_RE.match(msg_did) or not _DID_ONLY_RE.match(claim_did):
        print("DECL_ERR: --msg-did/--claim-did 必须为 D<数字>（调用错误，不得据此放行）")
        return 2
    if not os.path.isdir(args.root):
        print("DECL_ERR: --root 不是目录: {}（调用错误，不得据此放行）".format(args.root))
        return 2

    files = _read_file_list(args.files_from)
    if not files:
        print("DECL_ERR: 文件列表为空（调用错误，不得据此放行）")
        return 2

    allowed, lines = check_files(args.root, files, msg_did, claim_did)
    print("DECL_ALLOW" if allowed else "DECL_DENY")
    print("MSG_DID={} CLAIM_DID={} FILES={}".format(msg_did, claim_did, len(files)))
    for line in lines:
        print(line)
    return 0 if allowed else 1


if __name__ == "__main__":
    sys.exit(main())
