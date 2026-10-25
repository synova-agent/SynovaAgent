#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ═══════════════════════════════════════════════════════════════════════════════
# check-quality-delta.py — 质量增量闸（#912 批 1 · G1/G3/G4 ＋ #913 PR-3 · G5 · **只判变更集**）
#
# 设计哲学（一句）: **只判本次变更、存量一律不挡** —— 把「质量」从纸面标准变成
#   「改坏必红、改动之外 0 噪音」的最小执法闸；看不见（空集/坏输入）与看得见要分开说。
#
# 契约（铁律 47）:
#   @input   git 仓库（--root）＋ 变更集来源（三选一）:
#              --staged        `git diff --cached`（本地 pre-commit 用）
#              --base <ref>    `git diff <merge-base(base,HEAD)>...HEAD`（CI 用；默认取 $SYNO_DIFF_BASE）
#              皆未给 → base 解析链：$SYNO_DIFF_BASE → origin/local-main → local-main → HEAD~1
#            辅助件: docs/authority/WIRING-REGISTRY.yaml（G1）、docs/authority/quality-delta-whitelist.yaml（A3）
#            G5 专用（#913 PR-3 · 裁 405）:
#              --coverage-summary <path>  istanbul coverage-summary.json（默认 coverage/coverage-summary.json）
#              --coverage-sha <sha>       跑 coverage 时的 HEAD sha（新鲜度；武装时缺省/不符 ⇒ E_COVERAGE-STALE）
#              --baseline <path>          coverage 基线（默认 docs/authority/coverage-baseline.json）
#              --update-baseline          子命令式开关：把当次实测写入 baseline（只升不降；**唯一写路径**）
#              环境变量: SYNO_QD_G5（默认 1；=0 ⇒ G5 整组跳过 ＋ degraded: G5-DISABLED，rc 按 G1/G3/G4）
#                        SYNO_JSCPD_REPORT=<预生成 jscpd JSON>（**可测性注入缝**：设置时直接读它、跳过
#                          npx 探测/子进程；生产不设 ⇒ 仍走 `npx --yes jscpd@4.0.5`，见规则 R5.2）
#   @output  stdout 逐条 ✅/❌/⚠️（❌ 必带 path:line；⚠️ 只属 R5.2 advisory，不计违规）＋ 末行
#              `QUALITY-DELTA: PASS changes=<n> rules=G1,G3,G4,G5 base=<sha12>`
#              （**末行 rules 口径固定**：正常/未武装/不适用 都含 G5（组存在即使 N/A）；
#                仅 `SYNO_QD_G5=0` 时打 `rules=G1,G3,G4` ＋ stderr `degraded: G5-DISABLED`）
#              G5 未武装时**每次都打**一行 `ℹ️  G5 未武装（未传 --coverage-summary/--coverage-sha/--baseline）：不判覆盖率/重复率`
#              （禁静默：未武装≠通过，只是本组无判据对象）
#              ／ `QUALITY-DELTA: VIOLATIONS <n>`
#              ／ `QUALITY-DELTA: SKIP base=<sha12>`（无代码变更）
#              ／ `QUALITY-DELTA: BASELINE updated=<n> kept=<m> entries=<t>`（--update-baseline 模式）
#            --json 时 stdout 仅一份合法 JSON（人读行抑制）：含 g5:{checked,advisory,disabled}
#   @exit    **三态**（ctrl-tower-change 模式 1）:
#              0 = 通过；或**过滤后空代码变更 ⇒ SKIP**（A1：纯文档 PR 是常态，不是"看不见"）；
#                  G5 不适用/未武装/被禁用 亦是 0（R5.2 advisory 永不影响 rc）
#              1 = 有违规（G1/G3/G4；R5.1 行覆盖率；含白名单棘轮被抬）
#              2 = 检查自身失败（base 不可解析／git 不可用／registry 或白名单不可读／
#                  coverage 缺失或坏（E_COVERAGE）／coverage 与 HEAD 不符（E_COVERAGE-STALE）／
#                  baseline 坏（E_BASELINE）／参数非法）—— 同样阻断
#   @degraded 绝不静默：任何降级都打 stderr `degraded: <code> — <原因>` ＋（若设 `SYNO_GATE_DEGRADED_LOG`）
#            追加一行 JSON（time/component/code/phase/retryable；铁律 11/32）
#            · 阻断型（随 exit 2）: E_COVERAGE / E_COVERAGE-STALE / E_BASELINE
#            · 不阻断型（只跳过对应规则组）: E_JSCPD-MISSING（R5.2 跳过）／G5-DISABLED（G5 跳过）
#   @error   code ∈ {E_BAD_BASE, E_GIT, E_REGISTRY, E_WHITELIST, E_USAGE, E_INTERNAL,
#                    E_COVERAGE, E_COVERAGE-STALE, E_BASELINE, E_JSCPD-MISSING, G5-DISABLED}
#
# 规则（批 1 只做 G1/G3/G4；A2：**不做机器判散文**）
#   G1 可达（只对**新增**能力件）:
#     R1.1  WIRING-REGISTRY.yaml 必须有行，且 defined_at 路径 = 该文件
#     R1.2  该能力必须有 ≥1 个**非测试**生产调用点（grep 导出名，排除 tests/ 与自身文件）
#           登记行 status=declared-only ⇒ 不红（但计数打印，进 #910 的棘轮账）
#   G3 判据（只对变更集中的测试件）:
#     R3.1  必须有行为断言（expect(/assert/ok "/[ "$ …按扩展名取 token）
#     R3.3  禁 skip／空 expect／恒真断言（expect(true)、expect(1).toBe(1)、assert True）
#     R3.4  禁"对源码文本断言"（TS/JS：readFileSync+toContain 无其它行为断言）—— 白名单可豁免
#   G4 边界（只对变更集中的 src/routes/**、src/agent/** 的 .ts）:
#     R4.1  req.body.{orgId|teamId|tenantId} ⇒ 红（租户必须来自 req.auth）
#     R4.2  凭据/租户与 `|| ''`／`|| 'default'`／`?? ''` 同现 ⇒ 红（白名单文件可豁免）
#     R4.3  出站调用（fetch/http.request/axios）同文件无 AbortSignal.timeout|signal:|timeout: ⇒ 红
#     R4.4  响应体含 value|secret|token 且同文件无 configured|source: 脱敏 ⇒ 红
#   G5 覆盖率/重复率（#913 PR-3 · 裁 405；对象 = 变更集内 src/** 的 .ts）:
#     **武装条件（调用方声索制 · L1 追认）**: 传了 --coverage-summary 或 --coverage-sha 或 --baseline
#       （或 --update-baseline）才判；**未传 ⇒ G5 不判、exit 0，且 stdout 每次都打
#       `ℹ️  G5 未武装（未传 --coverage-summary/--coverage-sha/--baseline）：不判覆盖率/重复率`（不静默）**。
#       武装后**不放宽**：缺 coverage JSON/不可解析/缺该文件条目 ⇒ degraded: E_COVERAGE ＋ exit 2；
#       --coverage-sha 缺省/不符 ⇒ degraded: E_COVERAGE-STALE ＋ exit 2。
#       为什么不用"baseline 文件存在"当武装开关（如实）: 那样 seed 合并后**所有触及 src/** 的提交**
#       都会因既有调用点（pre-commit ①e / CI ①e）不传 --coverage-sha 而 exit 2（本批不新增接线）；
#       且既有 27 用例有 7 条 stage src/** 不传参，会整批翻红（与"零回归"判据冲突）。
#       接线（coverage 与闸同管线生成并传 --coverage-sha）不在本批。
#     R5.1（阻断）per-file 行覆盖率（coverage-summary 的 lines.pct；键归一化为 repo 相对路径）:
#       **A 档**（--diff-filter=A 新增）lines ≥ 30%（裁 415）；**M 档**（其余 ACMR）≥ baseline[path]；**无基线 ⇒ 以当次实测入册并通过**
#       缺条目／不可解析 ⇒ E_COVERAGE exit 2；新鲜度（--coverage-sha vs `git rev-parse HEAD`）不符或缺省
#       ⇒ E_COVERAGE-STALE exit 2。R5.1 豁免复用白名单（rule=R5.1）
#     R5.2（advisory，裁 405-①）重复率: 变更集内 src/** 文件，jscpd 重复 >5% ⇒
#       `⚠️ R5.2: <path> 重复 <x>% > 5%（advisory）`，**不计违规、不影响 rc**（进计数供 #910 棘轮观察）
#       per-file 重复率 = 该文件参与的 duplicates[].lines 之和 ÷ 文件总行数
#       （文件行数取 `git show :<path>` 的换行数，等价 `wc -l`）×100
#       jscpd 不可用 ⇒ degraded: E_JSCPD-MISSING ＋ R5.2 整组跳过（**R5.1 照常判**）
#   baseline 维护（只升不降）: 检查模式对 baseline **只读、零写入**；写只走 `--update-baseline`
#     （打印 `keep <path>=<pct>%` / `↑ R5.1 baseline: <path> <old>% → <new>%`，降向不生效）
#
# 白名单（A3 · 唯一豁免通道；**禁代码内注释豁免**）:
#   docs/authority/quality-delta-whitelist.yaml
#     schema_version: 1
#     ratchet: {max_entries: <N>}        # 只减不增：entries > max_entries ⇒ 违规（W-RATCHET）
#     entries: [{path, rule, reason, ruling}]   # ruling 形如 `裁 330`
#   匹配：path 支持 `*` 尾通配；rule 精确匹配（R4.2/…）。条目文件不可读 ⇒ exit 2（fail-closed）。
#
# 既有基础（禁重复建设）:
#   · 变更集口径与 #841 J15 同源（`git diff --name-only <mb>...HEAD`）
#   · 三态退出码/注入缝/UTF-8/判别力自检 = scripts/control-tower/AGENTS.md 四条既有约定
#   · 不做 YAML 依赖（同 claim_store.py：CI runner 无 PyYAML ⇒ 缺失会退化成"读不到声明"的静默路径）
#   · G5 复用本闸既有 DeltaError / degraded() / 白名单 / 变更集，**不新开闸、不新开 CI step**（裁 402）
#
# 已知限制（Known Limitations —— 禁读成"已检测"）:
#   1. **grep 看不见语义**：R1.2 按导出名 grep 判"生产调用点"，动态用法（字符串反射/依赖注入容器/
#      re-export 后再导入）会**漏判为红**；反向地，同名的无关符号会**假绿**。故批 1 只挡"新增能力件"。
#   2. **R3 只判文本形态**：行为断言的"真伪"机器判不了（A2 明确不做散文判定）；R3.1 只保"有断言形态"，
#      反例两态走 L1 复核清单（见 memory/notes/proposed/2026-10-24-912-quality-delta-A2-checklist.md）。
#   3. **R4 只扫变更文件内的字面模式**：跨文件的租户传递、封装在 helper 内的 `|| ''`、
#      非 fetch/axios 的出站（如 SDK、child_process）**不在本器视野**。
#   4. **JS/TS 语法级误报**：注释与字符串里的 `req.body.orgId` 也会命中（无 AST）；批 1 接受，
#      白名单只对 R4.2 开放，其余靠 L1 复核。
#   5. **空集语义**：过滤后空代码变更 = `exit 0 + SKIP`（A1）；**只有** base 坏/输入坏才 exit 2。
#   6. **不判存量**：P2（全量）与 P3（旧门禁处置）不在本批；本器对变更集之外的文件零输出。
#   7. **G5 武装靠调用方显式传参**（见上）：本批不新增接线 ⇒ 生产调用点未传参时 G5 dormant，
#      且**每次未武装都在 stdout 打显式 note（不静默）**、末行 rules 仍含 G5（组存在即使 N/A）；
#      这是**有意的过渡语义**（L1 追认项），不是"已检测"；接线（coverage 与闸同管线生成＋传 --coverage-sha）不在本批。
#   8. **R5.1 口径 = v8 provider 的 lines.pct**（单一口径防"挑指标"）；statements/functions/branches 不参与判。
#   9. **coverage 新鲜度是信任边界**：--coverage-sha 绑定的是"调用方声称的生成 sha"，闸无法证明 JSON
#      真由该 sha 生成（同管线 CI 场景可信；本地手工场景可传假 sha——记入限制，不掩盖）。
#   10. **R5.2 不阻断**（裁 405-① 的有意取舍）：重复率劣化只能靠 #910 棘轮账观察；jscpd 依赖网络/缓存
#       首次可用，离线环境 R5.2 恒跳过（degraded 有痕）。生产命令的 reporter 真名是 `json`
#       （规格 §13 写的 `jsonFull` 在 jscpd@4.0.5 **不存在**：只打 warning、rc=0、无产物——L1 实测；本器按真名实现）。
#   11. **jscpd 只扫变更文件**（不扫全仓）⇒ "变更文件 vs 存量文件"的重复只有在两边**都变更**时才可能被测到；
#       且 jscpd 默认参数（min-tokens 等）不在本器调优范围内。
#   11b. **jscpd@4.0.5 只在检出重复时写报告**（实测：单文件/无重复文件 rc=0 且无 jscpd-report.json）⇒
#       本器把 "rc=0 且无报告" 判为**本次未检出重复**（note 显式说明，不误报 E_JSCPD-MISSING）；
#       "不可用" 只指 npx 探测失败/子进程异常/rc≠0/报告不可解析 —— 这些才降级（E_JSCPD-MISSING，不阻断）。
#   12. **--update-baseline 也只处理变更集内的 src .ts**（存量条目不动）；写盘键 = repo 相对路径、2 空格缩进。
#   13. **src/** 的 .d.ts / 纯类型文件亦在 R5.1 视野内**（规格按 `src/**` + `.ts` 的字面口径，本器不自造豁免）；
#       若其 coverage 条目缺失 ⇒ E_COVERAGE（fail-closed，与规格一致）。
#   14. **--update-baseline 不强制 --coverage-sha**（它是显式写路径）；但若传了则同样校验（不符 ⇒ E_COVERAGE-STALE）。
# ═══════════════════════════════════════════════════════════════════════════════
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

COMPONENT = "check-quality-delta"
CODE_EXT = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh")
CODE_ROOTS = ("src/", "packages/", "scripts/", "tests/")  # tests/ 也是"代码"（G3 对象；G1 另有排除）
# 非代码面（文档/声明/证据）：过滤后为空 ⇒ SKIP（A1）
NON_CODE_PREFIX = (".claude/", "memory/", "docs/", "gate-exemptions/", "task-state/", ".handbook")
# G1 只对"新增能力件"生效；这些前缀是别的线的领域/生成物，不要求新登记（已知限制 1）
G1_EXCLUDE = (
    "tests/", "scripts/audit/", "scripts/control-tower/probe-",
    "scripts/control-tower/install-deps.sh", ".d.ts",
)

API_FILES = ("docs/authority/WIRING-REGISTRY.yaml",)
DEFAULT_WHITELIST = "docs/authority/quality-delta-whitelist.yaml"

# ── G5（#913 PR-3）：覆盖率＋重复率 ─────────────────────────────────────────
G5_SRC_PREFIX = "src/"
G5_SRC_EXT = ".ts"
DEFAULT_COVERAGE_SUMMARY = "coverage/coverage-summary.json"
DEFAULT_BASELINE = "docs/authority/coverage-baseline.json"
G5_A_MIN_PCT = 30.0          # A 档（新增）行覆盖率下限（裁 415：地板；全局 40% 平均闸兜底）
G5_M_FLOOR_PCT = 0.0         # 裁 415：M 档**不设统一下限**；有基线比基线，无基线以当次实测入册
G5_DUP_MAX_PCT = 5.0         # R5.2 advisory 阈值（> 才报）
G5_JSCPD_VERSION = "4.0.5"   # 固定版本（关卡 A 红线：不入 devDeps、不改 package.json）
G5_JSCPD_PROBE_TIMEOUT = 180
G5_JSCPD_RUN_TIMEOUT = 300


class DeltaError(Exception):
    """检查自身失败（→ exit 2，fail-closed）。"""

    def __init__(self, code: str, message: str, phase: str = "scan", retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.phase = phase
        self.retryable = retryable


# ── git ───────────────────────────────────────────────────────────────────────
def git(root: str, *args: str) -> str:
    p = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise DeltaError("E_GIT", f"git {' '.join(args)} 失败: {(p.stderr or '').strip()[:200]}")
    return p.stdout


def resolve_base(root: str) -> str:
    cands = [os.environ.get("SYNO_DIFF_BASE", ""), "origin/local-main", "local-main", "HEAD~1"]
    for c in cands:
        c = (c or "").strip()
        if not c:
            continue
        p = subprocess.run(["git", "-C", root, "rev-parse", "--verify", "-q", f"{c}^{{commit}}"],
                           capture_output=True, text=True)
        if p.returncode == 0:
            return c
    raise DeltaError("E_BAD_BASE", "base 解析链全不可解析（$SYNO_DIFF_BASE/origin/local-main/local-main/HEAD~1）")


def change_set(root: str, base: Optional[str], staged: bool) -> Tuple[List[str], List[str], str]:
    """→ (changed, added, base_sha)；staged=True 走暂存区。"""
    if staged:
        changed = git(root, "diff", "--cached", "--name-only", "--diff-filter=ACMR").split()
        added = git(root, "diff", "--cached", "--name-only", "--diff-filter=A").split()
        head = git(root, "rev-parse", "--short=12", "HEAD").strip()
        return changed, added, f"staged@{head}"
    assert base is not None
    try:
        mb = git(root, "merge-base", base, "HEAD").strip()
    except DeltaError as exc:
        raise DeltaError("E_BAD_BASE", f"base={base} 无法与 HEAD 求 merge-base: {exc}") from exc
    if not mb:
        raise DeltaError("E_BAD_BASE", f"base={base} merge-base 为空")
    changed = git(root, "diff", "--name-only", "--diff-filter=ACMR", f"{mb}...HEAD").split()
    added = git(root, "diff", "--name-only", "--diff-filter=A", f"{mb}...HEAD").split()
    return changed, added, mb[:12]


def is_test_file(path: str) -> bool:
    """G3 对象 = 真正的测试件（不是 tests/ 下的所有文件：AGENTS.md/README 不是测试）。"""
    base = path.rsplit("/", 1)[-1]
    return (".test." in base and base.endswith(CODE_EXT)) or base.startswith("test_") or base.endswith("_test.py")


def is_code(path: str) -> bool:
    if not path.startswith(CODE_ROOTS) or not path.endswith(CODE_EXT):
        return False
    return not path.startswith(NON_CODE_PREFIX)


# ── YAML 子集（故意不引 PyYAML；同 claim_store.py 的理由）───────────────────
def _scalar(raw: str) -> str:
    v = raw.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v in ("", "null", "~"):
        return ""
    return v


def parse_registry(text: str) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    cur: Optional[Dict[str, str]] = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if re.match(r"^entries:\s*$", line):
            continue
        m = re.match(r"^\s*-\s+(capability|defined_at|provider|consumer|test|status|owner|notes)\s*:\s*(.*)$", line)
        if m:
            key, val = m.group(1), _scalar(m.group(2))
            if key == "capability":
                cur = {"capability": val}
                rows.append(cur)
            elif cur is not None:
                cur[key] = val
            continue
        m2 = re.match(r"^\s+(defined_at|provider|consumer|test|status|owner|notes)\s*:\s*(.*)$", line)
        if m2 and cur is not None:
            cur[m2.group(1)] = _scalar(m2.group(2))
    return [r for r in rows if r.get("capability")]


def parse_whitelist(text: str) -> Tuple[int, List[Dict[str, str]]]:
    max_entries = 0
    entries: List[Dict[str, str]] = []
    cur: Optional[Dict[str, str]] = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^\s*max_entries\s*:\s*(\d+)\s*$", line)
        if m:
            max_entries = int(m.group(1))
            continue
        m = re.match(r"^\s*-\s+(path|rule|reason|ruling)\s*:\s*(.*)$", line)
        if m:
            if m.group(1) == "path":
                cur = {"path": _scalar(m.group(2))}
                entries.append(cur)
            elif cur is not None:
                cur[m.group(1)] = _scalar(m.group(2))
    return max_entries, entries


def whitelisted(entries: List[Dict[str, str]], path: str, rule: str) -> bool:
    for e in entries:
        p = e.get("path", "")
        if not p:
            continue
        hit = path == p if not p.endswith("*") else path.startswith(p[:-1])
        if hit and e.get("rule", "") == rule:
            return True
    return False


# ── 规则 ───────────────────────────────────────────────────────────────────────
def exported_names(root: str, path: str) -> List[str]:
    try:
        text = (Path(root) / path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    names: List[str] = []
    for m in re.finditer(r"^export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)", text, re.M):
        names.append(m.group(1))
    for m in re.finditer(r"^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(", text, re.M):
        names.append(m.group(1))
    if not names and path.endswith(".sh"):
        names.append(Path(path).stem)
    return sorted(set(names))


def capability_tokens(root: str, path: str) -> List[str]:
    """G1 的"能力名"取法：**门禁/脚本件按文件名为能力**，源码件按导出名。

    为什么分开：`scripts/control-tower/*.py` 的"接线"事实是"被 pre-commit/CI 调用"（文件名即能力），
    而 `src/**` 的接线事实是"导出符号被生产侧引用"。混用会要么漏判要么假绿（Known Limitations 1）。
    """
    if path.startswith("scripts/"):
        return [Path(path).name]
    return exported_names(root, path)


def has_prod_call(root: str, path: str, names: List[str]) -> bool:
    if not names:
        return False
    files = git(root, "ls-files", "src", "packages", "scripts").splitlines()
    pat = re.compile(r"\b(" + "|".join(re.escape(n) for n in names) + r")\b")
    for f in files:
        if f == path or f.startswith("tests/") or ".test." in f or not f.endswith(CODE_EXT):
            continue
        try:
            text = (Path(root) / f).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        hit = any(n in text for n in names) if path.startswith("scripts/") else bool(pat.search(text))
        if hit:
            return True
    return False


G3_ASSERT = {
    ".ts": ("expect(", "assert.", "assertEqual"),
    ".tsx": ("expect(", "assert.", "assertEqual"),
    ".js": ("expect(", "assert.", "assertEqual"),
    ".mjs": ("expect(", "assert.", "assertEqual"),
    ".cjs": ("expect(", "assert.", "assertEqual"),
    ".py": ("assert", "self.assert"),
    ".sh": ('ok "', "no \"", "assert_", '[ "$', "[ -", "assert_rc"),
}
G3_SKIP = [
    (re.compile(r"\b(?:it|test|describe)\.skip\s*\("), "it/test/describe.skip"),
    (re.compile(r"\b(?:xit|xdescribe)\s*\("), "xit/xdescribe"),
    (re.compile(r"expect\(\s*\)"), "空 expect()"),
    (re.compile(r"expect\(\s*(?:true|false)\s*\)"), "恒真断言 expect(true/false)"),
    (re.compile(r"expect\(\s*(\d+)\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*\1\s*\)"), "恒真断言 expect(N).toBe(N)"),
    (re.compile(r"^\s*assert\s+True\s*$", re.M), "恒真断言 assert True"),
    (re.compile(r"(?://|#)\s*TODO:\s*assert", re.I), "TODO: assert 占位"),
]


def line_of(text: str, idx: int) -> int:
    return text.count("\n", 0, idx) + 1


def scan_g3(root: str, path: str, wl: List[Dict[str, str]]) -> List[Tuple[str, str, int, str]]:
    out: List[Tuple[str, str, int, str]] = []
    try:
        text = (Path(root) / path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        raise DeltaError("E_GIT", f"测试件不可读: {path}")
    ext = Path(path).suffix
    toks = G3_ASSERT.get(ext, ())
    if toks and not any(t in text for t in toks):
        out.append(("R3.1", path, 1, "缺行为断言（无 " + "/".join(toks) + "）"))
    for rx, label in G3_SKIP:
        for m in rx.finditer(text):
            out.append(("R3.3", path, line_of(text, m.start()), f"{label} —— 判据空壳")); break
    if ext in (".ts", ".tsx", ".js", ".mjs", ".cjs") and not whitelisted(wl, path, "R3.4"):
        has_read = re.search(r"readFileSync\s*\(|fileURLToPath|read_text\s*\(", text)
        if has_read:
            for m in re.finditer(r"\.toContain\s*\(", text):
                ln = line_of(text, m.start())
                win = "\n".join(text.splitlines()[max(0, ln - 3):ln + 1])
                if re.search(r"readFileSync|read_text|fileURLToPath", win):
                    others = len(re.findall(r"expect\s*\([^)]", text))
                    if others <= 1:
                        out.append(("R3.4", path, ln, "对源码文本断言（readFileSync+.toContain 且无其它行为断言）"))
                        break
    return out


def scan_g4(root: str, path: str, wl: List[Dict[str, str]]) -> List[Tuple[str, str, int, str]]:
    out: List[Tuple[str, str, int, str]] = []
    try:
        text = (Path(root) / path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        raise DeltaError("E_GIT", f"路由件不可读: {path}")
    lines = text.splitlines()
    for i, line in enumerate(lines, start=1):
        if re.search(r"req\.body\.(orgId|teamId|tenantId)\b", line):
            out.append(("R4.1", path, i, "租户来自 req.body（必须 req.auth）"))
        if re.search(r"(?i)(secret|token|apiKey|orgId|tenantId)", line) and re.search(r"\|\|\s*''|\?\?\s*''|\|\|\s*'default'", line):
            if not whitelisted(wl, path, "R4.2"):
                out.append(("R4.2", path, i, "凭据/租户缺省放开（|| '' / || 'default'）"))
    if re.search(r"\b(fetch|axios)\s*\(|http\.request\s*\(", text):
        if not re.search(r"AbortSignal\.timeout|signal\s*:|timeout\s*:", text):
            out.append(("R4.3", path, 1, "出站调用无超时/取消（AbortSignal.timeout|signal|timeout）"))
    if re.search(r"res\.json\s*\(|res\.send\s*\(|reply\.send\s*\(", text):
        if re.search(r"(?m)^\s*(value|secret|token)\s*:", text) and not re.search(r"configured|source\s*:", text):
            out.append(("R4.4", path, 1, "凭据读面返回明文（无 configured/source 脱敏）"))
    return out


def scan_g1(root: str, added: List[str], registry: List[Dict[str, str]]) -> Tuple[List[Tuple[str, str, int, str]], int]:
    out: List[Tuple[str, str, int, str]] = []
    declared_only = 0
    for path in added:
        if not is_code(path) or any(path.endswith(x) or path.startswith(x) for x in G1_EXCLUDE):
            continue
        if path.startswith("scripts/control-tower/") and path.endswith(".py") and not re.match(
                r"^scripts/control-tower/(check|probe|quality|merge|brief|resolve|claim)", path):
            # 仍按能力件处理（不额外放宽；宽度由 R1.2 的"生产调用点"约束）
            pass
        row = next((r for r in registry if r.get("defined_at", "").split(":")[0] == path), None)
        declared = False
        if row is None:
            out.append(("R1.1", path, 1, "新增能力件未在 WIRING-REGISTRY.yaml 登记（defined_at）"))
        elif row.get("status") == "declared-only":
            declared = True
            declared_only += 1
        if declared:
            # A3/提案 §2：declared-only 是**显式豁免**（不红），计入棘轮；不要求生产调用点
            continue
        names = capability_tokens(root, path)
        if not has_prod_call(root, path, names):
            out.append(("R1.2", path, 1, "无生产调用点（仅 tests/ 或无人引用）"
                                             + ("" if names else "；且未识别到导出名")))
    return out, declared_only


# ── G5：覆盖率＋重复率（#913 PR-3）──────────────────────────────────────────
def g5_src_files(changed: List[str], added: List[str]) -> Tuple[List[str], List[str]]:
    """→ (变更集内存在的 src/** .ts, 其中的 A 档=新增)。"""
    added_set = set(added)
    src = sorted({p for p in changed if p.startswith(G5_SRC_PREFIX) and p.endswith(G5_SRC_EXT)})
    return src, [p for p in src if p in added_set]


def _norm_repo_path(root: str, raw: str) -> str:
    """把 coverage/baseline/jscpd 里的路径键归一化为 repo 相对路径（正斜杠）。"""
    p = (raw or "").strip().replace("\\", "/")
    if not p:
        return ""
    if os.path.isabs(p):
        root_abs = os.path.abspath(root)
        try:
            rel = os.path.relpath(p, root_abs).replace("\\", "/")
        except (OSError, ValueError):
            return p
        if rel and not rel.startswith("../"):
            p = rel
    while p.startswith("./"):
        p = p[2:]
    return p


def _lookup_pct(table: Dict[str, float], path: str) -> Optional[float]:
    """先精确匹配；再后缀匹配（覆盖"coverage 键是别的根下的绝对路径"这一现实情况）。"""
    if path in table:
        return table[path]
    suffix = "/" + path
    for k, v in table.items():
        if k.endswith(suffix):
            return v
    return None


def load_coverage_summary(root: str, path: str) -> Dict[str, float]:
    fp = Path(path) if os.path.isabs(path) else (Path(root) / path)
    try:
        raw = fp.read_text(encoding="utf-8")
    except OSError as exc:
        raise DeltaError("E_COVERAGE", f"coverage JSON 不可读 {path}: {exc}") from exc
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise DeltaError("E_COVERAGE", f"coverage JSON 不可解析 {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise DeltaError("E_COVERAGE", f"coverage JSON 顶层不是对象: {path}")
    out: Dict[str, float] = {}
    for key, item in data.items():
        if key == "total":
            continue
        if not isinstance(item, dict):
            continue
        lines = item.get("lines")
        if not isinstance(lines, dict) or "pct" not in lines:
            continue
        try:
            pct = float(lines["pct"])
        except (TypeError, ValueError) as exc:
            raise DeltaError("E_COVERAGE", f"coverage JSON lines.pct 非数字（{key}）: {lines['pct']!r}") from exc
        if not (0.0 <= pct <= 100.0):
            raise DeltaError("E_COVERAGE", f"coverage JSON lines.pct 越界（{key}）: {pct}")
        rel = _norm_repo_path(root, key)
        if rel:
            out[rel] = pct
    if not out:
        raise DeltaError("E_COVERAGE", f"coverage JSON 无有效 per-file 条目: {path}（只有 total 或全被跳过）")
    return out


def load_baseline(root: str, path: str, explicit: bool) -> Dict[str, float]:
    fp = Path(path) if os.path.isabs(path) else (Path(root) / path)
    if not fp.exists():
        if explicit:
            raise DeltaError("E_BASELINE", f"baseline 文件不存在 {path}（显式指定 ⇒ fail-closed）")
        return {}
    try:
        data = json.loads(fp.read_text(encoding="utf-8"))
    except OSError as exc:
        raise DeltaError("E_BASELINE", f"baseline 不可读 {path}: {exc}") from exc
    except ValueError as exc:
        raise DeltaError("E_BASELINE", f"baseline 不可解析 {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise DeltaError("E_BASELINE", f"baseline 顶层不是对象: {path}")
    if data.get("schema_version") != 1:
        raise DeltaError("E_BASELINE", f"baseline schema_version 必须为 1（实际 {data.get('schema_version')!r}）")
    entries = data.get("entries", {})
    if not isinstance(entries, dict):
        raise DeltaError("E_BASELINE", f"baseline entries 必须是对象: {path}")
    out: Dict[str, float] = {}
    for k, v in entries.items():
        try:
            pct = float(v)
        except (TypeError, ValueError) as exc:
            raise DeltaError("E_BASELINE", f"baseline entries[{k!r}] 非数字: {v!r}") from exc
        if not (0.0 <= pct <= 100.0):
            raise DeltaError("E_BASELINE", f"baseline entries[{k!r}] 越界（0–100）: {pct}")
        rel = _norm_repo_path(root, str(k))
        if rel:
            out[rel] = pct
    return out


def check_coverage_freshness(root: str, sha_arg: Optional[str]) -> str:
    """新鲜度 fail-closed：缺省/不符 ⇒ E_COVERAGE-STALE（→ exit 2）。"""
    head = git(root, "rev-parse", "HEAD").strip().lower()
    if not sha_arg or not sha_arg.strip():
        raise DeltaError("E_COVERAGE-STALE",
                         "缺 --coverage-sha（变更集含 src/** ⇒ fail-closed：无法证明 coverage 产物与 HEAD 同源）")
    s = sha_arg.strip().lower()
    if len(s) < 7 or not (head.startswith(s) or s.startswith(head)):
        raise DeltaError("E_COVERAGE-STALE", f"--coverage-sha {s[:12]} 与 git rev-parse HEAD {head[:12]} 不符")
    return head


def scan_g5_coverage(root: str, src: List[str], added: List[str], cov: Dict[str, float],
                     baseline: Dict[str, float], wl: List[Dict[str, str]]
                     ) -> Tuple[List[Tuple[str, str, int, str]], int, int, int]:
    """R5.1（阻断）＋ R5.1 白名单豁免。→ (violations, a_n, m_n, whitelisted_n)"""
    out: List[Tuple[str, str, int, str]] = []
    added_set = set(added)
    a_n = m_n = wl_n = 0
    for path in src:
        if whitelisted(wl, path, "R5.1"):
            wl_n += 1
            continue
        pct = _lookup_pct(cov, path)
        if pct is None:
            raise DeltaError("E_COVERAGE", f"coverage JSON 缺该文件条目: {path}（应有 lines.pct）")
        if path in added_set:
            a_n += 1
            thr = G5_A_MIN_PCT
            label = f"A 档新增（阈值 {G5_A_MIN_PCT:.0f}%）"
        else:
            m_n += 1
            base = _lookup_pct(baseline, path)
            if base is None:
                # 裁 415：老文件首次被改到 ⇒ 以**当次实测**入册（不设 30% 地板，避免背历史债）
                baseline[path] = pct
                continue
            thr = base
            label = "M 档修改（≥ baseline %.2f%%）" % base
        if pct + 1e-9 < thr:
            out.append(("R5.1", path, 1, f"行覆盖率 {pct:.2f}% < {thr:.2f}%（{label}）"))
    return out, a_n, m_n, wl_n


def _jscpd_degrade(msg: str) -> None:
    degraded("E_JSCPD-MISSING", msg + " ⇒ R5.2 整组跳过（不阻断）")


def jscpd_report(root: str, files: List[str]) -> Optional[dict]:
    """→ jscpd 报告 dict；不可用/不可读 → None（已 degraded，不阻断）。"""
    env_path = os.environ.get("SYNO_JSCPD_REPORT", "").strip()
    if env_path:
        # 可测性注入缝：直接读预生成报告，跳过 npx 探测/子进程（生产不设 ⇒ 行为不变）
        try:
            raw = Path(env_path).read_text(encoding="utf-8")
        except OSError as exc:
            _jscpd_degrade(f"SYNO_JSCPD_REPORT 不可读 {env_path}: {exc}")
            return None
        try:
            data = json.loads(raw)
        except ValueError as exc:
            _jscpd_degrade(f"SYNO_JSCPD_REPORT 不可解析 {env_path}: {exc}")
            return None
        if not isinstance(data, dict):
            _jscpd_degrade(f"SYNO_JSCPD_REPORT 顶层不是对象 {env_path}")
            return None
        return data
    if not files:
        return None
    npx = shutil.which("npx")
    if not npx:
        _jscpd_degrade("PATH 中无 npx")
        return None
    base_cmd = [npx, "--yes", f"jscpd@{G5_JSCPD_VERSION}"]
    try:
        probe = subprocess.run(base_cmd + ["--version"], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=G5_JSCPD_PROBE_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as exc:
        _jscpd_degrade(f"npx jscpd@{G5_JSCPD_VERSION} --version 探测失败: {type(exc).__name__}: {exc}")
        return None
    if probe.returncode != 0 or G5_JSCPD_VERSION not in ((probe.stdout or "") + (probe.stderr or "")):
        _jscpd_degrade(f"npx jscpd@{G5_JSCPD_VERSION} --version rc={probe.returncode}"
                       f" out={(probe.stdout or '').strip()[:80]!r}")
        return None
    out_dir = tempfile.mkdtemp(prefix="synova-jscpd-")
    try:
        cmd = base_cmd + ["--reporters", "json", "--output", out_dir, "--silent", *files]
        try:
            run = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                                 errors="replace", cwd=root, timeout=G5_JSCPD_RUN_TIMEOUT)
        except (OSError, subprocess.SubprocessError) as exc:
            _jscpd_degrade(f"jscpd 运行失败: {type(exc).__name__}: {exc}")
            return None
        rp = Path(out_dir) / "jscpd-report.json"
        if run.returncode != 0:
            _jscpd_degrade(f"jscpd rc={run.returncode}（stdout 前 80: {(run.stdout or '').strip()[:80]!r}）")
            return None
        if not rp.exists():
            # jscpd@4.0.5 **只在检出重复时写报告**（实测：单个/无重复文件 rc=0 且无产物）
            # ⇒ rc=0 无报告 = 本次未检出重复（不是"不可用"）。留 _no_report 标记供 note 显式说明。
            return {"duplicates": [], "_no_report": True}
        try:
            data = json.loads(rp.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            _jscpd_degrade(f"jscpd 报告不可读/不可解析: {exc}")
            return None
        return data if isinstance(data, dict) else None
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


def _git_file_line_count(root: str, path: str) -> int:
    """文件行数 = `git show :<path>` 的换行数（等价 `wc -l`）；回退读工作树。"""
    try:
        return git(root, "show", f":{path}").count("\n")
    except DeltaError:
        try:
            return (Path(root) / path).read_text(encoding="utf-8", errors="replace").count("\n")
        except OSError:
            return 0


def _match_target(name: str, targets: List[str]) -> Optional[str]:
    if not name:
        return None
    if name in targets:
        return name
    for t in targets:
        if name.endswith("/" + t) or t.endswith("/" + name):
            return t
    return None


def scan_g5_duplication(root: str, src: List[str]) -> Tuple[List[str], int, str]:
    """R5.2（advisory，不阻断）→ (⚠️ 行列表, 超阈文件数, 说明行)。"""
    report = jscpd_report(root, src)
    if report is None:
        return [], 0, "G5 重复率: R5.2 跳过（jscpd 不可用，已 degraded: E_JSCPD-MISSING）"
    dups = report.get("duplicates")
    if not isinstance(dups, list):
        _jscpd_degrade("jscpd 报告缺 duplicates[]")
        return [], 0, "G5 重复率: R5.2 跳过（jscpd 报告形状不符，已 degraded: E_JSCPD-MISSING）"
    per: Dict[str, int] = {}
    for d in dups:
        if not isinstance(d, dict):
            continue
        try:
            n = int(d.get("lines") or 0)
        except (TypeError, ValueError):
            n = 0
        if n <= 0:
            continue
        for side in ("firstFile", "secondFile"):
            f = d.get(side)
            if not isinstance(f, dict):
                continue
            rel = _norm_repo_path(root, str(f.get("name") or ""))
            hit = _match_target(rel, src)
            if hit:
                per[hit] = per.get(hit, 0) + n
    advisories: List[str] = []
    for path in src:
        n = per.get(path, 0)
        if n <= 0:
            continue
        total = _git_file_line_count(root, path)
        ratio = (n * 100.0 / total) if total > 0 else 0.0
        if ratio > G5_DUP_MAX_PCT + 1e-9:
            advisories.append(f"⚠️ R5.2: {path} 重复 {ratio:.2f}% > {G5_DUP_MAX_PCT:.0f}%（advisory）")
    note = f"G5 重复率: R5.2 advisory 超阈 {len(advisories)} 个文件（> {G5_DUP_MAX_PCT:.0f}%，不阻断、不计违规）"
    if report.get("_no_report"):
        note += "；jscpd rc=0 且未产出报告 ⇒ 本次未检出重复（非降级）"
    return advisories, len(advisories), note


def g5_armed(args: argparse.Namespace) -> bool:
    """武装条件 = 调用方**显式声索** G5（见头部契约"武装条件"与 Known Limitations 7）。"""
    return bool(args.coverage_summary or args.coverage_sha or args.baseline)


def run_update_baseline(root: str, changed: List[str], added: List[str],
                        args: argparse.Namespace) -> int:
    """--update-baseline（唯一写路径）：当次实测写入 baseline，只升不降。"""
    if os.environ.get("SYNO_QD_G5", "1").strip() == "0":
        degraded("G5-DISABLED", "SYNO_QD_G5=0 ⇒ --update-baseline 跳过（回滚开关，非静默）")
        print("QUALITY-DELTA: BASELINE skipped disabled=1")
        return 0
    src, _ = g5_src_files(changed, added)
    bpath = args.baseline or DEFAULT_BASELINE
    baseline = load_baseline(root, bpath, explicit=bool(args.baseline))
    if not src:
        print(f"ℹ️  G5 基线: 变更集无 src/** .ts ⇒ 无对象（baseline 条目 {len(baseline)}）")
        print(f"QUALITY-DELTA: BASELINE updated=0 kept=0 entries={len(baseline)}")
        return 0
    cov = load_coverage_summary(root, args.coverage_summary or DEFAULT_COVERAGE_SUMMARY)
    if args.coverage_sha:
        check_coverage_freshness(root, args.coverage_sha)
    entries = dict(baseline)
    raised = added_n = kept = 0
    for path in src:
        pct = _lookup_pct(cov, path)
        if pct is None:
            raise DeltaError("E_COVERAGE", f"coverage JSON 缺该文件条目: {path}（应有 lines.pct）")
        old = _lookup_pct(baseline, path)
        if old is None:
            entries[path] = pct
            added_n += 1
            print(f"+ R5.1 baseline: {path} {pct:.2f}%（新增条目）")
        elif pct > old + 1e-9:
            entries[path] = pct
            raised += 1
            print(f"↑ R5.1 baseline: {path} {old:.2f}% → {pct:.2f}%")
        else:
            kept += 1
            print(f"keep {path}={old:.2f}%")
    if raised + added_n == 0:
        print(f"ℹ️  G5 基线未变（只升不降：降向不生效、零写入）")
    else:
        fp = Path(bpath) if os.path.isabs(bpath) else (Path(root) / bpath)
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(json.dumps({"schema_version": 1, "entries": dict(sorted(entries.items()))},
                                 ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"ℹ️  G5 基线已写入 {bpath}（只升不降：raised={raised} added={added_n} kept={kept}）")
    print(f"QUALITY-DELTA: BASELINE updated={raised + added_n} kept={kept} entries={len(entries)}")
    return 0


# ── 主流程 ───────────────────────────────────────────────────────────────────
def degraded(code: str, msg: str) -> None:
    sys.stderr.write(f"degraded: {code} — {msg}\n")
    logp = os.environ.get("SYNO_GATE_DEGRADED_LOG", "").strip()
    if logp:
        try:
            rec = {"time": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds"),
                   "component": COMPONENT, "code": code, "phase": "scan", "retryable": False,
                   "message": msg[:300]}
            Path(logp).parent.mkdir(parents=True, exist_ok=True)
            with open(logp, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except OSError:
            pass


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="质量增量闸（G1/G3/G4/G5 · 只判变更集）")
    ap.add_argument("--root", default=None, help="仓库根（默认 git toplevel）")
    ap.add_argument("--base", default=None, help="base ref（默认 $SYNO_DIFF_BASE → origin/local-main → local-main → HEAD~1）")
    ap.add_argument("--staged", action="store_true", help="用暂存区作为变更集（本地 pre-commit）")
    ap.add_argument("--registry", default=None, help=f"接线登记表（默认 {API_FILES[0]}）")
    ap.add_argument("--whitelist", default=None, help=f"白名单（默认 {DEFAULT_WHITELIST}）")
    ap.add_argument("--coverage-summary", default=None,
                    help=f"coverage-summary JSON（默认 {DEFAULT_COVERAGE_SUMMARY}；显式传参即武装 G5）")
    ap.add_argument("--coverage-sha", default=None,
                    help="跑 coverage 时的 HEAD sha（新鲜度；武装 G5 后缺省/不符 ⇒ E_COVERAGE-STALE exit 2）")
    ap.add_argument("--baseline", default=None,
                    help=f"G5 覆盖率基线（默认 {DEFAULT_BASELINE}；显式传参即武装 G5）")
    ap.add_argument("--update-baseline", action="store_true",
                    help="把当次实测写入 baseline（只升不降；唯一写路径）")
    ap.add_argument("--json", action="store_true", help="stdout 仅输出 JSON")
    try:
        args = ap.parse_args(argv)
    except SystemExit:
        degraded("E_USAGE", "参数解析失败")
        return 2

    root = args.root or subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True,
                                        text=True).stdout.strip()
    if not root or not Path(root).is_dir():
        degraded("E_USAGE", f"--root 无效: {root!r}")
        return 2
    try:
        base = args.base or None if not args.staged else None
        changed, added, base_sha = change_set(root, base, args.staged)
    except DeltaError as exc:
        degraded(exc.code, str(exc))
        print(f"QUALITY-DELTA: ERROR {exc.code}", file=sys.stdout)
        return 2

    # ── --update-baseline（唯一写路径；检查模式绝不写）──
    if args.update_baseline:
        try:
            return run_update_baseline(root, changed, added, args)
        except DeltaError as exc:
            degraded(exc.code, str(exc))
            print(f"QUALITY-DELTA: ERROR {exc.code}", file=sys.stdout)
            return 2
        except Exception as exc:  # noqa: BLE001 —— 兜底：宁可 exit 2 也不把 bug 当绿
            degraded("E_INTERNAL", f"未预期异常: {type(exc).__name__}: {exc}")
            print("QUALITY-DELTA: ERROR E_INTERNAL", file=sys.stdout)
            return 2

    code_changed = [p for p in changed if is_code(p)]
    if not code_changed:
        # A1: 过滤后空代码变更 = 不适用（不是"看不见"）
        msg = f"SKIP: 无代码变更（base={base_sha}）"
        if args.json:
            print(json.dumps({"status": "skip", "base": base_sha, "changed": len(changed),
                              "g5": {"checked": 0, "advisory": 0,
                                     "disabled": os.environ.get("SYNO_QD_G5", "1").strip() == "0"}},
                             ensure_ascii=False))
        else:
            print(f"⏭  {msg}")
            print(f"QUALITY-DELTA: SKIP base={base_sha}")
        return 0

    # 辅助件按需读（只有 G1 需要 registry；白名单缺失即 fail-closed）
    reg_path = Path(root) / (args.registry or API_FILES[0])
    wl_path = Path(root) / (args.whitelist or DEFAULT_WHITELIST)
    try:
        max_entries, wl_entries = parse_whitelist(wl_path.read_text(encoding="utf-8"))
    except OSError as exc:
        degraded("E_WHITELIST", f"白名单不可读 {wl_path}: {exc}")
        print("QUALITY-DELTA: ERROR E_WHITELIST", file=sys.stdout)
        return 2
    registry: List[Dict[str, str]] = []
    added_code = [p for p in added if is_code(p)]
    if added_code:
        try:
            registry = parse_registry(reg_path.read_text(encoding="utf-8"))
        except OSError as exc:
            degraded("E_REGISTRY", f"接线登记表不可读 {reg_path}: {exc}")
            print("QUALITY-DELTA: ERROR E_REGISTRY", file=sys.stdout)
            return 2

    violations: List[Tuple[str, str, int, str]] = []
    notes: List[str] = []
    advisories: List[str] = []
    g5_checked = 0
    g5_advisory = 0
    g5_disabled = os.environ.get("SYNO_QD_G5", "1").strip() == "0"
    try:
        g1, declared_only = scan_g1(root, added, registry)
        violations += g1
        notes.append(f"G1 可达: 新增能力件 {len([p for p in added_code if not any(p.endswith(x) or p.startswith(x) for x in G1_EXCLUDE)])} 个"
                     + (f"；declared-only {declared_only} 个（计入棘轮）" if declared_only else ""))
        for p in changed:
            if is_test_file(p):
                violations += scan_g3(root, p, wl_entries)
        for p in changed:
            if p.endswith(".ts") and (p.startswith("src/routes/") or p.startswith("src/agent/")):
                violations += scan_g4(root, p, wl_entries)

        # ── G5 覆盖率/重复率（#913 PR-3）──
        g5_src, g5_added = g5_src_files(changed, added)
        if g5_disabled:
            degraded("G5-DISABLED", "SYNO_QD_G5=0 ⇒ G5 整组跳过（回滚开关；rc 仍按 G1/G3/G4）")
            notes.append("G5 覆盖率/重复率: 已禁用（SYNO_QD_G5=0，整组跳过）")
        elif not g5_src:
            notes.append(f"G5 覆盖率/重复率: 不适用（变更集无 src/**{G5_SRC_EXT}；变更集 {len(changed)} 文件）")
        elif not g5_armed(args):
            # 未武装 ≠ 通过：只是本组无判据对象 ⇒ 每次都必须显式说明（L1 追认：禁静默）
            notes.append(f"G5 未武装（未传 --coverage-summary/--coverage-sha/--baseline）：不判覆盖率/重复率"
                         f"（变更集含 {len(g5_src)} 个 src/**{G5_SRC_EXT}；接线后由调用方传参即生效）")
        else:
            judged = [p for p in g5_src if not whitelisted(wl_entries, p, "R5.1")]
            cov_path = args.coverage_summary or DEFAULT_COVERAGE_SUMMARY
            bpath = args.baseline or DEFAULT_BASELINE
            if judged:
                cov = load_coverage_summary(root, cov_path)
                baseline = load_baseline(root, bpath, explicit=bool(args.baseline))
                check_coverage_freshness(root, args.coverage_sha)
                g5_v, a_n, m_n, wl_n = scan_g5_coverage(root, g5_src, g5_added, cov, baseline, wl_entries)
                violations += g5_v
                g5_checked = len(judged)
                notes.append(f"G5 覆盖率: 判 {g5_checked} 个 src/**{G5_SRC_EXT}（A 档 {a_n} / M 档 {m_n}"
                             + (f" / R5.1 白名单豁免 {wl_n}" if wl_n else "") + f"）；"
                             f"baseline 条目 {len(baseline)}；coverage={cov_path}")
            else:
                notes.append(f"G5 覆盖率: 变更集 {len(g5_src)} 个 src/**{G5_SRC_EXT} 全部命中 R5.1 白名单 ⇒ 不判")
            advisories, g5_advisory, dup_note = scan_g5_duplication(root, g5_src)
            notes.append(dup_note)
    except DeltaError as exc:
        degraded(exc.code, str(exc))
        print(f"QUALITY-DELTA: ERROR {exc.code}", file=sys.stdout)
        return 2
    except Exception as exc:  # noqa: BLE001 —— 兜底：宁可 exit 2 也不把 bug 当绿
        degraded("E_INTERNAL", f"未预期异常: {type(exc).__name__}: {exc}")
        print("QUALITY-DELTA: ERROR E_INTERNAL", file=sys.stdout)
        return 2

    if len(wl_entries) > max_entries:
        violations.append(("W-RATCHET", DEFAULT_WHITELIST, 1,
                           f"白名单条目 {len(wl_entries)} > ratchet.max_entries {max_entries}（只减不增）"))

    if args.json:
        print(json.dumps({"status": "violations" if violations else "pass", "base": base_sha,
                          "changed": len(code_changed), "entries": len(wl_entries),
                          "g5": {"checked": g5_checked, "advisory": g5_advisory, "disabled": g5_disabled},
                          "violations": [{"rule": r[0], "path": r[1], "line": r[2], "msg": r[3]}
                                         for r in violations]}, ensure_ascii=False))
        return 1 if violations else 0

    for n in notes:
        print(f"ℹ️  {n}")
    for a in advisories:
        print(a)
    if violations:
        for rule, path, line, msg in violations:
            print(f"❌ {rule}: {path}:{line} {msg}")
        print(f"QUALITY-DELTA: VIOLATIONS {len(violations)}")
        return 1
    for rule in ("G1", "G3", "G4"):
        print(f"✅ {rule} 可达/判据/边界")
    if g5_armed(args) and not g5_disabled:
        print("✅ G5 覆盖率/重复率")
    elif not g5_disabled:
        print("ℹ️  G5 未武装（未传 --coverage-summary/--coverage-sha）⇒ 未判，不计入 rules")
    # 末行 rules 口径固定（L1 追认）：正常/未武装/不适用 都含 G5（组存在即使 N/A）；
    # 仅 SYNO_QD_G5=0 时 G5 组整组回滚 ⇒ rules 不含 G5（并已在 stderr 打 degraded: G5-DISABLED）
    rules = "G1,G3,G4,G5" if (g5_armed(args) and not g5_disabled) else "G1,G3,G4"
    print(f"QUALITY-DELTA: PASS changes={len(code_changed)} rules={rules} base={base_sha}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
