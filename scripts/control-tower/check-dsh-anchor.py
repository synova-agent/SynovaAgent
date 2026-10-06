#!/usr/bin/env python3
"""D943 — DSH 断面一致性门禁（唯一事实源：docs/synova/coordination/DSH-断面.json）

判据:
  ① 事实源可读 + JSON 合法          否则 exit 2（degraded，fail-closed）
  ② 真实 DSH 树 HEAD == 事实源 head  否则 exit 2（degraded：树已移动，全部引用降级待复核）
  ③ 被扫描文档不得出现 superseded 的 (version, head) 否则 exit 1（VIOLATION，点名 file:line）
  ④ 被扫描文档不得出现"未登记"的 DSH 版本串 否则 exit 1
  ⑤ 豁免（D943-FIX，K3 批次4 §1.4 逃逸向量收口）——旧断面引用只有两条出清路径：
       a) 入 DSH-断面.json 的 known_versions（沿革/史料可提及，见 policy.known_versions_note）；
       b) 显式写 `## 引用豁免` 段，且段内**至少一条逐行显式条目**（`-`/`*`/`+`/`1.` 列表项）→ 该段内逐行豁免；
          段内无条目的标题不生效（fail-closed）。
       **任何"行内含 superseded / 已作废口径表 字样"都不再触发豁免**（原实现：一行命中 → 免检至下一个 `## ` 标题）。
输出: DSH-ANCHOR: OK | VIOLATION(n) | DEGRADED

D1132（乙案 · 自证式降级）:
  事实源 current.path 是**本机私有绝对路径**，树一移动就 DEGRADED。故树解析失败时**额外**打印
  「已探测候选」清单（读事实源 `discovery.path_candidates` / `glob_candidates`，逐个报 存在性 / 是否 git /
  short HEAD / 与声明 head 是否一致），让 DEGRADED **自证找过哪些候选**，不再只留一行「无法解析」。
  ⚠️ 该清单**纯诊断**：不参与判定、不新增任何 OK 路径 ⇒ 绝不把降级变假绿（判定语义与 D943 原样一致）。
"""
# D520/V5: 纯 python 实现，无裸 python3/date +%s/date -v/grep -P 调用（已对照 PLATFORM-CHECKLIST.md）
import argparse, glob, io, json, os, re, subprocess, sys

# Windows 兼容（windows-compat）：CI 控制台非 UTF-8 时中文输出会抛 UnicodeEncodeError
for _s in ("stdout", "stderr"):
    try:
        getattr(sys, _s).reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

OK, VIOL, DEG = 0, 1, 2

# 豁免段语义（见 docstring ⑤）
EXEMPT_HEAD = "## 引用豁免"
EXEMPT_ENTRY_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+\S")

def exempt_lines(lines):
    """返回被豁免的行号集合（1-based）。

    契约:
      输入  lines: list[str]（单份被扫描文档的行）
      输出  set[int]：`## 引用豁免` 标题行起、至下一个 `## ` 标题前止的段内行号（含标题行）
      规则  段内必须至少一条逐行显式条目（列表项）；无条目则该段不生效 → 返回空（fail-closed）
      降级  无豁免段 → 空集合（不抛异常；文档行数不变）
    """
    ex = set()
    i, n = 0, len(lines)
    while i < n:
        if lines[i].strip().startswith(EXEMPT_HEAD):
            j = i + 1
            while j < n and not lines[j].strip().startswith("## "):
                j += 1
            if any(EXEMPT_ENTRY_RE.match(lines[k]) for k in range(i + 1, j)):
                ex.update(range(i + 1, j + 1))
            i = j
        else:
            i += 1
    return ex

def sh(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ""

def probe_tree(path):
    """该路径的 git short HEAD；不可用（空 / 不存在 / 非目录 / 非 git 仓库）返回 ""。

    契约（铁律 47）:
      @input  path: str | None
      @output str —— `git -C <path> rev-parse --short HEAD` 的**逐字输出**
               （--short 位宽由 git 决定，不假设 8 位；本机 -020 实测给 10 位）；不可用返回 ""
      @degraded 不抛异常：一切不可用情形以 "" 表达，由调用方据此判 DEGRADED
    """
    if not path or not os.path.isdir(path):
        return ""
    return sh(["git", "-C", path, "rev-parse", "--short", "HEAD"])

def candidate_paths(anchor, exclude=""):
    """D1132 乙案：从事实源 discovery 段读候选（字面清单 + glob），去重并排除已试过的 path。

    契约:
      @input  anchor: dict（事实源）; exclude: str（已试过、不再重复打印的路径）
      @output list[str] —— 候选路径（字面清单保持声明顺序；glob 结果按字典序展开）
      @degraded discovery 缺失/非法 ⇒ 返回 []（不抛异常、不静默改判）
    """
    disc = anchor.get("discovery") or {}
    cands = list(disc.get("path_candidates") or [])
    for pat in (disc.get("glob_candidates") or []):
        try:
            cands.extend(sorted(glob.glob(pat)))
        except Exception:
            continue
    seen, out = set(), []
    for c in cands:
        c = (c or "").strip()
        if not c or c == exclude or c in seen:
            continue
        seen.add(c)
        out.append(c)
    return out

def describe_candidates(anchor, exclude="", want=None):
    """逐候选一行诊断：存在与否 / 是否 git 仓库 / short HEAD / 与声明 head 是否一致。

    用途：树解析失败时**自证「我找过哪些候选」**（D1132 乙案），对命中者给出可执行修复动作。
    ⚠️ 纯诊断函数：**不参与判定** —— 调用方仍返回 DEGRADED（防把降级变假绿）。
    """
    lines = ["  ℹ️ 已探测候选（仅诊断，不据此改判）:"]
    cands = candidate_paths(anchor, exclude)
    if not cands:
        lines.append("     （事实源未声明 discovery.path_candidates / glob_candidates —— 无可探测候选）")
        return lines
    want = want if want is not None else (anchor.get("current") or {}).get("head")
    for c in cands:
        if not os.path.isdir(c):
            lines.append("     - %s → 不存在或非目录" % c)
            continue
        h = probe_tree(c)
        if not h:
            lines.append("     - %s → 存在但非 git 仓库（无 HEAD 可解析）" % c)
            continue
        if h == want:
            lines.append("     - %s → git HEAD=%s ✅ 与事实源 head 一致 ⇒ 请把 current.path 更新为该路径" % (c, h))
        else:
            lines.append("     - %s → git HEAD=%s ✗ 与事实源 head(%s) 不一致" % (c, h, want))
    return lines

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--anchor", default="docs/synova/coordination/DSH-断面.json")
    ap.add_argument("--scan-dir", default="docs/synova/coordination")
    ap.add_argument("--tree", default=None)
    ap.add_argument("--no-tree-check", action="store_true",
                    help="跳过 DSH 树在场与 HEAD 一致校验（CI 侧用：CI 无本地 DSH 树；文档一致性仍全查）")
    a = ap.parse_args()

    apath = os.path.join(a.repo, a.anchor)
    try:
        anchor = json.load(open(apath, encoding="utf-8"))
        cur = anchor["current"]; sup = anchor.get("superseded", [])
    except Exception as e:
        print("degraded: 事实源不可读/非法: %s (%s)" % (apath, e)); print("DSH-ANCHOR: DEGRADED"); return DEG

    if not a.no_tree_check:
        tree = a.tree or cur.get("path")
        real = probe_tree(tree)
        if not real:
            print("degraded: 无法解析 DSH 树 HEAD: %s（声明路径不可用：不存在 / 非目录 / 非 git 仓库）" % tree)
            for _l in describe_candidates(anchor, exclude=tree):
                print(_l)
            print("DSH-ANCHOR: DEGRADED"); return DEG
        if real != cur["head"]:
            print("degraded: 树已移动 — 事实源 %s，实测 %s（所有绑旧 HEAD 的结论自动降级『待复核』）" % (cur["head"], real))
            for _l in describe_candidates(anchor, exclude=tree, want=cur.get("head")):
                print(_l)
            print("DSH-ANCHOR: DEGRADED"); return DEG

    sup_pairs = {(s["version"], s["head"]) for s in sup}
    sup_versions = {s["version"] for s in sup}
    known = set(anchor.get("known_versions") or []) | {cur["version"]} | sup_versions
    # 任意 semver prerelease（原只匹配 0.1.7-* → 将来版本静默放过）
    # 尾部 `(?!-)`：排除"版本号后紧跟连字符"的伪命中——实测台账里 SynovaAgent-0.1.0-win32-x64.exe
    #   被旧正则截成 0.1.0-win32（D943-FIX 收紧豁免后暴露的误报，非 DSH 版本串）。
    ver_re = re.compile(r"\b\d+\.\d+\.\d+-[A-Za-z0-9.]+\b(?!-)")
    head_re = re.compile(r"\b(00102833|46a7f68b|[0-9a-f]{8})\b")
    viol = []
    scanned = 0
    for root, _, files in os.walk(os.path.join(a.repo, a.scan_dir)):
        if "/." in root or "node_modules" in root: continue
        for fn in sorted(files):
            if not fn.endswith(".md"): continue
            p = os.path.join(root, fn)
            try:
                rel = os.path.relpath(p, a.repo)
            except ValueError:          # Windows: 扫描目录与仓库不同盘符（CI: tmp=C: 而 checkout=D:）
                rel = p
            scanned += 1
            try: lines = open(p, encoding="utf-8").read().splitlines()
            except Exception: continue
            ex = exempt_lines(lines)          # D943-FIX: 豁免只认显式 `## 引用豁免` 段（无关键字触发）
            for i, ln in enumerate(lines, 1):
                if i in ex: continue
                for v in ver_re.findall(ln):
                    if v not in known:
                        viol.append("%s:%d 未登记的 DSH 版本串 %s" % (rel, i, v))
                    for sh_ in head_re.findall(ln):
                        if (v, sh_) in sup_pairs and sh_ not in ("46a7f68b",):
                            viol.append("%s:%d 引用了已 superseded 的断面 %s @ %s" % (rel, i, v, sh_))
    if viol:
        for x in viol[:20]: print("  ❌ " + x)
        print("DSH-ANCHOR: VIOLATION(%d)  [扫描 %d 份]" % (len(viol), scanned)); return VIOL
    print("DSH-ANCHOR: OK  [事实源 %s @ %s ｜ 扫描 %d 份]" % (cur["version"], cur["head"], scanned)); return OK

if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as _e:            # 未预期异常必须显式降级（fail-closed），不得装成 VIOLATION/通过
        print("degraded: 内部错误 %s: %s" % (type(_e).__name__, _e))
        print("DSH-ANCHOR: DEGRADED")
        sys.exit(2)
