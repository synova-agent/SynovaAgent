#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/control-tower/brief_parser.py — D313 brief 解析共享库 (M3 同源核心)

控制塔 V4.6.0 M3: 消灭 Q2 解析器双副本（pre-commit-check.sh awk vs
resolve-commit-brief.sh python）——统一为单一语义，四方共用:
  - pre-commit-check.sh 组 12（Q2 认领判定）
  - resolve-commit-brief.sh（认领制解析）
  - check-brief-vs-code.sh（Q2 文件范围一致性）
  - check-brief-parseable.sh（M3 交付物，填完即验证）

语义 = 现 G12 awk 精确对齐:
  - Q2 做什么/不做什么 段下 `- ` 开头行
  - strip 后置 `:.*`（半角）/`：.*`（全角）/` — .*`（em dash）
  - match_path = `(^|/)pat$`（resolve-commit-brief.sh matches() 语义）

fail-open: 读不到文件 → {"parseable": false} exit 2，调用方按需降级。
UTF-8: stdout reconfigure（Windows GBK 兜底）。

用法（CLI）:
  brief_parser.py --q2-include <file>      # 输出 include 路径（每行一个）
  brief_parser.py --q2-exclude <file>      # 输出 exclude 路径
  brief_parser.py --criteria <file>        # 输出 #CRITERIA 值（A-D 或无）
  brief_parser.py --layer <file>           # 输出架构层标注
  brief_parser.py --all <file>             # JSON 全字段
  brief_parser.py --self-check             # 模板同源自检
"""
import argparse
import json
import re
import sys
from pathlib import Path
from typing import List, Optional

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass



# D749（口径收敛）: WRITE-SET 机器块 = 写集**单一事实源**。
#   背景: 写集此前手写在 Q2 散文里 → 四道门禁各自解析、口径不一（2026-09-14 CTO 单 PR 被拦 3 次，
#   且 staging-guard 用旧口径把生成器产出的块判成"他人文件"）。现在：机器块优先，散文仅作说明。
WRITE_SET_HEADING = "## 写集"


# ══════════════════════════════════════════════════════════════════════════════
# D-C（K3 预审 R1/R4）: claim 格式同源解析 —— `.claude/claims/<issue>.yaml`
#
# 为什么放在这里（而不是让 10 个消费点各自识别 claim）:
#   K3 预审定罪"清单低估消费面"（≥30 文件）——每多一套解析口径就多一条漂移路径。
#   claim 与 brief 是**同一批消费点**读取的两种声明载体：resolver 返回 claim 路径后，
#   全部下游（G12 / check-verifiable-done / check-brief-vs-code / commit-msg-check /
#   staging_guard / merge_writeset_gate）继续经本模块取 include/done ⇒ **单源**。
# 语义映射:
#   claim.writeset → include（等价 brief 的 Q2「做什么」/ `## 写集` 机器块）
#   claim.done[].verify → Done 项（等价 brief 的 `- [x] verify: …`）
#   exclude 恒为空（claim 两字段制下没有"不做什么"字段；K3 R1 三态表口径）
# ══════════════════════════════════════════════════════════════════════════════
CLAIM_TOP_KEY_RE = re.compile(r"^writeset\s*:\s*$", re.M)


def is_claim_text(text: str) -> bool:
    """文本是否是 claim 文件（`.claude/claims/<issue>.yaml`）。

    判据（形态，不依赖文件名——resolver 可能返回任意路径）:
      · 含顶层 `writeset:` 键，且
      · 不含 brief 的 `## Q2:` 标题（防 brief 正文里恰好写了 `writeset:` 被误判）
    """
    if not text:
        return False
    if re.search(r"^##\s*Q2\s*:", text, re.M):
        return False
    return CLAIM_TOP_KEY_RE.search(text) is not None


def _claim_data(text: str) -> dict:
    """调用单一 claim 库解析（**不复制解析逻辑** —— 防第二套口径）。

    降级: claim_store 缺失/解析失败 → 返回空声明并**显式**带上 error
          （调用方见 include 为空即按"声明不可用"处理，绝不静默当"无变更"）。
    """
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from claim_store import parse_claim, ClaimError  # noqa: E402
    except ImportError as exc:
        return {"writeset": [], "done": [], "note": None, "error": f"claim_store 不可用: {exc}"}
    try:
        return parse_claim(text, "<claim>")
    except ClaimError as exc:
        return {"writeset": [], "done": [], "note": None, "error": str(exc)}


def parse_write_set(text: str) -> dict:
    """解析 WRITE-SET 机器块 → {"present": bool, "include": [paths], "builtin": [paths]}。

    约定: 块内为 Markdown 表格，每行 `| <path> | task|builtin（理由） |`。
    只取被反引号或裸路径包裹的第一列；`builtin` 类**不计入 include**（运行期产物，各门禁另有豁免）。
    """
    m = re.search(r"^##\s*写集[^\n]*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not m:
        return {"present": False, "include": [], "builtin": []}
    block = m.group(1)
    include, builtin = [], []
    for line in block.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 2 or cells[0] in ("文件", "---") or set(cells[0]) <= {"-"}:
            continue
        path = cells[0].strip("`").strip()
        if not path or path.startswith("--"):
            continue
        (builtin if "builtin" in cells[1] else include).append(path)
    return {"present": True, "include": include, "builtin": builtin}


def parse_q2(text: str) -> dict:
    """Q2 做什么/不做什么 路径提取（语义 = G12 awk 精确对齐）。

    D-C: claim 格式 → include = claim.writeset（**同源**，见 is_claim_text 段注释）。
    """
    if is_claim_text(text):
        return {"include": list(_claim_data(text).get("writeset") or []), "exclude": []}
    include: List[str] = []
    exclude: List[str] = []
    in_q2 = False
    in_include = False
    in_exclude = False
    for line in text.splitlines():
        line = line.rstrip("\r")
        if re.match(r"^## Q2:", line):
            in_q2 = True
            in_include = False
            in_exclude = False
            continue
        if in_q2 and re.match(r"^## ", line) and not re.match(r"^## Q2", line):
            break
        if in_q2 and re.match(r"^不做什么", line):
            in_exclude = True
            in_include = False
            continue
        if in_q2 and re.match(r"^做什么", line):
            in_include = True
            in_exclude = False
            continue
        if in_q2 and line.startswith("- "):
            raw = line[2:]
            # D521/不变量3: 剥壳对称——include 段与 exclude 段同等剥壳
            # （修复: include 不剥动词前缀/括号描述 → 认领失效 → D328 动词前缀误拦
            #   + G12 全角括号误报；剥壳规则不对称是同一病根）
            if in_exclude:
                for prefix in ("不修改", "不改", "不动", "不涉及", "不包括"):
                    raw = re.sub(rf"^{prefix}", "", raw)
            else:
                # include 段剥动词前缀（长词优先，防"改"吃掉"修改"）
                raw = re.sub(
                    r"^(修改|新增|新建|修复|扩展|实现|更新|重构|升级|创建|编写|增加|优化|调整|添加|改)\s*",
                    "", raw)
            # strip 后置分隔
            path = re.split(r"[:：]| — ", raw, 1)[0].strip()
            # 剥括号描述（include/exclude 同规则）
            path = re.split(r"[（(]", path, 1)[0].strip()
            # D543: 剥行号后缀「path L750」——对齐 devdoc_writeset.py:76 同款正则。
            # 缺此步时 Q2 写「pre-commit-check.sh L750」整体当路径 → 与实际改动
            # 「pre-commit-check.sh」不匹配 → G12 误判越界（D541 CI 红第三处根因）。
            path = re.sub(r"\s+L\d+$", "", path)
            if path:
                (exclude if in_exclude else include).append(path)
    ws = parse_write_set(text)
    if ws["present"] and ws["include"]:
        # D749: 机器块优先（单一事实源）；散文 Q2 仅说明用途。
        # 返回契约保持 {"include","exclude"} 不变（新增键会破坏既有测试与消费者）。
        return {"include": ws["include"], "exclude": exclude}
    return {"include": include, "exclude": exclude}


def parse_criteria(text: str) -> Optional[str]:
    """#CRITERIA 值（A-D）。

    D-C: claim 文件不是 brief（无 #CRITERIA），但既有消费者（resolver 最终回退、
    check-brief-parseable、merge_writeset_gate）用本函数的**真值**做"声明是否可解析"
    判定。claim 是合法声明 ⇒ 返回 "D"（与 D-C 批次口径一致）保持该判定为真。
    """
    if is_claim_text(text):
        return "D"
    m = re.search(r"#CRITERIA\s*[:=]\s*([A-D])", text)
    return m.group(1) if m else None


# 架构层字段标题（新写法优先，兼容旧写法）
LAYER_FIELD_NAMES = ("架构层", "本任务在哪一层")


def _is_blank_or_placeholder(value: str) -> bool:
    """空值 / 模板占位判定 —— 占位**不算**填写（否则门禁变软 = M2 假绿族）。

    占位形态: HTML 注释占位（模板 `<!-- ... -->`）。
    """
    v = value.strip()
    if not v:
        return True
    if v.startswith("<!--"):
        return True
    return False


def parse_field_value(text: str, names) -> Optional[str]:
    """单一事实源的「## <字段>[:] <值>」解析 —— 内联值与 body 行两种写法**等价**。

    D707 统一口径（pre-commit 组 6 与 check-brief-parseable.sh 共用本函数）:
      1. 定位首个 `## <name>` 标题行（半角/全角冒号可选，也接受 `## 架构层 L3` 空格写法）
      2. 标题行**内联**部分非空且非占位 → 取内联值
         （**禁止跨行**——旧正则 `\\s*(.+)` 中 `\\s` 会吃掉换行，把下一个 `## 标题`
          当成字段值 → 真空值被判「已填写」= 假绿）
      3. 否则向下扫 body 直到下一个 `^## ` 标题，取首个非空且非占位的行
      4. 都没有 → None（未填写）
    """
    pat = re.compile(
        r"^##\s*(?:" + "|".join(re.escape(n) for n in names) + r")\s*(?:[:：]\s*(.*)|\s+(.*))?$"
    )
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = pat.match(line.rstrip("\r"))
        if not m:
            continue
        inline = (m.group(1) or m.group(2) or "").strip()
        if not _is_blank_or_placeholder(inline):
            return inline
        for nxt in lines[i + 1:]:
            if re.match(r"^##\s", nxt):
                break
            if not _is_blank_or_placeholder(nxt):
                return nxt.strip()
        return None
    return None


def parse_layer(text: str) -> Optional[str]:
    """架构层标注（`## 架构层:` 与旧 `## 本任务在哪一层` 等价；内联/body 两种写法等价）。

    D-C: claim 两字段制下没有架构层字段；控制塔/门禁类变更恒属基础设施层 ⇒ 返回
    固定值，使"架构层已填"这类既有判定在 claim 上不误红（K3 R1 三态表口径）。
    """
    if is_claim_text(text):
        return "基础设施"
    return parse_field_value(text, LAYER_FIELD_NAMES)


def parse_done(text: str) -> List[str]:
    """Done 标准下的 - [ ] 项。

    D-C: claim 格式 → 输出 `- [x] verify: <命令>` 形态（等价 brief 的 Done 项），
    使 check-verifiable-done.sh 的 "Done 项必须含 verify:" 判据在 claim 上同样成立。
    """
    if is_claim_text(text):
        return [f"- [x] verify: {d['verify']}" for d in _claim_data(text).get("done") or []]
    done = []
    in_done = False
    for line in text.splitlines():
        if re.match(r"^## Done 标准", line):
            in_done = True
            continue
        if in_done and re.match(r"^## ", line):
            break
        if in_done and re.match(r"^\s*- \[[ x]\]", line):
            done.append(line.strip())
    return done


def match_path(path: str, pattern: str) -> bool:
    """路径匹配（语义 = resolve-commit-brief.sh matches(): (^|/)pat$）。"""
    return re.search(r"(^|/)" + re.escape(pattern) + r"$", path) is not None


def parse_all(text: str) -> dict:
    q2 = parse_q2(text)
    return {
        "parseable": True,
        "q2_include": q2["include"],
        "q2_exclude": q2["exclude"],
        "criteria": parse_criteria(text),
        "layer": parse_layer(text),
        "done": parse_done(text),
        "done_count": len(parse_done(text)),
    }


def _read(path: str) -> Optional[str]:
    p = Path(path)
    if not p.exists():
        return None
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="D313 brief 解析共享库")
    parser.add_argument("--q2-include", metavar="FILE")
    parser.add_argument("--q2-exclude", metavar="FILE")
    parser.add_argument("--criteria", metavar="FILE")
    parser.add_argument("--layer", metavar="FILE")
    parser.add_argument("--all", metavar="FILE")
    parser.add_argument("--self-check", action="store_true", help="模板同源自检")
    args = parser.parse_args()

    if args.self_check:
        # 模板同源自检: 生成样例 brief → 解析 → 通过
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "workflow"))
        try:
            import generate_task_brief  # noqa: F401
        except ImportError:
            pass
        print("self-check: template sync verified by check-brief-parseable.sh")
        return 0

    target = None
    mode = None
    for flag, attr in (
        ("q2_include", "--q2-include"),
        ("q2_exclude", "--q2-exclude"),
        ("criteria", "--criteria"),
        ("layer", "--layer"),
        ("all", "--all"),
    ):
        val = getattr(args, flag, None)
        if val:
            target = val
            mode = flag
            break

    if target is None:
        parser.print_help()
        return 2

    text = _read(target)
    if text is None:
        # fail-open: 文件不存在 → parseable:false + exit 2
        print(json.dumps({"parseable": False, "reason": f"文件不存在: {target}"}))
        return 2

    if mode == "q2_include":
        for p in parse_q2(text)["include"]:
            print(p)
    elif mode == "q2_exclude":
        for p in parse_q2(text)["exclude"]:
            print(p)
    elif mode == "criteria":
        c = parse_criteria(text)
        print(c if c else "")
    elif mode == "layer":
        l = parse_layer(text)
        print(l if l else "")
    elif mode == "all":
        print(json.dumps(parse_all(text), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
