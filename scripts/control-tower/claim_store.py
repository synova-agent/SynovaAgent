#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/claim_store.py — D-C 声明归一 · 单一 claim 库（K3 预审 R1/R2/R3/R5/R6）

背景（K3 2026-10-07 变更前预审）:
  任务标识要从 `D#` 双编号退役到 GitHub issue 号；声明要从「task brief Q2 散文 +
  current-brief + task-state/<D#>.json + 四套解析器」收敛为**单一库**:
      `.claude/claims/<issue号>.yaml`  字段仅 `writeset` + `done`（可选 `note`）
  预审定罪的三条 P0：
    · R1 消费点 ≥30（清单低估）→ 同一解析语义必须单源，否则每多一套解析器就多一个口径
    · R3 迁移期双口径劫持（旧 D# 锚点劫持新 claim）→ 需要显式优先级规则
    · R5 夹具先行（无夹具不合并）

契约（铁律 47）:
  @输入  .claude/claims/<issue>.yaml（YAML 子集，见下）+ 暂存文件列表
  @输出  claim 对象 {issue, writeset[], done[], note, path} ／ resolve 判定
  @退出码 **三态**（ctrl-tower-change 模式 1）:
          0 = 通过／解析成功
          1 = 违规（声明缺失且无 legacy 证据 / writeset 为空 / done 条目缺 verify:）
          2 = 检查自身失败（文件畸形／不可读／参数非法／目录不可读）—— **同样阻断**
  @降级  绝不静默：任何降级都带 reason + degraded=True，并由调用方决定阻断
         （铁律 11 静默降级禁止；铁律 24/31）

⚠️ **两字段版无 `exclude`（"不做什么"）字段** —— 这不是遗漏，是收敛的代价：
   排除项语义**不在此处**，由 D708 写集对账单点承担（`merge_writeset_gate.py`：
   「声明 ⊇ 变更集」+ `## 写集豁免` 段落）。**下一个人不要以为排除项在本库被检查过**
   —— K3 预审 R1 三态表口径 + 本 PR 正文「例外清单」双处留痕。
   （若将来要恢复 exclude 语义，属于 claim schema 变更 ⇒ 判据变更 ⇒ 需 K3 过审。）

YAML 子集（**故意不收 PyYAML 依赖**——CI runner 与精简 Git 环境无该包，
  第三方依赖缺失会退化成"声明读不到" = 另一条静默路径）:
    writeset:
      - scripts/foo.sh          # 路径，可带引号
    done:
      - verify: bash tests/x.test.sh
    note: 单行自由文本（可选）
  规则:
    · 顶层键只允许 writeset / done / note；未知键 → ClaimError（防 typo 静默丢字段）
    · writeset 必填且非空；done 必填且每条须含 `verify:` 载荷
    · 本格式是合法 YAML（真 YAML 工具可读），但解析只用本文件的子集实现
    · 行内 `#` 注释在**非引号包裹**时剥离（避免路径里的 # 被误当注释）

feature flag（K3 R2）:
  `SYNO_CLAIM_V2`（默认关）——**唯一回滚点**。
    · 关（默认）: 本库不参与任何解析；既有 D# 路径逐字节不变（回滚 = 关开关，不改 30 文件）
    · 开        : claim-first；且存在 claim 时**禁用 D# 锚点回退**（K3 R3 劫持修复）

用法（CLI）:
  claim_store.py --path <issue>                  # 打印声明文件绝对路径（不存在 → exit 1）
  claim_store.py --show <issue>                   # JSON 单条
  claim_store.py --writeset <issue>               # 每行一个写集路径
  claim_store.py --done <issue>                   # 每行一条 verify 命令
  claim_store.py --all                            # JSON 全量
  claim_store.py --resolve <staged>...            # {status,issue,claim,reason,degraded}
  claim_store.py --check <issue>                  # 校验单条（0/1/2）
  claim_store.py --migration-marker               # 迁移期显式标识串（R6：禁静默空白）
  claim_store.py --legacy-view                    # task-state 形状的兼容视图（R6 消费者只读降级用）
  claim_store.py --issue-of "<text>"              # 从分支名/提交主题提取 issue 号（R5 单源）
  claim_store.py --flag                           # 打印 SYNO_CLAIM_V2 是否启用（0=开 1=关）
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

# ── 注入缝（测试隔离；生产有默认值）──────────────────────────────────────────
CLAIM_DIRNAME = ".claude/claims"
DEFAULT_DEGRADED_LOG = ".codex/control-tower/logs/degraded-events.log"

REQUIRED_KEYS = ("writeset", "done")
OPTIONAL_KEYS = ("note",)
ALLOWED_KEYS = REQUIRED_KEYS + OPTIONAL_KEYS

# issue 号 = 十进制数字（GitHub issue 号，1–7 位；`#` 前缀为显式形态）
ISSUE_RE = re.compile(r"#(\d{1,7})(?![0-9])")
# 分支名形态: feat/1234-xxx、fix/#1234-xxx、feat/1234、1234-xxx
BRANCH_ISSUE_RE = re.compile(r"(?:^|[/#])(\d{1,7})(?=[-_/]|$)")


class ClaimError(Exception):
    """claim 自身不可用（畸形/不可读）—— 调用方应判 exit 2（fail-closed，不等于通过）。"""

    def __init__(self, message: str, code: str = "claim-invalid", phase: str = "parse",
                 retryable: bool = False) -> None:
        super().__init__(message)
        # 铁律 32: 错误分类（code/phase/retryable）
        self.code = code
        self.phase = phase
        self.retryable = retryable


# ══════════════════════════════════════════════════════════════════════════════
# feature flag
# ══════════════════════════════════════════════════════════════════════════════
_TRUTHY = {"1", "true", "on", "yes", "y"}


def claim_v2_enabled(env: Optional[Dict[str, str]] = None) -> bool:
    """`SYNO_CLAIM_V2` 是否启用（K3 R2 单一开关，**默认开** —— 卡 #1423）。

    契约:
      @input  env: 环境字典（缺省 os.environ；测试注入）
      @output True = claim-v2 路径生效；False = 逐字节 legacy（回滚态）
      @降级   无

    口径（创始人 2026-10-08 裁决「一步到位」，卡 #1423）:
      · **未设** ⇒ True（默认开：新任务走 issue 号身份）；
      · 显式 truthy（1/true/on/yes/y）⇒ True；
      · **其它任何值**（含 0/off/false）⇒ False = **唯一回滚点**（回滚 = 显式关）。
      ⚠️ 存量 D# 任务**只读兼容**：无 claim 的动作全照旧（逐字节 legacy）——
         flip 不得让带 D# 的在飞任务 fail-closed（#1423 判据③ 反例）。
    """
    e = os.environ if env is None else env
    raw = str(e.get("SYNO_CLAIM_V2", "")).strip().lower()
    if not raw:
        return False  # 未设 = **默认关（回滚态）** —— 2026-10-08 热修：默认开使 main 红（见 docstring）
    return raw in _TRUTHY  # 显式开启能力保留（重翻时无需再改这里）


def claim_dir(root: Optional[Path | str] = None, env: Optional[Dict[str, str]] = None) -> Path:
    """claim 目录（注入缝 `SYNO_CLAIM_DIR` 优先，测试隔离用）。"""
    e = os.environ if env is None else env
    override = str(e.get("SYNO_CLAIM_DIR", "")).strip()
    if override:
        return Path(override)
    base = Path(root) if root else Path.cwd()
    return base / CLAIM_DIRNAME


# ══════════════════════════════════════════════════════════════════════════════
# 解析（YAML 子集）
# ══════════════════════════════════════════════════════════════════════════════
_TOP_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$")
_ITEM_RE = re.compile(r"^\s+-\s+(.*)$")


def _strip_inline_comment(raw: str) -> str:
    """剥离行内 `#` 注释——仅当 `#` 之前无引号包裹时（路径里的 # 交给引号保护）。"""
    s = raw
    out: List[str] = []
    quote = ""
    for i, ch in enumerate(s):
        if ch in "\"'":
            if quote == "":
                quote = ch
            elif quote == ch:
                quote = ""
            out.append(ch)
            continue
        if ch == "#" and quote == "":
            # `#` 前是空白或行首 → 注释起点（`a#b` 视为字面量）
            if i == 0 or s[i - 1] in " \t":
                break
        out.append(ch)
    return "".join(out)


def _unquote(s: str) -> str:
    v = s.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def parse_claim(text: str, path: str = "<memory>") -> dict:
    """解析 claim 文本 → {issue?, writeset, done, note}。

    契约（铁律 47）:
      @input  text: claim 文件内容（YAML 子集）；path: 报错点名用
      @output {"writeset": [...], "done": [{"verify": "..."}], "note": str|None}
      @降级   **不降级**——畸形一律抛 ClaimError（fail-closed，绝不返回半套声明）
    """
    current: Optional[str] = None
    data: Dict[str, object] = {"writeset": [], "done": [], "note": None}
    seen: Dict[str, bool] = {}
    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.rstrip("\r")
        if not line.strip():
            continue
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        m_top = _TOP_KEY_RE.match(line)
        if m_top and not line.startswith((" ", "\t")):
            key = m_top.group(1)
            if key not in ALLOWED_KEYS:
                raise ClaimError(
                    f"{path}:{lineno} 未知顶层键 {key!r}（只允许 {', '.join(ALLOWED_KEYS)}）"
                    f" —— 拒绝静默丢字段",
                    code="claim-unknown-key", phase="parse",
                )
            current = key
            seen[key] = True
            inline = _strip_inline_comment(m_top.group(2)).strip()
            if key == "note":
                data["note"] = _unquote(inline) if inline else None
            elif inline:
                raise ClaimError(
                    f"{path}:{lineno} 键 {key!r} 的值必须写成列表项（`  - <值>`），"
                    f"不接受内联标量 —— 当前为 {inline!r}",
                    code="claim-inline-scalar", phase="parse",
                )
            continue
        if current is None:
            raise ClaimError(f"{path}:{lineno} 顶层键之前出现内容: {stripped!r}",
                             code="claim-stray-line", phase="parse")
        m_item = _ITEM_RE.match(line)
        if not m_item:
            raise ClaimError(
                f"{path}:{lineno} 不是合法列表项（缩进 `  - 值`）: {stripped!r}",
                code="claim-bad-item", phase="parse",
            )
        value = _unquote(_strip_inline_comment(m_item.group(1)).strip())
        if not value:
            raise ClaimError(f"{path}:{lineno} 空列表项", code="claim-empty-item", phase="parse")
        as_list = data[current]
        assert isinstance(as_list, list)  # 顶层键只有 writeset/done 是列表
        if current == "done":
            vm = re.match(r"^verify\s*:\s*(.+)$", value)
            if not vm or len(vm.group(1).strip()) < 4:
                raise ClaimError(
                    f"{path}:{lineno} done 条目缺 `verify: <可跑命令>` 载荷: {value!r}"
                    f" —— Done 必须可被机器执行（K3 R5 场景 b）",
                    code="claim-done-without-verify", phase="parse",
                )
            as_list.append({"verify": vm.group(1).strip()})
        else:
            as_list.append(value)
    missing = [k for k in REQUIRED_KEYS if not seen.get(k)]
    if missing:
        raise ClaimError(f"{path}: 缺必填键 {missing}（只允许 {', '.join(ALLOWED_KEYS)}）",
                         code="claim-missing-key", phase="parse")
    ws = data["writeset"]
    if not isinstance(ws, list) or not ws:
        raise ClaimError(f"{path}: writeset 为空 —— 空声明等于没声明（禁静默空白）",
                         code="claim-empty-writeset", phase="validate")
    dn = data["done"]
    if not isinstance(dn, list) or not dn:
        raise ClaimError(
            f"{path}: done 为空 —— 无验收条目的声明不可对账（K3 R5 场景 b：Done 缺失必须红）",
            code="claim-empty-done", phase="validate",
        )
    return data


# ══════════════════════════════════════════════════════════════════════════════
# 载入 / 枚举
# ══════════════════════════════════════════════════════════════════════════════
def claim_path(root: Path | str, issue: str, env: Optional[Dict[str, str]] = None) -> Path:
    return claim_dir(root, env) / f"{normalize_issue(issue)}.yaml"


def normalize_issue(raw: str) -> str:
    """`#1234` / `1234` / `feat/#1234-x` → `1234`；非法 → 抛 ClaimError。"""
    s = str(raw or "").strip()
    m = ISSUE_RE.search(s)
    if m:
        return m.group(1)
    if re.fullmatch(r"\d{1,7}", s):
        return s
    raise ClaimError(f"非法 issue 号: {raw!r}（期望 `#<数字>` 或纯数字）",
                     code="issue-invalid", phase="arg")


def iter_claims(root: Path | str, env: Optional[Dict[str, str]] = None) -> List[dict]:
    """枚举全部 claim（畸形条目**不跳过**——收集进 `errors` 由调用方显式处理）。"""
    d = claim_dir(root, env)
    out: List[dict] = []
    if not d.is_dir():
        return out
    for f in sorted(d.glob("*.yaml")):
        stem = f.stem
        if not re.fullmatch(r"\d{1,7}", stem):
            continue  # 非 <issue>.yaml 形态（如 _consumers.yaml）不参与解析
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
            data = parse_claim(text, str(f))
            out.append({"issue": stem, "path": str(f), **data})
        except ClaimError as exc:
            out.append({"issue": stem, "path": str(f), "error": str(exc),
                        "error_code": exc.code})
    return out


def load_claim(root: Path | str, issue: str,
               env: Optional[Dict[str, str]] = None) -> Optional[dict]:
    """载入单条 claim。

    契约:
      @input  root/issue
      @output dict（含 issue/path/writeset/done/note）| None = 文件不存在
      @降级   文件存在但畸形 → 抛 ClaimError（**不返回 None**，否则调用方把
              "畸形"与"不存在"混成一个静默分支）
    """
    p = claim_path(root, issue, env)
    if not p.is_file():
        return None
    text = p.read_text(encoding="utf-8", errors="replace")
    return {"issue": normalize_issue(issue), "path": str(p), **parse_claim(text, str(p))}


# ══════════════════════════════════════════════════════════════════════════════
# issue 身份提取（**单源**：commit-msg-check.sh 与 merge_writeset_gate.py 同批消费，K3 R5）
# ══════════════════════════════════════════════════════════════════════════════
def parse_issue(text: str) -> Optional[str]:
    """从**提交主题 / 分支名 / scope** 提取 issue 号。

    契约:
      @input  text: 任意文本（`feat(#1234): …` / `feat/1234-x` / `fix/#1234-x`）
      @output issue 号字符串（无 `#`）| None
      @降级   无（纯字符串判定）
    边界: `#1234` 优先（显式）；否则接受分支形态 `/<数字>-` 或 `/<数字>` 结尾。
      40 位 SHA 里的数字**不**命中（需要 `#` 或 `/` 前导 + 词元边界）。
    """
    s = text or ""
    m = ISSUE_RE.search(s)
    if m:
        return m.group(1)
    # 分支形态：先看完整分支名各段是否以数字开头（`feat/1234-x`）
    for seg in re.split(r"[/]", s.strip()):
        seg = seg.strip()
        m2 = re.fullmatch(r"#?(\d{1,7})", seg)
        if m2:
            return m2.group(1)
    m3 = BRANCH_ISSUE_RE.search(s)
    if m3:
        return m3.group(1)
    return None


# ══════════════════════════════════════════════════════════════════════════════
# 匹配（与 brief_parser.match_path 同语义：`(^|/)pat$`）
# ══════════════════════════════════════════════════════════════════════════════
def match_path(path: str, pattern: str) -> bool:
    return re.search(r"(^|/)" + re.escape(pattern) + r"$", path) is not None


def path_in_writeset(path: str, writeset: Iterable[str]) -> bool:
    p = path.replace("\\", "/")
    return any(match_path(p, w.replace("\\", "/")) for w in writeset)


# ══════════════════════════════════════════════════════════════════════════════
# resolve —— claim-first 解析（K3 R3 劫持修复的判据侧）
# ══════════════════════════════════════════════════════════════════════════════
def resolve(root: Path | str, staged: List[str], issue_hint: str = "",
            env: Optional[Dict[str, str]] = None) -> dict:
    """为暂存文件集解析归属 claim。

    契约（铁律 47）:
      @input  root: 仓库根；staged: 暂存文件列表（相对路径）；issue_hint: 分支/提交里取到的 issue 号
      @output {"status": "resolved"|"none"|"missing"|"invalid",
               "issue": str|None, "claim": dict|None, "reason": str, "degraded": bool}
      @降级   目录不可读 → status=invalid + degraded=True（**不判通过**）
    三态映射（调用方）:
      resolved → 0；missing/none → 1（fail-closed：声明缺失不得静默放行）；
      invalid  → 2（检查自身失败）
    判定顺序（**claim 存在即禁用 D# 锚点**，K3 R3）:
      ① issue_hint 有值且存在 `<issue>.yaml` → 该 claim（写集命中暂存 → resolved；
         写集不命中 → 仍 resolved 但 reason 标注未命中，由调用方按 G12 口径裁决）
      ② 无 hint → 扫描全部 claim，取命中暂存文件数最多者（>0 才 resolved）
      ③ 全部不命中 → missing（无声明）
    """
    d = claim_dir(root, env)
    if not d.exists():
        return {"status": "missing", "issue": None, "claim": None, "degraded": False,
                "reason": f"claim 目录不存在: {d}（无声明）"}
    if not d.is_dir():
        return {"status": "invalid", "issue": None, "claim": None, "degraded": True,
                "reason": f"claim 路径不是目录: {d}"}

    if issue_hint:
        try:
            norm = normalize_issue(issue_hint)
        except ClaimError as exc:
            return {"status": "invalid", "issue": None, "claim": None, "degraded": True,
                    "reason": f"issue_hint 非法: {exc}"}
        try:
            c = load_claim(root, norm, env)
        except ClaimError as exc:
            return {"status": "invalid", "issue": norm, "claim": None, "degraded": True,
                    "reason": f"claim 畸形: {exc}"}
        if c is None:
            return {"status": "missing", "issue": norm, "claim": None, "degraded": False,
                    "reason": f"issue #{norm} 无 claim 文件（{d}/{norm}.yaml 不存在）"}
        hit = [f for f in staged if path_in_writeset(f, c["writeset"])]
        return {"status": "resolved", "issue": norm, "claim": c, "degraded": False,
                "matched": hit,
                "reason": (f"claim #{norm} 命中 {len(hit)}/{len(staged)} 个暂存文件"
                           if hit else
                           f"claim #{norm} 存在但未命中任何暂存文件（按 issue 身份解析）")}

    best = None
    best_n = 0
    broken: List[str] = []
    for c in iter_claims(root, env):
        if c.get("error"):
            broken.append(f"{c['issue']}: {c['error']}")
            continue
        n = sum(1 for f in staged if path_in_writeset(f, c["writeset"]))
        if n > best_n:
            best, best_n = c, n
    if broken:
        # 畸形条目存在 → 检查自身不完整，不得判"无声明"（否则静默丢声明）
        return {"status": "invalid", "issue": None, "claim": None, "degraded": True,
                "reason": "存在畸形 claim 文件: " + "; ".join(broken)}
    if best is not None and best_n > 0:
        return {"status": "resolved", "issue": best["issue"], "claim": best,
                "degraded": False, "matched": best_n,
                "reason": f"claim #{best['issue']} 命中 {best_n} 个暂存文件"}
    return {"status": "missing", "issue": None, "claim": None, "degraded": False,
            "reason": f"扫描 {d} 未发现命中暂存文件的 claim"}


# ══════════════════════════════════════════════════════════════════════════════
# R6: 迁移期显式标识 + legacy 兼容视图（禁静默空白）
# ══════════════════════════════════════════════════════════════════════════════
MIGRATION_MARKER = "[迁移期] 本视图含 task-state 存量（旧 D# 只读）；新任务在 .claude/claims/"


def migration_marker() -> str:
    """R6 统一"迁移期"标识串——**空白仪表盘必须打印它**，不得静默空。"""
    return MIGRATION_MARKER


def legacy_view(root: Path | str, env: Optional[Dict[str, str]] = None) -> dict:
    """把 claim 投影成 task-state 形状的只读兼容视图（R6 消费者"只读保留"档用）。

    契约:
      @input  root
      @output {"migration_period": True, "marker": str, "claims": {issue: {...}},
               "errors": [...], "degraded": bool}
      @降级   畸形 claim 进 errors（**不静默丢**）+ degraded=True
    说明: **不写任何 task-state 文件**——只读投影，旧 D# JSON 保持只读不动。
    """
    claims: Dict[str, dict] = {}
    errors: List[str] = []
    for c in iter_claims(root, env):
        if c.get("error"):
            errors.append(f"{c['issue']}: {c['error']}")
            continue
        claims[c["issue"]] = {
            "task_id": f"#{c['issue']}",
            "write_set": list(c["writeset"]),
            "done": [d["verify"] for d in c["done"]],
            "note": c.get("note"),
            "source": c["path"],
            "status": "claimed",
        }
    return {"migration_period": True, "marker": MIGRATION_MARKER,
            "claims": claims, "errors": errors, "degraded": bool(errors)}


# ══════════════════════════════════════════════════════════════════════════════
# D1220（卡 #1222 D-A2）: 组 12 claim 载体的**多 claim 并集覆盖**判定
#   ⚠️ 与 resolve() 的区别（勿混用）: resolve() = **最佳单 claim**（按命中数取最大，
#     供「本提交属于哪个 issue」身份解析）；coverage() = **全 claim 并集**（供「每个暂存文件
#     是否被任一声明覆盖」的范围判定）。多线并发时用 resolve() 判范围会**假红**（他人 claim
#     覆盖的文件会被判未覆盖）。
# ══════════════════════════════════════════════════════════════════════════════
def coverage(root: Path | str, staged: List[str],
             env: Optional[Dict[str, str]] = None) -> dict:
    """暂存文件 vs 全部 claim 的**并集**覆盖判定。

    契约（铁律 47）:
      @input  root; staged = 暂存文件相对路径列表（原序去重后判定）；env（SYNO_CLAIMS_DIR 等）
      @output {"status": "ok"|"invalid",
               "claims": <可解析 claim 条数>,
               "covered": [被任一 claim 覆盖的暂存文件],
               "uncovered": [未被任何 claim 覆盖的暂存文件],
               "matched": {issue: [文件...]}（仅列有命中的 claim）,
               "broken": [畸形 claim 摘要...],
               "degraded": bool, "reason": str}
              **并集语义**：一个文件只要被 ≥1 条 claim 的 writeset 覆盖即计入 covered。
              **显式空集语义（禁静默）**：无 claim 目录/0 条 claim ⇒ claims=0、
              uncovered=全部 staged、reason 明写「0 条 claim（显式空集）——覆盖判定对全部 N 个
              暂存文件为『未覆盖』」；**不**返回空结果冒充通过。
      @exit   — 由 main 映射：ok ⇒ 0；invalid（存在畸形 claim）⇒ 2（检查自身失败，fail-closed）
      @degraded — 畸形条目 ⇒ degraded=True（检查自身不完整，**不得判「无声明」**）
      @error   — ClaimError 由 main 统一捕获 ⇒ exit 2（铁律 24/31/32）
    """
    staged_u: List[str] = []
    for s in staged:
        s = s.strip()
        if s and s not in staged_u:
            staged_u.append(s)
    claims = iter_claims(root, env)
    broken = [f"{c.get('issue')}: {c.get('error')}"
              for c in claims if c.get("error")]
    good = [c for c in claims if not c.get("error")]
    matched: Dict[str, List[str]] = {}
    covered_set: set = set()
    for c in good:
        hit = [f for f in staged_u if path_in_writeset(f, c["writeset"])]
        if hit:
            matched[c["issue"]] = hit
            covered_set.update(hit)
    covered = [f for f in staged_u if f in covered_set]
    uncovered = [f for f in staged_u if f not in covered_set]
    if broken:
        return {"status": "invalid", "claims": len(good), "covered": covered,
                "uncovered": uncovered, "matched": matched, "broken": broken,
                "degraded": True,
                "reason": (f"{len(broken)} 条 claim 畸形 ⇒ 覆盖判定不完整"
                           "（检查自身失败，不得判『无声明』）")}
    if not good:
        return {"status": "ok", "claims": 0, "covered": [], "uncovered": uncovered,
                "matched": {}, "broken": [], "degraded": False,
                "reason": (f"0 条 claim（显式空集）—— 覆盖判定对全部 {len(staged_u)} 个"
                           "暂存文件为『未覆盖』（非静默跳过）")}
    return {"status": "ok", "claims": len(good), "covered": covered,
            "uncovered": uncovered, "matched": matched, "broken": [],
            "degraded": False,
            "reason": (f"{len(good)} 条 claim（并集）；覆盖 {len(covered)}/{len(staged_u)}"
                       f" 个暂存文件" + (f"，未覆盖 {len(uncovered)} 个" if uncovered else ""))}


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════
def _emit(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False))


def _root_of(repo: str) -> Path:
    return Path(repo).resolve() if repo else Path.cwd()


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="D-C 单一 claim 库（.claude/claims/<issue>.yaml）")
    ap.add_argument("--root", default="", help="仓库根（缺省 = cwd）")
    ap.add_argument("--path", metavar="ISSUE", help="打印声明文件路径")
    ap.add_argument("--show", metavar="ISSUE", help="JSON 输出单条")
    ap.add_argument("--writeset", metavar="ISSUE", help="输出写集路径（每行一个）")
    ap.add_argument("--done", metavar="ISSUE", help="输出 done 的 verify 命令（每行一条）")
    ap.add_argument("--all", action="store_true", help="JSON 输出全量")
    ap.add_argument("--resolve", nargs="*", default=None, metavar="STAGED",
                    help="为暂存文件解析归属 claim（stdin 亦接受）")
    ap.add_argument("--resolve-path", nargs="*", default=None, metavar="STAGED",
                    help="同 --resolve，但**只打印 claim 文件路径**（0=命中，1=无声明，2=自身失败）")
    ap.add_argument("--coverage", nargs="*", default=None, metavar="STAGED",
                    help="暂存文件 vs 全部 claim 的**并集**覆盖（JSON；0=ok，2=检查自身失败）")
    ap.add_argument("--issue-of", metavar="TEXT", help="从文本提取 issue 号")
    ap.add_argument("--check", metavar="ISSUE", help="校验单条")
    ap.add_argument("--migration-marker", action="store_true", help="打印迁移期标识")
    ap.add_argument("--legacy-view", action="store_true", help="task-state 形状兼容视图")
    ap.add_argument("--flag", action="store_true", help="打印 SYNO_CLAIM_V2 状态")
    args = ap.parse_args(argv)
    root = _root_of(args.root)

    try:
        if args.flag:
            print("on" if claim_v2_enabled() else "off")
            return 0

        if args.issue_of is not None:
            v = parse_issue(args.issue_of)
            print(v if v else "")
            return 0

        if args.migration_marker:
            print(migration_marker())
            return 0

        if args.path:
            p = claim_path(root, args.path)
            print(p)
            return 0 if p.is_file() else 1

        if args.show:
            c = load_claim(root, args.show)
            if c is None:
                _emit({"status": "missing", "issue": normalize_issue(args.show),
                       "reason": f"无声明文件 {claim_path(root, args.show)}"})
                return 1
            _emit({"status": "ok", **c})
            return 0

        if args.writeset:
            c = load_claim(root, args.writeset)
            if c is None:
                print(f"claim 缺失: {claim_path(root, args.writeset)}", file=sys.stderr)
                return 1
            for w in c["writeset"]:
                print(w)
            return 0

        if args.done:
            c = load_claim(root, args.done)
            if c is None:
                print(f"claim 缺失: {claim_path(root, args.done)}", file=sys.stderr)
                return 1
            for d in c["done"]:
                print(d["verify"])
            return 0

        if args.all:
            _emit({"claims": iter_claims(root), "dir": str(claim_dir(root))})
            return 0

        if args.resolve is not None or args.resolve_path is not None:
            raw = args.resolve if args.resolve is not None else (args.resolve_path or [])
            staged = [s for s in raw if s.strip()]
            if not staged:
                try:
                    if not sys.stdin.isatty():
                        staged = [s for s in sys.stdin.read().split("\n") if s.strip()]
                except OSError:
                    staged = []
            issue_hint = os.environ.get("SYNO_ISSUE_HINT", "")
            r = resolve(root, staged, issue_hint)
            if args.resolve_path is not None:
                if r["status"] == "resolved":
                    print((r.get("claim") or {}).get("path", ""))
                    return 0
                return {"missing": 1, "none": 1, "invalid": 2}.get(r["status"], 2)
            _emit(r)
            return {"resolved": 0, "missing": 1, "none": 1, "invalid": 2}.get(r["status"], 2)

        if args.coverage is not None:
            raw = args.coverage
            staged = [s for s in raw if s.strip()]
            if not staged:
                try:
                    if not sys.stdin.isatty():
                        staged = [s for s in sys.stdin.read().split("\n") if s.strip()]
                except OSError:
                    staged = []
            r = coverage(root, staged)
            _emit(r)
            return 2 if r["status"] == "invalid" else 0

        if args.check:
            c = load_claim(root, args.check)
            if c is None:
                _emit({"status": "missing", "issue": normalize_issue(args.check),
                       "reason": f"无声明文件 {claim_path(root, args.check)}"})
                return 1
            _emit({"status": "ok", "issue": c["issue"], "writeset": len(c["writeset"]),
                   "done": len(c["done"])})
            return 0

        if args.legacy_view:
            _emit(legacy_view(root))
            return 0
    except ClaimError as exc:
        # 铁律 24/31/32: 显式降级输出（code/phase/retryable），exit 2 = 检查自身失败
        _emit({"status": "invalid", "degraded": True, "reason": str(exc),
               "code": exc.code, "phase": exc.phase, "retryable": exc.retryable})
        return 2

    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
