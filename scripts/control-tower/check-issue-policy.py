#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check-issue-policy — P3「Issue 作为工作单元」判据（三态）。

契约（铁律 47）:
  @input  — --repo <owner/name> --pr <N>          （live 模式，需 token）
            --from-json <file>                    （离线模式: 喂一份 GitHub API 归并后的 JSON）
            [--project-json <file>]               （可选: PR 的看板字段快照，用于 Priority 一致性）
  @output — stdout: 逐条 `  ✅/❌ <判据>` + 末行 `ISSUE-POLICY: <OK|VIOLATION(n)|DEGRADED>  [摘要]`
  @exit   — 0 = 通过 ｜ 1 = 违规 ｜ 2 = 检查自身失败（降级，fail-closed，同样阻断）
  @degrade— token 缺失 / API 不可达 / 载荷解析失败 ⇒ exit 2 + stderr 记原因（铁律 11: 不静默）

判据（源: CTO《开发计划 v2》P3）:
  R1 PR 必须关联 ≥1 个 Issue（用 GitHub 权威的 closingIssuesReferences，不是正则扫正文）
  R2 每个关联 Issue 必须: 恰好 1 个 `kind/*` ｜ ≥1 个 `area/*` ｜ ≤1 个 `p0-p3`
  R3 Priority 一致性: PR 看板 Priority == 「最高优先级的关联 Issue」的 Priority
                      （p0 > p1 > p2 > p3；PR 无该字段或未提供快照 ⇒ 本判据 SKIP，不冒充通过）

用法:
  check-issue-policy.py --from-json tests/fixtures/issue-policy/pr-ok.json
  check-issue-policy.py --repo synova-agent/SynovaAgent --pr 1183
"""
import argparse
import json
import os
import re
import sys

OK, VIOL, DEG = 0, 1, 2
KIND_RE = re.compile(r"^kind/")
AREA_RE = re.compile(r"^area/")
PRIO_RE = re.compile(r"^p([0-3])$")

# 看板字段名（ProjectV2 的 Priority 单选项）
PRIORITY_FIELD = "Priority"


def _die_degraded(msg):
    sys.stderr.write("degraded: %s\n" % msg)
    print("ISSUE-POLICY: DEGRADED  [%s]" % msg)
    sys.exit(DEG)


def _gh_json(path):
    """用 gh CLI 取 JSON。任何失败 ⇒ 降级。"""
    import subprocess
    try:
        out = subprocess.run(["gh", "api", path], capture_output=True, text=True, timeout=60)
    except Exception as e:  # noqa: BLE001 — 任何取数失败都属"检查自身失败"
        _die_degraded("gh 调用异常: %s" % e)
    if out.returncode != 0:
        _die_degraded("gh api %s 失败(exit %d): %s" % (path, out.returncode, (out.stderr or "")[:160]))
    try:
        return json.loads(out.stdout or "null")
    except Exception as e:  # noqa: BLE001
        _die_degraded("载荷非 JSON: %s" % e)


def load_live(repo, pr):
    """取 PR + 其 closingIssuesReferences + 每个 issue 的 labels。"""
    owner, _, name = repo.partition("/")
    if not owner or not name:
        _die_degraded("--repo 形态应为 owner/name")
    q = (
        '{repository(owner:"%s",name:"%s"){pullRequest(number:%d){'
        "closingIssuesReferences(first:20){nodes{number title labels(first:50){nodes{name}}}}}}}"
        % (owner, name, pr)
    )
    import subprocess
    try:
        out = subprocess.run(["gh", "api", "graphql", "-f", "query=" + q],
                             capture_output=True, text=True, timeout=60)
    except Exception as e:  # noqa: BLE001
        _die_degraded("gh graphql 异常: %s" % e)
    if out.returncode != 0:
        _die_degraded("gh graphql 失败: %s" % (out.stderr or "")[:160])
    try:
        prd = json.loads(out.stdout)["data"]["repository"]["pullRequest"]
    except Exception as e:  # noqa: BLE001
        _die_degraded("graphql 载荷形态异常: %s" % e)
    issues = []
    for n in (prd.get("closingIssuesReferences") or {}).get("nodes") or []:
        issues.append({"number": n.get("number"), "title": n.get("title"),
                       "labels": [l["name"] for l in (n.get("labels") or {}).get("nodes") or []]})
    return {"closing_issues": issues, "pr_priority": None}


def load_from_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
    except Exception as e:  # noqa: BLE001
        _die_degraded("读 --from-json 失败: %s" % e)
    if not isinstance(d, dict):
        _die_degraded("--from-json 顶层应为对象")
    return {"closing_issues": d.get("closing_issues") or [], "pr_priority": d.get("pr_priority")}


def check_labels(issue):
    """返回 (violations, prio)。prio = None 或 0..3（越小越高）。"""
    labs = issue.get("labels") or []
    v = []
    kinds = [x for x in labs if KIND_RE.match(x)]
    areas = [x for x in labs if AREA_RE.match(x)]
    prios = [x for x in labs if PRIO_RE.match(x)]
    if len(kinds) != 1:
        v.append("Issue #%s 的 `kind/*` 应为**恰好 1 个**，实得 %d 个 %s"
                 % (issue.get("number"), len(kinds), kinds))
    if len(areas) < 1:
        v.append("Issue #%s 缺 `area/*`（应 ≥1）" % issue.get("number"))
    if len(prios) > 1:
        v.append("Issue #%s 的 `p0-p3` 应 ≤1 个，实得 %d 个 %s"
                 % (issue.get("number"), len(prios), prios))
    prio = int(PRIO_RE.match(prios[0]).group(1)) if len(prios) == 1 else None
    return v, prio


def main():
    ap = argparse.ArgumentParser(description="P3 Issue 作为工作单元 · 判据")
    ap.add_argument("--repo")
    ap.add_argument("--pr", type=int)
    ap.add_argument("--from-json")
    ap.add_argument("--project-json", help="可选的 PR 看板字段快照（含 Priority）")
    a = ap.parse_args()

    if a.from_json:
        payload = load_from_json(a.from_json)
    elif a.repo and a.pr:
        payload = load_live(a.repo, a.pr)
    else:
        _die_degraded("需 `--from-json <file>` 或 `--repo <owner/name> --pr <N>`")

    if a.project_json:
        try:
            with open(a.project_json, encoding="utf-8") as fh:
                payload["pr_priority"] = (json.load(fh) or {}).get(PRIORITY_FIELD)
        except Exception as e:  # noqa: BLE001
            _die_degraded("读 --project-json 失败: %s" % e)

    issues = payload["closing_issues"]
    fails = []

    # ── R1: 必须关联 ≥1 个 Issue ──
    if not issues:
        fails.append("R1 PR 未关联任何 Issue（closingIssuesReferences 为空）⇒ 无工作单元")
        print("  ❌ R1: PR 关联 Issue 数 = 0（应 ≥1）")
    else:
        print("  ✅ R1: PR 关联 Issue 数 = %d" % len(issues))

    # ── R2: 每个 Issue 的标签契约 ──
    prios = []
    for it in issues:
        v, p = check_labels(it)
        if v:
            fails.extend(v)
            for x in v:
                print("  ❌ R2: %s" % x)
        else:
            print("  ✅ R2: Issue #%s 标签契约成立（kind×1 / area≥1 / p≤1）" % it.get("number"))
        if p is not None:
            prios.append(p)

    # ── R3: Priority 一致性（PR == 最高优先级的关联 Issue）──
    # 🔴 夹具负对照抓出的缺陷（本次自查）: 原实现只看"有没有 prios"，漏了
    #   「**PR 声明了 Priority，但关联 Issue 一个 `p0-p3` 都没有**」这一支 ——
    #   按判据「PR 的 Priority = 最高 resolving Issue 的 Priority」，Issue 没有优先级时
    #   PR 就不该有 ⇒ 这是**不一致**，不是 SKIP。
    if issues and not prios and payload.get("pr_priority"):
        fails.append("R3 PR Priority=%s 但关联 Issue 无任何 `p0-p3`（PR 优先级无来源）"
                     % payload.get("pr_priority"))
        print("  ❌ R3: PR Priority=%s 但关联 Issue 无 `p0-p3` ⇒ 优先级无来源" % payload.get("pr_priority"))
    elif not issues or not prios:
        print("  ⏭️  R3: SKIP —— 无关联 Issue 或无 `p0-p3` 标签 ⇒ **不冒充通过**（不代表合规）")
    elif not payload.get("pr_priority"):
        print("  ⏭️  R3: SKIP —— 未提供 PR 看板 Priority 快照（需 PROJECT_TOKEN 读 ProjectV2）")
    else:
        want = "p%d" % min(prios)
        got = str(payload["pr_priority"]).strip()
        if got != want:
            fails.append("R3 PR Priority=%s ≠ 最高优先级关联 Issue 的 %s" % (got, want))
            print("  ❌ R3: PR Priority=%s ≠ 期望 %s（= 最高优先级的关联 Issue）" % (got, want))
        else:
            print("  ✅ R3: PR Priority=%s == 最高优先级关联 Issue 的 %s" % (got, want))

    if fails:
        print("ISSUE-POLICY: VIOLATION(%d)  [%s]" % (len(fails), "; ".join(fails)[:200]))
        sys.exit(VIOL)
    print("ISSUE-POLICY: OK  [issues %d / r3 %s]"
          % (len(issues), "checked" if payload.get("pr_priority") else "skipped"))
    sys.exit(OK)


if __name__ == "__main__":
    main()
