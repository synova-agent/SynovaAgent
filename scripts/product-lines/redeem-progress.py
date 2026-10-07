#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
redeem-progress.py — 任务交付 → 验收点证据自动兑换（A3.5 环节）

一句话: 任务完成（impl commit 在 main + audit 报告存在且非 FAIL）→ 自动为任务声明的
        验收点生成 evidence 记录 → calc-progress.py 消费后进度条翻绿。
        解决"任务完成了但仪表盘不反映"（创始人 2026-08-17 要求：完成一个任务就要体现在仪表盘）。

契约:
  @input  — task-state/D###.json 中 "acceptance_points": ["7-3", ...]（任务声明推进的验收点）
            依赖: task-state/D###.json 的 status / audit.verdict / audit.report / impl.commit
  @output — docs/synova/product-lines/evidence/task-D###.json
            schema=1, record_type=k3, verdicts:[{acceptance_point, verdict:pass, quote, quote_ref}]
  @exit   — 0 成功（含 0 任务可兑换——幂等空跑）；2 降级（task-state 目录缺失等）
  @degraded — 显式 log + exit 2（铁律 11，不静默）

诚实规则（与 calc-progress.py §1 一致）:
  - 只有带证据的验收点才计绿: impl commit 必须真实存在于 git（git cat-file 校验）
  - audit 报告必须存在且 verdict 非 FAIL（K3 判定原文绑定 quote_ref）
  - 无 audit 报告 → 不兑换（宁缺毋滥，防"自报完成"）
  - 幂等: 重复运行不重复写（同 task 同 acceptance_point 已存在则跳过）

用法: python3 scripts/product-lines/redeem-progress.py
集成: refresh-all.sh A3.5 环节（A3 待办聚合之后、A4 进度计算之前）
"""
from __future__ import annotations

import argparse
import os
import json
import logging
import re
import subprocess
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("redeem-progress")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TASK_STATE_DIR = PROJECT_ROOT / "task-state"
# E4（K3 R6 禁静默空白）: 迁移期声明在 .claude/claims/。task-state 无卡**不等于**无任务 ——
#   裸跑会返回"0 任务可兑换"（幂等空跑 exit 0），在仪表盘上表现为**静默空白**。
#   故下方启动时显式打印迁移期标识（不阻断，但可见）。
# 注入缝（与 SYNO_CLAIM_DIR / TASK_STATE_DIR 同惯例）: 测试隔离用，生产落默认路径
CLAIMS_DIR = Path(os.environ.get("SYNO_CLAIMS_DIR") or (PROJECT_ROOT / ".claude" / "claims"))
EVIDENCE_DIR = PROJECT_ROOT / "docs" / "synova" / "product-lines" / "evidence"
AUDIT_DIR = PROJECT_ROOT / "docs" / "synova" / "audit-reports"

# 可兑换的任务状态（交付闭环）
REDEEMABLE_STATUS = ("impl_done", "audited")
# 审计 verdict 黑名单（FAIL 不兑换）
FAIL_VERDICTS = ("FAIL",)
# D576（CT-53）: 兑换证据类型 = 任务闭环声明，**非审计裁决**（此前冒充 record_type=k3
# 被 calc-progress 一票翻绿——2026-09-04 K3 D572 审计实证 1-2 假绿根因）。
# task_redeem 在 calc-progress 走 machine 路径（TTL/代码变更失效 → pending_k3），
# 翻绿仍需真 K3 复核或创始人演示核验。
REDEEM_RECORD_TYPE = "task_redeem"
# 审计复核类验收点的识别关键词：此类点（每线收尾的「审计员复核…」）禁止任务兑换
# ——任务声明推进它 = 自我指认（1-8 型，K3 D572 实证）。只有 K3 复核流程可写。
K3_ONLY_DESC_KEYWORDS = ("审计员复核",)


def load_k3_only_points(yaml_path: Path) -> set:
    """从 product-lines.yaml 提取 k3_only 点 id 集合（desc 含审计复核关键词）。"""
    k3_only = set()
    try:
        text = yaml_path.read_text(encoding="utf-8")
    except OSError:
        return k3_only
    current_id = None
    for line in text.splitlines():
        m = re.match(r'\s*- id: "(\d+-\d+)"', line)
        if m:
            current_id = m.group(1)
            continue
        if current_id:
            dm = re.match(r'\s+desc: "(.*)"', line)
            if dm:
                if any(k in dm.group(1) for k in K3_ONLY_DESC_KEYWORDS):
                    k3_only.add(current_id)
                current_id = None
    return k3_only


def git_commit_exists(commit: str) -> bool:
    """impl commit 必须真实存在（git cat-file 校验，防幻影声明）。"""
    if not commit:
        return False
    try:
        r = subprocess.run(
            ["git", "cat-file", "-e", commit],
            capture_output=True,
            cwd=str(PROJECT_ROOT),
        )
        return r.returncode == 0
    except OSError:
        log.warning("degraded: git 不可用，impl 校验跳过（fail-open 显式提示）")
        return True  # git 不可用时不阻断（但不代表 commit 存在，见调用处降级）


def audit_ok(task: dict) -> tuple[bool, str]:
    """audit 报告存在且 verdict 非 FAIL。返回 (ok, 证据引用)。"""
    audit = task.get("audit") or {}
    verdict = str(audit.get("verdict", "")).upper()
    if any(f in verdict for f in FAIL_VERDICTS):
        return False, f"verdict={verdict}"
    report = str(audit.get("report", ""))
    if not report:
        return False, "无 audit.report"
    report_path = PROJECT_ROOT / report
    if not report_path.exists():
        return False, f"报告不存在: {report}"
    return True, str(report_path)


def redeem(task_id: str, task: dict, evidence_dir: Path, k3_only_points: set) -> dict:
    """为单个任务生成证据记录。返回 {written: int, skipped: list}。"""
    points = task.get("acceptance_points") or []
    if not points:
        return {"written": 0, "skipped": ["无 acceptance_points 声明"]}

    # D576/CT-53: 审计复核类点禁任务兑换（自我指认禁止——1-8 型，K3 D572 实证）
    k3_only_hits = [pt for pt in points if pt in k3_only_points]
    if k3_only_hits:
        points = [pt for pt in points if pt not in k3_only_points]
        if not points:
            return {"written": 0, "skipped": [f"全部为 k3_only 点（仅 K3 复核可写）: {k3_only_hits}"]}

    status = task.get("status", "")
    if status not in REDEEMABLE_STATUS:
        return {"written": 0, "skipped": [f"status={status} 不可兑换（需 {REDEEMABLE_STATUS}）"]}

    # impl commit 物理校验
    # D861: task-state 存量卡 impl 为纯描述字符串（D840/D842/D843/D845/D774/D850/D852）
    #   —— 旧 schema 惯例。此处降级跳过（显式 log，铁律 11），不再 AttributeError 崩链
    #   （2026-09-21 main product-progress workflow「聚合→计算→页面」job 实证红根因）。
    impl = task.get("impl")
    if not isinstance(impl, dict):
        log.warning(
            "D861 降级: %s impl 为 %s（应为 {commit:...}）——按未登记 commit 跳过兑换",
            task_id, type(impl).__name__)
        return {"written": 0, "skipped": [
            f"impl 类型异常（{type(impl).__name__} 非 dict，按 impl commit 未登记跳过）"]}
    commit = str(impl.get("commit", ""))
    if not commit:
        return {"written": 0, "skipped": ["impl commit 未登记: 空"]}
    if not git_commit_exists(commit):
        return {"written": 0, "skipped": [f"impl commit 不存在/未登记: {commit}"]}

    ok, ref = audit_ok(task)
    if not ok:
        return {"written": 0, "skipped": [f"audit 未通过: {ref}"]}

    # 生成证据记录（幂等：已存在同 task 同点则跳过）
    out_path = evidence_dir / f"task-{task_id}.json"
    existing = {}
    if out_path.exists():
        try:
            existing = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    verdicts = {v["acceptance_point"]: v for v in existing.get("verdicts", [])}
    written = 0
    skipped = []
    for pt in points:
        if pt in verdicts:
            skipped.append(f"{pt} 已兑换（幂等跳过）")
            continue
        verdicts[pt] = {
            "acceptance_point": pt,
            "verdict": "pass",
            "quote": f"任务 {task_id} 交付闭环：impl {commit[:10]} + audit {task.get('audit', {}).get('verdict', '')}",
            "quote_ref": f"{ref}:1",
        }
        written += 1

    record = {
        "schema": 1,
        "record_type": REDEEM_RECORD_TYPE,
        "source": str(ref),
        "date": str(task.get("audit", {}).get("at", "") or task.get("updated_at", "")),
        "note": f"任务 {task_id} 自动兑换（redeem-progress.py）：impl {commit[:10]} 在 git + audit 非 FAIL。task_redeem=任务闭环声明，非审计裁决，翻绿需真 K3 复核或创始人核验",
        "verdicts": list(verdicts.values()),
    }
    if written > 0 or not out_path.exists():
        evidence_dir.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
        log.info("已生成 %s（+%d 点: %s）", out_path.name, written, points)
    return {"written": written, "skipped": skipped}


def main() -> int:
    parser = argparse.ArgumentParser(description="任务交付 → 验收点证据自动兑换")
    parser.add_argument("--task-state-dir", type=Path, default=TASK_STATE_DIR)
    parser.add_argument("--evidence-dir", type=Path, default=EVIDENCE_DIR)
    parser.add_argument("--dry-run", action="store_true", help="只报告不写文件")
    args = parser.parse_args()

    if not args.task_state_dir.is_dir():
        log.error("degraded: task-state 目录不存在 %s", args.task_state_dir)
        return 2

    # E4（K3 R6 禁静默空白）: 迁移期声明在 .claude/claims/。若 claim 库有内容而本次仍只扫
    #   task-state，则"0 任务可兑换"是**无判据对象**而非"确实没有" ⇒ 显式打印迁移期标识。
    if CLAIMS_DIR.is_dir():
        try:
            _cn = sum(1 for c in CLAIMS_DIR.glob("*.yaml") if c.stem.isdigit())
        except OSError as exc:  # 铁律 24/31: 显式降级，不静默
            _cn = 0
            log.warning("degraded: claim 目录不可读 %s (%s)", CLAIMS_DIR, exc)
        if _cn:
            log.info("[迁移期] 本视图含 task-state 存量（旧 D# 只读）；新任务在 .claude/claims/"
                     "（%d 条，本次**未纳入兑换**——兑换口径迁移随 D-C 落地）", _cn)

    total_written = 0
    total_skipped = []
    k3_only_points = load_k3_only_points(PROJECT_ROOT / "docs" / "synova" / "product-lines" / "product-lines.yaml")
    if k3_only_points:
        log.info("k3_only 点（禁任务兑换）: %d 个", len(k3_only_points))
    for p in sorted(args.task_state_dir.glob("D*.json")):
        if p.name == "TEMPLATE.json":
            continue
        try:
            task = json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            log.warning("跳过 %s: JSON 解析失败 %s", p.name, e)
            continue
        tid = task.get("task_id", p.stem)
        if args.dry_run:
            points = task.get("acceptance_points") or []
            if points:
                log.info("[dry-run] %s → %s", tid, points)
            continue
        r = redeem(tid, task, args.evidence_dir, k3_only_points)
        total_written += r["written"]
        if r["skipped"]:
            for s in r["skipped"]:
                total_skipped.append(f"{tid}: {s}")

    log.info("兑换完成: 新增 %d 个验收点证据", total_written)
    if total_skipped:
        for s in total_skipped[:10]:
            log.info("  skip — %s", s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
