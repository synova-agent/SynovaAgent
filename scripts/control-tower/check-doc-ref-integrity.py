#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check-doc-ref-integrity — D5「文档引用完整性」判据（三态）。

契约（铁律 47）:
  @input  — --root <dir> ｜ [--scope global|per-file] ｜ [--changed <md> ...] ｜ [--pattern <glob>]
  @output — stdout: `  ✅/❌/ℹ️ ...` + 末行 `DOC-REF-INTEGRITY: <OK|VIOLATION(n)|DEGRADED>  [摘要]`
  @exit   — 0 = 通过 ｜ 1 = 违规 ｜ 2 = 检查自身失败（降级，fail-closed）
  @degrade— 根不可读 / 扫描为空 ⇒ exit 2 + stderr 记原因（铁律 11: 不静默）

判据：`docs/**/*.md` 里**反引号内的仓内相对路径** ⇒ 必须真实存在。

🔴 **两个口径都要能出**（D1181 提案子问 A —— 数字取决于口径，所以口径必须是参数而不是硬编码）:
  · `--scope global`  （默认, 提案倾向 A1）: **全局去重** —— 一个路径只算一次
       语义 = "**有多少个坏引用目标**" ⇒ 直接对应"要修多少个"
  · `--scope per-file`: **按文件计** —— 同一路径在多篇里各算一次
       语义 = "**影响面有多大**"（衡量波及范围，不是工作量）
  实测（2026-10-06, main=9d8e8d18a）: global **473/1710 = 27.7%** ｜ per-file **593/4119 = 14.4%**
  （CTO 派单写 18.9% —— **三个数都不是错的，是三个口径**，故必须先定口径再定阈值。）

🔴 **棘轮式**（D1181 提案 / D734 教训）: 默认只作**盘点**（报数不判红）；判红只在 `--changed`。
   ⇒ 473~593 条存量悬空引用**不可能一次性转红**（那与"清理存量"目标相反）。
"""
import argparse
import io
import os
import re
import subprocess
import sys

OK, VIOL, DEG = 0, 1, 2
# 只认**仓内相对路径**（排除绝对路径 / ~ / 盘符）——外部路径不适用"仓内存在性"
REF_RE = re.compile(r"`((?:docs|scripts|src|tests|memory|task-state|packages|skills|expert)/"
                    r"[A-Za-z0-9._/\-\u4e00-\u9fff]+)`")


def die(msg):
    sys.stderr.write("degraded: %s\n" % msg)
    print("DOC-REF-INTEGRITY: DEGRADED  [%s]" % msg)
    sys.exit(DEG)


def walk_md_git(root, pattern):
    """🔴 用 **git ls-files**（只数**被跟踪**的文件）。

    为什么要这个口径（实测踩到）: 同一份代码我量出过**三个数** ——
      · 27.7%（473/1710）= `git ls-tree`（仅跟踪）+ 反引号正则
      · 31.2%（588/1883）= `os.walk`（**含未跟踪文件**）+ 同正则
      · 14.4%（593/4119）= `git ls-tree` + **按文件计**
    ⇒ **口径不统一 = 数字不可比 = 判据不可用**（这正是 D1181 提案要 CTO 先定的那件事）。
    ⇒ 本工具默认走**可复现**的 git 口径（`git ls-files`），并把口径打印在输出行里；
       `--untracked` 才切到 os.walk。
    """
    try:
        out = subprocess.run(["git", "-C", root, "ls-files", "docs"],
                             capture_output=True, text=True, timeout=60)
        if out.returncode != 0:
            return None
        files = [x for x in out.stdout.split("\n") if x.endswith(pattern)]
        return sorted(files) or None
    except Exception:  # noqa: BLE001
        return None


def walk_md(base, pattern):
    """返回**相对 base** 的路径。

    🔴 修（自测抓到）: 原先签名是 `walk_md(root, ...)` 且内部用 `os.path.relpath(..., root)`
    —— 调用方传的是 `<root>/docs`，于是 relpath 相对的是 **docs/**，返回 `07-xxx.md`
    这种**丢了 `docs/` 前缀**的路径 ⇒ 后面 `os.path.join(root, f)` 打开的是**另一个文件**（多半不存在）
    ⇒ 读取失败被 `except: continue` **静默吞掉** ⇒ 扫 1103 篇只数出 **18** 条引用（真值 1710）。
    **这正是"显示成功但没做"那一族**：报了个像样的数（18 条 / 0 悬空 = 0.0%），而它是错的。
    """
    out = []
    for dp, _d, ns in os.walk(base):
        if "/node_modules/" in dp or "/.git/" in dp:
            continue
        for n in ns:
            if n.endswith(pattern):
                out.append(os.path.relpath(os.path.join(dp, n), os.path.dirname(base) or ".").replace(os.sep, "/"))
    return sorted(out)


def main():
    ap = argparse.ArgumentParser(description="D5 文档引用完整性")
    ap.add_argument("--root")
    ap.add_argument("--scope", choices=["global", "per-file"], default="global")
    ap.add_argument("--changed", nargs="*", default=[])
    ap.add_argument("--pattern", default=".md")
    ap.add_argument("--untracked", action="store_true",
                    help="改用 os.walk（**含未跟踪文件**；默认走 git ls-files 的跟踪口径）")
    a = ap.parse_args()

    root = a.root
    if not root:
        try:
            root = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                                  capture_output=True, text=True, timeout=30).stdout.strip()
        except Exception as e:  # noqa: BLE001
            die("git 不可用: %s" % e)
    if not root or not os.path.isdir(root):
        die("根目录不可读: %r" % root)

    files = None
    src = ""
    if not a.untracked:
        files = walk_md_git(root, a.pattern)
        src = "git ls-files（**仅跟踪**）"
    if not files:
        files = walk_md(os.path.join(root, "docs"), a.pattern)
        src = "os.walk（**含未跟踪**）"
    if not files:
        die("docs/ 下无 %s（扫描为空 ⇒ 判据失效）" % a.pattern)
    print("  ℹ️ 文件口径: %s" % src)

    enforce = bool(a.changed)
    targets = [c.replace(os.sep, "/") for c in a.changed] if enforce else files
    if enforce and not targets:
        die("--changed 为空列表（无法判红；若想盘点请不给 --changed）")

    # 统计
    all_refs = []            # (file, ref)
    dangling = []            # (file, ref)
    unreadable = []
    for f in targets:
        try:
            txt = io.open(os.path.join(root, f), encoding="utf-8", errors="replace").read()
        except Exception as e:  # noqa: BLE001
            # 🔴 不再静默 continue（铁律 11）: 读不到的**必须计数并报出来**；
            #   正是这个静默吞错让上面那个路径 bug 藏了那么久（18 vs 1710）。
            unreadable.append("%s (%s)" % (f, e.__class__.__name__))
            continue
        # 🔴 修（自测抓到）: 上一次补丁把**抽取循环误挪进了 `if unreadable:` 块内**
        #   ⇒ 只有"有文件读不到"时才抽取 ⇒ 正常情况一条都不抽（扫 1103 篇得 **0** 条引用）。
        #   这类错同样是"显示成功但没做"：它报了个 0.0% 的漂亮数字，而它是**因为没干活**。
        for m in set(REF_RE.findall(txt)):
            all_refs.append((f, m))
            if not os.path.exists(os.path.join(root, m.rstrip("/"))):
                dangling.append((f, m))
    if unreadable:
        print("  ⚠️ 降级: %d 个文件读不到（不计入统计）: %s%s"
              % (len(unreadable), "; ".join(unreadable[:3]),
                 " …" if len(unreadable) > 3 else ""))
        if len(unreadable) > len(targets) // 2:
            die("过半文件读不到（%d/%d）⇒ 统计不可信，fail-closed" % (len(unreadable), len(targets)))

    n_ref = len({m for _f, m in all_refs}) if a.scope == "global" else len(all_refs)
    n_dan = len({m for _f, m in dangling}) if a.scope == "global" else len(dangling)
    pct = (n_dan / n_ref * 100) if n_ref else 0.0

    scope_note = ("全局去重（= 有多少个坏引用目标）" if a.scope == "global"
                  else "按文件计（= 影响面，同一路径在多篇里各算一次）")

    if not enforce:
        print("  ℹ️ 盘点模式 ⇒ 存量只报数、不判红（棘轮式；判红只在 --changed）")
        print("  ℹ️ 口径: --scope %s（%s）" % (a.scope, scope_note))
        print("  ℹ️ 存量: 引用 **%d** ｜ 悬空 **%d** = **%.1f%%**（扫描 %d 篇 docs/**/%s；读不到 %d）"
              % (n_ref, n_dan, pct, len(files), a.pattern, len(unreadable)))
        print("DOC-REF-INTEGRITY: OK  [inventory %d/%d = %.1f%% / scope %s]"
              % (n_dan, n_ref, pct, a.scope))
        sys.exit(OK)

    # 判红模式：只针对 --changed 的文件
    bad_files = sorted({f for f, _m in dangling})
    for f in bad_files:
        mine = [m for ff, m in dangling if ff == f]
        for m in sorted(set(mine))[:5]:
            print("  ❌ %s: 悬空引用 `%s`" % (f, m))
        if len(set(mine)) > 5:
            print("       … 本文件另有 %d 条悬空（已截断）" % (len(set(mine)) - 5))
    if dangling:
        print("DOC-REF-INTEGRITY: VIOLATION(%d)  [%d 个文件 / 口径 %s]"
              % (len(dangling), len(bad_files), a.scope))
        sys.exit(VIOL)
    print("  ✅ 本次涉及 %d 个文件，引用全部存在（口径 %s）" % (len(targets), a.scope))
    print("DOC-REF-INTEGRITY: OK  [checked %d / scope %s]" % (len(targets), a.scope))
    sys.exit(OK)


if __name__ == "__main__":
    main()
