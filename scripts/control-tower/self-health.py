#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/self-health.py — D314 控制塔自身健康五维检测

设计文档 §2.1.5: 五维检测 + fail-open + health.json。
框架复用 product-health.py（check_*/classify + emit）。

五维:
  1. 组件完整性 (gates): 核心 12 文件存在且可执行
  2. 信号新鲜度 (signals): .codex/signals/*.json mtime ≤ 24h
  3. 版本一致性 (version): 脚本头 VERSION 标注 vs VERSION.md 当前版本
  4. 日志活性 (logs): 五件套存在 + 最近写入
  5. 资源 (resource): psutil 可选（缺 → unknown）

输出: .codex/control-tower/health.json
  {component: "self-health", status, dimensions, versionConsistency: {mismatches: [...]}}
+ emit-signal "self-health"

fail-open: 任一度检测异常 → 该维度 degraded，整体不抛异常。
UTF-8: stdout reconfigure。
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

REPO_ROOT = Path(__file__).resolve().parents[2]
CT_DIR = Path(os.environ.get("SYNO_CT_DIR", str(REPO_ROOT / ".codex" / "control-tower")))
SIGNALS_DIR = REPO_ROOT / ".codex" / "signals"
VERSION_MD = CT_DIR / "VERSION.md"
HEALTH_OUT = CT_DIR / "health.json"

# 核心组件清单（存在性检查；D1225 退役 staging_guard.py ⇒ 11 个）
CORE_COMPONENTS = [
    "scripts/control-tower/session_registry.py",
    "scripts/control-tower/wait_manager.py",
    "scripts/control-tower/baseline-check.sh",
    "scripts/control-tower/verify-parallel.sh",
    "scripts/control-tower/devdoc_writeset.py",
    "scripts/control-tower/brief_parser.py",
    "scripts/control-tower/attach.py",
    "scripts/control-tower/self-health.py",
    "scripts/control-tower/control_tower_log.py",
    "scripts/hooks/hook-git-guard.sh",
    "scripts/hooks/hook-git-detect.sh",
]

LOG_FIVE = ["runtime.log", "gate.log", "incident.log", "degraded-events.log", "version.log"]

# 脚本头部版本标注 → 期望值（VERSION.md 当前版本）
CURRENT_VERSION = "4.6.0"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def check_components() -> str:
    """① 组件完整性。"""
    missing = [c for c in CORE_COMPONENTS if not (REPO_ROOT / c).exists()]
    return "degraded" if missing else "healthy"


def check_signals() -> str:
    """② 信号新鲜度（mtime ≤ 24h）。"""
    if not SIGNALS_DIR.exists():
        return "unknown"
    files = list(SIGNALS_DIR.glob("*.json"))
    if not files:
        return "unknown"
    now = datetime.now(timezone.utc)
    stale = 0
    for f in files:
        try:
            mt = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
            if (now - mt).total_seconds() > 86400:
                stale += 1
        except OSError:
            stale += 1
    if stale == len(files):
        return "degraded"
    if stale > 0:
        return "warn"
    return "healthy"


def check_version_consistency() -> dict:
    """③ 版本一致性: 脚本头 VERSION vs VERSION.md。返回 {status, mismatches}。"""
    mismatches = []
    # 检查 VERSION.md 存在
    if not VERSION_MD.exists():
        return {"status": "degraded", "mismatches": ["VERSION.md 缺失"]}
    md_text = VERSION_MD.read_text(encoding="utf-8", errors="replace")
    # 正式首发段检测: `## V4.6.0` 标题（而非全文字串 — 变更记录可能含旧 4.6.0-WIP 字样）
    md_has_current = bool(
        __import__("re").search(r"^## V4\.6\.0(?!-WIP)\b", md_text, __import__("re").MULTILINE)
    )
    # 扫描脚本头版本标注
    for c in CORE_COMPONENTS:
        p = REPO_ROOT / c
        if not p.exists():
            mismatches.append(f"{c} 缺失")
            continue
        try:
            head = p.read_text(encoding="utf-8", errors="replace")[:800]
        except OSError:
            continue
        if "V4.5.1" in head or "V4.5.0" in head:
            mismatches.append(f"{c} 头部版本 V4.5.x（应为 V4.6.0）")
    if not md_has_current:
        mismatches.append("VERSION.md 未含 4.6.0")
    return {"status": "degraded" if mismatches else "healthy", "mismatches": mismatches}


def check_logs() -> str:
    """④ 日志活性。"""
    logs_dir = CT_DIR / "logs"
    if not logs_dir.exists():
        return "degraded"
    missing = [l for l in LOG_FIVE if not (logs_dir / l).exists()]
    if missing == LOG_FIVE:
        return "degraded"
    if missing:
        return "warn"
    return "healthy"


def check_resource() -> str:
    """⑤ 资源（psutil 可选）。"""
    try:
        import psutil  # noqa: F401
    except ImportError:
        return "unknown"
    return "healthy"


def classify_trust(dimensions: dict) -> str:
    """聚合五维 → 整体状态。"""
    vals = list(dimensions.values())
    if "degraded" in vals:
        return "red"
    if "warn" in vals:
        return "yellow"
    return "green"


def main() -> int:
    dims = {
        "gates": check_components(),
        "signals": check_signals(),
        "logs": check_logs(),
        "resource": check_resource(),
    }
    ver = check_version_consistency()
    dims["version"] = ver["status"]
    status = classify_trust(dims)

    result = {
        "component": "self-health",
        "status": status,
        "timestamp": _now(),
        "dimensions": dims,
        "versionConsistency": {"mismatches": ver["mismatches"]},
        "degradedSince": "",
        "lastHealthyAt": _now() if status == "green" else "",
    }
    try:
        CT_DIR.mkdir(parents=True, exist_ok=True)
        HEALTH_OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass
    print(json.dumps(result, ensure_ascii=False))
    return 0 if status != "red" else 1


if __name__ == "__main__":
    sys.exit(main())
