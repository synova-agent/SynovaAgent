#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pr-queue-scan.py — D811 未合 PR 队列台账扫描器（纯读 · 机器算，人只看）

把「未合 PR 队列」变成机械派生指标：每个未合 PR 的 编号 / 标题 / 主人 / behind=N /
CI / age(天) / 可否自动关闭 —— 全部机器算，人不做算术（DSH 决策镜头原则④：机械问题
与业务语义分离；原则⑤：诊断旁路，不污染主路径）。

契约（铁律 47 — 先定义再实现）:
@input   — CLI 参数:
             --repo            owner/name；默认 tangbaobao520/SynovaAgent
             --repo-root       仓库根；默认 = 本脚本上两级目录（本地 git 只读用）
             --limit           队列上限；默认 12（派单 §〇：未合 PR 队列上限 = 12）
             --today           覆盖"今天" YYYY-MM-DD；默认系统日期（确定性注入缝）
             --input           离线夹具/回放：读**归一化记录数组**或本器快照 JSON，
                               跳过全部网络与本地 git（测试与重渲染用）
             --credentials     凭据文件；默认 ~/.dsh/.credentials.yaml（GITHUB_TOKEN）
             --no-local-git    不调用本地 git（behind 走 API；内容比对留 null）
             --no-detail       不拉单 PR 详情（省 1 请求/PR；mergeable/changed_files 留 null）
             --skip-content-check  不做「变更文件是否已逐字节在 main」比对（省 1 请求/PR）
             --only N[,N..]    只扫指定 PR 号（迭代用；默认全量）
             --out-json        快照输出；默认 <repo-root>/docs/synova/project/pr-queue.json
             --out-md          台账 markdown 输出；默认不写
             --print           table | summary | json；默认 table
             --stale-days      「超期」阈值（天）；默认 14（无主超期判定）
             --red-days        「CI 长期红」阈值（天）；默认 7
             --strict          有降级时退出码非零（默认 0）
             --quiet           不打印 stdout 摘要
@output  — ① <out-json> 处快照 JSON（schema "pr-queue-snapshot/1"）:
                schema / generated_by / generated_at / repo / baseline / limit /
                degraded / degraded_sources[] /
                metrics{queue_length, limit, over_limit, oldest{number,age_days},
                        behind_distribution, behind_unknown, ci_distribution,
                        closeable_count, orphan_count, owner_conflicts,
                        owners{attributed,unattributed}, by_reason{}} /
                warning（str|null —— 超限告警文案，advisor 级，不阻断） /
                records[]{number,title,owner,owner_source,owner_conflict,head_ref,head_sha,
                          age_days,behind,ahead,changed_files,draft,mergeable_state,
                          ci_state,ci_failing,ci_total,ci_failing_names,content_in_main,
                          content_signal,files_total,card,card_status,closeable,close_reasons[]}
             ② <out-md>（给了才写）: 台账表 + 可签字关闭清单（机器算好，人只签字）
             ③ stdout: 默认台账表 + 尾行摘要（含超限告警）
@exit    — 0  正常（**含超限** —— 上限只提示不拦死）
             1  --strict 且 degraded
             2  参数非法 / 输出不可写 / 输入不可读 / 非 --input 模式下无凭据
@degraded— 任何一处降级都显式登记（铁律 11/24/31，不静默、不用 0 冒充）:
             · 单 PR compare 失败 → behind/ahead=null + degraded_sources 记 source
             · 单 PR check-runs 失败 → ci_state="unknown"（**不是 "none"**）+ 记 source
             · 单 PR 详情失败 → mergeable_state/changed_files=null（**不是 0**）+ 记 source
             · 本地 ref 陈旧（本地 sha ≠ API head sha）→ content_in_main=null + 记 source
             · 本地 git 不可用 / --no-local-git → content_in_main=null（**不是 false**）
             · 凭据缺失（非 --input）→ exit 2（无法产出任何台账，不许输出空表冒充）
             受影响字段一律 null/"unknown"，**禁止静默填 0**。
@limit   — 上限=12 是**提示层**（派单 §一.3「只提示不拦死」；DSH 决策镜头原则⑤）:
             queue_length > limit → warning 非空 + stdout 显式告警，**退出码仍为 0**。
             退役动作由创始人签字驱动（见 docs/synova/coordination/队列收口-*.md）；
             本器**永不**关闭/合并/评论任何 PR。
@determinism — 同输入（--input + --today）连跑两次，除 generated_at 外逐键相等。
@redline — 纯读: 只发 GET 请求 + 只读本地 git（rev-parse/rev-list/diff/ls-tree/cat-file/merge-base，
             不改 ref、不改工作区）；除 --out-json/--out-md 外不写任何路径；
             不碰 scripts/control-tower/**、scripts/workflow/resolve-commit-brief.sh（D839 地盘）；
             零三方依赖（只用标准库）。
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

LOG = logging.getLogger("pr-queue-scan")

SCHEMA = "pr-queue-snapshot/1"
GENERATED_BY = "pr-queue-scan.py"
DEFAULT_REPO = "tangbaobao520/SynovaAgent"
DEFAULT_LIMIT = 12
DEFAULT_STALE_DAYS = 14
DEFAULT_RED_DAYS = 7
API = "https://api.github.com"

# 追加型 / 会话本地文件：内容天然逐次不同，**不参与**「已入 main」判定（否则永不判真 →
# 该理由恒为假，等于没有）。全为噪声文件时判 null（无法判定），不判真也不判假。
NOISE_PATHS = {
    ".claude/bypass.log",
    ".claude/pre-commit-failures.log",
    ".synova/logs/pre-commit-failures.log",
    ".claude/reference-map.md",
}

# 关闭理由码（机器可读，人只看文案）——DSH 决策镜头原则②「机器可读代码 + 归属」
REASON_TEXT = {
    "CONTENT_IN_MAIN": "已被取代：变更文件已逐字节在 main（或分支无独有提交）",
    "CARD_CLOSED": "已被取代：对应任务卡已 closed/rejected，分支不该再挂着",
    "CI_RED_LONG": "CI 长期红：超阈值天数仍是失败态，救不回来的分支不占队列",
    "ORPHAN_STALE": "无主超期：无任务卡可归因且超期",
}
# 退役优先序：数字越小越先关（先修瓶颈 —— 已入 main 的最贵：每次合并都逼全队列重算）
REASON_PRIORITY = {
    "CONTENT_IN_MAIN": 1,
    "CARD_CLOSED": 2,
    "CI_RED_LONG": 3,
    "ORPHAN_STALE": 4,
}
# 分支前缀 → 归属（DSH 原则②「归属自有 + 可归因」；认不出就显式 unknown，不猜）
OWNER_BY_PREFIX = (
    ("team/win-", "win-coding"),
    ("feat/win-", "win-coding"),
    ("fix/win-", "win-coding"),
    ("docs/win-", "win-devdoc"),
    ("audit/k3-", "k3"),
    ("k3/", "k3"),
)
OWNER_BY_LOCAL_PREFIX = (
    ("chore/", "mac-cto"),
    ("docs/", "mac-devdoc"),
    ("feat/", "mac-coding"),
    ("fix/", "mac-coding"),
)
D_RE = re.compile(r"(?:^|[^A-Za-z0-9])[Dd](\d{2,4})(?![0-9])")
CI_FAIL = {"failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"}
CI_OK = {"success", "skipped", "neutral"}


# ── 纯函数层（无 I/O，可离线夹具直测）──────────────────────────────

def parse_date(value):
    """'YYYY-MM-DD' → date；非法 → None（不抛，交给调用方判）"""
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def extract_d(text):
    """从分支名/标题里取 D#（大写规范化）；取不到 → None"""
    if not text:
        return None
    m = D_RE.search(text)
    return "D%s" % m.group(1) if m else None


def prefix_owner(head_ref):
    """分支前缀推出的归属；认不出 → None"""
    ref = head_ref or ""
    for prefix, owner in OWNER_BY_PREFIX + OWNER_BY_LOCAL_PREFIX:
        if ref.startswith(prefix):
            return owner
    return None


def owner_domain(owner):
    """'mac-coding' → 'mac'；认不出 → None"""
    if not owner:
        return None
    for tag in ("mac", "win", "k3"):
        if owner == tag or owner.startswith(tag + "-"):
            return tag
    return None


def derive_owner(head_ref, card_owner=None, card_domain=None):
    """@return (owner, owner_source, owner_conflict)
    card > 分支前缀 > unknown（**不猜**）。卡上 owner 与 domain 相互矛盾 → 显式标记冲突，
    不静默取一个（D811 实测：D820/D822/D823/D829 卡 domain=win 而 owner=mac-coding）。"""
    conflict = False
    if card_owner:
        od, dd = owner_domain(card_owner), (card_domain or "").strip().lower() or None
        if od and dd and od != dd:
            conflict = True
        return card_owner, "card", conflict
    po = prefix_owner(head_ref)
    if po:
        return po, "branch-prefix", conflict
    return "unknown", "unattributed", conflict


def classify(rec, stale_days=DEFAULT_STALE_DAYS, red_days=DEFAULT_RED_DAYS):
    """给单条记录判定「可否自动关闭 + 理由」。@return list[str]（空 = 留队列）"""
    reasons = []
    # ① 无独有提交 → 内容已在 main（分支已被合并/清空）
    if rec.get("ahead") == 0:
        reasons.append("CONTENT_IN_MAIN")
    # ② 变更文件已逐字节在 main（squash 合并后残留分支）
    elif rec.get("content_in_main") is True:
        reasons.append("CONTENT_IN_MAIN")
    # ③ 任务卡已 closed/rejected
    if rec.get("card_status") in ("closed", "rejected"):
        reasons.append("CARD_CLOSED")
    # ④ CI 长期红（失败态持续超 red_days）
    age = rec.get("age_days")
    if isinstance(age, int) and age >= red_days and rec.get("ci_state") == "failure":
        reasons.append("CI_RED_LONG")
    # ⑤ 无主超期（无卡可归因 + 超期）
    if rec.get("owner_source") == "unattributed" and isinstance(age, int) and age >= stale_days:
        reasons.append("ORPHAN_STALE")
    return reasons


def behind_bucket(n):
    """behind 分布分桶（机械分桶，不揉业务语义 —— DSH 原则④）"""
    if n is None:
        return "unknown"
    if n == 0:
        return "0"
    if n <= 5:
        return "1-5"
    if n <= 20:
        return "6-20"
    if n <= 100:
        return "21-100"
    return "100+"


def compute_metrics(records, limit=DEFAULT_LIMIT):
    """@return metrics dict（全机械计数；未知单列，禁静默填 0）"""
    behind = {"0": 0, "1-5": 0, "6-20": 0, "21-100": 0, "100+": 0, "unknown": 0}
    ci = {"success": 0, "failure": 0, "pending": 0, "none": 0, "unknown": 0}
    oldest = None
    closeable = attributed = conflicts = 0
    for r in records:
        behind[behind_bucket(r.get("behind"))] += 1
        state = r.get("ci_state") or "unknown"
        ci[state] = ci.get(state, 0) + 1
        age = r.get("age_days")
        if isinstance(age, int) and (oldest is None or age > oldest["age_days"]):
            oldest = {"number": r.get("number"), "age_days": age}
        if r.get("closeable"):
            closeable += 1
        if r.get("owner_source") != "unattributed":
            attributed += 1
        if r.get("owner_conflict"):
            conflicts += 1
    n = len(records)
    metrics = {
        "queue_length": n,
        "limit": limit,
        "over_limit": n > limit,
        "oldest": oldest,
        "behind_distribution": behind,
        "behind_unknown": behind["unknown"],
        "ci_distribution": ci,
        "closeable_count": closeable,
        "orphan_count": n - attributed,
        "owner_conflicts": conflicts,
        "owners": {"attributed": attributed, "unattributed": n - attributed},
        "by_reason": {},
    }
    for r in records:
        for reason in r.get("close_reasons") or []:
            metrics["by_reason"][reason] = metrics["by_reason"].get(reason, 0) + 1
    return metrics


def build_warning(metrics):
    """超限告警文案（advisor 级）。未超限 → None。**只提示不拦死**。
    文案不含 --out 路径（那是运行参数不是数据）——否则同输入两次派生不逐键相等。"""
    if not metrics.get("over_limit"):
        return None
    return ("⚠️ 未合 PR 队列超限：%d > %d —— 先退役再开新 PR"
            "（机器判可关 %d 个；退役清单：docs/synova/coordination/队列收口-*.md）"
            % (metrics["queue_length"], metrics["limit"],
               metrics.get("closeable_count") or 0))


def render_markdown(records, metrics):
    """台账表（机器算好，人只看）"""
    out = ["| # | 标题 | 主人 | behind | CI | age(天) | 可自动关闭 |",
           "|---|---|---|---|---|---|---|"]
    for r in sorted(records, key=lambda x: x.get("number") or 0, reverse=True):
        behind = "?" if r.get("behind") is None else str(r["behind"])
        reas = r.get("close_reasons") or []
        flag = "✅ %s" % "/".join(reas) if reas else "—"
        out.append("| %s | %s | %s | %s | %s | %s | %s |" % (
            r.get("number"), (r.get("title") or "")[:48].replace("|", "\\|"),
            r.get("owner"), behind, r.get("ci_state"), r.get("age_days"), flag))
    out.append("")
    out.append("**派生指标**：队列长度 %s/%s%s ｜ 最老 %s 天（#%s）｜ behind 分布 %s ｜ CI 分布 %s ｜ 孤儿 %s ｜ 归属冲突 %s"
               % (metrics["queue_length"], metrics["limit"],
                  "（**超限**）" if metrics["over_limit"] else "",
                  (metrics["oldest"] or {}).get("age_days"),
                  (metrics["oldest"] or {}).get("number"),
                  json.dumps(metrics["behind_distribution"], ensure_ascii=False),
                  json.dumps(metrics["ci_distribution"], ensure_ascii=False),
                  metrics["orphan_count"], metrics["owner_conflicts"]))
    return "\n".join(out)


def render_close_list(records):
    """可签字关闭清单（退役优先排序，每条给理由）——提交创始人签字的机械骨架"""
    cands = [r for r in records if r.get("close_reasons")]
    cands.sort(key=lambda r: (min(REASON_PRIORITY.get(x, 99) for x in r["close_reasons"]),
                              -(r.get("age_days") or 0), r.get("number") or 0))
    out = ["| 序 | PR | 标题 | 主人 | behind | CI | age | 关闭理由 |",
           "|---|---|---|---|---|---|---|---|"]
    for i, r in enumerate(cands, 1):
        why = "；".join("%s（`%s`）" % (REASON_TEXT.get(x, x), x) for x in r["close_reasons"])
        if "CI_RED_LONG" in r["close_reasons"] and r.get("ci_failing_names"):
            why += "；红在：%s" % "、".join(r["ci_failing_names"])
        out.append("| %d | #%s | %s | %s | %s | %s | %s | %s |" % (
            i, r.get("number"), (r.get("title") or "")[:44].replace("|", "\\|"),
            r.get("owner"), r.get("behind"), r.get("ci_state"), r.get("age_days"), why))
    return "\n".join(out)


# ── I/O 层 ────────────────────────────────────────────────────────

def load_token(credentials=None):
    """.credentials.yaml 里取 GITHUB_TOKEN（不打印、不外传）"""
    path = Path(credentials).expanduser() if credentials else Path.home() / ".dsh/.credentials.yaml"
    if not path.is_file():
        return None
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("GITHUB_TOKEN:"):
                tok = line.split("GITHUB_TOKEN:", 1)[1].strip().strip('"').strip("'")
                if tok:
                    return tok
    except OSError as exc:
        LOG.warning("凭据文件不可读: %s (%s)", path, exc)
    return None


def api_get(path, token, timeout=30):
    """纯读 GET。@return (payload|None, err|None)"""
    url = path if path.startswith("http") else API + path
    req = urllib.request.Request(url, headers={
        "Authorization": "token %s" % token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "synova-pr-queue-scan",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as exc:
        return None, "HTTP %s %s" % (exc.code, url)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return None, "%s %s" % (type(exc).__name__, url)


def git(root, *args):
    """只读 git 白名单（rev-parse/rev-list/diff/ls-tree/cat-file/merge-base）。@return (stdout, err)"""
    allow = {"rev-parse", "rev-list", "diff", "cat-file", "merge-base", "ls-tree"}
    if not args or args[0] not in allow:
        return None, "拒绝非只读 git 子命令: %s" % (args[0] if args else "")
    try:
        p = subprocess.run(["git", *args], cwd=str(root), capture_output=True,
                           text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "git 不可用: %s" % exc
    if p.returncode != 0:
        return None, (p.stderr or "").strip()[:200] or "git exit %d" % p.returncode
    return p.stdout.strip(), None


def main_tree_index(root):
    """origin/main 全量 blob 索引 {path: blob_sha}（一次 ls-tree，避免逐文件 spawn）。
    @return (index|None, err|None)"""
    out, err = git(root, "ls-tree", "-r", "origin/main")
    if err:
        return None, err
    index = {}
    for line in out.splitlines():
        try:
            meta, path = line.split("\t", 1)
            mode_type_sha = meta.split(" ")
            index[path] = mode_type_sha[2]
        except (ValueError, IndexError):
            continue
    return index, None


def trees_identical(root, ref_a, ref_b):
    """两 ref 工作树是否零差异。@return (bool|None, err|None)
    注意: `git diff --quiet` 有差异时 exit 1 —— 那是**结论**不是**故障**，必须分开。"""
    try:
        p = subprocess.run(["git", "diff", "--quiet", ref_a, ref_b], cwd=str(root),
                           capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "git 不可用: %s" % exc
    if p.returncode == 0:
        return True, None
    if p.returncode == 1:
        return False, None
    return None, (p.stderr or "").strip()[:200] or "git diff exit %d" % p.returncode


def content_landed(files, main_index):
    """PR 变更文件是否已入 main。@return (verdict:bool|None, signal:str|None)

    signal ∈ "empty-diff"（PR 变更文件为空 → 内容已无差异）/ "blob-identical"
             （逐文件 blob 与 main 全等）/ None（未判真）
    判据优先级: 空 diff > 逐文件 blob 全等。
    噪声路径（追加型日志，内容天然逐次不同）不参与判定；全是噪声 → None（不判真也不判假）。
    main_index 为 None（本地 git 不可用）→ None（**不用 false 冒充"未入 main"**）。"""
    if main_index is None:
        return None, None
    if not files:
        return True, "empty-diff"
    judged = [f for f in files if f.get("filename") not in NOISE_PATHS]
    if not judged:
        return None, None
    for f in judged:
        path, sha = f.get("filename"), f.get("sha")
        cur = main_index.get(path)
        if f.get("status") == "removed":
            if cur is not None:
                return False, None
        elif cur != sha:
            return False, None
    return True, "blob-identical"


def ci_state_of(sha, repo, token):
    """@return (state, failing, total, failing_names, err)
    state ∈ success/failure/pending/none/unknown；failing_names 是**证据**（哪几个 job 红），
    闭清单里要能点名，不写"CI 红"三个字了事。"""
    runs, err = api_get("/repos/%s/commits/%s/check-runs?per_page=100" % (repo, sha), token)
    if err:
        # check-runs 不可用 → 退回 combined status；两者都不可用才 unknown（不静默当 "none"）
        status, serr = api_get("/repos/%s/commits/%s/status" % (repo, sha), token)
        if serr:
            return "unknown", None, None, None, "%s | %s" % (err, serr)
        state = (status or {}).get("state") or "none"
        mapped = {"success": "success", "failure": "failure",
                  "error": "failure", "pending": "pending"}.get(state, "none")
        names = [s.get("context") for s in ((status or {}).get("statuses") or [])
                 if s.get("state") in ("failure", "error")]
        return mapped, len(names) or None, len((status or {}).get("statuses") or []), \
            names[:5] or None, None
    items = (runs or {}).get("check_runs") or []
    if not items:
        return "none", 0, 0, None, None
    fail_items = [c for c in items if (c.get("conclusion") or "") in CI_FAIL]
    failing = len(fail_items)
    pending = sum(1 for c in items if (c.get("status") or "") != "completed")
    names = [c.get("name") for c in fail_items][:5] or None
    if failing:
        return "failure", failing, len(items), names, None
    if pending:
        return "pending", 0, len(items), None, None
    if all((c.get("conclusion") or "") in CI_OK for c in items):
        return "success", 0, len(items), None, None
    return "unknown", 0, len(items), None, None


def load_cards(root):
    """task-state/*.json → {D#: card}（只读；损坏文件显式登记，不当空卡）"""
    cards, broken = {}, []
    d = Path(root) / "task-state"
    if not d.is_dir():
        return cards, ["task-state 目录缺失: %s" % d]
    for f in sorted(d.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            broken.append("task-state 卡解析失败: %s (%s)" % (f.name, exc))
            continue
        tid = data.get("task_id")
        if tid:
            cards[str(tid)] = data
    return cards, broken


class Ctx:
    """一次扫描的共享上下文（减少重复请求/进程）"""

    def __init__(self, args, root, cards, main_index):
        self.args = args
        self.root = root
        self.cards = cards
        self.main_index = main_index
        self.token = None


def enrich(pr, ctx, today, degraded):
    """原始 PR → 归一化记录。降级写进 degraded（list），不静默。"""
    args, root, cards = ctx.args, ctx.root, ctx.cards
    num = pr.get("number")
    head_ref = (pr.get("head") or {}).get("ref") or ""
    head_sha = (pr.get("head") or {}).get("sha") or ""
    cdate = parse_date((pr.get("created_at") or "")[:10])
    age = (today - cdate).days if cdate else None

    # ① 单 PR 详情（mergeable / changed_files）—— 列表接口不给这两项
    mergeable_state, changed_files = None, None
    if not args.no_detail:
        detail, derr = api_get("/repos/%s/pulls/%s" % (args.repo, num), ctx.token)
        if derr:
            degraded.append("PR 详情失败 #%s: %s" % (num, derr))
        else:
            mergeable_state = detail.get("mergeable_state")
            changed_files = detail.get("changed_files")

    # ② compare(main...head) → behind / ahead（作者权威，不依赖本地 ref 新旧）
    behind = ahead = None
    cmp_payload, cmp_err = api_get(
        "/repos/%s/compare/%s...%s" % (args.repo, urllib.parse.quote("main"),
                                       urllib.parse.quote(head_ref)), ctx.token)
    if cmp_err:
        degraded.append("compare 失败 PR#%s(%s): %s" % (num, head_ref, cmp_err))
    else:
        behind = cmp_payload.get("behind_by")
        ahead = cmp_payload.get("ahead_by")

    # ③ CI 状态
    state, failing, total, fail_names, ci_err = (ci_state_of(head_sha, args.repo, ctx.token)
                                                 if head_sha else ("none", 0, 0, None, None))
    if ci_err:
        degraded.append("check-runs 失败 PR#%s(%s): %s" % (num, head_sha[:8], ci_err))

    # ④ 卡与归属
    card = (cards.get(extract_d(head_ref) or "")
            or cards.get(extract_d(pr.get("title")) or "") or {})
    owner, owner_source, owner_conflict = derive_owner(
        head_ref, card.get("owner"), card.get("domain"))

    # ⑤ 内容是否已入 main（逐文件 blob 比对；需本地 ref 与 API head 一致）
    content_in_main, content_signal, files_total = None, None, None
    use_git = not args.no_local_git and not args.skip_content_check
    if use_git and head_sha:
        local_sha, _ = git(root, "rev-parse", "origin/%s" % head_ref)
        if local_sha and local_sha == head_sha:
            files, ferr = api_get(
                "/repos/%s/pulls/%s/files?per_page=100" % (args.repo, num), ctx.token)
            if ferr or not isinstance(files, list):
                degraded.append("PR 文件列表失败 #%s: %s" % (num, ferr))
            else:
                if len(files) == 100:
                    degraded.append("PR#%s 变更文件 ≥100（分页截断）→ 内容比对可能不完整" % num)
                files_total = len(files)
                content_in_main, content_signal = content_landed(files, ctx.main_index)
        elif local_sha:
            # 本地 ref 陈旧 → 内容比对跳过（null，不判 false）
            degraded.append("本地 ref 陈旧 PR#%s(%s): 本地 %s ≠ API %s（内容比对跳过 → null）"
                            % (num, head_ref, local_sha[:8], head_sha[:8]))

    rec = {
        "number": num,
        "title": pr.get("title") or "",
        "owner": owner,
        "owner_source": owner_source,
        "owner_conflict": owner_conflict,
        "head_ref": head_ref,
        "head_sha": head_sha,
        "draft": bool(pr.get("draft")),
        "created_at": (pr.get("created_at") or "")[:10],
        "age_days": age,
        "behind": behind,
        "ahead": ahead,
        "changed_files": changed_files,
        "mergeable_state": mergeable_state,
        "ci_state": state,
        "ci_failing": failing,
        "ci_total": total,
        "ci_failing_names": fail_names,
        "content_in_main": content_in_main,
        "content_signal": content_signal,
        "files_total": files_total,
        "card": card.get("task_id"),
        "card_status": card.get("status"),
        "closeable": False,
        "close_reasons": [],
    }
    rec["close_reasons"] = classify(rec, args.stale_days, args.red_days)
    rec["closeable"] = bool(rec["close_reasons"])
    return rec


def load_input_records(path):
    """--input: 归一化记录数组，或本器产出的快照（取 records）"""
    p = Path(path)
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        LOG.error("--input 不可读/非法 JSON: %s (%s)", p, exc)
        return None, ["--input 不可读: %s" % exc]
    if isinstance(raw, dict) and isinstance(raw.get("records"), list):
        raw = raw["records"]
    if not isinstance(raw, list):
        LOG.error("--input 需为记录数组或本器快照")
        return None, ["--input 结构非法（非 list）"]
    recs = []
    for r in raw:
        if not isinstance(r, dict):
            return None, ["--input 记录项非对象"]
        rec = dict(r)
        rec.setdefault("owner", rec.get("owner") or "unknown")
        rec.setdefault("owner_source", "card" if rec.get("owner") != "unknown" else "unattributed")
        rec.setdefault("owner_conflict", False)
        rec.setdefault("close_reasons", [])
        recs.append(rec)
    return recs, []


def fetch_records(args, root, today):
    """@return (records, degraded, ctx) —— --input 离线回放 或 live API"""
    degraded = []
    if args.input:
        recs, errs = load_input_records(args.input)
        if recs is None:
            return None, errs, None
        for rec in recs:
            rec["close_reasons"] = classify(rec, args.stale_days, args.red_days)
            rec["closeable"] = bool(rec["close_reasons"])
        return recs, degraded, None

    token = load_token(args.credentials)
    if not token:
        LOG.error("无 GITHUB_TOKEN（~/.dsh/.credentials.yaml）—— 无法产出台账，不输出空表冒充")
        return None, ["凭据缺失"], None

    cards, broken = load_cards(root)
    degraded.extend(broken)
    main_index, mi_err = (None, "跳过（--no-local-git/--skip-content-check）")
    if not args.no_local_git and not args.skip_content_check:
        main_index, mi_err = main_tree_index(root)
        if mi_err:
            degraded.append("origin/main 树索引失败（内容比对 → null）: %s" % mi_err)

    prs, err = api_get("/repos/%s/pulls?state=open&per_page=100" % args.repo, token)
    if err or not isinstance(prs, list):
        LOG.error("拉取 open PR 失败: %s", err)
        return None, ["open PR 拉取失败: %s" % err], None
    if args.only:
        wanted = {int(x) for x in args.only.split(",") if x.strip()}
        prs = [p for p in prs if p.get("number") in wanted]

    ctx = Ctx(args, root, cards, main_index)
    ctx.token = token
    recs = []
    for i, pr in enumerate(prs, 1):
        LOG.warning("扫描 %d/%d PR#%s", i, len(prs), pr.get("number"))
        recs.append(enrich(pr, ctx, today, degraded))
    return recs, degraded, ctx


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="D811 未合 PR 队列台账扫描器（纯读；上限=提示层，不拦死）")
    ap.add_argument("--repo", default=DEFAULT_REPO)
    ap.add_argument("--repo-root", default=str(Path(__file__).resolve().parent.parent.parent))
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    ap.add_argument("--today")
    ap.add_argument("--input")
    ap.add_argument("--credentials")
    ap.add_argument("--no-local-git", action="store_true")
    ap.add_argument("--no-detail", action="store_true")
    ap.add_argument("--skip-content-check", action="store_true")
    ap.add_argument("--only")
    ap.add_argument("--out-json")
    ap.add_argument("--out-md")
    ap.add_argument("--print", dest="print_mode", choices=["table", "summary", "json"],
                    default="table")
    ap.add_argument("--stale-days", type=int, default=DEFAULT_STALE_DAYS)
    ap.add_argument("--red-days", type=int, default=DEFAULT_RED_DAYS)
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s", stream=sys.stderr)
    # D313 M5: Windows 控制台默认非 UTF-8（cp936）→ 中文/emoji 打印即崩，显式强制
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError) as exc:
        LOG.debug("stdout 重配置 UTF-8 跳过（老 Python/被重定向）: %s", exc)

    root = Path(args.repo_root).resolve()
    today = parse_date(args.today) if args.today else date.today()
    if args.today and not today:
        LOG.error("--today 非法（需 YYYY-MM-DD）: %s", args.today)
        return 2

    records, degraded, _ctx = fetch_records(args, root, today)
    if records is None:
        return 2

    metrics = compute_metrics(records, args.limit)
    out_json = Path(args.out_json) if args.out_json else root / "docs/synova/project/pr-queue.json"
    warning = build_warning(metrics)

    snapshot = {
        "schema": SCHEMA,
        "generated_by": GENERATED_BY,
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "repo": args.repo,
        "baseline": "main",
        "limit": args.limit,
        "degraded": bool(degraded),
        "degraded_sources": degraded,
        "metrics": metrics,
        "warning": warning,
        "records": records,
    }

    try:
        out_json.parent.mkdir(parents=True, exist_ok=True)
        out_json.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
        if args.out_md:
            md = ["# 未合 PR 队列台账（%s 生成 · 机器算）" % snapshot["generated_at"][:19], "",
                  render_markdown(records, metrics), "", "## 可签字关闭清单（退役优先）", "",
                  render_close_list(records), ""]
            Path(args.out_md).write_text("\n".join(md), encoding="utf-8")
    except OSError as exc:
        LOG.error("输出不可写: %s", exc)
        return 2

    if not args.quiet:
        if args.print_mode == "table":
            print(render_markdown(records, metrics))
        elif args.print_mode == "json":
            print(json.dumps(snapshot, ensure_ascii=False, indent=2))
        print("snapshot → %s | 队列 %d/%d 最老 %s 天 可关 %d 孤儿 %d degraded=%s"
              % (out_json, metrics["queue_length"], metrics["limit"],
                 (metrics["oldest"] or {}).get("age_days"), metrics["closeable_count"],
                 metrics["orphan_count"], snapshot["degraded"]))
        if warning:
            print(warning)
        for reason in degraded:
            print("  ⚠ degraded: %s" % reason, file=sys.stderr)

    if degraded and args.strict:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
