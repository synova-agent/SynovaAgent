#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# weekly-recon.sh — #808 周对账探针（五指标快照 → 与基线比对 → 差异进唯一对账卡）
#
# 设计哲学（一句）：**指标只从既有单一源实测（禁造第三口径），差异进一张按 ISO 周分节的
#   常驻对账卡，零差异即静默退出 —— 对账的价值在「差异被看见」，不在「每周刷一张新卡」。**
#
# 授权（explicit authority）：#808 规格（.handbook/派单件/2026-10-21-规格-808-周对账进issue.md）
#   ＋ CTO 裁 277 余令（写面冻结）＋ 创始人 2026-10-20「不再大盘点」。
#   · 谁能调：任意治理线会话手工跑（只读指标 + 只写仓外基线 + 只开/更新对账卡）；CI 首期不接线。
#   · 写面（冻结）：① 仓外基线文件（默认 $HOME/.ci-work/board-baseline.json）
#     ② **唯一**对账卡 `[RECON] 周对账（滚动）`（首建一次；此后只 PATCH 当周节）。
#     禁写里程碑、禁开验收卡、禁开第二张对账卡、禁改其他 issue。
#
# 契约（铁律 47）:
#   @input  — --baseline <path>（缺省 ${SYNO_RECON_BASELINE:-$HOME/.ci-work/board-baseline.json}；
#               仓外路径，禁 Mac 绝对前缀，故用 $HOME 展开）｜--dry-run（只读）｜--help
#             环境: SYNO_PUSH_GITEA_API（缺省 http://127.0.0.1:3000/api/v1，同 mirror-sync 约定）
#                   SYNO_PUSH_GITEA_REPO（缺省 synova-agent/SynovaAgent）
#                   SYNO_PUSH_GITEA_TOKEN_FILE（缺省 /Users/wane/gitea/.win-push-token，仅写路径读）
#                   SYNO_GATE_DEGRADED_LOG（降级事件 JSONL，缺省 <repo>/.codex/control-tower/logs/degraded-events.log）
#             注入缝（测试必需；生产有默认值）:
#                   SYNO_RECON_ROOT（缺省 <script_dir>/../..，git 调用一律 `git -C` 锚它，禁靠 cwd 认树）
#                   SYNO_RECON_NPM（缺省 npm，AUDIT 指标的可执行）
#   @output — 五指标各一行（**顺序固定**；先收集后按序打印）:
#                FILES=<n>                     git ls-tree -r HEAD 实测条数（唯一来源）
#                MODS=<mod>:<n>,<mod>:<n>,…    按 ASSET-MAP required_modules 顺序；import asset-sync.load_map/classify
#                PRAVG=<n>                     open PR 计数，取 API `X-Total-Count`（token 名按规格保留 PRAVG；
#                                              语义 = open PR 条数，禁手数）
#                WORKTREES=<n>                 git worktree list --porcelain 的 `worktree ` 条目数
#                AUDIT=<level>:<n>             npm audit --omit=dev --json 的 metadata.vulnerabilities：
#                                              level = 最高**有值**等级（critical>high>moderate>low>info），
#                                              n = 该等级计数；全 0 ⇒ none:0；
#                                              npm 不可用/审计失败 ⇒ unavailable:0 ＋ stderr degraded 行
#              终行: `SUMMARY diffs=<n> issue=<#|none>`（diffs=变化的指标条数 0..5；
#                    dry-run 有差异但未开卡时行尾加 ` (DRY)`）
#   @exit    — **三态（本卡显式重定义，判据见规格 §4）**:
#                0 = 零差异（首跑建基线也 0）
#                1 = 有差异（真跑已开/更新卡；dry-run 有差异但未开卡）
#                    🔴 1 ≠ 真红：本探针里 1 是「有信号」，不是业务阻断（CI 首期不接线）
#                2 = 自身失败/降级：token 不可读／API 不可达／API 非 JSON／基线 JSON 损坏／
#                    基线写失败／git 失败／MAP 载入失败／对账卡写失败／信号量==0（ls-tree=0 或 worktree=0）
#   @degraded — stderr 一行 `degraded: code=<CODE> <原因>` ＋ 追加 JSON 行到 $SYNO_GATE_DEGRADED_LOG
#              （字段 time/component/code/phase/retryable；铁律 11/32 显式降级，不静默）。
#              🔴 边界：**AUDIT 不可用属「指标级缺失」** ⇒ AUDIT=unavailable:0 ＋ degraded 行，
#              但**不改变退出码**（不因此 exit 2）；其余降级一律 exit 2。
#   @error   — typed error code 表（stderr `degraded: code=` 前缀）:
#                TOKEN_UNREADABLE(2)       token 文件不可读/为空（先读后连 ⇒ 零请求）
#                API_UNREACHABLE(2)        API 连接失败/超时/5xx
#                API_BAD_RESPONSE(2)       API 返回非 JSON／缺 X-Total-Count／形态不符
#                BASELINE_CORRUPT(2)       基线 JSON 损坏或缺字段/类型不符（不猜，停）
#                BASELINE_WRITE_FAILED(2)  基线写失败（临时文件 + rename 原子写）
#                GIT_FAILED(2)             git 命令失败，或 ls-tree/worktree 信号量==0
#                MAP_FAILED(2)             asset-sync.load_map 失败（透传其 code；本探针统一按自身失败=2）
#                ISSUE_WRITE_FAILED(2)     对账卡 POST/PATCH 被拒或响应缺 number
#                AUDIT_UNAVAILABLE(**)     **指标级**降级（非 exit 2）：npm 不在 PATH／审计失败／JSON 解析失败
#                ENV_NO_PYTHON(2)          环境级：python3 不可用（探针无法启动）
#   已知限制（Known Limitations）:
#     · PRAVG 名沿用规格（语义 = open PR 计数）；只含 Gitea API 口径，不含 GitHub 镜像侧。
#     · AUDIT 依赖 package-lock.json 与 npm 可执行；无 node_modules 时走 registry 元数据
#       （离线/无网 ⇒ unavailable:0，不阻断对账）。
#     · 卡正文「取数时间」每次真跑刷新（同周重跑覆盖当周节）⇒ 正文非字节幂等；
#       **幂等判据是「diffs=0 ⇒ 零写请求（不写卡不刷基线）」**，不是正文 sha 相等。
#     · 基线 as_of 存完整 40 位 sha（比短 sha 更可核）；week 用本地时区 ISO 周（isocalendar）。
#     · 跨周：diffs=0 时只报基线里的 issue（不写卡）⇒ 新周节只在当周首跑**有差异**时追加；
#       整周零差异则正文不新增周节（防空转更新）。
#     · label：按名称「域/治理」解析 id（禁硬编码 id）；取不到 ⇒ 无 label 开卡 ＋ stderr 提示。
#     · 不重算卡完成率（五指标不含卡口径；卡口径归 scripts/control-tower/check-board-metrics.ts）。
#     · 本脚本只产信号/证据，不判「通过」（结论归 L1 收件闸 + 独立复核）。
#   复用（禁重复实现）:
#     · 模块计数 = import `scripts/control-tower/asset-sync.py` 的 load_map/classify（本文件无第二份 MAP 解析）
#     · 三态退出码（scripts/control-tower/AGENTS.md）｜@降级＋SYNO_GATE_DEGRADED_LOG（check-gate-integrity.sh）
#     · UTF-8 强制（D732）｜判别力自检（tests/control-tower/weekly-recon.test.sh T8：摘去重必双卡）
#     · 开/关卡去重范式 = 标题全等＋state=open（mirror-sync-push.sh L175-189）
#   Source map:
#     段                       职责
#     ───────────────────────  ────────────────────────────────────────────────
#     ① 头注契约（本段）         @input/@output/@exit/@degraded/@error/Known Limitations/explicit authority
#     ② bash 外壳               D732 UTF-8；PYBIN 探测；heredoc 调内嵌 python（逻辑唯一实现点）
#     ③ 指标采集                 FILES/MODS/PRAVG/WORKTREES/AUDIT（各单一源；信号量==0 保护）
#     ④ 基线读写                 仓外 JSON {as_of,week,issue,metrics}；原子写；损坏 ⇒ exit 2
#     ⑤ 对账卡                   固定标题单卡去重（标题全等＋open）；按 ISO 周 upsert（旧周节不回改）
#     ⑥ 输出/退出                五指标行＋SUMMARY；三态 0/1/2；degraded JSONL
#   ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYBIN="$(command -v python3 2>/dev/null || true)"   # swallow-ok: python3 缺失由下一分支显式 degraded exit 2
if [ -z "$PYBIN" ]; then
  echo "degraded: code=ENV_NO_PYTHON PY 解释器不可用（探针无法启动，零指标）" >&2
  exit 2
fi
export SYNO_RECON_SCRIPT_DIR="$SCRIPT_DIR"
exec "$PYBIN" - "$@" <<'PY'
# -*- coding: utf-8 -*-
"""#808 周对账探针内嵌实现（契约见 bash 头注；本段是唯一逻辑实现点）。"""
import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone

try:  # windows-compat（D732）：UTF-8 强制，Windows GBK 控制台兜底
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

COMPONENT = "weekly-recon"
CARD_TITLE = "[RECON] 周对账（滚动）"
LABEL_NAME = "域/治理"
HTTP_TIMEOUT = 20
NPM_TIMEOUT = 120
METRIC_ORDER = (("files", "FILES"), ("mods", "MODS"), ("pravg", "PRAVG"),
                ("worktrees", "WORKTREES"), ("audit", "AUDIT"))
AUDIT_LEVELS = ("critical", "high", "moderate", "low", "info")

SCRIPT_DIR = os.environ.get("SYNO_RECON_SCRIPT_DIR") or ""
if not SCRIPT_DIR:
    print("degraded: code=ENV_NO_PYTHON 未经 bash 外壳注入 SYNO_RECON_SCRIPT_DIR（禁直接跑内嵌段）",
          file=sys.stderr)
    sys.exit(2)
ROOT = os.path.abspath(os.environ.get("SYNO_RECON_ROOT") or os.path.join(SCRIPT_DIR, "..", ".."))


def now_iso():
    """UTC ISO8601（秒级）—— 取数时间，跨时区可核。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def current_week():
    """本地时区 ISO 周：`YYYY-Www`（周流程按人的日历走）。"""
    y, w, _d = datetime.now().isocalendar()
    return "%d-W%02d" % (y, w)


def degraded(code, msg, phase="metrics", retryable=True, fatal=True):
    """三态降级：stderr 一行 + degraded-events.log JSONL（D2 既有约定）。fatal=True ⇒ exit 2。"""
    print("degraded: code=%s %s" % (code, msg), file=sys.stderr)
    log_path = os.environ.get("SYNO_GATE_DEGRADED_LOG") or os.path.join(
        ROOT, ".codex", "control-tower", "logs", "degraded-events.log")
    rec = {"time": now_iso(), "component": COMPONENT, "code": code,
           "phase": phase, "retryable": bool(retryable)}
    try:
        parent = os.path.dirname(os.path.abspath(log_path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError as e:
        print("warning: degraded 日志写失败 %s: %s" % (log_path, e), file=sys.stderr)
    if fatal:
        raise SystemExit(2)


# ══════════════════════════════════════════════════════════════════════════════
# ③ 指标采集（每项单一源；禁造第三口径）
# ══════════════════════════════════════════════════════════════════════════════
def git(*args):
    """所有 git 调用锚 ROOT（禁靠 cwd 认树：误树会静默算错）。失败 ⇒ GIT_FAILED exit 2。"""
    try:
        r = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
    except OSError as e:
        degraded("GIT_FAILED", "git 不可执行: %s" % e)
        raise
    if r.returncode != 0:
        degraded("GIT_FAILED", "git -C %s %s 失败: %s"
                 % (ROOT, " ".join(args), (r.stderr or "").strip()[:200]))
    return r.stdout


def tree_files():
    """HEAD 全量文件清单（-z 防文件名含换行）；0 条 ⇒ 信号量==0 ⇒ exit 2。"""
    out = git("ls-tree", "-r", "--name-only", "-z", "HEAD")
    files = [p for p in out.split("\0") if p]
    if not files:
        degraded("GIT_FAILED", "git ls-tree -r HEAD 返回 0 条（信号量==0：禁把看不见当没问题）")
    return files


def load_asset_map():
    """复用 asset-sync.py 的 load_map/classify —— 禁第二份 MAP 解析（规格 §4 判据 1）。"""
    script = os.path.join(ROOT, "scripts", "control-tower", "asset-sync.py")
    try:
        spec = importlib.util.spec_from_file_location("syno_asset_sync", script)
        if spec is None or spec.loader is None:
            degraded("MAP_FAILED", "asset-sync.py 无法载入: %s" % script)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        amap = mod.load_map(os.path.join(ROOT, "docs", "authority", "ASSET-MAP.yaml"))
    except SystemExit as e:  # asset-sync.die() 自带 stderr 行；本探针统一按自身失败=2 透传
        degraded("MAP_FAILED", "asset-sync.load_map 失败（其 exit=%s；本探针统一 exit 2）" % e.code)
        raise
    except Exception as e:  # noqa: BLE001 —— 载入异常一律 typed error（禁裸崩）
        degraded("MAP_FAILED", "asset-sync.py 载入异常 %s: %s" % (type(e).__name__, e))
        raise
    return mod, amap


def metric_mods(mod, amap, files):
    """按 required_modules 顺序出 `<mod>:<n>` 串（0 也列，顺序稳定 ⇒ 可整串比较）。"""
    counts = {m: 0 for m in amap["required"]}
    for f in files:
        m = mod.classify(amap["entries"], f)
        if m in counts:
            counts[m] += 1
    return ",".join("%s:%d" % (m, counts[m]) for m in amap["required"])


def metric_worktrees():
    out = git("worktree", "list", "--porcelain")
    n = sum(1 for ln in out.splitlines() if ln.startswith("worktree "))
    if n == 0:
        degraded("GIT_FAILED", "git worktree list --porcelain 返回 0 条（信号量==0）")
    return n


def metric_audit():
    """npm audit --omit=dev --json → metadata.vulnerabilities 的最高有值等级:计数。

    🔴 指标级缺失：npm 不可用/审计失败 ⇒ unavailable:0 ＋ degraded 行，**不改变退出码**。
    """
    npm = os.environ.get("SYNO_RECON_NPM") or "npm"
    exe = npm if os.path.isabs(npm) else shutil.which(npm)
    if not exe or not os.path.exists(exe):
        degraded("AUDIT_UNAVAILABLE", "npm 不可用（%s 不在 PATH）⇒ AUDIT=unavailable:0" % npm,
                 phase="audit", fatal=False)
        return "unavailable:0"
    try:
        r = subprocess.run([exe, "audit", "--omit=dev", "--json"], cwd=ROOT,
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=NPM_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as e:
        degraded("AUDIT_UNAVAILABLE", "npm audit 执行失败 %s: %s" % (type(e).__name__, e),
                 phase="audit", fatal=False)
        return "unavailable:0"
    if r.returncode not in (0, 1):  # 0=无漏洞 1=有漏洞（均为正常返回）；其余=审计自身失败
        degraded("AUDIT_UNAVAILABLE", "npm audit 异常退出 rc=%s: %s"
                 % (r.returncode, (r.stderr or "").strip()[:200]), phase="audit", fatal=False)
        return "unavailable:0"
    try:
        data = json.loads(r.stdout or "")
        vulns = (data.get("metadata") or {}).get("vulnerabilities")
        if not isinstance(vulns, dict):
            raise ValueError("metadata.vulnerabilities 缺/非对象")
    except (ValueError, TypeError) as e:  # json.JSONDecodeError 是 ValueError 子类
        degraded("AUDIT_UNAVAILABLE", "npm audit JSON 解析失败: %s" % e,
                 phase="audit", fatal=False)
        return "unavailable:0"
    for level in AUDIT_LEVELS:
        n = vulns.get(level)
        if isinstance(n, int) and n > 0:
            return "%s:%d" % (level, n)
    return "none:0"


# ══════════════════════════════════════════════════════════════════════════════
# Gitea API（token 先读后连 ⇒ token 不可读时零请求）
# ══════════════════════════════════════════════════════════════════════════════
class Api:
    """最小 Gitea 客户端。构造即读 token（失败 ⇒ exit 2 且零请求）。"""

    def __init__(self):
        self.base = (os.environ.get("SYNO_PUSH_GITEA_API")
                     or "http://127.0.0.1:3000/api/v1").rstrip("/")
        self.repo = os.environ.get("SYNO_PUSH_GITEA_REPO") or "synova-agent/SynovaAgent"
        token_file = os.environ.get("SYNO_PUSH_GITEA_TOKEN_FILE") \
            or "/Users/wane/gitea/.win-push-token"
        try:
            with open(token_file, encoding="utf-8") as f:
                token = f.read().strip()
        except OSError as e:
            degraded("TOKEN_UNREADABLE", "token 不可读 %s: %s（零请求）" % (token_file, e),
                     phase="api")
            raise
        if not token:
            degraded("TOKEN_UNREADABLE", "token 文件为空 %s（零请求）" % token_file, phase="api")
        self.token = token

    def call(self, method, path, body=None, write=False):
        url = "%s/repos/%s/%s" % (self.base, self.repo, path)
        data = (json.dumps(body, ensure_ascii=False).encode("utf-8")
                if body is not None else None)
        req = urllib.request.Request(
            url, data=data, method=method,
            headers={"Authorization": "token %s" % self.token,
                     "Content-Type": "application/json",
                     "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
                raw = r.read()
                headers = r.headers
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read()[:200].decode("utf-8", "replace")
            except OSError:
                detail = ""
            if write:
                degraded("ISSUE_WRITE_FAILED", "Gitea %s %s 被拒绝 HTTP %s %s"
                         % (method, path, e.code, detail), phase="issue")
            if 400 <= e.code < 500:
                degraded("API_BAD_RESPONSE", "Gitea %s %s 被拒绝 HTTP %s %s"
                         % (method, path, e.code, detail), phase="api")
            degraded("API_UNREACHABLE", "Gitea %s %s 服务端错误 HTTP %s %s"
                     % (method, path, e.code, detail), phase="api")
            raise
        except (urllib.error.URLError, OSError) as e:  # 含 socket.timeout
            degraded("API_UNREACHABLE", "Gitea %s %s 不可达/超时: %s" % (method, path, e),
                     phase="api")
            raise
        payload = None
        if raw:
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                degraded("API_BAD_RESPONSE", "Gitea %s %s 返回非 JSON" % (method, path),
                         phase="api")
        return payload, headers


def metric_pravg(api):
    """open PR 计数：唯一来源 = API `X-Total-Count`（禁手数）。"""
    _payload, headers = api.call("GET", "pulls?state=open&limit=1")
    total = headers.get("X-Total-Count") if headers is not None else None
    if total is None:
        degraded("API_BAD_RESPONSE", "GET pulls 缺 X-Total-Count 响应头（禁手数 open PR）",
                 phase="api")
    try:
        return int(str(total).strip())
    except (TypeError, ValueError):
        degraded("API_BAD_RESPONSE", "X-Total-Count 非整数: %r" % (total,), phase="api")
        raise


# ══════════════════════════════════════════════════════════════════════════════
# ④ 基线（仓外 JSON；原子写；损坏不猜）
# ══════════════════════════════════════════════════════════════════════════════
def load_baseline(path):
    """不存在 ⇒ None（首跑）；存在但损坏/缺字段 ⇒ BASELINE_CORRUPT exit 2。"""
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        degraded("BASELINE_CORRUPT", "基线不可读 %s: %s" % (path, e), phase="baseline")
        raise
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        degraded("BASELINE_CORRUPT", "基线 JSON 损坏 %s: %s" % (path, e), phase="baseline")
        raise
    if not isinstance(data, dict):
        degraded("BASELINE_CORRUPT", "基线顶层非对象 %s" % path, phase="baseline")
    bad = []
    if not isinstance(data.get("as_of"), str) or not data.get("as_of", "").strip():
        bad.append("as_of")
    week = data.get("week")
    if not isinstance(week, str) or not re.match(r"^\d{4}-W\d{2}$", week):
        bad.append("week")
    issue = data.get("issue")
    if not (issue is None or isinstance(issue, int)):
        bad.append("issue")
    metrics = data.get("metrics")
    types = {"files": int, "mods": str, "pravg": int, "worktrees": int, "audit": str}
    if not isinstance(metrics, dict):
        bad.append("metrics")
    else:
        for key, typ in types.items():
            if key not in metrics or not isinstance(metrics.get(key), typ):
                bad.append("metrics.%s" % key)
    if bad:
        degraded("BASELINE_CORRUPT", "基线缺字段/类型不符 %s: %s" % (path, ",".join(bad)),
                 phase="baseline")
    return data


def write_baseline(path, sha, week, issue, metrics):
    """原子写（temp + os.replace）：半截基线会让下次对账误报，禁。"""
    payload = {"as_of": sha, "week": week, "issue": issue, "metrics": metrics}
    tmp = None
    try:
        parent = os.path.dirname(os.path.abspath(path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".board-baseline.", suffix=".tmp", dir=parent or ".")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(tmp, path)
    except OSError as e:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass
        degraded("BASELINE_WRITE_FAILED", "基线写失败 %s: %s" % (path, e), phase="baseline")
        raise


# ══════════════════════════════════════════════════════════════════════════════
# ⑤ 对账卡（固定标题单卡；标题全等＋open 去重；按 ISO 周 upsert）
# ══════════════════════════════════════════════════════════════════════════════
CARD_HEADER = """<!-- RECON-AUTO:BEGIN 本卡由 scripts/control-tower/weekly-recon.sh 自动维护（单卡滚动，按 ISO 周分节；旧周节不回改）-->
# 周对账（滚动）

- 用途：每周把五项指标的实测快照与上周基线比对，差异写进当周节；**本卡是唯一对账卡**（禁每周新卡）。
- 指标：文件数（git ls-tree）｜模块计数（ASSET-MAP required_modules）｜open PR（API X-Total-Count）｜worktree（git worktree list）｜依赖漏洞（npm audit 摘要）。
- 基线：仓外 `$HOME/.ci-work/board-baseline.json`（不合入仓库）。判据与边界见 #808 规格（handbook 派单件/2026-10-21-规格-808-周对账进issue.md）。
- 无差异的周不写卡（只报基线里的 issue 号）；有差异才追加/覆盖当周节。"""


def metrics_rows(metrics):
    return [("FILES", str(metrics["files"])), ("MODS", metrics["mods"]),
            ("PRAVG", str(metrics["pravg"])), ("WORKTREES", str(metrics["worktrees"])),
            ("AUDIT", metrics["audit"])]


def build_section(week, metrics, diffs, first, sha7, stamp):
    """当周节（纯函数）：五指标表 + 差异列表 + as_of/取数时间。"""
    lines = ["## %s" % week, "", "- 取数时间：%s｜as_of：`%s`" % (stamp, sha7)]
    if first:
        lines.append("- 基线首建：本卡首建，五指标已写入仓外基线（此后每周只报差异）")
    else:
        lines.append("- 与上周基线比对：**%d 项差异**（同周重跑覆盖本节；旧周节不回改）"
                     % len(diffs))
    lines += ["", "| 指标 | 值 |", "|---|---|"]
    for name, val in metrics_rows(metrics):
        lines.append("| %s | `%s` |" % (name, val))
    lines += ["", "差异列表（指标｜旧值｜新值）：", ""]
    if diffs:
        lines += ["| 指标 | 旧值 | 新值 |", "|---|---|---|"]
        for name, old, new in diffs:
            lines.append("| %s | `%s` | `%s` |" % (name, old, new))
    else:
        lines.append("（无差异）")
    if str(metrics["audit"]).startswith("unavailable"):
        lines += ["", "> ⚠️ AUDIT 未取到（npm 不可用/审计失败）：本期依赖漏洞指标缺失，其余四项正常。"]
    return "\n".join(lines) + "\n"


def upsert_section(body, week, section):
    """只改/追加当前周节：旧周节逐行保留（含其节内文本）；无当周节 ⇒ 文末追加。"""
    lines = body.splitlines(keepends=True)
    head = "## %s" % week
    start = None
    for i, ln in enumerate(lines):
        if ln.strip() == head:
            start = i
            break
    if start is None:
        base = body.rstrip("\n")
        return (base + "\n\n" + section) if base else section
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("## "):
            end = j
            break
    prefix = "".join(lines[:start])
    rest = "".join(lines[end:])
    if rest and not rest.startswith("\n"):
        rest = "\n" + rest
    return prefix + section + rest


def find_card(api):
    """标题全等＋state=open ⇒ 取第一条（mirror-sync-push.sh 同型去重；禁每周新卡）。"""
    payload, _headers = api.call("GET", "issues?state=open&limit=50")
    if not isinstance(payload, list):
        degraded("API_BAD_RESPONSE", "GET issues 返回非数组", phase="issue")
    for item in payload:
        if isinstance(item, dict) and (item.get("title") or "") == CARD_TITLE:
            return item
    return None


def resolve_label_id(api):
    """按名称解析 label id（禁硬编码 id）；取不到 ⇒ None ＋ stderr 提示。"""
    payload, _headers = api.call("GET", "labels?limit=100")
    if not isinstance(payload, list):
        degraded("API_BAD_RESPONSE", "GET labels 返回非数组", phase="issue")
    for lb in payload:
        if isinstance(lb, dict) and (lb.get("name") or "") == LABEL_NAME:
            return lb.get("id")
    print("warning: label「%s」未在 /labels 中找到 ⇒ 无 label 开卡（禁硬编码 label id）"
          % LABEL_NAME, file=sys.stderr)
    return None


def write_card(api, existing, section, week):
    """有 ⇒ PATCH 当周节；无 ⇒ POST 新卡（含 label 若可解析）。返回 issue 号。"""
    if existing is None:
        body = CARD_HEADER.rstrip("\n") + "\n\n" + section
        payload = {"title": CARD_TITLE, "body": body}
        label_id = resolve_label_id(api)
        if label_id is not None:
            payload["labels"] = [label_id]
        created, _headers = api.call("POST", "issues", payload, write=True)
        if not isinstance(created, dict) or not isinstance(created.get("number"), int):
            degraded("ISSUE_WRITE_FAILED", "POST issues 响应缺 number", phase="issue")
        return created["number"]
    num = existing.get("number")
    if not isinstance(num, int):
        degraded("API_BAD_RESPONSE", "对账卡条目缺 number", phase="issue")
    old_body = existing.get("body") or ""
    fetched, _headers = api.call("GET", "issues/%d" % num)
    if isinstance(fetched, dict) and isinstance(fetched.get("body"), str):
        old_body = fetched.get("body") or ""
    body = upsert_section(old_body, week, section)
    api.call("PATCH", "issues/%d" % num, {"body": body}, write=True)
    return num


# ══════════════════════════════════════════════════════════════════════════════
# ⑥ 主流程（三态 0/1/2；五指标先收集后按序打印）
# ══════════════════════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser(
        prog="weekly-recon.sh",
        description="#808 周对账探针（契约见文件头；dry-run 只读）")
    ap.add_argument("--baseline", default=os.environ.get("SYNO_RECON_BASELINE")
                    or os.path.join(os.path.expanduser("~"), ".ci-work", "board-baseline.json"),
                    help="基线 JSON 路径（缺省 $HOME/.ci-work/board-baseline.json）")
    ap.add_argument("--dry-run", action="store_true",
                    help="只读：允许 GET 取 PRAVG；禁 POST/PATCH、禁写基线")
    args = ap.parse_args()

    api = Api()  # token 先读后连：不可读 ⇒ exit 2 且零请求
    files = tree_files()
    mod, amap = load_asset_map()
    metrics = {
        "files": len(files),
        "mods": metric_mods(mod, amap, files),
        "pravg": metric_pravg(api),
        "worktrees": metric_worktrees(),
        "audit": metric_audit(),
    }
    sha = git("rev-parse", "HEAD").strip()
    if not re.match(r"^[0-9a-f]{40}$", sha):
        degraded("GIT_FAILED", "git rev-parse HEAD 返回异常 sha: %r" % (sha,))
    sha7 = sha[:7]
    week = current_week()

    # 五指标各一行：顺序固定（规格 @output）
    print("FILES=%d" % metrics["files"])
    print("MODS=%s" % metrics["mods"])
    print("PRAVG=%d" % metrics["pravg"])
    print("WORKTREES=%d" % metrics["worktrees"])
    print("AUDIT=%s" % metrics["audit"])

    baseline = load_baseline(args.baseline)
    stamp = now_iso()

    if baseline is None:  # 首跑：建基线 + 开唯一对账卡（dry-run 只报不写）
        if args.dry_run:
            print("SUMMARY diffs=0 issue=none")
            return 0
        existing = find_card(api)
        section = build_section(week, metrics, [], first=True, sha7=sha7, stamp=stamp)
        issue_no = write_card(api, existing, section, week)
        write_baseline(args.baseline, sha, week, issue_no, metrics)
        print("SUMMARY diffs=0 issue=#%d" % issue_no)
        return 0

    old_metrics = baseline["metrics"]
    diffs = []
    for key, name in METRIC_ORDER:
        if old_metrics[key] != metrics[key]:
            diffs.append((name, old_metrics[key], metrics[key]))
    n = len(diffs)
    old_issue = baseline.get("issue")

    if n == 0:  # 零差异：只报，不写卡不刷基线（幂等判据）
        issue_str = "#%d" % old_issue if isinstance(old_issue, int) else "none"
        print("SUMMARY diffs=0 issue=%s" % issue_str)
        return 0

    if args.dry_run:  # 有差异但未开卡：标 DRY
        print("SUMMARY diffs=%d issue=none (DRY)" % n)
        return 1

    existing = find_card(api)
    section = build_section(week, metrics, diffs, first=False, sha7=sha7, stamp=stamp)
    issue_no = write_card(api, existing, section, week)
    write_baseline(args.baseline, sha, week, issue_no, metrics)
    print("SUMMARY diffs=%d issue=#%d" % (n, issue_no))
    return 1


if __name__ == "__main__":
    sys.exit(main())
PY
