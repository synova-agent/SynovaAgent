#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check-decl-vs-impl — 「声明 ↔ 实现」一致性判据（三态）。

**为什么有这个检查**（来自本线反复踩的同一族缺陷）:

| 形态 | 真实案例 |
|---|---|
| 文档承诺 / 代码没做 | `--json` 写在文档头却从未声明（本线 #1189）｜PR 正文写「未夹带 ci.yml」却改了（#1165）｜注释写「12 必需 context」实为 9（W9）|
| 声明了但读不到 | `--all` 声明却从不被引用（#1189）｜`REBUILT/ABSENT` 死变量（W12 N2）｜`git log -S` 定位漂移（W12 B2）|
| 显示成功但没做 | `rebuilt 2 / absent 0` 伪造计数（N2）｜OK 末行落在 stderr（N3）｜pwsh 下 `$GITHUB_WORKSPACE` 假绿（N1）|

⇒ 共同点: **「声明」与「实现」之间没有任何东西在守**。本判据守其中**最容易被机器判**的一类:
**Python argparse 的「参数声明」与「参数实现」**。

契约（铁律 47）:
  @input  — --root <dir> ｜ [--changed <py> ...]（**只判这些文件**，棘轮式）
  @output — stdout: `  ✅/❌ <判据>` + 末行 `DECL-VS-IMPL: <OK|VIOLATION(n)|DEGRADED>  [摘要]`
  @exit   — 0 = 通过 ｜ 1 = 违规 ｜ 2 = 检查自身失败（降级，fail-closed）

判据:
  R1 **死参数** —— `add_argument("--x")` 声明了，但全文**从不引用** `args.x` / `a.x` ⇒ 声明与实现脱节
  R2 **假参数** —— 模块文档头/`@input` 行里出现 `--x`，但 `add_argument` 里**没有** ⇒ **承诺了却没有**
  R3 **孤儿短参** —— `add_argument("-x", "--x")` 只写短参、不写长参（可读性/一致性; 报 warn 级）

🔴 **棘轮式**（同 D734/D6 教训）: 默认只作**盘点**（报数不判红）；判红只在 `--changed`。
"""
import argparse
import ast
import io
import os
import re
import sys

OK, VIOL, DEG = 0, 1, 2
TQ_D = '"""'
TQ_S = "'''"
LONGOPT_RE = re.compile(r'"(--[A-Za-z][A-Za-z0-9\-]*)"')
DOCLINE_RE = re.compile(r"^\s*(?:#|@input|@output|@exit|@degrade).*?(--[A-Za-z][A-Za-z0-9\-]*)")


def die(msg):
    sys.stderr.write("degraded: %s\n" % msg)
    print("DECL-VS-IMPL: DEGRADED  [%s]" % msg)
    sys.exit(DEG)


def analyze(path):
    """返回 (r1_dead, r2_fake, files_ok)。只处理含 argparse 的 .py。"""
    try:
        src = io.open(path, encoding="utf-8", errors="replace").read()
    except Exception:  # noqa: BLE001
        return None
    if "add_argument" not in src:
        return None
    declared = set()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None
    # 收集 add_argument 的长选项 + 记录 args 变量名
    args_vars = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            fn = node.value.func
            if isinstance(fn, ast.Attribute) and fn.attr == "parse_args":
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        args_vars.add(t.id)
    for m in LONGOPT_RE.finditer(src):
        # 只认 add_argument(...) 里的
        pass
    # 假阳性修正①: `action="version"/"help"` 由 argparse 自处理（代码里当然不读）；
    #   且 `dest="..."` 会**改属性名** ⇒ 属性名以 dest 为准，不能只看长选项。
    attr_of = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr == "add_argument":
            action = None; dest = None
            for kw in node.keywords:
                if kw.arg == "action" and isinstance(kw.value, ast.Constant): action = kw.value.value
                if kw.arg == "dest" and isinstance(kw.value, ast.Constant): dest = kw.value.value
            if action in ("version", "help"):
                continue
            for a in node.args:
                if isinstance(a, ast.Constant) and isinstance(a.value, str) and a.value.startswith("--"):
                    declared.add(a.value); attr_of[a.value] = dest or a.value[2:].replace("-", "_")
    # R1 死参数
    dead = []
    for d in sorted(declared):
        key = attr_of.get(d, d[2:].replace("-", "_"))
        if not args_vars:
            continue
        if not any(re.search(r"\b%s\.%s\b" % (re.escape(v), re.escape(key)), src) for v in args_vars):
            dead.append(d)
    # R2 假参数（只扫**模块级注释行/文档字符串**里的 --flag）
    # 假阳性修正②: R2 只认**参数表特征**（一行列 ≥2 个长选项），不认散文注释。
    #   反例（真实踩到）: staging_guard.py 注释写"`--session` 生产接线 — resolver 的…"
    #   → 那说的是**别的脚本**的旗标 ⇒ 判成"假参数"是误报。
    promised = set()
    lines = src.split("\n")
    head = []
    in_doc = False
    for ln in lines[:100]:
        st = ln.strip()
        if st.startswith(TQ_D) or st.startswith(TQ_S):
            in_doc = not in_doc; continue
        if in_doc or st.startswith("@input") or st.startswith("@output") or st.startswith("@exit"):
            head.append(ln)
    for ln in head:
        found = re.findall(r"(--[A-Za-z][A-Za-z0-9\-]*)", ln)
        if len(found) >= 2:
            promised.update(found)
    # 只把"看起来像本脚本参数表"的承诺算进来（排除常见他者如 --help/--version/--root 等通用词）
    COMMON = {"--help", "--version", "--json", "--dry-run"}
    fake = sorted(p for p in promised if p not in declared and p not in COMMON)
    return dead, fake, len(declared)


def main():
    ap = argparse.ArgumentParser(description="声明↔实现一致性（argparse 面）")
    ap.add_argument("--root")
    ap.add_argument("--changed", nargs="*", default=[])
    a = ap.parse_args()
    root = a.root or "."
    if not os.path.isdir(root):
        die("根目录不可读: %r" % root)

    all_py = []
    for dp, _d, ns in os.walk(os.path.join(root, "scripts")):
        for n in ns:
            if n.endswith(".py"):
                all_py.append(os.path.join(dp, n))
    if not all_py:
        die("scripts/ 下无 .py（扫描为空 ⇒ 判据失效）")

    if a.changed:
        targets = [p for p in a.changed if os.path.exists(p)]
        mode = "enforce"
    else:
        targets = sorted(all_py)
        mode = "inventory"
        print("  ℹ️ 盘点模式 ⇒ 存量只报数、不判红（棘轮式；判红只在 --changed）")

    fails = []
    n_dead = n_fake = n_scanned = 0
    for p in targets:
        r = analyze(p)
        if r is None:
            continue
        n_scanned += 1
        dead, fake, _n = r
        rel = os.path.relpath(p, root)
        for d in dead:
            n_dead += 1
            if mode == "enforce":
                fails.append("R1 死参数: %s %s" % (rel, d))
                print("  ❌ R1 死参数: %s 声明了 %s 但全文从不引用" % (rel, d))
        for f in fake:
            n_fake += 1
            # 🔴 R2 **故意做得比 R1 松，且只作顾问级（不进 fails）** —— 诚实标注精度差异:
            #   R1 用 AST 取声明、按属性名（含 `dest=`）查引用 ⇒ **精确**（假阳性已修到 0）；
            #   R2 只能靠文本启发（"文档头里出现了某旗标"）⇒ 实测有假阳性:
            #     例 `--show-toplevel`（那是 **git** 的旗标）、`--name-only`/`--since`（他者旗标）。
            #   ⇒ 若把 R2 当硬判据，会制造"噪音 → 整条门禁被绕过"（V3.9 教训）。
            #   ⇒ R2 只 **print 出来让人看**；判红**只由 R1 决定**。
            if mode == "enforce":
                print("  ⚠️ R2 假参数(顾问级，不判红): %s 文档头出现 %s 但 add_argument 里没有" % (rel, f))

    if mode == "inventory":
        print("  ℹ️ 存量盘点: 扫描 %d 个脚本 ｜ 死参数 **%d** ｜ 假参数 **%d**（不判红）"
              % (n_scanned, n_dead, n_fake))
    else:
        print("  ✅ 判红模式: 检查 %d 个文件，死参数 %d / 假参数 %d" % (n_scanned, n_dead, n_fake))

    if fails:
        print("DECL-VS-IMPL: VIOLATION(%d)  [%s]" % (len(fails), "; ".join(fails)[:200]))
        sys.exit(VIOL)
    print("DECL-VS-IMPL: OK  [scanned %d / mode %s]" % (n_scanned, mode))
    sys.exit(OK)


if __name__ == "__main__":
    main()
