#!/usr/bin/env python3
"""
gen-cto-health.py — CTO 健康仪表盘（第③面）生成器 v0.1 (D381, 2026-08-16)

一句话: 把"项目健康三信号"从 CTO 手工聚合变成一行命令刷新的渲染产物。
        CTO 开工先读 docs/synova/CTO-HEALTH.md —— 回答:
        "门禁被绕过几次? 哪类错误复发? 防线是否系统性失效?"

数据源:
  @input  — .claude/bypass.log (二进制安全读: 绕过/阻断/降级/超时事件)
          + .claude/pre-commit-failures.log (门禁拒绝提交)
          + docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md
            (§二 M 模式复发表 + §三 CT 改进队列)
  @output — docs/synova/CTO-HEALTH.md (Markdown)
            AUTO marker 内脚本生成 (禁止手写); MANUAL marker 内 CTO 备注保留

健康判定 (v0.1 简单规则):
  🟢 绿 — 24h 内无 detected-bypass 且 pre-commit 拒绝 < 10 次/24h 且无 M 复发
  🟡 黄 — 无绕过但有 DEGRADED/TIMEOUT 或拒绝次数异常
  🔴 红 — 24h 内有 detected-bypass 或 M 模式复发 (防线系统性失效)

幂等: 自动区无变化 -> 不写文件 (mtime 不变, 防提交噪音)。
首次运行: 无 marker 的旧文件整体迁入 MANUAL 区。

用法:
  python gen-cto-health.py              # 生成
  python gen-cto-health.py --dry-run    # 只计算不写文件
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO = Path(__file__).resolve().parent.parent.parent
BYpass_LOG = REPO / ".claude" / "bypass.log"
PRE_COMMIT_FAILURES = REPO / ".claude" / "pre-commit-failures.log"
LEDGER = REPO / "docs" / "synova" / "coordination" / "审计发现台账-DSH-CTO.md"
TASK_STATE_DIR = REPO / "task-state"
OUT = REPO / "docs" / "synova" / "CTO-HEALTH.md"

AUTO_START = "<!-- CTO-HEALTH:AUTO:START -->"
AUTO_END = "<!-- CTO-HEALTH:AUTO:END -->"


def read_binary_safe(p: Path) -> str:
    """二进制安全读: bypass.log 含非 UTF-8 字节, 禁止 decode 失败抛异常."""
    if not p.exists():
        return ""
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001 — 生成器降级: 数据源读失败 -> 空 + 标注
        print(f"⚠ 读取失败 {p.name}: {e}", file=sys.stderr)
        return ""


def parse_ts(ts: str) -> Optional[datetime]:
    """兼容两种时间戳: 2026-08-15T01:07:33+08:00 / 2026-08-15T01:07:33Z."""
    ts = ts.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(ts, fmt)
        except ValueError:
            continue
    return None


def analyze_bypass(text: str) -> dict:
    """解析 bypass.log: 事件计数 + 真绕过列表 + 近 7 天分布."""
    events = {"COMMITTED": 0, "DEGRADED": 0, "BLOCKED": 0, "TIMEOUT": 0, "detected-bypass": 0}
    bypasses: List[Tuple[str, str]] = []  # (ts, reason)
    days: dict[str, int] = {}
    now = datetime.now().astimezone()
    last24h = {"COMMITTED": 0, "DEGRADED": 0, "BLOCKED": 0, "TIMEOUT": 0, "detected-bypass": 0}

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        # 旧格式: <ts> detected-bypass <reason>   (07-26~28 时代)
        m = re.match(r"^(\S+)\s+detected-bypass\s+(.*)$", line)
        if m:
            ts, reason = m.group(1), m.group(2)
            events["detected-bypass"] += 1
            bypasses.append((ts, reason))
            dt = parse_ts(ts)
            if dt:
                days.setdefault(dt.strftime("%Y-%m-%d"), 0)
                days[dt.strftime("%Y-%m-%d")] += 1
                if dt.astimezone() >= now - timedelta(hours=24):
                    last24h["detected-bypass"] += 1
            continue
        # 新格式: <ts> | <EVENT> | <detail> | <TASK=..> <AGENT=..> [HASH=..]
        parts = line.split("|")
        if len(parts) >= 2:
            ts = parts[0].strip()
            ev = parts[1].strip()
            if ev in events:
                events[ev] += 1
                dt = parse_ts(ts)
                if dt:
                    days.setdefault(dt.strftime("%Y-%m-%d"), 0)
                    days[dt.strftime("%Y-%m-%d")] += 1
                    if dt.astimezone() >= now - timedelta(hours=24):
                        last24h[ev] += 1

    return {"events": events, "bypasses": bypasses, "days": days, "last24h": last24h}


def analyze_failures(text: str) -> dict:
    """解析 pre-commit-failures.log: 总拒绝数 + 最近 7 天分布."""
    total = 0
    days: dict[str, int] = {}
    last_dt: Optional[str] = None
    for line in text.splitlines():
        line = line.strip()
        if not line or "exit=" not in line:
            continue
        total += 1
        m = re.match(r"^(\S+)", line)
        if m:
            ds = m.group(1)[:10]
            days[ds] = days.get(ds, 0) + 1
            last_dt = ds
    return {"total": total, "days": days, "last": last_dt}


def analyze_ledger(text: str) -> dict:
    """解析台账 §二 M 模式复发表 + §三 CT 队列."""
    m_recur: List[Tuple[str, str, str, str]] = []
    ct = {"done": 0, "wip": 0, "todo": 0}
    # §二 模式归纳表: | M1 | fail-open... | D328 | D329... |
    in_mode = False
    for line in text.splitlines():
        if "模式归纳" in line and "复现的根因类" in line:
            in_mode = True
            continue
        if in_mode:
            if line.startswith("## "):
                in_mode = False
                continue
            if line.startswith("| M") and "|" in line:
                # 转义管道保护: 台账里 `\|\|` 是字面量, split 前占位
                safe = line.replace("\\|", "§PIPE§")
                cells = [c.strip() for c in safe.strip("|").split("|")]
                if len(cells) >= 5:
                    mid, name, first, again, defense = cells[0], cells[1], cells[2], cells[3], cells[4]
                    name = name.replace("§PIPE§", "\\|")
                    again = again.replace("§PIPE§", "\\|")
                    if again and again not in ("—", "-", "", "首次"):
                        m_recur.append((mid, name, first, again))
    # §三 CT 队列状态列 (表头: # | 项 | 来源 | 状态)
    for line in text.splitlines():
        if line.startswith("| CT-"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) >= 4:
                status = cells[3]
                if "✅" in status:
                    ct["done"] += 1
                elif any(x in status for x in ("🔄", "🔧", "📝")):
                    ct["wip"] += 1
                else:
                    ct["todo"] += 1
    return {"m_recur": m_recur, "ct": ct}


def _head_tracked_files():
    """D412/U3: 一次性取 HEAD 已提交文件集（仓库态），供 phantom 校验.

    契约:
      @input  — 无（读 REPO 的 git HEAD）
      @output — set[str]（HEAD 已提交文件相对路径, posix）；None = git 不可用（degraded）
      @degraded — git 不可用/非 git 仓库 → 返回 None（调用方据此降级，不静默当全部已提交）
    性能: 单次 git ls-tree，进程内匹配（延续 D393 不逐文件起子进程）.
    """
    try:
        out = subprocess.run(
            ["git", "ls-tree", "-r", "HEAD", "--name-only"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=30, cwd=REPO,
        )
        if out.returncode != 0:
            return None
        return set(out.stdout.splitlines())
    except Exception:  # noqa: BLE001
        return None


def resolve_audit_report(num, audit_dict, audit_dir, is_committed):
    """CT-58 机制侧（D579）: 解析任务 D# 的审计报告路径。

    @input  — num: int（D 编号）; audit_dict: task-state 的 audit 块（可 None）
              audit_dir: Path; is_committed: Callable[[Path], bool]（D412 口径注入）
    @output — (report_path|None, source: "state"|"filename"|None)
              ① audit_dict["report"] 存在且文件在盘且已提交 HEAD → 权威采信（"state"）
              ② 否则回落现有文件名 glob（*D{num}.md / *D{num}[a-z].md，"filename"，现状语义）
              ③ 均无 → (None, None)
    @degraded — state 指向的文件缺失/未提交/越出仓库根 → 静默回落 filename（回落本身是
                既定语义链一环，不新增降级态；调用方 verdict 解析失败路径维持现状）
    @contract — 与 redeem-progress.py L108-113 同一信任源（audit.report 权威，路径按仓库根解析）；
                不新增 phantom 机制（D412 口径复用 is_committed 注入，兜底候选同样过滤）。
    """
    # ① task-state audit.report 显式字段优先（audit 流程自己写的事实源，非文件名猜测）
    if isinstance(audit_dict, dict):
        report = str(audit_dict.get("report") or "").replace("\\", "/")
        if report:
            f = REPO / report
            try:
                # normpath 折叠 ".." 后做词法包含校验——防路径越出仓库根（is_committed 内部
                # relative_to 会炸；且 D412 口径只对仓内路径有意义）
                f = Path(os.path.normpath(str(f)))
                f.relative_to(REPO)
                if f.is_file() and is_committed(f):
                    return f, "state"
            except ValueError:
                pass  # 越出仓库根 → 不采信 state，回落 filename
    # ② 文件名 glob 兜底（现状语义: 精确 *D{num}.md 优先, 其次 *D{num}[a-z].md D395a 变体;
    #    候选同样过 is_committed——未提交工件不采信，phantom 判定留给调用方）
    if audit_dir.is_dir():
        candidates = sorted(audit_dir.glob(f"*D{num}.md")) or sorted(audit_dir.glob(f"*D{num}[a-z].md"))
        for f in candidates:
            if is_committed(f):
                return f, "filename"
    # ③ 均无
    return None, None


def analyze_task_state() -> Tuple[list, dict]:
    """D393: 状态从工件自动派生 — 不靠人工维护 status (防失真, GitHub/Linear 同哲学).

    派生规则 (每任务):
      spec  ← dev doc 存在 (docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D#-*.md 或 json spec.path)
      impl  ← git 提交含该 D# (git log --all 精确 (D#) 匹配) 或 json impl.commit 可解析
      audit ← docs/synova/audit-reports/ 含 D# 的报告存在 → 解析 verdict
      status← 组合: 全空=claimed / spec→spec_done / +impl→impl_done / +audit→audited
    json 人工 status/spec/impl/audit 字段被派生结果覆盖 (仅 FIX 指向/title 保留人工).
    """
    tasks = []
    phantom_n = 0
    if not TASK_STATE_DIR.exists():
        return tasks, {"phantom": 0, "repo_degraded": False}
    # 一次采集工件索引 (D393: 全量一次, 进程内匹配, 不逐任务起子进程)
    impl_hits = set()  # 含 (D#) 的提交里的 D#
    try:
        log = subprocess.run(["git", "log", "--all", "--format=%s"],
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=30, cwd=REPO).stdout
        for line in log.splitlines():
            # impl = 任务有提交（feat/fix/docs/ci 均算交付——提交即完成证据）
            m = re.search(r"\(D(\d{3})\)", line)
            if m:
                impl_hits.add(int(m.group(1)))
    except Exception:  # noqa: BLE001 — git 不可用 → 派生降级
        impl_hits = set()
        print('⚠ degraded: git log 不可用, impl 派生降级为空集 (D399 P2-1)', file=sys.stderr)
    # D412/U3: phantom 校验 — spec/audit 工件以 git HEAD 仓库态为准（已提交才算真）;
    # 工作区有但未提交 = phantom（不计真, 记 phantom 集合供 degraded 标记）.
    head_files = _head_tracked_files()
    repo_degraded = head_files is None
    if repo_degraded:
        print('⚠ degraded: git 不可用, spec/audit phantom 校验降级——按工作区处理 (D412)', file=sys.stderr)

    def _committed(f) -> bool:
        # git 不可用(repo_degraded) → 当已提交(不制造假 phantom, 整体已 degraded); 否则须在 HEAD 文件集
        return repo_degraded or f.relative_to(REPO).as_posix() in head_files

    spec_files = set()
    phantom_spec = set()  # 工作区有但未提交 HEAD 的 dev doc D#
    impl_dir = REPO / "docs" / "plans" / "codex" / "implementation"
    if impl_dir.exists():
        for f in impl_dir.glob("SYNOVA-IMPL-D*.md"):
            m = re.search(r"D(\d{3})", f.name)
            if m:
                (spec_files if _committed(f) else phantom_spec).add(int(m.group(1)))
    audit_files = set()
    phantom_audit = set()  # 工作区有但未提交 HEAD 的 audit 报告 D#
    audit_dir = REPO / "docs" / "synova" / "audit-reports"
    if audit_dir.exists():
        for f in audit_dir.glob("*.md"):
            m = re.search(r"D(\d{3})", f.name)
            if m:
                (audit_files if _committed(f) else phantom_audit).add(int(m.group(1)))

    seen_nums = set()  # 方案 B: 记录 task-state 已覆盖的 D#，循环后补 git 派生历史任务
    for p in sorted(TASK_STATE_DIR.glob("*.json")):
        if p.name == "TEMPLATE.json":
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8", errors="replace"))
        except Exception:  # noqa: BLE001
            tasks.append({"task_id": p.stem, "title": "?", "status": "broken", "note": "json 解析失败"})
            continue
        tid = d.get("task_id", p.stem)
        m = re.search(r"D(\d{3})", tid)
        num = int(m.group(1)) if m else None
        if num is not None:
            seen_nums.add(num)
# 派生判定 (工件优先; json 字段兜底展示但不算真)
        # D399 (P1-2)/D400: spec = glob 扫描 OR json spec.path 兜底（文件必须真实存在——存在即算真, 消除幻影）
        # D412/U3: json spec.path 分支同样过仓库态校验（工作区存在 且 已提交 HEAD）
        # D962-B2: task-state 实测存在 spec 为字符串的存量 JSON（.get("path") 即崩，
        #          main 上既有崩溃）——isinstance 守卫，异常数据不拖垮整板生成（铁律 24）
        _spec = d.get("spec")
        spec_path = _spec.get("path") if isinstance(_spec, dict) else None
        spec_path_ok = bool(
            spec_path
            and (REPO / spec_path).exists()
            and (repo_degraded or spec_path.replace("\\", "/") in head_files)
        )
        has_spec = num in spec_files or spec_path_ok
        # phantom: 工作区有 spec 工件但未提交 HEAD（glob 到 phantom 或 json path 存在但未提交）
        spec_phantom = (not has_spec) and (
            num in phantom_spec
            or bool(spec_path and (REPO / spec_path).exists())
        )
        has_impl = num in impl_hits  # D399: 纯派生, json impl 字段 deprecated 忽略
        audit_txt = "—"
        # D579（CT-58）: 报告解析唯一入口 = resolve_audit_report——task-state audit.report
        # 显式字段优先（D412 口径），文件名 glob 兜底（批次报告中间 D# 不再隐形）
        rep_path, _rep_src = resolve_audit_report(num, d.get("audit"), audit_dir, _committed)
        if rep_path is not None:
            try:
                txt = rep_path.read_text(encoding="utf-8", errors="replace")
                # D395a verdict 优先序不变: CONDITIONAL PASS > PASS > FAIL > ?
                if "CONDITIONAL PASS" in txt:
                    audit_txt = "CONDITIONAL_PASS"
                elif "PASS" in txt:
                    audit_txt = "PASS"
                elif "FAIL" in txt:
                    audit_txt = "FAIL"
                else:
                    audit_txt = "?"
            except OSError:
                pass  # 读取失败 → 维持 "—"（不可读不计真，D412 口径）
        elif num in phantom_audit:
            audit_txt = "⚠phantom"  # D412: 工作区有 audit 报告但未提交 HEAD（不计真）
        # 状态组合 (D393): audit 优先 — 有审计报告即 audited (控制塔/CTO 批次无 spec 也成立)
        if audit_txt != "—":
            status = "audited"
        elif has_impl:
            status = "impl_done"
        elif has_spec:
            status = "spec_done"
        else:
            status = "claimed"
        tasks.append({
            "task_id": tid,
            "title": (d.get("title") or "")[:28],
            "status": status,
            "spec": "✅" if has_spec else ("⚠" if spec_phantom else "—"),
            "impl": "✅" if has_impl else "—",
            "audit": audit_txt,
            "fix": d.get("fix_task_id") or "",
        })
        if spec_phantom or audit_txt == "⚠phantom":
            phantom_n += 1
    # 方案 B (2026-08-18 创始人): git 有、task-state 无的历史任务补录（全项目视野，不只 Mac 侧）
    for num in sorted(impl_hits - seen_nums):
        tid = "D%03d" % num
        audit_txt_hist = "—"
        if num in audit_files:
            audit_txt_hist = "✅"
        tasks.append({
            "task_id": tid,
            "title": "(历史任务)",
            "status": "impl_done",
            "spec": "—",
            "impl": "✅",
            "audit": audit_txt_hist,
            "fix": "",
        })
    return tasks, {"phantom": phantom_n, "repo_degraded": repo_degraded}


def analyze_ci() -> dict:
    """CT-41①: CI 状态入仪表盘 — GitHub API 匿名拉最近 runs. 失败降级."""
    runs = []
    try:
        import urllib.request
        url = "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/runs?per_page=8"
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read().decode("utf-8"))
        for run in d.get("workflow_runs", [])[:8]:
            runs.append({"num": run.get("run_number"), "conclusion": run.get("conclusion") or "pending",
                         "title": (run.get("display_title") or "")[:50], "branch": (run.get("head_branch") or "")[:25]})
        return {"runs": runs, "degraded": False}
    except Exception:  # noqa: BLE001
        return {"runs": [], "degraded": True}


def verdict(bypass: dict, fail: dict, m_recur: list) -> str:
    """健康判定 (v0.1: 红=物理绕过; 黄=历史复发/降级需确认; 绿=干净)."""
    if bypass["last24h"]["detected-bypass"] > 0:
        return "🔴 红 — 24h 内有绕过 (detected-bypass), 防线被击穿, 升级创始人"
    if m_recur:
        return "🟡 黄 — 历史有 M 模式复发记录 (见 §三; 多为 D328-D331 已闭环项, 需 CTO 确认无新增)"
    if bypass["last24h"]["DEGRADED"] + bypass["last24h"]["TIMEOUT"] > 3:
        return "🟡 黄 — 24h 内降级/超时事件较多, 检查门禁执行体"
    if bypass["last24h"]["BLOCKED"] > 0 or fail["total"] > 0:
        return "🟡 黄 — 门禁有拒绝记录 (正常拦截, 关注频率)"
    return "🟢 绿 — 无绕过, 门禁在拦截, 防线健康"


def render(bypass: dict, fail: dict, ledger: dict, tasks: list, ci: dict = None) -> str:
    ci = ci or {"runs": [], "degraded": True}
    v = verdict(bypass, fail, ledger["m_recur"])
    ev = bypass["events"]
    l24 = bypass["last24h"]
    now = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
    recent_days = sorted(bypass["days"].keys())[-7:]

    lines = [
        "## CTO 健康仪表盘（第③面）— 自动区",
        f"> 生成: {now} | 数据源: bypass.log / pre-commit-failures.log / AUDIT-FINDINGS-LEDGER",
        "",
        f"**总体判定: {v}**",
        "",
        "### 一、门禁执行（bypass.log 全历史）",
        "",
        "| 事件 | 全量 | 24h 内 |",
        "|------|:---:|:---:|",
        f"| COMMITTED（正常提交） | {ev['COMMITTED']} | {l24['COMMITTED']} |",
        f"| BLOCKED（被门禁拒绝） | {ev['BLOCKED']} | {l24['BLOCKED']} |",
        f"| DEGRADED（降级放行） | {ev['DEGRADED']} | {l24['DEGRADED']} |",
        f"| TIMEOUT（超时） | {ev['TIMEOUT']} | {l24['TIMEOUT']} |",
        f"| **detected-bypass（真绕过）** | **{ev['detected-bypass']}** | **{l24['detected-bypass']}** |",
        "",
        f"近 7 天事件: " + (" | ".join(f"{d}:{bypass['days'].get(d, 0)}" for d in recent_days) if recent_days else "无"),
        "",
    ]
    if bypass["bypasses"]:
        lines.append("**绕过历史（全部）** — 集中在 07-26~28（旧 marker 时代），此后零绕过：")
        for ts, reason in bypass["bypasses"]:
            lines.append(f"- `{ts}` {reason}")
        lines.append("")
    else:
        lines.append("✅ 全历史零绕过。")
        lines.append("")

    lines += [
        "### 二、门禁拒绝（pre-commit-failures.log）",
        "",
        f"- 累计拒绝: **{fail['total']}** 次 | 最近: {fail['last'] or '无'}",
        "- 阈值: >10 次/24h → 门禁过激警告（健康审计项）",
        "",
        "### 三、M 模式复发（AUDIT-FINDINGS-LEDGER §二）",
        "",
    ]
    if ledger["m_recur"]:
        lines.append("| 模式 | 名称 | 首次 | 再次 |")
        lines.append("|------|------|------|------|")
        for mid, name, first, again in ledger["m_recur"]:
            lines.append(f"| {mid} | {name} | {first} | {again} |")
        lines.append("")
        lines.append("> ⚠️ 复发 = 同类错误第二次出现 = 防线系统性失效，按红线升级创始人。")
        lines.append("")
    else:
        lines.append("✅ 无 M 模式复发。")
        lines.append("")

    ct = ledger["ct"]
    lines += [
        "### 四、CT 改进队列（台账 §三）",
        "",
        f"- ✅ 已完成 {ct['done']} · 🔄 进行中 {ct['wip']} · ⏳ 未排 {ct['todo']}",
        "",
    ]

    # D382: 任务状态汇总 (task-state/)
    lines += [
        "### 五、任务状态汇总（task-state/，D382）",
        "",
        "| 任务 | 状态 | spec | impl | audit | FIX |",
        "|------|------|:---:|:---:|:---:|------|",
    ]
    if tasks:
        active_tasks = [t for t in tasks if t["title"] != "(历史任务)"]
        hist_tasks = [t for t in tasks if t["title"] == "(历史任务)"]
        for t in active_tasks:
            lines.append(f"| {t['task_id']} | {t['status']} | {t['spec']} | {t['impl']} | {t['audit']} | {t['fix']} |")
        lines.append("")
        if hist_tasks:
            hist_audited = sum(1 for t in hist_tasks if t["audit"] == "✅")
            lines.append(f"> 📦 历史任务（已折叠）: **{len(hist_tasks)}** 个（git log 全项目派生，非 task-state 登记；{hist_audited} 个有审计报告）")
            lines.append("> 这些是 task-state 未登记、但 git 里确有提交的全项目任务（D5~D398 早期 + Win/Codex 侧），状态按 impl 派生。")
            lines.append("")
    else:
        lines.append("| — | 无 task-state 文件 | | | | |")
        lines.append("")

    # CT-41①: CI 状态段
    lines += [
        "### 六、CI 状态（CT-41①, GitHub API）",
        "",
        "| Run | 结论 | 分支 | 标题 |",
        "|-----|------|------|------|",
    ]
    if ci.get("runs"):
        for r in ci["runs"]:
            mark = "🟢" if r["conclusion"] == "success" else ("🔴" if r["conclusion"] == "failure" else "🟡")
            lines.append(f"| #{r['num']} | {mark} {r['conclusion']} | {r['branch']} | {r['title']} |")
        lines.append("")
    else:
        lines.append("| — | ⚠ 无法拉取（degraded） | | |")
        lines.append("")
    # CT-39: CI 红超 24h 告警（接入 check-ci-stale-red.sh，红常态化信号失效 M1 同型）
    try:
        import subprocess as _sp
        _sr = _sp.run(["bash", str(REPO / "scripts/control-tower/ct-health.sh"), "ci-stale-red", "--json"],
                      capture_output=True, text=True, timeout=30, cwd=REPO)
        if _sr.returncode == 1 and _sr.stdout.strip():
            _sd = json.loads(_sr.stdout.strip())
            lines.append(f"> 🔴 **CT-39 红灯告警**: main CI run #{_sd.get('run')} 已红 {_sd.get('age_hours')}h（>24h），信号失效——待办见 docs/synova/coordination/CI-STALE-RED.md")
            lines.append("")
        elif _sr.returncode == 0 and _sr.stdout.strip():
            _sd = json.loads(_sr.stdout.strip())
            if _sd.get("stale") is False and "age_hours" in _sd:
                lines.append(f"> CI 红灯监测: main 红 {_sd.get('age_hours')}h（<24h 阈值），暂不告警（CT-39）")
                lines.append("")
    except Exception:  # noqa: BLE001
        pass  # stale red 检测降级不影响主表
    # worktree 收尾检测（2026-08-21 冻结决策必修项）：孤儿 worktree 有独有提交未合并
    try:
        import subprocess as _sp2
        _ow = _sp2.run(["bash", str(REPO / "scripts/control-tower/ct-health.sh"), "orphan-worktrees", "--json"],
                       capture_output=True, text=True, timeout=30, cwd=REPO)
        if _ow.returncode == 1 and _ow.stdout.strip():
            _od = json.loads(_ow.stdout.strip())
            _cnt = _od.get("orphan_count", 0)
            if _cnt > 0:
                lines.append(f"### 九、worktree 收尾（2026-08-21 必修）")
                lines.append("")
                lines.append(f"- 🔴 **{_cnt} 个孤儿 worktree 有待收尾**（独有提交未合并进 main，可能是未收尾的交付）")
                for o in _od.get("orphans", [])[:10]:
                    lines.append(f"  - {o.get('path','?')} (分支 {o.get('branch','?')}, {o.get('unmerged',0)} 个独有提交)")
                lines.append("")
                lines.append("> 处理: 确认独有提交是否该合并（真交付）→ worktree-manager finish 或 merge 进 main；过时则删除。")
                lines.append("")
    except Exception:  # noqa: BLE001
        pass  # 孤儿检测降级不影响主表
    lines += [
        "> 红线提醒: 不碰 scripts/audit/；不写审计标准；禁止自我审计。",
        "> 同类错误第二次出现 = 防线系统性失效，升级创始人。",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="CTO 健康仪表盘生成器")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--strict", action="store_true", help="phantom 检出即 exit 1（供 CI/门禁）")
    args = ap.parse_args()

    raw_b = read_binary_safe(BYpass_LOG)
    raw_f = read_binary_safe(PRE_COMMIT_FAILURES)
    raw_l = read_binary_safe(LEDGER)
    b = analyze_bypass(raw_b)
    f = analyze_failures(raw_f)
    l = analyze_ledger(raw_l)
    t, ts_meta = analyze_task_state()
    ci = analyze_ci()

    # D384/CT-37: 数据源指纹 — bypass/failures/ledger/task-state 内容 hash.
    # 幂等判定 = 指纹比较: 数据源未变 → 不重写 (时间戳差异不影响);
    # 数据源变了 → 重写 (产物与数据源一致性).
    import hashlib
    ts_files = []
    if TASK_STATE_DIR.exists():
        ts_files = sorted(str(p) for p in TASK_STATE_DIR.glob("*.json") if p.name != "TEMPLATE.json")
    fp_src = raw_b + raw_f + raw_l + "".join(read_binary_safe(Path(p)) for p in ts_files) + read_binary_safe(Path(__file__))
    fingerprint = hashlib.sha256(fp_src.encode("utf-8", errors="replace")).hexdigest()[:12]

    auto = render(b, f, l, t, ci)
    # 幂等 + marker 保留 MANUAL 区
    if OUT.exists():
        old = OUT.read_text(encoding="utf-8", errors="replace")
        if AUTO_START in old and AUTO_END in old:
            manual = old.split(AUTO_END, 1)[1]
            body = f"{AUTO_START}\n{auto}\n{AUTO_END}{manual}"
        else:
            body = f"{AUTO_START}\n{auto}\n{AUTO_END}\n<!-- CTO-HEALTH:MANUAL:START -->\n(CTO 备注区)\n<!-- CTO-HEALTH:MANUAL:END -->\n"
    else:
        body = f"{AUTO_START}\n{auto}\n{AUTO_END}\n<!-- CTO-HEALTH:MANUAL:START -->\n(CTO 备注区)\n<!-- CTO-HEALTH:MANUAL:END -->\n"

    full = f"# Synova CTO 健康仪表盘（第③面）\n\n> 打开即真相。生成: {datetime.now().astimezone().strftime('%Y-%m-%d %H:%M:%S')} | 数据源指纹: {fingerprint}\n\n{body}"
    # D412/U3: 三态退出码（统一判定，覆盖 dry-run/幂等/写入所有路径）
    exit_code = 0
    if ts_meta["repo_degraded"]:
        print('⚠ degraded: git 仓库态校验不可用 (D412)', file=sys.stderr)
        exit_code = 2
    elif args.strict and ts_meta["phantom"] > 0:
        print(f"❌ phantom: {ts_meta['phantom']} 个任务工件工作区存在但未提交 HEAD (--strict)", file=sys.stderr)
        exit_code = 1
    if args.dry_run:
        print(full)
        return exit_code
    if OUT.exists():
        old = OUT.read_text(encoding="utf-8", errors="replace")
        import re as _re
        old_fp = _re.search(r"数据源指纹: ([0-9a-f]{12})", old)
        if old_fp and old_fp.group(1) == fingerprint:
            print(f"幂等: 数据源指纹 {fingerprint} 未变, 不写文件")
            return exit_code
    OUT.write_text(full, encoding="utf-8")
    print(f"已生成: {OUT} (指纹 {fingerprint})")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
