#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate_doc_contract.py — DOC-CONTRACT 三闸判据内核（D1107 首版 · D1193 判据修复+接线）

背景（D1193 修的正是 D1107 首版的三处实测缺口）:
  ① 白名单前缀优先 ⇒ §3 ❌ 点名的 coordination/ 永不触发（BLOCKED_HINTS 成死代码）
     实测: docs/synova/coordination/AUDIT-PROTOCOL.md、docs/plans/*.md 判 pass — 与契约 §3 ❌ 行相反
  ② 闸 3 只认 .md ⇒ HTML 是侧门
     （契约生效后唯一新增 html: docs/synova/coordination/四问-64格.html —— 同内容写成 md 会被拦）
  ③ 判据硬编码在脚本内，与 §3.1 自述「白名单从契约文本动态解析」不符
  ⇒ D1193: 判据全部改为**从契约机器可读块解析**，阻断**优先于**白名单，闸 3 扩到 md+html。

D1204 修的四处（K3 D1193 复核 §R2/§R3 判据逃逸，均为**独立反例实测**）:
  X1 同名兄弟前缀: `dir/**` 只匹配子树 ⇒ `docs/plans.md`（同名文件非目录）与
     `docs/synova/coordinationX/y.md` 被放行 ⇒ 阻断侧改**前缀闭包**（match_path closure=True）。
     方向性: 只给阻断侧开闭包（多拦=fail-closed）；白名单侧保持严格子树
     （放宽=漏拦，如 `docs/**` 会放过 `docs-old/`）。代价: 同前缀无关路径一并阻断，显式接受。
  X2 rename 逃逸: 闸 3 只取 `--diff-filter=A` ⇒ `git mv 既有文档 → 阻断目录` 不进清单
     ⇒ 改 `--diff-filter=ACR` 并取 `--name-status` **目标路径**（rename/copy 行的右侧/末列）。
  X3 README 索引后门: `**/README.md` 可在任意未授权新目录播种索引
     ⇒ 同址豁免（README/AGENTS/SKILL）加**同址判定**：父目录须含 ≥1 个非文档文件
     （「包/目录自己的契约文档随代码走」的原意，不是「任意新目录可用一个 README 开张」）。
  #1252 过渡表出口机器化: 出口条件从散文改为机器可判（`tracked-count:<路径模式>=<N>`），
     存量计数**动态派生**（禁双源；声明值只作为可选交叉校验，与实测不符 ⇒ 违规），
     `transition_hits` + 过渡台账落盘（默认 `.claude/doc-contract-transition.log`，JSONL 追加，已 gitignore）。

契约（铁律 47 — 先定义再实现）:
  @input  — --staged            本地: git diff --cached（pre-commit 用）
            --base <ref>        CI: git diff <ref>...HEAD（GITHUB_ACTIONS + SYNO_DIFF_BASE 场景）
            --files <路径...>   显式清单（CI/自查）
            --baseline          全量 tracked 文档跑闸 3 + 全量决策跑闸 1/2 ⇒ 出库工作清单
                                + 过渡台账**复审模式**（已达出口的行在此判红）
            --all-decisions     只全量跑闸 1/2
            --hits-out <path>   过渡台账 artifact 落点（显式指定 ⇒ 不可写即 degraded exit 2）
            --json              结构化输出
  @output — 三闸逐条结论 + 违规清单（文件:行 + 原因）+ 过渡命中统计 + 过渡表台账（存量/出口）
  @exit   — 0 = 全过；1 = 有违规（可阻断）；2 = degraded（判据源不可读 / git 不可用，fail-closed）
  @degraded — 契约三个机器可读块任一缺失/为空 ⇒ exit 2 + stderr
              过渡表出口判据缺失/不可解析/未知 kind ⇒ exit 2（出口条件必须机器可判，D1204）
              **不把「读不到」当「通过」**（铁律 11/24）
  @error  — 非 UTF-8 决策件 ⇒ 记单条违规，不中断整轮
  @seam   — SYNO_DOC_CONTRACT_ACK=1 **须同时给** SYNO_DOC_CONTRACT_ACK_REASON=<原因> 的逃生舱:
            只降级闸 3；**缺/空白 REASON ⇒ 视同未 ACK**（fail-closed，闸 3 按原判定 + stderr warning
            + 记「无效 ACK 被拒」进日志）；放行必须落 .codex/control-tower/logs/degraded-events.log，
            日志不可写 ⇒ degraded exit 2（F1，D1204）

设计哲学（沿用 D1107）: 门禁只做物理可判定的事（段在不在、路径命中不命中）。
  「取代判定对不对」「文档写得好不好」是语义判断，归 K3 与创始人，脚本不冒充。

判据来源 = docs/synova/DOC-CONTRACT.md 的三个机器可读块:
  doc-contract-whitelist   ✅ 放行前缀/精确路径（严格子树；`**/NAME` = 同址豁免，需同址有代码）
  doc-contract-blocked     ❌ 阻断清单（**优先于白名单**；`dir/**` 走前缀闭包 = 吃同名兄弟）
  doc-contract-transition  过渡放行（阻断清单的例外）: 路径 | 人读出口条件 | 责任线 |
                           机器出口判据(`tracked-count:<路径模式>=<N>`) [| 声明存量(可选,交叉校验)]
                           —— 存量**动态派生**（禁双源），"已达出口"在 --baseline 复审模式判红
"""
from __future__ import annotations

import argparse
import collections
import datetime
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

DOC_EXTS = (".md", ".markdown", ".html", ".htm")
CONTRACT_REL = "docs/synova/DOC-CONTRACT.md"
BLOCK_WL = "doc-contract-whitelist"
BLOCK_BL = "doc-contract-blocked"
BLOCK_TR = "doc-contract-transition"
DEGRADED_LOG_REL = ".codex/control-tower/logs/degraded-events.log"
TRANSITION_LOG_REL = ".claude/doc-contract-transition.log"  # 过渡台账（JSONL 追加；`.gitignore:8 *.log` 已忽略 ⇒ 不是漏提交）
FENCE = chr(96) * 3

# 过渡表出口判据（机器可判 DSL）: <kind>:<arg>=<want>
#   tracked-count  = 「匹配 <arg> 路径模式的 tracked 文件数」== <want>（出口即失效）
RE_EXIT_CHECK = re.compile(r"^(?P<kind>[a-z][a-z-]*):(?P<arg>.+)=(?P<want>-?\d+)$")
EXIT_CHECK_KINDS = ("tracked-count",)

RE_TITLE = re.compile(r"^#\s*决策[:：]\s*\S")
RE_STATUS = re.compile(r"^状态[:：]\s*(proposed|implemented|rejected|archived)\s*$")
RE_DATE = re.compile(r"^日期[:：]\s*(\d{4})-(\d{2})-(\d{2})\s*$")
SECTIONS = ["一句话", "问题", "决定", "考虑过的其他方案", "后果", "取代"]
LIFECYCLES = {"proposed", "implemented", "rejected", "archived"}


class Degraded(Exception):
    """fail-closed: 判据源不可读时不许静默放行（铁律 11/24）。"""


# ── git / IO ────────────────────────────────────────────────────────────────
def run_git(repo: str, args: List[str]) -> str:
    try:
        p = subprocess.run(
            ["git", "-C", repo, *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise Degraded("git 调用异常: %s" % exc)
    if p.returncode not in (0, 1):
        raise Degraded("git 调用失败 rc=%s: %s" % (p.returncode, (p.stderr or "").strip()[:200]))
    return p.stdout


def read_text(path: Path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        sys.stderr.write("error: %s 非 UTF-8（%s）—— 该件判违规，不中断整轮\n" % (path, exc))
        return None
    except OSError as exc:
        raise Degraded("不可读 %s: %s" % (path, exc))


# ── 判据解析（契约文本 = 唯一来源）────────────────────────────────────────────
def _extract_block(text: str, name: str) -> Optional[str]:
    m = re.search(FENCE + re.escape(name) + r"\s*\n(.*?)" + FENCE, text, re.S)
    return m.group(1) if m else None


def _parse_lines(block: str) -> List[str]:
    pats: List[str] = []
    for raw in block.splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            pats.append(line)
    return pats


def _parse_transition(block: str) -> Dict[str, Dict]:
    """过渡表四/五列解析：路径 | 人读出口条件 | 责任线 | 机器出口判据 [| 声明存量]

    列序解析策略（D1204）: 路径从**左**切第一刀（路径不含 `|`）；其余从**右**切 ——
    因为人读出口条件里会写命令（`git ls-files '...' | wc -l` 含 `|`），从右切才能容它。
    出口判据不可解析 ⇒ Degraded（出口条件必须机器可判，正是 #1252 ① 的整改点）。
    """
    out: Dict[str, Dict] = {}
    for raw in block.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        head, sep, tail = line.partition("|")
        if not sep:
            raise Degraded("过渡表行缺少字段分隔符 '|'（须 路径|出口条件|责任线|出口判据）: %r" % line[:80])
        parts = [p.strip() for p in tail.rsplit("|", 3)]
        if len(parts) < 3:
            raise Degraded("过渡表行字段不足（须 ≥4 列: 路径|出口条件|责任线|出口判据）: %r" % line[:80])
        pat = head.strip()
        exit_h, owner, check_s = parts[0], parts[1], parts[2]
        m = RE_EXIT_CHECK.match(check_s)
        if not m:
            raise Degraded(
                "过渡表出口判据不可解析（须 <kind>:<arg>=<N>，如 tracked-count:.claude/task-briefs/**=0）: %r" % check_s)
        if m.group("kind") not in EXIT_CHECK_KINDS:
            raise Degraded("过渡表出口判据 kind 未知: %s（仅支持 %s）" % (m.group("kind"), "/".join(EXIT_CHECK_KINDS)))
        if not pat:
            raise Degraded("过渡表行路径为空: %r" % line[:80])
        out[pat] = {
            "exit": exit_h,
            "owner": owner,
            "exit_check": {"kind": m.group("kind"), "arg": m.group("arg"), "want": int(m.group("want"))},
            "declared": parts[3] if len(parts) >= 4 else "",
        }
    return out


def parse_contract(repo: Path) -> Tuple[List[str], List[str], Dict[str, Dict]]:
    text = read_text(repo / CONTRACT_REL)
    if text is None:
        raise Degraded("契约件非 UTF-8: %s" % CONTRACT_REL)
    parsed: Dict[str, object] = {}
    for name in (BLOCK_WL, BLOCK_BL, BLOCK_TR):
        block = _extract_block(text, name)
        if block is None:
            raise Degraded("契约缺少机器可读块 [%s]（判据不可用，fail-closed）" % name)
        parsed[name] = _parse_transition(block) if name == BLOCK_TR else _parse_lines(block)
    wl = parsed[BLOCK_WL]
    bl = parsed[BLOCK_BL]
    tr = parsed[BLOCK_TR]
    if not wl or not bl:
        raise Degraded("契约白名单/阻断清单为空（判据不可用，fail-closed）")
    return wl, bl, tr  # type: ignore[return-value]


# ── 路径匹配（三种形态: 精确 / dir/** / **/file）─────────────────────────────
def match_path(rel: str, pat: str, closure: bool = False) -> bool:
    """路径匹配。

    closure=False（白名单 / 过渡表 / 默认）: `dir/**` = dir 自身 + **整棵子树**，不越出 dir/。
    closure=True （**仅阻断清单**）: `dir/**` 额外吃「同名前缀**文件**」`dir.<ext>` ——
      `docs/plans/**` ⊇ `docs/plans.md`（K3 §R2 X1a；旧实测放行 = P1 逃逸）。
      边界**收紧到 `.`**：`docs/plans-archive/x.md`、`docs/synova/coordinationX/y.md`
      不在自动覆盖内 —— 匹配器**不猜名字**（猜近邻会误拦合法目录 ⇒ 噪音 ⇒ 门禁被绕过，V3.9 教训）。
      命名不同的同类目录须**显式登记**进阻断清单（契约 §3 明文规则；X1b 类关闭见卡 #1261）。

    为什么只给阻断侧开闭包（方向性）:
      · 阻断侧放宽 ⇒ 多拦，fail-closed；
      · 白名单侧放宽 ⇒ 少拦，等于开后门（`docs/**` 会放过 `docs-old/`）⇒ 白名单恒为严格子树。
    为什么**过渡表也不开闭包**: 例外表应窄于它所例外的阻断条目 —— `.claude/task-briefs.md`
      不是「目录里的 brief」，仍按阻断判（fail-closed）。
    """
    if not pat:
        return False
    if pat == rel:
        return True
    if pat.endswith("/**"):
        base = pat[:-3].rstrip("/")
        if rel == base or rel.startswith(base + "/"):
            return True
        return bool(closure and base and rel.startswith(base + "."))  # 同名前缀文件（仅阻断侧）
    if pat.startswith("**/"):
        tail = pat[3:]
        return rel == tail or rel.endswith("/" + tail)
    if pat.endswith("/"):
        return rel.startswith(pat)
    return False


def is_colocation_exempt(pat: str) -> bool:
    """`**/NAME` 形态 = 「同址代码文档」豁免（README/AGENTS/SKILL 随代码走，非任意目录可播种）。"""
    return pat.startswith("**/")


def colocated_with_code(repo: Path, rel: str) -> bool:
    """同址判定（D1204/X3）: 父目录须含 ≥1 个非文档文件。

    K3 §R2 X3 独立反例: 顶层新建 `reports/README.md`（目录内仅此一份 md）被
    `**/README.md` 放行 = 「索引后门」——可在任意未授权目录用一份 README 开张。
    契约 §3 该条的原意是「包/目录自己的契约文档**随代码走**」⇒ 判定「这里有没有代码」。
    非 git 实现（看工作区实况）: 与 add/rename 次序无关；目录不存在 ⇒ 不放行（fail-closed）。
    """
    parent = rel.rsplit("/", 1)[0] if "/" in rel else ""
    d = repo / parent if parent else repo
    try:
        if not d.is_dir():
            return False
        for child in d.iterdir():
            if child.is_file() and not child.name.lower().endswith(DOC_EXTS):
                return True
    except OSError:
        return False
    return False


def classify(
    rel: str,
    whitelist: List[str],
    blocked: List[str],
    transition: Dict[str, Dict],
    repo: Path,
) -> Tuple[str, str, Dict]:
    """阻断优先于白名单（D1193 修复点①）: 先判 §3 ❌，再看过渡例外，最后才看白名单。

    D1204: 阻断侧走前缀闭包（X1）；`**/NAME` 白名单条目须同址有代码（X3）。
    """
    for pat in blocked:
        if match_path(rel, pat, closure=True):
            for tpat, meta in transition.items():
                if match_path(rel, tpat):  # 过渡例外**不**开闭包: 兄弟名不在例外内（fail-closed）
                    return "transition", tpat, meta
            return "block", pat, {}
    for pat in whitelist:
        if not match_path(rel, pat):
            continue
        if is_colocation_exempt(pat) and not colocated_with_code(repo, rel):
            continue  # 同址豁免但同址无代码（如新建空目录的 README）⇒ 继续找，找不到就判未命中
        return "allow", pat, {}
    return "block", "(未命中白名单)", {}


def block_reason(why: str) -> str:
    if why == "(未命中白名单)":
        return "不在契约 §3 白名单内（入口四份 / docs / decisions / 豁免类 / 同址 README-AGENTS-SKILL 之外）"
    return "命中契约 §3 阻断清单 %s —— D 层过程应进 PR 正文 / 卡 note / 库外档案仓（§11）" % why


# ── 变更集 ──────────────────────────────────────────────────────────────────
# D1204（K3 §R2 X2）: 一律带 `--no-renames` —— git 默认把 `git mv` 记为 R(rename)，
#   而 `--diff-filter=A` 不匹配 R ⇒ 既有文档被搬进阻断区可静默通过（实测三闸 PASS）。
#   `--no-renames` 把 R 拆成 D(旧) + A(新)，于是**新路径必然进入新增清单** ⇒ 闸 3 能拦「移入阻断区」。
#   事实边界: 闸 1/2 的可观测行为**不变** —— 其变更集本就用 `--diff-filter=ACMR`（R 已在集内，
#   `--name-only` 给出目标路径）；`--no-renames` 只影响取数形态，**没有**「闸 1/2 因此重核
#   lifecycle 目录」的副作用（D1203 决策件曾如此声称，K3 verifier 实测不成立 ⇒ 此处照事实写）。
_DIFF_COMMON = ["--name-only", "--no-renames"]


def collect_changed(repo: str, staged: bool, base: Optional[str]) -> List[str]:
    if staged:
        args = ["diff", "--cached", *_DIFF_COMMON, "--diff-filter=ACMR"]
    elif base:
        args = ["diff", *_DIFF_COMMON, "--diff-filter=ACMR", base + "...HEAD"]
    else:
        return []
    return [l for l in run_git(repo, args).splitlines() if l.strip()]


def collect_added(repo: str, staged: bool, base: Optional[str]) -> List[str]:
    """闸 3 的判据对象 = 「新入路径」（D1204/X2）。

    `--no-renames` + `--diff-filter=A` ⇒ rename 被拆成 D+A，新路径进集（见上）。
    语义边界: **M(修改) 不在清单内** —— 契约 §7「只判新增，存量不返工」不变。
    """
    if staged:
        args = ["diff", "--cached", *_DIFF_COMMON, "--diff-filter=A"]
    elif base:
        args = ["diff", *_DIFF_COMMON, "--diff-filter=A", base + "...HEAD"]
    else:
        return []
    return [l for l in run_git(repo, args).splitlines() if l.strip()]


def collect_decisions(repo: Path) -> List[str]:
    root = repo / "decisions"
    if not root.is_dir():
        return []
    return sorted(str(p.relative_to(repo)) for p in root.rglob("*.md"))


# ── 闸 1 · 格式闸 ───────────────────────────────────────────────────────────
def gate1_format(repo: Path, decision_files: List[str]) -> Dict:
    violations: List[Dict] = []
    for rel in decision_files:
        text = read_text(repo / rel)
        if text is None:
            violations.append({"file": rel, "line": 1, "reason": "非 UTF-8，无法核六段"})
            continue
        lines = [ln.rstrip("\n") for ln in text.splitlines()]
        head = [ln for ln in lines[:6] if ln.strip()]
        if len(head) < 3:
            violations.append({"file": rel, "line": 1, "reason": "头部不足三行（标题/状态/日期）"})
            continue
        if not RE_TITLE.match(head[0]):
            violations.append({"file": rel, "line": 1, "reason": "头行非 决策: 标题 形态: %s" % head[0][:40]})
        m_status = RE_STATUS.match(head[1])
        if not m_status:
            violations.append({"file": rel, "line": 2, "reason": "状态行非纯枚举（理由写引用块）: %s" % head[1][:60]})
        if not RE_DATE.match(head[2]):
            violations.append({"file": rel, "line": 3, "reason": "日期行非 YYYY-MM-DD: %s" % head[2][:40]})
        parts = rel.split("/")
        if len(parts) >= 2 and parts[0] == "decisions" and parts[1] in LIFECYCLES:
            if m_status and m_status.group(1) != parts[1]:
                violations.append({"file": rel, "line": 2,
                                   "reason": "状态 %s 与目录 %s/ 不一致" % (m_status.group(1), parts[1])})
        secs = {ln[3:].strip() for ln in lines if ln.startswith("## ")}
        for s in SECTIONS:
            if s not in secs:
                violations.append({"file": rel, "line": 0, "reason": "缺段: ## %s" % s})
    return {"pass": not violations, "violations": violations, "checked": len(decision_files)}


# ── 闸 2 · 取代闸 ───────────────────────────────────────────────────────────
def gate2_supersede(repo: Path, decision_files: List[str]) -> Dict:
    violations: List[Dict] = []
    for rel in decision_files:
        text = read_text(repo / rel)
        if text is None:
            violations.append({"file": rel, "line": 1, "reason": "非 UTF-8，无法核取代链"})
            continue
        m = re.search(r"^##\s*取代\s*$(.*?)(?=^##\s|\Z)", text, re.S | re.M)
        if not m:
            violations.append({"file": rel, "line": 0, "reason": "无 取代 段"})
            continue
        body = m.group(1)
        line_no = text[: m.start()].count("\n") + 1
        if not re.search(r"候选|grep\s", body):
            violations.append({"file": rel, "line": line_no,
                               "reason": "取代段未输出「同主题候选清单」（须含 grep 命令或 候选 二字）"})
        if not re.search(r"全部取代|部分取代|不取代|无候选", body):
            violations.append({"file": rel, "line": line_no,
                               "reason": "取代段未给判定（全部取代/部分取代/不取代/无候选 四者至少一个）"})
    return {"pass": not violations, "violations": violations, "checked": len(decision_files)}


# ── 闸 3 · 入库闸（md + html，只判新增 = 存量不返工，契约 §7）────────────────
def gate3_inbound(
    repo: Path,
    files: List[str],
    whitelist: List[str],
    blocked: List[str],
    transition: Dict[str, Dict],
) -> Dict:
    docs = [f for f in files if f.lower().endswith(DOC_EXTS)]
    violations: List[Dict] = []
    hits: "collections.Counter[str]" = collections.Counter()
    for f in docs:
        kind, why, _meta = classify(f, whitelist, blocked, transition, repo)
        if kind == "block":
            violations.append({"file": f, "line": 0, "reason": block_reason(why)})
        elif kind == "transition":
            hits[why] += 1
    return {
        "pass": not violations,
        "violations": violations,
        "checked": len(docs),
        "transition_hits": [{"pattern": k, "count": v} for k, v in sorted(hits.items())],
    }


# ── 过渡表台账（D1204/#1252: 出口条件机器化 + 存量动态派生，禁双源）──────────
def collect_tracked(repo: Path) -> Tuple[Optional[List[str]], str]:
    """全量 tracked 路径（过渡台账的**单一来源**）。

    @return (清单, 失败原因)；非 git 仓库 / 取数失败 ⇒ (None, 原因) —— 调用方
            必须**显式可见**（stderr warning + artifact 标记），不得当作"通过"。
    为什么此处不 Degraded: 台账自检不是阻断判据（闸 1-3 才是），非 git 夹具
            （`--files`/`--all-decisions` 的合成仓）不该被台账项连带 exit 2；
            真实门禁路径（pre-commit/CI）恒在 git 工作树内 ⇒ 台账恒被评估。
    """
    try:
        return ([l for l in run_git(str(repo), ["ls-files"]).splitlines() if l.strip()], "")
    except Degraded as exc:
        return (None, str(exc))


def evaluate_transition_table(
    transition: Dict[str, Dict],
    tracked: Optional[List[str]],
    tracked_err: str,
) -> Dict:
    """逐行算「动态派生存量 / 出口是否已达 / 声明值与实测是否一致」。

    判据单源（#1252 ③）: 存量**由 tracked 实况派生**，契约里不再写数（§7「数量列一律填 —」）。
    可选 `declared` 列仅作**交叉校验**: 填了就必须等于实测，否则违规（正是 K3 §R3
    的 214/215 失配 —— 声明即腐）。
    """
    rows: List[Dict] = []
    declared_violations: List[Dict] = []
    stale_rows: List[Dict] = []
    if tracked is None:
        for pat, meta in sorted(transition.items()):
            rows.append({
                "pattern": pat, "owner": meta.get("owner", ""), "exit": meta.get("exit", ""),
                "exit_check": "%s:%s=%d" % (meta["exit_check"]["kind"], meta["exit_check"]["arg"],
                                            meta["exit_check"]["want"]),
                "tracked": None, "declared": meta.get("declared", ""), "exit_met": None,
            })
        return {"evaluated": False, "reason": tracked_err, "rows": rows,
                "declared_violations": declared_violations, "stale_rows": stale_rows}
    for pat, meta in sorted(transition.items()):
        ec = meta["exit_check"]
        n = sum(1 for f in tracked if match_path(f, ec["arg"])) if ec["kind"] == "tracked-count" else -1
        exit_met = (n == ec["want"])
        declared = (meta.get("declared") or "").strip()
        row = {
            "pattern": pat, "owner": meta.get("owner", ""), "exit": meta.get("exit", ""),
            "exit_check": "%s:%s=%d" % (ec["kind"], ec["arg"], ec["want"]),
            "tracked": n, "declared": declared, "exit_met": exit_met,
        }
        if declared and declared not in ("—", "-"):
            row["declared_matches"] = (declared == str(n))
            if not row["declared_matches"]:
                declared_violations.append({
                    "row": pat,
                    "reason": "声明存量 %s ≠ 实测 %s（禁双源: 删掉声明值，存量由执行体动态派生）" % (declared, n)})
        rows.append(row)
        if exit_met:
            stale_rows.append({"row": pat, "reason":
                               "已达出口条件（%s 实测 %d == want %d）⇒ 须从契约 §9.1 移除该行（出口即失效，防「临时即永久」）"
                               % (ec["arg"], n, ec["want"])})
    return {"evaluated": True, "reason": "", "rows": rows,
            "declared_violations": declared_violations, "stale_rows": stale_rows}


def write_hits_artifact(repo: Path, path_arg: Optional[str], payload: Dict) -> Tuple[Optional[str], str]:
    """过渡台账落盘（#1252 ② / K3 §R3: `transition_hits` 之外还要「可复查载体」）。

    落点解析优先级: `--hits-out <path>` > 环境缝 `SYNO_DOC_CONTRACT_LOG` > 默认
    `<repo>/.claude/doc-contract-transition.log`。
    写入形态: **追加**一行 JSON（JSONL）—— 每轮复审取一次数，历史不丢（对账要的是趋势）。
    轮转期望: 无自动轮转；体积 ≈ 每命中一次一行，需清理时手删或接 logrotate。
    @return (落盘路径, 失败原因)
    显式 `--hits-out` = 调用方契约的一部分 ⇒ 不可写即 Degraded（fail-closed）；
    默认/环境缝落点不可写 ⇒ stderr warning（**显式可见，不静默**），不影响闸判定（对账指标 ≠ 门禁）。
    """
    env = os.environ.get("SYNO_DOC_CONTRACT_LOG", "").strip()
    if path_arg:
        target = Path(path_arg)
    elif env:
        target = Path(env)
    else:
        target = repo / TRANSITION_LOG_REL
    if not target.is_absolute():
        target = repo / target
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
    except OSError as exc:
        if path_arg:
            raise Degraded("过渡台账 artifact 不可写（--hits-out 显式指定）%s: %s" % (target, exc))
        return (None, str(exc))
    return (str(target), "")


# ── 逃生舱（铁律 11: 显式降级 + 落盘，不静默）────────────────────────────────
def _append_degraded(log: Path, record: Dict, strict: bool) -> None:
    """落 degraded-events.log。

    strict=True （**放行**路径）: 不可写 ⇒ Degraded（契约 §3：每次放行必须落盘）。
    strict=False（**拒绝**路径，如无效 ACK 被拒）: best-effort + 显式 warn（结局本就是 fail-closed 红）。
    """
    body = dict(record)
    body["time"] = datetime.datetime.now().astimezone().isoformat()
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(body, ensure_ascii=False) + "\n")
    except OSError as exc:
        if strict:
            raise Degraded("逃生舱日志不可写 %s: %s" % (DEGRADED_LOG_REL, exc))
        sys.stderr.write("warning: 无效 ACK 记录未落盘（%s）: %s\n" % (DEGRADED_LOG_REL, exc))


def apply_ack(repo: Path, gate3: Dict) -> Dict:
    """逃生舱：契约 §3 要求 `SYNO_DOC_CONTRACT_ACK=1` **须同时给** `_REASON=<原因>`。

    F1（D1204 补做；verifier 判 P1:「契约已裁决须同时给，实现缺 REASON 仍放行」）:
      · **缺/空白 REASON ⇒ 视同未 ACK**（fail-closed：闸 3 按原判定，不豁免）；
        但不静默 —— stderr 出 warning + 把「无效 ACK 被拒」记进 degraded-events.log（best-effort）。
      · 只有「ACK=1 且 REASON 非空白」才放行，且**放行必须落盘**：日志不可写 ⇒ degraded exit 2。
      · 只降级闸 3：闸 1/2 的违规不经此处（契约 §3）。
    """
    if os.environ.get("SYNO_DOC_CONTRACT_ACK", "") != "1" or gate3["pass"]:
        return gate3
    reason = os.environ.get("SYNO_DOC_CONTRACT_ACK_REASON", "").strip()
    log = repo / DEGRADED_LOG_REL
    if not reason:
        sys.stderr.write(
            "warning: SYNO_DOC_CONTRACT_ACK=1 但未给 SYNO_DOC_CONTRACT_ACK_REASON（或为空白）"
            " ⇒ 视同未 ACK（fail-closed，闸 3 按原判定；契约 §3「须同时给」）\n")
        _append_degraded(log, {
            "component": "doc-contract",
            "reason": "ACK 无效被拒（缺 SYNO_DOC_CONTRACT_ACK_REASON）: %d 件违规未被豁免"
                      % len(gate3["violations"]),
        }, strict=False)
        gate3 = dict(gate3)
        gate3["ack_rejected"] = "缺/空白 SYNO_DOC_CONTRACT_ACK_REASON ⇒ 视同未 ACK"
        return gate3
    _append_degraded(log, {
        "component": "doc-contract",
        "reason": "SYNO_DOC_CONTRACT_ACK=1 放行 %d 件: %s" % (len(gate3["violations"]), reason),
    }, strict=True)
    gate3 = dict(gate3)
    gate3["acked"] = True
    gate3["ack_reason"] = reason
    gate3["pass"] = True
    return gate3


# ── main ────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="DOC-CONTRACT 三闸校验器（D1107 首版 · D1193 判据修复+接线）")
    ap.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[2]))
    ap.add_argument("--staged", action="store_true", help="只查暂存变更（pre-commit 用）")
    ap.add_argument("--base", default=None, help="CI: 与 ref 比对（git diff ref...HEAD）")
    ap.add_argument("--files", nargs="*", default=None, help="显式新增文件清单（CI/自查）")
    ap.add_argument("--baseline", action="store_true", help="全量 tracked 文档跑闸 3（出库工作清单）")
    ap.add_argument("--all-decisions", action="store_true", help="全量决策件跑闸 1/2")
    ap.add_argument("--hits-out", default=None,
                    help="过渡台账落点（默认 %s；显式指定 ⇒ 不可写即 exit 2）" % TRANSITION_LOG_REL)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    repo = Path(a.repo_root).resolve()
    if not repo.is_dir():
        sys.stderr.write("degraded: 仓库根不可读 %s\n" % repo)
        return 2
    try:
        whitelist, blocked, transition = parse_contract(repo)
        decisions = collect_decisions(repo)
        if a.baseline:
            changed = [l for l in run_git(str(repo), ["ls-files"]).splitlines() if l.strip()]
            added = [f for f in changed if f.lower().endswith(DOC_EXTS)]
            new_decs = decisions
        elif a.files is not None:
            changed = list(a.files)
            added = [f for f in changed if f.lower().endswith(DOC_EXTS)]
            new_decs = [f for f in decisions if f in set(changed)]
        else:
            changed = collect_changed(str(repo), a.staged, a.base)
            added = collect_added(str(repo), a.staged, a.base)
            new_decs = [f for f in decisions if f in set(changed)]
        if a.all_decisions:
            new_decs = decisions
        g1 = gate1_format(repo, new_decs)
        g2 = gate2_supersede(repo, new_decs)
        g3 = gate3_inbound(repo, added, whitelist, blocked, transition)
        g3 = apply_ack(repo, g3)
        # 过渡台账: 存量动态派生 + 出口是否已达（判据源 = tracked 实况，非契约里手写的数）
        tracked, tracked_err = collect_tracked(repo)
        tt = evaluate_transition_table(transition, tracked, tracked_err)
    except Degraded as exc:
        sys.stderr.write("degraded: %s\n" % exc)
        try:
            write_hits_artifact(repo, a.hits_out, {
                "artifact": "doc-contract-transition", "conclusion": "degraded",
                "generated_at": datetime.datetime.now().astimezone().isoformat(),
                "repo": str(repo), "reason": str(exc),
            })
        except Degraded as exc2:
            sys.stderr.write("degraded: %s\n" % exc2)
        return 2

    if a.baseline:
        mode = "baseline"
    elif a.files is not None:
        mode = "files"
    elif a.staged:
        mode = "staged"
    elif a.base:
        mode = "base:" + str(a.base)
    else:
        mode = "none"
    # 出口已达的行: **复审模式（--baseline）判红**；逐 PR 模式只出 NOTE。
    #   理由: 台账是**契约自身的棘轮**（"临时即永久"防线），不是每 PR 的判据 ——
    #   把「本仓过渡行已到出口」判给不相关的夹具/分支会制造与变更无关的假红
    #   （任何 0 个 task-briefs 的合法夹具都会被连坐）。声明值≠实测（双源腐化）
    #   则**一律判红**：那是单源纪律问题，任何模式下都是错的。
    tt_violations = list(tt["declared_violations"]) + (list(tt["stale_rows"]) if a.baseline else [])
    tt["pass"] = not tt_violations
    tt["violations"] = tt_violations
    if not tt["evaluated"]:
        sys.stderr.write("warning: 过渡表出口判据未评估（非 git 工作树/取数失败）: %s\n" % tt["reason"])

    result = {
        "repo": str(repo),
        "mode": mode,
        "changed": len(changed),
        "gate1_format": g1,
        "gate2_supersede": g2,
        "gate3_inbound": g3,
        "transition_table": tt,
    }
    ok = all(result[k]["pass"] for k in ("gate1_format", "gate2_supersede", "gate3_inbound", "transition_table"))
    result["conclusion"] = "pass" if ok else "fail"

    # 落盘（#1252 ② / K3 §R3）: transition_hits + 存量/出口台账 = 复审取数的唯一载体。
    # 写入时机（保持日志精简）: 有过渡命中 / --baseline 复审 / 显式 --hits-out。
    if (g3.get("transition_hits") or a.baseline or a.hits_out) and (tt["evaluated"] or a.hits_out):
        payload = {
            "artifact": "doc-contract-transition",
            "generated_at": datetime.datetime.now().astimezone().isoformat(),
            "repo": str(repo),
            "mode": mode,
            "conclusion": result["conclusion"],
            "gate3": {"checked": g3["checked"], "violations": len(g3["violations"]),
                      "transition_hits": g3.get("transition_hits") or []},
            "transition_table": {k: tt[k] for k in ("evaluated", "reason", "rows")},
        }
        try:
            path, werr = write_hits_artifact(repo, a.hits_out, payload)
        except Degraded as exc:
            # 显式 --hits-out = 调用方契约的一部分 ⇒ 不可写 fail-closed（不许 traceback 变 rc=1 混淆三态）
            sys.stderr.write("degraded: %s\n" % exc)
            return 2
        if werr:
            sys.stderr.write("warning: 过渡台账未落盘（%s）: %s\n" % (repo / TRANSITION_LOG_REL, werr))
        result["transition_artifact"] = path

    if a.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("-- DOC-CONTRACT 三闸（机器可核，判据源=%s）%s" % (CONTRACT_REL, "-" * 12))
        for name, key in (("闸 1 · 格式闸", "gate1_format"),
                          ("闸 2 · 取代闸", "gate2_supersede"),
                          ("闸 3 · 入库闸（md+html）", "gate3_inbound")):
            g = result[key]
            mark = "PASS" if g["pass"] else "FAIL"
            print("[%s] %s  (核 %d 件)" % (mark, name, g["checked"]))
            for v in g["violations"][:20]:
                loc = "%s:%d" % (v["file"], v["line"]) if v["line"] else v["file"]
                print("       - %s -- %s" % (loc, v["reason"]))
            if len(g["violations"]) > 20:
                print("       ... 另有 %d 件（--json 取全量）" % (len(g["violations"]) - 20))
        th = result["gate3_inbound"].get("transition_hits") or []
        if th:
            print("过渡放行命中（不算违规；出口条件见契约 §9.1）:")
            for t in th:
                print("       - %s x%d" % (t["pattern"], t["count"]))
        if not tt["evaluated"]:
            print("[NOTE] 过渡台账未评估（非 git 工作树/取数失败）: %s" % tt["reason"])
        elif tt["rows"]:
            print("过渡表台账（存量=动态派生，判据源=契约 §9.1 + git ls-files）:")
            for r in tt["rows"]:
                print("       - %s  实测存量=%s  want=%s  出口%s  责任线=%s"
                      % (r["pattern"], r["tracked"],
                         r["exit_check"].rsplit("=", 1)[-1],
                         "已达" if r["exit_met"] else "未达", r["owner"]))
        if tt["violations"]:
            print("[FAIL] 过渡表台账自检")
            for v in tt["violations"]:
                print("       - %s -- %s" % (v["row"], v["reason"]))
        elif tt["stale_rows"]:
            print("[NOTE] 已达出口条件的过渡行 %d 条（--baseline 复审模式判红）: %s"
                  % (len(tt["stale_rows"]), ", ".join(v["row"] for v in tt["stale_rows"])))
        if result.get("transition_artifact"):
            print("过渡台账 artifact: %s" % result["transition_artifact"])
        if result["gate3_inbound"].get("acked"):
            print("WARNING: 逃生舱 SYNO_DOC_CONTRACT_ACK=1 已放行 —— 原因=%s（已落 degraded-events.log）"
                  % result["gate3_inbound"].get("ack_reason"))
        if result["gate3_inbound"].get("ack_rejected"):
            print("WARNING: 逃生舱 ACK 被拒（%s）—— 闸 3 按原判定（fail-closed）"
                  % result["gate3_inbound"].get("ack_rejected"))
        print("-" * 62)
        print("结论: %s" % ("PASS 三闸全过" if ok else "FAIL 有违规（exit 1）"))

    return 0 if ok else 1


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    sys.exit(main())
