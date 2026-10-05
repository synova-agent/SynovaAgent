#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/attach.py — D314 SessionStart 轻量 attach

控制塔独立化底座（设计文档 §三 D314 + §四 验收 #3/#13）:
  新 session 启动时自动运行（不常驻）:
    ① session_registry.register（身份登记）
    ② runtime.log + gate.log 写入（日志五件套激活）
    ③ self-health.py 轻量跑（health.json）
    ④ brief 存在且 brief-filled → check-plan-integrity.sh --brief（brief 契约前置，D962 第二批并入）
    ⑤ incident.log 未闭环提示
    ⑥ 写 session 专属 current-brief（.claude/current-brief.<sid>，D329）
    ⑦ 并行模式检测提示（D307）: registry 有活跃 session 或 --parallel, 且当前
       非 worktree → 提示用 worktree 隔离。只提示绝不 os.chdir（决策点 2:
       SessionStart hook 无法改变宿主进程 cwd）。

全组件 try/except → fail-open，总时长 <2s（超时降级，绝不拖慢会话启动）。

用法: python3 attach.py --session-id <id> [--tool <tool>] [--brief <path>] [--parallel]
支持 SYNO_CT_DIR 注入（测试隔离）。

D539: 启用延迟注解求值（from __future__ import annotations）——本模块用 `str | None`
等 PEP 604 联合类型注解，Python 3.9 缺 `X | Y` 运行时求值（TypeError），导致此前
attach.py 在本机 Python 3.9 下全程无法加载（hook-session-start.sh 的调用被 2>/dev/null
静默吞掉 → CT-42 的 current-brief.<sid> 写入从未真正执行）。延迟求值（字符串化注解）
是 PEP 563 官方兼容手段，Python 3.10+ 下语义不变，3.9 下可加载，便于本模块的
「不 clobber」（D539）改动做真实行为验证。
"""
from __future__ import annotations

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

# D316: 同 incident-loop.py — Git 安装仅 Git\cmd 入 PATH 时 bash 不在 PATH，
# subprocess.run(["bash", ...]) WinError 2 → attach ④ 静默跳过。显式查找修复。
GIT_BASH_CANDIDATES = (
    r"C:\Program Files\Git\bin\bash.exe",
    r"C:\Program Files\Git\usr\bin\bash.exe",
)

GIT_CANDIDATES = (
    r"C:\Program Files\Git\cmd\git.exe",
    r"C:\Program Files\Git\bin\git.exe",
)


def _find_bash() -> str | None:
    """解析 bash 可执行路径（不依赖进程 PATH）— 找不到返回 None（fail-open）。"""
    found = shutil.which("bash")
    if found:
        return found
    for cand in GIT_BASH_CANDIDATES:
        if os.path.exists(cand):
            return cand
    return None


def _find_git() -> str | None:
    """解析 git 可执行路径（不依赖进程 PATH）— 找不到返回 None（fail-open）。"""
    found = shutil.which("git")
    if found:
        return found
    for cand in GIT_CANDIDATES:
        if os.path.exists(cand):
            return cand
    return None


def _bash_env(bash: str) -> dict:
    """构造 subprocess 环境 — 同 incident-loop.py: check-plan-integrity --brief 依赖
    cat/grep（Git coreutils）+ python3。MSYS bash PATH 分隔符是 ':'。"""
    root = Path(bash).parent.parent
    if root.name == "usr":
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
        if len(s) > 1 and s[1] == ":":
            s = "/" + s[0].lower() + s[2:]
        msys.append(s)
    env = dict(os.environ)
    env["PATH"] = ":".join(msys + [env.get("PATH", "")])
    return env

# fail-open 降级记录（复用既有 degraded-events.log）
def _degraded(component: str, reason: str) -> None:
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        with (LOGS_DIR / "degraded-events.log").open("a", encoding="utf-8") as f:
            f.write(json.dumps({
                "time": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
                "component": component, "reason": reason,
            }, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _run_register(session_id: str) -> None:
    """① session_registry.register（fail-open）。"""
    try:
        sys.path.insert(0, str(REPO_ROOT / "scripts" / "control-tower"))
        from session_registry import SessionRegistry
        reg = SessionRegistry(
            registry_path=CT_DIR / "session-registry.json",
            lock_dir=CT_DIR / "locks",
            degraded_log=LOGS_DIR / "degraded-events.log",
        )
        reg.register(session_id=session_id, brief="", pid=os.getpid())
        reg.phase(session_id=session_id, phase="CP1")
    except Exception as exc:
        _degraded("attach.register", str(exc))


def _run_logs(session_id: str, tool: str) -> None:
    """② runtime.log + gate.log（fail-open）。"""
    try:
        from control_tower_log import log_runtime, log_gate
        log_runtime(command=f"attach --session {session_id}", result="ok")
        log_gate(session=session_id, action="session-start", skip=0, result="ok")
    except Exception as exc:
        _degraded("attach.logs", str(exc))


def _run_health() -> None:
    """③ self-health 轻跑（fail-open）。"""
    try:
        import subprocess
        subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "control-tower" / "self-health.py")],
            capture_output=True, timeout=5, env={**os.environ, "SYNO_CT_DIR": str(CT_DIR)},
        )
    except Exception as exc:
        _degraded("attach.health", str(exc))


def _run_parseable(brief: str | None) -> None:
    """④ brief 契约前置（fail-open）。"""
    if not brief:
        return
    try:
        import subprocess
        bash = _find_bash()
        if bash is None:
            _degraded("attach.parseable", "bash 不可用 — 跳过 brief 契约检查 (fail-open)")
            return
        subprocess.run(
            # D962-B 第二批: check-brief-parseable.sh 退役，判定逐字并入 check-plan-integrity.sh --brief
            [bash, str(REPO_ROOT / "scripts" / "check-plan-integrity.sh"), "--brief", brief],
            capture_output=True, timeout=10, env=_bash_env(bash),
        )
    except Exception as exc:
        _degraded("attach.parseable", str(exc))


def _run_current_brief_snapshot(session_id: str, brief: str | None) -> None:
    """D329: 写 session 专属 current-brief（.claude/current-brief.<sid>）。

    session 专属 current-brief 的写入方（dev doc §3.1/§6 DS5）。内容 = brief
    文件名（对齐全局 current-brief 格式，resolver 读同名格式）。来源优先
    --brief 参数，否则快照全局 current-brief（会话启动时的活跃 brief）；
    均无 → 不写（无 brief 可快照，不产生空文件）。fail-open: 写失败仅
    degraded 记录，绝不阻断会话启动（铁律 24/31）。

    D539（CT-42 写侧闭环）: 若 current-brief.<sid> 已存在则跳过（不 clobber）——
    task-start.sh 在任务启动时写 current-brief.<sid> 是权威写方（最新 brief），
    attach 的 SessionStart snapshot 若覆盖它会把最新指向冲成过期。已存在 →
    尊重 task-start 权威写入，绝不覆盖（Anthropic: 写方一致性）。
    """
    try:
        target = REPO_ROOT / ".claude" / f"current-brief.{session_id}"
        if target.exists():
            return  # D539: 已存在 → 不 clobber（task-start 为权威写方）
        brief_name = Path(brief).name if brief else None
        if not brief_name:
            global_cb = REPO_ROOT / ".claude" / "current-brief"
            if global_cb.exists():
                brief_name = global_cb.read_text(
                    encoding="utf-8", errors="replace"
                ).strip() or None
        if not brief_name:
            return
        target.write_text(brief_name + "\n", encoding="utf-8")
    except Exception as exc:
        _degraded("attach.current-brief", str(exc))


def _in_worktree(root: Path) -> bool:
    """链接 worktree 判定: absolute-git-dir != git-common-dir（D307）。

    主 worktree 两者相同; 链接 worktree 的 gitdir 指向 <主>/.git/worktrees/<name>。
    探测失败 → False（fail-open, 不误提示）。"""
    try:
        import subprocess
        git = _find_git()
        if git is None:
            return False

        def _rev(arg: str) -> str:
            return subprocess.run(
                [git, "-C", str(root), "rev-parse", arg],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
            ).stdout.strip()

        def _abs(p: str) -> Path:
            path = Path(p)
            return path.resolve() if path.is_absolute() else (root / path).resolve()

        gitdir = _rev("--absolute-git-dir")
        commondir = _rev("--git-common-dir")
        if not gitdir or not commondir:
            return False
        return _abs(gitdir) != _abs(commondir)
    except Exception:
        return False


def _detect_parallel(reg, session_id: str, force: bool = False) -> bool:
    """并行模式: --parallel 显式声明, 或 registry 存在其他活跃 session
    （非 self、非 DONE、last_seen 24h 内）。任何异常 → False（fail-open）。"""
    if force:
        return True
    try:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        for s in reg.list():
            if s.get("session_id") == session_id:
                continue
            if s.get("phase") == "DONE":
                continue
            try:
                last = datetime.fromisoformat(s.get("last_seen_at", ""))
                if last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                if (now - last).total_seconds() > 86400:
                    continue
            except (ValueError, TypeError):
                continue
            return True
    except Exception:
        pass
    return False


def _run_parallel_hint(session_id: str, force: bool = False) -> None:
    """⑦ 并行模式检测提示（D307）: registry 有活跃 session 或 --parallel, 且当前
    非 worktree → 打印提示 + degraded 记录。绝不 os.chdir（SessionStart hook
    无法改变宿主进程 cwd — 决策点 2: 不能做的不假装做, 显式提示代替）。"""
    try:
        sys.path.insert(0, str(REPO_ROOT / "scripts" / "control-tower"))
        from session_registry import SessionRegistry
        reg = SessionRegistry(
            registry_path=CT_DIR / "session-registry.json",
            lock_dir=CT_DIR / "locks",
            degraded_log=LOGS_DIR / "degraded-events.log",
        )
        if _detect_parallel(reg, session_id, force=force) and not _in_worktree(REPO_ROOT):
            print(
                "[attach] ⚠ 并行模式: registry 存在其他活跃 session 且当前不在 worktree 内 — "
                "共享暂存区有劫持风险 (D320/D330 历史)。建议: "
                "python scripts/control-tower/worktree-manager.py create <sid>"
            )
            _degraded("attach.parallel-hint", "parallel mode detected outside worktree")
    except Exception as exc:
        _degraded("attach.parallel-hint", str(exc))


def _run_incident_hint(session_id: str) -> None:
    """⑤ 未闭环 incident 提示（fail-open）。"""
    try:
        log_path = LOGS_DIR / "incident.log"
        if not log_path.exists():
            return
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        if not lines:
            return
        last = json.loads(lines[-1])
        print(f"[attach] 最近 incident: {last.get('id', '?')} ({last.get('rootCause', '?')}) — 详见 incident.log")
    except Exception:
        pass


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="D314 SessionStart attach")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--tool", default="session-start")
    parser.add_argument("--brief", default=None)
    parser.add_argument("--parallel", action="store_true")
    args = parser.parse_args()

    start = time.time()
    _run_register(args.session_id)
    _run_current_brief_snapshot(args.session_id, args.brief)
    _run_logs(args.session_id, args.tool)
    _run_health()
    _run_parseable(args.brief)
    _run_parallel_hint(args.session_id, force=args.parallel)
    _run_incident_hint(args.session_id)
    elapsed = time.time() - start
    print(f"[attach] session {args.session_id} attached ({elapsed:.1f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
