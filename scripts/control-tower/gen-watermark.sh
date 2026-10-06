#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gen-watermark.sh — D979 T3：号段水位生成器（从 task-state + 全分支反查，禁手写水位）
#
# 背景: `docs/synova/coordination/号段水位.md` 的水位原是**手写**的，2026-09-25 已发生一次
#   误用事故（CTO 用 alloc-task-id.sh 取到 D1003–D1006 落在 Win 段，被迫改号 D965–D968）。
#   本脚本把"水位"变成**可复算的生成物**：水位 = 该归属**段内**实际存在的最大 D#。
#
# 契约（铁律 47）:
#   @input   ROOT（git rev-parse --show-toplevel 或 --root）；task-state/D*.json（domain/owner/
#            executor）；git for-each-ref 分支名（本地 + 远端）；[--check] 校验模式
#   @output  docs/synova/coordination/号段/{README.md,Mac.md,Win.md,K3.md}（每归属一文件，内容确定性：
#            无时间戳/无主机名/无路径 ⇒ 同输入必同输出）+ stdout 摘要
#   @degraded 无可用 python（python3/python/py 全部缺失或损坏）→ 显式 degraded + exit 2；
#            task-state 目录缺失 → 显式 degraded + exit 2（绝不静默产出空水位）
#   三态退出码（ctrl-tower-change 模式 1）: 0=成功（--check: 与仓库逐字节一致）
#                                          1=--check 检出漂移或文件缺失（业务）
#                                          2=自身失败/降级（无 python / 无 task-state）
#
# 归属判定层级（防漂移口径，写进生成物）:
#   ① 显式归属: task-state 的 domain/owner/executor 含 mac|win|k3，或分支名含 `d<数字>` + 归属标记
#   ② 段回退: 无任何归属标记，但卡号落在某归属段内（Mac D9xx / Win D1000–D1099）→ 归该归属
#   ③ 都不适用 → 未归属（历史卡，只计数不入水位）
#   段外异常 = **显式归属与段冲突**（如显式 mac 却落在 D1000+）—— 只报事实，不改数
#
# 用法:
#   bash scripts/control-tower/gen-watermark.sh            # 重新生成（写盘）
#   bash scripts/control-tower/gen-watermark.sh --check    # 只校验，漂移 → exit 1
#   bash scripts/control-tower/gen-watermark.sh --root /tmp/fake   # 沙箱（测试用）
#
# 人工常量（**不含水位数字**）: 段约定与历史更正记录 —— 水位一律来自实测反查。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

MODE="write"
ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check" ;;
    --root) shift; ROOT="${1:-}" ;;
    *) echo "用法: gen-watermark.sh [--check] [--root <dir>]" >&2; exit 2 ;;
  esac
  shift
done
if [ -z "$ROOT" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"  # swallow-ok: 非 git 环境 → 退回 pwd（沙箱仍可跑）
fi
ROOT="${ROOT%/}"

# PYBIN 跨平台回退 + 可用性验证（对齐 commit-msg-check.sh / resolve-commit-brief.sh）
PYBIN=""
for _c in python3 python py; do  # D520/PYBIN 回退链（可用性探测，非裸 python3 调用）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then
    PYBIN="$_c"
    break
  fi
done
if [ -z "$PYBIN" ]; then
  echo "⚠ degraded: 无可用 PYBIN（python3/python/py 缺失或损坏）— 号段水位未生成（exit 2）" >&2  # D520
  exit 2
fi
if [ ! -d "$ROOT/task-state" ]; then
  echo "⚠ degraded: 缺 task-state 目录（$ROOT/task-state）— 无法反查水位（exit 2）" >&2
  exit 2
fi

OUT_DIR="$ROOT/docs/synova/coordination/号段"
RC=0
"$PYBIN" - "$ROOT" "$MODE" "$OUT_DIR" <<'PY' || RC=$?
# -*- coding: utf-8 -*-
"""号段水位生成核心（确定性输出；水位=实测最大 D#，禁手写常量）。"""
import json
import os
import re
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

root, mode, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]

# 段约定（人工常量 = 政策边界，非水位）：沿用 2026-09-25 CTO 更正记录
SEGMENTS = {
    "Mac": {"label": "D9xx", "lo": 900, "hi": 999},
    "Win": {"label": "D1000–D1099", "lo": 1000, "hi": 1099},
    "K3": {"label": "未定义（原始件只约定 Mac/Win 两段）", "lo": None, "hi": None},
}
ORDER = ["Mac", "Win", "K3"]
CORRECTION = [
    "## 2026-09-25 更正记录（CTO）",
    "- **误用**：CTO 用 `alloc-task-id.sh` 取号得到 **D1003–D1006**，落在 **Win 段（D1000–D1099）** ⇒ 违反自身分段约定。",
    "- **处置**：四卡**改号**为 **D965–D968**（Mac 段）；D1003–D1006 **作废释放**（Win 可继续使用）。",
    "- **根因**：`alloc-task-id.sh` 只递增**全局最大号**，不感知分段 ⇒ 跨段取号必须人工复核。",
    "- **水位**：Mac = **D968**（下一个 D969）｜Win = **D1002**（下一个 D1003，仍可用）。",
]

def did_of(name):
    """从文件名/分支名抽卡号：D### / D####（3–4 位）。
    边界规则：D 前须为非字母数字（^ 或 / - 等），数字后不得再跟数字
    ⇒ 8 位日期（如 `d20260926`）与描述性长数字不会被当卡号。"""
    m = re.search(r"(?:^|[^A-Za-z0-9])[Dd](\d{3,4})(?!\d)", name)
    return int(m.group(1)) if m else None

def attr_from_text(*vals):
    """domain/owner/executor/分支名 → 归属集合（mac|win|k3 关键词，大小写无关）。"""
    out = set()
    blob = " ".join(v for v in vals if isinstance(v, str)).lower()
    if "mac" in blob:
        out.add("Mac")
    if "win" in blob:
        out.add("Win")
    if "k3" in blob:
        out.add("K3")
    return out

def seg_of(d):
    """卡号落在哪个归属段内（无段 → None）。"""
    for k in ORDER:
        seg = SEGMENTS[k]
        if seg["lo"] is not None and seg["lo"] <= d <= seg["hi"]:
            return k
    return None

# ── 数据源 1: task-state/D*.json（显式归属）──
explicit = {}      # d# -> set(归属)
for fn in sorted(os.listdir(os.path.join(root, "task-state"))):
    if not fn.endswith(".json"):
        continue
    d = did_of(fn)
    if d is None:
        continue
    a = set()
    try:
        with open(os.path.join(root, "task-state", fn), encoding="utf-8", errors="replace") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            a = attr_from_text(data.get("domain"), data.get("owner"), data.get("executor"))
    except (ValueError, OSError):
        a = set()  # 坏 json: 卡号仍计入（文件名即证据），归属留空
    explicit.setdefault(d, set()).update(a)

# ── 数据源 2: 全分支名（显式归属；取首个 D#，描述性数字不参与）──
branches = []
try:
    proc = subprocess.run(["git", "-C", root, "for-each-ref", "--format=%(refname:short)",
                           "refs/heads", "refs/remotes"],
                          capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    if proc.returncode == 0:
        branches = [b for b in proc.stdout.split("\n") if b.strip()]
except (OSError, subprocess.SubprocessError):
    branches = []  # 非 git 沙箱：分支源为空（不阻断）
for br in branches:
    d = did_of(br)
    if d is None:
        continue
    # 无条件登记卡号（无标记也登记 ⇒ 段回退能接住；D1001/D1002 这类"只有分支名"的卡）
    explicit.setdefault(d, set()).update(attr_from_text(br))

# ── 归属合成: 显式优先；无显式 → 段回退；都不适用 → 未归属 ──
per = {k: set() for k in ORDER}
fallback_cnt = 0
unattributed = []
for d, a in explicit.items():
    if a:
        for k in a:
            if k in per:
                per[k].add(d)
    else:
        k = seg_of(d)
        if k:
            per[k].add(d)
            fallback_cnt += 1
        else:
            unattributed.append(d)

def split(k):
    """→ (段内卡号, 越上界异常, 低于下界的历史卡)。段未定义 → 全部段内。"""
    seg = SEGMENTS[k]
    ds = sorted(per[k])
    if seg["lo"] is None:
        return ds, [], []
    inside = [x for x in ds if seg["lo"] <= x <= seg["hi"]]
    above = [x for x in ds if x > seg["hi"]]
    below = [x for x in ds if x < seg["lo"]]
    return inside, above, below

def render_owner(k):
    seg = SEGMENTS[k]
    inside, above, below = split(k)
    wm = inside[-1] if inside else None
    return "\n".join([
        f"# 号段水位 · {k}", "",
        "> **生成物（禁手改）**：由 `bash scripts/control-tower/gen-watermark.sh` 从 `task-state/*.json` + 全分支名反查生成。",
        f"> 段约定（人工常量）：{seg['label']}", "",
        "| 项 | 值 |", "|---|---|",
        f"| 段 | {seg['label']} |",
        f"| 水位（段内实测最大 D#） | {('D' + str(wm)) if wm else '未定义（段内无卡）'} |",
        f"| 下一个建议号 | {('D' + str(wm + 1)) if wm else '—'} |",
        f"| 段内卡数 | {len(inside)} |",
        f"| 段外异常（越上界，需裁定） | {('、'.join('D' + str(x) for x in above)) if above else '无'} |",
        f"| 历史卡（低于下界，分段约定前） | {len(below)} 张" + (f"（D{below[0]}–D{below[-1]}）" if below else "") + " |", "",
        "## 归属判定口径（防漂移）", "",
        f"- ① 显式归属: `task-state/D#.json` 的 `domain`/`owner`/`executor` 含 `{k.lower()}`，**或**分支名含 `d<数字>` + 该归属标记（分支名取**首个** D#；描述性数字不参与）",
        "- ② 段回退: 无任何归属标记但卡号落在本归属段内 → 归本归属",
        "- ③ 都不适用 → 未归属（历史卡，只计数，不入水位）",
        "- 水位 = **段内**实际存在的最大 D#（不手写常量；段内无卡 → 未定义）；段外异常只报事实，由 CTO 裁定改号或释放",
        "", "## 段内最近卡号（最大 10 个）", "",
        *( [f"- D{x}" for x in inside[-10:][::-1]] if inside else ["- （无）"] ),
        "",
    ]) + "\n"

def render_readme():
    rows = ["| 归属 | 段 | 水位（段内实测最大 D#） | 下一个建议号 | 段内卡数 | 段外异常 | 分册 |",
            "|---|---|---|---|---|---|---|"]
    for k in ORDER:
        seg = SEGMENTS[k]
        inside, above, _below = split(k)
        wm = inside[-1] if inside else None
        rows.append("| {k} | {seg} | {wm} | {nxt} | {n} | {anom} | [{k}.md]({k}.md) |".format(
            k=k, seg=seg["label"],
            wm=("D" + str(wm)) if wm else "未定义",
            nxt=("D" + str(wm + 1)) if wm else "—",
            n=len(inside), anom=len(above)))
    un = sorted(unattributed)
    un_line = (f"- 未归属（段外且无归属标记）: **{len(un)} 张**"
               + (f"（D{un[0]}–D{un[-1]}）" if un else "")) if un else "- 未归属: 0 张"
    return "\n".join([
        "# 号段水位（目录版）· README — 索引", "",
        "> **生成物**：`bash scripts/control-tower/gen-watermark.sh` 生成；`--check` 校验与仓库逐字节一致（可用于 CI）。",
        "> 本目录是 `../号段水位.md` 的正文（2026-09-26 / D979 目录化）；原文件保留为**短指针** ⇒ 既有引用不断链。", "",
        "## 分册（每归属一文件）", "", *rows, "",
        "## 段约定（人工常量）", "",
        "- Mac：D9xx", "- Win：D1000–D1099", "- K3：未定义（原始件只约定 Mac/Win 两段；K3 卡实测见分册）", "",
        "## 归属判定与计数", "",
        "- ① 显式归属（task-state 字段 / 分支名标记）→ ② 段回退（无标记但落在段内）→ ③ 都不适用 = 未归属",
        f"- 段回退命中: **{fallback_cnt} 张**；{un_line[2:]}",
        "- 段外异常 = 显式归属与段冲突的卡号（只报事实，不改数）", "",
        "## 取号前必读", "",
        "- 水位 = **段内实测最大 D#**；取号请用 `bash scripts/control-tower/alloc-task-id.sh \"<任务名>\"` 后**人工复核段归属**（该脚本只递增全局最大号，不感知分段 —— 2026-09-25 误用事故根因）。",
        "- 取号后如超出本段，按「段外异常」登记并由 CTO 裁定改号或释放。", "",
        *CORRECTION, "",
    ]) + "\n"

FILES = {"README.md": render_readme()}
for k in ORDER:
    FILES[f"{k}.md"] = render_owner(k)

if mode == "check":
    drift = []
    for name, content in sorted(FILES.items()):
        path = os.path.join(out_dir, name)
        try:
            with open(path, encoding="utf-8") as fh:
                cur = fh.read()
        except OSError:
            drift.append(f"  缺失: {path}")
            continue
        if cur != content:
            drift.append(f"  漂移: {path}")
    if drift:
        print("❌ 号段水位与仓库不一致（--check 漂移）:")
        for d in drift:
            print(d)
        print("   修复: bash scripts/control-tower/gen-watermark.sh 后提交生成物")
        sys.exit(1)
    print("✅ 号段水位与仓库逐字节一致（--check 通过）")
else:
    os.makedirs(out_dir, exist_ok=True)
    for name, content in sorted(FILES.items()):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as fh:
            fh.write(content)
    print("✅ 号段水位已生成（水位=归属段内实测最大 D#）:")
    for k in ORDER:
        seg = SEGMENTS[k]
        inside, above, below = split(k)
        wm = inside[-1] if inside else None
        print(f"   {k}: 段={seg['label']} 水位={('D' + str(wm)) if wm else '未定义'} "
              f"下一个={('D' + str(wm + 1)) if wm else '—'} 段内卡数={len(inside)} "
              f"段外异常={len(above)} 历史卡={len(below)}")
    print(f"   段回退命中={fallback_cnt} 未归属={len(unattributed)}")
    print(f"   输出目录: {os.path.join(out_dir, '')}")
PY
if [ "$RC" != 0 ]; then
  echo "gen-watermark: exit=${RC}（1=--check 检出漂移；2=自身失败）" >&2
fi
exit "$RC"
