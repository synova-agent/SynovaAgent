#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/staging_guard.py — D311 暂存区隔离 (M1b)

控制塔 V4.6.0 M1b: 提交前校验暂存区 — 防止 D286 卷走 D300 暂存类事故
（A session 的 git commit 把 B session 已暂存的文件一并提交）。

判定逻辑（优先级）:
  0. 认领制（D329）: 暂存文件被"真实认领 brief（Q2 include 命中）的 D# ≠ 本 session
     任务 D#"认领 → **block**（独立防线，不依赖 registry 登记时序；own_set 判定之前）
  1. 暂存文件 ∈ 他人活跃 session 写集 → **block**（输出 owner 归属）
  2. 暂存文件 ∈ 自己写集 → pass
  3. 暂存文件无任何认领 → **warn**（stray_files，不硬阻断）
  4. 他人文件但已 committed → pass（忽略 committed 条目）

fail-open（铁律 24/31 + 设计文档 §2.1.5）:
  - registry 缺失/损坏 → pass + degraded 标记 + degraded-events.log，绝不静默
  - 自身异常 → exit 0 + degraded（不阻断业务）

用法:
  staging_guard.py --session-id <id> --staged <file>... [--json]
退出码: 0 = pass/warn/degraded, 1 = block
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "control-tower"))

from session_registry import (  # noqa: E402
    DEFAULT_DEGRADED_LOG,
    SessionRegistry,
    log_degraded,
)


def _is_claim_path(path: str) -> bool:
    """声明路径是否为 claim 文件（`.claude/claims/<issue>.yaml`）。"""
    return path.endswith(".yaml") and Path(path).parent.name == "claims"


def _declared_identity(brief: str) -> str:
    """从**声明路径**取任务身份：claim → `#<issue>`；legacy brief → `D<#>`。

    契约:
      @input  brief: 声明文件路径（claim .yaml 或 brief .md）
      @output 归一化身份串（`D329` / `#1234`）；取不到 → ""
      @降级   无（纯字符串判定）
    """
    if _is_claim_path(brief):
        stem = Path(brief).stem
        return f"#{stem}" if stem.isdigit() else ""
    m = re.search(r"D\d+", Path(brief).stem)
    return m.group(0) if m else ""


def _declared_identity_id(session_id: str, brief: str) -> str:
    """从 session/task-id 取身份，**按声明形态对齐口径**（claim → issue；legacy → D#）。

    为什么按声明形态而不是"两种都试": 若 claim 声明配 D# session（或反之），
    说明调用方还在旧口径 —— 该场景必须**显式不判定**（返回空 → 跳过），
    由 G12/commit-msg 的 D328 侧去拦；在 stagin guard 里"跨口径模糊匹配"
    会产生假阳性阻断（误伤正常提交），比漏拦更贵。
    """
    s = session_id or ""
    if _is_claim_path(brief):
        try:
            sys.path.insert(0, str(REPO_ROOT / "scripts" / "control-tower"))
            from claim_store import parse_issue  # noqa: E402
            v = parse_issue(s)
            return f"#{v}" if v else ""
        except ImportError:
            # 降级: claim_store 不可用 → 退回内联口径（不静默丢判定）
            m = re.search(r"#?(\d{1,7})", s)
            return f"#{m.group(1)}" if m else ""
    m = re.search(r"D\d+", s)
    return m.group(0) if m else ""


def check_staging(
    reg: SessionRegistry,
    session_id: str,
    staged_files: List[str],
) -> dict:
    """校验暂存文件归属。返回 {status: pass|warn|block, ...}。

    判定优先级:
      1. 文件 ∈ 他人活跃写集（未 committed）→ block
      2. 文件 ∈ 自己写集 → pass
      3. 文件曾被他人在 registry 声明但已 committed → pass（他人已提交，不再占用）
      4. 文件无任何注册记录 → warn（stray，不硬阻断 — brief 可能过时）
      5. registry 缺失/自身异常 → degraded pass（fail-open）
    """
    result = {
        "status": "pass",
        "foreign_files": [],
        "stray_files": [],
        "degraded": False,
    }

    # ── D329: 认领制硬校验 — 文件被"认领 brief 的 D# ≠ 本 session 任务 D#"认领 → block ──
    # 必须放在 own_set 放行之前：否则 synova-commit 的 write-set 预登记会让被声明文件
    # 先进 own_set 直接 pass（D329 自查发现的设计缺陷）。registry 写集判定保留（防已登记
    # 占用），认领制判定是独立防线（不依赖登记时序）。session_id 无 D# → 跳过（不误伤）。
    try:
        staged_arg = "\n".join(staged_files)
        # D331 (P2-2): --session 生产接线 — resolver 的 session 专属 current-brief
        # 支持已实现但零生产调用方（KIMI K3 审计: D329 dev doc §5 只要求"resolver
        # 读取"，没要求"生产调用方真实传递"）。本调用是生产唯一调用点（WIRE CHECK
        # 升级: grep "resolve-commit-brief.sh.*--session" scripts/ ≥1 真实命中）。
        claimed = subprocess.run(
            ["bash", str(REPO_ROOT / "scripts/workflow/resolve-commit-brief.sh"), "--session", session_id, staged_arg],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
        ).stdout.strip().splitlines()
        if claimed:
            brief = claimed[0]
            # 防假阳性: 仅当 brief 真实认领 ≥1 个暂存文件才比较 D#（Q2 include 命中）
            try:
                sys.path.insert(0, str(REPO_ROOT / "scripts" / "control-tower"))
                from brief_parser import parse_q2, match_path
                text = Path(brief).read_text(encoding="utf-8", errors="replace")
                inc = parse_q2(text).get("include", [])
                genuine = any(match_path(f, p) for f in staged_files for p in inc)
            except Exception:
                genuine = False
            if genuine:
                # D-C（K3 预审 R1/R4）: 声明载体双形态 —— claim(`.claude/claims/<issue>.yaml`) /
                # legacy brief(`…-D<#>-….md`)。**必须两形态都比对**：只比 D# 时 claim 路径
                # 提不到 D# → 判定被静默跳过（fail-open）＝迁移期劫持防线整体失效。
                # 单源: issue 提取走 claim_store.parse_issue（不在此复制正则）。
                claim_id = _declared_identity(brief)
                sess_id = _declared_identity_id(session_id or "", brief)
                # 精确相等（禁 startswith）: D3290 不能匹配 D329；任一为空 → 跳过认领制判定
                if claim_id and sess_id and claim_id != sess_id:
                    result["status"] = "block"
                    result["foreign_files"].append(
                        {"file": "<staged>", "owner_session": claim_id,
                         "brief": brief,
                         "reason": f"认领声明 {claim_id} 与本 session 任务 {sess_id} 不一致"}
                    )
    except Exception as exc:  # fail-open: 认领判定异常 → degraded 记录，registry 判定兜底
        log_degraded(reg.degraded_log, "staging-guard", f"claim check degraded: {exc}")
        result["degraded"] = True
        result["degraded_reason"] = f"claim check degraded: {exc}"

    try:
        if not reg.registry_path.exists():
            # registry 缺失 → fail-open: pass + degraded（绝不静默）
            log_degraded(
                reg.degraded_log,
                "staging-guard",
                f"registry 缺失: {reg.registry_path}",
            )
            result["degraded"] = True
            result["degraded_reason"] = f"registry 缺失: {reg.registry_path}"
            return result
        sessions = reg.list(active_only=True)
        # D331 (P2-1): 归属判定用 task_id — 同任务并行 session（如分阶段协同）的
        # 写集视同己方（不误伤）；my_task 无（旧注册）→ 回退 session_id 仅判。
        session_tasks = {s["session_id"]: s.get("task_id") for s in sessions}
        my_task = session_tasks.get(session_id)
        own_set = set()
        # 文件 → 声明过它的所有 session（含 committed，用于区分"无记录"与"已提交"）
        declared_by: dict[str, list] = {}
        for s in sessions:
            sid = s["session_id"]
            is_own = (sid == session_id) or (
                my_task is not None and s.get("task_id") == my_task
            )
            if is_own:
                for w in s.get("write_set", []):
                    if w.get("status") != "committed":
                        own_set.add(w["file"].replace("\\", "/").lower())
            for w in s.get("write_set", []):
                declared_by.setdefault(w["file"].replace("\\", "/").lower(), []).append(
                    (sid, w.get("status"))
                )

        for f in staged_files:
            norm = f.replace("\\", "/").lower()
            if norm in own_set:
                continue  # 2. 自己写集（含同任务 session）→ pass
            decls = declared_by.get(norm, [])
            # 1. 他人活跃占用（未 committed；同任务不视为他人）
            active_others = [
                (sid, st)
                for sid, st in decls
                if sid != session_id
                and not (my_task is not None and session_tasks.get(sid) == my_task)
                and st != "committed"
            ]
            if active_others:
                owner, _ = active_others[0]
                owner_brief = None
                for s in sessions:
                    if s["session_id"] == owner:
                        owner_brief = s.get("brief")
                        break
                result["foreign_files"].append(
                    {"file": f, "owner_session": owner, "brief": owner_brief}
                )
                result["status"] = "block"
            elif decls:
                # 3. 他人在 registry 声明过但已 committed → pass
                continue
            else:
                # 4. 无任何记录 → warn
                result["stray_files"].append(f)
                if result["status"] != "block":
                    result["status"] = "warn"
    except Exception as exc:  # fail-open: 自身异常 → pass + degraded
        log_degraded(reg.degraded_log, "staging-guard", f"check error: {exc}")
        result["degraded"] = True
        result["degraded_reason"] = str(exc)
        result["status"] = "pass"
    return result


def _out(obj: dict) -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    print(json.dumps(obj, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser(description="D311 暂存区隔离校验")
    parser.add_argument("--session-id", required=True, help="当前 session id")
    parser.add_argument("--staged", nargs="*", default=[], help="暂存文件列表")
    parser.add_argument("--json", action="store_true", help="JSON 输出")
    args = parser.parse_args()

    reg = SessionRegistry()
    result = check_staging(reg, args.session_id, args.staged or [])
    _out(result)

    # block → exit 1（硬阻断）；warn/pass/degraded → exit 0
    return 1 if result["status"] == "block" else 0


if __name__ == "__main__":
    sys.exit(main())
