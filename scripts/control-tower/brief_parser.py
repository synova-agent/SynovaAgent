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


# D1061 5④: 「路径形状」判定 —— 明确扩展名结尾 + 路径体不含空白。
#   为什么需要它: parse_q2 原实现**无条件** `re.split(r"[（(]", path, 1)[0]`，把
#   **路径自带的括号**当成"括号描述"剥掉 ⇒ 含括号的真实文件名被截断（#878 实证：
#   `.claude/task-briefs/2026-09-28-D1052-…-docs（系统性假红修复）.md` → 截成 `…-docs`
#   → D708 判「夹带」→ 全 PR 假红）。
#   判定口径: `^<无空白路径体>.<明确扩展名>$`。路径体用 `[^\s]+` 覆盖中文/全角括号/半角括号/
#   连字符（`\w` 不含 CJK 标点，不能用来判中文路径）。扩展名白名单 = 本仓实际会出现的交付物类型。
#   命中 ⇒ **整体保留**（不再剥括号）；未命中 ⇒ 回退既有剥括号行为（钉住语义不回归，
#   见 tests/control-tower/brief-parser-strip.test.sh —— 该文件本卡不改）。
PATH_SHAPE_RE = re.compile(
    r"^[^\s]+\.(?:md|sh|py|ts|tsx|js|json|yml|yaml|txt|html)$"
)


def parse_q2(text: str) -> dict:
    """Q2 做什么/不做什么 路径提取（语义 = G12 awk 精确对齐）。"""
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
            # D1061 5④: **路径形状优先** —— 先判"这条到底是不是一个完整路径"。
            #   命中形状 ⇒ 整体保留（含中文/括号的真实文件名不被截断）；
            #   未命中   ⇒ 回退既有"剥括号描述"行为（`src/l3/foo.ts（专家路由）`→`src/l3/foo.ts`；
            #              `scripts/audit/（K3 红线）`→`scripts/audit/`）。
            if not PATH_SHAPE_RE.match(path):
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
    """#CRITERIA 值（A-D）。"""
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
    """架构层标注（`## 架构层:` 与旧 `## 本任务在哪一层` 等价；内联/body 两种写法等价）。"""
    return parse_field_value(text, LAYER_FIELD_NAMES)


def parse_done(text: str) -> List[str]:
    """Done 标准下的 - [ ] 项。"""
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
