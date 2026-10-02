#!/usr/bin/env python3
"""D943 — K3 审计报告的「机械保险」门禁（只查形式与锚点，不判审计结论对错）

边界（CTO 红线）：本脚本不写审计标准、不评价结论正确性、不改 k3 域任何文件；
只做五条**机械可判**的形式校验，防止"审计报告建立在过期断面/不可核引用/无锚对象"之上。

判据:
  R1 断面/对象声明  报告须有 `断面: <ver> @ <head>` 或显式「不涉及 DSH 断面」  否则 VIOLATION
  R2 被审对象锚     须含 commit/HEAD/tip + 7~40 位 hex，且该 sha 在本仓可解析      否则 VIOLATION
  R3 引用可解析     所有 `path:line` 形态引用：文件存在 且 行数 ≥ line             否则 VIOLATION
  R4 结论行带证据   每条判定行(PASS/CONDITIONAL/FAIL/通过/不通过/有条件)须含
                    file:line 或 `命令` 或「未核实/待核」标记                       否则 VIOLATION
  R5 计数带命令     出现 N 份/N 条/N 个 计数时，报告须至少含一个代码块(命令)        否则 DEGRADED
输出: K3-REPORT: OK | VIOLATION(n) | DEGRADED
"""
# D520/V5: 纯 python 实现，无裸 python3/date +%s/date -v/grep -P 调用（已对照 PLATFORM-CHECKLIST.md）
import argparse, json, os, re, subprocess, sys

for _s in ("stdout", "stderr"):
    try:
        getattr(sys, _s).reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

OK, VIOL, DEG = 0, 1, 2
RE_ANCHOR   = re.compile(r"(断面|被审对象|audited)\s*[:：]")
RE_NODSH    = re.compile(r"不涉及\s*DSH")
RE_SHA      = re.compile(r"\b([0-9a-f]{7,40})\b")
RE_CITE     = re.compile(r"([A-Za-z0-9_./\-]+\.(?:md|py|sh|ts|tsx|js|yml|yaml|json|txt)):(\d+)")
RE_VERDICT  = re.compile(r"^\s*[|\-*]?\s*(PASS|CONDITIONAL\s*PASS|FAIL|通过|不通过|有条件)")
RE_COUNT    = re.compile(r"\d+\s*(份|条|个|处)")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("report")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--anchor", default="docs/synova/coordination/DSH-断面.json")
    a = ap.parse_args()

    rp = a.report if os.path.isabs(a.report) else os.path.join(a.repo, a.report)
    try:
        text = open(rp, encoding="utf-8", errors="replace").read()
    except Exception as e:
        print("degraded: 报告不可读 %s (%s)" % (rp, e)); print("K3-REPORT: DEGRADED"); return DEG
    lines = text.splitlines()
    viol, deg = [], []

    # ---- R1 断面/对象声明 ----
    if not any(RE_ANCHOR.search(l) for l in lines) and not RE_NODSH.search(text):
        viol.append("R1 缺断面/被审对象声明（须 `断面: <ver> @ <head>` 或显式「不涉及 DSH 断面」）")
    else:
        # 若声明了 DSH 断面，须与唯一源一致
        try:
            src = json.load(open(os.path.join(a.repo, a.anchor), encoding="utf-8"))["current"]
            for i, l in enumerate(lines, 1):
                if RE_ANCHOR.search(l) and "@" in l:
                    if src["version"] not in l or src["head"][:7] not in l:
                        viol.append("R1 %s:%d 断面与唯一源不一致（源=%s @ %s）" % (os.path.basename(rp), i, src["version"], src["head"]))
        except Exception as e:
            deg.append("R1 断面源不可读（%s）→ 无法核对断面一致性" % e)

    # ---- R2 被审对象锚 + sha 可解析 ----
    shas = []
    for l in lines:
        if re.search(r"(commit|HEAD|tip|被审对象)\s*[:：=]?\s*", l, re.I):
            shas += RE_SHA.findall(l)
    if not shas:
        viol.append("R2 缺被审对象锚（须 commit/HEAD/tip + 7~40 位 sha）")
    else:
        ok_any = False
        for s in set(shas):
            r = subprocess.run(["git", "-C", a.repo, "cat-file", "-e", s], capture_output=True)
            if r.returncode == 0: ok_any = True
        if not ok_any:
            viol.append("R2 被审对象 sha 在本仓不可解析（%s）" % ",".join(sorted(set(shas))[:3]))

    # ---- R3 引用可解析 ----
    n_cite = 0
    for i, l in enumerate(lines, 1):
        for path, ln in RE_CITE.findall(l):
            if path.startswith("http"): continue
            n_cite += 1
            fp = os.path.join(a.repo, path)
            if not os.path.exists(fp):
                viol.append("R3 %s:%d 引用不存在: %s" % (os.path.basename(rp), i, path)); continue
            try:
                total = sum(1 for _ in open(fp, encoding="utf-8", errors="replace"))
            except Exception:
                continue
            if int(ln) > total:
                viol.append("R3 %s:%d 行号越界: %s:%s (文件仅 %d 行)" % (os.path.basename(rp), i, path, ln, total))

    # ---- R4 结论行带证据 ----
    for i, l in enumerate(lines, 1):
        if RE_VERDICT.match(l):
            if not (RE_CITE.search(l) or "`" in l or re.search(r"未核实|待核|证据不足", l)):
                viol.append("R4 %s:%d 判定行无证据（须 file:line / 命令 / 未核实标记）: %s" % (os.path.basename(rp), i, l.strip()[:50]))

    # ---- R5 计数带命令 ----
    if RE_COUNT.search(text) and "```" not in text:
        deg.append("R5 报告含计数但无任何命令块（覆盖声明须给命令）")

    print("  统计: 引用 %d 条 ｜ 行数 %d" % (n_cite, len(lines)))
    for d in deg:  print("  ⚠️ " + d)
    for v in viol: print("  ❌ " + v)
    if viol:
        print("K3-REPORT: VIOLATION(%d)" % len(viol)); return VIOL
    if deg:
        print("K3-REPORT: DEGRADED"); return DEG
    print("K3-REPORT: OK"); return OK

if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as _e:
        print("degraded: 内部错误 %s: %s" % (type(_e).__name__, _e)); print("K3-REPORT: DEGRADED"); sys.exit(2)
