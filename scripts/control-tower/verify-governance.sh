#!/bin/bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true  # swallow-ok: 语言环境设不上不改判定（本件输出为 UTF-8 字面量，非本地化文本）
# ═══════════════════════════════════════════════════════════════════════════════
# verify-governance.sh — 门禁治理一键验收「总闸」：G2 遥测 ／ G6 退出码归一 ／ G10 同形字 ／ G11 配额双闸（#1122 · #1147 余项 B2）
#
# 设计哲学（一句）: **判不了就说判不了，绝不显示 PASS** —— 每道判据只有三种结论
#   PASS ／ FAIL ／ SKIP；「看不见」（遥测日志缺失、清单缺失、子判据自身坏）一律 SKIP
#   或 exit 2，禁把"没跑/没数据/看不懂"洗成绿。
#
# 背景（#1122 / 规格 §4「一键验收（机器判据）」· Step 1 ＋ #1147 余项 B2）:
#   规格 §4 列 G1–G10 十项；#1122 只做三项（G2/G6/G10），其余留后续卡；#1147 余项 B2 补 G11（配额双闸）——
#   G11 是**旁路项**（只在总闸内判，不进 pre-commit 主路径）。
#   不做"数表全绿"式空转（长青块分型：回归锁＋缺口面板，见 scripts/control-tower/AGENTS.md 红线）。
#
# 契约（铁律 47）:
#   @usage  bash scripts/control-tower/verify-governance.sh [--telemetry <path>] [--days N] [--root <dir>]
#           bash scripts/control-tower/verify-governance.sh --help
#   @input  --telemetry <path>  遥测 JSONL 路径（默认 `<root>/.claude/gate-hits.log`；相对路径按 cwd 解析）
#           --days N            判定窗口天数（默认 7；**正整数**，非法 ⇒ E_USAGE）
#           --root <dir>        仓库根（默认 `git rev-parse --show-toplevel`；显式注入缝供配对测试）
#           必读件（缺任一件 ⇒ 判不了 ⇒ exit 2，禁当通过）:
#             <root>/docs/authority/GATE-INVENTORY.yaml   的 `classification:` 段（required 集合真源）
#             <root>/scripts/control-tower/gate-assert.sh （G6 归一的**唯一真源**，本件不自造第二套归还一）
#             <root>/scripts/control-tower/check-unicode-confusable.py（G10 扫描器）
#             <root>/scripts/control-tower/gen-gate-meta.sh（G11 配额的**唯一真源**；缺失 ⇒
#               G11 DEGRADED（E_GEN_MISSING）＋ 整体 exit 2 —— 在 G11 项内报，不做全局提前退出）
#           遥测行格式（唯一写入器 `gate-telemetry.sh`）:
#             {"time":"<ISO-8601>","gate":"<检查点名>","result":"hit|miss|warn|degraded",...}
#   @output stdout 逐项 `<G2|G6|G10|G11> <名称>: PASS|FAIL|SKIP`，逐项后跟证据行；
#           G11 的证据行 = 生成器 `--quota` 的 `QUOTA:` / `QUOTA-SRC:` / `QUOTA-OVER:` 原样转印（缩进）；
#           **末行恒为** `GOVERNANCE: x/4 PASS`（x = PASS 计数；总数恒为 4；SKIP/FAIL/判不了 不计入 x）。
#           stderr = 降级行 `degraded: <code> — <原因>`（只在 exit 2 前出现）
#   @exit   0 = 四项全 PASS
#           1 = **非全 PASS**（有 FAIL 或 SKIP；含"遥测未运行"这种真实缺口）
#           2 = **判不了／自身失败**（参数错／python 不可用／清单缺失或空／required 集合为空／
#               子判据脚本缺失（含 G11 生成器缺失 E_GEN_MISSING）／子判据自身返回"判不了"）
#               —— 🔴 2 绝不等于通过
#   @degraded 任何 exit 2 一律先打 stderr `degraded: <code> — <原因>`（铁律 11/32，不静默降级）；
#           G11 的 E_GEN_MISSING / E_QUOTA_SCOPE 等在 G11 项内以 `判不了:` 行点名，并计入「判不了」⇒ 整体 exit 2；
#           不写任何降级日志文件（本件**只读仓库**，不新增运行期落盘）
#   @error  code ∈ {E_USAGE, E_NO_PYTHON, E_INV_MISSING, E_INV_SECTION, E_INV_EMPTY, E_NO_REQUIRED,
#                   E_GA_MISSING, E_UNI_MISSING, E_GEN_MISSING, E_G10_UNJUDGED, E_INTERNAL}
#
# 四道判据（判据语义以本段为准；改判据须引卡号）:
#   G2  遥测 ran=true（规格 §4 G2）
#       对 `classification:` 段里 `required_ci: true` 的**每个** `entrypoint`，判近 N 天是否
#       ≥1 条"真跑过"的记录。gate 名取 entrypoint 的确定性别名集：完整路径 ／ 文件名（含扩展名）／
#       去扩展名 stem（精确相等，大小写敏感）。result ∈ {hit,miss,warn,degraded} 视为 ran。
#       · 日志不存在 / 为空 / 全为损坏行  ⇒ **SKIP**，且 required 全部计入「未运行」（**不得显示 PASS**）
#       · 有数据但某些 required 一条记录都没有 ⇒ **FAIL**（并逐条点名「未运行」）
#       · required_ci: true 条目为 0（信号量 0）⇒ 判不了 ⇒ exit 2
#   G6  退出码归一（规格 §4 G6；复用 gate-assert.sh 的 `ga_run`，禁自造第二套归一）
#       用 `ga_run` 跑一个**注入判据**，本项结论 **= 该判据经 ga_run 归一后的结论**（0 通过 ⇒ PASS；
#       1 真红 / 2 判据故障 ⇒ FAIL）。默认注入 `exit 0`（干净路径可跑）；配对测试在沙箱
#       （`SYNO_TEST_ARM=1`）下注入 `exit 128`，此时**必须** G6=FAIL 且整体非 0 ——
#       那只可能是"`ga_run` 把 128 归成 2（判据故障）"，若归一表被改成 128→0，该用例即红。
#       本件**不做任何"原始码 → 三态"的二次映射**：只读 `ga_run` 的返回值与它打出的点名行。
#   G10 同形字两态（规格 §4 G10）
#       调 `check-unicode-confusable.py` 两夹具（临时 git 仓，`--staged` 口径）:
#         夹具甲 = 标识符内混西里尔 `а`（U+0430）冒充 ASCII a ⇒ 必须 rc=1 且汇总 VIOLATION
#         夹具乙 = 注释内全角标点（U+FF08/U+FF0C 等）        ⇒ 必须 rc=0 且汇总 PASS
#       **两态都对**才 PASS；任一态错 ⇒ FAIL；扫描器自身 rc=2（判不了）⇒ 本件 exit 2。
#   G11 配额双闸（#1147 余项 B2；**旁路项：只在总闸内判，不进 pre-commit 主路径**）
#       调 `<root>/scripts/control-tower/gen-gate-meta.sh --quota --root <root> --inv <root>/docs/authority/GATE-INVENTORY.yaml`:
#         rc=0 ⇒ PASS（三桶均未超）；rc=1 ⇒ **FAIL**（原样转印 `QUOTA:` / `QUOTA-OVER:` 证据行，禁改写数字）；
#         rc=2 或其它 ⇒ **DEGRADED**（判不了 ⇒ 整体 exit 2）；生成器缺失 ⇒ E_GEN_MISSING DEGRADED。
#       三桶口径 = 生成物 `gate_meta:` 段：non_doc≤30 ∧ total≤45 ∧ bypass≤8（bypass 不占 total）。
#       🔴 本项**不改写任何数字、不做第二套计数**：三桶与超编点名全部来自生成器的原始输出。
#
# 只读承诺: 不写仓库任何文件、不 git add/commit、不写日志；唯一落盘 = `mktemp -d` 下的临时夹具
#   （EXIT trap 清理）。
#
# 已知限制（做不到什么 —— 禁读成"已检测"）:
#   1. **G2 的 gate 名是"确定性别名"，不是语义映射**：现网遥测的 `gate` 是**检查点散文名**
#      （如 `Notes 迁移门禁 (D472)`），而 inventory 的 entrypoint 是脚本文件名 ⇒ 现网大多数
#      required 项会落「未运行」。这是**如实的方向**（遥测名与 inventory id 的对齐属 #1112 接线批次），
#      不是本件的漏判 —— 它宁可报"未运行"，也不把名字像的当跑过。
#   2. **G2 只证"跑过"，不证"有判别力"**：一条 miss 记录也只说明它执行了。判别力由各判据自己的
#      配对测试的改坏即红证明（CT-40），不由本件证明。
#   3. **G6 只证归一链路，不证业务判据的判别力**：本项结论 = 注入判据经 `ga_run` 的结论。
#      默认注入 `exit 0`（证链路可跑、码透传）；**故障注入（exit 128）由配对测试每次跑**，
#      它证明"非白名单码不被洗成通过"，不证明任何业务判据能发现它该发现的问题。
#   4. **G10 只验两态，不是全档**：乙夹具只证明"注释内全角标点不阻断"（D 档不误伤），
#      不覆盖 B 档（双向控制符）/ C 档（U+FFFD）；那两档由 check-unicode-confusable 的
#      `--selfcheck` 与配对测试证明。
#   5. **`--days` 窗口按 UTC 当前时刻截断**：日志时间戳无时区时按 UTC 解释（与 gate-stats 同口径）；
#      跨时区主机上"边界那一天"可能差一条，属可接受的窗口抖动。
#   6. **不判遥测日志是否被 .gitignore 忽略**（规格 §4 G2 的该子句留给后续卡）：本批最小可跑，
#      只判"required 项是否真跑过"。
#   7. **SYNO_GOV_G6_RC 注入缝只在沙箱可用**：需同时置 `SYNO_TEST_ARM=1`（仓内既有沙箱标记，
#      见 scripts/pre-commit-check.sh 的 `_SANDBOX`）；否则一律按 `exit 0` 注入 ⇒
#      "改一个环境变量就跳过 G6"不成立。若真的只改本件不跑测试，G6 仍恒绿 ——
#      这正是"改坏即红"必须靠配对测试承重的原因（T4/T5/T6 三个用例）。
#   8. **G11 只报生成物数字**：`--quota` 读 `gate_meta:` 段（artifact 快照），不重算 run_by；
#      手改 artifact 的对账防伪由 `gen-gate-meta.sh --check`（B3 同源比对）与
#      `check-gate-inventory.sh` 的 R10 承担，**不是本件**。G11 不进 pre-commit 主路径（旁路项）。
#   9. **G11 的 bypass 桶当前无标记源**：生成器只统计 artifact 已标 `quota_scope: bypass` 的行，
#      现网为 0 ⇒ bypass=0 只能读成"artifact 未标旁路"，**禁读成"没有旁路"**（前向能力）。
#
# 结构（Source map）:
#   段                职责
#   ────────────────  ───────────────────────────────────────────────────────────
#   ① 头部契约        本段（@usage/@input/@output/@exit/@degraded/@error/已知限制）
#   ② 参数与注入缝    --telemetry/--days/--root/--help；非法 ⇒ exit 2
#   ③ 解释器与必读件  PYBIN 三级探测；三件全局必读件缺失 ⇒ exit 2（判不了）；G11 生成器在 G11 项内判
#   ④ G2 遥测         python 单进程解析 inventory ＋ JSONL（别名匹配 ＋ 窗口过滤 ＋ 坏行计数）
#   ⑤ G6 归一          source gate-assert.sh ＋ `ga_run` 注入判据（默认 exit 0；沙箱可注入 128）
#   ⑥ G10 同形字      两个临时 git 仓夹具 ＋ 扫描器两态判定
#   ⑦ G11 配额双闸    gen-gate-meta.sh --quota 三态 → PASS/FAIL/DEGRADED（证据行原样转印，缺生成器 ⇒ SKIP）
#   ⑧ 汇总与退出口    末行 `GOVERNANCE: x/4 PASS` ＋ 三态退出码
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# ── ② 参数与注入缝 ────────────────────────────────────────────────────────────
GOV_ROOT_ARG=""
GOV_TEL_ARG=""
GOV_DAYS_ARG=""
GOV_USAGE_ERR=""

_gov_usage() {
  cat <<'USAGE'
用法: bash scripts/control-tower/verify-governance.sh [--telemetry <path>] [--days N] [--root <dir>]

  --telemetry <path>  遥测 JSONL 路径（默认 <root>/.claude/gate-hits.log）
  --days N            判定窗口天数（默认 7；正整数）
  --root <dir>        仓库根（默认 git rev-parse --show-toplevel；显式注入缝供配对测试）
  --help              打印本契约

输出: 逐项 <G2|G6|G10|G11> <名称>: PASS|FAIL|SKIP ＋ 末行 `GOVERNANCE: x/4 PASS`
退出码: 0 = 四项全 PASS ｜ 1 = 非全 PASS（有 FAIL 或 SKIP）｜ 2 = 判不了（禁当通过）
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --telemetry)
      if [ $# -lt 2 ]; then GOV_USAGE_ERR="--telemetry 需要参数 <path>"; break; fi
      GOV_TEL_ARG="$2"; shift 2 ;;
    --days)
      if [ $# -lt 2 ]; then GOV_USAGE_ERR="--days 需要参数 N"; break; fi
      GOV_DAYS_ARG="$2"; shift 2 ;;
    --root)
      if [ $# -lt 2 ]; then GOV_USAGE_ERR="--root 需要参数 <dir>"; break; fi
      GOV_ROOT_ARG="$2"; shift 2 ;;
    -h|--help)
      _gov_usage; exit 0 ;;
    *)
      GOV_USAGE_ERR="未知参数: $1"; break ;;
  esac
done

# ── ③ 解释器与必读件 ──────────────────────────────────────────────────────────
GOV_ROOT=""
if [ -n "$GOV_ROOT_ARG" ]; then
  GOV_ROOT="$GOV_ROOT_ARG"
else
  GOV_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || GOV_ROOT=""  # swallow-ok: 失败由下一行显式 E_USAGE（判不了，禁当通过）
fi

# 降级出口：stderr 一行 ＋ exit 2（本件不写仓库，故不落降级日志文件）
_gov_degrade() { # $1=code $2=原因
  printf 'degraded: %s — %s\n' "$1" "$2" >&2
  printf 'GOVERNANCE: 0/4 PASS\n'
  printf '判不了: %s — %s\n' "$1" "$2"
  exit 2
}

if [ -n "$GOV_USAGE_ERR" ]; then
  _gov_degrade "E_USAGE" "${GOV_USAGE_ERR}（见 --help）"
fi
if [ -z "$GOV_ROOT" ]; then
  _gov_degrade "E_USAGE" "非 git 仓库且未给 --root"
fi
if [ ! -d "$GOV_ROOT" ]; then
  _gov_degrade "E_USAGE" "root 不是目录: ${GOV_ROOT}"
fi

GOV_DAYS="${GOV_DAYS_ARG:-7}"
case "$GOV_DAYS" in
  ''|*[!0-9]*) _gov_degrade "E_USAGE" "--days 只接受正整数，实测: ${GOV_DAYS}" ;;
esac
if [ "$GOV_DAYS" -le 0 ]; then
  _gov_degrade "E_USAGE" "--days 需为正整数，实测: ${GOV_DAYS}"
fi

if [ -n "$GOV_TEL_ARG" ]; then
  GOV_TEL="$GOV_TEL_ARG"
else
  GOV_TEL="$GOV_ROOT/.claude/gate-hits.log"
fi

# D520/PLATFORM-CHECKLIST #1: 禁裸 python3（只做 command -v 探测 = bash 内建，不 spawn；
# 可用性由首次真实调用承担——它若坏，G2/G10 会 fail-closed 归 2，绝不静默成 0）
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（本行含 PYBIN 标记供 D520 平台扫描识别）
  if command -v "$_c" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || _gov_degrade "E_NO_PYTHON" "python3/python/py 均不在 PATH（G2 需解析 JSONL/YAML）"

GOV_INV="$GOV_ROOT/docs/authority/GATE-INVENTORY.yaml"
GOV_GA="$GOV_ROOT/scripts/control-tower/gate-assert.sh"
GOV_UNI="$GOV_ROOT/scripts/control-tower/check-unicode-confusable.py"
GOV_GEN="$GOV_ROOT/scripts/control-tower/gen-gate-meta.sh"

[ -f "$GOV_INV" ] || _gov_degrade "E_INV_MISSING" "清单不存在: ${GOV_INV}（required 集合不可解析 ⇒ 判不了）"
[ -f "$GOV_GA" ] || _gov_degrade "E_GA_MISSING" "gate-assert.sh 不存在: ${GOV_GA}（G6 无归一真源 ⇒ 判不了）"
[ -f "$GOV_UNI" ] || _gov_degrade "E_UNI_MISSING" "check-unicode-confusable.py 不存在: ${GOV_UNI}（G10 无扫描器 ⇒ 判不了）"
# G11 生成器**不在**这里全局退出：缺失要在 G11 项内报 DEGRADED（E_GEN_MISSING），
# 但整体仍必须 exit 2 —— 判不了禁当通过（见 _gov_g11 与末段汇总）。

GOV_PASS=0
GOV_FAIL=0
GOV_SKIP=0
GOV_DEGRADED=0
GOV_TMPD="$(mktemp -d)"
# shellcheck disable=SC2064
trap 'rm -rf "$GOV_TMPD"' EXIT

# ── ④ G2 遥测 ran=true ────────────────────────────────────────────────────────
_gov_g2() {
  local inv="$1" tel="$2" days="$3" out="" rc=0
  out="$("$PYBIN" - "$inv" "$tel" "$days" <<'PYEOF'
import json
import re
import sys
from datetime import datetime, timedelta, timezone

inv_path, tel_path, days_s = sys.argv[1], sys.argv[2], int(sys.argv[3])
cutoff = datetime.now(timezone.utc) - timedelta(days=days_s)
RAN = ("hit", "miss", "warn", "degraded")


def emit(state, detail, unrun=(), warn=""):
    """统一出口：state ∈ PASS|FAIL|SKIP|DEGRADED；DEGRADED 由 bash 侧折成 exit 2。

    行尾强制 LF：Windows 上 text 模式 stdout 会把 \\n 翻成 \\r\\n，调用方按行前缀解析时
    `state` 会尾随一个 \\r（实测：G2 被误判 DEGRADED）。这是 D313/D732 同类平台坑。
    """
    try:
        sys.stdout.reconfigure(newline="\n")
    except (AttributeError, ValueError):
        pass
    print("G2-STATE: %s" % state)
    print("G2-DETAIL: %s" % detail)
    for item in unrun:
        print("G2-UNRUN: %s" % item)
    if warn:
        print("G2-WARN: %s" % warn)
    sys.exit(0)


# ── inventory 的 classification 段（解析口径与 check-gate-inventory.sh 同源）──
try:
    with open(inv_path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
except OSError as exc:
    emit("DEGRADED", "E_INV_MISSING 清单不可读: %s (%s)" % (inv_path, exc))

start = next((i for i, ln in enumerate(lines) if re.match(r"^classification:\s*$", ln)), None)
if start is None:
    emit("DEGRADED", "E_INV_SECTION 清单无 classification: 段（信号量 0）")
block = []
for ln in lines[start + 1:]:
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*:", ln):
        break
    block.append(ln)

entries, cur = [], None
for ln in block:
    m = re.match(r"^\s+-\s+id:\s*(.*)$", ln)
    if m:
        cur = {"id": m.group(1).strip().strip('"')}
        entries.append(cur)
        continue
    m = re.match(r"^\s+([A-Za-z_]+):\s*(.*)$", ln)
    if m and cur is not None:
        cur[m.group(1)] = m.group(2).strip().strip('"')

if not entries:
    emit("DEGRADED", "E_INV_EMPTY classification 段零条目（信号量 0 ⇒ 判不了）")

required = [e for e in entries
            if str(e.get("required_ci", "")).strip().lower() == "true" and e.get("entrypoint")]
if not required:
    emit("DEGRADED", "E_NO_REQUIRED required_ci: true 条目为 0（信号量 0 ⇒ 判不了）")


def aliases(entrypoint):
    """entrypoint → 确定性 gate 名别名集（完整路径／文件名／去扩展名 stem）。"""
    ep = entrypoint.replace("\\", "/")
    base = ep.rsplit("/", 1)[-1]
    stem = base.rsplit(".", 1)[0] if "." in base else base
    return {ep, base, stem}


# ── 遥测 JSONL（坏行只跳过并计数，绝不中断、绝不静默）──
records = []
bad = 0
log_state = "ok"
try:
    fh = open(tel_path, encoding="utf-8", errors="replace")
except OSError:
    log_state = "missing"
else:
    with fh:
        for raw in fh:
            line = raw.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                stamp = datetime.fromisoformat(str(rec["time"]).replace("Z", "+00:00"))
                if stamp.tzinfo is None:
                    stamp = stamp.replace(tzinfo=timezone.utc)
                gate = str(rec.get("gate", "")).strip()
                result = str(rec.get("result", "")).strip().lower()
                if not gate or result not in RAN:
                    raise ValueError("字段不合规")
                records.append((stamp, gate))
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                bad += 1

warn = ""
if bad:
    warn = "遥测坏行 %d 条已跳过并计数（不中断判定）" % bad

if log_state == "missing":
    emit("SKIP", "遥测日志不存在: %s（required %d 项全部计入未运行）" % (tel_path, len(required)),
         ["%s %s（未运行）" % (e["id"], e["entrypoint"]) for e in required], warn)

if not records:
    emit("SKIP", "遥测日志无有效记录（损坏行 %d；required %d 项全部计入未运行）" % (bad, len(required)),
         ["%s %s（未运行）" % (e["id"], e["entrypoint"]) for e in required], "")

in_window = [(t, g) for (t, g) in records if t >= cutoff]
by_gate = {}
for _t, g in in_window:
    by_gate[g] = by_gate.get(g, 0) + 1

unrun = []
for e in required:
    if not any(g in aliases(e["entrypoint"]) for g in by_gate):
        unrun.append("%s %s（未运行）" % (e["id"], e["entrypoint"]))

if unrun:
    emit("FAIL", "required %d 项中 %d 项在窗口 %d 天内零记录（有效记录 %d 条／窗口内 %d 条）"
         % (len(required), len(unrun), days_s, len(records), len(in_window)), unrun, warn)

emit("PASS", "required %d 项全部 ≥1 条 ran 记录（窗口 %d 天，有效记录 %d 条／窗口内 %d 条）"
     % (len(required), days_s, len(records), len(in_window)), (), warn)
PYEOF
)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'G2 遥测 ran=true: SKIP\n'
    printf '    判不了: G2 解析器异常（rc=%d）\n' "$rc"
    GOV_G2_STATE="DEGRADED"
    return 0
  fi

  local state="" detail="" unrun_lines="" warn_line="" line
  # 行尾归一（防御侧）：子进程在 Windows 上可能吐 CRLF ⇒ 逐行解析前先剥 CR（D313/D732 同类平台坑）
  out="${out//$'\r'/}"
  # bash 内建解析（禁 sed/cut 子进程：Windows 上每次 spawn 数十毫秒，本件一次运行要跑十几遍）
  while IFS= read -r line; do
    case "$line" in
      "G2-STATE: "*)  state="${line#G2-STATE: }" ;;
      "G2-DETAIL: "*) detail="${line#G2-DETAIL: }" ;;
      "G2-UNRUN: "*)  unrun_lines="${unrun_lines}    · ${line#G2-UNRUN: }
" ;;
      "G2-WARN: "*)   warn_line="${line#G2-WARN: }" ;;
    esac
  done <<< "$out"

  case "$state" in
    PASS|FAIL|SKIP) : ;;
    DEGRADED)      state="DEGRADED" ;;
    *)             state="DEGRADED"; detail="G2 解析器输出不可识别（state=${state:-<空>}）" ;;
  esac

  GOV_G2_STATE="$state"
  printf 'G2 遥测 ran=true: %s\n' "$state"
  printf '    %s\n' "$detail"
  [ -n "$unrun_lines" ] && printf '%s\n' "$unrun_lines"
  [ -n "$warn_line" ] && printf '    %s\n' "$warn_line"
  return 0
}

# ── ⑤ G6 退出码归一（唯一真源 = gate-assert.sh 的 ga_run）────────────────────
_gov_g6() {
  local ga="$1" injected="0" rc=0 errfile="$GOV_TMPD/g6.stderr"
  # 注入缝：只在沙箱（SYNO_TEST_ARM=1）下接受 SYNO_GOV_G6_RC；否则恒按 0（干净路径）注入
  if [ "${SYNO_TEST_ARM:-}" = "1" ] && [ -n "${SYNO_GOV_G6_RC:-}" ]; then
    case "${SYNO_GOV_G6_RC}" in
      ''|*[!0-9]*) injected="0" ;;
      *)           injected="${SYNO_GOV_G6_RC}" ;;
    esac
  fi

  # shellcheck disable=SC1090
  . "$ga"  # 只取库函数（ga_run）；入口分支（BASH_SOURCE == $0）不会在 source 时触发
  if ! declare -F ga_run >/dev/null 2>&1; then
    GOV_G6_STATE="DEGRADED"
    printf 'G6 退出码归一: SKIP\n'
    printf '    判不了: gate-assert.sh 未提供 ga_run（函数不存在）\n'
    return 0
  fi

  ga_run "verify-governance/G6-注入判据" -- bash -c "exit ${injected}" 2>"$errfile"
  rc=$?

  # 本项结论 = 注入判据经 ga_run 归一后的结论（0 ⇒ PASS；1/2 ⇒ FAIL）。
  # 不做第二张归一表：1 与 2 的区分只在**证据行**里呈现，不改变本项红/绿。
  local verdict=""
  case "$rc" in
    0) verdict="PASS" ;;
    1) verdict="FAIL" ;;
    2) verdict="FAIL" ;;
    *) verdict="FAIL" ;;   # ga_run 契约只返回 0/1/2；其它值按判据故障从重（禁当通过）
  esac

  GOV_G6_STATE="$verdict"
  printf 'G6 退出码归一: %s\n' "$verdict"
  case "$rc" in
    0) printf '    注入 exit %s ⇒ ga_run 结论 0（通过）；原始码=0（码原样透传）\n' "$injected" ;;
    1) printf '    注入 exit %s ⇒ ga_run 结论 1（真红）⇒ 该判据计 FAIL；原始码=1\n' "$injected" ;;
    2) printf '    注入 exit %s ⇒ ga_run 结论 2（判据故障／自身失败）⇒ 该判据计 FAIL（故障绝不当通过）\n' "$injected" ;;
    *) printf '    注入 exit %s ⇒ ga_run 返回 %s（契约外返回值，按判据故障从重）\n' "$injected" "$rc" ;;
  esac
  # ga_run 的点名行原样上屏（证据留档：`判据故障: 128 — ...`）
  while IFS= read -r line; do
    [ -n "$line" ] && printf '    │ %s\n' "$line"
  done < "$errfile"
  return 0
}

# ── ⑥ G10 同形字两态 ─────────────────────────────────────────────────────────
# 一个夹具仓服两态（`git init` 在 Windows 上是百毫秒级开销，本件一次运行只付一次）
_gov_g10_init() { # $1 = 夹具仓目录
  local dir="$1"
  mkdir -p "$dir/src"
  git -C "$dir" init -q 2>/dev/null || true  # swallow-ok: init 失败会在后续 add/rc 上暴露（本函数按"态不符"判红）
}

_gov_g10_case() { # $1 = 夹具仓目录 $2 = 夹具文件内容 ; stdout = "<rc> <汇总词>"（bash 内建解析，不 spawn sed/cut）
  local dir="$1" body="$2" out="" rc=0 word="<无汇总行>"
  printf '%s\n' "$body" > "$dir/src/fixture.ts"
  git -C "$dir" add -A 2>/dev/null || true  # swallow-ok: add 失败 ⇒ 扫描器看到空变更集并打 SKIP，本函数按"态不符"判红

  out="$("$PYBIN" "$GOV_UNI" --root "$dir" --staged 2>&1)"
  rc=$?
  case "$out" in
    *"UNICODE-CONFUSABLE: VIOLATION"*) word="VIOLATION" ;;
    *"UNICODE-CONFUSABLE: PASS"*)      word="PASS" ;;
    *"UNICODE-CONFUSABLE: SKIP"*)      word="SKIP" ;;
  esac
  printf '%s %s\n' "$rc" "$word"
}

_gov_g10() {
  local cyr fw_lp fw_rp fw_co a_res b_res a_rc a_word b_rc b_word fixdir="$GOV_TMPD/g10"
  # 危险字符用字节转义生成：本文件自身不落同形字/全角标点字面（对齐 #1108 的测试纪律）
  cyr="$(printf '\xd0\xb0')"        # U+0430 CYRILLIC SMALL LETTER A（形似 ASCII a）
  fw_lp="$(printf '\xef\xbc\x88')"  # U+FF08 FULLWIDTH LEFT PARENTHESIS
  fw_rp="$(printf '\xef\xbc\x89')"  # U+FF09 FULLWIDTH RIGHT PARENTHESIS
  fw_co="$(printf '\xef\xbc\x8c')"  # U+FF0C FULLWIDTH COMMA
  _gov_g10_init "$fixdir"

  a_res="$(_gov_g10_case "$fixdir" "const p${cyr}ssword = 1;")"
  b_res="$(_gov_g10_case "$fixdir" "const ok = 1; // 中文注释${fw_lp}全角标点${fw_co}不阻断${fw_rp}")"
  a_rc="${a_res%% *}"; a_word="${a_res#* }"
  b_rc="${b_res%% *}"; b_word="${b_res#* }"

  # 子判据自身"判不了"（rc=2）⇒ 本件 exit 2；两态不符 ⇒ FAIL
  if [ "$a_rc" = "2" ] || [ "$b_rc" = "2" ]; then
    GOV_G10_STATE="DEGRADED"
    printf 'G10 同形字两态: SKIP\n'
    printf '    判不了: 扫描器自身 exit 2（甲 rc=%s ／ 乙 rc=%s）\n' "$a_rc" "$b_rc"
    return 0
  fi

  local ok_all=1
  [ "$a_rc" = "1" ] && [ "$a_word" = "VIOLATION" ] || ok_all=0
  [ "$b_rc" = "0" ] && [ "$b_word" = "PASS" ] || ok_all=0

  if [ "$ok_all" = "1" ]; then
    GOV_G10_STATE="PASS"
    printf 'G10 同形字两态: PASS\n'
  else
    GOV_G10_STATE="FAIL"
    printf 'G10 同形字两态: FAIL\n'
  fi
  printf '    甲 西里尔标识符夹具: rc=%s 汇总=%s（期望 rc=1 ／ VIOLATION）%s\n' \
    "$a_rc" "$a_word" "$([ "$a_rc" = "1" ] && [ "$a_word" = "VIOLATION" ] && printf ' ✓' || printf ' ✗')"
  printf '    乙 注释全角标点夹具: rc=%s 汇总=%s（期望 rc=0 ／ PASS）%s\n' \
    "$b_rc" "$b_word" "$([ "$b_rc" = "0" ] && [ "$b_word" = "PASS" ] && printf ' ✓' || printf ' ✗')"
  return 0
}

# ── ⑦ G11 配额双闸（#1147 余项 B2；旁路项：只在总闸内判，不进 pre-commit 主路径）──
# 判据结果**不做二次映射**：PASS/FAIL 直接取生成器 rc=0/1；rc=2 或其它 ⇒ DEGRADED（整体 exit 2）。
# 证据行（QUOTA / QUOTA-SRC / QUOTA-OVER）**原样转印**，禁在 bash 侧重算或改写数字。
# 生成器缺失 ⇒ G11=SKIP（E_GEN_MISSING）＋ 计入「判不了」⇒ 整体 exit 2（判不了禁当通过）。
_gov_g11() { # $1=生成器路径 $2=root $3=inventory
  local gen="$1" root="$2" inv="$3" out="" rc=0 line
  if [ ! -f "$gen" ]; then
    GOV_G11_STATE="DEGRADED"
    printf 'G11 配额双闸: SKIP\n'
    printf '    判不了: E_GEN_MISSING 生成器不存在: %s（G11 无配额判据真源 ⇒ 判不了）\n' "$gen"
    return 0
  fi
  out="$(bash "$gen" --quota --root "$root" --inv "$inv" 2>&1)"
  rc=$?
  out="${out//$'\r'/}"   # 防御侧：子进程可能吐 CRLF（D313/D732 同类平台坑）
  case "$rc" in
    0) GOV_G11_STATE="PASS"; printf 'G11 配额双闸: PASS\n' ;;
    1) GOV_G11_STATE="FAIL"; printf 'G11 配额双闸: FAIL\n' ;;
    *) GOV_G11_STATE="DEGRADED"
       printf 'G11 配额双闸: SKIP\n'
       printf '    判不了: gen-gate-meta.sh --quota rc=%s（判不了 ≠ 通过）\n' "$rc" ;;
  esac
  # 证据行原样转印（缩进 4 空格；只认生成器契约里的行前缀，不臆造）
  while IFS= read -r line; do
    case "$line" in
      QUOTA:*|QUOTA-SRC:*|QUOTA-OVER:*|GATE-META:*)
        printf '    %s\n' "$line" ;;
      degraded:*|判不了:*)
        printf '    %s\n' "$line" ;;
      *) : ;;
    esac
  done <<< "$out"
  return 0
}

# ── ⑧ 执行与汇总 ─────────────────────────────────────────────────────────────
printf '门禁治理一键验收（G2/G6/G10/G11 · 规格 §4 · #1122 / #1147 余项 B2）\n'
printf 'root: %s\n' "$GOV_ROOT"
printf '遥测: %s（窗口 %s 天）\n' "$GOV_TEL" "$GOV_DAYS"
printf '\n'

GOV_G2_STATE=""; GOV_G6_STATE=""; GOV_G10_STATE=""; GOV_G11_STATE=""
_gov_g2 "$GOV_INV" "$GOV_TEL" "$GOV_DAYS"
printf '\n'
_gov_g6 "$GOV_GA"
printf '\n'
_gov_g10
printf '\n'
_gov_g11 "$GOV_GEN" "$GOV_ROOT" "$GOV_INV"
printf '\n'

for _state in "$GOV_G2_STATE" "$GOV_G6_STATE" "$GOV_G10_STATE" "$GOV_G11_STATE"; do
  case "$_state" in
    PASS)     GOV_PASS=$((GOV_PASS + 1)) ;;
    FAIL)     GOV_FAIL=$((GOV_FAIL + 1)) ;;
    SKIP)     GOV_SKIP=$((GOV_SKIP + 1)) ;;
    DEGRADED) GOV_DEGRADED=$((GOV_DEGRADED + 1)) ;;
    *)        GOV_DEGRADED=$((GOV_DEGRADED + 1)) ;;
  esac
done

GOV_TOTAL=$((GOV_PASS + GOV_FAIL + GOV_SKIP + GOV_DEGRADED))
printf '小结: PASS %d ／ FAIL %d ／ SKIP %d ／ 判不了 %d（共 %d 项）\n' \
  "$GOV_PASS" "$GOV_FAIL" "$GOV_SKIP" "$GOV_DEGRADED" "$GOV_TOTAL"
printf 'GOVERNANCE: %d/%d PASS\n' "$GOV_PASS" "$GOV_TOTAL"

if [ "$GOV_DEGRADED" -gt 0 ]; then
  printf 'degraded: 有 %d 项判不了（禁当通过）\n' "$GOV_DEGRADED" >&2
  exit 2
fi
if [ "$GOV_PASS" -eq "$GOV_TOTAL" ]; then
  exit 0
fi
exit 1
