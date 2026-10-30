#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ═══════════════════════════════════════════════════════════════════════════════
# check-tool-args-delta.py — 工具入参校验增量闸（#915 Q-1 · R1/R2/R3 ＋ #915 Q-5 · R4/R5/R6）
#
# 设计哲学（一句）: 工具面的「空 schema ＋ 有参 handler」与「副作用工具不可取消」都是
#   静态可判的盲区 —— 本闸只判本次变更集把它**变多还是变少**（双向棘轮），改坏必红、
#   改动之外 0 噪音。
#
# 契约（铁律 47）:
#   @input  git 仓库（--root）＋ 变更集来源（四选一，优先级从上到下）:
#              --files "<f1> <f2>"  显式变更集（测试注入缝；**整体替换**变更集，语义同
#                                  #734 PR 预算门禁的 `--files` 注入缝（:51 口径））
#              --staged            `git diff --cached`（本地 pre-commit 用）
#              --base <ref>        `git diff <merge-base(base,HEAD)>...HEAD`（CI 用）
#              皆未给 → base 解析链：$SYNO_DIFF_BASE → gitea/$TRUNK → origin/$TRUNK
#                        → $TRUNK → HEAD~1（TRUNK=$SYNO_TRUNK_REF，缺省 main；**有意偏离 #912**：
#                        集成分支在 gitea 侧，origin 可能是陈旧镜像，故 gitea 优先）
#            辅助件: --baseline <path>（默认 scripts/control-tower/tool-args-baseline.txt）
#                    --signal-baseline <path>（默认 scripts/control-tower/tool-signal-baseline.txt
#                    ＃Q-5：存量「缺取消检查副作用工具」棘轮登记面）
#   @output  stdout 逐条 ℹ️/✅/❌（❌ 必带 path:line）＋末行
#              `TOOL-ARGS-DELTA: PASS changes=<n> rules=R1,R2,R3,R4,R5,R6` ／
#              `TOOL-ARGS-DELTA: VIOLATIONS <n>` ／
#              `TOOL-ARGS-DELTA: SKIP base=<sha12>（无相关变更）`
#            --json 时 stdout 仅一份合法 JSON：
#              {status: 'PASS'|'VIOLATIONS'|'SKIP', base, changed, violations[], rules[]}
#              （与同一次文本运行同一份结论数据，不另算一遍）
#   @exit    **三态**（ctrl-tower-change 模式 1 / scripts/control-tower/AGENTS.md）:
#              0 = 通过，或**过滤后无相关代码变更 ⇒ SKIP**（同 #912 的 A1：不适用 ≠ 看不见）
#              1 = 有违规（R1–R6；含棘轮被抬／修好未删登记）
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
#   （#915 Q-5 扩展 · 裁 365 模板：同一扫描面，扩规则不新建闸）
#   R4 副作用工具必须可取消（只判变更集内三前缀的工具定义）:
#      声明 `sideEffects:'mutating'|'destructive'` 或 `operationType:'write'|'admin'` 的工具
#      ⇒ handler 必须（a）第二形参（`ctx`／`ctx?`／`_ctx`，识别锚 `,\s*_?ctx\??\s*[:,)]`）
#      且（b）体内出现 `throwIfAborted(`（`ctx?.signal?.throwIfAborted()` 命中）⇒ 红（点名
#      path:line ＋ 工具名）。
#   R5 存量信号棘轮（**全树**，同三前缀）:
#      全树「缺取消检查的副作用工具」名单 ≠ `--signal-baseline` 清单 ⇒ 双向红
#      （**多** ⇒ 新增不可取消副作用；**少** ⇒ 修好未删登记）。格式同 R3 基线。
#   R6 执行链不得丢弃 signal（只判变更集内 **`src/agent/**`** 的 `.ts`；排除
#      `src/agent/tools.ts` —— execute 本体/自调不算）:
#      `toolRegistry.execute(`／`registry.execute(` 调用参数 < 3 个 ⇒ 红（点名 path:line；
#      防链路断点：第三参 `{signal}`）。
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
#   7. **一文件一扫描**：变更文件内**所有**工具定义都参与 R1/R2/R4（不按 diff hunk 精确定位），
#      即"改了这个文件 ⇒ 这个文件的工具面全查一遍"（少漏多查，代价是多报同文件的存量问题）。
#   8. **R4/R5 是正则不是 AST**（Q-5）：`throwIfAborted(` 检查在 handler 锚点到工具块末尾的
#      跨度内查找（不精确到 handler 函数体边界）——箭头表达式体/注释里的同名文本可能误判；
#      `ctx` 第二形参只认 `, ctx`/`, ctx?`/`, _ctx` 及带类型注解形态。
#   9. **R5 只覆盖静态注册面**：与 R3 同一 `iter_tool_defs` 取数口 —— connector manifest／MCP
#      运行时装载的工具不计入（未接线工具不在扫描面，另卡处理）。
#   10. **R6 只判 `src/agent/**`**：routes shim／`src/l3`／`src/tools` 的 execute 调用不在视野
#      （第三参可选 ⇒ 向后兼容，存量 2 参调用点已核为空注册表或适配器 shim）；
#      字符串/注释里的同名调用文本可能误判。
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
# trunk 名唯一来源（#1117 §6.1）：改 trunk 名只改本契约，不在各处自造字面
TRUNK = os.environ.get("SYNO_TRUNK_REF", "").strip() or "main"
# 🔴 同一扫描面（R1/R2/R3 共用）；**不得**复用 #912 增量闸的 CODE_ROOTS（缺 vendor/）
SCAN_ROOTS = ("src/agent/", "src/tools/", "vendor/pandoc-skill/")
CODE_EXT = (".ts", ".tsx", ".js", ".mjs", ".cjs")
# R2 的唯一豁免：execute 本体就住在这里（它**必须**调 tool.handler —— 那是唯一合法调用点）
R2_EXCLUDE = ("src/agent/tools.ts",)
DEFAULT_BASELINE = "scripts/control-tower/tool-args-baseline.txt"
DEFAULT_SIGNAL_BASELINE = "scripts/control-tower/tool-signal-baseline.txt"
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
# ── Q-5 识别锚（R4/R5/R6；正则面；已知限制 8/10）──────────────────────────────
RE_HANDLER_ANCHOR = re.compile(r"handler\s*:\s*(?:async\s+)?")
# 🔴 本行的正则形态是 T21 变异体的锚（R4 恒空 ⇒ T14 场景翻绿 ⇒ 证明 R4 承重）
RE_SIDE_EFFECT = re.compile(r"sideEffects\s*:\s*'(?:mutating|destructive)'|operationType\s*:\s*'(?:write|admin)'")
RE_HANDLER_CTX = re.compile(r",\s*_?ctx\??\s*(?::[^,()]*)?[,)]")
RE_THROW_IF_ABORTED = re.compile(r"throwIfAborted\s*\(")
RE_EXECUTE_CALL = re.compile(r"\b(?:toolRegistry|registry)\.execute\s*\(")

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
    """base 解析链：$SYNO_DIFF_BASE → gitea/$TRUNK → origin/$TRUNK → $TRUNK → HEAD~1（TRUNK=$SYNO_TRUNK_REF，缺省 main）。"""
    cands = [os.environ.get("SYNO_DIFF_BASE", ""), "gitea/" + TRUNK, "origin/" + TRUNK,
             TRUNK, "HEAD~1"]
    for c in cands:
        c = (c or "").strip()
        if not c:
            continue
        p = subprocess.run(["git", "-C", root, "rev-parse", "--verify", "-q", "%s^{commit}" % c],
                           capture_output=True, text=True)
        if p.returncode == 0:
            return c
    raise DeltaError("E_BAD_BASE",
                     "base 解析链全不可解析（$SYNO_DIFF_BASE/gitea/%s/origin/%s/%s/HEAD~1）"
                     % (TRUNK, TRUNK, TRUNK))


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
def _block(text: str, open_idx: int, open_ch: str = "{") -> str:
    """从开括号起按配平取块（正则面；字符串/注释内的括号可能干扰 —— 已知限制 1）。"""
    close_ch = {"{": "}", "(": ")", "[": "]"}[open_ch]
    depth = 0
    i = open_idx
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
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
        # ── Q-5 字段（R4/R5）：副作用声明 ＋ handler 第二形参 ctx ＋ throwIfAborted 检查 ──
        side_effect = bool(RE_SIDE_EFFECT.search(block))
        has_ctx = False
        has_check = False
        ha = RE_HANDLER_ANCHOR.search(block)
        if ha:
            sig_paren = block.find("(", ha.end() - 1)
            if sig_paren >= 0:
                sig = _block(block, sig_paren, "(")
                has_ctx = bool(RE_HANDLER_CTX.search(sig))
            # 检查跨度＝handler 锚点到工具块末尾（不精确定位函数体边界 —— 已知限制 8）
            has_check = bool(RE_THROW_IF_ABORTED.search(block, ha.start()))
        out.append({
            "name": nm.group(1),
            "line": _line_of(text, open_idx + nm.start()),
            "empty_schema": empty,
            "handler_params": bool(hm),
            "handler_line": _line_of(text, open_idx + hm.start()) if hm else 0,
            "side_effect": side_effect,
            "has_ctx": has_ctx,
            "has_check": has_check,
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


def _cancel_ok(d: Dict) -> bool:
    """副作用工具「可取消」= handler 有第二形参 ctx 且体内有 throwIfAborted（R4/R5 共用谓词）。"""
    return bool(d.get("has_ctx") and d.get("has_check"))


def rule_r4(root: str, path: str, text: str) -> List[Violation]:
    """R4: 副作用工具 handler 必须 (a) 第二形参 ctx 且 (b) 体内 throwIfAborted ⇒ 否则红。"""
    out: List[Violation] = []
    for d in iter_tool_defs(text):
        if d["side_effect"] and not _cancel_ok(d):
            out.append(("R4", path, d["line"],
                        "副作用工具 %s（sideEffects mutating/destructive 或 operationType "
                        "write/admin）：handler 缺第二形参 ctx 或体内缺 throwIfAborted( —— "
                        "取消信号无法在副作用前自校" % d["name"]))
    return out


def rule_r5(root: str, signal_baseline: Dict[str, Tuple[str, int]],
            defs: Optional[List[Dict]] = None) -> List[Violation]:
    """R5: 全树「缺取消检查副作用工具」名单 ≠ --signal-baseline ⇒ 双向红（同 R3 口径）。"""
    tree_defs = scan_tree_defs(root) if defs is None else defs
    tree = {d["name"]: d for d in tree_defs if d["side_effect"] and not _cancel_ok(d)}
    tree_names = set(tree)
    base_names = set(signal_baseline)
    out: List[Violation] = []
    for name in sorted(tree_names - base_names):
        d = tree[name]
        out.append(("R5", d["path"], d["line"],
                    "缺取消检查的副作用工具「%s」未在 %s 登记（新增不可取消副作用：集合多一名）"
                    % (name, DEFAULT_SIGNAL_BASELINE)))
    for name in sorted(base_names - tree_names):
        _, lineno = signal_baseline[name]
        out.append(("R5", DEFAULT_SIGNAL_BASELINE, lineno,
                    "信号基线登记「%s」但树中已无缺取消检查的副作用工具（修好未删登记：集合少一名）"
                    % name))
    return out


def _count_args(arg_text: str) -> int:
    """数顶层实参个数（arg_text 为剥去外层括号的实参串；跨括号/方/花的逗号不算）。"""
    s = arg_text.strip()
    if not s:
        return 0
    depth = 0
    args = 1
    for ch in s:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            args += 1
    return args


def rule_r6(root: str, path: str, text: str) -> List[Violation]:
    """R6: src/agent/** 内 toolRegistry.execute/registry.execute 调用 < 3 参 ⇒ 红（防链路断点）。

    只判 `src/agent/` 前缀的 `.ts`；`src/agent/tools.ts`（execute 本体/自调）排除 —— 已知限制 10。
    """
    if not path.startswith("src/agent/") or not path.endswith(".ts") \
            or path in R2_EXCLUDE:
        return []
    out: List[Violation] = []
    for m in RE_EXECUTE_CALL.finditer(text):
        arg_text = _block(text, m.end() - 1, "(")[1:-1]
        if _count_args(arg_text) < 3:
            out.append(("R6", path, _line_of(text, m.start()),
                        "execute 调用参数 < 3 个 —— 第三参 { signal } 被丢弃（取消链路断点）"))
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
# ── Q-5 selfcheck 夹具（f4/f5；与主流程同一 rule_r4/rule_r5 函数，禁另写玩具规则）──
_SELF_F4 = """import type { ToolRegistry } from './tools';

export function registerF4(registry: ToolRegistry): void {
  registry.register({
    name: 'f4_mutating_tool',
    description: 'mutating 工具无 ctx/无取消检查 ⇒ R4 必红',
    parameters: { type: 'object', properties: { job: { type: 'string' } }, required: ['job'] },
    operationType: 'write',
    sideEffects: 'mutating',
    handler: async (params) => ({ job: params.job }),
  });
}
"""
_SELF_SIGNAL_CLEAN = """# selfcheck 信号基线（clean 夹具：树内无缺取消检查的副作用工具）
"""
_SELF_SIGNAL_F5 = """# selfcheck 信号基线（f5 夹具：登记一名树中已无者 ⇒ 修好未删登记 ⇒ R5 = 1）
f5_fixed_tool | 存量副作用工具：已修好（应删登记）
"""


def _write_fixture(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)


def cmd_selfcheck() -> int:
    """判别力自检：clean=0 / f1=1 / f2=1 / f3=1 / f4=1 / f5=1（与主流程同一 R1–R6 函数）。"""
    try:
        sandbox = tempfile.mkdtemp(prefix="tool-args-delta-selfcheck-")
    except OSError as exc:
        raise DeltaError("E_SANDBOX", "自检沙箱不可建: %s" % exc) from exc
    try:
        target = os.path.join(sandbox, "src", "agent", "builtin-tools.ts")
        base_path = os.path.join(sandbox, DEFAULT_BASELINE)
        signal_path = os.path.join(sandbox, DEFAULT_SIGNAL_BASELINE)

        # ① clean 夹具：六条规则都必须 0（防"全红"式假自检）
        _write_fixture(target, _SELF_CLEAN)
        _write_fixture(base_path, _SELF_BASELINE_CLEAN)
        _write_fixture(signal_path, _SELF_SIGNAL_CLEAN)
        clean_defs = scan_tree_defs(sandbox)
        if not clean_defs:
            raise DeltaError("E_SANDBOX", "自检沙箱工具定义数==0（信号量==0 ⇒ exit 2）")
        clean = (len(rule_r1(sandbox, "src/agent/builtin-tools.ts", _SELF_CLEAN))
                 + len(rule_r2(sandbox, "src/agent/builtin-tools.ts", _SELF_CLEAN))
                 + len(rule_r3(sandbox, load_baseline(base_path), defs=clean_defs))
                 + len(rule_r4(sandbox, "src/agent/builtin-tools.ts", _SELF_CLEAN))
                 + len(rule_r5(sandbox, load_baseline(signal_path), defs=clean_defs))
                 + len(rule_r6(sandbox, "src/agent/builtin-tools.ts", _SELF_CLEAN)))

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

        # ⑤ f4 夹具（Q-5）：mutating 工具无 ctx/无检查 ⇒ R4 恰好 1（R4 承重的判据）
        _write_fixture(target, _SELF_F4)
        f4 = len(rule_r4(sandbox, "src/agent/builtin-tools.ts", _SELF_F4))

        # ⑥ f5 夹具（Q-5）：信号基线登记树中已无者（修好未删登记）⇒ R5 恰好 1
        _write_fixture(target, _SELF_CLEAN)
        _write_fixture(signal_path, _SELF_SIGNAL_F5)
        f5 = len(rule_r5(sandbox, load_baseline(signal_path)))

        if (f1, f2, f3, f4, f5, clean) != (1, 1, 1, 1, 1, 0):
            print("SELFCHECK-FAIL f1=%d f2=%d f3=%d f4=%d f5=%d clean=%d"
                  "（期望 1/1/1/1/1/0 ⇒ 判别力不足）" % (f1, f2, f3, f4, f5, clean))
            return 1
        print("SELFCHECK-OK f1=1 f2=1 f3=1 f4=1 f5=1 clean=0")
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
                    help="base ref（默认链：$SYNO_DIFF_BASE → gitea/%s → "
                         "origin/%s → %s → HEAD~1）" % (TRUNK, TRUNK, TRUNK))
    ap.add_argument("--staged", action="store_true", help="用暂存区作为变更集（本地 pre-commit）")
    ap.add_argument("--files", default=None,
                    help='显式变更集（空格分隔；**整体替换**变更集，同 #734 PR 预算门禁 :51 口径）')
    ap.add_argument("--baseline", default=None, help="基线（默认 %s）" % DEFAULT_BASELINE)
    ap.add_argument("--signal-baseline", default=None,
                    help="信号基线（默认 %s；Q-5 R5 的存量登记面）" % DEFAULT_SIGNAL_BASELINE)
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
    signal_path = Path(root) / (args.signal_baseline or DEFAULT_SIGNAL_BASELINE)
    try:
        signal_baseline = load_baseline(str(signal_path))
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
                              "violations": [],
                              "rules": ["R1", "R2", "R3", "R4", "R5", "R6"]},
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
            violations += rule_r4(root, path, text)
            violations += rule_r6(root, path, text)
        violations += rule_r3(root, baseline, defs=tree_defs)
        violations += rule_r5(root, signal_baseline, defs=tree_defs)
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
                          "rules": ["R1", "R2", "R3", "R4", "R5", "R6"]},
                         ensure_ascii=False))
        return 1 if violations else 0

    print("ℹ️  扫描面: %s（R1–R6 同一口径；R6 只判 src/agent/**）" % " ".join(SCAN_ROOTS))
    print("ℹ️  变更集: %d 个相关文件；树内工具定义 %d 个（R3/R5 对象）；"
          "schema 基线 %d 名；信号基线 %d 名"
          % (len(relevant), len(tree_defs), len(baseline), len(signal_baseline)))
    if violations:
        for rule, path, line, msg in violations:
            print("❌ %s: %s:%d %s" % (rule, path, line, msg))
        print("TOOL-ARGS-DELTA: VIOLATIONS %d" % len(violations))
        return 1
    print("✅ R1 新增/改动工具均有可校验 schema")
    print("✅ R2 无绕过 execute 的工具 handler 调用")
    print("✅ R3 空 schema 集合 == 基线（%d 名）" % len(baseline))
    print("✅ R4 变更集内副作用工具均可取消（ctx ＋ throwIfAborted）")
    print("✅ R5 缺取消检查副作用集合 == 信号基线（%d 名）" % len(signal_baseline))
    print("✅ R6 src/agent/** 内 execute 调用均 ≥3 参（signal 未被丢弃）")
    print("TOOL-ARGS-DELTA: PASS changes=%d rules=R1,R2,R3,R4,R5,R6" % len(relevant))
    return 0


if __name__ == "__main__":
    sys.exit(main())
