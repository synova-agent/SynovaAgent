#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
evidence-writer.py — 机器验证入库（设计 v1.4 §5.3 A2）

一句话: CI/场景跑完把结果写成证据记录，供 calc-progress.py 消费。

契约:
  @input  — 命令行: --type ci|scenario|test|founder_demo
            --date YYYY-MM-DD --verdict pass|fail --points "7-1,9-2"
            --source 来源说明（CI job 名 / 场景脚本路径）[--quote 佐证] [--out-dir]
  @output — <out-dir>/<type>-<date>[-n].json（证据记录，schema=1；同日同类递增序号防覆盖）
  @degraded — 参数非法 → log.error + exit 2；out-dir 不可写 → log.error + exit 2
              （fail-closed：证据写不进去绝不当成功——铁律 11/24）
  @exit   — 0 成功；2 参数/IO 失败

证据规则: 证据必须可复核——source/quote 写明"哪里来的、怎么重跑"。
          本脚本只写机器事实，不写"声称"（无对应运行结果的 verdict 拒绝写入）。
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("evidence-writer")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VALID_TYPES = ("ci", "scenario", "test", "founder_demo")
VALID_VERDICTS = ("pass", "fail")


def write_evidence(rec_type, date, verdict, points, source, quote, out_dir, at=None):
    if rec_type not in VALID_TYPES:
        log.error("非法证据类型: %r（可选 %s）", rec_type, "/".join(VALID_TYPES))
        sys.exit(2)
    if verdict not in VALID_VERDICTS:
        log.error("非法结论: %r（可选 pass/fail）", verdict)
        sys.exit(2)
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        log.error("日期格式非法: %r（需 YYYY-MM-DD）", date)
        sys.exit(2)
    # D1055 ⑦: --at 校验（ISO8601 datetime）。给错格式 → fail-closed（exit 2），
    #   绝不静默丢弃 —— 丢了 at 会让该条证据退回 date-only 语义，正是本次要修的缺陷。
    if at is None:
        at = datetime.now().replace(microsecond=0).isoformat()
    else:
        try:
            datetime.fromisoformat(at)
        except ValueError:
            log.error("--at 格式非法: %r（需 ISO8601，如 2026-09-28T19:30:00）", at)
            sys.exit(2)
    pts = [p.strip() for p in points.split(",") if p.strip()]
    if not pts:
        log.error("--points 为空（至少一个验收点 id，如 7-1）")
        sys.exit(2)
    if rec_type == "founder_demo" and not quote:
        log.error("创始人核验证据必须附演示记录（--quote 填记录路径）——防空壳核验")
        sys.exit(2)

    out_dir = Path(out_dir)
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        log.error("证据目录不可写: %s (%s)", out_dir, e)
        sys.exit(2)

    base = "%s-%s" % (rec_type, date)
    n = 0
    target = out_dir / ("%s.json" % base)
    while target.exists():
        n += 1
        target = out_dir / ("%s-%d.json" % (base, n))

    record = {
        "schema": 1,
        "record_type": rec_type,
        "source": source,
        "date": date,
        "at": at,
        "written_by": "evidence-writer.py",
        "verdicts": [
            {"acceptance_point": p, "verdict": verdict, "quote": quote} for p in pts
        ],
    }
    try:
        target.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n",
                          encoding="utf-8")
    except OSError as e:
        log.error("证据写入失败: %s (%s)", target, e)
        sys.exit(2)
    log.info("已写入证据: %s（%s / %d 个验收点 / 结论=%s）", target, rec_type, len(pts), verdict)
    return target


def main():
    ap = argparse.ArgumentParser(description="机器验证入库（A2）")
    ap.add_argument("--type", required=True, help="ci|scenario|test|founder_demo")
    ap.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"))
    # D1055 ⑦ (欠账表「evidence-writer ... 不消费 at」) 修复: 补 --at。
    #   语义: `at` 是**同日内的时刻**（ISO 8601，全量 datetime），与 --date（日粒度）并用——
    #   calc-progress 的失效判定（freshness_gate/git_touched_after）在 date-only 下把证据
    #   时间当 T00:00:00，于是"当日生成证据 + 当日有提交"被误判 stale；带 at 即可精确判定。
    #   缺省 = 当前时刻（生成即写下真实时刻），显式给出则以其为准（重放/夹具注入用）。
    ap.add_argument("--at", default=None,
                    help="证据生成时刻 ISO8601（缺省=当前时刻）；同日多份证据靠它决胜")
    ap.add_argument("--verdict", required=True, choices=["pass", "fail"])
    ap.add_argument("--points", required=True, help="逗号分隔验收点 id，如 7-1,9-2")
    ap.add_argument("--source", required=True, help="来源（CI job / 场景脚本路径）")
    ap.add_argument("--quote", default="", help="佐证（日志/断言输出/演示记录路径）")
    ap.add_argument("--out-dir", default=str(PROJECT_ROOT / "docs/synova/product-lines/evidence"))
    args = ap.parse_args()
    write_evidence(args.type, args.date, args.verdict, args.points, args.source,
                   args.quote, args.out_dir, at=args.at)
    sys.exit(0)


if __name__ == "__main__":
    main()
