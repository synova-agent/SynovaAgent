#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ═══════════════════════════════════════════════════════════════════════════════
# check-quality-delta.py — 质量增量闸（#912 批 1 · G1/G3/G4 · **只判变更集**）
#
# 设计哲学（一句）: **只判本次变更、存量一律不挡** —— 把「质量」从纸面标准变成
#   「改坏必红、改动之外 0 噪音」的最小执法闸；看不见（空集/坏输入）与看得见要分开说。
#
# 契约（铁律 47）:
#   @input   git 仓库（--root）＋ 变更集来源（三选一）:
#              --staged        `git diff --cached`（本地 pre-commit 用）
#              --base <ref>    `git diff <merge-base(base,HEAD)>...HEAD`（CI 用；默认取 $SYNO_DIFF_BASE）
#              皆未给 → base 解析链：$SYNO_DIFF_BASE → origin/local-main → local-main → HEAD~1
#            辅助件: docs/authority/WIRING-REGISTRY.yaml（G1）、docs/authority/quality-delta-whitelist.yaml（A3）
#   @output  stdout 逐条 ✅/❌（❌ 必带 path:line）＋ 末行
#              `QUALITY-DELTA: PASS changes=<n> rules=G1,G3,G4` ／ `QUALITY-DELTA: VIOLATIONS <n>`
#              ／ `QUALITY-DELTA: SKIP base=<sha12>（无代码变更）`
#            --json 时 stdout 仅一份合法 JSON（人读行抑制）
#   @exit    **三态**（ctrl-tower-change 模式 1）:
#              0 = 通过，或**过滤后空代码变更 ⇒ SKIP**（A1：纯文档 PR 是常态，不是"看不见"）
#              1 = 有违规（G1/G3/G4；含白名单棘轮被抬）
#              2 = 检查自身失败（base 不可解析／git 不可用／registry 或白名单不可读／参数非法）—— 同样阻断
#   @degraded 绝不静默：任何降级都打 stderr `degraded: <code> — <原因>` ＋（若设 `SYNO_GATE_DEGRADED_LOG`）
#            追加一行 JSON（time/component/code/phase/retryable；铁律 11/32）＋ exit 2
#   @error   code ∈ {E_BAD_BASE, E_GIT, E_REGISTRY, E_WHITELIST, E_USAGE, E_INTERNAL}
#
# 规则（批 1 只做 G1/G3/G4；A2：**不做机器判散文**）
#   G1 可达（只对**新增**能力件）:
#     R1.1  WIRING-REGISTRY.yaml 必须有行，且 defined_at 路径 = 该文件
#     R1.2  该能力必须有 ≥1 个**非测试**生产调用点（grep 导出名，排除 tests/ 与自身文件）
#           登记行 status=declared-only ⇒ 不红（但计数打印，进 #910 的棘轮账）
#   G3 判据（只对变更集中的测试件）:
#     R3.1  必须有行为断言（expect(/assert/ok "/[ "$ …按扩展名取 token）
#     R3.3  禁 skip／空 expect／恒真断言（expect(true)、expect(1).toBe(1)、assert True）
#     R3.4  禁"对源码文本断言"（TS/JS：readFileSync+toContain 无其它行为断言）—— 白名单可豁免
#   G4 边界（只对变更集中的 src/routes/**、src/agent/** 的 .ts）:
#     R4.1  req.body.{orgId|teamId|tenantId} ⇒ 红（租户必须来自 req.auth）
#     R4.2  凭据/租户与 `|| ''`／`|| 'default'`／`?? ''` 同现 ⇒ 红（白名单文件可豁免）
#     R4.3  出站调用（fetch/http.request/axios）同文件无 AbortSignal.timeout|signal:|timeout: ⇒ 红
#     R4.4  响应体含 value|secret|token 且同文件无 configured|source: 脱敏 ⇒ 红
#
# 白名单（A3 · 唯一豁免通道；**禁代码内注释豁免**）:
#   docs/authority/quality-delta-whitelist.yaml
#     schema_version: 1
#     ratchet: {max_entries: <N>}        # 只减不增：entries > max_entries ⇒ 违规（W-RATCHET）
#     entries: [{path, rule, reason, ruling}]   # ruling 形如 `裁 330`
#   匹配：path 支持 `*` 尾通配；rule 精确匹配（R4.2/…）。条目文件不可读 ⇒ exit 2（fail-closed）。
#
# 既有基础（禁重复建设）:
#   · 变更集口径与 #841 J15 同源（`git diff --name-only <mb>...HEAD`）
#   · 三态退出码/注入缝/UTF-8/判别力自检 = scripts/control-tower/AGENTS.md 四条既有约定
#   · 不做 YAML 依赖（同 claim_store.py：CI runner 无 PyYAML ⇒ 缺失会退化成"读不到声明"的静默路径）
#
# 已知限制（Known Limitations —— 禁读成"已检测"）:
#   1. **grep 看不见语义**：R1.2 按导出名 grep 判"生产调用点"，动态用法（字符串反射/依赖注入容器/
#      re-export 后再导入）会**漏判为红**；反向地，同名的无关符号会**假绿**。故批 1 只挡"新增能力件"。
#   2. **R3 只判文本形态**：行为断言的"真伪"机器判不了（A2 明确不做散文判定）；R3.1 只保"有断言形态"，
#      反例两态走 L1 复核清单（见 memory/notes/proposed/2026-10-24-912-quality-delta-A2-checklist.md）。
#   3. **R4 只扫变更文件内的字面模式**：跨文件的租户传递、封装在 helper 内的 `|| ''`、
#      非 fetch/axios 的出站（如 SDK、child_process）**不在本器视野**。
#   4. **JS/TS 语法级误报**：注释与字符串里的 `req.body.orgId` 也会命中（无 AST）；批 1 接受，
#      白名单只对 R4.2 开放，其余靠 L1 复核。
#   5. **空集语义**：过滤后空代码变更 = `exit 0 + SKIP`（A1）；**只有** base 坏/输入坏才 exit 2。
#   6. **不判存量**：P2（全量）与 P3（旧门禁处置）不在本批；本器对变更集之外的文件零输出。
# ═══════════════════════════════════════════════════════════════════════════════
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

COMPONENT = "check-quality-delta"
CODE_EXT = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh")
CODE_ROOTS = ("src/", "packages/", "scripts/", "tests/")  # tests/ 也是"代码"（G3 对象；G1 另有排除）
# 非代码面（文档/声明/证据）：过滤后为空 ⇒ SKIP（A1）
NON_CODE_PREFIX = (".claude/", "memory/", "docs/", "gate-exemptions/", "task-state/", ".handbook")
# G1 只对"新增能力件"生效；这些前缀是别的线的领域/生成物，不要求新登记（已知限制 1）
G1_EXCLUDE = (
    "tests/", "scripts/audit/", "scripts/control-tower/probe-",
    "scripts/control-tower/install-deps.sh", ".d.ts",
)

API_FILES = ("docs/authority/WIRING-REGISTRY.yaml",)
DEFAULT_WHITELIST = "docs/authority/quality-delta-whitelist.yaml"


class DeltaError(Exception):
    """检查自身失败（→ exit 2，fail-closed）。"""

    def __init__(self, code: str, message: str, phase: str = "scan", retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.phase = phase
        self.retryable = retryable


# ── git ───────────────────────────────────────────────────────────────────────
def git(root: str, *args: str) -> str:
    p = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise DeltaError("E_GIT", f"git {' '.join(args)} 失败: {(p.stderr or '').strip()[:200]}")
    return p.stdout


def resolve_base(root: str) -> str:
    cands = [os.environ.get("SYNO_DIFF_BASE", ""), "origin/local-main", "local-main", "HEAD~1"]
    for c in cands:
        c = (c or "").strip()
        if not c:
            continue
        p = subprocess.run(["git", "-C", root, "rev-parse", "--verify", "-q", f"{c}^{{commit}}"],
                           capture_output=True, text=True)
        if p.returncode == 0:
            return c
    raise DeltaError("E_BAD_BASE", "base 解析链全不可解析（$SYNO_DIFF_BASE/origin/local-main/local-main/HEAD~1）")


def change_set(root: str, base: Optional[str], staged: bool) -> Tuple[List[str], List[str], str]:
    """→ (changed, added, base_sha)；staged=True 走暂存区。"""
    if staged:
        changed = git(root, "diff", "--cached", "--name-only", "--diff-filter=ACMR").split()
        added = git(root, "diff", "--cached", "--name-only", "--diff-filter=A").split()
        head = git(root, "rev-parse", "--short=12", "HEAD").strip()
        return changed, added, f"staged@{head}"
    assert base is not None
    try:
        mb = git(root, "merge-base", base, "HEAD").strip()
    except DeltaError as exc:
        raise DeltaError("E_BAD_BASE", f"base={base} 无法与 HEAD 求 merge-base: {exc}") from exc
    if not mb:
        raise DeltaError("E_BAD_BASE", f"base={base} merge-base 为空")
    changed = git(root, "diff", "--name-only", "--diff-filter=ACMR", f"{mb}...HEAD").split()
    added = git(root, "diff", "--name-only", "--diff-filter=A", f"{mb}...HEAD").split()
    return changed, added, mb[:12]


def is_test_file(path: str) -> bool:
    """G3 对象 = 真正的测试件（不是 tests/ 下的所有文件：AGENTS.md/README 不是测试）。"""
    base = path.rsplit("/", 1)[-1]
    return (".test." in base and base.endswith(CODE_EXT)) or base.startswith("test_") or base.endswith("_test.py")


def is_code(path: str) -> bool:
    if not path.startswith(CODE_ROOTS) or not path.endswith(CODE_EXT):
        return False
    return not path.startswith(NON_CODE_PREFIX)


# ── YAML 子集（故意不引 PyYAML；同 claim_store.py 的理由）───────────────────
def _scalar(raw: str) -> str:
    v = raw.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v in ("", "null", "~"):
        return ""
    return v


def parse_registry(text: str) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    cur: Optional[Dict[str, str]] = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if re.match(r"^entries:\s*$", line):
            continue
        m = re.match(r"^\s*-\s+(capability|defined_at|provider|consumer|test|status|owner|notes)\s*:\s*(.*)$", line)
        if m:
            key, val = m.group(1), _scalar(m.group(2))
            if key == "capability":
                cur = {"capability": val}
                rows.append(cur)
            elif cur is not None:
                cur[key] = val
            continue
        m2 = re.match(r"^\s+(defined_at|provider|consumer|test|status|owner|notes)\s*:\s*(.*)$", line)
        if m2 and cur is not None:
            cur[m2.group(1)] = _scalar(m2.group(2))
    return [r for r in rows if r.get("capability")]


def parse_whitelist(text: str) -> Tuple[int, List[Dict[str, str]]]:
    max_entries = 0
    entries: List[Dict[str, str]] = []
    cur: Optional[Dict[str, str]] = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^\s*max_entries\s*:\s*(\d+)\s*$", line)
        if m:
            max_entries = int(m.group(1))
            continue
        m = re.match(r"^\s*-\s+(path|rule|reason|ruling)\s*:\s*(.*)$", line)
        if m:
            if m.group(1) == "path":
                cur = {"path": _scalar(m.group(2))}
                entries.append(cur)
            elif cur is not None:
                cur[m.group(1)] = _scalar(m.group(2))
    return max_entries, entries


def whitelisted(entries: List[Dict[str, str]], path: str, rule: str) -> bool:
    for e in entries:
        p = e.get("path", "")
        if not p:
            continue
        hit = path == p if not p.endswith("*") else path.startswith(p[:-1])
        if hit and e.get("rule", "") == rule:
            return True
    return False


# ── 规则 ───────────────────────────────────────────────────────────────────────
def exported_names(root: str, path: str) -> List[str]:
    try:
        text = (Path(root) / path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    names: List[str] = []
    for m in re.finditer(r"^export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)", text, re.M):
        names.append(m.group(1))
    for m in re.finditer(r"^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(", text, re.M):
        names.append(m.group(1))
    if not names and path.endswith(".sh"):
        names.append(Path(path).stem)
    return sorted(set(names))


def capability_tokens(root: str, path: str) -> List[str]:
    """G1 的"能力名"取法：**门禁/脚本件按文件名为能力**，源码件按导出名。

    为什么分开：`scripts/control-tower/*.py` 的"接线"事实是"被 pre-commit/CI 调用"（文件名即能力），
    而 `src/**` 的接线事实是"导出符号被生产侧引用"。混用会要么漏判要么假绿（Known Limitations 1）。
    """
    if path.startswith("scripts/"):
        return [Path(path).name]
    return exported_names(root, path)


def has_prod_call(root: str, path: str, names: List[str]) -> bool:
    if not names:
        return False
    files = git(root, "ls-files", "src", "packages", "scripts").splitlines()
    pat = re.compile(r"\b(" + "|".join(re.escape(n) for n in names) + r")\b")
    for f in files:
        if f == path or f.startswith("tests/") or ".test." in f or not f.endswith(CODE_EXT):
            continue
        try:
            text = (Path(root) / f).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        hit = any(n in text for n in names) if path.startswith("scripts/") else bool(pat.search(text))
        if hit:
            return True
    return False


G3_ASSERT = {
    ".ts": ("expect(", "assert.", "assertEqual"),
    ".tsx": ("expect(", "assert.", "assertEqual"),
    ".js": ("expect(", "assert.", "assertEqual"),
    ".mjs": ("expect(", "assert.", "assertEqual"),
    ".cjs": ("expect(", "assert.", "assertEqual"),
    ".py": ("assert", "self.assert"),
    ".sh": ('ok "', "no \"", "assert_", '[ "$', "[ -", "assert_rc"),
}
G3_SKIP = [
    (re.compile(r"\b(?:it|test|describe)\.skip\s*\("), "it/test/describe.skip"),
    (re.compile(r"\b(?:xit|xdescribe)\s*\("), "xit/xdescribe"),
    (re.compile(r"expect\(\s*\)"), "空 expect()"),
    (re.compile(r"expect\(\s*(?:true|false)\s*\)"), "恒真断言 expect(true/false)"),
    (re.compile(r"expect\(\s*(\d+)\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*\1\s*\)"), "恒真断言 expect(N).toBe(N)"),
    (re.compile(r"^\s*assert\s+True\s*$", re.M), "恒真断言 assert True"),
    (re.compile(r"(?://|#)\s*TODO:\s*assert", re.I), "TODO: assert 占位"),
]


def line_of(text: str, idx: int) -> int:
    return text.count("\n", 0, idx) + 1


def scan_g3(root: str, path: str, wl: List[Dict[str, str]]) -> List[Tuple[str, str, int, str]]:
    out: List[Tuple[str, str, int, str]] = []
    try:
        text = (Path(root) / path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        raise DeltaError("E_GIT", f"测试件不可读: {path}")
    ext = Path(path).suffix
    toks = G3_ASSERT.get(ext, ())
    if toks and not any(t in text for t in toks):
        out.append(("R3.1", path, 1, "缺行为断言（无 " + "/".join(toks) + "）"))
    for rx, label in G3_SKIP:
        for m in rx.finditer(text):
            out.append(("R3.3", path, line_of(text, m.start()), f"{label} —— 判据空壳")); break
    if ext in (".ts", ".tsx", ".js", ".mjs", ".cjs") and not whitelisted(wl, path, "R3.4"):
        has_read = re.search(r"readFileSync\s*\(|fileURLToPath|read_text\s*\(", text)
        if has_read:
            for m in re.finditer(r"\.toContain\s*\(", text):
                ln = line_of(text, m.start())
                win = "\n".join(text.splitlines()[max(0, ln - 3):ln + 1])
                if re.search(r"readFileSync|read_text|fileURLToPath", win):
                    others = len(re.findall(r"expect\s*\([^)]", text))
                    if others <= 1:
                        out.append(("R3.4", path, ln, "对源码文本断言（readFileSync+.toContain 且无其它行为断言）"))
                        break
    return out


def scan_g4(root: str, path: str, wl: List[Dict[str, str]]) -> List[Tuple[str, str, int, str]]:
    out: List[Tuple[str, str, int, str]] = []
    try:
        text = (Path(root) / path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        raise DeltaError("E_GIT", f"路由件不可读: {path}")
    lines = text.splitlines()
    for i, line in enumerate(lines, start=1):
        if re.search(r"req\.body\.(orgId|teamId|tenantId)\b", line):
            out.append(("R4.1", path, i, "租户来自 req.body（必须 req.auth）"))
        if re.search(r"(?i)(secret|token|apiKey|orgId|tenantId)", line) and re.search(r"\|\|\s*''|\?\?\s*''|\|\|\s*'default'", line):
            if not whitelisted(wl, path, "R4.2"):
                out.append(("R4.2", path, i, "凭据/租户缺省放开（|| '' / || 'default'）"))
    if re.search(r"\b(fetch|axios)\s*\(|http\.request\s*\(", text):
        if not re.search(r"AbortSignal\.timeout|signal\s*:|timeout\s*:", text):
            out.append(("R4.3", path, 1, "出站调用无超时/取消（AbortSignal.timeout|signal|timeout）"))
    if re.search(r"res\.json\s*\(|res\.send\s*\(|reply\.send\s*\(", text):
        if re.search(r"(?m)^\s*(value|secret|token)\s*:", text) and not re.search(r"configured|source\s*:", text):
            out.append(("R4.4", path, 1, "凭据读面返回明文（无 configured/source 脱敏）"))
    return out


def scan_g1(root: str, added: List[str], registry: List[Dict[str, str]]) -> Tuple[List[Tuple[str, str, int, str]], int]:
    out: List[Tuple[str, str, int, str]] = []
    declared_only = 0
    for path in added:
        if not is_code(path) or any(path.endswith(x) or path.startswith(x) for x in G1_EXCLUDE):
            continue
        if path.startswith("scripts/control-tower/") and path.endswith(".py") and not re.match(
                r"^scripts/control-tower/(check|probe|quality|merge|brief|resolve|claim)", path):
            # 仍按能力件处理（不额外放宽；宽度由 R1.2 的"生产调用点"约束）
            pass
        row = next((r for r in registry if r.get("defined_at", "").split(":")[0] == path), None)
        declared = False
        if row is None:
            out.append(("R1.1", path, 1, "新增能力件未在 WIRING-REGISTRY.yaml 登记（defined_at）"))
        elif row.get("status") == "declared-only":
            declared = True
            declared_only += 1
        if declared:
            # A3/提案 §2：declared-only 是**显式豁免**（不红），计入棘轮；不要求生产调用点
            continue
        names = capability_tokens(root, path)
        if not has_prod_call(root, path, names):
            out.append(("R1.2", path, 1, "无生产调用点（仅 tests/ 或无人引用）"
                                             + ("" if names else "；且未识别到导出名")))
    return out, declared_only


# ── 主流程 ───────────────────────────────────────────────────────────────────
def degraded(code: str, msg: str) -> None:
    sys.stderr.write(f"degraded: {code} — {msg}\n")
    logp = os.environ.get("SYNO_GATE_DEGRADED_LOG", "").strip()
    if logp:
        try:
            rec = {"time": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds"),
                   "component": COMPONENT, "code": code, "phase": "scan", "retryable": False,
                   "message": msg[:300]}
            Path(logp).parent.mkdir(parents=True, exist_ok=True)
            with open(logp, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except OSError:
            pass


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="质量增量闸（G1/G3/G4 · 只判变更集）")
    ap.add_argument("--root", default=None, help="仓库根（默认 git toplevel）")
    ap.add_argument("--base", default=None, help="base ref（默认 $SYNO_DIFF_BASE → origin/local-main → local-main → HEAD~1）")
    ap.add_argument("--staged", action="store_true", help="用暂存区作为变更集（本地 pre-commit）")
    ap.add_argument("--registry", default=None, help=f"接线登记表（默认 {API_FILES[0]}）")
    ap.add_argument("--whitelist", default=None, help=f"白名单（默认 {DEFAULT_WHITELIST}）")
    ap.add_argument("--json", action="store_true", help="stdout 仅输出 JSON")
    try:
        args = ap.parse_args(argv)
    except SystemExit:
        degraded("E_USAGE", "参数解析失败")
        return 2

    root = args.root or subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True,
                                        text=True).stdout.strip()
    if not root or not Path(root).is_dir():
        degraded("E_USAGE", f"--root 无效: {root!r}")
        return 2
    try:
        base = args.base or None if not args.staged else None
        changed, added, base_sha = change_set(root, base, args.staged)
    except DeltaError as exc:
        degraded(exc.code, str(exc))
        print(f"QUALITY-DELTA: ERROR {exc.code}", file=sys.stdout)
        return 2

    code_changed = [p for p in changed if is_code(p)]
    if not code_changed:
        # A1: 过滤后空代码变更 = 不适用（不是"看不见"）
        msg = f"SKIP: 无代码变更（base={base_sha}）"
        if args.json:
            print(json.dumps({"status": "skip", "base": base_sha, "changed": len(changed)},
                             ensure_ascii=False))
        else:
            print(f"⏭  {msg}")
            print(f"QUALITY-DELTA: SKIP base={base_sha}")
        return 0

    # 辅助件按需读（只有 G1 需要 registry；白名单缺失即 fail-closed）
    reg_path = Path(root) / (args.registry or API_FILES[0])
    wl_path = Path(root) / (args.whitelist or DEFAULT_WHITELIST)
    try:
        max_entries, wl_entries = parse_whitelist(wl_path.read_text(encoding="utf-8"))
    except OSError as exc:
        degraded("E_WHITELIST", f"白名单不可读 {wl_path}: {exc}")
        print("QUALITY-DELTA: ERROR E_WHITELIST", file=sys.stdout)
        return 2
    registry: List[Dict[str, str]] = []
    added_code = [p for p in added if is_code(p)]
    if added_code:
        try:
            registry = parse_registry(reg_path.read_text(encoding="utf-8"))
        except OSError as exc:
            degraded("E_REGISTRY", f"接线登记表不可读 {reg_path}: {exc}")
            print("QUALITY-DELTA: ERROR E_REGISTRY", file=sys.stdout)
            return 2

    violations: List[Tuple[str, str, int, str]] = []
    notes: List[str] = []
    try:
        g1, declared_only = scan_g1(root, added, registry)
        violations += g1
        notes.append(f"G1 可达: 新增能力件 {len([p for p in added_code if not any(p.endswith(x) or p.startswith(x) for x in G1_EXCLUDE)])} 个"
                     + (f"；declared-only {declared_only} 个（计入棘轮）" if declared_only else ""))
        for p in changed:
            if is_test_file(p):
                violations += scan_g3(root, p, wl_entries)
        for p in changed:
            if p.endswith(".ts") and (p.startswith("src/routes/") or p.startswith("src/agent/")):
                violations += scan_g4(root, p, wl_entries)
    except DeltaError as exc:
        degraded(exc.code, str(exc))
        print(f"QUALITY-DELTA: ERROR {exc.code}", file=sys.stdout)
        return 2
    except Exception as exc:  # noqa: BLE001 —— 兜底：宁可 exit 2 也不把 bug 当绿
        degraded("E_INTERNAL", f"未预期异常: {type(exc).__name__}: {exc}")
        print("QUALITY-DELTA: ERROR E_INTERNAL", file=sys.stdout)
        return 2

    if len(wl_entries) > max_entries:
        violations.append(("W-RATCHET", DEFAULT_WHITELIST, 1,
                           f"白名单条目 {len(wl_entries)} > ratchet.max_entries {max_entries}（只减不增）"))

    if args.json:
        print(json.dumps({"status": "violations" if violations else "pass", "base": base_sha,
                          "changed": len(code_changed), "entries": len(wl_entries),
                          "violations": [{"rule": r[0], "path": r[1], "line": r[2], "msg": r[3]}
                                         for r in violations]}, ensure_ascii=False))
        return 1 if violations else 0

    for n in notes:
        print(f"ℹ️  {n}")
    if violations:
        for rule, path, line, msg in violations:
            print(f"❌ {rule}: {path}:{line} {msg}")
        print(f"QUALITY-DELTA: VIOLATIONS {len(violations)}")
        return 1
    for rule in ("G1", "G3", "G4"):
        print(f"✅ {rule} 可达/判据/边界")
    print(f"QUALITY-DELTA: PASS changes={len(code_changed)} rules=G1,G3,G4 base={base_sha}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
