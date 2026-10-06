#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ═══════════════════════════════════════════════════════════════════════════════
# aggregate-job-results.py — W3/D1165「跳过=成功」通道根治器
#
# 治的病（实测 as_of 2026-10-06）: 最近 40 条 ci.yml run 里，success 的 11 条中
#   核心 hermetic step 被 skip **10/11 = 90.9%**；另有 run 含 skipped job 却整体 success。
#   GitHub 的语义是 `skipped` ∈ {success-ish}（不阻断必需 context）⇒ **跳过被当成功**。
#   本器把「跳过」重新判成 FAIL，作聚合 job `all-checks-passed` 的判定体。
#
# 契约（铁律 47）
#   @input  --needs-json <path|->    GitHub `toJSON(needs)` 的落盘内容（`-` = stdin）
#           或 env NEEDS_JSON      同上（内联）
#           --event <name>          或 env EVENT_NAME；GitHub 事件名（push / pull_request /
#                                   merge_group / schedule / workflow_dispatch）
#           --allow-skip <job>[:<event>]  显式「不适用」白名单项，可重复。
#                                  不给该参数时使用**内置口径**（见下 NOT_APPLICABLE）。
#   @output 逐条 `ALLOW-SKIP <job>: …`（白名单放行）与 `::error title=all-checks-passed::<job> = <result>`
#           （判红）；末行固定三态之一:
#             `ALL-CHECKS-PASSED: OK  [success <n> / allow-skip <m> / event <e>]`
#             `ALL-CHECKS-PASSED: FAIL(<n>)  [success <s> / allow-skip <m>]`
#             `ALL-CHECKS-PASSED: DEGRADED  [<原因>]`
#   @exit   0 = 全绿（含白名单跳过）；1 = 有 job 非 success 且不在白名单（**跳过判 FAIL**）；
#           2 = 执行失败/降级（入参缺失或非法、JSON 不可解析）—— fail-closed，**2 绝不等于通过**
#   @degraded 入参缺失 / JSON 非法 ⇒ stderr `degraded: <原因>` + exit 2
#
# 内置白名单口径（**唯一一条**，理由必须可核）:
#   `checker-review`（job `name:` = `Checker Review (maker/checker)`）在**非 pull_request** 事件下
#   不适用 —— 该 job 自身声明 `if: github.event_name == 'pull_request' || startsWith(github.ref, 'refs/heads/feat/')`，
#   而 push 只在 main 触发（`on.push.branches: [main]`）、merge_group 的 ref 形如
#   `refs/heads/gh-readonly-queue/…`、schedule/dispatch 走默认分支 ⇒ 四类事件下它结构上必然 skipped。
#   ⇒ 白名单**按 (job, event) 成对**表达，不用"job 一刀切"。其余任何 job 在任何事件下 skipped ⇒ FAIL。
#
# 三态纪律（M-02）: 0/1/2 如上；禁 `|| true` 吞崩溃；判红逐条点名，不汇总成一句。
# ═══════════════════════════════════════════════════════════════════════════════
import argparse
import json
import os
import sys

OK, VIOL, DEG = 0, 1, 2

# 内置「不适用」白名单：**只收结构上必然 skipped 的 (job, event) 对**，逐条附理由。
NOT_APPLICABLE = {
    ("checker-review", "push"): "该 job 声明 if: github.event_name == 'pull_request'，push 只走 main",
    ("checker-review", "merge_group"): "同上；merge_group 的 ref 非 refs/heads/feat/*",
    ("checker-review", "schedule"): "同上；schedule 走默认分支",
    ("checker-review", "workflow_dispatch"): "同上；dispatch 走默认分支",
}


def main(argv=None):
    ap = argparse.ArgumentParser(description="all-checks-passed 聚合判定体（skipped = FAIL）")
    ap.add_argument("--needs-json", default=None,
                    help="toJSON(needs) 落盘路径，`-` = stdin；缺省回落 env NEEDS_JSON")
    ap.add_argument("--event", default=None, help="GitHub 事件名；缺省回落 env EVENT_NAME")
    ap.add_argument("--allow-skip", action="append", default=None,
                    help="显式白名单项 `job` 或 `job:event`，可重复；给出即**取代**内置口径")
    args = ap.parse_args(argv)

    # ── 入参（fail-closed）───────────────────────────────────────────────────
    raw = None
    if args.needs_json == "-":
        raw = sys.stdin.read()
    elif args.needs_json:
        try:
            raw = open(args.needs_json, encoding="utf-8").read()
        except Exception as e:
            print("degraded: --needs-json 不可读: %s (%s)" % (args.needs_json, e), file=sys.stderr)
            print("ALL-CHECKS-PASSED: DEGRADED  [--needs-json 不可读]")
            return DEG
    else:
        raw = os.environ.get("NEEDS_JSON")
    if raw is None or raw.strip() == "":
        print("degraded: 缺 needs 数据（--needs-json / NEEDS_JSON 均未给）——fail-closed，不静默放行",
              file=sys.stderr)
        print("ALL-CHECKS-PASSED: DEGRADED  [缺 needs 数据]")
        return DEG
    try:
        needs = json.loads(raw)
    except Exception as e:
        print("degraded: needs JSON 不可解析: %s" % e, file=sys.stderr)
        print("ALL-CHECKS-PASSED: DEGRADED  [needs JSON 非法]")
        return DEG
    if not isinstance(needs, dict) or not needs:
        print("degraded: needs 非对象或为空（job 列表为空 ⇒ 无以判定）——fail-closed", file=sys.stderr)
        print("ALL-CHECKS-PASSED: DEGRADED  [needs 空]")
        return DEG

    event = args.event if args.event is not None else os.environ.get("EVENT_NAME", "")
    if not event:
        print("degraded: 缺 --event / EVENT_NAME（白名单按事件成对表达，无事件无法判定）", file=sys.stderr)
        print("ALL-CHECKS-PASSED: DEGRADED  [缺事件名]")
        return DEG

    if args.allow_skip is None:
        allowed = set(NOT_APPLICABLE.keys())
        reasons = NOT_APPLICABLE
    else:
        allowed = set()
        reasons = {}
        for item in args.allow_skip:
            if ":" in item:
                job, ev = item.split(":", 1)
                allowed.add((job, ev)); reasons[(job, ev)] = "--allow-skip 显式给出"
            else:
                allowed.add((item, event)); reasons[(item, event)] = "--allow-skip 显式给出（限本事件）"

    ok_n, allow_n, bad = 0, 0, []
    for name in sorted(needs):
        result = (needs.get(name) or {}).get("result")
        if result == "success":
            ok_n += 1
            continue
        if result == "skipped" and (name, event) in allowed:
            allow_n += 1
            print("ALLOW-SKIP %s: 事件 %s 下不适用 —— %s" % (name, event, reasons.get((name, event), "")))
            continue
        bad.append((name, result))

    for name, result in bad:
        print("::error title=all-checks-passed::%s = %s（跳过 = 失败；W3 口径：skipped 不得被当 success）"
              % (name, result))

    if bad:
        print("ALL-CHECKS-PASSED: FAIL(%d)  [success %d / allow-skip %d / event %s]"
              % (len(bad), ok_n, allow_n, event))
        return VIOL
    print("ALL-CHECKS-PASSED: OK  [success %d / allow-skip %d / event %s]" % (ok_n, allow_n, event))
    return OK


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as _e:            # 未预期异常必须显式降级（fail-closed），不得装成 OK
        print("degraded: 内部错误 %s: %s" % (type(_e).__name__, _e), file=sys.stderr)
        print("ALL-CHECKS-PASSED: DEGRADED  [内部错误]")
        sys.exit(DEG)
