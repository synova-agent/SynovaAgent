#!/usr/bin/env python3
"""g12-window-impact-scan.py — G12「文件名日期窗口」缺陷的在飞 PR 影响面取数（只读）

用途（D1162 / CTO 派单 A1 §3「影响面：现网有多少在飞 PR 会因本缺陷被阻断」）:
  对每个 open PR 复算 G12 的判定结果，把违规分成两类:
    · 假红 (false_red) = 文件被「窗口外的 brief」认领，但不被任何「窗口内 brief」认领
                        ⇒ 改文件日期窗口即消失（本缺陷）
    · 真越界 (true_red) = 文件不被**任何** brief 认领
                        ⇒ 与窗口无关，是真实写集缺项（改窗口必须**仍红**）
  判据来源与生产同源: 候选池/窗口 = scripts/pre-commit-check.sh 组 12；
  路径匹配与写集解析 = scripts/control-tower/brief_parser.py（四方共用单一语义源）。

用法:
  python3 tests/control-tower/g12-window-impact-scan.py                # 自行调 gh 取 open PR
  python3 tests/control-tower/g12-window-impact-scan.py --prs prs.tsv  # 复用清单（每行: <PR号>\\t<分支名>）
  python3 tests/control-tower/g12-window-impact-scan.py --json out.json

口径与边界（诚实声明，避免"取数即事实"）:
  · 快照 = 本地 origin/* ref 的当下状态（先 `git fetch --all`）；不在 GitHub 上重算，故与 CI 实跑可能有时差。
  · 窗口 = 本地当日 UTC+8 的 今天±1（与生产 python3 date.today() 同源语义）。
  · 不判「排除项」违规（只算认领有无），故 false_red+true_red 是**下界**。
  · 不读 CI 结果，纯静态复算；CI 真实红绿以 job 日志为准（本工具用于**定位**哪一 PR 该看日志）。
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys

PARSER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts", "control-tower")
sys.path.insert(0, os.path.normpath(PARSER_DIR))
try:
    from brief_parser import parse_q2, match_path  # noqa: E402
except ImportError as e:  # pragma: no cover - 环境缺失即 fail-closed
    print("FATAL: 无法导入 brief_parser（%s）— 判据不同源，拒绝出数" % e, file=sys.stderr)
    sys.exit(2)

# 与生产 G12 python 段逐字对齐（scripts/pre-commit-check.sh 组 12）
SKIP_RE = re.compile(r'\.claude/|scripts/workflow/|\.codex/|memory/|docs/|task-state/.*\.(json|md)$|\.github/')
CODE_RE = re.compile(r'\.(ts|tsx|js|jsx|json|py|sh)$')
BRIEF_DIR = ".claude/task-briefs/"


def git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True, errors="replace").stdout


def ls_briefs(repo, rev):
    """rev 上的 brief 文件 → {仓库内路径: blob sha}"""
    out = {}
    for line in git(repo, "ls-tree", "-r", rev, "--", BRIEF_DIR).splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4 and parts[3].endswith(".md"):
            out[parts[3]] = parts[2]
    return out


def fetch_blobs(repo, shas):
    """一次 cat-file --batch 流式取全部 blob（省 subprocess；内容按 utf-8 replace）"""
    blobs = {}
    if not shas:
        return blobs
    p = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    p.stdin.write(b"".join((s + "\n").encode() for s in shas))
    p.stdin.flush()
    for s in shas:
        hdr = p.stdout.readline().decode("utf-8", "replace").split()
        if len(hdr) < 3:
            blobs[s] = ""
            continue
        n = int(hdr[2])
        blobs[s] = p.stdout.read(n).decode("utf-8", "replace")
        p.stdout.read(1)
    p.stdin.close()
    p.wait()
    return blobs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))
    ap.add_argument("--prs", help="每行 <PR号>\\t<分支名>；缺省调 gh 取 open 非草稿 PR")
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--json", help="把逐 PR 明细写到该路径")
    a = ap.parse_args()
    repo = a.repo

    if a.prs:
        prs = [l.rstrip("\n").split("\t") for l in open(a.prs, encoding="utf-8") if l.strip()]
    else:
        raw = subprocess.run(["gh", "pr", "list", "--limit", "200", "--state", "open",
                              "--json", "number,headRefName,isDraft"],
                             capture_output=True, text=True).stdout or "[]"
        prs = [[str(p["number"]), p["headRefName"]] for p in json.loads(raw) if not p.get("isDraft")]

    today = datetime.date.today()
    win = {(today + datetime.timedelta(days=k)).isoformat() for k in (-1, 0, 1)}
    main_b = ls_briefs(repo, a.base)

    branches, need = {}, set(main_b.values())
    for num, br in prs:
        rev = "origin/" + br
        if subprocess.run(["git", "-C", repo, "rev-parse", "--verify", "-q", rev],
                          capture_output=True).returncode != 0:
            continue
        b = ls_briefs(repo, rev)
        branches[num] = (br, rev, b)
        need |= set(b.values())
    blobs = fetch_blobs(repo, sorted(need))
    claim_cache = {}

    def claims(path, bmap):
        sha = bmap.get(path)
        if not sha:
            return []
        if sha not in claim_cache:
            claim_cache[sha] = parse_q2(blobs.get(sha, "")).get("include", [])
        return claim_cache[sha]

    rows = []
    for num, br in prs:
        if num not in branches:
            rows.append({"pr": num, "branch": br, "error": "本地无 origin/<branch> ref（先 git fetch --all）"})
            continue
        brn, rev, bb = branches[num]
        allb = dict(main_b)
        allb.update(bb)
        inwin = {k: v for k, v in allb.items() if os.path.basename(k)[:10] in win}
        changed = [c for c in git(repo, "diff", "--name-only", "%s...%s" % (a.base, rev)).splitlines() if c.strip()]
        code = [c for c in changed if not SKIP_RE.search(c) and CODE_RE.search(c)]

        def who(sf, pool):
            return [q for q in pool if any(match_path(sf, x) for x in claims(q, pool))]

        false_red, true_red = [], []
        for sf in code:
            if not who(sf, allb):
                true_red.append(sf)
            elif not who(sf, inwin):
                false_red.append(sf)
        rows.append({"pr": num, "branch": br, "code_files": len(code),
                     "false_red": len(false_red), "true_red": len(true_red),
                     "inwin_briefs": len(inwin), "fail_open": len(inwin) == 0,
                     "false_red_files": false_red, "true_red_files": true_red})

    scan_ts = datetime.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
    print("扫描时间戳: %s | 窗口: %s | base: %s" % (scan_ts, sorted(win), a.base))
    fr = [r for r in rows if r.get("false_red", 0) > 0]
    tr = [r for r in rows if r.get("true_red", 0) > 0]
    fo = [r for r in rows if r.get("fail_open")]
    print("扫描 PR 数: %d" % len(rows))
    print("受假红影响 PR: %d | 假红文件总数（下界）: %d" % (len(fr), sum(r.get("false_red", 0) for r in rows)))
    print("含真越界 PR: %d | 真越界文件总数（下界）: %d" % (len(tr), sum(r.get("true_red", 0) for r in rows)))
    print("fail-open PR（窗口内零 brief ⇒ G12 整段跳过，连假红都报不出）: %d" % len(fo))
    print("\n-- 假红 TOP15 --")
    for r in sorted(fr, key=lambda x: -x["false_red"])[:15]:
        print("  #%-5s %-42s 代码%2d 假红%2d 真越界%2d" % (r["pr"], r["branch"][:42], r["code_files"], r["false_red"], r["true_red"]))
    print("\n-- 含真越界 PR（改窗口后**仍应红**）--")
    for r in sorted(tr, key=lambda x: -x["true_red"])[:12]:
        print("  #%-5s %-42s 假红%2d 真越界%2d %s" % (r["pr"], r["branch"][:42], r["false_red"], r["true_red"], r["true_red_files"][:2]))
    if a.json:
        json.dump({"scan_ts": scan_ts, "window": sorted(win), "base": a.base, "rows": rows},
                  open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("\n明细已写: %s" % a.json)


if __name__ == "__main__":
    main()
