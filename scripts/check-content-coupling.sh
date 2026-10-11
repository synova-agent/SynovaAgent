#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-content-coupling.sh — K12-13（issue #196）内容面 ↔ 引擎面 耦合门禁（CC1–CC4）
#
# 出处: 院方《extensions内容面规范-v0.1》§3.5（判据 CC1–CC4 的原文表格）
#       施工项登记.ts K12-13（issue 196；acceptance: bash scripts/check-content-coupling.sh expectExit 0）
#       宪章 P1「一切皆为内容」＋ 约束 4「内核与扩展边界物理可见」
# 补的洞: 既有架构门禁 check-architecture.sh 对 extensions/ **零覆盖**
#         （实测 `grep -c extensions scripts/check-architecture.sh` = 0）
#
# ── 契约（铁律 47）─────────────────────────────────────────────────────────────
#   @input  CC_ROOT       仓根（默认 = 本脚本的上级目录）
#           CC_EXT_DIR    内容面扫描根（默认 $CC_ROOT/extensions）
#           CC_SRC_DIR    引擎面扫描根（默认 $CC_ROOT/src）
#           CC_REGISTRY   content-registry 真源（默认 $CC_SRC_DIR/deploy/content-registry.ts）
#           SYNO_CI=1     CI 硬阻断位：基线外新增 ⇒ exit 1（D515/D516 先例）
#           CC_STRICT=1   全量严格：任意违规（含棘轮内存量）⇒ exit 1
#           参数: --print-baseline（打印当前实测的 CC-BASELINE 段，供下调基线）｜--help
#                 未知参数（- 开头）⇒ exit 2（**不静默忽略**：打错字不许伪装成"跑过了"）
#   @output 逐条 CC 打印：扫描面体量 / 违规计数（新增 / 存量）/ 违规坐标 file:line + 说明符 + type|值
#           末行机器可判：`CONTENT-COUPLING: OK` | `CONTENT-COUPLING: VIOLATION new=N` | `CONTENT-COUPLING: DEGRADED ...`
#   @exit   0 = 无新增违规（含棘轮内的存量，只减不增）
#           1 = 有违规：CI 模式=基线外新增；STRICT 模式=任意违规
#           2 = 门禁自身失败（fail-closed：扫描面缺失 / 注册表不可读 / python3 不可用 / 源文件不可读
#               ——「读不了 = 没扫」，绝不与通过混同）
#   @degraded 无 —— 内容耦合门禁不允许降级放行；任何"判不了"的情形显式 exit 2
#
# ── 判据（CC1–CC4，逐条可机器判）──────────────────────────────────────────────
#   CC1 方向 —— extensions/**/*.ts 的 import 目标 ∈ {裸包名} ∪ {extensions/ 内部相对路径}；
#               越出 extensions/ 的相对/绝对路径 = 违规（**方向：内容不得钻引擎**）
#   CC2 对称 —— src/**/*.ts 不得从 extensions/** 取 type（import type / type 位置 import）；
#               值 import 进 extensions **无基线**（零容忍，出现即新增）
#   CC3 可达 —— 每个 extensions/<dir>/manifest.json 的 type 必须在 content-registry 登记；
#               status ∈ {reachable, retired, pending-cto}；status=reachable ⇒ loader.module 或
#               readers 至少一条在盘上可解析（堵"loader 死 / 无 loader 却称可达"）
#   CC4 结构 —— extensions/ 每个顶层目录必须有 manifest.json（可解析 JSON ＋ 有 type 字段）
#
# ── 存量实测（2026-10-11，base 68bf57598；与院方 §3.5 表格的差异已逐条核实）──────
#   CC1 方向: **113 type ＋ 30 值 / 85 文件**（§3.5 记「113 type ＋ 28 值」；type 逐字吻合，
#             值差 2 = `extensions/adapters/{feishu,nemoclaw}/adapter.ts` 的
#             `await import('.../src/connectors/*')` —— 运行时真依赖，本门禁计入值向）
#   CC2 对称: **94 type ＋ 0 值**（§3.5 记 27）—— 27 = 只数**单引号**形态；余 67 条是**双引号**形态
#             （`src/sentinel/types.ts:274+` 的 `import type { … } from "../../extensions/…"`），被单引号 grep 口径漏掉。
#             🔴 更正（2026-10-11 独立复核实测）：那 67 条**同样是 `import type`**，不是值 import ——
#             独立 AST 复核（typescript compiler API）实测 `src/sentinel/types.ts` = 94 `import type` ＋ **0 值**。
#             故本条正确表述是「94 type，其中 27 单引号 ＋ 67 双引号」，**与「type/值」是两个正交维度**。
#             （原注释把"双引号形态"误并入值向归因，属 M4 级根因说明错——门禁运行输出 `94 type ＋ 0 值` 一直是对的。）
#             ⇒ 本门禁不依赖引号形态（这正是「词法扫描」与「真解析」的分界，也是 CC2 真值 = 94 的理由）
#   CC3 可达: **0**（#1465 已给 engine-config/tools-manifest 等做显式 status 裁决 ＋ 建 content-registry）
#   CC4 结构: **0**（#1465 已给 context-strategies/implementation-patterns/policies/security 补 manifest）
#   ⇒ 判据源「expectExit 0」在本 base 成立；CC1/CC2 存量走棘轮只减不增。
#   卡面 §3.5 的 entryPoint 维度（"双口径可解析"）：#1465 已裁定 entryPoint 降为**纯文档**、
#   真源=src/deploy/content-registry.ts ⇒ 本门禁**只报不判红**（advisory note），不复活已裁定的语义。
#
# ── 与既有门禁的分工（规范 §3.5「正交不重复」）────────────────────────────────
#   §d（check-file-driven.sh 组 d）只查 **staged 新增**目录缺 manifest ⇒ 与 CC4 **有界重叠**
#      （范围不同：staged vs 全树）。二者不可互替：§d 在提交端挡新增，CC4 在 CI 挡**存量漏网**
#      （§d 的存量盲区正是规范点名的洞）。⇒ 同一违规**可能各报一次**，已在回执如实标注。
#   §e（同脚本组 e，pizza-chain）管"可载性/测试存在"；pre-commit 组 2 管测试配对 ⇒ 与 CC1–CC4 不重叠。
#   门禁内部亦去重：缺 type / manifest 坏 只由 CC4 报（CC3 对其静默跳过），一条违规只有一条 CC 承担。
# ── 棘轮（棘轮语义 = 只减不增，与 check-architecture.sh 基线同源）──────────────
#   存量违规登记在下方 `CC-BASELINE-BEGIN/END` 段（逐文件计数），格式:
#     CC1 <path> t=<type 数> v=<值 数>
#     CC2 <path> t=<type 数> v=<值 数>
#   · actual > baseline ⇒ NEW（CI 模式 exit 1）
#   · actual < baseline ⇒ STALE（基线应下调；打印可见、**不判红**，避免"修好反而红"）
#   · CC3/CC4 存量实测为 0 ⇒ 无基线条目（出现即 NEW）
#   🔴🔴 **已知失效面（2026-10-11 独立复核实测，红字登记，不许当成"有意粒度"带过）**:
#      棘轮判定**只比 `t`/`v` 两个计数**，**specifier 本体从不参与比较** ⇒
#      **「同数换体」= 假绿**：把既有越界依赖**换成一条全新的越界依赖**（同文件、同数量、另一行）
#      在 `SYNO_CI=1` 下**不会被判红**。
#      单元级实证（原判定代码 + 仅注入一行基线）：
#        ① 与基线同体（OLD 目标）        → total=1 **new=0**
#        ② 换成全新目标（NEW，同数）      → total=1 **new=0**   ← 新越界依赖被静默接受
#      反向确认（计数上升时判据有效）：给已登记基线的 `extensions/adapters/feishu/adapter.ts` 追加 1 条 ⇒
#        正确报 `CC1 NEW …adapter.ts:33 '…' (值)` exit=1。
#      ⇒ **本门禁当前只守"量"，守不住"体"**。接入 CI 前必须二选一：
#        (a) 把**逐条 specifier 身份**纳入基线比较（基线体积会显著增大，需重定基线格式），或
#        (b) 接受该失效面并在此红字登记 + 在 CI 红线里写明「同数换体不拦」。
#      **本卡（#196）不擅自改判据语义**（判据变更 = CTO 域）⇒ 按 (b) 登记，**升级 (a) 另立卡**。
#      （连带：基线**只能**由 `--print-baseline` 显式刷新——该入口曾因缺 case 分支而 exit 2，
#        同次复核发现、已修，见 :101-108；刷新动作进 diff，可审；禁止手改数字绕过。）
#
# ── 🔴 接入状态（2026-10-11 交付时实测）────────────────────────────────────────
#   **当前尚未接入 pre-commit，也尚未接入 CI** —— 本卡写集不含 scripts/pre-commit-check.sh
#   （门禁语义归 CTO）与 .gitea/workflows/**（CI 配置语义归 CTO）。接入方案原文见文件末 §接入方案。
#   设计取向（规范 §3.5 ＋ DSH 借鉴项「只在 CI 权威」）：**不进 pre-commit 本地阻断位**
#   —— v2.5 教训（38 项 pre-commit ⇒ --no-verify 泛滥）与本门禁的存量规模都指向"本地软提示 + CI 权威"。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_PATH="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
ROOT="${CC_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
EXT="${CC_EXT_DIR:-$ROOT/extensions}"
SRC="${CC_SRC_DIR:-$ROOT/src}"
REG="${CC_REGISTRY:-$SRC/deploy/content-registry.ts}"
MODE="local"
[ "${SYNO_CI:-0}" = "1" ] && MODE="ci"
[ "${CC_STRICT:-0}" = "1" ] && MODE="strict"

case "${1:-}" in
  --help|-h)
    cat <<'USAGE'
用法: bash scripts/check-content-coupling.sh [--help|--print-baseline]
  （无参数）        本地模式：报告 CC1–CC4 违规清单与棘轮差异；exit 0
  --print-baseline  打印当前实测的 CC-BASELINE 段（供存量下降后下调基线）
触发位（环境变量）:
  SYNO_CI=1         CI 硬阻断位：基线外**新增**违规 ⇒ exit 1
  CC_STRICT=1       全量严格：任意违规（含棘轮内存量）⇒ exit 1
  注入缝: CC_ROOT / CC_EXT_DIR / CC_SRC_DIR / CC_REGISTRY（夹具与多仓场景）
退出码: 0=无新增违规｜1=有违规（CI/STRICT）｜2=门禁自身失败（fail-closed）
USAGE
    exit 0 ;;
  --print-baseline)
    # 🔴 独立复核（2026-10-11）发现: 本分支原缺失，`-*` 兜底把**合法长参**一起吞掉 ⇒ exit 2。
    #   后果: 头注释承诺的"基线只能由 --print-baseline 显式刷新"**无法执行** ⇒ 棘轮基线永久冻结。
    #   Python 侧（PRINT_BASELINE @ :123 / 打印分支 @ :562）本就实现，仅 bash 层未放行 ⇒ 此处只补分支，不改语义。
    #   透传给下方 python（不 exit），由 PRINT_BASELINE 分支打印 CC-BASELINE 段后返回 0。
    ;;
  -*)
    echo "CONTENT-COUPLING: DEGRADED 未知参数: $1（fail-closed；--help 看用法）"
    exit 2 ;;
esac

PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "CONTENT-COUPLING: DEGRADED python3 不可用（CC1–CC4 无法判定；fail-closed，绝不当作通过）"
  exit 2
fi

exec "$PY" - "$ROOT" "$EXT" "$SRC" "$REG" "$MODE" "$@" <<'PYEOF'
# -*- coding: utf-8 -*-
"""CC1–CC4 扫描核（内嵌于 scripts/check-content-coupling.sh，无独立落盘副本）。"""
import collections
import json
import os
import re
import sys

ROOT, EXT, SRC, REG, MODE = sys.argv[1:6]
ARGS = sys.argv[6:]
PRINT_BASELINE = "--print-baseline" in ARGS

STATUS_OK = ("reachable", "retired", "pending-cto")

# ── 存量棘轮基线（只减不增；由 --print-baseline 生成，禁手改）──────────────────
CC_BASELINE_BEGIN = "CC-BASELINE-BEGIN"
CC_BASELINE_END = "CC-BASELINE-END"
BASELINE_TEXT = r"""
CC1 extensions/adapters/feishu/adapter.ts t=1 v=1
CC1 extensions/adapters/nemoclaw/adapter.ts t=1 v=1
CC1 extensions/notifications/email/adapter.ts t=1 v=0
CC1 extensions/notifications/feishu-approval/adapter.ts t=1 v=0
CC1 extensions/notifications/jira/adapter.ts t=1 v=0
CC1 extensions/notifications/linear/adapter.ts t=1 v=0
CC1 extensions/sentinels/agent-deployment-maturity/aggregate.ts t=2 v=0
CC1 extensions/sentinels/agent-deployment-maturity/computes/compute-agent-deployment-maturity.ts t=0 v=1
CC1 extensions/sentinels/ai-ecosystem-fit/aggregate.ts t=2 v=0
CC1 extensions/sentinels/ai-ecosystem-fit/computes/compute-ai-ecosystem-fit.ts t=0 v=1
CC1 extensions/sentinels/ai-investment-return/aggregate.ts t=2 v=0
CC1 extensions/sentinels/ai-investment-return/computes/compute-ai-investment-return.ts t=0 v=1
CC1 extensions/sentinels/api-coverage/aggregate.ts t=2 v=0
CC1 extensions/sentinels/business-model-coherence/aggregate.ts t=2 v=0
CC1 extensions/sentinels/business-model-coherence/computes/model-consistency-score.ts t=0 v=1
CC1 extensions/sentinels/capital-health/aggregate.ts t=3 v=0
CC1 extensions/sentinels/capital-health/computes/asset-turnover.ts t=0 v=1
CC1 extensions/sentinels/capital-health/computes/capital-turnover.ts t=0 v=1
CC1 extensions/sentinels/capital-health/computes/cash-conversion-cycle.ts t=0 v=1
CC1 extensions/sentinels/capital-health/computes/debt-equity-ratio.ts t=0 v=1
CC1 extensions/sentinels/capital-health/computes/debt-structure.ts t=0 v=1
CC1 extensions/sentinels/capital-health/computes/interest-coverage.ts t=0 v=1
CC1 extensions/sentinels/capital-health/computes/receivable-turnover.ts t=0 v=1
CC1 extensions/sentinels/capital-health/computes/roic-wacc-spread.ts t=0 v=1
CC1 extensions/sentinels/capital-health/computes/wacc.ts t=0 v=1
CC1 extensions/sentinels/cash-runway/aggregate.ts t=3 v=0
CC1 extensions/sentinels/cash-runway/computes/compute-cash-runway-months.ts t=2 v=0
CC1 extensions/sentinels/cash-runway/computes/compute-constraint-impact.ts t=2 v=0
CC1 extensions/sentinels/cash-runway/computes/compute-receivable-overdue-rate.ts t=2 v=0
CC1 extensions/sentinels/cash-runway/computes/compute-replenish-rate.ts t=2 v=0
CC1 extensions/sentinels/channel-capacity/aggregate.ts t=2 v=0
CC1 extensions/sentinels/competitive-moat/aggregate.ts t=2 v=0
CC1 extensions/sentinels/competitive-position/aggregate.ts t=2 v=0
CC1 extensions/sentinels/customer-demand-shift/aggregate.ts t=2 v=0
CC1 extensions/sentinels/data-health/aggregate.ts t=2 v=0
CC1 extensions/sentinels/environment-rent-dependency/aggregate.ts t=2 v=0
CC1 extensions/sentinels/environment-rent-dependency/computes/rent-dependency-index.ts t=0 v=1
CC1 extensions/sentinels/explore-exploit-balance/aggregate.ts t=2 v=0
CC1 extensions/sentinels/financing-constraint/aggregate.ts t=2 v=0
CC1 extensions/sentinels/financing-constraint/computes/cash-runway.ts t=0 v=1
CC1 extensions/sentinels/financing-constraint/computes/kz-index.ts t=0 v=1
CC1 extensions/sentinels/growth-quality/aggregate.ts t=2 v=0
CC1 extensions/sentinels/growth-quality/computes/cash-conversion-rate.ts t=0 v=1
CC1 extensions/sentinels/growth-quality/computes/organic-growth-pct.ts t=0 v=1
CC1 extensions/sentinels/human-agent-boundary/aggregate.ts t=2 v=0
CC1 extensions/sentinels/incentive-alignment/aggregate.ts t=2 v=0
CC1 extensions/sentinels/info-distortion/aggregate.ts t=2 v=0
CC1 extensions/sentinels/internal-transaction-cost/aggregate.ts t=2 v=0
CC1 extensions/sentinels/key-person-risk/aggregate.ts t=2 v=1
CC1 extensions/sentinels/knowledge-accessibility/aggregate.ts t=2 v=0
CC1 extensions/sentinels/knowledge-accessibility/computes/compute-knowledge-accessibility.ts t=0 v=1
CC1 extensions/sentinels/make-or-buy/aggregate.ts t=2 v=0
CC1 extensions/sentinels/make-or-buy/computes/make-or-buy-score.ts t=0 v=1
CC1 extensions/sentinels/margin-health/aggregate.ts t=3 v=0
CC1 extensions/sentinels/margin-health/computes/compute-cost-per-head.ts t=0 v=1
CC1 extensions/sentinels/margin-health/computes/compute-fixed-variable-ratio.ts t=0 v=1
CC1 extensions/sentinels/margin-health/computes/compute-gross-margin.ts t=0 v=1
CC1 extensions/sentinels/margin-health/computes/compute-incentive-bind.ts t=2 v=0
CC1 extensions/sentinels/margin-health/computes/compute-margin-vs-benchmark.ts t=0 v=1
CC1 extensions/sentinels/margin-health/computes/compute-metric-bind-divergence.ts t=2 v=0
CC1 extensions/sentinels/margin-health/computes/compute-profit-margin-change.ts t=0 v=1
CC1 extensions/sentinels/moat-dependency/aggregate.ts t=2 v=0
CC1 extensions/sentinels/network-power/aggregate.ts t=2 v=0
CC1 extensions/sentinels/niche-breadth/aggregate.ts t=2 v=0
CC1 extensions/sentinels/niche-squeeze/aggregate.ts t=2 v=0
CC1 extensions/sentinels/opportunity-window/aggregate.ts t=2 v=0
CC1 extensions/sentinels/org-repairability/aggregate.ts t=2 v=0
CC1 extensions/sentinels/path-dependency/computes/detect.ts t=3 v=0
CC1 extensions/sentinels/power-rigidity/aggregate.ts t=2 v=0
CC1 extensions/sentinels/process-ai-readiness/aggregate.ts t=2 v=0
CC1 extensions/sentinels/resource-misallocation/aggregate.ts t=2 v=0
CC1 extensions/sentinels/revenue-health/aggregate.ts t=3 v=0
CC1 extensions/sentinels/revenue-health/computes/compute-revenue-growth.ts t=2 v=0
CC1 extensions/sentinels/routine-diffusion/aggregate.ts t=2 v=0
CC1 extensions/sentinels/routine-mutation/aggregate.ts t=2 v=0
CC1 extensions/sentinels/sentinel-forecast-accuracy/aggregate.ts t=1 v=0
CC1 extensions/sentinels/sentinel-pricing-strategy/aggregate.ts t=1 v=0
CC1 extensions/sentinels/software-health/aggregate.ts t=2 v=0
CC1 extensions/sentinels/strategy-capability-fit/aggregate.ts t=2 v=0
CC1 extensions/sentinels/talent-density/aggregate.ts t=2 v=0
CC1 extensions/sentinels/talent-density/computes/compute-talent-density.ts t=0 v=1
CC1 extensions/sentinels/time-penetration/aggregate.ts t=2 v=0
CC1 extensions/sentinels/unit-economics/aggregate.ts t=2 v=0
CC1 extensions/sentinels/value-capture/aggregate.ts t=2 v=0
CC1 extensions/sentinels/value-capture/computes/value-capture-score.ts t=0 v=1
CC2 src/sentinel/types.ts t=94 v=0
"""


def parse_baseline(text):
    """→ {'CC1': {path: {'t': n, 'v': n}}, 'CC2': {...}}"""
    out = collections.defaultdict(dict)
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        cc, path = parts[0], parts[1]
        rec = {"t": 0, "v": 0}
        for kv in parts[2:]:
            if kv.startswith("t="):
                rec["t"] = int(kv[2:])
            elif kv.startswith("v="):
                rec["v"] = int(kv[2:])
        out[cc][path] = rec
    return out


BASELINE = parse_baseline(BASELINE_TEXT)

# 读失败清单（fail-closed 用；空 = 扫描面完整）
READ_ERRORS = []

# ── 源文件解析 ────────────────────────────────────────────────────────────────
# 说明符形态: from '...' ｜ import '...' ｜ import('...') ｜ require('...')
SPEC_RE = re.compile(
    r"""(?:\bfrom\s*|(?<![\w$])import\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]"""
)


def blank_comments(text):
    """注释置为空格（**保留偏移**，故行号可用）；字符串内容原样保留。"""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = i
            while j < n and text[j] != "\n":
                out[j] = " "
                j += 1
            i = j
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            j = i
            while j < n and not (text[j] == "*" and j + 1 < n and text[j + 1] == "/"):
                if text[j] != "\n":
                    out[j] = " "
                j += 1
            for k in range(j, min(j + 2, n)):
                if out[k] != "\n":
                    out[k] = " "
            i = j + 2
        elif c in "\"'`":
            q = c
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == q:
                    break
                if text[j] == "\n" and q != "`":
                    break
                j += 1
            i = j + 1
        else:
            i += 1
    return "".join(out)


def classify(s, pos):
    """按语句窗口判 type / 值（窗口 = 上一个 ';' 之后到说明符之前）。"""
    semi = s.rfind(";", max(0, pos - 4000), pos)
    win = s[semi + 1:pos]
    if re.search(r"\b(?:import|export)\s+type\b", win):
        return "type"
    if re.search(r"\btype\s+[\w$]*\s*=\s*$", win.rstrip()):
        return "type"
    if re.search(r"import\s*\(\s*$", win.rstrip()) and re.search(r":\s*$", win.rstrip().replace("import(", "")):
        return "type"
    if re.search(r"[\w\]\)>\?]\s*:\s*$", win.rstrip()) and re.search(r"\bimport\s*\(\s*$", win):
        return "type"
    return "value"


def line_of(s, pos):
    return s.count("\n", 0, pos) + 1


def ts_files(base):
    res = []
    for dp, dn, fn in os.walk(base):
        dn[:] = [d for d in dn if d not in ("node_modules", ".git")]
        for f in sorted(fn):
            if f.endswith(".ts") or f.endswith(".tsx"):
                res.append(os.path.join(dp, f))
    return sorted(res)


def inside(path, base):
    path = os.path.normpath(path)
    return path == base or path.startswith(base + os.sep)


# ── CC1 方向 ──────────────────────────────────────────────────────────────────
def scan_cc1():
    viol = collections.defaultdict(lambda: {"type": [], "value": []})
    files = ts_files(EXT)
    for f in files:
        try:
            raw = open(f, encoding="utf-8", errors="replace").read()
        except OSError as exc:
            # 铁律 11/24: 读不了 = 没扫 = **不许静默当通过**（fail-closed，见 main 的 READ_ERRORS 分支）
            READ_ERRORS.append(f"{os.path.relpath(f, ROOT)}: {exc.strerror or exc}")
            continue
        s = blank_comments(raw)
        for m in SPEC_RE.finditer(s):
            spec = m.group(1)
            if spec.startswith("."):
                target = os.path.normpath(os.path.join(os.path.dirname(f), spec))
                outside = not inside(target, EXT)
            elif spec.startswith("/"):
                outside = True
            else:
                outside = False  # 裸包名（含 @synova/*）
            if outside:
                rel = os.path.relpath(f, ROOT)
                viol[rel][classify(s, m.start())].append((line_of(s, m.start()), spec))
    return viol, len(files)


# ── CC2 对称 ──────────────────────────────────────────────────────────────────
def scan_cc2():
    viol = collections.defaultdict(lambda: {"type": [], "value": []})
    files = ts_files(SRC)
    for f in files:
        try:
            raw = open(f, encoding="utf-8", errors="replace").read()
        except OSError as exc:
            # 铁律 11/24: 读不了 = 没扫 = **不许静默当通过**（fail-closed，见 main 的 READ_ERRORS 分支）
            READ_ERRORS.append(f"{os.path.relpath(f, ROOT)}: {exc.strerror or exc}")
            continue
        s = blank_comments(raw)
        for m in SPEC_RE.finditer(s):
            spec = m.group(1)
            into_ext = False
            if spec.startswith("."):
                into_ext = inside(os.path.normpath(os.path.join(os.path.dirname(f), spec)), EXT)
            if "extensions/" in spec or "extensions\\" in spec:
                into_ext = True
            if into_ext:
                rel = os.path.relpath(f, ROOT)
                viol[rel][classify(s, m.start())].append((line_of(s, m.start()), spec))
    return viol, len(files)


# ── CC3 可达 ──────────────────────────────────────────────────────────────────
def split_entries(text):
    """从 CONTENT_TYPES 数组文本切出顶层 {...} 条目（花括号配平）。"""
    blocks = []
    depth = 0
    start = None
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i + 1
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                blocks.append(text[start:i])
                start = None
    return blocks


def registry_entries():
    text = open(REG, encoding="utf-8", errors="replace").read()
    text = blank_comments(text)
    entries = {}
    for body in split_entries(text):
        m = re.search(r"\btype:\s*'([^']+)'", body)
        if not m:
            continue
        t = m.group(1)
        st = re.search(r"\bstatus:\s*'([^']+)'", body)
        lm = re.search(r"\bmodule:\s*'([^']+)'", body)
        readers = []
        rm = re.search(r"\breaders:\s*\[(.*?)\]", body, re.S)
        if rm:
            for r in re.findall(r"'([^']+)'", rm.group(1)):
                pm = re.match(r"^((?:src|packages)/[\w./-]+)", r)
                if pm:
                    readers.append(pm.group(1))
        entries[t] = {
            "status": st.group(1) if st else "",
            "loader": lm.group(1) if lm else "",
            "readers": readers,
        }
    return entries


def resolvable_module(spec):
    base = os.path.normpath(os.path.join(os.path.dirname(REG), spec))
    for cand in (base, base + ".ts", base + ".js", base + ".json",
                 os.path.join(base, "index.ts")):
        if os.path.exists(cand):
            return True
    return False


def scan_cc3():
    """→ (violations[list of (key, reason)], notes[list], entries, n_manifest)"""
    viol = []
    notes = [0, 0]  # [0]=两口径皆悬空数（逐条打印）, [1]=仅单口径可解析数（聚合打印）
    entries = registry_entries()
    manifests = []
    for d in sorted(os.listdir(EXT)):
        p = os.path.join(EXT, d)
        if os.path.isdir(p) and os.path.exists(os.path.join(p, "manifest.json")):
            manifests.append((d, os.path.join(p, "manifest.json")))
    for name, mf in manifests:
        try:
            data = json.load(open(mf, encoding="utf-8"))
        except (OSError, ValueError):
            continue  # 结构缺陷归 CC4（不重复报：一条违规只由一条 CC 承担）
        t = data.get("type")
        if not t:
            continue  # 同上：缺 type 字段归 CC4
        e = entries.get(t)
        if e is None:
            viol.append((f"extensions/{name}", f"type='{t}' 在 content-registry 未登记（boot 不装配）"))
            continue
        if e["status"] not in STATUS_OK:
            viol.append((f"extensions/{name}", f"type='{t}' status='{e['status'] or '缺'}' 不在三态内"))
            continue
        if e["status"] == "reachable":
            ok = False
            if e["loader"] and resolvable_module(e["loader"]):
                ok = True
            for r in e["readers"]:
                if os.path.exists(os.path.join(ROOT, r)):
                    ok = True
            if not ok:
                detail = []
                if e["loader"]:
                    detail.append(f"loader.module='{e['loader']}' 在盘上不可解析")
                if e["readers"]:
                    detail.append("readers 全部不在盘上: " + ",".join(e["readers"]))
                viol.append((f"extensions/{name}",
                             f"type='{t}' status=reachable 但无可达证据（" + "；".join(detail) + "）"))
        ep = data.get("entryPoint")
        if ep:
            r1 = os.path.exists(os.path.normpath(os.path.join(os.path.dirname(mf), ep)))
            r2 = os.path.exists(os.path.normpath(os.path.join(EXT, ep)))
            if r1 and r2:
                pass
            elif r1 or r2:
                notes[1] += 1
            else:
                notes[0] += 1
                notes.append(
                    f"NOTE CC3(advisory): extensions/{name} entryPoint='{ep}' —— **两种口径皆悬空（死指针）**；"
                    f"#1465 已把 entryPoint 降为纯文档（真源=content-registry）⇒ 只报不判红，"
                    f"修法见 K12-18")
    return viol, notes, entries, len(manifests)


# ── CC4 结构 ──────────────────────────────────────────────────────────────────
def scan_cc4():
    viol = []
    dirs = [d for d in sorted(os.listdir(EXT)) if os.path.isdir(os.path.join(EXT, d))]
    for d in dirs:
        mf = os.path.join(EXT, d, "manifest.json")
        if not os.path.exists(mf):
            viol.append((f"extensions/{d}", "顶层目录缺 manifest.json"))
            continue
        try:
            data = json.load(open(mf, encoding="utf-8"))
        except (OSError, ValueError) as exc:
            viol.append((f"extensions/{d}", f"manifest.json 不可解析: {exc.__class__.__name__}"))
            continue
        if not data.get("type"):
            viol.append((f"extensions/{d}", "manifest.json 缺 type 字段"))
    return viol, len(dirs)


def ratchet(cc, viol):
    """→ (new[list], stock_n, stale_n, total)"""
    base = BASELINE.get(cc, {})
    new, stale, total = [], [], 0
    for path, kinds in sorted(viol.items()):
        t = len(kinds["type"])
        v = len(kinds["value"])
        total += t + v
        b = base.get(path)
        if b is None:
            for ln, spec in kinds["type"]:
                new.append(f"{cc} NEW {path}:{ln} {spec!r} (type)")
            for ln, spec in kinds["value"]:
                new.append(f"{cc} NEW {path}:{ln} {spec!r} (值)")
        else:
            stock_t, stock_v = min(t, b["t"]), min(v, b["v"])
            stock_n = stock_t + stock_v
            if t > b["t"]:
                for ln, spec in kinds["type"][stock_t:]:
                    new.append(f"{cc} NEW {path}:{ln} {spec!r} (type)")
            if v > b["v"]:
                for ln, spec in kinds["value"][stock_v:]:
                    new.append(f"{cc} NEW {path}:{ln} {spec!r} (值)")
            if t < b["t"] or v < b["v"]:
                stale.append(f"{cc} STALE {path} 实测 t={t} v={v} < 基线 t={b['t']} v={b['v']}（应 --print-baseline 下调）")
    for path, b in base.items():
        if path not in viol and (b["t"] or b["v"]):
            stale.append(f"{cc} STALE {path} 实测 t=0 v=0 < 基线 t={b['t']} v={b['v']}（文件已零违规/已删，应下调基线）")
    return new, total, stale, total


def main():
    missing = [p for p in (EXT, SRC) if not os.path.isdir(p)]
    if missing:
        print(f"CONTENT-COUPLING: DEGRADED 扫描面缺失: {', '.join(missing)}（fail-closed，绝不当作通过）")
        return 2
    if not os.path.isfile(REG):
        print(f"CONTENT-COUPLING: DEGRADED 注册表真源缺失: {REG}（fail-closed，绝不当作通过）")
        return 2

    cc1, n_ext = scan_cc1()
    cc2, n_src = scan_cc2()
    if READ_ERRORS:
        print("CONTENT-COUPLING: DEGRADED 源文件不可读（未扫 ≠ 通过，fail-closed）:")
        for e in READ_ERRORS[:10]:
            print(f"  - {e}")
        if len(READ_ERRORS) > 10:
            print(f"  …（其余 {len(READ_ERRORS) - 10} 条省略）")
        return 2

    cc3, cc3_notes, cc3_entries, n_top = scan_cc3()
    cc4, n_top4 = scan_cc4()

    if PRINT_BASELINE:
        print(CC_BASELINE_BEGIN)
        for path, kinds in sorted(cc1.items()):
            print(f"CC1 {path} t={len(kinds['type'])} v={len(kinds['value'])}")
        for path, kinds in sorted(cc2.items()):
            print(f"CC2 {path} t={len(kinds['type'])} v={len(kinds['value'])}")
        print(CC_BASELINE_END)
        return 0

    new1, tot1, stale1, _ = ratchet("CC1", cc1)
    new2, tot2, stale2, _ = ratchet("CC2", cc2)
    new_all = new1 + new2 + [(f"CC3 NEW {k} — {r}") for k, r in cc3] + [(f"CC4 NEW {k} — {r}") for k, r in cc4]
    stale_all = stale1 + stale2
    stock_all = tot1 + tot2
    v1 = sum(len(k["type"]) for k in cc1.values())
    v1v = sum(len(k["value"]) for k in cc1.values())
    v2 = sum(len(k["type"]) for k in cc2.values())
    v2v = sum(len(k["value"]) for k in cc2.values())

    print("═══ 内容面耦合门禁 CC1–CC4（issue #196 / K12-13 · 规范 §3.5）═══")
    print(f"模式: {MODE}"
          f"（local=只报数｜SYNO_CI=1 ⇒ 基线外新增硬阻断｜CC_STRICT=1 ⇒ 任意违规硬阻断）")
    print(f"扫描面: {os.path.relpath(EXT, ROOT)}/ {n_ext} 个 .ts｜{os.path.relpath(SRC, ROOT)}/ {n_src} 个 .ts"
          f"｜registry {os.path.relpath(REG, ROOT)}（{len(cc3_entries)} 个登记 type）")
    print()
    print(f"CC1 方向: extensions 越界 import —— 违规 {len(cc1)} 文件 / {v1} type ＋ {v1v} 值"
          f"（棘轮内 {tot1}｜新增 {len(new1)}）")
    print(f"CC2 对称: src 从 extensions 取 type/值 —— 违规 {len(cc2)} 文件 / {v2} type ＋ {v2v} 值"
          f"（棘轮内 {tot2}｜新增 {len(new2)}）")
    print(f"CC3 可达: 顶层 manifest {n_top} 个 —— 违规 {len(cc3)}")
    print(f"CC4 结构: 顶层目录 {n_top4} 个 —— 违规 {len(cc4)}")
    print(f"汇总: 存量 {stock_all} 条（棘轮内）｜新增 {len(new_all)} 条｜基线待下调 {len(stale_all)} 条")
    print()

    for cc3note in [n for n in cc3_notes if isinstance(n, str)]:
        print(cc3note)
    if cc3_notes[1]:
        print(f"NOTE CC3(advisory): 另有 {cc3_notes[1]} 个顶层 manifest 的 entryPoint 仅单口径可解析"
              f"（历史两口径破损）——#1465 已把 entryPoint 降为纯文档，真源=content-registry ⇒ 只报不判红")
    if new_all:
        print("── 新增违规（基线外）──")
        for line in new_all:
            print(f"  {line}")
    if stale_all:
        print("── 基线待下调（STALE，不判红）──")
        for line in stale_all[:5]:
            print(f"  {line}")
        if len(stale_all) > 5:
            print(f"  …（其余 {len(stale_all) - 5} 条省略；完整清单用 --print-baseline 对照）")
    if stock_all and not new_all:
        print(f"NOTE: {stock_all} 条为 CC-BASELINE 段登记的存量（只减不增）；迁移进展见 memory/notes 与 K12 卡线。")

    if new_all and MODE in ("ci", "strict"):
        print(f"CONTENT-COUPLING: VIOLATION new={len(new_all)}")
        return 1
    if stock_all and MODE == "strict":
        print(f"CONTENT-COUPLING: VIOLATION new={len(new_all)} stock={stock_all}（STRICT：存量亦判红）")
        return 1
    # 🔴 local 模式：契约是「只报数、不判红」（exit 0 不变）——但**不许假报 0**。
    #   修因（K12 第5批实测）: 原实现无论有无新增都打印 `OK（新增 0 …）` ⇒ local 模式下新增
    #   违规**只体现在上方逐条清单**，末行与退出码都显示"零新增"。后果：pre-commit 接入点以
    #   rc 判分支 ⇒ 本地**一个字都不印**（实测：造 `src → extensions` 取值违规，pre-commit
    #   输出零提及）⇒ 「存量只告警、新增必拦」的**告警面在本地也不存在**，接入形同虚设。
    #   注: 这是**报告缺陷**，不是判据变更——CI/STRICT 的判红逻辑（上方两分支）一字未动。
    if new_all:
        print(f"CONTENT-COUPLING: 新增 {len(new_all)}（local 只报数不判红｜存量 {stock_all} 条在棘轮内"
              f"｜CI 上同一条会硬阻断）")
        print("  ⚠️ 请核上方「新增违规（基线外）」清单；CI(SYNO_CI=1) 对该新增 exit 1。")
        return 0
    print(f"CONTENT-COUPLING: OK（新增 0｜存量 {stock_all} 条在棘轮内）")
    return 0


sys.exit(main())
PYEOF

# ═══════════════════════════════════════════════════════════════════════════════
# §接入方案（**已于 K12 第5批 / #340 执行**；下方记实际落点，与预案的差异逐条注明）
#
# ① CI —— 已接（与预案名/位置略异，注明如下）
#    实际：step「**①c 内容面耦合 CC1–CC4**」插在 ①b 看板真值 **之后**、② 架构边界**之前**
#      （预案写「② 之后、名 ②b」；改为紧随 ①②①b 同族的附加门禁，序号连续）。
#      run: cd /Users/wane/.ci-work/SynovaAgent
#           PATH="…/nvm/…/bin:$PATH" bash scripts/check-content-coupling.sh || exit 1
#    ⚠️ **不加 SYNO_CI=1**：本门禁的 CI 硬阻断位是**自己实现的**（`MODE=ci` 由 SYNO_CI 推导），
#       但 `|| exit 1` 已保证"门禁非 0 ⇒ 该步红"，与 CI 里 ①b 看板真值的写法一致；多注入一个
#       变量只会多一处口径。**更不加 CC_STRICT**（那会把存量 237 条也判红 = 违反「存量只告警」）。
#    效果：存量棘轮内绿；新增内容钻引擎 / 引擎取内容 type·值 / 内容类型未登记 / 顶层缺 manifest ⇒ 该步红。
#
# ② pre-commit —— **已接**（预案写"不进本地阻断位"，本卡按 CTO 卡面「先 pre-commit 再 CI」执行）
#    实际落点：本文件末尾「结果汇总」**之前**的附加检查块（与 D782/D734 同模式，不并入 13 组编号）。
#    本地 = v5_soft 软提示（点名新增 file:line）｜CI(SYNO_CI=1) = v5_soft 转硬阻断。
#    ⚠️ 判分支按**新增数**（取末行 `CONTENT-COUPLING:` 的「新增 N」），不是按 exit code ——
#       本门禁 local 模式契约就是 exit 0，只看 rc ⇒ 本地一字不印（实测踩过）。
#
# ③ 测试 —— 未接 CI 增量面（与预案一致）
#    夹具 `bash tests/control-tower/content-coupling.test.sh` 自足（<5s），当前仍**手工/CI 外**触发。
#    🔴 既有约束（非本卡引入）: 若 GitHub 侧 ci.yml 恢复运行，Gate Integrity 的 REGISTRY-BASELINE
#       （B 模式）会把"未登记的 *.test.sh"计为违规 ⇒ 届时需把本测试登记进 ci.yml 密封清单
#       （该文件属 CTO/治理域，本卡不动）。
#
# ④ 为什么不进 pre-commit 本地**阻断**位:
#    规范 §3.5 ＋ DSH 借鉴项「只在 CI 权威」；且 v2.5 教训（38 项 pre-commit ⇒ --no-verify 泛滥）。
#    本地要自查时手跑本脚本即可（默认模式只报数不阻断）。
# ═══════════════════════════════════════════════════════════════════════════════
