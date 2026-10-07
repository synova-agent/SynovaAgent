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

契约（铁律 47 — 先定义再实现）:
  @input  — --staged            本地: git diff --cached（pre-commit 用）
            --base <ref>        CI: git diff <ref>...HEAD（GITHUB_ACTIONS + SYNO_DIFF_BASE 场景）
            --files <路径...>   显式清单（CI/自查）
            --baseline          全量 tracked 文档跑闸 3 + 全量决策跑闸 1/2 ⇒ 出库工作清单
            --all-decisions     只全量跑闸 1/2
            --json              结构化输出
  @output — 三闸逐条结论 + 违规清单（文件:行 + 原因）+ 过渡命中统计
  @exit   — 0 = 全过；1 = 有违规（可阻断）；2 = degraded（判据源不可读 / git 不可用，fail-closed）
  @degraded — 契约三个机器可读块任一缺失/为空 ⇒ exit 2 + stderr
              **不把「读不到」当「通过」**（铁律 11/24）
  @error  — 非 UTF-8 决策件 ⇒ 记单条违规，不中断整轮
  @seam   — SYNO_DOC_CONTRACT_ACK=1（+ _REASON）逃生舱: 只降级闸 3，必须落
            .codex/control-tower/logs/degraded-events.log；日志不可写 ⇒ degraded exit 2

设计哲学（沿用 D1107）: 门禁只做物理可判定的事（段在不在、路径命中不命中）。
  「取代判定对不对」「文档写得好不好」是语义判断，归 K3 与创始人，脚本不冒充。

判据来源 = docs/synova/DOC-CONTRACT.md 的三个机器可读块:
  doc-contract-whitelist   ✅ 放行前缀/精确路径
  doc-contract-blocked     ❌ 阻断清单（**优先于白名单**）
  doc-contract-transition  过渡放行（阻断清单的例外，带出口条件/责任线/起始存量）
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
TRANSITION_LOG_REL = ".claude/doc-contract-transition.log"  # .gitignore:8 `*.log` 已忽略
FENCE = chr(96) * 3

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


def _parse_transition(block: str) -> Dict[str, Dict[str, str]]:
    out: Dict[str, Dict[str, str]] = {}
    for raw in block.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        out[parts[0]] = {
            "exit": parts[1] if len(parts) > 1 else "",
            "owner": parts[2] if len(parts) > 2 else "",
            "as_of": parts[3] if len(parts) > 3 else "",
        }
    return out


def parse_contract(repo: Path) -> Tuple[List[str], List[str], Dict[str, Dict[str, str]]]:
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
    """closure=True 用于阻断/过渡条目（D1203 修 K3 X1a）:
    `docs/plans/**` 除子树外还必须命中同名前缀**文件** `docs/plans.md` ——
    否则「把过程件写成同名前缀的文件」即绕开阻断。边界收紧到 `.`：
    `docs/plans-archive/x.md` 不在覆盖内（避免误拦同类名目录 —— V3.9 噪音教训）。
    白名单不启用闭包（否则 `docs/**` 会放行根级 `docs.md`）。"""
    if not pat:
        return False
    if pat == rel:
        return True
    if pat.endswith("/**"):
        base = pat[:-3].rstrip("/")
        if rel == base or rel.startswith(base + "/"):
            return True
        return closure and rel.startswith(base + ".")
    if pat.startswith("**/"):
        tail = pat[3:]
        return rel == tail or rel.endswith("/" + tail)
    if pat.endswith("/"):
        return rel.startswith(pat)
    return False


def classify(
    rel: str,
    whitelist: List[str],
    blocked: List[str],
    transition: Dict[str, Dict[str, str]],
) -> Tuple[str, str, Dict[str, str]]:
    """阻断优先于白名单（D1193 修复点①）: 先判 §3 ❌，再看过渡例外，最后才看白名单。"""
    for pat in blocked:
        if match_path(rel, pat, closure=True):
            for tpat, meta in transition.items():
                if match_path(rel, tpat, closure=True):
                    return "transition", tpat, meta
            return "block", pat, {}
    for pat in whitelist:
        if match_path(rel, pat):
            return "allow", pat, {}
    return "block", "(未命中白名单)", {}


def block_reason(why: str) -> str:
    if why == "(未命中白名单)":
        return "不在契约 §3 白名单内（入口四份 / docs / decisions / 豁免类 / 同址 README-AGENTS-SKILL 之外）"
    return "命中契约 §3 阻断清单 %s —— D 层过程应进 PR 正文 / 卡 note / 库外档案仓（§11）" % why


# ── 变更集 ──────────────────────────────────────────────────────────────────
# D1203（K3 X2）: 一律带 --no-renames —— git 默认把 `git mv` 记为 R(rename)，
#   而 --diff-filter=A 不匹配 R ⇒ 既有文档 move 进阻断区可静默通过（实测三闸 PASS）。
#   --no-renames 把 R 拆成 D(旧) + A(新)，于是新路径必然进入变更集：
#   闸 3 因此能拦「移入阻断区」，闸 1/2 也能重核「决策件换 lifecycle 目录」。
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
    files: List[str],
    whitelist: List[str],
    blocked: List[str],
    transition: Dict[str, Dict[str, str]],
) -> Dict:
    docs = [f for f in files if f.lower().endswith(DOC_EXTS)]
    violations: List[Dict] = []
    hits: "collections.Counter[str]" = collections.Counter()
    for f in docs:
        kind, why, _meta = classify(f, whitelist, blocked, transition)
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


# ── 逃生舱（铁律 11: 显式降级 + 落盘，不静默）────────────────────────────────
def apply_ack(repo: Path, gate3: Dict) -> Dict:
    if os.environ.get("SYNO_DOC_CONTRACT_ACK", "") != "1" or gate3["pass"]:
        return gate3
    reason = os.environ.get("SYNO_DOC_CONTRACT_ACK_REASON", "").strip() or "(未填 SYNO_DOC_CONTRACT_ACK_REASON)"
    log = repo / DEGRADED_LOG_REL
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "time": datetime.datetime.now().astimezone().isoformat(),
                "component": "doc-contract",
                "reason": "SYNO_DOC_CONTRACT_ACK=1 放行 %d 件: %s" % (len(gate3["violations"]), reason),
            }, ensure_ascii=False) + "\n")
    except OSError as exc:
        raise Degraded("逃生舱日志不可写 %s: %s" % (DEGRADED_LOG_REL, exc))
    gate3 = dict(gate3)
    gate3["acked"] = True
    gate3["ack_reason"] = reason
    gate3["pass"] = True
    return gate3


def persist_transition_hits(repo: Path, gate3: Dict) -> Optional[str]:
    """把过渡命中落盘（D1203 修 K3 R3）：契约 §9.1 的「每轮复核对账」需要可取的数，
    只打印到 stdout 等于没有数据。

    @input  — repo（日志默认落 repo/.claude/doc-contract-transition.log，已 gitignore）
              SYNO_DOC_CONTRACT_LOG 可注入路径（测试沙箱）
    @output — 无命中则不写；写入则返回 None；写失败返回 warn 文案（同时写 stderr）
    @degraded — 写失败**不阻断提交**（这是对账指标，不是门禁），但必须显式 warn（铁律 11 不静默）
    """
    hits = gate3.get("transition_hits") or []
    if not hits:
        return None
    raw = os.environ.get("SYNO_DOC_CONTRACT_LOG", "")
    log = Path(raw) if raw else (repo / TRANSITION_LOG_REL)
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "time": datetime.datetime.now().astimezone().isoformat(),
                "component": "doc-contract-transition",
                "hits": hits,
            }, ensure_ascii=False) + "\n")
        return None
    except OSError as exc:
        warn = "warn: 过渡计数落盘失败（%s）—— §9.1 对账缺本次数据（不阻断提交）" % exc
        sys.stderr.write(warn + "\n")
        return warn


# ── main ────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="DOC-CONTRACT 三闸校验器（D1107 首版 · D1193 判据修复+接线）")
    ap.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[2]))
    ap.add_argument("--staged", action="store_true", help="只查暂存变更（pre-commit 用）")
    ap.add_argument("--base", default=None, help="CI: 与 ref 比对（git diff ref...HEAD）")
    ap.add_argument("--files", nargs="*", default=None, help="显式新增文件清单（CI/自查）")
    ap.add_argument("--baseline", action="store_true", help="全量 tracked 文档跑闸 3（出库工作清单）")
    ap.add_argument("--all-decisions", action="store_true", help="全量决策件跑闸 1/2")
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
        g3 = gate3_inbound(added, whitelist, blocked, transition)
        g3 = apply_ack(repo, g3)
        g3["transition_log_warn"] = persist_transition_hits(repo, g3)
    except Degraded as exc:
        sys.stderr.write("degraded: %s\n" % exc)
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
    result = {
        "repo": str(repo),
        "mode": mode,
        "changed": len(changed),
        "gate1_format": g1,
        "gate2_supersede": g2,
        "gate3_inbound": g3,
    }
    ok = all(result[k]["pass"] for k in ("gate1_format", "gate2_supersede", "gate3_inbound"))
    result["conclusion"] = "pass" if ok else "fail"

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
        if result["gate3_inbound"].get("acked"):
            print("WARNING: 逃生舱 SYNO_DOC_CONTRACT_ACK=1 已放行 —— 原因=%s（已落 degraded-events.log）"
                  % result["gate3_inbound"].get("ack_reason"))
        print("-" * 62)
        print("结论: %s" % ("PASS 三闸全过" if ok else "FAIL 有违规（exit 1）"))

    return 0 if ok else 1


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    sys.exit(main())
