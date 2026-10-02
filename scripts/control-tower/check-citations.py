#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check-citations.py — 引用可核验门禁（D919）

背景（创始人 2026-09-22 质问「我写了一份不存在的权威引用——你怎么敢做这种事情」）:
  上一任 CTO 的结论 = 借 Anthropic 的「机器可验契约」+ DSH 的 InvariantError 形态（违规从不匿名、
  声明在注册时校验），但**未落成机制**。本脚本即该结论的机制化。

既有缺口（D919 修复，逐条实测于 scripts/control-tower/pre-dispatch-check.sh ⑥）:
  - `head -25` 截断 → 第 26 条引用起永不校验（M1: 检查未执行 == 检查通过）
  - 扩展名白名单 `ts|cjs|mjs|sh|py|json|yml` 不含 .md/.html/.txt
    → 「docs/**.md:行号」这类**权威引用整体漏检**（上一任翻车正是该形态）
  - 无仓外根 → DSH 源码引用（如 dsh-subprocess-local/lib/index.js:757）无处解析 → 外部权威引用静默漏检
  - 无错误码 / 无责任方 → 违规不可归因

契约 (铁律 47):
  @input  — <artifact> [<artifact>...] 派单/交回件/规格等文本文件
            选项: --repo <path>            仓库根（默认 git rev-parse --show-toplevel）
                  --external-root <path>   仓外权威源根（可多次；如 DSH 安装目录）
                  --external-prefix <str>  外部包名前缀（可多次；默认 dsh-）
                  --owner <str>            责任方（写入每条违规，可归因；默认仓库目录名）
                  --json                   机器可读输出
                  --quiet                  仅输出汇总
  @output — 违规逐条（code / artifact / line / citation / owner / roots_tried）+ 汇总行
            （含「待建声明」计数：行内标注『新建』的交付物路径不计违规 —— 本仓既有约定，防误拦）
            `--json` → {"artifacts": [...], "violations": [...], "summary": {...}}
  @exit   — 0 = 全部引用可核验；1 = 存在不可核验引用（fail-closed 业务阻断）；
            2 = 检查本身失败（artifact 不可读 / 无有效输入 / repo 非法）
  @degraded — artifact 不存在或不可读 → exit 2 + stderr `degraded: ...`（绝不当作通过，铁律 11）
  @error  — code ∈ {CITE_FILE_NOT_FOUND, CITE_LINE_OUT_OF_RANGE, CITE_BAD_RANGE,
                    CITE_FILE_UNREADABLE, CITE_QUOTE_MISMATCH}
            每条违规带 .code + .owner + .citation（原始引用文本）→ 可归因（DSH InvariantError 形态）
  @cross_platform — D520: 本文件即 python 实现，无裸 python3 调用（上文"python3"仅为文档说明）；
                    纯标准库；无 bash 依赖；UTF-8 强制（Windows 控制台）；见 PLATFORM-CHECKLIST.md

豁免: artifact 内 `## 引用豁免` 段落，每行 `- <引用原文> — <理由>`（无理由不生效，
  与 merge_writeset_gate.py 的写集豁免同形）。
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

try:  # D313 M5 UTF-8 强制（Windows 控制台）
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

EXT = (r"md|markdown|html|htm|txt|json|jsonl|ya?ml|sh|bash|py|ts|tsx|js|mjs|cjs|"
       r"toml|ini|cfg|sql|db|csv|xml")
# 路径字符集用 \w（Python3 默认 Unicode）→ **中文/日文文件名同被核验**。
# 自测实证：ASCII-only 字符集会让 `docs/.../不存在的裁定书.md:3` 静默漏检（同类 fail-open）。
# 规则 1: path:LINE 或 path:LINE-LINE（半角/全角冒号；- ~ – 分隔）
CITE_RE = re.compile(
    r"(?P<path>[\w./~@+\-]+\.(?:" + EXT + r"))[:：](?P<start>\d+)"
    r"(?:\s*[-–~]\s*(?P<end>\d+))?"
)
# 规则 2: 反引号裸路径
BARE_RE = re.compile(r"`(?P<path>[\w./~@+\-]+\.(?:" + EXT + r"))`")
# 占位符/示意路径（不构成引用声称，跳过）
PLACEHOLDER_MARKERS = ("path/to/", "path\\to\\", "<", ">", "...", "**", "X/Y", "YYYY", "MM-DD", "{", "}")
REPO_PREFIXES = ("src/", "scripts/", "tests/", "docs/", "packages/", "extensions/", ".github/",
                 ".claude/", "task-state/", "memory/", "electron/", "electron-renderer/",
                 "expert/", "knowledge/", "theory/", "skills/", "security/", "providers/")
EXEMPT_HEADING_RE = re.compile(r"^#{2,4}\s*引用豁免")
# D919 自测修正（狗粮实测 2026-09-23）：派单件会合法引用**待建交付物**（审计报告/新脚本等）
#   ——本仓库既有约定「不存在须显式标注『新建』」（pre-dispatch-check ④）。若不豁免，
#   合法派单件被误拦 → 误报产生噪音 → 门禁被绕（V4.x 教训）。故：行内含下列标记 → 计为
#   declaration（非违规），除非文件已存在（存在时仍照常核行号）。
NEW_MARKERS = ("新建", "待建", "将新建", "新建文件", "新建目录", "（新）", "(新)")


def is_placeholder(p: str) -> bool:
    return any(m in p for m in PLACEHOLDER_MARKERS)


def git_root() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=20)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return ""


def parse_exemptions(text: str):
    """`## 引用豁免` 段落: 每行 `- <引用原文> — <理由>`。无理由不生效。返回 {引用原文: 理由}。"""
    out, in_sec = {}, False
    for line in text.splitlines():
        s = line.strip()
        if EXEMPT_HEADING_RE.match(s):
            in_sec = True
            continue
        if in_sec and re.match(r"^#{1,4}\s", s) and not EXEMPT_HEADING_RE.match(s):
            in_sec = False
            continue
        if not in_sec or not s.startswith("-"):
            continue
        body = s.lstrip("-").strip()
        parts = re.split(r"\s+[—–-]{1,2}\s+", body, maxsplit=1)
        if len(parts) != 2 or not parts[1].strip():
            continue
        for cand in re.findall(r"\S+?\.[A-Za-z0-9]+[:：]\d+(?:[-–~]\d+)?", parts[0]):
            out[cand] = parts[1].strip()
        key = parts[0].strip().strip("`")
        out.setdefault(key, parts[1].strip())
    return out


def resolve(path_str: str, roots):
    """返回 (abs_path or None, tried_list)。仓内优先，随后仓外根；支持 ~ 展开与绝对路径。
    外部包根补全：DSH 布局为 <dsh_root>/node_modules/@deepseek-ai/<pkg>，
    故对每个根追加 `node_modules/@deepseek-ai/<path>` 候选（实测 2026-09-23：
    dsh-subprocess-local/lib/index.js 仅在 <root>/node_modules/@deepseek-ai/ 下存在）。"""
    tried = []
    cands = []
    if path_str.startswith("~"):
        cands.append(Path(os.path.expanduser(path_str)))
    elif os.path.isabs(path_str):
        cands.append(Path(path_str))
    else:
        for r in roots:
            cands.append(Path(r) / path_str)
            cands.append(Path(r) / "node_modules" / "@deepseek-ai" / path_str)
    for c in cands:
        tried.append(str(c))
        if c.is_file():
            return str(c), tried
    return None, tried


def line_count(p: str):
    try:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            return sum(1 for _ in f), None
    except OSError as e:
        return None, str(e)


def scan(artifact: str, roots, external_prefixes, verify_quote: bool, owner: str):
    try:
        text = Path(artifact).read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return None, f"artifact 不可读: {e}"
    exempt = parse_exemptions(text)
    violations, total, resolved_n, decl_n = [], 0, 0, 0
    for lineno, line in enumerate(text.splitlines(), 1):
        seen = set()
        is_decl = any(m in line for m in NEW_MARKERS)

        def handle(cite: str, path_str: str, start, end, rule: str):
            nonlocal total, resolved_n, decl_n
            if cite in seen or is_placeholder(path_str):
                return
            seen.add(cite)
            total += 1
            if cite in exempt or path_str in exempt:
                resolved_n += 1
                return
            # 规则 2 只核验「仓内前缀」或「外部包名前缀」的裸路径（其余不构成可核验声称，防误报）
            if rule == "bare":
                if not (path_str.startswith(REPO_PREFIXES)
                        or any(path_str.startswith(p) for p in external_prefixes)):
                    total -= 1
                    return
            abs_p, tried = resolve(path_str, roots)
            if abs_p is None:
                if is_decl:   # 显式标注「新建」→ 交付物声明，非可核验声称（本仓既有约定）
                    decl_n += 1
                    return
                violations.append({"code": "CITE_FILE_NOT_FOUND", "artifact": artifact,
                                   "line": lineno, "citation": cite, "owner": owner,
                                   "roots_tried": tried, "detail": "文件不存在于任何已知根"})
                return
            if start is None:
                resolved_n += 1
                return
            n, err = line_count(abs_p)
            if err:
                violations.append({"code": "CITE_FILE_UNREADABLE", "artifact": artifact,
                                   "line": lineno, "citation": cite, "owner": owner,
                                   "roots_tried": tried, "detail": err})
                return
            s, e = int(start), int(end) if end else None
            if e is not None and e < s:
                violations.append({"code": "CITE_BAD_RANGE", "artifact": artifact, "line": lineno,
                                   "citation": cite, "owner": owner, "roots_tried": tried,
                                   "detail": f"区间倒置 {s}>{e}"})
                return
            if s > n or (e is not None and e > n):
                violations.append({"code": "CITE_LINE_OUT_OF_RANGE", "artifact": artifact,
                                   "line": lineno, "citation": cite, "owner": owner,
                                   "roots_tried": tried,
                                   "detail": f"文件仅 {n} 行，引用越界"})
                return
            resolved_n += 1

        for m in CITE_RE.finditer(line):
            handle(m.group(0), m.group("path"), m.group("start"), m.group("end"), "anchor")
        for m in BARE_RE.finditer(line):
            handle(m.group("path"), m.group("path"), None, None, "bare")
    return {"artifact": artifact, "citations": total, "resolved": resolved_n,
            "declarations": decl_n, "violations": violations}, None


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True, description="引用可核验门禁（D919）")
    ap.add_argument("artifacts", nargs="*")
    ap.add_argument("--repo", default="")
    ap.add_argument("--external-root", action="append", default=[])
    ap.add_argument("--external-prefix", action="append", default=[])
    ap.add_argument("--owner", default="")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if not args.artifacts:
        print("用法: check-citations.py <artifact> [...] [--repo R] [--external-root X] "
              "[--external-prefix dsh-] [--owner 责任方] [--json]", file=sys.stderr)
        return 2

    repo = args.repo or git_root()
    if not repo or not os.path.isdir(repo):
        print("degraded: repo 不可解析（--repo 未给且非 git 仓库）— fail-closed", file=sys.stderr)
        return 2
    owner = args.owner or os.path.basename(os.path.abspath(repo))
    roots = [repo] + [r for r in args.external_root if r]
    prefixes = args.external_prefix or ["dsh-"]

    missing = [a for a in args.artifacts if not os.path.isfile(a)]
    if missing:
        for m in missing:
            print(f"degraded: artifact 不存在: {m} — fail-closed（不当作通过）", file=sys.stderr)
        return 2

    reports, all_v = [], []
    # D964: `archive/**` 豁免根 —— 归档 = 历史文档批量 git mv 到 archive 前缀
    #   （文档减负），其内部引用的是**移动前**的路径 ⇒ 归档件不再做引用解析，
    #   否则归档批 PR 会因断链恒红。**显式打印跳过**（不静默，铁律 11）。
    archived = [a for a in args.artifacts
                if "/archive/" in a.replace("\\", "/") or a.startswith("archive/")]
    for a in archived:
        print(f"  ⏭ 跳过（archive/** 豁免根，D964）: {a}")
    active = [a for a in args.artifacts if a not in set(archived)]
    if not active:
        print("  汇总: 全部 artifact 命中 archive/** 豁免根（无引用核验）")
        return 0
    for a in active:
        rep, err = scan(a, roots, prefixes, False, owner)
        if err:
            print(f"degraded: {err} — fail-closed", file=sys.stderr)
            return 2
        reports.append(rep)
        all_v.extend(rep["violations"])

    total = sum(r["citations"] for r in reports)
    resolved = sum(r["resolved"] for r in reports)
    declared = sum(r.get("declarations", 0) for r in reports)
    summary = {"citations": total, "resolved": resolved, "declarations": declared,
               "violations": len(all_v), "roots": roots, "owner": owner}

    if args.json:
        # D919 Windows 修复（CI 实测 run 107021493797）：--json 用 ASCII 转义输出 ——
        # 消费方（含测试内联 python）在 Windows 默认 locale 编码下读 UTF-8 中文会炸，
        # 机器可读输出必须零编码假设（中文由 \uXXXX 表达，语义不变）。
        print(json.dumps({"artifacts": reports, "violations": all_v, "summary": summary},
                         ensure_ascii=True, indent=2))
    elif not args.quiet:
        for v in all_v:
            print(f"  ⚠️ [{v['code']}] {v['artifact']}:{v['line']} → {v['citation']} "
                  f"（owner={v['owner']}；{v['detail']}；尝试根: {', '.join(v['roots_tried']) or '无'}）")
        print(f"  引用核验: {total} 条 / 通过 {resolved} / 待建声明 {declared} / 违规 {len(all_v)}（owner={owner}）")

    if args.quiet:
        print(f"引用核验: {total} 条 / 通过 {resolved} / 待建声明 {declared} / 违规 {len(all_v)}")
    return 1 if all_v else 0


if __name__ == "__main__":
    sys.exit(main())
