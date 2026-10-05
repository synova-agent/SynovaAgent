#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/incident-loop.py — D314 学习闭环 + D535 循环卫生

设计文档 §2.4: incident → 根因归类 → 规则生成 → 验证 → 防复发。

闭环:
  record  → incident.log 追加 + known-error-patterns.json 匹配
  suggest → 根因 R1-R4 → 机制推荐（门禁/工具/基线/文档）
  verify  → 取已闭环案例跑对应门禁于合成输入 → 被拦 = 闭环成功

D535（2026-08-26）循环卫生 — 重复事故提醒（借鉴 DSH repeat-tool-reminder）:
  record 同 id 重复 → 不再静默 duplicate，返回 repeat_count + reminder +
  last_recorded（"该事故已重复出现 N 次 — 检查机制是否未闭环"），调用方打印提醒不阻断。
  幂等保持: 同 id 不重复追加 incident.log（行数不变）。

根因 R1-R4（设计文档 §1.2）:
  R1 多会话共享工作区无协调
  R2 hook 与 git 操作冲突
  R3 brief 模板与解析器漂移
  R4 存量错误无基线豁免

机制映射:
  R1 → 门禁 verify-parallel.sh / staging_guard.py / wait_manager.py
  R2 → 门禁 hook-git-detect.sh（禁 stash）
  R3 → 工具 check-plan-integrity.sh --brief / brief_parser.py
  R4 → 基线 baseline-check.sh

fail-open: incident.log 不可写 → degraded 记录不阻断。
UTF-8: stdout reconfigure。

循环卫生契约（D535，详见 docs/synova/coordination/控制塔循环卫生标准-20260826.md）:
  ① subprocess 调用必须带 timeout（默认 30s）— verify 已 timeout=10
  ② 重复事故提醒 — record 同 id 重复返回 reminder（本文件）
  ③ 防跑偏信号接线 — staging-guard block → synova-commit 调 record 沉淀
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

REPO_ROOT = Path(__file__).resolve().parents[2]
CT_DIR = Path(os.environ.get("SYNO_CT_DIR", str(REPO_ROOT / ".codex" / "control-tower")))
LOGS_DIR = CT_DIR / "logs"
INCIDENT_LOG = LOGS_DIR / "incident.log"
KNOWN_PATTERNS = REPO_ROOT / ".codex" / "audit" / "known-error-patterns.json"

# D316: Git 安装若未写入 bash 到 PATH（常见: 仅 Git\cmd 入 PATH），须显式查找。
# 先试 PATH（shutil.which），再试平台标准安装路径，最后 None → 调用方 fail-open。
GIT_BASH_CANDIDATES = (
    r"C:\Program Files\Git\bin\bash.exe",
    r"C:\Program Files\Git\usr\bin\bash.exe",
)
# D561 (K3 P1-D535): POSIX 平台 bash 恒存于标准路径（macOS /bin/bash）——
# 原 fallback 仅 Windows 候选，macOS 受限 PATH 下 _find_bash 返回 None → verify 恒
# degraded（incident-loop.test.sh 4b 恒红 7/8）。POSIX 候选使 fallback 跨平台对齐。
POSIX_BASH_CANDIDATES = (
    "/bin/bash",
    "/usr/bin/bash",
    "/usr/local/bin/bash",
    "/opt/homebrew/bin/bash",
)


def _find_bash() -> str | None:
    """解析 bash 可执行路径（不依赖进程 PATH）。

    Why (D316): 纯系统 PATH（CI/任务计划/非 Git Bash 启动的 python）下
    subprocess.run(["bash", ...]) 抛 WinError 2 → verify() 恒 degraded，
    学习闭环的"verify 闭环成功"不可用。修复后任何环境都能解析 Git bash。
    Why (D561): macOS/Linux 下受限于 PATH 时（incident-loop.test.sh 4b），需
    回退 POSIX 标准路径——bash 恒存于 /bin/bash（POSIX 规范），无平台感知
    候选则 macOS 恒 degraded。Windows 候选行为不变（D316 修复保持）。
    """
    found = shutil.which("bash")
    if found:
        return found
    candidates = GIT_BASH_CANDIDATES if os.name == "nt" else POSIX_BASH_CANDIDATES
    for cand in candidates:
        if os.path.exists(cand):
            return cand
    return None


def _bash_env(bash: str) -> dict:
    """构造 subprocess 环境 — hook 依赖链: bash + cat/grep（Git coreutils）+ python3（JSON 解析）。

    实测（D316）: 只修 bash 路径不够 — hook 内 `cat`（Git usr/bin）与 `python3`
    （WindowsApps shim / 系统 Python）在受限 PATH 下 command not found →
    hook 静默 exit 0 → verify 误报 open。必须显式补全 PATH:
      Git bins（usr/bin+bin+cmd+mingw64）→ cat/grep/sed
      sys.executable 目录 + WindowsApps → python3
    MSYS bash 的 PATH 分隔符是 ':'（Windows ';' 会被当作普通字符）。
    D561 (POSIX): macOS/Linux 下 hook 依赖 cat/grep（/bin、/usr/bin）——
    受限 PATH 时同需显式补全 POSIX 标准目录 + python3 目录（Windows 分支不变）。
    D564: Windows CI 实测 6/8（PR #305 run 33257792825 annotations）——
    WindowsApps 的 python3 是 Store 占位 stub（执行即 9009），且被 D316 前置在
    拼接 PATH 中先于原 PATH → hook 内 `python3 -c` 解析到坏 shim → 静默
    exit 0（fail-open）→ verify 误报 open（双 verify 断言失败）。
    治法（第一性原理）: 调用方已知一个确定可用的解释器（sys.executable），
    显式注入 SYNO_PYTHON，hook 不再赌 PATH 解析。POSIX 分支同注入（单一
    语义）；hook 侧 SYNO_PYTHON 缺省时回落原 PATH python3（向后兼容）。
    """
    env = dict(os.environ)
    # D564: 显式注入确定可用的解释器（hook 消费端: scripts/hooks/hook-git-detect.sh）
    if sys.executable:
        env["SYNO_PYTHON"] = sys.executable
    if os.name != "nt":
        # D561: POSIX 平台——hook 依赖链 cat/grep/git 恒在 /bin、/usr/bin（部分
        # brew 工具在 /usr/local/bin、/opt/homebrew/bin）；prepend 标准目录，
        # 保留原 PATH 尾接（受限 PATH 场景下其余依赖经 python3 目录解析）。
        env["PATH"] = ":".join([
            "/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin",
            str(Path(sys.executable).parent),
            env.get("PATH", ""),
        ])
        return env
    root = Path(bash).parent.parent
    if root.name == "usr":          # .../Git/usr/bin/bash.exe → 上移一级
        root = root.parent
    paths = [
        str(root / "usr" / "bin"), str(root / "bin"), str(root / "cmd"),
        str(root / "mingw64" / "bin"),
        str(Path(sys.executable).parent),
        str(Path.home() / "AppData" / "Local" / "Microsoft" / "WindowsApps"),
    ]
    msys = []
    for p in paths:
        s = p.replace("\\", "/")
        if len(s) > 1 and s[1] == ":":   # C:/... → /c/...
            s = "/" + s[0].lower() + s[2:]
        msys.append(s)
    env = dict(os.environ)
    env["PATH"] = ":".join(msys + [env.get("PATH", "")])
    return env

ROOT_CAUSE_MAP = {
    "R1": {"label": "多会话共享工作区无协调", "mechanism": "门禁", "tools": ["verify-parallel.sh", "staging_guard.py", "wait_manager.py"]},
    "R2": {"label": "hook 与 git 操作冲突", "mechanism": "门禁", "tools": ["hook-git-detect.sh"]},
    "R3": {"label": "brief 模板与解析器漂移", "mechanism": "工具", "tools": ["check-plan-integrity.sh --brief", "brief_parser.py"]},
    "R4": {"label": "存量错误无基线豁免", "mechanism": "基线", "tools": ["baseline-check.sh"]},
}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())


def _last_record_time(incident_id: str) -> str | None:
    """查 incident.log 中同 id 的最后一条记录时间（重复提醒用）。

    契约（铁律 47）:
      @input  — incident_id: 事故 id
      @output — 同 id 最后记录时间字符串（ISO8601）或 None（log 不可读/无记录）
      @degraded — log 读取异常 → 返回 None（不抛，调用方降级为无时间戳提醒）
    """
    if not INCIDENT_LOG.exists():
        return None
    try:
        last = None
        for line in INCIDENT_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("id") == incident_id:
                last = rec.get("time")
        return last
    except OSError:
        return None


def _load_known_patterns() -> list:
    """known-error-patterns.json（复用 completion-engine 的规则库）。"""
    try:
        return json.loads(KNOWN_PATTERNS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []


def _match_known(symptom: str) -> list:
    """已知 pattern 匹配（symptom 与 id/name/desc/pattern 关键词双向命中）。"""
    hits = []
    s_lower = symptom.lower()
    for p in _load_known_patterns():
        text = " ".join(str(p.get(k, "")) for k in ("id", "name", "desc", "pattern")).lower()
        # 语义关键词（stash/brief/基线/并行/空构造）命中规则库，或规则 name 出现在 symptom
        semantic = {
            "stash": "stash", "brief": "brief", "模板": "brief",
            "基线": "baseline", "并行": "parallel", "空构造": "空构造",
            "构造函数": "构造函数", "类型导入": "import type",
        }
        matched = False
        for kw_s, kw_t in semantic.items():
            if kw_s in symptom and kw_t in text:
                matched = True
                break
        if matched:
            hits.append(p.get("id", "?"))
    return hits


def record(incident_id: str, symptom: str, root_cause: str,
           sessions: str, fix: str, version: str) -> dict:
    """记录 incident + 匹配已知 pattern。幂等: 同 id 不重复追加。

    契约（铁律 47，D535 补全）:
      @input  — incident_id/symptom/root_cause/sessions/fix/version
      @output — recorded: {status, id, known_patterns?}
                duplicate: {status, id, repeat_count, reminder, last_recorded}
                degraded:  {status, reason}（INCIDENT_LOG 不可写，铁律 24/31）
      @error  — 幂等保持: 同 id 不重复追加 log（repeat_count 从 log 统计）
    """
    # 幂等: 同 id 已存在 → 重复提醒（D535: 非静默 — repeat-tool-reminder 范式）
    existing_ids = set()
    id_count = {}
    if INCIDENT_LOG.exists():
        for line in INCIDENT_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                rid = json.loads(line).get("id", "")
            except json.JSONDecodeError:
                continue
            existing_ids.add(rid)
            id_count[rid] = id_count.get(rid, 0) + 1
    if incident_id in existing_ids:
        # D535: 同 id 重复 record → 显式提醒"该问题反复出现，检查机制是否未闭环"
        last = _last_record_time(incident_id)
        repeat_count = id_count.get(incident_id, 0) + 1
        reminder = (
            f"该事故（{incident_id}）已重复出现 {repeat_count} 次"
            + (f"（上次 {last}）" if last else "")
            + "——检查是否机制未闭环（repeat-tool-reminder 范式，D535）"
        )
        return {
            "status": "duplicate",
            "id": incident_id,
            "repeat_count": repeat_count,
            "reminder": reminder,
            "last_recorded": last,
        }

    # D314: 复用 control_tower_log.py 写入器（五件套格式统一）
    try:
        sys.path.insert(0, str(REPO_ROOT / "scripts" / "control-tower"))
        from control_tower_log import log_incident as _log_incident
        _log_incident(
            incident_id=incident_id, symptom=symptom, root_cause=root_cause,
            sessions=sessions, fix=fix, version=version,
        )
    except Exception:
        # 降级: 直接写（fail-open）
        record_obj = {
            "id": incident_id, "time": _now(), "symptom": symptom,
            "rootCause": root_cause, "sessions": sessions, "fix": fix, "version": version,
        }
        try:
            LOGS_DIR.mkdir(parents=True, exist_ok=True)
            with INCIDENT_LOG.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record_obj, ensure_ascii=False) + "\n")
        except OSError:
            return {"status": "degraded", "reason": "incident.log 不可写"}

    hits = _match_known(symptom)
    result = {"status": "recorded", "id": incident_id}
    if hits:
        result["known_patterns"] = hits
    return result


def suggest(root_cause: str) -> dict:
    """根因 → 机制推荐。"""
    if root_cause not in ROOT_CAUSE_MAP:
        return {"status": "unknown", "root_cause": root_cause}
    info = ROOT_CAUSE_MAP[root_cause]
    return {
        "status": "ok", "root_cause": root_cause,
        "label": info["label"], "mechanism": info["mechanism"], "tools": info["tools"],
    }


def verify(case_id: str) -> dict:
    """验证已闭环案例: 跑对应门禁于合成输入 → 被拦 = 闭环成功。"""
    if case_id == "INC-20260802-stash":
        # D312 真实闭环案例: hook-git-detect 拦截 stash
        import subprocess
        bash = _find_bash()
        if bash is None:
            return {"status": "degraded", "case": case_id,
                    "reason": "bash 不可用 — 无法执行门禁验证 (fail-open)"}
        try:
            # D564r7: 显式 UTF-8 解码——text=True 在 Windows 用 locale 编码（cp1252）
            # 解码 hook 的 UTF-8 输出（含「禁止」），0x81 在 cp1252 未定义 →
            # UnicodeDecodeError → except → degraded → verify 误报 open（真 Win CI
            # 实证：断言 6+4b 双红而 4c 绿，4c 不经本 subprocess）。macOS/Linux
            # locale 本就 UTF-8，行为零变化。errors="replace" 兜底极端字节不抛。
            r = subprocess.run(
                [bash, str(REPO_ROOT / "scripts/hooks/hook-git-detect.sh")],
                input='{"tool_input":{"command":"git stash"}}',
                capture_output=True, text=True, timeout=10,
                encoding="utf-8", errors="replace",
                env=_bash_env(bash),
            )
            out = r.stdout + r.stderr
            if "禁止" in out:
                return {"status": "closed", "case": case_id, "blocked": True,
                        "mechanism": "hook-git-detect.sh"}
            return {"status": "open", "case": case_id, "blocked": False}
        except Exception as exc:
            return {"status": "degraded", "case": case_id, "reason": str(exc)}
    return {"status": "unknown", "case": case_id}


def main() -> int:
    parser = argparse.ArgumentParser(description="D314 学习闭环")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_r = sub.add_parser("record")
    p_r.add_argument("--id", required=True)
    p_r.add_argument("--symptom", required=True)
    p_r.add_argument("--root-cause", required=True)
    p_r.add_argument("--sessions", required=True)
    p_r.add_argument("--fix", required=True)
    p_r.add_argument("--version", default="4.6.0")

    p_s = sub.add_parser("suggest")
    p_s.add_argument("--root-cause", required=True)

    p_v = sub.add_parser("verify")
    p_v.add_argument("--case", required=True)

    args = parser.parse_args()

    if args.cmd == "record":
        result = record(args.id, args.symptom, args.root_cause, args.sessions, args.fix, args.version)
    elif args.cmd == "suggest":
        result = suggest(args.root_cause)
    else:
        result = verify(args.case)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
