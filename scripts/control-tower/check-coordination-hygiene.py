#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check-coordination-hygiene — D6/D7「协调文件卫生」判据（三态）。

契约（铁律 47）:
  @input  — --root <dir>                     仓库根（默认 git toplevel）
            [--changed <file> ...]           只检查这些文件（**棘轮式**：默认只判新增/改动）
            [--all]                          检查全部（用于**盘点**，默认对存量只报数不判红）
  @output — stdout: `  ✅/❌/ℹ️ <判据>` + 末行 `COORD-HYGIENE: <OK|VIOLATION(n)|DEGRADED>  [摘要]`
  @exit   — 0 = 通过 ｜ 1 = 违规 ｜ 2 = 检查自身失败（降级，fail-closed，同样阻断）
  @degrade— 根不可读 / git 不可用 ⇒ exit 2 + stderr 记原因（铁律 11: 不静默）

判据（源: CTO《开发计划 v2》D6 + D7）:
  R1 **禁 `INDEX.md`**（D6）—— 一份一主题，索引类文件不被允许
  R2 **篇幅上限**（D6）—— 阈值取自**实测分布**而不是拍脑袋：本仓 coordination 251 篇的
     p90 = 11824 字符 ⇒ 上限取 p90 的 2 倍 = **24000 字符**（超过 = 该文应拆成多份主题）
  R3 **近重复闸**（D7）—— 与既有文档的 **token Jaccard ≥ 0.55** ⇒ 判重
     🔴 **棘轮式**：`--changed` 模式下只判**本次涉及的文件**；存量只用 `--all` 盘点报数，
        **不判红**（同 D734 教训：把存量债一次性转红，与"清理存量"目标相反）

用法:
  check-coordination-hygiene.py --changed docs/synova/coordination/NEW.md
  check-coordination-hygiene.py --all        # 盘点（存量只报数）
"""
import argparse
import os
import re
import subprocess
import sys

OK, VIOL, DEG = 0, 1, 2
COORD_REL = "docs/synova/coordination"
# 阈值：**实测** p90=11824 ⇒ ×2 = 24000（写死会被质疑，故在注释与输出里都标出处）
CEILING_CHARS = 24000
JACCARD = 0.55
TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z]{4,}")


def die(msg):
    sys.stderr.write("degraded: %s\n" % msg)
    print("COORD-HYGIENE: DEGRADED  [%s]" % msg)
    sys.exit(DEG)


def toks(text):
    t = re.sub(r"[#*`>|\-\s]+", " ", text)
    return set(TOKEN_RE.findall(t))


def read(root, rel):
    try:
        with open(os.path.join(root, rel), encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except Exception:  # noqa: BLE001
        return None


def main():
    ap = argparse.ArgumentParser(description="D6/D7 协调文件卫生")
    ap.add_argument("--root")
    ap.add_argument("--changed", nargs="*", default=[])
    ap.add_argument("--all", action="store_true")
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
    coord = os.path.join(root, COORD_REL)
    if not os.path.isdir(coord):
        die("%s 不存在" % COORD_REL)

    # 收集 coordination 下全部 .md（相对路径）
    existing = []
    for dirpath, _dirs, names in os.walk(coord):
        for n in names:
            if n.endswith(".md"):
                existing.append(os.path.relpath(os.path.join(dirpath, n), root).replace(os.sep, "/"))
    if not existing:
        die("coordination 下无 .md（扫描为空 ⇒ 判据失效）")

    # 🔴 两种模式**必须分开**（第一版把 `--all` 当成"判全部" ⇒ 存量 74 条违规一次性全红，
    #   正是 D734 教训的重演）。⇒ `--all` = **盘点**（只报数，不判红）；`--changed` = **判红**。
    if a.changed:
        # 🔴 D1184 复核整改（复核实测）: 原过滤 `startswith(COORD_REL)` 会把 `./docs/…` **整条静默丢弃**
        #   ⇒ targets=[] ⇒ **四条判据全部退化成盘点**，末行还报 **OK**。
        #   一个字符的路径写法 = 判据全关，且**报绿**（这正是"跳过不报"那一族）。
        #   ⇒ 先规范化（去 `./`、去重复斜杠），**过滤后为空一律 DEGRADED(2)**，绝不报 OK。
        norm = [re.sub(r"^(\./)+", "", x.replace(os.sep, "/")) for x in a.changed]
        targets = [x for x in norm if x.startswith(COORD_REL)]
        dropped = [x for x in norm if not x.startswith(COORD_REL)]
        if not targets:
            die("--changed 过滤后为空（传了 %d 个，都在 %s 之外）⇒ 无法判红，fail-closed"
                % (len(norm), COORD_REL))
        if dropped:
            print("  ⚠️ --changed 中 %d 个不在 %s 下，已忽略（**显式报出**，不静默）: %s"
                  % (len(dropped), COORD_REL, "; ".join(dropped[:3])))
        mode = "enforce"
    else:
        targets = []
        # 显式引用 a.all —— 否则 `--all` 就是一个**声明了却从不被读**的死参数（铁律 37）。
        # 语义: `--all` 与"不给参"都进盘点模式；保留 `--all` 是为了**可读性**（显式表达意图）。
        mode = "inventory" if a.all or not a.changed else "enforce"
        print("  ℹ️ 盘点模式（%s）⇒ **存量只报数、不判红**（棘轮式；判红只在 --changed）"
              % ("--all" if a.all else "未给参"))

    fails = []
    # ── R1 禁 INDEX.md ──
    idx = [t for t in (targets or existing) if os.path.basename(t).lower() == "index.md"]
    if idx:
        if targets:
            fails.extend("R1 禁 INDEX.md: %s" % x for x in idx)
            for x in idx:
                print("  ❌ R1: 出现 INDEX.md —— %s（一份一主题，索引类文件不允许）" % x)
        else:
            print("  ℹ️ R1: 存量含 INDEX.md %d 个（盘点，不判红）" % len(idx))
    else:
        print("  ✅ R1: 无 INDEX.md")

    # ── R2 篇幅上限 ──
    over = []
    unreadable = []
    for t in (targets or existing):
        txt = read(root, t)
        if txt is None:
            # 🔴 D1184: 原先 `continue` **静默跳过** —— 复核实测 `chmod 000` 一篇 60000 字符的文，
            #   `--changed` 报「均在上限内」exit 0 且 `--all` 少数 1 篇（2 篇 vs 实际 3 篇）。
            #   这违反本模块自己引用的纪律「跳过必须说出来」，也违反三态口径（自身失败 ⇒ exit 2）。
            unreadable.append(t)
            continue
        if len(txt) > CEILING_CHARS:
            over.append((t, len(txt)))
    if unreadable:
        print("  ⚠️ 降级: %d 个文件读不到（**不计入统计，显式报出**）: %s%s"
              % (len(unreadable), "; ".join(unreadable[:3]), " …" if len(unreadable) > 3 else ""))
        if len(unreadable) > max(len(targets or existing) // 2, 0):
            die("过半文件读不到（%d/%d）⇒ 统计不可信，fail-closed" % (len(unreadable), len(targets or existing)))
    if targets:
        if over:
            fails.extend("R2 超篇幅: %s (%d>%d)" % (t, n, CEILING_CHARS) for t, n in over)
            for t, n in sorted(over, key=lambda x: -x[1])[:5]:
                print("  ❌ R2: %s = %d 字符 > 上限 %d（应拆成多份主题）" % (t, n, CEILING_CHARS))
        else:
            print("  ✅ R2: 本次涉及文件均在上限内（%d 字符）" % CEILING_CHARS)
    else:
        print("  ℹ️ R2: 存量超上限 %d 篇（盘点，不判红；上限 %d 取自实测 p90=11824 ×2）" % (len(over), CEILING_CHARS))

    # ── R3 近重复 ──
    docs = {}
    for t in existing:
        txt = read(root, t)
        if txt is None:
            continue
        s = toks(txt)
        if len(s) >= 40:
            docs[t] = s
    dups = []
    for t in targets:
        if t not in docs:
            continue
        for o, os_ in docs.items():
            if o == t or "/archive/" in o:
                continue
            j = len(docs[t] & os_) / max(len(docs[t] | os_), 1)
            if j >= JACCARD:
                dups.append((t, o, round(j, 3)))
    if targets:
        if dups:
            fails.extend("R3 近重复: %s ≈ %s (%.2f)" % d for d in dups)
            for t, o, j in dups[:5]:
                print("  ❌ R3: %s ≈ %s（Jaccard %.2f ≥ %.2f）" % (t, o, j, JACCARD))
        else:
            print("  ✅ R3: 本次涉及文件无近重复（Jaccard 阈值 %.2f）" % JACCARD)
    else:
        # 盘点：全量两两比对（O(n²)，仅 --all 时跑）
        n = 0
        for i, t in enumerate(docs):
            for o in list(docs)[i + 1:]:
                if "/archive/" in o:
                    continue
                if len(docs[t] & docs[o]) / max(len(docs[t] | docs[o]), 1) >= JACCARD:
                    n += 1
        print("  ℹ️ R3: 存量近重复对 **%d** 对（盘点，不判红）" % n)

    # ── R4 分层（D8）──
    # 实测: coordination/ 下 **187 个顶层平铺文件** + 11 个子目录；自然分类已存在
    #   （派单 34 / 编码指令 17 / CTO 7 / 小队派单 5 / K3 5 / 审计派单 4 / 阶段* / D\d+ …）
    #   但**没有任何约定**要求新文件进子目录或带可识别的类别前缀。
    # 🔴 棘轮式同前: 只判 `--changed`；存量只盘点。
    # 🔴 只要求"**带可识别的类别前缀 或 进子目录**"，**不强制搬迁**（搬 187 个文件会打断 D5 那 593 条引用）。
    FLAT_OK_PREFIX = ("派单", "小队派单", "审计派单", "编码指令", "回执", "提案", "台账",
                      "报告", "决议", "CTO", "K3", "AUDIT", "阶段")
    FLAT_OK_RE = re.compile(r"^(D\d+|\d{4}-\d{2}-\d{2}-)")
    if targets:
        bad_flat = []
        for t in targets:
            rel = t[len(COORD_REL) + 1:]
            if "/" in rel:          # 已进子目录 ⇒ 合规
                continue
            if rel.startswith(FLAT_OK_PREFIX) or FLAT_OK_RE.match(rel):
                continue
            bad_flat.append(t)
        if bad_flat:
            fails.extend("R4 分层: 顶层平铺且无可识别类别前缀: %s" % x for x in bad_flat)
            for x in bad_flat[:5]:
                print("  ❌ R4: 顶层平铺且无可识别类别前缀 —— %s" % os.path.basename(x))
            print("      允许的前缀: %s ｜ 或进子目录 ｜ 或 D\\d+/YYYY-MM-DD- 开头" % "/".join(FLAT_OK_PREFIX))
        else:
            print("  ✅ R4: 本次涉及文件分层合规（子目录 或 可识别前缀）")
    else:
        flat = [t for t in existing if "/" not in t[len(COORD_REL) + 1:]]
        sub = [t for t in existing if "/" in t[len(COORD_REL) + 1:]]
        bad = [t for t in flat if not (os.path.basename(t).startswith(FLAT_OK_PREFIX) or FLAT_OK_RE.match(os.path.basename(t)))]
        print("  ℹ️ R4: 存量 顶层平铺 **%d** / 子目录 **%d**；其中无可识别前缀的 **%d**（盘点，不判红）"
              % (len(flat), len(sub), len(bad)))

    if fails:
        print("COORD-HYGIENE: VIOLATION(%d)  [%s]" % (len(fails), "; ".join(fails)[:200]))
        sys.exit(VIOL)
    print("COORD-HYGIENE: OK  [checked %d / existing %d]" % (len(targets), len(existing)))
    sys.exit(OK)


if __name__ == "__main__":
    main()
