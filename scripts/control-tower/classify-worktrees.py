#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
classify-worktrees.py — 295 工作树三分类（D1071 / X30 M0.5a）

背景（X30落地启动令 §二 T3）: `.synova-wt-*` 存量 295 个，需逐个判 可合 / 需改 / 作废，
一树一行 × 4 字段（树名/判定/原因/建议动作），落 docs/synova/coordination/工作树分类-<date>.md。

**硬红线（令 §二 T3 + §六）: 本脚本只读，绝不删除/移动任何工作树或分支。**
「孤儿=0 清理」被明令禁止（会删掉未合并的交付）。

判据（复用 check-orphan-worktrees.sh 的孤儿定义，扩展为三分类）:
  - 独有提交 = `origin/main..HEAD` 的提交（origin/main 为唯一真相，铁律 0-3）
  - 实质提交 = 独有提交中剔除噪声（bypass 自动登记 / 合并刷新 / 纯 chore 对账）
  - 可合   = 实质提交 ≥1 且 工作区干净 且 与 origin/main 无冲突（merge-tree 探测）
  - 需改   = 实质提交 ≥1 但（工作区脏 或 与 origin/main 冲突）
  - 作废   = 实质提交 0 且 工作区干净（无独有交付价值）
  - 额外列 活跃/已注册：活跃 session 的工作树不建议动

契约（铁律 47）:
  @input  — --root <repo>（默认 = git-common-dir 的父目录，即主工作区）| --out <path> | --date <YYYYMMDD>
  @output — 落盘 markdown 报告（表 + 统计）；stdout 打印统计与落点
  @degraded — git 不可用 / merge-tree 不可用 / session-registry 不可读 → 显式标注，不静默
  @error  — 根目录非 git 仓 → exit 1
"""
import argparse, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

NOISE = re.compile(
    r"^(chore:\s*bypass COMMITTED 登记|chore\(D\d+\):\s*bypass 条目|merge origin/main into|"
    r"chore:\s*刷新|chore\(D\d+\):\s*记录 origin/main 刷新)")


def git(root, *args, timeout=30):
    try:
        p = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except Exception as e:  # noqa: BLE001 — 显式降级，不静默
        return 127, "", f"git 调用异常: {e}"


def common_root():
    rc, out, _ = git(".", "rev-parse", "--path-format=absolute", "--git-common-dir")
    if rc == 0 and out:
        return os.path.dirname(out)
    return None


def active_sessions(root):
    """session-registry.json: worktree 路径 → 活跃 sid（pid 非空）。不可读/无字段 → {}（降级）。"""
    p = os.path.join(root, ".codex", "control-tower", "session-registry.json")
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:  # noqa: BLE001 — 显式降级
        return None
    live = {}
    for s in data.get("sessions", []) if isinstance(data, dict) else []:
        if isinstance(s, dict) and s.get("pid") and s.get("worktree_path"):
            live[os.path.realpath(s["worktree_path"])] = str(s.get("session_id") or s.get("task_id") or "?")
    return live


def probe(wt, registered, live, self_wt):
    name = os.path.basename(wt)
    if not registered:
        return dict(name=name, wt=wt, registered=False, branch="-", head="-", when="-",
                    unique=0, substantive=0, dirty=-1, conflict=None,
                    verdict="作废", reason="未注册为 git worktree（残留目录）",
                    action="确认后归档目录（勿直接 rm，先看是否含未入库产物）")
    rc, br, _ = git(wt, "rev-parse", "--abbrev-ref", "HEAD")
    branch = br if rc == 0 else "?"
    rc, head, _ = git(wt, "rev-parse", "--short", "HEAD")
    head = head if rc == 0 else "?"
    rc, when, _ = git(wt, "log", "-1", "--format=%cI")
    when = when[:10] if rc == 0 and when else "-"
    rc, cnt, _ = git(wt, "rev-list", "--count", "origin/main..HEAD")
    unique = int(cnt) if rc == 0 and cnt.isdigit() else 0
    substantive = 0
    if unique:
        rc, subjects, _ = git(wt, "log", "--format=%s", "origin/main..HEAD")
        if rc == 0:
            substantive = sum(1 for s in subjects.splitlines() if s.strip() and not NOISE.match(s.strip()))
    rc, status, _ = git(wt, "status", "--porcelain")
    dirty = len([l for l in status.splitlines() if l.strip()]) if rc == 0 else -1
    conflict = None
    if substantive >= 1 and dirty == 0:
        rc, _, err = git(wt, "merge-tree", "--write-tree", "origin/main", "HEAD")
        if rc == 0:
            conflict = False
        elif "unknown option" in err or "usage:" in err:
            conflict = None  # 降级：git 版本不支持 merge-tree --write-tree
        else:
            conflict = True
    if substantive == 0 and dirty == 0:
        verdict, reason = "作废", f"无实质独有提交（独有 {unique} 条均为自动/刷新噪声）且工作区干净"
        action = "确认无未入库产物后回收（释放工作区）"
    elif substantive >= 1 and dirty == 0 and conflict is not True:
        verdict, reason = "可合", f"实质独有提交 {substantive} 条，工作区干净" + ("" if conflict is False else "（冲突探测降级未判）")
        action = "入合并队列：刷新 origin/main 后推 PR"
    elif substantive >= 1 and dirty > 0:
        verdict, reason = "需改", f"实质独有提交 {substantive} 条 + 未提交改动 {dirty} 项"
        action = "先处理未提交改动（提交或丢弃）再入队"
    else:
        verdict, reason = "需改", f"实质独有提交 {substantive} 条但与 origin/main 冲突"
        action = "解冲突后入队；若已过时则降作废"
    if substantive == 0 and dirty > 0:
        verdict, reason = "需改", f"无实质独有提交，但有未提交改动 {dirty} 项（可能含未入库产物）"
        action = "先甄别改动价值：有产物→提交；无→丢弃后作废"
    # 活跃标记（有活 session / 本脚本所在工作树）→ 一律不建议动手
    live_sid = (live or {}).get(os.path.realpath(wt))
    if os.path.realpath(wt) == self_wt:
        verdict, reason = "活跃", f"本脚本所在工作树（X30 启动窗在用）；原判 = {verdict}（{reason}）"
        action = "活跃中，勿动；本窗口收尾后按原判处理"
    elif live_sid:
        verdict, reason = "活跃", f"活跃 session {live_sid}；原判 = {verdict}（{reason}）"
        action = "活跃中，勿动；session 结束后按原判处理"
    return dict(name=name, wt=wt, registered=True, branch=branch, head=head, when=when,
                unique=unique, substantive=substantive, dirty=dirty, conflict=conflict,
                verdict=verdict, reason=reason, action=action)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--date", default=None)
    a = ap.parse_args()

    root = a.root or common_root()
    if not root or not os.path.isdir(os.path.join(root, ".git")):
        print("❌ 根目录不是 git 仓（用 --root 指定）", file=sys.stderr)
        return 1
    rc, _, _ = git(root, "rev-parse", "--git-dir")
    if rc != 0:
        print(f"❌ git 不可用或 {root} 非仓库 → 降级中止", file=sys.stderr)
        return 1

    rc, porcelain, _ = git(root, "worktree", "list", "--porcelain")
    registered = set()
    for line in porcelain.splitlines():
        if line.startswith("worktree "):
            registered.add(os.path.realpath(line[len("worktree "):].strip()))

    dirs = sorted(d for d in os.listdir(root) if d.startswith(".synova-wt-"))
    targets = [os.path.join(root, d) for d in dirs]
    live = active_sessions(root)
    if live is None:
        print("⚠ degraded: session-registry.json 不可读 → 活跃标记降级为「未知」", file=sys.stderr)
        live = {}
    self_wt = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = list(ex.map(lambda w: probe(w, os.path.realpath(w) in registered, live, self_wt), targets))

    from collections import Counter
    c = Counter(r["verdict"] for r in rows)
    date = a.date or subprocess.run(["date", "+%Y%m%d"], capture_output=True, text=True).stdout.strip()
    out = a.out or os.path.join(root, "docs", "synova", "coordination", f"工作树分类-{date}.md")

    lines = [
        f"# 工作树分类（可合 / 需改 / 作废）— {date}｜扫描 {len(rows)} 个（存量 295 ＋ 本启动窗新建 1）",
        "",
        "> 依据: `X30落地启动令.md` §二 T3（M0.5a）｜生成: `scripts/control-tower/classify-worktrees.py`（只读）",
        "> **红线: 本表只判不删**——令明令禁止「孤儿=0 清理」（会删掉未合并交付）。任何回收动作须人工确认后单独执行。",
        f"> 判据: 独有提交 = `origin/main..HEAD`；实质提交 = 独有提交剔除自动登记/刷新噪声；"
        f"可合 = 实质≥1 且干净且无冲突；需改 = 有实质但脏或冲突；作废 = 无实质且干净。",
        f"> 规模: 扫描到 `.synova-wt-*` **{len(rows)}** 个；git 注册工作树 {len(registered)} 个。",
        "",
        f"**统计**: 可合 {c['可合']} ｜ 需改 {c['需改']} ｜ 作废 {c['作废']} ｜ 活跃(勿动) {c['活跃']} ｜ 合计 {len(rows)}",
        "",
        "| # | 树名 | 判定 | 原因 | 建议动作 | 分支 | 独有/实质 | 脏 | 末次提交 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for i, r in enumerate(rows, 1):
        lines.append(
            f"| {i} | `{r['name']}` | {r['verdict']} | {r['reason']} | {r['action']} | "
            f"`{r['branch']}` | {r['unique']}/{r['substantive']} | {r['dirty']} | {r['when']} |")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"扫描: {len(rows)} 个工作树（注册 {len(registered)}）")
    print(f"统计: 可合 {c['可合']} ｜ 需改 {c['需改']} ｜ 作废 {c['作废']} ｜ 活跃 {c['活跃']}")
    degraded = [r for r in rows if r["dirty"] == -1]
    if degraded:
        print(f"⚠ degraded: {len(degraded)} 个无法读状态（git 异常）→ {[r['name'] for r in degraded[:5]]}", file=sys.stderr)
    print(f"落盘: {out}（{len(lines)} 行）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
