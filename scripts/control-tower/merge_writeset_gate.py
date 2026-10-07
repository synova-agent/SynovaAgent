#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/merge_writeset_gate.py — D708 合并级写集对账 gate

背景（M2 族第三次止血）:
  #449 夹带 D603 共 51 文件 / #442 夹带 6 文件 / D593-FIX 声称提交实未提交 —— 三次
  「PR 声称的写集」与「真正进入 main 的文件集」不一致，而现有门禁都抓不到：
    - pre-commit 13 组：单提交粒度，只看暂存区，不看 PR 整体
    - verify-parallel.sh（ci.yml L51-57）：**已合 PR 之间**的写集重叠（inter-PR），
      不校验单个 PR 与**自己声明**的一致性（intra-PR）
  本 gate 补的正是 intra-PR 这一格：一个 PR 从「通过的写集」到「真正进入 main 的文件集」
  之间不许出现夹带；出现即红并逐文件点名。

与现有 gate 的边界（不重复造）:
  | gate | 比较对象 | 抓什么 |
  |---|---|---|
  | ci.yml L51-57 verify-parallel --ci-pr | 本 PR 变更集 × 已合 PR 写集 | 两个 PR 撞同一批文件 |
  | 本 gate | 本 PR 变更集 × **本 PR 自己的声明** | 本 PR 里混入未声明文件（夹带） |
  两者正交，触发点同为 PR job。

声明源与权威顺序（S1 > S2 > S3，多源存在时取**并集**）:
  S1 `task-state/<D#>.json` 的 `write_set` 数组        —— 结构化，机器可读
  S2 dev doc `docs/plans/codex/implementation/SYNOVA-IMPL-*<D#>*.md` §写集表 —— 复用 devdoc_writeset.py
  S3 task brief `.claude/task-briefs/*<D#>*.md` 的 Q2「做什么」  —— 复用 brief_parser.py
  取并集的理由：三者都是**作者自己的声明**；用交集会把「在 A 声明、在 B 未列」当成夹带，
  属对声明语义的误读。被哪个源收录会在输出里逐条打印（可审计）。

契约（铁律 47）:
  @input   --base <ref>（缺省 origin/main） --head <ref>（缺省 HEAD） --branch <name>
           --pr-body <file>（可选；用于读取 PR 正文里的 `## 写集豁免`）
           --json（机器可读输出） --repo-root <path>
  @output  人读诊断块（夹带文件逐条点名 + 声明源 + 修复指引）或 JSON
  @exit    0 = 无夹带（含合法跳过） / 1 = 检测到夹带（业务阻断）
           2 = **无法判定**（取不到 diff / 无任何声明且变更不在文档范围 / 解析失败）
               —— 铁律 11：绝不静默放行为「通过」；D328 三态惯例。

豁免（**必须显式**，且逐条打印理由）:
  ① 分支级: `auto/**`（CI 自动生成的仪表盘分支）→ 整个 gate 跳过
  ② 路径级内置: `.claude/bypass.log`（每个提交都被 post-commit hook 追加的证据账本，
     与写集无关，属运行期产物）
  ③ 声明级: 声明文件里的 `## 写集豁免` 段落（每行 `- <路径> — <理由>`），无理由不生效

CT-D（2026-09-27）评估结论 —— **本 gate 不给 `docs/synova/product-lines/evidence/**` 加目录级豁免**:
  评估对象: `check-pr-budget.sh` 的 `GOV_PREFIX_RE` 对 `docs/synova/product-lines/evidence/`
    是**目录级**豁免（治理产物不计 ≤12 文件预算）；本 gate 只有 `.claude/bypass.log`。
  结论: **不改**（保持 evidence 必须进本 PR 的声明写集）。三条理由:
    ① 两 gate 的豁免语义不同类: 预算 gate 的豁免是"**计数口径**"（这类文件不占 PR 体积），
       本 gate 的豁免是"**授权口径**"（这类文件不属本 PR 的写集）——把计数口径搬到授权口径
       是语义挪用，不是口径统一。
    ② `evidence/` 是**各任务证明的聚集地**（实测 113 文件 / 19 目录）。给它目录级豁免 =
       任何 PR 都可静默夹带、乃至改写**别人的**证据文件——恰是本 gate（intra-PR 自洽）
       要防的那一格。证据文件本身就是交付物，必须在自己的声明里。
    ③ 实测行为对照（本文件不改、仅记录）:
       · evidence 文件**已**在声明写集里 → `pass`（正常放行）
       · evidence 文件**未**在声明写集里 → `block` + 逐文件点名（保留可审计性）
     需要放行一次的场合，走豁免③（`## 写集豁免` 段落 + 逐条理由），**豁免必须显式**。
  编号对账: 本 gate 的路径级内置豁免只有 ② 一条；目录级豁免 0 条（有意）。
"""
import argparse
import shutil
import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

# ── 内置豁免（路径级）。加条目必须附理由，且会在输出里打印 ──
BUILTIN_EXEMPT: Dict[str, str] = {
    ".claude/bypass.log": "post-commit hook 每次提交追加的证据账本（运行期产物，与写集无关）",
}
# ── D-C（K3 预审 R5）: issue 号身份提取（与 commit 规范 `feat(#N): …` 同批）──
# 为什么必须同批: 提交规范换成 `feat(#1197): …` 后，本 gate 旧实现只认 D# 形态
#   （`DID_RE`）⇒ 新提交的**对账锚点消失**，S1/S2/S3 三源全空 → 写集对账静默失效。
# 单源: 提取与 claim 载入都走 `claim_store`（**不复制正则**）——K3 R1 定罪"每多一套
#   解析口径就多一条漂移路径"，本 gate 是第 15 个消费点，必须同源。
# 降级: claim_store 不可导入 → issue 通道整体不可用 + 显式告警（**不静默当"无 issue"**）
try:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from claim_store import (  # noqa: E402
        ClaimError as _ClaimError,
        claim_path as _claim_path,
        load_claim as _load_claim,
        parse_issue as _parse_issue,
    )
    _CLAIM_STORE_OK = True
    _CLAIM_STORE_ERR = ""
except ImportError as _exc:  # pragma: no cover - 仅在部署不完整时命中
    _CLAIM_STORE_OK = False
    _CLAIM_STORE_ERR = str(_exc)

CLAIM_SOURCE_LABEL = "S0:claim.writeset"

# 分支级跳过
#   auto/**  —— CI 自动生成的仪表盘分支（无写集语义）
#   main/master —— 合并后 push：本 gate 的触发点是**合并前**（PR job），
#                  合并后对账只能事后发现、且此时 PR 语义已消失 → 本 gate 不管这一格
SKIP_BRANCH_RE = re.compile(r"^(auto/|main$|master$)")
# 「无声明」时可降级放行的非源码范围（纯文档/流程产物）
DOC_SCOPE_RE = re.compile(
    r"^(docs/|\.claude/|memory/|task-state/|\.github/)|\.md$"
)


def python_bin() -> str:
    """跨平台 python 解释器解析（D520 / PLATFORM-CHECKLIST.md 的 PYBIN 惯例）。

    本脚本自身由 python 运行，此函数只用于**派生**子进程去调用同目录的解析器
    （devdoc_writeset.py / brief_parser.py）。Windows 上可能只有 `python` 或 `py -3`，
    故按 PYBIN 惯例逐级探测（见 PLATFORM-CHECKLIST.md / D520）；全不可用 → 回退 sys.executable。
    """
    if sys.executable:
        return sys.executable
    for cand in ("python3", "python", "py"):  # PYBIN 惯例（D520）
        p = shutil.which(cand)
        if p:
            return p
    return "python3"  # 兜底：交由 subprocess 抛错（GateError 包装，不静默）


class GateError(Exception):
    """gate 自身无法判定（→ exit 2，fail-closed）。"""


class AmbiguousDeclaration(GateError):
    """声明文件多命中（CT-A2）——**必须 fail-closed 并逐条点名全部候选**。

    为什么不能取一个: `find_declaration_files()` 原先用 `hits[-1]`（排序末位）静默取一份
    → 同名匹配多份时（如 `D1` 会同时命中 `…D1…`/`…D10…` 等）声明源可能指向**别人的任务**
    → 写集对账用的是别人的声明，夹带判定整体失真，且失败点不可见。
    处置: 报错 + 候选逐条点名（调用方 → exit 2，_emit 打印全部候选路径）。
    """

    def __init__(self, kind: str, pattern: str, candidates: List[str]):
        self.kind = kind
        self.pattern = pattern
        self.candidates = list(candidates)
        super().__init__(
            f"声明源多命中（{kind}，匹配 {pattern}）: {len(self.candidates)} 个候选 "
            f"→ fail-closed，拒绝静默取一个；候选: " + " | ".join(self.candidates))


def run_git(args: List[str], cwd: str) -> str:
    try:
        p = subprocess.run(["git"] + args, cwd=cwd, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        raise GateError(f"git {' '.join(args)} 执行失败: {exc}") from exc
    if p.returncode != 0:
        raise GateError(f"git {' '.join(args)} 返回 {p.returncode}: {(p.stderr or '').strip()[:200]}")
    return p.stdout


def changed_files(repo: str, base: str, head: str) -> Tuple[str, List[str]]:
    """返回 (merge_base_sha, 变更路径列表)。取不到 → GateError（fail-closed）。"""
    mb = run_git(["merge-base", base, head], repo).strip()
    if not mb:
        raise GateError(f"merge-base({base}, {head}) 为空 — 无法计算变更集")
    # D339 同款: 必须关掉 core.quotepath，否则 CJK 文件名被转义成 "...\345\220..." 引号串
    # → 与声明条目永不匹配 → 中文名文件一律被误判夹带（本仓大量中文文档名）
    out = run_git(["-c", "core.quotepath=false", "diff", "--name-only", "--no-renames",
                   f"{mb}..{head}"], repo)
    files = [ln.strip() for ln in out.splitlines() if ln.strip()]
    return mb, files


# D708 复核修复①: 大小写不敏感。分支名/提交 scope 常见小写（feat/win-d702-…、docs(d702): …），
#   旧实现只认大写 D → 推断为空 → 回退链失守（复核实测 parse_did('feat/win-d702-…') → None）。
#   统一归一化为大写，保证与 task-state / brief 文件名里的 D# 口径一致。
#
# ── 合并级归并（D1030 #867 × D1039 #872，2026-09-29）──
#   两条支线改的是**同一判据的两种实现**，此处取"更严且更多层"的 D1030 方案：
#     · D1039（#872）: DID_RE 加**字母数字**词边界 `(?<![0-9A-Za-z])…(?![0-9A-Za-z])`
#       目标用例 = PR merge commit 内嵌 40 全长 SHA（`Merge b2678c2… into ff46771…` → 误判 D63）。
#     · D1030（#867）: 三层修法（① 合成 merge 主题整条不参与 ② 十六进制邻接边界 ③ 裸 SHA 词元判无效）
#       目标用例 = **同一族根因**（合成 merge 主题里的 SHA 被抠成伪号，实测 5 SHA → D54/D4/D0/D34/D34）。
#   ⇒ 取 D1030：其第①层把 `Merge <40hex> into <40hex>` 整条吞掉，D1039 的目标用例被完全覆盖；
#     且另覆盖 `--first-parent` 与 `merge-base..start` 两处漂移（D1039 未涉及）。
#   ⇒ D1039 的回归判据（`ci(D1039):`→D1039 ｜ `docs(D1034):`→D1034 ｜ `feat(d702):`→d702 ｜
#     `bypass COMMITTED 登记 (auto hook, D521)`→D521 ｜ merge 全长 SHA→无）逐条保留在
#     tests/control-tower/merge_writeset_gate.test.sh 中，归并后仍须全绿。
# ═══ CT-C（2026-09-27，P0）: D# 推断随机性根治 ═══
# 现象（改前实测）: GitHub 对 pull_request 事件**合成**的 merge 提交，主题形如
#   `Merge <head_sha> into <base_sha>`（两个载荷**都是十六进制 SHA**）。
#   旧 DID_RE = `[Dd]\d+` 从**整条主题**贪婪取号 → 从 SHA 里抠出伪号：
#     改前实测: `Merge 9e4141…d54e… into 760923…` → **D54**；`Union Merge 4afd4ce into 017bef55` → **D4**
#   ⇒ **同一份代码、不同 SHA ⇒ 推出不同 D#**（5 个 SHA 实测 → D54 / D4 / D0 / D34 / D34）。
# 三层修法（缺一不可，逐层都可以单独回红）：
#   ① `is_synthetic_merge_subject()`：合成 merge 主题**整体不参与**推断。其载荷按定义是
#      VCS 元数据（SHA / PR 号），**永远不是**作者写的任务号；只吞这两种 VCS 合成主题，
#      真业务主题（`docs(D814): …`、`feat/win-d702-…`、`Merge branch 'main'`）一律不吞。
#   ② `DID_RE` 加**十六进制邻接边界**：紧邻其它十六进制字符的 `d<数字>` 属于一个 hex blob
#      （SHA / 短哈希），不是任务号。
#   ③ `_inside_sha_token()`：候选若**整词元**就是 7–40 位裸 SHA（② 的边界对"整词元"无效），判无效。
DID_RE = re.compile(r"(?<![0-9a-fA-F])[Dd]\d+(?![0-9a-fA-F])")

# 合成 merge 主题特征（CT-C 修法①）。**锚定式**：只有"整条主题就是 VCS 合成产物"才命中，
#   避免把带 SHA 字样的真业务主题一起吞掉（边界收紧）。
SYNTHETIC_MERGE_SUBJECT_RES: Tuple[re.Pattern, ...] = (
    # GitHub 合成的 pull_request merge / 本地 `git merge <sha>`：载荷两侧都是 SHA。
    re.compile(r"^Merge [0-9a-fA-F]{7,40} into [0-9a-fA-F]{7,40}\s*$"),
    # GitHub 把 PR 合进主干：`Merge pull request #N from <owner>/<branch>`。
    #   分支名里可能夹带**别人的** D# → 扫历史时会把写集错锚到别的任务。
    re.compile(r"^Merge pull request #\d+ from \S+"),
)

# `_inside_sha_token` 用的裸 SHA 词元（CT-C 修法③）。
SHA_TOKEN_RE = re.compile(r"[0-9a-fA-F]{7,40}")

# D708 复核修复②: post-commit hook 生成「登记影子提交」，其 subject 含 `bypass COMMITTED 登记`
#   且**带一个历史 D#**（如 `(auto hook, D521)`）。HEAD 经常就是这个影子提交 →
#   旧回退链直接读 `git log -1` 会把写集错配到 D521（复核实测确认）。
#   故回退时向前遍历，跳过登记提交，取第一个带 D# 的非登记提交。
REGISTRATION_SUBJECT_RE = re.compile(r"bypass COMMITTED 登记")
FALLBACK_SCAN_DEPTH = 20


def is_synthetic_merge_subject(text: str) -> bool:
    """主题是否是 VCS 合成的 merge 提交（其载荷按定义是 SHA/PR 号，不是作者写的任务号）。

    契约（铁律 47）:
      @input  text: 提交主题原样（可含前后空白）
      @output True = 合成 merge 主题（不得用于 D# 推断）/ False = 其它
      @降级   无（纯字符串判定，不抛错）
    收紧边界: 两条都是**整条主题锚定**（`^…$` / `^…` 且载荷形态固定）——
      `Merge branch 'main' into feat/foo`、`docs(D814): …` 均**不**命中（不吞真业务主题）。
    """
    s = (text or "").strip()
    return any(rx.match(s) is not None for rx in SYNTHETIC_MERGE_SUBJECT_RES)


def _inside_sha_token(text: str, start: int, end: int) -> bool:
    """[start, end) 的候选是否落在某个 7–40 位裸十六进制词元内（CT-C 修法③）。

    为什么②不够: `DID_RE` 的邻接边界只挡"紧邻其它 hex 字符"的情形；**整词元**恰好是
      7–40 位纯 hex（如 `Merge d5412345 into x` 里的 `d5412345`）时边界两侧都是空格、
      ② 放行，但它在形态上就是一个裸 SHA → 必须判无效。
    """
    for m in SHA_TOKEN_RE.finditer(text or ""):
        if m.start() <= start and end <= m.end():
            return True
    return False


def _redact_hex(text: str) -> str:
    """把文本里的裸 SHA 形态词元（7–40 位十六进制）替换成 `<sha>`（CT-C 收口②的输出面）。

    为什么输出面也要收口: P0 的判据是"**同一份代码在不同 SHA 上跑 ⇒ 结果逐字一致**"。
      推断面收口后，"决策字段"已一致，但诊断行仍会回显合成 merge 主题的原始 SHA
      → 输出随 SHA 变化 ⇒ 判据②在**输出面**仍不成立（且下游若有工具从 gate 输出里
      抠 `[Dd]\\d+`，会再把伪号捡回去）。
      脱敏后输出完全不携带 SHA 文本 ⇒ 判据从"决策一致"升级为"逐字节一致"。
    """
    return SHA_TOKEN_RE.sub("<sha>", text or "")


def parse_did(text: str) -> Optional[str]:
    """从文本里取 D#（CT-C 后只认"像任务号的位置"）。

    契约（铁律 47）:
      @input  text: 任意文本（分支名 / 提交主题 / --did 值）
      @output 归一化大写的 D#；无合法候选 → None
      @降级   ① 合成 merge 主题 → None（载荷是 SHA，不是作者意图）；
              ② 候选落在裸 SHA 词元内 → **跳过该候选继续找下一个**（不静默取伪号，也不因此丢弃整条文本）
    保持既有正确行为（D708 回归面）: `feat/win-d702-…` → D702、`docs(d702): …` → D702、
      `fix/D708-merge-writeset-gate` → D708、`(auto hook, D521)` → D521。
    """
    s = text or ""
    if is_synthetic_merge_subject(s):
        return None
    for m in DID_RE.finditer(s):
        if _inside_sha_token(s, m.start(), m.end()):
            continue
        return m.group(0).upper()
    return None


def infer_did(repo: str, branch: str, head: str,
              override: Optional[str] = None,
              merge_base: str = "") -> Tuple[Optional[str], str, List[str]]:
    """推断任务 D#。返回 (D#|None, 来源, 诊断行列表)。

    顺序（D954）：⓪ `--did` 显式覆盖 → ① 分支名 → ② 向前遍历提交 subject
    （跳过自动登记影子提交 + 跳过合成 merge 提交）。

    来源取值: `explicit` | `branch` | `commit-subject` | `none`。
    `diag` 逐条记录**试过哪些源、为何空、扫了什么范围** —— 三源全空时由调用方打印，
    使 fail-closed 可诊断（K3 判 #741：推断失败此前是静默的）。

    CT-C（2026-09-27）② 段落的两项收口（D814 落地）:
      a. **`--first-parent`**：只沿第一父链走（分支自身提交），并入侧（merge 的第二父）
         不再参与 → 修 D814「merge main 后错锚到 main 侧任务号」。
      b. **`merge_base..start` 范围**：把 base 侧历史整体挡在扫描面外
         （`git merge-base(base, head)` 之前的提交不提供 D#）。
      c. **合成 merge 锚点**：HEAD 本身是 GitHub 合成的 merge 提交时（主题
         `Merge <head_sha> into <base_sha>`），其第一父是 **base**、PR 自身提交在**第二父**侧；
         直接对 HEAD 用 `--first-parent` 第一步就走进 main 历史 → 故锚到 `HEAD^2` 再扫。

    契约（铁律 47）:
      @input  repo/branch/head/override/merge_base（merge_base 缺省 ""= 不设范围，兼容旧调用）
      @output (D#|None, 来源, 诊断行列表)
      @降级   绝不因推断失败而放行 —— 失败一律返回 `(None, "none", diag)`，
              由调用方维持既有 fail-closed 拒绝路径。
    """
    diag: List[str] = []

    # ⓪ --did 显式覆盖（最高优先级）
    if override:
        d = parse_did(override)
        if d:
            diag.append(f"源 explicit: --did {override!r} → {d}（显式覆盖，优先级最高）")
            return d, "explicit", diag
        # 显式给了 --did 但不成 D# 形态 → **不静默改用别的来源**（否则 `--did D94` 这类
        # 笔误会悄悄落回分支/提交推断出的另一个 D#，把声明对到错的任务上）。
        # 归 fail-closed：调用方见 explicit-invalid 即 exit 2。
        diag.append(f"源 explicit: --did {override!r} 不含 D# 形态 → 显式覆盖无效")
        diag.append("显式指定了 --did 但值不合法 → fail-closed（拒绝静默改用其它来源的 D#）")
        return None, "explicit-invalid", diag
    diag.append("源 explicit: 未提供 --did")

    # ① 分支名
    d = parse_did(branch or "")
    if d:
        diag.append(f"源 branch: 分支名 {branch!r} → {d}")
        return d, "branch", diag
    diag.append(f"源 branch: 分支名 {branch!r} 不含 D#")

    # ② 提交 subject 回退（跳过自动登记影子提交 + 跳过合成 merge 提交；CT-C/D814）
    #   CT-C(c): HEAD 是合成 merge 提交时锚到第二父（PR 自身顶端），否则 --first-parent
    #   第一步就走 base（main）侧 → 只扫到 main 历史（D814 型错锚）。
    start = head
    try:
        meta = run_git(["log", "-1", "--format=%s%x00%P", head], repo)
        _subj, _, _parents = meta.partition("\x00")
        _subj = _subj.strip()
        _plist = _parents.split()
        if is_synthetic_merge_subject(_subj) and len(_plist) >= 2:
            start = f"{head}^2"
            diag.append(f"源 commit-subject: HEAD 是合成 merge 提交（主题 {_redact_hex(_subj)!r}）"
                        f"→ 锚到第二父 {start}（PR 自身顶端）后再扫，避免走进 base 历史")
    except GateError as exc:
        diag.append(f"源 commit-subject: 无法读取 HEAD 元信息（{exc}）→ 直接扫 {head}")

    #   CT-C(a)+(b): --first-parent 只沿第一父链（分支自身提交）；
    #   merge_base..start 把并入的 base 历史挡在扫描面外（两者互补：前者管"走哪条链"，
    #   后者管"链走到哪里为止"）。
    rev_spec = f"{merge_base}..{start}" if merge_base else start
    try:
        out = run_git(["log", "--first-parent", f"--max-count={FALLBACK_SCAN_DEPTH}",
                       "--format=%s", rev_spec], repo)
    except GateError as exc:
        diag.append(f"源 commit-subject: 无法读取提交历史（{exc}）→ 回退不可用")
        return None, "none", diag
    diag.append(f"源 commit-subject: 扫描范围 `git log --first-parent {rev_spec}`"
                f"（只沿第一父链 = 分支自身提交；base 侧历史不提供 D#）")
    scanned = skipped = synthetic = 0
    for subj in out.splitlines():
        subj = subj.strip()
        if not subj:
            continue
        if is_synthetic_merge_subject(subj):
            synthetic += 1
            continue
        if REGISTRATION_SUBJECT_RE.search(subj):
            skipped += 1
            continue
        scanned += 1
        d = parse_did(subj)
        if d:
            diag.append(f"源 commit-subject: 扫过 {scanned} 条非登记提交后命中 {_redact_hex(subj)!r} → {d}"
                        f"（已跳过 {skipped} 条自动登记影子提交 / {synthetic} 条合成 merge 提交）")
            return d, "commit-subject", diag
    diag.append(f"源 commit-subject: 最近 {FALLBACK_SCAN_DEPTH} 条内扫过 {scanned} 条非登记提交"
                f"（跳过 {skipped} 条登记影子提交 / {synthetic} 条合成 merge 提交），"
                f"均不含 D# → 回退空")
    diag.append("全部来源皆空 → D# 推断失败（fail-closed：维持既有拒绝路径，不静默放行）")
    return None, "none", diag


def infer_issue_identity(repo: str, branch: str, head: str,
                         override: str = "",
                         merge_base: str = "") -> Tuple[Optional[str], str, List[str], Optional[str]]:
    """推断 issue 身份并定位 `.claude/claims/<issue>.yaml`（K3 R5；**claim 优先**）。

    契约（铁律 47）:
      @input  repo/branch/head/override(`--issue`)/merge_base
      @output (issue|None, 来源, 诊断行, claim 路径|None)
      @降级   claim_store 不可用 → 返回 (None, "unavailable", diag, None)，
              **并在诊断里点名**（不静默退化到"无 issue"——那会让 S0 静默消失）
    顺序: `--issue` 显式 → 分支名 → 提交 subject（跳过合成 merge 与登记影子提交）。
    优先级规则（**K3 R3 防劫持**）: 只要本次身份能定位到 claim 文件，调用方即**不得**
      再走 D# 推断链——否则迁移期「分支名带旧 D# + 新 claim 并存」时新声明被旧锚点劫持。
    """
    diag: List[str] = []
    if not _CLAIM_STORE_OK:
        diag.append(f"源 claim_store: 不可用（{_CLAIM_STORE_ERR}）→ S0 声明源整体不可用")
        return None, "unavailable", diag, None

    def _finish(issue: str, src: str) -> Tuple[Optional[str], str, List[str], Optional[str]]:
        p = _claim_path(Path(repo), issue)
        if not p.is_file():
            diag.append(f"源 {src}: issue #{issue} 无 claim 文件（{p} 不存在）→ 回落 legacy D# 链")
            return None, "none", diag, None
        try:
            _load_claim(Path(repo), issue)  # 畸形即抛 ClaimError（不静默用半套声明）
        except _ClaimError as exc:
            diag.append(f"源 {src}: claim #{issue} 畸形（{exc}）→ fail-closed")
            return issue, "claim-invalid", diag, str(p)
        diag.append(f"源 {src}: claim #{issue} 存在（{p}）→ S0 声明源，**禁用 D# 锚点**（K3 R3）")
        return issue, src, diag, str(p)

    def _try(text: str, src: str) -> Optional[str]:
        try:
            return _parse_issue(text or "")
        except Exception as exc:  # claim_store 契约: 非法输入抛 ClaimError
            diag.append(f"源 {src}: {text!r} 提取异常（{exc}）")
            return None

    if override:
        iss = _try(override, "explicit")
        if iss:
            diag.append(f"源 explicit: --issue {override!r} → #{iss}")
            return _finish(iss, "explicit")

    iss = _try(branch or "", "branch")
    if iss:
        diag.append(f"源 branch: 分支名 {branch!r} → #{iss}")
        return _finish(iss, "branch")
    diag.append(f"源 branch: 分支名 {branch!r} 不含 issue 号")

    start = head
    try:
        meta = run_git(["log", "-1", "--format=%s%x00%P", head], repo)
        _subj, _, _parents = meta.partition("\x00")
        _subj = _subj.strip()
        _plist = _parents.split()
        if is_synthetic_merge_subject(_subj) and len(_plist) >= 2:
            start = f"{head}^2"
    except GateError as exc:
        diag.append(f"源 commit-subject: 无法读取 HEAD 元信息（{exc}）")
    rev_spec = f"{merge_base}..{start}" if merge_base else start
    try:
        out = run_git(["log", "--first-parent", f"--max-count={FALLBACK_SCAN_DEPTH}",
                       "--format=%s", rev_spec], repo)
    except GateError as exc:
        diag.append(f"源 commit-subject: 无法读取提交历史（{exc}）→ issue 推断不可用")
        return None, "none", diag, None
    for subj in out.splitlines():
        subj = subj.strip()
        if not subj or is_synthetic_merge_subject(subj) or REGISTRATION_SUBJECT_RE.search(subj):
            continue
        iss = _try(subj, "commit-subject")
        if iss:
            diag.append(f"源 commit-subject: 命中 {_redact_hex(subj)!r} → #{iss}")
            return _finish(iss, "commit-subject")
    diag.append("源 commit-subject: 最近提交内未出现 issue 形态（`#N`）")
    return None, "none", diag, None


def find_declaration_files(repo: str, did: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """按 S1/S2/S3 定位声明文件（task-state / dev doc / brief）。

    CT-A2: S2/S3 多命中 ⇒ 抛 `AmbiguousDeclaration`（fail-closed + 点名全部候选），
      **不再** `hits[-1]` 静默取末位。

    契约（铁律 47）:
      @input  repo: 仓库根；did: 已推断出的 D#（None = 只探 task-state 之外不用）
      @output (task-state 路径|None, dev doc 路径|None, brief 路径|None)
      @降级   单命中/零命中按原语义返回；**多命中 → 抛 AmbiguousDeclaration**
              （不返回半套声明源，避免"用半份声明判夹带"产生假阳性/假阴性）
    """
    ts = dd = bf = None
    if did:
        cand = Path(repo) / "task-state" / f"{did}.json"
        if cand.exists():
            ts = str(cand)
        impl = Path(repo) / "docs" / "plans" / "codex" / "implementation"
        if impl.is_dir():
            _pat = f"SYNOVA-IMPL-*{did}*.md"
            hits = sorted(impl.glob(_pat))
            if len(hits) > 1:
                raise AmbiguousDeclaration("S2 dev doc", _pat, [str(h) for h in hits])
            if hits:
                dd = str(hits[0])
    briefs = Path(repo) / ".claude" / "task-briefs"
    if briefs.is_dir():
        allb = sorted(briefs.glob("*.md"))
        if did:
            hits = [b for b in allb if did in b.name]
            if len(hits) > 1:
                raise AmbiguousDeclaration("S3 brief", f"*{did}*.md", [str(h) for h in hits])
            if hits:
                bf = str(hits[0])
    return ts, dd, bf


def _clean_entry(raw: str) -> str:
    """写集条目清洗: markdown 链接 / 反引号 / 计数括号 / 行号后缀 / 后置说明。"""
    s = raw.strip()
    m = re.match(r"^\[([^\]]+)\]\([^)]*\)$", s)          # [path](url)
    if m:
        s = m.group(1)
    s = s.strip("`").strip()
    s = re.sub(r"\s*[（(]\s*\d+\s*[^）)]*[）)]\s*$", "", s)   # (3 修改)
    s = re.sub(r"\s+L\d+\s*$", "", s)                        # path L750
    s = re.split(r"\s+[—–-]{1,2}\s+", s, 1)[0].strip()        # path — 说明
    s = s.strip("`").strip().rstrip("/")
    return s


def collect_declared(repo: str, ts: Optional[str], dd: Optional[str], bf: Optional[str],
                     claim: Optional[str] = None) -> Tuple[List[Tuple[str, str]], List[str]]:
    """返回 ([(条目, 来源)] , 告警列表)。源解析失败只记告警，不静默。

    D-C（K3 R5）: `claim` = `.claude/claims/<issue>.yaml`（S0 源）。走 `brief_parser`
    **同一实现**（其 claim 分支委托 claim_store 解析）——不新增第三套解析口径。
    claim 解析异常 → 追加告警并把该源置空，由调用方按"声明源为空"的既有 fail-closed 处理。
    """
    entries: List[Tuple[str, str]] = []
    warns: List[str] = []

    if claim:
        py = python_bin()
        bp = Path(repo) / "scripts" / "control-tower" / "brief_parser.py"
        try:
            p = subprocess.run([py, str(bp), "--q2-include", claim], capture_output=True,
                               text=True, encoding="utf-8", errors="replace", timeout=60)
            got = [ln for ln in (p.stdout or "").splitlines() if ln.strip()]
            # brief_parser 对畸形 claim 会返回空 + 非零 rc（claim_store exit 2 语义）；
            # rc≠0 且无输出 ⇒ 显式告警（绝不静默当"声明为空"）
            if p.returncode != 0 and not got:
                warns.append(f"S0 claim 解析失败({claim}): brief_parser rc={p.returncode}")
            for ln in got:
                entries.append((_clean_entry(ln), CLAIM_SOURCE_LABEL))
        except (OSError, subprocess.SubprocessError) as exc:
            warns.append(f"S0 claim 解析失败({claim}): {exc}")

    if ts:
        try:
            data = json.loads(Path(ts).read_text(encoding="utf-8", errors="replace"))
            ws = data.get("write_set")
            if isinstance(ws, list):
                for e in ws:
                    if str(e).strip():
                        entries.append((_clean_entry(str(e)), "S1:task-state.write_set"))
        except (OSError, ValueError) as exc:
            warns.append(f"S1 解析失败({ts}): {exc}")

    if dd:
        py = python_bin()
        helper = Path(repo) / "scripts" / "control-tower" / "devdoc_writeset.py"
        try:
            p = subprocess.run([py, str(helper), "--extract", dd], capture_output=True,
                               text=True, encoding="utf-8", errors="replace", timeout=60)
            j = json.loads(p.stdout or "{}")
            for e in (j.get("cleaned") or []):
                if str(e).strip():
                    entries.append((_clean_entry(str(e)), "S2:devdoc.写集表"))
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            warns.append(f"S2 解析失败({dd}): {exc}")

    if bf:
        py = python_bin()
        bp = Path(repo) / "scripts" / "control-tower" / "brief_parser.py"
        try:
            p = subprocess.run([py, str(bp), "--q2-include", bf], capture_output=True,
                               text=True, encoding="utf-8", errors="replace", timeout=60)
            for ln in (p.stdout or "").splitlines():
                if ln.strip():
                    entries.append((_clean_entry(ln), "S3:brief.Q2-include"))
        except (OSError, subprocess.SubprocessError) as exc:
            warns.append(f"S3 解析失败({bf}): {exc}")

    # 去重（保留首个来源）
    seen = set()
    uniq: List[Tuple[str, str]] = []
    for e, src in entries:
        if e and e not in seen:
            seen.add(e)
            uniq.append((e, src))
    return uniq, warns


EXEMPT_HEADING_RE = re.compile(r"^#{2,4}\s*写集豁免")


def scan_exempt_section(text: str, source: str) -> List[Tuple[str, str]]:
    """从任意文本里扫 `## 写集豁免` 段落: 每行 `- <路径> — <理由>`。无理由不生效。"""
    out: List[Tuple[str, str]] = []
    in_sec = False
    for line in (text or "").splitlines():
        if EXEMPT_HEADING_RE.match(line):
            in_sec = True
            continue
        if in_sec and re.match(r"^#{1,4}\s", line):
            break
        if in_sec and line.strip().startswith("- "):
            parts = re.split(r"\s+[—–-]{1,2}\s+", line.strip()[2:], 1)
            if len(parts) == 2 and parts[1].strip():
                reason = parts[1].strip() + ("（PR 正文声明）" if source == "pr-body" else "")
                out.append((_clean_entry(parts[0]), reason))
    return out


def collect_explicit_exempt(repo: str, ts: Optional[str], dd: Optional[str], bf: Optional[str]) -> List[Tuple[str, str]]:
    """声明文件里的 `## 写集豁免` 段落（多源取并）。"""
    out: List[Tuple[str, str]] = []
    for f in (ts, dd, bf):
        if not f:
            continue
        try:
            out.extend(scan_exempt_section(Path(f).read_text(encoding="utf-8", errors="replace"), "file"))
        except OSError:
            continue
    return out


def resolve_pr_body_text(arg_path: str) -> str:
    """PR 正文来源: ① 显式 --pr-body <file> ② CI 的 GITHUB_EVENT_PATH（pull_request 事件体）。

    D708 复核建议（非阻塞）: ci.yml 此前只传了 --branch，未接 --pr-body → PR 正文里的
    `## 写集豁免` 声明形同虚设。此处自取事件体，**无需改 ci.yml**，也让本地可注入测试。
    """
    if arg_path:
        try:
            return Path(arg_path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
    ev = os.environ.get("GITHUB_EVENT_PATH", "")
    if not ev or not os.path.exists(ev):
        return ""
    try:
        data = json.loads(Path(ev).read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return ""
    return ((data.get("pull_request") or {}).get("body") or "")


def matches(path: str, entry: str) -> bool:
    """声明条目匹配: 精确 / 目录前缀 / glob。"""
    if not entry:
        return False
    if path == entry:
        return True
    if path.startswith(entry + "/"):
        return True
    if any(c in entry for c in "*?["):
        return fnmatch.fnmatch(path, entry)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--branch", default="")
    ap.add_argument("--repo-root", default="")
    ap.add_argument("--pr-body", default="")
    ap.add_argument("--did", default="",
                    help="显式指定任务 D#（最高优先级，来源记为 explicit）；"
                         "缺省时按 分支名 → 提交 subject 回退推断")
    ap.add_argument("--issue", default="",
                    help="显式指定 issue 号（K3 R5；`#N` 或纯数字）。"
                         "存在 `.claude/claims/<issue>.yaml` 时优先于 D# 链（防双口径劫持）")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    repo = args.repo_root or str(Path(__file__).resolve().parents[2])
    branch = args.branch
    if not branch:
        try:
            branch = run_git(["rev-parse", "--abbrev-ref", "HEAD"], repo).strip()
        except GateError:
            branch = ""

    result = {"component": "merge-writeset-gate", "status": "pass", "branch": branch,
              "base": args.base, "head": args.head, "declared": [], "smuggled": [],
              "exempt": [], "warns": [], "reason": ""}

    # ── 豁免①: 自动分支 ──
    if SKIP_BRANCH_RE.match(branch or ""):
        result["status"] = "skip"
        result["reason"] = (f"分支 {branch} 命中分支级豁免（auto/** 自动分支无写集语义；"
                            f"main/master 为合并后 push，本 gate 的触发点在合并前）")
        _emit(result, args.json)
        return 0

    try:
        mb, files = changed_files(repo, args.base, args.head)
    except GateError as exc:
        result["status"] = "degraded"
        result["reason"] = f"无法判定: {exc}"
        _emit(result, args.json)
        _log_degraded(repo, result["reason"])
        return 2

    result["merge_base"] = mb
    result["changed_count"] = len(files)
    if not files:
        result["status"] = "pass"
        result["reason"] = "变更集为空"
        _emit(result, args.json)
        return 0

    # ── D-C（K3 R3/R5）: issue 身份 **优先于** D# 链 ──
    # 触发条件 = 本提交身份能定位到 `.claude/claims/<issue>.yaml`。一旦成立：
    #   · S0 声明源 = claim（同批接入写集对账，堵"`feat(#N)` 后对账锚点消失"）
    #   · **不再**走 D# 推断链（防迁移期旧 D# 锚点劫持新 claim，预审 §③ 定罪场景）
    # 不成立（无 claims 目录 / 无对应 claim）→ 逐字节 legacy D# 链（在途 D# 任务零回归）
    claim_path_found: Optional[str] = None
    issue, issue_src, issue_diag, claim_path_found = infer_issue_identity(
        repo, branch, args.head, args.issue, mb)
    result["issue"] = issue
    result["issue_source"] = issue_src
    result["issue_diag"] = issue_diag
    if issue_src == "claim-invalid":
        result["status"] = "degraded"
        result["reason"] = (f"claim #{issue} 畸形（{claim_path_found}）→ fail-closed"
                            f"（拒绝用半套声明对账；修好声明文件或走 legacy D# 链）")
        _emit(result, args.json)
        _log_degraded(repo, result["reason"])
        return 2

    if claim_path_found:
        did, did_src, did_diag = None, "claim", [
            f"claim #{issue} 生效 → S0 声明源；D# 推断链**未执行**（K3 R3 防劫持）"]
    else:
        # ── D# 推断: --did 显式覆盖 → 分支名 → 回退最近提交 scope（D954；CT-C 收口随机性）──
        did, did_src, did_diag = infer_did(repo, branch, args.head, args.did, mb)
    result["task_id"] = did
    result["task_id_source"] = did_src
    result["task_id_diag"] = did_diag
    if did_src == "explicit-invalid":
        result["status"] = "degraded"
        result["reason"] = (f"--did {args.did!r} 不含 D# 形态 → fail-closed"
                            f"（拒绝静默改用其它来源推断出的 D#：那会把声明对到错的任务上）")
        _emit(result, args.json)
        _log_degraded(repo, result["reason"])
        return 2

    try:
        ts, dd, bf = find_declaration_files(repo, did)
    except AmbiguousDeclaration as exc:
        # CT-A2: 多命中 → fail-closed（exit 2），候选逐条点名（不静默取一个）
        result["status"] = "degraded"
        result["reason"] = str(exc)
        result["ambiguous"] = {"kind": exc.kind, "pattern": exc.pattern,
                               "candidates": exc.candidates}
        _emit(result, args.json)
        _log_degraded(repo, result["reason"])
        return 2
    declared, warns = collect_declared(repo, ts, dd, bf, claim_path_found)
    result["warns"].extend(warns)
    result["sources"] = {"claim": claim_path_found, "task_state": ts,
                         "dev_doc": dd, "brief": bf}

    explicit = collect_explicit_exempt(repo, ts, dd, bf)
    pr_text = resolve_pr_body_text(args.pr_body)
    if pr_text:
        explicit.extend(scan_exempt_section(pr_text, "pr-body"))
    else:
        result["warns"].append("PR 正文不可用（--pr-body 未给且无 GITHUB_EVENT_PATH）—— 仅文件声明源生效")

    result["declared"] = [{"entry": e, "source": s} for e, s in declared]

    # ── 无声明: 文档范围降级放行；否则 fail-closed ──
    if not declared:
        non_doc = [f for f in files if not DOC_SCOPE_RE.search(f)]
        if non_doc:
            result["status"] = "degraded"
            result["reason"] = ("无任何写集声明（S0 claim.writeset / S1 task-state.write_set / "
                                "S2 dev doc 写集表 / S3 task brief Q2 四源皆空）"
                                "且变更含源码文件 → fail-closed 阻断")
            result["smuggled"] = non_doc
            _emit(result, args.json)
            _log_degraded(repo, result["reason"])
            return 2
        result["status"] = "skip"
        result["reason"] = "无写集声明，但变更全在文档/流程范围（docs|.claude|memory|task-state|*.md）→ 降级放行"
        _emit(result, args.json)
        _log_degraded(repo, result["reason"])
        return 0

    # ── 逐文件判定 ──
    smuggled: List[str] = []
    exempted: List[dict] = []
    # D-C: 自身声明文件的**仓库相对路径**（变更集是相对路径，绝对/相对直接比较永不相等）
    claim_rel = ""
    if claim_path_found:
        try:
            claim_rel = os.path.relpath(claim_path_found, repo).replace("\\", "/")
        except ValueError:  # 跨盘符（Windows）→ 无法转相对 → 退化为不豁免（保守）
            claim_rel = ""
    for f in files:
        if f in BUILTIN_EXEMPT:
            exempted.append({"file": f, "reason": BUILTIN_EXEMPT[f], "kind": "builtin"})
            continue
        # D-C: 本 PR **自身的声明文件**（`.claude/claims/<issue>.yaml`）视为运行期产物豁免。
        # 理由: 声明文件是"对账所需的输入"，不是本 PR 的交付内容 —— 若要求它写进自己的
        #   writeset，就成了循环依赖（先有声明才能声明）。豁免**只针对本 PR 解析到的那一个
        #   文件路径**（非目录级），与 BUILTIN_EXEMPT 的 .claude/bypass.log 同型且更紧。
        #   其他 claim（别人的声明）仍在管辖内 —— 改写他人声明必被拦。
        if claim_rel and f.replace("\\", "/") == claim_rel:
            exempted.append({"file": f, "kind": "claim-self",
                             "reason": "本 PR 自身的声明文件（对账输入，非交付物）"})
            continue
        hit = next(((e, s) for e, s in declared if matches(f, e)), None)
        if hit:
            continue
        ex = next(((p, r) for p, r in explicit if matches(f, p)), None)
        if ex:
            exempted.append({"file": f, "reason": ex[1], "kind": "declared"})
            continue
        smuggled.append(f)

    result["exempt"] = exempted
    result["smuggled"] = smuggled

    if smuggled:
        result["status"] = "block"
        result["reason"] = f"检测到 {len(smuggled)} 个写集外文件（夹带）"
        _emit(result, args.json)
        return 1

    result["status"] = "pass"
    result["reason"] = "提交文件集 ⊆ 声明写集（无夹带）"
    _emit(result, args.json)
    return 0


def _log_degraded(repo: str, reason: str) -> None:
    try:
        p = Path(repo) / ".codex" / "control-tower" / "logs" / "degraded-events.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        import datetime
        ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
        with p.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"time": ts, "component": "merge-writeset-gate",
                                 "reason": reason}, ensure_ascii=False) + "\n")
    except OSError:
        pass  # swallow-ok: 降级日志写入失败不改变 gate 判定（判定已在上游完成）


def _emit(result: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(result, ensure_ascii=False))
        return
    st = result["status"]
    icon = {"pass": "✅", "block": "❌", "skip": "⏭", "degraded": "⚠️"}.get(st, "?")
    print("── merge-writeset-gate (D708) 合并级写集对账 ──")
    print(f"{icon} 结论: {st} — {result.get('reason','')}")
    if result.get("task_id"):
        print(f"   任务: {result['task_id']} | 分支: {result.get('branch','')}")
    # D954: D# 推断来源必打印（--did 覆盖可见）；声明源为空时打印诊断
    #   —— 推断失败此前完全静默（K3 判 #741），此处让 fail-closed 可诊断。
    _src = result.get("task_id_source")
    if _src:
        print(f"   D# 推断来源: {_src} → {result.get('task_id') or '未推断出'}")
    _decl_empty = not any((result.get("sources") or {}).values())
    if result.get("task_id_diag") and (_src == "none" or _decl_empty):
        print("   D# 推断诊断（S1 task-state / S2 dev doc / S3 brief 声明源为空）:")
        for _line in result["task_id_diag"]:
            print(f"     · {_line}")
    if result.get("ambiguous"):
        _amb = result["ambiguous"]
        print(f"   ⚠️ 声明源多命中 → fail-closed（{_amb.get('kind','')}，匹配 {_amb.get('pattern','')}）")
        print(f"      候选 {len(_amb.get('candidates') or [])} 个（必须人工消歧，**不许静默取一个**）:")
        for _c in (_amb.get("candidates") or []):
            print(f"     - {_c}")
        print("      修复指引（二选一）: ① 只保留本任务那一个（重命名/删除另一个）"
              "② 用 `--did` 显式指定任务号，使候选收敛到唯一")
    if "changed_count" in result:
        print(f"   变更集: {result['changed_count']} 个文件（merge-base {str(result.get('merge_base',''))[:8]}）")
    if result.get("declared"):
        print(f"   声明写集 {len(result['declared'])} 条（多源并集）:")
        for d in result["declared"]:
            print(f"     · {d['entry']}   ← {d['source']}")
    else:
        print("   声明写集: （空）")
    if result.get("exempt"):
        print(f"   豁免 {len(result['exempt'])} 条（显式，逐条打印理由）:")
        for e in result["exempt"]:
            print(f"     · {e['file']}   ← [{e['kind']}] {e['reason']}")
    if result.get("smuggled"):
        print(f"   夹带文件 {len(result['smuggled'])} 个（不匹配任何声明项）:")
        for f in result["smuggled"]:
            print(f"     - {f}")
        print("   修复指引（三选一，禁止静默忽略）:")
        print("     ① 把该文件加入声明（S1 task-state write_set / S2 dev doc 写集表 / S3 brief Q2）")
        print("     ② 从本 PR 移出该文件（它可能属于另一个任务）")
        print("     ③ 显式豁免: 在 PR 正文/声明文件加 `## 写集豁免` 段落，每行 `- <路径> — <理由>`（无理由不生效）")
        print("     ⚠ 豁免/声明条目必须逐条**精确路径**（或 `<dir>/**` glob）——")
        print("        模糊描述（如「相关脚本」「治理文档若干」）不被匹配，直接判夹带。")
        print("     可直接粘贴的精确豁免行（补全理由后放入 PR 正文 `## 写集豁免`）:")
        for f in result["smuggled"]:
            print(f"       - {f} — <理由：为何此文件属于本任务>")
    for w in result.get("warns", []):
        print(f"   ⚠️  {w}")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except GateError as exc:  # 兜底: 未捕获的判定失败一律 fail-closed
        print(f"⚠️  merge-writeset-gate 无法判定: {exc}", file=sys.stderr)
        sys.exit(2)
