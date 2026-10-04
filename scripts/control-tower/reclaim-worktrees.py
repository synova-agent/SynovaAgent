#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/reclaim-worktrees.py — D1150 worktree 回收器（分类 + 窄回收）

背景（为什么需要本工具）:
  本仓 worktree 存量实测 78→82 个（2026-10-05 实测）。既有两面都不覆盖「存量回收」:
    · `check-orphan-worktrees.sh`（只读）: 查「注册表有、目录没了」的孤儿 —— 正交;
    · `classify-worktrees.py`（D1071，**只读**，红线「绝不删除/移动任何工作树或分支」）:
      判 可合/需改/作废，供人决策 —— 其红线是不可动的契约;
    · `worktree-manager.py`（D307）: session/<sid> 的 create/finish（registry 簿记），
      不覆盖 `fix/* chore/* docs/*` 历史分支的存量回收。
  于是存量回收只剩 `rm -rf` 一条路 —— 而 rm -rf 无从回答「这棵树里还有没有未推送提交」。
  判例: 删除类动作误删 = 事故。故本工具把「取证」和「动手」放进同一次执行，且**默认只取证**。

判据（严格版，与 Lead 的 D1150 裁决一致 —— 不放宽）:
  RECLAIM（可回收）= 无未推送提交（`git log --oneline <base>..HEAD` 为空）
                     ∧ 无脏文件（`git status --porcelain` 为空）
                     ∧ 不在保护名单（主 worktree / 当前 worktree / --protect 逐条）
                     ∧ 不新鲜（最近活动 > --recent-minutes，默认 120min）
  任何一条不满足 → 保留并给分类，逐条打印证据。**不存在「差不多干净就删」的口径。**
  分类优先级 = 保护名单 > 新鲜度 > 未推送提交 > 脏文件 > RECLAIM（先安全后回收）。

红线:
  · `--apply` 只用 `git worktree remove`（**绝不 --force**）—— git 自己的安全检查是第二道闸;
  · 默认 dry-run：不显式给 `--apply` 时零删除动作;
  · 目录删除失败（权限/沙箱）→ 显式 `degraded:` 留痕 + 打印残留目录清理命令，绝不静默。

契约（铁律 47）:
  @input  — --repo <path>   仓库路径（默认 cwd 向上解析）
            --base <ref>    比较基线（默认 origin/main，回退 main → origin/HEAD → HEAD）
            --protect <path|目录名>  保护名单（可重复；主/当前 worktree 自动纳入）
            --recent-minutes <N>  新鲜度护栏（默认 120；0 = 关闭）——同僚刚建的工作树不碰
            --apply         实际回收（默认 dry-run）
            --json          机器可读
            --strict        存在 degraded（目录残留）时也判 exit 1
            SYNO_WT_BASE    等价 --base 的环境注入缝（测试用）
  @output — 逐条: `<分类>  <绝对路径>  branch=<..> head=<..> ahead=<n> dirty=<n> age=<m>min`
            分类 ∈ RECLAIM / KEEP_PROTECTED / KEEP_RECENT / KEEP_UNPUSHED / KEEP_DIRTY
                   / KEEP_ORPHAN（注册表有、目录已删 ⇒ git worktree prune，不回收）
                   / KEEP_PROBE_FAILED（逐项取证失败 ⇒ 转人工，不中断整轮）
            --apply: `→ 回收: <绝对路径>` + remove 结果 +（残留时）清理命令
            汇总: `RECLAIM=n KEEP_UNPUSHED=n KEEP_DIRTY=n KEEP_PROTECTED=n KEEP_RECENT=n`
  @exit   — 0 = 正常（含「0 件可回收」的合法空跑；--apply 全部回收，或仅「元数据已注销 +
              目录残留」的显式降级）
            1 = 异常（--apply 后目标仍在注册表 / --strict 且降级）
            2 = 自身失败（git 不可用 / 基线不可解析 / 参数非法）
  @degraded — 目录残留 → `degraded:` 行（显式，铁律 11 不静默降级）

用法（PLATFORM-CHECKLIST #1: 禁裸 python3 —— 三级探测 PYBIN = python3|python|py）:
  ${PYBIN:-python3} scripts/control-tower/reclaim-worktrees.py                              # 只分类
  ${PYBIN:-python3} scripts/control-tower/reclaim-worktrees.py --apply --protect .synova-wt-govl-line
  ${PYBIN:-python3} scripts/control-tower/reclaim-worktrees.py --json
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

try:  # D313 M5: Windows 控制台 UTF-8
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

GIT_CANDIDATES = (r"C:\Program Files\Git\cmd\git.exe", r"C:\Program Files\Git\bin\git.exe")

RECLAIM = "RECLAIM"
KEEP_UNPUSHED = "KEEP_UNPUSHED"
KEEP_DIRTY = "KEEP_DIRTY"
KEEP_PROTECTED = "KEEP_PROTECTED"
KEEP_RECENT = "KEEP_RECENT"
KEEP_ORPHAN = "KEEP_ORPHAN"              # 注册表有、目录已删 ⇒ git worktree prune 的对象（绝不"回收"）
KEEP_PROBE_FAILED = "KEEP_PROBE_FAILED"  # 逐项取证失败 ⇒ 转人工；**不中断整轮**（2026-10-05 实测教训）


class CfgError(RuntimeError):
    """输入/环境非法 → exit 2（自身失败，非业务判定）。"""


def find_git():
    """解析 git 可执行（不依赖进程 PATH 顺序，windows-compat）。None = 降级。"""
    found = shutil.which("git")
    if found:
        return found
    for cand in GIT_CANDIDATES:
        if os.path.exists(cand):
            return cand
    return None


GIT = find_git()


def git(repo, *args, check=True):
    """subprocess 调 git。check=True → 非零退出抛 CfgError（fail-closed，绝不静默）。"""
    if GIT is None:
        raise CfgError("git 不可用")
    try:
        proc = subprocess.run([GIT, *args], cwd=str(repo), check=False,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")
    except OSError as exc:
        raise CfgError(f"git 启动失败: {exc}") from exc
    if check and proc.returncode != 0:
        raise CfgError(f"git {' '.join(args)} → exit {proc.returncode}: {(proc.stderr or '').strip()[:300]}")
    return proc


def worktree_entries(repo):
    """git worktree list --porcelain → [{path, branch, head}]（空行分隔条目）。"""
    entries, cur = [], {}
    for line in git(repo, "worktree", "list", "--porcelain").stdout.splitlines():
        if not line.strip():
            if cur:
                entries.append(cur)
                cur = {}
            continue
        if line.startswith("worktree "):
            cur["path"] = line[len("worktree "):]
        elif line.startswith("branch "):
            cur["branch"] = line[len("branch "):].replace("refs/heads/", "")
        elif line.startswith("HEAD "):
            cur["head"] = line[len("HEAD "):]
    if cur:
        entries.append(cur)
    return entries


def repo_root_of(repo):
    """仓库根（主 worktree 的 toplevel）—— 保护名单与「是否在 workspace 根内」都以此为准。"""
    return Path(git(repo, "rev-parse", "--show-toplevel").stdout.strip()).resolve()


def resolve_base(repo, requested):
    """基线解析链: 显式 → origin/main → main → origin/HEAD → HEAD（全不可解析 → exit 2）。"""
    for cand in [c for c in (requested, "origin/main", "main", "origin/HEAD", "HEAD") if c]:
        rc = git(repo, "rev-parse", "--verify", "--quiet", cand, check=False)
        if rc.returncode == 0 and rc.stdout.strip():
            return cand
    raise CfgError(f"基线不可解析（尝试过 {requested}/origin/main/main/origin/HEAD/HEAD）— 请先 git fetch origin")


def protected_set(root, repo, extra):
    """保护名单 = 主 worktree + 当前 worktree + --protect 逐条（绝对路径或目录名均可）。"""
    prot = {root, Path.cwd().resolve()}
    known = {Path(e["path"]).resolve() for e in worktree_entries(repo)}
    for item in extra or []:
        cand = Path(item)
        if cand.is_absolute():
            prot.add(cand.resolve())
            continue
        hits = {p for p in known if p.name == item or str(p).endswith(os.sep + item)}
        if hits:
            prot |= hits
        else:
            prot.add((Path.cwd() / item).resolve())
    return prot


def newest_activity(path):
    """工作树最近活动时刻（epoch 秒）: 根目录自身 mtime ∪ maxdepth=1 直接子项 mtime 的最大值。

    用途 = 新鲜度护栏: 同僚刚 `git worktree add` 出来（还来不及提交/弄脏）的工作树
    在「双空」判据下**看起来完全可回收** —— 2026-10-05 实测 `.synova-wt-review-base`
    （创建于 02:25，detached）即此形态。判例: 删同事正在用的工作树 = 事故。
    故默认 120 分钟内动过的一律 KEEP_RECENT（`--recent-minutes 0` 才关闭该护栏）。
    """
    newest = path.stat().st_mtime
    try:
        with os.scandir(path) as it:
            for ent in it:
                if ent.name == ".git":
                    continue
                try:
                    m = ent.stat(follow_symlinks=False).st_mtime
                except OSError:
                    continue
                if m > newest:
                    newest = m
    except OSError:
        pass
    return newest


def classify(repo, root, base, protect, recent_minutes):
    """逐 worktree 取证并分类（证据行随行保留，供人复核）。

    分类优先级（先安全后回收）: 孤儿/取证失败 > 保护名单 > 新鲜度 > 未推送提交 > 脏文件 > RECLAIM。
    2026-10-05 实测教训: 真仓存在「注册表有、目录已删」的孤儿（`/private/tmp/mergetest-1077`），
    旧实现逐项调 git 取证时抛异常 ⇒ **整轮崩掉（rc=2），一条分类都出不来**。孤儿的正解是
    `git worktree prune`（或 `check-orphan-worktrees.sh` 报告），不是让分类器陪葬 ⇒ 改为逐项降级。
    """
    import time
    now = time.time()
    rows = []
    for e in worktree_entries(repo):
        path = Path(e["path"]).resolve()
        ahead, dirty, age_min = [], [], -1
        if not path.is_dir():
            kind = KEEP_ORPHAN
            rows.append({"kind": kind, "path": str(path), "branch": e.get("branch", "(detached)"),
                         "head": (e.get("head") or "")[:10], "ahead": 0, "dirty": 0, "age_minutes": -1,
                         "under_workspace_root": str(path).startswith(str(root) + os.sep),
                         "ahead_lines": [], "dirty_lines": [],
                         "note": "目录已删但注册项仍在 → git worktree prune（或看 check-orphan-worktrees.sh）"})
            continue
        try:
            ahead = [ln for ln in git(path, "log", "--oneline", f"{base}..HEAD", check=False).stdout.splitlines() if ln.strip()]
            dirty = [ln for ln in git(path, "status", "--porcelain", check=False).stdout.splitlines() if ln.strip()]
            age_min = int((now - newest_activity(path)) // 60)
        except (CfgError, OSError) as exc:
            rows.append({"kind": KEEP_PROBE_FAILED, "path": str(path), "branch": e.get("branch", "(detached)"),
                         "head": (e.get("head") or "")[:10], "ahead": -1, "dirty": -1, "age_minutes": -1,
                         "under_workspace_root": str(path).startswith(str(root) + os.sep),
                         "ahead_lines": [], "dirty_lines": [], "note": f"逐项取证失败（转人工，不中断整轮）: {exc}"})
            continue
        if path in protect:
            kind = KEEP_PROTECTED
        elif recent_minutes > 0 and age_min < recent_minutes:
            kind = KEEP_RECENT
        elif ahead:
            kind = KEEP_UNPUSHED
        elif dirty:
            kind = KEEP_DIRTY
        else:
            kind = RECLAIM
        rows.append({
            "kind": kind, "path": str(path), "branch": e.get("branch", "(detached)"),
            "head": (e.get("head") or "")[:10], "ahead": len(ahead), "dirty": len(dirty),
            "age_minutes": age_min, "note": "",
            "under_workspace_root": str(path).startswith(str(root) + os.sep),
            "ahead_lines": ahead, "dirty_lines": dirty,
        })
    rows.sort(key=lambda r: r["path"])
    return rows


def apply_reclaim(repo, rows):
    """只回收 RECLAIM 行。返回 (removed, residual, failed)，每步逐条打印。"""
    removed, residual, failed = [], [], []
    for r in rows:
        if r["kind"] != RECLAIM:
            continue
        path = r["path"]
        print(f"→ 回收: {path}")
        proc = git(repo, "worktree", "remove", path, check=False)
        still_registered = any(str(Path(e["path"]).resolve()) == path for e in worktree_entries(repo))
        dir_exists = Path(path).exists()
        if not still_registered:
            if dir_exists:
                print(f"  degraded: git 元数据已注销，但目录残留（权限/沙箱拒删）: {path}")
                print(f"  清理命令（需全盘写权限者执行）: rm -rf {path}")
                residual.append(path)
            else:
                print("  ✅ 回收完成（注册表 + 目录均已清）")
                removed.append(path)
        else:
            print(f"  ❌ 回收失败（仍在注册表，rc={proc.returncode}）: {(proc.stderr or '').strip()[:200]}")
            failed.append(path)
    return removed, residual, failed


def main(argv=None):
    ap = argparse.ArgumentParser(description="D1150 worktree 回收器（分类 + 窄回收，默认 dry-run）")
    ap.add_argument("--repo", default=None)
    ap.add_argument("--base", default=None)
    ap.add_argument("--protect", action="append", default=[])
    ap.add_argument("--recent-minutes", type=int, default=120, dest="recent_minutes",
                    help="新鲜度护栏: 该分钟数内动过的工作树一律 KEEP_RECENT（0 = 关闭护栏）")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--strict", action="store_true")
    args, unknown = ap.parse_known_args(argv)
    if unknown:
        print(f"reclaim-worktrees: 未知参数 {unknown}（fail-closed）", file=sys.stderr)
        return 2
    if GIT is None:
        print("degraded: git 不可用 — 无法分类 worktree（fail-closed）", file=sys.stderr)
        return 2
    try:
        start = Path(args.repo).resolve() if args.repo else Path.cwd()
        root = repo_root_of(start)
        base = resolve_base(root, args.base or os.environ.get("SYNO_WT_BASE") or "")
        protect = protected_set(root, root, args.protect)
        rows = classify(root, root, base, protect, max(0, args.recent_minutes))
    except CfgError as exc:
        print(f"degraded: {exc}", file=sys.stderr)
        return 2

    counts = {}
    for r in rows:
        counts[r["kind"]] = counts.get(r["kind"], 0) + 1

    if not args.json:
        print(f"── worktree 回收分类（repo={root} base={base} 共 {len(rows)} 个）──")
        for r in rows:
            flag = "" if r["under_workspace_root"] else "  [主 worktree 之外]"
            note = f"  ← {r['note']}" if r.get("note") else ""
            print(f"  {r['kind']:<18} {r['path']}  branch={r['branch']} head={r['head']} "
                  f"ahead={r['ahead']} dirty={r['dirty']} age={r['age_minutes']}min{flag}{note}")
        print("── 汇总: " + " ".join(f"{k}={counts[k]}" for k in sorted(counts)))

    removed, residual, failed = [], [], []
    if args.apply:
        removed, residual, failed = apply_reclaim(root, rows)

    if args.json:
        print(json.dumps({
            "repo": str(root), "base": base, "total": len(rows), "counts": counts,
            "applied": bool(args.apply), "removed": removed, "residual_dir": residual, "failed": failed,
            "worktrees": rows,
        }, ensure_ascii=False, indent=2))

    if failed:
        return 1
    if residual and args.strict:
        print(f"degraded: {len(residual)} 个目标目录残留（--strict ⇒ 判 1）", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
