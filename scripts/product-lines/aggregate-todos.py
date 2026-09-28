#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
aggregate-todos.py — 待办聚合器（设计 v1.4 §四；A3 每周五自动 + 审计报告提交后触发）

一句话: 从 5 个现成数据源抓取待办 → 归属到产品线 → todos.yaml（页面"还差什么"的数据源）。

契约:
  @input  — 5 个现成源（全部只读，零新增维护）:
            ① docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md（P0/P1 台账表）
            ② docs/synova/research/AUTHORITY-DEVIATION-REGISTRY-v2.md（P0/P1 偏差登记）
            ③ docs/synova/research/C线-世界级基准-20260802/第五章-差距清单与路线图-20260802.md
            ④ docs/synova/DASHBOARD-CN.md（未完成任务）
            ⑤ scripts/golden-scenarios/（未转绿场景；目录不存在=正常默认）
            映射: docs/synova/product-lines/todo-line-map.yaml
  @output — docs/synova/product-lines/todos.yaml（AUTO 区机器生成 + MANUAL 区人工微调原样保留）
  @degraded — 源缺失/解析失败 → 逐源 log.warn + degraded 清单（铁律 24/31），其余源继续；
              ENOENT（源不存在）= 正常默认，不告警；解析异常 = 告警 + degraded。
  @exit   — 0 成功；2 降级/失败（映射 yaml 坏 = fail-closed）

归属规则（防瞎猜）: d_override > 关键词 > 跳过；跳过的条目计数并在输出中诚实标注。
幂等: AUTO 区无变化不重写文件（防 mtime 噪音）；MANUAL 区逐字节保留。
"""
from __future__ import annotations

import argparse
import logging
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

try:
    import productline_yaml  # noqa: E402
except ImportError:  # pragma: no cover
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import productline_yaml  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("aggregate-todos")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

AUTO_START = "# AUTO:START"
AUTO_END = "# AUTO:END"
MANUAL_START = "# MANUAL:START"
MANUAL_END = "# MANUAL:END"

# D1055 ④ (B2 报告 F-2「D# 抽取区分大小写」) 修复:
#   旧: r"\bD(\d{3})\b" —— 两处缺陷同族（都是"只认一种 D# 写法"）:
#     ① 区分大小写 ⇒ 小写 `d922` 抽不到 → d_number=null → task_state_status=__no_did__
#        ⇒ X4（task-state status ∈ {claimed,in_progress,spec_done}）永不生效，该件只靠
#        X5「近 14 天」偶然留下。B2 报告实测当事件 = .claude/task-briefs/2026-09-24-B3-d922-fixture-registry.md
#        （真实状态 D922 = spec_done，在飞）。
#     ② 恰好 3 位 ⇒ `D1000+` 全数抽不到（注册表已进入 4 位号；实测仓内 8 个 4 位号 brief 名）。
#   新: r"\b[Dd](\d{3,})\b" —— 大小写通吃 + 3 位及以上。
#   为何用 {3,} 而非卡面建议的 \d+ : 纯 \d+ 会把 `D1`/`d2` 这类 1-2 位噪音抽成 "D001"/"D002"
#     并写进 todos.depends ⇒ **造出一个不存在的依赖**（宁缺勿造）。仓内 task-state 实测下限
#     = D356（B2 报告 registry_d_number_floor=356，1-2 位属注册表时代之前），故 {3,} 对真实
#     任务号是完备的，只滤掉噪音。
D_RE = re.compile(r"\b[Dd](\d{3,})\b")


def read_text(path: Path):
    try:
        return path.read_text(encoding="utf-8"), None
    except OSError as e:
        return None, "读取失败: %s" % e


def map_to_line(text: str, d_number: str, d_override, keywords):
    """归属: 任务编号精确映射 > 关键词。返回 line id 或 None（诚实跳过）。"""
    if d_number and d_number in d_override:
        return d_override[d_number]
    if not text:
        return None
    for kw, line in keywords:
        if kw in text:
            return line
    return None


def parse_ledger(text: str, d_override, keywords):
    """源①: 审计发现台账 P0/P1 行 → todos。"""
    todos = []
    if text is None:
        return todos, "台账读取失败"
    in_section = False
    for line in text.splitlines():
        if line.startswith("## 一、审计发现台账"):
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if not in_section or not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 7:
            continue
        # D# 可能在任务列（cells[1]）或修复列（cells[5]）
        if not (D_RE.search(cells[1]) or (len(cells) > 5 and D_RE.search(cells[5]))):
            continue
        date, dno, level, finding = cells[0], cells[1], cells[2], cells[3]
        if "P0" not in level and "P1" not in level:
            continue
        # 修复列（cells[5]）或任务列中的编号 → 逐条映射（区间 D355-D360 展开）
        d_refs_raw = cells[5] if len(cells) > 5 else ""
        range_m = re.search(r"[Dd](\d{3,})\s*-\s*[Dd](\d{3,})", d_refs_raw)
        if range_m:
            d_refs = [str(n) for n in range(int(range_m.group(1)), int(range_m.group(2)) + 1)]
        else:
            d_refs = D_RE.findall(d_refs_raw) or D_RE.findall(dno)
        if not d_refs:
            continue
        finding_clean = finding.replace("**", "").replace("`", "")
        priority = "P0" if "P0" in level else "P1"
        for dnum in d_refs:
            d_num = "D%03d" % int(dnum)
            line_id = map_to_line(d_num + " " + finding_clean, d_num, d_override, keywords)
            if line_id is None or line_id == 0:
                continue
            todos.append({
                "line": line_id,
                "title": "%s（%s）" % (finding_clean[:80], d_num),
                "source": "审计发现台账（%s）" % dno,
                "priority": priority,
                "depends": [d_num],
            })
    return todos, None


def parse_registry(text: str, d_override, keywords):
    """源②: 权威偏差登记册 P0/P1 条目 → todos（粗粒度行匹配 + 去重靠标题）。"""
    todos = []
    if text is None:
        return todos, "登记册读取失败"
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        if "P0" not in line and "P1" not in line:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        text_joined = " ".join(cells)
        # 只收"发现"型行: 含任务编号或 N 编号，且不含"结论/判定/结果"表头词
        if not (D_RE.search(text_joined) or re.search(r"\bN\d+\b", text_joined)):
            continue
        if re.match(r"^\| ?(项|#|日期|子任务)", line):
            continue
        # 摘要行（"4. 待决策项分析（2 项）"之类）不是可执行发现 → 跳过
        if re.search(r"（\d+\s*项）", text_joined):
            continue
        d_m = D_RE.search(text_joined)
        d_num = ("D%03d" % int(d_m.group(1))) if d_m else None
        line_id = map_to_line(text_joined, d_num, d_override, keywords)
        if line_id is None or line_id == 0:
            continue
        title = cells[1] if len(cells) > 1 and len(cells[1]) > 8 else text_joined[:120]
        todos.append({
            "line": line_id,
            "title": title[:120],
            "source": "权威偏差登记册 v2",
            "priority": "P0" if "P0" in text_joined else "P1",
            "depends": [d_num] if d_num else [],
        })
    return todos, None


def parse_cline(text: str, standards):
    """源③: C线差距清单（第五章明细表）→ todos。"""
    todos = []
    if text is None:
        return todos, "C线第五章读取失败"
    for line in text.splitlines():
        if not line.startswith("| S"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 6:
            continue
        sid, name, current, target, nature, level = cells[0], cells[1], cells[2], cells[3], cells[4], cells[5]
        if "P0" not in level and "P1" not in level:
            continue
        line_id = standards.get(sid)
        if line_id is None or line_id == 0:
            continue
        priority = "P0" if "P0" in level else "P1"
        todos.append({
            "line": line_id,
            "title": "%s（%s）: %s" % (name, sid, nature),
            "source": "C线差距清单（第五章）",
            "priority": priority,
            "depends": [],
        })
    return todos, None


def parse_dashboard(text: str, d_override, keywords):
    """源④: DASHBOARD-CN 未完成任务 → todos。"""
    todos = []
    if text is None:
        return todos, "任务看板读取失败"
    for line in text.splitlines():
        if not line.startswith("| D"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        dno, title, status = cells[0], cells[1], cells[2]
        if status.startswith("✅"):
            continue
        d_m = D_RE.search(dno)
        d_num = ("D%03d" % int(d_m.group(1))) if d_m else None
        line_id = map_to_line(dno + " " + title, d_num, d_override, keywords)
        if line_id is None or line_id == 0:
            continue
        priority = "P0" if "P0" in status else "P1"
        todos.append({
            "line": line_id,
            "title": "%s: %s" % (dno, title[:80]),
            "source": "任务看板（未完成）",
            "priority": priority,
            "depends": [d_num] if d_num else [],
        })
    return todos, None


def parse_scenarios(gs_dir: Path, line_scenarios):
    """源⑤: 未转绿场景 → todos（按场景归属线）。目录不存在=正常默认。"""
    todos = []
    if not gs_dir.is_dir():
        return todos, None
    evidence_dir = gs_dir / "evidence"
    red_scenarios = set()
    if evidence_dir.is_dir():
        green = set()
        for f in sorted(evidence_dir.glob("GS-*.json")):
            try:
                import json as _json
                rec = _json.loads(f.read_text(encoding="utf-8"))
                if rec.get("verdict") == "pass" and rec.get("record_type") == "scenario":
                    green.add(rec.get("scenario_id", f.stem.split("-")[0]))
            except (OSError, ValueError):
                log.warning("场景证据损坏，跳过: %s", f)
        for d in sorted(gs_dir.glob("GS-*/")):
            sid = d.name.split("-")[0]
            if sid not in green and (d / "run.sh").is_file():
                red_scenarios.add(sid)
    for line_id, scenarios in line_scenarios.items():
        for s in scenarios:
            if s in red_scenarios:
                todos.append({
                    "line": line_id,
                    "title": "场景 %s 转绿（断言 exit 0 + 证据入库）" % s,
                    "source": "黄金场景（未转绿）",
                    "priority": "P0",
                    "depends": [],
                })
    return todos, None


def dedup(todos):
    seen = set()
    out = []
    for t in todos:
        key = (t["line"], t["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


def finalize(todos, line_scenarios, default_owner, harness_lines, today):
    """补 id/owner/acceptance 字段并排序。"""
    counter = {}
    for t in todos:
        lid = t["line"]
        counter[lid] = counter.get(lid, 0) + 1
        t["id"] = "T-%s-%02d" % (lid, counter[lid])
        t["owner"] = "DeepSeek Harness" if lid in harness_lines else default_owner
        scenarios = line_scenarios.get(lid, [])
        t["acceptance"] = ("场景 %s 转绿（exit 0 + 证据入库）" % "、".join(scenarios)
                           if scenarios else "线 %s 全部验收点验证通过" % lid)
    todos.sort(key=lambda t: (t["priority"] != "P0", t["line"], t["id"]))
    return todos


def preserve_manual(existing_text: str):
    """提取既有 MANUAL 区（逐字节保留）。"""
    if not existing_text:
        return ""
    if MANUAL_START in existing_text and MANUAL_END in existing_text:
        return existing_text.split(MANUAL_START, 1)[1].split(MANUAL_END, 1)[0]
    return ""


def yaml_quote(s: str) -> str:
    """双引号 YAML 标量转义（与 productline_yaml 子集解析器配套）。"""
    return s.replace("\\", "\\\\").replace('"', '\\"')


def render(todos, degraded, manual_block, today):
    lines = ["# todos.yaml — 待办聚合产物（由 scripts/product-lines/aggregate-todos.py 生成）",
             "# AUTO 区机器生成，禁止手写；MANUAL 区人工微调归属，生成器逐字节保留。",
             "# 改完跑 bash scripts/product-lines/refresh-all.sh 生效。",
             "version: 1.0",
             "generated_at: \"%s\"" % today,
             "todos:",
             AUTO_START]
    for t in todos:
        lines.append("  - id: \"%s\"" % t["id"])
        lines.append("    line: %s" % t["line"])
        lines.append("    title: \"%s\"" % yaml_quote(t["title"]))
        lines.append("    source: \"%s\"" % yaml_quote(t["source"]))
        lines.append("    priority: %s" % t["priority"])
        lines.append("    owner: \"%s\"" % t["owner"])
        lines.append("    depends: [%s]" % ", ".join('"%s"' % d for d in t["depends"]))
        lines.append("    acceptance: \"%s\"" % yaml_quote(t["acceptance"]))
    lines.append(AUTO_END)
    lines.append(MANUAL_START)
    if manual_block.strip("\n"):
        lines.append(manual_block.strip("\n"))
    else:
        lines.append("manual: []")
    lines.append(MANUAL_END)
    return "\n".join(lines) + "\n"


def aggregate(args):
    d_override_map = {}
    keywords = []
    standards = {}
    line_scenarios = {}
    default_owner = "Claude Code"
    harness_lines = []
    degraded = []

    map_path = Path(args.map)
    if map_path.is_file():
        try:
            m = productline_yaml.load_file(str(map_path))
        except productline_yaml.YamlSubsetError as e:
            log.error("映射 yaml 解析失败: %s → exit 2（fail-closed）", e)
            sys.exit(2)
        d_override_map = {str(k): int(v) for k, v in (m.get("d_override") or {}).items()}
        keywords = [(str(k), int(v)) for k, v in (m.get("keywords") or [])]
        standards = {str(k): int(v) for k, v in (m.get("standards") or {}).items()}
        line_scenarios = {int(k): list(v) for k, v in (m.get("line_scenarios") or {}).items()}
        default_owner = m.get("default_owner", "Claude Code")
        harness_lines = [int(x) for x in (m.get("harness_lines") or [])]
    else:
        log.error("映射文件缺失: %s → exit 2（fail-closed）", map_path)
        sys.exit(2)

    todos = []
    for name, path, parser in [
        ("台账", Path(args.ledger), lambda t: parse_ledger(t, d_override_map, keywords)),
        ("登记册", Path(args.registry), lambda t: parse_registry(t, d_override_map, keywords)),
        ("C线", Path(args.cline), lambda t: parse_cline(t, standards)),
        ("任务看板", Path(args.dashboard), lambda t: parse_dashboard(t, d_override_map, keywords)),
    ]:
        text, err = read_text(path)
        if err:
            degraded.append("%s: %s" % (name, err))
            continue
        try:
            items, perr = parser(text)
        except Exception as e:  # 解析器内部异常不得静默吞
            log.warning("源 %s 解析异常: %s", name, e)
            degraded.append("%s 解析异常: %s" % (name, e))
            continue
        if perr:
            degraded.append("%s: %s" % (name, perr))
        todos.extend(items)

    scenario_todos, sperr = parse_scenarios(Path(args.gs_dir), line_scenarios)
    if sperr:
        degraded.append("场景: %s" % sperr)
    todos.extend(scenario_todos)

    todos = finalize(dedup(todos), line_scenarios, default_owner, harness_lines,
                     datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    # 看板大扫除（2026-08-28 CTO）: closed 清单过滤（僵尸/已覆盖/审计记录类条目）
    _closed_path = PROJECT_ROOT / "docs/synova/product-lines/todos-closed.yaml"
    if _closed_path.is_file():
        try:
            _closed_ids = set()
            for _ln in _closed_path.read_text(encoding="utf-8").splitlines():
                _m = re.match(r"\s*- id: \"([^\"]+)\"", _ln)
                if _m:
                    _closed_ids.add(_m.group(1))
            if _closed_ids:
                todos = [t for t in todos if t.get("id") not in _closed_ids]
                log.info("closed 清单过滤: 跳过 %d 条", len(_closed_ids))
        except Exception as _e:
            degraded.append("closed 清单解析失败: %s" % _e)

    out_path = Path(args.out)
    manual_block = ""
    if out_path.is_file():
        manual_block = preserve_manual(out_path.read_text(encoding="utf-8"))
    content = render(todos, degraded, manual_block, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    if out_path.is_file():
        existing = out_path.read_text(encoding="utf-8")

        def norm(s: str) -> str:
            return re.sub(r'generated_at: ".*"', 'generated_at: "X"', s)

        if norm(existing) == norm(content):
            log.info("待办无变化（仅时间戳），不重写（幂等）")
            return todos, degraded

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding="utf-8")
    log.info("已写入 %s（%d 条待办）", out_path, len(todos))

    return todos, degraded


def main():
    ap = argparse.ArgumentParser(description="待办聚合（A3）")
    ap.add_argument("--ledger", default=str(PROJECT_ROOT / "docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md"))
    ap.add_argument("--registry", default=str(PROJECT_ROOT / "docs/synova/research/AUTHORITY-DEVIATION-REGISTRY-v2.md"))
    ap.add_argument("--cline", default=str(PROJECT_ROOT / "docs/synova/research/C线-世界级基准-20260802/第五章-差距清单与路线图-20260802.md"))
    ap.add_argument("--dashboard", default=str(PROJECT_ROOT / "docs/synova/DASHBOARD-CN.md"))
    ap.add_argument("--gs-dir", default=str(PROJECT_ROOT / "scripts/golden-scenarios"))
    ap.add_argument("--map", default=str(PROJECT_ROOT / "docs/synova/product-lines/todo-line-map.yaml"))
    ap.add_argument("--out", default=str(PROJECT_ROOT / "docs/synova/product-lines/todos.yaml"))
    args = ap.parse_args()

    todos, degraded = aggregate(args)
    if degraded:
        log.warning("degraded: %d 个源降级: %s", len(degraded), "; ".join(degraded[:3]))
    sys.exit(0)


if __name__ == "__main__":
    main()
