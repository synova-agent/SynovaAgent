#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ═══════════════════════════════════════════════════════════════════════════════
# check-tool-args-delta.py — 工具入参校验增量闸（#915 Q-1 · R1/R2/R3 · **只判变更集**）
#
# 设计哲学（一句）: 工具面的「空 schema ＋ 有参 handler」是入参校验的盲区 —— 本闸只判
#   本次变更集把它**变多还是变少**（双向棘轮），改坏必红、改动之外 0 噪音。
#
# 契约（铁律 47）:
#   @input  git 仓库（--root）＋ 变更集来源（四选一，优先级从上到下）:
#              --files "<f1> <f2>"  显式变更集（测试注入缝；**整体替换**变更集，语义同
#                                  #734 PR 预算门禁的 `--files` 注入缝（:51 口径））
#              --staged            `git diff --cached`（本地 pre-commit 用）
#              --base <ref>        `git diff <merge-base(base,HEAD)>...HEAD`（CI 用）
#              皆未给 → base 解析链：$SYNO_DIFF_BASE → gitea/local-main → origin/local-main
#                        → local-main → HEAD~1（**有意偏离 #912**：集成分支是 local-main，
#                        依 CTO 2026-10-12 P0 裁定；origin/local-main 已陈旧）
#            辅助件: --baseline <path>（默认 scripts/control-tower/tool-args-baseline.txt）
#   @output  stdout 逐条 ℹ️/✅/❌（❌ 必带 path:line）＋末行
#              `TOOL-ARGS-DELTA: PASS changes=<n> rules=R1,R2,R3` ／
#              `TOOL-ARGS-DELTA: VIOLATIONS <n>` ／
#              `TOOL-ARGS-DELTA: SKIP base=<sha12>（无相关变更）`
#            --json 时 stdout 仅一份合法 JSON：
#              {status: 'PASS'|'VIOLATIONS'|'SKIP', base, changed, violations[], rules[]}
#              （与同一次文本运行同一份结论数据，不另算一遍）
#   @exit    **三态**（ctrl-tower-change 模式 1 / scripts/control-tower/AGENTS.md）:
#              0 = 通过，或**过滤后无相关代码变更 ⇒ SKIP**（同 #912 的 A1：不适用 ≠ 看不见）
#              1 = 有违规（R1/R2/R3；含棘轮被抬／修好未删登记）
#              2 = 检查自身失败（E_BAD_BASE／E_GIT／E_BASELINE／E_USAGE／E_INTERNAL／
#                  E_EMPTY_SCAN／E_SANDBOX）—— **同样阻断**，绝不当通过
#   @degraded 绝不静默：任何降级都打 stderr `degraded: <code> — <原因>`
#             ＋（若设 `SYNO_GATE_DEGRADED_LOG`）追加一行 JSON
#             （time/component/code/phase/retryable/message；铁律 11/32）＋ exit 2
#   @error   code ∈ {E_BAD_BASE, E_GIT, E_BASELINE, E_USAGE, E_INTERNAL, E_EMPTY_SCAN, E_SANDBOX}
#
# 三条规则（**同一扫描面** = `src/agent/`、`src/tools/`、`vendor/pandoc-skill/`）:
#   ⚠️ 扫描面**不得**复用 #912 质量增量闸的 `CODE_ROOTS`
#      —— 它不含 `vendor/`，会把 pandoc 面（2 个已注册工具）整片过滤掉 ⇒ 假 SKIP。
#   R1 新增/改动工具必须有可校验 schema（只判变更集内上述三前缀）:
#      `registry.register({…})` 块 或 `: ToolDefinition = {…}` 定义项，其
#      `parameters.properties` 为空/缺失 **且** `handler:` 有形参 ⇒ 红（点名 path:line ＋ 工具名）。
#      形参识别锚 = `handler:\s*(?:async\s+)?\(\s*(?:\{|[A-Za-z_$])`（覆盖 `(params`／`(p`／`({a}`；
#      零形参 `()` 不命中 —— 这是"真 nullary"与"漏写 schema"的分界线）。
#   R2 不得绕过 execute 调**工具** handler（只判变更集内上述三前缀；排除 `src/agent/tools.ts`）:
#      出现 `.handler(` 调用 ⇒ 红（点名 path:line）。非工具面（`command.handler(`／`job.handler(`）
#      不在视野 —— 由扫描面保证，`src/cron/`、`src/cli-manager.ts` 根本不在三前缀内。
#   R3 存量棘轮（**全树**，扫描源＝`--root` 工作树，不是 base ref）:
#      全树空 schema 工具名集合 ≠ `--baseline` 清单 ⇒ 双向红：
#      **多** ⇒ 新增盲区（未登记的新工具没有可校验 schema）；**少** ⇒ 修好未删登记。
#      基线格式：`<tool_name> | <理由>`，`#` 开头为注释/空行忽略（` | ` 分隔）。
#
# 既有基础（禁重复建设；参照实物逐条照抄口径）:
#   · 变更集解析／空集 SKIP／三态／degraded = #912 批 1 的增量闸（同口径）
#   · `--files` 整体替换语义 = #734 PR 预算门禁的注入缝（:51）
#   · `--selfcheck` mktemp 沙箱夹具 = scripts/control-tower/quality-baseline.py:886
#
# 已知限制（Known Limitations —— 禁读成"已检测"）:
#   1. **R1/R2 是正则不是 AST**：字符串/注释里的同名文本可能误判；handler 形参名只认
#      `(params`／`(p`／`({` 三种形态（`(...args`／换行断开的形参表会漏判）。
#   2. **R2 只判工具面**：`src/cli-manager.ts:55`（`command.handler`）与
#      `src/cron/scheduler.ts:497`（`job.handler`）不在视野（T11 锁死"不误红"）。
#   3. **动态注册面不在视野**：connector manifest／MCP 装载／`mcpToolRegistry` 等运行时注册的
#      工具既不计入 R3 集合，也不受 R1 约束（本题只覆盖静态工具面）。
#   4. **R3 与 R1/R2 不同源**：R3 扫**全树**（棘轮对存量），R1/R2 只扫**变更集**；
#      故"改动之外的文件"只影响 R3 集合，不影响 R1/R2。
#   5. **不判 schema 的正确性**：只判 `properties` 空不空与 handler 有没有形参；
#      `enum`／`format`／`$ref` 等关键字语义不在本闸（运行时校验面另有判据）。
#   6. **空集语义**：过滤后空相关变更 = `exit 0 + SKIP`；**只有** base 坏/输入坏/看不见才 exit 2。
#   7. **一文件一扫描**：变更文件内**所有**工具定义都参与 R1/R2（不按 diff hunk 精确定位），
#      即"改了这个文件 ⇒ 这个文件的工具面全查一遍"（少漏多查，代价是多报同文件的存量问题）。
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

try:  # D313 M5 UTF-8 强制（Windows 控制台/子进程统一 UTF-8）
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

COMPONENT = "check-tool-args-delta"
# 🔴 同一扫描面（R1/R2/R3 共用）；**不得**复用 #912 增量闸的 CODE_ROOTS（缺 vendor/）
SCAN_ROOTS = ("src/agent/", "src/tools/", "vendor/pandoc-skill/")
CODE_EXT = (".ts", ".tsx", ".js", ".mjs", ".cjs")
# R2 的唯一豁免：execute 本体就住在这里（它**必须**调 tool.handler —— 那是唯一合法调用点）
R2_EXCLUDE = ("src/agent/tools.ts",)
DEFAULT_BASELINE = "scripts/control-tower/tool-args-baseline.txt"
SCAN_ROOTS_TEXT = ", ".join(r.rstrip("/") for r in SCAN_ROOTS)

# ── 识别锚（正则面；已知限制 1）──────────────────────────────────────────────
RE_DEF_REGISTER = re.compile(r"registry\.register\s*\(\s*\{")
RE_DEF_TYPED = re.compile(r":\s*ToolDefinition\s*=\s*\{")
RE_TOOL_NAME = re.compile(r"\bname\s*:\s*'([^']+)'")
RE_PARAMS = re.compile(r"parameters\s*:\s*\{")
RE_PROP_KEY = re.compile(r"properties\s*:")
RE_EMPTY_PROPS = re.compile(r"properties\s*:\s*\{\s*\}")
# 🔴 本行的正则形态是 T8 变异体的锚（R1 恒空 ⇒ T2 场景翻绿 ⇒ 证明 R1 承重）
RE_HANDLER_PARAMS = re.compile(r"handler:\s*(?:async\s+)?\(\s*(?:\{|[A-Za-z_$])")
RE_HANDLER_CALL = re.compile(r"\.handler\s*\(")

Violation = Tuple[str, str, int, str]  # (rule, path, line, msg)


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
        raise DeltaError("E_GIT", "git %s 失败: %s" % (" ".join(args), (p.stderr or "").strip()[:200]))
    return p.stdout


def resolve_base(root: str) -> str:
    """base 解析链：$SYNO_DIFF_BASE → gitea/local-main → origin/local-main → local-main → HEAD~1。"""
    cands = [os.environ.get("SYNO_DIFF_BASE", ""), "gitea/local-main", "origin/local-main",
             "local-main", "HEAD~1"]
    for c in cands:
        c = (c or "").strip()
        if not c:
            continue
        p = subprocess.run(["git", "-C", root, "rev-parse", "--verify", "-q", "%s^{commit}" % c],
                           capture_output=True, text=True)
        if p.returncode == 0:
            return c
    raise DeltaError("E_BAD_BASE",
                     "base 解析链全不可解析（$SYNO_DIFF_BASE/gitea/local-main/origin/local-main/"
                     "local-main/HEAD~1）")


def change_set(root: str, base: Optional[str], staged: bool) -> Tuple[List[str], str]:
    """→ (changed, base_label)；staged=True 走暂存区，否则走 merge-base(base,HEAD)...HEAD。"""
    if staged:
        changed = git(root, "diff", "--cached", "--name-only", "--diff-filter=ACMR").split()
        head = git(root, "rev-parse", "--short=12", "HEAD").strip()
        return changed, "staged@%s" % head
    if not base:
        raise DeltaError("E_BAD_BASE", "base 为空（内部调用错误）")
    try:
        mb = git(root, "merge-base", base, "HEAD").strip()
    except DeltaError as exc:
        raise DeltaError("E_BAD_BASE", "base=%s 无法与 HEAD 求 merge-base: %s" % (base, exc)) from exc
    if not mb:
        raise DeltaError("E_BAD_BASE", "base=%s merge-base 为空" % base)
    changed = git(root, "diff", "--name-only", "--diff-filter=ACMR", "%s...HEAD" % mb).split()
    return changed, mb[:12]


def is_relevant(path: str) -> bool:
    """是否落在本闸扫描面（三前缀 ＋ 代码扩展名）。"""
    return path.startswith(SCAN_ROOTS) and path.endswith(CODE_EXT)


# ── 工具定义扫描（R1/R2/R3 共用的唯一实现）──────────────────────────────────
def _block(text: str, open_idx: int) -> str:
    """从 `{` 起按花括号配平取块（正则面；字符串/注释内的花括号可能干扰 —— 已知限制 1）。"""
    depth = 0
    i = open_idx
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[open_idx:i + 1]
        i += 1
    return text[open_idx:]


def _line_of(text: str, idx: int) -> int:
    return text.count("\n", 0, idx) + 1


def _params_block(block: str) -> Optional[str]:
    m = RE_PARAMS.search(block)
    if not m:
        return None
    brace = block.find("{", m.end() - 1)
    if brace < 0:
        return None
    return _block(block, brace)


def iter_tool_defs(text: str) -> List[Dict]:
    """抽取文件内全部工具定义：{name, line, empty_schema, handler_params, handler_line}。

    两种写法本仓并存，同一扫描面必须都认:
      ① `registry.register({ … })`（src/agent/builtin-tools.ts、vendor/pandoc-skill/）
      ② `export const xTool: ToolDefinition = { … }`（src/tools/*-tools.ts，34 个定义）
    数组形态 `: ToolDefinition[] = [...]` 是引用聚合、不是定义 ⇒ 不参与（RE_DEF_TYPED 要求 `= {`）。
    """
    starts: List[int] = []
    for rx in (RE_DEF_REGISTER, RE_DEF_TYPED):
        for m in rx.finditer(text):
            brace = text.find("{", m.end() - 1)
            if brace >= 0:
                starts.append(brace)
    out: List[Dict] = []
    for open_idx in sorted(set(starts)):
        block = _block(text, open_idx)
        nm = RE_TOOL_NAME.search(block)
        if not nm:
            continue
        pb = _params_block(block)
        if pb is None:
            empty = True                      # parameters 缺失 ⇒ 无可校验 schema（R1 的"缺失"分支）
        else:
            empty = bool(RE_EMPTY_PROPS.search(pb)) or not RE_PROP_KEY.search(pb)
        hm = RE_HANDLER_PARAMS.search(block)
        out.append({
            "name": nm.group(1),
            "line": _line_of(text, open_idx + nm.start()),
            "empty_schema": empty,
            "handler_params": bool(hm),
            "handler_line": _line_of(text, open_idx + hm.start()) if hm else 0,
        })
    return out


def read_text(root: str, rel: str) -> str:
    try:
        return (Path(root) / rel).read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise DeltaError("E_GIT", "文件不可读 %s: %s" % (rel, exc)) from exc


def scan_tree_defs(root: str) -> List[Dict]:
    """全树（三前缀）工具定义清单 —— R3 的唯一取数口，也是"信号量"来源。"""
    defs: List[Dict] = []
    base = Path(root)
    for rel_root in SCAN_ROOTS:
        d = base / rel_root
        if not d.is_dir():
            continue
        for p in sorted(d.rglob("*")):
            if not p.is_file() or p.suffix not in CODE_EXT:
                continue
            rel = p.relative_to(base).as_posix()
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                raise DeltaError("E_GIT", "文件不可读 %s: %s" % (rel, exc)) from exc
            for d0 in iter_tool_defs(text):
                item = dict(d0)
                item["path"] = rel
                defs.append(item)
    return defs


# ── 基线（R3 的唯一登记面；不可读 ⇒ fail-closed）──────────────────────────────
def load_baseline(path: str) -> Dict[str, Tuple[str, int]]:
    """→ {tool_name: (reason, lineno)}；`#` 注释/空行忽略；` | ` 分隔名字与理由。"""
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise DeltaError("E_BASELINE", "基线不可读 %s: %s" % (path, exc)) from exc
    rows: Dict[str, Tuple[str, int]] = {}
    for i, line in enumerate(raw.splitlines(), start=1):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        name, _, reason = s.partition("|")
        name = name.strip()
        if not name:
            continue
        rows[name] = (reason.strip(), i)
    return rows


# ── 规则实现（主流程与 --selfcheck 共用这三个函数；禁另写玩具规则）────────────
def rule_r1(root: str, path: str, text: str) -> List[Violation]:
    """R1: 空/缺失 schema ＋ handler 有形参 ⇒ 红（点名 path:line ＋ 工具名）。"""
    out: List[Violation] = []
    for d in iter_tool_defs(text):
        if d["empty_schema"] and d["handler_params"]:
            out.append(("R1", path, d["line"],
                        "工具 %s：parameters.properties 为空/缺失但 handler 有形参 ⇒ 无法校验入参"
                        "（补 properties，或写成零形参 handler）" % d["name"]))
    return out


def rule_r2(root: str, path: str, text: str) -> List[Violation]:
    """R2: 绕过 execute 直接调工具 handler ⇒ 红（src/agent/tools.ts 是唯一合法调用点）。"""
    out: List[Violation] = []
    for m in RE_HANDLER_CALL.finditer(text):
        out.append(("R2", path, _line_of(text, m.start()),
                    "绕过 execute 直接调用工具 handler（入参校验与超时收口都在 execute 内）"))
    return out


def rule_r3(root: str, baseline: Dict[str, Tuple[str, int]],
            defs: Optional[List[Dict]] = None) -> List[Violation]:
    """R3: 全树空 schema 名集合 ≠ 基线 ⇒ 双向红（多=新增盲区；少=修好未删登记）。"""
    tree_defs = scan_tree_defs(root) if defs is None else defs
    tree = {d["name"]: d for d in tree_defs if d["empty_schema"]}
    tree_names = set(tree)
    base_names = set(baseline)
    out: List[Violation] = []
    for name in sorted(tree_names - base_names):
        d = tree[name]
        out.append(("R3", d["path"], d["line"],
                    "空 schema 工具「%s」未在 %s 登记（新增盲区：集合多一名）"
                    % (name, DEFAULT_BASELINE)))
    for name in sorted(base_names - tree_names):
        _, lineno = baseline[name]
        out.append(("R3", DEFAULT_BASELINE, lineno,
                    "基线登记「%s」但树中已无空 schema 工具（修好未删登记：集合少一名）" % name))
    return out


# ── 降级留痕（铁律 11/32：绝不静默）──────────────────────────────────────────
def degraded(code: str, msg: str, phase: str = "scan") -> None:
    sys.stderr.write("degraded: %s — %s\n" % (code, msg))
    logp = os.environ.get("SYNO_GATE_DEGRADED_LOG", "").strip()
    if not logp:
        return
    try:
        rec = {"time": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
               "component": COMPONENT, "code": code, "phase": phase, "retryable": False,
               "message": msg[:300]}
        Path(logp).parent.mkdir(parents=True, exist_ok=True)
        with open(logp, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError as exc:  # 留痕落盘失败本身也要可见（但不覆盖原错误码）
        sys.stderr.write("degraded: E_DEGRADED_LOG — 降级日志写入失败: %s\n" % exc)


# ── --selfcheck（判别力自检：4 夹具沙箱，不读写真实 src/**）────────────────────
_SELF_CLEAN = """import type { ToolRegistry } from './tools';

export function registerClean(registry: ToolRegistry): void {
  registry.register({
    name: 'clean_tool',
    description: '合规工具（有 properties ＋ 有参 handler）',
    parameters: { type: 'object', properties: { orgId: { type: 'string' } }, required: ['orgId'] },
    handler: async (params) => ({ orgId: params.orgId }),
  });
}
"""
_SELF_F1 = """import type { ToolRegistry } from './tools';

export function registerF1(registry: ToolRegistry): void {
  registry.register({
    name: 'f1_blank_tool',
    description: '空 schema ＋ 有参 handler ⇒ R1 必红',
    parameters: { type: 'object', properties: {} },
    handler: async (params) => ({ ok: params }),
  });
}
"""
_SELF_F2 = """import type { ToolDefinition } from './tools';

export function bypass(tool: ToolDefinition, params: Record<string, unknown>): unknown {
  return tool.handler(params);
}
"""
_SELF_F3 = """import type { ToolRegistry } from './tools';

export function registerF3(registry: ToolRegistry): void {
  registry.register({
    name: 'f3_nullary_a',
    description: 'nullary（合法，已登记）',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ ok: true }),
  });

  registry.register({
    name: 'f3_nullary_b',
    description: 'nullary（未登记 ⇒ R3 必红）',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ ok: true }),
  });
}
"""
_SELF_BASELINE_CLEAN = """# selfcheck 基线（clean 夹具：树内无空 schema 工具）
"""
_SELF_BASELINE_F3 = """# selfcheck 基线（f3 夹具：只登记 a，b 未登记 ⇒ R3 = 1）
f3_nullary_a | nullary：handler 零形参
"""


def _write_fixture(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)


def cmd_selfcheck() -> int:
    """判别力自检：clean=0 / f1=1 / f2=1 / f3=1（与主流程同一 R1/R2/R3 函数）。"""
    try:
        sandbox = tempfile.mkdtemp(prefix="tool-args-delta-selfcheck-")
    except OSError as exc:
        raise DeltaError("E_SANDBOX", "自检沙箱不可建: %s" % exc) from exc
    try:
        target = os.path.join(sandbox, "src", "agent", "builtin-tools.ts")
        base_path = os.path.join(sandbox, DEFAULT_BASELINE)

        # ① clean 夹具：三条规则都必须 0（防"全红"式假自检）
        _write_fixture(target, _SELF_CLEAN)
        _write_fixture(base_path, _SELF_BASELINE_CLEAN)
        clean_defs = scan_tree_defs(sandbox)
        if not clean_defs:
            raise DeltaError("E_SANDBOX", "自检沙箱工具定义数==0（信号量==0 ⇒ exit 2）")
        clean = (len(rule_r1(sandbox, "src/agent/builtin-tools.ts", _SELF_CLEAN))
                 + len(rule_r2(sandbox, "src/agent/builtin-tools.ts", _SELF_CLEAN))
                 + len(rule_r3(sandbox, load_baseline(base_path), defs=clean_defs)))

        # ② f1 夹具：空 schema ＋ 有参 handler ⇒ R1 恰好 1（R1 承重的判据）
        _write_fixture(target, _SELF_F1)
        f1 = len(rule_r1(sandbox, "src/agent/builtin-tools.ts", _SELF_F1))

        # ③ f2 夹具：工具面绕过 execute ⇒ R2 恰好 1（R2 承重的判据）
        _write_fixture(target, _SELF_F2)
        f2 = len(rule_r2(sandbox, "src/agent/builtin-tools.ts", _SELF_F2))

        # ④ f3 夹具：基线漂移（多一名未登记）⇒ R3 恰好 1（R3 承重的判据）
        _write_fixture(target, _SELF_F3)
        _write_fixture(base_path, _SELF_BASELINE_F3)
        f3 = len(rule_r3(sandbox, load_baseline(base_path)))

        if (f1, f2, f3, clean) != (1, 1, 1, 0):
            print("SELFCHECK-FAIL f1=%d f2=%d f3=%d clean=%d（期望 1/1/1/0 ⇒ 判别力不足）"
                  % (f1, f2, f3, clean))
            return 1
        print("SELFCHECK-OK f1=1 f2=1 f3=1 clean=0")
        return 0
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


# ── 主流程 ───────────────────────────────────────────────────────────────────
def _emit_error(code: str, msg: str, as_json: bool) -> int:
    degraded(code, msg)
    if not as_json:
        print("TOOL-ARGS-DELTA: ERROR %s" % code)
    return 2


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="工具入参校验增量闸（R1/R2/R3 · 只判变更集）")
    ap.add_argument("--root", default=None, help="仓库根（默认 git toplevel）")
    ap.add_argument("--base", default=None,
                    help="base ref（默认链：$SYNO_DIFF_BASE → gitea/local-main → "
                         "origin/local-main → local-main → HEAD~1）")
    ap.add_argument("--staged", action="store_true", help="用暂存区作为变更集（本地 pre-commit）")
    ap.add_argument("--files", default=None,
                    help='显式变更集（空格分隔；**整体替换**变更集，同 #734 PR 预算门禁 :51 口径）')
    ap.add_argument("--baseline", default=None, help="基线（默认 %s）" % DEFAULT_BASELINE)
    ap.add_argument("--json", action="store_true", help="stdout 仅输出 JSON")
    ap.add_argument("--selfcheck", action="store_true", help="判别力自检（mktemp 沙箱 4 夹具）")
    try:
        args = ap.parse_args(argv)
    except SystemExit:
        degraded("E_USAGE", "参数解析失败")
        return 2

    root = args.root or subprocess.run(["git", "rev-parse", "--show-toplevel"],
                                       capture_output=True, text=True).stdout.strip()
    if not root or not Path(root).is_dir():
        return _emit_error("E_USAGE", "--root 无效: %r" % (root,), args.json)

    if args.selfcheck:
        try:
            return cmd_selfcheck()
        except DeltaError as exc:
            degraded(exc.code, str(exc), exc.phase)
            return 2

    baseline_path = Path(root) / (args.baseline or DEFAULT_BASELINE)
    try:
        baseline = load_baseline(str(baseline_path))
    except DeltaError as exc:
        return _emit_error(exc.code, str(exc), args.json)

    try:
        if args.files is not None:
            # 显式注入缝：**整体替换**变更集（不是 append —— 否则夹具仓自身变更集会混进来）
            changed = args.files.split()
            base_label = "files"
        elif args.staged:
            # 本地提交端：判暂存区（base...HEAD 看不到未提交的暂存改动 ⇒ 会假绿）
            changed, base_label = change_set(root, None, True)
        else:
            changed, base_label = change_set(root, args.base or resolve_base(root), False)
    except DeltaError as exc:
        return _emit_error(exc.code, str(exc), args.json)

    relevant = [p for p in changed if is_relevant(p)]
    if not relevant:
        if args.json:
            print(json.dumps({"status": "SKIP", "base": base_label, "changed": 0,
                              "violations": [], "rules": ["R1", "R2", "R3"]},
                             ensure_ascii=False))
        else:
            print("⏭  SKIP: 无相关变更（扫描面 %s 内 0 个文件）" % SCAN_ROOTS_TEXT)
            print("TOOL-ARGS-DELTA: SKIP base=%s（无相关变更）" % base_label)
        return 0

    violations: List[Violation] = []
    try:
        tree_defs = scan_tree_defs(root)
        if not tree_defs:
            # 信号量==0：扫描面一个工具定义都没看见 ⇒ 禁当"没问题"（AGENTS.md 三态纪律）
            raise DeltaError("E_EMPTY_SCAN",
                             "扫描面 %s 内工具定义数==0（看不见 ⇒ 不得当通过；检查 --root）"
                             % SCAN_ROOTS_TEXT)
        for path in relevant:
            text = read_text(root, path)
            violations += rule_r1(root, path, text)
            if not path.startswith(R2_EXCLUDE):
                violations += rule_r2(root, path, text)
        violations += rule_r3(root, baseline, defs=tree_defs)
    except DeltaError as exc:
        return _emit_error(exc.code, str(exc), args.json)
    except Exception as exc:  # noqa: BLE001 —— 兜底：宁可 exit 2 也不把 bug 当绿
        return _emit_error("E_INTERNAL", "未预期异常: %s: %s" % (type(exc).__name__, exc), args.json)

    if args.json:
        print(json.dumps({"status": "VIOLATIONS" if violations else "PASS",
                          "base": base_label,
                          "changed": len(relevant),
                          "violations": [{"rule": r[0], "path": r[1], "line": r[2], "msg": r[3]}
                                         for r in violations],
                          "rules": ["R1", "R2", "R3"]}, ensure_ascii=False))
        return 1 if violations else 0

    print("ℹ️  扫描面: %s（R1/R2/R3 同一口径）" % " ".join(SCAN_ROOTS))
    print("ℹ️  变更集: %d 个相关文件；树内工具定义 %d 个（R3 对象）；基线 %d 名"
          % (len(relevant), len(tree_defs), len(baseline)))
    if violations:
        for rule, path, line, msg in violations:
            print("❌ %s: %s:%d %s" % (rule, path, line, msg))
        print("TOOL-ARGS-DELTA: VIOLATIONS %d" % len(violations))
        return 1
    print("✅ R1 新增/改动工具均有可校验 schema")
    print("✅ R2 无绕过 execute 的工具 handler 调用")
    print("✅ R3 空 schema 集合 == 基线（%d 名）" % len(baseline))
    print("TOOL-ARGS-DELTA: PASS changes=%d rules=R1,R2,R3" % len(relevant))
    return 0


if __name__ == "__main__":
    sys.exit(main())
