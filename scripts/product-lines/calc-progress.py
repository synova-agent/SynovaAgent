#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
calc-progress.py — 产品进度计算器（设计 v1.4 §三/§五；A1 证据失效检测 + A4 进度重算）

一句话: 读 product-lines.yaml + 证据记录 → 按 §3.4 六态状态机算每条线进度 → product-progress.json。

契约:
  @input  — docs/synova/product-lines/product-lines.yaml（单一事实源）
            docs/synova/product-lines/evidence/*.json（证据记录，schema=1）
            docs/synova/product-lines/cockpit-override.yaml（待裁决清单，A8 源；缺失→degraded）
            docs/synova/project/26线-V1验收标准*.md（D850 新增，**只读一处**：取「证据」列
              = pending_wiring 的撤回标记，用于三档中的「写了没接」档；见文件头 D850 段。
              缺文件 → 该档 count=null + reason + degraded 登记，绝不猜 0）
            git 事实: git log --since=<证据日期> --name-only -- <线 modules>（A1 惰性失效）
  @output — docs/synova/product-lines/product-progress.json
            { generated_at, version, total_lines, lines_v1, lines_v2,
              buckets:{...},  # D850 顶层三档（每档带可复现命令；**无任何百分比字段**）
              deprecated_fields:{progress_pct: 原因},
              lines:[{id,name,progress_pct,progress_pct_deprecated,buckets,verified,total,
              baseline_pct, status_counts:{...}, k3_gate, points:[{id,desc,status,evidence_files,
              stale_reason}] }], decisions:[...], degraded:{...} }
  @degraded — yaml 解析失败 → log.error + exit 2（fail-closed，绝不静默猜）；
              单条证据记录损坏 → log.warn + 跳过该记录 + degraded.sources 登记（铁律 24/31）；
              V1 断言表缺失/不可读 → log.warn + 「写了没接」档置 null + degraded.sources 登记；
              git 不可用 → log.warn + 跳过失效检测 + degraded.git=true；
              ENOENT（证据目录尚不存在）= 正常默认（铁律 24），不告警不 degraded。
  @exit   — 0 成功；2 降级/失败（calc 本身不可用）

D850 口径变更（创始人 2026-09-20 裁定；权威 `docs/authority/产品完成度定义与推进总纲-20260918.md` §1.2
+ `docs/synova/coordination/验收标准-穿真实入口-v1-20260918.md` §二 + `方案-项目度量-从声明驱动到事实驱动.md`
§四/§六）：**取消顶层百分数口径**（旧顶层进度字段已删除），改**三档离散计数**
（healthy / written_not_wired / missing + 显式其它态），每档带可复现命令；无法判定的档显式
`count: null` + 原因（禁猜 0）。线级 `progress_pct` **仅因兼容 win 域消费方**（`dsh/plugins/
synova-dashboards`、`dsh/plugins/task-board-adapter`）而保留，已标 deprecated，新消费方一律读 `buckets`。

六态状态机（§3.4）:
  uncommitted  ⚪ 未开始（git 无 / 无证据 / yaml 种子 uncommitted）
  failed       🔴 机器验证红（场景/测试证据 fail，或 yaml 种子 failed）
  pending_k3   🟡 待裁判（场景/测试绿但审计员未审——不计分）
  verified     🟢 已验证（审计员 pass 或创始人演示核验——计分）
  rejected     🔴 存疑/否决（审计员 fail——不计分，git 全绿也不算）
  stale        🟡 待重跑（证据过期 >14 天，或证据日期后相关代码有变更，A1）

诚实规则（§3.3 硬逻辑）:
  1. 无证据 = 未验证 = 不计分（yaml 里 status: verified 若无对应证据记录 → 降为 uncommitted 并告警）
  2. 场景/测试类证据: 日期后该线 modules 有 git 变更 → stale（自动失效，不继承旧绿）
  3. 线 100% 门槛: verified==total 且无 k3 线级复核（record_type=k3, acceptance_point="line:<id>", pass）
     → 进度封顶 99 + k3_gate="待审计员全量复核"（防最后 10% 烂尾）
     【D850 说明】该门槛仍生效，但只影响已 deprecated 的线级 `progress_pct`；三档口径下线级
     `k3_gate` 只作为 `buckets.healthy` 的旁注（健康数本身不依赖它）
  4. 百分比只显整数
     【D850 说明】第 4 条**已废止**：顶层百分比字段删除；线级 `progress_pct` 为兼容 win 域消费方
     保留并标 deprecated（见文件头 D850 段）。
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

# 兼容: 直接运行时从仓库任意目录也能定位；测试可 sys.path.insert 本目录后 import
try:
    import productline_yaml  # noqa: E402
except ImportError:  # pragma: no cover
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import productline_yaml  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("calc-progress")

# 兼容: 直接运行时从仓库任意目录也能定位
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

EVIDENCE_TTL_DAYS = 14  # 场景/测试类证据有效期（§3.2）

SIX_STATES = ("uncommitted", "failed", "pending_k3", "verified", "rejected", "stale")

# ── D850: 离散三档（取消顶层百分数口径）────────────────────────────
# 权威（引用必须全名 + 版本）:
#   ① `docs/authority/产品完成度定义与推进总纲-20260918.md` §1.2（v1，2026-09-18）
#      「共同报告方式：`N 个健康 / M 个写了没接 / K 个缺` —— **离散计数，不是百分比**」
#   ② `docs/synova/coordination/验收标准-穿真实入口-v1-20260918.md` §二（v1.1，2026-09-19）
#   ③ `/Users/wane/山河研究院/99-综合/方案-项目度量-从声明驱动到事实驱动.md` §四（「每个数字必须带
#      一条可复现的命令。不能复现的数字，不上看板」）+ §六（静态检测实测 3/5=60%，不能当判定源）
# 创始人签字: `docs/synova/coordination/创始人裁定表-§6五项-20260920.md`（D850 = 离散健康计数）
BUCKETS_SCHEMA = "discrete-health-buckets/1"
BUCKETS_AUTHORITY = (
    "docs/authority/产品完成度定义与推进总纲-20260918.md §1.2（v1，2026-09-18）"
    " + docs/synova/coordination/验收标准-穿真实入口-v1-20260918.md §二（v1.1，2026-09-19）"
    " + 方案-项目度量-从声明驱动到事实驱动.md §四/§六（创始人授权引用）"
)

# D809 撤回标记（不是证据类型，是「点亮已撤回、等接线」的显式声明）——三档中「写了没接」的唯一源
WITHDRAWAL_KIND = "pending_wiring"
V1_DOD_GLOB = "docs/synova/project/26线-V1验收标准*.md"
# 本器派生物（仓库相对路径，跨平台）
BUCKETS_ARTIFACT = "docs/synova/product-lines/product-progress.json"
# 件级一次源侧重算的落点（evidence_cmd 的比对基准；缺失即 fail-closed 报错）
BUCKETS_TMP = "/tmp/ro-pp.json"

# ⓓ-1/ⓓ-4 命令语义（**件内 schema 级说明**，不只写在 docstring）：
#   词义不可互顶 —— 「每个数字那条命令」只能是**源侧重算**；读回派生物另有其名，且明文声明它不承担可证伪职责。
CMD_SEMANTICS = {
    "evidence_cmd": ("**源侧重算**（本档「那条命令」）：从权威输入（product-lines.yaml / 证据记录 / "
                     "V1 断言表 / git 事实）重算该档同一个值，并与已提交派生件该档比对；"
                     "对不上 → 断言失败并打印档路径；缺中间件 → fail-closed 报错。"
                     "禁止读回已提交派生物充当本字段（读回自己的输出不构成证据）。"),
    "artifact_selfcheck_cmd": ("**派生物侧自查**（毫秒级）：读回**已提交**派生物该档取值，核对"
                               "「看板显示的数字 == 提交件里的数字」。**不承担可证伪职责**"
                               "（源侧错它也错）→ **不占用**「每个数字那条命令」的位置。"),
    "regenerate_cmd": ("**件级一次源侧重算** → %s（--today 固定为产出该件那天，便于与提交件逐档比对；"
                       "要看今天的新鲜读数请省略 --today）。evidence_cmd 依赖此件，必须先跑。" % BUCKETS_TMP),
    "source_probe_cmd": "只服务 null 档：复现「为什么没有数字」（判定源缺席 = SOURCE_ABSENT）。",
    "independent_check_cmd": ("不读管线的**独立判据**；kind ∈ equality（独立复现同一数字）/ "
                              "reconciliation（两源对账，**不一致即报警**，需人工裁决）/ "
                              "bound（必要条件上界：看板值不得超过证据面覆盖点）。"),
    "reproducibility_strength": {
        "本件": ("源侧重算 + 逐档与提交件比对（fail-closed）；重算一次实测 1.5–12.7s（随机器负载），"
                 "故按「一次重算 + 203 次比对」摊薄。"),
        "与账本件的差异": ("ledger.json 各档 evidence_cmd 直接读源、单档毫秒级、无需中间件；"
                           "本件因六态状态机（TTL + git 失效检测）无法内联表达，故走中间件比对。"),
    },
}

# 「写了没接」档的 evidence_cmd = **独立源侧扫描**（不重跑本器、不读派生物）
_WITHDRAWN_CMD = """python3 - written_not_wired <<'PY'
import glob, re, sys
rows = [[c.strip() for c in l.strip().strip('|').split('|')]
        for l in open(sorted(glob.glob('docs/synova/project/26线-V1验收标准*.md'))[-1], encoding='utf-8')
        if re.match(r'^\\|\\s*\\d+-\\d+\\s*\\|', l)]
print('written_not_wired=%d' % sum(1 for r in rows if len(r) >= 5 and r[3] == 'pending_wiring'))
PY"""

# 「缺」档的判定源存在性探针（证明 null 的根据 = 无 implemented 机器可读源）
_MISSING_PROBE_CMD = """python3 - implemented <<'PY'
import glob, re, sys
name = sys.argv[1]
hits = []
for f in (sorted(glob.glob('docs/synova/product-lines/*.yaml'))
          + sorted(glob.glob('docs/synova/product-lines/evidence/*.json'))):
    try:
        txt = open(f, encoding='utf-8').read()
    except OSError:
        continue
    if re.search(r'(?m)^\\s*"?%s"?\\s*:' % name, txt):
        hits.append(f)
print('%s=%s' % (name, 'SOURCE_PRESENT' if hits else 'SOURCE_ABSENT'))
PY"""


def _seg_suffix(segments):
    return "".join("[%s]" % repr(s) for s in tuple(segments) + ("count",))


def _path_label(segments, line_id=None):
    base = "buckets" if line_id is None else "lines[id=%s].buckets" % line_id
    return base + "." + ".".join(segments) + ".count"


def regenerate_cmd(today_str):
    """件级一次源侧重算命令（--today 固定为产出该件那天，保证与提交件可逐档比对）。"""
    return ("python3 scripts/product-lines/calc-progress.py --out %s --today %s"
            % (BUCKETS_TMP, today_str or "<产出该件的日期 YYYY-MM-DD>"))


def source_recompute_cmd(field, segments, line_id=None):
    """evidence_cmd = **源侧重算该档 + 与已提交派生件逐档比对**（ⓓ-2 指定形态）。

    @input  — field:str（档名）；segments:tuple[str,...]（逐段路径，含 'buckets'）
              line_id:int|str|None（非 None = 线级：按线 id 定位）
    @output — str，形态:
              `python3 -c "…assert fresh[<path>] == committed[<path>], '<path> mismatch'"`，
              通过时打印 `<field>=<值>`；不通过时打印 **档路径 + 两值** 并以非零退出。
    @contract — 三条硬约束（ⓓ-1/ⓓ-2）:
                ① 重算自**权威输入**（经 regenerate_cmd 产出的 %s），**不读回提交件充当证据**；
                ② `%s` **缺失 → fail-closed 报错**，绝不静默回退读提交件；
                ③ 比对失败必须**打印档路径**（否则只看输出不知哪一档错）。
    """ % (BUCKETS_TMP, BUCKETS_TMP)
    seg = _seg_suffix(segments)
    if line_id is None:
        af, ac = "f" + seg, "k" + seg
    else:
        af = "next(l for l in f['lines'] if str(l['id']) == %s)" % repr(str(line_id)) + seg
        ac = "next(l for l in k['lines'] if str(l['id']) == %s)" % repr(str(line_id)) + seg
    label = _path_label(segments, line_id)
    py = (
        "import json,os,sys;"
        "p='" + BUCKETS_TMP + "';c='" + BUCKETS_ARTIFACT + "';"
        "sys.exit('FAIL-CLOSED: 缺 ' + p + ' —— 先跑 regenerate_cmd 源侧重算；不得读回提交件') "
        "if not os.path.exists(p) else None;"
        "f=json.load(open(p,encoding='utf-8'));k=json.load(open(c,encoding='utf-8'));"
        "a=" + af + ";b=" + ac + ";"
        "sys.exit('MISMATCH " + label + ": fresh=' + repr(a) + ' committed=' + repr(b) + "
        "' —— 源侧与提交件不一致，请重生成派生件') if a != b else None;"
        "print('" + field + "=' + str(a))"
    )
    return 'python3 -c "' + py + '"'


def artifact_drill_cmd(field, segments, line_id=None):
    """artifact_selfcheck_cmd = 从**已提交派生物**复现该档取值的命令（毫秒级自查，每档必有）。

    ⓓ-1 改名说明：本命令**不是**「每个数字那条命令」（那是 `evidence_cmd` = 源侧重算）；

    @input  — field:str（档名；命令输出 `<field>=<值>`，null 打印 `None`）
              segments:tuple[str,...]（**逐段**下钻路径，从顶层对象起算；
                        如 ('buckets','other_states','live_unverified')）
              line_id:int|str|None（非 None = 线级：先按线 id 定位该线，再下钻 segments）
    @output — str（可直接交给 bash -c 的命令；**必 rc=0** 且值 == 派生物里的 count）
    @contract — V-1 修复（退回单实测 144/203 条 rc≠0），两条硬约束:
                ① **禁止把点分路径当单键** —— 复盘 `d['buckets']['other_states.live_unverified']`
                   必然 KeyError；必须逐段 `d['buckets']['other_states']['live_unverified']`
                ② **线级禁止 `lines[]` 占位** —— 必须按线 id 定位具体线
                   （`next(l for l in d['lines'] if str(l['id'])==<id>)`）
                语义边界（诚实声明）：本命令复现的是「该数字在**派生物**中的取值」；
                派生物本身的**源侧重生成**命令见 `buckets.regenerate_cmd`（一次派生全件）；
                不读派生件的**独立核对**见 `independent_check_cmd`（有则给）。
                之所以不逐档重跑本器：单次派生实测 ~1.4s × 203 档 ≈ 5 分钟，
                看板命令与测试都不可用（可复现 ≠ 可等待）。
    """
    if line_id is not None:
        expr = "next(l for l in d['lines'] if str(l['id']) == %s)" % repr(str(line_id))
    else:
        expr = "d"
    # 逐段下钻到该档的 **count**（segments 以档名为末段，故再补一段 'count'）
    expr += "".join("[%s]" % repr(s) for s in tuple(segments) + ("count",))
    return ("python3 -c \"import json;d=json.load(open('%s',encoding='utf-8'));v=%s;"
            "print('%s=' + str(v))\"" % (BUCKETS_ARTIFACT, expr, field))



# ⓓ-3 线级独立判据（线级恰是创始人第一眼看的粒度，原为零独立判据）：
#   ① written_not_wired = **两源对账**（V1 断言表该线撤回行 vs 提交件该线值）——
#      **不一致即报警**（非零退出 + 打印两源数值 + 明说「需人工裁决，不是自动判错」），不是「必须相等」；
#   ② healthy = **必要条件上界**（看板 healthy 不得超过该线点集的证据面 k3 PASS 覆盖点数）——
#      独立直接读 yaml + 证据记录，不经管线。
_LINE_RECONCILE_TMPL = """python3 - {line_id} <<'PY'
import glob, json, re, sys
lid = sys.argv[1]
rows = [[c.strip() for c in l.strip().strip('|').split('|')]
        for l in open(sorted(glob.glob('docs/synova/project/26线-V1验收标准*.md'))[-1], encoding='utf-8')
        if re.match(r'^\\|\\s*\\d+-\\d+\\s*\\|', l)]
src_a = sum(1 for r in rows if len(r) >= 5 and r[3] == 'pending_wiring' and r[0].startswith(lid + '-'))
d = json.load(open('docs/synova/product-lines/product-progress.json', encoding='utf-8'))
b = next(l for l in d['lines'] if str(l['id']) == lid)['buckets']['written_not_wired']['count']
print('written_not_wired=%s' % ('None' if b is None else b))
if src_a != b:
    sys.exit('两源不一致(线 %s): V1断言表撤回行=%s vs 提交件=%s —— 需人工裁决，不是自动判错' % (lid, src_a, b))
print('RECONCILE=agree (V1断言表撤回行=%s)' % src_a)
PY"""

_LINE_HEALTHY_BOUND_TMPL = """python3 - {line_id} <<'PY'
import glob, importlib.util, json, sys
lid = sys.argv[1]
spec = importlib.util.spec_from_file_location('ply', 'scripts/product-lines/productline_yaml.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
y = m.load_file('docs/synova/product-lines/product-lines.yaml')
line = next(l for l in y['lines'] if str(l['id']) == lid)
ids = set(p['id'] for p in (line.get('acceptance_points') or []))
covered = set()
for d in ('docs/synova/product-lines/evidence', 'scripts/golden-scenarios/evidence'):
    for f in sorted(glob.glob(d + '/*.json')):
        try:
            rec = json.load(open(f, encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if not isinstance(rec, dict):
            continue
        for v in rec.get('verdicts') or []:
            if (isinstance(v, dict) and str(v.get('verdict', '')).lower() == 'pass'
                    and v.get('acceptance_point') in ids):
                covered.add(v['acceptance_point'])
pp = json.load(open('docs/synova/product-lines/product-progress.json', encoding='utf-8'))
h = next(l for l in pp['lines'] if str(l['id']) == lid)['buckets']['healthy']['count']
print('healthy=%s' % ('None' if h is None else h))
if h is not None and h > len(covered):
    sys.exit('BOUND VIOLATION 线 %s: 看板 healthy=%s > 证据面 k3 PASS 覆盖点=%s' % (lid, h, len(covered)))
print('BOUND=ok (healthy <= 证据面 k3 PASS 覆盖点=%s)' % len(covered))
PY"""

_MISSING_REASON = ("本仓无「implemented」机器可读源（yaml 与证据记录均无；而总纲 §1.2「缺」的"
                   "判定手段 = 代码检索，本口径禁用 grep 型静态判据）→ 显式 null，禁猜 0。"
                   "可复现依据 = 本档可复现命令输出 SOURCE_ABSENT")

_BUCKET_DEFS = {
    "healthy": ("总纲 §1.2「健康」（live && testedThroughEntry）的可判定代理：验收点六态 = verified"
                "（审计员 PASS 或创始人演示核验；机器绿但未审 ≠ 此档）"),
    "written_not_wired": ("总纲 §1.2「写了没接」（implemented=true, wired=false）：V1 断言表「证据」列"
                          "= pending_wiring 撤回标记（D809；显式声明，非 grep 静态判定）"),
    "missing": ("总纲 §1.2「缺」（implemented=false）：判定手段 = 代码检索；本口径禁用 grep 型静态判据"
                "（事实驱动 §六 实测 3/5=60%），且「无证据」≠「无实现」（诚实规则）"),
    "wired_broken": ("总纲 §1.2「接了跑不通」（wired=true, live=false）的可判定代理：六态 = failed"
                     "（机器验证红）或 rejected（审计员否决）——即该点被判定不成立"),
    "live_unverified": ("总纲 §1.2「能跑未验证」（live=true, testedThroughEntry=false）：六态 = pending_k3"
                        "（场景/测试绿但审计员未审）——单独成态，绝不并进健康"),
    "stale": ("六态 = stale（曾点亮但证据过期 >14 天，或证据日期后该线 modules 有代码变更）"
              "——五态之外的显式态，单列不并入任何档"),
    "state_unknown": ("残余：六态 = uncommitted（无证据 → 五态归属不可判定：缺 / 写了没接 / 接了跑不通"
                      "三选一，无机器可读源）；显式列出以闭合恒等式，不丢点"),
}


def build_buckets(status_counts, withdrawn_count, withdrawn_known, denominator,
                  line_id=None, today_str=None):
    """D850: 六态状态机 → **离散三档**（+ 显式其它态），每档带可复现命令；无法判定者 null + 原因。

    @input  — status_counts:dict[str,int]（六态计数，SIX_STATES 全键）
              withdrawn_count:int|None（本分母内的 D809 撤回点数；None = V1 断言表不可用）
              withdrawn_known:bool（撤回源是否可读）
              denominator:int|None（本口径的分母 = 验收点数；None = 未知）
              line_id:int|str|None（非 None = 线级 buckets；evidence_cmd 按**线 id** 定位具体线）
    @output — dict（schema discrete-health-buckets/1）：
                healthy / written_not_wired / missing（三档，互斥）
                + other_states{wired_broken, live_unverified, stale, state_unknown}
                + identity{expr, terms, null_terms, denominator, known_terms_sum, holds, note}
    @contract — 口径（照抄权威，不得自创）:
              healthy           ← 六态 verified
              written_not_wired ← V1 表撤回标记 ∩ 本分母的点（**优先级高于六态**：撤回是显式声明，
                                  比"无证据"更具体 → 从 state_unknown 中扣除，避免双计）
              missing           ← 判定手段 = 代码检索 → **null + 原因**（禁猜 0）
              wired_broken      ← failed + rejected
              live_unverified   ← pending_k3（能跑未验证；不得并进 healthy）
              stale             ← stale（显式单列）
              state_unknown     ← uncommitted − 撤回数
    @degraded — withdrawn_source 不可读 → written_not_wired/state_unknown = null + reason（禁猜 0）
    """
    verified = status_counts.get("verified", 0)
    failed = status_counts.get("failed", 0)
    rejected = status_counts.get("rejected", 0)
    pending = status_counts.get("pending_k3", 0)
    stale = status_counts.get("stale", 0)
    uncommitted = status_counts.get("uncommitted", 0)

    if not withdrawn_known:
        n_written = None
        n_unknown = None
        w_reason = ("撤回源不可读：D809 撤回标记只存在于 V1 断言表「证据」列"
                    "（docs/synova/project/26线-V1验收标准*.md）；该文件缺失/不可读 → "
                    "「写了没接」与残余均不可判定，显式 null，禁猜 0")
    else:
        n_written = withdrawn_count
        n_unknown = uncommitted - withdrawn_count
        w_reason = None

    def entry(count, definition, source, segments, reason=None, independent=None,
              probe=None, ind_kind=None):
        """一档 = 值 + 口径 + **可复现命令**（V-1: 逐段下钻 + 线 id 定位）。

        @input  — segments:tuple[str,...] 从顶层起的**逐段**路径（含 'buckets'）
                  independent:str|None 不读派生件、**独立复现同一个数字**的命令（有则给）
                  probe:str|None 证明该档「无机器可读判定源」的命令（用于显式 null 的档；
                        它**不**复现数字，只复现「为什么没有数字」——两者语义不可混用）
        """
        return {
            "count": count,
            # 「每个数字那条命令」= 源侧重算 + 与提交件比对（ⓓ-1/ⓓ-2）
            "evidence_cmd": source_recompute_cmd(segments[-1], segments, line_id),
            "cmd_kind": "source_recompute",
            # 毫秒级读回自查（**不**承担可证伪职责，不得占用上面那条的位置）
            "artifact_selfcheck_cmd": artifact_drill_cmd(segments[-1], segments, line_id),
            "independent_check_cmd": independent,
            "independent_check_kind": ind_kind,
            "source_probe_cmd": probe,
            "definition": definition,
            "source": source,
            "reason": reason,
        }

    def seg(*parts):
        return ("buckets",) + tuple(parts)

    # 独立复现（numeric）只给**顶层 written_not_wired**：线级的独立扫描需按线过滤 V1 表行，
    # 与「线点集 ∩ 撤回集」的口径可能因 yaml/V1 表不同步而分歧 → 不给（宁缺勿造）。
    # 「判定源存在性探针」只给 missing（显式 null 的那一档）——它复现的是「为什么没有数字」。
    # 顶层: written_not_wired = 独立 equality（V1 表全表扫描，直接复现同一数字）
    # 线级: written_not_wired = reconciliation（两源对账）；healthy = bound（必要条件上界）
    if line_id is None:
        ind_withdrawn, ind_withdrawn_kind = _WITHDRAWN_CMD, "equality"
        ind_healthy, ind_healthy_kind = None, None
    else:
        ind_withdrawn = _LINE_RECONCILE_TMPL.replace("{line_id}", str(line_id))
        ind_withdrawn_kind = "reconciliation"
        ind_healthy = _LINE_HEALTHY_BOUND_TMPL.replace("{line_id}", str(line_id))
        ind_healthy_kind = "bound"
    probe_missing = _MISSING_PROBE_CMD if line_id is None else None
    buckets = {
        "schema": BUCKETS_SCHEMA,
        "authority": BUCKETS_AUTHORITY,
        "granularity": "acceptance_point(product-lines.yaml)",
        "denominator": denominator,
        "regenerate_cmd": regenerate_cmd(today_str),
        "cmd_semantics": CMD_SEMANTICS,
        "denominator_note": ("与 `docs/synova/project/ledger.json` 的 totals.buckets 分母不同"
                             "（此处 = product-lines.yaml 验收点数；账本 = V1 断言表条数）——"
                             "同名档不可跨件混读，各档自带 denominator"),
        "healthy": entry(
            verified, _BUCKET_DEFS["healthy"],
            "证据记录（六态状态机出口 verified）", seg("healthy"),
            independent=ind_healthy, ind_kind=ind_healthy_kind),
        "written_not_wired": entry(
            n_written, _BUCKET_DEFS["written_not_wired"],
            "V1 断言表「证据」列 = pending_wiring（D809 撤回标记）",
            seg("written_not_wired"), reason=w_reason,
            independent=ind_withdrawn, ind_kind=ind_withdrawn_kind),
        "missing": entry(
            None, _BUCKET_DEFS["missing"],
            "判定手段 = 代码检索（本口径禁用；事实驱动 §六 实测静态检测 3/5=60%）",
            seg("missing"), reason=_MISSING_REASON, probe=probe_missing,
        ),
        "other_states": {
            "wired_broken": entry(
                failed + rejected, _BUCKET_DEFS["wired_broken"],
                "证据记录（六态 failed + rejected）",
                seg("other_states", "wired_broken")),
            "live_unverified": entry(
                pending, _BUCKET_DEFS["live_unverified"],
                "证据记录（六态 pending_k3）",
                seg("other_states", "live_unverified")),
            "stale": entry(
                stale, _BUCKET_DEFS["stale"],
                "证据记录 + git（六态 stale）",
                seg("other_states", "stale")),
            "state_unknown": entry(
                n_unknown, _BUCKET_DEFS["state_unknown"],
                "product-lines.yaml 验收点 − 撤回集（六态 uncommitted）",
                seg("other_states", "state_unknown"), reason=w_reason),
        },
    }
    terms = {
        "healthy": buckets["healthy"]["count"],
        "written_not_wired": buckets["written_not_wired"]["count"],
        "missing": buckets["missing"]["count"],
        "wired_broken": buckets["other_states"]["wired_broken"]["count"],
        "live_unverified": buckets["other_states"]["live_unverified"]["count"],
        "stale": buckets["other_states"]["stale"]["count"],
        "state_unknown": buckets["other_states"]["state_unknown"]["count"],
    }
    known_sum = sum(v for v in terms.values() if v is not None)
    buckets["identity"] = {
        "expr": ("healthy + written_not_wired + missing + wired_broken + live_unverified "
                 "+ stale + state_unknown = 验收点总数（denominator）"),
        "terms": sorted(terms),
        "null_terms": sorted(k for k, v in terms.items() if v is None),
        "known_terms_sum": known_sum,
        "holds": (denominator is not None and known_sum == denominator),
        "note": ("null 档不参与求和（归属不可判定，禁猜 0）；state_unknown 是显式残余，"
                 "故恒等式永远闭合——任何验收点都不会被静默丢弃。"
                 "边界（队长 2026-09-20 裁定）：本恒等式**只保证完备性**"
                 "（丢点会显形为 state_unknown），**不保证各档归类正确**——归类正确性由"
                 "tests/project/calc-progress-panel.test.sh 与源侧独立核对命令负责；"
                 "它是自洽性检查，不是正确性证据"),
    }
    buckets["strict_source_absent"] = {
        "field": "testedThroughEntry / live / wired / implemented",
        "reason": ("总纲 §1.2 的**严格**五态（live && testedThroughEntry）无机器可读源（e2e 不在 CI，"
                   "第 0 项 P-3 未立项）。故 buckets.healthy 报的是六态 verified 口径的可判定代理，"
                   "不冒充严格健康数——数字与口径同时给出，读者可自行判定可信度"),
    }
    return buckets


def load_withdrawn_points(v1_dod_path):
    """D850: 读 V1 断言表「证据」列 = pending_wiring 的点集（D809 撤回标记）。

    @input  — v1_dod_path:Path|None（None = 未显式指定；调用方用 V1_DOD_GLOB 解析）
    @output — (points:set[str], error:str|None)
    @degraded — 文件缺失 / 不可读 / 零行解析 → (set(), 原因)；调用方置该档 null（**禁猜 0**）
    @contract — **只取一个字段**（撤回标记），不做任何交付度判定——判定仍归 gen-project-board.py；
                故本函数不构成「第二真相源」，只是把已冻结的 D809 标记接到看板上。
    """
    import glob as _glob
    path = Path(v1_dod_path) if v1_dod_path else None
    if path is None:
        found = sorted(_glob.glob(str(PROJECT_ROOT / V1_DOD_GLOB)))
        if not found:
            return set(), "V1 断言表缺失（未匹配 %s）" % V1_DOD_GLOB
        path = Path(found[-1])
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return set(), "V1 断言表缺失: %s" % path
    except OSError as e:
        return set(), "V1 断言表不可读: %s (%s)" % (path, e)
    points = set()
    rows = 0
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if len(cells) < 5 or not re.match(r"^\d+-\d+$", cells[0]):
            continue
        rows += 1
        if cells[3] == WITHDRAWAL_KIND:
            points.add(cells[0])
    if rows == 0:
        return set(), "V1 断言表零行解析（格式变更？）: %s" % path
    return points, None



def load_yaml(path: Path):
    """解析 yaml；失败抛 YamlSubsetError（调用方决定 exit 2 fail-closed）。"""
    return productline_yaml.load_file(str(path))


def load_evidence_records(evidence_dir: Path):
    """读取证据记录。返回 (records, degraded_sources)。ENOENT=正常默认。"""
    records = []
    degraded = []
    if not evidence_dir.is_dir():
        return records, degraded
    for f in sorted(evidence_dir.glob("*.json")):
        if f.name == ".gitkeep":
            continue
        try:
            with open(f, "r", encoding="utf-8") as fh:
                rec = json.load(fh)
            if rec.get("schema") != 1:
                raise ValueError("schema != 1")
            if "record_type" not in rec or "date" not in rec or "verdicts" not in rec:
                raise ValueError("缺 record_type/date/verdicts 字段")
            # D576（CT-53）: 存量降级——redeem-progress 曾把任务闭环兑换冒充 record_type=k3
            # （一票翻绿假绿，K3 D572 实证 1-2）。识别特征 = note 含「自动兑换（redeem-progress.py）」，
            # 降级为 task_redeem（走 machine 路径），不改历史文件（加载时修正）。
            if rec.get("record_type") == "k3" and "自动兑换（redeem-progress.py）" in str(rec.get("note", "")):
                rec["record_type"] = "task_redeem"
                degraded.append("%s: 存量自动兑换证据降级 k3→task_redeem（假 k3 冒充修正，CT-53）" % f.name)
            records.append((f, rec))
        except (OSError, ValueError, json.JSONDecodeError) as e:
            log.warning("证据记录损坏，跳过: %s (%s)", f, e)
            degraded.append("证据记录损坏: %s (%s)" % (f.name, e))
    return records, degraded


def git_touched_after(modules, since_date: str, git_cmd: str):
    """证据日期之后，该线 modules 是否有提交（A1 惰性失效）。

    @input  — modules: 路径列表; since_date: YYYY-MM-DD; git_cmd: git 可执行（测试可注入）
    @output — (touched: bool, error: str|None)。git 失败 → touched=False + error 显式返回
              （绝不把"查不了"当"没变过"——fail-closed，调用方转 degraded）
    """
    if not modules:
        return False, None
    # CT-62: 证据时间戳粒度——at 全量 ISO datetime 直接用（同日验证不被当日提交误杀）；
    # date-only（YYYY-MM-DD）保持旧语义 T00:00:00（保守：当日提交算 touched）
    since = since_date if "T" in since_date else since_date + "T00:00:00"
    cmd = [git_cmd, "log", "--since=%s" % since, "--name-only", "--format=", "--"] + list(modules)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30,
                              cwd=str(PROJECT_ROOT))
    except (OSError, subprocess.SubprocessError) as e:
        return False, "git 调用失败: %s" % e
    if proc.returncode != 0:
        return False, "git exit=%s: %s" % (proc.returncode, proc.stderr.strip()[:120])
    touched_files = {line.strip() for line in proc.stdout.splitlines() if line.strip()}
    if touched_files:
        return True, None
    return False, None


def freshness_gate(evidence_date, line_modules, git_cmd, today, pid, problems, evidence_at=None):
    """CT-55（D579）: 证据新鲜度门——k3 pass 与 machine 绿共用的失效判定。

    @input  — evidence_date: str YYYY-MM-DD（被检裁决/证据的日期）
              line_modules: list[str]（yaml 线级 modules，可空=映射缺失）
              git_cmd: str（测试可注入）; today: datetime
              pid: str（验收点 id，降级留痕用）; problems: list[str]（显式降级登记）
    @output — "fresh"   → 调用方落 verified（TTL 内 且 modules 无变更）
              "stale"  → 调用方落 stale（TTL 过期 或 证据日期后 modules 有变更）
              "unknown" → 调用方落 pending_k3 + 已登记 problem（日期非法 / git 不可用 /
                          modules 映射缺失——"无法判定新鲜" ≠ "判定过时"，不计分不假黄）
    @degraded — 日期非法 / git 调用失败 / 映射缺失 → problems 显式登记（铁律 24/31，不静默）
    @contract — TTL 复用 EVIDENCE_TTL_DAYS（L67）与 machine 路径同一比较语义（> N 天）；
                git 检测复用 git_touched_after（L106）；D572 G2 修复建议原文的机制化。
    """
    try:
        date_dt = datetime.strptime(evidence_date, "%Y-%m-%d")
    except ValueError:
        problems.append("点 %s 证据日期格式非法: %r" % (pid, evidence_date))
        return "unknown"
    if (today - date_dt).days > EVIDENCE_TTL_DAYS:
        return "stale"
    if not line_modules:
        problems.append("点 %s 线 modules 映射缺失，git 失效子检查未执行" % pid)
        return "unknown"
    # CT-62: at 时间戳优先（同日验证语义），缺省回退 date-only
    touched, err = git_touched_after(line_modules, evidence_at or evidence_date, git_cmd)
    if err:
        problems.append("点 %s 失效检测降级: %s" % (pid, err))
        return "unknown"
    if touched:
        return "stale"
    return "fresh"


def status_for_point(point, verdicts_by_point, line_modules, git_cmd, today, problems):
    """按六态状态机计算单个验收点的最终状态。"""
    pid = point["id"]
    verdicts = verdicts_by_point.get(pid, [])
    seed = point.get("status", "uncommitted")
    if seed not in SIX_STATES:
        problems.append("点 %s 非法 status 种子: %r" % (pid, seed))
        seed = "uncommitted"

    k3 = [v for v in verdicts if v["record_type"] == "k3" and not v.get("superseded_by")]
    demo = [v for v in verdicts if v["record_type"] == "founder_demo"]
    machine = [v for v in verdicts if v["record_type"] in ("scenario", "test", "ci", "task_redeem")]

    # D576（CT-53）: k3_only 点（desc 含「审计员复核」的每线收尾点）只有 k3 裁决能 verified——
    # 任务兑换/演示核验最高到 pending_k3（自我指认禁止，1-8 型，K3 D572 实证）。
    if point.get("k3_only"):
        if any(v["verdict"] == "fail" for v in k3):
            return "rejected"
        # D579（CT-55）: k3 pass 不再永久免疫失效检查——与 machine 类同语义。
        passes = [v for v in k3 if v["verdict"] == "pass"]
        if passes:
            latest = max(passes, key=lambda v: (v["date"], v.get("at") or ""))  # 最新 pass 裁决 governs 新鲜度
            gate = freshness_gate(latest["date"], line_modules, git_cmd, today, pid, problems, evidence_at=latest.get("at"))
            if gate == "stale":
                return "stale"
            if gate == "unknown":
                return "pending_k3"  # 降级语义见 spec §3.6 必答 1（自愈: git 恢复/映射补齐后回 verified）
            return "verified"
        return "pending_k3"

    # 审计员裁决最高优先（一票否决/一票通过）
    if any(v["verdict"] == "fail" for v in k3):
        return "rejected"
    # D579（CT-55）: 通用 k3 出口同构接线——pass 翻绿前必须过新鲜度门（D572 P1-1 闭环）。
    passes = [v for v in k3 if v["verdict"] == "pass"]
    if passes:
        latest = max(passes, key=lambda v: (v["date"], v.get("at") or ""))  # 最新 pass 裁决 governs 新鲜度
        gate = freshness_gate(latest["date"], line_modules, git_cmd, today, pid, problems, evidence_at=latest.get("at"))
        if gate == "stale":
            return "stale"
        if gate == "unknown":
            return "pending_k3"  # 降级语义见 spec §3.6 必答 1
        return "verified"

    # 创始人演示核验 = 里程碑证据
    if any(v["verdict"] == "pass" for v in demo):
        return "verified"

    if machine:
        # CT-62/D1055 ⑦: 与 passes 路径（:630/:645）同口径 —— 同日多份证据时用 at 决胜，
        #   缺省回退 date-only（既有语义不回归）。
        latest = max(machine, key=lambda v: (v["date"], v.get("at") or ""))
        if latest["verdict"] == "fail":
            return "failed"
        # 机器验证绿 → 待裁判；但先查失效（A1 + 14 天 TTL）
        try:
            date_dt = datetime.strptime(latest["date"], "%Y-%m-%d")
            if (today - date_dt).days > EVIDENCE_TTL_DAYS:
                return "stale"
        except ValueError:
            problems.append("点 %s 证据日期格式非法: %r" % (pid, latest["date"]))
            return "pending_k3"
        # D1055 ⑦ (欠账表「machine 路径不消费 at」) 修复: 旧实现恒用 date-only（=T00:00:00），
        #   当日生成的机器证据会被"当日提交"判成 touched ⇒ 误判 stale。改为 at 优先，
        #   与 :600 的 freshness_gate(evidence_at=...) 同语义；缺 at → 回退 date-only（不回归）。
        touched, err = git_touched_after(line_modules, latest.get("at") or latest["date"], git_cmd)
        if err:
            problems.append("点 %s 失效检测降级: %s" % (pid, err))
        if touched:
            return "stale"
        return "pending_k3"

    # 无证据: yaml 种子只允许 failed/rejected/uncommitted；verified 种子无证据 → 降级 + 告警
    if seed == "verified":
        problems.append("点 %s yaml 标 verified 但无证据记录——按诚实规则降为 uncommitted" % pid)
        return "uncommitted"
    if seed in ("failed", "rejected"):
        return seed
    return "uncommitted"


def compute(yaml_path, evidence_dir, override_path, git_cmd, out_path, v1_dod_path=None,
            today=None):
    spec = load_yaml(yaml_path)
    records, degraded_sources = load_evidence_records(evidence_dir)
    problems = []
    # 注入缝（同 gen-project-board.py 的 --today）：固定日期 → 输出确定（测试可重复 / 可与提交件比对）
    today = today or datetime.now()

    # D850: 撤回标记源（D809）——只读一处字段，用于三档中的「写了没接」档。
    # 缺失/不可读 → withdrawn_known=False → 该档与残余显式 null（**禁猜 0**）+ degraded 登记。
    withdrawn_points, withdrawn_err = load_withdrawn_points(v1_dod_path)
    withdrawn_known = withdrawn_err is None
    if withdrawn_err:
        log.warning("D850 撤回源不可读，「写了没接」档置 null（不静默）: %s", withdrawn_err)
        degraded_sources.append("D850 撤回标记源: %s" % withdrawn_err)

    # 证据索引: point id → verdict 列表
    verdicts_by_point = {}
    line_reviews = {}

    def _rel(f: Path) -> str:
        try:
            return str(f.relative_to(PROJECT_ROOT))
        except ValueError:
            return str(f)

    for f, rec in records:
        for v in rec.get("verdicts", []):
            ap = v.get("acceptance_point", "")
            if ap.startswith("line:"):
                line_reviews[ap.split(":", 1)[1]] = v
                continue
            verdicts_by_point.setdefault(ap, []).append({
                "record_type": rec["record_type"],
                "verdict": v.get("verdict"),
                "date": rec["date"],
                "record_path": _rel(f),
                "quote": v.get("quote", ""),
                "superseded_by": v.get("superseded_by"),
                "at": rec.get("at"),
            })

    # 待裁决清单（A8）
    decisions = []
    if override_path.is_file():
        try:
            ov = productline_yaml.load_file(str(override_path))
            decisions = ov.get("pending_decisions", []) or []
        except productline_yaml.YamlSubsetError as e:
            log.warning("cockpit-override.yaml 解析失败: %s", e)
            degraded_sources.append("cockpit-override.yaml 解析失败: %s" % e)
    else:
        degraded_sources.append("cockpit-override.yaml 不存在（待裁决区为空）")

    lines_out = []
    for line in spec.get("lines", []):
        points = line.get("acceptance_points", [])
        modules = line.get("modules", []) or []
        counts = {s: 0 for s in SIX_STATES}
        points_out = []
        for p in points:
            st = status_for_point(p, verdicts_by_point, modules, git_cmd, today, problems)
            counts[st] += 1
            evidence_files = [v["record_path"] for v in verdicts_by_point.get(p["id"], [])]
            points_out.append({
                "id": p["id"],
                "desc": p.get("desc", ""),
                "status": st,
                "evidence_files": evidence_files,
                "note": p.get("note", ""),
            })
        total = len(points)
        verified = counts["verified"]
        progress = round(verified / total * 100) if total else 0
        k3_gate = ""
        line_id = str(line["id"])
        if total and verified == total:
            review = line_reviews.get(line_id)
            if review and review.get("verdict") == "pass":
                k3_gate = "passed"
            else:
                progress = min(progress, 99)  # 线 100% 门槛（§3.3 规则 3）
                k3_gate = "pending"
        # D850: 线级三档（撤回标记按**本线点集**取交，故线级恒等式亦闭合）
        line_withdrawn = (len([p for p in points_out if p["id"] in withdrawn_points])
                          if withdrawn_known else 0)
        lines_out.append({
            "id": line["id"],
            "name": line.get("name", ""),
            "value": line.get("value", ""),
            "weight": float(line.get("weight", 1.0)),
            "baseline_pct": int(line.get("baseline_pct", 0)),
            "baseline_note": line.get("baseline_note", ""),
            "done_definition": line.get("done_definition", ""),
            "total": total,
            "verified": verified,
            # D850: 百分比口径已取消；本字段仅为兼容 win 域消费方而保留，**已 deprecated**
            "progress_pct": progress,
            # V-1 修复：线级 evidence_cmd 必须按**线 id** 定位（原用 `lines[]` 占位 → 全不可跑）
            "buckets": build_buckets(counts, line_withdrawn, withdrawn_known, total,
                                     line_id=line["id"],
                                     today_str=today.strftime("%Y-%m-%d")),
            "k3_gate": k3_gate,
            "status_counts": counts,
            "points": points_out,
        })

    # D850: 顶层三档（取代旧顶层加权百分数；分母 = 全部验收点数）
    status_totals = {s: 0 for s in SIX_STATES}
    for l in lines_out:
        for s in SIX_STATES:
            status_totals[s] += l["status_counts"][s]
    line_point_ids = {p["id"] for l in lines_out for p in l["points"]}
    withdrawn_total = (len(line_point_ids & withdrawn_points) if withdrawn_known else 0)
    points_total = sum(l["total"] for l in lines_out)
    top_buckets = build_buckets(status_totals, withdrawn_total, withdrawn_known, points_total,
                                today_str=today.strftime("%Y-%m-%d"))

    # 面板线数（D850 追平）: yaml `lines` 条数 + `v2_lines` 条数（v2 线定义在同文件顶层，
    # 不在 lines 列表内，故必须显式计入——否则面板停在 28 而总纲口径是 29）
    v2_lines = [n for n in (spec.get("v2_lines") or []) if isinstance(n, str)]

    result = {
        "generated_at": today.strftime("%Y-%m-%d %H:%M:%S"),
        "version": "1.1",
        "total_lines": len(lines_out) + len(v2_lines),
        "lines_v1": len(lines_out),
        "lines_v2": v2_lines,
        "buckets": top_buckets,
        "deprecated_fields": {
            "lines[].progress_pct": ("D850 取消百分比口径（创始人 2026-09-20 裁定）。保留仅为兼容 "
                                     "win 域消费方 dsh/plugins/synova-dashboards 与 "
                                     "dsh/plugins/task-board-adapter；新消费方一律读 buckets。"
                                     "旧顶层进度字段已删除（破坏性变更，见 PR 遗留清单）"),
        },
        "lines": lines_out,
        "decisions": decisions,
        "degraded": {
            "sources": degraded_sources,
            "problems": problems,
            "git_check": "ok",
        },
    }
    if problems:
        result["degraded"]["git_check"] = "partial"

    # 幂等: 仅 generated_at 变化 → 不重写（防 CI 每跑一次就产生一条噪音提交/bot PR）
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if out_path.is_file():
        try:
            old = json.loads(out_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            old = None
        if isinstance(old, dict):
            old_norm = dict(old)
            old_norm["generated_at"] = result["generated_at"]
            if json.dumps(old_norm, ensure_ascii=False, indent=2) == payload:
                log.info("进度无变化（仅时间戳），不重写（幂等）")
                return result

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(payload + "\n")
    return result


def main():
    ap = argparse.ArgumentParser(description="产品进度计算（A1+A4）")
    ap.add_argument("--yaml", default=str(PROJECT_ROOT / "docs/synova/product-lines/product-lines.yaml"))
    ap.add_argument("--evidence-dir", default=str(PROJECT_ROOT / "docs/synova/product-lines/evidence"))
    ap.add_argument("--override", default=str(PROJECT_ROOT / "docs/synova/product-lines/cockpit-override.yaml"))
    ap.add_argument("--out", default=str(PROJECT_ROOT / "docs/synova/product-lines/product-progress.json"))
    ap.add_argument("--git-cmd", default="git", help="测试注入: 指向伪造 git 脚本")
    # D850: 撤回标记源（D809）——只读「证据」列，供三档中的「写了没接」档
    ap.add_argument("--v1-dod", default=None,
                    help="V1 断言表（默认 glob %s；缺失 → 该档 null + degraded）" % V1_DOD_GLOB)
    # D850 ⓓ-5: 日期注入缝 —— 与 gen-project-board.py 的 --today 同语义（测试确定性 / 与提交件可比对）
    ap.add_argument("--today", default=None, help="覆盖\"今天\" YYYY-MM-DD（默认系统日期）")
    args = ap.parse_args()

    try:
        result = compute(Path(args.yaml), Path(args.evidence_dir), Path(args.override),
                         args.git_cmd, Path(args.out),
                         Path(args.v1_dod) if args.v1_dod else None,
                         today=(datetime.strptime(args.today, "%Y-%m-%d") if args.today else None))
    except productline_yaml.YamlSubsetError as e:
        log.error("YAML 解析失败: %s (retryable=%s) → exit 2（fail-closed，绝不静默）",
                  e, e.retryable)
        sys.exit(2)

    b = result["buckets"]
    log.info("三档离散（**无百分比**）: healthy=%s written_not_wired=%s missing=%s | "
             "live_unverified=%s wired_broken=%s stale=%s state_unknown=%s | "
             "线数 %s（v1 %s + v2 %s）| 待重跑 %s | 审计否决 %s",
             b["healthy"]["count"], b["written_not_wired"]["count"], b["missing"]["count"],
             b["other_states"]["live_unverified"]["count"],
             b["other_states"]["wired_broken"]["count"],
             b["other_states"]["stale"]["count"],
             b["other_states"]["state_unknown"]["count"],
             result["total_lines"], result["lines_v1"], len(result["lines_v2"]),
             b["other_states"]["stale"]["count"],
             sum(l["status_counts"]["rejected"] for l in result["lines"]))
    if result["degraded"]["sources"]:
        log.warning("degraded: %d 个数据源降级: %s", len(result["degraded"]["sources"]),
                    "; ".join(result["degraded"]["sources"][:3]))
    if result["degraded"]["problems"]:
        log.warning("degraded: 状态机问题 %d 处（详见 product-progress.json）",
                    len(result["degraded"]["problems"]))
    sys.exit(0)


if __name__ == "__main__":
    main()
