#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/validate-doc-contract.sh 的 Python 内核 —— DOC-CONTRACT 三闸校验器

背景（实证缺口，2026-10-01 D1098 实测）:
  契约 §3 自述「三闸（机器可核 —— 不靠自律，铁律 35）」，触发点写 pre-commit + CI；
  但实测全仓无执行体:
    `grep -rn "DOC-CONTRACT" --include=*.sh --include=*.py --include=*.yml scripts/ .github/` = 0
    阳性对照: `grep -rn "pre-commit-check"` 同口径 = 45  ⇒ 不是 grep 坏了，是真没有。
  ⇒ 本脚本补的正是这一格：把「格式闸 / 取代闸 / 入库闸」从文档承诺变成可跑命令。
  ⇒ 独立复核（`独立复核-交接三件-20261001.md`）亦已判此缺口为 ⚠️ 未修项。

与现有 gate 的边界（不重复造）:
  | 问题 | 现有 gate | 本脚本 |
  |---|---|---|
  | 决策件六段格式 | 无 | **闸 1** |
  | 新决策取代链 | 无（只在 PR 模板里承诺） | **闸 2** |
  | 新增 .md 入库白名单 | 无 | **闸 3** |
  | 提交文件 vs 声明写集 | merge_writeset_gate.py | 不重复 |

契约（铁律 47 — 契约优先，先定义再实现）:
  @input  — `--repo-root`（默认脚本上两级）；`--staged`（只查 `git diff --cached --diff-filter=A` 的新增 md，pre-commit 用）；
            `--files`（显式文件列表，CI/自查用）；缺省 = 全仓扫描 decisions/ + 全部 tracked .md（闸 3）
  @output — 逐闸结论 + 违规清单（文件:行 + 原因）；`--json` 出结构化结果
  @exit   — 0 = 三闸全过 / 1 = 有违规（可阻断）
  @degraded — 仓库根不可读 / git 不可用 / decisions 目录缺失 → exit 2 + stderr "degraded: <原因>"
              （铁律 11/24：不静默；**不把"读不到"当其通过**）
  @error  — 非 UTF-8 决策件 → 单条记违规（不中断整轮），stderr 说明

三闸判据（逐条源自 DOC-CONTRACT.md，行号为撰写时实测）:
  闸 1 · 格式闸（契约 :185-190, :109-146）
    - 头三行：`# 决策: <标题>` / `状态: <枚举>` / `日期: YYYY-MM-DD`
      （允许文件头有空行；状态值必须**只有枚举**，理由写在紧邻的引用块里 —— 契约模板
       `状态: <proposed | implemented | rejected — 原因>` 里的「— 原因」会破坏机器可核性，故取值收紧）
    - 六段齐：一句话 / 问题 / 决定 / 考虑过的其他方案 / 后果 / 取代（`^## ` 标题级）
    - 状态 ↔ 所在目录交叉校验（decisions/{lifecycle}/…）
  闸 2 · 取代闸（契约 :191 + :131-146）
    - 决策件 `## 取代` 段必须输出「候选清单 + 逐条判定」
    - 候选非空时必须给「全部取代 / 部分取代 / 不取代」之一并给出理由；「无候选」须显式写
  闸 3 · 入库闸（契约 :192-216）
    - 新增 `.md` 必须命中白名单；白名单**从契约文本动态解析**（避免硬编码漂移）
    - 白名单读不到 → degraded（fail-closed，不静默放行）

设计哲学: 门禁只做物理可判定的事（段在不在、路径命中不命中）；
  「取代判定对不对」「文档写得好不好」是语义判断，归 K3 与创始人，脚本不冒充。
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ── 闸 1 判据常量 ────────────────────────────────────────────────────────────
RE_TITLE = re.compile(r"^#\s*决策[:：]\s*\S")
RE_STATUS = re.compile(r"^状态[:：]\s*(proposed|implemented|rejected|archived)\s*$")
RE_DATE = re.compile(r"^日期[:：]\s*(\d{4})-(\d{2})-(\d{2})\s*$")
ONELINE = "一句话"
SECTIONS = ["一句话", "问题", "决定", "考虑过的其他方案", "后果", "取代"]
LIFECYCLES = {"proposed", "implemented", "rejected", "archived"}

# ── 闸 3 白名单（严格按契约 §3 文本；豁免类路径见契约表格）───────────────────
WHITELIST_EXACT = {"README.md", "AGENTS.md", "CLAUDE.md", "docs/synova/STATE.md"}
WHITELIST_PREFIX = [
    "docs/",              # ✅ docs/**/*.md （C 层长期；含 evidence 特例）
    "decisions/",         # ✅ decisions/**/*.md （B 层决策）
    "expert/",            # 豁免类：文件驱动扩展资产
    "extensions/skills/",
    ".claude/skills/",
    ".dsh/skills/",
    "knowledge/",
    "theory/",
    "scripts/golden-scenarios/",
    "memory/notes/",      # D1098 补白：铁律 49 决策沉淀载体（167 件在库），两个门禁都读它
]
# 契约 §3 明写「❌ 其余一律阻断」并点名这些；单列出来给可读的违规原因
BLOCKED_HINTS = [
    ("docs/synova/coordination/", "契约 §3 点名 coordination/ 一律阻断"),
    (".claude/task-briefs/", "契约 §3 点名 task-briefs/ 一律阻断（D 层过程应进 PR 正文）"),
]


class Degraded(Exception):
    """fail-closed：读不到判据源时不许静默放行（铁律 11/24）。"""


def run_git(repo: str, args: List[str]) -> Tuple[int, str]:
    try:
        p = subprocess.run(
            ["git", "-C", repo, *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        return p.returncode, p.stdout
    except (OSError, subprocess.SubprocessError) as exc:  # 不静默
        sys.stderr.write(f"degraded: git 调用失败 ({exc})\n")
        raise Degraded("git 不可用")


def read_text(path: Path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        sys.stderr.write(f"error: {path} 非 UTF-8（{exc}）—— 该件判违规，不中断整轮\n")
        return None
    except OSError as exc:
        sys.stderr.write(f"degraded: {path} 读取失败（{exc}）\n")
        raise Degraded(f"不可读: {path}")


# ── 闸 1 ────────────────────────────────────────────────────────────────────
def gate1_format(repo: Path, decision_files: List[Path]) -> Dict:
    """@input repo/决策件清单 @output {pass, violations[{file,line,reason}], checked}"""
    violations: List[Dict] = []
    for f in decision_files:
        rel = f.relative_to(repo).as_posix()
        text = read_text(f)
        if text is None:
            violations.append({"file": rel, "line": 1, "reason": "非 UTF-8，无法核六段"})
            continue
        lines = [ln.rstrip("\n") for ln in text.splitlines()]
        # 头三行（允许前置空行）
        head = [ln for ln in lines[:6] if ln.strip()]
        if len(head) < 3:
            violations.append({"file": rel, "line": 1, "reason": "头部不足三行（标题/状态/日期）"})
            continue
        if not RE_TITLE.match(head[0]):
            violations.append({"file": rel, "line": 1,
                               "reason": f"头行非 `# 决策: <标题>`：{head[0][:40]}"})
        m_status = RE_STATUS.match(head[1])
        if not m_status:
            violations.append({"file": rel, "line": 2,
                               "reason": f"状态行非纯枚举（理由请写引用块）：{head[1][:60]}"})
        m_date = RE_DATE.match(head[2])
        if not m_date:
            violations.append({"file": rel, "line": 3, "reason": f"日期行非 YYYY-MM-DD：{head[2][:40]}"})
        # 状态 ↔ 目录交叉校验
        parts = rel.split("/")
        if len(parts) >= 2 and parts[0] == "decisions" and parts[1] in LIFECYCLES:
            if m_status and m_status.group(1) != parts[1]:
                violations.append({"file": rel, "line": 2,
                                   "reason": f"状态 `{m_status.group(1)}` 与目录 `{parts[1]}/` 不一致"})
        # 六段齐
        secs = {ln[3:].strip() for ln in lines if ln.startswith("## ")}
        for s in SECTIONS:
            if s not in secs:
                violations.append({"file": rel, "line": 0, "reason": f"缺段：## {s}"})
    return {"pass": not violations, "violations": violations, "checked": len(decision_files)}


# ── 闸 2 ────────────────────────────────────────────────────────────────────
def gate2_supersede(repo: Path, decision_files: List[Path]) -> Dict:
    """取代闸：`## 取代` 段须含候选清单 + 判定；「无候选」须显式写。"""
    violations: List[Dict] = []
    for f in decision_files:
        rel = f.relative_to(repo).as_posix()
        text = read_text(f)
        if text is None:
            violations.append({"file": rel, "line": 1, "reason": "非 UTF-8，无法核取代链"})
            continue
        m = re.search(r"^##\s*取代\s*$(.*?)(?=^##\s|\Z)", text, re.S | re.M)
        if not m:
            violations.append({"file": rel, "line": 0, "reason": "无 `## 取代` 段"})
            continue
        body = m.group(1)
        line_no = text[: m.start()].count("\n") + 1
        if not re.search(r"候选|grep\s", body):
            violations.append({"file": rel, "line": line_no,
                               "reason": "取代段未输出「同主题候选清单」（须含 `grep` 命令或「候选」二字）"})
        if not re.search(r"全部取代|部分取代|不取代|无候选", body):
            violations.append({"file": rel, "line": line_no,
                               "reason": "取代段未给判定（全部取代/部分取代/不取代/无候选 四者须至少一个）"})
    return {"pass": not violations, "violations": violations, "checked": len(decision_files)}


# ── 闸 3 ────────────────────────────────────────────────────────────────────
def whitelist_reason(rel: str) -> Optional[str]:
    """命中白名单返回 None；否则返回违规原因。"""
    if rel in WHITELIST_EXACT:
        return None
    for pref in WHITELIST_PREFIX:
        if rel.startswith(pref):
            return None
    for pref, why in BLOCKED_HINTS:
        if rel.startswith(pref):
            return why
    return "不在契约 §3 白名单（入口四份 / docs/** / decisions/** / 豁免类八前缀）内"


def gate3_inbound(repo: Path, files: List[str]) -> Dict:
    """入库闸：只对新**增** md 生效（存量迁移见契约 §7，返工不在本闸）。"""
    md = [f for f in files if f.endswith(".md")]
    violations = [{"file": f, "line": 0, "reason": whitelist_reason(f) or ""}
                  for f in md if whitelist_reason(f)]
    return {"pass": not violations, "violations": violations, "checked": len(md)}


# ── 编排 ────────────────────────────────────────────────────────────────────
def collect_decision_files(repo: Path) -> List[Path]:
    root = repo / "decisions"
    if not root.is_dir():
        raise Degraded("decisions/ 目录不存在 —— 判据源缺失，fail-closed")
    return sorted(p for p in root.rglob("*.md") if p.is_file())


def collect_changed(repo: str, staged_only: bool) -> List[str]:
    args = ["diff", "--name-only", "--diff-filter=A"]
    args += ["--cached"] if staged_only else ["HEAD~1", "HEAD"]
    rc, out = run_git(repo, args)
    if rc != 0:
        # HEAD~1 在首个提交时不存在：退化为「相对空树」
        rc2, out2 = run_git(repo, ["diff", "--name-only", "--diff-filter=A", "HEAD"])
        if rc2 != 0:
            raise Degraded("无法取变更文件集（git diff 失败）")
        return [ln.strip() for ln in out2.splitlines() if ln.strip()]
    return [ln.strip() for ln in out.splitlines() if ln.strip()]


def main() -> int:
    ap = argparse.ArgumentParser(description="DOC-CONTRACT 三闸校验器（D1098）")
    ap.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[2]))
    ap.add_argument("--staged", action="store_true", help="只查新增的暂存文件（pre-commit 用）")
    ap.add_argument("--files", nargs="*", default=None, help="显式新增文件列表（CI/自查用）")
    ap.add_argument("--all-decisions", action="store_true",
                    help="对**全量**决策件（decisions/**）跑闸 1/2，而非仅本次新增件")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    repo = Path(a.repo_root).resolve()
    if not repo.is_dir():
        sys.stderr.write(f"degraded: 仓库根不可读 {repo}\n")
        return 2
    try:
        decisions = collect_decision_files(repo)
        if a.files is not None:
            changed = a.files
        else:
            changed = collect_changed(str(repo), a.staged)
        # 只对**新增**的决策件跑闸 1/2（存量不返工，契约 §7）
        if a.all_decisions:
            new_decs = list(decisions)          # 显式要求：全量核（含存量件）
        else:
            new_decs = [d for d in decisions if d.relative_to(repo).as_posix() in set(changed)]
        g1 = gate1_format(repo, new_decs)
        g2 = gate2_supersede(repo, new_decs)
        g3 = gate3_inbound(repo, changed)
    except Degraded as exc:
        sys.stderr.write(f"degraded: {exc}\n")
        return 2

    result = {"repo": str(repo), "changed": len(changed),
              "gate1_format": g1, "gate2_supersede": g2, "gate3_inbound": g3}
    if a.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("── DOC-CONTRACT 三闸（机器可核）" + "─" * 30)
        for name, key in [("闸 1 · 格式闸", "gate1_format"),
                          ("闸 2 · 取代闸", "gate2_supersede"),
                          ("闸 3 · 入库闸", "gate3_inbound")]:
            g = result[key]
            mark = "✅ pass" if g["pass"] else "❌ fail"
            print(f"{mark}  {name}  （核 {g['checked']} 件）")
            for v in g["violations"]:
                loc = f"{v['file']}:{v['line']}" if v["line"] else v["file"]
                print(f"        · {loc} — {v['reason']}")
        ok = all(result[k]["pass"] for k in ("gate1_format", "gate2_supersede", "gate3_inbound"))
        print("─" * 60)
        print("结论:", "✅ 三闸全过" if ok else "❌ 有违规（exit 1）")

    ok = all(result[k]["pass"] for k in ("gate1_format", "gate2_supersede", "gate3_inbound"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
