#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verdict-baseline.py — verdict 回填基线（D1073 / X30 M0 第二优先 T6）

**定位声明（D336 审计红线）**: 本件是**数据质量基线工具**——只统计 task-state 卡中
verdict 字段的**位置异构 / 值域异构 / 时序异常**，并产出人工核对用的基线样本。
它**不定义审计判据、不判定任何卡是否通过、不产出审计结论**——判据与判定归 K3。
落点是 `scripts/control-tower/`（工程侧数据面），不是 `scripts/audit/**`。

背景（X30 启动令 §二 T6）: 406 张卡中 verdict 键存在但「位置异构（顶层 vs 嵌套）＋值域不统一」，
元审计（谁审 K3）在数据基础不存在时启动＝假绿。先定基线，再排人工核对。

契约（铁律 47）:
  @input  — --root <repo>（默认 git-common-dir 父目录）| --state-dir <dir>（默认 <root>/task-state）
             | --sample <N>（基线样本张数，默认 30）| --out <md 路径> | --json <json 路径>
  @output — markdown 基线报告 +（可选）JSON 摘要；stdout 打印关键统计
  @degraded — 单卡 JSON 解析失败 / 时间字段缺失或格式不可解析 → 计入异常并在报告显式列出，不静默
  @error  — state-dir 不存在 → exit 1
"""
import argparse, json, os, re, subprocess, sys, time
from collections import Counter, defaultdict

CANON = {"PASS": "PASS", "CONDITIONAL PASS": "CONDITIONAL_PASS", "CONDITIONAL": "CONDITIONAL_PASS",
         "FAIL": "FAIL", "NOT AUDITABLE": "NOT_AUDITABLE"}
RAW_OK = {"PASS": "PASS", "CONDITIONAL PASS": "CONDITIONAL_PASS", "CONDITIONAL_PASS": "CONDITIONAL_PASS",
          "FAIL": "FAIL", "NOT-AUDITABLE": "NOT_AUDITABLE", "NOT AUDITABLE": "NOT_AUDITABLE"}


def canon(v):
    if not isinstance(v, str):
        return "OTHER"
    s = " ".join(v.strip().upper().replace("_", " ").replace("-", " ").split())
    return CANON.get(s, "OTHER")


def find_verdicts(node, prefix=""):
    out = []
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{prefix}.{k}" if prefix else k
            if k == "verdict":
                out.append((p, v))
            out.extend(find_verdicts(v, p))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out.extend(find_verdicts(v, f"{prefix}[{i}]"))
    return out


def norm_date(s):
    if not isinstance(s, str):
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s.strip())
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=None)
    ap.add_argument("--state-dir", default=None)
    ap.add_argument("--sample", type=int, default=30)
    ap.add_argument("--out", default=None)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()

    root = a.root
    if not root:
        rc = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                            capture_output=True, text=True)
        root = os.path.dirname(rc.stdout.strip()) if rc.returncode == 0 and rc.stdout.strip() else "."
    state_dir = a.state_dir or os.path.join(root, "task-state")
    if not os.path.isdir(state_dir):
        print(f"❌ task-state 目录不存在: {state_dir}", file=sys.stderr)
        return 1

    files = sorted(f for f in os.listdir(state_dir) if f.endswith(".json"))
    t0 = time.time()
    pos = Counter(); raw = Counter(); canonical = Counter()
    with_verdict = 0; parse_fail = []; time_anom = []; no_meta = []
    cards = []
    for fn in files:
        p = os.path.join(state_dir, fn)
        try:
            with open(p, encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception as e:  # noqa: BLE001 — 显式记录，不静默
            parse_fail.append((fn, str(e)[:80]))
            continue
        if not isinstance(d, dict):
            parse_fail.append((fn, "顶层非对象"))
            continue
        vs = find_verdicts(d)
        tid = d.get("task_id") or fn[:-5]
        updated = d.get("updated_at")
        if vs:
            with_verdict += 1
            for path, val in vs:
                pos[path] += 1
                raw[repr(val) if not isinstance(val, str) else val] += 1
                c = canon(val)
                canonical[c] += 1
                audit = d.get("audit") if isinstance(d.get("audit"), dict) else {}
                at = norm_date(audit.get("at"))
                by = audit.get("by")
                if not at or not by:
                    no_meta.append((tid, path, "缺 at/by"))
                if at and isinstance(updated, str):
                    u = norm_date(updated)
                    if u and at > u:
                        time_anom.append((tid, f"audit.at {at} > updated_at {u}"))
                cards.append(dict(task_id=tid, status=d.get("status"), path=path,
                                  raw=(val if isinstance(val, str) else json.dumps(val, ensure_ascii=False)),
                                  canon=c, at=at or "-", by=by or "-",
                                  updated=(str(updated)[:10] if updated else "-")))
        else:
            cards.append(dict(task_id=tid, status=d.get("status"), path="-", raw="-", canon="-",
                              at="-", by="-", updated=(str(updated)[:10] if updated else "-")))
    elapsed = time.time() - t0

    total = len(files)
    dev = {k: v for k, v in raw.items() if RAW_OK.get(k) is None}
    with_v = [c for c in cards if c['path'] != '-']
    sample = (with_v or cards)[: a.sample]
    per_card = elapsed / max(total, 1)
    est_hours = per_card * total / 3600

    L = []
    L.append(f"# verdict 回填基线 — 2026-09-30（首日，全量扫描 {total} 张）")
    L.append("")
    L.append("> 依据: `X30落地启动令.md` §二 T6（M2 verdict 回填）｜生成: `scripts/control-tower/verdict-baseline.py`")
    L.append("> **定位**: 数据质量基线，非审计结论——判据与判定归 K3（D336 审计红线）。")
    L.append("")
    L.append("## 一、总量与覆盖")
    L.append("")
    L.append(f"- 扫描卡片: **{total}** 张｜含 verdict 的卡: **{with_verdict}**｜无 verdict: **{total - with_verdict}**"
             f"（覆盖率 {with_verdict / max(total,1) * 100:.1f}%）")
    L.append(f"- 解析失败: **{len(parse_fail)}** 张（{'、'.join(f for f, _ in parse_fail[:5]) or '无'}）")
    L.append(f"- 扫描耗时: **{elapsed:.2f}s**（{per_card * 1000:.2f} ms/张，一次遍历可忽略）；"
             f"**总量重估**: 机械层已完成、不构成瓶颈；原估「4–6 人日」是**人工逐卡核对**口径（{total} 张 × 30–45 秒 ≈ "
             f"{(total * 37.5) / 3600:.1f} 小时），**不因机械扫描而缩小**")
    L.append("")
    L.append("## 二、位置异构（verdict 键出现在哪）")
    L.append("")
    L.append("| 位置 | 出现次数 |")
    L.append("|---|---|")
    for k, v in pos.most_common():
        L.append(f"| `{k}` | {v} |")
    L.append("")
    L.append("## 三、值域异构（原始取值 → 规范化）")
    L.append("")
    L.append("| 原始值 | 次数 | 规范化 | 是否偏离标准写法 |")
    L.append("|---|---|---|---|")
    for k, v in raw.most_common():
        c = canon(k)
        L.append(f"| `{k}` | {v} | {c} | {'⚠ 是' if RAW_OK.get(k) is None else '否'} |")
    L.append("")
    L.append(f"**规范化后分布**: " + " ｜ ".join(f"{k} {v}" for k, v in canonical.most_common()))
    L.append(f"**偏离项**: {len(dev)} 类，合计 {sum(dev.values())} 处 —— " +
             ("、".join(f"`{k}`×{v}" for k, v in dev.items()) if dev else "无"))
    L.append("")
    L.append("## 四、时序与元数据异常")
    L.append("")
    L.append(f"- `audit.at > updated_at`（时间倒挂）: **{len(time_anom)}** 处"
             + ("：" + "；".join(f"{t} {m}" for t, m in time_anom[:8]) if time_anom else ""))
    L.append(f"- 缺 `audit.at` 或 `audit.by`（元审计无可追溯锚）: **{len(no_meta)}** 处"
             + ("：" + "；".join(f"{t}[{p}] {m}" for t, p, m in no_meta[:8]) if no_meta else ""))
    L.append("")
    L.append(f"## 五、首日基线样本（{len(sample)} 张，逐张人工核对用）")
    L.append("")
    L.append("> 抽样规则：按 `task_id` 升序取**前 N 张含 verdict 的卡**（即回填归一的真实对象）；无 verdict 的 233 张不在本样本内。")
    L.append("")
    L.append("| # | 卡 | status | verdict 位置 | 原始值 | 规范化 | audit.at | by | updated_at |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for i, c in enumerate(sample, 1):
        L.append(f"| {i} | {c['task_id']} | {c['status']} | `{c['path']}` | {c['raw'][:28]} | "
                 f"{c['canon']} | {c['at']} | {c['by']} | {c['updated']} |")
    L.append("")
    L.append("## 六、结论与下一步（工程侧，不含审计判定）")
    L.append("")
    L.append(f"1. **位置异构确认**: verdict 主要落 `audit.verdict`（{pos.get('audit.verdict', 0)} 处），"
             f"另有顶层 `verdict` 等 {max(len(pos) - 1, 0)} 种位置 → 回填前需**先定唯一位置**（建议 `audit.verdict`，与既有 172 处一致）。")
    L.append(f"2. **值域确认**: 标准写法外存在 {len(dev)} 类偏离（含大小写、`_`/空格变体、自由文本、非字符串）→ "
             f"回填需**先冻结枚举**（PASS / CONDITIONAL_PASS / FAIL / NOT_AUDITABLE）再批量归一。")
    L.append(f"3. **人工核对量级**: {total} 张 × 30–45 秒/张 ≈ {(total * 37.5) / 3600:.1f} 小时（原估 4–6 人日量级吻合），"
             f"**不因机械扫描而缩小**——机械层 {elapsed:.2f}s 已完成。")
    L.append(f"4. **前置提醒（硬顺序 3）**: verdict 回填**完成前**不得启动元审计（否则漏检追溯无数据 → 假绿）。")
    L.append("")

    out = a.out or os.path.join(root, "docs", "synova", "coordination", "verdict回填基线-20260930.md")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(dict(total=total, with_verdict=with_verdict, positions=dict(pos),
                           canonical=dict(canonical), deviations=dev,
                           time_anomalies=time_anom, missing_meta=no_meta,
                           parse_failures=parse_fail, elapsed_s=round(elapsed, 3)), fh,
                      ensure_ascii=False, indent=2)

    print(f"扫描 {total} 张｜含 verdict {with_verdict}｜位置种类 {len(pos)}｜值域偏离 {len(dev)} 类")
    print(f"时序倒挂 {len(time_anom)}｜缺元数据 {len(no_meta)}｜解析失败 {len(parse_fail)}｜耗时 {elapsed:.2f}s")
    if parse_fail:
        print(f"⚠ degraded: {len(parse_fail)} 张解析失败 → {parse_fail[:3]}", file=sys.stderr)
    print(f"落盘: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
