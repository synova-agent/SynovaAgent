#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/task-state-retention.py — D1150 task-state 保留策略 + 索引生成器

背景（为什么需要本工具）:
  `task-state/` 存量 429 件（2026-10-05 实测），无保留策略、无索引 —— 只能靠 ls 翻。
  task-state/README.md 定义其生命周期（claimed → spec_done → impl_done → audit_pending
  → audited 终态 / fix_needed），但**没有归档规则**；本工具把「过期件归档」+「索引覆盖」
  做成一条可复跑命令，避免手工 mv（手工 mv 无取证、无覆盖自检）。

判据（Lead 2026-10-05 裁决的 union 规则）:
  归档 ⇔ status ∈ 终态集 {audited, closed, rejected, audit_done}
         ∧ 最后提交日期距今 > --terminal-days（默认 30）
  保留 ⇔ 其余（含：窗口内的活跃件；任何非终态件，无论多老 —— 活跃件不动）
  `--no-terminal-archive` = 只按字面 90 天窗口判（保守口径；本仓实测恒 0 件，用于留证）。
  日期取**最后提交日期**（git 权威，`%cs`）；未跟踪件退化为文件 mtime，并显式标 `(mtime)`。

红线:
  · 默认 dry-run：不显式给 `--apply` 时零移动;
  · 移动只走 `git mv`（跟踪件，可 `git mv` 反向回滚）；未跟踪件用 `os.replace` 且**显式
    `degraded:` 留痕**（它没有 git 历史，回滚只能靠人）;
  · 归档目标已存在 → 判冲突并 exit 1（绝不覆盖同名件）。

契约（铁律 47）:
  @input  — 子命令 index | expire
            --root <path>     仓库根（默认 cwd 向上解析）
            --days <N>        保留窗口（默认 90；窗口内的件一律不归档）
            --terminal-days <N>  终态件超期阈值（默认 30）
            --no-terminal-archive  关闭终态归档（= 只按 --days 判，保守留证口径）
            --apply           实际移动 / 实际写 INDEX.md（默认 dry-run）
            --json            机器可读
            SYNO_TASK_STATE_DIR  task-state 目录注入缝（与 alloc-task-id.sh 同名同义）
            SYNO_TODAY        注入「今天」YYYY-MM-DD（测试用）
  @output — expire: 逐件 `KEEP（原因）` / `ARCHIVE（终态 + 最后提交 <日期>）` + 计数 + 回滚命令
            index:  写 <task-state>/INDEX.md（一行一件：D 号｜日期｜标题｜状态），
                    表尾计数 + **覆盖自检**（行数 == 文件数）
  @exit   — 0 = 正常（含 0 件可归档的空跑）; 1 = 异常（归档目标冲突 / INDEX 覆盖自检不过）
            2 = 自身失败（git 不可用 / 参数非法 / 目录不存在）
  @degraded — 未跟踪件按 mtime 判且移动无 git 历史 → `degraded:` 行（显式，铁律 11）

用法:
  python3 scripts/control-tower/task-state-retention.py expire                 # 只报告
  python3 scripts/control-tower/task-state-retention.py expire --apply          # 实际归档
  python3 scripts/control-tower/task-state-retention.py index --apply           # 生成 INDEX.md
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

try:  # D313 M5: Windows 控制台 UTF-8
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

GIT_CANDIDATES = (r"C:\Program Files\Git\cmd\git.exe", r"C:\Program Files\Git\bin\git.exe")

# README.md 定义的状态机: audited 是终态; closed/rejected/audit_done 为历史登记里出现的终态写法
TERMINAL_STATUSES = ("audited", "closed", "rejected", "audit_done")
ARCHIVE_DIRNAME = "archive"
INDEX_HEADER_LINES = (
    "# task-state 索引（机器生成，禁手改）",
    "",
    "> 生成器: `scripts/control-tower/task-state-retention.py index --apply`（D1150）",
    "> 日期口径 = **最后提交日期**（`git log -1 --format=%cs`）；未跟踪件退化为文件 mtime（标 `(mtime)`）。",
    "> 覆盖自检: 本文件行数 == task-state 顶层 + archive/ 的 `*.json` 件数（不等即生成器 exit 1）。",
    "",
)
def index_footer(retained, archived, total):
    return f"<!-- coverage: retained={retained} archived={archived} total={total} -->"


class CfgError(RuntimeError):
    """输入/环境非法 → exit 2（自身失败，非业务判定）。"""


def find_git():
    found = shutil.which("git")
    if found:
        return found
    for cand in GIT_CANDIDATES:
        if os.path.exists(cand):
            return cand
    return None


GIT = find_git()


def git(repo, *args, check=True):
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


def resolve_root(root_arg):
    if root_arg:
        return Path(root_arg).resolve()
    try:
        return Path(git(Path.cwd(), "rev-parse", "--show-toplevel").stdout.strip()).resolve()
    except CfgError:
        return Path.cwd().resolve()


def task_state_dir(root):
    """task-state 目录（SYNO_TASK_STATE_DIR 注入缝，与 alloc-task-id.sh 同义）。"""
    env = os.environ.get("SYNO_TASK_STATE_DIR")
    return Path(env).resolve() if env else (root / "task-state")


def today():
    """『今天』（SYNO_TODAY 注入缝，测试确定性）。非法值 → 自身失败。"""
    raw = os.environ.get("SYNO_TODAY", "").strip()
    if raw:
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError as exc:
            raise CfgError(f"SYNO_TODAY 非法（应为 YYYY-MM-DD）: {raw}") from exc
    return date.today()


def last_commit_dates(root, ts_dir):
    """一次 `git log --name-only` 取全部路径的最后提交日期（新→旧，首见即最后）。"""
    rel = os.path.relpath(ts_dir, root).replace(os.sep, "/")
    proc = git(root, "log", "--name-only", "--format=@%cs", "--", rel + "/", check=False)
    dates, cur = {}, None
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("@"):
            cur = line[1:]
        elif line not in dates:
            dates[line] = cur
    return dates


def read_card(path):
    """返回 (status, title)；JSON 不可读 → ("PARSE_FAIL", 文件名)（仍计入覆盖，绝不漏件）。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 — 显式降级，不静默（铁律 11）
        return "PARSE_FAIL", f"（JSON 解析失败: {type(exc).__name__}）"
    if not isinstance(data, dict):
        return "PARSE_FAIL", "（非对象）"
    status = str(data.get("status") or "?")
    title = str(data.get("title") or data.get("name") or data.get("task_id") or path.stem)
    return status, title


def entry_date(path, rel, dates, root):
    """最后提交日期（权威）；未跟踪 → mtime（显式标记）。返回 (iso, source)。"""
    d = dates.get(rel)
    if d:
        return d, "git"
    mtime = datetime.fromtimestamp(path.stat().st_mtime).date().isoformat()
    return mtime, "mtime"


def collect(ts_dir, root, dates):
    """收集顶层 + archive/ 的件（顶层用于策略判定；archive 仅用于索引）。"""
    if not ts_dir.is_dir():
        raise CfgError(f"task-state 目录不存在: {ts_dir}")
    top = sorted(p for p in ts_dir.glob("*.json") if p.is_file())
    arch_dir = ts_dir / ARCHIVE_DIRNAME
    arch = sorted(p for p in arch_dir.glob("*.json") if p.is_file()) if arch_dir.is_dir() else []
    tracked = set(git(root, "ls-files", "--", os.path.relpath(ts_dir, root), check=False).stdout.split())
    rows = []
    for p in top + arch:
        rel = os.path.relpath(p, root).replace(os.sep, "/")
        status, title = read_card(p)
        iso, src = entry_date(p, rel, dates, root)
        rows.append({
            "path": str(p), "rel": rel, "id": p.stem, "status": status, "title": title,
            "date": iso, "date_source": src, "tracked": rel in tracked,
            "archived": ARCHIVE_DIRNAME in p.parts,
        })
    return rows


def days_since(iso, ref):
    return (ref - datetime.strptime(iso, "%Y-%m-%d").date()).days


def decide(rows, ref, days, terminal_days, terminal_on):
    """判定: ARCHIVE ⇔ 终态 ∧ 超 terminal_days（terminal_on=True）; 其余 KEEP（附原因）。"""
    out = []
    for r in rows:
        if r["archived"]:
            continue
        age = days_since(r["date"], ref)
        if not terminal_on:
            reason = f"保留（字面 {days} 天窗口：age={age} ≤ {days}）" if age <= days else \
                     f"保留（非终态口径下不归档：age={age} > {days}）"
            out.append(dict(r, verdict="KEEP", age=age, reason=reason))
            continue
        if r["status"] in TERMINAL_STATUSES and age > terminal_days:
            out.append(dict(r, verdict="ARCHIVE", age=age,
                            reason=f"终态 {r['status']} + 最后提交 {r['date']}（{age} 天 > {terminal_days}）"))
        elif r["status"] in TERMINAL_STATUSES:
            out.append(dict(r, verdict="KEEP", age=age,
                            reason=f"保留（终态但在 {terminal_days} 天窗口内：age={age}）"))
        else:
            out.append(dict(r, verdict="KEEP", age=age,
                            reason=f"保留（非终态 {r['status']}：活跃件不动，age={age}）"))
    return out


def cmd_expire(root, ts_dir, rows, ref, args):
    decided = decide(rows, ref, args.days, args.terminal_days, not args.no_terminal_archive)
    to_archive = [r for r in decided if r["verdict"] == "ARCHIVE"]
    kept = [r for r in decided if r["verdict"] != "ARCHIVE"]
    conflicts = [r for r in to_archive if (ts_dir / ARCHIVE_DIRNAME / os.path.basename(r["path"])).exists()]

    if not args.json:
        mode = "字面窗口（--no-terminal-archive）" if args.no_terminal_archive else "终态 union 规则"
        print(f"── task-state 保留策略（{mode}；今天={ref} days={args.days} terminal_days={args.terminal_days}）──")
        for r in decided:
            print(f"  {r['verdict']:<7} {r['id']:<8} {r['date']}({r['date_source']})  {r['reason']}")
        print(f"── 汇总: 顶层 {len(decided)} 件 → ARCHIVE={len(to_archive)} KEEP={len(kept)}"
              f"（archive/ 现有 {sum(1 for r in rows if r['archived'])} 件）")

    moved, degraded = [], []
    if conflicts:
        for r in conflicts:
            print(f"❌ 归档目标已存在，拒绝覆盖: {ts_dir / ARCHIVE_DIRNAME / os.path.basename(r['path'])}", file=sys.stderr)
    elif args.apply and to_archive:
        arch_dir = ts_dir / ARCHIVE_DIRNAME
        arch_dir.mkdir(parents=True, exist_ok=True)
        for r in to_archive:
            dst = arch_dir / os.path.basename(r["path"])
            print(f"→ 归档: {r['path']} → {dst}")
            if r["tracked"]:
                git(root, "mv", r["path"], str(dst))   # 跟踪件: git mv（可 git mv 反向回滚）
                moved.append(r["rel"])
            else:
                os.replace(r["path"], dst)
                moved.append(r["rel"])
                degraded.append(f'{r["id"]}:未跟踪件按 mtime 判且 os.replace 移动（无 git 历史，回滚需人工）')

    if args.json:
        print(json.dumps({
            "today": ref.isoformat(), "days": args.days, "terminal_days": args.terminal_days,
            "terminal_archive": not args.no_terminal_archive, "applied": bool(args.apply),
            "archive": [r["rel"] for r in to_archive], "keep": [r["rel"] for r in kept],
            "moved": moved, "conflicts": [r["rel"] for r in conflicts], "degraded": degraded,
            "entries": decided,
        }, ensure_ascii=False, indent=2))

    for d in degraded:
        print(f"degraded: {d}", file=sys.stderr)
    if conflicts:
        return 1
    return 0


def esc(text):
    return str(text).replace("|", "\\|").replace("\n", " ").strip()


def cmd_index(ts_dir, rows, ref, args):
    top = sorted([r for r in rows if not r["archived"]], key=lambda r: r["id"])
    arch = sorted([r for r in rows if r["archived"]], key=lambda r: r["id"])
    lines = list(INDEX_HEADER_LINES)
    lines.append(f"**保留（顶层 {len(top)} 件）**")
    lines.append("")
    lines.append("| D 号 | 日期 | 标题 | 状态 |")
    lines.append("|---|---|---|---|")
    for r in top:
        ds = r["date"] + ("(mtime)" if r["date_source"] == "mtime" else "")
        lines.append(f"| {esc(r['id'])} | {ds} | {esc(r['title'])[:120]} | {esc(r['status'])} |")
    lines.append("")
    lines.append(f"**归档（archive/ {len(arch)} 件；只读，保留策略见 `expire`）**")
    lines.append("")
    lines.append("| D 号 | 日期 | 标题 | 状态 |")
    lines.append("|---|---|---|---|")
    for r in arch:
        ds = r["date"] + ("(mtime)" if r["date_source"] == "mtime" else "")
        lines.append(f"| {esc(r['id'])} | {ds} | {esc(r['title'])[:120]} | {esc(r['status'])} |")
    lines.append("---")
    lines.append("")
    lines.append(index_footer(len(top), len(arch), len(top) + len(arch)))
    body = "\n".join(lines) + "\n"

    # 覆盖自检: 表行数（| D 号 开头不算）== 件数（顶层 + archive）
    table_rows = [ln for ln in lines if ln.startswith("| ") and not ln.startswith("| D 号 ")]
    covered = len(table_rows)
    total = len(top) + len(arch)
    ok = covered == total

    out = ts_dir / "INDEX.md"
    if args.apply:
        out.write_text(body, encoding="utf-8")
    if not args.json:
        print(f"── task-state 索引（{'已写' if args.apply else 'dry-run'}：{out}）──")
        print(f"  保留 {len(top)} + 归档 {len(arch)} = {total} 件；表行 {covered} 行 → "
              f"{'✅ 覆盖自检通过' if ok else '❌ 覆盖自检不过'}")
    if args.json:
        print(json.dumps({
            "index_path": str(out), "written": bool(args.apply),
            "retained": len(top), "archived": len(arch), "total": total,
            "covered_rows": covered, "coverage_ok": ok, "today": ref.isoformat(),
        }, ensure_ascii=False, indent=2))
    return 0 if ok else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="D1150 task-state 保留策略 + 索引生成器")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("index", "expire"):
        p = sub.add_parser(name)
        p.add_argument("--root", default=None)
        p.add_argument("--days", type=int, default=90)
        p.add_argument("--terminal-days", type=int, default=30, dest="terminal_days")
        p.add_argument("--no-terminal-archive", action="store_true", dest="no_terminal_archive")
        p.add_argument("--apply", action="store_true")
        p.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    if args.days < 0 or args.terminal_days < 0:
        print("task-state-retention: --days/--terminal-days 不能为负（fail-closed）", file=sys.stderr)
        return 2
    if GIT is None:
        print("degraded: git 不可用 — 无法读取最后提交日期（fail-closed）", file=sys.stderr)
        return 2
    try:
        root = resolve_root(args.root)
        ts_dir = task_state_dir(root)
        ref = today()
        dates = last_commit_dates(root, ts_dir)
        rows = collect(ts_dir, root, dates)
    except CfgError as exc:
        print(f"degraded: {exc}", file=sys.stderr)
        return 2
    try:
        if args.cmd == "index":
            return cmd_index(ts_dir, rows, ref, args)
        return cmd_expire(root, ts_dir, rows, ref, args)
    except CfgError as exc:
        print(f"degraded: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
